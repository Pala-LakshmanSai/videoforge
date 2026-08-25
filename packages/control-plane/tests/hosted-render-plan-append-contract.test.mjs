import assert from "node:assert/strict";
import test from "node:test";

import { IDS, seedLockedProjects } from "./support/fixtures.mjs";
import { expectDatabaseError, sha256, withMigratedDatabase } from "./support/pglite.mjs";

const FUNCTION = "videoforge_append_hosted_render_plan";

function payload(projectId = IDS.projectA, revisionId = IDS.revisionA) {
  return {
    schema_version: "videoforge-hosted-cpu-submission/v1",
    project_id: projectId,
    project_revision_id: revisionId,
    kind: "RENDER",
  };
}

async function append(executor, value, hash = sha256("render-plan-a")) {
  return executor.query(
    `SELECT inserted, payload, payload_sha256
       FROM public.${FUNCTION}($1, $2, $3, $4,
         'videoforge-hosted-cpu-submission/v1', $5::jsonb, $6)`,
    [IDS.accountA, IDS.workspaceA, IDS.projectA, IDS.revisionA, JSON.stringify(value), hash],
  );
}

test("migration 0038 exposes only one tenant-scoped append capability", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    const definition = await executor.query(
      `SELECT prosecdef, proconfig, pg_get_functiondef(oid) AS definition
         FROM pg_catalog.pg_proc
        WHERE proname = $1`,
      [FUNCTION],
    );
    assert.equal(definition.rows.length, 1);
    assert.equal(definition.rows[0].prosecdef, true);
    assert.deepEqual(definition.rows[0].proconfig, ["search_path=public, pg_catalog"]);
    assert.match(definition.rows[0].definition, /videoforge_current_account_id/u);
    assert.match(definition.rows[0].definition, /ON CONFLICT .* DO NOTHING/u);
    assert.doesNotMatch(definition.rows[0].definition, /UPDATE hosted_render_plans/u);

    const privileges = await executor.query(
      `SELECT has_function_privilege('public',
         'public.videoforge_append_hosted_render_plan(uuid,uuid,uuid,uuid,text,jsonb,text)',
         'EXECUTE') AS public_execute`,
    );
    assert.deepEqual(privileges.rows, [{ public_execute: false }]);
  });
});

test("migration 0038 appends once, accepts exact replay, and rejects drift or foreign scope", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedLockedProjects(executor);
    await executor.query(`SELECT set_config('videoforge.account_id', $1, false)`, [IDS.accountA]);

    const first = await append(executor, payload());
    assert.deepEqual(first.rows, [
      {
        inserted: true,
        payload: payload(),
        payload_sha256: sha256("render-plan-a"),
      },
    ]);
    const replay = await append(executor, payload());
    assert.deepEqual(replay.rows, [
      {
        inserted: false,
        payload: payload(),
        payload_sha256: sha256("render-plan-a"),
      },
    ]);

    await expectDatabaseError(append(executor, { ...payload(), kind: "ASR" }), "23505");
    await expectDatabaseError(append(executor, payload(), sha256("drifted-plan")), "23505");

    await executor.query(`SELECT set_config('videoforge.account_id', $1, false)`, [IDS.accountB]);
    await expectDatabaseError(append(executor, payload()), "42501");

    await executor.query(`SELECT set_config('videoforge.account_id', $1, false)`, [IDS.accountA]);
    await expectDatabaseError(
      executor.query(
        `UPDATE hosted_render_plans SET payload_sha256 = $1
          WHERE account_id = $2 AND workspace_id = $3 AND project_id = $4
            AND project_revision_id = $5`,
        [sha256("mutated"), IDS.accountA, IDS.workspaceA, IDS.projectA, IDS.revisionA],
      ),
      "55000",
    );
  });
});

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { canonicalizeJson } from "@videoforge/contracts";
import { TENANT_PRINCIPAL_SETTING } from "../dist/src/index.js";
import { IDS, seedLockedProjects } from "./support/fixtures.mjs";
import {
  applyMigrationSliceThrough,
  createFixtureDatabase,
  expectDatabaseError,
} from "./support/pglite.mjs";

const STYLE_ID = "ffffffff-ffff-4fff-8fff-000000000031";
const VERSION_ID = "ffffffff-ffff-4fff-8fff-000000000032";
const PROFILE_HASH = "sha256:dbd99d0857bc5021998683b43ac0191439e3396b55e3656101904e8f1412d9b7";
const PROFILE = JSON.parse(
  readFileSync(
    new URL(
      "../../../project-context/evidence/natural_documentary_image_style_v1.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

async function oldRows(executor) {
  const result = {};
  for (const table of ["image_styles", "image_style_versions", "project_revisions"]) {
    result[table] = (
      await executor.query(`SELECT to_jsonb(record) AS row FROM public.${table} record ORDER BY id`)
    ).rows;
  }
  return result;
}

test("0239 adds a shared immutable published style without changing private presets or old revision pins", async () => {
  const { database, executor, sources } = await createFixtureDatabase();
  try {
    await applyMigrationSliceThrough(executor, 238, sources);
    await seedLockedProjects(executor);
    const before = await oldRows(executor);
    const migration = sources.find((entry) => entry.version === 239);
    assert.ok(migration);
    assert.equal(
      migration.sha256,
      `sha256:${createHash("sha256").update(migration.sql).digest("hex")}`,
    );
    // Replay this historical transition only; later migrations have their own checks.
    await executor.transaction(async (transaction) => {
      await transaction.execute(migration.sql);
      await transaction.query(
        `INSERT INTO public.videoforge_schema_migrations(version,name,filename,sha256)
         VALUES($1,$2,$3,$4)`,
        [migration.version, migration.name, migration.filename, migration.sha256],
      );
    });

    const version = (
      await executor.query(
        `SELECT style.name, style.normalized_name, style.status, style.active_version_id,
              style.scope_kind AS parent_scope, style.account_id, style.workspace_id,
              version.scope_kind, version.state, version.profile_payload,
              version.style_profile_hash, version.analyzer_request_hash,
              version.analyzer_model_snapshot
         FROM image_styles style JOIN image_style_versions version ON version.style_id = style.id
        WHERE style.id = $1 AND version.id = $2`,
        [STYLE_ID, VERSION_ID],
      )
    ).rows[0];
    assert.equal(version.name, "Natural Documentary");
    assert.equal(version.normalized_name, "natural documentary");
    assert.equal(version.status, "ACTIVE");
    assert.equal(version.active_version_id, null);
    assert.equal(version.parent_scope, "SYSTEM");
    assert.equal(version.scope_kind, "SYSTEM");
    assert.equal(version.account_id, "ffffffff-ffff-4fff-8fff-000000000001");
    assert.equal(version.workspace_id, "ffffffff-ffff-4fff-8fff-000000000011");
    assert.equal(version.state, "PUBLISHED");
    assert.deepEqual(version.profile_payload, PROFILE);
    assert.equal(version.profile_payload.analysis.analysis_kind, "MANUAL");
    assert.equal(version.style_profile_hash, PROFILE_HASH);
    assert.equal(
      `sha256:${createHash("sha256").update(canonicalizeJson(PROFILE)).digest("hex")}`,
      PROFILE_HASH,
    );
    assert.equal(version.analyzer_request_hash, null);
    assert.equal(version.analyzer_model_snapshot, null);
    assert.deepEqual(
      (
        await executor.query(
          `SELECT
         (SELECT count(*)::int FROM image_style_analysis_attempts WHERE style_version_id = $1) AS analyses,
         (SELECT count(*)::int FROM image_style_previews WHERE style_version_id = $1) AS previews`,
          [VERSION_ID],
        )
      ).rows,
      [{ analyses: 0, previews: 0 }],
    );

    for (const [accountId, workspaceId, foreignWorkspaceId] of [
      [IDS.accountA, IDS.workspaceA, IDS.workspaceB],
      [IDS.accountB, IDS.workspaceB, IDS.workspaceA],
    ]) {
      await executor.query("SELECT set_config($1, $2, false)", [
        TENANT_PRINCIPAL_SETTING,
        accountId,
      ]);
      try {
        // Tenant views are enforced even for PGlite's owner connection. Native RLS rehearsal is separate.
        for (const [table, id] of [
          ["videoforge_tenant_image_styles", STYLE_ID],
          ["videoforge_tenant_image_style_versions", VERSION_ID],
        ]) {
          assert.equal(
            (
              await executor.query(`SELECT count(*)::int AS count FROM ${table} WHERE id = $1`, [
                id,
              ])
            ).rows[0].count,
            1,
          );
          assert.equal(
            (
              await executor.query(
                `SELECT count(*)::int AS count FROM ${table} WHERE workspace_id = $1`,
                [foreignWorkspaceId],
              )
            ).rows[0].count,
            0,
          );
        }
        // Same exact-version join used by hosted preset resolution: no active pointer required.
        const resolved = await executor.query(
          `SELECT version.id, version.style_profile_hash
             FROM image_styles style JOIN image_style_versions version
               ON version.account_id = style.account_id AND version.workspace_id = style.workspace_id
              AND version.style_id = style.id AND version.scope_kind = style.scope_kind
            WHERE version.id = $3 AND style.status = 'ACTIVE' AND version.state = 'PUBLISHED'
              AND ((style.account_id = $1 AND style.workspace_id = $2 AND style.scope_kind = 'WORKSPACE')
                   OR style.scope_kind = 'SYSTEM')`,
          [accountId, workspaceId, VERSION_ID],
        );
        assert.deepEqual(resolved.rows, [{ id: VERSION_ID, style_profile_hash: PROFILE_HASH }]);
      } finally {
        await executor.query("SELECT set_config($1, '', false)", [TENANT_PRINCIPAL_SETTING]);
      }
    }
    for (const [table, id] of [
      ["image_styles", STYLE_ID],
      ["image_style_versions", VERSION_ID],
    ]) {
      await expectDatabaseError(
        executor.query(`UPDATE ${table} SET updated_at = now() WHERE id = $1`, [id]),
        table === "image_style_versions" ? ["23514", "55000"] : "55000",
      );
      await expectDatabaseError(
        executor.query(`DELETE FROM ${table} WHERE id = $1`, [id]),
        table === "image_style_versions" ? ["23514", "55000"] : "55000",
      );
    }
    const after = await oldRows(executor);
    after.image_styles = after.image_styles.filter(({ row }) => row.id !== STYLE_ID);
    after.image_style_versions = after.image_style_versions.filter(
      ({ row }) => row.id !== VERSION_ID,
    );
    assert.deepEqual(
      after,
      before,
      "all existing preset bytes and project revision pins stay unchanged",
    );
    assert.equal(
      (await executor.query(`SELECT max(version) AS version FROM videoforge_schema_migrations`))
        .rows[0].version,
      239,
    );
  } finally {
    await database.close();
  }
});

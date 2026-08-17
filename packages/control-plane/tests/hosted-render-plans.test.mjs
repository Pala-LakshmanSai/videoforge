import assert from "node:assert/strict";
import test from "node:test";

import { HASHES, IDS, seedLockedProjects } from "./support/fixtures.mjs";
import { expectDatabaseError, sha256, withMigratedDatabase } from "./support/pglite.mjs";

const PLAN_SCHEMA = "videoforge-hosted-cpu-submission/v1";

function planPayload(projectId, revisionId) {
  return {
    schema_version: PLAN_SCHEMA,
    idempotency_key: "owned-render-plan-test-0001",
    project_id: projectId,
    project_revision_id: revisionId,
    kind: "RENDER",
    input_document: {
      schema_version: "render-job-input/v1",
      project_revision_id: revisionId,
    },
    objects: [
      {
        artifact_receipt_id: "00000000-0000-4000-8000-000000000901",
        uri: `vf-local://objects/sha256/aa/${"a".repeat(64)}.json`,
      },
    ],
  };
}

test("hosted render plans are tenant-bound, exact-revision, and append-only", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedLockedProjects(executor);
    const payload = planPayload(IDS.projectA, IDS.revisionA);

    await executor.query(
      `INSERT INTO hosted_render_plans (
         account_id, workspace_id, project_id, project_revision_id,
         schema_version, payload, payload_sha256, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$8)`,
      [
        IDS.accountA,
        IDS.workspaceA,
        IDS.projectA,
        IDS.revisionA,
        PLAN_SCHEMA,
        JSON.stringify(payload),
        sha256("hosted-render-plan-a"),
        "2026-08-17T10:00:00.000Z",
      ],
    );

    const stored = await executor.query(
      `SELECT account_id, workspace_id, project_id, project_revision_id,
              schema_version, payload, payload_sha256
         FROM hosted_render_plans`,
    );
    assert.equal(stored.rows.length, 1);
    assert.equal(stored.rows[0].account_id, IDS.accountA);
    assert.equal(stored.rows[0].project_revision_id, IDS.revisionA);
    assert.equal(stored.rows[0].schema_version, PLAN_SCHEMA);
    assert.deepEqual(stored.rows[0].payload, payload);

    await expectDatabaseError(
      () =>
        executor.query(
          `UPDATE hosted_render_plans
              SET payload_sha256 = $1
            WHERE account_id = $2 AND workspace_id = $3
              AND project_id = $4 AND project_revision_id = $5`,
          [
            sha256("hosted-render-plan-mutated"),
            IDS.accountA,
            IDS.workspaceA,
            IDS.projectA,
            IDS.revisionA,
          ],
        ),
      "55000",
    );
    await expectDatabaseError(
      () =>
        executor.query(
          `DELETE FROM hosted_render_plans
            WHERE account_id = $1 AND workspace_id = $2
              AND project_id = $3 AND project_revision_id = $4`,
          [IDS.accountA, IDS.workspaceA, IDS.projectA, IDS.revisionA],
        ),
      "55000",
    );

    const wrongRevisionPayload = planPayload(IDS.projectA, IDS.revisionB);
    await expectDatabaseError(
      () =>
        executor.query(
          `INSERT INTO hosted_render_plans (
             account_id, workspace_id, project_id, project_revision_id,
             schema_version, payload, payload_sha256
           ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
          [
            IDS.accountA,
            IDS.workspaceA,
            IDS.projectA,
            IDS.revisionB,
            PLAN_SCHEMA,
            JSON.stringify(wrongRevisionPayload),
            sha256("hosted-render-plan-wrong-revision"),
          ],
        ),
      ["23503", "23514"],
    );

    const mismatchedPayload = planPayload(IDS.projectA, IDS.revisionA);
    mismatchedPayload.project_id = IDS.projectB;
    await expectDatabaseError(
      () =>
        executor.query(
          `INSERT INTO hosted_render_plans (
             account_id, workspace_id, project_id, project_revision_id,
             schema_version, payload, payload_sha256
           ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
          [
            IDS.accountA,
            IDS.workspaceA,
            IDS.projectA,
            IDS.revisionA,
            PLAN_SCHEMA,
            JSON.stringify(mismatchedPayload),
            sha256("hosted-render-plan-mismatched-payload"),
          ],
        ),
      "23514",
    );
  });
});

test("hosted render plan storage does not weaken the revision config hash boundary", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedLockedProjects(executor);
    const revision = await executor.query(
      `SELECT revision_config_payload, revision_config_hash
         FROM project_revisions
        WHERE id = $1`,
      [IDS.revisionA],
    );
    assert.deepEqual(revision.rows, [
      {
        revision_config_payload: { source: "owned-synthetic" },
        revision_config_hash: HASHES.revisionA,
      },
    ]);
    assert.deepEqual(
      (
        await executor.query(
          `SELECT count(*)::int AS count FROM hosted_render_plans
            WHERE project_revision_id = $1`,
          [IDS.revisionA],
        )
      ).rows,
      [{ count: 0 }],
    );
  });
});

import assert from "node:assert/strict";
import test from "node:test";

import { TENANT_PRINCIPAL_SETTING } from "../dist/src/index.js";
import { IDS, seedLockedProjects } from "./support/fixtures.mjs";
import { withMigratedDatabase } from "./support/pglite.mjs";

async function asPrincipal(executor, accountId) {
  await executor.query(`SELECT set_config($1, $2, false)`, [TENANT_PRINCIPAL_SETTING, accountId]);
}

async function archive(executor, accountId, workspaceId, projectId) {
  const result = await executor.query(
    `SELECT * FROM public.videoforge_archive_hosted_project($1, $2, $3)`,
    [accountId, workspaceId, projectId],
  );
  return result.rows[0] ?? null;
}

test("0057 archives one owned inactive project and preserves immutable lineage", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedLockedProjects(executor);
    await asPrincipal(executor, IDS.accountA);

    const archived = await archive(executor, IDS.accountA, IDS.workspaceA, IDS.projectA);
    assert.deepEqual(archived, {
      project_id: IDS.projectA,
      state: "ARCHIVED",
      retained_attempt_count: 0,
    });

    const project = await executor.query(
      `SELECT status, archived_at, version FROM projects WHERE id = $1`,
      [IDS.projectA],
    );
    assert.equal(project.rows[0].status, "ARCHIVED");
    assert.ok(project.rows[0].archived_at);
    assert.equal(project.rows[0].version, 2);
    assert.equal(
      (
        await executor.query(
          `SELECT count(*)::int AS count FROM project_revisions WHERE project_id=$1`,
          [IDS.projectA],
        )
      ).rows[0].count,
      1,
    );

    const replay = await archive(executor, IDS.accountA, IDS.workspaceA, IDS.projectA);
    assert.equal(replay.state, "ARCHIVED");
    assert.equal(replay.retained_attempt_count, 0);

    assert.equal(await archive(executor, IDS.accountA, IDS.workspaceA, IDS.projectB), null);
  });
});

import assert from "node:assert/strict";
import test from "node:test";

import { RESERVED_SYSTEM_USER_ID, TENANT_PRINCIPAL_SETTING } from "../dist/src/index.js";
import { IDS, seedLockedProjects } from "./support/fixtures.mjs";
import { expectDatabaseError, withMigratedDatabase } from "./support/pglite.mjs";

async function asPrincipal(executor, accountId) {
  await executor.query(`SELECT set_config($1, $2, false)`, [TENANT_PRINCIPAL_SETTING, accountId]);
}

async function archive(executor, accountId, workspaceId, kind, presetId) {
  const result = await executor.query(
    `SELECT * FROM public.videoforge_archive_hosted_preset($1, $2, $3, $4)`,
    [accountId, workspaceId, kind, presetId],
  );
  return result.rows[0] ?? null;
}

test("0051 archives owned presets by parent or version id and preserves lineage", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedLockedProjects(executor);
    await asPrincipal(executor, IDS.accountA);

    const avatar = await archive(
      executor,
      IDS.accountA,
      IDS.workspaceA,
      "AVATAR",
      IDS.avatarProfileA,
    );
    assert.deepEqual(avatar, {
      preset_kind: "AVATAR",
      preset_id: IDS.avatarProfileA,
      version_id: IDS.avatarVersionA,
      state: "ARCHIVED",
      referenced_revision_count: 1,
    });
    const avatarParent = await executor.query(
      `SELECT status, archived_at FROM avatar_profiles WHERE id = $1`,
      [IDS.avatarProfileA],
    );
    assert.equal(avatarParent.rows[0].status, "ARCHIVED");
    assert.ok(avatarParent.rows[0].archived_at);
    assert.equal(
      (
        await executor.query(
          `SELECT count(*)::int AS count FROM project_revisions WHERE avatar_profile_id = $1`,
          [IDS.avatarProfileA],
        )
      ).rows[0].count,
      1,
    );

    const replay = await archive(
      executor,
      IDS.accountA,
      IDS.workspaceA,
      "AVATAR",
      IDS.avatarVersionA,
    );
    assert.equal(replay.state, "ARCHIVED");
    assert.equal(replay.referenced_revision_count, 1);

    const style = await archive(
      executor,
      IDS.accountA,
      IDS.workspaceA,
      "IMAGE_STYLE",
      IDS.styleVersionA,
    );
    assert.deepEqual(style, {
      preset_kind: "IMAGE_STYLE",
      preset_id: IDS.styleA,
      version_id: IDS.styleVersionA,
      state: "ARCHIVED",
      referenced_revision_count: 1,
    });

    // A private preset in another workspace is indistinguishable from a missing id.
    assert.equal(
      await archive(executor, IDS.accountA, IDS.workspaceA, "AVATAR", IDS.avatarProfileB),
      null,
    );

    // Built-ins remain immutable even though they are globally readable.  Clear the tenant
    // setting only to seed the reserved SYSTEM row, then restore the user principal.
    await executor.query(`SELECT set_config($1, '', false)`, [TENANT_PRINCIPAL_SETTING]);
    const builtinStyle = "00000000-0000-4000-8000-000000970050";
    await executor.query(
      `INSERT INTO image_styles (
         id, workspace_id, scope_kind, created_by_user_id, name, normalized_name, status
       ) VALUES ($1, 'ffffffff-ffff-4fff-8fff-000000000011', 'SYSTEM', $2,
                 'documentary_stock_v1', 'documentary_stock_v1', 'ACTIVE')`,
      [builtinStyle, RESERVED_SYSTEM_USER_ID],
    );
    await asPrincipal(executor, IDS.accountA);
    await expectDatabaseError(
      () => archive(executor, IDS.accountA, IDS.workspaceA, "IMAGE_STYLE", builtinStyle),
      "55000",
    );
  });
});

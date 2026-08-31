import assert from "node:assert/strict";
import test from "node:test";

import { TENANT_PRINCIPAL_SETTING } from "../dist/src/index.js";
import { IDS, seedLockedProjects } from "./support/fixtures.mjs";
import { withMigratedDatabase } from "./support/pglite.mjs";

test("0053 hides revoked media workers without deleting lineage and permits re-enrollment", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedLockedProjects(executor);
    await executor.query(`SELECT set_config($1, $2, false)`, [
      TENANT_PRINCIPAL_SETTING,
      IDS.accountA,
    ]);
    const enrollmentId = "00000000-0000-4000-8000-000000530001";
    const deviceId = "00000000-0000-4000-8000-000000530002";
    await executor.query(
      `INSERT INTO media_worker_enrollments (
         id, display_name, platform, architecture, worker_version, protocol_version,
         execution_bundle_sha256, installation_id, pkce_challenge, poll_token_sha256,
         credential_token_sha256, state, account_id, workspace_id, expires_at,
         approved_at, consumed_at
       ) VALUES ($1, 'Old Mac', 'MACOS', 'AARCH64', '0.1.11', 1, $2, $3, $4, $5,
                 $6, 'CONSUMED', $7, $8, now() + interval '1 hour', now(), now())`,
      [
        enrollmentId,
        `sha256:${"a".repeat(64)}`,
        "00000000-0000-4000-8000-000000530003",
        "p".repeat(43),
        `sha256:${"b".repeat(64)}`,
        `sha256:${"c".repeat(64)}`,
        IDS.accountA,
        IDS.workspaceA,
      ],
    );
    await executor.query(
      `INSERT INTO media_worker_devices (
         id, account_id, workspace_id, enrollment_id, display_name, platform, architecture,
         worker_version, protocol_version, execution_bundle_sha256, installation_id,
         credential_token_sha256, status, revoked_at
       ) VALUES ($1,$2,$3,$4,'Old Mac','MACOS','AARCH64','0.1.11',1,$5,$6,$7,'REVOKED',now())`,
      [
        deviceId,
        IDS.accountA,
        IDS.workspaceA,
        enrollmentId,
        `sha256:${"a".repeat(64)}`,
        "00000000-0000-4000-8000-000000530003",
        `sha256:${"c".repeat(64)}`,
      ],
    );

    await executor.query(
      `UPDATE media_worker_devices SET removed_at = now() WHERE id = $1 AND status = 'REVOKED'`,
      [deviceId],
    );
    const hidden = await executor.query(
      `SELECT count(*)::int AS count FROM media_worker_devices
        WHERE id = $1 AND removed_at IS NULL`,
      [deviceId],
    );
    assert.equal(hidden.rows[0].count, 0);
    assert.equal(
      (
        await executor.query(
          `SELECT count(*)::int AS count FROM media_worker_devices WHERE id = $1`,
          [deviceId],
        )
      ).rows[0].count,
      1,
    );

    await executor.query(
      `UPDATE media_worker_devices
          SET status = 'OFFLINE', revoked_at = NULL, removed_at = NULL, updated_at = now()
        WHERE id = $1`,
      [deviceId],
    );
    const restored = await executor.query(
      `SELECT status, removed_at FROM media_worker_devices WHERE id = $1`,
      [deviceId],
    );
    assert.deepEqual(restored.rows[0], { status: "OFFLINE", removed_at: null });
  });
});

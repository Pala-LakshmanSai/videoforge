import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workerUrl = new URL(
  "../../../apps/web/src/server/hosted/personal-worker.ts",
  import.meta.url,
);
const workerMigrationUrl = new URL(
  "../migrations/0032_v2_06_personal_media_workers.sql",
  import.meta.url,
);

test("personal-worker claims are account-scoped and do not take a global worker lock", async () => {
  const [worker, migration] = await Promise.all([
    readFile(workerUrl, "utf8"),
    readFile(workerMigrationUrl, "utf8"),
  ]);

  const claimStart = worker.indexOf("const attempt = await transaction.query<ClaimedAttempt>");
  const claimEnd = worker.indexOf("const row = attempt.rows[0];", claimStart);
  assert.ok(claimStart >= 0 && claimEnd > claimStart, "personal-worker claim query must exist");
  const claimQuery = worker.slice(claimStart, claimEnd);
  assert.match(claimQuery, /account_id = \$1 AND workspace_id = \$2/u);
  assert.match(claimQuery, /LIMIT 1 FOR UPDATE SKIP LOCKED/u);
  assert.doesNotMatch(claimQuery, /global_generation_capacity|provider_workload_leases|advisory_xact_lock/u);

  // Device and attempt ownership are composite tenant keys. Two accounts (and multiple devices in
  // one account) therefore have independent render leases while duplicate claims remain fenced.
  assert.match(
    migration,
    /CREATE UNIQUE INDEX media_worker_leases_active_attempt_uq[\s\S]*?ON media_worker_leases \(account_id, workspace_id, attempt_id\)/u,
  );
  assert.match(
    migration,
    /CREATE UNIQUE INDEX media_worker_leases_active_device_uq[\s\S]*?ON media_worker_leases \(account_id, workspace_id, device_id\)/u,
  );
  assert.doesNotMatch(
    migration,
    /CREATE UNIQUE INDEX media_worker_leases_active_(?:attempt|device)_uq[\s\S]*?ON media_worker_leases \((?:attempt_id|device_id)\)/u,
  );
});

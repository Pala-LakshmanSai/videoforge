import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("span batches preserve singleton exclusion, four-member scope, and individual attempts", async () => {
  const db = new PGlite();
  const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  try {
    await db.exec(`
      CREATE FUNCTION videoforge_current_account_id() RETURNS uuid LANGUAGE sql AS
        $$SELECT current_setting('videoforge.account_id')::uuid$$;
      CREATE TABLE media_worker_devices(id uuid PRIMARY KEY,account_id uuid,workspace_id uuid);
      CREATE TABLE hosted_cpu_job_attempts(id uuid PRIMARY KEY,account_id uuid,workspace_id uuid,
        project_id uuid,project_revision_id uuid,kind text,execution_backend text);
      CREATE TABLE media_worker_leases(id uuid PRIMARY KEY,account_id uuid,workspace_id uuid,
        device_id uuid,attempt_id uuid,state text);
      CREATE UNIQUE INDEX media_worker_leases_active_attempt_uq
        ON media_worker_leases(account_id,workspace_id,attempt_id)
        WHERE state IN ('CLAIMED','RUNNING','COMPLETING');
      CREATE UNIQUE INDEX media_worker_leases_active_device_uq
        ON media_worker_leases(account_id,workspace_id,device_id)
        WHERE state IN ('CLAIMED','RUNNING','COMPLETING');
    `);
    await db.query("SELECT set_config('videoforge.account_id',$1,false)", [id(1)]);
    await db.query("INSERT INTO media_worker_devices VALUES($1,$2,$3),($4,$2,$3)", [
      id(3),
      id(1),
      id(2),
      id(4),
    ]);
    for (let n = 10; n <= 20; n++)
      await db.query(
        "INSERT INTO hosted_cpu_job_attempts VALUES($1,$2,$3,$4,$5,$6,'PERSONAL_WORKER')",
        [
          id(n),
          id(1),
          id(2),
          id(n === 19 ? 99 : 5),
          id(n === 18 ? 99 : 6),
          n === 20 ? "RENDER" : "SPAN_AUDIO",
        ],
      );
    // Existing active singleton survives the migration and remains exclusive.
    await db.query("INSERT INTO media_worker_leases VALUES($1,$2,$3,$4,$5,'RUNNING')", [
      id(30),
      id(1),
      id(2),
      id(3),
      id(20),
    ]);
    const migration = await readFile(
      new URL("../migrations/0145_hosted_span_audio_batch_leases.sql", import.meta.url),
      "utf8",
    );
    await db.exec(`BEGIN; ${migration} ROLLBACK;`);
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int AS count FROM information_schema.columns WHERE table_name='media_worker_leases' AND column_name='span_batch_id'",
        )
      ).rows[0].count,
      0,
    );
    assert.ok(
      (await db.query("SELECT to_regclass('media_worker_leases_active_device_uq') AS name")).rows[0]
        .name,
    );
    await db.exec(migration);
    await db.exec(
      await readFile(
        new URL(
          "../migrations/0146_hosted_span_audio_lease_update_lock_order.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const insert = (lease, attempt, batch, device = 3, account = 1) =>
      db.query("INSERT INTO media_worker_leases VALUES($1,$2,$3,$4,$5,'CLAIMED',$6)", [
        id(lease),
        id(account),
        id(2),
        id(device),
        id(attempt),
        batch === null ? null : id(batch),
      ]);
    await assert.rejects(insert(31, 10, 50), /active work group/);
    assert.equal(
      (await db.query("SELECT state,span_batch_id FROM media_worker_leases WHERE id=$1", [id(30)]))
        .rows[0].state,
      "RUNNING",
    );
    await db.query("UPDATE media_worker_leases SET state='SUCCEEDED' WHERE id=$1", [id(30)]);
    await insert(31, 10, 50);
    await assert.rejects(insert(35, 19, 50), /scope or size/);
    await assert.rejects(insert(35, 18, 50), /scope or size/);
    await assert.rejects(insert(35, 14, 50, 4), /scope or size/);
    for (let n = 1; n < 4; n++) await insert(31 + n, 10 + n, 50);
    await assert.rejects(insert(35, 14, 50), /scope or size/);
    await assert.rejects(insert(35, 14, 51), /active work group/);
    await assert.rejects(insert(35, 14, null), /active work group/);
    await assert.rejects(insert(35, 19, 50, 4), /scope or size/);
    await assert.rejects(insert(35, 20, 51, 4), /only personal audio spans/);
    await assert.rejects(insert(35, 14, 51, 4, 9), /tenant mismatch/);
    await assert.rejects(
      db.query("UPDATE media_worker_leases SET span_batch_id=$1 WHERE id=$2", [id(51), id(31)]),
      /identity is immutable/,
    );
    await db.query("UPDATE media_worker_leases SET state='SUCCEEDED' WHERE span_batch_id=$1", [
      id(50),
    ]);
    await assert.rejects(insert(35, 14, 50), /scope or size/);
    await insert(35, 14, 51);
    await assert.rejects(
      db.query("UPDATE media_worker_leases SET state='CLAIMED' WHERE id=$1", [id(31)]),
      /active work group/,
    );
    await db.query("UPDATE media_worker_leases SET state='CANCELLED' WHERE id=$1", [id(31)]);
    await db.query("UPDATE media_worker_leases SET state='RUNNING' WHERE id=$1", [id(35)]);
    await assert.rejects(insert(36, 14, 51), /media_worker_leases_active_attempt_uq/);
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int AS count FROM media_worker_leases WHERE span_batch_id=$1",
          [id(50)],
        )
      ).rows[0].count,
      4,
    );
  } finally {
    await db.close();
  }
});

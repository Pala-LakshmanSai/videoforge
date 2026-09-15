import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("polled progress binds the exact assignment, deduplicates, and preserves attempt state", async () => {
  const db = new PGlite();
  const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  try {
    // Only the referenced row fields; retain the production exact-assignment FK and sequence key.
    await db.exec(`CREATE FUNCTION public.videoforge_current_account_id() RETURNS uuid LANGUAGE sql AS
      $$SELECT current_setting('videoforge.account_id')::uuid$$;
      CREATE FUNCTION public.videoforge_inspect_hosted_pair_runtime(uuid,uuid,uuid) RETURNS boolean
        LANGUAGE sql AS $$SELECT true$$;
      CREATE TABLE public.serverless_attempts(id uuid PRIMARY KEY,account_id uuid,workspace_id uuid,
        generation_request_id uuid,lane text,project_revision_id uuid,state text,item_count integer);
      CREATE TABLE public.serverless_provider_assignments(id uuid PRIMARY KEY,account_id uuid,
        workspace_id uuid,attempt_id uuid,provider_job_id text,is_current boolean,
        UNIQUE(account_id,workspace_id,attempt_id,id));
      CREATE TABLE public.serverless_progress_events(id uuid PRIMARY KEY,account_id uuid,workspace_id uuid,
        project_revision_id uuid,attempt_id uuid,assignment_id uuid,sequence bigint,advisory_source text,
        authoritative boolean,provider_status text,attempt_state text,items_completed integer,
        items_total integer,observed_at timestamptz,created_at timestamptz,
        UNIQUE(attempt_id,sequence),FOREIGN KEY(account_id,workspace_id,attempt_id,assignment_id)
        REFERENCES public.serverless_provider_assignments(account_id,workspace_id,attempt_id,id));`);
    await db.exec(await readFile(new URL("../migrations/0142_hosted_pair_polled_progress.sql", import.meta.url), "utf8"));
    await db.query("SELECT set_config('videoforge.account_id',$1,false)", [id(1)]);
    await db.query("INSERT INTO serverless_attempts VALUES($1,$2,$3,$4,'mage_image',$5,'ASSIGNED',207)", [id(4), id(1), id(2), id(3), id(5)]);
    await db.query("INSERT INTO serverless_provider_assignments VALUES($1,$2,$3,$4,'exact-job',true)", [id(6), id(1), id(2), id(4)]);
    const record = (status, job = "exact-job", account = id(1)) => db.query(
      "SELECT public.videoforge_record_hosted_pair_progress($1,$2,$3,$4,'mage_image',$5,$6) AS recorded",
      [account, id(2), id(3), id(4), job, status]);
    assert.equal((await record("IN_QUEUE")).rows[0].recorded, true);
    assert.equal((await record("IN_QUEUE")).rows[0].recorded, false);
    assert.equal((await record("IN_PROGRESS")).rows[0].recorded, true);
    await assert.rejects(record("IN_PROGRESS", "different-job"), /PROGRESS_ASSIGNMENT_INVALID/);
    await assert.rejects(record("IN_PROGRESS", "exact-job", id(9)), /PROGRESS_SCOPE_INVALID/);
    await assert.rejects(record("COMPLETED"), /PROGRESS_SCOPE_INVALID/);
    const events = await db.query("SELECT provider_status,items_completed,items_total,attempt_state,sequence FROM serverless_progress_events ORDER BY sequence");
    assert.deepEqual(events.rows.map((r) => [r.provider_status, r.items_completed, r.items_total, r.attempt_state, Number(r.sequence)]),
      [["IN_QUEUE", 0, 207, "ASSIGNED", 1], ["IN_PROGRESS", 0, 207, "ASSIGNED", 2]]);
    assert.equal((await db.query("SELECT state FROM serverless_attempts")).rows[0].state, "ASSIGNED");
  } finally {
    await db.close();
  }
});

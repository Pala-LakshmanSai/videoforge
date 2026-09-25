import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

import { IDS } from "./support/fixtures.mjs";
import { sha256, uuid } from "./support/pglite.mjs";

test("0202 records the exact recovered claim while reopening its original UNKNOWN run", async () => {
  const database = new PGlite();
  try {
    await database.exec(`
      CREATE TABLE hosted_prompt_runs (
        id uuid PRIMARY KEY, account_id uuid, workspace_id uuid, project_revision_id uuid,
        task_id uuid, attempt_id uuid, outbox_id uuid, state text, problem_code text,
        provider_may_have_charged boolean, acceptance_fingerprint_hash text,
        planned_batch_count integer, finished_at timestamptz
      );
      CREATE TABLE hosted_prompt_batch_claims (
        id uuid, account_id uuid, workspace_id uuid, run_id uuid, task_id uuid,
        attempt_id uuid, outbox_id uuid, batch_ordinal integer,
        provider_task_uuid text, request_bytes text, request_hash text
      );
      CREATE TABLE hosted_prompt_batch_progress (
        account_id uuid, workspace_id uuid, run_id uuid, batch_ordinal integer
      );
      CREATE TABLE attempts (
        workspace_id uuid, task_id uuid, id uuid, state text, dispatch_state text,
        claim_state text, problem_code text, finished_at timestamptz
      );
      CREATE TABLE generation_tasks (
        workspace_id uuid, id uuid, project_revision_id uuid, state text,
        version integer, finished_at timestamptz, updated_at timestamptz
      );
      CREATE FUNCTION videoforge_current_account_id() RETURNS uuid LANGUAGE sql STABLE AS
        $$ SELECT '${IDS.accountA}'::uuid $$;
      CREATE FUNCTION videoforge_record_hosted_prompt_batch(uuid,jsonb)
        RETURNS boolean LANGUAGE plpgsql AS $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM hosted_prompt_runs WHERE id=$1 AND state='DISPATCHING')
             OR $2->>'response_bytes' IS NULL THEN
            RAISE EXCEPTION 'recovered batch was not validated';
          END IF;
          INSERT INTO hosted_prompt_batch_progress(account_id,workspace_id,run_id,batch_ordinal)
          SELECT account_id,workspace_id,id,($2->>'batch_ordinal')::integer
            FROM hosted_prompt_runs WHERE id=$1;
          RETURN true;
        END $$;
    `);
    await database.exec(
      readFileSync(
        new URL("../migrations/0202_hosted_prompt_claimed_batch_recovery.sql", import.meta.url),
        "utf8",
      ),
    );
    const runId = uuid(202_001);
    const taskId = uuid(202_002);
    const attemptId = uuid(202_003);
    const outboxId = uuid(202_004);
    const taskUUID = uuid(202_005);
    const requestBytes = '{"taskType":"textInference"}';
    const payload = {
      batch_ordinal: 0,
      request_bytes: requestBytes,
      request_hash: sha256(requestBytes),
      response_bytes: '{"accepted":true}',
    };
    await database.query(
      `INSERT INTO hosted_prompt_runs VALUES
        ($1,$2,$3,$4,$5,$6,$7,'UNKNOWN','HOSTED_PROMPT_DISPATCH_TIMEOUT',true,NULL,32,now())`,
      [runId, IDS.accountA, IDS.workspaceA, IDS.revisionA, taskId, attemptId, outboxId],
    );
    await database.query(
      `INSERT INTO hosted_prompt_batch_claims VALUES
        ($1,$2,$3,$4,$5,$6,$7,0,$8,$9,$10)`,
      [uuid(202_006), IDS.accountA, IDS.workspaceA, runId, taskId, attemptId, outboxId,
        taskUUID, requestBytes, payload.request_hash],
    );
    await database.query(
      `INSERT INTO attempts VALUES
        ($1,$2,$3,'UNKNOWN','AMBIGUOUS','CLAIMED','HOSTED_PROMPT_DISPATCH_TIMEOUT',NULL)`,
      [IDS.workspaceA, taskId, attemptId],
    );
    await database.query(
      `INSERT INTO generation_tasks VALUES ($1,$2,$3,'FAILED',2,now(),now())`,
      [IDS.workspaceA, taskId, IDS.revisionA],
    );

    await assert.rejects(
      database.query(
        `SELECT videoforge_recover_hosted_prompt_batch($1,$2,$3::jsonb)`,
        [runId, uuid(202_099), JSON.stringify(payload)],
      ),
      /hosted prompt recovery claim is invalid/u,
    );
    assert.equal((await database.query(`SELECT state FROM hosted_prompt_runs WHERE id=$1`, [runId])).rows[0].state, "UNKNOWN");

    const recovered = await database.query(
      `SELECT videoforge_recover_hosted_prompt_batch($1,$2,$3::jsonb) AS recovered`,
      [runId, taskUUID, JSON.stringify(payload)],
    );
    assert.equal(recovered.rows[0].recovered, true);
    assert.deepEqual(
      (await database.query(`SELECT state,problem_code,provider_may_have_charged,finished_at FROM hosted_prompt_runs WHERE id=$1`, [runId])).rows[0],
      { state: "DISPATCHING", problem_code: null, provider_may_have_charged: false, finished_at: null },
    );
    assert.deepEqual(
      (await database.query(`SELECT state,dispatch_state,problem_code FROM attempts WHERE id=$1`, [attemptId])).rows[0],
      { state: "RUNNING", dispatch_state: "RECONCILED", problem_code: null },
    );
    assert.equal((await database.query(`SELECT state FROM generation_tasks WHERE id=$1`, [taskId])).rows[0].state, "RUNNING");
    assert.equal((await database.query(`SELECT count(*)::integer AS count FROM hosted_prompt_batch_progress WHERE run_id=$1`, [runId])).rows[0].count, 1);
  } finally {
    await database.close();
  }
});

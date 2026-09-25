import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

import { IDS } from "./support/fixtures.mjs";
import { uuid } from "./support/pglite.mjs";

const bytes = readFileSync(new URL("../migrations/0205_hosted_prompt_complete_recovery.sql", import.meta.url));

test("0205 reopens only a fully saved UNKNOWN run, preserving attempt, task, claims and reservation", async () => {
  const database = new PGlite();
  try {
    await database.exec(`
      CREATE ROLE videoforge_v209_runtime_dc9612d6;
      CREATE TABLE hosted_prompt_runs (
        id uuid PRIMARY KEY, account_id uuid, workspace_id uuid, project_id uuid,
        project_revision_id uuid, task_id uuid, attempt_id uuid, outbox_id uuid,
        state text, problem_code text, provider_may_have_charged boolean,
        acceptance_fingerprint_hash text, reported_cost_micro_usd bigint,
        planned_batch_count integer, planned_scene_count integer, batch_plan_hash text,
        reservation_cost_sequence integer, reserved_cost_micro_usd bigint,
        started_at timestamptz, finished_at timestamptz
      );
      CREATE TABLE hosted_prompt_batch_claims (
        id uuid, account_id uuid, workspace_id uuid, run_id uuid,
        task_id uuid, attempt_id uuid, outbox_id uuid,
        batch_ordinal integer, created_at timestamptz
      );
      CREATE TABLE hosted_prompt_batch_progress (
        id uuid, account_id uuid, workspace_id uuid, run_id uuid,
        claim_id uuid, batch_ordinal integer, first_scene_ordinal integer,
        scene_count integer, reported_cost_micro_usd bigint, created_at timestamptz
      );
      CREATE TABLE hosted_prompt_scene_progress (
        id uuid, account_id uuid, workspace_id uuid, run_id uuid,
        batch_progress_id uuid, scene_ordinal integer
      );
      CREATE TABLE attempts (
        workspace_id uuid, task_id uuid, id uuid, state text,
        dispatch_state text, claim_state text, problem_code text
      );
      CREATE TABLE generation_tasks (
        workspace_id uuid, id uuid, project_revision_id uuid, state text
      );
      CREATE TABLE cost_events (
        account_id uuid, workspace_id uuid, task_id uuid, attempt_id uuid,
        owner_type text, owner_id uuid, event_type text, sequence integer,
        amount_micro_usd bigint
      );
      CREATE TABLE prompt_executions (
        account_id uuid, workspace_id uuid, task_id uuid, attempt_id uuid, outbox_id uuid
      );
      CREATE TABLE hosted_voiceover_contexts (
        id uuid, account_id uuid, project_id uuid, state text, started_at timestamptz
      );
      CREATE FUNCTION videoforge_current_account_id() RETURNS uuid LANGUAGE sql STABLE AS
        $$ SELECT '${IDS.accountA}'::uuid $$;
      CREATE FUNCTION videoforge_fail_hosted_voiceover_context(uuid,text,text,boolean)
        RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
      CREATE FUNCTION videoforge_fail_hosted_prompt_run(uuid,text,text,boolean,integer)
        RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
      CREATE FUNCTION videoforge_complete_hosted_prompt_run(jsonb)
        RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
      REVOKE ALL ON FUNCTION videoforge_complete_hosted_prompt_run(jsonb) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION videoforge_complete_hosted_prompt_run(jsonb)
        TO videoforge_v209_runtime_dc9612d6;
    `);
    await database.exec(bytes.toString("utf8"));
    assert.equal((await database.query(
      `SELECT has_function_privilege('videoforge_v209_runtime_dc9612d6',
        'public.videoforge_reopen_complete_hosted_prompt_run(uuid)','EXECUTE') AS allowed`))
      .rows[0].allowed, true);

    const run = uuid(205_001);
    const task = uuid(205_002);
    const attempt = uuid(205_003);
    const outbox = uuid(205_004);
    const claim0 = uuid(205_005);
    const claim1 = uuid(205_006);
    const batch0 = uuid(205_007);
    const batch1 = uuid(205_008);
    await database.query(
      `INSERT INTO hosted_prompt_runs VALUES
       ($1,$2,$3,$4,$5,$6,$7,$8,'UNKNOWN','HOSTED_PROMPT_DISPATCH_TIMEOUT',true,
        NULL,3000,2,3,'sha256:plan',1,8000000,clock_timestamp()-interval '30 minutes',clock_timestamp())`,
      [run, IDS.accountA, IDS.workspaceA, IDS.projectA, IDS.revisionA, task, attempt, outbox],
    );
    await database.query(`INSERT INTO attempts VALUES
      ($1,$2,$3,'UNKNOWN','AMBIGUOUS','CLAIMED','HOSTED_PROMPT_DISPATCH_TIMEOUT')`,
    [IDS.workspaceA, task, attempt]);
    await database.query(`INSERT INTO generation_tasks VALUES ($1,$2,$3,'FAILED')`,
      [IDS.workspaceA, task, IDS.revisionA]);
    await database.query(`INSERT INTO cost_events VALUES
      ($1,$2,$3,$4,'PROJECT_REVISION',$5,'RESERVED',1,8000000)`,
      [IDS.accountA, IDS.workspaceA, task, attempt, IDS.revisionA]);
    for (const [claim, batch, ordinal, first, count] of [
      [claim0, batch0, 0, 0, 2], [claim1, batch1, 1, 2, 1],
    ]) {
      await database.query(`INSERT INTO hosted_prompt_batch_claims VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,clock_timestamp()-interval '20 minutes')`,
        [claim, IDS.accountA, IDS.workspaceA, run, task, attempt, outbox, ordinal]);
      await database.query(`INSERT INTO hosted_prompt_batch_progress VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,clock_timestamp()-interval '20 minutes')`,
        [batch, IDS.accountA, IDS.workspaceA, run, claim, ordinal, first, count, (ordinal + 1) * 1000]);
    }
    for (const [batch, ordinal] of [[batch0, 0], [batch0, 1]]) {
      await database.query(`INSERT INTO hosted_prompt_scene_progress VALUES
        ($1,$2,$3,$4,$5,$6)`,
        [uuid(205_100 + ordinal), IDS.accountA, IDS.workspaceA, run, batch, ordinal]);
    }
    await assert.rejects(
      database.query(`SELECT videoforge_reopen_complete_hosted_prompt_run($1)`, [run]),
      /complete recovery evidence is invalid/u,
    );
    await database.query(`INSERT INTO hosted_prompt_scene_progress VALUES
      ($1,$2,$3,$4,$5,2)`, [uuid(205_102), IDS.accountA, IDS.workspaceA, run, batch1]);

    await database.query(`INSERT INTO cost_events VALUES
      ($1,$2,$3,$4,'PROJECT_REVISION',$5,'SETTLED',2,1000)`,
      [IDS.accountA, IDS.workspaceA, task, attempt, IDS.revisionA]);
    await assert.rejects(
      database.query(`SELECT videoforge_reopen_complete_hosted_prompt_run($1)`, [run]),
      /complete recovery evidence is invalid/u,
    );
    await database.query(`DELETE FROM cost_events WHERE event_type='SETTLED'`);

    await assert.rejects(
      database.transaction(async (transaction) => {
        await transaction.query(`SELECT videoforge_reopen_complete_hosted_prompt_run($1)`, [run]);
        throw new Error("completion failed");
      }),
      /completion failed/u,
    );
    assert.equal((await database.query(`SELECT state FROM hosted_prompt_runs WHERE id=$1`, [run])).rows[0].state, "UNKNOWN");

    const reopened = await database.query(
      `SELECT videoforge_reopen_complete_hosted_prompt_run($1) AS reopened`, [run]);
    assert.equal(reopened.rows[0].reopened, true);
    assert.deepEqual((await database.query(
      `SELECT state,problem_code,provider_may_have_charged,finished_at FROM hosted_prompt_runs WHERE id=$1`,
      [run])).rows[0],
    { state: "DISPATCHING", problem_code: null, provider_may_have_charged: false, finished_at: null });
    assert.equal((await database.query(`SELECT state FROM attempts WHERE id=$1`, [attempt])).rows[0].state, "UNKNOWN");
    assert.equal((await database.query(`SELECT state FROM generation_tasks WHERE id=$1`, [task])).rows[0].state, "FAILED");
    assert.equal((await database.query(`SELECT count(*)::integer AS count FROM cost_events`)).rows[0].count, 1);
    const stale = await database.query(
      `SELECT videoforge_reconcile_stale_hosted_prompt_dispatches($1) AS result`, [IDS.projectA]);
    assert.equal(stale.rows[0].result.prompt_reconciled, 0);
  } finally {
    await database.close();
  }
});

test("0205 manifest hash and runtime grant match", () => {
  const manifest = JSON.parse(readFileSync(new URL("../migrations/manifest.json", import.meta.url), "utf8"));
  const entry = manifest.migrations.find((item) => item.version === 205);
  assert.deepEqual([entry?.name, entry?.filename], [
    "hosted_prompt_complete_recovery", "0205_hosted_prompt_complete_recovery.sql",
  ]);
  assert.equal(entry.sha256, `sha256:${createHash("sha256").update(bytes).digest("hex")}`);
  assert.match(readFileSync(new URL("../../../deploy/v2-06/neon-runtime-grants.sql", import.meta.url), "utf8"),
    /GRANT EXECUTE ON FUNCTION public\.videoforge_reopen_complete_hosted_prompt_run\(uuid\)/u);
});

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

import { TENANT_PRINCIPAL_SETTING } from "../dist/src/index.js";
import { IDS, seedLockedProjects } from "./support/fixtures.mjs";
import {
  expectDatabaseError,
  sha256,
  uuid,
  withPgcryptoMigratedDatabase,
} from "./support/pglite.mjs";

test("0201 keeps prompt runs with recent batch activity and fails them after 15 idle minutes", async () => {
  const migration = readFileSync(
    new URL("../migrations/0201_hosted_prompt_recent_activity_staleness.sql", import.meta.url),
    "utf8",
  );
  const manifest = JSON.parse(
    readFileSync(new URL("../migrations/manifest.json", import.meta.url), "utf8"),
  );
  const entry = manifest.migrations.at(-1);
  assert.equal(entry.version, 201);
  assert.equal(entry.filename, "0201_hosted_prompt_recent_activity_staleness.sql");
  assert.equal(
    entry.sha256,
    `sha256:${createHash("sha256").update(migration).digest("hex")}`,
  );

  const database = new PGlite();
  try {
    await database.exec(`
      CREATE TABLE hosted_voiceover_contexts (
        id uuid, account_id uuid, project_id uuid, state text, started_at timestamptz
      );
      CREATE TABLE hosted_prompt_runs (
        id uuid, account_id uuid, workspace_id uuid, project_id uuid, task_id uuid,
        attempt_id uuid, outbox_id uuid, state text, problem_code text,
        provider_may_have_charged boolean DEFAULT false, finished_at timestamptz,
        started_at timestamptz
      );
      CREATE TABLE hosted_prompt_batch_claims (
        id uuid, account_id uuid, workspace_id uuid, run_id uuid, task_id uuid,
        attempt_id uuid, outbox_id uuid, created_at timestamptz
      );
      CREATE TABLE hosted_prompt_batch_progress (
        account_id uuid, workspace_id uuid, run_id uuid, claim_id uuid, created_at timestamptz
      );
      CREATE FUNCTION videoforge_current_account_id() RETURNS uuid LANGUAGE sql STABLE AS
        $$ SELECT '${IDS.accountA}'::uuid $$;
      CREATE FUNCTION videoforge_fail_hosted_voiceover_context(uuid,text,text,boolean)
        RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
      CREATE FUNCTION videoforge_fail_hosted_prompt_run(uuid,text,text,boolean,integer)
        RETURNS boolean LANGUAGE plpgsql AS $$
        BEGIN
          UPDATE hosted_prompt_runs SET state=$2,problem_code=$3,
            provider_may_have_charged=$4,finished_at=clock_timestamp() WHERE id=$1;
          RETURN FOUND;
        END $$;
    `);
    await database.exec(migration);

    const runId = uuid(958_101);
    const claimId = uuid(958_102);
    const taskId = uuid(958_103);
    const attemptId = uuid(958_104);
    const outboxId = uuid(958_105);
    const projectId = IDS.projectA;
    await database.query(
      `INSERT INTO hosted_prompt_runs (
         id,account_id,workspace_id,project_id,task_id,attempt_id,outbox_id,state,started_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,'DISPATCHING',clock_timestamp()-interval '30 minutes')`,
      [runId, IDS.accountA, IDS.workspaceA, projectId, taskId, attemptId, outboxId],
    );
    await database.query(
      `INSERT INTO hosted_prompt_batch_claims (
         id,account_id,workspace_id,run_id,task_id,attempt_id,outbox_id,created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,clock_timestamp()-interval '1 minute')`,
      [claimId, IDS.accountA, IDS.workspaceA, runId, taskId, attemptId, outboxId],
    );

    const reconcile = async () =>
      database.query(
        `SELECT public.videoforge_reconcile_stale_hosted_prompt_dispatches($1) AS result`,
        [projectId],
      );
    const claimActive = await reconcile();
    assert.equal(claimActive.rows[0].result.prompt_reconciled, 0);

    await database.query(
      `UPDATE hosted_prompt_batch_claims SET created_at=clock_timestamp()-interval '20 minutes'
        WHERE id=$1`,
      [claimId],
    );
    await database.query(
      `INSERT INTO hosted_prompt_batch_progress (
         account_id,workspace_id,run_id,claim_id,created_at
       ) VALUES ($1,$2,$3,$4,clock_timestamp()-interval '1 minute')`,
      [IDS.accountA, IDS.workspaceA, runId, claimId],
    );
    const progressActive = await reconcile();
    assert.equal(progressActive.rows[0].result.prompt_reconciled, 0);

    await database.query(
      `UPDATE hosted_prompt_batch_progress SET created_at=clock_timestamp()-interval '20 minutes'
        WHERE run_id=$1`,
      [runId],
    );
    const stale = await reconcile();
    assert.deepEqual(stale.rows[0].result, {
      context_reconciled: 0,
      prompt_reconciled: 1,
      redispatched: false,
    });
    assert.deepEqual(
      (await database.query(`SELECT state,problem_code FROM hosted_prompt_runs WHERE id=$1`, [runId]))
        .rows[0],
      { state: "UNKNOWN", problem_code: "HOSTED_PROMPT_DISPATCH_TIMEOUT" },
    );
  } finally {
    await database.close();
  }
});

test("0058 preserves an UNKNOWN context claim and 0061 reconciles its original result exactly once", async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    await seedLockedProjects(executor);
    await executor.query(`SELECT set_config($1, $2, false)`, [
      TENANT_PRINCIPAL_SETTING,
      IDS.accountA,
    ]);
    const asrAttemptId = uuid(958_001);
    const artifactPrefix =
      `tenant/${IDS.accountA}/workspace/${IDS.workspaceA}/project/${IDS.projectA}` +
      `/revision/${IDS.revisionA}/lane/input/job/${asrAttemptId}/artifact`;
    await executor.query(
      `INSERT INTO hosted_cpu_job_attempts (
         id, account_id, workspace_id, project_id, project_revision_id, kind, state,
         request_sha256, job_spec_object_key, job_spec_content_length,
         job_spec_checksum_sha256, result_object_key, result_content_type, result_max_bytes,
         image_digest, callback_token_sha256, result_receipt_sha256, result_content_length,
         result_checksum_sha256, deadline_at, submitted_at, terminal_at, created_at, updated_at
       ) VALUES (
         $1,$2,$3,$4,$5,'ASR','SUCCEEDED',$6,$12,128,$7,
         $13,'application/json',4096,$8,$9,$10,256,$11,
         clock_timestamp()+interval '1 hour',clock_timestamp(),clock_timestamp(),
         clock_timestamp(),clock_timestamp()
       )`,
      [
        asrAttemptId,
        IDS.accountA,
        IDS.workspaceA,
        IDS.projectA,
        IDS.revisionA,
        sha256("context-request"),
        sha256("context-job-spec"),
        sha256("context-image"),
        sha256("context-callback"),
        sha256("context-receipt"),
        sha256("context-result"),
        `${artifactPrefix}/job-spec`,
        `${artifactPrefix}/result-document`,
      ],
    );
    const contextId = uuid(958_002);
    const taskId = uuid(958_003);
    const attemptId = uuid(958_004);
    const prepared = await executor.query(
      `SELECT public.videoforge_prepare_hosted_voiceover_context($1::jsonb) AS prepared`,
      [
        JSON.stringify({
          account_id: IDS.accountA,
          workspace_id: IDS.workspaceA,
          user_id: IDS.userA,
          project_id: IDS.projectA,
          revision_id: IDS.revisionA,
          asr_attempt_id: asrAttemptId,
          context_id: contextId,
          task_id: taskId,
          attempt_id: attemptId,
          outbox_id: uuid(958_005),
          execution_profile_id: uuid(958_006),
          reservation_cost_event_id: uuid(958_007),
          transcript_hash: sha256("context-transcript"),
          request_hash: sha256("context-provider-request"),
          claim_token_hash: sha256("context-claim"),
          reserved_cost_micro_usd: 10_000,
        }),
      ],
    );
    assert.equal(prepared.rows[0].prepared.created, true);

    await executor.query(
      `UPDATE hosted_voiceover_contexts
          SET started_at=clock_timestamp()-interval '4 minutes'
        WHERE id=$1`,
      [contextId],
    );
    const reconciled = await executor.query(
      `SELECT public.videoforge_reconcile_stale_hosted_prompt_dispatches($1) AS result`,
      [IDS.projectA],
    );
    assert.deepEqual(reconciled.rows[0].result, {
      context_reconciled: 1,
      prompt_reconciled: 0,
      redispatched: false,
    });

    const context = await executor.query(
      `SELECT state, problem_code, provider_may_have_charged, finished_at
         FROM hosted_voiceover_contexts WHERE id=$1`,
      [contextId],
    );
    assert.equal(context.rows[0].state, "UNKNOWN");
    assert.equal(context.rows[0].problem_code, "HOSTED_CONTEXT_DISPATCH_TIMEOUT");
    assert.equal(context.rows[0].provider_may_have_charged, true);
    assert.ok(context.rows[0].finished_at);
    assert.equal(
      (await executor.query(`SELECT state FROM attempts WHERE id=$1`, [attemptId])).rows[0].state,
      "UNKNOWN",
    );
    assert.equal(
      (await executor.query(`SELECT state FROM generation_tasks WHERE id=$1`, [taskId])).rows[0]
        .state,
      "FAILED",
    );
    const costEvents = await executor.query(
      `SELECT event_type, amount_micro_usd FROM cost_events WHERE attempt_id=$1 ORDER BY sequence`,
      [attemptId],
    );
    assert.deepEqual(costEvents.rows, [{ event_type: "RESERVED", amount_micro_usd: 10_000 }]);

    const replay = await executor.query(
      `SELECT public.videoforge_reconcile_stale_hosted_prompt_dispatches($1) AS result`,
      [IDS.projectA],
    );
    assert.deepEqual(replay.rows[0].result, {
      context_reconciled: 0,
      prompt_reconciled: 0,
      redispatched: false,
    });

    const durableCountsBefore = await executor.query(
      `SELECT
         (SELECT count(*) FROM generation_tasks WHERE project_revision_id=$1) AS tasks,
         (SELECT count(*) FROM attempts WHERE task_id=$2) AS attempts,
         (SELECT count(*) FROM outbox WHERE task_id=$2) AS outbox,
         (SELECT count(*) FROM cost_events WHERE task_id=$2 AND event_type='RESERVED') AS reservations`,
      [IDS.revisionA, taskId],
    );
    const contextBytes = JSON.stringify({
      primary_topic: "Recovered original context",
      summary: "The original provider result recovered after an ambiguous edge timeout.",
    });
    const responseBytes = JSON.stringify(JSON.parse(contextBytes));
    const outputAssetId = uuid(958_008);
    const reconciliationPayload = {
      account_id: IDS.accountA,
      workspace_id: IDS.workspaceA,
      user_id: IDS.userA,
      project_id: IDS.projectA,
      revision_id: IDS.revisionA,
      context_id: contextId,
      output_asset_id: outputAssetId,
      transcript_hash: sha256("context-transcript"),
      request_hash: sha256("context-provider-request"),
      response_bytes: responseBytes,
      response_hash: sha256(responseBytes),
      context_bytes: contextBytes,
      context_hash: sha256(contextBytes),
      reported_cost_micro_usd: 321,
    };
    await executor.query(`SELECT set_config($1, $2, false)`, [
      TENANT_PRINCIPAL_SETTING,
      IDS.accountB,
    ]);
    await expectDatabaseError(
      () =>
        executor.query(
          `SELECT public.videoforge_reconcile_unknown_hosted_voiceover_context($1::jsonb)`,
          [JSON.stringify(reconciliationPayload)],
        ),
      "42501",
    );
    await executor.query(`SELECT set_config($1, $2, false)`, [
      TENANT_PRINCIPAL_SETTING,
      IDS.accountA,
    ]);
    const accepted = await executor.query(
      `SELECT public.videoforge_reconcile_unknown_hosted_voiceover_context($1::jsonb) AS result`,
      [JSON.stringify(reconciliationPayload)],
    );
    assert.deepEqual(accepted.rows[0].result, {
      reconciled: true,
      replayed: false,
      context_id: contextId,
      task_id: taskId,
      attempt_id: attemptId,
      output_asset_id: outputAssetId,
    });
    const durableCountsAfter = await executor.query(
      `SELECT
         (SELECT count(*) FROM generation_tasks WHERE project_revision_id=$1) AS tasks,
         (SELECT count(*) FROM attempts WHERE task_id=$2) AS attempts,
         (SELECT count(*) FROM outbox WHERE task_id=$2) AS outbox,
         (SELECT count(*) FROM cost_events WHERE task_id=$2 AND event_type='RESERVED') AS reservations`,
      [IDS.revisionA, taskId],
    );
    assert.deepEqual(durableCountsAfter.rows, durableCountsBefore.rows);
    assert.deepEqual(
      (
        await executor.query(
          `SELECT state,provider_may_have_charged,problem_code,context_hash,response_hash,
                  reported_cost_micro_usd
             FROM hosted_voiceover_contexts WHERE id=$1`,
          [contextId],
        )
      ).rows[0],
      {
        state: "SUCCEEDED",
        provider_may_have_charged: false,
        problem_code: null,
        context_hash: sha256(contextBytes),
        response_hash: sha256(responseBytes),
        reported_cost_micro_usd: 321,
      },
    );
    assert.deepEqual(
      (
        await executor.query(
          `SELECT state,dispatch_state,result_disposition,output_asset_id,problem_code
             FROM attempts WHERE id=$1`,
          [attemptId],
        )
      ).rows[0],
      {
        state: "SUCCEEDED",
        dispatch_state: "RECONCILED",
        result_disposition: "ACCEPTED",
        output_asset_id: outputAssetId,
        problem_code: null,
      },
    );
    assert.deepEqual(
      (
        await executor.query(
          `SELECT event_type,amount_micro_usd FROM cost_events
            WHERE attempt_id=$1 ORDER BY sequence`,
          [attemptId],
        )
      ).rows,
      [
        { event_type: "RESERVED", amount_micro_usd: 10_000 },
        { event_type: "REPORTED", amount_micro_usd: 321 },
        { event_type: "SETTLED", amount_micro_usd: 321 },
        { event_type: "RELEASED", amount_micro_usd: 9_679 },
      ],
    );
    assert.equal(321 + 9_679, 10_000);

    const acceptedReplay = await executor.query(
      `SELECT public.videoforge_reconcile_unknown_hosted_voiceover_context($1::jsonb) AS result`,
      [JSON.stringify(reconciliationPayload)],
    );
    assert.equal(acceptedReplay.rows[0].result.reconciled, false);
    assert.equal(acceptedReplay.rows[0].result.replayed, true);
    await expectDatabaseError(
      () =>
        executor.query(
          `SELECT public.videoforge_reconcile_unknown_hosted_voiceover_context($1::jsonb)`,
          [
            JSON.stringify({
              ...reconciliationPayload,
              context_bytes: JSON.stringify({ primary_topic: "drift" }),
              context_hash: sha256(JSON.stringify({ primary_topic: "drift" })),
            }),
          ],
        ),
      "23514",
    );
  });
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { TENANT_PRINCIPAL_SETTING } from "../dist/src/index.js";
import { HASHES, IDS, seedLockedProjects } from "./support/fixtures.mjs";
import {
  expectDatabaseError,
  FIXED_TIME,
  sha256,
  uuid,
  withMigratedDatabase,
  withPgcryptoMigratedDatabase,
} from "./support/pglite.mjs";

const id = (serial) => uuid(serial);

test("0071 selects the newest project revision and its authoritative timing head", () => {
  const migration = readFileSync(
    new URL("../migrations/0071_hosted_prompt_adaptive_batches.sql", import.meta.url),
    "utf8",
  );
  const loader = migration.slice(
    migration.indexOf("CREATE OR REPLACE FUNCTION public.videoforge_load_hosted_prompt_plan"),
    migration.indexOf("CREATE FUNCTION public.videoforge_record_hosted_prompt_batch"),
  );
  assert.match(loader, /plan\.id=head\.current_timeline_plan_id/u);
  assert.match(loader, /WITH latest_revision AS/u);
  assert.match(loader, /ORDER BY revision\.revision_number DESC, revision\.id DESC/u);
  assert.match(loader, /FROM latest_revision revision/u);
});

export async function seedAdaptivePromptRun(
  executor,
  { sceneCount = 60, plannedBatchCount = 2, materializeRun = true, reservedMicroUsd = 40000 } = {},
) {
  await seedLockedProjects(executor);
  await executor.query(`SELECT set_config($1, $2, false)`, [
    TENANT_PRINCIPAL_SETTING,
    IDS.accountA,
  ]);

  const base = 971_000;
  const transcriptAssetId = id(base + 1);
  const timelineAssetId = id(base + 2);
  const transcriptId = id(base + 3);
  const timelineId = id(base + 4);
  const profileId = id(base + 5);
  const taskId = id(base + 6);
  const attemptId = id(base + 7);
  const outboxId = id(base + 8);
  const reservationId = id(base + 9);
  const runId = id(base + 10);
  const timelineHash = sha256(`adaptive-timeline-${sceneCount}`);
  const transcriptHash = sha256(`adaptive-transcript-${sceneCount}`);
  const inputHash = sha256(`adaptive-input-${sceneCount}`);
  const claimHash = sha256(`adaptive-claim-${sceneCount}`);

  await executor.query(
    `INSERT INTO assets (
       id, account_id, workspace_id, project_id, project_revision_id, kind, state,
       canonical_contract_name, canonical_contract_version, canonical_document_sha256,
       content_type, byte_size, verified_at, created_at
     ) VALUES
       ($1,$2,$3,$4,$5,'CANONICAL_DOCUMENT','VERIFIED','transcript-timing','v1',$6,
        'application/json',10,$7,$7),
       ($8,$2,$3,$4,$5,'CANONICAL_DOCUMENT','VERIFIED','timeline-plan','v1',$9,
        'application/json',10,$7,$7)`,
    [
      transcriptAssetId,
      IDS.accountA,
      IDS.workspaceA,
      IDS.projectA,
      IDS.revisionA,
      transcriptHash,
      FIXED_TIME,
      timelineAssetId,
      timelineHash,
    ],
  );
  await executor.transaction(async (timingExecutor) => {
    await timingExecutor.query(
      `INSERT INTO transcripts (
         id, account_id, workspace_id, project_revision_id, source_asset_id, state,
         model_name, model_hash, duration_ms, contract_name, contract_version,
         canonical_document_asset_id, canonical_document_hash, created_at, ready_at,
         lineage_contract_version, source_binary_sha256, engine_name, engine_version,
         language, transcription_config_hash, input_fingerprint_hash, idempotency_key
       ) VALUES ($1,$2,$3,$4,$5,'READY','fixture',$6,$14,'transcript-timing','v1',
         $7,$8,$9,$9,'timing-lineage/v1',$10,'fixture','1','en',$11,$12,$13)`,
      [
        transcriptId,
        IDS.accountA,
        IDS.workspaceA,
        IDS.revisionA,
        IDS.voiceoverA,
        sha256("adaptive-model"),
        transcriptAssetId,
        transcriptHash,
        FIXED_TIME,
        HASHES.voiceoverA,
        sha256("adaptive-config"),
        sha256("adaptive-transcript-input"),
        `adaptive-transcript-${sceneCount}`,
        sceneCount * 3000,
      ],
    );
    // The durable timing trigger validates a READY transcript at commit. Seed
    // a complete one-word-per-scene document so every timeline segment has
    // exact word, sentence, and phrase boundaries.
    for (let sceneIndex = 0; sceneIndex < sceneCount; sceneIndex += 1) {
      const startMs = sceneIndex * 3000;
      const endMs = (sceneIndex + 1) * 3000;
      const wordId = id(base + 20 + sceneIndex);
      const sentenceId = id(base + 1000 + sceneIndex);
      await timingExecutor.query(
        `INSERT INTO transcript_words (
           id, account_id, workspace_id, transcript_id, word_index, word,
           start_ms, end_ms_exclusive, confidence, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1,$9)`,
        [
          wordId,
          IDS.accountA,
          IDS.workspaceA,
          transcriptId,
          sceneIndex,
          `scene${sceneIndex}`,
          startMs,
          endMs,
          FIXED_TIME,
        ],
      );
      await timingExecutor.query(
        `INSERT INTO transcript_sentences (
           id, account_id, workspace_id, transcript_id, sentence_key, sentence_index,
           word_start, word_end_exclusive, start_ms, end_ms_exclusive, text, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          sentenceId,
          IDS.accountA,
          IDS.workspaceA,
          transcriptId,
          `sentence-${sceneIndex}`,
          sceneIndex,
          sceneIndex,
          sceneIndex + 1,
          startMs,
          endMs,
          `Narration ${sceneIndex}`,
          FIXED_TIME,
        ],
      );
      await timingExecutor.query(
        `INSERT INTO transcript_phrases (
           id, account_id, workspace_id, transcript_id, sentence_id, phrase_key,
           phrase_index, word_start, word_end_exclusive, start_ms, end_ms_exclusive,
           pause_before_ms, pause_after_ms, text, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,0,0,$12,$13)`,
        [
          id(base + 2000 + sceneIndex),
          IDS.accountA,
          IDS.workspaceA,
          transcriptId,
          sentenceId,
          `phrase-${sceneIndex}`,
          sceneIndex,
          sceneIndex,
          sceneIndex + 1,
          startMs,
          endMs,
          `Narration ${sceneIndex}`,
          FIXED_TIME,
        ],
      );
    }
  });
  await executor.transaction(async (timelineExecutor) => {
    await timelineExecutor.query(
      `INSERT INTO timeline_plans (
         id, account_id, workspace_id, project_revision_id, transcript_id, plan_sequence,
         revision_config_hash, transcript_document_hash, scheduler_version,
         scheduler_config_hash, seed, input_fingerprint_hash, contract_name, contract_version,
         canonical_document_asset_id, canonical_document_hash, output_fps_num, output_fps_den,
         total_frames, idempotency_key, created_by_user_id, created_at
       ) VALUES ($1,$2,$3,$4,$5,1,$6,$7,'adaptive-scheduler',$8,42,$9,'timeline-plan','v1',
         $10,$11,30,1,$12,'adaptive-plan',$13,$14)`,
      [
        timelineId,
        IDS.accountA,
        IDS.workspaceA,
        IDS.revisionA,
        transcriptId,
        HASHES.revisionA,
        transcriptHash,
        sha256("adaptive-scheduler-config"),
        sha256("adaptive-plan-input"),
        timelineAssetId,
        timelineHash,
        sceneCount * 90,
        IDS.userA,
        FIXED_TIME,
      ],
    );
    await timelineExecutor.query(
      `INSERT INTO revision_timing_heads (
         account_id, workspace_id, project_revision_id, version, current_transcript_id,
         current_timeline_plan_id, transcript_input_fingerprint_hash,
         timeline_input_fingerprint_hash, updated_at
       ) VALUES ($1,$2,$3,1,$4,$5,$6,$7,$8)`,
      [
        IDS.accountA,
        IDS.workspaceA,
        IDS.revisionA,
        transcriptId,
        timelineId,
        sha256("adaptive-transcript-input"),
        sha256("adaptive-plan-input"),
        FIXED_TIME,
      ],
    );
    for (let sceneIndex = 0; sceneIndex < sceneCount; sceneIndex += 1) {
      await timelineExecutor.query(
        `INSERT INTO timeline_segments (
           id, account_id, workspace_id, project_revision_id, timeline_plan_id, segment_key,
           segment_index, start_frame, end_frame_exclusive, source_audio_start_ms,
           source_audio_end_ms_exclusive, word_start, word_end_exclusive, timeline_composition,
           in_image_shot_role, narration, required_slots, timeline_plan_hash, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'IMAGE_FULL',
           'ENVIRONMENTAL_WIDE',$14,'{}'::jsonb,$15,$16)`,
        [
          id(base + 100 + sceneIndex),
          IDS.accountA,
          IDS.workspaceA,
          IDS.revisionA,
          timelineId,
          `scene-${String(sceneIndex).padStart(3, "0")}`,
          sceneIndex,
          sceneIndex * 90,
          (sceneIndex + 1) * 90,
          sceneIndex * 3000,
          (sceneIndex + 1) * 3000,
          sceneIndex,
          sceneIndex + 1,
          `Narration ${sceneIndex}`,
          timelineHash,
          FIXED_TIME,
        ],
      );
    }
  });

  if (!materializeRun) {
    return {
      sceneCount,
      profileId,
      taskId,
      attemptId,
      outboxId,
      runId,
      timelineId,
      inputHash,
      claimHash,
      timelineHash,
      batchPlanHash: sha256(`adaptive-batch-plan-${sceneCount}-${plannedBatchCount}`),
    };
  }

  const profileConfiguration = {
    model: "deepseek:v4@flash",
    operation: "scene-prompt-writer-v1",
    provider: "runware",
  };
  await executor.query(
    `INSERT INTO execution_profiles (
       id, account_id, workspace_id, name, revision, lane, state, dispatch_target,
       configuration, configuration_hash, maximum_rate_micro_usd, checked_at, created_at
     ) VALUES ($1,$2,$3,'Hosted Runware scene prompts',1,'PROMPT','TESTED','RUNWARE',
       $4::jsonb,'sha256:'||encode(digest(convert_to(($4::jsonb)::text,'UTF8'),'sha256'),'hex'),
       40000,$5,$5)`,
    [profileId, IDS.accountA, IDS.workspaceA, JSON.stringify(profileConfiguration), FIXED_TIME],
  );
  await executor.query(
    `INSERT INTO generation_tasks (
       id, account_id, workspace_id, owner_type, owner_id, project_revision_id, task_key,
       lane, state, required, depends_on, created_at, updated_at
     ) VALUES ($1,$2,$3,'PROJECT_REVISION',$4,$4,'prompt:scene-batch:1','PROMPT',
       'RUNNING',true,'[]'::jsonb,$5,$5)`,
    [taskId, IDS.accountA, IDS.workspaceA, IDS.revisionA, FIXED_TIME],
  );
  await executor.query(
    `INSERT INTO attempts (
       id, account_id, workspace_id, task_id, ordinal, idempotency_key, state,
       dispatch_state, claim_state, execution_profile_id, execution_claim_token_hash,
       input_hash, result_disposition, created_at, claimed_at, started_at
     ) VALUES ($1,$2,$3,$4,1,'adaptive-attempt','RUNNING','ACKNOWLEDGED','CLAIMED',
       $5,$6,$7,'PENDING',$8,$8,$8)`,
    [attemptId, IDS.accountA, IDS.workspaceA, taskId, profileId, claimHash, inputHash, FIXED_TIME],
  );
  await executor.query(
    `INSERT INTO outbox (
       id, account_id, workspace_id, task_id, attempt_id, kind, state, dedupe_key,
       payload_contract_name, payload_contract_version, payload_hash, payload,
       available_at, delivered_at, created_at, updated_at
     ) VALUES ($1,$2,$3,$4,$5,'DISPATCH','DELIVERED','adaptive-dispatch',
       'prompt-execution-dispatch','v1',$6,'{}'::jsonb,$7,$7,$7,$7)`,
    [
      outboxId,
      IDS.accountA,
      IDS.workspaceA,
      taskId,
      attemptId,
      sha256("adaptive-outbox"),
      FIXED_TIME,
    ],
  );
  await executor.query(
    `INSERT INTO cost_events (
       id, account_id, workspace_id, owner_type, owner_id, task_id, attempt_id, sequence,
       event_type, amount_micro_usd, idempotency_key, details, occurred_at, created_at
     ) VALUES ($1,$2,$3,'PROJECT_REVISION',$4,$5,$6,1,'RESERVED',$8,
       'adaptive-reserved','{}'::jsonb,$7,$7)`,
    [
      reservationId,
      IDS.accountA,
      IDS.workspaceA,
      IDS.revisionA,
      taskId,
      attemptId,
      FIXED_TIME,
      reservedMicroUsd,
    ],
  );
  await executor.query(
    `INSERT INTO hosted_prompt_runs (
       id, account_id, workspace_id, project_id, project_revision_id, timeline_plan_id,
       task_id, attempt_id, outbox_id, execution_profile_id, state, input_hash,
       claim_token_hash, reserved_cost_micro_usd, reservation_cost_sequence,
       planned_batch_count, planned_scene_count, batch_plan_hash, started_at, created_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'DISPATCHING',$11,$12,$17,1,$13,$14,$15,$16,$16)`,
    [
      runId,
      IDS.accountA,
      IDS.workspaceA,
      IDS.projectA,
      IDS.revisionA,
      timelineId,
      taskId,
      attemptId,
      outboxId,
      profileId,
      inputHash,
      claimHash,
      plannedBatchCount,
      sceneCount,
      sha256(`adaptive-batch-plan-${sceneCount}-${plannedBatchCount}`),
      FIXED_TIME,
      reservedMicroUsd,
    ],
  );
  return {
    sceneCount,
    runId,
    taskId,
    attemptId,
    timelineId,
    profileId,
    inputHash,
    claimHash,
    timelineHash,
    batchPlanHash: sha256(`adaptive-batch-plan-${sceneCount}-${plannedBatchCount}`),
  };
}

export async function seedSucceededVoiceoverContext(executor, base) {
  const asrAttemptId = id(base + 1);
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
      sha256(`prompt-v2-context-request-${base}`),
      sha256(`prompt-v2-context-job-spec-${base}`),
      sha256(`prompt-v2-context-image-${base}`),
      sha256(`prompt-v2-context-callback-${base}`),
      sha256(`prompt-v2-context-receipt-${base}`),
      sha256(`prompt-v2-context-result-${base}`),
      `${artifactPrefix}/job-spec`,
      `${artifactPrefix}/result-document`,
    ],
  );
  const supplied = {
    account_id: IDS.accountA,
    workspace_id: IDS.workspaceA,
    user_id: IDS.userA,
    project_id: IDS.projectA,
    revision_id: IDS.revisionA,
    asr_attempt_id: asrAttemptId,
    context_id: id(base + 2),
    task_id: id(base + 3),
    attempt_id: id(base + 4),
    outbox_id: id(base + 5),
    execution_profile_id: id(base + 6),
    reservation_cost_event_id: id(base + 7),
    transcript_hash: sha256(`prompt-v2-context-transcript-${base}`),
    request_hash: sha256(`prompt-v2-context-provider-request-${base}`),
    claim_token_hash: sha256(`prompt-v2-context-claim-${base}`),
    reserved_cost_micro_usd: 10_000,
  };
  await executor.query(`SELECT public.videoforge_prepare_hosted_voiceover_context($1::jsonb)`, [
    JSON.stringify(supplied),
  ]);
  const contextBytes = JSON.stringify({ story: `prompt-v2-context-${base}` });
  const responseBytes = JSON.stringify({ response: `prompt-v2-response-${base}` });
  await executor.query(`SELECT public.videoforge_complete_hosted_voiceover_context($1::jsonb)`, [
    JSON.stringify({
      context_id: supplied.context_id,
      output_asset_id: id(base + 8),
      context_bytes: contextBytes,
      context_hash: sha256(contextBytes),
      response_bytes: responseBytes,
      response_hash: sha256(responseBytes),
      reported_cost_micro_usd: 321,
    }),
  ]);
}

async function seedPromptCancellationOwner(executor, requestId, runtimeId) {
  await executor.query("SELECT set_config($1,$2,false)", [TENANT_PRINCIPAL_SETTING, IDS.accountA]);
  await executor.query(
    `INSERT INTO generation_requests(id,account_id,workspace_id,project_id,project_revision_id,
      created_by_user_id,state,queue_order,available_at,attempt_ordinal,idempotency_key,
      created_at,updated_at)
     VALUES($1,$2,$3,$4,$5,$6,'WAITING',1,transaction_timestamp(),1,$7,
      transaction_timestamp(),transaction_timestamp())`,
    [
      requestId,
      IDS.accountA,
      IDS.workspaceA,
      IDS.projectA,
      IDS.revisionA,
      IDS.userA,
      `prompt-cancel-race-${requestId}`,
    ],
  );
  await executor.query(
    `INSERT INTO video_runtime_states(id,account_id,workspace_id,project_id,project_revision_id,
      generation_request_id,stage,created_at,updated_at)
     VALUES($1,$2,$3,$4,$5,$6,'QUEUED',transaction_timestamp(),transaction_timestamp())`,
    [runtimeId, IDS.accountA, IDS.workspaceA, IDS.projectA, IDS.revisionA, requestId],
  );
  for (const [idValue, lane] of [
    [uuid(2_840_013), "mage_image"],
    [uuid(2_840_014), "soulx_avatar"],
  ]) {
    await executor.query(
      `INSERT INTO video_runtime_lane_states(id,account_id,workspace_id,runtime_id,
        project_revision_id,lane,state,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,'BLOCKED_ON_PREPARATION',transaction_timestamp(),
        transaction_timestamp())`,
      [idValue, IDS.accountA, IDS.workspaceA, runtimeId, IDS.revisionA, lane],
    );
  }
}

test("0284 defers owner cancellation while a prompt provider claim is unresolved", async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    const authority = await seedAdaptivePromptRun(executor, {
      sceneCount: 2,
      plannedBatchCount: 1,
    });
    const requestId = uuid(2_840_001);
    await seedPromptCancellationOwner(executor, requestId, uuid(2_840_002));
    const requestBytes = JSON.stringify([
      { taskType: "textInference", taskUUID: uuid(2_840_003), model: "deepseek:v4@flash" },
    ]);
    assert.equal(
      (
        await executor.query(
          `SELECT videoforge_claim_next_hosted_prompt_batch($1,0,$2,$3,$4) AS claimed`,
          [authority.runId, uuid(2_840_003), requestBytes, sha256(requestBytes)],
        )
      ).rows[0].claimed,
      true,
    );

    await expectDatabaseError(
      () =>
        executor.query(`SELECT * FROM videoforge_cancel_hosted_project_predispatch($1,$2,$3)`, [
          IDS.accountA,
          IDS.workspaceA,
          IDS.projectA,
        ]),
      "55000",
    );
    assert.deepEqual(
      (
        await executor.query(
          `SELECT request.state,run.state AS prompt_state,
                  (SELECT count(*)::integer FROM hosted_prompt_batch_claims claim
                    WHERE claim.run_id=run.id) AS claims
             FROM generation_requests request CROSS JOIN hosted_prompt_runs run
            WHERE request.id=$1 AND run.id=$2`,
          [requestId, authority.runId],
        )
      ).rows,
      [{ state: "WAITING", prompt_state: "DISPATCHING", claims: 1 }],
    );
  });
});

test("0284 rejects a prompt claim after its owning generation is cancelled", async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    const authority = await seedAdaptivePromptRun(executor, {
      sceneCount: 2,
      plannedBatchCount: 1,
    });
    const requestId = uuid(2_840_004);
    await seedPromptCancellationOwner(executor, requestId, uuid(2_840_005));
    const cancelled = await executor.query(
      `SELECT * FROM videoforge_cancel_hosted_project_predispatch($1,$2,$3)`,
      [IDS.accountA, IDS.workspaceA, IDS.projectA],
    );
    assert.equal(cancelled.rows[0].state, "CANCELLED");

    const requestBytes = JSON.stringify([
      { taskType: "textInference", taskUUID: uuid(2_840_006), model: "deepseek:v4@flash" },
    ]);
    await expectDatabaseError(
      () =>
        executor.query(`SELECT videoforge_claim_hosted_prompt_batch($1,0,$2,$3,$4)`, [
          authority.runId,
          uuid(2_840_006),
          requestBytes,
          sha256(requestBytes),
        ]),
      "55000",
    );
    assert.deepEqual(
      (
        await executor.query(
          `SELECT request.state,run.state AS prompt_state,
                  (SELECT count(*)::integer FROM hosted_prompt_batch_claims claim
                    WHERE claim.run_id=run.id) AS claims
             FROM generation_requests request CROSS JOIN hosted_prompt_runs run
            WHERE request.id=$1 AND run.id=$2`,
          [requestId, authority.runId],
        )
      ).rows,
      [{ state: "CANCELLED", prompt_state: "DISPATCHING", claims: 0 }],
    );
  });
});

test(
  "0284 serializes concurrent owner cancellation behind an in-flight PostgreSQL prompt claim",
  { skip: !process.env.VIDEOFORGE_TEST_POSTGRES_URL },
  async () => {
    await withMigratedDatabase(async ({ database, executor }) => {
      const authority = await seedAdaptivePromptRun(executor, {
        sceneCount: 2,
        plannedBatchCount: 1,
      });
      const requestId = uuid(2_840_007);
      await seedPromptCancellationOwner(executor, requestId, uuid(2_840_008));
      const requestBytes = JSON.stringify([
        { taskType: "textInference", taskUUID: uuid(2_840_009), model: "deepseek:v4@flash" },
      ]);
      const claimClient = await database.connect();
      const cancelClient = await database.connect();
      try {
        await claimClient.query("BEGIN");
        await claimClient.query("SELECT set_config($1,$2,true)", [
          TENANT_PRINCIPAL_SETTING,
          IDS.accountA,
        ]);
        const claimed = await claimClient.query(
          `SELECT videoforge_claim_next_hosted_prompt_batch($1,0,$2,$3,$4) AS claimed`,
          [authority.runId, uuid(2_840_009), requestBytes, sha256(requestBytes)],
        );
        assert.equal(claimed.rows[0].claimed, true);

        await cancelClient.query("BEGIN");
        await cancelClient.query("SELECT set_config($1,$2,true)", [
          TENANT_PRINCIPAL_SETTING,
          IDS.accountA,
        ]);
        const cancellation = cancelClient
          .query(`SELECT * FROM videoforge_cancel_hosted_project_predispatch($1,$2,$3)`, [
            IDS.accountA,
            IDS.workspaceA,
            IDS.projectA,
          ])
          .then(
            () => ({ returned: true }),
            (error) => ({ error }),
          );
        const premature = await Promise.race([
          cancellation,
          new Promise((resolve) => setTimeout(() => resolve(null), 100)),
        ]);
        assert.equal(premature, null, "cancellation must wait on the generation-request row");

        await claimClient.query("COMMIT");
        const result = await cancellation;
        assert.equal(result.error?.code, "55000");
        await cancelClient.query("ROLLBACK");
        const durable = await executor.query(
          `SELECT request.state,
                  (SELECT count(*)::integer FROM hosted_prompt_batch_claims claim
                    WHERE claim.run_id=$2) AS claims
             FROM generation_requests request WHERE request.id=$1`,
          [requestId, authority.runId],
        );
        assert.deepEqual(durable.rows, [{ state: "WAITING", claims: 1 }]);
      } finally {
        await claimClient.query("ROLLBACK").catch(() => {});
        await cancelClient.query("ROLLBACK").catch(() => {});
        claimClient.release();
        cancelClient.release();
      }
    });

    await withMigratedDatabase(async ({ database, executor }) => {
      const authority = await seedAdaptivePromptRun(executor, {
        sceneCount: 2,
        plannedBatchCount: 1,
      });
      const requestId = uuid(2_840_010);
      await seedPromptCancellationOwner(executor, requestId, uuid(2_840_011));
      const requestBytes = JSON.stringify([
        { taskType: "textInference", taskUUID: uuid(2_840_012), model: "deepseek:v4@flash" },
      ]);
      const cancelClient = await database.connect();
      const claimClient = await database.connect();
      try {
        await cancelClient.query("BEGIN");
        await cancelClient.query("SELECT set_config($1,$2,true)", [
          TENANT_PRINCIPAL_SETTING,
          IDS.accountA,
        ]);
        const cancelled = await cancelClient.query(
          `SELECT * FROM videoforge_cancel_hosted_project_predispatch($1,$2,$3)`,
          [IDS.accountA, IDS.workspaceA, IDS.projectA],
        );
        assert.equal(cancelled.rows[0].state, "CANCELLED");

        await claimClient.query("BEGIN");
        await claimClient.query("SELECT set_config($1,$2,true)", [
          TENANT_PRINCIPAL_SETTING,
          IDS.accountA,
        ]);
        const claim = claimClient
          .query(`SELECT videoforge_claim_next_hosted_prompt_batch($1,0,$2,$3,$4) AS claimed`, [
            authority.runId,
            uuid(2_840_012),
            requestBytes,
            sha256(requestBytes),
          ])
          .then(
            (result) => ({ result }),
            (error) => ({ error }),
          );
        const premature = await Promise.race([
          claim,
          new Promise((resolve) => setTimeout(() => resolve(null), 100)),
        ]);
        assert.equal(premature, null, "claim must wait on the cancellation's request-row lock");

        await cancelClient.query("COMMIT");
        const result = await claim;
        assert.equal(result.error?.code, "55000");
        await claimClient.query("ROLLBACK");
        const durable = await executor.query(
          `SELECT request.state,
                  (SELECT count(*)::integer FROM hosted_prompt_batch_claims claim
                    WHERE claim.run_id=$2) AS claims
             FROM generation_requests request WHERE request.id=$1`,
          [requestId, authority.runId],
        );
        assert.deepEqual(durable.rows, [{ state: "CANCELLED", claims: 0 }]);
      } finally {
        await cancelClient.query("ROLLBACK").catch(() => {});
        await claimClient.query("ROLLBACK").catch(() => {});
        cancelClient.release();
        claimClient.release();
      }
    });
  },
);

export function scenePayload(startOrdinal, count, { corruptAt = -1 } = {}) {
  return Array.from({ length: count }, (_, offset) => {
    const ordinal = startOrdinal + offset;
    const sceneId = `scene-${String(ordinal).padStart(3, "0")}`;
    const writerSceneId = offset === corruptAt ? `${sceneId}-drift` : sceneId;
    return {
      scene_ordinal: ordinal,
      scene_id: sceneId,
      writer_output: { scene_id: writerSceneId, prompt: `prompt-${ordinal}` },
      compiled_prompt: {
        sceneId,
        positivePrompt: `prompt-${ordinal}`,
        negativePrompt: `negative-${ordinal}`,
        positivePromptSha256: sha256(`prompt-${ordinal}`),
        negativePromptSha256: sha256(`negative-${ordinal}`),
      },
    };
  });
}

async function recordBatch(executor, runId, batchOrdinal, firstSceneOrdinal, count, cost, options) {
  const requestBytes = `request-${batchOrdinal}-${firstSceneOrdinal}`;
  const responseBytes = `response-${batchOrdinal}-${firstSceneOrdinal}`;
  return executor.query(
    `SELECT public.videoforge_record_hosted_prompt_batch($1,$2::jsonb) AS recorded`,
    [
      runId,
      JSON.stringify({
        batch_ordinal: batchOrdinal,
        first_scene_ordinal: firstSceneOrdinal,
        request_bytes: requestBytes,
        request_hash: sha256(requestBytes),
        response_bytes: responseBytes,
        response_hash: sha256(responseBytes),
        input_tokens: 100 + batchOrdinal,
        output_tokens: 200 + batchOrdinal,
        reported_cost_micro_usd: cost,
        scenes: scenePayload(firstSceneOrdinal, count, options),
      }),
    ],
  );
}

test("0194 binds fresh adaptive prompt runs to the v2 operation and scaled reservation", async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    const authority = await seedAdaptivePromptRun(executor, {
      sceneCount: 2,
      plannedBatchCount: 1,
      materializeRun: false,
    });
    await seedSucceededVoiceoverContext(executor, 974_000);
    const supplied = {
      account_id: IDS.accountA,
      workspace_id: IDS.workspaceA,
      user_id: IDS.userA,
      project_id: IDS.projectA,
      revision_id: IDS.revisionA,
      timeline_id: authority.timelineId,
      task_id: authority.taskId,
      attempt_id: authority.attemptId,
      outbox_id: authority.outboxId,
      execution_profile_id: authority.profileId,
      reservation_cost_event_id: id(971_009),
      run_id: authority.runId,
      input_hash: authority.inputHash,
      claim_token_hash: authority.claimHash,
      timeline_hash: authority.timelineHash,
      batch_plan_hash: authority.batchPlanHash,
      reserved_cost_micro_usd: 250_000,
      planned_batch_count: 1,
      planned_scene_count: 2,
    };
    const prepared = await executor.query(
      `SELECT public.videoforge_prepare_hosted_prompt_run($1::jsonb) AS prepared`,
      [JSON.stringify(supplied)],
    );
    assert.equal(prepared.rows[0].prepared.created, true);

    const durable = await executor.query(
      `SELECT profile.revision,
              profile.configuration->>'model' AS profile_model,
              profile.configuration->>'operation' AS profile_operation,
              attempt.provider_details->>'operation' AS attempt_operation,
              reservation.details->>'operation' AS reservation_operation
         FROM hosted_prompt_runs run
         JOIN execution_profiles profile ON profile.id=run.execution_profile_id
         JOIN attempts attempt ON attempt.id=run.attempt_id
         JOIN cost_events reservation ON reservation.account_id=run.account_id
          AND reservation.workspace_id=run.workspace_id
          AND reservation.task_id=run.task_id AND reservation.attempt_id=run.attempt_id
          AND reservation.sequence=run.reservation_cost_sequence
          AND reservation.event_type='RESERVED'
        WHERE run.id=$1`,
      [authority.runId],
    );
    assert.deepEqual(durable.rows, [
      {
        revision: 7,
        profile_model: "google:gemini@3.5-flash",
        profile_operation: "scene-prompt-writer-v2",
        attempt_operation: "scene-prompt-writer-v2",
        reservation_operation: "scene-prompt-writer-v2",
      },
    ]);

    const replayed = await executor.query(
      `SELECT public.videoforge_prepare_hosted_prompt_run($1::jsonb) AS prepared`,
      [JSON.stringify({ ...supplied, execution_profile_id: id(971_099) })],
    );
    assert.deepEqual(replayed.rows, [
      {
        prepared: {
          created: false,
          state: "DISPATCHING",
          run_id: authority.runId,
          task_id: authority.taskId,
          attempt_id: authority.attemptId,
          outbox_id: authority.outboxId,
          planned_batch_count: 1,
          planned_scene_count: 2,
          batch_plan_hash: authority.batchPlanHash,
        },
      },
    ]);
  });
});

test("0194 fails closed before task or reservation when the v2 profile drifts", async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    const authority = await seedAdaptivePromptRun(executor, {
      sceneCount: 2,
      plannedBatchCount: 1,
      materializeRun: false,
    });
    await seedSucceededVoiceoverContext(executor, 975_000);
    const driftedProfileId = id(975_010);
    await executor.query(
      `INSERT INTO execution_profiles (
         id, account_id, workspace_id, name, revision, lane, state, dispatch_target,
         configuration, configuration_hash, maximum_rate_micro_usd, checked_at, created_at
       ) VALUES ($1,$2,$3,'Hosted Runware scene prompts',7,'PROMPT','TESTED','RUNWARE',
         $4::jsonb,'sha256:'||encode(digest(convert_to(($4::jsonb)::text,'UTF8'),'sha256'), 'hex'),
         2000000,$5,$5)`,
      [
        driftedProfileId,
        IDS.accountA,
        IDS.workspaceA,
        JSON.stringify({
          model: "deepseek:v4@flash",
          operation: "scene-prompt-writer-v1",
          provider: "runware",
        }),
        FIXED_TIME,
      ],
    );
    const supplied = {
      account_id: IDS.accountA,
      workspace_id: IDS.workspaceA,
      user_id: IDS.userA,
      project_id: IDS.projectA,
      revision_id: IDS.revisionA,
      timeline_id: authority.timelineId,
      task_id: authority.taskId,
      attempt_id: authority.attemptId,
      outbox_id: authority.outboxId,
      execution_profile_id: driftedProfileId,
      reservation_cost_event_id: id(975_011),
      run_id: authority.runId,
      input_hash: authority.inputHash,
      claim_token_hash: authority.claimHash,
      timeline_hash: authority.timelineHash,
      batch_plan_hash: authority.batchPlanHash,
      reserved_cost_micro_usd: 250_000,
      planned_batch_count: 1,
      planned_scene_count: 2,
    };
    await expectDatabaseError(
      () =>
        executor.query(
          `SELECT public.videoforge_prepare_hosted_prompt_run($1::jsonb) AS prepared`,
          [JSON.stringify(supplied)],
        ),
      "23514",
    );
    const durable = await executor.query(
      `SELECT
         (SELECT count(*)::integer FROM generation_tasks WHERE id=$1) AS tasks,
         (SELECT count(*)::integer FROM attempts WHERE id=$2) AS attempts,
         (SELECT count(*)::integer FROM outbox WHERE id=$3) AS outbox,
         (SELECT count(*)::integer FROM cost_events WHERE id=$4) AS costs,
         (SELECT count(*)::integer FROM hosted_prompt_runs WHERE id=$5) AS runs`,
      [authority.taskId, authority.attemptId, authority.outboxId, id(975_011), authority.runId],
    );
    assert.deepEqual(durable.rows, [{ tasks: 0, attempts: 0, outbox: 0, costs: 0, runs: 0 }]);
  });
});

test("0194 records a batch only after one exact provider claim", async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    const authority = await seedAdaptivePromptRun(executor, {
      sceneCount: 2,
      plannedBatchCount: 1,
    });
    const requestBytes = "request-0-0";
    const claimArgs = [authority.runId, 0, id(976_001), requestBytes, sha256(requestBytes)];
    const claim = () =>
      executor.query(
        `SELECT public.videoforge_claim_hosted_prompt_batch($1,$2,$3,$4,$5) AS claimed`,
        claimArgs,
      );
    assert.equal((await claim()).rows[0].claimed, true);
    assert.equal((await claim()).rows[0].claimed, false);
    await expectDatabaseError(
      () =>
        executor.query(`SELECT public.videoforge_claim_hosted_prompt_batch($1,$2,$3,$4,$5)`, [
          authority.runId,
          0,
          id(976_002),
          requestBytes,
          sha256(requestBytes),
        ]),
      "23514",
    );
    assert.equal(
      (await recordBatch(executor, authority.runId, 0, 0, 2, 100)).rows[0].recorded,
      true,
    );
    const linkage = await executor.query(
      `SELECT count(*)::integer AS linked FROM hosted_prompt_batch_progress
        WHERE run_id=$1 AND claim_id IS NOT NULL`,
      [authority.runId],
    );
    assert.equal(linkage.rows[0].linked, 1);
  });
});

test("0071 records arbitrary ordered batches once and sums only batch transport costs", async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    const authority = await seedAdaptivePromptRun(executor);
    await recordBatch(executor, authority.runId, 0, 0, 30, 100);
    await recordBatch(executor, authority.runId, 1, 30, 30, 200);

    const batches = await executor.query(
      `SELECT batch_ordinal, first_scene_ordinal, last_scene_ordinal, scene_count,
              octet_length(request_bytes) AS request_size, octet_length(response_bytes) AS response_size,
              input_tokens, output_tokens, reported_cost_micro_usd
         FROM hosted_prompt_batch_progress WHERE run_id=$1 ORDER BY batch_ordinal`,
      [authority.runId],
    );
    assert.deepEqual(batches.rows, [
      {
        batch_ordinal: 0,
        first_scene_ordinal: 0,
        last_scene_ordinal: 29,
        scene_count: 30,
        request_size: 11,
        response_size: 12,
        input_tokens: 100,
        output_tokens: 200,
        reported_cost_micro_usd: 100,
      },
      {
        batch_ordinal: 1,
        first_scene_ordinal: 30,
        last_scene_ordinal: 59,
        scene_count: 30,
        request_size: 12,
        response_size: 13,
        input_tokens: 101,
        output_tokens: 201,
        reported_cost_micro_usd: 200,
      },
    ]);
    const sceneCounts = await executor.query(
      `SELECT count(*)::integer AS count, max(scene_ordinal)::integer AS max_ordinal,
              count(*) FILTER (WHERE batch_progress_id IS NOT NULL)::integer AS batched
         FROM hosted_prompt_scene_progress WHERE run_id=$1`,
      [authority.runId],
    );
    assert.deepEqual(sceneCounts.rows, [{ count: 60, max_ordinal: 59, batched: 60 }]);
    assert.deepEqual(
      (
        await executor.query(`SELECT reported_cost_micro_usd FROM hosted_prompt_runs WHERE id=$1`, [
          authority.runId,
        ])
      ).rows,
      [{ reported_cost_micro_usd: 300 }],
    );
  });
});

test("0071 completes adaptive runs with actual cost and releases unused reservation", async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    const authority = await seedAdaptivePromptRun(executor, {
      sceneCount: 2,
      plannedBatchCount: 1,
    });
    await recordBatch(executor, authority.runId, 0, 0, 2, 123);
    const scenes = scenePayload(0, 2);
    const requestBytes = "writer-request";
    const responseBytes = "writer-response";
    const acceptance = {
      workspaceId: IDS.workspaceA,
      projectId: IDS.projectA,
      revisionId: IDS.revisionA,
      timelineId: authority.timelineId,
      taskId: authority.taskId,
      attemptId: authority.attemptId,
      outboxId: id(971_008),
      inputHash: authority.inputHash,
      schemaVersion: "videoforge.durable-prompt-execution/v1",
      requestHash: sha256("acceptance-request"),
      responseHash: sha256("acceptance-response"),
      compiledOutputHash: sha256("acceptance-compiled"),
      acceptanceFingerprintHash: sha256("acceptance-fingerprint"),
      timelineHash: authority.timelineHash,
      styleProfileHash: HASHES.styleA,
      reportedCostMicroUsd: 123,
      acceptedAt: FIXED_TIME,
      writerAttempts: [
        {
          attemptIndex: 1,
          requestedSceneIds: scenes.map((scene) => scene.scene_id),
          requestBytes,
          requestHash: sha256(requestBytes),
          responseBytes,
          responseHash: sha256(responseBytes),
          retryOfRequestHash: null,
          acceptedSceneIds: scenes.map((scene) => scene.scene_id),
          unresolvedSceneIds: [],
          inputTokens: 10,
          outputTokens: 20,
          reportedCostMicroUsd: 123,
        },
      ],
      writerOutput: { scenes: scenes.map((scene) => scene.writer_output) },
      compiledPrompts: scenes.map((scene) => scene.compiled_prompt),
    };
    const completed = await executor.query(
      `SELECT public.videoforge_complete_hosted_prompt_run($1::jsonb) AS completed`,
      [
        JSON.stringify({
          run_id: authority.runId,
          output_asset_id: id(971_011),
          prompt_execution_id: id(971_012),
          acceptance,
        }),
      ],
    );
    assert.deepEqual(completed.rows, [{ completed: true }]);
    assert.deepEqual(
      (
        await executor.query(
          `SELECT state, reported_cost_micro_usd FROM hosted_prompt_runs WHERE id=$1`,
          [authority.runId],
        )
      ).rows,
      [{ state: "SUCCEEDED", reported_cost_micro_usd: 123 }],
    );
    assert.deepEqual(
      (
        await executor.query(
          `SELECT sequence, event_type, amount_micro_usd
             FROM cost_events WHERE attempt_id=$1 ORDER BY sequence`,
          [authority.attemptId],
        )
      ).rows,
      [
        { sequence: 1, event_type: "RESERVED", amount_micro_usd: 40000 },
        { sequence: 2, event_type: "REPORTED", amount_micro_usd: 123 },
        { sequence: 3, event_type: "SETTLED", amount_micro_usd: 123 },
        { sequence: 4, event_type: "RELEASED", amount_micro_usd: 39877 },
      ],
    );
  });
});

test("0071 rejects order, cap, tenant, and malformed scene drift atomically", async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    const authority = await seedAdaptivePromptRun(executor);
    const firstScene = scenePayload(0, 1)[0];
    await expectDatabaseError(
      () =>
        executor.query(
          `SELECT public.videoforge_record_hosted_prompt_scene($1,$2::jsonb) AS recorded`,
          [
            authority.runId,
            JSON.stringify({
              scene_ordinal: firstScene.scene_ordinal,
              scene_id: firstScene.scene_id,
              request_bytes: "legacy-request",
              request_hash: sha256("legacy-request"),
              response_bytes: "legacy-response",
              response_hash: sha256("legacy-response"),
              writer_output: firstScene.writer_output,
              compiled_prompt: firstScene.compiled_prompt,
              input_tokens: 1,
              output_tokens: 2,
              reported_cost_micro_usd: 0,
            }),
          ],
        ),
      "23514",
    );
    await expectDatabaseError(
      () =>
        executor.query(`SELECT public.videoforge_prepare_hosted_prompt_run($1::jsonb)`, [
          JSON.stringify({
            account_id: IDS.accountA,
            workspace_id: IDS.workspaceA,
            user_id: IDS.userA,
            project_id: IDS.projectA,
            revision_id: IDS.revisionA,
            timeline_id: authority.timelineId,
            task_id: id(972_001),
            attempt_id: id(972_002),
            outbox_id: id(972_003),
            execution_profile_id: id(972_004),
            reservation_cost_event_id: id(972_005),
            run_id: id(972_006),
            input_hash: authority.inputHash,
            claim_token_hash: authority.claimHash,
            timeline_hash: authority.timelineHash,
            batch_plan_hash: authority.batchPlanHash,
            reserved_cost_micro_usd: 40000,
            planned_batch_count: 2,
            planned_scene_count: authority.sceneCount - 1,
          }),
        ]),
      "23514",
    );
    const before = await executor.query(
      `SELECT (SELECT count(*)::integer FROM hosted_prompt_batch_progress WHERE run_id=$1) AS batches,
              (SELECT count(*)::integer FROM hosted_prompt_scene_progress WHERE run_id=$1) AS scenes`,
      [authority.runId],
    );
    await expectDatabaseError(
      () => recordBatch(executor, authority.runId, 0, 0, 3, 100, { corruptAt: 1 }),
      "23514",
    );
    assert.deepEqual(
      (
        await executor.query(
          `SELECT (SELECT count(*)::integer FROM hosted_prompt_batch_progress WHERE run_id=$1) AS batches,
                  (SELECT count(*)::integer FROM hosted_prompt_scene_progress WHERE run_id=$1) AS scenes`,
          [authority.runId],
        )
      ).rows,
      before.rows,
    );
    await expectDatabaseError(() => recordBatch(executor, authority.runId, 1, 0, 30, 100), "23514");
    await expectDatabaseError(
      () => recordBatch(executor, authority.runId, 0, 0, 30, 40001),
      "23514",
    );
    await executor.query(`SELECT set_config($1, $2, false)`, [
      TENANT_PRINCIPAL_SETTING,
      IDS.accountB,
    ]);
    await expectDatabaseError(() => recordBatch(executor, authority.runId, 0, 0, 30, 100), "23514");
  });
});

test("0071 failure settlement sums accepted batches and preserves historical 0070 rows", async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    const authority = await seedAdaptivePromptRun(executor);
    await recordBatch(executor, authority.runId, 0, 0, 30, 321);
    await executor.query(
      `SELECT public.videoforge_fail_hosted_prompt_run($1,'FAILED','BATCH_FAILURE',false,0)`,
      [authority.runId],
    );
    assert.deepEqual(
      (
        await executor.query(
          `SELECT state, reported_cost_micro_usd FROM hosted_prompt_runs WHERE id=$1`,
          [authority.runId],
        )
      ).rows,
      [{ state: "FAILED", reported_cost_micro_usd: 321 }],
    );
    assert.deepEqual(
      (
        await executor.query(
          `SELECT event_type, amount_micro_usd FROM cost_events WHERE attempt_id=$1 ORDER BY sequence`,
          [authority.attemptId],
        )
      ).rows,
      [
        { event_type: "RESERVED", amount_micro_usd: 40000 },
        { event_type: "REPORTED", amount_micro_usd: 321 },
        { event_type: "SETTLED", amount_micro_usd: 321 },
        { event_type: "RELEASED", amount_micro_usd: 39679 },
      ],
    );
  });

  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    const historical = await seedAdaptivePromptRun(executor, {
      sceneCount: 60,
      plannedBatchCount: 2,
    });
    await executor.query(
      `UPDATE hosted_prompt_runs
          SET planned_batch_count=NULL, planned_scene_count=NULL, batch_plan_hash=NULL
        WHERE id=$1`,
      [historical.runId],
    );
    const requestBytes = "legacy-request";
    const responseBytes = "legacy-response";
    await executor.query(
      `INSERT INTO hosted_prompt_scene_progress (
         id, account_id, workspace_id, run_id, scene_ordinal, scene_id,
         request_bytes, request_hash, response_bytes, response_hash,
         writer_output, compiled_prompt, input_tokens, output_tokens,
         reported_cost_micro_usd
       ) VALUES ($1,$2,$3,$4,59,'scene-059',$5,$6,$7,$8,
                 '{"scene_id":"scene-059"}'::jsonb,
                 '{"sceneId":"scene-059"}'::jsonb,1,2,432)`,
      [
        id(973_001),
        IDS.accountA,
        IDS.workspaceA,
        historical.runId,
        requestBytes,
        sha256(requestBytes),
        responseBytes,
        sha256(responseBytes),
      ],
    );
    await executor.query(
      `SELECT public.videoforge_fail_hosted_prompt_run($1,'FAILED','LEGACY_FAILURE',false,0)`,
      [historical.runId],
    );
    assert.deepEqual(
      (
        await executor.query(
          `SELECT state, reported_cost_micro_usd FROM hosted_prompt_runs WHERE id=$1`,
          [historical.runId],
        )
      ).rows,
      [{ state: "FAILED", reported_cost_micro_usd: 432 }],
    );
  });
});

test("0285 prepares revision-pinned Runware Luna profiles and binds claims to their request policy", async () => {
  for (const requestPolicy of [null, "runware-luna-grounded-v1", "runware-luna-grounded-v2"]) {
    await withPgcryptoMigratedDatabase(async ({ executor }) => {
      const prepareDefinition = (
        await executor.query(
          "SELECT pg_get_functiondef('public.videoforge_prepare_hosted_prompt_run(jsonb)'::regprocedure) AS definition",
        )
      ).rows[0].definition;
      assert.match(prepareDefinition, /runware-luna-grounded-v2/u);
      const authority = await seedAdaptivePromptRun(executor, {
        sceneCount: 2,
        plannedBatchCount: 1,
        materializeRun: false,
        reservedMicroUsd: 250_000,
      });
      await seedSucceededVoiceoverContext(executor, 2_830_000);
      const supplied = {
        account_id: IDS.accountA,
        workspace_id: IDS.workspaceA,
        user_id: IDS.userA,
        project_id: IDS.projectA,
        revision_id: IDS.revisionA,
        timeline_id: authority.timelineId,
        task_id: authority.taskId,
        attempt_id: authority.attemptId,
        outbox_id: authority.outboxId,
        execution_profile_id: authority.profileId,
        reservation_cost_event_id: id(2_830_011),
        run_id: authority.runId,
        input_hash: authority.inputHash,
        claim_token_hash: authority.claimHash,
        timeline_hash: authority.timelineHash,
        batch_plan_hash: authority.batchPlanHash,
        reserved_cost_micro_usd: 250_000,
        planned_batch_count: 1,
        planned_scene_count: 2,
        ...(requestPolicy ? { request_policy: requestPolicy } : {}),
      };
      await executor.query("SELECT videoforge_prepare_hosted_prompt_run($1::jsonb)", [
        JSON.stringify(supplied),
      ]);
      const row = (
        await executor.query(
          `SELECT profile.name,profile.revision,profile.dispatch_target,profile.configuration,
                  profile.maximum_rate_micro_usd,profile.configuration_hash,
                  attempt.provider_details->>'model' AS attempt_model,
                  reservation.details->>'model' AS reservation_model
             FROM hosted_prompt_runs run
             JOIN execution_profiles profile ON profile.id=run.execution_profile_id
             JOIN attempts attempt ON attempt.id=run.attempt_id
             JOIN cost_events reservation ON reservation.task_id=run.task_id
              AND reservation.attempt_id=run.attempt_id AND reservation.event_type='RESERVED'
            WHERE run.id=$1`,
          [authority.runId],
        )
      ).rows[0];
      if (requestPolicy) {
        const version = requestPolicy === "runware-luna-grounded-v2" ? 39 : 38;
        assert.equal(row.name, "Hosted Runware GPT-6 Luna scene prompts");
        assert.equal(row.revision, version === 39 ? 9 : 8);
        assert.equal(row.dispatch_target, "RUNWARE");
        assert.deepEqual(row.configuration, {
          model: "openai:gpt@6-luna",
          operation: "scene-prompt-writer-v2",
          provider: "runware",
          request_policy: requestPolicy,
          reasoning_effort: "low",
          request_version: `runware-gpt-6-luna-prompt-request-v${version}`,
          transport: "runware_openai_chat_completions",
          pricing: {
            input_micro_usd_per_million: 100_000,
            cached_input_micro_usd_per_million: 10_000,
            cache_write_micro_usd_per_million: 125_000,
            output_micro_usd_per_million: 500_000,
          },
        });
        assert.equal(row.maximum_rate_micro_usd, 8_000_000);
        assert.equal(row.attempt_model, "openai:gpt@6-luna");
        assert.equal(row.reservation_model, "openai:gpt@6-luna");
        assert.equal(
          (
            await executor.query(
              "SELECT max_inflight,min_start_interval_ms FROM provider_api_policies WHERE provider='RUNWARE_TEXT:openai:gpt@6-luna'",
            )
          ).rows[0].max_inflight,
          null,
        );
        assert.equal(
          (
            await executor.query(
              "SELECT min_start_interval_ms FROM provider_api_policies WHERE provider='RUNWARE_TEXT:openai:gpt@6-luna'",
            )
          ).rows[0].min_start_interval_ms,
          0,
        );
        const wrongModel = JSON.stringify([
          { taskType: "textInference", taskUUID: id(2_830_021), model: "google:gemini@3.5-flash" },
        ]);
        await assert.rejects(
          executor.query("SELECT videoforge_claim_hosted_prompt_batch($1,0,$2,$3,$4)", [
            authority.runId,
            id(2_830_021),
            wrongModel,
            sha256(wrongModel),
          ]),
          /request model differs from pinned profile/u,
        );
        const correctModel = JSON.stringify([
          { taskType: "textInference", taskUUID: id(2_830_022), model: "openai:gpt@6-luna" },
        ]);
        assert.equal(
          (
            await executor.query(
              "SELECT videoforge_claim_next_hosted_prompt_batch($1,0,$2,$3,$4) AS claimed",
              [authority.runId, id(2_830_022), correctModel, sha256(correctModel)],
            )
          ).rows[0].claimed,
          true,
        );
        const requestHash = sha256(correctModel);
        const wireHash = sha256("canonical Runware chat-completions request");
        const result = {
          status: "succeeded",
          outputText: "{}",
          usage: {
            inputTokens: 2,
            outputTokens: 2,
            totalTokens: 4,
            cachedInputTokens: 0,
            cacheWriteTokens: 1,
            reasoningTokens: 1,
          },
          costUsd: 0.000002,
          estimatedCostMicroUsd: 2,
          costBasis: "PINNED_RATE_ESTIMATE",
          responseId: "chatcmpl-283-test",
          wireHash,
          providerModel: "openai:gpt@6-luna",
          finishReason: "stop",
          latencyMs: 1,
        };
        await assert.rejects(
          executor.query("SELECT videoforge_record_hosted_prompt_response($1,$2,$3,$4::jsonb)", [
            authority.runId,
            id(2_830_022),
            requestHash,
            JSON.stringify({ ...result, providerModel: "AIR" }),
          ]),
          /result identity or usage is invalid/u,
        );
        await assert.rejects(
          executor.query("SELECT videoforge_record_hosted_prompt_response($1,$2,$3,$4::jsonb)", [
            authority.runId,
            id(2_830_022),
            requestHash,
            JSON.stringify({ ...result, usage: { ...result.usage, totalTokens: 5 } }),
          ]),
          /result identity or usage is invalid/u,
        );
        await assert.rejects(
          executor.query("SELECT videoforge_record_hosted_prompt_response($1,$2,$3,$4::jsonb)", [
            authority.runId,
            id(2_830_022),
            requestHash,
            JSON.stringify({ ...result, costUsd: 0.000003, estimatedCostMicroUsd: 3 }),
          ]),
          /estimate differs from pinned rates/u,
        );
        assert.equal(
          (
            await executor.query(
              "SELECT videoforge_record_hosted_prompt_response($1,$2,$3,$4::jsonb) AS recorded",
              [authority.runId, id(2_830_022), requestHash, JSON.stringify(result)],
            )
          ).rows[0].recorded,
          true,
        );
        await executor.query(
          "INSERT INTO cost_events (id,account_id,workspace_id,owner_type,owner_id,task_id,attempt_id,sequence,event_type,amount_micro_usd,idempotency_key,details,occurred_at,created_at) VALUES ($1,$2,$3,'PROJECT_REVISION',$4,$5,$6,(SELECT coalesce(max(sequence),0)+1 FROM cost_events WHERE workspace_id=$3 AND owner_type='PROJECT_REVISION' AND owner_id=$4),'REPORTED',2,'runware-luna-estimated-cost','{}'::jsonb,clock_timestamp(),clock_timestamp())",
          [
            id(2_830_099),
            IDS.accountA,
            IDS.workspaceA,
            IDS.revisionA,
            authority.taskId,
            authority.attemptId,
          ],
        );
        assert.deepEqual(
          (await executor.query("SELECT details FROM cost_events WHERE id=$1", [id(2_830_099)]))
            .rows[0].details,
          {
            provider: "RUNWARE",
            cost_basis: "PINNED_RATE_ESTIMATE",
            rate_version: "runware-air-gpt-6-luna-standard-2026-10-06",
            invoice_verified: false,
          },
        );
      } else {
        assert.equal(row.name, "Hosted Runware scene prompts");
        assert.equal(row.revision, 7);
        assert.equal(row.dispatch_target, "RUNWARE");
        assert.deepEqual(row.configuration, {
          model: "google:gemini@3.5-flash",
          operation: "scene-prompt-writer-v2",
          provider: "runware",
        });
        assert.equal(row.maximum_rate_micro_usd, 8_000_000);
        assert.equal(row.attempt_model, "google:gemini@3.5-flash");
        assert.equal(row.reservation_model, "google:gemini@3.5-flash");
      }
    });
  }
});

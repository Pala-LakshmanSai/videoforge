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

async function seedAdaptivePromptRun(
  executor,
  { sceneCount = 60, plannedBatchCount = 2, materializeRun = true } = {},
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
     ) VALUES ($1,$2,$3,'PROJECT_REVISION',$4,$5,$6,1,'RESERVED',40000,
       'adaptive-reserved','{}'::jsonb,$7,$7)`,
    [reservationId, IDS.accountA, IDS.workspaceA, IDS.revisionA, taskId, attemptId, FIXED_TIME],
  );
  await executor.query(
    `INSERT INTO hosted_prompt_runs (
       id, account_id, workspace_id, project_id, project_revision_id, timeline_plan_id,
       task_id, attempt_id, outbox_id, execution_profile_id, state, input_hash,
       claim_token_hash, reserved_cost_micro_usd, reservation_cost_sequence,
       planned_batch_count, planned_scene_count, batch_plan_hash, started_at, created_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'DISPATCHING',$11,$12,40000,1,$13,$14,$15,$16,$16)`,
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

async function seedSucceededVoiceoverContext(executor, base) {
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

function scenePayload(startOrdinal, count, { corruptAt = -1 } = {}) {
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

test("0073 binds fresh adaptive prompt runs to the v2 profile and operation", async () => {
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
      reserved_cost_micro_usd: 40_000,
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
        revision: 2,
        profile_model: "deepseek:v4@flash",
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

test("0073 fails closed before task or reservation when the v2 profile drifts", async () => {
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
       ) VALUES ($1,$2,$3,'Hosted Runware scene prompts',2,'PROMPT','TESTED','RUNWARE',
         $4::jsonb,'sha256:'||encode(digest(convert_to(($4::jsonb)::text,'UTF8'),'sha256'), 'hex'),
         40000,$5,$5)`,
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
      reserved_cost_micro_usd: 40_000,
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

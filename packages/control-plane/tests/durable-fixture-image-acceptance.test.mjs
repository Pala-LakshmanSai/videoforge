import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { deflateSync } from "node:zlib";

import { canonicalizeJson } from "@videoforge/contracts";
import { compileImagePrompt } from "@videoforge/pipeline";

import {
  DeterministicMageFixtureWorker,
  DurableFixtureImageAcceptanceService,
  exportMetadataSnapshot,
  ImageAcceptanceError,
  buildMageImageResult,
  LOCKED_MAGE_GPU,
  LOCKED_MAGE_IMAGE,
  LOCKED_MAGE_MODEL_REVISION,
  LOCKED_MAGE_SOURCE_REVISION,
  PGliteFixtureImageAcceptanceStore,
  restoreMetadataSnapshot,
  serializeMetadataSnapshot,
} from "../dist/src/index.js";
import { HASHES, IDS, seedLockedProjects } from "./support/fixtures.mjs";
import { createMigratedDatabase, FIXED_TIME, sha256, uuid } from "./support/pglite.mjs";

const TIMELINE_ID = uuid(43_001);
const TRANSCRIPT_ID = uuid(43_002);
const TRANSCRIPT_ASSET_ID = uuid(43_003);
const TIMELINE_ASSET_ID = uuid(43_004);
const PROMPT_TASK_ID = uuid(43_005);
const PROMPT_ATTEMPT_ID = uuid(43_006);
const PROMPT_OUTBOX_ID = uuid(43_007);
const PROMPT_RESERVATION_ID = uuid(43_008);
const PROMPT_OUTPUT_ASSET_ID = uuid(43_009);
const PROMPT_EXECUTION_ID = uuid(43_010);
const PROMPT_SCENE_ID = uuid(43_011);
const IMAGE_TASK_ID = uuid(43_012);
const IMAGE_ATTEMPT_ID = uuid(43_013);
const IMAGE_OUTBOX_ID = uuid(43_014);
const IMAGE_RESERVATION_ID = uuid(43_015);
const WORKFLOW_ID = uuid(43_016);
const CALLBACK_EVENT_ID = uuid(43_017);
const CALLBACK_RECEIPT_ID = uuid(43_018);
const CLAIM_HASH = sha256("fixture-image-claim");
const INPUT_HASH = sha256("fixture-image-input");
const TIMELINE_HASH = sha256("fixture-image-timeline");
const TRANSCRIPT_HASH = sha256("fixture-image-transcript");
const SCOPE = Object.freeze({ workspaceId: IDS.workspaceA, actorUserId: IDS.userA });

const compiledPrompt = compileImagePrompt({
  writerOutput: {
    scene_id: "scene-image-001",
    literal_subject: "weathered hands holding a farm tool",
    action: "checking the worn wooden handle",
    environment: "working farm in daylight",
    in_image_shot_role: "HANDS_ACTION",
    lighting_context: "available daylight",
    continuity_tags: ["same_farm"],
    prompt_core: "Documentary evidence of ordinary farm work.",
  },
  expectedScene: {
    sceneId: "scene-image-001",
    phrase: "The farmer checked the tool.",
    priorContext: null,
    nextContext: null,
    inImageShotRole: "HANDS_ACTION",
    layout: "IMAGE_FULL",
  },
  style: {
    positiveSuffix: "authentic observational documentary photography",
    negativeSuffix: "illustration, CGI, visible text",
    fullImageGuidance: "16:9 center-safe evidence",
    splitImageGuidance: "8:9 evidence centered in the right-hand panel",
  },
  extraPromptKeywords: null,
  applyExtraPromptKeywords: false,
});

const command = (overrides = {}) =>
  Object.freeze({
    projectId: IDS.projectA,
    revisionId: IDS.revisionA,
    timelineId: TIMELINE_ID,
    promptExecutionId: PROMPT_EXECUTION_ID,
    promptSceneResultId: PROMPT_SCENE_ID,
    taskId: IMAGE_TASK_ID,
    attemptId: IMAGE_ATTEMPT_ID,
    outboxId: IMAGE_OUTBOX_ID,
    callbackReceiptId: CALLBACK_RECEIPT_ID,
    presentedClaimTokenHash: CLAIM_HASH,
    ...overrides,
  });

const manualAuthority = (callbackPayloadHash) =>
  Object.freeze({
    workspaceId: IDS.workspaceA,
    projectId: IDS.projectA,
    revisionId: IDS.revisionA,
    revisionState: "GENERATING",
    timelineId: TIMELINE_ID,
    timelineHash: TIMELINE_HASH,
    timelineState: "CURRENT",
    imageStyleId: IDS.styleA,
    imageStyleVersionId: IDS.styleVersionA,
    styleProfileArtifactId: null,
    styleProfileHash: HASHES.styleA,
    styleState: "PUBLISHED",
    promptExecutionId: PROMPT_EXECUTION_ID,
    promptSceneResultId: PROMPT_SCENE_ID,
    sceneId: "scene-image-001",
    layout: "IMAGE_FULL",
    compiledPrompt,
    taskId: IMAGE_TASK_ID,
    taskState: "RUNNING",
    attemptId: IMAGE_ATTEMPT_ID,
    attemptOrdinal: 1,
    attemptState: "CLAIMED",
    claimTokenHash: CLAIM_HASH,
    recordedInputHash: INPUT_HASH,
    outboxId: IMAGE_OUTBOX_ID,
    outboxState: "ACKNOWLEDGED",
    callbackReceiptId: CALLBACK_RECEIPT_ID,
    callbackPayloadHash,
    callbackState: "RECEIVED",
    reservedCostMicroUsd: 100,
    accepted: null,
  });

function deterministicUuid(label) {
  const bytes = createHash("sha256").update(label, "utf8").digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function seedScenario(executor, callbackPayloadHash, callbackKind = "fixture_image_result") {
  await executor.transaction(async (tx) => {
    await seedLockedProjects(tx, {
      styleAProfilePayload: {
        prompt_profile: {
          planner_guidance: "literal",
          positive_suffix: "documentary",
          negative_suffix: "text",
          full_image_guidance: "16:9 center-safe",
          split_image_guidance: "8:9 right-hand panel centered",
        },
      },
    });
    await tx.query(
      `INSERT INTO public.assets (id, workspace_id, project_id, project_revision_id, kind, state,
         canonical_contract_name, canonical_contract_version, canonical_document_sha256,
         content_type, byte_size, verified_at)
       VALUES ($1,$2,$3,$4,'CANONICAL_DOCUMENT','VERIFIED','transcript-timing','v1',$5,'application/json',100,$6),
              ($7,$2,$3,$4,'CANONICAL_DOCUMENT','VERIFIED','timeline-plan','v1',$8,'application/json',100,$6),
              ($9,$2,$3,$4,'CANONICAL_DOCUMENT','ACCEPTED','durable-prompt-execution','v1',$10,'application/json',100,$6)`,
      [
        TRANSCRIPT_ASSET_ID,
        IDS.workspaceA,
        IDS.projectA,
        IDS.revisionA,
        TRANSCRIPT_HASH,
        FIXED_TIME,
        TIMELINE_ASSET_ID,
        TIMELINE_HASH,
        PROMPT_OUTPUT_ASSET_ID,
        sha256("prompt-output"),
      ],
    );
    await tx.query(
      `INSERT INTO public.transcripts (id, workspace_id, project_revision_id, source_asset_id, state,
         model_name, model_hash, duration_ms, contract_name, contract_version,
         canonical_document_asset_id, canonical_document_hash, created_at, ready_at,
         lineage_contract_version, source_binary_sha256, engine_name, engine_version, language,
         transcription_config_hash, input_fingerprint_hash, idempotency_key)
       VALUES ($1,$2,$3,$4,'READY','fixture',$5,3000,'transcript-timing','v1',$6,$7,$8,$8,
         'timing-lineage/v1',$9,'fixture','1','en',$10,$11,'fixture-image-transcript')`,
      [
        TRANSCRIPT_ID,
        IDS.workspaceA,
        IDS.revisionA,
        IDS.voiceoverA,
        sha256("model"),
        TRANSCRIPT_ASSET_ID,
        TRANSCRIPT_HASH,
        FIXED_TIME,
        HASHES.voiceoverA,
        sha256("config"),
        sha256("transcript-input"),
      ],
    );
    const wordId = uuid(43_100);
    const sentenceId = uuid(43_101);
    await tx.query(
      `INSERT INTO public.transcript_words (id,workspace_id,transcript_id,word_index,word,start_ms,end_ms_exclusive,created_at)
       VALUES ($1,$2,$3,0,'farmer',0,3000,$4)`,
      [wordId, IDS.workspaceA, TRANSCRIPT_ID, FIXED_TIME],
    );
    await tx.query(
      `INSERT INTO public.transcript_sentences (id,workspace_id,transcript_id,sentence_key,sentence_index,
         word_start,word_end_exclusive,start_ms,end_ms_exclusive,text,created_at)
       VALUES ($1,$2,$3,'sentence-1',0,0,1,0,3000,'The farmer checked the tool.',$4)`,
      [sentenceId, IDS.workspaceA, TRANSCRIPT_ID, FIXED_TIME],
    );
    await tx.query(
      `INSERT INTO public.transcript_phrases (id,workspace_id,transcript_id,sentence_id,phrase_key,
         phrase_index,word_start,word_end_exclusive,start_ms,end_ms_exclusive,pause_before_ms,
         pause_after_ms,text,created_at)
       VALUES ($1,$2,$3,$4,'phrase-1',0,0,1,0,3000,0,0,'The farmer checked the tool.',$5)`,
      [uuid(43_102), IDS.workspaceA, TRANSCRIPT_ID, sentenceId, FIXED_TIME],
    );
    await tx.query(
      `INSERT INTO public.timeline_plans (id,workspace_id,project_revision_id,transcript_id,plan_sequence,
         revision_config_hash,transcript_document_hash,scheduler_version,scheduler_config_hash,seed,
         input_fingerprint_hash,contract_name,contract_version,canonical_document_asset_id,
         canonical_document_hash,output_fps_num,output_fps_den,total_frames,idempotency_key,
         created_by_user_id,created_at)
       VALUES ($1,$2,$3,$4,1,$5,$6,'fixture-v1',$7,42,$8,'timeline-plan','v1',$9,$10,30,1,90,
         'fixture-image-timeline',$11,$12)`,
      [
        TIMELINE_ID,
        IDS.workspaceA,
        IDS.revisionA,
        TRANSCRIPT_ID,
        HASHES.revisionA,
        TRANSCRIPT_HASH,
        sha256("scheduler"),
        sha256("timeline-input"),
        TIMELINE_ASSET_ID,
        TIMELINE_HASH,
        IDS.userA,
        FIXED_TIME,
      ],
    );
    await tx.query(
      `INSERT INTO public.timeline_segments (id,workspace_id,project_revision_id,segment_index,
         start_frame,end_frame_exclusive,timeline_composition,in_image_shot_role,narration,
         required_slots,timeline_plan_hash,created_at,timeline_plan_id,segment_key,
         source_audio_start_ms,source_audio_end_ms_exclusive,word_start,word_end_exclusive)
       VALUES ($1,$2,$3,0,0,90,'IMAGE_FULL','HANDS_ACTION','The farmer checked the tool.',
         '{"image":{"task_key":"image:scene-image-001"}}'::jsonb,$4,$5,$6,'scene-image-001',0,3000,0,1)`,
      [uuid(43_103), IDS.workspaceA, IDS.revisionA, TIMELINE_HASH, FIXED_TIME, TIMELINE_ID],
    );
    await tx.query(
      `INSERT INTO public.revision_timing_heads (workspace_id,project_revision_id,version,
         current_transcript_id,current_timeline_plan_id,transcript_input_fingerprint_hash,
         timeline_input_fingerprint_hash,updated_at)
       VALUES ($1,$2,1,$3,$4,$5,$6,$7)`,
      [
        IDS.workspaceA,
        IDS.revisionA,
        TRANSCRIPT_ID,
        TIMELINE_ID,
        sha256("transcript-input"),
        sha256("timeline-input"),
        FIXED_TIME,
      ],
    );
    await tx.query(
      `INSERT INTO public.generation_tasks (id,workspace_id,owner_type,owner_id,project_revision_id,
         task_key,lane,state,accepted_attempt_id,created_at,updated_at,finished_at)
       VALUES ($1,$2,'PROJECT_REVISION',$3,$3,'prompt:fixture','PROMPT','COMPLETE',NULL,$4,$4,$4),
              ($5,$2,'PROJECT_REVISION',$3,$3,'image:scene-image-001','IMAGE','RUNNING',NULL,$4,$4,NULL)`,
      [PROMPT_TASK_ID, IDS.workspaceA, IDS.revisionA, FIXED_TIME, IMAGE_TASK_ID],
    );
    await tx.query(
      `INSERT INTO public.attempts (id,workspace_id,task_id,ordinal,idempotency_key,state,
         dispatch_state,claim_state,execution_profile_id,execution_claim_token_hash,input_hash,
         output_asset_id,result_disposition,claimed_at,started_at,finished_at)
       VALUES ($1,$2,$3,1,'prompt-fixture-attempt','SUCCEEDED','ACKNOWLEDGED','CLAIMED',$4,$5,$6,$7,'ACCEPTED',$8,$8,$8),
              ($9,$2,$10,1,'image-fixture-attempt','CLAIMED','ACKNOWLEDGED','CLAIMED',$4,$11,$12,NULL,'PENDING',$8,$8,NULL)`,
      [
        PROMPT_ATTEMPT_ID,
        IDS.workspaceA,
        PROMPT_TASK_ID,
        IDS.executionProfileA,
        sha256("prompt-claim"),
        sha256("prompt-input"),
        PROMPT_OUTPUT_ASSET_ID,
        FIXED_TIME,
        IMAGE_ATTEMPT_ID,
        IMAGE_TASK_ID,
        CLAIM_HASH,
        INPUT_HASH,
      ],
    );
    await tx.query(
      `UPDATE public.generation_tasks SET accepted_attempt_id = $3
        WHERE workspace_id = $1 AND id = $2`,
      [IDS.workspaceA, PROMPT_TASK_ID, PROMPT_ATTEMPT_ID],
    );
    await tx.query(
      `INSERT INTO public.cost_events (id,workspace_id,owner_type,owner_id,task_id,attempt_id,
         sequence,event_type,amount_micro_usd,idempotency_key,details,occurred_at)
       VALUES ($1,$2,'PROJECT_REVISION',$3,$4,$5,1,'RESERVED',0,'prompt-fixture-reserved','{}'::jsonb,$6),
              ($7,$2,'PROJECT_REVISION',$3,$8,$9,2,'RESERVED',100,'image-fixture-reserved','{}'::jsonb,$6)`,
      [
        PROMPT_RESERVATION_ID,
        IDS.workspaceA,
        IDS.revisionA,
        PROMPT_TASK_ID,
        PROMPT_ATTEMPT_ID,
        FIXED_TIME,
        IMAGE_RESERVATION_ID,
        IMAGE_TASK_ID,
        IMAGE_ATTEMPT_ID,
      ],
    );
    await tx.query(
      `INSERT INTO public.outbox (id,workspace_id,task_id,attempt_id,kind,state,dedupe_key,
         payload_contract_name,payload_contract_version,payload_hash,payload,available_at,delivered_at)
       VALUES ($1,$2,$3,$4,'DISPATCH','DELIVERED','prompt-fixture-dispatch','prompt','v1',$5,'{}'::jsonb,$6,$6),
              ($7,$2,$8,$9,'DISPATCH','DELIVERED','image-fixture-dispatch','fixture-image-input','v1',$10,'{}'::jsonb,$6,$6)`,
      [
        PROMPT_OUTBOX_ID,
        IDS.workspaceA,
        PROMPT_TASK_ID,
        PROMPT_ATTEMPT_ID,
        sha256("prompt-outbox"),
        FIXED_TIME,
        IMAGE_OUTBOX_ID,
        IMAGE_TASK_ID,
        IMAGE_ATTEMPT_ID,
        INPUT_HASH,
      ],
    );
    const promptAcceptance = {
      schemaVersion: "videoforge.durable-prompt-execution/v1",
      fixture: true,
    };
    await tx.query(
      `INSERT INTO public.prompt_executions (id,workspace_id,project_id,project_revision_id,
         timeline_plan_id,image_style_id,image_style_version_id,task_id,attempt_id,outbox_id,
         reservation_cost_event_id,output_asset_id,schema_version,input_hash,request_hash,response_hash,
         compiled_output_hash,acceptance_fingerprint_hash,timeline_hash,style_profile_hash,
         reserved_cost_micro_usd,reported_cost_micro_usd,acceptance_payload,accepted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'videoforge.durable-prompt-execution/v1',
         $13,$14,$15,$16,$17,$18,$19,0,0,$20::jsonb,$21)`,
      [
        PROMPT_EXECUTION_ID,
        IDS.workspaceA,
        IDS.projectA,
        IDS.revisionA,
        TIMELINE_ID,
        IDS.styleA,
        IDS.styleVersionA,
        PROMPT_TASK_ID,
        PROMPT_ATTEMPT_ID,
        PROMPT_OUTBOX_ID,
        PROMPT_RESERVATION_ID,
        PROMPT_OUTPUT_ASSET_ID,
        sha256("prompt-input"),
        sha256("request"),
        sha256("response"),
        sha256("compiled"),
        sha256("prompt-acceptance"),
        TIMELINE_HASH,
        HASHES.styleA,
        JSON.stringify(promptAcceptance),
        FIXED_TIME,
      ],
    );
    await tx.query(
      `INSERT INTO public.prompt_scene_results (id,workspace_id,prompt_execution_id,
         execution_attempt_id,scene_ordinal,scene_id,writer_output,compiled_prompt,
         positive_prompt_hash,negative_prompt_hash)
       VALUES ($1,$2,$3,$4,0,'scene-image-001',$5::jsonb,$6::jsonb,$7,$8)`,
      [
        PROMPT_SCENE_ID,
        IDS.workspaceA,
        PROMPT_EXECUTION_ID,
        PROMPT_ATTEMPT_ID,
        JSON.stringify({ scene_id: "scene-image-001" }),
        JSON.stringify(compiledPrompt),
        compiledPrompt.positivePromptSha256,
        compiledPrompt.negativePromptSha256,
      ],
    );
    await tx.query(
      `INSERT INTO public.workflow_instances (id,workspace_id,owner_type,owner_id,task_id,
         workflow_type,state,external_system,idempotency_key,created_at,updated_at)
       VALUES ($1,$2,'PROJECT_REVISION',$3,$4,'fixture-image','RUNNING','LOCAL','fixture-image-workflow',$5,$5)`,
      [WORKFLOW_ID, IDS.workspaceA, IDS.revisionA, IMAGE_TASK_ID, FIXED_TIME],
    );
    await tx.query(
      `INSERT INTO public.workflow_events (id,workspace_id,workflow_instance_id,task_id,attempt_id,
         aggregate_type,aggregate_id,sequence,kind,payload_contract_name,payload_contract_version,
         payload_hash,payload,occurred_at)
       VALUES ($1,$2,$3,$4,$5,'ATTEMPT',$5,1,'ATTEMPT_SUCCEEDED','fixture-image-result','v1',$6,'{}'::jsonb,$7)`,
      [
        CALLBACK_EVENT_ID,
        IDS.workspaceA,
        WORKFLOW_ID,
        IMAGE_TASK_ID,
        IMAGE_ATTEMPT_ID,
        callbackPayloadHash,
        FIXED_TIME,
      ],
    );
    await tx.query(
      `INSERT INTO public.callback_receipts (id,workspace_id,task_id,attempt_id,workflow_event_id,
         callback_kind,nonce_hash,payload_hash,signature_key_id,signed_at,expires_at,received_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'fixture-local-v1',$9,$10,$9)`,
      [
        CALLBACK_RECEIPT_ID,
        IDS.workspaceA,
        IMAGE_TASK_ID,
        IMAGE_ATTEMPT_ID,
        CALLBACK_EVENT_ID,
        callbackKind,
        sha256("fixture-image-nonce"),
        callbackPayloadHash,
        FIXED_TIME,
        "2026-08-10T05:00:00.000Z",
      ],
    );
  });
}

function service(executor, telemetry = { record() {} }) {
  return new DurableFixtureImageAcceptanceService(
    new PGliteFixtureImageAcceptanceStore(executor),
    { now: () => FIXED_TIME },
    telemetry,
  );
}

async function fixture() {
  return new DeterministicMageFixtureWorker().generate(manualAuthority(sha256("placeholder")));
}

function realPng() {
  const width = 1280;
  const height = 720;
  const crc32 = (value) => {
    let crc = 0xffffffff;
    for (const byte of value) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  const chunk = (kind, payload) => {
    const name = Buffer.from(kind, "ascii");
    const output = Buffer.alloc(payload.length + 12);
    output.writeUInt32BE(payload.length, 0);
    name.copy(output, 4);
    payload.copy(output, 8);
    output.writeUInt32BE(crc32(Buffer.concat([name, payload])), payload.length + 8);
    return output;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.alloc(width * 3 + 1, 47);
  row[0] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function mage(authority = manualAuthority(sha256("placeholder"))) {
  const media = realPng();
  const result = buildMageImageResult(authority, media, {
    image: LOCKED_MAGE_IMAGE,
    modelRevision: LOCKED_MAGE_MODEL_REVISION,
    sourceRevision: LOCKED_MAGE_SOURCE_REVISION,
    gpu: LOCKED_MAGE_GPU,
    seed: 20260812,
    positivePromptHash: compiledPrompt.positivePromptSha256,
    negativePromptHash: compiledPrompt.negativePromptSha256,
    outputSha256: sha256(media),
    objectKey: `workspace/${IDS.workspaceA}/project/${IDS.projectA}/revision/${IDS.revisionA}/images/${IMAGE_ATTEMPT_ID}.png`,
    reportedCostMicroUsd: 31,
    runtimeEvidence: {
      schema_version: "videoforge.mage-runtime-evidence/v1",
      gpu: { name: LOCKED_MAGE_GPU },
      network_volume_attached: false,
    },
    qualityReview: {
      state: "PASSED",
      reviewerUserId: IDS.userA,
      reviewedAt: FIXED_TIME,
      findings: ["No visible text, logo, watermark, or material anatomy defect."],
    },
  });
  return { result, media };
}

async function rejectsCode(action, expected) {
  await assert.rejects(
    action,
    (error) => error instanceof ImageAcceptanceError && error.code === expected,
  );
}

test("fixture image acceptance atomically converges durable asset, QA, callback, and cost lineage", async () => {
  const context = await createMigratedDatabase();
  try {
    const generated = await fixture();
    await seedScenario(context.executor, generated.result.resultHash);
    const first = await service(context.executor).accept(
      SCOPE,
      command(),
      generated.result,
      generated.media,
    );
    assert.equal(first.replayed, false);
    const replay = await service(context.executor).accept(
      SCOPE,
      command(),
      generated.result,
      generated.media,
    );
    assert.equal(replay.replayed, true);
    assert.equal(canonicalizeJson(replay.accepted), canonicalizeJson(first.accepted));
    const state = await context.executor.query(
      `SELECT (SELECT count(*)::int FROM image_generation_acceptances) AS acceptances,
              (SELECT count(*)::int FROM qa_results WHERE attempt_id = $1) AS qa,
              (SELECT count(*)::int FROM cost_events WHERE attempt_id = $1) AS costs,
              task.state AS task_state, attempt.state AS attempt_state,
              attempt.result_disposition, asset.state AS asset_state, asset.binary_sha256
         FROM generation_tasks task
         JOIN attempts attempt ON attempt.workspace_id = task.workspace_id AND attempt.id = $1
         JOIN assets asset ON asset.workspace_id = attempt.workspace_id AND asset.id = attempt.output_asset_id
        WHERE task.id = $2`,
      [IMAGE_ATTEMPT_ID, IMAGE_TASK_ID],
    );
    assert.deepEqual(state.rows[0], {
      acceptances: 1,
      qa: 1,
      costs: 3,
      task_state: "COMPLETE",
      attempt_state: "SUCCEEDED",
      result_disposition: "ACCEPTED",
      asset_state: "ACCEPTED",
      binary_sha256: generated.result.media.binarySha256,
    });
  } finally {
    await context.database.close();
  }
});

test("real Mage image acceptance persists truthful provider lineage and exact replay", async () => {
  const context = await createMigratedDatabase();
  try {
    const generated = mage();
    await seedScenario(context.executor, generated.result.resultHash, "mage_image_result");
    const first = await service(context.executor).accept(
      SCOPE,
      command(),
      generated.result,
      generated.media,
    );
    assert.equal(first.replayed, false);
    assert.equal(first.accepted.schemaVersion, "videoforge.mage-image-acceptance/v1");
    const replay = await service(context.executor).accept(
      SCOPE,
      command(),
      generated.result,
      generated.media,
    );
    assert.equal(replay.replayed, true);
    assert.equal(canonicalizeJson(replay.accepted), canonicalizeJson(first.accepted));
    const state = await context.executor.query(
      `SELECT accepted.schema_version, accepted.reported_cost_micro_usd,
              asset.width_px, asset.height_px, asset.metadata,
              attempt.provider_details, qa.notes
         FROM image_generation_acceptances accepted
         JOIN assets asset ON asset.id = accepted.output_asset_id
         JOIN attempts attempt ON attempt.id = accepted.attempt_id
         JOIN qa_results qa ON qa.id = accepted.qa_result_id`,
    );
    assert.equal(state.rows[0].schema_version, "videoforge.mage-image-acceptance/v1");
    assert.equal(Number(state.rows[0].reported_cost_micro_usd), 31);
    assert.equal(state.rows[0].width_px, 1280);
    assert.equal(state.rows[0].height_px, 720);
    assert.equal(state.rows[0].metadata.fixture_non_production, false);
    assert.equal(state.rows[0].metadata.provider_model.image, LOCKED_MAGE_IMAGE);
    assert.equal(state.rows[0].provider_details.operation, "runpod.mage.image.generate");
    assert.match(state.rows[0].notes, /explicit visual review passed/u);
  } finally {
    await context.database.close();
  }
});

test("Mage rejection and provider, reviewer, prompt, media, and cost drift never mutate durable state", async () => {
  const authority = manualAuthority(sha256("placeholder"));
  const generated = mage(authority);
  for (const mode of ["review", "provider", "reviewer", "prompt", "media", "cost"]) {
    const context = await createMigratedDatabase();
    try {
      await seedScenario(context.executor, generated.result.resultHash, "mage_image_result");
      let result = generated.result;
      let media = generated.media;
      if (mode === "review")
        assert.throws(
          () =>
            buildMageImageResult(authority, media, {
              image: LOCKED_MAGE_IMAGE,
              modelRevision: LOCKED_MAGE_MODEL_REVISION,
              sourceRevision: LOCKED_MAGE_SOURCE_REVISION,
              gpu: LOCKED_MAGE_GPU,
              seed: 20260812,
              positivePromptHash: compiledPrompt.positivePromptSha256,
              negativePromptHash: compiledPrompt.negativePromptSha256,
              outputSha256: sha256(media),
              objectKey: generated.result.media.objectKey,
              reportedCostMicroUsd: 31,
              runtimeEvidence: generated.result.runtimeEvidence,
              qualityReview: {
                ...generated.result.qualityReview,
                state: "REJECTED",
              },
            }),
          (error) => error instanceof ImageAcceptanceError && error.code === "MEDIA_INVALID",
        );
      if (mode === "provider")
        result = {
          ...result,
          providerModel: { ...result.providerModel, image: `${LOCKED_MAGE_IMAGE}x` },
        };
      if (mode === "reviewer")
        result = {
          ...result,
          qualityReview: { ...result.qualityReview, reviewerUserId: IDS.userB },
        };
      if (mode === "prompt") result = { ...result, negativePromptHash: sha256("drift") };
      if (mode === "media") {
        media = Buffer.from(media);
        media[0] = 0;
      }
      if (mode === "cost") result = { ...result, reportedCostMicroUsd: 101 };
      if (mode !== "review")
        await assert.rejects(
          () => service(context.executor).accept(SCOPE, command(), result, media),
          (error) => error instanceof ImageAcceptanceError,
        );
      const rows = await context.executor.query(
        `SELECT count(*)::int AS count FROM image_generation_acceptances`,
      );
      assert.equal(rows.rows[0].count, 0);
    } finally {
      await context.database.close();
    }
  }
});

test("accepted Mage image survives metadata restore and reopened exact replay", async () => {
  const root = await mkdtemp(join(tmpdir(), "videoforge-mage-acceptance-"));
  const destinationPath = join(root, "destination");
  const source = await createMigratedDatabase();
  let destination = await createMigratedDatabase(destinationPath);
  try {
    const generated = mage();
    await seedScenario(source.executor, generated.result.resultHash, "mage_image_result");
    const first = await service(source.executor).accept(
      SCOPE,
      command(),
      generated.result,
      generated.media,
    );
    await restoreMetadataSnapshot(
      destination.executor,
      serializeMetadataSnapshot(await exportMetadataSnapshot(source.executor)),
    );
    await destination.database.close();
    destination = await createMigratedDatabase(destinationPath);
    const replay = await service(destination.executor).accept(
      SCOPE,
      command(),
      generated.result,
      generated.media,
    );
    assert.equal(replay.replayed, true);
    assert.equal(canonicalizeJson(replay.accepted), canonicalizeJson(first.accepted));
  } finally {
    await source.database.close();
    await destination.database.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("fixture image acceptance rejects claim, cancellation, workspace, media, lineage, and cost drift", async () => {
  const cases = ["claim", "cancel", "workspace", "media", "lineage", "cost"];
  for (const mode of cases) {
    const context = await createMigratedDatabase();
    try {
      const generated = await fixture();
      await seedScenario(context.executor, generated.result.resultHash);
      let scope = SCOPE;
      let input = command();
      let result = generated.result;
      let media = generated.media;
      let expected = "DURABLE_STATE_INVALID";
      if (mode === "claim") {
        input = command({ presentedClaimTokenHash: sha256("stale") });
        expected = "CLAIM_STALE";
      }
      if (mode === "cancel") {
        await context.executor.query(
          `UPDATE generation_tasks SET state='CANCEL_REQUESTED',cancel_requested_at=$3 WHERE workspace_id=$1 AND id=$2`,
          [IDS.workspaceA, IMAGE_TASK_ID, FIXED_TIME],
        );
        expected = "CANCELLED";
      }
      if (mode === "workspace") {
        scope = { workspaceId: IDS.workspaceB, actorUserId: IDS.userB };
        expected = "WORKSPACE_MISMATCH";
      }
      if (mode === "media") {
        media = Buffer.from(generated.media);
        media[0] = 0;
        expected = "MEDIA_INVALID";
      }
      if (mode === "lineage") {
        result = { ...generated.result, styleProfileHash: sha256("drift") };
        expected = "HASH_MISMATCH";
      }
      if (mode === "cost") {
        result = { ...generated.result, reportedCostMicroUsd: 101 };
        expected = "HASH_MISMATCH";
      }
      await rejectsCode(
        () => service(context.executor).accept(scope, input, result, media),
        expected,
      );
      const rows = await context.executor.query(
        `SELECT count(*)::int AS count FROM image_generation_acceptances`,
      );
      assert.equal(rows.rows[0].count, 0);
    } finally {
      await context.database.close();
    }
  }
});

test("image acceptance conflict rolls back asset, QA, cost, task, and attempt mutations", async () => {
  const context = await createMigratedDatabase();
  try {
    const generated = await fixture();
    await seedScenario(context.executor, generated.result.resultHash);
    await context.executor.query(
      `INSERT INTO assets (id,workspace_id,kind,state,binary_sha256,content_type,byte_size,verified_at)
       VALUES ($1,$2,'IMAGE','VERIFIED',$3,'image/png',1,$4)`,
      [
        deterministicUuid(`image-output:${IMAGE_ATTEMPT_ID}`),
        IDS.workspaceA,
        sha256("conflict"),
        FIXED_TIME,
      ],
    );
    await rejectsCode(
      () => service(context.executor).accept(SCOPE, command(), generated.result, generated.media),
      "REPOSITORY_FAILURE",
    );
    const state = await context.executor.query(
      `SELECT (SELECT count(*)::int FROM image_generation_acceptances) AS acceptances,
              (SELECT count(*)::int FROM qa_results WHERE attempt_id=$1) AS qa,
              (SELECT count(*)::int FROM cost_events WHERE attempt_id=$1) AS costs,
              (SELECT state FROM generation_tasks WHERE id=$2) AS task_state`,
      [IMAGE_ATTEMPT_ID, IMAGE_TASK_ID],
    );
    assert.deepEqual(state.rows[0], { acceptances: 0, qa: 0, costs: 1, task_state: "RUNNING" });
  } finally {
    await context.database.close();
  }
});

test("accepted fixture image survives metadata restore and reopened exact replay", async () => {
  const root = await mkdtemp(join(tmpdir(), "videoforge-image-acceptance-"));
  const destinationPath = join(root, "destination");
  const source = await createMigratedDatabase();
  let destination = await createMigratedDatabase(destinationPath);
  try {
    const generated = await fixture();
    await seedScenario(source.executor, generated.result.resultHash);
    const first = await service(source.executor).accept(
      SCOPE,
      command(),
      generated.result,
      generated.media,
    );
    await restoreMetadataSnapshot(
      destination.executor,
      serializeMetadataSnapshot(await exportMetadataSnapshot(source.executor)),
    );
    await destination.database.close();
    destination = await createMigratedDatabase(destinationPath);
    const replay = await service(destination.executor).accept(
      SCOPE,
      command(),
      generated.result,
      generated.media,
    );
    assert.equal(replay.replayed, true);
    assert.equal(canonicalizeJson(replay.accepted), canonicalizeJson(first.accepted));
  } finally {
    await source.database.close();
    await destination.database.close();
    await rm(root, { recursive: true, force: true });
  }
});

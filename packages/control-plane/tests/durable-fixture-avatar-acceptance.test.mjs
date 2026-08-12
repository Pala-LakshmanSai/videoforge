import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalizeJson } from "@videoforge/contracts";

import {
  AvatarAcceptanceError,
  DurableFixtureAvatarAcceptanceService,
  exportMetadataSnapshot,
  PGliteFixtureAvatarAcceptanceStore,
  PGliteProviderRenderAssetRepository,
  restoreMetadataSnapshot,
  serializeMetadataSnapshot,
} from "../dist/src/index.js";
import { HASHES, IDS, seedLockedProjects } from "./support/fixtures.mjs";
import { createMigratedDatabase, FIXED_TIME, sha256, uuid } from "./support/pglite.mjs";

const TIMELINE_ID = uuid(45_001);
const TRANSCRIPT_ID = uuid(45_002);
const TRANSCRIPT_ASSET_ID = uuid(45_003);
const TIMELINE_ASSET_ID = uuid(45_004);
const SEGMENT_ID = uuid(45_005);
const SPAN_ID = uuid(45_006);
const SPAN_ASSET_ID = uuid(45_007);
const TASK_ID = uuid(45_008);
const ATTEMPT_ID = uuid(45_009);
const OUTBOX_ID = uuid(45_010);
const RESERVATION_ID = uuid(45_011);
const WORKFLOW_ID = uuid(45_012);
const CALLBACK_EVENT_ID = uuid(45_013);
const CALLBACK_RECEIPT_ID = uuid(45_014);
const CLAIM_HASH = sha256("fixture-avatar-claim");
const INPUT_HASH = sha256("fixture-avatar-input");
const TIMELINE_HASH = sha256("fixture-avatar-timeline");
const TRANSCRIPT_HASH = sha256("fixture-avatar-transcript");
const SPAN_HASH = sha256("fixture-avatar-span-audio");
const SCOPE = Object.freeze({ workspaceId: IDS.workspaceA, actorUserId: IDS.userA });
const MEDIA_PREFIX = Buffer.concat([
  Buffer.from([0, 0, 0, 24]),
  Buffer.from("ftypisom", "ascii"),
  Buffer.from([0, 0, 2, 0]),
  Buffer.from("isomiso2", "ascii"),
  Buffer.from("VF-AVATAR-FIXTURE/V1\n", "ascii"),
]);

const hashCanonical = (value) => sha256Bytes(Buffer.from(canonicalizeJson(value), "utf8"));
const sha256Bytes = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

const command = (overrides = {}) =>
  Object.freeze({
    projectId: IDS.projectA,
    revisionId: IDS.revisionA,
    timelineId: TIMELINE_ID,
    timelineSegmentId: SEGMENT_ID,
    selectedSpanAudioId: SPAN_ID,
    taskId: TASK_ID,
    attemptId: ATTEMPT_ID,
    outboxId: OUTBOX_ID,
    callbackReceiptId: CALLBACK_RECEIPT_ID,
    presentedClaimTokenHash: CLAIM_HASH,
    ...overrides,
  });

const manualAuthority = (callbackPayloadHash = sha256("placeholder")) =>
  Object.freeze({
    workspaceId: IDS.workspaceA,
    projectId: IDS.projectA,
    revisionId: IDS.revisionA,
    revisionState: "GENERATING",
    timelineId: TIMELINE_ID,
    timelineState: "CURRENT",
    timelineSegmentId: SEGMENT_ID,
    timelineLayout: "AVATAR_FULL",
    avatarProfileId: IDS.avatarProfileA,
    avatarProfileVersionId: IDS.avatarVersionA,
    avatarProfileHash: HASHES.avatarProfileA,
    runtimeSourceAssetId: IDS.avatarRuntimeA,
    runtimeSourceSha256: HASHES.avatarRuntimeA,
    sourcePreparationVersion: "owned-preparation-v1",
    sourceValidationProfileVersion: "owned-validation-v1",
    avatarState: "READY",
    selectedSpanAudioId: SPAN_ID,
    spanAudioAssetId: SPAN_ASSET_ID,
    spanAudioSha256: SPAN_HASH,
    spanState: "READY",
    sourceStartMs: 0,
    sourceEndMs: 3_000,
    trimStartSample: 0,
    trimEndSampleExclusive: 144_000,
    taskId: TASK_ID,
    taskState: "RUNNING",
    attemptId: ATTEMPT_ID,
    attemptOrdinal: 1,
    attemptState: "CLAIMED",
    claimTokenHash: CLAIM_HASH,
    recordedInputHash: INPUT_HASH,
    outboxId: OUTBOX_ID,
    outboxState: "ACKNOWLEDGED",
    callbackReceiptId: CALLBACK_RECEIPT_ID,
    callbackPayloadHash,
    callbackState: "RECEIVED",
    reservedCostMicroUsd: 100,
    accepted: null,
  });

function fixtureBundle(authority = manualAuthority()) {
  const embedded = {
    schema_version: "avatar-fixture-media/v1",
    fixture_non_production: true,
    avatar_profile_version_id: authority.avatarProfileVersionId,
    avatar_profile_hash: authority.avatarProfileHash,
    runtime_source_asset_id: authority.runtimeSourceAssetId,
    runtime_source_sha256: authority.runtimeSourceSha256,
    span_audio_asset_id: authority.spanAudioAssetId,
    span_audio_sha256: authority.spanAudioSha256,
    trim_start_sample: authority.trimStartSample,
    trim_end_sample_exclusive: authority.trimEndSampleExclusive,
    width: 832,
    height: 480,
    fps_num: 25,
    fps_den: 1,
    frame_count: 75,
    video_codec: "synthetic-fixture",
    audio_binding: "original-materialized-trimmed-span",
  };
  const media = Buffer.concat([MEDIA_PREFIX, Buffer.from(canonicalizeJson(embedded), "utf8")]);
  const callbackIdentity = sha256("fixture-local-null-callback/v1");
  const base = {
    schema_version: "avatar-fixture-result/v1",
    fixture_non_production: true,
    status: "SUCCEEDED",
    identity: {
      workspace_id: authority.workspaceId,
      project_id: authority.projectId,
      revision_id: authority.revisionId,
      task_id: authority.taskId,
      attempt_id: authority.attemptId,
    },
    lineage: {
      avatar_profile_id: authority.avatarProfileId,
      avatar_profile_version_id: authority.avatarProfileVersionId,
      avatar_profile_hash: authority.avatarProfileHash,
      runtime_source_asset_id: authority.runtimeSourceAssetId,
      runtime_source_sha256: authority.runtimeSourceSha256,
      source_preparation_version: authority.sourcePreparationVersion,
      source_validation_profile_version: authority.sourceValidationProfileVersion,
      span_audio_asset_id: authority.spanAudioAssetId,
      span_audio_sha256: authority.spanAudioSha256,
      source_start_ms: authority.sourceStartMs,
      source_end_ms: authority.sourceEndMs,
      trim_start_sample: authority.trimStartSample,
      trim_end_sample_exclusive: authority.trimEndSampleExclusive,
    },
    renderer_binding: {
      layout: authority.timelineLayout,
      source_profile: "avatarforcing-centered-832x480p25-v1",
      crop_profile: "832:468:0:6",
      rate_profile: "native-25-to-renderer-30-round-near-v1",
    },
    media: {
      sha256: sha256Bytes(media),
      bytes: media.length,
      signature: "ISO_BMFF_FTYP_ISOM",
      width: 832,
      height: 480,
      fps_num: 25,
      fps_den: 1,
      frame_count: 75,
      duration_ms: 3000,
      audio_binding_sha256: authority.spanAudioSha256,
    },
    attempt: { retry_index: 0, replayed: false, outbound_activity_count: 0 },
    cost: {
      owner_type: "PROJECT_REVISION",
      owner_id: authority.revisionId,
      estimated_micro_usd: 0,
      reported_micro_usd: 0,
      settled_micro_usd: 0,
    },
    review: {
      technical_status: "PASS",
      subjective_classification: "UNCLASSIFIED",
      allowed_subjective_classifications: ["LIP_ONLY", "WHOLE_FRAME", "ACCEPTED_BY_REVIEWER"],
    },
    callback: { identity_sha256: callbackIdentity, delivery_status: "NOT_SENT_FIXTURE" },
  };
  const resultHash = hashCanonical(base);
  const event = {
    schema_version: "avatar-fixture-callback/v1",
    callback_event_id: `callback_${createHash("sha256").update(authority.attemptId).digest("hex").slice(0, 24)}`,
    workspace_id: authority.workspaceId,
    task_id: authority.taskId,
    attempt_id: authority.attemptId,
    status: "SUCCEEDED",
    result_sha256: resultHash,
    callback_identity_sha256: callbackIdentity,
  };
  return {
    media,
    result: { ...base, result_sha256: resultHash, callback: { ...base.callback, event } },
    callbackPayloadHash: hashCanonical(event),
  };
}

async function seedScenario(executor, callbackPayloadHash) {
  await executor.transaction(async (tx) => {
    await seedLockedProjects(tx);
    await tx.query(
      `INSERT INTO public.assets (id,workspace_id,project_id,project_revision_id,kind,state,
         canonical_contract_name,canonical_contract_version,canonical_document_sha256,
         content_type,byte_size,verified_at)
       VALUES ($1,$2,$3,$4,'CANONICAL_DOCUMENT','VERIFIED','transcript-timing','v1',$5,'application/json',100,$6),
              ($7,$2,$3,$4,'CANONICAL_DOCUMENT','VERIFIED','timeline-plan','v1',$8,'application/json',100,$6)`,
      [
        TRANSCRIPT_ASSET_ID,
        IDS.workspaceA,
        IDS.projectA,
        IDS.revisionA,
        TRANSCRIPT_HASH,
        FIXED_TIME,
        TIMELINE_ASSET_ID,
        TIMELINE_HASH,
      ],
    );
    await tx.query(
      `INSERT INTO public.assets (id,workspace_id,project_id,project_revision_id,kind,state,
         object_key,binary_sha256,content_type,byte_size,duration_ms,metadata,verified_at)
       VALUES ($1,$2,$3,$4,'AUDIO_SPAN','VERIFIED','workspace/a/span.wav',$5,'audio/wav',100,3000,
         '{"sample_rate_hz":48000,"channels":1}'::jsonb,$6)`,
      [SPAN_ASSET_ID, IDS.workspaceA, IDS.projectA, IDS.revisionA, SPAN_HASH, FIXED_TIME],
    );
    await tx.query(
      `INSERT INTO public.transcripts (id,workspace_id,project_revision_id,source_asset_id,state,
         model_name,model_hash,duration_ms,contract_name,contract_version,canonical_document_asset_id,
         canonical_document_hash,created_at,ready_at,lineage_contract_version,source_binary_sha256,
         engine_name,engine_version,language,transcription_config_hash,input_fingerprint_hash,idempotency_key)
       VALUES ($1,$2,$3,$4,'READY','fixture',$5,3000,'transcript-timing','v1',$6,$7,$8,$8,
         'timing-lineage/v1',$9,'fixture','1','en',$10,$11,'avatar-transcript')`,
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
    const wordId = uuid(45_100);
    const sentenceId = uuid(45_101);
    await tx.query(
      `INSERT INTO public.transcript_words (id,workspace_id,transcript_id,word_index,word,start_ms,end_ms_exclusive,created_at)
      VALUES ($1,$2,$3,0,'avatar',0,3000,$4)`,
      [wordId, IDS.workspaceA, TRANSCRIPT_ID, FIXED_TIME],
    );
    await tx.query(
      `INSERT INTO public.transcript_sentences (id,workspace_id,transcript_id,sentence_key,sentence_index,word_start,word_end_exclusive,start_ms,end_ms_exclusive,text,created_at)
      VALUES ($1,$2,$3,'sentence-1',0,0,1,0,3000,'Avatar phrase.',$4)`,
      [sentenceId, IDS.workspaceA, TRANSCRIPT_ID, FIXED_TIME],
    );
    await tx.query(
      `INSERT INTO public.transcript_phrases (id,workspace_id,transcript_id,sentence_id,phrase_key,phrase_index,word_start,word_end_exclusive,start_ms,end_ms_exclusive,pause_before_ms,pause_after_ms,text,created_at)
      VALUES ($1,$2,$3,$4,'phrase-1',0,0,1,0,3000,0,0,'Avatar phrase.',$5)`,
      [uuid(45_102), IDS.workspaceA, TRANSCRIPT_ID, sentenceId, FIXED_TIME],
    );
    await tx.query(
      `INSERT INTO public.timeline_plans (id,workspace_id,project_revision_id,transcript_id,plan_sequence,
         revision_config_hash,transcript_document_hash,scheduler_version,scheduler_config_hash,seed,
         input_fingerprint_hash,contract_name,contract_version,canonical_document_asset_id,
         canonical_document_hash,output_fps_num,output_fps_den,total_frames,idempotency_key,
         created_by_user_id,created_at)
       VALUES ($1,$2,$3,$4,1,$5,$6,'fixture-v1',$7,42,$8,'timeline-plan','v1',$9,$10,30,1,90,
         'avatar-timeline',$11,$12)`,
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
      `INSERT INTO public.timeline_segments (id,workspace_id,project_revision_id,segment_index,start_frame,
         end_frame_exclusive,timeline_composition,in_image_shot_role,narration,required_slots,
         timeline_plan_hash,created_at,timeline_plan_id,segment_key,source_audio_start_ms,
         source_audio_end_ms_exclusive,word_start,word_end_exclusive)
       VALUES ($1,$2,$3,0,0,90,'AVATAR_FULL',NULL,'Avatar phrase.',
         '{"avatar":{"task_key":"avatar:span:001","span_audio_task_key":"audio-span:001"}}'::jsonb,$4,$5,$6,'avatar-segment-001',0,3000,0,1)`,
      [SEGMENT_ID, IDS.workspaceA, IDS.revisionA, TIMELINE_HASH, FIXED_TIME, TIMELINE_ID],
    );
    await tx.query(
      `INSERT INTO public.selected_span_audio (id,workspace_id,project_revision_id,timeline_plan_id,
         timeline_segment_id,transcript_id,span_key,task_key,source_asset_id,source_binary_sha256,
         selected_start_ms,selected_end_ms_exclusive,padded_start_ms,padded_end_ms_exclusive,
         trim_start_ms,trim_end_ms_exclusive,state,materialized_asset_id,materialized_binary_sha256,
         created_at,materialized_at)
       VALUES ($1,$2,$3,$4,$5,$6,'span-001','audio-span:001',$7,$8,0,3000,0,3000,
         0,3000,'MATERIALIZED',$9,$10,$11,$11)`,
      [
        SPAN_ID,
        IDS.workspaceA,
        IDS.revisionA,
        TIMELINE_ID,
        SEGMENT_ID,
        TRANSCRIPT_ID,
        IDS.voiceoverA,
        HASHES.voiceoverA,
        SPAN_ASSET_ID,
        SPAN_HASH,
        FIXED_TIME,
      ],
    );
    await tx.query(
      `INSERT INTO public.revision_timing_heads (workspace_id,project_revision_id,version,
         current_transcript_id,current_timeline_plan_id,transcript_input_fingerprint_hash,
         timeline_input_fingerprint_hash,updated_at) VALUES ($1,$2,1,$3,$4,$5,$6,$7)`,
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
         task_key,lane,state,created_at,updated_at)
       VALUES ($1,$2,'PROJECT_REVISION',$3,$3,'avatar:span:001','AVATAR','RUNNING',$4,$4)`,
      [TASK_ID, IDS.workspaceA, IDS.revisionA, FIXED_TIME],
    );
    await tx.query(
      `INSERT INTO public.attempts (id,workspace_id,task_id,ordinal,idempotency_key,state,
         dispatch_state,claim_state,execution_profile_id,execution_claim_token_hash,input_hash,
         claimed_at,started_at)
       VALUES ($1,$2,$3,1,'avatar-fixture-attempt','CLAIMED','ACKNOWLEDGED','CLAIMED',$4,$5,$6,$7,$7)`,
      [
        ATTEMPT_ID,
        IDS.workspaceA,
        TASK_ID,
        IDS.executionProfileA,
        CLAIM_HASH,
        INPUT_HASH,
        FIXED_TIME,
      ],
    );
    await tx.query(
      `INSERT INTO public.cost_events (id,workspace_id,owner_type,owner_id,task_id,attempt_id,sequence,
         event_type,amount_micro_usd,idempotency_key,details,occurred_at)
       VALUES ($1,$2,'PROJECT_REVISION',$3,$4,$5,1,'RESERVED',100,'avatar-fixture-reserved','{}'::jsonb,$6)`,
      [RESERVATION_ID, IDS.workspaceA, IDS.revisionA, TASK_ID, ATTEMPT_ID, FIXED_TIME],
    );
    await tx.query(
      `INSERT INTO public.outbox (id,workspace_id,task_id,attempt_id,kind,state,dedupe_key,
         payload_contract_name,payload_contract_version,payload_hash,payload,available_at,delivered_at)
       VALUES ($1,$2,$3,$4,'DISPATCH','DELIVERED','avatar-fixture-dispatch',
         'avatar-fixture-job-input','v1',$5,'{}'::jsonb,$6,$6)`,
      [OUTBOX_ID, IDS.workspaceA, TASK_ID, ATTEMPT_ID, INPUT_HASH, FIXED_TIME],
    );
    await tx.query(
      `INSERT INTO public.workflow_instances (id,workspace_id,owner_type,owner_id,task_id,
         workflow_type,state,external_system,idempotency_key,created_at,updated_at)
       VALUES ($1,$2,'PROJECT_REVISION',$3,$4,'fixture-avatar','RUNNING','LOCAL','fixture-avatar-workflow',$5,$5)`,
      [WORKFLOW_ID, IDS.workspaceA, IDS.revisionA, TASK_ID, FIXED_TIME],
    );
    await tx.query(
      `INSERT INTO public.workflow_events (id,workspace_id,workflow_instance_id,task_id,attempt_id,
         aggregate_type,aggregate_id,sequence,kind,payload_contract_name,payload_contract_version,
         payload_hash,payload,occurred_at)
       VALUES ($1,$2,$3,$4,$5,'ATTEMPT',$5,1,'ATTEMPT_SUCCEEDED','avatar-fixture-callback','v1',$6,'{}'::jsonb,$7)`,
      [
        CALLBACK_EVENT_ID,
        IDS.workspaceA,
        WORKFLOW_ID,
        TASK_ID,
        ATTEMPT_ID,
        callbackPayloadHash,
        FIXED_TIME,
      ],
    );
    await tx.query(
      `INSERT INTO public.callback_receipts (id,workspace_id,task_id,attempt_id,workflow_event_id,
         callback_kind,nonce_hash,payload_hash,signature_key_id,signed_at,expires_at,received_at)
       VALUES ($1,$2,$3,$4,$5,'avatar_fixture_result',$6,$7,'fixture-local-v1',$8,$9,$8)`,
      [
        CALLBACK_RECEIPT_ID,
        IDS.workspaceA,
        TASK_ID,
        ATTEMPT_ID,
        CALLBACK_EVENT_ID,
        sha256("avatar-fixture-nonce"),
        callbackPayloadHash,
        FIXED_TIME,
        "2026-08-10T05:00:00.000Z",
      ],
    );
  });
}

function service(executor, telemetry = { record() {} }) {
  return new DurableFixtureAvatarAcceptanceService(
    new PGliteFixtureAvatarAcceptanceStore(executor),
    { now: () => FIXED_TIME },
    telemetry,
  );
}

async function rejectsCode(action, expected) {
  await assert.rejects(
    action,
    (error) => error instanceof AvatarAcceptanceError && error.code === expected,
  );
}

test("Avatar acceptance persists one clip with two renderer bindings and no subjective inference", async () => {
  const context = await createMigratedDatabase();
  try {
    const bundle = fixtureBundle();
    await seedScenario(context.executor, bundle.callbackPayloadHash);
    const first = await service(context.executor).accept(
      SCOPE,
      command(),
      bundle.result,
      bundle.media,
    );
    assert.equal(first.replayed, false);
    assert.equal(first.accepted.subjectiveClassification, "UNREVIEWED");
    const replay = await service(context.executor).accept(
      SCOPE,
      command(),
      bundle.result,
      bundle.media,
    );
    assert.equal(replay.replayed, true);
    assert.equal(canonicalizeJson(replay.accepted), canonicalizeJson(first.accepted));
    const state = await context.executor.query(
      `SELECT (SELECT count(*)::int FROM avatar_generation_acceptances) AS acceptances,
              (SELECT count(*)::int FROM avatar_renderer_bindings) AS bindings,
              (SELECT count(DISTINCT output_asset_id)::int FROM avatar_renderer_bindings) AS clips,
              (SELECT count(*)::int FROM qa_results WHERE attempt_id=$1) AS qa,
              (SELECT count(*)::int FROM cost_events WHERE attempt_id=$1) AS costs,
              task.state AS task_state,attempt.state AS attempt_state,attempt.result_disposition,
              asset.state AS asset_state,asset.binary_sha256
         FROM generation_tasks task JOIN attempts attempt ON attempt.id=$1
         JOIN assets asset ON asset.id=attempt.output_asset_id WHERE task.id=$2`,
      [ATTEMPT_ID, TASK_ID],
    );
    assert.deepEqual(state.rows[0], {
      acceptances: 1,
      bindings: 2,
      clips: 1,
      qa: 1,
      costs: 3,
      task_state: "COMPLETE",
      attempt_state: "SUCCEEDED",
      result_disposition: "ACCEPTED",
      asset_state: "ACCEPTED",
      binary_sha256: sha256Bytes(bundle.media),
    });
    const candidates = await new PGliteProviderRenderAssetRepository(context.executor).resolve(
      IDS.workspaceA,
      IDS.revisionA,
      ["avatar:span:001"],
    );
    assert.equal(candidates[0].kind, "AVATAR_CLIP");
    assert.equal(candidates[0].acceptance.acceptedAttemptId, ATTEMPT_ID);
    assert.equal(
      candidates[0].acceptance.acceptanceFingerprintHash,
      first.accepted.acceptanceFingerprintHash,
    );
    assert.equal(candidates[0].rendererSourceProfile, "avatarforcing-centered-832x480p25-v1");
    assert.equal(candidates[0].acceptance.qualityReview.subjectiveClassification, "UNREVIEWED");
    assert.deepEqual(candidates[0].acceptance.cost, {
      reservedMicroUsd: 100,
      reportedMicroUsd: 0,
      settledMicroUsd: 0,
    });
  } finally {
    await context.database.close();
  }
});

test("Avatar acceptance rejects claim, cancellation, workspace, media, lineage, crop, callback, and cost drift", async () => {
  for (const mode of [
    "claim",
    "cancel",
    "workspace",
    "media",
    "lineage",
    "crop",
    "callback",
    "cost",
  ]) {
    const context = await createMigratedDatabase();
    try {
      const bundle = fixtureBundle();
      await seedScenario(context.executor, bundle.callbackPayloadHash);
      let scope = SCOPE;
      let input = command();
      let result = structuredClone(bundle.result);
      let media = bundle.media;
      let expected = "OUTPUT_INVALID";
      if (mode === "claim") {
        input = command({ presentedClaimTokenHash: sha256("stale") });
        expected = "CLAIM_STALE";
      }
      if (mode === "cancel") {
        await context.executor.query(
          `UPDATE generation_tasks SET state='CANCEL_REQUESTED',cancel_requested_at=$3 WHERE workspace_id=$1 AND id=$2`,
          [IDS.workspaceA, TASK_ID, FIXED_TIME],
        );
        expected = "CANCELLED";
      }
      if (mode === "workspace") {
        scope = { workspaceId: IDS.workspaceB, actorUserId: IDS.userB };
        expected = "WORKSPACE_MISMATCH";
      }
      if (mode === "media") {
        media = Buffer.from(bundle.media);
        media[0] = 1;
        expected = "MEDIA_INVALID";
      }
      if (mode === "lineage") {
        result.lineage.span_audio_sha256 = sha256("drift");
        expected = "HASH_MISMATCH";
      }
      if (mode === "crop") result.renderer_binding.crop_profile = "416:468:208:6";
      if (mode === "callback") {
        result.callback.event.result_sha256 = sha256("drift");
        expected = "CALLBACK_INVALID";
      }
      if (mode === "cost") {
        result.cost.reported_micro_usd = 1;
        expected = "COST_MISMATCH";
      }
      await rejectsCode(
        () => service(context.executor).accept(scope, input, result, media),
        expected,
      );
      const rows = await context.executor.query(
        `SELECT count(*)::int AS count FROM avatar_generation_acceptances`,
      );
      assert.equal(rows.rows[0].count, 0);
    } finally {
      await context.database.close();
    }
  }
});

test("Avatar acceptance storage conflict rolls back asset, bindings, QA, costs, task, and attempt", async () => {
  const context = await createMigratedDatabase();
  try {
    const bundle = fixtureBundle();
    await seedScenario(context.executor, bundle.callbackPayloadHash);
    const bytes = createHash("sha256")
      .update(`avatar-output:${ATTEMPT_ID}`)
      .digest()
      .subarray(0, 16);
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytes.toString("hex");
    const assetId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    await context.executor.query(
      `INSERT INTO assets (id,workspace_id,kind,state,binary_sha256,content_type,byte_size,verified_at)
      VALUES ($1,$2,'AVATAR_CLIP','VERIFIED',$3,'video/mp4',1,$4)`,
      [assetId, IDS.workspaceA, sha256("conflict"), FIXED_TIME],
    );
    await rejectsCode(
      () => service(context.executor).accept(SCOPE, command(), bundle.result, bundle.media),
      "REPOSITORY_FAILURE",
    );
    const state = await context.executor.query(
      `SELECT (SELECT count(*)::int FROM avatar_generation_acceptances) AS acceptances,
              (SELECT count(*)::int FROM avatar_renderer_bindings) AS bindings,
              (SELECT count(*)::int FROM qa_results WHERE attempt_id=$1) AS qa,
              (SELECT count(*)::int FROM cost_events WHERE attempt_id=$1) AS costs,
              (SELECT state FROM generation_tasks WHERE id=$2) AS task_state`,
      [ATTEMPT_ID, TASK_ID],
    );
    assert.deepEqual(state.rows[0], {
      acceptances: 0,
      bindings: 0,
      qa: 0,
      costs: 1,
      task_state: "RUNNING",
    });
  } finally {
    await context.database.close();
  }
});

test("accepted Avatar fixture survives metadata restore and reopened exact replay", async () => {
  const root = await mkdtemp(join(tmpdir(), "videoforge-avatar-acceptance-"));
  const destinationPath = join(root, "destination");
  const source = await createMigratedDatabase();
  let destination = await createMigratedDatabase(destinationPath);
  try {
    const bundle = fixtureBundle();
    await seedScenario(source.executor, bundle.callbackPayloadHash);
    const first = await service(source.executor).accept(
      SCOPE,
      command(),
      bundle.result,
      bundle.media,
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
      bundle.result,
      bundle.media,
    );
    assert.equal(replay.replayed, true);
    assert.equal(canonicalizeJson(replay.accepted), canonicalizeJson(first.accepted));
  } finally {
    await source.database.close();
    await destination.database.close();
    await rm(root, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  buildSelectedSpanAudioJob,
  DurableLocalTranscriptionPersistence,
  DurableSelectedSpanAudioPersistence,
  DurableTranscriptionError,
  prepareDurableLocalTranscription,
} from "../dist/src/index.js";
import { createPGliteControlPlaneRepositories } from "../dist/src/adapters/index.js";
import { HASHES, IDS, seedLockedProjects } from "./support/fixtures.mjs";
import { FIXED_TIME, sha256, uuid, withMigratedDatabase } from "./support/pglite.mjs";

const SCOPE = Object.freeze({ workspaceId: IDS.workspaceA, actorUserId: IDS.userA });
const MODEL_HASH = sha256("pinned-local-whisper-base-en-v1");

const diagnosticJson = (value) =>
  JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? `${item}n` : item));

const LOCAL_IDS = Object.freeze({
  asrTask: uuid(31_001),
  asrAttempt: uuid(31_002),
  timelineDocument: uuid(31_003),
  timelinePlan: uuid(31_004),
  timelineSegment: uuid(31_005),
  span: uuid(31_006),
  spanTask: uuid(31_007),
  spanAttempt: uuid(31_008),
  invalidation: uuid(31_009),
  replacementAsrTask: uuid(31_010),
  replacementAsrAttempt: uuid(31_011),
  replacementInvalidation: uuid(31_012),
});

function objectUri(hash, extension) {
  const digest = hash.slice("sha256:".length);
  return `vf-local://objects/sha256/${digest.slice(0, 2)}/${digest}.${extension}`;
}

function asrDocuments(overrides = {}) {
  const attemptId = overrides.attemptId ?? LOCAL_IDS.asrAttempt;
  const modelHash = overrides.modelHash ?? MODEL_HASH;
  const input = {
    schema_version: "asr-job-input/v1",
    project_revision_id: IDS.revisionA,
    attempt_id: attemptId,
    voiceover: {
      asset_id: IDS.voiceoverA,
      sha256: HASHES.voiceoverA,
      artifact_uri: objectUri(HASHES.voiceoverA, "wav"),
      media_type: "audio/wav",
      duration_ms: 12_000,
    },
    model: {
      engine: "whisper.cpp",
      name: "base.en",
      sha256: modelHash,
      language: "en",
    },
    options: {
      threads: 4,
      processors: 1,
      flash_attention: true,
      greedy: true,
      split_on_word: true,
    },
    output: {
      result_uri: `vf-local-run://${IDS.revisionA}/${attemptId}/asr-result.json`,
    },
    cancel_token: "local-asr-cancel-token-never-persisted-000001",
  };
  const words = [
    ["Fresh", 0, 700],
    ["watermelons", 700, 2100],
    ["reveal", 2100, 3000],
    ["their", 3000, 3500],
    ["quality", 3500, 4700],
    ["through", 4700, 5600],
    ["simple", 5600, 6600],
    ["careful", 6600, 7600],
    ["checks.", 7600, 9000],
  ].map(([text, start, end], index) => ({
    index,
    text,
    start_ms: start,
    end_ms: end,
    confidence: null,
  }));
  const transcript = {
    schema_version: "transcript-timing/v1",
    project_revision_id: IDS.revisionA,
    source: {
      asset_id: IDS.voiceoverA,
      sha256: HASHES.voiceoverA,
      duration_ms: 12_000,
    },
    engine: {
      name: "whisper.cpp",
      version: "1.8.4",
      model_name: "base.en",
      model_sha256: modelHash,
      language: "en",
    },
    text: words.map((word) => word.text).join(" "),
    words,
    phrases: [
      {
        phrase_id: "phrase_0001",
        sentence_id: "sentence_0001",
        word_start: 0,
        word_end_exclusive: 5,
        start_ms: 0,
        end_ms: 4700,
        pause_before_ms: 0,
        pause_after_ms: 0,
        text: "Fresh watermelons reveal their quality",
      },
      {
        phrase_id: "phrase_0002",
        sentence_id: "sentence_0001",
        word_start: 5,
        word_end_exclusive: 9,
        start_ms: 4700,
        end_ms: 9000,
        pause_before_ms: 0,
        pause_after_ms: 3000,
        text: "through simple careful checks.",
      },
    ],
  };
  const result = {
    schema_version: "asr-job-result/v1",
    attempt_id: attemptId,
    status: "SUCCEEDED",
    source_voiceover_sha256: HASHES.voiceoverA,
    model_sha256: modelHash,
    transcript,
    diagnostics: {
      tool_version: "1.8.4",
      source_duration_ms: 12_000,
      decode_duration_ms: 1430,
    },
    error: null,
  };
  return { input, result };
}

function acceptanceCommand(documents = asrDocuments(), overrides = {}) {
  return {
    projectId: IDS.projectA,
    projectRevisionId: IDS.revisionA,
    taskId: overrides.taskId ?? LOCAL_IDS.asrTask,
    attemptId: overrides.attemptId ?? LOCAL_IDS.asrAttempt,
    expectedHeadVersion: overrides.expectedHeadVersion ?? 0,
    lineageSequence: overrides.lineageSequence ?? 1,
    supersedesTranscriptId: overrides.supersedesTranscriptId ?? null,
    optionalScriptHash: null,
    asrInput: documents.input,
    asrResult: documents.result,
    finishedAt: FIXED_TIME,
  };
}

class MemoryCanonicalStore {
  constructor() {
    this.objects = new Map();
    this.calls = 0;
  }

  async putIfAbsent(write) {
    this.calls += 1;
    const actualHash = `sha256:${createHash("sha256").update(write.bytes).digest("hex")}`;
    assert.equal(actualHash, write.binarySha256);
    const existing = this.objects.get(write.objectKey);
    if (existing !== undefined && !Buffer.from(existing).equals(Buffer.from(write.bytes))) {
      throw new Error("immutable canonical object conflict");
    }
    this.objects.set(write.objectKey, Uint8Array.from(write.bytes));
    return {
      objectKey: write.objectKey,
      binarySha256: write.binarySha256,
      byteSize: BigInt(write.bytes.byteLength),
      replayed: existing !== undefined,
    };
  }
}

async function insertRunningAttempt(executor, { taskId, attemptId, taskKey, lane, inputHash }) {
  await executor.query(
    `INSERT INTO generation_tasks (
       id, workspace_id, owner_type, owner_id, project_revision_id,
       task_key, lane, state, version
     ) VALUES ($1, $2, 'PROJECT_REVISION', $3, $3, $4, $5, 'RUNNING', 1)`,
    [taskId, IDS.workspaceA, IDS.revisionA, taskKey, lane],
  );
  await executor.query(
    `INSERT INTO attempts (
       id, workspace_id, task_id, ordinal, idempotency_key, state,
       dispatch_state, claim_state, execution_profile_id, execution_claim_token_hash,
       input_hash, claimed_at, started_at
     ) VALUES ($1, $2, $3, 1, $4, 'RUNNING', 'ACKNOWLEDGED', 'CLAIMED',
               $5, $6, $7, $8, $8)`,
    [
      attemptId,
      IDS.workspaceA,
      taskId,
      `attempt:${attemptId}`,
      IDS.executionProfileA,
      sha256(`claim:${attemptId}`),
      inputHash,
      FIXED_TIME,
    ],
  );
}

async function setupTranscription(executor) {
  await seedLockedProjects(executor);
  const documents = asrDocuments();
  const prepared = await prepareDurableLocalTranscription(SCOPE, acceptanceCommand(documents));
  await insertRunningAttempt(executor, {
    taskId: LOCAL_IDS.asrTask,
    attemptId: LOCAL_IDS.asrAttempt,
    taskKey: "transcribe:local:revision-a",
    lane: "TRANSCRIBE",
    inputHash: prepared.asrInputHash,
  });
  const repositories = createPGliteControlPlaneRepositories(executor);
  const store = new MemoryCanonicalStore();
  const service = new DurableLocalTranscriptionPersistence(repositories, store);
  return { documents, prepared, repositories, store, service };
}

async function persistTimeline(executor, repositories, transcript) {
  const documentHash = sha256("vf-2-02-timeline-document");
  await executor.query(
    `INSERT INTO assets (
       id, workspace_id, project_id, project_revision_id, kind, state,
       canonical_contract_name, canonical_contract_version, canonical_document_sha256,
       content_type, verified_at
     ) VALUES ($1, $2, $3, $4, 'CANONICAL_DOCUMENT', 'VERIFIED',
               'timeline-plan', 'v1', $5, 'application/json', $6)`,
    [
      LOCAL_IDS.timelineDocument,
      IDS.workspaceA,
      IDS.projectA,
      IDS.revisionA,
      documentHash,
      FIXED_TIME,
    ],
  );
  const span = {
    spanId: LOCAL_IDS.span,
    spanKey: "span:owned:0",
    timelineSegmentId: LOCAL_IDS.timelineSegment,
    transcriptId: transcript.transcriptId,
    taskKey: "audio-span:owned:0",
    sourceAssetId: IDS.voiceoverA,
    sourceBinarySha256: HASHES.voiceoverA,
    selectedStartMs: 0,
    selectedEndMsExclusive: 4700,
    paddedStartMs: 0,
    paddedEndMsExclusive: 5200,
    trimStartMs: 0,
    trimEndMsExclusive: 4700,
  };
  const persisted = await repositories.timing.persistTimelinePlan(SCOPE, {
    idempotencyKey: "timing:timeline:vf-2-02",
    projectId: IDS.projectA,
    projectRevisionId: IDS.revisionA,
    expectedHeadVersion: 1,
    timelinePlanId: LOCAL_IDS.timelinePlan,
    transcriptId: transcript.transcriptId,
    planSequence: 1,
    supersedesTimelinePlanId: null,
    revisionConfigHash: HASHES.revisionA,
    transcriptDocumentHash: transcript.canonicalDocument.canonicalDocumentSha256,
    schedulerVersion: "fixture-scheduler/1",
    schedulerConfigHash: sha256("vf-2-02-scheduler-config"),
    seed: 42n,
    inputFingerprintHash: sha256("vf-2-02-timeline-input"),
    canonicalDocumentAssetId: LOCAL_IDS.timelineDocument,
    canonicalDocument: {
      contractName: "timeline-plan",
      contractVersion: "v1",
      payload: { schema_version: "timeline-plan/v1", source: "owned-fixture" },
      canonicalDocumentSha256: documentHash,
    },
    outputFpsNum: 30,
    outputFpsDen: 1,
    totalFrames: 360,
    segments: [
      {
        segmentId: LOCAL_IDS.timelineSegment,
        segmentKey: "segment:owned:0",
        index: 0,
        startFrame: 0,
        endFrameExclusive: 141,
        sourceAudioStartMs: 0,
        sourceAudioEndMsExclusive: 4700,
        wordStart: 0,
        wordEndExclusive: 5,
        timelineComposition: "AVATAR_FULL",
        inImageShotRole: null,
        narration: "Fresh watermelons reveal their quality",
        requiredSlots: {
          avatar: {
            task_key: "avatar:owned:0",
            span_audio_task_key: "audio-span:owned:0",
          },
        },
      },
      {
        segmentId: uuid(31_105),
        segmentKey: "segment:owned:1",
        index: 1,
        startFrame: 141,
        endFrameExclusive: 360,
        sourceAudioStartMs: 4700,
        sourceAudioEndMsExclusive: 12_000,
        wordStart: 5,
        wordEndExclusive: 9,
        timelineComposition: "IMAGE_FULL",
        inImageShotRole: "OBJECT_EVIDENCE",
        narration: "through simple careful checks.",
        requiredSlots: {
          image: {
            task_key: "image:owned:1",
          },
        },
      },
    ],
    selectedSpanAudio: [span],
    createdAt: FIXED_TIME,
  });
  assert.equal(persisted.ok, true, diagnosticJson(persisted));
  return { span, plan: persisted.value.value };
}

function spanResult(dispatch, span) {
  const bytes = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(320_040, 7)]);
  const hash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  return {
    schema_version: "selected-span-audio-result/v1",
    attempt_id: LOCAL_IDS.spanAttempt,
    status: "SUCCEEDED",
    span_id: span.spanId,
    timeline_plan_id: LOCAL_IDS.timelinePlan,
    transcript_id: span.transcriptId,
    timeline_segment_id: span.timelineSegmentId,
    task_key: span.taskKey,
    source_voiceover: {
      asset_id: span.sourceAssetId,
      sha256: span.sourceBinarySha256,
      duration_ms: 12_000,
    },
    selection: {
      selected_start_ms: span.selectedStartMs,
      selected_end_ms_exclusive: span.selectedEndMsExclusive,
      padded_start_ms: span.paddedStartMs,
      padded_end_ms_exclusive: span.paddedEndMsExclusive,
      trim_start_ms: span.trimStartMs,
      trim_end_ms_exclusive: span.trimEndMsExclusive,
    },
    audio: {
      asset_id: dispatch.outputAssetId,
      sha256: hash,
      artifact_uri: objectUri(hash, "wav"),
      content_type: "audio/wav",
      byte_size: bytes.byteLength,
      duration_ms: 5200,
      sample_rate_hz: 16_000,
      channels: 1,
    },
    error: null,
  };
}

async function setupSpan(executor) {
  const setup = await setupTranscription(executor);
  const accepted = await setup.service.accept(SCOPE, acceptanceCommand(setup.documents));
  assert.equal(accepted.ok, true, diagnosticJson(accepted));
  const timeline = await persistTimeline(executor, setup.repositories, accepted.value.transcript);
  const dispatch = await buildSelectedSpanAudioJob({
    projectRevisionId: IDS.revisionA,
    attemptId: LOCAL_IDS.spanAttempt,
    timelinePlanId: LOCAL_IDS.timelinePlan,
    transcriptId: accepted.value.transcript.transcriptId,
    span: timeline.span,
    sourceDurationMs: 12_000,
    sourceArtifactUri: objectUri(HASHES.voiceoverA, "wav"),
    cancelToken: "selected-span-cancel-token-never-persisted-000001",
  });
  await insertRunningAttempt(executor, {
    taskId: LOCAL_IDS.spanTask,
    attemptId: LOCAL_IDS.spanAttempt,
    taskKey: timeline.span.taskKey,
    lane: "PREPARE",
    inputHash: dispatch.inputHash,
  });
  return {
    ...setup,
    acceptedTranscript: accepted.value.transcript,
    timeline,
    dispatch,
    result: spanResult(dispatch, timeline.span),
  };
}

test("selected span job construction rejects unsafe task keys and fractional boundaries", async () => {
  const span = {
    spanId: LOCAL_IDS.span,
    spanKey: "span:owned:0",
    timelineSegmentId: LOCAL_IDS.timelineSegment,
    transcriptId: uuid(31_100),
    taskKey: "audio-span:\nforged",
    sourceAssetId: IDS.voiceoverA,
    sourceBinarySha256: HASHES.voiceoverA,
    selectedStartMs: 3000,
    selectedEndMsExclusive: 7000,
    paddedStartMs: 2500,
    paddedEndMsExclusive: 7500,
    trimStartMs: 500,
    trimEndMsExclusive: 4500,
    state: "PLANNED",
    materializedAssetId: null,
    materializedBinarySha256: null,
    version: 1,
    materializedAt: null,
  };
  const command = {
    projectRevisionId: IDS.revisionA,
    attemptId: LOCAL_IDS.spanAttempt,
    timelinePlanId: LOCAL_IDS.timelinePlan,
    transcriptId: span.transcriptId,
    span,
    sourceDurationMs: 12_000,
    sourceArtifactUri: objectUri(HASHES.voiceoverA, "wav"),
    cancelToken: "selected-span-cancel-token-never-persisted-000001",
  };
  await assert.rejects(() => buildSelectedSpanAudioJob(command), {
    code: "SPAN_INPUT_INVALID",
  });
  await assert.rejects(
    () =>
      buildSelectedSpanAudioJob({
        ...command,
        span: { ...span, taskKey: "audio-span:owned:0", selectedStartMs: 3000.5 },
      }),
    { code: "SPAN_INPUT_INVALID" },
  );
});

test("local ASR acceptance atomically binds attempt, artifact, exact timing and idempotent retry", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    const setup = await setupTranscription(executor);
    const first = await setup.service.accept(SCOPE, acceptanceCommand(setup.documents));
    assert.equal(first.ok, true, diagnosticJson(first));
    assert.equal(first.value.replayed, false);
    assert.equal(first.value.transcript.headVersion, 1);
    assert.equal(first.value.transcript.words.length, 9);
    assert.equal(first.value.transcript.sentences.length, 1);
    assert.equal(first.value.transcript.phrases.length, 2);
    assert.equal(first.value.acceptedAttempt.completion, "ACCEPTED");
    assert.equal(first.value.artifact.sourceAttemptId, LOCAL_IDS.asrAttempt);
    assert.equal(
      first.value.artifact.binarySha256,
      first.value.transcript.canonicalDocument.canonicalDocumentSha256,
    );
    assert.equal(setup.store.objects.size, 1);

    const retry = await setup.service.accept(SCOPE, acceptanceCommand(setup.documents));
    assert.equal(retry.ok, true, diagnosticJson(retry));
    assert.equal(retry.value.replayed, true);
    assert.deepEqual(retry.value.transcript, first.value.transcript);
    assert.equal(setup.store.objects.size, 1);

    const rows = await executor.query(
      `SELECT task.state AS task_state, attempt.state AS attempt_state,
              attempt.result_disposition, transcript.input_fingerprint_hash,
              document.source_attempt_id
         FROM generation_tasks task
         JOIN attempts attempt ON attempt.workspace_id = task.workspace_id
                              AND attempt.id = task.accepted_attempt_id
         JOIN assets document ON document.workspace_id = attempt.workspace_id
                             AND document.id = attempt.output_asset_id
         JOIN transcripts transcript ON transcript.workspace_id = task.workspace_id
                                    AND transcript.canonical_document_asset_id = document.id
        WHERE task.workspace_id = $1 AND task.id = $2`,
      [IDS.workspaceA, LOCAL_IDS.asrTask],
    );
    assert.deepEqual(rows.rows, [
      {
        task_state: "COMPLETE",
        attempt_state: "SUCCEEDED",
        result_disposition: "ACCEPTED",
        input_fingerprint_hash: first.value.inputFingerprintHash,
        source_attempt_id: LOCAL_IDS.asrAttempt,
      },
    ]);
  });
});

test("failed or mismatched ASR results never enter artifact, attempt, or timing state", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    const setup = await setupTranscription(executor);
    const documents = structuredClone(setup.documents);
    documents.result.status = "CANCELLED";
    documents.result.transcript = null;
    documents.result.diagnostics = null;
    documents.result.error = {
      code: "ASR_CANCELLED",
      message: "The local ASR attempt was cancelled.",
      retryable: false,
    };
    await assert.rejects(
      () => setup.service.accept(SCOPE, acceptanceCommand(documents)),
      (error) =>
        error instanceof DurableTranscriptionError && error.code === "ASR_RESULT_NOT_SUCCESSFUL",
    );
    assert.equal(setup.store.calls, 0);
    assert.equal(
      (await executor.query("SELECT count(*)::int AS count FROM transcripts")).rows[0].count,
      0,
    );
    assert.equal(
      (
        await executor.query(
          "SELECT count(*)::int AS count FROM assets WHERE kind = 'CANONICAL_DOCUMENT'",
        )
      ).rows[0].count,
      0,
    );
  });
});

test("a cancellation race rolls back local ASR artifact and timing acceptance", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    const setup = await setupTranscription(executor);
    await executor.query(
      `UPDATE generation_tasks
          SET state = 'CANCEL_REQUESTED', cancel_requested_at = $3, version = version + 1
        WHERE workspace_id = $1 AND id = $2`,
      [IDS.workspaceA, LOCAL_IDS.asrTask, FIXED_TIME],
    );
    const result = await setup.service.accept(SCOPE, acceptanceCommand(setup.documents));
    assert.equal(result.ok, false);
    assert.equal(result.kind, "CONFLICT");
    assert.equal(result.code, "STATE_CONFLICT");
    assert.equal(
      (await executor.query("SELECT count(*)::int AS count FROM transcripts")).rows[0].count,
      0,
    );
    assert.equal(
      (
        await executor.query(
          "SELECT count(*)::int AS count FROM assets WHERE kind = 'CANONICAL_DOCUMENT'",
        )
      ).rows[0].count,
      0,
    );
    const attempt = await executor.query(
      "SELECT state, output_asset_id FROM attempts WHERE id = $1",
      [LOCAL_IDS.asrAttempt],
    );
    assert.deepEqual(attempt.rows, [{ state: "RUNNING", output_asset_id: null }]);
  });
});

test("model invalidation preserves immutable transcription history and accepts exact replacement lineage", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    const setup = await setupTranscription(executor);
    const first = await setup.service.accept(SCOPE, acceptanceCommand(setup.documents));
    assert.equal(first.ok, true, diagnosticJson(first));

    const replacementDocuments = asrDocuments({
      attemptId: LOCAL_IDS.replacementAsrAttempt,
      modelHash: sha256("pinned-local-whisper-base-en-v2"),
    });
    const replacementCommand = acceptanceCommand(replacementDocuments, {
      taskId: LOCAL_IDS.replacementAsrTask,
      attemptId: LOCAL_IDS.replacementAsrAttempt,
      expectedHeadVersion: 2,
      lineageSequence: 2,
      supersedesTranscriptId: first.value.transcript.transcriptId,
    });
    const replacementPrepared = await prepareDurableLocalTranscription(SCOPE, replacementCommand);
    await insertRunningAttempt(executor, {
      taskId: LOCAL_IDS.replacementAsrTask,
      attemptId: LOCAL_IDS.replacementAsrAttempt,
      taskKey: "transcribe:local:revision-a:model-v2",
      lane: "TRANSCRIBE",
      inputHash: replacementPrepared.asrInputHash,
    });
    const invalidated = await setup.repositories.timing.invalidateTiming(SCOPE, {
      idempotencyKey: "timing:invalidate:vf-2-02-model-replacement",
      invalidationId: LOCAL_IDS.replacementInvalidation,
      projectId: IDS.projectA,
      projectRevisionId: IDS.revisionA,
      expectedHeadVersion: 1,
      nextInputFingerprintHash: replacementPrepared.inputFingerprintHash,
      reason: "MODEL_CHANGED",
      invalidatedAt: FIXED_TIME,
    });
    assert.equal(invalidated.ok, true, diagnosticJson(invalidated));
    assert.equal(invalidated.value.value.headVersion, 2);

    const replacement = await setup.service.accept(SCOPE, replacementCommand);
    assert.equal(replacement.ok, true, diagnosticJson(replacement));
    assert.equal(replacement.value.transcript.headVersion, 3);
    assert.equal(replacement.value.transcript.lineageSequence, 2);
    assert.equal(
      replacement.value.transcript.supersedesTranscriptId,
      first.value.transcript.transcriptId,
    );
    assert.notEqual(replacement.value.transcript.transcriptId, first.value.transcript.transcriptId);

    const lineage = await executor.query(
      `SELECT id, lineage_sequence, supersedes_transcript_id, model_hash
         FROM transcripts
        WHERE workspace_id = $1 AND project_revision_id = $2
        ORDER BY lineage_sequence`,
      [IDS.workspaceA, IDS.revisionA],
    );
    assert.deepEqual(lineage.rows, [
      {
        id: first.value.transcript.transcriptId,
        lineage_sequence: 1,
        supersedes_transcript_id: null,
        model_hash: MODEL_HASH,
      },
      {
        id: replacement.value.transcript.transcriptId,
        lineage_sequence: 2,
        supersedes_transcript_id: first.value.transcript.transcriptId,
        model_hash: sha256("pinned-local-whisper-base-en-v2"),
      },
    ]);
    assert.equal(setup.store.objects.size, 2);
  });
});

test("selected padded span acceptance is exact, attempt-bound and idempotent", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    const setup = await setupSpan(executor);
    const service = new DurableSelectedSpanAudioPersistence(setup.repositories);
    const command = {
      projectId: IDS.projectA,
      taskId: LOCAL_IDS.spanTask,
      expectedHeadVersion: 2,
      expectedSpanVersion: 1,
      jobInput: setup.dispatch.input,
      jobResult: setup.result,
      finishedAt: FIXED_TIME,
    };
    const first = await service.accept(SCOPE, command);
    assert.equal(first.ok, true, diagnosticJson(first));
    assert.equal(first.value.replayed, false);
    assert.equal(first.value.span.state, "MATERIALIZED");
    assert.equal(first.value.span.version, 2);
    assert.equal(first.value.span.materializedDurationMs, 5200);
    assert.equal(first.value.span.materializedAssetId, setup.dispatch.outputAssetId);
    assert.equal(first.value.artifact.kind, "AUDIO_SPAN");
    assert.equal(first.value.artifact.sourceAttemptId, LOCAL_IDS.spanAttempt);
    assert.equal(first.value.acceptedAttempt.completion, "ACCEPTED");

    const retry = await service.accept(SCOPE, command);
    assert.equal(retry.ok, true, diagnosticJson(retry));
    assert.equal(retry.value.replayed, true);
    assert.deepEqual(retry.value.span, first.value.span);
    const counts = await executor.query(
      `SELECT
         (SELECT count(*)::int FROM assets WHERE kind = 'AUDIO_SPAN') AS assets,
         (SELECT count(*)::int FROM selected_span_audio WHERE state = 'MATERIALIZED') AS spans,
         (SELECT count(*)::int FROM attempts WHERE result_disposition = 'ACCEPTED'
            AND task_id = $1) AS accepted_attempts`,
      [LOCAL_IDS.spanTask],
    );
    assert.deepEqual(counts.rows, [{ assets: 1, spans: 1, accepted_attempts: 1 }]);
  });
});

test("timing invalidation races roll back span artifact and accepted attempt without orphan state", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    const setup = await setupSpan(executor);
    const invalidated = await setup.repositories.timing.invalidateTiming(SCOPE, {
      idempotencyKey: "timing:invalidate:vf-2-02-span-race",
      invalidationId: LOCAL_IDS.invalidation,
      projectId: IDS.projectA,
      projectRevisionId: IDS.revisionA,
      expectedHeadVersion: 2,
      nextInputFingerprintHash: sha256("vf-2-02-invalidated-input"),
      reason: "SOURCE_CHANGED",
      invalidatedAt: FIXED_TIME,
    });
    assert.equal(invalidated.ok, true, diagnosticJson(invalidated));

    const service = new DurableSelectedSpanAudioPersistence(setup.repositories);
    const result = await service.accept(SCOPE, {
      projectId: IDS.projectA,
      taskId: LOCAL_IDS.spanTask,
      expectedHeadVersion: 2,
      expectedSpanVersion: 1,
      jobInput: setup.dispatch.input,
      jobResult: setup.result,
      finishedAt: FIXED_TIME,
    });
    assert.equal(result.ok, false);
    assert.equal(result.kind, "CONFLICT");
    assert.equal(result.code, "TIMING_HEAD_VERSION_MISMATCH");
    assert.equal(
      (await executor.query("SELECT count(*)::int AS count FROM assets WHERE kind = 'AUDIO_SPAN'"))
        .rows[0].count,
      0,
    );
    const span = await executor.query(
      "SELECT state, materialized_asset_id, version FROM selected_span_audio WHERE id = $1",
      [LOCAL_IDS.span],
    );
    assert.deepEqual(span.rows, [{ state: "PLANNED", materialized_asset_id: null, version: 1 }]);
    const attempt = await executor.query(
      "SELECT state, result_disposition, output_asset_id FROM attempts WHERE id = $1",
      [LOCAL_IDS.spanAttempt],
    );
    assert.deepEqual(attempt.rows, [
      { state: "RUNNING", result_disposition: "PENDING", output_asset_id: null },
    ]);
  });
});

test("span result lineage mismatch is rejected before database mutation", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    const setup = await setupSpan(executor);
    const mismatched = structuredClone(setup.result);
    mismatched.selection.trim_end_ms_exclusive -= 1;
    const service = new DurableSelectedSpanAudioPersistence(setup.repositories);
    await assert.rejects(
      () =>
        service.accept(SCOPE, {
          projectId: IDS.projectA,
          taskId: LOCAL_IDS.spanTask,
          expectedHeadVersion: 2,
          expectedSpanVersion: 1,
          jobInput: setup.dispatch.input,
          jobResult: mismatched,
          finishedAt: FIXED_TIME,
        }),
      (error) => error?.code === "SPAN_RESULT_MISMATCH",
    );
    assert.equal(
      (await executor.query("SELECT count(*)::int AS count FROM assets WHERE kind = 'AUDIO_SPAN'"))
        .rows[0].count,
      0,
    );
  });
});

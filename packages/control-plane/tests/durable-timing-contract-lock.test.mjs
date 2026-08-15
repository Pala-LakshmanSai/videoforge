import assert from "node:assert/strict";
import test from "node:test";

import {
  exportMetadataSnapshot,
  restoreMetadataSnapshot,
  serializeMetadataSnapshot,
} from "../dist/src/index.js";
import { createPGliteControlPlaneRepositories } from "../dist/src/adapters/index.js";
import { HASHES, IDS, seedLockedProjects } from "./support/fixtures.mjs";
import {
  expectDatabaseError,
  createMigratedDatabase,
  FIXED_TIME,
  sha256,
  uuid,
  withMigratedDatabase,
} from "./support/pglite.mjs";

const SCOPE_A = Object.freeze({
  accountId: IDS.accountA,
  workspaceId: IDS.workspaceA,
  actorUserId: IDS.userA,
});
const SCOPE_B = Object.freeze({
  accountId: IDS.accountB,
  workspaceId: IDS.workspaceB,
  actorUserId: IDS.userB,
});

const TIMING_IDS = Object.freeze({
  transcriptDocument: uuid(30_001),
  timelineDocument: uuid(30_002),
  transcript: uuid(30_003),
  word0: uuid(30_004),
  word1: uuid(30_005),
  sentence: uuid(30_006),
  phrase0: uuid(30_007),
  phrase1: uuid(30_008),
  timelinePlan: uuid(30_009),
  segment: uuid(30_010),
  span: uuid(30_011),
  replacementDocument: uuid(30_012),
  replacementTranscript: uuid(30_013),
  replacementWord0: uuid(30_014),
  replacementWord1: uuid(30_015),
  replacementSentence: uuid(30_016),
  replacementPhrase0: uuid(30_017),
  replacementPhrase1: uuid(30_018),
  invalidation: uuid(30_019),
  replacementTimelinePlan: uuid(30_020),
  replacementSegment: uuid(30_021),
  replacementSpan: uuid(30_022),
});

const TIMING_HASHES = Object.freeze({
  transcriptDocument: sha256("durable-transcript-document"),
  timelineDocument: sha256("durable-timeline-document"),
  model: sha256("durable-transcript-model"),
  transcriptConfig: sha256("durable-transcript-config"),
  transcriptInput: sha256("durable-transcript-input"),
  timelineConfig: sha256("durable-timeline-config"),
  timelineInput: sha256("durable-timeline-input"),
  replacementDocument: sha256("durable-replacement-transcript-document"),
  replacementModel: sha256("durable-replacement-transcript-model"),
  replacementConfig: sha256("durable-replacement-transcript-config"),
  replacementInput: sha256("durable-replacement-transcript-input"),
  replacementTimelineInput: sha256("durable-replacement-timeline-input"),
});

async function insertCanonicalDocument(executor, id, contractName, contractVersion, hash) {
  await executor.query(
    `INSERT INTO public.assets (
       id, workspace_id, project_id, project_revision_id, kind, state,
       canonical_contract_name, canonical_contract_version,
       canonical_document_sha256, content_type, verified_at
     ) VALUES ($1, $2, $3, $4, 'CANONICAL_DOCUMENT', 'VERIFIED', $5, $6, $7,
               'application/json', $8)`,
    [
      id,
      IDS.workspaceA,
      IDS.projectA,
      IDS.revisionA,
      contractName,
      contractVersion,
      hash,
      FIXED_TIME,
    ],
  );
}

async function seedTimingDocuments(executor) {
  await insertCanonicalDocument(
    executor,
    TIMING_IDS.transcriptDocument,
    "transcript-timing",
    "v1",
    TIMING_HASHES.transcriptDocument,
  );
  await insertCanonicalDocument(
    executor,
    TIMING_IDS.timelineDocument,
    "timeline-plan",
    "v1",
    TIMING_HASHES.timelineDocument,
  );
  await insertCanonicalDocument(
    executor,
    TIMING_IDS.replacementDocument,
    "transcript-timing",
    "v1",
    TIMING_HASHES.replacementDocument,
  );
}

function transcriptCommand(overrides = {}) {
  return {
    idempotencyKey: "timing:transcript:initial",
    projectId: IDS.projectA,
    projectRevisionId: IDS.revisionA,
    expectedHeadVersion: 0,
    transcriptId: TIMING_IDS.transcript,
    lineageSequence: 1,
    supersedesTranscriptId: null,
    sourceAssetId: IDS.voiceoverA,
    sourceBinarySha256: HASHES.voiceoverA,
    sourceDurationMs: 12_000,
    engineName: "fixture-asr",
    engineVersion: "1.0.0",
    modelName: "fixture-model",
    modelSha256: TIMING_HASHES.model,
    language: "en",
    transcriptionConfigHash: TIMING_HASHES.transcriptConfig,
    optionalScriptHash: null,
    inputFingerprintHash: TIMING_HASHES.transcriptInput,
    canonicalDocumentAssetId: TIMING_IDS.transcriptDocument,
    canonicalDocument: {
      contractName: "transcript-timing",
      contractVersion: "v1",
      payload: { schema_version: "transcript-timing/v1", source: "fixture" },
      canonicalDocumentSha256: TIMING_HASHES.transcriptDocument,
    },
    words: [
      {
        wordId: TIMING_IDS.word0,
        index: 0,
        text: "Exact",
        startMs: 0,
        endMsExclusive: 6_000,
        confidence: 0.99,
      },
      {
        wordId: TIMING_IDS.word1,
        index: 1,
        text: "timing.",
        startMs: 6_000,
        endMsExclusive: 12_000,
        confidence: 0.98,
      },
    ],
    sentences: [
      {
        sentenceId: TIMING_IDS.sentence,
        sentenceKey: "sentence:0",
        index: 0,
        wordStart: 0,
        wordEndExclusive: 2,
        startMs: 0,
        endMsExclusive: 12_000,
        text: "Exact timing.",
      },
    ],
    phrases: [
      {
        phraseId: TIMING_IDS.phrase0,
        phraseKey: "phrase:0",
        sentenceId: TIMING_IDS.sentence,
        index: 0,
        wordStart: 0,
        wordEndExclusive: 1,
        startMs: 0,
        endMsExclusive: 6_000,
        pauseBeforeMs: 0,
        pauseAfterMs: 0,
        text: "Exact",
      },
      {
        phraseId: TIMING_IDS.phrase1,
        phraseKey: "phrase:1",
        sentenceId: TIMING_IDS.sentence,
        index: 1,
        wordStart: 1,
        wordEndExclusive: 2,
        startMs: 6_000,
        endMsExclusive: 12_000,
        pauseBeforeMs: 0,
        pauseAfterMs: 0,
        text: "timing.",
      },
    ],
    createdAt: FIXED_TIME,
    ...overrides,
  };
}

function timelineCommand(overrides = {}) {
  return {
    idempotencyKey: "timing:timeline:initial",
    projectId: IDS.projectA,
    projectRevisionId: IDS.revisionA,
    expectedHeadVersion: 1,
    timelinePlanId: TIMING_IDS.timelinePlan,
    transcriptId: TIMING_IDS.transcript,
    planSequence: 1,
    supersedesTimelinePlanId: null,
    revisionConfigHash: HASHES.revisionA,
    transcriptDocumentHash: TIMING_HASHES.transcriptDocument,
    schedulerVersion: "fixture-scheduler/1",
    schedulerConfigHash: TIMING_HASHES.timelineConfig,
    seed: 42n,
    inputFingerprintHash: TIMING_HASHES.timelineInput,
    canonicalDocumentAssetId: TIMING_IDS.timelineDocument,
    canonicalDocument: {
      contractName: "timeline-plan",
      contractVersion: "v1",
      payload: { schema_version: "timeline-plan/v1", source: "fixture" },
      canonicalDocumentSha256: TIMING_HASHES.timelineDocument,
    },
    outputFpsNum: 30,
    outputFpsDen: 1,
    totalFrames: 360,
    segments: [
      {
        segmentId: TIMING_IDS.segment,
        segmentKey: "segment:0",
        index: 0,
        startFrame: 0,
        endFrameExclusive: 360,
        sourceAudioStartMs: 0,
        sourceAudioEndMsExclusive: 12_000,
        wordStart: 0,
        wordEndExclusive: 2,
        timelineComposition: "AVATAR_FULL",
        inImageShotRole: null,
        narration: "Exact timing.",
        requiredSlots: {
          avatar: {
            task_key: "avatar:segment:0",
            span_audio_task_key: "audio-span:segment:0",
          },
        },
      },
    ],
    selectedSpanAudio: [
      {
        spanId: TIMING_IDS.span,
        spanKey: "span:0",
        timelineSegmentId: TIMING_IDS.segment,
        transcriptId: TIMING_IDS.transcript,
        taskKey: "audio-span:segment:0",
        sourceAssetId: IDS.voiceoverA,
        sourceBinarySha256: HASHES.voiceoverA,
        selectedStartMs: 0,
        selectedEndMsExclusive: 12_000,
        paddedStartMs: 0,
        paddedEndMsExclusive: 12_000,
        trimStartMs: 0,
        trimEndMsExclusive: 12_000,
      },
    ],
    createdAt: FIXED_TIME,
    ...overrides,
  };
}

function replacementTranscriptCommand() {
  return transcriptCommand({
    idempotencyKey: "timing:transcript:replacement",
    expectedHeadVersion: 3,
    transcriptId: TIMING_IDS.replacementTranscript,
    lineageSequence: 2,
    supersedesTranscriptId: TIMING_IDS.transcript,
    modelName: "fixture-model-v2",
    modelSha256: TIMING_HASHES.replacementModel,
    transcriptionConfigHash: TIMING_HASHES.replacementConfig,
    inputFingerprintHash: TIMING_HASHES.replacementInput,
    canonicalDocumentAssetId: TIMING_IDS.replacementDocument,
    canonicalDocument: {
      contractName: "transcript-timing",
      contractVersion: "v1",
      payload: { schema_version: "transcript-timing/v1", source: "replacement-fixture" },
      canonicalDocumentSha256: TIMING_HASHES.replacementDocument,
    },
    words: [
      { ...transcriptCommand().words[0], wordId: TIMING_IDS.replacementWord0 },
      { ...transcriptCommand().words[1], wordId: TIMING_IDS.replacementWord1 },
    ],
    sentences: [
      { ...transcriptCommand().sentences[0], sentenceId: TIMING_IDS.replacementSentence },
    ],
    phrases: [
      {
        ...transcriptCommand().phrases[0],
        phraseId: TIMING_IDS.replacementPhrase0,
        sentenceId: TIMING_IDS.replacementSentence,
      },
      {
        ...transcriptCommand().phrases[1],
        phraseId: TIMING_IDS.replacementPhrase1,
        sentenceId: TIMING_IDS.replacementSentence,
      },
    ],
  });
}

function replacementTimelineCommand() {
  const initial = timelineCommand();
  return timelineCommand({
    idempotencyKey: "timing:timeline:replacement",
    expectedHeadVersion: 4,
    timelinePlanId: TIMING_IDS.replacementTimelinePlan,
    transcriptId: TIMING_IDS.replacementTranscript,
    planSequence: 2,
    supersedesTimelinePlanId: TIMING_IDS.timelinePlan,
    transcriptDocumentHash: TIMING_HASHES.replacementDocument,
    inputFingerprintHash: TIMING_HASHES.replacementTimelineInput,
    segments: [
      {
        ...initial.segments[0],
        segmentId: TIMING_IDS.replacementSegment,
        segmentKey: "segment:replacement:0",
      },
    ],
    selectedSpanAudio: [
      {
        ...initial.selectedSpanAudio[0],
        spanId: TIMING_IDS.replacementSpan,
        spanKey: "span:replacement:0",
        timelineSegmentId: TIMING_IDS.replacementSegment,
        transcriptId: TIMING_IDS.replacementTranscript,
      },
    ],
  });
}

async function immutableHistorySnapshot(executor) {
  const result = await executor.query(
    `SELECT jsonb_build_object(
       'transcript', (SELECT to_jsonb(row) FROM transcripts row WHERE id = $1),
       'words', (SELECT jsonb_agg(to_jsonb(row) ORDER BY word_index)
                   FROM transcript_words row WHERE transcript_id = $1),
       'sentences', (SELECT jsonb_agg(to_jsonb(row) ORDER BY sentence_index)
                       FROM transcript_sentences row WHERE transcript_id = $1),
       'phrases', (SELECT jsonb_agg(to_jsonb(row) ORDER BY phrase_index)
                     FROM transcript_phrases row WHERE transcript_id = $1),
       'plan', (SELECT to_jsonb(row) FROM timeline_plans row WHERE id = $2),
       'segments', (SELECT jsonb_agg(to_jsonb(row) ORDER BY segment_index)
                      FROM timeline_segments row WHERE timeline_plan_id = $2),
       'spans', (SELECT jsonb_agg(to_jsonb(row) ORDER BY span_key)
                   FROM selected_span_audio row WHERE timeline_plan_id = $2)
     ) AS snapshot`,
    [TIMING_IDS.transcript, TIMING_IDS.timelinePlan],
  );
  return result.rows[0].snapshot;
}

test("durable timing persists exact lineage, replays deterministically, and fails closed", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedLockedProjects(executor);
    await seedTimingDocuments(executor);
    const repositories = createPGliteControlPlaneRepositories(executor);

    const crossWorkspaceWrite = await repositories.timing.persistTranscriptTiming(
      SCOPE_B,
      transcriptCommand({ idempotencyKey: "timing:transcript:cross-workspace" }),
    );
    assert.deepEqual(crossWorkspaceWrite, {
      ok: false,
      kind: "NOT_FOUND",
      entity: "PROJECT",
      id: IDS.projectA,
    });

    const transcript = await repositories.timing.persistTranscriptTiming(
      SCOPE_A,
      transcriptCommand(),
    );
    assert.equal(transcript.ok, true, JSON.stringify(transcript));
    assert.equal(transcript.value.replayed, false);
    assert.equal(transcript.value.value.headVersion, 1);
    assert.equal(transcript.value.value.words[0].confidence, 0.99);
    const transcriptRetry = await repositories.timing.persistTranscriptTiming(
      SCOPE_A,
      transcriptCommand(),
    );
    assert.equal(transcriptRetry.ok, true);
    assert.equal(transcriptRetry.value.replayed, true);
    assert.deepEqual(transcriptRetry.value.value, transcript.value.value);

    const staleSource = await repositories.timing.persistTimelinePlan(
      SCOPE_A,
      timelineCommand({
        idempotencyKey: "timing:timeline:stale-revision",
        revisionConfigHash: sha256("stale-revision-config"),
      }),
    );
    assert.deepEqual(staleSource, {
      ok: false,
      kind: "INVARIANT_VIOLATION",
      code: "TIMING_INPUT_MISMATCH",
      message: "timeline revision configuration hash is stale",
    });

    const plan = await repositories.timing.persistTimelinePlan(SCOPE_A, timelineCommand());
    assert.equal(plan.ok, true);
    assert.equal(plan.value.replayed, false);
    assert.equal(plan.value.value.headVersion, 2);
    const planRetry = await repositories.timing.persistTimelinePlan(SCOPE_A, timelineCommand());
    assert.equal(planRetry.ok, true);
    assert.equal(planRetry.value.replayed, true);
    assert.deepEqual(planRetry.value.value, plan.value.value);

    const resolved = await repositories.timing.resolveExactPlan(SCOPE_A, {
      projectId: IDS.projectA,
      projectRevisionId: IDS.revisionA,
      transcriptInputFingerprintHash: TIMING_HASHES.transcriptInput,
      timelineInputFingerprintHash: TIMING_HASHES.timelineInput,
    });
    assert.equal(resolved.ok, true);
    assert.equal(resolved.value.headVersion, 2);
    assert.deepEqual(resolved.value.transcript, { ...transcript.value.value, headVersion: 2 });
    assert.deepEqual(resolved.value.timelinePlan, plan.value.value);

    const wrongWorkspace = await repositories.timing.resolveExactPlan(SCOPE_B, {
      projectId: IDS.projectA,
      projectRevisionId: IDS.revisionA,
      transcriptInputFingerprintHash: TIMING_HASHES.transcriptInput,
      timelineInputFingerprintHash: TIMING_HASHES.timelineInput,
    });
    assert.deepEqual(wrongWorkspace, {
      ok: false,
      kind: "NOT_FOUND",
      entity: "PROJECT",
      id: IDS.projectA,
    });

    const staleHead = await repositories.timing.persistTimelinePlan(
      SCOPE_A,
      timelineCommand({
        idempotencyKey: "timing:timeline:stale-head",
        timelinePlanId: uuid(30_100),
        inputFingerprintHash: sha256("stale-head-plan-input"),
      }),
    );
    assert.equal(staleHead.ok, false);
    assert.equal(staleHead.kind, "CONFLICT");
    assert.equal(staleHead.code, "TIMING_HEAD_VERSION_MISMATCH");
    assert.equal(staleHead.currentVersion, 2);

    const historyBefore = await immutableHistorySnapshot(executor);
    const invalidationCommand = {
      idempotencyKey: "timing:invalidate:model-change",
      invalidationId: TIMING_IDS.invalidation,
      projectId: IDS.projectA,
      projectRevisionId: IDS.revisionA,
      expectedHeadVersion: 2,
      nextInputFingerprintHash: TIMING_HASHES.replacementInput,
      reason: "MODEL_CHANGED",
      invalidatedAt: FIXED_TIME,
    };
    const invalidation = await repositories.timing.invalidateTiming(SCOPE_A, invalidationCommand);
    assert.equal(invalidation.ok, true);
    assert.equal(invalidation.value.replayed, false);
    assert.equal(invalidation.value.value.headVersion, 3);
    assert.equal(invalidation.value.value.invalidatedTranscriptId, TIMING_IDS.transcript);
    assert.equal(invalidation.value.value.invalidatedTimelinePlanId, TIMING_IDS.timelinePlan);
    const invalidationRetry = await repositories.timing.invalidateTiming(
      SCOPE_A,
      invalidationCommand,
    );
    assert.equal(invalidationRetry.ok, true);
    assert.equal(invalidationRetry.value.replayed, true);
    assert.deepEqual(invalidationRetry.value.value, invalidation.value.value);

    const historyAfter = await immutableHistorySnapshot(executor);
    assert.deepEqual(historyAfter, historyBefore, "invalidation must not mutate timing history");
    const noLongerActive = await repositories.timing.resolveExactPlan(SCOPE_A, {
      projectId: IDS.projectA,
      projectRevisionId: IDS.revisionA,
      transcriptInputFingerprintHash: TIMING_HASHES.transcriptInput,
      timelineInputFingerprintHash: TIMING_HASHES.timelineInput,
    });
    assert.equal(noLongerActive.ok, false);
    assert.equal(noLongerActive.kind, "NOT_FOUND");
    assert.equal(noLongerActive.entity, "TIMELINE_PLAN");

    const replacement = await repositories.timing.persistTranscriptTiming(
      SCOPE_A,
      replacementTranscriptCommand(),
    );
    assert.equal(replacement.ok, true);
    assert.equal(replacement.value.value.headVersion, 4);
    assert.equal(replacement.value.value.lineageSequence, 2);
    assert.equal(replacement.value.value.supersedesTranscriptId, TIMING_IDS.transcript);
    const lineage = await executor.query(
      `SELECT id, lineage_sequence, supersedes_transcript_id
         FROM transcripts
        WHERE workspace_id = $1 AND project_revision_id = $2
        ORDER BY lineage_sequence`,
      [IDS.workspaceA, IDS.revisionA],
    );
    assert.deepEqual(lineage.rows, [
      { id: TIMING_IDS.transcript, lineage_sequence: 1, supersedes_transcript_id: null },
      {
        id: TIMING_IDS.replacementTranscript,
        lineage_sequence: 2,
        supersedes_transcript_id: TIMING_IDS.transcript,
      },
    ]);

    const replacementPlan = await repositories.timing.persistTimelinePlan(
      SCOPE_A,
      replacementTimelineCommand(),
    );
    assert.equal(replacementPlan.ok, true);
    assert.equal(replacementPlan.value.value.headVersion, 5);
    assert.equal(replacementPlan.value.value.supersedesTimelinePlanId, TIMING_IDS.timelinePlan);

    const serialized = serializeMetadataSnapshot(await exportMetadataSnapshot(executor));
    const destination = await createMigratedDatabase();
    try {
      const restored = await restoreMetadataSnapshot(destination.executor, serialized);
      assert.equal(restored.alreadyRestored, false);
      assert.equal(
        serializeMetadataSnapshot(await exportMetadataSnapshot(destination.executor)),
        serialized,
      );
      const restoredRepositories = createPGliteControlPlaneRepositories(destination.executor);
      const restoredPlan = await restoredRepositories.timing.resolveExactPlan(SCOPE_A, {
        projectId: IDS.projectA,
        projectRevisionId: IDS.revisionA,
        transcriptInputFingerprintHash: TIMING_HASHES.replacementInput,
        timelineInputFingerprintHash: TIMING_HASHES.replacementTimelineInput,
      });
      assert.equal(restoredPlan.ok, true);
      assert.equal(restoredPlan.value.headVersion, 5);
      assert.equal(restoredPlan.value.transcript.lineageSequence, 2);
      assert.equal(restoredPlan.value.timelinePlan.planSequence, 2);
    } finally {
      await destination.database.close();
    }
  });
});

test("database constraints reject incomplete coverage and preserve immutable history", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedLockedProjects(executor);
    await seedTimingDocuments(executor);
    const repositories = createPGliteControlPlaneRepositories(executor);
    const transcript = await repositories.timing.persistTranscriptTiming(
      SCOPE_A,
      transcriptCommand(),
    );
    assert.equal(transcript.ok, true, JSON.stringify(transcript));
    assert.equal(
      (await repositories.timing.persistTimelinePlan(SCOPE_A, timelineCommand())).ok,
      true,
    );

    await expectDatabaseError(
      () =>
        executor.query("UPDATE transcript_words SET word = 'mutated' WHERE id = $1", [
          TIMING_IDS.word0,
        ]),
      "23514",
    );
    await expectDatabaseError(
      () => executor.query("DELETE FROM timeline_segments WHERE id = $1", [TIMING_IDS.segment]),
      "23514",
    );

    const invalidPlanId = uuid(30_200);
    const invalidSegmentId = uuid(30_201);
    const invalidSpanId = uuid(30_202);
    await expectDatabaseError(
      () =>
        executor.transaction(async (transaction) => {
          await transaction.query(
            `INSERT INTO timeline_plans (
               id, workspace_id, project_revision_id, transcript_id, plan_sequence,
               supersedes_timeline_plan_id, revision_config_hash, transcript_document_hash,
               scheduler_version, scheduler_config_hash, seed, input_fingerprint_hash,
               contract_name, contract_version, canonical_document_asset_id,
               canonical_document_hash, output_fps_num, output_fps_den, total_frames,
               idempotency_key, created_by_user_id, created_at
             ) VALUES ($1, $2, $3, $4, 2, $5, $6, $7, 'fixture-scheduler/1', $8, 42,
                       $9, 'timeline-plan', 'v1', $10, $11, 30, 1, 360, $12, $13, $14)`,
            [
              invalidPlanId,
              IDS.workspaceA,
              IDS.revisionA,
              TIMING_IDS.transcript,
              TIMING_IDS.timelinePlan,
              HASHES.revisionA,
              TIMING_HASHES.transcriptDocument,
              TIMING_HASHES.timelineConfig,
              sha256("invalid-gap-timeline-input"),
              TIMING_IDS.timelineDocument,
              TIMING_HASHES.timelineDocument,
              "timing:timeline:invalid-gap",
              IDS.userA,
              FIXED_TIME,
            ],
          );
          await transaction.query(
            `INSERT INTO timeline_segments (
               id, workspace_id, project_revision_id, timeline_plan_id, segment_key,
               segment_index, start_frame, end_frame_exclusive, source_audio_start_ms,
               source_audio_end_ms_exclusive, word_start, word_end_exclusive,
               timeline_composition, in_image_shot_role, narration, required_slots,
               timeline_plan_hash, created_at
             ) VALUES ($1, $2, $3, $4, 'invalid-gap', 0, 1, 360, 0, 12000, 0, 2,
                       'AVATAR_FULL', NULL, 'Invalid gap', $5::jsonb, $6, $7)`,
            [
              invalidSegmentId,
              IDS.workspaceA,
              IDS.revisionA,
              invalidPlanId,
              JSON.stringify({
                avatar: {
                  task_key: "avatar:invalid-gap",
                  span_audio_task_key: "audio-span:invalid-gap",
                },
              }),
              TIMING_HASHES.timelineDocument,
              FIXED_TIME,
            ],
          );
          await transaction.query(
            `INSERT INTO selected_span_audio (
               id, workspace_id, project_revision_id, timeline_plan_id, timeline_segment_id,
               transcript_id, span_key, task_key, source_asset_id, source_binary_sha256,
               selected_start_ms, selected_end_ms_exclusive, padded_start_ms,
               padded_end_ms_exclusive, trim_start_ms, trim_end_ms_exclusive, state, created_at
             ) VALUES ($1, $2, $3, $4, $5, $6, 'invalid-gap', 'audio-span:invalid-gap',
                       $7, $8, 0, 12000, 0, 12000, 0, 12000, 'PLANNED', $9)`,
            [
              invalidSpanId,
              IDS.workspaceA,
              IDS.revisionA,
              invalidPlanId,
              invalidSegmentId,
              TIMING_IDS.transcript,
              IDS.voiceoverA,
              HASHES.voiceoverA,
              FIXED_TIME,
            ],
          );
        }),
      "23514",
    );
    const rolledBack = await executor.query("SELECT count(*)::int AS count FROM timeline_plans");
    assert.equal(rolledBack.rows[0].count, 1);
  });
});

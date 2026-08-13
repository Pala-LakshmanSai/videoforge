import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { canonicalizeJson, validateAndHashContractDocument } from "@videoforge/contracts";
import {
  buildSelectedSpanAudioJob,
  DurableDeterministicTimelinePersistence,
  DurableSelectedSpanAudioPersistence,
  exportMetadataSnapshot,
  prepareDurableDeterministicTimeline,
  restoreMetadataSnapshot,
  serializeMetadataSnapshot,
} from "../dist/src/index.js";
import { createPGliteControlPlaneRepositories } from "../dist/src/adapters/index.js";
import { HASHES, IDS, seedLockedProjects } from "./support/fixtures.mjs";
import {
  createMigratedDatabase,
  FIXED_TIME,
  sha256,
  uuid,
  withMigratedDatabase,
} from "./support/pglite.mjs";

const SCOPE = Object.freeze({ workspaceId: IDS.workspaceA, actorUserId: IDS.userA });
const TRANSCRIPT_ID = uuid(32_001);
const TRANSCRIPT_ASSET_ID = uuid(32_002);
const TRANSCRIPT_INPUT_HASH = sha256("vf-2-03-transcript-input");
const TRANSCRIPT_CONFIG_HASH = sha256("vf-2-03-transcript-config");
const MODEL_HASH = sha256("vf-2-03-model");
const REVISION_SEED = 982_341;

const diagnostic = (value) =>
  JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? String(item) : item));

class MemoryTimelineStore {
  constructor() {
    this.objects = new Map();
  }

  async putIfAbsent(write) {
    const existing = this.objects.get(write.objectKey);
    if (existing !== undefined) {
      assert.equal(existing.binarySha256, write.binarySha256);
      assert.deepEqual(existing.bytes, write.bytes);
      return {
        objectKey: write.objectKey,
        binarySha256: existing.binarySha256,
        byteSize: BigInt(existing.bytes.byteLength),
        replayed: true,
      };
    }
    const bytes = write.bytes.slice();
    this.objects.set(write.objectKey, { bytes, binarySha256: write.binarySha256 });
    return {
      objectKey: write.objectKey,
      binarySha256: write.binarySha256,
      byteSize: BigInt(bytes.byteLength),
      replayed: false,
    };
  }

  async getExact(objectKey) {
    const stored = this.objects.get(objectKey);
    return stored === undefined
      ? null
      : {
          objectKey,
          bytes: stored.bytes.slice(),
          binarySha256: stored.binarySha256,
          byteSize: BigInt(stored.bytes.byteLength),
        };
  }

  corrupt(objectKey) {
    const stored = this.objects.get(objectKey);
    assert.notEqual(stored, undefined);
    stored.bytes[0] ^= 0xff;
  }
}

function revisionValue() {
  return {
    schema_version: "project-revision-config/v2",
    project_id: IDS.projectA,
    project_revision_id: IDS.revisionA,
    title: "Durable deterministic timeline",
    voiceover_asset_id: IDS.voiceoverA,
    voiceover_sha256: HASHES.voiceoverA,
    avatar_binding: {
      avatar_profile_id: IDS.avatarProfileA,
      avatar_profile_version_id: IDS.avatarVersionA,
      avatar_display_name_snapshot: "Owned Presenter",
      avatar_profile_hash: HASHES.avatarProfileA,
      runtime_source_asset_id: IDS.avatarRuntimeA,
      runtime_source_sha256: HASHES.avatarRuntimeA,
      source_preparation_version: "owned-preparation-v1",
      source_validation_profile_version: "owned-validation-v1",
      compatibility_state_at_preflight: "UNTESTED",
      compatibility_evidence: null,
    },
    optional_script: null,
    image_style_version_id: IDS.styleVersionA,
    style_profile_hash: HASHES.styleA,
    extra_prompt_keywords: null,
    apply_extra_prompt_keywords: false,
    generation_mode: "BALANCED",
    execution_profiles: {
      image_media_profile_id: IDS.executionProfileA,
      avatar_primary_profile_id: IDS.executionProfileA,
      avatar_repair_profile_id: null,
      avatar_quality_profile_id: null,
    },
    spend_cap_usd: 1.5,
    scheduler_version: "scheduler-v2",
    scheduler_seed: REVISION_SEED,
    prompt_writer_version: "fixture-prompt-writer-v1",
    prompt_compiler_version: "fixture-prompt-compiler-v1",
  };
}

function transcriptValue() {
  const starts = Array.from({ length: 10 }, (_, index) => 500 + index * 4_000);
  const words = [];
  const phrases = starts.map((startMs, index) => {
    const wordStart = words.length;
    const endMs = Math.min(startMs + 3_000, 39_000);
    for (let offset = 0; offset < endMs - startMs; offset += 500) {
      words.push({
        index: words.length,
        text: `phrase-${String(index)}-word-${String(offset / 500)}${offset + 500 === endMs - startMs ? "." : ""}`,
        start_ms: startMs + offset,
        end_ms: startMs + offset + 500,
        confidence: 0.99,
      });
    }
    return {
      phrase_id: `durable_phrase_${String(index).padStart(2, "0")}`,
      sentence_id: `durable_sentence_${String(index).padStart(2, "0")}`,
      word_start: wordStart,
      word_end_exclusive: words.length,
      start_ms: startMs,
      end_ms: endMs,
      pause_before_ms: index === 0 ? 500 : 1_000,
      pause_after_ms: 1_000,
      text: words
        .slice(wordStart)
        .map((word) => word.text)
        .join(" "),
    };
  });
  return {
    schema_version: "transcript-timing/v1",
    project_revision_id: IDS.revisionA,
    source: {
      asset_id: IDS.voiceoverA,
      sha256: HASHES.voiceoverA,
      duration_ms: 40_000,
    },
    engine: {
      name: "whisper.cpp",
      version: "fixture-1.0.0",
      model_name: "base.en",
      model_sha256: MODEL_HASH,
      language: "en",
    },
    text: words.map((word) => word.text).join(" "),
    words,
    phrases,
  };
}

async function seedDurableTranscript(executor, repositories, revision, transcript) {
  await executor.query(
    `INSERT INTO assets (
       id, workspace_id, project_id, project_revision_id, kind, state, object_key,
       binary_sha256, canonical_contract_name, canonical_contract_version,
       canonical_document_sha256, content_type, byte_size, verified_at
     ) VALUES ($1, $2, $3, $4, 'CANONICAL_DOCUMENT', 'VERIFIED', $5, $6,
               'transcript-timing', 'v1', $6, 'application/json', $7, $8)`,
    [
      TRANSCRIPT_ASSET_ID,
      IDS.workspaceA,
      IDS.projectA,
      IDS.revisionA,
      "workspace/fixture/transcript.json",
      transcript.sha256,
      BigInt(new TextEncoder().encode(canonicalizeJson(transcript.value)).byteLength),
      FIXED_TIME,
    ],
  );
  const persisted = await repositories.timing.persistTranscriptTiming(SCOPE, {
    idempotencyKey: "vf-2-03:transcript",
    projectId: IDS.projectA,
    projectRevisionId: IDS.revisionA,
    expectedHeadVersion: 0,
    transcriptId: TRANSCRIPT_ID,
    lineageSequence: 1,
    supersedesTranscriptId: null,
    sourceAssetId: IDS.voiceoverA,
    sourceBinarySha256: HASHES.voiceoverA,
    sourceDurationMs: transcript.value.source.duration_ms,
    engineName: transcript.value.engine.name,
    engineVersion: transcript.value.engine.version,
    modelName: transcript.value.engine.model_name,
    modelSha256: transcript.value.engine.model_sha256,
    language: transcript.value.engine.language,
    transcriptionConfigHash: TRANSCRIPT_CONFIG_HASH,
    optionalScriptHash: null,
    inputFingerprintHash: TRANSCRIPT_INPUT_HASH,
    canonicalDocumentAssetId: TRANSCRIPT_ASSET_ID,
    canonicalDocument: {
      contractName: "transcript-timing",
      contractVersion: "v1",
      payload: transcript.value,
      canonicalDocumentSha256: transcript.sha256,
    },
    words: transcript.value.words.map((word, index) => ({
      wordId: uuid(32_100 + index),
      index: word.index,
      text: word.text,
      startMs: word.start_ms,
      endMsExclusive: word.end_ms,
      confidence: word.confidence,
    })),
    sentences: transcript.value.phrases.map((phrase, index) => ({
      sentenceId: uuid(32_200 + index),
      sentenceKey: phrase.sentence_id,
      index,
      wordStart: phrase.word_start,
      wordEndExclusive: phrase.word_end_exclusive,
      startMs: phrase.start_ms,
      endMsExclusive: phrase.end_ms,
      text: phrase.text,
    })),
    phrases: transcript.value.phrases.map((phrase, index) => ({
      phraseId: uuid(32_300 + index),
      phraseKey: phrase.phrase_id,
      sentenceId: uuid(32_200 + index),
      index,
      wordStart: phrase.word_start,
      wordEndExclusive: phrase.word_end_exclusive,
      startMs: phrase.start_ms,
      endMsExclusive: phrase.end_ms,
      pauseBeforeMs: phrase.pause_before_ms,
      pauseAfterMs: phrase.pause_after_ms,
      text: phrase.text,
    })),
    createdAt: FIXED_TIME,
  });
  assert.equal(persisted.ok, true, diagnostic(persisted));
  return persisted.value.value;
}

function persistCommand(revision, transcript) {
  return {
    projectId: IDS.projectA,
    projectRevisionId: IDS.revisionA,
    transcriptId: TRANSCRIPT_ID,
    expectedHeadVersion: 1,
    planSequence: 1,
    supersedesTimelinePlanId: null,
    revision: revision.value,
    transcript: transcript.value,
    createdAt: FIXED_TIME,
  };
}

function objectUri(hash, extension) {
  const digest = hash.slice("sha256:".length);
  return `vf-local://objects/sha256/${digest.slice(0, 2)}/${digest}.${extension}`;
}

async function insertRunningSpanAttempt(executor, span, ordinal, inputHash) {
  const taskId = uuid(33_000 + ordinal * 2);
  const attemptId = uuid(33_001 + ordinal * 2);
  await executor.query(
    `INSERT INTO generation_tasks (
       id, workspace_id, owner_type, owner_id, project_revision_id,
       task_key, lane, state, version
     ) VALUES ($1, $2, 'PROJECT_REVISION', $3, $3, $4, 'PREPARE', 'RUNNING', 1)`,
    [taskId, IDS.workspaceA, IDS.revisionA, span.taskKey],
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
  return { taskId, attemptId };
}

async function materializeSelectedSpans(executor, repositories, timeline) {
  const service = new DurableSelectedSpanAudioPersistence(repositories);
  const accepted = [];
  for (const [index, span] of timeline.selectedSpanAudio.entries()) {
    const attemptId = uuid(33_001 + (index + 1) * 2);
    const dispatch = await buildSelectedSpanAudioJob({
      projectRevisionId: IDS.revisionA,
      attemptId,
      timelinePlanId: timeline.timelinePlanId,
      transcriptId: timeline.transcriptId,
      span,
      sourceDurationMs: 40_000,
      sourceArtifactUri: objectUri(HASHES.voiceoverA, "wav"),
      cancelToken: `vf-2-05-selected-span-cancel-${String(index + 1).padStart(3, "0")}-000000000000`,
    });
    const attempt = await insertRunningSpanAttempt(executor, span, index + 1, dispatch.inputHash);
    assert.equal(attempt.attemptId, attemptId);
    const outputHash = sha256(`vf-2-05-selected-span-${span.spanId}`);
    const durationMs = span.paddedEndMsExclusive - span.paddedStartMs;
    const result = await service.accept(SCOPE, {
      projectId: IDS.projectA,
      taskId: attempt.taskId,
      expectedHeadVersion: 2,
      expectedSpanVersion: 1,
      jobInput: dispatch.input,
      jobResult: {
        schema_version: "selected-span-audio-result/v1",
        attempt_id: attempt.attemptId,
        status: "SUCCEEDED",
        span_id: span.spanId,
        timeline_plan_id: timeline.timelinePlanId,
        transcript_id: timeline.transcriptId,
        timeline_segment_id: span.timelineSegmentId,
        task_key: span.taskKey,
        source_voiceover: {
          asset_id: span.sourceAssetId,
          sha256: span.sourceBinarySha256,
          duration_ms: 40_000,
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
          sha256: outputHash,
          artifact_uri: objectUri(outputHash, "wav"),
          content_type: "audio/wav",
          byte_size: durationMs * 32 + 44,
          duration_ms: durationMs,
          sample_rate_hz: 16_000,
          channels: 1,
        },
        error: null,
      },
      finishedAt: FIXED_TIME,
    });
    assert.equal(result.ok, true, diagnostic(result));
    assert.equal(result.value.span.state, "MATERIALIZED");
    accepted.push(result.value.span);
  }
  return accepted;
}

test("persists silent-boundary plans and resolves byte-identical canonical bytes after restore", async () => {
  const revision = await validateAndHashContractDocument("projectRevisionConfig", revisionValue());
  const transcript = await validateAndHashContractDocument("transcriptTiming", transcriptValue());
  const store = new MemoryTimelineStore();
  const source = await createMigratedDatabase();
  try {
    await seedLockedProjects(source.executor, {
      revisionA: {
        revisionHash: revision.sha256,
        revisionConfigPayload: revision.value,
        seed: REVISION_SEED,
      },
    });
    const repositories = createPGliteControlPlaneRepositories(source.executor);
    await seedDurableTranscript(source.executor, repositories, revision, transcript);
    const service = new DurableDeterministicTimelinePersistence(repositories, store);
    const command = persistCommand(revision, transcript);
    const prepared = await prepareDurableDeterministicTimeline(SCOPE, command);
    const accepted = await service.persist(SCOPE, command);
    assert.equal(accepted.ok, true, diagnostic(accepted));
    assert.equal(accepted.value.replayed, false);
    assert.equal(accepted.value.timeline.headVersion, 2);
    assert.equal(accepted.value.timeline.schedulerVersion, "scheduler-v2");
    assert.equal(accepted.value.timeline.schedulerConfigHash, prepared.schedulerConfigHash);
    assert.equal(accepted.value.timeline.inputFingerprintHash, prepared.inputFingerprintHash);
    assert.equal(
      accepted.value.timeline.canonicalDocument.canonicalDocumentSha256,
      prepared.timelineDocumentHash,
    );
    assert.equal(
      accepted.value.timeline.selectedSpanAudio.length,
      accepted.value.timeline.segments.filter(
        (segment) => segment.timelineComposition !== "IMAGE_FULL",
      ).length,
    );
    for (const span of accepted.value.timeline.selectedSpanAudio) {
      assert.equal(span.paddedStartMs, Math.max(0, span.selectedStartMs - 500));
      assert.equal(span.paddedEndMsExclusive, Math.min(40_000, span.selectedEndMsExclusive + 500));
      assert.equal(span.trimStartMs, span.selectedStartMs - span.paddedStartMs);
      assert.equal(
        span.trimEndMsExclusive,
        span.trimStartMs + span.selectedEndMsExclusive - span.selectedStartMs,
      );
    }

    const replay = await service.persist(SCOPE, command);
    assert.equal(replay.ok, true, diagnostic(replay));
    assert.equal(replay.value.replayed, true);
    assert.equal(replay.value.timeline.timelinePlanId, accepted.value.timeline.timelinePlanId);
    const materialized = await materializeSelectedSpans(
      source.executor,
      repositories,
      accepted.value.timeline,
    );
    assert.equal(materialized.length, accepted.value.timeline.selectedSpanAudio.length);

    const lookup = {
      projectId: IDS.projectA,
      projectRevisionId: IDS.revisionA,
      transcriptInputFingerprintHash: TRANSCRIPT_INPUT_HASH,
      timelineInputFingerprintHash: prepared.inputFingerprintHash,
    };
    const beforeRestart = await service.resolve(SCOPE, lookup);
    assert.equal(beforeRestart.ok, true, diagnostic(beforeRestart));
    assert.equal(beforeRestart.value.document.sha256, prepared.timelineDocumentHash);
    assert.equal(
      new TextDecoder().decode(beforeRestart.value.canonicalBytes),
      canonicalizeJson(beforeRestart.value.document.value),
    );
    const beforeSpanRows = await source.executor.query(
      `SELECT id, timeline_segment_id, task_key, state, materialized_asset_id,
              materialized_binary_sha256, version
         FROM selected_span_audio
        WHERE workspace_id = $1 AND timeline_plan_id = $2
        ORDER BY timeline_segment_id`,
      [IDS.workspaceA, accepted.value.timeline.timelinePlanId],
    );
    assert.equal(beforeSpanRows.rows.length, materialized.length);
    assert.equal(
      beforeSpanRows.rows.every(
        (span) =>
          span.state === "MATERIALIZED" &&
          span.materialized_asset_id !== null &&
          span.materialized_binary_sha256 !== null &&
          span.version === 2,
      ),
      true,
    );

    const snapshot = serializeMetadataSnapshot(await exportMetadataSnapshot(source.executor));
    const destination = await createMigratedDatabase();
    try {
      const restored = await restoreMetadataSnapshot(destination.executor, snapshot);
      assert.equal(restored.alreadyRestored, false);
      const restoredRepositories = createPGliteControlPlaneRepositories(destination.executor);
      const restartedService = new DurableDeterministicTimelinePersistence(
        restoredRepositories,
        store,
      );
      const afterRestart = await restartedService.resolve(SCOPE, lookup);
      assert.equal(afterRestart.ok, true, diagnostic(afterRestart));
      assert.equal(afterRestart.value.timing.headVersion, 2);
      assert.equal(afterRestart.value.document.sha256, beforeRestart.value.document.sha256);
      assert.deepEqual(afterRestart.value.canonicalBytes, beforeRestart.value.canonicalBytes);
      const afterSpanRows = await destination.executor.query(
        `SELECT id, timeline_segment_id, task_key, state, materialized_asset_id,
                materialized_binary_sha256, version
           FROM selected_span_audio
          WHERE workspace_id = $1 AND timeline_plan_id = $2
          ORDER BY timeline_segment_id`,
        [IDS.workspaceA, accepted.value.timeline.timelinePlanId],
      );
      assert.deepEqual(afterSpanRows.rows, beforeSpanRows.rows);
      assert.equal(
        serializeMetadataSnapshot(await exportMetadataSnapshot(destination.executor)),
        snapshot,
      );
    } finally {
      await destination.database.close();
    }
  } finally {
    await source.database.close();
  }
});

test("fails closed for input drift and corrupted canonical object bytes", async () => {
  const revision = await validateAndHashContractDocument("projectRevisionConfig", revisionValue());
  const transcript = await validateAndHashContractDocument("transcriptTiming", transcriptValue());
  await assert.rejects(
    () =>
      prepareDurableDeterministicTimeline(SCOPE, {
        ...persistCommand(revision, transcript),
        projectRevisionId: IDS.revisionB,
      }),
    { code: "TIMELINE_INPUT_MISMATCH" },
  );

  await withMigratedDatabase(async ({ executor }) => {
    await seedLockedProjects(executor, {
      revisionA: {
        revisionHash: revision.sha256,
        revisionConfigPayload: revision.value,
        seed: REVISION_SEED,
      },
    });
    const repositories = createPGliteControlPlaneRepositories(executor);
    await seedDurableTranscript(executor, repositories, revision, transcript);
    const store = new MemoryTimelineStore();
    const service = new DurableDeterministicTimelinePersistence(repositories, store);
    const command = persistCommand(revision, transcript);
    const accepted = await service.persist(SCOPE, command);
    assert.equal(accepted.ok, true, diagnostic(accepted));
    store.corrupt(accepted.value.canonicalDocumentObjectKey);
    await assert.rejects(
      () =>
        service.resolve(SCOPE, {
          projectId: IDS.projectA,
          projectRevisionId: IDS.revisionA,
          transcriptInputFingerprintHash: TRANSCRIPT_INPUT_HASH,
          timelineInputFingerprintHash: accepted.value.inputFingerprintHash,
        }),
      { code: "TIMELINE_OBJECT_MISMATCH" },
    );
  });
});

test("a stale timing head rolls every metadata write back while leaving only harmless content bytes", async () => {
  const revision = await validateAndHashContractDocument("projectRevisionConfig", revisionValue());
  const transcript = await validateAndHashContractDocument("transcriptTiming", transcriptValue());
  await withMigratedDatabase(async ({ executor }) => {
    await seedLockedProjects(executor, {
      revisionA: {
        revisionHash: revision.sha256,
        revisionConfigPayload: revision.value,
        seed: REVISION_SEED,
      },
    });
    const repositories = createPGliteControlPlaneRepositories(executor);
    await seedDurableTranscript(executor, repositories, revision, transcript);
    const store = new MemoryTimelineStore();
    const service = new DurableDeterministicTimelinePersistence(repositories, store);
    const staleCommand = {
      ...persistCommand(revision, transcript),
      expectedHeadVersion: 2,
    };
    const prepared = await prepareDurableDeterministicTimeline(SCOPE, staleCommand);
    const rejected = await service.persist(SCOPE, staleCommand);
    assert.equal(rejected.ok, false, diagnostic(rejected));
    assert.equal(rejected.kind, "CONFLICT");
    assert.equal(rejected.code, "TIMING_HEAD_VERSION_MISMATCH");
    const metadata = await executor.query(
      `SELECT
         (SELECT count(*)::int FROM assets WHERE id = $1) AS assets,
         (SELECT count(*)::int FROM timeline_plans WHERE id = $2) AS plans`,
      [prepared.timelineDocumentAssetId, prepared.timelinePlanId],
    );
    assert.deepEqual(metadata.rows[0], { assets: 0, plans: 0 });
    assert.notEqual(await store.getExact(prepared.canonicalDocumentWrite.objectKey), null);
  });
});

test("the committed timeline service remains provider-free and hashes exact bytes", async () => {
  const revision = await validateAndHashContractDocument("projectRevisionConfig", revisionValue());
  const transcript = await validateAndHashContractDocument("transcriptTiming", transcriptValue());
  const prepared = await prepareDurableDeterministicTimeline(
    SCOPE,
    persistCommand(revision, transcript),
  );
  assert.equal(
    `sha256:${createHash("sha256").update(prepared.canonicalDocumentWrite.bytes).digest("hex")}`,
    prepared.timelineDocumentHash,
  );
  assert.doesNotMatch(
    new TextDecoder().decode(prepared.canonicalDocumentWrite.bytes),
    /provider|credential|signed_url|https?:\/\//u,
  );
});

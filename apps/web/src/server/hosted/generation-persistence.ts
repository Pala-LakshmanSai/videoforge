import type {
  PreparedDeterministicTimeline,
  PreparedLocalTranscription,
} from "@videoforge/control-plane";

import type { HostedGenerationPersistence } from "./generation-coordinator";
import type { HostedNeonPool, HostedR2BucketBinding } from "./configuration";
import { sha256Bytes } from "./crypto";
import { createNeonExecutor } from "./neon";
import { planHostedVideoSelections } from "./hosted-video-plan";
import type { TimelinePlanDocument } from "@videoforge/contracts";

export class HostedCanonicalTimingPersistenceError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "HostedCanonicalTimingPersistenceError";
  }
}

function fail(code: string): never {
  throw new HostedCanonicalTimingPersistenceError(code);
}

function tenantKey(accountId: string, key: string): string {
  if (!key.startsWith("workspace/") || key.includes("..")) {
    fail("HOSTED_CANONICAL_TIMING_OBJECT_KEY_INVALID");
  }
  return `tenant/${accountId}/${key}`;
}

async function putCanonicalExact(
  bucket: HostedR2BucketBinding,
  key: string,
  bytes: Uint8Array,
  sha256: string,
): Promise<void> {
  const inspectStored = async (): Promise<"ABSENT" | "EXACT" | "MISMATCH"> => {
    const stored = await bucket.get(key);
    if (!stored) return "ABSENT";
    if (
      stored.size !== bytes.byteLength ||
      stored.httpMetadata?.contentType !== "application/json"
    ) {
      return "MISMATCH";
    }
    const readback = await stored.arrayBuffer();
    return readback.byteLength === bytes.byteLength && (await sha256Bytes(readback)) === sha256
      ? "EXACT"
      : "MISMATCH";
  };

  // Canonical keys include the exact document hash. Replays therefore need no write, and concurrent
  // writers can safely put the same canonical bytes without an R2 precondition. Live staging proved
  // both attempted conditional forms could leave a first write absent, so correctness is enforced by
  // the content-addressed key plus mandatory exact readback instead of conditional-create behavior.
  const existing = await inspectStored();
  if (existing === "EXACT") return;
  if (existing === "MISMATCH") fail("HOSTED_CANONICAL_TIMING_OBJECT_READBACK_MISMATCH");

  const uploadBytes = Uint8Array.from(bytes).buffer;
  try {
    await bucket.put(key, uploadBytes, {
      httpMetadata: { contentType: "application/json" },
    });
  } catch {
    // A concurrent exact writer is safe only after exact private readback below.
  }
  if ((await inspectStored()) !== "EXACT") {
    fail("HOSTED_CANONICAL_TIMING_OBJECT_READBACK_MISMATCH");
  }
}

function transcriptPayload(
  accountId: string,
  hostedAttemptId: string,
  jobSpecSha256: string,
  resultObjectSha256: string,
  prepared: PreparedLocalTranscription,
) {
  const command = prepared.transcriptPersistence;
  return {
    asset: {
      id: prepared.transcriptDocumentAssetId,
      object_key: tenantKey(accountId, prepared.canonicalDocumentWrite.objectKey),
      byte_size: prepared.canonicalDocumentWrite.bytes.byteLength,
      hash: prepared.transcriptDocumentHash,
      metadata: {
        bridge: "HOSTED_CPU_ASR",
        hosted_cpu_asr_attempt_id: hostedAttemptId,
        job_spec_sha256: jobSpecSha256,
        result_object_sha256: resultObjectSha256,
        asr_input_canonical_hash: prepared.asrInputHash,
        asr_result_canonical_hash: prepared.asrResultHash,
        transcription_config_hash: prepared.transcriptionConfigHash,
        input_fingerprint_hash: prepared.inputFingerprintHash,
      },
    },
    row: {
      id: prepared.transcriptId,
      source_asset_id: command.sourceAssetId,
      model_name: command.modelName,
      model_hash: command.modelSha256,
      duration_ms: command.sourceDurationMs,
      source_binary_sha256: command.sourceBinarySha256,
      engine_name: command.engineName,
      engine_version: command.engineVersion,
      language: command.language,
      transcription_config_hash: command.transcriptionConfigHash,
      optional_script_hash: command.optionalScriptHash,
      input_fingerprint_hash: command.inputFingerprintHash,
      idempotency_key: command.idempotencyKey,
      created_at: command.createdAt,
    },
    words: command.words.map((word) => ({
      id: word.wordId,
      index: word.index,
      text: word.text,
      start_ms: word.startMs,
      end_ms: word.endMsExclusive,
      confidence: word.confidence,
    })),
    sentences: command.sentences.map((sentence) => ({
      id: sentence.sentenceId,
      key: sentence.sentenceKey,
      index: sentence.index,
      word_start: sentence.wordStart,
      word_end: sentence.wordEndExclusive,
      start_ms: sentence.startMs,
      end_ms: sentence.endMsExclusive,
      text: sentence.text,
    })),
    phrases: command.phrases.map((phrase) => ({
      id: phrase.phraseId,
      sentence_id: phrase.sentenceId,
      key: phrase.phraseKey,
      index: phrase.index,
      word_start: phrase.wordStart,
      word_end: phrase.wordEndExclusive,
      start_ms: phrase.startMs,
      end_ms: phrase.endMsExclusive,
      pause_before_ms: phrase.pauseBeforeMs,
      pause_after_ms: phrase.pauseAfterMs,
      text: phrase.text,
    })),
  };
}

function timelinePayload(accountId: string, prepared: PreparedDeterministicTimeline) {
  const command = prepared.timelinePersistence;
  return {
    asset: {
      id: prepared.timelineDocumentAssetId,
      object_key: tenantKey(accountId, prepared.canonicalDocumentWrite.objectKey),
      byte_size: prepared.canonicalDocumentWrite.bytes.byteLength,
      hash: prepared.timelineDocumentHash,
      metadata: prepared.artifactRegistration.metadata,
    },
    row: {
      id: prepared.timelinePlanId,
      transcript_id: command.transcriptId,
      revision_config_hash: command.revisionConfigHash,
      transcript_document_hash: command.transcriptDocumentHash,
      scheduler_version: command.schedulerVersion,
      scheduler_config_hash: command.schedulerConfigHash,
      seed: command.seed.toString(),
      input_fingerprint_hash: command.inputFingerprintHash,
      idempotency_key: command.idempotencyKey,
      total_frames: command.totalFrames,
      created_at: command.createdAt,
    },
    segments: command.segments.map((segment) => ({
      id: segment.segmentId,
      key: segment.segmentKey,
      index: segment.index,
      start_frame: segment.startFrame,
      end_frame: segment.endFrameExclusive,
      source_start_ms: segment.sourceAudioStartMs,
      source_end_ms: segment.sourceAudioEndMsExclusive,
      word_start: segment.wordStart,
      word_end: segment.wordEndExclusive,
      composition: segment.timelineComposition,
      image_role: segment.inImageShotRole,
      narration: segment.narration,
      required_slots: segment.requiredSlots,
    })),
    spans: command.selectedSpanAudio.map((span) => ({
      id: span.spanId,
      timeline_segment_id: span.timelineSegmentId,
      transcript_id: span.transcriptId,
      key: span.spanKey,
      task_key: span.taskKey,
      source_asset_id: span.sourceAssetId,
      source_sha256: span.sourceBinarySha256,
      selected_start_ms: span.selectedStartMs,
      selected_end_ms: span.selectedEndMsExclusive,
      padded_start_ms: span.paddedStartMs,
      padded_end_ms: span.paddedEndMsExclusive,
      trim_start_ms: span.trimStartMs,
      trim_end_ms: span.trimEndMsExclusive,
    })),
  };
}

export class HostedCanonicalTimingPersistence implements HostedGenerationPersistence {
  constructor(
    private readonly pool: HostedNeonPool,
    private readonly bucket: HostedR2BucketBinding,
  ) {}

  async persistProviderInertPlan(
    input: Parameters<HostedGenerationPersistence["persistProviderInertPlan"]>[0],
  ) {
    const transcriptKey = tenantKey(
      input.snapshot.accountId,
      input.preparedTranscript.canonicalDocumentWrite.objectKey,
    );
    const timelineKey = tenantKey(
      input.snapshot.accountId,
      input.preparedTimeline.canonicalDocumentWrite.objectKey,
    );
    await Promise.all([
      putCanonicalExact(
        this.bucket,
        transcriptKey,
        input.preparedTranscript.canonicalDocumentWrite.bytes,
        input.preparedTranscript.transcriptDocumentHash,
      ),
      putCanonicalExact(
        this.bucket,
        timelineKey,
        input.preparedTimeline.canonicalDocumentWrite.bytes,
        input.preparedTimeline.timelineDocumentHash,
      ),
    ]);
    const payload = {
      schema_version: "videoforge-hosted-canonical-timing-append/v1",
      asr_input_sha256: input.snapshot.asrInputSha256,
      asr_result_sha256: input.snapshot.asrOutputSha256,
      generation_plan_sha256: input.generationPlanSha256,
      transcript: transcriptPayload(
        input.snapshot.accountId,
        input.snapshot.asrAttemptId,
        input.snapshot.asrInputSha256,
        input.snapshot.asrOutputSha256,
        input.preparedTranscript,
      ),
      timeline: timelinePayload(input.snapshot.accountId, input.preparedTimeline),
      tasks: input.tasks.map((task) => ({
        id: task.taskId,
        task_key: task.taskKey,
        lane: task.lane,
        timeline_segment_id: task.timelineSegmentId,
        depends_on: task.dependsOn,
      })),
    };
    const result = await createNeonExecutor(this.pool).transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1, $2, true)", [
        "videoforge.account_id",
        input.snapshot.accountId,
      ]);
      const saved = await transaction.query<{ replayed: boolean }>(
        `SELECT replayed FROM public.videoforge_append_hosted_canonical_timing($1,$2,$3,$4,$5,$6,$7::jsonb)`,
        [
          input.snapshot.accountId,
          input.snapshot.workspaceId,
          input.snapshot.userId,
          input.snapshot.projectId,
          input.snapshot.projectRevisionId,
          input.snapshot.asrAttemptId,
          JSON.stringify(payload),
        ],
      );
      const videoPlan = await transaction.query<{
        selections: unknown;
        coverage_percent: number;
        replacement_policy: "LEGACY_PREFIX_V1" | "WHOLE_SCENE_V2" | "OPENING_180_V3";
      }>(
        "SELECT selections, coverage_percent, replacement_policy FROM hosted_video_plans WHERE account_id=$1 AND workspace_id=$2 AND project_revision_id=$3",
        [input.snapshot.accountId, input.snapshot.workspaceId, input.snapshot.projectRevisionId],
      );
      if (
        videoPlan.rows.length > 1 ||
        (videoPlan.rows.length === 1 &&
          videoPlan.rows[0]!.selections !== null &&
          !Array.isArray(videoPlan.rows[0]!.selections))
      )
        fail("HOSTED_VIDEO_PLAN_DATABASE_READBACK_MISMATCH");
      // Existing selections pin their original duration policy. A legacy revision stays opted out;
      // an opted-in plan with null selections still finishes after an interrupted canonical append.
      if (videoPlan.rows.length === 0 || videoPlan.rows[0]!.selections !== null) return saved;
      const timeline = {
        total_frames: input.preparedTimeline.timelinePersistence.totalFrames,
        segments: input.preparedTimeline.timelinePersistence.segments.map((segment) => ({
          segment_id: segment.segmentKey,
          start_frame: segment.startFrame,
          end_frame_exclusive: segment.endFrameExclusive,
          timeline_composition: segment.timelineComposition,
          required_slots: segment.requiredSlots,
        })) as unknown as TimelinePlanDocument["segments"],
      };
      await transaction.query(
        "SELECT public.videoforge_plan_hosted_video_selections($1,$2,$3,$4::jsonb)",
        [
          input.snapshot.accountId,
          input.snapshot.workspaceId,
          input.snapshot.projectRevisionId,
          JSON.stringify(
            planHostedVideoSelections(timeline, {
              coveragePercent: videoPlan.rows[0]!.coverage_percent,
              replacementPolicy: videoPlan.rows[0]!.replacement_policy,
            }),
          ),
        ],
      );
      return saved;
    });
    const replayed = result.rows[0]?.replayed;
    if (typeof replayed !== "boolean" || result.rows.length !== 1)
      fail("HOSTED_CANONICAL_TIMING_DATABASE_READBACK_MISMATCH");
    return { replayed };
  }
}

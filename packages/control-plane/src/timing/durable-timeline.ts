import { createHash } from "node:crypto";

import {
  canonicalizeJson,
  sha256CanonicalJson,
  validateAndHashContractDocument,
} from "@videoforge/contracts";
import type { JsonValue, Sha256Digest } from "@videoforge/contracts";
import type { ContractDocumentValidationAuthority } from "@videoforge/contracts";
import {
  scheduleTimeline,
  SUPPORTED_SCHEDULER_CONFIG,
  SUPPORTED_SCHEDULER_VERSION,
} from "@videoforge/pipeline";

import type { ArtifactMetadata } from "../repositories/artifacts.js";
import type { PersistedTimelinePlan, TimingPlanResolution } from "../repositories/timing.js";
import {
  deterministicIdempotencyKey,
  type DeterministicIdempotencyKey,
  type JsonObject,
  type RepositoryResult,
  type Sha256,
  type WorkspaceActorScope,
  type WorkspaceScope,
} from "../repositories/types.js";
import type { ControlPlaneRepositories, RepositorySession } from "../repositories/unit-of-work.js";
import type {
  CanonicalDocumentObjectStore,
  CanonicalDocumentWrite,
} from "./durable-transcription.js";

export type DurableTimelineErrorCode =
  | "TIMELINE_INPUT_MISMATCH"
  | "TIMELINE_SCHEDULING_FAILED"
  | "TIMELINE_OBJECT_MISMATCH";

export class DurableTimelineError extends Error {
  public constructor(
    public readonly code: DurableTimelineErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DurableTimelineError";
  }
}

export interface CanonicalDocumentRead {
  readonly objectKey: string;
  readonly bytes: Uint8Array;
  readonly binarySha256: Sha256;
  readonly byteSize: bigint;
}

export interface DurableTimelineObjectStore extends CanonicalDocumentObjectStore {
  getExact(objectKey: string): Promise<CanonicalDocumentRead | null>;
}

export interface PersistDeterministicTimelineCommand {
  readonly projectId: string;
  readonly projectRevisionId: string;
  readonly transcriptId: string;
  readonly expectedHeadVersion: number;
  readonly planSequence: number;
  readonly supersedesTimelinePlanId: string | null;
  readonly revision: unknown;
  readonly transcript: unknown;
  readonly createdAt: string;
}

export interface PreparedDeterministicTimeline {
  readonly timelinePlanId: string;
  readonly timelineDocumentAssetId: string;
  readonly timelineDocumentHash: Sha256;
  readonly schedulerConfigHash: Sha256;
  readonly inputFingerprintHash: Sha256;
  readonly canonicalDocumentWrite: CanonicalDocumentWrite;
  readonly artifactRegistration: Parameters<RepositorySession["artifacts"]["registerMetadata"]>[1];
  readonly artifactBinding: Parameters<RepositorySession["artifacts"]["bindCanonicalDocument"]>[1];
  readonly timelinePersistence: Parameters<RepositorySession["timing"]["persistTimelinePlan"]>[1];
}

export interface PersistedDeterministicTimeline {
  readonly timeline: PersistedTimelinePlan;
  readonly artifact: ArtifactMetadata;
  readonly timelineDocumentHash: Sha256;
  readonly schedulerConfigHash: Sha256;
  readonly inputFingerprintHash: Sha256;
  readonly canonicalDocumentObjectKey: string;
  readonly replayed: boolean;
}

export interface ResolveDeterministicTimelineLookup {
  readonly projectId: string;
  readonly projectRevisionId: string;
  readonly transcriptInputFingerprintHash: Sha256;
  readonly timelineInputFingerprintHash: Sha256;
}

export interface ResolvedDeterministicTimeline {
  readonly timing: TimingPlanResolution;
  readonly artifact: ArtifactMetadata;
  readonly document: Awaited<ReturnType<typeof validateAndHashContractDocument<"timelinePlan">>>;
  readonly canonicalBytes: Uint8Array;
  readonly canonicalDocumentObjectKey: string;
}

type DurableTimelineRepositoryResult<Value> = RepositoryResult<Value, string, string, string>;

const asSha256 = (value: Sha256Digest): Sha256 => value as Sha256;

function stableUuid(namespace: string, ...parts: readonly string[]): string {
  const bytes = createHash("sha256")
    .update([namespace, ...parts].join("\u0000"))
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function stableKey(prefix: string, hash: Sha256): DeterministicIdempotencyKey {
  return deterministicIdempotencyKey(`${prefix}:${hash.slice("sha256:".length)}`);
}

function jsonObject(value: JsonValue): JsonObject {
  return value as JsonObject;
}

function propagateFailure<Value>(
  result: RepositoryResult<Value, string, string, string>,
): RepositoryResult<never, string, string, string> {
  if (result.ok) throw new TypeError("cannot propagate a successful repository result");
  return result;
}

function bytesSha256(bytes: Uint8Array): Sha256 {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}` as Sha256;
}

function avatarSpanTaskKey(segment: {
  readonly timeline_composition: string;
  readonly required_slots: JsonValue;
}): string | null {
  if (segment.timeline_composition === "IMAGE_FULL") return null;
  const slots = segment.required_slots as Record<string, unknown>;
  const avatar = slots.avatar;
  if (typeof avatar !== "object" || avatar === null || Array.isArray(avatar)) return null;
  const taskKey = (avatar as Record<string, unknown>).span_audio_task_key;
  return typeof taskKey === "string" ? taskKey : null;
}

export async function prepareDurableDeterministicTimeline(
  scope: WorkspaceActorScope,
  command: PersistDeterministicTimelineCommand,
  contractDocumentAuthority?: ContractDocumentValidationAuthority,
): Promise<PreparedDeterministicTimeline> {
  const validateAndHash =
    contractDocumentAuthority?.validateAndHash.bind(contractDocumentAuthority) ??
    validateAndHashContractDocument;
  const [revision, transcript] = await Promise.all([
    validateAndHash("projectRevisionConfig", command.revision),
    validateAndHash("transcriptTiming", command.transcript),
  ]);
  if (
    revision.value.project_id !== command.projectId ||
    revision.value.project_revision_id !== command.projectRevisionId ||
    transcript.value.project_revision_id !== command.projectRevisionId ||
    revision.value.scheduler_version !== SUPPORTED_SCHEDULER_VERSION
  ) {
    throw new DurableTimelineError(
      "TIMELINE_INPUT_MISMATCH",
      "The scheduler inputs do not belong to the selected project revision and supported version.",
    );
  }

  const scheduled = await scheduleTimeline({
    revision,
    transcript,
    determinism: Object.freeze({
      clock: Object.freeze({
        nowIso(): string {
          throw new Error("The deterministic timeline scheduler cannot read a clock.");
        },
      }),
      ids: Object.freeze({
        idFor(namespace: string, stableKeyValue: string): string {
          return stableUuid(`videoforge:${namespace}`, stableKeyValue);
        },
      }),
    }),
    contractDocumentAuthority,
  });
  if (!scheduled.ok) {
    throw new DurableTimelineError(
      "TIMELINE_SCHEDULING_FAILED",
      `${scheduled.error.code}: ${scheduled.error.message}`,
    );
  }

  const schedulerConfigHash = asSha256(
    await sha256CanonicalJson(SUPPORTED_SCHEDULER_CONFIG as unknown as JsonValue),
  );
  const inputFingerprintHash = asSha256(
    await sha256CanonicalJson({
      schema_version: "deterministic-timeline-input-fingerprint/v1",
      project_revision_id: command.projectRevisionId,
      revision_config_hash: revision.sha256,
      transcript_document_hash: transcript.sha256,
      scheduler_version: revision.value.scheduler_version,
      scheduler_config_hash: schedulerConfigHash,
      seed: revision.value.scheduler_seed,
    }),
  );
  const timelinePlanId = stableUuid(
    "videoforge:durable-timeline-plan:v1",
    command.projectRevisionId,
    inputFingerprintHash,
  );
  const timelineDocumentHash = asSha256(scheduled.value.sha256);
  const timelineDocumentAssetId = stableUuid(
    "videoforge:timeline-plan-document:v1",
    command.projectRevisionId,
    timelineDocumentHash,
  );
  const canonicalBytes = new TextEncoder().encode(canonicalizeJson(scheduled.value.value));
  const digest = timelineDocumentHash.slice("sha256:".length);
  const objectKey = `workspace/${scope.workspaceId}/project/${command.projectId}/revision/${command.projectRevisionId}/timeline/${digest}.json`;
  const sourceDurationMs = transcript.value.source.duration_ms;
  const paddingMs = SUPPORTED_SCHEDULER_CONFIG.selected_span_context_padding_ms;

  const segments = scheduled.value.value.segments.map((segment, index) =>
    Object.freeze({
      segmentId: segment.segment_id,
      segmentKey: `segment:${segment.segment_id}`,
      index,
      startFrame: segment.start_frame,
      endFrameExclusive: segment.end_frame_exclusive,
      sourceAudioStartMs: segment.source_audio_start_ms,
      sourceAudioEndMsExclusive: segment.source_audio_end_ms,
      wordStart: segment.word_start,
      wordEndExclusive: segment.word_end_exclusive,
      timelineComposition: segment.timeline_composition,
      inImageShotRole: "in_image_shot_role" in segment ? segment.in_image_shot_role : null,
      narration: segment.phrase,
      requiredSlots: jsonObject(segment.required_slots),
    }),
  );
  const selectedSpanAudio = scheduled.value.value.segments.flatMap((segment) => {
    const taskKey = avatarSpanTaskKey(segment);
    if (taskKey === null) return [];
    const selectedStartMs = segment.source_audio_start_ms;
    const selectedEndMsExclusive = segment.source_audio_end_ms;
    const paddedStartMs = Math.max(0, selectedStartMs - paddingMs);
    const paddedEndMsExclusive = Math.min(sourceDurationMs, selectedEndMsExclusive + paddingMs);
    return [
      Object.freeze({
        spanId: stableUuid("videoforge:selected-span-audio:v1", timelinePlanId, segment.segment_id),
        spanKey: `selected-span:${segment.segment_id}`,
        timelineSegmentId: segment.segment_id,
        transcriptId: command.transcriptId,
        taskKey,
        sourceAssetId: transcript.value.source.asset_id,
        sourceBinarySha256: transcript.value.source.sha256 as Sha256,
        selectedStartMs,
        selectedEndMsExclusive,
        paddedStartMs,
        paddedEndMsExclusive,
        trimStartMs: selectedStartMs - paddedStartMs,
        trimEndMsExclusive:
          selectedStartMs - paddedStartMs + selectedEndMsExclusive - selectedStartMs,
      }),
    ];
  });

  return Object.freeze({
    timelinePlanId,
    timelineDocumentAssetId,
    timelineDocumentHash,
    schedulerConfigHash,
    inputFingerprintHash,
    canonicalDocumentWrite: Object.freeze({
      objectKey,
      bytes: canonicalBytes,
      binarySha256: timelineDocumentHash,
    }),
    artifactRegistration: Object.freeze({
      idempotencyKey: stableKey("durable-timeline-artifact", inputFingerprintHash),
      assetId: timelineDocumentAssetId,
      projectId: command.projectId,
      projectRevisionId: command.projectRevisionId,
      sourceAttemptId: null,
      kind: "CANONICAL_DOCUMENT" as const,
      objectKey,
      contentType: "application/json",
      metadata: Object.freeze({
        scheduler_version: revision.value.scheduler_version,
        scheduler_config_hash: schedulerConfigHash,
        scheduler_seed: revision.value.scheduler_seed,
        revision_config_hash: revision.sha256,
        transcript_document_hash: transcript.sha256,
        input_fingerprint_hash: inputFingerprintHash,
      }),
    }),
    artifactBinding: Object.freeze({
      idempotencyKey: stableKey("durable-timeline-artifact-bind", inputFingerprintHash),
      assetId: timelineDocumentAssetId,
      contractName: "timeline-plan",
      contractVersion: "v1",
      canonicalDocumentSha256: timelineDocumentHash,
      binarySha256: timelineDocumentHash,
      byteSize: BigInt(canonicalBytes.byteLength),
      verifiedAt: command.createdAt,
    }),
    timelinePersistence: Object.freeze({
      idempotencyKey: stableKey("durable-timeline-plan", inputFingerprintHash),
      projectId: command.projectId,
      projectRevisionId: command.projectRevisionId,
      expectedHeadVersion: command.expectedHeadVersion,
      timelinePlanId,
      transcriptId: command.transcriptId,
      planSequence: command.planSequence,
      supersedesTimelinePlanId: command.supersedesTimelinePlanId,
      revisionConfigHash: revision.sha256 as Sha256,
      transcriptDocumentHash: transcript.sha256 as Sha256,
      schedulerVersion: revision.value.scheduler_version,
      schedulerConfigHash,
      seed: BigInt(revision.value.scheduler_seed),
      inputFingerprintHash,
      canonicalDocumentAssetId: timelineDocumentAssetId,
      canonicalDocument: Object.freeze({
        contractName: "timeline-plan",
        contractVersion: "v1",
        payload: jsonObject(scheduled.value.value),
        canonicalDocumentSha256: timelineDocumentHash,
      }),
      outputFpsNum: 30 as const,
      outputFpsDen: 1 as const,
      totalFrames: scheduled.value.value.total_frames,
      segments: Object.freeze(segments),
      selectedSpanAudio: Object.freeze(selectedSpanAudio),
      createdAt: command.createdAt,
    }),
  });
}

export class DurableDeterministicTimelinePersistence {
  public constructor(
    private readonly repositories: ControlPlaneRepositories,
    private readonly objects: DurableTimelineObjectStore,
  ) {}

  public async persist(
    scope: WorkspaceActorScope,
    command: PersistDeterministicTimelineCommand,
  ): Promise<DurableTimelineRepositoryResult<PersistedDeterministicTimeline>> {
    const prepared = await prepareDurableDeterministicTimeline(scope, command);
    const stored = await this.objects.putIfAbsent(prepared.canonicalDocumentWrite);
    if (
      stored.objectKey !== prepared.canonicalDocumentWrite.objectKey ||
      stored.binarySha256 !== prepared.canonicalDocumentWrite.binarySha256 ||
      stored.byteSize !== BigInt(prepared.canonicalDocumentWrite.bytes.byteLength)
    ) {
      throw new DurableTimelineError(
        "TIMELINE_OBJECT_MISMATCH",
        "The canonical object store returned mismatched immutable timeline facts.",
      );
    }

    return this.repositories.unitOfWork.execute<
      PersistedDeterministicTimeline,
      string,
      string,
      string
    >(scope, async (repositories) => {
      const registered = await repositories.artifacts.registerMetadata(
        scope,
        prepared.artifactRegistration,
      );
      if (!registered.ok) return propagateFailure(registered);
      const bound = await repositories.artifacts.bindCanonicalDocument(
        scope,
        prepared.artifactBinding,
      );
      if (!bound.ok) return propagateFailure(bound);
      const timeline = await repositories.timing.persistTimelinePlan(
        scope,
        prepared.timelinePersistence,
      );
      if (!timeline.ok) return propagateFailure(timeline);
      return {
        ok: true,
        value: Object.freeze({
          timeline: timeline.value.value,
          artifact: bound.value.value,
          timelineDocumentHash: prepared.timelineDocumentHash,
          schedulerConfigHash: prepared.schedulerConfigHash,
          inputFingerprintHash: prepared.inputFingerprintHash,
          canonicalDocumentObjectKey: stored.objectKey,
          replayed:
            stored.replayed &&
            registered.value.replayed &&
            bound.value.replayed &&
            timeline.value.replayed,
        }),
      };
    });
  }

  public async resolve(
    scope: WorkspaceScope,
    lookup: ResolveDeterministicTimelineLookup,
  ): Promise<DurableTimelineRepositoryResult<ResolvedDeterministicTimeline>> {
    const timing = await this.repositories.timing.resolveExactPlan(scope, lookup);
    if (!timing.ok) return propagateFailure(timing);
    const artifact = await this.repositories.artifacts.resolveExact(
      scope,
      timing.value.timelinePlan.canonicalDocumentAssetId,
    );
    if (!artifact.ok) return propagateFailure(artifact);
    const objectKey = artifact.value.objectKey;
    if (objectKey === null) {
      throw new DurableTimelineError(
        "TIMELINE_OBJECT_MISMATCH",
        "The canonical timeline artifact has no immutable object key.",
      );
    }
    const stored = await this.objects.getExact(objectKey);
    if (
      stored === null ||
      stored.objectKey !== objectKey ||
      stored.byteSize !== BigInt(stored.bytes.byteLength) ||
      stored.binarySha256 !== bytesSha256(stored.bytes) ||
      stored.binarySha256 !== timing.value.timelinePlan.canonicalDocument.canonicalDocumentSha256 ||
      artifact.value.binarySha256 !== stored.binarySha256
    ) {
      throw new DurableTimelineError(
        "TIMELINE_OBJECT_MISMATCH",
        "The resolved canonical timeline bytes do not match durable metadata.",
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(stored.bytes));
    } catch (error) {
      throw new DurableTimelineError(
        "TIMELINE_OBJECT_MISMATCH",
        `The canonical timeline object is not valid UTF-8 JSON: ${error instanceof Error ? error.name : "unknown error"}.`,
      );
    }
    const document = await validateAndHashContractDocument("timelinePlan", parsed);
    if (
      document.sha256 !== stored.binarySha256 ||
      canonicalizeJson(document.value) !== new TextDecoder().decode(stored.bytes)
    ) {
      throw new DurableTimelineError(
        "TIMELINE_OBJECT_MISMATCH",
        "The resolved timeline object is not the exact canonical document.",
      );
    }
    return {
      ok: true,
      value: Object.freeze({
        timing: timing.value,
        artifact: artifact.value,
        document,
        canonicalBytes: stored.bytes.slice(),
        canonicalDocumentObjectKey: objectKey,
      }),
    };
  }
}

import { createHash } from "node:crypto";

import { canonicalizeJson, sha256CanonicalJson } from "@videoforge/contracts";
import type { JsonValue, Sha256Digest } from "@videoforge/contracts";

import type { ArtifactMetadata } from "../repositories/artifacts.js";
import type { AcceptedAttemptResult } from "../repositories/execution.js";
import type {
  MaterializedSelectedSpanAudio,
  SelectedSpanAudioRecord,
} from "../repositories/timing.js";
import {
  deterministicIdempotencyKey,
  type DeterministicIdempotencyKey,
  type JsonObject,
  type RepositoryResult,
  type Sha256,
  type WorkspaceActorScope,
} from "../repositories/types.js";
import type { ControlPlaneRepositories, RepositorySession } from "../repositories/unit-of-work.js";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const OBJECT_URI = /^vf-local:\/\/objects\/sha256\/([0-9a-f]{2})\/([0-9a-f]{64})\.wav$/u;
const SOURCE_OBJECT_URI =
  /^vf-local:\/\/objects\/sha256\/([0-9a-f]{2})\/([0-9a-f]{64})\.[a-z0-9]{1,10}$/u;

export type SpanAudioAcceptanceErrorCode =
  | "SPAN_INPUT_INVALID"
  | "SPAN_RESULT_NOT_SUCCESSFUL"
  | "SPAN_RESULT_MISMATCH";

export class SpanAudioAcceptanceError extends Error {
  public constructor(
    public readonly code: SpanAudioAcceptanceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SpanAudioAcceptanceError";
  }
}

export interface BuildSelectedSpanAudioJobInput {
  readonly projectRevisionId: string;
  readonly attemptId: string;
  readonly timelinePlanId: string;
  readonly transcriptId: string;
  readonly span: SelectedSpanAudioRecord;
  readonly sourceDurationMs: number;
  readonly sourceArtifactUri: string;
  readonly cancelToken: string;
}

export interface SelectedSpanAudioJobDispatch {
  readonly input: JsonObject;
  readonly inputHash: Sha256;
  readonly outputAssetId: string;
  readonly resultUri: string;
}

export interface AcceptSelectedSpanAudioCommand {
  readonly projectId: string;
  readonly taskId: string;
  readonly expectedHeadVersion: number;
  readonly expectedSpanVersion: number;
  readonly jobInput: unknown;
  readonly jobResult: unknown;
  readonly finishedAt: string;
}

export interface PreparedSelectedSpanAudioAcceptance {
  readonly inputHash: Sha256;
  readonly resultHash: Sha256;
  readonly artifactRegistration: Parameters<RepositorySession["artifacts"]["registerMetadata"]>[1];
  readonly artifactBinding: Parameters<RepositorySession["artifacts"]["bindBinaryContent"]>[1];
  readonly recordSuccessfulResult: Parameters<
    RepositorySession["execution"]["recordSuccessfulResult"]
  >[1];
  readonly materialization: Parameters<
    RepositorySession["timing"]["materializeSelectedSpanAudio"]
  >[1];
}

export interface AcceptedSelectedSpanAudio {
  readonly span: MaterializedSelectedSpanAudio;
  readonly artifact: ArtifactMetadata;
  readonly acceptedAttempt: AcceptedAttemptResult;
  readonly inputHash: Sha256;
  readonly resultHash: Sha256;
  readonly replayed: boolean;
}

type SpanAudioResult = RepositoryResult<AcceptedSelectedSpanAudio, string, string, string>;

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

const asSha256 = (value: Sha256Digest): Sha256 => value as Sha256;

function stableKey(prefix: string, hash: Sha256): DeterministicIdempotencyKey {
  return deterministicIdempotencyKey(`${prefix}:${hash.slice("sha256:".length)}`);
}

function assertId(value: unknown, label: string): string {
  if (typeof value !== "string" || !ID.test(value)) {
    throw new SpanAudioAcceptanceError("SPAN_INPUT_INVALID", `${label} is invalid.`);
  }
  return value;
}

function assertHash(value: unknown, label: string): Sha256 {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new SpanAudioAcceptanceError("SPAN_INPUT_INVALID", `${label} is invalid.`);
  }
  return value as Sha256;
}

function assertTaskKey(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 240 ||
    [...value].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
    }) ||
    value.trim() !== value
  ) {
    throw new SpanAudioAcceptanceError("SPAN_INPUT_INVALID", "The task key is invalid.");
  }
  return value;
}

function assertInteger(value: unknown, label: string, minimum = 0, maximum = 3_600_000): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new SpanAudioAcceptanceError("SPAN_INPUT_INVALID", `${label} is invalid.`);
  }
  return value as number;
}

function exactObject(
  value: unknown,
  keys: readonly string[],
  label: string,
): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("\u0000") !== [...keys].sort().join("\u0000")
  ) {
    throw new SpanAudioAcceptanceError("SPAN_INPUT_INVALID", `${label} has invalid fields.`);
  }
  return value as Record<string, unknown>;
}

function sourceValues(value: unknown): Record<string, unknown> {
  return exactObject(value, ["asset_id", "sha256", "artifact_uri", "duration_ms"], "source");
}

function selectionValues(value: unknown): Record<string, unknown> {
  return exactObject(
    value,
    [
      "selected_start_ms",
      "selected_end_ms_exclusive",
      "padded_start_ms",
      "padded_end_ms_exclusive",
      "trim_start_ms",
      "trim_end_ms_exclusive",
    ],
    "selection",
  );
}

export async function buildSelectedSpanAudioJob(
  request: BuildSelectedSpanAudioJobInput,
): Promise<SelectedSpanAudioJobDispatch> {
  assertId(request.projectRevisionId, "project revision ID");
  assertId(request.attemptId, "attempt ID");
  assertId(request.timelinePlanId, "timeline plan ID");
  assertId(request.transcriptId, "transcript ID");
  assertId(request.span.spanId, "span ID");
  assertId(request.span.timelineSegmentId, "timeline segment ID");
  assertId(request.span.sourceAssetId, "source asset ID");
  assertTaskKey(request.span.taskKey);
  assertHash(request.span.sourceBinarySha256, "source SHA-256");
  const sourceDurationMs = assertInteger(request.sourceDurationMs, "source duration", 10_000);
  const paddedStartMs = assertInteger(request.span.paddedStartMs, "padded start");
  const paddedEndMs = assertInteger(request.span.paddedEndMsExclusive, "padded end", 1);
  const selectedStartMs = assertInteger(request.span.selectedStartMs, "selected start");
  const selectedEndMs = assertInteger(request.span.selectedEndMsExclusive, "selected end", 1);
  const trimStartMs = assertInteger(request.span.trimStartMs, "trim start");
  const trimEndMs = assertInteger(request.span.trimEndMsExclusive, "trim end", 1);
  if (
    request.span.transcriptId !== request.transcriptId ||
    paddedEndMs > sourceDurationMs ||
    paddedStartMs > selectedStartMs ||
    selectedStartMs >= selectedEndMs ||
    selectedEndMs > paddedEndMs ||
    trimStartMs !== selectedStartMs - paddedStartMs ||
    trimEndMs !== trimStartMs + selectedEndMs - selectedStartMs
  ) {
    throw new SpanAudioAcceptanceError(
      "SPAN_INPUT_INVALID",
      "The selected and padded span lineage is inconsistent.",
    );
  }
  const sourceMatch = request.sourceArtifactUri.match(
    /^vf-local:\/\/objects\/sha256\/([0-9a-f]{2})\/([0-9a-f]{64})\.[a-z0-9]{1,10}$/u,
  );
  if (
    sourceMatch === null ||
    sourceMatch[1] !== sourceMatch[2]?.slice(0, 2) ||
    request.span.sourceBinarySha256 !== `sha256:${sourceMatch[2]}`
  ) {
    throw new SpanAudioAcceptanceError(
      "SPAN_INPUT_INVALID",
      "The source artifact URI does not match the selected voiceover hash.",
    );
  }
  if (
    typeof request.cancelToken !== "string" ||
    request.cancelToken.length < 16 ||
    request.cancelToken.length > 240
  ) {
    throw new SpanAudioAcceptanceError("SPAN_INPUT_INVALID", "The cancel token is invalid.");
  }

  const outputAssetId = stableUuid(
    "videoforge:selected-span-audio-output:v1",
    request.projectRevisionId,
    request.timelinePlanId,
    request.span.spanId,
    request.attemptId,
  );
  const resultUri = `vf-local-run://${request.projectRevisionId}/${request.attemptId}/span-audio-result.json`;
  const input: JsonObject = Object.freeze({
    schema_version: "selected-span-audio-job/v1",
    project_revision_id: request.projectRevisionId,
    attempt_id: request.attemptId,
    timeline_plan_id: request.timelinePlanId,
    transcript_id: request.transcriptId,
    span_id: request.span.spanId,
    timeline_segment_id: request.span.timelineSegmentId,
    task_key: request.span.taskKey,
    source_voiceover: Object.freeze({
      asset_id: request.span.sourceAssetId,
      sha256: request.span.sourceBinarySha256,
      artifact_uri: request.sourceArtifactUri,
      duration_ms: sourceDurationMs,
    }),
    selection: Object.freeze({
      selected_start_ms: selectedStartMs,
      selected_end_ms_exclusive: selectedEndMs,
      padded_start_ms: paddedStartMs,
      padded_end_ms_exclusive: paddedEndMs,
      trim_start_ms: trimStartMs,
      trim_end_ms_exclusive: trimEndMs,
    }),
    output: Object.freeze({ asset_id: outputAssetId, result_uri: resultUri }),
    cancel_token: request.cancelToken,
  });
  return Object.freeze({
    input,
    inputHash: asSha256(await sha256CanonicalJson(input as JsonValue)),
    outputAssetId,
    resultUri,
  });
}

export async function prepareSelectedSpanAudioAcceptance(
  command: AcceptSelectedSpanAudioCommand,
): Promise<PreparedSelectedSpanAudioAcceptance> {
  canonicalizeJson(command.jobInput);
  canonicalizeJson(command.jobResult);
  const input = exactObject(
    command.jobInput,
    [
      "schema_version",
      "project_revision_id",
      "attempt_id",
      "timeline_plan_id",
      "transcript_id",
      "span_id",
      "timeline_segment_id",
      "task_key",
      "source_voiceover",
      "selection",
      "output",
      "cancel_token",
    ],
    "span job input",
  );
  const result = exactObject(
    command.jobResult,
    [
      "schema_version",
      "attempt_id",
      "status",
      "span_id",
      "timeline_plan_id",
      "transcript_id",
      "timeline_segment_id",
      "task_key",
      "source_voiceover",
      "selection",
      "audio",
      "error",
    ],
    "span job result",
  );
  if (
    input.schema_version !== "selected-span-audio-job/v1" ||
    result.schema_version !== "selected-span-audio-result/v1"
  ) {
    throw new SpanAudioAcceptanceError("SPAN_INPUT_INVALID", "Span schema version is invalid.");
  }
  if (result.status !== "SUCCEEDED" || result.error !== null || result.audio === null) {
    throw new SpanAudioAcceptanceError(
      "SPAN_RESULT_NOT_SUCCESSFUL",
      "Only successful selected span audio can be accepted.",
    );
  }

  const inputSource = sourceValues(input.source_voiceover);
  const resultSource = exactObject(
    result.source_voiceover,
    ["asset_id", "sha256", "duration_ms"],
    "result source",
  );
  const inputSelection = selectionValues(input.selection);
  const resultSelection = selectionValues(result.selection);
  const output = exactObject(input.output, ["asset_id", "result_uri"], "span output");
  const audio = exactObject(
    result.audio,
    [
      "asset_id",
      "sha256",
      "artifact_uri",
      "content_type",
      "byte_size",
      "duration_ms",
      "sample_rate_hz",
      "channels",
    ],
    "materialized audio",
  );
  const attemptId = assertId(input.attempt_id, "attempt ID");
  const projectRevisionId = assertId(input.project_revision_id, "project revision ID");
  const timelinePlanId = assertId(input.timeline_plan_id, "timeline plan ID");
  const transcriptId = assertId(input.transcript_id, "transcript ID");
  const spanId = assertId(input.span_id, "span ID");
  const timelineSegmentId = assertId(input.timeline_segment_id, "timeline segment ID");
  const outputAssetId = assertId(output.asset_id, "output asset ID");
  const outputHash = assertHash(audio.sha256, "output SHA-256");
  const artifactUri = typeof audio.artifact_uri === "string" ? audio.artifact_uri : "";
  const artifactMatch = artifactUri.match(OBJECT_URI);
  const durationMs = assertInteger(audio.duration_ms, "output duration", 1);
  const byteSize = assertInteger(audio.byte_size, "output byte size", 45, Number.MAX_SAFE_INTEGER);
  const sourceDurationMs = assertInteger(inputSource.duration_ms, "source duration", 10_000);
  const sourceHash = assertHash(inputSource.sha256, "source SHA-256");
  assertId(inputSource.asset_id, "source asset ID");
  const sourceUri = typeof inputSource.artifact_uri === "string" ? inputSource.artifact_uri : "";
  const sourceMatch = sourceUri.match(SOURCE_OBJECT_URI);
  const taskKey = assertTaskKey(input.task_key);
  const cancelToken = typeof input.cancel_token === "string" ? input.cancel_token : "";
  const resultUri = typeof output.result_uri === "string" ? output.result_uri : "";
  const paddedStartMs = assertInteger(inputSelection.padded_start_ms, "padded start");
  const paddedEndMs = assertInteger(inputSelection.padded_end_ms_exclusive, "padded end", 1);
  const selectedStartMs = assertInteger(inputSelection.selected_start_ms, "selected start");
  const selectedEndMs = assertInteger(inputSelection.selected_end_ms_exclusive, "selected end", 1);
  const trimStartMs = assertInteger(inputSelection.trim_start_ms, "trim start");
  const trimEndMs = assertInteger(inputSelection.trim_end_ms_exclusive, "trim end", 1);
  const inputHash = asSha256(await sha256CanonicalJson(command.jobInput as JsonValue));
  const resultHash = asSha256(await sha256CanonicalJson(command.jobResult as JsonValue));

  if (
    result.attempt_id !== attemptId ||
    result.span_id !== spanId ||
    result.timeline_plan_id !== timelinePlanId ||
    result.transcript_id !== transcriptId ||
    result.timeline_segment_id !== timelineSegmentId ||
    result.task_key !== taskKey ||
    cancelToken.length < 16 ||
    cancelToken.length > 240 ||
    resultUri !== `vf-local-run://${projectRevisionId}/${attemptId}/span-audio-result.json` ||
    sourceMatch === null ||
    sourceMatch[1] !== sourceMatch[2]?.slice(0, 2) ||
    sourceHash !== `sha256:${sourceMatch[2]}` ||
    !(
      paddedStartMs <= selectedStartMs &&
      selectedStartMs < selectedEndMs &&
      selectedEndMs <= paddedEndMs &&
      paddedEndMs <= sourceDurationMs &&
      trimStartMs === selectedStartMs - paddedStartMs &&
      trimEndMs === trimStartMs + selectedEndMs - selectedStartMs
    ) ||
    canonicalizeJson(resultSource) !==
      canonicalizeJson({
        asset_id: inputSource.asset_id,
        sha256: inputSource.sha256,
        duration_ms: inputSource.duration_ms,
      }) ||
    canonicalizeJson(resultSelection) !== canonicalizeJson(inputSelection) ||
    audio.asset_id !== outputAssetId ||
    audio.content_type !== "audio/wav" ||
    audio.sample_rate_hz !== 16_000 ||
    audio.channels !== 1 ||
    durationMs !== paddedEndMs - paddedStartMs ||
    artifactMatch === null ||
    artifactMatch[1] !== artifactMatch[2]?.slice(0, 2) ||
    outputHash !== `sha256:${artifactMatch[2]}`
  ) {
    throw new SpanAudioAcceptanceError(
      "SPAN_RESULT_MISMATCH",
      "The materialized audio does not match its exact selected span lineage.",
    );
  }

  const metadata = Object.freeze({
    worker: "image-media",
    job_type: "SELECTED_SPAN_AUDIO",
    dispatch_target: "LOCAL",
    span_audio_input_hash: inputHash,
    span_audio_result_hash: resultHash,
    span_id: spanId,
    timeline_plan_id: timelinePlanId,
    transcript_id: transcriptId,
    timeline_segment_id: timelineSegmentId,
    task_key: taskKey,
    source_asset_id: inputSource.asset_id as string,
    source_binary_sha256: sourceHash,
    selected_start_ms: selectedStartMs,
    selected_end_ms_exclusive: selectedEndMs,
    padded_start_ms: paddedStartMs,
    padded_end_ms_exclusive: paddedEndMs,
    trim_start_ms: trimStartMs,
    trim_end_ms_exclusive: trimEndMs,
    sample_rate_hz: 16_000,
    channels: 1,
  });

  return Object.freeze({
    inputHash,
    resultHash,
    artifactRegistration: Object.freeze({
      idempotencyKey: stableKey("span-audio-artifact", inputHash),
      assetId: outputAssetId,
      projectId: command.projectId,
      projectRevisionId,
      sourceAttemptId: attemptId,
      kind: "AUDIO_SPAN" as const,
      objectKey: artifactUri,
      contentType: "audio/wav",
      metadata,
    }),
    artifactBinding: Object.freeze({
      idempotencyKey: stableKey("span-audio-bind", inputHash),
      assetId: outputAssetId,
      binarySha256: outputHash,
      byteSize: BigInt(byteSize),
      contentType: "audio/wav",
      widthPx: null,
      heightPx: null,
      durationMs: BigInt(durationMs),
      verifiedAt: command.finishedAt,
    }),
    recordSuccessfulResult: Object.freeze({
      idempotencyKey: stableKey("span-audio-result", inputHash),
      taskId: command.taskId,
      attemptId,
      outputAssetId,
      outputBinarySha256: outputHash,
      providerDetails: Object.freeze({
        dispatch_target: "LOCAL",
        worker: "image-media",
        job_type: "SELECTED_SPAN_AUDIO",
        span_audio_input_hash: inputHash,
        span_audio_result_hash: resultHash,
      }),
      finishedAt: command.finishedAt,
    }),
    materialization: Object.freeze({
      idempotencyKey: stableKey("span-audio-materialize", inputHash),
      projectId: command.projectId,
      projectRevisionId,
      expectedHeadVersion: command.expectedHeadVersion,
      timelinePlanId,
      transcriptId,
      spanId,
      expectedSpanVersion: command.expectedSpanVersion,
      outputAttemptId: attemptId,
      materializedAssetId: outputAssetId,
      materializedBinarySha256: outputHash,
      materializedDurationMs: durationMs,
      materializedAt: command.finishedAt,
    }),
  });
}

function propagateFailure<Value>(
  result: RepositoryResult<Value, string, string, string>,
): RepositoryResult<never, string, string, string> {
  if (result.ok) throw new TypeError("cannot propagate a successful repository result");
  return result;
}

export class DurableSelectedSpanAudioPersistence {
  public constructor(private readonly repositories: ControlPlaneRepositories) {}

  public async accept(
    scope: WorkspaceActorScope,
    command: AcceptSelectedSpanAudioCommand,
  ): Promise<SpanAudioResult> {
    const prepared = await prepareSelectedSpanAudioAcceptance(command);
    return this.repositories.unitOfWork.execute<AcceptedSelectedSpanAudio, string, string, string>(
      scope,
      async (repositories) => {
        const registered = await repositories.artifacts.registerMetadata(
          scope,
          prepared.artifactRegistration,
        );
        if (!registered.ok) return propagateFailure(registered);
        const bound = await repositories.artifacts.bindBinaryContent(
          scope,
          prepared.artifactBinding,
        );
        if (!bound.ok) return propagateFailure(bound);
        const successful = await repositories.execution.recordSuccessfulResult(
          scope,
          prepared.recordSuccessfulResult,
        );
        if (!successful.ok) return propagateFailure(successful);
        const accepted = await repositories.execution.acceptSuccessfulResult(scope, {
          idempotencyKey: stableKey("span-audio-accept", prepared.inputHash),
          candidateReference: successful.value.value.reference,
          acceptedAt: command.finishedAt,
        });
        if (!accepted.ok) return propagateFailure(accepted);
        const span = await repositories.timing.materializeSelectedSpanAudio(
          scope,
          prepared.materialization,
        );
        if (!span.ok) return propagateFailure(span);
        return {
          ok: true,
          value: Object.freeze({
            span: span.value.value,
            artifact: bound.value.value,
            acceptedAttempt: accepted.value.value,
            inputHash: prepared.inputHash,
            resultHash: prepared.resultHash,
            replayed:
              registered.value.replayed &&
              bound.value.replayed &&
              successful.value.replayed &&
              accepted.value.replayed &&
              span.value.replayed,
          }),
        };
      },
    );
  }
}

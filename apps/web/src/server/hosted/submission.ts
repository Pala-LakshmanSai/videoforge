import type { RenderJobInputDocument } from "@videoforge/contracts/generated/contract-types.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const LOCAL_OBJECT = /^vf-local:\/\/objects\/sha256\/[0-9a-f]{2}\/([0-9a-f]{64})\.[a-z0-9]{1,10}$/u;
const JOB_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const RUN_MP4 =
  /^vf-local-run:\/\/[A-Za-z0-9][A-Za-z0-9._:-]*\/[A-Za-z0-9][A-Za-z0-9._:-]*\/[A-Za-z0-9][A-Za-z0-9._-]{0,159}\.mp4$/u;
const FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.mp4$/u;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).sort().join(",") === [...keys].sort().join(",");

const isBoundedId = (value: unknown): value is string =>
  typeof value === "string" && value.length >= 1 && value.length <= 160 && JOB_ID.test(value);

const isSha256 = (value: unknown): value is string =>
  typeof value === "string" && SHA256.test(value);

const isObjectUri = (value: unknown): value is string =>
  typeof value === "string" && LOCAL_OBJECT.test(value);

const isStringWithLength = (value: unknown, minimum: number, maximum: number): value is string =>
  typeof value === "string" &&
  Array.from(value).length >= minimum &&
  Array.from(value).length <= maximum;

/** Exact structural equivalent of the generated render-job-input/v1 schema. */
const isRenderJobInputDocument = (value: unknown): value is RenderJobInputDocument => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "schema_version",
      "project_revision_id",
      "attempt_id",
      "resolved_render_manifest",
      "assets",
      "output",
      "tools",
      "cancel_token",
    ]) ||
    value.schema_version !== "render-job-input/v1" ||
    !isBoundedId(value.project_revision_id) ||
    !isBoundedId(value.attempt_id) ||
    !isRecord(value.resolved_render_manifest) ||
    !hasExactKeys(value.resolved_render_manifest, ["asset_id", "sha256", "artifact_uri"]) ||
    !isBoundedId(value.resolved_render_manifest.asset_id) ||
    !isSha256(value.resolved_render_manifest.sha256) ||
    !isObjectUri(value.resolved_render_manifest.artifact_uri) ||
    !Array.isArray(value.assets) ||
    value.assets.length < 2 ||
    value.assets.length > 20000 ||
    !isRecord(value.output) ||
    !hasExactKeys(value.output, ["result_uri", "filename"]) ||
    typeof value.output.result_uri !== "string" ||
    !RUN_MP4.test(value.output.result_uri) ||
    !isStringWithLength(value.output.filename, 5, 160) ||
    !FILENAME.test(value.output.filename) ||
    !isRecord(value.tools) ||
    !hasExactKeys(value.tools, ["ffmpeg_version", "ffprobe_version"]) ||
    !isStringWithLength(value.tools.ffmpeg_version, 1, 80) ||
    !isStringWithLength(value.tools.ffprobe_version, 1, 80) ||
    !isStringWithLength(value.cancel_token, 32, 512)
  ) {
    return false;
  }
  for (const asset of value.assets) {
    if (
      !isRecord(asset) ||
      !hasExactKeys(asset, ["asset_id", "sha256", "artifact_uri", "kind"]) ||
      !isBoundedId(asset.asset_id) ||
      !isSha256(asset.sha256) ||
      !isObjectUri(asset.artifact_uri) ||
      typeof asset.kind !== "string" ||
      !["VOICEOVER", "AVATAR_CLIP", "IMAGE"].includes(asset.kind)
    ) {
      return false;
    }
  }
  return true;
};

export interface HostedCpuSubmission {
  readonly idempotencyKey: string;
  readonly projectId: string;
  readonly projectRevisionId: string;
  readonly kind: "ASR" | "RENDER";
  readonly inputDocument: Record<string, unknown>;
  readonly objects: readonly { readonly receiptId: string; readonly uri: string }[];
}

export interface HostedSpanAudioSubmission extends Omit<HostedCpuSubmission, "kind"> {
  readonly kind: "SPAN_AUDIO";
}

export function exactSelectedSpanAudioInput(value: unknown): Record<string, unknown> | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
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
      "output_profile",
    ])
  )
    return null;
  if (
    value.schema_version !== "selected-span-audio-job/v1" ||
    value.output_profile !== "SOULX_PCM16_48K_MONO" ||
    ![
      value.project_revision_id,
      value.attempt_id,
      value.timeline_plan_id,
      value.transcript_id,
      value.span_id,
      value.timeline_segment_id,
    ].every(isBoundedId) ||
    !isBoundedId(value.task_key) ||
    !isStringWithLength(value.cancel_token, 16, 240) ||
    !isRecord(value.source_voiceover) ||
    !hasExactKeys(value.source_voiceover, ["asset_id", "sha256", "artifact_uri", "duration_ms"]) ||
    !isBoundedId(value.source_voiceover.asset_id) ||
    !isSha256(value.source_voiceover.sha256) ||
    !isObjectUri(value.source_voiceover.artifact_uri) ||
    !Number.isSafeInteger(value.source_voiceover.duration_ms) ||
    Number(value.source_voiceover.duration_ms) < 10_000 ||
    !isRecord(value.selection) ||
    !hasExactKeys(value.selection, [
      "selected_start_ms",
      "selected_end_ms_exclusive",
      "padded_start_ms",
      "padded_end_ms_exclusive",
      "trim_start_ms",
      "trim_end_ms_exclusive",
    ]) ||
    !Object.values(value.selection).every(Number.isSafeInteger) ||
    !isRecord(value.output) ||
    !hasExactKeys(value.output, ["asset_id", "result_uri"]) ||
    !isBoundedId(value.output.asset_id) ||
    typeof value.output.result_uri !== "string"
  )
    return null;
  const sourceMatch = LOCAL_OBJECT.exec(String(value.source_voiceover.artifact_uri));
  const selection = value.selection as Record<string, number>;
  const paddedStart = selection.padded_start_ms!;
  const paddedEnd = selection.padded_end_ms_exclusive!;
  const selectedStart = selection.selected_start_ms!;
  const selectedEnd = selection.selected_end_ms_exclusive!;
  const trimStart = selection.trim_start_ms!;
  const trimEnd = selection.trim_end_ms_exclusive!;
  if (
    !sourceMatch ||
    value.source_voiceover.sha256 !== `sha256:${sourceMatch[1]}` ||
    paddedStart < 0 ||
    selectedStart < paddedStart ||
    selectedEnd <= selectedStart ||
    paddedEnd < selectedEnd ||
    trimStart !== selectedStart - paddedStart ||
    trimEnd !== trimStart + selectedEnd - selectedStart ||
    paddedEnd > Number(value.source_voiceover.duration_ms) + 20 ||
    value.output.result_uri !==
      `vf-local-run://${String(value.project_revision_id)}/${String(value.attempt_id)}/span-audio-result.json`
  )
    return null;
  return structuredClone(value);
}

/** Server-owned only. Never add SPAN_AUDIO to the ordinary browser submission parser. */
export function exactHostedSpanAudioSubmission(
  value: unknown,
  expectedAttemptId?: string,
): HostedSpanAudioSubmission | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "schema_version",
      "idempotency_key",
      "project_id",
      "project_revision_id",
      "kind",
      "input_document",
      "objects",
    ]) ||
    value.schema_version !== "videoforge-hosted-cpu-submission/v1" ||
    value.kind !== "SPAN_AUDIO" ||
    !isBoundedId(value.idempotency_key) ||
    typeof value.project_id !== "string" ||
    !UUID.test(value.project_id) ||
    typeof value.project_revision_id !== "string" ||
    !UUID.test(value.project_revision_id) ||
    !Array.isArray(value.objects) ||
    value.objects.length !== 1
  )
    return null;
  const inputDocument = exactSelectedSpanAudioInput(value.input_document);
  if (
    !inputDocument ||
    inputDocument.project_revision_id !== value.project_revision_id ||
    (expectedAttemptId !== undefined && inputDocument.attempt_id !== expectedAttemptId)
  )
    return null;
  const object = value.objects[0];
  if (
    !isRecord(object) ||
    !hasExactKeys(object, ["artifact_receipt_id", "uri"]) ||
    typeof object.artifact_receipt_id !== "string" ||
    !UUID.test(object.artifact_receipt_id) ||
    object.uri !== (inputDocument.source_voiceover as Record<string, unknown>).artifact_uri
  )
    return null;
  return Object.freeze({
    idempotencyKey: String(value.idempotency_key),
    projectId: value.project_id,
    projectRevisionId: value.project_revision_id,
    kind: "SPAN_AUDIO",
    inputDocument,
    objects: Object.freeze([{ receiptId: object.artifact_receipt_id, uri: String(object.uri) }]),
  });
}

/**
 * A render submission is never accepted as a client-created job.  It must be
 * an exact, tenant-owned plan persisted with the locked project revision.
 * Keeping this check next to the wire parser makes both the handoff route and
 * the generic CPU submission route apply the same fail-closed rule.
 */
export function exactHostedRenderSubmission(
  value: unknown,
  projectId?: string,
  projectRevisionId?: string,
): HostedCpuSubmission | null {
  const submission = exactHostedCpuSubmission(value);
  if (
    !submission ||
    submission.kind !== "RENDER" ||
    (projectId !== undefined && submission.projectId !== projectId) ||
    (projectRevisionId !== undefined && submission.projectRevisionId !== projectRevisionId)
  ) {
    return null;
  }
  return submission;
}

export function canonicalJson(value: unknown): string {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    throw new TypeError("Hosted canonical JSON cannot contain non-JSON values.");
  }
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new TypeError("Hosted canonical JSON value is unsupported.");
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

export function exactHostedCpuSubmission(value: unknown): HostedCpuSubmission | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !==
      "idempotency_key,input_document,kind,objects,project_id,project_revision_id,schema_version" ||
    record.schema_version !== "videoforge-hosted-cpu-submission/v1" ||
    typeof record.idempotency_key !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{15,159}$/u.test(record.idempotency_key) ||
    typeof record.project_id !== "string" ||
    !UUID.test(record.project_id) ||
    typeof record.project_revision_id !== "string" ||
    !UUID.test(record.project_revision_id) ||
    !["ASR", "RENDER"].includes(String(record.kind)) ||
    typeof record.input_document !== "object" ||
    record.input_document === null ||
    Array.isArray(record.input_document) ||
    !Array.isArray(record.objects) ||
    record.objects.length < 1 ||
    record.objects.length > 4096
  ) {
    return null;
  }
  const objects: { receiptId: string; uri: string }[] = [];
  const receipts = new Set<string>();
  const uris = new Set<string>();
  for (const item of record.objects) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return null;
    const object = item as Record<string, unknown>;
    if (
      Object.keys(object).sort().join(",") !== "artifact_receipt_id,uri" ||
      typeof object.artifact_receipt_id !== "string" ||
      !UUID.test(object.artifact_receipt_id) ||
      typeof object.uri !== "string" ||
      !LOCAL_OBJECT.test(object.uri) ||
      receipts.has(object.artifact_receipt_id) ||
      uris.has(object.uri)
    ) {
      return null;
    }
    receipts.add(object.artifact_receipt_id);
    uris.add(object.uri);
    objects.push({ receiptId: object.artifact_receipt_id, uri: object.uri });
  }
  if (record.kind === "RENDER") {
    if (!isRenderJobInputDocument(record.input_document)) return null;
    const renderInput = record.input_document as RenderJobInputDocument;
    if (renderInput.project_revision_id !== record.project_revision_id) return null;

    const requiredObjects = [renderInput.resolved_render_manifest, ...renderInput.assets];
    if (new Set(requiredObjects.map((object) => object.artifact_uri)).size !== objects.length) {
      return null;
    }
    const suppliedObjects = new Map(objects.map((object) => [object.uri, object]));
    for (const object of requiredObjects) {
      const supplied = suppliedObjects.get(object.artifact_uri);
      if (!supplied) return null;
      const match = LOCAL_OBJECT.exec(object.artifact_uri);
      if (!match || object.sha256 !== `sha256:${match[1]}`) return null;
    }
  }
  return Object.freeze({
    idempotencyKey: record.idempotency_key,
    projectId: record.project_id,
    projectRevisionId: record.project_revision_id,
    kind: record.kind as "ASR" | "RENDER",
    inputDocument: structuredClone(record.input_document as Record<string, unknown>),
    objects: Object.freeze(objects),
  });
}

export function bindHostedCpuInputDocument(
  document: Record<string, unknown>,
  kind: "ASR" | "SPAN_AUDIO" | "RENDER",
  projectRevisionId: string,
  attemptId: string,
): Record<string, unknown> {
  const expectedSchema =
    kind === "ASR"
      ? "asr-job-input/v1"
      : kind === "SPAN_AUDIO"
        ? "selected-span-audio-job/v1"
        : "render-job-input/v1";
  if (document.schema_version !== expectedSchema) {
    throw new TypeError("Hosted CPU input document does not match its exact job kind.");
  }
  const bound = structuredClone(document);
  bound.project_revision_id = projectRevisionId;
  bound.attempt_id = attemptId;
  bound.cancel_token = attemptId;
  const output = bound.output;
  if (typeof output !== "object" || output === null || Array.isArray(output)) {
    throw new TypeError("Hosted CPU input document has no exact output declaration.");
  }
  const outputRecord = output as Record<string, unknown>;
  outputRecord.result_uri =
    kind === "ASR"
      ? `vf-local-run://${projectRevisionId}/${attemptId}/asr-result.json`
      : kind === "SPAN_AUDIO"
        ? `vf-local-run://${projectRevisionId}/${attemptId}/span-audio-result.json`
        : `vf-local-run://${projectRevisionId}/${attemptId}/videoforge-output.mp4`;
  if (kind === "RENDER") outputRecord.filename = "videoforge-output.mp4";
  if (kind === "RENDER") {
    if (!isRenderJobInputDocument(bound)) {
      throw new TypeError("Hosted CPU input document does not match its exact job contract.");
    }
  }
  return bound;
}

export function whisperModelUri(document: Record<string, unknown>): string {
  const model = document.model;
  if (typeof model !== "object" || model === null || Array.isArray(model)) {
    throw new TypeError("Hosted ASR input has no exact model identity.");
  }
  const digest = (model as Record<string, unknown>).sha256;
  if (typeof digest !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(digest)) {
    throw new TypeError("Hosted ASR model checksum is invalid.");
  }
  const hex = digest.slice("sha256:".length);
  return `vf-local://objects/sha256/${hex.slice(0, 2)}/${hex}.bin`;
}

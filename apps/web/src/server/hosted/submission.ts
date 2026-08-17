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
  kind: "ASR" | "RENDER",
  projectRevisionId: string,
  attemptId: string,
): Record<string, unknown> {
  const expectedSchema = kind === "ASR" ? "asr-job-input/v1" : "render-job-input/v1";
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

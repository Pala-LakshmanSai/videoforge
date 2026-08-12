import { createHash } from "node:crypto";

export const MAGE_CANDIDATE_IMAGE =
  "ghcr.io/pala-lakshmansai/videoforge-mage@sha256:9f3dc9d886b309e74adac3d7d101ee546d8d3a31d123dd1c203852d22709334b";
export const MAGE_MODEL_REVISION = "d8c99241f6fa80fbd453014234af2bf337ea21e6";
export const MAGE_SOURCE_REVISION = "1108f2ac5e412b27accb0e5d51c90ef2ba39784d";
export const MAGE_GPU = "NVIDIA GeForce RTX 4090";

const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/u;
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export class MageResultError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "MageResultError";
  }
}

export interface MageResultAuthority {
  readonly attemptId: string;
  readonly sceneId: string;
  readonly promptSha256: string;
  readonly negativePromptSha256: string;
  readonly seed: number;
  readonly width: 1280;
  readonly height: 720;
  readonly image: typeof MAGE_CANDIDATE_IMAGE;
  readonly modelRevision: typeof MAGE_MODEL_REVISION;
  readonly sourceRevision: typeof MAGE_SOURCE_REVISION;
  readonly gpu: typeof MAGE_GPU;
  readonly maximumCostUsd: number;
}

export interface AcceptedMageResult {
  readonly output: Buffer;
  readonly evidence: Readonly<Record<string, unknown>>;
}

const record = (value: unknown, code: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new MageResultError(code);
  return value as Record<string, unknown>;
};

const exactKeys = (value: Record<string, unknown>, keys: readonly string[], code: string): void => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new MageResultError(code);
  }
};

const integer = (value: unknown, minimum: number, maximum: number, code: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new MageResultError(code);
  }
  return value as number;
};

const duration = (value: unknown): number => integer(value, 0, 3_600_000, "MAGE_TIMING_INVALID");

const hash = (bytes: Buffer): string =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

const decodePng = (encoded: unknown, expectedHash: unknown, expectedBytes: unknown): Buffer => {
  if (typeof encoded !== "string" || encoded.length < 16 || encoded.length > 24 * 1024 * 1024) {
    throw new MageResultError("MAGE_OUTPUT_BASE64_INVALID");
  }
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.toString("base64") !== encoded) throw new MageResultError("MAGE_OUTPUT_BASE64_INVALID");
  if (
    !SHA256.test(String(expectedHash)) ||
    hash(bytes) !== expectedHash ||
    integer(expectedBytes, 1, 16 * 1024 * 1024, "MAGE_OUTPUT_BYTES_INVALID") !== bytes.length
  ) {
    throw new MageResultError("MAGE_OUTPUT_HASH_INVALID");
  }
  if (
    bytes.length < 45 ||
    !bytes.subarray(0, 8).equals(PNG) ||
    bytes.toString("ascii", 12, 16) !== "IHDR" ||
    bytes.readUInt32BE(16) !== 1280 ||
    bytes.readUInt32BE(20) !== 720
  ) {
    throw new MageResultError("MAGE_OUTPUT_PROFILE_INVALID");
  }
  return bytes;
};

const validateRuntime = (
  value: unknown,
  authority: MageResultAuthority,
): Record<string, unknown> => {
  const runtime = record(value, "MAGE_RUNTIME_EVIDENCE_INVALID");
  exactKeys(
    runtime,
    [
      "schema_version",
      "network_volume_attached",
      "handler_received_unix_ms",
      "handler_completed_unix_ms",
      "bootstrap",
      "comfy_start",
      "gpu",
    ],
    "MAGE_RUNTIME_EVIDENCE_INVALID",
  );
  if (
    runtime.schema_version !== "videoforge.mage-runtime-evidence/v1" ||
    runtime.network_volume_attached !== false
  ) {
    throw new MageResultError("MAGE_RUNTIME_EVIDENCE_INVALID");
  }
  const received = integer(
    runtime.handler_received_unix_ms,
    1,
    Number.MAX_SAFE_INTEGER,
    "MAGE_TIMING_INVALID",
  );
  const completed = integer(
    runtime.handler_completed_unix_ms,
    received,
    Number.MAX_SAFE_INTEGER,
    "MAGE_TIMING_INVALID",
  );
  if (completed - received > 3_600_000) throw new MageResultError("MAGE_TIMING_INVALID");

  const bootstrap = record(runtime.bootstrap, "MAGE_BOOTSTRAP_EVIDENCE_INVALID");
  exactKeys(
    bootstrap,
    [
      "schema_version",
      "model_revision",
      "cache_hit",
      "started_unix_ms",
      "completed_unix_ms",
      "duration_ms",
    ],
    "MAGE_BOOTSTRAP_EVIDENCE_INVALID",
  );
  if (
    bootstrap.schema_version !== "videoforge.mage-bootstrap/v1" ||
    bootstrap.model_revision !== authority.modelRevision ||
    typeof bootstrap.cache_hit !== "boolean" ||
    duration(bootstrap.duration_ms) !==
      integer(bootstrap.completed_unix_ms, 1, Number.MAX_SAFE_INTEGER, "MAGE_TIMING_INVALID") -
        integer(bootstrap.started_unix_ms, 1, Number.MAX_SAFE_INTEGER, "MAGE_TIMING_INVALID")
  ) {
    throw new MageResultError("MAGE_BOOTSTRAP_EVIDENCE_INVALID");
  }

  const comfy = record(runtime.comfy_start, "MAGE_COMFY_EVIDENCE_INVALID");
  exactKeys(
    comfy,
    ["schema_version", "source_revision", "started_unix_ms", "completed_unix_ms", "duration_ms"],
    "MAGE_COMFY_EVIDENCE_INVALID",
  );
  if (
    comfy.schema_version !== "videoforge.mage-comfy-start/v1" ||
    comfy.source_revision !== authority.sourceRevision ||
    duration(comfy.duration_ms) !==
      integer(comfy.completed_unix_ms, 1, Number.MAX_SAFE_INTEGER, "MAGE_TIMING_INVALID") -
        integer(comfy.started_unix_ms, 1, Number.MAX_SAFE_INTEGER, "MAGE_TIMING_INVALID")
  ) {
    throw new MageResultError("MAGE_COMFY_EVIDENCE_INVALID");
  }

  const gpu = record(runtime.gpu, "MAGE_GPU_EVIDENCE_INVALID");
  exactKeys(
    gpu,
    ["name", "total_memory_bytes", "cuda_version", "torch_version"],
    "MAGE_GPU_EVIDENCE_INVALID",
  );
  if (
    gpu.name !== authority.gpu ||
    integer(gpu.total_memory_bytes, 24_000_000_000, 27_000_000_000, "MAGE_GPU_EVIDENCE_INVALID") <
      1 ||
    typeof gpu.cuda_version !== "string" ||
    typeof gpu.torch_version !== "string"
  ) {
    throw new MageResultError("MAGE_GPU_EVIDENCE_INVALID");
  }
  return runtime;
};

export const acceptMageResult = (
  value: unknown,
  authority: MageResultAuthority,
  reportedCostUsd: number,
): AcceptedMageResult => {
  if (
    !ID.test(authority.attemptId) ||
    !ID.test(authority.sceneId) ||
    !SHA256.test(authority.promptSha256) ||
    !SHA256.test(authority.negativePromptSha256) ||
    authority.image !== MAGE_CANDIDATE_IMAGE ||
    authority.modelRevision !== MAGE_MODEL_REVISION ||
    authority.sourceRevision !== MAGE_SOURCE_REVISION ||
    authority.gpu !== MAGE_GPU ||
    !Number.isFinite(authority.maximumCostUsd) ||
    authority.maximumCostUsd <= 0 ||
    !Number.isFinite(reportedCostUsd) ||
    reportedCostUsd < 0 ||
    reportedCostUsd > authority.maximumCostUsd
  ) {
    throw new MageResultError("MAGE_AUTHORITY_INVALID");
  }
  const envelope = record(value, "MAGE_RESULT_ENVELOPE_INVALID");
  exactKeys(envelope, ["ok", "result"], "MAGE_RESULT_ENVELOPE_INVALID");
  if (envelope.ok !== true) throw new MageResultError("MAGE_RESULT_ENVELOPE_INVALID");
  const result = record(envelope.result, "MAGE_RESULT_INVALID");
  exactKeys(
    result,
    [
      "schema_version",
      "attempt_id",
      "scene_id",
      "output_sha256",
      "bytes",
      "width",
      "height",
      "seed",
      "positive_prompt_sha256",
      "negative_prompt_sha256",
      "source_revision",
      "model_revision",
      "renderer_source_profile",
      "generation_duration_ms",
      "output_base64",
      "runtime_evidence",
    ],
    "MAGE_RESULT_INVALID",
  );
  if (
    result.schema_version !== "videoforge.mage-image-result/v1" ||
    result.attempt_id !== authority.attemptId ||
    result.scene_id !== authority.sceneId ||
    result.positive_prompt_sha256 !== authority.promptSha256 ||
    result.negative_prompt_sha256 !== authority.negativePromptSha256 ||
    result.source_revision !== authority.sourceRevision ||
    result.model_revision !== authority.modelRevision ||
    result.renderer_source_profile !== "mage-landscape-native-1280x720-v1" ||
    result.seed !== authority.seed ||
    result.width !== authority.width ||
    result.height !== authority.height
  ) {
    throw new MageResultError("MAGE_LINEAGE_MISMATCH");
  }
  duration(result.generation_duration_ms);
  const output = decodePng(result.output_base64, result.output_sha256, result.bytes);
  const runtime = validateRuntime(result.runtime_evidence, authority);
  return Object.freeze({
    output,
    evidence: Object.freeze({
      schema_version: result.schema_version,
      attempt_id: result.attempt_id,
      scene_id: result.scene_id,
      output_sha256: result.output_sha256,
      bytes: result.bytes,
      width: result.width,
      height: result.height,
      seed: result.seed,
      positive_prompt_sha256: result.positive_prompt_sha256,
      negative_prompt_sha256: result.negative_prompt_sha256,
      source_revision: result.source_revision,
      model_revision: result.model_revision,
      renderer_source_profile: result.renderer_source_profile,
      generation_duration_ms: result.generation_duration_ms,
      runtime_evidence: runtime,
      reported_cost_usd: reportedCostUsd,
    }),
  });
};

export const safeMageFailureCode = (value: unknown): string | null => {
  const envelope =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  return envelope?.ok === false &&
    typeof envelope.error_code === "string" &&
    /^MAGE_[A-Z0-9_]{1,96}$/u.test(envelope.error_code)
    ? envelope.error_code
    : null;
};

import { createHash, createHmac, randomBytes } from "node:crypto";
import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { canonicalizeJson } from "@videoforge/contracts";

import {
  RunPodControlError,
  RunPodControlClient,
  type RunPodJobResult,
  type RunPodV207Placement,
  type RunPodV207EndpointReadbackMismatchCategory,
  V207_RUNPOD_EXECUTION_TIMEOUT_MS,
  V207_RUNPOD_GPU,
  V207_RUNPOD_INIT_TIMEOUT_SECONDS,
  V207_RUNPOD_MIN_CUDA_VERSION,
  V207_RUNPOD_MODEL_ROOT,
  V207_RUNPOD_REQUEST_AUTHORITY_TTL_SECONDS,
  V207_RUNPOD_REGION,
  V207_RUNPOD_VOLUME_MOUNT,
} from "./runpod-control";
import {
  RunPodV207QualificationHarness,
  buildV207PlanManifest,
  hashV207PlanManifest,
  type RunPodV207AcceptedUnitRecord,
  type RunPodV207DispatchBatchInput,
  type RunPodV207OutputAuthority,
  type RunPodV207WorkerProcessIdentity,
} from "./runpod-v207-qualification-harness";
import {
  reconcileV207Readonly,
  reconcileV207SuccessReadonly,
  v207IncrementalSpendFromBilling,
  v207IncrementalSpendThreshold,
} from "./runpod-v207-readonly-reconciliation";
import { loadSujalRunPodApiKeyFromKeychain, SUJAL_RUNPOD_ACCOUNT_ID_SHA256 } from "./keychain";
import { assertSujalRunPodAccount } from "./runpod-account";
import {
  parseV207ActivationAuthority,
  V207_REPAIRED_IMAGE,
  V207_REPAIRED_IMAGE_BASE_DIGEST,
  V207_REPAIRED_IMAGE_CONFIG_DIGEST,
  V207_REPAIRED_IMAGE_LAYER_DIGEST,
  V207_REPAIRED_IMAGE_SOURCE_COMMIT,
} from "./v207-activation-authority";
import { fetchCp07Catalog, type Cp07GpuCandidate } from "./runpod-echo-cp07-preflight";
const MANIFEST = "sha256:cebcd5c6233c2eae32f26ced7510acef8192f0d92d7ec3e9dd3ee881d66d205b";
const VOLUME = "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619";
const SOULX_VOLUME = "sha256:2a8633e14bbecab54f52e2ae7b5b06bfa562b09a6ac781fe0985eb28e70587be";
const VOLUME_ID = "c7kg89brtj";
const ACCOUNT = "account-a";
const WORKSPACE = "workspace-a";
const PROJECT = "project-a";
const REVISION = "revision-a";
const MODEL_REVISION = "d8c99241f6fa80fbd453014234af2bf337ea21e6";
const OUTPUT_LIMIT = 4 * 1024 * 1024;
const QUALIFICATION_SCENES = [
  "A documentary photograph of a small mixed farm at sunrise, wide environmental context",
  "Close documentary photograph of weathered hands testing dark soil in a field",
  "A farmer planting vegetable seeds in straight rows, natural morning light",
  "Drip irrigation watering young green crops, realistic agricultural detail",
  "A woman farmer inspecting healthy leaves for pests, candid documentary framing",
  "A compact tractor moving slowly between crop rows, rural landscape behind it",
  "Two farm workers harvesting ripe red apples into wooden crates",
  "Macro documentary photograph of a fresh red apple with natural skin texture",
  "Harvested vegetables being washed with clean water at a farm packing table",
  "Hands sorting tomatoes by ripeness into reusable plain crates",
  "A refrigerated farm truck being loaded at a rural distribution shed",
  "Wide photograph of a wholesale produce market opening before dawn",
  "A market vendor arranging colorful fresh produce at a simple stall",
  "A parent and child choosing fresh vegetables at a neighborhood market",
  "Reusable grocery bags filled with unbranded fruit and vegetables on a kitchen counter",
  "Hands rinsing leafy greens in a bright home kitchen sink",
  "Close photograph of a cook safely chopping carrots on a wooden board",
  "Vegetables simmering in a plain metal pan, realistic steam and texture",
  "A family sharing a home-cooked vegetable meal at a modest dining table",
  "Kitchen scraps being collected in a small countertop compost container",
  "A gardener turning mature compost into raised garden soil",
  "Inside a working greenhouse with rows of plants and diffused daylight",
  "A honeybee pollinating a white orchard blossom, sharp macro evidence",
  "A field technician checking a simple weather sensor beside crops",
  "Farmers sheltering harvested crates from a sudden rain shower",
  "Wide dry field showing the practical effect of drought on crops",
  "A community water tank supplying irrigation lines to small farms",
  "Historical documentary-style scene of farmers using hand tools in the 1940s, no signage",
  "Modern agricultural researchers examining plant samples in a clean laboratory",
  "A split-safe portrait of a farmer standing on the left beside an open field",
  "Aerial documentary view of patchwork farms connected to a nearby town",
  "Fresh produce served on a plain table beside a window, quiet closing image",
] as const;
const ROUTE =
  "https://videoforge-v2-06-staging.lakshmansai121.workers.dev/api/v2/v207/generated-output-port";
const RESULT_PATH = "/tmp/videoforge-v207-live-result.json";
const V207_JOB_SCRATCH_ROOT = "/tmp/videoforge-jobs" as const;
const V207_TEMPLATE_NAME = "videoforge_mage_v207_20260820" as const;
const V207_ENDPOINT_NAME = "videoforge_mage_v207_20260820" as const;
const BILLING_START = "2026-08-20T00:00:00.000Z";
const IMAGE_CONFIG_DIGEST = V207_REPAIRED_IMAGE_CONFIG_DIGEST;
const IMAGE_LAYER_DIGEST = V207_REPAIRED_IMAGE_LAYER_DIGEST;
const IMAGE_BASE_DIGEST = V207_REPAIRED_IMAGE_BASE_DIGEST;
/** The pinned RunPod Serverless Flex rate used by the V2-07 proposal. */
export const V207_SERVERLESS_FLEX_RATE_USD_PER_GPU_HOUR = 1.1 as const;
/** The secure RTX 4090 catalog reference rate used by the V2-07 preflight. */
export const V207_SECURE_REFERENCE_RATE_USD_PER_HOUR = 0.74 as const;
let IMAGE: string = V207_REPAIRED_IMAGE;
let finiteCapUsd = 0;

type AnyRecord = Record<string, any>;

const V207_RESUME_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const validateV207ResumeUrl = (value: string): void => {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("V207_RESUME_READBACK_URL_INVALID");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    [...value].some((character) => character.charCodeAt(0) < 32)
  ) {
    throw new Error("V207_RESUME_READBACK_URL_INVALID");
  }
};

const hashText = (value: string): string =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const sortedJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(sortedJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${sortedJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

const SAFE_PROVIDER_CODE = /^[A-Z][A-Z0-9_.:-]{2,160}$/u;
const V207_PROVIDER_ERROR_MAX_BYTES = 4 * 1024;
const V207_ENDPOINT_READBACK_MISMATCH_CATEGORIES: ReadonlySet<string> = new Set([
  "identity",
  "environment",
  "flashboot",
  "region",
  "cuda",
  "volume",
  "gpu",
  "workers",
  "timing",
  "scaler",
]);
const V207_SAFE_ERROR_CATEGORIES: ReadonlySet<string> = new Set([
  ...V207_ENDPOINT_READBACK_MISMATCH_CATEGORIES,
  "output_contract",
]);
const V207_OUTPUT_DIAGNOSTIC_CODE = /^[A-Z][A-Z0-9_]{2,63}$/u;
const V207_OUTPUT_DIAGNOSTIC_BRAND = "videoforge.v207.output-contract-diagnostic/v1" as const;
const V207_OUTPUT_PORT_FINALIZE_FAILURE_CATEGORIES = new Set([
  "transport",
  "json_parse",
  "non_object",
  "http_error",
] as const);
const V207_OUTPUT_PORT_FINALIZE_ERROR_CODES: ReadonlySet<string> = new Set([
  "V207_AUTHORITY_REJECTED",
  "V207_DELETE_UNAVAILABLE",
  "V207_DELETE_UNCONFIRMED",
  "V207_DELETE_VERIFY_FAILED",
  "V207_OUTPUT_FACTS_MISMATCH",
  "V207_OUTPUT_KEY_INVALID",
  "V207_OUTPUT_NOT_FOUND",
  "V207_OUTPUT_PNG_PROBE_FAILED",
  "V207_PORT_SIGNING_FAILED",
  "V207_PROVENANCE_KEY_INVALID",
  "V207_PROVENANCE_RECORD_INVALID",
  "V207_RECEIPT_CONFLICT",
  "V207_REQUEST_INVALID",
  "V207_RESERVATION_AUTHORITY_REJECTED",
  "V207_RESERVATION_CONFLICT",
  "V207_RESERVATION_EXPIRED",
  "V207_RESERVATION_NOT_FOUND",
  "V207_RESERVATION_UNAVAILABLE",
  "V207_ROLLBACK_AUTHORITY_REJECTED",
  "V207_ROUTE_DISABLED",
]);
const V207_OUTPUT_PORT_CONTENT_TYPE_CATEGORIES = new Set([
  "json",
  "text",
  "other",
  "missing",
  "invalid",
] as const);
const V207_OUTPUT_PORT_CONTENT_TYPE_VALUE = /^[a-z0-9!#$&^_.+-]{1,63}\/[a-z0-9!#$&^_.+-]{1,63}$/u;
type V207OutputPortFinalizeFailureCategory =
  | "transport"
  | "json_parse"
  | "non_object"
  | "http_error";
type V207OutputPortContentTypeCategory = "json" | "text" | "other" | "missing" | "invalid";

/**
 * The FINALIZE response diagnostic is deliberately a small metadata tuple.  It must never carry
 * the response body, URL, provider identifiers, nonce, or arbitrary headers into evidence.
 */
export interface V207OutputPortFinalizeResponseDiagnostic {
  readonly attempt_number: number;
  readonly http_status: number | null;
  readonly content_type_category: V207OutputPortContentTypeCategory;
  readonly content_type_value: string | null;
  readonly body_byte_length: number;
  readonly failure_category: V207OutputPortFinalizeFailureCategory;
  readonly error_code?: string | null;
}

const sanitizeV207OutputPortContentType = (
  value: string | null,
): Pick<
  V207OutputPortFinalizeResponseDiagnostic,
  "content_type_category" | "content_type_value"
> => {
  if (value === null || value.trim() === "") {
    return { content_type_category: "missing", content_type_value: null };
  }
  // Parameters are not evidence.  Keep only a lower-case media type and reject anything that
  // cannot be represented by the bounded MIME token grammar.
  const mediaType = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (!V207_OUTPUT_PORT_CONTENT_TYPE_VALUE.test(mediaType)) {
    return { content_type_category: "invalid", content_type_value: null };
  }
  const category =
    mediaType === "application/json" || mediaType.endsWith("+json")
      ? "json"
      : mediaType.startsWith("text/")
        ? "text"
        : "other";
  return { content_type_category: category, content_type_value: mediaType };
};

const makeV207OutputPortFinalizeResponseDiagnostic = (
  attemptNumber: number,
  response: Response | null,
  failureCategory: V207OutputPortFinalizeFailureCategory,
  bodyByteLength = 0,
  errorCode?: string | null,
): V207OutputPortFinalizeResponseDiagnostic => {
  const contentType = sanitizeV207OutputPortContentType(
    response?.headers?.get("content-type") ?? null,
  );
  const diagnostic = {
    attempt_number: Number.isSafeInteger(attemptNumber) && attemptNumber > 0 ? attemptNumber : 1,
    http_status:
      response &&
      Number.isInteger(response.status) &&
      response.status >= 100 &&
      response.status <= 599
        ? response.status
        : null,
    ...contentType,
    body_byte_length:
      Number.isSafeInteger(bodyByteLength) && bodyByteLength >= 0 ? bodyByteLength : 0,
    failure_category: failureCategory,
  };
  return errorCode === undefined ? diagnostic : { ...diagnostic, error_code: errorCode };
};

const boundedV207OutputPortFinalizeErrorCode = (value: unknown): string | null => {
  if (
    typeof value === "string" &&
    V207_OUTPUT_DIAGNOSTIC_CODE.test(value) &&
    V207_OUTPUT_PORT_FINALIZE_ERROR_CODES.has(value)
  ) {
    return value;
  }
  return null;
};

const extractV207OutputPortFinalizeErrorCode = (value: unknown): string | null => {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value : null;
  const error =
    record && "error" in record && record.error && typeof record.error === "object"
      ? record.error
      : null;
  const code = error && !Array.isArray(error) && "code" in error ? error.code : null;
  return boundedV207OutputPortFinalizeErrorCode(code);
};

/** Normalize an in-process diagnostic before it can cross into persisted evidence. */
export function normalizeV207OutputPortFinalizeResponseDiagnostic(
  value: unknown,
): V207OutputPortFinalizeResponseDiagnostic | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as AnyRecord;
  const attemptNumber = candidate.attempt_number;
  const httpStatus = candidate.http_status;
  const bodyByteLength = candidate.body_byte_length;
  const failureCategory = candidate.failure_category;
  const contentTypeCategory = candidate.content_type_category;
  const contentTypeValue = candidate.content_type_value;
  const hasErrorCode = Object.prototype.hasOwnProperty.call(candidate, "error_code");
  const errorCode = candidate.error_code;
  if (
    !Number.isSafeInteger(attemptNumber) ||
    attemptNumber < 1 ||
    !(
      httpStatus === null ||
      (Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599)
    ) ||
    !Number.isSafeInteger(bodyByteLength) ||
    bodyByteLength < 0 ||
    typeof failureCategory !== "string" ||
    !V207_OUTPUT_PORT_FINALIZE_FAILURE_CATEGORIES.has(failureCategory as never) ||
    typeof contentTypeCategory !== "string" ||
    !V207_OUTPUT_PORT_CONTENT_TYPE_CATEGORIES.has(contentTypeCategory as never) ||
    !(
      contentTypeValue === null ||
      (typeof contentTypeValue === "string" &&
        V207_OUTPUT_PORT_CONTENT_TYPE_VALUE.test(contentTypeValue))
    ) ||
    (failureCategory === "http_error" &&
      (!hasErrorCode ||
        !(
          errorCode === null || boundedV207OutputPortFinalizeErrorCode(errorCode) === errorCode
        ))) ||
    (failureCategory !== "http_error" && hasErrorCode)
  ) {
    return null;
  }
  const normalizedContentType = sanitizeV207OutputPortContentType(contentTypeValue);
  if (
    normalizedContentType.content_type_category !== contentTypeCategory ||
    normalizedContentType.content_type_value !== contentTypeValue
  ) {
    return null;
  }
  const normalized = {
    attempt_number: attemptNumber,
    http_status: httpStatus,
    ...normalizedContentType,
    body_byte_length: bodyByteLength,
    failure_category: failureCategory as V207OutputPortFinalizeFailureCategory,
  };
  return hasErrorCode ? { ...normalized, error_code: errorCode as string | null } : normalized;
}

class V207OutputPortFinalizeResponseError extends Error {
  readonly code = V207_OUTPUT_PORT_FINALIZE_RESPONSE_ERROR;
  readonly diagnostic: V207OutputPortFinalizeResponseDiagnostic;

  constructor(diagnostic: V207OutputPortFinalizeResponseDiagnostic) {
    super(V207_OUTPUT_PORT_FINALIZE_RESPONSE_ERROR);
    this.name = "V207OutputPortFinalizeResponseError";
    this.diagnostic = diagnostic;
  }
}

class V207OutputPortFinalizeTransportError extends Error {
  readonly code = V207_OUTPUT_PORT_FINALIZE_TRANSPORT_ERROR;
  readonly diagnostic: V207OutputPortFinalizeResponseDiagnostic;

  constructor(diagnostic: V207OutputPortFinalizeResponseDiagnostic) {
    super(V207_OUTPUT_PORT_FINALIZE_TRANSPORT_ERROR);
    this.name = "V207OutputPortFinalizeTransportError";
    this.diagnostic = diagnostic;
  }
}
const V207_OUTPUT_FAILURE_STAGES = [
  "top_level",
  "item_count",
  "authority_count",
  "receipt_presence",
  "receipt_hash",
  "receipt_signature",
  "receipt_identity",
  "output_lineage",
  "output_readback",
  "output_png_probe",
  "output_finalization",
  "output_finalization_replay",
  "output_resume_readback",
  "unknown",
] as const;
type V207OutputFailureStage = (typeof V207_OUTPUT_FAILURE_STAGES)[number];
const V207_OUTPUT_FAILURE_STAGE_SET: ReadonlySet<string> = new Set(V207_OUTPUT_FAILURE_STAGES);
const V207_OUTPUT_SHAPE_KINDS: ReadonlySet<string> = new Set([
  "missing",
  "null",
  "array",
  "string",
  "number",
  "boolean",
  "object",
]);
const V207_OUTPUT_SHAPE_KEYS: ReadonlySet<string> = new Set([
  "status",
  "items",
  "failure_code",
  "error",
  "provenance_receipt",
]);

export class V207QualificationCancelled extends Error {
  readonly code = "V207_QUALIFICATION_CANCELLED" as const;

  constructor() {
    super("V207_QUALIFICATION_CANCELLED");
    this.name = "V207QualificationCancelled";
  }
}

export interface V207Cancellation {
  readonly requested: boolean;
  request(): void;
  throwIfRequested(): void;
}

/**
 * Keep signal handling synchronous and side-effect free.  The main qualification loop observes
 * this state at bounded phase/status boundaries, then enters its existing rollback path.
 */
export function createV207Cancellation(): V207Cancellation {
  let requested = false;
  return {
    get requested() {
      return requested;
    },
    request(): void {
      requested = true;
    },
    throwIfRequested(): void {
      if (requested) throw new V207QualificationCancelled();
    },
  };
}

type SignalTarget = Pick<NodeJS.Process, "on" | "off">;

/** Install removable handlers so SIGINT/SIGTERM cannot bypass catch/finally cleanup. */
export function installV207SignalHandlers(
  cancellation: V207Cancellation,
  target: SignalTarget = process,
): () => void {
  const signals: readonly NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
  const handlers = new Map<NodeJS.Signals, () => void>();
  for (const signal of signals) {
    const handler = (): void => {
      cancellation.request();
      console.error("v207:cancellation-requested");
    };
    handlers.set(signal, handler);
    target.on(signal, handler);
  }
  return (): void => {
    for (const signal of signals) {
      const handler = handlers.get(signal);
      if (handler) target.off(signal, handler);
    }
  };
}

const SAFE_EVIDENCE_KEYS = new Set([
  "schema_version",
  "phase",
  "event",
  "kind",
  "status",
  "result",
  "code",
  "error_category",
  "output_failure_stage",
  "output_status",
  "output_failure_code",
  "output_shape_kind",
  "output_shape_keys",
  "source_commit",
  "base_digest",
  "manifest_digest",
  "config_digest",
  "image_digest",
  "imageDigest",
  "model_revision",
  "comfyui_revision",
  "precision",
  "region",
  "volume_mount",
  "volume_write_policy",
  "attestation_scope",
  "billing_settlement",
  "generated_output_rollback",
  "cancel_status",
  "cancel_output_cleanup",
  "timeout_status",
  "timeout_output_cleanup",
  "finalize_response_diagnostic",
  "timing_provenance",
  "provider_timing_source",
  "worker_timing_source",
  "process_start_boundary",
  "container_ready_boundary",
  "signed_envelope_issued_at",
  "provider_delay_time_ms",
  "provider_execution_time_ms",
]);

/**
 * Persist only bounded qualification facts.  Unknown strings are removed rather than relying on
 * every future provider/error shape to remember the secret/URL/raw-ID rules.
 */
export function redactV207LiveEvidence(value: unknown): AnyRecord {
  const visit = (candidate: unknown, key: string | null, depth: number): unknown => {
    if (depth > 10) return "[REDACTED_DEPTH]";
    if (typeof candidate === "string") {
      if (/^https?:\/\//u.test(candidate)) return "[REDACTED_URL]";
      const hashKey = key !== null && /(?:hash|hashes|sha256|digest|digests)$/iu.test(key);
      if (hashKey) {
        return /^sha256:[a-f0-9]{64}$/u.test(candidate) ? candidate : "[REDACTED]";
      }
      if (
        key !== null &&
        /_at$/iu.test(key) &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(candidate)
      ) {
        return candidate;
      }
      if (key === "os" && /^(?:linux|windows|darwin)$/iu.test(candidate)) return candidate;
      if (key === "architecture" && /^(?:amd64|arm64|x86_64)$/iu.test(candidate)) {
        return candidate;
      }
      if (key !== null && /(?:region|regions)$/iu.test(key) && candidate === V207_RUNPOD_REGION) {
        return candidate;
      }
      if (
        key !== null &&
        (/(?:api[_-]?key|authorization|password|secret|cookie|capability|nonce|token)/iu.test(
          key,
        ) ||
          /(?:^|_)(?:url|uri|id|reservation_id|job_id|endpoint_id|template_id|volume_id)$/iu.test(
            key,
          ) ||
          /id$/iu.test(key))
      ) {
        return "[REDACTED]";
      }
      if (key === "run_tag")
        return /^202[0-9]{5}-[a-f0-9]{12}$/u.test(candidate) ? candidate : "[REDACTED]";
      if (key === "output_failure_stage") {
        return V207_OUTPUT_FAILURE_STAGE_SET.has(candidate) ? candidate : "[REDACTED]";
      }
      if (key === "output_status" || key === "output_failure_code") {
        return V207_OUTPUT_DIAGNOSTIC_CODE.test(candidate) ? candidate : "[REDACTED]";
      }
      if (key === "output_shape_kind" && V207_OUTPUT_SHAPE_KINDS.has(candidate)) {
        return candidate;
      }
      if (key === "output_shape_keys" && V207_OUTPUT_SHAPE_KEYS.has(candidate)) {
        return candidate;
      }
      if (key !== null && SAFE_EVIDENCE_KEYS.has(key)) {
        if (key === "error_category") {
          return V207_SAFE_ERROR_CATEGORIES.has(candidate) ? candidate : "[REDACTED]";
        }
        if (/^[0-9a-f]{40}$/u.test(candidate) || SAFE_PROVIDER_CODE.test(candidate)) {
          return candidate;
        }
        if (/^(?:[A-Za-z0-9._/-]{1,120})$/u.test(candidate)) return candidate;
      }
      return SAFE_PROVIDER_CODE.test(candidate) ? candidate : "[REDACTED]";
    }
    if (typeof candidate === "number" || typeof candidate === "boolean" || candidate === null) {
      return candidate;
    }
    if (key === "finalize_response_diagnostic") {
      return normalizeV207OutputPortFinalizeResponseDiagnostic(candidate) ?? "[REDACTED]";
    }
    if (Array.isArray(candidate)) return candidate.map((entry) => visit(entry, key, depth + 1));
    if (candidate && typeof candidate === "object") {
      const output: AnyRecord = {};
      for (const [entryKey, entry] of Object.entries(candidate as AnyRecord)) {
        output[entryKey] = visit(entry, entryKey, depth + 1);
      }
      return output;
    }
    return "[REDACTED]";
  };
  const result = visit(value, null, 0);
  return (
    result && typeof result === "object" && !Array.isArray(result) ? result : { value: result }
  ) as AnyRecord;
}

/**
 * Extract only the bounded endpoint-readback mismatch family from an in-process control error.
 * Never inspect or retain provider response fields here; invalid or unrelated categories vanish.
 */
export function extractV207EndpointReadbackMismatchCategory(
  error: unknown,
): RunPodV207EndpointReadbackMismatchCategory | null {
  if (!(error instanceof RunPodControlError)) return null;
  const category = error.category;
  return typeof category === "string" && V207_ENDPOINT_READBACK_MISMATCH_CATEGORIES.has(category)
    ? (category as RunPodV207EndpointReadbackMismatchCategory)
    : null;
}

/**
 * Preserve the provider's bounded root job error for a failed qualification without allowing
 * stream text, URLs, identifiers, or unexpectedly large provider payloads into diagnostics.
 */
export function redactV207ProviderJobError(error: unknown): AnyRecord {
  if (error === undefined) return {};
  const redacted = redactV207LiveEvidence({ provider_error: error });
  const providerError = redacted.provider_error;
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(providerError);
  } catch {
    return { provider_error: "[REDACTED]" };
  }
  if (
    typeof serialized !== "string" ||
    Buffer.byteLength(serialized, "utf8") > V207_PROVIDER_ERROR_MAX_BYTES
  ) {
    return { provider_error: "[REDACTED_SIZE]" };
  }
  return { provider_error: providerError };
}

type V207OutputShapeKind =
  | "missing"
  | "null"
  | "array"
  | "string"
  | "number"
  | "boolean"
  | "object";

interface V207OutputShape {
  readonly kind: V207OutputShapeKind;
  readonly keys: readonly string[];
}

const safeV207OutputDiagnosticCode = (value: unknown, fallback: string): string =>
  typeof value === "string" && V207_OUTPUT_DIAGNOSTIC_CODE.test(value) ? value : fallback;

const describeV207OutputShape = (output: unknown): V207OutputShape => {
  if (output === undefined) return { kind: "missing", keys: [] };
  if (output === null) return { kind: "null", keys: [] };
  if (Array.isArray(output)) return { kind: "array", keys: [] };
  if (typeof output !== "object") {
    return { kind: typeof output as V207OutputShapeKind, keys: [] };
  }
  return {
    kind: "object",
    keys: Object.keys(output as AnyRecord)
      .filter((key) => V207_OUTPUT_SHAPE_KEYS.has(key))
      .sort()
      .slice(0, 8),
  };
};

const normalizeV207OutputShape = (outputShape: unknown): V207OutputShape => {
  const shape = outputShape as AnyRecord;
  const kind = shape?.kind;
  const keys = Array.isArray(shape?.keys)
    ? [...new Set(shape.keys.map(String).filter((key) => V207_OUTPUT_SHAPE_KEYS.has(key)))]
        .sort()
        .slice(0, 8)
    : [];
  return {
    kind: V207_OUTPUT_SHAPE_KINDS.has(String(kind)) ? (kind as V207OutputShapeKind) : "missing",
    keys,
  };
};

const safeV207OutputFailureStage = (
  value: unknown,
  fallback: V207OutputFailureStage,
): V207OutputFailureStage =>
  typeof value === "string" && V207_OUTPUT_FAILURE_STAGE_SET.has(value)
    ? (value as V207OutputFailureStage)
    : fallback;

type V207OutputContractDiagnosticLike = {
  readonly diagnosticBrand: typeof V207_OUTPUT_DIAGNOSTIC_BRAND;
  readonly code: "MAGE_OUTPUT_NOT_SUCCEEDED";
  readonly outputStatus?: unknown;
  readonly failureCode?: unknown;
  readonly failureStage?: unknown;
  readonly outputShape?: unknown;
  readonly finalizeResponseDiagnostic?: unknown;
};

/**
 * Structural brand keeps diagnostics extractable across tsx/bundle/error-realm boundaries.  Only
 * the brand and stable code are trusted; every other field is normalized again before persistence.
 */
const isV207OutputContractDiagnostic = (
  error: unknown,
): error is V207OutputContractDiagnosticLike => {
  if (!error || typeof error !== "object") return false;
  const candidate = error as AnyRecord;
  return (
    candidate.diagnosticBrand === V207_OUTPUT_DIAGNOSTIC_BRAND &&
    candidate.code === "MAGE_OUTPUT_NOT_SUCCEEDED"
  );
};

/**
 * Carries only bounded output-contract facts across the qualification failure path.  The error
 * message is intentionally stable; status, stage, failure code, and shape keys are persisted
 * separately after strict validation so a provider body or secret can never become the message.
 */
export class V207OutputContractError extends Error {
  readonly code = "MAGE_OUTPUT_NOT_SUCCEEDED" as const;
  readonly diagnosticBrand = V207_OUTPUT_DIAGNOSTIC_BRAND;
  readonly outputStatus: string;
  readonly failureCode: string;
  readonly failureStage: V207OutputFailureStage;
  readonly outputShape: V207OutputShape;
  readonly finalizeResponseDiagnostic: V207OutputPortFinalizeResponseDiagnostic | null;

  constructor(
    outputStatus: unknown,
    failureCode: unknown,
    outputShape: unknown,
    failureStage: unknown = "top_level",
    finalizeResponseDiagnostic: unknown = null,
  ) {
    super("MAGE_OUTPUT_NOT_SUCCEEDED");
    this.name = "V207OutputContractError";
    this.outputStatus = safeV207OutputDiagnosticCode(outputStatus, "MISSING");
    this.failureCode = safeV207OutputDiagnosticCode(failureCode, "UNKNOWN");
    this.failureStage = safeV207OutputFailureStage(failureStage, "unknown");
    this.outputShape = normalizeV207OutputShape(outputShape);
    this.finalizeResponseDiagnostic = normalizeV207OutputPortFinalizeResponseDiagnostic(
      finalizeResponseDiagnostic,
    );
  }
}

export function extractV207OutputContractDiagnostics(error: unknown): AnyRecord | null {
  if (!isV207OutputContractDiagnostic(error)) return null;
  const outputShape = normalizeV207OutputShape(error.outputShape);
  const diagnostic: AnyRecord = {
    error: "MAGE_OUTPUT_NOT_SUCCEEDED",
    error_category: "output_contract",
    output_failure_stage: safeV207OutputFailureStage(error.failureStage, "unknown"),
    output_status: safeV207OutputDiagnosticCode(error.outputStatus, "MISSING"),
    output_failure_code: safeV207OutputDiagnosticCode(error.failureCode, "UNKNOWN"),
    output_shape_kind: outputShape.kind,
    output_shape_keys: [...outputShape.keys],
  };
  const finalizeResponseDiagnostic = normalizeV207OutputPortFinalizeResponseDiagnostic(
    error.finalizeResponseDiagnostic,
  );
  if (finalizeResponseDiagnostic) {
    diagnostic.finalize_response_diagnostic = finalizeResponseDiagnostic;
  }
  return diagnostic;
}

const boundedV207FailureCode = (error: unknown): string => {
  const candidate =
    error instanceof RunPodControlError ? error.code : error instanceof Error ? error.message : "";
  return safeV207OutputDiagnosticCode(candidate, "UNKNOWN");
};

const findV207ProviderErrorCode = (value: unknown, depth = 0): string | null => {
  if (depth > 5) return null;
  if (typeof value === "string") return SAFE_PROVIDER_CODE.test(value) ? value : null;
  if (Array.isArray(value)) {
    for (const entry of value.slice(0, 32)) {
      const code = findV207ProviderErrorCode(entry, depth + 1);
      if (code) return code;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as AnyRecord;
  for (const key of ["code", "error_code", "errorCode", "failure_code"]) {
    const code = findV207ProviderErrorCode(record[key], depth + 1);
    if (code) return code;
  }
  for (const entry of Object.values(record).slice(0, 32)) {
    const code = findV207ProviderErrorCode(entry, depth + 1);
    if (code) return code;
  }
  return null;
};

/** Prefer a bounded root `/status` error, then fall back to a handler output error code. */
export function extractV207ProviderJobErrorCode(jobError: unknown, output: unknown): string | null {
  return findV207ProviderErrorCode(jobError) ?? findV207ProviderErrorCode(output);
}

const RESULT_TEMP_PATH = `${RESULT_PATH}.tmp`;
const V207_OUTPUT_PORT_REQUEST_TIMEOUT_MS = 15_000;
const V207_OUTPUT_PORT_FINALIZE_TIMEOUT_MS = 30_000;
// Hosted output-port GET authorities reject lifetimes above 900 seconds. Keep the
// process-replacement resume readback within that route contract.
const V207_OUTPUT_PORT_GET_MAX_LIFETIME_SECONDS = 900;
// Attempt33 observed a valid completed reader payload followed by a short Cloudflare 503 HTML
// burst on the idempotent FINALIZE callback. Keep retries exclusive to FINALIZE, but give that
// reservation/callback replay enough bounded backoff to outlive the transient edge failure.
const V207_OUTPUT_PORT_FINALIZE_MAX_ATTEMPTS = 6;
const V207_OUTPUT_PORT_FINALIZE_RETRY_DELAY_MS = 1_000;
const V207_OUTPUT_PORT_FINALIZE_TRANSPORT_ERROR = "V207_OUTPUT_PORT_FINALIZE_TRANSPORT" as const;
const V207_OUTPUT_PORT_FINALIZE_RESPONSE_ERROR =
  "V207_OUTPUT_PORT_FINALIZE_RESPONSE_INVALID" as const;

export interface V207OutputPortTestOptions {
  readonly fetchImpl?: typeof fetch;
  readonly sleepImpl?: (milliseconds: number) => Promise<void>;
}

async function writeV207EvidenceCheckpoint(value: AnyRecord): Promise<void> {
  const redacted = redactV207LiveEvidence(value);
  try {
    await writeFile(RESULT_TEMP_PATH, JSON.stringify(redacted, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
    await chmod(RESULT_TEMP_PATH, 0o600);
    await rename(RESULT_TEMP_PATH, RESULT_PATH);
    await chmod(RESULT_PATH, 0o600);
  } catch {
    throw new Error("V207_EVIDENCE_CHECKPOINT_WRITE_FAILED");
  }
}

const nowIso = (): string => new Date().toISOString();
const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function routePort(
  body: AnyRecord,
  nonce: string,
  options: V207OutputPortTestOptions = {},
): Promise<AnyRecord> {
  // FINALIZE is the only retryable POST here: the reservation/callback tuple makes it
  // idempotent, so a client timeout after the server committed can safely reconcile by replay.
  const isFinalize = body.operation === "FINALIZE";
  const maxAttempts = isFinalize ? V207_OUTPUT_PORT_FINALIZE_MAX_ATTEMPTS : 3;
  const requestTimeoutMs = isFinalize
    ? V207_OUTPUT_PORT_FINALIZE_TIMEOUT_MS
    : V207_OUTPUT_PORT_REQUEST_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleepImpl = options.sleepImpl ?? sleep;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let response: Response;
    try {
      response = await fetchImpl(ROUTE, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          connection: "close",
          "x-videoforge-v207-authority": nonce,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
    } catch (error) {
      if (!isFinalize || attempt === maxAttempts - 1) {
        if (isFinalize) {
          throw new V207OutputPortFinalizeTransportError(
            makeV207OutputPortFinalizeResponseDiagnostic(attempt + 1, null, "transport"),
          );
        }
        throw error;
      }
      await sleepImpl(V207_OUTPUT_PORT_FINALIZE_RETRY_DELAY_MS * (attempt + 1));
      continue;
    }

    let value: AnyRecord;
    let responseBodyByteLength = 0;
    if (isFinalize) {
      let diagnostic: V207OutputPortFinalizeResponseDiagnostic;
      try {
        const body = await response.arrayBuffer();
        const bodyByteLength = body.byteLength;
        responseBodyByteLength = bodyByteLength;
        let parsed: unknown;
        try {
          parsed = JSON.parse(new TextDecoder().decode(body));
        } catch {
          diagnostic = makeV207OutputPortFinalizeResponseDiagnostic(
            attempt + 1,
            response,
            "json_parse",
            bodyByteLength,
          );
          throw new V207OutputPortFinalizeResponseError(diagnostic);
        }
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          diagnostic = makeV207OutputPortFinalizeResponseDiagnostic(
            attempt + 1,
            response,
            "non_object",
            bodyByteLength,
          );
          throw new V207OutputPortFinalizeResponseError(diagnostic);
        }
        value = parsed as AnyRecord;
      } catch (error) {
        if (error instanceof V207OutputPortFinalizeResponseError) {
          diagnostic = error.diagnostic;
        } else {
          diagnostic = makeV207OutputPortFinalizeResponseDiagnostic(
            attempt + 1,
            response,
            "transport",
          );
        }
        if (attempt === maxAttempts - 1) {
          if (error instanceof V207OutputPortFinalizeResponseError) throw error;
          throw new V207OutputPortFinalizeTransportError(diagnostic);
        }
        await sleepImpl(V207_OUTPUT_PORT_FINALIZE_RETRY_DELAY_MS * (attempt + 1));
        continue;
      }
    } else {
      const parsed: unknown = await response.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("V207_OUTPUT_PORT_RESPONSE_INVALID");
      }
      value = parsed as AnyRecord;
    }

    const signedPort = typeof value.url === "string" && /^https:\/\//u.test(value.url);
    const finalized =
      isFinalize && value.schema_version === "videoforge-v207-generated-output-finalization/v1";
    if (response.ok && (signedPort || finalized)) return value;
    if (isFinalize && response.status !== 503) {
      throw new V207OutputPortFinalizeResponseError(
        makeV207OutputPortFinalizeResponseDiagnostic(
          attempt + 1,
          response,
          "http_error",
          responseBodyByteLength,
          extractV207OutputPortFinalizeErrorCode(value),
        ),
      );
    }
    if (response.status !== 503 || attempt === maxAttempts - 1) {
      throw new Error(`V207_OUTPUT_PORT_${response.status}`);
    }
    await sleepImpl(V207_OUTPUT_PORT_FINALIZE_RETRY_DELAY_MS * (attempt + 1));
  }
  throw new Error("V207_OUTPUT_PORT_UNREACHABLE");
}

async function deleteGeneratedObject(objectKey: string, nonce: string): Promise<void> {
  const response = await fetch(ROUTE, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      connection: "close",
      "x-videoforge-v207-authority": nonce,
    },
    body: JSON.stringify({
      schema_version: "videoforge-v207-generated-output-port-request/v1",
      operation: "DELETE",
      account_id: ACCOUNT,
      workspace_id: WORKSPACE,
      object_key: objectKey,
      rollback_token: createHmac("sha256", nonce).update(objectKey).digest("hex"),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`V207_OUTPUT_DELETE_${response.status}`);
  const value = (await response.json()) as AnyRecord;
  if (
    value.schema_version !== "videoforge-v207-generated-output-delete/v1" ||
    value.deleted !== true
  ) {
    throw new Error("V207_OUTPUT_DELETE_UNCONFIRMED");
  }
}

async function deleteGeneratedObjects(objectKeys: readonly string[], nonce: string): Promise<void> {
  for (const objectKey of [...new Set(objectKeys)].sort()) {
    await deleteGeneratedObject(objectKey, nonce);
  }
}

async function billingAmount(apiKey: string): Promise<number> {
  const query = new URLSearchParams({
    bucketSize: "hour",
    grouping: "endpointId",
    startTime: BILLING_START,
    endTime: nowIso(),
  });
  const response = await fetch(`https://rest.runpod.io/v1/billing/endpoints?${query}`, {
    headers: { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("RUNPOD_ENDPOINT_BILLING_READ_FAILED");
  const value = (await response.json()) as unknown;
  if (!Array.isArray(value)) throw new Error("RUNPOD_ENDPOINT_BILLING_RESPONSE_INVALID");
  let amount = 0;
  for (const row of value) {
    if (typeof row !== "object" || row === null || Array.isArray(row)) {
      throw new Error("RUNPOD_ENDPOINT_BILLING_ROW_INVALID");
    }
    const candidate = Number((row as AnyRecord).amount);
    if (!Number.isFinite(candidate) || candidate < 0) {
      throw new Error("RUNPOD_ENDPOINT_BILLING_AMOUNT_INVALID");
    }
    amount += candidate;
  }
  if (!Number.isFinite(amount) || amount < 0)
    throw new Error("RUNPOD_ENDPOINT_BILLING_TOTAL_INVALID");
  return amount;
}

const GHCR_BLOB_REDIRECT_HOST = "pkg-containers.githubusercontent.com" as const;

/**
 * GHCR serves private blob content through a short-lived, signed redirect.  Follow exactly one
 * HTTPS redirect to the GitHub blob host, never forward the registry bearer token, and reject
 * every other redirect shape.  This keeps image attestation deterministic without allowing an
 * attacker-controlled URL or credential forwarding to enter the qualification process.
 */
export function isAllowedV207GhcrBlobRedirect(target: URL, expectedDigest: string): boolean {
  return (
    target.protocol === "https:" &&
    target.hostname === GHCR_BLOB_REDIRECT_HOST &&
    target.username === "" &&
    target.password === "" &&
    target.hash === "" &&
    target.searchParams.has("se") &&
    target.searchParams.has("sig") &&
    new RegExp(
      `^/ghcrblobs[^/]+/blobs/${expectedDigest.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}$`,
      "u",
    ).test(target.pathname)
  );
}

async function ghcrFetch(
  url: string,
  headers: Readonly<Record<string, string>>,
  expectedDigest?: string,
): Promise<Response> {
  const first = await fetch(url, {
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  if (first.status < 300 || first.status >= 400) return first;
  if (expectedDigest === undefined) throw new Error("V207_IMAGE_REGISTRY_REDIRECT_INVALID");
  const location = first.headers.get("location");
  if (!location) throw new Error("V207_IMAGE_REGISTRY_REDIRECT_INVALID");
  let redirect: URL;
  try {
    redirect = new URL(location, url);
  } catch {
    throw new Error("V207_IMAGE_REGISTRY_REDIRECT_INVALID");
  }
  if (!isAllowedV207GhcrBlobRedirect(redirect, expectedDigest)) {
    throw new Error("V207_IMAGE_REGISTRY_REDIRECT_INVALID");
  }
  // The signed URL is self-authorizing.  Deliberately send only Accept, never Authorization.
  return fetch(redirect, {
    headers: { accept: headers.accept ?? "application/octet-stream" },
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
}

async function ghcrGet(path: string, accept: string): Promise<Response> {
  const url = `https://ghcr.io${path}`;
  const blobMatch = path.match(/\/blobs\/(sha256:[a-f0-9]{64})$/u);
  const expectedDigest = blobMatch?.[1];
  const first = await ghcrFetch(url, { accept }, expectedDigest);
  if (first.status !== 401) return first;
  const challenge = first.headers.get("www-authenticate") ?? "";
  const fields = new Map<string, string>();
  for (const match of challenge.matchAll(/([a-z]+)="([^"]+)"/gu)) {
    if (match[1] && match[2] && !fields.has(match[1])) fields.set(match[1], match[2]);
  }
  if (
    !challenge.startsWith("Bearer ") ||
    fields.get("realm") !== "https://ghcr.io/token" ||
    fields.get("service") !== "ghcr.io" ||
    fields.get("scope") !== "repository:pala-lakshmansai/videoforge-mage-v2-07:pull"
  ) {
    throw new Error("V207_IMAGE_REGISTRY_AUTH_INVALID");
  }
  const tokenUrl = new URL(fields.get("realm")!);
  tokenUrl.searchParams.set("service", fields.get("service")!);
  tokenUrl.searchParams.set("scope", fields.get("scope")!);
  const tokenResponse = await fetch(tokenUrl, { signal: AbortSignal.timeout(30_000) });
  const tokenValue = tokenResponse.ok ? ((await tokenResponse.json()) as AnyRecord).token : null;
  if (typeof tokenValue !== "string" || tokenValue.length < 20 || /\s/u.test(tokenValue)) {
    throw new Error("V207_IMAGE_REGISTRY_TOKEN_INVALID");
  }
  return ghcrFetch(url, { accept, authorization: `Bearer ${tokenValue}` }, expectedDigest);
}

type V207PreflightSummary = Readonly<{
  readonly schema_version: "videoforge.v2-07-preflight/v1";
  readonly image_attestation: AnyRecord;
  readonly runpod_account_id_sha256: string;
  readonly baseline_endpoint_spend_usd: number;
  readonly remaining_cumulative_cap_usd: number;
  readonly cumulative_billing_threshold_usd: number;
  readonly route_authority: Readonly<{ readonly status: number; readonly code: string }>;
  readonly selected_catalog_offering: Readonly<{
    readonly offering_id: typeof V207_RUNPOD_GPU;
    readonly region: typeof V207_RUNPOD_REGION;
    readonly availability: "LOW" | "MEDIUM" | "HIGH";
    readonly secure_reference_rate_usd_per_hour: typeof V207_SECURE_REFERENCE_RATE_USD_PER_HOUR;
    readonly vram_gb: number;
    readonly serverless_flex_rate_usd_per_gpu_hour: typeof V207_SERVERLESS_FLEX_RATE_USD_PER_GPU_HOUR;
    readonly availability_threshold: "LOW-or-better";
  }>;
  readonly inventory: Readonly<{
    readonly checked_at: string;
    readonly pod_count: number;
    readonly endpoint_count: number;
    readonly private_template_count: number;
    readonly active_serverless_workers: number;
    readonly volume_id_hashes: readonly string[];
  }>;
}>;

/**
 * Check the exact live boundary without creating a template, endpoint, worker, job, or R2
 * reservation.  This mode exists to diagnose provider-free startup failures (for example, an
 * image-registry attestation failure) before the mutation boundary is crossed.
 */
async function preflightRouteAuthority(): Promise<{
  readonly status: number;
  readonly code: string;
}> {
  let response: Response;
  try {
    response = await fetch(ROUTE, {
      method: "POST",
      headers: { "content-type": "application/json", connection: "close" },
      body: "{}",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error("V207_ROUTE_PROBE_FAILED");
  }
  let value: unknown;
  try {
    value = (await response.json()) as unknown;
  } catch {
    throw new Error("V207_ROUTE_PROBE_INVALID");
  }
  const error =
    value && typeof value === "object" && !Array.isArray(value) ? (value as AnyRecord).error : null;
  const code =
    error &&
    typeof error === "object" &&
    !Array.isArray(error) &&
    typeof (error as AnyRecord).code === "string"
      ? (error as AnyRecord).code
      : "V207_ROUTE_ERROR_UNBOUNDED";
  if (
    !(
      (response.status === 403 && code === "V207_AUTHORITY_REJECTED") ||
      (response.status === 404 && code === "V207_ROUTE_DISABLED")
    )
  ) {
    throw new Error("V207_ROUTE_AUTHORITY_UNVERIFIED");
  }
  return Object.freeze({ status: response.status, code });
}

export function assertV207PreflightInventory(
  inventory: Awaited<ReturnType<RunPodControlClient["inventory"]>>,
): void {
  const volumeIdHashes = [...inventory.networkVolumes]
    .sort((left, right) => left.idHash.localeCompare(right.idHash))
    .map((volume) => volume.idHash);
  const expectedVolumeHashes = [SOULX_VOLUME, VOLUME].sort();
  const mismatchCodes: string[] = [];
  if (inventory.pods.length !== 0 || inventory.runningPodCount !== 0) mismatchCodes.push("PODS");
  if (inventory.endpoints.length !== 0) mismatchCodes.push("ENDPOINTS");
  if (inventory.privateTemplateCount !== 0) mismatchCodes.push("TEMPLATES");
  if (inventory.activeServerlessWorkerCount !== 0) mismatchCodes.push("WORKERS");
  if (JSON.stringify(volumeIdHashes) !== JSON.stringify(expectedVolumeHashes)) {
    mismatchCodes.push("VOLUMES");
  }
  if (
    inventory.networkVolumes.some(
      (volume) =>
        volume.sizeGb !== 50 ||
        volume.dataCenterId !== V207_RUNPOD_REGION ||
        !expectedVolumeHashes.includes(volume.idHash),
    )
  ) {
    mismatchCodes.push("VOLUME_IDENTITY");
  }
  if (mismatchCodes.length > 0) {
    throw new Error(`V207_PREFLIGHT_INVENTORY_UNEXPECTED_${mismatchCodes.join("_")}`);
  }
}

/**
 * Require a fresh secure-catalog observation for the exact V2-07 offering before any
 * disposable template or endpoint is created.  LOW is intentionally accepted: the
 * proposal's availability boundary is LOW-or-better, not a stronger historical level.
 * The catalog rate is a read-only guard; the Serverless Flex rate remains separately
 * pinned and is recorded in the bounded preflight summary.
 */
export function assertV207FreshCatalogOffering(
  candidates: readonly Cp07GpuCandidate[],
): Cp07GpuCandidate & {
  readonly offeringId: typeof V207_RUNPOD_GPU;
  readonly rateUsdPerHour: typeof V207_SECURE_REFERENCE_RATE_USD_PER_HOUR;
} {
  const selected = candidates.find(
    (candidate) =>
      candidate.offeringId === V207_RUNPOD_GPU &&
      candidate.region === V207_RUNPOD_REGION &&
      candidate.secureCloud === true,
  );
  if (selected === undefined) {
    throw new Error("V207_CATALOG_RTX4090_EU_RO_1_UNAVAILABLE");
  }
  if (
    selected.availability !== "LOW" &&
    selected.availability !== "MEDIUM" &&
    selected.availability !== "HIGH"
  ) {
    throw new Error("V207_CATALOG_AVAILABILITY_INVALID");
  }
  if (selected.rateUsdPerHour !== V207_SECURE_REFERENCE_RATE_USD_PER_HOUR || selected.vramGb < 24) {
    throw new Error("V207_CATALOG_RATE_OR_VRAM_DRIFT");
  }
  return selected as Cp07GpuCandidate & {
    readonly offeringId: typeof V207_RUNPOD_GPU;
    readonly rateUsdPerHour: typeof V207_SECURE_REFERENCE_RATE_USD_PER_HOUR;
  };
}

export async function runV207PreflightOnly(): Promise<V207PreflightSummary> {
  const imageAttestation = await attestPublishedImage();
  const apiKey = process.env.RUNPOD_KEY ?? (await loadSujalRunPodApiKeyFromKeychain());
  const account = await assertSujalRunPodAccount(apiKey);
  if (account.accountIdHash !== SUJAL_RUNPOD_ACCOUNT_ID_SHA256) {
    throw new Error("V207_RUNPOD_ACCOUNT_MISMATCH");
  }
  const baseline = await billingAmount(apiKey);
  const billingThreshold = v207IncrementalSpendThreshold(baseline, finiteCapUsd);
  const control = new RunPodControlClient({ apiKey });
  const [inventory, catalog] = await Promise.all([control.inventory(), fetchCp07Catalog(apiKey)]);
  const selectedCatalogOffering = assertV207FreshCatalogOffering(catalog);
  assertV207PreflightInventory(inventory);
  const routeAuthority = await preflightRouteAuthority();
  return Object.freeze({
    schema_version: "videoforge.v2-07-preflight/v1",
    image_attestation: imageAttestation,
    runpod_account_id_sha256: account.accountIdHash,
    baseline_endpoint_spend_usd: baseline,
    // RunPod returns cumulative billing.  The approved cap applies only to
    // spend after this fresh baseline, regardless of historical spend.
    remaining_cumulative_cap_usd: finiteCapUsd,
    cumulative_billing_threshold_usd: billingThreshold,
    route_authority: routeAuthority,
    selected_catalog_offering: Object.freeze({
      offering_id: selectedCatalogOffering.offeringId,
      region: selectedCatalogOffering.region,
      availability: selectedCatalogOffering.availability,
      secure_reference_rate_usd_per_hour: selectedCatalogOffering.rateUsdPerHour,
      vram_gb: selectedCatalogOffering.vramGb,
      serverless_flex_rate_usd_per_gpu_hour: V207_SERVERLESS_FLEX_RATE_USD_PER_GPU_HOUR,
      availability_threshold: "LOW-or-better",
    }),
    inventory: Object.freeze({
      checked_at: inventory.checkedAt,
      pod_count: inventory.pods.length,
      endpoint_count: inventory.endpoints.length,
      private_template_count: inventory.privateTemplateCount,
      active_serverless_workers: inventory.activeServerlessWorkerCount,
      volume_id_hashes: Object.freeze(
        [...inventory.networkVolumes]
          .sort((left, right) => left.idHash.localeCompare(right.idHash))
          .map((volume) => volume.idHash),
      ),
    }),
  });
}

async function attestPublishedImage(): Promise<AnyRecord> {
  const digest = IMAGE.slice(IMAGE.indexOf("@") + 1);
  const repository = "/v2/pala-lakshmansai/videoforge-mage-v2-07";
  const manifestResponse = await ghcrGet(
    `${repository}/manifests/${digest}`,
    "application/vnd.oci.image.manifest.v1+json",
  );
  if (!manifestResponse.ok || manifestResponse.headers.get("docker-content-digest") !== digest) {
    throw new Error("V207_IMAGE_MANIFEST_ATTESTATION_FAILED");
  }
  const manifest = (await manifestResponse.json()) as AnyRecord;
  if (manifest.config?.digest !== IMAGE_CONFIG_DIGEST) {
    throw new Error("V207_IMAGE_CONFIG_DIGEST_MISMATCH");
  }
  const layers = manifest.layers;
  if (
    !Array.isArray(layers) ||
    layers.length === 0 ||
    (layers[layers.length - 1] as AnyRecord | undefined)?.digest !== IMAGE_LAYER_DIGEST
  ) {
    throw new Error("V207_IMAGE_LAYER_DIGEST_MISMATCH");
  }
  const configResponse = await ghcrGet(
    `${repository}/blobs/${IMAGE_CONFIG_DIGEST}`,
    "application/vnd.oci.image.config.v1+json",
  );
  if (!configResponse.ok) throw new Error("V207_IMAGE_CONFIG_ATTESTATION_FAILED");
  const config = (await configResponse.json()) as AnyRecord;
  const labels = config.config?.Labels as AnyRecord;
  const env = new Set<string>(Array.isArray(config.config?.Env) ? config.config.Env : []);
  if (
    config.os !== "linux" ||
    config.architecture !== "amd64" ||
    JSON.stringify(config.config?.Entrypoint) !==
      JSON.stringify(["python", "/opt/videoforge/mage-serverless-entrypoint.py"]) ||
    labels?.["org.opencontainers.image.revision"] !== V207_REPAIRED_IMAGE_SOURCE_COMMIT ||
    labels?.["ai.videoforge.source-commit"] !== V207_REPAIRED_IMAGE_SOURCE_COMMIT ||
    labels?.["org.opencontainers.image.base.digest"] !== IMAGE_BASE_DIGEST ||
    !env.has("HF_HUB_OFFLINE=1") ||
    !env.has("TRANSFORMERS_OFFLINE=1") ||
    !env.has("DIFFUSERS_OFFLINE=1") ||
    !env.has("MAGE_MODEL_ROOT=/runpod-volume")
  ) {
    throw new Error("V207_IMAGE_CONFIG_IDENTITY_MISMATCH");
  }
  return {
    manifest_digest: digest,
    config_digest: IMAGE_CONFIG_DIGEST,
    source_commit: V207_REPAIRED_IMAGE_SOURCE_COMMIT,
    base_digest: IMAGE_BASE_DIGEST,
    os: config.os,
    architecture: config.architecture,
    offline: true,
  };
}

export function assertV207ItemCount(itemCount: number): void {
  // The sealed worker accepts remote batches in the 32-64 range, but this qualification
  // intentionally owns one exact 32-scene video batch. Keep the local runner narrower so
  // it cannot claim 64 authorities while QUALIFICATION_SCENES supplies only 32 items.
  if (!Number.isSafeInteger(itemCount) || itemCount !== 32) {
    throw new Error("V207_BATCH_ITEM_COUNT_INVALID");
  }
}

/** Merge the prior accepted facts with a replacement's newly committed facts in plan order. */
export function mergeV207AcceptedUnits(
  priorUnits: readonly RunPodV207AcceptedUnitRecord[],
  newUnits: readonly RunPodV207AcceptedUnitRecord[],
  planManifest: Record<string, unknown>,
): readonly RunPodV207AcceptedUnitRecord[] {
  const planItems = planManifest.items;
  if (!Array.isArray(planItems) || planItems.length !== 32) {
    throw new Error("V207_RESUME_PLAN_MANIFEST_INVALID");
  }
  const planHash = hashV207PlanManifest(planManifest);
  const expectedIds = planItems.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("V207_RESUME_PLAN_MANIFEST_INVALID");
    }
    const itemId = (item as Record<string, unknown>).scene_id;
    if (typeof itemId !== "string") throw new Error("V207_RESUME_PLAN_MANIFEST_INVALID");
    return itemId;
  });
  const expected = new Set(expectedIds);
  if (expected.size !== expectedIds.length) throw new Error("V207_RESUME_PLAN_DUPLICATE");
  const merged = new Map<string, RunPodV207AcceptedUnitRecord>();
  for (const unit of [...priorUnits, ...newUnits]) {
    if (
      !unit ||
      unit.plan_manifest_sha256 !== planHash ||
      canonicalizeJson(unit.plan_manifest) !== canonicalizeJson(planManifest) ||
      !expected.has(unit.item_id) ||
      merged.has(unit.item_id)
    ) {
      throw new Error("V207_RESUME_DURABLE_UNIT_INVALID");
    }
    merged.set(unit.item_id, unit);
  }
  if (merged.size !== expectedIds.length) {
    throw new Error("V207_RESUME_DURABLE_UNIT_INCOMPLETE");
  }
  return Object.freeze(expectedIds.map((itemId) => merged.get(itemId)!));
}

function assertV207AcceptedUnits(
  acceptedUnits: readonly RunPodV207AcceptedUnitRecord[] | undefined,
  plannedItems: readonly AnyRecord[],
  attemptId: string,
  modelRevision: string,
): ReadonlySet<string> {
  if (acceptedUnits === undefined || acceptedUnits.length === 0) return new Set();
  if (
    acceptedUnits.length < 1 ||
    acceptedUnits.length >= plannedItems.length ||
    new Set(acceptedUnits.map((unit) => unit.item_id)).size !== acceptedUnits.length
  ) {
    throw new Error("V207_RESUME_ACCEPTED_UNITS_INVALID");
  }
  const planManifest = buildV207PlanManifest(plannedItems, modelRevision);
  const planManifestSha256 = hashV207PlanManifest(planManifest);
  const plannedIds = new Set(plannedItems.map((item) => item.scene_id));
  const seen = new Set<string>();
  for (const unit of acceptedUnits) {
    if (
      unit.tenant.account_id !== ACCOUNT ||
      unit.tenant.workspace_id !== WORKSPACE ||
      unit.project_id !== PROJECT ||
      unit.revision_id !== REVISION ||
      unit.lane !== "mage-image" ||
      unit.plan_manifest_sha256 !== planManifestSha256 ||
      canonicalizeJson(unit.plan_manifest) !== canonicalizeJson(planManifest) ||
      !V207_RESUME_ID.test(unit.source_attempt_id) ||
      unit.source_attempt_id === attemptId ||
      !V207_RESUME_ID.test(unit.item_id) ||
      !plannedIds.has(unit.item_id) ||
      seen.has(unit.item_id) ||
      unit.output_object_key !==
        `tenant/${ACCOUNT}/workspace/${WORKSPACE}/project/${PROJECT}/revision/${REVISION}/lane/mage-image/job/${unit.source_attempt_id}/artifact/${unit.item_id}` ||
      !/^sha256:[0-9a-f]{64}$/u.test(unit.output_sha256) ||
      !Number.isSafeInteger(unit.output_bytes) ||
      unit.output_bytes < 1 ||
      unit.output_bytes > OUTPUT_LIMIT ||
      !/^sha256:[0-9a-f]{64}$/u.test(unit.artifact_commit_receipt_sha256) ||
      !/^sha256:[0-9a-f]{64}$/u.test(unit.signed_provenance_receipt_sha256) ||
      unit.readback_port.schema_version !== "artifact-transfer-port/v3" ||
      unit.readback_port.path !== `/${unit.output_object_key}` ||
      unit.readback_port.method !== "GET" ||
      unit.readback_port.account_id !== ACCOUNT ||
      unit.readback_port.workspace_id !== WORKSPACE ||
      unit.readback_port.content_type !== "image/png" ||
      unit.readback_port.content_length !== unit.output_bytes ||
      unit.readback_port.checksum_sha256 !== unit.output_sha256 ||
      unit.readback_port.max_uses !== 1 ||
      typeof unit.readback_port.reservation_id !== "string" ||
      typeof unit.readback_port.expires_at !== "string" ||
      typeof unit.readback_port.capability_handle !== "string" ||
      !/^[A-Za-z0-9._:-]{32,512}$/u.test(unit.readback_port.capability_handle)
    ) {
      throw new Error("V207_RESUME_ACCEPTED_UNITS_INVALID");
    }
    validateV207ResumeUrl(unit.readback_get_url);
    seen.add(unit.item_id);
  }
  return seen;
}

async function createBatch(
  attemptId: string,
  nonce: string,
  workerToken: string,
  itemCount: number,
  abortCheck?: () => void,
  acceptedUnits?: readonly RunPodV207AcceptedUnitRecord[],
  executionItemIds?: readonly string[],
): Promise<{
  readonly input: RunPodV207DispatchBatchInput;
  readonly objectKeys: readonly string[];
  readonly planManifest: Record<string, unknown>;
  readonly planManifestSha256: string;
}> {
  assertV207ItemCount(itemCount);
  const negativePrompt = "text, letters, logo, watermark, malformed objects";
  const items: AnyRecord[] = QUALIFICATION_SCENES.slice(0, itemCount).map(
    (positivePrompt, index) => ({
      scene_id: `scene-${String(index + 1).padStart(2, "0")}`,
      positive_prompt: positivePrompt,
      positive_prompt_sha256: hashText(positivePrompt),
      negative_prompt: negativePrompt,
      negative_prompt_sha256: hashText(negativePrompt),
      seed: 2_000_000 + index,
      width: 1280,
      height: 720,
      output_put_url: "https://unused.example/placeholder",
    }),
  );
  const acceptedIds = assertV207AcceptedUnits(acceptedUnits, items, attemptId, MODEL_REVISION);
  const unresolvedItems = items.filter((item) => !acceptedIds.has(item.scene_id));
  if (unresolvedItems.length < 1) throw new Error("V207_RESUME_NO_UNRESOLVED_ITEMS");
  const unresolvedIds = new Set(unresolvedItems.map((item) => item.scene_id));
  const selectedIds = executionItemIds ?? unresolvedItems.map((item) => item.scene_id);
  if (
    selectedIds.length < 1 ||
    new Set(selectedIds).size !== selectedIds.length ||
    selectedIds.some((itemId) => !V207_RESUME_ID.test(itemId) || !unresolvedIds.has(itemId)) ||
    (acceptedIds.size > 0 && selectedIds.length !== unresolvedItems.length)
  ) {
    throw new Error("V207_EXECUTION_SUBSET_INVALID");
  }
  const selectedIdSet = new Set(selectedIds);
  const executionItems = unresolvedItems.filter((item) => selectedIdSet.has(item.scene_id));
  const outputPrefix =
    `tenant/${ACCOUNT}/workspace/${WORKSPACE}/project/${PROJECT}/revision/${REVISION}` +
    `/lane/mage-image/job/${attemptId}`;
  const authorities: AnyRecord[] = [];
  const outputPutUrls: string[] = [];
  const objectKeys: string[] = [];
  const reservationIds: string[] = [];
  try {
    for (const item of executionItems) {
      abortCheck?.();
      const objectKey = `${outputPrefix}/artifact/${item.scene_id}`;
      objectKeys.push(objectKey);
      const signed = await routePort(
        {
          schema_version: "videoforge-v207-generated-output-port-request/v1",
          operation: "PUT",
          account_id: ACCOUNT,
          workspace_id: WORKSPACE,
          object_key: objectKey,
          content_type: "image/png",
          max_content_length: OUTPUT_LIMIT,
          lifetime_seconds: V207_RUNPOD_REQUEST_AUTHORITY_TTL_SECONDS,
        },
        nonce,
      );
      abortCheck?.();
      const authority = signed.authority as AnyRecord;
      if (
        !authority ||
        authority.schema_version !== "artifact-generated-output-authority/v1" ||
        authority.path !== `/${objectKey}` ||
        authority.max_uses !== 1 ||
        typeof authority.reservation_id !== "string"
      ) {
        throw new Error("V207_OUTPUT_AUTHORITY_INVALID");
      }
      authorities.push(authority);
      outputPutUrls.push(signed.url);
      reservationIds.push(authority.reservation_id);
      if (authorities.length % 8 === 0) {
        console.error(`v207:ports-${attemptId}-${authorities.length}`);
      }
    }
  } catch (error) {
    try {
      await deleteGeneratedObjects(objectKeys, nonce);
    } catch {
      throw new Error("V207_BATCH_PORT_ROLLBACK_UNCERTAIN", { cause: error });
    }
    throw error;
  }
  const batch = { attempt_id: attemptId, model_revision: MODEL_REVISION, items };
  const planManifest = buildV207PlanManifest(items, MODEL_REVISION);
  const planManifestCanonicalJson = canonicalizeJson(planManifest);
  const planManifestSha256 = hashText(planManifestCanonicalJson);
  const execution = {
    schema_version: "serverless-execution-subset/v1",
    plan_manifest_sha256: planManifestSha256,
    item_ids: executionItems.map((item) => item.scene_id),
  };
  const executionCanonicalJson = canonicalizeJson(execution);
  const executionManifestSha256 = hashText(executionCanonicalJson);
  const resume =
    acceptedUnits && acceptedUnits.length > 0
      ? {
          schema_version: "serverless-unit-resume/v1",
          plan_manifest: planManifest,
          plan_manifest_sha256: planManifestSha256,
          accepted_units: acceptedUnits,
        }
      : null;
  const resumeManifestSha256 = resume ? hashText(canonicalizeJson(resume)) : null;
  const resumeCanonicalJson = resume ? canonicalizeJson(resume) : null;
  const issuedAtMs = Date.now();
  const issuedAt = new Date(issuedAtMs).toISOString();
  const expiresAt = new Date(
    issuedAtMs + V207_RUNPOD_REQUEST_AUTHORITY_TTL_SECONDS * 1_000,
  ).toISOString();
  const envelopeBody = {
    schema: "serverless-worker-job-envelope/v3",
    dispatch_token: `dispatch-${attemptId}-${randomBytes(8).toString("hex")}`,
    tenant: { account_id: ACCOUNT, workspace_id: WORKSPACE },
    work: {
      project_revision_id: REVISION,
      generation_request_id: `request-${attemptId}`,
      task_id: `task-${attemptId}`,
      attempt_id: attemptId,
      lane: "mage_image",
      items_manifest_sha256: hashText(canonicalizeJson(items)),
      item_count: executionItems.length,
    },
    runtime: {
      endpoint_profile_id: "mage-serverless-v1",
      deployment_id: "deployment-mage-v207",
      container_digest: IMAGE.slice(IMAGE.indexOf("@") + 1),
      model_manifest_sha256: MANIFEST,
      volume_id_sha256: VOLUME,
      volume_mount: V207_RUNPOD_VOLUME_MOUNT,
      volume_write_policy: "APPLICATION_READ_ONLY",
      scratch_root_policy: "JOB_LOCAL_SCRATCH_OUTSIDE_MODEL_VOLUME",
      gpu_allowlist: [V207_RUNPOD_GPU],
      region: V207_RUNPOD_REGION,
    },
    artifacts: {
      input_manifest_sha256: hashText(`input-${attemptId}`),
      output_prefix: outputPrefix,
      transfer_port_reservation_ids: reservationIds,
      plan_manifest_sha256: planManifestSha256,
      execution_manifest_sha256: executionManifestSha256,
      ...(resumeManifestSha256 ? { resume_manifest_sha256: resumeManifestSha256 } : {}),
    },
    limits: {
      issued_at: issuedAt,
      expires_at: expiresAt,
      max_items: 64,
      max_input_bytes: 268_435_456,
      max_output_bytes: 2_147_483_648,
      execution_timeout_seconds: V207_RUNPOD_EXECUTION_TIMEOUT_MS / 1_000,
      init_timeout_seconds: V207_RUNPOD_INIT_TIMEOUT_SECONDS,
    },
    policy: {
      model_download_permitted: false,
      volume_mutation_permitted: false,
      pod_lifecycle_permitted: false,
      queue_purge_permitted: false,
    },
  };
  const authoritySha256 = hashText(sortedJson(envelopeBody));
  const signaturePreimage = sortedJson({
    key_id: "worker-key-1",
    authority_sha256: authoritySha256,
  });
  const envelope = {
    ...envelopeBody,
    authority_sha256: authoritySha256,
    signature: {
      algorithm: "HMAC-SHA256",
      key_id: "worker-key-1",
      value: createHmac("sha256", Buffer.from(workerToken, "hex"))
        .update(signaturePreimage)
        .digest("hex"),
    },
  };
  const outputAuthority: RunPodV207OutputAuthority = {
    schemaVersion: "artifact-generated-output-authority/v1",
    attemptId,
    accountId: ACCOUNT,
    workspaceId: WORKSPACE,
    outputPrefix,
    authorities,
    outputPutUrls,
  };
  return {
    input: {
      requestKey: `request-${attemptId}`,
      attemptId,
      input: {
        envelope,
        batch,
        plan_manifest_canonical_json: planManifestCanonicalJson,
        execution,
        execution_canonical_json: executionCanonicalJson,
        ...(resume ? { resume } : {}),
        ...(resumeCanonicalJson ? { resume_canonical_json: resumeCanonicalJson } : {}),
      },
      outputAuthority,
    },
    objectKeys,
    planManifest,
    planManifestSha256,
  };
}

async function verifyBatch(
  job: RunPodJobResult,
  expectedAttemptId: string,
  objectKeys: readonly string[],
  authorities: readonly AnyRecord[],
  planManifest: Record<string, unknown>,
  itemCount: number,
  expectedEndpointIdHash: string,
  nonce: string,
  receiptKeyId: string,
  receiptSecret: Buffer,
): Promise<AnyRecord> {
  if (!Number.isSafeInteger(itemCount) || itemCount < 1 || itemCount > 32) {
    throw new Error("V207_OUTPUT_ITEM_COUNT_INVALID");
  }
  if (job.status !== "COMPLETED") throw new Error(`RUNPOD_JOB_${job.status}`);
  const output = job.output as AnyRecord;
  let failureStage: V207OutputFailureStage = "top_level";
  try {
    if (!output || output.status !== "SUCCEEDED" || !Array.isArray(output.items)) {
      console.error(
        `v207:failed-output-shape=${JSON.stringify({
          job_keys: Object.keys(job).sort(),
          output_type: Array.isArray(output) ? "array" : typeof output,
          output_keys: output && typeof output === "object" ? Object.keys(output).sort() : [],
        })}`,
      );
      const outputStatus =
        typeof output?.status === "string" && SAFE_PROVIDER_CODE.test(output.status)
          ? output.status
          : "MISSING";
      const failureCode = extractV207ProviderJobErrorCode(job.error, output) ?? "UNKNOWN";
      throw new V207OutputContractError(
        outputStatus,
        failureCode,
        describeV207OutputShape(output),
        failureStage,
      );
    }
    failureStage = "item_count";
    if (output.items.length !== itemCount || objectKeys.length !== itemCount) {
      throw new Error("MAGE_OUTPUT_ITEM_COUNT_INVALID");
    }
    failureStage = "authority_count";
    if (authorities.length !== itemCount) throw new Error("MAGE_AUTHORITY_COUNT_INVALID");
    failureStage = "receipt_presence";
    const receipt = output.provenance_receipt as AnyRecord;
    if (!receipt || receipt.schema_version !== "serverless-provenance-receipt/v1") {
      throw new Error("MAGE_RECEIPT_MISSING");
    }
    failureStage = "receipt_hash";
    const receiptBody = { ...receipt };
    const signature = receiptBody.signature as AnyRecord;
    delete receiptBody.receipt_sha256;
    delete receiptBody.signature;
    const receiptSha = hashText(sortedJson(receiptBody));
    if (receipt.receipt_sha256 !== receiptSha) throw new Error("MAGE_RECEIPT_HASH_INVALID");
    failureStage = "receipt_signature";
    const preimage = sortedJson({ key_id: receiptKeyId, receipt_sha256: receiptSha });
    const expectedSignature = createHmac("sha256", receiptSecret).update(preimage).digest("hex");
    if (
      signature?.algorithm !== "HMAC-SHA256" ||
      signature.key_id !== receiptKeyId ||
      signature.value !== expectedSignature
    ) {
      throw new Error("MAGE_RECEIPT_SIGNATURE_INVALID");
    }
    const deployment = receipt.deployment as AnyRecord;
    const runtimeProbe = receipt.runtime_probe as AnyRecord;
    const volumeVerification = receipt.volume_verification as AnyRecord;
    const modelReady = receipt.model_ready_evidence as AnyRecord;
    const scratchCleanup = receipt.scratch_cleanup as AnyRecord;
    const receiptItems = receipt.items as AnyRecord[];
    const timings = receipt.timings as AnyRecord;
    // Timing provenance is accepted only from the signed receipt body.  A same-shaped
    // top-level output field is deliberately ignored, because the provider response itself is
    // not trusted until this receipt hash/signature has been checked.
    const timingProvenance = timings?.timing_provenance as AnyRecord;
    const signedWorkerId = receipt.worker_id;
    const signedWorkerIdHash =
      typeof signedWorkerId === "string" &&
      signedWorkerId !== "" &&
      signedWorkerId !== "serverless" &&
      V207_RESUME_ID.test(signedWorkerId)
        ? hashText(signedWorkerId)
        : null;
    let signedPodIdHash: string | null = null;
    const requiredTimings = [
      "allocation_ms",
      "container_ready_ms",
      "volume_verified_ms",
      "model_load_ms",
      "warmup_ms",
      "first_inference_ms",
      "upload_ms",
      "total_ms",
    ] as const;
    failureStage = "receipt_identity";
    if (
      receipt.attempt_id !== expectedAttemptId ||
      receipt.provider_job_id !== job.id ||
      deployment?.container_digest !== IMAGE.slice(IMAGE.indexOf("@") + 1) ||
      deployment?.endpoint_id_sha256 !== expectedEndpointIdHash ||
      deployment?.intended_volume_id_sha256 !== VOLUME ||
      deployment?.intended_region !== V207_RUNPOD_REGION ||
      deployment?.model_manifest_sha256 !== MANIFEST ||
      runtimeProbe?.gpu_name !== V207_RUNPOD_GPU ||
      runtimeProbe?.gpu_count !== 1 ||
      runtimeProbe?.cuda_version !== V207_RUNPOD_MIN_CUDA_VERSION ||
      volumeVerification?.manifest_sha256_before !== MANIFEST ||
      volumeVerification?.manifest_sha256_after !== MANIFEST ||
      volumeVerification?.mutation_detected !== false ||
      volumeVerification?.cross_mount_detected !== false ||
      modelReady?.state !== "MODEL_READY" ||
      modelReady?.warmup_completed !== true ||
      !/^sha256:[0-9a-f]{64}$/u.test(String(modelReady?.warmup_output_sha256 ?? "")) ||
      scratchCleanup?.removed !== true ||
      scratchCleanup?.scratch_on_model_volume !== false ||
      timingProvenance?.schema_version !== "videoforge-serverless-timing-provenance/v1" ||
      timingProvenance?.provider_timing_source !==
        "RUNPOD_STATUS_DELAY_TIME_MS_AND_EXECUTION_TIME_MS" ||
      timingProvenance?.worker_timing_source !==
        "SIGNED_ENVELOPE_ISSUED_AT_TO_LOCAL_RUNTIME_BOUNDARIES" ||
      typeof timingProvenance?.signed_envelope_issued_at !== "string" ||
      timingProvenance?.process_start_boundary !==
        "MAGE_RUNTIME_STARTED_OR_HANDLER_ADMISSION_MONOTONIC" ||
      timingProvenance?.container_ready_boundary !== "HANDLER_RUNTIME_READY_MONOTONIC" ||
      !Array.isArray(receiptItems) ||
      signedWorkerIdHash === null ||
      receiptItems.length !== objectKeys.length ||
      !timings ||
      requiredTimings.some(
        (key) => !Number.isSafeInteger(timings[key]) || Number(timings[key]) < 0,
      ) ||
      timings.first_inference_ms < 1 ||
      timings.total_ms < 1 ||
      !Number.isSafeInteger(job.delayTimeMs) ||
      Number(job.delayTimeMs) < 0 ||
      !Number.isSafeInteger(job.executionTimeMs) ||
      Number(job.executionTimeMs) < 0
    ) {
      throw new Error("MAGE_RECEIPT_IDENTITY_INVALID");
    }
    const readbacks: AnyRecord[] = [];
    const commitReceipts: AnyRecord[] = [];
    const durableAcceptedUnits: RunPodV207AcceptedUnitRecord[] = [];
    const planManifestSha256 = hashV207PlanManifest(planManifest);
    let peakVram = 0;
    failureStage = "output_lineage";
    for (const [index, itemValue] of output.items.entries()) {
      const item = itemValue as AnyRecord;
      const authority = authorities[index] as AnyRecord;
      const receiptItem = receiptItems[index] as AnyRecord;
      const expectedObjectKey = objectKeys[index];
      if (typeof expectedObjectKey !== "string") throw new Error("MAGE_OUTPUT_LINEAGE_INVALID");
      const expectedItemId = expectedObjectKey.split("/artifact/").at(-1);
      const runtimeEvidence = item.runtime_evidence as AnyRecord;
      const gpu = runtimeEvidence?.gpu as AnyRecord;
      const podIdHash = runtimeEvidence?.pod_id_hash;
      if (
        item.output_object_key !== objectKeys[index] ||
        !/^sha256:[0-9a-f]{64}$/u.test(String(item.output_sha256 ?? "")) ||
        !Number.isSafeInteger(item.output_bytes) ||
        item.output_bytes < 1 ||
        item.output_bytes > OUTPUT_LIMIT ||
        item.width !== 1280 ||
        item.height !== 720 ||
        authority?.path !== `/${objectKeys[index]}` ||
        typeof expectedItemId !== "string" ||
        item.item_id !== expectedItemId ||
        receiptItem?.item_id !== expectedItemId ||
        receiptItem?.state !== "SUCCEEDED" ||
        receiptItem?.output_object_key !== item.output_object_key ||
        receiptItem?.output_sha256 !== item.output_sha256 ||
        receiptItem?.output_bytes !== item.output_bytes ||
        receiptItem?.probe?.width !== 1280 ||
        receiptItem?.probe?.height !== 720 ||
        receiptItem?.probe?.format !== "png" ||
        runtimeEvidence?.schema_version !== "videoforge.mage-runtime-evidence/v3" ||
        typeof podIdHash !== "string" ||
        !/^sha256:[0-9a-f]{64}$/u.test(podIdHash) ||
        runtimeEvidence?.volume_id_hash !== VOLUME ||
        runtimeEvidence?.worker_image_digest !== IMAGE ||
        runtimeEvidence?.model_revision !== MODEL_REVISION ||
        runtimeEvidence?.comfyui_revision !== "26d7f8556822d9d08c2d3e1878636ac3b4969af9" ||
        runtimeEvidence?.precision !== "int8-convrot" ||
        gpu?.name !== V207_RUNPOD_GPU ||
        gpu?.device_count !== 1 ||
        gpu?.cuda_version !== V207_RUNPOD_MIN_CUDA_VERSION ||
        !Number.isSafeInteger(gpu?.peak_vram_used_bytes) ||
        Number(gpu?.peak_vram_used_bytes) < 1
      ) {
        throw new Error("MAGE_OUTPUT_LINEAGE_INVALID");
      }
      if (signedPodIdHash === null) signedPodIdHash = podIdHash;
      if (signedPodIdHash !== podIdHash || podIdHash !== signedWorkerIdHash) {
        throw new Error("MAGE_WORKER_PROCESS_IDENTITY_INVALID");
      }
      failureStage = "output_readback";
      const getPort = await routePort(
        {
          schema_version: "videoforge-v207-generated-output-port-request/v1",
          operation: "GET",
          account_id: ACCOUNT,
          workspace_id: WORKSPACE,
          object_key: item.output_object_key,
          content_type: "image/png",
          max_content_length: OUTPUT_LIMIT,
          lifetime_seconds: 600,
          content_length: item.output_bytes,
          checksum_sha256: item.output_sha256,
        },
        nonce,
      );
      const readbackAuthority = getPort.authority as AnyRecord;
      if (
        !readbackAuthority ||
        readbackAuthority.schema_version !== "artifact-transfer-port/v3" ||
        readbackAuthority.reservation_id === authority.reservation_id ||
        readbackAuthority.account_id !== ACCOUNT ||
        readbackAuthority.workspace_id !== WORKSPACE ||
        readbackAuthority.method !== "GET" ||
        readbackAuthority.path !== `/${item.output_object_key}` ||
        readbackAuthority.content_type !== "image/png" ||
        readbackAuthority.content_length !== item.output_bytes ||
        readbackAuthority.checksum_sha256 !== item.output_sha256 ||
        readbackAuthority.max_uses !== 1
      ) {
        throw new Error("MAGE_OUTPUT_READBACK_AUTHORITY_INVALID");
      }
      const response = await fetch(getPort.url, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error("MAGE_OUTPUT_READBACK_FAILED");
      const bytes = new Uint8Array(await response.arrayBuffer());
      const byteHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
      if (bytes.byteLength !== item.output_bytes || byteHash !== item.output_sha256) {
        throw new Error("MAGE_OUTPUT_DURABILITY_MISMATCH");
      }
      failureStage = "output_png_probe";
      const png = Buffer.from(bytes);
      if (
        png.length < 24 ||
        png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
        png.subarray(12, 16).toString("ascii") !== "IHDR" ||
        png.readUInt32BE(16) !== 1280 ||
        png.readUInt32BE(20) !== 720
      ) {
        throw new Error("MAGE_OUTPUT_NOT_PNG");
      }
      const finalizationRequest = {
        schema_version: "videoforge-v207-generated-output-port-request/v1",
        operation: "FINALIZE",
        account_id: ACCOUNT,
        workspace_id: WORKSPACE,
        object_key: item.output_object_key,
        content_type: "image/png",
        content_length: item.output_bytes,
        checksum_sha256: item.output_sha256,
        reservation_id: authority.reservation_id,
        capability_handle: authority.capability_handle,
        callback_id: `callback-${expectedAttemptId}-${String(index + 1).padStart(2, "0")}`,
      };
      failureStage = "output_finalization";
      const finalized = await routePort(finalizationRequest, nonce);
      const commitReceipt = finalized.receipt as AnyRecord;
      const commitReceiptBody = { ...commitReceipt };
      delete commitReceiptBody.schema_version;
      delete commitReceiptBody.receipt_id;
      delete commitReceiptBody.receipt_sha256;
      if (
        finalized.schema_version !== "videoforge-v207-generated-output-finalization/v1" ||
        commitReceipt?.schema_version !== "artifact-commit-receipt/v3" ||
        commitReceipt?.reservation_id !== authority.reservation_id ||
        commitReceipt?.object_key !== item.output_object_key ||
        commitReceipt?.content_type !== "image/png" ||
        commitReceipt?.content_length !== item.output_bytes ||
        commitReceipt?.checksum_sha256 !== item.output_sha256 ||
        commitReceipt?.probe?.width !== 1280 ||
        commitReceipt?.probe?.height !== 720 ||
        commitReceipt?.probe?.format !== "png" ||
        commitReceipt?.probe?.decoded !== true ||
        !/^sha256:[0-9a-f]{64}$/u.test(String(commitReceipt?.receipt_sha256 ?? "")) ||
        commitReceipt.receipt_sha256 !== hashText(sortedJson(commitReceiptBody))
      ) {
        throw new Error("MAGE_COMMIT_RECEIPT_INVALID");
      }
      failureStage = "output_finalization_replay";
      const replayed = await routePort(finalizationRequest, nonce);
      if (replayed.receipt?.receipt_sha256 !== commitReceipt.receipt_sha256) {
        throw new Error("MAGE_COMMIT_RECEIPT_REPLAY_INVALID");
      }
      // The first GET authority was consumed by the durability probe above.  Persist a fresh,
      // one-use GET authority for a possible process-replacement resume; it is never reused for
      // the current verification readback.
      failureStage = "output_resume_readback";
      const resumeGetPort = await routePort(
        {
          schema_version: "videoforge-v207-generated-output-port-request/v1",
          operation: "GET",
          account_id: ACCOUNT,
          workspace_id: WORKSPACE,
          object_key: item.output_object_key,
          content_type: "image/png",
          max_content_length: OUTPUT_LIMIT,
          // The hosted route caps GET authorities at 900 seconds. This single-use resume
          // authority is intentionally bounded to that contract rather than the longer
          // request/envelope lifetime.
          lifetime_seconds: V207_OUTPUT_PORT_GET_MAX_LIFETIME_SECONDS,
          content_length: item.output_bytes,
          checksum_sha256: item.output_sha256,
        },
        nonce,
      );
      const resumeReadbackAuthority = resumeGetPort.authority as AnyRecord;
      if (
        !resumeReadbackAuthority ||
        resumeReadbackAuthority.schema_version !== "artifact-transfer-port/v3" ||
        resumeReadbackAuthority.reservation_id === readbackAuthority.reservation_id ||
        resumeReadbackAuthority.account_id !== ACCOUNT ||
        resumeReadbackAuthority.workspace_id !== WORKSPACE ||
        resumeReadbackAuthority.method !== "GET" ||
        resumeReadbackAuthority.path !== `/${item.output_object_key}` ||
        resumeReadbackAuthority.content_type !== "image/png" ||
        resumeReadbackAuthority.content_length !== item.output_bytes ||
        resumeReadbackAuthority.checksum_sha256 !== item.output_sha256 ||
        resumeReadbackAuthority.max_uses !== 1
      ) {
        throw new Error("MAGE_RESUME_READBACK_AUTHORITY_INVALID");
      }
      validateV207ResumeUrl(resumeGetPort.url);
      const itemPeak = Number(gpu.peak_vram_used_bytes);
      peakVram = Math.max(peakVram, itemPeak);
      readbacks.push({ bytes: bytes.byteLength, sha256: byteHash });
      commitReceipts.push({
        receipt_sha256: commitReceipt.receipt_sha256,
        reservation_id: commitReceipt.reservation_id,
        replay_confirmed: true,
      });
      durableAcceptedUnits.push({
        tenant: { account_id: ACCOUNT, workspace_id: WORKSPACE },
        project_id: PROJECT,
        revision_id: REVISION,
        lane: "mage-image",
        source_attempt_id: expectedAttemptId,
        item_id: expectedItemId,
        output_object_key: item.output_object_key,
        output_sha256: item.output_sha256,
        output_bytes: item.output_bytes,
        artifact_commit_receipt_sha256: commitReceipt.receipt_sha256,
        signed_provenance_receipt_sha256: receipt.receipt_sha256,
        plan_manifest: planManifest,
        plan_manifest_sha256: planManifestSha256,
        readback_port: resumeReadbackAuthority,
        readback_get_url: resumeGetPort.url,
      });
    }
    if (signedWorkerIdHash === null || signedPodIdHash === null) {
      throw new Error("MAGE_WORKER_PROCESS_IDENTITY_UNAVAILABLE");
    }
    const workerProcessIdentity: RunPodV207WorkerProcessIdentity = {
      schema_version: "videoforge-v207-worker-process-identity/v1",
      worker_id_sha256: signedWorkerIdHash,
      pod_id_sha256: signedPodIdHash,
    };
    return {
      provider_job_id_hash: hashText(job.id),
      status: job.status,
      execution_time_ms: job.executionTimeMs,
      delay_time_ms: job.delayTimeMs,
      item_count: output.items.length,
      peak_vram_used_bytes: peakVram,
      readbacks,
      commit_receipts: commitReceipts,
      durable_accepted_units: durableAcceptedUnits,
      worker_process_identity: workerProcessIdentity,
      receipt_sha256: receipt.receipt_sha256,
      scratch_contract: {
        configured_root: V207_JOB_SCRATCH_ROOT,
        exact_job_path: `${V207_JOB_SCRATCH_ROOT}/jobs/${expectedAttemptId}`,
        removed: true,
        scratch_on_model_volume: false,
      },
      timings,
      timing_provenance: {
        provider_timing_source: "RUNPOD_STATUS_DELAY_TIME_MS_AND_EXECUTION_TIME_MS",
        provider_delay_time_ms: job.delayTimeMs,
        provider_execution_time_ms: job.executionTimeMs,
        worker_timing_source: timingProvenance.worker_timing_source,
        signed_envelope_issued_at: timingProvenance.signed_envelope_issued_at,
      },
    };
  } catch (error) {
    if (isV207OutputContractDiagnostic(error)) throw error;
    throw new V207OutputContractError(
      typeof output?.status === "string" && SAFE_PROVIDER_CODE.test(output.status)
        ? output.status
        : "MISSING",
      boundedV207FailureCode(error),
      describeV207OutputShape(output),
      failureStage,
      error instanceof V207OutputPortFinalizeResponseError ||
      error instanceof V207OutputPortFinalizeTransportError
        ? error.diagnostic
        : null,
    );
  }
}

async function verifyBatchWithDiagnostic(
  harness: RunPodV207QualificationHarness,
  job: RunPodJobResult,
  expectedAttemptId: string,
  objectKeys: readonly string[],
  authorities: readonly AnyRecord[],
  planManifest: Record<string, unknown>,
  itemCount: number,
  expectedEndpointIdHash: string,
  nonce: string,
  receiptKeyId: string,
  receiptSecret: Buffer,
): Promise<AnyRecord> {
  try {
    return await verifyBatch(
      job,
      expectedAttemptId,
      objectKeys,
      authorities,
      planManifest,
      itemCount,
      expectedEndpointIdHash,
      nonce,
      receiptKeyId,
      receiptSecret,
    );
  } catch (error) {
    const providerJobError = redactV207ProviderJobError(job.error);
    if (Object.keys(providerJobError).length > 0) {
      console.error(`v207:provider-job-error=${JSON.stringify(providerJobError)}`);
    }
    try {
      const diagnostic = await harness.diagnostic(job.id);
      const redactedDiagnostic = redactV207LiveEvidence({
        provider_diagnostic: diagnostic,
      }).provider_diagnostic;
      console.error(`v207:provider-diagnostic=${JSON.stringify(redactedDiagnostic)}`);
    } catch (diagnosticError) {
      console.error(
        `v207:provider-diagnostic-unavailable=${
          diagnosticError instanceof Error ? diagnosticError.message : "UNKNOWN"
        }`,
      );
    }
    throw error;
  }
}

async function main(): Promise<void> {
  const activation = parseV207ActivationAuthority(process.env);
  IMAGE = activation.image;
  finiteCapUsd = activation.capUsd;
  const cancellation = createV207Cancellation();
  const removeSignalHandlers = installV207SignalHandlers(cancellation);
  try {
    cancellation.throwIfRequested();
    if (process.env.V207_PREFLIGHT_ONLY === "1") {
      const summary = await runV207PreflightOnly();
      console.error(
        `v207:preflight-ok=${JSON.stringify({
          schema_version: summary.schema_version,
          image_attestation: summary.image_attestation,
          runpod_account_id_sha256: summary.runpod_account_id_sha256,
          baseline_endpoint_spend_usd: summary.baseline_endpoint_spend_usd,
          remaining_cumulative_cap_usd: summary.remaining_cumulative_cap_usd,
          cumulative_billing_threshold_usd: summary.cumulative_billing_threshold_usd,
          route_authority: summary.route_authority,
          selected_catalog_offering: summary.selected_catalog_offering,
          inventory: summary.inventory,
        })}`,
      );
      return;
    }
    const apiKey = process.env.RUNPOD_KEY ?? (await loadSujalRunPodApiKeyFromKeychain());
    let nonce = process.env.V207_AUTHORITY_NONCE?.trim() ?? "";
    if (!nonce) {
      const wranglerConfigPath =
        process.env.V207_WRANGLER_CONFIG ??
        "dist-staging/videoforge_v2_06_staging/v207-wrangler.json";
      const wranglerConfig = JSON.parse(await readFile(wranglerConfigPath, "utf8")) as AnyRecord;
      nonce = String(wranglerConfig.vars?.VIDEOFORGE_V207_AUTHORITY_NONCE ?? "");
    }
    if (!/^[a-f0-9]{64}$/u.test(nonce)) throw new Error("V207_NONCE_MISSING");
    const imageAttestation = await attestPublishedImage();
    const receiptKeyId = "v207-qualification-20260820";
    const receiptSecret = randomBytes(32);
    const workerToken = randomBytes(32).toString("hex");
    const account = await assertSujalRunPodAccount(apiKey);
    if (account.accountIdHash !== SUJAL_RUNPOD_ACCOUNT_ID_SHA256) {
      throw new Error("V207_RUNPOD_ACCOUNT_MISMATCH");
    }
    const baseline = await billingAmount(apiKey);
    const billingThreshold = v207IncrementalSpendThreshold(baseline, finiteCapUsd);
    const spendSnapshotUsd = async (): Promise<number> => {
      const current = await billingAmount(apiKey);
      return v207IncrementalSpendFromBilling(
        baseline,
        current,
        finiteCapUsd,
        "V207_FINITE_CAP_EXCEEDED",
      );
    };
    const control = new RunPodControlClient({ apiKey });
    // Repeat the catalog read in the mutating branch immediately before the first
    // disposable template/endpoint request.  The earlier preflight is diagnostic;
    // this fresh observation is the admission fence for availability and rate drift.
    const selectedCatalogOffering = assertV207FreshCatalogOffering(await fetchCp07Catalog(apiKey));
    const placement: RunPodV207Placement = {
      networkVolumeId: VOLUME_ID,
      dataCenterIds: [V207_RUNPOD_REGION],
    };
    const evidence: AnyRecord = {
      schema_version: "videoforge.v2-07-live-qualification/v1",
      started_at: nowIso(),
      approved_finite_spend_cap_usd: finiteCapUsd,
      runpod_account_id_sha256: account.accountIdHash,
      baseline_endpoint_spend_usd: baseline,
      remaining_cumulative_cap_at_start_usd: finiteCapUsd,
      cumulative_billing_threshold_usd: billingThreshold,
      image_digest: IMAGE.slice(IMAGE.indexOf("@") + 1),
      manifest_sha256: MANIFEST,
      volume_id_sha256: VOLUME,
      volume_id_hash: hashText(VOLUME_ID),
      image_attestation: imageAttestation,
      selected_catalog_offering: {
        offering_id: selectedCatalogOffering.offeringId,
        region: selectedCatalogOffering.region,
        availability: selectedCatalogOffering.availability,
        secure_reference_rate_usd_per_hour: selectedCatalogOffering.rateUsdPerHour,
        vram_gb: selectedCatalogOffering.vramGb,
        serverless_flex_rate_usd_per_gpu_hour: V207_SERVERLESS_FLEX_RATE_USD_PER_GPU_HOUR,
        availability_threshold: "LOW-or-better",
      },
      batches: [],
    };
    const runTag = `20260820-${randomBytes(6).toString("hex")}`;
    evidence.run_tag = runTag;
    let latestHarnessEvidence: AnyRecord | null = null;
    const checkpointEvents: AnyRecord[] = [];
    let checkpointWrite: Promise<void> = Promise.resolve();
    const persistCheckpoint = (phase: string, event?: AnyRecord): Promise<void> => {
      if (event) checkpointEvents.push({ phase, ...event });
      evidence.phase = phase;
      evidence.checkpoint_events = checkpointEvents;
      if (latestHarnessEvidence) evidence.harness = latestHarnessEvidence;
      // Two reader reconciliations can report status concurrently. Serialize the atomic replace so
      // one status checkpoint cannot race another through the shared result temp path.
      checkpointWrite = checkpointWrite.then(
        () => writeV207EvidenceCheckpoint(evidence),
        () => writeV207EvidenceCheckpoint(evidence),
      );
      return checkpointWrite;
    };
    const refreshHarnessCheckpoint = async (phase: string): Promise<void> => {
      latestHarnessEvidence = (await harness.evidence()) as unknown as AnyRecord;
      await persistCheckpoint(phase);
    };
    const templateEnvironment = {
      MAGE_MODEL_ROOT: V207_RUNPOD_MODEL_ROOT,
      HF_HUB_OFFLINE: "1",
      TRANSFORMERS_OFFLINE: "1",
      DIFFUSERS_OFFLINE: "1",
      VIDEOFORGE_JOB_SCRATCH_ROOT: V207_JOB_SCRATCH_ROOT,
      VIDEOFORGE_MAGE_WORKER_IMAGE_DIGEST: IMAGE,
      VIDEOFORGE_MAGE_MANIFEST_SHA256: MANIFEST,
      VIDEOFORGE_MAGE_VOLUME_ID_HASH: VOLUME,
      VIDEOFORGE_MAGE_WORKER_TOKEN: workerToken,
      VIDEOFORGE_MAGE_GPU_OFFERING_ID: V207_RUNPOD_GPU,
      RUNPOD_INIT_TIMEOUT: String(V207_RUNPOD_INIT_TIMEOUT_SECONDS),
      VIDEOFORGE_RECEIPT_KEY_ID: receiptKeyId,
      VIDEOFORGE_RECEIPT_SIGNING_KEY_HEX: receiptSecret.toString("hex"),
    } as const;
    const harness = new RunPodV207QualificationHarness({
      control,
      apiKey,
      templateName: V207_TEMPLATE_NAME,
      endpointName: V207_ENDPOINT_NAME,
      imageName: IMAGE,
      containerDiskInGb: 120,
      templateEnvironment,
      placement,
      initialPolicy: {
        workersMin: 0,
        workersMax: 1,
        gpuCount: 1,
        idleTimeout: 5,
        executionTimeoutMs: V207_RUNPOD_EXECUTION_TIMEOUT_MS,
      },
      concurrentReaderPolicy: {
        workersMin: 0,
        workersMax: 2,
        gpuCount: 1,
        idleTimeout: 5,
        executionTimeoutMs: V207_RUNPOD_EXECUTION_TIMEOUT_MS,
      },
      finiteSpendCapUsd: finiteCapUsd,
      spendSnapshotUsd,
      pollIntervalMs: 10_000,
      maxPolls: 180,
      sleep,
      abortCheck: cancellation.throwIfRequested,
      onStatusCheckpoint: async (status) => {
        await persistCheckpoint("status", {
          event: "provider_status",
          status: status.status,
          job_id_hash: status.idHash,
          delay_time_ms: status.delayTimeMs,
          execution_time_ms: status.executionTimeMs,
        });
      },
    });
    let success = false;
    const generatedObjectKeys: string[] = [];
    try {
      await persistCheckpoint("initialized");
      cancellation.throwIfRequested();
      await harness.create();
      console.error("v207:create-ready");
      const createdIdentity = await harness.evidence();
      latestHarnessEvidence = createdIdentity as unknown as AnyRecord;
      if (!createdIdentity.endpointIdHash || !createdIdentity.templateIdHash) {
        throw new Error("V207_CREATED_IDENTITY_MISSING");
      }
      await persistCheckpoint("create");
      const probeAttemptId = `v207-probe-${runTag}`;
      const probe = await createBatch(
        probeAttemptId,
        nonce,
        workerToken,
        32,
        cancellation.throwIfRequested,
        undefined,
        ["scene-01"],
      );
      generatedObjectKeys.push(...probe.objectKeys);
      console.error("v207:probe-ports-ready");
      await persistCheckpoint("probe-ports");
      cancellation.throwIfRequested();
      const probeJob = await harness.dispatchBatch(probe.input);
      console.error("v207:probe-dispatched");
      await persistCheckpoint("probe-dispatch");
      const probeResult = await harness.reconcile(probeJob.id);
      console.error("v207:probe-terminal");
      const probeEvidence = await verifyBatchWithDiagnostic(
        harness,
        probeResult,
        probeAttemptId,
        probe.objectKeys,
        probe.input.outputAuthority.authorities as readonly AnyRecord[],
        probe.planManifest,
        probe.objectKeys.length,
        createdIdentity.endpointIdHash,
        nonce,
        receiptKeyId,
        receiptSecret,
      );
      (evidence.batches as AnyRecord[]).push({ kind: "owned_probe", ...probeEvidence });
      await persistCheckpoint("probe-terminal");
      const probeDurableUnits = probeEvidence.durable_accepted_units;
      if (!Array.isArray(probeDurableUnits) || probeDurableUnits.length !== 1) {
        throw new Error("V207_PROBE_DURABLE_UNITS_INCOMPLETE");
      }
      const probeWorkerProcessIdentity = probeEvidence.worker_process_identity as
        | RunPodV207WorkerProcessIdentity
        | undefined;
      if (!probeWorkerProcessIdentity) {
        throw new Error("V207_PROCESS_REPLACEMENT_WORKER_IDENTITY_UNAVAILABLE");
      }
      // A replacement is not admitted from warm-idle.  The one-item seed must first prove
      // terminal status, empty queue, two stable terminal worker/Pod inventories, and the exact
      // provider worker identity that the signed receipt reported.
      const processReplacementBoundary = await harness.prepareProcessReplacement(
        probeJob.id,
        probeWorkerProcessIdentity,
      );
      await persistCheckpoint("probe-process-replaced-boundary", {
        event: "process_replacement_seed_terminal_scale_zero",
        process_replacement_boundary: processReplacementBoundary,
      });
      // Exercise the real replacement path with one already committed unit.  The replacement
      // envelope still carries all 32 plan items, while its signed item count and fresh PUT
      // authorities cover only the remaining 31.  The worker must read the prior unit through its
      // fresh one-use GET authority and generate exactly the unresolved set.
      const resumeAttemptId = `v207-resume-${runTag}`;
      const priorResumeUnits = probeDurableUnits as readonly RunPodV207AcceptedUnitRecord[];
      const resumeBatch = await createBatch(
        resumeAttemptId,
        nonce,
        workerToken,
        32,
        cancellation.throwIfRequested,
        priorResumeUnits,
      );
      generatedObjectKeys.push(...resumeBatch.objectKeys);
      await persistCheckpoint("resume-ports", {
        event: "replacement_resume_authority_ready",
        prior_unit_count: priorResumeUnits.length,
        unresolved_unit_count: resumeBatch.objectKeys.length,
        resume_manifest_sha256: (
          (resumeBatch.input.input.envelope as AnyRecord).artifacts as AnyRecord
        ).resume_manifest_sha256,
      });
      cancellation.throwIfRequested();
      const resumeJob = await harness.dispatchBatch(resumeBatch.input);
      await persistCheckpoint("resume-dispatch");
      const resumeResult = await harness.reconcile(resumeJob.id);
      const resumeEvidence = await verifyBatchWithDiagnostic(
        harness,
        resumeResult,
        resumeAttemptId,
        resumeBatch.objectKeys,
        resumeBatch.input.outputAuthority.authorities as readonly AnyRecord[],
        resumeBatch.planManifest,
        resumeBatch.objectKeys.length,
        createdIdentity.endpointIdHash,
        nonce,
        receiptKeyId,
        receiptSecret,
      );
      const resumeWorkerProcessIdentity = resumeEvidence.worker_process_identity as
        | RunPodV207WorkerProcessIdentity
        | undefined;
      if (!resumeWorkerProcessIdentity) {
        throw new Error("V207_PROCESS_REPLACEMENT_WORKER_IDENTITY_UNAVAILABLE");
      }
      harness.assertProcessReplacementIdentity(
        processReplacementBoundary,
        resumeWorkerProcessIdentity,
      );
      const mergedResumeUnits = mergeV207AcceptedUnits(
        priorResumeUnits,
        resumeEvidence.durable_accepted_units as readonly RunPodV207AcceptedUnitRecord[],
        resumeBatch.planManifest,
      );
      if (mergedResumeUnits.length !== 32) throw new Error("V207_RESUME_MERGE_INCOMPLETE");
      (evidence.batches as AnyRecord[]).push({
        kind: "process_replacement_resume",
        ...resumeEvidence,
        prior_unit_count: priorResumeUnits.length,
        new_unit_count: resumeEvidence.durable_accepted_units.length,
        merged_unit_count: mergedResumeUnits.length,
        process_replacement_boundary: processReplacementBoundary,
        seed_worker_process_identity: probeWorkerProcessIdentity,
        replacement_worker_process_identity: resumeWorkerProcessIdentity,
        durable_units: mergedResumeUnits,
      });
      await persistCheckpoint("resume-terminal");
      await harness.confirmWarmIdle();
      await persistCheckpoint("probe-warm-idle");
      const coldAttemptId = `v207-cold-${runTag}`;
      const cold = await createBatch(
        coldAttemptId,
        nonce,
        workerToken,
        32,
        cancellation.throwIfRequested,
      );
      generatedObjectKeys.push(...cold.objectKeys);
      console.error("v207:cold-ports-ready");
      await persistCheckpoint("cold-ports");
      cancellation.throwIfRequested();
      const coldJob = await harness.dispatchBatch(cold.input);
      console.error("v207:cold-dispatched");
      await persistCheckpoint("cold-dispatch");
      const coldResult = await harness.reconcile(coldJob.id);
      console.error("v207:cold-terminal");
      const coldEvidence = await verifyBatchWithDiagnostic(
        harness,
        coldResult,
        coldAttemptId,
        cold.objectKeys,
        cold.input.outputAuthority.authorities as readonly AnyRecord[],
        cold.planManifest,
        32,
        createdIdentity.endpointIdHash,
        nonce,
        receiptKeyId,
        receiptSecret,
      );
      (evidence.batches as AnyRecord[]).push({ kind: "cold", ...coldEvidence });
      await persistCheckpoint("cold-terminal");
      const duplicate = await harness.dispatchBatch(cold.input);
      if (duplicate.id !== coldJob.id) throw new Error("V207_DUPLICATE_DELIVERY_NOT_FENCED");
      evidence.duplicate_delivery_same_job = true;
      await harness.confirmWarmIdle();
      await persistCheckpoint("cold-warm-idle");
      const warmAttemptId = `v207-warm-${runTag}`;
      const warm = await createBatch(
        warmAttemptId,
        nonce,
        workerToken,
        32,
        cancellation.throwIfRequested,
      );
      generatedObjectKeys.push(...warm.objectKeys);
      console.error("v207:warm-ports-ready");
      await persistCheckpoint("warm-ports");
      cancellation.throwIfRequested();
      const warmJob = await harness.dispatchBatch(warm.input);
      await persistCheckpoint("warm-dispatch");
      const warmResult = await harness.reconcile(warmJob.id);
      console.error("v207:warm-terminal");
      const warmEvidence = await verifyBatchWithDiagnostic(
        harness,
        warmResult,
        warmAttemptId,
        warm.objectKeys,
        warm.input.outputAuthority.authorities as readonly AnyRecord[],
        warm.planManifest,
        32,
        createdIdentity.endpointIdHash,
        nonce,
        receiptKeyId,
        receiptSecret,
      );
      (evidence.batches as AnyRecord[]).push({ kind: "warm", ...warmEvidence });
      await persistCheckpoint("warm-terminal");
      await harness.confirmWarmIdle();
      harness.markInitialQualificationComplete();
      const cancel = await createBatch(
        `v207-cancel-${runTag}`,
        nonce,
        workerToken,
        32,
        cancellation.throwIfRequested,
      );
      generatedObjectKeys.push(...cancel.objectKeys);
      await persistCheckpoint("cancel-ports");
      cancellation.throwIfRequested();
      const cancelJob = await harness.dispatchBatch(cancel.input);
      await persistCheckpoint("cancel-dispatch");
      const cancelled = await harness.cancel(cancelJob.id);
      if (cancelled.status !== "CANCELLED") throw new Error("V207_CANCEL_UNCONFIRMED");
      evidence.cancel_status = cancelled.status;
      await deleteGeneratedObjects(cancel.objectKeys, nonce);
      evidence.cancel_output_cleanup = "CONFIRMED";
      await persistCheckpoint("cancel-terminal");
      await harness.scaleDownToInitial();

      // Deliberately own one separate timeout attempt under the approved max-one endpoint. The
      // provider must report its exact terminal TIMED_OUT state; a local reconciliation timeout,
      // FAILED result, or successful output is not substituted for this proof and fails closed.
      const timeoutAttemptId = `v207-timeout-${runTag}`;
      const timeout = await createBatch(
        timeoutAttemptId,
        nonce,
        workerToken,
        32,
        cancellation.throwIfRequested,
      );
      generatedObjectKeys.push(...timeout.objectKeys);
      await persistCheckpoint("timeout-ports");
      cancellation.throwIfRequested();
      const timeoutJob = await harness.dispatchTimeoutBatch(timeout.input);
      await persistCheckpoint("timeout-dispatch");
      const timeoutResult = await harness.reconcile(timeoutJob.id);
      evidence.timeout_status = timeoutResult.status;
      await persistCheckpoint("timeout-terminal", {
        event: "provider_timeout_terminal",
        status: timeoutResult.status,
        job_id_hash: timeoutResult.idHash,
      });
      if (timeoutResult.status !== "TIMED_OUT") {
        throw new Error("V207_TIMEOUT_NOT_OBSERVED");
      }
      await deleteGeneratedObjects(timeout.objectKeys, nonce);
      evidence.timeout_output_cleanup = "CONFIRMED";
      await persistCheckpoint("timeout-output-cleanup");
      await harness.scaleDownToInitial();

      // The separately hashed max-two reader policy is the final GPU phase. Both complete
      // 32-item batches run only after the max-one probe/cold/warm/duplicate/cancel/timeout
      // sequence. Their independently signed receipts must each prove the exact sealed manifest
      // before and after inference, so they jointly provide the terminal sealed-model attestation.
      // After their reconciliation, only max-one restoration, drain, cleanup, and read-only final
      // reconciliation are permitted; no later GPU job is dispatched.
      cancellation.throwIfRequested();
      evidence.concurrent_config_sha256 = await harness.applyConcurrentReaderPolicy();
      await refreshHarnessCheckpoint("concurrent-policy");
      const readerAAttemptId = `v207-reader-a-${runTag}`;
      const readerBAttemptId = `v207-reader-b-${runTag}`;
      const readerA = await createBatch(
        readerAAttemptId,
        nonce,
        workerToken,
        32,
        cancellation.throwIfRequested,
      );
      generatedObjectKeys.push(...readerA.objectKeys);
      const readerB = await createBatch(
        readerBAttemptId,
        nonce,
        workerToken,
        32,
        cancellation.throwIfRequested,
      );
      generatedObjectKeys.push(...readerB.objectKeys);
      await persistCheckpoint("reader-ports");
      const readerJobs = await harness.dispatchConcurrentReaders([readerA.input, readerB.input]);
      await persistCheckpoint("reader-dispatch");
      const readerResults = await harness.reconcileConcurrentReaders([
        readerJobs[0].id,
        readerJobs[1].id,
      ]);
      const readerEvidenceA = await verifyBatchWithDiagnostic(
        harness,
        readerResults[0],
        readerAAttemptId,
        readerA.objectKeys,
        readerA.input.outputAuthority.authorities as readonly AnyRecord[],
        readerA.planManifest,
        32,
        createdIdentity.endpointIdHash,
        nonce,
        receiptKeyId,
        receiptSecret,
      );
      const readerEvidenceB = await verifyBatchWithDiagnostic(
        harness,
        readerResults[1],
        readerBAttemptId,
        readerB.objectKeys,
        readerB.input.outputAuthority.authorities as readonly AnyRecord[],
        readerB.planManifest,
        32,
        createdIdentity.endpointIdHash,
        nonce,
        receiptKeyId,
        receiptSecret,
      );
      (evidence.batches as AnyRecord[]).push({
        kind: "reader_a",
        terminal_sealed_model_attestation: true,
        ...readerEvidenceA,
      });
      (evidence.batches as AnyRecord[]).push({
        kind: "reader_b",
        terminal_sealed_model_attestation: true,
        ...readerEvidenceB,
      });
      evidence.terminal_sealed_model_attestation = {
        status: "CONFIRMED",
        after_timeout: true,
        manifest_sha256: MANIFEST,
        reader_receipt_sha256: [readerEvidenceA.receipt_sha256, readerEvidenceB.receipt_sha256],
      };
      evidence.no_gpu_action_after_terminal_attestation = true;
      await persistCheckpoint("reader-terminal-attestation");
      await harness.drain();
      cancellation.throwIfRequested();
      await harness.scaleDownToInitial();
      await persistCheckpoint("reader-drained");
      await harness.cleanup({ deleteIfFailed: false, failed: false });
      // The success reconciler intentionally retains the exact endpoint/template and proves
      // three stable inventory/resource/billing snapshots. Its zero-worker/terminal-Pod checks
      // replace the former single finalInventory/V207_FINAL_INVENTORY_INVALID assertion.
      const finalReconciliation = await reconcileV207SuccessReadonly({
        accountIdHash: account.accountIdHash,
        baselineEndpointSpendUsd: baseline,
        maximumCumulativeFiniteSpendUsd: finiteCapUsd,
        expectedEndpointIdHash: createdIdentity.endpointIdHash,
        expectedTemplateIdHash: createdIdentity.templateIdHash,
        expectedConfiguration: {
          endpointName: V207_ENDPOINT_NAME,
          templateName: V207_TEMPLATE_NAME,
          imageName: IMAGE,
          containerDiskInGb: 120,
          networkVolumeId: placement.networkVolumeId,
          environment: {
            LOG_LEVEL: "INFO",
            ...templateEnvironment,
            VIDEOFORGE_MAGE_ENDPOINT_ID_HASH: createdIdentity.endpointIdHash,
          },
        },
        inventory: () => control.inventory(),
        resources: () => control.inventoryDisposableResources(),
        queueEmpty: () => harness.confirmQueueEmptyReadOnly(1, 100),
        billingAmount: () => billingAmount(apiKey),
        wait: sleep,
      });
      evidence.final_reconciliation = finalReconciliation;
      evidence.final_inventory = finalReconciliation.inventory;
      evidence.spend_usd = finalReconciliation.billing.incremental_spend_usd;
      evidence.cumulative_endpoint_spend_usd = finalReconciliation.billing.final_endpoint_spend_usd;
      evidence.billing_settlement = finalReconciliation.billing.settlement;
      success = true;
    } catch (error) {
      const outputContractDiagnostics = extractV207OutputContractDiagnostics(error);
      if (outputContractDiagnostics) Object.assign(evidence, outputContractDiagnostics);
      evidence.error = safeQualificationError(error);
      const errorCategory = extractV207EndpointReadbackMismatchCategory(error);
      if (errorCategory !== null) evidence.error_category = errorCategory;
      try {
        await deleteGeneratedObjects(generatedObjectKeys, nonce);
        evidence.generated_output_rollback = "CONFIRMED";
      } catch (rollbackError) {
        evidence.generated_output_rollback = "UNCERTAIN";
        evidence.generated_output_rollback_error = safeQualificationError(rollbackError);
      }
      try {
        await harness.cleanup({ deleteIfFailed: true, failed: true });
      } catch (cleanupError) {
        evidence.cleanup_error = safeQualificationError(cleanupError);
      }
      try {
        const reconciliation = await reconcileV207Readonly({
          accountIdHash: account.accountIdHash,
          baselineEndpointSpendUsd: baseline,
          maximumCumulativeFiniteSpendUsd: finiteCapUsd,
          inventory: () => control.inventory(),
          billingAmount: () => billingAmount(apiKey),
        });
        evidence.failure_reconciliation = reconciliation;
        evidence.spend_usd = reconciliation.billing.incremental_spend_usd;
        evidence.cumulative_endpoint_spend_usd = reconciliation.billing.final_endpoint_spend_usd;
        evidence.billing_settlement = reconciliation.billing.settlement;
      } catch (reconciliationError) {
        evidence.failure_reconciliation_error = safeQualificationError(reconciliationError);
      }
      throw error;
    } finally {
      evidence.finished_at = nowIso();
      evidence.success = success;
      evidence.harness = (await harness.evidence()) as unknown as AnyRecord;
      await writeV207EvidenceCheckpoint(evidence);
    }
  } finally {
    removeSignalHandlers();
  }
}

function safeQualificationError(error: unknown): string {
  if (isV207OutputContractDiagnostic(error)) return "MAGE_OUTPUT_NOT_SUCCEEDED";
  const candidate = error instanceof Error ? error.message : "";
  if (SAFE_PROVIDER_CODE.test(candidate)) return candidate;
  const code = candidate.match(/^[A-Z][A-Z0-9_.-]{2,80}/u)?.[0];
  return code && SAFE_PROVIDER_CODE.test(code) ? code : "V207_QUALIFICATION_FAILED";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    // The orchestrator captures child output, but direct invocation must also remain bounded and
    // must never print provider diagnostics, signed URLs, or credentials.
    console.error(safeQualificationError(error));
    process.exitCode = 1;
  }
}

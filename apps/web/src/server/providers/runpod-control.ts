import { createHash } from "node:crypto";

import { canonicalizeJson, type JsonValue } from "@videoforge/contracts";

const DEFAULT_BASE_URL = "https://rest.runpod.io/v1";
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,190}$/u;
const IMMUTABLE_IMAGE = /^[a-z0-9][a-z0-9./_-]{0,190}@sha256:[a-f0-9]{64}$/u;

/** V2-07 is deliberately pinned to one immutable placement and accelerator. */
export const V207_RUNPOD_REGION = "EU-RO-1" as const;
export const V207_RUNPOD_GPU = "NVIDIA GeForce RTX 4090" as const;
export const V207_RUNPOD_VOLUME_MOUNT = "/runpod-volume" as const;
/** CP-06 sealed the exact Mage marker and weights beneath `mage-model/` on the volume. */
export const V207_RUNPOD_MODEL_ROOT = "/runpod-volume/mage-model" as const;
export const V207_RUNPOD_MAGE_VOLUME_SIZE_GB = 50 as const;
export const V207_RUNPOD_SCALER = "REQUEST_COUNT" as const;
export const V207_RUNPOD_SCALER_VALUE = 1 as const;
export const V207_RUNPOD_IDLE_TIMEOUT_SECONDS = 5 as const;
export const V207_RUNPOD_EXECUTION_TIMEOUT_MS = 2_400_000 as const;
export const V207_RUNPOD_INIT_TIMEOUT_SECONDS = 800 as const;
export const V207_RUNPOD_HANDLER_CONCURRENCY = 1 as const;
export const V207_RUNPOD_REQUEST_AUTHORITY_TTL_SECONDS = 7_200 as const;
/** Attempt 14 proved RunPod creates this Serverless endpoint with FlashBoot enabled. */
export const V207_RUNPOD_FLASHBOOT = true as const;
/** The published Mage image is CUDA 13.0; do not let provider placement fall back to CUDA 12. */
export const V207_RUNPOD_MIN_CUDA_VERSION = "13.0" as const;

/**
 * The deliberate V2-07 timeout negative proof is the only request allowed to override the
 * endpoint execution timeout.  TTL starts at submission, so it must cover the full approved
 * request lifetime even when the worker is queued; the short execution timeout still forces the
 * provider terminal TIMED_OUT result after pickup.
 */
export const V207_TIMEOUT_EXECUTION_TIMEOUT_MS = 5_000 as const;
export const V207_TIMEOUT_TTL_MS = 7_200_000 as const;

export type RunPodV207TimeoutPolicy = Readonly<{
  readonly executionTimeout: typeof V207_TIMEOUT_EXECUTION_TIMEOUT_MS;
  readonly ttl: typeof V207_TIMEOUT_TTL_MS;
}>;

type FetchPort = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type JsonRecord = Readonly<Record<string, unknown>>;

export interface RunPodEndpointPolicy {
  readonly workersMin: 0;
  readonly workersMax: 1;
  readonly gpuCount: 1;
  readonly idleTimeout: number;
  readonly executionTimeoutMs: number;
}

/**
 * The temporary two-reader proof is the sole permitted exception to max=1.
 * Keeping this separate from RunPodEndpointPolicy prevents accidental use in
 * the initial endpoint configuration.
 */
export interface RunPodV207ConcurrentReaderPolicy {
  readonly workersMin: 0;
  readonly workersMax: 2;
  readonly gpuCount: 1;
  readonly idleTimeout: number;
  readonly executionTimeoutMs: number;
}

export interface RunPodV207Placement {
  readonly networkVolumeId: string;
  readonly dataCenterIds: readonly [typeof V207_RUNPOD_REGION];
}

export interface RunPodV207EndpointPolicyReceipt extends JsonRecord {
  readonly schemaVersion: "videoforge.runpod-v207-endpoint-policy-readback/v1";
  readonly endpointIdSha256: string;
  readonly templateIdSha256: string;
  readonly volumeIdSha256: string;
  readonly region: typeof V207_RUNPOD_REGION;
  readonly gpu: typeof V207_RUNPOD_GPU;
  readonly workersMin: 0;
  readonly workersMax: 1 | 2;
  readonly gpuCount: 1;
  readonly idleTimeout: typeof V207_RUNPOD_IDLE_TIMEOUT_SECONDS;
  readonly executionTimeoutMs: typeof V207_RUNPOD_EXECUTION_TIMEOUT_MS;
  readonly scalerType: typeof V207_RUNPOD_SCALER;
  readonly scalerValue: typeof V207_RUNPOD_SCALER_VALUE;
}

export interface RunPodV207EndpointPolicySnapshotExpectation {
  readonly endpointId: string;
  readonly endpointIdSha256: string;
  readonly templateId: string;
  readonly templateIdSha256: string;
  readonly volumeIdSha256: string;
  /** Restore is deliberately retryable after a one-lane partial update. */
  readonly allowedWorkersMax: readonly (1 | 2)[];
}

export interface RunPodInventory {
  readonly checkedAt: string;
  readonly pods: readonly {
    readonly idHash: string;
    readonly desiredStatus: string;
    readonly observedStatuses: readonly string[];
    readonly endpointWorker: boolean;
    readonly endpointIdHash: string | null;
    readonly costPerHourUsd: number | null;
  }[];
  readonly endpoints: readonly {
    readonly idHash: string;
    readonly workersMin: number | null;
    readonly workersMax: number | null;
    readonly workerRecordsReported: boolean;
    readonly workerRecordCount: number;
    readonly activeWorkerCount: number;
    readonly exitedWorkerCount: number;
    readonly workerStatuses: readonly string[];
    readonly scaleZeroCompliant: boolean;
  }[];
  readonly privateTemplateCount: number;
  readonly networkVolumes: readonly {
    readonly idHash: string;
    readonly sizeGb: number | null;
    /** Redacted provider placement identity; null means the read did not prove a region. */
    readonly dataCenterId: string | null;
  }[];
  readonly runningPodCount: number;
  readonly activeServerlessWorkerCount: number;
}

export interface RunPodResourceIdentity {
  readonly id: string;
  readonly idHash: string;
}

/**
 * Redaction-safe categories for the strict post-PATCH endpoint readback.  Categories deliberately
 * contain no provider values, identifiers, or environment contents; they only tell the caller
 * which pinned contract family failed.
 */
export type RunPodV207EndpointReadbackMismatchCategory =
  | "identity"
  | "environment"
  | "flashboot"
  | "region"
  | "cuda"
  | "volume"
  | "gpu"
  | "workers"
  | "timing"
  | "scaler";

/**
 * Raw identities are used only during same-process recovery of an ambiguous create mutation.
 * They never enter persisted qualification evidence; ordinary inventory remains redacted.
 */
export interface RunPodNamedResource {
  readonly id: string;
  readonly name: string;
  readonly raw: JsonRecord;
}

export interface RunPodDisposableResourceInventory {
  readonly templates: readonly RunPodNamedResource[];
  readonly endpoints: readonly RunPodNamedResource[];
}

export class RunPodControlError extends Error {
  constructor(
    readonly code: string,
    readonly category?: RunPodV207EndpointReadbackMismatchCategory,
  ) {
    super(code);
    this.name = "RunPodControlError";
  }
}

const record = (value: unknown): JsonRecord | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;

const numberOrNull = (value: unknown): number | null => {
  if (
    value === null ||
    value === undefined ||
    typeof value === "boolean" ||
    (typeof value === "string" && value.trim() === "")
  ) {
    return null;
  }
  const candidate = typeof value === "number" ? value : Number(value);
  return Number.isFinite(candidate) && candidate >= 0 ? candidate : null;
};

const strictCounter = (source: JsonRecord | null, key: string): number => {
  const candidate = source?.[key];
  return typeof candidate === "number" && Number.isSafeInteger(candidate) && candidate >= 0
    ? candidate
    : Number.NaN;
};

const hashId = (value: string): string =>
  `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;

/** Hash the exact endpoint identity that the worker must echo in its provenance receipt. */
export function hashRunPodV207EndpointIdentity(endpointId: string): string {
  if (!ID.test(endpointId)) throw new RunPodControlError("RUNPOD_ENDPOINT_ID_INVALID");
  return hashId(endpointId);
}

function assertV207TimeoutPolicy(value: unknown): asserts value is RunPodV207TimeoutPolicy {
  const candidate = record(value);
  if (
    !candidate ||
    Object.keys(candidate).length !== 2 ||
    candidate.executionTimeout !== V207_TIMEOUT_EXECUTION_TIMEOUT_MS ||
    candidate.ttl !== V207_TIMEOUT_TTL_MS
  ) {
    throw new RunPodControlError("RUNPOD_TIMEOUT_POLICY_INVALID");
  }
}

/**
 * Hash the exact provider request used to select a V2-07 endpoint.  Provider identifiers may be
 * present while the request is sent, but qualification evidence should persist only this digest.
 */
export function hashRunPodV207EndpointConfiguration(value: JsonValue): string {
  return `sha256:${createHash("sha256").update(canonicalizeJson(value), "utf8").digest("hex")}`;
}

const exactStringArray = (value: unknown, expected: readonly string[]): boolean =>
  Array.isArray(value) &&
  value.length === expected.length &&
  value.every((candidate, index) => candidate === expected[index]);

/**
 * RunPod's REST read shapes omit a few fields that are accepted on create/update (currently
 * computeType and dataCenterIds).  An omitted field is not evidence of drift; an explicitly
 * returned value still has to match the pinned request exactly.
 */
const optionalExactString = (value: unknown, expected: string): boolean =>
  value === undefined || value === expected;
const optionalExactStringArray = (value: unknown, expected: readonly string[]): boolean =>
  value === undefined || exactStringArray(value, expected);

const healthWorkerCounts = (
  workers: JsonRecord | null,
): {
  readonly idle: number;
  readonly running: number;
  readonly initializing: number;
  readonly ready: number;
  readonly throttled: number;
  readonly unhealthy: number;
  readonly total: number;
} => {
  if (!workers) {
    return {
      idle: Number.NaN,
      running: Number.NaN,
      initializing: Number.NaN,
      ready: Number.NaN,
      throttled: Number.NaN,
      unhealthy: Number.NaN,
      total: Number.NaN,
    };
  }
  const idle = strictCounter(workers, "idle");
  const running = strictCounter(workers, "running");
  const initializing = strictCounter(workers, "initializing");
  const ready = strictCounter(workers, "ready");
  const throttled = strictCounter(workers, "throttled");
  const unhealthy = strictCounter(workers, "unhealthy");
  return {
    idle,
    running,
    initializing,
    ready,
    throttled,
    unhealthy,
    total: idle + running + initializing + ready + throttled + unhealthy,
  };
};

export function assertRunPodEndpointPolicy(value: RunPodEndpointPolicy): void {
  if (
    value.workersMin !== 0 ||
    value.workersMax !== 1 ||
    value.gpuCount !== 1 ||
    !Number.isSafeInteger(value.idleTimeout) ||
    value.idleTimeout < 1 ||
    value.idleTimeout > 60 ||
    !Number.isSafeInteger(value.executionTimeoutMs) ||
    value.executionTimeoutMs < 1_000 ||
    value.executionTimeoutMs > 3_600_000
  ) {
    throw new RunPodControlError("RUNPOD_SCALE_ZERO_POLICY_INVALID");
  }
}

export function assertRunPodV207ConcurrentReaderPolicy(
  value: RunPodV207ConcurrentReaderPolicy,
): void {
  if (
    value.workersMin !== 0 ||
    value.workersMax !== 2 ||
    value.gpuCount !== 1 ||
    !Number.isSafeInteger(value.idleTimeout) ||
    value.idleTimeout < 1 ||
    value.idleTimeout > 60 ||
    !Number.isSafeInteger(value.executionTimeoutMs) ||
    value.executionTimeoutMs < 1_000 ||
    value.executionTimeoutMs > 3_600_000
  ) {
    throw new RunPodControlError("RUNPOD_CONCURRENT_READER_POLICY_INVALID");
  }
}

const assertV207Placement = (placement: RunPodV207Placement): void => {
  if (
    !ID.test(placement.networkVolumeId) ||
    !exactStringArray(placement.dataCenterIds, [V207_RUNPOD_REGION])
  ) {
    throw new RunPodControlError("RUNPOD_ENDPOINT_PLACEMENT_INVALID");
  }
};

const expectedV207EndpointEnvironment = (
  endpointId: string,
  environment: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> => {
  const endpointIdHash = hashRunPodV207EndpointIdentity(endpointId);
  if (
    (environment.LOG_LEVEL !== undefined && environment.LOG_LEVEL !== "INFO") ||
    (environment.RUNPOD_INIT_TIMEOUT !== undefined &&
      environment.RUNPOD_INIT_TIMEOUT !== String(V207_RUNPOD_INIT_TIMEOUT_SECONDS)) ||
    (environment.VIDEOFORGE_MAGE_ENDPOINT_ID_HASH !== undefined &&
      environment.VIDEOFORGE_MAGE_ENDPOINT_ID_HASH !== endpointIdHash)
  ) {
    throw new RunPodControlError("RUNPOD_ENDPOINT_ID_BINDING_ENVIRONMENT_INVALID");
  }
  return Object.freeze({
    LOG_LEVEL: "INFO",
    RUNPOD_INIT_TIMEOUT: String(V207_RUNPOD_INIT_TIMEOUT_SECONDS),
    ...environment,
    VIDEOFORGE_MAGE_ENDPOINT_ID_HASH: endpointIdHash,
  });
};

const exactEnvironmentMatches = (
  value: unknown,
  expected: Readonly<Record<string, string>>,
): boolean => {
  const actual = record(value);
  return (
    actual !== null &&
    Object.keys(actual).length === Object.keys(expected).length &&
    Object.entries(expected).every(([key, expectedValue]) => actual[key] === expectedValue)
  );
};

const v207EndpointConfigMismatchCategory = (
  value: JsonRecord | null,
  expected: {
    readonly endpointId: string;
    readonly templateId: string;
    readonly policy: RunPodEndpointPolicy;
    readonly placement: RunPodV207Placement;
  },
): RunPodV207EndpointReadbackMismatchCategory | null => {
  if (value?.id !== expected.endpointId || value.templateId !== expected.templateId) {
    return "identity";
  }
  if (
    (value.computeType !== undefined && value.computeType !== "GPU") ||
    value.gpuCount !== expected.policy.gpuCount ||
    !exactStringArray(value.gpuTypeIds, [V207_RUNPOD_GPU])
  ) {
    return "gpu";
  }
  if (
    value.workersMin !== expected.policy.workersMin ||
    value.workersMax !== expected.policy.workersMax
  ) {
    return "workers";
  }
  if (
    !exactStringArray(value.allowedCudaVersions, [V207_RUNPOD_MIN_CUDA_VERSION]) ||
    value.minCudaVersion !== V207_RUNPOD_MIN_CUDA_VERSION
  ) {
    return "cuda";
  }
  if (value.flashboot !== V207_RUNPOD_FLASHBOOT) {
    return "flashboot";
  }
  const networkVolumeIds = value?.networkVolumeIds;
  const volumeBindingMatches =
    value?.networkVolumeId === expected.placement.networkVolumeId &&
    (networkVolumeIds === undefined ||
      exactStringArray(networkVolumeIds, [expected.placement.networkVolumeId]));
  if (!volumeBindingMatches) return "volume";
  if (!optionalExactStringArray(value.dataCenterIds, [V207_RUNPOD_REGION])) {
    return "region";
  }
  if (
    value.idleTimeout !== expected.policy.idleTimeout ||
    value.executionTimeoutMs !== expected.policy.executionTimeoutMs
  ) {
    return "timing";
  }
  if (value.scalerType !== V207_RUNPOD_SCALER || value.scalerValue !== V207_RUNPOD_SCALER_VALUE) {
    return "scaler";
  }
  return null;
};

/**
 * Classify a strict endpoint GET readback without retaining or exposing provider response data.
 * The first failing contract family wins deterministically; all categories are bounded literals.
 */
export function classifyRunPodV207EndpointReadbackMismatch(
  value: JsonRecord | null,
  expected: {
    readonly endpointId: string;
    readonly templateId: string;
    readonly policy: RunPodEndpointPolicy;
    readonly placement: RunPodV207Placement;
    readonly environment: Readonly<Record<string, string>>;
    /** The template GET proved the exact environment before endpoint readback. */
    readonly templateEnvironmentVerified?: boolean;
  },
): RunPodV207EndpointReadbackMismatchCategory | null {
  const configCategory = v207EndpointConfigMismatchCategory(value, expected);
  if (configCategory !== null) return configCategory;
  if (value?.env === undefined) {
    return expected.templateEnvironmentVerified === true ? null : "environment";
  }
  return exactEnvironmentMatches(value.env, expected.environment) ? null : "environment";
}

const matchesIfPresent = (value: unknown, expected: unknown): boolean =>
  value === undefined || value === expected;

const exactStringArrayIfPresent = (value: unknown, expected: readonly string[]): boolean =>
  value === undefined || exactStringArray(value, expected);

/**
 * RunPod may acknowledge an endpoint PATCH with only the endpoint identity. Treat omitted fields as
 * unconfirmed until the mandatory GET, but fail closed if any returned field contradicts the exact
 * staged configuration.
 */
const v207EndpointPatchAcknowledgementMatches = (
  value: JsonRecord | null,
  expected: {
    readonly endpointId: string;
    readonly templateId: string;
    readonly policy: RunPodEndpointPolicy;
    readonly placement: RunPodV207Placement;
    readonly environment: Readonly<Record<string, string>>;
  },
): boolean =>
  value?.id === expected.endpointId &&
  matchesIfPresent(value.templateId, expected.templateId) &&
  matchesIfPresent(value.computeType, "GPU") &&
  matchesIfPresent(value.workersMin, expected.policy.workersMin) &&
  matchesIfPresent(value.workersMax, expected.policy.workersMax) &&
  matchesIfPresent(value.gpuCount, expected.policy.gpuCount) &&
  exactStringArrayIfPresent(value.gpuTypeIds, [V207_RUNPOD_GPU]) &&
  exactStringArrayIfPresent(value.allowedCudaVersions, [V207_RUNPOD_MIN_CUDA_VERSION]) &&
  matchesIfPresent(value.minCudaVersion, V207_RUNPOD_MIN_CUDA_VERSION) &&
  matchesIfPresent(value.flashboot, V207_RUNPOD_FLASHBOOT) &&
  matchesIfPresent(value.networkVolumeId, expected.placement.networkVolumeId) &&
  exactStringArrayIfPresent(value.networkVolumeIds, [expected.placement.networkVolumeId]) &&
  exactStringArrayIfPresent(value.dataCenterIds, [V207_RUNPOD_REGION]) &&
  matchesIfPresent(value.idleTimeout, expected.policy.idleTimeout) &&
  matchesIfPresent(value.executionTimeoutMs, expected.policy.executionTimeoutMs) &&
  matchesIfPresent(value.scalerType, V207_RUNPOD_SCALER) &&
  matchesIfPresent(value.scalerValue, V207_RUNPOD_SCALER_VALUE) &&
  (value.env === undefined || exactEnvironmentMatches(value.env, expected.environment));

export class RunPodDrainGuard {
  private state:
    | "unknown"
    | "active"
    | "warm_idle"
    | "quiescent"
    | "draining"
    | "queue_empty"
    | "zero" = "unknown";

  markActive(): void {
    this.state = "active";
  }

  beginDrain(): void {
    if (this.state !== "active" && this.state !== "warm_idle") {
      throw new RunPodControlError("RUNPOD_DRAIN_STATE_INVALID");
    }
    this.state = "draining";
  }

  confirmWarmIdle(
    idleWorkerCount: number,
    runningWorkerCount: number,
    queuedJobCount: number,
  ): void {
    if (
      this.state !== "active" ||
      !Number.isSafeInteger(idleWorkerCount) ||
      !Number.isSafeInteger(runningWorkerCount) ||
      !Number.isSafeInteger(queuedJobCount) ||
      idleWorkerCount < 0 ||
      idleWorkerCount > 1 ||
      runningWorkerCount !== 0 ||
      queuedJobCount !== 0
    ) {
      this.state = "unknown";
      throw new RunPodControlError("RUNPOD_WARM_IDLE_NOT_CONFIRMED");
    }
    this.state = "warm_idle";
  }

  confirmQuiescent(
    idleWorkerCount: number,
    readyWorkerCount: number,
    throttledWorkerCount: number,
    runningWorkerCount: number,
    initializingWorkerCount: number,
    unhealthyWorkerCount: number,
    queuedJobCount: number,
  ): void {
    if (
      (this.state !== "active" &&
        this.state !== "unknown" &&
        this.state !== "queue_empty" &&
        this.state !== "quiescent") ||
      !Number.isSafeInteger(idleWorkerCount) ||
      !Number.isSafeInteger(readyWorkerCount) ||
      !Number.isSafeInteger(throttledWorkerCount) ||
      !Number.isSafeInteger(runningWorkerCount) ||
      !Number.isSafeInteger(initializingWorkerCount) ||
      !Number.isSafeInteger(unhealthyWorkerCount) ||
      !Number.isSafeInteger(queuedJobCount) ||
      idleWorkerCount < 0 ||
      idleWorkerCount > 1 ||
      readyWorkerCount < 0 ||
      readyWorkerCount > 1 ||
      throttledWorkerCount < 0 ||
      throttledWorkerCount > 1 ||
      idleWorkerCount + readyWorkerCount + throttledWorkerCount > 1 ||
      runningWorkerCount !== 0 ||
      initializingWorkerCount !== 0 ||
      unhealthyWorkerCount !== 0 ||
      queuedJobCount !== 0
    ) {
      this.state = "unknown";
      throw new RunPodControlError("RUNPOD_QUIESCENT_NOT_CONFIRMED");
    }
    // Quiescent is deliberately policy-update-only: a throttled worker may exist, but no job
    // dispatch can be admitted until a normal warm-idle or zero state is re-established.
    this.state = "quiescent";
  }

  confirmZero(activeWorkerCount: number, queuedJobCount: number): void {
    if (
      !Number.isSafeInteger(activeWorkerCount) ||
      !Number.isSafeInteger(queuedJobCount) ||
      activeWorkerCount !== 0 ||
      queuedJobCount !== 0
    ) {
      this.state = "unknown";
      throw new RunPodControlError("RUNPOD_ZERO_NOT_CONFIRMED");
    }
    this.state = "zero";
  }

  invalidate(): void {
    this.state = "unknown";
  }

  confirmQueueEmpty(queuedJobCount: number): void {
    if (
      this.state !== "draining" ||
      !Number.isSafeInteger(queuedJobCount) ||
      queuedJobCount !== 0
    ) {
      this.state = "unknown";
      throw new RunPodControlError("RUNPOD_QUEUE_NOT_DRAINED");
    }
    this.state = "queue_empty";
  }

  assertDispatchAllowed(): void {
    if (this.state !== "zero" && this.state !== "warm_idle") {
      throw new RunPodControlError("RUNPOD_DISPATCH_BLOCKED");
    }
  }

  assertPolicyUpdateAllowed(): void {
    if (this.state !== "zero" && this.state !== "warm_idle" && this.state !== "quiescent") {
      throw new RunPodControlError("RUNPOD_POLICY_UPDATE_BLOCKED");
    }
  }

  assertTerminationAllowed(): void {
    if (this.state !== "queue_empty" && this.state !== "quiescent" && this.state !== "zero") {
      throw new RunPodControlError("RUNPOD_TERMINATION_BLOCKED");
    }
  }

  snapshot(): string {
    return this.state;
  }
}

export interface RunPodControlClientOptions {
  readonly apiKey: string;
  readonly fetch?: FetchPort;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  /** Bounded retry delays for idempotent inventory GET transport ambiguity only. */
  readonly inventoryReadRetryDelaysMs?: readonly number[];
  /** Test-only clock injection for the bounded inventory retry. */
  readonly inventorySleep?: (milliseconds: number) => Promise<void>;
}

const DEFAULT_INVENTORY_READ_RETRY_DELAYS_MS = Object.freeze([250, 1_000, 2_000]);

export class RunPodControlClient {
  private readonly fetch: FetchPort;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly inventoryReadRetryDelaysMs: readonly number[];
  private readonly inventorySleep: (milliseconds: number) => Promise<void>;

  constructor(private readonly options: RunPodControlClientOptions) {
    if (options.apiKey.trim() !== options.apiKey || options.apiKey.length < 20) {
      throw new RunPodControlError("RUNPOD_AUTH_INVALID");
    }
    this.fetch = options.fetch ?? fetch;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    if (this.baseUrl !== DEFAULT_BASE_URL && !this.baseUrl.startsWith("http://127.0.0.1:")) {
      throw new RunPodControlError("RUNPOD_BASE_URL_INVALID");
    }
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 120_000) {
      throw new RunPodControlError("RUNPOD_TIMEOUT_INVALID");
    }
    this.inventoryReadRetryDelaysMs = Object.freeze([
      ...(options.inventoryReadRetryDelaysMs ?? DEFAULT_INVENTORY_READ_RETRY_DELAYS_MS),
    ]);
    this.inventorySleep =
      options.inventorySleep ??
      ((milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds)));
    if (
      this.inventoryReadRetryDelaysMs.length > 4 ||
      this.inventoryReadRetryDelaysMs.some(
        (delay) => !Number.isSafeInteger(delay) || delay < 0 || delay > 10_000,
      )
    ) {
      throw new RunPodControlError("RUNPOD_READ_RETRY_POLICY_INVALID");
    }
  }

  private async read(path: string): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetch(`${this.baseUrl}${path}`, {
        headers: { authorization: `Bearer ${this.options.apiKey}` },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new RunPodControlError("RUNPOD_READ_AMBIGUOUS");
    }
    if (!response.ok) {
      throw new RunPodControlError(
        response.status === 401 || response.status === 403
          ? "RUNPOD_AUTH_REJECTED"
          : "RUNPOD_READ_FAILED",
      );
    }
    try {
      return JSON.parse(await response.text());
    } catch {
      throw new RunPodControlError("RUNPOD_RESPONSE_INVALID");
    }
  }

  /**
   * Inventory is a read-only snapshot assembled from independent GETs. A transport ambiguity
   * cannot have caused a mutation, so retry that one GET a bounded number of times; do not retry
   * auth, malformed responses, or any mutation/readback path.
   */
  private async readInventory(path: string): Promise<unknown> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.read(path);
      } catch (error) {
        const retryable =
          error instanceof RunPodControlError && error.code === "RUNPOD_READ_AMBIGUOUS";
        if (!retryable || attempt >= this.inventoryReadRetryDelaysMs.length) throw error;
        await this.inventorySleep(this.inventoryReadRetryDelaysMs[attempt]!);
      }
    }
  }

  private async mutate(
    method: "POST" | "PATCH" | "DELETE",
    path: string,
    body?: string,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new RunPodControlError("RUNPOD_MUTATION_AMBIGUOUS");
    }
    if (!response.ok) throw new RunPodControlError("RUNPOD_MUTATION_FAILED");
    if (response.status === 204) return null;
    try {
      return JSON.parse(await response.text());
    } catch {
      throw new RunPodControlError("RUNPOD_RESPONSE_INVALID");
    }
  }

  async enforceEndpointPolicy(
    endpointId: string,
    policy: RunPodEndpointPolicy,
    guard: RunPodDrainGuard,
  ): Promise<void> {
    if (!ID.test(endpointId)) throw new RunPodControlError("RUNPOD_ENDPOINT_ID_INVALID");
    assertRunPodEndpointPolicy(policy);
    guard.assertDispatchAllowed();
    const request = {
      ...policy,
      allowedCudaVersions: [V207_RUNPOD_MIN_CUDA_VERSION],
      minCudaVersion: V207_RUNPOD_MIN_CUDA_VERSION,
      scalerType: V207_RUNPOD_SCALER,
      scalerValue: V207_RUNPOD_SCALER_VALUE,
    } as const;
    const value = record(
      await this.mutate("POST", `/endpoints/${endpointId}/update`, canonicalizeJson(request)),
    );
    if (
      !value ||
      value.id !== endpointId ||
      value.workersMin !== 0 ||
      value.workersMax !== 1 ||
      value.gpuCount !== 1 ||
      !exactStringArray(value.gpuTypeIds, [V207_RUNPOD_GPU]) ||
      value.scalerType !== V207_RUNPOD_SCALER ||
      value.scalerValue !== V207_RUNPOD_SCALER_VALUE
    ) {
      throw new RunPodControlError("RUNPOD_SCALE_ZERO_UNCONFIRMED");
    }
  }

  async createServerlessTemplate(
    name: string,
    imageName: string,
    containerDiskInGb: number,
    environment: Readonly<Record<string, string>> = {},
    strictV207 = false,
  ): Promise<RunPodResourceIdentity> {
    if (!ID.test(name) || !IMMUTABLE_IMAGE.test(imageName)) {
      throw new RunPodControlError("RUNPOD_TEMPLATE_INPUT_INVALID");
    }
    if (
      strictV207 &&
      ((environment.LOG_LEVEL !== undefined && environment.LOG_LEVEL !== "INFO") ||
        (environment.RUNPOD_INIT_TIMEOUT !== undefined &&
          environment.RUNPOD_INIT_TIMEOUT !== String(V207_RUNPOD_INIT_TIMEOUT_SECONDS)))
    ) {
      throw new RunPodControlError("RUNPOD_TEMPLATE_ENVIRONMENT_INVALID");
    }
    if (
      !Number.isSafeInteger(containerDiskInGb) ||
      containerDiskInGb < 80 ||
      containerDiskInGb > 120 ||
      (strictV207 && containerDiskInGb !== 120) ||
      (strictV207 &&
        !/^ghcr\.io\/pala-lakshmansai\/videoforge-mage-v2-07@sha256:[a-f0-9]{64}$/u.test(imageName))
    ) {
      throw new RunPodControlError("RUNPOD_TEMPLATE_DISK_INVALID");
    }
    const request = {
      category: "NVIDIA",
      containerDiskInGb,
      dockerEntrypoint: [],
      dockerStartCmd: [],
      env: { LOG_LEVEL: "INFO", RUNPOD_INIT_TIMEOUT: "800", ...environment },
      imageName,
      isPublic: false,
      isServerless: true,
      name,
      ports: [],
      readme: "VideoForge pinned primary avatar worker",
      volumeInGb: 0,
      volumeMountPath: V207_RUNPOD_VOLUME_MOUNT,
    } as const;
    const value = record(await this.mutate("POST", "/templates", canonicalizeJson(request)));
    // RunPod's template API reports its generic Pod mount (`/workspace`) even for a
    // Serverless template. The attached Serverless network volume is independently
    // documented and verified at `/runpod-volume` on the endpoint.
    const responseEnvironment = record(value?.env);
    if (
      !value ||
      typeof value.id !== "string" ||
      !ID.test(value.id) ||
      value.name !== request.name ||
      value.imageName !== request.imageName ||
      value.containerDiskInGb !== request.containerDiskInGb ||
      (value.isPublic !== undefined && value.isPublic !== false) ||
      value.isServerless !== true ||
      (value.volumeInGb !== undefined && value.volumeInGb !== 0) ||
      (value.volumeMountPath !== "/workspace" &&
        value.volumeMountPath !== V207_RUNPOD_VOLUME_MOUNT) ||
      (strictV207 &&
        (!responseEnvironment ||
          responseEnvironment.LOG_LEVEL !== "INFO" ||
          responseEnvironment.RUNPOD_INIT_TIMEOUT !== String(V207_RUNPOD_INIT_TIMEOUT_SECONDS)))
    ) {
      throw new RunPodControlError("RUNPOD_RESPONSE_INVALID");
    }
    return Object.freeze({ id: value.id, idHash: hashId(value.id) });
  }

  /**
   * Update the V2-07 endpoint for the bounded two-reader proof.  This is
   * intentionally separate from enforceEndpointPolicy: max=2 must never be
   * accepted by the initial max=1 path.
   */
  async resolveV207EndpointPlacement(
    expected: RunPodV207EndpointPolicySnapshotExpectation,
  ): Promise<RunPodV207Placement> {
    if (
      !ID.test(expected.endpointId) ||
      !ID.test(expected.templateId) ||
      expected.endpointIdSha256 !== hashId(expected.endpointId) ||
      expected.templateIdSha256 !== hashId(expected.templateId) ||
      !/^sha256:[0-9a-f]{64}$/u.test(expected.volumeIdSha256) ||
      expected.allowedWorkersMax.length < 1 ||
      expected.allowedWorkersMax.length > 2 ||
      new Set(expected.allowedWorkersMax).size !== expected.allowedWorkersMax.length ||
      expected.allowedWorkersMax.some((value) => value !== 1 && value !== 2)
    ) {
      throw new RunPodControlError("RUNPOD_V207_POLICY_SNAPSHOT_INPUT_INVALID");
    }
    const inventory = await this.readInventory(
      "/endpoints?includeTemplate=true&includeWorkers=true",
    );
    if (!Array.isArray(inventory)) {
      throw new RunPodControlError("RUNPOD_V207_POLICY_SNAPSHOT_INVALID");
    }
    const matches = inventory
      .map(record)
      .filter((candidate) => candidate?.id === expected.endpointId);
    if (matches.length !== 1) {
      throw new RunPodControlError("RUNPOD_V207_POLICY_SNAPSHOT_INVALID");
    }
    const endpoint = matches[0]!;
    const networkVolumeIds = endpoint.networkVolumeIds;
    const networkVolumeId =
      typeof endpoint.networkVolumeId === "string" ? endpoint.networkVolumeId : null;
    const exactVolumeIds =
      Array.isArray(networkVolumeIds) &&
      networkVolumeIds.length === 1 &&
      typeof networkVolumeIds[0] === "string"
        ? networkVolumeIds
        : null;
    const resolvedVolumeId = networkVolumeId ?? exactVolumeIds?.[0] ?? null;
    if (
      hashId(expected.endpointId) !== expected.endpointIdSha256 ||
      endpoint.templateId !== expected.templateId ||
      hashId(expected.templateId) !== expected.templateIdSha256 ||
      endpoint.computeType !== "GPU" ||
      endpoint.workersMin !== 0 ||
      !expected.allowedWorkersMax.includes(endpoint.workersMax as 1 | 2) ||
      endpoint.gpuCount !== 1 ||
      !exactStringArray(endpoint.gpuTypeIds, [V207_RUNPOD_GPU]) ||
      !exactStringArray(endpoint.allowedCudaVersions, [V207_RUNPOD_MIN_CUDA_VERSION]) ||
      endpoint.minCudaVersion !== V207_RUNPOD_MIN_CUDA_VERSION ||
      endpoint.flashboot !== V207_RUNPOD_FLASHBOOT ||
      endpoint.idleTimeout !== V207_RUNPOD_IDLE_TIMEOUT_SECONDS ||
      endpoint.executionTimeoutMs !== V207_RUNPOD_EXECUTION_TIMEOUT_MS ||
      endpoint.scalerType !== V207_RUNPOD_SCALER ||
      endpoint.scalerValue !== V207_RUNPOD_SCALER_VALUE ||
      !exactStringArray(endpoint.dataCenterIds, [V207_RUNPOD_REGION]) ||
      !resolvedVolumeId ||
      !ID.test(resolvedVolumeId) ||
      hashId(resolvedVolumeId) !== expected.volumeIdSha256 ||
      (networkVolumeId !== null && networkVolumeId !== resolvedVolumeId) ||
      (exactVolumeIds !== null && exactVolumeIds[0] !== resolvedVolumeId) ||
      (endpoint.networkVolumeId !== undefined && networkVolumeId === null) ||
      (endpoint.networkVolumeIds !== undefined && exactVolumeIds === null)
    ) {
      throw new RunPodControlError("RUNPOD_V207_POLICY_SNAPSHOT_INVALID");
    }
    return Object.freeze({
      networkVolumeId: resolvedVolumeId,
      dataCenterIds: [V207_RUNPOD_REGION] as const,
    });
  }

  async enforceV207EndpointPolicy(
    endpointId: string,
    templateId: string,
    policy: RunPodEndpointPolicy | RunPodV207ConcurrentReaderPolicy,
    placement: RunPodV207Placement,
    guard: RunPodDrainGuard,
  ): Promise<RunPodV207EndpointPolicyReceipt> {
    if (!ID.test(endpointId) || !ID.test(templateId)) {
      throw new RunPodControlError("RUNPOD_ENDPOINT_ID_INVALID");
    }
    if (policy.workersMax === 1) assertRunPodEndpointPolicy(policy);
    else assertRunPodV207ConcurrentReaderPolicy(policy);
    assertV207Placement(placement);
    guard.assertPolicyUpdateAllowed();
    if (
      policy.idleTimeout !== V207_RUNPOD_IDLE_TIMEOUT_SECONDS ||
      policy.executionTimeoutMs !== V207_RUNPOD_EXECUTION_TIMEOUT_MS
    ) {
      throw new RunPodControlError("RUNPOD_V207_TIMING_POLICY_INVALID");
    }
    const request = {
      ...policy,
      dataCenterIds: placement.dataCenterIds,
      gpuCount: 1,
      gpuTypeIds: [V207_RUNPOD_GPU],
      allowedCudaVersions: [V207_RUNPOD_MIN_CUDA_VERSION],
      minCudaVersion: V207_RUNPOD_MIN_CUDA_VERSION,
      flashboot: V207_RUNPOD_FLASHBOOT,
      networkVolumeId: placement.networkVolumeId,
      scalerType: V207_RUNPOD_SCALER,
      scalerValue: V207_RUNPOD_SCALER_VALUE,
    } as const;
    const value = record(
      await this.mutate("POST", `/endpoints/${endpointId}/update`, canonicalizeJson(request)),
    );
    const responseDataCenters = value?.dataCenterIds;
    const responseVolumeIds = value?.networkVolumeIds;
    const volumeBindingMatches =
      (value?.networkVolumeId === undefined ||
        value.networkVolumeId === placement.networkVolumeId) &&
      (responseVolumeIds === undefined ||
        exactStringArray(responseVolumeIds, [placement.networkVolumeId])) &&
      (value?.networkVolumeId === placement.networkVolumeId ||
        exactStringArray(responseVolumeIds, [placement.networkVolumeId]));
    if (
      !value ||
      value.id !== endpointId ||
      value.workersMin !== 0 ||
      value.workersMax !== request.workersMax ||
      value.gpuCount !== 1 ||
      !exactStringArray(value.gpuTypeIds, [V207_RUNPOD_GPU]) ||
      !volumeBindingMatches ||
      !optionalExactStringArray(responseDataCenters, [V207_RUNPOD_REGION]) ||
      !optionalExactString(value.computeType, "GPU") ||
      value.templateId !== templateId ||
      !exactStringArray(value.allowedCudaVersions, [V207_RUNPOD_MIN_CUDA_VERSION]) ||
      value.minCudaVersion !== V207_RUNPOD_MIN_CUDA_VERSION ||
      value.flashboot !== V207_RUNPOD_FLASHBOOT ||
      value.idleTimeout !== request.idleTimeout ||
      value.executionTimeoutMs !== request.executionTimeoutMs ||
      value.scalerType !== V207_RUNPOD_SCALER ||
      value.scalerValue !== V207_RUNPOD_SCALER_VALUE
    ) {
      throw new RunPodControlError("RUNPOD_SCALE_ZERO_UNCONFIRMED");
    }
    return Object.freeze({
      schemaVersion: "videoforge.runpod-v207-endpoint-policy-readback/v1",
      endpointIdSha256: hashId(endpointId),
      templateIdSha256: hashId(templateId),
      volumeIdSha256: hashId(placement.networkVolumeId),
      region: V207_RUNPOD_REGION,
      gpu: V207_RUNPOD_GPU,
      workersMin: 0,
      workersMax: request.workersMax,
      gpuCount: 1,
      idleTimeout: V207_RUNPOD_IDLE_TIMEOUT_SECONDS,
      executionTimeoutMs: V207_RUNPOD_EXECUTION_TIMEOUT_MS,
      scalerType: V207_RUNPOD_SCALER,
      scalerValue: V207_RUNPOD_SCALER_VALUE,
    });
  }

  async createScaleZeroEndpoint(
    name: string,
    templateId: string,
    gpuTypeIds: readonly string[],
    policy: RunPodEndpointPolicy,
    placement: {
      readonly networkVolumeId?: string;
      readonly dataCenterIds?: readonly string[];
    } = {},
    strictV207 = false,
  ): Promise<RunPodResourceIdentity> {
    assertRunPodEndpointPolicy(policy);
    if (
      strictV207 &&
      (policy.idleTimeout !== V207_RUNPOD_IDLE_TIMEOUT_SECONDS ||
        policy.executionTimeoutMs !== V207_RUNPOD_EXECUTION_TIMEOUT_MS)
    ) {
      throw new RunPodControlError("RUNPOD_V207_TIMING_POLICY_INVALID");
    }
    if (
      !ID.test(name) ||
      !ID.test(templateId) ||
      gpuTypeIds.length !== 1 ||
      gpuTypeIds[0] !== V207_RUNPOD_GPU
    ) {
      throw new RunPodControlError("RUNPOD_ENDPOINT_INPUT_INVALID");
    }
    if (gpuTypeIds.some((gpu) => typeof gpu !== "string" || gpu.length > 100)) {
      throw new RunPodControlError("RUNPOD_ENDPOINT_INPUT_INVALID");
    }
    if (
      placement.networkVolumeId === undefined ||
      placement.dataCenterIds === undefined ||
      !ID.test(placement.networkVolumeId) ||
      !exactStringArray(placement.dataCenterIds, [V207_RUNPOD_REGION])
    ) {
      throw new RunPodControlError("RUNPOD_ENDPOINT_PLACEMENT_INVALID");
    }
    const request = {
      computeType: "GPU",
      allowedCudaVersions: [V207_RUNPOD_MIN_CUDA_VERSION],
      executionTimeoutMs: policy.executionTimeoutMs,
      flashboot: strictV207 ? V207_RUNPOD_FLASHBOOT : false,
      gpuCount: policy.gpuCount,
      gpuTypeIds,
      idleTimeout: policy.idleTimeout,
      minCudaVersion: V207_RUNPOD_MIN_CUDA_VERSION,
      name,
      networkVolumeId: placement.networkVolumeId,
      dataCenterIds: placement.dataCenterIds,
      scalerType: V207_RUNPOD_SCALER,
      scalerValue: V207_RUNPOD_SCALER_VALUE,
      templateId,
      workersMax: policy.workersMax,
      workersMin: policy.workersMin,
    } as const;
    const value = record(await this.mutate("POST", "/endpoints", canonicalizeJson(request)));
    const responseDataCenters = value?.dataCenterIds;
    const responseVolumeIds = value?.networkVolumeIds;
    const volumeBindingMatches =
      (value?.networkVolumeId === undefined || value.networkVolumeId === request.networkVolumeId) &&
      (responseVolumeIds === undefined ||
        exactStringArray(responseVolumeIds, [request.networkVolumeId])) &&
      (value?.networkVolumeId === request.networkVolumeId ||
        exactStringArray(responseVolumeIds, [request.networkVolumeId]));
    if (
      !value ||
      typeof value.id !== "string" ||
      !ID.test(value.id) ||
      (strictV207 && !optionalExactString(value.computeType, request.computeType)) ||
      typeof value.templateId !== "string" ||
      !ID.test(value.templateId) ||
      (strictV207 && value.templateId !== request.templateId) ||
      value.gpuCount !== request.gpuCount ||
      !exactStringArray(value.gpuTypeIds, [V207_RUNPOD_GPU]) ||
      !volumeBindingMatches ||
      (strictV207 && !optionalExactStringArray(responseDataCenters, [V207_RUNPOD_REGION])) ||
      (strictV207 &&
        (!exactStringArray(value.allowedCudaVersions, [V207_RUNPOD_MIN_CUDA_VERSION]) ||
          value.minCudaVersion !== V207_RUNPOD_MIN_CUDA_VERSION ||
          value.flashboot !== request.flashboot ||
          value.idleTimeout !== request.idleTimeout ||
          value.executionTimeoutMs !== request.executionTimeoutMs)) ||
      value.workersMin !== 0 ||
      value.workersMax !== request.workersMax ||
      value.scalerType !== V207_RUNPOD_SCALER ||
      value.scalerValue !== V207_RUNPOD_SCALER_VALUE
    ) {
      throw new RunPodControlError("RUNPOD_SCALE_ZERO_UNCONFIRMED");
    }
    return Object.freeze({ id: value.id, idHash: hashId(value.id) });
  }

  /**
   * Bind the endpoint identity into the worker environment after the provider allocates its id.
   * Every documented mutable endpoint field is repeated in the PATCH so a template-environment
   * update cannot silently alter the pinned GPU, volume, region, scaler, or timing policy.
   */
  async bindV207EndpointIdentity(
    endpointId: string,
    templateId: string,
    policy: RunPodEndpointPolicy,
    placement: RunPodV207Placement,
    environment: Readonly<Record<string, string>>,
    guard: RunPodDrainGuard,
  ): Promise<void> {
    if (!ID.test(endpointId) || !ID.test(templateId)) {
      throw new RunPodControlError("RUNPOD_ENDPOINT_ID_INVALID");
    }
    assertRunPodEndpointPolicy(policy);
    assertV207Placement(placement);
    if (
      policy.idleTimeout !== V207_RUNPOD_IDLE_TIMEOUT_SECONDS ||
      policy.executionTimeoutMs !== V207_RUNPOD_EXECUTION_TIMEOUT_MS
    ) {
      throw new RunPodControlError("RUNPOD_V207_TIMING_POLICY_INVALID");
    }
    guard.assertPolicyUpdateAllowed();
    const expectedEnvironment = expectedV207EndpointEnvironment(endpointId, environment);
    const request = {
      allowedCudaVersions: [V207_RUNPOD_MIN_CUDA_VERSION],
      executionTimeoutMs: policy.executionTimeoutMs,
      flashboot: V207_RUNPOD_FLASHBOOT,
      gpuCount: policy.gpuCount,
      gpuTypeIds: [V207_RUNPOD_GPU],
      idleTimeout: policy.idleTimeout,
      minCudaVersion: V207_RUNPOD_MIN_CUDA_VERSION,
      dataCenterIds: placement.dataCenterIds,
      networkVolumeId: placement.networkVolumeId,
      scalerType: V207_RUNPOD_SCALER,
      scalerValue: V207_RUNPOD_SCALER_VALUE,
      templateId,
      workersMax: policy.workersMax,
      workersMin: policy.workersMin,
    } as const;
    const expected = {
      endpointId,
      templateId,
      policy,
      placement,
      environment: expectedEnvironment,
      templateEnvironmentVerified: true,
    };
    await this.updateV207TemplateEnvironment(templateId, expectedEnvironment);
    const responseValue = record(
      await this.mutate("PATCH", `/endpoints/${endpointId}`, canonicalizeJson(request)),
    );
    if (!v207EndpointPatchAcknowledgementMatches(responseValue, expected)) {
      throw new RunPodControlError("RUNPOD_ENDPOINT_ID_BINDING_UNCONFIRMED");
    }
    const readbackValue = record(await this.read(`/endpoints/${endpointId}`));
    const readbackMismatch = classifyRunPodV207EndpointReadbackMismatch(readbackValue, expected);
    if (readbackMismatch !== null) {
      throw new RunPodControlError(
        "RUNPOD_ENDPOINT_ID_BINDING_READBACK_UNCONFIRMED",
        readbackMismatch,
      );
    }
  }

  async createNetworkVolume(
    name: string,
    sizeGb: number,
    dataCenterId: string,
  ): Promise<RunPodResourceIdentity> {
    if (
      !ID.test(name) ||
      !ID.test(dataCenterId) ||
      !Number.isSafeInteger(sizeGb) ||
      sizeGb !== 50
    ) {
      throw new RunPodControlError("RUNPOD_NETWORK_VOLUME_INPUT_INVALID");
    }
    const value = record(
      await this.mutate(
        "POST",
        "/networkvolumes",
        canonicalizeJson({ dataCenterId, name, size: sizeGb }),
      ),
    );
    if (!value || typeof value.id !== "string" || !ID.test(value.id)) {
      throw new RunPodControlError("RUNPOD_RESPONSE_INVALID");
    }
    return Object.freeze({ id: value.id, idHash: hashId(value.id) });
  }

  async deleteNetworkVolume(volumeId: string): Promise<void> {
    if (!ID.test(volumeId)) throw new RunPodControlError("RUNPOD_NETWORK_VOLUME_ID_INVALID");
    await this.mutate("DELETE", `/networkvolumes/${volumeId}`);
  }

  async deleteEndpoint(endpointId: string, guard: RunPodDrainGuard): Promise<void> {
    if (!ID.test(endpointId)) throw new RunPodControlError("RUNPOD_ENDPOINT_ID_INVALID");
    guard.assertTerminationAllowed();
    await this.mutate("DELETE", `/endpoints/${endpointId}`);
  }

  async deleteTemplate(templateId: string): Promise<void> {
    if (!ID.test(templateId)) throw new RunPodControlError("RUNPOD_TEMPLATE_ID_INVALID");
    await this.mutate("DELETE", `/templates/${templateId}`);
  }

  /**
   * RunPod's REST template update accepts the worker environment. Keep this separate from the
   * endpoint PATCH: the endpoint update schema intentionally has no `env` field.
   */
  private async updateV207TemplateEnvironment(
    templateId: string,
    environment: Readonly<Record<string, string>>,
  ): Promise<void> {
    if (!ID.test(templateId)) throw new RunPodControlError("RUNPOD_TEMPLATE_ID_INVALID");
    const value = record(
      await this.mutate(
        "POST",
        `/templates/${templateId}/update`,
        canonicalizeJson({ env: environment }),
      ),
    );
    if (!value || value.id !== templateId || !exactEnvironmentMatches(value.env, environment)) {
      throw new RunPodControlError("RUNPOD_TEMPLATE_ENVIRONMENT_UPDATE_UNCONFIRMED");
    }
    const readbackValue = record(await this.read(`/templates/${templateId}`));
    if (
      !readbackValue ||
      readbackValue.id !== templateId ||
      !exactEnvironmentMatches(readbackValue.env, environment)
    ) {
      throw new RunPodControlError("RUNPOD_TEMPLATE_ENVIRONMENT_UPDATE_UNCONFIRMED");
    }
  }

  async inventory(now = new Date()): Promise<RunPodInventory> {
    if (!Number.isFinite(now.getTime())) throw new RunPodControlError("RUNPOD_CLOCK_INVALID");
    const [podValue, endpointValue, templateValue, volumeValue] = await Promise.all([
      this.readInventory("/pods?includeWorkers=true"),
      this.readInventory("/endpoints?includeTemplate=true&includeWorkers=true"),
      this.readInventory("/templates?includeEndpointBoundTemplates=true"),
      this.readInventory("/networkvolumes"),
    ]);
    if (
      !Array.isArray(podValue) ||
      !Array.isArray(endpointValue) ||
      !Array.isArray(templateValue) ||
      !Array.isArray(volumeValue)
    ) {
      throw new RunPodControlError("RUNPOD_RESPONSE_INVALID");
    }
    const pods = podValue.map(record).map((pod) => {
      if (!pod || typeof pod.id !== "string" || !ID.test(pod.id)) {
        throw new RunPodControlError("RUNPOD_RESPONSE_INVALID");
      }
      const desiredStatus = typeof pod.desiredStatus === "string" ? pod.desiredStatus : "UNKNOWN";
      const observedStatuses = [pod.desiredStatus, pod.status].filter(
        (status): status is string => typeof status === "string",
      );
      const endpointId =
        typeof pod.endpointId === "string" && ID.test(pod.endpointId) ? pod.endpointId : null;
      return Object.freeze({
        idHash: hashId(pod.id),
        desiredStatus,
        observedStatuses: Object.freeze(observedStatuses),
        endpointWorker: endpointId !== null,
        endpointIdHash: endpointId === null ? null : hashId(endpointId),
        costPerHourUsd: numberOrNull(pod.adjustedCostPerHr ?? pod.costPerHr),
      });
    });
    const endpoints = endpointValue.map(record).map((endpoint) => {
      if (!endpoint || typeof endpoint.id !== "string" || !ID.test(endpoint.id)) {
        throw new RunPodControlError("RUNPOD_RESPONSE_INVALID");
      }
      const workersMin = numberOrNull(endpoint.workersMin);
      const workersMax = numberOrNull(endpoint.workersMax);
      const workerRecordsReported = Array.isArray(endpoint.workers);
      const workers = Array.isArray(endpoint.workers) ? endpoint.workers : [];
      const workerStatuses = workers.map((worker) => {
        const value = record(worker);
        const desiredStatus = typeof value?.desiredStatus === "string" ? value.desiredStatus : null;
        const currentStatus = typeof value?.status === "string" ? value.status : null;
        if (desiredStatus && currentStatus && desiredStatus !== currentStatus) return "CONFLICT";
        return desiredStatus ?? currentStatus ?? "UNKNOWN";
      });
      return Object.freeze({
        idHash: hashId(endpoint.id),
        workersMin,
        workersMax,
        workerRecordsReported,
        workerRecordCount: workers.length,
        activeWorkerCount: workerStatuses.filter((status) => status === "RUNNING").length,
        exitedWorkerCount: workerStatuses.filter(
          (status) => status === "EXITED" || status === "TERMINATED",
        ).length,
        workerStatuses: Object.freeze(workerStatuses),
        scaleZeroCompliant: workersMin === 0 && workersMax === 1,
      });
    });
    const networkVolumes = volumeValue.map(record).map((volume) => {
      if (!volume || typeof volume.id !== "string" || !ID.test(volume.id)) {
        throw new RunPodControlError("RUNPOD_RESPONSE_INVALID");
      }
      return Object.freeze({
        idHash: hashId(volume.id),
        sizeGb: numberOrNull(volume.size),
        dataCenterId:
          typeof volume.dataCenterId === "string" && volume.dataCenterId.length > 0
            ? volume.dataCenterId
            : null,
      });
    });
    return Object.freeze({
      checkedAt: now.toISOString(),
      pods: Object.freeze(pods),
      endpoints: Object.freeze(endpoints),
      privateTemplateCount: templateValue.length,
      networkVolumes: Object.freeze(networkVolumes),
      runningPodCount: pods.filter((pod) => pod.desiredStatus === "RUNNING").length,
      activeServerlessWorkerCount: pods.filter(
        (pod) => pod.endpointWorker && pod.desiredStatus === "RUNNING",
      ).length,
    });
  }

  /**
   * Read the named disposable resources needed to recover an ambiguous create mutation.
   * This intentionally does not read or return network volumes; retained model volumes are
   * outside the recovery/deletion surface.
   */
  async inventoryDisposableResources(): Promise<RunPodDisposableResourceInventory> {
    const [endpointValue, templateValue] = await Promise.all([
      this.readInventory("/endpoints?includeTemplate=true&includeWorkers=true"),
      this.readInventory("/templates?includeEndpointBoundTemplates=true"),
    ]);
    const parse = (value: unknown): readonly RunPodNamedResource[] => {
      if (!Array.isArray(value)) throw new RunPodControlError("RUNPOD_RESPONSE_INVALID");
      return Object.freeze(
        value.map((candidate) => {
          const resource = record(candidate);
          if (
            !resource ||
            typeof resource.id !== "string" ||
            !ID.test(resource.id) ||
            typeof resource.name !== "string" ||
            !ID.test(resource.name)
          ) {
            throw new RunPodControlError("RUNPOD_RESPONSE_INVALID");
          }
          return Object.freeze({ id: resource.id, name: resource.name, raw: resource });
        }),
      );
    };
    return Object.freeze({
      endpoints: parse(endpointValue),
      templates: parse(templateValue),
    });
  }
}

export interface RunPodJobResult {
  readonly id: string;
  readonly idHash: string;
  readonly status: string;
  readonly output?: unknown;
  /** Provider-level handler error; retained only in memory for bounded reconciliation. */
  readonly error?: unknown;
  readonly progress?: unknown;
  readonly executionTimeMs: number | null;
  readonly delayTimeMs: number | null;
}

export interface RunPodJobDiagnostic {
  readonly status: string | null;
  readonly code: string | null;
  readonly message: string | null;
  readonly reason: string | null;
}

const diagnosticScalar = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim().slice(0, 240) : null;

const diagnosticCodeFromText = (value: string): string | null => {
  const match = value.match(/\b(?:MAGE|RUNPOD|SERVERLESS)_[A-Z0-9_.:-]{2,160}\b/u)?.[0];
  return match && /^[A-Z][A-Z0-9_.:-]{2,160}$/u.test(match) ? match : null;
};

/**
 * Keep provider failure diagnostics deliberately narrow.  The stream endpoint can contain
 * worker logs and environment values; only a small, non-secret status tuple is retained.
 */
const extractJobDiagnostic = (value: unknown): RunPodJobDiagnostic => {
  const candidates: JsonRecord[] = [];
  const visit = (candidate: unknown): void => {
    if (Array.isArray(candidate)) {
      for (const entry of candidate.slice(0, 32)) visit(entry);
      return;
    }
    const object = record(candidate);
    if (!object) return;
    candidates.push(object);
    for (const key of ["output", "error", "result", "data"]) {
      if (Object.hasOwn(object, key)) visit(object[key]);
    }
  };
  visit(value);
  const pick = (keys: readonly string[]): string | null => {
    for (const candidate of candidates) {
      for (const key of keys) {
        const found = diagnosticScalar(candidate[key]);
        if (found) return found;
      }
    }
    return null;
  };
  return Object.freeze({
    status: pick(["status", "state"]),
    code: pick(["code", "error_code", "errorCode"]),
    message: pick(["message", "detail"]),
    reason: pick(["reason", "error"]),
  });
};

const jobResult = (value: JsonRecord): RunPodJobResult => {
  if (typeof value.id !== "string" || !ID.test(value.id) || typeof value.status !== "string") {
    throw new RunPodControlError("RUNPOD_RESPONSE_INVALID");
  }
  return Object.freeze({
    id: value.id,
    idHash: hashId(value.id),
    status: value.status,
    ...(Object.hasOwn(value, "output") ? { output: value.output } : {}),
    ...(Object.hasOwn(value, "error") ? { error: value.error } : {}),
    ...(Object.hasOwn(value, "progress") ? { progress: value.progress } : {}),
    executionTimeMs: numberOrNull(value.executionTime),
    delayTimeMs: numberOrNull(value.delayTime),
  });
};

export interface RunPodServerlessJobClientOptions {
  readonly apiKey: string;
  readonly endpointId: string;
  readonly guard: RunPodDrainGuard;
  readonly fetch?: FetchPort;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly readRetryDelaysMs?: readonly number[];
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly signal?: AbortSignal;
  /** Bound cancellation reconciliation so an uncertain provider never becomes an unbounded wait. */
  readonly cancelConfirmMaxPolls?: number;
  readonly cancelConfirmPollIntervalMs?: number;
}

const DEFAULT_CANCEL_CONFIRM_MAX_POLLS = 30;
const DEFAULT_CANCEL_CONFIRM_POLL_INTERVAL_MS = 2_000;

export class RunPodServerlessJobClient {
  private readonly fetch: FetchPort;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly readRetryDelaysMs: readonly number[];
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly cancelConfirmMaxPolls: number;
  private readonly cancelConfirmPollIntervalMs: number;
  private readonly replays = new Map<
    string,
    { readonly inputHash: string; readonly promise: Promise<RunPodJobResult> }
  >();

  constructor(private readonly options: RunPodServerlessJobClientOptions) {
    if (options.apiKey.trim() !== options.apiKey || options.apiKey.length < 20) {
      throw new RunPodControlError("RUNPOD_AUTH_INVALID");
    }
    if (!ID.test(options.endpointId)) throw new RunPodControlError("RUNPOD_ENDPOINT_ID_INVALID");
    this.fetch = options.fetch ?? fetch;
    this.baseUrl = options.baseUrl ?? "https://api.runpod.ai/v2";
    if (
      this.baseUrl !== "https://api.runpod.ai/v2" &&
      !this.baseUrl.startsWith("http://127.0.0.1:")
    ) {
      throw new RunPodControlError("RUNPOD_BASE_URL_INVALID");
    }
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.readRetryDelaysMs = Object.freeze([...(options.readRetryDelaysMs ?? [250, 1_000, 2_000])]);
    this.sleep =
      options.sleep ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.cancelConfirmMaxPolls = options.cancelConfirmMaxPolls ?? DEFAULT_CANCEL_CONFIRM_MAX_POLLS;
    this.cancelConfirmPollIntervalMs =
      options.cancelConfirmPollIntervalMs ?? DEFAULT_CANCEL_CONFIRM_POLL_INTERVAL_MS;
    if (
      this.readRetryDelaysMs.length > 4 ||
      this.readRetryDelaysMs.some(
        (delay) => !Number.isSafeInteger(delay) || delay < 0 || delay > 10_000,
      ) ||
      !Number.isSafeInteger(this.cancelConfirmMaxPolls) ||
      this.cancelConfirmMaxPolls < 1 ||
      this.cancelConfirmMaxPolls > 180 ||
      !Number.isSafeInteger(this.cancelConfirmPollIntervalMs) ||
      this.cancelConfirmPollIntervalMs < 100 ||
      this.cancelConfirmPollIntervalMs > 10_000
    ) {
      throw new RunPodControlError("RUNPOD_READ_RETRY_POLICY_INVALID");
    }
  }

  private async requestOnce(
    method: "GET" | "POST",
    path: string,
    body?: string,
  ): Promise<JsonRecord> {
    let response: Response;
    try {
      response = await this.fetch(`${this.baseUrl}/${this.options.endpointId}${path}`, {
        method,
        headers: {
          authorization: this.options.apiKey,
          connection: "close",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new RunPodControlError(
        method === "GET" ? "RUNPOD_READ_AMBIGUOUS" : "RUNPOD_MUTATION_AMBIGUOUS",
      );
    }
    if (!response.ok) {
      throw new RunPodControlError(
        response.status === 401 || response.status === 403
          ? "RUNPOD_AUTH_REJECTED"
          : method === "GET"
            ? "RUNPOD_READ_FAILED"
            : "RUNPOD_MUTATION_FAILED",
      );
    }
    try {
      const value = record(JSON.parse(await response.text()));
      if (!value) throw new Error("invalid");
      return value;
    } catch {
      throw new RunPodControlError("RUNPOD_RESPONSE_INVALID");
    }
  }

  private async request(method: "GET" | "POST", path: string, body?: string): Promise<JsonRecord> {
    if (method === "POST") return this.requestOnce(method, path, body);
    for (let attempt = 0; ; attempt += 1) {
      if (this.options.signal?.aborted) {
        throw new RunPodControlError("RUNPOD_READ_ABORTED");
      }
      try {
        return await this.requestOnce(method, path, body);
      } catch (error) {
        const retryable =
          error instanceof RunPodControlError &&
          (error.code === "RUNPOD_READ_AMBIGUOUS" || error.code === "RUNPOD_READ_FAILED");
        if (!retryable || attempt >= this.readRetryDelaysMs.length) throw error;
        await this.sleep(this.readRetryDelaysMs[attempt]!);
      }
    }
  }

  private dispatchRequest(requestKey: string, request: JsonValue): Promise<RunPodJobResult> {
    if (!ID.test(requestKey)) throw new RunPodControlError("RUNPOD_REQUEST_KEY_INVALID");
    const requestBytes = canonicalizeJson(request);
    if (Buffer.byteLength(requestBytes, "utf8") > 10 * 1024 * 1024) {
      throw new RunPodControlError("RUNPOD_REQUEST_TOO_LARGE");
    }
    const inputHash = hashId(requestBytes);
    const replay = this.replays.get(requestKey);
    if (replay) {
      if (replay.inputHash !== inputHash) {
        throw new RunPodControlError("RUNPOD_REQUEST_REPLAY_MISMATCH");
      }
      return replay.promise;
    }
    this.options.guard.assertDispatchAllowed();
    this.options.guard.markActive();
    const pending = this.request("POST", "/run", requestBytes).then(jobResult);
    this.replays.set(requestKey, { inputHash, promise: pending });
    return pending;
  }

  /** Dispatches the ordinary worker payload with no per-job policy override. */
  dispatch(requestKey: string, input: JsonValue): Promise<RunPodJobResult> {
    return this.dispatchRequest(requestKey, { input });
  }

  /**
   * Dispatches the one bounded V2-07 timeout proof.  The policy is serialized at the RunPod
   * request's top level, and the exact request body (including policy) is replay-hashed.
   */
  dispatchWithPolicy(
    requestKey: string,
    input: JsonValue,
    policy: RunPodV207TimeoutPolicy,
  ): Promise<RunPodJobResult> {
    assertV207TimeoutPolicy(policy);
    const inputRecord = record(input);
    if (inputRecord && Object.hasOwn(inputRecord, "policy")) {
      throw new RunPodControlError("RUNPOD_TIMEOUT_POLICY_INVALID");
    }
    return this.dispatchRequest(requestKey, {
      input,
      policy: {
        executionTimeout: V207_TIMEOUT_EXECUTION_TIMEOUT_MS,
        ttl: V207_TIMEOUT_TTL_MS,
      },
    });
  }

  async status(jobId: string): Promise<RunPodJobResult> {
    if (!ID.test(jobId)) throw new RunPodControlError("RUNPOD_JOB_ID_INVALID");
    const result = jobResult(await this.request("GET", `/status/${jobId}`));
    if (result.id !== jobId) throw new RunPodControlError("RUNPOD_JOB_ID_MISMATCH");
    return result;
  }

  async diagnostic(jobId: string): Promise<RunPodJobDiagnostic> {
    if (!ID.test(jobId)) throw new RunPodControlError("RUNPOD_JOB_ID_INVALID");
    let response: Response;
    try {
      response = await this.fetch(`${this.baseUrl}/${this.options.endpointId}/stream/${jobId}`, {
        headers: { authorization: this.options.apiKey },
        signal: AbortSignal.timeout(Math.min(this.timeoutMs, 15_000)),
      });
    } catch {
      throw new RunPodControlError("RUNPOD_READ_AMBIGUOUS");
    }
    if (!response.ok) {
      throw new RunPodControlError(
        response.status === 401 || response.status === 403
          ? "RUNPOD_AUTH_REJECTED"
          : "RUNPOD_READ_FAILED",
      );
    }
    const text = (await response.text()).slice(0, 64 * 1024);
    try {
      const parsed = extractJobDiagnostic(JSON.parse(text));
      return Object.freeze({ ...parsed, code: parsed.code ?? diagnosticCodeFromText(text) });
    } catch {
      const records: unknown[] = [];
      for (const line of text.split("\n").slice(0, 64)) {
        const data = line.trim().replace(/^data:\s*/u, "");
        if (!data || data === "[DONE]") continue;
        try {
          records.push(JSON.parse(data));
        } catch {
          // The provider may emit a non-JSON keepalive; it is intentionally ignored.
        }
      }
      const parsed = extractJobDiagnostic(records);
      return Object.freeze({ ...parsed, code: parsed.code ?? diagnosticCodeFromText(text) });
    }
  }

  async cancel(jobId: string): Promise<RunPodJobResult> {
    if (!ID.test(jobId)) throw new RunPodControlError("RUNPOD_JOB_ID_INVALID");
    const value = await this.request("POST", `/cancel/${jobId}`);
    const requested = jobResult(value);
    if (requested.id !== jobId) throw new RunPodControlError("RUNPOD_CANCEL_UNCONFIRMED");
    for (let attempt = 0; attempt < this.cancelConfirmMaxPolls; attempt += 1) {
      const observed = await this.status(jobId);
      if (observed.status === "CANCELLED") return observed;
      if (["COMPLETED", "FAILED", "TIMED_OUT"].includes(observed.status)) {
        throw new RunPodControlError("RUNPOD_CANCEL_UNCONFIRMED");
      }
      if (attempt + 1 < this.cancelConfirmMaxPolls) {
        await this.sleep(this.cancelConfirmPollIntervalMs);
      }
    }
    throw new RunPodControlError("RUNPOD_CANCEL_UNCONFIRMED");
  }

  async confirmDrained(maxAttempts = 30): Promise<{
    readonly workersTotal: 0;
    readonly queuedJobs: 0;
    readonly observedAt: string;
  }> {
    if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 180) {
      throw new RunPodControlError("RUNPOD_DRAIN_POLICY_INVALID");
    }
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const value = await this.request("GET", "/health");
      const workers = healthWorkerCounts(record(value.workers));
      const jobs = record(value.jobs);
      const queuedJobs = strictCounter(jobs, "inQueue") + strictCounter(jobs, "inProgress");
      if (workers.total === 0 && queuedJobs === 0) {
        this.options.guard.confirmZero(0, 0);
        return Object.freeze({
          workersTotal: 0,
          queuedJobs: 0,
          observedAt: new Date().toISOString(),
        });
      }
      if (attempt + 1 < maxAttempts) await this.sleep(2_000);
    }
    this.options.guard.confirmZero(Number.NaN, Number.NaN);
    throw new RunPodControlError("RUNPOD_ZERO_NOT_CONFIRMED");
  }

  async confirmWarmIdle(maxAttempts = 30, pollIntervalMs = 2_000): Promise<void> {
    if (
      !Number.isSafeInteger(maxAttempts) ||
      maxAttempts < 1 ||
      maxAttempts > 600 ||
      !Number.isSafeInteger(pollIntervalMs) ||
      pollIntervalMs < 100 ||
      pollIntervalMs > 2_000
    ) {
      throw new RunPodControlError("RUNPOD_WARM_IDLE_POLICY_INVALID");
    }
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const value = await this.request("GET", "/health");
      const workers = healthWorkerCounts(record(value.workers));
      const jobs = record(value.jobs);
      const idle = workers.idle;
      const running = workers.running;
      const queued = strictCounter(jobs, "inQueue") + strictCounter(jobs, "inProgress");
      if (attempt === 0) {
        console.error(
          `v207:health-baseline=${JSON.stringify({ idle, running, initializing: workers.initializing, ready: workers.ready, throttled: workers.throttled, unhealthy: workers.unhealthy, queued })}`,
        );
      }
      if (
        Number.isSafeInteger(idle) &&
        Number.isSafeInteger(workers.ready) &&
        idle <= 1 &&
        workers.ready <= 1 &&
        idle + workers.ready <= 1 &&
        running === 0 &&
        workers.initializing === 0 &&
        workers.throttled === 0 &&
        workers.unhealthy === 0 &&
        queued === 0
      ) {
        this.options.guard.confirmWarmIdle(idle, running, queued);
        return;
      }
      if (attempt + 1 < maxAttempts) await this.sleep(pollIntervalMs);
    }
    this.options.guard.confirmWarmIdle(Number.NaN, Number.NaN, Number.NaN);
  }

  async confirmQuiescent(maxAttempts = 90, pollIntervalMs = 2_000): Promise<void> {
    if (
      !Number.isSafeInteger(maxAttempts) ||
      maxAttempts < 1 ||
      maxAttempts > 600 ||
      !Number.isSafeInteger(pollIntervalMs) ||
      pollIntervalMs < 100 ||
      pollIntervalMs > 2_000
    ) {
      throw new RunPodControlError("RUNPOD_QUIESCENT_POLICY_INVALID");
    }
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const value = await this.request("GET", "/health");
      const rawWorkers = record(value.workers);
      const jobs = record(value.jobs);
      const workers = {
        idle: strictCounter(rawWorkers, "idle"),
        running: strictCounter(rawWorkers, "running"),
        initializing: strictCounter(rawWorkers, "initializing"),
        ready: strictCounter(rawWorkers, "ready"),
        throttled: strictCounter(rawWorkers, "throttled"),
        unhealthy: strictCounter(rawWorkers, "unhealthy"),
      };
      const { idle, running, initializing, ready, throttled, unhealthy } = workers;
      const inQueue = strictCounter(jobs, "inQueue");
      const inProgress = strictCounter(jobs, "inProgress");
      if (
        Number.isSafeInteger(idle) &&
        Number.isSafeInteger(ready) &&
        Number.isSafeInteger(throttled) &&
        Number.isSafeInteger(running) &&
        Number.isSafeInteger(initializing) &&
        Number.isSafeInteger(unhealthy) &&
        Number.isSafeInteger(inQueue) &&
        Number.isSafeInteger(inProgress) &&
        idle <= 1 &&
        ready <= 1 &&
        throttled <= 1 &&
        idle + ready + throttled <= 1 &&
        running === 0 &&
        initializing === 0 &&
        unhealthy === 0 &&
        inQueue === 0 &&
        inProgress === 0
      ) {
        this.options.guard.confirmQuiescent(
          idle,
          ready,
          throttled,
          running,
          initializing,
          unhealthy,
          0,
        );
        return;
      }
      if (attempt + 1 < maxAttempts) await this.sleep(pollIntervalMs);
    }
    this.options.guard.confirmQuiescent(
      Number.NaN,
      Number.NaN,
      Number.NaN,
      Number.NaN,
      Number.NaN,
      Number.NaN,
      Number.NaN,
    );
  }

  async confirmQueueEmpty(): Promise<void> {
    const value = await this.request("GET", "/health");
    const jobs = record(value.jobs);
    const queuedJobs = strictCounter(jobs, "inQueue") + strictCounter(jobs, "inProgress");
    this.options.guard.confirmQueueEmpty(queuedJobs);
  }

  /**
   * Proves only that the provider reports no queued or in-progress jobs.
   *
   * Startup terminal-inventory recovery intentionally cannot use confirmQueueEmpty(): that
   * guard transition is valid only while draining an already-used endpoint.  This independent
   * read is allowed before the first owned job and does not inspect worker counters, which may
   * be stale or incomplete during FlashBoot startup.  Both job fields must be present strict
   * non-negative integers and exactly zero; any missing, malformed, queued, or in-progress value
   * fails closed.
   */
  async confirmStartupQueueEmpty(): Promise<void> {
    const value = await this.request("GET", "/health");
    const jobs = record(value.jobs);
    const inQueue = strictCounter(jobs, "inQueue");
    const inProgress = strictCounter(jobs, "inProgress");
    if (inQueue !== 0 || inProgress !== 0) {
      throw new RunPodControlError("RUNPOD_STARTUP_QUEUE_NOT_CONFIRMED");
    }
  }

  /**
   * Proves only that the provider has no queued or in-progress jobs, without consulting worker
   * counters or mutating the drain guard. This is used after a terminal job when FlashBoot may
   * leave a stale worker counter behind. Non-zero queue state is polled for a short bounded
   * window; malformed or still-busy state always fails closed.
   */
  async confirmQueueEmptyReadOnly(maxAttempts = 12, pollIntervalMs = 250): Promise<void> {
    if (
      !Number.isSafeInteger(maxAttempts) ||
      maxAttempts < 1 ||
      maxAttempts > 60 ||
      !Number.isSafeInteger(pollIntervalMs) ||
      pollIntervalMs < 100 ||
      pollIntervalMs > 2_000
    ) {
      throw new RunPodControlError("RUNPOD_QUEUE_EMPTY_POLICY_INVALID");
    }
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const value = await this.request("GET", "/health");
      const jobs = record(value.jobs);
      const inQueue = strictCounter(jobs, "inQueue");
      const inProgress = strictCounter(jobs, "inProgress");
      if (!Number.isSafeInteger(inQueue) || !Number.isSafeInteger(inProgress)) {
        throw new RunPodControlError("RUNPOD_QUEUE_EMPTY_NOT_CONFIRMED");
      }
      if (inQueue === 0 && inProgress === 0) return;
      if (attempt + 1 < maxAttempts) await this.sleep(pollIntervalMs);
    }
    throw new RunPodControlError("RUNPOD_QUEUE_EMPTY_NOT_CONFIRMED");
  }
}

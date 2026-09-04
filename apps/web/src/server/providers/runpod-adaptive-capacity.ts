import {
  RunPodControlError,
  V207_RUNPOD_EXECUTION_TIMEOUT_MS,
  V207_RUNPOD_HANDLER_CONCURRENCY,
  V207_RUNPOD_IDLE_TIMEOUT_SECONDS,
  V207_RUNPOD_SCALER,
  V207_RUNPOD_SCALER_VALUE,
  type RunPodV207ConcurrentReaderPolicy,
} from "./runpod-control";

/**
 * Capacity is deliberately staged.  The first live promotion is max-two; larger stages are
 * planning targets only until the exact shared-volume reader gate has been independently passed.
 */
export const V207_ADAPTIVE_WORKER_STAGES = Object.freeze([2, 4, 6, 10] as const);
export type V207AdaptiveWorkerStage = (typeof V207_ADAPTIVE_WORKER_STAGES)[number];
export const V207_CURRENT_MAX_ACTIVATABLE_WORKERS = 2 as const;
export const V207_WARM_IDLE_SHUTDOWN_SECONDS = V207_RUNPOD_IDLE_TIMEOUT_SECONDS;

export type RunPodV207Lane = "mage_image" | "soulx_avatar";
export type RunPodV207BatchMode = "whole_project";

export interface RunPodV207WholeProjectLanePolicy {
  readonly workersMin: 0;
  readonly workersMax: 1 | V207AdaptiveWorkerStage;
  readonly gpuCount: 1;
  readonly handlerConcurrency: typeof V207_RUNPOD_HANDLER_CONCURRENCY;
  readonly scalerType: typeof V207_RUNPOD_SCALER;
  readonly scalerValue: typeof V207_RUNPOD_SCALER_VALUE;
  readonly idleTimeoutSeconds: typeof V207_RUNPOD_IDLE_TIMEOUT_SECONDS;
  readonly executionTimeoutMs: typeof V207_RUNPOD_EXECUTION_TIMEOUT_MS;
  readonly batchMode: RunPodV207BatchMode;
  /** Consecutive admitted projects may reuse a ready worker before the short idle timeout. */
  readonly warmWorkerReuse: true;
  /** A worker may not be retained after the queue has no admitted work. */
  readonly scaleToZeroWhenQueueEmpty: true;
}

export interface RunPodV207WarmWorkerReusePolicy {
  readonly schemaVersion: "videoforge.runpod-warm-worker-reuse/v1";
  readonly workersMin: 0;
  readonly idleTimeoutSeconds: typeof V207_WARM_IDLE_SHUTDOWN_SECONDS;
  readonly reuseScope: "same_lane_consecutive_admitted_projects";
  readonly requiresTerminalPreviousProject: true;
  readonly requiresProviderQueueEmpty: true;
  readonly scaleToZeroWhenNoAdmittedWork: true;
}

export interface RunPodV207WarmWorkerHealth {
  readonly idleWorkers: number;
  readonly readyWorkers: number;
  readonly runningWorkers: number;
  readonly initializingWorkers: number;
  readonly throttledWorkers: number;
  readonly unhealthyWorkers: number;
  readonly queuedJobs: number;
}

export type RunPodV207WarmWorkerTransition =
  | {
      readonly action: "REUSE_WARM_WORKER";
      readonly idleTimeoutSeconds: typeof V207_WARM_IDLE_SHUTDOWN_SECONDS;
    }
  | {
      readonly action: "WAIT_FOR_SCALE_TO_ZERO";
      readonly idleTimeoutSeconds: typeof V207_WARM_IDLE_SHUTDOWN_SECONDS;
    };

/**
 * A redaction-safe, measured concurrent-reader gate.  The provider identifiers themselves never
 * enter this object; the hashes bind it to the exact image, endpoint configuration, and volume
 * manifest that were measured.
 */
export interface RunPodConcurrentVolumeQualificationGate {
  readonly schemaVersion: "videoforge.runpod-concurrent-volume-qualification/v1";
  readonly lane: RunPodV207Lane;
  readonly workersMin: 0;
  readonly workersMax: V207AdaptiveWorkerStage;
  readonly gpuCount: 1;
  readonly handlerConcurrency: typeof V207_RUNPOD_HANDLER_CONCURRENCY;
  readonly scalerType: typeof V207_RUNPOD_SCALER;
  readonly scalerValue: typeof V207_RUNPOD_SCALER_VALUE;
  readonly batchMode: RunPodV207BatchMode;
  readonly concurrentReaderCount: V207AdaptiveWorkerStage;
  readonly successfulReaderCount: V207AdaptiveWorkerStage;
  readonly terminalWorkerCount: V207AdaptiveWorkerStage;
  readonly volumeMutationDetected: false;
  readonly volumeManifestBeforeSha256: string;
  readonly volumeManifestAfterSha256: string;
  readonly endpointConfigSha256: string;
  readonly imageDigestSha256: string;
  readonly evidenceSha256: string;
  readonly measuredAt: string;
}

export type RunPodV207AdaptiveActivationReason =
  | "MAX_ONE_DEFAULT"
  | "MAX_TWO_QUALIFICATION_REQUIRED"
  | "MAX_TWO_READY"
  | "FUTURE_STAGE_QUALIFICATION_REQUIRED"
  | "FUTURE_STAGE_REQUIRES_EXPLICIT_ENABLEMENT";

export interface RunPodV207AdaptiveCapacityPlan {
  readonly schemaVersion: "videoforge.runpod-adaptive-capacity-plan/v1";
  readonly lane: RunPodV207Lane;
  readonly requestedWorkersMax: 1 | V207AdaptiveWorkerStage;
  /** The largest contiguous measured gate, not a provider configuration or availability claim. */
  readonly highestQualifiedWorkersMax: 0 | V207AdaptiveWorkerStage;
  readonly nextQualificationWorkersMax: V207AdaptiveWorkerStage | null;
  /** Current policy ceiling.  It never exceeds max-two in this source-only planner. */
  readonly activeWorkersMax: 1 | 2;
  readonly activationAllowed: boolean;
  readonly activationReason: RunPodV207AdaptiveActivationReason;
  readonly requestedStageQualified: boolean;
  readonly policy: RunPodV207WholeProjectLanePolicy;
  readonly warmWorkerReuse: RunPodV207WarmWorkerReusePolicy;
}

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const ADAPTIVE_STAGE_SET: ReadonlySet<number> = new Set(V207_ADAPTIVE_WORKER_STAGES);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isAdaptiveStage = (value: unknown): value is V207AdaptiveWorkerStage =>
  typeof value === "number" && Number.isSafeInteger(value) && ADAPTIVE_STAGE_SET.has(value);

function assertSha256(value: unknown, code: string): asserts value is string {
  if (typeof value !== "string" || !SHA256.test(value)) throw new RunPodControlError(code);
}

function assertMeasuredAt(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    !ISO_INSTANT.test(value) ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new RunPodControlError("RUNPOD_ADAPTIVE_QUALIFICATION_GATE_INVALID");
  }
}

/** The exact policy shared by Mage and SoulX whole-project batches at the first promotion. */
export function buildV207MaxTwoWholeProjectPolicy(
  executionTimeoutMs = V207_RUNPOD_EXECUTION_TIMEOUT_MS,
): RunPodV207WholeProjectLanePolicy {
  if (
    !Number.isSafeInteger(executionTimeoutMs) ||
    executionTimeoutMs < 1_000 ||
    executionTimeoutMs > 3_600_000
  ) {
    throw new RunPodControlError("RUNPOD_ADAPTIVE_TIMING_POLICY_INVALID");
  }
  return Object.freeze({
    workersMin: 0,
    workersMax: 2,
    gpuCount: 1,
    handlerConcurrency: V207_RUNPOD_HANDLER_CONCURRENCY,
    scalerType: V207_RUNPOD_SCALER,
    scalerValue: V207_RUNPOD_SCALER_VALUE,
    idleTimeoutSeconds: V207_RUNPOD_IDLE_TIMEOUT_SECONDS,
    executionTimeoutMs,
    batchMode: "whole_project" as const,
    warmWorkerReuse: true as const,
    scaleToZeroWhenQueueEmpty: true as const,
  });
}

/**
 * Validate the policy supplied to the existing V2-07/V2-08 max-two qualification path.  This is
 * called by the qualification harness before it can mutate an endpoint; future adaptive stages
 * intentionally cannot satisfy this boundary.
 */
export function assertV207MaxTwoWholeProjectPolicy(value: RunPodV207ConcurrentReaderPolicy): void {
  if (
    value.workersMin !== 0 ||
    value.workersMax !== 2 ||
    value.gpuCount !== 1 ||
    value.idleTimeout !== V207_RUNPOD_IDLE_TIMEOUT_SECONDS ||
    value.executionTimeoutMs !== V207_RUNPOD_EXECUTION_TIMEOUT_MS
  ) {
    throw new RunPodControlError("RUNPOD_ADAPTIVE_MAX_TWO_POLICY_INVALID");
  }
}

export function buildV207WarmWorkerReusePolicy(): RunPodV207WarmWorkerReusePolicy {
  return Object.freeze({
    schemaVersion: "videoforge.runpod-warm-worker-reuse/v1" as const,
    workersMin: 0 as const,
    idleTimeoutSeconds: V207_WARM_IDLE_SHUTDOWN_SECONDS,
    reuseScope: "same_lane_consecutive_admitted_projects" as const,
    requiresTerminalPreviousProject: true as const,
    requiresProviderQueueEmpty: true as const,
    scaleToZeroWhenNoAdmittedWork: true as const,
  });
}

/**
 * Validate a gate before it can influence a capacity plan.  This is intentionally strict: a
 * worker count without equal concurrent-reader, success, terminal, and unchanged-volume facts is
 * not a qualification gate.
 */
export function assertRunPodConcurrentVolumeQualificationGate(
  value: unknown,
): asserts value is RunPodConcurrentVolumeQualificationGate {
  if (
    !isRecord(value) ||
    value.schemaVersion !== "videoforge.runpod-concurrent-volume-qualification/v1"
  ) {
    throw new RunPodControlError("RUNPOD_ADAPTIVE_QUALIFICATION_GATE_INVALID");
  }
  if (value.lane !== "mage_image" && value.lane !== "soulx_avatar") {
    throw new RunPodControlError("RUNPOD_ADAPTIVE_QUALIFICATION_GATE_INVALID");
  }
  if (
    value.workersMin !== 0 ||
    !isAdaptiveStage(value.workersMax) ||
    value.gpuCount !== 1 ||
    value.handlerConcurrency !== V207_RUNPOD_HANDLER_CONCURRENCY ||
    value.scalerType !== V207_RUNPOD_SCALER ||
    value.scalerValue !== V207_RUNPOD_SCALER_VALUE ||
    value.batchMode !== "whole_project" ||
    value.concurrentReaderCount !== value.workersMax ||
    value.successfulReaderCount !== value.workersMax ||
    value.terminalWorkerCount !== value.workersMax ||
    value.volumeMutationDetected !== false
  ) {
    throw new RunPodControlError("RUNPOD_ADAPTIVE_QUALIFICATION_GATE_INVALID");
  }
  assertSha256(value.volumeManifestBeforeSha256, "RUNPOD_ADAPTIVE_QUALIFICATION_GATE_INVALID");
  assertSha256(value.volumeManifestAfterSha256, "RUNPOD_ADAPTIVE_QUALIFICATION_GATE_INVALID");
  assertSha256(value.endpointConfigSha256, "RUNPOD_ADAPTIVE_QUALIFICATION_GATE_INVALID");
  assertSha256(value.imageDigestSha256, "RUNPOD_ADAPTIVE_QUALIFICATION_GATE_INVALID");
  assertSha256(value.evidenceSha256, "RUNPOD_ADAPTIVE_QUALIFICATION_GATE_INVALID");
  if (value.volumeManifestBeforeSha256 !== value.volumeManifestAfterSha256) {
    throw new RunPodControlError("RUNPOD_ADAPTIVE_VOLUME_MUTATION_DETECTED");
  }
  assertMeasuredAt(value.measuredAt);
}

const gateMap = (
  lane: RunPodV207Lane,
  gates: readonly RunPodConcurrentVolumeQualificationGate[],
): ReadonlyMap<V207AdaptiveWorkerStage, RunPodConcurrentVolumeQualificationGate> => {
  const mapped = new Map<V207AdaptiveWorkerStage, RunPodConcurrentVolumeQualificationGate>();
  for (const gate of gates) {
    assertRunPodConcurrentVolumeQualificationGate(gate);
    if (gate.lane !== lane) throw new RunPodControlError("RUNPOD_ADAPTIVE_LANE_MISMATCH");
    if (mapped.has(gate.workersMax)) {
      throw new RunPodControlError("RUNPOD_ADAPTIVE_DUPLICATE_QUALIFICATION_GATE");
    }
    mapped.set(gate.workersMax, gate);
  }
  return mapped;
};

const highestContiguousGate = (
  mapped: ReadonlyMap<V207AdaptiveWorkerStage, RunPodConcurrentVolumeQualificationGate>,
): 0 | V207AdaptiveWorkerStage => {
  let highest: 0 | V207AdaptiveWorkerStage = 0;
  for (const stage of V207_ADAPTIVE_WORKER_STAGES) {
    if (!mapped.has(stage)) break;
    highest = stage;
  }
  return highest;
};

const nextGateAfter = (
  mapped: ReadonlyMap<V207AdaptiveWorkerStage, RunPodConcurrentVolumeQualificationGate>,
): V207AdaptiveWorkerStage | null => {
  for (const stage of V207_ADAPTIVE_WORKER_STAGES) {
    if (!mapped.has(stage)) return stage;
  }
  return null;
};

/**
 * Produce a capacity plan without changing a provider endpoint.  Max-two is the only activation
 * above max-one currently allowed.  A complete 4/6/10 gate is recorded as future readiness but is
 * still blocked behind a later explicit capacity/security decision.
 */
export function planV207AdaptiveCapacity(input: {
  readonly lane: RunPodV207Lane;
  readonly requestedWorkersMax: 1 | V207AdaptiveWorkerStage;
  readonly qualificationGates?: readonly RunPodConcurrentVolumeQualificationGate[];
}): RunPodV207AdaptiveCapacityPlan {
  if (!isAdaptiveStage(input.requestedWorkersMax) && input.requestedWorkersMax !== 1) {
    throw new RunPodControlError("RUNPOD_ADAPTIVE_WORKER_STAGE_INVALID");
  }
  const mapped = gateMap(input.lane, input.qualificationGates ?? []);
  const highest = highestContiguousGate(mapped);
  const next = nextGateAfter(mapped);
  const requestedStageQualified =
    input.requestedWorkersMax === 1 ||
    (highest >= input.requestedWorkersMax && mapped.has(input.requestedWorkersMax));
  const maxTwoReady = mapped.has(2);
  const activeWorkersMax: 1 | 2 = input.requestedWorkersMax === 1 || !maxTwoReady ? 1 : 2;
  let activationAllowed = false;
  let activationReason: RunPodV207AdaptiveActivationReason;
  if (input.requestedWorkersMax === 1) {
    activationAllowed = true;
    activationReason = "MAX_ONE_DEFAULT";
  } else if (!maxTwoReady) {
    activationReason = "MAX_TWO_QUALIFICATION_REQUIRED";
  } else if (input.requestedWorkersMax === 2) {
    activationAllowed = true;
    activationReason = "MAX_TWO_READY";
  } else if (!requestedStageQualified) {
    activationReason = "FUTURE_STAGE_QUALIFICATION_REQUIRED";
  } else {
    activationReason = "FUTURE_STAGE_REQUIRES_EXPLICIT_ENABLEMENT";
  }
  return Object.freeze({
    schemaVersion: "videoforge.runpod-adaptive-capacity-plan/v1",
    lane: input.lane,
    requestedWorkersMax: input.requestedWorkersMax,
    highestQualifiedWorkersMax: highest,
    nextQualificationWorkersMax: next,
    activeWorkersMax,
    activationAllowed,
    activationReason,
    requestedStageQualified,
    policy: buildV207MaxTwoWholeProjectPolicy(),
    warmWorkerReuse: buildV207WarmWorkerReusePolicy(),
  });
}

/**
 * Decide whether the next admitted project may reuse one ready worker.  This mirrors the provider
 * health predicate used by the existing job client and explicitly keeps the scale-to-zero path
 * separate; an application queue item never turns a non-idle worker into a reusable worker.
 */
export function planV207WarmWorkerTransition(input: {
  readonly previousProjectTerminal: boolean;
  readonly nextProjectAdmitted: boolean;
  readonly health: RunPodV207WarmWorkerHealth;
}): RunPodV207WarmWorkerTransition {
  const values = Object.values(input.health);
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new RunPodControlError("RUNPOD_WARM_IDLE_POLICY_INVALID");
  }
  const healthIsOneWarmWorker =
    input.health.idleWorkers + input.health.readyWorkers === 1 &&
    input.health.runningWorkers === 0 &&
    input.health.initializingWorkers === 0 &&
    input.health.throttledWorkers === 0 &&
    input.health.unhealthyWorkers === 0 &&
    input.health.queuedJobs === 0;
  if (input.previousProjectTerminal && input.nextProjectAdmitted && healthIsOneWarmWorker) {
    return Object.freeze({
      action: "REUSE_WARM_WORKER" as const,
      idleTimeoutSeconds: V207_WARM_IDLE_SHUTDOWN_SECONDS,
    });
  }
  if (
    input.previousProjectTerminal &&
    !input.nextProjectAdmitted &&
    (healthIsOneWarmWorker || values.every((value) => value === 0))
  ) {
    return Object.freeze({
      action: "WAIT_FOR_SCALE_TO_ZERO" as const,
      idleTimeoutSeconds: V207_WARM_IDLE_SHUTDOWN_SECONDS,
    });
  }
  throw new RunPodControlError("RUNPOD_WARM_REUSE_NOT_CONFIRMED");
}

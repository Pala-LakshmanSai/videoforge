export const TELEMETRY_EVENT_SCHEMA_VERSION = "telemetry-event/v1" as const;

export type TelemetryOutcome =
  | "STARTED"
  | "SUCCEEDED"
  | "FAILED"
  | "RETRYING"
  | "BLOCKED"
  | "CANCELLED";

export type TelemetryErrorClassification =
  | "VALIDATION"
  | "TRANSIENT"
  | "CAPACITY"
  | "BUDGET"
  | "CANCELLED"
  | "INTERNAL";

export interface TelemetryCorrelation {
  readonly requestId: string | null;
  readonly workspaceId: string | null;
  readonly projectId: string | null;
  readonly revisionId: string | null;
  readonly taskId: string | null;
  readonly attemptId: string | null;
  readonly outboxId: string | null;
  readonly providerJobId: string | null;
}

export interface TelemetryRetry {
  readonly attemptNumber: number;
  readonly maximumAttempts: number;
  readonly parentAttemptId: string | null;
}

export interface TelemetryCost {
  readonly reservedMicroUsd: number | null;
  readonly reportedMicroUsd: number | null;
  readonly settledMicroUsd: number | null;
}

export interface TelemetrySafeError {
  readonly code: string;
  readonly classification: TelemetryErrorClassification;
  readonly retryable: boolean;
}

export interface TelemetryEvent {
  readonly schemaVersion: typeof TELEMETRY_EVENT_SCHEMA_VERSION;
  readonly streamId: string;
  readonly sequence: number;
  readonly eventName: string;
  readonly occurredAt: string;
  readonly correlation: TelemetryCorrelation;
  readonly stage: string;
  readonly providerOperation: string | null;
  readonly retry: TelemetryRetry | null;
  readonly queueWaitMs: number | null;
  readonly durationMs: number | null;
  readonly cost: TelemetryCost | null;
  readonly outcome: TelemetryOutcome;
  readonly error: TelemetrySafeError | null;
}

export interface TelemetryPort {
  record(event: TelemetryEvent): void | Promise<void>;
}

const TOP_LEVEL_KEYS = [
  "schemaVersion",
  "streamId",
  "sequence",
  "eventName",
  "occurredAt",
  "correlation",
  "stage",
  "providerOperation",
  "retry",
  "queueWaitMs",
  "durationMs",
  "cost",
  "outcome",
  "error",
] as const;
const CORRELATION_KEYS = [
  "requestId",
  "workspaceId",
  "projectId",
  "revisionId",
  "taskId",
  "attemptId",
  "outboxId",
  "providerJobId",
] as const;
const RETRY_KEYS = ["attemptNumber", "maximumAttempts", "parentAttemptId"] as const;
const COST_KEYS = ["reservedMicroUsd", "reportedMicroUsd", "settledMicroUsd"] as const;
const ERROR_KEYS = ["code", "classification", "retryable"] as const;
const OUTCOMES = new Set<TelemetryOutcome>([
  "STARTED",
  "SUCCEEDED",
  "FAILED",
  "RETRYING",
  "BLOCKED",
  "CANCELLED",
]);
const ERROR_CLASSIFICATIONS = new Set<TelemetryErrorClassification>([
  "VALIDATION",
  "TRANSIENT",
  "CAPACITY",
  "BUDGET",
  "CANCELLED",
  "INTERNAL",
]);
const SAFE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_]*$/;
const SECRET_SHAPE =
  /(?:https?:\/\/|wss?:\/\/|-----BEGIN|\bbearer\b|\b(?:api[_-]?key|authorization|credential|password|secret)\b|\bsk-[A-Za-z0-9_-]{8,}|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.)/i;

type PlainRecord = Readonly<Record<string, unknown>>;

function exactPlainRecord(
  value: unknown,
  path: string,
  expectedKeys: readonly string[],
): PlainRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${path} must be a plain object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${path} must have a plain prototype`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key === "symbol")) {
    throw new TypeError(`${path} cannot contain symbol fields`);
  }
  const stringKeys = keys as string[];
  const unexpected = stringKeys.find((key) => !expectedKeys.includes(key));
  const missing = expectedKeys.find((key) => !stringKeys.includes(key));
  if (
    unexpected !== undefined ||
    missing !== undefined ||
    stringKeys.length !== expectedKeys.length
  ) {
    throw new TypeError(
      unexpected === undefined
        ? `${path}.${missing ?? "unknown"} is required`
        : `${path}.${unexpected} is not allowed`,
    );
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const output: Record<string, unknown> = {};
  for (const key of expectedKeys) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor)) {
      throw new TypeError(`${path}.${key} must be a data field`);
    }
    output[key] = descriptor.value;
  }
  return output;
}

function safeToken(value: unknown, path: string, maximumLength: number): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximumLength ||
    !SAFE_TOKEN.test(value) ||
    SECRET_SHAPE.test(value) ||
    /^[A-Za-z0-9_-]{40,}$/.test(value)
  ) {
    throw new TypeError(`${path} must be a bounded redaction-safe token`);
  }
  return value;
}

function nullableSafeToken(value: unknown, path: string, maximumLength = 128): string | null {
  return value === null ? null : safeToken(value, path, maximumLength);
}

function positiveSafeInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${path} must be a positive safe integer`);
  }
  return value;
}

function nonNegativeFinite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${path} must be finite and non-negative`);
  }
  return value;
}

function nullableNonNegativeFinite(value: unknown, path: string): number | null {
  return value === null ? null : nonNegativeFinite(value, path);
}

function nullableMicroUsd(value: unknown, path: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${path} must be a non-negative safe integer`);
  }
  return value;
}

function isoTimestamp(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("telemetry.occurredAt must be a string");
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new TypeError("telemetry.occurredAt must be a canonical UTC timestamp");
  }
  return value;
}

function normalizeCorrelation(value: unknown): TelemetryCorrelation {
  const record = exactPlainRecord(value, "telemetry.correlation", CORRELATION_KEYS);
  return Object.freeze({
    requestId: nullableSafeToken(record.requestId, "telemetry.correlation.requestId"),
    workspaceId: nullableSafeToken(record.workspaceId, "telemetry.correlation.workspaceId"),
    projectId: nullableSafeToken(record.projectId, "telemetry.correlation.projectId"),
    revisionId: nullableSafeToken(record.revisionId, "telemetry.correlation.revisionId"),
    taskId: nullableSafeToken(record.taskId, "telemetry.correlation.taskId"),
    attemptId: nullableSafeToken(record.attemptId, "telemetry.correlation.attemptId"),
    outboxId: nullableSafeToken(record.outboxId, "telemetry.correlation.outboxId"),
    providerJobId: nullableSafeToken(record.providerJobId, "telemetry.correlation.providerJobId"),
  });
}

function normalizeRetry(value: unknown): TelemetryRetry | null {
  if (value === null) return null;
  const record = exactPlainRecord(value, "telemetry.retry", RETRY_KEYS);
  const attemptNumber = positiveSafeInteger(record.attemptNumber, "telemetry.retry.attemptNumber");
  const maximumAttempts = positiveSafeInteger(
    record.maximumAttempts,
    "telemetry.retry.maximumAttempts",
  );
  if (attemptNumber > maximumAttempts) {
    throw new RangeError("telemetry.retry.attemptNumber cannot exceed maximumAttempts");
  }
  return Object.freeze({
    attemptNumber,
    maximumAttempts,
    parentAttemptId: nullableSafeToken(record.parentAttemptId, "telemetry.retry.parentAttemptId"),
  });
}

function normalizeCost(value: unknown): TelemetryCost | null {
  if (value === null) return null;
  const record = exactPlainRecord(value, "telemetry.cost", COST_KEYS);
  const cost = Object.freeze({
    reservedMicroUsd: nullableMicroUsd(record.reservedMicroUsd, "telemetry.cost.reservedMicroUsd"),
    reportedMicroUsd: nullableMicroUsd(record.reportedMicroUsd, "telemetry.cost.reportedMicroUsd"),
    settledMicroUsd: nullableMicroUsd(record.settledMicroUsd, "telemetry.cost.settledMicroUsd"),
  });
  if (
    cost.reservedMicroUsd === null &&
    cost.reportedMicroUsd === null &&
    cost.settledMicroUsd === null
  ) {
    throw new TypeError("telemetry.cost must contain at least one amount");
  }
  return cost;
}

function normalizeError(value: unknown): TelemetrySafeError | null {
  if (value === null) return null;
  const record = exactPlainRecord(value, "telemetry.error", ERROR_KEYS);
  if (
    typeof record.code !== "string" ||
    record.code.length < 1 ||
    record.code.length > 64 ||
    !SAFE_ERROR_CODE.test(record.code) ||
    SECRET_SHAPE.test(record.code)
  ) {
    throw new TypeError("telemetry.error.code must be a bounded redaction-safe error code");
  }
  if (
    typeof record.classification !== "string" ||
    !ERROR_CLASSIFICATIONS.has(record.classification as TelemetryErrorClassification)
  ) {
    throw new TypeError("telemetry.error.classification is invalid");
  }
  if (typeof record.retryable !== "boolean") {
    throw new TypeError("telemetry.error.retryable must be boolean");
  }
  return Object.freeze({
    code: record.code,
    classification: record.classification as TelemetryErrorClassification,
    retryable: record.retryable,
  });
}

/** Validates and rebuilds one immutable, canonical, plain-data telemetry snapshot. */
export function normalizeTelemetryEvent(input: TelemetryEvent): TelemetryEvent {
  const record = exactPlainRecord(input, "telemetry", TOP_LEVEL_KEYS);
  if (record.schemaVersion !== TELEMETRY_EVENT_SCHEMA_VERSION) {
    throw new TypeError(`telemetry.schemaVersion must be ${TELEMETRY_EVENT_SCHEMA_VERSION}`);
  }
  const outcome = record.outcome;
  if (typeof outcome !== "string" || !OUTCOMES.has(outcome as TelemetryOutcome)) {
    throw new TypeError("telemetry.outcome is invalid");
  }
  const error = normalizeError(record.error);
  if (error !== null && outcome !== "FAILED" && outcome !== "BLOCKED") {
    throw new TypeError("telemetry.error is allowed only for FAILED or BLOCKED outcomes");
  }
  if (error === null && outcome === "FAILED") {
    throw new TypeError("FAILED telemetry requires a redaction-safe error classification");
  }
  return Object.freeze({
    schemaVersion: TELEMETRY_EVENT_SCHEMA_VERSION,
    streamId: safeToken(record.streamId, "telemetry.streamId", 128),
    sequence: positiveSafeInteger(record.sequence, "telemetry.sequence"),
    eventName: safeToken(record.eventName, "telemetry.eventName", 80),
    occurredAt: isoTimestamp(record.occurredAt),
    correlation: normalizeCorrelation(record.correlation),
    stage: safeToken(record.stage, "telemetry.stage", 64),
    providerOperation: nullableSafeToken(
      record.providerOperation,
      "telemetry.providerOperation",
      80,
    ),
    retry: normalizeRetry(record.retry),
    queueWaitMs: nullableNonNegativeFinite(record.queueWaitMs, "telemetry.queueWaitMs"),
    durationMs: nullableNonNegativeFinite(record.durationMs, "telemetry.durationMs"),
    cost: normalizeCost(record.cost),
    outcome: outcome as TelemetryOutcome,
    error,
  });
}

export function canonicalTelemetryJson(event: TelemetryEvent): string {
  return JSON.stringify(normalizeTelemetryEvent(event));
}

export class NoopTelemetryAdapter implements TelemetryPort {
  public record(event: TelemetryEvent): void {
    normalizeTelemetryEvent(event);
  }
}

export class InMemoryTelemetryAdapter implements TelemetryPort {
  readonly #events: TelemetryEvent[] = [];
  readonly #lastSequenceByStream = new Map<string, number>();

  public record(event: TelemetryEvent): void {
    const snapshot = normalizeTelemetryEvent(event);
    const previous = this.#lastSequenceByStream.get(snapshot.streamId) ?? 0;
    if (snapshot.sequence <= previous) {
      throw new RangeError(
        `telemetry sequence for ${snapshot.streamId} must be greater than ${previous}`,
      );
    }
    this.#lastSequenceByStream.set(snapshot.streamId, snapshot.sequence);
    this.#events.push(snapshot);
  }

  public snapshot(): readonly TelemetryEvent[] {
    return Object.freeze([...this.#events]);
  }
}

export interface TelemetryStreamOptions {
  readonly port: TelemetryPort;
  readonly streamId: string;
  readonly correlation: TelemetryCorrelation;
  readonly initialSequence?: number;
  readonly clock?: () => string;
}

export type TelemetryStreamEvent = Omit<
  TelemetryEvent,
  "schemaVersion" | "streamId" | "sequence" | "occurredAt" | "correlation"
>;

/** Explicit per-stream emitter. Sink/validation failures are isolated from domain work. */
export class TelemetryStream {
  readonly #port: TelemetryPort;
  readonly #streamId: string;
  readonly #correlation: TelemetryCorrelation;
  readonly #clock: () => string;
  #sequence: number;

  public constructor(options: TelemetryStreamOptions) {
    this.#port = options.port;
    this.#streamId = safeToken(options.streamId, "telemetry.streamId", 128);
    this.#correlation = normalizeCorrelation(options.correlation);
    const initialSequence = options.initialSequence ?? 0;
    if (!Number.isSafeInteger(initialSequence) || initialSequence < 0) {
      throw new TypeError("telemetry.initialSequence must be a non-negative safe integer");
    }
    this.#sequence = initialSequence;
    this.#clock = options.clock ?? (() => new Date().toISOString());
  }

  public async record(event: TelemetryStreamEvent): Promise<boolean> {
    this.#sequence += 1;
    try {
      const snapshot = normalizeTelemetryEvent({
        schemaVersion: TELEMETRY_EVENT_SCHEMA_VERSION,
        streamId: this.#streamId,
        sequence: this.#sequence,
        eventName: event.eventName,
        occurredAt: this.#clock(),
        correlation: this.#correlation,
        stage: event.stage,
        providerOperation: event.providerOperation,
        retry: event.retry,
        queueWaitMs: event.queueWaitMs,
        durationMs: event.durationMs,
        cost: event.cost,
        outcome: event.outcome,
        error: event.error,
      });
      await this.#port.record(snapshot);
      return true;
    } catch {
      return false;
    }
  }
}

export interface InstrumentedLocalOperationOptions {
  readonly operationName: string;
  readonly stage: string;
  readonly providerOperation: string | null;
  readonly retry: TelemetryRetry | null;
  readonly queueWaitMs: number | null;
  readonly cost: TelemetryCost | null;
  readonly monotonicClock?: () => number;
  readonly classifyError?: (error: unknown) => TelemetrySafeError;
}

function safeMonotonicTime(clock: () => number): number | null {
  try {
    const value = clock();
    return Number.isFinite(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}

function safeDuration(startedAt: number | null, finishedAt: number | null): number | null {
  if (startedAt === null || finishedAt === null || finishedAt < startedAt) return null;
  return finishedAt - startedAt;
}

function safeErrorClassification(
  classify: ((error: unknown) => TelemetrySafeError) | undefined,
  error: unknown,
): TelemetrySafeError {
  if (classify !== undefined) {
    try {
      return classify(error);
    } catch {
      // Classification is telemetry work and must not replace the domain error.
    }
  }
  return Object.freeze({
    code: "LOCAL_OPERATION_FAILED",
    classification: "INTERNAL",
    retryable: false,
  });
}

/** Instruments one injected fixture/local orchestration operation without changing its result. */
export async function instrumentLocalOperation<Result>(
  stream: TelemetryStream,
  options: InstrumentedLocalOperationOptions,
  operation: () => Promise<Result> | Result,
): Promise<Result> {
  const monotonicClock = options.monotonicClock ?? (() => performance.now());
  const startedAt = safeMonotonicTime(monotonicClock);
  await stream.record({
    eventName: `${options.operationName}.started`,
    stage: options.stage,
    providerOperation: options.providerOperation,
    retry: options.retry,
    queueWaitMs: options.queueWaitMs,
    durationMs: null,
    cost: options.cost,
    outcome: "STARTED",
    error: null,
  });
  try {
    const result = await operation();
    const finishedAt = safeMonotonicTime(monotonicClock);
    await stream.record({
      eventName: `${options.operationName}.succeeded`,
      stage: options.stage,
      providerOperation: options.providerOperation,
      retry: options.retry,
      queueWaitMs: options.queueWaitMs,
      durationMs: safeDuration(startedAt, finishedAt),
      cost: options.cost,
      outcome: "SUCCEEDED",
      error: null,
    });
    return result;
  } catch (error) {
    const finishedAt = safeMonotonicTime(monotonicClock);
    await stream.record({
      eventName: `${options.operationName}.failed`,
      stage: options.stage,
      providerOperation: options.providerOperation,
      retry: options.retry,
      queueWaitMs: options.queueWaitMs,
      durationMs: safeDuration(startedAt, finishedAt),
      cost: options.cost,
      outcome: "FAILED",
      error: safeErrorClassification(options.classifyError, error),
    });
    throw error;
  }
}

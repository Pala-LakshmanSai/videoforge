import {
  type RunwarePromptTransport,
  type RunwarePromptTransportRequest,
  type RunwarePromptTransportResult,
  type RunwareStyleTransport,
  type RunwareStyleTransportRequest,
  type RunwareStyleTransportResult,
} from "@videoforge/pipeline";
import { canonicalizeJson } from "@videoforge/contracts";
import { providerRetryAfterMs } from "./provider-throttle";

const DEFAULT_ENDPOINT = "https://api.runware.ai/v1";

export type RunwareTransportFailureCode =
  | "RUNWARE_AUTH_INVALID"
  | "RUNWARE_CAP_EXHAUSTED"
  | "RUNWARE_IDEMPOTENCY_CONFLICT"
  | "RUNWARE_TASK_DETAILS_UNAVAILABLE"
  | "RUNWARE_TASK_NOT_FOUND"
  | "RUNWARE_TASK_PROVIDER_FAILED"
  | "RUNWARE_TEXT_ARCHIVE_UNAVAILABLE"
  | "RUNWARE_RESPONSE_INVALID";

export class RunwareTransportError extends Error {
  constructor(readonly code: RunwareTransportFailureCode) {
    super(code);
    this.name = "RunwareTransportError";
  }
}

/** An archived admission refusal proves that this exact task never ran. */
export class RunwareArchivedTaskRejectedError extends RunwareTransportError {
  constructor(readonly responseHash: `sha256:${string}`) {
    super("RUNWARE_TASK_PROVIDER_FAILED");
  }
}

/** The provider completed this exact task, but its archive omitted the generated text. */
export class RunwareArchivedTextUnavailableError extends RunwareTransportError {
  constructor(
    readonly costUsd: number,
    readonly responseHash: `sha256:${string}`,
  ) {
    super("RUNWARE_TEXT_ARCHIVE_UNAVAILABLE");
  }
}

export async function readRunwareCreditBalance(
  apiKey: string,
  fetcher: FetchPort = fetch,
): Promise<number> {
  if (apiKey.trim().length < 20) throw new RunwareTransportError("RUNWARE_AUTH_INVALID");
  const taskUUID = crypto.randomUUID();
  const response = await fetcher(DEFAULT_ENDPOINT, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: canonicalizeJson([{ taskType: "accountManagement", taskUUID, operation: "getDetails" }]),
    signal: AbortSignal.timeout(30_000),
  });
  const body = record(JSON.parse(await response.text()));
  const rows = Array.isArray(body?.data) ? body.data.map(record) : [];
  const row = rows[0];
  const balance = typeof row?.balance === "number" ? row.balance : record(row?.balance)?.amount;
  if (
    !response.ok ||
    (Array.isArray(body?.errors) && body.errors.length > 0) ||
    rows.length !== 1 ||
    row?.taskUUID !== taskUUID ||
    row.taskType !== "accountManagement" ||
    row.operation !== "getDetails" ||
    typeof balance !== "number" ||
    !Number.isFinite(balance) ||
    balance < 0
  )
    throw new RunwareTransportError("RUNWARE_RESPONSE_INVALID");
  return balance;
}

export interface RunwareSpendSnapshot {
  readonly capUsd: number;
  readonly reservedUsd: number;
  readonly settledUsd: number;
  readonly remainingUsd: number;
}

export class RunwareSpendLedger {
  private reservedUsd = 0;
  private settledUsd = 0;

  constructor(readonly capUsd: number) {
    if (!Number.isFinite(capUsd) || capUsd <= 0) {
      throw new RangeError("Runware spend cap must be a positive finite number.");
    }
  }

  reserve(amountUsd: number): void {
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
      throw new RangeError("Runware reservation must be a positive finite number.");
    }
    if (this.reservedUsd + this.settledUsd + amountUsd > this.capUsd + Number.EPSILON) {
      throw new RunwareTransportError("RUNWARE_CAP_EXHAUSTED");
    }
    this.reservedUsd += amountUsd;
  }

  release(amountUsd: number): void {
    this.reservedUsd = Math.max(0, this.reservedUsd - amountUsd);
  }

  settle(reservationUsd: number, actualUsd: number): void {
    if (!Number.isFinite(actualUsd) || actualUsd < 0) {
      throw new RunwareTransportError("RUNWARE_RESPONSE_INVALID");
    }
    this.release(reservationUsd);
    this.settledUsd += actualUsd;
    if (this.settledUsd + this.reservedUsd > this.capUsd + Number.EPSILON) {
      throw new RunwareTransportError("RUNWARE_CAP_EXHAUSTED");
    }
  }

  snapshot(): RunwareSpendSnapshot {
    return Object.freeze({
      capUsd: this.capUsd,
      reservedUsd: this.reservedUsd,
      settledUsd: this.settledUsd,
      remainingUsd: Math.max(0, this.capUsd - this.reservedUsd - this.settledUsd),
    });
  }
}

type FetchPort = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface RunwareHttpClientOptions {
  readonly apiKey: string;
  readonly ledger: RunwareSpendLedger;
  readonly fetch?: FetchPort;
  readonly endpoint?: string;
  readonly timeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly onDiagnostic?: (diagnostic: RunwareSafeDiagnostic) => void;
  /** Persist shared cooldown only for an exact, uncharged admission refusal. */
  readonly onCapacityRefused?: (value: RunwareCapacityRefusal) => Promise<void>;
}

export interface RunwareCapacityRefusal {
  readonly taskUUID: string;
  readonly responseHash: `sha256:${string}`;
  readonly retryAfterMs: number;
}

/** Unscoped or malformed 429 responses never establish that inference did not run. */
export function exactRunwareCapacityRefusal(value: unknown, taskUUID: string): boolean {
  const body = record(value);
  if (
    !body ||
    "response" in body ||
    "cost" in body ||
    ("data" in body && (!Array.isArray(body.data) || body.data.length !== 0))
  )
    return false;
  const errors = Array.isArray(body.errors) ? body.errors : [];
  if (errors.length !== 1) return false;
  const error = record(errors[0]);
  return (
    error?.taskUUID === taskUUID &&
    error.taskType === "textInference" &&
    error.code === "concurrentRequestLimitExceeded" &&
    !("cost" in error)
  );
}

export interface RunwareSafeDiagnostic {
  readonly stage: "network" | "http" | "response";
  readonly httpStatus: number | null;
  readonly providerCode: string | null;
  readonly providerParameter: string | null;
}

type NativeData = Readonly<Record<string, unknown>>;
type NativeClientResult =
  | { readonly disposition: "succeeded"; readonly item: NativeData }
  | { readonly disposition: "ambiguous" | "failed"; readonly item: null };

function record(value: unknown): NativeData | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as NativeData)
    : null;
}

function finiteNonnegative(value: unknown): number | null {
  if (
    value === null ||
    typeof value === "boolean" ||
    (typeof value === "string" && value.trim().length === 0)
  )
    return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function safeInteger(value: unknown): number | null {
  const number = finiteNonnegative(value);
  return number !== null && Number.isSafeInteger(number) ? number : null;
}

function outputText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (record(value)) return canonicalizeJson(value as never);
  return null;
}

function redactedText(value: string): boolean {
  return /\.\.\.\[REDACTED \d+ bytes\]\.\.\./u.test(value);
}

function polledTextItem(body: NativeData | null, taskUUID: string): NativeData | null {
  if (
    !body ||
    ("errors" in body && (!Array.isArray(body.errors) || body.errors.length > 0)) ||
    !Array.isArray(body.data) ||
    body.data.length !== 1
  )
    throw new RunwareTransportError("RUNWARE_RESPONSE_INVALID");
  const item = record(body.data[0]);
  if (
    !item ||
    item.taskUUID !== taskUUID ||
    (item.taskType !== "textInference" && item.taskType !== "getResponse")
  )
    throw new RunwareTransportError("RUNWARE_IDEMPOTENCY_CONFLICT");
  if (item.status === "processing" && !("text" in item) && !("cost" in item)) return null;
  if (item.taskType !== "textInference" || (item.status !== undefined && item.status !== "success"))
    throw new RunwareTransportError("RUNWARE_RESPONSE_INVALID");
  const parsed = textResult(item);
  if (parsed.finishReason !== "stop") throw new RunwareTransportError("RUNWARE_RESPONSE_INVALID");
  return item;
}

function textResult(item: NativeData): {
  readonly usage: RunwareRecoveredTextTask["usage"];
  readonly outputText: string;
  readonly costUsd: number;
  readonly finishReason: string;
  readonly providerModel: string | null;
} {
  const usage = record(item.usage);
  const inputTokens = safeInteger(usage?.promptTokens);
  const outputTokens = safeInteger(usage?.completionTokens);
  const totalTokens = safeInteger(usage?.totalTokens);
  const cachedInputTokens = safeInteger(usage?.cachedInputTokens ?? 0);
  const completionDetails = record(usage?.completionTokensDetails);
  const reasoningValues = [usage?.reasoningTokens, usage?.thinkingTokens, completionDetails?.reasoningTokens]
    .filter((value) => value !== undefined);
  const reasoningTokens = reasoningValues.length === 0 ? undefined : safeInteger(reasoningValues[0]);
  const invalidReasoning =
    reasoningValues.length > 0 &&
    (reasoningTokens === null ||
      reasoningTokens === undefined ||
      outputTokens === null ||
      reasoningTokens > outputTokens ||
      reasoningValues.some((value) => safeInteger(value) !== reasoningTokens));
  const text = outputText(item.text);
  const costUsd = finiteNonnegative(item.cost);
  if (
    inputTokens === null ||
    outputTokens === null ||
    totalTokens === null ||
    cachedInputTokens === null ||
    cachedInputTokens > inputTokens ||
    totalTokens < inputTokens + outputTokens ||
    invalidReasoning ||
    text === null ||
    costUsd === null ||
    typeof item.finishReason !== "string"
  )
    throw new RunwareTransportError("RUNWARE_RESPONSE_INVALID");
  return Object.freeze({
    usage: Object.freeze({
      inputTokens,
      outputTokens,
      totalTokens,
      cachedInputTokens,
      ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
    }),
    outputText: text,
    costUsd,
    finishReason: item.finishReason,
    providerModel: typeof item.model === "string" ? item.model : null,
  });
}

async function sha256(value: string): Promise<`sha256:${string}`> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

export interface RunwareRecoveredTextTask {
  readonly taskUUID: string;
  readonly outputText: string;
  readonly usage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly totalTokens: number;
    readonly cachedInputTokens: number;
  };
  readonly costUsd: number;
  readonly finishReason: "stop";
  readonly providerModel: string | null;
  readonly originalRequestBytes: string;
  readonly originalRequestSha256: `sha256:${string}`;
  readonly originalResponseBytes: string;
  readonly originalResponseSha256: `sha256:${string}`;
}

export interface RetrieveRunwareTextTaskDetailsOptions {
  readonly apiKey: string;
  readonly originalTaskUUID: string;
  readonly originalRequestBytes: string;
  readonly originalRequestSha256: `sha256:${string}`;
  readonly fetch?: FetchPort;
  readonly endpoint?: string;
  readonly timeoutMs?: number;
  readonly onDiagnostic?: (diagnostic: RunwareSafeDiagnostic) => void;
}

/**
 * Reads Runware's archived task details for an already-dispatched text task.
 * Async tasks read their retrievable result first, then fall back to the archive.
 * Both operations are read-only and can never redispatch text inference.
 */
export async function retrieveRunwareTextTaskDetails(
  options: RetrieveRunwareTextTaskDetailsOptions,
): Promise<RunwareRecoveredTextTask> {
  if (options.apiKey.trim() !== options.apiKey || options.apiKey.length < 20)
    throw new RunwareTransportError("RUNWARE_AUTH_INVALID");
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1)
    throw new RangeError("Runware timeout must be a positive integer.");
  if ((await sha256(options.originalRequestBytes)) !== options.originalRequestSha256)
    throw new RunwareTransportError("RUNWARE_IDEMPOTENCY_CONFLICT");
  let expectedRequest: unknown;
  try {
    expectedRequest = JSON.parse(options.originalRequestBytes);
  } catch {
    throw new RunwareTransportError("RUNWARE_IDEMPOTENCY_CONFLICT");
  }
  if (!Array.isArray(expectedRequest) || expectedRequest.length !== 1)
    throw new RunwareTransportError("RUNWARE_IDEMPOTENCY_CONFLICT");
  const expectedTask = record(expectedRequest[0]);
  if (
    expectedTask?.taskType !== "textInference" ||
    expectedTask.taskUUID !== options.originalTaskUUID
  )
    throw new RunwareTransportError("RUNWARE_IDEMPOTENCY_CONFLICT");

  if (expectedTask.deliveryMethod === "async") {
    let polled: Response | null = null;
    try {
      const fetcher = options.fetch ?? fetch;
      polled = await fetcher(options.endpoint ?? DEFAULT_ENDPOINT, {
        method: "POST",
        headers: { authorization: `Bearer ${options.apiKey}`, "content-type": "application/json" },
        body: canonicalizeJson([{ taskType: "getResponse", taskUUID: options.originalTaskUUID }]),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      // A lost polling response permits an archive read, never another inference request.
    }
    if (polled?.ok) {
      let body: NativeData | null;
      try {
        body = record(JSON.parse(await polled.text()));
      } catch {
        throw new RunwareTransportError("RUNWARE_RESPONSE_INVALID");
      }
      const errors = Array.isArray(body?.errors) ? body.errors.map(record) : [];
      if (errors.length === 0) {
        const item = polledTextItem(body, options.originalTaskUUID);
        if (item && !redactedText(textResult(item).outputText)) {
          if (
            typeof item.model === "string" &&
            typeof expectedTask.model === "string" &&
            item.model !== expectedTask.model
          )
            throw new RunwareTransportError("RUNWARE_IDEMPOTENCY_CONFLICT");
          const parsed = textResult(item);
          const originalResponseBytes = canonicalizeJson(body as never);
          return Object.freeze({
            ...parsed,
            finishReason: "stop",
            taskUUID: options.originalTaskUUID,
            originalRequestBytes: options.originalRequestBytes,
            originalRequestSha256: options.originalRequestSha256,
            originalResponseBytes,
            originalResponseSha256: await sha256(originalResponseBytes),
          });
        }
      }
    } else if (polled?.status === 401 || polled?.status === 403) {
      throw new RunwareTransportError("RUNWARE_AUTH_INVALID");
    }
  }

  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(options.endpoint ?? DEFAULT_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${options.apiKey}`,
        "content-type": "application/json",
      },
      body: canonicalizeJson([{ taskType: "getTaskDetails", taskUUID: options.originalTaskUUID }]),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    options.onDiagnostic?.({
      stage: "network",
      httpStatus: null,
      providerCode: null,
      providerParameter: null,
    });
    throw new RunwareTransportError("RUNWARE_TASK_DETAILS_UNAVAILABLE");
  }
  if (!response.ok) {
    let providerCode: string | null = null;
    let providerParameter: string | null = null;
    try {
      const errorBody = record(JSON.parse(await response.text()));
      const first = Array.isArray(errorBody?.errors)
        ? errorBody.errors.map(record).find(Boolean)
        : null;
      providerCode = typeof first?.code === "string" ? first.code.slice(0, 80) : null;
      providerParameter =
        typeof first?.parameter === "string" ? first.parameter.slice(0, 80) : null;
    } catch {
      // Provider messages and response bodies are intentionally discarded.
    }
    options.onDiagnostic?.({
      stage: "http",
      httpStatus: response.status,
      providerCode,
      providerParameter,
    });
    if (providerCode === "taskNotFound") throw new RunwareTransportError("RUNWARE_TASK_NOT_FOUND");
    if (response.status === 401 || response.status === 403)
      throw new RunwareTransportError("RUNWARE_AUTH_INVALID");
    throw new RunwareTransportError("RUNWARE_TASK_DETAILS_UNAVAILABLE");
  }

  let envelope: NativeData | null;
  try {
    envelope = record(JSON.parse(await response.text()));
  } catch {
    throw new RunwareTransportError("RUNWARE_RESPONSE_INVALID");
  }
  const topErrors = Array.isArray(envelope?.errors)
    ? envelope.errors.map(record).filter(Boolean)
    : [];
  if (topErrors.some((error) => error?.code === "taskNotFound"))
    throw new RunwareTransportError("RUNWARE_TASK_NOT_FOUND");
  if (topErrors.length > 0 || !Array.isArray(envelope?.data))
    throw new RunwareTransportError("RUNWARE_RESPONSE_INVALID");
  const detailsRows = envelope.data.map(record).filter(Boolean);
  const details = detailsRows.find(
    (candidate) =>
      candidate?.taskType === "getTaskDetails" && candidate.taskUUID === options.originalTaskUUID,
  );
  if (!details || detailsRows.length !== 1 || !Array.isArray(details.request))
    throw new RunwareTransportError("RUNWARE_RESPONSE_INVALID");
  const recoveredTasks = details.request.map(record).filter(Boolean);
  const recoveredTask = recoveredTasks[0];
  const expectedModel = typeof expectedTask.model === "string" ? expectedTask.model : null;
  if (
    recoveredTasks.length !== 1 ||
    recoveredTask?.taskType !== "textInference" ||
    recoveredTask.taskUUID !== options.originalTaskUUID ||
    (typeof recoveredTask.model === "string" &&
      expectedModel !== null &&
      recoveredTask.model !== expectedModel)
  )
    throw new RunwareTransportError("RUNWARE_IDEMPOTENCY_CONFLICT");

  const originalResponse = record(details.response);
  if (exactRunwareCapacityRefusal(originalResponse, options.originalTaskUUID)) {
    options.onDiagnostic?.({
      stage: "response",
      httpStatus: 200,
      providerCode: "concurrentRequestLimitExceeded",
      providerParameter: null,
    });
    throw new RunwareArchivedTaskRejectedError(
      (await sha256(canonicalizeJson(originalResponse as never))) as `sha256:${string}`,
    );
  }
  const archivedProviderResponse = record(originalResponse?.response);
  const archivedProviderError = record(archivedProviderResponse?.errors);
  const archivedProviderErrorDetails = record(archivedProviderError?.additionalDetails);
  const archivedProviderStatus = archivedProviderErrorDetails?.responseStatusCode;
  if (
    originalResponse &&
    archivedProviderResponse?.taskType === "textInference" &&
    archivedProviderResponse.taskUUID === options.originalTaskUUID &&
    archivedProviderError?.errorCode === "providerUnavailable" &&
    archivedProviderStatus === 502 &&
    !("data" in archivedProviderResponse) &&
    !("data" in originalResponse) &&
    !("errors" in originalResponse)
  ) {
    options.onDiagnostic?.({
      stage: "response",
      httpStatus: 502,
      providerCode: "providerUnavailable",
      providerParameter: null,
    });
    throw new RunwareTransportError("RUNWARE_TASK_PROVIDER_FAILED");
  }
  if (
    !originalResponse ||
    ("errors" in originalResponse &&
      (!Array.isArray(originalResponse.errors) || originalResponse.errors.length > 0)) ||
    "response" in originalResponse ||
    !Array.isArray(originalResponse.data)
  )
    throw new RunwareTransportError("RUNWARE_RESPONSE_INVALID");
  const originalRows = originalResponse.data.map(record).filter(Boolean);
  const result = originalRows.find((candidate) => candidate?.taskUUID === options.originalTaskUUID);
  if (!result || originalRows.length !== 1)
    throw new RunwareTransportError("RUNWARE_RESPONSE_INVALID");
  if (result.taskType !== undefined && result.taskType !== "textInference")
    throw new RunwareTransportError("RUNWARE_IDEMPOTENCY_CONFLICT");
  if (typeof result.model === "string" && expectedModel !== null && result.model !== expectedModel)
    throw new RunwareTransportError("RUNWARE_IDEMPOTENCY_CONFLICT");
  const parsed = textResult(result);
  // A terminal token limit confirms that this task has no complete result to recover.
  // Keep incomplete output rejected and let the existing explicit bounded Retry create a new task.
  if (parsed.finishReason === "length")
    throw new RunwareTransportError("RUNWARE_TASK_PROVIDER_FAILED");
  if (parsed.finishReason !== "stop") throw new RunwareTransportError("RUNWARE_RESPONSE_INVALID");
  const originalResponseBytes = canonicalizeJson(originalResponse as never);
  if (redactedText(parsed.outputText) && result.taskType !== "textInference")
    throw new RunwareTransportError("RUNWARE_RESPONSE_INVALID");
  if (redactedText(parsed.outputText))
    throw new RunwareArchivedTextUnavailableError(
      parsed.costUsd,
      await sha256(originalResponseBytes),
    );
  return Object.freeze({
    taskUUID: options.originalTaskUUID,
    outputText: parsed.outputText,
    usage: parsed.usage,
    costUsd: parsed.costUsd,
    finishReason: "stop",
    providerModel: parsed.providerModel,
    originalRequestBytes: options.originalRequestBytes,
    originalRequestSha256: options.originalRequestSha256,
    originalResponseBytes,
    originalResponseSha256: await sha256(originalResponseBytes),
  });
}

class RunwareHttpClient {
  private readonly fetch: FetchPort;
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly requestHashesByTask = new Map<string, string>();
  private readonly replays = new Map<string, Promise<NativeClientResult>>();

  constructor(private readonly options: RunwareHttpClientOptions) {
    if (options.apiKey.trim() !== options.apiKey || options.apiKey.length < 20) {
      throw new RunwareTransportError("RUNWARE_AUTH_INVALID");
    }
    this.fetch = options.fetch ?? fetch;
    this.endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.pollIntervalMs = options.pollIntervalMs ?? 3_000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1) {
      throw new RangeError("Runware timeout must be a positive integer.");
    }
    if (!Number.isSafeInteger(this.pollIntervalMs) || this.pollIntervalMs < 1)
      throw new RangeError("Runware polling interval must be a positive integer.");
  }

  request(
    taskUUID: string,
    requestSha256: string,
    requestBytes: string,
    reservationUsd: number,
  ): Promise<NativeClientResult> {
    const priorHash = this.requestHashesByTask.get(taskUUID);
    if (priorHash && priorHash !== requestSha256) {
      throw new RunwareTransportError("RUNWARE_IDEMPOTENCY_CONFLICT");
    }
    const replay = this.replays.get(requestSha256);
    if (replay) return replay;
    this.requestHashesByTask.set(taskUUID, requestSha256);
    const pending = this.dispatch(taskUUID, requestSha256, requestBytes, reservationUsd);
    this.replays.set(requestSha256, pending);
    return pending;
  }

  private async dispatch(
    taskUUID: string,
    requestSha256: string,
    requestBytes: string,
    reservationUsd: number,
  ): Promise<NativeClientResult> {
    const tasks: unknown = JSON.parse(requestBytes);
    const task = Array.isArray(tasks) && tasks.length === 1 ? record(tasks[0]) : null;
    const asynchronous = task?.deliveryMethod === "async";
    if (
      asynchronous &&
      (task.taskUUID !== taskUUID ||
        task.taskType !== "textInference" ||
        (await sha256(requestBytes)) !== requestSha256)
    )
      throw new RunwareTransportError("RUNWARE_IDEMPOTENCY_CONFLICT");
    this.options.ledger.reserve(reservationUsd);
    const deadline = Date.now() + this.timeoutMs;
    let response: Response;
    try {
      // Native Worker fetch must be called as a function. Calling the stored port as
      // `this.fetch(...)` supplies the Runware client as its receiver and Cloudflare
      // rejects the invocation before any HTTP response exists.
      const fetcher = this.fetch;
      response = await fetcher(this.endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          "content-type": "application/json",
        },
        body: requestBytes,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      this.options.onDiagnostic?.({
        stage: "network",
        httpStatus: null,
        providerCode: null,
        providerParameter: null,
      });
      return { disposition: "ambiguous", item: null };
    }

    if (!response.ok) {
      let providerCode: string | null = null;
      let providerParameter: string | null = null;
      let errorBody: NativeData | null = null;
      let responseBytes = "";
      try {
        responseBytes = await response.text();
        errorBody = record(JSON.parse(responseBytes));
        const errorItems = Array.isArray(errorBody?.errors)
          ? errorBody.errors.map(record).filter(Boolean)
          : [];
        const first = errorItems[0];
        providerCode = typeof first?.code === "string" ? first.code.slice(0, 80) : null;
        providerParameter =
          typeof first?.parameter === "string" ? first.parameter.slice(0, 80) : null;
      } catch {
        // Only bounded provider codes are diagnostic; bodies and messages remain discarded.
      }
      this.options.onDiagnostic?.({
        stage: "http",
        httpStatus: response.status,
        providerCode,
        providerParameter,
      });
      if (
        response.status === 429 ||
        (response.status === 400 && providerCode === "concurrentRequestLimitExceeded")
      ) {
        if (exactRunwareCapacityRefusal(errorBody, taskUUID)) {
          this.options.ledger.release(reservationUsd);
          await this.options.onCapacityRefused?.({
            taskUUID,
            responseHash: await sha256(canonicalizeJson(errorBody as never)),
            retryAfterMs: providerRetryAfterMs(response.headers.get("retry-after")),
          });
        }
        // Keep the original identity for archive reconciliation. Never treat throttling as bad output.
        return { disposition: "ambiguous", item: null };
      }
      if (response.status >= 400 && response.status < 500) {
        this.options.ledger.release(reservationUsd);
        return { disposition: "failed", item: null };
      }
      return { disposition: "ambiguous", item: null };
    }

    let body: NativeData | null;
    try {
      body = record(JSON.parse(await response.text()));
    } catch {
      return { disposition: "ambiguous", item: null };
    }
    const errors = Array.isArray(body?.errors) ? body.errors.map(record).filter(Boolean) : [];
    if (errors.length > 0) {
      const first = errors[0];
      this.options.onDiagnostic?.({
        stage: "response",
        httpStatus: response.status,
        providerCode: typeof first?.code === "string" ? first.code.slice(0, 80) : null,
        providerParameter:
          typeof first?.parameter === "string" ? first.parameter.slice(0, 80) : null,
      });
      // Native errors may arrive with HTTP 200. Persist only the same exact,
      // uncharged refusal accepted by the HTTP 429 path; keep its UUID for review.
      if (first?.code === "concurrentRequestLimitExceeded") {
        if (exactRunwareCapacityRefusal(body, taskUUID)) {
          this.options.ledger.release(reservationUsd);
          await this.options.onCapacityRefused?.({
            taskUUID,
            responseHash: await sha256(canonicalizeJson(body as never)),
            retryAfterMs: providerRetryAfterMs(response.headers.get("retry-after")),
          });
        }
        return { disposition: "ambiguous", item: null };
      }
      this.options.ledger.release(reservationUsd);
      return { disposition: "failed", item: null };
    }
    const data = Array.isArray(body?.data) ? body.data.map(record).filter(Boolean) : [];
    const item = data.find((candidate) => candidate?.taskUUID === taskUUID) ?? null;
    if (
      !item ||
      (asynchronous &&
        ((body?.data instanceof Array && body.data.length !== 1) ||
          data.length !== 1 ||
          item.taskType !== "textInference" ||
          ("errors" in (body ?? {}) && !Array.isArray(body?.errors))))
    )
      return { disposition: "ambiguous", item: null };
    if (asynchronous) {
      if (
        !("text" in item) &&
        !("cost" in item) &&
        !("usage" in item) &&
        (item.status === undefined || item.status === "processing")
      )
        return this.poll(taskUUID, reservationUsd, deadline);
      try {
        const completed = polledTextItem(body, taskUUID);
        if (completed && redactedText(textResult(completed).outputText))
          return { disposition: "ambiguous", item: null };
      } catch {
        return { disposition: "ambiguous", item: null };
      }
    }
    const cost = finiteNonnegative(item.cost);
    if (cost === null) return { disposition: "ambiguous", item: null };
    this.options.ledger.settle(reservationUsd, cost);
    return { disposition: "succeeded", item };
  }

  private async poll(
    taskUUID: string,
    reservationUsd: number,
    deadline: number,
  ): Promise<NativeClientResult> {
    while (Date.now() < deadline) {
      let item: NativeData | null;
      try {
        const fetcher = this.fetch;
        const response = await fetcher(this.endpoint, {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.options.apiKey}`,
            "content-type": "application/json",
          },
          body: canonicalizeJson([{ taskType: "getResponse", taskUUID }]),
          signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
        });
        if (!response.ok) return { disposition: "ambiguous", item: null };
        item = polledTextItem(record(JSON.parse(await response.text())), taskUUID);
      } catch {
        return { disposition: "ambiguous", item: null };
      }
      if (item) {
        if (redactedText(textResult(item).outputText))
          return { disposition: "ambiguous", item: null };
        this.options.ledger.settle(reservationUsd, textResult(item).costUsd);
        return { disposition: "succeeded", item };
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await new Promise((resolve) => setTimeout(resolve, Math.min(this.pollIntervalMs, remaining)));
    }
    return { disposition: "ambiguous", item: null };
  }
}

export interface RunwarePromptHttpTransportOptions extends RunwareHttpClientOptions {
  readonly maximumRequestCostUsd: number;
}

export class RunwarePromptHttpTransport implements RunwarePromptTransport {
  private readonly client: RunwareHttpClient;

  constructor(private readonly options: RunwarePromptHttpTransportOptions) {
    this.client = new RunwareHttpClient(options);
  }

  async dispatch(request: RunwarePromptTransportRequest): Promise<RunwarePromptTransportResult> {
    const started = performance.now();
    const result = await this.client.request(
      request.request.taskUUID,
      request.requestSha256,
      request.requestBytes,
      this.options.maximumRequestCostUsd,
    );
    if (result.disposition !== "succeeded") {
      return { status: result.disposition, latencyMs: Math.round(performance.now() - started) };
    }
    const parsed = textResult(result.item);
    return {
      status: "succeeded",
      outputText: parsed.outputText,
      latencyMs: Math.round(performance.now() - started),
      usage: parsed.usage,
      costUsd: parsed.costUsd,
      finishReason: parsed.finishReason,
      providerModel: parsed.providerModel,
    };
  }
}

export interface RunwareStyleHttpTransportOptions extends RunwareHttpClientOptions {
  readonly maximumRequestCostUsd: number;
}

export class RunwareStyleHttpTransport implements RunwareStyleTransport {
  private readonly client: RunwareHttpClient;

  constructor(private readonly options: RunwareStyleHttpTransportOptions) {
    this.client = new RunwareHttpClient(options);
  }

  async dispatch(request: RunwareStyleTransportRequest): Promise<RunwareStyleTransportResult> {
    const started = performance.now();
    const result = await this.client.request(
      request.request.taskUUID,
      request.requestSha256,
      request.requestBytes,
      this.options.maximumRequestCostUsd,
    );
    if (result.disposition !== "succeeded") {
      return { status: result.disposition, latencyMs: Math.round(performance.now() - started) };
    }
    const { item } = result;
    const usage = record(item.usage);
    const completionDetails = record(usage?.completionTokensDetails);
    const promptTokens = safeInteger(usage?.promptTokens);
    const completionTokens = safeInteger(usage?.completionTokens);
    const totalTokens = safeInteger(usage?.totalTokens);
    const reasoningTokens = safeInteger(completionDetails?.reasoningTokens ?? 0);
    const text = outputText(item.text);
    const costUsd = finiteNonnegative(item.cost);
    if (
      promptTokens === null ||
      completionTokens === null ||
      totalTokens === null ||
      reasoningTokens === null ||
      text === null ||
      costUsd === null ||
      typeof item.finishReason !== "string" ||
      typeof item.taskUUID !== "string" ||
      typeof item.taskType !== "string"
    ) {
      throw new RunwareTransportError("RUNWARE_RESPONSE_INVALID");
    }
    return {
      status: "succeeded",
      taskUUID: item.taskUUID,
      taskType: item.taskType,
      outputText: text,
      latencyMs: Math.round(performance.now() - started),
      usage: { promptTokens, completionTokens, totalTokens, reasoningTokens },
      costUsd,
      finishReason: item.finishReason,
      providerModel: typeof item.model === "string" ? item.model : null,
    };
  }
}

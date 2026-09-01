import {
  type RunwarePromptTransport,
  type RunwarePromptTransportRequest,
  type RunwarePromptTransportResult,
  type RunwareStyleTransport,
  type RunwareStyleTransportRequest,
  type RunwareStyleTransportResult,
} from "@videoforge/pipeline";
import { canonicalizeJson } from "@videoforge/contracts";

const DEFAULT_ENDPOINT = "https://api.runware.ai/v1";

export type RunwareTransportFailureCode =
  | "RUNWARE_AUTH_INVALID"
  | "RUNWARE_CAP_EXHAUSTED"
  | "RUNWARE_IDEMPOTENCY_CONFLICT"
  | "RUNWARE_TASK_DETAILS_UNAVAILABLE"
  | "RUNWARE_TASK_NOT_FOUND"
  | "RUNWARE_RESPONSE_INVALID";

export class RunwareTransportError extends Error {
  constructor(readonly code: RunwareTransportFailureCode) {
    super(code);
    this.name = "RunwareTransportError";
  }
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
  readonly onDiagnostic?: (diagnostic: RunwareSafeDiagnostic) => void;
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
 * This sends only getTaskDetails and can never redispatch text inference.
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
  const recoveredRequestBytes = canonicalizeJson(details.request as never);
  if (
    recoveredRequestBytes !== options.originalRequestBytes ||
    (await sha256(recoveredRequestBytes)) !== options.originalRequestSha256
  )
    throw new RunwareTransportError("RUNWARE_IDEMPOTENCY_CONFLICT");

  const originalResponse = record(details.response);
  if (
    !originalResponse ||
    originalResponse.errors !== undefined ||
    !Array.isArray(originalResponse.data)
  )
    throw new RunwareTransportError("RUNWARE_RESPONSE_INVALID");
  const originalRows = originalResponse.data.map(record).filter(Boolean);
  const result = originalRows.find(
    (candidate) =>
      candidate?.taskType === "textInference" && candidate.taskUUID === options.originalTaskUUID,
  );
  if (!result || originalRows.length !== 1)
    throw new RunwareTransportError("RUNWARE_RESPONSE_INVALID");
  const usage = record(result.usage);
  const inputTokens = safeInteger(usage?.promptTokens);
  const outputTokens = safeInteger(usage?.completionTokens);
  const totalTokens = safeInteger(usage?.totalTokens);
  const cachedInputTokens = safeInteger(usage?.cachedInputTokens ?? 0);
  const text = outputText(result.text);
  const costUsd = finiteNonnegative(result.cost);
  if (
    inputTokens === null ||
    outputTokens === null ||
    totalTokens === null ||
    cachedInputTokens === null ||
    totalTokens < inputTokens + outputTokens ||
    cachedInputTokens > inputTokens ||
    text === null ||
    costUsd === null ||
    result.finishReason !== "stop"
  )
    throw new RunwareTransportError("RUNWARE_RESPONSE_INVALID");
  const expectedModel = typeof expectedTask.model === "string" ? expectedTask.model : null;
  const providerModel = typeof result.model === "string" ? result.model : null;
  if (providerModel !== null && expectedModel !== null && providerModel !== expectedModel)
    throw new RunwareTransportError("RUNWARE_RESPONSE_INVALID");
  const originalResponseBytes = canonicalizeJson(originalResponse as never);
  return Object.freeze({
    taskUUID: options.originalTaskUUID,
    outputText: text,
    usage: Object.freeze({ inputTokens, outputTokens, totalTokens, cachedInputTokens }),
    costUsd,
    finishReason: "stop",
    providerModel,
    originalRequestBytes: recoveredRequestBytes,
    originalRequestSha256: options.originalRequestSha256,
    originalResponseBytes,
    originalResponseSha256: await sha256(originalResponseBytes),
  });
}

class RunwareHttpClient {
  private readonly fetch: FetchPort;
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly requestHashesByTask = new Map<string, string>();
  private readonly replays = new Map<string, Promise<NativeClientResult>>();

  constructor(private readonly options: RunwareHttpClientOptions) {
    if (options.apiKey.trim() !== options.apiKey || options.apiKey.length < 20) {
      throw new RunwareTransportError("RUNWARE_AUTH_INVALID");
    }
    this.fetch = options.fetch ?? fetch;
    this.endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
    this.timeoutMs = options.timeoutMs ?? 120_000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1) {
      throw new RangeError("Runware timeout must be a positive integer.");
    }
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
    const pending = this.dispatch(taskUUID, requestBytes, reservationUsd);
    this.replays.set(requestSha256, pending);
    return pending;
  }

  private async dispatch(
    taskUUID: string,
    requestBytes: string,
    reservationUsd: number,
  ): Promise<NativeClientResult> {
    this.options.ledger.reserve(reservationUsd);
    let response: Response;
    try {
      response = await this.fetch(this.endpoint, {
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
      try {
        const errorBody = record(JSON.parse(await response.text()));
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
      this.options.ledger.release(reservationUsd);
      this.options.onDiagnostic?.({
        stage: "response",
        httpStatus: response.status,
        providerCode: typeof first?.code === "string" ? first.code.slice(0, 80) : null,
        providerParameter:
          typeof first?.parameter === "string" ? first.parameter.slice(0, 80) : null,
      });
      return { disposition: "failed", item: null };
    }
    const data = Array.isArray(body?.data) ? body.data.map(record).filter(Boolean) : [];
    const item = data.find((candidate) => candidate?.taskUUID === taskUUID) ?? null;
    if (!item || body?.errors !== undefined) return { disposition: "ambiguous", item: null };
    const cost = finiteNonnegative(item.cost);
    if (cost === null) return { disposition: "ambiguous", item: null };
    this.options.ledger.settle(reservationUsd, cost);
    return { disposition: "succeeded", item };
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
    const { item } = result;
    const usage = record(item.usage);
    const inputTokens = safeInteger(usage?.promptTokens);
    const outputTokens = safeInteger(usage?.completionTokens);
    const totalTokens = safeInteger(usage?.totalTokens);
    const cachedInputTokens = safeInteger(usage?.cachedInputTokens ?? 0);
    const text = outputText(item.text);
    const costUsd = finiteNonnegative(item.cost);
    if (
      inputTokens === null ||
      outputTokens === null ||
      totalTokens === null ||
      cachedInputTokens === null ||
      text === null ||
      costUsd === null ||
      typeof item.finishReason !== "string"
    ) {
      throw new RunwareTransportError("RUNWARE_RESPONSE_INVALID");
    }
    return {
      status: "succeeded",
      outputText: text,
      latencyMs: Math.round(performance.now() - started),
      usage: { inputTokens, outputTokens, totalTokens, cachedInputTokens },
      costUsd,
      finishReason: item.finishReason,
      providerModel: typeof item.model === "string" ? item.model : null,
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

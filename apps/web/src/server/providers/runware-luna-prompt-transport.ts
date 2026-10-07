import {
  type RunwarePromptTransport,
  type RunwarePromptTransportRequest,
  type RunwarePromptTransportResult,
} from "@videoforge/pipeline";
import { canonicalizeJson } from "@videoforge/contracts";
import {
  exactRunwareCapacityRefusal,
  RunwareSpendLedger,
  type RunwareCapacityRefusal,
} from "./runware-http-transport";
import { providerRetryAfterMs } from "./provider-throttle";

const DEFAULT_ENDPOINT = "https://api.runware.ai/v1/chat/completions";
const MODEL = "openai:gpt@6-luna";
const MAX_COST_USD = 0.25;
const INPUT_OVERHEAD_TOKENS = 6_144;
const MAX_INPUT_TOKENS = 48_000;
const MAX_COMPLETION_TOKENS = 6_144;
const RESPONSE_ID = /^chatcmpl-[A-Za-z0-9_-]{1,240}$/u;

type FetchPort = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type JsonRecord = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function consistentCounter(values: readonly unknown[], fallback: number): number | null {
  const present = values.filter((value) => value !== undefined);
  if (present.length === 0) return fallback;
  const normalized = present.map(safeInteger);
  if (normalized.some((value) => value === null)) return null;
  const first = normalized[0]!;
  return normalized.every((value) => value === first) ? first : null;
}

async function sha256(value: string): Promise<`sha256:${string}`> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

export interface RunwareLunaPromptWireRequest {
  readonly body: Readonly<Record<string, unknown>>;
  readonly bytes: string;
  readonly wireHash: `sha256:${string}`;
}

/** Convert the sealed Runware envelope into the native OpenAI-compatible request. */
export async function buildRunwareLunaPromptWireRequest(
  request: RunwarePromptTransportRequest,
): Promise<RunwareLunaPromptWireRequest> {
  if (
    (await sha256(request.requestBytes)) !== request.requestSha256 ||
    canonicalizeJson([request.request]) !== request.requestBytes
  )
    throw new RunwareLunaSubmissionUnknownError("sealed_request_mismatch");
  const task = request.request;
  const userMessage = task.messages?.[0];
  const sourceSchema = task.jsonSchema;
  if (
    task.taskType !== "textInference" ||
    task.model !== MODEL ||
    typeof task.settings?.systemPrompt !== "string" ||
    task.settings?.thinkingLevel !== "low" ||
    !Number.isSafeInteger(task.settings?.maxTokens) ||
    task.settings.maxTokens < 1 ||
    task.outputFormat !== "JSON" ||
    !isRecord(sourceSchema) ||
    typeof sourceSchema.name !== "string" ||
    sourceSchema.strict !== true ||
    !isRecord(sourceSchema.schema) ||
    !userMessage ||
    userMessage.role !== "user" ||
    typeof userMessage.content !== "string"
  )
    throw new RunwareLunaSubmissionUnknownError("sealed_request_invalid");

  const body = Object.freeze({
    model: MODEL,
    messages: [
      { role: "system", content: task.settings.systemPrompt },
      { role: "user", content: userMessage.content },
    ],
    max_completion_tokens: task.settings.maxTokens,
    reasoning_effort: "low",
    response_format: {
      type: "json_schema",
      json_schema: {
        name: sourceSchema.name,
        schema: sourceSchema.schema,
        strict: true,
      },
    },
  });
  const bytes = canonicalizeJson(body as never);
  return Object.freeze({ body, bytes, wireHash: await sha256(bytes) });
}

export class RunwareLunaSubmissionUnknownError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "RunwareLunaSubmissionUnknownError";
  }
}

export class RunwareLunaRejectedError extends Error {
  readonly billed = false;

  constructor(
    readonly httpStatus: number,
    readonly providerCode: string | null,
    readonly responseHash: `sha256:${string}`,
    readonly retryAfterMs: number,
  ) {
    super("RUNWARE_LUNA_REQUEST_REJECTED");
    this.name = "RunwareLunaRejectedError";
  }
}

export interface RunwareLunaPromptHttpTransportOptions {
  readonly apiKey: string;
  readonly ledger: RunwareSpendLedger;
  readonly maximumRequestCostUsd: number;
  readonly fetch?: FetchPort;
  readonly endpoint?: string;
  readonly timeoutMs?: number;
  readonly onCapacityRefused?: (value: RunwareCapacityRefusal) => Promise<void>;
}

function usageResult(value: unknown): {
  readonly usage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly totalTokens: number;
    readonly cachedInputTokens: number;
    readonly cacheWriteTokens: number;
    readonly reasoningTokens: number;
  };
  readonly estimatedCostMicroUsd: number;
} | null {
  if (!isRecord(value)) return null;
  if (
    (value.prompt_tokens_details !== undefined && !isRecord(value.prompt_tokens_details)) ||
    (value.completion_tokens_details !== undefined && !isRecord(value.completion_tokens_details))
  )
    return null;
  const promptDetails = isRecord(value.prompt_tokens_details) ? value.prompt_tokens_details : {};
  const completionDetails = isRecord(value.completion_tokens_details)
    ? value.completion_tokens_details
    : {};
  const inputTokens = safeInteger(value.prompt_tokens);
  const outputTokens = safeInteger(value.completion_tokens);
  const totalTokens = safeInteger(value.total_tokens);
  const cachedInputTokens = consistentCounter(
    [
      value.cached_input_tokens,
      value.cachedInputTokens,
      value.cached_tokens,
      promptDetails.cached_tokens,
      promptDetails.cached_input_tokens,
    ],
    0,
  );
  const cacheWriteTokens = consistentCounter(
    [
      value.cache_write_tokens,
      value.cacheWriteTokens,
      promptDetails.cache_write_tokens,
      promptDetails.cacheWriteTokens,
      promptDetails.cache_creation_tokens,
      promptDetails.cache_creation_input_tokens,
    ],
    0,
  );
  const reasoningTokens = consistentCounter(
    [
      value.reasoning_tokens,
      value.reasoningTokens,
      completionDetails.reasoning_tokens,
      completionDetails.reasoningTokens,
    ],
    0,
  );
  if (
    inputTokens === null ||
    outputTokens === null ||
    totalTokens === null ||
    cachedInputTokens === null ||
    cacheWriteTokens === null ||
    reasoningTokens === null ||
    cachedInputTokens + cacheWriteTokens > inputTokens ||
    reasoningTokens > outputTokens ||
    totalTokens !== inputTokens + outputTokens
  )
    return null;
  const uncachedInputTokens = inputTokens - cachedInputTokens - cacheWriteTokens;
  const weightedMicroUsd =
    uncachedInputTokens * 100 +
    cachedInputTokens * 10 +
    cacheWriteTokens * 125 +
    outputTokens * 500;
  if (!Number.isSafeInteger(weightedMicroUsd)) return null;
  const estimatedCostMicroUsd = Math.ceil(weightedMicroUsd / 1_000);
  if (!Number.isSafeInteger(estimatedCostMicroUsd)) return null;
  return {
    usage: {
      inputTokens,
      outputTokens,
      totalTokens,
      cachedInputTokens,
      cacheWriteTokens,
      reasoningTokens,
    },
    estimatedCostMicroUsd,
  };
}

function providerErrorCode(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const error = isRecord(value.error) ? value.error : value;
  const code = error.code ?? error.type;
  return typeof code === "string"
    ? code.replace(/[^a-zA-Z0-9_.-]/gu, "").slice(0, 80) || null
    : null;
}

function isKnownCapacityRefusal(value: unknown, taskUUID: string): boolean {
  if (exactRunwareCapacityRefusal(value, taskUUID)) return true;
  if (!isRecord(value) || !isRecord(value.error)) return false;
  return value.error.code === "rate_limit_exceeded" && value.error.type === "rate_limit_error";
}

export class RunwareLunaPromptHttpTransport implements RunwarePromptTransport {
  private readonly fetcher: FetchPort;
  private readonly timeoutMs: number;
  private readonly endpoint: string;

  constructor(private readonly options: RunwareLunaPromptHttpTransportOptions) {
    if (options.apiKey.trim() !== options.apiKey || options.apiKey.length < 20)
      throw new TypeError("Runware API key is invalid.");
    if (
      !Number.isFinite(options.maximumRequestCostUsd) ||
      options.maximumRequestCostUsd <= 0 ||
      options.maximumRequestCostUsd > MAX_COST_USD
    )
      throw new RangeError("Luna request cap must be in (0, 0.25] USD.");
    this.fetcher = options.fetch ?? fetch;
    this.endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
    this.timeoutMs = options.timeoutMs ?? 300_000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1)
      throw new RangeError("Luna request timeout must be a positive integer.");
  }

  async dispatch(request: RunwarePromptTransportRequest): Promise<RunwarePromptTransportResult> {
    const started = performance.now();
    const wire = await buildRunwareLunaPromptWireRequest(request);
    const inputBytes = new TextEncoder().encode(
      request.request.settings.systemPrompt + request.request.messages[0].content,
    ).byteLength;
    const inputTokenBound = inputBytes + INPUT_OVERHEAD_TOKENS;
    const maxCompletionTokens = request.request.settings.maxTokens;
    if (inputTokenBound > MAX_INPUT_TOKENS || maxCompletionTokens > MAX_COMPLETION_TOKENS)
      throw new RunwareLunaSubmissionUnknownError("preflight_token_bound_exceeded");
    const reservedMicroUsd = Math.ceil((inputTokenBound * 125 + maxCompletionTokens * 500) / 1_000);
    const reservationUsd = reservedMicroUsd / 1_000_000;
    if (reservationUsd > this.options.maximumRequestCostUsd)
      throw new RunwareLunaSubmissionUnknownError("preflight_cost_cap_exceeded");
    this.options.ledger.reserve(reservationUsd);

    let response: Response;
    try {
      // Workers fetch rejects a transport instance as its receiver.
      const fetcher = this.fetcher;
      response = await fetcher(this.endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          "content-type": "application/json",
        },
        body: wire.bytes,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new RunwareLunaSubmissionUnknownError("post_outcome_unknown");
    }

    let responseBytes: string;
    try {
      responseBytes = await response.text();
    } catch {
      throw new RunwareLunaSubmissionUnknownError("response_body_unavailable");
    }
    const wireHash = await sha256(responseBytes);
    let body: unknown;
    try {
      body = JSON.parse(responseBytes);
    } catch {
      if (!response.ok && response.status >= 400 && response.status < 500) {
        this.options.ledger.release(reservationUsd);
        throw new RunwareLunaRejectedError(
          response.status,
          null,
          wireHash,
          providerRetryAfterMs(response.headers.get("retry-after")),
        );
      }
      throw new RunwareLunaSubmissionUnknownError("response_body_invalid");
    }
    if (!response.ok) {
      const code = providerErrorCode(body);
      if (response.status >= 400 && response.status < 500) {
        this.options.ledger.release(reservationUsd);
        if (response.status === 429 && isKnownCapacityRefusal(body, request.request.taskUUID))
          await this.options.onCapacityRefused?.({
            taskUUID: request.request.taskUUID,
            responseHash: wireHash,
            retryAfterMs: providerRetryAfterMs(response.headers.get("retry-after")),
          });
        throw new RunwareLunaRejectedError(
          response.status,
          code,
          wireHash,
          providerRetryAfterMs(response.headers.get("retry-after")),
        );
      }
      throw new RunwareLunaSubmissionUnknownError("server_outcome_unknown");
    }

    const record = isRecord(body) ? body : null;
    const responseId = typeof record?.id === "string" ? record.id : null;
    const model = typeof record?.model === "string" ? record.model : null;
    const choices = Array.isArray(record?.choices) ? record.choices : [];
    const choice = isRecord(choices[0]) ? choices[0] : null;
    const message = isRecord(choice?.message) ? choice.message : null;
    if (
      !responseId ||
      !RESPONSE_ID.test(responseId) ||
      model !== MODEL ||
      choices.length !== 1 ||
      choice?.index !== 0 ||
      message?.role !== "assistant"
    )
      throw new RunwareLunaSubmissionUnknownError("response_identity_invalid");

    const usage = usageResult(record?.usage);
    const content = typeof message.content === "string" ? message.content : "";
    const refusal = typeof message.refusal === "string" && message.refusal.length > 0;
    const finishReason =
      refusal || choice.finish_reason === "content_filter"
        ? "refusal"
        : typeof choice.finish_reason === "string"
          ? choice.finish_reason
          : "provider_contract_violation";
    if (!usage) throw new RunwareLunaSubmissionUnknownError("usage_invalid");
    if (
      usage.usage.inputTokens > inputTokenBound ||
      usage.usage.outputTokens > maxCompletionTokens ||
      usage.estimatedCostMicroUsd > reservedMicroUsd
    )
      throw new RunwareLunaSubmissionUnknownError("usage_exceeds_reservation");

    const estimatedCostMicroUsd = usage.estimatedCostMicroUsd;
    const costUsd = estimatedCostMicroUsd / 1_000_000;
    this.options.ledger.settle(reservationUsd, costUsd);
    const result = {
      status: "succeeded" as const,
      outputText: refusal ? String(message.refusal) : content,
      latencyMs: Math.round(performance.now() - started),
      usage: usage.usage,
      costUsd,
      estimatedCostMicroUsd,
      costBasis: "PINNED_RATE_ESTIMATE" as const,
      finishReason,
      providerModel: model,
      responseId,
      wireHash: wire.wireHash,
    };
    return result;
  }
}

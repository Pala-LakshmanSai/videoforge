import {
  buildStyleAnalyzerRequest,
  IMAGE_STYLE_ANALYZER_SYSTEM_PROMPT,
  RUNWARE_GEMINI_STYLE_PROVIDER_SCHEMA,
  validateAndAssembleStyleProfile,
  type StyleReferenceBinding,
  type TrustedStyleProfile,
} from "@videoforge/pipeline";
import { parseJsonStrict } from "@videoforge/contracts";

export const RUNWARE_GEMINI_STYLE_MODEL = "google:gemini@3.1-flash-lite" as const;
export const RUNWARE_GEMINI_STYLE_MAX_OUTPUT_TOKENS = 6_000 as const;
// Inline base64 expands by 4/3; keep the full JSON body safely below Runware's request limit.
export const RUNWARE_GEMINI_STYLE_MAX_INPUT_BYTES = 30 * 1024 * 1024;
export const RUNWARE_GEMINI_STYLE_RESERVATION_MICRO_USD = 20_000 as const;
export const RUNWARE_GEMINI_STYLE_RESERVATION_USD =
  RUNWARE_GEMINI_STYLE_RESERVATION_MICRO_USD / 1_000_000;

export interface RunwareGeminiStyleImage {
  readonly alias: string;
  readonly mimeType: "image/webp";
  readonly sha256: `sha256:${string}`;
  readonly width: number;
  readonly height: number;
  readonly bytes: Uint8Array;
}

export interface RunwareGeminiStyleUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

export interface RunwareGeminiStyleAnalysisResult {
  readonly trusted: TrustedStyleProfile;
  readonly responseSha256: string;
  readonly usage: RunwareGeminiStyleUsage;
  readonly providerRequestId: string | null;
  readonly costUsd: number;
  readonly latencyMs: number;
  readonly model: typeof RUNWARE_GEMINI_STYLE_MODEL;
}

export function runwareGeminiStyleActualCostMicroUsd(costUsd: number): number {
  if (
    !Number.isFinite(costUsd) ||
    costUsd < 0 ||
    costUsd > RUNWARE_GEMINI_STYLE_RESERVATION_USD
  )
    throw new RangeError("Runware style analysis cost exceeds its reservation.");
  return Math.ceil(costUsd * 1_000_000);
}

export class RunwareGeminiStyleAnalysisError extends Error {
  constructor(
    readonly code:
      | "UNAVAILABLE"
      | "INPUT_REJECTED"
      | "PROVIDER_REJECTED"
      | "INVALID_RESPONSE"
      | "AMBIGUOUS",
  ) {
    super(code);
    this.name = "RunwareGeminiStyleAnalysisError";
  }
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function safeToken(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

function diagnosticToken(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 160) return null;
  return /^[a-z0-9_.:/@-]+$/iu.test(value) ? value : null;
}

function providerProblem(value: unknown): {
  readonly code: string | null;
  readonly parameter: string | null;
  readonly type: string | null;
} {
  const payload = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
  const first = payload && Array.isArray(payload.errors) ? payload.errors[0] : null;
  const problem = first && typeof first === "object" && !Array.isArray(first)
    ? (first as Record<string, unknown>)
    : null;
  return Object.freeze({
    code: diagnosticToken(problem?.code),
    parameter: diagnosticToken(problem?.parameter),
    type: diagnosticToken(problem?.type),
  });
}

function readUint24LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16);
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! |
    (bytes[offset + 1]! << 8) |
    (bytes[offset + 2]! << 16) |
    (bytes[offset + 3]! << 24)
  ) >>> 0;
}

export function inspectNormalizedWebp(bytes: Uint8Array): { width: number; height: number } | null {
  if (
    bytes.length < 30 ||
    new TextDecoder().decode(bytes.subarray(0, 4)) !== "RIFF" ||
    new TextDecoder().decode(bytes.subarray(8, 12)) !== "WEBP" ||
    readUint32LE(bytes, 4) !== bytes.length - 8
  )
    return null;
  const decoder = new TextDecoder();
  let offset = 12;
  let dimensions: { width: number; height: number } | null = null;
  let imagePayloadFound = false;
  while (offset + 8 <= bytes.length) {
    const chunk = decoder.decode(bytes.subarray(offset, offset + 4));
    const size = readUint32LE(bytes, offset + 4);
    const payload = offset + 8;
    const end = payload + size;
    if (end > bytes.length || ["EXIF", "XMP ", "ICCP"].includes(chunk)) return null;
    if (chunk === "VP8X" && size >= 10) {
      dimensions = {
        width: readUint24LE(bytes, payload + 4) + 1,
        height: readUint24LE(bytes, payload + 7) + 1,
      };
    } else if (
      chunk === "VP8 " &&
      size >= 10 &&
      bytes[payload + 3] === 0x9d &&
      bytes[payload + 4] === 0x01 &&
      bytes[payload + 5] === 0x2a
    ) {
      imagePayloadFound = true;
      dimensions ??= {
        width: (bytes[payload + 6]! | (bytes[payload + 7]! << 8)) & 0x3fff,
        height: (bytes[payload + 8]! | (bytes[payload + 9]! << 8)) & 0x3fff,
      };
    } else if (chunk === "VP8L" && size >= 5 && bytes[payload] === 0x2f) {
      imagePayloadFound = true;
      dimensions ??= {
        width: (bytes[payload + 1]! | ((bytes[payload + 2]! & 0x3f) << 8)) + 1,
        height:
          ((bytes[payload + 2]! >> 6) |
            (bytes[payload + 3]! << 2) |
            ((bytes[payload + 4]! & 0x0f) << 10)) + 1,
      };
    }
    offset = end + (size % 2);
  }
  return offset === bytes.length && imagePayloadFound ? dimensions : null;
}

function exactUsage(value: unknown): RunwareGeminiStyleUsage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const promptTokens = safeToken(record.promptTokens);
  const completionTokens = safeToken(record.completionTokens);
  const totalTokens = safeToken(record.totalTokens);
  if (
    promptTokens === null ||
    completionTokens === null ||
    totalTokens === null ||
    totalTokens !== promptTokens + completionTokens
  )
    return null;
  return Object.freeze({ promptTokens, completionTokens, totalTokens });
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

export async function analyzeStyleWithRunwareGemini(input: {
  readonly apiKey: string;
  readonly baseUrl: "https://api.runware.ai/v1";
  readonly images: readonly RunwareGeminiStyleImage[];
  readonly taskUUID?: string;
  readonly fetcher?: typeof fetch;
}): Promise<RunwareGeminiStyleAnalysisResult> {
  if (input.apiKey.trim().length === 0)
    throw new RunwareGeminiStyleAnalysisError("UNAVAILABLE");
  const totalBytes = input.images.reduce((sum, image) => sum + image.bytes.byteLength, 0);
  if (totalBytes > RUNWARE_GEMINI_STYLE_MAX_INPUT_BYTES)
    throw new RunwareGeminiStyleAnalysisError("INPUT_REJECTED");

  const references: readonly StyleReferenceBinding[] = input.images.map((image, index) => ({
    alias: `ref_${String(index + 1).padStart(2, "0")}`,
    derivativeSha256: image.sha256,
    mimeType: image.mimeType,
    width: image.width,
    height: image.height,
    bytes: image.bytes.byteLength,
  }));
  if (
    input.images.some(
      (image, index) =>
        image.alias !== references[index]!.alias ||
        image.mimeType !== "image/webp" ||
        !Number.isSafeInteger(image.width) ||
        image.width <= 0 ||
        !Number.isSafeInteger(image.height) ||
        image.height <= 0,
    )
  )
    throw new RunwareGeminiStyleAnalysisError("INPUT_REJECTED");
  for (const image of input.images) {
    const dimensions = inspectNormalizedWebp(image.bytes);
    if (!dimensions || dimensions.width !== image.width || dimensions.height !== image.height)
      throw new RunwareGeminiStyleAnalysisError("INPUT_REJECTED");
  }
  const request = buildStyleAnalyzerRequest(references);
  const schema = JSON.stringify(RUNWARE_GEMINI_STYLE_PROVIDER_SCHEMA);
  const aliasText = references.map((reference) => reference.alias).join(", ");
  const taskUUID = input.taskUUID ?? crypto.randomUUID();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(taskUUID))
    throw new RunwareGeminiStyleAnalysisError("INPUT_REJECTED");
  const body = JSON.stringify([
    {
      taskType: "textInference",
      taskUUID,
      model: RUNWARE_GEMINI_STYLE_MODEL,
      outputFormat: "JSON",
      deliveryMethod: "sync",
      includeCost: true,
      includeUsage: true,
      jsonSchema: {
        name: "videoforge_image_style_analyzer",
        strict: true,
        schema: RUNWARE_GEMINI_STYLE_PROVIDER_SCHEMA,
      },
      settings: {
        systemPrompt: IMAGE_STYLE_ANALYZER_SYSTEM_PROMPT,
        thinkingLevel: "low",
        temperature: 0.1,
        topP: 0.9,
        maxTokens: RUNWARE_GEMINI_STYLE_MAX_OUTPUT_TOKENS,
      },
      inputs: {
        images: input.images.map((image) => `data:image/webp;base64,${base64(image.bytes)}`),
      },
      messages: [
        {
          role: "user",
          content: `Analyze these references in exact order as ${aliasText}. Return one JSON object matching this schema exactly: ${schema}`,
        },
      ],
    },
  ]);
  console.info("hosted_style_analysis_dispatch", {
    model: RUNWARE_GEMINI_STYLE_MODEL,
    reference_count: input.images.length,
    normalized_input_bytes: totalBytes,
    encoded_request_bytes: new TextEncoder().encode(body).byteLength,
  });

  let response: Response;
  const started = performance.now();
  try {
    response = await (input.fetcher ?? fetch)(input.baseUrl, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${input.apiKey}`,
        "content-type": "application/json",
      },
      body,
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    throw new RunwareGeminiStyleAnalysisError("AMBIGUOUS");
  }
  if (!response.ok) {
    const problem = providerProblem(await response.clone().json().catch(() => null));
    console.warn("hosted_style_analysis_provider_rejected", {
      model: RUNWARE_GEMINI_STYLE_MODEL,
      status: response.status,
      provider_code: problem.code,
      provider_parameter: problem.parameter,
      provider_type: problem.type,
    });
    if (response.status === 401 || response.status === 403)
      throw new RunwareGeminiStyleAnalysisError("UNAVAILABLE");
    if (response.status === 408 || response.status === 429 || response.status >= 500)
      throw new RunwareGeminiStyleAnalysisError("AMBIGUOUS");
    throw new RunwareGeminiStyleAnalysisError("PROVIDER_REJECTED");
  }
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!payload || Array.isArray(payload) || Array.isArray(payload.errors)) {
    const problem = providerProblem(payload);
    console.warn("hosted_style_analysis_provider_rejected", {
      model: RUNWARE_GEMINI_STYLE_MODEL,
      status: response.status,
      provider_code: problem.code,
      provider_parameter: problem.parameter,
      provider_type: problem.type,
    });
    throw new RunwareGeminiStyleAnalysisError("PROVIDER_REJECTED");
  }
  const data = Array.isArray(payload.data) ? payload.data : [];
  const item = data.find(
    (candidate) =>
      candidate &&
      typeof candidate === "object" &&
      !Array.isArray(candidate) &&
      (candidate as Record<string, unknown>).taskUUID === taskUUID,
  );
  if (!item || typeof item !== "object" || Array.isArray(item))
    throw new RunwareGeminiStyleAnalysisError("INVALID_RESPONSE");
  const record = item as Record<string, unknown>;
  const rawText = record.text;
  const content =
    typeof rawText === "string"
      ? rawText
      : rawText && typeof rawText === "object" && !Array.isArray(rawText)
        ? JSON.stringify(rawText)
        : null;
  const usage = exactUsage(record.usage);
  const costUsd = typeof record.cost === "number" ? record.cost : Number(record.cost);
  const taskType = record.taskType;
  const finishReason = record.finishReason;
  const returnedModel = record.model;
  if (
    typeof content !== "string" ||
    content.length === 0 ||
    content.length > 2_000_000 ||
    !usage ||
    !Number.isFinite(costUsd) ||
    costUsd < 0 ||
    costUsd > RUNWARE_GEMINI_STYLE_RESERVATION_USD ||
    taskType !== "textInference" ||
    finishReason !== "stop" ||
    (returnedModel !== undefined && returnedModel !== RUNWARE_GEMINI_STYLE_MODEL)
  )
    throw new RunwareGeminiStyleAnalysisError("INVALID_RESPONSE");
  let candidate: unknown;
  try {
    candidate = parseJsonStrict(content);
  } catch {
    throw new RunwareGeminiStyleAnalysisError("INVALID_RESPONSE");
  }
  let trusted: TrustedStyleProfile;
  try {
    trusted = await validateAndAssembleStyleProfile(request, candidate);
  } catch {
    throw new RunwareGeminiStyleAnalysisError("INVALID_RESPONSE");
  }
  const latencyMs = Math.max(0, Math.round(performance.now() - started));
  return Object.freeze({
    trusted,
    responseSha256: await sha256(content),
    usage,
    providerRequestId: taskUUID,
    costUsd,
    latencyMs,
    model: RUNWARE_GEMINI_STYLE_MODEL,
  });
}

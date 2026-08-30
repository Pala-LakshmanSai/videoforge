import {
  buildStyleAnalyzerRequest,
  IMAGE_STYLE_ANALYZER_SYSTEM_PROMPT,
  RUNWARE_GEMINI_STYLE_PROVIDER_SCHEMA,
  validateAndAssembleStyleProfile,
  type StyleReferenceBinding,
  type TrustedStyleProfile,
} from "@videoforge/pipeline";
import { parseJsonStrict } from "@videoforge/contracts";

export const DEEPSEEK_STYLE_MODEL = "deepseek-v4-flash-vision-exp" as const;
export const DEEPSEEK_STYLE_MAX_OUTPUT_TOKENS = 6_000 as const;
// Inline base64 expands by 4/3; keep the full JSON body safely below DeepSeek's 48 MiB limit.
export const DEEPSEEK_STYLE_MAX_INPUT_BYTES = 30 * 1024 * 1024;
export const DEEPSEEK_STYLE_RESERVATION_MICRO_USD = 20_000 as const;

export interface DeepSeekStyleImage {
  readonly alias: string;
  readonly mimeType: "image/jpeg" | "image/png" | "image/webp";
  readonly sha256: `sha256:${string}`;
  readonly width: number;
  readonly height: number;
  readonly bytes: Uint8Array;
}

export interface DeepSeekStyleUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

export interface DeepSeekStyleAnalysisResult {
  readonly trusted: TrustedStyleProfile;
  readonly responseSha256: string;
  readonly usage: DeepSeekStyleUsage;
  readonly providerRequestId: string | null;
  readonly model: typeof DEEPSEEK_STYLE_MODEL;
}

export function deepSeekStylePeakCostMicroUsd(usage: DeepSeekStyleUsage): number {
  // Peak pricing on 2026-08-30: $0.44/M uncached input and $1.32/M output.
  return Math.ceil((usage.promptTokens * 44) / 100) + Math.ceil((usage.completionTokens * 132) / 100);
}

export class DeepSeekStyleAnalysisError extends Error {
  constructor(readonly code: "UNAVAILABLE" | "REJECTED" | "INVALID_RESPONSE" | "AMBIGUOUS") {
    super(code);
    this.name = "DeepSeekStyleAnalysisError";
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

function exactUsage(value: unknown): DeepSeekStyleUsage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const promptTokens = safeToken(record.prompt_tokens);
  const completionTokens = safeToken(record.completion_tokens);
  const totalTokens = safeToken(record.total_tokens);
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

export async function analyzeStyleWithDeepSeek(input: {
  readonly apiKey: string;
  readonly baseUrl: "https://api.deepseek.com";
  readonly images: readonly DeepSeekStyleImage[];
  readonly fetcher?: typeof fetch;
}): Promise<DeepSeekStyleAnalysisResult> {
  if (input.apiKey.trim().length === 0) throw new DeepSeekStyleAnalysisError("UNAVAILABLE");
  const totalBytes = input.images.reduce((sum, image) => sum + image.bytes.byteLength, 0);
  if (totalBytes > DEEPSEEK_STYLE_MAX_INPUT_BYTES)
    throw new DeepSeekStyleAnalysisError("REJECTED");

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
        !Number.isSafeInteger(image.width) ||
        image.width <= 0 ||
        !Number.isSafeInteger(image.height) ||
        image.height <= 0,
    )
  )
    throw new DeepSeekStyleAnalysisError("REJECTED");
  for (const image of input.images) {
    const dimensions = inspectNormalizedWebp(image.bytes);
    if (!dimensions || dimensions.width !== image.width || dimensions.height !== image.height)
      throw new DeepSeekStyleAnalysisError("REJECTED");
  }
  const request = buildStyleAnalyzerRequest(references);
  const schema = JSON.stringify(RUNWARE_GEMINI_STYLE_PROVIDER_SCHEMA);
  const aliasText = references.map((reference) => reference.alias).join(", ");
  const body = JSON.stringify({
    model: DEEPSEEK_STYLE_MODEL,
    stream: false,
    thinking: { type: "disabled" },
    temperature: 0.1,
    max_tokens: DEEPSEEK_STYLE_MAX_OUTPUT_TOKENS,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: IMAGE_STYLE_ANALYZER_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Analyze these references in exact order as ${aliasText}. Return one JSON object matching this schema exactly: ${schema}`,
          },
          ...input.images.map((image) => ({
            type: "image_url",
            image_url: {
              url: `data:${image.mimeType};base64,${base64(image.bytes)}`,
            },
          })),
        ],
      },
    ],
  });

  let response: Response;
  try {
    response = await (input.fetcher ?? fetch)(`${input.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${input.apiKey}`,
        "content-type": "application/json",
      },
      body,
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new DeepSeekStyleAnalysisError("AMBIGUOUS");
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403)
      throw new DeepSeekStyleAnalysisError("UNAVAILABLE");
    if (response.status === 408 || response.status === 429 || response.status >= 500)
      throw new DeepSeekStyleAnalysisError("AMBIGUOUS");
    throw new DeepSeekStyleAnalysisError("REJECTED");
  }
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  const choice = Array.isArray(payload?.choices) ? payload.choices[0] : null;
  const message =
    choice && typeof choice === "object" && !Array.isArray(choice)
      ? (choice as Record<string, unknown>).message
      : null;
  const content =
    message && typeof message === "object" && !Array.isArray(message)
      ? (message as Record<string, unknown>).content
      : null;
  const usage = exactUsage(payload?.usage);
  if (typeof content !== "string" || content.length === 0 || content.length > 2_000_000 || !usage)
    throw new DeepSeekStyleAnalysisError("INVALID_RESPONSE");
  let candidate: unknown;
  try {
    candidate = parseJsonStrict(content);
  } catch {
    throw new DeepSeekStyleAnalysisError("INVALID_RESPONSE");
  }
  let trusted: TrustedStyleProfile;
  try {
    trusted = await validateAndAssembleStyleProfile(request, candidate);
  } catch {
    throw new DeepSeekStyleAnalysisError("INVALID_RESPONSE");
  }
  const responseModel = payload?.model;
  if (responseModel !== DEEPSEEK_STYLE_MODEL)
    throw new DeepSeekStyleAnalysisError("INVALID_RESPONSE");
  return Object.freeze({
    trusted,
    responseSha256: await sha256(content),
    usage,
    providerRequestId: typeof payload?.id === "string" ? payload.id : null,
    model: DEEPSEEK_STYLE_MODEL,
  });
}

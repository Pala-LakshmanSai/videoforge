import {
  canonicalizeJson,
  parseJsonStrict,
  StrictJsonParseError,
  type JsonValue,
} from "@videoforge/contracts";
import type { RunwarePromptTransportRequest } from "@videoforge/pipeline";

import {
  RunwarePromptHttpTransport,
  type RunwareSafeDiagnostic,
  RunwareSpendLedger,
  retrieveRunwareTextTaskDetails,
} from "../providers/runware-http-transport";

export const HOSTED_CONTEXT_RESERVATION_MICRO_USD = 10_000 as const;
const HOSTED_CONTEXT_RESERVATION_USD = HOSTED_CONTEXT_RESERVATION_MICRO_USD / 1_000_000;
const MODEL = "deepseek:v4@flash" as const;
const REQUEST_CONTRACT_VERSION = "runware-deepseek-v4-flash-context-request-v9" as const;
const MIN_CONTEXT_SENTENCES = 1 as const;
const MAX_CONTEXT_SENTENCES = 4 as const;
const MAX_CONTEXT_SENTENCE_CHARS = 160 as const;
export const MAX_HOSTED_CONTEXT_CHARS = 480 as const;

const SYSTEM_PROMPT = [
  "Extract only compact global visual context from the complete VideoForge voiceover transcript.",
  "Return only the requested strict JSON.",
  "Return 1 to 4 short factual sentences and no headings, labels, bullets, or lists.",
  "The downstream writer already receives the exact phrase, containing sentence, previous sentence, next sentence, and transcript order for every scene.",
  "Do not repeat chronology, scene order, local actions, examples, or details recoverable from those scene inputs.",
  "Include a fact only when it is reused across separated parts of the transcript, resolves an identity or reference outside the local window, or establishes a persistent subject, place, era, or visual state.",
  "Do not summarize the thesis. Omit causes, instructions, examples, and details that are already clear in their local narration window.",
  "Never add filler to reach a sentence count; omit any detail that would not change footage choice, image relevance, or visual consistency.",
  `Keep each sentence between 1 and ${MAX_CONTEXT_SENTENCE_CHARS} characters and the combined text at or below ${MAX_HOSTED_CONTEXT_CHARS} characters.`,
  "Do not invent facts, visual style, camera directions, captions, logos, graphics, or branded products.",
].join(" ");

const schema = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["sentences"],
  properties: {
    // OpenAI Structured Outputs supports only a subset of JSON Schema and does
    // not accept minLength/maxLength here. VideoForge enforces the exact string
    // bounds again in validateContext after the provider returns the object.
    sentences: {
      type: "array",
      maxItems: MAX_CONTEXT_SENTENCES,
      items: { type: "string" },
    },
  },
});

async function sha256(value: string): Promise<`sha256:${string}`> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

export type HostedVoiceoverContextRequest = Readonly<{
  transcript: string;
  transcriptHash: `sha256:${string}`;
  request: RunwarePromptTransportRequest["request"];
  requestBytes: string;
  requestHash: `sha256:${string}`;
}>;

export class HostedVoiceoverContextProviderError extends Error {
  constructor(
    readonly code:
      | "VOICEOVER_CONTEXT_PROVIDER_REJECTED"
      | "VOICEOVER_CONTEXT_NETWORK_UNCERTAIN"
      | "VOICEOVER_CONTEXT_PROVIDER_UNAVAILABLE"
      | "VOICEOVER_CONTEXT_RESPONSE_UNCERTAIN"
      | "VOICEOVER_CONTEXT_PROVIDER_UNCERTAIN",
    readonly diagnostic: RunwareSafeDiagnostic | null,
  ) {
    super(code);
    this.name = "HostedVoiceoverContextProviderError";
  }
}

function uuidFromHash(hash: string): string {
  const hex = hash.slice(7, 39).split("");
  hex[12] = "4";
  hex[16] = ["8", "9", "a", "b"][Number.parseInt(hex[16] ?? "0", 16) % 4]!;
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`;
}

function validateContext(value: JsonValue): Readonly<Record<string, JsonValue>> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("VOICEOVER_CONTEXT_INVALID");
  const record = value as Record<string, JsonValue>;
  const required = Object.keys(schema.properties).sort();
  const actual = Object.keys(record).sort();
  if (actual.length !== required.length || actual.some((key, index) => key !== required[index]))
    throw new Error("VOICEOVER_CONTEXT_INVALID");
  const boundedText = (text: string, maximum: number) =>
    Array.from(text.normalize("NFKC").replace(/\s+/gu, " ").trim()).slice(0, maximum).join("");
  const suppliedSentences = record.sentences;
  if (
    !Array.isArray(suppliedSentences) ||
    suppliedSentences.length < MIN_CONTEXT_SENTENCES ||
    suppliedSentences.length > MAX_CONTEXT_SENTENCES ||
    suppliedSentences.some((sentence) => typeof sentence !== "string")
  )
    throw new Error("VOICEOVER_CONTEXT_INVALID");
  const sentences = suppliedSentences.map((sentence) =>
    boundedText(sentence as string, MAX_CONTEXT_SENTENCE_CHARS),
  );
  if (
    sentences.some((sentence) => sentence.length === 0) ||
    new Set(sentences).size !== sentences.length ||
    sentences.join(" ").length > MAX_HOSTED_CONTEXT_CHARS
  )
    throw new Error("VOICEOVER_CONTEXT_INVALID");
  return Object.freeze({ sentences: Object.freeze(sentences) });
}

function parseContextOutput(outputText: string): Readonly<Record<string, JsonValue>> {
  const trimmed = outputText.trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/iu.exec(trimmed);
  const objectCandidates: string[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index]!;
    if (depth === 0) {
      // Quotes in provider prose must not hide the structured object that
      // follows. String escaping only matters after an object has started.
      if (character === "{") {
        start = index;
        depth = 1;
        inString = false;
        escaped = false;
      }
      continue;
    }
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "{") {
      depth += 1;
    } else if (character === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        objectCandidates.push(trimmed.slice(start, index + 1));
        start = -1;
      }
    }
  }

  const candidates = [...objectCandidates];
  for (const wrapper of [fenced?.[1], trimmed]) {
    if (wrapper && !objectCandidates.includes(wrapper)) candidates.push(wrapper);
  }
  const valid: Readonly<Record<string, JsonValue>>[] = [];
  let parsedCandidate = false;
  let duplicateProperty = false;
  for (const candidate of candidates) {
    try {
      const parsed = parseJsonStrict(candidate);
      // Some text providers JSON-encode their structured result one additional
      // time. Accept only that exact wrapper, not heuristic string rewriting.
      const value = typeof parsed === "string" ? parseJsonStrict(parsed) : parsed;
      parsedCandidate = true;
      try {
        valid.push(validateContext(value));
      } catch {
        // A provider may emit a malformed draft followed by one final object.
        // Only the unique schema-valid object is eligible for acceptance.
      }
    } catch (error) {
      if (error instanceof StrictJsonParseError && error.code === "DUPLICATE_PROPERTY") {
        duplicateProperty = true;
      }
    }
  }
  if (valid.length === 1) return valid[0]!;
  if (duplicateProperty && candidates.length === 1)
    throw new Error("VOICEOVER_CONTEXT_JSON_DUPLICATE_PROPERTY");
  if (objectCandidates.length > 1 || valid.length > 1)
    throw new Error("VOICEOVER_CONTEXT_JSON_INVALID");
  if (parsedCandidate) throw new Error("VOICEOVER_CONTEXT_INVALID");
  throw new Error("VOICEOVER_CONTEXT_JSON_INVALID");
}

export async function prepareHostedVoiceoverContextRequest(input: {
  readonly transcript: string;
  readonly transcriptHash: `sha256:${string}`;
}): Promise<HostedVoiceoverContextRequest> {
  if (input.transcript.trim().length === 0 || input.transcript.length > 100_000)
    throw new Error("VOICEOVER_TRANSCRIPT_INVALID");
  const requestWithoutTaskUUID = Object.freeze({
    taskType: "textInference",
    model: MODEL,
    outputFormat: "JSON",
    deliveryMethod: "sync",
    includeCost: true,
    includeUsage: true,
    jsonSchema: { name: "videoforge_voiceover_story_context", strict: true, schema },
    settings: {
      systemPrompt: SYSTEM_PROMPT,
      // DeepSeek V4 Flash is the lower-cost text-only model already selected for
      // VideoForge prompt work. Its Runware contract natively supports strict JSON
      // Schema. GPT-5 Nano alternated between HTTP 400 and incomplete structured
      // output across requests v3-v7.
      thinkingLevel: "off",
      temperature: 0.1,
      topP: 0.9,
      maxTokens: 350,
    },
    messages: [{ role: "user", content: canonicalizeJson({ transcript: input.transcript }) }],
  });
  // Runware task UUIDs are account-global idempotency keys. Bind the UUID to the
  // entire immutable request contract, not only the transcript hash, so a prompt,
  // schema, model, or settings change can never resolve to an older archived task.
  const taskSeed = await sha256(
    canonicalizeJson({
      requestVersion: REQUEST_CONTRACT_VERSION,
      transcriptHash: input.transcriptHash,
      request: requestWithoutTaskUUID,
    }),
  );
  const taskUUID = uuidFromHash(taskSeed);
  const request = Object.freeze({
    ...requestWithoutTaskUUID,
    taskUUID,
  }) as unknown as RunwarePromptTransportRequest["request"];
  const requestBytes = canonicalizeJson([request]);
  return Object.freeze({
    transcript: input.transcript,
    transcriptHash: input.transcriptHash,
    request,
    requestBytes,
    requestHash: await sha256(requestBytes),
  });
}

export async function extractHostedVoiceoverContext(input: {
  readonly prepared: HostedVoiceoverContextRequest;
  readonly apiKey: string;
  readonly fetcher?: typeof fetch;
}): Promise<{
  readonly context: Readonly<Record<string, JsonValue>>;
  readonly contextBytes: string;
  readonly contextHash: `sha256:${string}`;
  readonly requestBytes: string;
  readonly requestHash: `sha256:${string}`;
  readonly responseBytes: string;
  readonly responseHash: `sha256:${string}`;
  readonly reportedCostMicroUsd: number;
}> {
  const diagnosticState: { current: RunwareSafeDiagnostic | null } = { current: null };
  const transport = new RunwarePromptHttpTransport({
    apiKey: input.apiKey,
    ledger: new RunwareSpendLedger(HOSTED_CONTEXT_RESERVATION_USD),
    maximumRequestCostUsd: HOSTED_CONTEXT_RESERVATION_USD,
    fetch: input.fetcher,
    onDiagnostic: (value) => {
      diagnosticState.current = value;
    },
  });
  const result = await transport.dispatch({
    requestVersion:
      REQUEST_CONTRACT_VERSION as unknown as RunwarePromptTransportRequest["requestVersion"],
    attemptIndex: 1,
    requestedSceneIds: ["voiceover_context"],
    request: input.prepared.request,
    requestBytes: input.prepared.requestBytes,
    requestSha256: input.prepared.requestHash,
    retryOfRequestSha256: null,
  });
  if (result.status === "failed")
    throw new HostedVoiceoverContextProviderError(
      "VOICEOVER_CONTEXT_PROVIDER_REJECTED",
      diagnosticState.current,
    );
  if (result.status !== "succeeded" || result.finishReason !== "stop") {
    const diagnostic = diagnosticState.current;
    const problemCode =
      diagnostic?.stage === "network"
        ? "VOICEOVER_CONTEXT_NETWORK_UNCERTAIN"
        : diagnostic?.stage === "http"
          ? "VOICEOVER_CONTEXT_PROVIDER_UNAVAILABLE"
          : diagnostic?.stage === "response"
            ? "VOICEOVER_CONTEXT_RESPONSE_UNCERTAIN"
            : "VOICEOVER_CONTEXT_PROVIDER_UNCERTAIN";
    throw new HostedVoiceoverContextProviderError(problemCode, diagnostic);
  }
  if (result.costUsd > HOSTED_CONTEXT_RESERVATION_USD)
    throw new Error("VOICEOVER_CONTEXT_COST_EXCEEDED");
  return finalizeHostedVoiceoverContext(input.prepared, result.outputText, result.costUsd);
}

async function finalizeHostedVoiceoverContext(
  prepared: HostedVoiceoverContextRequest,
  outputText: string,
  costUsd: number,
): Promise<{
  readonly context: Readonly<Record<string, JsonValue>>;
  readonly contextBytes: string;
  readonly contextHash: `sha256:${string}`;
  readonly requestBytes: string;
  readonly requestHash: `sha256:${string}`;
  readonly responseBytes: string;
  readonly responseHash: `sha256:${string}`;
  readonly reportedCostMicroUsd: number;
}> {
  if (costUsd > HOSTED_CONTEXT_RESERVATION_USD) throw new Error("VOICEOVER_CONTEXT_COST_EXCEEDED");
  const context = parseContextOutput(outputText);
  const contextBytes = canonicalizeJson(context);
  if (contextBytes.length > MAX_HOSTED_CONTEXT_CHARS + 80)
    throw new Error("VOICEOVER_CONTEXT_TOO_LARGE");
  return Object.freeze({
    context,
    contextBytes,
    contextHash: await sha256(contextBytes),
    requestBytes: prepared.requestBytes,
    requestHash: prepared.requestHash,
    responseBytes: outputText,
    responseHash: await sha256(outputText),
    reportedCostMicroUsd: Math.ceil(costUsd * 1_000_000),
  });
}

/** Recover one previously dispatched context result through getTaskDetails. */
export async function reconcileHostedVoiceoverContext(input: {
  readonly prepared: HostedVoiceoverContextRequest;
  readonly apiKey: string;
  readonly fetcher?: typeof fetch;
}): Promise<Awaited<ReturnType<typeof finalizeHostedVoiceoverContext>>> {
  const recovered = await retrieveRunwareTextTaskDetails({
    apiKey: input.apiKey,
    originalTaskUUID: input.prepared.request.taskUUID,
    originalRequestBytes: input.prepared.requestBytes,
    originalRequestSha256: input.prepared.requestHash,
    fetch: input.fetcher,
  });
  return finalizeHostedVoiceoverContext(input.prepared, recovered.outputText, recovered.costUsd);
}

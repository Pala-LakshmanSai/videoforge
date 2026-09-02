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
const MAX_SUBJECT_CHARS = 90 as const;
const MAX_VISUAL_FACTS = 3 as const;
const MAX_VISUAL_FACT_CHARS = 70 as const;
const MAX_CONTINUITY_FACTS = 2 as const;
const MAX_CONTINUITY_FACT_CHARS = 70 as const;
const MAX_RESOLVED_REFERENCES = 2 as const;
const MAX_RESOLVED_REFERENCE_CHARS = 70 as const;
export const MAX_HOSTED_CONTEXT_CHARS = 360 as const;

const SYSTEM_PROMPT = [
  "Extract only compact global visual context from the complete VideoForge voiceover transcript.",
  "Return only the requested strict JSON.",
  "The downstream writer already receives the exact phrase, containing sentence, previous sentence, next sentence, and transcript order for every scene.",
  "Do not repeat chronology, scene order, local actions, examples, processes, or facts recoverable from those scene inputs.",
  `subject: one precise noun phrase naming the central real-world subject, at most ${MAX_SUBJECT_CHARS} characters.`,
  `visual_facts: zero to ${MAX_VISUAL_FACTS} short recurring people, settings, eras, objects, or physical relationships that materially improve footage choice across separated scenes; at most ${MAX_VISUAL_FACT_CHARS} characters each.`,
  `continuity: zero to ${MAX_CONTINUITY_FACTS} stable identity, appearance, or physical-state facts that must remain consistent across separated scenes; at most ${MAX_CONTINUITY_FACT_CHARS} characters each.`,
  `resolved_references: zero to ${MAX_RESOLVED_REFERENCES} remote alias, pronoun, or callback mappings that cannot be resolved from the local sentence window; at most ${MAX_RESOLVED_REFERENCE_CHARS} characters each.`,
  "Use empty arrays when a category adds no value. Never add filler, a thesis summary, generic advice, visual style, or a fact that would not change footage choice, image relevance, reference resolution, or visual consistency.",
  `Keep the final flattened context at or below ${MAX_HOSTED_CONTEXT_CHARS} characters.`,
  "Do not invent facts, visual style, camera directions, captions, logos, graphics, or branded products.",
].join(" ");

const schema = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["subject", "visual_facts", "continuity", "resolved_references"],
  properties: {
    // OpenAI Structured Outputs supports only a subset of JSON Schema and does
    // not accept minLength/maxLength here. VideoForge enforces the exact string
    // bounds again in validateContext after the provider returns the object.
    subject: { type: "string" },
    visual_facts: {
      type: "array",
      maxItems: MAX_VISUAL_FACTS,
      items: { type: "string" },
    },
    continuity: {
      type: "array",
      maxItems: MAX_CONTINUITY_FACTS,
      items: { type: "string" },
    },
    resolved_references: {
      type: "array",
      maxItems: MAX_RESOLVED_REFERENCES,
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
  const subject =
    typeof record.subject === "string" ? boundedText(record.subject, MAX_SUBJECT_CHARS) : "";
  const boundedList = (
    candidate: JsonValue | undefined,
    maximumItems: number,
    maximumChars: number,
  ) => {
    if (
      !Array.isArray(candidate) ||
      candidate.length > maximumItems ||
      candidate.some((item) => typeof item !== "string")
    )
      throw new Error("VOICEOVER_CONTEXT_INVALID");
    const normalized = candidate.map((item) => boundedText(item as string, maximumChars));
    if (
      normalized.some((item) => item.length === 0) ||
      new Set(normalized).size !== normalized.length
    )
      throw new Error("VOICEOVER_CONTEXT_INVALID");
    return Object.freeze(normalized);
  };
  if (subject.length === 0) throw new Error("VOICEOVER_CONTEXT_INVALID");
  const visualFacts = boundedList(record.visual_facts, MAX_VISUAL_FACTS, MAX_VISUAL_FACT_CHARS);
  const continuity = boundedList(
    record.continuity,
    MAX_CONTINUITY_FACTS,
    MAX_CONTINUITY_FACT_CHARS,
  );
  const resolvedReferences = boundedList(
    record.resolved_references,
    MAX_RESOLVED_REFERENCES,
    MAX_RESOLVED_REFERENCE_CHARS,
  );
  const reusableFacts = [...visualFacts, ...continuity, ...resolvedReferences];
  if (new Set(reusableFacts).size !== reusableFacts.length)
    throw new Error("VOICEOVER_CONTEXT_INVALID");
  const flattened = [
    `Subject: ${subject}`,
    visualFacts.length > 0 ? `Visual facts: ${visualFacts.join("; ")}` : null,
    continuity.length > 0 ? `Continuity: ${continuity.join("; ")}` : null,
    resolvedReferences.length > 0 ? `Resolve: ${resolvedReferences.join("; ")}` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(" | ");
  if (flattened.length > MAX_HOSTED_CONTEXT_CHARS) throw new Error("VOICEOVER_CONTEXT_INVALID");
  return Object.freeze({
    subject,
    visual_facts: visualFacts,
    continuity,
    resolved_references: resolvedReferences,
  });
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
  if (contextBytes.length > MAX_HOSTED_CONTEXT_CHARS + 220)
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

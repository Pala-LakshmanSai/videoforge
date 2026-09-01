import { canonicalizeJson, parseJsonStrict, type JsonValue } from "@videoforge/contracts";
import type { RunwarePromptTransportRequest } from "@videoforge/pipeline";

import {
  RunwarePromptHttpTransport,
  RunwareSpendLedger,
  retrieveRunwareTextTaskDetails,
} from "../providers/runware-http-transport";

export const HOSTED_CONTEXT_RESERVATION_MICRO_USD = 10_000 as const;
const HOSTED_CONTEXT_RESERVATION_USD = HOSTED_CONTEXT_RESERVATION_MICRO_USD / 1_000_000;
const MODEL = "deepseek:v4@flash" as const;

const SYSTEM_PROMPT = [
  "Extract durable story context from the complete VideoForge voiceover transcript.",
  "Return only the requested strict JSON.",
  "Record concrete facts useful for literal image selection: people, places, era, chronology, recurring objects, processes, causes, effects, and continuity.",
  "Resolve pronouns and callbacks only when the transcript supports the resolution.",
  "Do not invent facts, visual style, camera directions, captions, logos, graphics, or branded products.",
  "Use empty arrays for details not supported by the transcript.",
].join(" ");

const schema = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: [
    "primary_topic",
    "summary",
    "people",
    "places",
    "era_and_time",
    "recurring_objects",
    "processes",
    "cause_and_effect",
    "chronology",
    "continuity_facts",
    "resolved_references",
  ],
  properties: {
    primary_topic: { type: "string", minLength: 1, maxLength: 140 },
    summary: { type: "string", minLength: 1, maxLength: 500 },
    people: { type: "array", maxItems: 6, items: { type: "string", minLength: 1, maxLength: 80 } },
    places: { type: "array", maxItems: 6, items: { type: "string", minLength: 1, maxLength: 80 } },
    era_and_time: {
      type: "array",
      maxItems: 5,
      items: { type: "string", minLength: 1, maxLength: 80 },
    },
    recurring_objects: {
      type: "array",
      maxItems: 8,
      items: { type: "string", minLength: 1, maxLength: 80 },
    },
    processes: {
      type: "array",
      maxItems: 6,
      items: { type: "string", minLength: 1, maxLength: 100 },
    },
    cause_and_effect: {
      type: "array",
      maxItems: 5,
      items: { type: "string", minLength: 1, maxLength: 100 },
    },
    chronology: {
      type: "array",
      maxItems: 6,
      items: { type: "string", minLength: 1, maxLength: 100 },
    },
    continuity_facts: {
      type: "array",
      maxItems: 6,
      items: { type: "string", minLength: 1, maxLength: 100 },
    },
    resolved_references: {
      type: "array",
      maxItems: 6,
      items: { type: "string", minLength: 1, maxLength: 100 },
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
  const scalarLimits = { primary_topic: 140, summary: 500 } as const;
  for (const [key, maximum] of Object.entries(scalarLimits))
    if (
      typeof record[key] !== "string" ||
      record[key].trim().length === 0 ||
      record[key].length > maximum
    )
      throw new Error("VOICEOVER_CONTEXT_INVALID");
  const arrayLimits = {
    people: [6, 80],
    places: [6, 80],
    era_and_time: [5, 80],
    recurring_objects: [8, 80],
    processes: [6, 100],
    cause_and_effect: [5, 100],
    chronology: [6, 100],
    continuity_facts: [6, 100],
    resolved_references: [6, 100],
  } as const;
  for (const [key, [maximumItems, maximumLength]] of Object.entries(arrayLimits)) {
    const items = record[key];
    if (
      !Array.isArray(items) ||
      items.length > maximumItems ||
      items.some(
        (item) =>
          typeof item !== "string" || item.trim().length === 0 || item.length > maximumLength,
      )
    )
      throw new Error("VOICEOVER_CONTEXT_INVALID");
  }
  return Object.freeze(record);
}

export async function prepareHostedVoiceoverContextRequest(input: {
  readonly transcript: string;
  readonly transcriptHash: `sha256:${string}`;
}): Promise<HostedVoiceoverContextRequest> {
  if (input.transcript.trim().length === 0 || input.transcript.length > 100_000)
    throw new Error("VOICEOVER_TRANSCRIPT_INVALID");
  const taskSeed = await sha256(`voiceover-context:${input.transcriptHash}`);
  const taskUUID = uuidFromHash(taskSeed);
  const request = Object.freeze({
    taskType: "textInference",
    taskUUID,
    model: MODEL,
    outputFormat: "json",
    deliveryMethod: "sync",
    includeCost: true,
    includeUsage: true,
    jsonSchema: { name: "videoforge_voiceover_story_context", strict: true, schema },
    settings: {
      systemPrompt: SYSTEM_PROMPT,
      thinkingLevel: "off",
      temperature: 0.1,
      topP: 0.8,
      maxTokens: 1_600,
    },
    messages: [{ role: "user", content: canonicalizeJson({ transcript: input.transcript }) }],
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
  const transport = new RunwarePromptHttpTransport({
    apiKey: input.apiKey,
    ledger: new RunwareSpendLedger(HOSTED_CONTEXT_RESERVATION_USD),
    maximumRequestCostUsd: HOSTED_CONTEXT_RESERVATION_USD,
    fetch: input.fetcher,
  });
  const result = await transport.dispatch({
    requestVersion:
      "runware-deepseek-context-request-v1" as unknown as RunwarePromptTransportRequest["requestVersion"],
    attemptIndex: 1,
    requestedSceneIds: ["voiceover_context"],
    request: input.prepared.request,
    requestBytes: input.prepared.requestBytes,
    requestSha256: input.prepared.requestHash,
    retryOfRequestSha256: null,
  });
  if (result.status === "failed") throw new Error("VOICEOVER_CONTEXT_PROVIDER_REJECTED");
  if (result.status !== "succeeded" || result.finishReason !== "stop")
    throw new Error("VOICEOVER_CONTEXT_PROVIDER_UNCERTAIN");
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
  const context = validateContext(parseJsonStrict(outputText));
  const contextBytes = canonicalizeJson(context);
  if (contextBytes.length > 6_000) throw new Error("VOICEOVER_CONTEXT_TOO_LARGE");
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

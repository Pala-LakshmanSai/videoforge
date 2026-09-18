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
// Problem codes that mean "the provider/transport failed before any result was accepted". Only
// these may be redispatched once; a definite rejection or an accepted result never is.
export const HOSTED_CONTEXT_RETRYABLE_PROBLEM_CODES: ReadonlySet<string> = new Set([
  "VOICEOVER_CONTEXT_PROVIDER_UNAVAILABLE",
  "VOICEOVER_CONTEXT_NETWORK_UNCERTAIN",
  "VOICEOVER_CONTEXT_RESPONSE_UNCERTAIN",
  "VOICEOVER_CONTEXT_PROVIDER_UNCERTAIN",
  "HOSTED_CONTEXT_EXECUTION_UNKNOWN",
  "HOSTED_CONTEXT_PROVIDER_FAILURE",
]);
/**
 * How many redispatches a revision may spend when its voiceover-context attempt produced no
 * accepted result.
 *
 * Runware's text backend is intermittently unavailable: the exact same request measured in one
 * window answered `502 Bad Gateway` from the provider's own proxy five times in a row, then
 * succeeded twice. The run only reaches stages 4+ once a context result is accepted, so a small
 * budget strands the revision at stage 3 whenever the provider has a bad window; each redispatch is
 * separately reserved and the spend guard is unchanged, so the bound is about wasted attempts
 * rather than money. The budget was raised from six to ten when the pinned DeepSeek text model was
 * replaced (see MODEL below): a revision that spent its whole budget on a provider outage the
 * product could not have fixed must still be able to continue once the cause is gone.
 */
export const HOSTED_CONTEXT_REDISPATCH_BUDGET = 10 as const;
/**
 * The text model this product pins for stage 3.
 *
 * It was `deepseek:v4@flash` until the provider's own backend began failing every dispatch: the
 * account's Runware error ledger recorded two server errors on 2026-09-16 and seven more on
 * 2026-09-18 against that model with zero accepted results since 2026-09-16T12:41Z, an archived task
 * read answered `taskNotFound` for the failed dispatches, and the catalog's successor
 * (`deepseek:v4.1@flash`) is rejected by the text API as an `invalidModel`. The same request shape
 * measured against `google:gemini@3.5-flash` returns schema-valid JSON, so the lower-cost text model
 * is pinned to that instead. The contract version below moves with it: Runware task UUIDs are
 * account-global idempotency keys, so a model change must land under a new contract identity.
 */
const MODEL = "google:gemini@3.5-flash" as const;
const REQUEST_CONTRACT_VERSION = "runware-gemini-3.5-flash-context-request-v10" as const;
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
  `visual_facts: zero to ${MAX_VISUAL_FACTS} short recurring people, settings, eras, unmade physical objects, natural materials, or physical relationships that materially improve footage choice across separated scenes; at most ${MAX_VISUAL_FACT_CHARS} characters each. Never make a manufactured product, package, container or branded good a visual fact: express a product, preparation or mixture through the physical action, the material or the affected surface (the sprayed leaves, the treated soil, the wilted weeds), never the bottle, jar, can, tube or package.`,
  `continuity: zero to ${MAX_CONTINUITY_FACTS} stable identity, appearance, or physical-state facts that must remain consistent across separated scenes; at most ${MAX_CONTINUITY_FACT_CHARS} characters each.`,
  `resolved_references: zero to ${MAX_RESOLVED_REFERENCES} remote alias, pronoun, or callback mappings that cannot be resolved from the local sentence window; at most ${MAX_RESOLVED_REFERENCE_CHARS} characters each.`,
  "Use empty arrays when a category adds no value. Never add filler, a thesis summary, generic advice, visual style, or a fact that would not change footage choice, image relevance, reference resolution, or visual consistency.",
  `Keep the final flattened context at or below ${MAX_HOSTED_CONTEXT_CHARS} characters.`,
  "Do not invent facts, visual style, camera directions, captions, logos, graphics, branded products, product packaging, or containers of any kind (bottles, jars, cans, tins, tubes, canisters, cartons, pouches, packets, sachets); describe the physical action, material, or affected surface instead.",
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

type HostedVoiceoverContextValidationReason =
  | "object"
  | "keys"
  | "subject"
  | "list_count"
  | "type"
  | "empty"
  | "duplicate";

class HostedVoiceoverContextValidationError extends Error {
  constructor(readonly reason: HostedVoiceoverContextValidationReason) {
    super("VOICEOVER_CONTEXT_INVALID");
    this.name = "HostedVoiceoverContextValidationError";
  }
}

function validateContext(value: JsonValue): Readonly<Record<string, JsonValue>> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new HostedVoiceoverContextValidationError("object");
  const record = value as Record<string, JsonValue>;
  const required = Object.keys(schema.properties).sort();
  const actual = Object.keys(record).sort();
  if (actual.length !== required.length || actual.some((key, index) => key !== required[index]))
    throw new HostedVoiceoverContextValidationError("keys");
  const boundedText = (text: string, maximum: number) =>
    Array.from(text.normalize("NFKC").replace(/\s+/gu, " ").trim()).slice(0, maximum).join("");
  const subject =
    typeof record.subject === "string" ? boundedText(record.subject, MAX_SUBJECT_CHARS) : "";
  if (subject.length === 0) throw new HostedVoiceoverContextValidationError("subject");
  const boundedList = (
    candidate: JsonValue | undefined,
    maximumItems: number,
    maximumChars: number,
  ) => {
    if (
      !Array.isArray(candidate) ||
      candidate.length > maximumItems ||
      candidate.some((item) => typeof item !== "string")
    ) {
      if (!Array.isArray(candidate)) throw new HostedVoiceoverContextValidationError("type");
      if (candidate.length > maximumItems)
        throw new HostedVoiceoverContextValidationError("list_count");
      throw new HostedVoiceoverContextValidationError("type");
    }
    const normalized = candidate.map((item) => boundedText(item as string, maximumChars));
    if (normalized.some((item) => item.length === 0))
      throw new HostedVoiceoverContextValidationError("empty");
    if (new Set(normalized).size !== normalized.length)
      throw new HostedVoiceoverContextValidationError("duplicate");
    return Object.freeze(normalized);
  };
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
    throw new HostedVoiceoverContextValidationError("duplicate");

  // The provider's per-field bounds do not guarantee that the combined context fits the
  // downstream prompt budget. Keep complete normalized facts in deterministic priority order,
  // while retaining the wire/output category order below.
  const retained = {
    visual_facts: [] as string[],
    continuity: [] as string[],
    resolved_references: [] as string[],
  };
  const priority = ["resolved_references", "continuity", "visual_facts"] as const;
  for (const category of priority) {
    for (const fact of {
      visual_facts: visualFacts,
      continuity,
      resolved_references: resolvedReferences,
    }[category]) {
      const candidate = {
        visual_facts: [...retained.visual_facts],
        continuity: [...retained.continuity],
        resolved_references: [...retained.resolved_references],
      };
      candidate[category].push(fact);
      const flattened = [
        `Subject: ${subject}`,
        candidate.visual_facts.length > 0
          ? `Visual facts: ${candidate.visual_facts.join("; ")}`
          : null,
        candidate.continuity.length > 0 ? `Continuity: ${candidate.continuity.join("; ")}` : null,
        candidate.resolved_references.length > 0
          ? `Resolve: ${candidate.resolved_references.join("; ")}`
          : null,
      ]
        .filter((part): part is string => part !== null)
        .join(" | ");
      if (flattened.length <= MAX_HOSTED_CONTEXT_CHARS) retained[category].push(fact);
    }
  }
  return Object.freeze({
    subject,
    visual_facts: Object.freeze(retained.visual_facts),
    continuity: Object.freeze(retained.continuity),
    resolved_references: Object.freeze(retained.resolved_references),
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
  for (const wrapper of [fenced?.[1]?.trim(), trimmed]) {
    if (wrapper && !objectCandidates.includes(wrapper)) candidates.push(wrapper);
  }
  const valid: Readonly<Record<string, JsonValue>>[] = [];
  let parsedCandidate = false;
  let duplicateProperty = false;
  let validationReason: HostedVoiceoverContextValidationReason | null = null;
  for (const candidate of candidates) {
    try {
      const parsed = parseJsonStrict(candidate);
      // Some text providers JSON-encode their structured result one additional
      // time. Accept only that exact wrapper, not heuristic string rewriting.
      const value = typeof parsed === "string" ? parseJsonStrict(parsed) : parsed;
      parsedCandidate = true;
      try {
        valid.push(validateContext(value));
      } catch (error) {
        if (error instanceof HostedVoiceoverContextValidationError && validationReason === null) {
          validationReason = error.reason;
        }
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
  if (validationReason !== null) throw new HostedVoiceoverContextValidationError(validationReason);
  if (parsedCandidate) throw new Error("VOICEOVER_CONTEXT_INVALID");
  throw new Error("VOICEOVER_CONTEXT_JSON_INVALID");
}

export async function prepareHostedVoiceoverContextRequest(input: {
  readonly transcript: string;
  readonly transcriptHash: `sha256:${string}`;
  /**
   * Identity bound into the provider task UUID for this dispatch. It must be a value that the claim
   * transaction persists on `hosted_voiceover_contexts`, because the stored `request_hash` can only
   * be rebuilt later from the row: reconciliation retrieves the original task by re-deriving the
   * exact request, so a dispatch seeded with a value the row never keeps strands its revision.
   * The claim persists `attempt_id` on every path, including a redispatch.
   */
  readonly dispatchIdentity?: string;
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
      // The pinned model's Runware contract accepts strict JSON Schema, and the settings below
      // measured against it returned schema-valid JSON for this request. GPT-5 Nano alternated
      // between HTTP 400 and incomplete structured output across requests v3-v7, and the DeepSeek
      // text backend failed every dispatch outright (see MODEL above).
      thinkingLevel: "off",
      temperature: 0.1,
      topP: 0.9,
      // The pinned model reasons before it answers and bills those tokens against this same ceiling:
      // the first measured run with the old 350 spent 333 tokens on reasoning and returned
      // finishReason 'length' with a truncated document, which the transport refuses to accept. 1200
      // measured finishReason 'stop' with the whole document (~300 characters) and a cost of ~$0.006,
      // inside the $0.01 reservation this stage holds.
      maxTokens: 1_200,
    },
    messages: [{ role: "user", content: canonicalizeJson({ transcript: input.transcript }) }],
  });
  // Runware task UUIDs are account-global idempotency keys. Bind the UUID to the
  // entire immutable request contract, not only the transcript hash, so a prompt,
  // schema, model, or settings change can never resolve to an older archived task.
  const taskSeed = await sha256(
    canonicalizeJson(
      input.dispatchIdentity === undefined
        ? {
            requestVersion: REQUEST_CONTRACT_VERSION,
            transcriptHash: input.transcriptHash,
            request: requestWithoutTaskUUID,
          }
        : {
            requestVersion: REQUEST_CONTRACT_VERSION,
            dispatchIdentity: input.dispatchIdentity,
            transcriptHash: input.transcriptHash,
            request: requestWithoutTaskUUID,
          },
    ),
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
  // A network or 5xx result is ambiguous: Runware may have accepted the claim, so this request
  // must not be redispatched. Reconcile the original task through getTaskDetails instead.
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
  const finalDiagnostic = diagnosticState["current"] as RunwareSafeDiagnostic | null;
  if (finalDiagnostic !== null) {
    // The stored problem code collapses every transport failure into one bucket, so record the
    // provider-safe diagnostic itself. It carries no prompt, response body or credential.
    console.warn("hosted_voiceover_context_provider", {
      stage: finalDiagnostic.stage,
      http_status: "httpStatus" in finalDiagnostic ? finalDiagnostic.httpStatus : null,
      provider_code: "providerCode" in finalDiagnostic ? finalDiagnostic.providerCode : null,
      provider_parameter:
        "providerParameter" in finalDiagnostic ? finalDiagnostic.providerParameter : null,
      result_status: result?.status ?? null,
    });
  }
  if (result === null || result.status === "failed")
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
  let context: Readonly<Record<string, JsonValue>>;
  try {
    context = parseContextOutput(outputText);
  } catch (error) {
    if (error instanceof HostedVoiceoverContextValidationError) {
      console.warn("hosted_voiceover_context_validation", {
        response_length: outputText.length,
        response_hash: await sha256(outputText),
        reason: error.reason,
      });
    }
    throw error;
  }
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

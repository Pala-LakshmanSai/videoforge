import { NATURAL_DOCUMENTARY_STYLE_PROFILE_HASH } from "./natural-documentary-style.js";
import { createHash } from "node:crypto";

import {
  canonicalizeJson,
  parseJsonStrict,
  type JsonValue,
  type Sha256Digest,
} from "@videoforge/contracts";

import { PipelineDomainError } from "../errors.js";
import { validatePromptStyleTreatment, validatePromptWriterOutput } from "./batch.js";
import { assertNoHardPromptConflict } from "./compiler.js";
import { SCENE_PROMPT_WRITER_VERSION } from "./types.js";
import type {
  PromptBatch,
  PromptSceneInput,
  PromptWriterBatchOutput,
  PromptWriterPort,
  PromptWriterSceneOutput,
} from "./types.js";

/**
 * The text model pinned for prompt writing (stage 5).
 *
 * It was `deepseek:v4@flash`, which the provider's backend stopped serving: the account's Runware
 * error ledger recorded server errors against that model on 2026-09-16 and again on 2026-09-18 with
 * no accepted result since 2026-09-16T12:41Z, and the catalog's successor is rejected by the text API
 * as `invalidModel`. The stage-3 context reader was moved to `google:gemini@3.5-flash` for the same
 * reason, and this writer follows it so both text stages run on one live model.
 */
export const RUNWARE_PROMPT_MODEL = "google:gemini@3.5-flash" as const;
// v24: compact batch instructions without removing grounding, quality or output constraints.
// The version feeds the deterministic taskUUID; changed instructions must not reuse a paid v23 task.
export const NATURAL_DOCUMENTARY_PROMPT_REQUEST_VERSION =
  "runware-gemini-3.5-flash-prompt-request-v25" as const;
export type PromptRequestPolicy =
  | "legacy"
  | "physical-placement-v1"
  | "physical-placement-v2"
  | "no-graphics-v1"
  | "no-graphics-v2";
export const NO_GRAPHICS_PROMPT_REQUEST_VERSION =
  "runware-gemini-3.5-flash-prompt-request-v28" as const;
export const NO_GRAPHICS_V2_PROMPT_REQUEST_VERSION =
  "runware-gemini-3.5-flash-prompt-request-v29" as const;
export const NO_GRAPHICS_V2_WRITER_INSTRUCTION =
  "NO TEXT-BEARING ACTIONS: This rule also applies when narration explicitly mentions writing, reading labels, prices, lists, calculations or documents. Show the locally supported physical person, items, interaction or observable consequence without text-bearing paper, product markings or depicted writing. For a narrated calculation, use the supported person considering the actual items; never a pen or pencil writing on paper, a notebook, a price list or a screen. For label comparisons, show supported unmarked containers and the person inspecting them without a label or invented portrait. Unmarked surfaces are valid; blank labels must be described as unmarked surfaces. Keep source people, setting and ordinary physical evidence. Do not invent a different event. In literal_subject, action and environment, remove all requests for written or drawn content before returning JSON.";
export const PROMPT_CONTENT_REPAIR_INSTRUCTION =
  "MANDATORY NO GRAPHICS: Do not depict maps, sea charts, compass roses, graphs, diagrams, schematics, blueprints, drawn routes or marked paper in any required scene fact. These are forbidden even as physical props or historical navigation tools, even without readable words. For navigation or dead reckoning, show locally supported sailors, unmarked instruments, stars, ocean or shore instead. For abstract information, show its locally supported physical subject, process or consequence. Never invent writing, graphics or a substitute story event. Recheck literal_subject, action and environment before returning every scene; a forbidden prop rejects the entire batch.";
export const PHYSICAL_PLACEMENT_PROMPT_REQUEST_VERSION =
  "runware-gemini-3.5-flash-prompt-request-v26" as const;
export const PHYSICAL_PLACEMENT_V2_PROMPT_REQUEST_VERSION =
  "runware-gemini-3.5-flash-prompt-request-v27" as const;
type PromptRequestVersion =
  | typeof NO_GRAPHICS_V2_PROMPT_REQUEST_VERSION
  | typeof NO_GRAPHICS_PROMPT_REQUEST_VERSION
  | "runware-prompt-content-repair-v1"
  | "runware-prompt-content-repair-v2"
  | typeof PHYSICAL_PLACEMENT_V2_PROMPT_REQUEST_VERSION
  | typeof PHYSICAL_PLACEMENT_PROMPT_REQUEST_VERSION
  | typeof RUNWARE_PROMPT_REQUEST_VERSION
  | typeof NATURAL_DOCUMENTARY_PROMPT_REQUEST_VERSION;
export const RUNWARE_PROMPT_REQUEST_VERSION =
  "runware-gemini-3.5-flash-prompt-request-v24" as const;
/**
 * Runware currently permits a considerably larger response, but this tighter
 * application ceiling leaves room for request metadata and keeps one malformed
 * long response from consuming the whole execution reservation.
 */
export const RUNWARE_PROMPT_MAX_OUTPUT_TOKENS = 64_000 as const;
/** Typical output sizing hint retained for callers that display estimates. */
export const RUNWARE_PROMPT_OUTPUT_TOKENS_PER_SCENE = 512 as const;
export const RUNWARE_PROMPT_OUTPUT_TOKEN_HEADROOM = 8_192 as const;
export const RUNWARE_PROMPT_OUTPUT_FIXED_TOKENS = 1_024 as const;
/** Conservative UTF-8 token budget used by the adaptive planner. */
export const RUNWARE_PROMPT_MAX_INPUT_TOKENS = 48_000 as const;
/** Two bytes per token errs toward a larger estimate for mixed-language text. */
export const RUNWARE_PROMPT_ESTIMATED_BYTES_PER_TOKEN = 2 as const;

/**
 * The output contract, stated in words.
 *
 * The provider no longer receives a `jsonSchema` (Google Gemini rejects structured output with
 * `providerBadRequest`), so the exact document shape has to live in the prompt instead. The strict
 * parse and schema validation in this module still refuse anything that does not match it.
 */
export const SCENE_PROMPT_WRITER_OUTPUT_CONTRACT = [
  "Return one JSON object and nothing else: no commentary or Markdown fence.",
  "Exactly two keys: batch_id (echo input) and scenes (array); one scene object per requested scene, in input order, no extras or omissions.",
  "Every scene has exactly these eight keys: scene_id, literal_subject, action, environment, in_image_shot_role, lighting_context, continuity_tags, prompt_core.",
  "Echo scene_id and assigned in_image_shot_role unchanged; continuity_tags is an array.",
].join("\n");

export const SCENE_PROMPT_WRITER_SYSTEM_PROMPT = [
  "Write concise literal VideoForge still-image scenes (scene-prompt-writer-v2).",
  "Local source precedence: exact_phrase > scene_phrase_context > prior_scene_phrase > next_scene_phrase. Adjacent context only adds compatible detail. Use story_context only to resolve locally unresolved people, places, pronouns, callbacks or era; never replace local subject, action, place or object with a generic topic/mood image. literal_subject must retain a meaningful source anchor. Express meaning, not copied wording for lexical overlap.",
  "Show concrete visible evidence of the exact phrase in one camera-capturable moment: a specific subject, physically plausible visible action and real environment. Preserve narrated actions semantically in action, preferably verb first. For static, stative or abstract phrases, show the nearest locally supported state/interaction; never invent events or contradict narration. No chains (while/then/and/but) unless narration gives that same coordinated action; object lists are allowed.",
  "Preserve named locations in environment; otherwise infer an ordinary compatible location from local context, using story_context only if unresolved. Add only necessary, compatible physical details; never invent continuity facts or story events.",
  "Prefer familiar human behavior, ordinary locations, credible objects, contextual clutter and natural imperfection; no spectacle or advertising poses. For abstractions use direct supported person/object/process/place/consequence, never symbolism or metaphor when literal evidence exists. No vague people/actions/places (a person, someone, something, somewhere, generic/public setting, standing still, doing something) unless narration-critical.",
  "Only style_treatment supplies reusable medium, realism, palette, framing, shot-scale, lighting, contrast, depth, texture, camera language, mood and imperfection; honor it without imported reference people, places, objects, products, logos or content. Photographs need believable anatomy, materials, scale, perspective, optics, light and wear, not glossy synthetic perfection. Camera/lens/viewpoint describe optics, never physical cameras, tripods, photographic gear, rigs or crew unless narrated.",
  "Shot quality selection: simplify composition without deleting narrated participants/actions or changing assigned roles. Quality overrides soft shot-scale preferences, preserving pinned medium/treatment. Avoid tiny visible faces, distant frontal/full-body portraits, rows/crowds and incidental background faces.",
  "HUMAN_MEDIUM or human REACTION_RESULT: prefer a dominant tight chest-up subject with a large unobstructed face when identity/expression matters; otherwise supported rear-facing/over-the-shoulder views. Keep necessary interactions/participants: closer necessary faces or one dominant face with compatible rear-facing others; never invent solitude or unrelated portraits.",
  "ENVIRONMENTAL_WIDE: prioritize the narrated place/result; needed people rear-facing when faces are not evidence. Landscapes remain valid; never make essential faces tiny, especially in split-right panels.",
  "HANDS_ACTION: close, large, unobstructed essential hand-object contact with ordinary anatomy and a simple supported grip. Avoid needless intertwined hands, overlapping fingers, tiny operations or extra contacts; retain narrated precise actions, never substitute aftermath.",
  "OBJECT_EVIDENCE/MACRO_DETAIL: isolate essential evidence at believable scale; no gratuitous people, oversized props, decorative machinery, extra mechanisms or invented technical/scientific details.",
  "literal_subject/action/environment are authoritative structured scene facts; downstream compiler derives final literal image description from them. Put essential close/chest-up/rear-facing/contact framing in literal_subject or environment, center-safe and large enough for assigned full/split layout and zoom. lighting_context is audit-only; pinned style owns lighting. prompt_core describes only subject/action/environment for compatibility/quality checks; it and continuity_tags do not control final image content. Scene facts/prompt_core must not repeat style suffixes, palette/hex colors, lighting or other style_treatment fields.",
  "No visible or invented typography: text, handwriting/print, letters/digits, dates, room numbers, inscriptions, plaques/signage, labels, product/measurement markings, price tags/receipts, titles/captions, branding/logos/watermarks, branded packaging, UI/screens, charts/diagrams, graphics/overlays/borders, motion graphics or decorative transitions. Convey names/dates/addresses/quantities through physical subjects, architecture or activity, never writing. Inscription/plaque/sign surfaces must be plain blank unmarked physical surfaces. Products, packages, containers, tools, medicines and purchased goods may appear only when locally supported, plain/unbranded/unmarked; no invented product details, packaging copy or advertising displays.",
  "All text fields non-empty, no control characters. Word targets: literal_subject/action/environment at most 20 each, lighting_context 10, prompt_core 45. Character ceilings: 240 each for subject/action/environment, 120 lighting_context, 600 prompt_core. continuity_tags: at most 12 unique non-empty lowercase phrases, 80 characters each, ordinary words separated by single spaces; no hyphens, underscores or slashes.",
  "Never choose duration, layout, shot role, avatar placement, style version, model, GPU, retry or fallback. Return the exact JSON contract.",
].join(" ");

/** New-run instruction only; legacy system text above remains byte-for-byte frozen. */
export const PHYSICAL_PLACEMENT_WRITER_INSTRUCTION =
  "For actions that require a visible person handling or moving an object, state the person's position relative to the object and setting, and choose a camera side that keeps their torso and the arm-to-object connection visible. Put this concrete spatial framing in literal_subject or environment within the existing character budget. Use a simple supported contact. Preserve genuine HANDS_ACTION close-ups and all narrated collaborators; do not invent participants or force faces into view. Pinned style treatment still owns camera language and shot-scale preferences.";

/** v27 strengthens the output-field requirement; v26 experiment identity stays immutable. */
export const PHYSICAL_PLACEMENT_V2_WRITER_INSTRUCTION =
  "MANDATORY PHYSICAL PLACEMENT: When a whole person handles, lifts, carries, loads, opens or moves an object, literal_subject MUST explicitly include their visible torso and connected arm(s), and environment MUST specify their physical position relative to that object plus a side or rear camera view that shows that connection. Merely naming a person and a place is insufficient. For loading a car, place the person outside the open rear hatch, viewed from beside or behind that person, never apparently inside the cargo space. Keep these drawable facts in literal_subject/environment, not prompt_core, lighting_context or continuity_tags. Fit the existing character budget by removing optional adjectives. Exempt genuine HANDS_ACTION close-ups: retain the locally supported hand-object contact without requiring torso or face. Preserve every narrated collaborator, with each necessary contact owned by the correct person; never invent solitude or additional people. Preserve pinned style treatment and assigned shot role.";

/** Exact legacy system text remains available for durable v24 recovery. */
export function naturalDocumentaryWriterSystemPrompt(literalCharacterLimit: number): string {
  if (
    !Number.isSafeInteger(literalCharacterLimit) ||
    literalCharacterLimit < 90 ||
    literalCharacterLimit > 720
  )
    fail("Natural Documentary scene-character allowance is invalid.", ["literalCharacterLimit"]);
  return SCENE_PROMPT_WRITER_SYSTEM_PROMPT.replace(
    "Prefer familiar human behavior, ordinary locations, credible objects, contextual clutter and natural imperfection; no spectacle or advertising poses. For abstractions use direct supported person/object/process/place/consequence, never symbolism or metaphor when literal evidence exists. No vague people/actions/places (a person, someone, something, somewhere, generic/public setting, standing still, doing something) unless narration-critical.",
    "Use specific supported subjects/actions/places, ordinary behavior; no advertising poses or symbolism. Clarify ambiguous scale, touched part or spatial relation only where needed. Preserve clean/new conditions; invent no objects, dirt or damage. Essential faces/contact/evidence outrank surface detail.",
  )
    .replace(
      "a dominant tight chest-up subject with a large unobstructed face",
      "a dominant chest-up subject with complete head and unobstructed face",
    )
    .replace(
      "Character ceilings: 240 each",
      `Combined literal_subject/action/environment ceiling: ${literalCharacterLimit} characters. Character ceilings: 240 each`,
    );
}

export interface RunwarePromptUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly cachedInputTokens: number;
}

export interface RunwarePromptApiRequest {
  readonly taskType: "textInference";
  readonly taskUUID: string;
  readonly model: typeof RUNWARE_PROMPT_MODEL;
  // No outputFormat/jsonSchema: Google Gemini rejects structured output with providerBadRequest, so
  // the shape is stated in the system prompt instead and validated strictly after the answer arrives.
  readonly deliveryMethod: "sync";
  readonly includeCost: true;
  readonly includeUsage: true;
  readonly settings: {
    readonly systemPrompt: string;
    readonly thinkingLevel: "off";
    readonly temperature: 0.2;
    readonly topP: 0.9;
    readonly maxTokens: number;
  };
  readonly messages: readonly [
    {
      readonly role: "user";
      readonly content: string;
    },
  ];
}

export interface RunwarePromptTransportRequest {
  readonly requestVersion: PromptRequestVersion;
  readonly attemptIndex: 1 | 2;
  readonly requestedSceneIds: readonly string[];
  readonly request: RunwarePromptApiRequest;
  /** Exact canonical UTF-8 HTTP body: a one-element Runware task array. */
  readonly requestBytes: string;
  readonly requestSha256: Sha256Digest;
  readonly retryOfRequestSha256: Sha256Digest | null;
}

export type RunwarePromptTransportResult =
  | {
      readonly status: "succeeded";
      readonly outputText: string;
      readonly latencyMs: number;
      readonly usage: RunwarePromptUsage;
      readonly costUsd: number;
      readonly finishReason: string;
      /** Native responses may omit model identity; a present value must match the pinned AIR. */
      readonly providerModel: string | null;
    }
  | {
      readonly status: "ambiguous" | "timeout" | "failed";
      readonly latencyMs: number | null;
    };

export interface RunwarePromptTransport {
  dispatch(request: RunwarePromptTransportRequest): Promise<RunwarePromptTransportResult>;
}

export type RunwarePromptValidationDisposition = "accepted" | "partial_retry" | "rejected";

/**
 * Safe categories for a provider result that reached the local prompt contract.
 * These values are intentionally coarse: no provider text, narration, prompt
 * fields, scene IDs, or parser messages cross the adapter boundary.
 */
export type RunwarePromptValidationCategory =
  | "malformed_json"
  | "schema_identity"
  | "scene_quality"
  | "metadata";

/** Stable subreasons make a terminal failure useful without exposing payload data. */
export type RunwarePromptValidationReason =
  | "output_empty_or_oversized"
  | "json_parse"
  | "top_level_schema"
  | "batch_identity"
  | "scene_collection"
  | "scene_identity"
  | "scene_schema"
  | "shot_role"
  | "scene_quality"
  | "output_text"
  | "latency"
  | "usage"
  | "cost"
  | "finish_reason"
  | "provider_model"
  | "duplicate_prompt_core"
  | "scene_relevance"
  | "scene_relevance_structure"
  | "scene_relevance_subject"
  | "scene_relevance_action_conflict"
  | "scene_relevance_context";

/**
 * Bounded diagnostics for a completed provider response. Counts are useful for
 * deciding whether a response was structurally incomplete or semantically
 * unresolved; the response itself is retained only by its hash in evidence.
 */
export interface RunwarePromptValidationDiagnostic {
  readonly category: RunwarePromptValidationCategory;
  readonly reason: RunwarePromptValidationReason;
  readonly requestedSceneCount: number;
  readonly returnedSceneCount: number | null;
  /** Scenes that passed local validation before all-or-nothing batch acceptance. */
  readonly locallyValidSceneCount: number;
  readonly unresolvedSceneCount: number;
}

const RUNWARE_PROMPT_VALIDATION_DIAGNOSTIC_BRAND =
  "videoforge.runware-prompt-validation-diagnostic/v1" as const;

/**
 * Typed local-output failure. The inherited message/path remain internal
 * validation details; callers should use only `diagnostic` for safe reporting.
 */
export class RunwarePromptValidationError extends PipelineDomainError {
  public override readonly name = "RunwarePromptValidationError";
  public readonly diagnosticBrand = RUNWARE_PROMPT_VALIDATION_DIAGNOSTIC_BRAND;

  public constructor(
    public readonly diagnostic: RunwarePromptValidationDiagnostic,
    message: string,
    path: readonly (string | number)[] = [],
  ) {
    super({ code: "PROMPT_OUTPUT_INVALID", message, path });
    this.diagnostic = Object.freeze({ ...diagnostic });
  }
}

/**
 * Extract only a structurally branded categorical diagnostic. This helper is
 * deliberately defensive because errors may cross Worker/bundle realms.
 */
export function runwarePromptValidationDiagnostic(
  value: unknown,
): RunwarePromptValidationDiagnostic | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as {
    readonly diagnosticBrand?: unknown;
    readonly diagnostic?: unknown;
  };
  if (candidate.diagnosticBrand !== RUNWARE_PROMPT_VALIDATION_DIAGNOSTIC_BRAND) return null;
  const diagnostic = candidate.diagnostic;
  if (!diagnostic || typeof diagnostic !== "object" || Array.isArray(diagnostic)) return null;
  const row = diagnostic as Record<string, unknown>;
  const categories: readonly RunwarePromptValidationCategory[] = [
    "malformed_json",
    "schema_identity",
    "scene_quality",
    "metadata",
  ];
  const reasons: readonly RunwarePromptValidationReason[] = [
    "output_empty_or_oversized",
    "json_parse",
    "top_level_schema",
    "batch_identity",
    "scene_collection",
    "scene_identity",
    "scene_schema",
    "shot_role",
    "scene_quality",
    "output_text",
    "latency",
    "usage",
    "cost",
    "finish_reason",
    "provider_model",
    "duplicate_prompt_core",
    "scene_relevance",
    "scene_relevance_structure",
    "scene_relevance_subject",
    "scene_relevance_action_conflict",
    "scene_relevance_context",
  ];
  const count = (key: string): number | null => {
    const countValue = row[key];
    return Number.isSafeInteger(countValue) && (countValue as number) >= 0
      ? (countValue as number)
      : null;
  };
  const requestedSceneCount = count("requestedSceneCount");
  const returnedSceneCountValue = row.returnedSceneCount;
  const returnedSceneCount =
    returnedSceneCountValue === null
      ? null
      : Number.isSafeInteger(returnedSceneCountValue) && (returnedSceneCountValue as number) >= 0
        ? (returnedSceneCountValue as number)
        : null;
  const locallyValidSceneCount = count("locallyValidSceneCount");
  const unresolvedSceneCount = count("unresolvedSceneCount");
  if (
    !categories.includes(row.category as RunwarePromptValidationCategory) ||
    !reasons.includes(row.reason as RunwarePromptValidationReason) ||
    requestedSceneCount === null ||
    locallyValidSceneCount === null ||
    unresolvedSceneCount === null ||
    (returnedSceneCountValue !== null && returnedSceneCount === null)
  )
    return null;
  return Object.freeze({
    category: row.category as RunwarePromptValidationCategory,
    reason: row.reason as RunwarePromptValidationReason,
    requestedSceneCount,
    returnedSceneCount,
    locallyValidSceneCount,
    unresolvedSceneCount,
  });
}

export interface RunwarePromptAttemptEvidence {
  readonly schemaVersion: "videoforge.runware-prompt-attempt-evidence/v3";
  readonly requestVersion: PromptRequestVersion;
  readonly model: typeof RUNWARE_PROMPT_MODEL;
  readonly scenePromptWriterVersion: typeof SCENE_PROMPT_WRITER_VERSION;
  readonly batchId: string;
  readonly attemptIndex: 1 | 2;
  readonly requestedSceneIds: readonly string[];
  readonly requestSha256: Sha256Digest;
  readonly responseSha256: Sha256Digest | null;
  readonly retryOfRequestSha256: Sha256Digest | null;
  readonly transportDisposition: RunwarePromptTransportResult["status"] | "exception";
  readonly latencyMs: number | null;
  readonly usage: RunwarePromptUsage | null;
  readonly costUsd: number | null;
  readonly finishReason: string | null;
  readonly validationDisposition: RunwarePromptValidationDisposition;
  readonly validationDiagnostic: RunwarePromptValidationDiagnostic | null;
  readonly acceptedSceneIds: readonly string[];
  readonly unresolvedSceneIds: readonly string[];
}

export interface RunwarePromptAttemptEvidenceSink {
  record(evidence: RunwarePromptAttemptEvidence): void | Promise<void>;
}

export interface RunwarePromptWriterOptions {
  readonly contentRepair?: boolean | "no-text-v2";
  readonly requestPolicy?: PromptRequestPolicy;
  readonly transport: RunwarePromptTransport;
  readonly evidenceSink: RunwarePromptAttemptEvidenceSink;
  /** Caller-owned reservation ceiling for this one provider request. */
  readonly maximumBatchCostUsd: number;
  /**
   * Hosted production uses advisory mode so language-based paraphrase checks
   * cannot reject a complete, contract-valid provider response.
   */
  readonly semanticQualityMode?: "advisory" | "enforce";
  /**
   * @deprecated Kept as a tolerated compatibility option. Prompt writing is
   * always single-dispatch and never retries, regardless of this value.
   */
  readonly allowPartialRetry?: boolean;
  /** @deprecated Adaptive planning owns batch size; retained for compatibility. */
  readonly minimumBatchScenes?: 1 | 25;
}

interface AttemptEvaluation {
  readonly accepted: ReadonlyMap<string, PromptWriterSceneOutput>;
  readonly unresolved: readonly PromptSceneInput[];
  readonly qualityDiagnostic: RunwarePromptValidationDiagnostic | null;
  readonly requestSha256: Sha256Digest;
  readonly costUsd: number;
}

const hash = (value: string): Sha256Digest =>
  `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;

const fail = (message: string, path: readonly (string | number)[] = []): never => {
  throw new PipelineDomainError({ code: "PROMPT_OUTPUT_INVALID", message, path });
};

const validationFail = (
  category: RunwarePromptValidationCategory,
  reason: RunwarePromptValidationReason,
  requestedSceneCount: number,
  returnedSceneCount: number | null,
  locallyValidSceneCount: number,
  unresolvedSceneCount: number,
  message: string,
  path: readonly (string | number)[] = [],
): never => {
  throw new RunwarePromptValidationError(
    {
      category,
      reason,
      requestedSceneCount,
      returnedSceneCount,
      locallyValidSceneCount,
      unresolvedSceneCount,
    },
    message,
    path,
  );
};

const exactKeys = (value: Record<string, unknown>, expected: readonly string[]): boolean => {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
};

const asRecord = (value: JsonValue): Record<string, JsonValue> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : null;

const deterministicUuid = (seed: unknown): string => {
  const bytes = Array.from(
    createHash("sha256").update(canonicalizeJson(seed), "utf8").digest().subarray(0, 16),
  );
  // Runware requires a UUID v4 task identity. The random bits remain derived from
  // the immutable request identity so exact retries keep provider idempotency.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

export const responseSchema = (
  batchId: string,
  scenes: readonly PromptSceneInput[],
): Readonly<Record<string, unknown>> =>
  Object.freeze({
    type: "object",
    additionalProperties: false,
    required: ["batch_id", "scenes"],
    properties: {
      batch_id: { const: batchId },
      scenes: {
        type: "array",
        minItems: scenes.length,
        maxItems: scenes.length,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "scene_id",
            "literal_subject",
            "action",
            "environment",
            "in_image_shot_role",
            "lighting_context",
            "continuity_tags",
            "prompt_core",
          ],
          properties: {
            scene_id: { type: "string", enum: scenes.map((scene) => scene.sceneId) },
            // Keep the provider wire schema inside the same qualified Structured
            // Outputs subset as Stage 3. Exact non-empty/length/uniqueness bounds
            // remain mandatory in validatePromptWriterOutput after the response.
            literal_subject: { type: "string" },
            action: { type: "string" },
            environment: { type: "string" },
            in_image_shot_role: {
              type: "string",
              enum: [
                "ENVIRONMENTAL_WIDE",
                "HUMAN_MEDIUM",
                "HANDS_ACTION",
                "OBJECT_EVIDENCE",
                "MACRO_DETAIL",
                "REACTION_RESULT",
              ],
            },
            lighting_context: { type: "string" },
            continuity_tags: {
              type: "array",
              maxItems: 12,
              items: { type: "string" },
            },
            prompt_core: { type: "string" },
          },
        },
      },
    },
  });

/**
 * Return a string that is close to the largest valid UTF-8 representation for
 * a field whose validator measures JavaScript string length. U+0800 is three
 * UTF-8 bytes per code unit and is intentionally used here instead of ASCII so
 * the budget remains conservative for non-English narration.
 */
const maxSizedField = (codeUnits: number): string => "\u0800".repeat(codeUnits);

/**
 * Conservative upper bound for the complete strict-JSON response body. The
 * provider schema deliberately avoids length keywords (Runware rejects those
 * keywords on this model); local validation still enforces these limits. This
 * function gives planning and maxTokens a deterministic substitute for those
 * unavailable wire constraints.
 */
export function estimatePromptWriterOutputBytes(
  batchId: string,
  scenes: readonly PromptSceneInput[],
): number {
  const candidate = {
    batch_id: batchId,
    scenes: scenes.map((scene) => ({
      scene_id: scene.sceneId,
      literal_subject: maxSizedField(240),
      action: maxSizedField(240),
      environment: maxSizedField(240),
      in_image_shot_role: scene.inImageShotRole,
      lighting_context: maxSizedField(120),
      continuity_tags: Array.from({ length: 12 }, () => maxSizedField(80)),
      prompt_core: maxSizedField(600),
    })),
  };
  return new TextEncoder().encode(canonicalizeJson(candidate)).byteLength;
}

/**
 * Estimate output tokens with deliberately conservative UTF-8 accounting.
 * This is an upper-bound planning metric, not provider-reported usage.
 */
export function estimatePromptWriterOutputTokens(
  batchId: string,
  scenes: readonly PromptSceneInput[],
): number {
  // The provider is instructed to keep all eight fields concise. A schema
  // maximum would assume every field is filled to its validator limit and
  // would create unnecessarily tiny batches; this expected-output budget is
  // conservative for the actual writer contract and leaves explicit headroom
  // in maxTokensForScenes below.
  void batchId;
  return (
    RUNWARE_PROMPT_OUTPUT_FIXED_TOKENS + scenes.length * RUNWARE_PROMPT_OUTPUT_TOKENS_PER_SCENE
  );
}

/** Estimate tokens represented by a canonical request body before dispatch. */
export function estimateRunwarePromptRequestInputTokens(requestBytes: string): number {
  if (typeof requestBytes !== "string" || requestBytes.length === 0)
    throw new TypeError("requestBytes must be a non-empty string.");
  return Math.ceil(
    new TextEncoder().encode(requestBytes).byteLength / RUNWARE_PROMPT_ESTIMATED_BYTES_PER_TOKEN,
  );
}

const maxTokensForScenes = (batchId: string, scenes: readonly PromptSceneInput[]): number => {
  const expectedOutputTokens = estimatePromptWriterOutputTokens(batchId, scenes);
  const requested = expectedOutputTokens + RUNWARE_PROMPT_OUTPUT_TOKEN_HEADROOM;
  if (requested > RUNWARE_PROMPT_MAX_OUTPUT_TOKENS)
    fail(
      `Prompt batch requires ${requested} output tokens, above the per-request ceiling of ${RUNWARE_PROMPT_MAX_OUTPUT_TOKENS}; split the contiguous scene list.`,
      ["scenes"],
    );
  return Math.max(2_048, requested);
};

export function buildRunwarePromptRequest(
  batch: PromptBatch,
  scenes: readonly PromptSceneInput[],
  attemptIndex: 1 | 2,
  retryOfRequestSha256: Sha256Digest | null = null,
  /** @deprecated Retained for source compatibility; adaptive planning owns batch size. */
  minimumBatchScenes: 1 | 25 = 1,
  requestPolicy: PromptRequestPolicy = "legacy",
  contentRepair: boolean | "no-text-v2" = false,
): RunwarePromptTransportRequest {
  void minimumBatchScenes;
  if (
    (typeof contentRepair !== "boolean" && contentRepair !== "no-text-v2") ||
    (contentRepair && attemptIndex !== 2)
  )
    fail("Content repair requires a distinct bounded replacement.", ["contentRepair"]);
  if (
    ![
      "legacy",
      "physical-placement-v1",
      "physical-placement-v2",
      "no-graphics-v1",
      "no-graphics-v2",
    ].includes(requestPolicy)
  )
    fail("Prompt request policy is invalid.", ["requestPolicy"]);
  if (scenes.length === 0) fail("Prompt attempt must contain at least one expected scene.");
  if (batch.scenePromptWriterVersion !== SCENE_PROMPT_WRITER_VERSION)
    fail("Prompt writer version is invalid.", ["scenePromptWriterVersion"]);
  const styleTreatment = validatePromptStyleTreatment(batch.styleTreatment, batch.styleProfileHash);
  if (styleTreatment === null)
    fail(
      "Prompt batch has no immutable structured style treatment; legacy planner guidance cannot reach Runware.",
      ["styleTreatment"],
    );
  if (
    (attemptIndex === 1 && retryOfRequestSha256 !== null) ||
    (attemptIndex === 2 && (retryOfRequestSha256 === null || !SHA256.test(retryOfRequestSha256)))
  )
    fail("Prompt retry lineage is invalid.", ["retryOfRequestSha256"]);
  const expected = new Set(batch.scenes.map((scene) => scene.sceneId));
  if (new Set(scenes.map((scene) => scene.sceneId)).size !== scenes.length)
    fail("Prompt attempt scene IDs must be unique.", ["scenes"]);
  if (scenes.some((scene) => !expected.has(scene.sceneId)))
    fail("Prompt attempt contains a scene outside the original batch.", ["scenes"]);
  const requestedSceneIds = scenes.map((scene) => scene.sceneId);
  const canonicalSubset = batch.scenes
    .filter((scene) => requestedSceneIds.includes(scene.sceneId))
    .map((scene) => scene.sceneId);
  if (
    (attemptIndex === 1 && scenes.length !== batch.scenes.length) ||
    requestedSceneIds.some((sceneId, index) => sceneId !== canonicalSubset[index])
  )
    fail("Prompt attempt must preserve the original batch scene order.", ["scenes"]);

  const natural = batch.styleProfileHash === NATURAL_DOCUMENTARY_STYLE_PROFILE_HASH;
  const requestVersion: PromptRequestVersion =
    contentRepair === "no-text-v2" && requestPolicy !== "no-graphics-v2"
      ? "runware-prompt-content-repair-v2"
      : contentRepair && requestPolicy !== "no-graphics-v1" && requestPolicy !== "no-graphics-v2"
        ? "runware-prompt-content-repair-v1"
        : requestPolicy === "no-graphics-v2"
          ? NO_GRAPHICS_V2_PROMPT_REQUEST_VERSION
          : requestPolicy === "no-graphics-v1"
            ? NO_GRAPHICS_PROMPT_REQUEST_VERSION
            : requestPolicy === "physical-placement-v2"
              ? PHYSICAL_PLACEMENT_V2_PROMPT_REQUEST_VERSION
              : requestPolicy === "physical-placement-v1"
                ? PHYSICAL_PLACEMENT_PROMPT_REQUEST_VERSION
                : natural
                  ? NATURAL_DOCUMENTARY_PROMPT_REQUEST_VERSION
                  : RUNWARE_PROMPT_REQUEST_VERSION;
  const legacySystemPrompt = natural
    ? naturalDocumentaryWriterSystemPrompt(batch.literalCharacterLimit ?? 0)
    : SCENE_PROMPT_WRITER_SYSTEM_PROMPT;
  const systemPrompt =
    requestPolicy === "physical-placement-v2" ||
    requestPolicy === "no-graphics-v1" ||
    requestPolicy === "no-graphics-v2"
      ? `${legacySystemPrompt} ${PHYSICAL_PLACEMENT_V2_WRITER_INSTRUCTION}`
      : requestPolicy === "physical-placement-v1"
        ? `${legacySystemPrompt} ${PHYSICAL_PLACEMENT_WRITER_INSTRUCTION}`
        : legacySystemPrompt;
  const payload = Object.freeze({
    batch_id: batch.batchId,
    attempt_index: attemptIndex,
    project_title: batch.sanitizedProjectTitle,
    image_style_version_id: batch.imageStyleVersionId,
    style_profile_hash: batch.styleProfileHash,
    style_treatment: styleTreatment,
    // Keep the scene-local script evidence before the batch context in the wire payload so the
    // provider reads each shot from its exact and adjacent script parts first.
    scenes: scenes.map((scene) => ({
      scene_id: scene.sceneId,
      exact_phrase: scene.phrase,
      exact_phrase_sha256: hash(scene.phrase),
      scene_phrase_context: scene.sentenceContext,
      prior_scene_phrase: scene.priorContext,
      next_scene_phrase: scene.nextContext,
      in_image_shot_role: scene.inImageShotRole,
      fixed_layout: scene.layout,
    })),
    // This is continuity fallback context, not the scene subject source.
    story_context: batch.storyContext,
    continuity_tags: batch.continuityTags,
  });
  const taskUUID = deterministicUuid({
    requestVersion,
    ...((contentRepair === "no-text-v2" && requestPolicy !== "no-graphics-v2") ||
    (contentRepair && requestPolicy !== "no-graphics-v1" && requestPolicy !== "no-graphics-v2")
      ? { repairPolicy: requestPolicy }
      : {}),
    batchId: batch.batchId,
    styleProfileHash: batch.styleProfileHash,
    attemptIndex,
    retryOfRequestSha256,
    sceneIds: requestedSceneIds,
  });
  // No `outputFormat`/`jsonSchema`: Google Gemini (through Runware) rejects structured output with
  // `providerBadRequest`, which failed every batch regardless of model. The system prompt still
  // requires the exact JSON document and the strict parse plus schema validation below stay in
  // force, so an answer that does not match the contract is still refused rather than accepted.
  const request: RunwarePromptApiRequest = Object.freeze({
    taskType: "textInference",
    taskUUID,
    model: RUNWARE_PROMPT_MODEL,
    deliveryMethod: "sync",
    includeCost: true,
    includeUsage: true,
    settings: Object.freeze({
      systemPrompt: `${systemPrompt}\n${SCENE_PROMPT_WRITER_OUTPUT_CONTRACT}${contentRepair || requestPolicy === "no-graphics-v1" || requestPolicy === "no-graphics-v2" ? `\n${PROMPT_CONTENT_REPAIR_INSTRUCTION}` : ""}${requestPolicy === "no-graphics-v2" || contentRepair === "no-text-v2" ? `\n${NO_GRAPHICS_V2_WRITER_INSTRUCTION}` : ""}`,
      // Match the exact canonical AIR/settings contract already qualified live
      // and used by the successful Stage 3 DeepSeek transport.
      thinkingLevel: "off",
      temperature: 0.2,
      topP: 0.9,
      maxTokens: maxTokensForScenes(batch.batchId, scenes),
    }),
    messages: Object.freeze([
      Object.freeze({ role: "user", content: canonicalizeJson(payload) }),
    ]) as unknown as RunwarePromptApiRequest["messages"],
  });
  const requestBytes = canonicalizeJson([request]);
  return Object.freeze({
    requestVersion,
    attemptIndex,
    requestedSceneIds: Object.freeze(requestedSceneIds),
    request,
    requestBytes,
    requestSha256: hash(requestBytes),
    retryOfRequestSha256,
  });
}

const validUsage = (usage: unknown): usage is RunwarePromptUsage =>
  typeof usage === "object" &&
  usage !== null &&
  !Array.isArray(usage) &&
  exactKeys(usage as Record<string, unknown>, [
    "cachedInputTokens",
    "inputTokens",
    "outputTokens",
    "totalTokens",
  ]) &&
  [
    (usage as RunwarePromptUsage).inputTokens,
    (usage as RunwarePromptUsage).outputTokens,
    (usage as RunwarePromptUsage).totalTokens,
    (usage as RunwarePromptUsage).cachedInputTokens,
  ].every((value) => Number.isSafeInteger(value) && value >= 0) &&
  (usage as RunwarePromptUsage).cachedInputTokens <= (usage as RunwarePromptUsage).inputTokens &&
  (usage as RunwarePromptUsage).totalTokens >=
    (usage as RunwarePromptUsage).inputTokens + (usage as RunwarePromptUsage).outputTokens;

const validLatency = (latencyMs: number | null): latencyMs is number =>
  latencyMs !== null && Number.isSafeInteger(latencyMs) && latencyMs >= 0;

const freezeUsage = (usage: RunwarePromptUsage): RunwarePromptUsage => Object.freeze({ ...usage });

const metadataDiagnostic = (
  result: Extract<RunwarePromptTransportResult, { status: "succeeded" }>,
  maximumBatchCostUsd: number,
  requestedSceneCount: number,
): RunwarePromptValidationDiagnostic | null => {
  const diagnostic = (reason: RunwarePromptValidationReason): RunwarePromptValidationDiagnostic =>
    Object.freeze({
      category: "metadata",
      reason,
      requestedSceneCount,
      returnedSceneCount: null,
      locallyValidSceneCount: 0,
      unresolvedSceneCount: requestedSceneCount,
    });
  if (typeof result.outputText !== "string") return diagnostic("output_text");
  if (!validLatency(result.latencyMs)) return diagnostic("latency");
  if (!validUsage(result.usage)) return diagnostic("usage");
  const costValid = Number.isFinite(result.costUsd) && result.costUsd >= 0;
  if (!costValid || result.costUsd > maximumBatchCostUsd) return diagnostic("cost");
  if (result.finishReason !== "stop") return diagnostic("finish_reason");
  if (result.providerModel !== null && result.providerModel !== RUNWARE_PROMPT_MODEL)
    return diagnostic("provider_model");
  return null;
};

const stripProviderControls = (value: string): string =>
  Array.from(value, (character) => {
    const codePoint = character.codePointAt(0)!;
    return codePoint <= 31 || (codePoint >= 127 && codePoint <= 159) ? " " : character;
  }).join("");

const removeProviderControls = (value: string): string =>
  Array.from(value)
    .filter((character) => {
      const codePoint = character.codePointAt(0)!;
      return codePoint > 31 && (codePoint < 127 || codePoint > 159);
    })
    .join("");

const boundedProviderText = (value: string, maximum: number, fallback: string): string => {
  const normalized = stripProviderControls(value.normalize("NFKC")).replace(/\s+/gu, " ").trim();
  const usable = normalized.length > 0 ? normalized : fallback;
  if (usable.length <= maximum) return usable;
  const bounded = usable
    .slice(0, maximum)
    .replace(/[\uD800-\uDBFF]$/u, "")
    .trimEnd();
  const lastSpace = bounded.lastIndexOf(" ");
  return lastSpace >= Math.floor(maximum * 0.7) ? bounded.slice(0, lastSpace) : bounded;
};

const hasHardPromptConflict = (value: string): boolean => {
  const normalized = value.normalize("NFKC");
  const candidates = [stripProviderControls(normalized), removeProviderControls(normalized)];
  try {
    candidates.forEach((candidate) => assertNoHardPromptConflict(candidate, ["providerOutput"]));
    return false;
  } catch (error) {
    if (error instanceof PipelineDomainError) return true;
    throw error;
  }
};

const safeBoundedProviderText = (
  value: string,
  maximum: number,
  fallback: string,
  safeFallback: string,
): string => {
  const source = value.normalize("NFKC").replace(/\s+/gu, " ").trim() || fallback;
  return boundedProviderText(
    hasHardPromptConflict(source) ? safeFallback : source,
    maximum,
    safeFallback,
  );
};

const normalizeReturnedScene = (
  batch: PromptBatch,
  expected: PromptSceneInput,
  candidate: JsonValue,
): PromptWriterSceneOutput | null => {
  const row = asRecord(candidate);
  if (!row || !hasSceneOutputShape(candidate)) return null;

  const lightingFallback = boundedProviderText(
    batch.styleTreatment?.lighting ?? "",
    120,
    "lighting consistent with the supplied scene context",
  );
  // Required facts have passed validation before normalization. Do not replace a
  // rejected action with filler: the compiler would send that filler to images.
  const literalSubject = boundedProviderText(row.literal_subject as string, 240, "");
  const action = boundedProviderText(row.action as string, 240, "");
  const environment = boundedProviderText(row.environment as string, 240, "");
  const lightingContext = safeBoundedProviderText(
    row.lighting_context as string,
    120,
    lightingFallback,
    "lighting consistent with the supplied scene context",
  );
  const continuityTags: string[] = [];
  const seenTags = new Set<string>();
  for (const rawTag of row.continuity_tags as string[]) {
    if (hasHardPromptConflict(rawTag)) continue;
    const tag = boundedProviderText(rawTag, 80, "");
    if (tag.length === 0) continue;
    const key = tag.toLocaleLowerCase("en-US");
    if (seenTags.has(key)) continue;
    seenTags.add(key);
    continuityTags.push(tag);
    if (continuityTags.length === 12) break;
  }
  const coreFallback = [literalSubject, action, environment, lightingContext].join(", ");
  const promptCore = boundedProviderText(row.prompt_core as string, 600, coreFallback);

  try {
    const validated = validatePromptWriterOutput(
      Object.freeze({ ...batch, scenes: Object.freeze([expected]) }),
      {
        batch_id: batch.batchId,
        scenes: [
          {
            scene_id: expected.sceneId,
            literal_subject: literalSubject,
            action,
            environment,
            in_image_shot_role: expected.inImageShotRole,
            lighting_context: lightingContext,
            continuity_tags: continuityTags,
            prompt_core: promptCore,
          },
        ],
      },
    );
    const scene = validated.scenes[0];
    if (!scene) return null;
    assertNoHardPromptConflict(
      [
        scene.literal_subject,
        scene.action,
        scene.environment,
        scene.lighting_context,
        ...scene.continuity_tags,
      ].join(", "),
      ["scenes", expected.sceneId],
    );
    return scene;
  } catch (error) {
    if (error instanceof PipelineDomainError) return null;
    throw error;
  }
};

const singleSceneValidation = (
  batch: PromptBatch,
  expected: PromptSceneInput,
  candidate: JsonValue,
  semanticQualityMode: "advisory" | "enforce",
): PromptWriterSceneOutput | null => {
  let row = asRecord(candidate);
  if (!row || !hasSceneOutputShape(candidate)) return null;
  if (semanticQualityMode === "advisory") {
    // Blank physical surfaces carry no writing. Canonicalize only a trailing, explicitly blank
    // label; descriptions of printing, branding or any following content still fail the hard gate.
    const unmarked = (value: JsonValue): JsonValue =>
      typeof value === "string"
        ? value.replace(
            /\b(a\s+)?blank\s+((?:(?:back|front|white|black|green|brown|red|blue|yellow|orange|purple|pink|grey|gray|beige|cream|tan|gold|silver|plain|paper)\s+){0,3})label(s)?(?=\s*(?:with\s+no\s+(?:text|writing)\s*)?[.!?]?\s*$)/giu,
            (
              _match,
              article: string | undefined,
              modifier: string | undefined,
              plural: string | undefined,
            ) =>
              `${article ? "an " : ""}unmarked${modifier?.trim() ? ` ${modifier.trim()}` : ""} surface${plural ? "s" : ""}`,
          )
        : value;
    row = {
      ...row,
      literal_subject: unmarked(row.literal_subject!),
      action: unmarked(row.action!),
      environment: unmarked(row.environment!),
    };
  }
  for (const field of ["literal_subject", "action", "environment"] as const) {
    const source = row[field] as string;
    const normalized = stripProviderControls(source.normalize("NFKC")).replace(/\s+/gu, " ").trim();
    // These former local fallbacks contain no drawable scene facts. Treat them
    // like empty/forbidden required output, including in advisory production mode.
    if (
      normalized.length === 0 ||
      /\b(?:the narration-supported physical (?:subject|environment)|depicting the narration-supported visible moment)\b/iu.test(
        normalized,
      ) ||
      hasHardPromptConflict(source)
    )
      return null;
  }
  if (semanticQualityMode === "advisory") return normalizeReturnedScene(batch, expected, row);
  try {
    const validated = validatePromptWriterOutput(
      Object.freeze({ ...batch, scenes: Object.freeze([expected]) }),
      { batch_id: batch.batchId, scenes: [candidate] },
    );
    const scene = validated.scenes[0];
    if (!scene) return null;
    assertNoHardPromptConflict(
      [
        scene.literal_subject,
        scene.action,
        scene.environment,
        scene.lighting_context,
        ...scene.continuity_tags,
      ].join(", "),
      ["scenes", expected.sceneId],
    );
    return scene;
  } catch (error) {
    if (error instanceof PipelineDomainError) return null;
    throw error;
  }
};

const PROMPT_SCENE_OUTPUT_KEYS = [
  "scene_id",
  "literal_subject",
  "action",
  "environment",
  "in_image_shot_role",
  "lighting_context",
  "continuity_tags",
  "prompt_core",
] as const;

/**
 * Check only the provider-wire shape. Content bounds and
 * hard prompt conflicts are intentionally left to the scene-quality check.
 */
const hasSceneOutputShape = (candidate: JsonValue): boolean => {
  const row = asRecord(candidate);
  if (!row || !exactKeys(row, PROMPT_SCENE_OUTPUT_KEYS)) return false;
  if (
    typeof row.scene_id !== "string" ||
    typeof row.literal_subject !== "string" ||
    typeof row.action !== "string" ||
    typeof row.environment !== "string" ||
    typeof row.in_image_shot_role !== "string" ||
    typeof row.lighting_context !== "string" ||
    typeof row.prompt_core !== "string"
  )
    return false;
  return (
    Array.isArray(row.continuity_tags) &&
    row.continuity_tags.length <= 12 &&
    row.continuity_tags.every((tag) => typeof tag === "string")
  );
};

const RELEVANCE_WORD = /[\p{L}\p{N}]+/gu;
const RELEVANCE_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "above",
  "about",
  "across",
  "against",
  "along",
  "amid",
  "among",
  "around",
  "are",
  "as",
  "at",
  "be",
  "behind",
  "below",
  "beneath",
  "beside",
  "between",
  "beyond",
  "by",
  "can",
  "could",
  "for",
  "from",
  "has",
  "have",
  "had",
  "he",
  "in",
  "inside",
  "into",
  "is",
  "it",
  "its",
  "me",
  "of",
  "on",
  "onto",
  "or",
  "our",
  "outside",
  "over",
  "past",
  "that",
  "the",
  "their",
  "this",
  "to",
  "toward",
  "under",
  "underneath",
  "until",
  "upon",
  "up",
  "via",
  "was",
  "we",
  "with",
  "within",
  "without",
  "will",
  "would",
  "should",
  "may",
  "might",
  "must",
  "you",
  // These words are common narration glue or writer scaffolding. They must
  // not be allowed to make an otherwise unrelated image look grounded.
  "again",
  "action",
  "after",
  "before",
  "began",
  "changed",
  "close",
  "documentary",
  "everything",
  "first",
  "image",
  "literal",
  "marker",
  "next",
  "ordinary",
  "practical",
  "real",
  "same",
  "second",
  "setting",
  "still",
  "then",
  "view",
  "world",
  "writing",
  "one",
  "two",
  "three",
  "there",
  "here",
  "does",
  "did",
  "do",
  "she",
  "they",
  "them",
  "his",
  "her",
  "your",
  // Writer boilerplate must not satisfy a content-relevance check.
  "camera",
  "evidence",
  "literal",
  "narrated",
  "narration",
  "physical",
  "scene",
  "visual",
]);

/**
 * This is intentionally a small, deterministic semantic vocabulary rather
 * than a second model call. Prompt acceptance must remain provider-free and
 * bounded, but simple morphology and a few high-confidence paraphrase groups
 * keep the gate from demanding literal narration-token copying.
 */
const RELEVANCE_ALIAS_GROUPS = [
  ["agricultural", "agriculture", "cultivator", "farmer", "grower"],
  ["bicycle", "bike", "cycle"],
  ["broken", "damaged", "faulty", "malfunctioning"],
  ["bubble", "fizz", "foam", "froth"],
  ["buy", "pay", "purchase"],
  ["demonstrate", "display", "illustrate", "show"],
  ["fix", "maintain", "mend", "repair", "restore", "service"],
  ["machine", "motor", "pump", "equipment"],
  ["observe", "notice", "see", "watch"],
  ["operate", "run", "use", "work"],
  ["start", "begin", "commence"],
  ["adjust", "align", "calibrate", "tune"],
  ["assemble", "build", "construct", "install"],
  ["carry", "bring", "hold", "lift", "take"],
  ["check", "inspect", "examine", "test"],
  ["clean", "scrub", "wash"],
  ["cook", "bake", "fry", "prepare"],
  ["cut", "chop", "slice", "trim"],
  ["drink", "eat", "consume"],
  ["drive", "steer", "travel"],
  ["enter", "arrive", "reach"],
  ["fill", "pour", "empty"],
  ["grow", "harvest", "plant", "pick"],
  ["move", "walk", "stroll", "climb"],
  ["open", "unlock", "uncover"],
  ["place", "put", "set"],
  ["keep", "position", "remain", "rest", "sit", "stand", "stay", "store", "tuck"],
  ["remove", "detach", "uninstall"],
  ["ride", "rides", "riding"],
  ["rotate", "turn", "twist"],
  ["speak", "say", "talk"],
  ["steal", "rob"],
  ["woman", "female"],
];

const RELEVANCE_ALIASES = new Map<string, string>();
for (const group of RELEVANCE_ALIAS_GROUPS) {
  const canonical = group[0];
  if (canonical === undefined) continue;
  for (const word of group) RELEVANCE_ALIASES.set(word, canonical);
}

/**
 * Action equivalence is deliberately narrower than general lexical relevance.
 * Related but visibly different actions such as fill/empty, plant/harvest,
 * eat/drink, and sit/stand must never collapse into one concept.
 */
const ACTION_ALIAS_GROUPS = [
  ["adjust", "align", "calibrate", "tune"],
  ["assemble", "build", "construct", "install"],
  ["bubble", "fizz", "foam", "froth"],
  ["buy", "pay", "purchase"],
  ["check", "examine", "inspect", "test"],
  ["clean", "scrub", "wash"],
  ["demonstrate", "display", "illustrate", "show"],
  ["destroy", "smash", "wreck"],
  ["drive", "steer"],
  ["fix", "maintain", "mend", "repair", "restore", "service"],
  ["keep", "remain", "rest", "stay", "store", "tuck"],
  ["observe", "gaze", "look", "notice", "see", "watch"],
  ["open", "uncover", "unlock"],
  ["place", "put", "set"],
  ["remove", "detach", "uninstall"],
  ["rotate", "turn", "twist"],
  ["speak", "say", "talk"],
  ["start", "begin", "commence"],
  ["steal", "rob"],
] as const;

const DISTINCT_ACTION_WORDS = [
  "arrive",
  "bake",
  "bring",
  "carry",
  "chop",
  "climb",
  "consume",
  "cook",
  "cut",
  "drink",
  "eat",
  "empty",
  "enter",
  "fill",
  "fry",
  "go",
  "grow",
  "harvest",
  "hold",
  "lift",
  "move",
  "operate",
  "pick",
  "plant",
  "position",
  "pour",
  "prepare",
  "reach",
  "ride",
  "run",
  "sit",
  "slice",
  "stand",
  "stroll",
  "take",
  "travel",
  "trim",
  "use",
  "walk",
  "work",
] as const;

const ACTION_ALIASES = new Map<string, string>();
for (const group of ACTION_ALIAS_GROUPS) {
  const canonical = group[0];
  for (const word of group) ACTION_ALIASES.set(word, canonical);
}
for (const word of DISTINCT_ACTION_WORDS) ACTION_ALIASES.set(word, word);

const RECOGNIZED_ACTION_CONCEPTS = new Set(ACTION_ALIASES.values());

const stemRelevanceWord = (word: string): string => {
  const restoreDroppedE = (stem: string): string =>
    stem.endsWith("at") || stem.endsWith("as") || stem.endsWith("us") ? `${stem}e` : stem;

  // Keep short nouns intact, but normalize common four-letter present-tense
  // forms (buys/pays/runs) so narration-to-action grounding accepts
  // morphology without maintaining a verb dictionary.
  if (word.length <= 4)
    return word.length === 4 && word.endsWith("s") && !word.endsWith("ss")
      ? word.slice(0, -1)
      : word;
  if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith("ing") && word.length > 4) {
    const stem = word.slice(0, -3);
    // running -> run, not runn. This is a deliberately light stemmer, not a
    // general English morphological parser.
    if (stem.length > 3 && stem.at(-1) === stem.at(-2)) return stem.slice(0, -1);
    // Preserve a silent-e base for the productive -ate/-ating pattern
    // (demonstrating/demonstrates -> demonstrate) without a verb list.
    // The same dropped-e spelling occurs in common -ase/-use bases (for
    // example, purchasing/use -> purchase/use). This remains morphology-only;
    // no finite action vocabulary is involved.
    return restoreDroppedE(stem);
  }
  if (word.endsWith("ied") && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith("ated") && word.length > 5) return `${word.slice(0, -2)}e`;
  if (word.endsWith("ed") && word.length > 4) return restoreDroppedE(word.slice(0, -2));
  if (word.endsWith("ates") && word.length > 5) return word.slice(0, -1);
  if (
    (word.endsWith("sses") ||
      word.endsWith("ches") ||
      word.endsWith("shes") ||
      word.endsWith("xes") ||
      word.endsWith("zes")) &&
    word.length > 4
  )
    return word.slice(0, -2);
  if (word.endsWith("oes") && word.length > 4) return word.slice(0, -2);
  if (word.endsWith("es") && word.length > 4) return word.slice(0, -1);
  if (word.endsWith("s") && !word.endsWith("ss") && word.length > 4) return word.slice(0, -1);
  return word;
};

const relevanceConcept = (word: string): string => {
  const stem = stemRelevanceWord(word);
  // Check both forms because suffix stripping intentionally does not attempt
  // to normalize every irregular form (for example, damaged -> damag). A
  // single restored silent-e maps driving -> drive and bubbling -> bubble
  // before later nouns can be mistaken for the scene's action.
  return (
    RELEVANCE_ALIASES.get(stem) ??
    RELEVANCE_ALIASES.get(word) ??
    RELEVANCE_ALIASES.get(`${stem}e`) ??
    stem
  );
};

const actionConcept = (word: string): string | null => {
  if (word.length < 3 || RELEVANCE_STOPWORDS.has(word) || /^\d+$/u.test(word)) return null;
  const stem = stemRelevanceWord(word);
  return (
    ACTION_ALIASES.get(stem) ?? ACTION_ALIASES.get(word) ?? ACTION_ALIASES.get(`${stem}e`) ?? null
  );
};

interface RelevanceTerm {
  readonly raw: string;
  readonly concept: string;
}

const relevanceTerms = (value: string): readonly RelevanceTerm[] =>
  (value.normalize("NFKC").toLocaleLowerCase("en-US").match(RELEVANCE_WORD) ?? [])
    .filter((word) => word.length >= 3 && !RELEVANCE_STOPWORDS.has(word) && !/^\d+$/u.test(word))
    .map((raw) => Object.freeze({ raw, concept: relevanceConcept(raw) }));

const distinctiveRelevanceWords = (value: string): ReadonlySet<string> =>
  new Set(relevanceTerms(value).map(({ concept }) => concept));

/**
 * Treat a single dropped silent-e as morphology, not as a new action. This
 * covers forms such as drives/driving and rides/riding without enumerating
 * verbs or allowing arbitrary semantic substitutions.
 */
const relevanceConceptsEquivalent = (left: string, right: string): boolean =>
  left === right || (left.length > 2 && (left === `${right}e` || `${left}e` === right));

const ACTION_CHAIN_CONNECTOR = /\b(?:while|then|and|but)\b/iu;

interface ActionChain {
  readonly connector: "while" | "then" | "and" | "but";
  readonly tail: string;
}

const actionChain = (value: string): ActionChain | null => {
  const match = value.match(/\b(while|then|and|but)\b([\s\S]*)/iu);
  const connector = match?.[1]?.toLocaleLowerCase("en-US");
  const tail = match?.[2]?.trim();
  if (
    (connector !== "while" && connector !== "then" && connector !== "and" && connector !== "but") ||
    !tail
  )
    return null;
  return Object.freeze({ connector, tail });
};

const narratedActionChain = (value: string, connector: ActionChain["connector"]): string | null => {
  const escapedConnector = connector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = value.match(new RegExp(`\\b${escapedConnector}\\b([\\s\\S]*)`, "iu"));
  return match?.[1]?.trim() || null;
};

const outputActionConcepts = (value: string): ReadonlySet<string> => {
  for (const { raw } of relevanceTerms(value)) {
    const concept = actionConcept(raw);
    if (concept !== null) return new Set([concept]);
  }
  return new Set();
};

const narratedActionConcepts = (value: string): ReadonlySet<string> => {
  // A recognized word in narration may be a noun or adjective ("household
  // uses", "cleaning products", "fresh cut"). Each candidate must therefore
  // carry its own finite, progressive, infinitive/modal, plural-subject, or
  // imperative evidence before it can participate in a hard contradiction.
  const normalized = value.normalize("NFKC").toLocaleLowerCase("en-US");
  const words = normalized.match(RELEVANCE_WORD) ?? [];
  const stativeWords = new Set([
    "are",
    "contain",
    "contains",
    "had",
    "has",
    "have",
    "include",
    "includes",
    "is",
    "mean",
    "means",
    "seem",
    "seems",
    "was",
    "were",
  ]);
  const connectorWords = new Set(["and", "but", "then", "while"]);
  const modalWords = new Set(["can", "could", "may", "might", "must", "should", "will", "would"]);
  const beWords = new Set(["am", "are", "is", "was", "were"]);
  const haveWords = new Set(["had", "has", "have"]);
  const concepts = new Set<string>();
  for (const [index, raw] of words.entries()) {
    const concept = actionConcept(raw);
    if (concept === null) continue;
    const previous = words[index - 1];
    const previousPrevious = words[index - 2];
    const precededByAdverb = previous?.endsWith("ly") === true;
    const controlWord = precededByAdverb ? previousPrevious : previous;
    if (controlWord === "to" || (controlWord !== undefined && modalWords.has(controlWord))) {
      concepts.add(concept);
      continue;
    }
    if (raw.endsWith("ing") && controlWord !== undefined && beWords.has(controlWord)) {
      concepts.add(concept);
      continue;
    }
    if (raw.endsWith("ed") && controlWord !== undefined && haveWords.has(controlWord)) {
      concepts.add(concept);
      continue;
    }
    let nearestStativeIndex = -1;
    let nearestConnectorIndex = -1;
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const priorWord = words[cursor];
      if (priorWord === undefined) continue;
      if (nearestConnectorIndex < 0 && connectorWords.has(priorWord))
        nearestConnectorIndex = cursor;
      if (stativeWords.has(priorWord)) {
        nearestStativeIndex = cursor;
        break;
      }
    }
    const locallyBlockedByStative =
      nearestStativeIndex >= 0 && nearestStativeIndex > nearestConnectorIndex;
    if (/(?:ed|ies|oes|s)$/u.test(raw) && !raw.endsWith("ss") && !locallyBlockedByStative) {
      concepts.add(concept);
      continue;
    }
    let previousContentWord: string | undefined;
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const priorWord = words[cursor];
      if (priorWord === undefined || RELEVANCE_STOPWORDS.has(priorWord)) continue;
      previousContentWord = priorWord;
      break;
    }
    if (
      previousContentWord !== undefined &&
      previousContentWord.endsWith("s") &&
      !raw.endsWith("ing")
    ) {
      concepts.add(concept);
      continue;
    }
    if (index === 0) concepts.add(concept);
  }
  return concepts;
};

const relevanceOverlap = (expected: ReadonlySet<string>, actual: ReadonlySet<string>): number => {
  let count = 0;
  for (const concept of expected) if (actual.has(concept)) count += 1;
  return count;
};

const GENERIC_VISUAL_PLACEHOLDER =
  /\b(?:a person|some person|someone|something|somewhere|generic (?:place|setting|scene)|public setting|ordinary scene|standing still|doing something|various objects?|general activity|unidentified subject)\b/iu;

/**
 * This bounded local gate validates the structured scene facts. It deliberately
 * uses the expected phrase and containing sentence as the primary evidence,
 * with adjacent phrases as a small continuity supplement for pronouns and
 * abstract claims. The raw prompt_core is retained for wire compatibility and
 * detail/forbidden-content QC only; the compiler derives final image content
 * from the structured fields. The first verb-shaped action concept is checked
 * generically against narration, so natural leading adverbs remain valid but
 * an unseen action cannot be swapped for a plausible unrelated one.
 */
type SceneRelevanceFailureReason =
  | "scene_relevance_structure"
  | "scene_relevance_subject"
  | "scene_relevance_action_conflict"
  | "scene_relevance_context";

const sceneOutputRelevanceFailure = (
  expectedScene: PromptSceneInput,
  row: Record<string, JsonValue>,
  boundedStoryContext: string,
): SceneRelevanceFailureReason | null => {
  const structuredFields = [row.literal_subject, row.action, row.environment].filter(
    (value): value is string => typeof value === "string",
  );
  const promptCore = row.prompt_core;
  if (structuredFields.length !== 3 || typeof promptCore !== "string")
    return "scene_relevance_structure";
  const fields = [...structuredFields, promptCore];
  const normalized = fields.join(" ").normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (GENERIC_VISUAL_PLACEHOLDER.test(normalized)) return "scene_relevance_structure";
  if (structuredFields.some((value) => distinctiveRelevanceWords(value).size === 0))
    return "scene_relevance_structure";
  if (distinctiveRelevanceWords(promptCore).size < 6) return "scene_relevance_structure";

  // Cap each source window before tokenizing. Stage 4 already bounds these
  // values, but this keeps acceptance cost and behavior stable for legacy or
  // adversarial rows crossing the adapter boundary.
  const primaryContext = [expectedScene.phrase, expectedScene.sentenceContext]
    .map((value) => value.slice(0, 2_000))
    .join(" ");
  const nearbyContext = [expectedScene.priorContext, expectedScene.nextContext]
    .filter((value): value is string => value !== null)
    .map((value) => value.slice(0, 800))
    .join(" ");
  const boundedGlobalContext = boundedStoryContext.slice(0, 4_000);
  const structuredContent = structuredFields.join(" ");

  const localExpected = distinctiveRelevanceWords([primaryContext, nearbyContext].join(" "));
  const globalExpected = distinctiveRelevanceWords(boundedGlobalContext);
  const primaryExpected = distinctiveRelevanceWords(primaryContext);
  const nearbyExpected = distinctiveRelevanceWords(nearbyContext);
  const outputConcepts = distinctiveRelevanceWords(structuredContent);
  const phraseConcepts = distinctiveRelevanceWords(expectedScene.phrase);
  const phraseEntityConcepts = [...phraseConcepts].filter(
    (concept) => !RECOGNIZED_ACTION_CONCEPTS.has(concept),
  );
  const normalizedPhrase = expectedScene.phrase
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/\s+/gu, " ")
    .trim();
  const normalizedSentence = expectedScene.sentenceContext
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/\s+/gu, " ")
    .trim();
  const phraseStartsInsideContainingSentence = normalizedSentence.indexOf(normalizedPhrase) > 0;
  const phraseIsDependentOpener =
    /^(?:after|although|as|at|because|before|beneath|beside|despite|during|from|in|inside|near|on|outside|over|through|under|when|while|with|without)\b/iu.test(
      normalizedPhrase,
    );
  const phraseNeedsStoryResolution =
    /\b(?:he|her|hers|him|his|it|its|she|that|their|theirs|them|these|they|this|those|which|who|whom|whose)\b/iu.test(
      expectedScene.phrase,
    ) ||
    phraseEntityConcepts.length === 0 ||
    phraseStartsInsideContainingSentence ||
    phraseIsDependentOpener;
  const phraseOverlap = relevanceOverlap(phraseConcepts, outputConcepts);
  const primaryOverlap = relevanceOverlap(primaryExpected, outputConcepts);
  const phraseActions = narratedActionConcepts(expectedScene.phrase);
  const narratedActions =
    phraseActions.size > 0
      ? phraseActions
      : phraseNeedsStoryResolution
        ? narratedActionConcepts(expectedScene.sentenceContext)
        : new Set<string>();
  const outputActions = outputActionConcepts(row.action as string);
  if (
    narratedActions.size > 0 &&
    outputActions.size > 0 &&
    ![...narratedActions].some((narratedAction) =>
      [...outputActions].some((outputAction) =>
        relevanceConceptsEquivalent(narratedAction, outputAction),
      ),
    )
  )
    return "scene_relevance_action_conflict";

  // The subject must remain narration-grounded. An ordinary compatible
  // environment necessarily may introduce concrete words absent from the
  // prose, so lexical overlap is not a sound environment-quality proxy (for
  // example, "under pressure" and "in 2020" are not scene locations). The
  // request contract governs location fidelity; action and whole-row checks
  // below still reject an unrelated event or subject.
  const subjectConcepts = distinctiveRelevanceWords(row.literal_subject as string);
  const subjectEntityConcepts = [...subjectConcepts].filter(
    (concept) => !RECOGNIZED_ACTION_CONCEPTS.has(concept),
  );
  const groundingSubjectConcepts =
    subjectEntityConcepts.length > 0 ? subjectEntityConcepts : [...subjectConcepts];
  const subjectHasPhraseAnchor = groundingSubjectConcepts.some((concept) =>
    phraseConcepts.has(concept),
  );
  const subjectHasLocalContextAnchor =
    subjectHasPhraseAnchor ||
    (phraseNeedsStoryResolution &&
      groundingSubjectConcepts.some((concept) => localExpected.has(concept)));
  // Global story context is a fallback only when the local script window contains no usable anchor.
  const subjectHasGlobalFallbackAnchor =
    phraseNeedsStoryResolution &&
    localExpected.size === 0 &&
    groundingSubjectConcepts.some((concept) => globalExpected.has(concept));
  const subjectHasSourceAnchor = subjectHasLocalContextAnchor || subjectHasGlobalFallbackAnchor;
  if (!subjectHasSourceAnchor) return "scene_relevance_subject";

  // A coordinated literal subject may include an ordinary visible prop, but
  // an isolated ungrounded tail is still evidence of an invented second
  // subject. Corroboration must come from the authoritative structured action
  // or environment rather than prompt_core, which naturally repeats subjects.
  const hasUnsupportedCoordinatedSubjectTail = (value: string): boolean => {
    const tail = value.match(/\b(?:and|but)\b([\s\S]*)/iu)?.[1]?.trim();
    if (!tail) return false;
    const coreTail = tail.split(/\b(?:at|beside|by|holding|in|near|on|over|under|with)\b/iu, 1)[0];
    const tailConcepts = distinctiveRelevanceWords(coreTail ?? tail);
    if (tailConcepts.size === 0) return false;
    const corroboratingConcepts = distinctiveRelevanceWords(
      `${row.action as string} ${row.environment as string}`,
    );
    const sourceAnchors = localExpected.size > 0 ? localExpected : globalExpected;
    return ![...tailConcepts].some(
      (concept) => sourceAnchors.has(concept) || corroboratingConcepts.has(concept),
    );
  };
  if (hasUnsupportedCoordinatedSubjectTail(row.literal_subject as string))
    return "scene_relevance_subject";

  // One generated scene must describe one capturable action. If the provider
  // adds a while/then/and/but clause with an action tail, narration must contain
  // that same coordination; when both tails expose an inflected action, keep
  // those actions aligned. Bare and-lists of objects remain valid details.
  const outputChain = actionChain(row.action as string);
  if (outputChain !== null && ACTION_CHAIN_CONNECTOR.test(row.action as string)) {
    const outputTailActions = outputActionConcepts(outputChain.tail);
    if (outputTailActions.size > 0) {
      const narratedTail = narratedActionChain(primaryContext, outputChain.connector);
      if (narratedTail === null) return "scene_relevance_action_conflict";
      const narratedTailActions = narratedActionConcepts(narratedTail);
      if (narratedTailActions.size === 0) return "scene_relevance_action_conflict";
      if (
        ![...narratedTailActions].some((narratedTailAction) =>
          [...outputTailActions].some((outputTailAction) =>
            relevanceConceptsEquivalent(outputTailAction, narratedTailAction),
          ),
        )
      )
        return "scene_relevance_action_conflict";
    }
  }

  // Exact-phrase grounding stays primary, but lexical matching is used only as
  // coarse evidence. It must not pretend to prove semantic equivalence for a
  // stative claim or paraphrased visible action.
  if (
    phraseConcepts.size > 0 &&
    phraseOverlap === 0 &&
    (!phraseNeedsStoryResolution || primaryOverlap < 2)
  )
    return "scene_relevance_context";

  // Pronoun-only or otherwise token-light phrases need the containing sentence
  // or adjacent continuity window to carry at least two useful anchors.
  const expectedWindowSize = primaryExpected.size + nearbyExpected.size;
  if (expectedWindowSize === 0) {
    // Some legacy Stage 4 fixtures contain only scaffolding words (for
    // example, "literal scene 4") and consequently have no semantic anchor
    // to compare. In that degenerate case, require the exact bounded phrase
    // to be present; this fallback cannot make a fox/alpine-lake response
    // pass a bicycle-repair narration because that narration has anchors.
    const phrase = expectedScene.phrase.normalize("NFKC").replace(/\s+/gu, " ").trim();
    const output = structuredContent.normalize("NFKC").replace(/\s+/gu, " ").trim();
    return phrase.length > 0 &&
      output.toLocaleLowerCase("en-US").includes(phrase.toLocaleLowerCase("en-US"))
      ? null
      : "scene_relevance_context";
  }
  const contextualOverlap =
    relevanceOverlap(primaryExpected, outputConcepts) +
    relevanceOverlap(nearbyExpected, outputConcepts);
  if (phraseConcepts.size === 0 && contextualOverlap < (expectedWindowSize >= 3 ? 2 : 1))
    return "scene_relevance_context";
  return null;
};

const evaluateOutput = (
  batch: PromptBatch,
  requestedScenes: readonly PromptSceneInput[],
  outputText: string,
  semanticQualityMode: "advisory" | "enforce",
): Omit<AttemptEvaluation, "requestSha256" | "costUsd"> => {
  const requestedSceneCount = requestedScenes.length;
  if (outputText.length === 0 || outputText.length > 2_000_000)
    return validationFail(
      "malformed_json",
      "output_empty_or_oversized",
      requestedSceneCount,
      null,
      0,
      requestedSceneCount,
      "Prompt transport returned blank or oversized output.",
    );
  let parsed: JsonValue;
  try {
    parsed = parseJsonStrict(stripCodeFence(outputText));
  } catch {
    return validationFail(
      "malformed_json",
      "json_parse",
      requestedSceneCount,
      null,
      0,
      requestedSceneCount,
      "Prompt transport returned malformed strict JSON.",
    );
  }
  const record = asRecord(parsed);
  if (!record || !exactKeys(record, ["batch_id", "scenes"]))
    return validationFail(
      "schema_identity",
      "top_level_schema",
      requestedSceneCount,
      null,
      0,
      requestedSceneCount,
      "Prompt response top-level schema is invalid.",
    );
  if (record.batch_id !== batch.batchId)
    return validationFail(
      "schema_identity",
      "batch_identity",
      requestedSceneCount,
      Array.isArray(record.scenes) ? record.scenes.length : null,
      0,
      requestedSceneCount,
      "Prompt response batch identity is invalid.",
      ["batch_id"],
    );
  if (!Array.isArray(record.scenes))
    return validationFail(
      "schema_identity",
      "top_level_schema",
      requestedSceneCount,
      null,
      0,
      requestedSceneCount,
      "Prompt response scene collection is invalid.",
      ["scenes"],
    );
  const responseScenes = record.scenes;
  if (responseScenes.length !== requestedSceneCount)
    return validationFail(
      "schema_identity",
      "scene_collection",
      requestedSceneCount,
      responseScenes.length,
      0,
      Math.max(0, requestedSceneCount - responseScenes.length),
      "Prompt response scene collection is incomplete.",
      ["scenes"],
    );

  const expected = new Map(requestedScenes.map((scene) => [scene.sceneId, scene]));
  const seen = new Set<string>();
  const accepted = new Map<string, PromptWriterSceneOutput>();
  let qualityDiagnostic: RunwarePromptValidationDiagnostic | null = null;
  for (const candidate of responseScenes) {
    const row = asRecord(candidate);
    if (!row || typeof row.scene_id !== "string")
      return validationFail(
        "schema_identity",
        "scene_identity",
        requestedSceneCount,
        responseScenes.length,
        accepted.size,
        Math.max(0, requestedSceneCount - accepted.size),
        "Prompt response contains a scene without a usable identity.",
        ["scenes"],
      );
    const sceneId = row.scene_id;
    const expectedScene = expected.get(sceneId);
    if (!expectedScene || seen.has(sceneId))
      return validationFail(
        "schema_identity",
        "scene_identity",
        requestedSceneCount,
        responseScenes.length,
        accepted.size,
        Math.max(0, requestedSceneCount - accepted.size),
        "Prompt response contains an unknown or duplicated scene ID.",
        ["scenes"],
      );
    seen.add(sceneId);
    if (
      Object.hasOwn(row, "in_image_shot_role") &&
      row.in_image_shot_role !== expectedScene.inImageShotRole
    )
      return validationFail(
        "schema_identity",
        "shot_role",
        requestedSceneCount,
        responseScenes.length,
        accepted.size,
        Math.max(0, requestedSceneCount - accepted.size),
        "Prompt response changed a code-assigned shot role.",
        ["scenes", sceneId],
      );
    if (!hasSceneOutputShape(candidate))
      return validationFail(
        "schema_identity",
        "scene_schema",
        requestedSceneCount,
        responseScenes.length,
        accepted.size,
        Math.max(0, requestedSceneCount - accepted.size),
        "Prompt response scene shape is invalid.",
        ["scenes"],
      );
    const valid = singleSceneValidation(batch, expectedScene, candidate, semanticQualityMode);
    if (!valid) continue;
    const relevanceFailure = sceneOutputRelevanceFailure(
      expectedScene,
      row,
      batch.storyContext.slice(0, 4_000),
    );
    if (relevanceFailure !== null) {
      if (semanticQualityMode === "enforce")
        return validationFail(
          "scene_quality",
          relevanceFailure,
          requestedSceneCount,
          responseScenes.length,
          accepted.size,
          Math.max(0, requestedSceneCount - accepted.size),
          "Prompt response scene content is not grounded in the exact narration fragment.",
          ["scenes", sceneId],
        );
      qualityDiagnostic ??= Object.freeze({
        category: "scene_quality",
        reason: relevanceFailure,
        requestedSceneCount,
        returnedSceneCount: responseScenes.length,
        locallyValidSceneCount: requestedSceneCount,
        unresolvedSceneCount: 0,
      });
    }
    accepted.set(sceneId, valid);
  }
  if (accepted.size !== requestedSceneCount)
    return validationFail(
      "scene_quality",
      "scene_quality",
      requestedSceneCount,
      responseScenes.length,
      accepted.size,
      requestedSceneCount - accepted.size,
      "Prompt response did not resolve every expected scene.",
      ["scenes"],
    );
  const promptCoreOwners = new Map<string, string>();
  for (const expectedScene of requestedScenes) {
    const acceptedScene = accepted.get(expectedScene.sceneId);
    if (!acceptedScene) continue;
    const normalizedCore = acceptedScene.prompt_core
      .normalize("NFKC")
      .replace(/\s+/gu, " ")
      .trim()
      .toLocaleLowerCase("en-US");
    const previousSceneId = promptCoreOwners.get(normalizedCore);
    if (previousSceneId !== undefined) {
      if (semanticQualityMode === "enforce")
        return validationFail(
          "scene_quality",
          "duplicate_prompt_core",
          requestedSceneCount,
          responseScenes.length,
          accepted.size,
          requestedSceneCount,
          "Prompt response reused an identical normalized prompt core for multiple scenes.",
          ["scenes", expectedScene.sceneId, "prompt_core"],
        );
      qualityDiagnostic ??= Object.freeze({
        category: "scene_quality",
        reason: "duplicate_prompt_core",
        requestedSceneCount,
        returnedSceneCount: responseScenes.length,
        locallyValidSceneCount: requestedSceneCount,
        unresolvedSceneCount: 0,
      });
    }
    promptCoreOwners.set(normalizedCore, expectedScene.sceneId);
  }
  return Object.freeze({
    accepted,
    unresolved: Object.freeze(requestedScenes.filter((scene) => !accepted.has(scene.sceneId))),
    qualityDiagnostic,
  });
};

const evidence = (
  batch: PromptBatch,
  request: RunwarePromptTransportRequest,
  values: Omit<
    RunwarePromptAttemptEvidence,
    | "schemaVersion"
    | "requestVersion"
    | "model"
    | "scenePromptWriterVersion"
    | "batchId"
    | "attemptIndex"
    | "requestedSceneIds"
    | "requestSha256"
    | "retryOfRequestSha256"
  >,
): RunwarePromptAttemptEvidence =>
  Object.freeze({
    schemaVersion: "videoforge.runware-prompt-attempt-evidence/v3",
    requestVersion: request.requestVersion,
    model: RUNWARE_PROMPT_MODEL,
    scenePromptWriterVersion: batch.scenePromptWriterVersion,
    batchId: batch.batchId,
    attemptIndex: request.attemptIndex,
    requestedSceneIds: request.requestedSceneIds,
    requestSha256: request.requestSha256,
    retryOfRequestSha256: request.retryOfRequestSha256,
    ...values,
  });

/**
 * Removes a Markdown code fence from a provider answer.
 *
 * The request used to carry `outputFormat: "JSON"` plus a strict `jsonSchema`, which is what made
 * Google Gemini reject every prompt batch with `providerBadRequest` ("Request contains an invalid
 * argument") — measured on 2026-09-18 by replaying the exact request bytes: removing those two fields
 * let the same batch return valid, parseable JSON. Without the structured-output flags the model may
 * wrap its answer in a ```json fence, so the fence is stripped before the strict parse.
 */
export function stripCodeFence(outputText: string): string {
  const trimmed = outputText.trim();
  if (!trimmed.startsWith("```")) return outputText;
  const withoutOpening = trimmed.slice(3).replace(/^(json|JSON)\s*\n/, "");
  const closing = withoutOpening.lastIndexOf("```");
  return closing === -1 ? withoutOpening : withoutOpening.slice(0, closing).trim();
}

export class RunwarePromptWriter implements PromptWriterPort {
  readonly #transport: RunwarePromptTransport;
  readonly #evidenceSink: RunwarePromptAttemptEvidenceSink;
  readonly #maximumBatchCostUsd: number;
  readonly #semanticQualityMode: "advisory" | "enforce";
  readonly #requestPolicy: PromptRequestPolicy;
  readonly #contentRepair: boolean | "no-text-v2";

  constructor(options: RunwarePromptWriterOptions) {
    if (!Number.isFinite(options.maximumBatchCostUsd) || options.maximumBatchCostUsd < 0)
      throw new TypeError("maximumBatchCostUsd must be a finite non-negative number.");
    if (options.minimumBatchScenes !== undefined && ![1, 25].includes(options.minimumBatchScenes))
      throw new TypeError("minimumBatchScenes must be 1 or 25.");
    this.#requestPolicy = options.requestPolicy ?? "legacy";
    this.#contentRepair = options.contentRepair ?? false;
    this.#transport = options.transport;
    this.#evidenceSink = options.evidenceSink;
    this.#maximumBatchCostUsd = options.maximumBatchCostUsd;
    this.#semanticQualityMode = options.semanticQualityMode ?? "enforce";
  }

  async #record(value: RunwarePromptAttemptEvidence): Promise<void> {
    try {
      await this.#evidenceSink.record(value);
    } catch {
      fail("Prompt attempt evidence sink failed closed.");
    }
  }

  async #attempt(
    batch: PromptBatch,
    scenes: readonly PromptSceneInput[],
    attemptIndex: 1 | 2,
    retryOfRequestSha256: Sha256Digest | null,
  ): Promise<AttemptEvaluation> {
    const request = buildRunwarePromptRequest(
      batch,
      scenes,
      attemptIndex,
      retryOfRequestSha256,
      1,
      this.#requestPolicy,
      this.#contentRepair,
    );
    let result: RunwarePromptTransportResult;
    try {
      result = await this.#transport.dispatch(request);
    } catch {
      await this.#record(
        evidence(batch, request, {
          responseSha256: null,
          transportDisposition: "exception",
          latencyMs: null,
          usage: null,
          costUsd: null,
          finishReason: null,
          validationDisposition: "rejected",
          validationDiagnostic: null,
          acceptedSceneIds: Object.freeze([]),
          unresolvedSceneIds: Object.freeze(scenes.map((scene) => scene.sceneId)),
        }),
      );
      return fail("Prompt transport raised an opaque exception.");
    }

    if (result.status !== "succeeded") {
      await this.#record(
        evidence(batch, request, {
          responseSha256: null,
          transportDisposition: result.status,
          latencyMs: validLatency(result.latencyMs) ? result.latencyMs : null,
          usage: null,
          costUsd: null,
          finishReason: null,
          validationDisposition: "rejected",
          validationDiagnostic: null,
          acceptedSceneIds: Object.freeze([]),
          unresolvedSceneIds: Object.freeze(scenes.map((scene) => scene.sceneId)),
        }),
      );
      return fail(`Prompt transport ended with ${result.status} disposition.`);
    }

    const responseSha256 = typeof result.outputText === "string" ? hash(result.outputText) : null;
    const metadataFailure = metadataDiagnostic(result, this.#maximumBatchCostUsd, scenes.length);
    if (metadataFailure !== null) {
      const costValid = Number.isFinite(result.costUsd) && result.costUsd >= 0;
      await this.#record(
        evidence(batch, request, {
          responseSha256,
          transportDisposition: "succeeded",
          latencyMs: validLatency(result.latencyMs) ? result.latencyMs : null,
          usage: validUsage(result.usage) ? freezeUsage(result.usage) : null,
          costUsd: costValid ? result.costUsd : null,
          finishReason:
            typeof result.finishReason === "string" && result.finishReason.length <= 80
              ? result.finishReason
              : null,
          validationDisposition: "rejected",
          validationDiagnostic: metadataFailure,
          acceptedSceneIds: Object.freeze([]),
          unresolvedSceneIds: Object.freeze(scenes.map((scene) => scene.sceneId)),
        }),
      );
      return validationFail(
        "metadata",
        metadataFailure.reason,
        scenes.length,
        null,
        0,
        scenes.length,
        "Prompt response usage, cost, finish, latency, or model evidence is invalid.",
      );
    }

    let evaluated: Omit<AttemptEvaluation, "requestSha256" | "costUsd">;
    try {
      evaluated = evaluateOutput(batch, scenes, result.outputText, this.#semanticQualityMode);
    } catch (error) {
      const validationDiagnostic = runwarePromptValidationDiagnostic(error);
      await this.#record(
        evidence(batch, request, {
          responseSha256,
          transportDisposition: "succeeded",
          latencyMs: result.latencyMs,
          usage: freezeUsage(result.usage),
          costUsd: result.costUsd,
          finishReason: result.finishReason,
          validationDisposition: "rejected",
          validationDiagnostic,
          acceptedSceneIds: Object.freeze([]),
          unresolvedSceneIds: Object.freeze(scenes.map((scene) => scene.sceneId)),
        }),
      );
      throw error;
    }
    const validationDisposition: RunwarePromptValidationDisposition =
      evaluated.unresolved.length === 0 ? "accepted" : "rejected";
    const acceptedSceneIds =
      validationDisposition === "accepted"
        ? Object.freeze(
            scenes
              .map((scene) => scene.sceneId)
              .filter((sceneId) => evaluated.accepted.has(sceneId)),
          )
        : Object.freeze([]);
    const unresolvedSceneIds =
      validationDisposition === "accepted"
        ? Object.freeze([])
        : Object.freeze(scenes.map((scene) => scene.sceneId));
    const validationDiagnostic =
      validationDisposition === "accepted"
        ? evaluated.qualityDiagnostic
        : Object.freeze({
            category: "scene_quality" as const,
            reason: "scene_quality" as const,
            requestedSceneCount: scenes.length,
            returnedSceneCount: scenes.length,
            locallyValidSceneCount: evaluated.accepted.size,
            unresolvedSceneCount: evaluated.unresolved.length,
          });
    await this.#record(
      evidence(batch, request, {
        responseSha256,
        transportDisposition: "succeeded",
        latencyMs: result.latencyMs,
        usage: freezeUsage(result.usage),
        costUsd: result.costUsd,
        finishReason: result.finishReason,
        validationDisposition,
        validationDiagnostic,
        acceptedSceneIds,
        unresolvedSceneIds,
      }),
    );
    if (validationDisposition === "rejected")
      return validationFail(
        "scene_quality",
        "scene_quality",
        scenes.length,
        scenes.length,
        evaluated.accepted.size,
        evaluated.unresolved.length,
        "Prompt response did not resolve every expected scene.",
        ["scenes"],
      );
    return Object.freeze({
      ...evaluated,
      requestSha256: request.requestSha256,
      costUsd: result.costUsd,
    });
  }

  async write(
    batch: PromptBatch,
    retryOfRequestSha256: Sha256Digest | null = null,
  ): Promise<PromptWriterBatchOutput> {
    const first = await this.#attempt(
      batch,
      batch.scenes,
      retryOfRequestSha256 === null ? 1 : 2,
      retryOfRequestSha256,
    );
    return validatePromptWriterOutput(batch, {
      batch_id: batch.batchId,
      scenes: batch.scenes.map((scene) => first.accepted.get(scene.sceneId)),
    });
  }
}

import { createHash } from "node:crypto";

import {
  canonicalizeJson,
  parseJsonStrict,
  type JsonValue,
  type Sha256Digest,
} from "@videoforge/contracts";

import { PipelineDomainError } from "../errors.js";
import { validatePromptWriterOutput } from "./batch.js";
import { assertNoHardPromptConflict } from "./compiler.js";
import type {
  PromptBatch,
  PromptSceneInput,
  PromptWriterBatchOutput,
  PromptWriterPort,
  PromptWriterSceneOutput,
} from "./types.js";

export const RUNWARE_PROMPT_MODEL = "deepseek:v4@flash" as const;
export const RUNWARE_PROMPT_REQUEST_VERSION =
  "runware-deepseek-v4-flash-prompt-request-v8" as const;
/**
 * Runware currently permits a considerably larger response, but this tighter
 * application ceiling leaves room for request metadata and keeps one malformed
 * long response from consuming the whole execution reservation.
 */
export const RUNWARE_PROMPT_MAX_OUTPUT_TOKENS = 64_000 as const;
/** Typical output sizing hint retained for callers that display estimates. */
export const RUNWARE_PROMPT_OUTPUT_TOKENS_PER_SCENE = 512 as const;
export const RUNWARE_PROMPT_OUTPUT_TOKEN_HEADROOM = 2_048 as const;
export const RUNWARE_PROMPT_OUTPUT_FIXED_TOKENS = 1_024 as const;
/** Conservative UTF-8 token budget used by the adaptive planner. */
export const RUNWARE_PROMPT_MAX_INPUT_TOKENS = 48_000 as const;
/** Two bytes per token errs toward a larger estimate for mixed-language text. */
export const RUNWARE_PROMPT_ESTIMATED_BYTES_PER_TOKEN = 2 as const;

export const SCENE_PROMPT_WRITER_SYSTEM_PROMPT = [
  "Write concise literal still-image scene cores for VideoForge.",
  "Return every requested scene ID exactly once and echo its in-image shot role unchanged.",
  "Copy each required_literal_anchor verbatim into that scene's prompt_core.",
  "Use adjacent context only to disambiguate; it may never override the exact phrase.",
  "Use the compact story context to resolve people, places, pronouns, callbacks, era, and continuity; it may never override the exact phrase or containing sentence.",
  "Choose concrete visible evidence of the exact phrase, never a generic mood image merely related to the overall topic.",
  "Design one camera-capturable moment per scene: a specific subject doing a physically plausible visible action in a specific real-world environment.",
  "Prefer familiar human behavior, ordinary locations, credible objects, contextual clutter, and natural imperfection when the narration supports them; never manufacture spectacle or a staged advertising pose.",
  "For abstract narration, show the most direct transcript-supported person, object, process, place, or consequence; never substitute symbolism or metaphor when literal evidence exists.",
  "Use planner guidance only as the pinned style's visual treatment: honor its medium, palette, lighting, texture, camera language, and imperfection without importing people, places, objects, logos, or other content from style references.",
  "For photographic styles, require believable anatomy, materials, scale, perspective, optics, light, and everyday wear rather than glossy synthetic perfection.",
  "Keep each prompt_core under 600 characters: one concrete, descriptive still-image sentence with only details that improve literal relevance.",
  "Do not pad, editorialize, or repeat subject, action, environment, lighting, or continuity details inside prompt_core.",
  "Do not repeat a full style suffix or invent continuity facts.",
  "Never request visible text, captions, titles, logos, watermarks, UI, graphics, diagrams, borders, branded products, motion graphics, or decorative transitions.",
  "Never choose duration, layout, shot role, avatar placement, model, GPU, retry, or fallback.",
  "Return only the strict requested JSON.",
].join(" ");

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
  readonly outputFormat: "JSON";
  readonly deliveryMethod: "sync";
  readonly includeCost: true;
  readonly includeUsage: true;
  readonly jsonSchema: {
    readonly name: "videoforge_scene_prompt_batch";
    readonly strict: true;
    readonly schema: Readonly<Record<string, unknown>>;
  };
  readonly settings: {
    readonly systemPrompt: typeof SCENE_PROMPT_WRITER_SYSTEM_PROMPT;
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
  readonly requestVersion: typeof RUNWARE_PROMPT_REQUEST_VERSION;
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

export interface RunwarePromptAttemptEvidence {
  readonly schemaVersion: "videoforge.runware-prompt-attempt-evidence/v1";
  readonly requestVersion: typeof RUNWARE_PROMPT_REQUEST_VERSION;
  readonly model: typeof RUNWARE_PROMPT_MODEL;
  readonly scenePromptWriterVersion: "scene-prompt-writer-v1";
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
  readonly acceptedSceneIds: readonly string[];
  readonly unresolvedSceneIds: readonly string[];
}

export interface RunwarePromptAttemptEvidenceSink {
  record(evidence: RunwarePromptAttemptEvidence): void | Promise<void>;
}

export interface RunwarePromptWriterOptions {
  readonly transport: RunwarePromptTransport;
  readonly evidenceSink: RunwarePromptAttemptEvidenceSink;
  /** Caller-owned reservation ceiling for this one provider request. */
  readonly maximumBatchCostUsd: number;
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
  readonly requestSha256: Sha256Digest;
  readonly costUsd: number;
}

const hash = (value: string): Sha256Digest =>
  `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;

const fail = (message: string, path: readonly (string | number)[] = []): never => {
  throw new PipelineDomainError({ code: "PROMPT_OUTPUT_INVALID", message, path });
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

const literalAnchor = (phrase: string): string => {
  const characters = Array.from(phrase);
  if (characters.length <= 160) return phrase;
  const prefix = characters.slice(0, 160).join("");
  const lastSpace = prefix.lastIndexOf(" ");
  return (lastSpace >= 80 ? prefix.slice(0, lastSpace) : prefix).trim();
};

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

const responseSchema = (
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
): RunwarePromptTransportRequest {
  void minimumBatchScenes;
  if (scenes.length === 0) fail("Prompt attempt must contain at least one expected scene.");
  if (batch.scenePromptWriterVersion !== "scene-prompt-writer-v1")
    fail("Prompt writer version is invalid.", ["scenePromptWriterVersion"]);
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

  const payload = Object.freeze({
    batch_id: batch.batchId,
    attempt_index: attemptIndex,
    project_title: batch.sanitizedProjectTitle,
    image_style_version_id: batch.imageStyleVersionId,
    style_profile_hash: batch.styleProfileHash,
    planner_guidance: batch.plannerGuidance,
    story_context: batch.storyContext,
    continuity_tags: batch.continuityTags,
    scenes: scenes.map((scene) => ({
      scene_id: scene.sceneId,
      exact_phrase: scene.phrase,
      exact_phrase_sha256: hash(scene.phrase),
      containing_sentence: scene.sentenceContext,
      required_literal_anchor: literalAnchor(scene.phrase),
      prior_context: scene.priorContext,
      next_context: scene.nextContext,
      in_image_shot_role: scene.inImageShotRole,
      fixed_layout: scene.layout,
    })),
  });
  const taskUUID = deterministicUuid({
    requestVersion: RUNWARE_PROMPT_REQUEST_VERSION,
    batchId: batch.batchId,
    styleProfileHash: batch.styleProfileHash,
    attemptIndex,
    retryOfRequestSha256,
    sceneIds: requestedSceneIds,
  });
  const request: RunwarePromptApiRequest = Object.freeze({
    taskType: "textInference",
    taskUUID,
    model: RUNWARE_PROMPT_MODEL,
    outputFormat: "JSON",
    deliveryMethod: "sync",
    includeCost: true,
    includeUsage: true,
    jsonSchema: Object.freeze({
      name: "videoforge_scene_prompt_batch",
      strict: true,
      schema: responseSchema(batch.batchId, scenes),
    }),
    settings: Object.freeze({
      systemPrompt: SCENE_PROMPT_WRITER_SYSTEM_PROMPT,
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
    requestVersion: RUNWARE_PROMPT_REQUEST_VERSION,
    attemptIndex,
    requestedSceneIds: Object.freeze(requestedSceneIds),
    request,
    requestBytes,
    requestSha256: hash(requestBytes),
    retryOfRequestSha256,
  });
}

const validUsage = (usage: RunwarePromptUsage): boolean =>
  exactKeys(usage as unknown as Record<string, unknown>, [
    "cachedInputTokens",
    "inputTokens",
    "outputTokens",
    "totalTokens",
  ]) &&
  [usage.inputTokens, usage.outputTokens, usage.totalTokens, usage.cachedInputTokens].every(
    (value) => Number.isSafeInteger(value) && value >= 0,
  ) &&
  usage.cachedInputTokens <= usage.inputTokens &&
  usage.totalTokens >= usage.inputTokens + usage.outputTokens;

const validLatency = (latencyMs: number | null): latencyMs is number =>
  latencyMs !== null && Number.isSafeInteger(latencyMs) && latencyMs >= 0;

const freezeUsage = (usage: RunwarePromptUsage): RunwarePromptUsage => Object.freeze({ ...usage });

const singleSceneValidation = (
  batch: PromptBatch,
  expected: PromptSceneInput,
  candidate: JsonValue,
): PromptWriterSceneOutput | null => {
  try {
    const validated = validatePromptWriterOutput(
      Object.freeze({ ...batch, scenes: Object.freeze([expected]) }),
      { batch_id: batch.batchId, scenes: [candidate] },
    );
    const scene = validated.scenes[0];
    if (!scene) return null;
    const anchor = literalAnchor(expected.phrase).toLocaleLowerCase("en-US");
    if (!scene.prompt_core.toLocaleLowerCase("en-US").includes(anchor)) return null;
    assertNoHardPromptConflict(
      [
        scene.literal_subject,
        scene.action,
        scene.environment,
        scene.lighting_context,
        scene.prompt_core,
      ].join(", "),
      ["scenes", expected.sceneId],
    );
    return scene;
  } catch (error) {
    if (error instanceof PipelineDomainError) return null;
    throw error;
  }
};

const evaluateOutput = (
  batch: PromptBatch,
  requestedScenes: readonly PromptSceneInput[],
  outputText: string,
): Omit<AttemptEvaluation, "requestSha256" | "costUsd"> => {
  if (outputText.length === 0 || outputText.length > 2_000_000)
    fail("Prompt transport returned blank or oversized output.");
  let parsed: JsonValue;
  try {
    parsed = parseJsonStrict(outputText);
  } catch {
    return fail("Prompt transport returned malformed strict JSON.");
  }
  const record = asRecord(parsed);
  if (!record || !exactKeys(record, ["batch_id", "scenes"]))
    return fail("Prompt response top-level schema is invalid.");
  if (record.batch_id !== batch.batchId || !Array.isArray(record.scenes))
    return fail("Prompt response batch identity or scene collection is invalid.");
  const responseScenes = record.scenes;

  const expected = new Map(requestedScenes.map((scene) => [scene.sceneId, scene]));
  const seen = new Set<string>();
  const accepted = new Map<string, PromptWriterSceneOutput>();
  for (const candidate of responseScenes) {
    const row = asRecord(candidate);
    if (!row || typeof row.scene_id !== "string")
      return fail("Prompt response contains a scene without a usable identity.", ["scenes"]);
    const sceneId = row.scene_id;
    const expectedScene = expected.get(sceneId);
    if (!expectedScene || seen.has(sceneId))
      return fail("Prompt response contains an unknown or duplicated scene ID.", ["scenes"]);
    seen.add(sceneId);
    if (
      Object.hasOwn(row, "in_image_shot_role") &&
      row.in_image_shot_role !== expectedScene.inImageShotRole
    )
      return fail("Prompt response changed a code-assigned shot role.", ["scenes", sceneId]);
    const valid = singleSceneValidation(batch, expectedScene, candidate);
    if (valid) accepted.set(sceneId, valid);
  }
  return Object.freeze({
    accepted,
    unresolved: Object.freeze(requestedScenes.filter((scene) => !accepted.has(scene.sceneId))),
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
    schemaVersion: "videoforge.runware-prompt-attempt-evidence/v1",
    requestVersion: RUNWARE_PROMPT_REQUEST_VERSION,
    model: RUNWARE_PROMPT_MODEL,
    scenePromptWriterVersion: batch.scenePromptWriterVersion,
    batchId: batch.batchId,
    attemptIndex: request.attemptIndex,
    requestedSceneIds: request.requestedSceneIds,
    requestSha256: request.requestSha256,
    retryOfRequestSha256: request.retryOfRequestSha256,
    ...values,
  });

export class RunwarePromptWriter implements PromptWriterPort {
  readonly #transport: RunwarePromptTransport;
  readonly #evidenceSink: RunwarePromptAttemptEvidenceSink;
  readonly #maximumBatchCostUsd: number;

  constructor(options: RunwarePromptWriterOptions) {
    if (!Number.isFinite(options.maximumBatchCostUsd) || options.maximumBatchCostUsd < 0)
      throw new TypeError("maximumBatchCostUsd must be a finite non-negative number.");
    if (options.minimumBatchScenes !== undefined && ![1, 25].includes(options.minimumBatchScenes))
      throw new TypeError("minimumBatchScenes must be 1 or 25.");
    this.#transport = options.transport;
    this.#evidenceSink = options.evidenceSink;
    this.#maximumBatchCostUsd = options.maximumBatchCostUsd;
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
    const request = buildRunwarePromptRequest(batch, scenes, attemptIndex, retryOfRequestSha256);
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
          acceptedSceneIds: Object.freeze([]),
          unresolvedSceneIds: Object.freeze(scenes.map((scene) => scene.sceneId)),
        }),
      );
      return fail(`Prompt transport ended with ${result.status} disposition.`);
    }

    const responseSha256 = typeof result.outputText === "string" ? hash(result.outputText) : null;
    const costValid = Number.isFinite(result.costUsd) && result.costUsd >= 0;
    const metadataValid =
      typeof result.outputText === "string" &&
      validLatency(result.latencyMs) &&
      validUsage(result.usage) &&
      costValid &&
      result.costUsd <= this.#maximumBatchCostUsd &&
      result.finishReason === "stop" &&
      (result.providerModel === null || result.providerModel === RUNWARE_PROMPT_MODEL);
    if (!metadataValid) {
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
          acceptedSceneIds: Object.freeze([]),
          unresolvedSceneIds: Object.freeze(scenes.map((scene) => scene.sceneId)),
        }),
      );
      return fail("Prompt response usage, cost, finish, latency, or model evidence is invalid.");
    }

    let evaluated: Omit<AttemptEvaluation, "requestSha256" | "costUsd">;
    try {
      evaluated = evaluateOutput(batch, scenes, result.outputText);
    } catch (error) {
      await this.#record(
        evidence(batch, request, {
          responseSha256,
          transportDisposition: "succeeded",
          latencyMs: result.latencyMs,
          usage: freezeUsage(result.usage),
          costUsd: result.costUsd,
          finishReason: result.finishReason,
          validationDisposition: "rejected",
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
        ? Object.freeze([...evaluated.accepted.keys()])
        : Object.freeze([]);
    const unresolvedSceneIds =
      validationDisposition === "accepted"
        ? Object.freeze([])
        : Object.freeze(scenes.map((scene) => scene.sceneId));
    await this.#record(
      evidence(batch, request, {
        responseSha256,
        transportDisposition: "succeeded",
        latencyMs: result.latencyMs,
        usage: freezeUsage(result.usage),
        costUsd: result.costUsd,
        finishReason: result.finishReason,
        validationDisposition,
        acceptedSceneIds,
        unresolvedSceneIds,
      }),
    );
    if (validationDisposition === "rejected")
      fail("Prompt response did not resolve every expected scene.", ["scenes"]);
    return Object.freeze({
      ...evaluated,
      requestSha256: request.requestSha256,
      costUsd: result.costUsd,
    });
  }

  async write(batch: PromptBatch): Promise<PromptWriterBatchOutput> {
    const first = await this.#attempt(batch, batch.scenes, 1, null);
    return validatePromptWriterOutput(batch, {
      batch_id: batch.batchId,
      scenes: batch.scenes.map((scene) => first.accepted.get(scene.sceneId)),
    });
  }
}

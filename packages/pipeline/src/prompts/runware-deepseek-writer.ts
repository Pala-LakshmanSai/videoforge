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

export const RUNWARE_PROMPT_MODEL = "deepseek-v4-flash" as const;
export const RUNWARE_PROMPT_REQUEST_VERSION = "runware-deepseek-v4-flash-prompt-request-v3" as const;
export const RUNWARE_PROMPT_MAX_OUTPUT_TOKENS = 8_000 as const;
export const RUNWARE_PROMPT_OUTPUT_TOKENS_PER_SCENE = 150 as const;

export const SCENE_PROMPT_WRITER_SYSTEM_PROMPT = [
  "Write concise literal still-image scene cores for VideoForge.",
  "Return every requested scene ID exactly once and echo its in-image shot role unchanged.",
  "Copy each required_literal_anchor verbatim into that scene's prompt_core.",
  "Use adjacent context only to disambiguate; it may never override the exact phrase.",
  "Use the compact story context to resolve people, places, pronouns, callbacks, era, and continuity; it may never override the exact phrase or containing sentence.",
  "Choose concrete visible evidence of the exact phrase, never a generic mood image merely related to the overall topic.",
  "Use planner guidance as visual treatment, never as subject matter.",
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
    readonly thinkingLevel: "high";
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
  /** Caller-owned reservation ceiling across the first attempt and one partial retry. */
  readonly maximumBatchCostUsd: number;
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
            literal_subject: { type: "string", minLength: 1, maxLength: 240 },
            action: { type: "string", minLength: 1, maxLength: 240 },
            environment: { type: "string", minLength: 1, maxLength: 240 },
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
            lighting_context: { type: "string", minLength: 1, maxLength: 120 },
            continuity_tags: {
              type: "array",
              maxItems: 12,
              uniqueItems: true,
              items: { type: "string", minLength: 1, maxLength: 80 },
            },
            prompt_core: { type: "string", minLength: 1, maxLength: 600 },
          },
        },
      },
    },
  });

export function buildRunwarePromptRequest(
  batch: PromptBatch,
  scenes: readonly PromptSceneInput[],
  attemptIndex: 1 | 2,
  retryOfRequestSha256: Sha256Digest | null = null,
): RunwarePromptTransportRequest {
  if (scenes.length === 0) fail("Prompt attempt must contain at least one expected scene.");
  if (batch.scenePromptWriterVersion !== "scene-prompt-writer-v1")
    fail("Prompt writer version is invalid.", ["scenePromptWriterVersion"]);
  if (batch.scenes.length < 25 || batch.scenes.length > 50)
    fail("Original prompt batch must contain 25-50 scenes.", ["scenes"]);
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
      thinkingLevel: "high",
      temperature: 0.2,
      topP: 0.9,
      maxTokens: Math.min(
        RUNWARE_PROMPT_MAX_OUTPUT_TOKENS,
        Math.max(512, scenes.length * RUNWARE_PROMPT_OUTPUT_TOKENS_PER_SCENE),
      ),
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
    priorCostUsd: number,
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
      priorCostUsd + result.costUsd <= this.#maximumBatchCostUsd &&
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
      evaluated.unresolved.length === 0
        ? "accepted"
        : attemptIndex === 1
          ? "partial_retry"
          : "rejected";
    await this.#record(
      evidence(batch, request, {
        responseSha256,
        transportDisposition: "succeeded",
        latencyMs: result.latencyMs,
        usage: freezeUsage(result.usage),
        costUsd: result.costUsd,
        finishReason: result.finishReason,
        validationDisposition,
        acceptedSceneIds: Object.freeze([...evaluated.accepted.keys()]),
        unresolvedSceneIds: Object.freeze(evaluated.unresolved.map((scene) => scene.sceneId)),
      }),
    );
    if (validationDisposition === "rejected")
      fail("Prompt retry did not resolve every expected scene.", ["scenes"]);
    return Object.freeze({
      ...evaluated,
      requestSha256: request.requestSha256,
      costUsd: result.costUsd,
    });
  }

  async write(batch: PromptBatch): Promise<PromptWriterBatchOutput> {
    const first = await this.#attempt(batch, batch.scenes, 1, null, 0);
    const accepted = new Map(first.accepted);
    if (first.unresolved.length > 0) {
      const retry = await this.#attempt(
        batch,
        first.unresolved,
        2,
        first.requestSha256,
        first.costUsd,
      );
      for (const [sceneId, scene] of retry.accepted) accepted.set(sceneId, scene);
    }
    const merged = {
      batch_id: batch.batchId,
      scenes: batch.scenes.map((scene) => accepted.get(scene.sceneId)),
    };
    return validatePromptWriterOutput(batch, merged);
  }
}

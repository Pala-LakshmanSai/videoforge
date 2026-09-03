import { canonicalizeJson } from "@videoforge/contracts";

import { PipelineDomainError } from "../errors.js";
import {
  IN_IMAGE_SHOT_ROLES,
  type PromptBatch,
  type PromptBatchInput,
  type PromptSceneInput,
  type PromptWriterBatchOutput,
  type PromptWriterSceneOutput,
} from "./types.js";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
export const MAX_PROMPT_STORY_CONTEXT_CHARS = 360 as const;
export const MAX_PROMPT_LOCAL_CONTEXT_CHARS = 80_000 as const;
const stripControls = (value: string): string =>
  Array.from(value, (character) => {
    const codePoint = character.codePointAt(0)!;
    return codePoint <= 31 || (codePoint >= 127 && codePoint <= 159) ? " " : character;
  }).join("");

const fail = (
  code: "PROMPT_INPUT_INVALID" | "PROMPT_OUTPUT_INVALID",
  message: string,
  path: readonly (string | number)[],
): never => {
  throw new PipelineDomainError({ code, message, path });
};

const normalized = (
  value: string,
  maximum: number,
  label: string,
  path: readonly (string | number)[],
): string => {
  const result = stripControls(value.normalize("NFKC")).replace(/\s+/gu, " ").trim();
  if (result.length === 0 || result.length > maximum)
    fail("PROMPT_INPUT_INVALID", `${label} must contain 1-${maximum} normalized characters.`, path);
  return result;
};

const normalizedOutput = (
  value: string,
  maximum: number,
  label: string,
  path: readonly (string | number)[],
): string => {
  const result = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (result.length === 0 || result.length > maximum || stripControls(result) !== result)
    fail(
      "PROMPT_OUTPUT_INVALID",
      `${label} is blank, oversized, or contains control characters.`,
      path,
    );
  return result;
};

const snapshot = (value: unknown): unknown => {
  try {
    return JSON.parse(canonicalizeJson(value));
  } catch {
    return fail(
      "PROMPT_OUTPUT_INVALID",
      "Prompt writer output must be a plain canonical JSON value.",
      [],
    );
  }
};

export function buildPromptBatch(input: PromptBatchInput): PromptBatch {
  if (!ID.test(input.batchId)) fail("PROMPT_INPUT_INVALID", "Batch ID is invalid.", ["batchId"]);
  if (!ID.test(input.imageStyleVersionId))
    fail("PROMPT_INPUT_INVALID", "Image Style version ID is invalid.", ["imageStyleVersionId"]);
  if (!SHA256.test(input.styleProfileHash))
    fail("PROMPT_INPUT_INVALID", "Style profile hash is invalid.", ["styleProfileHash"]);
  // A batch is a transport unit, not a script-size contract. Stage 4 owns the
  // complete deterministic scene list; the adaptive planner chooses how many
  // contiguous scenes fit each provider request. Keeping this validator at a
  // one-scene minimum lets short scripts and the final remainder use the same
  // immutable prompt contract without inventing a project-level scene cap.
  if (input.scenes.length < 1)
    fail("PROMPT_INPUT_INVALID", "Prompt batch must contain at least one scene.", ["scenes"]);

  const ids = new Set<string>();
  const scenes = input.scenes.map((scene, index): PromptSceneInput => {
    if (!ID.test(scene.sceneId) || ids.has(scene.sceneId))
      fail("PROMPT_INPUT_INVALID", "Scene IDs must be valid and unique.", [
        "scenes",
        index,
        "sceneId",
      ]);
    ids.add(scene.sceneId);
    if (!IN_IMAGE_SHOT_ROLES.includes(scene.inImageShotRole))
      fail("PROMPT_INPUT_INVALID", "In-image shot role is invalid.", [
        "scenes",
        index,
        "inImageShotRole",
      ]);
    if (scene.layout !== "IMAGE_FULL" && scene.layout !== "SPLIT_RIGHT_IMAGE")
      fail("PROMPT_INPUT_INVALID", "Image layout is invalid.", ["scenes", index, "layout"]);
    return Object.freeze({
      sceneId: scene.sceneId,
      phrase: normalized(scene.phrase, 1_000, "Scene phrase", ["scenes", index, "phrase"]),
      sentenceContext: normalized(scene.sentenceContext, 2_000, "Containing sentence", [
        "scenes",
        index,
        "sentenceContext",
      ]),
      priorContext:
        scene.priorContext === null
          ? null
          : normalized(scene.priorContext, 1_000, "Prior context", [
              "scenes",
              index,
              "priorContext",
            ]),
      nextContext:
        scene.nextContext === null
          ? null
          : normalized(scene.nextContext, 1_000, "Next context", ["scenes", index, "nextContext"]),
      inImageShotRole: scene.inImageShotRole,
      layout: scene.layout,
    });
  });
  const localContextCharacters = scenes.reduce(
    (total, scene) =>
      total +
      scene.phrase.length +
      scene.sentenceContext.length +
      (scene.priorContext?.length ?? 0) +
      (scene.nextContext?.length ?? 0),
    0,
  );
  if (localContextCharacters > MAX_PROMPT_LOCAL_CONTEXT_CHARS)
    fail(
      "PROMPT_INPUT_INVALID",
      `Combined scene context must contain at most ${MAX_PROMPT_LOCAL_CONTEXT_CHARS} characters.`,
      ["scenes"],
    );

  const tags = input.continuityTags.map((tag, index) =>
    normalized(tag, 80, "Continuity tag", ["continuityTags", index]),
  );
  if (tags.length > 40 || new Set(tags).size !== tags.length)
    fail("PROMPT_INPUT_INVALID", "Continuity tags must be unique and bounded to 40.", [
      "continuityTags",
    ]);

  return Object.freeze({
    scenePromptWriterVersion: "scene-prompt-writer-v1",
    batchId: input.batchId,
    sanitizedProjectTitle: normalized(input.projectTitle, 240, "Project title", ["projectTitle"]),
    imageStyleVersionId: input.imageStyleVersionId,
    styleProfileHash: input.styleProfileHash,
    plannerGuidance: normalized(input.plannerGuidance, 2_000, "Planner guidance", [
      "plannerGuidance",
    ]),
    storyContext: normalized(input.storyContext, MAX_PROMPT_STORY_CONTEXT_CHARS, "Story context", [
      "storyContext",
    ]),
    continuityTags: Object.freeze(tags),
    scenes: Object.freeze(scenes),
  });
}

const readString = (
  record: Record<string, unknown>,
  key: string,
  maximum: number,
  path: readonly (string | number)[],
): string => {
  const value = record[key];
  if (typeof value !== "string")
    return fail("PROMPT_OUTPUT_INVALID", `${key} must be a string.`, [...path, key]);
  const result = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (result.length === 0 || result.length > maximum || stripControls(result) !== result)
    return fail(
      "PROMPT_OUTPUT_INVALID",
      `${key} is blank, oversized, or contains control characters.`,
      [...path, key],
    );
  return result;
};

const exactKeys = (
  record: Record<string, unknown>,
  expected: readonly string[],
  path: readonly (string | number)[],
): void => {
  const actual = Object.keys(record).sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== [...expected].sort()[index])
  )
    fail("PROMPT_OUTPUT_INVALID", "Prompt writer output contains missing or unknown fields.", path);
};

export function validatePromptWriterOutput(
  batch: PromptBatch,
  candidate: unknown,
): PromptWriterBatchOutput {
  const value = snapshot(candidate);
  if (typeof value !== "object" || value === null || Array.isArray(value))
    fail("PROMPT_OUTPUT_INVALID", "Prompt writer batch must be an object.", []);
  const record = value as Record<string, unknown>;
  exactKeys(record, ["batch_id", "scenes"], []);
  const sceneCandidates = record.scenes;
  if (record.batch_id !== batch.batchId)
    fail("PROMPT_OUTPUT_INVALID", "Prompt writer batch identity is invalid.", ["batch_id"]);
  if (!Array.isArray(sceneCandidates))
    fail("PROMPT_OUTPUT_INVALID", "Prompt writer batch identity or scenes are invalid.", []);
  const sceneArray = sceneCandidates as unknown[];

  const expected = new Map(batch.scenes.map((scene) => [scene.sceneId, scene]));
  const seen = new Set<string>();
  const scenes = sceneArray.map((item, index): PromptWriterSceneOutput => {
    if (typeof item !== "object" || item === null || Array.isArray(item))
      return fail("PROMPT_OUTPUT_INVALID", "Prompt writer scene must be an object.", [
        "scenes",
        index,
      ]);
    const scene = item as Record<string, unknown>;
    exactKeys(
      scene,
      [
        "scene_id",
        "literal_subject",
        "action",
        "environment",
        "in_image_shot_role",
        "lighting_context",
        "continuity_tags",
        "prompt_core",
      ],
      ["scenes", index],
    );
    const sceneId = readString(scene, "scene_id", 160, ["scenes", index]);
    const expectedScene = expected.get(sceneId);
    if (!expectedScene || seen.has(sceneId))
      return fail("PROMPT_OUTPUT_INVALID", "Scene ID is unknown or duplicated.", [
        "scenes",
        index,
        "scene_id",
      ]);
    seen.add(sceneId);
    if (scene.in_image_shot_role !== expectedScene.inImageShotRole)
      return fail("PROMPT_OUTPUT_INVALID", "Prompt writer changed the code-assigned shot role.", [
        "scenes",
        index,
        "in_image_shot_role",
      ]);
    if (!Array.isArray(scene.continuity_tags) || scene.continuity_tags.length > 12)
      return fail("PROMPT_OUTPUT_INVALID", "Continuity tags are invalid.", [
        "scenes",
        index,
        "continuity_tags",
      ]);
    const continuityTags = scene.continuity_tags.map((tag, tagIndex) => {
      if (typeof tag !== "string")
        return fail("PROMPT_OUTPUT_INVALID", "Continuity tag must be a string.", [
          "scenes",
          index,
          "continuity_tags",
          tagIndex,
        ]);
      return normalizedOutput(tag, 80, "Continuity tag", [
        "scenes",
        index,
        "continuity_tags",
        tagIndex,
      ]);
    });
    if (new Set(continuityTags).size !== continuityTags.length)
      return fail("PROMPT_OUTPUT_INVALID", "Continuity tags must be unique.", [
        "scenes",
        index,
        "continuity_tags",
      ]);
    return Object.freeze({
      scene_id: sceneId,
      literal_subject: readString(scene, "literal_subject", 240, ["scenes", index]),
      action: readString(scene, "action", 240, ["scenes", index]),
      environment: readString(scene, "environment", 240, ["scenes", index]),
      in_image_shot_role: expectedScene.inImageShotRole,
      lighting_context: readString(scene, "lighting_context", 120, ["scenes", index]),
      continuity_tags: Object.freeze(continuityTags),
      prompt_core: readString(scene, "prompt_core", 600, ["scenes", index]),
    });
  });
  if (scenes.length !== expected.size || seen.size !== expected.size)
    fail("PROMPT_OUTPUT_INVALID", "Prompt writer must return every scene exactly once.", [
      "scenes",
    ]);
  return Object.freeze({ batch_id: batch.batchId, scenes: Object.freeze(scenes) });
}

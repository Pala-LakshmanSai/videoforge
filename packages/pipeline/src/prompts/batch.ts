import { canonicalizeJson } from "@videoforge/contracts";

import { PipelineDomainError } from "../errors.js";
import {
  IN_IMAGE_SHOT_ROLES,
  SCENE_PROMPT_WRITER_VERSION,
  containsReferenceSpecificStyleContent,
  type PromptBatch,
  type PromptBatchInput,
  type PromptSceneInput,
  type PromptStyleTreatment,
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

const STYLE_TREATMENT_KEYS = [
  "camera_language",
  "contrast_and_exposure",
  "depth_of_field",
  "environment_and_material_detail",
  "human_rendering",
  "image_framing",
  "imperfection_profile",
  "lighting",
  "medium_family",
  "mood",
  "palette",
  "realism",
  "schema_version",
  "shot_scale_preferences",
  "subject_treatment",
  "style_profile_hash",
  "texture_and_grain",
] as const;
const STYLE_PALETTE_KEYS = ["approximate_hex", "descriptors"] as const;
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/u;

const objectRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const hasExactKeys = (value: Record<string, unknown>, expected: readonly string[]): boolean => {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
};

const styleText = (
  value: unknown,
  maximum: number,
  label: string,
  path: readonly (string | number)[],
): string => {
  if (typeof value !== "string")
    return fail("PROMPT_INPUT_INVALID", `${label} must be a string.`, path);
  const result = normalized(value, maximum, label, path);
  if (containsReferenceSpecificStyleContent(result))
    return fail("PROMPT_INPUT_INVALID", `${label} contains reference-specific content.`, path);
  return result;
};

const styleList = (
  value: unknown,
  maximumItems: number,
  maximumLength: number,
  label: string,
  path: readonly (string | number)[],
  options: { readonly allowEmpty?: boolean } = {},
): readonly string[] => {
  if (!Array.isArray(value) || value.length > maximumItems)
    return fail(
      "PROMPT_INPUT_INVALID",
      `${label} must contain at most ${maximumItems} strings.`,
      path,
    );
  const values = value as unknown[];
  if (!options.allowEmpty && values.length === 0)
    return fail("PROMPT_INPUT_INVALID", `${label} must contain at least one string.`, path);
  return Object.freeze(
    values.map((item, index) => styleText(item, maximumLength, label, [...path, index])),
  );
};

/**
 * Validate and clone the semantic style projection at the prompt boundary.
 * The exact-key check is the field-selection guard: reference/content-bearing
 * profile fields cannot silently ride along in the provider input.
 */
const normalizedStyleTreatment = (
  value: PromptStyleTreatment | null | undefined,
  styleProfileHash: string,
): PromptStyleTreatment | null => {
  if (value === undefined || value === null) return null;
  const candidate = objectRecord(value);
  if (candidate === null)
    return fail("PROMPT_INPUT_INVALID", "Style treatment must be an object.", ["styleTreatment"]);
  if (!hasExactKeys(candidate, STYLE_TREATMENT_KEYS))
    return fail(
      "PROMPT_INPUT_INVALID",
      "Style treatment contains unknown or missing semantic fields.",
      ["styleTreatment"],
    );
  if (candidate.schema_version !== "image-style-treatment/v1")
    return fail("PROMPT_INPUT_INVALID", "Style treatment version is invalid.", ["styleTreatment"]);
  if (candidate.style_profile_hash !== styleProfileHash)
    return fail("PROMPT_INPUT_INVALID", "Style treatment is not bound to the pinned style hash.", [
      "styleTreatment",
      "style_profile_hash",
    ]);
  const palette = objectRecord(candidate.palette);
  if (palette === null)
    return fail("PROMPT_INPUT_INVALID", "Style treatment palette must be an object.", [
      "styleTreatment",
      "palette",
    ]);
  if (!hasExactKeys(palette, STYLE_PALETTE_KEYS))
    return fail("PROMPT_INPUT_INVALID", "Style treatment palette shape is invalid.", [
      "styleTreatment",
      "palette",
    ]);
  const approximateHex = palette.approximate_hex;
  if (
    !Array.isArray(approximateHex) ||
    approximateHex.length > 12 ||
    approximateHex.some((color) => typeof color !== "string" || !HEX_COLOR.test(color))
  )
    return fail("PROMPT_INPUT_INVALID", "Style treatment palette colors are invalid.", [
      "styleTreatment",
      "palette",
      "approximate_hex",
    ]);
  return Object.freeze({
    schema_version: "image-style-treatment/v1",
    style_profile_hash: styleProfileHash as PromptStyleTreatment["style_profile_hash"],
    medium_family: styleText(candidate.medium_family, 100, "Style medium", [
      "styleTreatment",
      "medium_family",
    ]),
    realism: styleText(candidate.realism, 600, "Style realism", ["styleTreatment", "realism"]),
    subject_treatment: styleText(candidate.subject_treatment, 600, "Style subject treatment", [
      "styleTreatment",
      "subject_treatment",
    ]),
    camera_language: styleText(candidate.camera_language, 600, "Style camera language", [
      "styleTreatment",
      "camera_language",
    ]),
    image_framing: styleText(candidate.image_framing, 600, "Style image framing", [
      "styleTreatment",
      "image_framing",
    ]),
    shot_scale_preferences: styleList(
      candidate.shot_scale_preferences,
      20,
      160,
      "Style shot-scale preferences",
      ["styleTreatment", "shot_scale_preferences"],
    ),
    lighting: styleText(candidate.lighting, 600, "Style lighting", ["styleTreatment", "lighting"]),
    palette: Object.freeze({
      descriptors: styleList(palette.descriptors, 20, 120, "Style palette descriptors", [
        "styleTreatment",
        "palette",
        "descriptors",
      ]),
      approximate_hex: Object.freeze([...approximateHex]),
    }),
    contrast_and_exposure: styleText(
      candidate.contrast_and_exposure,
      600,
      "Style contrast and exposure",
      ["styleTreatment", "contrast_and_exposure"],
    ),
    depth_of_field: styleText(candidate.depth_of_field, 600, "Style depth of field", [
      "styleTreatment",
      "depth_of_field",
    ]),
    texture_and_grain: styleText(candidate.texture_and_grain, 600, "Style texture and grain", [
      "styleTreatment",
      "texture_and_grain",
    ]),
    human_rendering: styleText(candidate.human_rendering, 600, "Style human rendering", [
      "styleTreatment",
      "human_rendering",
    ]),
    environment_and_material_detail: styleText(
      candidate.environment_and_material_detail,
      600,
      "Style environment and material detail",
      ["styleTreatment", "environment_and_material_detail"],
    ),
    imperfection_profile: styleList(
      candidate.imperfection_profile,
      20,
      160,
      "Style imperfection profile",
      ["styleTreatment", "imperfection_profile"],
    ),
    mood: styleList(candidate.mood, 20, 120, "Style mood", ["styleTreatment", "mood"]),
  });
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
  const styleTreatment = normalizedStyleTreatment(input.styleTreatment, input.styleProfileHash);
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
    scenePromptWriterVersion: SCENE_PROMPT_WRITER_VERSION,
    batchId: input.batchId,
    sanitizedProjectTitle: normalized(input.projectTitle, 240, "Project title", ["projectTitle"]),
    imageStyleVersionId: input.imageStyleVersionId,
    styleProfileHash: input.styleProfileHash,
    styleTreatment,
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

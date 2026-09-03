import type { ImageStyleProfileDocument, Sha256Digest } from "@videoforge/contracts";

/** Version of the scene-content contract used by the v10 Runware request. */
export const SCENE_PROMPT_WRITER_VERSION = "scene-prompt-writer-v2" as const;

/** Version of the provider-facing, style-only treatment projection. */
export const PROMPT_STYLE_TREATMENT_VERSION = "image-style-treatment/v1" as const;

export const IN_IMAGE_SHOT_ROLES = [
  "ENVIRONMENTAL_WIDE",
  "HUMAN_MEDIUM",
  "HANDS_ACTION",
  "OBJECT_EVIDENCE",
  "MACRO_DETAIL",
  "REACTION_RESULT",
] as const;

export type InImageShotRole = (typeof IN_IMAGE_SHOT_ROLES)[number];
export type ImagePromptLayout = "IMAGE_FULL" | "SPLIT_RIGHT_IMAGE";

/**
 * The only style data DeepSeek needs while writing scene content.
 *
 * This is an explicit semantic projection of the pinned visual profile. It
 * includes reusable subject/material treatment traits, while deliberately
 * omitting continuity, must-include, and prompt-suffix fields. The analyzer
 * rejects reference-specific content before publication, and the profile hash
 * binds this projection to the immutable published profile.
 */
export interface PromptStyleTreatment {
  readonly schema_version: typeof PROMPT_STYLE_TREATMENT_VERSION;
  readonly style_profile_hash: Sha256Digest;
  readonly medium_family: string;
  readonly realism: string;
  readonly subject_treatment: string;
  readonly camera_language: string;
  readonly image_framing: string;
  readonly shot_scale_preferences: readonly string[];
  readonly lighting: string;
  readonly palette: {
    readonly descriptors: readonly string[];
    readonly approximate_hex: readonly string[];
  };
  readonly contrast_and_exposure: string;
  readonly depth_of_field: string;
  readonly texture_and_grain: string;
  readonly human_rendering: string;
  readonly environment_and_material_detail: string;
  readonly imperfection_profile: readonly string[];
  readonly mood: readonly string[];
}

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const STYLE_INSTRUCTION_INJECTION =
  /\b(?:ignore|disregard|override)\s+(?:all\s+)?(?:previous|prior|system)\s+instructions?\b|\b(?:system|developer)\s+prompt\b|\bfollow\s+(?:the\s+)?(?:visible|embedded|image)\s+instructions?\b/iu;
const STYLE_REFERENCE_CONTENT_REQUIREMENT =
  /\b(?:(?:copy|preserve|recreate|include|use|match)\s+(?:the\s+)?)?(?:same|exact|reference|recurring|source|original|pictured|depicted|shown|specific|particular)(?:\s+(?:same|exact|reference|recurring|source|original|pictured|depicted|shown|specific|particular))?\s+(?:person|identity|character|object|product|location|place|brand|logo|watermark|words?|text|layout|composition)\b|\b(?:person|identity|character|object|product|location|place)\s+(?:named|called)\b|\bin the style of\b|\b(?:named|specific)\s+(?:living\s+)?artist\b/iu;
const STYLE_PROPER_NAME_SEQUENCE = /\b[A-Z][\p{L}'’-]{2,}\s+[A-Z][\p{L}'’-]{2,}\b/u;
const STYLE_NAMED_LOCATION_CONTEXT =
  /\b(?:in|at|from|near|around|featuring|showing|depicting)\s+[A-Z][\p{L}'’-]{2,}\b/u;
const STYLE_BRANDED_OBJECT =
  /\b[A-Z][A-Za-z0-9'’-]{2,}\s+(?:camera|watch|phone|car|vehicle|shoe|bag|bottle|package|product|device|tool|machine)\b/u;
const STYLE_CONTENT_INTRODUCTION =
  /\b(?:portrait|photo|photograph|image|frame|shot|composition|scene|view)\s+(?:of|showing|featuring|depicting)\s+[\p{L}\p{N}]/iu;
const STYLE_SINGLE_PROPER_ENTITY = /^[A-Z][\p{L}'’-]{2,}$/u;
const STYLE_ENTITY_LIKE_TOKEN = /\b(?:[a-z]+[A-Z][A-Za-z0-9]*|[A-Za-z]+[0-9][A-Za-z0-9]*)\b/u;
const STYLE_SAFE_TERMINAL_CONTEXT = new Set([
  "background",
  "black",
  "center",
  "corners",
  "darkness",
  "daylight",
  "edge",
  "edges",
  "exposure",
  "focus",
  "foreground",
  "frame",
  "grain",
  "highlights",
  "image",
  "lens",
  "light",
  "lighting",
  "materials",
  "night",
  "scene",
  "shadows",
  "skin",
  "subjects",
  "surfaces",
  "texture",
  "view",
  "white",
]);

export function containsReferenceSpecificStyleContent(value: string): boolean {
  const normalized = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (
    STYLE_INSTRUCTION_INJECTION.test(normalized) ||
    STYLE_REFERENCE_CONTENT_REQUIREMENT.test(normalized) ||
    STYLE_PROPER_NAME_SEQUENCE.test(normalized) ||
    STYLE_NAMED_LOCATION_CONTEXT.test(normalized) ||
    STYLE_BRANDED_OBJECT.test(normalized) ||
    STYLE_CONTENT_INTRODUCTION.test(normalized) ||
    STYLE_SINGLE_PROPER_ENTITY.test(normalized) ||
    STYLE_ENTITY_LIKE_TOKEN.test(normalized)
  )
    return true;
  const terminalContext = /\b(?:in|at|from|near|around)\s+([\p{L}'’-]{3,})\s*$/iu.exec(normalized);
  return (
    terminalContext !== null && !STYLE_SAFE_TERMINAL_CONTEXT.has(terminalContext[1]!.toLowerCase())
  );
}

const frozenStrings = (values: readonly string[]): readonly string[] => Object.freeze([...values]);

/**
 * Deterministically select style-treatment semantics from a pinned immutable
 * visual profile. Reference content is excluded by field semantics, not by a
 * brittle list of words. The source profile is expected to have already
 * passed the canonical image-style-profile validator.
 */
export function derivePromptStyleTreatment(
  visualProfile: ImageStyleProfileDocument["visual_profile"],
  styleProfileHash: Sha256Digest,
): PromptStyleTreatment {
  if (!SHA256.test(styleProfileHash))
    throw new TypeError("styleProfileHash must be a SHA-256 digest");
  const creativeStyleValues = [
    visualProfile.medium_family,
    visualProfile.realism,
    visualProfile.subject_treatment,
    visualProfile.camera_language,
    visualProfile.image_framing,
    ...visualProfile.shot_scale_preferences,
    visualProfile.lighting,
    ...visualProfile.color.descriptors,
    visualProfile.contrast_and_exposure,
    visualProfile.depth_of_field,
    visualProfile.texture_and_grain,
    visualProfile.human_rendering,
    visualProfile.environment_and_material_detail,
    ...visualProfile.imperfection_profile,
    ...visualProfile.mood,
  ];
  if (creativeStyleValues.some(containsReferenceSpecificStyleContent))
    throw new TypeError("Pinned style contains reference-specific content");
  return Object.freeze({
    schema_version: PROMPT_STYLE_TREATMENT_VERSION,
    style_profile_hash: styleProfileHash,
    medium_family: visualProfile.medium_family,
    realism: visualProfile.realism,
    subject_treatment: visualProfile.subject_treatment,
    camera_language: visualProfile.camera_language,
    image_framing: visualProfile.image_framing,
    shot_scale_preferences: frozenStrings(visualProfile.shot_scale_preferences),
    lighting: visualProfile.lighting,
    palette: Object.freeze({
      descriptors: frozenStrings(visualProfile.color.descriptors),
      approximate_hex: frozenStrings(visualProfile.color.approximate_hex),
    }),
    contrast_and_exposure: visualProfile.contrast_and_exposure,
    depth_of_field: visualProfile.depth_of_field,
    texture_and_grain: visualProfile.texture_and_grain,
    human_rendering: visualProfile.human_rendering,
    environment_and_material_detail: visualProfile.environment_and_material_detail,
    imperfection_profile: frozenStrings(visualProfile.imperfection_profile),
    mood: frozenStrings(visualProfile.mood),
  });
}

/**
 * Build the positive image-model style suffix from the same whitelisted
 * treatment projection used by DeepSeek. This excludes reference/content
 * fields and keeps compiler style text deterministic across call sites.
 */
export function promptStyleTreatmentPositiveSuffix(treatment: PromptStyleTreatment): string {
  const compact = (value: string, maximum = 112): string => {
    const normalized = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
    if (normalized.length <= maximum) return normalized;
    const candidate = normalized.slice(0, maximum);
    const boundary = candidate.lastIndexOf(" ");
    return (boundary > 0 ? candidate.slice(0, boundary) : candidate).trim();
  };
  const segment = (label: string, values: readonly string[]): string | null =>
    values.length === 0 ? null : `${label}: ${compact(values.join(", "))}`;
  // Give every pinned visual trait a deterministic segment. Per-field
  // compaction prevents a long early trait from deleting later style data.
  return [
    segment("medium", [treatment.medium_family]),
    segment("realism", [treatment.realism]),
    segment("subjects", [treatment.subject_treatment]),
    segment("camera", [treatment.camera_language]),
    segment("framing", [treatment.image_framing]),
    segment("shot scales", treatment.shot_scale_preferences),
    segment("lighting", [treatment.lighting]),
    segment("palette", treatment.palette.descriptors),
    segment("palette colors", treatment.palette.approximate_hex),
    segment("contrast", [treatment.contrast_and_exposure]),
    segment("depth", [treatment.depth_of_field]),
    segment("texture", [treatment.texture_and_grain]),
    segment("people", [treatment.human_rendering]),
    segment("materials", [treatment.environment_and_material_detail]),
    segment("imperfection", treatment.imperfection_profile),
    segment("mood", treatment.mood),
  ]
    .filter((value): value is string => value !== null)
    .join("; ");
}

export interface PromptSceneInput {
  readonly sceneId: string;
  readonly phrase: string;
  readonly sentenceContext: string;
  readonly priorContext: string | null;
  readonly nextContext: string | null;
  readonly inImageShotRole: InImageShotRole;
  readonly layout: ImagePromptLayout;
}

export interface PromptBatchInput {
  readonly batchId: string;
  readonly projectTitle: string;
  readonly imageStyleVersionId: string;
  readonly styleProfileHash: Sha256Digest;
  /**
   * Immutable style projection derived with derivePromptStyleTreatment.
   * Optional only for legacy fixture/database rows; Runware dispatch rejects a
   * batch without it so an old lossy planner string cannot reach the provider.
   */
  readonly styleTreatment?: PromptStyleTreatment | null;
  /** @deprecated Kept in the durable shape for pre-v10 rows; never sent to Runware. */
  readonly plannerGuidance: string;
  readonly storyContext: string;
  readonly continuityTags: readonly string[];
  readonly scenes: readonly PromptSceneInput[];
}

export interface PromptWriterSceneOutput {
  readonly scene_id: string;
  readonly literal_subject: string;
  readonly action: string;
  readonly environment: string;
  readonly in_image_shot_role: InImageShotRole;
  readonly lighting_context: string;
  readonly continuity_tags: readonly string[];
  readonly prompt_core: string;
}

export interface PromptWriterBatchOutput {
  readonly batch_id: string;
  readonly scenes: readonly PromptWriterSceneOutput[];
}

export interface PromptWriterPort {
  write(batch: PromptBatch): Promise<unknown>;
}

export interface PromptBatch {
  readonly scenePromptWriterVersion: typeof SCENE_PROMPT_WRITER_VERSION;
  readonly batchId: string;
  readonly sanitizedProjectTitle: string;
  readonly imageStyleVersionId: string;
  readonly styleProfileHash: Sha256Digest;
  readonly styleTreatment: PromptStyleTreatment | null;
  /** @deprecated Kept for old durable rows; provider input uses styleTreatment. */
  readonly plannerGuidance: string;
  readonly storyContext: string;
  readonly continuityTags: readonly string[];
  readonly scenes: readonly PromptSceneInput[];
}

export interface PromptStyleComponents {
  readonly positiveSuffix: string;
  readonly negativeSuffix: string;
  readonly fullImageGuidance: string;
  readonly splitImageGuidance: string;
}

export interface CompilePromptRequest {
  readonly writerOutput: PromptWriterSceneOutput;
  readonly expectedScene: PromptSceneInput;
  readonly style: PromptStyleComponents;
  readonly extraPromptKeywords: string | null;
  readonly applyExtraPromptKeywords: boolean;
}

export interface CompiledImagePrompt {
  readonly promptCompilerVersion: "prompt-compiler-v1";
  readonly scenePromptWriterVersion: typeof SCENE_PROMPT_WRITER_VERSION;
  readonly sceneId: string;
  readonly components: {
    readonly literalContent: string;
    readonly continuityAndShotRole: string;
    readonly cropGuidance: string;
    readonly stylePositiveSuffix: string;
    readonly extraPromptKeywords: string | null;
    readonly permanentPositiveGuardrail: string;
    readonly styleNegativeSuffix: string;
    readonly permanentNegativeGuardrail: string;
  };
  readonly positivePrompt: string;
  readonly negativePrompt: string;
  readonly positivePromptUtf8Bytes: number;
  readonly negativePromptUtf8Bytes: number;
  readonly positivePromptSha256: Sha256Digest;
  readonly negativePromptSha256: Sha256Digest;
}

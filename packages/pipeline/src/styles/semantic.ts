import {
  canonicalizeJson,
  type ImageStyleAnalyzerOutputDocument,
  type ImageStyleProfileDocument,
  validateAndHashContractDocument,
  validateContract,
} from "@videoforge/contracts";

import { PipelineDomainError } from "../errors.js";
import { assertNoHardPromptConflict, validatePromptStyleComponents } from "../prompts/compiler.js";
import { buildStyleAnalyzerRequest } from "./request.js";
import { STYLE_TRAITS, type StyleAnalyzerRequest, type TrustedStyleProfile } from "./types.js";

const INSTRUCTION_INJECTION =
  /\b(?:ignore|disregard|override)\s+(?:all\s+)?(?:previous|prior|system)\s+instructions?\b|\b(?:system|developer)\s+prompt\b|\bfollow\s+(?:the\s+)?(?:visible|embedded|image)\s+instructions?\b/iu;
const REFERENCE_CONTENT_REQUIREMENT =
  /\b(?:(?:copy|preserve|recreate|include|use|match)\s+(?:the\s+)?)?(?:same|exact|reference|recurring)(?:\s+(?:same|exact|reference|recurring))?\s+(?:person|identity|character|object|product|location|place|brand|logo|watermark|words?|text|layout|composition)\b|\bin the style of\b|\b(?:named|specific)\s+(?:living\s+)?artist\b/iu;
const containsControl = (value: string): boolean =>
  Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0)!;
    return codePoint <= 31 || (codePoint >= 127 && codePoint <= 159);
  });

type Path = readonly (string | number)[];

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Array.isArray(value) ? value : Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

const fail = (
  code: "STYLE_OUTPUT_INVALID" | "STYLE_SEMANTIC_INVALID" | "STYLE_CONTENT_LEAKAGE",
  message: string,
  path: Path,
): never => {
  throw new PipelineDomainError({ code, message, path });
};

function snapshot(value: unknown): unknown {
  try {
    return JSON.parse(canonicalizeJson(value));
  } catch {
    return fail("STYLE_OUTPUT_INVALID", "Analyzer output must be plain canonical JSON.", []);
  }
}

function text(
  value: string,
  maximum: number,
  path: Path,
  options: { readonly optional?: boolean; readonly creative?: boolean } = {},
): string {
  if (containsControl(value))
    fail("STYLE_SEMANTIC_INVALID", "Style text contains control characters.", path);
  const result = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if ((!options.optional && result.length === 0) || result.length > maximum)
    fail("STYLE_SEMANTIC_INVALID", "Style text is blank or oversized.", path);
  if (
    options.creative &&
    (INSTRUCTION_INJECTION.test(result) || REFERENCE_CONTENT_REQUIREMENT.test(result))
  )
    fail(
      "STYLE_CONTENT_LEAKAGE",
      "Style text contains instructions or reference content that cannot become a reusable trait.",
      path,
    );
  return result;
}

function list(
  values: readonly string[],
  maximumItems: number,
  maximumText: number,
  path: Path,
  options: { readonly optional?: boolean; readonly creative?: boolean } = {},
): readonly string[] {
  if ((!options.optional && values.length === 0) || values.length > maximumItems)
    fail("STYLE_SEMANTIC_INVALID", "Style list is empty or oversized.", path);
  const normalized = values.map((value, index) =>
    text(value, maximumText, [...path, index], {
      optional: false,
      creative: options.creative,
    }),
  );
  if (new Set(normalized).size !== normalized.length)
    fail("STYLE_SEMANTIC_INVALID", "Style list contains duplicate values.", path);
  return Object.freeze(normalized);
}

function creativeText(value: string, maximum: number, path: Path): string {
  const result = text(value, maximum, path, { creative: true });
  assertNoHardPromptConflict(result, path.map(String));
  return result;
}

function creativeList(
  values: readonly string[],
  maximumItems: number,
  maximumText: number,
  path: Path,
): readonly string[] {
  const result = list(values, maximumItems, maximumText, path, { creative: true });
  result.forEach((value, index) => assertNoHardPromptConflict(value, [...path, index].map(String)));
  return result;
}

function validateAnalyzerSemantics(
  output: ImageStyleAnalyzerOutputDocument,
  request: StyleAnalyzerRequest,
): ImageStyleProfileDocument {
  const visual = output.visual_profile;
  const prompt = output.prompt_profile;
  const allowedAliases = new Set(request.references.map((reference) => reference.alias));
  const traits = new Set<string>();

  const traitEvidence = output.analysis.trait_evidence.map((entry, index) => {
    if (!STYLE_TRAITS.includes(entry.trait) || traits.has(entry.trait))
      fail("STYLE_SEMANTIC_INVALID", "Trait evidence is unknown or duplicated.", [
        "analysis",
        "trait_evidence",
        index,
        "trait",
      ]);
    traits.add(entry.trait);
    const aliases = list(
      entry.supporting_reference_aliases,
      8,
      6,
      ["analysis", "trait_evidence", index, "supporting_reference_aliases"],
      { optional: true },
    );
    if (aliases.some((alias) => !allowedAliases.has(alias)))
      fail("STYLE_SEMANTIC_INVALID", "Trait evidence references an unbound alias.", [
        "analysis",
        "trait_evidence",
        index,
        "supporting_reference_aliases",
      ]);
    if (
      (entry.support_status === "SUPPORTED" && (aliases.length === 0 || entry.confidence === 0)) ||
      (entry.support_status === "UNSUPPORTED" && aliases.length !== 0)
    )
      fail("STYLE_SEMANTIC_INVALID", "Trait support state contradicts its evidence.", [
        "analysis",
        "trait_evidence",
        index,
      ]);
    return Object.freeze({ ...entry, supporting_reference_aliases: aliases });
  });
  if (traits.size !== STYLE_TRAITS.length)
    fail("STYLE_SEMANTIC_INVALID", "Every required trait must appear exactly once.", [
      "analysis",
      "trait_evidence",
    ]);

  const outliers = list(
    output.analysis.outlier_reference_aliases,
    8,
    6,
    ["analysis", "outlier_reference_aliases"],
    { optional: true },
  );
  if (
    outliers.some((alias) => !allowedAliases.has(alias)) ||
    outliers.length === allowedAliases.size
  )
    fail("STYLE_SEMANTIC_INVALID", "Outlier aliases are unbound or leave no consensus set.", [
      "analysis",
      "outlier_reference_aliases",
    ]);

  const promptStyle = validatePromptStyleComponents({
    positiveSuffix: creativeText(prompt.positive_suffix, 2_400, [
      "prompt_profile",
      "positive_suffix",
    ]),
    negativeSuffix: text(prompt.negative_suffix, 2_400, ["prompt_profile", "negative_suffix"], {
      optional: true,
    }),
    fullImageGuidance: creativeText(prompt.full_image_guidance, 800, [
      "prompt_profile",
      "full_image_guidance",
    ]),
    splitImageGuidance: creativeText(prompt.split_image_guidance, 800, [
      "prompt_profile",
      "split_image_guidance",
    ]),
  });

  return Object.freeze({
    schema_version: "image-style-profile/v1",
    summary: text(output.summary, 600, ["summary"]),
    visual_profile: Object.freeze({
      medium_family: creativeText(visual.medium_family, 100, ["visual_profile", "medium_family"]),
      realism: creativeText(visual.realism, 600, ["visual_profile", "realism"]),
      subject_treatment: creativeText(visual.subject_treatment, 600, [
        "visual_profile",
        "subject_treatment",
      ]),
      camera_language: creativeText(visual.camera_language, 600, [
        "visual_profile",
        "camera_language",
      ]),
      image_framing: creativeText(visual.image_framing, 600, ["visual_profile", "image_framing"]),
      shot_scale_preferences: creativeList(visual.shot_scale_preferences, 20, 160, [
        "visual_profile",
        "shot_scale_preferences",
      ]),
      lighting: creativeText(visual.lighting, 600, ["visual_profile", "lighting"]),
      color: Object.freeze({
        descriptors: creativeList(visual.color.descriptors, 20, 120, [
          "visual_profile",
          "color",
          "descriptors",
        ]),
        approximate_hex: list(
          visual.color.approximate_hex,
          12,
          7,
          ["visual_profile", "color", "approximate_hex"],
          { optional: true },
        ),
      }),
      contrast_and_exposure: creativeText(visual.contrast_and_exposure, 600, [
        "visual_profile",
        "contrast_and_exposure",
      ]),
      depth_of_field: creativeText(visual.depth_of_field, 600, [
        "visual_profile",
        "depth_of_field",
      ]),
      texture_and_grain: creativeText(visual.texture_and_grain, 600, [
        "visual_profile",
        "texture_and_grain",
      ]),
      human_rendering: creativeText(visual.human_rendering, 600, [
        "visual_profile",
        "human_rendering",
      ]),
      environment_and_material_detail: creativeText(visual.environment_and_material_detail, 600, [
        "visual_profile",
        "environment_and_material_detail",
      ]),
      imperfection_profile: creativeList(visual.imperfection_profile, 20, 160, [
        "visual_profile",
        "imperfection_profile",
      ]),
      mood: creativeList(visual.mood, 20, 120, ["visual_profile", "mood"]),
      continuity_rules: creativeList(visual.continuity_rules, 30, 240, [
        "visual_profile",
        "continuity_rules",
      ]),
      must_include: creativeList(visual.must_include, 30, 200, ["visual_profile", "must_include"]),
      must_avoid: list(visual.must_avoid, 40, 200, ["visual_profile", "must_avoid"]),
      flexible_properties: creativeList(visual.flexible_properties, 30, 200, [
        "visual_profile",
        "flexible_properties",
      ]),
    }),
    prompt_profile: Object.freeze({
      planner_guidance: creativeText(prompt.planner_guidance, 1_800, [
        "prompt_profile",
        "planner_guidance",
      ]),
      positive_suffix: promptStyle.positiveSuffix,
      negative_suffix: promptStyle.negativeSuffix,
      full_image_guidance: promptStyle.fullImageGuidance,
      split_image_guidance: promptStyle.splitImageGuidance,
    }),
    analysis: Object.freeze({
      analysis_kind: "VISION_ANALYSIS",
      overall_confidence: output.analysis.overall_confidence,
      trait_evidence: Object.freeze(traitEvidence),
      uncertain_fields: list(
        output.analysis.uncertain_fields,
        30,
        200,
        ["analysis", "uncertain_fields"],
        { optional: true },
      ),
      outlier_reference_aliases: outliers,
      content_leakage_warnings: list(
        output.analysis.content_leakage_warnings,
        30,
        240,
        ["analysis", "content_leakage_warnings"],
        { optional: true },
      ),
    }),
  });
}

export async function validateAndAssembleStyleProfile(
  request: StyleAnalyzerRequest,
  candidate: unknown,
): Promise<TrustedStyleProfile> {
  if (request.analyzerVersion !== "style-analyzer-v1")
    fail("STYLE_SEMANTIC_INVALID", "Analyzer version is invalid.", ["analyzerVersion"]);
  const normalizedRequest = buildStyleAnalyzerRequest(request.references);
  const candidateSnapshot = snapshot(candidate);
  const schemaResult = validateContract("imageStyleAnalyzerOutput", candidateSnapshot);
  if (!schemaResult.success)
    return fail("STYLE_OUTPUT_INVALID", "Analyzer output does not match the canonical schema.", []);
  const profileCandidate = validateAnalyzerSemantics(schemaResult.data, normalizedRequest);
  const validated = await validateAndHashContractDocument("imageStyleProfile", profileCandidate);
  return Object.freeze({
    profile: validated.value,
    styleProfileHash: validated.sha256,
    analyzerOutput: deepFreeze(schemaResult.data),
    referenceBindings: normalizedRequest.references,
  });
}

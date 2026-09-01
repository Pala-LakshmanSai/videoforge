import { createHash } from "node:crypto";

import type { Sha256Digest } from "@videoforge/contracts";

import { PipelineDomainError } from "../errors.js";
import type { CompilePromptRequest, CompiledImagePrompt, PromptStyleComponents } from "./types.js";

export const PERMANENT_POSITIVE_GUARDRAIL =
  "clean original still image only; no visible text, captions, title, logo, watermark, UI, webpage, chart, diagram, arrow, infographic, border, lower-third, graphic overlay, motion graphics, or decorative transition";
export const PERMANENT_NEGATIVE_GUARDRAIL =
  "visible text, captions, title, logo, watermark, UI, webpage, chart, diagram, arrow, infographic, border, lower-third, graphic overlay, motion graphics, decorative transition, malformed anatomy, duplicate limbs, nonsensical objects, accidental mixed media, unrelated subject";

const stripControls = (value: string): string =>
  Array.from(value, (character) => {
    const codePoint = character.codePointAt(0)!;
    return codePoint <= 31 || (codePoint >= 127 && codePoint <= 159) ? " " : character;
  }).join("");
const FORBIDDEN =
  /\b(?:caption|title|text|logo|watermark|border|lower[- ]third|infographic|diagram|chart|motion graphics?|decorative transitions?|avatar on (?:the )?right|image on (?:the )?left)\b/iu;
const POSITIVE_DIRECTIVE = /\b(?:add|show|include|display|render|create|draw|place|use|with)\b/iu;
const NEGATIVE_CONTEXT =
  /\b(?:no|without|avoid|exclude|remove|never|free of)\b|\b(?:text|logo|watermark)-free\b/iu;
const FULL_GEOMETRY = /\b16\s*:\s*9\b/iu;
const SPLIT_GEOMETRY = /\b8\s*:\s*9\b/iu;
const CENTER_SAFE = /\b(?:cent(?:er|re)(?:ed)?|center-safe)\b/iu;
const RIGHT_PANEL = /\bright(?:-hand)?\s+panel\b/iu;
const REVERSED_GEOMETRY =
  /\b(?:avatar|presenter)\s+(?:on|in)\s+(?:the\s+)?right\b|\bimage\s+(?:on|in)\s+(?:the\s+)?left\b/iu;

const fail = (
  code: "PROMPT_INPUT_INVALID" | "PROMPT_CONFLICT" | "PROMPT_HASH_MISMATCH",
  message: string,
  path: readonly string[],
): never => {
  throw new PipelineDomainError({ code, message, path });
};

const normalize = (
  value: string,
  maximum: number,
  label: string,
  path: readonly string[],
): string => {
  const result = stripControls(value.normalize("NFKC")).replace(/\s+/gu, " ").trim();
  if (!result || result.length > maximum)
    fail("PROMPT_INPUT_INVALID", `${label} must contain 1-${maximum} normalized characters.`, path);
  return result;
};

const normalizeOptional = (
  value: string,
  maximum: number,
  label: string,
  path: readonly string[],
): string => {
  const result = stripControls(value.normalize("NFKC")).replace(/\s+/gu, " ").trim();
  if (result.length > maximum)
    fail("PROMPT_INPUT_INVALID", `${label} must contain at most ${maximum} characters.`, path);
  return result;
};

const hash = (value: string): Sha256Digest =>
  `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;

export function assertNoHardPromptConflict(value: string, path: readonly string[]): void {
  for (const clause of value
    .split(/[;,]/u)
    .map((part) => part.trim())
    .filter(Boolean)) {
    if (
      FORBIDDEN.test(clause) &&
      (POSITIVE_DIRECTIVE.test(clause) || !NEGATIVE_CONTEXT.test(clause))
    )
      fail("PROMPT_CONFLICT", "Prompt clause requests a forbidden output or layout.", path);
  }
}

export function validatePromptStyleComponents(style: PromptStyleComponents): PromptStyleComponents {
  const result = {
    positiveSuffix: normalize(style.positiveSuffix, 2_000, "Style positive suffix", [
      "style",
      "positiveSuffix",
    ]),
    negativeSuffix: normalizeOptional(style.negativeSuffix, 2_000, "Style negative suffix", [
      "style",
      "negativeSuffix",
    ]),
    fullImageGuidance: normalize(style.fullImageGuidance, 600, "Full-image guidance", [
      "style",
      "fullImageGuidance",
    ]),
    splitImageGuidance: normalize(style.splitImageGuidance, 600, "Split-image guidance", [
      "style",
      "splitImageGuidance",
    ]),
  };
  assertNoHardPromptConflict(result.positiveSuffix, ["style", "positiveSuffix"]);
  assertNoHardPromptConflict(result.fullImageGuidance, ["style", "fullImageGuidance"]);
  assertNoHardPromptConflict(result.splitImageGuidance, ["style", "splitImageGuidance"]);
  if (!FULL_GEOMETRY.test(result.fullImageGuidance) || !CENTER_SAFE.test(result.fullImageGuidance))
    fail("PROMPT_CONFLICT", "Full-image guidance must preserve 16:9 center-safe geometry.", [
      "style",
      "fullImageGuidance",
    ]);
  if (
    !SPLIT_GEOMETRY.test(result.splitImageGuidance) ||
    !RIGHT_PANEL.test(result.splitImageGuidance) ||
    !CENTER_SAFE.test(result.splitImageGuidance) ||
    REVERSED_GEOMETRY.test(result.splitImageGuidance)
  )
    fail(
      "PROMPT_CONFLICT",
      "Split-image guidance must preserve centered 8:9 right-panel geometry.",
      ["style", "splitImageGuidance"],
    );
  return Object.freeze(result);
}

function normalizeExtra(raw: string | null, enabled: boolean): string | null {
  if (!enabled) return null;
  if (raw === null)
    return fail("PROMPT_INPUT_INVALID", "Enabled extra keywords cannot be null.", [
      "extraPromptKeywords",
    ]);
  const value = normalize(raw, 500, "Enabled extra keywords", ["extraPromptKeywords"]);
  assertNoHardPromptConflict(value, ["extraPromptKeywords"]);
  return value;
}

const join = (parts: readonly (string | null)[]): string => {
  const seen = new Set<string>();
  return parts
    .filter((part): part is string => part !== null && part.length > 0)
    .filter((part) => {
      const key = part.toLocaleLowerCase("en-US");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(", ");
};

export function compileImagePrompt(request: CompilePromptRequest): CompiledImagePrompt {
  const output = request.writerOutput;
  const expected = request.expectedScene;
  if (
    output.scene_id !== expected.sceneId ||
    output.in_image_shot_role !== expected.inImageShotRole
  )
    fail("PROMPT_INPUT_INVALID", "Writer output identity or shot role does not match the scene.", [
      "writerOutput",
    ]);
  const style = validatePromptStyleComponents(request.style);
  const extra = normalizeExtra(request.extraPromptKeywords, request.applyExtraPromptKeywords);
  const literalContent = join([
    normalize(output.literal_subject, 240, "Literal subject", ["writerOutput", "literal_subject"]),
    normalize(output.action, 240, "Action", ["writerOutput", "action"]),
    normalize(output.environment, 240, "Environment", ["writerOutput", "environment"]),
    normalize(output.lighting_context, 120, "Lighting", ["writerOutput", "lighting_context"]),
    normalize(output.prompt_core, 600, "Prompt core", ["writerOutput", "prompt_core"]),
  ]);
  assertNoHardPromptConflict(literalContent, ["writerOutput"]);
  const continuityAndShotRole = join([
    output.continuity_tags.length === 0
      ? "continuity: none"
      : `continuity: ${output.continuity_tags.map((tag) => normalize(tag, 80, "Continuity tag", ["writerOutput", "continuity_tags"])).join(" | ")}`,
    `required viewpoint: ${expected.inImageShotRole.toLowerCase().replaceAll("_", " ")}`,
  ]);
  const cropGuidance =
    expected.layout === "IMAGE_FULL" ? style.fullImageGuidance : style.splitImageGuidance;
  const components = Object.freeze({
    literalContent,
    continuityAndShotRole,
    cropGuidance,
    stylePositiveSuffix: style.positiveSuffix,
    extraPromptKeywords: extra,
    permanentPositiveGuardrail: PERMANENT_POSITIVE_GUARDRAIL,
    styleNegativeSuffix: style.negativeSuffix,
    permanentNegativeGuardrail: PERMANENT_NEGATIVE_GUARDRAIL,
  });
  const positivePrompt = join([
    components.literalContent,
    components.continuityAndShotRole,
    components.cropGuidance,
    components.stylePositiveSuffix,
    components.extraPromptKeywords,
    components.permanentPositiveGuardrail,
  ]);
  const negativePrompt = join([
    components.styleNegativeSuffix,
    components.permanentNegativeGuardrail,
  ]);
  if (positivePrompt.length > 6_500 || negativePrompt.length > 3_000)
    fail("PROMPT_INPUT_INVALID", "Compiled prompt exceeds the bounded image-model prompt budget.", [
      "writerOutput",
    ]);
  return Object.freeze({
    promptCompilerVersion: "prompt-compiler-v1",
    scenePromptWriterVersion: "scene-prompt-writer-v1",
    sceneId: expected.sceneId,
    components,
    positivePrompt,
    negativePrompt,
    positivePromptUtf8Bytes: Buffer.byteLength(positivePrompt, "utf8"),
    negativePromptUtf8Bytes: Buffer.byteLength(negativePrompt, "utf8"),
    positivePromptSha256: hash(positivePrompt),
    negativePromptSha256: hash(negativePrompt),
  });
}

export function verifyCompiledImagePrompt(prompt: CompiledImagePrompt): void {
  const positive = join([
    prompt.components.literalContent,
    prompt.components.continuityAndShotRole,
    prompt.components.cropGuidance,
    prompt.components.stylePositiveSuffix,
    prompt.components.extraPromptKeywords,
    prompt.components.permanentPositiveGuardrail,
  ]);
  const negative = join([
    prompt.components.styleNegativeSuffix,
    prompt.components.permanentNegativeGuardrail,
  ]);
  if (
    positive !== prompt.positivePrompt ||
    negative !== prompt.negativePrompt ||
    Buffer.byteLength(positive, "utf8") !== prompt.positivePromptUtf8Bytes ||
    Buffer.byteLength(negative, "utf8") !== prompt.negativePromptUtf8Bytes ||
    hash(positive) !== prompt.positivePromptSha256 ||
    hash(negative) !== prompt.negativePromptSha256
  )
    fail("PROMPT_HASH_MISMATCH", "Compiled prompt bytes, components, or hashes do not match.", []);
}

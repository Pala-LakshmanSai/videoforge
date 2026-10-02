import type { PromptSceneInput } from "./types.js";

export function naturalDocumentaryCropGuidance(layout: PromptSceneInput["layout"]): string {
  return layout === "IMAGE_FULL"
    ? "One continuous horizontal photograph; key evidence inside central 80%, with useful surroundings"
    : "One continuous photograph; key evidence in middle half of image width, large and clear of edges";
}

export function naturalDocumentaryShotRoleGuidance(
  role: PromptSceneInput["inImageShotRole"],
): string {
  return role === "HUMAN_MEDIUM"
    ? "same subject/setting/state, viewpoint: complete head and face visible, chest-up working view"
    : `same subject/setting/state, viewpoint: ${role.toLowerCase().replaceAll("_", " ")}`;
}

export const NATURAL_DOCUMENTARY_PERMANENT_EXCLUSIONS =
  "No visible text/pseudo-text, labels, logos, watermarks, captions, overlays, graphics, borders or motion graphics; unmarked surfaces";

/** A new immutable policy only; legacy provider prompts must never pass through it. */
export function naturalDocumentaryRequiredPrompt(parts: {
  readonly literalContent: string;
  readonly cropGuidance: string;
  readonly stylePositiveSuffix: string;
  readonly continuityAndShotRole: string;
  readonly extraPromptKeywords: string | null;
}): string {
  const literal = parts.literalContent.trim();
  if (!literal) throw new RangeError("Natural Documentary needs a literal scene.");
  const humanMedium =
    parts.continuityAndShotRole === naturalDocumentaryShotRoleGuidance("HUMAN_MEDIUM");
  let result = humanMedium
    ? `Complete head and face visible, chest-up working view. ${literal}`
    : literal;
  for (const value of [
    parts.cropGuidance,
    parts.stylePositiveSuffix,
    NATURAL_DOCUMENTARY_PERMANENT_EXCLUSIONS,
    humanMedium ? "same subject/setting/state" : parts.continuityAndShotRole,
    parts.extraPromptKeywords ?? "",
  ]) {
    const part = value.trim();
    if (part) result += `${/[.!?;:]$/u.test(result) ? " " : ". "}${part}`;
  }
  if (result.length > 800)
    throw new RangeError(
      "Natural Documentary scene, framing, role and enabled keywords exceed Kie's 800-character limit.",
    );
  return result;
}

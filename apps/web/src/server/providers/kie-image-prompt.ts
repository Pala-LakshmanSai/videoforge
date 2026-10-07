import { naturalDocumentaryRequiredPrompt } from "@videoforge/pipeline/prompts";
import type { CompiledImagePrompt } from "@videoforge/pipeline";
import { KieZImageError } from "./kie-z-image";

const MAX_KIE_PROMPT_LENGTH = 800;
const KIE_PROMPT_TARGET_LENGTH = 640;
// Fits the canonical 49-character HANDS_ACTION role slot without reducing
// the immutable style/scene/keyword allowance. Required only for new bindings.
export const KIE_HAND_ANATOMY_GUIDANCE = "Per person: two hands max, own wrists; simple grip.";
const KIE_PERMANENT_EXCLUSIONS =
  "No visible text/pseudo-text, labels, logos, watermarks, captions, overlays, graphics, borders or motion graphics; unmarked surfaces";
const DEFAULT_STYLE_POSITIVE =
  "authentic observational documentary photography, candid and unposed, filmed on location, available practical light, true-to-life colors, soft contrast, realistic skin and material textures, naturally imperfect clothing, tools and environment, ordinary consumer-camera framing, photojournalistic, genuine frame from real stock or documentary footage, believable everyday life, no glossy commercial polish, absolutely photorealistic, no AI look";
const DEFAULT_STYLE_NEGATIVE =
  "illustration, cartoon, anime, CGI, 3D render, digital painting, fantasy, surrealism, plastic skin, waxy face, perfect symmetry, excessive HDR, glamour lighting, studio advertising, staged pose, impossible anatomy, duplicate people, duplicate limbs, malformed hands, unrealistic perfection";
const COMPACT_DEFAULT_STYLE_POSITIVE =
  "authentic documentary photo, candid and unposed, on location, practical light, true-to-life color, soft contrast, realistic skin/material textures, natural imperfections, consumer framing, photojournalistic, everyday life, photorealistic, no glossy or AI look";
const COMPACT_DEFAULT_STYLE_NEGATIVE =
  "illustration/CGI, fantasy/surrealism, plastic/waxy skin, HDR, glamour/studio lighting, staged pose, bad anatomy, duplicate subjects, unrealistic perfection";
const KIE_DEFAULT_STYLE_POSITIVE =
  "Authentic candid documentary photo, available light, true-to-life color, realistic textures and natural imperfections, unposed everyday life, photorealistic, no AI look";
const KIE_DEFAULT_STYLE_NEGATIVE =
  "illustration, CGI, fantasy, waxy skin, HDR, glamour or studio lighting, staged poses, impossible anatomy, duplicate subjects or limbs";
const PROVIDER_EXCLUSION_TERM =
  /\b(?:text|pseudo[- ]?text|letters?|numbers?|labels?|signs?|logos?|brands?|branding|watermarks?|captions?|overlays?|ui|charts?|diagrams?|borders?|motion(?:\s+graphics?)?|decorative transitions?)\b/iu;

function compactContinuity(value: string): string {
  return value
    .replace(
      /keep one consistent subject, setting and physical state across the video,?\s*/gi,
      "Same subject, setting, state; ",
    )
    .replace(/required viewpoint:/gi, "viewpoint:")
    .replace(/\s+/g, " ")
    .trim();
}

function distinctStyleNegatives(value: string): string[] {
  const seen = new Set<string>();
  return value
    .split(/[,;]+/u)
    .map((term) => term.trim())
    .filter(Boolean)
    .filter((term) => !PROVIDER_EXCLUSION_TERM.test(term))
    .filter((term) => {
      const key = term.toLocaleLowerCase("en-US");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function clipPromptPart(value: string, limit: number): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (normalized.length <= limit) return normalized;
  const clipped = normalized.slice(0, limit).replace(/[\uD800-\uDBFF]$/u, "");
  const wordEnd = clipped.lastIndexOf(" ");
  return (wordEnd > limit * 0.7 ? clipped.slice(0, wordEnd) : clipped).trim();
}

/** Fresh v7 wire adaptation is bounded formatting, never another content acceptance gate. */
function buildBoundedKieScenePrompt(compiled: CompiledImagePrompt, handAnatomy: boolean): string {
  const c = compiled.components;
  const guidance = [
    "Photorealistic physical scene. No visible text, captions, overlays, graphics, borders or watermarks; blank unlit screens",
    clipPromptPart(c.cropGuidance, 60),
    clipPromptPart(c.stylePositiveSuffix, 120),
    handAnatomy && /\bviewpoint:\s*hands action\b/iu.test(c.continuityAndShotRole)
      ? KIE_HAND_ANATOMY_GUIDANCE
      : clipPromptPart(c.continuityAndShotRole, 60),
    clipPromptPart(c.extraPromptKeywords ?? "", 60),
  ]
    .filter(Boolean)
    .join(". ");
  const fields = /^subject:\s*(.*?), action:\s*(.*?), environment:\s*(.*)$/su.exec(
    c.literalContent,
  );
  const parts = (fields ? fields.slice(1) : [c.literalContent]).map((part) =>
    part
      .replace(/\s+/gu, " ")
      .trim()
      .replace(/[.!?]+$/u, ""),
  );
  const available = MAX_KIE_PROMPT_LENGTH - guidance.length - 2 - (parts.length - 1) * 2;
  const budgets = parts.map((part) => Math.min(part.length, Math.floor(available / parts.length)));
  let remaining = available - budgets.reduce((total, budget) => total + budget, 0);
  for (let index = 0; index < parts.length; index++) {
    const extra = Math.min(remaining, parts[index]!.length - budgets[index]!);
    budgets[index]! += extra;
    remaining -= extra;
  }
  const scene = parts
    .map((part, index) => clipPromptPart(part, budgets[index]!))
    .filter(Boolean)
    .join(", ");
  return scene ? `${scene}. ${guidance}` : guidance;
}

/** Map compiled prompt parts into Kie's medium target without cutting scene or style text. */
export function buildKieScenePrompt(
  compiled: CompiledImagePrompt,
  options: {
    readonly handAnatomy?: boolean;
    readonly requiredOnly?: boolean;
    readonly wirePolicy?: "photographic-v1";
  } = {},
): string {
  if (compiled.promptCompilerVersion === "prompt-compiler-v7")
    return buildBoundedKieScenePrompt(compiled, options.handAnatomy === true);
  // Opt-in only at fresh binding: saved wire prompts and sealed writer/compiler hashes stay exact.
  if (options.wirePolicy === "photographic-v1") {
    const literal = compiled.components.literalContent.trim();
    if (!literal) throw new KieZImageError("INPUT_INVALID");
    const fields = /^subject:\s*(.+?), action:\s*(.+?), environment:\s*(.+)$/su.exec(literal);
    const prose = fields
      ? fields
          .slice(1)
          .map((field) => field.trim().replace(/[.!?]+$/u, ""))
          .join(", ") + "."
      : literal;
    return buildKieScenePrompt(
      {
        ...compiled,
        components: {
          ...compiled.components,
          literalContent: `Physical scene, never words. ${prose}`,
        },
      },
      { handAnatomy: options.handAnatomy, requiredOnly: options.requiredOnly },
    );
  }
  const c = compiled.components;
  const handAnatomy =
    options.handAnatomy === true && /\bviewpoint:\s*hands action\b/iu.test(c.continuityAndShotRole);
  if (
    ["prompt-compiler-v4", "prompt-compiler-v5", "prompt-compiler-v6"].includes(
      compiled.promptCompilerVersion,
    )
  ) {
    try {
      let prompt = naturalDocumentaryRequiredPrompt(
        handAnatomy ? { ...c, continuityAndShotRole: KIE_HAND_ANATOMY_GUIDANCE } : c,
        { compact: compiled.promptCompilerVersion === "prompt-compiler-v6" },
      );
      let addedNegative = false;
      for (const term of options.requiredOnly
        ? []
        : distinctStyleNegatives(c.styleNegativeSuffix)) {
        const next = `${prompt}${addedNegative ? ", " : ". Avoid: "}${term}`;
        if (next.length > KIE_PROMPT_TARGET_LENGTH) break;
        prompt = next;
        addedNegative = true;
      }
      return prompt;
    } catch {
      throw new KieZImageError("INPUT_INVALID");
    }
  }
  const positiveStyle =
    c.stylePositiveSuffix === DEFAULT_STYLE_POSITIVE ||
    c.stylePositiveSuffix === COMPACT_DEFAULT_STYLE_POSITIVE
      ? KIE_DEFAULT_STYLE_POSITIVE
      : c.stylePositiveSuffix;
  const negativeStyle =
    c.styleNegativeSuffix === DEFAULT_STYLE_NEGATIVE ||
    c.styleNegativeSuffix === COMPACT_DEFAULT_STYLE_NEGATIVE
      ? KIE_DEFAULT_STYLE_NEGATIVE
      : c.styleNegativeSuffix;
  const literal = c.literalContent.trim();
  if (!literal) throw new KieZImageError("INPUT_INVALID");
  let result = literal;
  const add = (value: string, maxLength: number): boolean => {
    const part = value.trim();
    if (!part) return true;
    const separator = /[.!?;:]$/u.test(result) ? " " : ". ";
    const next = `${result}${separator}${part}`;
    if (next.length > maxLength) return false;
    result = next;
    return true;
  };
  if (
    (handAnatomy && !add(KIE_HAND_ANATOMY_GUIDANCE, MAX_KIE_PROMPT_LENGTH)) ||
    !add(c.cropGuidance, MAX_KIE_PROMPT_LENGTH) ||
    !add(positiveStyle, MAX_KIE_PROMPT_LENGTH) ||
    !add(KIE_PERMANENT_EXCLUSIONS, MAX_KIE_PROMPT_LENGTH)
  )
    throw new KieZImageError("INPUT_INVALID");

  if (!handAnatomy && !options.requiredOnly)
    add(compactContinuity(c.continuityAndShotRole), KIE_PROMPT_TARGET_LENGTH);
  if (!add(c.extraPromptKeywords ?? "", MAX_KIE_PROMPT_LENGTH) && options.requiredOnly)
    throw new KieZImageError("INPUT_INVALID");
  let addedNegative = false;
  for (const term of options.requiredOnly ? [] : distinctStyleNegatives(negativeStyle)) {
    const next = `${result}${addedNegative ? ", " : ". Avoid: "}${term}`;
    if (next.length > KIE_PROMPT_TARGET_LENGTH) break;
    result = next;
    addedNegative = true;
  }
  if (result.length > MAX_KIE_PROMPT_LENGTH) throw new KieZImageError("INPUT_INVALID");
  return result;
}

/** Literal allowance; requiredOnly excludes optional filler for fresh v39 bindings. */
export function kieScenePromptLiteralCharacterLimit(
  compiled: CompiledImagePrompt,
  options: { readonly requiredOnly?: boolean } = {},
): number {
  const skeleton = "subject: x, action: x, environment: x";
  const baseline = buildKieScenePrompt(
    { ...compiled, components: { ...compiled.components, literalContent: skeleton } },
    { handAnatomy: true, ...options },
  );
  // The baseline contains three literal characters; the labels/separators remain compiler-owned.
  return MAX_KIE_PROMPT_LENGTH - baseline.length + 3;
}

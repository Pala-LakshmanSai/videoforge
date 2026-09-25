import { createHash } from "node:crypto";

import type { Sha256Digest } from "@videoforge/contracts";

import { PipelineDomainError } from "../errors.js";
import { SCENE_PROMPT_WRITER_VERSION } from "./types.js";
import type { CompilePromptRequest, CompiledImagePrompt, PromptStyleComponents } from "./types.js";

export const PERMANENT_POSITIVE_GUARDRAIL =
  "Original scene photo; framing only, no camera gear. Show names, dates, quantities physically. No text or pseudo-text, numbers, labels, signs, branding, logos, watermarks, captions, UI, graphics, borders, overlays, motion graphics or decorative transitions; products unmarked.";
export const PERMANENT_NEGATIVE_GUARDRAIL =
  "text, pseudo-text, motion graphics, malformed anatomy, duplicate limbs, unrelated subjects";

const stripControls = (value: string): string =>
  Array.from(value, (character) => {
    const codePoint = character.codePointAt(0)!;
    return codePoint <= 31 || (codePoint >= 127 && codePoint <= 159) ? " " : character;
  }).join("");
type ForbiddenMentionKind =
  | "always"
  | "writing"
  | "label"
  | "marking"
  | "screen"
  | "brand"
  | "chart";

/**
 * These are output-content terms, not merely words that happen to be present
 * in narration.  The compiler checks the writer-owned content before adding
 * the permanent no-text guardrail, so a positive description cannot rely on a
 * later negative clause to cancel a text-bearing object.
 */
const FORBIDDEN_MENTIONS: readonly {
  readonly kind: ForbiddenMentionKind;
  readonly pattern: RegExp;
}[] = [
  {
    kind: "always",
    pattern:
      /\b(?:caption(?:s)?|subtitle(?:s)?|title(?:s)?|text|price[- ]tags?|receipts?|logo(?:s)?|watermark(?:s)?|border(?:s)?|lower[- ]third(?:s)?|infographic(?:s)?|ui|web ?page|arrow(?:s)?|graphic overlays?|motion graphics?|decorative transitions?|avatar on (?:the )?right|image on (?:the )?left)\b/giu,
  },
  {
    kind: "writing",
    pattern:
      /\b(?:hand[- ]?written|writing|written|scribbl(?:e|ed|ing)|scrawl(?:ed|ing)|lettering|inscription(?:s)?|annotat(?:e|ed|ing|ion|ions)|doodl(?:e|ed|ing))\b/giu,
  },
  {
    kind: "label",
    pattern:
      /\b(?:label(?:s|ed|ing)?|labelled|labelling|signage|signboard(?:s)?|placard(?:s)?|name[- ]?plate(?:s)?)\b/giu,
  },
  {
    // Printed or branded packaging always carries text: a described product name, ingredient list,
    // dosage panel or shelf tag invites lettering onto a bottle, box or container even when the
    // sentence never says "label" (the exact way a medicine bottle reached a prompt's subject).
    kind: "label",
    pattern:
      /\b(?:product name(?:s)?|brand name(?:s)?|ingredient(?:s)? list(?:s)?|nutrition facts|dosage(?: panel| instructions?|s)?|packaging text|printed packaging|price stickers?|shelf tags?|branded)\b/giu,
  },
  {
    kind: "marking",
    pattern:
      /\b(?:mark(?:ing|ings)|marked|measurement(?:s)?|graduat(?:ed|ion|ions)|calibrat(?:ed|ion)|tick[- ]?marks?)\b/giu,
  },
  {
    kind: "always",
    pattern: /\b(?:serial(?:[- ]?number)?s?|barcode(?:s)?|qr[- ]?code(?:s)?)\b/giu,
  },
  {
    kind: "screen",
    pattern: /\b(?:screen(?:s)?)\b/giu,
  },
  {
    kind: "brand",
    pattern: /\b(?:brand(?:s|ed|ing)?|trademark(?:s)?)\b/giu,
  },
  {
    kind: "chart",
    pattern:
      /\b(?:flow[- ]?chart(?:s|ing)?|chart(?:s|ing)?|graph(?:s|ing)?|diagram(?:s|ming)?|schematic(?:s)?|blueprint(?:s)?)\b/giu,
  },
];
const NEGATIVE_CUE =
  /\b(?:no|not|without|avoid(?:ing)?|exclude(?:ing)?|omit(?:ted|ting)?|remove(?:d|s)?|never|free\s+(?:of|from)|(?:do|does|did)\s+not)\b/giu;
const NEGATED_MODIFIER_OR_VERB =
  /^(?:[\s-]+(?:visible|readable|legible|any|the|a|an|all|added|extra|present|detectable|unwanted|decorative|printed|commercial|(?:add|show|include|display|render|create|draw|place|use|request)(?:s|ing)?))*[\s-]*$/iu;
const NEGATION_REVERSAL =
  /\b(?:avoid(?:ing)?|exclude(?:d|s|ing)?|omit(?:ted|s|ting)?|remove(?:d|s|ing)?)\b/iu;
const NEGATIVE_LIST_TERM =
  "(?:caption(?:s)?|subtitle(?:s)?|title(?:s)?|text|price[- ]tags?|receipts?|logo(?:s)?|watermark(?:s)?|border(?:s)?|lower[- ]third(?:s)?|infographic(?:s)?|ui|web ?page|arrow(?:s)?|hand[- ]?written|writing|written|labels?|signage|markings?|branding|screens?|charts?|graphs?|diagrams?|schematics?|blueprints?|bottles?|jars?|canisters?|jugs?|cartons?|wrappers?|pouches?|sachets?|packets?|sprayers?|spray bottles?|squeeze tubes?|vials?|phials?|ampoules?|packaged|packaging|tins? of|tin cans?|containers?)";
const NEGATIVE_LIST_BRIDGE = new RegExp(
  `^(?:[\\s-]+(?:visible|readable|legible|any|the|a|an|all|added|extra|present|detectable|unwanted|decorative|printed))*[\\s-]*${NEGATIVE_LIST_TERM}[\\s]*(?:(?:,|and|or)[\\s]*${NEGATIVE_LIST_TERM}[\\s]*)*(?:,|and|or)?[\\s]*$`,
  "iu",
);
const TEXTUAL_MARKING_CONTEXT =
  /\b(?:measurement|measuring|graduat(?:ed|ion)|calibrat(?:ed|ion)|tick[- ]?marks?|serial|barcode|qr[- ]?code|printed|product|package|packaging|bottle|container|ruler|scale|thermometer|gauge|meter|cylinder|beaker|flask|volume|millilit(?:er|re)|lit(?:er|re)s?|ounces?|ml|oz|cm|mm|inch(?:es)?|initials?|name|letter(?:s)?|word(?:s)?)\b/iu;
const NON_TEXT_SCREEN_CONTEXT =
  /\b(?:screen(?:ed)?\s+(?:door|porch|window|mesh)|window\s+screen|screen\s+mesh)\b/iu;
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

/**
 * Aspect-ratio and continuity tokens are instructions for the pipeline, but an image model treats
 * them as something to print: accepted frames came back with "16:9" lettered across a book cover and
 * continuity tags like "satisfied" or "failed-regrowth" painted over the scene. The compiled prompt
 * keeps the meaning and drops every token that reads as marking.
 */
const plainGeometry = (value: string): string =>
  value
    .replaceAll("16:10", "wide horizontal")
    .replaceAll("16:9", "wide horizontal")
    .replaceAll("16 : 9", "wide horizontal")
    .replaceAll("9:16", "tall vertical")
    .replaceAll("8:9", "narrow vertical")
    .replaceAll("8 : 9", "narrow vertical");

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

function isNegatedMention(clause: string, start: number, end: number): boolean {
  const prefixStart = Math.max(0, start - 160);
  const prefix = clause.slice(prefixStart, start);
  NEGATIVE_CUE.lastIndex = 0;
  const cues = [...prefix.matchAll(NEGATIVE_CUE)];
  const cue = cues.at(-1);
  const suffix = clause.slice(end, Math.min(clause.length, end + 24));
  if (/^[\s-]*free\b/iu.test(suffix) || /^\s*(?:absent|missing|omitted|removed)\b/iu.test(suffix))
    return true;
  if (cue === undefined || cue.index === undefined) return false;

  const priorCue = cues.at(-2);
  if (
    priorCue?.index !== undefined &&
    NEGATION_REVERSAL.test(cue[0]) &&
    !/[.!?]|\b(?:but|however|despite|although|except|yet)\b/iu.test(
      prefix.slice(priorCue.index + priorCue[0].length, cue.index),
    )
  )
    return false;

  const between = prefix.slice(cue.index + cue[0].length);
  if (/[.!?]/u.test(between) || /\b(?:but|however|despite|although|except|yet)\b/iu.test(between))
    return false;
  // "do not remove the logo" and "without omitting labels" require the
  // forbidden element to remain. A negative cue cannot make that double
  // negative safe.
  if (NEGATION_REVERSAL.test(between)) return false;
  if (NEGATED_MODIFIER_OR_VERB.test(between)) return true;

  // A negative list may continue across conjunctions or commas, but only when
  // the next term is itself the list item. "no text, a label" must still be
  // rejected because the article introduces a positively requested object.
  if (NEGATIVE_LIST_BRIDGE.test(between)) {
    const after = clause.slice(end);
    return after.trim().length === 0 || /^(?:\s*(?:,|and|or)\b)/iu.test(after);
  }
  return false;
}

function isTextualMarkingContext(clause: string, start: number, end: number): boolean {
  const context = `${clause.slice(Math.max(0, start - 96), start)} ${clause.slice(end, end + 96)}`;
  return TEXTUAL_MARKING_CONTEXT.test(context);
}

function isNonTextMention(
  kind: ForbiddenMentionKind,
  clause: string,
  start: number,
  end: number,
): boolean {
  if (kind === "marking") return !isTextualMarkingContext(clause, start, end);
  if (kind === "screen") {
    const context = `${clause.slice(Math.max(0, start - 24), start)} ${clause.slice(start, end)} ${clause.slice(end, end + 24)}`;
    return NON_TEXT_SCREEN_CONTEXT.test(context);
  }
  if (kind === "brand") return /^\s*(?:-|\u2011)?new\b/iu.test(clause.slice(end));
  if (kind === "chart") {
    return /^\s*(?:a|the)?\s*(?:course|route|path|direction|territory)\b/iu.test(clause.slice(end));
  }
  if (kind === "writing") {
    return /^\s+(?:desk|table|instrument)\b/iu.test(clause.slice(end));
  }
  return false;
}

export function assertNoHardPromptConflict(value: string, path: readonly string[]): void {
  for (const clause of value
    .split(/[;,]/u)
    .map((part) => part.trim())
    .filter(Boolean)) {
    for (const { kind, pattern } of FORBIDDEN_MENTIONS) {
      pattern.lastIndex = 0;
      for (const match of clause.matchAll(pattern)) {
        const start = match.index;
        const term = match[0];
        if (start === undefined) continue;
        const end = start + term.length;
        if (isNonTextMention(kind, clause, start, end) || isNegatedMention(clause, start, end))
          continue;
        fail("PROMPT_CONFLICT", "Prompt clause requests a forbidden output or layout.", path);
      }
    }
  }
}

export function validatePromptStyleComponents(style: PromptStyleComponents): PromptStyleComponents {
  const result = {
    positiveSuffix: normalize(style.positiveSuffix, 2_400, "Style positive suffix", [
      "style",
      "positiveSuffix",
    ]),
    negativeSuffix: normalizeOptional(style.negativeSuffix, 2_400, "Style negative suffix", [
      "style",
      "negativeSuffix",
    ]),
    fullImageGuidance: normalize(style.fullImageGuidance, 800, "Full-image guidance", [
      "style",
      "fullImageGuidance",
    ]),
    splitImageGuidance: normalize(style.splitImageGuidance, 800, "Split-image guidance", [
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

const COMPACT_DOCUMENTARY_STYLE_POSITIVE =
  "authentic documentary photo, candid and unposed, on location, practical light, true-to-life color, soft contrast, realistic skin/material textures, natural imperfections, consumer framing, photojournalistic, everyday life, photorealistic, no glossy or AI look";
const COMPACT_DOCUMENTARY_STYLE_NEGATIVE =
  "illustration/CGI, fantasy/surrealism, plastic/waxy skin, HDR, glamour/studio lighting, staged pose, bad anatomy, duplicate subjects, unrealistic perfection";
const BUILT_IN_DOCUMENTARY_STYLE_POSITIVE =
  "authentic observational documentary photography, candid and unposed, filmed on location, available practical light, true-to-life colors, soft contrast, realistic skin and material textures, naturally imperfect clothing, tools and environment, ordinary consumer-camera framing, photojournalistic, genuine frame from real stock or documentary footage, believable everyday life, no glossy commercial polish, absolutely photorealistic, no AI look";
const BUILT_IN_DOCUMENTARY_STYLE_NEGATIVE =
  "illustration, cartoon, anime, CGI, 3D render, digital painting, fantasy, surrealism, plastic skin, waxy face, perfect symmetry, excessive HDR, glamour lighting, studio advertising, staged pose, impossible anatomy, duplicate people, duplicate limbs, malformed hands, unrealistic perfection";

const compactBuiltInStylePositive = (value: string): string => {
  return value === BUILT_IN_DOCUMENTARY_STYLE_POSITIVE ? COMPACT_DOCUMENTARY_STYLE_POSITIVE : value;
};

const compactBuiltInStyleNegative = (value: string): string => {
  if (value === BUILT_IN_DOCUMENTARY_STYLE_NEGATIVE) return COMPACT_DOCUMENTARY_STYLE_NEGATIVE;
  // Landscape profiles often repeat the permanent no-text rule in a long
  // synonym list. Retain their photographic exclusions and any custom terms.
  if (!/^(?:avoid:\s*)?blurry,\s*soft focus,\s*low resolution,/iu.test(value)) return value;
  const covered = new Set([
    "text", "pseudo-text", "gibberish lettering", "words", "letters", "numbers",
    "typography", "labels", "signage", "packaging text", "printed markings",
    "branded packaging", "brand names", "product names", "ingredient lists",
    "watermark", "watermarks", "captions", "logos", "overlays", "motion graphics",
  ]);
  const terms = value.split(/[,;]/u).map((term) => term.trim()).filter(Boolean);
  return terms.filter((term) => !covered.has(term.toLowerCase())).join(", ");
};

const compactCropGuidance = (value: string): string => {
  if (/^wide horizontal frame, key evidence inside center-safe 80%$/iu.test(value))
    return "wide horizontal, center-safe 80%";
  if (/^narrow vertical right panel, key subject centered away from edges$/iu.test(value))
    return "narrow vertical right panel, centered subject, clear edges";
  if (
    /primary evidence inside the center-safe 80 percent/iu.test(value) &&
    /slow zoom/iu.test(value)
  )
    return "wide horizontal, center-safe 80%; keep evidence clear during slow zoom; retain environmental context";
  if (
    /primary evidence centered/iu.test(value) &&
    /half-frame size/iu.test(value) &&
    /extreme edges/iu.test(value)
  )
    return "narrow vertical right panel, center-safe; keep evidence readable at half-frame size and clear of edges";
  return value;
};

const NEGATIVE_TERM_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  border: "border",
  borders: "border",
  caption: "caption",
  captions: "caption",
  graphic: "graphic",
  graphics: "graphic",
  label: "label",
  labels: "label",
  logo: "logo",
  logos: "logo",
  number: "number",
  numbers: "number",
  watermark: "watermark",
  watermarks: "watermark",
});

const compactNegativePrompt = (parts: readonly (string | null)[]): string => {
  const seen = new Set<string>();
  return parts
    .filter((part): part is string => part !== null && part.length > 0)
    .flatMap((part) => part.split(/[;,]/u))
    .map((term) => term.replace(/^\s*(?:avoid|negative\s+prompt)\s*:\s*/iu, "").trim())
    .filter(Boolean)
    .filter((term) => {
      const normalized = term.toLocaleLowerCase("en-US").replace(/\s+/gu, " ");
      const key = normalized
        .replace(
          /\b(border|borders|caption|captions|graphic|graphics|label|labels|logo|logos|number|numbers|watermark|watermarks)\b/gu,
          (value) => NEGATIVE_TERM_ALIASES[value] ?? value,
        )
        .replace(/\b(?:impossible|malformed)\s+anatomy\b/gu, "anatomy")
        .replace(/\bduplicate\s+(?:people|subjects|limbs)\b/gu, "duplicate");
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
  const sceneFields = [
    normalize(output.literal_subject, 240, "Literal subject", ["writerOutput", "literal_subject"]),
    normalize(output.action, 240, "Action", ["writerOutput", "action"]),
    normalize(output.environment, 240, "Environment", ["writerOutput", "environment"]),
    normalize(output.lighting_context, 120, "Lighting", ["writerOutput", "lighting_context"]),
  ];
  sceneFields.forEach((value, index) =>
    assertNoHardPromptConflict(value, [
      "writerOutput",
      ["literal_subject", "action", "environment", "lighting_context"][index]!,
    ]),
  );
  // The provider-authored prompt_core is retained in the durable writer shape
  // for compatibility, but it is not trusted at the image-model boundary.
  // Build the literal scene description only from the independently normalized
  // and conflict-checked fields above. This makes a stale or mismatched raw
  // core unable to change the subject, action, or environment that reaches the
  // image model. Provider lighting remains validated and durable audit data;
  // the pinned style supplies the sole compiled lighting treatment.
  const literalContent = [
    `subject: ${sceneFields[0]}`,
    `action: ${sceneFields[1]}`,
    `environment: ${sceneFields[2]}`,
  ].join(", ");
  // Continuity tags are validated but never compiled into the prompt text: an image model paints
  // slug-style tags over the frame as caption words ("satisfied", "failed-regrowth"), so the prompt
  // carries a neutral consistency clause instead. The write-side batch already normalizes and
  // de-duplicates the tags, so this loop only keeps the hard-conflict guard.
  output.continuity_tags.forEach((tag, index) => {
    const normalizedTag = normalize(tag, 80, "Continuity tag", [
      "writerOutput",
      "continuity_tags",
      String(index),
    ]);
    assertNoHardPromptConflict(normalizedTag, ["writerOutput", "continuity_tags", String(index)]);
  });
  const continuityAndShotRole = join([
    "same subject/setting/state",
    `viewpoint: ${expected.inImageShotRole.toLowerCase().replaceAll("_", " ")}`,
  ]);
  const cropGuidance =
    expected.layout === "IMAGE_FULL" ? style.fullImageGuidance : style.splitImageGuidance;
  const components = Object.freeze({
    literalContent: plainGeometry(literalContent),
    continuityAndShotRole: plainGeometry(continuityAndShotRole),
    cropGuidance: compactCropGuidance(plainGeometry(cropGuidance)),
    stylePositiveSuffix: compactBuiltInStylePositive(plainGeometry(style.positiveSuffix)),
    extraPromptKeywords: extra === null ? extra : plainGeometry(extra),
    permanentPositiveGuardrail: PERMANENT_POSITIVE_GUARDRAIL,
    styleNegativeSuffix: compactBuiltInStyleNegative(plainGeometry(style.negativeSuffix)),
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
  const negativePrompt = compactNegativePrompt([
    components.styleNegativeSuffix,
    components.permanentNegativeGuardrail,
  ]);
  if (positivePrompt.length > 6_500 || negativePrompt.length > 3_000)
    fail("PROMPT_INPUT_INVALID", "Compiled prompt exceeds the bounded image-model prompt budget.", [
      "writerOutput",
    ]);
  return Object.freeze({
    promptCompilerVersion: "prompt-compiler-v3",
    scenePromptWriterVersion: SCENE_PROMPT_WRITER_VERSION,
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
  const negativeParts = [
    prompt.components.styleNegativeSuffix,
    prompt.components.permanentNegativeGuardrail,
  ];
  const negative = compactNegativePrompt(negativeParts);
  const legacyNegative = join(negativeParts);
  const negativeMatches = [negative, legacyNegative].some(
    (candidate) =>
      candidate === prompt.negativePrompt &&
      Buffer.byteLength(candidate, "utf8") === prompt.negativePromptUtf8Bytes &&
      hash(candidate) === prompt.negativePromptSha256,
  );
  if (
    positive !== prompt.positivePrompt ||
    !negativeMatches ||
    Buffer.byteLength(positive, "utf8") !== prompt.positivePromptUtf8Bytes ||
    hash(positive) !== prompt.positivePromptSha256
  )
    fail("PROMPT_HASH_MISMATCH", "Compiled prompt bytes, components, or hashes do not match.", []);
}

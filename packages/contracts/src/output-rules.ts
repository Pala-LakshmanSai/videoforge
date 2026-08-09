export const forbiddenOutputRuleLabels = {
  BORDER: "borders",
  DECORATIVE_GRAPHICS: "decorative graphics",
  INFOGRAPHIC: "infographics",
  LOGO: "logos",
  LOWER_THIRD: "lower thirds",
  MOTION_GRAPHICS: "motion graphics",
  TEXT: "visible text or captions",
  TITLE_CARD: "title cards",
  TRANSITION: "decorative transitions",
  WATERMARK: "watermarks",
} as const;

export type ForbiddenOutputRule = keyof typeof forbiddenOutputRuleLabels;

export interface OutputRuleConflict {
  rule: ForbiddenOutputRule;
  label: string;
  term: string;
}

export interface OutputRuleValidation {
  valid: boolean;
  conflicts: OutputRuleConflict[];
}

const forbiddenPatterns: ReadonlyArray<{
  rule: ForbiddenOutputRule;
  pattern: RegExp;
}> = [
  { rule: "LOWER_THIRD", pattern: /\blower[- ]thirds?\b/giu },
  { rule: "TITLE_CARD", pattern: /\btitle[- ]cards?\b/giu },
  { rule: "MOTION_GRAPHICS", pattern: /\bmotion[- ]graphics?\b/giu },
  { rule: "DECORATIVE_GRAPHICS", pattern: /\bdecorative[- ]graphics?\b/giu },
  { rule: "INFOGRAPHIC", pattern: /\binfographics?\b/giu },
  { rule: "TRANSITION", pattern: /\b(?:decorative|animated|stylized|smooth)\s+transitions?\b/giu },
  { rule: "WATERMARK", pattern: /\bwatermarks?\b/giu },
  { rule: "LOGO", pattern: /\blogos?\b/giu },
  { rule: "BORDER", pattern: /\b(?:decorative\s+)?(?:borders?|frames?)\b/giu },
  {
    rule: "TEXT",
    pattern:
      /\b(?:captions?|subtitles?|text[- ]overlays?|on[- ]screen\s+text|visible\s+text|written\s+text|title\s+text)\b/giu,
  },
];

function isNegated(text: string, start: number, end: number): boolean {
  const prefix = text.slice(Math.max(0, start - 160), start);
  const localClause = prefix.split(/(?:[.!?;:\n]|\bbut\b|\bhowever\b|\bexcept\b)/iu).at(-1) ?? "";
  const suffix = text.slice(end, Math.min(text.length, end + 12));
  if (/^\s*[- ]free\b/iu.test(suffix)) return true;
  return /(?:\bno|\bnot|\bwithout|\bavoid(?:ing)?|\bexclude(?:ing)?|\bomit(?:ting)?|\bremove|\bnever|\bdo\s+not|\bdon't|\bfree\s+of)(?:\s+[\p{L}\p{N}'-]+){0,8}\s*$/iu.test(
    localClause,
  );
}

function hasUnsafeControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) continue;
    if (
      (codePoint < 32 && codePoint !== 9 && codePoint !== 10 && codePoint !== 13) ||
      codePoint === 127
    ) {
      return true;
    }
  }
  return false;
}

export function validateOutputRuleKeywords(value: string): OutputRuleValidation {
  if (hasUnsafeControlCharacter(value)) {
    return {
      valid: false,
      conflicts: [{ rule: "TEXT", label: "control characters", term: "control character" }],
    };
  }

  const conflicts: OutputRuleConflict[] = [];
  for (const { rule, pattern } of forbiddenPatterns) {
    pattern.lastIndex = 0;
    for (const match of value.matchAll(pattern)) {
      const start = match.index;
      const term = match[0];
      if (start === undefined || isNegated(value, start, start + term.length)) continue;
      conflicts.push({ rule, label: forbiddenOutputRuleLabels[rule], term });
      break;
    }
  }

  return { valid: conflicts.length === 0, conflicts };
}

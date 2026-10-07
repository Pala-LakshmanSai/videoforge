const PHYSICAL_SCREEN = /\b(?:touch[- ]?)?screens?\b(?![-\s]+(?:wash|door|porch|window|mesh)\b)/giu;

export function physicalScreensHaveLocalSource(value: string, source: string): boolean {
  const pattern = new RegExp(PHYSICAL_SCREEN.source, "iu");
  return !pattern.test(value) || pattern.test(source);
}

/** v42 only: preserve a locally named device surface while making its display state explicit. */
export function projectTextFreePhysicalScreens(value: string, source: string): string {
  if (!new RegExp(PHYSICAL_SCREEN.source, "iu").test(source)) return value;
  return value.replace(PHYSICAL_SCREEN, (screen, offset: number, whole: string) => {
    const prefix = whole.slice(0, offset);
    if (/\bblank\s+unlit\s+$/iu.test(prefix)) return screen;
    return `blank unlit ${screen}`;
  });
}
/** Project an explicitly text-free surface without deleting its physical relationships. */
export function projectTextFreePhysicalSurfaces(
  value: string,
  options: { readonly includeProductContainerModifiers?: boolean } = {},
): string {
  const normalized = value.normalize("NFKC");
  // A positive mark anywhere makes the description ambiguous. Never erase the noun that
  // lets the independent compiler reject it; a later negative cannot cancel that mark.
  const content = normalized
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/\bwith\s+no\s+(?:text|writing)\s*[.!?]?\s*$/iu, "");
  if (
    /\b(?:print(?:s|ed|ing)?|writ(?:e|es|ten|ing)|read(?:s|ing)?|word(?:s|ed|ing)?|letter(?:s|ed|ing)?|number(?:s|ed|ing)?|logos?|brand(?:s|ed|ing)?|barcod(?:e|es|ed|ing)|text(?:s|ual)?|inscri(?:be|bes|bed|bing|ption|ptions)|engrav(?:e|es|ed|ing)|etch(?:es|ed|ing)?|spell(?:s|ed|ing)?|marked|drawn|drawing|illustrat(?:e|es|ed|ing|ion|ions)|portraits?|photos?|pictures?|symbols?|doodles?)\b/iu.test(
      content,
    )
  )
    return value;

  const modifiers = options.includeProductContainerModifiers
    ? "(?:back|front|white|black|green|brown|red|blue|yellow|orange|purple|pink|grey|gray|beige|cream|tan|gold|silver|plain|paper|small|large|rectangular|square|round|wooden|metal|plastic|bottle|jar|container|package|carton|can|box)"
    : "(?:back|front|white|black|green|brown|red|blue|yellow|orange|purple|pink|grey|gray|beige|cream|tan|gold|silver|plain|paper|small|large|rectangular|square|round|wooden|metal|plastic)";
  const color =
    "(?:white|black|green|brown|red|blue|yellow|orange|purple|pink|grey|gray|beige|cream|tan|gold|silver)";
  const relationModifiers =
    "(?:grocery|store|supermarket|shop|wooden|metal|plastic|upper|lower|top|bottom|front|back|left|right|open|closed|plain|unmarked|white|black|green|brown|red|blue|yellow)";
  const physicalNouns =
    "(?:bottles?|jars?|containers?|packages?|cartons?|cans?|boxes?|shelves|shelf|racks?|counters?|tables?|walls?|doors?)";
  const relations = new RegExp(
    `^\\s*(?:area)?(?:\\s+holders?)?(?:\\s+side[- ]by[- ]side)?(?:\\s+(?:on|of|at|by|beside|near|under|above|below|along|attached to|affixed to)\\s+(?:(?:a|an|the|its)\\s+)?(?:${relationModifiers}\\s+){0,5}${physicalNouns}(?:\\s+edges?)?)*(?:\\s+with\\s+(?:a\\s+)?(?:blank|unmarked)\\s+(?:${color}\\s+)?corners?)?\\s*(?:with\\s+no\\s+(?:text|writing)\\s*)?[.!?]?\\s*$`,
    "iu",
  );
  const surface = new RegExp(
    `\\b(a\\s+)?(?:blank(?:\\s*,)?\\s+(?:unmarked\\s+)?|unmarked(?:\\s*,)?\\s+(?:blank\\s+)?)((?:(?:${color}\\s+and\\s+${color}|${modifiers})\\s+){0,6})(label|(?:shelf|price)[- ](?:tag|card))(s)?\\b`,
    "giu",
  );
  const contentRelation = new RegExp(
    `\\b(?:on|onto|across)\\s+(?:(?:a|an|the|its)\\s+)?(?:${modifiers}\\s+){0,6}$`,
    "iu",
  );
  const contentPlacement = (prefix: string): boolean =>
    contentRelation.test(prefix.replace(/[\p{Cc}\p{Cf}]/gu, ""));
  let projected = normalized.replace(
    /\bunmarked\s+(white|black|green|brown|red|blue|yellow|orange|purple|pink|grey|gray|beige|cream|tan|gold|silver)[- ]labeled\s+(bottle|jar|container|package|carton|can|box)(?=[.!?]?\s*$)/giu,
    (match, color: string, container: string, offset: number, whole: string) =>
      contentPlacement(whole.slice(0, offset))
        ? match
        : `unmarked ${container} with a ${color} surface`,
  );
  projected = projected.replace(
    surface,
    (
      match,
      article: string | undefined,
      modifier: string,
      noun: string,
      plural: string | undefined,
      offset: number,
      whole: string,
    ) => {
      if (
        contentPlacement(whole.slice(0, offset)) ||
        !relations.test(whole.slice(offset + match.length))
      )
        return match;
      const physical = /^label$/iu.test(noun)
        ? "surface"
        : /^shelf/iu.test(noun)
          ? "shelf card"
          : "card";
      return `${article ? "an " : ""}unmarked${modifier.trim() ? ` ${modifier.trim()}` : ""} ${physical}${plural ? "s" : ""}`;
    },
  );
  return projected;
}

/**
 * Runware Luna may describe a generic store/name-brand category without asking
 * for a visible mark. Project only that category when a physical good is named
 * and the same field contains no positive request for text, labels, branding,
 * or other marks. Keep this separate from the legacy projection so sealed
 * Gemini prompt behavior stays unchanged.
 */
export function projectRunwareLunaPhysicalProductCategory(value: string): string {
  const withoutNegatedMark = removeRunwareLunaNegativeProductSurfaceMentions(value);
  if (!/\b(?:store|name)[- ]brand\b/iu.test(withoutNegatedMark)) return withoutNegatedMark;
  const category = /\b(?:store|name)[- ]brand\b/giu;
  const withoutCategory = withoutNegatedMark.normalize("NFKC").replace(category, " ");
  const physicalGood =
    /\b(?:bottles?|jars?|containers?|packages?|cartons?|cans?|boxes?|products?|goods|items?|sauces?|foods?)\b/iu;
  const positiveMark =
    /\b(?:print(?:s|ed|ing)?|writ(?:e|es|ten|ing)|read(?:s|ing)|word(?:s|ed|ing)?|letter(?:s|ed|ing)?|number(?:s|ed|ing)?|logos?|branding|brand\s+names?|labels?|mark(?:s|ed|ing)?|text(?:s|ual)?|inscri(?:be|bes|bed|bing|ption|ptions)|engrav(?:e|es|ed|ing)|etch(?:es|ed|ing)?|spell(?:s|ed|ing)?|barcod(?:e|es|ed|ing)|quot(?:e|es|ed|ing)|says?)\b/iu;
  if (!physicalGood.test(withoutCategory) || positiveMark.test(withoutCategory))
    return withoutNegatedMark;
  return withoutNegatedMark
    .normalize("NFKC")
    .replace(category, "unmarked")
    .replace(/\bunmarked(?:\s+unmarked)+\b/giu, "unmarked");
}

/** Remove only directly negated mark mentions on fields that name a physical good. */
export function removeRunwareLunaNegativeProductSurfaceMentions(value: string): string {
  if (
    !/\b(?:bottles?|jars?|containers?|packages?|cartons?|cans?|boxes?|products?|goods|items?)\b/iu.test(
      value,
    )
  )
    return value;
  const mark =
    "(?:text|writing|words?|letters?|numbers?|names?|logos?|branding|labels?|marks?|inscriptions?|engravings?|etching|barcodes?|pictures?|photos?|portraits?|images?|imagery|illustrations?|graphics?|symbols?|faces?)";
  const negatedMark = new RegExp(
    `(?:\\s+(?:with\\s+)?|[,;:]\\s*)\\b(?:no|not|never|without)\\s+(?:(?:a|an|the|any|visible|printed|painted|drawn|depicted|pictured|illustrated|celebrity|famous|well[- ]known)\\s+){0,4}(?:${mark})\\b`,
    "giu",
  );
  return value
    .replace(negatedMark, "")
    .replace(/\s+([,;:])/gu, "$1")
    .replace(/([,;:])\s*[.!?]?$/u, "")
    .replace(/\s+/gu, " ")
    .trim();
}

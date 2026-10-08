export interface Voice {
  voice_id: string;
  name: string;
  tags: string;
  languages: string;
  preview_url: string | null;
  saved: boolean;
  starred: boolean;
}

export interface VoiceCatalog {
  voices: Voice[];
  collections?: {
    id: string;
    name: string;
    is_current_user: boolean;
    voice_ids: string[];
  }[];
}

export function normalizeVoiceName(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").trim().replace(/\s+/gu, " ").toLowerCase();
}

/** Name prefixes only: country codes such as gb/br must never match a name search. */
export function matchesVoiceName(voice: Pick<Voice, "name">, query: string): boolean {
  return normalizeVoiceName(voice.name).startsWith(normalizeVoiceName(query));
}

export function compareVoices(a: Voice, b: Voice): number {
  return (
    Number(b.starred) - Number(a.starred) ||
    Number(b.saved) - Number(a.saved) ||
    a.name.localeCompare(b.name)
  );
}

export const voiceFilterLabels = {
  gender: "Gender",
  accent: "Accent",
  age: "Age",
  region: "Language / region",
  style: "Style / tone",
  useCase: "Use case",
} as const;
export type VoiceFacet = keyof typeof voiceFilterLabels;
export type VoiceFilters = Record<VoiceFacet, string>;
export const emptyVoiceFilters: VoiceFilters = {
  gender: "",
  accent: "",
  age: "",
  region: "",
  style: "",
  useCase: "",
};
export type VoiceTraits = Record<VoiceFacet, string[]>;
const useCases = new Set([
  "advertisement",
  "conversational",
  "narrative story",
  "informative educational",
  "social media",
  "characters animation",
  "entertainment tv",
]);
// Only explicit catalog descriptions identify accents; supported regions do not.
const accentPatterns: [string, RegExp][] = [
  ["American", /\bamerican\b/u],
  ["British", /\b(british|britain|english accent)\b/u],
  ["Australian", /\baustralian\b/u],
  ["Canadian", /\bcanadian\b/u],
  ["Indian", /\bindian\b/u],
  ["Irish", /\birish\b/u],
  ["Scottish", /\bscottish\b/u],
  ["Welsh", /\bwelsh\b/u],
  ["New Zealand", /\b(new zealand|kiwi)\b/u],
  ["South African", /\bsouth african\b/u],
  ["Latin American", /\blatin american\b/u],
  ["Saudi", /\bsaudi\b/u],
  ["London", /\blondon\b/u],
  ["Midwest American", /\bmidwest\b/u],
  ["Southern American", /\b(southern american|american southern)\b/u],
  ["Seoul", /\bseoul\b/u],
];
// Voice age labels describe the catalog voice, never a measured or inferred human age.
const agePatterns: [string, RegExp][] = [
  ["child", /\b(child|kid|baby|little (boy|girl))\b/u],
  ["teen", /\b(teen|teenage|teenager|adolescent)\b/u],
  ["young", /\b(young|youth|youthful)\b/u],
  ["middle-aged", /\bmiddle[ -]aged?\b/u],
  ["mature", /\bmature\b/u],
  ["elderly", /\b(elderly|senior|aged|old (man|woman|male|female))\b/u],
  ["adult", /\badult\b/u],
];
const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
export function voiceTraits(voice: Voice): VoiceTraits {
  const tags = [...new Set(voice.tags.split(",").map(normalizeVoiceName).filter(Boolean))];
  const description = normalizeVoiceName(
    voice.name
      .split(/\s[-–—]\s/u)
      .slice(1)
      .join(" "),
  );
  const accentText = tags.join(", ") + " " + description;
  const accents = accentPatterns
    .filter(([, pattern]) => pattern.test(accentText))
    .map(([label]) => label);
  if (accents.includes("Latin American")) accents.splice(accents.indexOf("American"), 1);
  const ages = agePatterns
    .filter(([, pattern]) => pattern.test(accentText))
    .map(([label]) => label);
  // Specific descriptors take precedence over the generic word adult; middle-aged is not elderly.
  if ((ages.includes("child") || ages.includes("teen")) && ages.includes("young"))
    ages.splice(ages.indexOf("young"), 1);
  if (ages.length > 1 && ages.includes("adult")) ages.splice(ages.indexOf("adult"), 1);
  if (ages.includes("middle-aged") && ages.includes("elderly"))
    ages.splice(ages.indexOf("elderly"), 1);
  return {
    age: ages,
    gender: tags.filter((t) => ["male", "female", "non-binary", "neutral gender"].includes(t)),
    accent: accents.map(normalizeVoiceName),
    region: [...new Set(voice.languages.split(",").map(normalizeVoiceName).filter(Boolean))],
    useCase: tags.filter((t) => useCases.has(t)),
    style: tags.filter(
      (t) =>
        !useCases.has(t) &&
        !agePatterns.some(([, pattern]) => pattern.test(t)) &&
        !["male", "female", "non-binary", "neutral gender"].includes(t) &&
        !accentPatterns.some(([, pattern]) => pattern.test(t)),
    ),
  };
}
export function voiceFacetLabel(facet: VoiceFacet, value: string): string {
  if (value === "unspecified") return "Not specified";
  if (facet === "region" && /^[a-z]{2}$/u.test(value))
    return regionNames.of(value.toUpperCase()) ?? value.toUpperCase();
  return value.replace(/\b\w/gu, (letter) => letter.toUpperCase());
}
export function matchesVoiceFilters(
  traits: VoiceTraits,
  filters: VoiceFilters,
  except?: VoiceFacet,
): boolean {
  return (Object.keys(voiceFilterLabels) as VoiceFacet[]).every(
    (facet) =>
      facet === except ||
      !filters[facet] ||
      (filters[facet] === "unspecified"
        ? !traits[facet].length
        : traits[facet].includes(filters[facet])),
  );
}

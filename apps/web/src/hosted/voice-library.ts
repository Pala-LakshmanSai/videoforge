export interface Voice {
  voice_id: string;
  name: string;
  tags: string;
  languages: string;
  preview_url: string | null;
  saved: boolean;
  starred: boolean;
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

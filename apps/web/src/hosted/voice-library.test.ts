import { expect, it } from "vitest";
import { matchesVoiceName } from "./voice-library";

it("matches name prefixes, never letters in the middle of a name", () => {
  expect(matchesVoiceName({ name: "Bob - Calm" }, "b")).toBe(true);
  expect(matchesVoiceName({ name: "Abby" }, "b")).toBe(false);
  expect(matchesVoiceName({ name: "Alice - British" }, "b")).toBe(false);
  expect(matchesVoiceName({ name: "Brian" }, "bri")).toBe(true);
});
it("normalizes spaces, case and accents without changing the displayed name", () => {
  expect(matchesVoiceName({ name: "  Béatrice  - Warm" }, "  BEA ")).toBe(true);
  expect(matchesVoiceName({ name: "Will   Smith" }, "will smith")).toBe(true);
  expect(matchesVoiceName({ name: "李明" }, "李")).toBe(true);
  expect(matchesVoiceName({ name: "Alice" }, "  ")).toBe(true);
});

it("uses exact gender tags and explicit accents, never supported regions or personal names", async () => {
  const { voiceTraits, matchesVoiceFilters, emptyVoiceFilters, voiceFacetLabel } = await import(
    "./voice-library"
  );
  const base = {
    voice_id: "a",
    name: "India",
    tags: "Calm, Female, Narrative Story",
    languages: "us,gb,in",
    saved: false,
    starred: false,
    preview_url: null,
  };
  const traits = voiceTraits(base);
  expect(traits.gender).toEqual(["female"]);
  expect(traits.accent).toEqual([]);
  expect(traits.region).toEqual(["us", "gb", "in"]);
  expect(traits.style).toEqual(["calm"]);
  expect(traits.useCase).toEqual(["narrative story"]);
  expect(matchesVoiceFilters(traits, { ...emptyVoiceFilters, gender: "male" })).toBe(false);
  expect(
    matchesVoiceFilters(traits, {
      ...emptyVoiceFilters,
      gender: "female",
      region: "gb",
      accent: "unspecified",
    }),
  ).toBe(true);
  expect(
    voiceTraits({ ...base, name: "Alice - Latin American", tags: "Female, British" }).accent,
  ).toEqual(["british", "latin american"]);
  expect(voiceTraits({ ...base, name: "Alice - Modern Australian" }).accent).toEqual([
    "australian",
  ]);
  expect(voiceFacetLabel("region", "in")).toBe("India");
  expect(voiceFacetLabel("accent", "unspecified")).toBe("Not specified");
  expect(matchesVoiceFilters(traits, { ...emptyVoiceFilters, gender: "male" }, "gender")).toBe(
    true,
  );
});

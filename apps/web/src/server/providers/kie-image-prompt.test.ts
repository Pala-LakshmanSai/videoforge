import type { CompiledImagePrompt } from "@videoforge/pipeline";
import { describe, expect, it } from "vitest";
import { buildKieScenePrompt, kieScenePromptLiteralCharacterLimit } from "./kie-image-prompt";

const cases = [
  [
    "A rescue center worker shown chest-up inside the center.",
    "Offers short-term assistance.",
    "City rescue center interior.",
  ],
  [
    "An urban village block with a partially cleared building site.",
    "Is partly cleared for redevelopment.",
    "Urban village redevelopment site.",
  ],
];
function compiled(subject: string, action: string, environment: string): CompiledImagePrompt {
  return {
    promptCompilerVersion: "prompt-compiler-v5",
    components: {
      literalContent: `subject: ${subject}, action: ${action}, environment: ${environment}`,
      cropGuidance: "One continuous horizontal photograph",
      stylePositiveSuffix: "Natural documentary photograph, available light",
      continuityAndShotRole: "same subject/setting/state",
      extraPromptKeywords: null,
      styleNegativeSuffix: "illustration, CGI",
    },
  } as CompiledImagePrompt;
}
describe("fresh photographic image wire policy", () => {
  it("keeps v4/v5 wire bytes exact and gives v6 its full bounded literal allowance", () => {
    const source = compiled("A worker", "tightens a bolt", "A garage");
    const original = JSON.stringify(source);
    const legacy =
      "subject: A worker, action: tightens a bolt, environment: A garage. " +
      "One continuous horizontal photograph. Natural documentary photograph, available light. " +
      "No visible text/pseudo-text, labels, logos, watermarks, captions, overlays, graphics, borders or motion graphics; unmarked surfaces. " +
      "same subject/setting/state. Avoid: illustration, CGI";
    for (const promptCompilerVersion of ["prompt-compiler-v4", "prompt-compiler-v5"] as const)
      expect(buildKieScenePrompt({ ...source, promptCompilerVersion })).toBe(legacy);
    const fresh = { ...source, promptCompilerVersion: "prompt-compiler-v6" } as CompiledImagePrompt;
    const options = { requiredOnly: true };
    const budget = kieScenePromptLiteralCharacterLimit(fresh, options);
    expect(budget).toBeGreaterThan(kieScenePromptLiteralCharacterLimit(source, options));
    const action = "tightens a bolt";
    const environment = "A garage";
    const subject = "A worker".padEnd(budget - action.length - environment.length, "x");
    const boundary = {
      ...fresh,
      components: {
        ...fresh.components,
        literalContent: `subject: ${subject}, action: ${action}, environment: ${environment}`,
      },
    };
    expect(buildKieScenePrompt(boundary, options)).toHaveLength(800);
    const photographic = buildKieScenePrompt(boundary, {
      ...options,
      wirePolicy: "photographic-v1",
    });
    for (const fact of [subject, action, environment]) expect(photographic).toContain(fact);
    expect(photographic.length).toBeLessThanOrEqual(800);
    expect(() =>
      buildKieScenePrompt(
        {
          ...boundary,
          components: {
            ...boundary.components,
            literalContent: boundary.components.literalContent + "x",
          },
        },
        options,
      ),
    ).toThrow("INPUT_INVALID");
    expect(JSON.stringify(source)).toBe(original);
  });

  it.each(cases)(
    "removes caption-like fields for %s without losing scene facts",
    (subject, action, environment) => {
      const source = compiled(subject!, action!, environment!);
      const original = JSON.stringify(source);
      const legacy = buildKieScenePrompt(source);
      const prompt = buildKieScenePrompt(source, { wirePolicy: "photographic-v1" });
      expect(prompt).not.toMatch(/\b(subject|action|environment):/u);
      for (const fact of [subject, action, environment])
        expect(prompt.toLowerCase()).toContain(fact!.replace(/\.$/u, "").toLowerCase());
      expect(prompt).toContain("Physical scene, never words.");
      for (const term of [
        "pseudo-text",
        "labels",
        "logos",
        "watermarks",
        "captions",
        "overlays",
        "graphics",
        "borders",
        "motion graphics",
        "unmarked surfaces",
        "Natural documentary photograph",
        "One continuous horizontal photograph",
      ])
        expect(prompt).toContain(term);
      expect(prompt.length).toBeLessThanOrEqual(800);
      expect(JSON.stringify(source)).toBe(original);
      expect(buildKieScenePrompt(source)).toBe(legacy);
    },
  );
  it("keeps an exact 800-character sealed scene allowance usable", () => {
    const base = compiled("A worker", "offers assistance", "A rescue center");
    const remaining = 800 - buildKieScenePrompt(base, { requiredOnly: true }).length;
    const source = compiled(
      "A worker" + "x".repeat(remaining),
      "offers assistance",
      "A rescue center",
    );
    expect(buildKieScenePrompt(source, { requiredOnly: true })).toHaveLength(800);
    expect(
      buildKieScenePrompt(source, { requiredOnly: true, wirePolicy: "photographic-v1" }).length,
    ).toBeLessThanOrEqual(800);
  });
  it("rejects over-budget fresh prompts intact and preserves freeform regeneration facts", () => {
    const source = compiled("A worker", "offers assistance", "A rescue center");
    const freeform = {
      ...source,
      components: {
        ...source.components,
        literalContent: "A worker beside a desk in a rescue center.",
      },
    };
    expect(buildKieScenePrompt(freeform, { wirePolicy: "photographic-v1" })).toContain(
      freeform.components.literalContent,
    );
    expect(() =>
      buildKieScenePrompt(
        { ...source, components: { ...source.components, literalContent: "x".repeat(800) } },
        { wirePolicy: "photographic-v1" },
      ),
    ).toThrow("INPUT_INVALID");
  });
});

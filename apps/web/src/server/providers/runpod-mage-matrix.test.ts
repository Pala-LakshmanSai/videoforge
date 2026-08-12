import { describe, expect, it } from "vitest";

import { buildMageMatrix } from "./runpod-mage-matrix-inputs";

describe("Mage quality matrix", () => {
  it("pins 40 deterministic prompts across eight categories, five styles, and both crops", () => {
    const matrix = buildMageMatrix();
    expect(matrix).toHaveLength(40);
    expect(new Set(matrix.map((item) => item.sceneId))).toHaveLength(40);
    expect(new Set(matrix.map((item) => item.category))).toHaveLength(8);
    expect(new Set(matrix.map((item) => item.styleId))).toHaveLength(5);
    expect(new Set(matrix.map((item) => item.layout))).toEqual(
      new Set(["FULL_IMAGE", "SPLIT_RIGHT_IMAGE"]),
    );
    expect(matrix.every((item) => item.promptHash.startsWith("sha256:"))).toBe(true);
    expect(matrix.every((item) => item.negativePromptHash.startsWith("sha256:"))).toBe(true);
  });
});

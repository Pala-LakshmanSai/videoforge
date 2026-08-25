import { describe, expect, it } from "vitest";

import { isHostedProviderMode } from "./provider-mode";

describe("hosted browser provider mode", () => {
  it.each(["staging", "production"])("treats %s as hosted", (mode) => {
    expect(isHostedProviderMode(mode)).toBe(true);
  });

  it.each([undefined, "fixture", "sandbox", "production-typo"])(
    "keeps %s outside hosted adapters",
    (mode) => {
      expect(isHostedProviderMode(mode)).toBe(false);
    },
  );
});

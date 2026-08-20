import { describe, expect, it } from "vitest";

import {
  parseV207ActivationAuthority,
  V207_REPAIRED_IMAGE,
  V207_REPAIRED_IMAGE_SOURCE_COMMIT,
} from "./v207-activation-authority";

const image = V207_REPAIRED_IMAGE;

describe("V2-07 activation authority", () => {
  it("pins a complete 40-character repaired source commit", () => {
    expect(V207_REPAIRED_IMAGE_SOURCE_COMMIT).toMatch(/^[0-9a-f]{40}$/u);
  });

  it("requires an immutable image, repaired source commit, and explicit cap", () => {
    expect(() => parseV207ActivationAuthority({})).toThrow("V207_IMAGE_DIGEST_REQUIRED");
    expect(() =>
      parseV207ActivationAuthority({
        V207_IMAGE: image.replace("videoforge-mage-v2-07", "other-image"),
        V207_IMAGE_SOURCE_COMMIT: V207_REPAIRED_IMAGE_SOURCE_COMMIT,
        V207_FINITE_CAP_USD: "1",
      }),
    ).toThrow("V207_IMAGE_DIGEST_REQUIRED");
    expect(() =>
      parseV207ActivationAuthority({
        V207_IMAGE: image,
        V207_IMAGE_SOURCE_COMMIT: "39541d57ca3c2270c7872ab49387f2484ab1a6e9",
        V207_FINITE_CAP_USD: "4",
      }),
    ).toThrow("V207_IMAGE_SOURCE_COMMIT_MISMATCH");
    expect(() =>
      parseV207ActivationAuthority({
        V207_IMAGE: image,
        V207_IMAGE_SOURCE_COMMIT: V207_REPAIRED_IMAGE_SOURCE_COMMIT,
      }),
    ).toThrow("V207_FINITE_CAP_REQUIRED");
  });

  it("accepts only a fresh explicit finite cap for the repaired image", () => {
    expect(
      parseV207ActivationAuthority({
        V207_IMAGE: image,
        V207_IMAGE_SOURCE_COMMIT: V207_REPAIRED_IMAGE_SOURCE_COMMIT,
        V207_FINITE_CAP_USD: "4.25",
      }),
    ).toEqual({ image, capUsd: 4.25 });
  });

  it("rejects the prior immutable digest even with the repaired source commit", () => {
    expect(() =>
      parseV207ActivationAuthority({
        V207_IMAGE:
          "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:ab5043715f422c20ad1190f063c4f9e66f0d73907738c1ff185ab4d37a57af4e",
        V207_IMAGE_SOURCE_COMMIT: V207_REPAIRED_IMAGE_SOURCE_COMMIT,
        V207_FINITE_CAP_USD: "4",
      }),
    ).toThrow("V207_IMAGE_DIGEST_REQUIRED");
  });
});

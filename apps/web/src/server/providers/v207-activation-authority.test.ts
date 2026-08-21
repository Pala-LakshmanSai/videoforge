import { describe, expect, it } from "vitest";

import {
  V207_APPROVED_FINITE_CAP_USD,
  parseV207ActivationAuthority,
  V207_PENDING_PROPOSAL_SHA256,
  V207_REPAIRED_IMAGE,
  V207_REPAIRED_IMAGE_BASE_DIGEST,
  V207_REPAIRED_IMAGE_CONFIG_DIGEST,
  V207_REPAIRED_IMAGE_LAYER_DIGEST,
  V207_REPAIRED_IMAGE_PARENT,
  V207_REPAIRED_IMAGE_PARENT_CONFIG_DIGEST,
  V207_REPAIRED_IMAGE_SOURCE_COMMIT,
} from "./v207-activation-authority";

const image = V207_REPAIRED_IMAGE;

describe("V2-07 activation authority", () => {
  it("pins the complete partial-PATCH acknowledgement candidate lineage", () => {
    expect(V207_REPAIRED_IMAGE_SOURCE_COMMIT).toMatch(/^[0-9a-f]{40}$/u);
    expect(V207_REPAIRED_IMAGE).toContain(
      "@sha256:bc662a182b2a874c6aeffb05f65cc3ffbdff6b5130c6a75c214618e86cf208b5",
    );
    expect(V207_REPAIRED_IMAGE_CONFIG_DIGEST).toBe(
      "sha256:8e11a42cb91fa1d0d6a4e19fc6b4a6cfd5f77116c49a8516b6435813dfaab1de",
    );
    expect(V207_REPAIRED_IMAGE_LAYER_DIGEST).toBe(
      "sha256:befafc2ec3d32a73b632f769069c9c02645d3fac049ebd2478fbf8ad3d5cdf38",
    );
    expect(V207_REPAIRED_IMAGE_PARENT).toContain(
      "@sha256:8a5b8f453c694b2eeee097e3d958b08c5e47c15290b5cdc17a4fb7e5e3e4f497",
    );
    expect(V207_REPAIRED_IMAGE_BASE_DIGEST).toBe(
      "sha256:8a5b8f453c694b2eeee097e3d958b08c5e47c15290b5cdc17a4fb7e5e3e4f497",
    );
    expect(V207_REPAIRED_IMAGE_PARENT_CONFIG_DIGEST).toBe(
      "sha256:de5c854ae5aa9e611e218b89d29a250eb03a0a316f0ac92d584d53a038d06ff2",
    );
    expect(V207_PENDING_PROPOSAL_SHA256).toBe(
      "sha256:9d3f9ff254692f61b5efbd8ef55659094183b0df15c077db4eb23ce81e30bb5d",
    );
    expect(V207_APPROVED_FINITE_CAP_USD).toBeNull();
  });

  it("rejects identity and proposal drift before the approval boundary", () => {
    expect(() => parseV207ActivationAuthority({})).toThrow("V207_IMAGE_DIGEST_REQUIRED");
    expect(() =>
      parseV207ActivationAuthority({
        V207_IMAGE: image.replace("videoforge-mage-v2-07", "other-image"),
        V207_IMAGE_SOURCE_COMMIT: V207_REPAIRED_IMAGE_SOURCE_COMMIT,
        V207_PROPOSAL_SHA256: V207_PENDING_PROPOSAL_SHA256,
      }),
    ).toThrow("V207_IMAGE_DIGEST_REQUIRED");
    expect(() =>
      parseV207ActivationAuthority({
        V207_IMAGE: image,
        V207_IMAGE_SOURCE_COMMIT: "39541d57ca3c2270c7872ab49387f2484ab1a6e9",
        V207_PROPOSAL_SHA256: V207_PENDING_PROPOSAL_SHA256,
      }),
    ).toThrow("V207_IMAGE_SOURCE_COMMIT_MISMATCH");
    expect(() =>
      parseV207ActivationAuthority({
        V207_IMAGE: image,
        V207_IMAGE_SOURCE_COMMIT: V207_REPAIRED_IMAGE_SOURCE_COMMIT,
      }),
    ).toThrow("V207_PROPOSAL_REQUIRED");
    expect(() =>
      parseV207ActivationAuthority({
        V207_IMAGE: image,
        V207_IMAGE_SOURCE_COMMIT: V207_REPAIRED_IMAGE_SOURCE_COMMIT,
        V207_PROPOSAL_SHA256: "sha256:" + "0".repeat(64),
        V207_FINITE_CAP_USD: "2",
      }),
    ).toThrow("V207_PROPOSAL_MISMATCH");
  });

  it("rejects all caps until the fresh GET-readback proposal is approved", () => {
    expect(() =>
      parseV207ActivationAuthority({
        V207_IMAGE: image,
        V207_IMAGE_SOURCE_COMMIT: V207_REPAIRED_IMAGE_SOURCE_COMMIT,
        V207_PROPOSAL_SHA256: V207_PENDING_PROPOSAL_SHA256,
        V207_FINITE_CAP_USD: "4",
      }),
    ).toThrow("V207_FRESH_AUTHORITY_REQUIRED");
  });

  it("rejects the prior immutable digest even with the pending proposal", () => {
    expect(() =>
      parseV207ActivationAuthority({
        V207_IMAGE:
          "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:6318edbc73b59d1a495566a765515831b3ff28302a4dc33c5e09ba52352215e3",
        V207_IMAGE_SOURCE_COMMIT: V207_REPAIRED_IMAGE_SOURCE_COMMIT,
        V207_PROPOSAL_SHA256: V207_PENDING_PROPOSAL_SHA256,
        V207_FINITE_CAP_USD: "4",
      }),
    ).toThrow("V207_IMAGE_DIGEST_REQUIRED");
  });
});

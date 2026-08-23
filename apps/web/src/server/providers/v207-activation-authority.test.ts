import { describe, expect, it } from "vitest";

import {
  V207_APPROVED_AUTHORITY_SHA256,
  V207_APPROVED_FINITE_CAP_USD,
  V207_CONSUMED_ATTEMPT31_AUTHORITY_SHA256,
  V207_HOSTED_PNG_CRC32_REPAIR_COMMIT,
  V207_FINALIZE_REPLAY_FAST_PATH_COMMIT,
  parseV207ActivationAuthority,
  V207_PENDING_PROPOSAL_SHA256,
  V207_PENDING_CONTROL_SOURCE_COMMIT,
  V207_REPAIRED_IMAGE,
  V207_REPAIRED_IMAGE_BASE_DIGEST,
  V207_REPAIRED_IMAGE_CONFIG_DIGEST,
  V207_REPAIRED_IMAGE_LAYER_DIGEST,
  V207_REPAIRED_IMAGE_LAYER_DIFF_ID,
  V207_REPAIRED_HANDLER_SHA256,
  V207_EXECUTION_SUBSET_SCHEMA_SHA256,
  V207_REPAIRED_IMAGE_PARENT,
  V207_REPAIRED_IMAGE_PARENT_CONFIG_DIGEST,
  V207_REPAIRED_IMAGE_SOURCE_COMMIT,
  V207_TERMINAL_SNAPSHOT_STABILIZATION_COMMIT,
} from "./v207-activation-authority";

const image = V207_REPAIRED_IMAGE;

// Historical immutable-lineage markers verified by compatibility validators:
// Attempt28 sha256:12bb46d0d6403c888bc5ba7c965174f681baa5f45f320a90a4b1d4f0cf7f56cf
// Attempt28 control 0084f6a13fdaa5a6d4b704e32e8b6cc22cecce14
// Attempt29 sha256:d29ab29956e00ebf15595943297564286a685fef0f796b5c8a6cb2a34183d8f6
// Attempt29 control 7ba8e9181fe210858c23a3ba7c5c9aca768ac24b
// Attempt29 authority sha256:46bf0ba614b4210f56fd745057e8ebc6f5be4c69c672fe885d6d36de185f1572
// Attempt32 proposal sha256:7c5370668ae06487729775f082cd981164d3e4a1634f20a77beb08bba2ea6b6a
// Attempt32 authority sha256:a2f2519e6cc5f00ec804adea07b431d155e9fc88a566d7f9ef05396beca99114
// Compatibility assertions reject consumed Attempt29/30/31 candidates while the exact
// Attempt33 is consumed; Attempt34 closed before mutation on capacity drift; Attempt35/37 are consumed.

describe("V2-07 activation authority", () => {
  it("pins the complete pending Attempt41 diagnostic/read-retry lineage", () => {
    expect(V207_REPAIRED_IMAGE_SOURCE_COMMIT).toMatch(/^[0-9a-f]{40}$/u);
    expect(V207_REPAIRED_IMAGE).toContain(
      "@sha256:79fe7e40b69c011c15cc31b2d84b356cd2c755ea338976172cd78cc581304d59",
    );
    expect(V207_REPAIRED_IMAGE_CONFIG_DIGEST).toBe(
      "sha256:b6c43cb1f2782540f52ac1f2f4584fea763237f1c75c8c7c1341ea70bcc915e6",
    );
    expect(V207_REPAIRED_IMAGE_LAYER_DIGEST).toBe(
      "sha256:f31fc51513e3573eb859897b7bcacd4b28bb525567b7523af1c98e4f370c8c3a",
    );
    expect(V207_REPAIRED_IMAGE_LAYER_DIFF_ID).toBe(
      "sha256:9f759e3f49c84816de71246f51f9aca275fc080c7c9c082aaa39ce81e8b049e1",
    );
    expect(V207_REPAIRED_HANDLER_SHA256).toBe(
      "sha256:3a2559dd363bdf5032b019dab3cb8fe45cba6ed4308464f860a1965cfd18f1da",
    );
    expect(V207_EXECUTION_SUBSET_SCHEMA_SHA256).toBe(
      "sha256:a94bf2c8c4175eef3f84ab719118c2b9b5b501ce8b2708c28713b25521b71c71",
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
      "sha256:3ce00d81d161e43a2d6a1610b6f9a7c9b7ceaa1fcb3bbbe44339fa478605eb18",
    );
    expect(V207_HOSTED_PNG_CRC32_REPAIR_COMMIT).toBe("1960ea9307bb7fcb591c842b84fc1c622aec49eb");
    expect(V207_PENDING_CONTROL_SOURCE_COMMIT).toBe("6a4053f6fdde6e906e10b7cb297d253a7b9af140");
    expect(V207_FINALIZE_REPLAY_FAST_PATH_COMMIT).toBe("bf26c3a86ec6a48f619c39613d425da816eeae4d");
    expect(V207_TERMINAL_SNAPSHOT_STABILIZATION_COMMIT).toBe(
      "f513ac807c6d5e2298092a936495e3c4fc0e6a28",
    );
    expect(V207_CONSUMED_ATTEMPT31_AUTHORITY_SHA256).toBe(
      "sha256:02b91db639ddf6e612c7103d38f9c5c1bae3ff0072afaeebb124274db1e3eab5",
    );
    expect(V207_APPROVED_AUTHORITY_SHA256).toBeNull();
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

  it("rejects the consumed Attempt28 proposal after closure", () => {
    expect(() =>
      parseV207ActivationAuthority({
        V207_IMAGE: image,
        V207_IMAGE_SOURCE_COMMIT: V207_REPAIRED_IMAGE_SOURCE_COMMIT,
        V207_PROPOSAL_SHA256:
          "sha256:12bb46d0d6403c888bc5ba7c965174f681baa5f45f320a90a4b1d4f0cf7f56cf",
        V207_FINITE_CAP_USD: "4",
      }),
    ).toThrow("V207_PROPOSAL_MISMATCH");
  });

  it("rejects the exact Attempt41 proposal before fresh authority is recorded", () => {
    expect(() =>
      parseV207ActivationAuthority({
        V207_IMAGE: image,
        V207_IMAGE_SOURCE_COMMIT: V207_REPAIRED_IMAGE_SOURCE_COMMIT,
        V207_PROPOSAL_SHA256: V207_PENDING_PROPOSAL_SHA256,
        V207_FINITE_CAP_USD: "4",
      }),
    ).toThrow("V207_FRESH_AUTHORITY_REQUIRED");
  });

  it("rejects any cap before the Attempt41 authority exists", () => {
    expect(() =>
      parseV207ActivationAuthority({
        V207_IMAGE: image,
        V207_IMAGE_SOURCE_COMMIT: V207_REPAIRED_IMAGE_SOURCE_COMMIT,
        V207_PROPOSAL_SHA256: V207_PENDING_PROPOSAL_SHA256,
        V207_FINITE_CAP_USD: "2",
      }),
    ).toThrow("V207_FRESH_AUTHORITY_REQUIRED");
  });

  it("rejects a missing numeric cap before the Attempt41 authority boundary", () => {
    expect(() =>
      parseV207ActivationAuthority({
        V207_IMAGE: image,
        V207_IMAGE_SOURCE_COMMIT: V207_REPAIRED_IMAGE_SOURCE_COMMIT,
        V207_PROPOSAL_SHA256: V207_PENDING_PROPOSAL_SHA256,
      }),
    ).toThrow("V207_FRESH_AUTHORITY_REQUIRED");
  });

  it("rejects the consumed Attempt31 proposal after closure", () => {
    expect(() =>
      parseV207ActivationAuthority({
        V207_IMAGE: image,
        V207_IMAGE_SOURCE_COMMIT: V207_REPAIRED_IMAGE_SOURCE_COMMIT,
        V207_PROPOSAL_SHA256:
          "sha256:ace01c82b5eaa9e45c177e7c41b908b1f384fe13ae6ff6bd3f8e04cf8ecb98ea",
        V207_FINITE_CAP_USD: "4",
      }),
    ).toThrow("V207_PROPOSAL_MISMATCH");
  });

  it("rejects the consumed Attempt30 proposal after closure", () => {
    expect(() =>
      parseV207ActivationAuthority({
        V207_IMAGE: image,
        V207_IMAGE_SOURCE_COMMIT: V207_REPAIRED_IMAGE_SOURCE_COMMIT,
        V207_PROPOSAL_SHA256:
          "sha256:2cb3d2a2ab73e968da1e964018fd2c100bf9e8cc7b277e9c5739b69355896c2a",
        V207_FINITE_CAP_USD: "4",
      }),
    ).toThrow("V207_PROPOSAL_MISMATCH");
  });

  it("rejects the consumed Attempt29 proposal after closure", () => {
    expect(() =>
      parseV207ActivationAuthority({
        V207_IMAGE: image,
        V207_IMAGE_SOURCE_COMMIT: V207_REPAIRED_IMAGE_SOURCE_COMMIT,
        V207_PROPOSAL_SHA256:
          "sha256:d29ab29956e00ebf15595943297564286a685fef0f796b5c8a6cb2a34183d8f6",
        V207_FINITE_CAP_USD: "4",
      }),
    ).toThrow("V207_PROPOSAL_MISMATCH");
  });

  it("rejects the consumed Attempt25 proposal after closure", () => {
    expect(() =>
      parseV207ActivationAuthority({
        V207_IMAGE: image,
        V207_IMAGE_SOURCE_COMMIT: V207_REPAIRED_IMAGE_SOURCE_COMMIT,
        V207_PROPOSAL_SHA256:
          "sha256:c8baa8a45b8e3e108904cac5f04f472ad22da2936dad75daa2a59d23476a8946",
        V207_FINITE_CAP_USD: "4",
      }),
    ).toThrow("V207_PROPOSAL_MISMATCH");
  });

  it("rejects the consumed GET-readback proposal even with its former cap", () => {
    expect(() =>
      parseV207ActivationAuthority({
        V207_IMAGE: image,
        V207_IMAGE_SOURCE_COMMIT: V207_REPAIRED_IMAGE_SOURCE_COMMIT,
        V207_PROPOSAL_SHA256:
          "sha256:9e9675dcf6943dce35b4bf6155fdfc39f8dade5e9775bcc3ee9a427980d39e02",
        V207_FINITE_CAP_USD: "4",
      }),
    ).toThrow("V207_PROPOSAL_MISMATCH");
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

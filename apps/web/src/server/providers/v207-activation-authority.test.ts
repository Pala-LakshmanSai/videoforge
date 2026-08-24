import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  V207_APPROVED_AUTHORITY_SHA256,
  V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED,
  V207_APPROVED_FINITE_CAP_USD,
  V207_ANCHOR_REFRESH_HELPER_COMMIT,
  V207_ANCHOR_REFRESH_HELPER_SHA256,
  V207_ANCHOR_REFRESH_SOURCE_COMMIT,
  V207_CONSUMED_ATTEMPT31_AUTHORITY_SHA256,
  V207_HOSTED_PNG_CRC32_REPAIR_COMMIT,
  V207_FINALIZE_REPLAY_FAST_PATH_COMMIT,
  V207_FRESH_CATALOG_SUCCESS_RECONCILIATION_COMMIT,
  parseV207ActivationAuthority,
  V207_PENDING_PROPOSAL_SHA256,
  V207_PENDING_CONTROL_SOURCE_COMMIT,
  V207_ORCHESTRATOR_MARKER_LIFECYCLE_COMMIT,
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
  V207_TYPED_ACTIVATION_AUTHORITY_COMMIT,
  V207_TERMINAL_SNAPSHOT_STABILIZATION_COMMIT,
  canonicalV207ActivationAuthoritySource,
  hashV207ActivationAuthoritySource,
  normalizeV207ActivationAuthoritySource,
} from "./v207-activation-authority";

const image = V207_REPAIRED_IMAGE;

type ActivationSourceFixtureOptions = {
  proposal?: string;
  authority?: string;
  cap?: string;
  anchorRefresh?: string;
  unrelated?: string;
};

function activationSourceFixture({
  proposal = "a".repeat(64),
  authority = "null",
  cap = "null",
  anchorRefresh = "null",
  unrelated = "",
}: ActivationSourceFixtureOptions = {}): string {
  return [
    `export const V207_PENDING_PROPOSAL_SHA256 = "sha256:${proposal}" as const;`,
    `export const V207_APPROVED_AUTHORITY_SHA256: string | null = ${authority};`,
    `export const V207_APPROVED_FINITE_CAP_USD: number | null = ${cap};`,
    `export const V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED: boolean | null = ${anchorRefresh};`,
    `const unrelated = "${unrelated}";`,
  ].join("\n");
}

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
  it("pins the approved single-use Attempt57 authority", () => {
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
      "sha256:f28c0ceb4c39ce7c74c1a63d918c00acb078e8cb8c63d0728e00f9d4d2126cd4",
    );
    expect(V207_HOSTED_PNG_CRC32_REPAIR_COMMIT).toBe("1960ea9307bb7fcb591c842b84fc1c622aec49eb");
    expect(V207_PENDING_CONTROL_SOURCE_COMMIT).toBe("85391b130673200e2d1f74fea4ea2581d5d83c1a");
    expect(V207_ANCHOR_REFRESH_SOURCE_COMMIT).toBe("a6c7266e0c19fce07757c78fbd588dd442b7d24f");
    expect(V207_TYPED_ACTIVATION_AUTHORITY_COMMIT).toBe("e5571ed2478f0c526ebf508d0a4ce301bafa8203");
    expect(V207_ORCHESTRATOR_MARKER_LIFECYCLE_COMMIT).toBe(
      "3dda73fed6d82dc7116b18a6b7cfbe4b262fc7bc",
    );
    expect(V207_FRESH_CATALOG_SUCCESS_RECONCILIATION_COMMIT).toBe(
      "5e1e5a067357a0df4a2fe1ea32412a4b6af33404",
    );
    expect(V207_ANCHOR_REFRESH_HELPER_COMMIT).toBe("816d28699ab9ecad74c74f73bce984205b267ed5");
    expect(V207_ANCHOR_REFRESH_HELPER_SHA256).toBe(
      "sha256:8b059ade2b20ca3aea06a502af98858b6b5cce8e6e95f3008b45483712b28db8",
    );
    expect(V207_FINALIZE_REPLAY_FAST_PATH_COMMIT).toBe("bf26c3a86ec6a48f619c39613d425da816eeae4d");
    expect(V207_TERMINAL_SNAPSHOT_STABILIZATION_COMMIT).toBe(
      "f513ac807c6d5e2298092a936495e3c4fc0e6a28",
    );
    expect(V207_CONSUMED_ATTEMPT31_AUTHORITY_SHA256).toBe(
      "sha256:02b91db639ddf6e612c7103d38f9c5c1bae3ff0072afaeebb124274db1e3eab5",
    );
    expect(V207_APPROVED_AUTHORITY_SHA256).toBe(
      "sha256:7ab262a878e0447002f417ea3af49ffa376cea307296ea8d24681ff8492bc015",
    );
    expect(V207_APPROVED_FINITE_CAP_USD).toBe(4);
    expect(V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED).toBe(true);
  });

  it("uses a fail-closed non-cyclic source binding for all approval constants", () => {
    const sourceBeforeApproval = activationSourceFixture();
    const sourceAfterApproval = activationSourceFixture({
      proposal: "b".repeat(64),
      authority: `"sha256:${"c".repeat(64)}"`,
      cap: "4",
      anchorRefresh: "true",
    });
    expect(canonicalV207ActivationAuthoritySource(sourceBeforeApproval)).toBe(
      canonicalV207ActivationAuthoritySource(sourceAfterApproval),
    );
    expect(normalizeV207ActivationAuthoritySource(sourceBeforeApproval)).toBe(
      canonicalV207ActivationAuthoritySource(sourceBeforeApproval),
    );
    expect(hashV207ActivationAuthoritySource(sourceBeforeApproval)).toBe(
      hashV207ActivationAuthoritySource(sourceAfterApproval),
    );

    const unrelatedDrift = activationSourceFixture({ unrelated: "drift" });
    expect(canonicalV207ActivationAuthoritySource(unrelatedDrift)).not.toBe(
      canonicalV207ActivationAuthoritySource(sourceBeforeApproval),
    );
    expect(hashV207ActivationAuthoritySource(unrelatedDrift)).not.toBe(
      hashV207ActivationAuthoritySource(sourceBeforeApproval),
    );
  });

  it("canonicalizes Prettier-wrapped approval declarations", () => {
    const proposal = "a".repeat(64);
    const authority = "c".repeat(64);
    const singleLine = activationSourceFixture({
      proposal,
      authority: `"sha256:${authority}"`,
      cap: "4",
      anchorRefresh: "true",
    });
    const prettierWrapped = [
      `export const V207_PENDING_PROPOSAL_SHA256 =`,
      `  "sha256:${proposal}" as const;`,
      `export const V207_APPROVED_AUTHORITY_SHA256: string | null =`,
      `  "sha256:${authority}";`,
      `export const V207_APPROVED_FINITE_CAP_USD: number | null =`,
      `  4;`,
      `export const V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED: boolean | null =`,
      `  true;`,
      `const unrelated = "";`,
    ].join("\n");

    expect(canonicalV207ActivationAuthoritySource(prettierWrapped)).toBe(
      canonicalV207ActivationAuthoritySource(singleLine),
    );
    expect(hashV207ActivationAuthoritySource(prettierWrapped)).toBe(
      hashV207ActivationAuthoritySource(singleLine),
    );
  });

  it("canonicalizes the real activation module without counting replacement literals", async () => {
    const source = await readFile("src/server/providers/v207-activation-authority.ts", "utf8");
    expect(hashV207ActivationAuthoritySource(source)).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it("rejects missing, duplicate, and malformed canonical approval bindings", () => {
    const source = activationSourceFixture();
    const cases = [
      {
        error: "V207_ACTIVATION_SOURCE_PROPOSAL_POINTER_INVALID",
        missing: source.replace(
          'export const V207_PENDING_PROPOSAL_SHA256 = "sha256:' + "a".repeat(64) + '" as const;\n',
          "",
        ),
        duplicate: `${source}\n${source.split("\n")[0]}`,
        malformed: source.replace("sha256:" + "a".repeat(64), "sha256:bad"),
      },
      {
        error: "V207_ACTIVATION_SOURCE_APPROVED_AUTHORITY_INVALID",
        missing: source.replace(
          "export const V207_APPROVED_AUTHORITY_SHA256: string | null = null;\n",
          "",
        ),
        duplicate: `${source}\n${source.split("\n")[1]}`,
        malformed: source.replace(
          "V207_APPROVED_AUTHORITY_SHA256: string | null = null",
          "V207_APPROVED_AUTHORITY_SHA256: string | null = undefined",
        ),
      },
      {
        error: "V207_ACTIVATION_SOURCE_FINITE_CAP_INVALID",
        missing: source.replace(
          "export const V207_APPROVED_FINITE_CAP_USD: number | null = null;\n",
          "",
        ),
        duplicate: `${source}\n${source.split("\n")[2]}`,
        malformed: source.replace(
          "V207_APPROVED_FINITE_CAP_USD: number | null = null",
          "V207_APPROVED_FINITE_CAP_USD: number | null = Infinity",
        ),
      },
      {
        error: "V207_ACTIVATION_SOURCE_ANCHOR_REFRESH_INVALID",
        missing: source.replace(
          "export const V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED: boolean | null = null;\n",
          "",
        ),
        duplicate: `${source}\n${source.split("\n")[3]}`,
        malformed: source.replace(
          "V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED: boolean | null = null",
          "V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED: boolean | null = undefined",
        ),
      },
    ];
    for (const testCase of cases) {
      expect(() => canonicalV207ActivationAuthoritySource(testCase.missing)).toThrow(
        testCase.error,
      );
      expect(() => canonicalV207ActivationAuthoritySource(testCase.duplicate)).toThrow(
        testCase.error,
      );
      expect(() => canonicalV207ActivationAuthoritySource(testCase.malformed)).toThrow(
        testCase.error,
      );
    }
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

  it("rejects the consumed Attempt41 proposal after closure", () => {
    expect(() =>
      parseV207ActivationAuthority({
        V207_IMAGE: image,
        V207_IMAGE_SOURCE_COMMIT: V207_REPAIRED_IMAGE_SOURCE_COMMIT,
        V207_PROPOSAL_SHA256:
          "sha256:3ce00d81d161e43a2d6a1610b6f9a7c9b7ceaa1fcb3bbbe44339fa478605eb18",
        V207_FINITE_CAP_USD: "4",
      }),
    ).toThrow("V207_PROPOSAL_MISMATCH");
  });

  it("rejects the consumed Attempt42 proposal after closure", () => {
    expect(() =>
      parseV207ActivationAuthority({
        V207_IMAGE: image,
        V207_IMAGE_SOURCE_COMMIT: V207_REPAIRED_IMAGE_SOURCE_COMMIT,
        V207_PROPOSAL_SHA256:
          "sha256:1b3a75d67ff6ebff875e0ffb42e11d0bb0544c566670847f7748755c490681de",
        V207_FINITE_CAP_USD: "4",
      }),
    ).toThrow("V207_PROPOSAL_MISMATCH");
  });

  it("rejects the consumed Attempt56 proposal after its bounded execution", () => {
    expect(() =>
      parseV207ActivationAuthority({
        V207_IMAGE: image,
        V207_IMAGE_SOURCE_COMMIT: V207_REPAIRED_IMAGE_SOURCE_COMMIT,
        V207_PROPOSAL_SHA256:
          "sha256:d3c10f7af00591dea0afe73d2960b316a788235bb2585decab6ca479b4ce9ab9",
        V207_FINITE_CAP_USD: "4",
        V207_ROLLBACK_ANCHOR_REFRESH: "two-phase-v1",
      }),
    ).toThrow("V207_PROPOSAL_MISMATCH");
  });

  it("accepts the exact approved Attempt57 proposal, cap, and refresh activation", () => {
    expect(
      parseV207ActivationAuthority({
        V207_IMAGE: image,
        V207_IMAGE_SOURCE_COMMIT: V207_REPAIRED_IMAGE_SOURCE_COMMIT,
        V207_PROPOSAL_SHA256: V207_PENDING_PROPOSAL_SHA256,
        V207_FINITE_CAP_USD: "4",
        V207_ROLLBACK_ANCHOR_REFRESH: "two-phase-v1",
      }),
    ).toEqual({
      image,
      proposalSha256: V207_PENDING_PROPOSAL_SHA256,
      capUsd: 4,
      anchorRefreshAuthorized: true,
    });
  });

  it("rejects missing and mismatched Attempt57 finite caps fail-closed", () => {
    expect(() =>
      parseV207ActivationAuthority({
        V207_IMAGE: image,
        V207_IMAGE_SOURCE_COMMIT: V207_REPAIRED_IMAGE_SOURCE_COMMIT,
        V207_PROPOSAL_SHA256: V207_PENDING_PROPOSAL_SHA256,
      }),
    ).toThrow("V207_FINITE_CAP_REQUIRED");
    expect(() =>
      parseV207ActivationAuthority({
        V207_IMAGE: image,
        V207_IMAGE_SOURCE_COMMIT: V207_REPAIRED_IMAGE_SOURCE_COMMIT,
        V207_PROPOSAL_SHA256: V207_PENDING_PROPOSAL_SHA256,
        V207_FINITE_CAP_USD: "2",
      }),
    ).toThrow("V207_FINITE_CAP_MISMATCH");
  });

  it("rejects refresh activation without the exact approved Attempt57 proposal", () => {
    const refreshMarker = { V207_ROLLBACK_ANCHOR_REFRESH: "two-phase-v1" };
    expect(() =>
      parseV207ActivationAuthority({
        ...refreshMarker,
        V207_IMAGE: image,
        V207_IMAGE_SOURCE_COMMIT: V207_REPAIRED_IMAGE_SOURCE_COMMIT,
        V207_PROPOSAL_SHA256:
          "sha256:d3481231340fb7a4a22ae1047103024ca37e6b75c70c37d36c3bfb2a9baaff1f",
        V207_FINITE_CAP_USD: "4",
      }),
    ).toThrow("V207_PROPOSAL_MISMATCH");
    expect(() =>
      parseV207ActivationAuthority({
        ...refreshMarker,
        V207_IMAGE: image,
        V207_IMAGE_SOURCE_COMMIT: V207_REPAIRED_IMAGE_SOURCE_COMMIT,
        V207_PROPOSAL_SHA256: V207_PENDING_PROPOSAL_SHA256,
      }),
    ).toThrow("V207_FINITE_CAP_REQUIRED");
    expect(() => parseV207ActivationAuthority(refreshMarker)).toThrow("V207_IMAGE_DIGEST_REQUIRED");
  });

  it("rejects the consumed proposal even when refresh activation is requested", () => {
    expect(() =>
      parseV207ActivationAuthority({
        V207_IMAGE: image,
        V207_IMAGE_SOURCE_COMMIT: V207_REPAIRED_IMAGE_SOURCE_COMMIT,
        V207_PROPOSAL_SHA256:
          "sha256:1b3a75d67ff6ebff875e0ffb42e11d0bb0544c566670847f7748755c490681de",
        V207_FINITE_CAP_USD: "4",
        V207_ROLLBACK_ANCHOR_REFRESH: "two-phase-v1",
      }),
    ).toThrow("V207_PROPOSAL_MISMATCH");
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

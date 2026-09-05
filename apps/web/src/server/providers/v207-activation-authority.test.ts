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
  it("pins the approved Attempt81 proposal and immutable image", () => {
    expect(V207_REPAIRED_IMAGE_SOURCE_COMMIT).toMatch(/^[0-9a-f]{40}$/u);
    expect(V207_REPAIRED_IMAGE).toContain(
      "@sha256:91ef608fbb15bc69213c73a598a8915fa4dfa938d02c619454e42319a6475f62",
    );
    expect(V207_REPAIRED_IMAGE_CONFIG_DIGEST).toBe(
      "sha256:2aa6c2d124fe299502e3142e4f66d9d627855a3c63eda30b806febb588ec4bb2",
    );
    expect(V207_REPAIRED_IMAGE_LAYER_DIGEST).toBe(
      "sha256:5c54508181bbdaf45691e7db0f4f907194ad7ff1cd38b0f86bfc0469bca0a334",
    );
    expect(V207_REPAIRED_IMAGE_LAYER_DIFF_ID).toBe(
      "sha256:9f581bc2881547b77ff207720599b634386bd23b038124d38a7ab76442ff4770",
    );
    expect(V207_REPAIRED_HANDLER_SHA256).toBe(
      "sha256:8fd7e47308b64865b117bca3bfb3ee41d269935e13660f13a23a15b90d83f96c",
    );
    expect(V207_EXECUTION_SUBSET_SCHEMA_SHA256).toBe(
      "sha256:08fd73862b7d79f685dfaf1b72dd6b1e41468f3f581ad766ffea1f85c9dbf66f",
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
      "sha256:ed0062759c2c12f050a542a80a21b57f26c0f7ae8c1f31a9e1635f8ec2daf087",
    );
    expect(V207_HOSTED_PNG_CRC32_REPAIR_COMMIT).toBe("1960ea9307bb7fcb591c842b84fc1c622aec49eb");
    expect(V207_PENDING_CONTROL_SOURCE_COMMIT).toBe("9caea53785484be42a7bea210a0294addef1a3e0");
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
      "sha256:cac3a6bcdab8f479131ecdb68224e61a83d7ec835418783344b1268fd237f076",
    );
    expect(V207_APPROVED_FINITE_CAP_USD).toBe(4.5);
    expect(V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED).toBe(false);
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

  it("rejects the consumed Attempt57 proposal after its bounded execution", () => {
    expect(() =>
      parseV207ActivationAuthority({
        V207_IMAGE: image,
        V207_IMAGE_SOURCE_COMMIT: V207_REPAIRED_IMAGE_SOURCE_COMMIT,
        V207_PROPOSAL_SHA256:
          "sha256:f28c0ceb4c39ce7c74c1a63d918c00acb078e8cb8c63d0728e00f9d4d2126cd4",
        V207_FINITE_CAP_USD: "4",
        V207_ROLLBACK_ANCHOR_REFRESH: "two-phase-v1",
      }),
    ).toThrow("V207_PROPOSAL_MISMATCH");
  });

  it("rejects the consumed Attempt60 proposal after its bounded invocation", () => {
    expect(() =>
      parseV207ActivationAuthority({
        V207_IMAGE: image,
        V207_IMAGE_SOURCE_COMMIT: V207_REPAIRED_IMAGE_SOURCE_COMMIT,
        V207_PROPOSAL_SHA256:
          "sha256:aa67f635d7ff9d167339b23a0ae9b389d5e4beeec688c56877d44607e426176b",
        V207_FINITE_CAP_USD: "4",
        V207_ROLLBACK_ANCHOR_REFRESH: "two-phase-v1",
      }),
    ).toThrow("V207_PROPOSAL_MISMATCH");
  });

  it("rejects the consumed Attempt61 proposal after its bounded invocation", () => {
    expect(() =>
      parseV207ActivationAuthority({
        V207_IMAGE: image,
        V207_IMAGE_SOURCE_COMMIT: V207_REPAIRED_IMAGE_SOURCE_COMMIT,
        V207_PROPOSAL_SHA256:
          "sha256:6693da1e345ce579ea9c7896b238e3f8bd44fcd2abee92d8e46650436c80d4c0",
        V207_FINITE_CAP_USD: "4",
        V207_ROLLBACK_ANCHOR_REFRESH: "two-phase-v1",
      }),
    ).toThrow("V207_PROPOSAL_MISMATCH");
  });

  it("rejects the consumed Attempt63 proposal", () => {
    expect(() =>
      parseV207ActivationAuthority({
        V207_IMAGE: image,
        V207_IMAGE_SOURCE_COMMIT: V207_REPAIRED_IMAGE_SOURCE_COMMIT,
        V207_PROPOSAL_SHA256:
          "sha256:83a54dbd5d4810a83fa100eaf5014af255097ae2eb7c6264deccf209d5a3e532",
        V207_FINITE_CAP_USD: "4.5",
        V207_ROLLBACK_ANCHOR_REFRESH: "two-phase-v1",
      }),
    ).toThrow("V207_PROPOSAL_MISMATCH");
  });

  it("rejects the consumed single-use Attempt65 authority", () => {
    expect(() =>
      parseV207ActivationAuthority({
        V207_IMAGE: image,
        V207_IMAGE_SOURCE_COMMIT: V207_REPAIRED_IMAGE_SOURCE_COMMIT,
        V207_PROPOSAL_SHA256:
          "sha256:db48b22e53edc3206538558a07b9603fcb66a2b00b33ec3b6093858540594a0c",
        V207_FINITE_CAP_USD: "4.5",
      }),
    ).toThrow("V207_PROPOSAL_MISMATCH");
  });

  it("rejects the consumed single-use Attempt66 authority", () => {
    expect(() =>
      parseV207ActivationAuthority({
        V207_IMAGE: image,
        V207_IMAGE_SOURCE_COMMIT: V207_REPAIRED_IMAGE_SOURCE_COMMIT,
        V207_PROPOSAL_SHA256:
          "sha256:a90c44b9b2cf37383c15c633f7de19dd2b6fbbe1b17abffd227d79a09a95c3f8",
        V207_FINITE_CAP_USD: "4.5",
      }),
    ).toThrow("V207_PROPOSAL_MISMATCH");
  });

  it("accepts exact Attempt81 authority and rejects cap drift", () => {
    const exact = {
      V207_IMAGE: image,
      V207_IMAGE_SOURCE_COMMIT: V207_REPAIRED_IMAGE_SOURCE_COMMIT,
      V207_PROPOSAL_SHA256: V207_PENDING_PROPOSAL_SHA256,
    };
    expect(parseV207ActivationAuthority({ ...exact, V207_FINITE_CAP_USD: "4.5" })).toEqual({
      image,
      proposalSha256: V207_PENDING_PROPOSAL_SHA256,
      capUsd: 4.5,
      anchorRefreshAuthorized: false,
    });
    expect(() => parseV207ActivationAuthority({ ...exact, V207_FINITE_CAP_USD: "4" })).toThrow(
      "V207_FINITE_CAP_MISMATCH",
    );
  });

  it("rejects Attempt80 after its authority is consumed", () => {
    expect(() =>
      parseV207ActivationAuthority({
        V207_IMAGE: image,
        V207_IMAGE_SOURCE_COMMIT: V207_REPAIRED_IMAGE_SOURCE_COMMIT,
        V207_PROPOSAL_SHA256:
          "sha256:2f38c58468d1183c0cf50c98b0ec123740b7fa74c0733d8167d35e650881e99b",
        V207_FINITE_CAP_USD: "4.5",
      }),
    ).toThrow("V207_PROPOSAL_MISMATCH");
  });

  it("rejects Attempt79 after its authority is consumed", () => {
    expect(() =>
      parseV207ActivationAuthority({
        V207_IMAGE: image,
        V207_IMAGE_SOURCE_COMMIT: V207_REPAIRED_IMAGE_SOURCE_COMMIT,
        V207_PROPOSAL_SHA256:
          "sha256:72f72a2de48841194233218c2f84d343c0c236ed36d5ff33a0c6dc682312d22a",
        V207_FINITE_CAP_USD: "4.5",
      }),
    ).toThrow("V207_PROPOSAL_MISMATCH");
  });

  it("rejects Attempt78 after its authority is consumed", () => {
    expect(() =>
      parseV207ActivationAuthority({
        V207_IMAGE: image,
        V207_IMAGE_SOURCE_COMMIT: V207_REPAIRED_IMAGE_SOURCE_COMMIT,
        V207_PROPOSAL_SHA256:
          "sha256:2cb0188a05b033b1519101767654cbd2f94e8eed4a10fd353bfeb7483618d0a2",
        V207_FINITE_CAP_USD: "4.5",
      }),
    ).toThrow("V207_PROPOSAL_MISMATCH");
  });

  it("rejects Attempt77 after its authority is consumed", () => {
    expect(() =>
      parseV207ActivationAuthority({
        V207_IMAGE: image,
        V207_IMAGE_SOURCE_COMMIT: V207_REPAIRED_IMAGE_SOURCE_COMMIT,
        V207_PROPOSAL_SHA256:
          "sha256:a84068163041879cc8616052eaf67a668f1aa46e0b186b53395524b5a02e816a",
        V207_FINITE_CAP_USD: "4.5",
      }),
    ).toThrow("V207_PROPOSAL_MISMATCH");
  });

  it("rejects Attempt76 after its authority is consumed", () => {
    expect(() =>
      parseV207ActivationAuthority({
        V207_IMAGE: image,
        V207_IMAGE_SOURCE_COMMIT: V207_REPAIRED_IMAGE_SOURCE_COMMIT,
        V207_PROPOSAL_SHA256:
          "sha256:da59afdc9ea272c7201215d890741202f5e8f8152ba5765f6172332b1cd51bc6",
        V207_FINITE_CAP_USD: "4.5",
      }),
    ).toThrow("V207_PROPOSAL_MISMATCH");
  });

  it("rejects Attempt75 after its authority is consumed", () => {
    expect(() =>
      parseV207ActivationAuthority({
        V207_IMAGE: image,
        V207_IMAGE_SOURCE_COMMIT: V207_REPAIRED_IMAGE_SOURCE_COMMIT,
        V207_PROPOSAL_SHA256:
          "sha256:dfb527133ad3bfdb20bbb8d9649ca56bcd63eff243e2108f8f32a4861593f533",
        V207_FINITE_CAP_USD: "4.5",
      }),
    ).toThrow("V207_PROPOSAL_MISMATCH");
  });

  it("rejects refresh activation without the exact pending Attempt81 proposal", () => {
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

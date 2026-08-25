import { canonicalSha256, type ServerlessLane, type Sha256 } from "@videoforge/control-plane";
import { describe, expect, it } from "vitest";

import type { HostedQualificationLineage } from "./hosted-serverless-runtime.js";
import {
  evaluateHostedV211Groundwork,
  type HostedV211VerifiedEvidence,
} from "./hosted-v211-acceptance-coordinator.js";

const sha = (label: string): Sha256 => canonicalSha256({ label });
const rawEvidence = Object.freeze({
  schema_version: "videoforge-hosted-v211-evidence/v1",
  evidence_id: "captured-fixture-1",
});

function lineage(lane: ServerlessLane): HostedQualificationLineage {
  return {
    endpointIdSha256: sha(`endpoint-${lane}`),
    endpointTemplateIdSha256: sha(`template-${lane}`),
    endpointConfigSha256: sha(`config-${lane}`),
    workerImageDigest: sha(`image-${lane}`),
    modelManifestSha256: sha(`model-${lane}`),
    volumeIdSha256: sha(`volume-${lane}`),
    volumeManifestSha256: sha(`volume-manifest-${lane}`),
    imageSourceCommit: "a".repeat(40),
    qualificationSourceSha256: sha(`qualification-source-${lane}`),
    dependencyLockSha256: sha(`lock-${lane}`),
    acceptanceContractSha256: sha(`acceptance-${lane}`),
    region: "EU-RO-1",
    gpu: "NVIDIA GeForce RTX 4090",
    max1GateConfigSha256: sha(`max1-config-${lane}`),
    max1EndpointProfileSha256: sha(`max1-profile-${lane}`),
    max2GateConfigSha256: sha(`max2-config-${lane}`),
    max2EndpointProfileSha256: sha(`max2-profile-${lane}`),
  };
}

function laneEvidence(lane: ServerlessLane) {
  const sealed = lineage(lane);
  return {
    deploymentId: `deployment-${lane}`,
    qualificationArtifactSha256: sha(`qualification-artifact-${lane}`),
    lineage: sealed,
    baseline: {
      configuredMaxWorkers: 1 as const,
      activeWorkers: 0 as const,
      qualification: "MAX1_VERIFIED" as const,
    },
    active: {
      configuredMaxWorkers: 2 as const,
      activeWorkers: 2 as const,
      qualification: "MAX2_VERIFIED" as const,
    },
    restored: {
      configuredMaxWorkers: 1 as const,
      activeWorkers: 0 as const,
      qualification: "MAX1_VERIFIED" as const,
    },
    volumeReadback: {
      mountPath: "/runpod-volume" as const,
      readOnly: true as const,
      crossMountDetected: false as const,
      manifestSha256Before: sealed.volumeManifestSha256,
      manifestSha256After: sealed.volumeManifestSha256,
    },
  };
}

function attempt(account: "a" | "b", lane: ServerlessLane, index: number) {
  const sealed = lineage(lane);
  const laneName = lane === "mage_image" ? "mage" : "soulx";
  const id = `${account}-${laneName}`;
  return {
    accountId: `account-${account}`,
    workspaceId: `workspace-${account}`,
    lane,
    attemptId: `attempt-${id}`,
    providerJobId: `provider-job-${id}`,
    deploymentId: `deployment-${lane}`,
    endpointIdSha256: sealed.endpointIdSha256,
    endpointConfigSha256: sealed.endpointConfigSha256,
    workerImageDigest: sealed.workerImageDigest,
    modelManifestSha256: sealed.modelManifestSha256,
    volumeIdSha256: sealed.volumeIdSha256,
    volumeManifestSha256: sealed.volumeManifestSha256,
    bindingSha256: sha(`binding-${id}`),
    expectedObjectSetSha256: sha(`objects-${id}`),
    barrierOutcome: "LANE_COMPLETED" as const,
    barrierAcceptanceSha256: sha(`barrier-${id}`),
    durableOutputReceiptSha256: sha(`durable-output-${id}`),
    readerId: `reader-${id}`,
    readerReceiptSha256: sha(`reader-receipt-${id}`),
    readerState: "SUCCEEDED" as const,
    readerDeploymentId: `deployment-${lane}`,
    readerVolumeIdSha256: sealed.volumeIdSha256,
    readerVolumeManifestSha256: sealed.volumeManifestSha256,
    readerMountPath: "/runpod-volume" as const,
    readerReadOnlyMount: true as const,
    readerCrossMountDetected: false as const,
    readerStartedAt: `2026-08-25T10:00:0${index}.000Z`,
    readerCompletedAt: "2026-08-25T10:00:05.000Z",
  };
}

type MutableEvidence = {
  -readonly [K in keyof HostedV211VerifiedEvidence]: HostedV211VerifiedEvidence[K];
};

function evidence(mutate?: (value: MutableEvidence) => void): HostedV211VerifiedEvidence {
  const attempts = [
    attempt("a", "mage_image", 1),
    attempt("b", "mage_image", 2),
    attempt("a", "soulx_avatar", 1),
    attempt("b", "soulx_avatar", 2),
  ];
  const value = {
    verifierId: "videoforge-hosted-v211-evidence-verifier-v1" as const,
    accepted: true as const,
    canonicalEvidenceSha256: canonicalSha256(rawEvidence),
    verifierSignatureSha256: sha("signature"),
    signatureVerified: true as const,
    verifiedAt: "2026-08-25T10:01:00.000Z",
    expiresAt: "2026-08-25T11:00:00.000Z",
    transport: "RUNPOD_SERVERLESS_HOSTED" as const,
    admission: {
      accounts: [
        {
          accountId: "account-a",
          workspaceId: "workspace-a",
          waitingVideoCountBefore: 1,
          waitingPreviewCountBefore: 1,
          activeVideoCountAfter: 1,
          waitingPreviewCountAfter: 1,
        },
        {
          accountId: "account-b",
          workspaceId: "workspace-b",
          waitingVideoCountBefore: 1,
          waitingPreviewCountBefore: 1,
          activeVideoCountAfter: 1,
          waitingPreviewCountAfter: 1,
        },
      ],
      promotions: [
        {
          accountId: "account-a",
          workspaceId: "workspace-a",
          requestKind: "VIDEO" as const,
          slot: 1 as const,
        },
        {
          accountId: "account-b",
          workspaceId: "workspace-b",
          requestKind: "VIDEO" as const,
          slot: 2 as const,
        },
      ],
      activeLeaseCount: 2,
      activeAccountIds: ["account-a", "account-b"],
      settlementPromotedRequestIds: [],
      finalActiveLeaseCount: 0,
    },
    lanes: { mage_image: laneEvidence("mage_image"), soulx_avatar: laneEvidence("soulx_avatar") },
    attempts,
    terminalProviderJobIds: attempts.map((item) => item.providerJobId),
  } satisfies HostedV211VerifiedEvidence;
  mutate?.(value as unknown as MutableEvidence);
  return value;
}

function evaluate(
  verified = evidence(),
  now: () => Date = () => new Date("2026-08-25T10:02:00.000Z"),
) {
  return evaluateHostedV211Groundwork({
    rawEvidence,
    evidenceVerifier: {
      async verify() {
        return verified;
      },
    },
    now,
  });
}

function expectCode(promise: Promise<unknown>, code: string) {
  return expect(promise).rejects.toMatchObject({ code });
}

describe("hosted V2-11 pure groundwork evaluator", () => {
  it("accepts exact immutable two-account, two-lane captured evidence", async () => {
    await expect(evaluate()).resolves.toMatchObject({
      groundworkOnly: true,
      liveAcceptanceClaimed: false,
      accountIds: ["account-a", "account-b"],
      activeSlots: [1, 2],
      restoredMaxWorkers: 1,
      finalActiveWorkers: 0,
    });
  });

  it("uses the injected trusted clock and rejects historically fresh caller evidence", async () => {
    await expectCode(
      evaluate(evidence(), () => new Date("2026-08-26T12:00:00.000Z")),
      "V211_EVIDENCE_INVALID",
    );
  });

  it("rejects a forged canonical verifier digest", async () => {
    await expectCode(
      evaluate(
        evidence((value) => {
          value.canonicalEvidenceSha256 = sha("forged");
        }),
      ),
      "V211_EVIDENCE_INVALID",
    );
  });

  it("passes an immutable captured document to the verifier", async () => {
    const verified = evidence();
    await expectCode(
      evaluateHostedV211Groundwork({
        rawEvidence,
        evidenceVerifier: {
          async verify(document) {
            (document as { evidence_id: string }).evidence_id = "mutated";
            return verified;
          },
        },
        now: () => new Date("2026-08-25T10:02:00.000Z"),
      }),
      "V211_EVIDENCE_INVALID",
    );
  });

  it("rejects fake transport", async () => {
    await expectCode(
      evaluate(
        evidence((value) => {
          (value as { transport: string }).transport = "FAKE";
        }),
      ),
      "V211_FAKE_TRANSPORT_FORBIDDEN",
    );
  });

  it("rejects cross-workspace promotion", async () => {
    await expectCode(
      evaluate(
        evidence((value) => {
          (value.admission.promotions[1] as { workspaceId: string }).workspaceId = "workspace-a";
        }),
      ),
      "V211_FAIRNESS_INVALID",
    );
  });

  it("rejects duplicate active slots", async () => {
    await expectCode(
      evaluate(
        evidence((value) => {
          (value.admission.promotions[0] as { slot: number }).slot = 2;
        }),
      ),
      "V211_FAIRNESS_INVALID",
    );
  });

  it("requires four distinct durable output receipt hashes", async () => {
    await expectCode(
      evaluate(
        evidence((value) => {
          (value.attempts[1] as { durableOutputReceiptSha256: Sha256 }).durableOutputReceiptSha256 =
            value.attempts[0]!.durableOutputReceiptSha256;
        }),
      ),
      "V211_OUTPUT_NOT_DURABLE",
    );
  });

  it("rejects attempt deployment lineage drift", async () => {
    await expectCode(
      evaluate(
        evidence((value) => {
          (value.attempts[0] as { endpointConfigSha256: Sha256 }).endpointConfigSha256 =
            sha("drift");
        }),
      ),
      "V211_LINEAGE_DRIFT",
    );
  });

  it("rejects reader volume drift from sealed lane lineage", async () => {
    await expectCode(
      evaluate(
        evidence((value) => {
          (value.attempts[0] as { readerVolumeIdSha256: Sha256 }).readerVolumeIdSha256 =
            sha("foreign-volume");
        }),
      ),
      "V211_READER_INVALID",
    );
  });

  it("rejects writable or cross-mounted reader evidence", async () => {
    await expectCode(
      evaluate(
        evidence((value) => {
          (value.attempts[0] as { readerReadOnlyMount: boolean }).readerReadOnlyMount = false;
        }),
      ),
      "V211_READER_INVALID",
    );
  });

  it("requires two overlapping readers on each lane", async () => {
    await expectCode(
      evaluate(
        evidence((value) => {
          (value.attempts[1] as { readerStartedAt: string }).readerStartedAt =
            "2026-08-25T10:00:06.000Z";
        }),
      ),
      "V211_READER_INVALID",
    );
  });

  it("blocks final zero when settlement evidence promoted new work", async () => {
    await expectCode(
      evaluate(
        evidence((value) => {
          (value.admission.settlementPromotedRequestIds as string[]).push("request-next");
        }),
      ),
      "V211_MAX1_RESTORE_INVALID",
    );
  });
});

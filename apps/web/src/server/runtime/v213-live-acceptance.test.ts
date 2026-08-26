import { canonicalSha256, type ServerlessLane, type Sha256 } from "@videoforge/control-plane";
import { describe, expect, it, vi } from "vitest";

import type { HostedQualificationLineage } from "./hosted-serverless-runtime.js";
import type { HostedV211VerifiedEvidence } from "./hosted-v211-acceptance-coordinator.js";
import {
  createV213LiveAcceptanceAdapter,
  executeV211LiveConcurrency,
  verifyV213LiveReceipt,
  type V213CleanupVerification,
  type V213LiveAttemptStore,
  type V213LiveConsumedClaim,
  type V213LiveExecutionRequest,
  type V213LiveVerifiedReceipt,
} from "./v213-live-acceptance.js";

const sha = (label: string): Sha256 => canonicalSha256({ label });
const rawEvidence = Object.freeze({ schema_version: "v211-live/v1", id: "capture-1" });
const receiptArtifact = Object.freeze({ schema_version: "v213-live-receipt/v1", id: "receipt-1" });
const cleanupArtifact = Object.freeze({ schema_version: "v213-cleanup/v1", id: "cleanup-1" });

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
    qualificationArtifactSha256: sha(`qualification-${lane}`),
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

function attempt(account: "a" | "b", lane: ServerlessLane, second: number) {
  const sealed = lineage(lane);
  const suffix = `${account}-${lane}`;
  return {
    accountId: `account-${account}`,
    workspaceId: `workspace-${account}`,
    lane,
    attemptId: `attempt-${suffix}`,
    providerJobId: `job-${suffix}`,
    deploymentId: `deployment-${lane}`,
    endpointIdSha256: sealed.endpointIdSha256,
    endpointConfigSha256: sealed.endpointConfigSha256,
    workerImageDigest: sealed.workerImageDigest,
    modelManifestSha256: sealed.modelManifestSha256,
    volumeIdSha256: sealed.volumeIdSha256,
    volumeManifestSha256: sealed.volumeManifestSha256,
    bindingSha256: sha(`binding-${suffix}`),
    expectedObjectSetSha256: sha(`objects-${suffix}`),
    barrierOutcome: "LANE_COMPLETED" as const,
    barrierAcceptanceSha256: sha(`barrier-${suffix}`),
    durableOutputReceiptSha256: sha(`output-${suffix}`),
    readerId: `reader-${suffix}`,
    readerReceiptSha256: sha(`reader-${suffix}`),
    readerState: "SUCCEEDED" as const,
    readerDeploymentId: `deployment-${lane}`,
    readerVolumeIdSha256: sealed.volumeIdSha256,
    readerVolumeManifestSha256: sealed.volumeManifestSha256,
    readerMountPath: "/runpod-volume" as const,
    readerReadOnlyMount: true as const,
    readerCrossMountDetected: false as const,
    readerStartedAt: `2026-08-26T00:00:0${second}.000Z`,
    readerCompletedAt: "2026-08-26T00:00:05.000Z",
  };
}

function verifiedEvidence(): HostedV211VerifiedEvidence {
  const attempts = [
    attempt("a", "mage_image", 1),
    attempt("b", "mage_image", 2),
    attempt("a", "soulx_avatar", 1),
    attempt("b", "soulx_avatar", 2),
  ];
  return {
    verifierId: "videoforge-hosted-v211-evidence-verifier-v1",
    accepted: true,
    canonicalEvidenceSha256: canonicalSha256(rawEvidence),
    verifierSignatureSha256: sha("v211-signature"),
    signatureVerified: true,
    verifiedAt: "2026-08-26T00:01:00.000Z",
    expiresAt: "2026-08-26T01:00:00.000Z",
    transport: "RUNPOD_SERVERLESS_HOSTED",
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
        { accountId: "account-a", workspaceId: "workspace-a", requestKind: "VIDEO", slot: 1 },
        { accountId: "account-b", workspaceId: "workspace-b", requestKind: "VIDEO", slot: 2 },
      ],
      activeLeaseCount: 2,
      activeAccountIds: ["account-a", "account-b"],
      settlementPromotedRequestIds: [],
      finalActiveLeaseCount: 0,
    },
    lanes: { mage_image: laneEvidence("mage_image"), soulx_avatar: laneEvidence("soulx_avatar") },
    attempts,
    terminalProviderJobIds: attempts.map((value) => value.providerJobId),
  };
}

const request: V213LiveExecutionRequest & { readonly checkpoint: "V2-11" } = {
  checkpoint: "V2-11",
  executionId: "v211-live-1",
  proposalSha256: sha("fresh-v3-proposal"),
  authoritySha256: sha("authority"),
  approvalRecordSha256: sha("approval-record"),
  cumulativeLedgerSha256: sha("cumulative-ledger"),
  executorSha256: sha("executor"),
  promotionDecisionSha256: sha("promotion-v3"),
  sourceCommit: "b".repeat(40),
  maximumVariableCostMicroUsd: 4_000_000,
  maximumCumulativeVariableCostMicroUsd: 17_500_000,
  billingBaselineMicroUsd: 2_000_000,
  cumulativeLedgerSpentBeforeMicroUsd: 9_000_000,
  retainedVolumeIdSha256s: { mage: sha("mage-volume"), soulx: sha("soulx-volume") },
  noRedispatch: true,
  scopes: [
    {
      accountId: "account-a",
      workspaceId: "workspace-a",
      projectId: "project-a",
      projectRevisionId: "revision-a",
      requestSha256: sha("request-a"),
      attemptId: "attempt-project-a",
    },
    {
      accountId: "account-b",
      workspaceId: "workspace-b",
      projectId: "project-b",
      projectRevisionId: "revision-b",
      requestSha256: sha("request-b"),
      attemptId: "attempt-project-b",
    },
  ],
};

function verifiedReceipt(
  overrides: Partial<V213LiveVerifiedReceipt> = {},
): V213LiveVerifiedReceipt {
  return {
    verifierId: "videoforge-v213-live-execution-receipt-verifier-v1",
    accepted: true,
    canonicalArtifactSha256: canonicalSha256(receiptArtifact),
    verifierSignatureSha256: sha("receipt-signature"),
    signatureVerified: true,
    transport: "CLOUDFLARE_HOSTED_RUNPOD_SERVERLESS",
    checkpoint: "V2-11",
    executionId: request.executionId,
    proposalSha256: request.proposalSha256,
    authoritySha256: request.authoritySha256,
    approvalRecordSha256: request.approvalRecordSha256,
    approvalConsumed: true,
    cumulativeLedgerSha256: request.cumulativeLedgerSha256,
    executorSha256: request.executorSha256,
    promotionDecisionSha256: request.promotionDecisionSha256,
    sourceCommit: request.sourceCommit,
    scopes: request.scopes,
    rawEvidenceSha256: canonicalSha256(rawEvidence),
    projectDispatchCount: 2,
    mageDispatchCount: 2,
    soulxDispatchCount: 2,
    noRedispatch: true,
    phaseCapMicroUsd: 4_000_000,
    cumulativeCapMicroUsd: 17_500_000,
    billingBaselineMicroUsd: 2_000_000,
    billingFinalMicroUsd: 3_000_000,
    cumulativeLedgerSpentMicroUsd: 10_000_000,
    variableCostMicroUsd: 1_000_000,
    possibleDuplicateCostMicroUsd: 0,
    billingSettled: true,
    terminalProviderJobIds: [
      "job-a-mage_image",
      "job-b-mage_image",
      "job-a-soulx_avatar",
      "job-b-soulx_avatar",
    ],
    endpointJobs: 0,
    mageWorkers: 0,
    soulxWorkers: 0,
    maxWorkersRestored: 1,
    unknownLiabilities: 0,
    retainedVolumes: {
      mage: {
        volumeIdSha256: sha("mage-volume"),
        manifestBeforeSha256: sha("mage-manifest"),
        manifestAfterSha256: sha("mage-manifest"),
      },
      soulx: {
        volumeIdSha256: sha("soulx-volume"),
        manifestBeforeSha256: sha("soulx-manifest"),
        manifestAfterSha256: sha("soulx-manifest"),
      },
    },
    zeroWorkerReads: [
      {
        evidenceSha256: sha("zero-1"),
        observedAt: "2026-08-26T00:01:56.000Z",
        endpointJobs: 0,
        mageWorkers: 0,
        soulxWorkers: 0,
      },
      {
        evidenceSha256: sha("zero-2"),
        observedAt: "2026-08-26T00:01:58.000Z",
        endpointJobs: 0,
        mageWorkers: 0,
        soulxWorkers: 0,
      },
      {
        evidenceSha256: sha("zero-3"),
        observedAt: "2026-08-26T00:02:00.000Z",
        endpointJobs: 0,
        mageWorkers: 0,
        soulxWorkers: 0,
      },
    ],
    operatorIntervention: false,
    outputCommittedAt: "2026-08-26T00:01:00.000Z",
    realChromePlaybackPassed: false,
    chromePlaybackReceiptSha256: null,
    chromePlaybackObservedAt: null,
    userVisualDecision: "NOT_APPLICABLE",
    userVisualDecisionReceiptSha256: null,
    userVisualDecisionObservedAt: null,
    sameAccountSecondJobWaited: true,
    sameAccountWaitingRequestSha256: sha("same-account-waiter"),
    thirdAccountWaited: true,
    thirdAccountId: "account-c",
    thirdAccountWaitingRequestSha256: sha("third-account-waiter"),
    fairPromotionPassed: true,
    failureRecoveryExercised: true,
    failureRecoveryReceiptSha256: sha("failure-recovery"),
    ownershipIsolated: true,
    ownershipIsolationReceiptSha256: sha("ownership-isolation"),
    observedAt: "2026-08-26T00:02:00.000Z",
    ...overrides,
  };
}

function cleanup(): V213CleanupVerification {
  return {
    verifierId: "videoforge-v213-live-cleanup-verifier-v1",
    accepted: true,
    canonicalArtifactSha256: canonicalSha256(cleanupArtifact),
    verifierSignatureSha256: sha("cleanup-signature"),
    signatureVerified: true,
    checkpoint: "V2-11",
    executionId: request.executionId,
    authoritySha256: request.authoritySha256,
    sourceCommit: request.sourceCommit,
    cancelOnly: true,
    redispatchCount: 0,
    endpointJobs: 0,
    mageWorkers: 0,
    soulxWorkers: 0,
    maxWorkersRestored: 1,
    unknownLiabilities: 0,
    retainedVolumes: verifiedReceipt().retainedVolumes,
    zeroWorkerReads: verifiedReceipt().zeroWorkerReads,
    observedAt: verifiedReceipt().observedAt,
  };
}

function harness(
  options: {
    claim?: boolean;
    receipt?: V213LiveVerifiedReceipt;
    cleanup?: V213CleanupVerification;
    request?: V213LiveExecutionRequest & { readonly checkpoint: "V2-11" };
    claimTransform?: (claim: V213LiveConsumedClaim) => V213LiveConsumedClaim;
  } = {},
) {
  const store: V213LiveAttemptStore = {
    claimOnce: vi.fn(async (requestSha256, claimedRequest) =>
      options.claim === false
        ? null
        : (options.claimTransform?.({
            requestSha256,
            proposalSha256: claimedRequest.proposalSha256,
            authoritySha256: claimedRequest.authoritySha256,
            approvalRecordSha256: claimedRequest.approvalRecordSha256,
            approvalConsumed: true as const,
            cumulativeLedgerSha256: claimedRequest.cumulativeLedgerSha256,
            executorSha256: claimedRequest.executorSha256,
            promotionDecisionSha256: claimedRequest.promotionDecisionSha256,
            promotionVersion: "V3" as const,
            promotionState: "CONSUMED_CURRENT" as const,
            sourceCommit: claimedRequest.sourceCommit,
            cumulativeLedgerSpentBeforeMicroUsd: claimedRequest.cumulativeLedgerSpentBeforeMicroUsd,
            billingBaselineMicroUsd: claimedRequest.billingBaselineMicroUsd,
            claimedAt: "2026-08-26T00:01:55.000Z",
            expiresAt: "2026-08-26T00:07:00.000Z",
          }) ?? {
            requestSha256,
            proposalSha256: claimedRequest.proposalSha256,
            authoritySha256: claimedRequest.authoritySha256,
            approvalRecordSha256: claimedRequest.approvalRecordSha256,
            approvalConsumed: true as const,
            cumulativeLedgerSha256: claimedRequest.cumulativeLedgerSha256,
            executorSha256: claimedRequest.executorSha256,
            promotionDecisionSha256: claimedRequest.promotionDecisionSha256,
            promotionVersion: "V3" as const,
            promotionState: "CONSUMED_CURRENT" as const,
            sourceCommit: claimedRequest.sourceCommit,
            cumulativeLedgerSpentBeforeMicroUsd: claimedRequest.cumulativeLedgerSpentBeforeMicroUsd,
            billingBaselineMicroUsd: claimedRequest.billingBaselineMicroUsd,
            claimedAt: "2026-08-26T00:01:55.000Z",
            expiresAt: "2026-08-26T00:07:00.000Z",
          }),
    ),
    complete: vi.fn(async () => true),
    recordTerminalFailure: vi.fn(async () => true),
  };
  const cancelAndReconcile = vi.fn(async () => ({ cleanupArtifact }));
  const execute = () =>
    executeV211LiveConcurrency({
      request: options.request ?? request,
      store,
      transport: {
        kind: "CLOUDFLARE_HOSTED_RUNPOD_SERVERLESS",
        execute: vi.fn(async () => ({ rawEvidence, receiptArtifact })),
        cancelAndReconcile,
      },
      receiptVerifier: { verify: vi.fn(async () => options.receipt ?? verifiedReceipt()) },
      cleanupVerifier: { verify: vi.fn(async () => options.cleanup ?? cleanup()) },
      evidenceVerifier: { verify: vi.fn(async () => verifiedEvidence()) },
      now: () => new Date("2026-08-26T00:02:00.000Z"),
    });
  return { execute, store, cancelAndReconcile };
}

describe("V2-10 through V2-13 concrete live acceptance coordinator", () => {
  it.each([
    ["V2-10", 2_000_000],
    ["V2-12", 2_000_000],
    ["V2-13", 2_000_000],
  ] as const)(
    "verifies exact %s cap, authority, billing, volume, and zero reads",
    async (checkpoint, cap) => {
      const phaseRequest: V213LiveExecutionRequest = {
        ...request,
        checkpoint,
        maximumVariableCostMicroUsd: cap,
        scopes: [request.scopes[0]!],
      };
      const phaseReceipt: V213LiveVerifiedReceipt = {
        ...verifiedReceipt(),
        checkpoint,
        scopes: phaseRequest.scopes,
        phaseCapMicroUsd: cap,
        projectDispatchCount: 1,
        mageDispatchCount: 1,
        soulxDispatchCount: 1,
        terminalProviderJobIds: ["job-mage", "job-soulx"],
        realChromePlaybackPassed: checkpoint === "V2-10",
        chromePlaybackReceiptSha256: checkpoint === "V2-10" ? sha("chrome") : null,
        chromePlaybackObservedAt: checkpoint === "V2-10" ? "2026-08-26T00:01:30.000Z" : null,
        userVisualDecision:
          checkpoint === "V2-10" || checkpoint === "V2-12" ? "ACCEPTED" : "NOT_APPLICABLE",
        userVisualDecisionReceiptSha256:
          checkpoint === "V2-10" || checkpoint === "V2-12" ? sha("user-decision") : null,
        userVisualDecisionObservedAt:
          checkpoint === "V2-10" || checkpoint === "V2-12" ? "2026-08-26T00:01:40.000Z" : null,
        sameAccountSecondJobWaited: false,
        sameAccountWaitingRequestSha256: null,
        thirdAccountWaited: false,
        thirdAccountId: null,
        thirdAccountWaitingRequestSha256: null,
        fairPromotionPassed: false,
        failureRecoveryExercised: false,
        failureRecoveryReceiptSha256: null,
        ownershipIsolated: false,
        ownershipIsolationReceiptSha256: null,
      };
      await expect(
        verifyV213LiveReceipt({
          request: phaseRequest,
          capture: { rawEvidence, receiptArtifact },
          verifier: { verify: async () => phaseReceipt },
          expectedProjectDispatchCount: 1,
          expectedMageDispatchCount: 1,
          expectedSoulxDispatchCount: 1,
          now: () => new Date("2026-08-26T00:02:00.000Z"),
        }),
      ).resolves.toMatchObject({ checkpoint, phaseCapMicroUsd: cap, approvalConsumed: true });
    },
  );

  it("accepts exact V2-11 hosted max2 evidence, restores max1, and records completion", async () => {
    const value = harness();
    await expect(value.execute()).resolves.toMatchObject({
      liveAcceptanceClaimed: true,
      acceptance: {
        accountIds: ["account-a", "account-b"],
        restoredMaxWorkers: 1,
        finalActiveWorkers: 0,
      },
    });
    expect(value.store.complete).toHaveBeenCalledOnce();
    expect(value.cancelAndReconcile).not.toHaveBeenCalled();
  });

  it("rejects a consumed request before external execution", async () => {
    const value = harness({ claim: false });
    await expect(value.execute()).rejects.toMatchObject({
      code: "LIVE_ACCEPTANCE_REPLAY_FORBIDDEN",
    });
    expect(value.cancelAndReconcile).not.toHaveBeenCalled();
  });

  it("rejects a superseded V2 promotion claim before external execution", async () => {
    const value = harness({
      claimTransform: (claim) => ({ ...claim, promotionVersion: "V2" as never }),
    });
    await expect(value.execute()).rejects.toMatchObject({
      code: "LIVE_ACCEPTANCE_REPLAY_FORBIDDEN",
    });
    expect(value.cancelAndReconcile).not.toHaveBeenCalled();
  });

  it("rejects fresh V3 claim lineage drift before external execution", async () => {
    const value = harness({
      claimTransform: (claim) => ({ ...claim, executorSha256: sha("foreign-executor") }),
    });
    await expect(value.execute()).rejects.toMatchObject({
      code: "LIVE_ACCEPTANCE_REPLAY_FORBIDDEN",
    });
    expect(value.cancelAndReconcile).not.toHaveBeenCalled();
  });

  it("exposes one production composition adapter for checkpoint executors", async () => {
    const value = harness();
    const direct = value.execute;
    const dependencies = {
      store: value.store,
      transport: {
        kind: "CLOUDFLARE_HOSTED_RUNPOD_SERVERLESS" as const,
        execute: vi.fn(async () => ({ rawEvidence, receiptArtifact })),
        cancelAndReconcile: value.cancelAndReconcile,
      },
      receiptVerifier: { verify: vi.fn(async () => verifiedReceipt()) },
      cleanupVerifier: { verify: vi.fn(async () => cleanup()) },
      now: () => new Date("2026-08-26T00:02:00.000Z"),
    };
    const adapter = createV213LiveAcceptanceAdapter(dependencies);
    expect(Object.keys(adapter).sort()).toEqual([
      "executeV210",
      "executeV211",
      "executeV212",
      "executeV213",
    ]);
    await expect(
      adapter.executeV211({
        request,
        evidenceVerifier: { verify: async () => verifiedEvidence() },
      }),
    ).resolves.toMatchObject({ summary: { projectCount: 2, concurrent: true } });
    expect(direct).toBeTypeOf("function");
  });

  it("rejects any non-exact phase or cumulative cap before external execution", async () => {
    const value = harness({
      request: { ...request, maximumVariableCostMicroUsd: 3_999_999 },
    });
    await expect(value.execute()).rejects.toMatchObject({ code: "LIVE_ACCEPTANCE_SCOPE_INVALID" });
    expect(value.cancelAndReconcile).not.toHaveBeenCalled();
  });

  it("fails closed on project identity drift and performs cancel-only zero-worker cleanup", async () => {
    const drifted = request.scopes.map((scope, index) =>
      index ? scope : { ...scope, projectId: "foreign-project" },
    );
    const value = harness({ receipt: verifiedReceipt({ scopes: drifted }) });
    await expect(value.execute()).rejects.toMatchObject({ code: "LIVE_ACCEPTANCE_IDENTITY_DRIFT" });
    expect(value.cancelAndReconcile).toHaveBeenCalledOnce();
    expect(value.store.recordTerminalFailure).toHaveBeenCalledOnce();
  });

  it("refuses to mask a failed or incomplete cleanup after an acceptance failure", async () => {
    const value = harness({
      receipt: verifiedReceipt({ rawEvidenceSha256: sha("drift") }),
      cleanup: { ...cleanup(), mageWorkers: 1 as never },
    });
    await expect(value.execute()).rejects.toMatchObject({
      code: "LIVE_ACCEPTANCE_CLEANUP_UNPROVEN",
    });
  });

  it.each([
    ["phase cap", verifiedReceipt({ phaseCapMicroUsd: 3_999_999 }), "LIVE_ACCEPTANCE_COST_INVALID"],
    [
      "authority",
      verifiedReceipt({ approvalRecordSha256: sha("foreign-approval") }),
      "LIVE_ACCEPTANCE_IDENTITY_DRIFT",
    ],
    [
      "cumulative ledger",
      verifiedReceipt({ cumulativeLedgerSha256: sha("foreign-ledger") }),
      "LIVE_ACCEPTANCE_IDENTITY_DRIFT",
    ],
    [
      "billing",
      verifiedReceipt({ billingFinalMicroUsd: 3_000_001 }),
      "LIVE_ACCEPTANCE_COST_INVALID",
    ],
    [
      "retained volume",
      verifiedReceipt({
        retainedVolumes: {
          ...verifiedReceipt().retainedVolumes,
          mage: {
            ...verifiedReceipt().retainedVolumes.mage,
            manifestAfterSha256: sha("changed"),
          },
        },
      }),
      "LIVE_ACCEPTANCE_NOT_TERMINAL",
    ],
    [
      "stable zero reads",
      verifiedReceipt({
        zeroWorkerReads: [
          verifiedReceipt().zeroWorkerReads[0],
          verifiedReceipt().zeroWorkerReads[1],
          { ...verifiedReceipt().zeroWorkerReads[2], observedAt: "2026-08-26T00:01:58.000Z" },
        ],
      }),
      "LIVE_ACCEPTANCE_NOT_TERMINAL",
    ],
  ] as const)("fails closed on %s drift", async (_label, receipt, expectedCode) => {
    const value = harness({ receipt });
    await expect(value.execute()).rejects.toMatchObject({ code: expectedCode });
    expect(value.store.recordTerminalFailure).toHaveBeenCalledOnce();
  });
});

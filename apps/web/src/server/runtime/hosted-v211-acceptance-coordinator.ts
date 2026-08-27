import { canonicalSha256, type ServerlessLane, type Sha256 } from "@videoforge/control-plane";

import type { HostedQualificationLineage } from "./hosted-serverless-runtime.js";

export type HostedV211AcceptanceErrorCode =
  | "V211_ACCOUNTS_NOT_EXACT"
  | "V211_FAIRNESS_INVALID"
  | "V211_CAPACITY_INVALID"
  | "V211_FAKE_TRANSPORT_FORBIDDEN"
  | "V211_PROVENANCE_INVALID"
  | "V211_OUTPUT_NOT_DURABLE"
  | "V211_MAX1_RESTORE_INVALID"
  | "V211_EVIDENCE_INVALID"
  | "V211_LINEAGE_DRIFT";

export class HostedV211AcceptanceError extends Error {
  constructor(readonly code: HostedV211AcceptanceErrorCode) {
    super(code);
    this.name = "HostedV211AcceptanceError";
  }
}

export interface HostedV211VerifiedAttemptEvidence {
  readonly accountId: string;
  readonly workspaceId: string;
  readonly generationRequestId: string;
  readonly lane: ServerlessLane;
  readonly attemptId: string;
  readonly providerJobId: string;
  readonly deploymentId: string;
  readonly endpointIdSha256: Sha256;
  readonly endpointConfigSha256: Sha256;
  readonly workerImageDigest: Sha256;
  readonly modelManifestSha256: Sha256;
  readonly volumeIdSha256: Sha256;
  readonly volumeManifestSha256: Sha256;
  readonly bindingSha256: Sha256;
  readonly expectedObjectSetSha256: Sha256;
  readonly barrierOutcome: "LANE_COMPLETED";
  readonly barrierAcceptanceSha256: Sha256;
  readonly durableOutputReceiptSha256: Sha256;
  readonly workerId: string;
  readonly provenanceReceiptSha256: Sha256;
  readonly provenanceReceiptHmacVerified: true;
  readonly volumeManifestSha256Before: Sha256;
  readonly volumeManifestSha256After: Sha256;
  readonly volumeMutationDetected: false;
  readonly crossMountDetected: false;
  readonly scratchRemoved: true;
  readonly scratchOnModelVolume: false;
  /** Exact `provider_progress.observed_at` for a persisted `IN_PROGRESS` row. */
  readonly providerProgressState: "IN_PROGRESS";
  readonly providerProgressObservedAt: string;
  /** Exact terminal timestamp persisted on the bound attempt row. */
  readonly attemptTerminalAt: string;
}

export interface HostedV211VerifiedEvidence {
  readonly verifierId: "videoforge-hosted-v211-evidence-verifier-v1";
  readonly accepted: true;
  readonly canonicalEvidenceSha256: Sha256;
  readonly verifierSignatureSha256: Sha256;
  readonly signatureVerified: true;
  readonly verifiedAt: string;
  readonly expiresAt: string;
  readonly transport: "RUNPOD_SERVERLESS_HOSTED";
  readonly admission: {
    readonly accounts: readonly {
      readonly accountId: string;
      readonly workspaceId: string;
      readonly waitingVideoCountBefore: number;
      readonly activeVideoCountAfter: number;
    }[];
    readonly promotions: readonly {
      readonly accountId: string;
      readonly workspaceId: string;
      readonly requestKind: "VIDEO" | "PRESET_PREVIEW";
      readonly slot: 1 | 2;
    }[];
    readonly activeLeaseCount: number;
    readonly activeAccountIds: readonly string[];
    readonly settlementPromotedRequestIds: readonly string[];
    readonly finalActiveLeaseCount: number;
    readonly scenario: {
      readonly primaryGenerationRequestId: string;
      readonly primaryProjectId: string;
      readonly primaryProjectRevisionId: string;
      readonly secondaryGenerationRequestId: string;
      readonly secondaryProjectId: string;
      readonly secondaryProjectRevisionId: string;
      readonly sameAccountWaiter: {
        readonly accountId: string;
        readonly workspaceId: string;
        readonly projectId: string;
        readonly projectRevisionId: string;
        readonly generationRequestId: string;
        readonly waitingObserved: true;
        readonly queueAuditReceiptSha256: Sha256;
      };
      readonly fairnessProbe: {
        readonly accountId: string;
        readonly workspaceId: string;
        readonly projectId: string;
        readonly projectRevisionId: string;
        readonly generationRequestId: string;
        readonly waitingObserved: true;
        readonly queueAuditReceiptSha256: Sha256;
      };
      readonly fairPromotion: {
        readonly generationRequestId: string;
        readonly promotionReceiptSha256: Sha256;
        readonly sameAccountWaiterRemainedWaiting: true;
      };
      readonly cancellationRecovery: {
        readonly cancelAuthorizationReceiptSha256: Sha256;
        readonly cancelReconciliationReceiptSha256: Sha256;
        readonly providerDispatchFenced: boolean;
        readonly providerRaceReconciled: boolean;
        readonly providerRaceActualUsd: number;
        readonly providerRaceJobId: string | null;
        readonly providerRaceReceiptSha256: Sha256 | null;
        readonly terminalState: "CANCELLED";
        readonly activeLeaseAbsent: true;
      };
      readonly tenantIsolation: {
        readonly denied: true;
        readonly denialReceiptSha256: Sha256;
      };
    };
  };
  readonly lanes: Readonly<
    Record<
      ServerlessLane,
      {
        readonly deploymentId: string;
        readonly qualificationArtifactSha256: Sha256;
        readonly lineage: HostedQualificationLineage;
        readonly baseline: {
          readonly configuredMaxWorkers: 1;
          readonly activeWorkers: 0;
          readonly qualification: "MAX1_VERIFIED";
        };
        readonly active: {
          readonly configuredMaxWorkers: 2;
          readonly activeWorkers: 2;
          readonly qualification: "MAX2_VERIFIED";
          readonly policyReceiptSha256: Sha256;
        };
        readonly restored: {
          readonly configuredMaxWorkers: 1;
          readonly activeWorkers: 0;
          readonly qualification: "MAX1_VERIFIED";
          readonly policyReceiptSha256: Sha256;
        };
        readonly volumeReadback: {
          readonly crossMountDetected: false;
          readonly mutationDetected: false;
          readonly manifestSha256Before: Sha256;
          readonly manifestSha256After: Sha256;
        };
      }
    >
  >;
  readonly attempts: readonly HostedV211VerifiedAttemptEvidence[];
  readonly terminalProviderJobIds: readonly string[];
}

export interface HostedV211EvidenceVerifier {
  /** Trusted boundary: verifies fixture branding, signature, and canonical captured document. */
  verify(rawEvidence: Readonly<Record<string, unknown>>): Promise<HostedV211VerifiedEvidence>;
}

export interface HostedV211AcceptanceResult {
  readonly groundworkOnly: true;
  readonly liveAcceptanceClaimed: false;
  readonly accountIds: readonly [string, string];
  readonly activeSlots: readonly [1 | 2, 1 | 2];
  readonly provenanceReceiptSha256s: readonly [Sha256, Sha256, Sha256, Sha256];
  readonly durableOutputReceiptSha256s: readonly [Sha256, Sha256, Sha256, Sha256];
  readonly terminalProviderJobIds: readonly [string, string, string, string];
  readonly restoredMaxWorkers: 1;
  readonly finalActiveWorkers: 0;
}

const REQUIRED_LANES = Object.freeze(["mage_image", "soulx_avatar"] as const);
const MAX_EVIDENCE_AGE_MS = 24 * 60 * 60 * 1_000;

function reject(code: HostedV211AcceptanceErrorCode): never {
  throw new HostedV211AcceptanceError(code);
}

function validSha(value: string): value is Sha256 {
  return /^sha256:[0-9a-f]{64}$/u.test(value);
}

function timestamp(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : null;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function exactLineage(lineage: HostedQualificationLineage, lane: ServerlessLane): boolean {
  const expectedKeys = [
    "acceptanceContractSha256",
    "endpointConfigSha256",
    "endpointIdSha256",
    "endpointTemplateIdSha256",
    "fullLiveAuthorityId",
    "gpu",
    "imageSourceCommit",
    "modelManifestSha256",
    "productionStageAuthorityId",
    "qualificationHandoffSha256",
    "qualificationSourceSha256",
    "receiptSha256s",
    "region",
    "schemaVersion",
    "stageAuthorityId",
    "volumeIdSha256",
    "volumeManifestSha256",
    "workerImageDigest",
  ];
  const receiptCount = lane === "mage_image" ? 1 : 4;
  return (
    Object.keys(lineage).sort().join(",") === expectedKeys.sort().join(",") &&
    lineage.schemaVersion === "videoforge.v213-qualified-deployment-lineage/v1" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      lineage.fullLiveAuthorityId,
    ) &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{7,319}$/u.test(lineage.stageAuthorityId) &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{7,319}$/u.test(lineage.productionStageAuthorityId) &&
    lineage.region === "EU-RO-1" &&
    lineage.gpu === "NVIDIA GeForce RTX 4090" &&
    /^[0-9a-f]{40}$/u.test(lineage.imageSourceCommit) &&
    [
      lineage.endpointIdSha256,
      lineage.endpointTemplateIdSha256,
      lineage.endpointConfigSha256,
      lineage.workerImageDigest,
      lineage.modelManifestSha256,
      lineage.volumeIdSha256,
      lineage.volumeManifestSha256,
      lineage.qualificationHandoffSha256,
      lineage.qualificationSourceSha256,
      lineage.acceptanceContractSha256,
    ].every(validSha) &&
    lineage.qualificationSourceSha256 === lineage.qualificationHandoffSha256 &&
    lineage.acceptanceContractSha256 === lineage.qualificationHandoffSha256 &&
    Array.isArray(lineage.receiptSha256s) &&
    lineage.receiptSha256s.length === receiptCount &&
    new Set(lineage.receiptSha256s).size === receiptCount &&
    lineage.receiptSha256s.every(validSha)
  );
}

function exactLaneEvidence(verified: HostedV211VerifiedEvidence): boolean {
  return REQUIRED_LANES.every((lane) => {
    const evidence = verified.lanes[lane];
    return (
      evidence.deploymentId.length > 0 &&
      validSha(evidence.qualificationArtifactSha256) &&
      exactLineage(evidence.lineage, lane) &&
      evidence.baseline.configuredMaxWorkers === 1 &&
      evidence.baseline.activeWorkers === 0 &&
      evidence.baseline.qualification === "MAX1_VERIFIED" &&
      evidence.active.configuredMaxWorkers === 2 &&
      evidence.active.activeWorkers === 2 &&
      evidence.active.qualification === "MAX2_VERIFIED" &&
      validSha(evidence.active.policyReceiptSha256) &&
      evidence.restored.configuredMaxWorkers === 1 &&
      evidence.restored.activeWorkers === 0 &&
      evidence.restored.qualification === "MAX1_VERIFIED" &&
      validSha(evidence.restored.policyReceiptSha256) &&
      evidence.volumeReadback.crossMountDetected === false &&
      evidence.volumeReadback.mutationDetected === false &&
      evidence.volumeReadback.manifestSha256Before === evidence.lineage.volumeManifestSha256 &&
      evidence.volumeReadback.manifestSha256After === evidence.lineage.volumeManifestSha256 &&
      evidence.volumeReadback.manifestSha256Before === evidence.volumeReadback.manifestSha256After
    );
  });
}

function intervalsOverlap(
  left: HostedV211VerifiedAttemptEvidence,
  right: HostedV211VerifiedAttemptEvidence,
  verifiedAt: number,
): boolean {
  const leftStart = timestamp(left.providerProgressObservedAt);
  const leftEnd = timestamp(left.attemptTerminalAt);
  const rightStart = timestamp(right.providerProgressObservedAt);
  const rightEnd = timestamp(right.attemptTerminalAt);
  return (
    left.providerProgressState === "IN_PROGRESS" &&
    right.providerProgressState === "IN_PROGRESS" &&
    leftStart !== null &&
    leftEnd !== null &&
    rightStart !== null &&
    rightEnd !== null &&
    leftStart < leftEnd &&
    rightStart < rightEnd &&
    leftEnd <= verifiedAt &&
    rightEnd <= verifiedAt &&
    leftStart < rightEnd &&
    rightStart < leftEnd
  );
}

/** Pure provider-free evaluator. It holds no admission, barrier, reader, dispatch, or provider port. */
export async function evaluateHostedV211Groundwork(input: {
  readonly rawEvidence: Readonly<Record<string, unknown>>;
  readonly evidenceVerifier: HostedV211EvidenceVerifier;
  /** Trusted clock owned by composition; evidence cannot supply or override it. */
  readonly now: () => Date;
}): Promise<HostedV211AcceptanceResult> {
  const current = input.now();
  const currentMs = current.getTime();
  if (!Number.isFinite(currentMs)) reject("V211_EVIDENCE_INVALID");

  let captured: Readonly<Record<string, unknown>>;
  let capturedSha256: Sha256;
  try {
    captured = deepFreeze(structuredClone(input.rawEvidence));
    capturedSha256 = canonicalSha256(captured);
  } catch {
    reject("V211_EVIDENCE_INVALID");
  }

  let verified: HostedV211VerifiedEvidence;
  try {
    verified = await input.evidenceVerifier.verify(captured);
  } catch {
    reject("V211_EVIDENCE_INVALID");
  }
  if ((verified as { readonly transport?: unknown }).transport === "FAKE") {
    reject("V211_FAKE_TRANSPORT_FORBIDDEN");
  }
  const verifiedAt = timestamp(verified.verifiedAt);
  const expiresAt = timestamp(verified.expiresAt);
  if (
    verified.verifierId !== "videoforge-hosted-v211-evidence-verifier-v1" ||
    verified.accepted !== true ||
    verified.transport !== "RUNPOD_SERVERLESS_HOSTED" ||
    verified.canonicalEvidenceSha256 !== capturedSha256 ||
    canonicalSha256(captured) !== capturedSha256 ||
    !validSha(verified.verifierSignatureSha256) ||
    verified.signatureVerified !== true ||
    verifiedAt === null ||
    expiresAt === null ||
    verifiedAt > currentMs ||
    currentMs - verifiedAt > MAX_EVIDENCE_AGE_MS ||
    expiresAt <= currentMs ||
    !exactLaneEvidence(verified)
  ) {
    reject("V211_EVIDENCE_INVALID");
  }

  const accounts = verified.admission.accounts;
  if (
    accounts.length !== 2 ||
    new Set(accounts.map((account) => account.accountId)).size !== 2 ||
    new Set(accounts.map((account) => account.workspaceId)).size !== 2 ||
    accounts.some(
      (account) =>
        !account.accountId ||
        !account.workspaceId ||
        !Number.isSafeInteger(account.waitingVideoCountBefore) ||
        account.waitingVideoCountBefore < 1 ||
        account.activeVideoCountAfter !== 1,
    )
  ) {
    reject("V211_ACCOUNTS_NOT_EXACT");
  }

  const promotions = verified.admission.promotions;
  if (
    promotions.length !== 2 ||
    promotions.some((promotion) => {
      const account = accounts.find((candidate) => candidate.accountId === promotion.accountId);
      return (
        account === undefined ||
        promotion.workspaceId !== account.workspaceId ||
        promotion.requestKind !== "VIDEO"
      );
    }) ||
    ![1, 2].every((slot) => promotions.some((promotion) => promotion.slot === slot)) ||
    verified.admission.activeLeaseCount !== 2 ||
    new Set(verified.admission.activeAccountIds).size !== 2 ||
    !accounts.every((account) => verified.admission.activeAccountIds.includes(account.accountId))
  ) {
    reject("V211_FAIRNESS_INVALID");
  }

  const primaryPromotion = promotions.find((promotion) => promotion.slot === 1)!;
  const secondaryPromotion = promotions.find((promotion) => promotion.slot === 2)!;
  const scenario = verified.admission.scenario;
  const waiter = scenario?.sameAccountWaiter;
  const fairness = scenario?.fairnessProbe;
  const cancellation = scenario?.cancellationRecovery;
  if (
    !scenario ||
    !scenario.primaryGenerationRequestId ||
    !scenario.primaryProjectId ||
    !scenario.primaryProjectRevisionId ||
    !scenario.secondaryGenerationRequestId ||
    !scenario.secondaryProjectId ||
    !scenario.secondaryProjectRevisionId ||
    !waiter ||
    waiter.accountId !== primaryPromotion.accountId ||
    waiter.workspaceId !== primaryPromotion.workspaceId ||
    waiter.projectId !== scenario.primaryProjectId ||
    waiter.projectRevisionId !== scenario.primaryProjectRevisionId ||
    !waiter.generationRequestId ||
    waiter.waitingObserved !== true ||
    !validSha(waiter.queueAuditReceiptSha256) ||
    !fairness ||
    !fairness.accountId ||
    !fairness.workspaceId ||
    !fairness.projectId ||
    !fairness.projectRevisionId ||
    !fairness.generationRequestId ||
    fairness.waitingObserved !== true ||
    !validSha(fairness.queueAuditReceiptSha256) ||
    new Set([primaryPromotion.accountId, secondaryPromotion.accountId, fairness.accountId]).size !==
      3 ||
    new Set([primaryPromotion.workspaceId, secondaryPromotion.workspaceId, fairness.workspaceId])
      .size !== 3 ||
    new Set([scenario.primaryProjectId, scenario.secondaryProjectId, fairness.projectId]).size !==
      3 ||
    new Set([
      scenario.primaryProjectRevisionId,
      scenario.secondaryProjectRevisionId,
      fairness.projectRevisionId,
    ]).size !== 3 ||
    new Set([
      scenario.primaryGenerationRequestId,
      scenario.secondaryGenerationRequestId,
      waiter.generationRequestId,
      fairness.generationRequestId,
    ]).size !== 4 ||
    scenario.fairPromotion?.generationRequestId !== fairness.generationRequestId ||
    !validSha(scenario.fairPromotion?.promotionReceiptSha256 ?? "") ||
    scenario.fairPromotion?.sameAccountWaiterRemainedWaiting !== true ||
    !cancellation ||
    !validSha(cancellation.cancelAuthorizationReceiptSha256) ||
    !validSha(cancellation.cancelReconciliationReceiptSha256) ||
    cancellation.terminalState !== "CANCELLED" ||
    cancellation.activeLeaseAbsent !== true ||
    !Number.isFinite(cancellation.providerRaceActualUsd) ||
    cancellation.providerRaceActualUsd < 0 ||
    cancellation.providerRaceActualUsd > 4 ||
    (cancellation.providerDispatchFenced === true &&
      (cancellation.providerRaceReconciled !== false ||
        cancellation.providerRaceActualUsd !== 0 ||
        cancellation.providerRaceJobId !== null ||
        cancellation.providerRaceReceiptSha256 !== null)) ||
    (cancellation.providerDispatchFenced === false &&
      (cancellation.providerRaceReconciled !== true ||
        !cancellation.providerRaceJobId ||
        !validSha(cancellation.providerRaceReceiptSha256 ?? ""))) ||
    (cancellation.providerDispatchFenced !== true &&
      cancellation.providerDispatchFenced !== false) ||
    scenario.tenantIsolation?.denied !== true ||
    !validSha(scenario.tenantIsolation?.denialReceiptSha256 ?? "")
  ) {
    reject("V211_FAIRNESS_INVALID");
  }

  if (verified.attempts.length !== 4) reject("V211_OUTPUT_NOT_DURABLE");
  const expectedPairs = accounts.flatMap((account) =>
    REQUIRED_LANES.map((lane) => `${account.accountId}:${account.workspaceId}:${lane}`),
  );
  const actualPairs = verified.attempts.map(
    (attempt) => `${attempt.accountId}:${attempt.workspaceId}:${attempt.lane}`,
  );
  const distinctFields = [
    verified.attempts.map((attempt) => attempt.attemptId),
    verified.attempts.map((attempt) => attempt.providerJobId),
    verified.attempts.map((attempt) => attempt.bindingSha256),
    verified.attempts.map((attempt) => attempt.expectedObjectSetSha256),
    verified.attempts.map((attempt) => attempt.barrierAcceptanceSha256),
    verified.attempts.map((attempt) => attempt.durableOutputReceiptSha256),
    verified.attempts.map((attempt) => attempt.workerId),
    verified.attempts.map((attempt) => attempt.provenanceReceiptSha256),
  ];
  if (
    new Set(actualPairs).size !== 4 ||
    !expectedPairs.every((pair) => actualPairs.includes(pair)) ||
    distinctFields.some((values) => new Set(values).size !== 4)
  ) {
    reject("V211_OUTPUT_NOT_DURABLE");
  }

  if (
    verified.attempts.some((attempt) => {
      const expectedGenerationRequestId =
        attempt.accountId === primaryPromotion.accountId
          ? scenario.primaryGenerationRequestId
          : attempt.accountId === secondaryPromotion.accountId
            ? scenario.secondaryGenerationRequestId
            : null;
      return attempt.generationRequestId !== expectedGenerationRequestId;
    })
  )
    reject("V211_LINEAGE_DRIFT");

  for (const attempt of verified.attempts) {
    const lane = verified.lanes[attempt.lane];
    if (
      attempt.deploymentId !== lane.deploymentId ||
      attempt.endpointIdSha256 !== lane.lineage.endpointIdSha256 ||
      attempt.endpointConfigSha256 !== lane.lineage.endpointConfigSha256 ||
      attempt.workerImageDigest !== lane.lineage.workerImageDigest ||
      attempt.modelManifestSha256 !== lane.lineage.modelManifestSha256 ||
      attempt.volumeIdSha256 !== lane.lineage.volumeIdSha256 ||
      attempt.volumeManifestSha256 !== lane.lineage.volumeManifestSha256
    ) {
      reject("V211_LINEAGE_DRIFT");
    }
    if (
      attempt.barrierOutcome !== "LANE_COMPLETED" ||
      ![
        attempt.bindingSha256,
        attempt.expectedObjectSetSha256,
        attempt.barrierAcceptanceSha256,
        attempt.durableOutputReceiptSha256,
        attempt.provenanceReceiptSha256,
      ].every(validSha)
    ) {
      reject("V211_OUTPUT_NOT_DURABLE");
    }
    if (
      !attempt.workerId ||
      attempt.provenanceReceiptHmacVerified !== true ||
      attempt.volumeManifestSha256Before !== lane.lineage.volumeManifestSha256 ||
      attempt.volumeManifestSha256After !== lane.lineage.volumeManifestSha256 ||
      attempt.volumeManifestSha256Before !== attempt.volumeManifestSha256After ||
      attempt.volumeMutationDetected !== false ||
      attempt.crossMountDetected !== false ||
      attempt.scratchRemoved !== true ||
      attempt.scratchOnModelVolume !== false
    ) {
      reject("V211_PROVENANCE_INVALID");
    }
  }

  for (const lane of REQUIRED_LANES) {
    const attempts = verified.attempts.filter((attempt) => attempt.lane === lane);
    if (attempts.length !== 2 || !intervalsOverlap(attempts[0]!, attempts[1]!, verifiedAt)) {
      reject("V211_PROVENANCE_INVALID");
    }
  }

  const jobs = verified.attempts.map((attempt) => attempt.providerJobId);
  if (
    verified.admission.settlementPromotedRequestIds.length !== 0 ||
    verified.admission.finalActiveLeaseCount !== 0 ||
    verified.terminalProviderJobIds.length !== 4 ||
    new Set(verified.terminalProviderJobIds).size !== 4 ||
    !verified.terminalProviderJobIds.every((job) => jobs.includes(job))
  ) {
    reject("V211_MAX1_RESTORE_INVALID");
  }

  return Object.freeze({
    groundworkOnly: true,
    liveAcceptanceClaimed: false,
    accountIds: Object.freeze(accounts.map((account) => account.accountId)) as readonly [
      string,
      string,
    ],
    activeSlots: Object.freeze(promotions.map((promotion) => promotion.slot)) as readonly [
      1 | 2,
      1 | 2,
    ],
    provenanceReceiptSha256s: Object.freeze(
      verified.attempts.map((attempt) => attempt.provenanceReceiptSha256),
    ) as readonly [Sha256, Sha256, Sha256, Sha256],
    durableOutputReceiptSha256s: Object.freeze(
      verified.attempts.map((attempt) => attempt.durableOutputReceiptSha256),
    ) as readonly [Sha256, Sha256, Sha256, Sha256],
    terminalProviderJobIds: Object.freeze(jobs) as readonly [string, string, string, string],
    restoredMaxWorkers: 1,
    finalActiveWorkers: 0,
  });
}

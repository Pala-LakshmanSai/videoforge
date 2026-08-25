import { canonicalSha256, type ServerlessLane, type Sha256 } from "@videoforge/control-plane";

import type { HostedQualificationLineage } from "./hosted-serverless-runtime.js";

export type HostedV211AcceptanceErrorCode =
  | "V211_ACCOUNTS_NOT_EXACT"
  | "V211_FAIRNESS_INVALID"
  | "V211_CAPACITY_INVALID"
  | "V211_FAKE_TRANSPORT_FORBIDDEN"
  | "V211_READER_INVALID"
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
  readonly readerId: string;
  readonly readerReceiptSha256: Sha256;
  readonly readerState: "SUCCEEDED";
  readonly readerDeploymentId: string;
  readonly readerVolumeIdSha256: Sha256;
  readonly readerVolumeManifestSha256: Sha256;
  readonly readerMountPath: "/runpod-volume";
  readonly readerReadOnlyMount: true;
  readonly readerCrossMountDetected: false;
  readonly readerStartedAt: string;
  readonly readerCompletedAt: string;
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
      readonly waitingPreviewCountBefore: number;
      readonly activeVideoCountAfter: number;
      readonly waitingPreviewCountAfter: number;
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
        };
        readonly restored: {
          readonly configuredMaxWorkers: 1;
          readonly activeWorkers: 0;
          readonly qualification: "MAX1_VERIFIED";
        };
        readonly volumeReadback: {
          readonly mountPath: "/runpod-volume";
          readonly readOnly: true;
          readonly crossMountDetected: false;
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
  readonly readerIds: readonly [string, string, string, string];
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

function exactLineage(lineage: HostedQualificationLineage): boolean {
  return (
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
      lineage.qualificationSourceSha256,
      lineage.dependencyLockSha256,
      lineage.acceptanceContractSha256,
      lineage.max1GateConfigSha256,
      lineage.max1EndpointProfileSha256,
      lineage.max2GateConfigSha256,
      lineage.max2EndpointProfileSha256,
    ].every(validSha)
  );
}

function exactLaneEvidence(verified: HostedV211VerifiedEvidence): boolean {
  return REQUIRED_LANES.every((lane) => {
    const evidence = verified.lanes[lane];
    return (
      evidence.deploymentId.length > 0 &&
      validSha(evidence.qualificationArtifactSha256) &&
      exactLineage(evidence.lineage) &&
      evidence.baseline.configuredMaxWorkers === 1 &&
      evidence.baseline.activeWorkers === 0 &&
      evidence.baseline.qualification === "MAX1_VERIFIED" &&
      evidence.active.configuredMaxWorkers === 2 &&
      evidence.active.activeWorkers === 2 &&
      evidence.active.qualification === "MAX2_VERIFIED" &&
      evidence.restored.configuredMaxWorkers === 1 &&
      evidence.restored.activeWorkers === 0 &&
      evidence.restored.qualification === "MAX1_VERIFIED" &&
      evidence.volumeReadback.mountPath === "/runpod-volume" &&
      evidence.volumeReadback.readOnly === true &&
      evidence.volumeReadback.crossMountDetected === false &&
      evidence.volumeReadback.manifestSha256Before === evidence.lineage.volumeManifestSha256 &&
      evidence.volumeReadback.manifestSha256After === evidence.lineage.volumeManifestSha256
    );
  });
}

function intervalsOverlap(
  left: HostedV211VerifiedAttemptEvidence,
  right: HostedV211VerifiedAttemptEvidence,
  verifiedAt: number,
): boolean {
  const leftStart = timestamp(left.readerStartedAt);
  const leftEnd = timestamp(left.readerCompletedAt);
  const rightStart = timestamp(right.readerStartedAt);
  const rightEnd = timestamp(right.readerCompletedAt);
  return (
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
        !Number.isSafeInteger(account.waitingPreviewCountBefore) ||
        account.waitingPreviewCountBefore < 1 ||
        account.activeVideoCountAfter !== 1 ||
        !Number.isSafeInteger(account.waitingPreviewCountAfter) ||
        account.waitingPreviewCountAfter < 1,
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
    verified.attempts.map((attempt) => attempt.readerId),
    verified.attempts.map((attempt) => attempt.readerReceiptSha256),
  ];
  if (
    new Set(actualPairs).size !== 4 ||
    !expectedPairs.every((pair) => actualPairs.includes(pair)) ||
    distinctFields.some((values) => new Set(values).size !== 4)
  ) {
    reject("V211_OUTPUT_NOT_DURABLE");
  }

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
        attempt.readerReceiptSha256,
      ].every(validSha)
    ) {
      reject("V211_OUTPUT_NOT_DURABLE");
    }
    if (
      attempt.readerState !== "SUCCEEDED" ||
      attempt.readerDeploymentId !== lane.deploymentId ||
      attempt.readerVolumeIdSha256 !== lane.lineage.volumeIdSha256 ||
      attempt.readerVolumeManifestSha256 !== lane.lineage.volumeManifestSha256 ||
      attempt.readerMountPath !== "/runpod-volume" ||
      attempt.readerReadOnlyMount !== true ||
      attempt.readerCrossMountDetected !== false
    ) {
      reject("V211_READER_INVALID");
    }
  }

  for (const lane of REQUIRED_LANES) {
    const readers = verified.attempts.filter((attempt) => attempt.lane === lane);
    if (readers.length !== 2 || !intervalsOverlap(readers[0]!, readers[1]!, verifiedAt)) {
      reject("V211_READER_INVALID");
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
    readerIds: Object.freeze(verified.attempts.map((attempt) => attempt.readerId)) as readonly [
      string,
      string,
      string,
      string,
    ],
    durableOutputReceiptSha256s: Object.freeze(
      verified.attempts.map((attempt) => attempt.durableOutputReceiptSha256),
    ) as readonly [Sha256, Sha256, Sha256, Sha256],
    terminalProviderJobIds: Object.freeze(jobs) as readonly [string, string, string, string],
    restoredMaxWorkers: 1,
    finalActiveWorkers: 0,
  });
}

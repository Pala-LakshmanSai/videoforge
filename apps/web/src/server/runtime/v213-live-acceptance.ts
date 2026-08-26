import { canonicalSha256, type Sha256 } from "@videoforge/control-plane";

import {
  acceptHostedProductionLength,
  type HostedProductionLengthAdmission,
  type HostedProductionLengthRepository,
  type HostedProductionOutputVerifier,
} from "./hosted-production-length-acceptance.js";
import {
  acceptHostedShortPilot,
  claimHostedShortPilotSubmission,
  type HostedShortPilotAcceptance,
  type HostedShortPilotAdmission,
  type HostedShortPilotOutputVerifier,
  type HostedShortPilotRepository,
} from "./hosted-short-pilot.js";
import {
  evaluateHostedV211Groundwork,
  type HostedV211AcceptanceResult,
  type HostedV211EvidenceVerifier,
} from "./hosted-v211-acceptance-coordinator.js";
import {
  buildV213ReleaseCertificationLedger,
  hashV213ReleaseIdentity,
  type V213ReleaseCertificationLedger,
  type V213ReleaseEvidenceArtifact,
  type V213ReleaseEvidenceVerifier,
  type V213ReleaseGate,
  type V213ReleaseIdentity,
} from "./v213-release-certification.js";

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const COMPLETION_CAP_MICRO_USD = 17_500_000;
const PHASE_CAP_MICRO_USD = Object.freeze({
  "V2-10": 2_000_000,
  "V2-11": 4_000_000,
  "V2-12": 2_000_000,
  "V2-13": 2_000_000,
});
const ZERO_READ_MAX_AGE_MS = 10 * 60 * 1_000;
const ZERO_READ_MIN_SPACING_MS = 1_000;

export type V213LiveCheckpoint = "V2-10" | "V2-11" | "V2-12" | "V2-13";

export type V213LiveAcceptanceErrorCode =
  | "LIVE_ACCEPTANCE_SCOPE_INVALID"
  | "LIVE_ACCEPTANCE_REPLAY_FORBIDDEN"
  | "LIVE_ACCEPTANCE_TRANSPORT_INVALID"
  | "LIVE_ACCEPTANCE_RECEIPT_INVALID"
  | "LIVE_ACCEPTANCE_IDENTITY_DRIFT"
  | "LIVE_ACCEPTANCE_COST_INVALID"
  | "LIVE_ACCEPTANCE_NOT_TERMINAL"
  | "LIVE_ACCEPTANCE_CHROME_INVALID"
  | "LIVE_ACCEPTANCE_RELEASE_BLOCKED"
  | "LIVE_ACCEPTANCE_DURABLE_COMPLETION_FAILED"
  | "LIVE_ACCEPTANCE_CLEANUP_UNPROVEN";

export class V213LiveAcceptanceError extends Error {
  constructor(readonly code: V213LiveAcceptanceErrorCode) {
    super(code);
    this.name = "V213LiveAcceptanceError";
  }
}

export interface V213LiveProjectScope {
  readonly accountId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly projectRevisionId: string;
  readonly requestSha256: Sha256;
  readonly attemptId: string;
}

export interface V213LiveExecutionRequest {
  readonly checkpoint: V213LiveCheckpoint;
  readonly executionId: string;
  readonly proposalSha256: Sha256;
  readonly authoritySha256: Sha256;
  readonly approvalRecordSha256: Sha256;
  readonly cumulativeLedgerSha256: Sha256;
  readonly executorSha256: Sha256;
  readonly promotionDecisionSha256: Sha256;
  readonly sourceCommit: string;
  readonly scopes: readonly V213LiveProjectScope[];
  readonly maximumVariableCostMicroUsd: number;
  readonly maximumCumulativeVariableCostMicroUsd: 17_500_000;
  readonly billingBaselineMicroUsd: number;
  readonly cumulativeLedgerSpentBeforeMicroUsd: number;
  readonly retainedVolumeIdSha256s: Readonly<{ mage: Sha256; soulx: Sha256 }>;
  readonly noRedispatch: true;
}

export interface V213StableZeroWorkerRead {
  readonly evidenceSha256: Sha256;
  readonly observedAt: string;
  readonly endpointJobs: 0;
  readonly mageWorkers: 0;
  readonly soulxWorkers: 0;
}

export interface V213LiveVerifiedReceipt {
  readonly verifierId: "videoforge-v213-live-execution-receipt-verifier-v1";
  readonly accepted: true;
  readonly canonicalArtifactSha256: Sha256;
  readonly verifierSignatureSha256: Sha256;
  readonly signatureVerified: true;
  readonly transport: "CLOUDFLARE_HOSTED_RUNPOD_SERVERLESS";
  readonly checkpoint: V213LiveCheckpoint;
  readonly executionId: string;
  readonly proposalSha256: Sha256;
  readonly authoritySha256: Sha256;
  readonly approvalRecordSha256: Sha256;
  readonly approvalConsumed: true;
  readonly cumulativeLedgerSha256: Sha256;
  readonly executorSha256: Sha256;
  readonly promotionDecisionSha256: Sha256;
  readonly sourceCommit: string;
  readonly scopes: readonly V213LiveProjectScope[];
  readonly rawEvidenceSha256: Sha256;
  readonly projectDispatchCount: number;
  readonly mageDispatchCount: number;
  readonly soulxDispatchCount: number;
  readonly noRedispatch: true;
  readonly phaseCapMicroUsd: number;
  readonly cumulativeCapMicroUsd: 17_500_000;
  readonly billingBaselineMicroUsd: number;
  readonly billingFinalMicroUsd: number;
  readonly cumulativeLedgerSpentMicroUsd: number;
  readonly variableCostMicroUsd: number;
  readonly possibleDuplicateCostMicroUsd: number;
  readonly billingSettled: true;
  readonly terminalProviderJobIds: readonly string[];
  readonly endpointJobs: 0;
  readonly mageWorkers: 0;
  readonly soulxWorkers: 0;
  readonly maxWorkersRestored: 1;
  readonly unknownLiabilities: 0;
  readonly retainedVolumes: Readonly<{
    mage: Readonly<{
      volumeIdSha256: Sha256;
      manifestBeforeSha256: Sha256;
      manifestAfterSha256: Sha256;
    }>;
    soulx: Readonly<{
      volumeIdSha256: Sha256;
      manifestBeforeSha256: Sha256;
      manifestAfterSha256: Sha256;
    }>;
  }>;
  readonly zeroWorkerReads: readonly [
    V213StableZeroWorkerRead,
    V213StableZeroWorkerRead,
    V213StableZeroWorkerRead,
  ];
  readonly operatorIntervention: false;
  readonly outputCommittedAt: string;
  readonly realChromePlaybackPassed: boolean;
  readonly chromePlaybackReceiptSha256: Sha256 | null;
  readonly chromePlaybackObservedAt: string | null;
  readonly userVisualDecision: "ACCEPTED" | "NOT_APPLICABLE";
  readonly userVisualDecisionReceiptSha256: Sha256 | null;
  readonly userVisualDecisionObservedAt: string | null;
  readonly sameAccountSecondJobWaited: boolean;
  readonly sameAccountWaitingRequestSha256: Sha256 | null;
  readonly thirdAccountWaited: boolean;
  readonly thirdAccountId: string | null;
  readonly thirdAccountWaitingRequestSha256: Sha256 | null;
  readonly fairPromotionPassed: boolean;
  readonly failureRecoveryExercised: boolean;
  readonly failureRecoveryReceiptSha256: Sha256 | null;
  readonly ownershipIsolated: boolean;
  readonly ownershipIsolationReceiptSha256: Sha256 | null;
  readonly observedAt: string;
}

export interface V213RedactedLiveSummary {
  readonly settledCostUsd: number;
  readonly zeroWorkersAfter: true;
  readonly terminal: true;
  readonly evidenceSha256: Sha256;
  readonly durationSeconds?: number;
  readonly operatorIntervention?: false;
  readonly projectCount?: 2;
  readonly concurrent?: true;
  readonly ownershipIsolated?: true;
  readonly twoLaneSmoke?: true;
}

export interface V213LiveReceiptVerifier {
  /** Verifies the immutable provider/hosted capture and its signer outside this coordinator. */
  verify(artifact: Readonly<Record<string, unknown>>): Promise<V213LiveVerifiedReceipt>;
}

export interface V213LiveAttemptStore {
  /** Atomically consumes the exact approval and cumulative ledger once. Returns null on replay. */
  claimOnce(
    requestSha256: Sha256,
    request: V213LiveExecutionRequest,
  ): Promise<V213LiveConsumedClaim | null>;
  /** Atomically records the exact accepted receipt and checkpoint result. */
  complete(
    requestSha256: Sha256,
    completionSha256: Sha256,
    receiptEvidenceSha256: Sha256,
    result: Readonly<Record<string, unknown>>,
  ): Promise<boolean>;
  /** Records a terminal failed attempt; it must never make the request reusable. */
  recordTerminalFailure(requestSha256: Sha256, cleanupSha256: Sha256): Promise<boolean>;
}

export interface V213LiveConsumedClaim {
  readonly requestSha256: Sha256;
  readonly proposalSha256: Sha256;
  readonly authoritySha256: Sha256;
  readonly approvalRecordSha256: Sha256;
  readonly approvalConsumed: true;
  readonly cumulativeLedgerSha256: Sha256;
  readonly executorSha256: Sha256;
  readonly promotionDecisionSha256: Sha256;
  readonly promotionVersion: "V3";
  readonly promotionState: "CONSUMED_CURRENT";
  readonly sourceCommit: string;
  readonly cumulativeLedgerSpentBeforeMicroUsd: number;
  readonly billingBaselineMicroUsd: number;
  readonly claimedAt: string;
  readonly expiresAt: string;
}

export interface V213LiveCapture {
  readonly rawEvidence: Readonly<Record<string, unknown>>;
  readonly receiptArtifact: Readonly<Record<string, unknown>>;
}

export interface V213LiveTransport {
  readonly kind: "CLOUDFLARE_HOSTED_RUNPOD_SERVERLESS";
  execute(request: V213LiveExecutionRequest): Promise<V213LiveCapture>;
  /** Cancel/reconcile only. It must not dispatch or make the request reusable. */
  cancelAndReconcile(request: V213LiveExecutionRequest): Promise<{
    readonly cleanupArtifact: Readonly<Record<string, unknown>>;
  }>;
}

export interface V213CleanupVerification {
  readonly verifierId: "videoforge-v213-live-cleanup-verifier-v1";
  readonly accepted: true;
  readonly canonicalArtifactSha256: Sha256;
  readonly verifierSignatureSha256: Sha256;
  readonly signatureVerified: true;
  readonly checkpoint: V213LiveCheckpoint;
  readonly executionId: string;
  readonly authoritySha256: Sha256;
  readonly sourceCommit: string;
  readonly cancelOnly: true;
  readonly redispatchCount: 0;
  readonly endpointJobs: 0;
  readonly mageWorkers: 0;
  readonly soulxWorkers: 0;
  readonly maxWorkersRestored: 1;
  readonly unknownLiabilities: 0;
  readonly retainedVolumes: V213LiveVerifiedReceipt["retainedVolumes"];
  readonly zeroWorkerReads: V213LiveVerifiedReceipt["zeroWorkerReads"];
  readonly observedAt: string;
}

export interface V213CleanupVerifier {
  verify(artifact: Readonly<Record<string, unknown>>): Promise<V213CleanupVerification>;
}

export interface V213ChromeAcceptanceArtifact {
  readonly rawEvidence: Readonly<Record<string, unknown>>;
}

export interface V213VerifiedChromeAcceptance {
  readonly verifierId: "videoforge-v213-real-chrome-acceptance-verifier-v1";
  readonly accepted: true;
  readonly canonicalEvidenceSha256: Sha256;
  readonly verifierSignatureSha256: Sha256;
  readonly signatureVerified: true;
  readonly releaseIdentitySha256: Sha256;
  readonly productionUrlSha256: Sha256;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly projectRevisionId: string;
  readonly outputSha256: Sha256;
  readonly browser: "GOOGLE_CHROME";
  readonly fixtureOrFakeTransportUsed: false;
  readonly playbackPassed: true;
  readonly privateReadbackPassed: true;
  readonly observedAt: string;
}

export interface V213ChromeAcceptanceVerifier {
  verify(rawEvidence: Readonly<Record<string, unknown>>): Promise<V213VerifiedChromeAcceptance>;
}

function fail(code: V213LiveAcceptanceErrorCode): never {
  throw new V213LiveAcceptanceError(code);
}

function validSha(value: unknown): value is Sha256 {
  return typeof value === "string" && SHA256.test(value);
}

function validScope(scope: V213LiveProjectScope): boolean {
  return (
    [
      scope.accountId,
      scope.workspaceId,
      scope.projectId,
      scope.projectRevisionId,
      scope.attemptId,
    ].every((value) => ID.test(value)) && validSha(scope.requestSha256)
  );
}

function exactScopes(
  left: readonly V213LiveProjectScope[],
  right: readonly V213LiveProjectScope[],
): boolean {
  return left.length === right.length && canonicalSha256(left) === canonicalSha256(right);
}

function validateRequest(request: V213LiveExecutionRequest, expectedScopes: number): Sha256 {
  const expectedPhaseCap = PHASE_CAP_MICRO_USD[request.checkpoint];
  if (
    !ID.test(request.executionId) ||
    !validSha(request.proposalSha256) ||
    !validSha(request.authoritySha256) ||
    !validSha(request.approvalRecordSha256) ||
    !validSha(request.cumulativeLedgerSha256) ||
    !validSha(request.executorSha256) ||
    !validSha(request.promotionDecisionSha256) ||
    !COMMIT.test(request.sourceCommit) ||
    request.noRedispatch !== true ||
    request.scopes.length !== expectedScopes ||
    request.scopes.some((scope) => !validScope(scope)) ||
    new Set(request.scopes.map((scope) => `${scope.accountId}:${scope.workspaceId}`)).size !==
      expectedScopes ||
    request.maximumVariableCostMicroUsd !== expectedPhaseCap ||
    request.maximumCumulativeVariableCostMicroUsd !== COMPLETION_CAP_MICRO_USD ||
    !Number.isSafeInteger(request.billingBaselineMicroUsd) ||
    request.billingBaselineMicroUsd < 0 ||
    !Number.isSafeInteger(request.cumulativeLedgerSpentBeforeMicroUsd) ||
    request.cumulativeLedgerSpentBeforeMicroUsd < 0 ||
    request.cumulativeLedgerSpentBeforeMicroUsd > COMPLETION_CAP_MICRO_USD ||
    !validSha(request.retainedVolumeIdSha256s.mage) ||
    !validSha(request.retainedVolumeIdSha256s.soulx) ||
    request.retainedVolumeIdSha256s.mage === request.retainedVolumeIdSha256s.soulx
  )
    fail("LIVE_ACCEPTANCE_SCOPE_INVALID");
  return canonicalSha256(request);
}

export async function verifyV213LiveReceipt(input: {
  readonly request: V213LiveExecutionRequest;
  readonly capture: V213LiveCapture;
  readonly verifier: V213LiveReceiptVerifier;
  readonly expectedProjectDispatchCount: number;
  readonly expectedMageDispatchCount: number;
  readonly expectedSoulxDispatchCount: number;
  readonly now: () => Date;
}): Promise<V213LiveVerifiedReceipt> {
  let receipt: V213LiveVerifiedReceipt;
  try {
    receipt = await input.verifier.verify(structuredClone(input.capture.receiptArtifact));
  } catch {
    fail("LIVE_ACCEPTANCE_RECEIPT_INVALID");
  }
  if (
    receipt.verifierId !== "videoforge-v213-live-execution-receipt-verifier-v1" ||
    receipt.accepted !== true ||
    receipt.canonicalArtifactSha256 !== canonicalSha256(input.capture.receiptArtifact) ||
    !validSha(receipt.verifierSignatureSha256) ||
    receipt.signatureVerified !== true ||
    receipt.transport !== "CLOUDFLARE_HOSTED_RUNPOD_SERVERLESS" ||
    receipt.checkpoint !== input.request.checkpoint ||
    receipt.executionId !== input.request.executionId ||
    receipt.proposalSha256 !== input.request.proposalSha256 ||
    receipt.authoritySha256 !== input.request.authoritySha256 ||
    receipt.approvalRecordSha256 !== input.request.approvalRecordSha256 ||
    receipt.approvalConsumed !== true ||
    receipt.cumulativeLedgerSha256 !== input.request.cumulativeLedgerSha256 ||
    receipt.executorSha256 !== input.request.executorSha256 ||
    receipt.promotionDecisionSha256 !== input.request.promotionDecisionSha256 ||
    receipt.sourceCommit !== input.request.sourceCommit ||
    !exactScopes(receipt.scopes, input.request.scopes) ||
    receipt.rawEvidenceSha256 !== canonicalSha256(input.capture.rawEvidence) ||
    receipt.noRedispatch !== true
  )
    fail("LIVE_ACCEPTANCE_IDENTITY_DRIFT");
  if (
    receipt.projectDispatchCount !== input.expectedProjectDispatchCount ||
    receipt.mageDispatchCount !== input.expectedMageDispatchCount ||
    receipt.soulxDispatchCount !== input.expectedSoulxDispatchCount
  )
    fail("LIVE_ACCEPTANCE_RECEIPT_INVALID");
  if (
    receipt.phaseCapMicroUsd !== input.request.maximumVariableCostMicroUsd ||
    receipt.cumulativeCapMicroUsd !== COMPLETION_CAP_MICRO_USD ||
    receipt.billingBaselineMicroUsd !== input.request.billingBaselineMicroUsd ||
    !Number.isSafeInteger(receipt.billingBaselineMicroUsd) ||
    !Number.isSafeInteger(receipt.billingFinalMicroUsd) ||
    receipt.billingBaselineMicroUsd < 0 ||
    receipt.billingFinalMicroUsd < receipt.billingBaselineMicroUsd ||
    receipt.billingFinalMicroUsd - receipt.billingBaselineMicroUsd !==
      receipt.variableCostMicroUsd ||
    !Number.isSafeInteger(receipt.cumulativeLedgerSpentMicroUsd) ||
    receipt.cumulativeLedgerSpentMicroUsd !==
      input.request.cumulativeLedgerSpentBeforeMicroUsd + receipt.variableCostMicroUsd ||
    receipt.cumulativeLedgerSpentMicroUsd > COMPLETION_CAP_MICRO_USD ||
    !Number.isSafeInteger(receipt.variableCostMicroUsd) ||
    receipt.variableCostMicroUsd < 0 ||
    receipt.variableCostMicroUsd > input.request.maximumVariableCostMicroUsd ||
    !Number.isSafeInteger(receipt.possibleDuplicateCostMicroUsd) ||
    receipt.possibleDuplicateCostMicroUsd !== 0 ||
    receipt.billingSettled !== true
  )
    fail("LIVE_ACCEPTANCE_COST_INVALID");
  const now = input.now().getTime();
  const outputCommittedAt = Date.parse(receipt.outputCommittedAt);
  const chromePlaybackObservedAt = Date.parse(receipt.chromePlaybackObservedAt ?? "");
  const userVisualDecisionObservedAt = Date.parse(receipt.userVisualDecisionObservedAt ?? "");
  const readTimes = receipt.zeroWorkerReads.map((read) => Date.parse(read.observedAt));
  const volumes = [receipt.retainedVolumes.mage, receipt.retainedVolumes.soulx];
  if (
    receipt.terminalProviderJobIds.length !==
      receipt.mageDispatchCount + receipt.soulxDispatchCount ||
    new Set(receipt.terminalProviderJobIds).size !== receipt.terminalProviderJobIds.length ||
    receipt.endpointJobs !== 0 ||
    receipt.mageWorkers !== 0 ||
    receipt.soulxWorkers !== 0 ||
    receipt.maxWorkersRestored !== 1 ||
    receipt.unknownLiabilities !== 0 ||
    !Number.isFinite(now) ||
    !Number.isFinite(outputCommittedAt) ||
    outputCommittedAt > now ||
    receipt.retainedVolumes.mage.volumeIdSha256 !== input.request.retainedVolumeIdSha256s.mage ||
    receipt.retainedVolumes.soulx.volumeIdSha256 !== input.request.retainedVolumeIdSha256s.soulx ||
    volumes.some(
      (volume) =>
        !validSha(volume.volumeIdSha256) ||
        !validSha(volume.manifestBeforeSha256) ||
        volume.manifestAfterSha256 !== volume.manifestBeforeSha256,
    ) ||
    receipt.retainedVolumes.mage.volumeIdSha256 === receipt.retainedVolumes.soulx.volumeIdSha256 ||
    receipt.zeroWorkerReads.length !== 3 ||
    receipt.zeroWorkerReads.some(
      (read) =>
        !validSha(read.evidenceSha256) ||
        read.endpointJobs !== 0 ||
        read.mageWorkers !== 0 ||
        read.soulxWorkers !== 0,
    ) ||
    new Set(receipt.zeroWorkerReads.map((read) => read.evidenceSha256)).size !== 3 ||
    readTimes.some((time) => !Number.isFinite(time) || time > now) ||
    now - readTimes[0]! > ZERO_READ_MAX_AGE_MS ||
    readTimes[1]! - readTimes[0]! < ZERO_READ_MIN_SPACING_MS ||
    readTimes[2]! - readTimes[1]! < ZERO_READ_MIN_SPACING_MS ||
    Date.parse(receipt.observedAt) !== readTimes[2]
  )
    fail("LIVE_ACCEPTANCE_NOT_TERMINAL");
  if (
    receipt.operatorIntervention !== false ||
    (input.request.checkpoint === "V2-10" &&
      (receipt.realChromePlaybackPassed !== true ||
        !validSha(receipt.chromePlaybackReceiptSha256) ||
        !Number.isFinite(chromePlaybackObservedAt) ||
        chromePlaybackObservedAt <= outputCommittedAt ||
        receipt.userVisualDecision !== "ACCEPTED" ||
        !validSha(receipt.userVisualDecisionReceiptSha256) ||
        !Number.isFinite(userVisualDecisionObservedAt) ||
        userVisualDecisionObservedAt < chromePlaybackObservedAt ||
        userVisualDecisionObservedAt > Date.parse(receipt.observedAt))) ||
    (input.request.checkpoint === "V2-11" &&
      (receipt.sameAccountSecondJobWaited !== true ||
        !validSha(receipt.sameAccountWaitingRequestSha256) ||
        receipt.thirdAccountWaited !== true ||
        receipt.thirdAccountId === null ||
        !ID.test(receipt.thirdAccountId) ||
        input.request.scopes.some((scope) => scope.accountId === receipt.thirdAccountId) ||
        !validSha(receipt.thirdAccountWaitingRequestSha256) ||
        receipt.fairPromotionPassed !== true ||
        receipt.failureRecoveryExercised !== true ||
        !validSha(receipt.failureRecoveryReceiptSha256) ||
        receipt.ownershipIsolated !== true ||
        !validSha(receipt.ownershipIsolationReceiptSha256))) ||
    (input.request.checkpoint === "V2-12" &&
      (receipt.userVisualDecision !== "ACCEPTED" ||
        !validSha(receipt.userVisualDecisionReceiptSha256) ||
        !Number.isFinite(userVisualDecisionObservedAt) ||
        userVisualDecisionObservedAt <= outputCommittedAt ||
        userVisualDecisionObservedAt > Date.parse(receipt.observedAt)))
  )
    fail("LIVE_ACCEPTANCE_RECEIPT_INVALID");
  return Object.freeze(receipt);
}

async function cleanFailedAttempt(input: {
  readonly request: V213LiveExecutionRequest;
  readonly requestSha256: Sha256;
  readonly store: V213LiveAttemptStore;
  readonly transport: V213LiveTransport;
  readonly verifier: V213CleanupVerifier;
  readonly now: () => Date;
}): Promise<Sha256> {
  try {
    const cleanup = await input.transport.cancelAndReconcile(input.request);
    const verified = await input.verifier.verify(structuredClone(cleanup.cleanupArtifact));
    const readTimes = verified.zeroWorkerReads.map((read) => Date.parse(read.observedAt));
    const now = input.now().getTime();
    if (
      verified.verifierId !== "videoforge-v213-live-cleanup-verifier-v1" ||
      verified.accepted !== true ||
      verified.canonicalArtifactSha256 !== canonicalSha256(cleanup.cleanupArtifact) ||
      !validSha(verified.verifierSignatureSha256) ||
      verified.signatureVerified !== true ||
      verified.checkpoint !== input.request.checkpoint ||
      verified.executionId !== input.request.executionId ||
      verified.authoritySha256 !== input.request.authoritySha256 ||
      verified.sourceCommit !== input.request.sourceCommit ||
      verified.cancelOnly !== true ||
      verified.redispatchCount !== 0 ||
      verified.endpointJobs !== 0 ||
      verified.mageWorkers !== 0 ||
      verified.soulxWorkers !== 0 ||
      verified.maxWorkersRestored !== 1 ||
      verified.unknownLiabilities !== 0 ||
      [verified.retainedVolumes.mage, verified.retainedVolumes.soulx].some(
        (volume) =>
          !validSha(volume.volumeIdSha256) ||
          !validSha(volume.manifestBeforeSha256) ||
          volume.manifestAfterSha256 !== volume.manifestBeforeSha256,
      ) ||
      verified.zeroWorkerReads.length !== 3 ||
      verified.zeroWorkerReads.some(
        (read) =>
          !validSha(read.evidenceSha256) ||
          read.endpointJobs !== 0 ||
          read.mageWorkers !== 0 ||
          read.soulxWorkers !== 0,
      ) ||
      new Set(verified.zeroWorkerReads.map((read) => read.evidenceSha256)).size !== 3 ||
      readTimes.some((time) => !Number.isFinite(time) || time > now) ||
      now - readTimes[0]! > ZERO_READ_MAX_AGE_MS ||
      readTimes[1]! - readTimes[0]! < ZERO_READ_MIN_SPACING_MS ||
      readTimes[2]! - readTimes[1]! < ZERO_READ_MIN_SPACING_MS ||
      Date.parse(verified.observedAt) !== readTimes[2] ||
      !(await input.store.recordTerminalFailure(
        input.requestSha256,
        verified.canonicalArtifactSha256,
      ))
    )
      fail("LIVE_ACCEPTANCE_CLEANUP_UNPROVEN");
    return verified.canonicalArtifactSha256;
  } catch {
    fail("LIVE_ACCEPTANCE_CLEANUP_UNPROVEN");
  }
}

async function claimRequest(input: {
  readonly request: V213LiveExecutionRequest;
  readonly expectedScopes: number;
  readonly store: V213LiveAttemptStore;
  readonly transport: V213LiveTransport;
  readonly now: () => Date;
}): Promise<Sha256> {
  const requestSha256 = validateRequest(input.request, input.expectedScopes);
  if (input.transport.kind !== "CLOUDFLARE_HOSTED_RUNPOD_SERVERLESS")
    fail("LIVE_ACCEPTANCE_TRANSPORT_INVALID");
  const claim = await input.store.claimOnce(requestSha256, input.request);
  const now = input.now().getTime();
  const claimedAt = Date.parse(claim?.claimedAt ?? "");
  const expiresAt = Date.parse(claim?.expiresAt ?? "");
  if (
    !claim ||
    claim.requestSha256 !== requestSha256 ||
    claim.proposalSha256 !== input.request.proposalSha256 ||
    claim.authoritySha256 !== input.request.authoritySha256 ||
    claim.approvalRecordSha256 !== input.request.approvalRecordSha256 ||
    claim.approvalConsumed !== true ||
    claim.cumulativeLedgerSha256 !== input.request.cumulativeLedgerSha256 ||
    claim.executorSha256 !== input.request.executorSha256 ||
    claim.promotionDecisionSha256 !== input.request.promotionDecisionSha256 ||
    claim.promotionVersion !== "V3" ||
    claim.promotionState !== "CONSUMED_CURRENT" ||
    claim.sourceCommit !== input.request.sourceCommit ||
    claim.cumulativeLedgerSpentBeforeMicroUsd !==
      input.request.cumulativeLedgerSpentBeforeMicroUsd ||
    claim.billingBaselineMicroUsd !== input.request.billingBaselineMicroUsd ||
    !Number.isFinite(now) ||
    !Number.isFinite(claimedAt) ||
    !Number.isFinite(expiresAt) ||
    claimedAt > now ||
    now - claimedAt > 5 * 60 * 1_000 ||
    expiresAt <= now
  )
    fail("LIVE_ACCEPTANCE_REPLAY_FORBIDDEN");
  return requestSha256;
}

async function complete(
  store: V213LiveAttemptStore,
  requestSha256: Sha256,
  result: Readonly<Record<string, unknown>>,
) {
  const completionSha256 = canonicalSha256(result);
  const receipt = result.receipt;
  const receiptEvidenceSha256 =
    receipt && typeof receipt === "object" && "canonicalArtifactSha256" in receipt
      ? receipt.canonicalArtifactSha256
      : null;
  if (
    !validSha(receiptEvidenceSha256) ||
    !(await store.complete(requestSha256, completionSha256, receiptEvidenceSha256, result))
  )
    fail("LIVE_ACCEPTANCE_DURABLE_COMPLETION_FAILED");
  return completionSha256;
}

function redactedSummary(
  receipt: V213LiveVerifiedReceipt,
  extra: Omit<
    Partial<V213RedactedLiveSummary>,
    "settledCostUsd" | "zeroWorkersAfter" | "terminal" | "evidenceSha256"
  > = {},
): V213RedactedLiveSummary {
  return Object.freeze({
    settledCostUsd: receipt.variableCostMicroUsd / 1_000_000,
    zeroWorkersAfter: true as const,
    terminal: true as const,
    evidenceSha256: receipt.canonicalArtifactSha256,
    ...extra,
  });
}

export async function executeV210LivePilot(input: {
  readonly request: V213LiveExecutionRequest & { readonly checkpoint: "V2-10" };
  readonly admission: HostedShortPilotAdmission;
  readonly repository: HostedShortPilotRepository;
  readonly outputVerifier: HostedShortPilotOutputVerifier;
  readonly receiptVerifier: V213LiveReceiptVerifier;
  readonly cleanupVerifier: V213CleanupVerifier;
  readonly store: V213LiveAttemptStore;
  readonly transport: V213LiveTransport;
  readonly now: () => Date;
}): Promise<{
  readonly liveAcceptanceClaimed: true;
  readonly acceptance: HostedShortPilotAcceptance;
  readonly summary: V213RedactedLiveSummary;
  readonly completionSha256: Sha256;
}> {
  const scope = input.request.scopes[0];
  if (
    !scope ||
    scope.accountId !== input.admission.key.accountId ||
    scope.workspaceId !== input.admission.key.workspaceId ||
    scope.projectId !== input.admission.key.projectId ||
    scope.projectRevisionId !== input.admission.key.projectRevisionId ||
    scope.requestSha256 !== input.admission.requestSha256 ||
    scope.attemptId !== input.admission.automaticAttemptId
  )
    fail("LIVE_ACCEPTANCE_IDENTITY_DRIFT");
  let requestSha256: Sha256 | undefined;
  let externalStarted = false;
  try {
    requestSha256 = await claimRequest({ ...input, expectedScopes: 1 });
    await claimHostedShortPilotSubmission(input.repository, input.admission);
    externalStarted = true;
    const capture = await input.transport.execute(input.request);
    const receipt = await verifyV213LiveReceipt({
      request: input.request,
      verifier: input.receiptVerifier,
      capture,
      expectedProjectDispatchCount: 1,
      expectedMageDispatchCount: 1,
      expectedSoulxDispatchCount: 1,
      now: input.now,
    });
    const acceptance = await acceptHostedShortPilot(
      input.repository,
      input.outputVerifier,
      input.admission,
      { rawEvidence: capture.rawEvidence },
    );
    const result = { liveAcceptanceClaimed: true as const, acceptance, receipt };
    const summary = redactedSummary(receipt, {
      durationSeconds: input.admission.totalFrames / 30,
      operatorIntervention: false,
    });
    return {
      liveAcceptanceClaimed: true,
      acceptance,
      summary,
      completionSha256: await complete(input.store, requestSha256, result),
    };
  } catch (error) {
    if (!requestSha256 || !externalStarted) throw error;
    await cleanFailedAttempt({ ...input, verifier: input.cleanupVerifier, requestSha256 });
    throw error;
  }
}

export async function executeV211LiveConcurrency(input: {
  readonly request: V213LiveExecutionRequest & { readonly checkpoint: "V2-11" };
  readonly evidenceVerifier: HostedV211EvidenceVerifier;
  readonly receiptVerifier: V213LiveReceiptVerifier;
  readonly cleanupVerifier: V213CleanupVerifier;
  readonly store: V213LiveAttemptStore;
  readonly transport: V213LiveTransport;
  readonly now: () => Date;
}): Promise<{
  readonly liveAcceptanceClaimed: true;
  readonly acceptance: HostedV211AcceptanceResult;
  readonly summary: V213RedactedLiveSummary;
  readonly completionSha256: Sha256;
}> {
  let requestSha256: Sha256 | undefined;
  let externalStarted = false;
  try {
    requestSha256 = await claimRequest({ ...input, expectedScopes: 2 });
    externalStarted = true;
    const capture = await input.transport.execute(input.request);
    const receipt = await verifyV213LiveReceipt({
      request: input.request,
      verifier: input.receiptVerifier,
      capture,
      expectedProjectDispatchCount: 2,
      expectedMageDispatchCount: 2,
      expectedSoulxDispatchCount: 2,
      now: input.now,
    });
    const acceptance = await evaluateHostedV211Groundwork({
      rawEvidence: capture.rawEvidence,
      evidenceVerifier: input.evidenceVerifier,
      now: input.now,
    });
    if (
      canonicalSha256(acceptance.accountIds) !==
        canonicalSha256(input.request.scopes.map((scope) => scope.accountId)) ||
      canonicalSha256([...acceptance.terminalProviderJobIds].sort()) !==
        canonicalSha256([...receipt.terminalProviderJobIds].sort())
    )
      fail("LIVE_ACCEPTANCE_IDENTITY_DRIFT");
    const result = { liveAcceptanceClaimed: true as const, acceptance, receipt };
    const summary = redactedSummary(receipt, {
      projectCount: 2,
      concurrent: true,
      ownershipIsolated: true,
    });
    return {
      liveAcceptanceClaimed: true,
      acceptance,
      summary,
      completionSha256: await complete(input.store, requestSha256, result),
    };
  } catch (error) {
    if (!requestSha256 || !externalStarted) throw error;
    await cleanFailedAttempt({ ...input, verifier: input.cleanupVerifier, requestSha256 });
    throw error;
  }
}

export async function executeV212LiveProductionLength(input: {
  readonly request: V213LiveExecutionRequest & { readonly checkpoint: "V2-12" };
  readonly admission: HostedProductionLengthAdmission;
  readonly repository: HostedProductionLengthRepository;
  readonly outputVerifier: HostedProductionOutputVerifier;
  readonly receiptVerifier: V213LiveReceiptVerifier;
  readonly cleanupVerifier: V213CleanupVerifier;
  readonly store: V213LiveAttemptStore;
  readonly transport: V213LiveTransport;
  readonly now: () => Date;
}): Promise<{
  readonly liveAcceptanceClaimed: true;
  readonly acceptanceSha256: Sha256;
  readonly summary: V213RedactedLiveSummary;
  readonly completionSha256: Sha256;
}> {
  const scope = input.request.scopes[0];
  const key = input.admission.document.key;
  if (
    !scope ||
    scope.accountId !== key.accountId ||
    scope.workspaceId !== key.workspaceId ||
    scope.projectId !== key.projectId ||
    scope.projectRevisionId !== key.projectRevisionId ||
    scope.requestSha256 !== input.admission.document.requestSha256 ||
    scope.attemptId !== input.admission.attemptId
  )
    fail("LIVE_ACCEPTANCE_IDENTITY_DRIFT");
  let requestSha256: Sha256 | undefined;
  let externalStarted = false;
  try {
    requestSha256 = await claimRequest({ ...input, expectedScopes: 1 });
    const record = await input.repository.claimOnce(key, input.admission.document.requestSha256);
    if (
      !record ||
      record.state !== "SUBMITTED" ||
      record.submissionCount !== 1 ||
      record.attemptId !== input.admission.attemptId ||
      record.submissionToken !== input.admission.submissionToken
    )
      fail("LIVE_ACCEPTANCE_REPLAY_FORBIDDEN");
    externalStarted = true;
    const capture = await input.transport.execute(input.request);
    const receipt = await verifyV213LiveReceipt({
      request: input.request,
      verifier: input.receiptVerifier,
      capture,
      expectedProjectDispatchCount: 1,
      expectedMageDispatchCount: 1,
      expectedSoulxDispatchCount: 1,
      now: input.now,
    });
    const accepted = await acceptHostedProductionLength({
      repository: input.repository,
      verifier: input.outputVerifier,
      admission: input.admission,
      rawEvidence: capture.rawEvidence,
      now: input.now,
    });
    const result = {
      liveAcceptanceClaimed: true as const,
      acceptanceSha256: accepted.acceptanceSha256,
      receipt,
    };
    const summary = redactedSummary(receipt, {
      durationSeconds: input.admission.document.totalFrames / 30,
    });
    return {
      liveAcceptanceClaimed: true,
      acceptanceSha256: accepted.acceptanceSha256,
      summary,
      completionSha256: await complete(input.store, requestSha256, result),
    };
  } catch (error) {
    if (!requestSha256 || !externalStarted) throw error;
    await cleanFailedAttempt({ ...input, verifier: input.cleanupVerifier, requestSha256 });
    throw error;
  }
}

export async function executeV213FinalLiveAcceptance(input: {
  readonly request: V213LiveExecutionRequest & { readonly checkpoint: "V2-13" };
  readonly releaseIdentity: V213ReleaseIdentity;
  readonly evidenceArtifacts: Readonly<
    Partial<Record<V213ReleaseGate, V213ReleaseEvidenceArtifact>>
  >;
  readonly releaseEvidenceVerifier: V213ReleaseEvidenceVerifier;
  readonly chromeArtifact: V213ChromeAcceptanceArtifact;
  readonly chromeVerifier: V213ChromeAcceptanceVerifier;
  readonly receiptVerifier: V213LiveReceiptVerifier;
  readonly cleanupVerifier: V213CleanupVerifier;
  readonly store: V213LiveAttemptStore;
  readonly transport: V213LiveTransport;
  readonly now: () => Date;
}): Promise<{
  readonly liveAcceptanceClaimed: true;
  readonly ledger: V213ReleaseCertificationLedger;
  readonly summary: V213RedactedLiveSummary;
  readonly completionSha256: Sha256;
}> {
  let requestSha256: Sha256 | undefined;
  let externalStarted = false;
  try {
    requestSha256 = await claimRequest({ ...input, expectedScopes: 1 });
    externalStarted = true;
    const capture = await input.transport.execute(input.request);
    const receipt = await verifyV213LiveReceipt({
      request: input.request,
      verifier: input.receiptVerifier,
      capture,
      expectedProjectDispatchCount: 1,
      expectedMageDispatchCount: 1,
      expectedSoulxDispatchCount: 1,
      now: input.now,
    });
    const scope = input.request.scopes[0]!;
    if (input.request.sourceCommit !== input.releaseIdentity.sourceCommit)
      fail("LIVE_ACCEPTANCE_IDENTITY_DRIFT");
    const releaseIdentitySha256 = hashV213ReleaseIdentity(input.releaseIdentity);
    const expectedCapturedEvidenceSha256 = canonicalSha256({
      schema_version: "videoforge-v213-final-live-capture/v1",
      release_identity_sha256: releaseIdentitySha256,
      evidence_artifacts: input.evidenceArtifacts,
      chrome_evidence_sha256: canonicalSha256(input.chromeArtifact.rawEvidence),
    });
    if (canonicalSha256(capture.rawEvidence) !== expectedCapturedEvidenceSha256)
      fail("LIVE_ACCEPTANCE_IDENTITY_DRIFT");
    const chrome = await input.chromeVerifier.verify(
      structuredClone(input.chromeArtifact.rawEvidence),
    );
    const now = input.now();
    const chromeObservedAt = Date.parse(chrome.observedAt);
    if (
      chrome.verifierId !== "videoforge-v213-real-chrome-acceptance-verifier-v1" ||
      chrome.accepted !== true ||
      chrome.canonicalEvidenceSha256 !== canonicalSha256(input.chromeArtifact.rawEvidence) ||
      !validSha(chrome.verifierSignatureSha256) ||
      chrome.signatureVerified !== true ||
      chrome.releaseIdentitySha256 !== releaseIdentitySha256 ||
      chrome.productionUrlSha256 !== input.releaseIdentity.productionUrlSha256 ||
      chrome.accountId !== scope.accountId ||
      chrome.workspaceId !== scope.workspaceId ||
      chrome.projectId !== scope.projectId ||
      chrome.projectRevisionId !== scope.projectRevisionId ||
      !validSha(chrome.outputSha256) ||
      chrome.browser !== "GOOGLE_CHROME" ||
      chrome.fixtureOrFakeTransportUsed !== false ||
      chrome.playbackPassed !== true ||
      chrome.privateReadbackPassed !== true ||
      Number.isNaN(chromeObservedAt) ||
      chromeObservedAt > now.getTime() ||
      now.getTime() - chromeObservedAt > 24 * 60 * 60 * 1_000
    )
      fail("LIVE_ACCEPTANCE_CHROME_INVALID");
    const ledger = await buildV213ReleaseCertificationLedger({
      releaseIdentity: input.releaseIdentity,
      evidenceArtifacts: input.evidenceArtifacts,
      verifier: input.releaseEvidenceVerifier,
      evaluatedAt: now.toISOString(),
    });
    if (
      ledger.releaseStatus !== "release_certified" ||
      ledger.missingGates.length ||
      ledger.invalidGates.length
    )
      fail("LIVE_ACCEPTANCE_RELEASE_BLOCKED");
    const result = { liveAcceptanceClaimed: true as const, ledger, receipt, chrome };
    const summary = redactedSummary(receipt, { twoLaneSmoke: true });
    return {
      liveAcceptanceClaimed: true,
      ledger,
      summary,
      completionSha256: await complete(input.store, requestSha256, result),
    };
  } catch (error) {
    if (!requestSha256 || !externalStarted) throw error;
    await cleanFailedAttempt({ ...input, verifier: input.cleanupVerifier, requestSha256 });
    throw error;
  }
}

export interface V213LiveAcceptanceAdapterDependencies {
  readonly receiptVerifier: V213LiveReceiptVerifier;
  readonly cleanupVerifier: V213CleanupVerifier;
  readonly store: V213LiveAttemptStore;
  readonly transport: V213LiveTransport;
  readonly now: () => Date;
}

type V213SharedDependencyKey = keyof V213LiveAcceptanceAdapterDependencies;

export type V210LiveAcceptanceCall = Omit<
  Parameters<typeof executeV210LivePilot>[0],
  V213SharedDependencyKey
>;
export type V211LiveAcceptanceCall = Omit<
  Parameters<typeof executeV211LiveConcurrency>[0],
  V213SharedDependencyKey
>;
export type V212LiveAcceptanceCall = Omit<
  Parameters<typeof executeV212LiveProductionLength>[0],
  V213SharedDependencyKey
>;
export type V213FinalLiveAcceptanceCall = Omit<
  Parameters<typeof executeV213FinalLiveAcceptance>[0],
  V213SharedDependencyKey
>;

/** The sole production composition seam. External transports remain injected and unverifiable data is rejected. */
export function createV213LiveAcceptanceAdapter(
  dependencies: V213LiveAcceptanceAdapterDependencies,
) {
  return Object.freeze({
    executeV210: (input: V210LiveAcceptanceCall) =>
      executeV210LivePilot({ ...input, ...dependencies }),
    executeV211: (input: V211LiveAcceptanceCall) =>
      executeV211LiveConcurrency({ ...input, ...dependencies }),
    executeV212: (input: V212LiveAcceptanceCall) =>
      executeV212LiveProductionLength({ ...input, ...dependencies }),
    executeV213: (input: V213FinalLiveAcceptanceCall) =>
      executeV213FinalLiveAcceptance({ ...input, ...dependencies }),
  });
}

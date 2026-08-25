import {
  validateAndHashContractDocument,
  type ResolvedRenderManifestDocument,
} from "@videoforge/contracts";
import type { TechnicalProbeDocument } from "@videoforge/contracts/generated/contract-types.js";
import {
  canonicalSha256,
  digestUtf8,
  type ServerlessLane,
  type Sha256,
} from "@videoforge/control-plane";
import { randomUUID } from "node:crypto";

import type {
  HostedQualificationLineage,
  HostedQualificationVerification,
  HostedQualificationVerifier,
  HostedServerlessLaneBinding,
} from "./hosted-serverless-runtime.js";

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u;
const MAX_AGE_MS = 24 * 60 * 60 * 1_000;

export type HostedShortPilotErrorCode =
  | "SHORT_PILOT_ADMISSION_INVALID"
  | "SHORT_PILOT_QUALIFICATION_REJECTED"
  | "SHORT_PILOT_RENDER_PLAN_INVALID"
  | "SHORT_PILOT_NOT_MIXED"
  | "SHORT_PILOT_DURATION_INVALID"
  | "SHORT_PILOT_VISUAL_GRAMMAR_INVALID"
  | "SHORT_PILOT_CEILING_INVALID"
  | "SHORT_PILOT_DURABLE_CONFLICT"
  | "SHORT_PILOT_SUBMISSION_NOT_EXACTLY_ONCE"
  | "SHORT_PILOT_OUTPUT_NOT_DURABLE"
  | "SHORT_PILOT_READBACK_MISMATCH"
  | "SHORT_PILOT_TECHNICAL_PROBE_INVALID"
  | "SHORT_PILOT_QUALITY_REVIEW_FAILED"
  | "SHORT_PILOT_SETTLEMENT_INVALID"
  | "SHORT_PILOT_NOT_TERMINAL";

export class HostedShortPilotError extends Error {
  constructor(readonly code: HostedShortPilotErrorCode) {
    super(code);
    this.name = "HostedShortPilotError";
  }
}

export interface HostedShortPilotDurableKey {
  readonly accountId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly projectRevisionId: string;
  readonly renderPlanSha256: Sha256;
}

export interface HostedShortPilotAdmissionDocument {
  readonly schemaVersion: "videoforge-hosted-short-pilot-admission-document/v1";
  readonly key: HostedShortPilotDurableKey;
  readonly revisionConfigSha256: Sha256;
  readonly qualificationSha256s: Readonly<Record<ServerlessLane, Sha256>>;
  readonly barrierAcceptanceSha256s: Readonly<Record<ServerlessLane, Sha256>>;
  readonly renderPlanDocument: ResolvedRenderManifestDocument;
  readonly totalFrames: number;
  readonly expectedCutCount: number;
  readonly maximumVariableCostMicroUsd: number;
  readonly maximumWallTimeMs: number;
  readonly forecastVariableCostMicroUsd: number;
  readonly forecastWallTimeMs: number;
  readonly requestSha256: Sha256;
}

export interface HostedShortPilotDurableRecord extends HostedShortPilotDurableKey {
  readonly requestSha256: Sha256;
  readonly admissionDocument: HostedShortPilotAdmissionDocument;
  readonly admissionDocumentSha256: Sha256;
  readonly submissionToken: string;
  readonly submissionTokenSha256: Sha256;
  readonly automaticAttemptId: string;
  readonly state: "READY" | "SUBMITTED" | "ACCEPTED";
  readonly submissionCount: 0 | 1;
  readonly acceptanceSha256: Sha256 | null;
}

export interface HostedShortPilotRepository {
  /**
   * Atomically creates the token and attempt once or returns the exact existing record. A durable
   * implementation must also return the existing tenant/revision record when its plan hash drifts,
   * allowing the caller to reject rather than mint authority for a second plan.
   */
  createOrReplay(
    key: HostedShortPilotDurableKey,
    admissionDocument: HostedShortPilotAdmissionDocument,
  ): Promise<{ readonly record: HostedShortPilotDurableRecord; readonly replayed: boolean }>;
  /** Atomically changes READY to SUBMITTED; every later claim must return null. */
  claimSubmission(
    key: HostedShortPilotDurableKey,
    requestSha256: Sha256,
  ): Promise<HostedShortPilotDurableRecord | null>;
  read(key: HostedShortPilotDurableKey): Promise<HostedShortPilotDurableRecord | null>;
  accept(
    key: HostedShortPilotDurableKey,
    requestSha256: Sha256,
    acceptanceSha256: Sha256,
  ): Promise<HostedShortPilotDurableRecord | null>;
}

export interface HostedShortPilotTransaction {
  findRevision(key: HostedShortPilotDurableKey): Promise<HostedShortPilotDurableRecord | null>;
  insert(record: HostedShortPilotDurableRecord): Promise<boolean>;
  compareAndSet(
    key: HostedShortPilotDurableKey,
    expectedState: HostedShortPilotDurableRecord["state"],
    replacement: HostedShortPilotDurableRecord,
  ): Promise<boolean>;
}

export interface HostedShortPilotTransactionalStore {
  /** Runs work under a serializable durable transaction. */
  transaction<Value>(
    work: (transaction: HostedShortPilotTransaction) => Promise<Value>,
  ): Promise<Value>;
}

/** Provider-free durable adapter; the injected store owns persistence and transaction isolation. */
export function createHostedShortPilotTransactionalRepository(input: {
  readonly store: HostedShortPilotTransactionalStore;
  readonly mint?: () => { readonly submissionToken: string; readonly automaticAttemptId: string };
}): HostedShortPilotRepository {
  const mint =
    input.mint ??
    (() => {
      const id = randomUUID();
      return { submissionToken: `short-pilot:${id}`, automaticAttemptId: `pilot-${id}` };
    });
  const repository: HostedShortPilotRepository = {
    createOrReplay: (key, admissionDocument) =>
      input.store.transaction(async (transaction) => {
        const existing = await transaction.findRevision(key);
        if (existing) return { record: existing, replayed: true };
        const authority = mint();
        const record: HostedShortPilotDurableRecord = {
          ...key,
          requestSha256: admissionDocument.requestSha256,
          admissionDocument,
          admissionDocumentSha256: canonicalSha256(admissionDocument),
          submissionToken: authority.submissionToken,
          submissionTokenSha256: digestUtf8(authority.submissionToken),
          automaticAttemptId: authority.automaticAttemptId,
          state: "READY",
          submissionCount: 0,
          acceptanceSha256: null,
        };
        if (!(await transaction.insert(record))) {
          const raced = await transaction.findRevision(key);
          if (raced) return { record: raced, replayed: true };
          throw new HostedShortPilotError("SHORT_PILOT_DURABLE_CONFLICT");
        }
        return { record, replayed: false };
      }),
    claimSubmission: (key, requestSha256) =>
      input.store.transaction(async (transaction) => {
        const record = await transaction.findRevision(key);
        if (!record || record.requestSha256 !== requestSha256 || record.state !== "READY")
          return null;
        const submitted: HostedShortPilotDurableRecord = {
          ...record,
          state: "SUBMITTED",
          submissionCount: 1,
        };
        return (await transaction.compareAndSet(key, "READY", submitted)) ? submitted : null;
      }),
    read: (key) => input.store.transaction((transaction) => transaction.findRevision(key)),
    accept: (key, requestSha256, acceptanceSha256) =>
      input.store.transaction(async (transaction) => {
        const record = await transaction.findRevision(key);
        if (!record || record.requestSha256 !== requestSha256) return null;
        if (record.state === "ACCEPTED")
          return record.acceptanceSha256 === acceptanceSha256 ? record : null;
        if (record.state !== "SUBMITTED") return null;
        const accepted: HostedShortPilotDurableRecord = {
          ...record,
          state: "ACCEPTED",
          acceptanceSha256,
        };
        return (await transaction.compareAndSet(key, "SUBMITTED", accepted)) ? accepted : null;
      }),
  };
  return Object.freeze(repository);
}

export interface HostedShortPilotAcceptedArtifact {
  readonly assetId: string;
  readonly objectKey: string;
  readonly sha256: Sha256;
  readonly contentType: "image/jpeg" | "image/png" | "video/mp4";
}

export interface HostedShortPilotBarrierVerification {
  readonly verifierId: "videoforge-hosted-output-barrier-verifier-v1";
  readonly accepted: true;
  readonly lane: ServerlessLane;
  readonly checkpointId: "V2-07" | "V2-08";
  readonly attemptId: string;
  readonly canonicalBarrierAcceptanceSha256: Sha256;
  readonly durableInventorySha256: Sha256;
  readonly artifacts: readonly HostedShortPilotAcceptedArtifact[];
  readonly soulxProfile: null | {
    readonly sourceProfile: string;
    readonly fullCrop: string;
    readonly splitCrop: string;
    readonly acceptanceContractSha256: Sha256;
    readonly cropProfileEvidenceSha256: Sha256;
  };
}

export interface HostedShortPilotBarrierVerifier {
  /** Reads and verifies the canonical durable output-barrier acceptance and artifact inventory. */
  verify(input: {
    readonly lane: ServerlessLane;
    readonly accountId: string;
    readonly workspaceId: string;
    readonly projectId: string;
    readonly projectRevisionId: string;
    readonly renderPlanSha256: Sha256;
  }): Promise<HostedShortPilotBarrierVerification>;
}

export interface HostedShortPilotTerminalVerification {
  readonly verifierId: "videoforge-hosted-terminal-inventory-verifier-v1";
  readonly accepted: true;
  readonly canonicalEvidenceSha256: Sha256;
  readonly verifierSignatureSha256: Sha256;
  readonly durableInventorySha256: Sha256;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly projectRevisionId: string;
  readonly attemptId: string;
  readonly submissionTokenSha256: Sha256;
  readonly state: "SUCCEEDED";
  readonly terminalAt: string;
  readonly activeWorkers: 0;
  readonly observedAt: string;
}

export interface HostedShortPilotTerminalVerifier {
  verify(
    evidence: Readonly<Record<string, unknown>>,
  ): Promise<HostedShortPilotTerminalVerification>;
}

export interface HostedShortPilotAdmissionInput {
  readonly accountId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly projectRevisionId: string;
  readonly revisionConfigSha256: Sha256;
  readonly renderPlanDocument: ResolvedRenderManifestDocument;
  readonly qualifications: Readonly<Record<ServerlessLane, HostedServerlessLaneBinding>>;
  readonly ceiling: {
    readonly maximumVariableCostMicroUsd: number;
    readonly maximumWallTimeMs: number;
  };
  readonly forecast: { readonly variableCostMicroUsd: number; readonly wallTimeMs: number };
}

export interface HostedShortPilotAdmission {
  readonly schemaVersion: "videoforge-hosted-short-pilot-admission/v2";
  readonly groundworkOnly: true;
  readonly key: HostedShortPilotDurableKey;
  readonly revisionConfigSha256: Sha256;
  readonly qualificationSha256s: Readonly<Record<ServerlessLane, Sha256>>;
  readonly barrierAcceptanceSha256s: Readonly<Record<ServerlessLane, Sha256>>;
  readonly totalFrames: number;
  readonly expectedCutCount: number;
  readonly maximumVariableCostMicroUsd: number;
  readonly maximumWallTimeMs: number;
  readonly requestSha256: Sha256;
  readonly submissionToken: string;
  readonly submissionTokenSha256: Sha256;
  readonly automaticAttemptId: string;
  readonly submissionState: HostedShortPilotDurableRecord["state"];
  readonly submissionCount: 0 | 1;
  readonly replayed: boolean;
}

export interface HostedShortPilotAcceptanceEvidence {
  readonly rawEvidence: Readonly<Record<string, unknown>>;
}

export interface HostedShortPilotOutputVerification {
  readonly verifierId: "videoforge-hosted-short-pilot-output-verifier-v1";
  readonly accepted: true;
  readonly canonicalEvidenceSha256: Sha256;
  readonly verifierSignatureSha256: Sha256;
  readonly durableInventorySha256: Sha256;
  readonly output: {
    readonly state: "COMMITTED";
    readonly assetId: string;
    readonly objectKey: string;
    readonly sha256: Sha256;
    readonly bytes: number;
    readonly contentType: "video/mp4";
    readonly artifactCommitReceiptSha256: Sha256;
  };
  readonly privateReadback: {
    readonly state: "GET_REHASH_SUCCEEDED";
    readonly sha256: Sha256;
    readonly bytes: number;
    readonly contentType: string;
    readonly readbackReceiptSha256: Sha256;
  };
  readonly technicalProbe: TechnicalProbeDocument;
  readonly qualityReview: {
    readonly state: "ACCEPTED";
    readonly reviewArtifactSha256: Sha256;
    readonly reviewedCutCount: number;
    readonly everyCutReviewed: boolean;
    readonly noManualMediaEditOrSubstitution: boolean;
    readonly literalRelevance: "PASSED" | "FAILED";
    readonly imageRealism: "PASSED" | "FAILED";
    readonly avatarIdentityAndCrop: "PASSED" | "FAILED";
    readonly lipSync: "PASSED" | "FAILED";
    readonly audioVideoQuality: "PASSED" | "FAILED";
    readonly prohibitedGraphicsAbsent: "PASSED" | "FAILED";
    readonly hardCutsOnly: "PASSED" | "FAILED";
    readonly requiredImageZoom: "PASSED" | "FAILED";
  };
  readonly settlement: {
    readonly state: "SETTLED" | "UNSETTLED";
    readonly variableCostMicroUsd: number;
    readonly possibleDuplicateCostMicroUsd: number;
    readonly elapsedWallTimeMs: number;
  };
  /** Opaque signed/provider inventory evidence; only the injected verifier result is trusted. */
  readonly terminal: HostedShortPilotTerminalVerification;
}

export interface HostedShortPilotOutputVerifier {
  verify(evidence: Readonly<Record<string, unknown>>): Promise<HostedShortPilotOutputVerification>;
}

export interface HostedShortPilotAcceptance {
  readonly schemaVersion: "videoforge-hosted-short-pilot-acceptance/v2";
  readonly groundworkOnly: true;
  readonly liveAcceptanceClaimed: false;
  readonly requestSha256: Sha256;
  readonly outputSha256: Sha256;
  readonly technicalProbeSha256: Sha256;
  readonly qualityReviewSha256: Sha256;
  readonly acceptanceSha256: Sha256;
}

const validId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(value);
const validSha = (value: unknown): value is Sha256 =>
  typeof value === "string" && SHA256.test(value);
const positiveInt = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) > 0;
const nonnegativeInt = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;

export function hostedShortPilotAdmissionRequestSha256(
  document: Omit<HostedShortPilotAdmissionDocument, "schemaVersion" | "requestSha256">,
): Sha256 {
  return canonicalSha256({
    schema_version: "videoforge-hosted-short-pilot-admission-request/v2",
    key: document.key,
    revision_config_sha256: document.revisionConfigSha256,
    qualification_sha256s: document.qualificationSha256s,
    barrier_acceptance_sha256s: document.barrierAcceptanceSha256s,
    render_plan_document: document.renderPlanDocument,
    total_frames: document.totalFrames,
    expected_cut_count: document.expectedCutCount,
    maximum_variable_cost_micro_usd: document.maximumVariableCostMicroUsd,
    maximum_wall_time_ms: document.maximumWallTimeMs,
    forecast: {
      variable_cost_micro_usd: document.forecastVariableCostMicroUsd,
      wall_time_ms: document.forecastWallTimeMs,
    },
  });
}

function exactDurableRecord(
  record: HostedShortPilotDurableRecord,
  key: HostedShortPilotDurableKey,
  requestSha256: Sha256,
  expected?: { readonly token: string; readonly attemptId: string },
): boolean {
  const stateValid =
    (record.state === "READY" &&
      record.submissionCount === 0 &&
      record.acceptanceSha256 === null) ||
    (record.state === "SUBMITTED" &&
      record.submissionCount === 1 &&
      record.acceptanceSha256 === null) ||
    (record.state === "ACCEPTED" &&
      record.submissionCount === 1 &&
      validSha(record.acceptanceSha256));
  return (
    record.accountId === key.accountId &&
    record.workspaceId === key.workspaceId &&
    record.projectId === key.projectId &&
    record.projectRevisionId === key.projectRevisionId &&
    record.renderPlanSha256 === key.renderPlanSha256 &&
    record.requestSha256 === requestSha256 &&
    record.admissionDocument.requestSha256 === requestSha256 &&
    canonicalSha256(record.admissionDocument) === record.admissionDocumentSha256 &&
    record.admissionDocument.key.accountId === key.accountId &&
    record.admissionDocument.key.workspaceId === key.workspaceId &&
    record.admissionDocument.key.projectId === key.projectId &&
    record.admissionDocument.key.projectRevisionId === key.projectRevisionId &&
    record.admissionDocument.key.renderPlanSha256 === key.renderPlanSha256 &&
    typeof record.submissionToken === "string" &&
    record.submissionToken.length >= 32 &&
    record.submissionToken.length <= 512 &&
    digestUtf8(record.submissionToken) === record.submissionTokenSha256 &&
    validId(record.automaticAttemptId) &&
    (expected === undefined ||
      (record.submissionToken === expected.token &&
        record.automaticAttemptId === expected.attemptId)) &&
    stateValid
  );
}

function sameLineage(binding: HostedServerlessLaneBinding, lineage: HostedQualificationLineage) {
  const deployment = binding.deployment;
  const sealed = deployment.timeoutEvidence.sealed_lineage;
  return (
    binding.transportEndpointIdSha256 === deployment.endpointIdSha256 &&
    lineage.endpointIdSha256 === deployment.endpointIdSha256 &&
    deployment.endpointProfileId === `template:${lineage.endpointTemplateIdSha256}` &&
    lineage.endpointConfigSha256 === deployment.endpointConfigSha256 &&
    lineage.workerImageDigest === deployment.workerImageDigest &&
    lineage.modelManifestSha256 === deployment.modelManifestSha256 &&
    lineage.volumeIdSha256 === deployment.volumeIdSha256 &&
    lineage.volumeManifestSha256 === deployment.volumeManifestSha256 &&
    typeof sealed === "object" &&
    sealed !== null &&
    !Array.isArray(sealed) &&
    canonicalSha256(sealed as Readonly<Record<string, unknown>>) ===
      canonicalSha256(lineage as unknown as Readonly<Record<string, unknown>>) &&
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
    ].every(validSha) &&
    lineage.region === "EU-RO-1" &&
    lineage.gpu === "NVIDIA GeForce RTX 4090"
  );
}

function exactDate(value: string): number | null {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
    ? timestamp
    : null;
}

async function verifiedQualificationHashes(
  candidate: HostedShortPilotAdmissionInput,
  verifier: HostedQualificationVerifier,
  now: Date,
): Promise<{
  readonly hashes: Readonly<Record<ServerlessLane, Sha256>>;
  readonly verifications: Readonly<Record<ServerlessLane, HostedQualificationVerification>>;
}> {
  const hashes = {} as Record<ServerlessLane, Sha256>;
  const verifications = {} as Record<ServerlessLane, HostedQualificationVerification>;
  for (const lane of ["mage_image", "soulx_avatar"] as const) {
    const binding = candidate.qualifications[lane];
    let verification: HostedQualificationVerification;
    try {
      verification = await verifier.verify(binding.qualificationArtifact);
    } catch {
      throw new HostedShortPilotError("SHORT_PILOT_QUALIFICATION_REJECTED");
    }
    const artifactSha256 = canonicalSha256(binding.qualificationArtifact);
    const verifiedAt = exactDate(verification.verifiedAt);
    const expiresAt = exactDate(verification.expiresAt);
    const nowMs = now.getTime();
    if (
      verification.verifierId !== "videoforge-independent-qualification-v1" ||
      verification.accepted !== true ||
      verification.lane !== lane ||
      verification.checkpointId !== (lane === "mage_image" ? "V2-07" : "V2-08") ||
      verification.canonicalArtifactSha256 !== artifactSha256 ||
      binding.deployment.lane !== lane ||
      binding.deployment.deploymentVersion < 1 ||
      binding.deployment.maxReplacementAttempts < 0 ||
      !sameLineage(binding, verification.lineage) ||
      verifiedAt === null ||
      expiresAt === null ||
      !Number.isFinite(nowMs) ||
      expiresAt <= verifiedAt ||
      expiresAt - verifiedAt > MAX_AGE_MS ||
      verifiedAt > nowMs ||
      expiresAt <= nowMs
    ) {
      throw new HostedShortPilotError("SHORT_PILOT_QUALIFICATION_REJECTED");
    }
    hashes[lane] = canonicalSha256({ artifact_sha256: artifactSha256, verification });
    verifications[lane] = verification;
  }
  return Object.freeze({
    hashes: Object.freeze(hashes),
    verifications: Object.freeze(verifications),
  });
}

function validatePlan(plan: ResolvedRenderManifestDocument): void {
  let nextFrame = 0;
  let hasMage = false;
  let hasSoulx = false;
  for (const segment of plan.segments) {
    if (segment.start_frame !== nextFrame || segment.end_frame_exclusive <= segment.start_frame) {
      throw new HostedShortPilotError("SHORT_PILOT_VISUAL_GRAMMAR_INVALID");
    }
    nextFrame = segment.end_frame_exclusive;
    if (segment.timeline_composition === "IMAGE_FULL") {
      hasMage = true;
      if (segment.render.zoom_profile !== "image-full-zoom-v3")
        throw new HostedShortPilotError("SHORT_PILOT_VISUAL_GRAMMAR_INVALID");
    } else if (segment.timeline_composition === "AVATAR_FULL") {
      hasSoulx = true;
    } else {
      hasMage = true;
      hasSoulx = true;
      if (segment.render.right_image_zoom_profile !== "split-right-zoom-v3")
        throw new HostedShortPilotError("SHORT_PILOT_VISUAL_GRAMMAR_INVALID");
    }
  }
  if (!hasMage || !hasSoulx) throw new HostedShortPilotError("SHORT_PILOT_NOT_MIXED");
  if (
    plan.output.fps_num !== 30 ||
    plan.output.fps_den !== 1 ||
    plan.total_frames < 5_400 ||
    plan.total_frames > 9_000 ||
    nextFrame !== plan.total_frames
  )
    throw new HostedShortPilotError("SHORT_PILOT_DURATION_INVALID");
}

async function verifyBarrierArtifacts(input: {
  readonly candidate: HostedShortPilotAdmissionInput;
  readonly plan: ResolvedRenderManifestDocument;
  readonly renderPlanSha256: Sha256;
  readonly qualificationVerifications: Readonly<
    Record<ServerlessLane, HostedQualificationVerification>
  >;
  readonly verifier: HostedShortPilotBarrierVerifier;
}): Promise<Readonly<Record<ServerlessLane, Sha256>>> {
  const expected = {
    mage_image: new Map<string, Sha256>(),
    soulx_avatar: new Map<string, Sha256>(),
  };
  for (const segment of input.plan.segments) {
    if (segment.timeline_composition === "IMAGE_FULL") {
      expected.mage_image.set(
        segment.accepted_assets.image.asset_id,
        segment.accepted_assets.image.sha256 as Sha256,
      );
    } else if (segment.timeline_composition === "AVATAR_FULL") {
      expected.soulx_avatar.set(
        segment.accepted_assets.avatar.asset_id,
        segment.accepted_assets.avatar.sha256 as Sha256,
      );
    } else {
      expected.soulx_avatar.set(
        segment.accepted_assets.avatar.asset_id,
        segment.accepted_assets.avatar.sha256 as Sha256,
      );
      expected.mage_image.set(
        segment.accepted_assets.right_image.asset_id,
        segment.accepted_assets.right_image.sha256 as Sha256,
      );
    }
  }

  const hashes = {} as Record<ServerlessLane, Sha256>;
  for (const lane of ["mage_image", "soulx_avatar"] as const) {
    let verified: HostedShortPilotBarrierVerification;
    try {
      verified = await input.verifier.verify({
        lane,
        accountId: input.candidate.accountId,
        workspaceId: input.candidate.workspaceId,
        projectId: input.candidate.projectId,
        projectRevisionId: input.candidate.projectRevisionId,
        renderPlanSha256: input.renderPlanSha256,
      });
    } catch {
      throw new HostedShortPilotError("SHORT_PILOT_QUALIFICATION_REJECTED");
    }
    const expectedArtifacts = expected[lane];
    const seen = new Set<string>();
    if (
      verified.verifierId !== "videoforge-hosted-output-barrier-verifier-v1" ||
      verified.accepted !== true ||
      verified.lane !== lane ||
      verified.checkpointId !== (lane === "mage_image" ? "V2-07" : "V2-08") ||
      !validId(verified.attemptId) ||
      !validSha(verified.canonicalBarrierAcceptanceSha256) ||
      !validSha(verified.durableInventorySha256) ||
      verified.artifacts.length !== expectedArtifacts.size
    )
      throw new HostedShortPilotError("SHORT_PILOT_QUALIFICATION_REJECTED");
    for (const artifact of verified.artifacts) {
      const expectedSha256 = expectedArtifacts.get(artifact.assetId);
      const lanePath = lane.replace("_", "-");
      const expectedObjectKey =
        `tenant/${input.candidate.accountId}/workspace/${input.candidate.workspaceId}` +
        `/project/${input.candidate.projectId}/revision/${input.candidate.projectRevisionId}` +
        `/lane/${lanePath}/job/${verified.attemptId}/artifact/${artifact.assetId}`;
      if (
        !expectedSha256 ||
        seen.has(artifact.assetId) ||
        artifact.sha256 !== expectedSha256 ||
        artifact.objectKey !== expectedObjectKey ||
        (lane === "mage_image"
          ? !["image/jpeg", "image/png"].includes(artifact.contentType)
          : artifact.contentType !== "video/mp4")
      )
        throw new HostedShortPilotError("SHORT_PILOT_QUALIFICATION_REJECTED");
      seen.add(artifact.assetId);
    }
    if (
      seen.size !== expectedArtifacts.size ||
      [...expectedArtifacts.keys()].some((assetId) => !seen.has(assetId))
    )
      throw new HostedShortPilotError("SHORT_PILOT_QUALIFICATION_REJECTED");
    if (lane === "mage_image") {
      if (verified.soulxProfile !== null)
        throw new HostedShortPilotError("SHORT_PILOT_QUALIFICATION_REJECTED");
    } else {
      const profile = verified.soulxProfile;
      const profileMatchesPlan = input.plan.segments.every((segment) => {
        if (segment.timeline_composition === "IMAGE_FULL") return true;
        const expectedCrop =
          segment.timeline_composition === "AVATAR_FULL" ? profile?.fullCrop : profile?.splitCrop;
        return (
          profile !== null &&
          segment.render.avatar_source_profile === profile.sourceProfile &&
          segment.render.avatar_crop === expectedCrop
        );
      });
      if (
        !profile ||
        !profileMatchesPlan ||
        !validSha(profile.cropProfileEvidenceSha256) ||
        profile.acceptanceContractSha256 !==
          input.qualificationVerifications.soulx_avatar.lineage.acceptanceContractSha256
      )
        throw new HostedShortPilotError("SHORT_PILOT_QUALIFICATION_REJECTED");
      // Even exact evidence cannot turn a legacy schema enum into an approved SoulX profile. The
      // future canonical contract revision must add that exact profile before this path can admit.
      throw new HostedShortPilotError("SHORT_PILOT_QUALIFICATION_REJECTED");
    }
    hashes[lane] = canonicalSha256(verified);
  }
  return Object.freeze(hashes);
}

export async function admitHostedShortPilot(input: {
  readonly repository: HostedShortPilotRepository;
  readonly verifier: HostedQualificationVerifier;
  readonly barrierVerifier: HostedShortPilotBarrierVerifier;
  readonly candidate: HostedShortPilotAdmissionInput;
  readonly now?: () => Date;
}): Promise<HostedShortPilotAdmission> {
  const candidate = input.candidate;
  if (
    ![
      candidate.accountId,
      candidate.workspaceId,
      candidate.projectId,
      candidate.projectRevisionId,
    ].every(validId) ||
    !validSha(candidate.revisionConfigSha256)
  )
    throw new HostedShortPilotError("SHORT_PILOT_ADMISSION_INVALID");
  let plan: Awaited<ReturnType<typeof validateAndHashContractDocument<"resolvedRenderManifest">>>;
  try {
    plan = await validateAndHashContractDocument(
      "resolvedRenderManifest",
      candidate.renderPlanDocument,
    );
  } catch {
    throw new HostedShortPilotError("SHORT_PILOT_RENDER_PLAN_INVALID");
  }
  if (
    plan.value.project_revision_id !== candidate.projectRevisionId ||
    plan.value.revision_config_hash !== candidate.revisionConfigSha256
  )
    throw new HostedShortPilotError("SHORT_PILOT_RENDER_PLAN_INVALID");
  validatePlan(plan.value);
  if (
    !positiveInt(candidate.ceiling.maximumVariableCostMicroUsd) ||
    !positiveInt(candidate.ceiling.maximumWallTimeMs) ||
    !nonnegativeInt(candidate.forecast.variableCostMicroUsd) ||
    !positiveInt(candidate.forecast.wallTimeMs) ||
    candidate.forecast.variableCostMicroUsd > candidate.ceiling.maximumVariableCostMicroUsd ||
    candidate.forecast.wallTimeMs > candidate.ceiling.maximumWallTimeMs
  )
    throw new HostedShortPilotError("SHORT_PILOT_CEILING_INVALID");
  const qualifications = await verifiedQualificationHashes(
    candidate,
    input.verifier,
    input.now?.() ?? new Date(),
  );
  const key = Object.freeze({
    accountId: candidate.accountId,
    workspaceId: candidate.workspaceId,
    projectId: candidate.projectId,
    projectRevisionId: candidate.projectRevisionId,
    renderPlanSha256: plan.sha256,
  });
  const barrierAcceptanceSha256s = await verifyBarrierArtifacts({
    candidate,
    plan: plan.value,
    renderPlanSha256: plan.sha256,
    qualificationVerifications: qualifications.verifications,
    verifier: input.barrierVerifier,
  });
  const admissionBase = {
    key,
    revisionConfigSha256: candidate.revisionConfigSha256,
    qualificationSha256s: qualifications.hashes,
    barrierAcceptanceSha256s,
    renderPlanDocument: plan.value,
    totalFrames: plan.value.total_frames,
    expectedCutCount: plan.value.segments.length - 1,
    maximumVariableCostMicroUsd: candidate.ceiling.maximumVariableCostMicroUsd,
    maximumWallTimeMs: candidate.ceiling.maximumWallTimeMs,
    forecastVariableCostMicroUsd: candidate.forecast.variableCostMicroUsd,
    forecastWallTimeMs: candidate.forecast.wallTimeMs,
  } as const;
  const requestSha256 = hostedShortPilotAdmissionRequestSha256(admissionBase);
  const admissionDocument: HostedShortPilotAdmissionDocument = Object.freeze({
    schemaVersion: "videoforge-hosted-short-pilot-admission-document/v1",
    ...admissionBase,
    requestSha256,
  });
  const durable = await input.repository.createOrReplay(key, admissionDocument);
  if (!exactDurableRecord(durable.record, key, requestSha256))
    throw new HostedShortPilotError("SHORT_PILOT_DURABLE_CONFLICT");
  return Object.freeze({
    schemaVersion: "videoforge-hosted-short-pilot-admission/v2",
    groundworkOnly: true,
    key,
    revisionConfigSha256: candidate.revisionConfigSha256,
    qualificationSha256s: qualifications.hashes,
    barrierAcceptanceSha256s,
    totalFrames: plan.value.total_frames,
    expectedCutCount: plan.value.segments.length - 1,
    maximumVariableCostMicroUsd: candidate.ceiling.maximumVariableCostMicroUsd,
    maximumWallTimeMs: candidate.ceiling.maximumWallTimeMs,
    requestSha256,
    submissionToken: durable.record.submissionToken,
    submissionTokenSha256: durable.record.submissionTokenSha256,
    automaticAttemptId: durable.record.automaticAttemptId,
    submissionState: durable.record.state,
    submissionCount: durable.record.submissionCount,
    replayed: durable.replayed,
  });
}

export async function claimHostedShortPilotSubmission(
  repository: HostedShortPilotRepository,
  admission: HostedShortPilotAdmission,
): Promise<HostedShortPilotDurableRecord> {
  const record = await repository.claimSubmission(admission.key, admission.requestSha256);
  if (
    !record ||
    !exactDurableRecord(record, admission.key, admission.requestSha256, {
      token: admission.submissionToken,
      attemptId: admission.automaticAttemptId,
    }) ||
    record.state !== "SUBMITTED" ||
    record.submissionCount !== 1
  )
    throw new HostedShortPilotError("SHORT_PILOT_SUBMISSION_NOT_EXACTLY_ONCE");
  return record;
}

function validateQuality(
  admission: HostedShortPilotAdmission,
  review: HostedShortPilotOutputVerification["qualityReview"],
) {
  const gates = [
    review.literalRelevance,
    review.imageRealism,
    review.avatarIdentityAndCrop,
    review.lipSync,
    review.audioVideoQuality,
    review.prohibitedGraphicsAbsent,
    review.hardCutsOnly,
    review.requiredImageZoom,
  ];
  if (
    review.state !== "ACCEPTED" ||
    !validSha(review.reviewArtifactSha256) ||
    review.reviewedCutCount !== admission.expectedCutCount ||
    !review.everyCutReviewed ||
    !review.noManualMediaEditOrSubstitution ||
    gates.some((gate) => gate !== "PASSED")
  )
    throw new HostedShortPilotError("SHORT_PILOT_QUALITY_REVIEW_FAILED");
}

async function validateDurableAdmission(
  record: HostedShortPilotDurableRecord,
  caller: HostedShortPilotAdmission,
): Promise<HostedShortPilotAdmissionDocument> {
  const document = record.admissionDocument;
  let plan: Awaited<ReturnType<typeof validateAndHashContractDocument<"resolvedRenderManifest">>>;
  try {
    plan = await validateAndHashContractDocument(
      "resolvedRenderManifest",
      document.renderPlanDocument,
    );
  } catch {
    throw new HostedShortPilotError("SHORT_PILOT_DURABLE_CONFLICT");
  }
  const hashesMatch = (
    left: Readonly<Record<ServerlessLane, Sha256>>,
    right: Readonly<Record<ServerlessLane, Sha256>>,
  ) => left.mage_image === right.mage_image && left.soulx_avatar === right.soulx_avatar;
  if (
    document.schemaVersion !== "videoforge-hosted-short-pilot-admission-document/v1" ||
    plan.sha256 !== document.key.renderPlanSha256 ||
    plan.value.project_revision_id !== document.key.projectRevisionId ||
    plan.value.revision_config_hash !== document.revisionConfigSha256 ||
    document.totalFrames !== plan.value.total_frames ||
    document.expectedCutCount !== plan.value.segments.length - 1 ||
    hostedShortPilotAdmissionRequestSha256({
      key: document.key,
      revisionConfigSha256: document.revisionConfigSha256,
      qualificationSha256s: document.qualificationSha256s,
      barrierAcceptanceSha256s: document.barrierAcceptanceSha256s,
      renderPlanDocument: plan.value,
      totalFrames: document.totalFrames,
      expectedCutCount: document.expectedCutCount,
      maximumVariableCostMicroUsd: document.maximumVariableCostMicroUsd,
      maximumWallTimeMs: document.maximumWallTimeMs,
      forecastVariableCostMicroUsd: document.forecastVariableCostMicroUsd,
      forecastWallTimeMs: document.forecastWallTimeMs,
    }) !== document.requestSha256 ||
    caller.requestSha256 !== document.requestSha256 ||
    caller.revisionConfigSha256 !== document.revisionConfigSha256 ||
    caller.totalFrames !== document.totalFrames ||
    caller.expectedCutCount !== document.expectedCutCount ||
    caller.maximumVariableCostMicroUsd !== document.maximumVariableCostMicroUsd ||
    caller.maximumWallTimeMs !== document.maximumWallTimeMs ||
    !hashesMatch(caller.qualificationSha256s, document.qualificationSha256s) ||
    !hashesMatch(caller.barrierAcceptanceSha256s, document.barrierAcceptanceSha256s)
  )
    throw new HostedShortPilotError("SHORT_PILOT_DURABLE_CONFLICT");
  validatePlan(plan.value);
  return document;
}

export async function acceptHostedShortPilot(
  repository: HostedShortPilotRepository,
  outputVerifier: HostedShortPilotOutputVerifier,
  admission: HostedShortPilotAdmission,
  evidence: HostedShortPilotAcceptanceEvidence,
): Promise<HostedShortPilotAcceptance> {
  const durable = await repository.read(admission.key);
  if (
    !durable ||
    !exactDurableRecord(durable, admission.key, admission.requestSha256, {
      token: admission.submissionToken,
      attemptId: admission.automaticAttemptId,
    }) ||
    !["SUBMITTED", "ACCEPTED"].includes(durable.state) ||
    durable.submissionCount !== 1
  )
    throw new HostedShortPilotError("SHORT_PILOT_SUBMISSION_NOT_EXACTLY_ONCE");
  const durableDocument = await validateDurableAdmission(durable, admission);
  let verified: HostedShortPilotOutputVerification;
  try {
    verified = await outputVerifier.verify(evidence.rawEvidence);
  } catch {
    throw new HostedShortPilotError("SHORT_PILOT_OUTPUT_NOT_DURABLE");
  }
  if (
    verified.verifierId !== "videoforge-hosted-short-pilot-output-verifier-v1" ||
    verified.accepted !== true ||
    verified.canonicalEvidenceSha256 !== canonicalSha256(evidence.rawEvidence) ||
    !validSha(verified.verifierSignatureSha256) ||
    !validSha(verified.durableInventorySha256)
  )
    throw new HostedShortPilotError("SHORT_PILOT_OUTPUT_NOT_DURABLE");
  const output = verified.output;
  const privateReadback = verified.privateReadback;
  const expectedKey =
    `tenant/${admission.key.accountId}/workspace/${admission.key.workspaceId}` +
    `/project/${admission.key.projectId}/revision/${admission.key.projectRevisionId}` +
    `/lane/render/job/${admission.automaticAttemptId}/artifact/${output.assetId}.mp4`;
  if (
    output.state !== "COMMITTED" ||
    !validId(output.assetId) ||
    output.objectKey !== expectedKey ||
    !validSha(output.sha256) ||
    !positiveInt(output.bytes) ||
    output.contentType !== "video/mp4" ||
    !validSha(output.artifactCommitReceiptSha256)
  )
    throw new HostedShortPilotError("SHORT_PILOT_OUTPUT_NOT_DURABLE");
  if (
    privateReadback.state !== "GET_REHASH_SUCCEEDED" ||
    privateReadback.sha256 !== output.sha256 ||
    privateReadback.bytes !== output.bytes ||
    privateReadback.contentType !== output.contentType ||
    !validSha(privateReadback.readbackReceiptSha256)
  )
    throw new HostedShortPilotError("SHORT_PILOT_READBACK_MISMATCH");
  let probe: Awaited<ReturnType<typeof validateAndHashContractDocument<"technicalProbe">>>;
  try {
    probe = await validateAndHashContractDocument("technicalProbe", verified.technicalProbe);
  } catch {
    throw new HostedShortPilotError("SHORT_PILOT_TECHNICAL_PROBE_INVALID");
  }
  if (
    probe.value.asset_id !== output.assetId ||
    probe.value.sha256 !== output.sha256 ||
    probe.value.bytes !== output.bytes ||
    probe.value.total_frames !== durableDocument.totalFrames ||
    probe.value.duration_ms * 30 !== durableDocument.totalFrames * 1000
  )
    throw new HostedShortPilotError("SHORT_PILOT_TECHNICAL_PROBE_INVALID");
  validateQuality(admission, verified.qualityReview);
  if (
    verified.settlement.state !== "SETTLED" ||
    !nonnegativeInt(verified.settlement.variableCostMicroUsd) ||
    verified.settlement.variableCostMicroUsd > durableDocument.maximumVariableCostMicroUsd ||
    verified.settlement.possibleDuplicateCostMicroUsd !== 0 ||
    !positiveInt(verified.settlement.elapsedWallTimeMs) ||
    verified.settlement.elapsedWallTimeMs > durableDocument.maximumWallTimeMs
  )
    throw new HostedShortPilotError("SHORT_PILOT_SETTLEMENT_INVALID");
  const terminal = verified.terminal;
  const terminalAt = exactDate(terminal.terminalAt);
  const observedAt = exactDate(terminal.observedAt);
  if (
    terminal.verifierId !== "videoforge-hosted-terminal-inventory-verifier-v1" ||
    terminal.accepted !== true ||
    terminal.canonicalEvidenceSha256 !== verified.canonicalEvidenceSha256 ||
    terminal.verifierSignatureSha256 !== verified.verifierSignatureSha256 ||
    terminal.durableInventorySha256 !== verified.durableInventorySha256 ||
    terminal.accountId !== admission.key.accountId ||
    terminal.workspaceId !== admission.key.workspaceId ||
    terminal.projectId !== admission.key.projectId ||
    terminal.projectRevisionId !== admission.key.projectRevisionId ||
    terminal.attemptId !== admission.automaticAttemptId ||
    terminal.submissionTokenSha256 !== admission.submissionTokenSha256 ||
    terminal.state !== "SUCCEEDED" ||
    !UTC.test(terminal.terminalAt) ||
    !UTC.test(terminal.observedAt) ||
    terminalAt === null ||
    observedAt === null ||
    terminal.activeWorkers !== 0 ||
    observedAt < terminalAt
  )
    throw new HostedShortPilotError("SHORT_PILOT_NOT_TERMINAL");
  const qualityReviewSha256 = canonicalSha256(verified.qualityReview);
  const payload = {
    schema_version: "videoforge-hosted-short-pilot-acceptance/v2",
    groundwork_only: true,
    live_acceptance_claimed: false,
    request_sha256: admission.requestSha256,
    admission_document_sha256: durable.admissionDocumentSha256,
    output,
    private_readback: privateReadback,
    technical_probe_sha256: probe.sha256,
    quality_review_sha256: qualityReviewSha256,
    settlement: verified.settlement,
    terminal_inventory_verification: terminal,
  } as const;
  const acceptanceSha256 = canonicalSha256(payload);
  const accepted = await repository.accept(
    admission.key,
    admission.requestSha256,
    acceptanceSha256,
  );
  if (
    !accepted ||
    !exactDurableRecord(accepted, admission.key, admission.requestSha256, {
      token: admission.submissionToken,
      attemptId: admission.automaticAttemptId,
    }) ||
    accepted.state !== "ACCEPTED" ||
    accepted.acceptanceSha256 !== acceptanceSha256
  )
    throw new HostedShortPilotError("SHORT_PILOT_DURABLE_CONFLICT");
  return Object.freeze({
    schemaVersion: payload.schema_version,
    groundworkOnly: true,
    liveAcceptanceClaimed: false,
    requestSha256: admission.requestSha256,
    outputSha256: output.sha256,
    technicalProbeSha256: probe.sha256,
    qualityReviewSha256,
    acceptanceSha256,
  });
}

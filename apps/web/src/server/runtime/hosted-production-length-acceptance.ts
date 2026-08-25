import {
  validateAndHashContractDocument,
  type ResolvedRenderManifestDocument,
} from "@videoforge/contracts";
import type { TechnicalProbeDocument } from "@videoforge/contracts/generated/contract-types.js";
import { canonicalSha256, digestUtf8, type Sha256 } from "@videoforge/control-plane";

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const TOKEN = /^[A-Za-z0-9._:-]{32,512}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const MIN_FRAMES = 52_200;
const MAX_FRAMES = 55_800;
const TARGET_COST_MICRO_USD = 1_000_000;
const HARD_COST_CEILING_MICRO_USD = 2_000_000;
const FIXED_VOLUME_MONTHLY_MICRO_USD = 7_000_000;
const MAX_VERIFIER_AGE_MS = 24 * 60 * 60 * 1_000;
const LEGACY_AVATAR_PROFILES = new Set([
  "local-fixture-centered-832x480p25-v1",
  "avatarforcing-centered-832x480p25-v1",
  "skyreels-centered-960x960p25-v2",
  "echomimic-v3-flash-turbo-fp8-centered-1024x560p25-v1",
]);

export type HostedProductionLengthErrorCode =
  | "PRODUCTION_LENGTH_PLAN_INVALID"
  | "PRODUCTION_LENGTH_NOT_MIXED"
  | "PRODUCTION_LENGTH_VISUAL_GRAMMAR_INVALID"
  | "PRODUCTION_LENGTH_SOULX_UNQUALIFIED"
  | "PRODUCTION_LENGTH_QUALIFICATION_INVALID"
  | "PRODUCTION_LENGTH_DURABLE_CONFLICT"
  | "PRODUCTION_LENGTH_NOT_SUBMITTED_ONCE"
  | "PRODUCTION_LENGTH_OUTPUT_INVALID"
  | "PRODUCTION_LENGTH_MEASUREMENT_INVALID"
  | "PRODUCTION_LENGTH_COST_INVALID"
  | "PRODUCTION_LENGTH_REVIEW_INVALID"
  | "PRODUCTION_LENGTH_NOT_TERMINAL";

export class HostedProductionLengthError extends Error {
  constructor(readonly code: HostedProductionLengthErrorCode) {
    super(code);
    this.name = "HostedProductionLengthError";
  }
}

export interface HostedProductionLengthKey {
  readonly accountId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly projectRevisionId: string;
  readonly renderPlanSha256: Sha256;
}

export interface HostedProductionLengthAdmissionDocument {
  readonly schemaVersion: "videoforge-hosted-production-length-admission/v1";
  readonly groundworkOnly: true;
  readonly liveAcceptanceClaimed: false;
  readonly key: HostedProductionLengthKey;
  readonly revisionConfigSha256: Sha256;
  readonly renderPlanDocument: ResolvedRenderManifestDocument;
  readonly qualificationEvidenceSha256: Sha256;
  readonly totalFrames: number;
  readonly expectedCutCount: number;
  readonly targetVariableCostMicroUsd: 1_000_000;
  readonly hardVariableCostCeilingMicroUsd: 2_000_000;
  readonly fixedRetainedVolumesMonthlyMicroUsd: 7_000_000;
  readonly fixedRetainedVolumesExcluded: true;
  readonly maximumWallTimeMs: number;
  readonly requestSha256: Sha256;
}

export interface HostedProductionLengthRecord {
  readonly document: HostedProductionLengthAdmissionDocument;
  readonly documentSha256: Sha256;
  readonly submissionToken: string;
  readonly submissionTokenSha256: Sha256;
  readonly attemptId: string;
  readonly state: "READY" | "SUBMITTED" | "ACCEPTED";
  readonly submissionCount: 0 | 1;
  readonly acceptanceSha256: Sha256 | null;
}

export interface HostedProductionLengthRepository {
  createOrReplay(
    document: HostedProductionLengthAdmissionDocument,
  ): Promise<{ readonly record: HostedProductionLengthRecord; readonly replayed: boolean }>;
  claimOnce(
    key: HostedProductionLengthKey,
    requestSha256: Sha256,
  ): Promise<HostedProductionLengthRecord | null>;
  read(key: HostedProductionLengthKey): Promise<HostedProductionLengthRecord | null>;
  accept(
    key: HostedProductionLengthKey,
    requestSha256: Sha256,
    acceptanceSha256: Sha256,
  ): Promise<HostedProductionLengthRecord | null>;
}

export interface HostedProductionArtifact {
  readonly assetId: string;
  readonly sha256: Sha256;
  readonly objectKey: string;
  readonly contentType: "image/jpeg" | "image/png" | "video/mp4";
}

export interface HostedProductionQualificationVerification {
  readonly verifierId: "videoforge-production-length-qualification-verifier-v1";
  readonly accepted: true;
  readonly canonicalEvidenceSha256: Sha256;
  readonly verifierSignatureSha256: Sha256;
  readonly verifiedAt: string;
  readonly expiresAt: string;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly projectRevisionId: string;
  readonly renderPlanSha256: Sha256;
  readonly mage: {
    readonly state: "QUALIFIED";
    readonly canonicalBarrierSha256: Sha256;
    readonly attemptId: string;
    readonly artifacts: readonly HostedProductionArtifact[];
  };
  readonly soulx:
    | { readonly state: "UNQUALIFIED" }
    | {
        readonly state: "QUALIFIED";
        readonly canonicalBarrierSha256: Sha256;
        readonly attemptId: string;
        readonly acceptanceContractSha256: Sha256;
        readonly cropProfileEvidenceSha256: Sha256;
        readonly sourceProfile: string;
        readonly fullCrop: string;
        readonly splitCrop: string;
        readonly artifacts: readonly HostedProductionArtifact[];
      };
}

export interface HostedProductionQualificationVerifier {
  verify(
    rawEvidence: Readonly<Record<string, unknown>>,
  ): Promise<HostedProductionQualificationVerification>;
}

export interface HostedProductionLengthAdmission {
  readonly groundworkOnly: true;
  readonly liveAcceptanceClaimed: false;
  readonly document: HostedProductionLengthAdmissionDocument;
  readonly documentSha256: Sha256;
  readonly submissionToken: string;
  readonly submissionTokenSha256: Sha256;
  readonly attemptId: string;
  readonly state: HostedProductionLengthRecord["state"];
  readonly replayed: boolean;
}

export interface HostedProductionOutputVerification {
  readonly verifierId: "videoforge-production-length-output-verifier-v1";
  readonly accepted: true;
  readonly canonicalEvidenceSha256: Sha256;
  readonly verifierSignatureSha256: Sha256;
  readonly verifiedAt: string;
  readonly expiresAt: string;
  readonly durableInventorySha256: Sha256;
  readonly output: {
    readonly state: "COMMITTED";
    readonly assetId: string;
    readonly objectKey: string;
    readonly sha256: Sha256;
    readonly bytes: number;
    readonly contentType: "video/mp4";
    readonly commitReceiptSha256: Sha256;
  };
  readonly readback: {
    readonly state: "GET_REHASH_SUCCEEDED";
    readonly sha256: Sha256;
    readonly bytes: number;
    readonly contentType: "video/mp4";
    readonly receiptSha256: Sha256;
  };
  readonly technicalProbe: TechnicalProbeDocument;
  readonly measurements: {
    readonly receiptSha256: Sha256;
    readonly mage: HostedProductionLaneMeasurement;
    readonly soulx: HostedProductionLaneMeasurement;
    readonly render: HostedProductionRuntimeMeasurement;
  };
  readonly settlement: {
    readonly state: "SETTLED";
    readonly mageMicroUsd: number;
    readonly soulxMicroUsd: number;
    readonly renderMicroUsd: number;
    readonly otherVariableMicroUsd: number;
    readonly totalVariableMicroUsd: number;
    readonly possibleDuplicateMicroUsd: number;
    readonly fixedRetainedVolumesMonthlyMicroUsd: number;
    readonly fixedRetainedVolumesExcluded: boolean;
    readonly settlementReceiptSha256: Sha256;
  };
  readonly review: {
    readonly state: "ACCEPTED";
    readonly reviewReceiptSha256: Sha256;
    readonly reviewedCutCount: number;
    readonly everyCutReviewed: boolean;
    readonly noManualMediaEditOrSubstitution: boolean;
    readonly hardCutsOnly: boolean;
    readonly overlaysAbsent: boolean;
    readonly requiredSlowImageZoom: boolean;
    readonly visualQualityPassed: boolean;
    readonly audioVideoQualityPassed: boolean;
  };
  readonly terminal: {
    readonly attemptId: string;
    readonly submissionTokenSha256: Sha256;
    readonly jobsTerminal: true;
    readonly activeWorkers: 0;
    readonly durableInventorySha256: Sha256;
    readonly observedAt: string;
  };
}

export interface HostedProductionLaneMeasurement {
  readonly observedGpu: "NVIDIA GeForce RTX 4090";
  readonly queueMs: number;
  readonly initMs: number;
  readonly executionMs: number;
  readonly totalMs: number;
  readonly peakVramBytes: number;
  readonly measurementSha256: Sha256;
}

export interface HostedProductionRuntimeMeasurement {
  readonly executionMs: number;
  readonly totalMs: number;
  readonly peakRssBytes: number;
  readonly measurementSha256: Sha256;
}

export interface HostedProductionOutputVerifier {
  verify(
    rawEvidence: Readonly<Record<string, unknown>>,
  ): Promise<HostedProductionOutputVerification>;
}

const validSha = (value: unknown): value is Sha256 =>
  typeof value === "string" && SHA256.test(value);
const positiveInt = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) > 0;
const nonnegativeInt = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;
const exactDate = (value: string): number | null => {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
    ? timestamp
    : null;
};

function freshVerification(verifiedAtValue: string, expiresAtValue: string, now: Date): boolean {
  const verifiedAt = exactDate(verifiedAtValue);
  const expiresAt = exactDate(expiresAtValue);
  const nowMs = now.getTime();
  return (
    verifiedAt !== null &&
    expiresAt !== null &&
    Number.isFinite(nowMs) &&
    expiresAt > verifiedAt &&
    expiresAt - verifiedAt <= MAX_VERIFIER_AGE_MS &&
    verifiedAt <= nowMs &&
    expiresAt > nowMs
  );
}

function planAssets(plan: ResolvedRenderManifestDocument) {
  const mage = new Map<string, Sha256>();
  const soulx = new Map<string, Sha256>();
  let nextFrame = 0;
  for (const segment of plan.segments) {
    if (segment.start_frame !== nextFrame || segment.end_frame_exclusive <= segment.start_frame)
      throw new HostedProductionLengthError("PRODUCTION_LENGTH_VISUAL_GRAMMAR_INVALID");
    nextFrame = segment.end_frame_exclusive;
    if (segment.timeline_composition === "IMAGE_FULL") {
      if (segment.render.zoom_profile !== "image-full-zoom-v3")
        throw new HostedProductionLengthError("PRODUCTION_LENGTH_VISUAL_GRAMMAR_INVALID");
      mage.set(
        segment.accepted_assets.image.asset_id,
        segment.accepted_assets.image.sha256 as Sha256,
      );
    } else if (segment.timeline_composition === "AVATAR_FULL") {
      soulx.set(
        segment.accepted_assets.avatar.asset_id,
        segment.accepted_assets.avatar.sha256 as Sha256,
      );
    } else {
      if (segment.render.right_image_zoom_profile !== "split-right-zoom-v3")
        throw new HostedProductionLengthError("PRODUCTION_LENGTH_VISUAL_GRAMMAR_INVALID");
      mage.set(
        segment.accepted_assets.right_image.asset_id,
        segment.accepted_assets.right_image.sha256 as Sha256,
      );
      soulx.set(
        segment.accepted_assets.avatar.asset_id,
        segment.accepted_assets.avatar.sha256 as Sha256,
      );
    }
  }
  if (!mage.size || !soulx.size)
    throw new HostedProductionLengthError("PRODUCTION_LENGTH_NOT_MIXED");
  if (
    plan.output.fps_num !== 30 ||
    plan.output.fps_den !== 1 ||
    plan.total_frames < MIN_FRAMES ||
    plan.total_frames > MAX_FRAMES ||
    nextFrame !== plan.total_frames
  )
    throw new HostedProductionLengthError("PRODUCTION_LENGTH_PLAN_INVALID");
  return { mage, soulx };
}

function exactArtifacts(
  expected: ReadonlyMap<string, Sha256>,
  actual: readonly HostedProductionArtifact[],
  scope: HostedProductionLengthKey,
  lane: "mage-image" | "soulx-avatar",
  attemptId: string,
): boolean {
  return (
    ID.test(attemptId) &&
    actual.length === expected.size &&
    new Set(actual.map((artifact) => artifact.assetId)).size === actual.length &&
    actual.every(
      (artifact) =>
        expected.get(artifact.assetId) === artifact.sha256 &&
        artifact.objectKey ===
          `tenant/${scope.accountId}/workspace/${scope.workspaceId}/project/${scope.projectId}` +
            `/revision/${scope.projectRevisionId}/lane/${lane}/job/${attemptId}` +
            `/artifact/${artifact.assetId}` &&
        (lane === "mage-image"
          ? ["image/jpeg", "image/png"].includes(artifact.contentType)
          : artifact.contentType === "video/mp4") &&
        validSha(artifact.sha256),
    )
  );
}

export function hostedProductionLengthRequestSha256(
  value: Omit<HostedProductionLengthAdmissionDocument, "schemaVersion" | "requestSha256">,
) {
  return canonicalSha256({ schema_version: "videoforge-production-length-request/v1", ...value });
}

export function validateHostedProductionLengthCreatedRecord(
  document: HostedProductionLengthAdmissionDocument,
  record: HostedProductionLengthRecord,
): void {
  const key = document.key;
  if (
    record.document.key.accountId !== key.accountId ||
    record.document.key.workspaceId !== key.workspaceId ||
    record.document.key.projectId !== key.projectId ||
    record.document.key.projectRevisionId !== key.projectRevisionId ||
    record.document.key.renderPlanSha256 !== key.renderPlanSha256 ||
    record.document.requestSha256 !== document.requestSha256 ||
    canonicalSha256(record.document) !== canonicalSha256(document) ||
    record.documentSha256 !== canonicalSha256(record.document) ||
    record.documentSha256 !== canonicalSha256(document) ||
    !TOKEN.test(record.submissionToken) ||
    digestUtf8(record.submissionToken) !== record.submissionTokenSha256 ||
    !ID.test(record.attemptId) ||
    (record.state === "READY" &&
      (record.submissionCount !== 0 || record.acceptanceSha256 !== null)) ||
    (record.state === "SUBMITTED" &&
      (record.submissionCount !== 1 || record.acceptanceSha256 !== null)) ||
    (record.state === "ACCEPTED" &&
      (record.submissionCount !== 1 || !validSha(record.acceptanceSha256)))
  )
    throw new HostedProductionLengthError("PRODUCTION_LENGTH_DURABLE_CONFLICT");
}

export async function admitHostedProductionLength(input: {
  readonly repository: HostedProductionLengthRepository;
  readonly verifier: HostedProductionQualificationVerifier;
  readonly candidate: {
    readonly accountId: string;
    readonly workspaceId: string;
    readonly projectId: string;
    readonly projectRevisionId: string;
    readonly revisionConfigSha256: Sha256;
    readonly renderPlanDocument: ResolvedRenderManifestDocument;
    readonly qualificationEvidence: Readonly<Record<string, unknown>>;
    readonly maximumWallTimeMs: number;
  };
  readonly now?: () => Date;
}): Promise<HostedProductionLengthAdmission> {
  let plan: Awaited<ReturnType<typeof validateAndHashContractDocument<"resolvedRenderManifest">>>;
  try {
    plan = await validateAndHashContractDocument(
      "resolvedRenderManifest",
      input.candidate.renderPlanDocument,
    );
  } catch {
    throw new HostedProductionLengthError("PRODUCTION_LENGTH_PLAN_INVALID");
  }
  if (
    plan.value.project_revision_id !== input.candidate.projectRevisionId ||
    plan.value.revision_config_hash !== input.candidate.revisionConfigSha256 ||
    !positiveInt(input.candidate.maximumWallTimeMs)
  )
    throw new HostedProductionLengthError("PRODUCTION_LENGTH_PLAN_INVALID");
  const assets = planAssets(plan.value);
  const key = {
    accountId: input.candidate.accountId,
    workspaceId: input.candidate.workspaceId,
    projectId: input.candidate.projectId,
    projectRevisionId: input.candidate.projectRevisionId,
    renderPlanSha256: plan.sha256,
  };
  let qualified: HostedProductionQualificationVerification;
  try {
    qualified = await input.verifier.verify(input.candidate.qualificationEvidence);
  } catch {
    throw new HostedProductionLengthError("PRODUCTION_LENGTH_QUALIFICATION_INVALID");
  }
  if (
    qualified.verifierId !== "videoforge-production-length-qualification-verifier-v1" ||
    qualified.accepted !== true ||
    qualified.canonicalEvidenceSha256 !== canonicalSha256(input.candidate.qualificationEvidence) ||
    !validSha(qualified.verifierSignatureSha256) ||
    !freshVerification(qualified.verifiedAt, qualified.expiresAt, input.now?.() ?? new Date()) ||
    qualified.accountId !== input.candidate.accountId ||
    qualified.workspaceId !== input.candidate.workspaceId ||
    qualified.projectId !== input.candidate.projectId ||
    qualified.projectRevisionId !== input.candidate.projectRevisionId ||
    qualified.renderPlanSha256 !== plan.sha256 ||
    !validSha(qualified.mage.canonicalBarrierSha256) ||
    !exactArtifacts(
      assets.mage,
      qualified.mage.artifacts,
      key,
      "mage-image",
      qualified.mage.attemptId,
    )
  )
    throw new HostedProductionLengthError("PRODUCTION_LENGTH_QUALIFICATION_INVALID");
  if (qualified.soulx.state !== "QUALIFIED")
    throw new HostedProductionLengthError("PRODUCTION_LENGTH_SOULX_UNQUALIFIED");
  const soulx = qualified.soulx;
  if (
    !validSha(soulx.canonicalBarrierSha256) ||
    !validSha(soulx.acceptanceContractSha256) ||
    !validSha(soulx.cropProfileEvidenceSha256) ||
    !exactArtifacts(assets.soulx, soulx.artifacts, key, "soulx-avatar", soulx.attemptId) ||
    LEGACY_AVATAR_PROFILES.has(soulx.sourceProfile) ||
    plan.value.segments.some(
      (segment) =>
        segment.timeline_composition !== "IMAGE_FULL" &&
        (segment.render.avatar_source_profile !== soulx.sourceProfile ||
          segment.render.avatar_crop !==
            (segment.timeline_composition === "AVATAR_FULL" ? soulx.fullCrop : soulx.splitCrop)),
    )
  )
    throw new HostedProductionLengthError("PRODUCTION_LENGTH_SOULX_UNQUALIFIED");

  const base = {
    groundworkOnly: true as const,
    liveAcceptanceClaimed: false as const,
    key,
    revisionConfigSha256: input.candidate.revisionConfigSha256,
    renderPlanDocument: plan.value,
    qualificationEvidenceSha256: canonicalSha256(qualified),
    totalFrames: plan.value.total_frames,
    expectedCutCount: plan.value.segments.length - 1,
    targetVariableCostMicroUsd: TARGET_COST_MICRO_USD,
    hardVariableCostCeilingMicroUsd: HARD_COST_CEILING_MICRO_USD,
    fixedRetainedVolumesMonthlyMicroUsd: FIXED_VOLUME_MONTHLY_MICRO_USD,
    fixedRetainedVolumesExcluded: true as const,
    maximumWallTimeMs: input.candidate.maximumWallTimeMs,
  } as const;
  const document: HostedProductionLengthAdmissionDocument = {
    schemaVersion: "videoforge-hosted-production-length-admission/v1",
    ...base,
    requestSha256: hostedProductionLengthRequestSha256(base),
  };
  const durable = await input.repository.createOrReplay(document);
  validateHostedProductionLengthCreatedRecord(document, durable.record);
  return {
    groundworkOnly: true,
    liveAcceptanceClaimed: false,
    document,
    documentSha256: canonicalSha256(document),
    submissionToken: durable.record.submissionToken,
    submissionTokenSha256: durable.record.submissionTokenSha256,
    attemptId: durable.record.attemptId,
    state: durable.record.state,
    replayed: durable.replayed,
  };
}

export async function acceptHostedProductionLength(input: {
  readonly repository: HostedProductionLengthRepository;
  readonly verifier: HostedProductionOutputVerifier;
  readonly admission: HostedProductionLengthAdmission;
  readonly rawEvidence: Readonly<Record<string, unknown>>;
  readonly now?: () => Date;
}): Promise<{
  readonly acceptanceSha256: Sha256;
  readonly outcome: "GROUNDWORK_ACCEPTED_EVIDENCE_ONLY";
  readonly groundworkOnly: true;
  readonly liveAcceptanceClaimed: false;
}> {
  const durable = await input.repository.read(input.admission.document.key);
  if (
    !durable ||
    durable.state !== "SUBMITTED" ||
    durable.submissionCount !== 1 ||
    durable.document.requestSha256 !== input.admission.document.requestSha256 ||
    durable.documentSha256 !== canonicalSha256(durable.document) ||
    durable.submissionToken !== input.admission.submissionToken ||
    durable.attemptId !== input.admission.attemptId
  )
    throw new HostedProductionLengthError("PRODUCTION_LENGTH_NOT_SUBMITTED_ONCE");
  let canonicalPlan: Awaited<
    ReturnType<typeof validateAndHashContractDocument<"resolvedRenderManifest">>
  >;
  try {
    canonicalPlan = await validateAndHashContractDocument(
      "resolvedRenderManifest",
      durable.document.renderPlanDocument,
    );
  } catch {
    throw new HostedProductionLengthError("PRODUCTION_LENGTH_DURABLE_CONFLICT");
  }
  if (
    canonicalPlan.sha256 !== durable.document.key.renderPlanSha256 ||
    durable.document.groundworkOnly !== true ||
    durable.document.liveAcceptanceClaimed !== false ||
    durable.document.targetVariableCostMicroUsd !== TARGET_COST_MICRO_USD ||
    durable.document.hardVariableCostCeilingMicroUsd !== HARD_COST_CEILING_MICRO_USD ||
    durable.document.fixedRetainedVolumesMonthlyMicroUsd !== FIXED_VOLUME_MONTHLY_MICRO_USD ||
    durable.document.fixedRetainedVolumesExcluded !== true ||
    durable.document.totalFrames !== canonicalPlan.value.total_frames ||
    durable.document.expectedCutCount !== canonicalPlan.value.segments.length - 1 ||
    durable.document.requestSha256 !==
      hostedProductionLengthRequestSha256({
        key: durable.document.key,
        revisionConfigSha256: durable.document.revisionConfigSha256,
        renderPlanDocument: canonicalPlan.value,
        qualificationEvidenceSha256: durable.document.qualificationEvidenceSha256,
        totalFrames: durable.document.totalFrames,
        expectedCutCount: durable.document.expectedCutCount,
        targetVariableCostMicroUsd: durable.document.targetVariableCostMicroUsd,
        hardVariableCostCeilingMicroUsd: durable.document.hardVariableCostCeilingMicroUsd,
        fixedRetainedVolumesMonthlyMicroUsd: durable.document.fixedRetainedVolumesMonthlyMicroUsd,
        fixedRetainedVolumesExcluded: durable.document.fixedRetainedVolumesExcluded,
        groundworkOnly: durable.document.groundworkOnly,
        liveAcceptanceClaimed: durable.document.liveAcceptanceClaimed,
        maximumWallTimeMs: durable.document.maximumWallTimeMs,
      })
  )
    throw new HostedProductionLengthError("PRODUCTION_LENGTH_DURABLE_CONFLICT");
  planAssets(canonicalPlan.value);
  let verified: HostedProductionOutputVerification;
  try {
    verified = await input.verifier.verify(input.rawEvidence);
  } catch {
    throw new HostedProductionLengthError("PRODUCTION_LENGTH_OUTPUT_INVALID");
  }
  if (
    verified.verifierId !== "videoforge-production-length-output-verifier-v1" ||
    verified.accepted !== true ||
    verified.canonicalEvidenceSha256 !== canonicalSha256(input.rawEvidence) ||
    !validSha(verified.verifierSignatureSha256) ||
    !freshVerification(verified.verifiedAt, verified.expiresAt, input.now?.() ?? new Date()) ||
    !validSha(verified.durableInventorySha256)
  )
    throw new HostedProductionLengthError("PRODUCTION_LENGTH_OUTPUT_INVALID");
  const expectedObjectKey =
    `tenant/${durable.document.key.accountId}/workspace/${durable.document.key.workspaceId}` +
    `/project/${durable.document.key.projectId}/revision/${durable.document.key.projectRevisionId}` +
    `/lane/render/job/${durable.attemptId}/artifact/${verified.output.assetId}.mp4`;
  if (
    verified.output.state !== "COMMITTED" ||
    verified.output.objectKey !== expectedObjectKey ||
    verified.output.contentType !== "video/mp4" ||
    !validSha(verified.output.sha256) ||
    !positiveInt(verified.output.bytes) ||
    !validSha(verified.output.commitReceiptSha256) ||
    verified.readback.state !== "GET_REHASH_SUCCEEDED" ||
    verified.readback.sha256 !== verified.output.sha256 ||
    verified.readback.bytes !== verified.output.bytes ||
    verified.readback.contentType !== verified.output.contentType ||
    !validSha(verified.readback.receiptSha256)
  )
    throw new HostedProductionLengthError("PRODUCTION_LENGTH_OUTPUT_INVALID");
  let probe: Awaited<ReturnType<typeof validateAndHashContractDocument<"technicalProbe">>>;
  try {
    probe = await validateAndHashContractDocument("technicalProbe", verified.technicalProbe);
  } catch {
    throw new HostedProductionLengthError("PRODUCTION_LENGTH_OUTPUT_INVALID");
  }
  if (
    probe.value.asset_id !== verified.output.assetId ||
    probe.value.sha256 !== verified.output.sha256 ||
    probe.value.bytes !== verified.output.bytes ||
    probe.value.total_frames !== durable.document.totalFrames ||
    probe.value.duration_ms * 30 !== durable.document.totalFrames * 1000
  )
    throw new HostedProductionLengthError("PRODUCTION_LENGTH_OUTPUT_INVALID");
  for (const measurement of [verified.measurements.mage, verified.measurements.soulx]) {
    if (
      measurement.observedGpu !== "NVIDIA GeForce RTX 4090" ||
      ![measurement.queueMs, measurement.initMs, measurement.executionMs].every(nonnegativeInt) ||
      !positiveInt(measurement.totalMs) ||
      measurement.totalMs !== measurement.queueMs + measurement.initMs + measurement.executionMs ||
      !positiveInt(measurement.peakVramBytes) ||
      !validSha(measurement.measurementSha256)
    )
      throw new HostedProductionLengthError("PRODUCTION_LENGTH_MEASUREMENT_INVALID");
  }
  if (
    !positiveInt(verified.measurements.render.executionMs) ||
    verified.measurements.render.totalMs < verified.measurements.render.executionMs ||
    !positiveInt(verified.measurements.render.peakRssBytes) ||
    !validSha(verified.measurements.render.measurementSha256) ||
    !validSha(verified.measurements.receiptSha256) ||
    verified.measurements.mage.totalMs +
      verified.measurements.soulx.totalMs +
      verified.measurements.render.totalMs >
      durable.document.maximumWallTimeMs
  )
    throw new HostedProductionLengthError("PRODUCTION_LENGTH_MEASUREMENT_INVALID");
  const cost = verified.settlement;
  const attributed =
    cost.mageMicroUsd + cost.soulxMicroUsd + cost.renderMicroUsd + cost.otherVariableMicroUsd;
  if (
    cost.state !== "SETTLED" ||
    ![
      cost.mageMicroUsd,
      cost.soulxMicroUsd,
      cost.renderMicroUsd,
      cost.otherVariableMicroUsd,
      cost.totalVariableMicroUsd,
      cost.possibleDuplicateMicroUsd,
    ].every(nonnegativeInt) ||
    attributed !== cost.totalVariableMicroUsd ||
    cost.totalVariableMicroUsd > durable.document.targetVariableCostMicroUsd ||
    cost.totalVariableMicroUsd > durable.document.hardVariableCostCeilingMicroUsd ||
    cost.possibleDuplicateMicroUsd !== 0 ||
    cost.fixedRetainedVolumesMonthlyMicroUsd !== FIXED_VOLUME_MONTHLY_MICRO_USD ||
    !cost.fixedRetainedVolumesExcluded ||
    !validSha(cost.settlementReceiptSha256)
  )
    throw new HostedProductionLengthError("PRODUCTION_LENGTH_COST_INVALID");
  const review = verified.review;
  if (
    review.state !== "ACCEPTED" ||
    review.reviewedCutCount !== durable.document.expectedCutCount ||
    !review.everyCutReviewed ||
    !review.noManualMediaEditOrSubstitution ||
    !review.hardCutsOnly ||
    !review.overlaysAbsent ||
    !review.requiredSlowImageZoom ||
    !review.visualQualityPassed ||
    !review.audioVideoQualityPassed ||
    !validSha(review.reviewReceiptSha256)
  )
    throw new HostedProductionLengthError("PRODUCTION_LENGTH_REVIEW_INVALID");
  if (
    verified.terminal.attemptId !== durable.attemptId ||
    verified.terminal.submissionTokenSha256 !== durable.submissionTokenSha256 ||
    verified.terminal.jobsTerminal !== true ||
    verified.terminal.activeWorkers !== 0 ||
    verified.terminal.durableInventorySha256 !== verified.durableInventorySha256 ||
    Number.isNaN(Date.parse(verified.terminal.observedAt))
  )
    throw new HostedProductionLengthError("PRODUCTION_LENGTH_NOT_TERMINAL");
  const acceptanceSha256 = canonicalSha256({
    schema_version: "videoforge-production-length-acceptance/v1",
    admission_document_sha256: durable.documentSha256,
    verification: verified,
    technical_probe_sha256: probe.sha256,
  });
  const accepted = await input.repository.accept(
    durable.document.key,
    durable.document.requestSha256,
    acceptanceSha256,
  );
  if (!accepted || accepted.state !== "ACCEPTED" || accepted.acceptanceSha256 !== acceptanceSha256)
    throw new HostedProductionLengthError("PRODUCTION_LENGTH_DURABLE_CONFLICT");
  return {
    acceptanceSha256,
    outcome: "GROUNDWORK_ACCEPTED_EVIDENCE_ONLY",
    groundworkOnly: true,
    liveAcceptanceClaimed: false,
  };
}

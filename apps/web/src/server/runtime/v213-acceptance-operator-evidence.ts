import { canonicalSha256, type Sha256 } from "@videoforge/control-plane";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const HASH = /^sha256:[0-9a-f]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u;
const NONCE = /^[A-Za-z0-9_.:-]{16,190}$/u;
const MAX_REQUEST_AGE_MS = 5 * 60_000;
const MAX_CLOCK_SKEW_MS = 30_000;

export const V213_ACCEPTANCE_OPERATOR_EVIDENCE_PATH = "/api/operator/v2-13/acceptance-evidence";
export const V213_ACCEPTANCE_OPERATOR_EVIDENCE_REQUEST_SCHEMA =
  "videoforge.v213-operator-evidence-ingestion-request/v1" as const;
export const V213_ACCEPTANCE_OPERATOR_EVIDENCE_RESULT_SCHEMA =
  "videoforge.v213-operator-evidence-ingestion-result/v1" as const;

export type V213AcceptanceEvidenceOperation =
  | "v2-10-operator-free-ranga-pilot"
  | "v2-11-two-concurrent-owned-projects"
  | "v2-12-long-output";
export type V213AcceptanceEvidenceCheckpoint = "V2-10" | "V2-11" | "V2-12";
export type V213AcceptanceOperatorEvidenceKind =
  | "V210_REAL_CHROME"
  | "V210_VISUAL_DECISION"
  | "V212_REAL_CHROME"
  | "V212_VISUAL_DECISION";

const OPERATION_CHECKPOINT = Object.freeze({
  "v2-10-operator-free-ranga-pilot": "V2-10",
  "v2-11-two-concurrent-owned-projects": "V2-11",
  "v2-12-long-output": "V2-12",
} as const);

export interface V213AcceptanceOperatorEvidenceBinding {
  readonly fullLiveAuthorityId: string;
  readonly operationId: V213AcceptanceEvidenceOperation;
  readonly checkpoint: V213AcceptanceEvidenceCheckpoint;
  readonly stageAuthorityId: string;
  readonly outerStateSha256: Sha256;
  readonly workflowId: string;
  readonly executionId: string;
  readonly executionRequestSha256: Sha256;
  readonly authoritySha256: Sha256;
}

export interface V213AcceptanceEvidenceScope {
  readonly accountId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly projectRevisionId: string;
  readonly requestSha256: Sha256;
  readonly attemptId: string;
}

export interface V213V210VisualDecisionEvidence {
  readonly schemaVersion: "videoforge.v213-v210-visual-decision-evidence/v1";
  readonly kind: "V210_VISUAL_DECISION";
  readonly scope: V213AcceptanceEvidenceScope;
  readonly outputSha256: Sha256;
  readonly outputReceiptSha256: Sha256;
  readonly decision: "ACCEPTED";
  /** Human review facts only. The append-only evidence hash becomes reviewArtifactSha256. */
  readonly review: {
    readonly reviewedCutCount: number;
    readonly everyCutReviewed: true;
    readonly noManualMediaEditOrSubstitution: true;
    readonly literalRelevance: "PASSED";
    readonly imageRealism: "PASSED";
    readonly avatarIdentityAndCrop: "PASSED";
    readonly lipSync: "PASSED";
    readonly audioVideoQuality: "PASSED";
    readonly prohibitedGraphicsAbsent: "PASSED";
    readonly hardCutsOnly: "PASSED";
    readonly requiredImageZoom: "PASSED";
  };
  readonly observedAt: string;
}

export interface V213V212VisualDecisionEvidence {
  readonly schemaVersion: "videoforge.v213-v212-visual-decision-evidence/v1";
  readonly kind: "V212_VISUAL_DECISION";
  readonly scope: V213AcceptanceEvidenceScope;
  readonly outputSha256: Sha256;
  readonly outputReceiptSha256: Sha256;
  readonly decision: "ACCEPTED";
  /** Human review facts only. The append-only evidence hash becomes reviewReceiptSha256. */
  readonly review: {
    readonly reviewedCutCount: number;
    readonly everyCutReviewed: true;
    readonly noManualMediaEditOrSubstitution: true;
    readonly hardCutsOnly: true;
    readonly overlaysAbsent: true;
    readonly requiredSlowImageZoom: true;
    readonly visualQualityPassed: true;
    readonly audioVideoQualityPassed: true;
  };
  readonly observedAt: string;
}

export interface V213V210RealChromeEvidence {
  readonly schemaVersion: "videoforge.v213-v210-real-chrome-evidence/v1";
  readonly kind: "V210_REAL_CHROME";
  readonly scope: V213AcceptanceEvidenceScope;
  readonly outputSha256: Sha256;
  readonly outputReceiptSha256: Sha256;
  readonly chromeReceiptSha256: Sha256;
  readonly playbackPassed: true;
  readonly privateReadbackPassed: true;
  readonly observedAt: string;
}

/**
 * Installed-Chrome proof for the exact V2-12 terminal output. The browser must authenticate,
 * traverse the tenant-private GET, play the returned media, and hash the downloaded bytes. The
 * output equality check below prevents a successful journey against any adjacent/stale artifact.
 */
export interface V213V212RealChromeEvidence {
  readonly schemaVersion: "videoforge.v213-v212-real-chrome-evidence/v1";
  readonly kind: "V212_REAL_CHROME";
  readonly scope: V213AcceptanceEvidenceScope;
  readonly outputSha256: Sha256;
  readonly outputReceiptSha256: Sha256;
  readonly productionUrlSha256: Sha256;
  readonly chromeReceiptSha256: Sha256;
  readonly authenticatedSession: true;
  readonly privateReadbackPassed: true;
  readonly playbackPassed: true;
  readonly downloadSha256: Sha256;
  readonly downloadBytes: number;
  readonly observedAt: string;
}

export type V213AcceptanceOperatorEvidence =
  | V213V210VisualDecisionEvidence
  | V213V212VisualDecisionEvidence
  | V213V210RealChromeEvidence
  | V213V212RealChromeEvidence;

export interface V213AcceptanceOperatorEvidenceRequest {
  readonly schemaVersion: typeof V213_ACCEPTANCE_OPERATOR_EVIDENCE_REQUEST_SCHEMA;
  readonly binding: V213AcceptanceOperatorEvidenceBinding;
  readonly evidence: V213AcceptanceOperatorEvidence;
  readonly issuedAt: string;
  readonly nonce: string;
  readonly requestSha256: Sha256;
}

export interface V213AcceptanceOperatorEvidenceResult {
  readonly schemaVersion: typeof V213_ACCEPTANCE_OPERATOR_EVIDENCE_RESULT_SCHEMA;
  readonly fullLiveAuthorityId: string;
  readonly operationId: V213AcceptanceEvidenceOperation;
  readonly checkpoint: V213AcceptanceEvidenceCheckpoint;
  readonly workflowId: string;
  readonly executionRequestSha256: Sha256;
  readonly kind: V213AcceptanceOperatorEvidenceKind;
  readonly evidenceSha256: Sha256;
  readonly state: "RECORDED";
  readonly recordedAt: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function utc(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function exactScope(value: unknown): value is V213AcceptanceEvidenceScope {
  const scope = record(value);
  return Boolean(
    scope &&
      exactKeys(scope, [
        "accountId",
        "attemptId",
        "projectId",
        "projectRevisionId",
        "requestSha256",
        "workspaceId",
      ]) &&
      [scope.accountId, scope.workspaceId, scope.projectId, scope.projectRevisionId].every(
        (item) => typeof item === "string" && UUID.test(item),
      ) &&
      typeof scope.attemptId === "string" &&
      ID.test(scope.attemptId) &&
      typeof scope.requestSha256 === "string" &&
      HASH.test(scope.requestSha256),
  );
}

function exactV210Review(value: unknown): value is V213V210VisualDecisionEvidence["review"] {
  const review = record(value);
  return Boolean(
    review &&
      exactKeys(review, [
        "audioVideoQuality",
        "avatarIdentityAndCrop",
        "everyCutReviewed",
        "hardCutsOnly",
        "imageRealism",
        "lipSync",
        "literalRelevance",
        "noManualMediaEditOrSubstitution",
        "prohibitedGraphicsAbsent",
        "requiredImageZoom",
        "reviewedCutCount",
      ]) &&
      Number.isSafeInteger(review.reviewedCutCount) &&
      (review.reviewedCutCount as number) > 0 &&
      review.everyCutReviewed === true &&
      review.noManualMediaEditOrSubstitution === true &&
      review.literalRelevance === "PASSED" &&
      review.imageRealism === "PASSED" &&
      review.avatarIdentityAndCrop === "PASSED" &&
      review.lipSync === "PASSED" &&
      review.audioVideoQuality === "PASSED" &&
      review.prohibitedGraphicsAbsent === "PASSED" &&
      review.hardCutsOnly === "PASSED" &&
      review.requiredImageZoom === "PASSED",
  );
}

function exactV212Review(value: unknown): value is V213V212VisualDecisionEvidence["review"] {
  const review = record(value);
  return Boolean(
    review &&
      exactKeys(review, [
        "audioVideoQualityPassed",
        "everyCutReviewed",
        "hardCutsOnly",
        "noManualMediaEditOrSubstitution",
        "overlaysAbsent",
        "requiredSlowImageZoom",
        "reviewedCutCount",
        "visualQualityPassed",
      ]) &&
      Number.isSafeInteger(review.reviewedCutCount) &&
      (review.reviewedCutCount as number) > 0 &&
      review.everyCutReviewed === true &&
      review.noManualMediaEditOrSubstitution === true &&
      review.hardCutsOnly === true &&
      review.overlaysAbsent === true &&
      review.requiredSlowImageZoom === true &&
      review.visualQualityPassed === true &&
      review.audioVideoQualityPassed === true,
  );
}

function exactBinding(value: unknown): V213AcceptanceOperatorEvidenceBinding | null {
  const binding = record(value);
  if (
    !binding ||
    !exactKeys(binding, [
      "authoritySha256",
      "checkpoint",
      "executionId",
      "executionRequestSha256",
      "fullLiveAuthorityId",
      "operationId",
      "outerStateSha256",
      "stageAuthorityId",
      "workflowId",
    ]) ||
    !((binding.operationId as string) in OPERATION_CHECKPOINT) ||
    binding.checkpoint !==
      OPERATION_CHECKPOINT[binding.operationId as V213AcceptanceEvidenceOperation] ||
    ![binding.fullLiveAuthorityId, binding.stageAuthorityId].every(
      (item) => typeof item === "string" && UUID.test(item),
    ) ||
    ![binding.outerStateSha256, binding.executionRequestSha256, binding.authoritySha256].every(
      (item) => typeof item === "string" && HASH.test(item),
    ) ||
    typeof binding.executionId !== "string" ||
    !ID.test(binding.executionId) ||
    binding.workflowId !== `v213-${String(binding.checkpoint).toLowerCase()}-${binding.executionId}`
  )
    return null;
  return binding as unknown as V213AcceptanceOperatorEvidenceBinding;
}

function exactEvidence(
  value: unknown,
  binding: V213AcceptanceOperatorEvidenceBinding,
): V213AcceptanceOperatorEvidence | null {
  const evidence = record(value);
  if (!evidence || !utc(evidence.observedAt)) return null;
  if (evidence.kind === "V210_VISUAL_DECISION") {
    if (
      !exactKeys(evidence, [
        "decision",
        "kind",
        "observedAt",
        "outputReceiptSha256",
        "outputSha256",
        "review",
        "schemaVersion",
        "scope",
      ]) ||
      evidence.schemaVersion !== "videoforge.v213-v210-visual-decision-evidence/v1" ||
      evidence.decision !== "ACCEPTED" ||
      binding.checkpoint !== "V2-10" ||
      !exactScope(evidence.scope) ||
      !exactV210Review(evidence.review) ||
      ![evidence.outputSha256, evidence.outputReceiptSha256].every(
        (item) => typeof item === "string" && HASH.test(item),
      )
    )
      return null;
    return evidence as unknown as V213V210VisualDecisionEvidence;
  }
  if (evidence.kind === "V212_VISUAL_DECISION") {
    if (
      !exactKeys(evidence, [
        "decision",
        "kind",
        "observedAt",
        "outputReceiptSha256",
        "outputSha256",
        "review",
        "schemaVersion",
        "scope",
      ]) ||
      evidence.schemaVersion !== "videoforge.v213-v212-visual-decision-evidence/v1" ||
      evidence.decision !== "ACCEPTED" ||
      binding.checkpoint !== "V2-12" ||
      !exactScope(evidence.scope) ||
      !exactV212Review(evidence.review) ||
      ![evidence.outputSha256, evidence.outputReceiptSha256].every(
        (item) => typeof item === "string" && HASH.test(item),
      )
    )
      return null;
    return evidence as unknown as V213V212VisualDecisionEvidence;
  }
  if (evidence.kind === "V210_REAL_CHROME") {
    if (
      !exactKeys(evidence, [
        "chromeReceiptSha256",
        "kind",
        "observedAt",
        "outputReceiptSha256",
        "outputSha256",
        "playbackPassed",
        "privateReadbackPassed",
        "schemaVersion",
        "scope",
      ]) ||
      evidence.schemaVersion !== "videoforge.v213-v210-real-chrome-evidence/v1" ||
      binding.checkpoint !== "V2-10" ||
      !exactScope(evidence.scope) ||
      ![evidence.outputSha256, evidence.outputReceiptSha256, evidence.chromeReceiptSha256].every(
        (item) => typeof item === "string" && HASH.test(item),
      ) ||
      evidence.playbackPassed !== true ||
      evidence.privateReadbackPassed !== true
    )
      return null;
    return evidence as unknown as V213V210RealChromeEvidence;
  }
  if (evidence.kind === "V212_REAL_CHROME") {
    if (
      !exactKeys(evidence, [
        "authenticatedSession",
        "chromeReceiptSha256",
        "downloadBytes",
        "downloadSha256",
        "kind",
        "observedAt",
        "outputReceiptSha256",
        "outputSha256",
        "playbackPassed",
        "privateReadbackPassed",
        "productionUrlSha256",
        "schemaVersion",
        "scope",
      ]) ||
      evidence.schemaVersion !== "videoforge.v213-v212-real-chrome-evidence/v1" ||
      binding.checkpoint !== "V2-12" ||
      !exactScope(evidence.scope) ||
      ![
        evidence.outputSha256,
        evidence.outputReceiptSha256,
        evidence.productionUrlSha256,
        evidence.chromeReceiptSha256,
        evidence.downloadSha256,
      ].every((item) => typeof item === "string" && HASH.test(item)) ||
      evidence.downloadSha256 !== evidence.outputSha256 ||
      !Number.isSafeInteger(evidence.downloadBytes) ||
      Number(evidence.downloadBytes) < 1 ||
      evidence.authenticatedSession !== true ||
      evidence.privateReadbackPassed !== true ||
      evidence.playbackPassed !== true
    )
      return null;
    return evidence as unknown as V213V212RealChromeEvidence;
  }
  return null;
}

export function parseV213AcceptanceOperatorEvidenceRequest(
  value: unknown,
  now: Date,
): V213AcceptanceOperatorEvidenceRequest | null {
  const request = record(value);
  if (
    !request ||
    !exactKeys(request, [
      "binding",
      "evidence",
      "issuedAt",
      "nonce",
      "requestSha256",
      "schemaVersion",
    ]) ||
    request.schemaVersion !== V213_ACCEPTANCE_OPERATOR_EVIDENCE_REQUEST_SCHEMA ||
    !utc(request.issuedAt) ||
    typeof request.nonce !== "string" ||
    !NONCE.test(request.nonce) ||
    typeof request.requestSha256 !== "string" ||
    !HASH.test(request.requestSha256)
  )
    return null;
  const issuedAt = Date.parse(request.issuedAt);
  const binding = exactBinding(request.binding);
  const evidence = binding ? exactEvidence(request.evidence, binding) : null;
  if (
    !binding ||
    !evidence ||
    issuedAt > now.getTime() + MAX_CLOCK_SKEW_MS ||
    now.getTime() - issuedAt > MAX_REQUEST_AGE_MS ||
    Date.parse(evidence.observedAt) > issuedAt
  )
    return null;
  const unsigned = {
    schemaVersion: request.schemaVersion,
    binding,
    evidence,
    issuedAt: request.issuedAt,
    nonce: request.nonce,
  };
  if (canonicalSha256(unsigned) !== request.requestSha256) return null;
  return Object.freeze({
    ...unsigned,
    requestSha256: request.requestSha256,
  }) as V213AcceptanceOperatorEvidenceRequest;
}

export function parseV213AcceptanceOperatorEvidenceResult(
  value: unknown,
  request: V213AcceptanceOperatorEvidenceRequest,
): V213AcceptanceOperatorEvidenceResult | null {
  const result = record(value);
  if (
    !result ||
    !exactKeys(result, [
      "checkpoint",
      "evidenceSha256",
      "executionRequestSha256",
      "fullLiveAuthorityId",
      "kind",
      "operationId",
      "recordedAt",
      "schemaVersion",
      "state",
      "workflowId",
    ]) ||
    result.schemaVersion !== V213_ACCEPTANCE_OPERATOR_EVIDENCE_RESULT_SCHEMA ||
    result.fullLiveAuthorityId !== request.binding.fullLiveAuthorityId ||
    result.operationId !== request.binding.operationId ||
    result.checkpoint !== request.binding.checkpoint ||
    result.workflowId !== request.binding.workflowId ||
    result.executionRequestSha256 !== request.binding.executionRequestSha256 ||
    result.kind !== request.evidence.kind ||
    typeof result.evidenceSha256 !== "string" ||
    !HASH.test(result.evidenceSha256) ||
    result.evidenceSha256 !== canonicalSha256(request.evidence) ||
    result.state !== "RECORDED" ||
    !utc(result.recordedAt)
  )
    return null;
  return result as unknown as V213AcceptanceOperatorEvidenceResult;
}

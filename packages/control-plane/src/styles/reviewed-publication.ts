import { canonicalizeJson, sha256CanonicalJson } from "@videoforge/contracts";
import { validateStoredStyleProfile } from "@videoforge/pipeline";

import type { ArtifactMetadata } from "../repositories/artifacts.js";
import type { AttemptRecord, GenerationTaskRecord } from "../repositories/execution.js";
import type {
  AcceptedImageStyleAnalysisAttempt,
  ImageStyle,
  ImageStyleAnalysisReferenceBinding,
  ImageStyleDraftVersion,
  PublishedImageStyleVersion,
} from "../repositories/presets.js";
import {
  deterministicIdempotencyKey,
  type CanonicalDocument,
  type DeterministicIdempotencyKey,
  type JsonObject,
  type RepositoryResult,
  type Sha256,
  type WorkspaceActorScope,
} from "../repositories/types.js";
import type { ControlPlaneRepositories } from "../repositories/unit-of-work.js";
import {
  DURABLE_STYLE_ANALYZER_MODEL,
  DURABLE_STYLE_ANALYZER_PROVIDER,
  composeDurableImageStyleAnalysisInput,
} from "./durable-analysis.js";
import type { ImageStyleProfileArtifact } from "./derived-artifact-edit.js";

export type ImageStyleReviewedPublicationErrorCode =
  | "AUTHORIZATION_REQUIRED"
  | "INPUT_INVALID"
  | "LINEAGE_INVALID"
  | "PROFILE_INVALID"
  | "REPOSITORY_FAILURE"
  | "REVIEW_STATE_INVALID";

export class ImageStyleReviewedPublicationError extends Error {
  public constructor(
    public readonly code: ImageStyleReviewedPublicationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ImageStyleReviewedPublicationError";
  }
}

export interface ImageStyleReviewLookup {
  readonly styleId: string;
  readonly versionId: string;
}

export interface PublishReviewedImageStyleCommand extends ImageStyleReviewLookup {
  readonly expectedUpdatedAt: string;
  readonly reviewedProfileHash: Sha256;
  readonly idempotencyKey: string;
  readonly publishedAt: string;
}

export interface ImageStyleReviewSnapshot {
  readonly kind: "IMAGE_STYLE_REVIEW_SNAPSHOT";
  readonly workspaceId: string;
  readonly styleId: string;
  readonly versionId: string;
  readonly versionNumber: number;
  readonly state: "NEEDS_REVIEW";
  readonly expectedUpdatedAt: string;
  readonly profileDocument: CanonicalDocument;
  readonly styleProfileHash: Sha256;
  readonly analyzerRequestHash: Sha256;
  readonly analyzerModelSnapshot: string;
  readonly disclosureAttestedByUserId: string;
  readonly analysisLineage: Readonly<{
    analysisAttemptId: string;
    taskId: string;
    executionAttemptId: string;
    outputAssetId: string;
    referenceSetHash: Sha256;
    analyzerOutputHash: Sha256;
    acceptedAt: string;
  }>;
}

export interface PublishedReviewedImageStyle {
  readonly kind: "REVIEWED_IMAGE_STYLE_PUBLISHED";
  readonly version: PublishedImageStyleVersion;
  readonly activeVersionId: string;
  readonly reviewerUserId: string;
  readonly reviewedProfileHash: Sha256;
  readonly analysisCompletedAt: string;
  readonly replayed: boolean;
}

type PublicationResult = RepositoryResult<PublishedReviewedImageStyle, string, string, string>;

interface ValidatedLineage {
  readonly style: ImageStyle;
  readonly version:
    | (ImageStyleDraftVersion & {
        readonly state: "NEEDS_REVIEW";
        readonly profileDocument: CanonicalDocument;
        readonly analyzerRequestHash: Sha256;
        readonly analyzerModelSnapshot: string;
        readonly disclosureAttestedByUserId: string;
      })
    | PublishedImageStyleVersion;
  readonly specialized: AcceptedImageStyleAnalysisAttempt;
  readonly task: GenerationTaskRecord;
  readonly general: AttemptRecord;
  readonly artifact: ArtifactMetadata;
  readonly references: readonly ImageStyleAnalysisReferenceBinding[];
  readonly referenceSetHash: Sha256;
  readonly analysisCompletedAt: string;
  readonly rootProfileDocument: CanonicalDocument;
  readonly currentProfileDocument: CanonicalDocument;
  readonly derivedCurrentProfile: boolean;
  readonly reviewedProfileUpdatedAt: string;
}

export interface ImageStylePublicationProfileResolver {
  resolvePublicationProfileLineage(
    scope: WorkspaceActorScope,
    lookup: ImageStyleReviewLookup,
  ): Promise<Readonly<{
    root: ImageStyleProfileArtifact;
    current: ImageStyleProfileArtifact;
    revision: number;
  }> | null>;
}

const LOOKUP_KEYS = ["styleId", "versionId"] as const;
const COMMAND_KEYS = [
  "expectedUpdatedAt",
  "idempotencyKey",
  "publishedAt",
  "reviewedProfileHash",
  "styleId",
  "versionId",
] as const;
const SCOPE_KEYS = ["actorUserId", "workspaceId"] as const;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u;

function fail(code: ImageStyleReviewedPublicationErrorCode, message: string): never {
  throw new ImageStyleReviewedPublicationError(code, message);
}

function exactPlainRecord(
  value: unknown,
  keys: readonly string[],
  code: "AUTHORIZATION_REQUIRED" | "INPUT_INVALID",
  label: string,
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail(code, `${label} must be a plain exact-shape object.`);
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  const descriptors = Object.getOwnPropertyDescriptors(value) as Record<
    PropertyKey,
    PropertyDescriptor
  >;
  const actualKeys = Reflect.ownKeys(descriptors);
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    actualKeys.some((key) => typeof key !== "string") ||
    actualKeys.length !== keys.length ||
    keys.some((key) => !actualKeys.includes(key))
  ) {
    return fail(code, `${label} must be a plain exact-shape object.`);
  }
  const snapshot: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor)) {
      return fail(code, `${label} cannot contain accessors.`);
    }
    snapshot[key] = descriptor.value;
  }
  return Object.freeze(snapshot);
}

function boundedText(value: unknown, label: string, maximum = 240): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    value !== value.trim()
  ) {
    return fail("INPUT_INVALID", `${label} is invalid.`);
  }
  return value;
}

function timestamp(value: unknown, label: string): string {
  const candidate = boundedText(value, label, 40);
  if (!UTC_TIMESTAMP.test(candidate) || !Number.isFinite(Date.parse(candidate))) {
    return fail("INPUT_INVALID", `${label} must be a valid UTC timestamp.`);
  }
  return candidate;
}

function scopeSnapshot(value: WorkspaceActorScope): WorkspaceActorScope {
  const snapshot = exactPlainRecord(value, SCOPE_KEYS, "AUTHORIZATION_REQUIRED", "Actor scope");
  const workspaceId = boundedText(snapshot.workspaceId, "workspaceId", 160);
  const actorUserId = boundedText(snapshot.actorUserId, "actorUserId", 160);
  return Object.freeze({ workspaceId, actorUserId });
}

function lookupSnapshot(value: ImageStyleReviewLookup): ImageStyleReviewLookup {
  const snapshot = exactPlainRecord(value, LOOKUP_KEYS, "INPUT_INVALID", "Review lookup");
  return Object.freeze({
    styleId: boundedText(snapshot.styleId, "styleId", 160),
    versionId: boundedText(snapshot.versionId, "versionId", 160),
  });
}

function commandSnapshot(
  value: PublishReviewedImageStyleCommand,
): PublishReviewedImageStyleCommand {
  const snapshot = exactPlainRecord(value, COMMAND_KEYS, "INPUT_INVALID", "Publication command");
  const reviewedProfileHash = boundedText(snapshot.reviewedProfileHash, "reviewedProfileHash", 71);
  if (!SHA256.test(reviewedProfileHash)) {
    return fail("INPUT_INVALID", "reviewedProfileHash must be an exact SHA-256 digest.");
  }
  const expectedUpdatedAt = timestamp(snapshot.expectedUpdatedAt, "expectedUpdatedAt");
  const publishedAt = timestamp(snapshot.publishedAt, "publishedAt");
  if (Date.parse(publishedAt) < Date.parse(expectedUpdatedAt)) {
    return fail("INPUT_INVALID", "publishedAt cannot precede the reviewed version timestamp.");
  }
  return Object.freeze({
    styleId: boundedText(snapshot.styleId, "styleId", 160),
    versionId: boundedText(snapshot.versionId, "versionId", 160),
    expectedUpdatedAt,
    reviewedProfileHash: reviewedProfileHash as Sha256,
    idempotencyKey: boundedText(snapshot.idempotencyKey, "idempotencyKey", 240),
    publishedAt,
  });
}

function deepFreeze<Value>(value: Value): Value {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Array.isArray(value) ? value : Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function sameValue(left: unknown, right: unknown): boolean {
  try {
    return canonicalizeJson(left) === canonicalizeJson(right);
  } catch {
    return false;
  }
}

function repositoryFailure(message: string): never {
  return fail("REPOSITORY_FAILURE", message);
}

function stateFailure(message: string): never {
  return fail("REVIEW_STATE_INVALID", message);
}

function lineageFailure(message: string): never {
  return fail("LINEAGE_INVALID", message);
}

function expectedArtifactMetadata(
  specialized: AcceptedImageStyleAnalysisAttempt,
  referenceSetHash: Sha256,
): JsonObject {
  const usage = specialized.usagePayload;
  return {
    source: "image-style-analysis",
    analysis_attempt_id: specialized.analysisAttemptId,
    task_id: specialized.taskId,
    execution_attempt_id: specialized.executionAttemptId,
    analyzer_request_hash: specialized.requestHash,
    reference_set_hash: referenceSetHash,
    analyzer_output_hash: specialized.responseHash,
    analyzer_model_snapshot: canonicalizeJson({
      model: specialized.model,
      model_revision: specialized.modelRevision,
      provider: specialized.provider,
    }),
    usage_schema_version: usage.schema_version,
    provider_attempt_count: usage.provider_attempt_count,
    prompt_tokens: usage.prompt_tokens,
    completion_tokens: usage.completion_tokens,
    total_tokens: usage.total_tokens,
    reasoning_tokens: usage.reasoning_tokens,
    reported_cost_micro_usd: specialized.reportedCostMicroUsd.toString(),
  };
}

function expectedProviderDetails(
  specialized: AcceptedImageStyleAnalysisAttempt,
  referenceSetHash: Sha256,
): JsonObject {
  return {
    source: "image-style-analysis",
    analysis_attempt_id: specialized.analysisAttemptId,
    analyzer_request_hash: specialized.requestHash,
    reference_set_hash: referenceSetHash,
    analyzer_output_hash: specialized.responseHash,
    analyzer_model_snapshot: canonicalizeJson({
      model: specialized.model,
      model_revision: specialized.modelRevision,
      provider: specialized.provider,
    }),
    usage: specialized.usagePayload,
    reported_cost_micro_usd: specialized.reportedCostMicroUsd.toString(),
  };
}

async function validateAcceptedLineage(
  repositories: ControlPlaneRepositories,
  scope: WorkspaceActorScope,
  lookup: ImageStyleReviewLookup,
  allowPublishedReplay: boolean,
  profileResolver?: ImageStylePublicationProfileResolver,
): Promise<ValidatedLineage> {
  const [styleResult, versionResult, specializedResult, referencesResult] = await Promise.all([
    repositories.imageStyles.resolveStyle(scope, lookup.styleId),
    repositories.imageStyles.resolveVersion(scope, lookup),
    repositories.imageStyles.resolveAcceptedAnalysisAttempt(scope, lookup),
    repositories.imageStyles.resolveAnalysisReferenceSet(scope, lookup),
  ]);
  if (!styleResult.ok || !versionResult.ok) {
    return stateFailure("Image Style review state cannot be resolved in this workspace.");
  }
  if (!specializedResult.ok || !referencesResult.ok) {
    return lineageFailure("Accepted Image Style analysis lineage cannot be resolved.");
  }
  const style = styleResult.value;
  const version = versionResult.value;
  const specialized = specializedResult.value;
  const references = referencesResult.value;
  if (style.status !== "ACTIVE") {
    return stateFailure("Archived Image Styles cannot be reviewed or published.");
  }
  if (
    version.state !== "NEEDS_REVIEW" &&
    !(allowPublishedReplay && version.state === "PUBLISHED")
  ) {
    return stateFailure("Image Style version is not in an exact reviewable state.");
  }
  if (
    version.profileDocument === null ||
    version.analyzerRequestHash === null ||
    version.analyzerModelSnapshot === null ||
    version.disclosureAttestedByUserId === null
  ) {
    return lineageFailure("Image Style review profile or analyzer provenance is incomplete.");
  }
  const reviewedVersion = version as ValidatedLineage["version"];

  const persistedLineage =
    profileResolver === undefined
      ? null
      : await profileResolver.resolvePublicationProfileLineage(scope, lookup);
  if (profileResolver !== undefined && persistedLineage === null) {
    return lineageFailure("Durable Image Style profile artifact lineage cannot be resolved.");
  }
  const rootProfileDocument =
    persistedLineage?.root.profileDocument ?? reviewedVersion.profileDocument;
  const currentProfileDocument =
    persistedLineage?.current.profileDocument ?? reviewedVersion.profileDocument;
  const derivedCurrentProfile = persistedLineage?.current.origin === "MANUAL_EDIT";
  if (
    !sameValue(reviewedVersion.profileDocument, currentProfileDocument) ||
    (persistedLineage !== null &&
      (persistedLineage.root.origin !== "VISION_ANALYSIS" ||
        persistedLineage.root.rootSourceArtifactId !== persistedLineage.root.artifactId ||
        persistedLineage.root.rootSourceArtifactHash !==
          persistedLineage.root.profileDocument.canonicalDocumentSha256 ||
        persistedLineage.root.sourceAnalysisEvidence !== "HISTORICAL_SOURCE_TRUTH" ||
        persistedLineage.current.rootSourceArtifactId !== persistedLineage.root.artifactId ||
        persistedLineage.current.rootSourceArtifactHash !==
          persistedLineage.root.profileDocument.canonicalDocumentSha256))
  ) {
    return lineageFailure("Current/root Image Style profile pointers or bytes changed.");
  }

  let validatedRootProfile;
  try {
    validatedRootProfile = await validateStoredStyleProfile(
      rootProfileDocument.payload,
      references.map((reference) => reference.alias),
    );
  } catch {
    return fail("PROFILE_INVALID", "Stored source Image Style profile failed semantic validation.");
  }
  if (
    validatedRootProfile.styleProfileHash !== rootProfileDocument.canonicalDocumentSha256 ||
    rootProfileDocument.contractName !== "image-style-profile" ||
    rootProfileDocument.contractVersion !== "v1" ||
    !sameValue(validatedRootProfile.profile, rootProfileDocument.payload)
  ) {
    return fail("PROFILE_INVALID", "Stored source Image Style profile bytes or hash changed.");
  }
  if (derivedCurrentProfile) {
    const current = currentProfileDocument.payload as Record<string, unknown>;
    const detached = {
      analysis_kind: "MANUAL_EDIT",
      overall_confidence: null,
      trait_evidence: [],
      uncertain_fields: [],
      outlier_reference_aliases: [],
      content_leakage_warnings: [],
    };
    try {
      await validateStoredStyleProfile(
        { ...current, analysis: validatedRootProfile.profile.analysis },
        references.map((reference) => reference.alias),
      );
    } catch {
      return fail("PROFILE_INVALID", "Derived Image Style creative bytes failed validation.");
    }
    if (
      currentProfileDocument.contractName !== "image-style-profile" ||
      currentProfileDocument.contractVersion !== "v1" ||
      (await sha256CanonicalJson(currentProfileDocument.payload)) !==
        currentProfileDocument.canonicalDocumentSha256 ||
      !sameValue(current.analysis, detached)
    ) {
      return fail("PROFILE_INVALID", "Derived Image Style bytes retained stale analyzer evidence.");
    }
  }

  const recomposed = await composeDurableImageStyleAnalysisInput(
    scope.workspaceId,
    {
      styleId: lookup.styleId,
      versionId: lookup.versionId,
      analysisAttemptId: specialized.analysisAttemptId,
      taskId: specialized.taskId,
      executionAttemptId: specialized.executionAttemptId,
      provider: DURABLE_STYLE_ANALYZER_PROVIDER,
      model: DURABLE_STYLE_ANALYZER_MODEL,
      modelRevision: specialized.modelRevision,
    },
    references,
  );
  if (
    specialized.styleVersionId !== lookup.versionId ||
    specialized.provider !== DURABLE_STYLE_ANALYZER_PROVIDER ||
    specialized.model !== DURABLE_STYLE_ANALYZER_MODEL ||
    specialized.requestHash !== recomposed.inputFingerprintHash ||
    reviewedVersion.analyzerRequestHash !== recomposed.inputFingerprintHash ||
    reviewedVersion.analyzerModelSnapshot !== recomposed.analyzerModelSnapshot
  ) {
    return lineageFailure("Analyzer request, model, version, or reference lineage changed.");
  }

  const [taskResult, attemptsResult, costResult] = await Promise.all([
    repositories.execution.resolveTask(scope, { taskId: specialized.taskId }),
    repositories.execution.listAttempts(scope, { taskId: specialized.taskId }),
    repositories.events.summarizeTaskCost(scope, {
      taskId: specialized.taskId,
      attemptId: specialized.executionAttemptId,
    }),
  ]);
  if (!taskResult.ok || !attemptsResult.ok || !costResult.ok) {
    return lineageFailure("Accepted task, attempt, or finalized cost lineage cannot be resolved.");
  }
  const task = taskResult.value;
  const general = attemptsResult.value.find(
    (attempt) => attempt.attemptId === specialized.executionAttemptId,
  );
  if (general === undefined || general.state === "UNKNOWN" || general.outputAssetId === null) {
    return lineageFailure("Accepted general attempt is missing or incomplete.");
  }
  const artifactResult = await repositories.artifacts.resolveExact(scope, general.outputAssetId);
  if (!artifactResult.ok) {
    return lineageFailure("Accepted canonical profile artifact cannot be resolved.");
  }
  const artifact = artifactResult.value;
  const cost = costResult.value;
  const analysisCompletedAt = task.finishedAt;
  if (analysisCompletedAt === null) {
    return lineageFailure("Accepted Image Style task has no completion timestamp.");
  }
  const profileHash = rootProfileDocument.canonicalDocumentSha256;
  const expectedObjectKey = `workspace/${scope.workspaceId}/image-style/${lookup.styleId}/version/${lookup.versionId}/analysis/${profileHash.slice("sha256:".length)}.json`;
  const expectedBytes = new TextEncoder().encode(canonicalizeJson(rootProfileDocument.payload));
  if (
    task.owner.ownerType !== "IMAGE_STYLE_VERSION" ||
    task.owner.ownerId !== lookup.versionId ||
    task.owner.imageStyleVersionId !== lookup.versionId ||
    task.state !== "COMPLETE" ||
    task.acceptedAttemptId !== specialized.executionAttemptId ||
    general.taskId !== specialized.taskId ||
    general.ordinal !== specialized.ordinal ||
    general.idempotencyKey !== specialized.idempotencyKey ||
    general.inputHash !== specialized.requestHash ||
    general.state !== "SUCCEEDED" ||
    general.claimState !== "CLAIMED" ||
    general.resultDisposition !== "ACCEPTED" ||
    general.finishedAt !== analysisCompletedAt ||
    !sameValue(
      general.providerDetails,
      expectedProviderDetails(specialized, recomposed.referenceSetHash),
    ) ||
    artifact.projectId !== null ||
    artifact.projectRevisionId !== null ||
    artifact.sourceAttemptId !== specialized.executionAttemptId ||
    artifact.kind !== "CANONICAL_DOCUMENT" ||
    (artifact.state !== "VERIFIED" && artifact.state !== "ACCEPTED") ||
    artifact.objectKey !== expectedObjectKey ||
    artifact.contentType !== "application/json" ||
    artifact.binarySha256 !== profileHash ||
    artifact.canonicalContractName !== "image-style-profile" ||
    artifact.canonicalContractVersion !== "v1" ||
    artifact.canonicalDocumentSha256 !== profileHash ||
    artifact.byteSize !== BigInt(expectedBytes.byteLength) ||
    artifact.widthPx !== null ||
    artifact.heightPx !== null ||
    artifact.durationMs !== null ||
    artifact.verifiedAt !== analysisCompletedAt ||
    !sameValue(
      artifact.metadata,
      expectedArtifactMetadata(specialized, recomposed.referenceSetHash),
    ) ||
    cost.owner.ownerType !== "IMAGE_STYLE_VERSION" ||
    cost.owner.ownerId !== lookup.versionId ||
    cost.owner.imageStyleVersionId !== lookup.versionId ||
    cost.reservedEventCount !== 1 ||
    cost.reportedEventCount !== 1 ||
    cost.settledEventCount !== 1 ||
    cost.finalizationEventCount < 1 ||
    cost.invalidReservationAttemptCount !== 0 ||
    cost.unsettledReportedAttemptCount !== 0 ||
    cost.nonConservingAttemptCount !== 0 ||
    cost.activeReservationMicroUsd !== 0n ||
    cost.reportedMicroUsd !== specialized.reportedCostMicroUsd ||
    cost.settledMicroUsd !== specialized.reportedCostMicroUsd
  ) {
    return lineageFailure("Accepted VF-7-04 task, attempt, artifact, or cost lineage changed.");
  }
  if (
    (reviewedVersion.state === "NEEDS_REVIEW" &&
      !derivedCurrentProfile &&
      reviewedVersion.updatedAt !== analysisCompletedAt) ||
    (reviewedVersion.state === "NEEDS_REVIEW" &&
      derivedCurrentProfile &&
      Date.parse(reviewedVersion.updatedAt) < Date.parse(analysisCompletedAt)) ||
    (reviewedVersion.state === "PUBLISHED" &&
      (style.activeVersionId !== reviewedVersion.versionId || reviewedVersion.publishedAt === null))
  ) {
    return stateFailure(
      "Image Style lifecycle or active pointer changed outside reviewed publication.",
    );
  }

  return deepFreeze({
    style,
    version: reviewedVersion,
    specialized,
    task,
    general,
    artifact,
    references,
    referenceSetHash: recomposed.referenceSetHash,
    analysisCompletedAt,
    rootProfileDocument,
    currentProfileDocument,
    derivedCurrentProfile,
    reviewedProfileUpdatedAt:
      persistedLineage?.current.createdAt ??
      (reviewedVersion.state === "PUBLISHED" ? analysisCompletedAt : reviewedVersion.updatedAt),
  });
}

function reviewSnapshot(lineage: ValidatedLineage): ImageStyleReviewSnapshot {
  if (lineage.version.state !== "NEEDS_REVIEW") {
    return stateFailure(
      "Published Image Style versions no longer expose a pending review snapshot.",
    );
  }
  return deepFreeze({
    kind: "IMAGE_STYLE_REVIEW_SNAPSHOT" as const,
    workspaceId: lineage.version.workspaceId,
    styleId: lineage.version.styleId,
    versionId: lineage.version.versionId,
    versionNumber: lineage.version.versionNumber,
    state: "NEEDS_REVIEW" as const,
    expectedUpdatedAt: lineage.reviewedProfileUpdatedAt,
    profileDocument: lineage.currentProfileDocument,
    styleProfileHash: lineage.currentProfileDocument.canonicalDocumentSha256,
    analyzerRequestHash: lineage.specialized.requestHash,
    analyzerModelSnapshot: lineage.version.analyzerModelSnapshot!,
    disclosureAttestedByUserId: lineage.version.disclosureAttestedByUserId!,
    analysisLineage: {
      analysisAttemptId: lineage.specialized.analysisAttemptId,
      taskId: lineage.specialized.taskId,
      executionAttemptId: lineage.specialized.executionAttemptId,
      outputAssetId: lineage.artifact.assetId,
      referenceSetHash: lineage.referenceSetHash,
      analyzerOutputHash: lineage.specialized.responseHash,
      acceptedAt: lineage.analysisCompletedAt,
    },
  });
}

export async function deriveImageStylePublicationIdempotencyKey(
  scopeInput: WorkspaceActorScope,
  commandInput: Omit<PublishReviewedImageStyleCommand, "idempotencyKey">,
): Promise<DeterministicIdempotencyKey> {
  const scope = scopeSnapshot(scopeInput);
  const command = commandSnapshot({ ...commandInput, idempotencyKey: "pending" });
  const hash = await sha256CanonicalJson({
    schema_version: "videoforge.image-style-reviewed-publication/v1",
    workspace_id: scope.workspaceId,
    reviewer_user_id: scope.actorUserId,
    style_id: command.styleId,
    version_id: command.versionId,
    expected_updated_at: command.expectedUpdatedAt,
    reviewed_profile_hash: command.reviewedProfileHash,
    published_at: command.publishedAt,
  });
  return deterministicIdempotencyKey(`style-reviewed-publish:${hash.slice("sha256:".length)}`);
}

/** Provider-free service. No analyzer, reference bytes, credentials, environment, or network. */
export class ReviewedImageStylePublicationService {
  public constructor(
    private readonly repositories: ControlPlaneRepositories,
    private readonly profileResolver?: ImageStylePublicationProfileResolver,
  ) {}

  public async getReviewSnapshot(
    scopeInput: WorkspaceActorScope,
    lookupInput: ImageStyleReviewLookup,
  ): Promise<ImageStyleReviewSnapshot> {
    const scope = scopeSnapshot(scopeInput);
    const lookup = lookupSnapshot(lookupInput);
    const lineage = await validateAcceptedLineage(
      this.repositories,
      scope,
      lookup,
      false,
      this.profileResolver,
    );
    return reviewSnapshot(lineage);
  }

  public async publish(
    scopeInput: WorkspaceActorScope,
    commandInput: PublishReviewedImageStyleCommand,
  ): Promise<PublicationResult> {
    const scope = scopeSnapshot(scopeInput);
    const command = commandSnapshot(commandInput);
    const expectedIdempotencyKey = await deriveImageStylePublicationIdempotencyKey(scope, {
      styleId: command.styleId,
      versionId: command.versionId,
      expectedUpdatedAt: command.expectedUpdatedAt,
      reviewedProfileHash: command.reviewedProfileHash,
      publishedAt: command.publishedAt,
    });
    if (command.idempotencyKey !== expectedIdempotencyKey) {
      return fail("INPUT_INVALID", "Publication idempotency key is not derived from exact inputs.");
    }

    const lineage = await validateAcceptedLineage(
      this.repositories,
      scope,
      command,
      true,
      this.profileResolver,
    );
    const profile = lineage.currentProfileDocument;
    if (
      command.expectedUpdatedAt !== lineage.reviewedProfileUpdatedAt ||
      command.reviewedProfileHash !== profile.canonicalDocumentSha256 ||
      (lineage.version.state === "NEEDS_REVIEW" &&
        lineage.version.updatedAt !== command.expectedUpdatedAt) ||
      (lineage.version.state === "PUBLISHED" && lineage.version.publishedAt !== command.publishedAt)
    ) {
      return stateFailure("Reviewed timestamp, profile hash, or publication replay changed.");
    }

    const published = await this.repositories.imageStyles.publishVersion(scope, {
      idempotencyKey: expectedIdempotencyKey,
      styleId: command.styleId,
      versionId: command.versionId,
      expectedUpdatedAt: command.expectedUpdatedAt,
      profileDocument: profile,
      analyzerRequestHash: lineage.version.analyzerRequestHash,
      analyzerModelSnapshot: lineage.version.analyzerModelSnapshot,
      disclosureAttestedByUserId: lineage.version.disclosureAttestedByUserId,
      publishedAt: command.publishedAt,
    });
    if (!published.ok) return published;
    const active = await this.repositories.imageStyles.resolveStyle(scope, command.styleId);
    if (!active.ok || active.value.activeVersionId !== command.versionId) {
      return repositoryFailure("Published Image Style active pointer cannot be confirmed.");
    }
    return {
      ok: true,
      value: deepFreeze({
        kind: "REVIEWED_IMAGE_STYLE_PUBLISHED" as const,
        version: published.value.value,
        activeVersionId: active.value.activeVersionId,
        reviewerUserId: scope.actorUserId,
        reviewedProfileHash: command.reviewedProfileHash,
        analysisCompletedAt: lineage.analysisCompletedAt,
        replayed: published.value.replayed,
      }),
    };
  }
}

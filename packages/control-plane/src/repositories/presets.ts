import type {
  AvatarProfileVersionTaskAttemptReservation,
  AvatarProfileVersionTaskAttemptReservationCommand,
  ImageStyleVersionTaskAttemptReservation,
  ImageStyleVersionTaskAttemptReservationCommand,
} from "./execution.js";
import type {
  CanonicalDocument,
  CommonConflictCode,
  CommonInvariantCode,
  DeterministicIdempotencyKey,
  EntityId,
  IdempotentMutation,
  IdempotentRepositoryResult,
  JsonObject,
  RepositoryResult,
  Sha256,
  UtcTimestamp,
  WorkspaceActorScope,
  WorkspaceScope,
} from "./types.js";

export type PresetStatus = "ACTIVE" | "ARCHIVED";
export type ExactVersionUse = "NEW_REVISION" | "HISTORICAL_LINEAGE";

export interface AvatarProfile {
  readonly profileId: EntityId;
  readonly workspaceId: EntityId;
  readonly name: string;
  readonly normalizedName: string;
  readonly status: PresetStatus;
  readonly activeVersionId: EntityId | null;
  readonly thumbnailAssetId: EntityId | null;
  readonly createdByUserId: EntityId;
  readonly createdAt: UtcTimestamp;
  readonly updatedAt: UtcTimestamp;
  readonly archivedAt: UtcTimestamp | null;
}

export type AvatarDraftState = "DRAFT" | "VALIDATING" | "NEEDS_REVIEW" | "FAILED";

export interface AvatarVersionBase {
  readonly versionId: EntityId;
  readonly workspaceId: EntityId;
  readonly profileId: EntityId;
  readonly versionNumber: number;
  readonly createdAt: UtcTimestamp;
  readonly updatedAt: UtcTimestamp;
}

export interface AvatarProfileDraftVersion extends AvatarVersionBase {
  readonly state: AvatarDraftState;
  readonly profileDocument: CanonicalDocument | null;
  readonly originalAssetId: EntityId | null;
  readonly runtimeSourceAssetId: EntityId | null;
  readonly runtimeSourceBinarySha256: Sha256 | null;
  readonly sourcePreparationProfile: string | null;
  readonly sourceValidationProfile: string | null;
  readonly rightsAttestedByUserId: EntityId | null;
  readonly likenessAttestedByUserId: EntityId | null;
}

export interface ReadyAvatarProfileVersion extends AvatarVersionBase {
  readonly state: "READY";
  readonly profileDocument: CanonicalDocument;
  readonly originalAssetId: EntityId;
  readonly runtimeSourceAssetId: EntityId;
  readonly runtimeSourceBinarySha256: Sha256;
  readonly sourcePreparationProfile: string;
  readonly sourceValidationProfile: string;
  readonly rightsAttestedByUserId: EntityId;
  readonly likenessAttestedByUserId: EntityId;
  readonly readyAt: UtcTimestamp;
}

export interface AbandonedAvatarProfileVersion extends AvatarVersionBase {
  readonly state: "ABANDONED";
  readonly abandonedAt: UtcTimestamp;
}

export type AvatarProfileVersion =
  | AvatarProfileDraftVersion
  | ReadyAvatarProfileVersion
  | AbandonedAvatarProfileVersion;

export interface CreateAvatarProfileCommand extends IdempotentMutation {
  readonly profileId: EntityId;
  readonly name: string;
  readonly normalizedName: string;
}

export interface CreateAvatarDraftCommand extends IdempotentMutation {
  readonly profileId: EntityId;
  readonly versionId: EntityId;
  readonly versionNumber: number;
}

export interface SaveAvatarDraftCommand extends IdempotentMutation {
  readonly profileId: EntityId;
  readonly versionId: EntityId;
  readonly expectedUpdatedAt: UtcTimestamp;
  readonly nextState: AvatarDraftState;
  readonly profileDocument: CanonicalDocument | null;
  readonly originalAssetId: EntityId | null;
  readonly runtimeSourceAssetId: EntityId | null;
  readonly runtimeSourceBinarySha256: Sha256 | null;
  readonly sourcePreparationProfile: string | null;
  readonly sourceValidationProfile: string | null;
  readonly rightsAttestedByUserId: EntityId | null;
  readonly likenessAttestedByUserId: EntityId | null;
}

export interface PublishAvatarVersionCommand extends IdempotentMutation {
  readonly profileId: EntityId;
  readonly versionId: EntityId;
  readonly expectedUpdatedAt: UtcTimestamp;
  readonly profileDocument: CanonicalDocument;
  readonly originalAssetId: EntityId;
  readonly runtimeSourceAssetId: EntityId;
  readonly runtimeSourceBinarySha256: Sha256;
  readonly sourcePreparationProfile: string;
  readonly sourceValidationProfile: string;
  readonly rightsAttestedByUserId: EntityId;
  readonly likenessAttestedByUserId: EntityId;
  readonly readyAt: UtcTimestamp;
}

export interface ExactAvatarVersionLookup {
  readonly profileId: EntityId;
  readonly versionId: EntityId;
  readonly use: ExactVersionUse;
}

export interface ArchiveAvatarProfileCommand extends IdempotentMutation {
  readonly profileId: EntityId;
  readonly expectedUpdatedAt: UtcTimestamp;
  readonly archivedAt: UtcTimestamp;
}

/** No assessment row means UNTESTED; every persisted assessment is one of these states. */
export type AvatarCompatibilityAssessmentState =
  | "RUNNING"
  | "PASSED"
  | "FAILED"
  | "STALE"
  | "CANCELLED";

export interface AvatarCompatibilityAssessmentBase {
  readonly assessmentId: EntityId;
  readonly workspaceId: EntityId;
  readonly avatarProfileVersionId: EntityId;
  readonly executionProfileId: EntityId;
  readonly createdAt: UtcTimestamp;
  readonly updatedAt: UtcTimestamp;
}

export interface RunningAvatarCompatibilityAssessment extends AvatarCompatibilityAssessmentBase {
  readonly state: "RUNNING";
  readonly modelSnapshotHash: null;
  readonly evidenceDocument: null;
  readonly evidenceHash: null;
  readonly finishedAt: null;
}

export interface TerminalAvatarCompatibilityAssessment extends AvatarCompatibilityAssessmentBase {
  readonly state: "PASSED" | "FAILED" | "STALE" | "CANCELLED";
  readonly modelSnapshotHash: Sha256;
  readonly evidenceDocument: CanonicalDocument;
  readonly evidenceHash: Sha256;
  readonly finishedAt: UtcTimestamp;
}

export type AvatarCompatibilityAssessment =
  | RunningAvatarCompatibilityAssessment
  | TerminalAvatarCompatibilityAssessment;

export interface AvatarProfileTestAttemptBase {
  readonly testAttemptId: EntityId;
  readonly workspaceId: EntityId;
  readonly avatarProfileVersionId: EntityId;
  readonly assessmentId: EntityId;
  /** Required FK to the general attempt created in the same transaction. */
  readonly executionAttemptId: EntityId;
  readonly taskId: EntityId;
  readonly reservationCostEventId: EntityId;
  readonly dispatchOutboxId: EntityId;
  readonly ordinal: number;
  readonly idempotencyKey: DeterministicIdempotencyKey;
  readonly createdAt: UtcTimestamp;
}

export interface NonUnknownAvatarProfileTestAttempt extends AvatarProfileTestAttemptBase {
  readonly state: "CREATED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  readonly externalJobId: string | null;
  readonly outputAssetId: EntityId | null;
  readonly reportedCostMicroUsd: bigint | null;
  readonly startedAt: UtcTimestamp | null;
  readonly finishedAt: UtcTimestamp | null;
}

export interface UnknownAvatarProfileTestAttempt extends AvatarProfileTestAttemptBase {
  readonly state: "UNKNOWN";
  readonly externalJobId: string | null;
  readonly outputAssetId: null;
  readonly reportedCostMicroUsd: bigint | null;
  readonly startedAt: UtcTimestamp | null;
  readonly finishedAt: null;
}

export interface CreatedAvatarProfileTestAttempt extends AvatarProfileTestAttemptBase {
  readonly state: "CREATED";
  readonly externalJobId: null;
  readonly outputAssetId: null;
  readonly reportedCostMicroUsd: null;
  readonly startedAt: null;
  readonly finishedAt: null;
}

export type AvatarProfileTestAttempt =
  | NonUnknownAvatarProfileTestAttempt
  | UnknownAvatarProfileTestAttempt;

export interface BeginAvatarCompatibilityTestCommand extends IdempotentMutation {
  readonly profileId: EntityId;
  readonly versionId: EntityId;
  readonly assessmentId: EntityId;
  readonly testAttemptId: EntityId;
  /**
   * The embedded reservation supplies task, execution attempt, budget event, and DISPATCH outbox.
   * Its owner must be this exact AVATAR_PROFILE_VERSION; adapters reject any ID mismatch.
   */
  readonly reservation: Omit<AvatarProfileVersionTaskAttemptReservationCommand, "idempotencyKey">;
}

export interface StartedAvatarCompatibilityTest {
  readonly kind: "AVATAR_COMPATIBILITY_TEST_STARTED";
  readonly assessment: RunningAvatarCompatibilityAssessment;
  readonly testAttempt: CreatedAvatarProfileTestAttempt;
  readonly reservation: AvatarProfileVersionTaskAttemptReservation;
}

export type AvatarConflict =
  | CommonConflictCode
  | "AVATAR_COMPATIBILITY_TEST_CONFLICT"
  | "AVATAR_PROFILE_VERSION_CONFLICT"
  | "AVATAR_READY_HASH_EXISTS";
export type AvatarMissing =
  | "AVATAR_COMPATIBILITY_ASSESSMENT"
  | "AVATAR_PROFILE"
  | "AVATAR_PROFILE_VERSION"
  | "ASSET"
  | "EXECUTION_PROFILE";
export type AvatarInvariant =
  | CommonInvariantCode
  | "AVATAR_COMPATIBILITY_BILLING_BOUNDARY_MISMATCH"
  | "AVATAR_PROFILE_ARCHIVED"
  | "AVATAR_VERSION_NOT_READY"
  | "AVATAR_VERSION_NOT_PUBLISHABLE";

export interface AvatarProfileRepository {
  createProfile(
    scope: WorkspaceActorScope,
    command: CreateAvatarProfileCommand,
  ): Promise<
    IdempotentRepositoryResult<AvatarProfile, AvatarConflict, AvatarMissing, AvatarInvariant>
  >;

  createDraftVersion(
    scope: WorkspaceActorScope,
    command: CreateAvatarDraftCommand,
  ): Promise<
    IdempotentRepositoryResult<
      AvatarProfileDraftVersion,
      AvatarConflict,
      AvatarMissing,
      AvatarInvariant
    >
  >;

  saveDraftVersion(
    scope: WorkspaceActorScope,
    command: SaveAvatarDraftCommand,
  ): Promise<
    IdempotentRepositoryResult<
      AvatarProfileDraftVersion,
      AvatarConflict,
      AvatarMissing,
      AvatarInvariant
    >
  >;

  /** Atomically marks the version READY and makes it the parent's active version. */
  publishVersion(
    scope: WorkspaceActorScope,
    command: PublishAvatarVersionCommand,
  ): Promise<
    IdempotentRepositoryResult<
      ReadyAvatarProfileVersion,
      AvatarConflict,
      AvatarMissing,
      AvatarInvariant
    >
  >;

  resolveExactReadyVersion(
    scope: WorkspaceScope,
    lookup: ExactAvatarVersionLookup,
  ): Promise<
    RepositoryResult<ReadyAvatarProfileVersion, AvatarConflict, AvatarMissing, AvatarInvariant>
  >;

  /** Atomically creates the assessment/test row and its task, attempt, budget, and outbox rows. */
  beginCompatibilityTest(
    scope: WorkspaceActorScope,
    command: BeginAvatarCompatibilityTestCommand,
  ): Promise<
    IdempotentRepositoryResult<
      StartedAvatarCompatibilityTest,
      AvatarConflict,
      AvatarMissing,
      AvatarInvariant
    >
  >;

  archiveProfile(
    scope: WorkspaceActorScope,
    command: ArchiveAvatarProfileCommand,
  ): Promise<
    IdempotentRepositoryResult<AvatarProfile, AvatarConflict, AvatarMissing, AvatarInvariant>
  >;
}

export interface ImageStyle {
  readonly styleId: EntityId;
  readonly workspaceId: EntityId;
  readonly name: string;
  readonly normalizedName: string;
  readonly status: PresetStatus;
  readonly activeVersionId: EntityId | null;
  readonly coverAssetId: EntityId | null;
  readonly createdByUserId: EntityId;
  readonly createdAt: UtcTimestamp;
  readonly updatedAt: UtcTimestamp;
  readonly archivedAt: UtcTimestamp | null;
}

export type ImageStyleDraftState = "DRAFT" | "ANALYZING" | "NEEDS_REVIEW" | "FAILED";

export interface ImageStyleVersionBase {
  readonly versionId: EntityId;
  readonly workspaceId: EntityId;
  readonly styleId: EntityId;
  readonly versionNumber: number;
  readonly createdAt: UtcTimestamp;
  readonly updatedAt: UtcTimestamp;
}

export interface ImageStyleDraftVersion extends ImageStyleVersionBase {
  readonly state: ImageStyleDraftState;
  readonly profileDocument: CanonicalDocument | null;
  readonly analyzerRequestHash: Sha256 | null;
  readonly analyzerModelSnapshot: string | null;
  readonly disclosureAttestedByUserId: EntityId | null;
}

export interface PublishedImageStyleVersion extends ImageStyleVersionBase {
  readonly state: "PUBLISHED";
  readonly profileDocument: CanonicalDocument;
  readonly analyzerRequestHash: Sha256 | null;
  readonly analyzerModelSnapshot: string | null;
  readonly disclosureAttestedByUserId: EntityId;
  readonly publishedAt: UtcTimestamp;
}

export interface AbandonedImageStyleVersion extends ImageStyleVersionBase {
  readonly state: "ABANDONED";
  readonly abandonedAt: UtcTimestamp;
}

export type ImageStyleVersion =
  | ImageStyleDraftVersion
  | PublishedImageStyleVersion
  | AbandonedImageStyleVersion;

export type ImageStyleReferenceRightsBasis =
  | "OWNED"
  | "LICENSED"
  | "PUBLIC_DOMAIN"
  | "OTHER_DOCUMENTED_BASIS";

export type ImageStyleOriginalRetentionPolicy = "RETAIN" | "DELETE_AFTER_ANALYSIS";
export type ImageStyleReferenceRetentionState = "RETAIN" | "DELETE_REQUESTED" | "DELETED";

export interface ImageStyleReference {
  readonly referenceId: EntityId;
  readonly workspaceId: EntityId;
  readonly styleId: EntityId;
  readonly versionId: EntityId;
  readonly originalAssetId: EntityId;
  readonly normalizedAssetId: EntityId;
  readonly referenceOrder: number;
  readonly rightsBasis: ImageStyleReferenceRightsBasis;
  readonly rightsBasisNote: string | null;
  readonly rightsAttestedByUserId: EntityId;
  readonly rightsAttestedAt: UtcTimestamp;
  readonly originalRetentionPolicy: ImageStyleOriginalRetentionPolicy;
  readonly confidence: number | null;
  readonly isOutlier: boolean;
  readonly retentionState: ImageStyleReferenceRetentionState;
  readonly createdAt: UtcTimestamp;
  readonly deletedAt: UtcTimestamp | null;
}

export interface ImageStyleAnalysisReferenceBinding {
  readonly referenceId: EntityId;
  readonly normalizedAssetId: EntityId;
  readonly alias: string;
  readonly derivativeSha256: Sha256;
  readonly mimeType: "image/jpeg" | "image/png" | "image/webp";
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
}

export interface ImageStyleReferenceLookup {
  readonly styleId: EntityId;
  readonly versionId: EntityId;
  readonly referenceId: EntityId;
}

export interface ImageStyleVersionReferenceLookup {
  readonly styleId: EntityId;
  readonly versionId: EntityId;
}

export interface AttachImageStyleReferenceCommand extends IdempotentMutation {
  readonly referenceId: EntityId;
  readonly styleId: EntityId;
  readonly versionId: EntityId;
  readonly originalAssetId: EntityId;
  readonly normalizedAssetId: EntityId;
  readonly referenceOrder: number;
  readonly rightsBasis: ImageStyleReferenceRightsBasis;
  readonly rightsBasisNote: string | null;
  readonly rightsAttestedAt: UtcTimestamp;
  readonly originalRetentionPolicy: ImageStyleOriginalRetentionPolicy;
}

export interface DetachImageStyleReferenceCommand extends IdempotentMutation {
  readonly styleId: EntityId;
  readonly versionId: EntityId;
  readonly referenceId: EntityId;
}

export interface CreateImageStyleCommand extends IdempotentMutation {
  readonly styleId: EntityId;
  readonly name: string;
  readonly normalizedName: string;
}

export interface CreateImageStyleDraftCommand extends IdempotentMutation {
  readonly styleId: EntityId;
  readonly versionId: EntityId;
  readonly versionNumber: number;
}

export interface SaveImageStyleDraftCommand extends IdempotentMutation {
  readonly styleId: EntityId;
  readonly versionId: EntityId;
  readonly expectedUpdatedAt: UtcTimestamp;
  readonly nextState: ImageStyleDraftState;
  readonly profileDocument: CanonicalDocument | null;
  readonly analyzerRequestHash: Sha256 | null;
  readonly analyzerModelSnapshot: string | null;
  readonly disclosureAttestedByUserId: EntityId | null;
}

export interface PublishImageStyleVersionCommand extends IdempotentMutation {
  readonly styleId: EntityId;
  readonly versionId: EntityId;
  readonly expectedUpdatedAt: UtcTimestamp;
  readonly profileDocument: CanonicalDocument;
  readonly analyzerRequestHash: Sha256 | null;
  readonly analyzerModelSnapshot: string | null;
  readonly disclosureAttestedByUserId: EntityId;
  readonly publishedAt: UtcTimestamp;
}

export interface BeginImageStyleAnalysisCommand extends IdempotentMutation {
  readonly styleId: EntityId;
  readonly versionId: EntityId;
  readonly analysisAttemptId: EntityId;
  readonly requestHash: Sha256;
  readonly provider: string;
  readonly model: string;
  readonly modelRevision: string;
  /**
   * The embedded reservation supplies task, execution attempt, budget event, and DISPATCH outbox.
   * Its owner must be this exact IMAGE_STYLE_VERSION; adapters reject any ID mismatch.
   */
  readonly reservation: Omit<ImageStyleVersionTaskAttemptReservationCommand, "idempotencyKey">;
}

export interface ImageStyleAnalysisAttemptBase {
  readonly analysisAttemptId: EntityId;
  readonly workspaceId: EntityId;
  readonly styleVersionId: EntityId;
  /** Required FK to the general attempt created in the same transaction. */
  readonly executionAttemptId: EntityId;
  readonly taskId: EntityId;
  readonly reservationCostEventId: EntityId;
  readonly dispatchOutboxId: EntityId;
  readonly ordinal: number;
  readonly idempotencyKey: DeterministicIdempotencyKey;
  readonly requestHash: Sha256;
  readonly provider: string;
  readonly model: string;
  readonly modelRevision: string;
}

export interface NonUnknownImageStyleAnalysisAttempt extends ImageStyleAnalysisAttemptBase {
  readonly state: "CREATED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  readonly responseHash: Sha256 | null;
  readonly usagePayload: JsonObject | null;
  readonly reportedCostMicroUsd: bigint | null;
}

export interface UnknownImageStyleAnalysisAttempt extends ImageStyleAnalysisAttemptBase {
  readonly state: "UNKNOWN";
  readonly responseHash: null;
  readonly usagePayload: JsonObject | null;
  readonly reportedCostMicroUsd: bigint | null;
}

export interface CreatedImageStyleAnalysisAttempt extends ImageStyleAnalysisAttemptBase {
  readonly state: "CREATED";
  readonly responseHash: null;
  readonly usagePayload: null;
  readonly reportedCostMicroUsd: null;
}

export type ImageStyleAnalysisAttempt =
  | NonUnknownImageStyleAnalysisAttempt
  | UnknownImageStyleAnalysisAttempt;

export interface StartedImageStyleAnalysis {
  readonly kind: "IMAGE_STYLE_ANALYSIS_STARTED";
  readonly version: ImageStyleDraftVersion & { readonly state: "ANALYZING" };
  readonly analysisAttempt: CreatedImageStyleAnalysisAttempt;
  readonly reservation: ImageStyleVersionTaskAttemptReservation;
}

export interface ImageStyleVersionLookup {
  readonly styleId: EntityId;
  readonly versionId: EntityId;
}

export interface ImageStyleAnalysisAttemptLookup extends ImageStyleVersionLookup {
  readonly analysisAttemptId: EntityId;
}

export interface ListImageStylesQuery {
  readonly includeArchived: boolean;
}

export interface ExactImageStyleVersionLookup {
  readonly styleId: EntityId;
  readonly versionId: EntityId;
  readonly use: ExactVersionUse;
}

export interface ArchiveImageStyleCommand extends IdempotentMutation {
  readonly styleId: EntityId;
  readonly expectedUpdatedAt: UtcTimestamp;
  readonly archivedAt: UtcTimestamp;
}

export interface AbandonImageStyleVersionCommand extends IdempotentMutation {
  readonly styleId: EntityId;
  readonly versionId: EntityId;
  readonly expectedUpdatedAt: UtcTimestamp;
  readonly abandonedAt: UtcTimestamp;
}

export type ImageStyleConflict =
  | CommonConflictCode
  | "IMAGE_STYLE_ANALYSIS_CONFLICT"
  | "IMAGE_STYLE_REFERENCE_CONFLICT"
  | "IMAGE_STYLE_VERSION_CONFLICT"
  | "PUBLISHED_STYLE_HASH_EXISTS";
export type ImageStyleMissing =
  | "ASSET"
  | "EXECUTION_PROFILE"
  | "IMAGE_STYLE"
  | "IMAGE_STYLE_ANALYSIS_ATTEMPT"
  | "IMAGE_STYLE_REFERENCE"
  | "IMAGE_STYLE_VERSION";
export type ImageStyleInvariant =
  | CommonInvariantCode
  | "IMAGE_STYLE_ANALYSIS_BILLING_BOUNDARY_MISMATCH"
  | "IMAGE_STYLE_ARCHIVED"
  | "IMAGE_STYLE_DISCLOSURE_REQUIRED"
  | "IMAGE_STYLE_PROFILE_INVALID"
  | "IMAGE_STYLE_REFERENCE_INVALID"
  | "IMAGE_STYLE_REFERENCE_LOCKED"
  | "IMAGE_STYLE_REFERENCE_SET_INVALID"
  | "IMAGE_STYLE_VERSION_NOT_PUBLISHED"
  | "IMAGE_STYLE_VERSION_NOT_PUBLISHABLE";

export interface ImageStyleRepository {
  resolveStyle(
    scope: WorkspaceScope,
    styleId: EntityId,
  ): Promise<
    RepositoryResult<ImageStyle, ImageStyleConflict, ImageStyleMissing, ImageStyleInvariant>
  >;

  resolveVersion(
    scope: WorkspaceScope,
    lookup: ImageStyleVersionLookup,
  ): Promise<
    RepositoryResult<ImageStyleVersion, ImageStyleConflict, ImageStyleMissing, ImageStyleInvariant>
  >;

  resolveAnalysisAttempt(
    scope: WorkspaceScope,
    lookup: ImageStyleAnalysisAttemptLookup,
  ): Promise<
    RepositoryResult<
      ImageStyleAnalysisAttempt,
      ImageStyleConflict,
      ImageStyleMissing,
      ImageStyleInvariant
    >
  >;

  listStyles(
    scope: WorkspaceScope,
    query: ListImageStylesQuery,
  ): Promise<
    RepositoryResult<
      readonly ImageStyle[],
      ImageStyleConflict,
      ImageStyleMissing,
      ImageStyleInvariant
    >
  >;

  listVersions(
    scope: WorkspaceScope,
    styleId: EntityId,
  ): Promise<
    RepositoryResult<
      readonly ImageStyleVersion[],
      ImageStyleConflict,
      ImageStyleMissing,
      ImageStyleInvariant
    >
  >;

  resolveReference(
    scope: WorkspaceScope,
    lookup: ImageStyleReferenceLookup,
  ): Promise<
    RepositoryResult<
      ImageStyleReference,
      ImageStyleConflict,
      ImageStyleMissing,
      ImageStyleInvariant
    >
  >;

  listReferences(
    scope: WorkspaceScope,
    lookup: ImageStyleVersionReferenceLookup,
  ): Promise<
    RepositoryResult<
      readonly ImageStyleReference[],
      ImageStyleConflict,
      ImageStyleMissing,
      ImageStyleInvariant
    >
  >;

  resolveAnalysisReferenceSet(
    scope: WorkspaceScope,
    lookup: ImageStyleVersionReferenceLookup,
  ): Promise<
    RepositoryResult<
      readonly ImageStyleAnalysisReferenceBinding[],
      ImageStyleConflict,
      ImageStyleMissing,
      ImageStyleInvariant
    >
  >;

  createStyle(
    scope: WorkspaceActorScope,
    command: CreateImageStyleCommand,
  ): Promise<
    IdempotentRepositoryResult<
      ImageStyle,
      ImageStyleConflict,
      ImageStyleMissing,
      ImageStyleInvariant
    >
  >;

  createDraftVersion(
    scope: WorkspaceActorScope,
    command: CreateImageStyleDraftCommand,
  ): Promise<
    IdempotentRepositoryResult<
      ImageStyleDraftVersion,
      ImageStyleConflict,
      ImageStyleMissing,
      ImageStyleInvariant
    >
  >;

  attachReference(
    scope: WorkspaceActorScope,
    command: AttachImageStyleReferenceCommand,
  ): Promise<
    IdempotentRepositoryResult<
      ImageStyleReference,
      ImageStyleConflict,
      ImageStyleMissing,
      ImageStyleInvariant
    >
  >;

  detachReference(
    scope: WorkspaceActorScope,
    command: DetachImageStyleReferenceCommand,
  ): Promise<
    IdempotentRepositoryResult<
      ImageStyleReference,
      ImageStyleConflict,
      ImageStyleMissing,
      ImageStyleInvariant
    >
  >;

  saveDraftVersion(
    scope: WorkspaceActorScope,
    command: SaveImageStyleDraftCommand,
  ): Promise<
    IdempotentRepositoryResult<
      ImageStyleDraftVersion,
      ImageStyleConflict,
      ImageStyleMissing,
      ImageStyleInvariant
    >
  >;

  /** Atomically marks the version PUBLISHED and makes it the parent's active version. */
  publishVersion(
    scope: WorkspaceActorScope,
    command: PublishImageStyleVersionCommand,
  ): Promise<
    IdempotentRepositoryResult<
      PublishedImageStyleVersion,
      ImageStyleConflict,
      ImageStyleMissing,
      ImageStyleInvariant
    >
  >;

  beginAnalysis(
    scope: WorkspaceActorScope,
    command: BeginImageStyleAnalysisCommand,
  ): Promise<
    IdempotentRepositoryResult<
      StartedImageStyleAnalysis,
      ImageStyleConflict,
      ImageStyleMissing,
      ImageStyleInvariant
    >
  >;

  abandonVersion(
    scope: WorkspaceActorScope,
    command: AbandonImageStyleVersionCommand,
  ): Promise<
    IdempotentRepositoryResult<
      AbandonedImageStyleVersion,
      ImageStyleConflict,
      ImageStyleMissing,
      ImageStyleInvariant
    >
  >;

  resolveExactPublishedVersion(
    scope: WorkspaceScope,
    lookup: ExactImageStyleVersionLookup,
  ): Promise<
    RepositoryResult<
      PublishedImageStyleVersion,
      ImageStyleConflict,
      ImageStyleMissing,
      ImageStyleInvariant
    >
  >;

  archiveStyle(
    scope: WorkspaceActorScope,
    command: ArchiveImageStyleCommand,
  ): Promise<
    IdempotentRepositoryResult<
      ImageStyle,
      ImageStyleConflict,
      ImageStyleMissing,
      ImageStyleInvariant
    >
  >;
}

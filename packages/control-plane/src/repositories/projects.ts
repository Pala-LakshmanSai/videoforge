import type {
  CanonicalDocument,
  CommonConflictCode,
  CommonInvariantCode,
  EntityId,
  IdempotentMutation,
  IdempotentRepositoryResult,
  RepositoryResult,
  Sha256,
  UtcTimestamp,
  WorkspaceActorScope,
  WorkspaceScope,
} from "./types.js";

export type ProjectStatus = "ACTIVE" | "ARCHIVED";

export interface ProjectShell {
  readonly projectId: EntityId;
  readonly workspaceId: EntityId;
  readonly ownerUserId: EntityId;
  readonly name: string;
  readonly normalizedName: string;
  readonly status: ProjectStatus;
  readonly version: number;
  readonly createdAt: UtcTimestamp;
  readonly updatedAt: UtcTimestamp;
  readonly archivedAt: UtcTimestamp | null;
}

export interface CreateProjectShellCommand extends IdempotentMutation {
  readonly projectId: EntityId;
  readonly name: string;
  readonly normalizedName: string;
}

export interface ArchiveProjectCommand extends IdempotentMutation {
  readonly projectId: EntityId;
  readonly expectedVersion: number;
  readonly archivedAt: UtcTimestamp;
}

export type ProjectInputKind = "VOICEOVER" | "OPTIONAL_SCRIPT";
export type ProjectInputState =
  | "PENDING_UPLOAD"
  | "UPLOADED"
  | "VERIFIED"
  | "REJECTED"
  | "ARCHIVED";

export interface ProjectInput {
  readonly inputId: EntityId;
  readonly workspaceId: EntityId;
  readonly projectId: EntityId;
  readonly kind: ProjectInputKind;
  readonly state: ProjectInputState;
  readonly assetId: EntityId | null;
  readonly declaredBinarySha256: Sha256 | null;
  readonly verifiedBinarySha256: Sha256 | null;
  readonly optionalScript: string | null;
  readonly createdAt: UtcTimestamp;
  readonly updatedAt: UtcTimestamp;
  readonly verifiedAt: UtcTimestamp | null;
  readonly archivedAt: UtcTimestamp | null;
}

export interface VerifiedProjectInput extends ProjectInput {
  readonly state: "VERIFIED";
  readonly assetId: EntityId;
  readonly verifiedBinarySha256: Sha256;
  readonly verifiedAt: UtcTimestamp;
}

export interface RegisterProjectInputCommand extends IdempotentMutation {
  readonly inputId: EntityId;
  readonly projectId: EntityId;
  readonly kind: ProjectInputKind;
  readonly declaredBinarySha256: Sha256 | null;
  readonly optionalScript: string | null;
}

export interface VerifyProjectInputCommand extends IdempotentMutation {
  readonly inputId: EntityId;
  readonly projectId: EntityId;
  readonly assetId: EntityId;
  readonly verifiedBinarySha256: Sha256;
  readonly verifiedAt: UtcTimestamp;
}

export type AvatarCompatibilitySnapshot =
  | {
      readonly state: "UNTESTED" | "RUNNING";
      readonly assessmentId: null;
      readonly evidenceHash: null;
    }
  | {
      readonly state: "PASSED" | "FAILED" | "CANCELLED";
      readonly assessmentId: EntityId;
      readonly evidenceHash: Sha256;
    };

export type GenerationMode = "LOWEST_COST" | "BALANCED" | "FASTER";

/** Exact values copied into a revision before it can become immutable. */
export interface ProjectRevisionSnapshot {
  readonly title: string;
  readonly voiceoverAssetId: EntityId;
  readonly voiceoverBinarySha256: Sha256;
  readonly avatarProfileId: EntityId;
  readonly avatarProfileVersionId: EntityId;
  readonly avatarProfileHash: Sha256;
  readonly avatarRuntimeSourceAssetId: EntityId;
  readonly avatarRuntimeSourceBinarySha256: Sha256;
  readonly avatarSourcePreparationProfile: string;
  readonly avatarSourceValidationProfile: string;
  readonly avatarCompatibility: AvatarCompatibilitySnapshot;
  readonly imageStyleId: EntityId;
  readonly imageStyleVersionId: EntityId;
  readonly styleProfileHash: Sha256;
  readonly extraPromptKeywords: string;
  readonly applyExtraPromptKeywords: boolean;
  readonly generationMode: GenerationMode;
  readonly maximumCostMicroUsd: bigint;
  readonly currency: "USD";
  readonly seed: bigint;
  readonly revisionConfig: CanonicalDocument;
}

export interface ProjectRevisionBase extends ProjectRevisionSnapshot {
  readonly revisionId: EntityId;
  readonly workspaceId: EntityId;
  readonly projectId: EntityId;
  readonly revisionNumber: number;
  readonly createdByUserId: EntityId;
  readonly createdAt: UtcTimestamp;
}

export interface DraftProjectRevision extends ProjectRevisionBase {
  readonly status: "DRAFT";
  readonly lockedAt: null;
}

export interface LockedProjectRevision extends ProjectRevisionBase {
  readonly status: "LOCKED";
  readonly lockedAt: UtcTimestamp;
}

export type ProjectRevision = DraftProjectRevision | LockedProjectRevision;

export interface CreateProjectRevisionDraftCommand
  extends IdempotentMutation,
    ProjectRevisionSnapshot {
  readonly revisionId: EntityId;
  readonly projectId: EntityId;
  readonly revisionNumber: number;
  readonly expectedProjectVersion: number;
}

export interface LockProjectRevisionCommand extends IdempotentMutation {
  readonly projectId: EntityId;
  readonly revisionId: EntityId;
  readonly expectedProjectVersion: number;
  readonly expectedRevisionConfigHash: Sha256;
  readonly lockedAt: UtcTimestamp;
}

export interface ExactProjectRevisionLookup {
  readonly projectId: EntityId;
  readonly revisionId: EntityId;
}

export type ProjectConflict =
  | CommonConflictCode
  | "PROJECT_INPUT_EXISTS"
  | "PROJECT_REVISION_EXISTS"
  | "PROJECT_REVISION_LOCKED";
export type ProjectMissing =
  | "ASSET"
  | "AVATAR_PROFILE_VERSION"
  | "IMAGE_STYLE_VERSION"
  | "PROJECT"
  | "PROJECT_INPUT"
  | "PROJECT_REVISION";
export type ProjectInvariant =
  | CommonInvariantCode
  | "AVATAR_NOT_READY"
  | "IMAGE_STYLE_NOT_PUBLISHED"
  | "INPUT_NOT_VERIFIED"
  | "PROJECT_ARCHIVED"
  | "REVISION_SNAPSHOT_MISMATCH";

export interface ProjectRepository {
  createShell(
    scope: WorkspaceActorScope,
    command: CreateProjectShellCommand,
  ): Promise<
    IdempotentRepositoryResult<ProjectShell, ProjectConflict, ProjectMissing, ProjectInvariant>
  >;

  registerInput(
    scope: WorkspaceActorScope,
    command: RegisterProjectInputCommand,
  ): Promise<
    IdempotentRepositoryResult<ProjectInput, ProjectConflict, ProjectMissing, ProjectInvariant>
  >;

  verifyInput(
    scope: WorkspaceActorScope,
    command: VerifyProjectInputCommand,
  ): Promise<
    IdempotentRepositoryResult<
      VerifiedProjectInput,
      ProjectConflict,
      ProjectMissing,
      ProjectInvariant
    >
  >;

  createRevisionDraft(
    scope: WorkspaceActorScope,
    command: CreateProjectRevisionDraftCommand,
  ): Promise<
    IdempotentRepositoryResult<
      DraftProjectRevision,
      ProjectConflict,
      ProjectMissing,
      ProjectInvariant
    >
  >;

  /** Validates all pinned hashes and atomically crosses the immutable LOCKED boundary. */
  lockRevision(
    scope: WorkspaceActorScope,
    command: LockProjectRevisionCommand,
  ): Promise<
    IdempotentRepositoryResult<
      LockedProjectRevision,
      ProjectConflict,
      ProjectMissing,
      ProjectInvariant
    >
  >;

  resolveExactRevision(
    scope: WorkspaceScope,
    lookup: ExactProjectRevisionLookup,
  ): Promise<RepositoryResult<ProjectRevision, ProjectConflict, ProjectMissing, ProjectInvariant>>;

  archiveProject(
    scope: WorkspaceActorScope,
    command: ArchiveProjectCommand,
  ): Promise<
    IdempotentRepositoryResult<ProjectShell, ProjectConflict, ProjectMissing, ProjectInvariant>
  >;
}

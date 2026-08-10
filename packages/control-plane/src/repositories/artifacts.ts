import type {
  CommonConflictCode,
  CommonInvariantCode,
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

export type ArtifactKind =
  | "VOICEOVER"
  | "OPTIONAL_SCRIPT"
  | "AVATAR_ORIGINAL"
  | "AVATAR_RUNTIME"
  | "AVATAR_THUMBNAIL"
  | "STYLE_REFERENCE_ORIGINAL"
  | "STYLE_REFERENCE_NORMALIZED"
  | "CANONICAL_DOCUMENT"
  | "IMAGE"
  | "AVATAR_CLIP"
  | "AUDIO_SPAN"
  | "RENDER_PREVIEW"
  | "FINAL_VIDEO"
  | "OTHER";

export type ArtifactState = "UPLOADING" | "VERIFIED" | "ACCEPTED" | "REJECTED" | "ARCHIVED";

export interface ArtifactMetadata {
  readonly assetId: EntityId;
  readonly workspaceId: EntityId;
  readonly projectId: EntityId | null;
  readonly projectRevisionId: EntityId | null;
  readonly sourceAttemptId: EntityId | null;
  readonly kind: ArtifactKind;
  readonly state: ArtifactState;
  readonly objectKey: string | null;
  readonly binarySha256: Sha256 | null;
  readonly canonicalContractName: string | null;
  readonly canonicalContractVersion: string | null;
  readonly canonicalDocumentSha256: Sha256 | null;
  readonly contentType: string | null;
  readonly byteSize: bigint | null;
  readonly widthPx: number | null;
  readonly heightPx: number | null;
  readonly durationMs: bigint | null;
  readonly metadata: JsonObject;
  readonly createdAt: UtcTimestamp;
  readonly verifiedAt: UtcTimestamp | null;
  readonly archivedAt: UtcTimestamp | null;
}

export interface RegisterArtifactMetadataCommand extends IdempotentMutation {
  readonly assetId: EntityId;
  readonly projectId: EntityId | null;
  readonly projectRevisionId: EntityId | null;
  readonly sourceAttemptId: EntityId | null;
  readonly kind: ArtifactKind;
  readonly objectKey: string | null;
  readonly contentType: string | null;
  readonly metadata: JsonObject;
}

export interface BindBinaryContentCommand extends IdempotentMutation {
  readonly assetId: EntityId;
  readonly binarySha256: Sha256;
  readonly byteSize: bigint;
  readonly contentType: string;
  readonly widthPx: number | null;
  readonly heightPx: number | null;
  readonly durationMs: bigint | null;
  readonly verifiedAt: UtcTimestamp;
}

export interface BindCanonicalDocumentCommand extends IdempotentMutation {
  readonly assetId: EntityId;
  readonly contractName: string;
  readonly contractVersion: string;
  readonly canonicalDocumentSha256: Sha256;
  readonly binarySha256: Sha256 | null;
  readonly byteSize: bigint;
  readonly verifiedAt: UtcTimestamp;
}

export type ContentAddressLookup =
  | { readonly kind: "BINARY"; readonly sha256: Sha256 }
  | {
      readonly kind: "CANONICAL_DOCUMENT";
      readonly contractName: string;
      readonly contractVersion: string;
      readonly sha256: Sha256;
    };

export interface ArchiveArtifactCommand extends IdempotentMutation {
  readonly assetId: EntityId;
  readonly archivedAt: UtcTimestamp;
}

export type ArtifactConflict = CommonConflictCode | "OBJECT_KEY_TAKEN";
export type ArtifactMissing = "ASSET" | "ATTEMPT" | "PROJECT" | "PROJECT_REVISION";
export type ArtifactInvariant =
  | CommonInvariantCode
  | "ARTIFACT_ALREADY_BOUND"
  | "ARTIFACT_NOT_VERIFIABLE"
  | "INVALID_ARTIFACT_METADATA";

export interface ArtifactRepository {
  registerMetadata(
    scope: WorkspaceActorScope,
    command: RegisterArtifactMetadataCommand,
  ): Promise<
    IdempotentRepositoryResult<
      ArtifactMetadata,
      ArtifactConflict,
      ArtifactMissing,
      ArtifactInvariant
    >
  >;

  bindBinaryContent(
    scope: WorkspaceActorScope,
    command: BindBinaryContentCommand,
  ): Promise<
    IdempotentRepositoryResult<
      ArtifactMetadata,
      ArtifactConflict,
      ArtifactMissing,
      ArtifactInvariant
    >
  >;

  bindCanonicalDocument(
    scope: WorkspaceActorScope,
    command: BindCanonicalDocumentCommand,
  ): Promise<
    IdempotentRepositoryResult<
      ArtifactMetadata,
      ArtifactConflict,
      ArtifactMissing,
      ArtifactInvariant
    >
  >;

  resolveExact(
    scope: WorkspaceScope,
    assetId: EntityId,
  ): Promise<
    RepositoryResult<ArtifactMetadata, ArtifactConflict, ArtifactMissing, ArtifactInvariant>
  >;

  findByContentAddress(
    scope: WorkspaceScope,
    lookup: ContentAddressLookup,
  ): Promise<
    RepositoryResult<
      readonly ArtifactMetadata[],
      ArtifactConflict,
      ArtifactMissing,
      ArtifactInvariant
    >
  >;

  archive(
    scope: WorkspaceActorScope,
    command: ArchiveArtifactCommand,
  ): Promise<
    IdempotentRepositoryResult<
      ArtifactMetadata,
      ArtifactConflict,
      ArtifactMissing,
      ArtifactInvariant
    >
  >;
}

import type { Sha256Digest } from "@videoforge/contracts";

import type { TimelinePlanDocumentRef } from "../documents.js";
import type { PipelineResult } from "../errors.js";

export type AcceptedAssetKind = "AVATAR_CLIP" | "IMAGE" | "VOICEOVER";

/** Accepted immutable media metadata; locations remain adapter-owned. */
export interface AcceptedAssetBinding {
  readonly taskKey: string;
  readonly assetId: string;
  readonly sha256: Sha256Digest;
  readonly kind: AcceptedAssetKind;
  readonly rendererSourceProfile?: string;
}

export interface AcceptedAssetResolutionRequest {
  readonly timeline: TimelinePlanDocumentRef;
  readonly requiredTaskKeys: readonly string[];
  readonly candidates: readonly AcceptedAssetBinding[];
}

export interface AcceptedAssetResolution {
  readonly byTaskKey: Readonly<Record<string, AcceptedAssetBinding>>;
}

/** Pure selected-asset barrier; repositories and artifact stores implement separate adapters. */
export interface AcceptedAssetResolver {
  resolve(request: AcceptedAssetResolutionRequest): PipelineResult<AcceptedAssetResolution>;
}

export type ArtifactOperation = "INITIATE" | "UPLOAD_PART" | "COMPLETE" | "ABORT" | "DOWNLOAD";

export type ArtifactOwnerScope =
  | {
      readonly ownerType: "PROJECT_REVISION";
      readonly workspaceId: string;
      readonly projectId: string;
      readonly projectRevisionId: string;
    }
  | {
      readonly ownerType: "IMAGE_STYLE_VERSION";
      readonly workspaceId: string;
      readonly imageStyleId: string;
      readonly imageStyleVersionId: string;
    }
  | {
      readonly ownerType: "AVATAR_PROFILE_VERSION";
      readonly workspaceId: string;
      readonly avatarProfileId: string;
      readonly avatarProfileVersionId: string;
    };

export type ArtifactRetentionClass =
  | "FAILED_TEMPORARY"
  | "WORKER_INTERMEDIATE"
  | "ACCEPTED_SCENE"
  | "FINAL_RENDER"
  | "RETAIN_WHILE_REFERENCED";

export interface ArtifactRetention {
  readonly retentionClass: ArtifactRetentionClass;
  /** Null is allowed only for RETAIN_WHILE_REFERENCED. */
  readonly retainUntilEpochMs: number | null;
}

export interface CanonicalDocumentAddress {
  readonly contractName: string;
  readonly contractVersion: string;
  readonly canonicalDocumentSha256: Sha256Digest;
}

/** Binary bytes and JCS document identity remain distinct addresses. */
export interface ArtifactIntegrity {
  readonly binarySha256: Sha256Digest;
  readonly byteSize: number;
  readonly contentType: string;
  readonly canonicalDocument: CanonicalDocumentAddress | null;
}

export interface ArtifactUploadIntent {
  readonly idempotencyKey: string;
  readonly assetId: string;
  readonly scope: ArtifactOwnerScope;
  /** Exact private object key, including the workspace/owner prefix and content hash filename. */
  readonly objectKey: string;
  readonly integrity: ArtifactIntegrity;
  readonly retention: ArtifactRetention;
}

export interface SignArtifactInitiateRequest extends ArtifactUploadIntent {
  readonly expiresInMs: number;
}

export interface SignArtifactPartRequest {
  readonly workspaceId: string;
  readonly uploadId: string;
  readonly partNumber: number;
  readonly partSha256: Sha256Digest;
  readonly partBytes: number;
  readonly expiresInMs: number;
}

export interface ArtifactPartReceipt {
  readonly partNumber: number;
  /** Storage-style opaque part identity. It is intentionally distinct from partSha256. */
  readonly etag: string;
  readonly partSha256: Sha256Digest;
  readonly partBytes: number;
  readonly replayed: boolean;
}

export interface SignArtifactCompleteRequest {
  readonly workspaceId: string;
  readonly uploadId: string;
  readonly parts: readonly ArtifactPartReceipt[];
  readonly expiresInMs: number;
}

export interface SignArtifactAbortRequest {
  readonly workspaceId: string;
  readonly uploadId: string;
  readonly expiresInMs: number;
}

export interface SignArtifactDownloadRequest {
  readonly workspaceId: string;
  readonly objectKey: string;
  readonly expiresInMs: number;
}

/** Metadata-only descriptor returned through the application/control-plane boundary. */
export interface SignedArtifactOperation {
  readonly schemaVersion: "signed-artifact-operation/v1";
  readonly operation: ArtifactOperation;
  readonly workspaceId: string;
  readonly objectKey: string;
  readonly uploadId: string | null;
  readonly partNumber: number | null;
  readonly expiresAtEpochMs: number;
  readonly transferUri: string;
  readonly token: string;
  /** Invariant: signed control-plane requests never carry media bytes. */
  readonly applicationBodyBytes: 0;
}

export type ArtifactUploadState = "UPLOADING" | "COMPLETED" | "ABORTED";

export interface ArtifactMultipartUpload {
  readonly uploadId: string;
  readonly workspaceId: string;
  readonly objectKey: string;
  readonly state: ArtifactUploadState;
  readonly replayed: boolean;
}

export interface AcceptedPrivateArtifact {
  readonly assetId: string;
  readonly scope: ArtifactOwnerScope;
  readonly objectKey: string;
  readonly binarySha256: Sha256Digest;
  readonly byteSize: number;
  readonly contentType: string;
  readonly canonicalDocument: CanonicalDocumentAddress | null;
  readonly retention: ArtifactRetention;
  readonly acceptedAtEpochMs: number;
  readonly storageUri: string;
  readonly replayed: boolean;
}

export interface AbortedArtifactUpload {
  readonly uploadId: string;
  readonly workspaceId: string;
  readonly objectKey: string;
  readonly state: "ABORTED";
  readonly replayed: boolean;
}

export interface DirectArtifactDownload {
  readonly artifact: AcceptedPrivateArtifact;
  readonly bytes: Uint8Array;
}

export interface ArtifactTransferAudit {
  readonly applicationBodyBytes: 0;
  readonly directUploadBytes: number;
  readonly directDownloadBytes: number;
  readonly signedOperations: number;
  readonly directOperations: number;
}

/** Application-facing facet. No method accepts or returns media bytes. */
export interface ArtifactControlPlanePort {
  signInitiate(request: SignArtifactInitiateRequest): Promise<SignedArtifactOperation>;
  signPart(request: SignArtifactPartRequest): Promise<SignedArtifactOperation>;
  signComplete(request: SignArtifactCompleteRequest): Promise<SignedArtifactOperation>;
  signAbort(request: SignArtifactAbortRequest): Promise<SignedArtifactOperation>;
  signDownload(request: SignArtifactDownloadRequest): Promise<SignedArtifactOperation>;
  resolveAccepted(workspaceId: string, objectKey: string): Promise<AcceptedPrivateArtifact | null>;
  audit(): ArtifactTransferAudit;
}

/** Browser/storage-facing facet. Only this direct-transfer boundary carries large byte arrays. */
export interface ArtifactDirectTransferPort {
  initiate(operation: SignedArtifactOperation): Promise<ArtifactMultipartUpload>;
  uploadPart(operation: SignedArtifactOperation, bytes: Uint8Array): Promise<ArtifactPartReceipt>;
  complete(operation: SignedArtifactOperation): Promise<AcceptedPrivateArtifact>;
  abort(operation: SignedArtifactOperation): Promise<AbortedArtifactUpload>;
  download(operation: SignedArtifactOperation): Promise<DirectArtifactDownload>;
}

export interface ArtifactStorePort {
  readonly controlPlane: ArtifactControlPlanePort;
  readonly directTransfer: ArtifactDirectTransferPort;
}

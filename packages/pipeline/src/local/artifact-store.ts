import { createHash, randomBytes } from "node:crypto";
import {
  constants,
  link,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
  stat,
  unlink,
} from "node:fs/promises";
import path from "node:path";

import type { Sha256Digest } from "@videoforge/contracts";

import {
  artifactIntentFingerprint,
  assertRetentionActive,
  canonicalCompletionParts,
  canonicalEpochMs,
  canonicalExpiresAt,
  canonicalMaximumSignatureTtl,
  canonicalNow,
  canonicalPart,
  canonicalPlainRecord,
  canonicalReceipt,
  canonicalSafeId,
  canonicalSha256,
  canonicalSigningKey,
  canonicalUploadIntent,
  createOpaquePartEtag,
  digestArtifactBytes,
  extensionForObjectKey,
  LocalArtifactStoreError,
  MAX_ARTIFACT_BYTES,
  MAX_MULTIPART_PARTS,
  signedArtifactOperation,
  verifySignedArtifactOperation,
  workspaceFromObjectKey,
  type ArtifactSigningPayload,
  type CanonicalArtifactCompletedPart,
  type CanonicalArtifactPart,
  type CanonicalArtifactUploadIntent,
} from "../artifacts/private-contract.js";
import { validateArtifactMediaFile } from "../artifacts/media-signature.js";
import type {
  AbortedArtifactUpload,
  AcceptedPrivateArtifact,
  ArtifactControlPlanePort,
  ArtifactDirectTransferPort,
  ArtifactMultipartUpload,
  ArtifactPartReceipt,
  ArtifactStorePort,
  ArtifactTransferAudit,
  DirectArtifactDownload,
  SignArtifactAbortRequest,
  SignArtifactCompleteRequest,
  SignArtifactDownloadRequest,
  SignArtifactInitiateRequest,
  SignArtifactPartRequest,
  SignedArtifactOperation,
} from "../assets/ports.js";

export { LocalArtifactStoreError } from "../artifacts/private-contract.js";
export type { LocalArtifactStoreErrorCode } from "../artifacts/private-contract.js";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const SAFE_EXTENSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,15}$/u;
const SAFE_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$/u;
const SHA256 = /^sha256:([0-9a-f]{64})$/u;

export interface StoredLocalArtifact {
  readonly sha256: Sha256Digest;
  readonly bytes: number;
  readonly extension: string;
  readonly absolutePath: string;
  readonly created: boolean;
}

export interface ReadLocalArtifact extends StoredLocalArtifact {
  readonly content: Uint8Array;
}

export interface LocalRunLocation {
  readonly revisionId: string;
  readonly attemptId: string;
  readonly absolutePath: string;
}

export interface RetainedLocalRun {
  readonly revisionId: string;
  readonly attemptId: string;
}

export interface LocalCleanupCandidate extends LocalRunLocation {
  readonly bytes: number;
  readonly modifiedAtEpochMs: number;
}

export interface LocalCleanupPlan {
  readonly dryRun: true;
  readonly root: string;
  readonly cutoffEpochMs: number;
  readonly candidates: readonly LocalCleanupCandidate[];
  readonly totalBytes: number;
}

export interface LocalCleanupPlanRequest {
  readonly cutoffEpochMs: number;
  readonly retain?: readonly RetainedLocalRun[];
}

export interface LocalArtifactSigningClock {
  nowEpochMs(): number;
}

/** Explicit local-only signing configuration. Omitting it preserves the legacy filesystem slice. */
export interface LocalArtifactSigningOptions {
  readonly signingKey: Uint8Array;
  readonly clock: LocalArtifactSigningClock;
  readonly maximumSignatureTtlMs?: number;
}

interface LocalArtifactSigningState {
  readonly signingKey: Buffer;
  readonly clock: LocalArtifactSigningClock;
  readonly maximumSignatureTtlMs: number;
}

interface StoredMultipartPart extends CanonicalArtifactPart {
  readonly etag: string;
  readonly absolutePath: string;
}

interface LocalUploadRecord {
  readonly uploadId: string;
  readonly intent: CanonicalArtifactUploadIntent;
  readonly fingerprint: Sha256Digest;
  readonly parts: Map<number, StoredMultipartPart>;
  readonly acceptedParts: Map<number, CanonicalArtifactCompletedPart>;
  readonly mutationTail: { current: Promise<void> };
  stagingDirectory: string | null;
  leaseExpiresAtEpochMs: number;
  state: "UPLOADING" | "COMPLETED" | "ABORTED";
  accepted: StoredPrivateArtifact | null;
  completion: Promise<PrivateAcceptanceResult> | null;
}

interface StoredPrivateArtifact {
  readonly intent: CanonicalArtifactUploadIntent;
  readonly artifact: Omit<AcceptedPrivateArtifact, "replayed">;
  readonly absolutePath: string;
  readonly extension: string;
  readonly fingerprint: Sha256Digest;
  readonly completedParts: readonly CanonicalArtifactCompletedPart[];
}

interface PrivateAcceptanceResult {
  readonly stored: StoredPrivateArtifact;
  readonly created: boolean;
}

interface DurableIdempotencyBinding {
  readonly schemaVersion: "local-private-artifact-idempotency/v1";
  readonly identity: string;
  readonly workspaceId: string;
  readonly idempotencyKey: string;
  readonly intentFingerprint: Sha256Digest;
  readonly uploadId: string;
  readonly objectKey: string;
  readonly acceptedDirectoryIdentity: string;
}

interface MutableArtifactTransferAudit {
  directUploadBytes: number;
  directDownloadBytes: number;
  signedOperations: number;
  directOperations: number;
}

const digestBytes = digestArtifactBytes;
const UPLOAD_IDLE_TTL_MS = 15 * 60 * 1_000;
const ACCEPTED_METADATA_SCHEMA = "local-private-artifact/v1";
const ACCEPTED_METADATA_MAX_BYTES = 128 * 1_024;
const ACCEPTED_DIRECTORY = /^[0-9a-f]{64}$/u;
const ACCEPTED_PREFIX = /^[0-9a-f]{2}$/u;
const IDEMPOTENCY_BINDING_SCHEMA = "local-private-artifact-idempotency/v1";
const IDEMPOTENCY_BINDING_MAX_BYTES = 8 * 1_024;
const IDEMPOTENCY_IDENTITY = /^[0-9a-f]{64}$/u;
const IDEMPOTENCY_LOCK_POLL_MS = 10;
const IDEMPOTENCY_LOCK_MAX_POLLS = (15 * 60 * 1_000) / IDEMPOTENCY_LOCK_POLL_MS;

const errorCode = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;

function assertContained(root: string, candidate: string): void {
  const relative = path.relative(root, candidate);
  if (
    relative === "" ||
    (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
  ) {
    return;
  }
  throw new LocalArtifactStoreError(
    "PATH_ESCAPE",
    "The requested artifact path escapes the configured local artifact root.",
    candidate,
  );
}

function safeId(value: string, label: string): string {
  if (!SAFE_ID.test(value)) {
    throw new LocalArtifactStoreError(
      "INVALID_ID",
      `${label} must be a non-empty filesystem-safe VideoForge identifier.`,
      value,
    );
  }
  return value;
}

function safeExtension(value: string): string {
  const normalized = value.startsWith(".") ? value.slice(1) : value;
  if (!SAFE_EXTENSION.test(normalized)) {
    throw new LocalArtifactStoreError(
      "INVALID_EXTENSION",
      "Artifact extensions must contain only letters, numbers, dot, underscore, or hyphen.",
      value,
    );
  }
  return normalized.toLowerCase();
}

function safeFilename(value: string): string {
  if (!SAFE_FILENAME.test(value) || value === "." || value === "..") {
    throw new LocalArtifactStoreError(
      "INVALID_FILENAME",
      "Run filenames must be one filesystem-safe basename without traversal or separators.",
      value,
    );
  }
  return value;
}

function digestHex(value: Sha256Digest): string {
  const match = SHA256.exec(value);
  if (!match?.[1]) {
    throw new LocalArtifactStoreError(
      "CONTENT_HASH_MISMATCH",
      "Artifact digests must use the sha256:<64 lowercase hex characters> format.",
      value,
    );
  }
  return match[1];
}

function requestRecord(value: unknown, label: string): Record<string, unknown> {
  return canonicalPlainRecord(value, label);
}

function exactRequestKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort((left, right) => left.localeCompare(right, "en"));
  const canonical = [...expected].sort((left, right) => left.localeCompare(right, "en"));
  if (
    actual.length !== canonical.length ||
    canonical.some((expectedKey, index) => expectedKey !== actual[index])
  ) {
    throw new LocalArtifactStoreError(
      "REQUEST_INVALID",
      `${label} must contain exactly: ${canonical.join(", ")}.`,
    );
  }
}

function normalizeSigningOptions(
  value: LocalArtifactSigningOptions | undefined,
): LocalArtifactSigningState | null {
  if (value === undefined) return null;
  const candidate = requestRecord(value, "local artifact signing options");
  exactRequestKeys(
    candidate,
    candidate.maximumSignatureTtlMs === undefined
      ? ["signingKey", "clock"]
      : ["signingKey", "clock", "maximumSignatureTtlMs"],
    "local artifact signing options",
  );
  const clockCandidate = requestRecord(candidate.clock, "local artifact signing clock");
  const readNow = clockCandidate.nowEpochMs;
  if (typeof readNow !== "function") {
    throw new LocalArtifactStoreError(
      "SIGNING_CONFIGURATION_INVALID",
      "Local artifact signing clock must provide nowEpochMs().",
    );
  }
  const clock: LocalArtifactSigningClock = Object.freeze({ nowEpochMs: () => readNow() });
  return Object.freeze({
    signingKey: canonicalSigningKey(candidate.signingKey),
    clock,
    maximumSignatureTtlMs: canonicalMaximumSignatureTtl(candidate.maximumSignatureTtlMs),
  });
}

function acceptedArtifact(
  stored: StoredPrivateArtifact,
  replayed: boolean,
): AcceptedPrivateArtifact {
  return Object.freeze({ ...stored.artifact, replayed });
}

function uploadResponse(record: LocalUploadRecord, replayed: boolean): ArtifactMultipartUpload {
  return Object.freeze({
    uploadId: record.uploadId,
    workspaceId: record.intent.scope.workspaceId,
    objectKey: record.intent.objectKey,
    state: record.state,
    replayed,
  });
}

function abortedResponse(record: LocalUploadRecord, replayed: boolean): AbortedArtifactUpload {
  return Object.freeze({
    uploadId: record.uploadId,
    workspaceId: record.intent.scope.workspaceId,
    objectKey: record.intent.objectKey,
    state: "ABORTED",
    replayed,
  });
}

function uploadIdFor(intent: CanonicalArtifactUploadIntent): string {
  const fingerprint = artifactIntentFingerprint(intent);
  return `upload_${createHash("sha256").update(fingerprint).digest("hex").slice(0, 40)}`;
}

/**
 * Safe local development artifact storage. It has no cleanup mutation API; callers may only
 * request a dry-run cleanup plan and perform any later deletion through a separately reviewed
 * integration boundary.
 */
export class LocalArtifactStore implements ArtifactStorePort {
  readonly root: string;
  readonly controlPlane: ArtifactControlPlanePort;
  readonly directTransfer: ArtifactDirectTransferPort;

  private readonly signing: LocalArtifactSigningState | null;
  private readonly uploads = new Map<string, LocalUploadRecord>();
  private readonly idempotency = new Map<string, { fingerprint: Sha256Digest; uploadId: string }>();
  private readonly privateArtifacts = new Map<string, StoredPrivateArtifact>();
  private readonly transferAudit: MutableArtifactTransferAudit = {
    directUploadBytes: 0,
    directDownloadBytes: 0,
    signedOperations: 0,
    directOperations: 0,
  };

  private constructor(root: string, signing: LocalArtifactSigningState | null) {
    this.root = root;
    this.signing = signing;
    this.controlPlane = Object.freeze({
      signInitiate: (request: SignArtifactInitiateRequest) => this.signInitiate(request),
      signPart: (request: SignArtifactPartRequest) => this.signPart(request),
      signComplete: (request: SignArtifactCompleteRequest) => this.signComplete(request),
      signAbort: (request: SignArtifactAbortRequest) => this.signAbort(request),
      signDownload: (request: SignArtifactDownloadRequest) => this.signDownload(request),
      resolveAccepted: (workspaceId: string, objectKey: string) =>
        this.resolveAcceptedArtifact(workspaceId, objectKey),
      audit: () => this.artifactTransferAudit(),
    });
    this.directTransfer = Object.freeze({
      initiate: (operation: SignedArtifactOperation) => this.initiateDirectUpload(operation),
      uploadPart: (operation: SignedArtifactOperation, bytes: Uint8Array) =>
        this.uploadDirectPart(operation, bytes),
      complete: (operation: SignedArtifactOperation) => this.completeDirectUpload(operation),
      abort: (operation: SignedArtifactOperation) => this.abortDirectUpload(operation),
      download: (operation: SignedArtifactOperation) => this.downloadDirectArtifact(operation),
    });
  }

  static async create(
    root: string,
    signingOptions?: LocalArtifactSigningOptions,
  ): Promise<LocalArtifactStore> {
    if (!root || !path.isAbsolute(root)) {
      throw new LocalArtifactStoreError(
        "INVALID_ROOT",
        "The local artifact root must be an explicit absolute path.",
        root,
      );
    }

    const lexicalRoot = path.resolve(root);
    if (lexicalRoot === path.parse(lexicalRoot).root) {
      throw new LocalArtifactStoreError(
        "INVALID_ROOT",
        "The filesystem root cannot be used as the local artifact root.",
        lexicalRoot,
      );
    }

    await mkdir(lexicalRoot, { recursive: true, mode: 0o700 });
    const rootInformation = await lstat(lexicalRoot);
    if (rootInformation.isSymbolicLink()) {
      throw new LocalArtifactStoreError(
        "SYMLINK_ESCAPE",
        "The local artifact root itself may not be a symbolic link.",
        lexicalRoot,
      );
    }
    if (!rootInformation.isDirectory()) {
      throw new LocalArtifactStoreError(
        "INVALID_ROOT",
        "The local artifact root must resolve to a directory.",
        lexicalRoot,
      );
    }

    const canonicalRoot = await realpath(lexicalRoot);
    if (canonicalRoot === path.parse(canonicalRoot).root) {
      throw new LocalArtifactStoreError(
        "INVALID_ROOT",
        "The canonical filesystem root cannot be used as the local artifact root.",
        canonicalRoot,
      );
    }
    const store = new LocalArtifactStore(canonicalRoot, normalizeSigningOptions(signingOptions));
    await store.ensureDirectory(["objects", "sha256"]);
    await store.ensureDirectory(["runs"]);
    await store.ensureDirectory(["private", "accepted"]);
    await store.ensureDirectory(["private", "idempotency"]);
    await store.ensureDirectory(["private", "idempotency-locks"]);
    await store.ensureDirectory(["private", "staging"]);
    await store.loadAcceptedArtifacts();
    return store;
  }

  private requireSigning(): LocalArtifactSigningState {
    if (this.signing === null) {
      throw new LocalArtifactStoreError(
        "SIGNING_NOT_CONFIGURED",
        "Private artifact operations require explicit local signing configuration.",
      );
    }
    return this.signing;
  }

  private signingNow(signing = this.requireSigning()): number {
    return canonicalNow(signing.clock.nowEpochMs());
  }

  private issueSignedOperation(payload: ArtifactSigningPayload): SignedArtifactOperation {
    const signing = this.requireSigning();
    const operation = signedArtifactOperation(payload, signing.signingKey);
    this.transferAudit.signedOperations += 1;
    return operation;
  }

  private verifyDirectOperation(
    operation: SignedArtifactOperation,
    expectedOperation: ArtifactSigningPayload["operation"],
  ): { readonly payload: ArtifactSigningPayload; readonly nowEpochMs: number } {
    const signing = this.requireSigning();
    const nowEpochMs = this.signingNow(signing);
    const payload = verifySignedArtifactOperation(
      operation,
      expectedOperation,
      signing.signingKey,
      nowEpochMs,
      signing.maximumSignatureTtlMs,
    );
    this.transferAudit.directOperations += 1;
    return Object.freeze({ payload, nowEpochMs });
  }

  private transferUri(
    operation: ArtifactSigningPayload["operation"],
    objectKey: string,
    uploadId: string | null,
    partNumber: number | null,
  ): string {
    const target = uploadId ?? createHash("sha256").update(objectKey).digest("hex").slice(0, 40);
    const suffix = partNumber === null ? "" : `/part/${partNumber}`;
    return `vf-local-r2://signed/${operation.toLowerCase()}/${target}${suffix}`;
  }

  private async cleanupUploadStaging(record: LocalUploadRecord): Promise<void> {
    const stagingDirectory = record.stagingDirectory;
    if (stagingDirectory === null) return;
    assertContained(this.root, stagingDirectory);
    await rm(stagingDirectory, { recursive: true, force: true });
    record.stagingDirectory = null;
    record.parts.clear();
  }

  private async requireUpload(
    uploadId: string,
    workspaceId: string,
    nowEpochMs?: number,
  ): Promise<LocalUploadRecord> {
    const record = this.uploads.get(uploadId);
    if (record === undefined || record.intent.scope.workspaceId !== workspaceId) {
      throw new LocalArtifactStoreError(
        "UPLOAD_NOT_FOUND",
        "The multipart upload does not exist in the authorized workspace.",
      );
    }
    if (
      nowEpochMs !== undefined &&
      record.state === "UPLOADING" &&
      record.leaseExpiresAtEpochMs <= nowEpochMs
    ) {
      await this.withUploadMutation(record, async () => {
        if (record.state === "UPLOADING" && record.leaseExpiresAtEpochMs <= nowEpochMs) {
          record.state = "ABORTED";
          await this.cleanupUploadStaging(record);
        }
      });
    }
    return record;
  }

  private async withUploadMutation<T>(
    record: LocalUploadRecord,
    operation: () => Promise<T>,
  ): Promise<T> {
    const predecessor = record.mutationTail.current;
    let release = (): void => undefined;
    record.mutationTail.current = new Promise<void>((resolve) => {
      release = resolve;
    });
    await predecessor;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private renewUploadLease(record: LocalUploadRecord, nowEpochMs: number): void {
    const expiresAtEpochMs = nowEpochMs + UPLOAD_IDLE_TTL_MS;
    if (!Number.isSafeInteger(expiresAtEpochMs)) {
      throw new LocalArtifactStoreError(
        "REQUEST_INVALID",
        "Multipart upload lease exceeds safe timestamp range.",
      );
    }
    record.leaseExpiresAtEpochMs = expiresAtEpochMs;
  }

  private async signInitiate(
    request: SignArtifactInitiateRequest,
  ): Promise<SignedArtifactOperation> {
    const signing = this.requireSigning();
    const nowEpochMs = this.signingNow(signing);
    const canonical = canonicalUploadIntent(request, nowEpochMs, true);
    const expiresAtEpochMs = canonicalExpiresAt(
      nowEpochMs,
      canonical.expiresInMs,
      signing.maximumSignatureTtlMs,
    );
    const intent: CanonicalArtifactUploadIntent = Object.freeze({
      idempotencyKey: canonical.idempotencyKey,
      assetId: canonical.assetId,
      scope: canonical.scope,
      objectKey: canonical.objectKey,
      integrity: canonical.integrity,
      retention: canonical.retention,
    });
    const uploadId = uploadIdFor(intent);
    const transferUri = this.transferUri("INITIATE", intent.objectKey, uploadId, null);
    return this.issueSignedOperation(
      Object.freeze({
        schemaVersion: "artifact-signing-payload/v1",
        operation: "INITIATE",
        workspaceId: intent.scope.workspaceId,
        objectKey: intent.objectKey,
        uploadId,
        partNumber: null,
        issuedAtEpochMs: nowEpochMs,
        expiresAtEpochMs,
        transferUri,
        detail: Object.freeze({ kind: "INITIATE", intent }),
      }),
    );
  }

  private async signPart(request: SignArtifactPartRequest): Promise<SignedArtifactOperation> {
    const signing = this.requireSigning();
    const candidate = requestRecord(request, "sign part request");
    exactRequestKeys(
      candidate,
      ["workspaceId", "uploadId", "partNumber", "partSha256", "partBytes", "expiresInMs"],
      "sign part request",
    );
    const workspaceId = canonicalSafeId(candidate.workspaceId, "workspaceId");
    const uploadId = canonicalSafeId(candidate.uploadId, "uploadId");
    const part = canonicalPart({
      partNumber: candidate.partNumber,
      partSha256: candidate.partSha256,
      partBytes: candidate.partBytes,
    });
    const nowEpochMs = this.signingNow(signing);
    const upload = await this.requireUpload(uploadId, workspaceId, nowEpochMs);
    if (upload.state !== "UPLOADING") {
      throw new LocalArtifactStoreError(
        "UPLOAD_STATE_CONFLICT",
        "Parts may be signed only while an upload is active.",
      );
    }
    const expiresAtEpochMs = canonicalExpiresAt(
      nowEpochMs,
      candidate.expiresInMs,
      signing.maximumSignatureTtlMs,
    );
    const transferUri = this.transferUri(
      "UPLOAD_PART",
      upload.intent.objectKey,
      uploadId,
      part.partNumber,
    );
    return this.issueSignedOperation(
      Object.freeze({
        schemaVersion: "artifact-signing-payload/v1",
        operation: "UPLOAD_PART",
        workspaceId,
        objectKey: upload.intent.objectKey,
        uploadId,
        partNumber: part.partNumber,
        issuedAtEpochMs: nowEpochMs,
        expiresAtEpochMs,
        transferUri,
        detail: Object.freeze({
          kind: "UPLOAD_PART",
          partSha256: part.partSha256,
          partBytes: part.partBytes,
        }),
      }),
    );
  }

  private async signComplete(
    request: SignArtifactCompleteRequest,
  ): Promise<SignedArtifactOperation> {
    const signing = this.requireSigning();
    const candidate = requestRecord(request, "sign complete request");
    exactRequestKeys(
      candidate,
      ["workspaceId", "uploadId", "parts", "expiresInMs"],
      "sign complete request",
    );
    const workspaceId = canonicalSafeId(candidate.workspaceId, "workspaceId");
    const uploadId = canonicalSafeId(candidate.uploadId, "uploadId");
    const nowEpochMs = this.signingNow(signing);
    const upload = await this.requireUpload(uploadId, workspaceId, nowEpochMs);
    if (upload.state === "ABORTED") {
      throw new LocalArtifactStoreError(
        "UPLOAD_STATE_CONFLICT",
        "An aborted multipart upload cannot be completed.",
      );
    }
    const parts = canonicalCompletionParts(candidate.parts);
    this.assertCompletePartSet(upload, parts);
    assertRetentionActive(upload.intent.retention, nowEpochMs);
    const expiresAtEpochMs = canonicalExpiresAt(
      nowEpochMs,
      candidate.expiresInMs,
      signing.maximumSignatureTtlMs,
    );
    const transferUri = this.transferUri("COMPLETE", upload.intent.objectKey, uploadId, null);
    return this.issueSignedOperation(
      Object.freeze({
        schemaVersion: "artifact-signing-payload/v1",
        operation: "COMPLETE",
        workspaceId,
        objectKey: upload.intent.objectKey,
        uploadId,
        partNumber: null,
        issuedAtEpochMs: nowEpochMs,
        expiresAtEpochMs,
        transferUri,
        detail: Object.freeze({ kind: "COMPLETE", parts }),
      }),
    );
  }

  private async signAbort(request: SignArtifactAbortRequest): Promise<SignedArtifactOperation> {
    const signing = this.requireSigning();
    const candidate = requestRecord(request, "sign abort request");
    exactRequestKeys(candidate, ["workspaceId", "uploadId", "expiresInMs"], "sign abort request");
    const workspaceId = canonicalSafeId(candidate.workspaceId, "workspaceId");
    const uploadId = canonicalSafeId(candidate.uploadId, "uploadId");
    const nowEpochMs = this.signingNow(signing);
    const upload = await this.requireUpload(uploadId, workspaceId, nowEpochMs);
    if (upload.state === "COMPLETED") {
      throw new LocalArtifactStoreError(
        "UPLOAD_STATE_CONFLICT",
        "A completed immutable artifact cannot be aborted.",
      );
    }
    const expiresAtEpochMs = canonicalExpiresAt(
      nowEpochMs,
      candidate.expiresInMs,
      signing.maximumSignatureTtlMs,
    );
    const transferUri = this.transferUri("ABORT", upload.intent.objectKey, uploadId, null);
    return this.issueSignedOperation(
      Object.freeze({
        schemaVersion: "artifact-signing-payload/v1",
        operation: "ABORT",
        workspaceId,
        objectKey: upload.intent.objectKey,
        uploadId,
        partNumber: null,
        issuedAtEpochMs: nowEpochMs,
        expiresAtEpochMs,
        transferUri,
        detail: Object.freeze({ kind: "ABORT" }),
      }),
    );
  }

  private async signDownload(
    request: SignArtifactDownloadRequest,
  ): Promise<SignedArtifactOperation> {
    const signing = this.requireSigning();
    const candidate = requestRecord(request, "sign download request");
    exactRequestKeys(
      candidate,
      ["workspaceId", "objectKey", "expiresInMs"],
      "sign download request",
    );
    const workspaceId = canonicalSafeId(candidate.workspaceId, "workspaceId");
    if (typeof candidate.objectKey !== "string") {
      throw new LocalArtifactStoreError("REQUEST_INVALID", "objectKey must be a string.");
    }
    const objectKey = candidate.objectKey;
    if (workspaceFromObjectKey(objectKey) !== workspaceId) {
      throw new LocalArtifactStoreError(
        "SCOPE_MISMATCH",
        "Artifact download path does not belong to the authorized workspace.",
      );
    }
    const storedArtifact = this.privateArtifacts.get(objectKey);
    if (storedArtifact === undefined) {
      throw new LocalArtifactStoreError(
        "NOT_FOUND",
        "The requested accepted private artifact does not exist.",
      );
    }
    const nowEpochMs = this.signingNow(signing);
    assertRetentionActive(storedArtifact.artifact.retention, nowEpochMs);
    const expiresAtEpochMs = canonicalExpiresAt(
      nowEpochMs,
      candidate.expiresInMs,
      signing.maximumSignatureTtlMs,
    );
    const transferUri = this.transferUri("DOWNLOAD", objectKey, null, null);
    return this.issueSignedOperation(
      Object.freeze({
        schemaVersion: "artifact-signing-payload/v1",
        operation: "DOWNLOAD",
        workspaceId,
        objectKey,
        uploadId: null,
        partNumber: null,
        issuedAtEpochMs: nowEpochMs,
        expiresAtEpochMs,
        transferUri,
        detail: Object.freeze({ kind: "DOWNLOAD" }),
      }),
    );
  }

  private async resolveAcceptedArtifact(
    workspaceIdValue: string,
    objectKeyValue: string,
  ): Promise<AcceptedPrivateArtifact | null> {
    const workspaceId = canonicalSafeId(workspaceIdValue, "workspaceId");
    if (typeof objectKeyValue !== "string") return null;
    const objectKey = objectKeyValue;
    if (workspaceFromObjectKey(objectKey) !== workspaceId) return null;
    const stored = this.privateArtifacts.get(objectKey);
    if (stored === undefined) return null;
    try {
      assertRetentionActive(stored.artifact.retention, this.signingNow());
    } catch (error) {
      if (error instanceof LocalArtifactStoreError && error.code === "RETENTION_INVALID") {
        return null;
      }
      throw error;
    }
    return acceptedArtifact(stored, false);
  }

  private artifactTransferAudit(): ArtifactTransferAudit {
    return Object.freeze({
      applicationBodyBytes: 0,
      directUploadBytes: this.transferAudit.directUploadBytes,
      directDownloadBytes: this.transferAudit.directDownloadBytes,
      signedOperations: this.transferAudit.signedOperations,
      directOperations: this.transferAudit.directOperations,
    });
  }

  private async initiateDirectUpload(
    operation: SignedArtifactOperation,
  ): Promise<ArtifactMultipartUpload> {
    const { payload, nowEpochMs } = this.verifyDirectOperation(operation, "INITIATE");
    if (payload.detail.kind !== "INITIATE" || payload.uploadId === null) {
      throw new LocalArtifactStoreError("SIGNATURE_INVALID", "Initiate token detail is invalid.");
    }
    const intent = payload.detail.intent;
    const expectedUploadId = uploadIdFor(intent);
    if (payload.uploadId !== expectedUploadId) {
      throw new LocalArtifactStoreError(
        "SIGNATURE_INVALID",
        "Initiate token upload identity is inconsistent.",
      );
    }
    const fingerprint = artifactIntentFingerprint(intent);
    const idempotencyIdentity = `${intent.scope.workspaceId}\u0000${intent.idempotencyKey}`;
    const expectedDurableBinding = this.expectedIdempotencyBinding(intent);
    const durableBinding = await this.readIdempotencyBinding(
      intent.scope.workspaceId,
      intent.idempotencyKey,
    );
    if (durableBinding !== null) {
      this.assertExpectedIdempotencyBinding(durableBinding, expectedDurableBinding);
      const location = await this.acceptedArtifactLocation(intent.objectKey);
      const stored = await this.readAcceptedArtifactDirectory(
        location.destination,
        location.identity,
      );
      if (stored.fingerprint !== fingerprint) {
        throw new LocalArtifactStoreError(
          "IDEMPOTENCY_CONFLICT",
          "The durable artifact idempotency binding does not match accepted metadata.",
        );
      }
      const acceptedRecord: LocalUploadRecord = {
        uploadId: expectedUploadId,
        intent,
        fingerprint,
        parts: new Map(),
        acceptedParts: new Map(stored.completedParts.map((part) => [part.partNumber, part])),
        mutationTail: { current: Promise.resolve() },
        stagingDirectory: null,
        leaseExpiresAtEpochMs: nowEpochMs,
        state: "COMPLETED",
        accepted: stored,
        completion: null,
      };
      this.privateArtifacts.set(intent.objectKey, stored);
      this.uploads.set(expectedUploadId, acceptedRecord);
      this.idempotency.set(idempotencyIdentity, { fingerprint, uploadId: expectedUploadId });
      return uploadResponse(acceptedRecord, true);
    }
    const existingIdentity = this.idempotency.get(idempotencyIdentity);
    if (existingIdentity !== undefined) {
      if (
        existingIdentity.fingerprint !== fingerprint ||
        existingIdentity.uploadId !== expectedUploadId
      ) {
        throw new LocalArtifactStoreError(
          "IDEMPOTENCY_CONFLICT",
          "The artifact idempotency key is already bound to different immutable metadata.",
        );
      }
      const existing = await this.requireUpload(
        existingIdentity.uploadId,
        intent.scope.workspaceId,
        nowEpochMs,
      );
      return uploadResponse(existing, true);
    }

    const existingUpload = this.uploads.get(expectedUploadId);
    if (existingUpload !== undefined) {
      if (existingUpload.fingerprint !== fingerprint) {
        throw new LocalArtifactStoreError(
          "IDEMPOTENCY_CONFLICT",
          "The deterministic upload identity is already bound to different metadata.",
        );
      }
      await this.requireUpload(expectedUploadId, intent.scope.workspaceId, nowEpochMs);
      this.idempotency.set(idempotencyIdentity, { fingerprint, uploadId: expectedUploadId });
      return uploadResponse(existingUpload, true);
    }

    const accepted = this.privateArtifacts.get(intent.objectKey);
    if (accepted !== undefined) {
      if (accepted.fingerprint !== fingerprint) {
        throw new LocalArtifactStoreError(
          "IMMUTABLE_COLLISION",
          "The immutable objectKey is already accepted with different exact metadata.",
        );
      }
      const acceptedRecord: LocalUploadRecord = {
        uploadId: expectedUploadId,
        intent,
        fingerprint,
        parts: new Map(),
        acceptedParts: new Map(accepted.completedParts.map((part) => [part.partNumber, part])),
        mutationTail: { current: Promise.resolve() },
        stagingDirectory: null,
        leaseExpiresAtEpochMs: nowEpochMs,
        state: "COMPLETED",
        accepted,
        completion: null,
      };
      this.uploads.set(expectedUploadId, acceptedRecord);
      this.idempotency.set(idempotencyIdentity, { fingerprint, uploadId: expectedUploadId });
      return uploadResponse(acceptedRecord, true);
    }

    const stagingRoot = await this.ensureDirectory(["private", "staging"]);
    const stagingDirectory = path.join(
      stagingRoot,
      `.upload-${expectedUploadId}-${randomBytes(12).toString("hex")}`,
    );
    assertContained(this.root, stagingDirectory);
    await mkdir(stagingDirectory, { mode: 0o700 });
    const concurrentUpload = this.uploads.get(expectedUploadId);
    if (concurrentUpload !== undefined) {
      await rm(stagingDirectory, { recursive: true, force: true });
      if (concurrentUpload.fingerprint !== fingerprint) {
        throw new LocalArtifactStoreError(
          "IDEMPOTENCY_CONFLICT",
          "The deterministic upload identity was concurrently bound to different metadata.",
        );
      }
      this.idempotency.set(idempotencyIdentity, { fingerprint, uploadId: expectedUploadId });
      return uploadResponse(concurrentUpload, true);
    }
    const record: LocalUploadRecord = {
      uploadId: expectedUploadId,
      intent,
      fingerprint,
      parts: new Map(),
      acceptedParts: new Map(),
      mutationTail: { current: Promise.resolve() },
      stagingDirectory,
      leaseExpiresAtEpochMs: nowEpochMs,
      state: "UPLOADING",
      accepted: null,
      completion: null,
    };
    try {
      this.renewUploadLease(record, nowEpochMs);
    } catch (error) {
      await rm(stagingDirectory, { recursive: true, force: true });
      throw error;
    }
    this.uploads.set(expectedUploadId, record);
    this.idempotency.set(idempotencyIdentity, { fingerprint, uploadId: expectedUploadId });
    return uploadResponse(record, false);
  }

  private async uploadDirectPart(
    operation: SignedArtifactOperation,
    bytes: Uint8Array,
  ): Promise<ArtifactPartReceipt> {
    const { payload, nowEpochMs } = this.verifyDirectOperation(operation, "UPLOAD_PART");
    if (
      payload.detail.kind !== "UPLOAD_PART" ||
      payload.uploadId === null ||
      payload.partNumber === null
    ) {
      throw new LocalArtifactStoreError(
        "SIGNATURE_INVALID",
        "Upload-part token detail is invalid.",
      );
    }
    const uploadId = payload.uploadId;
    if (!(bytes instanceof Uint8Array)) {
      throw new LocalArtifactStoreError(
        "REQUEST_INVALID",
        "Direct artifact part content must be a Uint8Array.",
      );
    }
    const stableBytes = Buffer.from(bytes);
    if (stableBytes.byteLength !== payload.detail.partBytes) {
      throw new LocalArtifactStoreError(
        "BYTE_SIZE_MISMATCH",
        "Direct artifact part size does not match its signed metadata.",
      );
    }
    const actualSha256 = digestBytes(stableBytes);
    if (actualSha256 !== payload.detail.partSha256) {
      throw new LocalArtifactStoreError(
        "CONTENT_HASH_MISMATCH",
        "Direct artifact part checksum does not match its signed metadata.",
      );
    }
    const upload = await this.requireUpload(uploadId, payload.workspaceId, nowEpochMs);
    const part: CanonicalArtifactPart = Object.freeze({
      partNumber: payload.partNumber,
      partSha256: payload.detail.partSha256,
      partBytes: payload.detail.partBytes,
    });
    return this.withUploadMutation(upload, async () => {
      if (upload.intent.objectKey !== payload.objectKey || upload.state !== "UPLOADING") {
        throw new LocalArtifactStoreError(
          "UPLOAD_STATE_CONFLICT",
          "The signed part does not target an active immutable upload.",
        );
      }
      const existing = upload.parts.get(part.partNumber);
      if (existing !== undefined) {
        if (existing.partSha256 !== part.partSha256 || existing.partBytes !== part.partBytes) {
          throw new LocalArtifactStoreError(
            "IMMUTABLE_COLLISION",
            "A multipart part number cannot be overwritten with different bytes.",
          );
        }
        const verified = await this.verifyFileDigest(
          existing.absolutePath,
          existing.partSha256,
          existing.partBytes,
        );
        if (verified === null) {
          throw new LocalArtifactStoreError(
            "MULTIPART_INCOMPLETE",
            "A previously accepted multipart spool file is missing.",
          );
        }
        this.renewUploadLease(upload, nowEpochMs);
        return canonicalReceipt(part, existing.etag, true);
      }
      if (upload.parts.size >= MAX_MULTIPART_PARTS) {
        throw new LocalArtifactStoreError(
          "ARTIFACT_LIMIT_EXCEEDED",
          `Multipart uploads may not exceed ${MAX_MULTIPART_PARTS} parts.`,
        );
      }
      const cumulativeBytes = [...upload.parts.values()].reduce(
        (total, stored) => total + stored.partBytes,
        stableBytes.byteLength,
      );
      if (
        cumulativeBytes > upload.intent.integrity.byteSize ||
        cumulativeBytes > MAX_ARTIFACT_BYTES
      ) {
        throw new LocalArtifactStoreError(
          "ARTIFACT_LIMIT_EXCEEDED",
          "Multipart bytes exceed the signed whole-object byte size.",
        );
      }
      const etag = createOpaquePartEtag(this.requireSigning().signingKey, uploadId, part);
      const stored = await this.spoolMultipartPart(upload, part, etag, stableBytes);
      upload.parts.set(part.partNumber, stored);
      this.renewUploadLease(upload, nowEpochMs);
      this.transferAudit.directUploadBytes += stableBytes.byteLength;
      return canonicalReceipt(part, etag, false);
    });
  }

  private async spoolMultipartPart(
    upload: LocalUploadRecord,
    part: CanonicalArtifactPart,
    etag: string,
    bytes: Buffer,
  ): Promise<StoredMultipartPart> {
    const directory = upload.stagingDirectory;
    if (directory === null) {
      throw new LocalArtifactStoreError(
        "UPLOAD_STATE_CONFLICT",
        "An active multipart upload is missing its private staging directory.",
      );
    }
    const destination = path.join(
      directory,
      `part-${String(part.partNumber).padStart(3, "0")}.bin`,
    );
    const temporary = path.join(
      directory,
      `.part-${part.partNumber}-${randomBytes(12).toString("hex")}.tmp`,
    );
    assertContained(this.root, destination);
    assertContained(this.root, temporary);
    await this.writeDurableFile(temporary, bytes);
    try {
      await link(temporary, destination);
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
      throw new LocalArtifactStoreError(
        "IMMUTABLE_COLLISION",
        "A multipart spool destination already exists outside the active part ledger.",
        destination,
      );
    } finally {
      await unlink(temporary).catch((error: unknown) => {
        if (errorCode(error) !== "ENOENT") throw error;
      });
    }
    const absolutePath = await realpath(destination);
    assertContained(directory, absolutePath);
    return Object.freeze({ ...part, etag, absolutePath });
  }

  private assertCompletePartSet(
    upload: LocalUploadRecord,
    requestedParts: readonly CanonicalArtifactCompletedPart[],
  ): void {
    const storedParts = upload.state === "COMPLETED" ? upload.acceptedParts : upload.parts;
    if (requestedParts.length !== storedParts.size) {
      throw new LocalArtifactStoreError(
        "MULTIPART_INCOMPLETE",
        "Multipart completion must bind every uploaded part exactly once.",
      );
    }
    for (const requested of requestedParts) {
      const stored = storedParts.get(requested.partNumber);
      if (
        stored === undefined ||
        stored.etag !== requested.etag ||
        stored.partSha256 !== requested.partSha256 ||
        stored.partBytes !== requested.partBytes
      ) {
        throw new LocalArtifactStoreError(
          "MULTIPART_INCOMPLETE",
          "Multipart completion receipts do not match the uploaded immutable parts.",
        );
      }
    }
    const totalBytes = requestedParts.reduce((total, part) => total + part.partBytes, 0);
    if (totalBytes !== upload.intent.integrity.byteSize || totalBytes > MAX_ARTIFACT_BYTES) {
      throw new LocalArtifactStoreError(
        "BYTE_SIZE_MISMATCH",
        "Multipart completion part sizes must equal the signed whole-object byte size.",
      );
    }
  }

  private async completeDirectUpload(
    operation: SignedArtifactOperation,
  ): Promise<AcceptedPrivateArtifact> {
    const { payload, nowEpochMs } = this.verifyDirectOperation(operation, "COMPLETE");
    if (payload.detail.kind !== "COMPLETE" || payload.uploadId === null) {
      throw new LocalArtifactStoreError("SIGNATURE_INVALID", "Complete token detail is invalid.");
    }
    const uploadId = payload.uploadId;
    const completedParts = payload.detail.parts;
    const upload = await this.requireUpload(uploadId, payload.workspaceId, nowEpochMs);
    return this.withUploadMutation(upload, async () => {
      if (upload.intent.objectKey !== payload.objectKey) {
        throw new LocalArtifactStoreError(
          "SCOPE_MISMATCH",
          "Complete token does not match the upload objectKey.",
        );
      }
      if (upload.state === "ABORTED") {
        throw new LocalArtifactStoreError(
          "UPLOAD_STATE_CONFLICT",
          "An aborted multipart upload cannot be completed.",
        );
      }
      if (upload.state === "COMPLETED") {
        if (upload.accepted === null) {
          throw new LocalArtifactStoreError(
            "UPLOAD_STATE_CONFLICT",
            "Completed upload is missing accepted artifact metadata.",
          );
        }
        this.assertCompletePartSet(upload, completedParts);
        return acceptedArtifact(upload.accepted, true);
      }
      this.assertCompletePartSet(upload, completedParts);
      assertRetentionActive(upload.intent.retention, nowEpochMs);
      if (upload.completion !== null) {
        return acceptedArtifact((await upload.completion).stored, true);
      }

      upload.completion = this.finishDirectUpload(upload, completedParts, nowEpochMs);
      try {
        const result = await upload.completion;
        const stored = result.stored;
        upload.accepted = stored;
        upload.acceptedParts.clear();
        for (const part of completedParts) upload.acceptedParts.set(part.partNumber, part);
        upload.state = "COMPLETED";
        await this.cleanupUploadStaging(upload);
        return acceptedArtifact(stored, !result.created);
      } catch (error) {
        upload.state = "ABORTED";
        try {
          await this.cleanupUploadStaging(upload);
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            "Multipart completion and private staging cleanup both failed.",
          );
        }
        throw error;
      } finally {
        upload.completion = null;
      }
    });
  }

  private async finishDirectUpload(
    upload: LocalUploadRecord,
    parts: readonly CanonicalArtifactCompletedPart[],
    acceptedAtEpochMs: number,
  ): Promise<PrivateAcceptanceResult> {
    return this.persistAcceptedPrivateArtifact(upload, parts, acceptedAtEpochMs);
  }

  private async abortDirectUpload(
    operation: SignedArtifactOperation,
  ): Promise<AbortedArtifactUpload> {
    const { payload, nowEpochMs } = this.verifyDirectOperation(operation, "ABORT");
    if (payload.detail.kind !== "ABORT" || payload.uploadId === null) {
      throw new LocalArtifactStoreError("SIGNATURE_INVALID", "Abort token detail is invalid.");
    }
    const upload = await this.requireUpload(payload.uploadId, payload.workspaceId, nowEpochMs);
    return this.withUploadMutation(upload, async () => {
      if (upload.intent.objectKey !== payload.objectKey) {
        throw new LocalArtifactStoreError(
          "SCOPE_MISMATCH",
          "Abort token does not match the upload objectKey.",
        );
      }
      if (upload.state === "COMPLETED" || upload.completion !== null) {
        throw new LocalArtifactStoreError(
          "UPLOAD_STATE_CONFLICT",
          "A completed or completing immutable artifact cannot be aborted.",
        );
      }
      if (upload.state === "ABORTED") return abortedResponse(upload, true);
      upload.state = "ABORTED";
      await this.cleanupUploadStaging(upload);
      return abortedResponse(upload, false);
    });
  }

  private async downloadDirectArtifact(
    operation: SignedArtifactOperation,
  ): Promise<DirectArtifactDownload> {
    const { payload, nowEpochMs } = this.verifyDirectOperation(operation, "DOWNLOAD");
    if (payload.detail.kind !== "DOWNLOAD" || payload.uploadId !== null) {
      throw new LocalArtifactStoreError("SIGNATURE_INVALID", "Download token detail is invalid.");
    }
    const stored = this.privateArtifacts.get(payload.objectKey);
    if (stored === undefined || stored.artifact.scope.workspaceId !== payload.workspaceId) {
      throw new LocalArtifactStoreError(
        "NOT_FOUND",
        "The requested accepted private artifact does not exist in this workspace.",
      );
    }
    assertRetentionActive(stored.artifact.retention, nowEpochMs);
    const verified = await this.readIfPresent(
      stored.absolutePath,
      stored.artifact.binarySha256,
      stored.extension,
    );
    if (verified === null || verified.bytes !== stored.artifact.byteSize) {
      throw new LocalArtifactStoreError(
        "BYTE_SIZE_MISMATCH",
        "Accepted private artifact bytes no longer match their immutable metadata.",
      );
    }
    this.transferAudit.directDownloadBytes += verified.content.byteLength;
    return Object.freeze({
      artifact: acceptedArtifact(stored, false),
      bytes: Uint8Array.from(verified.content),
    });
  }

  async putObject(bytes: Uint8Array, extension: string): Promise<StoredLocalArtifact> {
    const stableBytes = Buffer.from(bytes);
    const sha256 = digestBytes(stableBytes);
    const hex = digestHex(sha256);
    const normalizedExtension = safeExtension(extension);
    const directory = await this.ensureDirectory(["objects", "sha256", hex.slice(0, 2)]);
    const destination = path.join(directory, `${hex}.${normalizedExtension}`);
    assertContained(this.root, destination);

    const existing = await this.verifyIfPresent(destination, sha256, normalizedExtension);
    if (existing) return existing;

    const temporary = path.join(directory, `.${hex}.${randomBytes(12).toString("hex")}.tmp`);
    assertContained(this.root, temporary);
    const handle = await open(temporary, "wx", 0o600);
    let handleOpen = true;
    try {
      await handle.writeFile(stableBytes);
      await handle.sync();
      await handle.close();
      handleOpen = false;

      try {
        await link(temporary, destination);
      } catch (error) {
        if (errorCode(error) !== "EEXIST") throw error;
        const concurrent = await this.verifyIfPresent(destination, sha256, normalizedExtension);
        if (!concurrent) {
          throw new LocalArtifactStoreError(
            "IMMUTABLE_COLLISION",
            "The immutable artifact destination appeared without valid content.",
            destination,
          );
        }
        return concurrent;
      }
    } finally {
      if (handleOpen) await handle.close().catch(() => undefined);
      await unlink(temporary).catch((error: unknown) => {
        if (errorCode(error) !== "ENOENT") throw error;
      });
    }

    const canonicalDestination = await realpath(destination);
    assertContained(this.root, canonicalDestination);
    return Object.freeze({
      sha256,
      bytes: stableBytes.byteLength,
      extension: normalizedExtension,
      absolutePath: canonicalDestination,
      created: true,
    });
  }

  async verifyObject(sha256: Sha256Digest, extension: string): Promise<StoredLocalArtifact> {
    const verified = await this.readObject(sha256, extension);
    return Object.freeze({
      sha256: verified.sha256,
      bytes: verified.bytes,
      extension: verified.extension,
      absolutePath: verified.absolutePath,
      created: verified.created,
    });
  }

  async readObject(sha256: Sha256Digest, extension: string): Promise<ReadLocalArtifact> {
    const hex = digestHex(sha256);
    const normalizedExtension = safeExtension(extension);
    const directory = await this.ensureDirectory(["objects", "sha256", hex.slice(0, 2)]);
    const destination = path.join(directory, `${hex}.${normalizedExtension}`);
    const verified = await this.readIfPresent(destination, sha256, normalizedExtension);
    if (!verified) {
      throw new LocalArtifactStoreError(
        "NOT_FOUND",
        "The requested content-addressed artifact does not exist.",
        destination,
      );
    }
    return verified;
  }

  async ensureRunDirectory(revisionId: string, attemptId: string): Promise<LocalRunLocation> {
    const safeRevisionId = safeId(revisionId, "revisionId");
    const safeAttemptId = safeId(attemptId, "attemptId");
    const absolutePath = await this.ensureDirectory(["runs", safeRevisionId, safeAttemptId]);
    return Object.freeze({ revisionId: safeRevisionId, attemptId: safeAttemptId, absolutePath });
  }

  async resolveRunFile(revisionId: string, attemptId: string, filename: string): Promise<string> {
    const run = await this.ensureRunDirectory(revisionId, attemptId);
    const candidate = path.join(run.absolutePath, safeFilename(filename));
    assertContained(run.absolutePath, candidate);

    try {
      const information = await lstat(candidate);
      if (information.isSymbolicLink()) {
        throw new LocalArtifactStoreError(
          "SYMLINK_ESCAPE",
          "Run output paths may not be symbolic links.",
          candidate,
        );
      }
      if (!information.isFile()) {
        throw new LocalArtifactStoreError(
          "UNSAFE_ENTRY",
          "Run output paths may resolve only to regular files.",
          candidate,
        );
      }
      const canonicalCandidate = await realpath(candidate);
      assertContained(run.absolutePath, canonicalCandidate);
      return canonicalCandidate;
    } catch (error) {
      if (errorCode(error) === "ENOENT") return candidate;
      throw error;
    }
  }

  async planRunCleanup(request: LocalCleanupPlanRequest): Promise<LocalCleanupPlan> {
    if (!Number.isFinite(request.cutoffEpochMs) || request.cutoffEpochMs < 0) {
      throw new LocalArtifactStoreError(
        "UNSAFE_ENTRY",
        "Cleanup cutoffEpochMs must be an explicit non-negative finite timestamp.",
      );
    }

    const retained = new Set(
      (request.retain ?? []).map(
        ({ revisionId, attemptId }) =>
          `${safeId(revisionId, "revisionId")}\u0000${safeId(attemptId, "attemptId")}`,
      ),
    );
    const runsRoot = await this.ensureDirectory(["runs"]);
    const candidates: LocalCleanupCandidate[] = [];

    for (const revisionEntry of await readdir(runsRoot, { withFileTypes: true })) {
      const revisionId = safeId(revisionEntry.name, "revisionId");
      const revisionPath = path.join(runsRoot, revisionId);
      await this.assertSafeDirectoryEntry(revisionEntry, revisionPath);

      for (const attemptEntry of await readdir(revisionPath, { withFileTypes: true })) {
        const attemptId = safeId(attemptEntry.name, "attemptId");
        const attemptPath = path.join(revisionPath, attemptId);
        await this.assertSafeDirectoryEntry(attemptEntry, attemptPath);
        if (retained.has(`${revisionId}\u0000${attemptId}`)) continue;

        const information = await stat(attemptPath);
        if (information.mtimeMs >= request.cutoffEpochMs) continue;
        candidates.push(
          Object.freeze({
            revisionId,
            attemptId,
            absolutePath: attemptPath,
            modifiedAtEpochMs: information.mtimeMs,
            bytes: await this.directoryBytes(attemptPath),
          }),
        );
      }
    }

    candidates.sort((left, right) => left.absolutePath.localeCompare(right.absolutePath, "en"));
    return Object.freeze({
      dryRun: true,
      root: this.root,
      cutoffEpochMs: request.cutoffEpochMs,
      candidates: Object.freeze(candidates),
      totalBytes: candidates.reduce((total, candidate) => total + candidate.bytes, 0),
    });
  }

  private acceptedDirectoryIdentity(objectKey: string): string {
    return createHash("sha256").update(objectKey, "utf8").digest("hex");
  }

  private async acceptedArtifactLocation(objectKey: string): Promise<{
    readonly identity: string;
    readonly parent: string;
    readonly destination: string;
  }> {
    const identity = this.acceptedDirectoryIdentity(objectKey);
    const parent = await this.ensureDirectory(["private", "accepted", identity.slice(0, 2)]);
    const destination = path.join(parent, identity);
    assertContained(this.root, destination);
    return Object.freeze({ identity, parent, destination });
  }

  private idempotencyBindingIdentity(workspaceId: string, idempotencyKey: string): string {
    return createHash("sha256")
      .update("videoforge-local-private-idempotency-v1\u0000", "utf8")
      .update(workspaceId, "utf8")
      .update("\u0000", "utf8")
      .update(idempotencyKey, "utf8")
      .digest("hex");
  }

  private expectedIdempotencyBinding(
    intent: CanonicalArtifactUploadIntent,
  ): DurableIdempotencyBinding {
    const identity = this.idempotencyBindingIdentity(
      intent.scope.workspaceId,
      intent.idempotencyKey,
    );
    return Object.freeze({
      schemaVersion: IDEMPOTENCY_BINDING_SCHEMA,
      identity,
      workspaceId: intent.scope.workspaceId,
      idempotencyKey: intent.idempotencyKey,
      intentFingerprint: artifactIntentFingerprint(intent),
      uploadId: uploadIdFor(intent),
      objectKey: intent.objectKey,
      acceptedDirectoryIdentity: this.acceptedDirectoryIdentity(intent.objectKey),
    });
  }

  private sameIdempotencyBinding(
    left: DurableIdempotencyBinding,
    right: DurableIdempotencyBinding,
  ): boolean {
    return (
      left.schemaVersion === right.schemaVersion &&
      left.identity === right.identity &&
      left.workspaceId === right.workspaceId &&
      left.idempotencyKey === right.idempotencyKey &&
      left.intentFingerprint === right.intentFingerprint &&
      left.uploadId === right.uploadId &&
      left.objectKey === right.objectKey &&
      left.acceptedDirectoryIdentity === right.acceptedDirectoryIdentity
    );
  }

  private async idempotencyBindingLocation(
    workspaceIdValue: string,
    idempotencyKeyValue: string,
  ): Promise<{
    readonly identity: string;
    readonly parent: string;
    readonly destination: string;
  }> {
    const workspaceId = canonicalSafeId(workspaceIdValue, "workspaceId");
    const idempotencyKey = canonicalSafeId(idempotencyKeyValue, "idempotencyKey");
    const identity = this.idempotencyBindingIdentity(workspaceId, idempotencyKey);
    const parent = await this.ensureDirectory(["private", "idempotency", identity.slice(0, 2)]);
    const destination = path.join(parent, `${identity}.json`);
    assertContained(this.root, destination);
    return Object.freeze({ identity, parent, destination });
  }

  private async readIdempotencyBinding(
    workspaceId: string,
    idempotencyKey: string,
  ): Promise<DurableIdempotencyBinding | null> {
    const location = await this.idempotencyBindingLocation(workspaceId, idempotencyKey);
    let information;
    try {
      information = await lstat(location.destination);
    } catch (error) {
      if (errorCode(error) === "ENOENT") return null;
      throw error;
    }
    if (
      information.isSymbolicLink() ||
      !information.isFile() ||
      information.size > IDEMPOTENCY_BINDING_MAX_BYTES
    ) {
      throw new LocalArtifactStoreError(
        "METADATA_MISMATCH",
        "Private artifact idempotency binding must be a bounded ordinary file.",
        location.destination,
      );
    }
    const handle = await open(location.destination, constants.O_RDONLY | constants.O_NOFOLLOW);
    let raw: unknown;
    try {
      raw = JSON.parse((await handle.readFile()).toString("utf8")) as unknown;
    } catch {
      throw new LocalArtifactStoreError(
        "METADATA_MISMATCH",
        "Private artifact idempotency binding is not valid JSON.",
        location.destination,
      );
    } finally {
      await handle.close();
    }
    const candidate = requestRecord(raw, "private artifact idempotency binding");
    exactRequestKeys(
      candidate,
      [
        "schemaVersion",
        "identity",
        "workspaceId",
        "idempotencyKey",
        "intentFingerprint",
        "uploadId",
        "objectKey",
        "acceptedDirectoryIdentity",
      ],
      "private artifact idempotency binding",
    );
    const candidateWorkspaceId = canonicalSafeId(candidate.workspaceId, "workspaceId");
    const candidateIdempotencyKey = canonicalSafeId(candidate.idempotencyKey, "idempotencyKey");
    const intentFingerprint = canonicalSha256(candidate.intentFingerprint, "intentFingerprint");
    const uploadId = canonicalSafeId(candidate.uploadId, "uploadId");
    if (
      candidate.schemaVersion !== IDEMPOTENCY_BINDING_SCHEMA ||
      candidate.identity !== location.identity ||
      candidateWorkspaceId !== workspaceId ||
      candidateIdempotencyKey !== idempotencyKey ||
      typeof candidate.objectKey !== "string" ||
      candidate.objectKey.length < 1 ||
      candidate.objectKey.length > 600 ||
      workspaceFromObjectKey(candidate.objectKey) !== workspaceId ||
      typeof candidate.acceptedDirectoryIdentity !== "string" ||
      !IDEMPOTENCY_IDENTITY.test(candidate.acceptedDirectoryIdentity) ||
      candidate.acceptedDirectoryIdentity !== this.acceptedDirectoryIdentity(candidate.objectKey)
    ) {
      throw new LocalArtifactStoreError(
        "METADATA_MISMATCH",
        "Private artifact idempotency binding does not match its durable identity.",
        location.destination,
      );
    }
    return Object.freeze({
      schemaVersion: IDEMPOTENCY_BINDING_SCHEMA,
      identity: location.identity,
      workspaceId: candidateWorkspaceId,
      idempotencyKey: candidateIdempotencyKey,
      intentFingerprint,
      uploadId,
      objectKey: candidate.objectKey,
      acceptedDirectoryIdentity: candidate.acceptedDirectoryIdentity,
    });
  }

  private async writeIdempotencyBinding(expected: DurableIdempotencyBinding): Promise<boolean> {
    const location = await this.idempotencyBindingLocation(
      expected.workspaceId,
      expected.idempotencyKey,
    );
    const existing = await this.readIdempotencyBinding(
      expected.workspaceId,
      expected.idempotencyKey,
    );
    if (existing !== null) {
      if (!this.sameIdempotencyBinding(existing, expected)) {
        throw new LocalArtifactStoreError(
          "IDEMPOTENCY_CONFLICT",
          "The durable artifact idempotency key is bound to different immutable metadata.",
        );
      }
      return false;
    }
    const temporary = path.join(
      location.parent,
      `.binding-${location.identity}-${randomBytes(12).toString("hex")}.tmp`,
    );
    assertContained(this.root, temporary);
    let linked = false;
    try {
      await this.writeDurableFile(temporary, Buffer.from(JSON.stringify(expected), "utf8"));
      try {
        await link(temporary, location.destination);
        linked = true;
        await this.syncDirectory(location.parent);
      } catch (error) {
        if (errorCode(error) !== "EEXIST") throw error;
        const concurrent = await this.readIdempotencyBinding(
          expected.workspaceId,
          expected.idempotencyKey,
        );
        if (concurrent === null || !this.sameIdempotencyBinding(concurrent, expected)) {
          throw new LocalArtifactStoreError(
            "IDEMPOTENCY_CONFLICT",
            "The durable artifact idempotency key was concurrently rebound.",
          );
        }
        return false;
      }
      return true;
    } catch (error) {
      if (linked) {
        await unlink(location.destination).catch((cleanupError: unknown) => {
          if (errorCode(cleanupError) !== "ENOENT") throw cleanupError;
        });
      }
      throw error;
    } finally {
      await unlink(temporary).catch((error: unknown) => {
        if (errorCode(error) !== "ENOENT") throw error;
      });
    }
  }

  private async withIdempotencyLock<T>(
    workspaceIdValue: string,
    idempotencyKeyValue: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const workspaceId = canonicalSafeId(workspaceIdValue, "workspaceId");
    const idempotencyKey = canonicalSafeId(idempotencyKeyValue, "idempotencyKey");
    const identity = this.idempotencyBindingIdentity(workspaceId, idempotencyKey);
    const parent = await this.ensureDirectory([
      "private",
      "idempotency-locks",
      identity.slice(0, 2),
    ]);
    const lockPath = path.join(parent, identity);
    assertContained(this.root, lockPath);
    for (let poll = 0; ; poll += 1) {
      try {
        await mkdir(lockPath, { mode: 0o700 });
        break;
      } catch (error) {
        if (errorCode(error) !== "EEXIST") throw error;
        const information = await lstat(lockPath).catch((readError: unknown) => {
          if (errorCode(readError) === "ENOENT") return null;
          throw readError;
        });
        if (information === null) continue;
        if (information.isSymbolicLink() || !information.isDirectory()) {
          throw new LocalArtifactStoreError(
            "UNSAFE_ENTRY",
            "Private artifact idempotency lock is not an ordinary directory.",
            lockPath,
          );
        }
        if (poll >= IDEMPOTENCY_LOCK_MAX_POLLS) {
          throw new LocalArtifactStoreError(
            "UPLOAD_STATE_CONFLICT",
            "Timed out waiting for the durable artifact idempotency lock.",
          );
        }
        await new Promise<void>((resolve) => setTimeout(resolve, IDEMPOTENCY_LOCK_POLL_MS));
      }
    }

    let result: T | undefined;
    let operationFailed = false;
    let operationError: unknown;
    try {
      result = await operation();
    } catch (error) {
      operationFailed = true;
      operationError = error;
    }
    let cleanupError: unknown;
    try {
      await rmdir(lockPath);
    } catch (error) {
      cleanupError = error;
    }
    if (operationFailed && cleanupError !== undefined) {
      throw new AggregateError(
        [operationError, cleanupError],
        "Artifact idempotency operation and lock cleanup both failed.",
      );
    }
    if (operationFailed) throw operationError;
    if (cleanupError !== undefined) throw cleanupError;
    return result as T;
  }

  private assertExpectedIdempotencyBinding(
    actual: DurableIdempotencyBinding,
    expected: DurableIdempotencyBinding,
  ): void {
    if (!this.sameIdempotencyBinding(actual, expected)) {
      throw new LocalArtifactStoreError(
        "IDEMPOTENCY_CONFLICT",
        "The durable artifact idempotency key is already bound to different immutable metadata.",
      );
    }
  }

  private async ensureAcceptedIdempotencyBinding(stored: StoredPrivateArtifact): Promise<void> {
    const expected = this.expectedIdempotencyBinding(stored.intent);
    await this.withIdempotencyLock(expected.workspaceId, expected.idempotencyKey, async () => {
      const existing = await this.readIdempotencyBinding(
        expected.workspaceId,
        expected.idempotencyKey,
      );
      if (existing !== null) {
        this.assertExpectedIdempotencyBinding(existing, expected);
        return;
      }
      await this.writeIdempotencyBinding(expected);
    });
  }

  private async writeDurableFile(destination: string, bytes: Uint8Array): Promise<void> {
    assertContained(this.root, destination);
    const handle = await open(destination, "wx", 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  private async syncDirectory(directory: string): Promise<void> {
    const handle = await open(directory, constants.O_RDONLY);
    try {
      await handle.sync();
    } catch (error) {
      if (errorCode(error) !== "EINVAL" && errorCode(error) !== "ENOTSUP") throw error;
    } finally {
      await handle.close();
    }
  }

  private async persistAcceptedPrivateArtifact(
    upload: LocalUploadRecord,
    completedParts: readonly CanonicalArtifactCompletedPart[],
    acceptedAtEpochMs: number,
  ): Promise<PrivateAcceptanceResult> {
    const intent = upload.intent;
    const fingerprint = artifactIntentFingerprint(intent);
    const inMemory = this.privateArtifacts.get(intent.objectKey);
    if (inMemory !== undefined) {
      if (inMemory.fingerprint !== fingerprint) {
        throw new LocalArtifactStoreError(
          "IMMUTABLE_COLLISION",
          "The immutable objectKey is already accepted with different exact metadata.",
        );
      }
      return Object.freeze({ stored: inMemory, created: false });
    }

    const location = await this.acceptedArtifactLocation(intent.objectKey);
    const stagingRoot = await this.ensureDirectory(["private", "staging"]);
    const temporary = path.join(
      stagingRoot,
      `.accept-${location.identity}-${randomBytes(12).toString("hex")}`,
    );
    assertContained(this.root, temporary);
    await mkdir(temporary, { mode: 0o700 });
    let published = false;
    try {
      const extension = extensionForObjectKey(intent.objectKey);
      const contentPath = path.join(temporary, `object.${extension}`);
      const metadataPath = path.join(temporary, "metadata.json");
      await this.assembleMultipartFile(upload, completedParts, contentPath);
      await validateArtifactMediaFile(
        intent.integrity.contentType,
        contentPath,
        intent.integrity.byteSize,
      );
      const metadata = Object.freeze({
        schemaVersion: ACCEPTED_METADATA_SCHEMA,
        intentFingerprint: fingerprint,
        intent,
        acceptedAtEpochMs,
        completedParts: completedParts.map((part) => Object.freeze({ ...part, replayed: false })),
      });
      await this.writeDurableFile(metadataPath, Buffer.from(JSON.stringify(metadata), "utf8"));
      await this.syncDirectory(temporary);
      const expectedBinding = this.expectedIdempotencyBinding(intent);
      const result = await this.withIdempotencyLock(
        intent.scope.workspaceId,
        intent.idempotencyKey,
        async (): Promise<PrivateAcceptanceResult> => {
          const existingBinding = await this.readIdempotencyBinding(
            intent.scope.workspaceId,
            intent.idempotencyKey,
          );
          if (existingBinding !== null) {
            this.assertExpectedIdempotencyBinding(existingBinding, expectedBinding);
          } else {
            try {
              await rename(temporary, location.destination);
              published = true;
              await this.syncDirectory(location.parent);
            } catch (error) {
              if (errorCode(error) !== "EEXIST" && errorCode(error) !== "ENOTEMPTY") throw error;
            }
          }

          try {
            const stored = await this.readAcceptedArtifactDirectory(
              location.destination,
              location.identity,
            );
            if (stored.fingerprint !== fingerprint) {
              throw new LocalArtifactStoreError(
                existingBinding === null ? "IMMUTABLE_COLLISION" : "IDEMPOTENCY_CONFLICT",
                "The accepted private artifact destination contains different exact metadata.",
                location.destination,
              );
            }
            if (existingBinding === null) await this.writeIdempotencyBinding(expectedBinding);
            return Object.freeze({ stored, created: published });
          } catch (error) {
            if (!published) throw error;
            try {
              await rm(location.destination, { recursive: true, force: true });
              await this.syncDirectory(location.parent);
              published = false;
            } catch (cleanupError) {
              throw new AggregateError(
                [error, cleanupError],
                "Private artifact publication and rollback both failed.",
              );
            }
            throw error;
          }
        },
      );
      const stored = result.stored;
      this.privateArtifacts.set(intent.objectKey, stored);
      return result;
    } finally {
      if (!published) await rm(temporary, { recursive: true, force: true });
    }
  }

  private async assembleMultipartFile(
    upload: LocalUploadRecord,
    completedParts: readonly CanonicalArtifactCompletedPart[],
    destination: string,
  ): Promise<void> {
    assertContained(this.root, destination);
    const destinationHandle = await open(destination, "wx", 0o600);
    const wholeDigest = createHash("sha256");
    const scratch = Buffer.allocUnsafe(1024 * 1024);
    let totalBytes = 0;
    try {
      for (const completed of completedParts) {
        const stored = upload.parts.get(completed.partNumber);
        if (stored === undefined) {
          throw new LocalArtifactStoreError(
            "MULTIPART_INCOMPLETE",
            "Multipart completion is missing a private spool file.",
          );
        }
        const sourceHandle = await open(
          stored.absolutePath,
          constants.O_RDONLY | constants.O_NOFOLLOW,
        );
        const partDigest = createHash("sha256");
        let partBytes = 0;
        try {
          const information = await sourceHandle.stat();
          if (!information.isFile() || information.size !== stored.partBytes) {
            throw new LocalArtifactStoreError(
              "BYTE_SIZE_MISMATCH",
              "Multipart spool file size changed before completion.",
              stored.absolutePath,
            );
          }
          for (;;) {
            const { bytesRead } = await sourceHandle.read(scratch, 0, scratch.byteLength, null);
            if (bytesRead === 0) break;
            const chunk = scratch.subarray(0, bytesRead);
            wholeDigest.update(chunk);
            partDigest.update(chunk);
            let written = 0;
            while (written < bytesRead) {
              const result = await destinationHandle.write(
                chunk,
                written,
                bytesRead - written,
                null,
              );
              if (result.bytesWritten === 0) {
                throw new LocalArtifactStoreError(
                  "UNSAFE_ENTRY",
                  "Durable multipart assembly made no write progress.",
                  destination,
                );
              }
              written += result.bytesWritten;
            }
            partBytes += bytesRead;
            totalBytes += bytesRead;
          }
        } finally {
          await sourceHandle.close();
        }
        const actualPartDigest = `sha256:${partDigest.digest("hex")}`;
        if (partBytes !== stored.partBytes || actualPartDigest !== stored.partSha256) {
          throw new LocalArtifactStoreError(
            "CONTENT_HASH_MISMATCH",
            "Multipart spool bytes changed before immutable acceptance.",
            stored.absolutePath,
          );
        }
      }
      await destinationHandle.sync();
    } finally {
      await destinationHandle.close();
    }
    if (totalBytes !== upload.intent.integrity.byteSize) {
      throw new LocalArtifactStoreError(
        "BYTE_SIZE_MISMATCH",
        "Completed artifact size does not match its signed integrity metadata.",
      );
    }
    const actualSha256 = `sha256:${wholeDigest.digest("hex")}`;
    if (actualSha256 !== upload.intent.integrity.binarySha256) {
      throw new LocalArtifactStoreError(
        "CONTENT_HASH_MISMATCH",
        "Completed artifact checksum does not match its signed integrity metadata.",
      );
    }
  }

  private async loadAcceptedArtifacts(): Promise<void> {
    const acceptedRoot = await this.ensureDirectory(["private", "accepted"]);
    for (const prefixEntry of await readdir(acceptedRoot, { withFileTypes: true })) {
      const prefixPath = path.join(acceptedRoot, prefixEntry.name);
      if (
        !ACCEPTED_PREFIX.test(prefixEntry.name) ||
        prefixEntry.isSymbolicLink() ||
        !prefixEntry.isDirectory()
      ) {
        throw new LocalArtifactStoreError(
          "UNSAFE_ENTRY",
          "Private accepted storage contains an unsafe prefix entry.",
          prefixPath,
        );
      }
      for (const artifactEntry of await readdir(prefixPath, { withFileTypes: true })) {
        const artifactPath = path.join(prefixPath, artifactEntry.name);
        if (
          !ACCEPTED_DIRECTORY.test(artifactEntry.name) ||
          !artifactEntry.name.startsWith(prefixEntry.name) ||
          artifactEntry.isSymbolicLink() ||
          !artifactEntry.isDirectory()
        ) {
          throw new LocalArtifactStoreError(
            "UNSAFE_ENTRY",
            "Private accepted storage contains an unsafe artifact entry.",
            artifactPath,
          );
        }
        const stored = await this.readAcceptedArtifactDirectory(artifactPath, artifactEntry.name);
        if (this.privateArtifacts.has(stored.artifact.objectKey)) {
          throw new LocalArtifactStoreError(
            "IMMUTABLE_COLLISION",
            "Duplicate durable metadata addresses the same private objectKey.",
            stored.artifact.objectKey,
          );
        }
        this.privateArtifacts.set(stored.artifact.objectKey, stored);
        const uploadId = uploadIdFor(stored.intent);
        const idempotencyIdentity = `${stored.intent.scope.workspaceId}\u0000${stored.intent.idempotencyKey}`;
        const existingIdentity = this.idempotency.get(idempotencyIdentity);
        if (
          existingIdentity !== undefined &&
          (existingIdentity.fingerprint !== stored.fingerprint ||
            existingIdentity.uploadId !== uploadId)
        ) {
          throw new LocalArtifactStoreError(
            "IDEMPOTENCY_CONFLICT",
            "Durable private metadata reuses an idempotency key for different exact metadata.",
          );
        }
        await this.ensureAcceptedIdempotencyBinding(stored);
        const loadedUpload: LocalUploadRecord = {
          uploadId,
          intent: stored.intent,
          fingerprint: stored.fingerprint,
          parts: new Map(),
          acceptedParts: new Map(stored.completedParts.map((part) => [part.partNumber, part])),
          mutationTail: { current: Promise.resolve() },
          stagingDirectory: null,
          leaseExpiresAtEpochMs: stored.artifact.acceptedAtEpochMs,
          state: "COMPLETED",
          accepted: stored,
          completion: null,
        };
        this.uploads.set(uploadId, loadedUpload);
        this.idempotency.set(idempotencyIdentity, {
          fingerprint: stored.fingerprint,
          uploadId,
        });
      }
    }
  }

  private async readAcceptedArtifactDirectory(
    directory: string,
    expectedIdentity: string,
  ): Promise<StoredPrivateArtifact> {
    const information = await lstat(directory);
    if (information.isSymbolicLink() || !information.isDirectory()) {
      throw new LocalArtifactStoreError(
        "UNSAFE_ENTRY",
        "Accepted private artifact must be an ordinary directory.",
        directory,
      );
    }
    const canonicalDirectory = await realpath(directory);
    assertContained(this.root, canonicalDirectory);
    const metadataPath = path.join(canonicalDirectory, "metadata.json");
    const metadataInformation = await lstat(metadataPath);
    if (
      metadataInformation.isSymbolicLink() ||
      !metadataInformation.isFile() ||
      metadataInformation.size > ACCEPTED_METADATA_MAX_BYTES
    ) {
      throw new LocalArtifactStoreError(
        "METADATA_MISMATCH",
        "Accepted private artifact metadata is not a bounded ordinary file.",
        metadataPath,
      );
    }
    const metadataHandle = await open(metadataPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    let rawMetadata: unknown;
    try {
      rawMetadata = JSON.parse((await metadataHandle.readFile()).toString("utf8")) as unknown;
    } catch {
      throw new LocalArtifactStoreError(
        "METADATA_MISMATCH",
        "Accepted private artifact metadata is not valid JSON.",
        metadataPath,
      );
    } finally {
      await metadataHandle.close();
    }
    const candidate = requestRecord(rawMetadata, "accepted private artifact metadata");
    exactRequestKeys(
      candidate,
      ["schemaVersion", "intentFingerprint", "intent", "acceptedAtEpochMs", "completedParts"],
      "accepted private artifact metadata",
    );
    if (candidate.schemaVersion !== ACCEPTED_METADATA_SCHEMA) {
      throw new LocalArtifactStoreError(
        "METADATA_MISMATCH",
        "Accepted private artifact metadata schema is invalid.",
      );
    }
    const acceptedAtEpochMs = canonicalEpochMs(candidate.acceptedAtEpochMs, "acceptedAtEpochMs");
    const intent = canonicalUploadIntent(candidate.intent, acceptedAtEpochMs);
    const fingerprint = canonicalSha256(candidate.intentFingerprint, "intentFingerprint");
    if (
      fingerprint !== artifactIntentFingerprint(intent) ||
      expectedIdentity !== this.acceptedDirectoryIdentity(intent.objectKey)
    ) {
      throw new LocalArtifactStoreError(
        "METADATA_MISMATCH",
        "Accepted private artifact identity or fingerprint does not match its exact metadata.",
      );
    }
    const completedParts = canonicalCompletionParts(candidate.completedParts);
    if (
      completedParts.reduce((total, part) => total + part.partBytes, 0) !==
      intent.integrity.byteSize
    ) {
      throw new LocalArtifactStoreError(
        "METADATA_MISMATCH",
        "Accepted private artifact part sizes do not match exact integrity metadata.",
      );
    }
    const extension = extensionForObjectKey(intent.objectKey);
    const contentPath = path.join(canonicalDirectory, `object.${extension}`);
    const names = (await readdir(canonicalDirectory)).sort((left, right) =>
      left.localeCompare(right, "en"),
    );
    const expectedNames = ["metadata.json", `object.${extension}`].sort((left, right) =>
      left.localeCompare(right, "en"),
    );
    if (names.length !== 2 || names.some((name, index) => name !== expectedNames[index])) {
      throw new LocalArtifactStoreError(
        "UNSAFE_ENTRY",
        "Accepted private artifact directory must contain only exact bytes and metadata.",
        canonicalDirectory,
      );
    }
    const verified = await this.verifyFileDigest(
      contentPath,
      intent.integrity.binarySha256,
      intent.integrity.byteSize,
    );
    if (verified === null) {
      throw new LocalArtifactStoreError(
        "BYTE_SIZE_MISMATCH",
        "Durable private artifact bytes do not match exact integrity metadata.",
        contentPath,
      );
    }
    await validateArtifactMediaFile(
      intent.integrity.contentType,
      verified.absolutePath,
      intent.integrity.byteSize,
    );
    const artifact = Object.freeze({
      assetId: intent.assetId,
      scope: intent.scope,
      objectKey: intent.objectKey,
      binarySha256: intent.integrity.binarySha256,
      byteSize: intent.integrity.byteSize,
      contentType: intent.integrity.contentType,
      canonicalDocument: intent.integrity.canonicalDocument,
      retention: intent.retention,
      acceptedAtEpochMs,
      storageUri: `vf-local-private:///${intent.objectKey}`,
    });
    return Object.freeze({
      intent,
      artifact,
      absolutePath: verified.absolutePath,
      extension,
      fingerprint,
      completedParts,
    });
  }

  private async ensureDirectory(segments: readonly string[]): Promise<string> {
    let current = this.root;
    for (const segment of segments) {
      const candidate = path.join(current, segment);
      assertContained(this.root, candidate);
      try {
        const information = await lstat(candidate);
        if (information.isSymbolicLink()) {
          throw new LocalArtifactStoreError(
            "SYMLINK_ESCAPE",
            "Local artifact directories may not be symbolic links.",
            candidate,
          );
        }
        if (!information.isDirectory()) {
          throw new LocalArtifactStoreError(
            "UNSAFE_ENTRY",
            "A local artifact directory path is occupied by a non-directory entry.",
            candidate,
          );
        }
      } catch (error) {
        if (errorCode(error) !== "ENOENT") throw error;
        await mkdir(candidate, { mode: 0o700 }).catch((mkdirError: unknown) => {
          if (errorCode(mkdirError) !== "EEXIST") throw mkdirError;
        });

        const created = await lstat(candidate);
        if (created.isSymbolicLink()) {
          throw new LocalArtifactStoreError(
            "SYMLINK_ESCAPE",
            "Local artifact directories may not be symbolic links.",
            candidate,
          );
        }
        if (!created.isDirectory()) {
          throw new LocalArtifactStoreError(
            "UNSAFE_ENTRY",
            "A local artifact directory path is occupied by a non-directory entry.",
            candidate,
          );
        }
      }

      const canonicalCandidate = await realpath(candidate);
      assertContained(this.root, canonicalCandidate);
      current = canonicalCandidate;
    }
    return current;
  }

  private async verifyIfPresent(
    destination: string,
    expected: Sha256Digest,
    extension: string,
  ): Promise<StoredLocalArtifact | null> {
    const verified = await this.readIfPresent(destination, expected, extension);
    if (!verified) return null;
    return Object.freeze({
      sha256: verified.sha256,
      bytes: verified.bytes,
      extension: verified.extension,
      absolutePath: verified.absolutePath,
      created: verified.created,
    });
  }

  private async verifyFileDigest(
    destination: string,
    expected: Sha256Digest,
    expectedBytes: number,
  ): Promise<{ readonly absolutePath: string; readonly bytes: number } | null> {
    try {
      const information = await lstat(destination);
      if (information.isSymbolicLink()) {
        throw new LocalArtifactStoreError(
          "SYMLINK_ESCAPE",
          "Immutable artifact files may not be symbolic links.",
          destination,
        );
      }
      if (!information.isFile() || information.size !== expectedBytes) {
        throw new LocalArtifactStoreError(
          "BYTE_SIZE_MISMATCH",
          "Immutable artifact file size does not match exact metadata.",
          destination,
        );
      }
      const canonicalDestination = await realpath(destination);
      assertContained(this.root, canonicalDestination);
      const handle = await open(canonicalDestination, constants.O_RDONLY | constants.O_NOFOLLOW);
      const digest = createHash("sha256");
      const scratch = Buffer.allocUnsafe(1024 * 1024);
      let bytes = 0;
      try {
        const openedInformation = await handle.stat();
        if (!openedInformation.isFile() || openedInformation.size !== expectedBytes) {
          throw new LocalArtifactStoreError(
            "BYTE_SIZE_MISMATCH",
            "Immutable artifact file changed while it was opened.",
            canonicalDestination,
          );
        }
        for (;;) {
          const { bytesRead } = await handle.read(scratch, 0, scratch.byteLength, null);
          if (bytesRead === 0) break;
          digest.update(scratch.subarray(0, bytesRead));
          bytes += bytesRead;
        }
      } finally {
        await handle.close();
      }
      const actual = `sha256:${digest.digest("hex")}`;
      if (bytes !== expectedBytes || actual !== expected) {
        throw new LocalArtifactStoreError(
          "CONTENT_HASH_MISMATCH",
          `Stored artifact bytes hash to ${actual}, not ${expected}.`,
          canonicalDestination,
        );
      }
      return Object.freeze({ absolutePath: canonicalDestination, bytes });
    } catch (error) {
      if (errorCode(error) === "ENOENT") return null;
      throw error;
    }
  }

  private async readIfPresent(
    destination: string,
    expected: Sha256Digest,
    extension: string,
  ): Promise<ReadLocalArtifact | null> {
    try {
      const information = await lstat(destination);
      if (information.isSymbolicLink()) {
        throw new LocalArtifactStoreError(
          "SYMLINK_ESCAPE",
          "Content-addressed artifacts may not be symbolic links.",
          destination,
        );
      }
      if (!information.isFile()) {
        throw new LocalArtifactStoreError(
          "IMMUTABLE_COLLISION",
          "The immutable artifact destination is occupied by a non-file entry.",
          destination,
        );
      }

      const canonicalDestination = await realpath(destination);
      assertContained(this.root, canonicalDestination);
      let handle;
      try {
        handle = await open(canonicalDestination, constants.O_RDONLY | constants.O_NOFOLLOW);
      } catch (error) {
        if (errorCode(error) === "ELOOP") {
          throw new LocalArtifactStoreError(
            "SYMLINK_ESCAPE",
            "Content-addressed artifacts may not be symbolic links.",
            canonicalDestination,
          );
        }
        throw error;
      }
      try {
        const openedInformation = await handle.stat();
        if (!openedInformation.isFile()) {
          throw new LocalArtifactStoreError(
            "IMMUTABLE_COLLISION",
            "The immutable artifact destination is occupied by a non-file entry.",
            canonicalDestination,
          );
        }
        const content = await handle.readFile();
        const actual = digestBytes(content);
        if (actual !== expected) {
          throw new LocalArtifactStoreError(
            "CONTENT_HASH_MISMATCH",
            `Stored artifact bytes hash to ${actual}, not ${expected}.`,
            canonicalDestination,
          );
        }
        return {
          sha256: expected,
          bytes: content.byteLength,
          extension,
          absolutePath: canonicalDestination,
          created: false,
          content,
        };
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (errorCode(error) === "ENOENT") return null;
      throw error;
    }
  }

  private async assertSafeDirectoryEntry(
    entry: { isDirectory(): boolean; isSymbolicLink(): boolean },
    candidate: string,
  ): Promise<void> {
    if (entry.isSymbolicLink()) {
      throw new LocalArtifactStoreError(
        "SYMLINK_ESCAPE",
        "Cleanup planning refuses symbolic-link entries.",
        candidate,
      );
    }
    if (!entry.isDirectory()) {
      throw new LocalArtifactStoreError(
        "UNSAFE_ENTRY",
        "Cleanup planning accepts only revision and attempt directories.",
        candidate,
      );
    }
    const canonicalCandidate = await realpath(candidate);
    assertContained(this.root, canonicalCandidate);
  }

  private async directoryBytes(directory: string): Promise<number> {
    let total = 0;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new LocalArtifactStoreError(
          "SYMLINK_ESCAPE",
          "Cleanup planning refuses symbolic links anywhere in a run.",
          candidate,
        );
      }
      const canonicalCandidate = await realpath(candidate);
      assertContained(this.root, canonicalCandidate);
      if (entry.isDirectory()) total += await this.directoryBytes(canonicalCandidate);
      else if (entry.isFile()) total += (await stat(canonicalCandidate)).size;
      else {
        throw new LocalArtifactStoreError(
          "UNSAFE_ENTRY",
          "Cleanup planning refuses non-file, non-directory run entries.",
          candidate,
        );
      }
    }
    return total;
  }
}

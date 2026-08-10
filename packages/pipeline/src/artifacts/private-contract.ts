import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type { Sha256Digest } from "@videoforge/contracts";

import type {
  ArtifactIntegrity,
  ArtifactOperation,
  ArtifactOwnerScope,
  ArtifactPartReceipt,
  ArtifactRetention,
  ArtifactUploadIntent,
  SignedArtifactOperation,
} from "../assets/ports.js";

const SHA256 = /^sha256:([0-9a-f]{64})$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/u;
const TOKEN_SIGNATURE = /^[0-9a-f]{64}$/u;
const OPAQUE_PART_ETAG = /^etag_[A-Za-z0-9_-]{43}$/u;
const DEFAULT_MAXIMUM_SIGNATURE_TTL_MS = 15 * 60 * 1_000;
const DAY_MS = 24 * 60 * 60 * 1_000;

export const MAX_ARTIFACT_BYTES = 1_024 * 1_024 * 1_024;
export const MAX_STRUCTURED_MEDIA_BYTES = 64 * 1_024 * 1_024;
export const MAX_MULTIPART_PARTS = 256;
export const MAX_MULTIPART_PART_BYTES = 64 * 1_024 * 1_024;
export const MAX_SIGNED_TOKEN_CHARS = 96 * 1_024;
const MAX_SIGNED_BODY_BYTES = 64 * 1_024;

const getOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const getPrototypeOf = Object.getPrototypeOf;
const isArray = Array.isArray;
const objectFreeze = Object.freeze;
const objectKeys = Object.keys;
const reflectOwnKeys = Reflect.ownKeys;

const MIME_EXTENSIONS = Object.freeze({
  "application/json": Object.freeze(["json"]),
  "application/octet-stream": Object.freeze(["bin"]),
  "audio/flac": Object.freeze(["flac"]),
  "audio/mp4": Object.freeze(["m4a", "mp4"]),
  "audio/mpeg": Object.freeze(["mp3"]),
  "audio/wav": Object.freeze(["wav"]),
  "audio/x-wav": Object.freeze(["wav"]),
  "image/jpeg": Object.freeze(["jpeg", "jpg"]),
  "image/png": Object.freeze(["png"]),
  "image/webp": Object.freeze(["webp"]),
  "video/mp4": Object.freeze(["mp4"]),
} as const);

const OWNER_DIRECTORIES = Object.freeze({
  AVATAR_PROFILE_VERSION: Object.freeze([
    "source",
    "thumbnails",
    "previews",
    "compatibility",
    "manifests",
  ]),
  IMAGE_STYLE_VERSION: Object.freeze(["references", "analysis", "previews", "manifests"]),
  PROJECT_REVISION: Object.freeze([
    "inputs",
    "transcript",
    "timeline",
    "prompts",
    "images",
    "avatar",
    "previews",
    "renders",
    "manifests",
  ]),
} as const);

export type LocalArtifactStoreErrorCode =
  | "BYTE_SIZE_MISMATCH"
  | "CONTENT_HASH_MISMATCH"
  | "CONTENT_TYPE_MISMATCH"
  | "IDEMPOTENCY_CONFLICT"
  | "IMMUTABLE_COLLISION"
  | "INVALID_EXTENSION"
  | "INVALID_FILENAME"
  | "INVALID_ID"
  | "INVALID_ROOT"
  | "METADATA_MISMATCH"
  | "MEDIA_SIGNATURE_INVALID"
  | "MULTIPART_INCOMPLETE"
  | "NOT_FOUND"
  | "OBJECT_KEY_INVALID"
  | "PART_INVALID"
  | "PATH_ESCAPE"
  | "REQUEST_INVALID"
  | "ARTIFACT_LIMIT_EXCEEDED"
  | "RETENTION_INVALID"
  | "SCOPE_MISMATCH"
  | "SIGNATURE_EXPIRED"
  | "SIGNATURE_INVALID"
  | "SIGNING_CONFIGURATION_INVALID"
  | "SIGNING_NOT_CONFIGURED"
  | "SYMLINK_ESCAPE"
  | "UNSAFE_ENTRY"
  | "UPLOAD_NOT_FOUND"
  | "UPLOAD_STATE_CONFLICT";

export class LocalArtifactStoreError extends Error {
  readonly code: LocalArtifactStoreErrorCode;
  readonly target?: string;

  constructor(code: LocalArtifactStoreErrorCode, message: string, target?: string) {
    super(message);
    this.name = "LocalArtifactStoreError";
    this.code = code;
    this.target = target;
  }
}

export interface CanonicalArtifactUploadIntent extends ArtifactUploadIntent {
  readonly scope: ArtifactOwnerScope;
  readonly integrity: ArtifactIntegrity;
  readonly retention: ArtifactRetention;
}

export interface CanonicalArtifactPart {
  readonly partNumber: number;
  readonly partSha256: Sha256Digest;
  readonly partBytes: number;
}

export interface CanonicalArtifactCompletedPart extends CanonicalArtifactPart {
  readonly etag: string;
}

export type ArtifactSigningDetail =
  | {
      readonly kind: "INITIATE";
      readonly intent: CanonicalArtifactUploadIntent;
    }
  | {
      readonly kind: "UPLOAD_PART";
      readonly partSha256: Sha256Digest;
      readonly partBytes: number;
    }
  | {
      readonly kind: "COMPLETE";
      readonly parts: readonly CanonicalArtifactCompletedPart[];
    }
  | {
      readonly kind: "ABORT" | "DOWNLOAD";
    };

export interface ArtifactSigningPayload {
  readonly schemaVersion: "artifact-signing-payload/v1";
  readonly operation: ArtifactOperation;
  readonly workspaceId: string;
  readonly objectKey: string;
  readonly uploadId: string | null;
  readonly partNumber: number | null;
  readonly issuedAtEpochMs: number;
  readonly expiresAtEpochMs: number;
  readonly transferUri: string;
  readonly detail: ArtifactSigningDetail;
}

type JsonValue = null | boolean | number | string | readonly JsonValue[] | JsonObject;
interface JsonObject {
  readonly [key: string]: JsonValue;
}

const fail = (code: LocalArtifactStoreErrorCode, message: string, target?: string): never => {
  throw new LocalArtifactStoreError(code, message, target);
};

/**
 * Copies each own data property once before validation. Accessors, exotic prototypes, symbols,
 * and proxy/property-access failures are rejected without traversing unknown values.
 */
export function canonicalPlainRecord(value: unknown, label: string): Record<string, unknown> {
  let array = false;
  try {
    array = isArray(value);
  } catch {
    return fail("REQUEST_INVALID", `${label} shape could not be inspected safely.`);
  }
  if (typeof value !== "object" || value === null || array) {
    return fail("REQUEST_INVALID", `${label} must be an object.`);
  }
  let prototype: object | null;
  let descriptors: Record<PropertyKey, PropertyDescriptor>;
  try {
    prototype = getPrototypeOf(value);
    descriptors = getOwnPropertyDescriptors(value) as unknown as Record<
      PropertyKey,
      PropertyDescriptor
    >;
  } catch {
    return fail("REQUEST_INVALID", `${label} properties could not be read safely.`);
  }
  if (prototype !== Object.prototype && prototype !== null) {
    return fail("REQUEST_INVALID", `${label} must be a plain data object.`);
  }
  const snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of reflectOwnKeys(descriptors)) {
    if (typeof key !== "string") {
      return fail("REQUEST_INVALID", `${label} must not contain symbol properties.`);
    }
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) {
      return fail("REQUEST_INVALID", `${label}.${key} must be an enumerable data property.`);
    }
    snapshot[key] = descriptor.value;
  }
  return objectFreeze(snapshot);
}

function record(value: unknown, label: string): Record<string, unknown> {
  return canonicalPlainRecord(value, label);
}

function canonicalPlainArray(
  value: unknown,
  label: string,
  maximumLength: number,
): readonly unknown[] {
  let array = false;
  try {
    array = isArray(value);
  } catch {
    return fail("REQUEST_INVALID", `${label} shape could not be inspected safely.`);
  }
  if (!array) {
    return fail("REQUEST_INVALID", `${label} must be an array.`);
  }
  let prototype: object | null;
  let descriptors: Record<PropertyKey, PropertyDescriptor>;
  try {
    prototype = getPrototypeOf(value);
    descriptors = getOwnPropertyDescriptors(value) as unknown as Record<
      PropertyKey,
      PropertyDescriptor
    >;
  } catch {
    return fail("REQUEST_INVALID", `${label} entries could not be read safely.`);
  }
  if (prototype !== Array.prototype) {
    return fail("REQUEST_INVALID", `${label} must be a plain array.`);
  }
  const lengthDescriptor = descriptors.length;
  const length = lengthDescriptor?.value;
  if (!Number.isSafeInteger(length) || length < 1 || length > maximumLength) {
    return fail("MULTIPART_INCOMPLETE", `${label} requires 1 to ${maximumLength} entries.`);
  }
  const snapshot: unknown[] = [];
  for (const key of reflectOwnKeys(descriptors)) {
    if (key === "length") continue;
    if (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/u.test(key)) {
      return fail("REQUEST_INVALID", `${label} must not contain extra properties.`);
    }
    const index = Number(key);
    const descriptor = descriptors[key];
    if (
      index >= length ||
      descriptor === undefined ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true
    ) {
      return fail("REQUEST_INVALID", `${label}[${key}] must be an enumerable data property.`);
    }
    snapshot[index] = descriptor.value;
  }
  if (snapshot.length !== length) {
    return fail("REQUEST_INVALID", `${label} must be dense and contiguous.`);
  }
  for (let index = 0; index < length; index += 1) {
    if (!(index in snapshot)) {
      return fail("REQUEST_INVALID", `${label} must be dense and contiguous.`);
    }
  }
  return objectFreeze(snapshot);
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const expectedKeys = [...expected].sort((left, right) => left.localeCompare(right, "en"));
  const actualKeys = objectKeys(value).sort((left, right) => left.localeCompare(right, "en"));
  if (
    expectedKeys.length !== actualKeys.length ||
    expectedKeys.some((expectedKey, index) => expectedKey !== actualKeys[index])
  ) {
    fail("REQUEST_INVALID", `${label} must contain exactly: ${expectedKeys.join(", ")}.`);
  }
}

function safeString(value: unknown, label: string, maximumLength = 240): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximumLength) {
    return fail("REQUEST_INVALID", `${label} must be a non-empty bounded string.`);
  }
  return value;
}

export function canonicalSafeId(value: unknown, label: string): string {
  if (typeof value !== "string" || !SAFE_ID.test(value)) {
    return fail(
      "INVALID_ID",
      `${label} must be a non-empty filesystem-safe VideoForge identifier.`,
      typeof value === "string" ? value : undefined,
    );
  }
  return value;
}

export function canonicalSha256(value: unknown, label: string): Sha256Digest {
  if (typeof value !== "string" || !SHA256.test(value)) {
    return fail(
      "CONTENT_HASH_MISMATCH",
      `${label} must use sha256:<64 lowercase hex characters>.`,
      typeof value === "string" ? value : undefined,
    );
  }
  return value as Sha256Digest;
}

function safeInteger(value: unknown, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    return fail("REQUEST_INVALID", `${label} must be a safe integer at least ${minimum}.`);
  }
  return value as number;
}

export function canonicalEpochMs(value: unknown, label: string): number {
  return safeInteger(value, label, 0);
}

export function canonicalNow(value: unknown): number {
  return canonicalEpochMs(value, "clock.nowEpochMs()");
}

export function canonicalMaximumSignatureTtl(value: unknown): number {
  if (value === undefined) return DEFAULT_MAXIMUM_SIGNATURE_TTL_MS;
  const ttl = safeInteger(value, "maximumSignatureTtlMs", 1);
  if (ttl > DEFAULT_MAXIMUM_SIGNATURE_TTL_MS) {
    return fail(
      "SIGNING_CONFIGURATION_INVALID",
      `maximumSignatureTtlMs may not exceed ${DEFAULT_MAXIMUM_SIGNATURE_TTL_MS}.`,
    );
  }
  return ttl;
}

export function canonicalSigningKey(value: unknown): Buffer {
  if (!(value instanceof Uint8Array) || value.byteLength < 32) {
    return fail(
      "SIGNING_CONFIGURATION_INVALID",
      "Local artifact signingKey must contain at least 32 explicit bytes.",
    );
  }
  return Buffer.from(value);
}

export function canonicalExpiresAt(
  nowEpochMs: number,
  expiresInMs: unknown,
  maximumSignatureTtlMs: number,
): number {
  const ttl = safeInteger(expiresInMs, "expiresInMs", 1);
  if (ttl > maximumSignatureTtlMs) {
    return fail(
      "REQUEST_INVALID",
      `expiresInMs may not exceed the configured ${maximumSignatureTtlMs} ms ceiling.`,
    );
  }
  const expiresAt = nowEpochMs + ttl;
  if (!Number.isSafeInteger(expiresAt)) {
    return fail("REQUEST_INVALID", "The signed-operation expiry exceeds safe integer range.");
  }
  return expiresAt;
}

export function canonicalScope(value: unknown): ArtifactOwnerScope {
  const candidate = record(value, "scope");
  const ownerType = candidate.ownerType;
  switch (ownerType) {
    case "PROJECT_REVISION": {
      exactKeys(
        candidate,
        ["ownerType", "workspaceId", "projectId", "projectRevisionId"],
        "project revision scope",
      );
      return Object.freeze({
        ownerType,
        workspaceId: canonicalSafeId(candidate.workspaceId, "scope.workspaceId"),
        projectId: canonicalSafeId(candidate.projectId, "scope.projectId"),
        projectRevisionId: canonicalSafeId(candidate.projectRevisionId, "scope.projectRevisionId"),
      });
    }
    case "IMAGE_STYLE_VERSION": {
      exactKeys(
        candidate,
        ["ownerType", "workspaceId", "imageStyleId", "imageStyleVersionId"],
        "image style version scope",
      );
      return Object.freeze({
        ownerType,
        workspaceId: canonicalSafeId(candidate.workspaceId, "scope.workspaceId"),
        imageStyleId: canonicalSafeId(candidate.imageStyleId, "scope.imageStyleId"),
        imageStyleVersionId: canonicalSafeId(
          candidate.imageStyleVersionId,
          "scope.imageStyleVersionId",
        ),
      });
    }
    case "AVATAR_PROFILE_VERSION": {
      exactKeys(
        candidate,
        ["ownerType", "workspaceId", "avatarProfileId", "avatarProfileVersionId"],
        "avatar profile version scope",
      );
      return Object.freeze({
        ownerType,
        workspaceId: canonicalSafeId(candidate.workspaceId, "scope.workspaceId"),
        avatarProfileId: canonicalSafeId(candidate.avatarProfileId, "scope.avatarProfileId"),
        avatarProfileVersionId: canonicalSafeId(
          candidate.avatarProfileVersionId,
          "scope.avatarProfileVersionId",
        ),
      });
    }
    default:
      return fail("SCOPE_MISMATCH", "scope.ownerType is not a supported artifact owner.");
  }
}

export function artifactScopePrefix(scope: ArtifactOwnerScope): string {
  switch (scope.ownerType) {
    case "PROJECT_REVISION":
      return `workspace/${scope.workspaceId}/project/${scope.projectId}/revision/${scope.projectRevisionId}/`;
    case "IMAGE_STYLE_VERSION":
      return `workspace/${scope.workspaceId}/image-style/${scope.imageStyleId}/version/${scope.imageStyleVersionId}/`;
    case "AVATAR_PROFILE_VERSION":
      return `workspace/${scope.workspaceId}/avatar-profile/${scope.avatarProfileId}/version/${scope.avatarProfileVersionId}/`;
  }
}

export function workspaceFromObjectKey(value: unknown): string {
  const objectKey = safeString(value, "objectKey", 600);
  if (
    objectKey.startsWith("/") ||
    objectKey.endsWith("/") ||
    objectKey.includes("\\") ||
    objectKey.includes("%") ||
    objectKey.includes("?") ||
    objectKey.includes("#") ||
    objectKey.includes("//") ||
    objectKey.includes("\u0000")
  ) {
    return fail(
      "OBJECT_KEY_INVALID",
      "Artifact objectKey contains an unsafe path form.",
      objectKey,
    );
  }
  const segments = objectKey.split("/");
  if (
    segments.length < 3 ||
    segments[0] !== "workspace" ||
    segments.some(
      (segment) => segment === "." || segment === ".." || !SAFE_PATH_SEGMENT.test(segment),
    )
  ) {
    return fail(
      "OBJECT_KEY_INVALID",
      "Artifact objectKey is not a safe workspace path.",
      objectKey,
    );
  }
  return canonicalSafeId(segments[1], "objectKey workspaceId");
}

function canonicalDocument(value: unknown): ArtifactIntegrity["canonicalDocument"] {
  if (value === null) return null;
  const candidate = record(value, "integrity.canonicalDocument");
  exactKeys(
    candidate,
    ["contractName", "contractVersion", "canonicalDocumentSha256"],
    "integrity.canonicalDocument",
  );
  return Object.freeze({
    contractName: safeString(candidate.contractName, "canonicalDocument.contractName", 160),
    contractVersion: safeString(candidate.contractVersion, "canonicalDocument.contractVersion", 80),
    canonicalDocumentSha256: canonicalSha256(
      candidate.canonicalDocumentSha256,
      "canonicalDocument.canonicalDocumentSha256",
    ),
  });
}

function canonicalIntegrity(value: unknown): ArtifactIntegrity {
  const candidate = record(value, "integrity");
  exactKeys(
    candidate,
    ["binarySha256", "byteSize", "contentType", "canonicalDocument"],
    "integrity",
  );
  const contentType = safeString(candidate.contentType, "integrity.contentType", 100);
  if (!(contentType in MIME_EXTENSIONS)) {
    return fail("CONTENT_TYPE_MISMATCH", "integrity.contentType is not supported.", contentType);
  }
  const byteSize = safeInteger(candidate.byteSize, "integrity.byteSize", 1);
  if (byteSize > MAX_ARTIFACT_BYTES) {
    return fail(
      "ARTIFACT_LIMIT_EXCEEDED",
      `integrity.byteSize may not exceed ${MAX_ARTIFACT_BYTES} bytes.`,
    );
  }
  if (
    byteSize > MAX_STRUCTURED_MEDIA_BYTES &&
    (contentType === "application/json" || contentType.startsWith("image/"))
  ) {
    return fail(
      "ARTIFACT_LIMIT_EXCEEDED",
      `JSON and raster artifacts may not exceed ${MAX_STRUCTURED_MEDIA_BYTES} bytes locally.`,
    );
  }
  return Object.freeze({
    binarySha256: canonicalSha256(candidate.binarySha256, "integrity.binarySha256"),
    byteSize,
    contentType,
    canonicalDocument: canonicalDocument(candidate.canonicalDocument),
  });
}

function canonicalRetention(value: unknown, nowEpochMs: number): ArtifactRetention {
  const candidate = record(value, "retention");
  exactKeys(candidate, ["retentionClass", "retainUntilEpochMs"], "retention");
  const retentionClass = candidate.retentionClass;
  if (retentionClass === "RETAIN_WHILE_REFERENCED") {
    if (candidate.retainUntilEpochMs !== null) {
      return fail(
        "RETENTION_INVALID",
        "RETAIN_WHILE_REFERENCED requires a null retainUntilEpochMs.",
      );
    }
    return Object.freeze({ retentionClass, retainUntilEpochMs: null });
  }

  if (
    retentionClass !== "FAILED_TEMPORARY" &&
    retentionClass !== "WORKER_INTERMEDIATE" &&
    retentionClass !== "ACCEPTED_SCENE" &&
    retentionClass !== "FINAL_RENDER"
  ) {
    return fail("RETENTION_INVALID", "retention.retentionClass is not supported.");
  }
  const retainUntilEpochMs = canonicalEpochMs(
    candidate.retainUntilEpochMs,
    "retention.retainUntilEpochMs",
  );
  const duration = retainUntilEpochMs - nowEpochMs;
  if (duration <= 0) {
    return fail("RETENTION_INVALID", "Artifact retention must end in the future.");
  }
  if (retentionClass === "FAILED_TEMPORARY" && duration > DAY_MS) {
    return fail(
      "RETENTION_INVALID",
      "Failed temporary artifacts may be retained for at most 24 hours.",
    );
  }
  if (retentionClass === "WORKER_INTERMEDIATE" && duration > 7 * DAY_MS) {
    return fail("RETENTION_INVALID", "Worker intermediates may be retained for at most 7 days.");
  }
  if (
    (retentionClass === "ACCEPTED_SCENE" || retentionClass === "FINAL_RENDER") &&
    duration > 30 * DAY_MS
  ) {
    return fail(
      "RETENTION_INVALID",
      "Accepted scenes and final renders may be retained for at most 30 days.",
    );
  }
  return Object.freeze({ retentionClass, retainUntilEpochMs });
}

function assertObjectKey(
  objectKeyValue: unknown,
  scope: ArtifactOwnerScope,
  integrity: ArtifactIntegrity,
): string {
  const objectKey = safeString(objectKeyValue, "objectKey", 600);
  const workspaceId = workspaceFromObjectKey(objectKey);
  if (workspaceId !== scope.workspaceId) {
    return fail("SCOPE_MISMATCH", "Artifact objectKey workspace does not match its owner scope.");
  }
  const prefix = artifactScopePrefix(scope);
  if (!objectKey.startsWith(prefix)) {
    return fail("SCOPE_MISMATCH", "Artifact objectKey does not match its exact owner prefix.");
  }
  const relativeSegments = objectKey.slice(prefix.length).split("/");
  if (relativeSegments.length < 2) {
    return fail(
      "OBJECT_KEY_INVALID",
      "Artifact objectKey requires a typed directory and filename.",
    );
  }
  const firstDirectory = relativeSegments[0];
  if (
    firstDirectory === undefined ||
    !(OWNER_DIRECTORIES[scope.ownerType] as readonly string[]).includes(firstDirectory)
  ) {
    return fail("OBJECT_KEY_INVALID", "Artifact objectKey uses an unsupported owner directory.");
  }
  const secondDirectory = relativeSegments[1];
  if (
    (scope.ownerType === "PROJECT_REVISION" &&
      firstDirectory === "avatar" &&
      !["primary", "repair", "fallback"].includes(secondDirectory ?? "")) ||
    (scope.ownerType === "IMAGE_STYLE_VERSION" &&
      firstDirectory === "references" &&
      !["original", "analysis"].includes(secondDirectory ?? "")) ||
    (scope.ownerType === "AVATAR_PROFILE_VERSION" &&
      firstDirectory === "source" &&
      !["original", "runtime"].includes(secondDirectory ?? ""))
  ) {
    return fail(
      "OBJECT_KEY_INVALID",
      "Artifact objectKey uses an unsupported nested owner directory.",
    );
  }

  const filename = relativeSegments.at(-1);
  const binaryHex = SHA256.exec(integrity.binarySha256)?.[1];
  if (filename === undefined || binaryHex === undefined) {
    return fail("OBJECT_KEY_INVALID", "Artifact objectKey is missing its immutable filename.");
  }
  const dot = filename.lastIndexOf(".");
  if (dot < 1) {
    return fail("OBJECT_KEY_INVALID", "Artifact filenames require a content-type extension.");
  }
  const basename = filename.slice(0, dot);
  const extension = filename.slice(dot + 1).toLowerCase();
  if (basename !== binaryHex) {
    return fail(
      "CONTENT_HASH_MISMATCH",
      "Artifact filename must equal the binary SHA-256 hex digest.",
    );
  }
  const compatibleExtensions = MIME_EXTENSIONS[
    integrity.contentType as keyof typeof MIME_EXTENSIONS
  ] as readonly string[];
  if (!compatibleExtensions.includes(extension)) {
    return fail(
      "CONTENT_TYPE_MISMATCH",
      "Artifact filename extension does not match integrity.contentType.",
    );
  }
  return objectKey;
}

export function canonicalUploadIntent(
  value: unknown,
  nowEpochMs: number,
  includeExpiry = false,
): CanonicalArtifactUploadIntent & { readonly expiresInMs?: number } {
  const candidate = record(value, "artifact upload intent");
  exactKeys(
    candidate,
    includeExpiry
      ? ["idempotencyKey", "assetId", "scope", "objectKey", "integrity", "retention", "expiresInMs"]
      : ["idempotencyKey", "assetId", "scope", "objectKey", "integrity", "retention"],
    "artifact upload intent",
  );
  const scope = canonicalScope(candidate.scope);
  const integrity = canonicalIntegrity(candidate.integrity);
  const base = {
    idempotencyKey: canonicalSafeId(candidate.idempotencyKey, "idempotencyKey"),
    assetId: canonicalSafeId(candidate.assetId, "assetId"),
    scope,
    objectKey: assertObjectKey(candidate.objectKey, scope, integrity),
    integrity,
    retention: canonicalRetention(candidate.retention, nowEpochMs),
  };
  if (!includeExpiry) return Object.freeze(base);
  return Object.freeze({
    ...base,
    expiresInMs: safeInteger(candidate.expiresInMs, "expiresInMs", 1),
  });
}

export function canonicalPart(value: unknown, label = "part"): CanonicalArtifactPart {
  const candidate = record(value, label);
  exactKeys(candidate, ["partNumber", "partSha256", "partBytes"], label);
  const partSha256 = canonicalSha256(candidate.partSha256, `${label}.partSha256`);
  const partNumber = safeInteger(candidate.partNumber, `${label}.partNumber`, 1);
  const partBytes = safeInteger(candidate.partBytes, `${label}.partBytes`, 1);
  if (partNumber > MAX_MULTIPART_PARTS || partBytes > MAX_MULTIPART_PART_BYTES) {
    return fail(
      "ARTIFACT_LIMIT_EXCEEDED",
      `${label} exceeds the multipart part-number or byte-size ceiling.`,
    );
  }
  return objectFreeze({ partNumber, partSha256, partBytes });
}

export function canonicalCompletedPart(
  value: unknown,
  label = "part",
  includesReplay = false,
): CanonicalArtifactCompletedPart {
  const candidate = record(value, label);
  exactKeys(
    candidate,
    includesReplay
      ? ["partNumber", "etag", "partSha256", "partBytes", "replayed"]
      : ["partNumber", "etag", "partSha256", "partBytes"],
    label,
  );
  if (includesReplay && typeof candidate.replayed !== "boolean") {
    return fail("PART_INVALID", `${label}.replayed must be boolean.`);
  }
  const part = canonicalPart(
    {
      partNumber: candidate.partNumber,
      partSha256: candidate.partSha256,
      partBytes: candidate.partBytes,
    },
    label,
  );
  const etag = candidate.etag;
  if (typeof etag !== "string" || !OPAQUE_PART_ETAG.test(etag) || etag === part.partSha256) {
    return fail("PART_INVALID", `${label}.etag must be a bounded opaque part token.`);
  }
  return objectFreeze({ ...part, etag });
}

export function canonicalCompletionParts(
  value: unknown,
): readonly CanonicalArtifactCompletedPart[] {
  const entries = canonicalPlainArray(value, "parts", MAX_MULTIPART_PARTS);
  const parts = entries.map((part, index) => canonicalCompletedPart(part, `parts[${index}]`, true));
  for (let index = 0; index < parts.length; index += 1) {
    if (parts[index]?.partNumber !== index + 1) {
      return fail(
        "MULTIPART_INCOMPLETE",
        "Multipart completion parts must be unique, ordered, and contiguous from part 1.",
      );
    }
  }
  return Object.freeze(parts);
}

export function canonicalReceipt(
  part: CanonicalArtifactPart,
  etag: string,
  replayed: boolean,
): ArtifactPartReceipt {
  if (!OPAQUE_PART_ETAG.test(etag) || etag === part.partSha256) {
    return fail("PART_INVALID", "Generated multipart ETag is not a bounded opaque token.");
  }
  return Object.freeze({
    partNumber: part.partNumber,
    etag,
    partSha256: part.partSha256,
    partBytes: part.partBytes,
    replayed,
  });
}

export function createOpaquePartEtag(
  signingKey: Uint8Array,
  uploadId: string,
  part: CanonicalArtifactPart,
): string {
  const canonicalUploadId = canonicalSafeId(uploadId, "uploadId");
  const body = `${canonicalUploadId}\u0000${part.partNumber}\u0000${part.partSha256}\u0000${part.partBytes}`;
  return `etag_${createHmac("sha256", signingKey).update(body).digest("base64url")}`;
}

export function assertRetentionActive(retention: ArtifactRetention, nowEpochMs: number): void {
  if (
    retention.retentionClass !== "RETAIN_WHILE_REFERENCED" &&
    (retention.retainUntilEpochMs === null || retention.retainUntilEpochMs <= nowEpochMs)
  ) {
    fail("RETENTION_INVALID", "Artifact retention expired before this operation completed.");
  }
}

function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  const objectValue = value as JsonObject;
  return `{${objectKeys(objectValue)
    .sort((left, right) => left.localeCompare(right, "en"))
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(objectValue[key] as JsonValue)}`)
    .join(",")}}`;
}

export function hashCanonical(value: JsonValue): Sha256Digest {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

export function digestArtifactBytes(bytes: Uint8Array): Sha256Digest {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function signingBody(payload: ArtifactSigningPayload): string {
  return Buffer.from(canonicalJson(payload as unknown as JsonValue), "utf8").toString("base64url");
}

export function sealArtifactPayload(
  payload: ArtifactSigningPayload,
  signingKey: Uint8Array,
): string {
  const body = signingBody(payload);
  if (
    Buffer.byteLength(body, "utf8") > MAX_SIGNED_TOKEN_CHARS - 65 ||
    Buffer.from(body, "base64url").byteLength > MAX_SIGNED_BODY_BYTES
  ) {
    return fail("ARTIFACT_LIMIT_EXCEEDED", "Signed artifact token exceeds its bounded size.");
  }
  const signature = createHmac("sha256", signingKey).update(body).digest("hex");
  return `${body}.${signature}`;
}

function readOperation(value: unknown): ArtifactOperation {
  if (
    value !== "INITIATE" &&
    value !== "UPLOAD_PART" &&
    value !== "COMPLETE" &&
    value !== "ABORT" &&
    value !== "DOWNLOAD"
  ) {
    return fail("SIGNATURE_INVALID", "Signed artifact operation is not supported.");
  }
  return value;
}

function canonicalPayload(value: unknown): ArtifactSigningPayload {
  const candidate = record(value, "signed artifact payload");
  exactKeys(
    candidate,
    [
      "schemaVersion",
      "operation",
      "workspaceId",
      "objectKey",
      "uploadId",
      "partNumber",
      "issuedAtEpochMs",
      "expiresAtEpochMs",
      "transferUri",
      "detail",
    ],
    "signed artifact payload",
  );
  if (candidate.schemaVersion !== "artifact-signing-payload/v1") {
    return fail("SIGNATURE_INVALID", "Signed artifact payload version is invalid.");
  }
  const operation = readOperation(candidate.operation);
  const issuedAtEpochMs = canonicalEpochMs(candidate.issuedAtEpochMs, "issuedAtEpochMs");
  const expiresAtEpochMs = canonicalEpochMs(candidate.expiresAtEpochMs, "expiresAtEpochMs");
  if (expiresAtEpochMs <= issuedAtEpochMs) {
    return fail("SIGNATURE_INVALID", "Signed artifact expiry must follow issuance.");
  }
  const workspaceId = canonicalSafeId(candidate.workspaceId, "workspaceId");
  const objectKey = safeString(candidate.objectKey, "objectKey", 600);
  if (workspaceFromObjectKey(objectKey) !== workspaceId) {
    return fail("SIGNATURE_INVALID", "Signed artifact workspace and objectKey disagree.");
  }
  const uploadId =
    candidate.uploadId === null ? null : canonicalSafeId(candidate.uploadId, "uploadId");
  const partNumber =
    candidate.partNumber === null ? null : safeInteger(candidate.partNumber, "partNumber", 1);
  const transferUri = safeString(candidate.transferUri, "transferUri", 1_000);
  const detailCandidate = record(candidate.detail, "signed artifact detail");
  let detail: ArtifactSigningDetail;
  switch (operation) {
    case "INITIATE": {
      exactKeys(detailCandidate, ["kind", "intent"], "initiate detail");
      if (detailCandidate.kind !== "INITIATE" || uploadId === null || partNumber !== null) {
        return fail("SIGNATURE_INVALID", "Signed initiate detail is inconsistent.");
      }
      const intent = canonicalUploadIntent(detailCandidate.intent, issuedAtEpochMs);
      if (intent.scope.workspaceId !== workspaceId || intent.objectKey !== objectKey) {
        return fail("SIGNATURE_INVALID", "Signed initiate intent does not match its descriptor.");
      }
      detail = Object.freeze({ kind: "INITIATE", intent });
      break;
    }
    case "UPLOAD_PART": {
      exactKeys(detailCandidate, ["kind", "partSha256", "partBytes"], "upload-part detail");
      if (detailCandidate.kind !== "UPLOAD_PART" || uploadId === null || partNumber === null) {
        return fail("SIGNATURE_INVALID", "Signed upload-part detail is inconsistent.");
      }
      const signedPart = canonicalPart({
        partNumber,
        partSha256: detailCandidate.partSha256,
        partBytes: detailCandidate.partBytes,
      });
      detail = Object.freeze({
        kind: "UPLOAD_PART",
        partSha256: signedPart.partSha256,
        partBytes: signedPart.partBytes,
      });
      break;
    }
    case "COMPLETE": {
      exactKeys(detailCandidate, ["kind", "parts"], "complete detail");
      if (detailCandidate.kind !== "COMPLETE" || uploadId === null || partNumber !== null) {
        return fail("SIGNATURE_INVALID", "Signed complete detail is inconsistent.");
      }
      const entries = canonicalPlainArray(
        detailCandidate.parts,
        "signed complete parts",
        MAX_MULTIPART_PARTS,
      );
      const parts = entries.map((part, index) => canonicalCompletedPart(part, `parts[${index}]`));
      if (parts.some((part, index) => part.partNumber !== index + 1)) {
        return fail("SIGNATURE_INVALID", "Signed complete parts are not contiguous.");
      }
      detail = Object.freeze({ kind: "COMPLETE", parts: Object.freeze(parts) });
      break;
    }
    case "ABORT":
    case "DOWNLOAD": {
      exactKeys(detailCandidate, ["kind"], `${operation.toLowerCase()} detail`);
      if (
        detailCandidate.kind !== operation ||
        partNumber !== null ||
        (operation === "ABORT" && uploadId === null) ||
        (operation === "DOWNLOAD" && uploadId !== null)
      ) {
        return fail(
          "SIGNATURE_INVALID",
          `Signed ${operation.toLowerCase()} detail is inconsistent.`,
        );
      }
      detail = Object.freeze({ kind: operation });
      break;
    }
  }
  return Object.freeze({
    schemaVersion: "artifact-signing-payload/v1",
    operation,
    workspaceId,
    objectKey,
    uploadId,
    partNumber,
    issuedAtEpochMs,
    expiresAtEpochMs,
    transferUri,
    detail,
  });
}

export function openArtifactPayload(
  token: unknown,
  signingKey: Uint8Array,
): ArtifactSigningPayload {
  if (typeof token !== "string") {
    return fail("SIGNATURE_INVALID", "Signed artifact token must be a string.");
  }
  if (token.length > MAX_SIGNED_TOKEN_CHARS) {
    return fail("SIGNATURE_INVALID", "Signed artifact token exceeds its bounded length.");
  }
  const pieces = token.split(".");
  const body = pieces[0];
  const signature = pieces[1];
  if (
    pieces.length !== 2 ||
    body === undefined ||
    body.length === 0 ||
    signature === undefined ||
    !TOKEN_SIGNATURE.test(signature)
  ) {
    return fail("SIGNATURE_INVALID", "Signed artifact token format is invalid.");
  }
  let decoded: Buffer;
  try {
    decoded = Buffer.from(body, "base64url");
  } catch {
    return fail("SIGNATURE_INVALID", "Signed artifact token body is not base64url.");
  }
  if (decoded.byteLength > MAX_SIGNED_BODY_BYTES) {
    return fail("SIGNATURE_INVALID", "Signed artifact token body exceeds its bounded length.");
  }
  if (decoded.toString("base64url") !== body) {
    return fail("SIGNATURE_INVALID", "Signed artifact token body is not canonical base64url.");
  }
  const expected = Buffer.from(createHmac("sha256", signingKey).update(body).digest("hex"), "utf8");
  const actual = Buffer.from(signature, "utf8");
  if (actual.byteLength !== expected.byteLength || !timingSafeEqual(actual, expected)) {
    return fail("SIGNATURE_INVALID", "Signed artifact token authentication failed.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded.toString("utf8")) as unknown;
  } catch {
    return fail("SIGNATURE_INVALID", "Signed artifact token payload is not JSON.");
  }
  return canonicalPayload(parsed);
}

export function signedArtifactOperation(
  payload: ArtifactSigningPayload,
  signingKey: Uint8Array,
): SignedArtifactOperation {
  return Object.freeze({
    schemaVersion: "signed-artifact-operation/v1",
    operation: payload.operation,
    workspaceId: payload.workspaceId,
    objectKey: payload.objectKey,
    uploadId: payload.uploadId,
    partNumber: payload.partNumber,
    expiresAtEpochMs: payload.expiresAtEpochMs,
    transferUri: payload.transferUri,
    token: sealArtifactPayload(payload, signingKey),
    applicationBodyBytes: 0,
  });
}

export function verifySignedArtifactOperation(
  value: unknown,
  expectedOperation: ArtifactOperation,
  signingKey: Uint8Array,
  nowEpochMs: number,
  maximumSignatureTtlMs: number,
): ArtifactSigningPayload {
  const candidate = record(value, "signed artifact operation");
  exactKeys(
    candidate,
    [
      "schemaVersion",
      "operation",
      "workspaceId",
      "objectKey",
      "uploadId",
      "partNumber",
      "expiresAtEpochMs",
      "transferUri",
      "token",
      "applicationBodyBytes",
    ],
    "signed artifact operation",
  );
  if (
    candidate.schemaVersion !== "signed-artifact-operation/v1" ||
    candidate.operation !== expectedOperation ||
    candidate.applicationBodyBytes !== 0
  ) {
    return fail("SIGNATURE_INVALID", "Signed artifact descriptor is inconsistent.");
  }
  const payload = openArtifactPayload(candidate.token, signingKey);
  if (
    payload.operation !== expectedOperation ||
    candidate.workspaceId !== payload.workspaceId ||
    candidate.objectKey !== payload.objectKey ||
    candidate.uploadId !== payload.uploadId ||
    candidate.partNumber !== payload.partNumber ||
    candidate.expiresAtEpochMs !== payload.expiresAtEpochMs ||
    candidate.transferUri !== payload.transferUri
  ) {
    return fail("SIGNATURE_INVALID", "Signed artifact descriptor does not match its token.");
  }
  if (payload.expiresAtEpochMs - payload.issuedAtEpochMs > maximumSignatureTtlMs) {
    return fail("SIGNATURE_INVALID", "Signed artifact token exceeds the configured TTL ceiling.");
  }
  if (nowEpochMs < payload.issuedAtEpochMs) {
    return fail("SIGNATURE_INVALID", "Signed artifact operation is not valid before issuance.");
  }
  if (nowEpochMs >= payload.expiresAtEpochMs) {
    return fail("SIGNATURE_EXPIRED", "Signed artifact operation has expired.");
  }
  return payload;
}

export function extensionForObjectKey(objectKey: string): string {
  const filename = objectKey.split("/").at(-1);
  const dot = filename?.lastIndexOf(".") ?? -1;
  if (filename === undefined || dot < 1 || dot === filename.length - 1) {
    return fail("OBJECT_KEY_INVALID", "Artifact objectKey lacks a safe extension.");
  }
  return filename.slice(dot + 1).toLowerCase();
}

export function artifactIntentFingerprint(intent: CanonicalArtifactUploadIntent): Sha256Digest {
  return hashCanonical(intent as unknown as JsonValue);
}

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { canonicalizeJson } from "@videoforge/contracts/canonical-json";

import type { Sha256, WorkspaceScope } from "./repositories/types.js";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const CONTENT_TYPE = /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const MAX_PORT_LIFETIME_MS = 15 * 60 * 1_000;
const MAX_ARTIFACT_BYTES = 10_737_418_240;

export type ArtifactLane = "INPUT" | "MAGE_IMAGE" | "SOULX_AVATAR" | "RENDER" | "PROVENANCE";
export type ArtifactPortMethod = "PUT" | "GET" | "DELETE";
export type ArtifactRetentionClass = "EPHEMERAL" | "PROJECT" | "FINAL" | "LEGAL_HOLD";

export interface TrustedArtifactIdentity {
  readonly scope: WorkspaceScope;
  readonly projectId: string;
  readonly projectRevisionId: string;
  readonly lane: ArtifactLane;
  readonly jobId: string;
  readonly artifactId: string;
}

export interface ArtifactReservation {
  readonly reservationId: string;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly projectRevisionId: string;
  readonly lane: ArtifactLane;
  readonly jobId: string;
  readonly artifactId: string;
  readonly objectKey: string;
  readonly method: ArtifactPortMethod;
  readonly contentType: string;
  readonly contentLength: number;
  readonly checksumSha256: Sha256;
  readonly expiresAt: string;
  readonly maxUses: number;
  readonly retentionClass: ArtifactRetentionClass;
  readonly retainUntil: string | null;
  readonly deletionOwnerAccountId: string;
}

/** Secret-bearing ephemeral capability. Persist `reservation`, never this value. */
export interface ArtifactTransferPort {
  readonly schema_version: "artifact-transfer-port/v3";
  readonly reservation_id: string;
  readonly account_id: string;
  readonly workspace_id: string;
  readonly method: ArtifactPortMethod;
  readonly path: string;
  readonly content_type: string;
  readonly content_length: number;
  readonly checksum_sha256: Sha256;
  readonly expires_at: string;
  readonly max_uses: number;
  readonly capability_handle: string;
}

/**
 * Bounded authority for an output whose bytes do not exist at dispatch time.
 *
 * This is deliberately not an `artifact-transfer-port/v3`: the exact v3 port
 * remains the only authority accepted by the object transport.  A generated
 * output authority can only be finalized once its producer has measured the
 * bytes; finalization returns the ordinary exact v3 PUT port bound to the same
 * tenant-owned path, expiry, and replay budget.
 */
export interface GeneratedArtifactOutputAuthority {
  readonly schema_version: "artifact-generated-output-authority/v1";
  readonly reservation_id: string;
  readonly account_id: string;
  readonly workspace_id: string;
  readonly method: "PUT";
  readonly path: string;
  readonly content_type: string;
  readonly max_content_length: number;
  readonly expires_at: string;
  readonly max_uses: number;
  readonly capability_handle: string;
}

export interface ArtifactCommitReceipt {
  readonly schema_version: "artifact-commit-receipt/v3";
  readonly receipt_id: string;
  readonly reservation_id: string;
  readonly account_id: string;
  readonly workspace_id: string;
  readonly object_key: string;
  readonly callback_id: string;
  readonly content_type: string;
  readonly content_length: number;
  readonly checksum_sha256: Sha256;
  readonly probe: Readonly<Record<string, boolean | number | string | null>>;
  readonly retention_class: ArtifactRetentionClass;
  readonly retain_until: string | null;
  readonly committed_at: string;
  readonly receipt_sha256: Sha256;
}

export class ArtifactPortError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ArtifactPortError";
  }
}

function checkedIdentifier(value: string, label: string): string {
  if (!IDENTIFIER.test(value)) throw new ArtifactPortError(`INVALID_${label.toUpperCase()}`);
  return value;
}

const LANE_PATH: Readonly<Record<ArtifactLane, string>> = Object.freeze({
  INPUT: "input",
  MAGE_IMAGE: "mage-image",
  SOULX_AVATAR: "soulx-avatar",
  RENDER: "render",
  PROVENANCE: "provenance",
});

/** Derives the only legal key from trusted relational identity; filenames never participate. */
export function deriveArtifactObjectKey(identity: TrustedArtifactIdentity): string {
  const accountId = checkedIdentifier(identity.scope.accountId, "account_id");
  const workspaceId = checkedIdentifier(identity.scope.workspaceId, "workspace_id");
  const projectId = checkedIdentifier(identity.projectId, "project_id");
  const revisionId = checkedIdentifier(identity.projectRevisionId, "project_revision_id");
  const jobId = checkedIdentifier(identity.jobId, "job_id");
  const artifactId = checkedIdentifier(identity.artifactId, "artifact_id");
  return `tenant/${accountId}/workspace/${workspaceId}/project/${projectId}/revision/${revisionId}/lane/${LANE_PATH[identity.lane]}/job/${jobId}/artifact/${artifactId}`;
}

function digest(bytes: Uint8Array): Sha256 {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function canonical(value: object): string {
  return canonicalizeJson(value);
}

interface StoredObject {
  readonly ownerAccountId: string;
  readonly ownerWorkspaceId: string;
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly checksumSha256: Sha256;
  committed: boolean;
  deleted: boolean;
}

interface ReservationState {
  readonly reservation: ArtifactReservation;
  uses: number;
  readonly callbacks: Map<string, ArtifactCommitReceipt>;
  receipt: ArtifactCommitReceipt | null;
  revoked: boolean;
}

interface GeneratedReservationState {
  readonly authority: GeneratedArtifactOutputAuthority;
  readonly identity: TrustedArtifactIdentity;
  readonly retentionClass: ArtifactRetentionClass;
  readonly retainUntil: string | null;
  finalizedPort: ArtifactTransferPort | null;
  revoked: boolean;
}

export interface ReservePortOptions {
  readonly contentType: string;
  readonly contentLength: number;
  readonly checksumSha256: Sha256;
  readonly now: Date;
  readonly lifetimeMs?: number;
  readonly maxUses?: number;
  readonly retentionClass: ArtifactRetentionClass;
  readonly retainUntil?: string | null;
}

export interface ReserveGeneratedOutputOptions {
  readonly contentType: string;
  /** Hard upper bound checked before an exact port can be issued. */
  readonly maxContentLength: number;
  readonly now: Date;
  readonly lifetimeMs?: number;
  readonly maxUses?: number;
  readonly retentionClass: ArtifactRetentionClass;
  readonly retainUntil?: string | null;
}

export interface FinalizeGeneratedOutputOptions {
  readonly contentLength: number;
  readonly checksumSha256: Sha256;
  readonly now: Date;
}

/** Provider-free exact-port adapter. It exposes no list, copy, move, or global hash API. */
export class FakeR2ArtifactPlane {
  readonly #secret: Uint8Array;
  readonly #reservations = new Map<string, ReservationState>();
  readonly #generatedReservations = new Map<string, GeneratedReservationState>();
  readonly #objects = new Map<string, StoredObject>();

  constructor(secret: Uint8Array) {
    if (secret.byteLength < 32) throw new ArtifactPortError("CAPABILITY_SECRET_TOO_SHORT");
    this.#secret = secret.slice();
  }

  reserveUpload(
    identity: TrustedArtifactIdentity,
    options: ReservePortOptions,
  ): ArtifactTransferPort {
    return this.#reserve(identity, "PUT", options);
  }

  /**
   * Reserve a bounded generated-output slot without pretending to know the
   * output bytes.  Only a later `finalizeGeneratedUpload` call can mint the
   * exact v3 PUT port used by `upload`.
   */
  reserveGeneratedUpload(
    identity: TrustedArtifactIdentity,
    options: ReserveGeneratedOutputOptions,
  ): GeneratedArtifactOutputAuthority {
    if (!CONTENT_TYPE.test(options.contentType))
      throw new ArtifactPortError("CONTENT_TYPE_INVALID");
    if (
      !Number.isSafeInteger(options.maxContentLength) ||
      options.maxContentLength < 1 ||
      options.maxContentLength > MAX_ARTIFACT_BYTES
    )
      throw new ArtifactPortError("GENERATED_OUTPUT_MAX_LENGTH_INVALID");
    const lifetimeMs = options.lifetimeMs ?? 5 * 60 * 1_000;
    if (!Number.isSafeInteger(lifetimeMs) || lifetimeMs < 1 || lifetimeMs > MAX_PORT_LIFETIME_MS)
      throw new ArtifactPortError("PORT_LIFETIME_INVALID");
    const maxUses = options.maxUses ?? 1;
    if (!Number.isSafeInteger(maxUses) || maxUses < 1 || maxUses > 3)
      throw new ArtifactPortError("PORT_REPLAY_BOUND_INVALID");
    const objectKey = deriveArtifactObjectKey(identity);
    const expiresAt = new Date(options.now.getTime() + lifetimeMs).toISOString();
    const seed = canonical({
      schemaVersion: "artifact-generated-output-authority/v1",
      accountId: identity.scope.accountId,
      workspaceId: identity.scope.workspaceId,
      objectKey,
      method: "PUT",
      contentType: options.contentType,
      maxContentLength: options.maxContentLength,
      expiresAt,
      maxUses,
    });
    const reservationId = `gen_${createHash("sha256").update(seed).digest("hex").slice(0, 40)}`;
    if (this.#generatedReservations.has(reservationId) || this.#reservations.has(reservationId))
      throw new ArtifactPortError("RESERVATION_EXISTS");
    const authorityBody = {
      schema_version: "artifact-generated-output-authority/v1" as const,
      reservation_id: reservationId,
      account_id: identity.scope.accountId,
      workspace_id: identity.scope.workspaceId,
      method: "PUT" as const,
      path: `/${objectKey}`,
      content_type: options.contentType,
      max_content_length: options.maxContentLength,
      expires_at: expiresAt,
      max_uses: maxUses,
    };
    const capabilityHandle = createHmac("sha256", this.#secret)
      .update(canonical(authorityBody))
      .digest("hex");
    const authority: GeneratedArtifactOutputAuthority = Object.freeze({
      ...authorityBody,
      capability_handle: capabilityHandle,
    });
    const identitySnapshot: TrustedArtifactIdentity = Object.freeze({
      scope: Object.freeze({
        accountId: identity.scope.accountId,
        workspaceId: identity.scope.workspaceId,
      }) as WorkspaceScope,
      projectId: identity.projectId,
      projectRevisionId: identity.projectRevisionId,
      lane: identity.lane,
      jobId: identity.jobId,
      artifactId: identity.artifactId,
    });
    this.#generatedReservations.set(reservationId, {
      authority,
      identity: identitySnapshot,
      retentionClass: options.retentionClass,
      retainUntil: options.retainUntil ?? null,
      finalizedPort: null,
      revoked: false,
    });
    return authority;
  }

  reserveDownload(
    identity: TrustedArtifactIdentity,
    options: ReservePortOptions,
  ): ArtifactTransferPort {
    const stored = this.#ownedObject(identity.scope, deriveArtifactObjectKey(identity));
    if (!stored.committed || stored.deleted) throw new ArtifactPortError("ARTIFACT_NOT_FOUND");
    if (
      stored.contentType !== options.contentType ||
      stored.bytes.byteLength !== options.contentLength ||
      stored.checksumSha256 !== options.checksumSha256
    ) {
      throw new ArtifactPortError("ARTIFACT_NOT_FOUND");
    }
    return this.#reserve(identity, "GET", options);
  }

  reserveDelete(
    identity: TrustedArtifactIdentity,
    options: ReservePortOptions,
  ): ArtifactTransferPort {
    this.#ownedObject(identity.scope, deriveArtifactObjectKey(identity));
    return this.#reserve(identity, "DELETE", { ...options, maxUses: 1 });
  }

  #reserve(
    identity: TrustedArtifactIdentity,
    method: ArtifactPortMethod,
    options: ReservePortOptions,
  ): ArtifactTransferPort {
    if (!CONTENT_TYPE.test(options.contentType))
      throw new ArtifactPortError("CONTENT_TYPE_INVALID");
    if (!Number.isSafeInteger(options.contentLength) || options.contentLength < 0)
      throw new ArtifactPortError("CONTENT_LENGTH_INVALID");
    if (!SHA256.test(options.checksumSha256)) throw new ArtifactPortError("CHECKSUM_INVALID");
    const lifetimeMs = options.lifetimeMs ?? 5 * 60 * 1_000;
    if (!Number.isSafeInteger(lifetimeMs) || lifetimeMs < 1 || lifetimeMs > MAX_PORT_LIFETIME_MS)
      throw new ArtifactPortError("PORT_LIFETIME_INVALID");
    const maxUses = options.maxUses ?? 1;
    if (!Number.isSafeInteger(maxUses) || maxUses < 1 || maxUses > 3)
      throw new ArtifactPortError("PORT_REPLAY_BOUND_INVALID");
    const objectKey = deriveArtifactObjectKey(identity);
    const expiresAt = new Date(options.now.getTime() + lifetimeMs).toISOString();
    const seed = canonical({
      accountId: identity.scope.accountId,
      workspaceId: identity.scope.workspaceId,
      objectKey,
      method,
      checksum: options.checksumSha256,
      expiresAt,
    });
    const reservationId = `art_${createHash("sha256").update(seed).digest("hex").slice(0, 40)}`;
    const reservation: ArtifactReservation = Object.freeze({
      reservationId,
      accountId: identity.scope.accountId,
      workspaceId: identity.scope.workspaceId,
      projectId: identity.projectId,
      projectRevisionId: identity.projectRevisionId,
      lane: identity.lane,
      jobId: identity.jobId,
      artifactId: identity.artifactId,
      objectKey,
      method,
      contentType: options.contentType,
      contentLength: options.contentLength,
      checksumSha256: options.checksumSha256,
      expiresAt,
      maxUses,
      retentionClass: options.retentionClass,
      retainUntil: options.retainUntil ?? null,
      deletionOwnerAccountId: identity.scope.accountId,
    });
    if (this.#reservations.has(reservationId)) throw new ArtifactPortError("RESERVATION_EXISTS");
    this.#reservations.set(reservationId, {
      reservation,
      uses: 0,
      callbacks: new Map(),
      receipt: null,
      revoked: false,
    });
    const capability = createHmac("sha256", this.#secret)
      .update(canonical(reservation))
      .digest("hex");
    return Object.freeze({
      schema_version: "artifact-transfer-port/v3",
      reservation_id: reservation.reservationId,
      account_id: reservation.accountId,
      workspace_id: reservation.workspaceId,
      method,
      path: `/${objectKey}`,
      content_type: options.contentType,
      content_length: options.contentLength,
      checksum_sha256: options.checksumSha256,
      expires_at: expiresAt,
      max_uses: maxUses,
      capability_handle: capability,
    });
  }

  /**
   * Finalize one generated-output authority into an exact v3 PUT port.
   *
   * The caller supplies facts observed from the generated bytes.  Those facts
   * are still checked again by `upload`, so a forged finalize request cannot
   * cause a mismatched object to be accepted.  Repeating the same finalize is
   * idempotent; changing the facts or scope is rejected.
   */
  finalizeGeneratedUpload(
    authority: GeneratedArtifactOutputAuthority,
    options: FinalizeGeneratedOutputOptions,
  ): ArtifactTransferPort {
    const state = this.#authorizeGenerated(authority);
    if (state.revoked) throw new ArtifactPortError("ARTIFACT_NOT_FOUND");
    if (options.now.getTime() >= Date.parse(state.authority.expires_at))
      throw new ArtifactPortError("PORT_EXPIRED");
    if (
      !Number.isSafeInteger(options.contentLength) ||
      options.contentLength < 1 ||
      options.contentLength > state.authority.max_content_length
    )
      throw new ArtifactPortError("GENERATED_OUTPUT_LENGTH_INVALID");
    if (!SHA256.test(options.checksumSha256))
      throw new ArtifactPortError("GENERATED_OUTPUT_CHECKSUM_INVALID");
    if (state.finalizedPort !== null) {
      if (
        state.finalizedPort.content_length !== options.contentLength ||
        state.finalizedPort.checksum_sha256 !== options.checksumSha256
      )
        throw new ArtifactPortError("GENERATED_OUTPUT_ALREADY_FINALIZED");
      return state.finalizedPort;
    }

    const identity = state.identity;
    const reservation: ArtifactReservation = Object.freeze({
      reservationId: state.authority.reservation_id,
      accountId: identity.scope.accountId,
      workspaceId: identity.scope.workspaceId,
      projectId: identity.projectId,
      projectRevisionId: identity.projectRevisionId,
      lane: identity.lane,
      jobId: identity.jobId,
      artifactId: identity.artifactId,
      objectKey: state.authority.path.slice(1),
      method: "PUT",
      contentType: state.authority.content_type,
      contentLength: options.contentLength,
      checksumSha256: options.checksumSha256,
      expiresAt: state.authority.expires_at,
      maxUses: state.authority.max_uses,
      retentionClass: state.retentionClass,
      retainUntil: state.retainUntil,
      deletionOwnerAccountId: identity.scope.accountId,
    });
    if (this.#reservations.has(reservation.reservationId))
      throw new ArtifactPortError("RESERVATION_EXISTS");
    const capabilityHandle = createHmac("sha256", this.#secret)
      .update(canonical(reservation))
      .digest("hex");
    const port: ArtifactTransferPort = Object.freeze({
      schema_version: "artifact-transfer-port/v3",
      reservation_id: reservation.reservationId,
      account_id: reservation.accountId,
      workspace_id: reservation.workspaceId,
      method: "PUT",
      path: state.authority.path,
      content_type: reservation.contentType,
      content_length: reservation.contentLength,
      checksum_sha256: reservation.checksumSha256,
      expires_at: reservation.expiresAt,
      max_uses: reservation.maxUses,
      capability_handle: capabilityHandle,
    });
    this.#reservations.set(reservation.reservationId, {
      reservation,
      uses: 0,
      callbacks: new Map(),
      receipt: null,
      revoked: false,
    });
    state.finalizedPort = port;
    return port;
  }

  #authorizeGenerated(authority: GeneratedArtifactOutputAuthority): GeneratedReservationState {
    const state = this.#generatedReservations.get(authority.reservation_id);
    if (state === undefined || state.revoked)
      throw new ArtifactPortError("ARTIFACT_NOT_FOUND");
    const expected = createHmac("sha256", this.#secret)
      .update(
        canonical({
          schema_version: "artifact-generated-output-authority/v1",
          reservation_id: state.authority.reservation_id,
          account_id: state.authority.account_id,
          workspace_id: state.authority.workspace_id,
          method: state.authority.method,
          path: state.authority.path,
          content_type: state.authority.content_type,
          max_content_length: state.authority.max_content_length,
          expires_at: state.authority.expires_at,
          max_uses: state.authority.max_uses,
        }),
      )
      .digest();
    let supplied: Buffer;
    try {
      supplied = Buffer.from(authority.capability_handle, "hex");
    } catch {
      throw new ArtifactPortError("ARTIFACT_NOT_FOUND");
    }
    if (supplied.byteLength !== expected.byteLength || !timingSafeEqual(supplied, expected))
      throw new ArtifactPortError("ARTIFACT_NOT_FOUND");
    if (
      authority.schema_version !== "artifact-generated-output-authority/v1" ||
      authority.reservation_id !== state.authority.reservation_id ||
      authority.account_id !== state.authority.account_id ||
      authority.workspace_id !== state.authority.workspace_id ||
      authority.method !== "PUT" ||
      authority.path !== state.authority.path ||
      authority.content_type !== state.authority.content_type ||
      authority.max_content_length !== state.authority.max_content_length ||
      authority.expires_at !== state.authority.expires_at ||
      authority.max_uses !== state.authority.max_uses
    )
      throw new ArtifactPortError("ARTIFACT_NOT_FOUND");
    return state;
  }

  #authorize(
    port: ArtifactTransferPort,
    request: {
      readonly method: ArtifactPortMethod;
      readonly path: string;
      readonly contentType: string;
      readonly contentLength: number;
      readonly checksumSha256: Sha256;
      readonly now: Date;
    },
  ): ReservationState {
    const state = this.#reservations.get(port.reservation_id);
    if (state === undefined || state.revoked) throw new ArtifactPortError("ARTIFACT_NOT_FOUND");
    const expected = createHmac("sha256", this.#secret)
      .update(canonical(state.reservation))
      .digest();
    const supplied = Buffer.from(port.capability_handle, "hex");
    if (supplied.byteLength !== expected.byteLength || !timingSafeEqual(supplied, expected))
      throw new ArtifactPortError("ARTIFACT_NOT_FOUND");
    if (
      port.schema_version !== "artifact-transfer-port/v3" ||
      port.account_id !== state.reservation.accountId ||
      port.workspace_id !== state.reservation.workspaceId ||
      port.method !== state.reservation.method ||
      port.path !== `/${state.reservation.objectKey}` ||
      port.content_type !== state.reservation.contentType ||
      port.content_length !== state.reservation.contentLength ||
      port.checksum_sha256 !== state.reservation.checksumSha256 ||
      port.expires_at !== state.reservation.expiresAt ||
      port.max_uses !== state.reservation.maxUses
    )
      throw new ArtifactPortError("ARTIFACT_NOT_FOUND");
    if (request.now.getTime() >= Date.parse(state.reservation.expiresAt))
      throw new ArtifactPortError("PORT_EXPIRED");
    if (state.uses >= state.reservation.maxUses) throw new ArtifactPortError("PORT_REPLAYED");
    if (
      request.method !== state.reservation.method ||
      request.path !== `/${state.reservation.objectKey}` ||
      request.contentType !== state.reservation.contentType ||
      request.contentLength !== state.reservation.contentLength ||
      request.checksumSha256 !== state.reservation.checksumSha256
    )
      throw new ArtifactPortError("PORT_SCOPE_MISMATCH");
    state.uses += 1;
    return state;
  }

  upload(
    port: ArtifactTransferPort,
    request: {
      readonly path: string;
      readonly contentType: string;
      readonly contentLength: number;
      readonly checksumSha256: Sha256;
      readonly body: Uint8Array;
      readonly now: Date;
    },
  ): void {
    const state = this.#authorize(port, { ...request, method: "PUT" });
    if (request.body.byteLength !== request.contentLength)
      throw new ArtifactPortError("LENGTH_MISMATCH");
    if (digest(request.body) !== request.checksumSha256)
      throw new ArtifactPortError("HASH_MISMATCH");
    const existing = this.#objects.get(state.reservation.objectKey);
    if (existing !== undefined && !existing.deleted)
      throw new ArtifactPortError("ARTIFACT_ALREADY_EXISTS");
    this.#objects.set(state.reservation.objectKey, {
      ownerAccountId: state.reservation.accountId,
      ownerWorkspaceId: state.reservation.workspaceId,
      bytes: request.body.slice(),
      contentType: request.contentType,
      checksumSha256: request.checksumSha256,
      committed: false,
      deleted: false,
    });
  }

  commitUpload(
    scope: WorkspaceScope,
    reservationId: string,
    callbackId: string,
    probe: Readonly<Record<string, boolean | number | string | null>>,
    now: Date,
  ): ArtifactCommitReceipt {
    const state = this.#reservations.get(reservationId);
    if (
      state === undefined ||
      state.reservation.accountId !== scope.accountId ||
      state.reservation.workspaceId !== scope.workspaceId
    )
      throw new ArtifactPortError("ARTIFACT_NOT_FOUND");
    const prior = state.callbacks.get(callbackId);
    if (prior !== undefined) return prior;
    if (state.receipt !== null) throw new ArtifactPortError("DUPLICATE_CALLBACK");
    if (now.getTime() >= Date.parse(state.reservation.expiresAt))
      throw new ArtifactPortError("STALE_RECEIPT");
    const stored = this.#ownedObject(scope, state.reservation.objectKey);
    if (stored.committed || stored.deleted) throw new ArtifactPortError("STALE_RECEIPT");
    const receiptBody = {
      reservation_id: reservationId,
      account_id: scope.accountId,
      workspace_id: scope.workspaceId,
      object_key: state.reservation.objectKey,
      callback_id: checkedIdentifier(callbackId, "callback_id"),
      content_type: stored.contentType,
      content_length: stored.bytes.byteLength,
      checksum_sha256: stored.checksumSha256,
      probe,
      retention_class: state.reservation.retentionClass,
      retain_until: state.reservation.retainUntil,
      committed_at: now.toISOString(),
    };
    const receiptSha256 = digest(new TextEncoder().encode(canonical(receiptBody)));
    const receipt: ArtifactCommitReceipt = Object.freeze({
      schema_version: "artifact-commit-receipt/v3",
      receipt_id: `receipt_${receiptSha256.slice(7, 47)}`,
      ...receiptBody,
      receipt_sha256: receiptSha256,
    });
    stored.committed = true;
    state.receipt = receipt;
    state.callbacks.set(callbackId, receipt);
    return receipt;
  }

  download(
    port: ArtifactTransferPort,
    request: {
      readonly path: string;
      readonly contentType: string;
      readonly contentLength: number;
      readonly checksumSha256: Sha256;
      readonly now: Date;
    },
  ): Uint8Array {
    const state = this.#authorize(port, { ...request, method: "GET" });
    const stored = this.#objects.get(state.reservation.objectKey);
    if (stored === undefined || !stored.committed || stored.deleted)
      throw new ArtifactPortError("ARTIFACT_NOT_FOUND");
    return stored.bytes.slice();
  }

  delete(
    scope: WorkspaceScope,
    port: ArtifactTransferPort,
    request: {
      readonly path: string;
      readonly contentType: string;
      readonly contentLength: number;
      readonly checksumSha256: Sha256;
      readonly now: Date;
    },
  ): void {
    const state = this.#authorize(port, { ...request, method: "DELETE" });
    if (state.reservation.deletionOwnerAccountId !== scope.accountId)
      throw new ArtifactPortError("ARTIFACT_NOT_FOUND");
    if (
      state.reservation.retentionClass === "LEGAL_HOLD" ||
      (state.reservation.retainUntil !== null &&
        request.now.getTime() < Date.parse(state.reservation.retainUntil))
    )
      throw new ArtifactPortError("RETENTION_ACTIVE");
    this.#ownedObject(scope, state.reservation.objectKey).deleted = true;
  }

  revoke(scope: WorkspaceScope, reservationId: string): void {
    const generated = this.#generatedReservations.get(reservationId);
    if (generated !== undefined) {
      if (
        generated.authority.account_id !== scope.accountId ||
        generated.authority.workspace_id !== scope.workspaceId
      )
        throw new ArtifactPortError("ARTIFACT_NOT_FOUND");
      generated.revoked = true;
      if (generated.finalizedPort !== null) {
        const finalized = this.#reservations.get(reservationId);
        if (finalized !== undefined) finalized.revoked = true;
      }
      return;
    }
    const state = this.#reservations.get(reservationId);
    if (
      state === undefined ||
      state.reservation.accountId !== scope.accountId ||
      state.reservation.workspaceId !== scope.workspaceId
    )
      throw new ArtifactPortError("ARTIFACT_NOT_FOUND");
    state.revoked = true;
  }

  cleanupOrphans(now: Date): number {
    let removed = 0;
    for (const [key, stored] of this.#objects) {
      const state = [...this.#reservations.values()].find(
        (candidate) =>
          candidate.reservation.objectKey === key && candidate.reservation.method === "PUT",
      );
      if (
        !stored.committed &&
        state !== undefined &&
        now.getTime() >= Date.parse(state.reservation.expiresAt)
      ) {
        this.#objects.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  #ownedObject(scope: WorkspaceScope, objectKey: string): StoredObject {
    const stored = this.#objects.get(objectKey);
    if (
      stored === undefined ||
      stored.ownerAccountId !== scope.accountId ||
      stored.ownerWorkspaceId !== scope.workspaceId
    )
      throw new ArtifactPortError("ARTIFACT_NOT_FOUND");
    return stored;
  }
}

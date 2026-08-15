import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { canonicalizeJson } from "@videoforge/contracts/canonical-json";

import type { Sha256, WorkspaceScope } from "./repositories/types.js";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const CONTENT_TYPE = /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const MAX_PORT_LIFETIME_MS = 15 * 60 * 1_000;

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
  readonly schemaVersion: "artifact-transfer-port/v3";
  readonly reservation: ArtifactReservation;
  readonly method: ArtifactPortMethod;
  readonly path: string;
  readonly contentType: string;
  readonly contentLength: number;
  readonly checksumSha256: Sha256;
  readonly expiresAt: string;
  readonly maxUses: number;
  readonly capability: string;
}

export interface ArtifactCommitReceipt {
  readonly schemaVersion: "artifact-commit-receipt/v3";
  readonly receiptId: string;
  readonly reservationId: string;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly objectKey: string;
  readonly callbackId: string;
  readonly contentType: string;
  readonly contentLength: number;
  readonly checksumSha256: Sha256;
  readonly probe: Readonly<Record<string, boolean | number | string | null>>;
  readonly committedAt: string;
  readonly receiptSha256: Sha256;
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

/** Provider-free exact-port adapter. It exposes no list, copy, move, or global hash API. */
export class FakeR2ArtifactPlane {
  readonly #secret: Uint8Array;
  readonly #reservations = new Map<string, ReservationState>();
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
      schemaVersion: "artifact-transfer-port/v3",
      reservation,
      method,
      path: `/${objectKey}`,
      contentType: options.contentType,
      contentLength: options.contentLength,
      checksumSha256: options.checksumSha256,
      expiresAt,
      maxUses,
      capability,
    });
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
    const state = this.#reservations.get(port.reservation.reservationId);
    if (state === undefined || state.reservation !== port.reservation || state.revoked)
      throw new ArtifactPortError("ARTIFACT_NOT_FOUND");
    const expected = createHmac("sha256", this.#secret)
      .update(canonical(state.reservation))
      .digest();
    const supplied = Buffer.from(port.capability, "hex");
    if (supplied.byteLength !== expected.byteLength || !timingSafeEqual(supplied, expected))
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
      reservationId,
      accountId: scope.accountId,
      workspaceId: scope.workspaceId,
      objectKey: state.reservation.objectKey,
      callbackId: checkedIdentifier(callbackId, "callback_id"),
      contentType: stored.contentType,
      contentLength: stored.bytes.byteLength,
      checksumSha256: stored.checksumSha256,
      probe,
      committedAt: now.toISOString(),
    };
    const receiptSha256 = digest(new TextEncoder().encode(canonical(receiptBody)));
    const receipt: ArtifactCommitReceipt = Object.freeze({
      schemaVersion: "artifact-commit-receipt/v3",
      receiptId: `receipt_${receiptSha256.slice(7, 47)}`,
      ...receiptBody,
      receiptSha256,
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

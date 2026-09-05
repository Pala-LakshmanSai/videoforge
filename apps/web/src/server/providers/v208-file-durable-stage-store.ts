import { constants as fsConstants } from "node:fs";
import {
  chmodSync,
  closeSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { canonicalizeJson, type JsonValue } from "@videoforge/contracts";

import type {
  V213DurableOperationRecord,
  V213DurableStageStore,
  V213SignedStageAuthority,
  V213Stage,
  V213StageConsumptionRecord,
  V213OperationKind,
} from "./v213-dual-lane-live.js";
import type { V213CleanupStageRead } from "./v213-runpod-dual-lane-transport.js";
import type {
  V213QualificationMaterializationRequest,
  V213QualificationMaterializationRouteResult,
  V213QualificationMaterializationStore,
} from "../hosted/v213-qualification-materializer.js";

/**
 * Provider-free, process-local durability for the one-shot V2-08 qualification.
 *
 * This module deliberately has no database, provider, credential, or network dependency.  The
 * caller supplies a signer callback, but the store never loads a key or persists a secret.  The
 * journal directory is private and contains only canonical JSON files and a short-lived lock.
 */

export const V208_FILE_DURABLE_STAGE_STORE_SCHEMA =
  "videoforge.v208-file-durable-stage-store/v1" as const;
export const V208_FILE_DURABLE_STAGE_MANIFEST_SCHEMA =
  "videoforge.v208-file-authority-manifest/v1" as const;
export const V208_FILE_DURABLE_MATERIALIZATION_SCHEMA =
  "videoforge.v208-file-materialization-state/v1" as const;
export const V208_FILE_DURABLE_STAGE_STATE_SCHEMA = "videoforge.v208-file-stage-state/v1" as const;
export const V208_FILE_DURABLE_MANIFEST_FILENAME = "authority-manifest.json" as const;
export const V208_FILE_DURABLE_STAGE_STATE_FILENAME = "stage-state.json" as const;
export const V208_FILE_DURABLE_MATERIALIZATION_STATE_FILENAME =
  "materialization-state.json" as const;
export const V208_FILE_DURABLE_LOCK_FILENAME = "store.lock" as const;
export const V208_FILE_DURABLE_DIRECTORY_MODE = 0o700 as const;
export const V208_FILE_DURABLE_FILE_MODE = 0o600 as const;

const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const COMMIT = /^[a-f0-9]{40}$/u;
const IMAGE = /^ghcr\.io\/[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,190}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const LOCK_CLAIM_FILENAME = new RegExp(
  `^${V208_FILE_DURABLE_LOCK_FILENAME.replace(".", "\\.")}\\.([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$`,
  "u",
);
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/u;
const SOULX_DISPATCH_RESOURCE = /^(?:v208|v213)-soulx-[A-Za-z0-9][A-Za-z0-9_.:-]{0,190}$/u;
const SOULX_JOB_RESOURCE = /^sha256:[a-f0-9]{64}:[A-Za-z0-9][A-Za-z0-9_.:-]{0,190}$/u;
const SOULX_STATUS_RESOURCE =
  /^sha256:[a-f0-9]{64}:[A-Za-z0-9][A-Za-z0-9_.:-]{0,190}(?::[-]?[0-9]+)?$/u;
const SOULX_PHASE_RESOURCE =
  /^sha256:[a-f0-9]{64}:v208-phase-[A-Za-z0-9][A-Za-z0-9_.:-]{0,190}:0$/u;
const GENESIS: `sha256:${string}` = `sha256:${"0".repeat(64)}`;

export class V208FileDurableStageStoreError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "V208FileDurableStageStoreError";
    this.code = code;
  }
}

export interface V208FileAuthorityManifest {
  readonly schemaVersion: typeof V208_FILE_DURABLE_STAGE_MANIFEST_SCHEMA;
  readonly checkpoint: "V2-08";
  readonly stage: 7;
  readonly proposalSha256: `sha256:${string}`;
  readonly authoritySha256: `sha256:${string}`;
  readonly image: string;
  readonly sourceCommit: string;
  readonly planSha256: `sha256:${string}`;
}

export type V208FileStageAuthoritySigner = (
  authority: Omit<V213SignedStageAuthority, "signatureBase64">,
) => string | Promise<string>;

export interface V208FileDurableStageStoreOptions {
  /** Exact absolute directory reserved for this qualification journal. */
  readonly journalDirectory: string;
  /** Immutable authority binding persisted before any stage operation. */
  readonly manifest: V208FileAuthorityManifest;
  /** Signing is supplied by the caller; this module never reads credentials. */
  readonly signAuthority?: V208FileStageAuthoritySigner;
  readonly now?: () => Date;
  readonly nonce?: () => string;
}

export interface V208FileDurableStageSnapshot {
  readonly schemaVersion: typeof V208_FILE_DURABLE_STAGE_STATE_SCHEMA;
  readonly manifestSha256: `sha256:${string}`;
  readonly revision: number;
  readonly previousStateSha256: `sha256:${string}`;
  readonly stageAuthority: V208StoredStageAuthority | null;
  readonly operations: readonly V208StoredOperationRecord[];
  readonly stateSha256: `sha256:${string}`;
}

export interface V208FileMaterializationSnapshot {
  readonly schemaVersion: typeof V208_FILE_DURABLE_MATERIALIZATION_SCHEMA;
  readonly manifestSha256: `sha256:${string}`;
  readonly revision: number;
  readonly previousStateSha256: `sha256:${string}`;
  readonly entries: readonly V208StoredMaterialization[];
  readonly stateSha256: `sha256:${string}`;
}

export interface V208StoredStageAuthority {
  readonly status: "ISSUED" | "CLAIMED" | "DONE";
  readonly authority: V213SignedStageAuthority;
  readonly claim: Readonly<{
    readonly nonceSha256: `sha256:${string}`;
    readonly consumedAt: string;
  }> | null;
  readonly handoff: Readonly<{
    readonly handoffSha256: `sha256:${string}`;
    readonly handoff: JsonValue;
  }> | null;
}

export interface V208StoredOperationRecord {
  readonly operationId: string;
  readonly stageAuthorityId: string;
  readonly kind: V213OperationKind;
  readonly requestSha256: `sha256:${string}`;
  readonly resourceKey: string;
  readonly state: V213DurableOperationRecord["state"];
  readonly providerId: string | null;
  readonly evidence: JsonValue | null;
}

export interface V208StoredMaterialization {
  readonly requestSha256: `sha256:${string}`;
  readonly request: V213QualificationMaterializationRequest;
  readonly status: "CLAIMED" | "PERSISTED";
  readonly result: V213QualificationMaterializationRouteResult | null;
}

type StoredStageStateCore = Omit<V208FileDurableStageSnapshot, "stateSha256">;
type StoredMaterializationStateCore = Omit<V208FileMaterializationSnapshot, "stateSha256">;

interface LockHandle {
  readonly path: string;
  readonly pid: number;
  readonly token: string;
  readonly device: number;
  readonly inode: number;
}

interface LockObservation extends LockHandle {
  readonly size: number;
  readonly modifiedAtMs: number;
}

interface MaterializationIdentity {
  readonly requestSha256: `sha256:${string}`;
  readonly request: V213QualificationMaterializationRequest;
}

function fail(code: string): never {
  throw new V208FileDurableStageStoreError(code);
}

function canonicalBytes(value: unknown): Buffer {
  try {
    return Buffer.from(`${canonicalizeJson(value as JsonValue)}\n`, "utf8");
  } catch {
    fail("V208_FILE_DURABLE_JSON_INVALID");
  }
}

function sha256Bytes(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function hashCanonical(value: unknown): `sha256:${string}` {
  // Contract hashes in the V2 protocol cover RFC 8785 bytes exactly.  The journal's trailing
  // newline is a file framing detail and must not become part of request/result/authority hashes.
  return sha256Bytes(Buffer.from(canonicalizeJson(value as JsonValue), "utf8"));
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function exactKeys(value: object, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function assertAbsoluteJournalDirectory(directory: string): string {
  if (
    typeof directory !== "string" ||
    directory.length < 2 ||
    !isAbsolute(directory) ||
    directory.includes("\0") ||
    resolve(directory) !== directory ||
    directory === "/"
  )
    fail("V208_FILE_DURABLE_JOURNAL_DIRECTORY_INVALID");
  return directory;
}

function modeOf(path: string, code: string): number {
  let status;
  try {
    status = lstatSync(path);
  } catch {
    fail(code);
  }
  if (status.isSymbolicLink()) fail(`${code}_SYMLINK`);
  return status.mode;
}

function assertPrivateDirectory(path: string, code: string): void {
  const mode = modeOf(path, code);
  let status;
  try {
    status = lstatSync(path);
  } catch {
    fail(code);
  }
  if (!status.isDirectory() || (mode & 0o7777) !== V208_FILE_DURABLE_DIRECTORY_MODE)
    fail(`${code}_MODE_INVALID`);
}

function assertPrivateFile(path: string, code: string): void {
  const mode = modeOf(path, code);
  let status;
  try {
    status = lstatSync(path);
  } catch {
    fail(code);
  }
  if (!status.isFile() || (mode & 0o7777) !== V208_FILE_DURABLE_FILE_MODE)
    fail(`${code}_MODE_INVALID`);
}

function exists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function syncDirectory(directory: string, code: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(directory, fsConstants.O_RDONLY);
    fsyncSync(descriptor);
  } catch {
    fail(code);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function ensureJournalDirectory(directory: string): void {
  if (!exists(directory)) {
    try {
      mkdirSync(directory, { mode: V208_FILE_DURABLE_DIRECTORY_MODE, recursive: true });
      chmodSync(directory, V208_FILE_DURABLE_DIRECTORY_MODE);
      syncDirectory(dirname(directory), "V208_FILE_DURABLE_PARENT_SYNC_FAILED");
    } catch (error) {
      if (error instanceof V208FileDurableStageStoreError) throw error;
      fail("V208_FILE_DURABLE_JOURNAL_DIRECTORY_CREATE_FAILED");
    }
  }
  assertPrivateDirectory(directory, "V208_FILE_DURABLE_JOURNAL_DIRECTORY");
}

function readCanonicalFile<T>(path: string, code: string): T {
  assertPrivateFile(path, code);
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch {
    fail(`${code}_READ_FAILED`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    fail(`${code}_JSON_INVALID`);
  }
  if (!bytes.equals(canonicalBytes(parsed))) fail(`${code}_NON_CANONICAL`);
  return parsed as T;
}

function temporaryPath(path: string, label: string): string {
  return join(dirname(path), `.${label}.${process.pid}.${randomBytes(12).toString("hex")}.tmp`);
}

function writeImmutable(path: string, bytes: Buffer, code: string): void {
  assertPrivateDirectory(dirname(path), `${code}_DIRECTORY`);
  if (exists(path)) {
    assertPrivateFile(path, code);
    if (!readFileSync(path).equals(bytes)) fail(`${code}_IMMUTABLE_DRIFT`);
    return;
  }
  const temporary = temporaryPath(path, "v208-immutable");
  let descriptor: number | undefined;
  let linked = false;
  try {
    const flags =
      fsConstants.O_WRONLY |
      fsConstants.O_CREAT |
      fsConstants.O_EXCL |
      (fsConstants.O_NOFOLLOW ?? 0);
    descriptor = openSync(temporary, flags, V208_FILE_DURABLE_FILE_MODE);
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    chmodSync(temporary, V208_FILE_DURABLE_FILE_MODE);
    try {
      // Hard-linking avoids a rename overwrite race and gives the manifest a create-only CAS.
      linkSync(temporary, path);
      linked = true;
      syncDirectory(dirname(path), `${code}_DIRECTORY_SYNC_FAILED`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (!exists(path)) throw error;
      assertPrivateFile(path, code);
      if (!readFileSync(path).equals(bytes)) fail(`${code}_IMMUTABLE_DRIFT`);
    }
    assertPrivateFile(path, code);
    if (!readFileSync(path).equals(bytes)) fail(`${code}_READBACK_DRIFT`);
  } catch (error) {
    if (error instanceof V208FileDurableStageStoreError) throw error;
    fail(`${code}_WRITE_FAILED`);
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // Preserve the primary error.
      }
    }
    try {
      unlinkSync(temporary);
    } catch {
      // A failed link leaves no durable final file; a successful link leaves only the final inode.
    }
    if (linked) syncDirectory(dirname(path), `${code}_FINAL_DIRECTORY_SYNC_FAILED`);
  }
}

function writeAtomicCas(path: string, currentBytes: Buffer, nextBytes: Buffer, code: string): void {
  assertPrivateFile(path, code);
  const observed = readFileSync(path);
  if (!observed.equals(currentBytes)) fail(`${code}_CAS_FAILED`);
  if (observed.equals(nextBytes)) return;
  const temporary = temporaryPath(path, "v208-cas");
  let descriptor: number | undefined;
  let renamed = false;
  try {
    const flags =
      fsConstants.O_WRONLY |
      fsConstants.O_CREAT |
      fsConstants.O_EXCL |
      (fsConstants.O_NOFOLLOW ?? 0);
    descriptor = openSync(temporary, flags, V208_FILE_DURABLE_FILE_MODE);
    writeFileSync(descriptor, nextBytes);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    chmodSync(temporary, V208_FILE_DURABLE_FILE_MODE);
    // Recheck the exact old bytes immediately before replace, then atomically install the next
    // inode.  The lock excludes this store; the second check protects against foreign writers.
    if (!readFileSync(path).equals(currentBytes)) fail(`${code}_CAS_FAILED`);
    renameSync(temporary, path);
    renamed = true;
    syncDirectory(dirname(path), `${code}_DIRECTORY_SYNC_FAILED`);
    assertPrivateFile(path, code);
    if (!readFileSync(path).equals(nextBytes)) fail(`${code}_READBACK_DRIFT`);
  } catch (error) {
    if (error instanceof V208FileDurableStageStoreError) throw error;
    fail(`${code}_WRITE_FAILED`);
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // Preserve the primary error.
      }
    }
    if (!renamed) {
      try {
        unlinkSync(temporary);
      } catch {
        // Best effort cleanup of an unreferenced temporary inode.
      }
    }
  }
}

function exactManifest(value: unknown): V208FileAuthorityManifest {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    fail("V208_FILE_DURABLE_MANIFEST_INVALID");
  const manifest = value as Record<string, unknown>;
  if (
    !exactKeys(manifest, [
      "authoritySha256",
      "checkpoint",
      "image",
      "planSha256",
      "proposalSha256",
      "schemaVersion",
      "sourceCommit",
      "stage",
    ]) ||
    manifest.schemaVersion !== V208_FILE_DURABLE_STAGE_MANIFEST_SCHEMA ||
    manifest.checkpoint !== "V2-08" ||
    manifest.stage !== 7 ||
    typeof manifest.proposalSha256 !== "string" ||
    !SHA256.test(manifest.proposalSha256) ||
    typeof manifest.authoritySha256 !== "string" ||
    !SHA256.test(manifest.authoritySha256) ||
    typeof manifest.image !== "string" ||
    !IMAGE.test(manifest.image) ||
    typeof manifest.sourceCommit !== "string" ||
    !COMMIT.test(manifest.sourceCommit) ||
    typeof manifest.planSha256 !== "string" ||
    !SHA256.test(manifest.planSha256)
  )
    fail("V208_FILE_DURABLE_MANIFEST_INVALID");
  canonicalBytes(manifest);
  return deepFreeze(clone(manifest as unknown as V208FileAuthorityManifest));
}

function exactDate(value: unknown, code: string): string {
  if (typeof value !== "string") fail(code);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) fail(code);
  return value;
}

function exactAuthority(
  value: unknown,
  code = "V208_FILE_DURABLE_AUTHORITY_INVALID",
): V213SignedStageAuthority {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(code);
  const authority = value as Record<string, unknown>;
  if (
    !exactKeys(authority, [
      "authorityId",
      "expiresAt",
      "inputSha256",
      "issuedAt",
      "nonce",
      "predecessorHandoffSha256",
      "schemaVersion",
      "signatureBase64",
      "singleUse",
      "stage",
    ]) ||
    authority.schemaVersion !== "videoforge.v213-stage-authority/v1" ||
    typeof authority.authorityId !== "string" ||
    !ID.test(authority.authorityId) ||
    authority.stage !== "soulx" ||
    typeof authority.inputSha256 !== "string" ||
    !SHA256.test(authority.inputSha256) ||
    typeof authority.predecessorHandoffSha256 !== "string" ||
    !SHA256.test(authority.predecessorHandoffSha256) ||
    typeof authority.nonce !== "string" ||
    authority.nonce.length < 8 ||
    authority.nonce.length > 512 ||
    authority.nonce.includes("\0") ||
    typeof authority.issuedAt !== "string" ||
    typeof authority.expiresAt !== "string" ||
    typeof authority.signatureBase64 !== "string" ||
    authority.signatureBase64.length < 16 ||
    !BASE64.test(authority.signatureBase64) ||
    authority.singleUse !== true
  )
    fail(code);
  const issuedAt = exactDate(authority.issuedAt, code);
  const expiresAt = exactDate(authority.expiresAt, code);
  if (Date.parse(expiresAt) <= Date.parse(issuedAt)) fail(code);
  canonicalBytes(authority);
  return clone(authority as unknown as V213SignedStageAuthority);
}

function exactStageStored(
  value: unknown,
  manifest: V208FileAuthorityManifest,
): V208StoredStageAuthority {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    fail("V208_FILE_DURABLE_STAGE_STATE_INVALID");
  const raw = value as Record<string, unknown>;
  if (!exactKeys(raw, ["authority", "claim", "handoff", "status"]))
    fail("V208_FILE_DURABLE_STAGE_STATE_INVALID");
  const authority = exactAuthority(raw.authority);
  if (authority.stage !== "soulx") fail("V208_FILE_DURABLE_STAGE_AUTHORITY_STAGE_INVALID");
  if (authority.inputSha256 !== manifest.planSha256)
    fail("V208_FILE_DURABLE_STAGE_AUTHORITY_INPUT_INVALID");
  const claimRaw = raw.claim;
  let claim: V208StoredStageAuthority["claim"] = null;
  if (claimRaw !== null) {
    if (claimRaw === null || typeof claimRaw !== "object" || Array.isArray(claimRaw))
      fail("V208_FILE_DURABLE_STAGE_CLAIM_INVALID");
    const claimRecord = claimRaw as Record<string, unknown>;
    if (
      !exactKeys(claimRecord, ["consumedAt", "nonceSha256"]) ||
      typeof claimRecord.nonceSha256 !== "string" ||
      !SHA256.test(claimRecord.nonceSha256) ||
      typeof claimRecord.consumedAt !== "string"
    )
      fail("V208_FILE_DURABLE_STAGE_CLAIM_INVALID");
    claim = {
      nonceSha256: claimRecord.nonceSha256 as `sha256:${string}`,
      consumedAt: exactDate(claimRecord.consumedAt, "V208_FILE_DURABLE_STAGE_CLAIM_INVALID"),
    };
  }
  const handoffRaw = raw.handoff;
  let handoff: V208StoredStageAuthority["handoff"] = null;
  if (handoffRaw !== null) {
    if (handoffRaw === null || typeof handoffRaw !== "object" || Array.isArray(handoffRaw))
      fail("V208_FILE_DURABLE_HANDOFF_INVALID");
    const handoffRecord = handoffRaw as Record<string, unknown>;
    if (
      !exactKeys(handoffRecord, ["handoff", "handoffSha256"]) ||
      typeof handoffRecord.handoffSha256 !== "string" ||
      !SHA256.test(handoffRecord.handoffSha256)
    )
      fail("V208_FILE_DURABLE_HANDOFF_INVALID");
    const handoffValue = handoffRecord.handoff as JsonValue;
    if (hashCanonical(handoffValue) !== handoffRecord.handoffSha256)
      fail("V208_FILE_DURABLE_HANDOFF_HASH_INVALID");
    handoff = {
      handoffSha256: handoffRecord.handoffSha256,
      handoff: clone(handoffValue),
    };
  }
  if (
    (raw.status === "ISSUED" && (claim !== null || handoff !== null)) ||
    (raw.status === "CLAIMED" && (claim === null || handoff !== null)) ||
    (raw.status === "DONE" && (claim === null || handoff === null)) ||
    (raw.status !== "ISSUED" && raw.status !== "CLAIMED" && raw.status !== "DONE")
  )
    fail("V208_FILE_DURABLE_STAGE_STATE_INVALID");
  // Keep the argument in the validator so a future manifest evolution cannot silently permit a
  // stage from another checkpoint.  The approved authority hash is intentionally not compared to
  // the generated stage authority hash: they are distinct records by design.
  if (manifest.checkpoint !== "V2-08" || manifest.stage !== 7)
    fail("V208_FILE_DURABLE_MANIFEST_INVALID");
  return {
    status: raw.status,
    authority,
    claim,
    handoff,
  } as V208StoredStageAuthority;
}

function exactStoredOperation(value: unknown): V208StoredOperationRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    fail("V208_FILE_DURABLE_OPERATION_INVALID");
  const raw = value as Record<string, unknown>;
  if (
    !exactKeys(raw, [
      "evidence",
      "kind",
      "operationId",
      "providerId",
      "requestSha256",
      "resourceKey",
      "stageAuthorityId",
      "state",
    ]) ||
    typeof raw.operationId !== "string" ||
    !ID.test(raw.operationId) ||
    typeof raw.stageAuthorityId !== "string" ||
    !ID.test(raw.stageAuthorityId) ||
    !["create", "readback", "dispatch", "status", "cancel", "delete"].includes(String(raw.kind)) ||
    typeof raw.requestSha256 !== "string" ||
    !SHA256.test(raw.requestSha256) ||
    typeof raw.resourceKey !== "string" ||
    raw.resourceKey.length < 1 ||
    raw.resourceKey.length > 512 ||
    raw.resourceKey.includes("\0") ||
    !["IN_FLIGHT", "ACK_UNKNOWN", "ACKED", "TERMINAL"].includes(String(raw.state)) ||
    (raw.providerId !== null &&
      (typeof raw.providerId !== "string" ||
        raw.providerId.length < 1 ||
        raw.providerId.length > 512 ||
        raw.providerId.includes("\0")))
  )
    fail("V208_FILE_DURABLE_OPERATION_INVALID");
  if (raw.evidence !== null) canonicalBytes(raw.evidence);
  return {
    operationId: raw.operationId,
    stageAuthorityId: raw.stageAuthorityId,
    kind: raw.kind,
    requestSha256: raw.requestSha256 as `sha256:${string}`,
    resourceKey: raw.resourceKey,
    state: raw.state,
    providerId: raw.providerId,
    evidence: raw.evidence,
  } as V208StoredOperationRecord;
}

function exactStageSnapshot(
  value: unknown,
  manifest: V208FileAuthorityManifest,
): V208FileDurableStageSnapshot {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    fail("V208_FILE_DURABLE_STAGE_STATE_INVALID");
  const raw = value as Record<string, unknown>;
  if (
    !exactKeys(raw, [
      "manifestSha256",
      "operations",
      "previousStateSha256",
      "revision",
      "schemaVersion",
      "stageAuthority",
      "stateSha256",
    ]) ||
    raw.schemaVersion !== V208_FILE_DURABLE_STAGE_STATE_SCHEMA ||
    raw.manifestSha256 !== hashCanonical(manifest) ||
    !Number.isSafeInteger(raw.revision) ||
    (raw.revision as number) < 0 ||
    typeof raw.previousStateSha256 !== "string" ||
    !SHA256.test(raw.previousStateSha256) ||
    !Array.isArray(raw.operations) ||
    typeof raw.stateSha256 !== "string" ||
    !SHA256.test(raw.stateSha256)
  )
    fail("V208_FILE_DURABLE_STAGE_STATE_INVALID");
  const stageAuthority =
    raw.stageAuthority === null ? null : exactStageStored(raw.stageAuthority, manifest);
  const operations = raw.operations.map(exactStoredOperation);
  if (
    operations.some(
      (operation, index) =>
        operations.findIndex((candidate) => candidate.operationId === operation.operationId) !==
        index,
    ) ||
    operations.some(
      (operation, index) =>
        operation.operationId !==
        [...operations].sort((a, b) => a.operationId.localeCompare(b.operationId))[index]!
          .operationId,
    )
  )
    fail("V208_FILE_DURABLE_OPERATION_ORDER_INVALID");
  const core = {
    schemaVersion: raw.schemaVersion,
    manifestSha256: raw.manifestSha256,
    revision: raw.revision,
    previousStateSha256: raw.previousStateSha256,
    stageAuthority,
    operations,
  } as StoredStageStateCore;
  if (hashCanonical(core) !== raw.stateSha256) fail("V208_FILE_DURABLE_STAGE_STATE_HASH_INVALID");
  return {
    ...core,
    stateSha256: raw.stateSha256,
  } as V208FileDurableStageSnapshot;
}

function exactRequestIdentity(
  request: V213QualificationMaterializationRequest,
): MaterializationIdentity {
  if (
    request === null ||
    typeof request !== "object" ||
    Array.isArray(request) ||
    !exactKeys(request, [
      "caseSourceRef",
      "deployment",
      "descriptor",
      "fullLiveAuthorityId",
      "generatorRef",
      "inputSha256",
      "inputs",
      "operationId",
      "outerStateSha256",
      "requestSha256",
      "schemaVersion",
      "sourceCommit",
      "stageAuthorityId",
      "validatorRef",
    ]) ||
    typeof request.requestSha256 !== "string" ||
    !SHA256.test(request.requestSha256)
  )
    fail("V208_FILE_DURABLE_MATERIALIZATION_REQUEST_INVALID");
  canonicalBytes(request);
  const { requestSha256: _requestSha256, ...unsigned } = request;
  void _requestSha256;
  if (hashCanonical(unsigned) !== request.requestSha256)
    fail("V208_FILE_DURABLE_MATERIALIZATION_REQUEST_HASH_INVALID");
  return {
    requestSha256: request.requestSha256,
    request: clone(request),
  };
}

function validateMaterializationManifestBinding(
  request: V213QualificationMaterializationRequest,
  manifest: V208FileAuthorityManifest,
): void {
  if (
    request.schemaVersion !== "videoforge.v213-qualification-materialization-request/v1" ||
    request.operationId !== "soulx-live-qualification" ||
    !UUID.test(request.fullLiveAuthorityId) ||
    !ID.test(request.stageAuthorityId) ||
    request.inputSha256 !== manifest.planSha256 ||
    request.sourceCommit !== manifest.sourceCommit
  )
    fail("V208_FILE_DURABLE_MATERIALIZATION_SCOPE_INVALID");
}

function exactMaterializationResult(
  request: V213QualificationMaterializationRequest,
  value: unknown,
): V213QualificationMaterializationRouteResult {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    fail("V208_FILE_DURABLE_MATERIALIZATION_RESULT_INVALID");
  const result = value as Record<string, unknown>;
  if (
    !exactKeys(result, [
      "fullLiveAuthorityId",
      "materialization",
      "operationId",
      "outerStateSha256",
      "requestSha256",
      "resultSha256",
      "schemaVersion",
      "sourceRefsSha256",
      "stageAuthorityId",
    ]) ||
    result.schemaVersion !== "videoforge.v213-qualification-materialization-result/v1" ||
    result.fullLiveAuthorityId !== request.fullLiveAuthorityId ||
    result.operationId !== request.operationId ||
    result.stageAuthorityId !== request.stageAuthorityId ||
    result.outerStateSha256 !== request.outerStateSha256 ||
    typeof result.requestSha256 !== "string" ||
    result.requestSha256 !== request.requestSha256 ||
    typeof result.sourceRefsSha256 !== "string" ||
    !SHA256.test(result.sourceRefsSha256) ||
    typeof result.resultSha256 !== "string" ||
    !SHA256.test(result.resultSha256) ||
    result.materialization === null ||
    typeof result.materialization !== "object" ||
    Array.isArray(result.materialization)
  )
    fail("V208_FILE_DURABLE_MATERIALIZATION_RESULT_INVALID");
  const { resultSha256: _resultSha256, ...unsigned } = result;
  void _resultSha256;
  if (hashCanonical(unsigned) !== result.resultSha256)
    fail("V208_FILE_DURABLE_MATERIALIZATION_RESULT_HASH_INVALID");
  canonicalBytes(result);
  return clone(result as unknown as V213QualificationMaterializationRouteResult);
}

function exactMaterializationEntry(value: unknown): V208StoredMaterialization {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    fail("V208_FILE_DURABLE_MATERIALIZATION_STATE_INVALID");
  const raw = value as Record<string, unknown>;
  if (
    !exactKeys(raw, ["request", "requestSha256", "result", "status"]) ||
    typeof raw.requestSha256 !== "string" ||
    !SHA256.test(raw.requestSha256) ||
    (raw.status !== "CLAIMED" && raw.status !== "PERSISTED")
  )
    fail("V208_FILE_DURABLE_MATERIALIZATION_STATE_INVALID");
  const request = raw.request as V213QualificationMaterializationRequest;
  const identity = exactRequestIdentity(request);
  if (identity.requestSha256 !== raw.requestSha256)
    fail("V208_FILE_DURABLE_MATERIALIZATION_IDENTITY_INVALID");
  const result = raw.result === null ? null : exactMaterializationResult(request, raw.result);
  if (
    (raw.status === "CLAIMED" && result !== null) ||
    (raw.status === "PERSISTED" && result === null)
  )
    fail("V208_FILE_DURABLE_MATERIALIZATION_STATE_INVALID");
  return {
    requestSha256: raw.requestSha256,
    request: identity.request,
    status: raw.status,
    result,
  } as V208StoredMaterialization;
}

function exactMaterializationSnapshot(
  value: unknown,
  manifest: V208FileAuthorityManifest,
): V208FileMaterializationSnapshot {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    fail("V208_FILE_DURABLE_MATERIALIZATION_STATE_INVALID");
  const raw = value as Record<string, unknown>;
  if (
    !exactKeys(raw, [
      "entries",
      "manifestSha256",
      "previousStateSha256",
      "revision",
      "schemaVersion",
      "stateSha256",
    ]) ||
    raw.schemaVersion !== V208_FILE_DURABLE_MATERIALIZATION_SCHEMA ||
    raw.manifestSha256 !== hashCanonical(manifest) ||
    !Number.isSafeInteger(raw.revision) ||
    (raw.revision as number) < 0 ||
    typeof raw.previousStateSha256 !== "string" ||
    !SHA256.test(raw.previousStateSha256) ||
    !Array.isArray(raw.entries) ||
    typeof raw.stateSha256 !== "string" ||
    !SHA256.test(raw.stateSha256)
  )
    fail("V208_FILE_DURABLE_MATERIALIZATION_STATE_INVALID");
  const entries = raw.entries.map(exactMaterializationEntry);
  entries.forEach((entry) => validateMaterializationManifestBinding(entry.request, manifest));
  const sorted = [...entries].sort((a, b) => a.requestSha256.localeCompare(b.requestSha256));
  if (entries.some((entry, index) => entry.requestSha256 !== sorted[index]!.requestSha256))
    fail("V208_FILE_DURABLE_MATERIALIZATION_ORDER_INVALID");
  const core = {
    schemaVersion: raw.schemaVersion,
    manifestSha256: raw.manifestSha256,
    revision: raw.revision,
    previousStateSha256: raw.previousStateSha256,
    entries,
  } as StoredMaterializationStateCore;
  if (hashCanonical(core) !== raw.stateSha256)
    fail("V208_FILE_DURABLE_MATERIALIZATION_STATE_HASH_INVALID");
  return {
    ...core,
    stateSha256: raw.stateSha256,
  } as V208FileMaterializationSnapshot;
}

function stageCore(snapshot: V208FileDurableStageSnapshot): StoredStageStateCore {
  return {
    schemaVersion: snapshot.schemaVersion,
    manifestSha256: snapshot.manifestSha256,
    revision: snapshot.revision,
    previousStateSha256: snapshot.previousStateSha256,
    stageAuthority: snapshot.stageAuthority,
    operations: snapshot.operations,
  };
}

function materializationCore(
  snapshot: V208FileMaterializationSnapshot,
): StoredMaterializationStateCore {
  return {
    schemaVersion: snapshot.schemaVersion,
    manifestSha256: snapshot.manifestSha256,
    revision: snapshot.revision,
    previousStateSha256: snapshot.previousStateSha256,
    entries: snapshot.entries,
  };
}

function materializeStageSnapshot(
  core: Omit<StoredStageStateCore, "revision" | "previousStateSha256"> & {
    readonly revision: number;
    readonly previousStateSha256: `sha256:${string}`;
  },
): V208FileDurableStageSnapshot {
  const stateSha256 = hashCanonical(core);
  return { ...core, stateSha256 } as V208FileDurableStageSnapshot;
}

function materializeMaterializationSnapshot(
  core: Omit<StoredMaterializationStateCore, "revision" | "previousStateSha256"> & {
    readonly revision: number;
    readonly previousStateSha256: `sha256:${string}`;
  },
): V208FileMaterializationSnapshot {
  const stateSha256 = hashCanonical(core);
  return { ...core, stateSha256 } as V208FileMaterializationSnapshot;
}

function initialStageSnapshot(manifest: V208FileAuthorityManifest): V208FileDurableStageSnapshot {
  return materializeStageSnapshot({
    schemaVersion: V208_FILE_DURABLE_STAGE_STATE_SCHEMA,
    manifestSha256: hashCanonical(manifest),
    revision: 0,
    previousStateSha256: GENESIS,
    stageAuthority: null,
    operations: [],
  });
}

function initialMaterializationSnapshot(
  manifest: V208FileAuthorityManifest,
): V208FileMaterializationSnapshot {
  return materializeMaterializationSnapshot({
    schemaVersion: V208_FILE_DURABLE_MATERIALIZATION_SCHEMA,
    manifestSha256: hashCanonical(manifest),
    revision: 0,
    previousStateSha256: GENESIS,
    entries: [],
  });
}

function readLockObservation(path: string): LockObservation | null {
  try {
    assertPrivateFile(path, "V208_FILE_DURABLE_LOCK");
    const before = lstatSync(path);
    const bytes = readFileSync(path);
    const after = lstatSync(path);
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs
    )
      return null;
    const parsed = JSON.parse(bytes.toString("utf8")) as unknown;
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      !exactKeys(parsed, ["pid", "token"]) ||
      typeof (parsed as { readonly pid?: unknown }).pid !== "number" ||
      !Number.isSafeInteger((parsed as { readonly pid: number }).pid) ||
      (parsed as { readonly pid: number }).pid < 1 ||
      typeof (parsed as { readonly token?: unknown }).token !== "string" ||
      !UUID.test((parsed as { readonly token: string }).token) ||
      !bytes.equals(canonicalBytes(parsed))
    )
      return null;
    return {
      path,
      pid: (parsed as { readonly pid: number }).pid,
      token: (parsed as { readonly token: string }).token,
      device: after.dev,
      inode: after.ino,
      size: after.size,
      modifiedAtMs: after.mtimeMs,
    };
  } catch {
    return null;
  }
}

function sameLock(left: LockHandle, right: LockObservation | null): right is LockObservation {
  return (
    right !== null &&
    left.path === right.path &&
    left.pid === right.pid &&
    left.token === right.token &&
    left.device === right.device &&
    left.inode === right.inode
  );
}

function lockIsLive(observed: LockObservation | null): boolean {
  if (observed === null) return true;
  try {
    process.kill(observed.pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

/** Publish a fully written lock inode with create-only link semantics. A crash can leave only an
 * unreferenced temporary inode or a complete canonical final lock, never a partial final lock. */
function tryPublishLock(path: string, token: string): LockObservation | null {
  const payload = canonicalBytes({ pid: process.pid, token });
  const temporary = temporaryPath(path, "v208-lock");
  let descriptor: number | undefined;
  let published = false;
  try {
    const flags =
      fsConstants.O_WRONLY |
      fsConstants.O_CREAT |
      fsConstants.O_EXCL |
      (fsConstants.O_NOFOLLOW ?? 0);
    descriptor = openSync(temporary, flags, V208_FILE_DURABLE_FILE_MODE);
    writeFileSync(descriptor, payload);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    chmodSync(temporary, V208_FILE_DURABLE_FILE_MODE);
    try {
      linkSync(temporary, path);
      published = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return null;
      throw error;
    }
    syncDirectory(dirname(path), "V208_FILE_DURABLE_LOCK_DIRECTORY_SYNC_FAILED");
    const observed = readLockObservation(path);
    if (
      observed === null ||
      observed.pid !== process.pid ||
      observed.token !== token ||
      !readFileSync(path).equals(payload)
    )
      fail("V208_FILE_DURABLE_LOCK_READBACK_INVALID");
    return observed;
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // Preserve the primary acquisition error.
      }
    }
    try {
      unlinkSync(temporary);
      syncDirectory(dirname(path), "V208_FILE_DURABLE_LOCK_TEMP_SYNC_FAILED");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" && published)
        fail("V208_FILE_DURABLE_LOCK_TEMP_CLEANUP_FAILED");
    }
  }
}

function lockClaimPaths(directory: string): readonly string[] {
  let names: readonly string[];
  try {
    names = readdirSync(directory);
  } catch {
    fail("V208_FILE_DURABLE_LOCK_DIRECTORY_READ_FAILED");
  }
  return names
    .filter(
      (name) =>
        name === V208_FILE_DURABLE_LOCK_FILENAME || LOCK_CLAIM_FILENAME.test(name),
    )
    .sort()
    .map((name) => join(directory, name));
}

function removeStaleClaim(path: string, directory: string): void {
  try {
    unlinkSync(path);
    syncDirectory(directory, "V208_FILE_DURABLE_STALE_LOCK_SYNC_FAILED");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      fail("V208_FILE_DURABLE_LOCK_ACQUIRE_FAILED");
  }
}

function acquireLock(directory: string): LockHandle {
  const token = randomUUID();
  const path = join(directory, `${V208_FILE_DURABLE_LOCK_FILENAME}.${token}`);
  let created: LockHandle | null = null;
  try {
    created = tryPublishLock(path, token);
    if (created === null) fail("V208_FILE_DURABLE_LOCKED");
    for (const candidatePath of lockClaimPaths(directory)) {
      if (candidatePath === created.path) continue;
      const observed = readLockObservation(candidatePath);
      if (observed === null) {
        // A concurrently released unique claim is harmless. An extant unreadable claim is
        // ambiguous and therefore blocks rather than being deleted.
        if (exists(candidatePath)) fail("V208_FILE_DURABLE_LOCKED");
        continue;
      }
      if (lockIsLive(observed)) fail("V208_FILE_DURABLE_LOCKED");
      // Claim paths include a never-reused UUID. Removing this path can therefore only remove
      // this exact crashed owner; it can never name a successor lock.
      removeStaleClaim(candidatePath, directory);
    }
    return created;
  } catch (error) {
    if (created !== null) {
      try {
        releaseLock(created);
      } catch {
        // Preserve the acquisition error. A mismatched replacement remains for inspection.
      }
    }
    if (error instanceof V208FileDurableStageStoreError) throw error;
    fail("V208_FILE_DURABLE_LOCK_ACQUIRE_FAILED");
  }
}

function releaseLock(lock: LockHandle): void {
  try {
    const observed = readLockObservation(lock.path);
    if (!sameLock(lock, observed)) fail("V208_FILE_DURABLE_LOCK_RELEASE_OWNERSHIP_INVALID");
    unlinkSync(lock.path);
    syncDirectory(dirname(lock.path), "V208_FILE_DURABLE_LOCK_RELEASE_SYNC_FAILED");
  } catch (error) {
    if (error instanceof V208FileDurableStageStoreError) throw error;
    fail("V208_FILE_DURABLE_LOCK_RELEASE_FAILED");
  }
}

function operationPublic(record: V208StoredOperationRecord): V213DurableOperationRecord {
  return {
    operationId: record.operationId,
    stageAuthorityId: record.stageAuthorityId,
    kind: record.kind,
    requestSha256: record.requestSha256,
    resourceKey: record.resourceKey,
    state: record.state,
    ...(record.providerId === null ? {} : { providerId: record.providerId }),
    ...(record.evidence === null ? {} : { evidence: clone(record.evidence) }),
  };
}

function stageInputMatches(
  authority: V213SignedStageAuthority,
  input: {
    readonly stage: V213Stage;
    readonly inputSha256: string;
    readonly predecessorHandoffSha256: string;
  },
): boolean {
  return (
    authority.stage === input.stage &&
    authority.inputSha256 === input.inputSha256 &&
    authority.predecessorHandoffSha256 === input.predecessorHandoffSha256
  );
}

function validateOperationInput(
  input: Omit<V213DurableOperationRecord, "state" | "providerId">,
): void {
  if (
    input === null ||
    typeof input !== "object" ||
    !ID.test(input.operationId) ||
    !ID.test(input.stageAuthorityId) ||
    !["create", "readback", "dispatch", "status", "cancel", "delete"].includes(input.kind) ||
    !SHA256.test(input.requestSha256) ||
    typeof input.resourceKey !== "string" ||
    input.resourceKey.length < 1 ||
    input.resourceKey.length > 512 ||
    input.resourceKey.includes("\0")
  )
    fail("V208_FILE_DURABLE_OPERATION_INPUT_INVALID");
}

function validateTransition(
  from: V213DurableOperationRecord["state"],
  to: V213DurableOperationRecord["state"],
): void {
  const allowed: Readonly<Record<V213DurableOperationRecord["state"], readonly string[]>> = {
    IN_FLIGHT: ["ACK_UNKNOWN", "ACKED", "TERMINAL"],
    ACK_UNKNOWN: ["ACKED", "TERMINAL"],
    ACKED: ["TERMINAL"],
    TERMINAL: [],
  };
  if (!(from in allowed) || !(to in allowed) || !allowed[from].includes(to))
    fail("V208_FILE_DURABLE_OPERATION_TRANSITION_INVALID");
}

function exactResultEquality(
  left: V213QualificationMaterializationRouteResult,
  right: V213QualificationMaterializationRouteResult,
): boolean {
  return (
    canonicalizeJson(left as unknown as JsonValue) ===
    canonicalizeJson(right as unknown as JsonValue)
  );
}

function qualificationResourceKey(stageAuthorityId: string): string {
  return `v213-${stageAuthorityId}-soulx-qualification`;
}

function assertCleanupOperationScope(
  operation: V208StoredOperationRecord,
  stageAuthorityId: string,
): void {
  if (operation.stageAuthorityId !== stageAuthorityId)
    fail("V208_FILE_DURABLE_CLEANUP_SCOPE_INVALID");
  const qualificationKey = qualificationResourceKey(stageAuthorityId);
  const valid =
    operation.kind === "create" || operation.kind === "readback" || operation.kind === "delete"
      ? operation.resourceKey === qualificationKey
      : operation.kind === "dispatch"
        ? SOULX_DISPATCH_RESOURCE.test(operation.resourceKey)
        : operation.kind === "cancel"
          ? SOULX_JOB_RESOURCE.test(operation.resourceKey)
          : operation.kind === "status"
            ? SOULX_STATUS_RESOURCE.test(operation.resourceKey) ||
              SOULX_PHASE_RESOURCE.test(operation.resourceKey)
            : false;
  if (!valid) fail("V208_FILE_DURABLE_CLEANUP_SCOPE_INVALID");
}

export class V208FileDurableStageStore implements V213DurableStageStore {
  readonly journalDirectory: string;
  readonly manifestPath: string;
  readonly stageStatePath: string;
  readonly materializationStatePath: string;
  readonly authorityManifest: V208FileAuthorityManifest;
  readonly manifestSha256: `sha256:${string}`;
  readonly qualificationMaterializationStore: V213QualificationMaterializationStore;
  readonly materializationStore: V213QualificationMaterializationStore;

  private readonly signAuthority?: V208FileStageAuthoritySigner;
  private readonly now: () => Date;
  private readonly nonce: () => string;

  constructor(input: V208FileDurableStageStoreOptions) {
    this.journalDirectory = assertAbsoluteJournalDirectory(input.journalDirectory);
    ensureJournalDirectory(this.journalDirectory);
    this.authorityManifest = exactManifest(input.manifest);
    this.manifestSha256 = hashCanonical(this.authorityManifest);
    this.manifestPath = join(this.journalDirectory, V208_FILE_DURABLE_MANIFEST_FILENAME);
    this.stageStatePath = join(this.journalDirectory, V208_FILE_DURABLE_STAGE_STATE_FILENAME);
    this.materializationStatePath = join(
      this.journalDirectory,
      V208_FILE_DURABLE_MATERIALIZATION_STATE_FILENAME,
    );
    this.signAuthority = input.signAuthority;
    this.now = input.now ?? (() => new Date());
    this.nonce = input.nonce ?? (() => randomBytes(24).toString("base64url"));
    writeImmutable(
      this.manifestPath,
      canonicalBytes(this.authorityManifest),
      "V208_FILE_DURABLE_MANIFEST",
    );
    if (!exists(this.stageStatePath)) {
      const initial = initialStageSnapshot(this.authorityManifest);
      writeImmutable(this.stageStatePath, canonicalBytes(initial), "V208_FILE_DURABLE_STAGE_STATE");
    } else {
      exactStageSnapshot(
        readCanonicalFile(this.stageStatePath, "V208_FILE_DURABLE_STAGE_STATE"),
        this.authorityManifest,
      );
    }
    if (!exists(this.materializationStatePath)) {
      const initial = initialMaterializationSnapshot(this.authorityManifest);
      writeImmutable(
        this.materializationStatePath,
        canonicalBytes(initial),
        "V208_FILE_DURABLE_MATERIALIZATION_STATE",
      );
    } else {
      exactMaterializationSnapshot(
        readCanonicalFile(this.materializationStatePath, "V208_FILE_DURABLE_MATERIALIZATION_STATE"),
        this.authorityManifest,
      );
    }
    this.qualificationMaterializationStore = Object.freeze({
      claim: (request: V213QualificationMaterializationRequest) =>
        this.claimMaterialization(request),
      persist: (
        request: V213QualificationMaterializationRequest,
        result: V213QualificationMaterializationRouteResult,
      ) => this.persistMaterialization(request, result),
      read: (request: V213QualificationMaterializationRequest) => this.readMaterialization(request),
    });
    this.materializationStore = this.qualificationMaterializationStore;
  }

  readSnapshot(): V208FileDurableStageSnapshot {
    return deepFreeze(
      clone(
        exactStageSnapshot(
          readCanonicalFile(this.stageStatePath, "V208_FILE_DURABLE_STAGE_STATE"),
          this.authorityManifest,
        ),
      ),
    );
  }

  readMaterializationSnapshot(): V208FileMaterializationSnapshot {
    return deepFreeze(
      clone(
        exactMaterializationSnapshot(
          readCanonicalFile(
            this.materializationStatePath,
            "V208_FILE_DURABLE_MATERIALIZATION_STATE",
          ),
          this.authorityManifest,
        ),
      ),
    );
  }

  /**
   * Return only the exact soulx cleanup journal for one stage authority.  This deliberately
   * exposes no provider lookup and rejects any operation whose resource key is outside the
   * deterministic V2-08 namespace, so callers cannot turn a journal read into broad cleanup.
   */
  async readCleanupStage(stageAuthorityId: string): Promise<V213CleanupStageRead | null> {
    return this.withLock(() => {
      if (!ID.test(stageAuthorityId)) fail("V208_FILE_DURABLE_CLEANUP_SCOPE_INVALID");
      const snapshot = this.readSnapshot();
      const stored = snapshot.stageAuthority;
      if (stored === null) return null;
      if (stored.authority.authorityId !== stageAuthorityId)
        fail("V208_FILE_DURABLE_STAGE_AUTHORITY_NOT_FOUND");
      const operations = snapshot.operations.map((operation) => {
        assertCleanupOperationScope(operation, stageAuthorityId);
        return {
          kind: operation.kind,
          resourceKey: operation.resourceKey,
          state: operation.state,
          providerId: operation.providerId,
          evidence: operation.evidence === null ? null : clone(operation.evidence),
        };
      });
      return deepFreeze({
        stage: "soulx" as const,
        stageAuthorityId,
        operations,
      });
    });
  }

  private async withLock<T>(work: () => Promise<T> | T): Promise<T> {
    const lock = acquireLock(this.journalDirectory);
    let succeeded = false;
    try {
      const value = await work();
      succeeded = true;
      return value;
    } finally {
      if (succeeded) releaseLock(lock);
      else {
        try {
          releaseLock(lock);
        } catch {
          // Preserve the operation's failure; an operator can inspect the exact lock path.
        }
      }
    }
  }

  private persistStage(
    next: V208FileDurableStageSnapshot,
    current: V208FileDurableStageSnapshot,
  ): void {
    const currentBytes = canonicalBytes(current);
    const nextBytes = canonicalBytes(next);
    writeAtomicCas(this.stageStatePath, currentBytes, nextBytes, "V208_FILE_DURABLE_STAGE_STATE");
  }

  private persistMaterializationSnapshot(
    next: V208FileMaterializationSnapshot,
    current: V208FileMaterializationSnapshot,
  ): void {
    writeAtomicCas(
      this.materializationStatePath,
      canonicalBytes(current),
      canonicalBytes(next),
      "V208_FILE_DURABLE_MATERIALIZATION_STATE",
    );
  }

  private timestamp(): string {
    const value = this.now();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
      fail("V208_FILE_DURABLE_TIME_INVALID");
    return value.toISOString();
  }

  private assertMaterializationRequestScope(
    request: V213QualificationMaterializationRequest,
  ): void {
    validateMaterializationManifestBinding(request, this.authorityManifest);
    const stage = this.readSnapshot().stageAuthority;
    if (
      stage === null ||
      stage.authority.authorityId !== request.stageAuthorityId ||
      stage.status === "ISSUED"
    )
      fail("V208_FILE_DURABLE_MATERIALIZATION_STAGE_SCOPE_INVALID");
  }

  async issueStageAuthority(input: {
    readonly stage: V213Stage;
    readonly inputSha256: string;
    readonly predecessorHandoffSha256: string;
  }): Promise<V213SignedStageAuthority> {
    return this.withLock(async () => {
      if (
        input.stage !== "soulx" ||
        !SHA256.test(input.inputSha256) ||
        !SHA256.test(input.predecessorHandoffSha256) ||
        input.inputSha256 !== this.authorityManifest.planSha256
      )
        fail("V208_FILE_DURABLE_STAGE_INPUT_INVALID");
      const current = this.readSnapshot();
      const stored = current.stageAuthority;
      if (stored !== null) {
        if (!stageInputMatches(stored.authority, input))
          fail("V208_FILE_DURABLE_STAGE_AUTHORITY_INPUT_MISMATCH");
        return deepFreeze(clone(stored.authority));
      }
      if (this.signAuthority === undefined) fail("V208_FILE_DURABLE_STAGE_SIGNER_REQUIRED");
      const nonce = this.nonce();
      if (
        typeof nonce !== "string" ||
        nonce.length < 8 ||
        nonce.length > 512 ||
        nonce.includes("\0")
      )
        fail("V208_FILE_DURABLE_NONCE_INVALID");
      const issuedAt = this.timestamp();
      const unsigned: Omit<V213SignedStageAuthority, "signatureBase64"> = {
        schemaVersion: "videoforge.v213-stage-authority/v1",
        authorityId: `v213-soulx-${hashCanonical({
          manifestSha256: this.manifestSha256,
          inputSha256: input.inputSha256,
          predecessorHandoffSha256: input.predecessorHandoffSha256,
          nonce,
        }).slice(7, 39)}`,
        stage: "soulx",
        inputSha256: input.inputSha256,
        predecessorHandoffSha256: input.predecessorHandoffSha256,
        nonce,
        issuedAt,
        expiresAt: new Date(Date.parse(issuedAt) + 10 * 60_000).toISOString(),
        singleUse: true,
      };
      const signatureBase64 = await this.signAuthority(clone(unsigned));
      if (
        typeof signatureBase64 !== "string" ||
        signatureBase64.length < 16 ||
        !BASE64.test(signatureBase64)
      )
        fail("V208_FILE_DURABLE_SIGNATURE_INVALID");
      const authority = exactAuthority({ ...unsigned, signatureBase64 });
      const next = materializeStageSnapshot({
        ...stageCore(current),
        revision: current.revision + 1,
        previousStateSha256: current.stateSha256,
        stageAuthority: {
          status: "ISSUED",
          authority,
          claim: null,
          handoff: null,
        },
      });
      this.persistStage(next, current);
      return deepFreeze(clone(authority));
    });
  }

  async claimStageAuthority(
    authority: V213SignedStageAuthority,
  ): Promise<V213StageConsumptionRecord> {
    return this.withLock(async () => {
      const supplied = exactAuthority(authority);
      const current = this.readSnapshot();
      const stored = current.stageAuthority;
      if (
        stored === null ||
        canonicalizeJson(stored.authority as unknown as JsonValue) !==
          canonicalizeJson(supplied as unknown as JsonValue)
      )
        fail("V208_FILE_DURABLE_STAGE_AUTHORITY_NOT_FOUND");
      if (stored.claim === null && stored.status !== "ISSUED")
        fail("V208_FILE_DURABLE_STAGE_CLAIM_INVALID");
      if (stored.status === "DONE")
        return deepFreeze({
          decision: "REPLAY_REJECTED" as const,
          authorityId: stored.authority.authorityId,
          nonceSha256: sha256Bytes(Buffer.from(stored.authority.nonce, "utf8")),
          consumedAt: stored.claim!.consumedAt,
        });
      if (stored.status === "CLAIMED")
        return deepFreeze({
          decision: "RESUME" as const,
          authorityId: stored.authority.authorityId,
          nonceSha256: stored.claim!.nonceSha256,
          consumedAt: stored.claim!.consumedAt,
        });
      const consumedAt = this.timestamp();
      // A first claim is the only point at which the authority is consumed.  Once CLAIMED, a
      // restarted process is allowed to RESUME even if cleanup has crossed this wall-clock
      // expiry; this check intentionally applies only to the first EXECUTE claim.
      if (Date.parse(consumedAt) > Date.parse(stored.authority.expiresAt))
        fail("V208_FILE_DURABLE_STAGE_AUTHORITY_EXPIRED");
      const claim = {
        nonceSha256: sha256Bytes(Buffer.from(stored.authority.nonce, "utf8")),
        consumedAt,
      } as const;
      const next = materializeStageSnapshot({
        ...stageCore(current),
        revision: current.revision + 1,
        previousStateSha256: current.stateSha256,
        stageAuthority: {
          ...stored,
          status: "CLAIMED",
          claim,
        },
      });
      this.persistStage(next, current);
      return deepFreeze({
        decision: "EXECUTE" as const,
        authorityId: stored.authority.authorityId,
        nonceSha256: claim.nonceSha256,
        consumedAt,
      });
    });
  }

  async completeStageAuthority(
    authorityId: string,
    handoffSha256: string,
    handoff: JsonValue,
  ): Promise<void> {
    return this.withLock(async () => {
      if (!ID.test(authorityId) || !SHA256.test(handoffSha256))
        fail("V208_FILE_DURABLE_HANDOFF_INPUT_INVALID");
      const current = this.readSnapshot();
      const stored = current.stageAuthority;
      if (stored === null || stored.authority.authorityId !== authorityId)
        fail("V208_FILE_DURABLE_STAGE_AUTHORITY_NOT_FOUND");
      if (hashCanonical(handoff) !== handoffSha256) fail("V208_FILE_DURABLE_HANDOFF_HASH_INVALID");
      if (stored.status === "DONE") {
        if (
          stored.handoff?.handoffSha256 !== handoffSha256 ||
          canonicalizeJson(stored.handoff.handoff) !== canonicalizeJson(handoff)
        )
          fail("V208_FILE_DURABLE_HANDOFF_DRIFT");
        return;
      }
      if (stored.status !== "CLAIMED" || stored.claim === null)
        fail("V208_FILE_DURABLE_STAGE_NOT_CLAIMED");
      const next = materializeStageSnapshot({
        ...stageCore(current),
        revision: current.revision + 1,
        previousStateSha256: current.stateSha256,
        stageAuthority: {
          ...stored,
          status: "DONE",
          handoff: { handoffSha256, handoff: clone(handoff) },
        },
      });
      this.persistStage(next, current);
    });
  }

  async claimOperation(input: Omit<V213DurableOperationRecord, "state" | "providerId">): Promise<
    Readonly<{
      readonly action: "EXECUTE" | "RECONCILE" | "DONE";
      readonly record: V213DurableOperationRecord;
    }>
  > {
    return this.withLock(async () => {
      validateOperationInput(input);
      const current = this.readSnapshot();
      const storedAuthority = current.stageAuthority;
      if (
        storedAuthority === null ||
        storedAuthority.authority.authorityId !== input.stageAuthorityId
      )
        fail("V208_FILE_DURABLE_OPERATION_STAGE_AUTHORITY_INVALID");
      if (storedAuthority.status === "ISSUED")
        fail("V208_FILE_DURABLE_OPERATION_STAGE_NOT_CLAIMED");
      const found = current.operations.find(
        (operation) => operation.operationId === input.operationId,
      );
      if (found !== undefined) {
        if (
          found.stageAuthorityId !== input.stageAuthorityId ||
          found.kind !== input.kind ||
          found.requestSha256 !== input.requestSha256 ||
          found.resourceKey !== input.resourceKey
        )
          fail("V208_FILE_DURABLE_OPERATION_IDENTITY_MISMATCH");
        const action = found.state === "TERMINAL" ? ("DONE" as const) : ("RECONCILE" as const);
        return deepFreeze({ action, record: operationPublic(found) });
      }
      const record: V208StoredOperationRecord = {
        ...input,
        requestSha256: input.requestSha256 as `sha256:${string}`,
        state: "IN_FLIGHT",
        providerId: null,
        evidence: null,
      };
      const operations = [...current.operations, record].sort((a, b) =>
        a.operationId.localeCompare(b.operationId),
      );
      const next = materializeStageSnapshot({
        ...stageCore(current),
        revision: current.revision + 1,
        previousStateSha256: current.stateSha256,
        operations,
      });
      this.persistStage(next, current);
      return deepFreeze({ action: "EXECUTE" as const, record: operationPublic(record) });
    });
  }

  async transitionOperation(input: {
    readonly operationId: string;
    readonly from: V213DurableOperationRecord["state"];
    readonly to: V213DurableOperationRecord["state"];
    readonly providerId?: string;
    readonly evidence?: JsonValue;
  }): Promise<V213DurableOperationRecord> {
    return this.withLock(async () => {
      if (!ID.test(input.operationId)) fail("V208_FILE_DURABLE_OPERATION_ID_INVALID");
      validateTransition(input.from, input.to);
      if (
        input.providerId !== undefined &&
        (typeof input.providerId !== "string" ||
          input.providerId.length < 1 ||
          input.providerId.length > 512 ||
          input.providerId.includes("\0"))
      )
        fail("V208_FILE_DURABLE_PROVIDER_ID_INVALID");
      if (input.evidence !== undefined) canonicalBytes(input.evidence);
      const current = this.readSnapshot();
      const index = current.operations.findIndex(
        (operation) => operation.operationId === input.operationId,
      );
      if (index < 0) fail("V208_FILE_DURABLE_OPERATION_NOT_FOUND");
      const previous = current.operations[index]!;
      if (previous.state !== input.from) fail("V208_FILE_DURABLE_OPERATION_CAS_FAILED");
      const nextRecord: V208StoredOperationRecord = {
        ...previous,
        state: input.to,
        providerId: input.providerId ?? previous.providerId,
        evidence: input.evidence === undefined ? previous.evidence : clone(input.evidence),
      };
      const operations = current.operations.slice();
      operations[index] = nextRecord;
      const next = materializeStageSnapshot({
        ...stageCore(current),
        revision: current.revision + 1,
        previousStateSha256: current.stateSha256,
        operations,
      });
      this.persistStage(next, current);
      return deepFreeze(operationPublic(nextRecord));
    });
  }

  private async claimMaterialization(
    request: V213QualificationMaterializationRequest,
  ): Promise<"EXECUTE" | "RECONCILE" | "EXISTING"> {
    return this.withLock(async () => {
      const identity = exactRequestIdentity(request);
      this.assertMaterializationRequestScope(identity.request);
      const current = this.readMaterializationSnapshot();
      const found = current.entries.find((entry) => entry.requestSha256 === identity.requestSha256);
      if (found !== undefined) {
        if (
          canonicalizeJson(found.request as unknown as JsonValue) !==
          canonicalizeJson(identity.request as unknown as JsonValue)
        )
          fail("V208_FILE_DURABLE_MATERIALIZATION_IDENTITY_MISMATCH");
        return found.status === "PERSISTED" ? "EXISTING" : "RECONCILE";
      }
      const entry: V208StoredMaterialization = {
        requestSha256: identity.requestSha256,
        request: identity.request,
        status: "CLAIMED",
        result: null,
      };
      const entries = [...current.entries, entry].sort((a, b) =>
        a.requestSha256.localeCompare(b.requestSha256),
      );
      const next = materializeMaterializationSnapshot({
        ...materializationCore(current),
        revision: current.revision + 1,
        previousStateSha256: current.stateSha256,
        entries,
      });
      this.persistMaterializationSnapshot(next, current);
      return "EXECUTE";
    });
  }

  private async persistMaterialization(
    request: V213QualificationMaterializationRequest,
    result: V213QualificationMaterializationRouteResult,
  ): Promise<V213QualificationMaterializationRouteResult> {
    return this.withLock(async () => {
      const identity = exactRequestIdentity(request);
      this.assertMaterializationRequestScope(identity.request);
      const exactResult = exactMaterializationResult(request, result);
      const current = this.readMaterializationSnapshot();
      const index = current.entries.findIndex(
        (entry) => entry.requestSha256 === identity.requestSha256,
      );
      if (index < 0) fail("V208_FILE_DURABLE_MATERIALIZATION_CLAIM_REQUIRED");
      const previous = current.entries[index]!;
      if (
        canonicalizeJson(previous.request as unknown as JsonValue) !==
        canonicalizeJson(identity.request as unknown as JsonValue)
      )
        fail("V208_FILE_DURABLE_MATERIALIZATION_IDENTITY_MISMATCH");
      if (previous.status === "PERSISTED") {
        if (previous.result === null || !exactResultEquality(previous.result, exactResult))
          fail("V208_FILE_DURABLE_MATERIALIZATION_RESULT_DRIFT");
        return deepFreeze(clone(previous.result));
      }
      const entries = current.entries.slice();
      entries[index] = { ...previous, status: "PERSISTED", result: exactResult };
      const next = materializeMaterializationSnapshot({
        ...materializationCore(current),
        revision: current.revision + 1,
        previousStateSha256: current.stateSha256,
        entries,
      });
      this.persistMaterializationSnapshot(next, current);
      return deepFreeze(clone(exactResult));
    });
  }

  private async readMaterialization(
    request: V213QualificationMaterializationRequest,
  ): Promise<V213QualificationMaterializationRouteResult | null> {
    return this.withLock(async () => {
      const identity = exactRequestIdentity(request);
      this.assertMaterializationRequestScope(identity.request);
      const current = this.readMaterializationSnapshot();
      const found = current.entries.find((entry) => entry.requestSha256 === identity.requestSha256);
      if (found === undefined) return null;
      if (
        canonicalizeJson(found.request as unknown as JsonValue) !==
        canonicalizeJson(identity.request as unknown as JsonValue)
      )
        fail("V208_FILE_DURABLE_MATERIALIZATION_IDENTITY_MISMATCH");
      return found.result === null ? null : deepFreeze(clone(found.result));
    });
  }
}

export function createV208FileDurableStageStore(
  input: V208FileDurableStageStoreOptions,
): V208FileDurableStageStore {
  return new V208FileDurableStageStore(input);
}

export function createV208FileQualificationMaterializationStore(
  input: V208FileDurableStageStoreOptions,
): V213QualificationMaterializationStore {
  return new V208FileDurableStageStore(input).qualificationMaterializationStore;
}

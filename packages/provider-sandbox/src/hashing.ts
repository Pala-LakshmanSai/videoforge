import { createHash } from "node:crypto";

import type {
  SandboxAttemptBindingFacts,
  SandboxAttemptEvidencePayload,
  SandboxAttemptIdentity,
  SandboxAuthorizationEnvelope,
  SandboxOwner,
  SandboxTaskIdentity,
  Sha256,
} from "./types.js";

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;

// Capture the object intrinsics used by the safety boundary before callers can poison them.
const objectCreate = Object.create;
const objectFreeze = Object.freeze;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectIsFrozen = Object.isFrozen;
const objectKeys = Object.keys;
const objectValues = Object.values;
const reflectOwnKeys = Reflect.ownKeys;
const arrayIsArray = Array.isArray;

type DeterministicValue =
  | bigint
  | boolean
  | number
  | string
  | null
  | readonly DeterministicValue[]
  | { readonly [key: string]: DeterministicValue };

function deterministicStringify(value: DeterministicValue): string {
  if (value === null) return "null";
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new RangeError("deterministic records require finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(deterministicStringify).join(",")}]`;

  const record = value as { readonly [key: string]: DeterministicValue };
  return `{${objectKeys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${deterministicStringify(record[key]!)}`)
    .join(",")}}`;
}

export function sha256DeterministicRecord(value: DeterministicValue): Sha256 {
  return `sha256:${createHash("sha256").update(deterministicStringify(value)).digest("hex")}`;
}

export function isSha256(value: unknown): value is Sha256 {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

/** A shallow, single-read snapshot of an exact own-data-property record. */
export function snapshotOwnDataRecord(
  value: unknown,
  allowedKeys: readonly string[],
  requiredKeys: readonly string[] = allowedKeys,
): Readonly<Record<string, unknown>> | null {
  try {
    if (typeof value !== "object" || value === null || arrayIsArray(value)) return null;
    const keys = reflectOwnKeys(value);
    for (const key of keys) {
      if (typeof key !== "string" || !allowedKeys.includes(key)) return null;
    }
    for (const required of requiredKeys) {
      if (!keys.includes(required)) return null;
    }

    const snapshot = objectCreate(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = objectGetOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor)) return null;
      snapshot[key as string] = descriptor.value;
    }
    return objectFreeze(snapshot);
  } catch {
    return null;
  }
}

export function hasExactSnapshotKeys(
  value: Readonly<Record<string, unknown>>,
  expectedKeys: readonly string[],
): boolean {
  const keys = objectKeys(value);
  return (
    keys.length === expectedKeys.length && expectedKeys.every((expected) => keys.includes(expected))
  );
}

/** A dense, single-read array snapshot that rejects holes, accessors, symbols, and extra keys. */
export function snapshotDenseOwnDataArray(value: unknown): readonly unknown[] | null {
  try {
    if (!arrayIsArray(value)) return null;
    const lengthDescriptor = objectGetOwnPropertyDescriptor(value, "length");
    if (
      lengthDescriptor === undefined ||
      !("value" in lengthDescriptor) ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      Number(lengthDescriptor.value) < 0
    ) {
      return null;
    }
    const length = Number(lengthDescriptor.value);
    const keys = reflectOwnKeys(value);
    if (keys.length !== length + 1 || !keys.includes("length")) return null;

    const snapshot: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const key = String(index);
      if (!keys.includes(key)) return null;
      const descriptor = objectGetOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor)) return null;
      snapshot.push(descriptor.value);
    }
    for (const key of keys) {
      if (typeof key !== "string" || (key !== "length" && !/^\d+$/u.test(key))) return null;
    }
    return objectFreeze(snapshot);
  } catch {
    return null;
  }
}

export function isCapturedFrozen(value: object): boolean {
  return objectIsFrozen(value);
}

function ownerRecord(owner: SandboxOwner): Record<string, string> {
  if (owner.ownerType === "PROJECT_REVISION") {
    return {
      ownerId: owner.ownerId,
      ownerType: owner.ownerType,
      projectRevisionId: owner.projectRevisionId,
      schemaVersion: "provider-sandbox-owner/v1",
    };
  }
  if (owner.ownerType === "IMAGE_STYLE_VERSION") {
    return {
      imageStyleVersionId: owner.imageStyleVersionId,
      ownerId: owner.ownerId,
      ownerType: owner.ownerType,
      schemaVersion: "provider-sandbox-owner/v1",
    };
  }
  return {
    avatarProfileVersionId: owner.avatarProfileVersionId,
    ownerId: owner.ownerId,
    ownerType: owner.ownerType,
    schemaVersion: "provider-sandbox-owner/v1",
  };
}

export function hashSandboxOwner(owner: SandboxOwner): Sha256 {
  return sha256DeterministicRecord(ownerRecord(owner));
}

export function hashSandboxAuthorization(authorization: SandboxAuthorizationEnvelope): Sha256 {
  return sha256DeterministicRecord({
    authorizationId: authorization.authorizationId,
    authorizedExternalSpendMicroUsd: authorization.authorizedExternalSpendMicroUsd,
    credentialAccessAuthorized: authorization.credentialAccessAuthorized,
    enabled: authorization.enabled,
    expiresAtEpochMs: authorization.expiresAtEpochMs,
    issuedAtEpochMs: authorization.issuedAtEpochMs,
    networkAccessAuthorized: authorization.networkAccessAuthorized,
    providerCallsAuthorized: authorization.providerCallsAuthorized,
    sandboxExecutionAuthorized: authorization.sandboxExecutionAuthorized,
    schemaVersion: authorization.schemaVersion,
    taskHash: authorization.taskHash,
  });
}

export interface CreateSandboxTaskIdentityInput {
  readonly owner: SandboxOwner;
  readonly taskId: string;
  readonly taskKey: string;
}

export function createSandboxTaskIdentity(
  input: CreateSandboxTaskIdentityInput,
): SandboxTaskIdentity {
  const ownerHash = hashSandboxOwner(input.owner);
  const taskHash = sha256DeterministicRecord({
    ownerHash,
    schemaVersion: "provider-sandbox-task/v1",
    taskId: input.taskId,
    taskKey: input.taskKey,
  });
  return deepFreeze({
    owner: { ...input.owner },
    ownerHash,
    taskId: input.taskId,
    taskKey: input.taskKey,
    taskHash,
  });
}

export interface SandboxAttemptBindingInput {
  readonly task: SandboxTaskIdentity;
  readonly attempt: SandboxAttemptIdentity;
  readonly facts: SandboxAttemptBindingFacts;
}

export function hashSandboxAttemptBinding(input: SandboxAttemptBindingInput): Sha256 {
  return sha256DeterministicRecord({
    attemptId: input.attempt.attemptId,
    attemptSubcapMicroUsd: input.facts.attemptSubcapMicroUsd,
    authorizationHash: input.facts.authorizationHash,
    cancelRequested: input.facts.cancelRequested,
    deadlineEpochMs: input.facts.deadlineEpochMs,
    executionProfileHash: input.attempt.executionProfileHash,
    executionProfileId: input.attempt.executionProfileId,
    inputHash: input.attempt.inputHash,
    ownerHash: input.task.ownerHash,
    reservationMicroUsd: input.facts.reservationMicroUsd,
    schemaVersion: "provider-sandbox-attempt-binding/v1",
    taskCapMicroUsd: input.facts.taskCapMicroUsd,
    taskHash: input.task.taskHash,
    taskId: input.task.taskId,
  });
}

export function hashSandboxEvidence(payload: SandboxAttemptEvidencePayload): Sha256 {
  return sha256DeterministicRecord(payload as unknown as DeterministicValue);
}

export function deepFreeze<Value>(value: Value): Value {
  if (typeof value !== "object" || value === null || objectIsFrozen(value)) return value;
  for (const child of objectValues(value)) deepFreeze(child);
  return objectFreeze(value);
}

import { createHash } from "node:crypto";

import type {
  SandboxAttemptEvidencePayload,
  SandboxAttemptIdentity,
  SandboxOwner,
  SandboxTaskIdentity,
  Sha256,
} from "./types.js";

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;

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
  return `{${Object.keys(record)
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

export function hashSandboxAttemptBinding(
  task: SandboxTaskIdentity,
  attempt: SandboxAttemptIdentity,
): Sha256 {
  return sha256DeterministicRecord({
    attemptId: attempt.attemptId,
    executionProfileHash: attempt.executionProfileHash,
    executionProfileId: attempt.executionProfileId,
    inputHash: attempt.inputHash,
    ownerHash: task.ownerHash,
    schemaVersion: "provider-sandbox-attempt-binding/v1",
    taskHash: task.taskHash,
    taskId: task.taskId,
  });
}

export function hashSandboxEvidence(payload: SandboxAttemptEvidencePayload): Sha256 {
  return sha256DeterministicRecord(payload as unknown as DeterministicValue);
}

export function deepFreeze<Value>(value: Value): Value {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

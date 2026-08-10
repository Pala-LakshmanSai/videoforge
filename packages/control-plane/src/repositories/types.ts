/** JSON values accepted at repository boundaries. Binary data stays in the artifact store. */
export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export type EntityId = string;
export type WorkspaceId = EntityId;
export type UtcTimestamp = string;
export type Sha256 = `sha256:${string}`;
export type Currency = "USD";
export type MicroUsd = bigint;

/** Every repository operation is scoped before any entity identifier is considered. */
export interface WorkspaceScope {
  readonly workspaceId: WorkspaceId;
}

/** Use for commands whose actor must be derived from authenticated server state. */
export interface WorkspaceActorScope extends WorkspaceScope {
  readonly actorUserId: EntityId;
}

declare const deterministicIdempotencyKeyBrand: unique symbol;

/**
 * A caller-derived stable key for one logical mutation. Adapters must reject a key reused with
 * different inputs; random retry keys do not satisfy this contract.
 */
export type DeterministicIdempotencyKey = string & {
  readonly [deterministicIdempotencyKeyBrand]: true;
};

/** Validates the storage shape; callers still own deriving the value from stable logical inputs. */
export function deterministicIdempotencyKey(value: string): DeterministicIdempotencyKey {
  if (value.length < 1 || value.length > 240 || value !== value.trim()) {
    throw new RangeError("idempotency key must be trimmed and contain 1 to 240 characters");
  }
  return value as DeterministicIdempotencyKey;
}

export interface IdempotentMutation {
  readonly idempotencyKey: DeterministicIdempotencyKey;
}

export interface RepositorySuccess<Value> {
  readonly ok: true;
  readonly value: Value;
}

export interface RepositoryConflict<Code extends string = string> {
  readonly ok: false;
  readonly kind: "CONFLICT";
  readonly code: Code;
  readonly message: string;
  readonly currentVersion?: number;
}

export interface RepositoryNotFound<Entity extends string = string> {
  readonly ok: false;
  readonly kind: "NOT_FOUND";
  readonly entity: Entity;
  readonly id: EntityId;
}

export interface RepositoryInvariantViolation<Code extends string = string> {
  readonly ok: false;
  readonly kind: "INVARIANT_VIOLATION";
  readonly code: Code;
  readonly message: string;
}

/** Expected domain outcomes. Infrastructure faults still reject the returned promise. */
export type RepositoryResult<
  Value,
  ConflictCode extends string = string,
  MissingEntity extends string = string,
  InvariantCode extends string = string,
> =
  | RepositorySuccess<Value>
  | RepositoryConflict<ConflictCode>
  | RepositoryNotFound<MissingEntity>
  | RepositoryInvariantViolation<InvariantCode>;

export interface IdempotentWrite<Value> {
  readonly value: Value;
  /** True when the adapter returned the already-committed result for the same input fingerprint. */
  readonly replayed: boolean;
}

export type IdempotentRepositoryResult<
  Value,
  ConflictCode extends string = string,
  MissingEntity extends string = string,
  InvariantCode extends string = string,
> = RepositoryResult<IdempotentWrite<Value>, ConflictCode, MissingEntity, InvariantCode>;

export interface CanonicalDocument {
  readonly contractName: string;
  readonly contractVersion: string;
  readonly payload: JsonObject;
  readonly canonicalDocumentSha256: Sha256;
}

export interface BinaryContentAddress {
  readonly binarySha256: Sha256;
  readonly byteSize: bigint;
}

/** One and only one concrete owner column is populated for a durable task/cost/workflow. */
export type DurableOwner =
  | {
      readonly ownerType: "PROJECT_REVISION";
      readonly ownerId: EntityId;
      readonly projectRevisionId: EntityId;
    }
  | {
      readonly ownerType: "IMAGE_STYLE_VERSION";
      readonly ownerId: EntityId;
      readonly imageStyleVersionId: EntityId;
    }
  | {
      readonly ownerType: "AVATAR_PROFILE_VERSION";
      readonly ownerId: EntityId;
      readonly avatarProfileVersionId: EntityId;
    };

export type CommonConflictCode =
  | "ACTIVE_NAME_TAKEN"
  | "ALREADY_EXISTS"
  | "EXPECTED_VERSION_MISMATCH"
  | "IDEMPOTENCY_KEY_REUSED"
  | "OPEN_DRAFT_EXISTS"
  | "SEQUENCE_CONFLICT"
  | "STATE_CONFLICT";

export type CommonInvariantCode =
  | "AUTHORIZATION_REQUIRED"
  | "CONTENT_ADDRESS_MISMATCH"
  | "CROSS_WORKSPACE_REFERENCE"
  | "IMMUTABLE_RECORD"
  | "INVALID_IDEMPOTENCY_KEY"
  | "INVALID_MONEY"
  | "INVALID_STATE_TRANSITION"
  | "SNAPSHOT_MISMATCH";

import type {
  AttemptState,
  ClaimState,
  DispatchState,
  OutboxState,
  TaskLane,
  TaskState,
} from "../database/vocabulary.js";
import type { CostEventRecord } from "./events.js";
import type {
  CommonConflictCode,
  CommonInvariantCode,
  DeterministicIdempotencyKey,
  DurableOwner,
  EntityId,
  IdempotentMutation,
  IdempotentRepositoryResult,
  JsonObject,
  RepositoryResult,
  Sha256,
  UtcTimestamp,
  WorkspaceScope,
} from "./types.js";

export type ResultDisposition = "PENDING" | "ACCEPTED" | "REJECTED";
export type OutboxKind = "DISPATCH" | "CANCEL" | "CALLBACK_RECONCILE";

export interface GenerationTaskRecord {
  readonly taskId: EntityId;
  readonly workspaceId: EntityId;
  readonly owner: DurableOwner;
  readonly taskKey: string;
  readonly lane: TaskLane;
  readonly state: TaskState;
  readonly required: boolean;
  readonly dependsOn: readonly EntityId[];
  readonly acceptedAttemptId: EntityId | null;
  readonly version: number;
  readonly createdAt: UtcTimestamp;
  readonly updatedAt: UtcTimestamp;
  readonly cancelRequestedAt: UtcTimestamp | null;
  readonly finishedAt: UtcTimestamp | null;
}

export interface AttemptRecord {
  readonly attemptId: EntityId;
  readonly workspaceId: EntityId;
  readonly taskId: EntityId;
  readonly ordinal: number;
  readonly idempotencyKey: DeterministicIdempotencyKey;
  readonly state: AttemptState;
  readonly dispatchState: DispatchState;
  readonly claimState: ClaimState;
  readonly executionProfileId: EntityId;
  readonly executionClaimTokenHash: Sha256;
  readonly externalJobId: string | null;
  readonly inputHash: Sha256;
  readonly outputAssetId: EntityId | null;
  readonly resultDisposition: ResultDisposition;
  readonly parentAttemptId: EntityId | null;
  readonly fallbackReason: string | null;
  readonly problemCode: string | null;
  readonly providerDetails: JsonObject;
  readonly createdAt: UtcTimestamp;
  readonly claimedAt: UtcTimestamp | null;
  readonly startedAt: UtcTimestamp | null;
  readonly finishedAt: UtcTimestamp | null;
}

export interface OutboxRecord {
  readonly outboxId: EntityId;
  readonly workspaceId: EntityId;
  readonly taskId: EntityId;
  readonly attemptId: EntityId;
  readonly kind: OutboxKind;
  readonly state: OutboxState;
  readonly dedupeKey: DeterministicIdempotencyKey;
  readonly payloadContractName: string;
  readonly payloadContractVersion: string;
  readonly payloadHash: Sha256;
  readonly payload: JsonObject;
  readonly availableAt: UtcTimestamp;
  readonly leaseOwner: string | null;
  readonly leaseExpiresAt: UtcTimestamp | null;
  readonly deliveredAt: UtcTimestamp | null;
  readonly createdAt: UtcTimestamp;
  readonly updatedAt: UtcTimestamp;
}

export interface TaskReservationInput {
  readonly taskId: EntityId;
  readonly owner: DurableOwner;
  readonly taskKey: string;
  readonly lane: TaskLane;
  readonly initialState: "PENDING" | "READY";
  readonly required: boolean;
  readonly dependsOn: readonly EntityId[];
}

export interface AttemptReservationInput {
  readonly attemptId: EntityId;
  readonly ordinal: number;
  readonly idempotencyKey: DeterministicIdempotencyKey;
  readonly executionProfileId: EntityId;
  readonly executionClaimTokenHash: Sha256;
  readonly inputHash: Sha256;
  readonly parentAttemptId: EntityId | null;
  readonly fallbackReason: string | null;
}

export interface CostReservationInput {
  readonly costEventId: EntityId;
  readonly sequence: number;
  readonly amountMicroUsd: bigint;
  readonly idempotencyKey: DeterministicIdempotencyKey;
  readonly details: JsonObject;
  readonly occurredAt: UtcTimestamp;
}

export interface DispatchOutboxInput {
  readonly outboxId: EntityId;
  readonly dedupeKey: DeterministicIdempotencyKey;
  readonly payloadContractName: string;
  readonly payloadContractVersion: string;
  readonly payloadHash: Sha256;
  readonly payload: JsonObject;
  readonly availableAt: UtcTimestamp;
}

/** All four records are committed or none are; every retry key is caller-derived and stable. */
export interface ReserveTaskAttemptCommand extends IdempotentMutation {
  readonly task: TaskReservationInput;
  readonly attempt: AttemptReservationInput;
  readonly costReservation: CostReservationInput;
  readonly dispatchOutbox: DispatchOutboxInput;
}

export interface AtomicTaskAttemptReservation {
  readonly task: GenerationTaskRecord;
  readonly attempt: ReservedAttemptRecord;
  readonly costReservation: ReservedCostEventRecord;
  readonly dispatchOutbox: PendingDispatchOutboxRecord;
}

export interface ReservedAttemptRecord extends AttemptRecord {
  readonly state: "CREATED";
  readonly dispatchState: "NOT_SENT";
  readonly claimState: "UNCLAIMED";
  readonly externalJobId: null;
  readonly outputAssetId: null;
  readonly resultDisposition: "PENDING";
}

export interface ReservedCostEventRecord extends CostEventRecord {
  readonly eventType: "RESERVED";
}

export interface PendingDispatchOutboxRecord extends OutboxRecord {
  readonly kind: "DISPATCH";
  readonly state: "PENDING";
  readonly leaseOwner: null;
  readonly leaseExpiresAt: null;
  readonly deliveredAt: null;
}

export interface ClaimExecutionCommand extends IdempotentMutation {
  readonly taskId: EntityId;
  readonly attemptId: EntityId;
  readonly presentedClaimTokenHash: Sha256;
  readonly expectedTaskVersion: number;
  readonly claimedAt: UtcTimestamp;
}

export interface ExecutionClaim {
  readonly kind: "EXECUTION_CLAIM";
  readonly completion: "NOT_ACCEPTED";
  readonly taskId: EntityId;
  readonly attemptId: EntityId;
  readonly claimState: "CLAIMED";
  readonly claimedAt: UtcTimestamp;
}

export interface RecordDispatchAcknowledgedCommand extends IdempotentMutation {
  readonly taskId: EntityId;
  readonly attemptId: EntityId;
  readonly externalJobId: string;
  readonly providerDetails: JsonObject;
  readonly acknowledgedAt: UtcTimestamp;
}

export interface ProviderDispatchAcknowledgement {
  readonly kind: "PROVIDER_DISPATCH_ACKNOWLEDGED";
  readonly completion: "NOT_ACCEPTED";
  readonly taskId: EntityId;
  readonly attemptId: EntityId;
  readonly dispatchState: "ACKNOWLEDGED";
  readonly externalJobId: string;
  readonly acknowledgedAt: UtcTimestamp;
}

export interface RecordDispatchAckUnknownCommand extends IdempotentMutation {
  readonly taskId: EntityId;
  readonly attemptId: EntityId;
  readonly providerDetails: JsonObject;
  readonly ambiguityReason: string;
  readonly observedAt: UtcTimestamp;
}

export interface ProviderDispatchAckUnknown {
  readonly kind: "PROVIDER_DISPATCH_ACK_UNKNOWN";
  readonly completion: "NOT_ACCEPTED";
  readonly taskId: EntityId;
  readonly attemptId: EntityId;
  readonly dispatchState: "AMBIGUOUS";
  readonly observedAt: UtcTimestamp;
}

export type DispatchReconciliationEvidence =
  | {
      readonly outcome: "ACKNOWLEDGEMENT_CONFIRMED";
      readonly externalJobId: string;
      readonly evidenceHash: Sha256;
    }
  | {
      readonly outcome: "NOT_DISPATCHED_CONFIRMED";
      readonly evidenceHash: Sha256;
    }
  | {
      readonly outcome: "STILL_UNKNOWN";
      readonly evidenceHash: Sha256;
    };

export interface ReconcileDispatchCommand extends IdempotentMutation {
  readonly taskId: EntityId;
  readonly attemptId: EntityId;
  readonly evidence: DispatchReconciliationEvidence;
  readonly reconciledAt: UtcTimestamp;
}

export interface DispatchReconciliation {
  readonly kind: "DISPATCH_RECONCILIATION";
  readonly completion: "NOT_ACCEPTED";
  readonly taskId: EntityId;
  readonly attemptId: EntityId;
  readonly dispatchState: "RECONCILED" | "AMBIGUOUS";
  readonly evidence: DispatchReconciliationEvidence;
  readonly reconciledAt: UtcTimestamp;
}

export interface RequestCancellationCommand extends IdempotentMutation {
  readonly taskId: EntityId;
  readonly attemptId: EntityId | null;
  readonly expectedTaskVersion: number;
  readonly requestedAt: UtcTimestamp;
  readonly outbox: Omit<DispatchOutboxInput, "outboxId"> & { readonly outboxId: EntityId };
}

export interface CancellationRequest {
  readonly kind: "CANCELLATION_REQUESTED";
  readonly completion: "NOT_ACCEPTED";
  readonly task: GenerationTaskRecord;
  readonly outbox: OutboxRecord;
}

export interface RecordSuccessfulAttemptCommand extends IdempotentMutation {
  readonly taskId: EntityId;
  readonly attemptId: EntityId;
  readonly outputAssetId: EntityId;
  readonly outputBinarySha256: Sha256;
  readonly providerDetails: JsonObject;
  readonly finishedAt: UtcTimestamp;
}

/** A verified successful candidate is still not accepted and cannot complete its task by itself. */
export interface SuccessfulAttemptCandidate {
  readonly kind: "SUCCESSFUL_ATTEMPT_CANDIDATE";
  readonly completion: "NOT_ACCEPTED";
  readonly taskId: EntityId;
  readonly attemptId: EntityId;
  readonly outputAssetId: EntityId;
  readonly outputBinarySha256: Sha256;
  readonly state: "SUCCEEDED";
  readonly resultDisposition: "PENDING";
  readonly finishedAt: UtcTimestamp;
}

export interface RecordTerminalAttemptCommand extends IdempotentMutation {
  readonly taskId: EntityId;
  readonly attemptId: EntityId;
  readonly state: "FAILED" | "CANCELLED" | "UNKNOWN";
  readonly problemCode: string;
  readonly providerDetails: JsonObject;
  readonly finishedAt: UtcTimestamp;
}

export interface TerminalAttemptResult {
  readonly kind: "TERMINAL_ATTEMPT_RESULT";
  readonly completion: "NOT_ACCEPTED";
  readonly attempt: AttemptRecord;
}

export interface AcceptSuccessfulResultCommand extends IdempotentMutation {
  /** Deliberately cannot be satisfied by ProviderDispatchAcknowledgement/AckUnknown. */
  readonly candidate: SuccessfulAttemptCandidate;
  readonly expectedTaskVersion: number;
  readonly acceptedAt: UtcTimestamp;
}

export interface AcceptedAttemptResult {
  readonly kind: "ACCEPTED_ATTEMPT_RESULT";
  readonly completion: "ACCEPTED";
  readonly taskId: EntityId;
  readonly attemptId: EntityId;
  readonly outputAssetId: EntityId;
  readonly outputBinarySha256: Sha256;
  readonly acceptedAt: UtcTimestamp;
}

export interface TaskLookup {
  readonly taskId: EntityId;
}

export interface AttemptListQuery {
  readonly taskId: EntityId;
}

export type ExecutionConflict =
  | CommonConflictCode
  | "ACCEPTED_RESULT_EXISTS"
  | "CLAIM_ALREADY_CONSUMED"
  | "EXTERNAL_JOB_ID_EXISTS"
  | "TASK_KEY_EXISTS";
export type ExecutionMissing = "ASSET" | "ATTEMPT" | "EXECUTION_PROFILE" | "TASK";
export type ExecutionInvariant =
  | CommonInvariantCode
  | "ATTEMPT_NOT_SUCCESSFUL"
  | "CLAIM_TOKEN_MISMATCH"
  | "DISPATCH_ACK_IS_NOT_COMPLETION"
  | "DISPATCH_REQUIRES_RECONCILIATION"
  | "OWNER_REFERENCE_MISMATCH"
  | "RESULT_ASSET_NOT_VERIFIED"
  | "TASK_ATTEMPT_MISMATCH";

export interface ExecutionRepository {
  reserveTaskAttempt(
    scope: WorkspaceScope,
    command: ReserveTaskAttemptCommand,
  ): Promise<
    IdempotentRepositoryResult<
      AtomicTaskAttemptReservation,
      ExecutionConflict,
      ExecutionMissing,
      ExecutionInvariant
    >
  >;

  claimExecution(
    scope: WorkspaceScope,
    command: ClaimExecutionCommand,
  ): Promise<
    IdempotentRepositoryResult<
      ExecutionClaim,
      ExecutionConflict,
      ExecutionMissing,
      ExecutionInvariant
    >
  >;

  recordDispatchAcknowledged(
    scope: WorkspaceScope,
    command: RecordDispatchAcknowledgedCommand,
  ): Promise<
    IdempotentRepositoryResult<
      ProviderDispatchAcknowledgement,
      ExecutionConflict,
      ExecutionMissing,
      ExecutionInvariant
    >
  >;

  recordDispatchAckUnknown(
    scope: WorkspaceScope,
    command: RecordDispatchAckUnknownCommand,
  ): Promise<
    IdempotentRepositoryResult<
      ProviderDispatchAckUnknown,
      ExecutionConflict,
      ExecutionMissing,
      ExecutionInvariant
    >
  >;

  reconcileDispatch(
    scope: WorkspaceScope,
    command: ReconcileDispatchCommand,
  ): Promise<
    IdempotentRepositoryResult<
      DispatchReconciliation,
      ExecutionConflict,
      ExecutionMissing,
      ExecutionInvariant
    >
  >;

  requestCancellation(
    scope: WorkspaceScope,
    command: RequestCancellationCommand,
  ): Promise<
    IdempotentRepositoryResult<
      CancellationRequest,
      ExecutionConflict,
      ExecutionMissing,
      ExecutionInvariant
    >
  >;

  recordSuccessfulResult(
    scope: WorkspaceScope,
    command: RecordSuccessfulAttemptCommand,
  ): Promise<
    IdempotentRepositoryResult<
      SuccessfulAttemptCandidate,
      ExecutionConflict,
      ExecutionMissing,
      ExecutionInvariant
    >
  >;

  recordTerminalResult(
    scope: WorkspaceScope,
    command: RecordTerminalAttemptCommand,
  ): Promise<
    IdempotentRepositoryResult<
      TerminalAttemptResult,
      ExecutionConflict,
      ExecutionMissing,
      ExecutionInvariant
    >
  >;

  acceptSuccessfulResult(
    scope: WorkspaceScope,
    command: AcceptSuccessfulResultCommand,
  ): Promise<
    IdempotentRepositoryResult<
      AcceptedAttemptResult,
      ExecutionConflict,
      ExecutionMissing,
      ExecutionInvariant
    >
  >;

  resolveTask(
    scope: WorkspaceScope,
    lookup: TaskLookup,
  ): Promise<
    RepositoryResult<GenerationTaskRecord, ExecutionConflict, ExecutionMissing, ExecutionInvariant>
  >;

  listAttempts(
    scope: WorkspaceScope,
    query: AttemptListQuery,
  ): Promise<
    RepositoryResult<
      readonly AttemptRecord[],
      ExecutionConflict,
      ExecutionMissing,
      ExecutionInvariant
    >
  >;
}

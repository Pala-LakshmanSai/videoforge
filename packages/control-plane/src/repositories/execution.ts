import type {
  AttemptState,
  ClaimState,
  DispatchState,
  OutboxState,
  TaskLane,
  TaskState,
} from "../database/vocabulary.js";
import type { CostEventRecord, TaskCostSummary } from "./events.js";
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

export interface AttemptRecordBase {
  readonly attemptId: EntityId;
  readonly workspaceId: EntityId;
  readonly taskId: EntityId;
  readonly ordinal: number;
  readonly idempotencyKey: DeterministicIdempotencyKey;
  readonly claimState: ClaimState;
  readonly executionProfileId: EntityId;
  readonly executionClaimTokenHash: Sha256;
  readonly externalJobId: string | null;
  readonly inputHash: Sha256;
  readonly parentAttemptId: EntityId | null;
  readonly fallbackReason: string | null;
  readonly providerDetails: JsonObject;
  readonly createdAt: UtcTimestamp;
  readonly claimedAt: UtcTimestamp | null;
  readonly startedAt: UtcTimestamp | null;
}

export interface NonUnknownAttemptRecord extends AttemptRecordBase {
  readonly state: Exclude<AttemptState, "UNKNOWN">;
  readonly dispatchState: DispatchState;
  readonly outputAssetId: EntityId | null;
  readonly resultDisposition: ResultDisposition;
  readonly problemCode: string | null;
  readonly finishedAt: UtcTimestamp | null;
}

export type AttemptRecord = NonUnknownAttemptRecord | UnknownAttemptRecord;

export interface OutboxRecord {
  readonly outboxId: EntityId;
  /** Derived by the database from the owning workspace; never supplied by a caller. */
  readonly accountId: EntityId;
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

export interface CancellationOutboxInput extends DispatchOutboxInput {
  readonly kind: "CANCEL";
}

/**
 * All four records are committed or none are; every retry key is caller-derived and stable. The
 * outer logical-write key equals `attempt.idempotencyKey`, which is its durable relational anchor.
 */
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

export type DurableOwnerOf<OwnerType extends DurableOwner["ownerType"]> = Extract<
  DurableOwner,
  { readonly ownerType: OwnerType }
>;

/** Narrows the general atomic reservation to the durable owner billed by a preset action. */
export type OwnerScopedReserveTaskAttemptCommand<Owner extends DurableOwner> = Omit<
  ReserveTaskAttemptCommand,
  "task"
> & {
  readonly task: Omit<TaskReservationInput, "owner"> & { readonly owner: Owner };
};

export type OwnerScopedAtomicTaskAttemptReservation<Owner extends DurableOwner> = Omit<
  AtomicTaskAttemptReservation,
  "costReservation" | "task"
> & {
  readonly task: GenerationTaskRecord & { readonly owner: Owner };
  readonly costReservation: ReservedCostEventRecord & { readonly owner: Owner };
};

export type ImageStyleVersionOwner = DurableOwnerOf<"IMAGE_STYLE_VERSION">;
export type AvatarProfileVersionOwner = DurableOwnerOf<"AVATAR_PROFILE_VERSION">;
export type ImageStyleVersionTaskAttemptReservationCommand =
  OwnerScopedReserveTaskAttemptCommand<ImageStyleVersionOwner>;
export type AvatarProfileVersionTaskAttemptReservationCommand =
  OwnerScopedReserveTaskAttemptCommand<AvatarProfileVersionOwner>;
export type ImageStyleVersionTaskAttemptReservation =
  OwnerScopedAtomicTaskAttemptReservation<ImageStyleVersionOwner>;
export type AvatarProfileVersionTaskAttemptReservation =
  OwnerScopedAtomicTaskAttemptReservation<AvatarProfileVersionOwner>;

export interface ReservedAttemptRecord extends AttemptRecordBase {
  readonly state: "CREATED";
  readonly dispatchState: "NOT_SENT";
  readonly claimState: "UNCLAIMED";
  readonly externalJobId: null;
  readonly outputAssetId: null;
  readonly resultDisposition: "PENDING";
  readonly problemCode: null;
  readonly finishedAt: null;
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
  readonly dispatchState: "NOT_SENT" | "RECONCILED" | "AMBIGUOUS";
  readonly evidence: DispatchReconciliationEvidence;
  readonly reconciledAt: UtcTimestamp;
}

export interface RequestTaskOnlyCancellationCommand extends IdempotentMutation {
  readonly target: "TASK_ONLY";
  readonly taskId: EntityId;
  readonly expectedTaskVersion: number;
  readonly requestedAt: UtcTimestamp;
}

export interface RequestAttemptCancellationCommand extends IdempotentMutation {
  readonly target: "ATTEMPT";
  readonly taskId: EntityId;
  readonly attemptId: EntityId;
  readonly expectedTaskVersion: number;
  readonly requestedAt: UtcTimestamp;
  readonly outbox: CancellationOutboxInput;
}

export type RequestCancellationCommand =
  | RequestTaskOnlyCancellationCommand
  | RequestAttemptCancellationCommand;

export interface CancelledTaskRecord extends GenerationTaskRecord {
  readonly state: "CANCELLED";
  readonly acceptedAttemptId: null;
  readonly cancelRequestedAt: UtcTimestamp;
  readonly finishedAt: UtcTimestamp;
}

export interface CancelRequestedTaskRecord extends GenerationTaskRecord {
  readonly state: "CANCEL_REQUESTED";
  readonly acceptedAttemptId: null;
  readonly cancelRequestedAt: UtcTimestamp;
  readonly finishedAt: null;
}

export interface PendingCancellationOutboxRecord extends OutboxRecord {
  readonly kind: "CANCEL";
  readonly state: "PENDING";
  readonly leaseOwner: null;
  readonly leaseExpiresAt: null;
  readonly deliveredAt: null;
}

/** A task with no dispatched attempt cancels locally and must not fabricate a provider outbox row. */
export interface TaskOnlyCancellation {
  readonly kind: "TASK_ONLY_CANCELLATION";
  readonly completion: "NOT_ACCEPTED";
  readonly target: "TASK_ONLY";
  readonly task: CancelledTaskRecord;
  readonly outbox: null;
}

/** A dispatched attempt enters cancel-requested state together with its durable CANCEL outbox row. */
export interface AttemptCancellationRequest {
  readonly kind: "ATTEMPT_CANCELLATION_REQUESTED";
  readonly completion: "NOT_ACCEPTED";
  readonly target: "ATTEMPT";
  readonly task: CancelRequestedTaskRecord;
  readonly attemptId: EntityId;
  readonly outbox: PendingCancellationOutboxRecord;
}

export type CancellationRequest = TaskOnlyCancellation | AttemptCancellationRequest;

export interface RecordSuccessfulAttemptCommand extends IdempotentMutation {
  readonly taskId: EntityId;
  readonly attemptId: EntityId;
  readonly outputAssetId: EntityId;
  readonly outputBinarySha256: Sha256;
  readonly providerDetails: JsonObject;
  readonly finishedAt: UtcTimestamp;
}

export interface SuccessfulUnacceptedAttemptRecord extends AttemptRecordBase {
  readonly state: "SUCCEEDED";
  readonly dispatchState: DispatchState;
  readonly outputAssetId: EntityId;
  readonly resultDisposition: "PENDING";
  readonly problemCode: null;
  readonly finishedAt: UtcTimestamp;
}

export interface SuccessfulAttemptReference {
  readonly kind: "RECORDED_SUCCESSFUL_ATTEMPT";
  readonly taskId: EntityId;
  readonly attemptId: EntityId;
  /** Task version observed when the repository durably recorded the successful result. */
  readonly expectedTaskVersion: number;
}

/**
 * A repository-issued view of one verified successful attempt. It is still not accepted and cannot
 * complete its task by itself. Acceptance consumes only `reference`; the adapter must re-read the
 * attempt, verified asset, checksum, and task version rather than trusting this returned snapshot.
 */
export interface SuccessfulAttemptCandidate {
  readonly kind: "SUCCESSFUL_ATTEMPT_CANDIDATE";
  readonly completion: "NOT_ACCEPTED";
  readonly reference: SuccessfulAttemptReference;
  readonly attempt: SuccessfulUnacceptedAttemptRecord;
  readonly outputBinarySha256: Sha256;
}

export interface RecordTerminalAttemptCommand extends IdempotentMutation {
  readonly taskId: EntityId;
  readonly attemptId: EntityId;
  readonly state: "FAILED" | "CANCELLED";
  readonly problemCode: string;
  readonly providerDetails: JsonObject;
  readonly finishedAt: UtcTimestamp;
}

export interface TerminalAttemptRecord extends AttemptRecordBase {
  readonly state: "FAILED" | "CANCELLED";
  readonly dispatchState: DispatchState;
  readonly outputAssetId: null;
  readonly resultDisposition: "REJECTED";
  readonly problemCode: string;
  readonly finishedAt: UtcTimestamp;
}

export interface TerminalAttemptResult {
  readonly kind: "TERMINAL_ATTEMPT_RESULT";
  readonly completion: "NOT_ACCEPTED";
  readonly attempt: TerminalAttemptRecord;
}

/**
 * Finalizes a previously requested attempt cancellation only after the attempt itself is durably
 * terminal and no sibling attempt remains active. This closes the cancellation lifecycle without
 * fabricating provider acknowledgement or discarding partial cost/artifact lineage.
 */
export interface SettleAttemptCancellationCommand extends IdempotentMutation {
  readonly taskId: EntityId;
  readonly attemptId: EntityId;
  readonly expectedTaskVersion: number;
  readonly settledAt: UtcTimestamp;
}

export interface SettledAttemptCancellation {
  readonly kind: "ATTEMPT_CANCELLATION_SETTLED";
  readonly completion: "NOT_ACCEPTED";
  readonly task: CancelledTaskRecord;
  readonly attempt: TerminalAttemptRecord & { readonly state: "CANCELLED" };
  readonly settledAt: UtcTimestamp;
}

/** UNKNOWN is a durable ambiguity requiring reconciliation, not a finished/terminal outcome. */
export interface RecordUnknownAttemptCommand extends IdempotentMutation {
  readonly taskId: EntityId;
  readonly attemptId: EntityId;
  readonly problemCode: string;
  readonly providerDetails: JsonObject;
  readonly observedAt: UtcTimestamp;
}

export interface UnknownAttemptRecord extends AttemptRecordBase {
  readonly state: "UNKNOWN";
  readonly dispatchState: "AMBIGUOUS";
  readonly outputAssetId: null;
  readonly resultDisposition: "PENDING";
  readonly problemCode: string;
  readonly finishedAt: null;
}

export interface UnknownAttemptResult {
  readonly kind: "UNKNOWN_ATTEMPT_REQUIRES_RECONCILIATION";
  readonly completion: "NOT_ACCEPTED";
  readonly reconciliationRequired: true;
  readonly observedAt: UtcTimestamp;
  readonly attempt: UnknownAttemptRecord;
}

export interface AcceptSuccessfulResultCommand extends IdempotentMutation {
  /**
   * Provider acknowledgements have no successful-attempt reference and cannot satisfy this type.
   * The adapter must atomically re-read the reference and validate a SUCCEEDED/PENDING attempt, its
   * verified output asset/checksum, the expected task version, and absence of an accepted result.
   */
  readonly candidateReference: SuccessfulAttemptReference;
  readonly acceptedAt: UtcTimestamp;
}

export interface CompletedGenerationTaskRecord extends GenerationTaskRecord {
  readonly state: "COMPLETE";
  readonly acceptedAttemptId: EntityId;
  readonly finishedAt: UtcTimestamp;
}

export interface AcceptedAttemptRecord extends AttemptRecordBase {
  readonly state: "SUCCEEDED";
  readonly dispatchState: DispatchState;
  readonly outputAssetId: EntityId;
  readonly resultDisposition: "ACCEPTED";
  readonly problemCode: null;
  readonly finishedAt: UtcTimestamp;
}

export interface AcceptedAttemptResult {
  readonly kind: "ACCEPTED_ATTEMPT_RESULT";
  readonly completion: "ACCEPTED";
  readonly task: CompletedGenerationTaskRecord;
  readonly attempt: AcceptedAttemptRecord;
  readonly outputBinarySha256: Sha256;
  readonly acceptedAt: UtcTimestamp;
}

export interface TaskLookup {
  readonly taskId: EntityId;
}

export interface AttemptListQuery {
  readonly taskId: EntityId;
}

export interface RecoveryTaskFactsQuery {
  readonly taskId: EntityId;
}

/** One bounded SQL snapshot used by recovery status projection. */
export interface RecoveryTaskFacts {
  readonly task: GenerationTaskRecord;
  readonly attemptCount: number;
  readonly claimedAttemptCount: number;
  readonly acceptedAttemptCount: number;
  readonly ambiguousAttemptCount: number;
  readonly activeAttemptCount: number;
  readonly reconcilingAttemptCount: number;
  readonly runningAttemptCount: number;
  readonly dispatchOutboxCount: number;
  readonly cancellationOutboxCount: number;
  readonly deadLetterOutboxCount: number;
  readonly cost: TaskCostSummary;
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
    command: RequestTaskOnlyCancellationCommand,
  ): Promise<
    IdempotentRepositoryResult<
      TaskOnlyCancellation,
      ExecutionConflict,
      ExecutionMissing,
      ExecutionInvariant
    >
  >;

  requestCancellation(
    scope: WorkspaceScope,
    command: RequestAttemptCancellationCommand,
  ): Promise<
    IdempotentRepositoryResult<
      AttemptCancellationRequest,
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

  settleAttemptCancellation(
    scope: WorkspaceScope,
    command: SettleAttemptCancellationCommand,
  ): Promise<
    IdempotentRepositoryResult<
      SettledAttemptCancellation,
      ExecutionConflict,
      ExecutionMissing,
      ExecutionInvariant
    >
  >;

  recordUnknownAttempt(
    scope: WorkspaceScope,
    command: RecordUnknownAttemptCommand,
  ): Promise<
    IdempotentRepositoryResult<
      UnknownAttemptResult,
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

  resolveRecoveryTaskFacts(
    scope: WorkspaceScope,
    query: RecoveryTaskFactsQuery,
  ): Promise<
    RepositoryResult<RecoveryTaskFacts, ExecutionConflict, ExecutionMissing, ExecutionInvariant>
  >;
}

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

export type WorkflowEventKind =
  | "WORKFLOW_CREATED"
  | "TASK_READY"
  | "ATTEMPT_CREATED"
  | "DISPATCH_RECORDED"
  | "DISPATCH_ACKNOWLEDGED"
  | "ATTEMPT_SUCCEEDED"
  | "ATTEMPT_FAILED"
  | "CANCEL_REQUESTED"
  | "RECONCILIATION_RECORDED"
  | "WORKFLOW_READY_FOR_REVIEW"
  | "WORKFLOW_APPROVED";

export type WorkflowAggregate =
  | {
      readonly aggregateType: "WORKFLOW";
      readonly aggregateId: EntityId;
      readonly taskId: null;
      readonly attemptId: null;
    }
  | {
      readonly aggregateType: "TASK";
      readonly aggregateId: EntityId;
      readonly taskId: EntityId;
      readonly attemptId: null;
    }
  | {
      readonly aggregateType: "ATTEMPT";
      readonly aggregateId: EntityId;
      readonly taskId: EntityId;
      readonly attemptId: EntityId;
    };

export interface WorkflowEventRecord {
  readonly eventId: EntityId;
  readonly workspaceId: EntityId;
  readonly workflowInstanceId: EntityId;
  readonly aggregate: WorkflowAggregate;
  readonly sequence: number;
  readonly kind: WorkflowEventKind;
  readonly payloadContractName: string;
  readonly payloadContractVersion: string;
  readonly payloadHash: Sha256;
  readonly payload: JsonObject;
  readonly occurredAt: UtcTimestamp;
  readonly createdAt: UtcTimestamp;
}

export interface AppendWorkflowEventCommand extends IdempotentMutation {
  readonly eventId: EntityId;
  readonly workflowInstanceId: EntityId;
  readonly aggregate: WorkflowAggregate;
  readonly sequence: number;
  readonly kind: WorkflowEventKind;
  readonly payloadContractName: string;
  readonly payloadContractVersion: string;
  readonly payloadHash: Sha256;
  readonly payload: JsonObject;
  readonly occurredAt: UtcTimestamp;
}

export type CostEventType =
  | "ESTIMATED"
  | "RESERVED"
  | "REPORTED"
  | "SETTLED"
  | "RELEASED"
  | "REFUNDED";

export interface CostEventRecord {
  readonly costEventId: EntityId;
  readonly workspaceId: EntityId;
  readonly owner: DurableOwner;
  readonly taskId: EntityId;
  readonly attemptId: EntityId;
  readonly sequence: number;
  readonly eventType: CostEventType;
  readonly amountMicroUsd: bigint;
  readonly currency: "USD";
  readonly idempotencyKey: DeterministicIdempotencyKey;
  readonly providerReference: string | null;
  readonly details: JsonObject;
  readonly occurredAt: UtcTimestamp;
  readonly createdAt: UtcTimestamp;
}

export interface AppendCostEventCommand extends IdempotentMutation {
  readonly costEventId: EntityId;
  readonly owner: DurableOwner;
  readonly taskId: EntityId;
  readonly attemptId: EntityId;
  readonly sequence: number;
  readonly eventType: CostEventType;
  readonly amountMicroUsd: bigint;
  readonly providerReference: string | null;
  readonly details: JsonObject;
  readonly occurredAt: UtcTimestamp;
}

export interface WorkflowEventListQuery {
  readonly workflowInstanceId: EntityId;
  readonly afterSequence: number | null;
  readonly limit: number;
}

export interface CostEventListQuery {
  readonly owner: DurableOwner;
  readonly afterSequence: number | null;
  readonly limit: number;
}

export interface TaskCostSummaryQuery {
  readonly taskId: EntityId;
  readonly attemptId?: EntityId;
}

export interface TaskCostSummary {
  readonly taskId: EntityId;
  readonly attemptId: EntityId | null;
  readonly owner: DurableOwner;
  readonly reservedMicroUsd: bigint;
  readonly reportedMicroUsd: bigint;
  readonly settledMicroUsd: bigint;
  readonly releasedMicroUsd: bigint;
  readonly refundedMicroUsd: bigint;
  readonly activeReservationMicroUsd: bigint;
  readonly eventCount: number;
  readonly reservedEventCount: number;
  readonly reportedEventCount: number;
  readonly settledEventCount: number;
  readonly finalizationEventCount: number;
  readonly invalidReservationAttemptCount: number;
  readonly unsettledReportedAttemptCount: number;
}

export type EventConflict = CommonConflictCode | "EVENT_ID_REUSED";
export type EventMissing = "ATTEMPT" | "TASK" | "WORKFLOW_INSTANCE";
export type EventInvariant =
  | CommonInvariantCode
  | "AGGREGATE_REFERENCE_MISMATCH"
  | "EVENT_APPEND_ONLY"
  | "EVENT_SEQUENCE_NOT_MONOTONIC"
  | "TASK_ATTEMPT_MISMATCH";

export interface EventRepository {
  appendWorkflowEvent(
    scope: WorkspaceScope,
    command: AppendWorkflowEventCommand,
  ): Promise<
    IdempotentRepositoryResult<WorkflowEventRecord, EventConflict, EventMissing, EventInvariant>
  >;

  appendCostEvent(
    scope: WorkspaceScope,
    command: AppendCostEventCommand,
  ): Promise<
    IdempotentRepositoryResult<CostEventRecord, EventConflict, EventMissing, EventInvariant>
  >;

  listWorkflowEvents(
    scope: WorkspaceScope,
    query: WorkflowEventListQuery,
  ): Promise<
    RepositoryResult<readonly WorkflowEventRecord[], EventConflict, EventMissing, EventInvariant>
  >;

  listCostEvents(
    scope: WorkspaceScope,
    query: CostEventListQuery,
  ): Promise<
    RepositoryResult<readonly CostEventRecord[], EventConflict, EventMissing, EventInvariant>
  >;

  summarizeTaskCost(
    scope: WorkspaceScope,
    query: TaskCostSummaryQuery,
  ): Promise<RepositoryResult<TaskCostSummary, EventConflict, EventMissing, EventInvariant>>;
}

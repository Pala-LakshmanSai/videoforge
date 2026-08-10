import type { SqlExecutor } from "../database/ports.js";
import type {
  AppendCostEventCommand,
  EventRepository,
  TaskCostSummary,
} from "../repositories/events.js";
import type {
  AcceptSuccessfulResultCommand,
  AcceptedAttemptResult,
  AttemptCancellationRequest,
  AtomicTaskAttemptReservation,
  ClaimExecutionCommand,
  DispatchReconciliation,
  GenerationTaskRecord,
  RecordSuccessfulAttemptCommand,
  RecordTerminalAttemptCommand,
  ReconcileDispatchCommand,
  RequestAttemptCancellationCommand,
  RequestTaskOnlyCancellationCommand,
  ReserveTaskAttemptCommand,
  SettledAttemptCancellation,
  SettleAttemptCancellationCommand,
  TaskOnlyCancellation,
} from "../repositories/execution.js";
import type {
  IdempotentRepositoryResult,
  IdempotentWrite,
  RepositoryResult,
  WorkspaceScope,
} from "../repositories/types.js";
import type { ControlPlaneRepositories } from "../repositories/unit-of-work.js";
import type {
  LocalDeliveryResult,
  LocalWorkflowTransport,
  OutboxLeaseRequest,
} from "../adapters/local-workflow.js";

type RecoveryRepositoryResult<Value> = RepositoryResult<Value, string, string, string>;
type RecoveryIdempotentResult<Value> = IdempotentRepositoryResult<Value, string, string, string>;

export type RecoveryDisplayState =
  | "PENDING"
  | "RECONCILING"
  | "RUNNING"
  | "CANCEL_REQUESTED"
  | "CANCELLED"
  | "READY"
  | "FAILED";

export interface RecoveryCostSummary {
  readonly reservedMicroUsd: bigint;
  readonly reportedMicroUsd: bigint;
  readonly settledMicroUsd: bigint;
  readonly releasedMicroUsd: bigint;
  readonly refundedMicroUsd: bigint;
  readonly activeReservationMicroUsd: bigint;
  readonly eventCount: number;
}

export interface DurableRecoverySnapshot {
  readonly workspaceId: string;
  readonly task: GenerationTaskRecord;
  readonly displayState: RecoveryDisplayState;
  readonly attemptCount: number;
  readonly claimedAttemptCount: number;
  readonly acceptedAttemptCount: number;
  readonly ambiguousAttemptCount: number;
  readonly activeAttemptCount: number;
  readonly dispatchOutboxCount: number;
  readonly cancellationOutboxCount: number;
  readonly deadLetterOutboxCount: number;
  readonly cost: RecoveryCostSummary;
}

export interface CompleteRecoveredAttemptCommand {
  readonly successfulResult: RecordSuccessfulAttemptCommand;
  readonly costEvents: readonly CostEventMutation[];
  readonly acceptance: Omit<AcceptSuccessfulResultCommand, "candidateReference">;
}

export interface CancelPendingRecoveryCommand {
  readonly cancellation: RequestTaskOnlyCancellationCommand;
  readonly costEvents: readonly CostEventMutation[];
}

export interface SettleRecoveredCancellationCommand {
  readonly terminalAttempt: RecordTerminalAttemptCommand & { readonly state: "CANCELLED" };
  readonly costEvents: readonly CostEventMutation[];
  readonly settlement: SettleAttemptCancellationCommand;
}

export type CostEventMutation = AppendCostEventCommand;

interface CountRow extends Record<string, unknown> {
  readonly count: unknown;
}

function integer(value: unknown, label: string): number {
  const normalized = typeof value === "bigint" ? Number(value) : Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new TypeError(`${label} must be a nonnegative safe integer`);
  }
  return normalized;
}

function displayState(
  task: GenerationTaskRecord,
  attempts: readonly {
    readonly state: string;
    readonly dispatchState: string;
    readonly finishedAt: string | null;
  }[],
): RecoveryDisplayState {
  if (task.state === "COMPLETE") return "READY";
  if (task.state === "CANCELLED") return "CANCELLED";
  if (task.state === "CANCEL_REQUESTED") return "CANCEL_REQUESTED";
  if (
    task.state === "BLOCKED" ||
    attempts.some((attempt) => attempt.state === "UNKNOWN" || attempt.dispatchState === "AMBIGUOUS")
  ) {
    return "RECONCILING";
  }
  if (task.state === "FAILED") return "FAILED";
  if (attempts.some((attempt) => ["CLAIMED", "RUNNING"].includes(attempt.state))) {
    return "RUNNING";
  }
  if (["PENDING", "READY", "DISPATCHING", "RETRY_WAIT"].includes(task.state)) return "PENDING";
  return "RUNNING";
}

async function requireFinalizedCost(
  events: EventRepository,
  scope: WorkspaceScope,
  taskId: string,
  attemptId: string | null,
  requireReportedSettlement: boolean,
): Promise<RecoveryRepositoryResult<TaskCostSummary>> {
  const summary = await events.summarizeTaskCost(scope, {
    taskId,
    ...(attemptId === null ? {} : { attemptId }),
  });
  if (!summary.ok) return summary;
  const value = summary.value;
  if (
    value.reservedEventCount < 1 ||
    value.finalizationEventCount < 1 ||
    value.invalidReservationAttemptCount !== 0 ||
    value.activeReservationMicroUsd !== 0n ||
    value.unsettledReportedAttemptCount !== 0
  ) {
    return {
      ok: false,
      kind: "INVARIANT_VIOLATION",
      code: "INVALID_MONEY",
      message: "task cost reservation must be fully settled, released, or refunded",
    };
  }
  if (requireReportedSettlement && (value.reportedEventCount < 1 || value.settledEventCount < 1)) {
    return {
      ok: false,
      kind: "INVARIANT_VIOLATION",
      code: "INVALID_MONEY",
      message: "accepted work requires explicit reported and settled cost events",
    };
  }
  return summary;
}

/**
 * Provider-neutral recovery composition. It owns no credentials or network transport: callers
 * inject the already fenced outbox transport and the durable repository/database bindings.
 */
export class DurableRecoveryCoordinator {
  public constructor(
    private readonly database: SqlExecutor,
    private readonly repositories: ControlPlaneRepositories,
    private readonly workflow: Pick<LocalWorkflowTransport, "deliverNext">,
  ) {}

  public reserve(
    scope: WorkspaceScope,
    command: ReserveTaskAttemptCommand,
  ): Promise<RecoveryIdempotentResult<AtomicTaskAttemptReservation>> {
    return this.repositories.execution.reserveTaskAttempt(scope, command);
  }

  public dispatch(request: OutboxLeaseRequest): Promise<LocalDeliveryResult> {
    return this.workflow.deliverNext(request);
  }

  public reconcile(
    scope: WorkspaceScope,
    command: ReconcileDispatchCommand,
  ): Promise<RecoveryIdempotentResult<DispatchReconciliation>> {
    return this.repositories.execution.reconcileDispatch(scope, command);
  }

  public claim(
    scope: WorkspaceScope,
    command: ClaimExecutionCommand,
  ): ReturnType<ControlPlaneRepositories["execution"]["claimExecution"]> {
    return this.repositories.execution.claimExecution(scope, command);
  }

  public requestAttemptCancellation(
    scope: WorkspaceScope,
    command: RequestAttemptCancellationCommand,
  ): Promise<RecoveryIdempotentResult<AttemptCancellationRequest>> {
    return this.repositories.execution.requestCancellation(scope, command);
  }

  public complete(
    scope: WorkspaceScope,
    command: CompleteRecoveredAttemptCommand,
  ): Promise<RecoveryRepositoryResult<IdempotentWrite<AcceptedAttemptResult>>> {
    return this.repositories.unitOfWork.execute(scope, async (session) => {
      const successful = await session.execution.recordSuccessfulResult(
        scope,
        command.successfulResult,
      );
      if (!successful.ok) return successful;
      for (const costEvent of command.costEvents) {
        const appended = await session.events.appendCostEvent(scope, costEvent);
        if (!appended.ok) return appended;
      }
      const finalized = await requireFinalizedCost(
        session.events,
        scope,
        command.successfulResult.taskId,
        null,
        false,
      );
      if (!finalized.ok) return finalized;
      const acceptedAttemptCost = await requireFinalizedCost(
        session.events,
        scope,
        command.successfulResult.taskId,
        command.successfulResult.attemptId,
        true,
      );
      if (!acceptedAttemptCost.ok) return acceptedAttemptCost;
      return session.execution.acceptSuccessfulResult(scope, {
        ...command.acceptance,
        candidateReference: successful.value.value.reference,
      });
    });
  }

  public cancelPending(
    scope: WorkspaceScope,
    command: CancelPendingRecoveryCommand,
  ): Promise<RecoveryIdempotentResult<TaskOnlyCancellation>> {
    return this.repositories.unitOfWork.execute(scope, async (session) => {
      const cancellation = await session.execution.requestCancellation(scope, command.cancellation);
      if (!cancellation.ok) return cancellation;
      for (const costEvent of command.costEvents) {
        const appended = await session.events.appendCostEvent(scope, costEvent);
        if (!appended.ok) return appended;
      }
      const finalized = await requireFinalizedCost(
        session.events,
        scope,
        command.cancellation.taskId,
        null,
        false,
      );
      if (!finalized.ok) return finalized;
      return cancellation;
    });
  }

  public settleCancellation(
    scope: WorkspaceScope,
    command: SettleRecoveredCancellationCommand,
  ): Promise<RecoveryRepositoryResult<IdempotentWrite<SettledAttemptCancellation>>> {
    return this.repositories.unitOfWork.execute(scope, async (session) => {
      const terminal = await session.execution.recordTerminalResult(scope, command.terminalAttempt);
      if (!terminal.ok) return terminal;
      for (const costEvent of command.costEvents) {
        const appended = await session.events.appendCostEvent(scope, costEvent);
        if (!appended.ok) return appended;
      }
      const finalized = await requireFinalizedCost(
        session.events,
        scope,
        command.settlement.taskId,
        null,
        false,
      );
      if (!finalized.ok) return finalized;
      return session.execution.settleAttemptCancellation(scope, command.settlement);
    });
  }

  public async inspect(
    scope: WorkspaceScope,
    taskId: string,
  ): Promise<RecoveryRepositoryResult<DurableRecoverySnapshot>> {
    const taskResult = await this.repositories.execution.resolveTask(scope, { taskId });
    if (!taskResult.ok) return taskResult;
    const attemptsResult = await this.repositories.execution.listAttempts(scope, { taskId });
    if (!attemptsResult.ok) return attemptsResult;
    const costResult = await this.repositories.events.summarizeTaskCost(scope, { taskId });
    if (!costResult.ok) return costResult;
    const attempts = attemptsResult.value;
    const outboxRows = await this.database.query<{
      readonly dead_letter_count: unknown;
      readonly dispatch_count: unknown;
      readonly cancellation_count: unknown;
    }>(
      `SELECT
         count(*) FILTER (WHERE kind = 'DISPATCH')::int AS dispatch_count,
         count(*) FILTER (WHERE kind = 'CANCEL')::int AS cancellation_count,
         count(*) FILTER (WHERE state = 'DEAD_LETTER')::int AS dead_letter_count
       FROM outbox WHERE workspace_id = $1 AND task_id = $2`,
      [scope.workspaceId, taskId],
    );
    const outbox = outboxRows.rows[0];
    if (outbox === undefined) throw new Error("recovery outbox aggregate query returned no row");
    const acceptedCountRows = await this.database.query<CountRow>(
      `SELECT count(*)::int AS count FROM attempts
       WHERE workspace_id = $1 AND task_id = $2 AND result_disposition = 'ACCEPTED'`,
      [scope.workspaceId, taskId],
    );
    const acceptedCount = acceptedCountRows.rows[0];
    if (acceptedCount === undefined) {
      throw new Error("recovery accepted-attempt aggregate query returned no row");
    }
    const costs = costResult.value;
    const reserved = costs.reservedMicroUsd;
    const settled = costs.settledMicroUsd;
    const released = costs.releasedMicroUsd;
    const refunded = costs.refundedMicroUsd;
    return {
      ok: true,
      value: {
        workspaceId: scope.workspaceId,
        task: taskResult.value,
        displayState: displayState(taskResult.value, attempts),
        attemptCount: attempts.length,
        claimedAttemptCount: attempts.filter((attempt) => attempt.claimState === "CLAIMED").length,
        acceptedAttemptCount: integer(acceptedCount.count, "accepted attempt count"),
        ambiguousAttemptCount: attempts.filter((attempt) => attempt.dispatchState === "AMBIGUOUS")
          .length,
        activeAttemptCount: attempts.filter((attempt) => attempt.finishedAt === null).length,
        dispatchOutboxCount: integer(outbox.dispatch_count, "dispatch outbox count"),
        cancellationOutboxCount: integer(outbox.cancellation_count, "cancellation outbox count"),
        deadLetterOutboxCount: integer(outbox.dead_letter_count, "dead-letter outbox count"),
        cost: {
          reservedMicroUsd: reserved,
          reportedMicroUsd: costs.reportedMicroUsd,
          settledMicroUsd: settled,
          releasedMicroUsd: released,
          refundedMicroUsd: refunded,
          activeReservationMicroUsd: costs.activeReservationMicroUsd,
          eventCount: costs.eventCount,
        },
      },
    };
  }
}

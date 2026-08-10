import { deepFreeze } from "./hashing.js";
import type {
  MicroUsd,
  SandboxAttemptCostEvidence,
  SandboxCostEvent,
  SandboxFailureCode,
  SandboxTaskCostSnapshot,
} from "./types.js";

interface AttemptCostState {
  readonly attemptId: string;
  readonly subcapMicroUsd: MicroUsd;
  readonly reservedMicroUsd: MicroUsd;
  reportedMicroUsd: MicroUsd;
  settledMicroUsd: MicroUsd;
  refundedMicroUsd: MicroUsd;
  reportObserved: boolean;
  reconciled: boolean;
}

export interface CostLedgerFailure {
  readonly code: Extract<
    SandboxFailureCode,
    | "ATTEMPT_ID_REUSED"
    | "ATTEMPT_SUBCAP_EXCEEDED"
    | "COST_RECONCILIATION_FAILED"
    | "INVALID_MONEY"
    | "TASK_CAP_EXCEEDED"
  >;
  readonly message: string;
}

export type CostLedgerResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: CostLedgerFailure };

const failure = (code: CostLedgerFailure["code"], message: string): CostLedgerResult<never> => ({
  ok: false,
  error: { code, message },
});

const validMoney = (amount: MicroUsd): boolean => typeof amount === "bigint" && amount >= 0n;

export class SandboxCostLedger {
  readonly taskCapMicroUsd: MicroUsd;
  readonly #attempts = new Map<string, AttemptCostState>();

  constructor(taskCapMicroUsd: MicroUsd) {
    if (!validMoney(taskCapMicroUsd)) {
      throw new RangeError("taskCapMicroUsd must be a nonnegative bigint");
    }
    this.taskCapMicroUsd = taskCapMicroUsd;
  }

  reserve(
    attemptId: string,
    subcapMicroUsd: MicroUsd,
    reservationMicroUsd: MicroUsd,
  ): CostLedgerResult<SandboxAttemptCostEvidence> {
    if (!validMoney(subcapMicroUsd) || !validMoney(reservationMicroUsd)) {
      return failure("INVALID_MONEY", "Sub-cap and reservation must be nonnegative bigint values.");
    }
    if (this.#attempts.has(attemptId)) {
      return failure("ATTEMPT_ID_REUSED", `Attempt ${attemptId} already has an immutable ledger.`);
    }
    if (reservationMicroUsd > subcapMicroUsd) {
      return failure(
        "ATTEMPT_SUBCAP_EXCEEDED",
        `Attempt ${attemptId} reservation exceeds its immutable USD sub-cap.`,
      );
    }
    const snapshot = this.snapshot();
    if (
      snapshot.settledMicroUsd + snapshot.activeReservedMicroUsd + reservationMicroUsd >
      this.taskCapMicroUsd
    ) {
      return failure(
        "TASK_CAP_EXCEEDED",
        `Attempt ${attemptId} would exceed the task USD cap across active reservations and retries.`,
      );
    }

    this.#attempts.set(attemptId, {
      attemptId,
      subcapMicroUsd,
      reservedMicroUsd: reservationMicroUsd,
      reportedMicroUsd: 0n,
      settledMicroUsd: 0n,
      refundedMicroUsd: 0n,
      reportObserved: false,
      reconciled: false,
    });
    return { ok: true, value: this.attemptEvidence(attemptId)! };
  }

  reconcile(
    attemptId: string,
    reportedMicroUsd: MicroUsd,
  ): CostLedgerResult<SandboxAttemptCostEvidence> {
    const attempt = this.#attempts.get(attemptId);
    if (attempt === undefined) {
      return failure(
        "COST_RECONCILIATION_FAILED",
        `Attempt ${attemptId} has no reservation to reconcile.`,
      );
    }
    if (attempt.reconciled) {
      return failure(
        "COST_RECONCILIATION_FAILED",
        `Attempt ${attemptId} cost has already been reconciled.`,
      );
    }
    if (!validMoney(reportedMicroUsd) || reportedMicroUsd < attempt.reportedMicroUsd) {
      return failure(
        "COST_RECONCILIATION_FAILED",
        `Attempt ${attemptId} final cumulative cost must be nonnegative and no lower than its observed floor.`,
      );
    }

    attempt.reportedMicroUsd = reportedMicroUsd;
    attempt.reportObserved = true;
    attempt.settledMicroUsd = reportedMicroUsd;
    attempt.refundedMicroUsd =
      reportedMicroUsd < attempt.reservedMicroUsd
        ? attempt.reservedMicroUsd - reportedMicroUsd
        : 0n;
    attempt.reconciled = true;
    return { ok: true, value: this.attemptEvidence(attemptId)! };
  }

  /** Records the largest truthful cumulative report even when final settlement remains unknown. */
  observeReportedCost(
    attemptId: string,
    reportedMicroUsd: MicroUsd,
  ): CostLedgerResult<SandboxAttemptCostEvidence> {
    const attempt = this.#attempts.get(attemptId);
    if (attempt === undefined || attempt.reconciled || !validMoney(reportedMicroUsd)) {
      return failure(
        "COST_RECONCILIATION_FAILED",
        `Attempt ${attemptId} cannot accept the observed cumulative cost report.`,
      );
    }
    if (reportedMicroUsd > attempt.reportedMicroUsd) {
      attempt.reportedMicroUsd = reportedMicroUsd;
    }
    attempt.reportObserved = true;
    return { ok: true, value: this.attemptEvidence(attemptId)! };
  }

  attemptEvidence(attemptId: string): SandboxAttemptCostEvidence | undefined {
    const attempt = this.#attempts.get(attemptId);
    if (attempt === undefined) return undefined;
    const overrunMicroUsd =
      attempt.reportedMicroUsd > attempt.reservedMicroUsd
        ? attempt.reportedMicroUsd - attempt.reservedMicroUsd
        : 0n;
    const activeCommitmentMicroUsd = attempt.reconciled
      ? 0n
      : attempt.reservedMicroUsd + overrunMicroUsd;
    const events: SandboxCostEvent[] = [
      { sequence: 1, eventType: "RESERVED", amountMicroUsd: attempt.reservedMicroUsd },
    ];
    if (attempt.reportObserved) {
      events.push({
        sequence: events.length + 1,
        eventType: "REPORTED",
        amountMicroUsd: attempt.reportedMicroUsd,
      });
    }
    if (overrunMicroUsd > 0n) {
      events.push({
        sequence: events.length + 1,
        eventType: "RESERVATION_OVERRUN",
        amountMicroUsd: overrunMicroUsd,
      });
    }
    if (attempt.reconciled) {
      events.push({
        sequence: events.length + 1,
        eventType: "SETTLED",
        amountMicroUsd: attempt.settledMicroUsd,
      });
      events.push({
        sequence: events.length + 1,
        eventType: "REFUNDED",
        amountMicroUsd: attempt.refundedMicroUsd,
      });
    }

    return deepFreeze({
      currency: "USD" as const,
      taskCapMicroUsd: this.taskCapMicroUsd,
      attemptSubcapMicroUsd: attempt.subcapMicroUsd,
      reservedMicroUsd: attempt.reservedMicroUsd,
      reportedMicroUsd: attempt.reportedMicroUsd,
      settledMicroUsd: attempt.settledMicroUsd,
      refundedMicroUsd: attempt.refundedMicroUsd,
      overrunMicroUsd,
      activeReservedMicroUsd: activeCommitmentMicroUsd,
      activeCommitmentMicroUsd,
      reconciled: attempt.reconciled,
      events,
    });
  }

  snapshot(): SandboxTaskCostSnapshot {
    let settledMicroUsd = 0n;
    let activeCommitmentMicroUsd = 0n;
    let knownReportedMicroUsd = 0n;
    for (const attempt of this.#attempts.values()) {
      settledMicroUsd += attempt.settledMicroUsd;
      knownReportedMicroUsd += attempt.reconciled
        ? attempt.settledMicroUsd
        : attempt.reportedMicroUsd;
      if (!attempt.reconciled) {
        activeCommitmentMicroUsd +=
          attempt.reportedMicroUsd > attempt.reservedMicroUsd
            ? attempt.reportedMicroUsd
            : attempt.reservedMicroUsd;
      }
    }
    const committedMicroUsd = settledMicroUsd + activeCommitmentMicroUsd;
    const availableMicroUsd =
      committedMicroUsd >= this.taskCapMicroUsd ? 0n : this.taskCapMicroUsd - committedMicroUsd;
    return deepFreeze({
      currency: "USD" as const,
      taskCapMicroUsd: this.taskCapMicroUsd,
      settledMicroUsd,
      activeReservedMicroUsd: activeCommitmentMicroUsd,
      activeCommitmentMicroUsd,
      knownReportedMicroUsd,
      availableMicroUsd,
      capExceededMicroUsd:
        committedMicroUsd > this.taskCapMicroUsd ? committedMicroUsd - this.taskCapMicroUsd : 0n,
    });
  }
}

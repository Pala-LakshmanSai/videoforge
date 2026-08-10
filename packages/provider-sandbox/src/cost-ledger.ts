import { deepFreeze } from "./hashing.js";
import type {
  MicroUsd,
  SandboxAttemptCostEvidence,
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
    if (!validMoney(reportedMicroUsd) || reportedMicroUsd > attempt.reservedMicroUsd) {
      return failure(
        "COST_RECONCILIATION_FAILED",
        `Attempt ${attemptId} reported cost must be nonnegative and no greater than its reservation.`,
      );
    }

    attempt.reportedMicroUsd = reportedMicroUsd;
    attempt.settledMicroUsd = reportedMicroUsd;
    attempt.refundedMicroUsd = attempt.reservedMicroUsd - reportedMicroUsd;
    attempt.reconciled = true;
    return { ok: true, value: this.attemptEvidence(attemptId)! };
  }

  attemptEvidence(attemptId: string): SandboxAttemptCostEvidence | undefined {
    const attempt = this.#attempts.get(attemptId);
    if (attempt === undefined) return undefined;
    const activeReservedMicroUsd = attempt.reconciled ? 0n : attempt.reservedMicroUsd;
    const events = attempt.reconciled
      ? [
          { sequence: 1, eventType: "RESERVED" as const, amountMicroUsd: attempt.reservedMicroUsd },
          { sequence: 2, eventType: "REPORTED" as const, amountMicroUsd: attempt.reportedMicroUsd },
          { sequence: 3, eventType: "SETTLED" as const, amountMicroUsd: attempt.settledMicroUsd },
          { sequence: 4, eventType: "REFUNDED" as const, amountMicroUsd: attempt.refundedMicroUsd },
        ]
      : [{ sequence: 1, eventType: "RESERVED" as const, amountMicroUsd: attempt.reservedMicroUsd }];

    return deepFreeze({
      currency: "USD" as const,
      taskCapMicroUsd: this.taskCapMicroUsd,
      attemptSubcapMicroUsd: attempt.subcapMicroUsd,
      reservedMicroUsd: attempt.reservedMicroUsd,
      reportedMicroUsd: attempt.reportedMicroUsd,
      settledMicroUsd: attempt.settledMicroUsd,
      refundedMicroUsd: attempt.refundedMicroUsd,
      activeReservedMicroUsd,
      reconciled: attempt.reconciled,
      events,
    });
  }

  snapshot(): SandboxTaskCostSnapshot {
    let settledMicroUsd = 0n;
    let activeReservedMicroUsd = 0n;
    for (const attempt of this.#attempts.values()) {
      settledMicroUsd += attempt.settledMicroUsd;
      if (!attempt.reconciled) activeReservedMicroUsd += attempt.reservedMicroUsd;
    }
    return deepFreeze({
      currency: "USD" as const,
      taskCapMicroUsd: this.taskCapMicroUsd,
      settledMicroUsd,
      activeReservedMicroUsd,
      availableMicroUsd: this.taskCapMicroUsd - settledMicroUsd - activeReservedMicroUsd,
    });
  }
}

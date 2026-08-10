import { deepFreeze, sha256DeterministicRecord } from "./hashing.js";
import type {
  MicroUsd,
  ProviderNeutralSandboxTransport,
  SandboxCancellationResult,
  SandboxCleanupResult,
  SandboxDispatchReconciliation,
  SandboxDispatchResult,
  SandboxExecutionResult,
  SandboxTransportContext,
} from "./types.js";

export type FakeTransportScenario =
  | "SUCCESS"
  | "TIMEOUT"
  | "AMBIGUOUS_ACKNOWLEDGEMENT"
  | "CANCELLATION"
  | "CAP_EXHAUSTION"
  | "CLEANUP_FAILURE";

export interface DeterministicFakeTransportOptions {
  readonly scenario: FakeTransportScenario;
  readonly reportedMicroUsd?: MicroUsd;
  readonly reconciliationOutcome?: SandboxDispatchReconciliation["outcome"];
}

export class FakeTransportInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FakeTransportInvariantError";
  }
}

export class DeterministicFakeTransport implements ProviderNeutralSandboxTransport {
  readonly safety = deepFreeze({
    kind: "DETERMINISTIC_FAKE" as const,
    networkAccess: false,
    credentialAccess: false,
    providerSdkAccess: false,
    maximumExternalSpendMicroUsd: 0n,
  });

  readonly #options: Required<DeterministicFakeTransportOptions>;
  readonly #calls: string[] = [];

  constructor(options: DeterministicFakeTransportOptions) {
    this.#options = {
      scenario: options.scenario,
      reportedMicroUsd: options.reportedMicroUsd ?? 0n,
      reconciliationOutcome: options.reconciliationOutcome ?? "STILL_UNKNOWN",
    };
  }

  async dispatch(context: SandboxTransportContext): Promise<SandboxDispatchResult> {
    this.#calls.push("dispatch");
    if (this.#options.scenario === "CAP_EXHAUSTION") {
      throw new FakeTransportInvariantError(
        "CAP_EXHAUSTION transport was invoked; the harness must reject it during budget preflight.",
      );
    }
    if (this.#options.scenario === "AMBIGUOUS_ACKNOWLEDGEMENT") {
      return deepFreeze({
        state: "AMBIGUOUS" as const,
        reason: "synthetic acknowledgement loss",
      });
    }
    return deepFreeze({
      state: "ACKNOWLEDGED" as const,
      externalJobId: `fake-job-${context.bindingHash.slice("sha256:".length, 22)}`,
    });
  }

  async reconcile(context: SandboxTransportContext): Promise<SandboxDispatchReconciliation> {
    this.#calls.push("reconcile");
    if (this.#options.scenario !== "AMBIGUOUS_ACKNOWLEDGEMENT") {
      throw new FakeTransportInvariantError("Only an ambiguous acknowledgement may be reconciled.");
    }
    if (this.#options.reconciliationOutcome === "ACKNOWLEDGEMENT_CONFIRMED") {
      return deepFreeze({
        outcome: "ACKNOWLEDGEMENT_CONFIRMED" as const,
        externalJobId: `fake-job-${context.bindingHash.slice("sha256:".length, 22)}`,
      });
    }
    if (this.#options.reconciliationOutcome === "NOT_DISPATCHED_CONFIRMED") {
      return deepFreeze({ outcome: "NOT_DISPATCHED_CONFIRMED" as const });
    }
    return deepFreeze({ outcome: "STILL_UNKNOWN" as const });
  }

  async execute(context: SandboxTransportContext): Promise<SandboxExecutionResult> {
    this.#calls.push("execute");
    if (this.#options.scenario === "CANCELLATION") {
      throw new FakeTransportInvariantError(
        "Cancellation scenario executed; the harness must cancel before execution.",
      );
    }
    if (this.#options.scenario === "TIMEOUT") {
      return deepFreeze({
        outcome: "TIMED_OUT" as const,
        reportedMicroUsd: this.#options.reportedMicroUsd,
        timedOutAtEpochMs: context.deadlineEpochMs,
      });
    }
    return deepFreeze({
      outcome: "SUCCEEDED" as const,
      reportedMicroUsd: this.#options.reportedMicroUsd,
      resultHash: sha256DeterministicRecord({
        attemptId: context.attempt.attemptId,
        bindingHash: context.bindingHash,
        result: "synthetic-success",
      }),
    });
  }

  async cancel(): Promise<SandboxCancellationResult> {
    this.#calls.push("cancel");
    return deepFreeze({
      outcome: "CANCELLED" as const,
      reportedMicroUsd: this.#options.reportedMicroUsd,
    });
  }

  async cleanup(context: SandboxTransportContext): Promise<SandboxCleanupResult> {
    this.#calls.push("cleanup");
    const evidenceHash = sha256DeterministicRecord({
      attemptId: context.attempt.attemptId,
      bindingHash: context.bindingHash,
      cleanup: this.#options.scenario === "CLEANUP_FAILURE" ? "failed" : "succeeded",
    });
    if (this.#options.scenario === "CLEANUP_FAILURE") {
      return deepFreeze({
        outcome: "FAILED" as const,
        evidenceHash,
        reason: "synthetic resource cleanup failure",
      });
    }
    return deepFreeze({ outcome: "SUCCEEDED" as const, evidenceHash });
  }

  callLog(): readonly string[] {
    return Object.freeze([...this.#calls]);
  }
}

import {
  deepFreeze,
  isCapturedFrozen,
  sha256DeterministicRecord,
  snapshotDenseOwnDataArray,
  snapshotOwnDataRecord,
} from "./hashing.js";
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

export type FakeTransportOperation =
  | "DISPATCH"
  | "RECONCILIATION"
  | "EXECUTION"
  | "CANCELLATION"
  | "CLEANUP";

export type FakeTransportProtocolFault =
  | "DISPATCH_INVALID_EXTERNAL_JOB_ID"
  | "RECONCILIATION_INVALID_EXTERNAL_JOB_ID"
  | "EXECUTION_INVALID_RESULT_HASH"
  | "EXECUTION_INVALID_TIMEOUT_TIMESTAMP"
  | "CANCELLATION_NEGATIVE_COST"
  | "CLEANUP_INVALID_EVIDENCE_HASH";

export interface DeterministicFakeTransportOptions {
  readonly scenario: FakeTransportScenario;
  readonly reportedMicroUsd?: MicroUsd;
  readonly executionReportedMicroUsd?: MicroUsd;
  readonly cancellationReportedMicroUsd?: MicroUsd;
  readonly reconciliationOutcome?: SandboxDispatchReconciliation["outcome"];
  readonly protocolFault?: FakeTransportProtocolFault;
  readonly throwAt?: readonly FakeTransportOperation[];
}

export class FakeTransportInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FakeTransportInvariantError";
  }
}

const objectGetPrototypeOf = Object.getPrototypeOf;
const objectHasOwnProperty = Object.prototype.hasOwnProperty;
const hasOwn = (value: object, key: PropertyKey): boolean => objectHasOwnProperty.call(value, key);
let hasAuthenticityBrand: (value: unknown) => boolean = () => false;

interface ResolvedFakeTransportOptions {
  readonly scenario: FakeTransportScenario;
  readonly executionReportedMicroUsd: MicroUsd;
  readonly cancellationReportedMicroUsd: MicroUsd;
  readonly reconciliationOutcome: SandboxDispatchReconciliation["outcome"];
  readonly protocolFault: FakeTransportProtocolFault | null;
  readonly throwAt: ReadonlySet<FakeTransportOperation>;
}

const SCENARIOS: readonly FakeTransportScenario[] = [
  "SUCCESS",
  "TIMEOUT",
  "AMBIGUOUS_ACKNOWLEDGEMENT",
  "CANCELLATION",
  "CAP_EXHAUSTION",
  "CLEANUP_FAILURE",
];
const OPERATIONS: readonly FakeTransportOperation[] = [
  "DISPATCH",
  "RECONCILIATION",
  "EXECUTION",
  "CANCELLATION",
  "CLEANUP",
];
const PROTOCOL_FAULTS: readonly FakeTransportProtocolFault[] = [
  "DISPATCH_INVALID_EXTERNAL_JOB_ID",
  "RECONCILIATION_INVALID_EXTERNAL_JOB_ID",
  "EXECUTION_INVALID_RESULT_HASH",
  "EXECUTION_INVALID_TIMEOUT_TIMESTAMP",
  "CANCELLATION_NEGATIVE_COST",
  "CLEANUP_INVALID_EVIDENCE_HASH",
];
const RECONCILIATION_OUTCOMES: readonly SandboxDispatchReconciliation["outcome"][] = [
  "ACKNOWLEDGEMENT_CONFIRMED",
  "NOT_DISPATCHED_CONFIRMED",
  "STILL_UNKNOWN",
];
const OPTION_KEYS = [
  "cancellationReportedMicroUsd",
  "executionReportedMicroUsd",
  "protocolFault",
  "reconciliationOutcome",
  "reportedMicroUsd",
  "scenario",
  "throwAt",
] as const;

function validateScenarioCompatibility(input: {
  readonly scenario: FakeTransportScenario;
  readonly reconciliationOutcomeSupplied: boolean;
  readonly reconciliationOutcome: SandboxDispatchReconciliation["outcome"];
  readonly protocolFault: FakeTransportProtocolFault | null;
  readonly operations: readonly FakeTransportOperation[];
}): void {
  if (input.reconciliationOutcomeSupplied && input.scenario !== "AMBIGUOUS_ACKNOWLEDGEMENT") {
    throw new TypeError("reconciliationOutcome is only compatible with AMBIGUOUS_ACKNOWLEDGEMENT.");
  }
  if (
    input.operations.includes("RECONCILIATION") &&
    input.scenario !== "AMBIGUOUS_ACKNOWLEDGEMENT"
  ) {
    throw new TypeError("RECONCILIATION exceptions require AMBIGUOUS_ACKNOWLEDGEMENT.");
  }

  if (input.protocolFault === "RECONCILIATION_INVALID_EXTERNAL_JOB_ID") {
    if (
      input.scenario !== "AMBIGUOUS_ACKNOWLEDGEMENT" ||
      input.reconciliationOutcome !== "ACKNOWLEDGEMENT_CONFIRMED"
    ) {
      throw new TypeError(
        "RECONCILIATION_INVALID_EXTERNAL_JOB_ID requires confirmed ambiguous reconciliation.",
      );
    }
  } else if (input.protocolFault === "DISPATCH_INVALID_EXTERNAL_JOB_ID") {
    if (input.scenario === "AMBIGUOUS_ACKNOWLEDGEMENT" || input.scenario === "CAP_EXHAUSTION") {
      throw new TypeError(
        "DISPATCH_INVALID_EXTERNAL_JOB_ID requires a scenario with an acknowledged dispatch result.",
      );
    }
  } else if (input.protocolFault === "EXECUTION_INVALID_TIMEOUT_TIMESTAMP") {
    if (input.scenario !== "TIMEOUT") {
      throw new TypeError("EXECUTION_INVALID_TIMEOUT_TIMESTAMP requires the TIMEOUT scenario.");
    }
  } else if (input.protocolFault === "EXECUTION_INVALID_RESULT_HASH") {
    const producesSuccessResult =
      input.scenario === "SUCCESS" ||
      input.scenario === "CLEANUP_FAILURE" ||
      (input.scenario === "AMBIGUOUS_ACKNOWLEDGEMENT" &&
        input.reconciliationOutcome === "ACKNOWLEDGEMENT_CONFIRMED");
    if (!producesSuccessResult) {
      throw new TypeError(
        "EXECUTION_INVALID_RESULT_HASH requires a scenario that reaches a successful execution result.",
      );
    }
  }
}

function resolveFakeTransportOptions(value: unknown): ResolvedFakeTransportOptions {
  const options = snapshotOwnDataRecord(value, OPTION_KEYS, ["scenario"]);
  if (options === null || !SCENARIOS.includes(options.scenario as FakeTransportScenario)) {
    throw new TypeError(
      "Fake transport options require exact own data fields and a valid scenario.",
    );
  }

  const money = (key: (typeof OPTION_KEYS)[number]): MicroUsd | undefined => {
    if (!hasOwn(options, key)) return undefined;
    const amount = options[key];
    if (typeof amount !== "bigint" || amount < 0n) {
      throw new TypeError(`${key} must be a nonnegative bigint when supplied.`);
    }
    return amount;
  };
  const defaultReportedMicroUsd = money("reportedMicroUsd") ?? 0n;
  const executionReportedMicroUsd = money("executionReportedMicroUsd") ?? defaultReportedMicroUsd;
  const cancellationReportedMicroUsd =
    money("cancellationReportedMicroUsd") ?? defaultReportedMicroUsd;

  let reconciliationOutcome: SandboxDispatchReconciliation["outcome"] = "STILL_UNKNOWN";
  if (hasOwn(options, "reconciliationOutcome")) {
    if (
      !RECONCILIATION_OUTCOMES.includes(
        options.reconciliationOutcome as SandboxDispatchReconciliation["outcome"],
      )
    ) {
      throw new TypeError("reconciliationOutcome is not supported by the deterministic fake.");
    }
    reconciliationOutcome =
      options.reconciliationOutcome as SandboxDispatchReconciliation["outcome"];
  }

  let protocolFault: FakeTransportProtocolFault | null = null;
  if (hasOwn(options, "protocolFault")) {
    if (!PROTOCOL_FAULTS.includes(options.protocolFault as FakeTransportProtocolFault)) {
      throw new TypeError("protocolFault is not supported by the deterministic fake.");
    }
    protocolFault = options.protocolFault as FakeTransportProtocolFault;
  }

  const operations: FakeTransportOperation[] = [];
  if (hasOwn(options, "throwAt")) {
    const rawOperations = snapshotDenseOwnDataArray(options.throwAt);
    if (rawOperations === null) {
      throw new TypeError("throwAt must be a dense own-data array.");
    }
    for (const operation of rawOperations) {
      if (!OPERATIONS.includes(operation as FakeTransportOperation)) {
        throw new TypeError("throwAt contains an unsupported fake transport operation.");
      }
      if (operations.includes(operation as FakeTransportOperation)) {
        throw new TypeError("throwAt cannot contain duplicate fake transport operations.");
      }
      operations.push(operation as FakeTransportOperation);
    }
  }

  validateScenarioCompatibility({
    scenario: options.scenario as FakeTransportScenario,
    reconciliationOutcomeSupplied: hasOwn(options, "reconciliationOutcome"),
    reconciliationOutcome,
    protocolFault,
    operations,
  });

  return {
    scenario: options.scenario as FakeTransportScenario,
    executionReportedMicroUsd,
    cancellationReportedMicroUsd,
    reconciliationOutcome,
    protocolFault,
    throwAt: new Set(operations),
  };
}

export class DeterministicFakeTransport implements ProviderNeutralSandboxTransport {
  readonly #authenticityBrand = true;

  static {
    hasAuthenticityBrand = (value: unknown): boolean => {
      try {
        return typeof value === "object" && value !== null && #authenticityBrand in value;
      } catch {
        return false;
      }
    };
  }

  readonly safety = deepFreeze({
    kind: "DETERMINISTIC_FAKE" as const,
    networkAccess: false,
    credentialAccess: false,
    providerSdkAccess: false,
    maximumExternalSpendMicroUsd: 0n,
  });

  readonly #options: ResolvedFakeTransportOptions;
  readonly #calls: string[] = [];

  constructor(options: DeterministicFakeTransportOptions) {
    if (new.target !== DeterministicFakeTransport) {
      throw new TypeError("DeterministicFakeTransport cannot be subclassed.");
    }
    this.#options = resolveFakeTransportOptions(options);
    deepFreeze(this);
  }

  async dispatch(context: SandboxTransportContext): Promise<SandboxDispatchResult> {
    this.#calls.push("dispatch");
    this.#throwIfRequested("DISPATCH");
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
    const result = {
      state: "ACKNOWLEDGED" as const,
      externalJobId:
        this.#options.protocolFault === "DISPATCH_INVALID_EXTERNAL_JOB_ID"
          ? ""
          : `fake-job-${context.bindingHash.slice("sha256:".length, 22)}`,
    };
    return deepFreeze(result);
  }

  async reconcile(context: SandboxTransportContext): Promise<SandboxDispatchReconciliation> {
    this.#calls.push("reconcile");
    this.#throwIfRequested("RECONCILIATION");
    if (this.#options.scenario !== "AMBIGUOUS_ACKNOWLEDGEMENT") {
      throw new FakeTransportInvariantError("Only an ambiguous acknowledgement may be reconciled.");
    }
    if (this.#options.reconciliationOutcome === "ACKNOWLEDGEMENT_CONFIRMED") {
      return deepFreeze({
        outcome: "ACKNOWLEDGEMENT_CONFIRMED" as const,
        externalJobId:
          this.#options.protocolFault === "RECONCILIATION_INVALID_EXTERNAL_JOB_ID"
            ? ""
            : `fake-job-${context.bindingHash.slice("sha256:".length, 22)}`,
      });
    }
    if (this.#options.reconciliationOutcome === "NOT_DISPATCHED_CONFIRMED") {
      return deepFreeze({ outcome: "NOT_DISPATCHED_CONFIRMED" as const });
    }
    return deepFreeze({ outcome: "STILL_UNKNOWN" as const });
  }

  async execute(context: SandboxTransportContext): Promise<SandboxExecutionResult> {
    this.#calls.push("execute");
    this.#throwIfRequested("EXECUTION");
    if (this.#options.scenario === "CANCELLATION") {
      throw new FakeTransportInvariantError(
        "Cancellation scenario executed; the harness must cancel before execution.",
      );
    }
    if (this.#options.scenario === "TIMEOUT") {
      return deepFreeze({
        outcome: "TIMED_OUT" as const,
        reportedMicroUsd: this.#options.executionReportedMicroUsd,
        timedOutAtEpochMs:
          this.#options.protocolFault === "EXECUTION_INVALID_TIMEOUT_TIMESTAMP"
            ? context.observedAtEpochMs - 1
            : context.deadlineEpochMs,
      });
    }
    return deepFreeze({
      outcome: "SUCCEEDED" as const,
      reportedMicroUsd: this.#options.executionReportedMicroUsd,
      resultHash:
        this.#options.protocolFault === "EXECUTION_INVALID_RESULT_HASH"
          ? "sha256:invalid"
          : sha256DeterministicRecord({
              attemptId: context.attempt.attemptId,
              bindingHash: context.bindingHash,
              result: "synthetic-success",
            }),
    } as SandboxExecutionResult);
  }

  async cancel(): Promise<SandboxCancellationResult> {
    this.#calls.push("cancel");
    this.#throwIfRequested("CANCELLATION");
    return deepFreeze({
      outcome: "CANCELLED" as const,
      reportedMicroUsd:
        this.#options.protocolFault === "CANCELLATION_NEGATIVE_COST"
          ? -1n
          : this.#options.cancellationReportedMicroUsd,
    });
  }

  async cleanup(context: SandboxTransportContext): Promise<SandboxCleanupResult> {
    this.#calls.push("cleanup");
    this.#throwIfRequested("CLEANUP");
    const evidenceHash = sha256DeterministicRecord({
      attemptId: context.attempt.attemptId,
      bindingHash: context.bindingHash,
      cleanup: this.#options.scenario === "CLEANUP_FAILURE" ? "failed" : "succeeded",
    });
    const reportedEvidenceHash =
      this.#options.protocolFault === "CLEANUP_INVALID_EVIDENCE_HASH"
        ? ("sha256:invalid" as const)
        : evidenceHash;
    if (this.#options.scenario === "CLEANUP_FAILURE") {
      return deepFreeze({
        outcome: "FAILED" as const,
        evidenceHash: reportedEvidenceHash,
        reason: "synthetic resource cleanup failure",
      });
    }
    return deepFreeze({
      outcome: "SUCCEEDED" as const,
      evidenceHash: reportedEvidenceHash,
    } as SandboxCleanupResult);
  }

  callLog(): readonly string[] {
    return deepFreeze([...this.#calls]);
  }

  #throwIfRequested(operation: FakeTransportOperation): void {
    if (this.#options.throwAt.has(operation)) {
      throw new Error(`synthetic ${operation.toLowerCase()} transport exception`);
    }
  }
}

deepFreeze(DeterministicFakeTransport.prototype);

/** Module-owned authenticity guard; matching public fields cannot self-declare a fake transport. */
export function isAuthenticDeterministicFakeTransport(
  transport: unknown,
): transport is DeterministicFakeTransport {
  return (
    typeof transport === "object" &&
    transport !== null &&
    hasAuthenticityBrand(transport) &&
    objectGetPrototypeOf(transport) === DeterministicFakeTransport.prototype &&
    isCapturedFrozen(transport) &&
    isCapturedFrozen((transport as DeterministicFakeTransport).safety)
  );
}

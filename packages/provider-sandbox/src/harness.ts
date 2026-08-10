import { SandboxCostLedger } from "./cost-ledger.js";
import {
  deepFreeze,
  hashSandboxAttemptBinding,
  hashSandboxAuthorization,
  hashSandboxEvidence,
} from "./hashing.js";
import {
  canonicalizeAttemptRequest,
  canonicalizeTaskIdentity,
  dispatchFailure,
  operationalIssue as issue,
  preflightFailure as fail,
  stageFailure,
  transportException,
  validateCancellationResult,
  validateCleanupResult,
  validateDispatchResult,
  validateExecutionResult,
  validateReconciliationResult,
  validateTransportSafety,
  type PreflightFailure,
} from "./runtime-validation.js";
import type {
  MicroUsd,
  ProviderNeutralSandboxTransport,
  SandboxAttemptBindingFacts,
  SandboxAttemptEvidence,
  SandboxAttemptEvidencePayload,
  SandboxAttemptOutcome,
  SandboxAttemptRequest,
  SandboxCancellationEvidence,
  SandboxCleanupEvidence,
  SandboxClock,
  SandboxDispatchEvidence,
  SandboxExecutionEvidence,
  SandboxFailureCode,
  SandboxOperationalIssue,
  SandboxReconciliationEvidence,
  SandboxReportedCostFacts,
  SandboxRunResult,
  SandboxTaskIdentity,
  SandboxTransportContext,
  Sha256,
} from "./types.js";

export interface ProviderSandboxHarnessOptions {
  readonly task: SandboxTaskIdentity;
  readonly taskCapMicroUsd: bigint;
  readonly clock: SandboxClock;
}

const INVALID_SHA: Sha256 = `sha256:${"0".repeat(64)}`;
const INVALID_TASK_PLACEHOLDER: SandboxTaskIdentity = deepFreeze({
  owner: {
    ownerType: "PROJECT_REVISION",
    ownerId: "invalid-task-placeholder",
    projectRevisionId: "invalid-task-placeholder",
  },
  ownerHash: INVALID_SHA,
  taskId: "invalid-task-placeholder",
  taskKey: "invalid-task-placeholder",
  taskHash: INVALID_SHA,
});

export class ProviderSandboxHarness {
  readonly task: SandboxTaskIdentity;
  readonly #clock: SandboxClock;
  readonly #ledger: SandboxCostLedger;
  readonly #taskIdentityFailure: PreflightFailure | null;

  constructor(options: ProviderSandboxHarnessOptions) {
    let parsedTask: ReturnType<typeof canonicalizeTaskIdentity>;
    try {
      parsedTask = canonicalizeTaskIdentity(options.task);
    } catch {
      parsedTask = {
        ok: false,
        failure: fail(
          "IDENTITY_INVALID",
          "Task identity could not be read as a canonical own-data record.",
        ),
      };
    }
    this.#taskIdentityFailure = parsedTask.ok ? null : parsedTask.failure;
    this.task = parsedTask.ok ? parsedTask.value : INVALID_TASK_PLACEHOLDER;
    this.#clock = options.clock;
    this.#ledger = new SandboxCostLedger(options.taskCapMicroUsd);
  }

  taskCost() {
    return this.#ledger.snapshot();
  }

  async runAttempt(
    request: SandboxAttemptRequest,
    transport: ProviderNeutralSandboxTransport,
  ): Promise<SandboxRunResult> {
    const rejectPreflight = (failure: PreflightFailure): SandboxRunResult =>
      deepFreeze({
        ok: false as const,
        error: { ...failure, transportCalls: [], taskCost: this.#ledger.snapshot() },
      });

    // No injected transport method, including callLog(), is touched before these checks.
    if (this.#taskIdentityFailure !== null) return rejectPreflight(this.#taskIdentityFailure);
    const nowEpochMs = this.#clock.nowEpochMs();
    if (!Number.isSafeInteger(nowEpochMs)) {
      return rejectPreflight(
        fail("INVALID_DEADLINE", "Sandbox clock must return a safe integer timestamp."),
      );
    }
    const parsedRequest = canonicalizeAttemptRequest(request, this.task, nowEpochMs);
    if (!parsedRequest.ok) return rejectPreflight(parsedRequest.failure);
    const stableRequest = parsedRequest.value;
    const transportFailure = validateTransportSafety(transport);
    if (transportFailure !== null) return rejectPreflight(transportFailure);
    if (transport.callLog().length !== 0) {
      return rejectPreflight(
        fail("UNSAFE_TRANSPORT", "Transport must be fresh for each sandbox attempt."),
      );
    }

    const reserved = this.#ledger.reserve(
      stableRequest.attempt.attemptId,
      stableRequest.attemptSubcapMicroUsd,
      stableRequest.reservationMicroUsd,
    );
    if (!reserved.ok) return rejectPreflight(reserved.error);

    const authorization = stableRequest.authorization!;
    const bindingFacts: SandboxAttemptBindingFacts = deepFreeze({
      authorizationHash: hashSandboxAuthorization(authorization),
      taskCapMicroUsd: this.#ledger.taskCapMicroUsd,
      attemptSubcapMicroUsd: stableRequest.attemptSubcapMicroUsd,
      reservationMicroUsd: stableRequest.reservationMicroUsd,
      deadlineEpochMs: stableRequest.deadlineEpochMs,
      cancelRequested: stableRequest.cancelRequested,
    });
    const bindingHash = hashSandboxAttemptBinding({
      task: this.task,
      attempt: stableRequest.attempt,
      facts: bindingFacts,
    });
    const context: SandboxTransportContext = deepFreeze({
      task: this.task,
      attempt: stableRequest.attempt,
      bindingFacts,
      bindingHash,
      deadlineEpochMs: stableRequest.deadlineEpochMs,
      observedAtEpochMs: nowEpochMs,
    });

    const issues: SandboxOperationalIssue[] = [];
    let dispatch: SandboxDispatchEvidence;
    let reconciliation: SandboxReconciliationEvidence | null = null;
    let execution: SandboxExecutionEvidence | null = null;
    let cancellation: SandboxCancellationEvidence | null = null;
    let cleanup: SandboxCleanupEvidence = { outcome: "NOT_REQUIRED" };
    let executionReportedMicroUsd: MicroUsd | null = null;
    let cancellationReportedMicroUsd: MicroUsd | null = null;

    try {
      const validated = validateDispatchResult(await transport.dispatch(context));
      if (!validated.ok) {
        issues.push(validated.issue);
        dispatch = dispatchFailure(validated.issue);
        return this.finishAttempt({
          authorizationId: authorization.authorizationId,
          request: stableRequest,
          transport,
          context,
          dispatch,
          reconciliation,
          execution,
          cancellation,
          cleanup: { outcome: "DEFERRED_RECONCILIATION" },
          requestedOutcome: "PROTOCOL_FAILED",
          executionReportedMicroUsd,
          cancellationReportedMicroUsd,
          finalCostKnown: false,
          issues,
        });
      }
      dispatch = validated.value;
    } catch (error) {
      const problem = transportException("DISPATCH", error);
      issues.push(problem);
      dispatch = dispatchFailure(problem);
      return this.finishAttempt({
        authorizationId: authorization.authorizationId,
        request: stableRequest,
        transport,
        context,
        dispatch,
        reconciliation,
        execution,
        cancellation,
        cleanup: { outcome: "DEFERRED_RECONCILIATION" },
        requestedOutcome: "TRANSPORT_FAILED",
        executionReportedMicroUsd,
        cancellationReportedMicroUsd,
        finalCostKnown: false,
        issues,
      });
    }

    if (dispatch.state === "AMBIGUOUS") {
      try {
        const validated = validateReconciliationResult(await transport.reconcile(context));
        if (!validated.ok) {
          issues.push(validated.issue);
          reconciliation = stageFailure(validated.issue);
        } else {
          reconciliation = validated.value;
        }
      } catch (error) {
        const problem = transportException("RECONCILIATION", error);
        issues.push(problem);
        reconciliation = stageFailure(problem);
      }
      if (reconciliation?.outcome === "FAILED") {
        return this.finishAttempt({
          authorizationId: authorization.authorizationId,
          request: stableRequest,
          transport,
          context,
          dispatch,
          reconciliation,
          execution,
          cancellation,
          cleanup: { outcome: "DEFERRED_RECONCILIATION" },
          requestedOutcome: "PROTOCOL_FAILED",
          executionReportedMicroUsd,
          cancellationReportedMicroUsd,
          finalCostKnown: false,
          issues,
        });
      }
      if (reconciliation?.outcome === "STILL_UNKNOWN") {
        return this.finishAttempt({
          authorizationId: authorization.authorizationId,
          request: stableRequest,
          transport,
          context,
          dispatch,
          reconciliation,
          execution,
          cancellation,
          cleanup: { outcome: "DEFERRED_RECONCILIATION" },
          requestedOutcome: "RECONCILIATION_REQUIRED",
          executionReportedMicroUsd,
          cancellationReportedMicroUsd,
          finalCostKnown: false,
          issues,
        });
      }
      if (reconciliation?.outcome === "NOT_DISPATCHED_CONFIRMED") {
        const cost = this.#ledger.reconcile(stableRequest.attempt.attemptId, 0n);
        if (!cost.ok) {
          issues.push(
            issue("COST_RECONCILIATION", "COST_RECONCILIATION_ERROR", cost.error.message),
          );
        }
        return this.finishAttempt({
          authorizationId: authorization.authorizationId,
          request: stableRequest,
          transport,
          context,
          dispatch,
          reconciliation,
          execution,
          cancellation,
          cleanup: { outcome: "NOT_REQUIRED" },
          requestedOutcome: "NOT_DISPATCHED",
          executionReportedMicroUsd,
          cancellationReportedMicroUsd,
          finalCostKnown: cost.ok,
          issues,
          skipCostReconciliation: true,
        });
      }
    }

    const performCancellation = async (): Promise<boolean> => {
      try {
        const raw = await transport.cancel(context);
        const validated = validateCancellationResult(raw);
        cancellationReportedMicroUsd = validated.reportedMicroUsd;
        if (!validated.ok) {
          issues.push(validated.issue);
          cancellation = stageFailure(validated.issue);
          return false;
        }
        cancellation = validated.value;
        return true;
      } catch (error) {
        const problem = transportException("CANCELLATION", error);
        issues.push(problem);
        cancellation = stageFailure(problem);
        return false;
      }
    };

    const performCleanup = async (): Promise<SandboxCleanupEvidence> => {
      try {
        const validated = validateCleanupResult(await transport.cleanup(context));
        if (validated.ok) return validated.value;
        issues.push(validated.issue);
        return stageFailure(validated.issue);
      } catch (error) {
        const problem = transportException("CLEANUP", error);
        issues.push(problem);
        return stageFailure(problem);
      }
    };

    let requestedOutcome: SandboxAttemptOutcome;
    let finalCostKnown = false;
    if (stableRequest.cancelRequested) {
      finalCostKnown = await performCancellation();
      requestedOutcome = "CANCELLED";
    } else {
      try {
        const raw = await transport.execute(context);
        const validated = validateExecutionResult(raw, context);
        executionReportedMicroUsd = validated.reportedMicroUsd;
        if (!validated.ok) {
          issues.push(validated.issue);
          execution = stageFailure(validated.issue);
          finalCostKnown = await performCancellation();
          requestedOutcome = "PROTOCOL_FAILED";
        } else {
          execution = validated.value;
          if (execution.outcome === "TIMED_OUT") {
            finalCostKnown = await performCancellation();
            requestedOutcome = "TIMED_OUT";
          } else {
            finalCostKnown = true;
            requestedOutcome = "SUCCEEDED";
          }
        }
      } catch (error) {
        const problem = transportException("EXECUTION", error);
        issues.push(problem);
        execution = stageFailure(problem);
        finalCostKnown = await performCancellation();
        requestedOutcome = "TRANSPORT_FAILED";
      }
    }

    // Acknowledged work always gets best-effort cleanup, even after execution/cancel failure.
    cleanup = await performCleanup();
    if (cleanup.outcome === "FAILED" && issues.length === 0) requestedOutcome = "CLEANUP_FAILED";

    return this.finishAttempt({
      authorizationId: authorization.authorizationId,
      request: stableRequest,
      transport,
      context,
      dispatch,
      reconciliation,
      execution,
      cancellation,
      cleanup,
      requestedOutcome,
      executionReportedMicroUsd,
      cancellationReportedMicroUsd,
      finalCostKnown,
      issues,
    });
  }

  private finishAttempt(input: {
    readonly authorizationId: string;
    readonly request: SandboxAttemptRequest;
    readonly transport: ProviderNeutralSandboxTransport;
    readonly context: SandboxTransportContext;
    readonly dispatch: SandboxDispatchEvidence;
    readonly reconciliation: SandboxReconciliationEvidence | null;
    readonly execution: SandboxExecutionEvidence | null;
    readonly cancellation: SandboxCancellationEvidence | null;
    readonly cleanup: SandboxCleanupEvidence;
    readonly requestedOutcome: SandboxAttemptOutcome;
    readonly executionReportedMicroUsd: MicroUsd | null;
    readonly cancellationReportedMicroUsd: MicroUsd | null;
    readonly finalCostKnown: boolean;
    readonly issues: SandboxOperationalIssue[];
    readonly skipCostReconciliation?: boolean;
  }): SandboxRunResult {
    const { request } = input;
    let conservativeReportedMicroUsd = input.executionReportedMicroUsd;
    let cumulativeMonotonic: boolean | null = null;
    if (input.cancellationReportedMicroUsd !== null) {
      if (input.executionReportedMicroUsd !== null) {
        cumulativeMonotonic = input.cancellationReportedMicroUsd >= input.executionReportedMicroUsd;
        if (!cumulativeMonotonic) {
          input.issues.push(
            issue(
              "COST_RECONCILIATION",
              "CUMULATIVE_COST_REGRESSION",
              "Cancellation cumulative cost regressed below execution; the larger report is retained.",
            ),
          );
        }
      }
      if (
        conservativeReportedMicroUsd === null ||
        input.cancellationReportedMicroUsd > conservativeReportedMicroUsd
      ) {
        conservativeReportedMicroUsd = input.cancellationReportedMicroUsd;
      }
    }

    const reservationOverrunMicroUsd =
      conservativeReportedMicroUsd !== null &&
      conservativeReportedMicroUsd > request.reservationMicroUsd
        ? conservativeReportedMicroUsd - request.reservationMicroUsd
        : 0n;
    if (reservationOverrunMicroUsd > 0n) {
      input.issues.push(
        issue(
          "COST_RECONCILIATION",
          "RESERVATION_OVERRUN",
          `Observed cumulative cost exceeds the immutable reservation by ${reservationOverrunMicroUsd} micro-USD.`,
        ),
      );
    }
    if (!input.skipCostReconciliation && conservativeReportedMicroUsd !== null) {
      const observed = this.#ledger.observeReportedCost(
        request.attempt.attemptId,
        conservativeReportedMicroUsd,
      );
      if (!observed.ok) {
        input.issues.push(
          issue("COST_RECONCILIATION", "COST_RECONCILIATION_ERROR", observed.error.message),
        );
      } else if (input.finalCostKnown) {
        const reconciled = this.#ledger.reconcile(
          request.attempt.attemptId,
          conservativeReportedMicroUsd,
        );
        if (!reconciled.ok) {
          input.issues.push(
            issue("COST_RECONCILIATION", "COST_RECONCILIATION_ERROR", reconciled.error.message),
          );
        }
      }
    }

    if (
      input.cleanup.outcome === "FAILED" &&
      "reason" in input.cleanup &&
      input.issues.length > 0
    ) {
      input.issues.push(issue("CLEANUP", "CLEANUP_FAILED", input.cleanup.reason));
    }

    const reportedCostFacts: SandboxReportedCostFacts = deepFreeze({
      executionReportedMicroUsd: input.executionReportedMicroUsd,
      cancellationReportedMicroUsd: input.cancellationReportedMicroUsd,
      conservativeReportedMicroUsd,
      cumulativeMonotonic,
      reservationOverrunMicroUsd,
    });
    const frozenIssues = deepFreeze([...input.issues]);
    const outcome = this.failureOutcome(frozenIssues) ?? input.requestedOutcome;
    const payload: SandboxAttemptEvidencePayload = deepFreeze({
      schemaVersion: "provider-sandbox-evidence/v1" as const,
      authorizationId: input.authorizationId,
      task: this.task,
      attempt: request.attempt,
      bindingFacts: input.context.bindingFacts,
      bindingHash: input.context.bindingHash,
      outcome,
      dispatch: input.dispatch,
      reconciliation: input.reconciliation,
      execution: input.execution,
      cancellation: input.cancellation,
      cleanup: input.cleanup,
      cost: this.#ledger.attemptEvidence(request.attempt.attemptId)!,
      reportedCostFacts,
      taskCostAfter: this.#ledger.snapshot(),
      issues: frozenIssues,
      transportCalls: input.transport.callLog(),
      safety: {
        providerCalls: 0 as const,
        networkCalls: 0 as const,
        credentialReads: 0 as const,
        providerSdkCalls: 0 as const,
        externalSpendMicroUsd: 0n as const,
      },
      observedAtEpochMs: input.context.observedAtEpochMs,
      deadlineEpochMs: input.context.deadlineEpochMs,
    });
    const evidence: SandboxAttemptEvidence = deepFreeze({
      ...payload,
      evidenceHash: hashSandboxEvidence(payload),
    });
    if (frozenIssues.length === 0) return deepFreeze({ ok: true as const, evidence });
    return deepFreeze({
      ok: false as const,
      error: {
        code: this.failureCode(frozenIssues),
        message: frozenIssues.map((problem) => `${problem.stage}: ${problem.message}`).join(" | "),
        transportCalls: evidence.transportCalls,
        taskCost: evidence.taskCostAfter,
        evidence,
      },
    });
  }

  private failureOutcome(issues: readonly SandboxOperationalIssue[]): SandboxAttemptOutcome | null {
    if (issues.length === 0) return null;
    if (issues.length > 1) return "COMPOUND_FAILURE";
    const only = issues[0]!;
    if (only.code === "RESERVATION_OVERRUN" || only.code === "COST_RECONCILIATION_ERROR") {
      return "COST_RECONCILIATION_FAILED";
    }
    return only.code === "TRANSPORT_EXCEPTION" ? "TRANSPORT_FAILED" : "PROTOCOL_FAILED";
  }

  private failureCode(issues: readonly SandboxOperationalIssue[]): SandboxFailureCode {
    if (issues.length > 1) return "COMPOUND_FAILURE";
    const only = issues[0]!;
    return only.code === "RESERVATION_OVERRUN" || only.code === "COST_RECONCILIATION_ERROR"
      ? "COST_RECONCILIATION_FAILED"
      : "TRANSPORT_PROTOCOL_FAILURE";
  }
}

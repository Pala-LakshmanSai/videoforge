import { SandboxCostLedger } from "./cost-ledger.js";
import {
  deepFreeze,
  hashSandboxAttemptBinding,
  hashSandboxEvidence,
  hashSandboxOwner,
  isSha256,
  sha256DeterministicRecord,
} from "./hashing.js";
import type {
  ProviderNeutralSandboxTransport,
  SandboxAttemptCostEvidence,
  SandboxAttemptEvidence,
  SandboxAttemptEvidencePayload,
  SandboxAttemptOutcome,
  SandboxAttemptRequest,
  SandboxAuthorizationEnvelope,
  SandboxClock,
  SandboxFailureCode,
  SandboxRunResult,
  SandboxTaskIdentity,
  SandboxTransportContext,
} from "./types.js";

export interface ProviderSandboxHarnessOptions {
  readonly task: SandboxTaskIdentity;
  readonly taskCapMicroUsd: bigint;
  readonly clock: SandboxClock;
}

type PreflightFailure = { readonly code: SandboxFailureCode; readonly message: string };

const fail = (code: SandboxFailureCode, message: string): PreflightFailure => ({ code, message });

function validIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" && value.length >= 1 && value.length <= 240 && value.trim() === value
  );
}

function expectedOwnerKeys(
  ownerType: SandboxTaskIdentity["owner"]["ownerType"],
): readonly string[] {
  if (ownerType === "PROJECT_REVISION") {
    return ["ownerId", "ownerType", "projectRevisionId"];
  }
  if (ownerType === "IMAGE_STYLE_VERSION") {
    return ["imageStyleVersionId", "ownerId", "ownerType"];
  }
  return ["avatarProfileVersionId", "ownerId", "ownerType"];
}

function validateTaskIdentity(task: SandboxTaskIdentity): PreflightFailure | null {
  if (!validIdentifier(task.taskId) || !validIdentifier(task.taskKey)) {
    return fail("IDENTITY_INVALID", "Task ID and task key must be non-empty trimmed identifiers.");
  }
  if (!validIdentifier(task.owner.ownerId)) {
    return fail("IDENTITY_INVALID", "Owner ID must be a non-empty trimmed identifier.");
  }
  const keys = Object.keys(task.owner).sort();
  if (keys.join("|") !== expectedOwnerKeys(task.owner.ownerType).join("|")) {
    return fail("IDENTITY_INVALID", "Owner identity must contain exactly one concrete owner key.");
  }
  const concreteId =
    task.owner.ownerType === "PROJECT_REVISION"
      ? task.owner.projectRevisionId
      : task.owner.ownerType === "IMAGE_STYLE_VERSION"
        ? task.owner.imageStyleVersionId
        : task.owner.avatarProfileVersionId;
  if (concreteId !== task.owner.ownerId) {
    return fail("IDENTITY_INVALID", "Concrete owner ID must equal ownerId.");
  }
  if (!isSha256(task.ownerHash) || !isSha256(task.taskHash)) {
    return fail("INVALID_HASH", "Owner and task hashes must be lowercase sha256 digests.");
  }
  if (hashSandboxOwner(task.owner) !== task.ownerHash) {
    return fail("IDENTITY_HASH_MISMATCH", "Owner hash does not match the exact durable owner.");
  }
  const expectedTaskHash = sha256DeterministicRecord({
    ownerHash: task.ownerHash,
    schemaVersion: "provider-sandbox-task/v1",
    taskId: task.taskId,
    taskKey: task.taskKey,
  });
  if (expectedTaskHash !== task.taskHash) {
    return fail("IDENTITY_HASH_MISMATCH", "Task hash does not match its owner, ID, and task key.");
  }
  return null;
}

function validateAuthorization(
  authorization: SandboxAuthorizationEnvelope | undefined,
  task: SandboxTaskIdentity,
  nowEpochMs: number,
): PreflightFailure | null {
  if (authorization === undefined) {
    return fail("AUTHORIZATION_REQUIRED", "A sandbox authorization envelope is required.");
  }
  if (
    authorization.schemaVersion !== "provider-sandbox-authorization/v1" ||
    !validIdentifier(authorization.authorizationId)
  ) {
    return fail("AUTHORIZATION_REQUIRED", "The sandbox authorization envelope is malformed.");
  }
  if (!authorization.enabled || !authorization.sandboxExecutionAuthorized) {
    return fail("AUTHORIZATION_DISABLED", "Sandbox execution is not enabled by the envelope.");
  }
  if (authorization.taskHash !== task.taskHash) {
    return fail("AUTHORIZATION_SCOPE_MISMATCH", "Authorization is bound to a different task hash.");
  }
  if (
    !Number.isSafeInteger(authorization.issuedAtEpochMs) ||
    !Number.isSafeInteger(authorization.expiresAtEpochMs) ||
    authorization.issuedAtEpochMs > nowEpochMs ||
    authorization.expiresAtEpochMs <= nowEpochMs
  ) {
    return fail("AUTHORIZATION_EXPIRED", "Sandbox authorization is not active at the fixed clock.");
  }
  if (
    authorization.providerCallsAuthorized ||
    authorization.networkAccessAuthorized ||
    authorization.credentialAccessAuthorized ||
    authorization.authorizedExternalSpendMicroUsd !== 0n
  ) {
    return fail(
      "UNSAFE_AUTHORIZATION",
      "Sandbox authorization must prohibit provider, network, credential, and spend access.",
    );
  }
  return null;
}

function validateTransport(transport: ProviderNeutralSandboxTransport): PreflightFailure | null {
  if (
    transport.safety.kind !== "DETERMINISTIC_FAKE" ||
    transport.safety.networkAccess ||
    transport.safety.credentialAccess ||
    transport.safety.providerSdkAccess ||
    transport.safety.maximumExternalSpendMicroUsd !== 0n
  ) {
    return fail(
      "UNSAFE_TRANSPORT",
      "Only a deterministic fake with zero network, credential, SDK, and spend capability is allowed.",
    );
  }
  return null;
}

function validateAttemptRequest(
  request: SandboxAttemptRequest,
  nowEpochMs: number,
): PreflightFailure | null {
  if (
    !validIdentifier(request.attempt.attemptId) ||
    !validIdentifier(request.attempt.executionProfileId)
  ) {
    return fail(
      "IDENTITY_INVALID",
      "Attempt and execution-profile IDs must be trimmed identifiers.",
    );
  }
  if (!isSha256(request.attempt.executionProfileHash) || !isSha256(request.attempt.inputHash)) {
    return fail("INVALID_HASH", "Profile and input hashes must be lowercase sha256 digests.");
  }
  if (!Number.isSafeInteger(request.deadlineEpochMs) || request.deadlineEpochMs <= nowEpochMs) {
    return fail("INVALID_DEADLINE", "Attempt deadline must be a future safe integer timestamp.");
  }
  return null;
}

export class ProviderSandboxHarness {
  readonly task: SandboxTaskIdentity;
  readonly #clock: SandboxClock;
  readonly #ledger: SandboxCostLedger;
  readonly #taskIdentityFailure: PreflightFailure | null;

  constructor(options: ProviderSandboxHarnessOptions) {
    this.task = deepFreeze({
      ...options.task,
      owner: { ...options.task.owner },
    });
    this.#clock = options.clock;
    this.#ledger = new SandboxCostLedger(options.taskCapMicroUsd);
    this.#taskIdentityFailure = validateTaskIdentity(this.task);
  }

  taskCost() {
    return this.#ledger.snapshot();
  }

  async runAttempt(
    request: SandboxAttemptRequest,
    transport: ProviderNeutralSandboxTransport,
  ): Promise<SandboxRunResult> {
    const stableRequest: SandboxAttemptRequest = deepFreeze({
      ...request,
      ...(request.authorization === undefined
        ? {}
        : { authorization: { ...request.authorization } }),
      attempt: { ...request.attempt },
    });
    const preflightCalls = transport.callLog();
    const reject = (failure: PreflightFailure): SandboxRunResult =>
      deepFreeze({
        ok: false as const,
        error: {
          ...failure,
          transportCalls: transport.callLog(),
          taskCost: this.#ledger.snapshot(),
        },
      });

    if (preflightCalls.length !== 0) {
      return reject(fail("UNSAFE_TRANSPORT", "Transport must be fresh for each sandbox attempt."));
    }
    if (this.#taskIdentityFailure !== null) return reject(this.#taskIdentityFailure);

    const nowEpochMs = this.#clock.nowEpochMs();
    if (!Number.isSafeInteger(nowEpochMs)) {
      return reject(
        fail("INVALID_DEADLINE", "Sandbox clock must return a safe integer timestamp."),
      );
    }
    const authorizationFailure = validateAuthorization(
      stableRequest.authorization,
      this.task,
      nowEpochMs,
    );
    if (authorizationFailure !== null) return reject(authorizationFailure);
    const transportFailure = validateTransport(transport);
    if (transportFailure !== null) return reject(transportFailure);
    const attemptFailure = validateAttemptRequest(stableRequest, nowEpochMs);
    if (attemptFailure !== null) return reject(attemptFailure);

    const reserved = this.#ledger.reserve(
      stableRequest.attempt.attemptId,
      stableRequest.attemptSubcapMicroUsd,
      stableRequest.reservationMicroUsd,
    );
    if (!reserved.ok) return reject(reserved.error);

    const bindingHash = hashSandboxAttemptBinding(this.task, stableRequest.attempt);
    const context: SandboxTransportContext = deepFreeze({
      task: this.task,
      attempt: stableRequest.attempt,
      bindingHash,
      deadlineEpochMs: stableRequest.deadlineEpochMs,
      observedAtEpochMs: nowEpochMs,
    });

    try {
      const dispatch = await transport.dispatch(context);
      let reconciliation: SandboxAttemptEvidencePayload["reconciliation"] = null;

      if (dispatch.state === "AMBIGUOUS") {
        reconciliation = await transport.reconcile(context);
        if (reconciliation.outcome === "STILL_UNKNOWN") {
          return this.successEvidence({
            authorizationId: stableRequest.authorization!.authorizationId,
            request: stableRequest,
            transport,
            context,
            dispatch,
            reconciliation,
            execution: null,
            cancellation: null,
            cleanup: { outcome: "DEFERRED_RECONCILIATION" },
            outcome: "RECONCILIATION_REQUIRED",
            cost: this.#ledger.attemptEvidence(stableRequest.attempt.attemptId)!,
          });
        }
        if (reconciliation.outcome === "NOT_DISPATCHED_CONFIRMED") {
          const reconciledCost = this.#ledger.reconcile(stableRequest.attempt.attemptId, 0n);
          if (!reconciledCost.ok) return reject(reconciledCost.error);
          return this.successEvidence({
            authorizationId: stableRequest.authorization!.authorizationId,
            request: stableRequest,
            transport,
            context,
            dispatch,
            reconciliation,
            execution: null,
            cancellation: null,
            cleanup: { outcome: "NOT_REQUIRED" },
            outcome: "NOT_DISPATCHED",
            cost: reconciledCost.value,
          });
        }
      }

      let execution: SandboxAttemptEvidencePayload["execution"] = null;
      let cancellation: SandboxAttemptEvidencePayload["cancellation"] = null;
      let reportedMicroUsd: bigint;
      let outcome: SandboxAttemptOutcome;

      if (stableRequest.cancelRequested) {
        cancellation = await transport.cancel(context);
        reportedMicroUsd = cancellation.reportedMicroUsd;
        outcome = "CANCELLED";
      } else {
        execution = await transport.execute(context);
        reportedMicroUsd = execution.reportedMicroUsd;
        if (execution.outcome === "TIMED_OUT") {
          cancellation = await transport.cancel(context);
          reportedMicroUsd = cancellation.reportedMicroUsd;
          outcome = "TIMED_OUT";
        } else {
          outcome = "SUCCEEDED";
        }
      }

      const cleanup = await transport.cleanup(context);
      const reconciledCost = this.#ledger.reconcile(
        stableRequest.attempt.attemptId,
        reportedMicroUsd,
      );
      if (!reconciledCost.ok) return reject(reconciledCost.error);
      if (cleanup.outcome === "FAILED") outcome = "CLEANUP_FAILED";

      return this.successEvidence({
        authorizationId: stableRequest.authorization!.authorizationId,
        request: stableRequest,
        transport,
        context,
        dispatch,
        reconciliation,
        execution,
        cancellation,
        cleanup,
        outcome,
        cost: reconciledCost.value,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reject(fail("TRANSPORT_PROTOCOL_FAILURE", message));
    }
  }

  private successEvidence(input: {
    readonly authorizationId: string;
    readonly request: SandboxAttemptRequest;
    readonly transport: ProviderNeutralSandboxTransport;
    readonly context: SandboxTransportContext;
    readonly dispatch: SandboxAttemptEvidencePayload["dispatch"];
    readonly reconciliation: SandboxAttemptEvidencePayload["reconciliation"];
    readonly execution: SandboxAttemptEvidencePayload["execution"];
    readonly cancellation: SandboxAttemptEvidencePayload["cancellation"];
    readonly cleanup: SandboxAttemptEvidencePayload["cleanup"];
    readonly outcome: SandboxAttemptOutcome;
    readonly cost: SandboxAttemptCostEvidence;
  }): SandboxRunResult {
    const payload: SandboxAttemptEvidencePayload = deepFreeze({
      schemaVersion: "provider-sandbox-evidence/v1" as const,
      authorizationId: input.authorizationId,
      task: this.task,
      attempt: { ...input.request.attempt },
      bindingHash: input.context.bindingHash,
      outcome: input.outcome,
      dispatch: input.dispatch,
      reconciliation: input.reconciliation,
      execution: input.execution,
      cancellation: input.cancellation,
      cleanup: input.cleanup,
      cost: input.cost,
      taskCostAfter: this.#ledger.snapshot(),
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
    return deepFreeze({ ok: true as const, evidence });
  }
}

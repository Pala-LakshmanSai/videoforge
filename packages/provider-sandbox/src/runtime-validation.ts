import { isAuthenticDeterministicFakeTransport } from "./fake-transport.js";
import {
  deepFreeze,
  hasExactSnapshotKeys,
  hashSandboxOwner,
  isSha256,
  sha256DeterministicRecord,
  snapshotOwnDataRecord,
} from "./hashing.js";
import type {
  MicroUsd,
  ProviderNeutralSandboxTransport,
  SandboxAttemptRequest,
  SandboxAuthorizationEnvelope,
  SandboxCancellationResult,
  SandboxCleanupResult,
  SandboxDispatchEvidence,
  SandboxDispatchReconciliation,
  SandboxDispatchResult,
  SandboxExecutionResult,
  SandboxFailureCode,
  SandboxOperationStage,
  SandboxOperationalIssue,
  SandboxOwner,
  SandboxStageFailure,
  SandboxTaskIdentity,
  SandboxTransportContext,
} from "./types.js";

export type PreflightFailure = { readonly code: SandboxFailureCode; readonly message: string };
export type ValidationResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly issue: SandboxOperationalIssue };
export type CanonicalPreflightResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly failure: PreflightFailure };
export type CostedValidationResult<Value> =
  | { readonly ok: true; readonly value: Value; readonly reportedMicroUsd: MicroUsd }
  | {
      readonly ok: false;
      readonly issue: SandboxOperationalIssue;
      readonly reportedMicroUsd: MicroUsd | null;
    };

export const preflightFailure = (code: SandboxFailureCode, message: string): PreflightFailure => ({
  code,
  message,
});

export const operationalIssue = (
  stage: SandboxOperationStage,
  code: SandboxOperationalIssue["code"],
  message: string,
): SandboxOperationalIssue => deepFreeze({ stage, code, message });

const validIdentifier = (value: unknown): value is string =>
  typeof value === "string" && value.length >= 1 && value.length <= 240 && value.trim() === value;

const validReason = (value: unknown): value is string =>
  typeof value === "string" && value.length >= 1 && value.length <= 1_000 && value.trim() === value;

export const validMoney = (value: unknown): value is MicroUsd =>
  typeof value === "bigint" && value >= 0n;

const ownerKeys = (ownerType: string): readonly string[] | null => {
  if (ownerType === "PROJECT_REVISION") return ["ownerId", "ownerType", "projectRevisionId"];
  if (ownerType === "IMAGE_STYLE_VERSION") {
    return ["imageStyleVersionId", "ownerId", "ownerType"];
  }
  if (ownerType === "AVATAR_PROFILE_VERSION") {
    return ["avatarProfileVersionId", "ownerId", "ownerType"];
  }
  return null;
};

const TASK_KEYS = ["owner", "ownerHash", "taskHash", "taskId", "taskKey"] as const;
const OWNER_KEYS = [
  "avatarProfileVersionId",
  "imageStyleVersionId",
  "ownerId",
  "ownerType",
  "projectRevisionId",
] as const;
const AUTHORIZATION_KEYS = [
  "authorizationId",
  "authorizedExternalSpendMicroUsd",
  "credentialAccessAuthorized",
  "enabled",
  "expiresAtEpochMs",
  "issuedAtEpochMs",
  "networkAccessAuthorized",
  "providerCallsAuthorized",
  "sandboxExecutionAuthorized",
  "schemaVersion",
  "taskHash",
] as const;
const ATTEMPT_KEYS = [
  "attemptId",
  "executionProfileHash",
  "executionProfileId",
  "inputHash",
] as const;
const REQUEST_KEYS = [
  "attempt",
  "attemptSubcapMicroUsd",
  "authorization",
  "cancelRequested",
  "deadlineEpochMs",
  "reservationMicroUsd",
] as const;

const canonicalFailure = <Value>(failure: PreflightFailure): CanonicalPreflightResult<Value> => ({
  ok: false,
  failure,
});

export function canonicalizeTaskIdentity(
  value: unknown,
): CanonicalPreflightResult<SandboxTaskIdentity> {
  const task = snapshotOwnDataRecord(value, TASK_KEYS);
  if (task === null) {
    return canonicalFailure(
      preflightFailure(
        "IDENTITY_INVALID",
        "Task identity contains unknown, missing, or accessor fields.",
      ),
    );
  }
  const owner = snapshotOwnDataRecord(task.owner, OWNER_KEYS, ["ownerId", "ownerType"]);
  if (owner === null || typeof owner.ownerType !== "string") {
    return canonicalFailure(
      preflightFailure(
        "IDENTITY_INVALID",
        "Task owner must use own data fields and a recognized durable owner discriminator.",
      ),
    );
  }
  const expectedOwnerKeys = ownerKeys(owner.ownerType);
  if (expectedOwnerKeys === null) {
    return canonicalFailure(
      preflightFailure("IDENTITY_INVALID", `Unsupported durable owner type ${owner.ownerType}.`),
    );
  }
  if (!hasExactSnapshotKeys(owner, expectedOwnerKeys) || !validIdentifier(owner.ownerId)) {
    return canonicalFailure(
      preflightFailure(
        "IDENTITY_INVALID",
        "Owner identity must contain one valid concrete owner key.",
      ),
    );
  }
  const concreteKey = expectedOwnerKeys.find((key) => key.endsWith("Id") && key !== "ownerId")!;
  if (!validIdentifier(owner[concreteKey]) || owner[concreteKey] !== owner.ownerId) {
    return canonicalFailure(
      preflightFailure("IDENTITY_INVALID", "Concrete owner ID must equal ownerId."),
    );
  }
  if (!validIdentifier(task.taskId) || !validIdentifier(task.taskKey)) {
    return canonicalFailure(
      preflightFailure(
        "IDENTITY_INVALID",
        "Task ID and task key must be non-empty trimmed identifiers.",
      ),
    );
  }
  if (!isSha256(task.ownerHash) || !isSha256(task.taskHash)) {
    return canonicalFailure(
      preflightFailure("INVALID_HASH", "Owner and task hashes must be lowercase sha256 digests."),
    );
  }

  let canonicalOwner: SandboxOwner;
  if (owner.ownerType === "PROJECT_REVISION") {
    canonicalOwner = {
      ownerType: "PROJECT_REVISION",
      ownerId: owner.ownerId,
      projectRevisionId: owner.projectRevisionId as string,
    };
  } else if (owner.ownerType === "IMAGE_STYLE_VERSION") {
    canonicalOwner = {
      ownerType: "IMAGE_STYLE_VERSION",
      ownerId: owner.ownerId,
      imageStyleVersionId: owner.imageStyleVersionId as string,
    };
  } else {
    canonicalOwner = {
      ownerType: "AVATAR_PROFILE_VERSION",
      ownerId: owner.ownerId,
      avatarProfileVersionId: owner.avatarProfileVersionId as string,
    };
  }
  const canonicalTask: SandboxTaskIdentity = deepFreeze({
    owner: canonicalOwner,
    ownerHash: task.ownerHash,
    taskId: task.taskId,
    taskKey: task.taskKey,
    taskHash: task.taskHash,
  });
  if (hashSandboxOwner(canonicalTask.owner) !== canonicalTask.ownerHash) {
    return canonicalFailure(
      preflightFailure(
        "IDENTITY_HASH_MISMATCH",
        "Owner hash does not match the exact durable owner.",
      ),
    );
  }
  const expectedTaskHash = sha256DeterministicRecord({
    ownerHash: canonicalTask.ownerHash,
    schemaVersion: "provider-sandbox-task/v1",
    taskId: canonicalTask.taskId,
    taskKey: canonicalTask.taskKey,
  });
  return expectedTaskHash === canonicalTask.taskHash
    ? { ok: true, value: canonicalTask }
    : canonicalFailure(
        preflightFailure(
          "IDENTITY_HASH_MISMATCH",
          "Task hash does not match its owner, ID, and task key.",
        ),
      );
}

function canonicalizeAuthorization(
  value: unknown,
  task: SandboxTaskIdentity,
  nowEpochMs: number,
): CanonicalPreflightResult<SandboxAuthorizationEnvelope> {
  if (value === undefined) {
    return canonicalFailure(
      preflightFailure("AUTHORIZATION_REQUIRED", "A sandbox authorization envelope is required."),
    );
  }
  const authorization = snapshotOwnDataRecord(value, AUTHORIZATION_KEYS);
  if (
    authorization === null ||
    authorization.schemaVersion !== "provider-sandbox-authorization/v1" ||
    !validIdentifier(authorization.authorizationId) ||
    !isSha256(authorization.taskHash) ||
    typeof authorization.enabled !== "boolean" ||
    typeof authorization.sandboxExecutionAuthorized !== "boolean" ||
    typeof authorization.providerCallsAuthorized !== "boolean" ||
    typeof authorization.networkAccessAuthorized !== "boolean" ||
    typeof authorization.credentialAccessAuthorized !== "boolean" ||
    !validMoney(authorization.authorizedExternalSpendMicroUsd) ||
    !Number.isSafeInteger(authorization.issuedAtEpochMs) ||
    !Number.isSafeInteger(authorization.expiresAtEpochMs)
  ) {
    return canonicalFailure(
      preflightFailure(
        "AUTHORIZATION_REQUIRED",
        "The sandbox authorization envelope is malformed or contains non-data fields.",
      ),
    );
  }
  const canonical: SandboxAuthorizationEnvelope = deepFreeze({
    schemaVersion: authorization.schemaVersion,
    authorizationId: authorization.authorizationId,
    taskHash: authorization.taskHash,
    enabled: authorization.enabled,
    sandboxExecutionAuthorized: authorization.sandboxExecutionAuthorized,
    providerCallsAuthorized: authorization.providerCallsAuthorized,
    networkAccessAuthorized: authorization.networkAccessAuthorized,
    credentialAccessAuthorized: authorization.credentialAccessAuthorized,
    authorizedExternalSpendMicroUsd: authorization.authorizedExternalSpendMicroUsd,
    issuedAtEpochMs: Number(authorization.issuedAtEpochMs),
    expiresAtEpochMs: Number(authorization.expiresAtEpochMs),
  });
  if (!canonical.enabled || !canonical.sandboxExecutionAuthorized) {
    return canonicalFailure(
      preflightFailure(
        "AUTHORIZATION_DISABLED",
        "Sandbox execution is not enabled by the envelope.",
      ),
    );
  }
  if (canonical.taskHash !== task.taskHash) {
    return canonicalFailure(
      preflightFailure(
        "AUTHORIZATION_SCOPE_MISMATCH",
        "Authorization is bound to a different task hash.",
      ),
    );
  }
  if (canonical.issuedAtEpochMs > nowEpochMs || canonical.expiresAtEpochMs <= nowEpochMs) {
    return canonicalFailure(
      preflightFailure(
        "AUTHORIZATION_EXPIRED",
        "Sandbox authorization is not active at the fixed clock.",
      ),
    );
  }
  if (
    canonical.providerCallsAuthorized ||
    canonical.networkAccessAuthorized ||
    canonical.credentialAccessAuthorized ||
    canonical.authorizedExternalSpendMicroUsd !== 0n
  ) {
    return canonicalFailure(
      preflightFailure(
        "UNSAFE_AUTHORIZATION",
        "Sandbox authorization must prohibit provider, network, credential, and spend access.",
      ),
    );
  }
  return { ok: true, value: canonical };
}

export function canonicalizeAttemptRequest(
  value: unknown,
  task: SandboxTaskIdentity,
  nowEpochMs: number,
): CanonicalPreflightResult<SandboxAttemptRequest> {
  const request = snapshotOwnDataRecord(value, REQUEST_KEYS, [
    "attempt",
    "attemptSubcapMicroUsd",
    "cancelRequested",
    "deadlineEpochMs",
    "reservationMicroUsd",
  ]);
  if (request === null) {
    return canonicalFailure(
      preflightFailure(
        "IDENTITY_INVALID",
        "Attempt request contains unknown, missing, or accessor fields.",
      ),
    );
  }
  const authorization = canonicalizeAuthorization(request.authorization, task, nowEpochMs);
  if (!authorization.ok) return authorization;

  const attempt = snapshotOwnDataRecord(request.attempt, ATTEMPT_KEYS);
  if (
    attempt === null ||
    !validIdentifier(attempt.attemptId) ||
    !validIdentifier(attempt.executionProfileId)
  ) {
    return canonicalFailure(
      preflightFailure(
        "IDENTITY_INVALID",
        "Attempt identity contains unknown, missing, accessor, or invalid ID fields.",
      ),
    );
  }
  if (!isSha256(attempt.executionProfileHash) || !isSha256(attempt.inputHash)) {
    return canonicalFailure(
      preflightFailure(
        "INVALID_HASH",
        "Profile and input hashes must be lowercase sha256 digests.",
      ),
    );
  }
  if (!validMoney(request.attemptSubcapMicroUsd) || !validMoney(request.reservationMicroUsd)) {
    return canonicalFailure(
      preflightFailure(
        "INVALID_MONEY",
        "Sub-cap and reservation must be nonnegative bigint values.",
      ),
    );
  }
  if (typeof request.cancelRequested !== "boolean") {
    return canonicalFailure(
      preflightFailure("IDENTITY_INVALID", "Cancellation intent must be an explicit boolean."),
    );
  }
  if (
    !Number.isSafeInteger(request.deadlineEpochMs) ||
    Number(request.deadlineEpochMs) <= nowEpochMs
  ) {
    return canonicalFailure(
      preflightFailure(
        "INVALID_DEADLINE",
        "Attempt deadline must be a future safe integer timestamp.",
      ),
    );
  }
  return {
    ok: true,
    value: deepFreeze({
      authorization: authorization.value,
      attempt: {
        attemptId: attempt.attemptId,
        executionProfileId: attempt.executionProfileId,
        executionProfileHash: attempt.executionProfileHash,
        inputHash: attempt.inputHash,
      },
      attemptSubcapMicroUsd: request.attemptSubcapMicroUsd,
      reservationMicroUsd: request.reservationMicroUsd,
      deadlineEpochMs: Number(request.deadlineEpochMs),
      cancelRequested: request.cancelRequested,
    }),
  };
}

export function validateTransportSafety(
  transport: ProviderNeutralSandboxTransport,
): PreflightFailure | null {
  if (!isAuthenticDeterministicFakeTransport(transport)) {
    return preflightFailure(
      "UNSAFE_TRANSPORT",
      "Only a module-authenticated deterministic fake transport is allowed.",
    );
  }
  return transport.safety.kind === "DETERMINISTIC_FAKE" &&
    transport.safety.networkAccess === false &&
    transport.safety.credentialAccess === false &&
    transport.safety.providerSdkAccess === false &&
    transport.safety.maximumExternalSpendMicroUsd === 0n
    ? null
    : preflightFailure(
        "UNSAFE_TRANSPORT",
        "The authenticated fake must retain zero network, credential, SDK, and spend capability.",
      );
}

export function validateDispatchResult(value: unknown): ValidationResult<SandboxDispatchResult> {
  const result = snapshotOwnDataRecord(value, ["externalJobId", "reason", "state"], ["state"]);
  if (
    result !== null &&
    result.state === "ACKNOWLEDGED" &&
    hasExactSnapshotKeys(result, ["externalJobId", "state"]) &&
    validIdentifier(result.externalJobId)
  ) {
    return {
      ok: true,
      value: deepFreeze({ state: "ACKNOWLEDGED", externalJobId: result.externalJobId }),
    };
  }
  if (
    result !== null &&
    result.state === "AMBIGUOUS" &&
    hasExactSnapshotKeys(result, ["reason", "state"]) &&
    validReason(result.reason)
  ) {
    return { ok: true, value: deepFreeze({ state: "AMBIGUOUS", reason: result.reason }) };
  }
  return {
    ok: false,
    issue: operationalIssue(
      "DISPATCH",
      "RESULT_INVALID",
      "Dispatch result has an invalid state, external job ID, or ambiguity reason.",
    ),
  };
}

export function validateReconciliationResult(
  value: unknown,
): ValidationResult<SandboxDispatchReconciliation> {
  const result = snapshotOwnDataRecord(value, ["externalJobId", "outcome"], ["outcome"]);
  if (
    result !== null &&
    result.outcome === "ACKNOWLEDGEMENT_CONFIRMED" &&
    hasExactSnapshotKeys(result, ["externalJobId", "outcome"]) &&
    validIdentifier(result.externalJobId)
  ) {
    return {
      ok: true,
      value: deepFreeze({
        outcome: "ACKNOWLEDGEMENT_CONFIRMED",
        externalJobId: result.externalJobId,
      }),
    };
  }
  if (
    result !== null &&
    result.outcome === "NOT_DISPATCHED_CONFIRMED" &&
    hasExactSnapshotKeys(result, ["outcome"])
  ) {
    return { ok: true, value: deepFreeze({ outcome: "NOT_DISPATCHED_CONFIRMED" }) };
  }
  if (
    result !== null &&
    result.outcome === "STILL_UNKNOWN" &&
    hasExactSnapshotKeys(result, ["outcome"])
  ) {
    return { ok: true, value: deepFreeze({ outcome: "STILL_UNKNOWN" }) };
  }
  return {
    ok: false,
    issue: operationalIssue(
      "RECONCILIATION",
      "RESULT_INVALID",
      "Reconciliation outcome or confirmed external job ID is invalid.",
    ),
  };
}

export function validateExecutionResult(
  value: unknown,
  context: SandboxTransportContext,
): CostedValidationResult<SandboxExecutionResult> {
  const result = snapshotOwnDataRecord(
    value,
    ["outcome", "reportedMicroUsd", "resultHash", "timedOutAtEpochMs"],
    ["outcome", "reportedMicroUsd"],
  );
  const reportedMicroUsd =
    result !== null && validMoney(result.reportedMicroUsd) ? result.reportedMicroUsd : null;
  if (result === null || reportedMicroUsd === null) {
    return {
      ok: false,
      reportedMicroUsd,
      issue: operationalIssue(
        "EXECUTION",
        "RESULT_INVALID",
        "Execution result must contain a nonnegative cumulative micro-USD report.",
      ),
    };
  }
  if (
    result.outcome === "SUCCEEDED" &&
    hasExactSnapshotKeys(result, ["outcome", "reportedMicroUsd", "resultHash"]) &&
    isSha256(result.resultHash)
  ) {
    return {
      ok: true,
      reportedMicroUsd,
      value: deepFreeze({
        outcome: "SUCCEEDED",
        reportedMicroUsd,
        resultHash: result.resultHash,
      }),
    };
  }
  if (
    result.outcome === "TIMED_OUT" &&
    hasExactSnapshotKeys(result, ["outcome", "reportedMicroUsd", "timedOutAtEpochMs"]) &&
    Number.isSafeInteger(result.timedOutAtEpochMs) &&
    Number(result.timedOutAtEpochMs) >= context.deadlineEpochMs
  ) {
    return {
      ok: true,
      reportedMicroUsd,
      value: deepFreeze({
        outcome: "TIMED_OUT",
        reportedMicroUsd,
        timedOutAtEpochMs: Number(result.timedOutAtEpochMs),
      }),
    };
  }
  return {
    ok: false,
    reportedMicroUsd,
    issue: operationalIssue(
      "EXECUTION",
      "RESULT_INVALID",
      "Execution outcome, result hash, or timeout timestamp is invalid.",
    ),
  };
}

export function validateCancellationResult(
  value: unknown,
): CostedValidationResult<SandboxCancellationResult> {
  const result = snapshotOwnDataRecord(value, ["outcome", "reportedMicroUsd"]);
  const reportedMicroUsd =
    result !== null && validMoney(result.reportedMicroUsd) ? result.reportedMicroUsd : null;
  return result !== null && result.outcome === "CANCELLED" && reportedMicroUsd !== null
    ? {
        ok: true,
        reportedMicroUsd,
        value: deepFreeze({ outcome: "CANCELLED", reportedMicroUsd }),
      }
    : {
        ok: false,
        reportedMicroUsd,
        issue: operationalIssue(
          "CANCELLATION",
          "RESULT_INVALID",
          "Cancellation result must be CANCELLED with nonnegative cumulative micro-USD.",
        ),
      };
}

export function validateCleanupResult(value: unknown): ValidationResult<SandboxCleanupResult> {
  const result = snapshotOwnDataRecord(
    value,
    ["evidenceHash", "outcome", "reason"],
    ["evidenceHash", "outcome"],
  );
  if (
    result !== null &&
    result.outcome === "SUCCEEDED" &&
    hasExactSnapshotKeys(result, ["evidenceHash", "outcome"]) &&
    isSha256(result.evidenceHash)
  ) {
    return {
      ok: true,
      value: deepFreeze({ outcome: "SUCCEEDED", evidenceHash: result.evidenceHash }),
    };
  }
  if (
    result !== null &&
    result.outcome === "FAILED" &&
    hasExactSnapshotKeys(result, ["evidenceHash", "outcome", "reason"]) &&
    isSha256(result.evidenceHash) &&
    validReason(result.reason)
  ) {
    return {
      ok: true,
      value: deepFreeze({
        outcome: "FAILED",
        evidenceHash: result.evidenceHash,
        reason: result.reason,
      }),
    };
  }
  return {
    ok: false,
    issue: operationalIssue(
      "CLEANUP",
      "RESULT_INVALID",
      "Cleanup outcome, evidence hash, or failure reason is invalid.",
    ),
  };
}

export function stageFailure(problem: SandboxOperationalIssue): SandboxStageFailure {
  return deepFreeze({
    outcome: "FAILED",
    failureKind: problem.code === "TRANSPORT_EXCEPTION" ? "TRANSPORT_EXCEPTION" : "RESULT_INVALID",
    message: problem.message,
  });
}

export function dispatchFailure(problem: SandboxOperationalIssue): SandboxDispatchEvidence {
  return deepFreeze({
    state: "FAILED" as const,
    failureKind: problem.code === "TRANSPORT_EXCEPTION" ? "TRANSPORT_EXCEPTION" : "RESULT_INVALID",
    message: problem.message,
  });
}

export function transportException(
  stage: SandboxOperationStage,
  error: unknown,
): SandboxOperationalIssue {
  return operationalIssue(
    stage,
    "TRANSPORT_EXCEPTION",
    error instanceof Error ? error.message : String(error),
  );
}

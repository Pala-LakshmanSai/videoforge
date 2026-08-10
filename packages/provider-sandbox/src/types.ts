export type Sha256 = `sha256:${string}`;
export type MicroUsd = bigint;

export type SandboxOwner =
  | {
      readonly ownerType: "PROJECT_REVISION";
      readonly ownerId: string;
      readonly projectRevisionId: string;
    }
  | {
      readonly ownerType: "IMAGE_STYLE_VERSION";
      readonly ownerId: string;
      readonly imageStyleVersionId: string;
    }
  | {
      readonly ownerType: "AVATAR_PROFILE_VERSION";
      readonly ownerId: string;
      readonly avatarProfileVersionId: string;
    };

export interface SandboxTaskIdentity {
  readonly owner: SandboxOwner;
  readonly ownerHash: Sha256;
  readonly taskId: string;
  readonly taskKey: string;
  readonly taskHash: Sha256;
}

export interface SandboxAttemptIdentity {
  readonly attemptId: string;
  readonly executionProfileId: string;
  readonly executionProfileHash: Sha256;
  readonly inputHash: Sha256;
}

export interface SandboxAuthorizationEnvelope {
  readonly schemaVersion: "provider-sandbox-authorization/v1";
  readonly authorizationId: string;
  readonly taskHash: Sha256;
  readonly enabled: boolean;
  readonly sandboxExecutionAuthorized: boolean;
  readonly providerCallsAuthorized: boolean;
  readonly networkAccessAuthorized: boolean;
  readonly credentialAccessAuthorized: boolean;
  readonly authorizedExternalSpendMicroUsd: MicroUsd;
  readonly issuedAtEpochMs: number;
  readonly expiresAtEpochMs: number;
}

export interface SandboxClock {
  nowEpochMs(): number;
}

export interface SandboxAttemptRequest {
  readonly authorization?: SandboxAuthorizationEnvelope;
  readonly attempt: SandboxAttemptIdentity;
  readonly attemptSubcapMicroUsd: MicroUsd;
  readonly reservationMicroUsd: MicroUsd;
  readonly deadlineEpochMs: number;
  readonly cancelRequested: boolean;
}

export interface SandboxTransportSafety {
  readonly kind: "DETERMINISTIC_FAKE";
  readonly networkAccess: boolean;
  readonly credentialAccess: boolean;
  readonly providerSdkAccess: boolean;
  readonly maximumExternalSpendMicroUsd: MicroUsd;
}

export interface SandboxTransportContext {
  readonly task: SandboxTaskIdentity;
  readonly attempt: SandboxAttemptIdentity;
  readonly bindingHash: Sha256;
  readonly deadlineEpochMs: number;
  readonly observedAtEpochMs: number;
}

export type SandboxDispatchResult =
  | {
      readonly state: "ACKNOWLEDGED";
      readonly externalJobId: string;
    }
  | {
      readonly state: "AMBIGUOUS";
      readonly reason: string;
    };

export type SandboxDispatchReconciliation =
  | {
      readonly outcome: "ACKNOWLEDGEMENT_CONFIRMED";
      readonly externalJobId: string;
    }
  | {
      readonly outcome: "NOT_DISPATCHED_CONFIRMED";
    }
  | {
      readonly outcome: "STILL_UNKNOWN";
    };

export type SandboxExecutionResult =
  | {
      readonly outcome: "SUCCEEDED";
      readonly reportedMicroUsd: MicroUsd;
      readonly resultHash: Sha256;
    }
  | {
      readonly outcome: "TIMED_OUT";
      readonly reportedMicroUsd: MicroUsd;
      readonly timedOutAtEpochMs: number;
    };

export interface SandboxCancellationResult {
  readonly outcome: "CANCELLED";
  readonly reportedMicroUsd: MicroUsd;
}

export type SandboxCleanupResult =
  | {
      readonly outcome: "SUCCEEDED";
      readonly evidenceHash: Sha256;
    }
  | {
      readonly outcome: "FAILED";
      readonly evidenceHash: Sha256;
      readonly reason: string;
    };

export interface ProviderNeutralSandboxTransport {
  readonly safety: SandboxTransportSafety;
  dispatch(context: SandboxTransportContext): Promise<SandboxDispatchResult>;
  reconcile(context: SandboxTransportContext): Promise<SandboxDispatchReconciliation>;
  execute(context: SandboxTransportContext): Promise<SandboxExecutionResult>;
  cancel(context: SandboxTransportContext): Promise<SandboxCancellationResult>;
  cleanup(context: SandboxTransportContext): Promise<SandboxCleanupResult>;
  callLog(): readonly string[];
}

export type SandboxCostEventType = "RESERVED" | "REPORTED" | "SETTLED" | "REFUNDED";

export interface SandboxCostEvent {
  readonly sequence: number;
  readonly eventType: SandboxCostEventType;
  readonly amountMicroUsd: MicroUsd;
}

export interface SandboxAttemptCostEvidence {
  readonly currency: "USD";
  readonly taskCapMicroUsd: MicroUsd;
  readonly attemptSubcapMicroUsd: MicroUsd;
  readonly reservedMicroUsd: MicroUsd;
  readonly reportedMicroUsd: MicroUsd;
  readonly settledMicroUsd: MicroUsd;
  readonly refundedMicroUsd: MicroUsd;
  readonly activeReservedMicroUsd: MicroUsd;
  readonly reconciled: boolean;
  readonly events: readonly SandboxCostEvent[];
}

export interface SandboxTaskCostSnapshot {
  readonly currency: "USD";
  readonly taskCapMicroUsd: MicroUsd;
  readonly settledMicroUsd: MicroUsd;
  readonly activeReservedMicroUsd: MicroUsd;
  readonly availableMicroUsd: MicroUsd;
}

export type SandboxAttemptOutcome =
  | "SUCCEEDED"
  | "TIMED_OUT"
  | "CANCELLED"
  | "NOT_DISPATCHED"
  | "RECONCILIATION_REQUIRED"
  | "CLEANUP_FAILED";

export interface SandboxAttemptEvidencePayload {
  readonly schemaVersion: "provider-sandbox-evidence/v1";
  readonly authorizationId: string;
  readonly task: SandboxTaskIdentity;
  readonly attempt: SandboxAttemptIdentity;
  readonly bindingHash: Sha256;
  readonly outcome: SandboxAttemptOutcome;
  readonly dispatch:
    | { readonly state: "ACKNOWLEDGED"; readonly externalJobId: string }
    | { readonly state: "AMBIGUOUS"; readonly reason: string };
  readonly reconciliation: SandboxDispatchReconciliation | null;
  readonly execution: SandboxExecutionResult | null;
  readonly cancellation: SandboxCancellationResult | null;
  readonly cleanup:
    | SandboxCleanupResult
    | { readonly outcome: "NOT_REQUIRED" }
    | { readonly outcome: "DEFERRED_RECONCILIATION" };
  readonly cost: SandboxAttemptCostEvidence;
  readonly taskCostAfter: SandboxTaskCostSnapshot;
  readonly transportCalls: readonly string[];
  readonly safety: {
    readonly providerCalls: 0;
    readonly networkCalls: 0;
    readonly credentialReads: 0;
    readonly providerSdkCalls: 0;
    readonly externalSpendMicroUsd: 0n;
  };
  readonly observedAtEpochMs: number;
  readonly deadlineEpochMs: number;
}

export interface SandboxAttemptEvidence extends SandboxAttemptEvidencePayload {
  readonly evidenceHash: Sha256;
}

export type SandboxFailureCode =
  | "AUTHORIZATION_REQUIRED"
  | "AUTHORIZATION_DISABLED"
  | "AUTHORIZATION_EXPIRED"
  | "AUTHORIZATION_SCOPE_MISMATCH"
  | "UNSAFE_AUTHORIZATION"
  | "UNSAFE_TRANSPORT"
  | "IDENTITY_INVALID"
  | "IDENTITY_HASH_MISMATCH"
  | "INVALID_HASH"
  | "INVALID_MONEY"
  | "INVALID_DEADLINE"
  | "ATTEMPT_ID_REUSED"
  | "ATTEMPT_SUBCAP_EXCEEDED"
  | "TASK_CAP_EXCEEDED"
  | "COST_RECONCILIATION_FAILED"
  | "TRANSPORT_PROTOCOL_FAILURE";

export interface SandboxFailure {
  readonly code: SandboxFailureCode;
  readonly message: string;
  readonly transportCalls: readonly string[];
  readonly taskCost: SandboxTaskCostSnapshot;
}

export type SandboxRunResult =
  | { readonly ok: true; readonly evidence: SandboxAttemptEvidence }
  | { readonly ok: false; readonly error: SandboxFailure };

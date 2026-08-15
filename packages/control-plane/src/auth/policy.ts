import { snapshotExactPlainRecord, snapshotPlainRecord } from "./plain-data.js";
import type {
  AuthClock,
  AuthFailure,
  AuthProblem,
  AuthSession,
  GoogleSignInAuthorizationRequest,
  GoogleSignInAuthorizationResult,
  GrantedGoogleSignInAuthorization,
  GrantedReviewerAuthorization,
  GrantedWorkspaceAuthorization,
  ReviewerMutationPayload,
  ReviewerAuthorizationResult,
  SessionIdentityProvider,
  WorkspaceAccessRecord,
  WorkspaceAuthorizationDirectory,
  WorkspaceAuthorizationRequest,
  WorkspaceAuthorizationResult,
} from "./types.js";
import {
  authIdentifier,
  authSessionToken,
  normalizedAuthEmailValue,
  sameAuthSession,
  snapshotAuthSession,
  snapshotSignInInvitationRecord,
  snapshotWorkspaceAccessRecord,
} from "./validation.js";

const AUTHENTICATION_REQUIRED_PROBLEM = Object.freeze({
  code: "AUTHENTICATION_REQUIRED",
  status: 401,
  title: "Authentication is required",
  detail: "Continue with an invited account before requesting workspace data or actions.",
  retryable: false,
} satisfies AuthProblem);

const WORKSPACE_ACCESS_REQUIRED_PROBLEM = Object.freeze({
  code: "WORKSPACE_ACCESS_REQUIRED",
  status: 403,
  title: "Workspace access is required",
  detail: "This account is not authorized for the requested workspace.",
  retryable: false,
} satisfies AuthProblem);

const CLIENT_REVIEWER_IDENTITY_FORBIDDEN_PROBLEM = Object.freeze({
  code: "CLIENT_REVIEWER_IDENTITY_FORBIDDEN",
  status: 422,
  title: "Reviewer identity must not be supplied",
  detail: "Reviewer identity is derived only from the authenticated server session.",
  retryable: false,
} satisfies AuthProblem);

const AUTHENTICATION_REQUIRED = Object.freeze({
  ok: false,
  problem: AUTHENTICATION_REQUIRED_PROBLEM,
} satisfies AuthFailure);

const WORKSPACE_ACCESS_REQUIRED = Object.freeze({
  ok: false,
  problem: WORKSPACE_ACCESS_REQUIRED_PROBLEM,
} satisfies AuthFailure);

const CLIENT_REVIEWER_IDENTITY_FORBIDDEN = Object.freeze({
  ok: false,
  problem: CLIENT_REVIEWER_IDENTITY_FORBIDDEN_PROBLEM,
} satisfies AuthFailure);

function currentTime(clock: AuthClock): number {
  const nowEpochMs = clock.nowEpochMs();
  if (!Number.isSafeInteger(nowEpochMs) || nowEpochMs < 0) {
    throw new RangeError("auth clock must return a non-negative safe epoch-millisecond integer");
  }
  return nowEpochMs;
}

function isCurrentSession(session: AuthSession, nowEpochMs: number): boolean {
  const issuedAt = Date.parse(session.issuedAt);
  const expiresAt = Date.parse(session.expiresAt);
  return (
    session.status === "ACTIVE" &&
    issuedAt < expiresAt &&
    nowEpochMs >= issuedAt &&
    nowEpochMs < expiresAt
  );
}

function isExactActiveAccess(
  session: AuthSession,
  requestedWorkspaceId: string,
  access: WorkspaceAccessRecord,
): boolean {
  return (
    access.workspace.workspaceId === requestedWorkspaceId &&
    access.workspace.status === "ACTIVE" &&
    authIdentifier(access.workspace.accountId) &&
    access.identity.userId === session.userId &&
    access.identity.normalizedEmail === session.normalizedEmail &&
    access.identity.status === "ACTIVE" &&
    access.invitation.workspaceId === requestedWorkspaceId &&
    access.invitation.normalizedEmail === session.normalizedEmail &&
    access.invitation.status === "ACCEPTED" &&
    access.membership.workspaceId === requestedWorkspaceId &&
    access.membership.userId === session.userId &&
    access.membership.status === "ACTIVE" &&
    (access.membership.role === "ADMIN" || access.membership.role === "MEMBER")
  );
}

function freezeAuthorization(
  session: AuthSession,
  access: WorkspaceAccessRecord,
): GrantedWorkspaceAuthorization {
  const principal = Object.freeze({
    sessionId: session.sessionId,
    userId: session.userId,
    normalizedEmail: session.normalizedEmail,
    provider: session.provider,
  });
  const workspace = Object.freeze({
    workspaceId: access.workspace.workspaceId,
    accountId: access.workspace.accountId,
    membershipId: access.membership.membershipId,
    role: access.membership.role,
  });
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      authorized: true,
      reason: "ACTIVE_MEMBER",
      principal,
      workspace,
    }),
  });
}

function workspaceRequest(value: unknown): {
  readonly sessionToken: string | null;
  readonly workspaceId: string | null;
} | null {
  const record = snapshotPlainRecord(value, ["sessionToken", "workspaceId"], []);
  if (record === null) return null;
  return Object.freeze({
    sessionToken: authSessionToken(record.sessionToken) ? record.sessionToken : null,
    workspaceId: authIdentifier(record.workspaceId) ? record.workspaceId : null,
  });
}

function googleSignInRequest(value: unknown): {
  readonly workspaceId: string;
  readonly normalizedEmail: string;
} | null {
  const record = snapshotExactPlainRecord(value, ["workspaceId", "email", "emailVerified"]);
  if (record === null || !authIdentifier(record.workspaceId) || record.emailVerified !== true) {
    return null;
  }
  const normalizedEmail = normalizedAuthEmailValue(record.email);
  return normalizedEmail === null
    ? null
    : Object.freeze({ workspaceId: record.workspaceId, normalizedEmail });
}

function signInMaterialization(
  invitationStatus: "PENDING" | "ACCEPTED" | "REVOKED",
  membershipStatus: "INVITED" | "ACTIVE" | "SUSPENDED" | "ARCHIVED",
): GrantedGoogleSignInAuthorization["value"]["materialization"] | null {
  if (invitationStatus === "PENDING" && membershipStatus === "INVITED") {
    return Object.freeze({
      mode: "ACTIVATE_INVITATION",
      expectedIdentityStatus: "ACTIVE",
      expectedInvitationStatus: "PENDING",
      expectedMembershipStatus: "INVITED",
      resultingInvitationStatus: "ACCEPTED",
      resultingMembershipStatus: "ACTIVE",
      transactionRequired: true,
    });
  }
  if (invitationStatus === "ACCEPTED" && membershipStatus === "ACTIVE") {
    return Object.freeze({
      mode: "ALREADY_ACTIVE",
      expectedIdentityStatus: "ACTIVE",
      expectedInvitationStatus: "ACCEPTED",
      expectedMembershipStatus: "ACTIVE",
      resultingInvitationStatus: "ACCEPTED",
      resultingMembershipStatus: "ACTIVE",
      transactionRequired: true,
    });
  }
  return null;
}

const FORBIDDEN_REVIEWER_KEYS = new Set([
  "reviewer",
  "reviewerid",
  "revieweruserid",
  "reviewersessionid",
]);
const ARRAY_INDEX = /^(?:0|[1-9][0-9]*)$/u;
const INVALID_REVIEWER_PAYLOAD = Symbol("INVALID_REVIEWER_PAYLOAD");
const UTF8_ENCODER = new TextEncoder();

export const REVIEWER_MUTATION_PAYLOAD_LIMITS = Object.freeze({
  maximumDepth: 16,
  maximumNodes: 1_024,
  maximumProperties: 1_024,
  maximumArrayLength: 1_000,
  maximumStringCodeUnits: 64 * 1_024,
  maximumStringUtf8Bytes: 64 * 1_024,
  maximumEncodedBytes: 64 * 1_024,
});

interface ReviewerPayloadBudget {
  nodes: number;
  properties: number;
  stringUtf8Bytes: number;
}

function consumeReviewerString(value: string, budget: ReviewerPayloadBudget): boolean {
  if (value.length > REVIEWER_MUTATION_PAYLOAD_LIMITS.maximumStringCodeUnits) return false;
  budget.stringUtf8Bytes += UTF8_ENCODER.encode(value).byteLength;
  return budget.stringUtf8Bytes <= REVIEWER_MUTATION_PAYLOAD_LIMITS.maximumStringUtf8Bytes;
}

function snapshotReviewerPayloadValue(
  value: unknown,
  depth: number,
  ancestors: WeakSet<object>,
  budget: ReviewerPayloadBudget,
): ReviewerMutationPayload | typeof INVALID_REVIEWER_PAYLOAD {
  budget.nodes += 1;
  if (budget.nodes > REVIEWER_MUTATION_PAYLOAD_LIMITS.maximumNodes) {
    return INVALID_REVIEWER_PAYLOAD;
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    return consumeReviewerString(value, budget) ? value : INVALID_REVIEWER_PAYLOAD;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : INVALID_REVIEWER_PAYLOAD;
  }
  if (typeof value !== "object" || depth > REVIEWER_MUTATION_PAYLOAD_LIMITS.maximumDepth) {
    return INVALID_REVIEWER_PAYLOAD;
  }
  if (ancestors.has(value)) return INVALID_REVIEWER_PAYLOAD;
  ancestors.add(value);

  try {
    const isArray = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (
      (isArray && prototype !== Array.prototype) ||
      (!isArray && prototype !== Object.prototype && prototype !== null)
    ) {
      return INVALID_REVIEWER_PAYLOAD;
    }

    const descriptors = Object.getOwnPropertyDescriptors(value) as Record<
      PropertyKey,
      PropertyDescriptor
    >;
    const ownKeys = Reflect.ownKeys(descriptors);
    if (ownKeys.some((key) => typeof key !== "string")) return INVALID_REVIEWER_PAYLOAD;

    if (isArray) {
      const lengthDescriptor = descriptors.length;
      if (
        lengthDescriptor === undefined ||
        !("value" in lengthDescriptor) ||
        lengthDescriptor.enumerable !== false ||
        !Number.isSafeInteger(lengthDescriptor.value) ||
        (lengthDescriptor.value as number) < 0 ||
        (lengthDescriptor.value as number) > REVIEWER_MUTATION_PAYLOAD_LIMITS.maximumArrayLength
      ) {
        return INVALID_REVIEWER_PAYLOAD;
      }
      const length = lengthDescriptor.value as number;
      if (ownKeys.length !== length + 1) return INVALID_REVIEWER_PAYLOAD;
      budget.properties += length;
      if (budget.properties > REVIEWER_MUTATION_PAYLOAD_LIMITS.maximumProperties) {
        return INVALID_REVIEWER_PAYLOAD;
      }

      const snapshot: ReviewerMutationPayload[] = new Array<ReviewerMutationPayload>(length);
      for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (
          descriptor === undefined ||
          !("value" in descriptor) ||
          descriptor.enumerable !== true
        ) {
          return INVALID_REVIEWER_PAYLOAD;
        }
        const child = snapshotReviewerPayloadValue(descriptor.value, depth + 1, ancestors, budget);
        if (child === INVALID_REVIEWER_PAYLOAD) return INVALID_REVIEWER_PAYLOAD;
        snapshot[index] = child;
      }
      for (const key of ownKeys as string[]) {
        if (key !== "length" && (!ARRAY_INDEX.test(key) || Number(key) >= length)) {
          return INVALID_REVIEWER_PAYLOAD;
        }
      }
      Object.setPrototypeOf(snapshot, null);
      return Object.freeze(snapshot);
    }

    budget.properties += ownKeys.length;
    if (budget.properties > REVIEWER_MUTATION_PAYLOAD_LIMITS.maximumProperties) {
      return INVALID_REVIEWER_PAYLOAD;
    }
    const snapshot = Object.create(null) as Record<string, ReviewerMutationPayload>;
    for (const key of ownKeys as string[]) {
      const descriptor = descriptors[key];
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        descriptor.enumerable !== true ||
        !consumeReviewerString(key, budget)
      ) {
        return INVALID_REVIEWER_PAYLOAD;
      }
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/gu, "");
      if (FORBIDDEN_REVIEWER_KEYS.has(normalizedKey)) return INVALID_REVIEWER_PAYLOAD;
      const child = snapshotReviewerPayloadValue(descriptor.value, depth + 1, ancestors, budget);
      if (child === INVALID_REVIEWER_PAYLOAD) return INVALID_REVIEWER_PAYLOAD;
      Object.defineProperty(snapshot, key, {
        value: child,
        enumerable: true,
        configurable: false,
        writable: false,
      });
    }
    return Object.freeze(snapshot);
  } catch {
    return INVALID_REVIEWER_PAYLOAD;
  } finally {
    ancestors.delete(value);
  }
}

/** Returns the sole bounded payload authorized to cross the reviewer-mutation boundary. */
function snapshotReviewerMutationPayload(
  payload: unknown,
): ReviewerMutationPayload | typeof INVALID_REVIEWER_PAYLOAD {
  const budget: ReviewerPayloadBudget = { nodes: 0, properties: 0, stringUtf8Bytes: 0 };
  const snapshot = snapshotReviewerPayloadValue(payload, 0, new WeakSet<object>(), budget);
  if (snapshot === INVALID_REVIEWER_PAYLOAD) return INVALID_REVIEWER_PAYLOAD;

  try {
    const encoded = JSON.stringify(snapshot);
    if (
      encoded === undefined ||
      UTF8_ENCODER.encode(encoded).byteLength > REVIEWER_MUTATION_PAYLOAD_LIMITS.maximumEncodedBytes
    ) {
      return INVALID_REVIEWER_PAYLOAD;
    }
  } catch {
    return INVALID_REVIEWER_PAYLOAD;
  }
  return snapshot;
}

export interface AuthWorkspaceBoundaryDependencies {
  readonly sessions: SessionIdentityProvider;
  readonly directory: WorkspaceAuthorizationDirectory;
  readonly clock: AuthClock;
}

export class AuthWorkspaceBoundary {
  readonly #sessions: SessionIdentityProvider;
  readonly #directory: WorkspaceAuthorizationDirectory;
  readonly #clock: AuthClock;

  constructor(dependencies: AuthWorkspaceBoundaryDependencies) {
    this.#sessions = dependencies.sessions;
    this.#directory = dependencies.directory;
    this.#clock = dependencies.clock;
  }

  async authorizeWorkspace(
    request: WorkspaceAuthorizationRequest,
  ): Promise<WorkspaceAuthorizationResult> {
    const requested = workspaceRequest(request);
    if (requested === null || requested.sessionToken === null) return AUTHENTICATION_REQUIRED;
    if (requested.workspaceId === null) return WORKSPACE_ACCESS_REQUIRED;

    const firstSession = snapshotAuthSession(
      await this.#sessions.findSession(requested.sessionToken),
    );
    if (firstSession === null || !isCurrentSession(firstSession, currentTime(this.#clock))) {
      return AUTHENTICATION_REQUIRED;
    }

    const access = snapshotWorkspaceAccessRecord(
      await this.#directory.findWorkspaceAccess({
        workspaceId: requested.workspaceId,
        userId: firstSession.userId,
        normalizedEmail: firstSession.normalizedEmail,
      }),
    );
    if (access === null || !isExactActiveAccess(firstSession, requested.workspaceId, access)) {
      return WORKSPACE_ACCESS_REQUIRED;
    }

    const revalidatedSession = snapshotAuthSession(
      await this.#sessions.findSession(requested.sessionToken),
    );
    if (
      revalidatedSession === null ||
      !sameAuthSession(firstSession, revalidatedSession) ||
      !isCurrentSession(revalidatedSession, currentTime(this.#clock))
    ) {
      return AUTHENTICATION_REQUIRED;
    }
    return freezeAuthorization(revalidatedSession, access);
  }

  async authorizeInvitedGoogleSignIn(
    request: GoogleSignInAuthorizationRequest,
  ): Promise<GoogleSignInAuthorizationResult> {
    const requested = googleSignInRequest(request);
    if (requested === null) return WORKSPACE_ACCESS_REQUIRED;
    const invitation = snapshotSignInInvitationRecord(
      await this.#directory.findSignInInvitation({
        workspaceId: requested.workspaceId,
        normalizedEmail: requested.normalizedEmail,
      }),
    );
    const materialization =
      invitation === null
        ? null
        : signInMaterialization(invitation.invitationStatus, invitation.membershipStatus);
    if (
      invitation === null ||
      invitation.workspaceId !== requested.workspaceId ||
      invitation.workspaceStatus !== "ACTIVE" ||
      invitation.normalizedEmail !== requested.normalizedEmail ||
      invitation.identityStatus !== "ACTIVE" ||
      materialization === null
    ) {
      return WORKSPACE_ACCESS_REQUIRED;
    }
    return Object.freeze({
      ok: true,
      value: Object.freeze({
        allowed: true,
        reason: "INVITED_VERIFIED_GOOGLE_EMAIL",
        workspaceId: requested.workspaceId,
        normalizedEmail: requested.normalizedEmail,
        materialization,
      }),
    });
  }

  async authorizeReviewerMutation(
    request: WorkspaceAuthorizationRequest,
    mutationPayload: unknown,
  ): Promise<ReviewerAuthorizationResult> {
    const authorization = await this.authorizeWorkspace(request);
    if (!authorization.ok) return authorization;
    const sanitizedMutationPayload = snapshotReviewerMutationPayload(mutationPayload);
    if (sanitizedMutationPayload === INVALID_REVIEWER_PAYLOAD) {
      return CLIENT_REVIEWER_IDENTITY_FORBIDDEN;
    }
    const reviewer = Object.freeze({
      reviewerUserId: authorization.value.principal.userId,
      reviewerSessionId: authorization.value.principal.sessionId,
    });
    return Object.freeze({
      ok: true,
      value: Object.freeze({
        authorization: authorization.value,
        reviewer,
        sanitizedMutationPayload,
      }),
    } satisfies GrantedReviewerAuthorization);
  }
}

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
      expectedInvitationStatus: "ACCEPTED",
      expectedMembershipStatus: "ACTIVE",
      resultingInvitationStatus: "ACCEPTED",
      resultingMembershipStatus: "ACTIVE",
      transactionRequired: true,
    });
  }
  return null;
}

const FORBIDDEN_REVIEWER_KEYS = new Set(["reviewer", "revieweruserid", "reviewersessionid"]);
const ARRAY_INDEX = /^(?:0|[1-9][0-9]*)$/u;

/** True means the payload is unsafe or contains reviewer identity anywhere in its JSON shape. */
function clientSuppliedReviewerIdentity(payload: unknown): boolean {
  if (payload === null || payload === undefined) return false;
  if (typeof payload !== "object") return typeof payload === "function";

  const pending: unknown[] = [payload];
  const seen = new WeakSet<object>();
  let visited = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current !== "object" || current === null) continue;
    if (seen.has(current)) return true;
    seen.add(current);
    visited += 1;
    if (visited > 1_000) return true;

    try {
      const isArray = Array.isArray(current);
      const prototype = Object.getPrototypeOf(current) as unknown;
      if (
        (isArray && prototype !== Array.prototype) ||
        (!isArray && prototype !== Object.prototype && prototype !== null)
      ) {
        return true;
      }

      const descriptors = Object.getOwnPropertyDescriptors(current);
      for (const key of Reflect.ownKeys(descriptors)) {
        if (typeof key !== "string") return true;
        if (isArray && key === "length") continue;
        if (isArray && !ARRAY_INDEX.test(key)) return true;
        const descriptor = descriptors[key];
        if (
          descriptor === undefined ||
          !("value" in descriptor) ||
          descriptor.enumerable !== true
        ) {
          return true;
        }
        const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/gu, "");
        if (FORBIDDEN_REVIEWER_KEYS.has(normalizedKey)) return true;
        if (typeof descriptor.value === "object" && descriptor.value !== null) {
          pending.push(descriptor.value);
        } else if (typeof descriptor.value === "function") {
          return true;
        }
      }
    } catch {
      return true;
    }
  }
  return false;
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
    if (clientSuppliedReviewerIdentity(mutationPayload)) {
      return CLIENT_REVIEWER_IDENTITY_FORBIDDEN;
    }
    const reviewer = Object.freeze({
      reviewerUserId: authorization.value.principal.userId,
      reviewerSessionId: authorization.value.principal.sessionId,
    });
    return Object.freeze({
      ok: true,
      value: Object.freeze({ authorization: authorization.value, reviewer }),
    } satisfies GrantedReviewerAuthorization);
  }
}

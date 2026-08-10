import type {
  AuthClock,
  AuthFailure,
  AuthProblem,
  AuthSession,
  GoogleSignInAuthorizationRequest,
  GoogleSignInAuthorizationResult,
  GrantedReviewerAuthorization,
  GrantedWorkspaceAuthorization,
  ReviewerAuthorizationResult,
  SessionIdentityProvider,
  WorkspaceAccessRecord,
  WorkspaceAuthorizationDirectory,
  WorkspaceAuthorizationRequest,
  WorkspaceAuthorizationResult,
} from "./types.js";

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

function boundedIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" && value.length >= 1 && value.length <= 200 && value === value.trim()
  );
}

function boundedSessionToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 2_048 &&
    value === value.trim()
  );
}

function parseTimestamp(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : null;
}

function normalizedEmailValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length >= 3 && normalized.length <= 320 && normalized.includes("@")
    ? normalized
    : null;
}

function normalizedEmail(value: unknown): value is string {
  return typeof value === "string" && normalizedEmailValue(value) === value;
}

function isCurrentSession(session: AuthSession, nowEpochMs: number): boolean {
  if (
    !boundedIdentifier(session.sessionId) ||
    !boundedIdentifier(session.userId) ||
    !normalizedEmail(session.normalizedEmail) ||
    (session.provider !== "GOOGLE" && session.provider !== "LOCAL") ||
    session.status !== "ACTIVE"
  ) {
    return false;
  }
  const issuedAt = parseTimestamp(session.issuedAt);
  const expiresAt = parseTimestamp(session.expiresAt);
  return (
    issuedAt !== null &&
    expiresAt !== null &&
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
    access.membership.status === "ACTIVE"
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

function clientSuppliedReviewerIdentity(payload: unknown): boolean {
  if (payload === null || typeof payload !== "object") return false;
  return (
    Object.prototype.hasOwnProperty.call(payload, "reviewer_user_id") ||
    Object.prototype.hasOwnProperty.call(payload, "reviewerUserId")
  );
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
    if (!boundedSessionToken(request.sessionToken)) return AUTHENTICATION_REQUIRED;
    if (!boundedIdentifier(request.workspaceId)) return WORKSPACE_ACCESS_REQUIRED;

    const session = await this.#sessions.findSession(request.sessionToken);
    const nowEpochMs = this.#clock.nowEpochMs();
    if (!Number.isFinite(nowEpochMs)) {
      throw new RangeError("auth clock must return a finite epoch-millisecond value");
    }
    if (!session || !isCurrentSession(session, nowEpochMs)) return AUTHENTICATION_REQUIRED;

    const access = await this.#directory.findWorkspaceAccess({
      workspaceId: request.workspaceId,
      userId: session.userId,
      normalizedEmail: session.normalizedEmail,
    });
    if (!access || !isExactActiveAccess(session, request.workspaceId, access)) {
      return WORKSPACE_ACCESS_REQUIRED;
    }

    return freezeAuthorization(session, access);
  }

  async authorizeInvitedGoogleSignIn(
    request: GoogleSignInAuthorizationRequest,
  ): Promise<GoogleSignInAuthorizationResult> {
    if (!boundedIdentifier(request.workspaceId) || request.emailVerified !== true) {
      return WORKSPACE_ACCESS_REQUIRED;
    }
    const normalizedEmail = normalizedEmailValue(request.email);
    if (!normalizedEmail) return WORKSPACE_ACCESS_REQUIRED;
    const invitation = await this.#directory.findSignInInvitation({
      workspaceId: request.workspaceId,
      normalizedEmail,
    });
    if (
      !invitation ||
      invitation.workspaceId !== request.workspaceId ||
      invitation.workspaceStatus !== "ACTIVE" ||
      invitation.normalizedEmail !== normalizedEmail ||
      (invitation.invitationStatus !== "PENDING" && invitation.invitationStatus !== "ACCEPTED")
    ) {
      return WORKSPACE_ACCESS_REQUIRED;
    }
    return Object.freeze({
      ok: true,
      value: Object.freeze({
        allowed: true,
        reason: "INVITED_VERIFIED_GOOGLE_EMAIL",
        workspaceId: request.workspaceId,
        normalizedEmail,
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

export type AuthProvider = "GOOGLE" | "LOCAL";
export type AuthSessionStatus = "ACTIVE" | "REVOKED";
export type AuthUserStatus = "ACTIVE" | "DISABLED";
export type AuthWorkspaceStatus = "ACTIVE" | "ARCHIVED";
export type AuthInvitationStatus = "PENDING" | "ACCEPTED" | "REVOKED";
export type AuthMembershipStatus = "INVITED" | "ACTIVE" | "SUSPENDED" | "ARCHIVED";
export type AuthMembershipRole = "ADMIN" | "MEMBER";

export interface AuthSession {
  readonly sessionId: string;
  readonly userId: string;
  readonly normalizedEmail: string;
  readonly provider: AuthProvider;
  readonly status: AuthSessionStatus;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export interface SessionIdentityProvider {
  findSession(sessionToken: string): Promise<AuthSession | null>;
}

export interface WorkspaceAccessLookup {
  readonly workspaceId: string;
  readonly userId: string;
  readonly normalizedEmail: string;
}

export interface SignInInvitationLookup {
  readonly workspaceId: string;
  readonly normalizedEmail: string;
}

export interface SignInInvitationRecord {
  readonly workspaceId: string;
  readonly workspaceStatus: AuthWorkspaceStatus;
  readonly normalizedEmail: string;
  readonly invitationStatus: AuthInvitationStatus;
}

export interface WorkspaceAccessRecord {
  readonly workspace: {
    readonly workspaceId: string;
    readonly status: AuthWorkspaceStatus;
  };
  readonly identity: {
    readonly userId: string;
    readonly normalizedEmail: string;
    readonly status: AuthUserStatus;
  };
  readonly invitation: {
    readonly workspaceId: string;
    readonly normalizedEmail: string;
    readonly status: AuthInvitationStatus;
  };
  readonly membership: {
    readonly membershipId: string;
    readonly workspaceId: string;
    readonly userId: string;
    readonly role: AuthMembershipRole;
    readonly status: AuthMembershipStatus;
  };
}

/**
 * Implementations must scope the lookup by all three fields. A missing or mismatched row is null;
 * callers deliberately expose the same public denial for every null/inactive outcome.
 */
export interface WorkspaceAuthorizationDirectory {
  findWorkspaceAccess(lookup: WorkspaceAccessLookup): Promise<WorkspaceAccessRecord | null>;
  findSignInInvitation(lookup: SignInInvitationLookup): Promise<SignInInvitationRecord | null>;
}

export interface AuthClock {
  nowEpochMs(): number;
}

export interface WorkspaceAuthorizationRequest {
  readonly sessionToken: string;
  readonly workspaceId: string;
}

export interface GoogleSignInAuthorizationRequest {
  readonly workspaceId: string;
  readonly email: string;
  readonly emailVerified: boolean;
}

export type AuthProblemCode =
  | "AUTHENTICATION_REQUIRED"
  | "WORKSPACE_ACCESS_REQUIRED"
  | "CLIENT_REVIEWER_IDENTITY_FORBIDDEN";

export interface AuthProblem {
  readonly code: AuthProblemCode;
  readonly status: 401 | 403 | 422;
  readonly title: string;
  readonly detail: string;
  readonly retryable: false;
}

export interface AuthFailure {
  readonly ok: false;
  readonly problem: AuthProblem;
}

export interface GrantedWorkspaceAuthorization {
  readonly ok: true;
  readonly value: {
    readonly authorized: true;
    readonly reason: "ACTIVE_MEMBER";
    readonly principal: {
      readonly sessionId: string;
      readonly userId: string;
      readonly normalizedEmail: string;
      readonly provider: AuthProvider;
    };
    readonly workspace: {
      readonly workspaceId: string;
      readonly membershipId: string;
      readonly role: AuthMembershipRole;
    };
  };
}

export type WorkspaceAuthorizationResult = AuthFailure | GrantedWorkspaceAuthorization;

export interface GrantedGoogleSignInAuthorization {
  readonly ok: true;
  readonly value: {
    readonly allowed: true;
    readonly reason: "INVITED_VERIFIED_GOOGLE_EMAIL";
    readonly workspaceId: string;
    readonly normalizedEmail: string;
  };
}

export type GoogleSignInAuthorizationResult = AuthFailure | GrantedGoogleSignInAuthorization;

export interface GrantedReviewerAuthorization {
  readonly ok: true;
  readonly value: {
    readonly authorization: GrantedWorkspaceAuthorization["value"];
    readonly reviewer: {
      readonly reviewerUserId: string;
      readonly reviewerSessionId: string;
    };
  };
}

export type ReviewerAuthorizationResult = AuthFailure | GrantedReviewerAuthorization;

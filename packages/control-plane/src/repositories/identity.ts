import type {
  CommonInvariantCode,
  EntityId,
  RepositoryResult,
  UtcTimestamp,
  WorkspaceScope,
} from "./types.js";

export type UserStatus = "ACTIVE" | "DISABLED";
export type MembershipRole = "ADMIN" | "MEMBER";
export type MembershipStatus = "INVITED" | "ACTIVE" | "SUSPENDED" | "ARCHIVED";

export interface UserIdentity {
  readonly userId: EntityId;
  readonly normalizedEmail: string;
  readonly displayName: string;
  readonly status: UserStatus;
}

export interface WorkspaceMembership {
  readonly membershipId: EntityId;
  readonly workspaceId: EntityId;
  readonly userId: EntityId;
  readonly normalizedName: string;
  readonly role: MembershipRole;
  readonly status: MembershipStatus;
  readonly version: number;
  readonly createdAt: UtcTimestamp;
  readonly updatedAt: UtcTimestamp;
}

export interface GrantedWorkspaceAuthorization {
  readonly identity: UserIdentity & { readonly status: "ACTIVE" };
  readonly membership: WorkspaceMembership & { readonly status: "ACTIVE" };
  readonly authorized: true;
  readonly reason: "ACTIVE_MEMBER";
}

interface DeniedWorkspaceAuthorizationBase {
  readonly authorized: false;
}

export interface InvitedWorkspaceAuthorization extends DeniedWorkspaceAuthorizationBase {
  readonly identity: UserIdentity & { readonly status: "ACTIVE" };
  readonly membership: WorkspaceMembership & { readonly status: "INVITED" };
  readonly reason: "INVITED";
}

export interface SuspendedWorkspaceAuthorization extends DeniedWorkspaceAuthorizationBase {
  readonly identity: UserIdentity & { readonly status: "ACTIVE" };
  readonly membership: WorkspaceMembership & { readonly status: "SUSPENDED" };
  readonly reason: "MEMBERSHIP_SUSPENDED";
}

export interface ArchivedWorkspaceAuthorization extends DeniedWorkspaceAuthorizationBase {
  readonly identity: UserIdentity & { readonly status: "ACTIVE" };
  readonly membership: WorkspaceMembership & { readonly status: "ARCHIVED" };
  readonly reason: "MEMBERSHIP_ARCHIVED";
}

export interface DisabledUserWorkspaceAuthorization extends DeniedWorkspaceAuthorizationBase {
  readonly identity: UserIdentity & { readonly status: "DISABLED" };
  readonly membership: WorkspaceMembership;
  readonly reason: "USER_DISABLED";
}

export type DeniedWorkspaceAuthorization =
  | InvitedWorkspaceAuthorization
  | SuspendedWorkspaceAuthorization
  | ArchivedWorkspaceAuthorization
  | DisabledUserWorkspaceAuthorization;

/** Authorization status is discriminated so a denial cannot carry an active-member reason. */
export type WorkspaceAuthorization =
  | GrantedWorkspaceAuthorization
  | DeniedWorkspaceAuthorization;

export interface MembershipLookup {
  readonly userId: EntityId;
}

export interface AuthenticationLookup {
  readonly normalizedEmail: string;
}

export type IdentityNotFound = "MEMBERSHIP" | "USER";
export type IdentityInvariant = CommonInvariantCode | "IDENTITY_MEMBERSHIP_MISMATCH";

/** Read-only identity boundary; identity creation belongs to the later auth adapter task. */
export interface IdentityRepository {
  findMembership(
    scope: WorkspaceScope,
    lookup: MembershipLookup,
  ): Promise<RepositoryResult<WorkspaceMembership, never, IdentityNotFound, IdentityInvariant>>;

  /** Looks up an auth identity only when it is joined to the explicitly scoped workspace. */
  findAuthentication(
    scope: WorkspaceScope,
    lookup: AuthenticationLookup,
  ): Promise<RepositoryResult<WorkspaceAuthorization, never, IdentityNotFound, IdentityInvariant>>;

  authorizeMembership(
    scope: WorkspaceScope,
    lookup: MembershipLookup,
  ): Promise<RepositoryResult<WorkspaceAuthorization, never, IdentityNotFound, IdentityInvariant>>;
}

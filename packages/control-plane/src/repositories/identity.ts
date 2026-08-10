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

export interface WorkspaceAuthorization {
  readonly identity: UserIdentity;
  readonly membership: WorkspaceMembership;
  readonly authorized: boolean;
  readonly reason:
    | "ACTIVE_MEMBER"
    | "INVITED"
    | "MEMBERSHIP_SUSPENDED"
    | "MEMBERSHIP_ARCHIVED"
    | "USER_DISABLED";
}

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

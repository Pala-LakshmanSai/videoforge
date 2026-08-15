import type {
  AuthMembershipRole,
  AuthMembershipStatus,
  AuthProvider,
  AuthSession,
  AuthSessionStatus,
  AuthUserStatus,
  AuthWorkspaceStatus,
  SignInInvitationLookup,
  SignInInvitationRecord,
  WorkspaceAccessLookup,
  WorkspaceAccessRecord,
} from "./types.js";
import { snapshotExactPlainRecord } from "./plain-data.js";

const AUTH_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
const AUTH_PROVIDERS = new Set<AuthProvider>(["GOOGLE", "LOCAL"]);
const SESSION_STATUSES = new Set<AuthSessionStatus>(["ACTIVE", "REVOKED"]);
const USER_STATUSES = new Set<AuthUserStatus>(["ACTIVE", "DISABLED"]);
const WORKSPACE_STATUSES = new Set<AuthWorkspaceStatus>(["ACTIVE", "ARCHIVED"]);
const INVITATION_STATUSES = new Set(["PENDING", "ACCEPTED", "REVOKED"] as const);
const MEMBERSHIP_STATUSES = new Set<AuthMembershipStatus>([
  "INVITED",
  "ACTIVE",
  "SUSPENDED",
  "ARCHIVED",
]);
const MEMBERSHIP_ROLES = new Set<AuthMembershipRole>(["ADMIN", "MEMBER"]);

export function authIdentifier(value: unknown): value is string {
  return typeof value === "string" && AUTH_IDENTIFIER.test(value);
}

export function authSessionToken(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 2_048 ||
    value !== value.trim()
  ) {
    return false;
  }
  return ![...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

export function normalizedAuthEmailValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (
    normalized.length < 3 ||
    normalized.length > 320 ||
    normalized !== value.trim().toLowerCase() ||
    !/^[^\s@]+@[^\s@]+$/u.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

export function isNormalizedAuthEmail(value: unknown): value is string {
  return typeof value === "string" && normalizedAuthEmailValue(value) === value;
}

export function canonicalAuthTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? value : null;
}

function enumValue<T extends string>(value: unknown, allowed: ReadonlySet<T>): T | null {
  return typeof value === "string" && allowed.has(value as T) ? (value as T) : null;
}

export function snapshotAuthSession(value: unknown): AuthSession | null {
  const record = snapshotExactPlainRecord(value, [
    "sessionId",
    "userId",
    "normalizedEmail",
    "provider",
    "status",
    "issuedAt",
    "expiresAt",
  ]);
  if (record === null) return null;
  const provider = enumValue(record.provider, AUTH_PROVIDERS);
  const status = enumValue(record.status, SESSION_STATUSES);
  const issuedAt = canonicalAuthTimestamp(record.issuedAt);
  const expiresAt = canonicalAuthTimestamp(record.expiresAt);
  if (
    !authIdentifier(record.sessionId) ||
    !authIdentifier(record.userId) ||
    !isNormalizedAuthEmail(record.normalizedEmail) ||
    provider === null ||
    status === null ||
    issuedAt === null ||
    expiresAt === null ||
    Date.parse(issuedAt) >= Date.parse(expiresAt)
  ) {
    return null;
  }
  return Object.freeze({
    sessionId: record.sessionId,
    userId: record.userId,
    normalizedEmail: record.normalizedEmail,
    provider,
    status,
    issuedAt,
    expiresAt,
  });
}

export function sameAuthSession(left: AuthSession, right: AuthSession): boolean {
  return (
    left.sessionId === right.sessionId &&
    left.userId === right.userId &&
    left.normalizedEmail === right.normalizedEmail &&
    left.provider === right.provider &&
    left.status === right.status &&
    left.issuedAt === right.issuedAt &&
    left.expiresAt === right.expiresAt
  );
}

export function snapshotWorkspaceAccessRecord(value: unknown): WorkspaceAccessRecord | null {
  const record = snapshotExactPlainRecord(value, [
    "workspace",
    "identity",
    "invitation",
    "membership",
  ]);
  if (record === null) return null;
  const workspace = snapshotExactPlainRecord(record.workspace, [
    "accountId",
    "workspaceId",
    "status",
  ]);
  const identity = snapshotExactPlainRecord(record.identity, [
    "userId",
    "normalizedEmail",
    "status",
  ]);
  const invitation = snapshotExactPlainRecord(record.invitation, [
    "workspaceId",
    "normalizedEmail",
    "status",
  ]);
  const membership = snapshotExactPlainRecord(record.membership, [
    "membershipId",
    "workspaceId",
    "userId",
    "role",
    "status",
  ]);
  if (workspace === null || identity === null || invitation === null || membership === null) {
    return null;
  }

  const workspaceStatus = enumValue(workspace.status, WORKSPACE_STATUSES);
  const identityStatus = enumValue(identity.status, USER_STATUSES);
  const invitationStatus = enumValue(invitation.status, INVITATION_STATUSES);
  const membershipRole = enumValue(membership.role, MEMBERSHIP_ROLES);
  const membershipStatus = enumValue(membership.status, MEMBERSHIP_STATUSES);
  if (
    !authIdentifier(workspace.workspaceId) ||
    !authIdentifier(workspace.accountId) ||
    workspaceStatus === null ||
    !authIdentifier(identity.userId) ||
    !isNormalizedAuthEmail(identity.normalizedEmail) ||
    identityStatus === null ||
    !authIdentifier(invitation.workspaceId) ||
    !isNormalizedAuthEmail(invitation.normalizedEmail) ||
    invitationStatus === null ||
    !authIdentifier(membership.membershipId) ||
    !authIdentifier(membership.workspaceId) ||
    !authIdentifier(membership.userId) ||
    membershipRole === null ||
    membershipStatus === null ||
    invitation.workspaceId !== workspace.workspaceId ||
    membership.workspaceId !== workspace.workspaceId ||
    membership.userId !== identity.userId ||
    invitation.normalizedEmail !== identity.normalizedEmail
  ) {
    return null;
  }

  return Object.freeze({
    workspace: Object.freeze({
      workspaceId: workspace.workspaceId,
      accountId: workspace.accountId,
      status: workspaceStatus,
    }),
    identity: Object.freeze({
      userId: identity.userId,
      normalizedEmail: identity.normalizedEmail,
      status: identityStatus,
    }),
    invitation: Object.freeze({
      workspaceId: invitation.workspaceId,
      normalizedEmail: invitation.normalizedEmail,
      status: invitationStatus,
    }),
    membership: Object.freeze({
      membershipId: membership.membershipId,
      workspaceId: membership.workspaceId,
      userId: membership.userId,
      role: membershipRole,
      status: membershipStatus,
    }),
  });
}

export function snapshotSignInInvitationRecord(value: unknown): SignInInvitationRecord | null {
  const record = snapshotExactPlainRecord(value, [
    "workspaceId",
    "workspaceStatus",
    "normalizedEmail",
    "identityStatus",
    "invitationStatus",
    "membershipStatus",
  ]);
  if (record === null) return null;
  const workspaceStatus = enumValue(record.workspaceStatus, WORKSPACE_STATUSES);
  const identityStatus = enumValue(record.identityStatus, USER_STATUSES);
  const invitationStatus = enumValue(record.invitationStatus, INVITATION_STATUSES);
  const membershipStatus = enumValue(record.membershipStatus, MEMBERSHIP_STATUSES);
  if (
    !authIdentifier(record.workspaceId) ||
    workspaceStatus === null ||
    !isNormalizedAuthEmail(record.normalizedEmail) ||
    identityStatus === null ||
    invitationStatus === null ||
    membershipStatus === null
  ) {
    return null;
  }
  return Object.freeze({
    workspaceId: record.workspaceId,
    workspaceStatus,
    normalizedEmail: record.normalizedEmail,
    identityStatus,
    invitationStatus,
    membershipStatus,
  });
}

export function snapshotWorkspaceAccessLookup(value: unknown): WorkspaceAccessLookup | null {
  const record = snapshotExactPlainRecord(value, ["workspaceId", "userId", "normalizedEmail"]);
  if (
    record === null ||
    !authIdentifier(record.workspaceId) ||
    !authIdentifier(record.userId) ||
    !isNormalizedAuthEmail(record.normalizedEmail)
  ) {
    return null;
  }
  return Object.freeze({
    workspaceId: record.workspaceId,
    userId: record.userId,
    normalizedEmail: record.normalizedEmail,
  });
}

export function snapshotSignInInvitationLookup(value: unknown): SignInInvitationLookup | null {
  const record = snapshotExactPlainRecord(value, ["workspaceId", "normalizedEmail"]);
  if (
    record === null ||
    !authIdentifier(record.workspaceId) ||
    !isNormalizedAuthEmail(record.normalizedEmail)
  ) {
    return null;
  }
  return Object.freeze({
    workspaceId: record.workspaceId,
    normalizedEmail: record.normalizedEmail,
  });
}

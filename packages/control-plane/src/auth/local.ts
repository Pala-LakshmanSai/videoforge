import type {
  AuthSession,
  AuthWorkspaceStatus,
  SessionIdentityProvider,
  SignInInvitationLookup,
  SignInInvitationRecord,
  WorkspaceAccessLookup,
  WorkspaceAccessRecord,
  WorkspaceAuthorizationDirectory,
} from "./types.js";

const WORKSPACE_STATUSES = new Set<AuthWorkspaceStatus>(["ACTIVE", "ARCHIVED"]);
const USER_STATUSES = new Set(["ACTIVE", "DISABLED"]);
const INVITATION_STATUSES = new Set(["PENDING", "ACCEPTED", "REVOKED"]);
const MEMBERSHIP_STATUSES = new Set(["INVITED", "ACTIVE", "SUSPENDED", "ARCHIVED"]);
const MEMBERSHIP_ROLES = new Set(["ADMIN", "MEMBER"]);
const SESSION_STATUSES = new Set(["ACTIVE", "REVOKED"]);
const AUTH_PROVIDERS = new Set(["GOOGLE", "LOCAL"]);

export interface DeterministicLocalSessionFixture {
  readonly sessionToken: string;
  readonly session: AuthSession;
}

function assertBounded(value: string, label: string, maximum = 200): void {
  if (value.length < 1 || value.length > maximum || value !== value.trim()) {
    throw new RangeError(`${label} must be trimmed and contain 1 to ${maximum} characters`);
  }
}

export function normalizeAuthEmail(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized.length < 3 || normalized.length > 320 || !normalized.includes("@")) {
    throw new RangeError("auth email must contain a bounded email-shaped value");
  }
  return normalized;
}

function assertNormalizedEmail(value: string, label: string): void {
  if (normalizeAuthEmail(value) !== value) {
    throw new RangeError(`${label} must already be normalized`);
  }
}

function timestamp(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new RangeError(`${label} must be a canonical UTC timestamp`);
  }
  return parsed;
}

function freezeSession(session: AuthSession): AuthSession {
  assertBounded(session.sessionId, "session ID");
  assertBounded(session.userId, "session user ID");
  assertNormalizedEmail(session.normalizedEmail, "session email");
  if (!AUTH_PROVIDERS.has(session.provider)) throw new RangeError("unsupported auth provider");
  if (!SESSION_STATUSES.has(session.status)) throw new RangeError("unsupported session status");
  const issuedAt = timestamp(session.issuedAt, "session issuedAt");
  const expiresAt = timestamp(session.expiresAt, "session expiresAt");
  if (issuedAt >= expiresAt) throw new RangeError("session expiresAt must follow issuedAt");
  return Object.freeze({ ...session });
}

export class DeterministicLocalIdentityProvider implements SessionIdentityProvider {
  readonly #sessionsByToken = new Map<string, AuthSession>();

  constructor(fixtures: readonly DeterministicLocalSessionFixture[]) {
    const sessionIds = new Set<string>();
    for (const fixture of fixtures) {
      assertBounded(fixture.sessionToken, "session token", 2_048);
      if (this.#sessionsByToken.has(fixture.sessionToken)) {
        throw new RangeError("deterministic local session tokens must be unique");
      }
      if (sessionIds.has(fixture.session.sessionId)) {
        throw new RangeError("deterministic local session IDs must be unique");
      }
      const session = freezeSession(fixture.session);
      this.#sessionsByToken.set(fixture.sessionToken, session);
      sessionIds.add(session.sessionId);
    }
  }

  async findSession(sessionToken: string): Promise<AuthSession | null> {
    return this.#sessionsByToken.get(sessionToken) ?? null;
  }
}

function freezeAccessRecord(record: WorkspaceAccessRecord): WorkspaceAccessRecord {
  assertBounded(record.workspace.workspaceId, "workspace ID");
  assertBounded(record.identity.userId, "identity user ID");
  assertBounded(record.membership.membershipId, "membership ID");
  assertNormalizedEmail(record.identity.normalizedEmail, "identity email");
  assertNormalizedEmail(record.invitation.normalizedEmail, "invitation email");
  if (!WORKSPACE_STATUSES.has(record.workspace.status)) {
    throw new RangeError("unsupported workspace status");
  }
  if (!USER_STATUSES.has(record.identity.status)) throw new RangeError("unsupported user status");
  if (!INVITATION_STATUSES.has(record.invitation.status)) {
    throw new RangeError("unsupported invitation status");
  }
  if (!MEMBERSHIP_STATUSES.has(record.membership.status)) {
    throw new RangeError("unsupported membership status");
  }
  if (!MEMBERSHIP_ROLES.has(record.membership.role)) {
    throw new RangeError("unsupported membership role");
  }
  if (
    record.invitation.workspaceId !== record.workspace.workspaceId ||
    record.membership.workspaceId !== record.workspace.workspaceId ||
    record.membership.userId !== record.identity.userId ||
    record.invitation.normalizedEmail !== record.identity.normalizedEmail
  ) {
    throw new RangeError("local access record relationships must be exact");
  }

  return Object.freeze({
    workspace: Object.freeze({ ...record.workspace }),
    identity: Object.freeze({ ...record.identity }),
    invitation: Object.freeze({ ...record.invitation }),
    membership: Object.freeze({ ...record.membership }),
  });
}

export class DeterministicLocalAuthorizationDirectory implements WorkspaceAuthorizationDirectory {
  readonly #records = new Map<string, Map<string, Map<string, WorkspaceAccessRecord>>>();
  readonly #invitations = new Map<string, Map<string, SignInInvitationRecord>>();

  constructor(records: readonly WorkspaceAccessRecord[]) {
    for (const candidate of records) {
      const record = freezeAccessRecord(candidate);
      let workspace = this.#records.get(record.workspace.workspaceId);
      if (!workspace) {
        workspace = new Map();
        this.#records.set(record.workspace.workspaceId, workspace);
      }
      let user = workspace.get(record.identity.userId);
      if (!user) {
        user = new Map();
        workspace.set(record.identity.userId, user);
      }
      if (user.has(record.identity.normalizedEmail)) {
        throw new RangeError("deterministic local access records must be unique");
      }
      user.set(record.identity.normalizedEmail, record);

      let invitations = this.#invitations.get(record.workspace.workspaceId);
      if (!invitations) {
        invitations = new Map();
        this.#invitations.set(record.workspace.workspaceId, invitations);
      }
      if (invitations.has(record.invitation.normalizedEmail)) {
        throw new RangeError("deterministic local invitation emails must be workspace-unique");
      }
      invitations.set(
        record.invitation.normalizedEmail,
        Object.freeze({
          workspaceId: record.workspace.workspaceId,
          workspaceStatus: record.workspace.status,
          normalizedEmail: record.invitation.normalizedEmail,
          invitationStatus: record.invitation.status,
        }),
      );
    }
  }

  async findWorkspaceAccess(lookup: WorkspaceAccessLookup): Promise<WorkspaceAccessRecord | null> {
    return (
      this.#records.get(lookup.workspaceId)?.get(lookup.userId)?.get(lookup.normalizedEmail) ?? null
    );
  }

  async findSignInInvitation(
    lookup: SignInInvitationLookup,
  ): Promise<SignInInvitationRecord | null> {
    return this.#invitations.get(lookup.workspaceId)?.get(lookup.normalizedEmail) ?? null;
  }
}

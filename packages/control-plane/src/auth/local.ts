import { snapshotExactPlainRecord } from "./plain-data.js";
import type {
  AuthSession,
  SessionIdentityProvider,
  SignInInvitationLookup,
  SignInInvitationRecord,
  WorkspaceAccessLookup,
  WorkspaceAccessRecord,
  WorkspaceAuthorizationDirectory,
} from "./types.js";
import {
  authSessionToken,
  normalizedAuthEmailValue,
  snapshotAuthSession,
  snapshotSignInInvitationLookup,
  snapshotWorkspaceAccessLookup,
  snapshotWorkspaceAccessRecord,
} from "./validation.js";

export interface DeterministicLocalSessionFixture {
  readonly sessionToken: string;
  readonly session: AuthSession;
}

export function normalizeAuthEmail(value: string): string {
  const normalized = normalizedAuthEmailValue(value);
  if (normalized === null) {
    throw new RangeError("auth email must contain a bounded email-shaped value");
  }
  return normalized;
}

function fixtureSession(value: unknown): DeterministicLocalSessionFixture {
  const fixture = snapshotExactPlainRecord(value, ["sessionToken", "session"]);
  if (fixture === null || !authSessionToken(fixture.sessionToken)) {
    throw new RangeError("deterministic local session fixture must be exact plain data");
  }
  const session = snapshotAuthSession(fixture.session);
  if (session === null) {
    throw new RangeError("deterministic local session must contain valid canonical fields");
  }
  return Object.freeze({ sessionToken: fixture.sessionToken, session });
}

export class DeterministicLocalIdentityProvider implements SessionIdentityProvider {
  readonly #sessionsByToken = new Map<string, AuthSession>();

  constructor(fixtures: readonly DeterministicLocalSessionFixture[]) {
    const sessionIds = new Set<string>();
    for (const candidate of fixtures) {
      const fixture = fixtureSession(candidate);
      if (this.#sessionsByToken.has(fixture.sessionToken)) {
        throw new RangeError("deterministic local session tokens must be unique");
      }
      if (sessionIds.has(fixture.session.sessionId)) {
        throw new RangeError("deterministic local session IDs must be unique");
      }
      this.#sessionsByToken.set(fixture.sessionToken, fixture.session);
      sessionIds.add(fixture.session.sessionId);
    }
  }

  async findSession(sessionToken: string): Promise<AuthSession | null> {
    if (!authSessionToken(sessionToken)) return null;
    return this.#sessionsByToken.get(sessionToken) ?? null;
  }
}

function fixtureAccessRecord(value: unknown): WorkspaceAccessRecord {
  const record = snapshotWorkspaceAccessRecord(value);
  if (record === null) {
    throw new RangeError(
      "deterministic local access record must contain exact valid fields and relationships",
    );
  }
  return record;
}

export class DeterministicLocalAuthorizationDirectory implements WorkspaceAuthorizationDirectory {
  readonly #records = new Map<string, Map<string, Map<string, WorkspaceAccessRecord>>>();
  readonly #invitations = new Map<string, Map<string, SignInInvitationRecord>>();

  constructor(records: readonly WorkspaceAccessRecord[]) {
    for (const candidate of records) {
      const record = fixtureAccessRecord(candidate);
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
          identityStatus: record.identity.status,
          invitationStatus: record.invitation.status,
          membershipStatus: record.membership.status,
        }),
      );
    }
  }

  async findWorkspaceAccess(lookup: WorkspaceAccessLookup): Promise<WorkspaceAccessRecord | null> {
    const snapshot = snapshotWorkspaceAccessLookup(lookup);
    if (snapshot === null) return null;
    return (
      this.#records
        .get(snapshot.workspaceId)
        ?.get(snapshot.userId)
        ?.get(snapshot.normalizedEmail) ?? null
    );
  }

  async findSignInInvitation(
    lookup: SignInInvitationLookup,
  ): Promise<SignInInvitationRecord | null> {
    const snapshot = snapshotSignInInvitationLookup(lookup);
    if (snapshot === null) return null;
    return this.#invitations.get(snapshot.workspaceId)?.get(snapshot.normalizedEmail) ?? null;
  }
}

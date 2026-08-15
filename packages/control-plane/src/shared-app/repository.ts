import { normalizedAuthEmailValue } from "../auth/validation.js";
import type { SqlExecutor, TransactionalSqlExecutor } from "../database/ports.js";

export type SharedAdmissionProblemCode =
  | "AUTH_IDENTITY_CONFLICT"
  | "EMAIL_VERIFICATION_REQUIRED"
  | "INVITE_ALREADY_USED"
  | "INVITE_EMAIL_MISMATCH"
  | "INVITE_EXPIRED"
  | "INVITE_INVALID"
  | "INVITE_REVOKED";

export class SharedAdmissionError extends Error {
  constructor(
    readonly code: SharedAdmissionProblemCode,
    message: string,
  ) {
    super(message);
    this.name = "SharedAdmissionError";
  }
}

export type SharedAuthMethod = "EMAIL_PASSWORD" | "GOOGLE";

export interface IssueInviteCommand {
  readonly inviteId: string;
  readonly intendedEmail: string;
  readonly verifierSha256: `sha256:${string}`;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface RedeemInviteCommand {
  readonly admissionId: string;
  readonly redemptionId: string;
  readonly identityBindingId: string;
  /** The one private tenant this admission owns. DEC_TENANCY_002 allows exactly one. */
  readonly accountId: string;
  /** The single default workspace created with that account. */
  readonly workspaceId: string;
  readonly membershipId: string;
  readonly userId: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly emailVerifiedAt: string;
  readonly authMethod: SharedAuthMethod;
  readonly providerSubjectSha256: `sha256:${string}`;
  readonly verifierSha256: `sha256:${string}`;
  readonly now: string;
}

export interface SharedAdmissionResult {
  readonly outcome: "ADMITTED" | "RETURNING";
  readonly admissionId: string;
  readonly normalizedEmail: string;
  readonly authMethod: SharedAuthMethod;
  /** The trusted tenant scope this session may act in. Never taken from a client field. */
  readonly accountId: string;
  readonly workspaceId: string;
}

interface AdmissionRow extends Record<string, unknown> {
  readonly id: string;
  readonly normalized_email: string;
  readonly auth_methods: string[];
  readonly account_id: string;
}

interface InviteRow extends Record<string, unknown> {
  readonly id: string;
  readonly intended_normalized_email: string;
  readonly state: "ACTIVE" | "CONSUMED" | "REVOKED";
  readonly expires_at: string;
}

interface AccountRow extends Record<string, unknown> {
  readonly id: string;
}

interface DefaultWorkspaceRow extends Record<string, unknown> {
  readonly id: string;
}

/**
 * Resolves the one default workspace an account owns. A returning login never carries its own
 * workspace, so the server derives it from the admitted account instead of trusting the request.
 */
async function resolveDefaultWorkspaceId(
  executor: SqlExecutor,
  accountId: string,
): Promise<string> {
  const result = await executor.query<DefaultWorkspaceRow>(
    `SELECT id FROM workspaces
      WHERE account_id = $1 AND is_default AND status = 'ACTIVE'`,
    [accountId],
  );
  const workspaceId = result.rows[0]?.id;
  if (workspaceId === undefined) {
    throw new SharedAdmissionError(
      "AUTH_IDENTITY_CONFLICT",
      "Admitted account has no active default workspace.",
    );
  }
  return workspaceId;
}

function normalizedEmail(value: string): string {
  const normalized = normalizedAuthEmailValue(value);
  if (normalized === null) {
    throw new SharedAdmissionError("INVITE_EMAIL_MISMATCH", "Identity email is invalid.");
  }
  return normalized;
}

export class SharedAdmissionRepository {
  constructor(private readonly database: TransactionalSqlExecutor) {}

  async issueInvite(command: IssueInviteCommand): Promise<void> {
    const intended = normalizedEmail(command.intendedEmail);
    await this.database.query(
      `INSERT INTO invite_codes (
         id, verifier_sha256, intended_normalized_email, state, expires_at,
         consumed_at, revoked_at, version, created_at
       ) VALUES ($1, $2, $3, 'ACTIVE', $4, NULL, NULL, 1, $5)`,
      [command.inviteId, command.verifierSha256, intended, command.expiresAt, command.createdAt],
    );
  }

  async redeemInvite(command: RedeemInviteCommand): Promise<SharedAdmissionResult> {
    if (!command.emailVerified) {
      throw new SharedAdmissionError(
        "EMAIL_VERIFICATION_REQUIRED",
        "Verified email is required before VideoForge admission.",
      );
    }
    const email = normalizedEmail(command.email);
    return this.database.transaction(async (transaction) => {
      const returning = await transaction.query<AdmissionRow>(
        `SELECT id, normalized_email, auth_methods, account_id
           FROM app_admissions
          WHERE user_id = $1 AND status = 'ADMITTED'`,
        [command.userId],
      );
      const existing = returning.rows[0];
      if (existing !== undefined) {
        if (
          existing.normalized_email !== email ||
          !existing.auth_methods.includes(command.authMethod)
        ) {
          throw new SharedAdmissionError(
            "AUTH_IDENTITY_CONFLICT",
            "Use the login method already bound to this admitted identity.",
          );
        }
        return Object.freeze({
          outcome: "RETURNING" as const,
          admissionId: existing.id,
          normalizedEmail: existing.normalized_email,
          authMethod: command.authMethod,
          accountId: existing.account_id,
          workspaceId: await resolveDefaultWorkspaceId(transaction, existing.account_id),
        });
      }

      const user = await transaction.query<Record<string, unknown> & { normalized_email: string }>(
        `SELECT normalized_email FROM users
          WHERE id = $1 AND status = 'ACTIVE' AND archived_at IS NULL FOR UPDATE`,
        [command.userId],
      );
      if (user.rows[0]?.normalized_email !== email) {
        throw new SharedAdmissionError(
          "AUTH_IDENTITY_CONFLICT",
          "Authenticated identity does not match one active VideoForge user.",
        );
      }

      const invite = await transaction.query<InviteRow>(
        `SELECT id, intended_normalized_email, state, expires_at::text
           FROM invite_codes WHERE verifier_sha256 = $1 FOR UPDATE`,
        [command.verifierSha256],
      );
      const row = invite.rows[0];
      if (row === undefined) {
        throw new SharedAdmissionError("INVITE_INVALID", "Invite code is invalid.");
      }
      if (row.state === "CONSUMED") {
        throw new SharedAdmissionError("INVITE_ALREADY_USED", "Invite code was already used.");
      }
      if (row.state === "REVOKED") {
        throw new SharedAdmissionError("INVITE_REVOKED", "Invite code was revoked.");
      }
      if (Date.parse(row.expires_at) <= Date.parse(command.now)) {
        throw new SharedAdmissionError("INVITE_EXPIRED", "Invite code expired.");
      }
      if (row.intended_normalized_email !== email) {
        throw new SharedAdmissionError(
          "INVITE_EMAIL_MISMATCH",
          "Invite code is bound to a different verified email.",
        );
      }

      // One admitted identity owns exactly one account and one default workspace. An identity that
      // already owns one — an upgraded installation, or a re-admission — adopts it rather than
      // creating a second private tenant.
      const owned = await transaction.query<AccountRow>(
        `SELECT id FROM accounts WHERE owner_user_id = $1 AND scope_kind = 'USER'`,
        [command.userId],
      );
      const ownedAccountId = owned.rows[0]?.id;
      const accountId = ownedAccountId ?? command.accountId;
      let workspaceId = command.workspaceId;

      try {
        if (ownedAccountId === undefined) {
          await transaction.query(
            `INSERT INTO accounts (id, scope_kind, owner_user_id, normalized_email, status)
             VALUES ($1, 'USER', $2, $3, 'ACTIVE')`,
            [accountId, command.userId, email],
          );
          await transaction.query(
            `INSERT INTO workspaces (id, name, normalized_name, status, account_id, is_default)
             VALUES ($1, $2, $3, 'ACTIVE', $4, true)`,
            [workspaceId, `Workspace ${accountId}`, `workspace ${accountId}`, accountId],
          );
          await transaction.query(
            `INSERT INTO memberships (
               id, workspace_id, user_id, normalized_name, role, status, version
             ) VALUES ($1, $2, $3, $4, 'ADMIN', 'ACTIVE', 1)`,
            [command.membershipId, workspaceId, command.userId, `owner ${accountId}`],
          );
        } else {
          workspaceId = await resolveDefaultWorkspaceId(transaction, accountId);
        }
        await transaction.query(
          `INSERT INTO auth_identity_bindings (
             id, account_id, user_id, normalized_email, auth_method, provider_subject_sha256,
             email_verified_at, bound_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            command.identityBindingId,
            accountId,
            command.userId,
            email,
            command.authMethod,
            command.providerSubjectSha256,
            command.emailVerifiedAt,
            command.now,
          ],
        );
        await transaction.query(
          `INSERT INTO invite_redemptions (
             id, account_id, invite_code_id, user_id, normalized_email, auth_method,
             verifier_sha256, redeemed_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            command.redemptionId,
            accountId,
            row.id,
            command.userId,
            email,
            command.authMethod,
            command.verifierSha256,
            command.now,
          ],
        );
        await transaction.query(
          `INSERT INTO app_admissions (
             id, account_id, user_id, normalized_email, email_verified_at, invite_redemption_id,
             auth_methods, status, version, admitted_at
           ) VALUES ($1, $2, $3, $4, $5, $6, ARRAY[$7]::text[], 'ADMITTED', 1, $8)`,
          [
            command.admissionId,
            accountId,
            command.userId,
            email,
            command.emailVerifiedAt,
            command.redemptionId,
            command.authMethod,
            command.now,
          ],
        );
        const consumed = await transaction.query(
          `UPDATE invite_codes
              SET state = 'CONSUMED', consumed_at = $2, version = version + 1
            WHERE id = $1 AND state = 'ACTIVE'`,
          [row.id, command.now],
        );
        if (consumed.affectedRows !== 1) {
          throw new SharedAdmissionError(
            "INVITE_ALREADY_USED",
            "Invite code lost an atomic redemption race.",
          );
        }
      } catch (error) {
        if (error instanceof SharedAdmissionError) throw error;
        const code =
          error instanceof Error && "code" in error
            ? String((error as { code?: unknown }).code)
            : "";
        if (code === "23505") {
          throw new SharedAdmissionError(
            "AUTH_IDENTITY_CONFLICT",
            "Verified email or identity is already bound to another login method.",
          );
        }
        throw error;
      }

      return Object.freeze({
        outcome: "ADMITTED" as const,
        admissionId: command.admissionId,
        normalizedEmail: email,
        authMethod: command.authMethod,
        accountId,
        workspaceId,
      });
    });
  }
}

export async function hashInviteCode(rawCode: string): Promise<`sha256:${string}`> {
  const containsControlCharacter = [...rawCode].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
  if (
    rawCode.length < 16 ||
    rawCode.length > 256 ||
    rawCode !== rawCode.trim() ||
    containsControlCharacter
  ) {
    throw new SharedAdmissionError("INVITE_INVALID", "Invite code is invalid.");
  }
  const bytes = new TextEncoder().encode(rawCode);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

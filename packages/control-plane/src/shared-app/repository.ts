import { normalizedAuthEmailValue } from "../auth/validation.js";
import type { TransactionalSqlExecutor } from "../database/ports.js";

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
}

interface AdmissionRow extends Record<string, unknown> {
  readonly id: string;
  readonly normalized_email: string;
  readonly auth_methods: string[];
}

interface InviteRow extends Record<string, unknown> {
  readonly id: string;
  readonly intended_normalized_email: string;
  readonly state: "ACTIVE" | "CONSUMED" | "REVOKED";
  readonly expires_at: string;
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
        `SELECT id, normalized_email, auth_methods
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

      try {
        await transaction.query(
          `INSERT INTO auth_identity_bindings (
             id, user_id, normalized_email, auth_method, provider_subject_sha256,
             email_verified_at, bound_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            command.identityBindingId,
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
             id, invite_code_id, user_id, normalized_email, auth_method,
             verifier_sha256, redeemed_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            command.redemptionId,
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
             id, user_id, normalized_email, email_verified_at, invite_redemption_id,
             auth_methods, status, version, admitted_at
           ) VALUES ($1, $2, $3, $4, $5, ARRAY[$6]::text[], 'ADMITTED', 1, $7)`,
          [
            command.admissionId,
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

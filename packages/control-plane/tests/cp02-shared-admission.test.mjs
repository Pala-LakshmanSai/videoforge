import assert from "node:assert/strict";
import test from "node:test";

import {
  hashInviteCode,
  SharedAdmissionError,
  SharedAdmissionRepository,
} from "../dist/src/index.js";
import { IDS, seedLockedProjects } from "./support/fixtures.mjs";
import { createMigratedDatabase, sha256, uuid } from "./support/pglite.mjs";

const NOW = "2026-08-13T13:20:00.000Z";
const EXPIRES = "2026-08-13T14:20:00.000Z";

function command(overrides = {}) {
  return {
    admissionId: uuid(130_001),
    redemptionId: uuid(130_002),
    identityBindingId: uuid(130_003),
    userId: IDS.userA,
    email: "owner-a@example.test",
    emailVerified: true,
    emailVerifiedAt: NOW,
    authMethod: "EMAIL_PASSWORD",
    providerSubjectSha256: sha256("owner-a-email-password"),
    verifierSha256: sha256("invite-owner-a"),
    now: NOW,
    ...overrides,
  };
}

function expectCode(code) {
  return (error) => {
    assert.ok(error instanceof SharedAdmissionError);
    assert.equal(error.code, code);
    return true;
  };
}

test("verified email admission atomically consumes one email-bound invite and returning login skips it", async () => {
  const database = await createMigratedDatabase();
  try {
    await seedLockedProjects(database.executor);
    const repository = new SharedAdmissionRepository(database.executor);
    await repository.issueInvite({
      inviteId: uuid(130_010),
      intendedEmail: "Owner-A@Example.Test",
      verifierSha256: sha256("invite-owner-a"),
      createdAt: NOW,
      expiresAt: EXPIRES,
    });

    const admitted = await repository.redeemInvite(command());
    assert.deepEqual(admitted, {
      outcome: "ADMITTED",
      admissionId: uuid(130_001),
      normalizedEmail: "owner-a@example.test",
      authMethod: "EMAIL_PASSWORD",
    });
    const returning = await repository.redeemInvite(
      command({
        admissionId: uuid(130_004),
        redemptionId: uuid(130_005),
        identityBindingId: uuid(130_006),
        verifierSha256: sha256("never-read-on-return"),
      }),
    );
    assert.equal(returning.outcome, "RETURNING");

    const rows = await database.executor.query(
      `SELECT
         (SELECT count(*)::text FROM app_admissions) AS admissions,
         (SELECT count(*)::text FROM invite_redemptions) AS redemptions,
         (SELECT count(*)::text FROM auth_identity_bindings) AS identities,
         (SELECT state FROM invite_codes WHERE id = $1) AS invite_state`,
      [uuid(130_010)],
    );
    assert.deepEqual(rows.rows, [
      { admissions: "1", redemptions: "1", identities: "1", invite_state: "CONSUMED" },
    ]);
    await assert.rejects(
      repository.redeemInvite(command({ authMethod: "GOOGLE" })),
      expectCode("AUTH_IDENTITY_CONFLICT"),
    );
  } finally {
    await database.database.close();
  }
});

test("unverified, mismatched, expired, revoked, and malformed invites fail without admission", async () => {
  const database = await createMigratedDatabase();
  try {
    await seedLockedProjects(database.executor);
    const repository = new SharedAdmissionRepository(database.executor);
    await repository.issueInvite({
      inviteId: uuid(130_020),
      intendedEmail: "owner-a@example.test",
      verifierSha256: sha256("invite-policy"),
      createdAt: NOW,
      expiresAt: EXPIRES,
    });
    await assert.rejects(
      repository.redeemInvite(
        command({ emailVerified: false, verifierSha256: sha256("invite-policy") }),
      ),
      expectCode("EMAIL_VERIFICATION_REQUIRED"),
    );
    const mismatchedUser = uuid(130_023);
    await database.executor.query(
      `INSERT INTO users (id, email, normalized_email, display_name)
       VALUES ($1, 'mismatch@example.test', 'mismatch@example.test', 'Mismatch User')`,
      [mismatchedUser],
    );
    await assert.rejects(
      repository.redeemInvite(
        command({
          userId: mismatchedUser,
          email: "mismatch@example.test",
          verifierSha256: sha256("invite-policy"),
          providerSubjectSha256: sha256("mismatch-subject"),
        }),
      ),
      expectCode("INVITE_EMAIL_MISMATCH"),
    );
    await assert.rejects(
      repository.redeemInvite(command({ verifierSha256: sha256("unknown-invite") })),
      expectCode("INVITE_INVALID"),
    );

    await database.executor.query(
      `UPDATE invite_codes
          SET state = 'REVOKED', revoked_at = $2, version = version + 1
        WHERE id = $1`,
      [uuid(130_020), NOW],
    );
    await assert.rejects(
      repository.redeemInvite(command({ verifierSha256: sha256("invite-policy") })),
      expectCode("INVITE_REVOKED"),
    );

    const anotherUser = uuid(130_021);
    await database.executor.query(
      `INSERT INTO users (id, email, normalized_email, display_name)
       VALUES ($1, 'expired@example.test', 'expired@example.test', 'Expired User')`,
      [anotherUser],
    );
    await repository.issueInvite({
      inviteId: uuid(130_022),
      intendedEmail: "expired@example.test",
      verifierSha256: sha256("invite-expired"),
      createdAt: "2026-08-13T11:00:00.000Z",
      expiresAt: "2026-08-13T12:00:00.000Z",
    });
    await assert.rejects(
      repository.redeemInvite(
        command({
          userId: anotherUser,
          email: "expired@example.test",
          verifierSha256: sha256("invite-expired"),
          providerSubjectSha256: sha256("expired-subject"),
        }),
      ),
      expectCode("INVITE_EXPIRED"),
    );
    await assert.rejects(hashInviteCode(" short "), expectCode("INVITE_INVALID"));

    const count = await database.executor.query(
      `SELECT count(*)::text AS count FROM app_admissions`,
    );
    assert.equal(count.rows[0].count, "0");
  } finally {
    await database.database.close();
  }
});

test("same-code concurrent redemption produces one admission and one redemption", async () => {
  const database = await createMigratedDatabase();
  try {
    await seedLockedProjects(database.executor);
    const repository = new SharedAdmissionRepository(database.executor);
    await repository.issueInvite({
      inviteId: uuid(130_030),
      intendedEmail: "owner-a@example.test",
      verifierSha256: sha256("invite-race"),
      createdAt: NOW,
      expiresAt: EXPIRES,
    });
    const contenders = await Promise.allSettled([
      repository.redeemInvite(command({ verifierSha256: sha256("invite-race") })),
      repository.redeemInvite(
        command({
          admissionId: uuid(130_031),
          redemptionId: uuid(130_032),
          identityBindingId: uuid(130_033),
          verifierSha256: sha256("invite-race"),
        }),
      ),
    ]);
    assert.equal(
      contenders.some((result) => result.status === "fulfilled"),
      true,
    );
    const rows = await database.executor.query(
      `SELECT
         (SELECT count(*)::text FROM app_admissions) AS admissions,
         (SELECT count(*)::text FROM invite_redemptions) AS redemptions,
         (SELECT count(*)::text FROM auth_identity_bindings) AS identities`,
    );
    assert.deepEqual(rows.rows, [{ admissions: "1", redemptions: "1", identities: "1" }]);
  } finally {
    await database.database.close();
  }
});

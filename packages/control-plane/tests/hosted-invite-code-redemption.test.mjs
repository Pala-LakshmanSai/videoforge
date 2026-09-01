import assert from "node:assert/strict";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

import { applyMigrations, SharedAdmissionRepository } from "../dist/src/index.js";
import {
  loadMigrationSources,
  PGliteExecutor,
  sha256,
  uuid,
  withPgcryptoMigratedDatabase,
} from "./support/pglite.mjs";

function timestamps() {
  const now = Date.now();
  return {
    createdAt: new Date(now - 60_000).toISOString(),
    expiresAt: new Date(now + 3_600_000).toISOString(),
    sessionExpiresAt: new Date(now + 7_200_000).toISOString(),
  };
}

async function issue(repository, serial, email, rawCode, overrides = {}) {
  const time = timestamps();
  await repository.issueInvite({
    inviteId: uuid(470_000 + serial),
    intendedEmail: email,
    verifierSha256: sha256(rawCode),
    createdAt: overrides.createdAt ?? time.createdAt,
    expiresAt: overrides.expiresAt ?? time.expiresAt,
  });
  return uuid(470_000 + serial);
}

async function seedHostedIdentity(executor, serial, email, createSession = true) {
  const time = timestamps();
  const userId = `hosted-auth-user-${String(serial).padStart(4, "0")}`;
  const accountId = `hosted-auth-account-${String(serial).padStart(4, "0")}`;
  const sessionId = `hosted-auth-session-${String(serial).padStart(4, "0")}`;
  const sessionToken = `hosted-session-token-${String(serial).padStart(32, "0")}`;
  await executor.query(
    `INSERT INTO hosted_auth_users(id,name,email,email_verified,created_at,updated_at)
     VALUES($1,'Invite Test User',$2,true,$3,$3)`,
    [userId, email, time.createdAt],
  );
  await executor.query(
    `INSERT INTO hosted_auth_accounts(
       id,provider_account_id,provider_id,user_id,created_at,updated_at
     ) VALUES($1,$2,'google',$3,$4,$4)`,
    [accountId, `google-subject-${serial}`, userId, time.createdAt],
  );
  if (createSession) {
    await executor.query(
      `INSERT INTO hosted_auth_sessions(
         id,expires_at,token,created_at,updated_at,user_id
       ) VALUES($1,$2,$3,$4,$4,$5)`,
      [sessionId, time.sessionExpiresAt, sessionToken, time.createdAt, userId],
    );
  }
  return { userId, sessionToken, sessionId, time };
}

async function addSession(executor, serial, userId) {
  const time = timestamps();
  const sessionToken = `returning-session-token-${String(serial).padStart(28, "0")}`;
  await executor.query(
    `INSERT INTO hosted_auth_sessions(id,expires_at,token,created_at,updated_at,user_id)
     VALUES($1,$2,$3,$4,$4,$5)`,
    [
      `returning-session-${String(serial).padStart(4, "0")}`,
      time.sessionExpiresAt,
      sessionToken,
      time.createdAt,
      userId,
    ],
  );
  return sessionToken;
}

test("0047 hashes, email-binds, atomically consumes, and never re-redeems a returning login", async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    const repository = new SharedAdmissionRepository(executor);
    const email = "invite-owner@example.test";
    const rawCode = "test-invitation-code-0047-owner";
    const inviteId = await issue(repository, 1, email, rawCode);
    const identity = await seedHostedIdentity(executor, 1, email, false);
    const firstSession = await addSession(executor, 1, identity.userId);
    const secondSession = await addSession(executor, 2, identity.userId);

    const before = await executor.query("SELECT count(*)::int count FROM app_admissions");
    assert.equal(before.rows[0].count, 0, "Google authentication alone must not admit");

    const contenders = await Promise.all([
      repository.redeemHostedInvite({
        sessionToken: firstSession,
        verifierSha256: sha256(rawCode),
      }),
      repository.redeemHostedInvite({
        sessionToken: secondSession,
        verifierSha256: sha256(rawCode),
      }),
    ]);
    assert.deepEqual([...contenders].sort(), ["ADMITTED", "RETURNING"]);

    const durable = await executor.query(
      `SELECT
         (SELECT count(*)::int FROM app_admissions) admissions,
         (SELECT count(*)::int FROM invite_redemptions) redemptions,
         (SELECT count(*)::int FROM hosted_auth_links) links,
         (SELECT state FROM invite_codes WHERE id=$1) invite_state,
         (SELECT verifier_sha256 FROM invite_redemptions WHERE invite_code_id=$1) verifier_sha256`,
      [inviteId],
    );
    assert.deepEqual(durable.rows, [
      {
        admissions: 1,
        redemptions: 1,
        links: 1,
        invite_state: "CONSUMED",
        verifier_sha256: sha256(rawCode),
      },
    ]);
    assert.notEqual(durable.rows[0].verifier_sha256, rawCode);

    const returningSession = await addSession(executor, 3, identity.userId);
    const scope = await executor.query(
      "SELECT account_id,workspace_id FROM videoforge_hosted_session_scope($1)",
      [returningSession],
    );
    assert.equal(scope.rows.length, 1, "returning login must not require a second invite");
    assert.equal(
      await repository.redeemHostedInvite({
        sessionToken: returningSession,
        verifierSha256: sha256("unused-returning-verifier"),
      }),
      "RETURNING",
    );
  });
});

test("0047 rejects invalid, mismatched, expired, revoked, consumed, and unauthenticated codes", async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    const repository = new SharedAdmissionRepository(executor);
    const email = "policy-owner@example.test";
    const primaryCode = "test-invitation-code-0047-policy";
    await issue(repository, 10, email, primaryCode);
    const identity = await seedHostedIdentity(executor, 10, email);

    assert.equal(
      await repository.redeemHostedInvite({
        sessionToken: identity.sessionToken,
        verifierSha256: sha256("unknown-invitation-code"),
      }),
      "INVITE_INVALID",
    );
    assert.equal(
      await repository.redeemHostedInvite({
        sessionToken: "missing-session-token-that-never-authenticates",
        verifierSha256: sha256(primaryCode),
      }),
      "AUTHENTICATION_REQUIRED",
    );

    const mismatchCode = "test-invitation-code-0047-mismatch";
    await issue(repository, 11, "other-owner@example.test", mismatchCode);
    assert.equal(
      await repository.redeemHostedInvite({
        sessionToken: identity.sessionToken,
        verifierSha256: sha256(mismatchCode),
      }),
      "INVITE_EMAIL_MISMATCH",
    );

    const expiredCode = "test-invitation-code-0047-expired";
    await issue(repository, 12, "expired-owner@example.test", expiredCode, {
      createdAt: new Date(Date.now() - 7_200_000).toISOString(),
      expiresAt: new Date(Date.now() - 3_600_000).toISOString(),
    });
    assert.equal(
      await repository.redeemHostedInvite({
        sessionToken: identity.sessionToken,
        verifierSha256: sha256(expiredCode),
      }),
      "INVITE_EXPIRED",
    );

    const revokedCode = "test-invitation-code-0047-revoked";
    const revokedId = await issue(repository, 13, "revoked-owner@example.test", revokedCode);
    await executor.query(
      `UPDATE invite_codes SET state='REVOKED',revoked_at=now(),version=version+1 WHERE id=$1`,
      [revokedId],
    );
    assert.equal(
      await repository.redeemHostedInvite({
        sessionToken: identity.sessionToken,
        verifierSha256: sha256(revokedCode),
      }),
      "INVITE_REVOKED",
    );

    const consumedCode = "test-invitation-code-0047-consumed";
    const consumedId = await issue(repository, 14, "consumed-owner@example.test", consumedCode);
    await executor.query(
      `UPDATE invite_codes SET state='CONSUMED',consumed_at=now(),version=version+1 WHERE id=$1`,
      [consumedId],
    );
    assert.equal(
      await repository.redeemHostedInvite({
        sessionToken: identity.sessionToken,
        verifierSha256: sha256(consumedCode),
      }),
      "INVITE_ALREADY_USED",
    );

    const count = await executor.query("SELECT count(*)::int count FROM app_admissions");
    assert.equal(count.rows[0].count, 0);
  });
});

test("an exact retained 0046 ledger upgrades through 0054 and preserves admitted sessions", async () => {
  const database = new PGlite({ extensions: { pgcrypto } });
  try {
    await database.exec("CREATE EXTENSION IF NOT EXISTS pgcrypto");
    const executor = new PGliteExecutor(database);
    const sources = await loadMigrationSources();
    assert.equal(sources.at(-1)?.version, 54);
    await executor.execute(
      `CREATE TABLE public.videoforge_schema_migrations(
         version integer PRIMARY KEY CHECK(version>0),name text NOT NULL,
         filename text NOT NULL UNIQUE,sha256 text NOT NULL,
         applied_at timestamptz NOT NULL DEFAULT now())`,
    );
    for (const migration of sources.slice(0, 46)) {
      await executor.execute(migration.sql);
      await executor.query(
        `INSERT INTO videoforge_schema_migrations(version,name,filename,sha256)
         VALUES($1,$2,$3,$4)`,
        [migration.version, migration.name, migration.filename, migration.sha256],
      );
    }

    const repository = new SharedAdmissionRepository(executor);
    const returningEmail = "retained-owner@example.test";
    await issue(repository, 20, returningEmail, "retained-0046-invitation-code");
    const retained = await seedHostedIdentity(executor, 20, returningEmail);
    const retainedBefore = await executor.query(
      "SELECT account_id FROM videoforge_hosted_session_scope($1)",
      [retained.sessionToken],
    );
    assert.equal(retainedBefore.rows.length, 1, "0046 automatically admitted this retained user");

    const pendingEmail = "pending-owner@example.test";
    const pendingCode = "pending-0047-invitation-code";
    await issue(repository, 21, pendingEmail, pendingCode);
    const pending = await seedHostedIdentity(executor, 21, pendingEmail, false);

    const upgraded = await applyMigrations(executor, sources);
    assert.deepEqual(upgraded.appliedVersions, [47, 48, 49, 50, 51, 52, 53, 54]);
    assert.deepEqual(
      upgraded.alreadyAppliedVersions,
      Array.from({ length: 46 }, (_, index) => index + 1),
    );

    const returningSession = await addSession(executor, 20, retained.userId);
    assert.equal(
      (
        await executor.query(
          "SELECT count(*)::int count FROM videoforge_hosted_session_scope($1)",
          [returningSession],
        )
      ).rows[0].count,
      1,
    );

    const pendingSession = await addSession(executor, 21, pending.userId);
    assert.equal(
      (
        await executor.query(
          "SELECT count(*)::int count FROM videoforge_hosted_session_scope($1)",
          [pendingSession],
        )
      ).rows[0].count,
      0,
      "0047 must not infer admission from email alone",
    );
    assert.equal(
      await repository.redeemHostedInvite({
        sessionToken: pendingSession,
        verifierSha256: sha256(pendingCode),
      }),
      "ADMITTED",
    );
  } finally {
    await database.close();
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { PGliteExecutor } from "./support/pglite.mjs";
const read = (name) => readFileSync(new URL("../migrations/" + name, import.meta.url), "utf8");
const hash = (code) => "sha256:" + createHash("sha256").update(code).digest("hex");
async function fixture() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec("CREATE EXTENSION pgcrypto");
  const executor = new PGliteExecutor(db);
  const manifest = JSON.parse(read("manifest.json")).migrations;
  for (const row of manifest.filter((row) => row.version <= 47 || row.version === 238)) {
    const sql = read(row.filename);
    assert.equal(hash(sql), row.sha256);
    await executor.execute(sql);
  }
  return db;
}
async function identity(db, serial, email, admitted = true) {
  // Auth-user creation requires an invitation even before the exact-code admission step.
  await db.query(
    "INSERT INTO invite_codes(id,verifier_sha256,intended_normalized_email,state,expires_at,created_at) VALUES(gen_random_uuid(),$1,$2,'ACTIVE',now()+interval '1 day',now()) ON CONFLICT DO NOTHING",
    [hash("seed-code-" + serial), email],
  );
  const user = "team-test-user-" + String(serial).padStart(4, "0"),
    token = "team-session-token-" + String(serial).padStart(32, "0");
  await db.query(
    "INSERT INTO hosted_auth_users(id,name,email,email_verified,created_at,updated_at) VALUES($1,'Team Test',$2,true,now(),now())",
    [user, email],
  );
  await db.query(
    "INSERT INTO hosted_auth_accounts(id,provider_account_id,provider_id,user_id,created_at,updated_at) VALUES($1,$1,'google',$2,now(),now())",
    ["team-test-google-" + serial, user],
  );
  await db.query(
    "INSERT INTO hosted_auth_sessions(id,expires_at,token,created_at,updated_at,user_id) VALUES($1,now()+interval '1 hour',$2,now(),now(),$3)",
    ["team-test-session-" + serial, token, user],
  );
  if (admitted) {
    const code = "seed-code-" + serial;
    await db.query(
      "INSERT INTO invite_codes(id,verifier_sha256,intended_normalized_email,state,expires_at,created_at) VALUES(gen_random_uuid(),$1,$2,'ACTIVE',now()+interval '1 day',now()) ON CONFLICT DO NOTHING",
      [hash(code), email],
    );
    assert.equal(
      (
        await db.query("SELECT outcome FROM videoforge_redeem_hosted_invite($1,$2)", [
          token,
          hash(code),
        ])
      ).rows[0].outcome,
      "ADMITTED",
    );
  }
  return { user, token };
}
async function manage(db, token, operation, target = null, verifier = null) {
  return (
    await db.query("SELECT videoforge_manage_team_access($1,$2,$3,$4) result", [
      token,
      operation,
      target,
      verifier,
    ])
  ).rows[0].result;
}
const scope = async (db, token) =>
  (await db.query("SELECT * FROM videoforge_hosted_session_scope($1)", [token])).rows;
test("238 Team access enforces manager-only invitation/admission/revocation/restore in PostgreSQL", async (t) => {
  const db = await fixture();
  try {
    const first = await identity(db, 1, "lakshman121@gmail.com"),
      second = await identity(db, 2, "demo9gss@gmail.com"),
      member = await identity(db, 3, "assistant@example.test"),
      outsider = await identity(db, 4, "other@example.test"),
      unadmitted = await identity(db, 5, "pending@example.test", false);
    await t.test(
      "both exact managers list metadata while non-managers and authentication-only sessions fail closed",
      async () => {
        for (const owner of [first, second])
          assert.equal((await manage(db, owner.token, "LIST")).members.length, 4);
        for (const token of [member.token, outsider.token, unadmitted.token, "missing"])
          assert.deepEqual(await manage(db, token, "LIST"), { error: "TEAM_ACCESS_FORBIDDEN" });
        const list = JSON.stringify(await manage(db, first.token, "LIST"));
        assert.ok(!list.includes("verifier"));
        assert.ok(!list.includes("account_id"));
      },
    );
    await t.test(
      "one-use email-bound invitation rotates only unused codes, has 72h expiry and admits a private workspace",
      async () => {
        const code = "first-manager-code-0000000000000000";
        const invite = await manage(db, first.token, "INVITE", " New@example.test ", hash(code));
        assert.ok(invite.invite_id);
        const stored = (
          await db.query("SELECT * FROM invite_codes WHERE id=$1", [invite.invite_id])
        ).rows[0];
        assert.equal(stored.verifier_sha256, hash(code));
        assert.equal(stored.intended_normalized_email, "new@example.test");
        assert.equal(Date.parse(stored.expires_at) - Date.parse(stored.created_at), 72 * 3600000);
        const replacement = "replacement-manager-code-0000000000";
        assert.notEqual(
          (await manage(db, second.token, "INVITE", "new@example.test", hash(replacement)))
            .invite_id,
          invite.invite_id,
        );
        const fresh = await identity(db, 6, "new@example.test", false);
        assert.equal(
          (
            await db.query("SELECT outcome FROM videoforge_redeem_hosted_invite($1,$2)", [
              fresh.token,
              hash(code),
            ])
          ).rows[0].outcome,
          "INVITE_REVOKED",
        );
        assert.equal(
          (
            await db.query("SELECT outcome FROM videoforge_redeem_hosted_invite($1,$2)", [
              unadmitted.token,
              hash(replacement),
            ])
          ).rows[0].outcome,
          "INVITE_EMAIL_MISMATCH",
        );
        assert.equal(
          (
            await db.query("SELECT outcome FROM videoforge_redeem_hosted_invite($1,$2)", [
              fresh.token,
              hash(replacement),
            ])
          ).rows[0].outcome,
          "ADMITTED",
        );
        assert.equal((await scope(db, fresh.token)).length, 1);
        assert.notEqual(
          (await scope(db, fresh.token))[0].workspace_id,
          (await scope(db, first.token))[0].workspace_id,
        );
        assert.deepEqual(await manage(db, first.token, "INVITE", "new@example.test", hash(code)), {
          error: "TEAM_ALREADY_ADMITTED",
        });
      },
    );
    await t.test("pending code revocation and expiry block first admission", async () => {
      const invite = await manage(
        db,
        first.token,
        "INVITE",
        "pending@example.test",
        hash("pending-code"),
      );
      await manage(db, first.token, "REVOKE_INVITE", invite.invite_id);
      assert.equal(
        (
          await db.query("SELECT outcome FROM videoforge_redeem_hosted_invite($1,$2)", [
            unadmitted.token,
            hash("pending-code"),
          ])
        ).rows[0].outcome,
        "INVITE_REVOKED",
      );
      await db.query(
        "INSERT INTO invite_codes(id,verifier_sha256,intended_normalized_email,state,created_at,expires_at) VALUES(gen_random_uuid(),$1,'pending@example.test','ACTIVE',now()-interval '4 days',now()-interval '1 hour')",
        [hash("expired-code")],
      );
      assert.equal(
        (
          await db.query("SELECT outcome FROM videoforge_redeem_hosted_invite($1,$2)", [
            unadmitted.token,
            hash("expired-code"),
          ])
        ).rows[0].outcome,
        "INVITE_EXPIRED",
      );
    });
    await t.test(
      "revocation deletes all sessions, denies new login, keeps tenant data, and restores the existing studio",
      async () => {
        const before = (await scope(db, member.token))[0];
        assert.deepEqual(await manage(db, second.token, "REVOKE", member.user), { updated: true });
        assert.equal((await scope(db, member.token)).length, 0);
        assert.equal(
          (
            await db.query("SELECT count(*)::int n FROM hosted_auth_sessions WHERE user_id=$1", [
              member.user,
            ])
          ).rows[0].n,
          0,
        );
        await assert.rejects(
          db.query(
            "INSERT INTO hosted_auth_sessions(id,expires_at,token,created_at,updated_at,user_id) VALUES('revoked-new-session',now()+interval '1 hour',$1,now(),now(),$2)",
            [member.token, member.user],
          ),
          /hosted access revoked/,
        );
        assert.equal(
          (
            await db.query(
              "SELECT workspace_id FROM hosted_auth_links WHERE hosted_auth_user_id=$1",
              [member.user],
            )
          ).rows[0].workspace_id,
          before.workspace_id,
        );
        assert.deepEqual(await manage(db, first.token, "RESTORE", member.user), { updated: true });
        await db.query(
          "INSERT INTO hosted_auth_sessions(id,expires_at,token,created_at,updated_at,user_id) VALUES('restored-new-session',now()+interval '1 hour',$1,now(),now(),$2)",
          [member.token, member.user],
        );
        assert.equal((await scope(db, member.token))[0].workspace_id, before.workspace_id);
      },
    );
    await t.test(
      "owners cannot be revoked, invalid targets fail, and runtime cannot read the global revocation table",
      async () => {
        for (const owner of [first, second])
          assert.deepEqual(await manage(db, first.token, "REVOKE", owner.user), {
            error: "TEAM_OWNER_PROTECTED",
          });
        assert.deepEqual(await manage(db, first.token, "REVOKE", "missing"), {
          error: "TEAM_MEMBER_NOT_FOUND",
        });
        await db.exec("SET ROLE videoforge_v209_runtime_dc9612d6");
        try {
          assert.equal((await manage(db, first.token, "LIST")).members.length, 5);
          await assert.rejects(
            db.query("SELECT * FROM hosted_access_revocations"),
            /permission denied/,
          );
          assert.deepEqual(await manage(db, outsider.token, "RESTORE", member.user), {
            error: "TEAM_ACCESS_FORBIDDEN",
          });
        } finally {
          await db.exec("RESET ROLE");
        }
      },
    );
  } finally {
    await db.close();
  }
});

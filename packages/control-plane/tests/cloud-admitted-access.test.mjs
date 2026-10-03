import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { PGliteExecutor, uuid } from "./support/pglite.mjs";

const read = (name) => readFileSync(new URL("../migrations/" + name, import.meta.url), "utf8");
const digest = (value) => "sha256:" + createHash("sha256").update(value).digest("hex");
const ongoing = uuid(249001),
  finite = uuid(249002),
  project = uuid(249003),
  revision = uuid(249004);
const hash = "sha256:" + "a".repeat(64);
async function identity(db, serial, admit = true) {
  const email = `cloud-admission-${serial}@example.test`,
    user = `cloud-admission-user-${serial}`;
  const token = `cloud-admission-session-${String(serial).padStart(32, "0")}`,
    code = digest("invite-" + serial);
  await db.query(
    "INSERT INTO invite_codes(id,verifier_sha256,intended_normalized_email,state,expires_at,created_at) VALUES(gen_random_uuid(),$1,$2,'ACTIVE',now()+interval '1 day',now())",
    [code, email],
  );
  await db.query(
    "INSERT INTO hosted_auth_users(id,name,email,email_verified,created_at,updated_at) VALUES($1,'Cloud Test',$2,true,now(),now())",
    [user, email],
  );
  await db.query(
    "INSERT INTO hosted_auth_accounts(id,provider_account_id,provider_id,user_id,created_at,updated_at) VALUES($1,$1,'google',$2,now(),now())",
    [user + "-google", user],
  );
  await db.query(
    "INSERT INTO hosted_auth_sessions(id,expires_at,token,created_at,updated_at,user_id) VALUES($1,now()+interval '1 hour',$2,now(),now(),$3)",
    [user + "-session", token, user],
  );
  if (admit)
    assert.equal(
      (await db.query("SELECT outcome FROM videoforge_redeem_hosted_invite($1,$2)", [token, code]))
        .rows[0].outcome,
      "ADMITTED",
    );
  const scope = (await db.query("SELECT * FROM videoforge_hosted_session_scope($1)", [token]))
    .rows[0];
  return { user, token, code, ...scope };
}

test("ordinary Cloud follows current and future VideoForge admission without a separate account list", async (t) => {
  const db = new PGlite({ extensions: { pgcrypto } });
  try {
    await db.exec("CREATE EXTENSION pgcrypto");
    const executor = new PGliteExecutor(db);
    for (const row of JSON.parse(read("manifest.json")).migrations.filter(
      (row) => row.version <= 248,
    )) {
      if (row.version === 195) continue; // Deployment-owned continuation prerequisite, as in existing Cloud tests.
      const sql = read(row.filename);
      assert.equal(digest(sql), row.sha256);
      await executor.execute(sql);
    }
    const first = await identity(db, 1),
      second = await identity(db, 2),
      pending = await identity(db, 3, false);
    await db.query("SELECT set_config('videoforge.account_id',$1,false)", [first.account_id]);
    await db.query(
      `INSERT INTO projects(id,workspace_id,owner_user_id,name,normalized_name) VALUES($1,$2,$3,'Cloud scope fixture','cloud scope fixture')`,
      [project, first.workspace_id, first.user_id],
    );
    for (const [id, isOngoing] of [
      [ongoing, true],
      [finite, false],
    ])
      await db.query(
        `INSERT INTO cloud_media_budget_authorities(id,allowed_account_ids,allowed_project_ids,total_cap_usd,max_reservation_usd,max_hourly_usd,max_rental_seconds,image,source_sha256,runtime_sha256,expires_at,allow_new_cloud_projects,max_reservations,ongoing_pay_per_use)
    VALUES($1,ARRAY[$2::uuid],ARRAY[$3::uuid],$4,$5,.8,7200,$6,$7,$7,$8,true,$9,$10)`,
        [
          id,
          first.account_id,
          project,
          isOngoing ? null : 3,
          isOngoing ? null : 1,
          "registry/example@" + hash,
          hash,
          isOngoing ? null : new Date(Date.now() + 3600000),
          isOngoing ? null : 3,
          isOngoing,
        ],
      );
    const snapshot = async () =>
      (
        await db.query(
          "SELECT jsonb_agg(to_jsonb(b) ORDER BY id) value FROM cloud_media_budget_authorities b",
        )
      ).rows[0].value;
    const ready = async (account, id = ongoing) => {
      await db.query("SELECT set_config('videoforge.account_id',$1,false)", [account ?? ""]);
      return (await db.query("SELECT videoforge_cloud_media_new_project_ready($1) ready", [id]))
        .rows[0].ready;
    };
    const allowed = async (account, ownedProject = project, ownedRevision = revision) =>
      (
        await db.query(
          "SELECT videoforge_cloud_media_authority_project_allowed($1,$2,$3,$4) allowed",
          [ongoing, account, ownedProject, ownedRevision],
        )
      ).rows[0].allowed;
    assert.equal(
      await ready(second.account_id),
      false,
      "Reproduce admitted account missing from old Cloud list",
    );
    const before = await snapshot();
    const acl = async () =>
      (
        await db.query(
          "SELECT oid,proowner,proacl FROM pg_proc WHERE oid IN ('videoforge_cloud_media_new_project_ready(uuid)'::regprocedure,'videoforge_cloud_media_authority_project_allowed(uuid,uuid,uuid,uuid)'::regprocedure,'videoforge_cloud_media_reservation_authority(uuid,uuid,uuid)'::regprocedure) ORDER BY oid",
        )
      ).rows;
    const originalAcl = await acl();
    await db.exec("BEGIN; SAVEPOINT candidate");
    await executor.execute(read("0249_cloud_access_follows_admission.sql"));
    assert.equal(await ready(second.account_id), true);
    await db.exec("ROLLBACK TO candidate");
    assert.equal(await ready(second.account_id), false, "Rollback restores previous policy");
    await executor.execute(read("0249_cloud_access_follows_admission.sql"));
    await executor.execute(read("0249_cloud_access_follows_admission.sql"));
    await db.exec("COMMIT");
    await t.test(
      "existing admitted accounts and future invitation redemption are enabled automatically",
      async () => {
        assert.equal(await ready(first.account_id), true);
        assert.equal(await ready(second.account_id), true);
        const future = await identity(db, 4);
        assert.equal(await ready(future.account_id), true);
        assert.deepEqual(
          await snapshot(),
          before,
          "No authority account list, debit, price or runtime pin changes",
        );
      },
    );
    await t.test(
      "pending, revoked, disabled, unknown and system identities remain outside VideoForge access",
      async () => {
        assert.equal(await ready(uuid(249999)), false);
        assert.equal(await ready(null), false);
        assert.equal(await ready("ffffffff-ffff-4fff-8fff-000000000001"), false);
        assert.equal(
          await ready(
            (
              await db.query(
                "SELECT admitted_account_id FROM hosted_auth_links WHERE hosted_auth_user_id=$1",
                [pending.user],
              )
            ).rows[0]?.admitted_account_id,
          ),
          false,
        );
        await db.query(
          "INSERT INTO hosted_access_revocations(hosted_auth_user_id,revoked_by) VALUES($1,$2)",
          [second.user, first.user],
        );
        assert.equal(
          (
            await db.query("SELECT count(*)::int n FROM videoforge_hosted_session_scope($1)", [
              second.token,
            ])
          ).rows[0].n,
          0,
        );
        assert.equal(await ready(second.account_id), false);
        await db.query("DELETE FROM hosted_access_revocations WHERE hosted_auth_user_id=$1", [
          second.user,
        ]);
        assert.equal(
          await ready(second.account_id),
          true,
          "Restoring VideoForge access restores Cloud without another grant",
        );
        await db.query("UPDATE accounts SET status='DISABLED' WHERE id=$1", [second.account_id]);
        assert.equal(await ready(second.account_id), false);
        await db.query("UPDATE accounts SET status='ACTIVE' WHERE id=$1", [second.account_id]);
      },
    );
    await t.test(
      "finite historical account scope, expiry and spend bounds remain unchanged",
      async () => {
        assert.equal(await ready(second.account_id, finite), false);
        assert.equal(await ready(first.account_id, finite), true);
        await db.query("UPDATE cloud_media_budget_authorities SET debited_usd=3 WHERE id=$1", [
          finite,
        ]);
        assert.equal(await ready(first.account_id, finite), false);
        await db.query(
          "UPDATE cloud_media_budget_authorities SET debited_usd=0,expires_at=now()-interval '1 second' WHERE id=$1",
          [finite],
        );
        assert.equal(await ready(first.account_id, finite), false);
      },
    );
    await t.test("project scope remains bound to the current tenant", async () => {
      await ready(first.account_id);
      assert.equal(await allowed(first.account_id), true);
      await ready(second.account_id);
      assert.equal(await allowed(first.account_id), false);
      assert.equal(
        await allowed(second.account_id),
        false,
        "Foreign project cannot inherit another account Cloud access",
      );
      assert.equal(await allowed(second.account_id, uuid(249998)), false);
    });
    await t.test(
      "authority disable and original reader ownership and privileges remain intact",
      async () => {
        await db.query("UPDATE cloud_media_budget_authorities SET enabled=false WHERE id=$1", [
          ongoing,
        ]);
        assert.equal(await ready(first.account_id), false);
        assert.equal(await ready(second.account_id), false);
        assert.deepEqual(await acl(), originalAcl);
        assert.equal(
          (
            await db.query(
              "SELECT has_table_privilege('videoforge_v209_runtime_dc9612d6','cloud_media_budget_authorities','UPDATE') allowed",
            )
          ).rows[0].allowed,
          false,
        );
      },
    );
  } finally {
    await db.close();
  }
});

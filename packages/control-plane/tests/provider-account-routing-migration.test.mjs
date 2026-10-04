import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createFixtureDatabase, applyMigrationSliceThrough } from "./support/pglite.mjs";
import { IDS, seedLockedProjects } from "./support/fixtures.mjs";
const source = readFileSync(
  new URL("../migrations/0263_provider_account_routing.sql", import.meta.url),
  "utf8",
);
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = "sha256:" + "a".repeat(64);

test("0263 pooled claims retain exact account identity and tenant scope", async () => {
  const { database: db, executor, sources } = await createFixtureDatabase();
  try {
    await applyMigrationSliceThrough(executor, 262, sources);
    await db.exec("SET ROLE videoforge_v209_runtime_dc9612d6");
    await assert.rejects(executor.execute(source), /BYPASSRLS or superuser migration owner/);
    await db.exec("RESET ROLE");
    await db.exec(
      "PREPARE old_media_reader(uuid,uuid,uuid) AS SELECT videoforge_read_hosted_api_jobs($1,$2,$3)",
    );
    const originalOid = (
      await db.query(
        "SELECT 'videoforge_read_hosted_api_jobs(uuid,uuid,uuid)'::regprocedure::oid AS value",
      )
    ).rows[0].value;
    await executor.execute(source);
    assert.equal(
      (
        await db.query(
          "SELECT 'videoforge_read_hosted_api_jobs(uuid,uuid,uuid)'::regprocedure::oid AS value",
        )
      ).rows[0].value,
      originalOid,
      "migration preserves public function OID",
    );
    await seedLockedProjects(executor);
    const scope = async (a) => db.query("SELECT set_config('videoforge.account_id',$1,false)", [a]);
    const seed = async (table, sql, args) => {
      await db.exec(`ALTER TABLE ${table} DISABLE TRIGGER ALL`);
      try {
        await db.query(sql, args);
      } finally {
        await db.exec(`ALTER TABLE ${table} ENABLE TRIGGER ALL`);
      }
    };
    const add = async (a, w, p, r, u, n, lane = "IMAGE", state = "PREPARED") => {
      const g = id(n),
        j = id(n + 1),
        t = id(n + 2),
        claim = state === "PREPARED" ? null : id(n + 3);
      await scope(a);
      await seed(
        "generation_requests",
        `INSERT INTO generation_requests(id,account_id,workspace_id,project_id,project_revision_id,created_by_user_id,state,queue_order,available_at,idempotency_key,admitted_at,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'ACTIVE',$7,now(),$8,now(),now(),now())`,
        [g, a, w, p, r, u, n, `capacity-${n}`],
      );
      await seed(
        "hosted_api_generation_jobs",
        `INSERT INTO hosted_api_generation_jobs(id,account_id,workspace_id,project_id,project_revision_id,generation_request_id,generation_task_id,task_key,lane,input_manifest,input_sha256,output_object_key,state,claim_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'{"prompt":"Documentary scene"}',$10,$11,$12,$13)`,
        [
          j,
          a,
          w,
          p,
          r,
          g,
          t,
          `image:${n}`,
          lane,
          hash,
          `tenant/${a}/workspace/${w}/project/${p}/revision/${r}/lane/${lane === "IMAGE" ? "mage-image" : "soulx-avatar"}/job/${j}/artifact/${t}`,
          state,
          claim,
        ],
      );
      return { a, w, g, j, t, claim: id(n + 4) };
    };
    const a = await add(
      IDS.accountA,
      IDS.workspaceA,
      IDS.projectA,
      IDS.revisionA,
      IDS.userA,
      263100,
    );
    const b = await add(
      IDS.accountB,
      IDS.workspaceB,
      IDS.projectB,
      IDS.revisionB,
      IDS.userB,
      263200,
    );
    await db.exec(
      "INSERT INTO provider_api_policies(provider,max_inflight,min_start_interval_ms) VALUES('KIE:kie-extra',1,0); INSERT INTO provider_accounts VALUES('kie-extra','KIE','v1','KIE:kie-extra',true,false,true,'-infinity'); UPDATE provider_api_policies SET max_inflight=1,min_start_interval_ms=0 WHERE provider='KIE'",
    );
    const claim = async (s, keys) => {
      await scope(s.a);
      return (
        await db.query(
          "SELECT videoforge_claim_hosted_api_job_v2($1,$2,$3,$4,$5,$6::text[]) AS value",
          [s.a, s.w, s.g, s.t, s.claim, keys],
        )
      ).rows[0].value;
    };
    const read = async (s) => {
      await scope(s.a);
      return (
        await db.query("SELECT videoforge_read_hosted_api_jobs_v2($1,$2,$3) AS value", [
          s.a,
          s.w,
          s.g,
        ])
      ).rows[0].value;
    };
    await scope(a.a);
    await db.exec(
      "UPDATE provider_accounts SET enabled=false WHERE provider_account_id='kie-legacy'",
    );
    assert.equal(
      (
        await db.query("SELECT videoforge_claim_hosted_api_job($1,$2,$3,$4,$5) AS value", [
          a.a,
          a.w,
          a.g,
          a.t,
          a.claim,
        ])
      ).rows[0].value.state,
      "PREPARED",
      "legacy binary cannot start disabled credentials",
    );
    await db.exec(
      "UPDATE provider_accounts SET enabled=true WHERE provider_account_id='kie-legacy'",
    );
    assert.equal((await claim(a, ["kie-legacy"])).providerAccount.id, "kie-legacy");
    await db.exec(
      "INSERT INTO provider_api_policies(provider,max_inflight,min_start_interval_ms) VALUES('KIE:kie-future',1,0); INSERT INTO provider_accounts VALUES('kie-future','KIE','v1','KIE:kie-future',true,false,true)",
    );
    assert.equal(
      (await claim(b, ["kie-legacy", "kie-future"])).state,
      "PREPARED",
      "preexisting generation cannot spill into added account",
    );
    assert.deepEqual((await claim(b, ["kie-legacy", "kie-extra"])).providerAccount, {
      id: "kie-extra",
      provider: "KIE",
      credentialVersion: "v1",
    });
    assert.equal((await claim(b, ["kie-legacy"])).providerAccount.id, "kie-extra");
    assert.equal((await read(b)).jobs[0].providerAccount.id, "kie-extra");
    await assert.rejects(
      db.query("SELECT videoforge_read_hosted_api_jobs($1,$2,$3)", [b.a, b.w, b.g]),
      /ROUTING_VERSION_REQUIRED/,
    );
    await assert.rejects(
      db.query(`EXECUTE old_media_reader('${b.a}','${b.w}','${b.g}')`),
      /ROUTING_VERSION_REQUIRED/,
      "prepared legacy reader cannot bypass guard",
    );
    await assert.rejects(
      db.query("SELECT videoforge_claim_hosted_api_job($1,$2,$3,$4,$5)", [
        b.a,
        b.w,
        b.g,
        b.t,
        b.claim,
      ]),
      /ROUTING_VERSION_REQUIRED/,
    );
    await db.exec(
      "UPDATE provider_accounts SET enabled=false WHERE provider_account_id='kie-extra'",
    );
    assert.equal((await read(b)).jobs[0].providerAccount.id, "kie-extra");
    await db.query("UPDATE hosted_api_generation_jobs SET state='UNKNOWN_NO_RETRY' WHERE id=$1", [
      b.j,
    ]);
    await assert.rejects(
      db.query("SELECT videoforge_defer_hosted_api_job($1,$2,$3,$4,$5,1000)", [
        b.a,
        b.w,
        b.g,
        b.t,
        b.claim,
      ]),
      /defer claim invalid/,
    );
    assert.equal(
      (await db.query("SELECT videoforge_provider_api_active_count('KIE:kie-extra') AS value"))
        .rows[0].value,
      1,
    );
    await db.query("UPDATE hosted_api_generation_jobs SET state='SUBMITTING' WHERE id=$1", [b.j]);
    await db.query("SELECT videoforge_defer_hosted_api_job($1,$2,$3,$4,$5,60000)", [
      b.a,
      b.w,
      b.g,
      b.t,
      b.claim,
    ]);
    assert.equal(
      (
        await db.query("SELECT count(*)::int AS value FROM provider_task_routes WHERE job_id=$1", [
          b.j,
        ])
      ).rows[0].value,
      0,
    );
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int AS value FROM provider_submission_attempt_accounts WHERE job_id=$1",
          [b.j],
        )
      ).rows[0].value,
      1,
    );
    assert.equal(
      (
        await db.query(
          "SELECT cooldown_until>now() AS value FROM provider_api_policies WHERE provider='KIE:kie-extra'",
        )
      ).rows[0].value,
      true,
    );
    assert.equal(
      (
        await db.query(
          "SELECT cooldown_until<now() AS value FROM provider_api_policies WHERE provider='KIE'",
        )
      ).rows[0].value,
      true,
    );
    await seed(
      "hosted_api_generation_jobs",
      "UPDATE hosted_api_generation_jobs SET state='FAILED',failure_code='TEST_DONE' WHERE id=$1",
      [a.j],
    );
    b.claim = id(263299);
    assert.equal((await claim(b, ["kie-legacy"])).providerAccount.id, "kie-legacy");
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int AS value FROM provider_submission_attempt_accounts WHERE job_id=$1",
          [b.j],
        )
      ).rows[0].value,
      2,
    );
    await assert.rejects(
      db.query(
        "UPDATE provider_submission_attempt_accounts SET credential_version='v2' WHERE job_id=$1",
        [b.j],
      ),
      /immutable/,
    );
    await assert.rejects(
      db.query(
        "UPDATE provider_accounts SET credential_version='v2' WHERE provider_account_id='kie-extra'",
      ),
      /immutable/,
    );
    await assert.rejects(
      db.query(
        "UPDATE provider_accounts SET enabled=true,pricing_verified=false WHERE provider_account_id='kie-extra'",
      ),
      /check constraint/,
    );
    await assert.rejects(
      db.query("DELETE FROM provider_task_routes WHERE job_id=$1", [b.j]),
      /exact unaccepted receipt/,
    );
    await db.exec(
      "UPDATE provider_accounts SET enabled=true WHERE provider_account_id='kie-extra'; UPDATE provider_api_policies SET max_inflight=3,min_start_interval_ms=0,cooldown_until='-infinity',next_start_at='-infinity' WHERE provider='KIE:kie-extra'",
    );
    // Idle new videos alternate the preferred alias using assignment-count ties.
    await scope(b.a);
    await db.exec(
      "UPDATE provider_api_policies SET cooldown_until='-infinity',next_start_at='-infinity' WHERE provider IN('KIE','KIE:kie-extra')",
    );
    await db.exec(
      "INSERT INTO provider_api_policies(provider,max_inflight,min_start_interval_ms) VALUES('KIE:kie-rotation-a',1,0),('KIE:kie-rotation-b',1,0); INSERT INTO provider_accounts VALUES('kie-rotation-a','KIE','v1','KIE:kie-rotation-a',true,false,true,'-infinity'),('kie-rotation-b','KIE','v1','KIE:kie-rotation-b',true,false,true,'-infinity')",
    );
    const rotation = [];
    for (const n of [263800, 263900]) {
      const owner = id(n + 5),
        account = id(n + 6),
        email = `rotation-${n}@example.test`;
      await db.query(
        "INSERT INTO users(id,email,normalized_email,display_name) VALUES($1,$2,$2,'Rotation fixture')",
        [owner, email],
      );
      await seed(
        "accounts",
        "INSERT INTO accounts(id,scope_kind,owner_user_id,normalized_email,status) VALUES($1,'USER',$2,$3,'ACTIVE')",
        [account, owner, email],
      );
      rotation.push(await add(account, id(n + 7), id(n + 8), id(n + 9), owner, n));
    }
    const [rotation1, rotation2] = rotation;
    assert.equal(
      (await claim(rotation1, ["kie-rotation-a", "kie-rotation-b"])).providerAccount.id,
      "kie-rotation-a",
    );
    await seed(
      "hosted_api_generation_jobs",
      "UPDATE hosted_api_generation_jobs SET state='FAILED',failure_code='TEST_DONE' WHERE id=$1",
      [rotation1.j],
    );
    assert.equal(
      (await claim(rotation2, ["kie-rotation-a", "kie-rotation-b"])).providerAccount.id,
      "kie-rotation-b",
    );
    await seed(
      "hosted_api_generation_jobs",
      "UPDATE hosted_api_generation_jobs SET state='FAILED',failure_code='TEST_DONE' WHERE id=$1",
      [rotation2.j],
    );
    const tenants = [];
    for (let n = 0; n < 10; n++) {
      const account = id(259500 + n * 10),
        user = id(259501 + n * 10);
      const email = `provider-capacity-${n}@example.test`;
      await db.query(
        "INSERT INTO users(id,email,normalized_email,display_name) VALUES($1,$2,$2,'Capacity fixture')",
        [user, email],
      );
      await seed(
        "accounts",
        "INSERT INTO accounts(id,scope_kind,owner_user_id,normalized_email,status) VALUES($1,'USER',$2,$3,'ACTIVE')",
        [account, user, email],
      );
      tenants.push(
        await add(account, id(260500 + n), id(261500 + n), id(262500 + n), user, 263000 + n * 10),
      );
    }
    for (let n = 0; n < tenants.length; n++)
      assert.equal(
        (await claim(tenants[n], ["kie-extra"])).state,
        n < 3 ? "SUBMITTING" : "PREPARED",
      );
    assert.equal(
      (await db.query("SELECT videoforge_provider_api_active_count('KIE:kie-extra') AS n")).rows[0]
        .n,
      3,
    );
    await scope(tenants[0].a);
    await db.query(
      "UPDATE hosted_api_generation_jobs SET state='FAILED',failure_code='TEST_CONFIRMED_FAILURE' WHERE id=$1",
      [tenants[0].j],
    );
    assert.equal((await claim(tenants[9], ["kie-extra"])).state, "PREPARED");
    assert.equal((await claim(tenants[3], ["kie-extra"])).state, "SUBMITTING");
    await scope(tenants[1].a);
    await db.query(
      "UPDATE hosted_api_generation_jobs SET state='FAILED',failure_code='TEST_CONFIRMED_FAILURE' WHERE id=$1",
      [tenants[1].j],
    );
    await db.query(
      "UPDATE provider_api_waiters SET last_seen_at=clock_timestamp()-interval '3 minutes' WHERE job_id=$1",
      [tenants[4].j],
    );
    assert.equal(
      (await claim(tenants[5], ["kie-extra"])).state,
      "SUBMITTING",
      "stopped unsubmitted waiter cannot hold the queue head",
    );
    assert.equal(
      (
        await db.query("SELECT count(*)::integer AS n FROM provider_api_waiters WHERE job_id=$1", [
          tenants[4].j,
        ])
      ).rows[0].n,
      0,
    );
    // Fal Z-image regenerations share the same gate as ordinary Fal avatars.
    const avatar = { ...b, j: id(264001), t: id(264002), claim: id(264003) };
    await scope(b.a);
    await seed(
      "hosted_api_generation_jobs",
      `INSERT INTO hosted_api_generation_jobs(id,account_id,workspace_id,project_id,project_revision_id,generation_request_id,generation_task_id,task_key,lane,input_manifest,input_sha256,output_object_key) VALUES($1,$2,$3,$4,$5,$6,$7,'avatar:capacity','AVATAR','{}',$8,$9)`,
      [
        avatar.j,
        b.a,
        b.w,
        IDS.projectB,
        IDS.revisionB,
        b.g,
        avatar.t,
        hash,
        `tenant/${b.a}/workspace/${b.w}/project/${IDS.projectB}/revision/${IDS.revisionB}/lane/soulx-avatar/job/${avatar.j}/artifact/${avatar.t}`,
      ],
    );
    const regen = id(264100),
      regenClaim = id(264101);
    await scope(a.a);
    await seed(
      "hosted_api_image_regeneration_jobs",
      `INSERT INTO hosted_api_image_regeneration_jobs(id,account_id,workspace_id,project_id,project_revision_id,generation_request_id,image_task_id,source_api_job_id,idempotency_key,input_manifest,input_sha256,output_object_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'capacity-regeneration','{"provider":"FAL_Z_IMAGE","model":"fal-ai/z-image/turbo","prompt":"Documentary scene"}',$9,$10)`,
      [
        regen,
        a.a,
        a.w,
        IDS.projectA,
        IDS.revisionA,
        a.g,
        a.t,
        a.j,
        hash,
        `tenant/${a.a}/workspace/${a.w}/project/${IDS.projectA}/revision/${IDS.revisionA}/lane/mage-image/job/${regen}/artifact/${a.t}`,
      ],
    );
    await db.exec(
      "UPDATE provider_api_policies SET max_inflight=1,min_start_interval_ms=0 WHERE provider='FAL'; INSERT INTO provider_api_policies(provider,max_inflight,min_start_interval_ms) VALUES('FAL:fal-extra',1,0); INSERT INTO provider_accounts VALUES('fal-extra','FAL','v1','FAL:fal-extra',true,false,true,'-infinity')",
    );
    assert.equal((await claim(avatar, ["fal-legacy"])).state, "SUBMITTING");
    await scope(a.a);
    const regenSubmitted = (
      await db.query(
        "SELECT videoforge_claim_hosted_api_image_regeneration_v2($1,$2,$3::text[]) AS value",
        [regen, regenClaim, ["fal-legacy", "fal-extra"]],
      )
    ).rows[0].value;
    assert.equal(regenSubmitted.state, "SUBMITTING");
    assert.equal(regenSubmitted.providerAccount.id, "fal-extra");
    assert.equal(
      (
        await db.query("SELECT videoforge_load_hosted_api_image_regeneration_v2($1,$2) AS value", [
          regen,
          a.w,
        ])
      ).rows[0].value.providerAccount.id,
      "fal-extra",
    );
    await assert.rejects(
      db.query("SELECT videoforge_load_hosted_api_image_regeneration($1,$2)", [regen, a.w]),
      /ROUTING_VERSION_REQUIRED/,
    );
    await db.query("SELECT videoforge_mark_hosted_api_image_regeneration_unknown($1,$2)", [
      regen,
      regenClaim,
    ]);
    assert.deepEqual(
      (await db.query("SELECT videoforge_read_pending_hosted_api_image_regenerations() AS value"))
        .rows[0].value,
      [],
      "unknown regen is never automatically driven",
    );
    assert.equal(
      (await db.query("SELECT videoforge_provider_api_active_count('FAL:fal-extra') AS value"))
        .rows[0].value,
      1,
    );
    await assert.rejects(
      db.query("SELECT videoforge_defer_hosted_api_image_regeneration($1,$2,2000)", [
        regen,
        regenClaim,
      ]),
      /defer claim invalid/,
    );
    await db.exec("SET ROLE videoforge_v209_runtime_dc9612d6");
    assert.equal(
      (await read(b)).jobs.find((job) => job.id === b.j).providerAccount.id,
      "kie-legacy",
    );
    await scope(a.a);
    assert.equal(
      (
        await db.query("SELECT videoforge_read_hosted_api_jobs_v2($1,$2,$3) AS value", [
          a.a,
          b.w,
          b.g,
        ])
      ).rows[0].value,
      null,
    );
    for (const table of [
      "provider_accounts",
      "provider_submission_attempt_accounts",
      "provider_task_routes",
      "generation_provider_preferences",
    ])
      await assert.rejects(db.query("SELECT * FROM " + table), (e) => e.code === "42501");
    await assert.rejects(
      db.query("SELECT videoforge_provider_api_active_count('KIE')"),
      (e) => e.code === "42501",
    );
    await scope(a.a);
    assert.deepEqual(
      (await db.query("SELECT videoforge_read_pending_hosted_api_image_regenerations() AS value"))
        .rows[0].value,
      [],
    );
    await db.exec("RESET ROLE");
    await seed(
      "hosted_api_image_regeneration_jobs",
      "UPDATE hosted_api_image_regeneration_jobs SET state='SUBMITTED',provider_task_id='pending-account-proof' WHERE id=$1",
      [regen],
    );
    await db.exec("SET ROLE videoforge_v209_runtime_dc9612d6");
    assert.deepEqual(
      (await db.query("SELECT videoforge_read_pending_hosted_api_image_regenerations() AS value"))
        .rows[0].value,
      [{ id: regen, accountId: a.a, workspaceId: a.w }],
    );
    await scope(b.a);
    assert.deepEqual(
      (await db.query("SELECT videoforge_read_pending_hosted_api_image_regenerations() AS value"))
        .rows[0].value,
      [],
      "pending driver excludes other tenant",
    );
    await db.exec("RESET ROLE");
  } finally {
    await db.close();
  }
});

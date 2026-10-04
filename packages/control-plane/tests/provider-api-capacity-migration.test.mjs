import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createFixtureDatabase, applyMigrationSliceThrough } from "./support/pglite.mjs";
import { IDS, seedLockedProjects } from "./support/fixtures.mjs";
const source = readFileSync(
  new URL("../migrations/0259_provider_api_capacity.sql", import.meta.url),
  "utf8",
);
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = "sha256:" + "a".repeat(64);

test("0259 final claims enforce shared capacity, fair waiting, immutable confirmed rejection and unknown no replay", async () => {
  const { database: db, executor, sources } = await createFixtureDatabase();
  try {
    await applyMigrationSliceThrough(executor, 257, sources);
    await db.exec("SET ROLE videoforge_v209_runtime_dc9612d6");
    await assert.rejects(executor.execute(source), /BYPASSRLS or superuser migration owner/);
    await db.exec("RESET ROLE");
    await executor.execute(source);
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
      259100,
    );
    const b = await add(
      IDS.accountB,
      IDS.workspaceB,
      IDS.projectB,
      IDS.revisionB,
      IDS.userB,
      259200,
    );

    const claim = async (s) => {
      await scope(s.a);
      return (
        await db.query("SELECT videoforge_claim_hosted_api_job($1,$2,$3,$4,$5) AS value", [
          s.a,
          s.w,
          s.g,
          s.t,
          s.claim,
        ])
      ).rows[0].value;
    };
    await db.exec(
      "UPDATE provider_api_policies SET max_inflight=1,min_start_interval_ms=0 WHERE provider='KIE'",
    );
    assert.equal((await claim(a)).state, "SUBMITTING");
    assert.equal((await claim(a)).claimId, a.claim, "same claim cannot create another admission");
    assert.equal((await claim(b)).state, "PREPARED");
    await scope(a.a);
    await db.query("UPDATE hosted_api_generation_jobs SET state='UNKNOWN_NO_RETRY' WHERE id=$1", [
      a.j,
    ]);
    assert.equal((await claim(b)).state, "PREPARED", "unknown occupies capacity without expiry");
    await scope(a.a);
    await assert.rejects(
      db.query("SELECT videoforge_defer_hosted_api_job($1,$2,$3,$4,$5,1000)", [
        a.a,
        a.w,
        a.g,
        a.t,
        a.claim,
      ]),
      /defer claim invalid/,
    );
    await db.query(
      "UPDATE hosted_api_generation_jobs SET state='FAILED',failure_code='TEST_CONFIRMED_FAILURE' WHERE id=$1",
      [a.j],
    );
    await seed(
      "generation_requests",
      "UPDATE generation_requests SET state='FAILED',terminal_at=now() WHERE id=$1",
      [a.g],
    );
    const a2 = await add(
      IDS.accountA,
      IDS.workspaceA,
      IDS.projectA,
      IDS.revisionA,
      IDS.userA,
      259300,
    );
    assert.equal(
      (await claim(a2)).state,
      "PREPARED",
      "new accountA work cannot jump queued accountB",
    );
    assert.equal((await claim(b)).state, "SUBMITTING");
    await assert.rejects(
      db.query("SELECT videoforge_defer_hosted_api_job($1,$2,$3,$4,$5,5000)", [
        b.a,
        b.w,
        b.g,
        b.t,
        id(259999),
      ]),
      /defer claim invalid/,
    );
    const deferred = (
      await db.query("SELECT videoforge_defer_hosted_api_job($1,$2,$3,$4,$5,5000) AS value", [
        b.a,
        b.w,
        b.g,
        b.t,
        b.claim,
      ])
    ).rows[0].value;
    assert.equal(deferred.state, "PREPARED");
    assert.equal(deferred.claimId, null);
    assert.equal((await claim(a2)).state, "PREPARED", "confirmed429 cooldown is shared");
    assert.equal(
      (await db.query("SELECT count(*)::integer AS n FROM provider_api_rejections")).rows[0].n,
      1,
    );
    await assert.rejects(db.exec("DELETE FROM provider_api_rejections"), /immutable/);
    assert.equal(
      (
        await db.query(
          "SELECT cooldown_until>=clock_timestamp()+interval '4 seconds' AS valid FROM provider_api_policies WHERE provider='KIE'",
        )
      ).rows[0].valid,
      true,
    );
    await assert.rejects(
      db.query("SELECT videoforge_defer_hosted_api_job($1,$2,$3,$4,$5,5000)", [
        b.a,
        b.w,
        b.g,
        b.t,
        b.claim,
      ]),
      /scope invalid/,
    );
    await db.exec(
      "UPDATE provider_api_policies SET cooldown_until='-infinity',next_start_at='-infinity' WHERE provider='KIE'",
    );
    // A cancelled queued owner is removed before selecting the next waiter.
    await seed(
      "generation_requests",
      "UPDATE generation_requests SET state='CANCELLED',terminal_at=now() WHERE id=$1",
      [a2.g],
    );
    assert.equal((await claim({ ...b, claim: id(259998) })).state, "SUBMITTING");
    assert.equal(
      (
        await db.query("SELECT count(*)::integer AS n FROM provider_api_waiters WHERE job_id=$1", [
          a2.j,
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
      "UPDATE provider_api_policies SET max_inflight=1,min_start_interval_ms=0 WHERE provider='FAL'",
    );
    assert.equal((await claim(avatar)).state, "SUBMITTING");
    await scope(a.a);
    assert.equal(
      (
        await db.query("SELECT videoforge_claim_hosted_api_image_regeneration($1,$2) AS value", [
          regen,
          regenClaim,
        ])
      ).rows[0].value.state,
      "PREPARED",
    );
    await scope(b.a);
    await db.query(
      "UPDATE hosted_api_generation_jobs SET state='FAILED',failure_code='TEST_CONFIRMED_FAILURE' WHERE id=$1",
      [avatar.j],
    );
    await scope(a.a);
    const regenSubmitted = (
      await db.query("SELECT videoforge_claim_hosted_api_image_regeneration($1,$2) AS value", [
        regen,
        regenClaim,
      ])
    ).rows[0].value;
    assert.equal(regenSubmitted.state, "SUBMITTING");
    assert.equal(
      (await db.query("SELECT videoforge_provider_api_active_count('FAL') AS n")).rows[0].n,
      1,
    );
    const oldLease = (
      await db.query("SELECT lease_id FROM hosted_api_image_regeneration_jobs WHERE id=$1", [regen])
    ).rows[0].lease_id;
    assert.equal(
      (
        await db.query(
          "SELECT videoforge_defer_hosted_api_image_regeneration($1,$2,2000) AS value",
          [regen, regenClaim],
        )
      ).rows[0].value.state,
      "PREPARED",
    );
    assert.equal(
      (await db.query("SELECT state FROM provider_workload_leases WHERE id=$1", [oldLease])).rows[0]
        .state,
      "RELEASED",
    );
    await db.exec(
      "UPDATE provider_api_policies SET next_start_at='-infinity',cooldown_until='-infinity' WHERE provider='FAL'",
    );
    const nextRegenClaim = id(264102);
    assert.equal(
      (
        await db.query("SELECT videoforge_claim_hosted_api_image_regeneration($1,$2) AS value", [
          regen,
          nextRegenClaim,
        ])
      ).rows[0].value.state,
      "SUBMITTING",
    );
    assert.notEqual(
      (
        await db.query("SELECT lease_id FROM hosted_api_image_regeneration_jobs WHERE id=$1", [
          regen,
        ])
      ).rows[0].lease_id,
      oldLease,
    );
    await db.query("SELECT videoforge_mark_hosted_api_image_regeneration_unknown($1,$2)", [
      regen,
      nextRegenClaim,
    ]);
    assert.equal(
      (await db.query("SELECT videoforge_provider_api_active_count('FAL') AS n")).rows[0].n,
      1,
    );
    // Ten distinct tenant accounts share the same authoritative cap; reverse wake order
    // cannot let the newest waiter jump the first eligible queued tenant.
    await scope(b.a);
    await db.query(
      "UPDATE hosted_api_generation_jobs SET state='FAILED',failure_code='TEST_CONFIRMED_FAILURE' WHERE id=$1",
      [b.j],
    );
    await db.exec(
      "UPDATE provider_api_policies SET max_inflight=3,min_start_interval_ms=0,cooldown_until='-infinity',next_start_at='-infinity' WHERE provider='KIE'",
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
      assert.equal((await claim(tenants[n])).state, n < 3 ? "SUBMITTING" : "PREPARED");
    assert.equal(
      (await db.query("SELECT videoforge_provider_api_active_count('KIE') AS n")).rows[0].n,
      3,
    );
    await scope(tenants[0].a);
    await db.query(
      "UPDATE hosted_api_generation_jobs SET state='FAILED',failure_code='TEST_CONFIRMED_FAILURE' WHERE id=$1",
      [tenants[0].j],
    );
    assert.equal((await claim(tenants[9])).state, "PREPARED");
    assert.equal((await claim(tenants[3])).state, "SUBMITTING");
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
      (await claim(tenants[5])).state,
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
    await scope(a.a);
    await db.query(
      "UPDATE hosted_api_image_regeneration_jobs SET updated_at=clock_timestamp()-interval '1 day' WHERE id=$1",
      [regen],
    );
    assert.equal(
      (await db.query("SELECT videoforge_provider_api_active_count('FAL') AS n")).rows[0].n,
      1,
      "paid unknown capacity never expires with waiter freshness",
    );
    for (const table of [
      "provider_api_policies",
      "provider_api_waiters",
      "provider_api_account_turns",
      "provider_api_rejections",
    ]) {
      assert.equal(
        (
          await db.query(
            "SELECT has_table_privilege('videoforge_v209_runtime_dc9612d6',$1,'SELECT') AS allowed",
            [table],
          )
        ).rows[0].allowed,
        false,
      );
      assert.equal(
        (
          await db.query(
            "SELECT has_table_privilege('videoforge_v209_runtime_dc9612d6',$1,'INSERT') AS allowed",
            [table],
          )
        ).rows[0].allowed,
        false,
      );
    }
    assert.equal(
      (
        await db.query(
          "SELECT has_function_privilege('videoforge_v209_runtime_dc9612d6','videoforge_try_acquire_provider_api(text,uuid,text,uuid)','EXECUTE') AS allowed",
        )
      ).rows[0].allowed,
      false,
    );
    await db.exec("UPDATE provider_api_policies SET max_inflight=100 WHERE provider='KIE'");
    await db.exec("SET ROLE videoforge_v209_runtime_dc9612d6");
    await scope(tenants[6].a);
    await assert.rejects(db.exec("SELECT * FROM provider_api_policies"), /permission denied/);
    await assert.rejects(
      db.query("SELECT videoforge_try_acquire_provider_api('KIE',$1,'API',$2)", [
        tenants[6].a,
        tenants[6].j,
      ]),
      /permission denied/,
    );
    assert.equal(
      (
        await db.query("SELECT videoforge_claim_hosted_api_job($1,$2,$3,$4,$5) AS value", [
          tenants[6].a,
          tenants[6].w,
          tenants[6].g,
          tenants[6].t,
          id(259997),
        ])
      ).rows[0].value.state,
      "SUBMITTING",
      "trusted runtime fresh claim acquires the shared gate through forced RLS",
    );
    await db.exec("RESET ROLE");
  } finally {
    await db.close();
  }
});

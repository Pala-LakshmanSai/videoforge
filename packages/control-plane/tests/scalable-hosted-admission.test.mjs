import assert from "node:assert/strict";
import test from "node:test";
import { withMigratedDatabase, uuid, sha256 } from "./support/pglite.mjs";
import { seedFairAccount } from "./support/fair-account.mjs";

test("hosted SQL admits ten independent Cloud videos and rentals; same account still queues", async () => {
  await withMigratedDatabase(async ({ executor: db }) => {
    const hash = sha256("cloud-runtime");
    const admit = async (a) => {
      await db.query("SELECT set_config('videoforge.account_id',$1,false)", [a.accountId]);
      return (
        await db.query("SELECT videoforge_admit_hosted_v209_generation($1,$2,$3,$4) value", [
          a.accountId,
          a.workspaceId,
          a.userId,
          a.projectId,
        ])
      ).rows[0].value;
    };
    async function project(a, index) {
      const p = {
        ...a,
        projectId: uuid(270000 + index * 10),
        revisionId: uuid(270001 + index * 10),
        attemptId: uuid(270002 + index * 10),
      };
      await db.query(
        `INSERT INTO projects(id,workspace_id,owner_user_id,name,normalized_name,generation_provider) VALUES($1,$2,$3,$4,$4,'KIE_FAL')`,
        [p.projectId, a.workspaceId, a.userId, "cloud " + index],
      );
      await db.query(
        `INSERT INTO project_revisions SELECT(jsonb_populate_record(NULL::project_revisions,to_jsonb(r)||jsonb_build_object('id',$1::text,'project_id',$2::text,'media_execution_backend','RUNPOD_POD','created_at',now(),'locked_at',now()))).* FROM project_revisions r WHERE id=$3`,
        [p.revisionId, p.projectId, a.revisionId],
      );
      const prefix = `tenant/${a.accountId}/workspace/${a.workspaceId}/project/${p.projectId}/revision/${p.revisionId}/lane/input/job/${p.attemptId}/artifact`;
      await db.query(
        `INSERT INTO hosted_cpu_job_attempts(id,account_id,workspace_id,project_id,project_revision_id,kind,state,execution_backend,execution_bundle_sha256,request_sha256,job_spec_object_key,job_spec_content_length,job_spec_checksum_sha256,result_object_key,image_digest,callback_token_sha256,deadline_at) VALUES($1,$2,$3,$4,$5,'ASR','OUTBOXED','RUNPOD_POD',$6,$6,$7,100,$6,$8,$6,$6,now()+interval '1 hour')`,
        [
          p.attemptId,
          a.accountId,
          a.workspaceId,
          p.projectId,
          p.revisionId,
          hash,
          prefix + "/spec",
          prefix + "/result",
        ],
      );
      return p;
    }
    for (let i = 1; i <= 10; i++) {
      await db.query("SELECT set_config('videoforge.account_id','',false)");
      const a = await seedFairAccount(db, 200 + i),
        p = await project(a, i);
      assert.equal((await admit(p)).state, "ACTIVE");
      // Leave each account's second video ahead of the next account in the global queue.
      const second = await project(a, 100 + i);
      assert.equal((await admit(second)).state, "WAITING");
      const authority = uuid(280000 + i),
        rental = uuid(281000 + i);
      await db.query(
        `INSERT INTO cloud_media_budget_authorities(id,allowed_account_ids,allowed_project_ids,total_cap_usd,max_reservation_usd,max_hourly_usd,max_rental_seconds,image,source_sha256,runtime_sha256,expires_at,allow_new_cloud_projects,max_reservations) VALUES($1,ARRAY[$2::uuid],ARRAY[$3::uuid],1,.2,.8,7200,$4,$5,$5,now()+interval '1 hour',true,5)`,
        [authority, a.accountId, p.projectId, "registry/example@" + hash, hash],
      );
      await db.query(
        `INSERT INTO cloud_media_reservations(id,account_id,workspace_id,budget_authority_id,project_id,project_revision_id,attempt_id,leased_attempt_id,fence_id,capability_sha256,pod_name,image,source_sha256,runtime_sha256,tooling,disk_gb,max_hourly_usd,budget_usd,rental_seconds,state,placement_deadline_at) VALUES($1::uuid,$2,$3,$4,$5,$6,$7,$7,$1,$8,'videoforge-media-'||$1::text,$9,$8,$8,'{}',100,.8,.2,900,'WAITING_CAPACITY',now()+interval '180 seconds')`,
        [
          rental,
          a.accountId,
          a.workspaceId,
          authority,
          p.projectId,
          p.revisionId,
          p.attemptId,
          hash,
          "registry/example@" + hash,
        ],
      );
      await db.query(
        "INSERT INTO cloud_media_jobs(account_id,workspace_id,reservation_id,attempt_id,claim_ordinal) VALUES($1,$2,$3,$4,1)",
        [a.accountId, a.workspaceId, rental, p.attemptId],
      );
      assert.equal(
        (await db.query("SELECT videoforge_cloud_media_reserve_budget($1) ok", [rental])).rows[0]
          .ok,
        true,
      );
      await db.query("UPDATE cloud_media_reservations SET state='CREATING' WHERE id=$1", [rental]);
    }
    assert.deepEqual(
      (
        await db.query(
          "SELECT count(*)::int active,count(DISTINCT account_id)::int accounts FROM provider_workload_leases WHERE state='ACTIVE'",
        )
      ).rows[0],
      { active: 10, accounts: 10 },
    );
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int n FROM cloud_media_reservations WHERE state='CREATING'",
        )
      ).rows[0].n,
      10,
    );
  });
});

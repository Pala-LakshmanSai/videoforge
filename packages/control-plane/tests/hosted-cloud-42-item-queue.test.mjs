import assert from "node:assert/strict";
import test from "node:test";
import { withMigratedDatabase, uuid, sha256 } from "./support/pglite.mjs";
import { FairAdmissionRepository } from "../dist/src/index.js";
import { seedFairAccount } from "./support/fair-account.mjs";

test("Cloud queue admits seven accounts with six pending videos each and resumes exact identities", async () => {
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
    const groups = [];
    for (let account = 0; account < 7; account++) {
      await db.query("SELECT set_config('videoforge.account_id','',false)");
      const a = await seedFairAccount(db, 500 + account),
        items = [];
      for (let item = 0; item < 6; item++) {
        const p = await project(a, 1000 + account * 6 + item);
        const admission = await admit(p);
        assert.equal(admission.state, item === 0 ? "ACTIVE" : "WAITING");
        items.push(p);
      }
      groups.push(items);
    }
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int n FROM hosted_cpu_job_attempts WHERE execution_backend='RUNPOD_POD' AND state='OUTBOXED'",
        )
      ).rows[0].n,
      42,
    );
    assert.equal(
      (await db.query("SELECT count(*)::int n FROM provider_workload_leases WHERE state='ACTIVE'"))
        .rows[0].n,
      7,
    );
    // Observer/process restart calls the same durable request, rather than enqueuing a replacement.
    for (const items of groups) assert.equal((await admit(items[0])).state, "ACTIVE");
    const repo = new FairAdmissionRepository(db);
    for (let ordinal = 0; ordinal < 6; ordinal++)
      for (const items of groups) {
        const current = items[ordinal];
        assert.equal((await admit(current)).state, "ACTIVE");
        const lease = (
          await db.query(
            "SELECT * FROM provider_workload_leases WHERE state='ACTIVE' AND account_id=$1",
            [current.accountId],
          )
        ).rows[0];
        await repo.settleAndPromote({
          leaseId: lease.id,
          ownerTokenSha256: lease.owner_token_sha256,
          expectedLeaseVersion: lease.version,
          terminalState: ordinal === 2 ? "CANCELLED" : "SUCCEEDED",
          auditId: uuid(900000 + ordinal * 7 + groups.indexOf(items)),
          now: new Date().toISOString(),
        });
        if (ordinal < 5) {
          // Try the newest first: durable FIFO blocks overtaking after terminal release.
          if (ordinal < 4) assert.equal((await admit(items[5])).state, "WAITING");
          assert.equal((await admit(items[ordinal + 1])).state, "ACTIVE");
        }
      }
    assert.equal(
      (await db.query("SELECT count(*)::int n FROM provider_workload_leases WHERE state='ACTIVE'"))
        .rows[0].n,
      0,
    );
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int n FROM generation_requests WHERE state IN('SUCCEEDED','CANCELLED')",
        )
      ).rows[0].n,
      42,
    );
    // No artifact approval rows are created: terminal release and next admission are independent of final approval.
  });
});

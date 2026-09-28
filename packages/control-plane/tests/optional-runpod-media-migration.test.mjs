import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { loadMigrationSources, PGliteExecutor } from "./support/pglite.mjs";
const source = readFileSync(new URL("../migrations/0214_optional_runpod_media.sql", import.meta.url), "utf8");
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = `sha256:${"a".repeat(64)}`;

test("0214 applies against reviewed prior function preimages without replaying omitted migrations", async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  try {
    await db.exec("CREATE EXTENSION pgcrypto");
    const executor = new PGliteExecutor(db);
    for (const migration of (await loadMigrationSources()).filter(row => row.version < 214)) {
      // This grant-only migration depends on omitted deployment-owned continuation objects.
      // Their production identities are a rollout gate; they are not fabricated or replayed here.
      if (migration.version === 195) continue;
      await executor.execute(migration.sql);
    }
    await executor.execute(source);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM cloud_media_budget_authorities")).rows[0].n, 0);
    assert.equal((await db.query("SELECT has_table_privilege('videoforge_v209_runtime_dc9612d6','cloud_media_budget_authorities','INSERT') AS allowed")).rows[0].allowed, false);
    assert.equal((await db.query("SELECT has_function_privilege('videoforge_v209_runtime_dc9612d6','videoforge_cloud_media_reserve_budget(uuid)','EXECUTE') AS allowed")).rows[0].allowed, true);
  } finally { await db.close(); }
});

test("durable approval debit is idempotent, finite, release-bound and never automatically refunded", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE videoforge_v209_runtime_dc9612d6;
      CREATE FUNCTION videoforge_current_account_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT '${id(1)}'::uuid $$;
      ${source.slice(source.indexOf("CREATE TABLE cloud_media_budget_authorities"), source.indexOf("CREATE TABLE cloud_media_reservations"))}
      CREATE TABLE cloud_media_reservations(id uuid PRIMARY KEY,account_id uuid,project_id uuid,budget_authority_id uuid,
        state text,image text,source_sha256 text,runtime_sha256 text,budget_usd numeric,max_hourly_usd numeric,rental_seconds int);
      ${source.slice(source.indexOf("CREATE TABLE cloud_media_budget_debits"), source.indexOf("CREATE FUNCTION public.videoforge_guard_cloud_media_reservation"))}`);
    await db.query(`INSERT INTO cloud_media_budget_authorities(id,allowed_account_ids,allowed_project_ids,total_cap_usd,max_reservation_usd,max_hourly_usd,max_rental_seconds,image,source_sha256,runtime_sha256,expires_at)
      VALUES($1,ARRAY['${id(1)}'::uuid],ARRAY['${id(8)}'::uuid],3,2,1,7200,$2,$3,$3,now()+interval '1 hour')`, [id(2), `repo@${hash}`, hash]);
    const reserve = async (n, account = id(1), image = `repo@${hash}`, project = id(8)) => {
      await db.query(`INSERT INTO cloud_media_reservations VALUES($1,$2,$6,$3,'WAITING_CAPACITY',$4,$5,$5,2,1,7200)`, [id(n), account, id(2), image, hash, project]);
      return db.query("SELECT videoforge_cloud_media_reserve_budget($1)", [id(n)]);
    };
    await reserve(3);
    await db.query("SELECT videoforge_cloud_media_reserve_budget($1)", [id(3)]);
    assert.equal((await db.query("SELECT debited_usd::text AS amount FROM cloud_media_budget_authorities")).rows[0].amount, "2.000000");
    await assert.rejects(reserve(4), /finite budget exhausted/);
    await db.query("UPDATE cloud_media_reservations SET state='CLEAN' WHERE id=$1", [id(3)]);
    await assert.rejects(reserve(5), /finite budget exhausted/);
    await assert.rejects(reserve(6, id(99)), /tenant rejected/);
    await assert.rejects(reserve(7, id(1), `repo@sha256:${"b".repeat(64)}`), /approved finite budget unavailable/);
    await assert.rejects(reserve(10, id(1), `repo@${hash}`, id(99)), /approved finite budget unavailable/);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM cloud_media_budget_debits")).rows[0].n, 1);
  } finally { await db.close(); }
});

test("immutable backends inherit on successor revisions and require exact Cloud render recovery proof", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE project_revisions(id uuid PRIMARY KEY,workspace_id uuid,project_id uuid,revision_number int,
      media_execution_backend text NOT NULL DEFAULT 'PERSONAL_WORKER');
      CREATE TABLE hosted_cpu_job_attempts(id uuid PRIMARY KEY,account_id uuid,workspace_id uuid,project_id uuid,
        project_revision_id uuid,kind text,execution_backend text,execution_bundle_sha256 text,image_digest text,
        request_sha256 text,submission_idempotency_key text);
      CREATE TABLE cloud_media_render_recoveries(retry_attempt_id uuid,account_id uuid,workspace_id uuid,project_id uuid,
        project_revision_id uuid,state text,replacement_bundle_sha256 text);
      ${source.slice(source.indexOf("CREATE FUNCTION public.videoforge_guard_media_backend_lineage"), source.indexOf("-- Unconfirmed cleanup"))}`);
    await db.query("INSERT INTO project_revisions VALUES($1,$2,$3,1,'RUNPOD_POD')", [id(1),id(2),id(3)]);
    await db.query("INSERT INTO project_revisions VALUES($1,$2,$3,2,'PERSONAL_WORKER')", [id(4),id(2),id(3)]);
    assert.equal((await db.query("SELECT media_execution_backend AS backend FROM project_revisions WHERE id=$1",[id(4)])).rows[0].backend,"RUNPOD_POD");
    await assert.rejects(db.query("UPDATE project_revisions SET media_execution_backend='PERSONAL_WORKER' WHERE id=$1",[id(1)]),/immutable/);
    await db.query("INSERT INTO project_revisions VALUES($1,$2,$3,1,'PERSONAL_WORKER')",[id(5),id(2),id(6)]);
    const insert = () => db.query(`INSERT INTO hosted_cpu_job_attempts VALUES($1,$2,$3,$4,$5,'RENDER','RUNPOD_POD',$6,$6,$6,$7)`,
      [id(7),id(8),id(2),id(6),id(5),hash,`render-cloud-recovery:${id(7)}`]);
    await assert.rejects(insert(),/recovery authority/);
    await db.query("INSERT INTO cloud_media_render_recoveries VALUES($1,$2,$3,$4,$5,'CONSUMED',$6)",[id(7),id(8),id(2),id(6),id(5),hash]);
    await insert();
    await assert.rejects(db.query("UPDATE hosted_cpu_job_attempts SET execution_backend='PERSONAL_WORKER' WHERE id=$1",[id(7)]),/identity is immutable/);
    await assert.rejects(db.query("UPDATE hosted_cpu_job_attempts SET execution_bundle_sha256=$2 WHERE id=$1",[id(7),`sha256:${"b".repeat(64)}`]),/identity is immutable/);
  } finally { await db.close(); }
});

test("ready cloud spans reuse one fixed reservation with fenced ordinal replay and four-job ceiling", async () => {
  const db = new PGlite();
  try {
    const helperStart = source.indexOf("ALTER TABLE cloud_media_jobs ADD COLUMN claim_ordinal");
    const helperEnd = source.indexOf(" TO videoforge_v209_runtime_dc9612d6;", helperStart) + " TO videoforge_v209_runtime_dc9612d6;".length;
    await db.exec(`CREATE ROLE videoforge_v209_runtime_dc9612d6;
      CREATE FUNCTION videoforge_current_account_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT '${id(1)}'::uuid $$;
      CREATE TABLE cloud_media_reservations(id uuid PRIMARY KEY,account_id uuid,workspace_id uuid,project_id uuid,
        project_revision_id uuid,attempt_id uuid,leased_attempt_id uuid,span_job_count int,source_sha256 text,
        state text,verified_at timestamptz,pod_id text,deadline_at timestamptz,disk_gb int,updated_at timestamptz,last_heartbeat_at timestamptz);
      CREATE TABLE hosted_cpu_job_attempts(id uuid PRIMARY KEY,account_id uuid,workspace_id uuid,project_id uuid,
        project_revision_id uuid,kind text,execution_backend text,state text,terminal_at timestamptz,
        result_receipt_sha256 text,image_digest text,execution_bundle_sha256 text,deadline_at timestamptz,
        job_spec_content_length int,job_spec_checksum_sha256 text,created_at timestamptz,submitted_at timestamptz,
        version int DEFAULT 1,updated_at timestamptz);
      CREATE TABLE cloud_media_jobs(account_id uuid,workspace_id uuid,reservation_id uuid,attempt_id uuid UNIQUE);
      CREATE TABLE media_worker_leases(attempt_id uuid,state text);
      CREATE TABLE project_revisions(id uuid,account_id uuid,workspace_id uuid,voiceover_asset_id uuid);
      CREATE TABLE assets(id uuid,account_id uuid,workspace_id uuid,duration_ms bigint);
      CREATE TABLE generation_requests(id uuid,account_id uuid,workspace_id uuid,project_id uuid,project_revision_id uuid,state text);
      CREATE TABLE provider_workload_leases(generation_request_id uuid,state text,expires_at timestamptz);
      CREATE TABLE media_worker_input_objects(attempt_id uuid,account_id uuid,workspace_id uuid,content_length bigint);
      ${source.slice(helperStart, helperEnd)}`);
    await db.query(`INSERT INTO cloud_media_reservations VALUES($1,$2,$3,$4,$5,$6,$6,1,$7,'SAVING',now(),'owned-pod',now()+interval '1 hour',100,now(),now())`,
      [id(10),id(1),id(2),id(3),id(4),id(20),hash]);
    await db.query("INSERT INTO project_revisions VALUES($1,$2,$3,$4)",[id(4),id(1),id(2),id(5)]);
    await db.query("INSERT INTO assets VALUES($1,$2,$3,60000)",[id(5),id(1),id(2)]);
    await db.query("INSERT INTO generation_requests VALUES($1,$2,$3,$4,$5,'ACTIVE')",[id(6),id(1),id(2),id(3),id(4)]);
    await db.query("INSERT INTO provider_workload_leases VALUES($1,'ACTIVE',now()+interval '1 hour')",[id(6)]);
    const attempt = async (n, {account=id(1),backend="RUNPOD_POD",state="OUTBOXED",bundle=hash,bytes=128}={}) => {
      await db.query(`INSERT INTO hosted_cpu_job_attempts(id,account_id,workspace_id,project_id,project_revision_id,
        kind,execution_backend,state,terminal_at,result_receipt_sha256,image_digest,execution_bundle_sha256,
        deadline_at,job_spec_content_length,job_spec_checksum_sha256,created_at)
        VALUES($1,$2,$3,$4,$5,'SPAN_AUDIO',$6,$7,CASE WHEN $7='SUCCEEDED' THEN now() END,
          CASE WHEN $7='SUCCEEDED' THEN $8 END,$9,$9,now()+interval '1 hour',100,$8,now())`,
        [id(n),account,id(2),id(3),id(4),backend,state,hash,bundle]);
      await db.query("INSERT INTO media_worker_input_objects VALUES($1,$2,$3,$4)",[id(n),account,id(2),bytes]);
    };
    await attempt(20,{state:"SUCCEEDED"});
    await db.query("INSERT INTO cloud_media_jobs VALUES($1,$2,$3,$4,1)",[id(1),id(2),id(10),id(20)]);
    await attempt(21,{account:id(99)});
    await attempt(22,{backend:"PERSONAL_WORKER"});
    await attempt(23,{bundle:`sha256:${"b".repeat(64)}`});
    await attempt(24);
    await db.query("INSERT INTO media_worker_leases VALUES($1,'RUNNING')",[id(24)]);
    await attempt(25,{bytes:30_000_000_000});
    for (const n of [26,27,28,29]) await attempt(n);
    const claim = async (completed,count) => (await db.query("SELECT videoforge_claim_cloud_media_span($1,$2,$3) AS next",[id(10),id(completed),count])).rows[0].next;
    assert.equal(await claim(20,1),id(26));
    assert.equal(await claim(20,1),id(26));
    await assert.rejects(claim(20,2),/completed receipt rejected/);
    for (const [completed,count,expected] of [[26,2,27],[27,3,28]]) {
      await db.query("UPDATE hosted_cpu_job_attempts SET state='SUCCEEDED',terminal_at=now(),result_receipt_sha256=$2 WHERE id=$1",[id(completed),hash]);
      assert.equal(await claim(completed,count),id(expected));
    }
    await assert.rejects(claim(20,1),/ordinal stale/);
    await db.query("UPDATE hosted_cpu_job_attempts SET state='SUCCEEDED',terminal_at=now(),result_receipt_sha256=$2 WHERE id=$1",[id(28),hash]);
    assert.equal(await claim(28,4),null);
    const reservation = (await db.query("SELECT disk_gb,span_job_count,attempt_id,deadline_at FROM cloud_media_reservations WHERE id=$1",[id(10)])).rows[0];
    assert.equal(reservation.span_job_count,4);
    assert.equal(reservation.disk_gb,100);
    assert.equal(reservation.attempt_id,id(20));
    assert.equal((await db.query("SELECT count(*)::int AS n FROM cloud_media_jobs")).rows[0].n,4);
    assert.equal((await db.query("SELECT state FROM hosted_cpu_job_attempts WHERE id=$1",[id(29)])).rows[0].state,"OUTBOXED");
  } finally { await db.close(); }
});

async function failureFixture(kind, state = 'FAILED') {
  const db = new PGlite();
  await db.exec(`CREATE ROLE videoforge_v209_runtime_dc9612d6;
    CREATE FUNCTION videoforge_current_account_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT '${id(1)}'::uuid $$;
    CREATE TABLE hosted_cpu_job_attempts(id uuid PRIMARY KEY,account_id uuid,workspace_id uuid,project_id uuid,project_revision_id uuid,
      execution_backend text,kind text,state text,terminal_at timestamptz,submitted_at timestamptz,deadline_at timestamptz,
      retain_until timestamptz,cancellation_requested_at timestamptz,version int DEFAULT 1,updated_at timestamptz);
    CREATE TABLE generation_requests(id uuid PRIMARY KEY,account_id uuid,workspace_id uuid,project_id uuid,project_revision_id uuid,
      created_by_user_id uuid,state text,terminal_at timestamptz,version int DEFAULT 1,updated_at timestamptz,created_at timestamptz DEFAULT now());
    CREATE TABLE video_runtime_states(id uuid PRIMARY KEY,account_id uuid,workspace_id uuid,generation_request_id uuid,
      stage text,terminal_at timestamptz,terminal_reason text,version int DEFAULT 1,updated_at timestamptz);
    CREATE TABLE hosted_v209_span_audio_materializations(attempt_id uuid,account_id uuid,workspace_id uuid,project_id uuid,
      project_revision_id uuid,generation_request_id uuid,user_id uuid,task_id uuid);
    CREATE TABLE cloud_media_jobs(reservation_id uuid,attempt_id uuid);
    CREATE TABLE cloud_media_reservations(id uuid PRIMARY KEY,account_id uuid,workspace_id uuid,project_id uuid,
      project_revision_id uuid,state text,pod_id text,launch_outcome text,cleanup_verified_at timestamptz,
      failure_settled_at timestamptz,updated_at timestamptz);
    CREATE TABLE projects(id uuid PRIMARY KEY,account_id uuid,workspace_id uuid,owner_user_id uuid,generation_provider text);
    CREATE TABLE hosted_api_generation_jobs(id uuid PRIMARY KEY,generation_request_id uuid,generation_task_id uuid,state text);
    CREATE TABLE generation_tasks(id uuid PRIMARY KEY,account_id uuid,workspace_id uuid,state text,finished_at timestamptz,
      version int DEFAULT 1,updated_at timestamptz);
    CREATE TABLE video_runtime_lane_states(runtime_id uuid,lane text,state text,version int DEFAULT 1,updated_at timestamptz);
    CREATE TABLE provider_workload_leases(id uuid PRIMARY KEY,account_id uuid,workspace_id uuid,generation_request_id uuid,
      request_kind text,state text,released_at timestamptz,release_reason text,version int DEFAULT 1,heartbeat_at timestamptz,expires_at timestamptz);
    ${source.slice(source.indexOf('CREATE FUNCTION public.videoforge_settle_cloud_media_cpu_failure'), source.indexOf('CREATE OR REPLACE FUNCTION public.videoforge_cloud_media_reconciliation_scope'))}
    INSERT INTO projects VALUES('${id(3)}','${id(1)}','${id(2)}','${id(7)}','KIE_FAL');
    INSERT INTO generation_requests(id,account_id,workspace_id,project_id,project_revision_id,created_by_user_id,state)
      VALUES('${id(6)}','${id(1)}','${id(2)}','${id(3)}','${id(4)}','${id(7)}','ACTIVE');
    INSERT INTO hosted_cpu_job_attempts(id,account_id,workspace_id,project_id,project_revision_id,execution_backend,kind,state,terminal_at,submitted_at,deadline_at)
      VALUES('${id(5)}','${id(1)}','${id(2)}','${id(3)}','${id(4)}','RUNPOD_POD','${kind}','${state}',now(),now(),now()+interval '1 hour');
    INSERT INTO cloud_media_reservations(id,account_id,workspace_id,project_id,project_revision_id,state)
      VALUES('${id(8)}','${id(1)}','${id(2)}','${id(3)}','${id(4)}','CLEAN');
    INSERT INTO cloud_media_jobs VALUES('${id(8)}','${id(5)}');
    INSERT INTO provider_workload_leases(id,account_id,workspace_id,generation_request_id,request_kind,state,expires_at)
      VALUES('${id(9)}','${id(1)}','${id(2)}','${id(6)}','VIDEO','ACTIVE',now()+interval '10 minutes'),
      ('${id(99)}','${id(98)}','${id(97)}','${id(96)}','VIDEO','ACTIVE',now()+interval '10 minutes');`);
  return db;
}
const settleFailure = async db => (await db.query("SELECT videoforge_settle_cloud_media_cpu_failure($1) AS settled",[id(5)])).rows[0].settled;

test("early Cloud ASR failure and cancellation settle only its own admitted video after cleanup", async () => {
  for (const state of ['FAILED','CANCELLED']) {
    const db = await failureFixture('ASR',state);
    try {
      await db.query("UPDATE cloud_media_reservations SET state='AMBIGUOUS' WHERE id=$1",[id(8)]);
      assert.equal(await settleFailure(db),false);
      assert.equal((await db.query("SELECT state FROM provider_workload_leases WHERE id=$1",[id(9)])).rows[0].state,'ACTIVE');
      await db.query("UPDATE cloud_media_reservations SET state='CLEAN' WHERE id=$1",[id(8)]);
      assert.equal(await settleFailure(db),true);
      assert.equal(await settleFailure(db),true);
      assert.equal((await db.query("SELECT state FROM generation_requests WHERE id=$1",[id(6)])).rows[0].state,state);
      assert.equal((await db.query("SELECT state FROM provider_workload_leases WHERE id=$1",[id(9)])).rows[0].state,'RELEASED');
      assert.equal((await db.query("SELECT state FROM provider_workload_leases WHERE id=$1",[id(99)])).rows[0].state,'ACTIVE');
      assert.ok((await db.query("SELECT failure_settled_at FROM cloud_media_reservations WHERE id=$1",[id(8)])).rows[0].failure_settled_at);
    } finally {await db.close();}
  }
});

test("Cloud span failure waits for ambiguous paid API work and preserves accepted jobs and lanes", async () => {
  const db = await failureFixture('SPAN_AUDIO');
  try {
    await db.exec(`INSERT INTO hosted_v209_span_audio_materializations VALUES('${id(5)}','${id(1)}','${id(2)}','${id(3)}','${id(4)}','${id(6)}','${id(7)}','${id(12)}');
      INSERT INTO video_runtime_states(id,account_id,workspace_id,generation_request_id,stage) VALUES('${id(10)}','${id(1)}','${id(2)}','${id(6)}','WAITING_FOR_WORKER');
      INSERT INTO generation_tasks(id,account_id,workspace_id,state) VALUES('${id(12)}','${id(1)}','${id(2)}','BLOCKED'),('${id(13)}','${id(1)}','${id(2)}','COMPLETE');
      INSERT INTO hosted_api_generation_jobs VALUES('${id(14)}','${id(6)}','${id(13)}','SUCCEEDED'),('${id(15)}','${id(6)}',NULL,'UNKNOWN_NO_RETRY');
      INSERT INTO video_runtime_lane_states(runtime_id,lane,state) VALUES('${id(10)}','mage_image','SUCCEEDED'),('${id(10)}','soulx_avatar','GENERATING');`);
    assert.equal(await settleFailure(db),false);
    assert.equal((await db.query("SELECT state FROM provider_workload_leases WHERE id=$1",[id(9)])).rows[0].state,'ACTIVE');
    assert.equal((await db.query("SELECT stage FROM video_runtime_states")).rows[0].stage,'WAITING_FOR_WORKER');
    await db.query("UPDATE hosted_api_generation_jobs SET state='FAILED' WHERE id=$1",[id(15)]);
    assert.equal(await settleFailure(db),true);
    assert.equal((await db.query("SELECT stage FROM video_runtime_states")).rows[0].stage,'FAILED');
    assert.equal((await db.query("SELECT state FROM hosted_api_generation_jobs WHERE id=$1",[id(14)])).rows[0].state,'SUCCEEDED');
    assert.equal((await db.query("SELECT state FROM generation_tasks WHERE id=$1",[id(13)])).rows[0].state,'COMPLETE');
    assert.equal((await db.query("SELECT state FROM video_runtime_lane_states WHERE lane='mage_image'")).rows[0].state,'SUCCEEDED');
    assert.equal((await db.query("SELECT state FROM video_runtime_lane_states WHERE lane='soulx_avatar'")).rows[0].state,'FAILED');
    assert.equal((await db.query("SELECT state FROM generation_tasks WHERE id=$1",[id(12)])).rows[0].state,'FAILED');
    assert.equal((await db.query("SELECT state FROM provider_workload_leases WHERE id=$1",[id(99)])).rows[0].state,'ACTIVE');
  } finally {await db.close();}
});

test("Cloud CPU failure blocks fresh paid API claims while preserving already submitted job identity", async () => {
  const db = await failureFixture('SPAN_AUDIO');
  try {
    const apiSource = readFileSync(new URL('../migrations/0188_hosted_api_generation_jobs.sql',import.meta.url),'utf8');
    await db.exec(`ALTER TABLE hosted_api_generation_jobs ADD COLUMN account_id uuid,
      ADD COLUMN workspace_id uuid,ADD COLUMN lane text,ADD COLUMN input_manifest jsonb,
      ADD COLUMN claim_id uuid,ADD COLUMN updated_at timestamptz;
      CREATE FUNCTION videoforge_hosted_api_job_json(job hosted_api_generation_jobs) RETURNS jsonb
        LANGUAGE sql AS $$ SELECT jsonb_build_object('id',job.id,'state',job.state) $$;
      ${apiSource.slice(apiSource.indexOf('CREATE FUNCTION public.videoforge_claim_hosted_api_job('),apiSource.indexOf('CREATE FUNCTION public.videoforge_bind_hosted_api_image_prompt('))}
      ${source.slice(source.indexOf('-- New paid API claims stop'))}
      INSERT INTO hosted_api_generation_jobs(id,account_id,workspace_id,generation_request_id,generation_task_id,state,lane,input_manifest)
      VALUES('${id(14)}','${id(1)}','${id(2)}','${id(6)}','${id(13)}','PREPARED','IMAGE','{"prompt":"accepted prompt"}');`);
    const claim = () => db.query("SELECT videoforge_claim_hosted_api_job($1,$2,$3,$4,$5) AS job",[id(1),id(2),id(6),id(13),id(15)]);
    await assert.rejects(claim(),/prevents a new paid API claim/);
    assert.equal((await db.query("SELECT state FROM hosted_api_generation_jobs")).rows[0].state,'PREPARED');
    await db.query("UPDATE hosted_api_generation_jobs SET state='SUBMITTED',claim_id=$1",[id(15)]);
    assert.equal((await claim()).rows[0].job.state,'SUBMITTED');
    assert.equal((await db.query("SELECT claim_id FROM hosted_api_generation_jobs")).rows[0].claim_id,id(15));
  } finally {await db.close();}
});

test("failure settlement fences queued Cloud siblings and preserves an ambiguous rental until independent cleanup", async () => {
  const db = await failureFixture('ASR');
  try {
    await db.exec(`INSERT INTO hosted_cpu_job_attempts(id,account_id,workspace_id,project_id,project_revision_id,execution_backend,kind,state,submitted_at,deadline_at)
      VALUES('${id(20)}','${id(1)}','${id(2)}','${id(3)}','${id(4)}','RUNPOD_POD','ASR','OUTBOXED',NULL,now()+interval '1 hour'),
        ('${id(30)}','${id(1)}','${id(2)}','${id(3)}','${id(4)}','RUNPOD_POD','ASR','RUNNING',now(),now()+interval '1 hour');
      INSERT INTO cloud_media_reservations(id,account_id,workspace_id,project_id,project_revision_id,state,launch_outcome)
      VALUES('${id(21)}','${id(1)}','${id(2)}','${id(3)}','${id(4)}','WAITING_CAPACITY',NULL),
        ('${id(31)}','${id(1)}','${id(2)}','${id(3)}','${id(4)}','AMBIGUOUS','UNKNOWN');
      INSERT INTO cloud_media_jobs VALUES('${id(21)}','${id(20)}'),('${id(31)}','${id(30)}');`);
    assert.equal(await settleFailure(db),false);
    assert.equal((await db.query("SELECT state FROM hosted_cpu_job_attempts WHERE id=$1",[id(20)])).rows[0].state,'CANCELLED');
    assert.equal((await db.query("SELECT state FROM cloud_media_reservations WHERE id=$1",[id(21)])).rows[0].state,'CLEAN');
    assert.equal((await db.query("SELECT state FROM hosted_cpu_job_attempts WHERE id=$1",[id(30)])).rows[0].state,'CANCEL_REQUESTED');
    assert.equal((await db.query("SELECT state FROM cloud_media_reservations WHERE id=$1",[id(31)])).rows[0].state,'AMBIGUOUS');
    assert.equal((await db.query("SELECT state FROM provider_workload_leases WHERE id=$1",[id(9)])).rows[0].state,'ACTIVE');
    await db.query("UPDATE cloud_media_reservations SET state='CLEAN' WHERE id=$1",[id(31)]);
    await db.query("UPDATE hosted_cpu_job_attempts SET state='CANCELLED',terminal_at=now() WHERE id=$1",[id(30)]);
    assert.equal(await settleFailure(db),true);
  } finally {await db.close();}
});

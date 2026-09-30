import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { PGliteExecutor } from "./support/pglite.mjs";
const source = readFileSync(new URL("../migrations/0214_optional_runpod_media.sql", import.meta.url), "utf8");
const upgrade=readFileSync(new URL("../migrations/0230_hosted_cloud_span_stream.sql",import.meta.url),"utf8");
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = `sha256:${"a".repeat(64)}`;

test("230 installs over the exact historical chain and preserves protocol-1 defaults and grants",async()=>{
 const db=new PGlite({extensions:{pgcrypto}});
 try {
  await db.exec("CREATE EXTENSION pgcrypto");const executor=new PGliteExecutor(db);
  const manifest=JSON.parse(readFileSync(new URL('../migrations/manifest.json',import.meta.url),'utf8'));
  for(const migration of manifest.migrations.filter(row=>row.version<=230)) {
   const sql=readFileSync(new URL('../migrations/'+migration.filename,import.meta.url),'utf8');
   assert.equal('sha256:'+createHash('sha256').update(sql).digest('hex'),migration.sha256);
   if(migration.version===195)continue;
   await executor.execute(sql);
  }
  const column=(await db.query("SELECT column_default FROM information_schema.columns WHERE table_name='cloud_media_reservations' AND column_name='span_batch_protocol'")).rows[0];
  assert.equal(column.column_default,'1');
  assert.equal((await db.query("SELECT has_function_privilege('public','videoforge_guard_cloud_span_protocol()','EXECUTE') AS allowed")).rows[0].allowed,false);
  assert.equal((await db.query("SELECT has_function_privilege('videoforge_v209_runtime_dc9612d6','videoforge_claim_cloud_media_span(uuid,uuid,integer)','EXECUTE') AS allowed")).rows[0].allowed,true);
 }finally {await db.close();}
});
test("230 streams up to 128 exact Cloud members, fences lost replies and keeps the original runtime ACL", async () => {
  const db = new PGlite();
  try {
    const helperStart = source.indexOf("ALTER TABLE cloud_media_jobs ADD COLUMN claim_ordinal");
    const helperEnd = source.indexOf(" TO videoforge_v209_runtime_dc9612d6;", helperStart) + " TO videoforge_v209_runtime_dc9612d6;".length;
    await db.exec(`CREATE ROLE videoforge_v209_runtime_dc9612d6;
      CREATE FUNCTION videoforge_current_account_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT '${id(1)}'::uuid $$;
      CREATE TABLE cloud_media_reservations(id uuid PRIMARY KEY,account_id uuid,workspace_id uuid,project_id uuid,
        project_revision_id uuid,attempt_id uuid,leased_attempt_id uuid,span_job_count int,source_sha256 text,
        fence_id uuid, state text,verified_at timestamptz,pod_id text,deadline_at timestamptz,disk_gb int,updated_at timestamptz,last_heartbeat_at timestamptz);
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
      ${source.slice(helperStart, helperEnd)}
      ALTER TABLE cloud_media_reservations ADD CONSTRAINT cloud_media_reservations_span_job_count_check CHECK(span_job_count BETWEEN 1 AND 4);
      CREATE TABLE test_authority(enabled boolean,expires_at timestamptz);
      INSERT INTO test_authority VALUES(true,now()+interval '1 hour');
      CREATE FUNCTION public.videoforge_cloud_media_reservation_authority(uuid,uuid,uuid) RETURNS TABLE(enabled boolean,expires_at timestamptz)
        LANGUAGE sql AS $$ SELECT enabled,expires_at FROM test_authority $$;`);
    const acl=(await db.query("SELECT proacl::text AS acl FROM pg_proc WHERE oid='videoforge_claim_cloud_media_span(uuid,uuid,integer)'::regprocedure")).rows[0].acl;
    await db.exec(upgrade);
    assert.equal((await db.query("SELECT proacl::text AS acl FROM pg_proc WHERE oid='videoforge_claim_cloud_media_span(uuid,uuid,integer)'::regprocedure")).rows[0].acl,acl);
    await db.query(`INSERT INTO cloud_media_reservations(id,account_id,workspace_id,project_id,project_revision_id,attempt_id,leased_attempt_id,span_job_count,source_sha256,fence_id,state,verified_at,pod_id,deadline_at,disk_gb,updated_at,last_heartbeat_at) VALUES($1,$2,$3,$4,$5,$6,$6,1,$7,$6,'SAVING',now(),'owned-pod',now()+interval '1 hour',100,now(),now())`,
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
    await db.query("UPDATE cloud_media_reservations SET span_batch_protocol=2 WHERE id=$1",[id(10)]).then(()=>assert.fail("protocol is immutable"),error=>assert.match(error.message,/immutable/));
    // Recreate with protocol 2; protocol 1 reservations remain permanently four clips.
    await db.query("DELETE FROM cloud_media_reservations WHERE id=$1",[id(10)]);
    await db.query(`INSERT INTO cloud_media_reservations(id,account_id,workspace_id,project_id,project_revision_id,attempt_id,leased_attempt_id,span_job_count,source_sha256,fence_id,state,verified_at,pod_id,deadline_at,disk_gb,updated_at,last_heartbeat_at,span_batch_protocol)
     VALUES($1,$2,$3,$4,$5,$6,$6,1,$7,$6,'SAVING',now(),'owned-pod',now()+interval '1 hour',100,now(),now(),2)`,[id(10),id(1),id(2),id(3),id(4),id(20),hash]);
    await db.query("INSERT INTO cloud_media_jobs VALUES($1,$2,$3,$4,1)",[id(1),id(2),id(10),id(20)]);
    await attempt(21,{account:id(99)});
    await attempt(22,{backend:"PERSONAL_WORKER"});
    await attempt(23,{bundle:`sha256:${"b".repeat(64)}`});
    await attempt(24);
    await db.query("INSERT INTO media_worker_leases VALUES($1,'RUNNING')",[id(24)]);
    await attempt(25,{bytes:30_000_000_000});
    for (let n=26;n<154;n++) await attempt(n);
    const claim = async (completed,count) => (await db.query("SELECT videoforge_claim_cloud_media_span($1,$2,$3) AS next",[id(10),id(completed),count])).rows[0].next;
    assert.equal(await claim(20,1),id(26));
    assert.equal(await claim(20,1),id(26));
    await assert.rejects(claim(20,2),/completed receipt rejected/);
    await db.exec("UPDATE test_authority SET enabled=false");
    await db.query("UPDATE hosted_cpu_job_attempts SET state='SUCCEEDED',terminal_at=now(),result_receipt_sha256=$2 WHERE id=$1",[id(26),hash]);
    assert.equal(await claim(26,2),null);
    await db.exec("UPDATE test_authority SET enabled=true");
    for(let ordinal=2;ordinal<128;ordinal++) {
      const completed=ordinal+24;
      await db.query("UPDATE hosted_cpu_job_attempts SET state='SUCCEEDED',terminal_at=now(),result_receipt_sha256=$2 WHERE id=$1",[id(completed),hash]);
      assert.equal(await claim(completed,ordinal),id(completed+1));
      assert.equal(await claim(completed,ordinal),id(completed+1));
    }
    await db.query("UPDATE hosted_cpu_job_attempts SET state='SUCCEEDED',terminal_at=now(),result_receipt_sha256=$2 WHERE id=$1",[id(152),hash]);
    assert.equal(await claim(152,128),null);
    await assert.rejects(claim(152,129),/tenant or ordinal rejected/);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM cloud_media_jobs")).rows[0].n,128);
    assert.equal((await db.query("SELECT state FROM hosted_cpu_job_attempts WHERE id=$1",[id(153)])).rows[0].state,"OUTBOXED");
    await assert.rejects(()=>db.query("UPDATE cloud_media_reservations SET span_batch_protocol=1"),/immutable/);
  } finally { await db.close(); }
});

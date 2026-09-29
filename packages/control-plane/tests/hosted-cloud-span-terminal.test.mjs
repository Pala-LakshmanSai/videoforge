import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {PGliteExecutor} from './support/pglite.mjs';
import {IDS,seedLockedProjects} from './support/fixtures.mjs';
const read=name=>readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8');
const migration=read('0221_hosted_cloud_span_terminal.sql');
const role='videoforge_v209_runtime_dc9612d6',id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const project=id(219001),revision=id(219002),asr=id(219003),authority=id(219004),reservation=id(219005),hash='sha256:'+'a'.repeat(64);
async function fixture(){
 const db=new PGlite({extensions:{pgcrypto}});await db.exec('CREATE EXTENSION pgcrypto');const executor=new PGliteExecutor(db);
 for(const row of JSON.parse(read('manifest.json')).migrations.filter(row=>row.version<=220)){
  if(row.version===195)continue; // Existing deployment-owned objects are absent from the shared fixture.
  const sql=read(row.filename);assert.equal('sha256:'+createHash('sha256').update(sql).digest('hex'),row.sha256);await executor.execute(sql);
 }
 await seedLockedProjects(executor);await db.query("SELECT set_config('videoforge.account_id',$1,false)",[IDS.accountA]);
 await db.query(`INSERT INTO projects(id,workspace_id,owner_user_id,name,normalized_name,generation_provider)
 VALUES($1,$2,$3,'Cloud span scope','cloud span scope','KIE_FAL')`,[project,IDS.workspaceA,IDS.userA]);
 await db.query(`INSERT INTO project_revisions SELECT(jsonb_populate_record(NULL::project_revisions,to_jsonb(r)||
 jsonb_build_object('id',$1::text,'project_id',$2::text,'media_execution_backend','RUNPOD_POD','created_at',now(),'locked_at',now()))).*
 FROM project_revisions r WHERE r.id=$3`,[revision,project,IDS.revisionA]);
 const prefix=`tenant/${IDS.accountA}/workspace/${IDS.workspaceA}/project/${project}/revision/${revision}/lane/input/job/${asr}/artifact`;
 await db.query(`INSERT INTO hosted_cpu_job_attempts(id,account_id,workspace_id,project_id,project_revision_id,kind,state,execution_backend,
 execution_bundle_sha256,request_sha256,job_spec_object_key,job_spec_content_length,job_spec_checksum_sha256,result_object_key,image_digest,
 callback_token_sha256,deadline_at,submitted_at,terminal_at,result_receipt_sha256,result_checksum_sha256,result_content_length)
 VALUES($1,$2,$3,$4,$5,'SPAN_AUDIO','SUCCEEDED','RUNPOD_POD',$6,$6,$7,100,$6,$8,$6,$6,now()+interval '1 hour',now(),now(),$6,$6,1133)`,
 [asr,IDS.accountA,IDS.workspaceA,project,revision,hash,prefix+'/job-spec',prefix+'/result-document']);
 await db.query(`INSERT INTO cloud_media_budget_authorities(id,allowed_account_ids,allowed_project_ids,total_cap_usd,max_reservation_usd,
 max_hourly_usd,max_rental_seconds,image,source_sha256,runtime_sha256,expires_at)
 VALUES($1,ARRAY[$2]::uuid[],ARRAY[$3]::uuid[],3,.2,.8,900,'fixture@'||$4,$4,$4,now()+interval '1 hour')`,[authority,IDS.accountA,project,hash]);
 await db.query(`INSERT INTO cloud_media_reservations(id,account_id,workspace_id,project_id,project_revision_id,attempt_id,leased_attempt_id,fence_id,
 capability_sha256,pod_name,image,source_sha256,runtime_sha256,tooling,disk_gb,max_hourly_usd,budget_usd,rental_seconds,state,
 placement_deadline_at,cleanup_verified_at,budget_authority_id,launch_outcome,verified_at,pod_id)
 VALUES($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,'fixture@'||$8,$8,$8,'{}',100,.8,.2,900,'CLEAN',now()+interval '1 hour',now(),$10,'CONFIRMED',now(),'fixture-pod')`,
 [reservation,IDS.accountA,IDS.workspaceA,project,revision,asr,id(219006),hash,'videoforge-media-'+reservation,authority]);
 await db.query("INSERT INTO cloud_media_jobs(attempt_id,account_id,workspace_id,reservation_id,claimed_at) VALUES($1,$2,$3,$4,now()-interval '1 second')",[asr,IDS.accountA,IDS.workspaceA,reservation]);
 await db.query(`INSERT INTO hosted_cpu_job_events(id,account_id,workspace_id,attempt_id,sequence,kind,facts_sha256,occurred_at) VALUES($1,$2,$3,$4,1,'SUCCEEDED','sha256:'||encode(sha256(convert_to($5::text||':SUCCEEDED:'||$6::text,'UTF8')),'hex'),now())`,[id(221001),IDS.accountA,IDS.workspaceA,asr,reservation,hash]);
 return{db};
}

const signature='public.videoforge_finalize_hosted_v209_span_audio(uuid,uuid,uuid,jsonb)';
const helper='public.videoforge_cloud_span_completion_proven(uuid,uuid,uuid)';
const proven=async(db,account=IDS.accountA,workspace=IDS.workspaceA,attempt=asr)=>(await db.query('SELECT public.videoforge_cloud_span_completion_proven($1,$2,$3) allowed',[account,workspace,attempt])).rows[0].allowed;
async function isolated(db,fn){await db.exec('BEGIN');try{await fn();}finally{await db.exec('ROLLBACK');}}
test('221 Cloud finalization uses accepted membership and receipt without weakening desktop or media gates',async t=>{
 const{db}=await fixture();try{
  const before=(await db.query('SELECT pg_get_functiondef($1::regprocedure) definition',[signature])).rows[0].definition;
  const acl=(await db.query('SELECT proacl::text acl FROM pg_proc WHERE oid=$1::regprocedure',[signature])).rows[0].acl;
  await db.exec(migration);assert.equal(await proven(db),true);
  const after=(await db.query('SELECT pg_get_functiondef($1::regprocedure) definition',[signature])).rows[0].definition;
  assert.equal((await db.query('SELECT proacl::text acl FROM pg_proc WHERE oid=$1::regprocedure',[signature])).rows[0].acl,acl);
  assert.match(after,/attempt.execution_backend='PERSONAL_WORKER' AND EXISTS/u);
  assert.match(after,/l.state='SUCCEEDED'/u);
  // Everything following the execution-success proof remains byte-identical.
  assert.equal(after.slice(after.indexOf('  result_sha:=')),before.slice(before.indexOf('  result_sha:=')));
  assert.equal((await db.query("SELECT has_function_privilege('public',$1,'EXECUTE') allowed",[helper])).rows[0].allowed,false);
  assert.equal((await db.query("SELECT has_function_privilege($1,$2,'EXECUTE') allowed",[role,helper])).rows[0].allowed,false);
  for(const[name,sql,args]of[
   ['missing accepted completion event','DELETE FROM hosted_cpu_job_events WHERE attempt_id=$1',[asr]],
   ['substituted accepted receipt event','UPDATE hosted_cpu_job_events SET facts_sha256=$1 WHERE attempt_id=$2',['sha256:'+'b'.repeat(64),asr]],
   ['missing exact reservation member','DELETE FROM cloud_media_jobs WHERE attempt_id=$1',[asr]],
   ['invalid member ordinal','UPDATE cloud_media_jobs SET claim_ordinal=2 WHERE attempt_id=$1',[asr]],
   ['unconfirmed placement',"UPDATE cloud_media_reservations SET launch_outcome='UNKNOWN' WHERE id=$1",[reservation]],
   ['unverified placement','UPDATE cloud_media_reservations SET verified_at=NULL WHERE id=$1',[reservation]],
  ])await t.test(name,()=>isolated(db,async()=>{if(sql.includes('hosted_cpu_job_events'))await db.exec('ALTER TABLE hosted_cpu_job_events DISABLE TRIGGER ALL');await db.query(sql,args);assert.equal(await proven(db),false);}));
  await t.test('wrong tenant, workspace or attempt cannot borrow completion',async()=>{
   assert.equal(await proven(db,IDS.accountB),false);assert.equal(await proven(db,IDS.accountA,IDS.workspaceB),false);assert.equal(await proven(db,IDS.accountA,IDS.workspaceA,id(221099)),false);
  });
  await t.test('unset principal fails closed',()=>isolated(db,async()=>{await db.query("SELECT set_config('videoforge.account_id','',false)");assert.equal(await proven(db),false);}));
  await t.test('accepted completion event is immutable',()=>isolated(db,async()=>{await assert.rejects(()=>db.query('DELETE FROM hosted_cpu_job_events WHERE attempt_id=$1',[asr]),/append-only/);}));
  await t.test('fixed fence cannot be replaced after accepted completion',()=>isolated(db,async()=>{
   await assert.rejects(()=>db.query('UPDATE cloud_media_reservations SET fence_id=$1 WHERE id=$2',[id(221099),reservation]),/immutable/);
  }));
  await t.test('Cloud source pins are required even for an accepted receipt',()=>isolated(db,async()=>{
   // Corrupt historical pins in this isolated fixture to exercise the independent proof.
   await db.exec('ALTER TABLE hosted_cpu_job_attempts DISABLE TRIGGER ALL');await db.query('UPDATE hosted_cpu_job_attempts SET image_digest=$1 WHERE id=$2',['sha256:'+'b'.repeat(64),asr]);
   assert.equal(await proven(db),false);
  }));
  await t.test('a completed earlier batch member remains valid after the exact next lease advances',()=>isolated(db,async()=>{
   const next=id(221002);await db.query(`INSERT INTO hosted_cpu_job_attempts SELECT(jsonb_populate_record(NULL::hosted_cpu_job_attempts,to_jsonb(a)||jsonb_build_object('id',$1::text,'state','RUNNING','terminal_at',NULL,'result_receipt_sha256',NULL,'result_checksum_sha256',NULL,'submission_idempotency_key',NULL))).* FROM hosted_cpu_job_attempts a WHERE id=$2`,[next,asr]);
   await db.query('INSERT INTO cloud_media_jobs(attempt_id,account_id,workspace_id,reservation_id,claim_ordinal) VALUES($1,$2,$3,$4,2)',[next,IDS.accountA,IDS.workspaceA,reservation]);
   await db.query('UPDATE cloud_media_reservations SET leased_attempt_id=$1,span_job_count=2 WHERE id=$2',[next,reservation]);assert.equal(await proven(db),true);
   await db.query('DELETE FROM cloud_media_jobs WHERE attempt_id=$1',[next]);assert.equal(await proven(db),false);
  }));
  await t.test('changed historical finalizer guard fails closed',()=>isolated(db,async()=>{
   await db.exec('DROP FUNCTION '+helper);await db.exec(before.replace("AND l.state='SUCCEEDED'","AND l.state='FAILED'"));await assert.rejects(()=>db.exec(migration),/reviewed preimage mismatch/);
  }));
 }finally{await db.close();}
});

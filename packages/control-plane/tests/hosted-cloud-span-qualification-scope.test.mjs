import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {PGliteExecutor} from './support/pglite.mjs';
import {IDS,seedLockedProjects} from './support/fixtures.mjs';
const read=name=>readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8');
const migration=read('0219_hosted_cloud_span_qualification_scope.sql');
const role='videoforge_v209_runtime_dc9612d6',id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const project=id(219001),revision=id(219002),asr=id(219003),authority=id(219004),reservation=id(219005),hash='sha256:'+'a'.repeat(64);
const signature='public.videoforge_cloud_span_qualification_allowed(uuid,uuid,uuid,uuid,uuid,boolean)';
async function fixture(){
 const db=new PGlite({extensions:{pgcrypto}});await db.exec('CREATE EXTENSION pgcrypto');const executor=new PGliteExecutor(db);
 for(const row of JSON.parse(read('manifest.json')).migrations.filter(row=>row.version<=218)){
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
 callback_token_sha256,deadline_at,submitted_at,terminal_at,result_receipt_sha256,result_checksum_sha256)
 VALUES($1,$2,$3,$4,$5,'ASR','SUCCEEDED','RUNPOD_POD',$6,$6,$7,100,$6,$8,$6,$6,now()+interval '1 hour',now(),now(),$6,$6)`,
 [asr,IDS.accountA,IDS.workspaceA,project,revision,hash,prefix+'/job-spec',prefix+'/result-document']);
 const request=(await db.query('SELECT videoforge_admit_hosted_v209_generation($1,$2,$3,$4) value',[IDS.accountA,IDS.workspaceA,IDS.userA,project])).rows[0].value;
 assert.equal(request.state,'ACTIVE');
 await db.query(`INSERT INTO cloud_media_budget_authorities(id,allowed_account_ids,allowed_project_ids,total_cap_usd,max_reservation_usd,
 max_hourly_usd,max_rental_seconds,image,source_sha256,runtime_sha256,expires_at)
 VALUES($1,ARRAY[$2]::uuid[],ARRAY[$3]::uuid[],3,.2,.8,900,'fixture@'||$4,$4,$4,now()+interval '1 hour')`,[authority,IDS.accountA,project,hash]);
 await db.query(`INSERT INTO cloud_media_reservations(id,account_id,workspace_id,project_id,project_revision_id,attempt_id,leased_attempt_id,fence_id,
 capability_sha256,pod_name,image,source_sha256,runtime_sha256,tooling,disk_gb,max_hourly_usd,budget_usd,rental_seconds,state,
 placement_deadline_at,cleanup_verified_at,budget_authority_id)
 VALUES($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,'fixture@'||$8,$8,$8,'{}',100,.8,.2,900,'CLEAN',now()+interval '1 hour',now(),$10)`,
 [reservation,IDS.accountA,IDS.workspaceA,project,revision,asr,id(219006),hash,'videoforge-media-'+reservation,authority]);
 await db.query('INSERT INTO cloud_media_jobs(attempt_id,account_id,workspace_id,reservation_id) VALUES($1,$2,$3,$4)',[asr,IDS.accountA,IDS.workspaceA,reservation]);
 return{db,request};
}
async function runtime(db,fn){await db.exec('SET ROLE '+role);try{return await fn();}finally{await db.exec('RESET ROLE');}}
async function allowed(db,args=[authority,project,IDS.accountA,IDS.workspaceA,IDS.userA,true]){
 return runtime(db,async()=>(await db.query('SELECT '+signature.split('(')[0]+'($1,$2,$3,$4,$5,$6) allowed',args)).rows[0].allowed);
}
async function isolated(db,fn){await db.exec('BEGIN');try{await fn();}finally{await db.exec('ROLLBACK;RESET ROLE');}}
test('219 full-schema restricted runtime can evaluate exact qualification without private lease access',async t=>{
 const{db,request}=await fixture();try{
  await runtime(db,async()=>{
   assert.equal((await db.query("SELECT has_table_privilege(current_user,'public.provider_workload_leases','SELECT') allowed")).rows[0].allowed,false);
   await assert.rejects(()=>db.query('SELECT count(*) FROM public.provider_workload_leases'),error=>error.code==='42501');
  });
  await db.exec(migration);
  assert.equal(await allowed(db),true);
  assert.equal((await db.query("SELECT has_function_privilege('public',$1,'EXECUTE') allowed",[signature])).rows[0].allowed,false);
  const pins=(await db.query("SELECT prosecdef,proconfig FROM pg_proc WHERE oid=$1::regprocedure",[signature])).rows[0];
  assert.equal(pins.prosecdef,true);assert.deepEqual(pins.proconfig,['search_path=public, pg_catalog']);
  assert.equal((await db.query("SELECT has_table_privilege($1,'public.provider_workload_leases','SELECT') allowed",[role])).rows[0].allowed,false);
  for(const[label,args]of[
   ['another account',[authority,project,IDS.accountB,IDS.workspaceA,IDS.userA,true]],
   ['another workspace',[authority,project,IDS.accountA,IDS.workspaceB,IDS.userA,true]],
   ['another user',[authority,project,IDS.accountA,IDS.workspaceA,IDS.userB,true]],
   ['non-owner member',[authority,project,IDS.accountA,IDS.workspaceA,IDS.userExtra,true]],
   ['another project',[authority,IDS.projectB,IDS.accountA,IDS.workspaceA,IDS.userA,true]],
   ['unapproved authority',[id(219099),project,IDS.accountA,IDS.workspaceA,IDS.userA,true]],
   ['null cleanliness flag',[authority,project,IDS.accountA,IDS.workspaceA,IDS.userA,null]]
  ])await t.test(label,async()=>assert.equal(await allowed(db,args),false));
  await t.test('missing tenant context fails closed',()=>isolated(db,async()=>{await db.query("SELECT set_config('videoforge.account_id','',false)");assert.equal(await allowed(db),false);}));
  await t.test('tenant spoofing cannot authorize another account',()=>isolated(db,async()=>{await db.query("SELECT set_config('videoforge.account_id',$1,false)",[IDS.accountB]);assert.equal(await allowed(db),false);}));
  await t.test('inactive membership fails closed',()=>isolated(db,async()=>{await db.query("UPDATE memberships SET status='SUSPENDED' WHERE id=$1",[IDS.membershipA]);assert.equal(await allowed(db),false);}));
  await t.test('expired and disabled authority fail closed',()=>isolated(db,async()=>{await db.query("UPDATE cloud_media_budget_authorities SET expires_at=now()-interval '1 second' WHERE id=$1",[authority]);assert.equal(await allowed(db),false);await db.query("UPDATE cloud_media_budget_authorities SET expires_at=now()+interval '1 hour',enabled=false WHERE id=$1",[authority]);assert.equal(await allowed(db),false);}));
  await t.test('released VIDEO lease fails closed',()=>isolated(db,async()=>{await db.query("UPDATE provider_workload_leases SET state='RELEASED',released_at=now(),release_reason='QUALIFICATION_TEST',version=version+1 WHERE generation_request_id=$1",[request.generationRequestId]);assert.equal(await allowed(db),false);}));
  await t.test('temporary shadow of an active lease cannot bypass the real released lease',()=>isolated(db,async()=>{
   await db.exec('CREATE TEMP TABLE provider_workload_leases AS TABLE public.provider_workload_leases');
   await db.query("UPDATE public.provider_workload_leases SET state='RELEASED',released_at=now(),release_reason='QUALIFICATION_TEST',version=version+1 WHERE generation_request_id=$1",[request.generationRequestId]);
   assert.equal(await allowed(db),false);
  }));
  await t.test('ASR without an accepted receipt fails closed',()=>isolated(db,async()=>{await db.query("UPDATE hosted_cpu_job_attempts SET state='FAILED',result_receipt_sha256=NULL WHERE id=$1",[asr]);assert.equal(await allowed(db),false);}));
  await t.test('uncertain ASR cleanup fails even when account cleanliness check is omitted',()=>isolated(db,async()=>{await db.exec('ALTER TABLE cloud_media_reservations DISABLE TRIGGER cloud_media_reservation_guard');await db.query("UPDATE cloud_media_reservations SET state='STOPPING',cleanup_verified_at=NULL WHERE id=$1",[reservation]);await db.exec('ALTER TABLE cloud_media_reservations ENABLE TRIGGER cloud_media_reservation_guard');assert.equal(await allowed(db),false);assert.equal(await allowed(db,[authority,project,IDS.accountA,IDS.workspaceA,IDS.userA,false]),false);}));
  assert.equal(await allowed(db),true);
  assert.equal((await db.query('SELECT count(*)::int n FROM hosted_api_generation_jobs')).rows[0].n,0);
  assert.equal((await db.query('SELECT count(*)::int n FROM hosted_v209_span_audio_materializations')).rows[0].n,0);
 }finally{await db.close();}
});

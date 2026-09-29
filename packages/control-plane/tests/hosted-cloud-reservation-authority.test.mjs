import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {PGliteExecutor} from './support/pglite.mjs';
import {IDS,seedLockedProjects} from './support/fixtures.mjs';
const read=name=>readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8');
const migration=read('0220_hosted_cloud_reservation_authority.sql');
const role='videoforge_v209_runtime_dc9612d6',id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const project=id(219001),revision=id(219002),asr=id(219003),authority=id(219004),reservation=id(219005),hash='sha256:'+'a'.repeat(64);
async function fixture(){
 const db=new PGlite({extensions:{pgcrypto}});await db.exec('CREATE EXTENSION pgcrypto');const executor=new PGliteExecutor(db);
 for(const row of JSON.parse(read('manifest.json')).migrations.filter(row=>row.version<=219)){
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

const signature='public.videoforge_cloud_media_reservation_authority(uuid,uuid,uuid)';
const metadata=async(db,args=[reservation,asr,id(219006)])=>runtime(db,async()=>(await db.query('SELECT * FROM public.videoforge_cloud_media_reservation_authority($1,$2,$3)',args)).rows);
async function isolated(db,fn){await db.exec('BEGIN');try{await fn();}finally{await db.exec('ROLLBACK;RESET ROLE');}}
test('220 fenced authority metadata preserves private tables and repairs intended terminal execution',async t=>{
 const{db}=await fixture();try{
  await db.exec('REVOKE EXECUTE ON FUNCTION public.videoforge_settle_stranded_hosted_v209_requests(uuid,uuid,uuid) FROM '+role);
  for(const table of['cloud_media_budget_authorities','cloud_media_budget_debits','provider_workload_leases'])await runtime(db,async()=>{
   await assert.rejects(()=>db.query('SELECT count(*) FROM public.'+table),error=>error.code==='42501');
  });
  await db.exec(migration);
  const rows=await metadata(db);assert.equal(rows.length,1);assert.deepEqual(Object.keys(rows[0]).sort(),['enabled','expires_at','id']);assert.equal(rows[0].id,authority);assert.equal(rows[0].enabled,true);
  assert.equal((await db.query("SELECT has_function_privilege('public',$1,'EXECUTE') allowed",[signature])).rows[0].allowed,false);
  for(const table of['cloud_media_budget_authorities','cloud_media_budget_debits','provider_workload_leases']){
   assert.equal((await db.query("SELECT has_table_privilege($1,$2,'SELECT') allowed",[role,'public.'+table])).rows[0].allowed,false);
  }
  const pins=(await db.query('SELECT prosecdef,proconfig FROM pg_proc WHERE oid=$1::regprocedure',[signature])).rows[0];assert.equal(pins.prosecdef,true);assert.deepEqual(pins.proconfig,['search_path=public, pg_catalog']);
  for(const[name,args]of[
   ['unknown reservation',[id(220099),asr,id(219006)]],
   ['stale/replaced leased attempt',[reservation,id(220099),id(219006)]],
   ['stale fencing identity',[reservation,asr,id(220099)]],
   ['null exact identity',[reservation,asr,null]]
  ])await t.test(name,async()=>assert.deepEqual(await metadata(db,args),[]));
  await t.test('another tenant receives no metadata',()=>isolated(db,async()=>{await db.query("SELECT set_config('videoforge.account_id',$1,false)",[IDS.accountB]);assert.deepEqual(await metadata(db),[]);}));
  await t.test('unset tenant receives no metadata',()=>isolated(db,async()=>{await db.query("SELECT set_config('videoforge.account_id','',false)");assert.deepEqual(await metadata(db),[]);}));
  await t.test('expired disabled CLEAN reservation remains observable for cleanup and accepted publication',()=>isolated(db,async()=>{
   await db.query("UPDATE cloud_media_budget_authorities SET enabled=false,expires_at=now()-interval '1 hour' WHERE id=$1",[authority]);
   const observed=await metadata(db);assert.equal(observed.length,1);assert.equal(observed[0].enabled,false);assert.ok(Date.parse(observed[0].expires_at)<Date.now());
  }));
  await t.test('authority account and project allowlists stay binding',()=>isolated(db,async()=>{
   await db.query('UPDATE cloud_media_budget_authorities SET allowed_account_ids=ARRAY[$1]::uuid[] WHERE id=$2',[IDS.accountB,authority]);assert.deepEqual(await metadata(db),[]);
   await db.query('UPDATE cloud_media_budget_authorities SET allowed_account_ids=ARRAY[$1]::uuid[],allowed_project_ids=ARRAY[$2]::uuid[] WHERE id=$3',[IDS.accountA,IDS.projectB,authority]);assert.deepEqual(await metadata(db),[]);
  }));
  await t.test('missing exact job membership fails closed',()=>isolated(db,async()=>{await db.query('DELETE FROM cloud_media_jobs WHERE reservation_id=$1',[reservation]);assert.deepEqual(await metadata(db),[]);}));
  await t.test('temporary authority table cannot enable a disabled real authority',()=>isolated(db,async()=>{
   await db.exec('CREATE TEMP TABLE cloud_media_budget_authorities AS TABLE public.cloud_media_budget_authorities');await db.query('UPDATE public.cloud_media_budget_authorities SET enabled=false WHERE id=$1',[authority]);assert.equal((await metadata(db))[0].enabled,false);
  }));
  await t.test('all seven controller authority queries compile under the restricted role',async()=>{
   // Emulate the independently verified existing application grants, not grants made by 220.
   await db.exec('GRANT SELECT,UPDATE ON public.hosted_cpu_job_attempts TO '+role);
   const source=readFileSync(new URL('../../../apps/web/src/server/hosted/runpod-media.ts',import.meta.url),'utf8');
   const queries=[['CLOUD_CREATE_RENTAL_SQL',[reservation,'fixture-gpu',.7,asr,id(219006)]],['CLOUD_PRE_CREATE_ALLOWED_SQL',[reservation,asr,id(219006)]],['CLOUD_PLACEMENT_READY_SQL',[reservation,asr,id(219006)]],['CLOUD_QUALIFICATION_RENDER_ARTIFACT_SQL',[asr,IDS.accountA,IDS.workspaceA,authority]]];
   for(const[name,args]of queries){const sql=source.split('export const '+name+' = `')[1]?.split('`;')[0];assert.ok(sql,name+' source exists');assert.equal(sql.includes('cloud_media_budget_authorities'),false);await runtime(db,()=>db.query('EXPLAIN '+sql,args));}
   const embedded=[['initial reservation read',source.match(/"SELECT r\.\*,b\.expires_at[^\n]+?"/u)?.[0]?.slice(1,-1),[asr]],
    ['expired authority read',source.match(/`SELECT r\.id AS expired_authority_reservation[\s\S]*?`/u)?.[0]?.slice(1,-1),[reservation,asr,id(219006)]],
    ['expired placement read',source.match(/`SELECT r\.id AS expired_placement_reservation[\s\S]*?`/u)?.[0]?.slice(1,-1),[reservation,asr,id(219006)]]];
   for(const[name,sql,args]of embedded){assert.ok(sql,name+' source exists');assert.equal(sql.includes('cloud_media_budget_authorities'),false);await runtime(db,()=>db.query('EXPLAIN '+sql,args));}

  });
  await t.test('intended 0147 execute permission restored without granting request/lease writes',async()=>{
   assert.equal((await db.query("SELECT has_function_privilege($1,'public.videoforge_settle_stranded_hosted_v209_requests(uuid,uuid,uuid)','EXECUTE') allowed",[role])).rows[0].allowed,true);
   assert.equal((await db.query("SELECT has_function_privilege('public','public.videoforge_settle_stranded_hosted_v209_requests(uuid,uuid,uuid)','EXECUTE') allowed")).rows[0].allowed,false);
   assert.equal(await runtime(db,async()=>(await db.query('SELECT videoforge_settle_stranded_hosted_v209_requests($1,$2,$3) settled',[IDS.accountA,IDS.workspaceA,IDS.userA])).rows[0].settled),0);
   await runtime(db,()=>assert.rejects(()=>db.query('SELECT videoforge_settle_stranded_hosted_v209_requests($1,$2,$3)',[IDS.accountB,IDS.workspaceB,IDS.userB]),error=>error.code==='42501'));
   for(const table of['generation_requests','provider_workload_leases'])assert.equal((await db.query("SELECT has_table_privilege($1,$2,'UPDATE') allowed",[role,'public.'+table])).rows[0].allowed,false);
  });
  await t.test('repair fails closed if the existing settlement tenant guard is changed',()=>isolated(db,async()=>{
   await db.exec('DROP FUNCTION public.videoforge_cloud_media_reservation_authority(uuid,uuid,uuid)');
   const definition=(await db.query("SELECT pg_get_functiondef('public.videoforge_settle_stranded_hosted_v209_requests(uuid,uuid,uuid)'::regprocedure) definition")).rows[0].definition;
   await db.exec(definition.replace('IF public.videoforge_current_account_id() IS DISTINCT FROM supplied_account_id THEN','IF false THEN'));
   await assert.rejects(()=>db.exec(migration),/reviewed tenant guard mismatch/);
  }));
 }finally{await db.close();}
});

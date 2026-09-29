import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {PGliteExecutor} from './support/pglite.mjs';
import {IDS,seedLockedProjects} from './support/fixtures.mjs';
const read=name=>readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8');
const migration=read('0222_hosted_cloud_render_only_runs.sql');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`, hash='sha256:'+'a'.repeat(64);
const source=id(222001),request=id(222002),runtime=id(222003),run=id(222004),key=id(222005),authority=id(222006),reservation=id(222007);
const role='videoforge_v209_runtime_dc9612d6';
async function fixture(){
 const db=new PGlite({extensions:{pgcrypto}});await db.exec('CREATE EXTENSION pgcrypto');const executor=new PGliteExecutor(db);
 for(const row of JSON.parse(read('manifest.json')).migrations.filter(x=>x.version<=221)){
  if(row.version===195)continue;
  const sql=read(row.filename);assert.equal('sha256:'+createHash('sha256').update(sql).digest('hex'),row.sha256);await executor.execute(sql);
 }
 await seedLockedProjects(executor);await db.query("SELECT set_config('videoforge.account_id',$1,false)",[IDS.accountA]);
 // Seed accepted history; this suite checks the new run's lineage, not fresh Kie/Fal acceptance.
 await db.exec('ALTER TABLE projects DISABLE TRIGGER ALL');await db.query("UPDATE projects SET generation_provider='KIE_FAL' WHERE id=$1",[IDS.projectA]);await db.exec('ALTER TABLE projects ENABLE TRIGGER ALL');
 await db.query(`INSERT INTO generation_requests(id,account_id,workspace_id,project_id,project_revision_id,created_by_user_id,state,
 queue_order,available_at,idempotency_key,terminal_at,created_at,updated_at)
 VALUES($1,$2,$3,$4,$5,$6,'SUCCEEDED',1,now(),'source',now(),now(),now())`,[request,IDS.accountA,IDS.workspaceA,IDS.projectA,IDS.revisionA,IDS.userA]);
 await db.exec('ALTER TABLE video_runtime_states DISABLE TRIGGER ALL');await db.query(`INSERT INTO video_runtime_states(id,account_id,workspace_id,project_id,project_revision_id,generation_request_id,
 stage,preparation_manifest_sha256,render_manifest_sha256,final_output_sha256,terminal_reason,admitted_at,prepared_at,terminal_at,created_at,updated_at)
 VALUES($1,$2,$3,$4,$5,$6,'COMPLETE',$7,$7,$7,'SUCCEEDED',now(),now(),now(),now(),now())`,[runtime,IDS.accountA,IDS.workspaceA,IDS.projectA,IDS.revisionA,request,hash]);await db.exec('ALTER TABLE video_runtime_states ENABLE TRIGGER ALL');
 const prefix=`tenant/${IDS.accountA}/workspace/${IDS.workspaceA}/project/${IDS.projectA}/revision/${IDS.revisionA}/lane/render/job/${source}/artifact`;
 const uri=`vf-local://objects/sha256/aa/${'a'.repeat(64)}.json`, uri2=`vf-local://objects/sha256/aa/${'a'.repeat(64)}.wav`;
 const payload={schema_version:'videoforge-hosted-cpu-submission/v1',idempotency_key:'source',kind:'RENDER',project_id:IDS.projectA,project_revision_id:IDS.revisionA,
 input_document:{schema_version:'render-job-input/v1',project_revision_id:IDS.revisionA,resolved_render_manifest:{sha256:hash,artifact_uri:uri},assets:[{sha256:hash,artifact_uri:uri},{sha256:hash,artifact_uri:uri2}]},objects:[{artifact_receipt_id:id(222020),uri},{artifact_receipt_id:id(222021),uri:uri2}]};
 const canon=(await db.query("SELECT 'sha256:'||encode(sha256(convert_to(videoforge_canonical_jsonb($1::jsonb),'UTF8')),'hex') hash,videoforge_hosted_cpu_submission_request_sha256($1::jsonb) request",[JSON.stringify(payload)])).rows[0];
 await db.query(`INSERT INTO hosted_render_plans(account_id,workspace_id,project_id,project_revision_id,schema_version,payload,payload_sha256)
 VALUES($1,$2,$3,$4,'videoforge-hosted-cpu-submission/v1',$5,$6)`,[IDS.accountA,IDS.workspaceA,IDS.projectA,IDS.revisionA,payload,canon.hash]);
 await db.query(`INSERT INTO hosted_cpu_job_attempts(id,account_id,workspace_id,project_id,project_revision_id,kind,state,execution_backend,execution_bundle_sha256,
 request_sha256,job_spec_object_key,job_spec_content_length,job_spec_checksum_sha256,result_object_key,image_digest,callback_token_sha256,deadline_at,
 submitted_at,terminal_at,result_receipt_sha256,result_checksum_sha256,result_content_length)
 VALUES($1,$2,$3,$4,$5,'RENDER','SUCCEEDED','PERSONAL_WORKER',$6,$7,$8,100,$6,$9,$6,$6,now()+interval '1 hour',now(),now(),$6,$6,100)`,
 [source,IDS.accountA,IDS.workspaceA,IDS.projectA,IDS.revisionA,hash,canon.request,prefix+'/job-spec',prefix+'/result-document']);
 for(const [n,type,key,length]of[[1,'PRIMARY_RESULT_OUTPUT',prefix+'/result','video/mp4'],[2,'RESULT_DOCUMENT',prefix+'/result-document','application/json']])
 await db.query(`INSERT INTO hosted_cpu_upload_authorities(id,account_id,workspace_id,attempt_id,source,object_key,content_type,max_bytes,issued_at,issued_content_length,issued_checksum_sha256)
 VALUES($1,$2,$3,$4,$5,$6,$7,10000,now(),100,$8)`,[id(222030+n),IDS.accountA,IDS.workspaceA,source,type,key,length,hash]);
 await artifact(db,'source-final',prefix+'/result','video/mp4',source,`md5('v209-final-receipt:'||'${source}')::uuid`,`md5('v209-final-reservation:'||'${source}')::uuid`);
 await artifact(db,'manifest',prefix+'/manifest','application/json',source,`'${id(222020)}'::uuid`,`'${id(222022)}'::uuid`);
 await artifact(db,'voice',prefix+'/voice','audio/wav',source,`'${id(222021)}'::uuid`,`'${id(222023)}'::uuid`);
 await db.exec('ALTER TABLE provider_workload_leases DISABLE TRIGGER ALL');
 await db.query(`INSERT INTO provider_workload_leases(id,slot,account_id,workspace_id,request_kind,generation_request_id,owner_token_sha256,state,acquired_at,heartbeat_at,expires_at,released_at,release_reason)
 VALUES($1,1,$2,$3,'VIDEO',$4,$5,'RELEASED',now(),now(),now()+interval '1 hour',now(),'HOSTED_API_OUTPUTS_ACCEPTED')`,[id(222041),IDS.accountA,IDS.workspaceA,request,hash]);
 await db.exec('ALTER TABLE provider_workload_leases ENABLE TRIGGER ALL');
 await db.exec(migration);
 // Explicit component fixture: no provider calls; verify the production predicate is required before substituting an accepted-provider proof.
 await assert.rejects(prepare(db),/accepted source proof invalid/);
 await db.exec(`CREATE OR REPLACE FUNCTION public.videoforge_v209_api_outputs_accepted(checked_account_id uuid,checked_workspace_id uuid,checked_generation_request_id uuid,checked_runtime_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT true$$`);
 return{db,canon,prefix,uri,uri2};
}
async function artifact(db,label,object,type,attempt,receiptExpr,reservationExpr){
 await db.query(`INSERT INTO artifact_reservations(id,account_id,workspace_id,project_id,project_revision_id,lane,job_id,artifact_id,object_key,method,content_type,
 content_length,checksum_sha256,expires_at,max_uses,used_count,state,retention_class,deletion_owner_account_id)
 VALUES(${reservationExpr},$1,$2,$3,$4,'RENDER',$5,$6,$7,'PUT',$8,100,$9,now()+interval '1 hour',1,1,'COMMITTED','FINAL',$1)`,[IDS.accountA,IDS.workspaceA,IDS.projectA,IDS.revisionA,attempt,object.split("/artifact/")[1],object,type,hash]);
 await db.query(`INSERT INTO artifact_receipts(id,account_id,workspace_id,reservation_id,callback_id,object_key,content_type,content_length,checksum_sha256,probe,receipt_sha256,committed_at)
 VALUES(${receiptExpr},$1,$2,${reservationExpr},$3,$4,$5,100,$6,'{}',$7,now())`,[IDS.accountA,IDS.workspaceA,attempt+":"+label,object,type,hash,"sha256:"+createHash("sha256").update(label).digest("hex")]);
}
async function prepare(db,newRun=run,idempotency=key){return(await db.query('SELECT public.videoforge_prepare_cloud_render_only_run($1,$2,$3,$4,$5,$6,$7,$8) result',[IDS.accountA,IDS.workspaceA,IDS.userA,IDS.projectA,source,idempotency,newRun,hash])).rows[0].result;}
async function isolated(db,work){await db.exec('BEGIN');try{await work();}finally{await db.exec('ROLLBACK');}}
test('222 exact accepted source, fresh immutable run, bounded idempotency and provider-inert cancellation',async t=>{
 const{db}=await fixture();try{
 const before=(await db.query('SELECT to_jsonb(v) facts FROM video_runtime_states v WHERE id=$1',[runtime])).rows[0].facts;
 const prepared=await prepare(db);assert.equal(prepared.retry_attempt_id,run);assert.equal(prepared.recovery_key,'render-only:'+run);
 assert.deepEqual(await prepare(db,id(222099)),prepared);
 const readback=(await db.query('SELECT public.videoforge_read_cloud_render_only_run($1) run',[run])).rows[0].run;
 assert.equal(readback.attemptId,run);assert.equal(readback.accountId,IDS.accountA);assert.equal(readback.sourceAttemptId,source);
 await t.test('source backend and successful final remain immutable',async()=>{
  assert.deepEqual((await db.query('SELECT to_jsonb(v) facts FROM video_runtime_states v WHERE id=$1',[runtime])).rows[0].facts,before);
  assert.equal((await db.query('SELECT execution_backend FROM hosted_cpu_job_attempts WHERE id=$1',[source])).rows[0].execution_backend,'PERSONAL_WORKER');
  assert.equal((await db.query('SELECT state FROM generation_requests WHERE id=$1',[request])).rows[0].state,'SUCCEEDED');
 });
 await t.test('wrong tenant cannot read or prepare a run',()=>isolated(db,async()=>{
  await db.query("SELECT set_config('videoforge.account_id',$1,true)",[IDS.accountB]);assert.equal((await db.query('SELECT videoforge_read_cloud_render_only_run($1) run',[run])).rows[0].run,null);await assert.rejects(prepare(db),/owner scope rejected/);
 }));
 await t.test('idempotency conflicting release is rejected',()=>isolated(db,async()=>{await assert.rejects(db.query('SELECT videoforge_prepare_cloud_render_only_run($1,$2,$3,$4,$5,$6,$7,$8)',[IDS.accountA,IDS.workspaceA,IDS.userA,IDS.projectA,source,key,id(222099),'sha256:'+'b'.repeat(64)]),/idempotency conflict/);}));
 await t.test('no ordinary runtime can be fabricated for new request',()=>isolated(db,async()=>{
  await assert.rejects(db.query(`INSERT INTO video_runtime_states SELECT(jsonb_populate_record(NULL::video_runtime_states,to_jsonb(v)||jsonb_build_object('id',$1::text,'generation_request_id',$2::text))).* FROM video_runtime_states v WHERE v.id=$3`,[id(222080),readback.generationRequestId,runtime]),/cannot generate provider work or runtime/);
 }));
 await t.test('source input identity cannot be rewritten',()=>isolated(db,async()=>{await assert.rejects(db.query('UPDATE hosted_render_only_runs SET source_attempt_id=$1 WHERE id=$2',[id(222099),run]),/lineage is immutable/);}));
 await t.test('normal project Cancel affects only fresh request and preserves accepted source',async()=>{
 const result=(await db.query('SELECT * FROM videoforge_cancel_hosted_project_predispatch($1,$2,$3)',[IDS.accountA,IDS.workspaceA,IDS.projectA])).rows[0];assert.equal(result.state,'CANCELLED');
 assert.deepEqual((await db.query('SELECT to_jsonb(v) facts FROM video_runtime_states v WHERE id=$1',[runtime])).rows[0].facts,before);
 assert.equal((await db.query('SELECT state FROM generation_requests WHERE id=$1',[request])).rows[0].state,'SUCCEEDED');
 });
 await t.test('fresh accepted Cloud output promotes own receipt once and preserves original final',async()=>{
  const target=id(222050);await prepare(db,target,id(222051));
  const newRequest=(await db.query('SELECT generation_request_id FROM hosted_render_only_runs WHERE id=$1',[target])).rows[0].generation_request_id;
  const prefix=`tenant/${IDS.accountA}/workspace/${IDS.workspaceA}/project/${IDS.projectA}/revision/${IDS.revisionA}/lane/render/job/${target}/artifact`;
  await db.query(`INSERT INTO hosted_cpu_job_attempts SELECT(jsonb_populate_record(NULL::hosted_cpu_job_attempts,to_jsonb(a)||
   jsonb_build_object('id',$1::text,'execution_backend','RUNPOD_POD','submission_idempotency_key','render-only:'||$1::text,
    'state','OUTBOXED','submitted_at',NULL,'terminal_at',NULL,'result_receipt_sha256',NULL,'result_checksum_sha256',NULL,'result_content_length',NULL,
    'job_spec_object_key',$2::text,'result_object_key',$3::text))).* FROM hosted_cpu_job_attempts a WHERE a.id=$4`,[target,prefix+'/job-spec',prefix+'/result-document',source]);
  const artifacts=(await db.query('SELECT id,object_key,content_type,content_length,checksum_sha256 FROM artifact_receipts WHERE id=ANY($1::uuid[])',[[id(222020),id(222021)]])).rows;
  for(const a of artifacts)await db.query(`INSERT INTO media_worker_input_objects(id,account_id,workspace_id,attempt_id,uri,object_key,content_type,content_length,checksum_sha256)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[id(a.id===id(222020)?222060:222061),IDS.accountA,IDS.workspaceA,target,a.id===id(222020)?`vf-local://objects/sha256/aa/${'a'.repeat(64)}.json`:`vf-local://objects/sha256/aa/${'a'.repeat(64)}.wav`,a.object_key,a.content_type,a.content_length,a.checksum_sha256]);
  assert.equal((await db.query('SELECT videoforge_cloud_render_inputs_valid($1) valid',[target])).rows[0].valid,true);
  // Component metadata models the genuine successful source's completed bridge/prompts.
  // The existing accepted-provider predicate is still the explicit fixture above.
  await db.exec('ALTER TABLE hosted_canonical_timing_bridges DISABLE TRIGGER ALL');
  await db.query(`INSERT INTO hosted_canonical_timing_bridges(hosted_asr_attempt_id,account_id,workspace_id,project_id,
   project_revision_id,transcript_id,transcript_document_hash,timeline_plan_id,timeline_document_hash,asr_input_sha256,
   asr_result_sha256,generation_plan_sha256,task_manifest,append_payload,completed_at)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$7,$7,$7,$7,'[{}]','{"schema_version":"videoforge-hosted-canonical-timing-append/v1"}',now())`,
   [source,IDS.accountA,IDS.workspaceA,IDS.projectA,IDS.revisionA,id(223001),hash,id(223002)]);
  await db.exec('ALTER TABLE hosted_canonical_timing_bridges ENABLE TRIGGER ALL');
  await db.exec('ALTER TABLE generation_tasks DISABLE TRIGGER ALL');
  await db.query(`INSERT INTO generation_tasks(id,account_id,workspace_id,owner_type,owner_id,project_revision_id,
   task_key,lane,state,required,finished_at) VALUES($1,$2,$3,'PROJECT_REVISION',$4,$4,'prompt:scene-batch:accepted','PROMPT','COMPLETE',true,now())`,
   [id(223003),IDS.accountA,IDS.workspaceA,IDS.revisionA]);
  await db.exec('ALTER TABLE generation_tasks ENABLE TRIGGER ALL');
  const args=[IDS.accountA,IDS.workspaceA,IDS.userA,IDS.projectA];
  await assert.rejects(db.query('SELECT videoforge_admit_hosted_v209_generation($1,$2,$3,$4)',args),/cannot generate provider work or runtime/);
  assert.equal((await db.query('SELECT state FROM generation_requests WHERE id=$1',[newRequest])).rows[0].state,'WAITING');
  await db.exec(read('0223_hosted_cloud_render_only_admission.sql'));
  // Exercise the actual outer application RPC, including archive/stranded settlement.
  const admitted=(await db.query('SELECT videoforge_admit_hosted_v209_generation($1,$2,$3,$4)',args)).rows;
  await assert.rejects(db.exec(read('0223_hosted_cloud_render_only_admission.sql')),/preimage mismatch/);
  assert.ok(admitted.length>0);assert.equal((await db.query('SELECT state FROM generation_requests WHERE id=$1',[newRequest])).rows[0].state,'ACTIVE');
  assert.equal((await db.query('SELECT count(*) n FROM video_runtime_states WHERE generation_request_id=$1',[newRequest])).rows[0].n,0);
  await db.exec('ALTER TABLE hosted_cpu_job_attempts DISABLE TRIGGER ALL');await db.query(`UPDATE hosted_cpu_job_attempts SET state='SUCCEEDED',submitted_at=now(),terminal_at=now(),result_receipt_sha256=$2,result_checksum_sha256=$2,result_content_length=100 WHERE id=$1`,[target,hash]);await db.exec('ALTER TABLE hosted_cpu_job_attempts ENABLE TRIGGER ALL');
  for(const[n,kind,object,type]of[[1,'PRIMARY_RESULT_OUTPUT',prefix+'/result','video/mp4'],[2,'RESULT_DOCUMENT',prefix+'/result-document','application/json']])await db.query(`INSERT INTO hosted_cpu_upload_authorities(id,account_id,workspace_id,attempt_id,source,object_key,content_type,max_bytes,issued_at,issued_content_length,issued_checksum_sha256)
   VALUES($1,$2,$3,$4,$5,$6,$7,10000,now(),100,$8)`,[id(222070+n),IDS.accountA,IDS.workspaceA,target,kind,object,type,hash]);
  await db.query(`INSERT INTO cloud_media_budget_authorities(id,allowed_account_ids,allowed_project_ids,total_cap_usd,max_reservation_usd,max_hourly_usd,max_rental_seconds,image,source_sha256,runtime_sha256,expires_at)
   VALUES($1,ARRAY[$2]::uuid[],ARRAY[$3]::uuid[],3,.2,.8,900,'fixture@'||$4,$4,$4,now()+interval '1 hour')`,[authority,IDS.accountA,IDS.projectA,hash]);
  await db.query(`INSERT INTO cloud_media_reservations(id,account_id,workspace_id,project_id,project_revision_id,attempt_id,leased_attempt_id,fence_id,capability_sha256,pod_name,image,source_sha256,runtime_sha256,tooling,disk_gb,max_hourly_usd,budget_usd,rental_seconds,state,placement_deadline_at,cleanup_verified_at,budget_authority_id,launch_outcome,verified_at,pod_id)
   VALUES($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,'fixture@'||$8,$8,$8,'{}',100,.8,.2,900,'CLEAN',now()+interval '1 hour',now(),$10,'CONFIRMED',now(),'fixture-pod')`,[reservation,IDS.accountA,IDS.workspaceA,IDS.projectA,IDS.revisionA,target,id(222080),hash,'videoforge-media-'+reservation,authority]);
  await db.query('INSERT INTO cloud_media_jobs(attempt_id,account_id,workspace_id,reservation_id,claimed_at) VALUES($1,$2,$3,$4,now()-interval \'1 second\')',[target,IDS.accountA,IDS.workspaceA,reservation]);
  const finalOutput={assetId:'render-only-output',checksumSha256:hash,contentLength:100,contentType:'video/mp4',objectKey:prefix+'/result',renderManifestSha256:hash,resultDocumentSha256:hash,
   probe:{schema_version:'technical-probe/v1',asset_id:'render-only-output',sha256:hash,bytes:100,container:'mp4',duration_ms:30000,total_frames:900,decode_ok:true,video:{codec:'h264',pixel_format:'yuv420p',width:1920,height:1080,fps_num:30,fps_den:1},audio:{codec:'aac',sample_rate_hz:48000},stream_counts:{video:1,audio:1,subtitle:0,data:0}}};
  const supplied={schemaVersion:'videoforge.v2-09-render-terminal-finalize/v1',accountId:IDS.accountA,workspaceId:IDS.workspaceA,attemptId:target,finalOutput};
  await assert.rejects(db.query('SELECT videoforge_finalize_v209_render_terminal($1) result',[supplied]),/completion proof rejected/);
  await db.query(`INSERT INTO hosted_cpu_job_events(id,account_id,workspace_id,attempt_id,sequence,kind,facts_sha256,occurred_at)
   VALUES($1,$2,$3,$4,1,'SUCCEEDED','sha256:'||encode(sha256(convert_to($5::text||':SUCCEEDED:'||$6::text,'UTF8')),'hex'),now())`,[id(222081),IDS.accountA,IDS.workspaceA,target,reservation,hash]);
  const candidate=(await db.query('SELECT videoforge_read_v209_render_terminal_candidate($1,$2,$3) candidate',[IDS.accountA,IDS.workspaceA,target])).rows[0].candidate;
  assert.equal(candidate.renderOnlyRun,true);assert.equal(candidate.runtimeStage,'COMPLETE');assert.equal(candidate.generationRequestId,newRequest);assert.equal(candidate.leaseState,'ACTIVE');
  const result=(await db.query('SELECT videoforge_finalize_v209_render_terminal($1) result',[supplied])).rows[0].result;
  assert.equal(result.state,'SUCCEEDED');assert.equal(result.replayed,false);assert.equal(result.runtimeId,runtime);
  assert.equal((await db.query('SELECT videoforge_finalize_v209_render_terminal($1) result',[supplied])).rows[0].result.replayed,true);
  assert.equal((await db.query('SELECT state FROM generation_requests WHERE id=$1',[newRequest])).rows[0].state,'SUCCEEDED');
  assert.equal((await db.query('SELECT count(*) n FROM hosted_project_reviews WHERE render_attempt_id=$1',[target])).rows[0].n,0);
  assert.deepEqual((await db.query('SELECT to_jsonb(v) facts FROM video_runtime_states v WHERE id=$1',[runtime])).rows[0].facts,before);
 });
 await t.test('no budget/account scope is enabled by migration',async()=>{
 assert.equal((await db.query('SELECT videoforge_cloud_media_new_project_ready($1) ready',[authority])).rows[0].ready,false);
 assert.equal((await db.query("SELECT has_table_privilege($1,'cloud_media_budget_authorities','SELECT') allowed",[role])).rows[0].allowed,false);
 });
 }finally{await db.close();}
});

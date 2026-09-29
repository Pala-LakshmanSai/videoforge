import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { PGliteExecutor } from './support/pglite.mjs';
import { IDS, seedLockedProjects } from './support/fixtures.mjs';
const read = name => readFileSync(new URL('../migrations/' + name, import.meta.url), 'utf8');
const prior = read('0214_optional_runpod_media.sql');
const migration = read('0218_hosted_cloud_preprovider_media.sql');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hash = 'sha256:' + 'a'.repeat(64);
const project = id(218300), revision = id(218301), asr = id(218302), timeline = id(218303), transcript = id(218304);
const sqlFn = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const settlePatch = migration.slice(migration.indexOf(' old_render_failure:='), migration.indexOf(' definition:=replace('));
const failureMigration = `DO $migration$ DECLARE failure_definition text;old_failure text;new_failure text;old_render_failure text;new_render_failure text; BEGIN
 SELECT pg_get_functiondef('public.videoforge_settle_cloud_media_cpu_failure(uuid)'::regprocedure) INTO failure_definition;
 ${settlePatch.slice(0, settlePatch.indexOf(' IF (length(definition)'))}
 IF (length(failure_definition)-length(replace(failure_definition,old_failure,'')))/length(old_failure)<>1 THEN
 RAISE EXCEPTION 'cloud pre-provider media reviewed preimage mismatch'; END IF;
 failure_definition:=replace(failure_definition,old_failure,new_failure);
 ${migration.slice(migration.indexOf(' failure_definition:=replace(failure_definition,old_render_failure'),migration.indexOf(' EXECUTE render_definition;'))}
 EXECUTE failure_definition; END; $migration$;`;

async function fullFixture() {
 const db = new PGlite({ extensions: { pgcrypto } });
 await db.exec('CREATE EXTENSION pgcrypto');
 const executor = new PGliteExecutor(db);
 const manifest = JSON.parse(read('manifest.json'));
 for (const m of manifest.migrations.filter(row => row.version <= 217)) {
  if (m.version === 195) continue; // Deployment-owned omitted objects, same existing qualification test boundary.
  const sql = read(m.filename);
  assert.equal('sha256:' + createHash('sha256').update(sql).digest('hex'), m.sha256);
  await executor.execute(sql);
 }
 await seedLockedProjects(executor);
 await db.query("SELECT set_config('videoforge.account_id',$1,false)", [IDS.accountA]);
 await db.query(`INSERT INTO projects(id,workspace_id,owner_user_id,name,normalized_name,generation_provider)
 VALUES($1,$2,$3,'Pre-provider media','pre-provider media','KIE_FAL')`, [project,IDS.workspaceA,IDS.userA]);
 await db.query(`INSERT INTO project_revisions SELECT (jsonb_populate_record(NULL::project_revisions,
 to_jsonb(r)||jsonb_build_object('id',$1::text,'project_id',$2::text,'media_execution_backend','RUNPOD_POD','created_at',now(),'locked_at',now()))).*
 FROM project_revisions r WHERE r.id=$3`, [revision,project,IDS.revisionA]);
 const prefix=`tenant/${IDS.accountA}/workspace/${IDS.workspaceA}/project/${project}/revision/${revision}/lane/input/job/${asr}/artifact`;
 await db.query(`INSERT INTO hosted_cpu_job_attempts(id,account_id,workspace_id,project_id,project_revision_id,kind,state,
 execution_backend,execution_bundle_sha256,request_sha256,job_spec_object_key,job_spec_content_length,job_spec_checksum_sha256,
 result_object_key,image_digest,callback_token_sha256,deadline_at,submitted_at,terminal_at,result_receipt_sha256,result_checksum_sha256)
 VALUES($1,$2,$3,$4,$5,'ASR','SUCCEEDED','RUNPOD_POD',$6,$6,$7,100,$6,$8,$6,$6,now()+interval '1 hour',now(),now(),$6,$6)`,
 [asr,IDS.accountA,IDS.workspaceA,project,revision,hash,prefix+'/job-spec',prefix+'/result-document']);
 // Malformed bridge is deliberate fixture metadata: actual runtime checks must reject it once
 // the prompt barrier completes. No live ASR/timeline/accepted media evidence is claimed here.
 await db.exec('ALTER TABLE hosted_canonical_timing_bridges DISABLE TRIGGER ALL');
 await db.query(`INSERT INTO hosted_canonical_timing_bridges(hosted_asr_attempt_id,account_id,workspace_id,project_id,
 project_revision_id,transcript_id,transcript_document_hash,timeline_plan_id,timeline_document_hash,asr_input_sha256,
 asr_result_sha256,generation_plan_sha256,task_manifest,append_payload,completed_at)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$7,$7,$7,$7,$9,'{"schema_version":"videoforge-hosted-canonical-timing-append/v1"}',now())`,
 [asr,IDS.accountA,IDS.workspaceA,project,revision,transcript,hash,timeline,JSON.stringify([{id:id(218310),task_key:'avatar:one',lane:'AVATAR',timeline_segment_id:id(218320)}])]);
 await db.exec('ALTER TABLE hosted_canonical_timing_bridges ENABLE TRIGGER ALL');
 return {db,executor};
}
const admit = async (db, account=IDS.accountA, workspace=IDS.workspaceA,user=IDS.userA,target=project) =>
 (await db.query('SELECT videoforge_admit_hosted_v209_generation($1,$2,$3,$4) value',[account,workspace,user,target])).rows[0].value;
const count = async (db, table, where='') => (await db.query(`SELECT count(*)::int n FROM ${table} ${where}`)).rows[0].n;
async function prompt(db,n,state,required=true) {
 await db.query(`INSERT INTO generation_tasks(id,account_id,workspace_id,owner_type,owner_id,project_revision_id,
 task_key,lane,state,required,finished_at) VALUES($1,$2,$3,'PROJECT_REVISION',$4,$4,$5,'PROMPT',$6,$7,CASE WHEN $6='COMPLETE' THEN now() END)`,
 [id(n),IDS.accountA,IDS.workspaceA,revision,`prompt:scene-batch:${n}`,state,required]);
}
async function isolated(db, fn) { await db.exec('BEGIN'); try { await fn(); } finally { await db.exec('ROLLBACK'); } }
async function rejectedWithoutAdmission(db, fn, message) {
 const before=[await count(db,'generation_requests'),await count(db,'provider_workload_leases'),await count(db,'generation_queue_audits')];
 await db.exec('SAVEPOINT rejected'); await assert.rejects(fn, message); await db.exec('ROLLBACK TO SAVEPOINT rejected');
 assert.deepEqual([await count(db,'generation_requests'),await count(db,'provider_workload_leases'),await count(db,'generation_queue_audits')],before);
}

const renderAttempt=id(218400);
async function renderFixture(db) {
 // Exact normalized front-door identities are used; these SQL fixtures prove guards, not a live submission.
 await db.query("UPDATE hosted_cpu_job_attempts SET state='FAILED' WHERE id=$1",[asr]);
 const refs=[];
 for(let n=0;n<3;n++){
  const sha='sha256:'+String(n+1).repeat(64),uri=`vf-local://objects/sha256/${sha.slice(7,9)}/${sha.slice(7)}.bin`;
  const key=`tenant/${IDS.accountA}/workspace/${IDS.workspaceA}/project/${project}/revision/${revision}/lane/input/job/${renderAttempt}/artifact/input-${n}`;
  await db.query(`INSERT INTO artifact_reservations(id,account_id,workspace_id,project_id,project_revision_id,lane,job_id,artifact_id,
   object_key,method,content_type,content_length,checksum_sha256,expires_at,max_uses,state,retention_class,deletion_owner_account_id)
   VALUES($1,$2,$3,$4,$5,'INPUT',$6,$7,$8,'PUT','application/octet-stream',100,$9,now()+interval '1 hour',1,'COMMITTED','PROJECT',$2)`,
   [id(218410+n),IDS.accountA,IDS.workspaceA,project,revision,renderAttempt,'input-'+n,key,sha]);
  await db.query(`INSERT INTO artifact_receipts(id,account_id,workspace_id,reservation_id,callback_id,object_key,content_type,content_length,
   checksum_sha256,receipt_sha256,committed_at) VALUES($1,$2,$3,$4,$5,$6,'application/octet-stream',100,$7,$8,now())`,
   [id(218420+n),IDS.accountA,IDS.workspaceA,id(218410+n),'receipt-'+n,key,sha,'sha256:'+String(n+4).repeat(64)]);
  refs.push({asset_id:'asset-'+n,sha256:sha,artifact_uri:uri,...(n?{kind:n===1?'VOICEOVER':'IMAGE'}:{})});
 }
 const input={schema_version:'render-job-input/v1',project_revision_id:revision,attempt_id:'unbound-render',resolved_render_manifest:refs[0],assets:refs.slice(1),
  output:{result_uri:'vf-local-run://project/render/final.mp4',filename:'final.mp4'},tools:{ffmpeg_version:'8.1.2',ffprobe_version:'8.1.2'},cancel_token:'x'.repeat(32)};
 const objects=refs.map((ref,n)=>({artifact_receipt_id:id(218420+n),uri:ref.artifact_uri}));
 const payload={schema_version:'videoforge-hosted-cpu-submission/v1',project_id:project,project_revision_id:revision,kind:'RENDER',idempotency_key:'normal-render',input_document:input,objects};
 await db.query(`INSERT INTO hosted_render_plans(account_id,workspace_id,project_id,project_revision_id,schema_version,payload,payload_sha256)
 VALUES($1,$2,$3,$4,'videoforge-hosted-cpu-submission/v1',$5,'sha256:'||encode(sha256(convert_to(videoforge_canonical_jsonb($5::jsonb),'UTF8')),'hex'))`,
 [IDS.accountA,IDS.workspaceA,project,revision,JSON.stringify(payload)]);
 const normalized={idempotencyKey:payload.idempotency_key,projectId:project,projectRevisionId:revision,kind:'RENDER',inputDocument:input,objects:objects.map(o=>({receiptId:o.artifact_receipt_id,uri:o.uri}))};
 const prefix=`tenant/${IDS.accountA}/workspace/${IDS.workspaceA}/project/${project}/revision/${revision}/lane/render/job/${renderAttempt}/artifact`;
 await db.query(`INSERT INTO hosted_cpu_job_attempts(id,account_id,workspace_id,project_id,project_revision_id,kind,state,execution_backend,execution_bundle_sha256,
  request_sha256,job_spec_object_key,job_spec_content_length,job_spec_checksum_sha256,result_object_key,image_digest,callback_token_sha256,deadline_at)
 VALUES($1,$2,$3,$4,$5,'RENDER','OUTBOXED','RUNPOD_POD',$6,'sha256:'||encode(sha256(convert_to(videoforge_canonical_jsonb($7::jsonb),'UTF8')),'hex'),$8,100,$6,$9,$6,$6,now()+interval '1 hour')`,
 [renderAttempt,IDS.accountA,IDS.workspaceA,project,revision,hash,JSON.stringify(normalized),prefix+'/job-spec',prefix+'/result-document']);
 for(let n=0;n<3;n++)await db.query(`INSERT INTO media_worker_input_objects(id,account_id,workspace_id,attempt_id,uri,object_key,content_type,content_length,checksum_sha256)
 SELECT $1,$2,$3,$4,$5,object_key,content_type,content_length,checksum_sha256 FROM artifact_receipts WHERE id=$6`,[id(218430+n),IDS.accountA,IDS.workspaceA,renderAttempt,refs[n].artifact_uri,id(218420+n)]);
}
const renderProof=async db=>(await db.query('SELECT videoforge_cloud_render_inputs_valid($1) valid',[renderAttempt])).rows[0].valid;
async function mutate(db,table,sql){await db.exec(`ALTER TABLE ${table} DISABLE TRIGGER ALL`);await db.exec(sql);await db.exec(`ALTER TABLE ${table} ENABLE TRIGGER ALL`);}

test('218 real prior-schema admission defers only pre-provider Cloud media and preserves later runtime gates',async t=>{
 const {db}=await fullFixture();
 try {
  await assert.rejects(()=>admit(db),/runtime task manifest invalid/); // Reproduce the actual pre-218 bridge-present defect.
  assert.equal(await count(db,'provider_workload_leases'),0);
  const before=(await db.query("SELECT pg_get_functiondef('videoforge_admit_hosted_v209_generation_after_reclaim(uuid,uuid,uuid,uuid)'::regprocedure) definition")).rows[0].definition;
  await db.exec(migration);
  const after=(await db.query("SELECT pg_get_functiondef('videoforge_admit_hosted_v209_generation_after_reclaim(uuid,uuid,uuid,uuid)'::regprocedure) definition")).rows[0].definition;
  assert.equal((after.match(/PERFORM public.videoforge_prepare_hosted_v209_runtime/g)||[]).length,3);
  assert.equal((after.match(/OR \(NOT EXISTS \(/g)||[]).length,3);
  assert.equal(before.includes('AND NOT EXISTS(SELECT 1 FROM public.hosted_canonical_timing_bridges bridge'),true);
  assert.equal((await db.query("SELECT has_function_privilege('public','videoforge_admit_hosted_v209_generation(uuid,uuid,uuid,uuid)','EXECUTE') allowed")).rows[0].allowed,false);
  assert.equal((await db.query("SELECT has_function_privilege('public','videoforge_settle_cloud_media_cpu_failure(uuid)','EXECUTE') allowed")).rows[0].allowed,false);
  assert.equal((await db.query("SELECT has_function_privilege('videoforge_v209_runtime_dc9612d6','videoforge_settle_cloud_media_cpu_failure(uuid)','EXECUTE') allowed")).rows[0].allowed,true);
  await t.test('same admitted VIDEO and exact lease renew with bridge and absent prompts; idempotent admission creates no runtime/API work',()=>isolated(db,async()=>{
   const first=await admit(db);assert.equal(first.state,'ACTIVE');assert.deepEqual(await admit(db),first);
   await db.exec('ALTER TABLE provider_workload_leases DISABLE TRIGGER ALL');
   await db.query(`UPDATE provider_workload_leases SET acquired_at=now()-interval '2 hours',heartbeat_at=now()-interval '2 hours',expires_at=now()-interval '1 hour',version=version+1 WHERE generation_request_id=$1`,[first.generationRequestId]);
   await db.exec('ALTER TABLE provider_workload_leases ENABLE TRIGGER ALL');
   const lease=(await db.query('SELECT id,version FROM provider_workload_leases WHERE generation_request_id=$1',[first.generationRequestId])).rows[0];
   assert.deepEqual(await admit(db),first);
   const renewed=(await db.query('SELECT id,version,expires_at>now() live FROM provider_workload_leases WHERE generation_request_id=$1',[first.generationRequestId])).rows[0];
   assert.deepEqual(renewed,{id:lease.id,version:lease.version+1,live:true});
   assert.equal(await count(db,'provider_workload_leases'),1);assert.equal(await count(db,'video_runtime_states'),0);assert.equal(await count(db,'hosted_api_generation_jobs'),0);
   assert.equal(await count(db,'generation_queue_audits',"WHERE operation='HEARTBEAT'"),1);
  }));
  await t.test('a completed scene batch plus required incomplete scene batch remains pre-provider',()=>isolated(db,async()=>{
   await prompt(db,218330,'COMPLETE');await prompt(db,218331,'READY');assert.equal((await admit(db)).state,'ACTIVE');assert.equal(await count(db,'video_runtime_states'),0);
  }));
  await t.test('provider-ready prompt barrier restores exact malformed runtime rejection and admission rollback',()=>isolated(db,async()=>{
   await prompt(db,218330,'COMPLETE');await rejectedWithoutAdmission(db,()=>admit(db),/runtime task manifest invalid/);
  }));
  await t.test('provider-ready complete IMAGE/AVATAR manifest initializes both original runtime lanes',()=>isolated(db,async()=>{
   await prompt(db,218330,'COMPLETE');
   const tasks=[{id:id(218311),task_key:'image:one',lane:'IMAGE',timeline_segment_id:id(218321)},{id:id(218310),task_key:'avatar:one',lane:'AVATAR',timeline_segment_id:id(218320)}];
   await db.exec('ALTER TABLE hosted_canonical_timing_bridges DISABLE TRIGGER ALL');await db.query('UPDATE hosted_canonical_timing_bridges SET task_manifest=$1 WHERE hosted_asr_attempt_id=$2',[JSON.stringify(tasks),asr]);await db.exec('ALTER TABLE hosted_canonical_timing_bridges ENABLE TRIGGER ALL');
   await db.exec('ALTER TABLE timeline_segments DISABLE TRIGGER ALL');
   for(const [i,task] of tasks.entries()){
    await db.query(`INSERT INTO generation_tasks(id,account_id,workspace_id,owner_type,owner_id,project_revision_id,task_key,lane,state) VALUES($1,$2,$3,'PROJECT_REVISION',$4,$4,$5,$6,'BLOCKED')`,[task.id,IDS.accountA,IDS.workspaceA,revision,task.task_key,task.lane]);
    await db.query(`INSERT INTO timeline_segments(id,account_id,workspace_id,project_revision_id,segment_index,start_frame,end_frame_exclusive,
    timeline_composition,in_image_shot_role,narration,required_slots,timeline_plan_hash,timeline_plan_id,segment_key,source_audio_start_ms,source_audio_end_ms_exclusive,word_start,word_end_exclusive)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'fixture narration','{}',$10,$11,$12,0,3000,0,1)`,[task.timeline_segment_id,IDS.accountA,IDS.workspaceA,revision,i,i*90,(i+1)*90,task.lane==='IMAGE'?'IMAGE_FULL':'AVATAR_FULL',task.lane==='IMAGE'?'ENVIRONMENTAL_WIDE':null,hash,timeline,'segment:'+i]);
   }
   await db.exec('ALTER TABLE timeline_segments ENABLE TRIGGER ALL');assert.equal((await admit(db)).state,'ACTIVE');assert.equal(await count(db,'video_runtime_states'),1);assert.equal(await count(db,'video_runtime_lane_states'),2);assert.equal(await count(db,'hosted_api_generation_jobs'),0);
  }));
  for(const [label,change] of [
   ['stale ASR deadline',`UPDATE hosted_cpu_job_attempts SET created_at=now()-interval '2 hours',deadline_at=now()-interval '1 hour' WHERE id='${asr}'`],
   ['failed ASR',`UPDATE hosted_cpu_job_attempts SET state='FAILED' WHERE id='${asr}'`],
  ])await t.test(label+' does not gain Cloud admission',()=>isolated(db,async()=>{await db.exec(change);await rejectedWithoutAdmission(db,()=>admit(db),/prompts are not ready/);}));
  await t.test('immutable ASR backend substitution is rejected before admission',()=>isolated(db,async()=>{await rejectedWithoutAdmission(db,()=>db.query("UPDATE hosted_cpu_job_attempts SET execution_backend='PERSONAL_WORKER' WHERE id=$1",[asr]),/execution identity is immutable/);}));
  await t.test('Local revision preserves prompt barrier',()=>isolated(db,async()=>{await db.exec("ALTER TABLE project_revisions DISABLE TRIGGER ALL");await db.query("UPDATE project_revisions SET media_execution_backend='PERSONAL_WORKER' WHERE id=$1",[revision]);await db.exec("ALTER TABLE project_revisions ENABLE TRIGGER ALL");await rejectedWithoutAdmission(db,()=>admit(db),/prompts are not ready/);}));
  await t.test('cross-tenant owner cannot use Cloud ASR exception',()=>isolated(db,async()=>{await db.query("SELECT set_config('videoforge.account_id',$1,false)",[IDS.accountB]);await rejectedWithoutAdmission(db,()=>admit(db,IDS.accountB,IDS.workspaceB,IDS.userB,project),/tenant or project scope invalid/);}));
  await t.test('normal ready render admits without ASR/prompts and renews the same fair VIDEO without runtime/API',()=>isolated(db,async()=>{
   await renderFixture(db);await mutate(db,'hosted_canonical_timing_bridges',`DELETE FROM hosted_canonical_timing_bridges WHERE hosted_asr_attempt_id='${asr}'`);await db.query('DELETE FROM hosted_cpu_job_attempts WHERE id=$1',[asr]);assert.equal(await renderProof(db),true);const active=await admit(db);assert.equal(active.state,'ACTIVE');assert.deepEqual(await admit(db),active);
   assert.equal(await count(db,'provider_workload_leases'),1);assert.equal(await count(db,'video_runtime_states'),0);assert.equal(await count(db,'hosted_api_generation_jobs'),0);
   assert.equal((await db.query("SELECT has_function_privilege('public','videoforge_cloud_render_inputs_valid(uuid)','EXECUTE') allowed")).rows[0].allowed,false);
   assert.equal((await db.query('SELECT request_sha256<>(SELECT payload_sha256 FROM hosted_render_plans WHERE project_revision_id=$2) distinct_hash FROM hosted_cpu_job_attempts WHERE id=$1',[renderAttempt,revision])).rows[0].distinct_hash,true);
  }));
  for(const [label,table,change] of [
   ['plan without ready attempt','hosted_cpu_job_attempts',`UPDATE hosted_cpu_job_attempts SET state='PLANNED' WHERE id='${renderAttempt}'`],
   ['cancelled attempt','hosted_cpu_job_attempts',`UPDATE hosted_cpu_job_attempts SET cancellation_requested_at=now() WHERE id='${renderAttempt}'`],
   ['expired attempt','hosted_cpu_job_attempts',`UPDATE hosted_cpu_job_attempts SET created_at=now()-interval '2 hours',deadline_at=now()-interval '1 hour' WHERE id='${renderAttempt}'`],
   ['wrong normalized request hash','hosted_cpu_job_attempts',`UPDATE hosted_cpu_job_attempts SET request_sha256='${hash}' WHERE id='${renderAttempt}'`],
   ['source identity drift','hosted_cpu_job_attempts',`UPDATE hosted_cpu_job_attempts SET execution_bundle_sha256='sha256:${'b'.repeat(64)}' WHERE id='${renderAttempt}'`],
   ['job-spec scope drift','hosted_cpu_job_attempts',`UPDATE hosted_cpu_job_attempts SET job_spec_object_key=replace(job_spec_object_key,'${renderAttempt}','${id(218499)}') WHERE id='${renderAttempt}'`],
   ['raw plan checksum drift','hosted_render_plans',`UPDATE hosted_render_plans SET payload_sha256='${hash}'`],
   ['input checksum drift','media_worker_input_objects',`UPDATE media_worker_input_objects SET checksum_sha256='${hash}' WHERE id='${id(218430)}'`],
   ['input size drift','media_worker_input_objects',`UPDATE media_worker_input_objects SET content_length=101 WHERE id='${id(218430)}'`],
   ['input type drift','media_worker_input_objects',`UPDATE media_worker_input_objects SET content_type='image/png' WHERE id='${id(218430)}'`],
   ['missing declared input','media_worker_input_objects',`DELETE FROM media_worker_input_objects WHERE id='${id(218430)}'`],
   ['uncommitted receipt','artifact_reservations',`UPDATE artifact_reservations SET state='CONSUMED' WHERE id='${id(218410)}'`],
   ['foreign project receipt','artifact_reservations',`UPDATE artifact_reservations SET project_id='${IDS.projectA}' WHERE id='${id(218410)}'`],
   ['missing revision alias','artifact_reservations',`UPDATE artifact_reservations SET project_revision_id='${IDS.revisionA}' WHERE id='${id(218410)}'`],
   ['deleted receipt','artifact_receipts',`UPDATE artifact_receipts SET deleted_at=now(),deletion_reason='fixture' WHERE id='${id(218420)}'`],
  ])await t.test('render readiness rejects '+label+' and rolls back admission',()=>isolated(db,async()=>{
   await renderFixture(db);await mutate(db,table,change);await rejectedWithoutAdmission(db,()=>admit(db),/prompts are not ready/);
  }));
  await t.test('ready render with complete prompts still requires exact ordinary runtime manifest',()=>isolated(db,async()=>{
   await renderFixture(db);await prompt(db,218330,'COMPLETE');await rejectedWithoutAdmission(db,()=>admit(db),/runtime task manifest invalid/);
  }));
  for(const state of ['FAILED','CANCELLED'])await t.test('unreserved normal render '+state+' releases only its exact VIDEO admission',()=>isolated(db,async()=>{
   await renderFixture(db);const active=await admit(db);await db.query(`UPDATE hosted_cpu_job_attempts SET state=$2,submitted_at=now(),terminal_at=now() WHERE id=$1`,[renderAttempt,state]);
   assert.equal((await db.query('SELECT videoforge_settle_cloud_media_cpu_failure($1) settled',[renderAttempt])).rows[0].settled,true);
   assert.equal(await count(db,'provider_workload_leases',"WHERE state='ACTIVE'"),0);assert.equal(await count(db,'cloud_media_jobs'),0);assert.equal(await count(db,'cloud_media_reservations'),0);
   assert.equal((await db.query('SELECT state FROM generation_requests WHERE id=$1',[active.generationRequestId])).rows[0].state,state);
  }));
  for(const state of ['FAILED','CANCELLED'])await t.test('no-runtime normal render '+state+' settles only after owned CLEAN and preserves committed inputs',()=>isolated(db,async()=>{
   await renderFixture(db);const active=await admit(db);
   await db.query(`UPDATE hosted_cpu_job_attempts SET state=$2,submitted_at=now(),terminal_at=now() WHERE id=$1`,[renderAttempt,state]);
   await db.query(`INSERT INTO cloud_media_budget_authorities(id,allowed_account_ids,allowed_project_ids,total_cap_usd,max_reservation_usd,
    max_hourly_usd,max_rental_seconds,image,source_sha256,runtime_sha256,expires_at)
    VALUES($1,ARRAY[$2]::uuid[],ARRAY[$3]::uuid[],3,.2,.8,900,'fixture-image@'||$4,$4,$4,now()+interval '1 hour')`,[id(218452),IDS.accountA,project,hash]);
   await db.exec('ALTER TABLE cloud_media_reservations DISABLE TRIGGER ALL');await db.exec('ALTER TABLE cloud_media_jobs DISABLE TRIGGER ALL');
   await db.query(`INSERT INTO cloud_media_reservations(id,account_id,workspace_id,project_id,project_revision_id,attempt_id,leased_attempt_id,
     fence_id,capability_sha256,pod_name,image,source_sha256,runtime_sha256,tooling,disk_gb,max_hourly_usd,budget_usd,rental_seconds,state,placement_deadline_at,cleanup_verified_at,budget_authority_id)
    VALUES($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,'fixture-image@'||$8,$8,$8,'{}',100,.8,.2,900,'CLEAN',now()+interval '1 hour',now(),'00000000-0000-4000-8000-000000218452')`,
    [id(218450),IDS.accountA,IDS.workspaceA,project,revision,renderAttempt,id(218451),hash,'videoforge-media-'+id(218450)]);
   await db.query(`INSERT INTO cloud_media_jobs(attempt_id,account_id,workspace_id,reservation_id) VALUES($1,$2,$3,$4)`,[renderAttempt,IDS.accountA,IDS.workspaceA,id(218450)]);
   await db.exec('ALTER TABLE cloud_media_reservations ENABLE TRIGGER ALL');await db.exec('ALTER TABLE cloud_media_jobs ENABLE TRIGGER ALL');
   await db.exec('SAVEPOINT missingabsence');await mutate(db,'cloud_media_reservations',`UPDATE cloud_media_reservations SET state='STOPPING',cleanup_verified_at=NULL WHERE id='${id(218450)}'`);
   assert.equal((await db.query('SELECT videoforge_settle_cloud_media_cpu_failure($1) settled',[renderAttempt])).rows[0].settled,false);await db.exec('ROLLBACK TO SAVEPOINT missingabsence');
   for(const [table,sql] of [
    ['cloud_media_jobs',`UPDATE cloud_media_jobs SET reservation_id='${id(218499)}' WHERE attempt_id='${renderAttempt}'`],
    ['cloud_media_jobs',`DELETE FROM cloud_media_jobs WHERE attempt_id='${renderAttempt}'`],
    ['cloud_media_jobs',`UPDATE cloud_media_jobs SET account_id='${IDS.accountB}' WHERE attempt_id='${renderAttempt}'`],
    ['cloud_media_reservations',`UPDATE cloud_media_reservations SET leased_attempt_id='${asr}' WHERE id='${id(218450)}'`],
   ]){
    await db.exec('SAVEPOINT malformed');await mutate(db,table,sql);
    await assert.rejects(()=>db.query('SELECT videoforge_settle_cloud_media_cpu_failure($1)',[renderAttempt]),/pre-provider render failure lineage invalid/);await db.exec('ROLLBACK TO SAVEPOINT malformed');
    assert.equal(await count(db,'provider_workload_leases',"WHERE state='ACTIVE'"),1);
   }

   assert.equal((await db.query('SELECT videoforge_settle_cloud_media_cpu_failure($1) settled',[renderAttempt])).rows[0].settled,true);
   assert.equal((await db.query('SELECT state FROM generation_requests WHERE id=$1',[active.generationRequestId])).rows[0].state,state);
   assert.equal(await count(db,'provider_workload_leases',"WHERE state='ACTIVE'"),0);assert.equal(await count(db,'artifact_receipts','WHERE deleted_at IS NULL'),3);assert.equal(await count(db,'video_runtime_states'),0);
  }));
  await t.test('failure preimage mismatch cannot partially change admission',()=>isolated(db,async()=>{
   await db.exec(before);await db.exec('SAVEPOINT preimage');await assert.rejects(db.exec(migration),/reviewed preimage mismatch/);await db.exec('ROLLBACK TO SAVEPOINT preimage');assert.equal((await db.query("SELECT pg_get_functiondef('videoforge_admit_hosted_v209_generation_after_reclaim(uuid,uuid,uuid,uuid)'::regprocedure) definition")).rows[0].definition,before);
  }));
  await t.test('migration rejects altered/repeated preimages atomically',()=>isolated(db,async()=>{await assert.rejects(db.exec(migration),/reviewed preimage mismatch/);}));
 } finally {await db.close();}
});

async function failureFixture(state='FAILED') {
 const db=new PGlite();
 const taskChecks=read('0002_relational_audit_hardening.sql').split('ADD CONSTRAINT generation_tasks_cancellation_completion_check CHECK (')[1].split('  ),')[0];
 await db.exec(`CREATE ROLE videoforge_v209_runtime_dc9612d6;
 CREATE FUNCTION videoforge_current_account_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('videoforge.account_id',true),'')::uuid $$;
 CREATE TABLE hosted_cpu_job_attempts(id uuid PRIMARY KEY,account_id uuid,workspace_id uuid,project_id uuid,project_revision_id uuid,execution_backend text,kind text,state text,terminal_at timestamptz,submitted_at timestamptz,deadline_at timestamptz,retain_until timestamptz,cancellation_requested_at timestamptz,version int DEFAULT 1,updated_at timestamptz,result_receipt_sha256 text,job_spec_checksum_sha256 text,result_checksum_sha256 text);
 CREATE TABLE generation_requests(id uuid PRIMARY KEY,account_id uuid,workspace_id uuid,project_id uuid,project_revision_id uuid,created_by_user_id uuid,state text,terminal_at timestamptz,version int DEFAULT 1,updated_at timestamptz,created_at timestamptz DEFAULT now());
 CREATE TABLE video_runtime_states(id uuid PRIMARY KEY,account_id uuid,workspace_id uuid,project_id uuid,project_revision_id uuid,generation_request_id uuid,stage text,terminal_at timestamptz,terminal_reason text,version int DEFAULT 1,updated_at timestamptz);
 CREATE TABLE hosted_v209_span_audio_materializations(attempt_id uuid,account_id uuid,workspace_id uuid,project_id uuid,project_revision_id uuid,generation_request_id uuid,user_id uuid,task_id uuid,timeline_plan_id uuid,transcript_id uuid);
 CREATE TABLE cloud_media_jobs(reservation_id uuid,attempt_id uuid,account_id uuid,workspace_id uuid);
 CREATE TABLE cloud_media_reservations(id uuid PRIMARY KEY,account_id uuid,workspace_id uuid,project_id uuid,project_revision_id uuid,state text,pod_id text,launch_outcome text,cleanup_verified_at timestamptz,failure_settled_at timestamptz,updated_at timestamptz,leased_attempt_id uuid);
 CREATE TABLE projects(id uuid PRIMARY KEY,account_id uuid,workspace_id uuid,owner_user_id uuid,generation_provider text);
 CREATE TABLE hosted_api_generation_jobs(id uuid PRIMARY KEY,generation_request_id uuid,generation_task_id uuid,state text);
 CREATE TABLE generation_tasks(id uuid PRIMARY KEY,account_id uuid,workspace_id uuid,project_revision_id uuid,owner_type text,owner_id uuid,lane text,state text,finished_at timestamptz,cancel_requested_at timestamptz,version int DEFAULT 1,updated_at timestamptz);
 CREATE TABLE video_runtime_lane_states(runtime_id uuid,lane text,state text,version int DEFAULT 1,updated_at timestamptz);
 ALTER TABLE generation_tasks ADD CHECK (${taskChecks});
 CREATE TABLE provider_workload_leases(id uuid PRIMARY KEY,account_id uuid,workspace_id uuid,generation_request_id uuid,request_kind text,state text,released_at timestamptz,release_reason text,version int DEFAULT 1,heartbeat_at timestamptz,expires_at timestamptz);
 CREATE TABLE project_revisions(id uuid PRIMARY KEY,account_id uuid,workspace_id uuid,project_id uuid,status text,media_execution_backend text,revision_number int);
 CREATE TABLE hosted_canonical_timing_bridges(account_id uuid,workspace_id uuid,project_id uuid,project_revision_id uuid,hosted_asr_attempt_id uuid,asr_input_sha256 text,asr_result_sha256 text,timeline_plan_id uuid,transcript_id uuid);
 CREATE TABLE revision_timing_heads(account_id uuid,workspace_id uuid,project_revision_id uuid,current_timeline_plan_id uuid,current_transcript_id uuid);
 CREATE TABLE serverless_attempts(id uuid,generation_request_id uuid);
 CREATE TABLE media_worker_leases(attempt_id uuid,account_id uuid,workspace_id uuid,state text);
 ${sqlFn(prior,'CREATE FUNCTION public.videoforge_settle_cloud_media_cpu_failure','CREATE OR REPLACE FUNCTION public.videoforge_cloud_media_reconciliation_scope')}`);
 await db.query("SELECT set_config('videoforge.account_id',$1,false)",[id(1)]);
 await db.exec(`INSERT INTO projects VALUES('${id(3)}','${id(1)}','${id(2)}','${id(7)}','KIE_FAL');
 INSERT INTO project_revisions VALUES('${id(4)}','${id(1)}','${id(2)}','${id(3)}','LOCKED','RUNPOD_POD',1);
 INSERT INTO generation_requests(id,account_id,workspace_id,project_id,project_revision_id,created_by_user_id,state) VALUES('${id(6)}','${id(1)}','${id(2)}','${id(3)}','${id(4)}','${id(7)}','ACTIVE');
 INSERT INTO hosted_cpu_job_attempts(id,account_id,workspace_id,project_id,project_revision_id,execution_backend,kind,state,terminal_at,submitted_at,deadline_at,result_receipt_sha256,job_spec_checksum_sha256,result_checksum_sha256)
 VALUES('${id(5)}','${id(1)}','${id(2)}','${id(3)}','${id(4)}','RUNPOD_POD','SPAN_AUDIO','${state}',now(),now(),now()+interval '1 hour',NULL,'${hash}',NULL),('${id(20)}','${id(1)}','${id(2)}','${id(3)}','${id(4)}','RUNPOD_POD','ASR','SUCCEEDED',now(),now(),now()+interval '1 hour','${hash}','${hash}','${hash}');
 INSERT INTO cloud_media_reservations(id,account_id,workspace_id,project_id,project_revision_id,state,cleanup_verified_at,leased_attempt_id)
 VALUES('${id(8)}','${id(1)}','${id(2)}','${id(3)}','${id(4)}','CLEAN',now(),'${id(5)}'),('${id(21)}','${id(1)}','${id(2)}','${id(3)}','${id(4)}','CLEAN',now(),'${id(20)}');
 INSERT INTO cloud_media_jobs VALUES('${id(8)}','${id(5)}','${id(1)}','${id(2)}'),('${id(21)}','${id(20)}','${id(1)}','${id(2)}');
 INSERT INTO provider_workload_leases(id,account_id,workspace_id,generation_request_id,request_kind,state,expires_at)
 VALUES('${id(9)}','${id(1)}','${id(2)}','${id(6)}','VIDEO','ACTIVE',now()+interval '1 hour'),('${id(99)}','${id(98)}','${id(97)}','${id(96)}','VIDEO','ACTIVE',now()+interval '1 hour');
 INSERT INTO hosted_v209_span_audio_materializations VALUES('${id(5)}','${id(1)}','${id(2)}','${id(3)}','${id(4)}','${id(6)}','${id(7)}','${id(12)}','${id(30)}','${id(31)}');
 INSERT INTO revision_timing_heads VALUES('${id(1)}','${id(2)}','${id(4)}','${id(30)}','${id(31)}');
 INSERT INTO hosted_canonical_timing_bridges VALUES('${id(1)}','${id(2)}','${id(3)}','${id(4)}','${id(20)}','${hash}','${hash}','${id(30)}','${id(31)}');
 INSERT INTO generation_tasks(id,account_id,workspace_id,project_revision_id,owner_type,owner_id,lane,state,finished_at)
 VALUES('${id(12)}','${id(1)}','${id(2)}','${id(4)}','PROJECT_REVISION','${id(4)}','AVATAR','BLOCKED',NULL),('${id(13)}','${id(1)}','${id(2)}','${id(4)}','PROJECT_REVISION','${id(4)}','IMAGE','COMPLETE',now());`);
 return db;
}
const settle=async db=>(await db.query('SELECT videoforge_settle_cloud_media_cpu_failure($1) settled',[id(5)])).rows[0].settled;
const leaseState=async db=>(await db.query('SELECT state FROM provider_workload_leases WHERE id=$1',[id(9)])).rows[0].state;
for(const state of ['FAILED','CANCELLED'])test('218 actual no-runtime '+state+' span settlement releases only owned VIDEO and preserves accepted ASR/media',async()=>{
 const db=await failureFixture(state);try{await assert.rejects(()=>settle(db),/span failure runtime invalid/);await db.exec(failureMigration);assert.equal(await settle(db),true);assert.equal(await settle(db),true);assert.equal(await leaseState(db),'RELEASED');assert.equal((await db.query('SELECT state FROM generation_requests WHERE id=$1',[id(6)])).rows[0].state,state);assert.equal((await db.query('SELECT state,result_receipt_sha256 FROM hosted_cpu_job_attempts WHERE id=$1',[id(20)])).rows[0].state,'SUCCEEDED');assert.equal((await db.query('SELECT state FROM generation_tasks WHERE id=$1',[id(13)])).rows[0].state,'COMPLETE');assert.equal(await count(db,'video_runtime_states'),0);assert.equal((await db.query('SELECT state FROM provider_workload_leases WHERE id=$1',[id(99)])).rows[0].state,'ACTIVE');assert.equal(await count(db,'cloud_media_reservations','WHERE failure_settled_at IS NOT NULL'),2);}finally{await db.close();}
});
for(const [label,sql] of [
 ['cross-scope actor',`UPDATE hosted_v209_span_audio_materializations SET user_id='${id(80)}'`],
 ['replaced canonical head',`UPDATE revision_timing_heads SET current_timeline_plan_id='${id(80)}'`],
 ['stale current revision',`INSERT INTO project_revisions VALUES('${id(40)}','${id(1)}','${id(2)}','${id(3)}','LOCKED','RUNPOD_POD',2)`],
 ['Local backend',"UPDATE project_revisions SET media_execution_backend='PERSONAL_WORKER'"],
 ['unaccepted ASR',"UPDATE hosted_cpu_job_attempts SET state='FAILED' WHERE kind='ASR'"],
 ['ASR hash drift',"UPDATE hosted_canonical_timing_bridges SET asr_result_sha256='sha256:"+'b'.repeat(64)+"'"],
 ['replaced reservation fence',`UPDATE cloud_media_reservations SET leased_attempt_id='${id(90)}' WHERE id='${id(8)}'`],
 ['foreign Cloud membership',`UPDATE cloud_media_jobs SET account_id='${id(90)}' WHERE attempt_id='${id(5)}'`],
 ['paid API row',`INSERT INTO hosted_api_generation_jobs VALUES('${id(80)}','${id(6)}','${id(13)}','SUCCEEDED')`],
 ['historical provider row',`INSERT INTO serverless_attempts VALUES('${id(80)}','${id(6)}')`],
 ['native local lease',`INSERT INTO media_worker_leases VALUES('${id(5)}','${id(1)}','${id(2)}','RUNNING')`],
 ['task revision mismatch',`UPDATE generation_tasks SET project_revision_id='${id(40)}' WHERE id='${id(12)}'`],
])test('218 no-runtime settlement rejects '+label+' without releasing owned admission',async()=>{const db=await failureFixture();try{await db.exec(failureMigration);await db.exec(sql);await assert.rejects(()=>settle(db),/cloud .* (runtime|lineage) invalid/);assert.equal(await leaseState(db),'ACTIVE');assert.equal((await db.query('SELECT state FROM generation_requests WHERE id=$1',[id(6)])).rows[0].state,'ACTIVE');}finally{await db.close();}});
for(const [label,sql] of [
 ['ambiguous cleanup',`UPDATE cloud_media_reservations SET state='STOPPING' WHERE id='${id(8)}'`],
 ['missing independent absence',`UPDATE cloud_media_reservations SET cleanup_verified_at=NULL WHERE id='${id(8)}'`],
 ['unknown paid API',`INSERT INTO hosted_api_generation_jobs VALUES('${id(80)}','${id(6)}',NULL,'UNKNOWN_NO_RETRY')`],
])test('218 '+label+' keeps capacity and failure settlement pending',async()=>{const db=await failureFixture();try{await db.exec(failureMigration);await db.exec(sql);assert.equal(await settle(db),false);assert.equal(await leaseState(db),'ACTIVE');assert.equal(await count(db,'cloud_media_reservations','WHERE failure_settled_at IS NOT NULL'),0);}finally{await db.close();}});
test('218 preserves runtime-present span failure, accepted provider rows and successful lanes',async()=>{const db=await failureFixture();try{await db.exec(failureMigration);await db.exec(`INSERT INTO video_runtime_states(id,account_id,workspace_id,generation_request_id,stage) VALUES('${id(10)}','${id(1)}','${id(2)}','${id(6)}','WAITING_FOR_WORKER');INSERT INTO hosted_api_generation_jobs VALUES('${id(14)}','${id(6)}','${id(13)}','SUCCEEDED');INSERT INTO video_runtime_lane_states(runtime_id,lane,state) VALUES('${id(10)}','image','SUCCEEDED'),('${id(10)}','avatar','GENERATING');`);assert.equal(await settle(db),true);assert.equal((await db.query('SELECT stage FROM video_runtime_states')).rows[0].stage,'FAILED');assert.equal((await db.query("SELECT state FROM video_runtime_lane_states WHERE lane='image'")).rows[0].state,'SUCCEEDED');assert.equal((await db.query('SELECT state FROM hosted_api_generation_jobs')).rows[0].state,'SUCCEEDED');}finally{await db.close();}});

test('218 cannot settle a personal attempt or foreign account',async()=>{for(const sql of["UPDATE hosted_cpu_job_attempts SET execution_backend='PERSONAL_WORKER' WHERE id='"+id(5)+"'","SELECT set_config('videoforge.account_id','"+id(98)+"',false)"]){const db=await failureFixture();try{await db.exec(failureMigration);await db.exec(sql);await assert.rejects(()=>settle(db),/cloud CPU failure identity rejected/);assert.equal(await leaseState(db),'ACTIVE');}finally{await db.close();}}});

test('218 requires exactly one owned active VIDEO release and rolls back task/request mutations otherwise',async()=>{const db=await failureFixture();try{await db.exec(failureMigration);await db.exec("UPDATE provider_workload_leases SET state='RELEASED' WHERE id='"+id(9)+"'");await assert.rejects(()=>settle(db),/exact admission release missing/);assert.equal((await db.query('SELECT state FROM generation_requests WHERE id=$1',[id(6)])).rows[0].state,'ACTIVE');assert.equal((await db.query('SELECT state FROM generation_tasks WHERE id=$1',[id(12)])).rows[0].state,'BLOCKED');}finally{await db.close();}});

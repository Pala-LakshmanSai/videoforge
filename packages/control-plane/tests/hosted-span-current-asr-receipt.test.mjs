import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=n=>readFileSync(new URL('../migrations/'+n,import.meta.url),'utf8');
const migration=read('0217_hosted_span_audio_current_asr_receipt.sql');
const prior=read('0092_hosted_v209_soulx_source_time_cadence.sql').split('CREATE OR REPLACE FUNCTION public.videoforge_materialize_hosted_v209_span_audio_jobs(')[1];
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,hash='sha256:'+'a'.repeat(64);
async function fixture(){
 const db=new PGlite();
 await db.exec(`
 CREATE FUNCTION videoforge_current_account_id() RETURNS uuid LANGUAGE SQL AS $$SELECT '${id(1)}'::uuid$$;
 CREATE TABLE memberships(account_id uuid,workspace_id uuid,user_id uuid,status text);
 CREATE TABLE projects(id uuid,account_id uuid,workspace_id uuid,status text);
 CREATE TABLE generation_requests(id uuid,account_id uuid,workspace_id uuid,project_id uuid,project_revision_id uuid,created_by_user_id uuid,state text,terminal_at timestamptz,created_at timestamptz);
 CREATE TABLE project_revisions(id uuid,account_id uuid,workspace_id uuid,project_id uuid,status text,media_execution_backend text);
 CREATE TABLE revision_timing_heads(account_id uuid,workspace_id uuid,project_revision_id uuid,current_timeline_plan_id uuid,current_transcript_id uuid);
 CREATE TABLE selected_span_audio(id uuid,account_id uuid,workspace_id uuid,project_revision_id uuid,timeline_plan_id uuid,transcript_id uuid,timeline_segment_id uuid,source_asset_id uuid,source_binary_sha256 text,task_key text,state text,selected_start_ms int,selected_end_ms_exclusive int,padded_start_ms int,padded_end_ms_exclusive int);
 CREATE TABLE timeline_segments(id uuid,account_id uuid,workspace_id uuid,project_revision_id uuid,timeline_plan_id uuid,start_frame int,end_frame_exclusive int,timeline_composition text,required_slots jsonb);
 CREATE TABLE assets(id uuid,account_id uuid,workspace_id uuid,kind text,state text,binary_sha256 text,object_key text,content_type text,byte_size bigint,duration_ms int);
 CREATE TABLE artifact_reservations(id uuid,account_id uuid,workspace_id uuid,project_id uuid,project_revision_id uuid,asset_id uuid,object_key text,method text,state text,checksum_sha256 text,content_length bigint,content_type text);
 CREATE TABLE artifact_receipts(id uuid,account_id uuid,workspace_id uuid,reservation_id uuid,deleted_at timestamptz,object_key text,checksum_sha256 text,content_length bigint,content_type text);
 CREATE TABLE generation_tasks(id uuid,account_id uuid,workspace_id uuid,project_revision_id uuid,task_key text,lane text,state text);
 CREATE TABLE hosted_v209_span_audio_materializations(span_id uuid,account_id uuid,workspace_id uuid,project_id uuid,project_revision_id uuid,generation_request_id uuid,user_id uuid,timeline_plan_id uuid,transcript_id uuid,timeline_segment_id uuid,task_id uuid,attempt_id uuid,source_asset_id uuid,source_receipt_id uuid,output_asset_id uuid,input_document jsonb,input_document_sha256 text,submission_document jsonb,submission_sha256 text);
 CREATE TABLE hosted_canonical_timing_bridges(account_id uuid,workspace_id uuid,project_id uuid,project_revision_id uuid,hosted_asr_attempt_id uuid,asr_input_sha256 text,asr_result_sha256 text,timeline_plan_id uuid,transcript_id uuid);
 CREATE TABLE hosted_cpu_job_attempts(id uuid,account_id uuid,workspace_id uuid,project_id uuid,project_revision_id uuid,kind text,state text,result_receipt_sha256 text,job_spec_checksum_sha256 text,result_checksum_sha256 text);
 CREATE TABLE media_worker_input_objects(account_id uuid,workspace_id uuid,attempt_id uuid,object_key text,checksum_sha256 text,content_length bigint,content_type text);
 CREATE TABLE cloud_media_asr_recoveries(account_id uuid,workspace_id uuid,project_id uuid,project_revision_id uuid,source_receipt_id uuid);
 `);
 const uuidSql=read('0075_hosted_v209_span_audio_and_terminal.sql');await db.exec(uuidSql.slice(uuidSql.indexOf('CREATE FUNCTION public.videoforge_hosted_v209_span_uuid('),uuidSql.indexOf('$$;',uuidSql.indexOf('CREATE FUNCTION public.videoforge_hosted_v209_span_uuid('))+3));
 const canonicalSql=read('0040_hosted_paid_dispatch_authority.sql');await db.exec(canonicalSql.slice(canonicalSql.indexOf('CREATE FUNCTION public.videoforge_canonical_jsonb('),canonicalSql.indexOf('$$;',canonicalSql.indexOf('CREATE FUNCTION public.videoforge_canonical_jsonb('))+3));
 await db.exec('CREATE OR REPLACE FUNCTION public.videoforge_materialize_hosted_v209_span_audio_jobs('+prior);
 await db.exec(`INSERT INTO memberships VALUES('${id(1)}','${id(2)}','${id(3)}','ACTIVE');
 INSERT INTO projects VALUES('${id(4)}','${id(1)}','${id(2)}','ACTIVE');
 INSERT INTO project_revisions VALUES('${id(5)}','${id(1)}','${id(2)}','${id(4)}','LOCKED','RUNPOD_POD');
 INSERT INTO generation_requests VALUES('${id(6)}','${id(1)}','${id(2)}','${id(4)}','${id(5)}','${id(3)}','ACTIVE',NULL,now());
 INSERT INTO revision_timing_heads VALUES('${id(1)}','${id(2)}','${id(5)}','${id(7)}','${id(8)}');
 INSERT INTO selected_span_audio VALUES('${id(9)}','${id(1)}','${id(2)}','${id(5)}','${id(7)}','${id(8)}','${id(10)}','${id(11)}','${hash}','span-audio:one','PLANNED',1000,4000,800,4200);
 INSERT INTO timeline_segments VALUES('${id(10)}','${id(1)}','${id(2)}','${id(5)}','${id(7)}',0,90,'AVATAR_FULL','{"avatar":{"task_key":"avatar:one","span_audio_task_key":"span-audio:one"}}');
 INSERT INTO assets VALUES('${id(11)}','${id(1)}','${id(2)}','VOICEOVER','VERIFIED','${hash}','old-source','audio/mpeg',100,12000);
 INSERT INTO generation_tasks VALUES('${id(12)}','${id(1)}','${id(2)}','${id(5)}','avatar:one','AVATAR','BLOCKED');
 INSERT INTO artifact_reservations VALUES('${id(13)}','${id(1)}','${id(2)}','${id(99)}','${id(98)}','${id(11)}','old-source','PUT','COMMITTED','${hash}',100,'audio/mpeg'),('${id(15)}','${id(1)}','${id(2)}','${id(4)}','${id(97)}','${id(11)}','own-copy','PUT','COMMITTED','${hash}',100,'audio/mpeg');
 INSERT INTO artifact_receipts VALUES('${id(14)}','${id(1)}','${id(2)}','${id(13)}',NULL,'old-source','${hash}',100,'audio/mpeg'),('${id(16)}','${id(1)}','${id(2)}','${id(15)}',NULL,'own-copy','${hash}',100,'audio/mpeg');
 INSERT INTO hosted_cpu_job_attempts VALUES('${id(17)}','${id(1)}','${id(2)}','${id(4)}','${id(5)}','ASR','SUCCEEDED','${hash}','${hash}','${hash}');
 INSERT INTO hosted_canonical_timing_bridges VALUES('${id(1)}','${id(2)}','${id(4)}','${id(5)}','${id(17)}','${hash}','${hash}','${id(7)}','${id(8)}');
 INSERT INTO media_worker_input_objects VALUES('${id(1)}','${id(2)}','${id(17)}','own-copy','${hash}',100,'audio/mpeg');
 INSERT INTO cloud_media_asr_recoveries VALUES('${id(1)}','${id(2)}','${id(4)}','${id(5)}','${id(16)}');`);
 return db;
}
const materialize=async db=>(await db.query('SELECT videoforge_materialize_hosted_v209_span_audio_jobs($1,$2,$3,$4) value',[id(1),id(2),id(3),id(4)])).rows[0].value;
const admitted=async(db,receipt)=>(await db.query(`SELECT EXISTS(SELECT 1 FROM artifact_receipts receipt JOIN artifact_reservations reservation ON reservation.id=receipt.reservation_id WHERE receipt.id=$1 AND receipt.account_id=$2 AND receipt.workspace_id=$3 AND reservation.project_id=$4 AND reservation.state='COMMITTED' AND (reservation.project_revision_id=$5 OR EXISTS(SELECT 1 FROM cloud_media_asr_recoveries recovery WHERE recovery.account_id=receipt.account_id AND recovery.workspace_id=receipt.workspace_id AND recovery.project_id=reservation.project_id AND recovery.project_revision_id=$5 AND recovery.source_receipt_id=receipt.id))) accepted`,[receipt,id(1),id(2),id(4),id(5)])).rows[0].accepted;
test('217 fixes actual historical cross-project projection and accepts exact normal ASR recovery receipt',async()=>{const db=await fixture();try{const old=await materialize(db);assert.equal(old.jobs[0].objects[0].artifact_receipt_id,id(14));assert.equal(await admitted(db,id(14)),false);await db.exec('DELETE FROM hosted_v209_span_audio_materializations');await db.exec(migration);const next=await materialize(db);assert.equal(next.jobs.length,1);assert.equal(next.jobs[0].objects[0].artifact_receipt_id,id(16));assert.equal(await admitted(db,id(16)),true);assert.deepEqual(await materialize(db),next);}finally{await db.close();}});
for(const [label,sql] of [
 ['cross-project',`UPDATE artifact_reservations SET project_id='${id(99)}' WHERE id='${id(15)}'`],
 ['cross-tenant',`UPDATE media_worker_input_objects SET account_id='${id(90)}'`],
 ['wrong input object',"UPDATE media_worker_input_objects SET object_key='unaccepted-copy'"],
 ['checksum substitution',"UPDATE media_worker_input_objects SET checksum_sha256='sha256:"+'b'.repeat(64)+"'"],
 ['length substitution','UPDATE media_worker_input_objects SET content_length=101'],
 ['content-type substitution',"UPDATE media_worker_input_objects SET content_type='audio/wav'"],
 ['unaccepted ASR',"UPDATE hosted_cpu_job_attempts SET state='FAILED'"],
 ['missing recovery alias','DELETE FROM cloud_media_asr_recoveries'],
 ['stale bridge hash',"UPDATE hosted_canonical_timing_bridges SET asr_result_sha256='sha256:"+'b'.repeat(64)+"'"],
])test('217 rejects '+label,async()=>{const db=await fixture();try{await db.exec(migration);await db.exec(sql);await assert.rejects(materialize(db),/planned span inputs are incomplete/);}finally{await db.close();}});
test('217 preserves existing Local materialization and exact replay',async()=>{const db=await fixture();try{await db.exec(`UPDATE project_revisions SET media_execution_backend='PERSONAL_WORKER'; UPDATE artifact_reservations SET project_id='${id(4)}',project_revision_id='${id(5)}' WHERE id='${id(13)}'; DELETE FROM media_worker_input_objects;`);const old=await materialize(db);await db.exec(migration);assert.deepEqual(await materialize(db),old);}finally{await db.close();}});
test('217 accepts direct current-revision normal ASR receipt without recovery alias',async()=>{const db=await fixture();try{await db.exec(migration);await db.exec(`UPDATE artifact_reservations SET project_revision_id='${id(5)}' WHERE id='${id(15)}'; DELETE FROM cloud_media_asr_recoveries;`);const next=await materialize(db);assert.equal(next.jobs[0].objects[0].artifact_receipt_id,id(16));}finally{await db.close();}});
test('217 fails closed on unreviewed function preimage',async()=>{const db=await fixture();try{await db.exec(migration);await assert.rejects(db.exec(migration),/reviewed preimage mismatch/);}finally{await db.close();}});

test('217 prioritizes one accepted current ASR copy when Local source fallback also exists',async()=>{const db=await fixture();try{await db.exec(`UPDATE project_revisions SET media_execution_backend='PERSONAL_WORKER'; UPDATE artifact_reservations SET project_id='${id(4)}',project_revision_id='${id(5)}' WHERE id='${id(13)}';`);await db.exec(migration);const result=await materialize(db);assert.equal(result.jobs.length,1);assert.equal(result.jobs[0].objects[0].artifact_receipt_id,id(16));assert.deepEqual(await materialize(db),result);assert.equal((await db.query('SELECT count(*)::int n FROM hosted_v209_span_audio_materializations')).rows[0].n,1);}finally{await db.close();}});

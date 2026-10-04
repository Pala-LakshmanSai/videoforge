import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {PGliteExecutor} from './support/pglite.mjs';
import {IDS,seedLockedProjects} from './support/fixtures.mjs';
const migration=readFileSync(new URL('../migrations/0215_hosted_cloud_asr_recovery.sql',import.meta.url),'utf8');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const hash=`sha256:${'a'.repeat(64)}`;

test('Cloud ASR recovery creates bounded immutable successors, reuses the exact retained receipt and preserves old terminal evidence',async()=>{
 const db=new PGlite({extensions:{pgcrypto}});
 try {
  await db.exec('CREATE EXTENSION pgcrypto');
  const executor=new PGliteExecutor(db);
  const manifest=JSON.parse(readFileSync(new URL('../migrations/manifest.json',import.meta.url),'utf8'));
  for(const entry of manifest.migrations.filter(row=>row.version<=214)) {
   if(entry.version===195) continue;
   const bytes=readFileSync(new URL(`../migrations/${entry.filename}`,import.meta.url),'utf8');
   assert.equal(`sha256:${createHash('sha256').update(bytes).digest('hex')}`,entry.sha256);
   await executor.execute(bytes);
  }
  await executor.execute(migration);
  await executor.execute(readFileSync(new URL('../migrations/0266_cloud_asr_recovery_voiceover_reader.sql',import.meta.url),'utf8'));
  await seedLockedProjects(executor);
  await db.query("SELECT set_config('videoforge.account_id',$1,false)",[IDS.accountA]);
  await db.query(`INSERT INTO projects(id,workspace_id,owner_user_id,name,normalized_name,generation_provider)
   VALUES($1,$2,$3,'Cloud transcription retry','cloud transcription retry','KIE_FAL')`,[id(4000),IDS.workspaceA,IDS.userA]);
  await db.query(`INSERT INTO project_revisions SELECT (jsonb_populate_record(NULL::project_revisions,to_jsonb(r)||jsonb_build_object(
   'id',$1::text,'project_id',$2::text,'media_execution_backend','RUNPOD_POD','created_at',now(),'locked_at',now(),
   'revision_config_payload',doc.payload,'revision_config_hash','sha256:'||encode(sha256(convert_to(videoforge_canonical_jsonb(doc.payload),'UTF8')),'hex')))).*
   FROM project_revisions r CROSS JOIN LATERAL (SELECT r.revision_config_payload||jsonb_build_object(
     'project_id',$2::text,'project_revision_id',$1::text) AS payload) doc WHERE r.id=$3`,[id(4001),id(4000),IDS.revisionA]);
  const voice=(await db.query('SELECT voiceover_asset_id,voiceover_binary_sha256 FROM project_revisions WHERE id=$1',[id(4001)])).rows[0];
  const objectKey=`tenant/${IDS.accountA}/workspace/${IDS.workspaceA}/project/${id(4000)}/revision/${id(4001)}/lane/input/job/browser-upload/artifact/voiceover`;
  await db.query(`INSERT INTO artifact_reservations(id,account_id,workspace_id,project_id,project_revision_id,asset_id,lane,job_id,artifact_id,
   object_key,method,content_type,content_length,checksum_sha256,expires_at,max_uses,state,retention_class,deletion_owner_account_id)
   VALUES($1,$2,$3,$4,$5,$6,'INPUT','browser-upload','voiceover',$7,'PUT','audio/mpeg',100,$8,now()+interval '1 hour',1,'COMMITTED','PROJECT',$2)`,
   [id(4002),IDS.accountA,IDS.workspaceA,id(4000),id(4001),voice.voiceover_asset_id,objectKey,voice.voiceover_binary_sha256]);
  await db.query(`INSERT INTO artifact_receipts(id,account_id,workspace_id,reservation_id,callback_id,object_key,content_type,content_length,
   checksum_sha256,receipt_sha256,committed_at) VALUES($1,$2,$3,$4,'cloud-recovery-fixture',$5,'audio/mpeg',100,$6,$7,now())`,
   [id(4003),IDS.accountA,IDS.workspaceA,id(4002),objectKey,voice.voiceover_binary_sha256,hash]);
  const seedAttempt=async(attempt,revision,state='FAILED',kind='ASR')=>{
   const prefix=`tenant/${IDS.accountA}/workspace/${IDS.workspaceA}/project/${id(4000)}/revision/${revision}/lane/input/job/${attempt}/artifact`;
   await db.query(`INSERT INTO hosted_cpu_job_attempts(id,account_id,workspace_id,project_id,project_revision_id,kind,state,execution_backend,
    execution_bundle_sha256,request_sha256,job_spec_object_key,job_spec_content_length,job_spec_checksum_sha256,result_object_key,image_digest,
    callback_token_sha256,deadline_at,submitted_at,terminal_at,retain_until)
    VALUES($1,$2,$3,$4,$5,$6,$7,'RUNPOD_POD',$8,$8,$9,100,$8,$10,$8,$8,now()+interval '1 hour',
     CASE WHEN $7='FAILED' THEN now() END,CASE WHEN $7='FAILED' THEN now() END,CASE WHEN $7='FAILED' THEN now()+interval '1 hour' END)`,
    [attempt,IDS.accountA,IDS.workspaceA,id(4000),revision,kind,state,hash,`${prefix}/job-spec`,`${prefix}/result-document`]);
  };
  const seedFailedRequest=async(revision,key)=>db.query(`INSERT INTO generation_requests(id,account_id,workspace_id,project_id,project_revision_id,
    created_by_user_id,state,queue_order,available_at,attempt_ordinal,idempotency_key,version,terminal_at,created_at,updated_at)
    VALUES($1,$2,$3,$4,$5,$6,'FAILED',(SELECT COALESCE(max(queue_order),0)+1 FROM generation_requests WHERE account_id=$2),now(),1,$7,1,now(),now(),now())`,
    [key,IDS.accountA,IDS.workspaceA,id(4000),revision,IDS.userA,`cloud-asr-recovery-fixture-${key}`]);
  await seedAttempt(id(4004),id(4001));await seedAttempt(id(4005),id(4001),'PLANNED','RENDER');
  await seedFailedRequest(id(4001),id(4006));
  const old=(await db.query('SELECT to_jsonb(r) AS value FROM project_revisions r WHERE id=$1',[id(4001)])).rows[0].value;
  const run=async failed=>(await db.query('SELECT videoforge_prepare_cloud_media_asr_recovery($1,$2,$3,$4,$5) AS revision',
    [IDS.accountA,IDS.workspaceA,IDS.userA,id(4000),failed])).rows[0].revision;
  // The runtime cannot mint its own broad receipt alias or alter a recovery row.
  assert.equal((await db.query("SELECT has_table_privilege('videoforge_v209_runtime_dc9612d6','cloud_media_asr_recoveries','INSERT') AS yes")).rows[0].yes,false);
  await db.query("SELECT set_config('videoforge.account_id',$1,false)",[IDS.accountB]);
  await assert.rejects(run(id(4004)),/owner rejected/);
  await db.query("SELECT set_config('videoforge.account_id',$1,false)",[IDS.accountA]);
  await db.query(`INSERT INTO cloud_media_budget_authorities(id,allowed_account_ids,allowed_project_ids,total_cap_usd,max_reservation_usd,
   max_hourly_usd,max_rental_seconds,image,source_sha256,runtime_sha256,expires_at)
   VALUES($1,ARRAY[$2::uuid],ARRAY[$3::uuid],3,.2,.8,900,$4,$5,$5,now()+interval '1 hour')`,
   [id(4020),IDS.accountA,id(4000),`repo@${hash}`,hash]);
  await db.query(`INSERT INTO cloud_media_reservations(id,account_id,workspace_id,project_id,project_revision_id,attempt_id,leased_attempt_id,
   budget_authority_id,fence_id,capability_sha256,pod_name,image,source_sha256,runtime_sha256,tooling,disk_gb,max_hourly_usd,budget_usd,
   rental_seconds,state,placement_deadline_at)
   VALUES($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$10,$11,$9,$9,'{}',100,.8,.2,900,'WAITING_CAPACITY',now()+interval '180 seconds')`,
   [id(4021),IDS.accountA,IDS.workspaceA,id(4000),id(4001),id(4004),id(4020),id(4022),hash,`videoforge-media-${id(4021)}`,`repo@${hash}`]);
  await assert.rejects(run(id(4004)),/not eligible/);
  await db.query("UPDATE cloud_media_reservations SET state='CLEAN',cleanup_verified_at=now() WHERE id=$1",[id(4021)]);
  await assert.rejects(run(id(4004)),/not eligible/);
  await db.query('UPDATE cloud_media_reservations SET failure_settled_at=now() WHERE id=$1',[id(4021)]);
  await db.exec("SET ROLE videoforge_v209_runtime_dc9612d6");
  const first=await run(id(4004));assert.equal(await run(id(4004)),first);
  await db.exec("RESET ROLE");
  assert.deepEqual((await db.query('SELECT to_jsonb(r) AS value FROM project_revisions r WHERE id=$1',[id(4001)])).rows[0].value,old);
  const next=(await db.query('SELECT * FROM project_revisions WHERE id=$1',[first])).rows[0];
  assert.equal(next.revision_number,2);assert.equal(next.media_execution_backend,'RUNPOD_POD');assert.equal(next.voiceover_asset_id,voice.voiceover_asset_id);
  assert.equal(next.revision_config_payload.project_revision_id,first);
  assert.equal(next.revision_config_hash,(await db.query("SELECT 'sha256:'||encode(sha256(convert_to(videoforge_canonical_jsonb($1::jsonb),'UTF8')),'hex') AS hash",[next.revision_config_payload])).rows[0].hash);
  assert.equal((await db.query('SELECT state FROM hosted_cpu_job_attempts WHERE id=$1',[id(4004)])).rows[0].state,'FAILED');
  assert.equal((await db.query('SELECT state FROM hosted_cpu_job_attempts WHERE id=$1',[id(4005)])).rows[0].state,'CANCELLED');
  assert.equal((await db.query('SELECT source_receipt_id FROM cloud_media_asr_recoveries WHERE project_revision_id=$1',[first])).rows[0].source_receipt_id,id(4003));
  assert.equal((await db.query('SELECT count(*)::int AS n FROM artifact_receipts')).rows[0].n,1);
  // Compile and execute the real shared CPU input query: this exact recovery alias
  // grants each exact media job only its retained same-tenant/project voiceover object.
  const app=readFileSync(new URL('../../../apps/web/src/server/hosted/app.ts',import.meta.url),'utf8');
  const queryStart=app.indexOf('`SELECT receipt.id, receipt.object_key',app.indexOf('const artifacts ='));
  const inputSql=app.slice(queryStart+1,app.indexOf('`',queryStart+1));
  assert.equal((await db.query(inputSql,[IDS.accountA,IDS.workspaceA,[id(4003)],id(4000),first,'ASR'])).rows.length,1);
  assert.equal((await db.query(inputSql,[IDS.accountA,IDS.workspaceA,[id(4003)],id(4000),first,'RENDER'])).rows.length,1);
  assert.equal((await db.query(inputSql,[IDS.accountB,IDS.workspaceB,[id(4003)],id(4000),first,'ASR'])).rows.length,0);
  const handoff=readFileSync(new URL('../../../apps/web/src/server/hosted/hosted-v209-render-handoff.ts',import.meta.url),'utf8');
  const originStart=handoff.lastIndexOf('`',handoff.indexOf('SELECT public.videoforge_read_cloud_asr_recovery_voiceover_origin('));
  assert(originStart>=0);
  const originSql=handoff.slice(originStart+1,handoff.indexOf('`',originStart+1));
  const facts=[IDS.accountA,IDS.workspaceA,id(4000),first,id(4003),voice.voiceover_asset_id,objectKey,voice.voiceover_binary_sha256,100,'audio/mpeg'];
  assert.deepEqual((await db.query(originSql,facts)).rows,[{origin_revision_id:id(4001)}]);
  assert.deepEqual((await db.query(originSql,[...facts.slice(0,7),hash,...facts.slice(8)])).rows,[{origin_revision_id:null}]);


  await seedAttempt(id(4007),first,'OUTBOXED');
  const admitted=(await db.query('SELECT videoforge_admit_hosted_v209_generation($1,$2,$3,$4) AS value',
   [IDS.accountA,IDS.workspaceA,IDS.userA,id(4000)])).rows[0].value;
  assert.equal(admitted.state,'ACTIVE');assert.notEqual(admitted.generationRequestId,id(4006));
  assert.equal((await db.query("SELECT count(*)::int AS n FROM provider_workload_leases WHERE state='ACTIVE'")).rows[0].n,1);
  await assert.rejects(run(id(4007)),/not eligible/);
  await db.query("UPDATE hosted_cpu_job_attempts SET state='FAILED',submitted_at=now(),terminal_at=now(),retain_until=deadline_at WHERE id=$1",[id(4007)]);
  assert.equal((await db.query('SELECT videoforge_settle_cloud_media_cpu_failure($1) AS yes',[id(4007)])).rows[0].yes,true);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM provider_workload_leases WHERE state='ACTIVE'")).rows[0].n,0);
  const second=await run(id(4007));assert.notEqual(second,first);
  assert.equal((await db.query('SELECT source_receipt_id FROM cloud_media_asr_recoveries WHERE project_revision_id=$1',[second])).rows[0].source_receipt_id,id(4003));
  await seedAttempt(id(4009),second);await seedFailedRequest(second,id(4010));
  await assert.rejects(run(id(4009)),/bounded limit reached/);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM cloud_media_asr_recoveries')).rows[0].n,2);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM cloud_media_reservations WHERE state<>'CLEAN'")).rows[0].n,0);
 } finally {await db.close();}
});

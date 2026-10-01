import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {PGliteExecutor, uuid} from './support/pglite.mjs';
import {IDS, seedLockedProjects} from './support/fixtures.mjs';

const read = name => readFileSync(new URL('../migrations/'+name, import.meta.url), 'utf8');
const hash = 'sha256:'+'a'.repeat(64);
const authority = uuid(236001), project = uuid(236002), revision = uuid(236003), attempt = uuid(236004);
const reservation = uuid(236005), fence = uuid(236006), finite = uuid(236007);

test('ongoing Cloud access preserves finite approvals, tenant isolation, debit accounting and rental deadlines', async t => {
 const db = new PGlite({extensions:{pgcrypto}});
 try {
  await db.exec('CREATE EXTENSION pgcrypto');
  const executor = new PGliteExecutor(db);
  for (const m of JSON.parse(read('manifest.json')).migrations.filter(m => m.version<=235)) {
   if(m.version===195) continue; // Existing deployment-owned continuation prerequisite boundary.
   const sql=read(m.filename);
   assert.equal('sha256:'+createHash('sha256').update(sql).digest('hex'),m.sha256);
   await executor.execute(sql);
  }
  await seedLockedProjects(executor);
  await db.query("SELECT set_config('videoforge.account_id',$1,false)",[IDS.accountA]);
  await db.query(`INSERT INTO cloud_media_budget_authorities(id,allowed_account_ids,allowed_project_ids,total_cap_usd,
   max_reservation_usd,max_hourly_usd,max_rental_seconds,image,source_sha256,runtime_sha256,expires_at,allow_new_cloud_projects,max_reservations)
   VALUES($1,ARRAY[$2::uuid],ARRAY[$3::uuid],1,.2,.8,7200,$4,$5,$5,now()+interval '1 hour',true,5)`,
   [finite,IDS.accountA,IDS.projectA,'registry/example@'+hash,hash]);
  const before=(await db.query('SELECT to_jsonb(b) row FROM cloud_media_budget_authorities b WHERE id=$1',[finite])).rows[0].row;
  await executor.execute(read('0236_cloud_pay_per_use.sql'));
  assert.deepEqual((await db.query("SELECT to_jsonb(b)-'ongoing_pay_per_use' row FROM cloud_media_budget_authorities b WHERE id=$1",[finite])).rows[0].row,before);
  assert.equal((await db.query('SELECT count(*)::int n FROM cloud_media_budget_authorities')).rows[0].n,1);
  await db.query(`INSERT INTO cloud_media_budget_authorities(id,allowed_account_ids,allowed_project_ids,total_cap_usd,
   debited_usd,max_reservation_usd,max_hourly_usd,max_rental_seconds,image,source_sha256,runtime_sha256,expires_at,
   allow_new_cloud_projects,ongoing_pay_per_use)
   VALUES($1,ARRAY[$2::uuid],ARRAY[$3::uuid],NULL,50000,NULL,.8,7200,$4,$5,$5,NULL,true,true)`,
   [authority,IDS.accountA,IDS.projectA,'registry/example@'+hash,hash]);
  const ready=async id => (await db.query('SELECT videoforge_cloud_media_new_project_ready($1) ready',[id])).rows[0].ready;
  await t.test('ordinary access does not expire or exhaust aggregate spend',async()=>assert.equal(await ready(authority),true));
  await t.test('old finite allowance still expires and exhausts',async()=>{
   assert.equal(await ready(finite),true);
   await db.query('UPDATE cloud_media_budget_authorities SET debited_usd=1 WHERE id=$1',[finite]);
   assert.equal(await ready(finite),false);
   await db.query("UPDATE cloud_media_budget_authorities SET debited_usd=0,expires_at=now()-interval '1 second' WHERE id=$1",[finite]);
   assert.equal(await ready(finite),false);
  });
  await t.test('ongoing access remains owner-scoped and operator-controlled',async()=>{
   await db.query("SELECT set_config('videoforge.account_id',$1,false)",[IDS.accountB]);
   assert.equal(await ready(authority),false);
   await db.query("SELECT set_config('videoforge.account_id',$1,false)",[IDS.accountA]);
   assert.equal((await db.query("SELECT has_table_privilege('videoforge_v209_runtime_dc9612d6','cloud_media_budget_authorities','UPDATE') allowed")).rows[0].allowed,false);
  });
  await db.query(`INSERT INTO projects(id,workspace_id,owner_user_id,name,normalized_name)
   VALUES($1,$2,$3,'Ongoing Cloud','ongoing cloud')`,[project,IDS.workspaceA,IDS.userA]);
  await db.query(`INSERT INTO project_revisions SELECT(jsonb_populate_record(NULL::project_revisions,to_jsonb(r)||
   jsonb_build_object('id',$1::text,'project_id',$2::text,'media_execution_backend','RUNPOD_POD','created_at',now(),'locked_at',now()))).*
   FROM project_revisions r WHERE r.id=$3`,[revision,project,IDS.revisionA]);
  const prefix=`tenant/${IDS.accountA}/workspace/${IDS.workspaceA}/project/${project}/revision/${revision}/lane/input/job/${attempt}/artifact`;
  await db.query(`INSERT INTO hosted_cpu_job_attempts(id,account_id,workspace_id,project_id,project_revision_id,kind,state,
   execution_backend,execution_bundle_sha256,request_sha256,job_spec_object_key,job_spec_content_length,job_spec_checksum_sha256,
   result_object_key,image_digest,callback_token_sha256,deadline_at)
   VALUES($1,$2,$3,$4,$5,'ASR','OUTBOXED','RUNPOD_POD',$6,$6,$7,100,$6,$8,$6,$6,now()+interval '1 hour')`,
   [attempt,IDS.accountA,IDS.workspaceA,project,revision,hash,prefix+'/spec',prefix+'/result']);
  await db.query('SELECT videoforge_admit_hosted_v209_generation($1,$2,$3,$4)',[IDS.accountA,IDS.workspaceA,IDS.userA,project]);
  await db.query(`INSERT INTO cloud_media_reservations(id,account_id,workspace_id,budget_authority_id,project_id,project_revision_id,
   attempt_id,leased_attempt_id,fence_id,capability_sha256,pod_name,image,source_sha256,runtime_sha256,tooling,disk_gb,
   max_hourly_usd,budget_usd,rental_seconds,state,placement_deadline_at)
   VALUES($1::uuid,$2,$3,$4,$5,$6,$7,$7,$8,$9,'videoforge-media-'||$1::text,$10,$9,$9,'{}',100,.8,.2,900,'WAITING_CAPACITY',now()+interval '180 seconds')`,
   [reservation,IDS.accountA,IDS.workspaceA,authority,project,revision,attempt,fence,hash,'registry/example@'+hash]);
  await db.query('INSERT INTO cloud_media_jobs(account_id,workspace_id,reservation_id,attempt_id,claim_ordinal) VALUES($1,$2,$3,$4,1)',[IDS.accountA,IDS.workspaceA,reservation,attempt]);
  await t.test('normal reservation debits once even above prior maximum aggregate approval',async()=>{
   for(let i=0;i<2;i++) assert.equal((await db.query('SELECT videoforge_cloud_media_reserve_budget($1) ok',[reservation])).rows[0].ok,true);
   assert.equal(Number((await db.query('SELECT debited_usd amount FROM cloud_media_budget_authorities WHERE id=$1',[authority])).rows[0].amount),50000.2);
   assert.equal((await db.query('SELECT count(*)::int n FROM cloud_media_budget_debits WHERE authority_id=$1',[authority])).rows[0].n,1);
  });
  await t.test('ongoing account access still exposes a finite exact rental deadline',async()=>{
   const result=(await db.query('SELECT * FROM videoforge_cloud_media_reservation_authority($1,$2,$3)',[reservation,attempt,fence])).rows[0];
   assert.equal(result.id,authority);
   assert.ok(Date.parse(result.expires_at)>Date.now() && Date.parse(result.expires_at)<Date.now()+1200000);
   assert.equal((await db.query('SELECT count(*)::int n FROM videoforge_cloud_media_reservation_authority($1,$2,$3)',[reservation,attempt,uuid(236099)])).rows[0].n,0);
  });
  await t.test('unresolved cleanup still pauses new Cloud and disabling access still works',async()=>{
   await db.query("UPDATE cloud_media_reservations SET state='STOPPING',launch_outcome='UNKNOWN' WHERE id=$1",[reservation]);
   assert.equal(await ready(authority),false);
   await db.query('UPDATE cloud_media_budget_authorities SET enabled=false WHERE id=$1',[authority]);
   assert.equal((await db.query('SELECT enabled FROM videoforge_cloud_media_reservation_authority($1,$2,$3)',[reservation,attempt,fence])).rows[0].enabled,false);
  });
 } finally {await db.close();}
});

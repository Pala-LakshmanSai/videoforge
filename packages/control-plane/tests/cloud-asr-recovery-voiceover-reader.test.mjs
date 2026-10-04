import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {PGlite} from '@electric-sql/pglite';
const migration=readFileSync(new URL('../migrations/0266_cloud_asr_recovery_voiceover_reader.sql',import.meta.url),'utf8');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const hash=`sha256:${'a'.repeat(64)}`;
test('retained voiceover reader gives both real principals exact tenant-bound origin without table access',async()=>{
 const db=new PGlite();try{
  await db.exec(`CREATE ROLE videoforge_v209_runtime_dc9612d6;CREATE ROLE videoforge_v209_reconciler_dc9612d6;
   CREATE FUNCTION videoforge_current_account_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('videoforge.account_id',true),'')::uuid $$;
   CREATE TABLE cloud_media_asr_recoveries(account_id uuid,workspace_id uuid,project_id uuid,project_revision_id uuid,source_receipt_id uuid);
   CREATE TABLE artifact_receipts(id uuid,account_id uuid,workspace_id uuid,reservation_id uuid,deleted_at timestamptz,object_key text,checksum_sha256 text,content_length bigint,content_type text);
   CREATE TABLE artifact_reservations(id uuid,account_id uuid,workspace_id uuid,project_id uuid,project_revision_id uuid,asset_id uuid,lane text,state text,object_key text);
   CREATE TABLE assets(id uuid,account_id uuid,workspace_id uuid,kind text,state text,binary_sha256 text);
   CREATE TABLE project_revisions(id uuid,account_id uuid,workspace_id uuid,project_id uuid,status text,voiceover_asset_id uuid,voiceover_binary_sha256 text);`);
  await db.exec(migration);
  await db.query('INSERT INTO cloud_media_asr_recoveries VALUES($1,$2,$3,$4,$5)',[id(1),id(2),id(3),id(4),id(5)]);
  await db.query("INSERT INTO artifact_receipts VALUES($1,$2,$3,$4,NULL,'retained/source.mp3',$5,326470,'audio/mpeg')",[id(5),id(1),id(2),id(6),hash]);
  await db.query("INSERT INTO artifact_reservations VALUES($1,$2,$3,$4,$5,$6,'INPUT','COMMITTED','retained/source.mp3')",[id(6),id(1),id(2),id(3),id(7),id(8)]);
  await db.query("INSERT INTO assets VALUES($1,$2,$3,'VOICEOVER','VERIFIED',$4)",[id(8),id(1),id(2),hash]);
  await db.query("INSERT INTO project_revisions VALUES($1,$2,$3,$4,'LOCKED',$5,$6)",[id(4),id(1),id(2),id(3),id(8),hash]);
  const facts=[id(1),id(2),id(3),id(4),id(5),id(8),'retained/source.mp3',hash,326470,'audio/mpeg'];
  const read=async values=>(await db.query('SELECT videoforge_read_cloud_asr_recovery_voiceover_origin($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)::text AS origin',values)).rows[0].origin;
  for(const role of ['videoforge_v209_runtime_dc9612d6','videoforge_v209_reconciler_dc9612d6']){
   await db.exec('SET ROLE '+role);await db.query("SELECT set_config('videoforge.account_id',$1,false)",[id(1)]);
   await assert.rejects(db.query('SELECT * FROM cloud_media_asr_recoveries'),/permission denied/);
   await assert.rejects(db.query('SELECT * FROM artifact_receipts'),/permission denied/);
   assert.equal(await read(facts),id(7));
   for(let index=0;index<facts.length;index++){
    const invalid=[...facts];invalid[index]=index<6?id(99):index===8?326471:'mismatch';
    assert.equal(await read(invalid),null,'reject mismatched argument '+index);
   }
   await db.query("SELECT set_config('videoforge.account_id',$1,false)",[id(99)]);assert.equal(await read(facts),null);
   await db.exec('RESET ROLE');
  }
  await db.query("SELECT set_config('videoforge.account_id',$1,false)",[id(1)]);
  await db.query('UPDATE artifact_receipts SET deleted_at=now()');assert.equal(await read(facts),null);
  await db.query('UPDATE artifact_receipts SET deleted_at=NULL');
  await db.query("UPDATE project_revisions SET voiceover_binary_sha256=$1",[`sha256:${'b'.repeat(64)}`]);assert.equal(await read(facts),null);
  const signature='videoforge_read_cloud_asr_recovery_voiceover_origin(uuid,uuid,uuid,uuid,uuid,uuid,text,text,bigint,text)';
  assert.equal((await db.query("SELECT has_function_privilege('public',$1,'EXECUTE') AS yes",[signature])).rows[0].yes,false);
 }finally{await db.close();}
});

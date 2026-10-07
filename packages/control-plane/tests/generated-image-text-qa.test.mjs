import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
const account = "11111111-1111-4111-8111-111111111111";
const workspace = "22222222-2222-4222-8222-222222222222";
const project = "33333333-3333-4333-8333-333333333333";
const job = "44444444-4444-4444-8444-444444444444";
const run = "55555555-5555-4555-8555-555555555555";
const hash = `sha256:${"a".repeat(64)}`;
const response = `sha256:${"b".repeat(64)}`;
test("image QA preserves historical work, charges once, binds pixels, isolates tenant and guards both acceptance paths", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE videoforge_v209_runtime_dc9612d6;
      CREATE FUNCTION public.videoforge_current_account_id() RETURNS uuid LANGUAGE sql AS
        $$ SELECT nullif(current_setting('videoforge.account_id',true),'')::uuid $$;
      CREATE TABLE workspaces(account_id uuid,id uuid,UNIQUE(account_id,id));
      CREATE TABLE hosted_api_generation_jobs(id uuid,account_id uuid,workspace_id uuid,project_id uuid,
        provider_task_id text,state text,output_object_key text,lane text,output_sha256 text);
      CREATE TABLE hosted_api_image_regeneration_jobs(LIKE hosted_api_generation_jobs);
      INSERT INTO workspaces VALUES('${account}','${workspace}');
      INSERT INTO hosted_api_generation_jobs VALUES('${job}','${account}','${workspace}','${project}',
        'paid-image-id','SUBMITTED','stored-image','IMAGE',NULL);
      SELECT set_config('videoforge.account_id','${account}',false);`);
    await db.exec(readFileSync(new URL("../migrations/0290_generated_image_text_qa.sql", import.meta.url), "utf8"));
    const claim = async () => (await db.query("SELECT videoforge_claim_image_text_qa($1,$2,$3,true) AS value", ["stored-image",hash,run])).rows[0].value;
    assert.equal((await claim()).state,"HISTORICAL");
    await db.exec("UPDATE hosted_api_generation_jobs SET image_text_qa_required=true");
    await assert.rejects(db.query("UPDATE hosted_api_generation_jobs SET state='SUCCEEDED',output_sha256=$1",[hash]),/PASS receipt/);
    assert.equal((await claim()).dispatch,true);
    assert.equal((await claim()).dispatch,false);
    await assert.rejects(db.query("SELECT videoforge_claim_image_text_qa($1,$2,$3,true)",["stored-image",response,run]),/identity changed/);
    await db.query("SELECT set_config('videoforge.account_id',$1,false)",[workspace]);
    await assert.rejects(claim(),/source unavailable/);
    await db.query("SELECT set_config('videoforge.account_id',$1,false)",[account]);
    const finish = () => db.query("SELECT videoforge_finish_image_text_qa($1,$2,'PASS',$3,100,200,10)",[run,hash,response]);
    await finish(); await finish();
    await db.query("UPDATE hosted_api_generation_jobs SET state='SUCCEEDED',output_sha256=$1",[hash]);
    await assert.rejects(db.exec("UPDATE hosted_api_generation_jobs SET image_text_qa_required=false"),/cannot be weakened/);
    await db.exec(`INSERT INTO hosted_api_image_regeneration_jobs(id,account_id,workspace_id,project_id,
      provider_task_id,state,output_object_key,lane,image_text_qa_required) VALUES('${job}','${account}',
      '${workspace}','${project}','regen-paid-id','SUBMITTED','regen-image','IMAGE',true)`);
    await assert.rejects(db.query("UPDATE hosted_api_image_regeneration_jobs SET state='SUCCEEDED',output_sha256=$1",[hash]),/PASS receipt/);
    await db.query("SELECT videoforge_claim_image_text_qa('regen-image',$1,$2,true)",[hash,project]);
    await db.query("SELECT videoforge_finish_image_text_qa($1,$2,'TEXT',$3,100,200,10)",[project,hash,response]);
    await assert.rejects(db.query("UPDATE hosted_api_image_regeneration_jobs SET state='SUCCEEDED',output_sha256=$1",[hash]),/PASS receipt/);
    assert.equal((await db.query("SELECT sum(reported_cost_micro_usd) AS total FROM hosted_image_text_qa_runs")).rows[0].total,"200");
    // Activation survives schema recreation while preserving every existing row, including false flags.
    await db.exec(`INSERT INTO hosted_api_generation_jobs(id,account_id,workspace_id,project_id,
      provider_task_id,state,output_object_key,lane) VALUES('${project}','${account}',
      '${workspace}','${project}','historical-paid-id','SUBMITTED','historical-image','IMAGE')`);
    const beforeInitial = (await db.query("SELECT * FROM hosted_api_generation_jobs ORDER BY id")).rows;
    const beforeRegeneration = (await db.query("SELECT * FROM hosted_api_image_regeneration_jobs ORDER BY id")).rows;
    await db.exec(readFileSync(new URL("../migrations/0292_enable_generated_image_text_qa.sql", import.meta.url), "utf8"));
    assert.deepEqual((await db.query("SELECT * FROM hosted_api_generation_jobs ORDER BY id")).rows,beforeInitial);
    assert.deepEqual((await db.query("SELECT * FROM hosted_api_image_regeneration_jobs ORDER BY id")).rows,beforeRegeneration);
    assert.equal((await db.query("SELECT image_text_qa_required FROM hosted_api_generation_jobs WHERE output_object_key='historical-image'")).rows[0].image_text_qa_required,false);
    for (const table of ["hosted_api_generation_jobs","hosted_api_image_regeneration_jobs"]) {
      await db.exec(`INSERT INTO ${table}(id,account_id,workspace_id,project_id,provider_task_id,
        state,output_object_key,lane) VALUES('${workspace}','${account}','${workspace}',
        '${project}','future-paid-id','SUBMITTED','future-${table}','IMAGE')`);
      assert.equal((await db.query(`SELECT image_text_qa_required FROM ${table} WHERE id=$1`,[workspace])).rows[0].image_text_qa_required,true);
      await assert.rejects(db.query(`UPDATE ${table} SET state='SUCCEEDED',output_sha256=$1 WHERE id=$2`,[hash,workspace]),/PASS receipt/);
    }
    const retained = (await db.query("SELECT * FROM hosted_image_text_qa_runs ORDER BY id")).rows;
    await db.exec(readFileSync(new URL("../migrations/0293_disable_generated_image_text_qa.sql", import.meta.url), "utf8"));
    for (const table of ["hosted_api_generation_jobs","hosted_api_image_regeneration_jobs"]) {
      await db.exec(`INSERT INTO ${table}(id,account_id,workspace_id,project_id,provider_task_id,
        state,output_object_key,lane) VALUES('${run}','${account}','${workspace}',
        '${project}','prompt-only-id','SUBMITTED','prompt-only-${table}','IMAGE')`);
      assert.equal((await db.query(`SELECT image_text_qa_required FROM ${table} WHERE id=$1`,[run])).rows[0].image_text_qa_required,false);
      const result = (await db.query("SELECT videoforge_claim_image_text_qa($1,$2,$3,true) value",[`prompt-only-${table}`,hash,run])).rows[0].value;
      assert.equal(result.state,"HISTORICAL");
      assert.notEqual(result.dispatch,true);
      await db.query(`UPDATE ${table} SET state='SUCCEEDED',output_sha256=$1 WHERE id=$2`,[hash,run]);
    }
    assert.deepEqual((await db.query("SELECT * FROM hosted_image_text_qa_runs ORDER BY id")).rows,retained);


  } finally { await db.close(); }
});

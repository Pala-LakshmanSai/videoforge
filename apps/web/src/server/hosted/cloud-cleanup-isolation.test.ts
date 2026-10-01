// @vitest-environment node
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { SqlExecutor } from "@videoforge/control-plane";
import { expect, it } from "vitest";
import { hostedAccountCleanupPending } from "./hosted-v209-queue-admission";

const account="11111111-1111-4111-8111-111111111111", workspace="22222222-2222-4222-8222-222222222222";
const project="33333333-3333-4333-8333-333333333333", revision="44444444-4444-4444-8444-444444444444";
const reservation="55555555-5555-4555-8555-555555555555", attempt="66666666-6666-4666-8666-666666666666";
const request="77777777-7777-4777-8777-777777777777", authority="88888888-8888-4888-8888-888888888888";
const other="99999999-9999-4999-8999-999999999999";

it("retires only fenced early video admission, keeps uncertain Cloud capacity, and admits only Local",async()=>{
 const db=new PGlite();
 try {
  const old=await readFile(new URL("../../../../../packages/control-plane/migrations/0214_optional_runpod_media.sql",import.meta.url),"utf8");
  const guard=old.slice(old.indexOf("CREATE FUNCTION public.videoforge_guard_admission_against_cloud_cleanup()"),old.indexOf("-- Multipart signing records"));
  await db.exec(`CREATE ROLE videoforge_v209_runtime_dc9612d6;
   CREATE FUNCTION videoforge_current_account_id() RETURNS uuid LANGUAGE sql AS $$ SELECT current_setting('videoforge.account_id')::uuid $$;
   CREATE TABLE global_generation_capacity(singleton boolean); INSERT INTO global_generation_capacity VALUES(true);
   CREATE TABLE cloud_media_budget_authorities(id uuid,enabled boolean,expires_at timestamptz);
   CREATE TABLE cloud_media_reservations(id uuid,account_id uuid,workspace_id uuid,project_id uuid,project_revision_id uuid,
    leased_attempt_id uuid,budget_authority_id uuid,state text,launch_outcome text,pod_id text,cleanup_verified_at timestamptz,deadline_at timestamptz);
   CREATE TABLE hosted_cpu_job_attempts(id uuid,account_id uuid,workspace_id uuid,project_id uuid,project_revision_id uuid,
    state text,kind text,terminal_at timestamptz);
   CREATE TABLE hosted_api_generation_jobs(account_id uuid,workspace_id uuid,project_id uuid,project_revision_id uuid);
   CREATE TABLE media_worker_leases(attempt_id uuid,account_id uuid,workspace_id uuid,state text);
   CREATE TABLE generation_requests(id uuid,account_id uuid,workspace_id uuid,project_id uuid,project_revision_id uuid,
    created_by_user_id uuid,state text,terminal_at timestamptz,created_at timestamptz,updated_at timestamptz,version integer);
   CREATE TABLE project_revisions(id uuid,account_id uuid,workspace_id uuid,project_id uuid,media_execution_backend text);
   CREATE TABLE projects(id uuid,account_id uuid,workspace_id uuid,owner_user_id uuid,generation_provider text);
   CREATE TABLE generation_tasks(account_id uuid,workspace_id uuid,project_revision_id uuid,state text,finished_at timestamptz,version integer,updated_at timestamptz);
   CREATE TABLE video_runtime_states(id uuid,generation_request_id uuid,stage text,terminal_at timestamptz,terminal_reason text,version integer,updated_at timestamptz);
   CREATE TABLE video_runtime_lane_states(runtime_id uuid,state text,version integer,updated_at timestamptz);
   CREATE TABLE provider_workload_leases(id uuid,account_id uuid,workspace_id uuid,generation_request_id uuid,request_kind text,
    state text,expires_at timestamptz,released_at timestamptz,release_reason text,version integer,heartbeat_at timestamptz);
   CREATE FUNCTION videoforge_settle_cloud_media_cpu_failure(target_attempt uuid) RETURNS boolean LANGUAGE plpgsql AS $$
   DECLARE a hosted_cpu_job_attempts%ROWTYPE; request generation_requests%ROWTYPE; canceled boolean; lease_count integer; now_at timestamptz:=now();
   BEGIN SELECT * INTO a FROM hosted_cpu_job_attempts WHERE id=target_attempt;
    canceled:=a.state='CANCELLED'; RETURN false; END; $$;
   SELECT set_config('videoforge.account_id','${account}',false);
   INSERT INTO cloud_media_budget_authorities VALUES('${authority}',false,now()-interval '1 day');
   INSERT INTO hosted_cpu_job_attempts VALUES('${attempt}','${account}','${workspace}','${project}','${revision}','FAILED','SPAN_AUDIO',now());
   INSERT INTO cloud_media_reservations VALUES('${reservation}','${account}','${workspace}','${project}','${revision}',
    '${attempt}','${authority}','STOPPING','UNKNOWN',NULL,NULL,now()-interval '1 day');
   INSERT INTO projects VALUES('${project}','${account}','${workspace}','${other}','KIE_FAL');
   INSERT INTO generation_requests VALUES('${request}','${account}','${workspace}','${project}','${revision}','${other}','ACTIVE',NULL,now(),now(),1);
   INSERT INTO project_revisions VALUES('${revision}','${account}','${workspace}','${project}','RUNPOD_POD');
   INSERT INTO provider_workload_leases VALUES('${request}','${account}','${workspace}','${request}','VIDEO','ACTIVE',now()+interval '1 hour',NULL,NULL,1,now());`);
  await db.exec(guard);
  await db.exec(await readFile(new URL("../../../../../packages/control-plane/migrations/0235_cloud_cleanup_local_isolation.sql",import.meta.url),"utf8"));
  const eligible=async()=> (await db.query<{ok:boolean}>("SELECT videoforge_cloud_cleanup_only($1) AS ok",[reservation])).rows[0]?.ok;
  const frozen=(await db.query("SELECT * FROM cloud_media_reservations")).rows;
  expect(await eligible()).toBe(true);
  const unsafe=[
   "UPDATE cloud_media_reservations SET state='AMBIGUOUS'",
   "UPDATE cloud_media_reservations SET pod_id='known-pod'",
   "UPDATE cloud_media_reservations SET deadline_at=now()+interval '1 hour'",
   "UPDATE hosted_cpu_job_attempts SET state='RUNNING'",
   "UPDATE hosted_cpu_job_attempts SET terminal_at=NULL",
   "UPDATE cloud_media_budget_authorities SET enabled=true,expires_at=now()+interval '1 hour'",
   `INSERT INTO hosted_api_generation_jobs VALUES('${account}','${workspace}','${project}','${revision}')`,
   `INSERT INTO media_worker_leases VALUES('${attempt}','${account}','${workspace}','RUNNING')`,
   `INSERT INTO hosted_cpu_job_attempts VALUES('${other}','${account}','${workspace}','${project}','${revision}','OUTBOXED','SPAN_AUDIO',NULL)`,
   `SELECT set_config('videoforge.account_id','${other}',false)`,
  ];
  for(const mutation of unsafe){
   await db.exec("BEGIN"); await db.exec(mutation);
   expect(await eligible(),mutation).toBe(false); await db.exec("ROLLBACK");
  }
  const sql=db as unknown as SqlExecutor;
  expect(await hostedAccountCleanupPending(sql,account,workspace,null,"PERSONAL_WORKER")).toBe(false);
  expect(await hostedAccountCleanupPending(sql,account,workspace,null,"RUNPOD_POD")).toBe(true);
  expect((await db.query<{ok:boolean}>("SELECT videoforge_settle_cloud_media_cpu_failure($1) AS ok",[attempt])).rows[0]?.ok).toBe(true);
  expect((await db.query("SELECT state FROM generation_requests")).rows).toEqual([{state:"FAILED"}]);
  expect((await db.query("SELECT state,release_reason FROM provider_workload_leases")).rows).toEqual([{state:"RELEASED",release_reason:"CLOUD_CLEANUP_ISOLATED"}]);
  expect((await db.query("SELECT * FROM cloud_media_reservations")).rows).toEqual(frozen);
  // A fresh Cloud request remains blocked even though the failed video's VIDEO lease retired.
  await db.exec(`INSERT INTO generation_requests VALUES('${other}','${account}','${workspace}','${project}','${other}','${other}','ACTIVE',NULL,now(),now(),1);
   INSERT INTO project_revisions VALUES('${other}','${account}','${workspace}','${project}','RUNPOD_POD');`);
  const insert=`INSERT INTO provider_workload_leases(id,account_id,workspace_id,generation_request_id,request_kind,state,expires_at)
    VALUES('${other}','${account}','${workspace}','${other}','VIDEO','ACTIVE',now()+interval '1 hour')`;
  await expect(db.exec(insert)).rejects.toThrow("admission held by cloud execution or unconfirmed cleanup");
  await db.exec(`UPDATE project_revisions SET media_execution_backend='PERSONAL_WORKER' WHERE id='${other}'`);
  await db.exec(insert);
  expect((await db.query("SELECT count(*)::int AS n FROM provider_workload_leases WHERE state='ACTIVE'")).rows).toEqual([{n:1}]);
  await db.exec(`INSERT INTO provider_workload_leases(id,account_id,workspace_id,generation_request_id,request_kind,state,expires_at)
    VALUES('${revision}','${other}','${workspace}','${revision}','VIDEO','ACTIVE',now()+interval '1 hour')`);
  await expect(db.exec(`INSERT INTO provider_workload_leases(id,account_id,workspace_id,generation_request_id,request_kind,state,expires_at)
    VALUES('${project}','${revision}','${workspace}','${project}','VIDEO','ACTIVE',now()+interval '1 hour')`))
    .rejects.toThrow("admission held by cloud execution or unconfirmed cleanup");
  expect((await db.query("SELECT * FROM cloud_media_reservations")).rows).toEqual(frozen);
 }finally{await db.close();}
},30000);

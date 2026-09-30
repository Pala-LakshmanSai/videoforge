// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostedRuntimeConfiguration, HostedRuntimeEnvironment } from "./configuration";
import { deriveCallbackToken, sha256 } from "./crypto";
import asrResultFixture from "../../../../../packages/contracts/generated/fixtures/asr_job_result.valid.json";
import renderResultFixture from "../../../../../packages/contracts/generated/fixtures/render_job_result.valid.json";
import renderManifestFixture from "../../../../../packages/contracts/generated/fixtures/resolved_render_manifest.valid.json";
import { MULTIPART_PART_BYTES } from "./runpod-media-policy";
import { createNeonPool } from "./neon";

const fixture = vi.hoisted(() => ({ query: vi.fn(), admission:vi.fn(), finalize:vi.fn(), transport: vi.fn(), checksum: vi.fn(), multipart: vi.fn(), part: vi.fn(), sign: vi.fn(), listMultipart:vi.fn() }));
vi.mock("./neon", () => ({ createNeonPool: vi.fn(() => ({ query: fixture.query, end: async () => {} })),
  createNeonExecutor: () => ({ transaction: async (run: (sql: unknown) => unknown) => run({ query: fixture.query }) }) }));
vi.mock("./r2-checksum", () => ({ verifyHostedObjectChecksum: fixture.checksum }));
vi.mock("./r2", () => ({ HostedR2Signer: class { multipartRequest = fixture.multipart; signMultipartPart = fixture.part; sign = fixture.sign; listMultipartUploadsExact=fixture.listMultipart; } }));
vi.mock("./app",()=>({createHostedV209RenderTerminalLiveCoordinator:()=>({acceptCompleted:fixture.finalize})}));
vi.mock("./hosted-v209-queue-admission",()=>({ensureHostedV209GenerationAdmission:fixture.admission}));
import { CLOUD_COMPUTE_ABSENCE_EVENT_SQL, CLOUD_CREATE_RENTAL_SQL, CLOUD_PRE_CREATE_ALLOWED_SQL, CLOUD_PLACEMENT_READY_SQL, CLOUD_DISK_METRICS_SQL, CLOUD_QUALIFICATION_RENDER_ARTIFACT_SQL, CLOUD_TERMINAL_EVENT_SQL, cleanupCloudReservation, cloudJobAllowance, cloudRenderDuration, handleCloudMediaRequest, RunPodMediaClient, runCloudMediaObservation, validCloudDiskMetrics, verifyCloudPlacement } from "./runpod-media";

async function installReservationAuthority(db:{exec(sql:string):Promise<unknown>}) {
  const {readFile}=await import("node:fs/promises");
  const source=await readFile(new URL("../../../../../packages/control-plane/migrations/0220_hosted_cloud_reservation_authority.sql",import.meta.url),"utf8");
  await db.exec(`CREATE FUNCTION public.videoforge_current_account_id() RETURNS uuid LANGUAGE sql AS $$
    SELECT current_setting('videoforge.account_id',true)::uuid $$;`);
  await db.exec(source.slice(source.indexOf("CREATE FUNCTION"),source.indexOf("REVOKE ALL ON FUNCTION")));
  await db.exec(`SELECT set_config('videoforge.account_id','11111111-1111-4111-8111-111111111111',false)`);
}

type Row = Record<string, unknown>;
const accountId = "11111111-1111-4111-8111-111111111111", workspaceId = "22222222-2222-4222-8222-222222222222";
const attemptId = "33333333-3333-4333-8333-333333333333", reservationId = "44444444-4444-4444-8444-444444444444";
const hash = `sha256:${"a".repeat(64)}`, capability = "c".repeat(64);
const scope = { accountId, workspaceId, attemptId };
const environment = { RUNPOD_API_KEY: "fixture-key", PRIVATE_ARTIFACTS: { head: vi.fn(),get: vi.fn() } } as unknown as HostedRuntimeEnvironment;
const config = { publicOrigin: "https://videoforge.example", neon: { databaseUrl: "fixture" }, workflowCallbackSecret: "fixture-secret",
  cloudMedia: { apiKey: "fixture-key", image: `ghcr.io/example/media@${hash}`, sourceSha256: hash,runtimeSha256:hash,tooling:{ffmpeg_version:"8.1.2"} } } as unknown as HostedRuntimeConfiguration;
let attempt: Row, reservation: Row, upload: Row, measuredJob:Row, tokenHash: string, raceCancel = false, rotateBeforeStop = false, generationActive = false, cpuSettled = true, noReservation = false, qualificationAllowed=true, expiresBeforePost=false, placementExpired=false;
let resultBytes:Uint8Array, templateBytes:Uint8Array, ordinaryRuntime=true, renderOnlyRun:Row | null=null;
const future = () => new Date(Date.now() + 3_600_000).toISOString();
const exactRenderOnlyRun = ():Row => ({attemptId,accountId,workspaceId,projectId:attempt.project_id,projectRevisionId:attempt.project_revision_id,
  generationRequestId:reservationId,sourceAttemptId:workspaceId,state:"PREPARING"});

it("sizes job allowances by kind and duration within every explicit operator cap",()=>{
  for(const kind of ["ASR","SPAN_AUDIO","RENDER"]) expect(cloudJobAllowance(kind,159200,.8,1.6,7200)).toEqual({rentalSeconds:900,budgetUsd:.2});
  for(const kind of ["ASR","SPAN_AUDIO"]) expect(cloudJobAllowance(kind,2700000,.8,1.6,7200)).toEqual({rentalSeconds:900,budgetUsd:.2});
  expect(cloudJobAllowance("RENDER",2700000,.8,1.6,7200)).toEqual({rentalSeconds:7200,budgetUsd:1.6});
  expect(cloudJobAllowance("RENDER",2700000,.8,.07,300)).toEqual({rentalSeconds:300,budgetUsd:.07});
  expect(cloudJobAllowance("RENDER",2700000,.8,.05,7200)).toEqual({rentalSeconds:7200,budgetUsd:.05});
  expect(cloudJobAllowance("RENDER",3600000,.8,3,14400)).toEqual({rentalSeconds:9600,budgetUsd:2.14});
  expect(cloudJobAllowance("ASR",90000,.8,.01,60)).toEqual({rentalSeconds:60,budgetUsd:.01});
  expect(()=>cloudJobAllowance("RENDER",NaN,.8,1.6,7200)).toThrow("CLOUD_MEDIA_ALLOWANCE_INVALID");
});

it("keeps private budget facts behind the exact reservation authority projection",async()=>{
  const {readFile}=await import("node:fs/promises");
  const controller=await readFile(new URL("./runpod-media.ts",import.meta.url),"utf8");
  expect(controller).not.toMatch(/\b(?:FROM|JOIN|UPDATE|INSERT INTO)\s+(?:public\.)?cloud_media_budget_(?:authorities|debits)\b/iu);
  expect(CLOUD_CREATE_RENTAL_SQL).toContain("videoforge_cloud_media_reservation_authority($1,$4,$5)");
  expect(CLOUD_PRE_CREATE_ALLOWED_SQL).toContain("videoforge_cloud_media_reservation_authority(r.id,r.leased_attempt_id,r.fence_id)");
  expect(CLOUD_PLACEMENT_READY_SQL).toContain("videoforge_cloud_media_reservation_authority($1,$2,$3)");
});

it("authorizes only the exact server-prepared render-only backend capability in PostgreSQL",async()=>{
  const {PGlite}=await import("@electric-sql/pglite"),{readFile}=await import("node:fs/promises");
  const source=await readFile(new URL("./app.ts",import.meta.url),"utf8");
  const statement=source.match(/`SELECT EXISTS\(SELECT 1 FROM cloud_media_render_recoveries recovery[\s\S]*?AS authorized`/u)?.[0].slice(1,-1);
  expect(statement).toBeDefined();
  const db=new PGlite();
  try {
    await db.exec(`CREATE TABLE cloud_media_render_recoveries(account_id uuid,workspace_id uuid,project_id uuid,
      project_revision_id uuid,retry_attempt_id uuid,replacement_bundle_sha256 text,state text);
      CREATE TABLE hosted_render_only_runs(account_id uuid,workspace_id uuid,project_id uuid,
      project_revision_id uuid,id uuid,execution_bundle_sha256 text,state text);`);
    const values=[accountId,workspaceId,"55555555-5555-4555-8555-555555555555",
      "66666666-6666-4666-8666-666666666666",attemptId,hash,`render-only:${attemptId}`];
    await db.query("INSERT INTO hosted_render_only_runs VALUES($1,$2,$3,$4,$5,$6,'PREPARING')",values.slice(0,6));
    const authorized=async(input:unknown[]) => (await db.query<{authorized:boolean}>(statement!,input)).rows[0]?.authorized;
    expect(await authorized(values)).toBe(true);
    for(let index=0;index<values.length;index++) {
      const wrong=[...values];wrong[index]=index<5?reservationId:index===5?`sha256:${"b".repeat(64)}`:`render-cloud-recovery:${attemptId}`;
      expect(await authorized(wrong)).toBe(false);
    }
    await db.exec("UPDATE hosted_render_only_runs SET state='FAILED'");
    expect(await authorized(values)).toBe(false);
    await db.query("INSERT INTO cloud_media_render_recoveries VALUES($1,$2,$3,$4,$5,$6,'CONSUMED')",values.slice(0,6));
    expect(await authorized([...values.slice(0,6),`render-cloud-recovery:${attemptId}`])).toBe(true);
  } finally {await db.close();}
},30000);

it("keeps an initial controller permission failure provider-inert and observable",async()=>{
  fixture.query.mockRejectedValueOnce(Object.assign(new Error("private connection detail"),{code:"42501"}));
  expect(await runCloudMediaObservation(environment,config,scope)).toEqual({state:"RECONCILING",delaySeconds:30,
    observationError:{phase:"CONTROLLER_ACCESS",code:"SQLSTATE_42501"}});
  expect(fixture.transport).not.toHaveBeenCalled();
  expect(fixture.query.mock.calls.some(([sql])=>/INSERT|UPDATE|DELETE/u.test(String(sql)))).toBe(false);
});

it.each(["valid","missing-commit","corrupt","wrong-revision"])("sizes render scratch only from an exact committed manifest: %s",async mode=>{
  const doc=structuredClone(renderManifestFixture),bytes=new TextEncoder().encode(JSON.stringify(doc)),checksum=await sha256(JSON.stringify(doc));
  const localAttempt={id:attemptId,project_revision_id:doc.project_revision_id,voiceover_duration_ms:159216};
  const template={input_document:{project_revision_id:doc.project_revision_id,resolved_render_manifest:{artifact_uri:"manifest-uri",sha256:checksum}}};
  fixture.query.mockResolvedValue({rows:mode==="missing-commit"?[]:[{object_key:"exact-manifest",content_length:bytes.byteLength}],affectedRows:0});
  const sql={execute:vi.fn(),query:fixture.query};
  const bucket={PRIVATE_ARTIFACTS:{get:vi.fn(async()=>({size:bytes.byteLength,arrayBuffer:async()=>mode==="corrupt"?new Uint8Array(bytes.byteLength).buffer:bytes.buffer}))}} as unknown as HostedRuntimeEnvironment;
  if(mode==="wrong-revision") localAttempt.project_revision_id="foreign-revision";
  if(mode==="valid") expect(await cloudRenderDuration(bucket,sql,localAttempt,template)).toBe(12000);
  else await expect(cloudRenderDuration(bucket,sql,localAttempt,template)).rejects.toThrow("CLOUD_MEDIA_MANIFEST_INVALID");
  expect(fixture.transport).not.toHaveBeenCalled();
});

it.each(["foreign-reservation","foreign-project"])("rejects %s before staging qualification can mutate or observe provider state",async reason=>{
  Object.assign(environment,{VIDEOFORGE_CLOUD_MEDIA_QUALIFICATION_ONLY:"true",VIDEOFORGE_ENVIRONMENT:"staging",VIDEOFORGE_CLOUD_MEDIA_BUDGET_AUTHORITY_ID:reservationId});
  reservation.budget_authority_id=reason==="foreign-reservation"?attemptId:reservationId;
  noReservation=reason==="foreign-project";
  qualificationAllowed=reason!=="foreign-project";
  expect(await runCloudMediaObservation(environment,config,scope)).toEqual({state:"QUALIFICATION_SCOPE_REJECTED"});
  expect(fixture.transport).not.toHaveBeenCalled();
  expect(fixture.query.mock.calls.some(([sql])=>/INSERT|UPDATE|DELETE|renew_admission|reserve_budget/u.test(String(sql)))).toBe(false);
});
it("continues exact owned cleanup after its qualification approval expires",async()=>{
  Object.assign(environment,{VIDEOFORGE_CLOUD_MEDIA_QUALIFICATION_ONLY:"true",VIDEOFORGE_ENVIRONMENT:"staging",VIDEOFORGE_CLOUD_MEDIA_BUDGET_AUTHORITY_ID:reservationId});
  reservation.budget_authority_id=reservationId;qualificationAllowed=false;
  attempt.state="CANCEL_REQUESTED";reservation.launch_outcome=null;
  expect((await runCloudMediaObservation(environment,config,scope)).state).toBe("CANCELLED");
  expect(reservation.state).toBe("CLEAN");
  expect(fixture.query.mock.calls.some(([sql])=>String(sql).includes("qualification_scope"))).toBe(false);
  expect(fixture.transport).not.toHaveBeenCalled();
});
function placement(changes: Row = {}): Row {
  return { id: "owned-pod", name: reservation.pod_name, image: reservation.image, cloud: "SECURE", disk: 100,
    cost: .4, gpu: { id: "NVIDIA GeForce RTX 4090", count: 1, vcpuCount: 16, memory: 64 }, ...changes };
}
const response = (value: unknown, status = 200) => Response.json(value, { status });
const emptyInventory = () => response({ pods: [], pagination: { hasNextPage: false } });
function request(action: string, body: unknown, token = capability): Request {
  return new Request(`https://videoforge.example/api/v2/cloud-media/reservations/${reservationId}/${action}?attempt_id=${attemptId}`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body),
  });
}
const runRoute = (action: string, body: unknown, token = capability) => handleCloudMediaRequest(request(action, body, token), environment, config, { waitUntil() {} });
const primary = { source: "PRIMARY_RESULT_OUTPUT", object_key: "primary", max_bytes:16_777_216, issued_content_length: 100, issued_checksum_sha256: hash, content_type: "video/mp4" };
const result = { source: "RESULT_DOCUMENT", object_key: "result", issued_content_length: 50, issued_checksum_sha256: hash, content_type: "application/json" };
const completion = { schema_version: "videoforge-personal-worker-completion/v1", status: "SUCCEEDED", result_object_key: "result", result_content_length: 50, result_checksum_sha256: hash };

it.each(["normal-submission", "random-fixture-credential", "stale-lease"])(
  "issues an exact cloud upload port only with the server-derived credential and current lease: %s", async mode => {
    reservation.state = mode === "stale-lease" ? "STOPPING" : "SAVING";
    const expected = await sha256(await deriveCallbackToken(config.workflowCallbackSecret, attemptId));
    const stored = mode === "random-fixture-credential" ? hash : expected;
    const previous = fixture.query.getMockImplementation()!;
    fixture.query.mockImplementation(async (sql: string, values: unknown[] = []) => {
      if (sql.includes("videoforge_authorize_hosted_cpu_upload")) {
        expect(values).toEqual([attemptId, expected, primary.source, primary.object_key, primary.content_type, 100, hash]);
        return { rows: [{ authorized: stored === values[1] }] };
      }
      return previous(sql, values);
    });
    fixture.sign.mockResolvedValue({ method: "PUT", contentLength: 100, checksumSha256: hash, contentType: primary.content_type });
    const response = await runRoute("upload-port", { schema_version: "videoforge-personal-worker-upload-authority/v1",
      source: primary.source, object_key: primary.object_key, content_type: primary.content_type, content_length: 100, checksum_sha256: hash });
    if (!response) throw new Error("Cloud upload route was not handled");
    expect(response.status).toBe(mode === "normal-submission" ? 200 : 409);
    expect(fixture.sign).toHaveBeenCalledTimes(mode === "normal-submission" ? 1 : 0);
    expect(fixture.transport).not.toHaveBeenCalled();
  },
);

it("enforces the applied upload function's callback, ownership, immutable facts and terminal guards in PostgreSQL", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { readFile } = await import("node:fs/promises");
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE hosted_cpu_job_attempts(id uuid PRIMARY KEY, account_id uuid, workspace_id uuid,
      project_id uuid, project_revision_id uuid, callback_token_sha256 text, state text, deadline_at timestamptz,
      result_object_key text, result_content_type text, result_max_bytes bigint);
      CREATE TABLE hosted_cpu_upload_authorities(id uuid PRIMARY KEY, account_id uuid, workspace_id uuid, attempt_id uuid,
      source text, object_key text, content_type text, max_bytes bigint, issued_at timestamptz,
      issued_content_length bigint, issued_checksum_sha256 text);`);
    const migration = await readFile(new URL("../../../../../packages/control-plane/migrations/0030_v2_06_hosted_upload_authority.sql", import.meta.url), "utf8");
    const start = migration.indexOf("CREATE FUNCTION public.videoforge_authorize_hosted_cpu_upload(");
    const end = migration.indexOf("REVOKE ALL ON FUNCTION", start);
    expect(start).toBeGreaterThan(0); expect(end).toBeGreaterThan(start);
    await db.exec(migration.slice(start, end));
    const expected = await sha256(await deriveCallbackToken(config.workflowCallbackSecret, attemptId));
    const key = `tenant/${accountId}/workspace/${workspaceId}/project/${attempt.project_id}/revision/${attempt.project_revision_id}/lane/render/job/${attemptId}/artifact/final`;
    await db.query("INSERT INTO hosted_cpu_job_attempts VALUES($1,$2,$3,$4,$5,$6,'RUNNING',now()+interval '1 hour',$7,'application/json',1048576)",
      [attemptId, accountId, workspaceId, attempt.project_id, attempt.project_revision_id, expected, key + "-result"]);
    await db.query("INSERT INTO hosted_cpu_upload_authorities(id,account_id,workspace_id,attempt_id,source,object_key,content_type,max_bytes) VALUES($1,$2,$3,$4,'PRIMARY_RESULT_OUTPUT',$5,'video/mp4',1000)",
      [upload.id, accountId, workspaceId, attemptId, key]);
    const authorize = async (token: string = expected, objectKey = key, checksum: string = hash) => (await db.query<{ authorized: boolean }>(
      "SELECT public.videoforge_authorize_hosted_cpu_upload($1,$2,'PRIMARY_RESULT_OUTPUT',$3,'video/mp4',100,$4,now()) AS authorized",
      [attemptId, token, objectKey, checksum])).rows[0]!.authorized;
    expect(await authorize(hash)).toBe(false);
    expect(await authorize(expected, key.replace(accountId, workspaceId))).toBe(false);
    expect(await authorize()).toBe(true); expect(await authorize()).toBe(true);
    expect(await authorize(expected, key, `sha256:${"b".repeat(64)}`)).toBe(false);
    await db.query("UPDATE hosted_cpu_job_attempts SET state='CANCELLED' WHERE id=$1", [attemptId]);
    expect(await authorize()).toBe(false);
  } finally { await db.close(); }
});

async function setTemplate(kind:string,input:Row):Promise<void> {
  const text=JSON.stringify({schema_version:"videoforge-cloud-media-job-template/v1",attempt_id:attemptId,kind,input_document:input,
    runtime_identity:{image:config.cloudMedia!.image,registry_id:null,source_sha256:hash,runtime_sha256:hash},tooling:config.cloudMedia!.tooling});
  templateBytes=new TextEncoder().encode(text);reservation.job_spec_object_key="template";
  reservation.job_spec_content_length=templateBytes.byteLength;reservation.job_spec_checksum_sha256=await sha256(text);
}
async function setResultDocument(value:unknown):Promise<void> {
  const text=typeof value==="string"?value:JSON.stringify(value);
  resultBytes=new TextEncoder().encode(text);
  result.issued_content_length=resultBytes.byteLength;result.issued_checksum_sha256=await sha256(text);
  completion.result_content_length=resultBytes.byteLength;completion.result_checksum_sha256=result.issued_checksum_sha256;
}

beforeEach(async () => {
  for(const key of ["VIDEOFORGE_CLOUD_MEDIA_QUALIFICATION_ONLY","VIDEOFORGE_ENVIRONMENT","VIDEOFORGE_CLOUD_MEDIA_BUDGET_AUTHORITY_ID"]) Reflect.deleteProperty(environment,key);
  qualificationAllowed=true;expiresBeforePost=false;placementExpired=false;renderOnlyRun=null;
  fixture.finalize.mockReset();fixture.finalize.mockResolvedValue(undefined);
  fixture.admission.mockReset();fixture.admission.mockResolvedValue({state:"ACTIVE"});ordinaryRuntime=true;
  vi.clearAllMocks(); raceCancel = false; rotateBeforeStop = false; generationActive = false; cpuSettled = true; noReservation = false; tokenHash = await sha256(capability);
  attempt = { id: attemptId, account_id: accountId, workspace_id: workspaceId, state: "RUNNING", kind: "RENDER",
    project_id: "55555555-5555-4555-8555-555555555555", project_revision_id: "66666666-6666-4666-8666-666666666666", deadline_at: future() };
  reservation = { id: reservationId, attempt_id: attemptId, leased_attempt_id: attemptId, account_id: accountId, workspace_id: workspaceId,
    fence_id: "77777777-7777-4777-8777-777777777777", state: "WAITING_CAPACITY", pod_name: `videoforge-media-${reservationId}`,
    image: `ghcr.io/example/media@${hash}`, gpu: "NVIDIA GeForce RTX 4090", disk_gb: 100, max_hourly_usd: 1,
    budget_usd: 2, rental_seconds: 7200, round: 0, candidate_index: 0, next_check_at: new Date(0).toISOString(),
    placement_deadline_at: future(), deadline_at: future(), authority_expires_at:future(),authority_enabled:true, launch_outcome: "UNKNOWN", verified_at: new Date().toISOString() };
  upload = { id: "88888888-8888-4888-8888-888888888888", reservation_id: reservationId, upload_id: "fixture-upload",
    object_key: "primary", content_length: MULTIPART_PART_BYTES * 2, checksum_sha256: hash, state: "OPEN" };
  measuredJob={};
  primary.issued_content_length=100;primary.issued_checksum_sha256=hash;primary.content_type="video/mp4";
  const doc=structuredClone(renderResultFixture);doc.attempt_id=attemptId;doc.output.sha256=hash;doc.output.bytes=100;doc.probe.sha256=hash;doc.probe.bytes=100;
  await setResultDocument(doc);
  const template=JSON.stringify({schema_version:"videoforge-cloud-media-job-template/v1",attempt_id:attemptId,kind:"RENDER",
    input_document:{output:{filename:doc.output.filename}}});
  templateBytes=new TextEncoder().encode(template);reservation.job_spec_object_key="template";
  reservation.job_spec_content_length=templateBytes.byteLength;reservation.job_spec_checksum_sha256=await sha256(template);
  (environment.PRIVATE_ARTIFACTS!.get as ReturnType<typeof vi.fn>).mockImplementation(async (key:string)=>{
    const bytes=key==="template"?templateBytes:resultBytes;
    return {size:bytes.byteLength,httpMetadata:{contentType:"application/json"},arrayBuffer:async()=>bytes.buffer};
  });
  fixture.checksum.mockResolvedValue(true);
  fixture.part.mockResolvedValue("https://private.example/signed-part");
  fixture.multipart.mockResolvedValue(new Response("<CompleteMultipartUploadResult/>"));
  fixture.listMultipart.mockReset();fixture.listMultipart.mockResolvedValue([]);
  const head = environment.PRIVATE_ARTIFACTS!.head as ReturnType<typeof vi.fn>;
  head.mockImplementation(async (key: string) => ({ size: key === "result" ? result.issued_content_length : primary.issued_content_length,
    httpMetadata: { contentType: key === "result" ? "application/json" : primary.content_type } }));
  fixture.query.mockImplementation(async (sql: string, values: unknown[] = []) => {
    if (sql.includes("SELECT set_config")) return { rows: [] };
    if(sql.includes("videoforge_read_cloud_render_only_run")) return {rows:[{run:values[0]===attemptId?renderOnlyRun:null}]};
    if(sql.includes("videoforge_settle_cloud_render_only_run")) return {rows:[{settled:cpuSettled}]};
    if(sql.includes("allowed_create_reservation")) return {rows:reservation.state==="CREATING" && attempt.state==="RUNNING" && Date.parse(String(reservation.deadline_at))>Date.now() && reservation.authority_enabled===true && Date.parse(String(reservation.authority_expires_at))>Date.now() && values[1]===reservation.leased_attempt_id && values[2]===reservation.fence_id ? [{id:reservationId}]:[]};
    if(sql.includes("qualification_artifact_attempt_id")) return {rows:qualificationAllowed && attempt.state==="SUCCEEDED" && attempt.kind==="RENDER" && attempt.result_receipt_sha256 && attempt.result_object_key && Number(attempt.result_content_length)>0 && attempt.result_checksum_sha256 && reservation.state==="CLEAN" && reservation.cleanup_verified_at && values[3]===reservation.budget_authority_id ? [{qualification_artifact_attempt_id:attemptId}]:[]};
    if (sql.includes("videoforge_cloud_media_qualification_scope")) return {rows:[{allowed:qualificationAllowed}]};
    if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
    if (sql.includes("SELECT r.id FROM cloud_media_reservations r")) return {rows:[{id:reservationId}]};
    if (sql.includes("videoforge_cloud_media_capability_scope")) return { rows: values[1] === tokenHash ? [{ account_id: accountId }] : [] };
    if (sql.includes("SELECT a.*,p.owner_user_id")) return { rows: [{ ...attempt }] };
    if (sql.includes("SELECT r.*,b.expires_at AS authority_expires_at")) return { rows: noReservation ? [] : [{ ...reservation }] };
    if (sql.includes("SELECT r.*,a.state AS attempt_state")) return { rows: [{ ...reservation, attempt_state: attempt.state, kind: attempt.kind }] };
    if (sql.includes("SELECT * FROM hosted_cpu_job_attempts")) return { rows: [{ ...attempt }] };
    if (sql.includes("SELECT * FROM hosted_cpu_upload_authorities")) return { rows: [primary, result] };
    if (sql.includes("u.state NOT IN ('VERIFIED','ABORTED')")) return {rows:!["VERIFIED","ABORTED"].includes(String(upload.state))?[{...upload}]:[]};
    if (sql.includes("SELECT u.* FROM cloud_media_multipart_uploads")) return { rows: [{ ...upload }] };
    if(sql.includes("last_heartbeat_at=now(),updated_at=now() WHERE id=$1 AND leased_attempt_id=$3")) {
      const phases=["STARTING","DOWNLOADING","RENDERING","CHECKING","SAVING"];
      if(attempt.state!=="RUNNING" || values[2]!==reservation.leased_attempt_id || values[3]!==reservation.fence_id) return {rows:[]};
      if(values[1]!==null && phases.indexOf(String(values[1]))>=phases.indexOf(String(reservation.state))) reservation.state=values[1];
      return {rows:[{id:reservationId}]};
    }
    if(sql.includes("UPDATE cloud_media_jobs SET")) {
      measuredJob.technical_verification_ms ??= values[3];measuredJob.artifact_verification_ms ??= values[4];return {rows:[]};
    }
    if(String(sql).includes("UPDATE cloud_media_jobs j SET disk_metrics")) return {rows:attempt.state==="RUNNING" && values[1]===reservation.leased_attempt_id && values[2]===reservation.fence_id ? [{attempt_id:attemptId}]:[]};
    if (sql.includes("INSERT INTO cloud_media_multipart_parts")) return { rows: [] };
    if (sql.includes("SELECT part_number,content_length FROM cloud_media_multipart_parts")) return { rows: [
      { part_number: 1, content_length: MULTIPART_PART_BYTES }, { part_number: 2, content_length: MULTIPART_PART_BYTES }] };
    if (sql.includes("videoforge_settle_stranded_hosted_v209_requests")) return { rows: [{ settled: 1 }] };
    if (sql.includes("SELECT v.generation_request_id FROM video_runtime_states v")) return {rows:ordinaryRuntime?[{generation_request_id:"fixture-generation"}]:[]};
    if (sql.includes("videoforge_settle_cloud_media_cpu_failure")) return { rows: [{ settled: cpuSettled }] };
    if (sql.includes("SELECT id FROM generation_requests WHERE account_id=")) return { rows: generationActive ? [{ id: "fixture-generation" }] : [] };
    if (sql.includes("SET failure_settled_at=COALESCE")) { reservation.failure_settled_at = new Date().toISOString(); return { rows: [] }; }
    if (sql.includes("UPDATE cloud_media_reservations SET launch_outcome='REFUSED'")) {
      if(sql.includes("RETURNING id") && (values[1]!==reservation.leased_attempt_id || values[2]!==reservation.fence_id || reservation.state!=="CREATING"))return{rows:[]};
      reservation.launch_outcome = "REFUSED"; return { rows: sql.includes("RETURNING id")?[{id:reservationId,attempt_state:attempt.state}]:[] }; }
    if (sql.includes("videoforge_cloud_media_reserve_budget") || sql.includes("videoforge_cloud_media_renew_admission")) return { rows: [{ reserved: true }] };
    if (sql.includes("SELECT id FROM cloud_media_reservations")) return { rows: reservation.state === "WAITING_CAPACITY" ? [{ id: reservationId }] : [] };
    if (sql.includes("SELECT state FROM hosted_cpu_job_attempts")) return { rows: [{ state: attempt.state }] };
    if (sql.trimStart().startsWith("SELECT 1 FROM cloud_media_reservations")) {
      const fresh = attempt.state === "RUNNING" && Date.parse(String(reservation.deadline_at))>Date.now() &&
        Date.parse(String(attempt.deadline_at))>Date.now() && values[1]===reservation.fence_id &&
        (values.length<3 || values[2]===reservation.leased_attempt_id) &&
        (reservation.state === "SAVING" || (values[3]===true && reservation.state==="STOPPING" && reservation.failure_code==="CLOUD_MEDIA_RECEIPT_PENDING"));
      if (raceCancel) attempt.state = "CANCEL_REQUESTED";
      return { rows: fresh ? [{}] : [] };
    }
    if (sql.includes("UPDATE hosted_cpu_job_attempts SET state=$2")) {
      if (values[1] === "SUCCEEDED" && (attempt.state !== "RUNNING" || values[7]!==reservation.id ||
        values[8]!==reservation.fence_id || values[0]!==reservation.leased_attempt_id ||
        Date.parse(String(reservation.deadline_at))<=Date.now() || Date.parse(String(attempt.deadline_at))<=Date.now() ||
        !(reservation.state==="SAVING" || (values[9]===true && reservation.state==="STOPPING" && reservation.failure_code==="CLOUD_MEDIA_RECEIPT_PENDING")))) return { rows: [] };
      if(values[1]==="SUCCEEDED") {attempt.failure_code=null;attempt.result_object_key=values[2];attempt.result_content_length=values[3];attempt.result_checksum_sha256=values[4];attempt.result_receipt_sha256=values[5];}
      attempt.state = values[1];if(values[1]==="FAILED") attempt.failure_code=values[6]; return { rows: [{ id: attemptId }] };
    }
    if (sql.includes("UPDATE hosted_cpu_job_attempts SET state='RUNNING'")) { attempt.state = "RUNNING"; return { rows: [{ id: attemptId }] }; }
    if (sql.includes("UPDATE cloud_media_reservations SET state='CREATING'")) {
      if (reservation.state !== "WAITING_CAPACITY") return { rows: [] };
      reservation.state = "CREATING"; reservation.gpu = values[1]; reservation.launch_outcome = "UNKNOWN";if(expiresBeforePost)reservation.deadline_at=new Date(0).toISOString();
      return { rows: [{ ...reservation }] };
    }
    if (sql.includes("UPDATE cloud_media_reservations SET state='WAITING_CAPACITY'")) {
      reservation.state = "WAITING_CAPACITY"; reservation.launch_outcome = "REFUSED";
      reservation.candidate_index = Number(reservation.candidate_index) + 1; return { rows: [] };
    }
    if (sql.includes("UPDATE cloud_media_reservations SET pod_id=")) {
      if(values[3]!==reservation.leased_attempt_id || values[4]!==reservation.fence_id)return{rows:[]};
      reservation.pod_id = values[1]; reservation.launch_outcome = "CONFIRMED"; return { rows: [{id:reservationId}] };
    }
    if (sql.includes("UPDATE cloud_media_reservations SET state='STARTING'")) { if(placementExpired)return{rows:[]};reservation.state = "STARTING"; return { rows: [{...reservation}] }; }
    if(sql.includes("expired_placement_reservation"))return{rows:placementExpired?[{id:reservationId}]:[]};
    if(sql.includes("SELECT id FROM hosted_cpu_job_attempts") && sql.includes("FOR UPDATE")) return {rows:values[0]===attemptId?[{id:attemptId}]:[]};
    if(sql.includes("UPDATE cloud_media_reservations SET updated_at=now()")) {
      if(reservation.state!=="STOPPING" || reservation.failure_code!=="CLOUD_MEDIA_RECEIPT_PENDING" ||
        values[1]!==reservation.leased_attempt_id || values[2]!==reservation.fence_id) return {rows:[]};
      return {rows:[{id:reservationId}]};
    }
    if (sql.includes("UPDATE cloud_media_reservations SET state='CLEAN'")) {
      if (values.length > 1 && (values[1] !== reservation.leased_attempt_id || values[2] !== reservation.fence_id)) return { rows: [] };
      reservation.state = "CLEAN"; reservation.cleanup_verified_at=new Date().toISOString(); return { rows: [{ id: reservationId }] };
    }
    if(sql.includes("SET state='STOPPING',failure_code='CLOUD_MEDIA_RECEIPT_PENDING'")) {
      if(reservation.state!=="SAVING" || reservation.failure_code || attempt.state!=="RUNNING" ||
        values[1]!==reservation.leased_attempt_id || values[2]!==reservation.fence_id ||
        Date.parse(String(reservation.deadline_at))<=Date.now() || Date.parse(String(attempt.deadline_at))<=Date.now()) return {rows:[]};
      reservation.state="STOPPING";reservation.failure_code="CLOUD_MEDIA_RECEIPT_PENDING";return {rows:[{id:reservationId}]};
    }
    if (sql.includes("UPDATE cloud_media_reservations SET state=$2")) {
      if (rotateBeforeStop && values[1] === "STOPPING") {
        rotateBeforeStop = false; reservation.leased_attempt_id = "99999999-9999-4999-8999-999999999999";
      }
      if (values.length > 3 && (values[3] !== reservation.leased_attempt_id || values[4] !== reservation.fence_id)) return { rows: [] };
      reservation.state = values[1];if(values[2]!=null) reservation.failure_code=values[2]; return { rows: [{ id: reservationId }] };
    }
    if (sql.includes("UPDATE cloud_media_multipart_uploads SET state='COMPLETING'")) { upload.state = "COMPLETING"; return { rows: [] }; }
    if (sql.includes("UPDATE cloud_media_multipart_uploads SET state='VERIFIED'")) { upload.state = "VERIFIED"; return { rows: [] }; }
    if (sql.includes("UPDATE cloud_media_multipart_uploads SET state='ABORTED'")) { upload.state = "ABORTED"; return { rows: [] }; }
    if (sql.includes("INSERT INTO hosted_cpu_job_events")) return { rows: [] };
    throw new Error(`Unexpected fixture SQL: ${sql}`);
  });
  fixture.transport.mockImplementation(async (url: string, options: RequestInit) => {
    if (url.includes("/catalog/")) return response({ gpus: [{ id: "NVIDIA GeForce RTX 4090", memory: 24,
      secure: true, manufacturer: "NVIDIA", price: { secure: .4 }, availability: "HIGH" }] });
    if (options.method === "GET") return emptyInventory();
    if (options.method === "POST") throw new Error("create response lost");
    return new Response(null, { status: 204 });
  });
  vi.stubGlobal("fetch", fixture.transport);
});
afterEach(() => vi.unstubAllGlobals());

describe("RunPod exact inventory and placement", () => {
  it("calls the transport without binding the client as its receiver", async () => {
    const transport = function(this: unknown): Promise<Response> {
      expect(this).toBeUndefined();
      return Promise.resolve(response({ gpus: [] }));
    };
    expect(await new RunPodMediaClient("fixture", transport).request("GET", "/catalog/gpus")).toEqual({gpus:[]});
  });
  it("reads every inventory page before claiming completeness", async () => {
    const transport = vi.fn().mockResolvedValueOnce(response({ pods: [{ id: "first" }], pagination: { hasNextPage: true, nextCursor: "next page" } }))
      .mockResolvedValueOnce(response({ pods: [{ id: "last" }], pagination: { hasNextPage: false } }));
    expect(await new RunPodMediaClient("fixture", transport).inventory()).toEqual([{ id: "first" }, { id: "last" }]);
    expect(transport.mock.calls[1]?.[0]).toContain("cursor=next%20page");
  });
  it.each([{ pods: [] }, { pods: [], pagination: { hasNextPage: true } }])("rejects incomplete provider inventory %j", async value => {
    const transport = vi.fn().mockResolvedValue(response(value));
    await expect(new RunPodMediaClient("fixture", transport).inventory()).rejects.toThrow("RUNPOD_INVENTORY_INCOMPLETE");
  });
  it("rejects a repeated pagination cursor", async () => {
    const transport = vi.fn().mockImplementation(async () => response({ pods: [], pagination: { hasNextPage: true, nextCursor: "same" } }));
    await expect(new RunPodMediaClient("fixture", transport).inventory()).rejects.toThrow("RUNPOD_INVENTORY_INCOMPLETE");
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it("accepts only exact disk, host resources and actual all-in price", () => {
    expect(verifyCloudPlacement(placement(), reservation)).toBe(true);
    expect(verifyCloudPlacement(placement({ cost: 2 }), reservation)).toBe(false);
    expect(verifyCloudPlacement(placement({ disk: 99 }), reservation)).toBe(false);
    expect(verifyCloudPlacement(placement({ gpu: { id: reservation.gpu, count: 1, vcpuCount: 15, memory: 64 } }), reservation)).toBe(false);
    expect(verifyCloudPlacement(placement({ gpu: { id: reservation.gpu, count: 1, vcpuCount: 16, memory: 63 } }), reservation)).toBe(false);
    expect(verifyCloudPlacement(placement({ mounts: { networkVolume: "historical" } }), reservation)).toBe(false);
  });
});
describe("durable cloud create reconciliation", () => {
  it("keeps a second observer from invalidating the creator before its single POST", async () => {
    const previous = fixture.query.getMockImplementation()!;
    let observed = false;
    fixture.query.mockImplementation(async (sql: string, values: unknown[] = []) => {
      if (sql.includes("allowed_create_reservation") && !observed) {
        observed = true;
        expect((await runCloudMediaObservation(environment, config, scope)).state).toBe("RECONCILING");
      }
      return previous(sql, values);
    });
    fixture.transport.mockImplementation(async (url: string, options: RequestInit) => url.includes("/catalog/")
      ? response({ gpus: [{ id: reservation.gpu, memory: 24, secure: true, manufacturer: "NVIDIA", price: { secure: .4 }, availability: "HIGH" }] })
      : options.method === "POST" ? response(placement()) : emptyInventory());
    expect((await runCloudMediaObservation(environment, config, scope)).state).toBe("STARTING");
    expect(fixture.transport.mock.calls.filter(([, options]) => options.method === "POST")).toHaveLength(1);
  });
  it("never repeats a create after timeout and complete empty inventory", async () => {
    expect((await runCloudMediaObservation(environment, config, scope)).state).toBe("RECONCILING");
    expect(reservation.state).toBe("AMBIGUOUS");
    expect((await runCloudMediaObservation(environment, config, scope)).state).toBe("RECONCILING");
    expect(fixture.transport.mock.calls.filter(([, options]) => options.method === "POST")).toHaveLength(1);
  });
  it("does not fallback when inventory is incomplete after an ambiguous create", async () => {
    fixture.transport.mockImplementation(async (url: string, options: RequestInit) => url.includes("/catalog/")
      ? response({ gpus: [{ id: reservation.gpu, memory: 24, secure: true, manufacturer: "NVIDIA", price: { secure: .4 }, availability: "HIGH" }] })
      : options.method === "POST" ? response({ detail: "insufficient capacity" }, 503) : response({ pods: [] }));
    expect((await runCloudMediaObservation(environment, config, scope)).state).toBe("RECONCILING");
    expect((await runCloudMediaObservation(environment, config, scope)).state).toBe("RECONCILING");
    expect(fixture.transport.mock.calls.filter(([, options]) => options.method === "POST")).toHaveLength(1);
    expect(reservation.state).toBe("CREATING");
  });
  it("keeps a mismatched create response ambiguous after complete empty inventory", async () => {
    fixture.transport.mockImplementation(async (url: string, options: RequestInit) => url.includes("/catalog/")
      ? response({ gpus: [{ id: reservation.gpu, memory: 24, secure: true, manufacturer: "NVIDIA", price: { secure: .4 }, availability: "HIGH" }] })
      : options.method === "POST" ? response(placement({ name: "unrelated-existing-pod" })) : emptyInventory());
    expect((await runCloudMediaObservation(environment, config, scope)).state).toBe("RECONCILING");
    expect(reservation.state).toBe("AMBIGUOUS"); expect(reservation.launch_outcome).toBe("UNKNOWN");
    expect(fixture.transport.mock.calls.some(([, options]) => options.method === "DELETE")).toBe(false);
  });
  it("keeps a transient HTTP timeout ambiguous instead of declaring the rental absent", async () => {
    fixture.transport.mockImplementation(async (url: string, options: RequestInit) => url.includes("/catalog/")
      ? response({ gpus: [{ id: reservation.gpu, memory: 24, secure: true, manufacturer: "NVIDIA", price: { secure: .4 }, availability: "HIGH" }] })
      : options.method === "POST" ? response({ detail: "request timed out" }, 408) : emptyInventory());
    expect((await runCloudMediaObservation(environment, config, scope)).state).toBe("RECONCILING");
    expect(reservation.state).toBe("AMBIGUOUS");expect(reservation.launch_outcome).toBe("UNKNOWN");
    expect((await runCloudMediaObservation(environment, config, scope)).state).toBe("RECONCILING");
    expect(fixture.transport.mock.calls.filter(([, options])=>options.method==="POST")).toHaveLength(1);
  });
  it("allows the next candidate only after confirmed capacity rejection and complete empty inventory", async () => {
    fixture.transport.mockImplementation(async (url: string, options: RequestInit) => url.includes("/catalog/")
      ? response({ gpus: [{ id: reservation.gpu, memory: 24, secure: true, manufacturer: "NVIDIA", price: { secure: .4 }, availability: "HIGH" }] })
      : options.method === "POST" ? response({ detail: "insufficient capacity" }, 503) : emptyInventory());
    const value = await runCloudMediaObservation(environment, config, scope);
    expect(value).toEqual({ state: "WAITING_CAPACITY", delaySeconds: 1 });
    expect(reservation.launch_outcome).toBe("REFUSED");
    expect(reservation.candidate_index).toBe(1);
    expect(reservation.disk_gb).toBe(100);
  });
});
it("cleans a cancelled known unlaunched reservation without querying or renting compute", async () => {
  attempt.state = "CANCELLED"; reservation.launch_outcome = null;
  expect((await runCloudMediaObservation(environment, config, scope)).state).toBe("CANCELLED");
  expect(reservation.state).toBe("CLEAN"); expect(fixture.transport).not.toHaveBeenCalled();
});

it("keeps a newly leased span running when an older observation tries to clean its Pod", async () => {
  attempt.kind = "SPAN_AUDIO"; attempt.state = "SUCCEEDED";
  reservation.state = "SAVING"; reservation.launch_outcome = "CONFIRMED";
  rotateBeforeStop = true;
  expect((await runCloudMediaObservation(environment, config, scope)).state).toBe("RECONCILING");
  expect(reservation.state).toBe("SAVING"); expect(fixture.transport).not.toHaveBeenCalled();
});

it("retains capacity when independent inventory still shows the owned Pod after deletion", async () => {
  attempt.state = "FAILED"; reservation.state = "STOPPING"; reservation.launch_outcome = "CONFIRMED";
  fixture.transport.mockImplementation(async (_url: string, options: RequestInit) => options.method === "DELETE"
    ? new Response(null, { status: 204 }) : response({ pods: [placement()], pagination: { hasNextPage: false } }));
  expect((await runCloudMediaObservation(environment, config, scope)).state).toBe("RECONCILING");
  expect(reservation.state).toBe("STOPPING");
});

describe("fenced publication and multipart recovery", () => {
  it("accepts optional bounded disk telemetry only for the exact active lease",async()=>{
    reservation.state="RENDERING";
    const disk={filesystem_total_bytes:100,initial_used_bytes:10,peak_used_bytes:30,min_free_bytes:65,sample_count:3};
    expect(validCloudDiskMetrics(disk)).toBe(true);
    expect((await runRoute("heartbeat",{phase:"RENDERING",disk_metrics:disk}))?.status).toBe(200);
    const calls=fixture.query.mock.calls.filter(([sql])=>String(sql).includes("UPDATE cloud_media_jobs j SET disk_metrics"));
    expect(calls).toHaveLength(1);expect(calls[0]?.[1]).toEqual([reservationId,attemptId,reservation.fence_id,JSON.stringify(disk)]);
    attempt.state="CANCEL_REQUESTED";
    expect(await (await runRoute("heartbeat",{phase:"RENDERING",disk_metrics:disk}))?.json()).toMatchObject({cancel_requested:true});
    expect(fixture.query.mock.calls.filter(([sql])=>String(sql).includes("UPDATE cloud_media_jobs j SET disk_metrics"))).toHaveLength(1);
  });
  it("rejects malformed disk facts before changing lease or accepting a result",async()=>{
    const disk={filesystem_total_bytes:100,initial_used_bytes:10,peak_used_bytes:30,min_free_bytes:65,sample_count:3};
    for(const facts of [null,[],{...disk,extra:"private"},{...disk,peak_used_bytes:101},{...disk,initial_used_bytes:31},
      {...disk,min_free_bytes:-1},{...disk,sample_count:0},{...disk,filesystem_total_bytes:Number.MAX_SAFE_INTEGER+1},
      {...disk,min_free_bytes:"65"},{...disk,sample_count:1.5}]) {
      expect(validCloudDiskMetrics(facts)).toBe(false);
      expect((await runRoute("heartbeat",{phase:"RENDERING",disk_metrics:facts}))?.status).toBe(400);
      expect((await runRoute("complete",{...completion,disk_metrics:facts}))?.status).toBe(400);
    }
    expect(fixture.query.mock.calls.filter(([sql])=>String(sql).includes("UPDATE cloud_media_jobs j SET disk_metrics"))).toHaveLength(0);
    expect(attempt.state).toBe("RUNNING");
  });
  it("persists bounded verification timing for the exact attempt without regressing phase",async()=>{
    reservation.state="RENDERING";
    expect((await runRoute("heartbeat",{phase:"CHECKING_VIDEO",technical_verification_ms:125}))?.status).toBe(200);
    expect(reservation.state).toBe("CHECKING");expect(measuredJob.technical_verification_ms).toBe(125);
    await runRoute("heartbeat",{phase:"RENDERING"});expect(reservation.state).toBe("CHECKING");
    await runRoute("heartbeat",{phase:"SAVING",artifact_verification_ms:24});
    expect(measuredJob.artifact_verification_ms).toBe(24);
    const write=fixture.query.mock.calls.find(([sql])=>String(sql).includes("UPDATE cloud_media_jobs SET"));
    expect(write?.[1]?.slice(0,2)).toEqual([reservationId,attemptId]);
  });
  it("rejects invalid or misplaced timing before any lease mutation",async()=>{
    reservation.state="RENDERING";
    for(const body of [{phase:"RENDERING",technical_verification_ms:1},{phase:"CHECKING_VIDEO",technical_verification_ms:-1},
      {phase:"CHECKING_VIDEO",technical_verification_ms:14_400_001},{phase:"CHECKING_VIDEO",technical_verification_ms:1.5},
      {phase:"SAVING",artifact_verification_ms:"24"}]) expect((await runRoute("heartbeat",body))?.status).toBe(400);
    expect(reservation.state).toBe("RENDERING");expect(measuredJob).toEqual({});
  });
  it("rejects stale heartbeat publication while reporting cancellation",async()=>{
    reservation.state="RENDERING";attempt.state="CANCEL_REQUESTED";
    const value=await runRoute("heartbeat",{phase:"CHECKING_VIDEO",technical_verification_ms:125});
    expect(await value?.json()).toMatchObject({cancel_requested:true});expect(measuredJob).toEqual({});
  });
  it("reuses one connection for capability scope and tenant-fenced reservation reads",async()=>{
    vi.mocked(createNeonPool).mockClear();
    reservation.state="CLEAN";attempt.state="SUCCEEDED";
    const value=await handleCloudMediaRequest(new Request(
      `https://videoforge.example/api/v2/cloud-media/reservations/${reservationId}/spec`,
      {headers:{authorization:`Bearer ${capability}`}},
    ),environment,config,{} as never);
    expect(value?.status).toBe(409);
    expect(createNeonPool).toHaveBeenCalledTimes(1);
    expect(fixture.query.mock.calls.some(([sql,args])=>String(sql).includes("SELECT set_config") && args[1]===accountId)).toBe(true);
  });
  it("aborts owned unfinished multipart storage only after independent Pod absence",async()=>{
    reservation.state="RENDERING";reservation.launch_outcome="CONFIRMED";
    fixture.transport.mockResolvedValueOnce(response({pods:[placement()],pagination:{hasNextPage:false}}))
      .mockResolvedValueOnce(new Response(null,{status:204})).mockResolvedValueOnce(emptyInventory());
    fixture.multipart.mockImplementation(async()=>{expect(fixture.transport).toHaveBeenCalledTimes(3);return new Response(null,{status:204});});
    expect(await cleanupCloudReservation(new RunPodMediaClient("fixture-key"),config,reservation)).toBe(true);
    expect(upload.state).toBe("ABORTED");expect(reservation.state).toBe("CLEAN");
    expect(fixture.multipart).toHaveBeenCalledWith("DELETE","primary",{uploadId:"fixture-upload"});
  });
  it("keeps capacity reserved when multipart abort fails after compute is stopped",async()=>{
    reservation.state="STOPPING";reservation.launch_outcome="CONFIRMED";
    fixture.multipart.mockResolvedValue(new Response(null,{status:503}));
    expect(await cleanupCloudReservation(new RunPodMediaClient("fixture-key"),config,reservation)).toBe(false);
    expect(reservation.state).toBe("STOPPING");expect(upload.state).toBe("OPEN");
  });
  it("retains uncertainty for a lost multipart initiation with no identifiable upload",async()=>{
    reservation.state="STOPPING";reservation.launch_outcome="CONFIRMED";upload.state="UNKNOWN";upload.upload_id=null;
    expect(await cleanupCloudReservation(new RunPodMediaClient("fixture-key"),config,reservation)).toBe(false);
    expect(reservation.state).toBe("STOPPING");expect(upload.state).toBe("UNKNOWN");expect(fixture.multipart).not.toHaveBeenCalled();
  });
  it("reconciles and aborts exact owned uploads from a lost initiation without creating another",async()=>{
    reservation.state="STOPPING";reservation.launch_outcome="CONFIRMED";upload.state="UNKNOWN";upload.upload_id=null;
    fixture.listMultipart.mockResolvedValueOnce(["reconciled-owned"]).mockResolvedValueOnce([]);
    fixture.multipart.mockResolvedValue(new Response(null,{status:204}));
    expect(await cleanupCloudReservation(new RunPodMediaClient("fixture-key"),config,reservation)).toBe(true);
    expect(fixture.multipart).toHaveBeenCalledWith("DELETE","primary",{uploadId:"reconciled-owned"});
    expect(fixture.listMultipart).toHaveBeenCalledTimes(2);expect(upload.state).toBe("ABORTED");
  });
  it("retains capacity when an owned multipart upload remains visible after DELETE",async()=>{
    reservation.state="STOPPING";reservation.launch_outcome="CONFIRMED";
    fixture.listMultipart.mockResolvedValue(["fixture-upload"]);
    expect(await cleanupCloudReservation(new RunPodMediaClient("fixture-key"),config,reservation)).toBe(false);
    expect(upload.state).toBe("OPEN");expect(reservation.state).toBe("STOPPING");
  });
  it("never aborts verified multipart output during cleanup",async()=>{
    reservation.state="STOPPING";reservation.launch_outcome="CONFIRMED";upload.state="VERIFIED";
    expect(await cleanupCloudReservation(new RunPodMediaClient("fixture-key"),config,reservation)).toBe(true);
    expect(fixture.multipart).not.toHaveBeenCalled();expect(upload.state).toBe("VERIFIED");
  });
  it("does not publish success when cancellation wins after artifact verification", async () => {
    reservation.state = "SAVING"; raceCancel = true;
    expect((await runRoute("complete", completion))?.status).toBe(409);
    expect(attempt.state).toBe("CANCEL_REQUESTED");
    expect(fixture.query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO hosted_cpu_job_events"))).toBe(false);
  });
  it("refuses expired input capabilities before fetching or signing private objects", async () => {
    reservation.state = "RENDERING"; reservation.deadline_at = new Date(0).toISOString();
    const value = await handleCloudMediaRequest(new Request(
      `https://videoforge.example/api/v2/cloud-media/reservations/${reservationId}/spec`, {
        method: "GET", headers: { authorization: `Bearer ${capability}` },
      }), environment, config, { waitUntil() {} });
    expect(value?.status).toBe(409); expect(fixture.sign).not.toHaveBeenCalled();
  });
  it("rejects a foreign capability before storage or publication", async () => {
    expect((await runRoute("complete", completion, "d".repeat(64)))?.status).toBe(403);
    expect(fixture.checksum).not.toHaveBeenCalled();
  });
  it("re-signs only the failed multipart part using the same upload identity", async () => {
    reservation.state = "SAVING";
    for (let retry = 0; retry < 2; retry += 1) {
      const value = await runRoute("multipart/part", { upload_id: upload.upload_id, part_number: 2, content_length: MULTIPART_PART_BYTES });
      expect(value?.status).toBe(200);
    }
    expect(fixture.part).toHaveBeenCalledTimes(2);
    expect(fixture.part).toHaveBeenCalledWith("primary", "fixture-upload", 2);
    expect(fixture.multipart).not.toHaveBeenCalled();
  });
  it("rejects multipart completion errors embedded in HTTP 200 XML", async () => {
    reservation.state = "SAVING";
    vi.mocked(environment.PRIVATE_ARTIFACTS!.head).mockResolvedValue(null);
    fixture.multipart.mockResolvedValue(new Response("<Error><Code>InvalidPart</Code></Error>"));
    const value = await runRoute("multipart/complete", { upload_id: upload.upload_id, content_length: upload.content_length, checksum_sha256: hash,
      parts: [{ part_number: 1, etag: "a".repeat(32) }, { part_number: 2, etag: "b".repeat(32) }] });
    expect(value?.status).toBe(502);
    expect(upload.state).toBe("COMPLETING");
  });
  it("reconciles an already complete object without repeating multipart completion", async () => {
    reservation.state = "SAVING"; upload.state = "COMPLETING";
    vi.mocked(environment.PRIVATE_ARTIFACTS!.head).mockResolvedValue({ size: Number(upload.content_length) });
    const value = await runRoute("multipart/complete", { upload_id: upload.upload_id, content_length: upload.content_length, checksum_sha256: hash,
      parts: [{ part_number: 1, etag: "a".repeat(32) }, { part_number: 2, etag: "b".repeat(32) }] });
    expect(value?.status).toBe(200); expect(upload.state).toBe("VERIFIED");
    expect(fixture.multipart).not.toHaveBeenCalled();
  });
  it("aborts only its bound unfinished multipart upload", async () => {
    reservation.state = "SAVING"; fixture.multipart.mockResolvedValue(new Response(null, { status: 204 }));
    expect((await runRoute("multipart/abort", { upload_id: upload.upload_id }))?.status).toBe(200);
    expect(upload.state).toBe("ABORTED");
    expect(fixture.multipart).toHaveBeenCalledWith("DELETE", "primary", { uploadId: "fixture-upload" });
  });
  it("rejects a multipart whole checksum mismatch before storage completion", async () => {
    reservation.state = "SAVING";
    expect((await runRoute("multipart/complete", { upload_id: upload.upload_id, content_length: upload.content_length,
      checksum_sha256: `sha256:${"b".repeat(64)}`, parts: [] }))?.status).toBe(409);
    expect(fixture.multipart).not.toHaveBeenCalled();
  });
});

describe("cloud terminal admission settlement", () => {
  it.each(["attemptId","accountId","workspaceId","projectId","projectRevisionId","generationRequestId","sourceAttemptId","state"])("rejects a substituted render-only %s before settlement or promotion",async field=>{
    renderOnlyRun=exactRenderOnlyRun();renderOnlyRun[field]="invalid";attempt.state="FAILED";reservation.state="CLEAN";
    const outcome=await runCloudMediaObservation(environment,config,scope);
    expect(outcome.state).toBe("RECONCILING");
    expect(fixture.finalize).not.toHaveBeenCalled();expect(fixture.transport).not.toHaveBeenCalled();
    expect(fixture.query.mock.calls.some(([sql])=>String(sql).includes("videoforge_settle_cloud_render_only_run"))).toBe(false);
  });
  it("requires fresh video admission for a render-only run even when its accepted source has an ordinary runtime",async()=>{
    renderOnlyRun=exactRenderOnlyRun();noReservation=true;
    await setTemplate("RENDER",{});
    Object.assign(attempt,{job_spec_object_key:reservation.job_spec_object_key,
      job_spec_content_length:reservation.job_spec_content_length,job_spec_checksum_sha256:reservation.job_spec_checksum_sha256});
    fixture.admission.mockResolvedValue({state:"WAITING"});
    expect((await runCloudMediaObservation(environment,config,scope)).state).toBe("WAITING_CAPACITY");
    expect(fixture.admission).toHaveBeenCalledOnce();
    expect(fixture.query.mock.calls.some(([sql])=>String(sql).includes("INSERT INTO cloud_media_reservations"))).toBe(false);
    expect(fixture.transport).not.toHaveBeenCalled();
  });
  it.each(["FAILED","CANCELLED","EXPIRED"])("settles render-only %s through its exact run while preserving its successful source runtime",async state=>{
    renderOnlyRun=exactRenderOnlyRun();attempt.state=state;reservation.state="CLEAN";cpuSettled=false;
    expect((await runCloudMediaObservation(environment,config,scope)).state).toBe("FINALIZATION_PENDING");
    expect(fixture.query.mock.calls.some(([sql,values])=>String(sql).includes("videoforge_settle_cloud_render_only_run") && values[0]===attemptId)).toBe(true);
    expect(fixture.query.mock.calls.some(([sql])=>/videoforge_settle_stranded_hosted_v209_requests|videoforge_settle_cloud_media_cpu_failure/u.test(String(sql)))).toBe(false);
    cpuSettled=true;
    expect((await runCloudMediaObservation(environment,config,scope)).state).toBe(state);
    expect(fixture.transport).not.toHaveBeenCalled();
  });
  it.each(["ASR","SPAN_AUDIO","RENDER"])("keeps unadmitted %s provider-inert before reserving compute",async kind=>{
    noReservation=true;ordinaryRuntime=false;attempt.kind=kind;await setTemplate(kind,{});
    Object.assign(attempt,{job_spec_object_key:reservation.job_spec_object_key,
      job_spec_content_length:reservation.job_spec_content_length,job_spec_checksum_sha256:reservation.job_spec_checksum_sha256});
    fixture.admission.mockResolvedValue({state:"WAITING"});
    expect((await runCloudMediaObservation(environment,config,scope)).state).toBe("WAITING_CAPACITY");
    expect(fixture.admission).toHaveBeenCalledOnce();
    expect(fixture.admission.mock.calls[0]?.[1]).toMatchObject({accountId,workspaceId,projectId:attempt.project_id});
    expect(fixture.query.mock.calls.some(([sql])=>String(sql).includes("INSERT INTO cloud_media_reservations"))).toBe(false);
    expect(fixture.transport).not.toHaveBeenCalled();
  });
  it("observes an existing render reservation without acquiring another admission",async()=>{
    attempt.state="FAILED";reservation.state="CLEAN";
    expect((await runCloudMediaObservation(environment,config,scope)).state).toBe("FAILED");
    expect(fixture.admission).not.toHaveBeenCalled();
  });
  it("keeps ordinary render input validation independent of its released VIDEO lease",async()=>{
    noReservation=true;await setTemplate("RENDER",{});
    Object.assign(attempt,{job_spec_object_key:reservation.job_spec_object_key,
      job_spec_content_length:reservation.job_spec_content_length,job_spec_checksum_sha256:reservation.job_spec_checksum_sha256});
    expect((await runCloudMediaObservation(environment,config,scope)).observationError?.phase).toBe("RESERVATION");
    expect(fixture.admission).not.toHaveBeenCalled();expect(fixture.transport).not.toHaveBeenCalled();
  });
  it.each(["FAILED","CANCELLED","EXPIRED"])("settles no-runtime render %s through exact CPU failure proof",async state=>{
    ordinaryRuntime=false;attempt.state=state;reservation.state="CLEAN";cpuSettled=false;
    expect((await runCloudMediaObservation(environment,config,scope)).state).toBe("FINALIZATION_PENDING");
    expect(fixture.query.mock.calls.some(([sql])=>String(sql).includes("videoforge_settle_stranded_hosted_v209_requests"))).toBe(false);
    expect(fixture.query.mock.calls.some(([sql,values])=>String(sql).includes("videoforge_settle_cloud_media_cpu_failure") && values[0]===attemptId)).toBe(true);
    cpuSettled=true;
    expect((await runCloudMediaObservation(environment,config,scope)).state).toBe(state);
    expect(fixture.transport).not.toHaveBeenCalled();
  });
  it("keeps a cleaned render pending while its exact generation remains active", async () => {
    attempt.state = "FAILED"; reservation.state = "CLEAN"; generationActive = true;
    expect((await runCloudMediaObservation(environment, config, scope)).state).toBe("FINALIZATION_PENDING");
    expect(reservation.failure_settled_at).toBeUndefined();
    generationActive = false;
    expect((await runCloudMediaObservation(environment, config, scope)).state).toBe("FAILED");
    expect(reservation.failure_settled_at).toBeDefined();
  });
  it("settles capacity exhaustion before publishing a final failure", async () => {
    reservation.round = 3; reservation.launch_outcome = null; generationActive = true;
    expect((await runCloudMediaObservation(environment, config, scope)).state).toBe("FINALIZATION_PENDING");
    expect(attempt.state).toBe("FAILED"); expect(reservation.state).toBe("CLEAN");
    expect(fixture.transport).not.toHaveBeenCalled();
  });
  it("cleans a confirmed permanent create rejection and records settled failure", async () => {
    fixture.transport.mockImplementation(async (url: string, options: RequestInit) => url.includes("/catalog/")
      ? response({ gpus: [{ id: reservation.gpu, memory: 24, secure: true, manufacturer: "NVIDIA", price: { secure: .4 }, availability: "HIGH" }] })
      : options.method === "POST" ? response({ detail: "invalid configuration" }, 422) : emptyInventory());
    expect((await runCloudMediaObservation(environment, config, scope)).state).toBe("FAILED");
    expect(reservation.state).toBe("CLEAN"); expect(reservation.failure_settled_at).toBeDefined();
    expect(fixture.transport.mock.calls.filter(([, options]) => options.method === "POST")).toHaveLength(1);
    expect(fixture.transport.mock.calls.some(([, options]) => options.method === "DELETE")).toBe(false);
  });
  it("keeps a rejected placement pending until generation failure settles", async () => {
    reservation.state = "AMBIGUOUS"; generationActive = true;
    let inventories = 0;
    fixture.transport.mockImplementation(async (_url: string, options: RequestInit) => options.method === "DELETE"
      ? new Response(null, { status: 204 }) : ++inventories <= 2
        ? response({ pods: [placement({ cost: 2 })], pagination: { hasNextPage: false } }) : emptyInventory());
    expect((await runCloudMediaObservation(environment, config, scope)).state).toBe("FINALIZATION_PENDING");
    expect(reservation.state).toBe("CLEAN"); expect(reservation.failure_settled_at).toBeUndefined();
  });
  it("settles expired unreserved ASR without a rental and waits for the durable SQL decision", async () => {
    noReservation = true; attempt.kind = "ASR"; attempt.state = "PLANNED"; attempt.deadline_at = new Date(0).toISOString(); cpuSettled = false;
    expect((await runCloudMediaObservation(environment, config, scope)).state).toBe("FINALIZATION_PENDING");
    expect(attempt.state).toBe("EXPIRED"); expect(fixture.transport).not.toHaveBeenCalled();
    cpuSettled = true;
    expect((await runCloudMediaObservation(environment, config, scope)).state).toBe("EXPIRED");
  });
});

describe("Cloud result document publication parity",()=>{
  it.each(["not-json",[],{schema_version:"render-job-result/v1",attempt_id:attemptId,status:"SUCCEEDED",error:null}])("rejects invalid JSON or render contract before publishing success %j",async value=>{
    reservation.state="SAVING";await setResultDocument(value);
    expect((await runRoute("complete",completion))?.status).toBe(409);expect(attempt.state).toBe("RUNNING");
  });
  it("rejects exact valid render JSON with a foreign attempt or output checksum",async()=>{
    reservation.state="SAVING";const doc=structuredClone(renderResultFixture);doc.attempt_id="foreign-attempt";
    await setResultDocument(doc);expect((await runRoute("complete",completion))?.status).toBe(409);
    doc.attempt_id=attemptId;await setResultDocument(doc);expect((await runRoute("complete",completion))?.status).toBe(409);
    expect(attempt.state).toBe("RUNNING");
  });
  it("publishes a valid exact render receipt only after JSON and artifact verification",async()=>{
    reservation.state="SAVING";expect((await runRoute("complete",completion))?.status).toBe(200);expect(attempt.state).toBe("SUCCEEDED");
  });
});

it("validates ASR contract and exact committed source/model before publishing",async()=>{
  reservation.state="SAVING";attempt.kind="ASR";const doc=structuredClone(asrResultFixture);doc.attempt_id=attemptId;
  await setResultDocument(doc);primary.issued_content_length=result.issued_content_length;primary.issued_checksum_sha256=result.issued_checksum_sha256;primary.content_type="application/json";
  await setTemplate("ASR",{project_revision_id:doc.transcript.project_revision_id,voiceover:{...doc.transcript.source},model:{sha256:hash}});
  expect((await runRoute("complete",completion))?.status).toBe(409);expect(attempt.state).toBe("RUNNING");
  await setTemplate("ASR",{project_revision_id:doc.transcript.project_revision_id,voiceover:{...doc.transcript.source},model:{sha256:doc.model_sha256}});
  expect((await runRoute("complete",completion))?.status).toBe(200);expect(attempt.state).toBe("SUCCEEDED");
});
it.each(["same-pretty","different-transcript","invalid-json","invalid-model","oversize","checksum-mismatch"])("binds independently serialized ASR primary and receipt before promotion: %s",async mode=>{
  reservation.state="SAVING";attempt.kind="ASR";
  const doc=structuredClone(asrResultFixture);doc.attempt_id=attemptId;
  await setResultDocument(doc);
  await setTemplate("ASR",{project_revision_id:doc.transcript.project_revision_id,voiceover:{...doc.transcript.source},model:{sha256:doc.model_sha256}});
  const primaryDoc=structuredClone(doc);
  if(mode==="different-transcript") primaryDoc.transcript.words[0]!.text="different accepted words";
  if(mode==="invalid-model") primaryDoc.model_sha256=`sha256:${"c".repeat(64)}`;
  const text=mode==="invalid-json"?"{invalid":JSON.stringify(primaryDoc,null,2)+"\n";
  const bytes=new TextEncoder().encode(text);
  primary.content_type="application/json";primary.issued_content_length=mode==="oversize"?16_777_217:bytes.byteLength;
  primary.issued_checksum_sha256=mode==="checksum-mismatch"?hash:await sha256(text);
  const get=vi.mocked(environment.PRIVATE_ARTIFACTS!.get), prior=get.getMockImplementation()!;
  const read=vi.fn(async()=>bytes.buffer as ArrayBuffer);
  get.mockImplementation(async(key:string)=>key==="primary"?{size:primary.issued_content_length,
    httpMetadata:{contentType:"application/json"},arrayBuffer:read}:prior(key));
  expect((await runRoute("complete",completion))?.status).toBe(mode==="same-pretty"?200:409);
  expect(attempt.state).toBe(mode==="same-pretty"?"SUCCEEDED":"RUNNING");
  if(mode==="same-pretty") expect(primary.issued_content_length).not.toBe(result.issued_content_length);
  if(mode==="oversize") expect(read).not.toHaveBeenCalled();
});
it("validates selected-span input identity, waveform facts and selection before publishing",async()=>{
  reservation.state="SAVING";attempt.kind="SPAN_AUDIO";primary.content_type="audio/wav";
  const input={span_id:"span",timeline_plan_id:"timeline",transcript_id:"transcript",timeline_segment_id:"segment",task_key:"task",
    source_voiceover:{asset_id:"voice",sha256:hash,duration_ms:12000,artifact_uri:"private-input"},selection:{padded_start_ms:0,padded_end_ms_exclusive:3000},output:{asset_id:"audio"}};
  await setTemplate("SPAN_AUDIO",input);
  const doc={schema_version:"selected-span-audio-result/v1",attempt_id:attemptId,status:"SUCCEEDED",error:null,span_id:input.span_id,
    timeline_plan_id:input.timeline_plan_id,transcript_id:input.transcript_id,timeline_segment_id:input.timeline_segment_id,task_key:input.task_key,
    source_voiceover:{asset_id:"voice",sha256:hash,duration_ms:12000},selection:{...input.selection},audio:{asset_id:"audio",sha256:hash,byte_size:100,
      content_type:"audio/wav",duration_ms:3000,sample_rate_hz:48000,channels:1,artifact_uri:`vf-local://objects/sha256/aa/${"a".repeat(64)}.wav`}};
  doc.selection.padded_end_ms_exclusive=4000;await setResultDocument(doc);
  expect((await runRoute("complete",completion))?.status).toBe(409);expect(attempt.state).toBe("RUNNING");
  doc.selection.padded_end_ms_exclusive=3000;await setResultDocument(doc);
  expect((await runRoute("complete",completion))?.status).toBe(200);expect(attempt.state).toBe("SUCCEEDED");
});
it("keeps a completed span Pod available through bounded cleanup callback retries",async()=>{
  attempt.kind="SPAN_AUDIO";attempt.state="SUCCEEDED";reservation.state="SAVING";
  reservation.updated_at=new Date(Date.now()-90_000).toISOString();
  expect(await runCloudMediaObservation(environment,config,scope)).toEqual({state:"SAVING",delaySeconds:5});
  expect(fixture.transport).not.toHaveBeenCalled();
  expect(reservation.state).toBe("SAVING");
  reservation.deadline_at=new Date(Date.now()-1).toISOString();
  await runCloudMediaObservation(environment,config,scope);
  expect(fixture.transport).toHaveBeenCalled();
});
it("keeps other ready spans unreserved for the existing account Pod's bounded batch",async()=>{
  noReservation=true;attempt.kind="SPAN_AUDIO";attempt.state="OUTBOXED";attempt.owner_user_id="fixture-owner";
  await setTemplate("SPAN_AUDIO",{});Object.assign(attempt,{job_spec_object_key:reservation.job_spec_object_key,
    job_spec_content_length:reservation.job_spec_content_length,job_spec_checksum_sha256:reservation.job_spec_checksum_sha256});
  expect(await runCloudMediaObservation(environment,config,scope)).toEqual({state:"WAITING_CAPACITY",delaySeconds:30});
  const statements=fixture.query.mock.calls.map(([statement])=>String(statement));
  expect(statements.some(statement=>statement.includes("pg_advisory_xact_lock"))).toBe(true);
  expect(statements.some(statement=>statement.includes("INSERT INTO cloud_media_reservations"))).toBe(false);
  expect(statements.some(statement=>statement.includes("INSERT INTO cloud_media_jobs"))).toBe(false);
  expect(statements.some(statement=>statement.includes("reserve_budget"))).toBe(false);
  expect(fixture.transport).not.toHaveBeenCalled();expect(attempt.state).toBe("OUTBOXED");
});

it("compiles and idempotently inserts exact terminal lineage in PostgreSQL with the text hash parameter", async () => {
  vi.unstubAllGlobals();
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE hosted_cpu_job_events(
      id uuid PRIMARY KEY,account_id uuid NOT NULL,workspace_id uuid NOT NULL,attempt_id uuid NOT NULL,
      sequence integer NOT NULL,kind text NOT NULL,facts_sha256 text NOT NULL,occurred_at timestamptz NOT NULL
    );`);
    // Native parameter inference previously typed $1 as text at md5, breaking UUID comparisons.
    const oldSql = CLOUD_TERMINAL_EVENT_SQL.replaceAll("attempt_id=$1::uuid", "attempt_id=$1");
    await expect(db.exec(`PREPARE broken_terminal AS ${oldSql}`)).rejects.toThrow("operator does not exist: uuid = text");
    await db.exec(`PREPARE exact_terminal AS ${CLOUD_TERMINAL_EVENT_SQL}`);
    const statement = `EXECUTE exact_terminal('${attemptId}','${accountId}','${workspaceId}','FAILED','${hash}')`;
    await db.exec(statement);
    await db.exec(statement);
    expect((await db.query("SELECT account_id,workspace_id,attempt_id,sequence,kind,facts_sha256 FROM hosted_cpu_job_events")).rows).toEqual([
      { account_id: accountId, workspace_id: workspaceId, attempt_id: attemptId, sequence: 1, kind: "FAILED", facts_sha256: hash },
    ]);
  } finally { await db.close(); }
}, 30000);

it("records monotonic sampled disk facts with PostgreSQL constraints and exact lease fencing",async()=>{
  vi.unstubAllGlobals();
  const {PGlite}=await import("@electric-sql/pglite");
  const {readFile}=await import("node:fs/promises");
  const db=new PGlite();
  const disk={filesystem_total_bytes:100,initial_used_bytes:10,peak_used_bytes:30,min_free_bytes:65,sample_count:3};
  try {
    await db.exec(`CREATE ROLE videoforge_v209_runtime_dc9612d6;
      CREATE TABLE cloud_media_jobs(reservation_id uuid,attempt_id uuid);
      CREATE TABLE cloud_media_reservations(id uuid,leased_attempt_id uuid,fence_id uuid,state text,deadline_at timestamptz);
      CREATE TABLE hosted_cpu_job_attempts(id uuid,state text);`);
    await db.exec(await readFile(new URL("../../../../../packages/control-plane/migrations/0216_cloud_media_disk_measurements.sql",import.meta.url),"utf8"));
    await db.query("INSERT INTO cloud_media_jobs VALUES($1,$2,NULL)",[reservationId,attemptId]);
    await db.query("INSERT INTO cloud_media_reservations VALUES($1,$2,$3,'RENDERING',now()+interval '1 hour')",[reservationId,attemptId,reservation.fence_id]);
    await db.query("INSERT INTO hosted_cpu_job_attempts VALUES($1,'RUNNING')",[attemptId]);
    const save=(facts:unknown,fence=reservation.fence_id)=>db.query(CLOUD_DISK_METRICS_SQL,[reservationId,attemptId,fence,JSON.stringify(facts)]);
    expect((await save(disk)).rows).toHaveLength(1);
    await save({...disk,peak_used_bytes:20,min_free_bytes:80,sample_count:2});
    expect((await db.query<{disk_metrics:unknown}>("SELECT disk_metrics FROM cloud_media_jobs")).rows[0]?.disk_metrics).toEqual(disk);
    expect((await save({...disk,initial_used_bytes:11})).rows).toHaveLength(0);
    expect((await save({...disk,peak_used_bytes:50},"33333333-3333-4333-8333-333333333333")).rows).toHaveLength(0);
    await db.exec("UPDATE hosted_cpu_job_attempts SET state='CANCEL_REQUESTED'");
    expect((await save({...disk,peak_used_bytes:50})).rows).toHaveLength(0);
    await expect(db.query("UPDATE cloud_media_jobs SET disk_metrics=$1::jsonb",[JSON.stringify({...disk,peak_used_bytes:101})])).rejects.toThrow();
    await expect(db.query("UPDATE cloud_media_jobs SET disk_metrics=$1::jsonb",[JSON.stringify({...disk,min_free_bytes:"65"})])).rejects.toThrow();
    await db.exec("UPDATE cloud_media_jobs SET disk_metrics=NULL");
    expect((await db.query<{disk_metrics:unknown}>("SELECT disk_metrics FROM cloud_media_jobs")).rows[0]?.disk_metrics).toBeNull();
  } finally {await db.close();}
},30000);

describe("bounded cloud observation diagnostics", () => {
  it.each(["42P01", "signed-private-value"])("returns only a validated SQLSTATE from the budget phase: %s", async code => {
    const original=fixture.query.getMockImplementation()!;
    fixture.query.mockImplementation(async (statement:string, values:unknown[]) => {
      if(statement.includes("videoforge_cloud_media_reserve_budget"))
        throw Object.assign(new Error("private URL and bearer credential must never escape"),{code,detail:"private tenant facts"});
      return original(statement,values);
    });
    expect(await runCloudMediaObservation(environment,config,scope)).toEqual({state:"RECONCILING",delaySeconds:30,
      observationError:{phase:"BUDGET_RESERVATION",code:code==="42P01"?"SQLSTATE_42P01":"UNCLASSIFIED"}});
    expect(reservation.state).toBe("WAITING_CAPACITY");
    expect(fixture.transport.mock.calls.some(([,options])=>options.method==="POST")).toBe(false);
  });
  it("preserves the exact SQLSTATE when a known budget refusal is translated to a fixed local failure", async () => {
    reservation.launch_outcome=null;
    const original=fixture.query.getMockImplementation()!;
    fixture.query.mockImplementation(async (statement:string, values:unknown[]) => {
      if(statement.includes("videoforge_cloud_media_reserve_budget"))
        throw Object.assign(new Error("private budget detail"),{code:"23514"});
      return original(statement,values);
    });
    expect(await runCloudMediaObservation(environment,config,scope)).toEqual({state:"FAILED",delaySeconds:30,
      observationError:{phase:"BUDGET_RESERVATION",code:"SQLSTATE_23514"}});
    expect(reservation.state).toBe("CLEAN");
    expect(fixture.transport.mock.calls.some(([,options])=>options.method==="POST")).toBe(false);
  });
  it("reports catalogue HTTP status without retaining its private response body", async () => {
    fixture.transport.mockResolvedValue(response({detail:"private URL and credential"},429));
    expect(await runCloudMediaObservation(environment,config,scope)).toEqual({state:"RECONCILING",delaySeconds:30,
      observationError:{phase:"CATALOGUE",code:"RUNPOD_HTTP_429"}});
    expect(reservation.state).toBe("WAITING_CAPACITY");expect(fixture.transport).toHaveBeenCalledTimes(1);
  });
  it("reports terminal SQLSTATE without releasing an unsettled stopping reservation", async () => {
    reservation.state="STOPPING";
    const original=fixture.query.getMockImplementation()!;
    fixture.query.mockImplementation(async (statement:string, values:unknown[]) => {
      if(statement.includes("UPDATE hosted_cpu_job_attempts SET state=$2"))
        throw Object.assign(new Error("private terminal identity"),{code:"42883"});
      return original(statement,values);
    });
    expect(await runCloudMediaObservation(environment,config,scope)).toEqual({state:"RECONCILING",delaySeconds:30,
      observationError:{phase:"ATTEMPT_TERMINATION",code:"SQLSTATE_42883"}});
    expect(reservation.state).toBe("STOPPING");expect(fixture.transport).not.toHaveBeenCalled();
  });
  it("keeps settlement exceptions observable after a fixed permanent catalogue rejection", async () => {
    reservation.launch_outcome=null;
    fixture.transport.mockResolvedValue(response({detail:"private provider response"},401));
    const original=fixture.query.getMockImplementation()!;
    fixture.query.mockImplementation(async (statement:string, values:unknown[]) => {
      if(statement.includes("videoforge_settle_stranded_hosted_v209_requests"))
        throw Object.assign(new Error("private settlement facts"),{code:"55000"});
      return original(statement,values);
    });
    expect(await runCloudMediaObservation(environment,config,scope)).toEqual({state:"RECONCILING",delaySeconds:30,
      observationError:{phase:"FAILURE_SETTLEMENT",code:"SQLSTATE_55000"}});
    expect(reservation.state).toBe("CLEAN");expect(fixture.transport).toHaveBeenCalledTimes(1);
  });
  it("preserves an ambiguous paid create error without another create", async () => {
    fixture.transport.mockImplementation(async (url:string,options:RequestInit)=>url.includes("/catalog/")
      ?response({gpus:[{id:reservation.gpu,memory:24,secure:true,manufacturer:"NVIDIA",price:{secure:.4},availability:"HIGH"}]})
      :options.method==="POST"?response({detail:"private provider body"},429):emptyInventory());
    expect(await runCloudMediaObservation(environment,config,scope)).toEqual({state:"RECONCILING",delaySeconds:30,
      observationError:{phase:"POD_CREATE",code:"RUNPOD_HTTP_429"}});
    expect(reservation.state).toBe("AMBIGUOUS");
    await runCloudMediaObservation(environment,config,scope);
    expect(fixture.transport.mock.calls.filter(([,options])=>options.method==="POST")).toHaveLength(1);
  });
});

describe("lost completion receipt reconciliation",()=>{
  async function finishedWithoutCallbacks() {
    reservation.state="SAVING";reservation.launch_outcome="CONFIRMED";upload.state="VERIFIED";
    expect((await runRoute("cleanup",{completed_attempt_id:attemptId,state:"FAILED",reason:"JOB_FINISHED"}))?.status).toBe(200);
    expect(reservation.state).toBe("STOPPING");expect(reservation.failure_code).toBe("CLOUD_MEDIA_RECEIPT_PENDING");
  }
  it("accepts the same stored immutable receipt after every completion callback is lost, then independently cleans",async()=>{
    await finishedWithoutCallbacks();attempt.failure_code="OLD_DIAGNOSTIC";
    expect((await runRoute("complete",completion))?.status).toBe(409);
    expect((await runCloudMediaObservation(environment,config,scope)).state).toBe("SUCCEEDED");
    expect(attempt.state).toBe("SUCCEEDED");expect(attempt.failure_code).toBeNull();expect(reservation.state).toBe("CLEAN");
    expect(attempt.result_object_key).toBe(result.object_key);expect(attempt.result_checksum_sha256).toBe(result.issued_checksum_sha256);
    const receipt=attempt.result_receipt_sha256;
    expect((await runCloudMediaObservation(environment,config,scope)).state).toBe("SUCCEEDED");
    expect(attempt.result_receipt_sha256).toBe(receipt);
    expect(fixture.transport.mock.calls.some(([,options])=>options.method==="POST")).toBe(false);
    expect(fixture.query.mock.calls.filter(([sql])=>String(sql).includes("UPDATE hosted_cpu_job_attempts SET state=$2"))).toHaveLength(1);
  });
  it.each(["malformed","wrong-output","wrong-attempt"])("fails closed for a stored %s receipt",async mode=>{
    await finishedWithoutCallbacks();const doc=JSON.parse(new TextDecoder().decode(resultBytes));
    if(mode==="wrong-output") doc.output.sha256=`sha256:${"c".repeat(64)}`;
    if(mode==="wrong-attempt") doc.attempt_id="99999999-9999-4999-8999-999999999999";
    await setResultDocument(mode==="malformed"?"{invalid":doc);
    expect((await runCloudMediaObservation(environment,config,scope)).state).toBe("FAILED");
    expect(attempt.state).toBe("FAILED");expect(attempt.failure_code).toBe("CLOUD_MEDIA_UPLOAD_FAILED");expect(reservation.state).toBe("CLEAN");expect(attempt.result_receipt_sha256).toBeUndefined();
  });
  it("keeps transient storage recovery bounded by the original deadline without renting or accepting",async()=>{
    await finishedWithoutCallbacks();
    fixture.transport.mockResolvedValueOnce(response({pods:[placement()],pagination:{hasNextPage:false}}))
      .mockResolvedValueOnce(new Response(null,{status:204})).mockResolvedValueOnce(emptyInventory());
    vi.mocked(environment.PRIVATE_ARTIFACTS!.get).mockRejectedValueOnce(new TypeError("private transport detail"));
    expect((await runCloudMediaObservation(environment,config,scope)).state).toBe("RECONCILING");
    expect(attempt.state).toBe("RUNNING");expect(reservation.state).toBe("STOPPING");expect(reservation.cleanup_verified_at).toBeUndefined();
    expect(fixture.query.mock.calls.some(([sql])=>sql===CLOUD_COMPUTE_ABSENCE_EVENT_SQL)).toBe(true);
    expect(fixture.transport.mock.calls.map(([,options])=>options.method)).toEqual(["GET","DELETE","GET"]);
    expect((await runCloudMediaObservation(environment,config,scope)).state).toBe("SUCCEEDED");
    expect(attempt.state).toBe("SUCCEEDED");expect(reservation.state).toBe("CLEAN");
    expect(fixture.transport.mock.calls.some(([,options])=>options.method==="POST")).toBe(false);
  });
  it.each(["cancel-before","cancel-during","expired","already-failed","runtime-failure","stale-fence"])("never promotes when %s wins",async mode=>{
    await finishedWithoutCallbacks();
    if(mode==="cancel-before") attempt.state="CANCEL_REQUESTED";
    if(mode==="cancel-during") raceCancel=true;
    if(mode==="expired") attempt.deadline_at=new Date(0).toISOString();
    if(mode==="already-failed") attempt.state="FAILED";
    if(mode==="runtime-failure") reservation.failure_code="CLOUD_MEDIA_RUNTIME_REJECTED";
    if(mode==="stale-fence") fixture.checksum.mockImplementation(async()=>{reservation.fence_id="99999999-9999-4999-8999-999999999999";return true;});
    await runCloudMediaObservation(environment,config,scope);
    expect(attempt.state).not.toBe("SUCCEEDED");expect(attempt.result_receipt_sha256).toBeUndefined();
    expect(fixture.transport.mock.calls.some(([,options])=>options.method==="POST")).toBe(false);
  });
});

it("enforces trusted receipt recovery and cancellation fencing in real PostgreSQL",async()=>{
  reservation.state="STOPPING";reservation.failure_code="CLOUD_MEDIA_RECEIPT_PENDING";upload.state="VERIFIED";
  await runCloudMediaObservation(environment,config,scope);
  const terminal=fixture.query.mock.calls.find(([sql,values])=>String(sql).includes("UPDATE hosted_cpu_job_attempts SET state=$2") && values[1]==="SUCCEEDED");
  expect(terminal).toBeDefined();
  vi.unstubAllGlobals();const {PGlite}=await import("@electric-sql/pglite");const db=new PGlite();
  try {
    await db.exec(`CREATE TABLE hosted_cpu_job_attempts(id uuid PRIMARY KEY,state text,execution_backend text,
      terminal_at timestamptz,submitted_at timestamptz,retain_until timestamptz,deadline_at timestamptz,
      result_object_key text,result_content_length bigint,result_checksum_sha256 text,result_receipt_sha256 text,
      failure_code text,version integer DEFAULT 0,updated_at timestamptz);
      CREATE TABLE cloud_media_reservations(id uuid,leased_attempt_id uuid,fence_id uuid,state text,failure_code text,deadline_at timestamptz);`);
    for(const mode of ["trusted","public","cancel","failed","expired-cpu","expired-reservation","stale-fence","wrong-attempt","runtime-failure"]) {
      await db.exec("TRUNCATE hosted_cpu_job_attempts,cloud_media_reservations");
      await db.query("INSERT INTO hosted_cpu_job_attempts(id,state,execution_backend,deadline_at,failure_code) VALUES($1,$2,'RUNPOD_POD',$3,'PREVIOUS_DIAGNOSTIC')",
        [attemptId,mode==="cancel"?"CANCEL_REQUESTED":mode==="failed"?"FAILED":"RUNNING",mode==="expired-cpu"?new Date(0).toISOString():future()]);
      await db.query("INSERT INTO cloud_media_reservations VALUES($1,$2,$3,'STOPPING',$4,$5)",
        [reservationId,mode==="wrong-attempt"?reservationId:attemptId,
          mode==="stale-fence"?reservationId:terminal![1][8],mode==="runtime-failure"?"CLOUD_MEDIA_RUNTIME_REJECTED":"CLOUD_MEDIA_RECEIPT_PENDING",
          mode==="expired-reservation"?new Date(0).toISOString():future()]);
      const values=[...terminal![1]];if(mode==="public") values[9]=false;
      const accepted=await db.query(String(terminal![0]),values);
      expect(accepted.rows,mode).toHaveLength(mode==="trusted"?1:0);
      const cpu=(await db.query<{state:string;failure_code:string|null}>("SELECT state,failure_code FROM hosted_cpu_job_attempts")).rows[0]!;
      if(mode==="trusted") expect(cpu).toEqual({state:"SUCCEEDED",failure_code:null});
      else {expect(cpu.state).not.toBe("SUCCEEDED");expect(cpu.failure_code).toBe("PREVIOUS_DIAGNOSTIC");}
    }
  } finally {await db.close();}
},30000);

it.each(["missing","expired"])("settles pending receipt with a fixed %s failure instead of a pending diagnostic",async mode=>{
  reservation.state="STOPPING";reservation.failure_code="CLOUD_MEDIA_RECEIPT_PENDING";upload.state="VERIFIED";reservation.launch_outcome="CONFIRMED";
  if(mode==="expired") reservation.deadline_at=new Date(0).toISOString();
  if(mode==="missing") {
    const prior=fixture.query.getMockImplementation()!;
    fixture.query.mockImplementation(async(sql:string,values:unknown[])=>sql.includes("SELECT * FROM hosted_cpu_upload_authorities")?{rows:[]}:prior(sql,values));
  }
  expect((await runCloudMediaObservation(environment,config,scope)).state).toBe("FAILED");
  expect(attempt.failure_code).toBe(mode==="missing"?"CLOUD_MEDIA_UPLOAD_FAILED":"CLOUD_MEDIA_DEADLINE_EXCEEDED");
  expect(reservation.state).toBe("CLEAN");
});

it("records idempotent owned absence while preserving the applied CLEAN iff timestamp and event constraints",async()=>{
  reservation.state="STOPPING";reservation.failure_code="CLOUD_MEDIA_RECEIPT_PENDING";reservation.launch_outcome="CONFIRMED";upload.state="VERIFIED";
  expect(await cleanupCloudReservation(new RunPodMediaClient("fixture-key"),config,reservation,true)).toBe(true);
  const retained=fixture.query.mock.calls.find(([sql])=>String(sql).includes("UPDATE cloud_media_reservations SET updated_at=now()"))!;
  const event=fixture.query.mock.calls.find(([sql])=>sql===CLOUD_COMPUTE_ABSENCE_EVENT_SQL)!;
  expect(retained).toBeDefined();expect(event).toBeDefined();
  vi.unstubAllGlobals();const {PGlite}=await import("@electric-sql/pglite");const {readFile}=await import("node:fs/promises");const db=new PGlite();
  try {
    const migration=await readFile(new URL("../../../../../packages/control-plane/migrations/0214_optional_runpod_media.sql",import.meta.url),"utf8");
    const cleanConstraint=migration.match(/CHECK\(\(state='CLEAN'\)=\(cleanup_verified_at IS NOT NULL\)\)/u)![0];
    const foundation=await readFile(new URL("../../../../../packages/control-plane/migrations/0029_v2_06_hosted_foundation.sql",import.meta.url),"utf8");
    const events=foundation.slice(foundation.indexOf("CREATE TABLE hosted_cpu_job_events ("),foundation.indexOf("CREATE INDEX hosted_cpu_job_events",foundation.indexOf("CREATE TABLE hosted_cpu_job_events (")));
    const table=events.slice(0,events.indexOf("\n);"))+"\n);";
    await db.exec(`CREATE TABLE hosted_cpu_job_attempts(account_id uuid,workspace_id uuid,id uuid,state text,execution_backend text,
      PRIMARY KEY(account_id,workspace_id,id));
      CREATE TABLE cloud_media_reservations(id uuid,leased_attempt_id uuid,fence_id uuid,state text,failure_code text,
        cleanup_verified_at timestamptz,updated_at timestamptz,${cleanConstraint});`);
    await db.exec(table);
    await db.query("INSERT INTO hosted_cpu_job_attempts VALUES($1,$2,$3,'RUNNING','RUNPOD_POD')",[accountId,workspaceId,attemptId]);
    await db.query("INSERT INTO cloud_media_reservations VALUES($1,$2,$3,'STOPPING','CLOUD_MEDIA_RECEIPT_PENDING',NULL,now())",[reservationId,attemptId,reservation.fence_id]);
    await db.query(String(retained[0]),retained[1]);
    await db.query(CLOUD_COMPUTE_ABSENCE_EVENT_SQL,event[1]);await db.query(CLOUD_COMPUTE_ABSENCE_EVENT_SQL,event[1]);
    const polls=(await db.query<{kind:string;sequence:number;facts_sha256:string}>("SELECT kind,sequence,facts_sha256 FROM hosted_cpu_job_events")).rows;
    expect(polls).toEqual([{kind:"POLL_OBSERVATION",sequence:1,facts_sha256:event[1][3]}]);
    expect((await db.query("SELECT state,cleanup_verified_at FROM cloud_media_reservations")).rows).toEqual([{state:"STOPPING",cleanup_verified_at:null}]);
    await expect(db.exec("UPDATE cloud_media_reservations SET cleanup_verified_at=now() WHERE state='STOPPING'")).rejects.toThrow();
    await db.exec("UPDATE cloud_media_reservations SET state='CLEAN',cleanup_verified_at=now()");
    expect((await db.query("SELECT state FROM cloud_media_reservations")).rows).toEqual([{state:"CLEAN"}]);
  } finally {await db.close();}
},30000);

describe("staging retained-render artifact terminal",()=>{
  const authority="99999999-9999-4999-8999-999999999999";
  function qualify(){Object.assign(environment,{VIDEOFORGE_ENVIRONMENT:"staging",VIDEOFORGE_CLOUD_MEDIA_QUALIFICATION_ONLY:"true",VIDEOFORGE_CLOUD_MEDIA_BUDGET_AUTHORITY_ID:authority});reservation.budget_authority_id=authority;}
  async function acceptArtifact(){reservation.state="SAVING";reservation.launch_outcome="CONFIRMED";expect((await runRoute("complete",completion))?.status).toBe(200);expect(attempt.state).toBe("SUCCEEDED");}
  it("uses normal render-only final promotion after verified completion and cleanup even in the staging qualification lane",async()=>{
    qualify();renderOnlyRun=exactRenderOnlyRun();await acceptArtifact();
    fixture.finalize.mockImplementation(async()=>{
      expect(reservation.state).toBe("CLEAN");expect(attempt.result_receipt_sha256).toBeDefined();
    });
    const outcome=await runCloudMediaObservation(environment,config,scope);
    expect(outcome.state).toBe("SUCCEEDED");expect(outcome.qualificationArtifactOnly).toBeUndefined();
    expect(fixture.finalize).toHaveBeenCalledWith(scope);
    expect(fixture.query.mock.calls.some(([sql])=>String(sql).includes("qualification_artifact_attempt_id"))).toBe(false);
  });
  it("finishes only the verified CPU artifact after independent cleanup, without ordinary promotion",async()=>{
    qualify();await acceptArtifact();const outcome=await runCloudMediaObservation(environment,config,scope);
    expect(outcome).toMatchObject({state:"SUCCEEDED",qualificationArtifactOnly:true,ordinaryFinalPromotion:false});
    expect(reservation.state).toBe("CLEAN");expect(reservation.cleanup_verified_at).toBeDefined();expect(fixture.finalize).not.toHaveBeenCalled();
    expect(attempt.result_receipt_sha256).toBeDefined();expect(attempt.result_checksum_sha256).toBe(result.issued_checksum_sha256);
  });
  it("does not publish a qualification terminal without its durable completion receipt",async()=>{
    qualify();attempt.state="SUCCEEDED";reservation.state="CLEAN";reservation.cleanup_verified_at=new Date().toISOString();
    expect((await runCloudMediaObservation(environment,config,scope)).state).toBe("FINALIZATION_PENDING");expect(fixture.finalize).not.toHaveBeenCalled();
  });
  it("keeps cleanup uncertainty pending before qualification artifact publication",async()=>{
    qualify();await acceptArtifact();fixture.transport.mockImplementation(async(_url:string,options:RequestInit)=>options.method==="DELETE"?new Response(null,{status:500}):response({pods:[placement()],pagination:{hasNextPage:false}}));
    const outcome=await runCloudMediaObservation(environment,config,scope);expect(outcome.state).toBe("RECONCILING");expect(outcome.qualificationArtifactOnly).toBeUndefined();expect(reservation.state).not.toBe("CLEAN");expect(fixture.finalize).not.toHaveBeenCalled();
  });
  it("rejects a reservation outside the exact qualification authority",async()=>{
    qualify();reservation.budget_authority_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";attempt.state="SUCCEEDED";reservation.state="CLEAN";
    expect((await runCloudMediaObservation(environment,config,scope)).state).toBe("QUALIFICATION_SCOPE_REJECTED");expect(fixture.finalize).not.toHaveBeenCalled();
  });
  it("keeps production ordinary promotion and its missing-barrier rejection",async()=>{
    await acceptArtifact();fixture.finalize.mockRejectedValue(new Error("HOSTED_V209_RENDER_TERMINAL_NOT_FOUND"));
    const outcome=await runCloudMediaObservation(environment,config,scope);expect(outcome).toMatchObject({state:"RECONCILING",observationError:{phase:"RESULT_FINALIZATION"}});
    expect(outcome.qualificationArtifactOnly).toBeUndefined();expect(fixture.finalize).toHaveBeenCalledWith(scope);expect(attempt.state).toBe("SUCCEEDED");expect(reservation.state).toBe("CLEAN");
  });
});

it("executes the exact qualification artifact query with PostgreSQL scope, lineage, receipt and cleanup guards",async()=>{
  vi.unstubAllGlobals();const {PGlite}=await import("@electric-sql/pglite");const db=new PGlite();
  const project="55555555-5555-4555-8555-555555555555",revision="66666666-6666-4666-8666-666666666666",authority="99999999-9999-4999-8999-999999999999",other="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  try{
    await db.exec(`CREATE TABLE hosted_cpu_job_attempts(id uuid PRIMARY KEY,account_id uuid,workspace_id uuid,project_id uuid,project_revision_id uuid,
      kind text,execution_backend text,state text,result_receipt_sha256 text,result_object_key text,result_content_length bigint,result_checksum_sha256 text);
      CREATE TABLE cloud_media_jobs(attempt_id uuid,account_id uuid,workspace_id uuid,reservation_id uuid);
      CREATE TABLE cloud_media_reservations(id uuid PRIMARY KEY,leased_attempt_id uuid,account_id uuid,workspace_id uuid,project_id uuid,project_revision_id uuid,
        budget_authority_id uuid,state text,cleanup_verified_at timestamptz,CHECK((state='CLEAN')=(cleanup_verified_at IS NOT NULL)));
      CREATE TABLE cloud_media_budget_authorities(id uuid PRIMARY KEY,allowed_account_ids uuid[],allowed_project_ids uuid[]);
      CREATE TABLE video_runtime_events(kind text); CREATE TABLE artifact_approvals(state text);`);
    await db.exec(`ALTER TABLE cloud_media_reservations ADD fence_id uuid DEFAULT '77777777-7777-4777-8777-777777777777';
      ALTER TABLE cloud_media_budget_authorities ADD enabled boolean DEFAULT true,ADD expires_at timestamptz DEFAULT now()+interval '1 hour';`);
    await installReservationAuthority(db);
    const substitutions:ReadonlyArray<readonly[string,string]>=[
      ["accepted","SELECT 1"],
      ["reservation-project",`UPDATE cloud_media_reservations SET project_id='${other}'`],
      ["reservation-revision",`UPDATE cloud_media_reservations SET project_revision_id='${other}'`],
      ["leased-attempt",`UPDATE cloud_media_reservations SET leased_attempt_id='${other}'`],
      ["reservation-account",`UPDATE cloud_media_reservations SET account_id='${other}'`],
      ["reservation-workspace",`UPDATE cloud_media_reservations SET workspace_id='${other}'`],
      ["job-account",`UPDATE cloud_media_jobs SET account_id='${other}'`],
      ["job-workspace",`UPDATE cloud_media_jobs SET workspace_id='${other}'`],
      ["authority",`UPDATE cloud_media_reservations SET budget_authority_id='${other}'`],
      ["account-membership",`UPDATE cloud_media_budget_authorities SET allowed_account_ids=ARRAY['${other}'::uuid]`],
      ["project-membership",`UPDATE cloud_media_budget_authorities SET allowed_project_ids=ARRAY['${other}'::uuid]`],
      ["missing-receipt","UPDATE hosted_cpu_job_attempts SET result_receipt_sha256=NULL"],
      ["missing-checksum","UPDATE hosted_cpu_job_attempts SET result_checksum_sha256=NULL"],
      ["missing-object","UPDATE hosted_cpu_job_attempts SET result_object_key=NULL"],
      ["zero-bytes","UPDATE hosted_cpu_job_attempts SET result_content_length=0"],
      ["cleanup-unconfirmed","UPDATE cloud_media_reservations SET state='STOPPING',cleanup_verified_at=NULL"],
      ["cpu-running","UPDATE hosted_cpu_job_attempts SET state='RUNNING'"],
      ["local-backend","UPDATE hosted_cpu_job_attempts SET execution_backend='PERSONAL_WORKER'"],
      ["wrong-kind","UPDATE hosted_cpu_job_attempts SET kind='ASR'"],
    ];
    for(const [mode,mutation] of substitutions){
      await db.exec("TRUNCATE hosted_cpu_job_attempts,cloud_media_jobs,cloud_media_reservations,cloud_media_budget_authorities");
      await db.query("INSERT INTO hosted_cpu_job_attempts VALUES($1,$2,$3,$4,$5,'RENDER','RUNPOD_POD','SUCCEEDED',$6,'private-object',100,$6)",[attemptId,accountId,workspaceId,project,revision,hash]);
      await db.query("INSERT INTO cloud_media_jobs VALUES($1,$2,$3,$4)",[attemptId,accountId,workspaceId,reservationId]);
      await db.query("INSERT INTO cloud_media_reservations VALUES($1,$2,$3,$4,$5,$6,$7,'CLEAN',now())",[reservationId,attemptId,accountId,workspaceId,project,revision,authority]);
      await db.query("INSERT INTO cloud_media_budget_authorities VALUES($1,ARRAY[$2::uuid],ARRAY[$3::uuid])",[authority,accountId,project]);
      await db.exec(mutation);
      const snapshot="SELECT jsonb_build_object('cpu',(SELECT jsonb_agg(to_jsonb(a)) FROM hosted_cpu_job_attempts a),'jobs',(SELECT jsonb_agg(to_jsonb(j)) FROM cloud_media_jobs j),'reservation',(SELECT jsonb_agg(to_jsonb(r)) FROM cloud_media_reservations r),'ordinary_events',(SELECT count(*) FROM video_runtime_events),'approvals',(SELECT count(*) FROM artifact_approvals)) AS facts";
      const before=(await db.query(snapshot)).rows;
      const accepted=await db.query(CLOUD_QUALIFICATION_RENDER_ARTIFACT_SQL,[attemptId,accountId,workspaceId,authority]);
      expect(accepted.rows,mode).toHaveLength(mode==="accepted"?1:0);
      expect((await db.query(snapshot)).rows,mode).toEqual(before);
      if(mode==="accepted")for(const values of [[other,accountId,workspaceId,authority],[attemptId,other,workspaceId,authority],[attemptId,accountId,other,authority],[attemptId,accountId,workspaceId,other]])
        expect((await db.query(CLOUD_QUALIFICATION_RENDER_ARTIFACT_SQL,values)).rows).toHaveLength(0);
    }
  }finally{await db.close();}
},30000);

describe("authority deadline at launch and adoption",()=>{
  it("settles an already expired unlaunched authority without catalogue, sweeps or paid POST",async()=>{
    reservation.authority_expires_at=new Date(0).toISOString();reservation.launch_outcome=null;
    expect((await runCloudMediaObservation(environment,config,scope)).state).toBe("FAILED");
    expect(reservation.state).toBe("CLEAN");expect(attempt.failure_code).toBe("CLOUD_MEDIA_DEADLINE_EXCEEDED");expect(fixture.transport).not.toHaveBeenCalled();
  });
  it("records a no-send refusal when the bounded deadline passes immediately before POST",async()=>{
    expiresBeforePost=true;
    expect((await runCloudMediaObservation(environment,config,scope)).state).toBe("FAILED");
    expect(attempt.failure_code).toBe("CLOUD_MEDIA_DEADLINE_EXCEEDED");expect(reservation.state).toBe("CLEAN");expect(reservation.launch_outcome).toBe("REFUSED");
    expect(fixture.transport.mock.calls.every(([,options])=>options.method==="GET")).toBe(true);
  });
  it.each(["cancel","revoke","replacement"])("rechecks exact lease and authority immediately before paid POST: %s",async mode=>{
    const prior=fixture.query.getMockImplementation()!;
    fixture.query.mockImplementation(async(statement:string,values:unknown[])=>{
      if(statement.includes("allowed_create_reservation")) {
        if(mode==="cancel")attempt.state="CANCEL_REQUESTED";
        else if(mode==="revoke")reservation.authority_enabled=false;
        else reservation.fence_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      }
      return prior(statement,values);
    });
    const outcome=await runCloudMediaObservation(environment,config,scope);
    expect(outcome.state).toBe(mode==="cancel"?"CANCELLED":mode==="revoke"?"FAILED":"RECONCILING");
    expect(fixture.transport.mock.calls.filter(([,options])=>options.method==="POST")).toHaveLength(0);
    if(mode==="replacement"){expect(attempt.state).toBe("RUNNING");expect(reservation.state).toBe("CREATING");expect(reservation.launch_outcome).toBe("UNKNOWN");}
    else expect(reservation.state).toBe("CLEAN");
  });
  it("adopts ownership then cleans a placement that arrives after the authority expiry without starting media",async()=>{
    placementExpired=true;reservation.state="AMBIGUOUS";let reads=0;
    fixture.transport.mockImplementation(async(_url:string,options:RequestInit)=>options.method==="DELETE"?new Response(null,{status:204}):++reads<=2?response({pods:[placement()],pagination:{hasNextPage:false}}):emptyInventory());
    expect((await runCloudMediaObservation(environment,config,scope)).state).toBe("FAILED");
    expect(reservation.pod_id).toBeDefined();expect(reservation.launch_outcome).toBe("CONFIRMED");expect(reservation.state).toBe("CLEAN");
    expect(fixture.transport.mock.calls.filter(([,options])=>options.method==="POST")).toHaveLength(0);expect(fixture.transport.mock.calls.filter(([,options])=>options.method==="DELETE")).toHaveLength(1);
  });
});
it("bounds real PostgreSQL create and placement deadlines by the exact authority expiry",async()=>{
  vi.unstubAllGlobals();const {PGlite}=await import("@electric-sql/pglite");const db=new PGlite();const authority="99999999-9999-4999-8999-999999999999";
  try{
    await db.exec(`CREATE TABLE hosted_cpu_job_attempts(id uuid PRIMARY KEY,deadline_at timestamptz,state text,account_id uuid,workspace_id uuid);
      CREATE TABLE cloud_media_budget_authorities(id uuid PRIMARY KEY,enabled boolean,expires_at timestamptz);
      CREATE TABLE cloud_media_reservations(id uuid PRIMARY KEY,leased_attempt_id uuid,fence_id uuid,budget_authority_id uuid,account_id uuid,workspace_id uuid,state text,gpu text,
        expected_hourly_usd numeric,rental_seconds integer,deadline_at timestamptz,placement_deadline_at timestamptz,launch_outcome text,updated_at timestamptz,verified_at timestamptz,last_heartbeat_at timestamptz);`);
    await db.exec(`ALTER TABLE hosted_cpu_job_attempts ADD project_id uuid DEFAULT '55555555-5555-4555-8555-555555555555',
      ADD project_revision_id uuid DEFAULT '66666666-6666-4666-8666-666666666666',ADD execution_backend text DEFAULT 'RUNPOD_POD';
      ALTER TABLE cloud_media_reservations ADD project_id uuid DEFAULT '55555555-5555-4555-8555-555555555555',
        ADD project_revision_id uuid DEFAULT '66666666-6666-4666-8666-666666666666';
      ALTER TABLE cloud_media_budget_authorities ADD allowed_account_ids uuid[] DEFAULT ARRAY['11111111-1111-4111-8111-111111111111'::uuid],
        ADD allowed_project_ids uuid[] DEFAULT ARRAY['55555555-5555-4555-8555-555555555555'::uuid];
      CREATE TABLE cloud_media_jobs(attempt_id uuid,account_id uuid,workspace_id uuid,reservation_id uuid);`);
    await installReservationAuthority(db);
    for(const mode of ["authority-first","cpu-first","rental-first","authority-expired","authority-disabled"]){
      await db.exec("TRUNCATE hosted_cpu_job_attempts,cloud_media_budget_authorities,cloud_media_reservations,cloud_media_jobs");
      const now=Date.now(),expiry=new Date(now+(mode==="authority-expired"?-1000:mode==="authority-first"?60_000:3600_000)).toISOString(),cpuDeadline=new Date(now+(mode==="cpu-first"?30_000:3600_000)).toISOString();
      await db.query("INSERT INTO hosted_cpu_job_attempts VALUES($1,$2,'RUNNING',$3,$4)",[attemptId,cpuDeadline,accountId,workspaceId]);
      await db.query("INSERT INTO cloud_media_budget_authorities VALUES($1,$2,$3)",[authority,mode!=="authority-disabled",expiry]);
      await db.query("INSERT INTO cloud_media_reservations(id,leased_attempt_id,fence_id,budget_authority_id,state,rental_seconds,placement_deadline_at,account_id,workspace_id) VALUES($1,$2,$3,$4,'WAITING_CAPACITY',$5,now()+interval '3 minutes',$6,$7)",[reservationId,attemptId,reservation.fence_id,authority,mode==="rental-first"?10:900,accountId,workspaceId]);
      await db.query("INSERT INTO cloud_media_jobs VALUES($1,$2,$3,$4)",[attemptId,accountId,workspaceId,reservationId]);
      for(const stale of [[reservationId,"NVIDIA A40",.6,reservationId,reservation.fence_id],[reservationId,"NVIDIA A40",.6,attemptId,reservationId]])
        expect((await db.query(CLOUD_CREATE_RENTAL_SQL,stale)).rows,mode).toHaveLength(0);
      const created=await db.query<{deadline_at:Date;state:string}>(CLOUD_CREATE_RENTAL_SQL,[reservationId,"NVIDIA A40",.6,attemptId,reservation.fence_id]);
      expect(created.rows,mode).toHaveLength(["authority-expired","authority-disabled"].includes(mode)?0:1);
      if(!created.rows.length)continue;
      const chosen=created.rows[0]!.deadline_at instanceof Date ? created.rows[0]!.deadline_at.getTime():Date.parse(String(created.rows[0]!.deadline_at));expect(chosen).toBeLessThanOrEqual(Date.parse(expiry));expect(chosen).toBeLessThanOrEqual(Date.parse(cpuDeadline));
      if(mode==="authority-first")expect(chosen).toBe(Date.parse(expiry));if(mode==="cpu-first")expect(chosen).toBe(Date.parse(cpuDeadline));if(mode==="rental-first")expect(chosen).toBeLessThan(now+15_000);
      expect((await db.query(CLOUD_PRE_CREATE_ALLOWED_SQL,[reservationId,attemptId,reservation.fence_id])).rows).toHaveLength(1);
      for(const sql of ["UPDATE hosted_cpu_job_attempts SET state='CANCEL_REQUESTED'","UPDATE cloud_media_budget_authorities SET enabled=false"]){
        await db.exec(sql);expect((await db.query(CLOUD_PRE_CREATE_ALLOWED_SQL,[reservationId,attemptId,reservation.fence_id])).rows).toHaveLength(0);
        await db.exec("UPDATE hosted_cpu_job_attempts SET state='RUNNING';UPDATE cloud_media_budget_authorities SET enabled=true");
      }
      for(const stale of [[reservationId,reservationId,reservation.fence_id],[reservationId,attemptId,reservationId]])
        {expect((await db.query(CLOUD_PLACEMENT_READY_SQL,stale)).rows,mode).toHaveLength(0);expect((await db.query(CLOUD_PRE_CREATE_ALLOWED_SQL,stale)).rows,mode).toHaveLength(0);}
      expect((await db.query(CLOUD_PLACEMENT_READY_SQL,[reservationId,attemptId,reservation.fence_id])).rows).toHaveLength(1);
      await db.exec("UPDATE cloud_media_reservations SET state='AMBIGUOUS';UPDATE cloud_media_budget_authorities SET expires_at=now()-interval '1 second'");
      expect((await db.query(CLOUD_PLACEMENT_READY_SQL,[reservationId,attemptId,reservation.fence_id])).rows).toHaveLength(0);
      expect((await db.query<{state:string}>("SELECT state FROM cloud_media_reservations")).rows[0]!.state).toBe("AMBIGUOUS");
    }
  }finally{await db.close();}
},30000);

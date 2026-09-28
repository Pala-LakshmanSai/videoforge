// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostedRuntimeConfiguration, HostedRuntimeEnvironment } from "./configuration";
import { sha256 } from "./crypto";
import asrResultFixture from "../../../../../packages/contracts/generated/fixtures/asr_job_result.valid.json";
import renderResultFixture from "../../../../../packages/contracts/generated/fixtures/render_job_result.valid.json";
import renderManifestFixture from "../../../../../packages/contracts/generated/fixtures/resolved_render_manifest.valid.json";
import { MULTIPART_PART_BYTES } from "./runpod-media-policy";

const fixture = vi.hoisted(() => ({ query: vi.fn(), transport: vi.fn(), checksum: vi.fn(), multipart: vi.fn(), part: vi.fn(), sign: vi.fn(), listMultipart:vi.fn() }));
vi.mock("./neon", () => ({ createNeonPool: () => ({ query: fixture.query, end: async () => {} }),
  createNeonExecutor: () => ({ transaction: async (run: (sql: unknown) => unknown) => run({ query: fixture.query }) }) }));
vi.mock("./r2-checksum", () => ({ verifyHostedObjectChecksum: fixture.checksum }));
vi.mock("./r2", () => ({ HostedR2Signer: class { multipartRequest = fixture.multipart; signMultipartPart = fixture.part; sign = fixture.sign; listMultipartUploadsExact=fixture.listMultipart; } }));
vi.mock("./hosted-v209-queue-admission",()=>({ensureHostedV209GenerationAdmission:async()=>({state:"ACTIVE"})}));
import { CLOUD_TERMINAL_EVENT_SQL, cleanupCloudReservation, cloudRenderDuration, handleCloudMediaRequest, RunPodMediaClient, runCloudMediaObservation, verifyCloudPlacement } from "./runpod-media";

type Row = Record<string, unknown>;
const accountId = "11111111-1111-4111-8111-111111111111", workspaceId = "22222222-2222-4222-8222-222222222222";
const attemptId = "33333333-3333-4333-8333-333333333333", reservationId = "44444444-4444-4444-8444-444444444444";
const hash = `sha256:${"a".repeat(64)}`, capability = "c".repeat(64);
const scope = { accountId, workspaceId, attemptId };
const environment = { RUNPOD_API_KEY: "fixture-key", PRIVATE_ARTIFACTS: { head: vi.fn(),get: vi.fn() } } as unknown as HostedRuntimeEnvironment;
const config = { publicOrigin: "https://videoforge.example", neon: { databaseUrl: "fixture" }, workflowCallbackSecret: "fixture-secret",
  cloudMedia: { apiKey: "fixture-key", image: `ghcr.io/example/media@${hash}`, sourceSha256: hash,runtimeSha256:hash,tooling:{ffmpeg_version:"8.1.2"} } } as unknown as HostedRuntimeConfiguration;
let attempt: Row, reservation: Row, upload: Row, measuredJob:Row, tokenHash: string, raceCancel = false, rotateBeforeStop = false, generationActive = false, cpuSettled = true, noReservation = false, qualificationAllowed=true;
let resultBytes:Uint8Array, templateBytes:Uint8Array;
const future = () => new Date(Date.now() + 3_600_000).toISOString();

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
const primary = { source: "PRIMARY_RESULT_OUTPUT", object_key: "primary", issued_content_length: 100, issued_checksum_sha256: hash, content_type: "video/mp4" };
const result = { source: "RESULT_DOCUMENT", object_key: "result", issued_content_length: 50, issued_checksum_sha256: hash, content_type: "application/json" };
const completion = { schema_version: "videoforge-personal-worker-completion/v1", status: "SUCCEEDED", result_object_key: "result", result_content_length: 50, result_checksum_sha256: hash };

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
  qualificationAllowed=true;
  vi.clearAllMocks(); raceCancel = false; rotateBeforeStop = false; generationActive = false; cpuSettled = true; noReservation = false; tokenHash = await sha256(capability);
  attempt = { id: attemptId, account_id: accountId, workspace_id: workspaceId, state: "RUNNING", kind: "RENDER",
    project_id: "55555555-5555-4555-8555-555555555555", project_revision_id: "66666666-6666-4666-8666-666666666666", deadline_at: future() };
  reservation = { id: reservationId, attempt_id: attemptId, leased_attempt_id: attemptId, account_id: accountId, workspace_id: workspaceId,
    fence_id: "77777777-7777-4777-8777-777777777777", state: "WAITING_CAPACITY", pod_name: `videoforge-media-${reservationId}`,
    image: `ghcr.io/example/media@${hash}`, gpu: "NVIDIA GeForce RTX 4090", disk_gb: 100, max_hourly_usd: 1,
    budget_usd: 2, rental_seconds: 7200, round: 0, candidate_index: 0, next_check_at: new Date(0).toISOString(),
    placement_deadline_at: future(), deadline_at: future(), launch_outcome: "UNKNOWN", verified_at: new Date().toISOString() };
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
    if (sql.includes("videoforge_cloud_media_qualification_scope")) return {rows:[{allowed:qualificationAllowed}]};
    if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
    if (sql.includes("SELECT r.id FROM cloud_media_reservations r")) return {rows:[{id:reservationId}]};
    if (sql.includes("videoforge_cloud_media_capability_scope")) return { rows: values[1] === tokenHash ? [{ account_id: accountId }] : [] };
    if (sql.includes("SELECT a.*,p.owner_user_id")) return { rows: [{ ...attempt }] };
    if (sql.includes("SELECT r.* FROM cloud_media_reservations")) return { rows: noReservation ? [] : [{ ...reservation }] };
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
    if (sql.includes("INSERT INTO cloud_media_multipart_parts")) return { rows: [] };
    if (sql.includes("SELECT part_number,content_length FROM cloud_media_multipart_parts")) return { rows: [
      { part_number: 1, content_length: MULTIPART_PART_BYTES }, { part_number: 2, content_length: MULTIPART_PART_BYTES }] };
    if (sql.includes("videoforge_settle_stranded_hosted_v209_requests")) return { rows: [{ settled: 1 }] };
    if (sql.includes("videoforge_settle_cloud_media_cpu_failure")) return { rows: [{ settled: cpuSettled }] };
    if (sql.includes("SELECT id FROM generation_requests WHERE account_id=")) return { rows: generationActive ? [{ id: "fixture-generation" }] : [] };
    if (sql.includes("SET failure_settled_at=COALESCE")) { reservation.failure_settled_at = new Date().toISOString(); return { rows: [] }; }
    if (sql.includes("UPDATE cloud_media_reservations SET launch_outcome='REFUSED'")) { reservation.launch_outcome = "REFUSED"; return { rows: [] }; }
    if (sql.includes("videoforge_cloud_media_reserve_budget") || sql.includes("videoforge_cloud_media_renew_admission")) return { rows: [{ reserved: true }] };
    if (sql.includes("SELECT id FROM cloud_media_reservations")) return { rows: reservation.state === "WAITING_CAPACITY" ? [{ id: reservationId }] : [] };
    if (sql.includes("SELECT state FROM hosted_cpu_job_attempts")) return { rows: [{ state: attempt.state }] };
    if (sql.trimStart().startsWith("SELECT 1 FROM cloud_media_reservations")) {
      const fresh = attempt.state === "RUNNING" && reservation.state === "SAVING";
      if (raceCancel) attempt.state = "CANCEL_REQUESTED";
      return { rows: fresh ? [{}] : [] };
    }
    if (sql.includes("UPDATE hosted_cpu_job_attempts SET state=$2")) {
      if (values[1] === "SUCCEEDED" && attempt.state !== "RUNNING") return { rows: [] };
      attempt.state = values[1]; return { rows: [{ id: attemptId }] };
    }
    if (sql.includes("UPDATE hosted_cpu_job_attempts SET state='RUNNING'")) { attempt.state = "RUNNING"; return { rows: [{ id: attemptId }] }; }
    if (sql.includes("UPDATE cloud_media_reservations SET state='CREATING'")) {
      if (reservation.state !== "WAITING_CAPACITY") return { rows: [] };
      reservation.state = "CREATING"; reservation.gpu = values[1]; reservation.launch_outcome = "UNKNOWN";
      return { rows: [{ ...reservation }] };
    }
    if (sql.includes("UPDATE cloud_media_reservations SET state='WAITING_CAPACITY'")) {
      reservation.state = "WAITING_CAPACITY"; reservation.launch_outcome = "REFUSED";
      reservation.candidate_index = Number(reservation.candidate_index) + 1; return { rows: [] };
    }
    if (sql.includes("UPDATE cloud_media_reservations SET pod_id=")) {
      reservation.pod_id = values[1]; reservation.launch_outcome = "CONFIRMED"; return { rows: [] };
    }
    if (sql.includes("UPDATE cloud_media_reservations SET state='STARTING'")) { reservation.state = "STARTING"; return { rows: [] }; }
    if (sql.includes("UPDATE cloud_media_reservations SET state='CLEAN'")) {
      if (values.length > 1 && (values[1] !== reservation.leased_attempt_id || values[2] !== reservation.fence_id)) return { rows: [] };
      reservation.state = "CLEAN"; return { rows: [{ id: reservationId }] };
    }
    if (sql.includes("UPDATE cloud_media_reservations SET state=$2")) {
      if (rotateBeforeStop && values[1] === "STOPPING") {
        rotateBeforeStop = false; reservation.leased_attempt_id = "99999999-9999-4999-8999-999999999999";
      }
      if (values.length > 3 && (values[3] !== reservation.leased_attempt_id || values[4] !== reservation.fence_id)) return { rows: [] };
      reservation.state = values[1]; return { rows: [{ id: reservationId }] };
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
it("keeps other ready spans unreserved for the existing account Pod's bounded batch",async()=>{
  noReservation=true;attempt.kind="SPAN_AUDIO";attempt.state="OUTBOXED";attempt.owner_user_id="fixture-owner";
  await setTemplate("SPAN_AUDIO",{});Object.assign(attempt,{job_spec_object_key:reservation.job_spec_object_key,
    job_spec_content_length:reservation.job_spec_content_length,job_spec_checksum_sha256:reservation.job_spec_checksum_sha256});
  expect(await runCloudMediaObservation(environment,config,scope)).toEqual({state:"WAITING_CAPACITY",delaySeconds:5});
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

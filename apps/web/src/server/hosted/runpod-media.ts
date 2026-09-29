import type { SqlExecutor, SqlPrimitive } from "@videoforge/control-plane";
import type { HostedExecutionContext } from "./auth";
import type { HostedRuntimeConfiguration, HostedRuntimeEnvironment } from "./configuration";
import { cloudMediaQualificationOnly } from "./cloud-media-qualification";
import { deriveCallbackToken, deriveScopedToken, sha256, sha256Bytes } from "./crypto";
import { createNeonExecutor, createNeonPool } from "./neon";
import { canonicalJson } from "./submission";
import { validateAndHashHostedContractDocument } from "./precompiled-contract-validation";
import { HostedR2Signer } from "./r2";
import { verifyHostedObjectChecksum } from "./r2-checksum";
import { ensureHostedV209GenerationAdmission } from "./hosted-v209-queue-admission";
import { startHostedStageContinuation } from "./stage-continuation";
import { reconcileHostedV209SpanWorkflowTerminal } from "./hosted-v209-span-workflow-reconciliation";
import { cloudDiskGb, cloudGpuCandidates, isCapacityRefusal, MULTIPART_PART_BYTES,
  RunPodMediaError, SHA256, SINGLE_PUT_MAX_BYTES, type CloudGpu } from "./runpod-media-policy";

export const CLOUD_TERMINAL_EVENT_SQL = `INSERT INTO hosted_cpu_job_events(id,account_id,workspace_id,attempt_id,sequence,kind,facts_sha256,occurred_at)
      SELECT md5($1::text||':cloud:'||$4)::uuid,$2::uuid,$3::uuid,$1::uuid,COALESCE(max(sequence),0)+1,$4,$5,now()
      FROM hosted_cpu_job_events WHERE attempt_id=$1::uuid HAVING NOT EXISTS
        (SELECT 1 FROM hosted_cpu_job_events WHERE attempt_id=$1::uuid AND kind=$4)`;

export const CLOUD_COMPUTE_ABSENCE_EVENT_SQL = `INSERT INTO hosted_cpu_job_events(id,account_id,workspace_id,attempt_id,sequence,kind,facts_sha256,occurred_at)
    SELECT md5($4::text)::uuid,$2::uuid,$3::uuid,$1::uuid,COALESCE(max(sequence),0)+1,'POLL_OBSERVATION',$4,now()
    FROM hosted_cpu_job_events WHERE attempt_id=$1::uuid HAVING NOT EXISTS
      (SELECT 1 FROM hosted_cpu_job_events WHERE id=md5($4::text)::uuid)`;

export const CLOUD_DISK_METRICS_SQL = `UPDATE cloud_media_jobs j SET disk_metrics=CASE
    WHEN j.disk_metrics IS NULL THEN $4::jsonb ELSE j.disk_metrics || jsonb_build_object(
      'peak_used_bytes',GREATEST((j.disk_metrics->>'peak_used_bytes')::bigint,($4::jsonb->>'peak_used_bytes')::bigint),
      'min_free_bytes',LEAST((j.disk_metrics->>'min_free_bytes')::bigint,($4::jsonb->>'min_free_bytes')::bigint),
      'sample_count',GREATEST((j.disk_metrics->>'sample_count')::bigint,($4::jsonb->>'sample_count')::bigint)) END
    FROM cloud_media_reservations r JOIN hosted_cpu_job_attempts a ON a.id=r.leased_attempt_id
    WHERE j.reservation_id=$1::uuid AND j.attempt_id=$2::uuid AND r.id=j.reservation_id
      AND r.leased_attempt_id=j.attempt_id AND r.fence_id=$3::uuid
      AND r.state IN ('STARTING','DOWNLOADING','RENDERING','CHECKING','SAVING')
      AND r.deadline_at>now() AND a.state='RUNNING'
      AND (j.disk_metrics IS NULL OR (j.disk_metrics->>'filesystem_total_bytes'=$4::jsonb->>'filesystem_total_bytes'
        AND j.disk_metrics->>'initial_used_bytes'=$4::jsonb->>'initial_used_bytes')) RETURNING j.attempt_id`;

export function validCloudDiskMetrics(value: unknown): boolean {
  if (!value || typeof value!=="object" || Array.isArray(value)) return false;
  const facts=value as Record<string,unknown>;
  if (Object.keys(facts).sort().join()!=="filesystem_total_bytes,initial_used_bytes,min_free_bytes,peak_used_bytes,sample_count" ||
      Object.values(facts).some(n=>!Number.isSafeInteger(n) || Number(n)<0)) return false;
  return Number(facts.filesystem_total_bytes)>0 && Number(facts.sample_count)>0 &&
    Number(facts.initial_used_bytes)<=Number(facts.peak_used_bytes) &&
    Number(facts.peak_used_bytes)<=Number(facts.filesystem_total_bytes) &&
    Number(facts.min_free_bytes)<=Number(facts.filesystem_total_bytes);
}

type Row = Record<string, unknown>;
function query(sql: SqlExecutor, statement: string, values: readonly unknown[] = []) {
  const parameters: SqlPrimitive[] = values.map(value => {
    if (value === null || typeof value === "string" || typeof value === "number" ||
      typeof value === "bigint" || typeof value === "boolean" || value instanceof Date || value instanceof Uint8Array) return value;
    throw new TypeError("CLOUD_MEDIA_SQL_FACT_INVALID");
  });
  return sql.query(statement, parameters);
}
type Scope = {attemptId: string; accountId: string; workspaceId: string};
type ObservationPhase = "TEMPLATE" | "ADMISSION" | "RESERVATION" | "ADMISSION_RENEWAL" |
  "RECEIPT_RECONCILIATION" | "ATTEMPT_TERMINATION" | "CLEANUP" | "FAILURE_SETTLEMENT" | "RESULT_FINALIZATION" |
  "INVENTORY" | "PLACEMENT_ADOPTION" | "CATALOGUE" | "CAPACITY_CHECK" |
  "BUDGET_RESERVATION" | "CREATE_FENCE" | "LEASE_TOKEN" | "POD_CREATE";
type ObservationDiagnostic = {phase: ObservationPhase; code: string};
type ObservationOutcome = {state:string;delaySeconds?:number;observationError?:ObservationDiagnostic;qualificationArtifactOnly?:true;ordinaryFinalPromotion?:false};
function observationDiagnostic(error: unknown, phase: ObservationPhase): ObservationDiagnostic {
  // Only structured protocol codes cross the durable Workflow boundary. Never include messages,
  // request parameters, provider bodies, URLs, or driver properties other than validated SQLSTATE.
  if (error instanceof RunPodMediaError && Number.isInteger(error.status) && error.status >= 100 && error.status <= 599)
    return {phase,code:`RUNPOD_HTTP_${error.status}`};
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string" && /^[0-9A-Z]{5}$/u.test(error.code))
    return {phase,code:`SQLSTATE_${error.code}`};
  return {phase,code:"UNCLASSIFIED"};
}
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u;
const ACTIVE = ["STARTING", "DOWNLOADING", "RENDERING", "CHECKING", "SAVING"];
const TERMINAL = ["SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED"];
const RECEIPT_PENDING = "CLOUD_MEDIA_RECEIPT_PENDING";
class ReceiptStorageError extends Error {}
async function receiptRead<T>(recover:boolean,read:()=>Promise<T>):Promise<T> {
  try {return await read();} catch(error) {
    if(recover && !(error instanceof Error && error.message==="CLOUD_MEDIA_TEMPLATE_INVALID"))
      throw new ReceiptStorageError("CLOUD_MEDIA_RECEIPT_STORAGE_UNAVAILABLE");
    throw error;
  }
}

export class RunPodMediaClient {
  constructor(private readonly apiKey: string, private readonly transport: typeof fetch = fetch) {}
  async request(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<Row> {
    // No retry wrapper: a create response can be lost after the provider has billed.
    // Workers fetch rejects a client instance as its receiver (Illegal invocation).
    const transport = this.transport;
    const response = await transport(`https://api.runpod.io/v2${path}`, {method,
      headers: {authorization: `Bearer ${this.apiKey}`, "content-type": "application/json"},
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20_000)});
    if (method === "DELETE" && response.status === 404) return {};
    if (!response.ok) {
      let detail = "";
      try { const value = await response.json() as Row; detail = String(value.detail ?? ""); } catch { /* No provider body in logs. */ }
      throw new RunPodMediaError(response.status, isCapacityRefusal(response.status, detail));
    }
    return response.status === 204 ? {} : await response.json() as Row;
  }
  async inventory(): Promise<readonly Row[]> {
    const pods: Row[] = [], cursors = new Set<string>();
    let cursor = "";
    for (let page = 0; page < 1000; page++) {
      const value = await this.request("GET", `/pods?includeClusterPods=true&limit=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      const pagination = value.pagination as Row | undefined;
      if (!Array.isArray(value.pods) || typeof pagination?.hasNextPage !== "boolean")
        throw new Error("RUNPOD_INVENTORY_INCOMPLETE");
      pods.push(...value.pods as Row[]);
      if (pagination.hasNextPage === false) return pods;
      if (typeof pagination.nextCursor !== "string" || !pagination.nextCursor || cursors.has(pagination.nextCursor))
        throw new Error("RUNPOD_INVENTORY_INCOMPLETE");
      cursor = pagination.nextCursor; cursors.add(cursor);
    }
    throw new Error("RUNPOD_INVENTORY_INCOMPLETE");
  }
}

export function verifyCloudPlacement(pod: Row, reservation: Row): boolean {
  const gpu = pod.gpu as Row | undefined;
  const mounts = pod.mounts as Row | undefined;
  const hourly = Number(pod.cost) + Number(reservation.disk_gb) * .10 / 720;
  return typeof pod.id === "string" && /^[A-Za-z0-9_-]{1,80}$/u.test(pod.id) &&
    pod.name === reservation.pod_name && pod.image === reservation.image && (pod.registry ?? null)===(reservation.registry_id ?? null) && pod.cloud === "SECURE" &&
    Number(pod.disk) === Number(reservation.disk_gb) && gpu?.id === reservation.gpu &&
    gpu?.count === 1 && Number(gpu?.vcpuCount) >= 16 && Number(gpu?.memory) >= 64 &&
    (!mounts || Object.keys(mounts).length === 0) && Number.isFinite(Number(pod.cost)) && Number(pod.cost) > 0 &&
    hourly <= Number(reservation.max_hourly_usd) && hourly * Number(reservation.rental_seconds) / 3600 <= Number(reservation.budget_usd);
}

async function tenant<T>(config: HostedRuntimeConfiguration, accountId: string,
  action: (sql: SqlExecutor) => Promise<T>): Promise<T> {
  const pool = createNeonPool(config.neon.databaseUrl);
  try { return await createNeonExecutor(pool).transaction(async sql => {
    await query(sql, "SELECT set_config($1,$2,true)", ["videoforge.account_id", accountId]);
    return action(sql);
  }); } finally { await pool.end(); }
}
async function recordCloudDiskMetrics(sql:SqlExecutor,r:Row,metrics:unknown):Promise<boolean> {
  return metrics===undefined || !!(await query(sql,CLOUD_DISK_METRICS_SQL,
    [r.id,r.leased_attempt_id,r.fence_id,JSON.stringify(metrics)])).rows[0];
}
async function updateReservation(config: HostedRuntimeConfiguration, r: Row, state: string,
  failureCode?: string): Promise<boolean> {
  return tenant(config, String(r.account_id), async sql => {
    const changed=await query(sql, `UPDATE cloud_media_reservations SET state=$2,failure_code=COALESCE($3,failure_code),
      updated_at=now(),next_check_at=now()+interval '30 seconds' WHERE id=$1 AND state<>'CLEAN'
      AND leased_attempt_id=$4 AND fence_id=$5 RETURNING id`, [r.id,state,failureCode ?? null,r.leased_attempt_id,r.fence_id]);
    return !!changed.rows[0];
  });
}
async function finishAttempt(config: HostedRuntimeConfiguration, r: Row, state: string,
  facts?: {key: string; size: number; checksum: string}, receiptRecovery=false): Promise<boolean> {
  return tenant(config, String(r.account_id), async sql => {
    const receipt = facts ? await sha256(JSON.stringify({attempt_id:r.leased_attempt_id,content_length:facts.size,
      object_key:facts.key,result_checksum_sha256:facts.checksum})) : null;
    const changed = await query(sql, `UPDATE hosted_cpu_job_attempts SET state=$2,terminal_at=now(),submitted_at=COALESCE(submitted_at,now()),
      retain_until=CASE WHEN $2='SUCCEEDED' THEN NULL ELSE GREATEST(deadline_at,now()+interval '30 minutes') END,
      result_object_key=COALESCE($3,result_object_key),result_content_length=$4,result_checksum_sha256=$5,
      result_receipt_sha256=$6,failure_code=CASE WHEN $2='SUCCEEDED' THEN NULL WHEN $2='FAILED' THEN $7 ELSE failure_code END,
      version=version+1,updated_at=now() WHERE id=$1 AND execution_backend='RUNPOD_POD'
      AND (($2<>'SUCCEEDED' AND state IN ('PLANNED','OUTBOXED','RUNNING','CANCEL_REQUESTED','RECONCILING'))
        OR ($2='SUCCEEDED' AND state='RUNNING' AND EXISTS(SELECT 1 FROM cloud_media_reservations r
          WHERE r.id=$8 AND r.leased_attempt_id=hosted_cpu_job_attempts.id AND r.fence_id=$9
          AND (r.state='SAVING' OR ($10::boolean AND r.state='STOPPING' AND r.failure_code='CLOUD_MEDIA_RECEIPT_PENDING'))
          AND r.deadline_at>now() AND hosted_cpu_job_attempts.deadline_at>now()))) RETURNING id`,
    [r.leased_attempt_id ?? r.attempt_id,state,facts?.key ?? null,facts?.size ?? null,facts?.checksum ?? null,receipt,r.failure_code ?? "CLOUD_MEDIA_FAILED",r.id,r.fence_id,receiptRecovery]);
    if(!changed.rows[0]) return false;
    await query(sql, CLOUD_TERMINAL_EVENT_SQL,
      [r.leased_attempt_id ?? r.attempt_id,r.account_id,r.workspace_id,state,await sha256(`${r.id}:${state}:${receipt ?? ""}`)]);
    return true;
  });
}

/** A DELETE response is insufficient. Unknown create + empty inventory remains reserved. */
export async function cleanupCloudReservation(client: RunPodMediaClient, config: HostedRuntimeConfiguration, r: Row, retainReceiptPending=false): Promise<boolean> {
  if(r.launch_outcome==null || r.launch_outcome==="REFUSED") {
    // No accepted create: this durable outcome is provider-inert, including auth failures.
    const clean=await tenant(config,String(r.account_id),async sql=>(await query(sql,
      "UPDATE cloud_media_reservations SET state='CLEAN',cleanup_verified_at=now(),updated_at=now() WHERE id=$1 AND state IN ('WAITING_CAPACITY','CREATING','STOPPING') AND pod_id IS NULL AND (launch_outcome IS NULL OR launch_outcome='REFUSED') AND leased_attempt_id=$2 AND fence_id=$3 RETURNING id",[r.id,r.leased_attempt_id,r.fence_id])).rows[0]);
    return !!clean;
  }
  if(!await updateReservation(config,r,"STOPPING")) return false;
  const matching = (await client.inventory()).filter(p => p.name === r.pod_name);
  if (r.launch_outcome === "UNKNOWN" && matching.length === 0) return false;
  for (const pod of matching) {
    if (typeof pod.id !== "string" || !/^[A-Za-z0-9_-]{1,80}$/u.test(pod.id)) return false;
    await client.request("DELETE", `/pods/${encodeURIComponent(pod.id)}`);
  }
  if ((await client.inventory()).some(p => p.name === r.pod_name)) return false;
  // A killed process cannot abort its parts. Stop compute first, then clean only this
  // reservation's known unfinished uploads; completed objects are never deleted.
  const uploads=await tenant(config,String(r.account_id),async sql=>(await query(sql, `SELECT u.*
    FROM cloud_media_multipart_uploads u JOIN hosted_cpu_upload_authorities a ON a.id=u.authority_id
    JOIN cloud_media_jobs j ON j.attempt_id=a.attempt_id AND j.reservation_id=u.reservation_id
    JOIN cloud_media_reservations r ON r.id=u.reservation_id
    WHERE r.id=$1 AND r.state='STOPPING' AND r.leased_attempt_id=$2 AND r.fence_id=$3
      AND u.state NOT IN ('VERIFIED','ABORTED')`,[r.id,r.leased_attempt_id,r.fence_id])).rows);
  const signer=new HostedR2Signer(config.r2);
  for(const upload of uploads) {
    const ids=upload.upload_id ? [String(upload.upload_id)] : await signer.listMultipartUploadsExact(String(upload.object_key));
    // An empty read cannot identify a lost initiation. Keep the uncertainty durable.
    if(!ids.length) return false;
    for(const uploadId of ids) {
      const response=await signer.multipartRequest("DELETE",String(upload.object_key),{uploadId});
      if(!response.ok && response.status!==404) return false;
    }
    if((await signer.listMultipartUploadsExact(String(upload.object_key))).length) return false;
    await tenant(config,String(r.account_id),async sql=>{await query(sql,
      "UPDATE cloud_media_multipart_uploads SET state='ABORTED' WHERE id=$1 AND reservation_id=$2 AND state<>'VERIFIED'",[upload.id,r.id]);});
  }
  if(retainReceiptPending) return tenant(config,String(r.account_id),async sql=>{
    // Terminal publication also locks the CPU row before writing its event sequence.
    // Keep CLEAN's timestamp invariant; a poll receipt records compute absence while storage is pending.
    if(!(await query(sql,`SELECT id FROM hosted_cpu_job_attempts WHERE id=$1 AND account_id=$2 AND workspace_id=$3
      AND execution_backend='RUNPOD_POD' FOR UPDATE`,[r.leased_attempt_id,r.account_id,r.workspace_id])).rows[0]) return false;
    if(!(await query(sql,`UPDATE cloud_media_reservations SET updated_at=now()
      WHERE id=$1 AND state='STOPPING' AND failure_code='CLOUD_MEDIA_RECEIPT_PENDING'
        AND leased_attempt_id=$2 AND fence_id=$3 RETURNING id`,[r.id,r.leased_attempt_id,r.fence_id])).rows[0]) return false;
    const facts=await sha256(canonicalJson({schema_version:"videoforge-cloud-media-owned-absence/v1",
      reservation_id:r.id,attempt_id:r.leased_attempt_id,fence_id:r.fence_id,inventory_complete:true,owned_pods:0}));
    await query(sql,CLOUD_COMPUTE_ABSENCE_EVENT_SQL,[r.leased_attempt_id,r.account_id,r.workspace_id,facts]);
    return true;
  });
  return tenant(config,String(r.account_id), async sql => !!(await query(sql,
    `UPDATE cloud_media_reservations SET state='CLEAN',cleanup_verified_at=now(),updated_at=now()
      WHERE id=$1 AND state='STOPPING' AND leased_attempt_id=$2 AND fence_id=$3 RETURNING id`,
    [r.id,r.leased_attempt_id,r.fence_id])).rows[0]);
}

async function hasOrdinaryRenderRuntime(sql:SqlExecutor,a:Row):Promise<boolean> {
  return a.kind==="RENDER" && !!(await query(sql,`SELECT v.generation_request_id FROM video_runtime_states v
      JOIN generation_requests g ON g.id=v.generation_request_id AND g.account_id=v.account_id AND g.workspace_id=v.workspace_id
      WHERE g.account_id=$1 AND g.workspace_id=$2 AND g.project_id=$3 AND g.project_revision_id=$4 LIMIT 1`,
      [a.account_id,a.workspace_id,a.project_id,a.project_revision_id])).rows[0];
}
async function settleFailedCpu(config:HostedRuntimeConfiguration,a:Row):Promise<boolean> {
  return tenant(config,String(a.account_id),async sql=>{
    if(!await hasOrdinaryRenderRuntime(sql,a)) return (await query(sql,
      "SELECT videoforge_settle_cloud_media_cpu_failure($1) AS settled",[a.id])).rows[0]?.settled===true;
    await query(sql, `SELECT videoforge_settle_stranded_hosted_v209_requests($1,$2,p.owner_user_id)
      FROM projects p WHERE p.id=$3 AND p.account_id=$1 AND p.workspace_id=$2`,[a.account_id,a.workspace_id,a.project_id]);
    if((await query(sql,`SELECT id FROM generation_requests WHERE account_id=$1 AND workspace_id=$2
      AND project_id=$3 AND project_revision_id=$4 AND state IN ('ACTIVE','ADMITTED','CANCELLING')`,
      [a.account_id,a.workspace_id,a.project_id,a.project_revision_id])).rows[0]) return false;
    await query(sql,`UPDATE cloud_media_reservations r SET failure_settled_at=COALESCE(failure_settled_at,now())
      WHERE r.account_id=$1 AND r.workspace_id=$2 AND r.project_id=$3 AND r.project_revision_id=$4
      AND r.leased_attempt_id=$5 AND r.state='CLEAN' AND EXISTS(SELECT 1 FROM hosted_cpu_job_attempts a
        WHERE a.id=$5 AND a.execution_backend='RUNPOD_POD' AND a.kind='RENDER' AND a.state IN ('FAILED','CANCELLED','EXPIRED'))`,
      [a.account_id,a.workspace_id,a.project_id,a.project_revision_id,a.id]);
    return true;
  });
}

export const CLOUD_CREATE_RENTAL_SQL = `UPDATE cloud_media_reservations SET state='CREATING',gpu=$2,expected_hourly_usd=$3,
  deadline_at=LEAST(now()+make_interval(secs=>rental_seconds),a.deadline_at,b.expires_at),
  launch_outcome='UNKNOWN',updated_at=now() FROM hosted_cpu_job_attempts a,cloud_media_budget_authorities b
  WHERE cloud_media_reservations.id=$1 AND cloud_media_reservations.state='WAITING_CAPACITY'
    AND cloud_media_reservations.placement_deadline_at>now()
    AND cloud_media_reservations.leased_attempt_id=$4 AND cloud_media_reservations.fence_id=$5
    AND a.id=cloud_media_reservations.leased_attempt_id AND a.deadline_at>now()
    AND b.id=cloud_media_reservations.budget_authority_id AND b.enabled AND b.expires_at>now()
  RETURNING cloud_media_reservations.*`;
export const CLOUD_PRE_CREATE_ALLOWED_SQL = `SELECT r.id AS allowed_create_reservation FROM cloud_media_reservations r
  JOIN hosted_cpu_job_attempts a ON a.id=r.leased_attempt_id AND a.account_id=r.account_id AND a.workspace_id=r.workspace_id
  JOIN cloud_media_budget_authorities b ON b.id=r.budget_authority_id
  WHERE r.id=$1 AND r.leased_attempt_id=$2 AND r.fence_id=$3 AND r.state='CREATING' AND r.launch_outcome='UNKNOWN'
    AND a.state='RUNNING' AND a.deadline_at>now() AND r.deadline_at>now() AND b.enabled AND b.expires_at>now()`;
export const CLOUD_PLACEMENT_READY_SQL = `UPDATE cloud_media_reservations SET state='STARTING',verified_at=now(),
  deadline_at=LEAST(cloud_media_reservations.deadline_at,b.expires_at),last_heartbeat_at=now(),updated_at=now()
  FROM cloud_media_budget_authorities b WHERE cloud_media_reservations.id=$1
    AND cloud_media_reservations.leased_attempt_id=$2 AND cloud_media_reservations.fence_id=$3
    AND cloud_media_reservations.state IN ('CREATING','AMBIGUOUS') AND cloud_media_reservations.deadline_at>now()
    AND b.id=cloud_media_reservations.budget_authority_id AND b.enabled AND b.expires_at>now()
  RETURNING cloud_media_reservations.*`;

export const CLOUD_QUALIFICATION_RENDER_ARTIFACT_SQL = `SELECT a.id AS qualification_artifact_attempt_id FROM hosted_cpu_job_attempts a
       JOIN cloud_media_jobs j ON j.attempt_id=a.id AND j.account_id=a.account_id AND j.workspace_id=a.workspace_id
       JOIN cloud_media_reservations r ON r.id=j.reservation_id AND r.leased_attempt_id=a.id
         AND r.account_id=a.account_id AND r.workspace_id=a.workspace_id
         AND r.project_id=a.project_id AND r.project_revision_id=a.project_revision_id
       JOIN cloud_media_budget_authorities b ON b.id=r.budget_authority_id
       WHERE a.id=$1 AND a.account_id=$2 AND a.workspace_id=$3 AND a.kind='RENDER'
         AND a.execution_backend='RUNPOD_POD' AND a.state='SUCCEEDED'
         AND a.result_receipt_sha256 IS NOT NULL AND a.result_object_key IS NOT NULL
         AND a.result_content_length>0 AND a.result_checksum_sha256 IS NOT NULL
         AND r.state='CLEAN' AND r.cleanup_verified_at IS NOT NULL
         AND b.id=$4 AND a.account_id=ANY(b.allowed_account_ids) AND a.project_id=ANY(b.allowed_project_ids)`;

async function finalizeMedia(environment: HostedRuntimeEnvironment, config: HostedRuntimeConfiguration, a: Row): Promise<boolean | "QUALIFICATION_ARTIFACT"> {
  const scope = {accountId:String(a.account_id),workspaceId:String(a.workspace_id),attemptId:String(a.id)};
  if (a.kind === "ASR") {
    await startHostedStageContinuation(environment,{accountId:scope.accountId,projectId:String(a.project_id),
      revisionId:String(a.project_revision_id),step:"context"});
    return !!environment.HOSTED_CONTINUATION_WORKFLOW;
  }
  if (a.kind === "SPAN_AUDIO") return (await reconcileHostedV209SpanWorkflowTerminal(environment,config,scope)).state !== "FINALIZATION_PENDING";
  if (cloudMediaQualificationOnly(environment)) {
    // Retained-media qualification accepts a verified CPU artifact, without manufacturing
    // an ordinary provider barrier, project final output, or human approval.
    const accepted = await tenant(config,scope.accountId,async sql => (await query(sql,
      CLOUD_QUALIFICATION_RENDER_ARTIFACT_SQL,
      [a.id,a.account_id,a.workspace_id,environment.VIDEOFORGE_CLOUD_MEDIA_BUDGET_AUTHORITY_ID])).rows[0]);
    return accepted ? "QUALIFICATION_ARTIFACT" : false;
  }
  const { createHostedV209RenderTerminalLiveCoordinator } = await import("./app");
  await createHostedV209RenderTerminalLiveCoordinator(environment).acceptCompleted(scope);
  return true;
}

/** One observation; Workflow step retry is disabled. A restart always reads persisted state. */
export async function runCloudMediaObservation(environment: HostedRuntimeEnvironment, config: HostedRuntimeConfiguration,
  scope: Scope): Promise<ObservationOutcome> {
  const loaded = await tenant(config,scope.accountId, async sql => {
    const a = (await query(sql, `SELECT a.*,p.owner_user_id,r.revision_config_payload AS payload,v.duration_ms AS voiceover_duration_ms FROM hosted_cpu_job_attempts a
      JOIN projects p ON p.id=a.project_id JOIN project_revisions r ON r.id=a.project_revision_id
      LEFT JOIN assets v ON v.id=r.voiceover_asset_id AND v.account_id=a.account_id AND v.workspace_id=a.workspace_id
      WHERE a.id=$1 AND a.account_id=$2 AND a.workspace_id=$3 AND a.execution_backend='RUNPOD_POD'`,
    [scope.attemptId,scope.accountId,scope.workspaceId])).rows[0];
    const r = (await query(sql, "SELECT r.*,b.expires_at AS authority_expires_at,b.enabled AS authority_enabled FROM cloud_media_reservations r JOIN cloud_media_jobs j ON j.reservation_id=r.id JOIN cloud_media_budget_authorities b ON b.id=r.budget_authority_id WHERE j.attempt_id=$1 ORDER BY r.created_at DESC LIMIT 1",[scope.attemptId])).rows[0];
    const current = r && r.leased_attempt_id !== a?.id
      ? (await query(sql, "SELECT * FROM hosted_cpu_job_attempts WHERE id=$1", [r.leased_attempt_id])).rows[0] : a;
    return {a:current,r};
  });
  if (!loaded.a) return {state:"FAILED"};
  let a:Row = loaded.a; let r = loaded.r;
  if(cloudMediaQualificationOnly(environment)) {
    const authority=environment.VIDEOFORGE_CLOUD_MEDIA_BUDGET_AUTHORITY_ID!;
    if((r && r.budget_authority_id!==authority) || (!r && !await tenant(config,scope.accountId,async sql=>
      (await query(sql,"SELECT public.videoforge_cloud_media_qualification_scope($1,$2) AS allowed",[authority,a.project_id])).rows[0]?.allowed===true))
      )
      return {state:"QUALIFICATION_SCOPE_REJECTED"};
  }
  if (!r && TERMINAL.includes(String(a.state))) {
    if(a.state!=="SUCCEEDED" && !await settleFailedCpu(config,a)) return {state:"FINALIZATION_PENDING",delaySeconds:30};
    return {state:String(a.state)};
  }
  if(!r && Date.parse(String(a.deadline_at))<=Date.now()) {
    await finishAttempt(config,{...a,id:null,leased_attempt_id:a.id,fence_id:null},"EXPIRED");
    return {state:await settleFailedCpu(config,a)?"EXPIRED":"FINALIZATION_PENDING",delaySeconds:30};
  }
  if (a.state === "PLANNED") return {state:"PREPARING",delaySeconds:30};
  // Existing reservations keep their pinned runtime even if new allocations are disabled.
  const apiKey = config.cloudMedia?.apiKey ?? environment.RUNPOD_API_KEY;
  if (r && !apiKey) return {state:"RECONCILING",delaySeconds:30};
  const client = new RunPodMediaClient(apiKey ?? "");
  let phase: ObservationPhase = "TEMPLATE";
  try {
    if (!r) {
      if (!config.cloudMedia) return {state:"CLOUD_MEDIA_DISABLED",delaySeconds:30};
      phase="TEMPLATE";
      const committed=await cloudTemplate(environment,a), cloud=config.cloudMedia;
      if(!committed.runtime_identity || !committed.tooling || canonicalJson(committed.runtime_identity)!==canonicalJson({image:cloud.image,registry_id:cloud.registryId ?? null,
        source_sha256:cloud.sourceSha256,runtime_sha256:cloud.runtimeSha256}) || canonicalJson(committed.tooling)!==canonicalJson(cloud.tooling)) {
        phase="ATTEMPT_TERMINATION";
        await finishAttempt(config,{...a,id:null,attempt_id:a.id,leased_attempt_id:a.id,fence_id:null,failure_code:"CLOUD_MEDIA_RUNTIME_PIN_MISMATCH"},"FAILED");
        phase="FAILURE_SETTLEMENT";
        if(!await settleFailedCpu(config,a)) return {state:"FINALIZATION_PENDING",delaySeconds:30};
        return {state:"FAILED"};
      }
      // Ordinary rendering already crossed the accepted-provider barrier and released its
      // VIDEO lease. Retained-input rendering still needs the normal fair admission slot.
      if(!await tenant(config,scope.accountId,sql=>hasOrdinaryRenderRuntime(sql,a))) {
        phase="ADMISSION";
        const pool = createNeonPool(config.neon.databaseUrl);
        try {
          const admission = await ensureHostedV209GenerationAdmission(createNeonExecutor(pool),{
            accountId:scope.accountId,workspaceId:scope.workspaceId,userId:String(a.owner_user_id),projectId:String(a.project_id)});
          if (admission.state !== "ACTIVE") return {state:"WAITING_CAPACITY",delaySeconds:30};
        } finally { await pool.end(); }
      }
      phase="RESERVATION";
      r = await tenant(config,scope.accountId,async sql => {
        if(a.kind==="SPAN_AUDIO") {
          // Only the first ready span owns a reservation. Other exact jobs stay available for
          // its bounded in-Pod batch instead of each creating a competing waiting reservation.
          await query(sql,"SELECT pg_advisory_xact_lock(hashtextextended($1::text,214))",[scope.accountId]);
          const occupied=(await query(sql,`SELECT r.id FROM cloud_media_reservations r
            JOIN hosted_cpu_job_attempts a ON a.id=r.leased_attempt_id
            WHERE r.account_id=$1 AND r.project_id=$2 AND r.project_revision_id=$3
              AND a.kind='SPAN_AUDIO' AND r.state<>'CLEAN' LIMIT 1`,[scope.accountId,a.project_id,a.project_revision_id])).rows[0];
          if(occupied) return undefined;
        }
        const inputs = (await query(sql, `SELECT COALESCE(sum(content_length),0) AS bytes FROM media_worker_input_objects WHERE attempt_id=$1`,[a.id])).rows[0];
        const revision = typeof a.payload === "object" && a.payload ? a.payload as Row : {};
        const voiceover = revision.voiceover as Row | undefined;
        const duration = a.kind==="RENDER" ? await cloudRenderDuration(environment,sql,a,committed)
          : Number(a.voiceover_duration_ms ?? voiceover?.duration_ms ?? revision.voiceover_duration_ms);
        const cloud = config.cloudMedia!; const id=crypto.randomUUID();
        const token=await deriveScopedToken(config.workflowCallbackSecret,"cloud-reservation",id);
        const inserted = await query(sql, `INSERT INTO cloud_media_reservations(id,account_id,workspace_id,project_id,project_revision_id,
          attempt_id,leased_attempt_id,fence_id,capability_sha256,pod_name,image,source_sha256,runtime_sha256,tooling,disk_gb,
          max_hourly_usd,budget_usd,rental_seconds,budget_authority_id,registry_id,state,placement_deadline_at)
          VALUES($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16,$17,$18,$19,'WAITING_CAPACITY',now()+interval '180 seconds')
          ON CONFLICT(attempt_id) DO UPDATE SET attempt_id=EXCLUDED.attempt_id RETURNING *`,
        [id,scope.accountId,scope.workspaceId,a.project_id,a.project_revision_id,a.id,crypto.randomUUID(),await sha256(token),
          `videoforge-media-${id}`,cloud.image,cloud.sourceSha256,cloud.runtimeSha256,JSON.stringify(cloud.tooling),
          cloudDiskGb(Number(inputs?.bytes),duration),cloud.maxHourlyUsd,cloud.budgetUsd,cloud.maxRentalSeconds,cloud.budgetAuthorityId,cloud.registryId ?? null]);
        await query(sql, `INSERT INTO cloud_media_jobs(account_id,workspace_id,reservation_id,attempt_id)
          VALUES($1,$2,$3,$4) ON CONFLICT(attempt_id) DO NOTHING`,[scope.accountId,scope.workspaceId,inserted.rows[0]!.id,a.id]);
        return inserted.rows[0]!;
      });
      if(!r) return {state:"WAITING_CAPACITY",delaySeconds:5};
    }
    if(!["WAITING_CAPACITY","CLEAN"].includes(String(r.state))) {
      phase="ADMISSION_RENEWAL";
      await tenant(config,scope.accountId,async sql=>{await query(sql,'SELECT videoforge_cloud_media_renew_admission($1)',[r!.id]);});
    }
    if(a.kind==="SPAN_AUDIO" && a.state==="SUCCEEDED" && ACTIVE.includes(String(r.state)) &&
      Date.parse(String(r.updated_at))+30_000>Date.now()) return {state:"SAVING",delaySeconds:5};
    // A completed process may lose every callback. Reconcile its existing receipt before failing it.
    // Only the trusted observer can publish from this explicit, fenced cleanup marker.
    if(r.state==="STOPPING" && r.failure_code===RECEIPT_PENDING && a.state==="RUNNING" &&
      Date.parse(String(r.deadline_at))>Date.now() && Date.parse(String(a.deadline_at))>Date.now()) {
      phase="RECEIPT_RECONCILIATION";
      const authority=await tenant(config,scope.accountId,async sql=>(await query(sql,
        "SELECT * FROM hosted_cpu_upload_authorities WHERE attempt_id=$1 AND issued_at IS NOT NULL",[r!.leased_attempt_id])).rows
        .find(row=>row.source==="RESULT_DOCUMENT"));
      let accepted=false;
      if(authority) {
        try {
          accepted=(await cloudComplete({schema_version:"videoforge-personal-worker-completion/v1",status:"SUCCEEDED",
            result_object_key:authority.object_key,result_content_length:authority.issued_content_length,
            result_checksum_sha256:authority.issued_checksum_sha256},{...r,kind:a.kind},environment,config,true)).ok;
        } catch(error) {
          if(!(error instanceof ReceiptStorageError)) throw error;
          // Retry durable storage independently after stopping compute. Capacity remains fenced.
          phase="CLEANUP";
          await cleanupCloudReservation(client,config,r,true);
          return {state:"RECONCILING",delaySeconds:30};
        }
      }
      if(!accepted) {
        const code="CLOUD_MEDIA_UPLOAD_FAILED";
        if(!await updateReservation(config,r,"STOPPING",code)) return {state:"RECONCILING",delaySeconds:30};
        r={...r,failure_code:code};
      }
      // Cancellation or lease replacement during reads must win; never rewrite a terminal attempt.
      a=await tenant(config,scope.accountId,async sql=>(await query(sql,
        "SELECT * FROM hosted_cpu_job_attempts WHERE id=$1",[r!.leased_attempt_id])).rows[0]) ?? a;
    }
    if(r.state==="STOPPING" && r.failure_code===RECEIPT_PENDING && a.state==="RUNNING" &&
      (Date.parse(String(r.deadline_at))<=Date.now() || Date.parse(String(a.deadline_at))<=Date.now())) {
      if(!await updateReservation(config,r,"STOPPING","CLOUD_MEDIA_DEADLINE_EXCEEDED")) return {state:"RECONCILING",delaySeconds:30};
      r={...r,failure_code:"CLOUD_MEDIA_DEADLINE_EXCEEDED"};
    }
    if (TERMINAL.includes(String(a.state)) || a.state === "CANCEL_REQUESTED" ||
      (r.deadline_at && Date.parse(String(r.deadline_at)) <= Date.now()) ||
      r.authority_enabled===false || (r.authority_expires_at && Date.parse(String(r.authority_expires_at))<=Date.now()) ||
      (r.last_heartbeat_at && Date.parse(String(r.last_heartbeat_at)) + 300_000 <= Date.now()) || r.state === "STOPPING") {
      phase="ATTEMPT_TERMINATION";
      if(r.authority_enabled===false || (r.authority_expires_at && Date.parse(String(r.authority_expires_at))<=Date.now()))
        r={...r,failure_code:"CLOUD_MEDIA_DEADLINE_EXCEEDED"};
      if (!TERMINAL.includes(String(a.state))) await finishAttempt(config,r,a.state === "CANCEL_REQUESTED" ? "CANCELLED" : "FAILED");
      phase="CLEANUP";
      const clean = r.state === "CLEAN" || await cleanupCloudReservation(client,config,r);
      phase="FAILURE_SETTLEMENT";
      if(clean && a.state!=="SUCCEEDED" && !await settleFailedCpu(config,a)) return {state:"FINALIZATION_PENDING",delaySeconds:30};
      phase="RESULT_FINALIZATION";
      const finalized=clean && a.state === "SUCCEEDED" ? await finalizeMedia(environment,config,a) : true;
      if (!finalized) return {state:"FINALIZATION_PENDING",delaySeconds:30};
      return {state:clean ? (TERMINAL.includes(String(a.state)) ? String(a.state) : a.state === "CANCEL_REQUESTED" ? "CANCELLED" : "FAILED") : "RECONCILING",delaySeconds:30,
        ...(finalized==="QUALIFICATION_ARTIFACT" ? {qualificationArtifactOnly:true as const,ordinaryFinalPromotion:false as const} : {})};
    }
    if (r.state === "CLEAN") {phase="FAILURE_SETTLEMENT";if(a.state!=="SUCCEEDED" && !await settleFailedCpu(config,a)) return {state:"FINALIZATION_PENDING",delaySeconds:30};return {state:String(a.state)};}
    if (["CREATING","AMBIGUOUS"].includes(String(r.state))) {
      phase="INVENTORY";
      const matches=(await client.inventory()).filter(p=>p.name===r!.pod_name);
      if (matches.length!==1) { await updateReservation(config,r,"AMBIGUOUS"); return {state:"RECONCILING",delaySeconds:30}; }
      phase="PLACEMENT_ADOPTION";
      return await adopt(client,config,r,matches[0]!,a);
    }
    if (ACTIVE.includes(String(r.state))) {
      return {state:String(r.state),delaySeconds:30};
    }
    if (!config.cloudMedia) return {state:"WAITING_CAPACITY",delaySeconds:30};
    if (Date.parse(String(r.next_check_at))>Date.now()) return {state:"WAITING_CAPACITY",delaySeconds:30};
    if (Date.parse(String(r.placement_deadline_at))<=Date.now() || Number(r.round)>=3) {
      phase="CAPACITY_CHECK";
      await updateReservation(config,r,"STOPPING","CLOUD_MEDIA_CAPACITY_EXHAUSTED");
      r={...r,failure_code:"CLOUD_MEDIA_CAPACITY_EXHAUSTED"};
      phase="ATTEMPT_TERMINATION";
      await finishAttempt(config,r,"FAILED");
      phase="CLEANUP";
      const clean=await cleanupCloudReservation(client,config,r);
      phase="FAILURE_SETTLEMENT";
      return {state:clean?(await settleFailedCpu(config,a)?"FAILED":"FINALIZATION_PENDING"):"RECONCILING",delaySeconds:30};
    }
    phase="CATALOGUE";
    const catalog=await client.request("GET","/catalog/gpus?include=AVAILABILITY&product=POD&cloud=SECURE");
    if (!Array.isArray(catalog.gpus)) return {state:"WAITING_CAPACITY",delaySeconds:30};
    phase="CAPACITY_CHECK";
    const candidates=cloudGpuCandidates(catalog.gpus as CloudGpu[],Number(r.disk_gb),Number(r.max_hourly_usd),Number(r.budget_usd),Number(r.rental_seconds));
    const candidate=candidates[Number(r.candidate_index)];
    if (!candidate) {
      await tenant(config,scope.accountId, async sql=>{await query(sql, `UPDATE cloud_media_reservations SET round=round+1,candidate_index=0,
        next_check_at=now()+interval '30 seconds',updated_at=now() WHERE id=$1 AND state='WAITING_CAPACITY'`,[r!.id]);});
      return {state:"WAITING_CAPACITY",delaySeconds:30};
    }
    const reserved=await tenant(config,scope.accountId,async sql=>{
      // Lock before charging: an observation that lost the fence cannot consume authority.
      const ready=(await query(sql, "SELECT id FROM cloud_media_reservations WHERE id=$1 AND state='WAITING_CAPACITY' AND placement_deadline_at>now() FOR UPDATE",[r!.id])).rows[0];
      if(!ready) return undefined;
      phase="BUDGET_RESERVATION";
      try {await query(sql, 'SELECT videoforge_cloud_media_reserve_budget($1)',[r!.id]);}
      catch(error) {
        if(error && typeof error==='object' && 'code' in error && ['42501','55000','23514'].includes(String(error.code)))
          throw Object.assign(new Error('CLOUD_MEDIA_BUDGET_UNAVAILABLE'),{code:String(error.code)});
        throw error;
      }
      // One winner claims the durable fence. A concurrent or replayed observation cannot POST.
      phase="CREATE_FENCE";
      const selected=await query(sql,CLOUD_CREATE_RENTAL_SQL,
      [r!.id,candidate.id,candidate.price.secure+Number(r!.disk_gb)*.10/720,r!.leased_attempt_id,r!.fence_id]);
      if(!selected.rows[0] && (await query(sql,`SELECT r.id AS expired_authority_reservation FROM cloud_media_reservations r
        JOIN cloud_media_budget_authorities b ON b.id=r.budget_authority_id
        WHERE r.id=$1 AND r.leased_attempt_id=$2 AND r.fence_id=$3 AND r.state='WAITING_CAPACITY'
          AND (NOT b.enabled OR b.expires_at<=now())`,[r!.id,r!.leased_attempt_id,r!.fence_id])).rows[0])
        throw new Error("CLOUD_MEDIA_BUDGET_UNAVAILABLE");
      if (selected.rows[0]) await query(sql, `UPDATE hosted_cpu_job_attempts SET state='RUNNING',submitted_at=COALESCE(submitted_at,now()),
        version=version+1,updated_at=now() WHERE id=$1 AND state='OUTBOXED'`,[a.id]);
      return selected.rows[0];
    });
    if (!reserved) return {state:"RECONCILING",delaySeconds:30};
    r=reserved;
    phase="LEASE_TOKEN";
    const token=await deriveScopedToken(config.workflowCallbackSecret,"cloud-reservation",String(r.id));
    let pod:Row;
    phase="POD_CREATE";
    // A deadline reached before sending is a confirmed no-send refusal, unlike an ambiguous response.
    const allowedCreate=await tenant(config,scope.accountId,async sql=>(await query(sql,CLOUD_PRE_CREATE_ALLOWED_SQL,[r!.id,r!.leased_attempt_id,r!.fence_id])).rows[0]);
    if(Date.parse(String(r.deadline_at))<=Date.now() || !allowedCreate) {
      const refused=await tenant(config,scope.accountId,async sql=>(await query(sql,
        `UPDATE cloud_media_reservations SET launch_outcome='REFUSED',updated_at=now()
          WHERE id=$1 AND leased_attempt_id=$2 AND fence_id=$3 AND state='CREATING' RETURNING id,
            (SELECT state FROM hosted_cpu_job_attempts WHERE id=leased_attempt_id) AS attempt_state`,
        [r!.id,r!.leased_attempt_id,r!.fence_id])).rows[0]);
      if(!refused) return {state:"RECONCILING",delaySeconds:30};
      r={...r,launch_outcome:"REFUSED",failure_code:"CLOUD_MEDIA_DEADLINE_EXCEEDED"};
      const terminal=refused.attempt_state==="CANCEL_REQUESTED"?"CANCELLED":"FAILED";
      await finishAttempt(config,r,terminal);const clean=await cleanupCloudReservation(client,config,r);
      return {state:clean?(await settleFailedCpu(config,a)?terminal:"FINALIZATION_PENDING"):"RECONCILING",delaySeconds:30};
    }
    try { pod=await client.request("POST","/pods",{name:r.pod_name,image:r.image,registry:r.registry_id ?? null,cloud:"SECURE",disk:Number(r.disk_gb),
      gpu:{id:r.gpu,count:1,minVcpuCountPerGpu:16,minRamPerGpu:64},ports:[],startSsh:false,startJupyter:false,
      env:{VIDEOFORGE_CLOUD_CAPABILITY:token,VIDEOFORGE_CLOUD_SPEC_URL:`${config.publicOrigin}/api/v2/cloud-media/reservations/${r.id}/spec`}}); }
    catch(error) {
      const diagnostic=observationDiagnostic(error,"POD_CREATE");
      phase="INVENTORY";
      const matches=(await client.inventory()).filter(p=>p.name===r!.pod_name);
      if(matches.length===1) {phase="PLACEMENT_ADOPTION";return await adopt(client,config,r,matches[0]!,a);}
      if(matches.length===0 && error instanceof RunPodMediaError && error.capacityRejected) {
        await tenant(config,scope.accountId,async sql=>{await query(sql, `UPDATE cloud_media_reservations SET state='WAITING_CAPACITY',
          launch_outcome='REFUSED',candidate_index=candidate_index+1,next_check_at=now(),updated_at=now() WHERE id=$1 AND state='CREATING'`,[r!.id]);});
        return {state:"WAITING_CAPACITY",delaySeconds:1};
      }
      if(matches.length===0 && error instanceof RunPodMediaError && [400,401,402,403,404,422].includes(error.status)) {
        await tenant(config,scope.accountId,async sql=>{await query(sql, "UPDATE cloud_media_reservations SET launch_outcome='REFUSED' WHERE id=$1",[r!.id]);});
        r={...r,launch_outcome:"REFUSED",failure_code:error.message}; phase="ATTEMPT_TERMINATION";await finishAttempt(config,r,"FAILED");
        phase="CLEANUP";
        const clean=await cleanupCloudReservation(client,config,r);
        phase="FAILURE_SETTLEMENT";
        return {state:clean?(await settleFailedCpu(config,a)?"FAILED":"FINALIZATION_PENDING"):"RECONCILING",delaySeconds:30,observationError:diagnostic};
      }
      await updateReservation(config,r,"AMBIGUOUS"); return {state:"RECONCILING",delaySeconds:30,observationError:diagnostic};
    }
    phase="PLACEMENT_ADOPTION";
    return await adopt(client,config,r,pod,a);
  } catch(error) {
    const diagnostic=observationDiagnostic(error,phase);
    try {
      // Error messages may contain signed capabilities. Persist only fixed local codes.
      if(error instanceof Error && ["CLOUD_MEDIA_TEMPLATE_INVALID","CLOUD_MEDIA_INPUT_SIZE_INVALID","CLOUD_MEDIA_BUDGET_UNAVAILABLE"].includes(error.message)) {
        phase="ATTEMPT_TERMINATION";
        await finishAttempt(config,r ? {...r,failure_code:error.message} : {...a,id:null,leased_attempt_id:a.id,fence_id:null,failure_code:error.message},"FAILED");
        phase="CLEANUP";
        const clean=!r || await cleanupCloudReservation(client,config,r);
        phase="FAILURE_SETTLEMENT";
        if(clean && !await settleFailedCpu(config,a)) return {state:"FINALIZATION_PENDING",delaySeconds:30,observationError:diagnostic};
        return {state:clean?"FAILED":"RECONCILING",delaySeconds:30,observationError:diagnostic};
      }
      if (r && error instanceof RunPodMediaError && [400,401,402,403,404,422].includes(error.status)) {
        r={...r,failure_code:error.message};
        phase="ATTEMPT_TERMINATION";
        await finishAttempt(config,r,"FAILED");
        if(r.launch_outcome==null || r.launch_outcome==="REFUSED") {
          phase="CLEANUP";
          const clean=await cleanupCloudReservation(client,config,r);
          phase="FAILURE_SETTLEMENT";
          if(clean && !await settleFailedCpu(config,a)) return {state:"FINALIZATION_PENDING",delaySeconds:30,observationError:diagnostic};
          return {state:clean?"FAILED":"RECONCILING",delaySeconds:30,observationError:diagnostic};
        }
        phase="CLEANUP";
        await updateReservation(config,r,"STOPPING",error.message);
      }
    } catch(settlementError) {
      // A failed cleanup/settlement keeps its durable capacity fence and can be observed again.
      return {state:"RECONCILING",delaySeconds:30,observationError:observationDiagnostic(settlementError,phase)};
    }
    return {state:"RECONCILING",delaySeconds:30,observationError:diagnostic};
  }
}

async function adopt(client:RunPodMediaClient,config:HostedRuntimeConfiguration,r:Row,pod:Row,a:Row):Promise<{state:string;delaySeconds?:number}> {
  if(pod.name!==r.pod_name || typeof pod.id!=="string" || !/^[A-Za-z0-9_-]{1,80}$/u.test(pod.id)) {
    const matching=(await client.inventory()).filter(p=>p.name===r.pod_name);
    if(matching.length===1 && typeof matching[0]!.id==="string" && /^[A-Za-z0-9_-]{1,80}$/u.test(String(matching[0]!.id))) return adopt(client,config,r,matching[0]!,a);
    await updateReservation(config,r,"AMBIGUOUS");return {state:"RECONCILING",delaySeconds:30};
  }
  const owned=await tenant(config,String(r.account_id),async sql=>(await query(sql, `UPDATE cloud_media_reservations SET pod_id=$2,
    launch_outcome='CONFIRMED',actual_hourly_usd=$3,updated_at=now() WHERE id=$1 AND leased_attempt_id=$4 AND fence_id=$5
      AND state IN ('CREATING','AMBIGUOUS') RETURNING id`,
    [r.id,pod.id,Number(pod.cost)>0 ? Number(pod.cost)+Number(r.disk_gb)*.10/720 : null,r.leased_attempt_id,r.fence_id])).rows[0]);
  if(!owned) return {state:"RECONCILING",delaySeconds:30};
  r={...r,pod_id:pod.id,launch_outcome:"CONFIRMED"};
  if(!verifyCloudPlacement(pod,r)) {
    r={...r,failure_code:"CLOUD_MEDIA_PLACEMENT_REJECTED"}; await finishAttempt(config,r,"FAILED");
    const clean=await cleanupCloudReservation(client,config,r);
        return {state:clean?(await settleFailedCpu(config,a)?"FAILED":"FINALIZATION_PENDING"):"RECONCILING",delaySeconds:30};
  }
  const ready=await tenant(config,String(r.account_id),async sql=>(await query(sql,CLOUD_PLACEMENT_READY_SQL,[r.id,r.leased_attempt_id,r.fence_id])).rows[0]);
  if(!ready) {
    const expired=await tenant(config,String(r.account_id),async sql=>(await query(sql,
      `SELECT r.id AS expired_placement_reservation FROM cloud_media_reservations r
        JOIN cloud_media_budget_authorities b ON b.id=r.budget_authority_id
        WHERE r.id=$1 AND r.leased_attempt_id=$2 AND r.fence_id=$3 AND r.state IN ('CREATING','AMBIGUOUS')
          AND (r.deadline_at<=now() OR NOT b.enabled OR b.expires_at<=now())`,[r.id,r.leased_attempt_id,r.fence_id])).rows[0]);
    if(!expired) return {state:"RECONCILING",delaySeconds:30};
    r={...r,failure_code:"CLOUD_MEDIA_DEADLINE_EXCEEDED"};await finishAttempt(config,r,"FAILED");
    const clean=await cleanupCloudReservation(client,config,r);
    return {state:clean?(await settleFailedCpu(config,a)?"FAILED":"FINALIZATION_PENDING"):"RECONCILING",delaySeconds:30};
  }
  return {state:"STARTING",delaySeconds:30};
}

async function reservationForToken(request:Request,config:HostedRuntimeConfiguration,id:string):Promise<Row|null> {
  const token=request.headers.get("authorization")?.replace(/^Bearer /u,"") ?? "";
  if(!UUID.test(id) || !/^[0-9a-f]{64}$/u.test(token)) return null;
  const pool=createNeonPool(config.neon.databaseUrl);
  try {const scope=(await pool.query("SELECT * FROM videoforge_cloud_media_capability_scope($1,$2)",[id,await sha256(token)])).rows[0];
    if(!scope) return null;
    return await tenant(config,String(scope.account_id),async sql=>(await query(sql, `SELECT r.*,a.state AS attempt_state,a.kind,
      a.job_spec_object_key,a.job_spec_content_length,a.job_spec_checksum_sha256,a.deadline_at AS attempt_deadline
      FROM cloud_media_reservations r JOIN hosted_cpu_job_attempts a ON a.id=r.leased_attempt_id
      WHERE r.id=$1 AND r.capability_sha256=$2`,[id,await sha256(token)])).rows[0] ?? null);
  } finally {await pool.end();}
}

/** Size render scratch from the committed timeline, including render-only fixtures/retries. */
export async function cloudRenderDuration(environment:HostedRuntimeEnvironment,sql:SqlExecutor,a:Row,template:Row):Promise<number> {
  const input=template.input_document as Row | undefined, ref=input?.resolved_render_manifest as Row | undefined;
  if(!ref || input?.project_revision_id!==a.project_revision_id) throw new Error("CLOUD_MEDIA_MANIFEST_INVALID");
  const source=(await query(sql,"SELECT * FROM media_worker_input_objects WHERE attempt_id=$1 AND uri=$2 AND checksum_sha256=$3",
    [a.id,ref.artifact_uri,ref.sha256])).rows[0];
  const object=source && await environment.PRIVATE_ARTIFACTS?.get(String(source.object_key));
  if(!object || object.size!==Number(source?.content_length) || object.size>4_194_304) throw new Error("CLOUD_MEDIA_MANIFEST_INVALID");
  const bytes=await object.arrayBuffer();
  if(await sha256Bytes(bytes)!==ref.sha256) throw new Error("CLOUD_MEDIA_MANIFEST_INVALID");
  const {value:document}=await validateAndHashHostedContractDocument("resolvedRenderManifest",JSON.parse(new TextDecoder().decode(bytes)));
  if(document.project_revision_id!==a.project_revision_id) throw new Error("CLOUD_MEDIA_MANIFEST_INVALID");
  return Math.ceil(document.total_frames*1000*document.output.fps_den/document.output.fps_num);
}

async function cloudTemplate(environment:HostedRuntimeEnvironment,a:Row):Promise<Row> {
  const object=await environment.PRIVATE_ARTIFACTS?.get(String(a.job_spec_object_key));
  if(!object || object.size!==Number(a.job_spec_content_length) || object.size>1_048_576)
    throw new Error("CLOUD_MEDIA_TEMPLATE_INVALID");
  const bytes=await object.arrayBuffer();
  if(await sha256Bytes(bytes)!==a.job_spec_checksum_sha256) throw new Error("CLOUD_MEDIA_TEMPLATE_INVALID");
  let template:Row;
  try {template=JSON.parse(new TextDecoder().decode(bytes)) as Row;} catch {throw new Error("CLOUD_MEDIA_TEMPLATE_INVALID");}
  if(template.schema_version!=="videoforge-cloud-media-job-template/v1" ||
    template.attempt_id!==(a.leased_attempt_id ?? a.id) || template.kind!==a.kind)
    throw new Error("CLOUD_MEDIA_TEMPLATE_INVALID");
  return template;
}
function runtimeIdentity(r:Row):Row {
  return {image:r.image,registry_id:r.registry_id ?? null,source_sha256:r.source_sha256,runtime_sha256:r.runtime_sha256};
}
async function buildSpec(environment:HostedRuntimeEnvironment,config:HostedRuntimeConfiguration,r:Row):Promise<Row> {
  const fresh=await tenant(config,String(r.account_id),async sql=>(await query(sql,
    `SELECT 1 FROM cloud_media_reservations r JOIN hosted_cpu_job_attempts a ON a.id=r.leased_attempt_id
     WHERE r.id=$1 AND r.leased_attempt_id=$2 AND r.fence_id=$3 AND r.verified_at IS NOT NULL
     AND r.state IN ('STARTING','DOWNLOADING','RENDERING','CHECKING','SAVING')
     AND a.state='RUNNING' AND r.deadline_at>now() AND a.deadline_at>now()`,[r.id,r.leased_attempt_id,r.fence_id])).rows[0]);
  if(!fresh) throw new Error("CLOUD_MEDIA_LEASE_STALE");
  const template=await cloudTemplate(environment,r);
  if(!template.runtime_identity || !template.tooling || canonicalJson(template.runtime_identity)!==canonicalJson(runtimeIdentity(r)) || canonicalJson(template.tooling)!==canonicalJson(r.tooling))
    throw new Error("CLOUD_MEDIA_RUNTIME_PIN_MISMATCH");
  const inputs=await tenant(config,String(r.account_id),async sql=>(await query(sql, "SELECT * FROM media_worker_input_objects WHERE attempt_id=$1 ORDER BY uri",[r.leased_attempt_id])).rows);
  const signer=new HostedR2Signer(config.r2);
  const objects=await Promise.all(inputs.map(async input=>({uri:input.uri,sha256:input.checksum_sha256,bytes:Number(input.content_length),
    url:(await signer.sign({method:"GET",objectKey:String(input.object_key),contentType:String(input.content_type),
      contentLength:Number(input.content_length),checksumSha256:String(input.checksum_sha256),lifetimeSeconds:3600})).url})));
  const base=`${config.publicOrigin}/api/v2/cloud-media/reservations/${r.id}`;
  const scoped=(action:string)=>`${base}/${action}?attempt_id=${r.leased_attempt_id}`;
  return {schema_version:"videoforge-runpod-pod-job-spec/v1",reservation_id:r.id,runtime_sha256:r.runtime_sha256,
    source_sha256:r.source_sha256,deadline_at:new Date(String(r.deadline_at)).toISOString(),job:{
      schema_version:"videoforge-personal-worker-job-spec/v1",attempt_id:r.leased_attempt_id,kind:r.kind,
      expires_at:new Date(String(r.attempt_deadline)).toISOString(),input_document:template.input_document,objects,
      outputs:(template.outputs as Row[]).map(o=>({...o,sign_url:scoped("upload-port")})),
      result:{...template.result as Row,sign_url:scoped("upload-port")},cancellation_url:scoped("heartbeat"),
      completion_url:scoped("complete"),tooling:Object.fromEntries(["whisper_model_sha256","whisper_version","ffmpeg_version","ffprobe_version"].map(k=>[k,(r.tooling as Row)[k]]))}};
}

export async function handleCloudMediaRequest(request:Request,environment:HostedRuntimeEnvironment,
  config:HostedRuntimeConfiguration,_executionContext:HostedExecutionContext):Promise<Response|null> {
  const path=new URL(request.url).pathname;
  const match=/^\/api\/v2\/cloud-media\/reservations\/([0-9a-f-]+)\/(spec|heartbeat|upload-port|complete|cleanup|multipart\/(?:part|complete|abort))$/u.exec(path);
  if(!match) return null;
  const r=await reservationForToken(request,config,match[1]!);
  if(!r) return Response.json({error:{code:"CLOUD_MEDIA_CAPABILITY_REJECTED"}},{status:403});
  const action=match[2];
  const requestedAttempt=new URL(request.url).searchParams.get("attempt_id");
  if(requestedAttempt && requestedAttempt!==r.leased_attempt_id && action!=="complete") return new Response(null,{status:409});
  if(!requestedAttempt && !["spec","cleanup"].includes(action!)) return new Response(null,{status:409});
  if(action==="spec") {
    if(request.method!=="GET") return new Response(null,{status:405});
    if(!r.verified_at || !ACTIVE.includes(String(r.state)) || r.attempt_state!=="RUNNING" || Date.parse(String(r.deadline_at))<=Date.now() || Date.parse(String(r.attempt_deadline))<=Date.now())
      return Response.json({error:{code:"CLOUD_MEDIA_NOT_READY"}},{status:409});
    return Response.json(await buildSpec(environment,config,r));
  }
  if(request.method!=="POST") return new Response(null,{status:405});
  if(Number(request.headers.get("content-length"))>1_048_576) return new Response(null,{status:413});
  let body:Row;
  try {
    const reader=request.body?.getReader(); const chunks:Uint8Array[]=[]; let size=0;
    if(!reader) return new Response(null,{status:400});
    while(true){const part=await reader.read();if(part.done) break;size+=part.value.byteLength;
      if(size>1_048_576){await reader.cancel();return new Response(null,{status:413});}chunks.push(part.value);}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    body=JSON.parse(new TextDecoder().decode(bytes)) as Row;
  } catch{return new Response(null,{status:400});}
  if(!body || typeof body!=="object" || Array.isArray(body)) return new Response(null,{status:400});
  if(action==="complete" && requestedAttempt!==r.leased_attempt_id) {
    if(!requestedAttempt || !UUID.test(requestedAttempt)) return new Response(null,{status:409});
    const previous=await tenant(config,String(r.account_id),async sql=>(await query(sql,
      `SELECT a.* FROM hosted_cpu_job_attempts a JOIN cloud_media_jobs j ON j.attempt_id=a.id
       WHERE j.reservation_id=$1 AND a.id=$2 AND a.state='SUCCEEDED'`,[r.id,requestedAttempt])).rows[0]);
    if(!previous || body.status!=="SUCCEEDED" || body.result_object_key!==previous.result_object_key ||
      Number(body.result_content_length)!==Number(previous.result_content_length) || body.result_checksum_sha256!==previous.result_checksum_sha256)
      return new Response(null,{status:409});
    return Response.json({schema_version:"videoforge-personal-worker-completion-accepted/v1",state:"SUCCEEDED"});
  }
  if(action==="cleanup") {
    const completed=body.completed_attempt_id;
    if(completed!==undefined && !UUID.test(String(completed))) return new Response(null,{status:400});
    if(body.allow_next_span===true && completed && Number.isInteger(body.executed_span_count)) {
      if(completed===r.leased_attempt_id && r.kind==="SPAN_AUDIO" && r.attempt_state==="SUCCEEDED") {
        const attempt=await tenant(config,String(r.account_id),async sql=>(await query(sql,
          "SELECT * FROM hosted_cpu_job_attempts WHERE id=$1",[completed])).rows[0]);
        if(attempt) await finalizeMedia(environment,config,attempt);
      }
      const next=await tenant(config,String(r.account_id),async sql=>(await query(sql,
        "SELECT videoforge_claim_cloud_media_span($1,$2,$3) AS attempt_id",[r.id,completed,body.executed_span_count])).rows[0]?.attempt_id);
      if(next) {
        const fresh=await reservationForToken(request,config,String(r.id));
        if(fresh?.leased_attempt_id!==next) return new Response(null,{status:409});
        return Response.json({cleanup_requested:false,next_spec:await buildSpec(environment,config,fresh)});
      }
    }
    if(completed!==undefined && completed!==r.leased_attempt_id) return new Response(null,{status:409});
    const reason=({DEADLINE_EXCEEDED:"CLOUD_MEDIA_DEADLINE_EXCEEDED",RUNTIME_OR_STARTUP_REJECTED:"CLOUD_MEDIA_RUNTIME_REJECTED"} as Record<string,string>)[String(body.reason)];
    if(body.reason==="JOB_FINISHED" && r.state==="SAVING" && r.attempt_state==="RUNNING" && !r.failure_code) {
      await tenant(config,String(r.account_id),async sql=>{await query(sql,`UPDATE cloud_media_reservations r
        SET state='STOPPING',failure_code='CLOUD_MEDIA_RECEIPT_PENDING',updated_at=now(),next_check_at=now()
        WHERE r.id=$1 AND r.leased_attempt_id=$2 AND r.fence_id=$3 AND r.state='SAVING' AND r.failure_code IS NULL
          AND r.deadline_at>now() AND EXISTS(SELECT 1 FROM hosted_cpu_job_attempts a
            WHERE a.id=r.leased_attempt_id AND a.state='RUNNING' AND a.deadline_at>now()) RETURNING id`,
        [r.id,r.leased_attempt_id,r.fence_id]);});
    } else await updateReservation(config,r,"STOPPING",reason);
    return Response.json({cleanup_requested:true});
  }
  if(action==="complete" && r.attempt_state==="SUCCEEDED") {
    if(body.result_object_key===undefined) return new Response(null,{status:409});
    // Same immutable receipt is reconciled by the Workflow; no render is replayed.
    const a=await tenant(config,String(r.account_id),async sql=>(await query(sql, "SELECT * FROM hosted_cpu_job_attempts WHERE id=$1",[r.leased_attempt_id])).rows[0]!);
    if(body.status!=="SUCCEEDED" || body.result_object_key!==a.result_object_key || Number(body.result_content_length)!==Number(a.result_content_length) || body.result_checksum_sha256!==a.result_checksum_sha256)
      return new Response(null,{status:409});
    return Response.json({schema_version:"videoforge-personal-worker-completion-accepted/v1",state:"SUCCEEDED"});
  }
  const active=ACTIVE.includes(String(r.state)) && r.verified_at && r.attempt_state==="RUNNING" && Date.parse(String(r.deadline_at))>Date.now();
  if((action==="heartbeat" || action==="complete") && body.disk_metrics!==undefined && !validCloudDiskMetrics(body.disk_metrics))
    return new Response(null,{status:400});
  if(action==="heartbeat") {
    const phase=({DOWNLOADING_INPUTS:"DOWNLOADING",RENDERING:"RENDERING",CHECKING_VIDEO:"CHECKING",SAVING:"SAVING"} as Record<string,string>)[String(body.phase)];
    for(const [key,expected] of [["technical_verification_ms","CHECKING"],["artifact_verification_ms","SAVING"]]) {
      if(body[key!]!==undefined && (phase!==expected || !Number.isSafeInteger(body[key!]) || Number(body[key!])<0 || Number(body[key!])>14_400_000))
        return new Response(null,{status:400});
    }
    const accepted=active ? await tenant(config,String(r.account_id),async sql=>{
      const changed=await query(sql, `UPDATE cloud_media_reservations SET
      state=CASE WHEN array_position(ARRAY['STARTING','DOWNLOADING','RENDERING','CHECKING','SAVING'],state)
        <=array_position(ARRAY['STARTING','DOWNLOADING','RENDERING','CHECKING','SAVING'],$2::text) THEN $2 ELSE state END,
      last_heartbeat_at=now(),updated_at=now() WHERE id=$1 AND leased_attempt_id=$3 AND state IN ('STARTING','DOWNLOADING','RENDERING','CHECKING','SAVING')
      AND fence_id=$4
      AND EXISTS(SELECT 1 FROM hosted_cpu_job_attempts a WHERE a.id=$3 AND a.state='RUNNING') RETURNING id`,[r.id,phase ?? null,r.leased_attempt_id,r.fence_id]);
      if(changed.rows[0]) await query(sql, `UPDATE cloud_media_jobs SET
        downloading_started_at=CASE WHEN $3='DOWNLOADING' THEN COALESCE(downloading_started_at,now()) ELSE downloading_started_at END,
        rendering_started_at=CASE WHEN $3='RENDERING' THEN COALESCE(rendering_started_at,now()) ELSE rendering_started_at END,
        checking_started_at=CASE WHEN $3='CHECKING' THEN COALESCE(checking_started_at,now()) ELSE checking_started_at END,
        saving_started_at=CASE WHEN $3='SAVING' THEN COALESCE(saving_started_at,now()) ELSE saving_started_at END,
        technical_verification_ms=COALESCE(technical_verification_ms,$4),artifact_verification_ms=COALESCE(artifact_verification_ms,$5)
        WHERE reservation_id=$1 AND attempt_id=$2`,[r.id,r.leased_attempt_id,phase ?? null,body.technical_verification_ms ?? null,body.artifact_verification_ms ?? null]);
      return !!changed.rows[0] && await recordCloudDiskMetrics(sql,r,body.disk_metrics);
    }) : false;
    return Response.json({schema_version:"videoforge-personal-worker-lease-heartbeat/v1",cancel_requested:!accepted,lease_expires_in_seconds:300});
  }
  if(action==="multipart/abort") return cloudMultipart("abort",body,r,environment,config);
  if(!active) return Response.json({error:{code:"CLOUD_MEDIA_LEASE_STALE"}},{status:409});
  if(action==="upload-port") return cloudUploadPort(body,r,config);
  if(action?.startsWith("multipart/")) return cloudMultipart(action.split("/")[1]!,body,r,environment,config);
  if(action==="complete") return cloudComplete(body,r,environment,config);
  return new Response(null,{status:404});
}

async function cloudUploadPort(body:Row,r:Row,config:HostedRuntimeConfiguration):Promise<Response> {
  if(body.schema_version!=="videoforge-personal-worker-upload-authority/v1" || !["PRIMARY_RESULT_OUTPUT","RESULT_DOCUMENT"].includes(String(body.source)) ||
    !Number.isSafeInteger(body.content_length) || Number(body.content_length)<1 || !SHA256.test(String(body.checksum_sha256))) return new Response(null,{status:400});
  const callback=await deriveCallbackToken(config.workflowCallbackSecret,String(r.leased_attempt_id));
  const authority=await tenant(config,String(r.account_id),async sql=>{
    const fresh=(await query(sql, `SELECT 1 FROM cloud_media_reservations r JOIN hosted_cpu_job_attempts a ON a.id=r.leased_attempt_id
      WHERE r.id=$1 AND r.fence_id=$2 AND r.state='SAVING' AND r.deadline_at>now() AND a.state='RUNNING' FOR UPDATE OF r,a`,[r.id,r.fence_id])).rows[0];
    if(!fresh) return null;
    const accepted=await query(sql, "SELECT videoforge_authorize_hosted_cpu_upload($1,$2,$3,$4,$5,$6,$7,now()) AS authorized",
      [r.leased_attempt_id,await sha256(callback),body.source,body.object_key,body.content_type,body.content_length,body.checksum_sha256]);
    if(!accepted.rows[0]?.authorized) return null;
    return (await query(sql, "SELECT * FROM hosted_cpu_upload_authorities WHERE attempt_id=$1 AND source=$2 AND object_key=$3",[r.leased_attempt_id,body.source,body.object_key])).rows[0];
  });
  if(!authority) return new Response(null,{status:409});
  const signer=new HostedR2Signer(config.r2);
  if(Number(body.content_length)<=SINGLE_PUT_MAX_BYTES) return Response.json(await signer.sign({method:"PUT",objectKey:String(body.object_key),
    contentType:String(body.content_type),contentLength:Number(body.content_length),checksumSha256:String(body.checksum_sha256),lifetimeSeconds:300}));
  const initiated=await tenant(config,String(r.account_id),async sql=>{
    const inserted=await query(sql, `INSERT INTO cloud_media_multipart_uploads(id,account_id,workspace_id,
      reservation_id,authority_id,object_key,content_length,checksum_sha256,part_size,state)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'INITIATING') ON CONFLICT(reservation_id,authority_id) DO NOTHING RETURNING *`,
      [crypto.randomUUID(),r.account_id,r.workspace_id,r.id,authority.id,body.object_key,body.content_length,body.checksum_sha256,MULTIPART_PART_BYTES]);
    return {winner:!!inserted.rows[0],upload:inserted.rows[0] ?? (await query(sql,
      'SELECT * FROM cloud_media_multipart_uploads WHERE reservation_id=$1 AND authority_id=$2',[r.id,authority.id])).rows[0]};
  });
  const upload=initiated.upload;
  if(!upload) return new Response(null,{status:409});
  if(initiated.winner) {
    try {
      const response=await signer.multipartRequest("POST",String(upload.object_key),{uploads:""},undefined,String(body.content_type));
      const xml=await response.text();const id=/<UploadId>([^<]+)<\/UploadId>/u.exec(xml)?.[1];
      if(!response.ok || !id || /<Error[>\s]/u.test(xml)) throw new Error("CLOUD_MULTIPART_INIT_UNCERTAIN");
      await tenant(config,String(r.account_id),async sql=>{await query(sql,
        "UPDATE cloud_media_multipart_uploads SET upload_id=$2,state='OPEN' WHERE id=$1 AND state='INITIATING'",[upload.id,id]);});
      upload.upload_id=id;upload.state="OPEN";
    } catch {
      // A lost initiation response must never start a second upload for the same authority.
      await tenant(config,String(r.account_id),async sql=>{await query(sql,
        "UPDATE cloud_media_multipart_uploads SET state='UNKNOWN' WHERE id=$1 AND state='INITIATING'",[upload.id]);});
      return new Response(null,{status:502});
    }
  }
  if(!upload.upload_id || !["OPEN","COMPLETING","VERIFIED"].includes(String(upload.state))) return new Response(null,{status:409});
  const base=`${config.publicOrigin}/api/v2/cloud-media/reservations/${r.id}/multipart`;
  const scoped=(action:string)=>`${base}/${action}?attempt_id=${r.leased_attempt_id}`;
  return Response.json({method:"MULTIPART",upload_id:upload.upload_id,part_size:MULTIPART_PART_BYTES,
    part_sign_url:scoped("part"),complete_url:scoped("complete"),abort_url:scoped("abort"),
    contentLength:Number(upload.content_length),checksumSha256:upload.checksum_sha256,contentType:body.content_type});
}

async function cloudMultipart(action:string,body:Row,r:Row,environment:HostedRuntimeEnvironment,config:HostedRuntimeConfiguration):Promise<Response> {
  const upload=await tenant(config,String(r.account_id),async sql=>(await query(sql, `SELECT u.* FROM cloud_media_multipart_uploads u JOIN hosted_cpu_upload_authorities a ON a.id=u.authority_id
    WHERE u.reservation_id=$1 AND u.upload_id=$2 AND a.attempt_id=$3`,[r.id,body.upload_id,r.leased_attempt_id])).rows[0]);
  if(!upload || !environment.PRIVATE_ARTIFACTS) return new Response(null,{status:409});
  const signer=new HostedR2Signer(config.r2); const size=Number(upload.content_length);
  if(action==="part") {
    const number=Number(body.part_number), expected=Math.min(MULTIPART_PART_BYTES,size-(number-1)*MULTIPART_PART_BYTES);
    if(upload.state!=="OPEN" || !Number.isInteger(number) || number<1 || number>Math.ceil(size/MULTIPART_PART_BYTES) || Number(body.content_length)!==expected)
      return new Response(null,{status:409});
    await tenant(config,String(r.account_id),async sql=>{await query(sql,
      `INSERT INTO cloud_media_multipart_parts(account_id,workspace_id,upload_id,part_number,content_length)
       VALUES($1,$2,$3,$4,$5) ON CONFLICT(upload_id,part_number) DO NOTHING`,[r.account_id,r.workspace_id,upload.id,number,expected]);});
    return Response.json({url:await signer.signMultipartPart(String(upload.object_key),String(upload.upload_id),number),requiredHeaders:{}});
  }
  if(action==="abort") {
    if(upload.state==="VERIFIED") return Response.json({aborted:false,verified:true});
    const response=await signer.multipartRequest("DELETE",String(upload.object_key),{uploadId:String(upload.upload_id)});
    if(!response.ok && response.status!==404) return new Response(null,{status:502});
    await tenant(config,String(r.account_id),async sql=>{await query(sql, "UPDATE cloud_media_multipart_uploads SET state='ABORTED' WHERE id=$1 AND state<>'VERIFIED'",[upload.id]);});
    return Response.json({aborted:true});
  }
  if(Number(body.content_length)!==size || body.checksum_sha256!==upload.checksum_sha256 || !Array.isArray(body.parts) || body.parts.length!==Math.ceil(size/MULTIPART_PART_BYTES))
    return new Response(null,{status:409});
  const parts=body.parts as Row[];
  if(parts.some((p,i)=>p.part_number!==i+1 || typeof p.etag!=="string" || !/^"?[0-9a-f]{32}"?$/iu.test(p.etag))) return new Response(null,{status:400});
  const signedParts=await tenant(config,String(r.account_id),async sql=>(await query(sql,
    "SELECT part_number,content_length FROM cloud_media_multipart_parts WHERE upload_id=$1 ORDER BY part_number",[upload.id])).rows);
  if(signedParts.length!==parts.length || signedParts.some((p,i)=>Number(p.part_number)!==i+1 ||
    Number(p.content_length)!==Math.min(MULTIPART_PART_BYTES,size-i*MULTIPART_PART_BYTES))) return new Response(null,{status:409});
  const bucket=environment.PRIVATE_ARTIFACTS;
  const verified=async()=>{const head=await bucket.head(String(upload.object_key));
    return !!head && head.size===size && await verifyHostedObjectChecksum(bucket,String(upload.object_key),head,String(upload.checksum_sha256));};
  if(!await verified()) {
    if(!["OPEN","COMPLETING"].includes(String(upload.state))) return new Response(null,{status:409});
    await tenant(config,String(r.account_id),async sql=>{await query(sql, "UPDATE cloud_media_multipart_uploads SET state='COMPLETING' WHERE id=$1",[upload.id]);});
    const xml=`<CompleteMultipartUpload>${parts.map(p=>`<Part><PartNumber>${p.part_number}</PartNumber><ETag>${String(p.etag).replaceAll('"','&quot;')}</ETag></Part>`).join("")}</CompleteMultipartUpload>`;
    try {const response=await signer.multipartRequest("POST",String(upload.object_key),{uploadId:String(upload.upload_id)},xml,"application/xml");
      const reply=await response.text(); if(!response.ok || /<Error[>\s]/u.test(reply)) {
        if(!await verified()) return new Response(null,{status:502});
      }
    } catch {if(!await verified()) return new Response(null,{status:502});}
    if(!await verified()) return new Response(null,{status:409});
  }
  await tenant(config,String(r.account_id),async sql=>{await query(sql, "UPDATE cloud_media_multipart_uploads SET state='VERIFIED',verified_checksum_sha256=checksum_sha256 WHERE id=$1",[upload.id]);});
  return Response.json({verified:true});
}

async function cloudComplete(body:Row,r:Row,environment:HostedRuntimeEnvironment,config:HostedRuntimeConfiguration,receiptRecovery=false):Promise<Response> {
  if(body.schema_version!=="videoforge-personal-worker-completion/v1" || !["SUCCEEDED","FAILED","CANCELLED"].includes(String(body.status))) return new Response(null,{status:400});
  if(body.status!=="SUCCEEDED") {
    if(!await tenant(config,String(r.account_id),sql=>recordCloudDiskMetrics(sql,r,body.disk_metrics))) return new Response(null,{status:409});
    r={...r,failure_code:typeof body.failure_code==="string" && /^[A-Z][A-Z0-9_]{2,63}$/u.test(body.failure_code) ? body.failure_code : "CLOUD_MEDIA_FAILED"};
    await finishAttempt(config,r,String(body.status));
  } else {
    const authorities=await tenant(config,String(r.account_id),async sql=>(await query(sql, "SELECT * FROM hosted_cpu_upload_authorities WHERE attempt_id=$1 AND issued_at IS NOT NULL",[r.leased_attempt_id])).rows);
    const primary=authorities.find(a=>a.source==="PRIMARY_RESULT_OUTPUT"), result=authorities.find(a=>a.source==="RESULT_DOCUMENT"),bucket=environment.PRIVATE_ARTIFACTS;
    if(!primary || !result || !bucket || body.result_object_key!==result.object_key || Number(body.result_content_length)!==Number(result.issued_content_length) || body.result_checksum_sha256!==result.issued_checksum_sha256)
      return new Response(null,{status:409});
    const head=await receiptRead(receiptRecovery,()=>bucket.head(String(primary.object_key)));
    if(!head || head.size!==Number(primary.issued_content_length) || head.httpMetadata?.contentType!==primary.content_type ||
      !await receiptRead(receiptRecovery,()=>verifyHostedObjectChecksum(bucket,String(primary.object_key),head,String(primary.issued_checksum_sha256)))) return new Response(null,{status:409});
    // Match the desktop JSON boundary before publishing success; downstream terminal logic retains its exact input gates.
    try {
      const object=await receiptRead(receiptRecovery,()=>bucket.get(String(result.object_key)));
      if(!object || object.size!==Number(result.issued_content_length) || object.size>1_048_576 ||
        object.httpMetadata?.contentType!=="application/json") return new Response(null,{status:409});
      const bytes=await receiptRead(receiptRecovery,()=>object.arrayBuffer());
      if(bytes.byteLength!==object.size || await sha256Bytes(bytes)!==result.issued_checksum_sha256) return new Response(null,{status:409});
      const document=JSON.parse(new TextDecoder("utf-8",{fatal:true,ignoreBOM:false}).decode(bytes)) as Row;
      const template=await receiptRead(receiptRecovery,()=>cloudTemplate(environment,r)),input=template.input_document as Row;
      if(!document || typeof document!=="object" || Array.isArray(document) || document.attempt_id!==r.leased_attempt_id ||
        document.status!=="SUCCEEDED" || document.error!==null || !input || typeof input!=="object") return new Response(null,{status:409});
      if(r.kind==="ASR") {
        const parsed=await validateAndHashHostedContractDocument("asrJobResult",document);
        if(parsed.value.status!=="SUCCEEDED" || !parsed.value.transcript || parsed.value.source_voiceover_sha256!==(input.voiceover as Row)?.sha256 || parsed.value.model_sha256!==(input.model as Row)?.sha256 ||
          parsed.value.transcript.project_revision_id!==input.project_revision_id || parsed.value.transcript.source.asset_id!==(input.voiceover as Row)?.asset_id ||
          parsed.value.transcript.source.duration_ms!==(input.voiceover as Row)?.duration_ms) return new Response(null,{status:409});
        // The primary file and callback receipt can serialize the same ASR document differently.
        // Bind both separately to their uploaded bytes, then compare validated contract semantics.
        const primaryObject=await receiptRead(receiptRecovery,()=>bucket.get(String(primary.object_key)));
        if(!primaryObject || primaryObject.size!==Number(primary.issued_content_length) ||
          !Number.isSafeInteger(Number(primary.max_bytes)) ||
          primaryObject.size>16_777_216 || primaryObject.size>Number(primary.max_bytes) ||
          primaryObject.httpMetadata?.contentType!=="application/json") return new Response(null,{status:409});
        const primaryBytes=await receiptRead(receiptRecovery,()=>primaryObject.arrayBuffer());
        if(primaryBytes.byteLength!==primaryObject.size || await sha256Bytes(primaryBytes)!==primary.issued_checksum_sha256)
          return new Response(null,{status:409});
        const primaryDocument=JSON.parse(new TextDecoder("utf-8",{fatal:true,ignoreBOM:false}).decode(primaryBytes));
        const parsedPrimary=await validateAndHashHostedContractDocument("asrJobResult",primaryDocument);
        if(parsedPrimary.sha256!==parsed.sha256) return new Response(null,{status:409});
      } else if(r.kind==="RENDER") {
        const parsed=await validateAndHashHostedContractDocument("renderJobResult",document);
        if(parsed.value.status!=="SUCCEEDED" ||
          parsed.value.output.sha256!==primary.issued_checksum_sha256 || parsed.value.output.bytes!==Number(primary.issued_content_length)) return new Response(null,{status:409});
      } else if(r.kind==="SPAN_AUDIO") {
        const audio=document.audio as Row,source={...(input.source_voiceover as Row)};delete source.artifact_uri;
        if(document.schema_version!=="selected-span-audio-result/v1" || !audio || typeof audio!=="object" || Array.isArray(audio) ||
          Object.keys(document).sort().join(",")!=="attempt_id,audio,error,schema_version,selection,source_voiceover,span_id,status,task_key,timeline_plan_id,timeline_segment_id,transcript_id" ||
          Object.keys(audio).sort().join(",")!=="artifact_uri,asset_id,byte_size,channels,content_type,duration_ms,sample_rate_hz,sha256" ||
          ["span_id","timeline_plan_id","transcript_id","timeline_segment_id","task_key"].some(key=>document[key]!==input[key]) ||
          canonicalJson(document.source_voiceover)!==canonicalJson(source) || canonicalJson(document.selection)!==canonicalJson(input.selection) ||
          audio.asset_id!==(input.output as Row)?.asset_id || audio.sha256!==primary.issued_checksum_sha256 ||
          audio.byte_size!==Number(primary.issued_content_length) || audio.content_type!=="audio/wav" ||
          audio.sample_rate_hz!==48000 || audio.channels!==1 || audio.duration_ms!==Number((input.selection as Row)?.padded_end_ms_exclusive)-Number((input.selection as Row)?.padded_start_ms) ||
          audio.artifact_uri!==`vf-local://objects/sha256/${String(audio.sha256).slice(7,9)}/${String(audio.sha256).slice(7)}.wav`) return new Response(null,{status:409});
      } else return new Response(null,{status:409});
    } catch(error) {if(error instanceof ReceiptStorageError) throw error;return new Response(null,{status:409});}
    // Recheck the exact fence after verification; cancellation must win over a stale publication.
    const fresh=await tenant(config,String(r.account_id),async sql=>(await query(sql, `SELECT 1 FROM cloud_media_reservations r JOIN hosted_cpu_job_attempts a ON a.id=r.leased_attempt_id
      WHERE r.id=$1 AND r.fence_id=$2 AND r.leased_attempt_id=$3 AND
      (r.state='SAVING' OR ($4::boolean AND r.state='STOPPING' AND r.failure_code='CLOUD_MEDIA_RECEIPT_PENDING'))
      AND r.deadline_at>now() AND a.deadline_at>now() AND a.state='RUNNING'`,[r.id,r.fence_id,r.leased_attempt_id,receiptRecovery])).rows[0]);
    if(!fresh) return new Response(null,{status:409});
    if(!await tenant(config,String(r.account_id),sql=>recordCloudDiskMetrics(sql,r,body.disk_metrics))) return new Response(null,{status:409});
    if (!await finishAttempt(config,r,"SUCCEEDED",{key:String(result.object_key),size:Number(result.issued_content_length),checksum:String(result.issued_checksum_sha256)},receiptRecovery)) return new Response(null,{status:409});
  }
  return Response.json({schema_version:"videoforge-personal-worker-completion-accepted/v1",state:body.status});
}

/** External safety sweep; only exact reservation ownership is eligible for cleanup. */
export async function reconcileCloudMediaReservations(environment:HostedRuntimeEnvironment):Promise<number> {
  const qualificationOnly=cloudMediaQualificationOnly(environment);
  const {hostedRuntimeConfiguration}=await import("./configuration"); const config=hostedRuntimeConfiguration(environment);
  const pool=createNeonPool(config.neon.databaseUrl);
  try {const rows=(await pool.query("SELECT * FROM videoforge_cloud_media_reconciliation_scope()")).rows;
    let observed=0;
    for(const row of rows) {
      if(qualificationOnly && !await tenant(config,String(row.account_id),async sql=>(await query(sql,
        `SELECT r.id FROM cloud_media_reservations r JOIN cloud_media_jobs j ON j.reservation_id=r.id
          WHERE j.attempt_id=$1 AND r.budget_authority_id=$2`,[row.attempt_id,environment.VIDEOFORGE_CLOUD_MEDIA_BUDGET_AUTHORITY_ID])).rows[0])) continue;
      const outcome=await runCloudMediaObservation(environment,config,{attemptId:String(row.attempt_id),accountId:String(row.account_id),workspaceId:String(row.workspace_id)});
      if(outcome.observationError) console.warn("CLOUD_MEDIA_OBSERVATION_ERROR",outcome.observationError.phase,outcome.observationError.code);
      observed++;
    }
    return observed;
  } finally {await pool.end();}
}

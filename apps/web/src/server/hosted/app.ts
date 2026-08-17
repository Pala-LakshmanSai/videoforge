import { createHostedAuth, type HostedExecutionContext } from "./auth";
import { hostedRuntimeConfiguration, type HostedRuntimeEnvironment } from "./configuration";
import { sha256, sha256Bytes } from "./crypto";
import { createNeonExecutor, createNeonPool } from "./neon";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const EXECUTION =
  /^projects\/[a-z][a-z0-9-]{4,62}\/locations\/[a-z0-9-]+\/jobs\/[a-z][a-z0-9-]{0,62}\/executions\/[A-Za-z0-9._-]+$/u;

export function hasExactResultObjectMetadata(
  object: { readonly size: number; readonly httpMetadata?: { readonly contentType?: string } },
  expectedLength: number,
): boolean {
  return object.size === expectedLength && object.httpMetadata?.contentType === "application/json";
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
      "x-content-type-options": "nosniff",
      "x-videoforge-runtime": "hosted-v2-06",
    },
  });
}

function exactCallback(value: unknown): {
  status: "SUCCEEDED" | "FAILED" | "CANCELLED";
  executionName: string;
  resultObjectKey: string | null;
  resultContentLength: number | null;
  resultChecksumSha256: string | null;
} | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const keys = Object.keys(value).sort();
  if (
    keys.join(",") !==
    "execution_name,result_checksum_sha256,result_content_length,result_object_key,schema_version,status"
  )
    return null;
  const record = value as Record<string, unknown>;
  if (
    record.schema_version !== "videoforge-cloud-run-callback/v1" ||
    !["SUCCEEDED", "FAILED", "CANCELLED"].includes(String(record.status)) ||
    typeof record.execution_name !== "string" ||
    !EXECUTION.test(record.execution_name) ||
    (record.result_checksum_sha256 !== null &&
      (typeof record.result_checksum_sha256 !== "string" ||
        !SHA256.test(record.result_checksum_sha256))) ||
    (record.status === "SUCCEEDED" &&
      (typeof record.result_object_key !== "string" ||
        typeof record.result_content_length !== "number" ||
        !Number.isSafeInteger(record.result_content_length) ||
        record.result_content_length < 1 ||
        typeof record.result_checksum_sha256 !== "string")) ||
    (record.status !== "SUCCEEDED" &&
      (record.result_object_key !== null ||
        record.result_content_length !== null ||
        record.result_checksum_sha256 !== null))
  )
    return null;
  return {
    status: record.status as "SUCCEEDED" | "FAILED" | "CANCELLED",
    executionName: record.execution_name,
    resultObjectKey: record.result_object_key as string | null,
    resultContentLength: record.result_content_length as number | null,
    resultChecksumSha256: record.result_checksum_sha256 as string | null,
  };
}

async function handleCpuCallback(
  request: Request,
  environment: HostedRuntimeEnvironment,
  attemptId: string,
): Promise<Response> {
  if (!UUID.test(attemptId)) return json({ error: { code: "CALLBACK_REJECTED" } }, 404);
  const length = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(length) || length < 1 || length > 1_048_576) {
    return json({ error: { code: "CALLBACK_REJECTED" } }, 400);
  }
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ") || authorization.length > 512) {
    return json({ error: { code: "CALLBACK_REJECTED" } }, 401);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: { code: "CALLBACK_REJECTED" } }, 400);
  }
  const callback = exactCallback(body);
  if (!callback) return json({ error: { code: "CALLBACK_REJECTED" } }, 400);
  const tokenSha256 = await sha256(authorization.slice("Bearer ".length));
  const factsSha256 = await sha256(
    JSON.stringify({
      execution_name: callback.executionName,
      result_checksum_sha256: callback.resultChecksumSha256,
      result_content_length: callback.resultContentLength,
      result_object_key: callback.resultObjectKey,
      schema_version: "videoforge-cloud-run-callback/v1",
      status: callback.status,
    }),
  );
  const config = hostedRuntimeConfiguration(environment);
  const pool = createNeonPool(config.neon.databaseUrl);
  try {
    let receiptSha256: string | null = null;
    if (callback.status === "SUCCEEDED") {
      const bucket = environment.PRIVATE_ARTIFACTS;
      if (
        !bucket ||
        !callback.resultObjectKey ||
        !callback.resultChecksumSha256 ||
        callback.resultContentLength === null
      ) {
        return json({ error: { code: "CALLBACK_REJECTED" } }, 404);
      }
      const object = await bucket.get(callback.resultObjectKey);
      if (!object) return json({ error: { code: "CALLBACK_REJECTED" } }, 404);
      if (!hasExactResultObjectMetadata(object, callback.resultContentLength)) {
        return json({ error: { code: "CALLBACK_REJECTED" } }, 404);
      }
      const bytes = await object.arrayBuffer();
      if (bytes.byteLength !== callback.resultContentLength)
        return json({ error: { code: "CALLBACK_REJECTED" } }, 404);
      const binaryHash = await sha256Bytes(bytes);
      if (binaryHash !== callback.resultChecksumSha256)
        return json({ error: { code: "CALLBACK_REJECTED" } }, 404);
      receiptSha256 = await sha256(
        JSON.stringify({
          attempt_id: attemptId,
          content_length: callback.resultContentLength,
          object_key: callback.resultObjectKey,
          result_checksum_sha256: callback.resultChecksumSha256,
        }),
      );
    }
    const accepted = await pool.query(
      `SELECT videoforge_accept_hosted_cpu_callback($1, $2, $3, $4, $5, $6, $7, $8, $9, now()) AS accepted`,
      [
        attemptId,
        tokenSha256,
        callback.executionName,
        callback.status,
        callback.resultObjectKey,
        callback.resultContentLength,
        callback.resultChecksumSha256,
        receiptSha256,
        factsSha256,
      ],
    );
    if (accepted.rows[0]?.accepted !== true)
      return json({ error: { code: "CALLBACK_REJECTED" } }, 404);
    // The durable row is the callback hint. Polling remains authoritative, so
    // acceptance never depends on transient Workflow event delivery.
    return json({ accepted: true }, 202);
  } finally {
    await pool.end();
  }
}

async function hostedSession(
  request: Request,
  config: ReturnType<typeof hostedRuntimeConfiguration>,
  pool: ReturnType<typeof createNeonPool>,
  executionContext: HostedExecutionContext,
) {
  const auth = createHostedAuth({ config, pool, executionContext });
  return auth.api.getSession({ headers: request.headers });
}

async function handleTenantApi(
  request: Request,
  config: ReturnType<typeof hostedRuntimeConfiguration>,
  executionContext: HostedExecutionContext,
): Promise<Response> {
  const pool = createNeonPool(config.neon.databaseUrl);
  try {
    const session = await hostedSession(request, config, pool, executionContext);
    if (!session?.user?.id) return json({ error: { code: "AUTHENTICATION_REQUIRED" } }, 401);
    const scope = await pool.query(`SELECT * FROM videoforge_hosted_session_scope($1)`, [
      session.session.token,
    ]);
    const row = scope.rows[0];
    if (!row) return json({ error: { code: "INVITE_ADMISSION_REQUIRED" } }, 403);
    await pool.query("SELECT set_config($1, $2, false)", ["videoforge.account_id", row.account_id]);
    const workspace = await pool.query(`SELECT name FROM workspaces WHERE id = $1`, [
      row.workspace_id,
    ]);
    return json({
      schema_version: "videoforge-hosted-tenant/v1",
      account_id: row.account_id,
      workspace_id: row.workspace_id,
      workspace_name: workspace.rows[0]?.name ?? "My workspace",
      user: { id: session.user.id, email: session.user.email, name: session.user.name },
      rights: "EQUAL",
    });
  } finally {
    await pool.end();
  }
}

async function handleCpuAttemptApi(
  request: Request,
  config: ReturnType<typeof hostedRuntimeConfiguration>,
  executionContext: HostedExecutionContext,
  attemptId: string,
): Promise<Response> {
  if (!UUID.test(attemptId)) return json({ error: { code: "CPU_ATTEMPT_NOT_FOUND" } }, 404);
  const pool = createNeonPool(config.neon.databaseUrl);
  try {
    const session = await hostedSession(request, config, pool, executionContext);
    if (!session?.user?.id) return json({ error: { code: "AUTHENTICATION_REQUIRED" } }, 401);
    const scope = await pool.query(`SELECT account_id FROM videoforge_hosted_session_scope($1)`, [
      session.session.token,
    ]);
    const accountId = scope.rows[0]?.account_id;
    if (typeof accountId !== "string")
      return json({ error: { code: "INVITE_ADMISSION_REQUIRED" } }, 403);
    if (request.method === "POST") {
      const row = await createNeonExecutor(pool).transaction(async (transaction) => {
        await transaction.query("SELECT set_config($1, $2, true)", [
          "videoforge.account_id",
          accountId,
        ]);
        const updated = await transaction.query<{
          id: string;
          account_id: string;
          workspace_id: string;
          state: string;
          version: number;
        }>(
          `UPDATE hosted_cpu_job_attempts
              SET state = 'CANCEL_REQUESTED', cancellation_requested_at = now(), poll_after = now(),
                  version = version + 1, updated_at = now()
            WHERE id = $1 AND state IN ('OUTBOXED', 'SUBMITTED', 'RUNNING', 'RECONCILING')
          RETURNING id, account_id, workspace_id, state, version`,
          [attemptId],
        );
        const changed = updated.rows[0];
        if (!changed) return null;
        await transaction.query(
          `INSERT INTO hosted_cpu_job_events (
             id, account_id, workspace_id, attempt_id, sequence, kind, facts_sha256, occurred_at
           ) SELECT md5($1 || ':cancel:' || (COALESCE(max(sequence), 0) + 1)::text)::uuid,
                    $2, $3, $1, COALESCE(max(sequence), 0) + 1, 'CANCEL_REQUESTED',
                    $4, now()
               FROM hosted_cpu_job_events
              WHERE account_id = $2 AND workspace_id = $3 AND attempt_id = $1`,
          [
            attemptId,
            changed.account_id,
            changed.workspace_id,
            await sha256(`CANCEL_REQUESTED:${attemptId}`),
          ],
        );
        return changed;
      });
      if (!row) return json({ error: { code: "CPU_ATTEMPT_NOT_CANCELLABLE" } }, 409);
      return json(
        {
          schema_version: "videoforge-hosted-cpu-attempt/v1",
          id: row.id,
          state: row.state,
          version: row.version,
        },
        202,
      );
    }
    await pool.query("SELECT set_config($1, $2, false)", ["videoforge.account_id", accountId]);
    const result = await pool.query(
      `SELECT id, kind, state, version, deadline_at, retain_until, result_receipt_sha256,
              result_content_length, result_checksum_sha256
         FROM hosted_cpu_job_attempts WHERE id = $1`,
      [attemptId],
    );
    if (!result.rows[0]) return json({ error: { code: "CPU_ATTEMPT_NOT_FOUND" } }, 404);
    return json({ schema_version: "videoforge-hosted-cpu-attempt/v1", ...result.rows[0] });
  } finally {
    await pool.end();
  }
}

export async function startHostedCpuWorkflow(
  environment: HostedRuntimeEnvironment,
  params: { readonly attemptId: string; readonly accountId: string; readonly workspaceId: string },
): Promise<{ readonly id: string }> {
  if (
    ![params.attemptId, params.accountId, params.workspaceId].every((value) => UUID.test(value))
  ) {
    throw new TypeError("Hosted workflow launch requires exact UUID lineage.");
  }
  const workflow = environment.VIDEO_WORKFLOW;
  if (!workflow) throw new Error("Hosted Workflow binding is unavailable.");
  return workflow.create({ id: params.attemptId, params });
}

export async function handleHostedRequest(
  request: Request,
  environment: HostedRuntimeEnvironment,
  executionContext: HostedExecutionContext,
): Promise<Response> {
  let config;
  try {
    config = hostedRuntimeConfiguration(environment);
  } catch {
    return json({ error: { code: "HOSTED_CONFIGURATION_INVALID", retryable: false } }, 503);
  }
  const url = new URL(request.url);
  if (
    request.method === "POST" &&
    url.pathname.startsWith("/api/v2/internal/cloud-run/callback/")
  ) {
    return handleCpuCallback(request, environment, url.pathname.split("/").at(-1) ?? "");
  }
  if (url.pathname.startsWith("/api/auth/")) {
    const pool = createNeonPool(config.neon.databaseUrl);
    try {
      return await createHostedAuth({ config, pool, executionContext }).handler(request);
    } finally {
      await pool.end();
    }
  }
  if (request.method === "GET" && url.pathname === "/api/v2/hosted/status") {
    return json({
      schema_version: "videoforge-hosted-status/v1",
      commit: config.commit,
      environment: "staging",
      gpu_transport: "DISABLED_FAKE_ONLY",
      database: "NEON_POSTGRES_REQUIRED",
      artifact_plane: "PRIVATE_R2_REQUIRED",
      orchestration: "CLOUDFLARE_WORKFLOW_REQUIRED",
      cpu_jobs: "CLOUD_RUN_JOBS_REQUIRED",
    });
  }
  if (request.method === "GET" && url.pathname === "/api/v2/tenant") {
    return handleTenantApi(request, config, executionContext);
  }
  const attemptMatch = /^\/api\/v2\/cpu-attempts\/([0-9a-f-]+)$/u.exec(url.pathname);
  if (attemptMatch && (request.method === "GET" || request.method === "POST")) {
    return handleCpuAttemptApi(request, config, executionContext, attemptMatch[1]!);
  }
  if (url.pathname.startsWith("/api/")) {
    return json(
      {
        error: {
          code: "HOSTED_ROUTE_NOT_COMPOSED",
          message:
            "The requested hosted application route is not part of the V2-06 adapter surface.",
          retryable: false,
        },
      },
      503,
    );
  }
  if (!environment.ASSETS) return json({ error: { code: "HOSTED_ASSETS_UNAVAILABLE" } }, 503);
  return environment.ASSETS.fetch(request);
}

import { createHostedAuth, type HostedExecutionContext } from "./auth";
import { hostedRuntimeConfiguration, type HostedRuntimeEnvironment } from "./configuration";
import { deriveCallbackToken, sha256, sha256Bytes } from "./crypto";
import { createNeonExecutor, createNeonPool } from "./neon";
import { HostedR2Signer } from "./r2";
import {
  bindHostedCpuInputDocument,
  canonicalJson,
  exactHostedCpuSubmission,
  whisperModelUri,
} from "./submission";

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

function checksumFromR2(value: ArrayBuffer | undefined): string | null {
  if (!value || value.byteLength !== 32) return null;
  return `sha256:${[...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

interface CpuUploadAuthorityRequest {
  readonly source: "PRIMARY_RESULT_OUTPUT" | "RESULT_DOCUMENT";
  readonly objectKey: string;
  readonly contentType: string;
  readonly contentLength: number;
  readonly checksumSha256: string;
}

export function exactCpuUploadAuthorityRequest(value: unknown): CpuUploadAuthorityRequest | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !==
      "checksum_sha256,content_length,content_type,object_key,schema_version,source" ||
    record.schema_version !== "videoforge-cloud-run-upload-authority/v1" ||
    !["PRIMARY_RESULT_OUTPUT", "RESULT_DOCUMENT"].includes(String(record.source)) ||
    typeof record.object_key !== "string" ||
    typeof record.content_type !== "string" ||
    !Number.isSafeInteger(record.content_length) ||
    (record.content_length as number) < 1 ||
    typeof record.checksum_sha256 !== "string" ||
    !SHA256.test(record.checksum_sha256)
  ) {
    return null;
  }
  return {
    source: record.source as CpuUploadAuthorityRequest["source"],
    objectKey: record.object_key,
    contentType: record.content_type,
    contentLength: record.content_length as number,
    checksumSha256: record.checksum_sha256,
  };
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
      const primary = await pool.query(
        `SELECT * FROM videoforge_hosted_cpu_expected_primary_output($1, $2)`,
        [attemptId, tokenSha256],
      );
      if (primary.rows.length !== 1) {
        return json({ error: { code: "CALLBACK_REJECTED" } }, 404);
      }
      const expectedPrimary = primary.rows[0]!;
      const primaryObject = await bucket.head(expectedPrimary.object_key);
      if (
        !primaryObject ||
        primaryObject.size !== Number(expectedPrimary.content_length) ||
        primaryObject.httpMetadata?.contentType !== expectedPrimary.content_type ||
        checksumFromR2(primaryObject.checksums?.sha256) !== expectedPrimary.checksum_sha256
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

async function handleCpuUploadPort(
  request: Request,
  environment: HostedRuntimeEnvironment,
  attemptId: string,
): Promise<Response> {
  if (!UUID.test(attemptId)) return json({ error: { code: "UPLOAD_AUTHORITY_REJECTED" } }, 404);
  const length = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(length) || length < 1 || length > 16_384) {
    return json({ error: { code: "UPLOAD_AUTHORITY_REJECTED" } }, 400);
  }
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ") || authorization.length > 512) {
    return json({ error: { code: "UPLOAD_AUTHORITY_REJECTED" } }, 401);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: { code: "UPLOAD_AUTHORITY_REJECTED" } }, 400);
  }
  const authority = exactCpuUploadAuthorityRequest(body);
  if (!authority) return json({ error: { code: "UPLOAD_AUTHORITY_REJECTED" } }, 400);
  const config = hostedRuntimeConfiguration(environment);
  const pool = createNeonPool(config.neon.databaseUrl);
  try {
    const authorized = await pool.query(
      `SELECT videoforge_authorize_hosted_cpu_upload($1,$2,$3,$4,$5,$6,$7,now()) AS authorized`,
      [
        attemptId,
        await sha256(authorization.slice("Bearer ".length)),
        authority.source,
        authority.objectKey,
        authority.contentType,
        authority.contentLength,
        authority.checksumSha256,
      ],
    );
    if (authorized.rows[0]?.authorized !== true) {
      return json({ error: { code: "UPLOAD_AUTHORITY_REJECTED" } }, 404);
    }
    const port = await new HostedR2Signer(config.r2).sign({
      method: "PUT",
      objectKey: authority.objectKey,
      contentType: authority.contentType,
      contentLength: authority.contentLength,
      checksumSha256: authority.checksumSha256,
      lifetimeSeconds: 300,
    });
    return json({ schema_version: "videoforge-cloud-run-upload-port/v1", ...port });
  } finally {
    await pool.end();
  }
}

async function handleCpuCancellationProbe(
  request: Request,
  environment: HostedRuntimeEnvironment,
  attemptId: string,
): Promise<Response> {
  if (!UUID.test(attemptId)) return json({ cancelled: true }, 404);
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ") || authorization.length > 512) {
    return json({ cancelled: true }, 401);
  }
  const config = hostedRuntimeConfiguration(environment);
  const pool = createNeonPool(config.neon.databaseUrl);
  try {
    const result = await pool.query(
      `SELECT videoforge_hosted_cpu_cancellation_requested($1, $2) AS cancelled`,
      [attemptId, await sha256(authorization.slice("Bearer ".length))],
    );
    const cancelled = result.rows[0]?.cancelled;
    if (typeof cancelled !== "boolean") return json({ cancelled: true }, 404);
    return json({ cancelled });
  } finally {
    await pool.end();
  }
}

interface OwnedArtifactRow extends Record<string, unknown> {
  readonly id: string;
  readonly object_key: string;
  readonly content_type: string;
  readonly content_length: string | number;
  readonly checksum_sha256: string;
}

async function handleCpuSubmission(
  request: Request,
  environment: HostedRuntimeEnvironment,
  config: ReturnType<typeof hostedRuntimeConfiguration>,
  executionContext: HostedExecutionContext,
): Promise<Response> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isSafeInteger(length) || length < 1 || length > 1_048_576) {
    return json({ error: { code: "CPU_SUBMISSION_REJECTED" } }, 400);
  }
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: { code: "CPU_SUBMISSION_REJECTED" } }, 400);
  }
  const submission = exactHostedCpuSubmission(raw);
  if (!submission) return json({ error: { code: "CPU_SUBMISSION_REJECTED" } }, 400);
  const pool = createNeonPool(config.neon.databaseUrl);
  try {
    const session = await hostedSession(request, config, pool, executionContext);
    if (!session?.user?.id) return json({ error: { code: "AUTHENTICATION_REQUIRED" } }, 401);
    const scopeResult = await pool.query(`SELECT * FROM videoforge_hosted_session_scope($1)`, [
      session.session.token,
    ]);
    const scope = scopeResult.rows[0];
    if (!scope) return json({ error: { code: "INVITE_ADMISSION_REQUIRED" } }, 403);

    const imageDigest =
      submission.kind === "ASR"
        ? config.cloudRun.asrImageDigest
        : config.cloudRun.renderImageDigest;
    const requestSha256 = await sha256(canonicalJson(submission));
    const executor = createNeonExecutor(pool);
    const prepared = await executor.transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1, $2, true)", [
        "videoforge.account_id",
        scope.account_id,
      ]);
      const lineage = await transaction.query(
        `SELECT 1
           FROM projects AS project
           JOIN project_revisions AS revision
             ON revision.account_id = project.account_id
            AND revision.workspace_id = project.workspace_id
            AND revision.project_id = project.id
          WHERE project.account_id = $1 AND project.workspace_id = $2 AND project.id = $3
            AND revision.id = $4 AND revision.status = 'LOCKED'`,
        [scope.account_id, scope.workspace_id, submission.projectId, submission.projectRevisionId],
      );
      if (!lineage.rows[0]) return null;
      const receiptIds = submission.objects.map((object) => object.receiptId);
      const artifacts = await transaction.query<OwnedArtifactRow>(
        `SELECT receipt.id, receipt.object_key, receipt.content_type, receipt.content_length,
                receipt.checksum_sha256
           FROM artifact_receipts AS receipt
           JOIN artifact_reservations AS reservation
             ON reservation.account_id = receipt.account_id
            AND reservation.workspace_id = receipt.workspace_id
            AND reservation.id = receipt.reservation_id
          WHERE receipt.account_id = $1 AND receipt.workspace_id = $2
            AND receipt.id = ANY($3::uuid[]) AND receipt.deleted_at IS NULL
            AND reservation.project_id = $4 AND reservation.project_revision_id = $5
            AND reservation.state = 'COMMITTED'`,
        [
          scope.account_id,
          scope.workspace_id,
          receiptIds,
          submission.projectId,
          submission.projectRevisionId,
        ],
      );
      if (artifacts.rows.length !== receiptIds.length) return null;

      const existing = await transaction.query<{
        id: string;
        request_sha256: string;
        image_digest: string;
        state: string;
      }>(
        `SELECT id, request_sha256, image_digest, state FROM hosted_cpu_job_attempts
          WHERE account_id = $1 AND workspace_id = $2 AND submission_idempotency_key = $3`,
        [scope.account_id, scope.workspace_id, submission.idempotencyKey],
      );
      let attemptId = existing.rows[0]?.id;
      if (
        existing.rows[0] &&
        (existing.rows[0].request_sha256 !== requestSha256 ||
          existing.rows[0].image_digest !== imageDigest)
      ) {
        throw new Error("CPU_SUBMISSION_IDEMPOTENCY_CONFLICT");
      }
      attemptId ??= crypto.randomUUID();
      if (existing.rows[0] && existing.rows[0].state !== "PLANNED") {
        return {
          attemptId,
          replay: true as const,
          state: existing.rows[0].state,
        };
      }
      const lane = submission.kind === "ASR" ? "input" : "render";
      const prefix = `tenant/${scope.account_id}/workspace/${scope.workspace_id}/project/${submission.projectId}/revision/${submission.projectRevisionId}/lane/${lane}/job/${attemptId}/artifact`;
      const jobSpecKey = `${prefix}/job-spec`;
      const primaryKey = `${prefix}/${submission.kind === "ASR" ? "transcript" : "final-mp4"}`;
      const resultKey = `${prefix}/result-document`;
      const callbackToken = await deriveCallbackToken(config.workflowCallbackSecret, attemptId);
      const inputDocument = bindHostedCpuInputDocument(
        submission.inputDocument,
        submission.kind,
        submission.projectRevisionId,
        attemptId,
      );
      const artifactById = new Map(artifacts.rows.map((artifact) => [artifact.id, artifact]));
      const signer = new HostedR2Signer(config.r2);
      const objects = await Promise.all(
        submission.objects.map(async (object) => {
          const artifact = artifactById.get(object.receiptId)!;
          const port = await signer.sign({
            method: "GET",
            objectKey: artifact.object_key,
            contentType: artifact.content_type,
            contentLength: Number(artifact.content_length),
            checksumSha256: artifact.checksum_sha256,
            lifetimeSeconds: 900,
          });
          return {
            uri: object.uri,
            url: port.url,
            sha256: artifact.checksum_sha256,
            bytes: Number(artifact.content_length),
          };
        }),
      );
      const primaryType = submission.kind === "ASR" ? "application/json" : "video/mp4";
      const primaryMax = submission.kind === "ASR" ? 16 * 1024 ** 2 : 10 * 1024 ** 3;
      const signBase = `${config.publicOrigin}/api/v2/internal/cloud-run/upload-port/${attemptId}`;
      const jobSpec = {
        schema_version: "videoforge-cloud-run-job-spec/v1",
        attempt_id: attemptId,
        kind: submission.kind,
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        input_document: inputDocument,
        objects,
        outputs: [
          {
            source: "PRIMARY_RESULT_OUTPUT",
            object_key: primaryKey,
            sign_url: signBase,
            content_type: primaryType,
            max_bytes: primaryMax,
          },
        ],
        result: { object_key: resultKey, sign_url: signBase, max_bytes: 1_048_576 },
        cancellation_url: `${config.publicOrigin}/api/v2/internal/cloud-run/cancelled/${attemptId}`,
        tooling: {
          whisper_model_uri:
            submission.kind === "ASR"
              ? whisperModelUri(inputDocument)
              : "vf-local://objects/sha256/00/0000000000000000000000000000000000000000000000000000000000000000.bin",
          whisper_version: "1.8.4",
          ffmpeg_version: "8.1.2",
          ffprobe_version: "8.1.2",
        },
      };
      if (
        submission.kind === "ASR" &&
        !objects.some((object) => object.uri === jobSpec.tooling.whisper_model_uri)
      ) {
        throw new TypeError("Hosted ASR submission does not include the pinned model artifact.");
      }
      const jobSpecBytes = new TextEncoder().encode(canonicalJson(jobSpec));
      if (jobSpecBytes.byteLength > 1_048_576) throw new Error("CPU_JOB_SPEC_TOO_LARGE");
      const jobSpecChecksum = await sha256Bytes(jobSpecBytes);
      if (!existing.rows[0]) {
        await transaction.query(
          `INSERT INTO hosted_cpu_job_attempts (
             id, account_id, workspace_id, project_id, project_revision_id, kind, state,
             submission_idempotency_key, request_sha256, job_spec_object_key,
             job_spec_content_length, job_spec_checksum_sha256, result_object_key,
             result_max_bytes, image_digest, callback_token_sha256, deadline_at
           ) VALUES ($1,$2,$3,$4,$5,$6,'PLANNED',$7,$8,$9,$10,$11,$12,1048576,$13,$14,now() + interval '24 hours')`,
          [
            attemptId,
            scope.account_id,
            scope.workspace_id,
            submission.projectId,
            submission.projectRevisionId,
            submission.kind,
            submission.idempotencyKey,
            requestSha256,
            jobSpecKey,
            jobSpecBytes.byteLength,
            jobSpecChecksum,
            resultKey,
            imageDigest,
            await sha256(callbackToken),
          ],
        );
        await transaction.query(
          `INSERT INTO hosted_cpu_upload_authorities (
             id, account_id, workspace_id, attempt_id, source, object_key, content_type, max_bytes
           ) VALUES
             ($1,$3,$4,$2,'PRIMARY_RESULT_OUTPUT',$5,$6,$7),
             ($8,$3,$4,$2,'RESULT_DOCUMENT',$9,'application/json',1048576)`,
          [
            crypto.randomUUID(),
            attemptId,
            scope.account_id,
            scope.workspace_id,
            primaryKey,
            primaryType,
            primaryMax,
            crypto.randomUUID(),
            resultKey,
          ],
        );
      }
      return {
        attemptId,
        replay: false as const,
        state: "PLANNED",
        jobSpecKey,
        jobSpecBytes,
        jobSpecChecksum,
      };
    });
    if (!prepared) return json({ error: { code: "CPU_SUBMISSION_NOT_FOUND" } }, 404);
    if (prepared.replay) {
      return json({
        schema_version: "videoforge-hosted-cpu-attempt/v1",
        id: prepared.attemptId,
        state: prepared.state,
        idempotent_replay: true,
      });
    }
    const bucket = environment.PRIVATE_ARTIFACTS!;
    const jobSpecBuffer = new ArrayBuffer(prepared.jobSpecBytes.byteLength);
    new Uint8Array(jobSpecBuffer).set(prepared.jobSpecBytes);
    await bucket.put(prepared.jobSpecKey, jobSpecBuffer, {
      httpMetadata: { contentType: "application/json" },
      customMetadata: { sha256: prepared.jobSpecChecksum },
    });
    await executor.transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1, $2, true)", [
        "videoforge.account_id",
        scope.account_id,
      ]);
      await transaction.query(
        `UPDATE hosted_cpu_job_attempts
            SET state = 'OUTBOXED', job_spec_content_length = $2,
                job_spec_checksum_sha256 = $3, version = version + 1, updated_at = now()
          WHERE id = $1 AND state = 'PLANNED'`,
        [prepared.attemptId, prepared.jobSpecBytes.byteLength, prepared.jobSpecChecksum],
      );
      await transaction.query(
        `INSERT INTO hosted_cpu_job_events (
           id, account_id, workspace_id, attempt_id, sequence, kind, facts_sha256, occurred_at
         ) SELECT md5($1 || ':outboxed:1')::uuid, $2, $3, $1, 1, 'OUTBOXED', $4, now()
         WHERE NOT EXISTS (
           SELECT 1 FROM hosted_cpu_job_events WHERE attempt_id = $1 AND kind = 'OUTBOXED'
         )`,
        [prepared.attemptId, scope.account_id, scope.workspace_id, prepared.jobSpecChecksum],
      );
    });
    await startHostedCpuWorkflow(environment, {
      attemptId: prepared.attemptId,
      accountId: scope.account_id,
      workspaceId: scope.workspace_id,
    });
    return json(
      {
        schema_version: "videoforge-hosted-cpu-attempt/v1",
        id: prepared.attemptId,
        state: "OUTBOXED",
      },
      202,
    );
  } catch (error) {
    if (error instanceof Error && error.message === "CPU_SUBMISSION_IDEMPOTENCY_CONFLICT") {
      return json({ error: { code: "CPU_SUBMISSION_IDEMPOTENCY_CONFLICT" } }, 409);
    }
    throw error;
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
  if (
    request.method === "POST" &&
    url.pathname.startsWith("/api/v2/internal/cloud-run/upload-port/")
  ) {
    return handleCpuUploadPort(request, environment, url.pathname.split("/").at(-1) ?? "");
  }
  if (
    request.method === "GET" &&
    url.pathname.startsWith("/api/v2/internal/cloud-run/cancelled/")
  ) {
    return handleCpuCancellationProbe(request, environment, url.pathname.split("/").at(-1) ?? "");
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
  if (request.method === "POST" && url.pathname === "/api/v2/cpu-attempts") {
    return handleCpuSubmission(request, environment, config, executionContext);
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

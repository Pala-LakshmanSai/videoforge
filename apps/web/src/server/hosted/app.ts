import { createHostedAuth, type HostedExecutionContext } from "./auth";
import { hostedRuntimeConfiguration, type HostedRuntimeEnvironment } from "./configuration";
import { deriveCallbackToken, sha256, sha256Bytes } from "./crypto";
import { createNeonExecutor, createNeonPool } from "./neon";
import { handlePersonalWorkerRequest } from "./personal-worker";
import { HostedR2Signer } from "./r2";
import {
  bindHostedCpuInputDocument,
  canonicalJson,
  exactHostedCpuSubmission,
  whisperModelUri,
} from "./submission";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

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

function sameOriginBrowserWrite(
  request: Request,
  config: ReturnType<typeof hostedRuntimeConfiguration>,
): boolean {
  const origin = request.headers.get("origin");
  return origin !== null && origin === new URL(config.publicOrigin).origin;
}

interface OwnedArtifactRow extends Record<string, unknown> {
  readonly id: string;
  readonly object_key: string;
  readonly content_type: string;
  readonly content_length: string | number;
  readonly checksum_sha256: string;
}

interface HostedLibraryRow extends Record<string, unknown> {
  readonly attempt_id: string;
  readonly project_id: string;
  readonly title: string;
  readonly created_at: Date | string;
  readonly object_key: string;
  readonly content_type: string;
  readonly content_length: string | number;
  readonly checksum_sha256: string;
}

interface HostedQueueRow extends Record<string, unknown> {
  readonly id: string;
  readonly project_id: string;
  readonly title: string;
  readonly kind: "ASR" | "RENDER";
  readonly state: string;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

async function handleHostedQueue(
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
    const accountId = scope.rows[0]?.account_id;
    const workspaceId = scope.rows[0]?.workspace_id;
    if (typeof accountId !== "string" || typeof workspaceId !== "string") {
      return json({ error: { code: "INVITE_ADMISSION_REQUIRED" } }, 403);
    }
    const result = await createNeonExecutor(pool).transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1, $2, true)", [
        "videoforge.account_id",
        accountId,
      ]);
      const attempts = await transaction.query<HostedQueueRow>(
        `SELECT attempt.id, attempt.project_id, project.name AS title, attempt.kind,
                attempt.state, attempt.created_at, attempt.updated_at
           FROM hosted_cpu_job_attempts AS attempt
           JOIN projects AS project
             ON project.account_id = attempt.account_id
            AND project.workspace_id = attempt.workspace_id
            AND project.id = attempt.project_id
          WHERE attempt.account_id = $1 AND attempt.workspace_id = $2
            AND attempt.retention_deleted_at IS NULL
          ORDER BY attempt.created_at DESC, attempt.id DESC
          LIMIT 100`,
        [accountId, workspaceId],
      );
      const devices = await transaction.query<{ status: string; count: string | number }>(
        `SELECT status, count(*) AS count
           FROM media_worker_devices
          WHERE account_id = $1 AND workspace_id = $2 AND status <> 'REVOKED'
          GROUP BY status`,
        [accountId, workspaceId],
      );
      return { attempts: attempts.rows, devices: devices.rows };
    });
    const workers = Object.fromEntries(
      result.devices.map((row) => [String(row.status), Number(row.count)]),
    );
    return json({
      schema_version: "videoforge-hosted-queue/v1",
      worker_state:
        (workers.ONLINE ?? 0) > 0
          ? "ONLINE"
          : (workers.BUSY ?? 0) > 0
            ? "BUSY"
            : "WAITING_FOR_YOUR_COMPUTER",
      attempts: result.attempts.map((attempt) => ({
        id: attempt.id,
        project_id: attempt.project_id,
        title: attempt.title,
        kind: attempt.kind,
        state: attempt.state,
        created_at: new Date(attempt.created_at).toISOString(),
        updated_at: new Date(attempt.updated_at).toISOString(),
      })),
    });
  } finally {
    await pool.end();
  }
}

async function handleHostedLibrary(
  request: Request,
  environment: HostedRuntimeEnvironment,
  config: ReturnType<typeof hostedRuntimeConfiguration>,
  executionContext: HostedExecutionContext,
): Promise<Response> {
  const bucket = environment.PRIVATE_ARTIFACTS;
  if (!bucket) return json({ error: { code: "HOSTED_ARTIFACTS_UNAVAILABLE" } }, 503);
  const pool = createNeonPool(config.neon.databaseUrl);
  try {
    const session = await hostedSession(request, config, pool, executionContext);
    if (!session?.user?.id) return json({ error: { code: "AUTHENTICATION_REQUIRED" } }, 401);
    const scope = await pool.query(`SELECT * FROM videoforge_hosted_session_scope($1)`, [
      session.session.token,
    ]);
    const accountId = scope.rows[0]?.account_id;
    const workspaceId = scope.rows[0]?.workspace_id;
    if (typeof accountId !== "string" || typeof workspaceId !== "string") {
      return json({ error: { code: "INVITE_ADMISSION_REQUIRED" } }, 403);
    }
    const outputs = await createNeonExecutor(pool).transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1, $2, true)", [
        "videoforge.account_id",
        accountId,
      ]);
      const result = await transaction.query<HostedLibraryRow>(
        `SELECT attempt.id AS attempt_id, attempt.project_id, project.name AS title,
                attempt.created_at, authority.object_key, authority.content_type,
                authority.issued_content_length AS content_length,
                authority.issued_checksum_sha256 AS checksum_sha256
           FROM hosted_cpu_job_attempts AS attempt
           JOIN projects AS project
             ON project.account_id = attempt.account_id
            AND project.workspace_id = attempt.workspace_id
            AND project.id = attempt.project_id
           JOIN hosted_cpu_upload_authorities AS authority
             ON authority.account_id = attempt.account_id
            AND authority.workspace_id = attempt.workspace_id
            AND authority.attempt_id = attempt.id
            AND authority.source = 'PRIMARY_RESULT_OUTPUT'
          WHERE attempt.account_id = $1 AND attempt.workspace_id = $2
            AND attempt.kind = 'RENDER' AND attempt.state = 'SUCCEEDED'
            AND attempt.retention_deleted_at IS NULL
            AND authority.issued_at IS NOT NULL
          ORDER BY attempt.created_at DESC, attempt.id DESC`,
        [accountId, workspaceId],
      );
      return result.rows;
    });
    const signer = new HostedR2Signer(config.r2);
    const signed = [];
    for (const output of outputs) {
      const contentLength = Number(output.content_length);
      if (
        output.content_type !== "video/mp4" ||
        !Number.isSafeInteger(contentLength) ||
        contentLength < 1 ||
        !/^sha256:[0-9a-f]{64}$/u.test(output.checksum_sha256)
      ) {
        continue;
      }
      const object = await bucket.head(output.object_key);
      if (
        !object ||
        object.size !== contentLength ||
        object.httpMetadata?.contentType !== "video/mp4"
      ) {
        continue;
      }
      const port = await signer.sign({
        method: "GET",
        objectKey: output.object_key,
        contentType: "video/mp4",
        contentLength,
        checksumSha256: output.checksum_sha256,
        lifetimeSeconds: 300,
        downloadFilename: `${output.title.replace(/[^A-Za-z0-9._ -]+/gu, "_").slice(0, 110) || "videoforge-video"}.mp4`,
      });
      signed.push({
        attempt_id: output.attempt_id,
        project_id: output.project_id,
        title: output.title,
        created_at: new Date(output.created_at).toISOString(),
        content_length: contentLength,
        checksum_sha256: output.checksum_sha256,
        download_url: port.url,
        download_expires_at: port.expiresAt,
      });
    }
    return json({ schema_version: "videoforge-hosted-library/v1", outputs: signed });
  } finally {
    await pool.end();
  }
}

async function handleCpuSubmission(
  request: Request,
  environment: HostedRuntimeEnvironment,
  config: ReturnType<typeof hostedRuntimeConfiguration>,
  executionContext: HostedExecutionContext,
): Promise<Response> {
  if (!sameOriginBrowserWrite(request, config)) {
    return json({ error: { code: "HOSTED_BROWSER_ORIGIN_REJECTED" } }, 403);
  }
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

    const imageDigest = config.mediaWorkerRelease.executionBundleSha256;
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
      const objects = submission.objects.map((object) => {
        const artifact = artifactById.get(object.receiptId)!;
        return {
          uri: object.uri,
          object_key: artifact.object_key,
          content_type: artifact.content_type,
          sha256: artifact.checksum_sha256,
          bytes: Number(artifact.content_length),
        };
      });
      const primaryType = submission.kind === "ASR" ? "application/json" : "video/mp4";
      const primaryMax = submission.kind === "ASR" ? 16 * 1024 ** 2 : 10 * 1024 ** 3;
      const jobSpec = {
        schema_version: "videoforge-personal-worker-job-template/v1",
        attempt_id: attemptId,
        kind: submission.kind,
        input_document: inputDocument,
        outputs: [
          {
            source: "PRIMARY_RESULT_OUTPUT",
            object_key: primaryKey,
            content_type: primaryType,
            max_bytes: primaryMax,
          },
        ],
        result: { object_key: resultKey, max_bytes: 1_048_576 },
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
             result_max_bytes, image_digest, callback_token_sha256, deadline_at,
             execution_backend, execution_bundle_sha256
           ) VALUES ($1,$2,$3,$4,$5,$6,'PLANNED',$7,$8,$9,$10,$11,$12,1048576,$13,$14,
                     now() + interval '24 hours','PERSONAL_WORKER',$13)`,
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
        for (const object of objects) {
          await transaction.query(
            `INSERT INTO media_worker_input_objects (
               id, account_id, workspace_id, attempt_id, uri, object_key, content_type,
               content_length, checksum_sha256
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [
              crypto.randomUUID(),
              scope.account_id,
              scope.workspace_id,
              attemptId,
              object.uri,
              object.object_key,
              object.content_type,
              object.bytes,
              object.sha256,
            ],
          );
        }
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
    try {
      await bucket.put(prepared.jobSpecKey, jobSpecBuffer, {
        httpMetadata: { contentType: "application/json" },
        customMetadata: { sha256: prepared.jobSpecChecksum },
      });
      await startHostedCpuWorkflow(environment, {
        attemptId: prepared.attemptId,
        accountId: scope.account_id,
        workspaceId: scope.workspace_id,
      });
      await executor.transaction(async (transaction) => {
        await transaction.query("SELECT set_config($1, $2, true)", [
          "videoforge.account_id",
          scope.account_id,
        ]);
        const outboxed = await transaction.query<{ id: string }>(
          `UPDATE hosted_cpu_job_attempts
              SET state = 'OUTBOXED', job_spec_content_length = $2,
                  job_spec_checksum_sha256 = $3, version = version + 1, updated_at = now()
            WHERE id = $1 AND state = 'PLANNED'
          RETURNING id`,
          [prepared.attemptId, prepared.jobSpecBytes.byteLength, prepared.jobSpecChecksum],
        );
        if (!outboxed.rows[0]) throw new Error("Hosted CPU attempt was not ready to outbox.");
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
    } catch (error) {
      await bucket.delete(prepared.jobSpecKey).catch(() => undefined);
      const failureFacts = await sha256(`PREPARATION_FAILED:${prepared.jobSpecChecksum}`);
      await executor.transaction(async (transaction) => {
        await transaction.query("SELECT set_config($1, $2, true)", [
          "videoforge.account_id",
          scope.account_id,
        ]);
        const failed = await transaction.query<{
          account_id: string;
          workspace_id: string;
        }>(
          `UPDATE hosted_cpu_job_attempts
              SET state = 'FAILED', submitted_at = COALESCE(submitted_at, now()),
                  terminal_at = now(), retain_until = GREATEST(deadline_at, now() + interval '30 minutes'),
                  version = version + 1, updated_at = now()
            WHERE id = $1 AND state = 'PLANNED'
          RETURNING account_id, workspace_id`,
          [prepared.attemptId],
        );
        const row = failed.rows[0];
        if (!row) return;
        await transaction.query(
          `INSERT INTO hosted_cpu_job_events (
             id, account_id, workspace_id, attempt_id, sequence, kind, facts_sha256, occurred_at
           ) SELECT md5($1 || ':preparation-failed:1')::uuid, $2, $3, $1, 1, 'FAILED', $4, now()
             WHERE NOT EXISTS (
               SELECT 1 FROM hosted_cpu_job_events WHERE attempt_id = $1 AND kind = 'FAILED'
             )`,
          [prepared.attemptId, row.account_id, row.workspace_id, failureFacts],
        );
      });
      throw error;
    }
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
    const workspaceName = await createNeonExecutor(pool).transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1, $2, true)", [
        "videoforge.account_id",
        row.account_id,
      ]);
      const workspace = await transaction.query(`SELECT name FROM workspaces WHERE id = $1`, [
        row.workspace_id,
      ]);
      return workspace.rows[0]?.name;
    });
    return json({
      schema_version: "videoforge-hosted-tenant/v1",
      account_id: row.account_id,
      workspace_id: row.workspace_id,
      workspace_name: workspaceName ?? "My workspace",
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
      if (!sameOriginBrowserWrite(request, config)) {
        return json({ error: { code: "HOSTED_BROWSER_ORIGIN_REJECTED" } }, 403);
      }
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
              SET state = CASE WHEN state = 'OUTBOXED' THEN 'CANCELLED' ELSE 'CANCEL_REQUESTED' END,
                  cancellation_requested_at = now(), poll_after = now(),
                  submitted_at = COALESCE(submitted_at, now()),
                  terminal_at = CASE WHEN state = 'OUTBOXED' THEN now() ELSE terminal_at END,
                  retain_until = CASE WHEN state = 'OUTBOXED' THEN GREATEST(deadline_at, now() + interval '30 minutes') ELSE retain_until END,
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
                    $2, $3, $1, COALESCE(max(sequence), 0) + 1, $5,
                    $4, now()
               FROM hosted_cpu_job_events
              WHERE account_id = $2 AND workspace_id = $3 AND attempt_id = $1`,
          [
            attemptId,
            changed.account_id,
            changed.workspace_id,
            await sha256(`${changed.state}:${attemptId}`),
            changed.state,
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
    const attempt = await createNeonExecutor(pool).transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1, $2, true)", [
        "videoforge.account_id",
        accountId,
      ]);
      const result = await transaction.query(
        `SELECT id, kind, state, version, deadline_at, retain_until, result_receipt_sha256,
                result_content_length, result_checksum_sha256
           FROM hosted_cpu_job_attempts WHERE id = $1`,
        [attemptId],
      );
      return result.rows[0];
    });
    if (!attempt) return json({ error: { code: "CPU_ATTEMPT_NOT_FOUND" } }, 404);
    return json({ schema_version: "videoforge-hosted-cpu-attempt/v1", ...attempt });
  } finally {
    await pool.end();
  }
}

async function handleCpuOutputDelete(
  request: Request,
  environment: HostedRuntimeEnvironment,
  config: ReturnType<typeof hostedRuntimeConfiguration>,
  executionContext: HostedExecutionContext,
  attemptId: string,
): Promise<Response> {
  if (!UUID.test(attemptId)) return json({ error: { code: "CPU_ATTEMPT_NOT_FOUND" } }, 404);
  if (!sameOriginBrowserWrite(request, config)) {
    return json({ error: { code: "HOSTED_BROWSER_ORIGIN_REJECTED" } }, 403);
  }
  const bucket = environment.PRIVATE_ARTIFACTS;
  if (!bucket) return json({ error: { code: "HOSTED_ARTIFACTS_UNAVAILABLE" } }, 503);
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
    const owned = await createNeonExecutor(pool).transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1, $2, true)", [
        "videoforge.account_id",
        accountId,
      ]);
      const result = await transaction.query<{
        state: string;
        retention_deleted_at: string | null;
        object_key: string | null;
      }>(
        `SELECT attempt.state, attempt.retention_deleted_at, authority.object_key
           FROM hosted_cpu_job_attempts AS attempt
           LEFT JOIN hosted_cpu_upload_authorities AS authority
             ON authority.account_id = attempt.account_id
            AND authority.workspace_id = attempt.workspace_id
            AND authority.attempt_id = attempt.id
            AND authority.issued_at IS NOT NULL
          WHERE attempt.id = $1 AND attempt.state = 'SUCCEEDED'
          ORDER BY authority.source`,
        [attemptId],
      );
      return result.rows;
    });
    if (owned.length === 0) return json({ error: { code: "CPU_ATTEMPT_OUTPUT_NOT_FOUND" } }, 404);
    if (owned[0]?.retention_deleted_at !== null) return new Response(null, { status: 204 });
    const keys = owned
      .map((row) => row.object_key)
      .filter((key): key is string => typeof key === "string")
      .sort();
    if (keys.length !== 2) return json({ error: { code: "CPU_ATTEMPT_OUTPUT_INCOMPLETE" } }, 409);
    await bucket.delete(keys);
    const factsSha256 = await sha256(
      canonicalJson({
        attempt_id: attemptId,
        deleted_keys: keys,
        reason: "EXPLICIT_USER_DELETE",
        schema_version: "videoforge-explicit-output-deletion/v1",
      }),
    );
    await createNeonExecutor(pool).transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1, $2, true)", [
        "videoforge.account_id",
        accountId,
      ]);
      const changed = await transaction.query<{
        account_id: string;
        workspace_id: string;
      }>(
        `UPDATE hosted_cpu_job_attempts
            SET retention_deleted_at = now(), version = version + 1, updated_at = now()
          WHERE id = $1 AND state = 'SUCCEEDED' AND retention_deleted_at IS NULL
        RETURNING account_id, workspace_id`,
        [attemptId],
      );
      const row = changed.rows[0];
      if (!row) return;
      await transaction.query(
        `INSERT INTO hosted_cpu_job_events (
           id, account_id, workspace_id, attempt_id, sequence, kind, facts_sha256, occurred_at
         ) SELECT md5($1 || ':explicit-delete:' || (COALESCE(max(sequence), 0) + 1)::text)::uuid,
                  $2, $3, $1, COALESCE(max(sequence), 0) + 1, 'RETENTION_DELETED', $4, now()
             FROM hosted_cpu_job_events
            WHERE account_id = $2 AND workspace_id = $3 AND attempt_id = $1`,
        [attemptId, row.account_id, row.workspace_id, factsSha256],
      );
    });
    return new Response(null, { status: 204 });
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
  const personalWorkerResponse = await handlePersonalWorkerRequest(
    request,
    environment,
    executionContext,
  );
  if (personalWorkerResponse) return personalWorkerResponse;
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
      cpu_jobs: "ACCOUNT_OWNED_PERSONAL_WORKER_REQUIRED",
      supported_worker_platforms: ["WINDOWS", "MACOS"],
      provider_cpu_spend: "$0",
      authentication: config.email ? ["GOOGLE", "EMAIL_PASSWORD"] : ["GOOGLE"],
    });
  }
  if (request.method === "GET" && url.pathname === "/api/v2/tenant") {
    return handleTenantApi(request, config, executionContext);
  }
  if (request.method === "GET" && url.pathname === "/api/v2/library") {
    return handleHostedLibrary(request, environment, config, executionContext);
  }
  if (request.method === "GET" && url.pathname === "/api/v2/hosted/queue") {
    return handleHostedQueue(request, config, executionContext);
  }
  if (request.method === "POST" && url.pathname === "/api/v2/cpu-attempts") {
    return handleCpuSubmission(request, environment, config, executionContext);
  }
  const attemptMatch = /^\/api\/v2\/cpu-attempts\/([0-9a-f-]+)$/u.exec(url.pathname);
  if (attemptMatch && (request.method === "GET" || request.method === "POST")) {
    return handleCpuAttemptApi(request, config, executionContext, attemptMatch[1]!);
  }
  const outputDeleteMatch = /^\/api\/v2\/cpu-attempts\/([0-9a-f-]+)\/output$/u.exec(url.pathname);
  if (outputDeleteMatch && request.method === "DELETE") {
    return handleCpuOutputDelete(
      request,
      environment,
      config,
      executionContext,
      outputDeleteMatch[1]!,
    );
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

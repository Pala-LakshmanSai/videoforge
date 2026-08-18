import { createHostedAuth, type HostedExecutionContext } from "./auth";
import {
  hostedRuntimeConfiguration,
  type HostedRuntimeConfiguration,
  type HostedRuntimeEnvironment,
  type HostedNeonPool,
} from "./configuration";
import { deriveCallbackToken, deriveScopedToken, sha256, sha256Bytes } from "./crypto";
import { createNeonExecutor, createNeonPool } from "./neon";
import { HostedR2Signer } from "./r2";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const TOKEN = /^[0-9a-f]{64}$/u;
const WORKER_VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?$/u;
const PLANNED_RECONCILIATION_GRACE_MS = 2 * 60 * 1_000;

export function supportedWorkerPlatform(platform: unknown, architecture: unknown): boolean {
  return (
    (platform === "WINDOWS" && architecture === "X86_64") ||
    (platform === "MACOS" && (architecture === "X86_64" || architecture === "AARCH64"))
  );
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
      "x-content-type-options": "nosniff",
      "x-videoforge-runtime": "hosted-v2-06-personal-worker",
    },
  });
}

function bearer(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const value = authorization.slice("Bearer ".length);
  return TOKEN.test(value) ? value : null;
}

function sameOriginBrowserWrite(request: Request, config: HostedRuntimeConfiguration): boolean {
  const origin = request.headers.get("origin");
  return origin !== null && origin === new URL(config.publicOrigin).origin;
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

async function pkceChallenge(verifier: string): Promise<string> {
  return base64Url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))),
  );
}

async function sessionScope(
  request: Request,
  config: HostedRuntimeConfiguration,
  pool: HostedNeonPool,
  executionContext: HostedExecutionContext,
): Promise<{ accountId: string; workspaceId: string } | null> {
  const session = await createHostedAuth({ config, pool, executionContext }).api.getSession({
    headers: request.headers,
  });
  if (!session?.session?.token) return null;
  const result = await pool.query(`SELECT * FROM videoforge_hosted_session_scope($1)`, [
    session.session.token,
  ]);
  const row = result.rows[0];
  return row ? { accountId: String(row.account_id), workspaceId: String(row.workspace_id) } : null;
}

interface DeviceScope {
  readonly deviceId: string;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly status: "OFFLINE" | "ONLINE" | "BUSY" | "UPDATE_REQUIRED" | "REVOKED";
  readonly protocolVersion: number;
  readonly executionBundleSha256: string;
}

async function deviceScope(request: Request, pool: HostedNeonPool): Promise<DeviceScope | null> {
  const token = bearer(request);
  if (!token) return null;
  const result = await pool.query(`SELECT * FROM videoforge_media_worker_device_scope($1)`, [
    await sha256(token),
  ]);
  const row = result.rows[0];
  return row
    ? {
        deviceId: String(row.device_id),
        accountId: String(row.account_id),
        workspaceId: String(row.workspace_id),
        status: String(row.status) as DeviceScope["status"],
        protocolVersion: Number(row.protocol_version),
        executionBundleSha256: String(row.execution_bundle_sha256),
      }
    : null;
}

function exactEnrollment(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).sort().join(",") !==
      "architecture,display_name,execution_bundle_sha256,installation_id,pkce_challenge,platform,protocol_version,schema_version,worker_version" ||
    row.schema_version !== "videoforge-media-worker-enrollment/v1" ||
    typeof row.display_name !== "string" ||
    row.display_name.trim() !== row.display_name ||
    row.display_name.length < 1 ||
    row.display_name.length > 120 ||
    !supportedWorkerPlatform(row.platform, row.architecture) ||
    typeof row.worker_version !== "string" ||
    !WORKER_VERSION.test(row.worker_version) ||
    !Number.isSafeInteger(row.protocol_version) ||
    Number(row.protocol_version) < 1 ||
    typeof row.execution_bundle_sha256 !== "string" ||
    !SHA256.test(row.execution_bundle_sha256) ||
    typeof row.installation_id !== "string" ||
    !UUID.test(row.installation_id) ||
    typeof row.pkce_challenge !== "string" ||
    !/^[A-Za-z0-9_-]{43,128}$/u.test(row.pkce_challenge)
  ) {
    return null;
  }
  return {
    displayName: row.display_name,
    platform: row.platform,
    architecture: row.architecture,
    workerVersion: row.worker_version,
    protocolVersion: Number(row.protocol_version),
    executionBundleSha256: row.execution_bundle_sha256,
    installationId: row.installation_id,
    pkceChallenge: row.pkce_challenge,
  } as const;
}

async function createEnrollment(request: Request, config: HostedRuntimeConfiguration) {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isSafeInteger(length) || length < 1 || length > 8_192) {
    return json({ error: { code: "MEDIA_WORKER_ENROLLMENT_REJECTED" } }, 400);
  }
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return json({ error: { code: "MEDIA_WORKER_ENROLLMENT_REJECTED" } }, 400);
  }
  const enrollment = exactEnrollment(value);
  if (!enrollment) return json({ error: { code: "MEDIA_WORKER_ENROLLMENT_REJECTED" } }, 400);
  const id = crypto.randomUUID();
  const pollToken = randomToken();
  const pool = createNeonPool(config.neon.databaseUrl);
  try {
    await createNeonExecutor(pool).transaction(async (transaction) => {
      // Pending enrollments are system-scoped until the signed-in browser approves them.  Clear
      // any connection-level tenant context before the insert so a reused Neon session cannot
      // make this unauthenticated system write look like a cross-tenant mutation.
      await transaction.query(`SELECT set_config($1, $2, true)`, ["videoforge.account_id", ""]);
      await transaction.query(
        `INSERT INTO media_worker_enrollments (
           id, display_name, platform, architecture, worker_version, protocol_version,
           execution_bundle_sha256, installation_id, pkce_challenge, poll_token_sha256, state, expires_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'PENDING',now() + interval '10 minutes')`,
        [
          id,
          enrollment.displayName,
          String(enrollment.platform),
          String(enrollment.architecture),
          enrollment.workerVersion,
          enrollment.protocolVersion,
          enrollment.executionBundleSha256,
          enrollment.installationId,
          enrollment.pkceChallenge,
          await sha256(pollToken),
        ],
      );
    });
    return json(
      {
        schema_version: "videoforge-media-worker-enrollment-created/v1",
        enrollment_id: id,
        poll_token: pollToken,
        approval_url: `${config.publicOrigin}/settings?enrollment=${id}`,
        expires_in_seconds: 600,
      },
      201,
    );
  } catch (error) {
    if (error instanceof Error && /unique|duplicate/iu.test(error.message)) {
      return json({ error: { code: "MEDIA_WORKER_ALREADY_ENROLLED" } }, 409);
    }
    throw error;
  } finally {
    await pool.end();
  }
}

async function enrollmentForBrowser(
  request: Request,
  config: HostedRuntimeConfiguration,
  executionContext: HostedExecutionContext,
  enrollmentId: string,
) {
  const pool = createNeonPool(config.neon.databaseUrl);
  try {
    const scope = await sessionScope(request, config, pool, executionContext);
    if (!scope) return json({ error: { code: "AUTHENTICATION_REQUIRED" } }, 401);
    await pool.query("SELECT set_config($1, $2, false)", [
      "videoforge.account_id",
      scope.accountId,
    ]);
    const result = await pool.query(
      `SELECT id, display_name, platform, architecture, worker_version, protocol_version,
              state, expires_at, account_id
         FROM media_worker_enrollments WHERE id = $1`,
      [enrollmentId],
    );
    const row = result.rows[0];
    if (!row || (row.account_id && String(row.account_id) !== scope.accountId)) {
      return json({ error: { code: "MEDIA_WORKER_ENROLLMENT_NOT_FOUND" } }, 404);
    }
    return json({ schema_version: "videoforge-media-worker-enrollment-status/v1", ...row });
  } finally {
    await pool.end();
  }
}

async function approveEnrollment(
  request: Request,
  config: HostedRuntimeConfiguration,
  executionContext: HostedExecutionContext,
  enrollmentId: string,
) {
  if (!sameOriginBrowserWrite(request, config)) {
    return json({ error: { code: "MEDIA_WORKER_BROWSER_ORIGIN_REJECTED" } }, 403);
  }
  const pool = createNeonPool(config.neon.databaseUrl);
  try {
    const scope = await sessionScope(request, config, pool, executionContext);
    if (!scope) return json({ error: { code: "AUTHENTICATION_REQUIRED" } }, 401);
    const credential = await deriveScopedToken(
      config.mediaWorkerTokenSecret,
      "device",
      enrollmentId,
    );
    const result = await createNeonExecutor(pool).transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1, $2, true)", [
        "videoforge.account_id",
        scope.accountId,
      ]);
      const found = await transaction.query<{
        display_name: string;
        platform: string;
        architecture: string;
        worker_version: string;
        protocol_version: number;
        execution_bundle_sha256: string;
        installation_id: string;
        state: string;
        account_id: string | null;
      }>(`SELECT * FROM media_worker_enrollments WHERE id = $1 FOR UPDATE`, [enrollmentId]);
      const row = found.rows[0];
      if (!row) return { code: "NOT_FOUND" as const };
      if (row.account_id && row.account_id !== scope.accountId)
        return { code: "NOT_FOUND" as const };
      if (row.state === "APPROVED" || row.state === "CONSUMED") {
        const existing = await transaction.query<{ id: string }>(
          `SELECT id FROM media_worker_devices WHERE enrollment_id = $1`,
          [enrollmentId],
        );
        return { code: "OK" as const, deviceId: existing.rows[0]?.id };
      }
      const approved = await transaction.query(
        `UPDATE media_worker_enrollments
            SET state = 'APPROVED', account_id = $2, workspace_id = $3,
                credential_token_sha256 = $4, approved_at = now()
          WHERE id = $1 AND state = 'PENDING' AND expires_at > now()
        RETURNING id`,
        [enrollmentId, scope.accountId, scope.workspaceId, await sha256(credential)],
      );
      if (!approved.rows[0]) return { code: "EXPIRED" as const };
      const priorDevice = await transaction.query<{
        id: string;
        status: string;
        account_id: string;
        workspace_id: string;
      }>(
        `SELECT id, status, account_id, workspace_id
           FROM media_worker_devices WHERE installation_id = $1 FOR UPDATE`,
        [row.installation_id],
      );
      const deviceId = priorDevice.rows[0]?.id ?? crypto.randomUUID();
      if (
        priorDevice.rows[0] &&
        (priorDevice.rows[0].account_id !== scope.accountId ||
          priorDevice.rows[0].workspace_id !== scope.workspaceId)
      ) {
        throw new Error("MEDIA_WORKER_INSTALLATION_OWNED_BY_ANOTHER_ACCOUNT");
      }
      if (priorDevice.rows[0] && priorDevice.rows[0].status !== "REVOKED") {
        throw new Error("MEDIA_WORKER_INSTALLATION_ALREADY_ACTIVE");
      }
      if (priorDevice.rows[0]) {
        await transaction.query(
          `UPDATE media_worker_devices
              SET enrollment_id = $2, display_name = $3, platform = $4, architecture = $5,
                  worker_version = $6, protocol_version = $7, execution_bundle_sha256 = $8,
                  credential_token_sha256 = $9,
                  status = 'OFFLINE', revoked_at = NULL, last_seen_at = NULL, updated_at = now()
            WHERE id = $1`,
          [
            deviceId,
            enrollmentId,
            row.display_name,
            row.platform,
            row.architecture,
            row.worker_version,
            row.protocol_version,
            row.execution_bundle_sha256,
            await sha256(credential),
          ],
        );
      } else {
        await transaction.query(
          `INSERT INTO media_worker_devices (
             id, account_id, workspace_id, enrollment_id, display_name, platform, architecture,
             worker_version, protocol_version, execution_bundle_sha256, installation_id,
             credential_token_sha256, status
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'OFFLINE')`,
          [
            deviceId,
            scope.accountId,
            scope.workspaceId,
            enrollmentId,
            row.display_name,
            row.platform,
            row.architecture,
            row.worker_version,
            row.protocol_version,
            row.execution_bundle_sha256,
            row.installation_id,
            await sha256(credential),
          ],
        );
      }
      await transaction.query(
        `INSERT INTO media_worker_events (
           id, account_id, workspace_id, device_id, lease_id, sequence, kind,
           facts_sha256, occurred_at
         ) SELECT $1,$2,$3,$4,NULL,COALESCE(max(sequence), 0) + 1,'ENROLLED',$5,now()
             FROM media_worker_events
            WHERE account_id = $2 AND workspace_id = $3 AND device_id = $4`,
        [
          crypto.randomUUID(),
          scope.accountId,
          scope.workspaceId,
          deviceId,
          await sha256(row.installation_id),
        ],
      );
      return { code: "OK" as const, deviceId };
    });
    if (result.code === "NOT_FOUND")
      return json({ error: { code: "MEDIA_WORKER_ENROLLMENT_NOT_FOUND" } }, 404);
    if (result.code === "EXPIRED")
      return json({ error: { code: "MEDIA_WORKER_ENROLLMENT_EXPIRED" } }, 409);
    return json(
      {
        schema_version: "videoforge-media-worker-enrollment-approved/v1",
        device_id: result.deviceId,
        state: "APPROVED",
      },
      202,
    );
  } catch (error) {
    if (
      error instanceof Error &&
      [
        "MEDIA_WORKER_INSTALLATION_ALREADY_ACTIVE",
        "MEDIA_WORKER_INSTALLATION_OWNED_BY_ANOTHER_ACCOUNT",
      ].includes(error.message)
    ) {
      return json({ error: { code: "MEDIA_WORKER_INSTALLATION_ALREADY_ACTIVE" } }, 409);
    }
    throw error;
  } finally {
    await pool.end();
  }
}

async function pollEnrollment(
  request: Request,
  config: HostedRuntimeConfiguration,
  enrollmentId: string,
) {
  const pollToken = bearer(request);
  const verifier = request.headers.get("x-videoforge-pkce-verifier");
  if (!pollToken || !verifier || verifier.length < 43 || verifier.length > 128) {
    return json({ error: { code: "MEDIA_WORKER_ENROLLMENT_UNAUTHORIZED" } }, 401);
  }
  const pool = createNeonPool(config.neon.databaseUrl);
  try {
    const pollTokenSha256 = await sha256(pollToken);
    const result = await pool.query(
      `SELECT state, expires_at, pkce_challenge
         FROM public.videoforge_media_worker_enrollment_poll($1, $2, now())`,
      [enrollmentId, pollTokenSha256],
    );
    const row = result.rows[0];
    if (!row || (await pkceChallenge(verifier)) !== row.pkce_challenge) {
      return json({ error: { code: "MEDIA_WORKER_ENROLLMENT_UNAUTHORIZED" } }, 401);
    }
    if (row.state === "EXPIRED" || Date.parse(String(row.expires_at)) <= Date.now()) {
      return json({ schema_version: "videoforge-media-worker-token/v1", state: "EXPIRED" }, 410);
    }
    if (row.state === "PENDING")
      return json({ schema_version: "videoforge-media-worker-token/v1", state: "PENDING" }, 202);
    if (!["APPROVED", "CONSUMED"].includes(String(row.state))) {
      return json({ schema_version: "videoforge-media-worker-token/v1", state: row.state }, 409);
    }
    const credential = await deriveScopedToken(
      config.mediaWorkerTokenSecret,
      "device",
      enrollmentId,
    );
    const consumed = await pool.query(
      `SELECT public.videoforge_media_worker_enrollment_consume($1, $2) AS consumed`,
      [enrollmentId, pollTokenSha256],
    );
    if (consumed.rows[0]?.consumed !== true) {
      return json({ error: { code: "MEDIA_WORKER_ENROLLMENT_UNAUTHORIZED" } }, 401);
    }
    return json({
      schema_version: "videoforge-media-worker-token/v1",
      state: "APPROVED",
      device_token: credential,
    });
  } finally {
    await pool.end();
  }
}

function releaseDocument(config: HostedRuntimeConfiguration) {
  const release = config.mediaWorkerRelease;
  return {
    version: release.version,
    minimum_protocol_version: release.minimumProtocolVersion,
    execution_bundle_sha256: release.executionBundleSha256,
    windows: {
      url: release.windows.url,
      sha256: release.windows.sha256,
      size_bytes: release.windows.sizeBytes,
      trust: release.windows.trust,
    },
    macos: {
      url: release.macos.url,
      sha256: release.macos.sha256,
      size_bytes: release.macos.sizeBytes,
      trust: release.macos.trust,
    },
  };
}

async function listDevices(
  request: Request,
  config: HostedRuntimeConfiguration,
  executionContext: HostedExecutionContext,
) {
  const pool = createNeonPool(config.neon.databaseUrl);
  try {
    const scope = await sessionScope(request, config, pool, executionContext);
    if (!scope) return json({ error: { code: "AUTHENTICATION_REQUIRED" } }, 401);
    await pool.query("SELECT set_config($1, $2, false)", [
      "videoforge.account_id",
      scope.accountId,
    ]);
    const devices = await pool.query(
      `SELECT device.id, device.display_name, device.platform, device.architecture,
              device.worker_version, device.protocol_version,
              CASE
                WHEN device.status = 'REVOKED' THEN 'REVOKED'
                WHEN device.protocol_version < $3 THEN 'UPDATE_REQUIRED'
                WHEN lease.id IS NOT NULL THEN 'BUSY'
                WHEN device.last_seen_at >= now() - interval '90 seconds' THEN 'ONLINE'
                ELSE 'OFFLINE'
              END AS status,
              device.last_seen_at, lease.attempt_id AS current_attempt_id
         FROM media_worker_devices AS device
         LEFT JOIN media_worker_leases AS lease
           ON lease.account_id = device.account_id AND lease.workspace_id = device.workspace_id
          AND lease.device_id = device.id AND lease.state IN ('CLAIMED', 'RUNNING', 'COMPLETING')
          AND lease.lease_expires_at > now()
        WHERE device.account_id = $1 AND device.workspace_id = $2
        ORDER BY device.created_at`,
      [scope.accountId, scope.workspaceId, config.mediaWorkerRelease.minimumProtocolVersion],
    );
    return json({
      schema_version: "videoforge-media-worker-list/v1",
      devices: devices.rows,
      release: releaseDocument(config),
    });
  } finally {
    await pool.end();
  }
}

async function revokeDevice(
  request: Request,
  config: HostedRuntimeConfiguration,
  executionContext: HostedExecutionContext,
  deviceId: string,
) {
  if (!sameOriginBrowserWrite(request, config)) {
    return json({ error: { code: "MEDIA_WORKER_BROWSER_ORIGIN_REJECTED" } }, 403);
  }
  const pool = createNeonPool(config.neon.databaseUrl);
  try {
    const scope = await sessionScope(request, config, pool, executionContext);
    if (!scope) return json({ error: { code: "AUTHENTICATION_REQUIRED" } }, 401);
    const changed = await createNeonExecutor(pool).transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1, $2, true)", [
        "videoforge.account_id",
        scope.accountId,
      ]);
      const result = await transaction.query(
        `UPDATE media_worker_devices
            SET status = 'REVOKED', revoked_at = now(), updated_at = now()
          WHERE id = $1 AND account_id = $2 AND workspace_id = $3 AND status <> 'REVOKED'
        RETURNING id`,
        [deviceId, scope.accountId, scope.workspaceId],
      );
      if (!result.rows[0]) return false;
      const affectedAttempts = await transaction.query<{ id: string; state: string }>(
        `UPDATE hosted_cpu_job_attempts AS attempt
            SET state = CASE WHEN attempt.state = 'CANCEL_REQUESTED' THEN 'CANCELLED' ELSE 'OUTBOXED' END,
                submitted_at = CASE WHEN attempt.state = 'CANCEL_REQUESTED'
                                    THEN COALESCE(attempt.submitted_at, now())
                                    ELSE NULL END,
                terminal_at = CASE WHEN attempt.state = 'CANCEL_REQUESTED' THEN now() ELSE NULL END,
                retain_until = CASE WHEN attempt.state = 'CANCEL_REQUESTED'
                                    THEN GREATEST(attempt.deadline_at, now() + interval '30 minutes')
                                    ELSE NULL END,
                version = version + 1, updated_at = now()
          FROM media_worker_leases AS lease
          WHERE lease.device_id = $1 AND lease.attempt_id = attempt.id
            AND lease.state IN ('CLAIMED', 'RUNNING', 'COMPLETING')
        RETURNING attempt.id, attempt.state`,
        [deviceId],
      );
      for (const attempt of affectedAttempts.rows) {
        const eventKind = attempt.state === "CANCELLED" ? "CANCELLED" : "REPLAYED";
        const facts = await sha256(
          JSON.stringify({
            attempt_id: attempt.id,
            device_id: deviceId,
            kind: eventKind,
            reason: "DEVICE_REVOKED",
            schema_version: "videoforge-hosted-cpu-device-revoked/v1",
          }),
        );
        await transaction.query(
          `INSERT INTO hosted_cpu_job_events (
           id, account_id, workspace_id, attempt_id, sequence, kind, facts_sha256, occurred_at
           ) SELECT md5($1::text || ':device-revoked:' || $5 || ':' || next.sequence::text)::uuid,
                    $2::uuid, $3::uuid, $1::uuid, next.sequence, $5, $4, now()
               FROM (
                 SELECT COALESCE(max(sequence), 0) + 1 AS sequence
                   FROM hosted_cpu_job_events
                  WHERE account_id = $2::uuid AND workspace_id = $3::uuid AND attempt_id = $1::uuid
               ) AS next
              WHERE NOT EXISTS (
                SELECT 1 FROM hosted_cpu_job_events
                 WHERE account_id = $2::uuid AND workspace_id = $3::uuid
                   AND attempt_id = $1::uuid AND kind = $5 AND facts_sha256 = $4
              )`,
          [attempt.id, scope.accountId, scope.workspaceId, facts, eventKind],
        );
      }
      await transaction.query(
        `UPDATE media_worker_leases
            SET state = 'CANCELLED', completed_at = now(), updated_at = now()
          WHERE device_id = $1 AND state IN ('CLAIMED', 'RUNNING', 'COMPLETING')`,
        [deviceId],
      );
      const revokeFacts = await sha256(
        JSON.stringify({
          device_id: deviceId,
          reason: "USER_REVOKED_DEVICE",
          schema_version: "videoforge-media-worker-revoked/v1",
        }),
      );
      await transaction.query(
        `INSERT INTO media_worker_events (
           id, account_id, workspace_id, device_id, lease_id, sequence, kind,
           facts_sha256, occurred_at
         ) SELECT $1, $2::uuid, $3::uuid, $4::uuid, NULL, COALESCE(max(sequence), 0) + 1,
                  'REVOKED', $5, now()
             FROM media_worker_events
            WHERE account_id = $2::uuid AND workspace_id = $3::uuid AND device_id = $4::uuid`,
        [crypto.randomUUID(), scope.accountId, scope.workspaceId, deviceId, revokeFacts],
      );
      return true;
    });
    return changed
      ? json({ schema_version: "videoforge-media-worker-revoked/v1", id: deviceId })
      : json({ error: { code: "MEDIA_WORKER_NOT_FOUND" } }, 404);
  } finally {
    await pool.end();
  }
}

async function heartbeat(request: Request, config: HostedRuntimeConfiguration) {
  const pool = createNeonPool(config.neon.databaseUrl);
  try {
    const scope = await deviceScope(request, pool);
    if (!scope) return json({ error: { code: "MEDIA_WORKER_UNAUTHORIZED" } }, 401);
    let value: unknown;
    try {
      value = await request.json();
    } catch {
      return json({ error: { code: "MEDIA_WORKER_HEARTBEAT_REJECTED" } }, 400);
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return json({ error: { code: "MEDIA_WORKER_HEARTBEAT_REJECTED" } }, 400);
    }
    const row = value as Record<string, unknown>;
    if (
      Object.keys(row).sort().join(",") !==
        "architecture,execution_bundle_sha256,platform,protocol_version,schema_version,worker_version" ||
      row.schema_version !== "videoforge-media-worker-heartbeat/v1" ||
      !supportedWorkerPlatform(row.platform, row.architecture) ||
      typeof row.worker_version !== "string" ||
      !WORKER_VERSION.test(row.worker_version) ||
      typeof row.execution_bundle_sha256 !== "string" ||
      !SHA256.test(row.execution_bundle_sha256) ||
      !Number.isSafeInteger(row.protocol_version) ||
      Number(row.protocol_version) < 1
    ) {
      return json({ error: { code: "MEDIA_WORKER_HEARTBEAT_REJECTED" } }, 400);
    }
    const status =
      Number(row.protocol_version) < config.mediaWorkerRelease.minimumProtocolVersion ||
      row.execution_bundle_sha256 !== config.mediaWorkerRelease.executionBundleSha256
        ? "UPDATE_REQUIRED"
        : "ONLINE";
    await pool.query("SELECT set_config($1, $2, false)", [
      "videoforge.account_id",
      scope.accountId,
    ]);
    const updated = await pool.query(
      `UPDATE media_worker_devices
          SET worker_version = $2, protocol_version = $3, execution_bundle_sha256 = $4, status = $5,
              last_seen_at = now(), updated_at = now()
        WHERE id = $1 AND platform = $6 AND architecture = $7 AND status <> 'REVOKED'
      RETURNING id`,
      [
        scope.deviceId,
        row.worker_version,
        row.protocol_version,
        row.execution_bundle_sha256,
        status,
        row.platform,
        row.architecture,
      ],
    );
    if (!updated.rows[0]) return json({ error: { code: "MEDIA_WORKER_IDENTITY_MISMATCH" } }, 409);
    return json({
      schema_version: "videoforge-media-worker-heartbeat-accepted/v1",
      status,
      minimum_protocol_version: config.mediaWorkerRelease.minimumProtocolVersion,
      claim_available: status === "ONLINE",
    });
  } finally {
    await pool.end();
  }
}

interface ClaimedAttempt extends Record<string, unknown> {
  readonly id: string;
  readonly kind: "ASR" | "RENDER";
  readonly job_spec_object_key: string;
  readonly job_spec_content_length: string | number;
  readonly job_spec_checksum_sha256: string;
  readonly deadline_at: Date | string;
}

interface PlannedAttempt extends Record<string, unknown> {
  readonly id: string;
  readonly job_spec_object_key: string;
  readonly job_spec_content_length: number | string;
  readonly job_spec_checksum_sha256: string;
  readonly created_at: Date | string;
}

/**
 * A browser request writes PLANNED before the job specification reaches R2. If the request loses
 * its response after that transaction, the normal worker claim query must not guess that the
 * object exists. Reconcile one tenant-owned residue only after an exact R2 head check; stale or
 * malformed residue becomes a durable failure so the account admission slot cannot be wedged.
 */
async function reconcilePlannedAttempt(
  environment: HostedRuntimeEnvironment,
  pool: HostedNeonPool,
  scope: DeviceScope,
): Promise<void> {
  const candidate = await createNeonExecutor(pool).transaction(async (transaction) => {
    await transaction.query("SELECT set_config($1, $2, true)", [
      "videoforge.account_id",
      scope.accountId,
    ]);
    const result = await transaction.query<PlannedAttempt>(
      `SELECT id, job_spec_object_key, job_spec_content_length, job_spec_checksum_sha256,
              created_at
         FROM hosted_cpu_job_attempts
        WHERE account_id = $1 AND workspace_id = $2
          AND execution_backend = 'PERSONAL_WORKER' AND state = 'PLANNED'
          AND deadline_at > now()
        ORDER BY created_at, id
        LIMIT 1 FOR UPDATE SKIP LOCKED`,
      [scope.accountId, scope.workspaceId],
    );
    return result.rows[0] ?? null;
  });
  if (!candidate) return;

  const object = await environment.PRIVATE_ARTIFACTS?.head(candidate.job_spec_object_key);
  const objectChecksum = object ? checksumFromR2(object.checksums?.sha256) : null;
  const exactObject = Boolean(
    object &&
      object.size === Number(candidate.job_spec_content_length) &&
      object.httpMetadata?.contentType === "application/json" &&
      objectChecksum === candidate.job_spec_checksum_sha256,
  );
  const stale =
    Date.now() - new Date(candidate.created_at).getTime() >= PLANNED_RECONCILIATION_GRACE_MS;

  await createNeonExecutor(pool).transaction(async (transaction) => {
    await transaction.query("SELECT set_config($1, $2, true)", [
      "videoforge.account_id",
      scope.accountId,
    ]);
    if (exactObject) {
      const outboxed = await transaction.query<{ id: string }>(
        `UPDATE hosted_cpu_job_attempts
            SET state = 'OUTBOXED', version = version + 1, updated_at = now()
          WHERE id = $1 AND account_id = $2 AND workspace_id = $3 AND state = 'PLANNED'
        RETURNING id`,
        [candidate.id, scope.accountId, scope.workspaceId],
      );
      if (outboxed.rows[0]) {
        await transaction.query(
          `INSERT INTO hosted_cpu_job_events (
             id, account_id, workspace_id, attempt_id, sequence, kind, facts_sha256, occurred_at
           ) SELECT md5($1::text || ':outboxed:1')::uuid, $2::uuid, $3::uuid, $1::uuid, 1, 'OUTBOXED', $4, now()
           WHERE NOT EXISTS (
             SELECT 1 FROM hosted_cpu_job_events WHERE attempt_id = $1::uuid AND kind = 'OUTBOXED'
           )`,
          [candidate.id, scope.accountId, scope.workspaceId, candidate.job_spec_checksum_sha256],
        );
      }
      return;
    }
    if (!stale) return;

    const failureFacts = await sha256(
      `PLANNED_RECONCILIATION_FAILED:${candidate.job_spec_checksum_sha256}`,
    );
    const failed = await transaction.query<{ id: string }>(
      `UPDATE hosted_cpu_job_attempts
          SET state = 'FAILED', submitted_at = COALESCE(submitted_at, now()),
              terminal_at = now(), retain_until = GREATEST(deadline_at, now() + interval '30 minutes'),
              version = version + 1, updated_at = now()
        WHERE id = $1 AND account_id = $2 AND workspace_id = $3 AND state = 'PLANNED'
      RETURNING id`,
      [candidate.id, scope.accountId, scope.workspaceId],
    );
    if (failed.rows[0]) {
      await transaction.query(
        `INSERT INTO hosted_cpu_job_events (
           id, account_id, workspace_id, attempt_id, sequence, kind, facts_sha256, occurred_at
         ) SELECT md5($1::text || ':preparation-failed:1')::uuid, $2::uuid, $3::uuid, $1::uuid, 1, 'FAILED', $4, now()
         WHERE NOT EXISTS (
           SELECT 1 FROM hosted_cpu_job_events WHERE attempt_id = $1::uuid AND kind = 'FAILED'
         )`,
        [candidate.id, scope.accountId, scope.workspaceId, failureFacts],
      );
    }
  });
}

function exactStoredTemplate(value: unknown): {
  readonly inputDocument: Record<string, unknown>;
  readonly outputs: readonly {
    readonly source: string;
    readonly object_key: string;
    readonly content_type: string;
    readonly max_bytes: number;
  }[];
  readonly result: { readonly object_key: string; readonly max_bytes: number };
  readonly tooling: Record<string, string>;
} | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).sort().join(",") !==
      "attempt_id,input_document,kind,outputs,result,schema_version,tooling" ||
    row.schema_version !== "videoforge-personal-worker-job-template/v1" ||
    typeof row.input_document !== "object" ||
    row.input_document === null ||
    Array.isArray(row.input_document) ||
    !Array.isArray(row.outputs) ||
    row.outputs.length !== 1 ||
    typeof row.result !== "object" ||
    row.result === null ||
    Array.isArray(row.result) ||
    typeof row.tooling !== "object" ||
    row.tooling === null ||
    Array.isArray(row.tooling)
  ) {
    return null;
  }
  return {
    inputDocument: row.input_document as Record<string, unknown>,
    outputs: row.outputs as never,
    result: row.result as never,
    tooling: row.tooling as Record<string, string>,
  };
}

async function claim(
  request: Request,
  environment: HostedRuntimeEnvironment,
  config: HostedRuntimeConfiguration,
) {
  const pool = createNeonPool(config.neon.databaseUrl);
  try {
    const scope = await deviceScope(request, pool);
    if (!scope) return json({ error: { code: "MEDIA_WORKER_UNAUTHORIZED" } }, 401);
    if (scope.status !== "ONLINE") {
      return json({ error: { code: "MEDIA_WORKER_HEARTBEAT_REQUIRED" } }, 409);
    }
    await pool.query("SELECT set_config($1, $2, false)", [
      "videoforge.account_id",
      scope.accountId,
    ]);
    const heartbeat = await pool.query(
      `SELECT 1
         FROM media_worker_devices
        WHERE id = $1 AND account_id = $2 AND workspace_id = $3
          AND status = 'ONLINE'
          AND last_seen_at >= now() - interval '90 seconds'`,
      [scope.deviceId, scope.accountId, scope.workspaceId],
    );
    if (!heartbeat.rows[0]) {
      return json({ error: { code: "MEDIA_WORKER_HEARTBEAT_REQUIRED" } }, 409);
    }
    if (scope.protocolVersion < config.mediaWorkerRelease.minimumProtocolVersion) {
      return json({ error: { code: "MEDIA_WORKER_UPDATE_REQUIRED" } }, 409);
    }
    if (scope.executionBundleSha256 !== config.mediaWorkerRelease.executionBundleSha256) {
      return json({ error: { code: "MEDIA_WORKER_UPDATE_REQUIRED" } }, 409);
    }
    await reconcilePlannedAttempt(environment, pool, scope);
    const leaseId = crypto.randomUUID();
    const leaseToken = await deriveScopedToken(config.mediaWorkerTokenSecret, "lease", leaseId);
    const claimed = await createNeonExecutor(pool).transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1, $2, true)", [
        "videoforge.account_id",
        scope.accountId,
      ]);
      const expiredLeases = await transaction.query<{
        id: string;
        device_id: string;
      }>(
        `UPDATE media_worker_leases
            SET state = 'EXPIRED', completed_at = now(), updated_at = now()
          WHERE account_id = $1 AND workspace_id = $2
            AND state IN ('CLAIMED', 'RUNNING', 'COMPLETING') AND lease_expires_at <= now()
          RETURNING id, device_id`,
        [scope.accountId, scope.workspaceId],
      );
      for (const lease of expiredLeases.rows) {
        const facts = await sha256(
          JSON.stringify({
            device_id: lease.device_id,
            lease_id: lease.id,
            reason: "LEASE_EXPIRED_DURING_CLAIM",
            schema_version: "videoforge-personal-worker-lease-expired/v1",
          }),
        );
        await transaction.query(
          `SELECT id
             FROM media_worker_devices
            WHERE id = $1 AND account_id = $2 AND workspace_id = $3
            FOR UPDATE`,
          [lease.device_id, scope.accountId, scope.workspaceId],
        );
        await transaction.query(
          `INSERT INTO media_worker_events (
             id, account_id, workspace_id, device_id, lease_id, sequence, kind,
             facts_sha256, occurred_at
           ) SELECT md5($1::text || ':expired:' || next.sequence::text)::uuid,
                    $2::uuid, $3::uuid, $4::uuid, $1::uuid, next.sequence, 'EXPIRED', $5, now()
                 FROM (
                   SELECT COALESCE(max(sequence), 0) + 1 AS sequence
                     FROM media_worker_events
                    WHERE account_id = $2::uuid AND workspace_id = $3::uuid AND device_id = $4::uuid
                 ) AS next
            WHERE NOT EXISTS (
              SELECT 1 FROM media_worker_events
               WHERE account_id = $2::uuid AND workspace_id = $3::uuid
                 AND device_id = $4::uuid AND lease_id = $1::uuid AND kind = 'EXPIRED'
            )`,
          [lease.id, scope.accountId, scope.workspaceId, lease.device_id, facts],
        );
      }
      const recoveredAttempts = await transaction.query<{
        id: string;
        state: "FAILED" | "OUTBOXED";
      }>(
        `UPDATE hosted_cpu_job_attempts AS attempt
            SET state = CASE WHEN replay_count >= 32 THEN 'FAILED' ELSE 'OUTBOXED' END,
                failure_code = CASE
                  WHEN replay_count >= 32 THEN 'PERSONAL_WORKER_REPLAY_LIMIT'
                  ELSE NULL
                END,
                submitted_at = CASE
                  WHEN replay_count >= 32 THEN COALESCE(submitted_at, now())
                  ELSE NULL
                END,
                terminal_at = CASE WHEN replay_count >= 32 THEN now() ELSE NULL END,
                retain_until = CASE
                  WHEN replay_count >= 32 THEN GREATEST(deadline_at, now() + interval '30 minutes')
                  ELSE retain_until
                END,
                replay_count = CASE WHEN replay_count >= 32 THEN replay_count ELSE replay_count + 1 END,
                version = version + 1, updated_at = now()
          WHERE attempt.account_id = $1 AND attempt.workspace_id = $2
            AND attempt.execution_backend = 'PERSONAL_WORKER' AND attempt.state = 'RUNNING'
            AND attempt.deadline_at > now()
            AND NOT EXISTS (
              SELECT 1 FROM media_worker_leases AS lease
               WHERE lease.attempt_id = attempt.id
                 AND lease.state IN ('CLAIMED', 'RUNNING', 'COMPLETING')
                 AND lease.lease_expires_at > now()
            )
          RETURNING attempt.id, attempt.state`,
        [scope.accountId, scope.workspaceId],
      );
      for (const recovered of recoveredAttempts.rows) {
        const eventKind = recovered.state === "FAILED" ? "FAILED" : "REPLAYED";
        const replayFacts = await sha256(
          JSON.stringify({
            attempt_id: recovered.id,
            reason:
              recovered.state === "FAILED"
                ? "PERSONAL_WORKER_REPLAY_LIMIT"
                : "ABANDONED_PERSONAL_WORKER_LEASE_DURING_CLAIM",
            schema_version:
              recovered.state === "FAILED"
                ? "videoforge-hosted-cpu-failed/v1"
                : "videoforge-hosted-cpu-replayed/v1",
          }),
        );
        await transaction.query(
          `INSERT INTO hosted_cpu_job_events (
             id, account_id, workspace_id, attempt_id, sequence, kind, facts_sha256, occurred_at
           ) SELECT md5($1::text || ':claim:' || $5::text || ':' || next.sequence::text)::uuid,
                    $2::uuid, $3::uuid, $1::uuid, next.sequence, $5, $4, now()
                 FROM (
                   SELECT COALESCE(max(sequence), 0) + 1 AS sequence
                     FROM hosted_cpu_job_events
                    WHERE account_id = $2::uuid AND workspace_id = $3::uuid AND attempt_id = $1::uuid
                 ) AS next
            WHERE NOT EXISTS (
              SELECT 1 FROM hosted_cpu_job_events
               WHERE account_id = $2::uuid AND workspace_id = $3::uuid
                 AND attempt_id = $1::uuid AND kind = $5 AND facts_sha256 = $4
            )`,
          [recovered.id, scope.accountId, scope.workspaceId, replayFacts, eventKind],
        );
      }
      const existing = await transaction.query(
        `SELECT 1 FROM media_worker_leases
          WHERE device_id = $1 AND state IN ('CLAIMED', 'RUNNING', 'COMPLETING')
            AND lease_expires_at > now()`,
        [scope.deviceId],
      );
      if (existing.rows[0]) return null;
      const attempt = await transaction.query<ClaimedAttempt>(
        `SELECT id, kind, job_spec_object_key, job_spec_content_length, job_spec_checksum_sha256,
                deadline_at
           FROM hosted_cpu_job_attempts
          WHERE account_id = $1 AND workspace_id = $2 AND execution_backend = 'PERSONAL_WORKER'
            AND state = 'OUTBOXED' AND deadline_at > now()
          ORDER BY created_at, id
          LIMIT 1 FOR UPDATE SKIP LOCKED`,
        [scope.accountId, scope.workspaceId],
      );
      const row = attempt.rows[0];
      if (!row) return null;
      await transaction.query(
        `INSERT INTO media_worker_leases (
           id, account_id, workspace_id, attempt_id, device_id, lease_token_sha256,
           state, lease_expires_at, last_heartbeat_at, claimed_at
         ) VALUES ($1,$2,$3,$4,$5,$6,'RUNNING',now() + interval '5 minutes',now(),now())`,
        [
          leaseId,
          scope.accountId,
          scope.workspaceId,
          row.id,
          scope.deviceId,
          await sha256(leaseToken),
        ],
      );
      await transaction.query(
        `UPDATE hosted_cpu_job_attempts
            SET state = 'RUNNING', submitted_at = COALESCE(submitted_at, now()),
                execution_bundle_sha256 = $2, version = version + 1, updated_at = now()
          WHERE id = $1 AND state = 'OUTBOXED'`,
        [row.id, config.mediaWorkerRelease.executionBundleSha256],
      );
      return row;
    });
    if (!claimed) return new Response(null, { status: 204 });
    const object = await environment.PRIVATE_ARTIFACTS?.get(claimed.job_spec_object_key);
    if (!object || object.size !== Number(claimed.job_spec_content_length)) {
      throw new Error("Personal worker job template is missing or has wrong size.");
    }
    const bytes = await object.arrayBuffer();
    if ((await sha256Bytes(bytes)) !== claimed.job_spec_checksum_sha256) {
      throw new Error("Personal worker job template checksum does not match durable truth.");
    }
    const template = exactStoredTemplate(JSON.parse(new TextDecoder().decode(bytes)));
    if (!template) throw new Error("Personal worker job template is malformed.");
    await pool.query("SELECT set_config($1, $2, false)", [
      "videoforge.account_id",
      scope.accountId,
    ]);
    const inputs = await pool.query(
      `SELECT uri, object_key, content_type, content_length, checksum_sha256
         FROM media_worker_input_objects WHERE attempt_id = $1 ORDER BY uri`,
      [claimed.id],
    );
    const signer = new HostedR2Signer(config.r2);
    const objects = await Promise.all(
      inputs.rows.map(async (input) => {
        const port = await signer.sign({
          method: "GET",
          objectKey: String(input.object_key),
          contentType: String(input.content_type),
          contentLength: Number(input.content_length),
          checksumSha256: String(input.checksum_sha256),
          lifetimeSeconds: 3600,
        });
        return {
          uri: input.uri,
          url: port.url,
          sha256: input.checksum_sha256,
          bytes: Number(input.content_length),
        };
      }),
    );
    const leaseBase = `${config.publicOrigin}/api/v2/media-worker/leases/${leaseId}`;
    return json({
      schema_version: "videoforge-personal-worker-claim/v1",
      lease_id: leaseId,
      lease_token: leaseToken,
      lease_expires_in_seconds: 300,
      job: {
        schema_version: "videoforge-personal-worker-job-spec/v1",
        attempt_id: claimed.id,
        kind: claimed.kind,
        expires_at: new Date(claimed.deadline_at).toISOString(),
        input_document: template.inputDocument,
        objects,
        outputs: template.outputs.map((output) => ({
          ...output,
          sign_url: `${leaseBase}/upload-port`,
        })),
        result: { ...template.result, sign_url: `${leaseBase}/upload-port` },
        cancellation_url: `${leaseBase}/heartbeat`,
        completion_url: `${leaseBase}/complete`,
        tooling: template.tooling,
      },
    });
  } finally {
    await pool.end();
  }
}

async function activeLease(
  request: Request,
  pool: HostedNeonPool,
  leaseId: string,
): Promise<(DeviceScope & { leaseToken: string; attemptId: string; state: string }) | null> {
  const scope = await deviceScope(request, pool);
  const leaseToken = request.headers.get("x-videoforge-lease-token");
  if (!scope || !leaseToken || !TOKEN.test(leaseToken)) return null;
  await pool.query("SELECT set_config($1, $2, false)", ["videoforge.account_id", scope.accountId]);
  const result = await pool.query(
    `SELECT lease.attempt_id, lease.state
       FROM media_worker_leases AS lease
       JOIN hosted_cpu_job_attempts AS attempt
         ON attempt.account_id = lease.account_id
        AND attempt.workspace_id = lease.workspace_id
        AND attempt.id = lease.attempt_id
      WHERE lease.id = $1 AND lease.device_id = $2 AND lease.lease_token_sha256 = $3
        AND lease.state IN ('CLAIMED', 'RUNNING', 'COMPLETING')
        AND lease.lease_expires_at > now()
        AND attempt.state IN ('RUNNING', 'CANCEL_REQUESTED')
        AND (attempt.deadline_at > now() OR attempt.state = 'CANCEL_REQUESTED')`,
    [leaseId, scope.deviceId, await sha256(leaseToken)],
  );
  const row = result.rows[0];
  return row
    ? { ...scope, leaseToken, attemptId: String(row.attempt_id), state: String(row.state) }
    : null;
}

async function leaseHeartbeat(
  request: Request,
  config: HostedRuntimeConfiguration,
  leaseId: string,
) {
  const pool = createNeonPool(config.neon.databaseUrl);
  try {
    const lease = await activeLease(request, pool, leaseId);
    if (!lease) return json({ error: { code: "MEDIA_WORKER_LEASE_STALE" } }, 409);
    const result = await pool.query(
      `UPDATE media_worker_leases AS lease
          SET lease_expires_at = now() + interval '5 minutes', last_heartbeat_at = now(),
              updated_at = now()
         FROM hosted_cpu_job_attempts AS attempt
        WHERE lease.id = $1 AND attempt.id = lease.attempt_id
          AND attempt.state IN ('RUNNING', 'CANCEL_REQUESTED')
          AND lease.lease_expires_at > now()
          AND (attempt.deadline_at > now() OR attempt.state = 'CANCEL_REQUESTED')
      RETURNING attempt.state`,
      [leaseId],
    );
    if (!result.rows[0]) return json({ error: { code: "MEDIA_WORKER_LEASE_STALE" } }, 409);
    const state = String(result.rows[0].state);
    return json({
      schema_version: "videoforge-personal-worker-lease-heartbeat/v1",
      cancel_requested: state === "CANCEL_REQUESTED",
      lease_expires_in_seconds: 300,
    });
  } finally {
    await pool.end();
  }
}

function exactUpload(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).sort().join(",") !==
      "checksum_sha256,content_length,content_type,object_key,schema_version,source" ||
    row.schema_version !== "videoforge-personal-worker-upload-authority/v1" ||
    !["PRIMARY_RESULT_OUTPUT", "RESULT_DOCUMENT"].includes(String(row.source)) ||
    typeof row.object_key !== "string" ||
    typeof row.content_type !== "string" ||
    !Number.isSafeInteger(row.content_length) ||
    Number(row.content_length) < 1 ||
    typeof row.checksum_sha256 !== "string" ||
    !SHA256.test(row.checksum_sha256)
  )
    return null;
  return row as {
    source: string;
    object_key: string;
    content_type: string;
    content_length: number;
    checksum_sha256: string;
  };
}

async function leaseUploadPort(
  request: Request,
  config: HostedRuntimeConfiguration,
  leaseId: string,
) {
  const pool = createNeonPool(config.neon.databaseUrl);
  try {
    const lease = await activeLease(request, pool, leaseId);
    if (!lease) return json({ error: { code: "MEDIA_WORKER_LEASE_STALE" } }, 409);
    let value: unknown;
    try {
      value = await request.json();
    } catch {
      return json({ error: { code: "MEDIA_WORKER_UPLOAD_REJECTED" } }, 400);
    }
    const upload = exactUpload(value);
    if (!upload) return json({ error: { code: "MEDIA_WORKER_UPLOAD_REJECTED" } }, 400);
    const callbackToken = await deriveCallbackToken(config.workflowCallbackSecret, lease.attemptId);
    const accepted = await pool.query(
      `SELECT videoforge_authorize_hosted_cpu_upload($1,$2,$3,$4,$5,$6,$7,now()) AS authorized`,
      [
        lease.attemptId,
        await sha256(callbackToken),
        upload.source,
        upload.object_key,
        upload.content_type,
        upload.content_length,
        upload.checksum_sha256,
      ],
    );
    if (accepted.rows[0]?.authorized !== true) {
      return json({ error: { code: "MEDIA_WORKER_UPLOAD_REJECTED" } }, 409);
    }
    const port = await new HostedR2Signer(config.r2).sign({
      method: "PUT",
      objectKey: upload.object_key,
      contentType: upload.content_type,
      contentLength: upload.content_length,
      checksumSha256: upload.checksum_sha256,
      lifetimeSeconds: 300,
    });
    return json({ schema_version: "videoforge-personal-worker-upload-port/v1", ...port });
  } finally {
    await pool.end();
  }
}

function checksumFromR2(value: ArrayBuffer | undefined): string | null {
  if (!value || value.byteLength !== 32) return null;
  return `sha256:${[...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

export type PersonalWorkerTerminalState = "SUCCEEDED" | "FAILED" | "CANCELLED";

export interface PersonalWorkerCompletion {
  readonly schema_version: "videoforge-personal-worker-completion/v1";
  readonly status: PersonalWorkerTerminalState;
  readonly failure_code: string | null;
  readonly result_object_key: string | null;
  readonly result_content_length: number | null;
  readonly result_checksum_sha256: string | null;
}

export interface PersonalWorkerTerminalLease {
  readonly state: PersonalWorkerTerminalState;
  readonly failureCode: string | null;
  readonly resultObjectKey: string | null;
  readonly resultContentLength: number | null;
  readonly resultChecksumSha256: string | null;
}

/**
 * A terminal lease is the durable source of truth after a completion response was lost. A
 * cancellation is also an authoritative fence: the first worker completion may have been
 * normalized to CANCELLED after a concurrent cancel request, so any exact-shaped replay can be
 * acknowledged as CANCELLED without mutating the terminal attempt again.
 */
export function completionMatchesTerminalLease(
  terminal: PersonalWorkerTerminalLease,
  completion: PersonalWorkerCompletion,
): boolean {
  if (terminal.state === "CANCELLED") return true;
  if (completion.status !== terminal.state) return false;
  if (terminal.state === "FAILED") {
    return (
      completion.failure_code === terminal.failureCode &&
      completion.result_object_key === null &&
      completion.result_content_length === null &&
      completion.result_checksum_sha256 === null
    );
  }
  return (
    completion.failure_code === null &&
    completion.result_object_key === terminal.resultObjectKey &&
    completion.result_content_length === terminal.resultContentLength &&
    completion.result_checksum_sha256 === terminal.resultChecksumSha256
  );
}

/** media_worker_events uses the schema-approved observation name for a cancellation. */
export function mediaWorkerTerminalEventKind(
  state: PersonalWorkerTerminalState,
): "SUCCEEDED" | "FAILED" | "CANCEL_OBSERVED" {
  return state === "CANCELLED" ? "CANCEL_OBSERVED" : state;
}

function exactCompletion(value: unknown): PersonalWorkerCompletion | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).sort().join(",") !==
      "failure_code,result_checksum_sha256,result_content_length,result_object_key,schema_version,status" ||
    row.schema_version !== "videoforge-personal-worker-completion/v1" ||
    !["SUCCEEDED", "FAILED", "CANCELLED"].includes(String(row.status))
  )
    return null;
  if (
    row.status === "SUCCEEDED" &&
    (typeof row.result_object_key !== "string" ||
      !Number.isSafeInteger(row.result_content_length) ||
      Number(row.result_content_length) < 1 ||
      typeof row.result_checksum_sha256 !== "string" ||
      !SHA256.test(row.result_checksum_sha256) ||
      row.failure_code !== null)
  )
    return null;
  if (
    row.status !== "SUCCEEDED" &&
    (row.result_object_key !== null ||
      row.result_content_length !== null ||
      row.result_checksum_sha256 !== null ||
      (row.status === "FAILED" &&
        (typeof row.failure_code !== "string" ||
          !/^[A-Z][A-Z0-9_]{2,63}$/u.test(row.failure_code))) ||
      (row.status === "CANCELLED" && row.failure_code !== null))
  )
    return null;
  return row as unknown as PersonalWorkerCompletion;
}

async function terminalLeaseForCompletion(
  request: Request,
  pool: HostedNeonPool,
  leaseId: string,
): Promise<
  | (DeviceScope & {
      readonly leaseToken: string;
      readonly attemptId: string;
    } & PersonalWorkerTerminalLease)
  | null
> {
  const scope = await deviceScope(request, pool);
  const leaseToken = request.headers.get("x-videoforge-lease-token");
  if (!scope || !leaseToken || !TOKEN.test(leaseToken)) return null;
  await pool.query("SELECT set_config($1, $2, false)", ["videoforge.account_id", scope.accountId]);
  const result = await pool.query<{
    attempt_id: string;
    state: string;
    attempt_state: string;
    failure_code: string | null;
    result_object_key: string | null;
    result_content_length: number | string | null;
    result_checksum_sha256: string | null;
  }>(
    `SELECT lease.attempt_id, lease.state, attempt.state AS attempt_state, lease.failure_code,
            attempt.result_object_key, attempt.result_content_length, attempt.result_checksum_sha256
       FROM media_worker_leases AS lease
       JOIN hosted_cpu_job_attempts AS attempt
         ON attempt.account_id = lease.account_id
        AND attempt.workspace_id = lease.workspace_id
        AND attempt.id = lease.attempt_id
      WHERE lease.id = $1 AND lease.device_id = $2 AND lease.lease_token_sha256 = $3
        AND lease.state IN ('SUCCEEDED', 'FAILED', 'CANCELLED')
        AND attempt.state = lease.state
        AND attempt.state IN ('SUCCEEDED', 'FAILED', 'CANCELLED')`,
    [leaseId, scope.deviceId, await sha256(leaseToken)],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    ...scope,
    leaseToken,
    attemptId: String(row.attempt_id),
    state: row.state as PersonalWorkerTerminalState,
    failureCode: row.failure_code === null ? null : String(row.failure_code),
    resultObjectKey: row.result_object_key === null ? null : String(row.result_object_key),
    resultContentLength:
      row.result_content_length === null ? null : Number(row.result_content_length),
    resultChecksumSha256:
      row.result_checksum_sha256 === null ? null : String(row.result_checksum_sha256),
  };
}

function completionAccepted(state: PersonalWorkerTerminalState): Response {
  return json({
    schema_version: "videoforge-personal-worker-completion-accepted/v1",
    state,
  });
}

async function completeLease(
  request: Request,
  environment: HostedRuntimeEnvironment,
  config: HostedRuntimeConfiguration,
  leaseId: string,
) {
  const pool = createNeonPool(config.neon.databaseUrl);
  try {
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return json({ error: { code: "MEDIA_WORKER_COMPLETION_REJECTED" } }, 400);
    }
    const completion = exactCompletion(raw);
    if (!completion) return json({ error: { code: "MEDIA_WORKER_COMPLETION_REJECTED" } }, 400);
    const lease = await activeLease(request, pool, leaseId);
    if (!lease) {
      const terminal = await terminalLeaseForCompletion(request, pool, leaseId);
      if (!terminal || !completionMatchesTerminalLease(terminal, completion)) {
        return json({ error: { code: "MEDIA_WORKER_LEASE_STALE" } }, 409);
      }
      return completionAccepted(terminal.state);
    }
    let receipt: string | null = null;
    if (completion.status === "SUCCEEDED") {
      const callbackToken = await deriveCallbackToken(
        config.workflowCallbackSecret,
        lease.attemptId,
      );
      const primary = await pool.query(
        `SELECT * FROM videoforge_hosted_cpu_expected_primary_output($1, $2)`,
        [lease.attemptId, await sha256(callbackToken)],
      );
      const expected = primary.rows[0];
      const expectedResultQuery = await pool.query(
        `SELECT object_key, content_type, issued_content_length, issued_checksum_sha256
           FROM hosted_cpu_upload_authorities
          WHERE account_id = $1 AND workspace_id = $2 AND attempt_id = $3
            AND source = 'RESULT_DOCUMENT' AND issued_at IS NOT NULL`,
        [lease.accountId, lease.workspaceId, lease.attemptId],
      );
      const expectedResult = expectedResultQuery.rows[0];
      const bucket = environment.PRIVATE_ARTIFACTS;
      if (!expected || !expectedResult || !bucket) {
        return json({ error: { code: "MEDIA_WORKER_RESULT_MISSING" } }, 409);
      }
      if (
        completion.result_object_key !== expectedResult.object_key ||
        Number(completion.result_content_length) !== Number(expectedResult.issued_content_length) ||
        completion.result_checksum_sha256 !== expectedResult.issued_checksum_sha256 ||
        expectedResult.content_type !== "application/json"
      ) {
        return json({ error: { code: "MEDIA_WORKER_RESULT_MISMATCH" } }, 409);
      }
      const primaryObject = await bucket.head(String(expected.object_key));
      if (
        !primaryObject ||
        primaryObject.size !== Number(expected.content_length) ||
        primaryObject.httpMetadata?.contentType !== expected.content_type ||
        checksumFromR2(primaryObject.checksums?.sha256) !== expected.checksum_sha256
      ) {
        return json({ error: { code: "MEDIA_WORKER_RESULT_MISMATCH" } }, 409);
      }
      const resultObject = await bucket.get(String(completion.result_object_key));
      if (
        !resultObject ||
        resultObject.size !== Number(completion.result_content_length) ||
        resultObject.httpMetadata?.contentType !== "application/json"
      ) {
        return json({ error: { code: "MEDIA_WORKER_RESULT_MISMATCH" } }, 409);
      }
      const bytes = await resultObject.arrayBuffer();
      try {
        JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        return json({ error: { code: "MEDIA_WORKER_RESULT_MISMATCH" } }, 409);
      }
      if ((await sha256Bytes(bytes)) !== completion.result_checksum_sha256) {
        return json({ error: { code: "MEDIA_WORKER_RESULT_MISMATCH" } }, 409);
      }
      receipt = await sha256(
        JSON.stringify({
          attempt_id: lease.attemptId,
          content_length: completion.result_content_length,
          object_key: completion.result_object_key,
          result_checksum_sha256: completion.result_checksum_sha256,
        }),
      );
    }
    const settled = await createNeonExecutor(pool).transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1, $2, true)", [
        "videoforge.account_id",
        lease.accountId,
      ]);
      const current = await transaction.query<{ state: string }>(
        `SELECT state FROM hosted_cpu_job_attempts WHERE id = $1 FOR UPDATE`,
        [lease.attemptId],
      );
      const attemptState = current.rows[0]?.state;
      if (!attemptState || !["RUNNING", "CANCEL_REQUESTED"].includes(attemptState)) return null;
      const state: PersonalWorkerTerminalState =
        attemptState === "CANCEL_REQUESTED" || completion.status === "CANCELLED"
          ? "CANCELLED"
          : completion.status;
      const leaseUpdated = await transaction.query(
        `UPDATE media_worker_leases
            SET state = $2, completed_at = now(), failure_code = $3, updated_at = now()
          WHERE id = $1 AND state IN ('CLAIMED', 'RUNNING', 'COMPLETING')
            AND lease_expires_at > now()
        RETURNING id`,
        [leaseId, state, state === "FAILED" ? String(completion.failure_code) : null],
      );
      if (!leaseUpdated.rows[0]) return null;
      await transaction.query(
        `UPDATE hosted_cpu_job_attempts
            SET state = $2, terminal_at = now(),
                retain_until = CASE WHEN $2 = 'SUCCEEDED' THEN NULL
                                    ELSE GREATEST(deadline_at, now() + interval '30 minutes') END,
                result_object_key = CASE WHEN $2 = 'SUCCEEDED' THEN $3 ELSE result_object_key END,
                result_content_length = CASE WHEN $2 = 'SUCCEEDED' THEN $4 ELSE NULL END,
                result_checksum_sha256 = CASE WHEN $2 = 'SUCCEEDED' THEN $5 ELSE NULL END,
                result_receipt_sha256 = CASE WHEN $2 = 'SUCCEEDED' THEN $6 ELSE NULL END,
                version = version + 1, updated_at = now()
          WHERE id = $1`,
        [
          lease.attemptId,
          state,
          completion.result_object_key === null ? null : String(completion.result_object_key),
          completion.result_content_length === null
            ? null
            : Number(completion.result_content_length),
          completion.result_checksum_sha256 === null
            ? null
            : String(completion.result_checksum_sha256),
          receipt,
        ],
      );
      const terminalFactsSha256 = await sha256(
        JSON.stringify({
          schema_version: "videoforge-personal-worker-terminal/v1",
          attempt_id: lease.attemptId,
          lease_id: leaseId,
          state,
          failure_code: state === "FAILED" ? completion.failure_code : null,
          result_object_key: state === "SUCCEEDED" ? completion.result_object_key : null,
          result_content_length: state === "SUCCEEDED" ? completion.result_content_length : null,
          result_checksum_sha256: state === "SUCCEEDED" ? completion.result_checksum_sha256 : null,
        }),
      );
      await transaction.query(
        `INSERT INTO hosted_cpu_job_events (
           id, account_id, workspace_id, attempt_id, sequence, kind, facts_sha256, occurred_at
         ) SELECT md5($1::text || ':personal-worker-terminal:' || $5 || ':' || next.sequence::text)::uuid,
                  $2::uuid, $3::uuid, $1::uuid, next.sequence, $5, $4, now()
             FROM (
               SELECT COALESCE(max(sequence), 0) + 1 AS sequence
                 FROM hosted_cpu_job_events
                WHERE account_id = $2::uuid AND workspace_id = $3::uuid AND attempt_id = $1::uuid
             ) AS next
            WHERE NOT EXISTS (
              SELECT 1 FROM hosted_cpu_job_events
               WHERE account_id = $2::uuid AND workspace_id = $3::uuid
                 AND attempt_id = $1::uuid AND kind = $5
            )`,
        [lease.attemptId, lease.accountId, lease.workspaceId, terminalFactsSha256, state],
      );
      await transaction.query(
        `SELECT id
           FROM media_worker_devices
          WHERE id = $1 AND account_id = $2 AND workspace_id = $3
          FOR UPDATE`,
        [lease.deviceId, lease.accountId, lease.workspaceId],
      );
      const mediaEventKind = mediaWorkerTerminalEventKind(state);
      await transaction.query(
        `INSERT INTO media_worker_events (
           id, account_id, workspace_id, device_id, lease_id, sequence, kind,
           facts_sha256, occurred_at
         ) SELECT md5($1::text || ':personal-worker-terminal:' || $5 || ':' || next.sequence::text)::uuid,
                  $2::uuid, $3::uuid, $4::uuid, $1::uuid, next.sequence, $5, $6, now()
             FROM (
               SELECT COALESCE(max(sequence), 0) + 1 AS sequence
                 FROM media_worker_events
                WHERE account_id = $2::uuid AND workspace_id = $3::uuid AND device_id = $4::uuid
             ) AS next
            WHERE NOT EXISTS (
              SELECT 1 FROM media_worker_events
               WHERE account_id = $2::uuid AND workspace_id = $3::uuid
                 AND device_id = $4::uuid AND lease_id = $1::uuid AND kind = $5
            )`,
        [
          leaseId,
          lease.accountId,
          lease.workspaceId,
          lease.deviceId,
          mediaEventKind,
          terminalFactsSha256,
        ],
      );
      await transaction.query(
        `UPDATE media_worker_devices
            SET status = 'ONLINE', last_seen_at = now(), updated_at = now()
          WHERE id = $1 AND status <> 'REVOKED'`,
        [lease.deviceId],
      );
      return state;
    });
    if (settled) return completionAccepted(settled);
    const terminal = await terminalLeaseForCompletion(request, pool, leaseId);
    if (!terminal || !completionMatchesTerminalLease(terminal, completion)) {
      return json({ error: { code: "MEDIA_WORKER_LEASE_STALE" } }, 409);
    }
    return completionAccepted(terminal.state);
  } finally {
    await pool.end();
  }
}

export async function handlePersonalWorkerRequest(
  request: Request,
  environment: HostedRuntimeEnvironment,
  executionContext: HostedExecutionContext,
): Promise<Response | null> {
  const config = hostedRuntimeConfiguration(environment);
  const url = new URL(request.url);
  if (request.method === "POST" && url.pathname === "/api/v2/media-worker-enrollments") {
    return createEnrollment(request, config);
  }
  const enrollment =
    /^\/api\/v2\/media-worker-enrollments\/([0-9a-f-]+)(?:\/(approve|token))?$/u.exec(url.pathname);
  if (enrollment && UUID.test(enrollment[1]!)) {
    if (request.method === "GET" && !enrollment[2])
      return enrollmentForBrowser(request, config, executionContext, enrollment[1]!);
    if (request.method === "POST" && enrollment[2] === "approve")
      return approveEnrollment(request, config, executionContext, enrollment[1]!);
    if (request.method === "POST" && enrollment[2] === "token")
      return pollEnrollment(request, config, enrollment[1]!);
  }
  if (request.method === "GET" && url.pathname === "/api/v2/media-workers") {
    return listDevices(request, config, executionContext);
  }
  const revoke = /^\/api\/v2\/media-workers\/([0-9a-f-]+)\/revoke$/u.exec(url.pathname);
  if (request.method === "POST" && revoke && UUID.test(revoke[1]!)) {
    return revokeDevice(request, config, executionContext, revoke[1]!);
  }
  if (request.method === "POST" && url.pathname === "/api/v2/media-worker/heartbeat") {
    return heartbeat(request, config);
  }
  if (request.method === "POST" && url.pathname === "/api/v2/media-worker/claim") {
    return claim(request, environment, config);
  }
  const lease =
    /^\/api\/v2\/media-worker\/leases\/([0-9a-f-]+)\/(heartbeat|upload-port|complete)$/u.exec(
      url.pathname,
    );
  if (request.method === "POST" && lease && UUID.test(lease[1]!)) {
    if (lease[2] === "heartbeat") return leaseHeartbeat(request, config, lease[1]!);
    if (lease[2] === "upload-port") return leaseUploadPort(request, config, lease[1]!);
    return completeLease(request, environment, config, lease[1]!);
  }
  return null;
}

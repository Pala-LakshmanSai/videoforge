import { createHostedAuth, type HostedExecutionContext } from "./auth";
import type {
  HostedNeonPool,
  HostedRuntimeConfiguration,
  HostedRuntimeEnvironment,
} from "./configuration";
import { sha256 } from "./crypto";
import { hostedGpuReadiness } from "./gpu-readiness";
import { createNeonExecutor, createNeonPool } from "./neon";
import { HostedR2Signer } from "./r2";
import { canonicalJson, exactHostedRenderSubmission } from "./submission";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const IDEMPOTENCY = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,159}$/u;
const VOICEOVER_TYPES = new Set(["audio/wav", "audio/flac", "audio/mpeg", "audio/mp4"]);
// Migration 0002 requires every revision budget to be at least $0.10. This is only the
// persisted revision ceiling; V2-06 personal-worker execution remains provider-free at $0.
const PERSONAL_WORKER_MINIMUM_COST_MICRO_USD = 100_000;

function validFilename(value: string): boolean {
  return (
    value.length >= 1 &&
    value.length <= 160 &&
    !value.includes("/") &&
    !value.includes("\\") &&
    [...value].every((character) => character.charCodeAt(0) >= 32)
  );
}

interface HostedScope extends Record<string, unknown> {
  readonly user_id: string;
  readonly account_id: string;
  readonly workspace_id: string;
}

interface ProjectCreateInput {
  readonly title: string;
  readonly avatarVersionId: string;
  readonly styleVersionId: string;
  readonly voiceover: {
    readonly filename: string;
    readonly contentType: string;
    readonly contentLength: number;
    readonly checksumSha256: string;
    readonly durationMs: number;
  };
}

function response(value: unknown, status = 200): Response {
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

function sameOrigin(request: Request, config: HostedRuntimeConfiguration): boolean {
  return request.headers.get("origin") === new URL(config.publicOrigin).origin;
}

async function sessionScope(
  request: Request,
  config: HostedRuntimeConfiguration,
  pool: HostedNeonPool,
  executionContext: HostedExecutionContext,
): Promise<HostedScope | Response> {
  const session = await createHostedAuth({ config, pool, executionContext }).api.getSession({
    headers: request.headers,
  });
  if (!session?.user?.id) return response({ error: { code: "AUTHENTICATION_REQUIRED" } }, 401);
  const result = await pool.query<HostedScope>(
    `SELECT user_id, account_id, workspace_id
       FROM videoforge_hosted_session_scope($1)`,
    [session.session.token],
  );
  const scope = result.rows[0];
  if (!scope) return response({ error: { code: "INVITE_ADMISSION_REQUIRED" } }, 403);
  return scope;
}

function parseCreate(value: unknown): ProjectCreateInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !==
      "avatar_profile_version_id,image_style_version_id,schema_version,title,voiceover" ||
    record.schema_version !== "videoforge-hosted-project-create/v1" ||
    typeof record.title !== "string" ||
    record.title !== record.title.trim() ||
    record.title.length < 1 ||
    record.title.length > 240 ||
    typeof record.avatar_profile_version_id !== "string" ||
    !UUID.test(record.avatar_profile_version_id) ||
    typeof record.image_style_version_id !== "string" ||
    !UUID.test(record.image_style_version_id) ||
    !record.voiceover ||
    typeof record.voiceover !== "object" ||
    Array.isArray(record.voiceover)
  ) {
    return null;
  }
  const voiceover = record.voiceover as Record<string, unknown>;
  if (
    Object.keys(voiceover).sort().join(",") !==
      "checksum_sha256,content_length,content_type,duration_ms,filename" ||
    typeof voiceover.filename !== "string" ||
    !validFilename(voiceover.filename) ||
    typeof voiceover.content_type !== "string" ||
    !VOICEOVER_TYPES.has(voiceover.content_type) ||
    !Number.isSafeInteger(voiceover.content_length) ||
    Number(voiceover.content_length) < 1 ||
    Number(voiceover.content_length) > 512 * 1024 * 1024 ||
    typeof voiceover.checksum_sha256 !== "string" ||
    !SHA256.test(voiceover.checksum_sha256) ||
    !Number.isSafeInteger(voiceover.duration_ms) ||
    Number(voiceover.duration_ms) < 10_000 ||
    Number(voiceover.duration_ms) > 3_600_000
  ) {
    return null;
  }
  return {
    title: record.title,
    avatarVersionId: record.avatar_profile_version_id,
    styleVersionId: record.image_style_version_id,
    voiceover: {
      filename: voiceover.filename,
      contentType: voiceover.content_type,
      contentLength: Number(voiceover.content_length),
      checksumSha256: voiceover.checksum_sha256,
      durationMs: Number(voiceover.duration_ms),
    },
  };
}

function parseRenderHandoff(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || typeof record.asr_attempt_id !== "string") return null;
  return UUID.test(record.asr_attempt_id) ? record.asr_attempt_id : null;
}

function checksumFromR2(value?: ArrayBuffer): string | null {
  if (!value || value.byteLength !== 32) return null;
  return `sha256:${[...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function voiceoverExtension(contentType: string): string {
  return contentType === "audio/wav"
    ? "wav"
    : contentType === "audio/flac"
      ? "flac"
      : contentType === "audio/mpeg"
        ? "mp3"
        : "m4a";
}

function postgresCode(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  return typeof error.code === "string" ? error.code : null;
}

async function catalog(
  request: Request,
  config: HostedRuntimeConfiguration,
  executionContext: HostedExecutionContext,
): Promise<Response> {
  const pool = createNeonPool(config.neon.databaseUrl);
  try {
    const scope = await sessionScope(request, config, pool, executionContext);
    if (scope instanceof Response) return scope;
    const data = await createNeonExecutor(pool).transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1, $2, true)", [
        "videoforge.account_id",
        scope.account_id,
      ]);
      const avatars = await transaction.query(
        `SELECT profile.id AS profile_id, version.id AS version_id, profile.name,
                version.version_number
           FROM avatar_profiles AS profile
           JOIN avatar_profile_versions AS version
             ON version.account_id = profile.account_id
            AND version.workspace_id = profile.workspace_id
            AND version.profile_id = profile.id
          WHERE profile.account_id = $1 AND profile.workspace_id = $2
            AND profile.status = 'ACTIVE' AND version.state = 'READY'
          ORDER BY profile.name, version.version_number DESC`,
        [scope.account_id, scope.workspace_id],
      );
      const styles = await transaction.query(
        `SELECT style.id AS style_id, version.id AS version_id, style.name,
                version.version_number
           FROM image_styles AS style
           JOIN image_style_versions AS version
             ON version.account_id = style.account_id
            AND version.workspace_id = style.workspace_id
            AND version.style_id = style.id
          WHERE style.account_id = $1 AND style.workspace_id = $2
            AND style.status = 'ACTIVE' AND version.state = 'PUBLISHED'
          ORDER BY style.name, version.version_number DESC`,
        [scope.account_id, scope.workspace_id],
      );
      const workers = await transaction.query<{ count: string | number }>(
        `SELECT count(*) AS count FROM media_worker_devices
          WHERE account_id = $1 AND workspace_id = $2
            AND status IN ('ONLINE', 'BUSY')`,
        [scope.account_id, scope.workspace_id],
      );
      return {
        avatars: avatars.rows,
        styles: styles.rows,
        workers: Number(workers.rows[0]?.count ?? 0),
      };
    });
    return response({
      schema_version: "videoforge-hosted-project-catalog/v1",
      avatars: data.avatars,
      styles: data.styles,
      media_worker_state: data.workers > 0 ? "ONLINE" : "WAITING_FOR_YOUR_COMPUTER",
      gpu_transport: "DISABLED_UNQUALIFIED",
      gpu_readiness: hostedGpuReadiness(),
    });
  } finally {
    await pool.end();
  }
}

async function createProject(
  request: Request,
  environment: HostedRuntimeEnvironment,
  config: HostedRuntimeConfiguration,
  executionContext: HostedExecutionContext,
): Promise<Response> {
  if (!sameOrigin(request, config))
    return response({ error: { code: "HOSTED_BROWSER_ORIGIN_REJECTED" } }, 403);
  const idempotencyKey = request.headers.get("idempotency-key") ?? "";
  if (!IDEMPOTENCY.test(idempotencyKey))
    return response({ error: { code: "PROJECT_IDEMPOTENCY_REQUIRED" } }, 400);
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return response({ error: { code: "PROJECT_CREATE_REJECTED" } }, 400);
  }
  const input = parseCreate(raw);
  if (!input) return response({ error: { code: "PROJECT_CREATE_REJECTED" } }, 400);
  const bucket = environment.PRIVATE_ARTIFACTS;
  if (!bucket) return response({ error: { code: "HOSTED_ARTIFACTS_UNAVAILABLE" } }, 503);
  const pool = createNeonPool(config.neon.databaseUrl);
  try {
    const scope = await sessionScope(request, config, pool, executionContext);
    if (scope instanceof Response) return scope;
    const requestSha256 = await sha256(canonicalJson(raw));
    const prepared = await createNeonExecutor(pool).transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1, $2, true)", [
        "videoforge.account_id",
        scope.account_id,
      ]);
      const existing = await transaction.query<Record<string, unknown>>(
        `SELECT request.request_sha256, request.state, request.project_id,
                request.project_revision_id, request.upload_reservation_id,
                reservation.object_key, reservation.content_type,
                reservation.content_length, reservation.checksum_sha256,
                reservation.expires_at
           FROM hosted_project_create_requests AS request
           JOIN artifact_reservations AS reservation
             ON reservation.account_id = request.account_id
            AND reservation.workspace_id = request.workspace_id
            AND reservation.id = request.upload_reservation_id
          WHERE request.account_id = $1 AND request.workspace_id = $2
            AND request.idempotency_key = $3`,
        [scope.account_id, scope.workspace_id, idempotencyKey],
      );
      const replay = existing.rows[0];
      if (replay) {
        if (replay.request_sha256 !== requestSha256)
          throw new Error("PROJECT_IDEMPOTENCY_CONFLICT");
        return replay;
      }
      const avatar = await transaction.query<Record<string, unknown>>(
        `SELECT profile.id AS profile_id, version.id AS version_id, version.profile_hash,
                version.runtime_source_asset_id, version.runtime_source_binary_sha256,
                version.source_preparation_profile, version.source_validation_profile
           FROM avatar_profiles AS profile
           JOIN avatar_profile_versions AS version
             ON version.account_id = profile.account_id
            AND version.workspace_id = profile.workspace_id
            AND version.profile_id = profile.id
          WHERE profile.account_id = $1 AND profile.workspace_id = $2
            AND version.id = $3 AND profile.status = 'ACTIVE' AND version.state = 'READY'`,
        [scope.account_id, scope.workspace_id, input.avatarVersionId],
      );
      const style = await transaction.query<Record<string, unknown>>(
        `SELECT style.id AS style_id, version.id AS version_id, version.style_profile_hash
           FROM image_styles AS style
           JOIN image_style_versions AS version
             ON version.account_id = style.account_id
            AND version.workspace_id = style.workspace_id
            AND version.style_id = style.id
          WHERE style.account_id = $1 AND style.workspace_id = $2
            AND version.id = $3 AND style.status = 'ACTIVE' AND version.state = 'PUBLISHED'`,
        [scope.account_id, scope.workspace_id, input.styleVersionId],
      );
      if (!avatar.rows[0] || !style.rows[0]) throw new Error("PROJECT_PRESET_NOT_READY");
      const projectId = crypto.randomUUID();
      const revisionId = crypto.randomUUID();
      const assetId = crypto.randomUUID();
      const reservationId = crypto.randomUUID();
      const receiptId = crypto.randomUUID();
      const objectKey =
        `tenant/${scope.account_id}/workspace/${scope.workspace_id}/project/${projectId}` +
        `/revision/${revisionId}/lane/input/job/browser-upload/artifact/voiceover`;
      const revisionPayload = {
        schema_version: "videoforge-hosted-revision-config/v1",
        title: input.title,
        voiceover_sha256: input.voiceover.checksumSha256,
        avatar_profile_version_id: input.avatarVersionId,
        image_style_version_id: input.styleVersionId,
        generation_mode: "LOWEST_COST",
        gpu_transport: "DISABLED_UNQUALIFIED",
      };
      const revisionHash = await sha256(canonicalJson(revisionPayload));
      await transaction.query(
        `INSERT INTO projects (id, workspace_id, owner_user_id, name, normalized_name)
         VALUES ($1,$2,$3,$4,lower($4))`,
        [projectId, scope.workspace_id, scope.user_id, input.title],
      );
      await transaction.query(
        `INSERT INTO assets (
           id, workspace_id, project_id, project_revision_id, kind, state, object_key,
           binary_sha256, content_type, byte_size, duration_ms, metadata
         ) VALUES ($1,$2,$3,NULL,'VOICEOVER','UPLOADING',$4,$5,$6,$7,$8,$9::jsonb)`,
        [
          assetId,
          scope.workspace_id,
          projectId,
          objectKey,
          input.voiceover.checksumSha256,
          input.voiceover.contentType,
          input.voiceover.contentLength,
          input.voiceover.durationMs,
          JSON.stringify({ filename: input.voiceover.filename }),
        ],
      );
      await transaction.query(
        `INSERT INTO project_revisions (
           id, workspace_id, project_id, revision_number, status, title,
           voiceover_asset_id, voiceover_binary_sha256,
           avatar_profile_id, avatar_profile_version_id, avatar_profile_hash,
           avatar_runtime_source_asset_id, avatar_runtime_source_binary_sha256,
           avatar_source_preparation_profile, avatar_source_validation_profile,
           avatar_compatibility_state, avatar_compatibility_assessment_id,
           avatar_compatibility_evidence_hash,
           image_style_id, image_style_version_id, style_profile_hash,
           extra_prompt_keywords, apply_extra_prompt_keywords, generation_mode,
           maximum_cost_micro_usd, seed, revision_config_contract_name,
           revision_config_contract_version, revision_config_payload, revision_config_hash,
           created_by_user_id
         ) VALUES (
           $1,$2,$3,1,'DRAFT',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
           'UNTESTED',NULL,NULL,$14,$15,$16,'',false,'LOWEST_COST',$17,$18,
           'videoforge-hosted-revision-config','v1',$19::jsonb,$20,$21
         )`,
        [
          revisionId,
          scope.workspace_id,
          projectId,
          input.title,
          assetId,
          input.voiceover.checksumSha256,
          String(avatar.rows[0].profile_id),
          String(avatar.rows[0].version_id),
          String(avatar.rows[0].profile_hash),
          String(avatar.rows[0].runtime_source_asset_id),
          String(avatar.rows[0].runtime_source_binary_sha256),
          String(avatar.rows[0].source_preparation_profile),
          String(avatar.rows[0].source_validation_profile),
          String(style.rows[0].style_id),
          String(style.rows[0].version_id),
          String(style.rows[0].style_profile_hash),
          PERSONAL_WORKER_MINIMUM_COST_MICRO_USD,
          Math.floor(Math.random() * 2_147_483_647),
          JSON.stringify(revisionPayload),
          revisionHash,
          scope.user_id,
        ],
      );
      await transaction.query(`UPDATE assets SET project_revision_id = $1 WHERE id = $2`, [
        revisionId,
        assetId,
      ]);
      await transaction.query(
        `INSERT INTO artifact_reservations (
           id, account_id, workspace_id, project_id, project_revision_id, asset_id,
           lane, job_id, artifact_id, object_key, method, content_type, content_length,
           checksum_sha256, expires_at, max_uses, retention_class, deletion_owner_account_id
         ) VALUES ($1,$2,$3,$4,$5,$6,'INPUT','browser-upload','voiceover',$7,'PUT',$8,$9,$10,
                   now() + interval '15 minutes',1,'PROJECT',$2)`,
        [
          reservationId,
          scope.account_id,
          scope.workspace_id,
          projectId,
          revisionId,
          assetId,
          objectKey,
          input.voiceover.contentType,
          input.voiceover.contentLength,
          input.voiceover.checksumSha256,
        ],
      );
      await transaction.query(
        `INSERT INTO hosted_project_create_requests (
           id, account_id, workspace_id, idempotency_key, request_sha256, project_id,
           project_revision_id, voiceover_asset_id, upload_reservation_id,
           upload_receipt_id, state
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'UPLOAD_PENDING')`,
        [
          crypto.randomUUID(),
          scope.account_id,
          scope.workspace_id,
          idempotencyKey,
          requestSha256,
          projectId,
          revisionId,
          assetId,
          reservationId,
          receiptId,
        ],
      );
      return {
        request_sha256: requestSha256,
        state: "UPLOAD_PENDING",
        project_id: projectId,
        project_revision_id: revisionId,
        upload_reservation_id: reservationId,
        object_key: objectKey,
        content_type: input.voiceover.contentType,
        content_length: input.voiceover.contentLength,
        checksum_sha256: input.voiceover.checksumSha256,
        expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
      };
    });
    if (prepared.state === "READY") {
      return response({
        schema_version: "videoforge-hosted-project-create-response/v1",
        project_id: prepared.project_id,
        project_revision_id: prepared.project_revision_id,
        state: "READY",
        upload: null,
      });
    }
    const port = await new HostedR2Signer(config.r2).sign({
      method: "PUT",
      objectKey: String(prepared.object_key),
      contentType: String(prepared.content_type),
      contentLength: Number(prepared.content_length),
      checksumSha256: String(prepared.checksum_sha256),
      lifetimeSeconds: 900,
    });
    return response(
      {
        schema_version: "videoforge-hosted-project-create-response/v1",
        project_id: prepared.project_id,
        project_revision_id: prepared.project_revision_id,
        state: "UPLOAD_PENDING",
        upload: port,
      },
      201,
    );
  } catch (error) {
    if (error instanceof Error && error.message === "PROJECT_IDEMPOTENCY_CONFLICT")
      return response({ error: { code: error.message } }, 409);
    if (error instanceof Error && error.message === "PROJECT_PRESET_NOT_READY")
      return response({ error: { code: error.message } }, 409);
    if (postgresCode(error) === "23505")
      return response({ error: { code: "PROJECT_TITLE_CONFLICT" } }, 409);
    throw error;
  } finally {
    await pool.end();
  }
}

async function commitProject(
  request: Request,
  projectId: string,
  environment: HostedRuntimeEnvironment,
  config: HostedRuntimeConfiguration,
  executionContext: HostedExecutionContext,
): Promise<Response> {
  if (!UUID.test(projectId)) return response({ error: { code: "PROJECT_NOT_FOUND" } }, 404);
  if (!sameOrigin(request, config))
    return response({ error: { code: "HOSTED_BROWSER_ORIGIN_REJECTED" } }, 403);
  const bucket = environment.PRIVATE_ARTIFACTS;
  if (!bucket) return response({ error: { code: "HOSTED_ARTIFACTS_UNAVAILABLE" } }, 503);
  const pool = createNeonPool(config.neon.databaseUrl);
  try {
    const scope = await sessionScope(request, config, pool, executionContext);
    if (scope instanceof Response) return scope;
    const pending = await createNeonExecutor(pool).transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1, $2, true)", [
        "videoforge.account_id",
        scope.account_id,
      ]);
      const result = await transaction.query<Record<string, unknown>>(
        `SELECT request.state, request.project_revision_id, request.voiceover_asset_id,
                request.upload_reservation_id, request.upload_receipt_id,
                reservation.object_key, reservation.content_type, reservation.content_length,
                reservation.checksum_sha256, reservation.expires_at,
                asset.duration_ms, asset.metadata
           FROM hosted_project_create_requests AS request
           JOIN artifact_reservations AS reservation
             ON reservation.account_id = request.account_id
            AND reservation.workspace_id = request.workspace_id
            AND reservation.id = request.upload_reservation_id
           JOIN assets AS asset
             ON asset.account_id = request.account_id
            AND asset.workspace_id = request.workspace_id
            AND asset.id = request.voiceover_asset_id
          WHERE request.account_id = $1 AND request.workspace_id = $2 AND request.project_id = $3`,
        [scope.account_id, scope.workspace_id, projectId],
      );
      return result.rows[0];
    });
    if (!pending) return response({ error: { code: "PROJECT_NOT_FOUND" } }, 404);
    const replay = pending.state === "READY";
    if (!replay && new Date(String(pending.expires_at)).getTime() <= Date.now())
      return response({ error: { code: "VOICEOVER_UPLOAD_EXPIRED" } }, 409);
    if (!replay) {
      const object = await bucket.head(String(pending.object_key));
      if (
        !object ||
        object.size !== Number(pending.content_length) ||
        object.httpMetadata?.contentType !== pending.content_type ||
        checksumFromR2(object.checksums?.sha256) !== pending.checksum_sha256
      ) {
        return response({ error: { code: "VOICEOVER_UPLOAD_NOT_VERIFIED" } }, 409);
      }
    }
    const committedAt = new Date().toISOString();
    const receiptFacts = {
      schema_version: "artifact-commit-receipt/v3",
      receipt_id: pending.upload_receipt_id,
      reservation_id: pending.upload_reservation_id,
      account_id: scope.account_id,
      workspace_id: scope.workspace_id,
      object_key: pending.object_key,
      callback_id: `browser-upload-${projectId}`,
      content_type: pending.content_type,
      content_length: Number(pending.content_length),
      checksum_sha256: pending.checksum_sha256,
      probe: { source: "R2_HEAD_CHECKSUM" },
      retention_class: "PROJECT",
      retain_until: null,
      committed_at: committedAt,
    };
    const receiptSha256 = await sha256(canonicalJson(receiptFacts));
    await createNeonExecutor(pool).transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1, $2, true)", [
        "videoforge.account_id",
        scope.account_id,
      ]);
      if (pending.state === "READY") return;
      await transaction.query(
        `UPDATE assets SET state = 'VERIFIED', verified_at = $2
          WHERE id = $1 AND state = 'UPLOADING'`,
        [String(pending.voiceover_asset_id), committedAt],
      );
      await transaction.query(
        `UPDATE artifact_reservations
            SET state = 'COMMITTED', used_count = 1, updated_at = $2
          WHERE id = $1 AND state = 'ISSUED'`,
        [String(pending.upload_reservation_id), committedAt],
      );
      await transaction.query(
        `INSERT INTO artifact_receipts (
           id, account_id, workspace_id, reservation_id, callback_id, object_key,
           content_type, content_length, checksum_sha256, probe, receipt_sha256, committed_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12)
         ON CONFLICT (account_id, workspace_id, reservation_id) DO NOTHING`,
        [
          String(pending.upload_receipt_id),
          scope.account_id,
          scope.workspace_id,
          String(pending.upload_reservation_id),
          receiptFacts.callback_id,
          String(pending.object_key),
          String(pending.content_type),
          Number(pending.content_length),
          String(pending.checksum_sha256),
          JSON.stringify(receiptFacts.probe),
          receiptSha256,
          committedAt,
        ],
      );
      await transaction.query(
        `UPDATE project_revisions SET status = 'LOCKED', locked_at = $2
          WHERE id = $1 AND status = 'DRAFT'`,
        [String(pending.project_revision_id), committedAt],
      );
      await transaction.query(
        `UPDATE hosted_project_create_requests SET state = 'READY', ready_at = $2
          WHERE project_id = $1 AND state = 'UPLOAD_PENDING'`,
        [projectId, committedAt],
      );
    });
    const extension = voiceoverExtension(String(pending.content_type));
    const checksum = String(pending.checksum_sha256);
    const uri = `vf-local://objects/sha256/${checksum.slice(7, 9)}/${checksum.slice(7)}.${extension}`;
    return response({
      schema_version: "videoforge-hosted-project-ready/v1",
      project_id: projectId,
      project_revision_id: pending.project_revision_id,
      cpu_submission: {
        schema_version: "videoforge-hosted-cpu-submission/v1",
        idempotency_key: `project-${projectId}-asr-v1`,
        project_id: projectId,
        project_revision_id: pending.project_revision_id,
        kind: "ASR",
        input_document: {
          schema_version: "asr-job-input/v1",
          project_revision_id: pending.project_revision_id,
          attempt_id: projectId,
          voiceover: {
            asset_id: pending.voiceover_asset_id,
            sha256: checksum,
            artifact_uri: uri,
            media_type: pending.content_type,
            duration_ms: Number(pending.duration_ms),
          },
          model: {
            engine: "whisper.cpp",
            name: "base.en",
            sha256: config.mediaWorkerRelease.whisperModelSha256,
            language: "en",
          },
          options: {
            threads: 4,
            processors: 1,
            flash_attention: true,
            greedy: true,
            split_on_word: true,
          },
          output: {
            result_uri: `vf-local-run://${pending.project_revision_id}/${projectId}/asr-result.json`,
          },
          cancel_token: projectId,
        },
        objects: [{ artifact_receipt_id: pending.upload_receipt_id, uri }],
      },
    });
  } finally {
    await pool.end();
  }
}

/**
 * Advance the ordinary product journey after ASR.  The browser supplies only
 * the successful ASR attempt identity; the render submission itself must come
 * from the locked revision's tenant-owned, immutable render plan.  The route
 * deliberately does not synthesize a plan or create an attempt when that plan
 * is absent.  The returned submission is then sent through the generic CPU
 * submission endpoint, which applies the same plan equality check before it
 * owns/outboxes the render attempt.
 */
async function asrHandoff(
  request: Request,
  projectId: string,
  config: HostedRuntimeConfiguration,
  executionContext: HostedExecutionContext,
): Promise<Response> {
  if (!UUID.test(projectId)) return response({ error: { code: "PROJECT_NOT_FOUND" } }, 404);
  if (!sameOrigin(request, config))
    return response({ error: { code: "HOSTED_BROWSER_ORIGIN_REJECTED" } }, 403);
  const pool = createNeonPool(config.neon.databaseUrl);
  try {
    const scope = await sessionScope(request, config, pool, executionContext);
    if (scope instanceof Response) return scope;
    const state = await createNeonExecutor(pool).transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1, $2, true)", [
        "videoforge.account_id",
        scope.account_id,
      ]);
      const result = await transaction.query<{
        revision_id: string;
        voiceover_asset_id: string;
        checksum_sha256: string;
        content_type: string;
        duration_ms: number | string;
        receipt_id: string;
      }>(
        `SELECT revision.id::text AS revision_id,
                revision.voiceover_asset_id::text AS voiceover_asset_id,
                receipt.checksum_sha256, receipt.content_type,
                asset.duration_ms, receipt.id::text AS receipt_id
           FROM projects AS project
           JOIN project_revisions AS revision
             ON revision.account_id = project.account_id
            AND revision.workspace_id = project.workspace_id
            AND revision.project_id = project.id
            AND revision.status = 'LOCKED'
           JOIN assets AS asset
             ON asset.account_id = revision.account_id
            AND asset.workspace_id = revision.workspace_id
            AND asset.id = revision.voiceover_asset_id
            AND asset.state = 'VERIFIED'
            AND asset.binary_sha256 = revision.voiceover_binary_sha256
           JOIN artifact_reservations AS reservation
             ON reservation.account_id = revision.account_id
            AND reservation.workspace_id = revision.workspace_id
            AND reservation.project_id = revision.project_id
            AND reservation.project_revision_id = revision.id
            AND reservation.asset_id = asset.id
            AND reservation.state = 'COMMITTED'
           JOIN artifact_receipts AS receipt
             ON receipt.account_id = reservation.account_id
            AND receipt.workspace_id = reservation.workspace_id
            AND receipt.reservation_id = reservation.id
            AND receipt.deleted_at IS NULL
            AND receipt.checksum_sha256 = asset.binary_sha256
          WHERE project.account_id = $1 AND project.workspace_id = $2 AND project.id = $3
          LIMIT 1`,
        [scope.account_id, scope.workspace_id, projectId],
      );
      return result.rows[0] ?? null;
    });
    if (!state) return response({ error: { code: "HOSTED_ASR_HANDOFF_NOT_READY" } }, 409);
    const extension = voiceoverExtension(state.content_type);
    const uri = `vf-local://objects/sha256/${state.checksum_sha256.slice(7, 9)}/${state.checksum_sha256.slice(7)}.${extension}`;
    return response(
      {
        schema_version: "videoforge-hosted-asr-handoff/v1",
        project_id: projectId,
        project_revision_id: state.revision_id,
        cpu_submission: {
          schema_version: "videoforge-hosted-cpu-submission/v1",
          idempotency_key: `project-${projectId}-asr-v1`,
          project_id: projectId,
          project_revision_id: state.revision_id,
          kind: "ASR",
          input_document: {
            schema_version: "asr-job-input/v1",
            project_revision_id: state.revision_id,
            attempt_id: projectId,
            voiceover: {
              asset_id: state.voiceover_asset_id,
              sha256: state.checksum_sha256,
              artifact_uri: uri,
              media_type: state.content_type,
              duration_ms: Number(state.duration_ms),
            },
            model: {
              engine: "whisper.cpp",
              name: "base.en",
              sha256: config.mediaWorkerRelease.whisperModelSha256,
              language: "en",
            },
            options: {
              threads: 4,
              processors: 1,
              flash_attention: true,
              greedy: true,
              split_on_word: true,
            },
            output: {
              result_uri: `vf-local-run://${state.revision_id}/${projectId}/asr-result.json`,
            },
            cancel_token: projectId,
          },
          objects: [{ artifact_receipt_id: state.receipt_id, uri }],
        },
      },
      202,
    );
  } finally {
    await pool.end();
  }
}

async function renderHandoff(
  request: Request,
  projectId: string,
  config: HostedRuntimeConfiguration,
  executionContext: HostedExecutionContext,
): Promise<Response> {
  if (!UUID.test(projectId)) return response({ error: { code: "PROJECT_NOT_FOUND" } }, 404);
  if (!sameOrigin(request, config))
    return response({ error: { code: "HOSTED_BROWSER_ORIGIN_REJECTED" } }, 403);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return response({ error: { code: "HOSTED_RENDER_HANDOFF_REJECTED" } }, 400);
  }
  const asrAttemptId = parseRenderHandoff(body);
  if (!asrAttemptId) return response({ error: { code: "HOSTED_RENDER_HANDOFF_REJECTED" } }, 400);

  const pool = createNeonPool(config.neon.databaseUrl);
  try {
    const scope = await sessionScope(request, config, pool, executionContext);
    if (scope instanceof Response) return scope;
    const state = await createNeonExecutor(pool).transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1, $2, true)", [
        "videoforge.account_id",
        scope.account_id,
      ]);
      const result = await transaction.query<{
        revision_id: string;
        revision_state: string;
        render_plan_schema_version: string | null;
        render_plan_payload: unknown;
        render_plan_payload_sha256: string | null;
        asr_attempt_id: string | null;
      }>(
        `SELECT revision.id AS revision_id, revision.status AS revision_state,
                render_plan.schema_version AS render_plan_schema_version,
                render_plan.payload AS render_plan_payload,
                render_plan.payload_sha256 AS render_plan_payload_sha256,
                asr.id AS asr_attempt_id
           FROM projects AS project
           JOIN project_revisions AS revision
             ON revision.account_id = project.account_id
            AND revision.workspace_id = project.workspace_id
            AND revision.project_id = project.id
           LEFT JOIN hosted_render_plans AS render_plan
             ON render_plan.account_id = revision.account_id
            AND render_plan.workspace_id = revision.workspace_id
            AND render_plan.project_id = revision.project_id
            AND render_plan.project_revision_id = revision.id
           LEFT JOIN hosted_cpu_job_attempts AS asr
             ON asr.account_id = project.account_id
            AND asr.workspace_id = project.workspace_id
            AND asr.project_id = project.id
            AND asr.project_revision_id = revision.id
            AND asr.id = $4
            AND asr.kind = 'ASR'
            AND asr.state = 'SUCCEEDED'
          WHERE project.account_id = $1 AND project.workspace_id = $2 AND project.id = $3
          LIMIT 1`,
        [scope.account_id, scope.workspace_id, projectId, asrAttemptId],
      );
      return result.rows[0] ?? null;
    });
    if (!state) return response({ error: { code: "PROJECT_NOT_FOUND" } }, 404);
    if (state.revision_state !== "LOCKED")
      return response({ error: { code: "HOSTED_PROJECT_NOT_READY" } }, 409);
    if (!state.asr_attempt_id)
      return response({ error: { code: "HOSTED_ASR_NOT_SUCCEEDED" } }, 409);

    const renderPlan =
      state.render_plan_schema_version === "videoforge-hosted-cpu-submission/v1"
        ? state.render_plan_payload
        : null;
    const submission = exactHostedRenderSubmission(renderPlan, projectId, state.revision_id);
    if (
      !submission ||
      (await sha256(canonicalJson(renderPlan))) !== state.render_plan_payload_sha256
    ) {
      return response({ error: { code: "HOSTED_RENDER_PLAN_NOT_READY" } }, 409);
    }

    return response(
      {
        schema_version: "videoforge-hosted-render-handoff/v1",
        project_id: projectId,
        project_revision_id: state.revision_id,
        asr_attempt_id: asrAttemptId,
        cpu_submission: renderPlan,
      },
      202,
    );
  } finally {
    await pool.end();
  }
}

async function projects(
  request: Request,
  config: HostedRuntimeConfiguration,
  executionContext: HostedExecutionContext,
): Promise<Response> {
  const pool = createNeonPool(config.neon.databaseUrl);
  try {
    const scope = await sessionScope(request, config, pool, executionContext);
    if (scope instanceof Response) return scope;
    const rows = await createNeonExecutor(pool).transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1, $2, true)", [
        "videoforge.account_id",
        scope.account_id,
      ]);
      const result = await transaction.query(
        `SELECT project.id, project.name AS title, project.created_at, revision.id AS revision_id,
                revision.status AS revision_state,
                COALESCE((SELECT attempt.state FROM hosted_cpu_job_attempts AS attempt
                           WHERE attempt.project_id = project.id
                           ORDER BY attempt.created_at DESC LIMIT 1), 'AWAITING_UPLOAD') AS state
           FROM projects AS project
           JOIN project_revisions AS revision
             ON revision.account_id = project.account_id
            AND revision.workspace_id = project.workspace_id
            AND revision.project_id = project.id
          WHERE project.account_id = $1 AND project.workspace_id = $2
          ORDER BY project.created_at DESC`,
        [scope.account_id, scope.workspace_id],
      );
      return result.rows;
    });
    return response({ schema_version: "videoforge-hosted-project-list/v1", projects: rows });
  } finally {
    await pool.end();
  }
}

async function projectDetail(
  request: Request,
  projectId: string,
  environment: HostedRuntimeEnvironment,
  config: HostedRuntimeConfiguration,
  executionContext: HostedExecutionContext,
): Promise<Response> {
  if (!UUID.test(projectId)) return response({ error: { code: "PROJECT_NOT_FOUND" } }, 404);
  const pool = createNeonPool(config.neon.databaseUrl);
  try {
    const scope = await sessionScope(request, config, pool, executionContext);
    if (scope instanceof Response) return scope;
    const detail = await createNeonExecutor(pool).transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1, $2, true)", [
        "videoforge.account_id",
        scope.account_id,
      ]);
      const project = await transaction.query(
        `SELECT project.id, project.name AS title, project.created_at, revision.id AS revision_id,
                revision.status AS revision_state
           FROM projects AS project
           JOIN project_revisions AS revision
             ON revision.account_id = project.account_id
            AND revision.workspace_id = project.workspace_id
            AND revision.project_id = project.id
          WHERE project.account_id = $1 AND project.workspace_id = $2 AND project.id = $3`,
        [scope.account_id, scope.workspace_id, projectId],
      );
      const attempts = await transaction.query(
        `SELECT attempt.id, attempt.kind, attempt.state, attempt.version, attempt.created_at,
                attempt.updated_at, attempt.terminal_at, attempt.result_checksum_sha256,
                authority.object_key, authority.content_type,
                authority.issued_content_length AS content_length,
                authority.issued_checksum_sha256 AS output_checksum_sha256,
                review.approved_at
           FROM hosted_cpu_job_attempts AS attempt
           LEFT JOIN hosted_cpu_upload_authorities AS authority
             ON authority.account_id = attempt.account_id
            AND authority.workspace_id = attempt.workspace_id
            AND authority.attempt_id = attempt.id
            AND authority.source = 'PRIMARY_RESULT_OUTPUT' AND authority.issued_at IS NOT NULL
           LEFT JOIN hosted_project_reviews AS review
             ON review.account_id = attempt.account_id
            AND review.workspace_id = attempt.workspace_id
            AND review.render_attempt_id = attempt.id
          WHERE attempt.account_id = $1 AND attempt.workspace_id = $2 AND attempt.project_id = $3
          ORDER BY attempt.created_at`,
        [scope.account_id, scope.workspace_id, projectId],
      );
      return { project: project.rows[0], attempts: attempts.rows };
    });
    if (!detail.project) return response({ error: { code: "PROJECT_NOT_FOUND" } }, 404);
    const signer = new HostedR2Signer(config.r2);
    const attempts = [];
    for (const value of detail.attempts as Record<string, unknown>[]) {
      let previewUrl: string | null = null;
      if (
        value.kind === "RENDER" &&
        value.state === "SUCCEEDED" &&
        typeof value.object_key === "string" &&
        value.content_type === "video/mp4" &&
        Number.isSafeInteger(Number(value.content_length)) &&
        typeof value.output_checksum_sha256 === "string"
      ) {
        const object = await environment.PRIVATE_ARTIFACTS?.head(value.object_key);
        if (
          object &&
          object.size === Number(value.content_length) &&
          object.httpMetadata?.contentType === "video/mp4" &&
          checksumFromR2(object.checksums?.sha256) === value.output_checksum_sha256
        ) {
          previewUrl = (
            await signer.sign({
              method: "GET",
              objectKey: value.object_key,
              contentType: "video/mp4",
              contentLength: Number(value.content_length),
              checksumSha256: value.output_checksum_sha256,
              lifetimeSeconds: 300,
              downloadFilename: "videoforge-output.mp4",
            })
          ).url;
        }
      }
      attempts.push({ ...value, preview_url: previewUrl });
    }
    return response({
      schema_version: "videoforge-hosted-project-detail/v1",
      project: detail.project,
      attempts,
      gpu_transport: "DISABLED_UNQUALIFIED",
    });
  } finally {
    await pool.end();
  }
}

async function approveReview(
  request: Request,
  projectId: string,
  config: HostedRuntimeConfiguration,
  executionContext: HostedExecutionContext,
): Promise<Response> {
  if (!UUID.test(projectId)) return response({ error: { code: "PROJECT_NOT_FOUND" } }, 404);
  if (!sameOrigin(request, config))
    return response({ error: { code: "HOSTED_BROWSER_ORIGIN_REJECTED" } }, 403);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return response({ error: { code: "REVIEW_REJECTED" } }, 400);
  }
  const attemptId = (body as { attempt_id?: unknown } | null)?.attempt_id;
  if (typeof attemptId !== "string" || !UUID.test(attemptId))
    return response({ error: { code: "REVIEW_REJECTED" } }, 400);
  const pool = createNeonPool(config.neon.databaseUrl);
  try {
    const scope = await sessionScope(request, config, pool, executionContext);
    if (scope instanceof Response) return scope;
    const approved = await createNeonExecutor(pool).transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1, $2, true)", [
        "videoforge.account_id",
        scope.account_id,
      ]);
      const result = await transaction.query<{ checksum: string }>(
        `SELECT authority.issued_checksum_sha256 AS checksum
           FROM hosted_cpu_job_attempts AS attempt
           JOIN hosted_cpu_upload_authorities AS authority
             ON authority.account_id = attempt.account_id
            AND authority.workspace_id = attempt.workspace_id
            AND authority.attempt_id = attempt.id
            AND authority.source = 'PRIMARY_RESULT_OUTPUT'
            AND authority.issued_at IS NOT NULL
          WHERE attempt.account_id = $1 AND attempt.workspace_id = $2
            AND attempt.project_id = $3 AND attempt.id = $4
            AND attempt.kind = 'RENDER' AND attempt.state = 'SUCCEEDED'
            AND attempt.retention_deleted_at IS NULL`,
        [scope.account_id, scope.workspace_id, projectId, attemptId],
      );
      const target = result.rows[0];
      if (!target) return null;
      await transaction.query(
        `INSERT INTO hosted_project_reviews (
           id, account_id, workspace_id, project_id, render_attempt_id,
           output_checksum_sha256, approved_by_user_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (account_id, workspace_id, project_id, render_attempt_id) DO NOTHING`,
        [
          crypto.randomUUID(),
          scope.account_id,
          scope.workspace_id,
          projectId,
          attemptId,
          target.checksum,
          scope.user_id,
        ],
      );
      return target;
    });
    if (!approved) return response({ error: { code: "REVIEW_CANDIDATE_NOT_FOUND" } }, 404);
    return response({
      schema_version: "videoforge-hosted-review/v1",
      state: "APPROVED",
      attempt_id: attemptId,
    });
  } finally {
    await pool.end();
  }
}

async function usage(
  request: Request,
  config: HostedRuntimeConfiguration,
  executionContext: HostedExecutionContext,
): Promise<Response> {
  const pool = createNeonPool(config.neon.databaseUrl);
  try {
    const scope = await sessionScope(request, config, pool, executionContext);
    if (scope instanceof Response) return scope;
    const data = await createNeonExecutor(pool).transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1, $2, true)", [
        "videoforge.account_id",
        scope.account_id,
      ]);
      const result = await transaction.query<Record<string, unknown>>(
        `SELECT count(*) AS attempts,
                count(*) FILTER (WHERE state = 'SUCCEEDED') AS succeeded,
                count(*) FILTER (WHERE state = 'FAILED') AS failed,
                COALESCE(sum(EXTRACT(EPOCH FROM (terminal_at - submitted_at)))
                  FILTER (WHERE terminal_at IS NOT NULL AND submitted_at IS NOT NULL), 0) AS worker_seconds,
                COALESCE(sum(authority.issued_content_length)
                  FILTER (WHERE attempt.state = 'SUCCEEDED' AND attempt.retention_deleted_at IS NULL
                          AND authority.source = 'PRIMARY_RESULT_OUTPUT'), 0) AS retained_bytes
           FROM hosted_cpu_job_attempts AS attempt
           LEFT JOIN hosted_cpu_upload_authorities AS authority
             ON authority.account_id = attempt.account_id
            AND authority.workspace_id = attempt.workspace_id
            AND authority.attempt_id = attempt.id
          WHERE attempt.account_id = $1 AND attempt.workspace_id = $2
            AND attempt.created_at >= date_trunc('month', now())`,
        [scope.account_id, scope.workspace_id],
      );
      return result.rows[0] ?? {};
    });
    return response({
      schema_version: "videoforge-hosted-usage/v1",
      current_month_provider_cpu_usd: 0,
      current_month_gpu_usd: 0,
      attempts: Number(data.attempts ?? 0),
      succeeded: Number(data.succeeded ?? 0),
      failed: Number(data.failed ?? 0),
      personal_worker_seconds: Math.round(Number(data.worker_seconds ?? 0)),
      retained_bytes: Number(data.retained_bytes ?? 0),
      storage_policy: "DURABLE_UNTIL_EXPLICIT_DELETE",
      excluded_costs: ["USER_ELECTRICITY", "R2_ACCOUNT_BILL", "FUTURE_RUNWARE", "FUTURE_RUNPOD"],
    });
  } finally {
    await pool.end();
  }
}

export async function handleHostedProductRequest(
  request: Request,
  environment: HostedRuntimeEnvironment,
  config: HostedRuntimeConfiguration,
  executionContext: HostedExecutionContext,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/api/v2/hosted/project-catalog")
    return catalog(request, config, executionContext);
  if (request.method === "GET" && url.pathname === "/api/v2/hosted/projects")
    return projects(request, config, executionContext);
  if (request.method === "POST" && url.pathname === "/api/v2/hosted/projects")
    return createProject(request, environment, config, executionContext);
  if (request.method === "GET" && url.pathname === "/api/v2/hosted/usage")
    return usage(request, config, executionContext);
  const commit = /^\/api\/v2\/hosted\/projects\/([0-9a-f-]+)\/commit$/u.exec(url.pathname);
  if (request.method === "POST" && commit)
    return commitProject(request, commit[1]!, environment, config, executionContext);
  const render = /^\/api\/v2\/hosted\/projects\/([0-9a-f-]+)\/render$/u.exec(url.pathname);
  if (request.method === "POST" && render)
    return renderHandoff(request, render[1]!, config, executionContext);
  const asr = /^\/api\/v2\/hosted\/projects\/([0-9a-f-]+)\/asr$/u.exec(url.pathname);
  if (request.method === "POST" && asr)
    return asrHandoff(request, asr[1]!, config, executionContext);
  const review = /^\/api\/v2\/hosted\/projects\/([0-9a-f-]+)\/review$/u.exec(url.pathname);
  if (request.method === "POST" && review)
    return approveReview(request, review[1]!, config, executionContext);
  const detail = /^\/api\/v2\/hosted\/projects\/([0-9a-f-]+)$/u.exec(url.pathname);
  if (request.method === "GET" && detail)
    return projectDetail(request, detail[1]!, environment, config, executionContext);
  return null;
}

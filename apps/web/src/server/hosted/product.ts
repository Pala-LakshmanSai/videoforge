import { createHostedAuth, type HostedExecutionContext } from "./auth";
import type {
  HostedNeonPool,
  HostedRuntimeConfiguration,
  HostedRuntimeEnvironment,
} from "./configuration";
import { coordinateHostedGeneration } from "./generation-coordinator";
import {
  HostedCanonicalTimingPersistence,
  HostedCanonicalTimingPersistenceError,
} from "./generation-persistence";
import { sha256 } from "./crypto";
import { hostedGpuReadiness } from "./gpu-readiness";
import { createNeonExecutor, createNeonPool } from "./neon";
import { HostedR2Signer } from "./r2";
import { canonicalJson } from "./submission";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const IDEMPOTENCY = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,159}$/u;
const VOICEOVER_TYPES = new Set(["audio/wav", "audio/flac", "audio/mpeg", "audio/mp4"]);
const GENERATION_MODES = new Set(["LOWEST_COST", "BALANCED", "FASTER"]);
const MAX_VOICEOVER_BYTES = 1_073_741_824;
const MAX_SPEND_CAP_USD = 2;
const MAX_EXTRA_PROMPT_KEYWORDS = 500;
const MAX_OPTIONAL_SCRIPT = 100_000;
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
  readonly optionalScript: string | null;
  readonly extraPromptKeywords: string | null;
  readonly applyExtraPromptKeywords: boolean;
  readonly generationMode: "LOWEST_COST" | "BALANCED" | "FASTER";
  readonly spendCapUsd: number;
  readonly userSeed: number | null;
  readonly voiceover: {
    readonly filename: string;
    readonly contentType: string;
    readonly contentLength: number;
    readonly checksumSha256: string;
    readonly durationMs: number;
  };
}

export function hostedRevisionConfigV2(input: {
  readonly projectId: string;
  readonly projectRevisionId: string;
  readonly title: string;
  readonly voiceoverAssetId: string;
  readonly voiceoverSha256: string;
  readonly avatarProfileId: string;
  readonly avatarProfileVersionId: string;
  readonly avatarDisplayName: string;
  readonly avatarProfileHash: string;
  readonly avatarRuntimeSourceAssetId: string;
  readonly avatarRuntimeSourceSha256: string;
  readonly avatarSourcePreparationVersion: string;
  readonly avatarSourceValidationProfileVersion: string;
  readonly imageStyleVersionId: string;
  readonly styleProfileHash: string;
  readonly schedulerSeed: number;
  readonly optionalScript?: string | null;
  readonly extraPromptKeywords?: string | null;
  readonly applyExtraPromptKeywords?: boolean;
  readonly generationMode?: "LOWEST_COST" | "BALANCED" | "FASTER";
  readonly spendCapUsd?: number;
}) {
  const extraPromptKeywords = input.extraPromptKeywords ?? null;
  const applyExtraPromptKeywords = input.applyExtraPromptKeywords ?? false;
  const generationMode = input.generationMode ?? "LOWEST_COST";
  const spendCapUsd = input.spendCapUsd ?? PERSONAL_WORKER_MINIMUM_COST_MICRO_USD / 1_000_000;
  return {
    schema_version: "project-revision-config/v2" as const,
    project_id: input.projectId,
    project_revision_id: input.projectRevisionId,
    title: input.title,
    voiceover_asset_id: input.voiceoverAssetId,
    voiceover_sha256: input.voiceoverSha256,
    avatar_binding: {
      avatar_profile_id: input.avatarProfileId,
      avatar_profile_version_id: input.avatarProfileVersionId,
      avatar_display_name_snapshot: input.avatarDisplayName,
      avatar_profile_hash: input.avatarProfileHash,
      runtime_source_asset_id: input.avatarRuntimeSourceAssetId,
      runtime_source_sha256: input.avatarRuntimeSourceSha256,
      source_preparation_version: input.avatarSourcePreparationVersion,
      source_validation_profile_version: input.avatarSourceValidationProfileVersion,
      compatibility_state_at_preflight: "UNTESTED" as const,
      compatibility_evidence: null,
    },
    optional_script: input.optionalScript ?? null,
    image_style_version_id: input.imageStyleVersionId,
    style_profile_hash: input.styleProfileHash,
    extra_prompt_keywords: extraPromptKeywords,
    apply_extra_prompt_keywords: applyExtraPromptKeywords,
    generation_mode: generationMode,
    execution_profiles: {
      image_media_profile_id: "serverless-mage-image-v1",
      avatar_primary_profile_id: "serverless-soulx-flashhead-pro-v1",
      avatar_repair_profile_id: null,
      avatar_quality_profile_id: null,
    },
    spend_cap_usd: spendCapUsd,
    scheduler_version: "scheduler-v2",
    scheduler_seed: input.schedulerSeed,
    prompt_writer_version: "scene-prompt-writer-v1",
    prompt_compiler_version: "mage-prompt-compiler-v1",
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
  const keys = new Set(Object.keys(record));
  const legacyKeys = [
    "avatar_profile_version_id",
    "image_style_version_id",
    "schema_version",
    "title",
    "voiceover",
  ];
  const v2Keys = [
    ...legacyKeys,
    "apply_extra_prompt_keywords",
    "extra_prompt_keywords",
    "generation_mode",
    "optional_script",
    "spend_cap_usd",
    "user_seed",
  ];
  const schemaVersion = record.schema_version;
  if (
    schemaVersion !== "videoforge-hosted-project-create/v1" &&
    schemaVersion !== "videoforge-hosted-project-create/v2" &&
    schemaVersion !== "videoforge-hosted-project-preflight/v1"
  )
    return null;
  if (
    (schemaVersion === "videoforge-hosted-project-create/v1" &&
      (keys.size !== legacyKeys.length || legacyKeys.some((key) => !keys.has(key)))) ||
    (schemaVersion !== "videoforge-hosted-project-create/v1" &&
      (keys.size < legacyKeys.length ||
        keys.size > v2Keys.length ||
        [...keys].some((key) => !v2Keys.includes(key)))) ||
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
    Number(voiceover.content_length) > MAX_VOICEOVER_BYTES ||
    typeof voiceover.checksum_sha256 !== "string" ||
    !SHA256.test(voiceover.checksum_sha256) ||
    !Number.isSafeInteger(voiceover.duration_ms) ||
    Number(voiceover.duration_ms) < 10_000 ||
    Number(voiceover.duration_ms) > 3_600_000
  ) {
    return null;
  }
  const optionalScript = record.optional_script;
  const extraPromptKeywords = record.extra_prompt_keywords;
  const applyExtraPromptKeywords = record.apply_extra_prompt_keywords;
  const generationMode = record.generation_mode;
  const spendCapUsd = record.spend_cap_usd;
  const userSeed = record.user_seed;
  if (
    (optionalScript !== undefined &&
      optionalScript !== null &&
      (typeof optionalScript !== "string" || optionalScript.length > MAX_OPTIONAL_SCRIPT)) ||
    (extraPromptKeywords !== undefined &&
      extraPromptKeywords !== null &&
      (typeof extraPromptKeywords !== "string" ||
        extraPromptKeywords.length > MAX_EXTRA_PROMPT_KEYWORDS)) ||
    (applyExtraPromptKeywords !== undefined && typeof applyExtraPromptKeywords !== "boolean") ||
    (generationMode !== undefined &&
      (typeof generationMode !== "string" || !GENERATION_MODES.has(generationMode))) ||
    (spendCapUsd !== undefined &&
      (typeof spendCapUsd !== "number" ||
        !Number.isFinite(spendCapUsd) ||
        spendCapUsd < PERSONAL_WORKER_MINIMUM_COST_MICRO_USD / 1_000_000 ||
        spendCapUsd > MAX_SPEND_CAP_USD)) ||
    (userSeed !== undefined &&
      userSeed !== null &&
      (typeof userSeed !== "number" ||
        !Number.isSafeInteger(userSeed) ||
        Number(userSeed) < 0 ||
        Number(userSeed) > 4_294_967_295)) ||
    (applyExtraPromptKeywords === true &&
      (typeof extraPromptKeywords !== "string" || !/\S/u.test(extraPromptKeywords)))
  ) {
    return null;
  }
  return {
    title: record.title,
    avatarVersionId: record.avatar_profile_version_id,
    styleVersionId: record.image_style_version_id,
    optionalScript: typeof optionalScript === "string" ? optionalScript : null,
    extraPromptKeywords: typeof extraPromptKeywords === "string" ? extraPromptKeywords : null,
    applyExtraPromptKeywords: applyExtraPromptKeywords === true,
    generationMode:
      generationMode === "BALANCED" || generationMode === "FASTER" ? generationMode : "LOWEST_COST",
    spendCapUsd: typeof spendCapUsd === "number" ? spendCapUsd : 0.1,
    userSeed: typeof userSeed === "number" ? userSeed : null,
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

function numberOrNull(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function timestampOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function elapsedMs(start: unknown, end: unknown): number | null {
  const startAt = start === null || start === undefined ? null : new Date(String(start)).getTime();
  const endAt = end === null || end === undefined ? null : new Date(String(end)).getTime();
  if (startAt === null || endAt === null || !Number.isFinite(startAt) || !Number.isFinite(endAt))
    return null;
  return Math.max(0, endAt - startAt);
}

function hostedProgressPercent(completed: unknown, total: unknown): number | null {
  const done = numberOrNull(completed);
  const count = numberOrNull(total);
  if (done === null || count === null || count <= 0) return null;
  return Math.min(100, Math.max(0, Math.round((done / count) * 100)));
}

function hostedTiming(input: {
  readonly createdAt?: unknown;
  readonly submittedAt?: unknown;
  readonly terminalAt?: unknown;
  readonly preparedAt?: unknown;
  readonly renderStartedAt?: unknown;
}): Record<string, number | null> {
  return {
    queue_wait_ms: elapsedMs(input.createdAt, input.submittedAt),
    initialization_ms: elapsedMs(input.submittedAt, input.preparedAt),
    model_ready_ms: null,
    inference_ms: elapsedMs(input.renderStartedAt ?? input.submittedAt, input.terminalAt),
    upload_ms: null,
    render_ms: elapsedMs(input.renderStartedAt ?? input.submittedAt, input.terminalAt),
    end_to_end_ms: elapsedMs(input.createdAt, input.terminalAt),
  };
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
                version.version_number, version.state, profile.status,
                version.profile_hash, profile.scope_kind
           FROM avatar_profiles AS profile
           JOIN avatar_profile_versions AS version
             ON version.account_id = profile.account_id
            AND version.workspace_id = profile.workspace_id
            AND version.profile_id = profile.id
          WHERE ((profile.account_id = $1 AND profile.workspace_id = $2)
                  OR profile.scope_kind = 'SYSTEM')
            AND profile.status = 'ACTIVE' AND version.state = 'READY'
          ORDER BY profile.name, version.version_number DESC`,
        [scope.account_id, scope.workspace_id],
      );
      const styles = await transaction.query(
        `SELECT style.id AS style_id, version.id AS version_id, style.name,
                version.version_number, version.state, style.status,
                version.style_profile_hash, style.scope_kind
           FROM image_styles AS style
           JOIN image_style_versions AS version
             ON version.account_id = style.account_id
            AND version.workspace_id = style.workspace_id
            AND version.style_id = style.id
          WHERE ((style.account_id = $1 AND style.workspace_id = $2)
                  OR style.scope_kind = 'SYSTEM')
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
    const avatarRows = (data.avatars as Record<string, unknown>[]).map((row) => ({
      ...row,
      thumbnail_url: null,
      profile_hash: row.profile_hash ?? null,
      rights_status: row.scope_kind === "SYSTEM" ? "SYSTEM_OWNED" : "ATTESTED",
    }));
    const styleRows = (data.styles as Record<string, unknown>[]).map((row) => ({
      ...row,
      cover_url: null,
      profile_hash: row.style_profile_hash ?? null,
      reference_count: 0,
    }));
    return response({
      schema_version: "videoforge-hosted-project-catalog/v1",
      avatars: avatarRows,
      styles: styleRows,
      media_worker_state: data.workers > 0 ? "ONLINE" : "WAITING_FOR_YOUR_COMPUTER",
      gpu_transport: "DISABLED_UNQUALIFIED",
      gpu_readiness: hostedGpuReadiness(),
    });
  } finally {
    await pool.end();
  }
}

type HostedPreflightBlocker = {
  readonly code: string;
  readonly message: string;
  readonly severity: "BLOCKING" | "ADVISORY";
};

async function projectPreflight(
  request: Request,
  config: HostedRuntimeConfiguration,
  executionContext: HostedExecutionContext,
): Promise<Response> {
  if (!sameOrigin(request, config))
    return response({ error: { code: "HOSTED_BROWSER_ORIGIN_REJECTED" } }, 403);
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return response({ error: { code: "PROJECT_PREFLIGHT_REJECTED" } }, 400);
  }
  const input = parseCreate(raw);
  if (!input) return response({ error: { code: "PROJECT_PREFLIGHT_REJECTED" } }, 400);
  const pool = createNeonPool(config.neon.databaseUrl);
  try {
    const scope = await sessionScope(request, config, pool, executionContext);
    if (scope instanceof Response) return scope;
    const facts = await createNeonExecutor(pool).transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1, $2, true)", [
        "videoforge.account_id",
        scope.account_id,
      ]);
      const [avatar, style, workers] = await Promise.all([
        transaction.query(
          `SELECT 1
             FROM avatar_profiles AS profile
             JOIN avatar_profile_versions AS version
               ON version.account_id = profile.account_id
              AND version.workspace_id = profile.workspace_id
              AND version.profile_id = profile.id
            WHERE ((profile.account_id = $1 AND profile.workspace_id = $2)
                    OR profile.scope_kind = 'SYSTEM')
              AND profile.status = 'ACTIVE' AND version.id = $3 AND version.state = 'READY'
            LIMIT 1`,
          [scope.account_id, scope.workspace_id, input.avatarVersionId],
        ),
        transaction.query(
          `SELECT 1
             FROM image_styles AS style
             JOIN image_style_versions AS version
               ON version.account_id = style.account_id
              AND version.workspace_id = style.workspace_id
              AND version.style_id = style.id
            WHERE ((style.account_id = $1 AND style.workspace_id = $2)
                    OR style.scope_kind = 'SYSTEM')
              AND style.status = 'ACTIVE' AND version.id = $3 AND version.state = 'PUBLISHED'
            LIMIT 1`,
          [scope.account_id, scope.workspace_id, input.styleVersionId],
        ),
        transaction.query<{ count: string | number }>(
          `SELECT count(*) AS count FROM media_worker_devices
            WHERE account_id = $1 AND workspace_id = $2
              AND status IN ('ONLINE', 'BUSY')`,
          [scope.account_id, scope.workspace_id],
        ),
      ]);
      return {
        avatarReady: avatar.rows.length > 0,
        styleReady: style.rows.length > 0,
        workers: Number(workers.rows[0]?.count ?? 0),
      };
    });
    const blockers: HostedPreflightBlocker[] = [];
    if (!facts.avatarReady) {
      blockers.push({
        code: "AVATAR_PROFILE_NOT_READY",
        message: "Choose an active Avatar Profile version in READY state.",
        severity: "BLOCKING",
      });
    }
    if (!facts.styleReady) {
      blockers.push({
        code: "IMAGE_STYLE_NOT_PUBLISHED",
        message: "Choose an active Image Style version in PUBLISHED state.",
        severity: "BLOCKING",
      });
    }
    if (facts.workers < 1) {
      blockers.push({
        code: "MEDIA_WORKER_OFFLINE",
        message: "Connect your personal media worker before generating.",
        severity: "BLOCKING",
      });
    }
    // This is a truthful warning, not an authorization. The current release remains fail-closed
    // for GPU dispatch while the qualification records are incomplete.
    blockers.push({
      code: "GPU_TRANSPORT_DISABLED_UNQUALIFIED",
      message: "GPU lanes are not qualified; the estimate excludes provider GPU spend.",
      severity: "ADVISORY",
    });
    const cap = input.spendCapUsd;
    const ok = blockers.every((blocker) => blocker.severity !== "BLOCKING");
    return response({
      schema_version: "videoforge-hosted-project-preflight/v1",
      ok,
      ready: ok,
      estimate: {
        projected_usd: 0,
        minimum_usd: 0,
        maximum_usd: cap,
        cap_usd: cap,
        detail:
          "Provider-free personal-worker estimate. GPU provider cost is not projected while transport is DISABLED_UNQUALIFIED.",
        voiceover_bytes: input.voiceover.contentLength,
        duration_ms: input.voiceover.durationMs,
        generation_mode: input.generationMode,
      },
      blockers,
      gpu_transport: "DISABLED_UNQUALIFIED",
      provider_calls_authorized: false,
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
        `SELECT profile.id AS profile_id, profile.name AS profile_name,
                version.id AS version_id, version.profile_hash,
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
      const schedulerSeed = input.userSeed ?? Math.floor(Math.random() * 4_294_967_296);
      const revisionPayload = hostedRevisionConfigV2({
        projectId,
        projectRevisionId: revisionId,
        title: input.title,
        voiceoverAssetId: assetId,
        voiceoverSha256: input.voiceover.checksumSha256,
        avatarProfileId: String(avatar.rows[0].profile_id),
        avatarProfileVersionId: input.avatarVersionId,
        avatarDisplayName: String(avatar.rows[0].profile_name),
        avatarProfileHash: String(avatar.rows[0].profile_hash),
        avatarRuntimeSourceAssetId: String(avatar.rows[0].runtime_source_asset_id),
        avatarRuntimeSourceSha256: String(avatar.rows[0].runtime_source_binary_sha256),
        avatarSourcePreparationVersion: String(avatar.rows[0].source_preparation_profile),
        avatarSourceValidationProfileVersion: String(avatar.rows[0].source_validation_profile),
        imageStyleVersionId: input.styleVersionId,
        styleProfileHash: String(style.rows[0].style_profile_hash),
        schedulerSeed,
        optionalScript: input.optionalScript,
        extraPromptKeywords: input.extraPromptKeywords,
        applyExtraPromptKeywords: input.applyExtraPromptKeywords,
        generationMode: input.generationMode,
        spendCapUsd: input.spendCapUsd,
      });
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
           'UNTESTED',NULL,NULL,$14,$15,$16,$17,$18,$19,$20,$21,
           'project-revision-config','v2',$22::jsonb,$23,$24
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
          input.extraPromptKeywords,
          input.applyExtraPromptKeywords,
          input.generationMode,
          Math.round(input.spendCapUsd * 1_000_000),
          schedulerSeed,
          JSON.stringify(revisionPayload),
          revisionHash,
          scope.user_id,
        ],
      );
      await transaction.query(`UPDATE assets SET project_revision_id = $1 WHERE id = $2`, [
        revisionId,
        assetId,
      ]);
      if (input.optionalScript !== null) {
        await transaction.query(
          `INSERT INTO project_inputs (
             id, workspace_id, project_id, kind, state, asset_id, idempotency_key, optional_script
           ) VALUES ($1,$2,$3,'OPTIONAL_SCRIPT','UPLOADED',NULL,$4,$5)`,
          [
            crypto.randomUUID(),
            scope.workspace_id,
            projectId,
            `project-${projectId}-optional-script-v1`,
            input.optionalScript,
          ],
        );
      }
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
  environment: HostedRuntimeEnvironment,
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
        revision_config_payload: unknown;
        revision_config_hash: string;
        asr_attempt_id: string | null;
        asr_terminal_at: string | null;
        asr_input_object_key: string | null;
        asr_input_content_length: number | string | null;
        asr_input_sha256: string | null;
        asr_output_object_key: string | null;
        asr_output_content_type: string | null;
        asr_output_content_length: number | string | null;
        asr_output_sha256: string | null;
      }>(
        `SELECT revision.id AS revision_id, revision.status AS revision_state,
                revision.revision_config_payload, revision.revision_config_hash,
                asr.id AS asr_attempt_id, asr.terminal_at AS asr_terminal_at,
                asr.job_spec_object_key AS asr_input_object_key,
                asr.job_spec_content_length AS asr_input_content_length,
                asr.job_spec_checksum_sha256 AS asr_input_sha256,
                authority.object_key AS asr_output_object_key,
                authority.content_type AS asr_output_content_type,
                authority.issued_content_length AS asr_output_content_length,
                authority.issued_checksum_sha256 AS asr_output_sha256
           FROM projects AS project
           JOIN project_revisions AS revision
             ON revision.account_id = project.account_id
            AND revision.workspace_id = project.workspace_id
            AND revision.project_id = project.id
           LEFT JOIN hosted_cpu_job_attempts AS asr
             ON asr.account_id = project.account_id
            AND asr.workspace_id = project.workspace_id
            AND asr.project_id = project.id
            AND asr.project_revision_id = revision.id
            AND asr.id = $4
            AND asr.kind = 'ASR'
            AND asr.state = 'SUCCEEDED'
           LEFT JOIN hosted_cpu_upload_authorities AS authority
             ON authority.account_id = asr.account_id
            AND authority.workspace_id = asr.workspace_id
            AND authority.attempt_id = asr.id
            AND authority.source = 'RESULT_DOCUMENT'
            AND authority.issued_at IS NOT NULL
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
    const bucket = environment.PRIVATE_ARTIFACTS;
    if (
      !bucket ||
      !state.asr_terminal_at ||
      !state.asr_input_object_key ||
      !state.asr_input_content_length ||
      !state.asr_input_sha256 ||
      !state.asr_output_object_key ||
      state.asr_output_content_type !== "application/json" ||
      !state.asr_output_content_length ||
      !state.asr_output_sha256
    ) {
      return response({ error: { code: "HOSTED_ASR_OUTPUT_NOT_READY" } }, 409);
    }
    const [asrInputObject, asrObject] = await Promise.all([
      bucket.get(state.asr_input_object_key),
      bucket.get(state.asr_output_object_key),
    ]);
    if (
      !asrInputObject ||
      asrInputObject.size !== Number(state.asr_input_content_length) ||
      asrInputObject.httpMetadata?.contentType !== "application/json" ||
      !asrObject ||
      asrObject.size !== Number(state.asr_output_content_length) ||
      asrObject.httpMetadata?.contentType !== "application/json"
    ) {
      return response({ error: { code: "HOSTED_ASR_OUTPUT_NOT_VERIFIED" } }, 409);
    }
    const asrInputBytes = await asrInputObject.arrayBuffer();
    const asrOutputBytes = await asrObject.arrayBuffer();
    const result = await coordinateHostedGeneration({
      snapshot: {
        accountId: scope.account_id,
        workspaceId: scope.workspace_id,
        userId: scope.user_id,
        projectId,
        projectRevisionId: state.revision_id,
        asrAttemptId,
        asrState: "SUCCEEDED",
        asrFinishedAt: state.asr_terminal_at,
        asrInputObjectKey: state.asr_input_object_key,
        asrInputContentLength: Number(state.asr_input_content_length),
        asrInputSha256: state.asr_input_sha256,
        asrOutputObjectKey: state.asr_output_object_key,
        asrOutputContentType: "application/json",
        asrOutputContentLength: Number(state.asr_output_content_length),
        asrOutputSha256: state.asr_output_sha256,
        expectedWhisperModelSha256: config.mediaWorkerRelease.whisperModelSha256,
        revisionConfig: state.revision_config_payload as never,
        revisionConfigSha256: state.revision_config_hash,
      },
      asrInputBytes,
      asrOutputBytes,
      persistence: new HostedCanonicalTimingPersistence(pool, bucket),
    });
    return response(result, 202);
  } catch (error) {
    if (error instanceof HostedCanonicalTimingPersistenceError) {
      return response({ error: { code: error.code } }, 409);
    }
    throw error;
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

type HostedContactSheetItem = {
  readonly id: string;
  readonly asset_id: null;
  readonly image_url: string;
  readonly label: string;
  readonly start_ms: null;
  readonly end_ms: null;
  readonly shot_role: string;
};

async function contactSheet(
  outputs: readonly Record<string, unknown>[],
  bucket: HostedRuntimeEnvironment["PRIVATE_ARTIFACTS"],
  signer: HostedR2Signer,
): Promise<readonly HostedContactSheetItem[]> {
  if (!bucket) return [];
  const items: HostedContactSheetItem[] = [];
  for (const output of outputs) {
    if (!Array.isArray(output.artifacts)) continue;
    for (const rawArtifact of output.artifacts) {
      if (!rawArtifact || typeof rawArtifact !== "object" || items.length >= 96) continue;
      const artifact = rawArtifact as Record<string, unknown>;
      const objectKey = artifact.object_key;
      const checksum = artifact.checksum_sha256;
      const contentLength = numberOrNull(artifact.content_length);
      const itemId = artifact.item_id;
      if (
        typeof objectKey !== "string" ||
        typeof checksum !== "string" ||
        !SHA256.test(checksum) ||
        contentLength === null ||
        !Number.isSafeInteger(contentLength) ||
        contentLength < 1 ||
        typeof itemId !== "string"
      ) {
        continue;
      }
      const object = await bucket.head(objectKey);
      const contentType = object?.httpMetadata?.contentType;
      if (
        !object ||
        object.size !== contentLength ||
        typeof contentType !== "string" ||
        !contentType.startsWith("image/") ||
        checksumFromR2(object.checksums?.sha256) !== checksum
      ) {
        continue;
      }
      const port = await signer.sign({
        method: "GET",
        objectKey,
        contentType,
        contentLength,
        checksumSha256: checksum,
        lifetimeSeconds: 300,
      });
      items.push({
        id: itemId,
        asset_id: null,
        image_url: port.url,
        label: itemId,
        start_ms: null,
        end_ms: null,
        shot_role: String(output.lane ?? "IMAGE"),
      });
    }
    if (items.length >= 96) break;
  }
  return items;
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
                attempt.updated_at, attempt.submitted_at, attempt.terminal_at,
                attempt.result_checksum_sha256, attempt.result_content_length,
                attempt.result_object_key, attempt.result_content_type,
                attempt.replay_count,
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
      const generation = await transaction.query(
        `SELECT plan.id, plan.canonical_document_hash AS timeline_plan_sha256,
                count(task.id) FILTER (WHERE task.lane IN ('IMAGE', 'AVATAR')) AS planned_tasks,
                count(task.id) FILTER (
                  WHERE task.lane IN ('IMAGE', 'AVATAR') AND task.state = 'COMPLETE'
                ) AS completed_tasks,
                count(task.id) FILTER (
                  WHERE task.lane IN ('IMAGE', 'AVATAR') AND task.state = 'FAILED'
                ) AS failed_tasks
           FROM project_revisions AS revision
           JOIN timeline_plans AS plan
             ON plan.workspace_id = revision.workspace_id
            AND plan.project_revision_id = revision.id
           LEFT JOIN generation_tasks AS task
             ON task.workspace_id = revision.workspace_id
            AND task.project_revision_id = revision.id
          WHERE revision.account_id = $1 AND revision.workspace_id = $2
            AND revision.project_id = $3
          GROUP BY plan.id, plan.canonical_document_hash, plan.plan_sequence
          ORDER BY plan.plan_sequence DESC LIMIT 1`,
        [scope.account_id, scope.workspace_id, projectId],
      );
      const queue = await transaction.query(
        `SELECT request.id, request.state, request.queue_order, request.available_at,
                request.admitted_at, request.terminal_at,
                (SELECT count(*) FROM generation_requests AS ahead
                  WHERE ahead.account_id = request.account_id
                    AND ahead.workspace_id = request.workspace_id
                    AND ahead.state IN ('WAITING','ADMITTED','ACTIVE','RETRY_WAIT')
                    AND ahead.queue_order < request.queue_order) AS ahead,
                (SELECT count(*) FROM generation_requests AS total
                  WHERE total.account_id = request.account_id
                    AND total.workspace_id = request.workspace_id
                    AND total.state IN ('WAITING','ADMITTED','ACTIVE','RETRY_WAIT')) AS total
           FROM generation_requests AS request
          WHERE request.account_id = $1 AND request.workspace_id = $2
            AND request.project_id = $3
          ORDER BY request.created_at DESC LIMIT 1`,
        [scope.account_id, scope.workspace_id, projectId],
      );
      const runtime = await transaction.query(
        `SELECT runtime.id, runtime.stage, runtime.admitted_at, runtime.prepared_at,
                runtime.terminal_at, runtime.terminal_reason, runtime.updated_at,
                COALESCE(
                  jsonb_agg(jsonb_build_object(
                    'id', lane.id, 'lane', lane.lane, 'state', lane.state,
                    'planned_item_count', lane.planned_item_count,
                    'accepted_item_count', lane.accepted_item_count,
                    'attempt_ordinal', lane.attempt_ordinal,
                    'max_attempt_ordinal', lane.max_attempt_ordinal,
                    'current_attempt_id', lane.current_attempt_id,
                    'items_manifest_sha256', lane.items_manifest_sha256,
                    'updated_at', lane.updated_at
                  ) ORDER BY lane.lane) FILTER (WHERE lane.id IS NOT NULL),
                  '[]'::jsonb
                ) AS lanes
           FROM video_runtime_states AS runtime
           LEFT JOIN video_runtime_lane_states AS lane
             ON lane.account_id = runtime.account_id
            AND lane.workspace_id = runtime.workspace_id
            AND lane.runtime_id = runtime.id
          WHERE runtime.account_id = $1 AND runtime.workspace_id = $2
            AND runtime.project_id = $3
          GROUP BY runtime.id, runtime.stage, runtime.admitted_at, runtime.prepared_at,
                   runtime.terminal_at, runtime.terminal_reason, runtime.updated_at,
                   runtime.created_at
          ORDER BY runtime.created_at DESC LIMIT 1`,
        [scope.account_id, scope.workspace_id, projectId],
      );
      const serverlessAttempts = await transaction.query(
        `SELECT attempt.id, attempt.lane, attempt.state, attempt.attempt_ordinal,
                attempt.item_count, attempt.created_at, attempt.submitted_at,
                attempt.terminal_at, attempt.updated_at,
                progress.provider_status, progress.attempt_state,
                progress.items_completed, progress.items_total,
                progress.observed_at AS progress_observed_at,
                ledger.estimated_usd, ledger.reserved_usd, ledger.reported_usd,
                ledger.settled_usd, ledger.possible_duplicate_usd
           FROM serverless_attempts AS attempt
           LEFT JOIN LATERAL (
             SELECT event.provider_status, event.attempt_state,
                    event.items_completed, event.items_total, event.observed_at
               FROM serverless_progress_events AS event
              WHERE event.account_id = attempt.account_id
                AND event.workspace_id = attempt.workspace_id
                AND event.attempt_id = attempt.id
              ORDER BY event.sequence DESC LIMIT 1
           ) AS progress ON true
           LEFT JOIN serverless_cost_ledgers AS ledger
             ON ledger.account_id = attempt.account_id
            AND ledger.workspace_id = attempt.workspace_id
            AND ledger.attempt_id = attempt.id
          WHERE attempt.account_id = $1 AND attempt.workspace_id = $2
            AND attempt.project_id = $3
          ORDER BY attempt.created_at`,
        [scope.account_id, scope.workspace_id, projectId],
      );
      const serverlessOutputs = await transaction.query(
        `SELECT output.attempt_id, output.lane, output.artifacts, output.accepted_at
           FROM serverless_output_receipts AS output
          WHERE output.account_id = $1 AND output.workspace_id = $2
            AND output.project_revision_id = $3
            AND output.acceptance = 'ACCEPTED_CANONICAL'
          ORDER BY output.accepted_at, output.attempt_id`,
        [scope.account_id, scope.workspace_id, String(project.rows[0]?.revision_id ?? "")],
      );
      const cost = await transaction.query(
        `SELECT revision.maximum_cost_micro_usd,
                COALESCE(sum(ledger.estimated_usd), 0) AS estimated_usd,
                COALESCE(sum(ledger.reserved_usd), 0) AS reserved_usd,
                COALESCE(sum(ledger.reported_usd), 0) AS reported_usd,
                COALESCE(sum(ledger.settled_usd), 0) AS settled_usd,
                COALESCE(sum(ledger.possible_duplicate_usd), 0) AS possible_duplicate_usd
           FROM project_revisions AS revision
           LEFT JOIN serverless_attempts AS attempt
             ON attempt.account_id = revision.account_id
            AND attempt.workspace_id = revision.workspace_id
            AND attempt.project_revision_id = revision.id
           LEFT JOIN serverless_cost_ledgers AS ledger
             ON ledger.account_id = attempt.account_id
            AND ledger.workspace_id = attempt.workspace_id
            AND ledger.attempt_id = attempt.id
          WHERE revision.account_id = $1 AND revision.workspace_id = $2
            AND revision.project_id = $3
          GROUP BY revision.maximum_cost_micro_usd`,
        [scope.account_id, scope.workspace_id, projectId],
      );
      const zeroWorkers = await transaction.query(
        `SELECT count(*) AS evidence_count, max(observed_at) AS observed_at,
                max(generation_request_id) AS generation_request_id
           FROM hosted_pair_zero_worker_observations AS zero
           JOIN generation_requests AS request
             ON request.account_id = zero.account_id
            AND request.workspace_id = zero.workspace_id
            AND request.id = zero.generation_request_id
          WHERE zero.account_id = $1 AND zero.workspace_id = $2
            AND request.project_id = $3`,
        [scope.account_id, scope.workspace_id, projectId],
      );
      const failedTasks = await transaction.query(
        `SELECT task.id, task.task_key, task.lane, task.state, task.updated_at
           FROM generation_tasks AS task
          WHERE task.account_id = $1 AND task.workspace_id = $2
            AND task.project_revision_id = $3
            AND task.state IN ('FAILED','BLOCKED','RETRY_WAIT')
          ORDER BY task.updated_at DESC`,
        [scope.account_id, scope.workspace_id, String(project.rows[0]?.revision_id ?? "")],
      );
      const review = await transaction.query(
        `SELECT review.render_attempt_id, review.output_checksum_sha256,
                review.approved_by_user_id, review.approved_at
           FROM hosted_project_reviews AS review
          WHERE review.account_id = $1 AND review.workspace_id = $2
            AND review.project_id = $3
          ORDER BY review.approved_at DESC LIMIT 1`,
        [scope.account_id, scope.workspace_id, projectId],
      );
      return {
        project: project.rows[0],
        attempts: attempts.rows,
        generation: generation.rows[0] ?? null,
        queue: queue.rows[0] ?? null,
        runtime: runtime.rows[0] ?? null,
        serverlessAttempts: serverlessAttempts.rows,
        serverlessOutputs: serverlessOutputs.rows,
        cost: cost.rows[0] ?? null,
        zeroWorkers: zeroWorkers.rows[0] ?? null,
        failedTasks: failedTasks.rows,
        review: review.rows[0] ?? null,
      };
    });
    if (!detail.project) return response({ error: { code: "PROJECT_NOT_FOUND" } }, 404);
    const signer = new HostedR2Signer(config.r2);
    const attempts = [] as Record<string, unknown>[];
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
            })
          ).url;
        }
      }
      attempts.push({
        ...value,
        submitted_at: timestampOrNull(value.submitted_at),
        terminal_at: timestampOrNull(value.terminal_at),
        preview_url: previewUrl,
        progress_percent:
          value.kind === "ASR"
            ? value.state === "SUCCEEDED"
              ? 100
              : value.state === "RUNNING"
                ? 50
                : 0
            : null,
        queue_position: null,
        timing: hostedTiming({
          createdAt: value.created_at,
          submittedAt: value.submitted_at,
          terminalAt: value.terminal_at,
        }),
        cost: {
          projected_usd: 0,
          settled_usd: 0,
          cap_usd: null,
          billed_seconds: null,
          provider: "personal-worker",
        },
      });
    }
    const serverlessAttempts = detail.serverlessAttempts as Record<string, unknown>[];
    const serverlessByLane = new Map<string, Record<string, unknown>>();
    for (const attempt of serverlessAttempts) {
      serverlessByLane.set(String(attempt.lane), attempt);
      const progressPercent = hostedProgressPercent(
        attempt.items_completed,
        attempt.items_total ?? attempt.item_count,
      );
      attempts.push({
        ...attempt,
        kind: String(attempt.lane).toUpperCase(),
        progress_percent: progressPercent,
        queue_position: null,
        preview_url: null,
        timing: hostedTiming({
          createdAt: attempt.created_at,
          submittedAt: attempt.submitted_at,
          terminalAt: attempt.terminal_at,
        }),
        cost: {
          projected_usd: numberOrNull(attempt.estimated_usd),
          settled_usd: numberOrNull(attempt.settled_usd),
          cap_usd: null,
          billed_seconds: null,
          provider: "runpod",
        },
      });
    }
    const runtime = (detail.runtime ?? null) as Record<string, unknown> | null;
    const runtimeLanes = Array.isArray(runtime?.lanes)
      ? (runtime?.lanes as Record<string, unknown>[])
      : [];
    const laneState = (lane: string): Record<string, unknown> | null =>
      runtimeLanes.find((value) => value.lane === lane) ?? serverlessByLane.get(lane) ?? null;
    const laneProgress = (lane: string): number | null => {
      const value = laneState(lane);
      if (!value) return null;
      if (value.accepted_item_count !== undefined)
        return hostedProgressPercent(value.accepted_item_count, value.planned_item_count);
      return hostedProgressPercent(value.items_completed, value.items_total ?? value.item_count);
    };
    const asr = (detail.attempts as Record<string, unknown>[]).find(
      (value) => value.kind === "ASR",
    );
    const render = (detail.attempts as Record<string, unknown>[]).find(
      (value) => value.kind === "RENDER",
    );
    const stages = [
      {
        id: "transcription",
        name: "Transcription",
        status: String(asr?.state ?? "WAITING"),
        progress_percent: asr?.state === "SUCCEEDED" ? 100 : asr ? 50 : 0,
        started_at: timestampOrNull(asr?.submitted_at),
        completed_at: timestampOrNull(asr?.terminal_at),
        detail: "Private voiceover transcription on the connected media worker.",
        eta_ms: null,
      },
      {
        id: "planning",
        name: "Deterministic planning",
        status: detail.generation ? "COMPLETE" : "WAITING",
        progress_percent: detail.generation ? 100 : 0,
        started_at: null,
        completed_at: null,
        detail: "Tenant-owned transcript and timeline plan.",
        eta_ms: null,
      },
      {
        id: "image-generation",
        name: "Image generation",
        status: String(laneState("mage_image")?.state ?? "WAITING_FOR_GPU_QUALIFICATION"),
        progress_percent: laneProgress("mage_image"),
        started_at: timestampOrNull(laneState("mage_image")?.created_at),
        completed_at: timestampOrNull(laneState("mage_image")?.terminal_at),
        detail: "Exact image lane state and accepted item count.",
        eta_ms: null,
      },
      {
        id: "avatar-generation",
        name: "Avatar generation",
        status: String(laneState("soulx_avatar")?.state ?? "WAITING_FOR_GPU_QUALIFICATION"),
        progress_percent: laneProgress("soulx_avatar"),
        started_at: timestampOrNull(laneState("soulx_avatar")?.created_at),
        completed_at: timestampOrNull(laneState("soulx_avatar")?.terminal_at),
        detail: "Exact avatar lane state and accepted item count.",
        eta_ms: null,
      },
      {
        id: "render",
        name: "Final render",
        status: String(render?.state ?? "WAITING"),
        progress_percent: render ? (render.state === "SUCCEEDED" ? 100 : 50) : 0,
        started_at: timestampOrNull(render?.submitted_at),
        completed_at: timestampOrNull(render?.terminal_at),
        detail: "Final MP4 is available only after checksum verification and review approval.",
        eta_ms: null,
      },
    ];
    const queueRow = detail.queue as Record<string, unknown> | null;
    const queue = queueRow
      ? {
          position: numberOrNull(queueRow.ahead) === null ? null : Number(queueRow.ahead) + 1,
          ahead: numberOrNull(queueRow.ahead),
          total: numberOrNull(queueRow.total),
          status: queueRow.state ?? null,
          estimated_wait_ms: null,
          fair_rotation: "DETERMINISTIC_ACCOUNT_ROTATION",
        }
      : null;
    const costRow = detail.cost as Record<string, unknown> | null;
    const projectedCost = costRow
      ? Math.max(
          numberOrNull(costRow.estimated_usd) ?? 0,
          numberOrNull(costRow.reserved_usd) ?? 0,
          numberOrNull(costRow.reported_usd) ?? 0,
        ) + (numberOrNull(costRow.possible_duplicate_usd) ?? 0)
      : 0;
    const settledCost = costRow ? (numberOrNull(costRow.settled_usd) ?? 0) : 0;
    const capCost = costRow
      ? (numberOrNull(costRow.maximum_cost_micro_usd) ?? 0) / 1_000_000
      : null;
    const timingRows = [...(detail.attempts as Record<string, unknown>[]), ...serverlessAttempts];
    const createdAt = timingRows
      .map((value) => new Date(String(value.created_at)).getTime())
      .filter(Number.isFinite)
      .sort((left, right) => left - right)[0];
    const terminalAt = timingRows
      .map((value) => (value.terminal_at ? new Date(String(value.terminal_at)).getTime() : NaN))
      .filter(Number.isFinite)
      .sort((left, right) => right - left)[0];
    const timing = {
      queue_wait_ms: elapsedMs(createdAt, queueRow?.admitted_at ?? timingRows[0]?.submitted_at),
      initialization_ms: elapsedMs(runtime?.admitted_at, runtime?.prepared_at),
      model_ready_ms: null,
      inference_ms: elapsedMs(render?.submitted_at, render?.terminal_at),
      upload_ms: null,
      render_ms: elapsedMs(render?.submitted_at, render?.terminal_at),
      end_to_end_ms: elapsedMs(createdAt, terminalAt),
    };
    const zeroWorkerRow = detail.zeroWorkers as Record<string, unknown> | null;
    const zeroWorkerCount = numberOrNull(zeroWorkerRow?.evidence_count) ?? 0;
    const scaleToZero = {
      state: zeroWorkerCount >= 2 ? "PROVEN_ZERO_WORKERS" : "NOT_PROVEN",
      worker_count: zeroWorkerCount >= 2 ? 0 : null,
      observed_at: timestampOrNull(zeroWorkerRow?.observed_at),
      evidence_id: zeroWorkerCount >= 2 ? String(zeroWorkerRow?.generation_request_id ?? "") : null,
      detail:
        zeroWorkerCount >= 2
          ? "Both qualified lanes have exact zero-worker and zero-queued-job observations."
          : "No current two-lane zero-worker proof is persisted for this project.",
    };
    const qualityFlags = [
      ...(detail.failedTasks as Record<string, unknown>[]).map((task) => ({
        id: String(task.id),
        asset_id: null,
        category: String(task.lane ?? "GENERATION"),
        severity: "ERROR",
        status: String(task.state),
        message: `Generation task ${String(task.task_key)} is ${String(task.state)}.`,
        retryable: task.state === "RETRY_WAIT",
        replacement_allowed: task.state === "RETRY_WAIT",
      })),
      ...serverlessAttempts
        .filter((attempt) =>
          ["RETRYABLE_FAILED", "PERMANENT_FAILED"].includes(String(attempt.state)),
        )
        .map((attempt) => ({
          id: String(attempt.id),
          asset_id: null,
          category: String(attempt.lane),
          severity: "ERROR",
          status: String(attempt.state),
          message: `The ${String(attempt.lane)} lane attempt is ${String(attempt.state)}.`,
          retryable: attempt.state === "RETRYABLE_FAILED",
          replacement_allowed: attempt.state === "RETRYABLE_FAILED",
        })),
    ];
    const sheet = await contactSheet(
      detail.serverlessOutputs as Record<string, unknown>[],
      environment.PRIVATE_ARTIFACTS,
      signer,
    );
    let downloadUrl: string | null = null;
    const reviewRow = detail.review as Record<string, unknown> | null;
    if (reviewRow) {
      const approvedAttempt = attempts.find(
        (value) => value.id === reviewRow.render_attempt_id && value.preview_url,
      );
      const outputObjectKey = approvedAttempt?.object_key;
      const outputLength = numberOrNull(approvedAttempt?.content_length);
      const outputChecksum = approvedAttempt?.output_checksum_sha256;
      if (
        typeof outputObjectKey === "string" &&
        outputLength !== null &&
        typeof outputChecksum === "string" &&
        SHA256.test(outputChecksum)
      ) {
        downloadUrl = (
          await signer.sign({
            method: "GET",
            objectKey: outputObjectKey,
            contentType: "video/mp4",
            contentLength: outputLength,
            checksumSha256: outputChecksum,
            lifetimeSeconds: 300,
            downloadFilename: "videoforge-output.mp4",
          })
        ).url;
      }
    }
    return response({
      schema_version: "videoforge-hosted-project-detail/v1",
      project: detail.project,
      attempts,
      gpu_transport: "DISABLED_UNQUALIFIED",
      gpu_readiness: hostedGpuReadiness(),
      generation:
        detail.generation === null
          ? null
          : {
              ...detail.generation,
              stage:
                Number(detail.generation.failed_tasks) > 0
                  ? "FAILED"
                  : Number(detail.generation.planned_tasks) > 0 &&
                      Number(detail.generation.completed_tasks) ===
                        Number(detail.generation.planned_tasks)
                    ? "READY_FOR_RENDER"
                    : "WAITING_FOR_GPU_QUALIFICATION",
            },
      queue,
      stages,
      timing,
      cost: {
        projected_usd: projectedCost,
        settled_usd: settledCost,
        cap_usd: capCost,
        billed_seconds: null,
        provider: serverlessAttempts.length > 0 ? "runpod" : "personal-worker",
      },
      scale_to_zero: scaleToZero,
      review: {
        contact_sheet: sheet,
        quality_flags: qualityFlags,
        manifest_url: `/api/v2/hosted/projects/${projectId}/manifest`,
        download_url: downloadUrl,
      },
      contact_sheet: sheet,
      quality_flags: qualityFlags,
      manifest_url: `/api/v2/hosted/projects/${projectId}/manifest`,
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
  if (request.method === "POST" && url.pathname === "/api/v2/hosted/projects/preflight")
    return projectPreflight(request, config, executionContext);
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
    return renderHandoff(request, render[1]!, environment, config, executionContext);
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

#!/usr/bin/env node

/**
 * Seed the exact tenant-owned presets required by the V2-06 hosted product journey.
 *
 * This utility deliberately uses the migration connection, never the hosted runtime role. It
 * performs a read-only preflight first, then runs one idempotent PostgreSQL transaction only when
 * the caller supplies V2_06_SEED_CONFIRM=YES. Ready/published versions are immutable in the
 * database; a replay succeeds only when the existing deterministic rows already match every
 * supplied fact. It never deletes rows, creates assets, or contacts a media/provider service.
 *
 * Example (after the exact activation authority has been recorded):
 *
 *   V2_06_MIGRATION_DATABASE_URL="..." \
 *   V2_06_SEED_CONFIRM=YES \
 *   V2_06_AVATAR_RIGHTS_CONFIRM=YES \
 *   V2_06_AVATAR_RIGHTS_BASIS=OWNED \
 *   V2_06_TENANT_EMAIL=person@example.com \
 *   V2_06_SEED_AT=2026-08-17T12:00:00Z \
 *   V2_06_AVATAR_ORIGINAL_ASSET_ID=... \
 *   V2_06_AVATAR_RUNTIME_ASSET_ID=... \
 *   V2_06_AVATAR_THUMBNAIL_ASSET_ID=... \
 *   node deploy/v2-06/seed-tenant-presets.mjs
 *
 * Use --dry-run to validate the payload files and print the deterministic plan without invoking
 * psql. The normal path keeps connection details, payloads, and database output out of stdout.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MIGRATION_ROOT = path.join(ROOT, "packages/control-plane/migrations");
const MIGRATION_MANIFEST_PATH = path.join(MIGRATION_ROOT, "manifest.json");
const DEFAULT_AVATAR_PAYLOAD = path.join(
  ROOT,
  "packages/contracts/generated/fixtures/avatar_profile_version.valid.json",
);
const DEFAULT_STYLE_PAYLOAD = path.join(
  ROOT,
  "packages/contracts/generated/fixtures/default_image_style_v1.json",
);
const DEFAULT_AVATAR_ENVELOPE_HASH =
  "sha256:fa75a60ef265e4a0704ca4ab103f30e185dd9de9ac0528eaf606fff7691ea869";
const DEFAULT_STYLE_PROFILE_HASH =
  "sha256:e344d37b9a04604891334cdd2b60601619885a4a16acad8eb15957340a90e430";
const APPROVED_NEON_HOST = "ep-sparkling-dew-azjhkwg6-pooler.c-3.ap-southeast-1.aws.neon.tech";
const APPROVED_NEON_DATABASE = "neondb";
const APPROVED_NEON_MIGRATION_ROLE = "neondb_owner";

async function loadMigrationIdentity() {
  const manifestBytes = await readFile(MIGRATION_MANIFEST_PATH, "utf8");
  const manifest = JSON.parse(manifestBytes);
  if (
    manifest?.schema_version !== "videoforge-migration-manifest/v1" ||
    !Array.isArray(manifest.migrations) ||
    manifest.migrations.length === 0
  )
    throw new Error("committed migration manifest is invalid");
  for (const [index, entry] of manifest.migrations.entries()) {
    if (entry.version !== index + 1)
      throw new Error("committed migration manifest is not a contiguous chain");
    const sql = await readFile(path.join(MIGRATION_ROOT, entry.filename), "utf8");
    const actual = `sha256:${createHash("sha256").update(sql).digest("hex")}`;
    if (actual !== entry.sha256)
      throw new Error(`migration ${entry.filename} does not match its manifest hash`);
  }
  return Object.freeze({
    head: manifest.migrations.at(-1).version,
    manifestSha256: `sha256:${createHash("sha256").update(manifestBytes).digest("hex")}`,
    ledgerJsonSqlLiteral: `'${JSON.stringify(
      manifest.migrations.map(({ version, name, filename, sha256 }) => ({
        version,
        name,
        filename,
        sha256,
      })),
    ).replaceAll("'", "''")}'::jsonb`,
  });
}

const MIGRATION_IDENTITY = await loadMigrationIdentity();
const MIGRATION_HEAD = MIGRATION_IDENTITY.head;
const MIGRATION_MANIFEST_SHA256 = MIGRATION_IDENTITY.manifestSha256;
const MIGRATION_LEDGER_JSON_SQL_LITERAL = MIGRATION_IDENTITY.ledgerJsonSqlLiteral;

// PostgreSQL uuid accepts all canonical 128-bit UUID text, including values derived from
// md5(... )::uuid by the hosted admission trigger. Do not require RFC-4122 version/variant bits
// for database-owned IDs.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?Z$/u;
const EMAIL = /^[^\s@]+@[^\s@]+$/u;
const RIGHTS_BASIS = new Set(["OWNED", "LICENSED", "PUBLIC_DOMAIN", "OTHER_DOCUMENTED_BASIS"]);

const AVATAR_PAYLOAD_KEYS = [
  "avatar_generation_consent",
  "framing_confirmation",
  "likeness_animation_rights_attested",
  "likeness_attested_by_user_id",
  "likeness_attested_at",
  "rights_attested_by_user_id",
  "rights_attested_at",
  "rights_basis",
  "runtime_source_asset_id",
  "runtime_source_sha256",
  "schema_version",
  "source_asset_id",
  "source_media",
  "source_preparation_version",
  "source_sha256",
  "source_validation_profile_version",
  "thumbnail_asset_id",
  "thumbnail_sha256",
].sort();

function canonicalJson(value) {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new TypeError("value is not JSON serializable");
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function sha256Canonical(value) {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

function deterministicUuid(label) {
  const hex = createHash("md5").update(label, "utf8").digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`;
}

function envOr(options, flag, envName, fallback = undefined) {
  return options[flag] ?? process.env[envName] ?? fallback;
}

function parseArgs(argv) {
  const options = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") options.help = true;
    else if (token === "--dry-run") options.dryRun = true;
    else if (token.startsWith("--")) {
      const key = token.slice(2).replaceAll("-", "_");
      if (!key || index + 1 >= argv.length || argv[index + 1].startsWith("--")) {
        throw new Error(`missing value for ${token}`);
      }
      options[key] = argv[++index];
    } else options._.push(token);
  }
  if (options._.length > 0) throw new Error(`unexpected argument ${options._[0]}`);
  return options;
}

function requireText(value, name) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("\u0000") ||
    value.includes("\r") ||
    value.includes("\n")
  ) {
    throw new Error(`${name} must be a non-empty single-line value`);
  }
  return value;
}

function requireUuid(value, name) {
  requireText(value, name);
  if (!UUID.test(value)) throw new Error(`${name} must be a canonical UUID`);
  return value;
}

function requireTimestamp(value, name) {
  requireText(value, name);
  if (!TIMESTAMP.test(value)) throw new Error(`${name} must be an RFC3339 UTC timestamp`);
  if (Number.isNaN(Date.parse(value))) throw new Error(`${name} is not a valid timestamp`);
  return value;
}

function requireSha256(value, name) {
  requireText(value, name);
  if (!SHA256.test(value)) throw new Error(`${name} must be sha256:<64 lowercase hex>`);
  return value;
}

function exactKeys(value, expected, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  const actual = Object.keys(value).sort();
  if (actual.join(",") !== expected.join(",")) {
    throw new Error(`${name} has unexpected or missing fields`);
  }
}

function readJsonFile(file, name) {
  return readFile(file, "utf8")
    .then((raw) => {
      let value;
      try {
        value = JSON.parse(raw);
      } catch {
        throw new Error(`${name} is not valid JSON`);
      }
      return value;
    })
    .catch((error) => {
      if (error?.message?.startsWith(`${name} `)) throw error;
      throw new Error(`${name} could not be read`);
    });
}

function validateAvatarEnvelope(value) {
  exactKeys(value, AVATAR_PAYLOAD_KEYS, "avatar payload");
  if (value.schema_version !== "avatar-profile-version/v1")
    throw new Error("avatar payload schema_version is not avatar-profile-version/v1");
  if (sha256Canonical(value) !== DEFAULT_AVATAR_ENVELOPE_HASH)
    throw new Error("avatar payload must be the pinned V2-06 activation contract fixture");
  if (value.rights_basis !== "OWNED")
    throw new Error("avatar payload fixture must begin with OWNED rights basis");
  if (value.avatar_generation_consent !== true || value.likeness_animation_rights_attested !== true)
    throw new Error("avatar payload consent fields must be true");
  return value;
}

function validateStylePayload(value) {
  exactKeys(
    value,
    ["analysis", "prompt_profile", "schema_version", "summary", "visual_profile"],
    "style payload",
  );
  if (value.schema_version !== "image-style-profile/v1")
    throw new Error("style payload schema_version is not image-style-profile/v1");
  if (typeof value.summary !== "string" || value.summary.trim().length === 0)
    throw new Error("style payload summary must be a non-empty string");
  if (sha256Canonical(value) !== DEFAULT_STYLE_PROFILE_HASH)
    throw new Error("style payload must be the pinned documentary activation profile");
  for (const key of ["visual_profile", "prompt_profile", "analysis"]) {
    if (value[key] === null || typeof value[key] !== "object")
      throw new Error(`style payload ${key} must be an object or non-empty value`);
  }
  return value;
}

function buildPlan({
  scope,
  assets,
  avatarEnvelope,
  stylePayload,
  seedAt,
  rightsBasis,
  avatarName,
  styleName,
}) {
  const byRole = new Map(assets.map((asset) => [asset.role, asset]));
  const original = byRole.get("ORIGINAL");
  const runtime = byRole.get("RUNTIME");
  const thumbnail = byRole.get("THUMBNAIL");
  if (!original || !runtime || !thumbnail)
    throw new Error("preflight did not return all avatar assets");
  if (new Set([original.asset_id, runtime.asset_id, thumbnail.asset_id]).size !== 3)
    throw new Error("avatar asset IDs must be distinct");

  const imageMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
  for (const [asset, label] of [
    [original, "original"],
    [thumbnail, "thumbnail"],
  ]) {
    if (
      asset.state !== "VERIFIED" ||
      asset.kind !== (label === "original" ? "AVATAR_ORIGINAL" : "AVATAR_THUMBNAIL")
    )
      throw new Error(
        `${label} asset must be a VERIFIED ${label === "original" ? "AVATAR_ORIGINAL" : "AVATAR_THUMBNAIL"}`,
      );
    if (!imageMimeTypes.has(asset.content_type))
      throw new Error(`${label} asset must be a supported raster image`);
    if (
      !Number.isSafeInteger(Number(asset.byte_size)) ||
      Number(asset.byte_size) < 1 ||
      Number(asset.byte_size) > 20 * 1024 * 1024
    )
      throw new Error(`${label} asset byte size is outside avatar contract`);
    if (
      !Number.isSafeInteger(Number(asset.width_px)) ||
      Number(asset.width_px) < 512 ||
      Number(asset.width_px) > 16_384
    )
      throw new Error(`${label} asset width is outside avatar contract`);
    if (
      !Number.isSafeInteger(Number(asset.height_px)) ||
      Number(asset.height_px) < 512 ||
      Number(asset.height_px) > 16_384
    )
      throw new Error(`${label} asset height is outside avatar contract`);
    requireSha256(asset.binary_sha256, `${label} asset hash`);
  }
  if (runtime.state !== "VERIFIED" || runtime.kind !== "AVATAR_RUNTIME")
    throw new Error("runtime asset must be a VERIFIED AVATAR_RUNTIME asset");
  if (!String(runtime.content_type).startsWith("video/"))
    throw new Error("runtime asset must be a video");
  if (!Number.isSafeInteger(Number(runtime.byte_size)) || Number(runtime.byte_size) < 1)
    throw new Error("runtime asset byte size must be positive");
  requireSha256(runtime.binary_sha256, "runtime asset hash");

  const avatarPayload = structuredClone(avatarEnvelope);
  avatarPayload.source_asset_id = original.asset_id;
  avatarPayload.source_sha256 = original.binary_sha256;
  avatarPayload.source_media = {
    mime_type: original.content_type,
    width: Number(original.width_px),
    height: Number(original.height_px),
    bytes: Number(original.byte_size),
  };
  avatarPayload.runtime_source_asset_id = runtime.asset_id;
  avatarPayload.runtime_source_sha256 = runtime.binary_sha256;
  avatarPayload.thumbnail_asset_id = thumbnail.asset_id;
  avatarPayload.thumbnail_sha256 = thumbnail.binary_sha256;
  avatarPayload.rights_basis = rightsBasis;
  avatarPayload.framing_confirmation.confirmed_by_user_id = scope.user_id;
  avatarPayload.framing_confirmation.confirmed_at = seedAt;
  avatarPayload.rights_attested_by_user_id = scope.user_id;
  avatarPayload.rights_attested_at = seedAt;
  avatarPayload.likeness_attested_by_user_id = scope.user_id;
  avatarPayload.likeness_attested_at = seedAt;
  const avatarProfileHash = sha256Canonical(avatarPayload);
  const styleProfileHash = sha256Canonical(stylePayload);
  const avatarProfileId = deterministicUuid(
    `videoforge:v2-06:${scope.account_id}:avatar:activation`,
  );
  const avatarVersionId = deterministicUuid(
    `videoforge:v2-06:${scope.account_id}:avatar:activation:v1`,
  );
  const styleId = deterministicUuid(`videoforge:v2-06:${scope.account_id}:style:activation`);
  const styleVersionId = deterministicUuid(
    `videoforge:v2-06:${scope.account_id}:style:activation:v1`,
  );
  const avatarAssetLinkIds = {
    ORIGINAL: deterministicUuid(`videoforge:v2-06:${avatarVersionId}:ORIGINAL`),
    RUNTIME: deterministicUuid(`videoforge:v2-06:${avatarVersionId}:RUNTIME`),
    THUMBNAIL: deterministicUuid(`videoforge:v2-06:${avatarVersionId}:THUMBNAIL`),
  };
  return Object.freeze({
    scope,
    assets: { original, runtime, thumbnail },
    avatarPayload,
    stylePayload,
    avatarProfileHash,
    styleProfileHash,
    avatarProfileId,
    avatarVersionId,
    styleId,
    styleVersionId,
    avatarAssetLinkIds,
    seedAt,
    rightsBasis,
    avatarName,
    styleName,
  });
}

function psqlEnvironment(databaseUrl) {
  let url;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error("V2_06_MIGRATION_DATABASE_URL is not a valid PostgreSQL URL");
  }
  if (!/^postgres(?:ql)?:$/u.test(url.protocol))
    throw new Error("V2_06_MIGRATION_DATABASE_URL must use postgres:// or postgresql://");
  if (url.hostname !== APPROVED_NEON_HOST)
    throw new Error("V2_06_MIGRATION_DATABASE_URL must target the approved Neon endpoint");
  const database = decodeURIComponent(url.pathname.replace(/^\//u, ""));
  if (database !== APPROVED_NEON_DATABASE)
    throw new Error("V2_06_MIGRATION_DATABASE_URL must target the approved Neon database");
  const user = decodeURIComponent(url.username);
  if (user !== APPROVED_NEON_MIGRATION_ROLE)
    throw new Error("migration seed requires the approved migration owner role");
  if (url.searchParams.get("sslmode") !== "require")
    throw new Error("V2_06_MIGRATION_DATABASE_URL must require TLS");
  if (url.searchParams.get("channel_binding") !== "require")
    throw new Error("V2_06_MIGRATION_DATABASE_URL must require channel binding");
  const env = { ...process.env, PGHOST: url.hostname, PGUSER: user };
  if (url.port) env.PGPORT = url.port;
  if (url.password) env.PGPASSWORD = decodeURIComponent(url.password);
  env.PGDATABASE = decodeURIComponent(url.pathname.replace(/^\//u, ""));
  if (!env.PGDATABASE) throw new Error("database URL must name a database");
  const params = new URLSearchParams(url.search);
  const sslMode = params.get("sslmode");
  if (sslMode) env.PGSSLMODE = sslMode;
  const channelBinding = params.get("channel_binding");
  if (channelBinding) env.PGCHANNELBINDING = channelBinding;
  return env;
}

function runPsql({ databaseUrl, sql, variables = {}, label, quiet = true }) {
  const env = psqlEnvironment(databaseUrl);
  const args = ["--no-psqlrc", "--set=ON_ERROR_STOP=1"];
  if (quiet) args.push("--quiet");
  for (const [key, value] of Object.entries(variables)) args.push(`--set=${key}=${value}`);
  const result = spawnSync("psql", args, {
    input: sql,
    encoding: "utf8",
    env,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error?.code === "ENOENT") throw new Error("psql is required to seed hosted presets");
  if (result.status !== 0) throw new Error(`${label} failed (database output suppressed)`);
  return result.stdout.trim();
}

const PREFLIGHT_SCOPE_SQL = String.raw`
SET search_path = public, pg_catalog;
SELECT COALESCE(json_agg(to_jsonb(found) ORDER BY found.account_id), '[]'::json)::text
  FROM (
    SELECT auth.id AS hosted_auth_user_id,
           link.user_id::text AS user_id,
           link.admitted_account_id::text AS account_id,
           link.workspace_id::text AS workspace_id,
           auth.email,
           auth.email_verified,
           account.scope_kind AS account_scope_kind,
           account.status AS account_status,
           workspace.status AS workspace_status,
           workspace.is_default,
           membership.status AS membership_status,
           membership.role AS membership_role
      FROM hosted_auth_users AS auth
      JOIN hosted_auth_links AS link ON link.hosted_auth_user_id = auth.id
      JOIN accounts AS account ON account.id = link.admitted_account_id
      JOIN workspaces AS workspace
        ON workspace.account_id = link.admitted_account_id
       AND workspace.id = link.workspace_id
      JOIN memberships AS membership
        ON membership.account_id = link.admitted_account_id
       AND membership.workspace_id = link.workspace_id
       AND membership.user_id = link.user_id
     WHERE auth.email = lower(btrim(:'tenant_email'))
  ) AS found;
`;

const PREFLIGHT_ASSET_SQL = String.raw`
SET search_path = public, pg_catalog;
WITH expected(role, asset_id) AS (
  VALUES
    ('ORIGINAL', :'original_asset_id'::uuid),
    ('RUNTIME', :'runtime_asset_id'::uuid),
    ('THUMBNAIL', :'thumbnail_asset_id'::uuid)
)
SELECT COALESCE(json_agg(to_jsonb(found) ORDER BY found.role), '[]'::json)::text
  FROM (
    SELECT expected.role,
           expected.asset_id::text,
           asset.account_id::text,
           asset.workspace_id::text,
           asset.kind,
           asset.state,
           asset.binary_sha256,
           asset.content_type,
           asset.byte_size,
           asset.width_px,
           asset.height_px
      FROM expected
      LEFT JOIN assets AS asset ON asset.id = expected.asset_id
  ) AS found;
`;

function mutationSql() {
  return String.raw`
BEGIN;
SET LOCAL search_path = public, pg_catalog;
SET LOCAL videoforge.account_id = :'account_id';

DO $guard$
DECLARE
  migration_head integer;
  account_scope text;
  account_status text;
  workspace_status text;
  workspace_default boolean;
  membership_count integer;
  existing_count integer;
BEGIN
  SELECT max(version) INTO migration_head FROM public.videoforge_schema_migrations;
  IF migration_head IS DISTINCT FROM ${MIGRATION_HEAD} THEN
    RAISE EXCEPTION 'V2-06 preset seed requires committed manifest head ${MIGRATION_HEAD}, found %', migration_head;
  END IF;
  IF (
    SELECT jsonb_agg(
      jsonb_build_object(
        'version', version,
        'name', name,
        'filename', filename,
        'sha256', sha256
      ) ORDER BY version
    )
      FROM public.videoforge_schema_migrations
  ) IS DISTINCT FROM ${MIGRATION_LEDGER_JSON_SQL_LITERAL} THEN
    RAISE EXCEPTION 'V2-06 preset seed requires the exact committed migration ledger';
  END IF;
  SELECT scope_kind, status INTO account_scope, account_status
    FROM public.accounts WHERE id = :'account_id'::uuid;
  IF account_scope IS DISTINCT FROM 'USER' OR account_status IS DISTINCT FROM 'ACTIVE' THEN
    RAISE EXCEPTION 'preset seed target is not one active USER account';
  END IF;
  SELECT status, is_default INTO workspace_status, workspace_default
    FROM public.workspaces
   WHERE account_id = :'account_id'::uuid AND id = :'workspace_id'::uuid;
  IF workspace_status IS DISTINCT FROM 'ACTIVE' OR workspace_default IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'preset seed target workspace is not the active default workspace';
  END IF;
  SELECT count(*) INTO membership_count
    FROM public.memberships
   WHERE account_id = :'account_id'::uuid
     AND workspace_id = :'workspace_id'::uuid
     AND user_id = :'user_id'::uuid
     AND status = 'ACTIVE'
     AND role = 'ADMIN';
  IF membership_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'preset seed target must have exactly one active owner membership';
  END IF;
  SELECT count(*) INTO existing_count
    FROM public.avatar_profiles AS profile
   WHERE profile.id = :'avatar_profile_id'::uuid
      OR profile.id = :'avatar_version_id'::uuid;
  IF existing_count > 1 THEN
    RAISE EXCEPTION 'deterministic avatar seed IDs collide with multiple parent rows';
  END IF;
END;
$guard$;

-- Assets are preflighted and immutable. This transaction only references existing verified bytes;
-- it never manufactures a metadata row for missing media.
DO $assets$
DECLARE
  expected_count integer;
BEGIN
  SELECT count(*) INTO expected_count
    FROM public.assets AS asset
   WHERE asset.account_id = :'account_id'::uuid
     AND asset.workspace_id = :'workspace_id'::uuid
     AND asset.id IN (
       :'original_asset_id'::uuid,
       :'runtime_asset_id'::uuid,
       :'thumbnail_asset_id'::uuid
     )
     AND asset.state = 'VERIFIED'
     AND asset.binary_sha256 IS NOT NULL;
  IF expected_count <> 3 THEN
    RAISE EXCEPTION 'all three avatar assets must already be tenant-owned VERIFIED bytes';
  END IF;
END;
$assets$;

INSERT INTO public.avatar_profiles (
  id, account_id, workspace_id, name, normalized_name, status, active_version_id,
  thumbnail_asset_id, created_by_user_id, created_at, updated_at
) VALUES (
  :'avatar_profile_id'::uuid, :'account_id'::uuid, :'workspace_id'::uuid,
  :'avatar_name', lower(btrim(:'avatar_name')), 'ACTIVE', NULL,
  :'thumbnail_asset_id'::uuid, :'user_id'::uuid, :'seed_at'::timestamptz, :'seed_at'::timestamptz
)
ON CONFLICT (id) DO NOTHING;

DO $avatar_parent$
DECLARE
  profile public.avatar_profiles%ROWTYPE;
BEGIN
  SELECT * INTO profile FROM public.avatar_profiles WHERE id = :'avatar_profile_id'::uuid FOR UPDATE;
  IF profile.account_id IS DISTINCT FROM :'account_id'::uuid
     OR profile.workspace_id IS DISTINCT FROM :'workspace_id'::uuid
     OR profile.name IS DISTINCT FROM :'avatar_name'
     OR profile.normalized_name IS DISTINCT FROM lower(btrim(:'avatar_name'))
     OR profile.status IS DISTINCT FROM 'ACTIVE'
     OR profile.created_by_user_id IS DISTINCT FROM :'user_id'::uuid
     OR profile.thumbnail_asset_id IS DISTINCT FROM :'thumbnail_asset_id'::uuid
     OR (profile.active_version_id IS NOT NULL AND profile.active_version_id IS DISTINCT FROM :'avatar_version_id'::uuid)
     OR profile.scope_kind IS DISTINCT FROM 'WORKSPACE' THEN
    RAISE EXCEPTION 'existing deterministic avatar parent does not exactly match this tenant seed';
  END IF;
END;
$avatar_parent$;

INSERT INTO public.avatar_profile_versions (
  id, account_id, workspace_id, profile_id, version_number, state,
  profile_contract_name, profile_contract_version, profile_payload, profile_hash,
  original_asset_id, runtime_source_asset_id, runtime_source_binary_sha256,
  source_preparation_profile, source_validation_profile,
  rights_attested_by_user_id, likeness_attested_by_user_id, created_at, updated_at, ready_at
) VALUES (
  :'avatar_version_id'::uuid, :'account_id'::uuid, :'workspace_id'::uuid,
  :'avatar_profile_id'::uuid, 1, 'READY', 'avatar-profile-version', 'v1',
  :'avatar_payload'::jsonb, :'avatar_profile_hash', :'original_asset_id'::uuid,
  :'runtime_asset_id'::uuid, (SELECT binary_sha256 FROM public.assets WHERE id = :'runtime_asset_id'::uuid),
  'avatar-source-prep-v1', 'avatar-source-validation-v1', :'user_id'::uuid, :'user_id'::uuid,
  :'seed_at'::timestamptz, :'seed_at'::timestamptz, :'seed_at'::timestamptz
)
ON CONFLICT (id) DO NOTHING;

DO $avatar_version$
DECLARE
  version public.avatar_profile_versions%ROWTYPE;
BEGIN
  SELECT * INTO version FROM public.avatar_profile_versions WHERE id = :'avatar_version_id'::uuid FOR UPDATE;
  IF version.account_id IS DISTINCT FROM :'account_id'::uuid
     OR version.workspace_id IS DISTINCT FROM :'workspace_id'::uuid
     OR version.profile_id IS DISTINCT FROM :'avatar_profile_id'::uuid
     OR version.version_number IS DISTINCT FROM 1
     OR version.state IS DISTINCT FROM 'READY'
     OR version.profile_contract_name IS DISTINCT FROM 'avatar-profile-version'
     OR version.profile_contract_version IS DISTINCT FROM 'v1'
     OR version.profile_payload IS DISTINCT FROM :'avatar_payload'::jsonb
     OR version.profile_hash IS DISTINCT FROM :'avatar_profile_hash'
     OR version.original_asset_id IS DISTINCT FROM :'original_asset_id'::uuid
     OR version.runtime_source_asset_id IS DISTINCT FROM :'runtime_asset_id'::uuid
     OR version.runtime_source_binary_sha256 IS DISTINCT FROM (SELECT binary_sha256 FROM public.assets WHERE id = :'runtime_asset_id'::uuid)
     OR version.rights_attested_by_user_id IS DISTINCT FROM :'user_id'::uuid
     OR version.likeness_attested_by_user_id IS DISTINCT FROM :'user_id'::uuid
     OR version.ready_at IS DISTINCT FROM :'seed_at'::timestamptz THEN
    RAISE EXCEPTION 'existing deterministic avatar version is not an exact immutable match';
  END IF;
END;
$avatar_version$;

INSERT INTO public.avatar_profile_assets (
  id, account_id, workspace_id, profile_id, version_id, asset_id, role,
  binary_sha256, retention_state, created_at
) VALUES
  (:'avatar_original_link_id'::uuid, :'account_id'::uuid, :'workspace_id'::uuid,
   :'avatar_profile_id'::uuid, :'avatar_version_id'::uuid, :'original_asset_id'::uuid,
   'ORIGINAL', (SELECT binary_sha256 FROM public.assets WHERE id = :'original_asset_id'::uuid), 'RETAIN', :'seed_at'::timestamptz),
  (:'avatar_runtime_link_id'::uuid, :'account_id'::uuid, :'workspace_id'::uuid,
   :'avatar_profile_id'::uuid, :'avatar_version_id'::uuid, :'runtime_asset_id'::uuid,
   'RUNTIME', (SELECT binary_sha256 FROM public.assets WHERE id = :'runtime_asset_id'::uuid), 'RETAIN', :'seed_at'::timestamptz),
  (:'avatar_thumbnail_link_id'::uuid, :'account_id'::uuid, :'workspace_id'::uuid,
   :'avatar_profile_id'::uuid, :'avatar_version_id'::uuid, :'thumbnail_asset_id'::uuid,
   'THUMBNAIL', (SELECT binary_sha256 FROM public.assets WHERE id = :'thumbnail_asset_id'::uuid), 'RETAIN', :'seed_at'::timestamptz)
ON CONFLICT (id) DO NOTHING;

DO $avatar_assets$
BEGIN
  IF EXISTS (
    WITH expected(id, asset_id, role, binary_sha256) AS (
      VALUES
        (:'avatar_original_link_id'::uuid, :'original_asset_id'::uuid, 'ORIGINAL',
         (SELECT binary_sha256 FROM public.assets WHERE id = :'original_asset_id'::uuid)),
        (:'avatar_runtime_link_id'::uuid, :'runtime_asset_id'::uuid, 'RUNTIME',
         (SELECT binary_sha256 FROM public.assets WHERE id = :'runtime_asset_id'::uuid)),
        (:'avatar_thumbnail_link_id'::uuid, :'thumbnail_asset_id'::uuid, 'THUMBNAIL',
         (SELECT binary_sha256 FROM public.assets WHERE id = :'thumbnail_asset_id'::uuid))
    )
    SELECT 1
      FROM expected
      LEFT JOIN public.avatar_profile_assets AS link ON link.id = expected.id
     WHERE link.id IS NULL
        OR link.account_id IS DISTINCT FROM :'account_id'::uuid
        OR link.workspace_id IS DISTINCT FROM :'workspace_id'::uuid
        OR link.profile_id IS DISTINCT FROM :'avatar_profile_id'::uuid
        OR link.version_id IS DISTINCT FROM :'avatar_version_id'::uuid
        OR link.asset_id IS DISTINCT FROM expected.asset_id
        OR link.role IS DISTINCT FROM expected.role
        OR link.binary_sha256 IS DISTINCT FROM expected.binary_sha256
        OR link.retention_state IS DISTINCT FROM 'RETAIN'
        OR link.deleted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'existing deterministic avatar asset links are not exact immutable matches';
  END IF;
END;
$avatar_assets$;

UPDATE public.avatar_profiles
   SET active_version_id = :'avatar_version_id'::uuid,
       updated_at = :'seed_at'::timestamptz
 WHERE id = :'avatar_profile_id'::uuid AND active_version_id IS NULL;

INSERT INTO public.image_styles (
  id, account_id, workspace_id, name, normalized_name, status, active_version_id,
  created_by_user_id, created_at, updated_at
) VALUES (
  :'style_id'::uuid, :'account_id'::uuid, :'workspace_id'::uuid,
  :'style_name', lower(btrim(:'style_name')), 'ACTIVE', NULL,
  :'user_id'::uuid, :'seed_at'::timestamptz, :'seed_at'::timestamptz
)
ON CONFLICT (id) DO NOTHING;

DO $style_parent$
DECLARE
  style public.image_styles%ROWTYPE;
BEGIN
  SELECT * INTO style FROM public.image_styles WHERE id = :'style_id'::uuid FOR UPDATE;
  IF style.account_id IS DISTINCT FROM :'account_id'::uuid
     OR style.workspace_id IS DISTINCT FROM :'workspace_id'::uuid
     OR style.name IS DISTINCT FROM :'style_name'
     OR style.normalized_name IS DISTINCT FROM lower(btrim(:'style_name'))
     OR style.status IS DISTINCT FROM 'ACTIVE'
     OR style.created_by_user_id IS DISTINCT FROM :'user_id'::uuid
     OR (style.active_version_id IS NOT NULL AND style.active_version_id IS DISTINCT FROM :'style_version_id'::uuid)
     OR style.scope_kind IS DISTINCT FROM 'WORKSPACE' THEN
    RAISE EXCEPTION 'existing deterministic style parent does not exactly match this tenant seed';
  END IF;
END;
$style_parent$;

INSERT INTO public.image_style_versions (
  id, account_id, workspace_id, style_id, version_number, state,
  profile_contract_name, profile_contract_version, profile_payload, style_profile_hash,
  disclosure_attested_by_user_id, created_at, updated_at, published_at
) VALUES (
  :'style_version_id'::uuid, :'account_id'::uuid, :'workspace_id'::uuid,
  :'style_id'::uuid, 1, 'PUBLISHED', 'image-style-profile', 'v1',
  :'style_payload'::jsonb, :'style_profile_hash', :'user_id'::uuid,
  :'seed_at'::timestamptz, :'seed_at'::timestamptz, :'seed_at'::timestamptz
)
ON CONFLICT (id) DO NOTHING;

DO $style_version$
DECLARE
  version public.image_style_versions%ROWTYPE;
BEGIN
  SELECT * INTO version FROM public.image_style_versions WHERE id = :'style_version_id'::uuid FOR UPDATE;
  IF version.account_id IS DISTINCT FROM :'account_id'::uuid
     OR version.workspace_id IS DISTINCT FROM :'workspace_id'::uuid
     OR version.style_id IS DISTINCT FROM :'style_id'::uuid
     OR version.version_number IS DISTINCT FROM 1
     OR version.state IS DISTINCT FROM 'PUBLISHED'
     OR version.profile_contract_name IS DISTINCT FROM 'image-style-profile'
     OR version.profile_contract_version IS DISTINCT FROM 'v1'
     OR version.profile_payload IS DISTINCT FROM :'style_payload'::jsonb
     OR version.style_profile_hash IS DISTINCT FROM :'style_profile_hash'
     OR version.disclosure_attested_by_user_id IS DISTINCT FROM :'user_id'::uuid
     OR version.published_at IS DISTINCT FROM :'seed_at'::timestamptz THEN
    RAISE EXCEPTION 'existing deterministic style version is not an exact immutable match';
  END IF;
END;
$style_version$;

UPDATE public.image_styles
   SET active_version_id = :'style_version_id'::uuid,
       updated_at = :'seed_at'::timestamptz
 WHERE id = :'style_id'::uuid AND active_version_id IS NULL;

-- Final assertions are inside the same transaction and therefore cannot observe a partial seed.
DO $final$
DECLARE
  avatar_ready integer;
  style_published integer;
BEGIN
  SELECT count(*) INTO avatar_ready
    FROM public.avatar_profiles AS profile
    JOIN public.avatar_profile_versions AS version
      ON version.account_id = profile.account_id
     AND version.workspace_id = profile.workspace_id
     AND version.profile_id = profile.id
     AND version.id = profile.active_version_id
   WHERE profile.id = :'avatar_profile_id'::uuid
     AND profile.account_id = :'account_id'::uuid
     AND profile.workspace_id = :'workspace_id'::uuid
     AND profile.status = 'ACTIVE'
     AND version.state = 'READY';
  SELECT count(*) INTO style_published
    FROM public.image_styles AS style
    JOIN public.image_style_versions AS version
      ON version.account_id = style.account_id
     AND version.workspace_id = style.workspace_id
     AND version.style_id = style.id
     AND version.id = style.active_version_id
   WHERE style.id = :'style_id'::uuid
     AND style.account_id = :'account_id'::uuid
     AND style.workspace_id = :'workspace_id'::uuid
     AND style.status = 'ACTIVE'
     AND version.state = 'PUBLISHED';
  IF avatar_ready <> 1 OR style_published <> 1 THEN
    RAISE EXCEPTION 'tenant preset seed did not produce one active READY avatar and one active PUBLISHED style';
  END IF;
END;
$final$;

COMMIT;
SELECT json_build_object(
  'account_id', :'account_id',
  'workspace_id', :'workspace_id',
  'avatar_profile_version_id', :'avatar_version_id',
  'image_style_version_id', :'style_version_id',
  'avatar_profile_hash', :'avatar_profile_hash',
  'style_profile_hash', :'style_profile_hash'
)::text;
`;
}

function mutationVariables(plan) {
  return {
    account_id: plan.scope.account_id,
    workspace_id: plan.scope.workspace_id,
    user_id: plan.scope.user_id,
    seed_at: plan.seedAt,
    avatar_name: plan.avatarName,
    style_name: plan.styleName,
    avatar_profile_id: plan.avatarProfileId,
    avatar_version_id: plan.avatarVersionId,
    style_id: plan.styleId,
    style_version_id: plan.styleVersionId,
    original_asset_id: plan.assets.original.asset_id,
    runtime_asset_id: plan.assets.runtime.asset_id,
    thumbnail_asset_id: plan.assets.thumbnail.asset_id,
    avatar_original_link_id: plan.avatarAssetLinkIds.ORIGINAL,
    avatar_runtime_link_id: plan.avatarAssetLinkIds.RUNTIME,
    avatar_thumbnail_link_id: plan.avatarAssetLinkIds.THUMBNAIL,
    avatar_profile_hash: plan.avatarProfileHash,
    style_profile_hash: plan.styleProfileHash,
    avatar_payload: JSON.stringify(plan.avatarPayload),
    style_payload: JSON.stringify(plan.stylePayload),
  };
}

function printHelp() {
  console.log(
    `V2-06 tenant preset seed\n\nRequired environment (normal run):\n  V2_06_MIGRATION_DATABASE_URL       migration-owner PostgreSQL URL (never runtime role)\n  V2_06_SEED_CONFIRM=YES              explicit database mutation confirmation\n  V2_06_AVATAR_RIGHTS_CONFIRM=YES    confirms the supplied avatar rights attestation\n  V2_06_AVATAR_RIGHTS_BASIS          OWNED, LICENSED, PUBLIC_DOMAIN, or OTHER_DOCUMENTED_BASIS\n  V2_06_TENANT_EMAIL                  exact admitted Google email\n  V2_06_SEED_AT                       fixed RFC3339 UTC timestamp for idempotent replay\n  V2_06_AVATAR_ORIGINAL_ASSET_ID      existing VERIFIED AVATAR_ORIGINAL asset UUID\n  V2_06_AVATAR_RUNTIME_ASSET_ID       existing VERIFIED AVATAR_RUNTIME asset UUID\n  V2_06_AVATAR_THUMBNAIL_ASSET_ID     existing VERIFIED AVATAR_THUMBNAIL asset UUID\n\nOptional environment/flags:\n  V2_06_AVATAR_NAME (default: Activation Presenter)\n  V2_06_STYLE_NAME (default: Authentic Documentary Stock)\n  V2_06_AVATAR_PAYLOAD_FILE (default: tracked avatar contract fixture)\n  V2_06_STYLE_PAYLOAD_FILE (default: tracked documentary style profile)\n  --dry-run                            validate payloads and print the deterministic plan only\n`,
  );
}

async function loadInputs(options) {
  const tenantEmail = envOr(options, "tenant_email", "V2_06_TENANT_EMAIL");
  const seedAt = envOr(options, "seed_at", "V2_06_SEED_AT");
  const originalAssetId = envOr(options, "original_asset_id", "V2_06_AVATAR_ORIGINAL_ASSET_ID");
  const runtimeAssetId = envOr(options, "runtime_asset_id", "V2_06_AVATAR_RUNTIME_ASSET_ID");
  const thumbnailAssetId = envOr(options, "thumbnail_asset_id", "V2_06_AVATAR_THUMBNAIL_ASSET_ID");
  const rightsBasis = envOr(options, "rights_basis", "V2_06_AVATAR_RIGHTS_BASIS");
  const avatarName = envOr(options, "avatar_name", "V2_06_AVATAR_NAME", "Activation Presenter");
  const styleName = envOr(options, "style_name", "V2_06_STYLE_NAME", "Authentic Documentary Stock");
  const avatarPayloadFile = envOr(
    options,
    "avatar_payload_file",
    "V2_06_AVATAR_PAYLOAD_FILE",
    DEFAULT_AVATAR_PAYLOAD,
  );
  const stylePayloadFile = envOr(
    options,
    "style_payload_file",
    "V2_06_STYLE_PAYLOAD_FILE",
    DEFAULT_STYLE_PAYLOAD,
  );

  if (!EMAIL.test(requireText(tenantEmail, "V2_06_TENANT_EMAIL")))
    throw new Error("V2_06_TENANT_EMAIL must be a valid single-line email");
  requireTimestamp(seedAt, "V2_06_SEED_AT");
  requireUuid(originalAssetId, "V2_06_AVATAR_ORIGINAL_ASSET_ID");
  requireUuid(runtimeAssetId, "V2_06_AVATAR_RUNTIME_ASSET_ID");
  requireUuid(thumbnailAssetId, "V2_06_AVATAR_THUMBNAIL_ASSET_ID");
  if (new Set([originalAssetId, runtimeAssetId, thumbnailAssetId]).size !== 3)
    throw new Error("avatar asset IDs must be distinct");
  if (!RIGHTS_BASIS.has(rightsBasis)) throw new Error("V2_06_AVATAR_RIGHTS_BASIS is unsupported");
  requireText(avatarName, "V2_06_AVATAR_NAME");
  requireText(styleName, "V2_06_STYLE_NAME");
  if (avatarName.trim() !== avatarName || styleName.trim() !== styleName)
    throw new Error("preset names must not have surrounding whitespace");
  if (avatarName.length > 160 || styleName.length > 160)
    throw new Error("preset names must be at most 160 characters");
  const avatarEnvelope = validateAvatarEnvelope(
    await readJsonFile(avatarPayloadFile, "avatar payload file"),
  );
  const stylePayload = validateStylePayload(
    await readJsonFile(stylePayloadFile, "style payload file"),
  );
  return {
    tenantEmail: tenantEmail.trim().toLowerCase(),
    seedAt,
    originalAssetId,
    runtimeAssetId,
    thumbnailAssetId,
    rightsBasis,
    avatarName,
    styleName,
    avatarEnvelope,
    stylePayload,
  };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return;
  }
  const inputs = await loadInputs(options);
  if (options.dryRun) {
    console.log("V2-06 tenant preset seed input validation passed.");
    console.log(`tenant_email=${inputs.tenantEmail}`);
    console.log(`seed_at=${inputs.seedAt}`);
    console.log(`avatar_name=${inputs.avatarName}`);
    console.log(`style_name=${inputs.styleName}`);
    console.log("database_mutation=SKIPPED_DRY_RUN");
    return;
  }
  if (process.env.V2_06_SEED_CONFIRM !== "YES")
    throw new Error("refusing database mutation without V2_06_SEED_CONFIRM=YES");
  if (process.env.V2_06_AVATAR_RIGHTS_CONFIRM !== "YES")
    throw new Error("refusing rights attestation without V2_06_AVATAR_RIGHTS_CONFIRM=YES");
  const databaseUrl = process.env.V2_06_MIGRATION_DATABASE_URL;
  requireText(databaseUrl, "V2_06_MIGRATION_DATABASE_URL");

  const scopeRowsRaw = runPsql({
    databaseUrl,
    sql: PREFLIGHT_SCOPE_SQL,
    variables: { tenant_email: inputs.tenantEmail },
    label: "tenant scope preflight",
  });
  let scopeRows;
  try {
    scopeRows = JSON.parse(scopeRowsRaw || "[]");
  } catch {
    throw new Error("tenant scope preflight returned invalid JSON");
  }
  if (!Array.isArray(scopeRows) || scopeRows.length !== 1)
    throw new Error("tenant email must resolve to exactly one admitted hosted tenant");
  const scope = scopeRows[0];
  for (const [value, name] of [
    [scope.user_id, "resolved user_id"],
    [scope.account_id, "resolved account_id"],
    [scope.workspace_id, "resolved workspace_id"],
  ])
    requireUuid(value, name);
  if (
    scope.email !== inputs.tenantEmail ||
    scope.email_verified !== true ||
    scope.account_scope_kind !== "USER" ||
    scope.account_status !== "ACTIVE" ||
    scope.workspace_status !== "ACTIVE" ||
    scope.is_default !== true ||
    scope.membership_status !== "ACTIVE" ||
    scope.membership_role !== "ADMIN"
  ) {
    throw new Error("resolved hosted tenant is not one verified active default workspace owner");
  }

  const assetRowsRaw = runPsql({
    databaseUrl,
    sql: PREFLIGHT_ASSET_SQL,
    variables: {
      original_asset_id: inputs.originalAssetId,
      runtime_asset_id: inputs.runtimeAssetId,
      thumbnail_asset_id: inputs.thumbnailAssetId,
    },
    label: "avatar asset preflight",
  });
  let assets;
  try {
    assets = JSON.parse(assetRowsRaw || "[]");
  } catch {
    throw new Error("avatar asset preflight returned invalid JSON");
  }
  if (!Array.isArray(assets) || assets.length !== 3)
    throw new Error("avatar asset preflight did not return exactly three requested rows");
  for (const asset of assets) {
    requireUuid(asset.asset_id, `${asset.role} asset_id`);
    if (asset.account_id !== scope.account_id || asset.workspace_id !== scope.workspace_id)
      throw new Error(`${asset.role} asset is not owned by the resolved tenant workspace`);
  }
  const plan = buildPlan({
    scope,
    assets,
    avatarEnvelope: inputs.avatarEnvelope,
    stylePayload: inputs.stylePayload,
    seedAt: inputs.seedAt,
    rightsBasis: inputs.rightsBasis,
    avatarName: inputs.avatarName,
    styleName: inputs.styleName,
  });
  const result = runPsql({
    databaseUrl,
    sql: mutationSql(),
    variables: mutationVariables(plan),
    label: "tenant preset seed transaction",
    quiet: false,
  });
  console.log(result || "V2-06 tenant preset seed committed.");
}

export {
  APPROVED_NEON_DATABASE,
  APPROVED_NEON_HOST,
  APPROVED_NEON_MIGRATION_ROLE,
  AVATAR_PAYLOAD_KEYS,
  DEFAULT_AVATAR_PAYLOAD,
  DEFAULT_STYLE_PAYLOAD,
  MIGRATION_HEAD,
  MIGRATION_LEDGER_JSON_SQL_LITERAL,
  MIGRATION_MANIFEST_SHA256,
  buildPlan,
  canonicalJson,
  deterministicUuid,
  mutationSql,
  mutationVariables,
  parseArgs,
  requireUuid,
  sha256Canonical,
  validateAvatarEnvelope,
  validateStylePayload,
};

if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("seed-tenant-presets.mjs")
) {
  main().catch((error) => {
    console.error(
      `V2-06 tenant preset seed failed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    process.exitCode = 1;
  });
}

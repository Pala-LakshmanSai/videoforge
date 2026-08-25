#!/usr/bin/env node

/**
 * Provision the repository-authored V2-06 avatar fixture for one admitted tenant.
 *
 * This is deliberately a separate path from seed-tenant-presets.mjs.  It is a
 * default dry-run utility: only the three explicit confirmations below permit
 * live R2 and Neon mutations.  The only media source is the pinned SVG in
 * apps/web/public/fixtures/avatar and its asset_manifest.csv row.  No provider
 * generation, GPU, credential discovery, deletion, or overwrite is performed.
 *
 * Live confirmations:
 *   V2_06_OWNED_FIXTURE_CONFIRM=YES
 *   V2_06_OWNED_FIXTURE_R2_CONFIRM=YES
 *   V2_06_OWNED_FIXTURE_DATABASE_CONFIRM=YES
 *
 * Runtime credentials are supplied through environment variables (never CLI
 * arguments): V2_06_MIGRATION_DATABASE_URL, V2_06_R2_ACCOUNT_ID,
 * V2_06_R2_BUCKET, V2_06_R2_ACCESS_KEY_ID, V2_06_R2_SECRET_ACCESS_KEY.
 * R2 writes are exact PUTs followed by HEAD length/type/checksum verification.
 * Existing objects are accepted only when their immutable bytes match.
 */

import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_AVATAR_PAYLOAD,
  DEFAULT_STYLE_PAYLOAD,
  MIGRATION_HEAD,
  MIGRATION_LEDGER_JSON_SQL_LITERAL,
  buildPlan,
  canonicalJson,
  sha256Canonical,
  validateAvatarEnvelope,
  validateStylePayload,
} from "./seed-tenant-presets.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const requireFromWeb = createRequire(path.join(ROOT, "apps/web/package.json"));
const requireFromControlPlane = createRequire(
  path.join(ROOT, "packages/control-plane/package.json"),
);
const { AwsClient } = requireFromWeb("aws4fetch");
const SOURCE_RELATIVE = "apps/web/public/fixtures/avatar/amish-farm-host.svg";
const MANIFEST_RELATIVE = "project-context/evidence/asset_manifest.csv";
const SOURCE_PATH = path.join(ROOT, SOURCE_RELATIVE);
const MANIFEST_PATH = path.join(ROOT, MANIFEST_RELATIVE);
const EXPECTED_SOURCE_SHA256 = "e3b25f5244dc6d3db553b1926fab7bbffa6333b85201afd079f51cd1f0b64edd";
const EXPECTED_SOURCE_KIND = "repository_source_authored_svg";
const EXPECTED_RIGHTS = "owned_synthetic_fixture";
const EXPECTED_PURPOSE = "Reusable Avatar Hub thumbnail";
const ALLOWED_EMAILS = new Set(["lakshmansai121@gmail.com", "demo9gss@gmail.com"]);
const APPROVED_CLOUDFLARE_ACCOUNT_ID = "f9254d773a3426fcb469451b1f965d8c";
const APPROVED_R2_BUCKET = "videoforge-v2-06-staging-private";
const APPROVED_R2_REGION = "auto";
const APPROVED_NEON_PROJECT_NAME = "videoforge-v2-06-staging";
const APPROVED_NEON_HOST = "ep-sparkling-dew-azjhkwg6-pooler.c-3.ap-southeast-1.aws.neon.tech";
const APPROVED_NEON_DATABASE = "neondb";
const APPROVED_NEON_MIGRATION_ROLE = "neondb_owner";
const APPROVED_NEON_SSLMODE = "require";
const PINNED_FFMPEG_VERSION = "8.1.1";
const PINNED_FFPROBE_VERSION = "8.1.1";
const AVATAR_STORAGE_ROLE = Object.freeze({
  ORIGINAL: "original",
  RUNTIME: "canonical",
  THUMBNAIL: "thumbnail",
});
// PostgreSQL uuid accepts all canonical 128-bit UUID text, including values derived from
// md5(... )::uuid by the hosted admission trigger. Do not require RFC-4122 version/variant bits
// for database-owned IDs.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?Z$/u;
const ROLE_ORDER = ["ORIGINAL", "RUNTIME", "THUMBNAIL"];

function canonicalize(value) {
  return canonicalJson(value);
}

function hashBytes(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function activationAvatarIdentity(scope) {
  return Object.freeze({
    profileId: deterministicUuid(`videoforge:v2-06:${scope.account_id}:avatar:activation`),
    versionId: deterministicUuid(`videoforge:v2-06:${scope.account_id}:avatar:activation:v1`),
  });
}

function resolveExecutable(command) {
  const candidates = command.includes(path.sep)
    ? [command]
    : (process.env.PATH ?? "")
        .split(path.delimiter)
        .map((directory) => path.join(directory, command));
  for (const candidate of candidates) {
    try {
      const stat = statSync(candidate);
      if (!stat.isFile() || (stat.mode & 0o111) === 0) continue;
      return realpathSync(candidate);
    } catch {
      // Continue through PATH without exposing the host's paths in output.
    }
  }
  throw new Error(`${command} executable is unavailable`);
}

function pinnedToolIdentity(command, expectedVersion) {
  const executable = resolveExecutable(command);
  const versionOutput = runBinary(executable, ["-version"], `${command} version probe`);
  const match = versionOutput.match(new RegExp(`^${command} version ([^\\s]+)`, "mu"));
  if (!match || match[1] !== expectedVersion)
    throw new Error(`${command} must be exactly version ${expectedVersion}`);
  return Object.freeze({
    name: command,
    version: match[1],
    sha256: hashBytes(readFileSync(executable)),
    executable,
  });
}

function deterministicUuid(label) {
  const bytes = createHash("sha256").update(label, "utf8").digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function requireText(value, name) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("\u0000") ||
    value.includes("\r") ||
    value.includes("\n")
  )
    throw new Error(`${name} must be a non-empty single-line value`);
  return value;
}

function requireUuid(value, name) {
  requireText(value, name);
  if (!UUID.test(value)) throw new Error(`${name} must be a canonical UUID`);
  return value;
}

function requireTimestamp(value, name) {
  requireText(value, name);
  if (!TIMESTAMP.test(value) || Number.isNaN(Date.parse(value)))
    throw new Error(`${name} must be a valid RFC3339 UTC timestamp`);
  return value;
}

function parseArgs(argv) {
  const options = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") options.help = true;
    else if (token === "--dry-run") options.dryRun = true;
    else if (token.startsWith("--")) {
      const key = token.slice(2).replaceAll("-", "_");
      if (!key || index + 1 >= argv.length || argv[index + 1].startsWith("--"))
        throw new Error(`missing value for ${token}`);
      options[key] = argv[++index];
    } else options._.push(token);
  }
  if (options._.length > 0) throw new Error(`unexpected argument ${options._[0]}`);
  return options;
}

function envOr(options, key, envName, fallback = undefined) {
  return options[key] ?? process.env[envName] ?? fallback;
}

function parseManifestRow(source) {
  const lines = source
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2 || lines[0] !== "path,sha256,origin,rights_status,purpose")
    throw new Error("asset manifest header is not the pinned V2-06 shape");
  const row = lines.slice(1).find((line) => line.startsWith(`../${SOURCE_RELATIVE},`));
  if (!row) throw new Error("pinned avatar fixture is absent from asset_manifest.csv");
  const fields = row.split(",");
  if (fields.length < 5) throw new Error("pinned avatar manifest row is malformed");
  const [relativePath, sha256, sourceKind, rightsBasis, purpose] = fields;
  if (
    relativePath !== `../${SOURCE_RELATIVE}` ||
    sha256 !== EXPECTED_SOURCE_SHA256 ||
    sourceKind !== EXPECTED_SOURCE_KIND ||
    rightsBasis !== EXPECTED_RIGHTS ||
    purpose !== EXPECTED_PURPOSE
  ) {
    throw new Error("pinned avatar manifest provenance or checksum drifted");
  }
  return Object.freeze({ relativePath, sha256, sourceKind, rightsBasis, purpose });
}

async function readPinnedSource() {
  const stat = lstatSync(SOURCE_PATH);
  if (!stat.isFile()) throw new Error("pinned avatar fixture must be a regular file");
  const manifest = parseManifestRow(await readFile(MANIFEST_PATH, "utf8"));
  const sourceBytes = await readFile(SOURCE_PATH);
  if (hashBytes(sourceBytes).slice("sha256:".length) !== manifest.sha256)
    throw new Error("pinned avatar fixture bytes do not match asset_manifest.csv");
  return Object.freeze({ manifest, sourceBytes });
}

function loadSharp() {
  try {
    return requireFromWeb("sharp");
  } catch {
    // sharp is installed transitively in the repository workspace. Resolve the
    // package without adding a dependency or downloading another renderer.
    return readdir(ROOT + "/node_modules/.pnpm")
      .then((entries) => entries.find((entry) => /^sharp@/u.test(entry)))
      .then((entry) => {
        if (!entry) throw new Error("installed sharp rasterizer is unavailable");
        return requireFromWeb(path.join(ROOT, "node_modules/.pnpm", entry, "node_modules/sharp"));
      });
  }
}

function stripPngMetadata(bytes) {
  const source = Buffer.from(bytes);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!source.subarray(0, 8).equals(signature)) throw new Error("rasterizer did not return PNG");
  const chunks = [signature];
  let offset = 8;
  const seen = [];
  while (offset < source.length) {
    if (offset + 12 > source.length) throw new Error("PNG chunk is truncated");
    const length = source.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > source.length) throw new Error("PNG chunk exceeds file length");
    const type = source.toString("ascii", offset + 4, offset + 8);
    seen.push(type);
    if (["IHDR", "IDAT", "IEND"].includes(type)) chunks.push(source.subarray(offset, end));
    offset = end;
  }
  if (offset !== source.length || seen[0] !== "IHDR" || seen.at(-1) !== "IEND")
    throw new Error("PNG structure is invalid");
  return Buffer.concat(chunks);
}

function pngDimensions(bytes) {
  const value = Buffer.from(bytes);
  if (value.length < 33 || value.toString("ascii", 12, 16) !== "IHDR")
    throw new Error("PNG IHDR is missing");
  return { width: value.readUInt32BE(16), height: value.readUInt32BE(20) };
}

function runBinary(command, args, label) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
  if (result.error || result.status !== 0)
    throw new Error(`${label} failed; output intentionally suppressed`);
  return result.stdout;
}

async function rasterizeOwnedFixture() {
  const { manifest } = await readPinnedSource();
  const sharp = await loadSharp();
  const temporary = await mkdtemp("/tmp/videoforge-v2-06-owned-fixture-");
  try {
    const original = stripPngMetadata(
      await sharp(SOURCE_PATH)
        .resize(1536, 1536, {
          fit: "contain",
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png({ compressionLevel: 9, adaptiveFiltering: false })
        .toBuffer(),
    );
    const thumbnail = stripPngMetadata(
      await sharp(SOURCE_PATH)
        .resize(512, 512, {
          fit: "contain",
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png({ compressionLevel: 9, adaptiveFiltering: false })
        .toBuffer(),
    );
    const runtimeFrame = stripPngMetadata(
      await sharp(SOURCE_PATH)
        .resize(832, 480, {
          fit: "contain",
          background: { r: 0, g: 0, b: 0, alpha: 1 },
        })
        .png({ compressionLevel: 9, adaptiveFiltering: false })
        .toBuffer(),
    );
    const framePath = path.join(temporary, "runtime-frame.png");
    const runtimePath = path.join(temporary, "runtime.mp4");
    const ffmpeg = pinnedToolIdentity("ffmpeg", PINNED_FFMPEG_VERSION);
    const ffprobe = pinnedToolIdentity("ffprobe", PINNED_FFPROBE_VERSION);
    await writeFile(framePath, runtimeFrame, { mode: 0o600 });
    runBinary(
      ffmpeg.executable,
      [
        "-v",
        "error",
        "-y",
        "-loop",
        "1",
        "-i",
        framePath,
        "-t",
        "1",
        "-r",
        "25",
        "-vf",
        "format=yuv420p",
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        "-map_metadata",
        "-1",
        "-metadata:s:v",
        "encoder=",
        "-metadata:s:v",
        "handler_name=",
        "-metadata",
        "encoder=",
        "-fflags",
        "+bitexact",
        "-flags:v",
        "+bitexact",
        "-video_track_timescale",
        "25",
        "-g",
        "25",
        "-keyint_min",
        "25",
        "-sc_threshold",
        "0",
        "-bf",
        "0",
        "-threads",
        "1",
        runtimePath,
      ],
      "ffmpeg runtime fixture rasterization",
    );
    const probe = JSON.parse(
      runBinary(
        ffprobe.executable,
        [
          "-v",
          "error",
          "-show_entries",
          "format=format_name,duration:format_tags:stream=codec_name,width,height,pix_fmt,nb_frames,duration:stream_tags",
          "-of",
          "json",
          runtimePath,
        ],
        "ffprobe runtime fixture validation",
      ),
    );
    const runtime = await readFile(runtimePath);
    const originalDimensions = pngDimensions(original);
    const thumbnailDimensions = pngDimensions(thumbnail);
    const frameDimensions = pngDimensions(runtimeFrame);
    if (
      originalDimensions.width !== 1536 ||
      originalDimensions.height !== 1536 ||
      thumbnailDimensions.width !== 512 ||
      thumbnailDimensions.height !== 512 ||
      frameDimensions.width !== 832 ||
      frameDimensions.height !== 480
    )
      throw new Error("owned fixture raster dimensions drifted");
    const stream = probe.streams?.[0];
    if (
      probe.streams?.length !== 1 ||
      typeof probe.format?.format_name !== "string" ||
      !probe.format.format_name.split(",").includes("mp4") ||
      stream?.codec_name !== "h264" ||
      stream.width !== 832 ||
      stream.height !== 480 ||
      stream.pix_fmt !== "yuv420p" ||
      Number(stream.nb_frames) !== 25 ||
      !Number.isFinite(Number(probe.format.duration)) ||
      !Number.isFinite(Number(stream.duration)) ||
      Math.abs(Number(probe.format.duration) - 1) > 1e-9 ||
      Math.abs(Number(stream.duration) - 1) > 1e-9
    )
      throw new Error("owned fixture runtime video probe is not exact");
    const tags = { ...(probe.format?.tags ?? {}), ...(stream.tags ?? {}) };
    for (const key of Object.keys(tags)) {
      if (
        !["major_brand", "minor_version", "compatible_brands", "language", "handler_name"].includes(
          key,
        )
      )
        throw new Error("owned fixture runtime contains non-structural metadata");
    }
    const files = {
      ORIGINAL: Object.freeze({
        kind: "AVATAR_ORIGINAL",
        contentType: "image/png",
        bytes: original,
        width: originalDimensions.width,
        height: originalDimensions.height,
        durationMs: null,
        extension: "png",
      }),
      RUNTIME: Object.freeze({
        kind: "AVATAR_RUNTIME",
        contentType: "video/mp4",
        bytes: runtime,
        width: stream.width,
        height: stream.height,
        durationMs: 1000,
        extension: "mp4",
        runtimeFrameSha256: hashBytes(runtimeFrame),
        toolchain: Object.freeze({
          ffmpeg_version: ffmpeg.version,
          ffmpeg_sha256: ffmpeg.sha256,
          ffprobe_version: ffprobe.version,
          ffprobe_sha256: ffprobe.sha256,
        }),
      }),
      THUMBNAIL: Object.freeze({
        kind: "AVATAR_THUMBNAIL",
        contentType: "image/png",
        bytes: thumbnail,
        width: thumbnailDimensions.width,
        height: thumbnailDimensions.height,
        durationMs: null,
        extension: "png",
      }),
    };
    return Object.freeze({ manifest, files });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

function buildAssets({ scope, files, sourceManifest }) {
  const assets = {};
  const avatar = activationAvatarIdentity(scope);
  for (const role of ROLE_ORDER) {
    const file = files[role];
    const assetId = deterministicUuid(`videoforge:v2-06:owned-fixture:${scope.account_id}:${role}`);
    const storageRole = AVATAR_STORAGE_ROLE[role];
    const objectKey =
      `tenant/${scope.account_id}/workspace/${scope.workspace_id}/avatar-profile/${avatar.profileId}` +
      `/version/${avatar.versionId}/${storageRole}/${storageRole}.${file.extension}`;
    assets[role] = Object.freeze({
      role,
      assetId,
      avatarProfileId: avatar.profileId,
      avatarVersionId: avatar.versionId,
      storageRole,
      objectKey,
      kind: file.kind,
      state: "VERIFIED",
      contentType: file.contentType,
      contentLength: file.bytes.byteLength,
      width: file.width,
      height: file.height,
      durationMs: file.durationMs,
      checksumSha256: hashBytes(file.bytes),
      bytes: file.bytes,
      metadata: {
        schema_version: "videoforge-owned-synthetic-fixture/v1",
        fixture_non_production: true,
        staging_label: "V2-06 owned staging fixture",
        rights_basis: "OWNED",
        compatibility_state: "UNTESTED",
        source_path: SOURCE_RELATIVE,
        source_manifest_path: MANIFEST_RELATIVE,
        source_manifest_sha256: sourceManifest.sha256,
        source_provenance: sourceManifest.rightsBasis,
        source_sha256: `sha256:${sourceManifest.sha256}`,
        source_kind: sourceManifest.sourceKind,
        source_purpose: sourceManifest.purpose,
        avatar_profile_id: avatar.profileId,
        avatar_profile_version_id: avatar.versionId,
        avatar_storage_role: storageRole,
        derived_runtime_frame_sha256: file.runtimeFrameSha256 ?? null,
        toolchain: file.toolchain ?? null,
        no_metadata: true,
      },
    });
  }
  return Object.freeze(assets);
}

function parseJsonb(value) {
  if (typeof value === "string") return JSON.parse(value);
  return value;
}

function sameTime(actual, expected) {
  return (
    actual != null &&
    Number.isFinite(Date.parse(String(actual))) &&
    Date.parse(String(actual)) === Date.parse(expected)
  );
}

function exactRecord(actual, expected, label) {
  if (canonicalize(actual) !== canonicalize(expected))
    throw new Error(`${label} does not exactly match`);
}

async function resolveScope(pool, email) {
  const result = await pool.query(
    `SELECT auth.id AS hosted_auth_user_id, link.user_id::text AS user_id,
            link.admitted_account_id::text AS account_id, link.workspace_id::text AS workspace_id,
            auth.email, auth.email_verified, account.scope_kind AS account_scope_kind,
            account.status AS account_status, workspace.status AS workspace_status,
            workspace.is_default, membership.status AS membership_status,
            membership.role AS membership_role
       FROM hosted_auth_users AS auth
       JOIN hosted_auth_links AS link ON link.hosted_auth_user_id = auth.id
       JOIN accounts AS account ON account.id = link.admitted_account_id
       JOIN workspaces AS workspace ON workspace.account_id = link.admitted_account_id
                                  AND workspace.id = link.workspace_id
       JOIN memberships AS membership ON membership.account_id = link.admitted_account_id
                                    AND membership.workspace_id = link.workspace_id
                                    AND membership.user_id = link.user_id
      WHERE auth.email = $1`,
    [email],
  );
  if (result.rows.length !== 1)
    throw new Error("tenant email must resolve to exactly one admitted identity");
  const scope = result.rows[0];
  if (
    scope.email !== email ||
    scope.email_verified !== true ||
    scope.account_scope_kind !== "USER" ||
    scope.account_status !== "ACTIVE" ||
    scope.workspace_status !== "ACTIVE" ||
    scope.is_default !== true ||
    scope.membership_status !== "ACTIVE" ||
    scope.membership_role !== "ADMIN"
  )
    throw new Error("tenant identity is not one verified active default workspace owner");
  for (const name of ["user_id", "account_id", "workspace_id"]) requireUuid(scope[name], name);
  return Object.freeze({
    user_id: scope.user_id,
    account_id: scope.account_id,
    workspace_id: scope.workspace_id,
    email,
  });
}

function assertMigrationUrl(databaseUrl) {
  const url = new URL(requireText(databaseUrl, "V2_06_MIGRATION_DATABASE_URL"));
  if (!["postgres:", "postgresql:"].includes(url.protocol))
    throw new Error("V2_06_MIGRATION_DATABASE_URL must use postgres:// or postgresql://");
  if (url.hostname !== APPROVED_NEON_HOST)
    throw new Error(
      `V2_06_MIGRATION_DATABASE_URL must target the approved ${APPROVED_NEON_PROJECT_NAME} Neon endpoint`,
    );
  if (decodeURIComponent(url.pathname.replace(/^\//u, "")) !== APPROVED_NEON_DATABASE)
    throw new Error("V2_06_MIGRATION_DATABASE_URL must target the approved Neon database");
  if (decodeURIComponent(url.username) !== APPROVED_NEON_MIGRATION_ROLE)
    throw new Error("owned fixture provisioner requires the approved migration owner role");
  if (url.searchParams.get("sslmode") !== "require")
    throw new Error("V2_06_MIGRATION_DATABASE_URL must require TLS");
  if (url.searchParams.get("channel_binding") !== "require")
    throw new Error("V2_06_MIGRATION_DATABASE_URL must require channel binding");
}

async function ensureAssets(client, scope, assets, seedAt) {
  await client.query("SELECT set_config($1, $2, true)", [
    "videoforge.account_id",
    scope.account_id,
  ]);
  for (const role of ROLE_ORDER) {
    const asset = assets[role];
    await client.query(
      `INSERT INTO assets (
         id, workspace_id, project_id, project_revision_id, kind, state, object_key,
         binary_sha256, content_type, byte_size, width_px, height_px, duration_ms,
         metadata, created_at, verified_at
       ) VALUES ($1,$2,NULL,NULL,$3,'VERIFIED',$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$12)
       ON CONFLICT (id) DO NOTHING`,
      [
        asset.assetId,
        scope.workspace_id,
        asset.kind,
        asset.objectKey,
        asset.checksumSha256,
        asset.contentType,
        asset.contentLength,
        asset.width,
        asset.height,
        asset.durationMs,
        JSON.stringify(asset.metadata),
        seedAt,
      ],
    );
    const found = await client.query(
      `SELECT id::text AS id, account_id::text AS account_id, workspace_id::text AS workspace_id,
              kind, state, object_key, binary_sha256, content_type, byte_size::text AS byte_size,
              width_px, height_px, duration_ms::text AS duration_ms, metadata, verified_at
         FROM assets WHERE id = $1`,
      [asset.assetId],
    );
    const row = found.rows[0];
    if (!row) throw new Error(`${role} asset was not persisted`);
    if (
      row.account_id !== scope.account_id ||
      row.workspace_id !== scope.workspace_id ||
      row.kind !== asset.kind ||
      row.state !== "VERIFIED" ||
      row.object_key !== asset.objectKey ||
      row.binary_sha256 !== asset.checksumSha256 ||
      row.content_type !== asset.contentType ||
      Number(row.byte_size) !== asset.contentLength ||
      Number(row.width_px) !== asset.width ||
      Number(row.height_px) !== asset.height ||
      (asset.durationMs == null
        ? row.duration_ms !== null
        : Number(row.duration_ms) !== asset.durationMs)
    )
      throw new Error(`${role} asset is not an exact tenant-owned VERIFIED match`);
    exactRecord(parseJsonb(row.metadata), asset.metadata, `${role} asset metadata`);
    if (!sameTime(row.verified_at, seedAt))
      throw new Error(`${role} asset verified_at is not exact`);
  }
}

async function ensurePresetRows(client, scope, assets, seedAt) {
  const avatarEnvelope = validateAvatarEnvelope(
    JSON.parse(await readFile(DEFAULT_AVATAR_PAYLOAD, "utf8")),
  );
  const stylePayload = validateStylePayload(
    JSON.parse(await readFile(DEFAULT_STYLE_PAYLOAD, "utf8")),
  );
  const plan = buildPlan({
    scope,
    assets: ROLE_ORDER.map((role) => {
      const asset = assets[role];
      return {
        role,
        asset_id: asset.assetId,
        account_id: scope.account_id,
        workspace_id: scope.workspace_id,
        kind: asset.kind,
        state: asset.state,
        binary_sha256: asset.checksumSha256,
        content_type: asset.contentType,
        byte_size: asset.contentLength,
        width_px: asset.width,
        height_px: asset.height,
      };
    }),
    avatarEnvelope,
    stylePayload,
    seedAt,
    rightsBasis: "OWNED",
    avatarName: "Activation Presenter",
    styleName: "Authentic Documentary Stock",
  });
  await client.query(
    `DO $$ BEGIN
       IF (SELECT max(version) FROM videoforge_schema_migrations) IS DISTINCT FROM ${MIGRATION_HEAD}
       THEN RAISE EXCEPTION 'owned fixture requires committed manifest head ${MIGRATION_HEAD}'; END IF;
       IF (
         SELECT jsonb_agg(
           jsonb_build_object(
             'version', version,
             'name', name,
             'filename', filename,
             'sha256', sha256
           ) ORDER BY version
         )
           FROM videoforge_schema_migrations
       ) IS DISTINCT FROM ${MIGRATION_LEDGER_JSON_SQL_LITERAL}
       THEN RAISE EXCEPTION 'owned fixture requires the exact committed migration ledger'; END IF;
     END $$`,
  );
  await client.query(
    `INSERT INTO avatar_profiles (
       id, account_id, workspace_id, name, normalized_name, status, active_version_id,
       thumbnail_asset_id, created_by_user_id, created_at, updated_at
     ) VALUES ($1,$2,$3,$4,lower($4),'ACTIVE',NULL,$5,$6,$7,$7)
     ON CONFLICT (id) DO NOTHING`,
    [
      plan.avatarProfileId,
      scope.account_id,
      scope.workspace_id,
      plan.avatarName,
      assets.THUMBNAIL.assetId,
      scope.user_id,
      seedAt,
    ],
  );
  await client.query(
    `INSERT INTO avatar_profile_versions (
       id, account_id, workspace_id, profile_id, version_number, state,
       profile_contract_name, profile_contract_version, profile_payload, profile_hash,
       original_asset_id, runtime_source_asset_id, runtime_source_binary_sha256,
       source_preparation_profile, source_validation_profile, rights_attested_by_user_id,
       likeness_attested_by_user_id, created_at, updated_at, ready_at
     ) VALUES ($1,$2,$3,$4,1,'READY','avatar-profile-version','v1',$5::jsonb,$6,$7,$8,$9,
               'avatar-source-prep-v1','avatar-source-validation-v1',$10,$10,$11,$11,$11)
     ON CONFLICT (id) DO NOTHING`,
    [
      plan.avatarVersionId,
      scope.account_id,
      scope.workspace_id,
      plan.avatarProfileId,
      JSON.stringify(plan.avatarPayload),
      plan.avatarProfileHash,
      assets.ORIGINAL.assetId,
      assets.RUNTIME.assetId,
      assets.RUNTIME.checksumSha256,
      scope.user_id,
      seedAt,
    ],
  );
  await client.query(
    `INSERT INTO avatar_profile_assets (
       id, account_id, workspace_id, profile_id, version_id, asset_id, role,
       binary_sha256, retention_state, created_at
     ) VALUES
       ($1,$2,$3,$4,$5,$6,'ORIGINAL',$7,'RETAIN',$8),
       ($9,$2,$3,$4,$5,$10,'RUNTIME',$11,'RETAIN',$8),
       ($12,$2,$3,$4,$5,$13,'THUMBNAIL',$14,'RETAIN',$8)
     ON CONFLICT (id) DO NOTHING`,
    [
      plan.avatarAssetLinkIds.ORIGINAL,
      scope.account_id,
      scope.workspace_id,
      plan.avatarProfileId,
      plan.avatarVersionId,
      assets.ORIGINAL.assetId,
      assets.ORIGINAL.checksumSha256,
      seedAt,
      plan.avatarAssetLinkIds.RUNTIME,
      assets.RUNTIME.assetId,
      assets.RUNTIME.checksumSha256,
      plan.avatarAssetLinkIds.THUMBNAIL,
      assets.THUMBNAIL.assetId,
      assets.THUMBNAIL.checksumSha256,
    ],
  );
  await client.query(
    `UPDATE avatar_profiles SET active_version_id = $1, updated_at = $2
      WHERE id = $3 AND active_version_id IS NULL`,
    [plan.avatarVersionId, seedAt, plan.avatarProfileId],
  );
  await client.query(
    `INSERT INTO image_styles (
       id, account_id, workspace_id, name, normalized_name, status, active_version_id,
       created_by_user_id, created_at, updated_at
     ) VALUES ($1,$2,$3,$4,lower($4),'ACTIVE',NULL,$5,$6,$6)
     ON CONFLICT (id) DO NOTHING`,
    [plan.styleId, scope.account_id, scope.workspace_id, plan.styleName, scope.user_id, seedAt],
  );
  await client.query(
    `INSERT INTO image_style_versions (
       id, account_id, workspace_id, style_id, version_number, state,
       profile_contract_name, profile_contract_version, profile_payload, style_profile_hash,
       disclosure_attested_by_user_id, created_at, updated_at, published_at
     ) VALUES ($1,$2,$3,$4,1,'PUBLISHED','image-style-profile','v1',$5::jsonb,$6,$7,$8,$8,$8)
     ON CONFLICT (id) DO NOTHING`,
    [
      plan.styleVersionId,
      scope.account_id,
      scope.workspace_id,
      plan.styleId,
      JSON.stringify(plan.stylePayload),
      plan.styleProfileHash,
      scope.user_id,
      seedAt,
    ],
  );
  await client.query(
    `UPDATE image_styles SET active_version_id = $1, updated_at = $2
      WHERE id = $3 AND active_version_id IS NULL`,
    [plan.styleVersionId, seedAt, plan.styleId],
  );
  const avatar = await client.query(
    `SELECT profile.account_id::text AS account_id, profile.workspace_id::text AS workspace_id,
            profile.name, profile.status, profile.active_version_id::text AS active_version_id,
            profile.thumbnail_asset_id::text AS thumbnail_asset_id,
            version.state, version.profile_hash, version.profile_payload,
            version.ready_at, version.original_asset_id::text AS original_asset_id,
            version.runtime_source_asset_id::text AS runtime_source_asset_id,
            version.runtime_source_binary_sha256
       FROM avatar_profiles AS profile
       JOIN avatar_profile_versions AS version ON version.id = profile.active_version_id
      WHERE profile.id = $1`,
    [plan.avatarProfileId],
  );
  const avatarRow = avatar.rows[0];
  if (
    !avatarRow ||
    avatarRow.account_id !== scope.account_id ||
    avatarRow.workspace_id !== scope.workspace_id ||
    avatarRow.name !== plan.avatarName ||
    avatarRow.status !== "ACTIVE" ||
    avatarRow.active_version_id !== plan.avatarVersionId ||
    avatarRow.thumbnail_asset_id !== assets.THUMBNAIL.assetId ||
    avatarRow.state !== "READY" ||
    avatarRow.profile_hash !== plan.avatarProfileHash ||
    avatarRow.original_asset_id !== assets.ORIGINAL.assetId ||
    avatarRow.runtime_source_asset_id !== assets.RUNTIME.assetId ||
    avatarRow.runtime_source_binary_sha256 !== assets.RUNTIME.checksumSha256 ||
    !sameTime(avatarRow.ready_at, seedAt)
  )
    throw new Error("existing deterministic avatar READY rows are not an exact match");
  exactRecord(parseJsonb(avatarRow.profile_payload), plan.avatarPayload, "avatar profile payload");
  const links = await client.query(
    `SELECT id::text AS id, asset_id::text AS asset_id, role, binary_sha256,
            retention_state, deleted_at
       FROM avatar_profile_assets
      WHERE profile_id = $1 AND version_id = $2
      ORDER BY role`,
    [plan.avatarProfileId, plan.avatarVersionId],
  );
  const expectedLinks = ROLE_ORDER.map((role) => ({
    id: plan.avatarAssetLinkIds[role],
    asset_id: assets[role].assetId,
    role,
    binary_sha256: assets[role].checksumSha256,
    retention_state: "RETAIN",
    deleted_at: null,
  }));
  if (links.rows.length !== expectedLinks.length)
    throw new Error("avatar profile asset links are incomplete");
  for (let index = 0; index < expectedLinks.length; index += 1)
    exactRecord(links.rows[index], expectedLinks[index], "avatar profile asset link");
  const style = await client.query(
    `SELECT style.account_id::text AS account_id, style.workspace_id::text AS workspace_id,
            style.name, style.status, style.active_version_id::text AS active_version_id,
            version.state, version.style_profile_hash, version.profile_payload,
            version.published_at
       FROM image_styles AS style
       JOIN image_style_versions AS version ON version.id = style.active_version_id
      WHERE style.id = $1`,
    [plan.styleId],
  );
  const styleRow = style.rows[0];
  if (
    !styleRow ||
    styleRow.account_id !== scope.account_id ||
    styleRow.workspace_id !== scope.workspace_id ||
    styleRow.name !== plan.styleName ||
    styleRow.status !== "ACTIVE" ||
    styleRow.active_version_id !== plan.styleVersionId ||
    styleRow.state !== "PUBLISHED" ||
    styleRow.style_profile_hash !== plan.styleProfileHash ||
    !sameTime(styleRow.published_at, seedAt)
  )
    throw new Error("existing deterministic style PUBLISHED rows are not an exact match");
  exactRecord(parseJsonb(styleRow.profile_payload), plan.stylePayload, "style profile payload");
  return plan;
}

async function ensureAuditRow(client, scope, assets, plan, seedAt, sourceManifest, inventory) {
  const resultPayload = {
    schema_version: "videoforge-owned-fixture-provision-result/v1",
    fixture_non_production: true,
    staging_label: "V2-06 owned staging fixture",
    tenant_email: scope.email,
    account_id: scope.account_id,
    workspace_id: scope.workspace_id,
    source_path: SOURCE_RELATIVE,
    source_manifest_path: MANIFEST_RELATIVE,
    source_manifest_sha256: sourceManifest.sha256,
    assets: Object.fromEntries(
      ROLE_ORDER.map((role) => [
        role,
        {
          asset_id: assets[role].assetId,
          object_key: assets[role].objectKey,
          checksum_sha256: assets[role].checksumSha256,
          content_type: assets[role].contentType,
          content_length: assets[role].contentLength,
          width: assets[role].width,
          height: assets[role].height,
          compatibility_state: "UNTESTED",
        },
      ]),
    ),
    presets: {
      avatar_profile_id: plan.avatarProfileId,
      avatar_profile_version_id: plan.avatarVersionId,
      avatar_profile_hash: plan.avatarProfileHash,
      image_style_id: plan.styleId,
      image_style_version_id: plan.styleVersionId,
      style_profile_hash: plan.styleProfileHash,
    },
    orphan_inventory: inventory,
    seed_at: seedAt,
  };
  const inputPayload = {
    schema_version: "videoforge-owned-fixture-provision-input/v1",
    source_manifest_sha256: sourceManifest.sha256,
    source_sha256: `sha256:${EXPECTED_SOURCE_SHA256}`,
    account_id: scope.account_id,
    workspace_id: scope.workspace_id,
    assets: ROLE_ORDER.map((role) => [role, assets[role].checksumSha256]),
    object_keys: ROLE_ORDER.map((role) => [role, assets[role].objectKey]),
    preset_hashes: [plan.avatarProfileHash, plan.styleProfileHash],
    seed_at: seedAt,
  };
  const inputHash = sha256Canonical(inputPayload);
  const resultHash = sha256Canonical(resultPayload);
  const idempotencyKey = `v2-06-owned-fixture-${scope.account_id}`;
  await client.query(
    `INSERT INTO repository_mutation_receipts (
       workspace_id, idempotency_key, operation, input_hash, result_codec,
       result_payload, result_hash, created_at
     ) VALUES ($1,$2,'v2_06_owned_fixture_provision',$3,'repository-result/v1',$4::jsonb,$5,$6)
     ON CONFLICT (workspace_id,idempotency_key) DO NOTHING`,
    [
      scope.workspace_id,
      idempotencyKey,
      inputHash,
      JSON.stringify(resultPayload),
      resultHash,
      seedAt,
    ],
  );
  const found = await client.query(
    `SELECT workspace_id::text AS workspace_id, idempotency_key, operation, input_hash,
            result_codec, result_payload, result_hash, created_at
       FROM repository_mutation_receipts WHERE workspace_id = $1 AND idempotency_key = $2`,
    [scope.workspace_id, idempotencyKey],
  );
  const row = found.rows[0];
  if (
    !row ||
    row.workspace_id !== scope.workspace_id ||
    row.operation !== "v2_06_owned_fixture_provision" ||
    row.input_hash !== inputHash ||
    row.result_codec !== "repository-result/v1" ||
    row.result_hash !== resultHash ||
    !sameTime(row.created_at, seedAt)
  )
    throw new Error("owned fixture mutation receipt is not an exact idempotent match");
  exactRecord(
    parseJsonb(row.result_payload),
    resultPayload,
    "owned fixture mutation receipt payload",
  );
  return Object.freeze({ idempotencyKey, inputHash, resultHash, resultPayload });
}

function base64Sha256(digest) {
  return Buffer.from(digest.slice("sha256:".length), "hex").toString("base64");
}

function assertR2Config(config) {
  if (
    config.accountId !== APPROVED_CLOUDFLARE_ACCOUNT_ID ||
    config.bucket !== APPROVED_R2_BUCKET ||
    config.region !== APPROVED_R2_REGION
  )
    throw new Error("R2 configuration is not the approved V2-06 private staging resource");
}

function r2ObjectUrl(accountId, bucket, objectKey) {
  if (accountId !== APPROVED_CLOUDFLARE_ACCOUNT_ID || bucket !== APPROVED_R2_BUCKET)
    throw new Error("R2 object URL is outside the approved V2-06 private staging resource");
  return `https://${accountId}.r2.cloudflarestorage.com/${encodeURIComponent(bucket)}/${objectKey
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

async function r2Request(client, url, method, headers = {}, body = undefined) {
  const signed = await client.sign(url, {
    method,
    headers,
    body,
    aws: { signQuery: false, allHeaders: true },
  });
  return fetch(signed);
}

function buildOrphanInventory(scope, assets) {
  return Object.freeze({
    schema_version: "videoforge-owned-fixture-orphan-inventory/v1",
    account_id: scope.account_id,
    workspace_id: scope.workspace_id,
    scope: "expected_avatar_profile_keys_only",
    automatic_delete: false,
    entries: Object.freeze(
      ROLE_ORDER.map((role) =>
        Object.freeze({
          role,
          object_key: assets[role].objectKey,
          asset_id: assets[role].assetId,
          checksum_sha256: assets[role].checksumSha256,
          state: "DB_BOUND_EXACT_OBJECT",
        }),
      ),
    ),
  });
}

async function verifyR2Object(client, url, asset) {
  const head = await r2Request(client, url, "HEAD");
  if (!head.ok) throw new Error(`R2 HEAD failed for ${asset.role} (${head.status})`);
  const length = Number(head.headers.get("content-length"));
  const contentType = head.headers.get("content-type")?.split(";", 1)[0];
  if (length !== asset.contentLength || contentType !== asset.contentType)
    throw new Error(`R2 HEAD metadata mismatch for ${asset.role}`);
  const checksumHeader = head.headers.get("x-amz-checksum-sha256");
  if (checksumHeader && checksumHeader !== base64Sha256(asset.checksumSha256))
    throw new Error(`R2 HEAD SHA-256 mismatch for ${asset.role}`);
  if (!checksumHeader) {
    const get = await r2Request(client, url, "GET");
    if (!get.ok) throw new Error(`R2 checksum read failed for ${asset.role} (${get.status})`);
    const bytes = Buffer.from(await get.arrayBuffer());
    if (hashBytes(bytes) !== asset.checksumSha256)
      throw new Error(`R2 GET SHA-256 mismatch for ${asset.role}`);
  }
}

async function ensureR2Objects(config, assets, scope) {
  assertR2Config(config);
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: "s3",
    region: config.region,
    retries: 0,
  });
  for (const role of ROLE_ORDER) {
    const asset = assets[role];
    const url = r2ObjectUrl(config.accountId, config.bucket, asset.objectKey);
    const head = await r2Request(client, url, "HEAD");
    if (head.status === 404) {
      const put = await r2Request(
        client,
        url,
        "PUT",
        {
          "content-length": String(asset.contentLength),
          "content-type": asset.contentType,
          "x-amz-checksum-sha256": base64Sha256(asset.checksumSha256),
        },
        asset.bytes,
      );
      if (!put.ok) throw new Error(`R2 PUT failed for ${role} (${put.status})`);
    } else if (!head.ok) {
      throw new Error(`R2 preflight HEAD failed for ${role} (${head.status})`);
    }
    await verifyR2Object(client, url, asset);
  }
  return buildOrphanInventory(scope, assets);
}

async function ensureWranglerR2Objects(assets, scope) {
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "videoforge-v2-06-owned-r2-"));
  const readbackOrigin = process.env.V2_06_OWNED_FIXTURE_R2_READBACK_ORIGIN;
  if (readbackOrigin !== "http://localhost:8791")
    throw new Error("owned fixture Wrangler mode requires the exact local read-only preview");
  const run = (args) =>
    spawnSync("pnpm", ["--filter", "@videoforge/web", "exec", "wrangler", ...args], {
      cwd: ROOT,
      encoding: "utf8",
    });
  try {
    for (const role of ROLE_ORDER) {
      const asset = assets[role];
      const upload = path.join(temporaryDirectory, `${role.toLowerCase()}-upload`);
      const objectPath = `${APPROVED_R2_BUCKET}/${asset.objectKey}`;
      const verifyReadback = async () => {
        const response = await fetch(
          `${readbackOrigin}/object?key=${encodeURIComponent(asset.objectKey)}`,
          { headers: { accept: "application/json" } },
        );
        if (response.status === 404) return false;
        if (!response.ok) throw new Error(`read-only R2 verification failed for ${role}`);
        const result = await response.json();
        if (
          result.checksum_sha256 !== asset.checksumSha256 ||
          result.size_bytes !== asset.contentLength ||
          result.content_type !== asset.contentType ||
          result.write_operations !== 0
        )
          throw new Error(`read-only R2 object ${role} differs from exact fixture bytes/type`);
        return true;
      };
      if (await verifyReadback()) {
        continue;
      }
      await writeFile(upload, asset.bytes, { mode: 0o600, flag: "wx" });
      const created = run([
        "r2",
        "object",
        "put",
        "--remote",
        "--file",
        upload,
        "--content-type",
        asset.contentType,
        "--force",
        objectPath,
      ]);
      if (created.status !== 0) throw new Error(`Wrangler R2 upload failed for ${role}`);
      if (!(await verifyReadback())) throw new Error(`Wrangler R2 verification failed for ${role}`);
    }
    return buildOrphanInventory(scope, assets);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

function printHelp() {
  console.log(`V2-06 owned synthetic avatar fixture provisioner

Default behavior is dry-run and provider/database free. Live mutation requires all three:
  V2_06_OWNED_FIXTURE_CONFIRM=YES
  V2_06_OWNED_FIXTURE_R2_CONFIRM=YES
  V2_06_OWNED_FIXTURE_DATABASE_CONFIRM=YES

Required environment for live mutation:
  V2_06_OWNED_FIXTURE_EMAIL       exactly lakshmansai121@gmail.com or demo9gss@gmail.com
  V2_06_OWNED_FIXTURE_SEED_AT     fixed RFC3339 UTC timestamp
  V2_06_MIGRATION_DATABASE_URL     migration-owner Neon URL, never hosted runtime role
  V2_06_R2_ACCOUNT_ID              32-hex Cloudflare account ID
  V2_06_R2_BUCKET                  exact private staging bucket
  V2_06_R2_ACCESS_KEY_ID           bucket-scoped R2 key
  V2_06_R2_SECRET_ACCESS_KEY       bucket-scoped R2 secret

Existing protected local credentials may be used without exposing values by setting:
  V2_06_OWNED_FIXTURE_USE_PG_SERVICE=YES
  V2_06_OWNED_FIXTURE_USE_WRANGLER=YES
and the exact approved PGHOST/PGDATABASE/PGUSER/PGSSLMODE/PGPASSFILE environment.

The fixture is Avatar Hub-only. It never creates project artifact reservations or receipts.
R2/DB ordering records tenant assets and presets before R2 writes; reruns are idempotent.
The committed audit includes a deterministic expected-key orphan inventory and never deletes.

The source is fixed to ${SOURCE_RELATIVE}; its manifest row is checked before rasterization.
Raster output is marked staging-only and compatibility UNTESTED. No GPU/provider generation occurs.
`);
}

async function loadInputs(options) {
  const email = String(envOr(options, "email", "V2_06_OWNED_FIXTURE_EMAIL", ""))
    .trim()
    .toLowerCase();
  if (!ALLOWED_EMAILS.has(email))
    throw new Error("V2_06_OWNED_FIXTURE_EMAIL must be one of the two admitted Google emails");
  const seedAt = requireTimestamp(
    envOr(options, "seed_at", "V2_06_OWNED_FIXTURE_SEED_AT", "2026-08-17T00:00:00Z"),
    "V2_06_OWNED_FIXTURE_SEED_AT",
  );
  const raster = await rasterizeOwnedFixture();
  return Object.freeze({ email, seedAt, raster });
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) return printHelp();
  const inputs = await loadInputs(options);
  const preview = {
    schema_version: "videoforge-owned-fixture-provision-plan/v1",
    source_path: SOURCE_RELATIVE,
    source_manifest_path: MANIFEST_RELATIVE,
    source_manifest_sha256: inputs.raster.manifest.sha256,
    source_sha256: `sha256:${EXPECTED_SOURCE_SHA256}`,
    tenant_email: inputs.email,
    seed_at: inputs.seedAt,
    avatar_storage: "AVATAR_HUB_CANONICAL_PROFILE_VERSION_KEYS",
    files: Object.fromEntries(
      ROLE_ORDER.map((role) => {
        const file = inputs.raster.files[role];
        return [
          role,
          {
            content_type: file.contentType,
            bytes: file.bytes.byteLength,
            width: file.width,
            height: file.height,
            checksum_sha256: hashBytes(file.bytes),
          },
        ];
      }),
    ),
  };
  if (options.dryRun || !process.env.V2_06_OWNED_FIXTURE_CONFIRM) {
    console.log(JSON.stringify({ ...preview, mutation: "SKIPPED_DRY_RUN" }, null, 2));
    return;
  }
  if (process.env.V2_06_OWNED_FIXTURE_CONFIRM !== "YES")
    throw new Error("refusing owned fixture mutation without V2_06_OWNED_FIXTURE_CONFIRM=YES");
  if (process.env.V2_06_OWNED_FIXTURE_R2_CONFIRM !== "YES")
    throw new Error("refusing R2 mutation without V2_06_OWNED_FIXTURE_R2_CONFIRM=YES");
  if (process.env.V2_06_OWNED_FIXTURE_DATABASE_CONFIRM !== "YES")
    throw new Error("refusing database mutation without V2_06_OWNED_FIXTURE_DATABASE_CONFIRM=YES");
  const databaseUrl = process.env.V2_06_MIGRATION_DATABASE_URL;
  const useProtectedPgService = process.env.V2_06_OWNED_FIXTURE_USE_PG_SERVICE === "YES";
  const useWranglerR2 = process.env.V2_06_OWNED_FIXTURE_USE_WRANGLER === "YES";
  if (useProtectedPgService) {
    if (
      process.env.PGHOST !== APPROVED_NEON_HOST ||
      process.env.PGDATABASE !== APPROVED_NEON_DATABASE ||
      process.env.PGUSER !== APPROVED_NEON_MIGRATION_ROLE ||
      process.env.PGSSLMODE !== APPROVED_NEON_SSLMODE ||
      typeof process.env.PGPASSFILE !== "string" ||
      process.env.PGPASSFILE.length === 0
    )
      throw new Error("protected PostgreSQL environment is not the approved owner service");
  } else {
    assertMigrationUrl(databaseUrl);
  }
  const r2Config = {
    accountId: requireText(process.env.V2_06_R2_ACCOUNT_ID, "V2_06_R2_ACCOUNT_ID"),
    bucket: requireText(process.env.V2_06_R2_BUCKET, "V2_06_R2_BUCKET"),
    accessKeyId: useWranglerR2
      ? undefined
      : requireText(process.env.V2_06_R2_ACCESS_KEY_ID, "V2_06_R2_ACCESS_KEY_ID"),
    secretAccessKey: useWranglerR2
      ? undefined
      : requireText(process.env.V2_06_R2_SECRET_ACCESS_KEY, "V2_06_R2_SECRET_ACCESS_KEY"),
    region: process.env.V2_06_R2_REGION ?? APPROVED_R2_REGION,
  };
  assertR2Config(r2Config);
  const { Pool } = useProtectedPgService
    ? requireFromControlPlane("pg")
    : createRequire(path.join(ROOT, "apps/web/package.json"))("@neondatabase/serverless");
  const pool = new Pool({
    ...(useProtectedPgService ? {} : { connectionString: databaseUrl }),
    max: 1,
    application_name: "videoforge-v2-06-owned-fixture",
    ...(useProtectedPgService ? {} : { options: "-c search_path=public,pg_catalog" }),
  });
  try {
    const scope = await resolveScope(pool, inputs.email);
    const assets = buildAssets({
      scope,
      files: inputs.raster.files,
      sourceManifest: inputs.raster.manifest,
    });
    let plan;
    const seedClient = await pool.connect();
    try {
      await seedClient.query("BEGIN");
      await ensureAssets(seedClient, scope, assets, inputs.seedAt);
      plan = await ensurePresetRows(seedClient, scope, assets, inputs.seedAt);
      await seedClient.query("COMMIT");
    } catch (error) {
      await seedClient.query("ROLLBACK");
      throw error;
    } finally {
      seedClient.release();
    }
    const orphanInventory = useWranglerR2
      ? await ensureWranglerR2Objects(assets, scope)
      : await ensureR2Objects(r2Config, assets, scope);
    let audit;
    const auditClient = await pool.connect();
    try {
      await auditClient.query("BEGIN");
      audit = await ensureAuditRow(
        auditClient,
        scope,
        assets,
        plan,
        inputs.seedAt,
        inputs.raster.manifest,
        orphanInventory,
      );
      await auditClient.query("COMMIT");
    } catch (error) {
      await auditClient.query("ROLLBACK");
      throw error;
    } finally {
      auditClient.release();
    }
    console.log(
      JSON.stringify(
        {
          ...preview,
          mutation: "COMMITTED",
          account_id: scope.account_id,
          workspace_id: scope.workspace_id,
          assets: Object.fromEntries(
            ROLE_ORDER.map((role) => [
              role,
              {
                asset_id: assets[role].assetId,
                object_key: assets[role].objectKey,
                checksum_sha256: assets[role].checksumSha256,
              },
            ]),
          ),
          presets: {
            avatar_profile_version_id: plan.avatarVersionId,
            avatar_profile_hash: plan.avatarProfileHash,
            image_style_version_id: plan.styleVersionId,
            style_profile_hash: plan.styleProfileHash,
          },
          orphan_inventory: orphanInventory,
          audit,
        },
        null,
        2,
      ),
    );
  } finally {
    await pool.end();
  }
}

export {
  ALLOWED_EMAILS,
  APPROVED_CLOUDFLARE_ACCOUNT_ID,
  APPROVED_NEON_DATABASE,
  APPROVED_NEON_HOST,
  APPROVED_NEON_MIGRATION_ROLE,
  APPROVED_R2_BUCKET,
  APPROVED_R2_REGION,
  EXPECTED_SOURCE_SHA256,
  SOURCE_PATH,
  assertMigrationUrl,
  assertR2Config,
  buildAssets,
  buildOrphanInventory,
  canonicalize,
  deterministicUuid,
  parseArgs,
  parseManifestRow,
  pngDimensions,
  requireUuid,
  r2ObjectUrl,
  r2Request,
  stripPngMetadata,
};

if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("provision-owned-fixture.mjs")
) {
  main().catch((error) => {
    console.error(
      `V2-06 owned fixture provisioner failed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    process.exitCode = 1;
  });
}

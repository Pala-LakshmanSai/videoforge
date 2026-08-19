#!/usr/bin/env node

/*
 * V2-06 owned-render fixture provisioner.
 *
 * The default path is provider-free dry-run. Live mode is a bounded, append-only activation step:
 * exact owned R2 objects are uploaded only when missing, verified byte-for-byte, and then one
 * Neon transaction creates the tenant/project/revision/assets/reservations/receipts/render-plan/
 * mutation-receipt lineage. There is deliberately no delete, repair, GPU, or provider-generation
 * path. A database or R2 failure intentionally leaves already verified R2 objects in place for
 * audit and records an append-only reconcile receipt; no automatic compensation delete is
 * attempted.
 */

import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const requireWeb = createRequire(path.join(ROOT, "apps/web/package.json"));
const requireControlPlane = createRequire(path.join(ROOT, "packages/control-plane/package.json"));
const FUTURE_NEON_DRIVER = "@neondatabase/serverless";
const SOURCE_ROOT = path.join(ROOT, "artifacts/local-media");
const SOURCE_ATTEMPT = "attempt_render_local_004";
const APPROVED_R2_ACCOUNT_ID = "f9254d773a3426fcb469451b1f965d8c";
const APPROVED_R2_BUCKET = "videoforge-v2-06-staging-private";
const APPROVED_R2_REGION = "auto";
const APPROVED_NEON_HOST = "ep-sparkling-dew-azjhkwg6-pooler.c-3.ap-southeast-1.aws.neon.tech";
const APPROVED_NEON_DATABASE = "neondb";
const APPROVED_NEON_MIGRATION_ROLE = "neondb_owner";
const APPROVED_NEON_SSLMODE = "require";
const APPROVED_NEON_CHANNEL_BINDING = "require";
const APPROVED_DB_SEARCH_PATH = "public,pg_catalog";
const APPROVED_GOOGLE_PROVIDER = "google";
const MIGRATION_ROOT = path.join(ROOT, "packages/control-plane/migrations");
const MIGRATION_MANIFEST_PATH = path.join(MIGRATION_ROOT, "manifest.json");
const APPROVED_MIGRATION_MANIFEST_SHA256 =
  "sha256:26e92fcd7b6ca30f6406d0680d56f185ccc9f5cfb2be4c044a201015a612875d";
const BUCKET = APPROVED_R2_BUCKET;
const FIXTURE_ID = "local_short_slice_owned_001";
const OPERATION = "v2-06-owned-render-fixture-v4";
const PROJECT_NAME = "V2-06 Owned Render Fixture v4";
const EXPECTED_SOURCE_RENDER_INPUT_SHA256 =
  "sha256:1e63c09aa9d6bb0ba17337284a727925c2f67e76de8564b700d3a0a54a301f9e";
const EXPECTED_SOURCE_EVIDENCE_SHA256 =
  "sha256:b89b4f6f146b132effd974b561e11d238066537338de96c96a730519357771fc";
const EXPECTED_SOURCE_OUTPUT_SHA256 =
  "sha256:91c6612810d3f9be29395abf4cf4dea4ab3fc34b3924c7864efe3ff65fac032c";
const EXPECTED_SOURCE_MANIFEST_SHA256 =
  "sha256:5ba0446f01b27c1c044d33c3af724904d4725a01669ae7d5a63664416729d1cf";
const MAX_R2_OBJECT_COUNT = 6;
const MAX_R2_OBJECT_BYTES = 4_000_000;
const MAX_R2_AGGREGATE_BYTES = 5_000_000;
const FINITE_ACTION_SPEND_CAP_USD = 3;
const R2_RECURRING_CEILING_USD_PER_MONTH = 2;
const AUTHORITY_METADATA = Object.freeze({
  checkpoint: "V2-06",
  task_id: "VF-10-06",
  authority_kind: "user_approved_bounded_live_activation",
  finite_action_spend_cap_usd: FINITE_ACTION_SPEND_CAP_USD,
  r2_recurring_ceiling_usd_per_month: R2_RECURRING_CEILING_USD_PER_MONTH,
  expected_external_spend_usd: 0,
  provider_generation: "DISABLED",
  gpu_transport: "DISABLED_FAKE_ONLY",
  google_provider: APPROVED_GOOGLE_PROVIDER,
  r2_object_count_cap: MAX_R2_OBJECT_COUNT,
  r2_object_bytes_cap: MAX_R2_OBJECT_BYTES,
  r2_aggregate_bytes_cap: MAX_R2_AGGREGATE_BYTES,
});
// The persisted hosted_render_submission lives in hosted_render_plans, never in revision payload.
const WHISPER_MODEL_SHA256 =
  "sha256:a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002";
const ALLOWED_EMAILS = new Set(["lakshmansai121@gmail.com", "demo9gss@gmail.com"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const SHA = /^sha256:[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const LOCAL_URI =
  /^vf-local:\/\/objects\/sha256\/([0-9a-f]{2})\/([0-9a-f]{64})\.([a-z0-9]{1,10})$/u;

function error(message) {
  throw new Error("V2-06 owned render fixture: " + message);
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return (
    "{" +
    Object.keys(value)
      .sort()
      .map((key) => JSON.stringify(key) + ":" + canonical(value[key]))
      .join(",") +
    "}"
  );
}

function sha256(bytes) {
  return "sha256:" + createHash("sha256").update(bytes).digest("hex");
}

function canonicalHash(value) {
  return sha256(Buffer.from(canonical(value), "utf8"));
}

function assertApprovedSourceLocation(root, attempt) {
  if (path.resolve(root) !== SOURCE_ROOT || attempt !== SOURCE_ATTEMPT)
    error("source must be the exact approved pinned V2-06 owned local-slice path");
}

function assertR2PlanCaps(rows) {
  if (!Array.isArray(rows) || rows.length !== MAX_R2_OBJECT_COUNT)
    error("owned render fixture R2 object count exceeds the exact V2-06 cap");
  const aggregateBytes = rows.reduce((total, row) => {
    if (!row || !Number.isSafeInteger(row.bytes?.length) || row.bytes.length < 1)
      error("owned render fixture contains an invalid R2 object byte count");
    if (row.bytes.length > MAX_R2_OBJECT_BYTES)
      error("owned render fixture contains an R2 object over the exact per-object byte cap");
    return total + row.bytes.length;
  }, 0);
  if (aggregateBytes > MAX_R2_AGGREGATE_BYTES)
    error("owned render fixture exceeds the exact aggregate R2 byte cap");
  return Object.freeze({
    object_count: rows.length,
    object_count_cap: MAX_R2_OBJECT_COUNT,
    aggregate_bytes: aggregateBytes,
    aggregate_bytes_cap: MAX_R2_AGGREGATE_BYTES,
    per_object_bytes_cap: MAX_R2_OBJECT_BYTES,
  });
}

function readApprovedMigrationManifest() {
  let bytes;
  try {
    bytes = readFileSync(MIGRATION_MANIFEST_PATH);
  } catch {
    error("committed migration manifest is unavailable");
  }
  if (sha256(bytes) !== APPROVED_MIGRATION_MANIFEST_SHA256)
    error("migration manifest bytes do not match the approved V2-06 identity");
  let manifest;
  try {
    manifest = JSON.parse(bytes.toString("utf8"));
  } catch {
    error("committed migration manifest is invalid JSON");
  }
  if (!manifest || !Array.isArray(manifest.migrations) || manifest.migrations.length !== 36)
    error("V2-06 requires the complete 36-entry migration manifest");
  const entries = manifest.migrations.map((entry, index) => {
    if (
      !entry ||
      entry.version !== index + 1 ||
      typeof entry.name !== "string" ||
      typeof entry.filename !== "string" ||
      typeof entry.sha256 !== "string"
    )
      error("migration manifest is not a contiguous 1..36 chain");
    let sqlBytes;
    try {
      sqlBytes = readFileSync(path.join(MIGRATION_ROOT, entry.filename));
    } catch {
      error("migration source " + entry.filename + " is unavailable");
    }
    if (sha256(sqlBytes) !== entry.sha256)
      error("migration source " + entry.filename + " does not match its committed hash");
    return Object.freeze({
      version: entry.version,
      name: entry.name,
      filename: entry.filename,
      sha256: entry.sha256,
    });
  });
  return Object.freeze(entries);
}

const APPROVED_MIGRATIONS = readApprovedMigrationManifest();

function uuid(label) {
  const hex = createHash("md5").update(label).digest("hex");
  return (
    hex.slice(0, 8) +
    "-" +
    hex.slice(8, 12) +
    "-4" +
    hex.slice(13, 16) +
    "-8" +
    hex.slice(17, 20) +
    "-" +
    hex.slice(20)
  );
}

function requireUuid(value, name) {
  if (typeof value !== "string" || !UUID.test(value)) error(name + " is not a UUID");
  return value;
}

function requireSha(value, name) {
  if (typeof value !== "string" || !SHA.test(value)) error(name + " is not a SHA-256 digest");
  return value;
}

function readJson(file, label) {
  return readFile(file, "utf8")
    .then((raw) => {
      try {
        return JSON.parse(raw);
      } catch {
        error(label + " is invalid JSON");
      }
    })
    .catch((cause) => {
      if (cause instanceof Error && cause.message.startsWith("V2-06")) throw cause;
      error(label + " could not be read");
    });
}

function localPath(root, uri) {
  const match = LOCAL_URI.exec(uri);
  if (!match) error("unsupported local object URI " + uri);
  return path.join(root, "objects", "sha256", match[1], match[2] + "." + match[3]);
}

function uriFor(digest, extension) {
  requireSha(digest, "object digest");
  return (
    "vf-local://objects/sha256/" + digest.slice(7, 9) + "/" + digest.slice(7) + "." + extension
  );
}

async function exactBytes(root, uri, digest, label) {
  const match = LOCAL_URI.exec(uri);
  if (!match || "sha256:" + match[2] !== digest) error(label + " URI/hash mismatch");
  let bytes;
  try {
    bytes = await readFile(localPath(root, uri));
  } catch {
    error(label + " complete bytes are absent");
  }
  if (bytes.length < 1 || sha256(bytes) !== digest) error(label + " bytes do not match SHA-256");
  return { bytes, path: localPath(root, uri), extension: match[3] };
}

function validateRenderInput(input) {
  if (!input || input.schema_version !== "render-job-input/v1")
    error("render input schema drifted");
  if (typeof input.project_revision_id !== "string" || !IDENTIFIER.test(input.project_revision_id))
    error("render input project_revision_id is invalid");
  if (!Array.isArray(input.assets) || input.assets.length < 2)
    error("render input has incomplete assets");
  if (
    !input.resolved_render_manifest ||
    !LOCAL_URI.test(input.resolved_render_manifest.artifact_uri)
  )
    error("render input manifest pointer is invalid");
  requireSha(input.resolved_render_manifest.sha256, "render input manifest hash");
  if (
    input.resolved_render_manifest.sha256 !==
    "sha256:" + LOCAL_URI.exec(input.resolved_render_manifest.artifact_uri)[2]
  )
    error("render input manifest URI/hash mismatch");
  const output = input.output;
  if (!output || typeof output.result_uri !== "string" || !/\.mp4$/u.test(output.filename))
    error("render input output is invalid");
  if (
    !input.tools ||
    typeof input.tools.ffmpeg_version !== "string" ||
    typeof input.tools.ffprobe_version !== "string"
  )
    error("render input tools are invalid");
  if (typeof input.cancel_token !== "string" || input.cancel_token.length < 32)
    error("render input cancel token is invalid");
  const uris = new Set();
  for (const asset of input.assets) {
    if (typeof asset.asset_id !== "string" || !IDENTIFIER.test(asset.asset_id))
      error("render input asset id is invalid");
    requireSha(asset.sha256, "render input asset hash");
    if (
      !["VOICEOVER", "AVATAR_CLIP", "IMAGE"].includes(asset.kind) ||
      !LOCAL_URI.test(asset.artifact_uri)
    )
      error("render input asset is invalid");
    if (
      asset.sha256 !== "sha256:" + LOCAL_URI.exec(asset.artifact_uri)[2] ||
      uris.has(asset.artifact_uri)
    )
      error("render input asset URI is not exact");
    uris.add(asset.artifact_uri);
  }
  if (uris.has(input.resolved_render_manifest.artifact_uri))
    error("manifest URI duplicates an input URI");
  return input;
}

async function verifyLocalFixture(root = SOURCE_ROOT, attempt = SOURCE_ATTEMPT) {
  assertApprovedSourceLocation(root, attempt);
  const run = path.join(root, "runs", "revision_local_owned_001", attempt);
  const inputFile = path.join(run, "render-input.json");
  const evidenceFile = path.join(run, "acceptance-evidence.json");
  const input = await readJson(inputFile, "local render input");
  const evidence = await readJson(evidenceFile, "local evidence");
  if (
    evidence.schema_version !== "videoforge.local-slice-evidence/v1" ||
    evidence.source_fixture_id !== FIXTURE_ID
  )
    error("local evidence is not the owned short-slice record");
  if (evidence.provider_calls_authorized !== false || evidence.external_spend_usd !== 0)
    error("local evidence is not provider-off and zero-spend");
  validateRenderInput(input);
  const inputBytes = await readFile(inputFile);
  const evidenceBytes = await readFile(evidenceFile);
  const inputHash = sha256(inputBytes);
  const evidenceHash = sha256(evidenceBytes);
  if (inputHash !== EXPECTED_SOURCE_RENDER_INPUT_SHA256)
    error("local render input is not the exact approved immutable evidence document");
  if (evidenceHash !== EXPECTED_SOURCE_EVIDENCE_SHA256)
    error("local acceptance evidence is not the exact approved immutable evidence document");
  if (inputHash !== evidence.documents.render_input_sha256)
    error("local render input hash is not pinned by evidence");
  const assets = [];
  for (const item of input.assets) {
    const bytes = await exactBytes(root, item.artifact_uri, item.sha256, item.kind);
    assets.push({ local: item, ...bytes });
  }
  const manifestBytes = await exactBytes(
    root,
    input.resolved_render_manifest.artifact_uri,
    input.resolved_render_manifest.sha256,
    "resolved render manifest",
  );
  const manifest = await readJson(manifestBytes.path, "resolved render manifest");
  if (
    manifest.schema_version !== "resolved-render-manifest/v1" ||
    manifest.project_revision_id !== input.project_revision_id
  )
    error("resolved render manifest is not the exact local document");
  if (sha256(manifestBytes.bytes) !== EXPECTED_SOURCE_MANIFEST_SHA256)
    error("resolved render manifest is not the exact approved immutable evidence document");
  const output = await exactBytes(
    root,
    evidence.output.artifact_uri,
    evidence.output.sha256,
    "local output",
  );
  if (Number(evidence.output.bytes) !== output.bytes.length)
    error("local output byte count drifted");
  if (evidence.output.sha256 !== EXPECTED_SOURCE_OUTPUT_SHA256)
    error("local output is not the exact approved immutable evidence document");
  if (evidence.documents.resolved_render_manifest_sha256 !== EXPECTED_SOURCE_MANIFEST_SHA256)
    error("local evidence does not pin the exact approved resolved render manifest");
  if (
    evidence.documents.render_result_sha256 !==
    "sha256:2d4b3b04132d3cfdc72f08d9425d50ec976327bdf9daebf3f457f8571ccf301a"
  )
    error("local evidence render result identity drifted");
  if (
    evidence.documents.revision_config_sha256 !==
    "sha256:54b3dbf697baa8d7d1db69c2b32488435f44500677eb24e66fbfbd725627fdb4"
  )
    error("local evidence revision config identity drifted");
  if (evidence.source_fixture_id !== FIXTURE_ID) error("local evidence fixture identity drifted");
  if (evidence.output.probe?.sha256 !== EXPECTED_SOURCE_OUTPUT_SHA256)
    error("local evidence output probe identity drifted");
  if (evidence.output.probe?.bytes !== output.bytes.length)
    error("local evidence output probe byte count drifted");
  if (evidence.output.probe?.duration_ms !== 37167) error("local evidence output duration drifted");
  if (evidence.output.probe?.video?.width !== 1920 || evidence.output.probe?.video?.height !== 1080)
    error("local evidence output dimensions drifted");
  if (evidence.output.probe?.audio?.codec !== "aac")
    error("local evidence output audio codec drifted");
  if (evidence.output.probe?.video?.codec !== "h264")
    error("local evidence output video codec drifted");
  return {
    root,
    input,
    evidence,
    assets,
    manifest,
    manifestBytes,
    output,
    inputHash,
    evidenceHash,
  };
}

function runCanonicalLocalPath() {
  const env = { ...process.env };
  for (const key of [
    "DATABASE_URL",
    "V2_06_MIGRATION_DATABASE_URL",
    "V2_06_R2_ACCESS_KEY_ID",
    "V2_06_R2_SECRET_ACCESS_KEY",
    "RUNPOD_API_KEY",
    "RUNWARE_API_KEY",
  ])
    delete env[key];
  const result = spawnSync("pnpm", ["test:local-slice"], { cwd: ROOT, env, stdio: "ignore" });
  if (result.error || result.status !== 0)
    error("canonical provider-free local path failed (exit " + (result.status ?? 1) + ")");
}

function replaceIds(value, map) {
  if (typeof value === "string") return map.get(value) ?? value;
  if (Array.isArray(value)) return value.map((item) => replaceIds(item, map));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, replaceIds(child, map)]),
    );
  return value;
}

function planFixture(fixture, scope, seedAt, preset = null) {
  requireUuid(scope.user_id, "user_id");
  requireUuid(scope.account_id, "account_id");
  requireUuid(scope.workspace_id, "workspace_id");
  const projectId = uuid(OPERATION + ":" + scope.account_id + ":project");
  const revisionId = uuid(OPERATION + ":" + scope.account_id + ":revision");
  const renderAttemptId = uuid(OPERATION + ":" + scope.account_id + ":render-attempt");
  const jobId = OPERATION + "-" + scope.account_id.slice(0, 8);
  const ids = new Map();
  const rows = [];
  const counts = new Map();
  for (const item of fixture.assets) {
    const ordinal = (counts.get(item.local.kind) ?? 0) + 1;
    counts.set(item.local.kind, ordinal);
    const role =
      item.local.kind === "VOICEOVER"
        ? "voiceover"
        : item.local.kind === "AVATAR_CLIP"
          ? "avatar-clip"
          : "image-" + ordinal;
    const assetId = uuid(OPERATION + ":" + scope.account_id + ":asset:" + role);
    const reservationId = uuid(OPERATION + ":" + scope.account_id + ":reservation:" + role);
    const receiptId = uuid(OPERATION + ":" + scope.account_id + ":receipt:" + role);
    ids.set(item.local.asset_id, assetId);
    rows.push({
      name: role,
      assetId,
      reservationId,
      receiptId,
      kind: item.local.kind,
      contentType:
        item.local.kind === "VOICEOVER"
          ? "audio/wav"
          : item.local.kind === "AVATAR_CLIP"
            ? "video/mp4"
            : "image/png",
      digest: item.local.sha256,
      bytes: item.bytes,
      path: item.path,
      uri: item.local.artifact_uri,
      extension: item.extension,
      durationMs:
        item.local.kind === "VOICEOVER"
          ? Number(fixture.evidence.source_voiceover.duration_ms)
          : null,
    });
  }
  const manifestAssetId = uuid(OPERATION + ":" + scope.account_id + ":asset:manifest");
  const manifestReservationId = uuid(OPERATION + ":" + scope.account_id + ":reservation:manifest");
  const manifestReceiptId = uuid(OPERATION + ":" + scope.account_id + ":receipt:manifest");
  const voiceover = rows.find((row) => row.kind === "VOICEOVER");
  const avatar = rows.find((row) => row.kind === "AVATAR_CLIP");
  const images = rows.filter((row) => row.kind === "IMAGE");
  if (!voiceover || !avatar || images.length === 0) error("owned local input set is incomplete");
  const base = {
    schema_version: "videoforge-hosted-revision-config/v1",
    project_id: projectId,
    project_revision_id: revisionId,
    title: PROJECT_NAME,
    voiceover_asset_id: voiceover.assetId,
    voiceover_sha256: voiceover.digest,
    voiceover_binary_sha256: voiceover.digest,
    generation_mode: "LOWEST_COST",
    maximum_cost_micro_usd: 100_000,
    currency: "USD",
    gpu_transport: "DISABLED_FAKE_ONLY",
    execution_backend: "PERSONAL_WORKER",
    fixture_provenance: FIXTURE_ID,
  };
  if (preset) {
    for (const [value, name] of [
      [preset.avatarProfileId, "avatar_profile_id"],
      [preset.avatarVersionId, "avatar_profile_version_id"],
      [preset.avatarProfileHash, "avatar_profile_hash"],
      [preset.runtimeAssetId, "avatar_runtime_source_asset_id"],
      [preset.runtimeAssetSha256, "avatar_runtime_source_binary_sha256"],
      [preset.styleId, "image_style_id"],
      [preset.styleVersionId, "image_style_version_id"],
      [preset.styleProfileHash, "style_profile_hash"],
    ]) {
      if (typeof value !== "string" || value.length === 0)
        error(name + " is absent from tenant presets");
    }
    Object.assign(base, {
      avatar_profile_id: preset.avatarProfileId,
      avatar_profile_version_id: preset.avatarVersionId,
      avatar_profile_hash: preset.avatarProfileHash,
      avatar_runtime_source_asset_id: preset.runtimeAssetId,
      avatar_runtime_source_binary_sha256: preset.runtimeAssetSha256,
      avatar_source_preparation_profile: preset.sourcePreparationProfile,
      avatar_source_validation_profile: preset.sourceValidationProfile,
      image_style_id: preset.styleId,
      image_style_version_id: preset.styleVersionId,
      style_profile_hash: preset.styleProfileHash,
      extra_prompt_keywords: "",
      apply_extra_prompt_keywords: false,
      revision_config_contract_name: "videoforge-hosted-revision-config",
      revision_config_contract_version: "v1",
      seed: preset.seed,
    });
  }
  // The hosted submission below is derived from the manifest and therefore cannot be added to
  // this hash without creating a circular manifest -> revision_config_hash dependency. The
  // immutable render plan is persisted separately in hosted_render_plans.
  const revisionConfigHash = canonicalHash(base);
  const idMap = new Map([[fixture.input.project_revision_id, revisionId], ...ids]);
  const rewrittenManifest = replaceIds(fixture.manifest, idMap);
  rewrittenManifest.project_revision_id = revisionId;
  rewrittenManifest.revision_config_hash = revisionConfigHash;
  const manifestBytes = Buffer.from(canonical(rewrittenManifest), "utf8");
  const manifestSha = sha256(manifestBytes);
  const manifestRow = {
    name: "resolved-render-manifest",
    assetId: manifestAssetId,
    reservationId: manifestReservationId,
    receiptId: manifestReceiptId,
    kind: "CANONICAL_DOCUMENT",
    contentType: "application/json",
    digest: manifestSha,
    bytes: manifestBytes,
    path: null,
    uri: uriFor(manifestSha, "json"),
    extension: "json",
    durationMs: null,
  };
  const allRows = [manifestRow, ...rows];
  for (const row of allRows)
    row.objectKey =
      "tenant/" +
      scope.account_id +
      "/workspace/" +
      scope.workspace_id +
      "/project/" +
      projectId +
      "/revision/" +
      revisionId +
      "/lane/input/job/" +
      jobId +
      "/artifact/" +
      row.name;
  for (const row of allRows) {
    row.metadata = {
      schema_version: "videoforge-owned-render-fixture-asset/v1",
      fixture_id: FIXTURE_ID,
      fixture_non_production: true,
      role: row.name,
      content_type: row.contentType,
      byte_size: row.bytes.length,
      checksum_sha256: row.digest,
      object_key: row.objectKey,
    };
  }
  const r2Budget = assertR2PlanCaps(allRows);
  const renderInput = {
    schema_version: "render-job-input/v1",
    project_revision_id: revisionId,
    attempt_id: renderAttemptId,
    resolved_render_manifest: {
      asset_id: manifestAssetId,
      sha256: manifestSha,
      artifact_uri: manifestRow.uri,
    },
    assets: rows.map((row) => ({
      asset_id: row.assetId,
      sha256: row.digest,
      artifact_uri: row.uri,
      kind: row.kind,
    })),
    output: {
      result_uri: "vf-local-run://" + revisionId + "/" + renderAttemptId + "/videoforge-output.mp4",
      filename: "videoforge-owned-render-fixture.mp4",
    },
    tools: { ffmpeg_version: "8.1.2", ffprobe_version: "8.1.2" },
    cancel_token: renderAttemptId + ":cancel-token:v1",
  };
  validateRenderInput(renderInput);
  requireUuid(renderInput.project_revision_id, "hosted render input project_revision_id");
  const submission = {
    schema_version: "videoforge-hosted-cpu-submission/v1",
    idempotency_key: OPERATION + "-" + scope.account_id.slice(0, 12) + "-v1",
    project_id: projectId,
    project_revision_id: revisionId,
    kind: "RENDER",
    input_document: renderInput,
    objects: allRows.map((row) => ({ artifact_receipt_id: row.receiptId, uri: row.uri })),
  };
  const asrSubmission = {
    schema_version: "videoforge-hosted-cpu-submission/v1",
    idempotency_key: OPERATION + "-" + scope.account_id.slice(0, 12) + "-asr-v1",
    project_id: projectId,
    project_revision_id: revisionId,
    kind: "ASR",
    input_document: {
      schema_version: "asr-job-input/v1",
      project_revision_id: revisionId,
      attempt_id: projectId,
      voiceover: {
        asset_id: voiceover.assetId,
        sha256: voiceover.digest,
        artifact_uri: voiceover.uri,
        media_type: voiceover.contentType,
        duration_ms: voiceover.durationMs,
      },
      model: {
        engine: "whisper.cpp",
        name: "base.en",
        sha256: WHISPER_MODEL_SHA256,
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
        result_uri: "vf-local-run://" + revisionId + "/" + projectId + "/asr-result.json",
      },
      cancel_token: projectId,
    },
    objects: [{ artifact_receipt_id: voiceover.receiptId, uri: voiceover.uri }],
  };
  const renderPlanPayloadHash = canonicalHash(submission);
  return {
    operation: OPERATION,
    fixtureId: FIXTURE_ID,
    scope,
    seedAt,
    projectId,
    revisionId,
    renderAttemptId,
    jobId,
    idempotencyKey: submission.idempotency_key,
    asrIdempotencyKey: asrSubmission.idempotency_key,
    revisionConfigHash,
    revisionConfigBase: base,
    // This is the exact payload stored on project_revisions; it intentionally contains no plan.
    revisionConfigPayload: base,
    rewrittenManifest,
    manifestBytes,
    manifestSha,
    renderInput,
    submission,
    asrSubmission,
    renderPlanPayloadHash,
    authority: {
      ...AUTHORITY_METADATA,
      source_render_input_sha256: fixture.inputHash,
      source_evidence_sha256: fixture.evidenceHash,
      source_manifest_sha256: EXPECTED_SOURCE_MANIFEST_SHA256,
      source_output_sha256: EXPECTED_SOURCE_OUTPUT_SHA256,
    },
    r2Budget,
    rows: allRows,
  };
}

function dryScope(email) {
  return {
    user_id: uuid("dry:" + email + ":user"),
    account_id: uuid("dry:" + email + ":account"),
    workspace_id: uuid("dry:" + email + ":workspace"),
  };
}

function checksumHeader(digest) {
  return Buffer.from(digest.slice(7), "hex").toString("base64");
}

function makeR2(config) {
  let AwsClient;
  try {
    ({ AwsClient } = requireWeb("aws4fetch"));
  } catch {
    error("aws4fetch is unavailable from apps/web");
  }
  return new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: "s3",
    region: config.region,
    retries: 0,
  });
}

function r2Url(config, key) {
  return (
    "https://" +
    config.accountId +
    ".r2.cloudflarestorage.com/" +
    encodeURIComponent(config.bucket) +
    "/" +
    key.split("/").map(encodeURIComponent).join("/")
  );
}

async function r2Request(client, url, method, headers = {}, body, fetchImpl = fetch) {
  // aws4fetch returns a fully signed Request. Passing that Request through (rather than rebuilding
  // the init object) is important: Authorization, x-amz-date, x-amz-content-sha256, and the
  // caller's checksum/content headers must all reach Cloudflare.
  const signed = await client.sign(url, {
    method,
    headers,
    body,
    aws: { signQuery: false, allHeaders: true },
  });
  if (!signed || typeof signed !== "object" || typeof signed.url !== "string")
    error("aws4fetch did not return a signed R2 request");
  return fetchImpl(signed);
}

async function verifyR2Object(client, config, row, fetchImpl = fetch) {
  const url = r2Url(config, row.objectKey);
  const head = await r2Request(client, url, "HEAD", {}, undefined, fetchImpl);
  if (head.status === 404) return false;
  if (!head.ok) error("R2 preflight for " + row.name + " returned HTTP " + head.status);
  const headType = head.headers.get("content-type")?.split(";", 1)[0];
  if (
    Number(head.headers.get("content-length")) !== row.bytes.length ||
    headType !== row.contentType
  )
    error("R2 metadata for " + row.name + " differs from exact fixture facts");
  const checked = await r2Request(client, url, "GET", {}, undefined, fetchImpl);
  if (!checked.ok)
    error("R2 byte verification for " + row.name + " returned HTTP " + checked.status);
  const bytes = Buffer.from(await checked.arrayBuffer());
  const contentType = checked.headers.get("content-type")?.split(";", 1)[0];
  if (
    sha256(bytes) !== row.digest ||
    bytes.length !== row.bytes.length ||
    contentType !== row.contentType
  )
    error("R2 object " + row.name + " differs from exact fixture bytes/type");
  return true;
}

async function ensureR2(client, config, row, fetchImpl = fetch) {
  const exists = await verifyR2Object(client, config, row, fetchImpl);
  if (exists) return "REUSED_EXACT";
  const url = r2Url(config, row.objectKey);
  const uploaded = await r2Request(
    client,
    url,
    "PUT",
    {
      "content-type": row.contentType,
      "content-length": String(row.bytes.length),
      "x-amz-checksum-sha256": checksumHeader(row.digest),
      "if-none-match": "*",
    },
    row.bytes,
    fetchImpl,
  );
  if (uploaded.status === 412 || uploaded.status === 409) {
    if (!(await verifyR2Object(client, config, row, fetchImpl)))
      error("R2 conditional-create race for " + row.name + " did not converge to an exact object");
    return "REUSED_EXACT_RACE";
  }
  if (!uploaded.ok) error("R2 upload for " + row.name + " returned HTTP " + uploaded.status);
  if (!(await verifyR2Object(client, config, row, fetchImpl)))
    error("R2 post-upload verification for " + row.name + " found no object");
  return "UPLOADED_VERIFIED";
}

async function ensureWranglerR2(row) {
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "videoforge-v2-06-r2-"));
  const downloaded = path.join(temporaryDirectory, "downloaded-object");
  const upload = path.join(temporaryDirectory, "upload-object");
  const objectPath = `${APPROVED_R2_BUCKET}/${row.objectKey}`;
  const run = (args) =>
    spawnSync("pnpm", ["--filter", "@videoforge/web", "exec", "wrangler", ...args], {
      cwd: ROOT,
      encoding: "utf8",
    });
  try {
    const existing = run(["r2", "object", "get", objectPath, "--remote", "--file", downloaded]);
    if (existing.status === 0) {
      const bytes = await readFile(downloaded);
      if (bytes.length !== row.bytes.length || sha256(bytes) !== row.digest)
        error("Wrangler R2 object " + row.name + " differs from exact fixture bytes");
      return "REUSED_EXACT";
    }
    if (!/not found|404|does not exist/iu.test(`${existing.stdout}\n${existing.stderr}`))
      error("Wrangler R2 preflight for " + row.name + " failed closed");
    await writeFile(upload, row.bytes, { mode: 0o600, flag: "wx" });
    const created = run([
      "r2",
      "object",
      "put",
      objectPath,
      "--remote",
      "--file",
      upload,
      "--content-type",
      row.contentType,
      "--force",
    ]);
    if (created.status !== 0) error("Wrangler R2 upload for " + row.name + " failed");
    const verified = run(["r2", "object", "get", objectPath, "--remote", "--file", downloaded]);
    if (verified.status !== 0) error("Wrangler R2 verification for " + row.name + " failed");
    const bytes = await readFile(downloaded);
    if (bytes.length !== row.bytes.length || sha256(bytes) !== row.digest)
      error("Wrangler R2 post-upload bytes for " + row.name + " drifted");
    return "UPLOADED_VERIFIED";
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

function assertProviderConfig(databaseUrl, r2Config) {
  let url;
  try {
    url = new URL(databaseUrl);
  } catch {
    error("V2_06_MIGRATION_DATABASE_URL is not a valid PostgreSQL URL");
  }
  if (!url || !["postgres:", "postgresql:"].includes(url.protocol))
    error("V2_06_MIGRATION_DATABASE_URL must use postgres:// or postgresql://");
  if (url.hostname !== APPROVED_NEON_HOST)
    error("migration connection host is not the approved V2-06 Neon project");
  if (decodeURIComponent(url.username) !== APPROVED_NEON_MIGRATION_ROLE)
    error("owned render fixture requires the exact migration-owner role");
  if (decodeURIComponent(url.pathname.slice(1)) !== APPROVED_NEON_DATABASE)
    error("migration connection database is not the approved V2-06 database");
  if (url.searchParams.get("sslmode") !== APPROVED_NEON_SSLMODE)
    error("migration connection must require TLS with sslmode=require");
  if (url.searchParams.get("channel_binding") !== APPROVED_NEON_CHANNEL_BINDING)
    error("migration connection must require channel binding");
  if (
    r2Config.accountId !== APPROVED_R2_ACCOUNT_ID ||
    r2Config.bucket !== APPROVED_R2_BUCKET ||
    r2Config.region !== APPROVED_R2_REGION
  )
    error("R2 config is not the approved V2-06 account/bucket/region");
}

async function resolveScope(executor, email) {
  const result = await executor.query(
    `SELECT auth.id AS hosted_auth_user_id, link.user_id::text AS user_id,
            link.admitted_account_id::text AS account_id, link.workspace_id::text AS workspace_id,
            auth.email, auth.email_verified, auth_account.provider_id,
            account.scope_kind AS account_scope_kind,
            account.status AS account_status, workspace.status AS workspace_status,
            workspace.is_default, membership.status AS membership_status,
            membership.role AS membership_role
       FROM hosted_auth_users AS auth
       JOIN hosted_auth_accounts AS auth_account
         ON auth_account.user_id = auth.id
        AND auth_account.provider_id = $2
       JOIN hosted_auth_links AS link ON link.hosted_auth_user_id = auth.id
       JOIN accounts AS account ON account.id = link.admitted_account_id
       JOIN workspaces AS workspace ON workspace.account_id = link.admitted_account_id
                                  AND workspace.id = link.workspace_id
       JOIN memberships AS membership ON membership.account_id = link.admitted_account_id
                                    AND membership.workspace_id = link.workspace_id
                                    AND membership.user_id = link.user_id
      WHERE auth.email = $1`,
    [email, APPROVED_GOOGLE_PROVIDER],
  );
  if (result.rows.length !== 1) error("tenant email must resolve to exactly one admitted identity");
  const scope = result.rows[0];
  if (
    scope.email !== email ||
    scope.email_verified !== true ||
    scope.provider_id !== APPROVED_GOOGLE_PROVIDER ||
    scope.account_scope_kind !== "USER" ||
    scope.account_status !== "ACTIVE" ||
    scope.workspace_status !== "ACTIVE" ||
    scope.is_default !== true ||
    scope.membership_status !== "ACTIVE" ||
    scope.membership_role !== "ADMIN"
  )
    error("tenant identity is not one verified active default workspace owner");
  for (const name of ["user_id", "account_id", "workspace_id"]) requireUuid(scope[name], name);
  return {
    user_id: scope.user_id,
    account_id: scope.account_id,
    workspace_id: scope.workspace_id,
    email,
  };
}

async function resolvePresetRows(executor, scope) {
  const avatarProfileId = uuid("videoforge:v2-06:" + scope.account_id + ":avatar:activation");
  const avatarVersionId = uuid("videoforge:v2-06:" + scope.account_id + ":avatar:activation:v1");
  const styleId = uuid("videoforge:v2-06:" + scope.account_id + ":style:activation");
  const styleVersionId = uuid("videoforge:v2-06:" + scope.account_id + ":style:activation:v1");
  const result = await executor.query(
    `SELECT profile.id::text AS avatar_profile_id,
            avatar_version.id::text AS avatar_version_id,
            avatar_version.profile_hash AS avatar_profile_hash,
            avatar_version.runtime_source_asset_id::text AS runtime_asset_id,
            avatar_version.runtime_source_binary_sha256 AS runtime_asset_sha256,
            avatar_version.source_preparation_profile,
            avatar_version.source_validation_profile,
            style.id::text AS style_id,
            style_version.id::text AS style_version_id,
            style_version.style_profile_hash
       FROM avatar_profiles AS profile
       JOIN avatar_profile_versions AS avatar_version
         ON avatar_version.account_id = profile.account_id
        AND avatar_version.workspace_id = profile.workspace_id
        AND avatar_version.profile_id = profile.id
       CROSS JOIN image_styles AS style
       JOIN image_style_versions AS style_version
         ON style_version.account_id = style.account_id
        AND style_version.workspace_id = style.workspace_id
        AND style_version.style_id = style.id
      WHERE profile.account_id = $1 AND profile.workspace_id = $2
        AND profile.id = $3 AND avatar_version.id = $4
        AND profile.scope_kind = 'WORKSPACE'
        AND avatar_version.scope_kind = 'WORKSPACE'
        AND profile.status = 'ACTIVE' AND avatar_version.state = 'READY'
        AND style.account_id = $1 AND style.workspace_id = $2
        AND style.id = $5 AND style_version.id = $6
        AND style.scope_kind = 'WORKSPACE'
        AND style_version.scope_kind = 'WORKSPACE'
        AND style.status = 'ACTIVE' AND style_version.state = 'PUBLISHED'`,
    [
      scope.account_id,
      scope.workspace_id,
      avatarProfileId,
      avatarVersionId,
      styleId,
      styleVersionId,
    ],
  );
  if (result.rows.length !== 1)
    error("tenant-owned READY/PUBLISHED activation presets are missing");
  const row = result.rows[0];
  const seed =
    Number.parseInt(
      createHash("sha256")
        .update(OPERATION + ":" + scope.account_id, "utf8")
        .digest("hex")
        .slice(0, 8),
      16,
    ) % 2_147_483_647;
  return {
    avatarProfileId: row.avatar_profile_id,
    avatarVersionId: row.avatar_version_id,
    avatarProfileHash: row.avatar_profile_hash,
    runtimeAssetId: row.runtime_asset_id,
    runtimeAssetSha256: row.runtime_asset_sha256,
    sourcePreparationProfile: row.source_preparation_profile,
    sourceValidationProfile: row.source_validation_profile,
    styleId: row.style_id,
    styleVersionId: row.style_version_id,
    styleProfileHash: row.style_profile_hash,
    seed,
  };
}

function exactJson(actual, expected, label) {
  if (canonical(actual) !== canonical(expected)) error(label + " is not an exact idempotent match");
}

function exactTime(actual, expected, label) {
  if (Date.parse(String(actual)) !== Date.parse(expected)) error(label + " timestamp drifted");
}

function buildR2UploadIntent(plan) {
  const payload = {
    schema_version: "videoforge-owned-render-fixture-r2-intent/v1",
    status: "R2_UPLOAD_PENDING",
    fixture_id: FIXTURE_ID,
    fixture_non_production: true,
    tenant_email: plan.scope.email,
    account_id: plan.scope.account_id,
    workspace_id: plan.scope.workspace_id,
    project_id: plan.projectId,
    revision_id: plan.revisionId,
    source_render_input_sha256: plan.sourceRenderInputSha256,
    source_evidence_sha256: plan.sourceEvidenceSha256,
    authority: plan.authority,
    r2_budget: plan.r2Budget,
    objects: plan.rows.map((row) => ({
      role: row.name,
      object_key: row.objectKey,
      sha256: row.digest,
      content_type: row.contentType,
      bytes: row.bytes.length,
    })),
    seed_at: plan.seedAt,
  };
  return Object.freeze({
    idempotencyKey: `${OPERATION}-${plan.scope.account_id}-r2-intent-v1`,
    operation: "v2_06_owned_render_fixture_r2_intent",
    inputHash: canonicalHash({ operation: "R2_UPLOAD_INTENT", payload }),
    resultHash: canonicalHash(payload),
    payload,
  });
}

function buildR2FailureReceipt(plan, intent) {
  const resultPayload = {
    schema_version: "videoforge-owned-render-fixture-r2-failure/v1",
    fixture_id: FIXTURE_ID,
    fixture_non_production: true,
    status: "R2_UPLOAD_FAILED",
    tenant_email: plan.scope.email,
    account_id: plan.scope.account_id,
    workspace_id: plan.scope.workspace_id,
    project_id: plan.projectId,
    revision_id: plan.revisionId,
    r2_upload_intent_idempotency_key: intent.idempotencyKey,
    authority: plan.authority,
    r2_budget: plan.r2Budget,
    cleanup: {
      required: true,
      automatic_delete: false,
      scope: "exact_expected_fixture_objects_only",
      action: "EXPLICIT_MANUAL_R2_DELETE_AFTER_AUDIT",
    },
    // A failure can happen after a successful PUT but before its verification response is known.
    // Keep every expected key auditable without claiming an unsafe per-object state.
    r2_objects: plan.rows.map((row) => ({
      role: row.name,
      object_key: row.objectKey,
      sha256: row.digest,
      content_type: row.contentType,
      bytes: row.bytes.length,
      state: "RECONCILE_REQUIRED",
    })),
    seed_at: plan.seedAt,
  };
  const inputPayload = {
    operation: "R2_UPLOAD_FAILURE",
    r2_upload_intent_input_hash: intent.inputHash,
    payload: resultPayload,
  };
  return Object.freeze({
    idempotencyKey: `${intent.idempotencyKey}-failure-v1`,
    operation: "v2_06_owned_render_fixture_r2_failure",
    inputHash: canonicalHash(inputPayload),
    resultHash: canonicalHash(resultPayload),
    resultPayload: Object.freeze(resultPayload),
  });
}

async function ensureR2FailureReceipt(client, plan, intent) {
  const receipt = buildR2FailureReceipt(plan, intent);
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config($1, $2, true)", [
      "videoforge.account_id",
      plan.scope.account_id,
    ]);
    await client.query(
      `INSERT INTO repository_mutation_receipts (
         workspace_id, idempotency_key, operation, input_hash, result_codec,
         result_payload, result_hash, created_at
       ) VALUES ($1,$2,$3,$4,'repository-result/v1',$5::jsonb,$6,$7)
       ON CONFLICT (workspace_id, idempotency_key) DO NOTHING`,
      [
        plan.scope.workspace_id,
        receipt.idempotencyKey,
        receipt.operation,
        receipt.inputHash,
        JSON.stringify(receipt.resultPayload),
        receipt.resultHash,
        plan.seedAt,
      ],
    );
    const result = await client.query(
      `SELECT workspace_id::text AS workspace_id, idempotency_key, operation, input_hash,
              result_codec, result_payload, result_hash, created_at
         FROM repository_mutation_receipts
        WHERE workspace_id = $1 AND idempotency_key = $2`,
      [plan.scope.workspace_id, receipt.idempotencyKey],
    );
    const row = result.rows[0];
    if (
      !row ||
      row.workspace_id !== plan.scope.workspace_id ||
      row.idempotency_key !== receipt.idempotencyKey ||
      row.operation !== receipt.operation ||
      row.input_hash !== receipt.inputHash ||
      row.result_codec !== "repository-result/v1" ||
      row.result_hash !== receipt.resultHash
    )
      error("R2 failure receipt is not an exact idempotent match");
    exactJson(row.result_payload, receipt.resultPayload, "R2 failure receipt payload");
    exactTime(row.created_at, plan.seedAt, "R2 failure receipt created_at");
    await client.query("COMMIT");
    return receipt;
  } catch (cause) {
    await client.query("ROLLBACK").catch(() => {});
    throw cause;
  }
}

/**
 * Upload every exact fixture object and persist one append-only reconciliation receipt if any
 * upload fails. The uploader is injected so this failure fence is testable without contacting R2.
 */
async function uploadR2RowsWithReconciliation({ client, plan, intent, upload }) {
  const states = {};
  try {
    for (const row of plan.rows) states[row.name] = await upload(row);
  } catch {
    let failureReceipt;
    try {
      failureReceipt = await ensureR2FailureReceipt(client, plan, intent);
    } catch {
      error("R2 upload failed and its immutable failure receipt could not be persisted");
    }
    error(
      "R2 upload failed; immutable failure receipt " +
        failureReceipt.idempotencyKey +
        " records the exact expected-object cleanup scope and no automatic delete was attempted",
    );
  }
  return states;
}

async function ensureR2UploadIntent(client, plan) {
  const intent = buildR2UploadIntent(plan);
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config($1, $2, true)", [
      "videoforge.account_id",
      plan.scope.account_id,
    ]);
    await client.query(
      `INSERT INTO repository_mutation_receipts (
         workspace_id, idempotency_key, operation, input_hash, result_codec,
         result_payload, result_hash, created_at
       ) VALUES ($1,$2,$3,$4,'repository-result/v1',$5::jsonb,$6,$7)
       ON CONFLICT (workspace_id, idempotency_key) DO NOTHING`,
      [
        plan.scope.workspace_id,
        intent.idempotencyKey,
        intent.operation,
        intent.inputHash,
        JSON.stringify(intent.payload),
        intent.resultHash,
        plan.seedAt,
      ],
    );
    const result = await client.query(
      `SELECT workspace_id::text AS workspace_id, idempotency_key, operation, input_hash,
              result_codec, result_payload, result_hash, created_at
         FROM repository_mutation_receipts
        WHERE workspace_id = $1 AND idempotency_key = $2`,
      [plan.scope.workspace_id, intent.idempotencyKey],
    );
    const row = result.rows[0];
    if (
      !row ||
      row.workspace_id !== plan.scope.workspace_id ||
      row.idempotency_key !== intent.idempotencyKey ||
      row.operation !== intent.operation ||
      row.input_hash !== intent.inputHash ||
      row.result_codec !== "repository-result/v1" ||
      row.result_hash !== intent.resultHash
    )
      error("durable R2 upload intent is not an exact idempotent match");
    exactJson(row.result_payload, intent.payload, "durable R2 upload intent payload");
    exactTime(row.created_at, plan.seedAt, "durable R2 upload intent created_at");
    await client.query("COMMIT");
    return intent;
  } catch (cause) {
    await client.query("ROLLBACK").catch(() => {});
    throw cause;
  }
}

function assertMigrationLedgerRows(rows) {
  if (!Array.isArray(rows) || rows.length !== APPROVED_MIGRATIONS.length)
    error("live render fixture requires the complete 36-entry migration ledger");
  for (const [index, expected] of APPROVED_MIGRATIONS.entries()) {
    const actual = rows[index];
    if (
      !actual ||
      Number(actual.version) !== expected.version ||
      actual.name !== expected.name ||
      actual.filename !== expected.filename ||
      actual.sha256 !== expected.sha256
    )
      error(
        "live migration ledger does not exactly match committed migration " + expected.filename,
      );
  }
  return true;
}

async function pinDatabaseSession(client) {
  await client.query("SET search_path = public, pg_catalog");
  const result = await client.query(
    "SELECT current_database() AS database_name, current_user AS role_name, current_setting('search_path') AS search_path",
  );
  const row = result.rows[0];
  if (
    row?.database_name !== APPROVED_NEON_DATABASE ||
    row.role_name !== APPROVED_NEON_MIGRATION_ROLE ||
    String(row.search_path).replaceAll(" ", "") !== APPROVED_DB_SEARCH_PATH
  )
    error(
      "live Neon session is not pinned to the approved database, migration role, and search path",
    );
}

async function assertMigrationHead(client) {
  const result = await client.query(
    "SELECT version, name, filename, sha256 FROM videoforge_schema_migrations ORDER BY version ASC",
  );
  assertMigrationLedgerRows(result.rows);
}

async function ensureProject(client, plan) {
  await client.query(
    `INSERT INTO projects (
       id, account_id, workspace_id, owner_user_id, name, normalized_name,
       status, version, created_at, updated_at
     ) VALUES ($1,$2,$3,$4,$5,lower($5),'ACTIVE',1,$6,$6)
     ON CONFLICT (id) DO NOTHING`,
    [
      plan.projectId,
      plan.scope.account_id,
      plan.scope.workspace_id,
      plan.scope.user_id,
      PROJECT_NAME,
      plan.seedAt,
    ],
  );
  const result = await client.query(
    `SELECT id::text AS id, account_id::text AS account_id, workspace_id::text AS workspace_id,
            owner_user_id::text AS owner_user_id, name, normalized_name, status, version,
            created_at, updated_at, archived_at
       FROM projects WHERE id = $1`,
    [plan.projectId],
  );
  const row = result.rows[0];
  if (!row) error("owned render fixture project was not persisted");
  if (
    row.account_id !== plan.scope.account_id ||
    row.workspace_id !== plan.scope.workspace_id ||
    row.owner_user_id !== plan.scope.user_id ||
    row.name !== PROJECT_NAME ||
    row.normalized_name !== PROJECT_NAME.toLowerCase() ||
    row.status !== "ACTIVE" ||
    Number(row.version) !== 1 ||
    row.archived_at !== null
  )
    error("existing deterministic render fixture project is not an exact tenant match");
  exactTime(row.created_at, plan.seedAt, "render fixture project created_at");
  exactTime(row.updated_at, plan.seedAt, "render fixture project updated_at");
}

async function ensureAssetRows(client, plan) {
  for (const row of plan.rows) {
    const canonical = row.kind === "CANONICAL_DOCUMENT";
    await client.query(
      `INSERT INTO assets (
         id, account_id, workspace_id, project_id, project_revision_id, kind, state,
         object_key, binary_sha256, canonical_contract_name, canonical_contract_version,
         canonical_document_sha256, content_type, byte_size, width_px, height_px,
         duration_ms, metadata, created_at, verified_at
       ) VALUES ($1,$2,$3,$4,NULL,$5,'VERIFIED',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$17)
       ON CONFLICT (id) DO NOTHING`,
      [
        row.assetId,
        plan.scope.account_id,
        plan.scope.workspace_id,
        plan.projectId,
        row.kind,
        row.objectKey,
        canonical ? null : row.digest,
        canonical ? "resolved-render-manifest" : null,
        canonical ? "v1" : null,
        canonical ? row.digest : null,
        row.contentType,
        row.bytes.length,
        null,
        null,
        row.durationMs,
        JSON.stringify(row.metadata),
        plan.seedAt,
      ],
    );
    const result = await client.query(
      `SELECT id::text AS id, account_id::text AS account_id, workspace_id::text AS workspace_id,
              project_id::text AS project_id, project_revision_id::text AS project_revision_id,
              kind, state, object_key, binary_sha256, canonical_contract_name,
              canonical_contract_version, canonical_document_sha256, content_type,
              byte_size::text AS byte_size, width_px, height_px, duration_ms::text AS duration_ms,
              metadata, created_at, verified_at, archived_at, source_attempt_id::text AS source_attempt_id
         FROM assets WHERE id = $1`,
      [row.assetId],
    );
    const found = result.rows[0];
    if (!found) error(row.name + " asset was not persisted");
    if (
      found.account_id !== plan.scope.account_id ||
      found.workspace_id !== plan.scope.workspace_id ||
      found.project_id !== plan.projectId ||
      ![null, plan.revisionId].includes(found.project_revision_id) ||
      found.kind !== row.kind ||
      found.state !== "VERIFIED" ||
      found.object_key !== row.objectKey ||
      found.content_type !== row.contentType ||
      Number(found.byte_size) !== row.bytes.length ||
      (canonical ? found.binary_sha256 !== null : found.binary_sha256 !== row.digest) ||
      (canonical
        ? found.canonical_document_sha256 !== row.digest
        : found.canonical_document_sha256 !== null) ||
      Number(found.duration_ms ?? 0) !== Number(row.durationMs ?? 0) ||
      found.width_px !== null ||
      found.height_px !== null ||
      found.archived_at !== null ||
      found.source_attempt_id !== null
    )
      error(row.name + " asset is not an exact tenant-owned VERIFIED match");
    exactJson(found.metadata, row.metadata, row.name + " asset metadata");
    exactTime(found.created_at, plan.seedAt, row.name + " asset created_at");
    exactTime(found.verified_at, plan.seedAt, row.name + " asset verified_at");
  }
}

async function bindAssetRowsToRevision(client, plan) {
  for (const row of plan.rows) {
    await client.query(
      `UPDATE assets
          SET project_revision_id = $2
        WHERE id = $1 AND account_id = $3 AND workspace_id = $4
          AND project_id = $5 AND project_revision_id IS NULL`,
      [
        row.assetId,
        plan.revisionId,
        plan.scope.account_id,
        plan.scope.workspace_id,
        plan.projectId,
      ],
    );
    const result = await client.query(
      `SELECT project_revision_id::text AS project_revision_id
         FROM assets
        WHERE id = $1 AND account_id = $2 AND workspace_id = $3`,
      [row.assetId, plan.scope.account_id, plan.scope.workspace_id],
    );
    if (result.rows[0]?.project_revision_id !== plan.revisionId)
      error(row.name + " asset is not bound to the exact locked revision");
  }
}

async function ensureRevision(client, plan, preset) {
  const base = plan.revisionConfigBase;
  await client.query(
    `INSERT INTO project_revisions (
       id, account_id, workspace_id, project_id, revision_number, status, title,
       voiceover_asset_id, voiceover_binary_sha256,
       avatar_profile_id, avatar_profile_version_id, avatar_profile_hash,
       avatar_runtime_source_asset_id, avatar_runtime_source_binary_sha256,
       avatar_source_preparation_profile, avatar_source_validation_profile,
       avatar_compatibility_state, avatar_compatibility_assessment_id,
       avatar_compatibility_evidence_hash, image_style_id, image_style_version_id,
       style_profile_hash, extra_prompt_keywords, apply_extra_prompt_keywords,
       generation_mode, maximum_cost_micro_usd, currency, seed,
       revision_config_contract_name, revision_config_contract_version,
       revision_config_payload, revision_config_hash, created_by_user_id,
       created_at, locked_at
     ) VALUES ($1,$2,$3,$4,1,'LOCKED',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
               'UNTESTED',NULL,NULL,$15,$16,$17,$18,$19,'LOWEST_COST',$20,'USD',$21,
               $22,$23,$24::jsonb,$25,$26,$27,$27)
     ON CONFLICT (id) DO NOTHING`,
    [
      plan.revisionId,
      plan.scope.account_id,
      plan.scope.workspace_id,
      plan.projectId,
      base.title,
      base.voiceover_asset_id,
      base.voiceover_binary_sha256,
      preset.avatarProfileId,
      preset.avatarVersionId,
      preset.avatarProfileHash,
      preset.runtimeAssetId,
      preset.runtimeAssetSha256,
      preset.sourcePreparationProfile,
      preset.sourceValidationProfile,
      preset.styleId,
      preset.styleVersionId,
      preset.styleProfileHash,
      base.extra_prompt_keywords,
      base.apply_extra_prompt_keywords,
      base.maximum_cost_micro_usd,
      base.seed,
      base.revision_config_contract_name,
      base.revision_config_contract_version,
      JSON.stringify(base),
      plan.revisionConfigHash,
      plan.scope.user_id,
      plan.seedAt,
    ],
  );
  const result = await client.query(
    `SELECT id::text AS id, account_id::text AS account_id, workspace_id::text AS workspace_id,
            project_id::text AS project_id, revision_number, status, title,
            voiceover_asset_id::text AS voiceover_asset_id,
            voiceover_binary_sha256, avatar_profile_id::text AS avatar_profile_id,
            avatar_profile_version_id::text AS avatar_profile_version_id,
            avatar_profile_hash, avatar_runtime_source_asset_id::text AS runtime_asset_id,
            avatar_runtime_source_binary_sha256, avatar_source_preparation_profile,
            avatar_source_validation_profile, avatar_compatibility_state,
            avatar_compatibility_assessment_id::text AS avatar_compatibility_assessment_id,
            avatar_compatibility_evidence_hash, image_style_id::text AS image_style_id,
            image_style_version_id::text AS image_style_version_id, style_profile_hash,
            extra_prompt_keywords, apply_extra_prompt_keywords, generation_mode,
            maximum_cost_micro_usd, currency, seed, revision_config_contract_name,
            revision_config_contract_version, revision_config_payload, revision_config_hash,
            created_by_user_id::text AS created_by_user_id,
            created_at, locked_at
       FROM project_revisions WHERE id = $1`,
    [plan.revisionId],
  );
  const row = result.rows[0];
  if (!row) error("owned render fixture revision was not persisted");
  if (
    row.account_id !== plan.scope.account_id ||
    row.workspace_id !== plan.scope.workspace_id ||
    row.project_id !== plan.projectId ||
    Number(row.revision_number) !== 1 ||
    row.status !== "LOCKED" ||
    row.title !== base.title ||
    row.voiceover_asset_id !== base.voiceover_asset_id ||
    row.voiceover_binary_sha256 !== base.voiceover_binary_sha256 ||
    row.avatar_profile_id !== preset.avatarProfileId ||
    row.avatar_profile_version_id !== preset.avatarVersionId ||
    row.avatar_profile_hash !== preset.avatarProfileHash ||
    row.runtime_asset_id !== preset.runtimeAssetId ||
    row.avatar_runtime_source_binary_sha256 !== preset.runtimeAssetSha256 ||
    row.avatar_source_preparation_profile !== preset.sourcePreparationProfile ||
    row.avatar_source_validation_profile !== preset.sourceValidationProfile ||
    row.avatar_compatibility_state !== "UNTESTED" ||
    row.avatar_compatibility_assessment_id !== null ||
    row.avatar_compatibility_evidence_hash !== null ||
    row.image_style_id !== preset.styleId ||
    row.image_style_version_id !== preset.styleVersionId ||
    row.style_profile_hash !== preset.styleProfileHash ||
    row.extra_prompt_keywords !== base.extra_prompt_keywords ||
    row.apply_extra_prompt_keywords !== base.apply_extra_prompt_keywords ||
    row.generation_mode !== "LOWEST_COST" ||
    Number(row.maximum_cost_micro_usd) !== 100_000 ||
    row.currency !== "USD" ||
    Number(row.seed) !== Number(base.seed) ||
    row.revision_config_contract_name !== base.revision_config_contract_name ||
    row.revision_config_contract_version !== base.revision_config_contract_version ||
    row.revision_config_hash !== plan.revisionConfigHash ||
    row.created_by_user_id !== plan.scope.user_id
  )
    error("existing deterministic render fixture revision is not an exact locked match");
  exactJson(row.revision_config_payload, base, "revision_config_payload");
  exactTime(row.created_at, plan.seedAt, "render fixture revision created_at");
  exactTime(row.locked_at, plan.seedAt, "render fixture revision locked_at");
}

function artifactProbe(plan, row) {
  return {
    schema_version: "videoforge-owned-render-fixture-receipt/v1",
    fixture_id: FIXTURE_ID,
    fixture_non_production: true,
    role: row.name,
    content_type: row.contentType,
    content_length: row.bytes.length,
    checksum_sha256: row.digest,
    project_id: plan.projectId,
    project_revision_id: plan.revisionId,
  };
}

async function ensureArtifactRows(client, plan) {
  const expiresAt = new Date(Date.parse(plan.seedAt) + 7 * 24 * 60 * 60 * 1000).toISOString();
  for (const row of plan.rows) {
    const callbackId = `${OPERATION}-${plan.scope.account_id.slice(0, 12)}-${row.name}`;
    const probe = artifactProbe(plan, row);
    const receiptSha = canonicalHash({
      schema_version: "videoforge-owned-render-fixture-receipt/v1",
      reservation_id: row.reservationId,
      receipt_id: row.receiptId,
      callback_id: callbackId,
      account_id: plan.scope.account_id,
      workspace_id: plan.scope.workspace_id,
      project_id: plan.projectId,
      project_revision_id: plan.revisionId,
      object_key: row.objectKey,
      content_type: row.contentType,
      content_length: row.bytes.length,
      checksum_sha256: row.digest,
      probe,
      committed_at: plan.seedAt,
    });
    await client.query(
      `INSERT INTO artifact_reservations (
         id, account_id, workspace_id, project_id, project_revision_id, asset_id,
         lane, job_id, artifact_id, object_key, method, content_type, content_length,
         checksum_sha256, expires_at, max_uses, used_count, state, retention_class,
         retain_until, deletion_owner_account_id, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,'INPUT',$7,$8,$9,'PUT',$10,$11,$12,$13,1,0,'ISSUED',
                 'PROJECT',NULL,$2,$14,$14)
       ON CONFLICT (id) DO NOTHING`,
      [
        row.reservationId,
        plan.scope.account_id,
        plan.scope.workspace_id,
        plan.projectId,
        plan.revisionId,
        row.assetId,
        row.jobId ?? plan.jobId,
        row.name,
        row.objectKey,
        row.contentType,
        row.bytes.length,
        row.digest,
        expiresAt,
        plan.seedAt,
      ],
    );
    await client.query(
      `INSERT INTO artifact_receipts (
         id, account_id, workspace_id, reservation_id, callback_id, object_key,
         content_type, content_length, checksum_sha256, probe, receipt_sha256, committed_at, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$12)
       ON CONFLICT (id) DO NOTHING`,
      [
        row.receiptId,
        plan.scope.account_id,
        plan.scope.workspace_id,
        row.reservationId,
        callbackId,
        row.objectKey,
        row.contentType,
        row.bytes.length,
        row.digest,
        JSON.stringify(probe),
        receiptSha,
        plan.seedAt,
      ],
    );
    await client.query(
      `UPDATE artifact_reservations
          SET state = 'COMMITTED', used_count = 1, updated_at = $2
        WHERE id = $1 AND state = 'ISSUED'`,
      [row.reservationId, plan.seedAt],
    );
    const result = await client.query(
      `SELECT reservation.account_id::text AS account_id,
              reservation.workspace_id::text AS workspace_id,
              reservation.project_id::text AS project_id,
              reservation.project_revision_id::text AS project_revision_id,
              reservation.asset_id::text AS asset_id, reservation.lane,
              reservation.job_id, reservation.artifact_id, reservation.object_key,
              reservation.method, reservation.content_type,
              reservation.content_length::text AS content_length,
              reservation.checksum_sha256, reservation.state, reservation.used_count,
              reservation.expires_at, reservation.max_uses, reservation.retention_class,
              reservation.retain_until, reservation.deletion_owner_account_id::text AS deletion_owner_account_id,
              reservation.created_at AS reservation_created_at, reservation.updated_at AS reservation_updated_at,
              receipt.id::text AS receipt_id, receipt.callback_id,
              receipt.content_type AS receipt_content_type, receipt.content_length AS receipt_content_length,
              receipt.checksum_sha256 AS receipt_checksum_sha256, receipt.receipt_sha256, receipt.probe,
              receipt.committed_at, receipt.created_at AS receipt_created_at, receipt.deleted_at,
              receipt.deletion_reason
         FROM artifact_reservations AS reservation
         JOIN artifact_receipts AS receipt
           ON receipt.account_id = reservation.account_id
          AND receipt.workspace_id = reservation.workspace_id
          AND receipt.reservation_id = reservation.id
        WHERE reservation.id = $1`,
      [row.reservationId],
    );
    const found = result.rows[0];
    if (
      !found ||
      found.account_id !== plan.scope.account_id ||
      found.workspace_id !== plan.scope.workspace_id ||
      found.project_id !== plan.projectId ||
      found.project_revision_id !== plan.revisionId ||
      found.asset_id !== row.assetId ||
      found.lane !== "INPUT" ||
      found.job_id !== plan.jobId ||
      found.artifact_id !== row.name ||
      found.object_key !== row.objectKey ||
      found.method !== "PUT" ||
      found.content_type !== row.contentType ||
      Number(found.content_length) !== row.bytes.length ||
      found.checksum_sha256 !== row.digest ||
      found.state !== "COMMITTED" ||
      Number(found.used_count) !== 1 ||
      found.receipt_id !== row.receiptId ||
      found.callback_id !== callbackId ||
      found.receipt_sha256 !== receiptSha ||
      found.receipt_content_type !== row.contentType ||
      Number(found.receipt_content_length) !== row.bytes.length ||
      found.receipt_checksum_sha256 !== row.digest ||
      Number(found.max_uses) !== 1 ||
      found.retention_class !== "PROJECT" ||
      found.retain_until !== null ||
      found.deletion_owner_account_id !== plan.scope.account_id ||
      found.deleted_at !== null ||
      found.deletion_reason !== null
    )
      error(row.name + " reservation/receipt is not an exact committed match");
    exactJson(found.probe, probe, row.name + " artifact probe");
    exactTime(found.expires_at, expiresAt, row.name + " reservation expires_at");
    exactTime(found.reservation_created_at, plan.seedAt, row.name + " reservation created_at");
    exactTime(found.reservation_updated_at, plan.seedAt, row.name + " reservation updated_at");
    exactTime(found.committed_at, plan.seedAt, row.name + " receipt committed_at");
    exactTime(found.receipt_created_at, plan.seedAt, row.name + " receipt created_at");
  }
}

async function ensureRenderPlan(client, plan) {
  await client.query(
    `INSERT INTO hosted_render_plans (
       account_id, workspace_id, project_id, project_revision_id,
       schema_version, payload, payload_sha256, created_at, updated_at
     ) VALUES ($1,$2,$3,$4,'videoforge-hosted-cpu-submission/v1',$5::jsonb,$6,$7,$7)
     ON CONFLICT (account_id, workspace_id, project_id, project_revision_id) DO NOTHING`,
    [
      plan.scope.account_id,
      plan.scope.workspace_id,
      plan.projectId,
      plan.revisionId,
      JSON.stringify(plan.submission),
      plan.renderPlanPayloadHash,
      plan.seedAt,
    ],
  );
  const result = await client.query(
    `SELECT account_id::text AS account_id, workspace_id::text AS workspace_id,
            project_id::text AS project_id, project_revision_id::text AS project_revision_id,
            schema_version, payload, payload_sha256, created_at, updated_at
       FROM hosted_render_plans
      WHERE account_id = $1 AND workspace_id = $2 AND project_id = $3
        AND project_revision_id = $4`,
    [plan.scope.account_id, plan.scope.workspace_id, plan.projectId, plan.revisionId],
  );
  const row = result.rows[0];
  if (
    !row ||
    row.account_id !== plan.scope.account_id ||
    row.workspace_id !== plan.scope.workspace_id ||
    row.project_id !== plan.projectId ||
    row.project_revision_id !== plan.revisionId ||
    row.schema_version !== "videoforge-hosted-cpu-submission/v1" ||
    row.payload_sha256 !== plan.renderPlanPayloadHash
  )
    error("hosted render plan is not an exact immutable match");
  exactJson(row.payload, plan.submission, "hosted render plan payload");
  exactTime(row.created_at, plan.seedAt, "hosted render plan created_at");
  exactTime(row.updated_at, plan.seedAt, "hosted render plan updated_at");
}

async function ensureAuditRow(client, plan) {
  const inputPayload = {
    schema_version: "videoforge-owned-render-fixture-provision-input/v1",
    fixture_id: FIXTURE_ID,
    tenant_email: plan.scope.email,
    account_id: plan.scope.account_id,
    workspace_id: plan.scope.workspace_id,
    source_render_input_sha256: plan.sourceRenderInputSha256,
    source_evidence_sha256: plan.sourceEvidenceSha256,
    project_id: plan.projectId,
    revision_id: plan.revisionId,
    revision_config_hash: plan.revisionConfigHash,
    manifest_sha256: plan.manifestSha,
    render_plan_payload_sha256: plan.renderPlanPayloadHash,
    authority: plan.authority,
    r2_budget: plan.r2Budget,
    r2_upload_intent_idempotency_key: plan.r2UploadIntent?.idempotencyKey ?? null,
    seed_at: plan.seedAt,
  };
  const resultPayload = {
    schema_version: "videoforge-owned-render-fixture-provision-result/v1",
    fixture_id: FIXTURE_ID,
    fixture_non_production: true,
    tenant_email: plan.scope.email,
    account_id: plan.scope.account_id,
    workspace_id: plan.scope.workspace_id,
    project_id: plan.projectId,
    revision_id: plan.revisionId,
    render_attempt_id: plan.renderAttemptId,
    job_id: plan.jobId,
    revision_config_hash: plan.revisionConfigHash,
    manifest_sha256: plan.manifestSha,
    render_plan_payload_sha256: plan.renderPlanPayloadHash,
    authority: plan.authority,
    r2_budget: plan.r2Budget,
    r2_upload_intent_idempotency_key: plan.r2UploadIntent?.idempotencyKey ?? null,
    r2_objects: plan.rows.map((row) => ({
      role: row.name,
      object_key: row.objectKey,
      sha256: row.digest,
      content_type: row.contentType,
      bytes: row.bytes.length,
      state: "VERIFIED_EXACT",
    })),
    asr_submission: plan.asrSubmission,
    render_submission: plan.submission,
    seed_at: plan.seedAt,
  };
  const inputHash = canonicalHash(inputPayload);
  const resultHash = canonicalHash(resultPayload);
  const idempotencyKey = `${OPERATION}-${plan.scope.account_id}`;
  await client.query(
    `INSERT INTO repository_mutation_receipts (
       workspace_id, idempotency_key, operation, input_hash, result_codec,
       result_payload, result_hash, created_at
     ) VALUES ($1,$2,'v2_06_owned_render_fixture_provision',$3,'repository-result/v1',$4::jsonb,$5,$6)
     ON CONFLICT (workspace_id, idempotency_key) DO NOTHING`,
    [
      plan.scope.workspace_id,
      idempotencyKey,
      inputHash,
      JSON.stringify(resultPayload),
      resultHash,
      plan.seedAt,
    ],
  );
  const result = await client.query(
    `SELECT workspace_id::text AS workspace_id, idempotency_key, operation, input_hash,
            result_codec, result_payload, result_hash, created_at
       FROM repository_mutation_receipts
      WHERE workspace_id = $1 AND idempotency_key = $2`,
    [plan.scope.workspace_id, idempotencyKey],
  );
  const row = result.rows[0];
  if (
    !row ||
    row.workspace_id !== plan.scope.workspace_id ||
    row.idempotency_key !== idempotencyKey ||
    row.operation !== "v2_06_owned_render_fixture_provision" ||
    row.input_hash !== inputHash ||
    row.result_codec !== "repository-result/v1" ||
    row.result_hash !== resultHash
  )
    error("owned render fixture mutation receipt is not an exact idempotent match");
  exactJson(row.result_payload, resultPayload, "owned render fixture mutation receipt payload");
  exactTime(row.created_at, plan.seedAt, "owned render fixture mutation receipt created_at");
  return { idempotencyKey, inputHash, resultHash, resultPayload };
}

async function main(argv = process.argv.slice(2)) {
  const args = Object.fromEntries(
    argv.flatMap((item, index, all) =>
      item === "--dry-run"
        ? [["dryRun", true]]
        : item === "--verify-local"
          ? [["verifyLocal", true]]
          : item.startsWith("--")
            ? [[item.slice(2).replaceAll("-", "_"), all[index + 1]]]
            : [],
    ),
  );
  if (argv.includes("--help")) {
    console.log(
      "V2-06 owned render fixture; default dry-run. Live requires V2_06_RENDER_FIXTURE_CONFIRM=YES, V2_06_RENDER_FIXTURE_R2_CONFIRM=YES, and V2_06_RENDER_FIXTURE_DB_CONFIRM=YES. Tenant email is limited to the two admitted Google identities. No delete/GPU/provider-generation path exists.",
    );
    return;
  }
  const email = String(args.tenant_email ?? process.env.V2_06_TENANT_EMAIL ?? "")
    .trim()
    .toLowerCase();
  if (!ALLOWED_EMAILS.has(email))
    error("V2_06_TENANT_EMAIL is not one of the two admitted identities");
  const seedAt = String(args.seed_at ?? process.env.V2_06_SEED_AT ?? "");
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?Z$/u.test(seedAt))
    error("V2_06_SEED_AT must be RFC3339 UTC");
  const root = SOURCE_ROOT;
  const fixture = await verifyLocalFixture(root, SOURCE_ATTEMPT);
  const live = process.env.V2_06_RENDER_FIXTURE_CONFIRM === "YES" && !args.dryRun;
  if (args.verifyLocal || live) runCanonicalLocalPath();
  if (!live) {
    const plan = planFixture(fixture, dryScope(email), seedAt);
    console.log("V2-06 owned render fixture plan validated.");
    console.log("tenant_email=" + email);
    console.log("fixture_id=" + FIXTURE_ID);
    console.log("render_input_schema=render-job-input/v1");
    console.log("render_input_assets=" + plan.renderInput.assets.length);
    console.log("r2_objects=" + plan.rows.length);
    console.log("revision_config_hash=" + plan.revisionConfigHash);
    console.log("manifest_sha256=" + plan.manifestSha);
    console.log("asr_submission=EMITTED_IN_LIVE_AUDIT_RECEIPT");
    console.log("database_mutation=SKIPPED_DRY_RUN");
    console.log("r2_mutation=SKIPPED_DRY_RUN");
    return;
  }
  if (process.env.V2_06_RENDER_FIXTURE_R2_CONFIRM !== "YES") error("R2 confirmation is missing");
  if (process.env.V2_06_RENDER_FIXTURE_DB_CONFIRM !== "YES") error("Neon confirmation is missing");
  const useProtectedPgService = process.env.V2_06_RENDER_FIXTURE_USE_PG_SERVICE === "YES";
  const useWranglerR2 = process.env.V2_06_RENDER_FIXTURE_USE_WRANGLER === "YES";
  const databaseUrl = process.env.V2_06_MIGRATION_DATABASE_URL;
  const r2Config = {
    accountId: process.env.V2_06_R2_ACCOUNT_ID,
    bucket: process.env.V2_06_R2_BUCKET,
    accessKeyId: process.env.V2_06_R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.V2_06_R2_SECRET_ACCESS_KEY,
    region: process.env.V2_06_R2_REGION ?? APPROVED_R2_REGION,
  };
  for (const [value, name] of [
    [r2Config.accountId, "V2_06_R2_ACCOUNT_ID"],
    [r2Config.bucket, "V2_06_R2_BUCKET"],
    ...(!useProtectedPgService ? [[databaseUrl, "V2_06_MIGRATION_DATABASE_URL"]] : []),
    ...(!useWranglerR2
      ? [
          [r2Config.accessKeyId, "V2_06_R2_ACCESS_KEY_ID"],
          [r2Config.secretAccessKey, "V2_06_R2_SECRET_ACCESS_KEY"],
        ]
      : []),
  ]) {
    if (typeof value !== "string" || value.length === 0)
      error(name + " is required for live mutation");
  }
  if (useProtectedPgService) {
    if (
      process.env.PGHOST !== APPROVED_NEON_HOST ||
      process.env.PGDATABASE !== APPROVED_NEON_DATABASE ||
      process.env.PGUSER !== APPROVED_NEON_MIGRATION_ROLE ||
      process.env.PGSSLMODE !== APPROVED_NEON_SSLMODE ||
      typeof process.env.PGPASSFILE !== "string" ||
      process.env.PGPASSFILE.length === 0
    )
      error("protected PostgreSQL environment is not the approved owner service");
    if (
      r2Config.accountId !== APPROVED_R2_ACCOUNT_ID ||
      r2Config.bucket !== APPROVED_R2_BUCKET ||
      r2Config.region !== APPROVED_R2_REGION
    )
      error("R2 config is not the approved V2-06 account/bucket/region");
  } else {
    assertProviderConfig(databaseUrl, r2Config);
  }
  const { Pool } = useProtectedPgService
    ? requireControlPlane("pg")
    : requireWeb(FUTURE_NEON_DRIVER);
  const pool = new Pool({
    ...(useProtectedPgService ? {} : { connectionString: databaseUrl }),
    max: 1,
    application_name: "videoforge-v2-06-owned-render-fixture",
    ...(useProtectedPgService ? {} : { options: "-c search_path=public,pg_catalog" }),
  });
  let client;
  try {
    client = await pool.connect();
    await pinDatabaseSession(client);
    const scope = await resolveScope(client, email);
    const preset = await resolvePresetRows(client, scope);
    const plan = planFixture(fixture, scope, seedAt, preset);
    plan.sourceRenderInputSha256 = fixture.inputHash;
    plan.sourceEvidenceSha256 = fixture.evidenceHash;
    plan.r2UploadIntent = await ensureR2UploadIntent(client, plan);
    const r2 = useWranglerR2 ? null : makeR2(r2Config);
    const r2States = await uploadR2RowsWithReconciliation({
      client,
      plan,
      intent: plan.r2UploadIntent,
      upload: (row) => (useWranglerR2 ? ensureWranglerR2(row) : ensureR2(r2, r2Config, row)),
    });

    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config($1, $2, true)", [
        "videoforge.account_id",
        scope.account_id,
      ]);
      await assertMigrationHead(client);
      const scopedAgain = await resolveScope(client, email);
      exactJson(scopedAgain, scope, "resolved tenant scope");
      const presetAgain = await resolvePresetRows(client, scope);
      exactJson(presetAgain, preset, "resolved activation preset");
      await ensureProject(client, plan);
      await ensureAssetRows(client, plan);
      await ensureRevision(client, plan, preset);
      await bindAssetRowsToRevision(client, plan);
      await ensureArtifactRows(client, plan);
      await ensureRenderPlan(client, plan);
      const audit = await ensureAuditRow(client, plan);
      await client.query("COMMIT");
      console.log(
        JSON.stringify(
          {
            mutation: "COMMITTED",
            tenant_email: email,
            account_id: scope.account_id,
            workspace_id: scope.workspace_id,
            project_id: plan.projectId,
            project_revision_id: plan.revisionId,
            revision_config_hash: plan.revisionConfigHash,
            manifest_sha256: plan.manifestSha,
            render_plan_payload_sha256: plan.renderPlanPayloadHash,
            r2_objects: r2States,
            r2_budget: plan.r2Budget,
            authority: plan.authority,
            r2_upload_intent: plan.r2UploadIntent,
            asr_submission: plan.asrSubmission,
            render_submission: plan.submission,
            audit,
            spend_usd: 0,
            gpu_transport: "DISABLED_FAKE_ONLY",
          },
          null,
          2,
        ),
      );
    } catch (cause) {
      await client.query("ROLLBACK").catch(() => {});
      error(
        "database transaction failed; verified R2 objects were intentionally left in place for audit and no delete was attempted (" +
          (cause instanceof Error ? cause.message : "unknown database error") +
          ")",
      );
    } finally {
      client.release();
      client = undefined;
    }
  } finally {
    if (client) client.release();
    await pool.end();
  }
}

function buildAsrSubmission(fixture, scope, seedAt, preset = null) {
  return planFixture(fixture, scope, seedAt, preset).asrSubmission;
}

export {
  ALLOWED_EMAILS,
  APPROVED_MIGRATIONS,
  APPROVED_NEON_DATABASE,
  APPROVED_NEON_MIGRATION_ROLE,
  APPROVED_GOOGLE_PROVIDER,
  AUTHORITY_METADATA,
  MAX_R2_OBJECT_COUNT,
  MAX_R2_OBJECT_BYTES,
  MAX_R2_AGGREGATE_BYTES,
  canonical,
  canonicalHash,
  uuid as deterministicUuid,
  assertApprovedSourceLocation,
  assertMigrationLedgerRows,
  assertR2PlanCaps,
  assertProviderConfig,
  buildR2UploadIntent,
  buildR2FailureReceipt,
  buildAsrSubmission,
  ensureR2,
  ensureR2FailureReceipt,
  uploadR2RowsWithReconciliation,
  planFixture,
  r2Request,
  validateRenderInput,
  verifyLocalFixture,
};

if (
  import.meta.url === "file://" + process.argv[1] ||
  process.argv[1]?.endsWith("provision-owned-render-fixture.mjs")
)
  main().catch((cause) => {
    console.error(cause instanceof Error ? cause.message : "unknown error");
    process.exitCode = 1;
  });

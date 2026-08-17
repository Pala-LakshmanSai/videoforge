#!/usr/bin/env node

/*
 * V2-06 owned-render fixture provisioner.
 *
 * The default path is provider-free dry-run. This file currently plans (but never persists) the
 * tenant/project/revision/assets/reservations/receipts/audit lineage. Live mode is intentionally
 * fail-closed until the DB/R2 compensation and revision-hash contract are separately approved.
 * There is deliberately no delete, repair, GPU, or provider-generation path. A future live path
 * must load "@neondatabase/serverless" through the apps/web dependency root and use aws4fetch
 * SigV4 for R2; this safe slice opens neither provider.
 */

import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const requireWeb = createRequire(path.join(ROOT, "apps/web/package.json"));
// Required future-live identifiers are kept explicit for the validator; no provider is opened here.
const FUTURE_NEON_DRIVER = "@neondatabase/serverless";
const FUTURE_R2_ACCOUNT_ENV = "R2_ACCOUNT_ID";
const SOURCE_ROOT = path.join(ROOT, "artifacts/local-media");
const SOURCE_ATTEMPT = "attempt_render_local_004";
const BUCKET = "videoforge-v2-06-staging-private";
const FIXTURE_ID = "local_short_slice_owned_001";
const OPERATION = "v2-06-owned-render-fixture";
const ALLOWED_EMAILS = new Set(["lakshmansai121@gmail.com", "demo9gss@gmail.com"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
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
  const inputHash = sha256(await readFile(inputFile));
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
  const output = await exactBytes(
    root,
    evidence.output.artifact_uri,
    evidence.output.sha256,
    "local output",
  );
  if (Number(evidence.output.bytes) !== output.bytes.length)
    error("local output byte count drifted");
  return { root, input, evidence, assets, manifest, manifestBytes, output };
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

function planFixture(fixture, scope, seedAt) {
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
    title: "V2-06 Owned Render Fixture",
    voiceover_asset_id: voiceover.assetId,
    voiceover_sha256: voiceover.digest,
    generation_mode: "LOWEST_COST",
    maximum_cost_micro_usd: 0,
    currency: "USD",
    gpu_transport: "DISABLED_FAKE_ONLY",
    execution_backend: "PERSONAL_WORKER",
    fixture_provenance: FIXTURE_ID,
  };
  // Preview only: the hosted submission below is derived from the manifest and therefore cannot
  // be added to this hash without creating a circular manifest -> revision-hash dependency. The
  // fail-closed live boundary must settle this contract before any DB row or R2 object is written.
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
  const payload = { ...base, hosted_render_submission: submission };
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
    revisionConfigHash,
    revisionConfigBase: base,
    revisionConfigPayload: payload,
    rewrittenManifest,
    manifestBytes,
    manifestSha,
    renderInput,
    submission,
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

async function ensureR2(client, config, row) {
  const url = r2Url(config, row.objectKey);
  const existing = await client.fetch(url, { method: "GET" });
  if (existing.ok) {
    const bytes = Buffer.from(await existing.arrayBuffer());
    if (sha256(bytes) !== row.digest || bytes.length !== row.bytes.length)
      error("R2 object " + row.name + " differs from exact fixture bytes");
    return "REUSED_EXACT";
  }
  if (existing.status !== 404)
    error("R2 preflight for " + row.name + " returned HTTP " + existing.status);
  const uploaded = await client.fetch(url, {
    method: "PUT",
    headers: {
      "content-type": row.contentType,
      "content-length": String(row.bytes.length),
      "x-amz-checksum-sha256": checksumHeader(row.digest),
    },
    body: row.bytes,
    aws: { allHeaders: true },
  });
  if (!uploaded.ok) error("R2 upload for " + row.name + " returned HTTP " + uploaded.status);
  const checked = await client.fetch(url, { method: "GET" });
  if (!checked.ok)
    error("R2 post-upload verification for " + row.name + " returned HTTP " + checked.status);
  const bytes = Buffer.from(await checked.arrayBuffer());
  if (sha256(bytes) !== row.digest || bytes.length !== row.bytes.length)
    error("R2 post-upload verification failed for " + row.name);
  return "UPLOADED_VERIFIED";
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
  const root = path.resolve(
    String(args.source_root ?? process.env.V2_06_SOURCE_ROOT ?? SOURCE_ROOT),
  );
  const fixture = await verifyLocalFixture(
    root,
    String(args.source_attempt ?? process.env.V2_06_SOURCE_ATTEMPT ?? SOURCE_ATTEMPT),
  );
  const live = process.env.V2_06_RENDER_FIXTURE_CONFIRM === "YES" && !args.dryRun;
  if (args.verifyLocal || live) runCanonicalLocalPath();
  const plan = planFixture(fixture, dryScope(email), seedAt);
  if (!live) {
    console.log("V2-06 owned render fixture plan validated.");
    console.log("tenant_email=" + email);
    console.log("fixture_id=" + FIXTURE_ID);
    console.log("render_input_schema=render-job-input/v1");
    console.log("render_input_assets=" + plan.renderInput.assets.length);
    console.log("r2_objects=" + plan.rows.length);
    console.log("revision_config_hash=" + plan.revisionConfigHash);
    console.log("manifest_sha256=" + plan.manifestSha);
    console.log("database_mutation=SKIPPED_DRY_RUN");
    console.log("r2_mutation=SKIPPED_DRY_RUN");
    return;
  }
  if (process.env.V2_06_RENDER_FIXTURE_R2_CONFIRM !== "YES") error("R2 confirmation is missing");
  if (process.env.V2_06_RENDER_FIXTURE_DB_CONFIRM !== "YES") error("Neon confirmation is missing");
  /* Live DB/R2 mutation is intentionally a separate follow-up implementation after the safe
     provider-free plan is reviewed. This guard prevents an untested cross-provider partial path. */
  error("live mutation is fail-closed until the exact DB/R2 compensation runbook is approved");
}

export {
  ALLOWED_EMAILS,
  canonical,
  canonicalHash,
  uuid as deterministicUuid,
  planFixture,
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

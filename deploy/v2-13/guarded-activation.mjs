#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateServiceFile } from "../v2-06/validate-pg-service.mjs";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const CONFIRMATION = "EXECUTE_EXACT_GUARDED_V2_13_ACTIVATION";
const SECRET_NAMES = Object.freeze([
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "WORKFLOW_CALLBACK_SECRET",
  "MEDIA_WORKER_TOKEN_SECRET",
  "VIDEOFORGE_RECONCILER_DATABASE_URL",
  "VIDEOFORGE_DISPATCH_TOKEN_KEY",
  "VIDEOFORGE_DISPATCH_TOKEN_KEY_ID",
  "VIDEOFORGE_ENVELOPE_SIGNING_KEY_HEX",
  "VIDEOFORGE_ENVELOPE_SIGNING_KEY_ID",
  "VIDEOFORGE_PROVIDER_PROOF_VERIFY_KEY",
  "VIDEOFORGE_PROVIDER_PROOF_KEY_ID",
  "RUNPOD_API_KEY",
  "RUNPOD_API_BASE_URL",
  "VIDEOFORGE_MAGE_ENDPOINT_ID",
  "VIDEOFORGE_MAGE_ENDPOINT_ID_SHA256",
  "VIDEOFORGE_SOULX_ENDPOINT_ID",
  "VIDEOFORGE_SOULX_ENDPOINT_ID_SHA256",
]);
const HASH = /^sha256:[0-9a-f]{64}$/u;
const ROLE = /^[a-z_][a-z0-9_]{0,62}$/u;
const SOULX_APPROVAL_SHA256 =
  "sha256:c3aae03da3f0134e12c2f432951189bd205dcbb7ab26a65d44061cec82984c45";
const SOULX_CANDIDATE_SHA256 =
  "sha256:f6c8dd219c07a26ab67fb13d8dbc103e110b4c045307f8c3e0c70aa3d805d442";
const SOULX_FULL_SHA256 = "sha256:da31d87c2389769272733ff50a9114d4507a36aced1ebe48480c9ccf486de241";
const SOULX_SPLIT_SHA256 =
  "sha256:f0b02351e38e2e8570e4e586b314da30813bb0a0eb09a567912bba9725b74993";
const fail = (message) => {
  throw new Error(`V2-13 guarded activation: ${message}`);
};
const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const exactKeys = (value, names) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...names].sort());

function safeEnvironment(extra = {}) {
  const environment = {};
  for (const name of [
    "CI",
    "HOME",
    "LANG",
    "LC_ALL",
    "LOGNAME",
    "NO_COLOR",
    "PATH",
    "SHELL",
    "TERM",
    "TMPDIR",
    "USER",
  ]) {
    if (process.env[name] !== undefined) environment[name] = process.env[name];
  }
  return { ...environment, WRANGLER_SEND_METRICS: "false", ...extra };
}

function mode(path, type, permissions, label) {
  const metadata = lstatSync(path);
  if (
    metadata.isSymbolicLink() ||
    (type === "file" ? !metadata.isFile() : !metadata.isDirectory()) ||
    (metadata.mode & 0o777) !== permissions
  )
    fail(`${label} must be a regular mode-${permissions.toString(8)} ${type}`);
}

function run(command, args, { env = safeEnvironment(), input, capture = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env,
    input,
    encoding: "utf8",
    shell: false,
    stdio: capture
      ? [input === undefined ? "ignore" : "pipe", "pipe", "pipe"]
      : [input === undefined ? "ignore" : "pipe", "ignore", "ignore"],
  });
  if (result.error || result.status !== 0) fail(`${command} failed with redacted output`);
  return capture ? result.stdout.trim() : "";
}

function git(...args) {
  return run("git", args, { capture: true });
}

function validateAuthority(value) {
  if (
    !exactKeys(value, [
      "authority",
      "checkpoint",
      "cloudflare",
      "database",
      "gates",
      "release",
      "schema_version",
      "secret_sha256",
      "soulx_crop_approval",
    ]) ||
    value.schema_version !== "videoforge-v2-13-guarded-activation/v1" ||
    value.checkpoint !== "V2-13"
  )
    fail("activation record is not the exact V2-13 contract");
  if (
    !exactKeys(value.authority, [
      "approved_at",
      "cloudflare_secret_mutation_authorized",
      "confirmation_sha256",
      "credential_access_authorized",
      "database_mutation_authorized",
      "deployment_authorized",
      "execute_authorized",
      "gpu_use_authorized",
      "maximum_cumulative_finite_external_spend_usd",
      "mode",
      "new_retained_resources_authorized",
      "provider_calls_authorized",
    ]) ||
    value.authority.mode !== "APPROVED_EXECUTE" ||
    value.authority.execute_authorized !== true ||
    value.authority.credential_access_authorized !== true ||
    value.authority.database_mutation_authorized !== true ||
    value.authority.cloudflare_secret_mutation_authorized !== true ||
    value.authority.deployment_authorized !== true ||
    value.authority.provider_calls_authorized !== true ||
    value.authority.gpu_use_authorized !== false ||
    value.authority.maximum_cumulative_finite_external_spend_usd !== 0 ||
    value.authority.new_retained_resources_authorized !== false ||
    typeof value.authority.approved_at !== "string" ||
    Number.isNaN(Date.parse(value.authority.approved_at)) ||
    value.authority.confirmation_sha256 !== sha256(CONFIRMATION)
  )
    fail("activation authority is absent, non-exact, spend-bearing, or resource-expanding");
  if (
    !exactKeys(value.release, [
      "commit",
      "media_worker_release_manifest_sha256",
      "migration_manifest_sha256",
      "production_config_activation_sha256",
    ]) ||
    !/^[0-9a-f]{40}$/u.test(value.release.commit) ||
    Object.values(value.release)
      .filter((item) => item !== value.release.commit)
      .some((item) => !HASH.test(item))
  )
    fail("release pins are malformed");
  if (
    !exactKeys(value.database, [
      "database",
      "exact_manifest_ledger_required",
      "first_migration",
      "host",
      "last_migration",
      "owner_role",
      "pgcrypto_required",
      "reconciler_role",
      "runtime_role",
    ]) ||
    value.database.pgcrypto_required !== true ||
    value.database.first_migration !== 37 ||
    value.database.last_migration !== 44 ||
    value.database.exact_manifest_ledger_required !== true ||
    ![value.database.owner_role, value.database.runtime_role, value.database.reconciler_role].every(
      (item) => ROLE.test(item),
    ) ||
    new Set([
      value.database.owner_role,
      value.database.runtime_role,
      value.database.reconciler_role,
    ]).size !== 3
  )
    fail("database identity, roles, or exact 0037-0044 gate drifted");
  if (
    !exactKeys(value.cloudflare, [
      "account_id",
      "api_token_sha256",
      "pre_mutation_active_commit",
      "pre_mutation_active_version_id",
      "pre_mutation_active_version_readback_sha256",
      "pre_mutation_deployments_status_sha256",
      "pre_mutation_route_readback_sha256",
      "preexisting_secret_set_must_be_empty",
      "preexisting_worker_required",
      "public_origin",
      "r2_bucket_name",
      "worker_name",
      "workflow_name",
    ]) ||
    !/^[0-9a-f]{32}$/u.test(value.cloudflare.account_id) ||
    !/^[0-9a-f-]{36}$/u.test(value.cloudflare.pre_mutation_active_version_id) ||
    !/^[0-9a-f]{40}$/u.test(value.cloudflare.pre_mutation_active_commit) ||
    !HASH.test(value.cloudflare.api_token_sha256) ||
    !HASH.test(value.cloudflare.pre_mutation_deployments_status_sha256) ||
    !HASH.test(value.cloudflare.pre_mutation_active_version_readback_sha256) ||
    !HASH.test(value.cloudflare.pre_mutation_route_readback_sha256) ||
    value.cloudflare.worker_name !== "videoforge-production-runtime" ||
    value.cloudflare.preexisting_worker_required !== true ||
    value.cloudflare.preexisting_secret_set_must_be_empty !== true ||
    !/^[a-z][a-z0-9-]{2,62}$/u.test(value.cloudflare.r2_bucket_name) ||
    !/^[a-z][a-z0-9-]{2,62}$/u.test(value.cloudflare.workflow_name) ||
    !value.cloudflare.public_origin.startsWith("https://")
  )
    fail("Cloudflare identity does not bind the quarantined preexisting Worker");
  if (
    !exactKeys(value.gates, [
      "mage_deployment_snapshot_sha256",
      "mage_qualification_sha256",
      "paid_dispatch_authority_sha256",
      "soulx_deployment_snapshot_sha256",
      "soulx_qualification_sha256",
    ]) ||
    Object.entries(value.gates).some(([name, item]) => name.endsWith("_sha256") && !HASH.test(item))
  )
    fail("qualification, deployment, or paid-authority gates are incomplete");
  if (
    !exactKeys(value.soulx_crop_approval, [
      "approval_path",
      "approval_sha256",
      "avatar_source_geometry",
      "avatar_source_sha256",
      "candidate_path",
      "candidate_sha256",
      "full_output_geometry",
      "full_profile_id",
      "full_sample_sha256",
      "native_sample_geometry",
      "native_sample_sha256",
      "profile_group_id",
      "split_output_geometry",
      "split_profile_id",
      "split_sample_sha256",
    ]) ||
    value.soulx_crop_approval.approval_path !==
      "project-context/evidence/acceptance/VF-10-08/2026-08-26-soulx-crop-profile-approval.json" ||
    value.soulx_crop_approval.candidate_path !==
      "project-context/evidence/candidates/VF-10-08/soulx-crop-profile-candidate.json" ||
    value.soulx_crop_approval.profile_group_id !== "soulx-pro-vf924u-full-split-v1" ||
    value.soulx_crop_approval.full_profile_id !== "soulx-pro-ranga-full-source-composite-v1" ||
    value.soulx_crop_approval.split_profile_id !== "soulx-pro-ranga-split-composite-v1" ||
    value.soulx_crop_approval.approval_sha256 !== SOULX_APPROVAL_SHA256 ||
    value.soulx_crop_approval.candidate_sha256 !== SOULX_CANDIDATE_SHA256 ||
    value.soulx_crop_approval.full_sample_sha256 !== SOULX_FULL_SHA256 ||
    value.soulx_crop_approval.split_sample_sha256 !== SOULX_SPLIT_SHA256 ||
    [
      "approval_sha256",
      "avatar_source_sha256",
      "candidate_sha256",
      "full_sample_sha256",
      "native_sample_sha256",
      "split_sample_sha256",
    ].some((name) => !HASH.test(value.soulx_crop_approval[name])) ||
    JSON.stringify(value.soulx_crop_approval.avatar_source_geometry) !==
      JSON.stringify({ width: 1672, height: 941 }) ||
    JSON.stringify(value.soulx_crop_approval.native_sample_geometry) !==
      JSON.stringify({ width: 512, height: 512, fps: 25 }) ||
    JSON.stringify(value.soulx_crop_approval.full_output_geometry) !==
      JSON.stringify({ width: 1920, height: 1080, fps: 30 }) ||
    JSON.stringify(value.soulx_crop_approval.split_output_geometry) !==
      JSON.stringify({ width: 1920, height: 1080, fps: 30 })
  )
    fail("SoulX crop approval identity, media, or geometry pins are not exact");
  if (
    !exactKeys(value.secret_sha256, SECRET_NAMES) ||
    Object.values(value.secret_sha256).some((item) => !HASH.test(item))
  )
    fail("secret fingerprint allowlist is not exact");
  return value;
}

function parseArgs(tokens) {
  const flags = new Set(tokens.filter((token) => token === "--plan" || token === "--execute"));
  const remaining = tokens.filter((token) => !flags.has(token));
  const args = new Map();
  for (let index = 0; index < remaining.length; index += 2) {
    if (!remaining[index]?.startsWith("--") || remaining[index + 1]?.startsWith("--"))
      fail("arguments must be --name value pairs");
    args.set(remaining[index].slice(2), remaining[index + 1]);
  }
  if (flags.size !== 1) fail("non-default use requires exactly one of --plan or --execute");
  return { args, execute: flags.has("--execute") };
}

function validateSoulxApprovalRecords(crop, approvalBytes, candidateBytes, readMedia) {
  if (
    sha256(approvalBytes) !== crop.approval_sha256 ||
    sha256(candidateBytes) !== crop.candidate_sha256
  )
    fail("SoulX crop approval or candidate bytes do not match authority");
  const approval = JSON.parse(approvalBytes);
  const candidate = JSON.parse(candidateBytes);
  if (
    approval.schema_version !== "videoforge.v2-08-soulx-crop-profile-approval/v1" ||
    approval.approval_source !== "EXPLICIT_USER_CURRENT_CODEX_TASK" ||
    approval.approval_statement !== "i approve the SoulX full and split layouts." ||
    approval.candidate?.path !== crop.candidate_path ||
    approval.candidate?.sha256 !== crop.candidate_sha256 ||
    approval.approved_profile?.profile_group_id !== crop.profile_group_id ||
    approval.approved_profile?.avatar_source_sha256 !== crop.avatar_source_sha256 ||
    JSON.stringify(approval.approved_profile?.avatar_source_geometry) !==
      JSON.stringify(crop.avatar_source_geometry) ||
    approval.approved_profile?.native_sample_sha256 !== crop.native_sample_sha256 ||
    JSON.stringify(approval.approved_profile?.native_sample_geometry) !==
      JSON.stringify(crop.native_sample_geometry) ||
    approval.approved_profile?.full?.profile_id !== crop.full_profile_id ||
    approval.approved_profile?.full?.sample_sha256 !== crop.full_sample_sha256 ||
    JSON.stringify(approval.approved_profile?.full?.output_geometry) !==
      JSON.stringify(crop.full_output_geometry) ||
    approval.approved_profile?.split?.profile_id !== crop.split_profile_id ||
    approval.approved_profile?.split?.sample_sha256 !== crop.split_sample_sha256 ||
    JSON.stringify(approval.approved_profile?.split?.output_geometry) !==
      JSON.stringify(crop.split_output_geometry) ||
    approval.activation?.visual_approval_status !== "APPROVED_EXACT_FULL_AND_SPLIT" ||
    approval.activation?.qualification_status !== "NOT_QUALIFIED" ||
    approval.activation?.serverless_image_published !== false ||
    approval.activation?.serverless_endpoint_created !== false ||
    approval.activation?.live_dispatch_authorized !== false ||
    approval.activation?.deployment_authorized !== false ||
    approval.activation?.provider_mutation_authorized !== false ||
    approval.activation?.gpu_use_authorized !== false ||
    approval.activation?.spend_authorized_usd !== 0 ||
    candidate.candidate_id !== approval.candidate?.candidate_id ||
    candidate.samples?.native?.sha256 !== crop.native_sample_sha256 ||
    candidate.samples?.full?.sha256 !== crop.full_sample_sha256 ||
    candidate.samples?.split?.sha256 !== crop.split_sample_sha256
  )
    fail("SoulX crop approval content drifted from exact approved media and geometry");
  for (const sample of [
    candidate.samples.native,
    candidate.samples.full,
    candidate.samples.split,
  ]) {
    if (sha256(readMedia(sample.path)) !== sample.sha256)
      fail("SoulX approved sample media bytes drifted");
  }
  return true;
}

function prevalidate(args) {
  for (const name of ["activation-record", "config-activation-record", "release-manifest-file"])
    if (!args.has(name)) fail(`--${name} is required`);
  for (const name of ["activation-record", "config-activation-record", "release-manifest-file"])
    mode(resolve(args.get(name)), "file", 0o600, name);
  const authority = validateAuthority(
    JSON.parse(readFileSync(resolve(args.get("activation-record")), "utf8")),
  );
  const head = git("rev-parse", "HEAD");
  if (head !== authority.release.commit) fail("authority commit is not exact HEAD");
  if (git("status", "--porcelain=v1", "--untracked-files=all") !== "")
    fail("working tree must be completely clean before activation");
  const crop = authority.soulx_crop_approval;
  for (const path of [crop.approval_path, crop.candidate_path]) {
    if (git("hash-object", path) !== git("rev-parse", `HEAD:${path}`))
      fail("SoulX crop approval records are not the exact committed HEAD bytes");
  }
  const approvalBytes = readFileSync(resolve(ROOT, crop.approval_path));
  const candidateBytes = readFileSync(resolve(ROOT, crop.candidate_path));
  validateSoulxApprovalRecords(crop, approvalBytes, candidateBytes, (path) =>
    readFileSync(resolve(ROOT, path)),
  );
  const manifestBytes = readFileSync(
    resolve(ROOT, "packages/control-plane/migrations/manifest.json"),
  );
  if (sha256(manifestBytes) !== authority.release.migration_manifest_sha256)
    fail("migration manifest bytes do not match authority");
  const manifest = JSON.parse(manifestBytes);
  const tail = manifest.migrations.slice(-8);
  if (
    tail.length !== 8 ||
    tail.some((entry, index) => entry.version !== 37 + index) ||
    tail.some(
      (entry) =>
        sha256(readFileSync(resolve(ROOT, "packages/control-plane/migrations", entry.filename))) !==
        entry.sha256,
    )
  )
    fail("migration 0037-0044 bytes do not match the exact manifest tail");
  if (
    sha256(readFileSync(resolve(args.get("config-activation-record")))) !==
      authority.release.production_config_activation_sha256 ||
    sha256(readFileSync(resolve(args.get("release-manifest-file")))) !==
      authority.release.media_worker_release_manifest_sha256
  )
    fail("config activation or release manifest bytes do not match authority");
  let configActivation;
  try {
    configActivation = JSON.parse(
      readFileSync(resolve(args.get("config-activation-record")), "utf8"),
    );
  } catch {
    fail("config activation record is not redacted valid JSON");
  }
  if (
    configActivation.schema_version !== "videoforge-v2-13-production-config-activation/v1" ||
    configActivation.release?.commit !== authority.release.commit ||
    configActivation.release?.media_worker_release_manifest_sha256 !==
      authority.release.media_worker_release_manifest_sha256 ||
    configActivation.cloudflare?.account_id !== authority.cloudflare.account_id ||
    configActivation.cloudflare?.worker_name !== authority.cloudflare.worker_name ||
    configActivation.cloudflare?.r2_bucket_name !== authority.cloudflare.r2_bucket_name ||
    configActivation.cloudflare?.workflow_name !== authority.cloudflare.workflow_name ||
    configActivation.cloudflare?.public_origin !== authority.cloudflare.public_origin ||
    configActivation.runtime?.gpu_transport !== "DISABLED_UNQUALIFIED"
  )
    fail("inner production config authority does not match guarded activation identity");
  return authority;
}

function plan(authority) {
  return {
    schema_version: "videoforge-v2-13-guarded-activation-plan/v1",
    release_commit: authority.release.commit,
    migration_range: [37, 44],
    database: [
      "verify owner service identity",
      "create pgcrypto extension",
      "provision two distinct LOGIN NOINHERIT hardened roles",
      "apply exact manifest migrations through 0044",
      "apply exact runtime and reconciler ACLs",
      "read back exact ledger, role flags, table ACLs, and function ACLs",
    ],
    cloudflare: [
      "render and validate exact production config",
      "build and firewall-scan production bundle",
      "wrangler deploy dry-run",
      "recheck authority-pinned deployment, version, route, and empty secret set",
      "deploy and read back exact disabled quarantine with auto-create off",
      `require empty secret set, put ${SECRET_NAMES.length} exact allowlisted names from mode-0600 files`,
      "read back exact secret names",
      "deploy and read back exact still-disabled rendered config",
    ],
    cleanup: "delete only secrets introduced by this run on any partial Cloudflare failure",
    new_retained_resources: 0,
    secret_names: SECRET_NAMES,
    secret_values_in_plan: false,
  };
}

function writeEvidence(path, value) {
  const target = resolve(path);
  writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
}

function prevalidateEvidencePath(path) {
  const target = resolve(path);
  if (existsSync(target)) fail("evidence output must not already exist");
  mode(dirname(target), "directory", 0o700, "evidence output directory");
}

function protectedSecrets(directory, authority) {
  mode(directory, "directory", 0o700, "secret input directory");
  const entries = readdirSync(directory).sort();
  if (JSON.stringify(entries) !== JSON.stringify([...SECRET_NAMES].sort()))
    fail("secret input directory is not the exact closed-world allowlist");
  const values = new Map();
  for (const name of SECRET_NAMES) {
    const path = join(directory, name);
    mode(path, "file", 0o600, name);
    const value = readFileSync(path, "utf8");
    if (
      !value ||
      value !== value.trim() ||
      value.includes("\0") ||
      sha256(value) !== authority.secret_sha256[name]
    )
      fail(`${name} is empty, malformed, or does not match its approved fingerprint`);
    values.set(name, value);
  }
  for (const [name, expectedRole] of [
    ["DATABASE_URL", authority.database.runtime_role],
    ["VIDEOFORGE_RECONCILER_DATABASE_URL", authority.database.reconciler_role],
  ]) {
    let parsed;
    try {
      parsed = new URL(values.get(name));
    } catch {
      fail(`${name} is not a redacted valid URL`);
    }
    if (
      !["postgres:", "postgresql:"].includes(parsed.protocol) ||
      parsed.hostname !== authority.database.host ||
      parsed.pathname.slice(1) !== authority.database.database ||
      decodeURIComponent(parsed.username) !== expectedRole ||
      !parsed.password ||
      parsed.hash ||
      parsed.searchParams.size !== 2 ||
      parsed.searchParams.get("sslmode") !== "require" ||
      parsed.searchParams.get("channel_binding") !== "require"
    )
      fail(`${name} does not bind the exact approved hardened role`);
  }
  if (values.get("RUNPOD_API_BASE_URL") !== "https://api.runpod.ai/v2")
    fail("RunPod API base URL is not exact");
  const endpoints = [
    values.get("VIDEOFORGE_MAGE_ENDPOINT_ID"),
    values.get("VIDEOFORGE_SOULX_ENDPOINT_ID"),
  ];
  const endpointHashes = [
    values.get("VIDEOFORGE_MAGE_ENDPOINT_ID_SHA256"),
    values.get("VIDEOFORGE_SOULX_ENDPOINT_ID_SHA256"),
  ];
  if (
    endpoints.some((value) => !/^[A-Za-z0-9][A-Za-z0-9._:-]{2,159}$/u.test(value)) ||
    endpointHashes.some((value) => !HASH.test(value)) ||
    endpoints.some((value, index) => sha256(value) !== endpointHashes[index]) ||
    new Set(endpoints).size !== 2 ||
    new Set(endpointHashes).size !== 2
  )
    fail("RunPod endpoint identities or hashes are not exact and separate");
  const keyIds = [
    values.get("VIDEOFORGE_DISPATCH_TOKEN_KEY_ID"),
    values.get("VIDEOFORGE_ENVELOPE_SIGNING_KEY_ID"),
    values.get("VIDEOFORGE_PROVIDER_PROOF_KEY_ID"),
  ];
  const keyMaterials = [
    values.get("VIDEOFORGE_DISPATCH_TOKEN_KEY"),
    values.get("VIDEOFORGE_ENVELOPE_SIGNING_KEY_HEX"),
    values.get("VIDEOFORGE_PROVIDER_PROOF_VERIFY_KEY"),
  ];
  if (
    keyIds.some((value) => value.length < 3) ||
    new Set(keyIds).size !== 3 ||
    keyMaterials[0].length < 32 ||
    keyMaterials.slice(1).some((value) => !/^(?:[0-9a-f]{2}){32,}$/u.test(value)) ||
    new Set(keyMaterials.map((value) => sha256(value))).size !== 3
  )
    fail("dispatch, envelope, and proof keys are malformed or not separate");
  return values;
}

function ownerEnvironment(directory, authority) {
  mode(directory, "directory", 0o700, "PostgreSQL input directory");
  const service = join(directory, "owner.pg_service.conf");
  const pass = join(directory, "owner.pgpass");
  mode(service, "file", 0o600, "owner service file");
  mode(pass, "file", 0o600, "owner pass file");
  const env = safeEnvironment();
  Object.assign(env, {
    PGSERVICEFILE: service,
    PGSERVICE: "videoforge_v2_13_owner",
    PGPASSFILE: pass,
    V2_06_PG_SERVICEFILE: service,
    V2_06_PG_SERVICE: "videoforge_v2_13_owner",
    V2_06_PGPASSFILE: pass,
    V2_06_APPROVED_NEON_HOST: authority.database.host,
    V2_06_EXPECTED_DATABASE: authority.database.database,
    V2_06_EXPECTED_OWNER_ROLE: authority.database.owner_role,
    V2_06_RUNTIME_ROLE: authority.database.runtime_role,
    V2_06_REQUIRED_LEDGER_PREFIX_VERSION: "36",
  });
  return env;
}

function psql(environment, args, input) {
  run("psql", ["--no-psqlrc", "--set", "ON_ERROR_STOP=1", ...args], {
    env: environment,
    input,
  });
}

function rolePrecheckQuery(authority) {
  const roles = `'${authority.database.runtime_role}','${authority.database.reconciler_role}'`;
  return `SELECT ((SELECT count(*)=0 FROM pg_roles WHERE rolname IN (${roles}))
AND NOT EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles member_role ON member_role.oid=m.member JOIN pg_roles granted_role ON granted_role.oid=m.roleid WHERE member_role.rolname IN (${roles}) OR granted_role.rolname IN (${roles}))
AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_roles r ON r.oid=c.relowner WHERE r.rolname IN (${roles}))
AND NOT EXISTS (SELECT 1 FROM pg_namespace n JOIN pg_roles r ON r.oid=n.nspowner WHERE r.rolname IN (${roles}))
AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE r.rolname IN (${roles}))
AND NOT EXISTS (SELECT 1 FROM pg_roles r JOIN pg_database d ON d.datname=current_database() CROSS JOIN LATERAL aclexplode(d.datacl) acl WHERE r.rolname IN (${roles}) AND acl.grantee=r.oid)
AND NOT EXISTS (SELECT 1 FROM pg_roles r JOIN pg_namespace n ON true CROSS JOIN LATERAL aclexplode(n.nspacl) acl WHERE r.rolname IN (${roles}) AND acl.grantee=r.oid)
AND NOT EXISTS (SELECT 1 FROM pg_roles r JOIN pg_class c ON c.relkind IN ('r','p','v','m','f','S') CROSS JOIN LATERAL aclexplode(c.relacl) acl WHERE r.rolname IN (${roles}) AND acl.grantee=r.oid)
AND NOT EXISTS (SELECT 1 FROM pg_roles r JOIN pg_proc p ON true CROSS JOIN LATERAL aclexplode(p.proacl) acl WHERE r.rolname IN (${roles}) AND acl.grantee=r.oid)
AND NOT EXISTS (SELECT 1 FROM pg_roles r JOIN pg_default_acl d ON true CROSS JOIN LATERAL aclexplode(d.defaclacl) acl WHERE r.rolname IN (${roles}) AND acl.grantee=r.oid)
AND NOT EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname IN (${roles}) AND has_database_privilege(r.oid,current_database(),'CREATE'))
AND NOT EXISTS (SELECT 1 FROM pg_roles r JOIN pg_namespace n ON n.nspname !~ '^pg_' AND n.nspname <> 'information_schema' WHERE r.rolname IN (${roles}) AND has_schema_privilege(r.oid,n.oid,'CREATE'))
AND NOT EXISTS (SELECT 1 FROM pg_roles r JOIN pg_class c ON c.relkind IN ('r','p','v','m','f') JOIN pg_namespace n ON n.oid=c.relnamespace AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema' WHERE r.rolname IN (${roles}) AND (has_table_privilege(r.oid,c.oid,'SELECT') OR has_table_privilege(r.oid,c.oid,'INSERT') OR has_table_privilege(r.oid,c.oid,'UPDATE') OR has_table_privilege(r.oid,c.oid,'DELETE') OR has_table_privilege(r.oid,c.oid,'TRUNCATE') OR has_table_privilege(r.oid,c.oid,'REFERENCES') OR has_table_privilege(r.oid,c.oid,'TRIGGER')))
AND NOT EXISTS (SELECT 1 FROM pg_roles r JOIN pg_class c ON c.relkind='S' JOIN pg_namespace n ON n.oid=c.relnamespace AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema' WHERE r.rolname IN (${roles}) AND (has_sequence_privilege(r.oid,c.oid,'USAGE') OR has_sequence_privilege(r.oid,c.oid,'SELECT') OR has_sequence_privilege(r.oid,c.oid,'UPDATE')))
AND NOT EXISTS (SELECT 1 FROM pg_roles r JOIN pg_proc p ON true JOIN pg_namespace n ON n.oid=p.pronamespace AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema' WHERE r.rolname IN (${roles}) AND has_function_privilege(r.oid,p.oid,'EXECUTE')))::text;`;
}

async function databaseActivation(authority, values, postgresInputDirectory) {
  await validateServiceFile(
    join(postgresInputDirectory, "owner.pg_service.conf"),
    "videoforge_v2_13_owner",
    authority.database.host,
    authority.database.database,
    authority.database.owner_role,
  );
  const env = ownerEnvironment(postgresInputDirectory, authority);
  const runtime = new URL(values.get("DATABASE_URL").trim());
  const reconciler = new URL(values.get("VIDEOFORGE_RECONCILER_DATABASE_URL").trim());
  const ownerIdentity = run(
    "psql",
    ["--no-psqlrc", "--tuples-only", "--no-align", "--command", "SELECT current_user::text"],
    { env, capture: true },
  );
  if (ownerIdentity !== authority.database.owner_role)
    fail("database connection is not the exact approved migration owner");
  const manifest = JSON.parse(
    readFileSync(resolve(ROOT, "packages/control-plane/migrations/manifest.json"), "utf8"),
  );
  const ledgerText = run(
    "psql",
    [
      "--no-psqlrc",
      "--tuples-only",
      "--no-align",
      "--field-separator",
      "\t",
      "--set",
      "ON_ERROR_STOP=1",
      "--command",
      "SELECT version::text,name,filename,sha256 FROM public.videoforge_schema_migrations ORDER BY version",
    ],
    { env, capture: true },
  );
  const ledger = ledgerText
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => line.split("\t"));
  if (
    ledger.length !== 36 ||
    ledger.some((row, index) => {
      const expected = manifest.migrations[index];
      return (
        row[0] !== String(expected.version) ||
        row[1] !== expected.name ||
        row[2] !== expected.filename ||
        row[3] !== expected.sha256
      );
    })
  )
    fail("database ledger is not the exact committed 36-row prefix before mutation");
  const rolePrecheck = run(
    "psql",
    [
      "--no-psqlrc",
      "--tuples-only",
      "--no-align",
      "--set",
      "ON_ERROR_STOP=1",
      "--command",
      rolePrecheckQuery(authority),
    ],
    { env, capture: true },
  );
  if (rolePrecheck !== "true")
    fail("database role names are not fresh or have cluster privilege drift");
  env.V2_13_RUNTIME_PASSWORD = decodeURIComponent(runtime.password);
  env.V2_13_RECONCILER_PASSWORD = decodeURIComponent(reconciler.password);
  const bootstrap = String.raw`\getenv runtime_password V2_13_RUNTIME_PASSWORD
\getenv reconciler_password V2_13_RECONCILER_PASSWORD
CREATE EXTENSION IF NOT EXISTS pgcrypto;
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS',:'runtime_role',:'runtime_password') \gexec
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS',:'reconciler_role',:'reconciler_password') \gexec
`;
  psql(
    env,
    [
      "--variable",
      `runtime_role=${authority.database.runtime_role}`,
      "--variable",
      `reconciler_role=${authority.database.reconciler_role}`,
    ],
    bootstrap,
  );
  run(process.execPath, ["deploy/v2-06/apply-migrations-and-grants.mjs", "--apply-grants"], {
    env,
  });
  psql(env, [
    "--variable",
    `runtime_role=${authority.database.runtime_role}`,
    "--variable",
    `reconciler_role=${authority.database.reconciler_role}`,
    "--file",
    resolve(ROOT, "deploy/v2-13/neon-pair-reconciler-grants.sql"),
  ]);
  run(
    process.execPath,
    ["deploy/v2-06/apply-migrations-and-grants.mjs", "--verify-only", "--apply-grants"],
    { env },
  );
  const exactReconcilerReadback = `SELECT ((SELECT count(*)=2 AND bool_and(rolcanlogin AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolinherit AND NOT rolreplication AND NOT rolbypassrls AND rolconfig IS NULL) FROM pg_roles WHERE rolname IN ('${authority.database.runtime_role}','${authority.database.reconciler_role}')) AND NOT EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles member_role ON member_role.oid=m.member JOIN pg_roles granted_role ON granted_role.oid=m.roleid WHERE member_role.rolname IN ('${authority.database.runtime_role}','${authority.database.reconciler_role}') OR granted_role.rolname IN ('${authority.database.runtime_role}','${authority.database.reconciler_role}')) AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_roles r ON r.oid=c.relowner WHERE r.rolname IN ('${authority.database.runtime_role}','${authority.database.reconciler_role}')) AND NOT EXISTS (SELECT 1 FROM pg_namespace n JOIN pg_roles r ON r.oid=n.nspowner WHERE r.rolname IN ('${authority.database.runtime_role}','${authority.database.reconciler_role}')) AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE r.rolname IN ('${authority.database.runtime_role}','${authority.database.reconciler_role}')) AND (SELECT array_agg(p.oid::regprocedure::text ORDER BY p.oid::regprocedure::text)=ARRAY['videoforge_current_account_id()','videoforge_inspect_hosted_pair_runtime(uuid,uuid,uuid)','videoforge_settle_hosted_pair_cleanup_v2(uuid,uuid,uuid,jsonb,jsonb)']::text[] FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND has_function_privilege('${authority.database.reconciler_role}',p.oid,'EXECUTE')) AND NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE grantee='${authority.database.reconciler_role}' AND table_schema='public'))::text;`;
  const result = run(
    "psql",
    ["--no-psqlrc", "--tuples-only", "--no-align", "--command", exactReconcilerReadback],
    { env, capture: true },
  );
  if (result !== "true") fail("reconciler role/ACL post-readback is not exact");
  delete env.V2_13_RUNTIME_PASSWORD;
  delete env.V2_13_RECONCILER_PASSWORD;
}

function cloudflareEnvironment(tokenPath, authority) {
  mode(tokenPath, "file", 0o600, "Cloudflare API token file");
  const token = readFileSync(tokenPath, "utf8");
  if (!token || token !== token.trim() || sha256(token) !== authority.cloudflare.api_token_sha256)
    fail("Cloudflare API token is malformed or does not match its approved fingerprint");
  return safeEnvironment({ CLOUDFLARE_API_TOKEN: token });
}

function wrangler(environment, args, { input, capture = false } = {}) {
  return run("pnpm", ["--filter", "@videoforge/web", "exec", "wrangler", ...args], {
    env: environment,
    input,
    capture,
  });
}

function extractSingleActiveVersion(statusBytes) {
  let status;
  try {
    status = JSON.parse(statusBytes);
  } catch {
    fail("Cloudflare deployment status is not redacted valid JSON");
  }
  const candidates = [];
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (
      typeof value.version_id === "string" &&
      (value.percentage === 100 || value.percentage === 1)
    )
      candidates.push(value.version_id);
    for (const child of Object.values(value)) visit(child);
  };
  visit(status);
  if (new Set(candidates).size !== 1) fail("Cloudflare is not on one exact 100-percent version");
  return candidates[0];
}

function assertDisabledVersionReadback(versionBytes, authority, expectedCommit) {
  let version;
  try {
    version = JSON.parse(versionBytes);
  } catch {
    fail("Cloudflare version readback is not redacted valid JSON");
  }
  const stringLeaves = [];
  const collect = (value) => {
    if (typeof value === "string") stringLeaves.push(value);
    else if (value && typeof value === "object") Object.values(value).forEach(collect);
  };
  collect(version);
  for (const expected of [
    expectedCommit,
    "DISABLED_UNQUALIFIED",
    "PRIVATE_ARTIFACTS",
    "VIDEO_WORKFLOW",
    "HOSTED_PAIR_WORKFLOW",
    authority.cloudflare.r2_bucket_name,
    authority.cloudflare.workflow_name,
  ]) {
    if (!stringLeaves.includes(expected))
      fail("deployed quarantine version identity is incomplete");
  }
  if (stringLeaves.includes("QUALIFIED_EXACT"))
    fail("deployed quarantine version contains enabled GPU transport");
  return true;
}

async function routeReadback(authority) {
  let response;
  try {
    response = await fetch(`${authority.cloudflare.public_origin}/api/v2/hosted/status`, {
      method: "GET",
      redirect: "error",
    });
  } catch {
    fail("production route readback transport failed with redacted output");
  }
  let body;
  try {
    body = await response.json();
  } catch {
    fail("production route readback was not exact JSON");
  }
  return JSON.stringify({ body, status: response.status });
}

async function assertQuarantineRoute(authority, configured) {
  const readback = JSON.parse(await routeReadback(authority));
  if (configured) {
    if (
      readback.status !== 200 ||
      readback.body?.schema_version !== "videoforge-hosted-status/v1" ||
      readback.body?.commit !== authority.release.commit ||
      readback.body?.gpu_transport !== "DISABLED_UNQUALIFIED"
    )
      fail("configured quarantine route is not exact disabled status");
  } else if (
    readback.status !== 503 ||
    readback.body?.error?.code !== "HOSTED_CONFIGURATION_INVALID" ||
    readback.body?.error?.retryable !== false
  )
    fail("unconfigured quarantine route is not exact fail-closed status");
}

async function cloudflareReadOnlyPreflight(config, authority, environment) {
  const status = wrangler(
    environment,
    [
      "deployments",
      "status",
      "--json",
      "--name",
      authority.cloudflare.worker_name,
      "--config",
      config,
    ],
    { capture: true },
  );
  if (sha256(status) !== authority.cloudflare.pre_mutation_deployments_status_sha256)
    fail("Cloudflare deployment status changed from approved read-only preflight");
  const versionId = extractSingleActiveVersion(status);
  if (versionId !== authority.cloudflare.pre_mutation_active_version_id)
    fail("Cloudflare active version changed from approved read-only preflight");
  const version = wrangler(
    environment,
    [
      "versions",
      "view",
      versionId,
      "--json",
      "--name",
      authority.cloudflare.worker_name,
      "--config",
      config,
    ],
    { capture: true },
  );
  if (sha256(version) !== authority.cloudflare.pre_mutation_active_version_readback_sha256)
    fail("Cloudflare active-version readback changed from approved preflight");
  assertDisabledVersionReadback(
    version,
    authority,
    authority.cloudflare.pre_mutation_active_commit,
  );
  if (
    sha256(await routeReadback(authority)) !==
    authority.cloudflare.pre_mutation_route_readback_sha256
  )
    fail("production route changed from approved read-only preflight");
  await assertQuarantineRoute(authority, false);
  if (cloudflareSecretNames(config, environment).length !== 0)
    fail("preexisting production Worker secret set is not empty; refusing overwrite");
}

function cloudflareSecretNames(configPath, environment) {
  const stdout = wrangler(environment, ["secret", "list", "--config", configPath], {
    capture: true,
  });
  let value;
  try {
    value = JSON.parse(stdout);
  } catch {
    fail("Cloudflare secret-name readback was not exact JSON");
  }
  if (!Array.isArray(value) || value.some((item) => !exactKeys(item, ["name", "type"])))
    fail("Cloudflare secret-name readback shape drifted");
  return value.map((item) => item.name).sort();
}

async function secretMutationTransaction({
  names,
  put,
  afterPut = async () => {},
  verify,
  deploy,
  remove,
}) {
  const uploaded = [];
  try {
    for (const name of names) {
      await put(name);
      uploaded.push(name);
      await afterPut(name);
    }
    await verify();
    await deploy();
  } catch (error) {
    for (const name of uploaded.reverse()) {
      try {
        await remove(name);
      } catch {
        // Preserve the original fail-closed error; evidence requires manual reconciliation.
      }
    }
    throw error;
  }
}

function renderAndDryRunConfig(args, environment, temporaryDirectory) {
  const config = join(temporaryDirectory, "wrangler.production.activated.json");
  run(
    process.execPath,
    [
      "deploy/v2-13/render-production-config.mjs",
      "--activate",
      "--activation-record",
      resolve(args.get("config-activation-record")),
      "--release-manifest-file",
      resolve(args.get("release-manifest-file")),
      "--output",
      config,
    ],
    { env: safeEnvironment() },
  );
  run(process.execPath, ["deploy/v2-13/validate-production-config.mjs", "--config", config], {
    env: safeEnvironment(),
  });
  run("pnpm", ["--filter", "@videoforge/web", "build:cloudflare"], {
    env: safeEnvironment(),
  });
  wrangler(environment, [
    "deploy",
    "--dry-run",
    "--outdir",
    join(temporaryDirectory, "dry-run"),
    "--config",
    config,
    "--x-auto-create",
    "false",
  ]);
  return config;
}

async function cloudflarePreflight(args, authority, environment) {
  const directory = mkdtempSync(join(tmpdir(), "videoforge-v2-13-preflight-"));
  try {
    await cloudflareReadOnlyPreflight(
      renderAndDryRunConfig(args, environment, directory),
      authority,
      environment,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function readBackDisabledQuarantine(config, authority, environment) {
  const status = wrangler(
    environment,
    [
      "deployments",
      "status",
      "--json",
      "--name",
      authority.cloudflare.worker_name,
      "--config",
      config,
    ],
    { capture: true },
  );
  const versionId = extractSingleActiveVersion(status);
  const version = wrangler(
    environment,
    [
      "versions",
      "view",
      versionId,
      "--json",
      "--name",
      authority.cloudflare.worker_name,
      "--config",
      config,
    ],
    { capture: true },
  );
  assertDisabledVersionReadback(version, authority, authority.release.commit);
  return versionId;
}

async function cloudflareActivation(args, authority, values, environment, databaseStage) {
  const directory = mkdtempSync(join(tmpdir(), "videoforge-v2-13-activation-"));
  let config;
  let quarantineDeployed = false;
  try {
    config = renderAndDryRunConfig(args, environment, directory);
    await cloudflareReadOnlyPreflight(config, authority, environment);
    wrangler(environment, [
      "deploy",
      "--config",
      config,
      "--message",
      `videoforge-v2-13-disabled-quarantine:${authority.release.commit}`,
      "--x-auto-create",
      "false",
    ]);
    quarantineDeployed = true;
    readBackDisabledQuarantine(config, authority, environment);
    await assertQuarantineRoute(authority, false);
    if (cloudflareSecretNames(config, environment).length !== 0)
      fail("new quarantine unexpectedly inherited secret bindings");
    await databaseStage();
    await secretMutationTransaction({
      names: SECRET_NAMES,
      put(name) {
        wrangler(environment, ["secret", "put", name, "--config", config], {
          input: values.get(name),
        });
      },
      afterPut() {
        readBackDisabledQuarantine(config, authority, environment);
      },
      verify() {
        if (
          JSON.stringify(cloudflareSecretNames(config, environment)) !==
          JSON.stringify([...SECRET_NAMES].sort())
        )
          fail("Cloudflare secret-name post-readback is not the exact closed-world allowlist");
      },
      async deploy() {
        wrangler(environment, [
          "deploy",
          "--config",
          config,
          "--message",
          `videoforge-v2-13-disabled-with-secrets:${authority.release.commit}`,
          "--x-auto-create",
          "false",
        ]);
        readBackDisabledQuarantine(config, authority, environment);
        await assertQuarantineRoute(authority, true);
        if (
          JSON.stringify(cloudflareSecretNames(config, environment)) !==
          JSON.stringify([...SECRET_NAMES].sort())
        )
          fail("final disabled version lost the exact secret-name set");
      },
      remove(name) {
        wrangler(environment, ["secret", "delete", name, "--config", config, "--force"]);
      },
    });
  } catch (error) {
    if (quarantineDeployed && config) {
      try {
        wrangler(environment, [
          "deploy",
          "--config",
          config,
          "--message",
          `videoforge-v2-13-disabled-rollback:${authority.release.commit}`,
          "--x-auto-create",
          "false",
        ]);
        readBackDisabledQuarantine(config, authority, environment);
        await assertQuarantineRoute(authority, false);
        if (cloudflareSecretNames(config, environment).length !== 0)
          fail("rollback quarantine retained a secret binding");
      } catch {
        fail("Cloudflare rollback could not restore and verify the exact disabled quarantine");
      }
    }
    throw error;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

async function main() {
  if (process.argv.length === 2) {
    process.stdout.write(
      `${JSON.stringify({
        schema_version: "videoforge-v2-13-guarded-activation-dry-run/v1",
        state: "DISABLED_UNQUALIFIED",
        credential_reads: 0,
        mutations: 0,
        provider_calls: 0,
        external_spend_usd: 0,
        new_retained_resources: 0,
      })}\n`,
    );
    return;
  }
  const { args, execute } = parseArgs(process.argv.slice(2));
  const allowed = [
    "activation-record",
    "config-activation-record",
    "release-manifest-file",
    ...(execute
      ? [
          "cloudflare-api-token-file",
          "confirm",
          "evidence-output",
          "postgres-input-dir",
          "secret-input-dir",
        ]
      : []),
  ];
  if ([...args.keys()].some((name) => !allowed.includes(name))) fail("unknown argument");
  const authority = prevalidate(args);
  if (!execute) {
    process.stdout.write(`${JSON.stringify(plan(authority), null, 2)}\n`);
    return;
  }
  if (args.get("confirm") !== CONFIRMATION) fail(`--confirm must equal ${CONFIRMATION}`);
  for (const name of [
    "cloudflare-api-token-file",
    "evidence-output",
    "postgres-input-dir",
    "secret-input-dir",
  ])
    if (!args.has(name)) fail(`--${name} is required for execute`);
  prevalidateEvidencePath(args.get("evidence-output"));
  const evidenceBase = {
    schema_version: "videoforge-v2-13-guarded-activation-evidence/v1",
    activation_authority_sha256: sha256(readFileSync(resolve(args.get("activation-record")))),
    commit: authority.release.commit,
    secret_names: SECRET_NAMES,
    secret_values_written_to_evidence: false,
    external_spend_cap_usd: 0,
    new_retained_resources_authorized: false,
  };
  try {
    const cloudflareEnv = cloudflareEnvironment(
      resolve(args.get("cloudflare-api-token-file")),
      authority,
    );
    // All Cloudflare state/config/version reads run before the first database or secret mutation.
    await cloudflarePreflight(args, authority, cloudflareEnv);
    const values = protectedSecrets(resolve(args.get("secret-input-dir")), authority);
    await cloudflareActivation(args, authority, values, cloudflareEnv, () =>
      databaseActivation(authority, values, resolve(args.get("postgres-input-dir"))),
    );
    const result = {
      schema_version: "videoforge-v2-13-guarded-activation-result/v1",
      state: "DISABLED_UNQUALIFIED",
      commit: authority.release.commit,
      migration_ledger: "44/44 exact",
      role_acl_readback: "exact",
      secret_name_readback: `${SECRET_NAMES.length}/${SECRET_NAMES.length} exact`,
      secret_value_fingerprints: "matched authority before mutation",
      deployment_attempted: true,
      new_retained_resources: 0,
    };
    writeEvidence(args.get("evidence-output"), {
      ...evidenceBase,
      outcome: "SUCCEEDED",
      migration_ledger: "44/44 exact",
      role_acl_readback: "exact",
      secret_name_readback: `${SECRET_NAMES.length}/${SECRET_NAMES.length} exact`,
      partial_secret_cleanup_required: false,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    writeEvidence(args.get("evidence-output"), {
      ...evidenceBase,
      outcome: "FAILED_CLOSED",
      failure_code: "V2_13_GUARDED_ACTIVATION_FAILED_REDACTED",
      production_qualified: false,
      partial_secret_cleanup: "ATTEMPTED_FOR_ONLY_NAMES_INTRODUCED_BY_THIS_RUN",
      manual_database_reconciliation_required: true,
    });
    throw error;
  }
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) await main();

export {
  assertDisabledVersionReadback,
  CONFIRMATION,
  extractSingleActiveVersion,
  SECRET_NAMES,
  plan,
  protectedSecrets,
  rolePrecheckQuery,
  secretMutationTransaction,
  safeEnvironment,
  validateSoulxApprovalRecords,
  validateAuthority,
};

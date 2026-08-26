#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
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
import { validateFullLiveUserApproval } from "./validate-full-live-approval.mjs";

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
  "VIDEOFORGE_V213_WORKFLOW_OPERATOR_TOKEN",
]);
const HASH = /^sha256:[0-9a-f]{64}$/u;
const ROLE = /^[a-z_][a-z0-9_]{0,62}$/u;
const AUTHORITY_ID = /^v2-13-[a-z0-9][a-z0-9._-]{7,95}$/u;
const WORKFLOW_INVENTORY_PATH = "/workflows?page=1&per_page=100";
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

function regularFile(path, label) {
  const metadata = lstatSync(path);
  if (metadata.isSymbolicLink() || !metadata.isFile()) fail(`${label} must be a regular file`);
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
      "approval_path",
      "approval_sha256",
      "authority_id",
      "cloudflare_secret_mutation_authorized",
      "confirmation_sha256",
      "credential_access_authorized",
      "database_mutation_authorized",
      "deployment_authorized",
      "exact_quarantine_creation_authorized",
      "execute_authorized",
      "expires_at",
      "gpu_use_authorized",
      "maximum_cumulative_finite_external_spend_usd",
      "mode",
      "new_paid_retained_resources_authorized",
      "other_resource_creation_authorized",
      "plan_change_authorized",
      "proposal_path",
      "proposal_sha256",
      "provider_calls_authorized",
      "single_use",
    ]) ||
    value.authority.mode !== "APPROVED_EXECUTE" ||
    !AUTHORITY_ID.test(value.authority.authority_id) ||
    !HASH.test(value.authority.proposal_sha256) ||
    !HASH.test(value.authority.approval_sha256) ||
    !/^project-context\/evidence\/[A-Za-z0-9._/-]+$/u.test(value.authority.proposal_path) ||
    !/^project-context\/evidence\/[A-Za-z0-9._/-]+$/u.test(value.authority.approval_path) ||
    value.authority.proposal_path.includes("..") ||
    value.authority.approval_path.includes("..") ||
    value.authority.single_use !== true ||
    value.authority.execute_authorized !== true ||
    value.authority.credential_access_authorized !== true ||
    value.authority.database_mutation_authorized !== true ||
    value.authority.cloudflare_secret_mutation_authorized !== true ||
    value.authority.deployment_authorized !== true ||
    value.authority.exact_quarantine_creation_authorized !== true ||
    value.authority.provider_calls_authorized !== true ||
    value.authority.gpu_use_authorized !== false ||
    value.authority.maximum_cumulative_finite_external_spend_usd !== 0 ||
    value.authority.new_paid_retained_resources_authorized !== false ||
    value.authority.other_resource_creation_authorized !== false ||
    value.authority.plan_change_authorized !== false ||
    typeof value.authority.approved_at !== "string" ||
    Number.isNaN(Date.parse(value.authority.approved_at)) ||
    typeof value.authority.expires_at !== "string" ||
    Number.isNaN(Date.parse(value.authority.expires_at)) ||
    Date.parse(value.authority.expires_at) <= Date.parse(value.authority.approved_at) ||
    Date.parse(value.authority.expires_at) - Date.parse(value.authority.approved_at) > 86_400_000 ||
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
      "operator_role",
      "operator_database_url_sha256",
      "pgcrypto_required",
      "reconciler_role",
      "runtime_role",
    ]) ||
    value.database.pgcrypto_required !== true ||
    value.database.first_migration !== 37 ||
    value.database.last_migration !== 45 ||
    value.database.exact_manifest_ledger_required !== true ||
    ![
      value.database.owner_role,
      value.database.operator_role,
      value.database.runtime_role,
      value.database.reconciler_role,
    ].every((item) => ROLE.test(item)) ||
    new Set([
      value.database.owner_role,
      value.database.operator_role,
      value.database.runtime_role,
      value.database.reconciler_role,
    ]).size !== 4 ||
    !HASH.test(value.database.operator_database_url_sha256 ?? "")
  )
    fail("database identity, roles, or exact 0037-0045 gate drifted");
  if (
    !exactKeys(value.cloudflare, [
      "account_id",
      "api_token_sha256",
      "exact_quarantine_creation_authorized",
      "failure_policy",
      "pre_mutation_account_readback_sha256",
      "pre_mutation_r2_inventory_sha256",
      "pre_mutation_route_readback_sha256",
      "pre_mutation_worker_absence_sha256",
      "pre_mutation_workflow_inventory_sha256",
      "preexisting_secret_set_must_be_empty",
      "preexisting_worker_required",
      "public_origin",
      "r2_bucket_name",
      "worker_name",
      "workflow_name",
    ]) ||
    !/^[0-9a-f]{32}$/u.test(value.cloudflare.account_id) ||
    !HASH.test(value.cloudflare.api_token_sha256) ||
    !HASH.test(value.cloudflare.pre_mutation_account_readback_sha256) ||
    !HASH.test(value.cloudflare.pre_mutation_worker_absence_sha256) ||
    !HASH.test(value.cloudflare.pre_mutation_workflow_inventory_sha256) ||
    !HASH.test(value.cloudflare.pre_mutation_r2_inventory_sha256) ||
    !HASH.test(value.cloudflare.pre_mutation_route_readback_sha256) ||
    value.cloudflare.worker_name !== "videoforge-production-runtime" ||
    value.cloudflare.preexisting_worker_required !== false ||
    value.cloudflare.exact_quarantine_creation_authorized !== true ||
    value.cloudflare.failure_policy !== "KEEP_EXACT_DISABLED_QUARANTINE_ELSE_DELETE_ATTRIBUTABLE" ||
    value.cloudflare.preexisting_secret_set_must_be_empty !== true ||
    !/^[a-z][a-z0-9-]{2,62}$/u.test(value.cloudflare.r2_bucket_name) ||
    !/^[a-z][a-z0-9-]{2,62}$/u.test(value.cloudflare.workflow_name) ||
    !value.cloudflare.public_origin.startsWith("https://")
  )
    fail("Cloudflare identity does not bind exact absent-to-quarantine creation");
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

function assertTrustedAuthorityTime(authority, trustedDate) {
  const trusted = Date.parse(trustedDate ?? "");
  if (
    Number.isNaN(trusted) ||
    trusted < Date.parse(authority.authority.approved_at) ||
    trusted > Date.parse(authority.authority.expires_at)
  )
    fail("authority is not current under trusted provider time");
  return true;
}

function defaultConsumptionDirectory() {
  const gitDirectory = git("rev-parse", "--git-common-dir");
  return resolve(ROOT, gitDirectory, "videoforge-authority-consumption", "v2-13");
}

function consumeAuthorityOnce(
  authority,
  authorityBytes,
  directory = defaultConsumptionDirectory(),
) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  mode(directory, "directory", 0o700, "authority consumption directory");
  const path = join(directory, `${authority.authority.authority_id}.json`);
  const record = {
    schema_version: "videoforge-v2-13-authority-consumption/v1",
    authority_id: authority.authority.authority_id,
    proposal_sha256: authority.authority.proposal_sha256,
    approval_sha256: authority.authority.approval_sha256,
    activation_authority_sha256: sha256(authorityBytes),
    release_commit: authority.release.commit,
    state: "CONSUMED_SINGLE_EXECUTION_NO_RETRY",
  };
  try {
    writeFileSync(path, `${JSON.stringify(record)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
  } catch {
    fail("activation authority was already consumed; a fresh authority is required");
  }
  return path;
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
  for (const name of [
    "activation-record",
    "config-activation-record",
    "proposal-file",
    "release-manifest-file",
    "user-approval-file",
  ])
    if (!args.has(name)) fail(`--${name} is required`);
  for (const name of ["activation-record", "config-activation-record", "release-manifest-file"])
    mode(resolve(args.get(name)), "file", 0o600, name);
  const authority = validateAuthority(
    JSON.parse(readFileSync(resolve(args.get("activation-record")), "utf8")),
  );
  validateAuthoritySourceFiles(
    authority,
    resolve(args.get("proposal-file")),
    resolve(args.get("user-approval-file")),
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
  const tail = manifest.migrations.slice(-9);
  if (
    tail.length !== 9 ||
    tail.some((entry, index) => entry.version !== 37 + index) ||
    tail.some(
      (entry) =>
        sha256(readFileSync(resolve(ROOT, "packages/control-plane/migrations", entry.filename))) !==
        entry.sha256,
    )
  )
    fail("migration 0037-0045 bytes do not match the exact manifest tail");
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

function validateAuthoritySourceFiles(authority, proposalPath, approvalPath) {
  regularFile(proposalPath, "proposal file");
  regularFile(approvalPath, "user approval file");
  for (const [path, label] of [
    [authority.authority.proposal_path, "proposal"],
    [authority.authority.approval_path, "user approval"],
  ]) {
    if (
      typeof path !== "string" ||
      path === "" ||
      path.startsWith("/") ||
      path.split("/").includes("..")
    )
      fail(`${label} authority path is not a safe repository-relative path`);
  }
  const proposalBytes = readFileSync(proposalPath);
  const approvalBytes = readFileSync(approvalPath);
  if (sha256(proposalBytes) !== authority.authority.proposal_sha256)
    fail("proposal file bytes do not match activation authority");
  if (sha256(approvalBytes) !== authority.authority.approval_sha256)
    fail("user approval file bytes do not match activation authority");
  let approval;
  try {
    approval = JSON.parse(approvalBytes);
  } catch {
    fail("user approval is not valid JSON");
  }
  let validated;
  try {
    validated = validateFullLiveUserApproval({
      proposalBytes,
      approvalBytes,
      expectedProposalSha256: authority.authority.proposal_sha256,
      expectedProposalRecordCommit: approval.proposal?.proposal_record_commit,
      expectedReleaseSourceCommit: approval.proposal?.release_source_commit,
    });
  } catch {
    fail("user approval does not satisfy the exact full-live schema");
  }
  if (
    validated.authorityId !== authority.authority.authority_id ||
    validated.approvalSha256 !== authority.authority.approval_sha256 ||
    validated.approvedAt !== authority.authority.approved_at ||
    validated.expiresAt !== authority.authority.expires_at
  )
    fail("user approval identity or time does not match activation authority");
  assertFullLiveActivationBinding(authority, validated);
  if (
    git("rev-parse", `${validated.proposalRecordCommit}^`) !== validated.releaseSourceCommit ||
    git("hash-object", proposalPath) !==
      git("rev-parse", `${validated.proposalRecordCommit}:${authority.authority.proposal_path}`)
  )
    fail("proposal commit or release-source lineage is not exact");
  return true;
}

function assertFullLiveActivationBinding(authority, validated) {
  if (validated.proposalSchema !== "videoforge.v2-13-full-live-completion-proposal/v3")
    fail("superseded full-live proposal approval cannot authorize guarded activation");
  if (
    authority.database.runtime_role !== validated.exactRuntimeRole ||
    authority.database.reconciler_role !== validated.exactReconcilerRole
  )
    fail("database roles do not match the exact approved V3 role pins");
  return true;
}

function plan(authority) {
  return {
    schema_version: "videoforge-v2-13-guarded-activation-plan/v1",
    release_commit: authority.release.commit,
    migration_range: [37, 45],
    database: [
      "verify owner service identity",
      "create pgcrypto extension",
      "provision two distinct LOGIN NOINHERIT hardened roles",
      "apply exact manifest migrations through 0045",
      "apply exact runtime and reconciler ACLs",
      "read back exact ledger, role flags, table ACLs, and function ACLs",
    ],
    cloudflare: [
      "render and validate exact production config",
      "build and firewall-scan production bundle",
      "wrangler deploy dry-run",
      "recheck exact Worker/workflow absence, existing R2 binding, and unconfigured route",
      "create only the exact disabled Worker plus two exact Workflows and read back all bindings",
      `require empty secret set, put ${SECRET_NAMES.length} exact allowlisted names from mode-0600 files`,
      "read back exact secret names",
      "deploy and read back exact still-disabled rendered config",
    ],
    cleanup:
      "keep only an exact secret-free disabled quarantine; otherwise delete only absence-proven attributable Worker/Workflows",
    exact_product_resources_created: [
      authority.cloudflare.worker_name,
      authority.cloudflare.workflow_name,
      `${authority.cloudflare.workflow_name}-pair`,
    ],
    new_paid_retained_resources: 0,
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
  const workflowOperatorToken = values.get("VIDEOFORGE_V213_WORKFLOW_OPERATOR_TOKEN");
  if (
    workflowOperatorToken.length < 32 ||
    keyMaterials.some((value) => sha256(value) === sha256(workflowOperatorToken))
  )
    fail("Workflow operator token is malformed or not separate");
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
  const roles = `'${authority.database.runtime_role}','${authority.database.reconciler_role}','${authority.database.operator_role}'`;
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
  const operatorPath = join(postgresInputDirectory, "operator.database-url");
  mode(operatorPath, "file", 0o600, "operator database URL file");
  const operatorRaw = readFileSync(operatorPath, "utf8");
  if (
    operatorRaw !== operatorRaw.trim() ||
    sha256(operatorRaw) !== authority.database.operator_database_url_sha256
  )
    fail("operator database URL does not match its approved fingerprint");
  let operator;
  try {
    operator = new URL(operatorRaw);
  } catch {
    fail("operator database URL is invalid");
  }
  if (
    !["postgres:", "postgresql:"].includes(operator.protocol) ||
    operator.hostname !== authority.database.host ||
    operator.pathname.slice(1) !== authority.database.database ||
    decodeURIComponent(operator.username) !== authority.database.operator_role ||
    !operator.password ||
    operator.hash ||
    operator.searchParams.size !== 2 ||
    operator.searchParams.get("sslmode") !== "require" ||
    operator.searchParams.get("channel_binding") !== "require"
  )
    fail("operator database URL does not bind the exact approved hardened role");
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
  env.V2_13_OPERATOR_PASSWORD = decodeURIComponent(operator.password);
  const bootstrap = String.raw`\getenv runtime_password V2_13_RUNTIME_PASSWORD
\getenv reconciler_password V2_13_RECONCILER_PASSWORD
\getenv operator_password V2_13_OPERATOR_PASSWORD
CREATE EXTENSION IF NOT EXISTS pgcrypto;
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS',:'runtime_role',:'runtime_password') \gexec
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS',:'reconciler_role',:'reconciler_password') \gexec
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS',:'operator_role',:'operator_password') \gexec
`;
  psql(
    env,
    [
      "--variable",
      `runtime_role=${authority.database.runtime_role}`,
      "--variable",
      `reconciler_role=${authority.database.reconciler_role}`,
      "--variable",
      `operator_role=${authority.database.operator_role}`,
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
  psql(env, [
    "--variable",
    `operator_role=${authority.database.operator_role}`,
    "--file",
    resolve(ROOT, "deploy/v2-13/neon-full-live-operator-grants.sql"),
  ]);
  run(
    process.execPath,
    ["deploy/v2-06/apply-migrations-and-grants.mjs", "--verify-only", "--apply-grants"],
    { env },
  );
  const exactReconcilerReadback = `SELECT ((SELECT count(*)=3 AND bool_and(rolcanlogin AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolinherit AND NOT rolreplication AND NOT rolbypassrls AND rolconfig IS NULL) FROM pg_roles WHERE rolname IN ('${authority.database.runtime_role}','${authority.database.reconciler_role}','${authority.database.operator_role}')) AND NOT EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles member_role ON member_role.oid=m.member JOIN pg_roles granted_role ON granted_role.oid=m.roleid WHERE member_role.rolname IN ('${authority.database.runtime_role}','${authority.database.reconciler_role}','${authority.database.operator_role}') OR granted_role.rolname IN ('${authority.database.runtime_role}','${authority.database.reconciler_role}','${authority.database.operator_role}')) AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_roles r ON r.oid=c.relowner WHERE r.rolname IN ('${authority.database.runtime_role}','${authority.database.reconciler_role}','${authority.database.operator_role}')) AND NOT EXISTS (SELECT 1 FROM pg_namespace n JOIN pg_roles r ON r.oid=n.nspowner WHERE r.rolname IN ('${authority.database.runtime_role}','${authority.database.reconciler_role}','${authority.database.operator_role}')) AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE r.rolname IN ('${authority.database.runtime_role}','${authority.database.reconciler_role}','${authority.database.operator_role}')) AND (SELECT array_agg(p.oid::regprocedure::text ORDER BY p.oid::regprocedure::text)=ARRAY['videoforge_current_account_id()','videoforge_inspect_hosted_pair_runtime(uuid,uuid,uuid)','videoforge_load_hosted_v209_settlement_guard(uuid,uuid,uuid)','videoforge_settle_hosted_pair_cleanup_v2(uuid,uuid,uuid,jsonb,jsonb,jsonb)']::text[] FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND has_function_privilege('${authority.database.reconciler_role}',p.oid,'EXECUTE')) AND NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE grantee IN ('${authority.database.reconciler_role}','${authority.database.operator_role}') AND table_schema='public'))::text;`;
  const reconcilerReadbackWithV209 = exactReconcilerReadback.replace(
    "ARRAY['videoforge_current_account_id()'",
    "ARRAY['videoforge_complete_v209_terminal_acceptance(jsonb)','videoforge_current_account_id()'",
  );
  const result = run(
    "psql",
    ["--no-psqlrc", "--tuples-only", "--no-align", "--command", reconcilerReadbackWithV209],
    { env, capture: true },
  );
  if (result !== "true") fail("reconciler role/ACL post-readback is not exact");
  delete env.V2_13_RUNTIME_PASSWORD;
  delete env.V2_13_RECONCILER_PASSWORD;
  delete env.V2_13_OPERATOR_PASSWORD;
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

function wranglerResult(environment, args) {
  const result = spawnSync("pnpm", ["--filter", "@videoforge/web", "exec", "wrangler", ...args], {
    cwd: ROOT,
    env: environment,
    encoding: "utf8",
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) fail("wrangler absence probe failed with redacted output");
  return JSON.stringify({
    status: result.status,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  });
}

function resourceNames(bytes, label) {
  let value;
  try {
    value = JSON.parse(bytes);
  } catch {
    fail(`${label} inventory was not exact JSON`);
  }
  const names = [];
  const visit = (item) => {
    if (!item || typeof item !== "object") return;
    if (typeof item.name === "string") names.push(item.name);
    for (const child of Object.values(item)) visit(child);
  };
  visit(value);
  return [...new Set(names)].sort();
}

function assertExactAccountReadback(bytes, authority) {
  let value;
  try {
    value = JSON.parse(bytes);
  } catch {
    fail("Cloudflare account readback was not exact JSON");
  }
  if (
    !exactKeys(value, ["body", "status"]) ||
    value.status !== 200 ||
    value.body?.success !== true ||
    !value.body.result ||
    Array.isArray(value.body.result) ||
    value.body.result.id !== authority.cloudflare.account_id
  )
    fail("Cloudflare account readback was not an exact successful response");
}

async function cloudflareApiResponse(environment, authority, path) {
  let response;
  try {
    response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${authority.cloudflare.account_id}${path}`,
      {
        headers: { Authorization: `Bearer ${environment.CLOUDFLARE_API_TOKEN}` },
        method: "GET",
        redirect: "error",
      },
    );
  } catch {
    fail("Cloudflare API readback transport failed with redacted output");
  }
  let body;
  try {
    body = await response.json();
  } catch {
    fail("Cloudflare API readback was not exact JSON");
  }
  return {
    bytes: JSON.stringify({ body, status: response.status }),
    trustedDate: response.headers.get("date"),
  };
}

async function cloudflareApiReadback(environment, authority, path) {
  return (await cloudflareApiResponse(environment, authority, path)).bytes;
}

async function cloudflareWorkflowInventoryReadback(environment, authority) {
  return cloudflareApiReadback(environment, authority, WORKFLOW_INVENTORY_PATH);
}

function assertCompleteSinglePage(body, count, label) {
  const infos = [body?.result_info, body?.result?.result_info].filter(Boolean);
  if (infos.length !== 1) fail(`${label} inventory pagination metadata is missing or ambiguous`);
  const [info] = infos;
  if (
    ![info.count, info.page, info.total_count, info.total_pages].every(Number.isInteger) ||
    info.count !== count ||
    info.page !== 1 ||
    info.total_count !== count ||
    info.total_pages !== 1 ||
    (Object.hasOwn(info, "cursor") && info.cursor !== null && info.cursor !== "") ||
    (Object.hasOwn(info, "cursors") &&
      (!info.cursors ||
        typeof info.cursors !== "object" ||
        (info.cursors.after !== null &&
          info.cursors.after !== "" &&
          info.cursors.after !== undefined)))
  )
    fail(`${label} inventory pagination is incomplete`);
}

function validateAbsentInventoryReadbacks(authority, { account, absence, workflows, buckets }) {
  if (sha256(account) !== authority.cloudflare.pre_mutation_account_readback_sha256)
    fail("Cloudflare account readback changed from approved preflight");
  assertExactAccountReadback(account, authority);
  if (sha256(absence) !== authority.cloudflare.pre_mutation_worker_absence_sha256)
    fail("Cloudflare Worker absence changed from approved read-only preflight");
  let absenceResult;
  try {
    absenceResult = JSON.parse(absence);
  } catch {
    fail("Cloudflare Worker absence probe was not canonical JSON");
  }
  if (!exactKeys(absenceResult, ["body", "status"]) || absenceResult.status !== 404)
    fail("production Worker unexpectedly exists; refusing collision or overwrite");
  if (sha256(workflows) !== authority.cloudflare.pre_mutation_workflow_inventory_sha256)
    fail("Cloudflare Workflow inventory changed from approved preflight");
  let workflowResponse;
  try {
    workflowResponse = JSON.parse(workflows);
  } catch {
    fail("Cloudflare Workflow inventory was not canonical JSON");
  }
  if (
    !exactKeys(workflowResponse, ["body", "status"]) ||
    workflowResponse.status !== 200 ||
    workflowResponse.body?.success !== true
  )
    fail("Cloudflare Workflow inventory response was not successful");
  const workflowNames = resourceNames(workflows, "Cloudflare Workflow");
  assertCompleteSinglePage(workflowResponse.body, workflowNames.length, "Cloudflare Workflow");
  const intendedWorkflows = [
    authority.cloudflare.workflow_name,
    `${authority.cloudflare.workflow_name}-pair`,
  ];
  if (intendedWorkflows.some((name) => workflowNames.includes(name)))
    fail("exact production Workflow name collision detected");
  if (sha256(buckets) !== authority.cloudflare.pre_mutation_r2_inventory_sha256)
    fail("Cloudflare R2 inventory changed from approved preflight");
  let bucketResponse;
  try {
    bucketResponse = JSON.parse(buckets);
  } catch {
    fail("Cloudflare R2 inventory was not canonical JSON");
  }
  if (
    !exactKeys(bucketResponse, ["body", "status"]) ||
    bucketResponse.status !== 200 ||
    bucketResponse.body?.success !== true
  )
    fail("Cloudflare R2 inventory response was not successful");
  const bucketNames = resourceNames(buckets, "Cloudflare R2");
  assertCompleteSinglePage(bucketResponse.body, bucketNames.length, "Cloudflare R2");
  if (bucketNames.filter((name) => name === authority.cloudflare.r2_bucket_name).length !== 1)
    fail("exact preexisting R2 assets bucket is absent or ambiguous");
  return { intendedWorkflows, workflowNames };
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

function assertDisabledVersionReadback(
  versionBytes,
  authority,
  expectedCommit,
  { requireR2 = true } = {},
) {
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
  const workflowBindings = new Map([
    ["VIDEO_WORKFLOW", []],
    ["HOSTED_PAIR_WORKFLOW", []],
  ]);
  const collectWorkflowBindings = (value) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(collectWorkflowBindings);
      return;
    }
    if (workflowBindings.has(value.binding) && typeof value.name === "string")
      workflowBindings.get(value.binding).push(value.name);
    if (workflowBindings.has(value.name) && typeof value.namespace === "string")
      workflowBindings.get(value.name).push(value.namespace);
    Object.values(value).forEach(collectWorkflowBindings);
  };
  collectWorkflowBindings(version);
  const expectedValues = [
    expectedCommit,
    "DISABLED_UNQUALIFIED",
    "VIDEO_WORKFLOW",
    "HOSTED_PAIR_WORKFLOW",
    authority.cloudflare.workflow_name,
    `${authority.cloudflare.workflow_name}-pair`,
  ];
  if (requireR2) expectedValues.push("PRIVATE_ARTIFACTS", authority.cloudflare.r2_bucket_name);
  const primaryBindings = workflowBindings.get("VIDEO_WORKFLOW");
  const pairBindings = workflowBindings.get("HOSTED_PAIR_WORKFLOW");
  if (primaryBindings.length !== 1 || primaryBindings[0] !== authority.cloudflare.workflow_name)
    fail("deployed quarantine VIDEO_WORKFLOW binding is not the exact primary Workflow");
  if (pairBindings.length !== 1 || pairBindings[0] !== `${authority.cloudflare.workflow_name}-pair`)
    fail("deployed quarantine HOSTED_PAIR_WORKFLOW binding is not the exact pair Workflow");
  for (const expected of expectedValues) {
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

async function cloudflareReadOnlyPreflight(authority, environment) {
  const accountResponse = await cloudflareApiResponse(environment, authority, "");
  assertTrustedAuthorityTime(authority, accountResponse.trustedDate);
  const account = accountResponse.bytes;
  const absence = await cloudflareApiReadback(
    environment,
    authority,
    `/workers/scripts/${authority.cloudflare.worker_name}`,
  );
  const workflows = await cloudflareWorkflowInventoryReadback(environment, authority);
  const buckets = await cloudflareApiReadback(environment, authority, "/r2/buckets");
  const inventories = validateAbsentInventoryReadbacks(authority, {
    account,
    absence,
    workflows,
    buckets,
  });
  if (
    sha256(await routeReadback(authority)) !==
    authority.cloudflare.pre_mutation_route_readback_sha256
  )
    fail("production route changed from approved read-only preflight");
  await assertQuarantineRoute(authority, false);
  return inventories;
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

async function assertExactCreatedWorkflows(environment, authority, beforeNames, intendedNames) {
  const bytes = await cloudflareWorkflowInventoryReadback(environment, authority);
  let response;
  try {
    response = JSON.parse(bytes);
  } catch {
    fail("post-create Workflow inventory was not canonical JSON");
  }
  if (
    !exactKeys(response, ["body", "status"]) ||
    response.status !== 200 ||
    response.body?.success !== true
  )
    fail("post-create Workflow inventory response was not successful");
  const names = resourceNames(bytes, "Cloudflare Workflow");
  assertCompleteSinglePage(response.body, names.length, "Cloudflare Workflow");
  const expected = [...new Set([...beforeNames, ...intendedNames])].sort();
  if (JSON.stringify(names) !== JSON.stringify(expected))
    fail("post-create Workflow inventory is not the exact absence-proven pair");
}

async function recoverQuarantineCreation({
  verifyExactDisabled,
  deleteWorker,
  deleteWorkflow,
  intendedWorkflows,
  verifyAbsent,
}) {
  try {
    await verifyExactDisabled();
    return "KEPT_EXACT_DISABLED_QUARANTINE";
  } catch {
    // Only names proven absent immediately before creation are attributable to this attempt.
  }
  await deleteWorker();
  for (const name of intendedWorkflows) await deleteWorkflow(name);
  await verifyAbsent();
  return "DELETED_ATTRIBUTABLE_AND_REVERIFIED_ABSENT";
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

function workflowBootstrapConfig(value) {
  if (!Array.isArray(value.r2_buckets) || value.r2_buckets.length !== 1)
    fail("activated config does not have the exact single preexisting R2 binding");
  if (!Array.isArray(value.workflows) || value.workflows.length !== 2)
    fail("activated config does not have the exact two Workflow bindings");
  const video = value.workflows.filter((item) => item?.binding === "VIDEO_WORKFLOW");
  const pair = value.workflows.filter((item) => item?.binding === "HOSTED_PAIR_WORKFLOW");
  if (
    video.length !== 1 ||
    pair.length !== 1 ||
    typeof video[0].name !== "string" ||
    pair[0].name !== `${video[0].name}-pair`
  )
    fail("activated config does not have the exact structural Workflow bindings");
  const bootstrap = structuredClone(value);
  delete bootstrap.r2_buckets;
  return bootstrap;
}

function renderWorkflowBootstrapConfig(config, temporaryDirectory) {
  const value = workflowBootstrapConfig(JSON.parse(readFileSync(config, "utf8")));
  const path = join(temporaryDirectory, "wrangler.production.workflow-bootstrap.json");
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  return path;
}

async function cloudflarePreflight(args, authority, environment) {
  const directory = mkdtempSync(join(tmpdir(), "videoforge-v2-13-preflight-"));
  try {
    renderAndDryRunConfig(args, environment, directory);
    await cloudflareReadOnlyPreflight(authority, environment);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function readBackDisabledQuarantine(config, authority, environment, options) {
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
  assertDisabledVersionReadback(version, authority, authority.release.commit, options);
  return versionId;
}

async function cloudflareActivation(args, authority, values, environment, databaseStage) {
  const directory = mkdtempSync(join(tmpdir(), "videoforge-v2-13-activation-"));
  let config;
  let bootstrapConfig;
  let quarantineDeployed = false;
  let creationAttempted = false;
  let preflight;
  try {
    config = renderAndDryRunConfig(args, environment, directory);
    bootstrapConfig = renderWorkflowBootstrapConfig(config, directory);
    preflight = await cloudflareReadOnlyPreflight(authority, environment);
    creationAttempted = true;
    wrangler(environment, [
      "deploy",
      "--config",
      bootstrapConfig,
      "--message",
      `videoforge-v2-13-workflow-bootstrap:${authority.release.commit}`,
      "--x-auto-create",
      "true",
    ]);
    await assertExactCreatedWorkflows(
      environment,
      authority,
      preflight.workflowNames,
      preflight.intendedWorkflows,
    );
    readBackDisabledQuarantine(bootstrapConfig, authority, environment, { requireR2: false });
    await assertQuarantineRoute(authority, false);
    if (cloudflareSecretNames(bootstrapConfig, environment).length !== 0)
      fail("workflow bootstrap unexpectedly inherited secret bindings");
    wrangler(environment, [
      "deploy",
      "--config",
      config,
      "--message",
      `videoforge-v2-13-disabled-quarantine:${authority.release.commit}`,
      "--x-auto-create",
      "false",
    ]);
    readBackDisabledQuarantine(config, authority, environment);
    quarantineDeployed = true;
    await assertExactCreatedWorkflows(
      environment,
      authority,
      preflight.workflowNames,
      preflight.intendedWorkflows,
    );
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
      async afterPut() {
        readBackDisabledQuarantine(config, authority, environment);
        await assertExactCreatedWorkflows(
          environment,
          authority,
          preflight.workflowNames,
          preflight.intendedWorkflows,
        );
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
    if (creationAttempted && config && preflight) {
      try {
        await recoverQuarantineCreation({
          async verifyExactDisabled() {
            if (!quarantineDeployed) fail("quarantine deploy did not complete");
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
            await assertExactCreatedWorkflows(
              environment,
              authority,
              preflight.workflowNames,
              preflight.intendedWorkflows,
            );
            await assertQuarantineRoute(authority, false);
            if (cloudflareSecretNames(config, environment).length !== 0)
              fail("rollback quarantine retained a secret binding");
          },
          deleteWorker() {
            wranglerResult(environment, [
              "delete",
              authority.cloudflare.worker_name,
              "--config",
              config,
              "--force",
            ]);
          },
          deleteWorkflow(name) {
            wranglerResult(environment, ["workflows", "delete", name, "--config", config]);
          },
          intendedWorkflows: preflight.intendedWorkflows,
          verifyAbsent() {
            return cloudflareReadOnlyPreflight(authority, environment);
          },
        });
      } catch {
        fail(
          "quarantine was neither exact-disabled nor deletable with original absence reverified",
        );
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
    "proposal-file",
    "release-manifest-file",
    "user-approval-file",
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
  const authorityBytes = readFileSync(resolve(args.get("activation-record")));
  validateAuthoritySourceFiles(
    authority,
    resolve(args.get("proposal-file")),
    resolve(args.get("user-approval-file")),
  );
  consumeAuthorityOnce(authority, authorityBytes);
  const evidenceBase = {
    schema_version: "videoforge-v2-13-guarded-activation-evidence/v1",
    authority_id: authority.authority.authority_id,
    proposal_sha256: authority.authority.proposal_sha256,
    approval_sha256: authority.authority.approval_sha256,
    activation_authority_sha256: sha256(authorityBytes),
    commit: authority.release.commit,
    secret_names: SECRET_NAMES,
    secret_values_written_to_evidence: false,
    external_spend_cap_usd: 0,
    exact_product_resource_creation_authorized: true,
    new_paid_retained_resources_authorized: false,
    other_resource_creation_authorized: false,
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
      migration_ledger: "45/45 exact",
      role_acl_readback: "exact",
      secret_name_readback: `${SECRET_NAMES.length}/${SECRET_NAMES.length} exact`,
      secret_value_fingerprints: "matched authority before mutation",
      deployment_attempted: true,
      exact_product_resources_created: 3,
      new_paid_retained_resources: 0,
    };
    writeEvidence(args.get("evidence-output"), {
      ...evidenceBase,
      outcome: "SUCCEEDED",
      migration_ledger: "45/45 exact",
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
  assertFullLiveActivationBinding,
  assertDisabledVersionReadback,
  assertTrustedAuthorityTime,
  CONFIRMATION,
  consumeAuthorityOnce,
  extractSingleActiveVersion,
  SECRET_NAMES,
  plan,
  protectedSecrets,
  recoverQuarantineCreation,
  rolePrecheckQuery,
  secretMutationTransaction,
  safeEnvironment,
  validateSoulxApprovalRecords,
  validateAuthoritySourceFiles,
  validateAbsentInventoryReadbacks,
  validateAuthority,
  WORKFLOW_INVENTORY_PATH,
  workflowBootstrapConfig,
};

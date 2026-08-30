import { spawn as spawnChild, spawnSync } from "node:child_process";
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import {
  createPromotionDatabaseAdapter,
  promoteQualifiedProduction,
  reconcileQualifiedProductionCleanup,
} from "./promote-qualified-production.mjs";
import {
  APPROVED_WRANGLER_OAUTH_SCOPES,
  refreshWranglerOAuthReadback,
  wranglerOAuthConfigPath,
  WRANGLER_OAUTH_CONFIG_ENV,
} from "./guarded-activation.mjs";
import { validateMaterializationSeedShape } from "./full-live-orchestration-authority.mjs";
import { EXACT_PREDECESSOR_RELEASE_ATTEMPT } from "./validate-full-live-approval.mjs";
import {
  MEDIA_WORKER_RELEASE_HTML_URL,
  MEDIA_WORKER_RELEASE_MANIFEST,
  MEDIA_WORKER_RELEASE_MANIFEST_NAME,
  MEDIA_WORKER_RELEASE_MANIFEST_SHA256,
  MEDIA_WORKER_RELEASE_MANIFEST_SIZE_BYTES,
  MEDIA_WORKER_RELEASE_MANIFEST_URL,
  MEDIA_WORKER_RELEASE_PUBLISHED_AT,
  MEDIA_WORKER_RELEASE_READBACK_PARENT_OPERATION_ID,
  MEDIA_WORKER_RELEASE_READBACK_SCHEMA,
  MEDIA_WORKER_RELEASE_REPOSITORY,
  MEDIA_WORKER_RELEASE_TAG,
  MEDIA_WORKER_RELEASE_TARGET_COMMIT,
  readMediaWorkerReleaseReadback,
} from "./media-worker-release-readback.mjs";
import { parseService, validateServiceFile } from "../v2-06/validate-pg-service.mjs";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const TAG = "videoforge-v2-13-release-20260826-v3";
const APPROVAL_BRANCH = "codex/serverless-v2-roadmap-v4";
const COMMIT = /^[0-9a-f]{40}$/u;
const HASH = /^sha256:[0-9a-f]{64}$/u;
const RUNPOD_ACCOUNT_ID_SHA256 =
  "sha256:ce23456f35fb79195520689203584405ad191e8461e87f413ede02f01168143c";
const RUNPOD_PER_MUTATION_ADMISSION_SCHEMA = "videoforge.v213-runpod-per-mutation-admission/v2";
const RUNPOD_PER_MUTATION_OPERATION_IDS = new Set([
  "mage-live-qualification",
  "soulx-live-qualification",
  "create-exact-max-one-endpoints",
  "v2-09-short-hosted-project",
  "v2-10-operator-free-ranga-pilot",
  "v2-11-two-concurrent-owned-projects",
  "v2-12-long-output",
  "v2-13-final-two-lane-smoke",
]);
const RUNPOD_ACCEPTANCE_OPERATION_IDS = new Set(
  [...RUNPOD_PER_MUTATION_OPERATION_IDS].filter((operationId) => operationId.startsWith("v2-")),
);
const RUNPOD_SERVERLESS_FLEX_CATALOG_URL =
  "https://api.runpod.io/v2/catalog/gpus?include=AVAILABILITY&product=SERVERLESS";
const RUNPOD_SERVERLESS_FLEX_RATE_SOURCE =
  "https://docs.runpod.io/serverless/endpoints/endpoint-configurations";
const RUNPOD_RETAINED_LANES = Object.freeze([
  Object.freeze({
    lane: "mage",
    volumeIdSha256: "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619",
    volumeManifestSha256: "sha256:cebcd5c6233c2eae32f26ced7510acef8192f0d92d7ec3e9dd3ee881d66d205b",
  }),
  Object.freeze({
    lane: "soulx",
    volumeIdSha256: "sha256:2a8633e14bbecab54f52e2ae7b5b06bfa562b09a6ac781fe0985eb28e70587be",
    volumeManifestSha256: "sha256:995a8e478b6a3265d5a116ca283229ad0d358a5348f16f851dc0fed564bf5626",
  }),
]);
const SOULX_WORKFLOW_REGISTRATION_EVIDENCE_SCHEMA =
  "videoforge.v213-soulx-workflow-registration-evidence/v1";
const SOULX_WORKFLOW_REGISTRATION_REPOSITORY = "Pala-LakshmanSai/videoforge";
const SOULX_WORKFLOW_REGISTRATION_DEFAULT_BRANCH = "main";
const SOULX_WORKFLOW_REGISTRATION_FILE = "avatar-primary-serverless-image.yml";
const SOULX_WORKFLOW_REGISTRATION_PATH = `.github/workflows/${SOULX_WORKFLOW_REGISTRATION_FILE}`;
const SOULX_WORKFLOW_REGISTRATION_NAME = "avatar-primary-serverless-image";
const SOULX_WORKFLOW_REGISTRATION_EVIDENCE_KEYS = Object.freeze([
  "schema_version",
  "repository",
  "default_branch",
  "default_branch_commit",
  "workflow_file",
  "workflow_name",
  "workflow_path",
  "default_branch_workflow_sha256",
  "release_source_commit",
  "release_source_workflow_sha256",
  "registration_state",
  "materialized",
  "bound_to_release_source",
  "evidence_sha256",
]);
const EXACT_DATABASE_IDENTITY = Object.freeze({
  database: "neondb",
  host: "ep-sparkling-dew-azjhkwg6-pooler.c-3.ap-southeast-1.aws.neon.tech",
  owner_role: "neondb_owner",
});
const EXACT_DATABASE_IDENTITY_SHA256 =
  "sha256:7f2c802c531f4e5630d6a15b2f26bf65ea04f599b28c19fc3daa5d741c7567d7";
const GUARDED_SECRET_NAMES = Object.freeze([
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
const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const BRIDGE_PATH = "apps/web/src/server/providers/v213-full-live-cli.ts";
const BRIDGE_LOADER_PATH = "apps/web/node_modules/tsx/dist/loader.mjs";
const BRIDGE_LOADER_PACKAGE_PATH = "node_modules/.pnpm/tsx@4.20.5/node_modules/tsx/dist/loader.mjs";
const BRIDGE_LOADER_SOURCE_SHA256 =
  "sha256:0b1c5b86192772fe9257710e739959cee5947c11ae1f93b61abfaa9b80c6def1";
const BRIDGE_TRANSPORT_PATH = "apps/web/src/server/providers/v213-runpod-dual-lane-transport.ts";
const BRIDGE_CLI_SOURCE_SHA256 =
  "sha256:63a93988fc68346d6da7167f24c8f7adf3238ea47e98114396625e5d7a6742af";
const PREQUALIFICATION_MIGRATION_MANIFEST_PATH = "packages/control-plane/migrations/manifest.json";
const PREQUALIFICATION_OPERATOR_GRANTS_PATH = "deploy/v2-13/neon-full-live-operator-grants.sql";
const PREQUALIFICATION_MIGRATION_MANIFEST_SHA256 = sha256(
  readFileSync(resolve(ROOT, PREQUALIFICATION_MIGRATION_MANIFEST_PATH)),
);
const PREQUALIFICATION_OPERATOR_GRANTS_SHA256 = sha256(
  readFileSync(resolve(ROOT, PREQUALIFICATION_OPERATOR_GRANTS_PATH)),
);
const BRIDGE_CONFIRMATION = "EXECUTE_EXACT_V2_13_TYPESCRIPT_BRIDGE_COMMAND";
const RELEASE_CERTIFICATION_CONFIRMATION = "EXECUTE_EXACT_V2_13_LOCAL_RELEASE_CERTIFICATION";
const RELEASE_CERTIFICATION_REQUEST_SCHEMA =
  "videoforge.v213-local-release-certification-request/v1";
const CLEANUP_RECEIPT_CONFIRMATION = "FINALIZE_EXACT_V2_13_CLEANUP_RECEIPT";
const CLEANUP_RECEIPT_REQUEST_SCHEMA =
  "videoforge.v213-local-cleanup-receipt-finalization-request/v2";
const BRIDGE_CHILD_MAX_TIMEOUT_MS = 1_800_000;
const BRIDGE_CLEANUP_CHILD_MAX_TIMEOUT_MS = 60_000;
const RELEASE_CERTIFICATION_CHILD_MAX_TIMEOUT_MS = 60_000;
const CLEANUP_RECEIPT_CHILD_MAX_TIMEOUT_MS = 60_000;
const EARLY_CLEANUP_INPUT_SCHEMA = "videoforge.v213-full-live-early-cleanup-input/v1";
const PREQUALIFICATION_SCHEMA = "videoforge.v213-prequalification-database-bootstrap-result/v4";
const PRODUCTION_SECRET_BOOTSTRAP_SCHEMA = "videoforge.v213-production-secret-bootstrap/v1";
const CREDENTIAL_BOOTSTRAP_RECEIPT_SCHEMA = "videoforge.v2-13-credential-bootstrap-result/v1";
const CREDENTIAL_BOOTSTRAP_RECEIPT_SHA256 =
  "sha256:35caf042a18f6f4b42f264d96e52926856bcc387890c4925f512f2bf2c6c1eab";
const CREDENTIAL_BOOTSTRAP_SECRET_HASHES = Object.freeze({
  GOOGLE_CLIENT_ID: "sha256:0150569d559bc69055805f48be9d54e9748a1fa34e6dffa6c293701b9814d932",
  GOOGLE_CLIENT_SECRET: "sha256:c4d12264294b3275aebe6b8a51eb5a9f4a5a599c7694f48bcf8ba4422c8c6cfb",
  R2_ACCESS_KEY_ID: "sha256:a322bcb37f84d28ddd0fd841f0eb3ad2feaf368f71c21deece4f9d1f8433e335",
  R2_SECRET_ACCESS_KEY: "sha256:227e83b53468d6053b983a844473e04cbde8eff81c27b499127f106c394a900e",
});
const EXACT_CREDENTIAL_BOOTSTRAP_BINDING = Object.freeze({
  receiptSchema: CREDENTIAL_BOOTSTRAP_RECEIPT_SCHEMA,
  receiptSha256: CREDENTIAL_BOOTSTRAP_RECEIPT_SHA256,
  secretHashes: CREDENTIAL_BOOTSTRAP_SECRET_HASHES,
});
const DATABASE_ROLE_CREDENTIAL_BUNDLE_SCHEMA = "videoforge.v213-database-role-credential-bundle/v1";
const DATABASE_ROLE_CREDENTIAL_BUNDLE_NAME = "database-role-credentials.json";
const DATABASE_ROLE_CREDENTIAL_CLEANUP_SCHEMA =
  "videoforge.v213-database-role-credential-cleanup/v1";
const OUTER_CONSUMPTION_SCHEMA_V2 = "videoforge.v2-13-full-live-orchestration-consumption/v2";
const OUTER_CONSUMPTION_SCHEMA_V3 = "videoforge.v2-13-full-live-orchestration-consumption/v3";
const PREQUALIFICATION_OPERATOR_ROLE = "videoforge_hosted_operator";
const PREQUALIFICATION_RUNTIME_ROLE = "videoforge_hosted_runtime";
const PREQUALIFICATION_RECONCILER_ROLE = "videoforge_hosted_reconciler";
const PREQUALIFICATION_RECEIPT_NAME = "prequalification-database-bootstrap.json";
const PREQUALIFICATION_RECOVERY_MODES = Object.freeze([
  "FRESH_36_TO_49",
  "RESUME_EXACT_PREFIX",
  "VERIFIED_EXISTING_49",
]);
const PREQUALIFICATION_LEDGER_PREFIX_COUNTS = Object.freeze([
  36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49,
]);
const PREQUALIFICATION_OPERATOR_FUNCTIONS = Object.freeze([
  "videoforge_claim_v213_bridge_command(jsonb)",
  "videoforge_claim_v213_cleanup_bridge_command(jsonb)",
  "videoforge_claim_v213_cleanup_receipt_intent(jsonb)",
  "videoforge_claim_v213_operation(jsonb)",
  "videoforge_claim_v213_qualification_materialization(jsonb)",
  "videoforge_claim_v213_stage_authority(jsonb)",
  "videoforge_complete_v213_stage_authority(text,text,jsonb)",
  "videoforge_load_v213_bridge_acceptance_call(jsonb)",
  "videoforge_load_v213_cleanup_scope(uuid)",
  "videoforge_load_v213_signed_evidence(jsonb)",
  "videoforge_load_v213_stage_handoff(uuid,text,text)",
  "videoforge_materialize_v213_release_facts(jsonb)",
  "videoforge_persist_v213_jit_materialization(jsonb)",
  "videoforge_persist_v213_qualification_materialization(jsonb)",
  "videoforge_persist_v213_release_certification(jsonb)",
  "videoforge_persist_v213_release_chrome(jsonb)",
  "videoforge_prepare_v213_jit_operation(jsonb)",
  "videoforge_project_v213_jit_operation(jsonb)",
  "videoforge_project_v213_release_certification(jsonb)",
  "videoforge_project_v213_release_chrome(jsonb)",
  "videoforge_promote_hosted_full_live(uuid,uuid,jsonb)",
  "videoforge_publish_v213_qualified_deployments(jsonb)",
  "videoforge_read_v213_jit_materialization(jsonb)",
  "videoforge_read_v213_operation_receipt(jsonb)",
  "videoforge_read_v213_operator_evidence(jsonb)",
  "videoforge_read_v213_qualification_materialization(jsonb)",
  "videoforge_read_v213_release_certification(jsonb)",
  "videoforge_read_v213_release_chrome(jsonb)",
  "videoforge_read_v213_release_fact_materialization(jsonb)",
  "videoforge_record_hosted_full_live_authority(uuid,jsonb)",
  "videoforge_record_v213_acceptance_authority(jsonb)",
  "videoforge_record_v213_cloudflare_activation(uuid,jsonb)",
  "videoforge_record_v213_cloudflare_rollback(uuid,jsonb)",
  "videoforge_record_v213_disabled_promotion_closure(uuid,jsonb)",
  "videoforge_record_v213_operation_receipt(jsonb)",
  "videoforge_record_v213_receipt_verification_key(text,text)",
  "videoforge_record_v213_signed_evidence(jsonb)",
  "videoforge_record_v213_stage_authority(uuid,jsonb)",
  "videoforge_record_v213_static_release_descriptor(jsonb)",
  "videoforge_record_v213_workflow_start_authority(uuid,uuid,text,timestamptz)",
  "videoforge_transition_v213_bridge_command(jsonb)",
  "videoforge_transition_v213_operation(jsonb)",
  "videoforge_v213_production_length_repository(jsonb)",
  "videoforge_v213_short_pilot_repository(jsonb)",
  "videoforge_verify_v213_jit_artifact(jsonb)",
]);
const PREQUALIFICATION_RECEIPT_FIELDS = Object.freeze([
  "schema_version",
  "full_live_authority_id",
  "outer_state_sha256",
  "materialization_seed_sha256",
  "database_identity_sha256",
  "ledger_before_count",
  "ledger_before_sha256",
  "ledger_after_sha256",
  "operator_acl_sha256",
  "operator_database_url_sha256",
  "runtime_database_url_sha256",
  "reconciler_database_url_sha256",
  "database_role_credential_bundle_sha256",
  "credential_bootstrap_receipt_sha256",
  "production_secret_bootstrap_sha256",
  "production_secrets_sha256",
  "production_secret_file_sha256s",
  "internal_credential_key_ids",
  "pgcrypto_sha256",
  "recovery_mode",
  "runpod_calls",
  "cloudflare_calls",
  "application_secret_reads",
]);
const requireWeb = createRequire(resolve(ROOT, "apps/web/package.json"));
const BRIDGE_COMMANDS = Object.freeze([
  "fresh-live-preflight",
  "mage-live-qualification",
  "soulx-live-qualification",
  "create-exact-max-one-endpoints",
  "v2-09-short-hosted-project",
  "v2-10-operator-free-ranga-pilot",
  "v2-11-two-concurrent-owned-projects",
  "v2-12-long-output",
  "v2-13-final-two-lane-smoke",
  "restore-endpoints-max-one",
  "prove-zero-workers",
  "read-settled-billing",
  "reconcile-exact-resources",
]);
const CLEANUP_BRIDGE_COMMANDS = new Set([
  "restore-endpoints-max-one",
  "prove-zero-workers",
  "read-settled-billing",
  "reconcile-exact-resources",
]);
const RELEASE_CERTIFICATION_PREDECESSORS = Object.freeze([
  ["v2-13-final-two-lane-smoke", "signedSmokeEvidenceSha256"],
  ["restore-endpoints-max-one", "proofSha256"],
  ["prove-zero-workers", "proofSha256"],
  ["read-settled-billing", "proofSha256"],
  ["reconcile-exact-resources", "proofSha256"],
]);
const BRIDGE_PROTECTED_FILES = Object.freeze([
  ["RUNPOD_API_KEY_FD", "VIDEOFORGE_V2_13_RUNPOD_API_KEY_FILE"],
  ["OPERATOR_DATABASE_URL_FD", "VIDEOFORGE_V2_13_OPERATOR_DATABASE_URL_FILE"],
  ["RUNTIME_DATABASE_URL_FD", "VIDEOFORGE_V2_13_RUNTIME_DATABASE_URL_FILE"],
  ["RECONCILER_DATABASE_URL_FD", "VIDEOFORGE_V2_13_RECONCILER_DATABASE_URL_FILE"],
  ["WORKER_ORIGIN_FD", "VIDEOFORGE_V2_13_WORKER_ORIGIN_FILE"],
  ["WORKER_OPERATOR_BEARER_FD", "VIDEOFORGE_V2_13_WORKER_OPERATOR_BEARER_FILE"],
  ["PRODUCTION_SECRETS_FD", "VIDEOFORGE_V2_13_PRODUCTION_SECRETS_FILE"],
]);
const QUALIFICATION_PROTECTED_INPUTS = Object.freeze({
  avatarSource: Object.freeze({
    path: ".videoforge/private/vf-9-24u/new-avatar-sample.png",
    sha256: "sha256:37f07580badf2c459db496e0a74a15e524534b91432478d5e84e8f084e6b1e83",
    sizeBytes: 1_912_005,
    contentType: "image/png",
  }),
  soulx2s: Object.freeze({
    path: ".videoforge/private/cp07-inputs/echo-span-2s-padded.wav",
    sha256: "sha256:b7ad261af40caf574e9edadf856f28ccddc306a109d15523c81a427ec38e72d3",
    sizeBytes: 80_278,
    contentType: "audio/wav",
  }),
  soulx4s: Object.freeze({
    path: ".videoforge/private/cp07-inputs/echo-span-4s-padded.wav",
    sha256: "sha256:076f477f512835a3e606b3312682cf1b4a3eb62e211300843023840969d09019",
    sizeBytes: 160_278,
    contentType: "audio/wav",
  }),
  soulx6s: Object.freeze({
    path: ".videoforge/private/cp07-inputs/echo-span-6s-padded.wav",
    sha256: "sha256:c7c67903aae4ca8a235792402c64ffa69be3bd423babd4e0447726db27539761",
    sizeBytes: 212_118,
    contentType: "audio/wav",
  }),
  soulx10s: Object.freeze({
    path: ".videoforge/private/vf-9-24u/new-avatar-third-10.00s.wav",
    sha256: "sha256:51765f504d1a241af1aa05040cd06bbf377768bc3b2806000191f23855e577cb",
    sizeBytes: 320_278,
    contentType: "audio/wav",
  }),
});

const fail = (code, detail = "") => {
  throw new Error(`V2_13_FULL_LIVE_ADAPTER_${code}${detail ? `:${detail}` : ""}`);
};

const CHILD_TERMINATION_GRACE_MS = 2_000;
const PROMOTION_CHILD_MAX_TIMEOUT_MS = 5 * 60_000;

/**
 * Run one bounded child without ever resolving/rejecting before the child has closed. Cancellation
 * first requests cooperative SIGTERM, then escalates to SIGKILL for the isolated process group.
 * This is the quiescence boundary used by bridge children and mutating Wrangler commands: the
 * executor cannot begin cleanup while any child from the cancelled operation can still act.
 */
async function runCancellableChildProcess({
  command,
  args,
  options = {},
  timeoutMs,
  cancellationSignal,
  timeoutCode,
  cancellationCode,
  executionCode,
  spawn = spawnChild,
}) {
  if (
    typeof command !== "string" ||
    command === "" ||
    !Array.isArray(args) ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    !(cancellationSignal === undefined || cancellationSignal instanceof AbortSignal) ||
    [timeoutCode, cancellationCode, executionCode].some(
      (value) => typeof value !== "string" || value === "",
    )
  )
    fail("CHILD_PROCESS_CONTRACT");
  if (cancellationSignal?.aborted === true) fail(cancellationCode);

  let child;
  try {
    child = spawn(command, args, {
      ...options,
      detached: true,
      encoding: undefined,
    });
  } catch {
    fail(executionCode);
  }
  if (child === null || typeof child !== "object" || typeof child.once !== "function")
    fail(executionCode);

  const stdoutChunks = [];
  const stderrChunks = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let terminalReason = null;
  let childError = null;
  let closed = false;
  let killTimer;
  const maximumBytes = options.maxBuffer ?? 4 * 1024 * 1024;
  const capture = (chunks, kind) => (value) => {
    const bytes = Buffer.from(value);
    if (kind === "stdout") stdoutBytes += bytes.length;
    else stderrBytes += bytes.length;
    if (stdoutBytes > maximumBytes || stderrBytes > maximumBytes) {
      terminalReason ??= "execution";
      terminate("SIGTERM");
      return;
    }
    chunks.push(bytes);
  };
  child.stdout?.on("data", capture(stdoutChunks, "stdout"));
  child.stderr?.on("data", capture(stderrChunks, "stderr"));

  const terminate = (signal) => {
    if (closed) return;
    try {
      if (Number.isSafeInteger(child.pid) && child.pid > 0) process.kill(-child.pid, signal);
      else child.kill?.(signal);
    } catch (error) {
      if (error?.code !== "ESRCH") childError ??= error;
    }
    if (signal === "SIGTERM" && killTimer === undefined)
      killTimer = setTimeout(() => terminate("SIGKILL"), CHILD_TERMINATION_GRACE_MS);
  };
  const requestCancellation = () => {
    terminalReason ??= "cancelled";
    terminate("SIGTERM");
  };
  cancellationSignal?.addEventListener("abort", requestCancellation, { once: true });
  if (cancellationSignal?.aborted === true) requestCancellation();
  const timeout = setTimeout(() => {
    terminalReason ??= "timeout";
    terminate("SIGTERM");
  }, timeoutMs);

  return await new Promise((resolveResult, rejectResult) => {
    child.once("error", (error) => {
      childError = error;
    });
    child.once("close", (status, signal) => {
      closed = true;
      clearTimeout(timeout);
      clearTimeout(killTimer);
      cancellationSignal?.removeEventListener("abort", requestCancellation);
      const rejectCode =
        terminalReason === "cancelled"
          ? cancellationCode
          : terminalReason === "timeout"
            ? timeoutCode
            : terminalReason === "execution" || childError !== null
              ? executionCode
              : null;
      if (rejectCode !== null) {
        rejectResult(new Error(`V2_13_FULL_LIVE_ADAPTER_${rejectCode}`));
        return;
      }
      resolveResult(
        Object.freeze({
          status,
          signal,
          stdout: Buffer.concat(stdoutChunks, stdoutBytes).toString(options.encoding ?? "utf8"),
          stderr: Buffer.concat(stderrChunks, stderrBytes).toString(options.encoding ?? "utf8"),
        }),
      );
    });
  });
}

/** Hash the closed Wrangler dry-output tree, never Wrangler's console text. */
function hashV213DryOutputBundle(directory) {
  const root = resolve(directory);
  const files = [];
  const walk = (current) => {
    const names = readdirSync(current).sort((left, right) =>
      Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")),
    );
    for (const name of names) {
      const path = resolve(current, name);
      if (!path.startsWith(`${root}/`)) fail("PROMOTION_DRY_OUTPUT_PATH");
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) fail("PROMOTION_DRY_OUTPUT_SYMLINK");
      if (stat.isDirectory()) {
        walk(path);
        continue;
      }
      if (!stat.isFile()) fail("PROMOTION_DRY_OUTPUT_ENTRY");
      const bytes = readFileSync(path);
      if (bytes.length !== stat.size) fail("PROMOTION_DRY_OUTPUT_RACE");
      files.push({
        path: relative(root, path).replaceAll("\\", "/"),
        bytes: bytes.length,
        sha256: sha256(bytes),
      });
    }
  };
  try {
    if (!lstatSync(root).isDirectory()) fail("PROMOTION_DRY_OUTPUT_DIRECTORY");
    walk(root);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("V2_13_FULL_LIVE_ADAPTER_")) throw error;
    fail("PROMOTION_DRY_OUTPUT_DIRECTORY");
  }
  if (files.length === 0) fail("PROMOTION_DRY_OUTPUT_EMPTY");
  return canonicalSha256({
    schemaVersion: "videoforge.v213-wrangler-dry-output-manifest/v1",
    files,
  });
}

function productionCommand(command, args, { environment = process.env, env, input } = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    env: env ?? environment,
    input,
    maxBuffer: 4 * 1024 * 1024,
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function boundedCommand(command, args, timeoutMs, environment = process.env) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    env: environment,
    maxBuffer: 4 * 1024 * 1024,
    timeout: timeoutMs,
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function closedTrustedTimeCommand(command, args, timeoutMs = 12_000, spawn = spawnSync) {
  const result = spawn(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      NO_PROXY: "*",
      no_proxy: "*",
    },
    maxBuffer: 4 * 1024 * 1024,
    timeout: timeoutMs,
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function prepareReleaseSourceWorktree(targetCommit) {
  if (!COMMIT.test(targetCommit ?? "")) fail("RELEASE_SOURCE_WORKTREE_COMMIT");
  const parent = mkdtempSync(resolve(tmpdir(), "videoforge-v213-release-source-"));
  const worktree = resolve(parent, "worktree");
  let added = false;
  try {
    exactCommand(productionCommand, "git", ["cat-file", "-e", `${targetCommit}^{commit}`]);
    exactCommand(productionCommand, "git", ["worktree", "add", "--detach", worktree, targetCommit]);
    added = true;
    const head = exactCommand(productionCommand, "git", ["-C", worktree, "rev-parse", "HEAD"]);
    const status = exactCommand(productionCommand, "git", [
      "-C",
      worktree,
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
    ]);
    if (head.stdout.trim() !== targetCommit || status.stdout !== "")
      fail("RELEASE_SOURCE_WORKTREE_READBACK");
    return Object.freeze({
      root: worktree,
      cleanup() {
        if (added)
          exactCommand(productionCommand, "git", ["worktree", "remove", "--force", worktree]);
        rmSync(parent, { recursive: true, force: true });
      },
    });
  } catch (error) {
    if (added) productionCommand("git", ["worktree", "remove", "--force", worktree]);
    rmSync(parent, { recursive: true, force: true });
    throw error;
  }
}

function exactCommand(run, command, args, allowedStatuses = [0]) {
  const result = run(command, args);
  if (
    result === null ||
    typeof result !== "object" ||
    !allowedStatuses.includes(result.status) ||
    typeof result.stdout !== "string" ||
    typeof result.stderr !== "string"
  )
    fail("COMMAND", `${command}:${args[0] ?? ""}`);
  return result;
}

function exactRemoteTag(stdout, tag, expectedCommit, allowAbsent = false) {
  const lines = stdout.trim() === "" ? [] : stdout.trim().split("\n");
  if (allowAbsent && lines.length === 0) return false;
  if (
    lines.length !== 1 ||
    lines[0] !== `${expectedCommit}\trefs/tags/${tag}` ||
    !COMMIT.test(expectedCommit)
  )
    fail("REMOTE_TAG_READBACK");
  return true;
}

function readAuthenticatedGithubTime({
  run = closedTrustedTimeCommand,
  spawnTimeoutMs = 12_000,
  maximumAttempts = 3,
} = {}) {
  if (!Number.isInteger(maximumAttempts) || maximumAttempts < 1 || maximumAttempts > 3)
    fail("TRUSTED_TIME_ATTEMPTS");
  const args = [
    "--disable",
    "--silent",
    "--show-error",
    "--head",
    "--proto",
    "=https",
    "--tlsv1.2",
    "--connect-timeout",
    "5",
    "--max-time",
    "10",
    "https://api.github.com/",
  ];
  let lastError;
  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    try {
      const response = exactCommand(
        (command, commandArgs) => run(command, commandArgs, spawnTimeoutMs),
        "curl",
        args,
      );
      const dates = response.stdout
        .split(/\r?\n/u)
        .filter((line) => /^date:/iu.test(line))
        .map((line) => line.slice(line.indexOf(":") + 1).trim());
      if (dates.length !== 1 || Number.isNaN(Date.parse(dates[0]))) fail("TRUSTED_TIME_READBACK");
      return new Date(Date.parse(dates[0])).toISOString();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function createGitReleaseAdapters({ run = productionCommand } = {}) {
  return Object.freeze({
    "release-tag-create": async (_operation, state) => {
      const tag = state.release_ref?.exact_tag_name;
      const target = state.release_ref?.exact_target_commit;
      if (tag !== TAG || !COMMIT.test(target ?? "")) fail("RELEASE_LINEAGE");
      const reconciliationOnly =
        state.release_ref?.mode === "PREDECESSOR_BOUND_RECONCILIATION_ONLY" ||
        state.release_ref?.state === "AUTHORIZED_PENDING_RECONCILIATION";
      const local = exactCommand(
        run,
        "git",
        ["show-ref", "--verify", "--quiet", `refs/tags/${tag}`],
        [0, 1],
      );
      if (local.stdout !== "") fail("LOCAL_TAG_PROBE_OUTPUT");
      if (local.status === 0) {
        const localReadback = exactCommand(run, "git", ["rev-parse", `refs/tags/${tag}^{commit}`]);
        if (localReadback.stdout.trim() !== target) fail("LOCAL_TAG_COLLISION");
      }
      const remote = exactCommand(run, "git", [
        "ls-remote",
        "--refs",
        "origin",
        `refs/tags/${tag}`,
      ]);
      const remoteAlreadyExact = exactRemoteTag(remote.stdout, tag, target, true);
      if (reconciliationOnly) {
        if (!remoteAlreadyExact) fail("PREDECESSOR_REMOTE_TAG_ABSENT");
        return {
          actualUsd: 0,
          created: false,
          verifiedExistingExact: true,
          exactTagReady: true,
          mutationPerformed: false,
          targetCommit: target,
        };
      }
      const created = local.status === 1;
      if (created) exactCommand(run, "git", ["tag", tag, target]);
      const readback = exactCommand(run, "git", ["rev-parse", `refs/tags/${tag}^{commit}`]);
      if (readback.stdout.trim() !== target) fail("LOCAL_TAG_CREATE_READBACK");
      return {
        actualUsd: 0,
        created,
        verifiedExistingExact: local.status === 0 || remoteAlreadyExact,
        exactTagReady: true,
        mutationPerformed: created,
        targetCommit: target,
      };
    },
    "release-tag-push": async (_operation, state) => {
      const tag = state.release_ref?.exact_tag_name;
      const target = state.release_ref?.exact_target_commit;
      if (tag !== TAG || !COMMIT.test(target ?? "")) fail("RELEASE_LINEAGE");
      const reconciliationOnly =
        state.release_ref?.mode === "PREDECESSOR_BOUND_RECONCILIATION_ONLY" ||
        state.release_ref?.state === "AUTHORIZED_PENDING_RECONCILIATION";
      if (!reconciliationOnly) {
        const local = exactCommand(run, "git", ["rev-parse", `refs/tags/${tag}^{commit}`]);
        if (local.stdout.trim() !== target) fail("LOCAL_TAG_PUSH_READBACK");
      }
      const remote = exactCommand(run, "git", [
        "ls-remote",
        "--refs",
        "origin",
        `refs/tags/${tag}`,
      ]);
      const alreadyExact = exactRemoteTag(remote.stdout, tag, target, true);
      if (reconciliationOnly && !alreadyExact) fail("PREDECESSOR_REMOTE_TAG_ABSENT");
      if (!alreadyExact)
        exactCommand(run, "git", [
          "push",
          "--porcelain",
          "origin",
          `refs/tags/${tag}:refs/tags/${tag}`,
        ]);
      return {
        actualUsd: 0,
        tagName: tag,
        targetCommit: target,
        pushPerformed: !alreadyExact,
        reconciledExistingExact: alreadyExact,
        mutationPerformed: !alreadyExact,
        forceUsed: false,
      };
    },
    "release-tag-readback": async (_operation, state) => {
      const tag = state.release_ref?.exact_tag_name;
      const target = state.release_ref?.exact_target_commit;
      if (tag !== TAG || !COMMIT.test(target ?? "")) fail("RELEASE_LINEAGE");
      const remote = exactCommand(run, "git", [
        "ls-remote",
        "--refs",
        "origin",
        `refs/tags/${tag}`,
      ]);
      exactRemoteTag(remote.stdout, tag, target);
      return { actualUsd: 0, tagName: tag, targetCommit: target, mutationPerformed: false };
    },
    "approval-commit-push": async (_operation, state) => {
      const commit = state.authority_record_commit;
      if (!COMMIT.test(commit ?? "")) fail("APPROVAL_COMMIT");
      const object = exactCommand(run, "git", ["cat-file", "-t", commit]);
      if (object.stdout.trim() !== "commit") fail("APPROVAL_COMMIT_OBJECT");
      const parent = exactCommand(run, "git", ["rev-parse", `${commit}^`]);
      if (parent.stdout.trim() !== state.proposal_record_commit) fail("APPROVAL_COMMIT_LINEAGE");
      for (const [path, expected, code] of [
        [state.approval_record_path, state.approval_sha256, "APPROVAL_TREE_BYTES"],
        [state.authority_record_path, state.authority_sha256, "AUTHORITY_TREE_BYTES"],
      ]) {
        if (
          typeof path !== "string" ||
          path === "" ||
          path.startsWith("/") ||
          path.split("/").includes("..") ||
          !HASH.test(expected ?? "")
        )
          fail(code);
        const bytes = exactCommand(run, "git", ["show", `${commit}:${path}`]).stdout;
        if (sha256(Buffer.from(bytes)) !== expected) fail(code);
      }
      const remoteBefore = exactCommand(run, "git", [
        "ls-remote",
        "--heads",
        "origin",
        `refs/heads/${APPROVAL_BRANCH}`,
      ]).stdout.trim();
      if (
        remoteBefore !== "" &&
        !/^[0-9a-f]{40}\trefs\/heads\/codex\/serverless-v2-roadmap-v4$/u.test(remoteBefore)
      )
        fail("APPROVAL_BRANCH_READBACK");
      if (remoteBefore !== "") {
        const remoteCommit = remoteBefore.slice(0, 40);
        exactCommand(run, "git", ["merge-base", "--is-ancestor", remoteCommit, commit]);
      }
      exactCommand(run, "git", [
        "push",
        "--porcelain",
        "origin",
        `${commit}:refs/heads/${APPROVAL_BRANCH}`,
      ]);
      const readback = exactCommand(run, "git", [
        "ls-remote",
        "--heads",
        "origin",
        `refs/heads/${APPROVAL_BRANCH}`,
      ]);
      if (readback.stdout.trim() !== `${commit}\trefs/heads/${APPROVAL_BRANCH}`)
        fail("APPROVAL_COMMIT_REMOTE_READBACK");
      return {
        actualUsd: 0,
        commit,
        branch: APPROVAL_BRANCH,
        priorBranchState: remoteBefore === "" ? "ABSENT_CREATED" : "EXISTING_FAST_FORWARD",
        exactRemoteReadback: true,
      };
    },
  });
}

function parseRuns(bytes, workflow, headSha) {
  let value;
  try {
    value = JSON.parse(bytes);
  } catch {
    fail("GITHUB_RUN_LIST_JSON");
  }
  if (!Array.isArray(value)) fail("GITHUB_RUN_LIST_SHAPE");
  return value.filter(
    (run) =>
      Number.isSafeInteger(run?.databaseId) &&
      run.databaseId > 0 &&
      run.headSha === headSha &&
      run.workflowName === workflow &&
      typeof run.status === "string",
  );
}

/**
 * The GitHub Actions API resolves a workflow file from the repository default branch before it
 * considers the requested ref.  Keep that prerequisite provider-free and explicit: a release
 * source copy of the workflow is not evidence that the default branch has registered it.
 *
 * The evidence is materialized by the provider-free repair/audit path and bound into the outer
 * execution state by its canonical hash.  This validator only checks those already-materialized
 * bytes; it deliberately performs no GitHub or other provider read.
 */
function exactSoulxWorkflowRegistrationEvidence(value, releaseSourceCommit) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify(SOULX_WORKFLOW_REGISTRATION_EVIDENCE_KEYS.slice().sort()) ||
    value.schema_version !== SOULX_WORKFLOW_REGISTRATION_EVIDENCE_SCHEMA ||
    value.repository !== SOULX_WORKFLOW_REGISTRATION_REPOSITORY ||
    value.default_branch !== SOULX_WORKFLOW_REGISTRATION_DEFAULT_BRANCH ||
    !COMMIT.test(value.default_branch_commit ?? "") ||
    value.workflow_file !== SOULX_WORKFLOW_REGISTRATION_FILE ||
    value.workflow_name !== SOULX_WORKFLOW_REGISTRATION_NAME ||
    value.workflow_path !== SOULX_WORKFLOW_REGISTRATION_PATH ||
    !HASH.test(value.default_branch_workflow_sha256 ?? "") ||
    value.release_source_commit !== releaseSourceCommit ||
    !HASH.test(value.release_source_workflow_sha256 ?? "") ||
    value.default_branch_workflow_sha256 !== value.release_source_workflow_sha256 ||
    value.registration_state !== "REGISTERED_EXACT_DEFAULT_BRANCH" ||
    value.materialized !== true ||
    value.bound_to_release_source !== true ||
    !HASH.test(value.evidence_sha256 ?? "")
  )
    fail("SOULX_WORKFLOW_REGISTRATION_EVIDENCE_CONTRACT");
  const unsigned = { ...value };
  delete unsigned.evidence_sha256;
  if (sha256(Buffer.from(canonicalJson(unsigned))) !== value.evidence_sha256)
    fail("SOULX_WORKFLOW_REGISTRATION_EVIDENCE_HASH");
  return Object.freeze(value);
}

function validateSoulxWorkflowRegistrationEvidence(value, state) {
  if (
    state?.static_release_descriptor_schema_version !==
    "videoforge.v213-static-release-descriptor/v2"
  )
    fail("WORKFLOW_REGISTRATION_DESCRIPTOR_V2_REQUIRED");
  exactSoulxWorkflowRegistrationEvidence(value, state?.release_source_commit);
  if (
    state?.release_ref?.exact_tag_name !== TAG ||
    state?.release_ref?.exact_target_commit !== state?.release_source_commit
  )
    fail("SOULX_WORKFLOW_REGISTRATION_RELEASE_BINDING");
  const stateBinding =
    state?.soulx_workflow_registration_evidence_sha256 ??
    state?.workflow_registration_evidence_sha256;
  if (!HASH.test(stateBinding ?? "")) fail("SOULX_WORKFLOW_REGISTRATION_UNBOUND");
  if (stateBinding !== value.evidence_sha256) fail("SOULX_WORKFLOW_REGISTRATION_BINDING_MISMATCH");
  return Object.freeze(value);
}

const DEFAULT_BRANCH_WORKFLOWS = Object.freeze([
  Object.freeze({ file: "mage-image.yml", name: "mage-image" }),
  Object.freeze({
    file: SOULX_WORKFLOW_REGISTRATION_FILE,
    name: SOULX_WORKFLOW_REGISTRATION_NAME,
  }),
]);

function exactGithubJson(run, endpoint, code) {
  const response = exactCommand(run, "gh", ["api", "--method", "GET", endpoint]);
  try {
    return JSON.parse(response.stdout);
  } catch {
    fail(code);
  }
}

function githubContentBytes(value, code) {
  if (
    value?.type !== "file" ||
    value.encoding !== "base64" ||
    typeof value.content !== "string" ||
    !/^[0-9a-f]{40}$/u.test(value.sha ?? "") ||
    !Number.isInteger(value.size) ||
    value.size < 1
  )
    fail(code);
  const compact = value.content.replaceAll(/\s/gu, "");
  let bytes;
  try {
    bytes = Buffer.from(compact, "base64");
  } catch {
    fail(code);
  }
  if (
    bytes.length !== value.size ||
    bytes.toString("base64").replaceAll("=", "") !== compact.replaceAll("=", "")
  )
    fail(code);
  return bytes;
}

function verifyFreshDefaultBranchWorkflowRegistration({ run, state, soulxRegistration }) {
  const repositoryEndpoint = `repos/${SOULX_WORKFLOW_REGISTRATION_REPOSITORY}`;
  const repository = exactGithubJson(run, repositoryEndpoint, "WORKFLOW_DEFAULT_BRANCH_REPOSITORY");
  if (repository?.default_branch !== SOULX_WORKFLOW_REGISTRATION_DEFAULT_BRANCH)
    fail("WORKFLOW_DEFAULT_BRANCH_DRIFT");
  const commit = exactGithubJson(
    run,
    `${repositoryEndpoint}/commits/${SOULX_WORKFLOW_REGISTRATION_DEFAULT_BRANCH}`,
    "WORKFLOW_DEFAULT_BRANCH_COMMIT",
  );
  if (!COMMIT.test(commit?.sha ?? "")) fail("WORKFLOW_DEFAULT_BRANCH_COMMIT");
  const workflows = [];
  for (const expected of DEFAULT_BRANCH_WORKFLOWS) {
    const path = `.github/workflows/${expected.file}`;
    const registration = exactGithubJson(
      run,
      `${repositoryEndpoint}/actions/workflows/${encodeURIComponent(expected.file)}`,
      "WORKFLOW_DEFAULT_BRANCH_REGISTRATION",
    );
    if (
      !Number.isInteger(registration?.id) ||
      registration.id < 1 ||
      registration.name !== expected.name ||
      registration.path !== path ||
      registration.state !== "active"
    )
      fail("WORKFLOW_DEFAULT_BRANCH_REGISTRATION");
    const encodedPath = path
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/");
    const mainBytes = githubContentBytes(
      exactGithubJson(
        run,
        `${repositoryEndpoint}/contents/${encodedPath}?ref=${commit.sha}`,
        "WORKFLOW_DEFAULT_BRANCH_CONTENT",
      ),
      "WORKFLOW_DEFAULT_BRANCH_CONTENT",
    );
    const releaseBytes = githubContentBytes(
      exactGithubJson(
        run,
        `${repositoryEndpoint}/contents/${encodedPath}?ref=${state.release_source_commit}`,
        "WORKFLOW_RELEASE_SOURCE_CONTENT",
      ),
      "WORKFLOW_RELEASE_SOURCE_CONTENT",
    );
    const mainSha256 = sha256(mainBytes);
    const releaseSha256 = sha256(releaseBytes);
    const defaultBranchMatchesReleaseSource = Buffer.compare(mainBytes, releaseBytes) === 0;
    if (
      expected.file === SOULX_WORKFLOW_REGISTRATION_FILE &&
      (!defaultBranchMatchesReleaseSource || mainSha256 !== releaseSha256)
    )
      fail("WORKFLOW_DEFAULT_BRANCH_RELEASE_DRIFT");
    if (
      expected.file === SOULX_WORKFLOW_REGISTRATION_FILE &&
      (commit.sha !== soulxRegistration.default_branch_commit ||
        mainSha256 !== soulxRegistration.default_branch_workflow_sha256 ||
        releaseSha256 !== soulxRegistration.release_source_workflow_sha256)
    )
      fail("SOULX_WORKFLOW_REGISTRATION_STALE");
    workflows.push({
      workflowId: registration.id,
      workflowFile: expected.file,
      workflowName: expected.name,
      defaultBranchWorkflowSha256: mainSha256,
      releaseSourceWorkflowSha256: releaseSha256,
      defaultBranchMatchesReleaseSource,
    });
  }
  const proof = {
    schemaVersion: "videoforge.v213-fresh-default-branch-workflow-readback/v2",
    repository: SOULX_WORKFLOW_REGISTRATION_REPOSITORY,
    defaultBranch: SOULX_WORKFLOW_REGISTRATION_DEFAULT_BRANCH,
    defaultBranchCommit: commit.sha,
    releaseSourceCommit: state.release_source_commit,
    workflows,
    bothWorkflowsRegisteredActive: true,
    releaseSourceContentsVerified: true,
  };
  return Object.freeze({ ...proof, proofSha256: canonicalSha256(proof) });
}

function createGithubDispatchAdapters(options = {}) {
  if (
    options === null ||
    typeof options !== "object" ||
    Array.isArray(options) ||
    Object.keys(options).some(
      (key) => !["run", "wait", "maximumPolls", "pollIntervalMs"].includes(key),
    )
  )
    fail("WORKFLOW_DISPATCH_OPTIONS");
  const {
    run = productionCommand,
    wait = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds)),
    maximumPolls = 30,
    pollIntervalMs = 2_000,
  } = options;
  if (!Number.isInteger(maximumPolls) || maximumPolls < 1 || maximumPolls > 60)
    fail("GITHUB_POLL_BOUND");
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 0 || pollIntervalMs > 10_000)
    fail("GITHUB_POLL_INTERVAL");
  const reconcilePredecessorMage = async (state) => {
    const tag = state.release_ref?.exact_tag_name;
    const headSha = state.release_source_commit;
    if (
      state.release_ref?.state !== "VERIFIED_EXACT_REMOTE" ||
      tag !== TAG ||
      !COMMIT.test(headSha)
    )
      fail("WORKFLOW_RELEASE_REF");
    const candidate = state?.soulx_workflow_registration_evidence;
    if (candidate === undefined || candidate === null) fail("SOULX_WORKFLOW_REGISTRATION_REQUIRED");
    const soulxRegistration = validateSoulxWorkflowRegistrationEvidence(candidate, state);
    if (
      JSON.stringify(state.predecessor_release_attempt) !==
      JSON.stringify(EXACT_PREDECESSOR_RELEASE_ATTEMPT)
    )
      fail("MAGE_PREDECESSOR_RELEASE_BINDING");
    const freshWorkflowReadback = verifyFreshDefaultBranchWorkflowRegistration({
      run,
      state,
      soulxRegistration,
    });
    if (!HASH.test(freshWorkflowReadback?.proofSha256 ?? "")) fail("WORKFLOW_FRESH_READBACK_PROOF");
    const runId = EXACT_PREDECESSOR_RELEASE_ATTEMPT.mage_workflow_run_id;
    let runRecord;
    try {
      runRecord = JSON.parse(
        exactCommand(run, "gh", [
          "run",
          "view",
          runId,
          "--json",
          "databaseId,headSha,workflowName,status,conclusion",
        ]).stdout,
      );
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("V2_13_FULL_LIVE_ADAPTER_"))
        throw error;
      fail("MAGE_PREDECESSOR_RUN_JSON");
    }
    if (
      String(runRecord?.databaseId) !== runId ||
      runRecord.headSha !== headSha ||
      runRecord.workflowName !== "mage-image" ||
      runRecord.status !== "completed" ||
      runRecord.conclusion !== EXACT_PREDECESSOR_RELEASE_ATTEMPT.mage_workflow_conclusion
    )
      fail("MAGE_PREDECESSOR_RUN_READBACK");
    return {
      actualUsd: 0,
      runId,
      headSha,
      dispatchAccepted: false,
      reconciledExistingExact: true,
      mutationPerformed: false,
      predecessorAuthorityId: EXACT_PREDECESSOR_RELEASE_ATTEMPT.authority_id,
      predecessorTerminalStateSha256: EXACT_PREDECESSOR_RELEASE_ATTEMPT.terminal_state_sha256,
      predecessorDispatchResultSha256:
        EXACT_PREDECESSOR_RELEASE_ATTEMPT.mage_workflow_dispatch_result_sha256,
      predecessorVerificationResultSha256:
        EXACT_PREDECESSOR_RELEASE_ATTEMPT.mage_workflow_verification_result_sha256,
      imageDigest: EXACT_PREDECESSOR_RELEASE_ATTEMPT.mage_image_digest,
      evidenceSha256: EXACT_PREDECESSOR_RELEASE_ATTEMPT.mage_evidence_sha256,
      publicManifestSha256: EXACT_PREDECESSOR_RELEASE_ATTEMPT.mage_public_manifest_sha256,
      conclusion: EXACT_PREDECESSOR_RELEASE_ATTEMPT.mage_workflow_conclusion,
      freshWorkflowReadback: structuredClone(freshWorkflowReadback),
      freshWorkflowReadbackSha256: freshWorkflowReadback.proofSha256,
      workflowRegistrationEvidenceSha256: soulxRegistration.evidence_sha256,
    };
  };
  const dispatch = async ({ state, workflowFile, workflowName, fields }) => {
    const tag = state.release_ref?.exact_tag_name;
    const headSha = state.release_source_commit;
    if (
      state.release_ref?.state !== "VERIFIED_EXACT_REMOTE" ||
      tag !== TAG ||
      !COMMIT.test(headSha)
    )
      fail("WORKFLOW_RELEASE_REF");
    const candidate = state?.soulx_workflow_registration_evidence;
    if (candidate === undefined || candidate === null) fail("SOULX_WORKFLOW_REGISTRATION_REQUIRED");
    const soulxRegistration = validateSoulxWorkflowRegistrationEvidence(candidate, state);
    const listArgs = [
      "run",
      "list",
      "--workflow",
      workflowFile,
      "--branch",
      tag,
      "--event",
      "workflow_dispatch",
      "--limit",
      "100",
      "--json",
      "databaseId,headSha,workflowName,status",
    ];
    const before = parseRuns(exactCommand(run, "gh", listArgs).stdout, workflowName, headSha);
    const beforeIds = new Set(before.map(({ databaseId }) => databaseId));
    const freshWorkflowReadback = verifyFreshDefaultBranchWorkflowRegistration({
      run,
      state,
      soulxRegistration,
    });
    if (!HASH.test(freshWorkflowReadback?.proofSha256 ?? "")) fail("WORKFLOW_FRESH_READBACK_PROOF");
    const dispatchArgs = ["workflow", "run", workflowFile, "--ref", tag];
    for (const [name, value] of fields) dispatchArgs.push("--field", `${name}=${value}`);
    exactCommand(run, "gh", dispatchArgs);
    for (let poll = 0; poll < maximumPolls; poll += 1) {
      if (poll > 0) await wait(pollIntervalMs);
      const after = parseRuns(
        exactCommand(run, "gh", listArgs).stdout,
        workflowName,
        headSha,
      ).filter(({ databaseId }) => !beforeIds.has(databaseId));
      if (after.length > 1) fail("GITHUB_DISPATCH_AMBIGUOUS");
      if (after.length === 1)
        return {
          actualUsd: 0,
          runId: String(after[0].databaseId),
          headSha,
          dispatchAccepted: true,
          freshWorkflowReadback: structuredClone(freshWorkflowReadback),
          freshWorkflowReadbackSha256: freshWorkflowReadback.proofSha256,
          workflowRegistrationEvidenceSha256: soulxRegistration.evidence_sha256,
        };
    }
    fail("GITHUB_DISPATCH_RUN_NOT_FOUND");
  };

  return Object.freeze({
    "mage-image-workflow-dispatch": async (_operation, state) => reconcilePredecessorMage(state),
    "soulx-image-workflow-dispatch": async (_operation, state) =>
      dispatch({
        state,
        workflowFile: "avatar-primary-serverless-image.yml",
        workflowName: "avatar-primary-serverless-image",
        fields: [
          ["publish", "true"],
          ["registry_repository", "pala-lakshmansai/videoforge-soulx-serverless-v2-08"],
          ["expected_existing_digest", ""],
        ],
      }),
  });
}

const WORKFLOW_EVIDENCE = Object.freeze({
  "mage-image-workflow-verification": {
    workflowName: "mage-image",
    artifactName: "mage-serverless-v2-07-deployability",
    fileName: "mage-serverless-v2-07.json",
    checkpoint: "V2-07",
    lane: "mage_image",
    repository: "pala-lakshmansai/videoforge-mage-v2-07",
    digestKey: "manifest_digest",
    configDigestKey: "config_digest",
    layerDigestKey: "layer_digest",
    v1ConfigDigestKey: "config_digest",
    v1LayerDigestKey: "layer_digest",
  },
  "soulx-image-workflow-verification": {
    workflowName: "avatar-primary-serverless-image",
    artifactName: "soulx-serverless-v2-08-deployability",
    fileName: "soulx-serverless-v2-08.json",
    checkpoint: "V2-08",
    lane: "soulx_avatar",
    repository: "pala-lakshmansai/videoforge-soulx-serverless-v2-08",
    digestKey: "image_digest",
    configDigestKey: "config_digest",
    layerDigestKey: null,
    v1ConfigDigestKey: "local_image_id",
    v1LayerDigestKey: null,
  },
});

const IMAGE_DEPLOYABILITY_V1_SCHEMA = "videoforge-image-deployability/v1";
const IMAGE_DEPLOYABILITY_SCHEMA = "videoforge-image-deployability/v2";
const ANONYMOUS_GHCR_PROOF_SCHEMA = "videoforge-anonymous-ghcr-publication-proof/v1";
const IMAGE_PUBLICATION_WORKFLOW_REPOSITORY = "Pala-LakshmanSai/videoforge";
const GHCR_ORIGIN = "https://ghcr.io";
const GHCR_TOKEN_PATH = "/token";
const GHCR_BLOB_REDIRECT_HOST = "pkg-containers.githubusercontent.com";
const GHCR_ANONYMOUS_READ_TIMEOUT_MS = 60_000;
const GHCR_TOKEN_MAX_BYTES = 65_536;
const GHCR_MANIFEST_MAX_BYTES = 8 * 1024 * 1024;
const IMAGE_MANIFEST_MEDIA_TYPES = new Set([
  "application/vnd.docker.distribution.manifest.v2+json",
  "application/vnd.oci.image.manifest.v1+json",
]);
const IMAGE_CONFIG_MEDIA_TYPES = new Set([
  "application/vnd.docker.container.image.v1+json",
  "application/vnd.oci.image.config.v1+json",
]);
const IMAGE_LAYER_MEDIA_TYPES = new Set([
  "application/vnd.docker.image.rootfs.diff.tar.gzip",
  "application/vnd.oci.image.layer.v1.tar",
  "application/vnd.oci.image.layer.v1.tar+gzip",
]);

function imageProofCanonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(imageProofCanonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${imageProofCanonicalJson(value[key])}`)
      .join(",")}}`;
  fail("ANONYMOUS_PUBLICATION_PROOF_VALUE");
}

function imageProofExactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort())
  );
}

function validateImageBlobProof(value, { kind, index, mediaTypes, approvedMs, expiresMs }) {
  const observedMs = Date.parse(value?.registry_observed_at ?? "");
  if (
    !imageProofExactKeys(value, [
      "kind",
      "index",
      "digest",
      "media_type",
      "declared_size_bytes",
      "observed_size_bytes",
      "content_sha256",
      "http_status",
      "registry_observed_at",
    ]) ||
    value.kind !== kind ||
    value.index !== index ||
    !HASH.test(value.digest ?? "") ||
    !mediaTypes.has(value.media_type) ||
    !Number.isSafeInteger(value.declared_size_bytes) ||
    value.declared_size_bytes <= 0 ||
    value.observed_size_bytes !== value.declared_size_bytes ||
    value.content_sha256 !== value.digest ||
    value.http_status !== 200 ||
    Number.isNaN(observedMs) ||
    observedMs < approvedMs ||
    observedMs > expiresMs
  )
    fail("ANONYMOUS_PUBLICATION_BLOB_PROOF");
  return value;
}

function validateAnonymousGhcrPublicationProof(proof, { evidence, expected, state, runId }) {
  if (
    !imageProofExactKeys(proof, [
      "schema_version",
      "registry",
      "repository",
      "authentication",
      "workflow_repository",
      "workflow_name",
      "workflow_ref",
      "workflow_commit",
      "workflow_run_id",
      "registry_observed_at",
      "manifest",
      "config",
      "layers",
      "all_blobs_verified",
      "proof_sha256",
    ]) ||
    proof.schema_version !== ANONYMOUS_GHCR_PROOF_SCHEMA ||
    proof.registry !== "ghcr.io" ||
    proof.repository !== expected.repository ||
    proof.authentication !== "GHCR_ANONYMOUS_PULL_TOKEN" ||
    proof.workflow_repository !== IMAGE_PUBLICATION_WORKFLOW_REPOSITORY ||
    proof.workflow_name !== expected.workflowName ||
    proof.workflow_ref !== `refs/tags/${state?.release_ref?.exact_tag_name ?? ""}` ||
    proof.workflow_commit !== state?.release_source_commit ||
    proof.workflow_run_id !== runId ||
    proof.all_blobs_verified !== true ||
    !HASH.test(proof.proof_sha256 ?? "") ||
    !Array.isArray(proof.layers) ||
    proof.layers.length < 1 ||
    proof.layers.length > 128
  )
    fail("ANONYMOUS_PUBLICATION_PROOF_CONTRACT");
  const observedMs = Date.parse(proof.registry_observed_at ?? "");
  const approvedMs = Date.parse(state?.approved_at ?? "");
  const expiresMs = Date.parse(state?.expires_at ?? "");
  if (
    Number.isNaN(observedMs) ||
    Number.isNaN(approvedMs) ||
    Number.isNaN(expiresMs) ||
    observedMs < approvedMs ||
    observedMs > expiresMs
  )
    fail("ANONYMOUS_PUBLICATION_PROOF_TIME");
  if (
    !imageProofExactKeys(proof.manifest, [
      "digest",
      "header_digest",
      "content_sha256",
      "media_type",
      "response_content_type",
      "size_bytes",
      "http_status",
    ]) ||
    proof.manifest.digest !== evidence?.[expected.digestKey] ||
    proof.manifest.header_digest !== proof.manifest.digest ||
    proof.manifest.content_sha256 !== proof.manifest.digest ||
    !IMAGE_MANIFEST_MEDIA_TYPES.has(proof.manifest.media_type) ||
    proof.manifest.response_content_type !== proof.manifest.media_type ||
    !Number.isSafeInteger(proof.manifest.size_bytes) ||
    proof.manifest.size_bytes <= 0 ||
    proof.manifest.http_status !== 200
  )
    fail("ANONYMOUS_PUBLICATION_MANIFEST_PROOF");
  validateImageBlobProof(proof.config, {
    kind: "config",
    index: 0,
    mediaTypes: IMAGE_CONFIG_MEDIA_TYPES,
    approvedMs: Math.max(approvedMs, observedMs),
    expiresMs,
  });
  proof.layers.forEach((layer, index) =>
    validateImageBlobProof(layer, {
      kind: "layer",
      index,
      mediaTypes: IMAGE_LAYER_MEDIA_TYPES,
      approvedMs: Math.max(approvedMs, observedMs),
      expiresMs,
    }),
  );
  const blobObservedTimes = [proof.config, ...proof.layers].map((item) =>
    Date.parse(item.registry_observed_at),
  );
  if (blobObservedTimes.some((value, index) => index > 0 && value < blobObservedTimes[index - 1]))
    fail("ANONYMOUS_PUBLICATION_BLOB_TIME_ORDER");
  const blobDigests = [proof.config.digest, ...proof.layers.map((layer) => layer.digest)];
  if (new Set(blobDigests).size !== blobDigests.length)
    fail("ANONYMOUS_PUBLICATION_BLOB_DUPLICATE");
  const configDigestKey =
    evidence?.schema_version === IMAGE_DEPLOYABILITY_V1_SCHEMA
      ? (expected.v1ConfigDigestKey ?? expected.configDigestKey)
      : expected.configDigestKey;
  const layerDigestKey =
    evidence?.schema_version === IMAGE_DEPLOYABILITY_V1_SCHEMA
      ? (expected.v1LayerDigestKey ?? expected.layerDigestKey)
      : expected.layerDigestKey;
  if (evidence?.[configDigestKey] !== proof.config.digest)
    fail("ANONYMOUS_PUBLICATION_CONFIG_BINDING");
  if (layerDigestKey !== null && evidence?.[layerDigestKey] !== proof.layers.at(-1)?.digest)
    fail("ANONYMOUS_PUBLICATION_LAYER_BINDING");
  const unsigned = structuredClone(proof);
  delete unsigned.proof_sha256;
  if (sha256(Buffer.from(imageProofCanonicalJson(unsigned))) !== proof.proof_sha256)
    fail("ANONYMOUS_PUBLICATION_PROOF_HASH");
  return Object.freeze(structuredClone(proof));
}

function anonymousGhcrAdapterError(error) {
  return error instanceof Error && error.message.startsWith("V2_13_FULL_LIVE_ADAPTER_");
}

function assertAnonymousGhcrNotCancelled(isCancelled) {
  if (isCancelled()) fail("ANONYMOUS_GHCR_CANCELLED");
}

async function boundedAnonymousGhcrWait({ action, remaining, isCancelled, controller }) {
  assertAnonymousGhcrNotCancelled(isCancelled);
  const timeoutMs = Math.min(GHCR_ANONYMOUS_READ_TIMEOUT_MS, remaining());
  let timedOut = false;
  let cancelled = false;
  let timeout;
  let cancellationPoll;
  const guard = new Promise((_, reject) => {
    const rejectWith = (code) => {
      try {
        fail(code);
      } catch (error) {
        reject(error);
      }
    };
    timeout = setTimeout(() => {
      timedOut = true;
      controller?.abort();
      rejectWith("ANONYMOUS_GHCR_TIMEOUT");
    }, timeoutMs);
    cancellationPoll = setInterval(() => {
      if (!isCancelled()) return;
      cancelled = true;
      controller?.abort();
      rejectWith("ANONYMOUS_GHCR_CANCELLED");
    }, 25);
  });
  try {
    const value = await Promise.race([Promise.resolve().then(action), guard]);
    remaining();
    assertAnonymousGhcrNotCancelled(isCancelled);
    return value;
  } catch (error) {
    if (cancelled || isCancelled()) fail("ANONYMOUS_GHCR_CANCELLED");
    if (timedOut) fail("ANONYMOUS_GHCR_TIMEOUT");
    throw error;
  } finally {
    clearTimeout(timeout);
    clearInterval(cancellationPoll);
  }
}

function exactGhcrResponse(response) {
  if (
    response === null ||
    typeof response !== "object" ||
    !Number.isInteger(response.status) ||
    response.status < 100 ||
    response.status > 599 ||
    typeof response.headers?.get !== "function"
  )
    fail("ANONYMOUS_GHCR_RESPONSE_CONTRACT");
  return response;
}

async function anonymousGhcrFetch({ fetch, url, headers, redirect, remaining, isCancelled }) {
  const controller = new AbortController();
  let response;
  try {
    response = await boundedAnonymousGhcrWait({
      remaining,
      isCancelled,
      controller,
      action: () =>
        fetch(url, {
          method: "GET",
          headers,
          credentials: "omit",
          redirect,
          cache: "no-store",
          signal: controller.signal,
        }),
    });
  } catch (error) {
    if (anonymousGhcrAdapterError(error)) throw error;
    fail("ANONYMOUS_GHCR_FETCH");
  }
  return Object.freeze({ response: exactGhcrResponse(response), controller });
}

function exactContentLength(response, expectedSizeBytes) {
  const raw = response.headers.get("content-length");
  if (raw === null) return;
  if (!/^(0|[1-9][0-9]*)$/u.test(raw) || Number(raw) !== expectedSizeBytes)
    fail("ANONYMOUS_GHCR_CONTENT_LENGTH");
}

async function readAnonymousGhcrBody({
  response,
  controller,
  expectedSizeBytes,
  expectedDigest,
  maximumSizeBytes = expectedSizeBytes,
  collect = false,
  remaining,
  isCancelled,
}) {
  if (
    !Number.isSafeInteger(maximumSizeBytes) ||
    maximumSizeBytes < 1 ||
    (expectedSizeBytes !== null &&
      (!Number.isSafeInteger(expectedSizeBytes) || expectedSizeBytes < 1)) ||
    (expectedDigest !== null && !HASH.test(expectedDigest)) ||
    typeof response.body?.getReader !== "function"
  )
    fail("ANONYMOUS_GHCR_BODY_CONTRACT");
  const reader = response.body.getReader();
  const contentHash = createHash("sha256");
  const chunks = [];
  let observedSizeBytes = 0;
  try {
    while (true) {
      const item = await boundedAnonymousGhcrWait({
        action: () => reader.read(),
        remaining,
        isCancelled,
        controller,
      });
      if (item?.done === true) break;
      if (!(item?.value instanceof Uint8Array)) fail("ANONYMOUS_GHCR_BODY_CHUNK");
      const chunk = Buffer.from(item.value);
      observedSizeBytes += chunk.length;
      if (!Number.isSafeInteger(observedSizeBytes) || observedSizeBytes > maximumSizeBytes)
        fail("ANONYMOUS_GHCR_BODY_SIZE");
      contentHash.update(chunk);
      if (collect) chunks.push(chunk);
    }
  } catch (error) {
    controller.abort();
    if (anonymousGhcrAdapterError(error)) throw error;
    fail("ANONYMOUS_GHCR_BODY_READ");
  } finally {
    reader.releaseLock();
  }
  if (expectedSizeBytes !== null && observedSizeBytes !== expectedSizeBytes)
    fail("ANONYMOUS_GHCR_BODY_SIZE");
  exactContentLength(response, observedSizeBytes);
  const contentSha256 = `sha256:${contentHash.digest("hex")}`;
  if (expectedDigest !== null && contentSha256 !== expectedDigest)
    fail("ANONYMOUS_GHCR_BODY_DIGEST");
  return Object.freeze({
    bytes: collect ? Buffer.concat(chunks, observedSizeBytes) : null,
    observedSizeBytes,
    contentSha256,
  });
}

function allowedGhcrBlobRedirect(location, sourceUrl, expectedDigest) {
  let target;
  try {
    target = new URL(location, sourceUrl);
  } catch {
    fail("ANONYMOUS_GHCR_BLOB_REDIRECT");
  }
  const escapedDigest = expectedDigest.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  if (
    target.protocol !== "https:" ||
    target.hostname !== GHCR_BLOB_REDIRECT_HOST ||
    target.username !== "" ||
    target.password !== "" ||
    target.hash !== "" ||
    !target.searchParams.has("se") ||
    !target.searchParams.has("sig") ||
    !new RegExp(`^/ghcrblobs[^/]+/blobs/${escapedDigest}$`, "u").test(target.pathname)
  )
    fail("ANONYMOUS_GHCR_BLOB_REDIRECT");
  return target.href;
}

async function acquireAnonymousGhcrPullToken({ fetch, repository, remaining, isCancelled }) {
  const tokenUrl = new URL(GHCR_TOKEN_PATH, GHCR_ORIGIN);
  tokenUrl.searchParams.set("service", "ghcr.io");
  tokenUrl.searchParams.set("scope", `repository:${repository}:pull`);
  const { response, controller } = await anonymousGhcrFetch({
    fetch,
    url: tokenUrl.href,
    headers: { accept: "application/json" },
    redirect: "error",
    remaining,
    isCancelled,
  });
  if (response.status !== 200) {
    controller.abort();
    fail("ANONYMOUS_GHCR_TOKEN_HTTP", String(response.status));
  }
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") fail("ANONYMOUS_GHCR_TOKEN_MEDIA_TYPE");
  const body = await readAnonymousGhcrBody({
    response,
    controller,
    expectedSizeBytes: null,
    expectedDigest: null,
    maximumSizeBytes: GHCR_TOKEN_MAX_BYTES,
    collect: true,
    remaining,
    isCancelled,
  });
  let value;
  try {
    value = JSON.parse(body.bytes.toString("utf8"));
  } catch {
    fail("ANONYMOUS_GHCR_TOKEN_JSON");
  }
  const token = value?.token ?? value?.access_token;
  if (
    typeof token !== "string" ||
    token.length < 20 ||
    token.length > 8192 ||
    /\s/u.test(token) ||
    (value?.token !== undefined &&
      value?.access_token !== undefined &&
      value.token !== value.access_token)
  )
    fail("ANONYMOUS_GHCR_TOKEN_CONTRACT");
  return token;
}

async function getAnonymousGhcrBytes({
  fetch,
  repository,
  path,
  token,
  accept,
  expectedDigest,
  expectedSizeBytes,
  maximumSizeBytes = expectedSizeBytes,
  collect = false,
  kind,
  remaining,
  isCancelled,
}) {
  const sourceUrl = `${GHCR_ORIGIN}/v2/${repository}/${path}`;
  let read = await anonymousGhcrFetch({
    fetch,
    url: sourceUrl,
    headers: { accept, authorization: `Bearer ${token}` },
    redirect: "manual",
    remaining,
    isCancelled,
  });
  if (read.response.status >= 300 && read.response.status < 400) {
    if (kind !== "blob") fail("ANONYMOUS_GHCR_REDIRECT");
    const location = read.response.headers.get("location");
    if (location === null) fail("ANONYMOUS_GHCR_BLOB_REDIRECT");
    const redirectUrl = allowedGhcrBlobRedirect(location, sourceUrl, expectedDigest);
    read.controller.abort();
    read = await anonymousGhcrFetch({
      fetch,
      url: redirectUrl,
      headers: { accept },
      redirect: "error",
      remaining,
      isCancelled,
    });
  }
  if (read.response.status !== 200) {
    read.controller.abort();
    fail(`ANONYMOUS_GHCR_${kind.toUpperCase()}_HTTP`, String(read.response.status));
  }
  return {
    response: read.response,
    body: await readAnonymousGhcrBody({
      response: read.response,
      controller: read.controller,
      expectedSizeBytes,
      expectedDigest,
      maximumSizeBytes,
      collect,
      remaining,
      isCancelled,
    }),
  };
}

function exactImageDescriptor(value, mediaTypes, kind) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !mediaTypes.has(value.mediaType) ||
    !HASH.test(value.digest ?? "") ||
    !Number.isSafeInteger(value.size) ||
    value.size < 1
  )
    fail(`ANONYMOUS_GHCR_${kind.toUpperCase()}_DESCRIPTOR`);
  return Object.freeze({ mediaType: value.mediaType, digest: value.digest, size: value.size });
}

async function verifyTaggedV1AnonymousGhcrReadback({
  fetch,
  evidence,
  expected,
  state,
  runId,
  trustedTime,
  remaining,
  isCancelled,
}) {
  const approvedMs = Date.parse(state?.approved_at ?? "");
  const expiresMs = Date.parse(state?.expires_at ?? "");
  if (Number.isNaN(approvedMs) || Number.isNaN(expiresMs) || approvedMs > expiresMs)
    fail("ANONYMOUS_GHCR_AUTHORITY_TIME");
  let priorObservedMs = approvedMs;
  const observeTrustedTime = async () => {
    const value = await boundedAnonymousGhcrWait({
      action: () => trustedTime(Math.min(12_000, remaining())),
      remaining,
      isCancelled,
    });
    const observedMs = Date.parse(value ?? "");
    if (
      Number.isNaN(observedMs) ||
      observedMs < approvedMs ||
      observedMs > expiresMs ||
      observedMs < priorObservedMs
    )
      fail("ANONYMOUS_GHCR_AUTHORITY_TIME");
    priorObservedMs = observedMs;
    return new Date(observedMs).toISOString();
  };

  await observeTrustedTime();
  const token = await acquireAnonymousGhcrPullToken({
    fetch,
    repository: expected.repository,
    remaining,
    isCancelled,
  });
  const digest = evidence?.[expected.digestKey];
  if (!HASH.test(digest ?? "")) fail("ANONYMOUS_GHCR_MANIFEST_DIGEST");
  const manifestRead = await getAnonymousGhcrBytes({
    fetch,
    repository: expected.repository,
    path: `manifests/${digest}`,
    token,
    accept: [...IMAGE_MANIFEST_MEDIA_TYPES].join(", "),
    expectedDigest: digest,
    expectedSizeBytes: null,
    maximumSizeBytes: GHCR_MANIFEST_MAX_BYTES,
    collect: true,
    kind: "manifest",
    remaining,
    isCancelled,
  });
  const headerDigest = manifestRead.response.headers.get("docker-content-digest");
  const responseContentType = manifestRead.response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (
    headerDigest !== digest ||
    manifestRead.body.contentSha256 !== digest ||
    !IMAGE_MANIFEST_MEDIA_TYPES.has(responseContentType)
  )
    fail("ANONYMOUS_GHCR_MANIFEST_IDENTITY");
  let manifest;
  try {
    manifest = JSON.parse(manifestRead.body.bytes.toString("utf8"));
  } catch {
    fail("ANONYMOUS_GHCR_MANIFEST_JSON");
  }
  if (
    manifest?.schemaVersion !== 2 ||
    manifest.mediaType !== responseContentType ||
    !Array.isArray(manifest.layers) ||
    manifest.layers.length < 1 ||
    manifest.layers.length > 128
  )
    fail("ANONYMOUS_GHCR_MANIFEST_CONTRACT");
  const config = exactImageDescriptor(manifest.config, IMAGE_CONFIG_MEDIA_TYPES, "config");
  const layers = manifest.layers.map((layer) =>
    exactImageDescriptor(layer, IMAGE_LAYER_MEDIA_TYPES, "layer"),
  );
  const descriptorDigests = [config.digest, ...layers.map((layer) => layer.digest)];
  if (new Set(descriptorDigests).size !== descriptorDigests.length)
    fail("ANONYMOUS_GHCR_BLOB_DUPLICATE");
  const configDigestKey = expected.v1ConfigDigestKey ?? expected.configDigestKey;
  const layerDigestKey = expected.v1LayerDigestKey ?? expected.layerDigestKey;
  if (evidence?.[configDigestKey] !== config.digest) fail("ANONYMOUS_GHCR_CONFIG_BINDING");
  if (layerDigestKey !== null && evidence?.[layerDigestKey] !== layers.at(-1)?.digest)
    fail("ANONYMOUS_GHCR_LAYER_BINDING");
  const manifestObservedAt = await observeTrustedTime();

  const configRead = await getAnonymousGhcrBytes({
    fetch,
    repository: expected.repository,
    path: `blobs/${config.digest}`,
    token,
    accept: config.mediaType,
    expectedDigest: config.digest,
    expectedSizeBytes: config.size,
    collect: false,
    kind: "blob",
    remaining,
    isCancelled,
  });
  void configRead.response;
  const configObservedAt = await observeTrustedTime();
  const layerProofs = [];
  for (const [index, layer] of layers.entries()) {
    const layerRead = await getAnonymousGhcrBytes({
      fetch,
      repository: expected.repository,
      path: `blobs/${layer.digest}`,
      token,
      accept: layer.mediaType,
      expectedDigest: layer.digest,
      expectedSizeBytes: layer.size,
      collect: false,
      kind: "blob",
      remaining,
      isCancelled,
    });
    void layerRead.response;
    layerProofs.push({
      kind: "layer",
      index,
      digest: layer.digest,
      media_type: layer.mediaType,
      declared_size_bytes: layer.size,
      observed_size_bytes: layerRead.body.observedSizeBytes,
      content_sha256: layerRead.body.contentSha256,
      http_status: 200,
      registry_observed_at: await observeTrustedTime(),
    });
  }
  const unsignedProof = {
    schema_version: ANONYMOUS_GHCR_PROOF_SCHEMA,
    registry: "ghcr.io",
    repository: expected.repository,
    authentication: "GHCR_ANONYMOUS_PULL_TOKEN",
    workflow_repository: IMAGE_PUBLICATION_WORKFLOW_REPOSITORY,
    workflow_name: expected.workflowName,
    workflow_ref: `refs/tags/${state.release_ref.exact_tag_name}`,
    workflow_commit: state.release_source_commit,
    workflow_run_id: runId,
    registry_observed_at: manifestObservedAt,
    manifest: {
      digest,
      header_digest: headerDigest,
      content_sha256: manifestRead.body.contentSha256,
      media_type: manifest.mediaType,
      response_content_type: responseContentType,
      size_bytes: manifestRead.body.observedSizeBytes,
      http_status: 200,
    },
    config: {
      kind: "config",
      index: 0,
      digest: config.digest,
      media_type: config.mediaType,
      declared_size_bytes: config.size,
      observed_size_bytes: configRead.body.observedSizeBytes,
      content_sha256: configRead.body.contentSha256,
      http_status: 200,
      registry_observed_at: configObservedAt,
    },
    layers: layerProofs,
    all_blobs_verified: true,
  };
  const proof = {
    ...unsignedProof,
    proof_sha256: sha256(Buffer.from(imageProofCanonicalJson(unsignedProof))),
  };
  return validateAnonymousGhcrPublicationProof(proof, {
    evidence,
    expected,
    state,
    runId,
  });
}

function createGithubVerificationAdapters({
  run = (command, args, timeoutMs) => boundedCommand(command, args, timeoutMs),
  fetch = (input, init) => globalThis.fetch(input, init),
  wait = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds)),
  maximumPolls = 180,
  pollIntervalMs = 10_000,
  wallTimeoutMs = 1_800_000,
  deadlineNow = () => performance.now(),
  trustedTime = (timeoutMs) =>
    readAuthenticatedGithubTime({ spawnTimeoutMs: Math.min(12_000, timeoutMs) }),
  isCancelled = () => false,
} = {}) {
  if (typeof fetch !== "function") fail("GITHUB_VERIFICATION_FETCH_CONTRACT");
  if (!Number.isInteger(maximumPolls) || maximumPolls < 1 || maximumPolls > 180)
    fail("GITHUB_VERIFICATION_POLL_BOUND");
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 0 || pollIntervalMs > 10_000)
    fail("GITHUB_VERIFICATION_POLL_INTERVAL");
  if (wallTimeoutMs !== 1_800_000) fail("GITHUB_VERIFICATION_WALL_TIMEOUT");
  return Object.fromEntries(
    Object.entries(WORKFLOW_EVIDENCE).map(([operationId, expected]) => [
      operationId,
      async (_operation, state, priorResults) => {
        const deadline = deadlineNow() + wallTimeoutMs;
        const remaining = () => {
          const value = Math.floor(deadline - deadlineNow());
          if (!Number.isFinite(value) || value <= 0) fail("WORKFLOW_RUN_TERMINAL_TIMEOUT");
          return value;
        };
        const dispatchId = operationId.replace("verification", "dispatch");
        const runId = priorResults.get(dispatchId)?.runId;
        if (!/^[1-9][0-9]*$/u.test(runId ?? "")) fail("WORKFLOW_RUN_ID");
        if (
          operationId === "mage-image-workflow-verification" &&
          (JSON.stringify(state.predecessor_release_attempt) !==
            JSON.stringify(EXACT_PREDECESSOR_RELEASE_ATTEMPT) ||
            runId !== EXACT_PREDECESSOR_RELEASE_ATTEMPT.mage_workflow_run_id)
        )
          fail("MAGE_PREDECESSOR_RUN_BINDING");
        let runRecord;
        for (let poll = 0; poll < maximumPolls; poll += 1) {
          if (isCancelled()) fail("WORKFLOW_VERIFICATION_CANCELLED");
          const trustedMs = Date.parse(await trustedTime(Math.min(12_000, remaining())));
          remaining();
          if (
            Number.isNaN(trustedMs) ||
            trustedMs < Date.parse(state.approved_at ?? "") ||
            trustedMs > Date.parse(state.expires_at ?? "")
          )
            fail("WORKFLOW_AUTHORITY_EXPIRED");
          if (poll > 0) {
            await wait(Math.min(pollIntervalMs, remaining()));
            remaining();
          }
          const viewed = exactCommand(
            (command, args) => run(command, args, Math.min(60_000, remaining())),
            "gh",
            ["run", "view", runId, "--json", "databaseId,headSha,workflowName,status,conclusion"],
          );
          remaining();
          try {
            runRecord = JSON.parse(viewed.stdout);
          } catch {
            fail("WORKFLOW_RUN_JSON");
          }
          if (
            String(runRecord?.databaseId) !== runId ||
            runRecord.headSha !== state.release_source_commit ||
            runRecord.workflowName !== expected.workflowName ||
            !["queued", "in_progress", "completed"].includes(runRecord.status)
          )
            fail("WORKFLOW_RUN_READBACK");
          if (runRecord.status === "completed") {
            if (runRecord.conclusion !== "success") fail("WORKFLOW_RUN_TERMINAL_FAILURE");
            break;
          }
        }
        if (runRecord?.status !== "completed") fail("WORKFLOW_RUN_TERMINAL_TIMEOUT");
        const directory = mkdtempSync(resolve(tmpdir(), "videoforge-v2-13-workflow-evidence-"));
        try {
          exactCommand((command, args) => run(command, args, Math.min(60_000, remaining())), "gh", [
            "run",
            "download",
            runId,
            "--name",
            expected.artifactName,
            "--dir",
            directory,
          ]);
          remaining();
          const evidencePath = resolve(directory, expected.fileName);
          const metadata = lstatSync(evidencePath);
          if (metadata.isSymbolicLink() || !metadata.isFile()) fail("WORKFLOW_EVIDENCE_FILE");
          const evidenceBytes = readFileSync(evidencePath);
          remaining();
          let evidence;
          try {
            evidence = JSON.parse(evidenceBytes);
          } catch {
            fail("WORKFLOW_EVIDENCE_JSON");
          }
          const digest = evidence?.[expected.digestKey];
          const evidenceSha256 = sha256(evidenceBytes);
          if (
            ![IMAGE_DEPLOYABILITY_V1_SCHEMA, IMAGE_DEPLOYABILITY_SCHEMA].includes(
              evidence?.schema_version,
            ) ||
            evidence.checkpoint !== expected.checkpoint ||
            evidence.lane !== expected.lane ||
            evidence.source_commit !== state.release_source_commit ||
            evidence.registry_repository !== expected.repository ||
            evidence.publication_requested !== true ||
            evidence.published !== true ||
            !["PUBLISHED_NEW_DIGEST", "EXACT_EXISTING_DIGEST_REUSED"].includes(
              evidence.publication_state,
            ) ||
            evidence.status !== "PUBLISHED_IMMUTABLE_IMAGE" ||
            evidence.qualification_status !== "REQUIRES_FRESH_LIVE_REQUALIFICATION" ||
            evidence.prior_qualification_reused !== false ||
            evidence.platform !== "linux/amd64" ||
            evidence.model_volume !== "/runpod-volume" ||
            evidence.model_download_performed !== false ||
            evidence.provider_endpoint_mutation_performed !== false ||
            !HASH.test(digest ?? "") ||
            evidence.immutable_image !== `ghcr.io/${expected.repository}@${digest}`
          )
            fail("WORKFLOW_EVIDENCE_CONTRACT");
          if (
            operationId === "mage-image-workflow-verification" &&
            (JSON.stringify(state.predecessor_release_attempt) !==
              JSON.stringify(EXACT_PREDECESSOR_RELEASE_ATTEMPT) ||
              runId !== EXACT_PREDECESSOR_RELEASE_ATTEMPT.mage_workflow_run_id ||
              digest !== EXACT_PREDECESSOR_RELEASE_ATTEMPT.mage_image_digest ||
              evidenceSha256 !== EXACT_PREDECESSOR_RELEASE_ATTEMPT.mage_evidence_sha256)
          )
            fail("MAGE_PREDECESSOR_EVIDENCE_BINDING");
          const anonymousProof =
            evidence.schema_version === IMAGE_DEPLOYABILITY_SCHEMA
              ? validateAnonymousGhcrPublicationProof(evidence.anonymous_publication_proof, {
                  evidence,
                  expected,
                  state,
                  runId,
                })
              : await verifyTaggedV1AnonymousGhcrReadback({
                  fetch,
                  evidence,
                  expected,
                  state,
                  runId,
                  trustedTime,
                  remaining,
                  isCancelled,
                });
          remaining();
          return {
            actualUsd: 0,
            runId,
            headSha: state.release_source_commit,
            imageDigest: digest,
            evidenceSha256,
            publicManifestSha256: digest,
            publicAllBlobsVerified: true,
            anonymousPublicationProofSha256: anonymousProof.proof_sha256,
            conclusion: "success",
            ...(operationId === "mage-image-workflow-verification"
              ? { predecessorReverified: true, dispatchPerformed: false }
              : {}),
          };
        } finally {
          rmSync(directory, { recursive: true, force: true });
        }
      },
    ]),
  );
}

const GUARDED_INPUTS = Object.freeze([
  ["activation-record", "VIDEOFORGE_V2_13_ACTIVATION_RECORD"],
  ["config-activation-record", "VIDEOFORGE_V2_13_CONFIG_ACTIVATION_RECORD"],
  ["proposal-file", "VIDEOFORGE_V2_13_PROPOSAL_FILE"],
  ["release-manifest-file", "VIDEOFORGE_V2_13_RELEASE_MANIFEST_FILE"],
  ["user-approval-file", "VIDEOFORGE_V2_13_USER_APPROVAL_FILE"],
  ["wrangler-oauth-config-file", WRANGLER_OAUTH_CONFIG_ENV],
  ["evidence-output", "VIDEOFORGE_V2_13_ACTIVATION_EVIDENCE_OUTPUT"],
  ["postgres-input-dir", "VIDEOFORGE_V2_13_POSTGRES_INPUT_DIR"],
  ["secret-input-dir", "VIDEOFORGE_V2_13_SECRET_INPUT_DIR"],
]);

function createGuardedActivationAdapter({
  run = productionCommand,
  environment = process.env,
  readEvidence = (path) => readFileSync(path),
  prepareSource = prepareReleaseSourceWorktree,
  preflight = preflightGuardedActivationInputs,
  requirePrequalificationReceipt = false,
} = {}) {
  return async (_operation, state, priorResults = new Map()) => {
    if (requirePrequalificationReceipt) {
      const bootstrap = priorResults.get("bootstrap-prequalification-database");
      const receipt = prequalificationReceiptFromFile(prequalificationPath(environment));
      if (
        bootstrap?.prequalification_database_bootstrap_sha256 !==
        receipt?.prequalification_database_bootstrap_sha256
      )
        fail("GUARDED_PREQUALIFICATION_RECEIPT");
    }
    preflight({ environment, state });
    const activationSourceCommit =
      state.schema_version === OUTER_CONSUMPTION_SCHEMA_V3
        ? state.execution_control_commit
        : state.release_source_commit;
    if (!COMMIT.test(activationSourceCommit ?? "")) fail("GUARDED_ACTIVATION_SOURCE_COMMIT");
    const source = prepareSource(activationSourceCommit);
    if (
      source === null ||
      typeof source !== "object" ||
      typeof source.root !== "string" ||
      typeof source.cleanup !== "function"
    )
      fail("RELEASE_SOURCE_WORKTREE_CONTRACT");
    const args = [resolve(source.root, "deploy/v2-13/guarded-activation.mjs"), "--execute"];
    const paths = {};
    try {
      for (const [argument, variable] of GUARDED_INPUTS) {
        const value = environment[variable];
        paths[argument] = value;
        args.push(`--${argument}`, value);
      }
      args.push("--confirm", "EXECUTE_EXACT_GUARDED_V2_13_ACTIVATION");
      const executed = exactCommand(run, process.execPath, args);
      let output;
      try {
        output = JSON.parse(executed.stdout);
      } catch {
        fail("GUARDED_RESULT_JSON");
      }
      if (
        output?.schema_version !== "videoforge-v2-13-guarded-activation-result/v1" ||
        output.state !== "DISABLED_UNQUALIFIED" ||
        output.commit !== state.release_source_commit
      )
        fail("GUARDED_RESULT");
      const evidenceBytes = readEvidence(paths["evidence-output"]);
      let evidence;
      try {
        evidence = JSON.parse(evidenceBytes);
      } catch {
        fail("GUARDED_EVIDENCE_JSON");
      }
      const evidenceSha256 = sha256(evidenceBytes);
      if (
        !HASH.test(evidenceSha256) ||
        evidence?.schema_version !== "videoforge-v2-13-guarded-activation-evidence/v1" ||
        evidence.commit !== state.release_source_commit ||
        evidence.outcome !== "SUCCEEDED" ||
        !/^[0-9a-f]{8}-[0-9a-f-]{27}$/u.test(evidence.disabled_version_id ?? "") ||
        sha256(Buffer.from(evidence.disabled_version_id ?? "")) !==
          evidence.disabled_version_sha256 ||
        evidence.external_spend_cap_usd !== 0 ||
        evidence.new_paid_retained_resources_authorized !== false
      )
        fail("GUARDED_EVIDENCE");
      return {
        actualUsd: 0,
        executedOnce: true,
        evidenceSha256,
        materialization: {
          disabledVersionId: evidence.disabled_version_id,
          disabledVersionSha256: evidence.disabled_version_sha256,
        },
      };
    } finally {
      source.cleanup();
    }
  };
}

function createStagedQualificationAdapters({ api, transport, input }) {
  if (
    api === null ||
    typeof api !== "object" ||
    [
      "issueV213StageAuthority",
      "readV213DualLaneAdmission",
      "runV213MageQualification",
      "runV213SoulXQualification",
      "createV213Max1Deployments",
    ].some((name) => typeof api[name] !== "function") ||
    transport === null ||
    typeof transport !== "object" ||
    input === null ||
    typeof input !== "object"
  )
    fail("QUALIFICATION_COMPOSITION");
  let admission;
  let mage;
  let soulx;
  let mageAuthority;
  let soulxAuthority;
  return Object.freeze({
    "fresh-live-preflight": async () => {
      if (admission !== undefined) fail("QUALIFICATION_STAGE_REPLAY");
      admission = await api.readV213DualLaneAdmission(transport, input);
      if (
        admission?.schemaVersion !== "videoforge.v213-admission-handoff/v1" ||
        !HASH.test(admission.handoffSha256 ?? "")
      )
        fail("ADMISSION_HANDOFF");
      return {
        actualUsd: 0,
        exactGpu: admission.admission.gpu,
        region: admission.admission.region,
        availability: admission.admission.availability,
        flexUsdPerGpuHour: admission.admission.flexRateUsdPerGpuHour,
        noFallback: true,
        inventorySha256: sha256(Buffer.from(JSON.stringify(admission.admission))),
        billingBaselineSha256: sha256(
          Buffer.from(
            JSON.stringify({ cumulativeBillingUsd: admission.admission.cumulativeBillingUsd }),
          ),
        ),
      };
    },
    "mage-live-qualification": async () => {
      if (admission === undefined || mage !== undefined) fail("QUALIFICATION_STAGE_ORDER");
      mageAuthority = await api.issueV213StageAuthority(
        transport,
        input,
        "mage",
        admission.handoffSha256,
      );
      mage = await api.runV213MageQualification(transport, input, admission, mageAuthority);
      if (
        mage?.schemaVersion !== "videoforge.v213-mage-qualification-handoff/v1" ||
        mage.threeStableZeroWorkerReads !== true ||
        !HASH.test(mage.handoffSha256 ?? "")
      )
        fail("MAGE_HANDOFF");
      return {
        actualUsd: mage.receipt.settledCostUsd,
        qualified: true,
        evidenceSha256: mage.handoffSha256,
        deploymentSha256: mage.receipt.deploymentSha256,
        zeroWorkersAfter: true,
      };
    },
    "soulx-live-qualification": async () => {
      if (mage === undefined || soulx !== undefined) fail("QUALIFICATION_STAGE_ORDER");
      soulxAuthority = await api.issueV213StageAuthority(
        transport,
        input,
        "soulx",
        mage.handoffSha256,
      );
      soulx = await api.runV213SoulXQualification(transport, input, mage, soulxAuthority);
      if (
        soulx?.schemaVersion !== "videoforge.v213-soulx-qualification-handoff/v1" ||
        soulx.threeStableZeroWorkerReads !== true ||
        !HASH.test(soulx.handoffSha256 ?? "") ||
        !Array.isArray(soulx.receipts) ||
        soulx.receipts.length !== 4
      )
        fail("SOULX_HANDOFF");
      return {
        actualUsd: soulx.receipts.reduce((sum, receipt) => sum + receipt.settledCostUsd, 0),
        qualified: true,
        evidenceSha256: soulx.handoffSha256,
        deploymentSha256: input.soulx.deploymentSha256,
        zeroWorkersAfter: true,
      };
    },
    "create-exact-max-one-endpoints": async () => {
      if (mage === undefined || soulx === undefined) fail("QUALIFICATION_STAGE_ORDER");
      const productionAuthority = await api.issueV213StageAuthority(
        transport,
        input,
        "production",
        soulx.handoffSha256,
      );
      const result = await api.createV213Max1Deployments(
        transport,
        input,
        mage,
        soulx,
        productionAuthority,
      );
      if (
        result?.schemaVersion !== "videoforge.v213-dual-lane-live/v1" ||
        result.qualified !== true ||
        result.settled?.threeStableZeroWorkerReads !== true
      )
        fail("MAX_ONE_HANDOFF");
      const deployments = [result.production?.mage, result.production?.soulx];
      if (
        deployments.some(
          (item) =>
            item?.workersMin !== 0 ||
            item?.workersMax !== 1 ||
            !HASH.test(item?.deploymentSha256 ?? ""),
        ) ||
        deployments[0].endpointIdSha256 === deployments[1].endpointIdSha256
      )
        fail("MAX_ONE_DEPLOYMENT");
      return {
        actualUsd: 0,
        createdExactTwoEndpoints: true,
        distinctEndpointIds: true,
        bothMaxWorkersOne: true,
        bothWorkersMinZero: true,
        evidenceSha256: sha256(Buffer.from(JSON.stringify(result))),
        materialization: {
          production: exactProductionDeploymentMaterialization(result.production),
        },
      };
    },
  });
}

const PROMOTION_JOURNAL_STEPS = new Set([
  "DATABASE_PROMOTION",
  "DRY_RUN",
  "CLOUDFLARE_DEPLOY",
  "CLOUDFLARE_READBACK",
  "ROUTE_READBACK",
  "ACTIVATION_RECORD",
  "CLOUDFLARE_ROLLBACK",
  "ROLLBACK_RECORD",
  "PROMOTION_COMPLETE",
]);

function exactPromotionJournalLookup(value) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !/^[0-9a-f-]{36}$/u.test(value.promotionId ?? "") ||
    !PROMOTION_JOURNAL_STEPS.has(value.step) ||
    !["INTENT", "CONFIRMED"].includes(value.status)
  )
    fail("PROMOTION_JOURNAL_LOOKUP");
  return Object.freeze({
    promotionId: value.promotionId,
    step: value.step,
    status: value.status,
  });
}

function promotionJournalEntryPath(directory, lookup) {
  const exact = exactPromotionJournalLookup(lookup);
  return resolve(directory, `${exact.promotionId}.${exact.step}.${exact.status}.json`);
}

function syncDirectory(directory, code) {
  let descriptor;
  try {
    descriptor = openSync(directory, fsConstants.O_RDONLY);
    fsyncSync(descriptor);
  } catch {
    fail(code);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

/**
 * Durable one-file-per-entry promotion journal. A fully fsynced staging inode is hard-linked into
 * its immutable final name, so a crash can expose either no entry or the complete entry, never a
 * truncated acknowledgement. The private directory makes the hard-link CAS safe from foreign
 * writers; an existing final name must contain the exact same canonical entry.
 */
function createDurablePromotionFileJournal({ directory }) {
  if (typeof directory !== "string" || directory === "" || directory.includes("\0"))
    fail("PROMOTION_JOURNAL_DIRECTORY");
  const requestedDirectory = resolve(directory);
  try {
    mkdirSync(requestedDirectory, { mode: 0o700 });
    syncDirectory(dirname(requestedDirectory), "PROMOTION_JOURNAL_PARENT_SYNC");
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  let metadata;
  let canonicalDirectory;
  try {
    metadata = lstatSync(requestedDirectory);
    canonicalDirectory = realpathSync(requestedDirectory);
  } catch {
    fail("PROMOTION_JOURNAL_DIRECTORY");
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0)
    fail("PROMOTION_JOURNAL_DIRECTORY");

  const read = async (lookup) => {
    const path = promotionJournalEntryPath(canonicalDirectory, lookup);
    if (!lstatExists(path)) return null;
    protectedFile(path, "PROMOTION_JOURNAL_ENTRY");
    let value;
    try {
      value = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      fail("PROMOTION_JOURNAL_ENTRY");
    }
    const exact = exactPromotionJournalLookup(value);
    const expected = exactPromotionJournalLookup(lookup);
    if (canonicalJson(exact) !== canonicalJson(expected)) fail("PROMOTION_JOURNAL_ENTRY_DRIFT");
    return Object.freeze(value);
  };

  return Object.freeze({
    read,
    async record(entry) {
      const lookup = exactPromotionJournalLookup(entry);
      const finalPath = promotionJournalEntryPath(canonicalDirectory, lookup);
      const existing = await read(lookup);
      if (existing !== null) {
        if (canonicalJson(existing) !== canonicalJson(entry)) fail("PROMOTION_JOURNAL_ENTRY_DRIFT");
        return existing;
      }
      const stagePath = resolve(
        canonicalDirectory,
        `.${basename(finalPath)}.${randomBytes(16).toString("hex")}.stage`,
      );
      let descriptor;
      try {
        descriptor = openSync(
          stagePath,
          fsConstants.O_WRONLY |
            fsConstants.O_CREAT |
            fsConstants.O_EXCL |
            (fsConstants.O_NOFOLLOW ?? 0),
          0o600,
        );
        writeFileSync(descriptor, `${canonicalJson(entry)}\n`, "utf8");
        fsyncSync(descriptor);
        closeSync(descriptor);
        descriptor = undefined;
        try {
          linkSync(stagePath, finalPath);
          syncDirectory(canonicalDirectory, "PROMOTION_JOURNAL_DIRECTORY_SYNC");
        } catch (error) {
          if (error?.code !== "EEXIST") throw error;
          const raced = await read(lookup);
          if (raced === null || canonicalJson(raced) !== canonicalJson(entry))
            fail("PROMOTION_JOURNAL_ENTRY_DRIFT");
        }
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("V2_13_FULL_LIVE_ADAPTER_"))
          throw error;
        fail("PROMOTION_JOURNAL_WRITE");
      } finally {
        if (descriptor !== undefined) closeSync(descriptor);
        if (lstatExists(stagePath)) unlinkSync(stagePath);
        syncDirectory(canonicalDirectory, "PROMOTION_JOURNAL_DIRECTORY_SYNC");
      }
      const recorded = await read(lookup);
      if (recorded === null || canonicalJson(recorded) !== canonicalJson(entry))
        fail("PROMOTION_JOURNAL_ACK_UNKNOWN");
      return recorded;
    },
  });
}

function promotionActivationReadback(readback) {
  return {
    schemaVersion: "videoforge.v213-cloudflare-activation-readback/v1",
    sourceCommit: readback.sourceCommit,
    versionIdSha256: readback.versionIdSha256,
    deployedExecutableSha256: readback.deployedExecutableSha256,
    deployedConfigSha256: readback.deployedConfigSha256,
    productionUrlSha256: readback.productionUrlSha256,
    routeStatus: readback.routeStatus,
    routeBodySha256: readback.routeBodySha256,
    routeVersionSha256: readback.routeVersionSha256,
    routeReadbackSha256: readback.routeReadbackSha256,
    observedAt: readback.observedAt,
  };
}

function promotionRollbackReadback(readback) {
  return {
    schemaVersion: "videoforge.v213-cloudflare-rollback-readback/v1",
    disabledVersionIdSha256: readback.disabledVersionIdSha256,
    disabledConfigSha256: readback.disabledConfigSha256,
    routeStatus: readback.routeStatus,
    routeVersionSha256: readback.routeVersionSha256,
    observedAt: readback.observedAt,
  };
}

function promotionDisabledClosureReadback(readback) {
  return {
    schemaVersion: "videoforge.v213-disabled-promotion-closure/v1",
    promotionId: readback.promotionId,
    disabledVersionIdSha256: readback.disabledVersionIdSha256,
    disabledConfigSha256: readback.disabledConfigSha256,
    routeStatus: readback.routeStatus,
    routeVersionSha256: readback.routeVersionSha256,
    observedAt: readback.observedAt,
  };
}

function createRecoverableQualifiedPromotionTransport({ database, cloudflare, journal, recovery }) {
  const db = createPromotionDatabaseAdapter(database);
  const transport = {
    promoteDatabase: (input) => db.promote(input),
    dryRun: cloudflare.dryRun,
    deploy: cloudflare.deploy,
    readback: cloudflare.readback,
    routeReadback: cloudflare.routeReadback,
    rollback: cloudflare.rollback,
    recordActivation: ({ activationId, promotionId, ...readback }) =>
      db.recordCloudflareActivation({
        activationId,
        promotionId,
        readback: promotionActivationReadback(readback),
      }),
    recordRollback: ({ rollbackId, activationId, promotionId, ...readback }) =>
      db.recordCloudflareRollback({
        rollbackId,
        activationId,
        promotionId,
        readback: promotionRollbackReadback(readback),
      }),
    recordDisabledPromotionClosure: ({ closureId, promotionId, closure }) =>
      db.recordDisabledPromotionClosure({
        closureId,
        promotionId,
        closure: promotionDisabledClosureReadback({ promotionId, ...closure }),
      }),
  };
  const durableRecovery =
    recovery ??
    Object.freeze({
      journal,
      reconcileDatabasePromotion: transport.promoteDatabase,
      reconcileDeployment: cloudflare.reconcileDeployment,
      reconcileActivation: transport.recordActivation,
      readDisabledDeployment: cloudflare.readDisabledDeployment,
      reconcileRollback: cloudflare.reconcileRollback,
      reconcileRollbackRecord: transport.recordRollback,
      reconcileDisabledPromotionClosure: transport.recordDisabledPromotionClosure,
    });
  return Object.freeze({ ...transport, recovery: durableRecovery });
}

function createQualifiedPromotionAdapter({
  record,
  disabledConfigBytes,
  transport,
  database,
  cloudflare,
  journal,
  recovery,
}) {
  if (!transport) {
    if (
      cloudflare === null ||
      typeof cloudflare !== "object" ||
      [
        "dryRun",
        "deploy",
        "readback",
        "routeReadback",
        "rollback",
        "reconcileDeployment",
        "readDisabledDeployment",
        "reconcileRollback",
      ].some((name) => typeof cloudflare[name] !== "function")
    )
      fail("PROMOTION_CLOUDFLARE_TRANSPORT");
    transport = createRecoverableQualifiedPromotionTransport({
      database,
      cloudflare,
      journal,
      recovery,
    });
  }
  const adapter = async () => ({
    actualUsd: 0,
    ...(await promoteQualifiedProduction({ record, disabledConfigBytes, transport })),
  });
  adapter.reconcileCleanup = async (context) => {
    if (context?.earlyFailure === true) fail("PROMOTION_CLEANUP_CONTEXT");
    return Object.freeze({
      record: Object.freeze(record),
      result: await reconcileQualifiedProductionCleanup({
        record,
        disabledConfigBytes,
        transport,
      }),
    });
  };
  adapter.hasCleanupMaterialization = async () => true;
  return Object.freeze(adapter);
}

function createProtectedPromotionAdapter({
  environment = process.env,
  spawn = spawnSync,
  fetchImpl = fetch,
} = {}) {
  const run = async ({ cleanupOnly, context = {} }, state) => {
    const cancellationSignal = cleanupOnly ? undefined : context.cancellationSignal;
    const checkCancellation = () => {
      if (cancellationSignal?.aborted === true) fail("PROMOTION_CANCELLED");
      context.cancellationCheck?.();
    };
    checkCancellation();
    const promotionPreflight = preflightPromotionInputs({ environment, state, spawn });
    const recordPath = protectedFile(
      environment.VIDEOFORGE_V2_13_PROMOTION_RECORD_FILE,
      "PROMOTION_RECORD_FILE",
    );
    const disabledPath = protectedFile(
      environment.VIDEOFORGE_V2_13_DISABLED_CONFIG_FILE,
      "PROMOTION_DISABLED_CONFIG_FILE",
    );
    const databaseUrl = readFileSync(
      protectedFile(
        environment.VIDEOFORGE_V2_13_OPERATOR_DATABASE_URL_FILE,
        "PROMOTION_OPERATOR_DATABASE_URL_FILE",
      ),
      "utf8",
    );
    let record;
    try {
      record = JSON.parse(readFileSync(recordPath, "utf8"));
    } catch {
      fail("PROMOTION_RECORD_JSON");
    }
    const promotionService = ownerServiceEndpoint(
      environment.VIDEOFORGE_V2_13_POSTGRES_INPUT_DIR,
      "PROMOTION_OWNER_SERVICE",
    );
    parseExactOperatorDatabaseUrl(
      databaseUrl,
      { host: promotionService.host, database: promotionService.dbname },
      "PROMOTION_OPERATOR_DATABASE_URL",
    );
    const oauthConfigPath = promotionPreflight.oauthConfigPath;
    protectedFile(oauthConfigPath, "PROMOTION_WRANGLER_OAUTH_CONFIG_FILE");
    const disabledConfigBytes = readFileSync(disabledPath);
    const { Pool } = requireWeb("@neondatabase/serverless");
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const database = { query: (sql, parameters) => pool.query(sql, parameters) };
    const directory = mkdtempSync(resolve(tmpdir(), "videoforge-v213-promotion-"));
    const enabledPath = resolve(directory, "wrangler.enabled.json");
    const disabledRollbackPath = resolve(directory, "wrangler.disabled.json");
    const dryOutput = resolve(directory, "dry-run");
    let enabledConfig;
    try {
      enabledConfig = JSON.parse(disabledConfigBytes.toString("utf8"));
      enabledConfig.vars.VIDEOFORGE_GPU_TRANSPORT = "QUALIFIED_EXACT";
    } catch {
      fail("PROMOTION_ENABLED_CONFIG_RENDER");
    }
    const enabledConfigBytes = Buffer.from(`${JSON.stringify(enabledConfig, null, 2)}\n`);
    if (sha256(enabledConfigBytes) !== record.release.enabled_config_sha256)
      fail("PROMOTION_ENABLED_CONFIG_HASH");
    writeFileSync(enabledPath, enabledConfigBytes, { mode: 0o600, flag: "wx" });
    writeFileSync(disabledRollbackPath, disabledConfigBytes, { mode: 0o600, flag: "wx" });
    // The account was authenticated and scope-checked before this adapter can invoke any
    // Wrangler command. Keep the checked identity for every later refresh/readback.
    let cloudflareAccountId = promotionPreflight.accountId;
    const expectedScopes = promotionPreflight.expectedScopes;
    const oauthEnvironment = Object.fromEntries(
      ["HOME", "XDG_CONFIG_HOME", "PATH", "TMPDIR", "LANG", "LC_ALL"].flatMap((name) =>
        typeof environment[name] === "string" && environment[name] !== ""
          ? [[name, environment[name]]]
          : [],
      ),
    );
    Object.assign(oauthEnvironment, {
      CI: "1",
      WRANGLER_SEND_METRICS: "false",
    });
    const promotionTimeoutMs = () => {
      const remaining = Date.parse(state?.expires_at ?? "") - Date.now();
      return cleanupOnly || !Number.isFinite(remaining)
        ? PROMOTION_CHILD_MAX_TIMEOUT_MS
        : Math.max(1, Math.min(PROMOTION_CHILD_MAX_TIMEOUT_MS, remaining));
    };
    const runCommand = async (command, args, options, code) => {
      checkCancellation();
      if (spawn !== spawnSync) {
        const result = spawn(command, args, options);
        if (result.status !== 0 || typeof result.stdout !== "string") fail(code);
        checkCancellation();
        return result;
      }
      const result = await runCancellableChildProcess({
        command,
        args,
        options,
        timeoutMs: promotionTimeoutMs(),
        cancellationSignal,
        timeoutCode: `${code}_TIMEOUT`,
        cancellationCode: "PROMOTION_CANCELLED",
        executionCode: code,
      });
      if (result.status !== 0 || typeof result.stdout !== "string") fail(code);
      checkCancellation();
      return result;
    };
    const runWrangler = async (args) => {
      if (!/^[0-9a-f]{32}$/u.test(cloudflareAccountId ?? "")) fail("PROMOTION_ACCOUNT_ID_DRIFT");
      checkCancellation();
      refreshWranglerOAuthReadback({
        configPath: oauthConfigPath,
        environment,
        accountId: cloudflareAccountId,
        expectedScopes,
        spawn,
      });
      checkCancellation();
      const result = await runCommand(
        "pnpm",
        ["--filter", "@videoforge/web", "exec", "wrangler", ...args],
        {
          cwd: ROOT,
          encoding: "utf8",
          shell: false,
          env: oauthEnvironment,
          stdio: ["ignore", "pipe", "pipe"],
          maxBuffer: 4 * 1024 * 1024,
        },
        "PROMOTION_CLOUDFLARE_COMMAND",
      );
      return result.stdout;
    };
    const activeVersion = async (configPath = enabledPath) => {
      let value;
      try {
        value = JSON.parse(
          await runWrangler(["deployments", "status", "--json", "--config", configPath]),
        );
      } catch {
        fail("PROMOTION_VERSION_READBACK");
      }
      const found = [];
      const visit = (item) => {
        if (!item || typeof item !== "object") return;
        if (
          typeof item.version_id === "string" &&
          (item.percentage === 100 || item.percentage === 1)
        )
          found.push(item.version_id);
        Object.values(item).forEach(visit);
      };
      visit(value);
      if (new Set(found).size !== 1) fail("PROMOTION_VERSION_READBACK");
      return [...new Set(found)][0];
    };
    const versionReadback = async (versionId, configPath = enabledPath) => {
      let version;
      try {
        version = JSON.parse(
          await runWrangler(["versions", "view", versionId, "--json", "--config", configPath]),
        );
      } catch {
        fail("PROMOTION_BINDING_READBACK");
      }
      const versionText = JSON.stringify(version);
      return Object.freeze({
        versionText,
        exactBindings: [
          "VIDEO_WORKFLOW",
          "HOSTED_PAIR_WORKFLOW",
          "VIDEOFORGE_RUNTIME_DATABASE",
          "VIDEOFORGE_RECONCILER_DATABASE",
          "VIDEOFORGE_GPU_TRANSPORT",
        ].every((name) => versionText.includes(name)),
        gpuTransport: versionText.includes("QUALIFIED_EXACT")
          ? "QUALIFIED_EXACT"
          : versionText.includes("DISABLED_UNQUALIFIED")
            ? "DISABLED_UNQUALIFIED"
            : null,
      });
    };
    const disabledDeploymentReadback = async () => {
      const versionId = await activeVersion(disabledRollbackPath);
      if (versionId !== record.cloudflare.disabled_version_id) return null;
      const version = await versionReadback(versionId, disabledRollbackPath);
      let route;
      try {
        route = await fetchImpl(`${record.cloudflare.public_origin}/api/v2/hosted/status`, {
          method: "GET",
          redirect: "error",
          signal:
            cancellationSignal === undefined
              ? AbortSignal.timeout(30_000)
              : AbortSignal.any([cancellationSignal, AbortSignal.timeout(30_000)]),
        });
      } catch {
        fail("PROMOTION_ROLLBACK_ROUTE_READBACK");
      }
      const routeVersionId = route.headers.get("x-videoforge-worker-version");
      let body;
      try {
        body = await route.json();
      } catch {
        fail("PROMOTION_ROLLBACK_ROUTE_READBACK");
      }
      return Object.freeze({
        gpuTransport: body?.gpu_transport ?? version.gpuTransport,
        configSha256: record.release.disabled_config_sha256,
        versionSha256: sha256(Buffer.from(versionId)),
        gpuDispatchPerformed: false,
        cloudflareMutationPerformed: false,
        routeDisabled: versionId === record.cloudflare.disabled_version_id,
        routeStatus: route.status,
        routeVersionSha256: routeVersionId ? sha256(Buffer.from(routeVersionId)) : null,
        observedAt: new Date().toISOString(),
      });
    };
    const cloudflare = {
      dryRun: async (bytes) => {
        const candidate = JSON.parse(bytes.toString("utf8"));
        if (canonicalJson(candidate) !== canonicalJson(enabledConfig))
          fail("PROMOTION_ENABLED_CONFIG_DRIFT");
        if (!/^[0-9a-f]{32}$/u.test(String(enabledConfig.account_id ?? "")))
          fail("PROMOTION_ACCOUNT_ID_DRIFT");
        cloudflareAccountId = String(enabledConfig.account_id);
        if (cloudflareAccountId !== promotionPreflight.accountId)
          fail("PROMOTION_ACCOUNT_ID_DRIFT");
        if (sha256(Buffer.from(cloudflareAccountId)) !== record.cloudflare.account_id_sha256)
          fail("PROMOTION_ACCOUNT_ID_DRIFT");
        const build = await runCommand(
          "pnpm",
          ["--filter", "@videoforge/web", "build:cloudflare"],
          {
            cwd: ROOT,
            encoding: "utf8",
            shell: false,
            env: { PATH: environment.PATH ?? process.env.PATH, CI: "1" },
            stdio: ["ignore", "pipe", "pipe"],
          },
          "PROMOTION_PRODUCTION_FIREWALL",
        );
        if (build.status !== 0) fail("PROMOTION_PRODUCTION_FIREWALL");
        await runWrangler(["deploy", "--dry-run", "--outdir", dryOutput, "--config", enabledPath]);
        return {
          configSha256: sha256(bytes),
          bundleSha256: hashV213DryOutputBundle(dryOutput),
          productionFirewallPassed: true,
          gpuDispatchPerformed: false,
          cloudflareMutationPerformed: false,
        };
      },
      deploy: async (bytes) => {
        if (sha256(bytes) !== record.release.enabled_config_sha256)
          fail("PROMOTION_ENABLED_CONFIG_DRIFT");
        await runWrangler(["deploy", "--config", enabledPath]);
        const versionId = await activeVersion(enabledPath);
        return {
          configSha256: sha256(bytes),
          versionSha256: sha256(Buffer.from(versionId)),
          versionId,
          gpuDispatchPerformed: false,
          cloudflareMutationPerformed: true,
        };
      },
      readback: async (deployed) => {
        const versionId = await activeVersion(enabledPath);
        if (deployed.versionId !== versionId) fail("PROMOTION_DEPLOYED_VERSION_DRIFT");
        const version = await versionReadback(versionId, enabledPath);
        const proof = {
          versionId,
          configSha256: record.release.enabled_config_sha256,
          exactBindings: version.exactBindings,
        };
        return {
          versionSha256: sha256(Buffer.from(versionId)),
          configSha256: record.release.enabled_config_sha256,
          workerName: record.cloudflare.worker_name,
          workflowName: record.cloudflare.workflow_name,
          pairWorkflowName: `${record.cloudflare.workflow_name}-pair`,
          publicOrigin: record.cloudflare.public_origin,
          gpuTransport: version.gpuTransport,
          exactBindings: version.exactBindings,
          gpuDispatchPerformed: false,
          cloudflareMutationPerformed: false,
          evidenceSha256: sha256(Buffer.from(JSON.stringify(proof))),
        };
      },
      reconcileDeployment: async () => {
        const versionId = await activeVersion(enabledPath);
        if (versionId === record.cloudflare.disabled_version_id) return null;
        const version = await versionReadback(versionId, enabledPath);
        if (version.gpuTransport !== "QUALIFIED_EXACT" || version.exactBindings !== true)
          return null;
        return Object.freeze({
          configSha256: record.release.enabled_config_sha256,
          versionSha256: sha256(Buffer.from(versionId)),
          versionId,
          gpuDispatchPerformed: false,
          cloudflareMutationPerformed: true,
        });
      },
      routeReadback: async (readback) => {
        let route;
        try {
          route = await fetchImpl(`${record.cloudflare.public_origin}/api/v2/hosted/status`, {
            method: "GET",
            redirect: "error",
            signal:
              cancellationSignal === undefined
                ? AbortSignal.timeout(30_000)
                : AbortSignal.any([cancellationSignal, AbortSignal.timeout(30_000)]),
          });
        } catch {
          fail("PROMOTION_ROUTE_READBACK");
        }
        const versionId = route.headers.get("x-videoforge-worker-version");
        let body;
        let bodyBytes;
        try {
          bodyBytes = Buffer.from(await route.text(), "utf8");
          if (bodyBytes.length === 0 || bodyBytes.length > 1_048_576)
            fail("PROMOTION_ROUTE_READBACK");
          body = JSON.parse(bodyBytes.toString("utf8"));
        } catch {
          fail("PROMOTION_ROUTE_READBACK");
        }
        return {
          routeReady: route.ok && sha256(Buffer.from(versionId ?? "")) === readback.versionSha256,
          routeStatus: route.status,
          routeVersionSha256: versionId ? sha256(Buffer.from(versionId)) : null,
          productionUrlSha256: sha256(Buffer.from(record.cloudflare.public_origin)),
          routeBodySha256: sha256(bodyBytes),
          gpuTransport: body?.gpu_transport,
          gpuDispatchPerformed: false,
          cloudflareMutationPerformed: false,
        };
      },
      rollback: async (bytes) => {
        if (sha256(bytes) !== record.release.disabled_config_sha256)
          fail("PROMOTION_DISABLED_CONFIG_DRIFT");
        await runWrangler([
          "rollback",
          record.cloudflare.disabled_version_id,
          "--yes",
          "--config",
          disabledRollbackPath,
        ]);
        const readback = await disabledDeploymentReadback();
        if (readback === null) fail("PROMOTION_ROLLBACK_VERSION_READBACK");
        return Object.freeze({ ...readback, cloudflareMutationPerformed: true });
      },
      readDisabledDeployment: disabledDeploymentReadback,
      reconcileRollback: async () =>
        (await disabledDeploymentReadback()) ?? cloudflare.rollback(disabledConfigBytes),
    };
    try {
      const journal = createDurablePromotionFileJournal({
        directory: resolve(dirname(recordPath), `.${basename(recordPath)}.journal`),
      });
      const transport = createRecoverableQualifiedPromotionTransport({
        database,
        cloudflare,
        journal,
      });
      const result = await (cleanupOnly
        ? reconcileQualifiedProductionCleanup({ record, disabledConfigBytes, transport })
        : promoteQualifiedProduction({ record, disabledConfigBytes, transport }));
      if (cleanupOnly)
        return Object.freeze({ record: Object.freeze(record), result: Object.freeze(result) });
      return {
        actualUsd: 0,
        ...result,
      };
    } finally {
      await pool.end();
      rmSync(directory, { recursive: true, force: true });
    }
  };
  const adapter = (context, state) => run({ cleanupOnly: false, context }, state);
  adapter.reconcileCleanup = (context, state) => {
    if (context?.earlyFailure === true) fail("PROMOTION_CLEANUP_CONTEXT");
    return run({ cleanupOnly: true, context }, state);
  };
  adapter.hasCleanupMaterialization = async () => {
    const recordPath = environment.VIDEOFORGE_V2_13_PROMOTION_RECORD_FILE;
    if (typeof recordPath !== "string" || recordPath === "") fail("PROMOTION_RECORD_FILE_MISSING");
    const journalPath = resolve(dirname(recordPath), `.${basename(recordPath)}.journal`);
    if (lstatExists(recordPath)) {
      protectedFile(recordPath, "PROMOTION_RECORD_FILE");
      return true;
    }
    if (lstatExists(journalPath)) fail("PROMOTION_JOURNAL_WITHOUT_RECORD");
    return false;
  };
  return Object.freeze(adapter);
}

const QUALIFIED_PRODUCTION_CLEANUP_PROOF_SCHEMA =
  "videoforge.v213-qualified-production-cleanup-proof/v1";
const PROMOTION_CLEANUP_ABSENCE_PROOF_SCHEMA = "videoforge.v213-promotion-cleanup-absence-proof/v1";

function exactQualifiedProductionCleanupProof(value) {
  const keys = [
    "databasePromotionAttempted",
    "databasePromotionSha256",
    "databaseRollbackRecorded",
    "databaseRollbackSha256",
    "disabledConfigSha256",
    "disabledVersionSha256",
    "enabled",
    "fullLiveAuthorityId",
    "gpuDispatchPerformed",
    "productionRedispatched",
    "promotionId",
    "proofSha256",
    "providerReadbackPassed",
    "routeStatus",
    "schemaVersion",
    "state",
  ];
  if (
    !exactObjectKeys(value, keys) ||
    value.schemaVersion !== QUALIFIED_PRODUCTION_CLEANUP_PROOF_SCHEMA ||
    !/^[0-9a-f-]{36}$/u.test(value.fullLiveAuthorityId ?? "") ||
    !/^[0-9a-f-]{36}$/u.test(value.promotionId ?? "") ||
    value.state !== "DISABLED_UNQUALIFIED" ||
    value.enabled !== false ||
    value.gpuDispatchPerformed !== false ||
    value.productionRedispatched !== false ||
    value.providerReadbackPassed !== true ||
    value.routeStatus !== 503 ||
    !HASH.test(value.disabledConfigSha256 ?? "") ||
    !HASH.test(value.disabledVersionSha256 ?? "") ||
    typeof value.databasePromotionAttempted !== "boolean" ||
    (value.databasePromotionAttempted
      ? !HASH.test(value.databasePromotionSha256 ?? "")
      : value.databasePromotionSha256 !== null) ||
    typeof value.databaseRollbackRecorded !== "boolean" ||
    (value.databaseRollbackRecorded
      ? !HASH.test(value.databaseRollbackSha256 ?? "")
      : value.databaseRollbackSha256 !== null) ||
    value.databasePromotionAttempted !== value.databaseRollbackRecorded ||
    !HASH.test(value.proofSha256 ?? "")
  )
    fail("PROMOTION_CLEANUP_PROOF");
  const unsigned = { ...value };
  delete unsigned.proofSha256;
  if (canonicalSha256(unsigned) !== value.proofSha256) fail("PROMOTION_CLEANUP_PROOF_HASH");
  return Object.freeze(value);
}

function createQualifiedProductionCleanupProof(record, result) {
  if (
    result?.state !== "DISABLED_UNQUALIFIED" ||
    result.enabled !== false ||
    result.gpuDispatchPerformed !== false ||
    result.versionSha256 !== record?.cloudflare?.disabled_version_sha256 ||
    typeof result.databasePromotionAttempted !== "boolean" ||
    (result.databasePromotionAttempted
      ? !HASH.test(result.databasePromotionSha256 ?? "")
      : result.databasePromotionSha256 !== null) ||
    typeof result.rollbackRecorded !== "boolean" ||
    (result.rollbackRecorded
      ? !HASH.test(result.rollbackSha256 ?? "")
      : result.rollbackSha256 !== null) ||
    result.databasePromotionAttempted !== result.rollbackRecorded
  )
    fail("PROMOTION_CLEANUP_RESULT");
  const unsigned = {
    schemaVersion: QUALIFIED_PRODUCTION_CLEANUP_PROOF_SCHEMA,
    fullLiveAuthorityId: record.database.full_live_authority_id,
    promotionId: record.database.promotion_id,
    state: "DISABLED_UNQUALIFIED",
    enabled: false,
    gpuDispatchPerformed: false,
    productionRedispatched: false,
    providerReadbackPassed: true,
    routeStatus: 503,
    disabledConfigSha256: record.release.disabled_config_sha256,
    disabledVersionSha256: record.cloudflare.disabled_version_sha256,
    databasePromotionAttempted: result.databasePromotionAttempted,
    databasePromotionSha256: result.databasePromotionSha256,
    databaseRollbackRecorded: result.rollbackRecorded,
    databaseRollbackSha256: result.rollbackSha256,
  };
  return exactQualifiedProductionCleanupProof({
    ...unsigned,
    proofSha256: canonicalSha256(unsigned),
  });
}

function createPromotionCleanupAbsenceProof(state) {
  if (
    !/^[0-9a-f-]{36}$/u.test(state?.authority_id ?? "") ||
    !/^[0-9a-f-]{36}$/u.test(state?.full_live_authority_id ?? "")
  )
    fail("PROMOTION_CLEANUP_ABSENCE_STATE");
  const unsigned = {
    schemaVersion: PROMOTION_CLEANUP_ABSENCE_PROOF_SCHEMA,
    authorityId: state.authority_id,
    fullLiveAuthorityId: state.full_live_authority_id,
    promotionWorkId: `${state.authority_id}:promote-qualified-production`.toLowerCase(),
    promotionRecordMaterialized: false,
    promotionJournalMaterialized: false,
    databaseMutationPossible: false,
    cloudflareMutationPossible: false,
  };
  return Object.freeze({ ...unsigned, proofSha256: canonicalSha256(unsigned) });
}

function createPromotionAwareCleanupAdapter({
  operationId,
  adapter,
  reconcilePromotionCleanup,
  hasPromotionMaterialization,
}) {
  if (
    !["restore-endpoints-max-one", "reconcile-exact-resources"].includes(operationId) ||
    typeof adapter !== "function" ||
    typeof reconcilePromotionCleanup !== "function" ||
    typeof hasPromotionMaterialization !== "function"
  )
    fail("PROMOTION_CLEANUP_ADAPTER_CONTRACT");
  return async (context, state, priorResults, outerStateSha256) => {
    if (context?.earlyFailure === true)
      return adapter(context, state, priorResults, outerStateSha256);
    if ((await hasPromotionMaterialization(context, state)) === false) {
      const proof = createPromotionCleanupAbsenceProof(state);
      const result = await adapter(context, state, priorResults, outerStateSha256);
      if ((await hasPromotionMaterialization(context, state)) !== false)
        fail("PROMOTION_MATERIALIZED_DURING_ABSENCE_CLEANUP");
      return Object.freeze({
        ...result,
        promotionCleanupAbsence: proof,
        promotionCleanupAbsenceEvidenceSha256: proof.proofSha256,
      });
    }
    const reconciled = await reconcilePromotionCleanup(
      context,
      state,
      priorResults,
      outerStateSha256,
    );
    const proof = createQualifiedProductionCleanupProof(reconciled.record, reconciled.result);
    const result = await adapter(
      Object.freeze({ ...context, qualifiedProductionCleanup: proof }),
      state,
      priorResults,
      outerStateSha256,
    );
    return Object.freeze({
      ...result,
      qualifiedProductionCleanup: proof,
      promotionCleanupEvidenceSha256: proof.proofSha256,
    });
  };
}

function createV213DurableStageStore({
  database,
  fullLiveAuthorityId,
  signAuthority,
  nonce = () => randomBytes(24).toString("base64url"),
}) {
  if (
    database === null ||
    typeof database !== "object" ||
    typeof database.query !== "function" ||
    !/^[0-9a-f-]{36}$/u.test(fullLiveAuthorityId ?? "") ||
    typeof signAuthority !== "function" ||
    typeof nonce !== "function"
  )
    fail("DURABLE_STAGE_STORE_CONTRACT");
  const one = async (sql, parameters, code) => {
    const result = await database.query(sql, parameters);
    if (!Array.isArray(result?.rows) || result.rows.length !== 1) fail(code);
    return result.rows[0].value;
  };
  return Object.freeze({
    async issueStageAuthority(input) {
      const now = await one(
        "SELECT to_char(transaction_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') value",
        [],
        "DURABLE_TIME",
      );
      const issuedAt = new Date(now).toISOString();
      const unsigned = {
        schemaVersion: "videoforge.v213-stage-authority/v1",
        authorityId: `v213-${input.stage}-${sha256(Buffer.from(`${input.inputSha256}:${input.predecessorHandoffSha256}:${nonce()}`)).slice(7, 39)}`,
        stage: input.stage,
        inputSha256: input.inputSha256,
        predecessorHandoffSha256: input.predecessorHandoffSha256,
        nonce: nonce(),
        issuedAt,
        expiresAt: new Date(Date.parse(issuedAt) + 10 * 60_000).toISOString(),
        singleUse: true,
      };
      const signatureBase64 = await signAuthority(structuredClone(unsigned));
      const authority = { ...unsigned, signatureBase64 };
      return one(
        "SELECT public.videoforge_record_v213_stage_authority($1::uuid,$2::jsonb) value",
        [fullLiveAuthorityId, JSON.stringify(authority)],
        "DURABLE_ISSUE",
      );
    },
    claimStageAuthority: (authority) =>
      one(
        "SELECT public.videoforge_claim_v213_stage_authority($1::jsonb) value",
        [JSON.stringify(authority)],
        "DURABLE_CLAIM",
      ),
    async completeStageAuthority(authorityId, handoffSha256, handoff) {
      await database.query(
        "SELECT public.videoforge_complete_v213_stage_authority($1,$2,$3::jsonb)",
        [authorityId, handoffSha256, JSON.stringify(handoff)],
      );
    },
    claimOperation: (input) =>
      one(
        "SELECT public.videoforge_claim_v213_operation($1::jsonb) value",
        [JSON.stringify(input)],
        "DURABLE_OPERATION_CLAIM",
      ),
    transitionOperation: (input) =>
      one(
        "SELECT public.videoforge_transition_v213_operation($1::jsonb) value",
        [JSON.stringify(input)],
        "DURABLE_OPERATION_TRANSITION",
      ),
  });
}

function createV213AcceptanceAdapters({ adapter, calls, v209 }) {
  if (
    adapter === null ||
    typeof adapter !== "object" ||
    ["executeV210", "executeV211", "executeV212", "executeV213"].some(
      (name) => typeof adapter[name] !== "function",
    ) ||
    calls === null ||
    typeof calls !== "object" ||
    ["v210", "v211", "v212", "v213"].some((name) => calls[name] === undefined) ||
    typeof v209 !== "function"
  )
    fail("ACCEPTANCE_COMPOSITION");
  const run = (name, input) => async () => {
    const result = await adapter[name](input);
    const summary = result?.summary;
    if (
      result?.liveAcceptanceClaimed !== true ||
      summary?.terminal !== true ||
      summary.zeroWorkersAfter !== true ||
      !HASH.test(summary.evidenceSha256 ?? "") ||
      typeof summary.settledCostUsd !== "number"
    )
      fail("ACCEPTANCE_SUMMARY", name);
    return { actualUsd: summary.settledCostUsd, accepted: true, ...summary };
  };
  return Object.freeze({
    "v2-09-short-hosted-project": v209,
    "v2-10-operator-free-ranga-pilot": run("executeV210", calls.v210),
    "v2-11-two-concurrent-owned-projects": run("executeV211", calls.v211),
    "v2-12-long-output": run("executeV212", calls.v212),
    "v2-13-final-two-lane-smoke": run("executeV213", calls.v213),
  });
}

function protectedFile(path, code) {
  if (typeof path !== "string" || path === "" || path.includes("\0")) fail(code);
  const status = lstatSync(path);
  if (!status.isFile() || status.isSymbolicLink() || (status.mode & 0o077) !== 0) fail(code);
  return path;
}

function protectedSingleLinkFile(path, code) {
  protectedFile(path, code);
  if (realpathSync(path) !== resolve(path) || lstatSync(path).nlink !== 1) fail(code);
  return path;
}

function qualificationProtectedInputFiles(descriptors) {
  if (canonicalJson(descriptors) !== canonicalJson(QUALIFICATION_PROTECTED_INPUTS))
    fail("QUALIFICATION_PROTECTED_INPUT_DESCRIPTOR_DRIFT");
  return Object.fromEntries(
    Object.entries(QUALIFICATION_PROTECTED_INPUTS).map(([key, descriptor]) => {
      const path = resolve(ROOT, descriptor.path);
      if (relative(ROOT, path) !== descriptor.path) fail("QUALIFICATION_PROTECTED_INPUT_PATH", key);
      protectedSingleLinkFile(path, `QUALIFICATION_PROTECTED_INPUT:${key}`);
      const bytes = readFileSync(path);
      if (bytes.length !== descriptor.sizeBytes || sha256(bytes) !== descriptor.sha256)
        fail("QUALIFICATION_PROTECTED_INPUT_DRIFT", key);
      return [key, path];
    }),
  );
}

function parseExactOperatorDatabaseUrl(
  raw,
  { host, database, role = PREQUALIFICATION_OPERATOR_ROLE },
  code = "PREQUALIFICATION_OPERATOR_BINDING",
) {
  if (
    typeof raw !== "string" ||
    raw === "" ||
    raw !== raw.trim() ||
    raw.includes("\0") ||
    typeof host !== "string" ||
    host === "" ||
    typeof database !== "string" ||
    database === "" ||
    typeof role !== "string" ||
    role === ""
  )
    fail(code);
  let parsed;
  try {
    parsed = new URL(raw);
    if (decodeURIComponent(parsed.username) !== role || decodeURIComponent(parsed.password) === "")
      fail(code);
  } catch {
    fail(code);
  }
  const parameters = [...parsed.searchParams.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  );
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    parsed.hostname !== host ||
    decodeURIComponent(parsed.pathname.slice(1)) !== database ||
    (parsed.pathname !== `/${encodeURIComponent(database)}` &&
      parsed.pathname !== `/${database}`) ||
    parsed.hash !== "" ||
    parameters.length !== 2 ||
    JSON.stringify(parameters) !==
      JSON.stringify([
        ["channel_binding", "require"],
        ["sslmode", "require"],
      ])
  )
    fail(code);
  return parsed;
}

function ownerServiceEndpoint(directory, code = "PREQUALIFICATION_OWNER_SERVICE") {
  const servicePath = join(
    protectedDirectory(directory, "PREQUALIFICATION_POSTGRES_DIRECTORY"),
    "owner.pg_service.conf",
  );
  protectedFile(servicePath, code);
  const serviceText = readFileSync(servicePath, "utf8");
  const values = Object.fromEntries(
    [...serviceText.matchAll(/^\s*(host|dbname)\s*=\s*(\S+)\s*$/gmu)].map((match) => [
      match[1],
      match[2],
    ]),
  );
  if (
    typeof values.host !== "string" ||
    values.host === "" ||
    typeof values.dbname !== "string" ||
    values.dbname === ""
  )
    fail(code);
  return Object.freeze(values);
}

const MATERIALIZATION_GENESIS = sha256(
  Buffer.from("videoforge.v213-full-live-materialization-chain/v1:genesis"),
);
const MATERIALIZATION_CHAIN_SCHEMA = "videoforge.v213-full-live-materialization-chain/v1";
const MATERIALIZATION_ENTRY_KEYS = Object.freeze([
  "authority_id",
  "entry_sha256",
  "kind",
  "ordered_output_sha256s",
  "ordered_prior_operation_evidence_sha256s",
  "outer_state_sha256",
  "prior_chain_sha256",
]);
const MATERIALIZATION_STAGE_ORDER = Object.freeze([
  "prequalification-descriptor",
  "production-input",
  "media-worker-release-readback",
  "max-one-endpoint-bindings",
  "activation-record",
  "promotion-record",
  "post-consumption-command-payloads",
  "cleanup-pre-endpoint-descriptor",
]);

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function validateMaterializationPairs(value, code) {
  if (!Array.isArray(value)) fail(code);
  const names = new Set();
  for (const pair of value) {
    if (
      !Array.isArray(pair) ||
      pair.length !== 2 ||
      typeof pair[0] !== "string" ||
      pair[0] === "" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/u.test(pair[0]) ||
      names.has(pair[0]) ||
      !HASH.test(pair[1] ?? "")
    )
      fail(code);
    names.add(pair[0]);
  }
}

/**
 * Verify the complete materialization chain, including every prior link and the canonical bytes
 * used for each entry hash.  A valid tail is not enough: accepting a tampered predecessor would
 * let a later production input appear to be bound to an unrelated authority or result.
 */
function validateMaterializationChainDocument(chain) {
  if (
    chain === null ||
    typeof chain !== "object" ||
    Array.isArray(chain) ||
    chain.schema_version !== MATERIALIZATION_CHAIN_SCHEMA ||
    Object.keys(chain).sort().join(",") !== "entries,schema_version" ||
    !Array.isArray(chain.entries) ||
    chain.entries.length > MATERIALIZATION_STAGE_ORDER.length
  )
    fail("MATERIALIZATION_CHAIN_CONTRACT");
  const entries = chain.entries;
  const seenKinds = new Set();
  let previous = MATERIALIZATION_GENESIS;
  let authorityId;
  for (const entry of entries) {
    if (
      entry === null ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      Object.keys(entry).sort().join(",") !== MATERIALIZATION_ENTRY_KEYS.slice().sort().join(",") ||
      !MATERIALIZATION_STAGE_ORDER.includes(entry.kind) ||
      seenKinds.has(entry.kind) ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,191}$/u.test(entry.authority_id ?? "") ||
      !HASH.test(entry.outer_state_sha256 ?? "") ||
      !HASH.test(entry.prior_chain_sha256 ?? "") ||
      !HASH.test(entry.entry_sha256 ?? "") ||
      entry.prior_chain_sha256 !== previous ||
      (authorityId !== undefined && entry.authority_id !== authorityId)
    )
      fail("MATERIALIZATION_CHAIN_LINK");
    authorityId ??= entry.authority_id;
    validateMaterializationPairs(
      entry.ordered_prior_operation_evidence_sha256s,
      "MATERIALIZATION_CHAIN_PRIOR_EVIDENCE",
    );
    validateMaterializationPairs(
      entry.ordered_output_sha256s,
      "MATERIALIZATION_CHAIN_OUTPUT_EVIDENCE",
    );
    const unsigned = { ...entry };
    delete unsigned.entry_sha256;
    const recomputed = sha256(Buffer.from(`${canonicalJson(unsigned)}\n`));
    if (recomputed !== entry.entry_sha256) fail("MATERIALIZATION_CHAIN_ENTRY_HASH");
    seenKinds.add(entry.kind);
    previous = entry.entry_sha256;
  }
  const kinds = entries.map((entry) => entry.kind);
  if (kinds[0] === "cleanup-pre-endpoint-descriptor") {
    if (kinds.length !== 1) fail("MATERIALIZATION_CHAIN_ORDER");
  } else {
    const cleanupIndex = kinds.indexOf("cleanup-pre-endpoint-descriptor");
    if (cleanupIndex >= 0 && cleanupIndex !== kinds.length - 1) fail("MATERIALIZATION_CHAIN_ORDER");
    const normalKinds = cleanupIndex >= 0 ? kinds.slice(0, cleanupIndex) : kinds;
    for (let index = 0; index < normalKinds.length; index += 1) {
      if (normalKinds[index] !== MATERIALIZATION_STAGE_ORDER[index])
        fail("MATERIALIZATION_CHAIN_ORDER");
    }
  }
  return chain;
}

const materializationStageForOperation = (operationId) => {
  if (operationId === "fresh-live-preflight") return "prequalification-descriptor";
  if (["mage-live-qualification", "soulx-live-qualification"].includes(operationId))
    return "production-input";
  if (operationId === "create-exact-max-one-endpoints") return "max-one-endpoint-bindings";
  if (operationId === "guarded-activation-once") return "activation-record";
  if (operationId === "promote-qualified-production") return "promotion-record";
  if (
    [
      "record-workflow-start-authority",
      "v2-09-short-hosted-project",
      "v2-10-operator-free-ranga-pilot",
      "v2-11-two-concurrent-owned-projects",
      "v2-12-long-output",
      "v2-13-final-two-lane-smoke",
    ].includes(operationId)
  )
    return "post-consumption-command-payloads";
  if (
    [
      "restore-endpoints-max-one",
      "prove-zero-workers",
      "read-settled-billing",
      "reconcile-exact-resources",
    ].includes(operationId)
  )
    return "cleanup-pre-endpoint-descriptor";
  return null;
};

/** Verify the chain file at an executor operation boundary. */
function verifyMaterializationChainFile({
  environment = process.env,
  operation,
  state,
  earlyFailure = false,
} = {}) {
  const operationId = typeof operation === "string" ? operation : operation?.id;
  const expectedKind = materializationStageForOperation(operationId);
  if (expectedKind === null) return true;
  const path = environment.VIDEOFORGE_V2_13_MATERIALIZATION_CHAIN_FILE;
  if (typeof path !== "string" || path === "" || path.includes("\0"))
    fail("MATERIALIZATION_CHAIN_PATH");
  if (!lstatExists(path)) {
    // A failure before the bootstrap settle boundary has not materialized any production or
    // cleanup descriptor.  The endpoint-free cleanup child is intentionally still runnable with
    // only its request and RunPod FD; it must not manufacture a database-backed claim just to
    // satisfy the normal post-bootstrap chain requirement.
    if (expectedKind === "cleanup-pre-endpoint-descriptor" && earlyFailure) return true;
    fail("MATERIALIZATION_CHAIN_UNAVAILABLE");
  }
  let chain;
  try {
    chain = JSON.parse(readFileSync(protectedFile(path, "MATERIALIZATION_CHAIN_FILE"), "utf8"));
  } catch {
    fail("MATERIALIZATION_CHAIN_JSON");
  }
  validateMaterializationChainDocument(chain);
  const matched = chain.entries.find((entry) => entry.kind === expectedKind);
  if (!matched || matched.authority_id !== state?.authority_id) fail("MATERIALIZATION_CHAIN_STAGE");
  const expectedLength =
    expectedKind === "cleanup-pre-endpoint-descriptor"
      ? chain.entries[0]?.kind === expectedKind
        ? 1
        : chain.entries.length
      : MATERIALIZATION_STAGE_ORDER.indexOf(expectedKind) + 1;
  if (
    expectedKind === "cleanup-pre-endpoint-descriptor" &&
    chain.entries.at(-1)?.kind !== expectedKind
  )
    fail("MATERIALIZATION_CHAIN_STAGE_ORDER");
  if (chain.entries.length !== expectedLength) fail("MATERIALIZATION_CHAIN_STAGE_ORDER");
  return true;
}

function exactProductionDeploymentMaterialization(production) {
  const output = {};
  for (const lane of ["mage", "soulx"]) {
    const deployment = production?.[lane];
    if (
      deployment === null ||
      typeof deployment !== "object" ||
      typeof deployment.endpointId !== "string" ||
      deployment.endpointId === "" ||
      deployment.endpointId.includes("\0") ||
      sha256(Buffer.from(deployment.endpointId)) !== deployment.endpointIdSha256 ||
      !HASH.test(deployment.templateIdSha256 ?? "") ||
      !/^ghcr\.io\/.+@sha256:[0-9a-f]{64}$/u.test(deployment.image ?? "") ||
      !COMMIT.test(deployment.sourceCommit ?? "") ||
      deployment.volumeIdSha256 !==
        RUNPOD_RETAINED_LANES.find((item) => item.lane === lane)?.volumeIdSha256 ||
      deployment.volumeManifestSha256 !==
        RUNPOD_RETAINED_LANES.find((item) => item.lane === lane)?.volumeManifestSha256 ||
      deployment.region !== "EU-RO-1" ||
      deployment.gpu !== "NVIDIA GeForce RTX 4090" ||
      deployment.gpuCount !== 1 ||
      deployment.workersMin !== 0 ||
      deployment.workersMax !== 1 ||
      !HASH.test(deployment.deploymentSha256 ?? "")
    )
      fail("MAX_ONE_DEPLOYMENT_MATERIALIZATION", lane);
    output[lane] = Object.freeze({
      endpointId: deployment.endpointId,
      endpointIdSha256: deployment.endpointIdSha256,
      templateIdSha256: deployment.templateIdSha256,
      imageSha256: sha256(Buffer.from(deployment.image)),
      sourceCommit: deployment.sourceCommit,
      deploymentSha256: deployment.deploymentSha256,
      volumeIdSha256: deployment.volumeIdSha256,
      volumeManifestSha256: deployment.volumeManifestSha256,
      region: deployment.region,
      gpu: deployment.gpu,
      gpuCount: deployment.gpuCount,
      workersMin: deployment.workersMin,
      workersMax: deployment.workersMax,
      deploymentSnapshotSha256: sha256(Buffer.from(`${canonicalJson(deployment)}\n`)),
    });
  }
  if (output.mage.endpointId === output.soulx.endpointId)
    fail("MAX_ONE_DEPLOYMENT_MATERIALIZATION_DISTINCT");
  return Object.freeze(output);
}

function expectedRunPodMutationEndpointBindings(operationId, priorResults) {
  if (!RUNPOD_ACCEPTANCE_OPERATION_IDS.has(operationId)) return Object.freeze([]);
  const production = priorResults?.get("create-exact-max-one-endpoints")?.materialization
    ?.production;
  const bindings = ["mage", "soulx"].map((lane) => {
    const deployment = production?.[lane];
    const binding = {
      lane,
      endpointIdSha256: deployment?.endpointIdSha256,
      templateIdSha256: deployment?.templateIdSha256,
      imageSha256: deployment?.imageSha256,
      deploymentSha256: deployment?.deploymentSha256,
      volumeIdSha256: deployment?.volumeIdSha256,
      volumeManifestSha256: deployment?.volumeManifestSha256,
      region: deployment?.region,
      gpu: deployment?.gpu,
      gpuCount: deployment?.gpuCount,
      workersMin: deployment?.workersMin,
      workersMax: deployment?.workersMax,
    };
    if (
      ![
        binding.endpointIdSha256,
        binding.templateIdSha256,
        binding.imageSha256,
        binding.deploymentSha256,
        binding.volumeIdSha256,
        binding.volumeManifestSha256,
      ].every((value) => HASH.test(value ?? "")) ||
      binding.region !== "EU-RO-1" ||
      binding.gpu !== "NVIDIA GeForce RTX 4090" ||
      binding.gpuCount !== 1 ||
      binding.workersMin !== 0 ||
      binding.workersMax !== 1
    )
      fail("RUNPOD_MUTATION_ADMISSION_ENDPOINT_PREDECESSOR", operationId);
    return Object.freeze(binding);
  });
  if (
    new Set(bindings.map((binding) => binding.endpointIdSha256)).size !== 2 ||
    new Set(bindings.map((binding) => binding.templateIdSha256)).size !== 2
  )
    fail("RUNPOD_MUTATION_ADMISSION_ENDPOINT_PREDECESSOR", operationId);
  return Object.freeze(bindings);
}

async function readRunPodAdmissionJson(fetchImpl, url, apiKey, init = {}) {
  let response;
  try {
    response = await fetchImpl(url, {
      ...init,
      headers: {
        authorization: `Bearer ${apiKey}`,
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      },
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    fail("RUNPOD_MUTATION_ADMISSION_READ_AMBIGUOUS");
  }
  if (!response?.ok) fail("RUNPOD_MUTATION_ADMISSION_READ_FAILED");
  try {
    return await response.json();
  } catch {
    fail("RUNPOD_MUTATION_ADMISSION_RESPONSE");
  }
}

function exactRunPodInventoryArray(value, code) {
  if (!Array.isArray(value)) fail(code);
  return value;
}

function parseAuthenticatedRunPodServerlessFlexOffering(catalog) {
  const gpus = exactRunPodInventoryArray(catalog?.gpus, "RUNPOD_MUTATION_ADMISSION_RATE_CATALOG");
  const matches = gpus.filter(
    (candidate) =>
      candidate?.manufacturer === "NVIDIA" &&
      [candidate.id, candidate.name].includes("NVIDIA GeForce RTX 4090"),
  );
  const rateUsdPerSecond = Number(matches[0]?.price?.flex);
  const dataCenters = exactRunPodInventoryArray(
    matches[0]?.dataCenters,
    "RUNPOD_MUTATION_ADMISSION_SERVERLESS_AVAILABILITY",
  );
  const regions = dataCenters.filter((region) => region?.id === "EU-RO-1");
  const availability = regions[0]?.availability;
  if (
    matches.length !== 1 ||
    !Number.isFinite(rateUsdPerSecond) ||
    rateUsdPerSecond <= 0 ||
    regions.length !== 1 ||
    !["LOW", "MEDIUM", "HIGH"].includes(availability)
  )
    fail("RUNPOD_MUTATION_ADMISSION_RATE_CATALOG");
  return Object.freeze({
    rateUsdPerSecond,
    rateUsdPerGpuHour: rateUsdPerSecond * 3600,
    availability,
  });
}

export function parseAuthenticatedRunPodServerlessFlexRate(catalog) {
  const { rateUsdPerSecond, rateUsdPerGpuHour } =
    parseAuthenticatedRunPodServerlessFlexOffering(catalog);
  return Object.freeze({ rateUsdPerSecond, rateUsdPerGpuHour });
}

export function parseOfficialRunPodServerlessFlexRate(markdown) {
  if (typeof markdown !== "string" || markdown.length === 0 || markdown.length > 2_000_000)
    fail("RUNPOD_MUTATION_ADMISSION_RATE_SOURCE");
  const rows = markdown
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|"))
    .map((line) =>
      line
        .slice(1, -1)
        .split("|")
        .map((cell) => cell.trim()),
    );
  const headers = rows.filter(
    (row) =>
      row.some((cell) => /^GPU type\(s\)$/iu.test(cell)) &&
      row.some((cell) => /^Cost per second$/iu.test(cell)),
  );
  if (headers.length !== 1) fail("RUNPOD_MUTATION_ADMISSION_RATE_SOURCE");
  const costIndex = headers[0].findIndex((cell) => /^Cost per second$/iu.test(cell));
  const matches = rows.filter((row) => row.some((cell) => cell === "4090 PRO"));
  const rateMatch = /^\$([0-9]+(?:\.[0-9]+)?)$/u.exec(matches[0]?.[costIndex] ?? "");
  const rateUsdPerSecond = Number(rateMatch?.[1]);
  if (matches.length !== 1 || !Number.isFinite(rateUsdPerSecond) || rateUsdPerSecond <= 0)
    fail("RUNPOD_MUTATION_ADMISSION_RATE_SOURCE");
  return Object.freeze({
    rateUsdPerSecond,
    rateUsdPerGpuHour: rateUsdPerSecond * 3600,
  });
}

async function readOfficialRunPodServerlessFlexRate(fetchImpl, trustedTime) {
  let response;
  try {
    response = await fetchImpl(RUNPOD_SERVERLESS_FLEX_RATE_SOURCE, {
      method: "GET",
      headers: { accept: "text/markdown" },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    fail("RUNPOD_MUTATION_ADMISSION_RATE_READ_AMBIGUOUS");
  }
  const contentType = response?.headers?.get?.("content-type") ?? "";
  const sourceCheckedAt = response?.headers?.get?.("date") ?? "";
  const sourceMs = Date.parse(sourceCheckedAt);
  const trustedMs = Date.parse(trustedTime ?? "");
  if (
    !response?.ok ||
    !/^text\/markdown(?:;|$)/iu.test(contentType) ||
    (response.url !== undefined &&
      response.url !== "" &&
      response.url !== RUNPOD_SERVERLESS_FLEX_RATE_SOURCE) ||
    Number.isNaN(sourceMs) ||
    Number.isNaN(trustedMs) ||
    Math.abs(sourceMs - trustedMs) > 300_000
  )
    fail("RUNPOD_MUTATION_ADMISSION_RATE_SOURCE");
  let markdown;
  try {
    markdown = await response.text();
  } catch {
    fail("RUNPOD_MUTATION_ADMISSION_RATE_SOURCE");
  }
  return Object.freeze({
    ...parseOfficialRunPodServerlessFlexRate(markdown),
    sourceCheckedAt: new Date(sourceMs).toISOString(),
    sourceSha256: sha256(Buffer.from(markdown)),
  });
}

const RUNPOD_TERMINAL_COMPUTE_STATES = new Set(["EXITED", "TERMINATED"]);

function exactTerminalRunPodState(record, code) {
  if (record === null || typeof record !== "object" || Array.isArray(record)) fail(code);
  const desiredStatus = record.desiredStatus;
  const status = record.status;
  if (
    typeof desiredStatus !== "string" ||
    typeof status !== "string" ||
    !RUNPOD_TERMINAL_COMPUTE_STATES.has(desiredStatus) ||
    !RUNPOD_TERMINAL_COMPUTE_STATES.has(status)
  )
    fail(code);
}

function exactRunPodEndpointVolumeId(endpoint) {
  const singular = endpoint?.networkVolumeId;
  const plural = endpoint?.networkVolumeIds;
  const singularValid = typeof singular === "string" && singular !== "" && !singular.includes("\0");
  const pluralValid =
    Array.isArray(plural) &&
    plural.length === 1 &&
    typeof plural[0] === "string" &&
    plural[0] !== "" &&
    !plural[0].includes("\0");
  if (!singularValid && !pluralValid) fail("RUNPOD_MUTATION_ADMISSION_ENDPOINT_VOLUME");
  if (singularValid && pluralValid && singular !== plural[0])
    fail("RUNPOD_MUTATION_ADMISSION_ENDPOINT_VOLUME");
  return singularValid ? singular : plural[0];
}

function exactObservedRunPodEndpointBinding(endpoint, templates, expected) {
  if (
    endpoint === null ||
    typeof endpoint !== "object" ||
    Array.isArray(endpoint) ||
    typeof endpoint.id !== "string" ||
    sha256(Buffer.from(endpoint.id)) !== expected.endpointIdSha256 ||
    typeof endpoint.templateId !== "string" ||
    sha256(Buffer.from(endpoint.templateId)) !== expected.templateIdSha256 ||
    endpoint.workersMin !== 0 ||
    endpoint.workersMax !== 1 ||
    endpoint.gpuCount !== 1 ||
    canonicalJson(endpoint.gpuTypeIds) !== canonicalJson(["NVIDIA GeForce RTX 4090"]) ||
    canonicalJson(endpoint.dataCenterIds) !== canonicalJson(["EU-RO-1"]) ||
    !Array.isArray(endpoint.workers)
  )
    fail("RUNPOD_MUTATION_ADMISSION_ENDPOINTS");
  for (const worker of endpoint.workers)
    exactTerminalRunPodState(worker, "RUNPOD_MUTATION_ADMISSION_WORKER_STATE");
  const providerVolumeId = exactRunPodEndpointVolumeId(endpoint);
  if (sha256(Buffer.from(providerVolumeId)) !== expected.volumeIdSha256)
    fail("RUNPOD_MUTATION_ADMISSION_ENDPOINT_VOLUME");
  const templateMatches = templates.filter(
    (template) =>
      typeof template?.id === "string" &&
      sha256(Buffer.from(template.id)) === expected.templateIdSha256,
  );
  if (
    templateMatches.length !== 1 ||
    templateMatches[0].id !== endpoint.templateId ||
    typeof templateMatches[0].imageName !== "string" ||
    sha256(Buffer.from(templateMatches[0].imageName)) !== expected.imageSha256
  )
    fail("RUNPOD_MUTATION_ADMISSION_TEMPLATE_DRIFT");
  return Object.freeze(structuredClone(expected));
}

export function validateRunPodPerMutationRawComputeInventory({
  pods: podsValue,
  endpoints: endpointsValue,
  templates: templatesValue,
  expectedEndpointBindings,
}) {
  const pods = exactRunPodInventoryArray(podsValue, "RUNPOD_MUTATION_ADMISSION_PODS");
  for (const pod of pods) exactTerminalRunPodState(pod, "RUNPOD_MUTATION_ADMISSION_POD_STATE");
  const endpoints = exactRunPodInventoryArray(
    endpointsValue,
    "RUNPOD_MUTATION_ADMISSION_ENDPOINTS",
  );
  const templates = exactRunPodInventoryArray(
    templatesValue,
    "RUNPOD_MUTATION_ADMISSION_TEMPLATES",
  );
  if (
    !Array.isArray(expectedEndpointBindings) ||
    endpoints.length !== expectedEndpointBindings.length ||
    templates.length !== expectedEndpointBindings.length
  )
    fail("RUNPOD_MUTATION_ADMISSION_ENDPOINT_DRIFT");
  const endpointBindings = expectedEndpointBindings.map((expected) => {
    const matches = endpoints.filter(
      (endpoint) =>
        typeof endpoint?.id === "string" &&
        sha256(Buffer.from(endpoint.id)) === expected.endpointIdSha256,
    );
    if (matches.length !== 1) fail("RUNPOD_MUTATION_ADMISSION_ENDPOINT_DRIFT");
    return exactObservedRunPodEndpointBinding(matches[0], templates, expected);
  });
  if (
    new Set(endpointBindings.map((binding) => binding.templateIdSha256)).size !== templates.length
  )
    fail("RUNPOD_MUTATION_ADMISSION_TEMPLATE_DRIFT");
  return Object.freeze(endpointBindings);
}

/**
 * Read-only RunPod guard used immediately before each operation that can create an endpoint or
 * dispatch GPU work. It intentionally returns only hashes and bounded public facts: raw provider
 * IDs and the API key never cross into the outer executor state.
 */
function createRunPodPerMutationAdmissionReader({
  environment = process.env,
  fetchImpl = fetch,
  now = () => new Date(),
} = {}) {
  if (typeof fetchImpl !== "function" || typeof now !== "function")
    fail("RUNPOD_MUTATION_ADMISSION_READER");
  return async ({ operation, state, priorResults, outerStateSha256, trustedTime }) => {
    const operationId = operation?.id;
    if (!RUNPOD_PER_MUTATION_OPERATION_IDS.has(operationId))
      fail("RUNPOD_MUTATION_ADMISSION_OPERATION");
    if (!HASH.test(outerStateSha256 ?? "") || !(priorResults instanceof Map))
      fail("RUNPOD_MUTATION_ADMISSION_CONTEXT");
    const trustedMs = Date.parse(trustedTime ?? "");
    const approvedMs = Date.parse(state?.approved_at ?? "");
    const expiresMs = Date.parse(state?.expires_at ?? "");
    if (
      Number.isNaN(trustedMs) ||
      Number.isNaN(approvedMs) ||
      Number.isNaN(expiresMs) ||
      approvedMs > expiresMs ||
      trustedMs < approvedMs ||
      trustedMs > expiresMs
    )
      fail("RUNPOD_MUTATION_ADMISSION_TIME");
    const apiKey = readFileSync(
      protectedFile(
        environment.VIDEOFORGE_V2_13_RUNPOD_API_KEY_FILE,
        "RUNPOD_MUTATION_ADMISSION_KEY_FILE",
      ),
      "utf8",
    );
    if (apiKey.trim() !== apiKey || apiKey.length < 20 || apiKey.includes("\0"))
      fail("RUNPOD_MUTATION_ADMISSION_KEY_FILE");
    const authorization = { apiKey };
    const [
      account,
      serverlessCatalog,
      podsValue,
      endpointsValue,
      templatesValue,
      volumesValue,
      officialPricing,
    ] = await Promise.all([
      readRunPodAdmissionJson(fetchImpl, "https://api.runpod.io/graphql", authorization.apiKey, {
        method: "POST",
        body: JSON.stringify({ query: "query VideoForgeAccountIdentity { myself { id } }" }),
      }),
      readRunPodAdmissionJson(fetchImpl, RUNPOD_SERVERLESS_FLEX_CATALOG_URL, authorization.apiKey),
      readRunPodAdmissionJson(
        fetchImpl,
        "https://rest.runpod.io/v1/pods?includeWorkers=true",
        authorization.apiKey,
      ),
      readRunPodAdmissionJson(
        fetchImpl,
        "https://rest.runpod.io/v1/endpoints?includeTemplate=true&includeWorkers=true",
        authorization.apiKey,
      ),
      readRunPodAdmissionJson(
        fetchImpl,
        "https://rest.runpod.io/v1/templates?includeEndpointBoundTemplates=true",
        authorization.apiKey,
      ),
      readRunPodAdmissionJson(
        fetchImpl,
        "https://rest.runpod.io/v1/networkvolumes",
        authorization.apiKey,
      ),
      readOfficialRunPodServerlessFlexRate(fetchImpl, trustedTime),
    ]);
    const accountId = account?.data?.myself?.id;
    if (
      typeof accountId !== "string" ||
      account?.errors !== undefined ||
      sha256(Buffer.from(accountId)) !== RUNPOD_ACCOUNT_ID_SHA256
    )
      fail("RUNPOD_MUTATION_ADMISSION_ACCOUNT");
    const authenticatedOffering = parseAuthenticatedRunPodServerlessFlexOffering(serverlessCatalog);
    if (
      authenticatedOffering.rateUsdPerSecond !== officialPricing.rateUsdPerSecond ||
      authenticatedOffering.rateUsdPerGpuHour !== officialPricing.rateUsdPerGpuHour
    )
      fail("RUNPOD_MUTATION_ADMISSION_RATE_DRIFT");
    const expectedEndpointBindings = expectedRunPodMutationEndpointBindings(
      operationId,
      priorResults,
    );
    const endpointBindings = validateRunPodPerMutationRawComputeInventory({
      pods: podsValue,
      endpoints: endpointsValue,
      templates: templatesValue,
      expectedEndpointBindings,
    });
    const volumes = exactRunPodInventoryArray(volumesValue, "RUNPOD_MUTATION_ADMISSION_VOLUMES");
    const exactVolumes = RUNPOD_RETAINED_LANES.map((lane) => {
      const matches = volumes.filter(
        (volume) =>
          typeof volume?.id === "string" && sha256(Buffer.from(volume.id)) === lane.volumeIdSha256,
      );
      if (matches.length !== 1 || matches[0]?.size !== 50 || matches[0]?.dataCenterId !== "EU-RO-1")
        fail("RUNPOD_MUTATION_ADMISSION_VOLUME_DRIFT");
      return Object.freeze({ ...lane, sizeGb: 50, region: "EU-RO-1" });
    });
    if (volumes.length !== exactVolumes.length) fail("RUNPOD_MUTATION_ADMISSION_VOLUME_DRIFT");
    const observed = now();
    const observedMs = observed instanceof Date ? observed.getTime() : Number.NaN;
    if (!Number.isFinite(observedMs) || Math.abs(observedMs - trustedMs) > 60_000)
      fail("RUNPOD_MUTATION_ADMISSION_TIME");
    const unsigned = {
      schemaVersion: RUNPOD_PER_MUTATION_ADMISSION_SCHEMA,
      operationId,
      outerStateSha256BeforeAuthorization: outerStateSha256,
      checkedAt: new Date(observedMs).toISOString(),
      authenticatedAccountSha256: RUNPOD_ACCOUNT_ID_SHA256,
      exactGpu: "NVIDIA GeForce RTX 4090",
      region: "EU-RO-1",
      availability: authenticatedOffering.availability,
      serverlessFlexRateUsdPerSecond: authenticatedOffering.rateUsdPerSecond,
      serverlessFlexRateUsdPerGpuHour: authenticatedOffering.rateUsdPerGpuHour,
      serverlessFlexRateSource: RUNPOD_SERVERLESS_FLEX_RATE_SOURCE,
      serverlessFlexRateSourceCheckedAt: officialPricing.sourceCheckedAt,
      serverlessFlexRateSourceSha256: officialPricing.sourceSha256,
      serverlessFlexRateAuthenticatedCatalogSha256: canonicalSha256(serverlessCatalog),
      noFallback: true,
      activeWorkers: 0,
      runningPods: 0,
      endpointBindings,
      retainedVolumes: exactVolumes,
      serverlessCatalogSha256: canonicalSha256(serverlessCatalog),
    };
    return Object.freeze({ ...unsigned, proofSha256: canonicalSha256(unsigned) });
  };
}

function protectedDirectory(path, code) {
  const status = lstatSync(path);
  if (!status.isDirectory() || status.isSymbolicLink() || (status.mode & 0o077) !== 0) fail(code);
  return path;
}

function protectedCanonicalDirectory(path, code) {
  protectedDirectory(path, code);
  if (realpathSync(path) !== resolve(path)) fail(code);
  return path;
}

function protectedCollisionPath(path, code) {
  if (typeof path !== "string" || path === "" || !path.startsWith("/") || path.includes("\0"))
    fail(code);
  // This helper computes a collision identity only. Reserved inputs include immutable tracked
  // proposal and approval files whose repository parents correctly use ordinary non-secret
  // permissions. Requiring all such parents to be mode-0700 rejects them before bootstrap. Keep
  // the no-alias boundary, while leaving mode/link enforcement to each file's actual consumer.
  let canonicalParent;
  try {
    canonicalParent = realpathSync(dirname(path));
  } catch {
    fail(`${code}_DIRECTORY`);
  }
  if (canonicalParent !== resolve(dirname(path))) fail(`${code}_DIRECTORY`);
  if (lstatExists(path)) {
    const metadata = lstatSync(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || realpathSync(path) !== resolve(path))
      fail(code);
  }
  return resolve(path);
}

function readExactProtectedBytes(path, code) {
  if (typeof path !== "string" || path === "" || !path.startsWith("/") || path.includes("\0"))
    fail(code);
  protectedCanonicalDirectory(dirname(path), `${code}_DIRECTORY`);
  let fd;
  try {
    fd = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const before = fstatSync(fd);
    if (!before.isFile() || (before.mode & 0o777) !== 0o600 || before.nlink !== 1) fail(code);
    const bytes = readFileSync(fd);
    const after = fstatSync(fd);
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      after.nlink !== 1
    )
      fail(`${code}_RACE`);
    return bytes;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("V2_13_FULL_LIVE_ADAPTER_")) throw error;
    fail(code);
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function exactDatabaseIdentityFromSeed(seed, code) {
  const database = seed?.activation_record_base?.database;
  const identity = {
    database: database?.database,
    host: database?.host,
    owner_role: database?.owner_role,
  };
  if (
    canonicalJson(identity) !== canonicalJson(EXACT_DATABASE_IDENTITY) ||
    sha256(Buffer.from(canonicalJson(identity))) !== EXACT_DATABASE_IDENTITY_SHA256
  )
    fail(code);
  return Object.freeze(identity);
}

function readStateBoundMaterializationSeed(environment, state, code) {
  let seed;
  let bytes;
  try {
    bytes = readExactProtectedBytes(environment.VIDEOFORGE_V2_13_MATERIALIZATION_SEED_FILE, code);
    seed = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("V2_13_FULL_LIVE_ADAPTER_")) throw error;
    fail(code);
  }
  const canonical = Buffer.from(`${canonicalJson(seed)}\n`);
  if (
    Buffer.compare(bytes, canonical) !== 0 ||
    !validateMaterializationSeedShape(seed) ||
    !UUID.test(state?.full_live_authority_id ?? "") ||
    seed.production_input_base.fullLiveAuthorityId !== state.full_live_authority_id ||
    !HASH.test(state?.materialization_seed_sha256 ?? "") ||
    sha256(canonical) !== state.materialization_seed_sha256
  )
    fail(`${code}_BINDING`);
  exactDatabaseIdentityFromSeed(seed, `${code}_DATABASE_IDENTITY`);
  return Object.freeze({ seed, databaseIdentitySha256: EXACT_DATABASE_IDENTITY_SHA256 });
}

function productionSecretKeyId(authorityId, purpose) {
  return `v213-${purpose}-${sha256(Buffer.from(`${authorityId}\0${purpose}`)).slice(7, 31)}`;
}

const PRODUCTION_INTERNAL_SECRET_KEYS = Object.freeze([
  "acceptanceEvidenceSigningKeyBase64",
  "betterAuthSecret",
  "mediaWorkerTokenSecret",
  "pairDispatchTokenKeyBase64",
  "pairEnvelopeSigningKeyHex",
  "pairProviderProofKeyHex",
  "provenanceReceiptHmacKeyBase64",
  "stageAuthoritySigningKeyBase64",
  "workerOperatorBearer",
  "workflowCallbackSecret",
]);

function exactProductionSecretBundle(
  bundle,
  {
    state,
    outerStateSha256,
    credentialBootstrapReceiptSha256 = CREDENTIAL_BOOTSTRAP_RECEIPT_SHA256,
  },
) {
  const expectedIds = Object.freeze({
    pairDispatchTokenKeyId: productionSecretKeyId(state.full_live_authority_id, "dispatch"),
    pairEnvelopeSigningKeyId: productionSecretKeyId(state.full_live_authority_id, "envelope"),
    pairProviderProofKeyId: productionSecretKeyId(state.full_live_authority_id, "provider-proof"),
    provenanceReceiptKeyId: productionSecretKeyId(state.full_live_authority_id, "provenance"),
  });
  if (
    bundle?.schemaVersion !== PRODUCTION_SECRET_BOOTSTRAP_SCHEMA ||
    bundle.fullLiveAuthorityId !== state.full_live_authority_id ||
    bundle.outerStateSha256 !== outerStateSha256 ||
    bundle.credentialBootstrapReceiptSha256 !== credentialBootstrapReceiptSha256 ||
    canonicalJson(bundle.keyIds) !== canonicalJson(expectedIds) ||
    JSON.stringify(Object.keys(bundle.secrets ?? {}).sort()) !==
      JSON.stringify(PRODUCTION_INTERNAL_SECRET_KEYS.slice().sort())
  )
    fail("PRODUCTION_SECRET_BOOTSTRAP_BUNDLE_CONTRACT");
  const rawSecrets = PRODUCTION_INTERNAL_SECRET_KEYS.map((name) => {
    const value = bundle.secrets[name];
    if (typeof value !== "string") fail("PRODUCTION_SECRET_BOOTSTRAP_BUNDLE_SECRET");
    if (name.endsWith("Hex")) {
      if (!/^[0-9a-f]{64}$/u.test(value)) fail("PRODUCTION_SECRET_BOOTSTRAP_BUNDLE_SECRET");
      return Buffer.from(value, "hex");
    }
    let bytes;
    try {
      bytes = Buffer.from(value, "base64");
    } catch {
      fail("PRODUCTION_SECRET_BOOTSTRAP_BUNDLE_SECRET");
    }
    if (bytes.length !== 32 || bytes.toString("base64") !== value)
      fail("PRODUCTION_SECRET_BOOTSTRAP_BUNDLE_SECRET");
    return bytes;
  });
  if (new Set(rawSecrets.map((bytes) => sha256(bytes))).size !== rawSecrets.length)
    fail("PRODUCTION_SECRET_BOOTSTRAP_BUNDLE_SECRET_REUSE");
  return Object.freeze({ bundle, expectedIds });
}

function expectedProductionSecretWrites({
  paths,
  bundle,
  expectedIds,
  seed,
  external,
  databaseCredentials,
}) {
  const productionSecrets = {
    schemaVersion: "videoforge.v213-full-live-pre-endpoint-secrets/v1",
    stageAuthoritySigningKeyBase64: bundle.secrets.stageAuthoritySigningKeyBase64,
    provenanceReceiptHmacKeyBase64: bundle.secrets.provenanceReceiptHmacKeyBase64,
    provenanceReceiptKeyId: expectedIds.provenanceReceiptKeyId,
    acceptanceEvidenceSigningKeyBase64: bundle.secrets.acceptanceEvidenceSigningKeyBase64,
    pairDispatchTokenKeyBase64: bundle.secrets.pairDispatchTokenKeyBase64,
    pairDispatchTokenKeyId: expectedIds.pairDispatchTokenKeyId,
    pairEnvelopeSigningKeyHex: bundle.secrets.pairEnvelopeSigningKeyHex,
    pairEnvelopeSigningKeyId: expectedIds.pairEnvelopeSigningKeyId,
    pairProviderProofKeyHex: bundle.secrets.pairProviderProofKeyHex,
    pairProviderProofKeyId: expectedIds.pairProviderProofKeyId,
  };
  const secretValues = {
    DATABASE_URL: databaseCredentials.runtimeDatabaseUrl,
    BETTER_AUTH_SECRET: bundle.secrets.betterAuthSecret,
    GOOGLE_CLIENT_ID: external.values.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: external.values.GOOGLE_CLIENT_SECRET,
    R2_ACCESS_KEY_ID: external.values.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: external.values.R2_SECRET_ACCESS_KEY,
    WORKFLOW_CALLBACK_SECRET: bundle.secrets.workflowCallbackSecret,
    MEDIA_WORKER_TOKEN_SECRET: bundle.secrets.mediaWorkerTokenSecret,
    VIDEOFORGE_RECONCILER_DATABASE_URL: databaseCredentials.reconcilerDatabaseUrl,
    VIDEOFORGE_DISPATCH_TOKEN_KEY: bundle.secrets.pairDispatchTokenKeyBase64,
    VIDEOFORGE_DISPATCH_TOKEN_KEY_ID: expectedIds.pairDispatchTokenKeyId,
    VIDEOFORGE_ENVELOPE_SIGNING_KEY_HEX: bundle.secrets.pairEnvelopeSigningKeyHex,
    VIDEOFORGE_ENVELOPE_SIGNING_KEY_ID: expectedIds.pairEnvelopeSigningKeyId,
    VIDEOFORGE_PROVIDER_PROOF_VERIFY_KEY: bundle.secrets.pairProviderProofKeyHex,
    VIDEOFORGE_PROVIDER_PROOF_KEY_ID: expectedIds.pairProviderProofKeyId,
    RUNPOD_API_KEY: external.values.RUNPOD_API_KEY,
    RUNPOD_API_BASE_URL: "https://api.runpod.ai/v2",
    VIDEOFORGE_V213_WORKFLOW_OPERATOR_TOKEN: bundle.secrets.workerOperatorBearer,
  };
  return Object.freeze([
    [paths.productionSecretsPath, Buffer.from(`${canonicalJson(productionSecrets)}\n`)],
    [paths.workerOriginPath, Buffer.from(seed.activation_record_base.cloudflare.public_origin)],
    [paths.workerBearerPath, Buffer.from(bundle.secrets.workerOperatorBearer)],
    ...Object.entries(secretValues).map(([name, value]) => [
      paths.outputs[name],
      Buffer.from(value),
    ]),
  ]);
}

function productionSecretBootstrapPaths(environment, authorityId) {
  const secretDirectory = protectedCanonicalDirectory(
    environment.VIDEOFORGE_V2_13_SECRET_INPUT_DIR,
    "PRODUCTION_SECRET_BOOTSTRAP_DIRECTORY",
  );
  const productionSecretsPath = requiredProtectedOutputPath(
    environment.VIDEOFORGE_V2_13_PRODUCTION_SECRETS_FILE,
    "PRODUCTION_SECRET_BOOTSTRAP_PRODUCTION_SECRETS",
  );
  const bundlePath = requiredProtectedOutputPath(
    environment.VIDEOFORGE_V2_13_PRODUCTION_SECRET_BOOTSTRAP_FILE ??
      join(dirname(productionSecretsPath), "production-secret-bootstrap.json"),
    "PRODUCTION_SECRET_BOOTSTRAP_BUNDLE",
  );
  const workerOriginPath = requiredProtectedOutputPath(
    environment.VIDEOFORGE_V2_13_WORKER_ORIGIN_FILE,
    "PRODUCTION_SECRET_BOOTSTRAP_WORKER_ORIGIN",
  );
  const workerBearerPath = requiredProtectedOutputPath(
    environment.VIDEOFORGE_V2_13_WORKER_OPERATOR_BEARER_FILE,
    "PRODUCTION_SECRET_BOOTSTRAP_WORKER_BEARER",
  );
  const outputs = Object.fromEntries(
    GUARDED_SECRET_NAMES.filter(
      (name) =>
        ![
          "VIDEOFORGE_MAGE_ENDPOINT_ID",
          "VIDEOFORGE_MAGE_ENDPOINT_ID_SHA256",
          "VIDEOFORGE_SOULX_ENDPOINT_ID",
          "VIDEOFORGE_SOULX_ENDPOINT_ID_SHA256",
        ].includes(name),
    ).map((name) => [
      name,
      requiredProtectedOutputPath(
        join(secretDirectory, name),
        "PRODUCTION_SECRET_BOOTSTRAP_OUTPUT",
      ),
    ]),
  );
  const sourcePaths = {
    credentialReceipt: environment.VIDEOFORGE_V2_13_CREDENTIAL_BOOTSTRAP_RECEIPT_FILE,
    GOOGLE_CLIENT_ID: environment.VIDEOFORGE_V2_13_GOOGLE_CLIENT_ID_FILE,
    GOOGLE_CLIENT_SECRET: environment.VIDEOFORGE_V2_13_GOOGLE_CLIENT_SECRET_FILE,
    R2_ACCESS_KEY_ID: environment.VIDEOFORGE_V2_13_R2_ACCESS_KEY_ID_FILE,
    R2_SECRET_ACCESS_KEY: environment.VIDEOFORGE_V2_13_R2_SECRET_ACCESS_KEY_FILE,
    RUNPOD_API_KEY: environment.VIDEOFORGE_V2_13_RUNPOD_API_KEY_FILE,
  };
  for (const path of Object.values(sourcePaths))
    if (typeof path !== "string" || path === "" || !path.startsWith("/") || path.includes("\0"))
      fail("PRODUCTION_SECRET_BOOTSTRAP_SOURCE_PATH");
  const allOutputs = [
    bundlePath,
    productionSecretsPath,
    workerOriginPath,
    workerBearerPath,
    ...Object.values(outputs),
  ];
  if (new Set(allOutputs.map((path) => resolve(path))).size !== allOutputs.length)
    fail("PRODUCTION_SECRET_BOOTSTRAP_OUTPUT_COLLISION");
  if (
    Object.values(sourcePaths).some((path) =>
      allOutputs.map((outputPath) => resolve(outputPath)).includes(resolve(path)),
    )
  )
    fail("PRODUCTION_SECRET_BOOTSTRAP_SOURCE_COLLISION");
  return Object.freeze({
    authorityId,
    bundlePath,
    productionSecretsPath,
    workerOriginPath,
    workerBearerPath,
    outputs: Object.freeze(outputs),
    sourcePaths: Object.freeze(sourcePaths),
  });
}

function exactCredentialBootstrapInputs(paths, binding = EXACT_CREDENTIAL_BOOTSTRAP_BINDING) {
  const receiptBytes = readExactProtectedBytes(
    paths.sourcePaths.credentialReceipt,
    "PRODUCTION_SECRET_BOOTSTRAP_CREDENTIAL_RECEIPT",
  );
  if (sha256(receiptBytes) !== binding.receiptSha256)
    fail("PRODUCTION_SECRET_BOOTSTRAP_CREDENTIAL_RECEIPT_HASH");
  let receipt;
  try {
    receipt = JSON.parse(receiptBytes.toString("utf8"));
  } catch {
    fail("PRODUCTION_SECRET_BOOTSTRAP_CREDENTIAL_RECEIPT_JSON");
  }
  if (
    receipt?.schema_version !== binding.receiptSchema ||
    receipt.runpod_calls !== 0 ||
    receipt.gpu_hours !== 0 ||
    receipt.external_spend_usd !== 0
  )
    fail("PRODUCTION_SECRET_BOOTSTRAP_CREDENTIAL_RECEIPT_CONTRACT");
  const values = {};
  const receiptFields = {
    GOOGLE_CLIENT_ID: "google_oauth_client_id_sha256",
    GOOGLE_CLIENT_SECRET: "google_oauth_client_secret_sha256",
    R2_ACCESS_KEY_ID: "r2_access_key_id_sha256",
    R2_SECRET_ACCESS_KEY: "r2_secret_access_key_sha256",
  };
  for (const [name, field] of Object.entries(receiptFields)) {
    const bytes = readExactProtectedBytes(
      paths.sourcePaths[name],
      `PRODUCTION_SECRET_BOOTSTRAP_${name}`,
    );
    if (
      bytes.length === 0 ||
      bytes.includes(0) ||
      sha256(bytes) !== binding.secretHashes[name] ||
      receipt[field] !== binding.secretHashes[name]
    )
      fail(`PRODUCTION_SECRET_BOOTSTRAP_${name}_BINDING`);
    values[name] = bytes.toString("utf8");
  }
  const runpod = readExactProtectedBytes(
    paths.sourcePaths.RUNPOD_API_KEY,
    "PRODUCTION_SECRET_BOOTSTRAP_RUNPOD_API_KEY",
  );
  if (
    runpod.length < 20 ||
    runpod.includes(0) ||
    runpod.toString("utf8").trim() !== runpod.toString("utf8")
  )
    fail("PRODUCTION_SECRET_BOOTSTRAP_RUNPOD_API_KEY_BINDING");
  values.RUNPOD_API_KEY = runpod.toString("utf8");
  return Object.freeze({ receiptBytes, values: Object.freeze(values) });
}

function materializeProductionSecretBootstrap({
  environment,
  state,
  outerStateSha256,
  databaseCredentials,
  secretRandomBytes = randomBytes,
  credentialBootstrapBinding = EXACT_CREDENTIAL_BOOTSTRAP_BINDING,
  createMissing,
}) {
  const { seed } = readStateBoundMaterializationSeed(
    environment,
    state,
    "PRODUCTION_SECRET_BOOTSTRAP_SEED",
  );
  const paths = productionSecretBootstrapPaths(environment, state.authority_id);
  const expectedIds = Object.freeze({
    pairDispatchTokenKeyId: productionSecretKeyId(state.full_live_authority_id, "dispatch"),
    pairEnvelopeSigningKeyId: productionSecretKeyId(state.full_live_authority_id, "envelope"),
    pairProviderProofKeyId: productionSecretKeyId(state.full_live_authority_id, "provider-proof"),
    provenanceReceiptKeyId: productionSecretKeyId(state.full_live_authority_id, "provenance"),
  });
  if (
    seed.production_input_base.dualLaneInput.envelopeSigningKeyId !==
    expectedIds.pairEnvelopeSigningKeyId
  )
    fail("PRODUCTION_SECRET_BOOTSTRAP_ENVELOPE_KEY_ID_BINDING");
  const external = exactCredentialBootstrapInputs(paths, credentialBootstrapBinding);
  let bundle;
  if (lstatExists(paths.bundlePath)) {
    const bytes = readExactProtectedBytes(paths.bundlePath, "PRODUCTION_SECRET_BOOTSTRAP_BUNDLE");
    try {
      bundle = JSON.parse(bytes.toString("utf8"));
    } catch {
      fail("PRODUCTION_SECRET_BOOTSTRAP_BUNDLE_JSON");
    }
    if (Buffer.compare(bytes, Buffer.from(`${canonicalJson(bundle)}\n`)) !== 0)
      fail("PRODUCTION_SECRET_BOOTSTRAP_BUNDLE_CANONICAL");
  } else {
    if (!createMissing) fail("PRODUCTION_SECRET_BOOTSTRAP_BUNDLE_MISSING");
    const next = () => {
      const bytes = secretRandomBytes(32);
      if (!Buffer.isBuffer(bytes) || bytes.length !== 32)
        fail("PRODUCTION_SECRET_BOOTSTRAP_RANDOM");
      return bytes;
    };
    const raw = Array.from({ length: 10 }, next);
    if (new Set(raw.map((bytes) => sha256(bytes))).size !== raw.length)
      fail("PRODUCTION_SECRET_BOOTSTRAP_RANDOM_REUSE");
    bundle = {
      schemaVersion: PRODUCTION_SECRET_BOOTSTRAP_SCHEMA,
      fullLiveAuthorityId: state.full_live_authority_id,
      outerStateSha256,
      credentialBootstrapReceiptSha256: credentialBootstrapBinding.receiptSha256,
      keyIds: expectedIds,
      secrets: {
        acceptanceEvidenceSigningKeyBase64: raw[0].toString("base64"),
        betterAuthSecret: raw[1].toString("base64"),
        mediaWorkerTokenSecret: raw[2].toString("base64"),
        pairDispatchTokenKeyBase64: raw[3].toString("base64"),
        pairEnvelopeSigningKeyHex: raw[4].toString("hex"),
        pairProviderProofKeyHex: raw[5].toString("hex"),
        provenanceReceiptHmacKeyBase64: raw[6].toString("base64"),
        stageAuthoritySigningKeyBase64: raw[7].toString("base64"),
        workerOperatorBearer: raw[8].toString("base64"),
        workflowCallbackSecret: raw[9].toString("base64"),
      },
    };
    exclusiveAtomicBytes(paths.bundlePath, Buffer.from(`${canonicalJson(bundle)}\n`), {
      temporaryPath: databaseCredentialStagingPath(paths.bundlePath, state.authority_id),
    });
  }
  exactProductionSecretBundle(bundle, {
    state,
    outerStateSha256,
    credentialBootstrapReceiptSha256: credentialBootstrapBinding.receiptSha256,
  });
  const writes = expectedProductionSecretWrites({
    paths,
    bundle,
    expectedIds,
    seed,
    external,
    databaseCredentials,
  });
  for (const [path, expectedBytes] of writes) {
    if (createMissing) {
      exclusiveAtomicBytes(path, expectedBytes, {
        temporaryPath: databaseCredentialStagingPath(path, state.authority_id),
      });
    } else if (
      Buffer.compare(
        readExactProtectedBytes(path, "PRODUCTION_SECRET_BOOTSTRAP_RECONCILIATION_READBACK"),
        expectedBytes,
      ) !== 0
    ) {
      fail("PRODUCTION_SECRET_BOOTSTRAP_RECONCILIATION_DRIFT");
    }
  }
  loadBridgeProductionSecrets(environment, { requireEndpoints: false });
  if (
    readExactProtectedBytes(paths.workerBearerPath, "PRODUCTION_SECRET_BOOTSTRAP_BEARER").toString(
      "utf8",
    ) !==
      readExactProtectedBytes(
        paths.outputs.VIDEOFORGE_V213_WORKFLOW_OPERATOR_TOKEN,
        "PRODUCTION_SECRET_BOOTSTRAP_BEARER_COPY",
      ).toString("utf8") ||
    readExactProtectedBytes(
      paths.sourcePaths.RUNPOD_API_KEY,
      "PRODUCTION_SECRET_BOOTSTRAP_RUNPOD_SOURCE",
    ).toString("utf8") !==
      readExactProtectedBytes(
        paths.outputs.RUNPOD_API_KEY,
        "PRODUCTION_SECRET_BOOTSTRAP_RUNPOD_COPY",
      ).toString("utf8")
  )
    fail("PRODUCTION_SECRET_BOOTSTRAP_COPY_BINDING");
  const fileSha256s = Object.fromEntries(
    Object.entries(paths.outputs).map(([name, path]) => [
      name,
      sha256(readExactProtectedBytes(path, "PRODUCTION_SECRET_BOOTSTRAP_READBACK")),
    ]),
  );
  const body = {
    schemaVersion: PRODUCTION_SECRET_BOOTSTRAP_SCHEMA,
    fullLiveAuthorityId: state.full_live_authority_id,
    outerStateSha256,
    credentialBootstrapReceiptSha256: credentialBootstrapBinding.receiptSha256,
    productionSecretsSha256: sha256(
      readExactProtectedBytes(
        paths.productionSecretsPath,
        "PRODUCTION_SECRET_BOOTSTRAP_PRODUCTION_SECRETS_READBACK",
      ),
    ),
    productionSecretFileSha256s: fileSha256s,
    internalCredentialKeyIds: expectedIds,
  };
  return Object.freeze({
    ...body,
    productionSecretBootstrapSha256: sha256(Buffer.from(`${canonicalJson(body)}\n`)),
  });
}

function requiredProtectedOutputPath(path, code) {
  if (typeof path !== "string" || path === "" || !path.startsWith("/") || path.includes("\0"))
    fail(code);
  protectedCanonicalDirectory(dirname(path), `${code}_DIRECTORY`);
  return path;
}

function exclusiveAtomicBytes(path, bytes, { temporaryPath } = {}) {
  protectedDirectory(dirname(path), "MATERIALIZATION_OUTPUT_DIRECTORY");
  const temporary = temporaryPath ?? `${path}.${randomBytes(8).toString("hex")}.next`;
  if (lstatExists(temporary)) {
    protectedFile(temporary, "MATERIALIZATION_OUTPUT_STAGING_FILE");
    if (Buffer.compare(readFileSync(temporary), bytes) !== 0)
      fail("MATERIALIZATION_OUTPUT_STAGING_DRIFT", path);
  } else {
    writeFileSync(temporary, bytes, { mode: 0o600, flag: "wx" });
  }
  try {
    linkSync(temporary, path);
  } catch {
    if (!lstatExists(path)) fail("MATERIALIZATION_OUTPUT_CREATE", path);
    protectedFile(path, "MATERIALIZATION_OUTPUT_FILE");
    if (sha256(readFileSync(path)) !== sha256(bytes)) fail("MATERIALIZATION_OUTPUT_HASH_CAS", path);
  } finally {
    rmSync(temporary, { force: true });
  }
  protectedFile(path, "MATERIALIZATION_OUTPUT_FILE");
  if (sha256(readFileSync(path)) !== sha256(bytes)) fail("MATERIALIZATION_OUTPUT_READBACK");
}

function atomicExactTransition(path, currentBytes, nextBytes) {
  protectedDirectory(dirname(path), "MATERIALIZATION_OUTPUT_DIRECTORY");
  protectedFile(path, "MATERIALIZATION_OUTPUT_FILE");
  const observed = readFileSync(path);
  if (sha256(observed) === sha256(nextBytes)) return;
  if (sha256(observed) !== sha256(currentBytes)) fail("MATERIALIZATION_TRANSITION_CAS", path);
  const temporary = `${path}.${randomBytes(8).toString("hex")}.next`;
  writeFileSync(temporary, nextBytes, { mode: 0o600, flag: "wx" });
  renameSync(temporary, path);
  protectedFile(path, "MATERIALIZATION_OUTPUT_FILE");
  if (sha256(readFileSync(path)) !== sha256(nextBytes)) fail("MATERIALIZATION_OUTPUT_READBACK");
}

function atomicChainUpdate(path, entry) {
  protectedDirectory(dirname(path), "MATERIALIZATION_CHAIN_DIRECTORY");
  const lockPath = `${path}.lock`;
  let lock;
  try {
    lock = openSync(lockPath, "wx", 0o600);
  } catch {
    fail("MATERIALIZATION_CHAIN_LOCKED");
  }
  try {
    let chain = {
      schema_version: "videoforge.v213-full-live-materialization-chain/v1",
      entries: [],
    };
    if (lstatExists(path)) {
      protectedFile(path, "MATERIALIZATION_CHAIN_FILE");
      try {
        chain = JSON.parse(readFileSync(path, "utf8"));
      } catch {
        fail("MATERIALIZATION_CHAIN_JSON");
      }
    }
    validateMaterializationChainDocument(chain);
    const priorIndex = chain.entries.findIndex((item) => item?.kind === entry.kind);
    const previous = chain.entries.at(-1)?.entry_sha256 ?? MATERIALIZATION_GENESIS;
    const unsigned = { ...entry, prior_chain_sha256: previous };
    const entrySha256 = sha256(Buffer.from(`${canonicalJson(unsigned)}\n`));
    if (priorIndex >= 0) {
      const stored = chain.entries[priorIndex];
      const storedUnsigned = { ...stored };
      delete storedUnsigned.entry_sha256;
      if (
        priorIndex !== chain.entries.length - 1 ||
        stored.entry_sha256 !== entrySha256 ||
        canonicalJson(storedUnsigned) !== canonicalJson(unsigned)
      )
        fail("MATERIALIZATION_CHAIN_STAGE_REPLAY", entry.kind);
      return stored.entry_sha256;
    }
    const expectedKind =
      entry.kind === "cleanup-pre-endpoint-descriptor"
        ? entry.kind
        : MATERIALIZATION_STAGE_ORDER[chain.entries.length];
    if (entry.kind !== expectedKind) fail("MATERIALIZATION_CHAIN_ORDER", entry.kind);
    chain.entries.push({ ...unsigned, entry_sha256: entrySha256 });
    const bytes = Buffer.from(`${canonicalJson(chain)}\n`);
    const temporary = `${path}.${randomBytes(8).toString("hex")}.next`;
    writeFileSync(temporary, bytes, { mode: 0o600, flag: "wx" });
    renameSync(temporary, path);
    protectedFile(path, "MATERIALIZATION_CHAIN_FILE");
    return entrySha256;
  } finally {
    if (lock !== undefined) closeSync(lock);
    rmSync(lockPath, { force: true });
  }
}

function lstatExists(path) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function exactReceipt(priorResults, operationId) {
  const receipt = priorResults.get(operationId);
  if (!HASH.test(receipt?.evidenceSha256 ?? "")) fail("MATERIALIZATION_PRIOR_RECEIPT", operationId);
  return receipt;
}

const prequalificationLiteral = (value) => `'${String(value).replaceAll("'", "''")}'`;
const prequalificationQueryArgs = (sql) => [
  "--no-psqlrc",
  "--tuples-only",
  "--no-align",
  "--set",
  "ON_ERROR_STOP=1",
  "--command",
  sql,
];

function prequalificationPath(environment) {
  const directory = protectedDirectory(
    environment.VIDEOFORGE_V2_13_POSTGRES_INPUT_DIR,
    "PREQUALIFICATION_POSTGRES_DIRECTORY",
  );
  const configured = environment.VIDEOFORGE_V2_13_PREQUALIFICATION_DATABASE_BOOTSTRAP_RECEIPT_FILE;
  const path = configured ?? join(directory, PREQUALIFICATION_RECEIPT_NAME);
  if (resolve(dirname(path)) !== resolve(directory)) fail("PREQUALIFICATION_RECEIPT_PATH");
  return path;
}

function assertConsumedDatabaseBootstrapInvocation(context, state, outerStateSha256) {
  const releaseMode = state?.release_ref?.mode ?? "LEGACY_SINGLE_CREATION";
  const expectedSchema =
    releaseMode === "PREDECESSOR_BOUND_RECONCILIATION_ONLY"
      ? OUTER_CONSUMPTION_SCHEMA_V3
      : releaseMode === "LEGACY_SINGLE_CREATION"
        ? OUTER_CONSUMPTION_SCHEMA_V2
        : null;
  if (
    context?.operationId !== "bootstrap-prequalification-database" ||
    state?.schema_version !== expectedSchema ||
    state.state !== "CONSUMED_SINGLE_EXECUTION_IN_PROGRESS" ||
    typeof state.authority_id !== "string" ||
    state.authority_id === "" ||
    !UUID.test(state.full_live_authority_id ?? "") ||
    !HASH.test(outerStateSha256 ?? "")
  )
    fail("PREQUALIFICATION_CONSUMED_AUTHORITY_REQUIRED");
}

function databaseCredentialBundlePath(directory) {
  return join(directory, DATABASE_ROLE_CREDENTIAL_BUNDLE_NAME);
}

function databaseCredentialStagingPath(path, authorityId) {
  if (typeof authorityId !== "string" || authorityId === "" || authorityId.includes("\0"))
    fail("PREQUALIFICATION_DATABASE_CREDENTIAL_STAGING_AUTHORITY");
  const binding = sha256(Buffer.from(`${authorityId}\0${resolve(path)}`)).slice(
    "sha256:".length,
    31,
  );
  return join(dirname(path), `.${basename(path)}.${binding}.v213-stage`);
}

function databaseCredentialPaths({ directory, environment, receiptPath, authorityId }) {
  protectedCanonicalDirectory(directory, "PREQUALIFICATION_POSTGRES_DIRECTORY_CANONICAL");
  const secretDirectory = protectedCanonicalDirectory(
    environment.VIDEOFORGE_V2_13_SECRET_INPUT_DIR,
    "PREQUALIFICATION_SECRET_INPUT_DIRECTORY",
  );
  const operatorPath = join(directory, "operator.database-url");
  if (
    environment.VIDEOFORGE_V2_13_OPERATOR_DATABASE_URL_FILE !== undefined &&
    resolve(environment.VIDEOFORGE_V2_13_OPERATOR_DATABASE_URL_FILE) !== resolve(operatorPath)
  )
    fail("PREQUALIFICATION_OPERATOR_DATABASE_URL_PATH");
  const paths = Object.freeze({
    operator: Object.freeze([operatorPath]),
    runtime: Object.freeze([
      requiredProtectedOutputPath(
        environment.VIDEOFORGE_V2_13_RUNTIME_DATABASE_URL_FILE,
        "PREQUALIFICATION_RUNTIME_DATABASE_URL_PATH",
      ),
      join(secretDirectory, "DATABASE_URL"),
    ]),
    reconciler: Object.freeze([
      requiredProtectedOutputPath(
        environment.VIDEOFORGE_V2_13_RECONCILER_DATABASE_URL_FILE,
        "PREQUALIFICATION_RECONCILER_DATABASE_URL_PATH",
      ),
      join(secretDirectory, "VIDEOFORGE_RECONCILER_DATABASE_URL"),
    ]),
  });
  const bundlePath = databaseCredentialBundlePath(directory);
  const staging = Object.freeze({
    bundle: databaseCredentialStagingPath(bundlePath, authorityId),
    operator: Object.freeze(
      paths.operator.map((path) => databaseCredentialStagingPath(path, authorityId)),
    ),
    runtime: Object.freeze(
      paths.runtime.map((path) => databaseCredentialStagingPath(path, authorityId)),
    ),
    reconciler: Object.freeze(
      paths.reconciler.map((path) => databaseCredentialStagingPath(path, authorityId)),
    ),
  });
  const generatedPaths = [
    bundlePath,
    staging.bundle,
    ...Object.values(paths).flat(),
    ...[staging.operator, staging.runtime, staging.reconciler].flat(),
  ].map((path) => resolve(path));
  if (new Set(generatedPaths).size !== generatedPaths.length)
    fail("PREQUALIFICATION_DATABASE_CREDENTIAL_PATH_COLLISION");
  const intendedCredentialEnvironmentNames = new Set([
    "VIDEOFORGE_V2_13_OPERATOR_DATABASE_URL_FILE",
    "VIDEOFORGE_V2_13_RUNTIME_DATABASE_URL_FILE",
    "VIDEOFORGE_V2_13_RECONCILER_DATABASE_URL_FILE",
  ]);
  const reservedPaths = [
    join(directory, "owner.pg_service.conf"),
    join(directory, "owner.pgpass"),
    receiptPath,
    ...Object.entries(environment)
      .filter(
        ([name, path]) =>
          /^VIDEOFORGE_V2_13_.+_FILE$/u.test(name) &&
          !intendedCredentialEnvironmentNames.has(name) &&
          typeof path === "string" &&
          path !== "",
      )
      .map(([, path]) => path),
  ].map((path) =>
    protectedCollisionPath(path, "PREQUALIFICATION_DATABASE_CREDENTIAL_RESERVED_PATH"),
  );
  if (generatedPaths.some((path) => reservedPaths.includes(path)))
    fail("PREQUALIFICATION_DATABASE_CREDENTIAL_RESERVED_PATH_COLLISION");
  return Object.freeze({ bundlePath, paths, staging });
}

function databaseCredentialFinalPaths(credentialPaths) {
  return [credentialPaths.bundlePath, ...Object.values(credentialPaths.paths).flat()];
}

function databaseCredentialStagingPaths(credentialPaths) {
  return [
    credentialPaths.staging.bundle,
    ...credentialPaths.staging.operator,
    ...credentialPaths.staging.runtime,
    ...credentialPaths.staging.reconciler,
  ];
}

function protectedStageInventory(finalPaths) {
  const stages = new Set();
  for (const finalPath of new Set(finalPaths.map((path) => resolve(path)))) {
    const prefix = `.${basename(finalPath)}.`;
    for (const name of readdirSync(dirname(finalPath))) {
      if (
        name.startsWith(prefix) &&
        name.endsWith(".v213-stage") &&
        /^[0-9a-f]{24}$/u.test(name.slice(prefix.length, -".v213-stage".length))
      )
        stages.add(resolve(dirname(finalPath), name));
    }
  }
  return [...stages].sort();
}

function databaseCredentialStageInventory(credentialPaths) {
  return protectedStageInventory(databaseCredentialFinalPaths(credentialPaths));
}

function assertOnlyCurrentProtectedStages(finalPaths, authorityId, code) {
  const expected = new Set(
    finalPaths.map((path) => resolve(databaseCredentialStagingPath(path, authorityId))),
  );
  const observed = protectedStageInventory(finalPaths);
  if (observed.some((path) => !expected.has(path))) fail(code);
  return observed;
}

function assertOnlyCurrentDatabaseCredentialStages(credentialPaths, code) {
  const expected = new Set(
    databaseCredentialStagingPaths(credentialPaths).map((path) => resolve(path)),
  );
  const observed = databaseCredentialStageInventory(credentialPaths);
  if (observed.some((path) => !expected.has(path))) fail(code);
  return observed;
}

function validateDatabaseCredentialCrashPair(finalPath, stagePath, code) {
  const finalPresent = lstatExists(finalPath);
  const stagePresent = lstatExists(stagePath);
  if (!finalPresent && !stagePresent) return;
  if (finalPresent) {
    protectedFile(finalPath, code);
    if (realpathSync(finalPath) !== resolve(finalPath)) fail(code);
  }
  if (stagePresent) {
    protectedFile(stagePath, code);
    if (realpathSync(stagePath) !== resolve(stagePath)) fail(code);
  }
  const finalStatus = finalPresent ? lstatSync(finalPath) : null;
  const stageStatus = stagePresent ? lstatSync(stagePath) : null;
  if (finalPresent && stagePresent) {
    if (
      finalStatus.dev !== stageStatus.dev ||
      finalStatus.ino !== stageStatus.ino ||
      finalStatus.nlink !== 2 ||
      stageStatus.nlink !== 2
    )
      fail(code);
  } else if ((finalStatus ?? stageStatus).nlink !== 1) fail(code);
}

function readProtectedCrashPairBytes(finalPath, stagePath, code) {
  validateDatabaseCredentialCrashPair(finalPath, stagePath, code);
  const paths = [finalPath, stagePath].filter((path) => lstatExists(path));
  if (paths.length === 0) return null;
  const expectedLinks = paths.length;
  const opened = [];
  try {
    for (const path of paths) {
      protectedCanonicalDirectory(dirname(path), `${code}_DIRECTORY`);
      const fd = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
      const item = { path, fd, before: null, bytes: null };
      opened.push(item);
      const descriptor = fstatSync(fd);
      const linkedPath = lstatSync(path);
      if (
        !descriptor.isFile() ||
        !linkedPath.isFile() ||
        linkedPath.isSymbolicLink() ||
        (descriptor.mode & 0o777) !== 0o600 ||
        (linkedPath.mode & 0o777) !== 0o600 ||
        descriptor.nlink !== expectedLinks ||
        linkedPath.nlink !== expectedLinks ||
        descriptor.dev !== linkedPath.dev ||
        descriptor.ino !== linkedPath.ino ||
        realpathSync(path) !== resolve(path)
      )
        fail(code);
      item.before = descriptor;
      item.bytes = readFileSync(fd);
    }
    if (
      opened.length === 2 &&
      (opened[0].before.dev !== opened[1].before.dev ||
        opened[0].before.ino !== opened[1].before.ino)
    )
      fail(code);
    for (const item of opened) {
      const descriptor = fstatSync(item.fd);
      const linkedPath = lstatSync(item.path);
      if (
        descriptor.dev !== item.before.dev ||
        descriptor.ino !== item.before.ino ||
        descriptor.size !== item.before.size ||
        descriptor.mtimeMs !== item.before.mtimeMs ||
        descriptor.nlink !== expectedLinks ||
        linkedPath.dev !== item.before.dev ||
        linkedPath.ino !== item.before.ino ||
        linkedPath.size !== item.before.size ||
        linkedPath.mtimeMs !== item.before.mtimeMs ||
        linkedPath.nlink !== expectedLinks
      )
        fail(`${code}_RACE`);
    }
    if (opened.length === 2 && Buffer.compare(opened[0].bytes, opened[1].bytes) !== 0)
      fail(`${code}_DRIFT`);
    return opened[0].bytes;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("V2_13_FULL_LIVE_ADAPTER_")) throw error;
    fail(code);
  } finally {
    for (const item of opened) closeSync(item.fd);
  }
}

function validateExpectedCrashPairBytes(finalPath, stagePath, expectedBytes, code) {
  if (!Buffer.isBuffer(expectedBytes)) fail(code);
  const bytes = readProtectedCrashPairBytes(finalPath, stagePath, code);
  if (bytes !== null && Buffer.compare(bytes, expectedBytes) !== 0) fail(`${code}_DRIFT`);
  return bytes;
}

function databaseCredentialUrl({ service, role, password }) {
  if (typeof role !== "string" || role === "" || !Buffer.isBuffer(password) || password.length < 32)
    fail("PREQUALIFICATION_DATABASE_CREDENTIAL_GENERATION");
  const value = new URL("postgresql://placeholder:placeholder@localhost/database");
  value.username = role;
  value.password = password.toString("base64url");
  value.hostname = service.get("host");
  value.port = service.get("port") ?? "";
  value.pathname = `/${encodeURIComponent(service.get("dbname"))}`;
  value.search = "";
  value.searchParams.set("sslmode", "require");
  value.searchParams.set("channel_binding", "require");
  const raw = value.toString();
  parseExactOperatorDatabaseUrl(
    raw,
    { host: service.get("host"), database: service.get("dbname"), role },
    "PREQUALIFICATION_DATABASE_CREDENTIAL_GENERATION",
  );
  return raw;
}

function validateDatabaseRoleCredentialBundle(bundle, { state, outerStateSha256, service }) {
  if (
    !exactObjectKeys(bundle, [
      "credentials",
      "database",
      "full_live_authority_id",
      "outer_state_sha256",
      "schema_version",
    ]) ||
    bundle.schema_version !== DATABASE_ROLE_CREDENTIAL_BUNDLE_SCHEMA ||
    bundle.full_live_authority_id !== state.full_live_authority_id ||
    bundle.outer_state_sha256 !== outerStateSha256 ||
    !exactObjectKeys(bundle.database, ["database", "host"]) ||
    bundle.database.host !== service.get("host") ||
    bundle.database.database !== service.get("dbname") ||
    !exactObjectKeys(bundle.credentials, ["operator", "reconciler", "runtime"])
  )
    fail("PREQUALIFICATION_DATABASE_CREDENTIAL_BUNDLE");
  const roles = Object.freeze({
    operator: PREQUALIFICATION_OPERATOR_ROLE,
    runtime: PREQUALIFICATION_RUNTIME_ROLE,
    reconciler: PREQUALIFICATION_RECONCILER_ROLE,
  });
  for (const [kind, role] of Object.entries(roles)) {
    const credential = bundle.credentials[kind];
    if (!exactObjectKeys(credential, ["database_url", "role"]) || credential.role !== role)
      fail("PREQUALIFICATION_DATABASE_CREDENTIAL_BUNDLE");
    parseExactOperatorDatabaseUrl(
      credential.database_url,
      { host: service.get("host"), database: service.get("dbname"), role },
      "PREQUALIFICATION_DATABASE_CREDENTIAL_BUNDLE",
    );
  }
  const hashes = Object.values(bundle.credentials).map((credential) =>
    sha256(Buffer.from(credential.database_url)),
  );
  if (new Set(hashes).size !== hashes.length) fail("PREQUALIFICATION_DATABASE_CREDENTIAL_DISTINCT");
  return bundle;
}

function materializeDatabaseRoleCredentials({
  credentialPaths,
  service,
  state,
  outerStateSha256,
  credentialRandomBytes = randomBytes,
  createMissing = true,
}) {
  const { bundlePath, paths, staging } = credentialPaths;
  if (databaseCredentialStageInventory(credentialPaths).length !== 0)
    fail("PREQUALIFICATION_DATABASE_CREDENTIAL_STAGING_PRESENT");
  let bundle;
  let bundleBytes;
  if (lstatExists(bundlePath)) {
    protectedSingleLinkFile(bundlePath, "PREQUALIFICATION_DATABASE_CREDENTIAL_BUNDLE_FILE");
    bundleBytes = readFileSync(bundlePath);
    try {
      bundle = JSON.parse(bundleBytes);
    } catch {
      fail("PREQUALIFICATION_DATABASE_CREDENTIAL_BUNDLE_JSON");
    }
  } else {
    if (!createMissing) fail("PREQUALIFICATION_DATABASE_CREDENTIAL_BUNDLE_MISSING");
    if (
      Object.values(paths)
        .flat()
        .some((path) => lstatExists(path))
    )
      fail("PREQUALIFICATION_UNBOUND_DATABASE_CREDENTIAL");
    const credentials = Object.fromEntries(
      [
        ["operator", PREQUALIFICATION_OPERATOR_ROLE],
        ["runtime", PREQUALIFICATION_RUNTIME_ROLE],
        ["reconciler", PREQUALIFICATION_RECONCILER_ROLE],
      ].map(([kind, role]) => [
        kind,
        {
          role,
          database_url: databaseCredentialUrl({
            service,
            role,
            password: credentialRandomBytes(48),
          }),
        },
      ]),
    );
    bundle = {
      schema_version: DATABASE_ROLE_CREDENTIAL_BUNDLE_SCHEMA,
      full_live_authority_id: state.full_live_authority_id,
      outer_state_sha256: outerStateSha256,
      database: { host: service.get("host"), database: service.get("dbname") },
      credentials,
    };
    bundleBytes = Buffer.from(`${canonicalJson(bundle)}\n`);
    exclusiveAtomicBytes(bundlePath, bundleBytes, { temporaryPath: staging.bundle });
  }
  validateDatabaseRoleCredentialBundle(bundle, { state, outerStateSha256, service });
  if (Buffer.compare(bundleBytes, Buffer.from(`${canonicalJson(bundle)}\n`)) !== 0)
    fail("PREQUALIFICATION_DATABASE_CREDENTIAL_BUNDLE_CANONICAL");

  for (const [kind, targets] of Object.entries(paths)) {
    const bytes = Buffer.from(bundle.credentials[kind].database_url);
    for (const [index, target] of targets.entries()) {
      if (!lstatExists(target)) {
        if (!createMissing) fail("PREQUALIFICATION_DATABASE_CREDENTIAL_FILE_MISSING");
        exclusiveAtomicBytes(target, bytes, { temporaryPath: staging[kind][index] });
      } else {
        protectedSingleLinkFile(target, "PREQUALIFICATION_DATABASE_CREDENTIAL_FILE");
        if (Buffer.compare(readFileSync(target), bytes) !== 0)
          fail("PREQUALIFICATION_DATABASE_CREDENTIAL_FILE_DRIFT");
      }
    }
  }
  if (databaseCredentialStageInventory(credentialPaths).length !== 0)
    fail("PREQUALIFICATION_DATABASE_CREDENTIAL_STAGING_READBACK");
  return Object.freeze({
    operator_database_url_sha256: sha256(Buffer.from(bundle.credentials.operator.database_url)),
    runtime_database_url_sha256: sha256(Buffer.from(bundle.credentials.runtime.database_url)),
    reconciler_database_url_sha256: sha256(Buffer.from(bundle.credentials.reconciler.database_url)),
    database_role_credential_bundle_sha256: sha256(bundleBytes),
    operatorDatabaseUrl: bundle.credentials.operator.database_url,
    runtimeDatabaseUrl: bundle.credentials.runtime.database_url,
    reconcilerDatabaseUrl: bundle.credentials.reconciler.database_url,
  });
}

async function cleanupPartialDatabaseRoleCredentials({
  environment = process.env,
  run = productionCommand,
  state,
  credentialBootstrapBinding = EXACT_CREDENTIAL_BOOTSTRAP_BINDING,
  remove = rmSync,
} = {}) {
  if (typeof remove !== "function") fail("PREQUALIFICATION_PARTIAL_CLEANUP_REMOVE");
  const workId = `${state?.authority_id}:bootstrap-prequalification-database`.toLowerCase();
  if (
    state?.state !== "CONSUMED_SINGLE_EXECUTION_CLEANUP_ONLY" ||
    state.operator_role_verified !== false ||
    state.phases?.bootstrap_prequalification_database?.work?.[workId]?.state !==
      "AUTHORIZED_ONCE_NOT_REDISPATCHABLE"
  )
    fail("PREQUALIFICATION_PARTIAL_CLEANUP_AUTHORITY");
  const directory = protectedDirectory(
    environment.VIDEOFORGE_V2_13_POSTGRES_INPUT_DIR,
    "PREQUALIFICATION_POSTGRES_DIRECTORY",
  );
  const servicePath = join(directory, "owner.pg_service.conf");
  const passPath = join(directory, "owner.pgpass");
  const receiptPath = prequalificationPath(environment);
  const service = await parseService(servicePath, "videoforge_v2_13_owner");
  protectedFile(passPath, "PREQUALIFICATION_OWNER_PASS");
  await validateServiceFile(
    servicePath,
    "videoforge_v2_13_owner",
    service.get("host"),
    service.get("dbname"),
    service.get("user"),
  );
  if (service.get("user") === PREQUALIFICATION_OPERATOR_ROLE)
    fail("PREQUALIFICATION_OWNER_OPERATOR_COLLISION");
  const credentialPaths = databaseCredentialPaths({
    directory,
    environment,
    receiptPath,
    authorityId: state.authority_id,
  });
  const dbEnv = {
    PATH: environment.PATH ?? process.env.PATH ?? "/usr/bin:/bin",
    HOME: environment.HOME ?? process.env.HOME ?? "/tmp",
    PGSERVICEFILE: servicePath,
    PGSERVICE: "videoforge_v2_13_owner",
    PGPASSFILE: passPath,
  };
  const rolesText = prequalificationCommand(
    run,
    "psql",
    prequalificationQueryArgs(
      `BEGIN; SELECT pg_advisory_xact_lock(${PREQUALIFICATION_ADVISORY_LOCK}); SELECT json_build_object('operator',(SELECT count(*) FROM pg_roles WHERE rolname=${prequalificationLiteral(PREQUALIFICATION_OPERATOR_ROLE)}),'runtime',(SELECT count(*) FROM pg_roles WHERE rolname=${prequalificationLiteral(PREQUALIFICATION_RUNTIME_ROLE)}),'reconciler',(SELECT count(*) FROM pg_roles WHERE rolname=${prequalificationLiteral(PREQUALIFICATION_RECONCILER_ROLE)}))::text; COMMIT;`,
    ),
    dbEnv,
    "PREQUALIFICATION_PARTIAL_CLEANUP_ROLE_READBACK",
  );
  let roles;
  try {
    roles = JSON.parse(rolesText);
  } catch {
    fail("PREQUALIFICATION_PARTIAL_CLEANUP_ROLE_READBACK");
  }
  if (
    !exactObjectKeys(roles, ["operator", "reconciler", "runtime"]) ||
    roles.operator !== 0 ||
    roles.runtime !== 0 ||
    roles.reconciler !== 0
  )
    fail("PREQUALIFICATION_PARTIAL_CLEANUP_ROLE_PRESENT");
  if (lstatExists(receiptPath)) fail("PREQUALIFICATION_PARTIAL_CLEANUP_RECEIPT_PRESENT");

  const targets = Object.values(credentialPaths.paths).flat();
  const targetStages = [
    ...credentialPaths.staging.operator,
    ...credentialPaths.staging.runtime,
    ...credentialPaths.staging.reconciler,
  ];
  const observedStages = assertOnlyCurrentDatabaseCredentialStages(
    credentialPaths,
    "PREQUALIFICATION_PARTIAL_CLEANUP_STAGING_AUTHORITY_DRIFT",
  );
  const bundlePresent = lstatExists(credentialPaths.bundlePath);
  const bundleStagePresent = lstatExists(credentialPaths.staging.bundle);
  const credentialArtifactsPresent = [...targets, ...targetStages].some((path) =>
    lstatExists(path),
  );
  if (!bundlePresent && !bundleStagePresent && credentialArtifactsPresent)
    fail("PREQUALIFICATION_PARTIAL_CLEANUP_UNBOUND_CREDENTIAL");

  let credentialBundleSha256 = null;
  let credentialBundle = null;
  let productionSecretArtifactsPresent = false;
  let secretReadbackFinals = [];
  let observedSecretStages = [];
  const deletionPlan = [];
  const scheduled = new Set();
  const schedule = (path) => {
    const canonical = resolve(path);
    if (lstatExists(path) && !scheduled.has(canonical)) {
      scheduled.add(canonical);
      deletionPlan.push(path);
    }
  };
  const scheduleCrashPair = (finalPath, stagePath) => {
    // Preserve the published final whenever a crash interrupts a pair deletion. The authority
    // bundle is deleted only after every derived pair has disappeared.
    schedule(stagePath);
    schedule(finalPath);
  };

  if (bundlePresent || bundleStagePresent) {
    const manifest = prequalificationManifest();
    if (
      prequalificationLockedLedger(
        (sql, code) =>
          prequalificationCommand(run, "psql", prequalificationQueryArgs(sql), dbEnv, code),
        manifest,
      ).length !== 49
    )
      fail("PREQUALIFICATION_PARTIAL_CLEANUP_LEDGER");
    const bundleBytes = readProtectedCrashPairBytes(
      credentialPaths.bundlePath,
      credentialPaths.staging.bundle,
      "PREQUALIFICATION_PARTIAL_CLEANUP_CREDENTIAL_BUNDLE",
    );
    let bundle;
    try {
      bundle = JSON.parse(bundleBytes);
    } catch {
      fail("PREQUALIFICATION_PARTIAL_CLEANUP_CREDENTIAL_BUNDLE");
    }
    credentialBundle = bundle;
    validateDatabaseRoleCredentialBundle(bundle, {
      state,
      outerStateSha256: bundle?.outer_state_sha256,
      service,
    });
    if (
      !HASH.test(bundle.outer_state_sha256 ?? "") ||
      Buffer.compare(bundleBytes, Buffer.from(`${canonicalJson(bundle)}\n`)) !== 0
    )
      fail("PREQUALIFICATION_PARTIAL_CLEANUP_CREDENTIAL_BUNDLE");
    credentialBundleSha256 = sha256(bundleBytes);
    for (const kind of ["operator", "runtime", "reconciler"])
      for (const [index, path] of credentialPaths.paths[kind].entries())
        validateExpectedCrashPairBytes(
          path,
          credentialPaths.staging[kind][index],
          Buffer.from(bundle.credentials[kind].database_url),
          "PREQUALIFICATION_PARTIAL_CLEANUP_CREDENTIAL_FILE",
        );
  }

  if (typeof environment.VIDEOFORGE_V2_13_PRODUCTION_SECRETS_FILE === "string") {
    const secretPaths = productionSecretBootstrapPaths(environment, state.authority_id);
    const secretDerivedFinals = [
      secretPaths.productionSecretsPath,
      secretPaths.workerOriginPath,
      secretPaths.workerBearerPath,
      ...Object.values(secretPaths.outputs),
    ];
    const secretFinals = [secretPaths.bundlePath, ...secretDerivedFinals];
    secretReadbackFinals = secretFinals;
    observedSecretStages = assertOnlyCurrentProtectedStages(
      secretFinals,
      state.authority_id,
      "PREQUALIFICATION_PARTIAL_CLEANUP_SECRET_STAGING_AUTHORITY_DRIFT",
    );
    const databaseSecretFinals = [
      secretPaths.outputs.DATABASE_URL,
      secretPaths.outputs.VIDEOFORGE_RECONCILER_DATABASE_URL,
    ];
    const nonDatabaseSecretFinals = secretDerivedFinals.filter(
      (path) => !databaseSecretFinals.includes(path),
    );
    const nonDatabaseSecretStages = nonDatabaseSecretFinals.map((path) =>
      databaseCredentialStagingPath(path, state.authority_id),
    );
    const secretBundleStage = databaseCredentialStagingPath(
      secretPaths.bundlePath,
      state.authority_id,
    );
    const secretBundlePresent = lstatExists(secretPaths.bundlePath);
    const secretBundleStagePresent = lstatExists(secretBundleStage);
    const nonDatabaseSecretDerivedPresent = [
      ...nonDatabaseSecretFinals,
      ...nonDatabaseSecretStages,
    ].some((path) => lstatExists(path));
    if (!secretBundlePresent && !secretBundleStagePresent && nonDatabaseSecretDerivedPresent)
      fail("PREQUALIFICATION_PARTIAL_CLEANUP_UNBOUND_PRODUCTION_SECRET");
    if (secretBundlePresent || secretBundleStagePresent) {
      productionSecretArtifactsPresent = true;
      if (credentialBundle === null)
        fail("PREQUALIFICATION_PARTIAL_CLEANUP_SECRET_DATABASE_BINDING");
      const bytes = readProtectedCrashPairBytes(
        secretPaths.bundlePath,
        secretBundleStage,
        "PREQUALIFICATION_PARTIAL_CLEANUP_SECRET_BUNDLE",
      );
      let value;
      try {
        value = JSON.parse(bytes.toString("utf8"));
      } catch {
        fail("PREQUALIFICATION_PARTIAL_CLEANUP_SECRET_BUNDLE");
      }
      if (
        Buffer.compare(bytes, Buffer.from(`${canonicalJson(value)}\n`)) !== 0 ||
        !HASH.test(value?.outerStateSha256 ?? "") ||
        value.outerStateSha256 !== credentialBundle.outer_state_sha256 ||
        !exactObjectKeys(value, [
          "credentialBootstrapReceiptSha256",
          "fullLiveAuthorityId",
          "keyIds",
          "outerStateSha256",
          "schemaVersion",
          "secrets",
        ])
      )
        fail("PREQUALIFICATION_PARTIAL_CLEANUP_SECRET_BUNDLE");
      const { seed } = readStateBoundMaterializationSeed(
        environment,
        state,
        "PREQUALIFICATION_PARTIAL_CLEANUP_SECRET_SEED",
      );
      const external = exactCredentialBootstrapInputs(secretPaths, credentialBootstrapBinding);
      const { expectedIds } = exactProductionSecretBundle(value, {
        state,
        outerStateSha256: value.outerStateSha256,
        credentialBootstrapReceiptSha256: credentialBootstrapBinding.receiptSha256,
      });
      if (
        seed.production_input_base.dualLaneInput.envelopeSigningKeyId !==
        expectedIds.pairEnvelopeSigningKeyId
      )
        fail("PREQUALIFICATION_PARTIAL_CLEANUP_SECRET_ENVELOPE_KEY_ID_BINDING");
      const expectedWrites = expectedProductionSecretWrites({
        paths: secretPaths,
        bundle: value,
        expectedIds,
        seed,
        external,
        databaseCredentials: {
          runtimeDatabaseUrl: credentialBundle.credentials.runtime.database_url,
          reconcilerDatabaseUrl: credentialBundle.credentials.reconciler.database_url,
        },
      });
      if (
        expectedWrites.length !== secretDerivedFinals.length ||
        new Set(expectedWrites.map(([path]) => resolve(path))).size !==
          secretDerivedFinals.length ||
        secretDerivedFinals.some(
          (path) =>
            !expectedWrites.some(([expectedPath]) => resolve(expectedPath) === resolve(path)),
        )
      )
        fail("PREQUALIFICATION_PARTIAL_CLEANUP_SECRET_WRITE_SET");
      // Validate every surviving final/staging byte before the first unlink. Missing entries are
      // safe: they are either a never-published stage or an already-deleted prefix from a prior
      // crash. The authority-bound bundle remains until all derived copies are absent.
      for (const [path, expected] of expectedWrites) {
        validateExpectedCrashPairBytes(
          path,
          databaseCredentialStagingPath(path, state.authority_id),
          expected,
          "PREQUALIFICATION_PARTIAL_CLEANUP_SECRET_FILE",
        );
      }
      for (const path of nonDatabaseSecretFinals)
        scheduleCrashPair(path, databaseCredentialStagingPath(path, state.authority_id));
      scheduleCrashPair(secretPaths.bundlePath, secretBundleStage);
    }
  }

  if (credentialBundle !== null) {
    for (const kind of ["operator", "runtime", "reconciler"])
      for (const [index, path] of credentialPaths.paths[kind].entries())
        scheduleCrashPair(path, credentialPaths.staging[kind][index]);
    // The canonical database credential bundle is the final unlink. It is the provenance root for
    // every DB credential and every secret copy that can survive any preceding crash boundary.
    scheduleCrashPair(credentialPaths.bundlePath, credentialPaths.staging.bundle);
  }
  if (
    deletionPlan.length > 56 ||
    (bundlePresent && deletionPlan.at(-1) !== credentialPaths.bundlePath) ||
    (!bundlePresent && bundleStagePresent && deletionPlan.at(-1) !== credentialPaths.staging.bundle)
  )
    fail("PREQUALIFICATION_PARTIAL_CLEANUP_DELETION_PLAN");

  let removedArtifactCount = 0;
  for (const path of deletionPlan) {
    if (!lstatExists(path)) fail("PREQUALIFICATION_PARTIAL_CLEANUP_DELETION_RACE");
    remove(path);
    if (lstatExists(path)) fail("PREQUALIFICATION_PARTIAL_CLEANUP_DELETION_READBACK");
    removedArtifactCount += 1;
  }
  if (
    databaseCredentialFinalPaths(credentialPaths).some((path) => lstatExists(path)) ||
    databaseCredentialStageInventory(credentialPaths).length !== 0 ||
    observedStages.some((path) => lstatExists(path)) ||
    secretReadbackFinals.some((path) => lstatExists(path)) ||
    (secretReadbackFinals.length > 0 &&
      protectedStageInventory(secretReadbackFinals).length !== 0) ||
    observedSecretStages.some((path) => lstatExists(path))
  )
    fail("PREQUALIFICATION_PARTIAL_CLEANUP_READBACK");
  const body = {
    schemaVersion: DATABASE_ROLE_CREDENTIAL_CLEANUP_SCHEMA,
    fullLiveAuthorityId: state.full_live_authority_id,
    cleanupState:
      bundlePresent || bundleStagePresent || productionSecretArtifactsPresent
        ? "REMOVED_AUTHORITY_BOUND_FILES"
        : "ALREADY_ABSENT",
    operatorRoleAbsent: true,
    runtimeAndReconcilerRolesAbsent: true,
    credentialBundleSha256,
    removedArtifactCount,
  };
  return Object.freeze({ ...body, cleanupSha256: canonicalSha256(body) });
}

function exactPartialDatabaseCleanupResult(value, state) {
  if (
    !exactObjectKeys(value, [
      "cleanupSha256",
      "cleanupState",
      "credentialBundleSha256",
      "fullLiveAuthorityId",
      "operatorRoleAbsent",
      "removedArtifactCount",
      "runtimeAndReconcilerRolesAbsent",
      "schemaVersion",
    ]) ||
    value.schemaVersion !== DATABASE_ROLE_CREDENTIAL_CLEANUP_SCHEMA ||
    value.fullLiveAuthorityId !== state?.full_live_authority_id ||
    ![
      "REMOVED_AUTHORITY_BOUND_FILES",
      "REMOVED_INCOMPLETE_AUTHORITY_BOUND_STAGING",
      "ALREADY_ABSENT",
    ].includes(value.cleanupState) ||
    value.operatorRoleAbsent !== true ||
    value.runtimeAndReconcilerRolesAbsent !== true ||
    !Number.isInteger(value.removedArtifactCount) ||
    value.removedArtifactCount < 0 ||
    value.removedArtifactCount > 56 ||
    (value.cleanupState === "REMOVED_AUTHORITY_BOUND_FILES" &&
      (value.removedArtifactCount < 1 ||
        (value.credentialBundleSha256 !== null &&
          !HASH.test(value.credentialBundleSha256 ?? "")))) ||
    (value.cleanupState === "REMOVED_INCOMPLETE_AUTHORITY_BOUND_STAGING" &&
      (value.credentialBundleSha256 !== null || value.removedArtifactCount !== 1)) ||
    (value.cleanupState === "ALREADY_ABSENT" &&
      (value.credentialBundleSha256 !== null || value.removedArtifactCount !== 0))
  )
    fail("PREQUALIFICATION_PARTIAL_CLEANUP_RESULT");
  const { cleanupSha256, ...body } = value;
  if (cleanupSha256 !== canonicalSha256(body)) fail("PREQUALIFICATION_PARTIAL_CLEANUP_RESULT");
  return Object.freeze(value);
}

function prequalificationCommand(run, command, args, environment, code) {
  const result = run(command, args, { environment, env: environment });
  if (
    result === null ||
    typeof result !== "object" ||
    result.status !== 0 ||
    typeof result.stdout !== "string" ||
    typeof result.stderr !== "string"
  )
    fail(code);
  return result.stdout.trim();
}

function prequalificationLedger(text, manifest) {
  const rows =
    text === ""
      ? []
      : text
          .split(/\r?\n/u)
          .filter(Boolean)
          .map((line) => {
            const fields = line.split("\t");
            if (fields.length !== 4) fail("PREQUALIFICATION_LEDGER_ROW");
            return {
              version: Number(fields[0]),
              name: fields[1],
              filename: fields[2],
              sha256: fields[3],
            };
          });
  if (!PREQUALIFICATION_LEDGER_PREFIX_COUNTS.includes(rows.length))
    fail("PREQUALIFICATION_LEDGER_PREFIX");
  rows.forEach((row, index) => {
    const expected = manifest.migrations[index];
    if (
      !expected ||
      row.version !== expected.version ||
      row.name !== expected.name ||
      row.filename !== expected.filename ||
      row.sha256 !== expected.sha256
    )
      fail("PREQUALIFICATION_LEDGER_DRIFT");
  });
  return rows;
}

const PREQUALIFICATION_ADVISORY_LOCK = "1448494662,1";

function prequalificationFunctionSignatureSql(functionAlias = "p") {
  // Do not use pg_get_function_identity_arguments here: its output contains argument names and
  // version-dependent spellings such as "timestamp with time zone".  Resolve the argument OIDs
  // directly and format each type, preserving order.  This is stable in PostgreSQL and PGlite,
  // and is the same canonical spelling used by the policy's 17-function allowlist.
  const argumentsSql = `(SELECT COALESCE(string_agg(CASE format_type(a.type_oid,NULL) WHEN 'timestamp with time zone' THEN 'timestamptz' ELSE format_type(a.type_oid,NULL) END, ',' ORDER BY a.ordinality),'') FROM unnest(${functionAlias}.proargtypes::oid[]) WITH ORDINALITY AS a(type_oid,ordinality))`;
  // The normative policy stores public function signatures without a schema prefix.  The query
  // still filters to nspname='public', and callers that need namespace identity compare OIDs.
  return `(${functionAlias}.proname||'('||${argumentsSql}||')')`;
}

function prequalificationPrefixGuardSql(manifest, count) {
  const expected = JSON.stringify(
    manifest.migrations
      .slice(0, count)
      .map(({ version, name, filename, sha256: migrationSha256 }) => [
        version,
        name,
        filename,
        migrationSha256,
      ]),
  );
  const expectedLiteral = prequalificationLiteral(expected);
  return `DO $$ BEGIN IF (SELECT count(*) FROM public.videoforge_schema_migrations) <> ${count} OR (SELECT COALESCE(jsonb_agg(jsonb_build_array(version,name,filename,sha256) ORDER BY version),'[]'::jsonb) FROM public.videoforge_schema_migrations) IS DISTINCT FROM ${expectedLiteral}::jsonb THEN RAISE EXCEPTION 'prequalification migration ledger prefix drift'; END IF; END $$;`;
}

function prequalificationLockedLedger(query, manifest) {
  const text = query(
    `BEGIN; SELECT pg_advisory_xact_lock(${PREQUALIFICATION_ADVISORY_LOCK}); SELECT version::text,name,filename,sha256 FROM public.videoforge_schema_migrations ORDER BY version; COMMIT;`,
    "PREQUALIFICATION_LEDGER_LOCKED_READ",
  );
  return prequalificationLedger(text, manifest);
}

function prequalificationManifest() {
  const directory = resolve(ROOT, "packages/control-plane/migrations");
  const manifestBytes = readFileSync(resolve(directory, "manifest.json"));
  if (sha256(manifestBytes) !== PREQUALIFICATION_MIGRATION_MANIFEST_SHA256)
    fail("PREQUALIFICATION_MANIFEST_SOURCE_DRIFT");
  const manifest = JSON.parse(manifestBytes);
  if (
    manifest?.schema_version !== "videoforge-migration-manifest/v1" ||
    !Array.isArray(manifest.migrations) ||
    manifest.migrations.length !== 49
  )
    fail("PREQUALIFICATION_MANIFEST");
  for (const [index, migration] of manifest.migrations.entries()) {
    if (migration.version !== index + 1) fail("PREQUALIFICATION_MANIFEST_ORDER");
    const sql = readFileSync(resolve(directory, migration.filename), "utf8");
    if (sha256(sql) !== migration.sha256)
      fail("PREQUALIFICATION_MIGRATION_HASH", migration.filename);
    migration.sql = sql;
  }
  return manifest;
}

function prequalificationRoleReadbackSql(role) {
  const name = prequalificationLiteral(role);
  const signature = prequalificationFunctionSignatureSql();
  // has_function_privilege(role_oid, ...) is a valid effective-privilege check.  PUBLIC is not a
  // role name and must instead be read from ACL items using grantee=0.
  const functionAcl = `COALESCE((SELECT json_agg(${signature} ORDER BY ${signature}) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles rr ON rr.rolname=${name} WHERE n.nspname='public' AND has_function_privilege(rr.oid,p.oid,'EXECUTE')),'[]'::json)`;
  const publicAcl = `COALESCE((SELECT json_agg(${signature} ORDER BY ${signature}) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE n.nspname='public' AND a.grantee=0 AND a.privilege_type='EXECUTE'),'[]'::json)`;
  const publicDefaultFunctionAcl = `(SELECT count(*) FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a WHERE d.defaclobjtype='f' AND a.grantee=0 AND a.privilege_type='EXECUTE')`;
  const effectiveDatabaseDangerousAcl = `(SELECT count(*) FROM pg_database d WHERE has_database_privilege(r.oid,d.oid,'CREATE'))`;
  const effectiveSchemaDangerousAcl = `(SELECT count(*) FROM pg_namespace n WHERE has_schema_privilege(r.oid,n.oid,'CREATE'))`;
  const effectiveTableAcl = `(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p','v','m','f') AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema' AND (has_table_privilege(r.oid,c.oid,'SELECT') OR has_table_privilege(r.oid,c.oid,'INSERT') OR has_table_privilege(r.oid,c.oid,'UPDATE') OR has_table_privilege(r.oid,c.oid,'DELETE') OR has_table_privilege(r.oid,c.oid,'TRUNCATE') OR has_table_privilege(r.oid,c.oid,'REFERENCES') OR has_table_privilege(r.oid,c.oid,'TRIGGER')))`;
  const effectiveSequenceAcl = `(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='S' AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema' AND (has_sequence_privilege(r.oid,c.oid,'USAGE') OR has_sequence_privilege(r.oid,c.oid,'SELECT') OR has_sequence_privilege(r.oid,c.oid,'UPDATE')))`;
  return `SELECT json_build_object('flags',json_build_object('rolcanlogin',r.rolcanlogin,'rolsuper',r.rolsuper,'rolcreaterole',r.rolcreaterole,'rolcreatedb',r.rolcreatedb,'rolinherit',r.rolinherit,'rolreplication',r.rolreplication,'rolbypassrls',r.rolbypassrls,'rolconfig',r.rolconfig),'memberships',(SELECT count(*) FROM pg_auth_members m WHERE m.member=r.oid OR m.roleid=r.oid),'ownership',(SELECT count(*) FROM (SELECT 1 FROM pg_database WHERE datdba=r.oid UNION ALL SELECT 1 FROM pg_extension WHERE extowner=r.oid UNION ALL SELECT 1 FROM pg_class WHERE relowner=r.oid UNION ALL SELECT 1 FROM pg_namespace WHERE nspowner=r.oid UNION ALL SELECT 1 FROM pg_proc WHERE proowner=r.oid UNION ALL SELECT 1 FROM pg_type WHERE typowner=r.oid UNION ALL SELECT 1 FROM pg_foreign_data_wrapper WHERE fdwowner=r.oid UNION ALL SELECT 1 FROM pg_foreign_server WHERE srvowner=r.oid UNION ALL SELECT 1 FROM pg_event_trigger WHERE evtowner=r.oid UNION ALL SELECT 1 FROM pg_tablespace WHERE spcowner=r.oid UNION ALL SELECT 1 FROM pg_publication WHERE pubowner=r.oid UNION ALL SELECT 1 FROM pg_subscription WHERE subowner=r.oid UNION ALL SELECT 1 FROM pg_largeobject_metadata WHERE lomowner=r.oid UNION ALL SELECT 1 FROM pg_collation WHERE collowner=r.oid UNION ALL SELECT 1 FROM pg_ts_dict WHERE dictowner=r.oid UNION ALL SELECT 1 FROM pg_ts_config WHERE cfgowner=r.oid) owned),'extension_ownership',(SELECT count(*) FROM pg_extension WHERE extowner=r.oid),'database_acl',(SELECT count(*) FROM pg_database d CROSS JOIN LATERAL aclexplode(COALESCE(d.datacl,acldefault('d',d.datdba))) a WHERE a.grantee=r.oid),'effective_database_dangerous_acl',${effectiveDatabaseDangerousAcl},'schema_acl',COALESCE((SELECT json_agg(n.nspname||':'||a.privilege_type ORDER BY n.nspname||':'||a.privilege_type) FROM pg_namespace n CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl,acldefault('n',n.nspowner))) a WHERE a.grantee=r.oid),'[]'::json),'effective_schema_dangerous_acl',${effectiveSchemaDangerousAcl},'table_acl',(SELECT count(*) FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee=r.oid),'effective_table_acl',${effectiveTableAcl},'sequence_acl',(SELECT count(*) FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('S',c.relowner))) a WHERE a.grantee=r.oid AND c.relkind='S'),'effective_sequence_acl',${effectiveSequenceAcl},'default_acl',(SELECT count(*) FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a WHERE a.grantee=r.oid),'function_acl',${functionAcl},'public_function_acl',${publicAcl},'public_default_function_acl',${publicDefaultFunctionAcl})::text FROM pg_roles r WHERE r.rolname=${name}`;
}

function assertPrequalificationRoleExact(role) {
  const expectedKeys = [
    "flags",
    "memberships",
    "ownership",
    "extension_ownership",
    "database_acl",
    "effective_database_dangerous_acl",
    "schema_acl",
    "effective_schema_dangerous_acl",
    "table_acl",
    "effective_table_acl",
    "sequence_acl",
    "effective_sequence_acl",
    "default_acl",
    "function_acl",
    "public_function_acl",
    "public_default_function_acl",
  ];
  if (
    role === null ||
    typeof role !== "object" ||
    Array.isArray(role) ||
    JSON.stringify(Object.keys(role).sort()) !== JSON.stringify([...expectedKeys].sort())
  )
    fail("PREQUALIFICATION_OPERATOR_ACL");
  const flags = role.flags;
  if (
    flags === null ||
    typeof flags !== "object" ||
    flags.rolcanlogin !== true ||
    flags.rolsuper !== false ||
    flags.rolcreaterole !== false ||
    flags.rolcreatedb !== false ||
    flags.rolinherit !== false ||
    flags.rolreplication !== false ||
    flags.rolbypassrls !== false ||
    flags.rolconfig !== null ||
    role.memberships !== 0 ||
    role.ownership !== 0 ||
    role.extension_ownership !== 0 ||
    role.database_acl !== 0 ||
    role.effective_database_dangerous_acl !== 0 ||
    role.effective_schema_dangerous_acl !== 0 ||
    role.table_acl !== 0 ||
    role.effective_table_acl !== 0 ||
    role.sequence_acl !== 0 ||
    role.effective_sequence_acl !== 0 ||
    role.default_acl !== 0 ||
    role.public_default_function_acl !== 0 ||
    JSON.stringify(role.schema_acl) !== JSON.stringify(["public:USAGE"]) ||
    JSON.stringify(role.function_acl) !==
      JSON.stringify([...PREQUALIFICATION_OPERATOR_FUNCTIONS].sort()) ||
    JSON.stringify(role.public_function_acl) !== "[]"
  )
    fail("PREQUALIFICATION_OPERATOR_ACL");
  return role;
}

function parsePrequalificationRole(text) {
  let role;
  try {
    role = JSON.parse(text);
  } catch {
    fail("PREQUALIFICATION_OPERATOR_READBACK");
  }
  return assertPrequalificationRoleExact(role);
}

function prequalificationReceiptFromFile(
  path,
  credentialBootstrapBinding = EXACT_CREDENTIAL_BOOTSTRAP_BINDING,
) {
  if (!lstatExists(path)) return null;
  protectedFile(path, "PREQUALIFICATION_RECEIPT_FILE");
  let value;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    fail("PREQUALIFICATION_RECEIPT_JSON");
  }
  const keys = [
    ...PREQUALIFICATION_RECEIPT_FIELDS,
    "prequalification_database_bootstrap_sha256",
  ].sort();
  if (JSON.stringify(Object.keys(value ?? {}).sort()) !== JSON.stringify(keys))
    fail("PREQUALIFICATION_RECEIPT_FIELDS");
  const body = { ...value };
  delete body.prequalification_database_bootstrap_sha256;
  if (
    value.schema_version !== PREQUALIFICATION_SCHEMA ||
    !UUID.test(value.full_live_authority_id ?? "") ||
    !HASH.test(value.outer_state_sha256 ?? "") ||
    !HASH.test(value.materialization_seed_sha256 ?? "") ||
    value.database_identity_sha256 !== EXACT_DATABASE_IDENTITY_SHA256 ||
    !PREQUALIFICATION_LEDGER_PREFIX_COUNTS.includes(value.ledger_before_count) ||
    !HASH.test(value.ledger_before_sha256 ?? "") ||
    !HASH.test(value.ledger_after_sha256 ?? "") ||
    !HASH.test(value.operator_acl_sha256 ?? "") ||
    !HASH.test(value.operator_database_url_sha256 ?? "") ||
    !HASH.test(value.runtime_database_url_sha256 ?? "") ||
    !HASH.test(value.reconciler_database_url_sha256 ?? "") ||
    !HASH.test(value.database_role_credential_bundle_sha256 ?? "") ||
    value.credential_bootstrap_receipt_sha256 !== credentialBootstrapBinding.receiptSha256 ||
    !HASH.test(value.production_secret_bootstrap_sha256 ?? "") ||
    !HASH.test(value.production_secrets_sha256 ?? "") ||
    Object.keys(value.production_secret_file_sha256s ?? {})
      .sort()
      .join(",") !==
      GUARDED_SECRET_NAMES.filter(
        (name) =>
          ![
            "VIDEOFORGE_MAGE_ENDPOINT_ID",
            "VIDEOFORGE_MAGE_ENDPOINT_ID_SHA256",
            "VIDEOFORGE_SOULX_ENDPOINT_ID",
            "VIDEOFORGE_SOULX_ENDPOINT_ID_SHA256",
          ].includes(name),
      )
        .sort()
        .join(",") ||
    Object.values(value.production_secret_file_sha256s ?? {}).some((item) => !HASH.test(item)) ||
    Object.keys(value.internal_credential_key_ids ?? {})
      .sort()
      .join(",") !==
      "pairDispatchTokenKeyId,pairEnvelopeSigningKeyId,pairProviderProofKeyId,provenanceReceiptKeyId" ||
    Object.values(value.internal_credential_key_ids ?? {}).some(
      (item) => typeof item !== "string" || item === "",
    ) ||
    new Set([
      value.operator_database_url_sha256,
      value.runtime_database_url_sha256,
      value.reconciler_database_url_sha256,
    ]).size !== 3 ||
    !HASH.test(value.pgcrypto_sha256 ?? "") ||
    !PREQUALIFICATION_RECOVERY_MODES.includes(value.recovery_mode) ||
    (value.recovery_mode === "FRESH_36_TO_49" && value.ledger_before_count !== 36) ||
    (value.recovery_mode === "RESUME_EXACT_PREFIX" &&
      ![37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48].includes(value.ledger_before_count)) ||
    (value.recovery_mode === "VERIFIED_EXISTING_49" && value.ledger_before_count !== 49) ||
    value.runpod_calls !== 0 ||
    value.cloudflare_calls !== 0 ||
    value.application_secret_reads !== 5 ||
    value.prequalification_database_bootstrap_sha256 !==
      sha256(Buffer.from(`${canonicalJson(body)}\n`))
  )
    fail("PREQUALIFICATION_RECEIPT_CONTRACT");
  return value;
}

function prequalificationResult(receipt) {
  return {
    actualUsd: 0,
    ...receipt,
    gpu_use: false,
    external_spend_usd: 0,
  };
}

async function verifyPrequalificationDatabaseReceipt({
  environment = process.env,
  priorResults,
  state,
  run = productionCommand,
  credentialBootstrapBinding = EXACT_CREDENTIAL_BOOTSTRAP_BINDING,
} = {}) {
  // Receipt bytes and the outer prior-result CAS are checked before any database credential,
  // RunPod key, or application secret is opened.
  const receiptPath = prequalificationPath(environment);
  const receipt = prequalificationReceiptFromFile(receiptPath, credentialBootstrapBinding);
  const bootstrap = priorResults?.get?.("bootstrap-prequalification-database");
  if (
    bootstrap?.prequalification_database_bootstrap_sha256 !==
      receipt?.prequalification_database_bootstrap_sha256 ||
    receipt?.full_live_authority_id !== state?.full_live_authority_id
  )
    fail("PREQUALIFICATION_RECEIPT_OUTER_CAS");

  const { seed, databaseIdentitySha256 } = readStateBoundMaterializationSeed(
    environment,
    state,
    "PREQUALIFICATION_VERIFY_MATERIALIZATION_SEED",
  );
  if (receipt.database_identity_sha256 !== databaseIdentitySha256)
    fail("PREQUALIFICATION_VERIFY_DATABASE_IDENTITY_RECEIPT");

  const directory = protectedDirectory(
    environment.VIDEOFORGE_V2_13_POSTGRES_INPUT_DIR,
    "PREQUALIFICATION_VERIFY_POSTGRES_DIRECTORY",
  );
  const servicePath = join(directory, "owner.pg_service.conf");
  const passPath = join(directory, "owner.pgpass");
  const service = await parseService(servicePath, "videoforge_v2_13_owner");
  if (
    service.get("host") !== seed.activation_record_base.database.host ||
    service.get("dbname") !== seed.activation_record_base.database.database ||
    service.get("user") !== seed.activation_record_base.database.owner_role
  )
    fail("PREQUALIFICATION_VERIFY_DATABASE_IDENTITY");
  protectedFile(passPath, "PREQUALIFICATION_VERIFY_OWNER_PASS");
  await validateServiceFile(
    servicePath,
    "videoforge_v2_13_owner",
    service.get("host"),
    service.get("dbname"),
    service.get("user"),
  );
  if (service.get("user") === PREQUALIFICATION_OPERATOR_ROLE)
    fail("PREQUALIFICATION_VERIFY_OWNER_OPERATOR_COLLISION");
  const credentialPaths = databaseCredentialPaths({
    directory,
    environment,
    receiptPath,
    authorityId: state.authority_id,
  });
  const databaseCredentials = materializeDatabaseRoleCredentials({
    credentialPaths,
    service,
    state,
    outerStateSha256: receipt.outer_state_sha256,
    createMissing: false,
  });
  for (const field of [
    "operator_database_url_sha256",
    "runtime_database_url_sha256",
    "reconciler_database_url_sha256",
    "database_role_credential_bundle_sha256",
  ])
    if (databaseCredentials[field] !== receipt[field])
      fail("PREQUALIFICATION_VERIFY_DATABASE_CREDENTIALS");
  const productionSecretBootstrap = materializeProductionSecretBootstrap({
    environment,
    state,
    outerStateSha256: receipt.outer_state_sha256,
    databaseCredentials,
    credentialBootstrapBinding,
    createMissing: false,
  });
  if (
    productionSecretBootstrap.credentialBootstrapReceiptSha256 !==
      receipt.credential_bootstrap_receipt_sha256 ||
    productionSecretBootstrap.productionSecretBootstrapSha256 !==
      receipt.production_secret_bootstrap_sha256 ||
    productionSecretBootstrap.productionSecretsSha256 !== receipt.production_secrets_sha256 ||
    canonicalJson(productionSecretBootstrap.productionSecretFileSha256s) !==
      canonicalJson(receipt.production_secret_file_sha256s) ||
    canonicalJson(productionSecretBootstrap.internalCredentialKeyIds) !==
      canonicalJson(receipt.internal_credential_key_ids)
  )
    fail("PREQUALIFICATION_VERIFY_PRODUCTION_SECRETS");
  const dbEnv = {
    PATH: environment.PATH ?? process.env.PATH ?? "/usr/bin:/bin",
    HOME: environment.HOME ?? process.env.HOME ?? "/tmp",
    PGSERVICEFILE: servicePath,
    PGSERVICE: "videoforge_v2_13_owner",
    PGPASSFILE: passPath,
  };
  const query = (sql, code) =>
    prequalificationCommand(run, "psql", prequalificationQueryArgs(sql), dbEnv, code);
  const manifest = prequalificationManifest();
  const ledger = prequalificationLockedLedger(query, manifest);
  if (
    ledger.length !== 49 ||
    sha256(Buffer.from(`${canonicalJson(ledger)}\n`)) !== receipt.ledger_after_sha256
  )
    fail("PREQUALIFICATION_VERIFY_LEDGER");
  const observedBeforePrefix = ledger.slice(0, receipt.ledger_before_count);
  const manifestBeforePrefix = manifest.migrations
    .slice(0, receipt.ledger_before_count)
    .map(({ version, name, filename, sha256: migrationSha256 }) => ({
      version,
      name,
      filename,
      sha256: migrationSha256,
    }));
  if (
    sha256(Buffer.from(`${canonicalJson(observedBeforePrefix)}\n`)) !==
      receipt.ledger_before_sha256 ||
    sha256(Buffer.from(`${canonicalJson(manifestBeforePrefix)}\n`)) !== receipt.ledger_before_sha256
  )
    fail("PREQUALIFICATION_VERIFY_LEDGER_BEFORE");
  let pgcrypto;
  try {
    pgcrypto = JSON.parse(
      query(
        "SELECT json_build_object('name',extname,'version',extversion,'schema',extnamespace::regnamespace::text)::text FROM pg_extension WHERE extname='pgcrypto'",
        "PREQUALIFICATION_VERIFY_PGCRYPTO",
      ),
    );
  } catch {
    fail("PREQUALIFICATION_VERIFY_PGCRYPTO");
  }
  if (sha256(Buffer.from(`${canonicalJson(pgcrypto)}\n`)) !== receipt.pgcrypto_sha256)
    fail("PREQUALIFICATION_VERIFY_PGCRYPTO");
  const role = parsePrequalificationRole(
    query(
      prequalificationRoleReadbackSql(PREQUALIFICATION_OPERATOR_ROLE),
      "PREQUALIFICATION_VERIFY_OPERATOR_ACL",
    ),
  );
  if (sha256(Buffer.from(`${canonicalJson(role)}\n`)) !== receipt.operator_acl_sha256)
    fail("PREQUALIFICATION_VERIFY_OPERATOR_ACL");
  return Object.freeze({ receipt, ledger, pgcrypto, role });
}

function createPrequalificationDatabaseBootstrapAdapter({
  environment = process.env,
  run = productionCommand,
  credentialRandomBytes = randomBytes,
  credentialBootstrapBinding = EXACT_CREDENTIAL_BOOTSTRAP_BINDING,
} = {}) {
  return async (context, state, _priorResults, outerStateSha256) => {
    assertConsumedDatabaseBootstrapInvocation(context, state, outerStateSha256);
    const reconciliationOnly =
      context?.authorizedUnsettled === true &&
      context?.reconciliationOnly === true &&
      context?.providerDispatchForbidden === true;
    const initialExecution =
      context?.authorizedUnsettled !== true && context?.reconciliationOnly !== true;
    if (!initialExecution && !reconciliationOnly) fail("PREQUALIFICATION_RECONCILIATION_CONTEXT");
    // The canonical, state-bound seed is the first protected input opened. Its immutable database
    // tuple must match the owner service before any psql invocation, randomness, write, migration,
    // or role mutation can occur.
    const { seed, databaseIdentitySha256 } = readStateBoundMaterializationSeed(
      environment,
      state,
      "PREQUALIFICATION_MATERIALIZATION_SEED",
    );
    const directory = protectedDirectory(
      environment.VIDEOFORGE_V2_13_POSTGRES_INPUT_DIR,
      "PREQUALIFICATION_POSTGRES_DIRECTORY",
    );
    const servicePath = join(directory, "owner.pg_service.conf");
    const passPath = join(directory, "owner.pgpass");
    const service = await parseService(servicePath, "videoforge_v2_13_owner");
    if (
      service.get("host") !== seed.activation_record_base.database.host ||
      service.get("dbname") !== seed.activation_record_base.database.database ||
      service.get("user") !== seed.activation_record_base.database.owner_role
    )
      fail("PREQUALIFICATION_DATABASE_IDENTITY");
    protectedFile(passPath, "PREQUALIFICATION_OWNER_PASS");
    await validateServiceFile(
      servicePath,
      "videoforge_v2_13_owner",
      service.get("host"),
      service.get("dbname"),
      service.get("user"),
    );
    if (service.get("user") === PREQUALIFICATION_OPERATOR_ROLE)
      fail("PREQUALIFICATION_OWNER_OPERATOR_COLLISION");
    const receiptPath = prequalificationPath(environment);
    // Resolve every generated and reserved protected path before a migration, credential write,
    // or role mutation. A path collision is an authority-contract failure, never a late I/O error.
    const credentialPaths = databaseCredentialPaths({
      directory,
      environment,
      receiptPath,
      authorityId: state.authority_id,
    });
    const secretBootstrapPaths = productionSecretBootstrapPaths(environment, state.authority_id);
    const secretBootstrapFinals = [
      secretBootstrapPaths.bundlePath,
      secretBootstrapPaths.productionSecretsPath,
      secretBootstrapPaths.workerOriginPath,
      secretBootstrapPaths.workerBearerPath,
      ...Object.values(secretBootstrapPaths.outputs),
    ];
    const secretBootstrapStages = secretBootstrapFinals.map((path) =>
      databaseCredentialStagingPath(path, state.authority_id),
    );
    const observedCredentialStages = assertOnlyCurrentDatabaseCredentialStages(
      credentialPaths,
      "PREQUALIFICATION_DATABASE_CREDENTIAL_STAGING_AUTHORITY_DRIFT",
    );
    const credentialFinals = databaseCredentialFinalPaths(credentialPaths);
    if (
      initialExecution &&
      (observedCredentialStages.length !== 0 ||
        credentialFinals.some((path) => lstatExists(path)) ||
        secretBootstrapFinals.some((path) => lstatExists(path)) ||
        secretBootstrapStages.some((path) => lstatExists(path)))
    )
      fail("PREQUALIFICATION_INITIAL_STATE_NOT_FRESH");
    if (
      reconciliationOnly &&
      (observedCredentialStages.length !== 0 ||
        secretBootstrapStages.some((path) => lstatExists(path)))
    )
      fail("PREQUALIFICATION_RECONCILIATION_STAGING_PRESENT");
    const existing = prequalificationReceiptFromFile(receiptPath, credentialBootstrapBinding);
    const dbEnv = {
      PATH: environment.PATH ?? process.env.PATH ?? "/usr/bin:/bin",
      HOME: environment.HOME ?? process.env.HOME ?? "/tmp",
      PGSERVICEFILE: servicePath,
      PGSERVICE: "videoforge_v2_13_owner",
      PGPASSFILE: passPath,
    };
    const query = (sql, code) =>
      prequalificationCommand(run, "psql", prequalificationQueryArgs(sql), dbEnv, code);
    const manifest = prequalificationManifest();
    // Read the prefix while holding the same transaction-scoped advisory lock used for every
    // migration.  The owner connection is the only connection used until the full operator
    // state has been committed and read back.
    const before = prequalificationLockedLedger(query, manifest);
    const runtimeAbsent =
      query(
        `SELECT count(*)::text FROM pg_roles WHERE rolname IN (${prequalificationLiteral(PREQUALIFICATION_RUNTIME_ROLE)},${prequalificationLiteral(PREQUALIFICATION_RECONCILER_ROLE)})`,
        "PREQUALIFICATION_ROLE_READ",
      ) === "0";
    if (!runtimeAbsent) fail("PREQUALIFICATION_RUNTIME_RECONCILER_PRESENT");
    const operatorCount = Number(
      query(
        `SELECT count(*)::text FROM pg_roles WHERE rolname=${prequalificationLiteral(PREQUALIFICATION_OPERATOR_ROLE)}`,
        "PREQUALIFICATION_OPERATOR_ROLE_READ",
      ),
    );
    if (
      !Number.isInteger(operatorCount) ||
      operatorCount < 0 ||
      operatorCount > 1 ||
      (before.length < 46 && operatorCount !== 0)
    )
      fail("PREQUALIFICATION_OPERATOR_ROLE_DRIFT");
    if (initialExecution && (operatorCount !== 0 || existing !== null))
      fail("PREQUALIFICATION_INITIAL_STATE_NOT_FRESH");
    if (operatorCount === 1) {
      if (!lstatExists(credentialPaths.bundlePath))
        fail("PREQUALIFICATION_OPERATOR_CREDENTIAL_BINDING_MISSING");
      // A pre-existing role is accepted only when the complete, canonical readback is exact.
      // This also prevents a lost receipt from being treated as permission to re-grant.
      const role = parsePrequalificationRole(
        query(
          prequalificationRoleReadbackSql(PREQUALIFICATION_OPERATOR_ROLE),
          "PREQUALIFICATION_OPERATOR_ROLE_DRIFT",
        ),
      );
      if (!role) fail("PREQUALIFICATION_OPERATOR_ROLE_DRIFT");
    }
    if (
      reconciliationOnly &&
      (before.length !== 49 ||
        operatorCount !== 1 ||
        credentialFinals.some((path) => !lstatExists(path)))
    )
      fail("PREQUALIFICATION_RECONCILIATION_READBACK_INCOMPLETE");
    if (existing && operatorCount !== 1) fail("PREQUALIFICATION_RECEIPT_STATE_DRIFT");
    if (existing && before.length !== 49) fail("PREQUALIFICATION_RECEIPT_STATE_DRIFT");
    const recoveryMode =
      before.length === 36
        ? "FRESH_36_TO_49"
        : before.length === 49
          ? "VERIFIED_EXISTING_49"
          : "RESUME_EXACT_PREFIX";
    if (!existing && before.length < 49) {
      prequalificationCommand(
        run,
        "psql",
        [
          "--no-psqlrc",
          "--set",
          "ON_ERROR_STOP=1",
          "--command",
          `BEGIN; SELECT pg_advisory_xact_lock(${PREQUALIFICATION_ADVISORY_LOCK}); CREATE EXTENSION IF NOT EXISTS pgcrypto; COMMIT;`,
        ],
        dbEnv,
        "PREQUALIFICATION_PGCRYPTO",
      );
      for (const migration of manifest.migrations.slice(before.length)) {
        const dir = mkdtempSync(resolve(tmpdir(), "videoforge-v213-prequalification-"));
        const file = join(dir, migration.filename);
        const sql = `BEGIN;\nSELECT pg_advisory_xact_lock(${PREQUALIFICATION_ADVISORY_LOCK});\n${prequalificationPrefixGuardSql(manifest, migration.version - 1)}\nDO $$ BEGIN IF EXISTS (SELECT 1 FROM public.videoforge_schema_migrations WHERE version=${migration.version}) THEN RAISE EXCEPTION 'migration ledger changed during activation'; END IF; END $$;\n${migration.sql}\nINSERT INTO public.videoforge_schema_migrations(version,name,filename,sha256) VALUES (${migration.version},${prequalificationLiteral(migration.name)},${prequalificationLiteral(migration.filename)},${prequalificationLiteral(migration.sha256)});\nCOMMIT;\n`;
        try {
          writeFileSync(file, sql, { mode: 0o600, flag: "wx" });
          prequalificationCommand(
            run,
            "psql",
            ["--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--file", file],
            dbEnv,
            "PREQUALIFICATION_MIGRATION",
          );
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      }
    }
    const databaseCredentials = materializeDatabaseRoleCredentials({
      credentialPaths,
      service,
      state,
      outerStateSha256,
      credentialRandomBytes,
      createMissing: !reconciliationOnly,
    });
    // Complete and read back the entire authority-bound local secret bundle before the atomic
    // operator-role transaction. A crash while publishing these local files therefore leaves no
    // database role and is recoverable by bootstrap-partial cleanup; once the role exists,
    // reconciliation is strictly readback-only over a complete bundle.
    const productionSecretBootstrap = materializeProductionSecretBootstrap({
      environment,
      state,
      outerStateSha256,
      databaseCredentials,
      secretRandomBytes: credentialRandomBytes,
      credentialBootstrapBinding,
      createMissing: !reconciliationOnly,
    });
    if (!existing && operatorCount === 0) {
      // The operator DSN is deliberately not decoded or opened until the migration prefix is
      // complete.  Owner credentials are the only database inputs used for prefix discovery and
      // migrations; the operator password is needed only for the post-migration role creation.
      const operatorRaw = databaseCredentials.operatorDatabaseUrl;
      const operator = parseExactOperatorDatabaseUrl(
        operatorRaw,
        { host: service.get("host"), database: service.get("dbname") },
        "PREQUALIFICATION_OPERATOR_BINDING",
      );
      let operatorPassword;
      try {
        operatorPassword = decodeURIComponent(operator.password);
      } catch {
        fail("PREQUALIFICATION_OPERATOR_BINDING");
      }
      const operatorEnv = { ...dbEnv, V2_13_OPERATOR_PASSWORD: operatorPassword };
      // The grants script creates the absent role and applies/readbacks the exact ACL in one
      // transaction. A lost commit acknowledgement therefore exposes either no role or the fully
      // verified role; it can never strand a half-granted login.
      prequalificationCommand(
        run,
        "psql",
        [
          "--no-psqlrc",
          "--set",
          "ON_ERROR_STOP=1",
          "--variable",
          `operator_role=${PREQUALIFICATION_OPERATOR_ROLE}`,
          "--file",
          resolve(ROOT, PREQUALIFICATION_OPERATOR_GRANTS_PATH),
        ],
        operatorEnv,
        "PREQUALIFICATION_OPERATOR_CREATE_AND_GRANTS",
      );
    }
    const operatorBinding = parseExactOperatorDatabaseUrl(
      databaseCredentials.operatorDatabaseUrl,
      {
        host: service.get("host"),
        database: service.get("dbname"),
        role: PREQUALIFICATION_OPERATOR_ROLE,
      },
      "PREQUALIFICATION_OPERATOR_CREDENTIAL_READBACK",
    );
    let operatorPassword;
    try {
      operatorPassword = decodeURIComponent(operatorBinding.password);
    } catch {
      fail("PREQUALIFICATION_OPERATOR_CREDENTIAL_READBACK");
    }
    const operatorCredentialReadback = prequalificationCommand(
      run,
      "psql",
      prequalificationQueryArgs(
        "SELECT current_user WHERE current_user='videoforge_hosted_operator'",
      ),
      {
        PATH: dbEnv.PATH,
        HOME: dbEnv.HOME,
        PGHOST: service.get("host"),
        PGPORT: service.get("port") ?? "",
        PGDATABASE: service.get("dbname"),
        PGUSER: PREQUALIFICATION_OPERATOR_ROLE,
        PGPASSWORD: operatorPassword,
        PGSSLMODE: "require",
        PGCHANNELBINDING: "require",
      },
      "PREQUALIFICATION_OPERATOR_CREDENTIAL_READBACK",
    );
    if (operatorCredentialReadback !== PREQUALIFICATION_OPERATOR_ROLE)
      fail("PREQUALIFICATION_OPERATOR_CREDENTIAL_READBACK");
    const ledger = prequalificationLockedLedger(query, manifest);
    if (ledger.length !== 49) fail("PREQUALIFICATION_LEDGER_FINAL");
    let pgcrypto;
    try {
      pgcrypto = JSON.parse(
        query(
          "SELECT json_build_object('name',extname,'version',extversion,'schema',extnamespace::regnamespace::text)::text FROM pg_extension WHERE extname='pgcrypto'",
          "PREQUALIFICATION_PGCRYPTO_READBACK",
        ),
      );
    } catch {
      fail("PREQUALIFICATION_PGCRYPTO_READBACK");
    }
    if (
      JSON.stringify(Object.keys(pgcrypto ?? {}).sort()) !==
        JSON.stringify(["name", "schema", "version"]) ||
      pgcrypto.name !== "pgcrypto" ||
      pgcrypto.schema !== "public" ||
      typeof pgcrypto.version !== "string" ||
      pgcrypto.version === ""
    )
      fail("PREQUALIFICATION_PGCRYPTO_READBACK");
    const role = parsePrequalificationRole(
      query(
        prequalificationRoleReadbackSql(PREQUALIFICATION_OPERATOR_ROLE),
        "PREQUALIFICATION_OPERATOR_READBACK",
      ),
    );
    const beforeSha256 = sha256(Buffer.from(`${canonicalJson(before)}\n`));
    const after = {
      ledger_after_sha256: sha256(Buffer.from(`${canonicalJson(ledger)}\n`)),
      operator_acl_sha256: sha256(Buffer.from(`${canonicalJson(role)}\n`)),
      pgcrypto_sha256: sha256(Buffer.from(`${canonicalJson(pgcrypto)}\n`)),
    };
    if (existing) {
      const existingPrefix = ledger.slice(0, existing.ledger_before_count);
      if (
        existing.ledger_before_sha256 !==
          sha256(Buffer.from(`${canonicalJson(existingPrefix)}\n`)) ||
        existing.ledger_after_sha256 !== after.ledger_after_sha256 ||
        existing.operator_acl_sha256 !== after.operator_acl_sha256 ||
        existing.pgcrypto_sha256 !== after.pgcrypto_sha256 ||
        existing.database_identity_sha256 !== databaseIdentitySha256 ||
        existing.operator_database_url_sha256 !==
          databaseCredentials.operator_database_url_sha256 ||
        existing.runtime_database_url_sha256 !== databaseCredentials.runtime_database_url_sha256 ||
        existing.reconciler_database_url_sha256 !==
          databaseCredentials.reconciler_database_url_sha256 ||
        existing.database_role_credential_bundle_sha256 !==
          databaseCredentials.database_role_credential_bundle_sha256 ||
        existing.credential_bootstrap_receipt_sha256 !==
          productionSecretBootstrap.credentialBootstrapReceiptSha256 ||
        existing.production_secret_bootstrap_sha256 !==
          productionSecretBootstrap.productionSecretBootstrapSha256 ||
        existing.production_secrets_sha256 !== productionSecretBootstrap.productionSecretsSha256 ||
        canonicalJson(existing.production_secret_file_sha256s) !==
          canonicalJson(productionSecretBootstrap.productionSecretFileSha256s) ||
        canonicalJson(existing.internal_credential_key_ids) !==
          canonicalJson(productionSecretBootstrap.internalCredentialKeyIds) ||
        existing.full_live_authority_id !== state.full_live_authority_id ||
        existing.outer_state_sha256 !== outerStateSha256
      )
        fail("PREQUALIFICATION_RECEIPT_REPLAY_DRIFT");
    }
    const body = {
      schema_version: PREQUALIFICATION_SCHEMA,
      full_live_authority_id: state.full_live_authority_id,
      outer_state_sha256: outerStateSha256,
      materialization_seed_sha256: state.materialization_seed_sha256,
      database_identity_sha256: databaseIdentitySha256,
      ledger_before_count: before.length,
      ledger_before_sha256: beforeSha256,
      ...after,
      operator_database_url_sha256: databaseCredentials.operator_database_url_sha256,
      runtime_database_url_sha256: databaseCredentials.runtime_database_url_sha256,
      reconciler_database_url_sha256: databaseCredentials.reconciler_database_url_sha256,
      database_role_credential_bundle_sha256:
        databaseCredentials.database_role_credential_bundle_sha256,
      credential_bootstrap_receipt_sha256:
        productionSecretBootstrap.credentialBootstrapReceiptSha256,
      production_secret_bootstrap_sha256: productionSecretBootstrap.productionSecretBootstrapSha256,
      production_secrets_sha256: productionSecretBootstrap.productionSecretsSha256,
      production_secret_file_sha256s: productionSecretBootstrap.productionSecretFileSha256s,
      internal_credential_key_ids: productionSecretBootstrap.internalCredentialKeyIds,
      recovery_mode: recoveryMode,
      runpod_calls: 0,
      cloudflare_calls: 0,
      application_secret_reads: 5,
    };
    const receipt = {
      ...body,
      prequalification_database_bootstrap_sha256: sha256(Buffer.from(`${canonicalJson(body)}\n`)),
    };
    if (!existing) exclusiveAtomicBytes(receiptPath, Buffer.from(`${canonicalJson(receipt)}\n`));
    return prequalificationResult(existing ?? receipt);
  };
}

const createPrequalificationDatabaseAdapter = createPrequalificationDatabaseBootstrapAdapter;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const V213_ACCEPTANCE_CHECKPOINTS = Object.freeze(["V2-10", "V2-11", "V2-12", "V2-13"]);
const V213_ACCEPTANCE_COMMANDS = Object.freeze({
  "V2-10": "v2-10-operator-free-ranga-pilot",
  "V2-11": "v2-11-two-concurrent-owned-projects",
  "V2-12": "v2-12-long-output",
  "V2-13": "v2-13-final-two-lane-smoke",
});
const V213_JIT_CHECKPOINTS = Object.freeze(["V2-09", ...V213_ACCEPTANCE_CHECKPOINTS]);
const V213_JIT_COMMANDS = Object.freeze({
  "V2-09": "v2-09-short-hosted-project",
  ...V213_ACCEPTANCE_COMMANDS,
});
const V213_ACCEPTANCE_PHASE_CAP_MICRO_USD = Object.freeze({
  "V2-10": 2_000_000,
  "V2-11": 4_000_000,
  "V2-12": 2_000_000,
  "V2-13": 2_000_000,
});
const V213_POST_CONSUMPTION_MATERIALIZATION_SCHEMA =
  "videoforge.v213-post-consumption-materialization/v4";
const V213_MATERIALIZATION_IDENTITY_KEYS = Object.freeze([
  "accountId",
  "generationRequestId",
  "projectId",
  "projectRevisionId",
  "workspaceId",
]);
const V213_PROJECT_IDENTITY_KEYS = Object.freeze([
  "accountId",
  "workspaceId",
  "projectId",
  "projectRevisionId",
]);
const V213_COMMAND_PAYLOAD_KEYS = Object.freeze([
  "v2-09-short-hosted-project",
  "v2-10-operator-free-ranga-pilot",
  "v2-11-two-concurrent-owned-projects",
  "v2-12-long-output",
  "v2-13-final-two-lane-smoke",
]);
const exactObjectKeys = (value, keys) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());

const canonicalSha256 = (value) => sha256(Buffer.from(canonicalJson(value)));

function exactMediaWorkerReleaseReadback(value, state, outerStateSha256) {
  const keys = [
    "actualUsd",
    "authorityId",
    "binaryDownloads",
    "credentialsUsed",
    "draft",
    "externalSpendUsd",
    "finalDownloadUrl",
    "gpuUse",
    "immutable",
    "manifest",
    "manifestAsset",
    "manifestSha256",
    "manifestSizeBytes",
    "manifestUrl",
    "outerStateSha256",
    "prerelease",
    "providerMutations",
    "publishedAt",
    "reconciliationSha256",
    "redirectCount",
    "releaseHtmlUrl",
    "repository",
    "schemaVersion",
    "state",
    "tagName",
    "targetCommit",
  ];
  if (!exactObjectKeys(value, keys)) fail("MEDIA_WORKER_RELEASE_READBACK_CONTRACT");
  const { reconciliationSha256, ...unsigned } = value;
  if (
    value.schemaVersion !== MEDIA_WORKER_RELEASE_READBACK_SCHEMA ||
    value.state !== "VERIFIED_EXACT_PUBLIC_GITHUB_RELEASE" ||
    value.authorityId !== state.authority_id ||
    value.outerStateSha256 !== outerStateSha256 ||
    value.repository !== MEDIA_WORKER_RELEASE_REPOSITORY ||
    value.tagName !== MEDIA_WORKER_RELEASE_TAG ||
    value.targetCommit !== MEDIA_WORKER_RELEASE_TARGET_COMMIT ||
    value.releaseHtmlUrl !== MEDIA_WORKER_RELEASE_HTML_URL ||
    value.publishedAt !== MEDIA_WORKER_RELEASE_PUBLISHED_AT ||
    value.draft !== false ||
    value.prerelease !== false ||
    value.immutable !== true ||
    !exactObjectKeys(value.manifestAsset, [
      "browserDownloadUrl",
      "contentType",
      "digest",
      "name",
      "sizeBytes",
      "state",
    ]) ||
    value.manifestAsset.name !== MEDIA_WORKER_RELEASE_MANIFEST_NAME ||
    value.manifestAsset.sizeBytes !== MEDIA_WORKER_RELEASE_MANIFEST_SIZE_BYTES ||
    value.manifestAsset.digest !== MEDIA_WORKER_RELEASE_MANIFEST_SHA256 ||
    value.manifestAsset.state !== "uploaded" ||
    value.manifestAsset.contentType !== "application/json" ||
    value.manifestAsset.browserDownloadUrl !== MEDIA_WORKER_RELEASE_MANIFEST_URL ||
    value.manifestUrl !== MEDIA_WORKER_RELEASE_MANIFEST_URL ||
    value.manifestSizeBytes !== MEDIA_WORKER_RELEASE_MANIFEST_SIZE_BYTES ||
    value.manifestSha256 !== MEDIA_WORKER_RELEASE_MANIFEST_SHA256 ||
    canonicalJson(value.manifest) !== canonicalJson(MEDIA_WORKER_RELEASE_MANIFEST) ||
    value.binaryDownloads !== 0 ||
    value.credentialsUsed !== false ||
    value.providerMutations !== 0 ||
    value.gpuUse !== false ||
    value.externalSpendUsd !== 0 ||
    value.actualUsd !== 0 ||
    !Number.isInteger(value.redirectCount) ||
    value.redirectCount < 0 ||
    value.redirectCount > 1 ||
    canonicalSha256(unsigned) !== reconciliationSha256
  )
    fail("MEDIA_WORKER_RELEASE_READBACK_CONTRACT");
  return value;
}

function validateV213Execution(execution, checkpoint, state, expectedProjectIdentities) {
  const keys = [
    "call",
    "checkpoint",
    "deadlineAt",
    "pollIntervalMs",
    "schemaVersion",
    "workflowId",
    "workflowParams",
  ];
  if (
    !exactObjectKeys(execution, keys) ||
    execution.schemaVersion !== "videoforge.v213-database-acceptance-execution/v1" ||
    execution.checkpoint !== checkpoint ||
    typeof execution.workflowId !== "string" ||
    !exactObjectKeys(
      execution.call,
      checkpoint === "V2-10" || checkpoint === "V2-12"
        ? ["admission", "request"]
        : checkpoint === "V2-13"
          ? ["chromeArtifact", "evidenceArtifacts", "releaseIdentity", "request"]
          : ["request"],
    ) ||
    !Number.isInteger(execution.pollIntervalMs) ||
    execution.pollIntervalMs < 250 ||
    execution.pollIntervalMs > 10_000 ||
    typeof execution.deadlineAt !== "string" ||
    Number.isNaN(Date.parse(execution.deadlineAt)) ||
    execution.workflowParams === null ||
    typeof execution.workflowParams !== "object" ||
    Array.isArray(execution.workflowParams)
  )
    fail("ACCEPTANCE_AUTHORITY_EXECUTION");
  const request = execution.call.request;
  const requestKeys = [
    "approvalRecordSha256",
    "authoritySha256",
    "billingBaselineMicroUsd",
    "checkpoint",
    "cumulativeLedgerSha256",
    "cumulativeLedgerSpentBeforeMicroUsd",
    "executorSha256",
    "executionId",
    "maximumCumulativeVariableCostMicroUsd",
    "maximumVariableCostMicroUsd",
    "noRedispatch",
    "promotionDecisionSha256",
    "retainedVolumeIdSha256s",
    "scopes",
    "sourceCommit",
    "proposalSha256",
  ];
  if (
    !exactObjectKeys(request, requestKeys) ||
    request.checkpoint !== checkpoint ||
    typeof request.executionId !== "string" ||
    request.executionId === "" ||
    request.proposalSha256 !== state.proposal_sha256 ||
    request.sourceCommit !== state.release_source_commit ||
    !HASH.test(request.authoritySha256 ?? "") ||
    !HASH.test(request.approvalRecordSha256 ?? "") ||
    !HASH.test(request.cumulativeLedgerSha256 ?? "") ||
    !HASH.test(request.executorSha256 ?? "") ||
    !HASH.test(request.promotionDecisionSha256 ?? "") ||
    request.maximumVariableCostMicroUsd !== V213_ACCEPTANCE_PHASE_CAP_MICRO_USD[checkpoint] ||
    request.maximumCumulativeVariableCostMicroUsd !== 17_500_000 ||
    request.noRedispatch !== true ||
    !Number.isSafeInteger(request.billingBaselineMicroUsd) ||
    request.billingBaselineMicroUsd < 0 ||
    !Number.isSafeInteger(request.cumulativeLedgerSpentBeforeMicroUsd) ||
    request.cumulativeLedgerSpentBeforeMicroUsd < 0 ||
    !exactObjectKeys(request.retainedVolumeIdSha256s, ["mage", "soulx"]) ||
    !HASH.test(request.retainedVolumeIdSha256s.mage ?? "") ||
    !HASH.test(request.retainedVolumeIdSha256s.soulx ?? "") ||
    !Array.isArray(request.scopes) ||
    request.scopes.length !== (checkpoint === "V2-11" ? 2 : 1) ||
    request.scopes.some((scope, index) => {
      const expected =
        expectedProjectIdentities[index] ??
        (checkpoint === "V2-11" && index === 1 ? null : undefined);
      return (
        !exactObjectKeys(scope, [
          "accountId",
          "attemptId",
          "projectId",
          "projectRevisionId",
          "requestSha256",
          "workspaceId",
        ]) ||
        expected === undefined ||
        (expected !== null &&
          V213_PROJECT_IDENTITY_KEYS.some((key) => scope[key] !== expected[key])) ||
        (expected === null &&
          V213_PROJECT_IDENTITY_KEYS.some(
            (key) => typeof scope[key] !== "string" || scope[key] === "",
          )) ||
        typeof scope.attemptId !== "string" ||
        scope.attemptId === "" ||
        !HASH.test(scope.requestSha256 ?? "")
      );
    }) ||
    (checkpoint === "V2-11" &&
      (new Set(request.scopes.map((scope) => `${scope.accountId}:${scope.workspaceId}`)).size !==
        2 ||
        new Set(request.scopes.map((scope) => scope.projectId)).size !== 2))
  )
    fail("ACCEPTANCE_AUTHORITY_EXECUTION");
  if (execution.workflowId !== `v213-${checkpoint.toLowerCase()}-${request.executionId}`)
    fail("ACCEPTANCE_AUTHORITY_EXECUTION");
  return true;
}

function exactPostConsumptionWorkflowMaterialization(
  value,
  state,
  outerStateSha256,
  expectedWorkerBearerSha256,
) {
  const keys = [
    "fullLiveAuthorityId",
    "materializationSha256",
    "materializedAfterOuterConsumption",
    "outerStateSha256",
    "proposalSha256",
    "approvalSha256",
    "roleScopedIdentities",
    "staticReleaseDescriptorSha256",
    "sourceCommit",
    "workerOperatorBearerSha256",
    "workflowStartAuthority",
    "schemaVersion",
  ];
  if (
    !exactObjectKeys(value, keys) ||
    value.schemaVersion !== V213_POST_CONSUMPTION_MATERIALIZATION_SCHEMA ||
    !HASH.test(value.materializationSha256 ?? "")
  )
    fail("WORKFLOW_AUTHORITY_MATERIALIZATION_CONTRACT");
  const unsigned = { ...value };
  delete unsigned.materializationSha256;
  if (canonicalSha256(unsigned) !== value.materializationSha256)
    fail("WORKFLOW_AUTHORITY_MATERIALIZATION_HASH");
  if (
    value.materializedAfterOuterConsumption !== true ||
    !UUID.test(value.fullLiveAuthorityId ?? "") ||
    value.outerStateSha256 !== outerStateSha256 ||
    value.sourceCommit !== state.release_source_commit ||
    value.proposalSha256 !== state.proposal_sha256 ||
    value.approvalSha256 !== state.approval_sha256 ||
    !HASH.test(value.staticReleaseDescriptorSha256 ?? "") ||
    value.staticReleaseDescriptorSha256 !== state.static_release_descriptor_sha256 ||
    !HASH.test(value.workerOperatorBearerSha256 ?? "") ||
    (expectedWorkerBearerSha256 !== undefined &&
      value.workerOperatorBearerSha256 !== expectedWorkerBearerSha256)
  )
    fail("WORKFLOW_AUTHORITY_MATERIALIZATION_BINDING");
  const identities = value.roleScopedIdentities;
  if (
    !exactObjectKeys(identities, ["fairnessProbe", "primary", "sameAccountWaiter", "secondary"]) ||
    ![
      identities.primary,
      identities.sameAccountWaiter,
      identities.secondary,
      identities.fairnessProbe,
    ].every(
      (identity) =>
        exactObjectKeys(identity, V213_MATERIALIZATION_IDENTITY_KEYS) &&
        V213_MATERIALIZATION_IDENTITY_KEYS.every((key) => UUID.test(identity[key] ?? "")),
    ) ||
    ["accountId", "workspaceId", "projectId", "projectRevisionId"].some(
      (key) => identities.sameAccountWaiter[key] !== identities.primary[key],
    ) ||
    ["accountId", "workspaceId", "projectId", "projectRevisionId", "generationRequestId"].some(
      (key) =>
        new Set([identities.primary[key], identities.secondary[key], identities.fairnessProbe[key]])
          .size !== 3,
    ) ||
    new Set([
      identities.primary.generationRequestId,
      identities.sameAccountWaiter.generationRequestId,
      identities.secondary.generationRequestId,
      identities.fairnessProbe.generationRequestId,
    ]).size !== 4
  )
    fail("WORKFLOW_AUTHORITY_IDENTITIES");
  const supplied = value.workflowStartAuthority;
  if (
    !exactObjectKeys(supplied, [
      "authorityId",
      "expiresAt",
      "tokenSha256",
      "workflowAuthorityId",
    ]) ||
    !UUID.test(supplied.workflowAuthorityId ?? "") ||
    !UUID.test(supplied.authorityId ?? "") ||
    supplied.authorityId !== value.fullLiveAuthorityId ||
    !HASH.test(supplied.tokenSha256 ?? "") ||
    typeof supplied.expiresAt !== "string" ||
    Number.isNaN(Date.parse(supplied.expiresAt)) ||
    Date.parse(supplied.expiresAt) > Date.parse(state.expires_at)
  )
    fail("WORKFLOW_AUTHORITY_INPUT");
  // Operation 16 is deliberately only an identity/plan boundary. Child authorities and their
  // execution documents are created just-in-time by the corresponding acceptance operation,
  // after the predecessor result is durable.
  return Object.freeze(value);
}

/**
 * Validate the one acceptance authority produced at an acceptance boundary. Operation 16 may
 * legitimately have no child authorities yet; this validator keeps the later JIT seam just as
 * strict as the four-authority legacy/replay path. In particular, it never accepts an empty
 * admission or V2-13 evidence object as a stand-in for a DB-owned execution document.
 */
function exactJustInTimeAcceptanceAuthority({
  value,
  checkpoint,
  state,
  outerStateSha256,
  fullLiveAuthorityId,
  commandPayload,
}) {
  if (
    !V213_ACCEPTANCE_CHECKPOINTS.includes(checkpoint) ||
    !exactObjectKeys(value, ["document", "execution", "expiresAt", "tokenSha256"])
  )
    fail("ACCEPTANCE_AUTHORITY_INPUT");
  const document = value.document;
  const command = V213_ACCEPTANCE_COMMANDS[checkpoint];
  const workflowId = `v213-${checkpoint.toLowerCase()}-${document?.commandId}`;
  const attemptId = `${workflowId}-attempt`;
  if (
    !exactObjectKeys(commandPayload, V213_PROJECT_IDENTITY_KEYS) ||
    V213_PROJECT_IDENTITY_KEYS.some((key) => !UUID.test(commandPayload[key] ?? "")) ||
    !exactObjectKeys(document, [
      "accountId",
      "attemptId",
      "checkpoint",
      "command",
      "commandId",
      "outerStateSha256",
      "projectId",
      "projectRevisionId",
      "requestSha256",
      "schemaVersion",
      "stageAuthorityId",
      "workflowId",
      "workspaceId",
    ]) ||
    document.schemaVersion !== "videoforge.v213-hosted-acceptance-command/v1" ||
    document.command !== command ||
    document.commandId !== `v213:${fullLiveAuthorityId}:${command}` ||
    document.stageAuthorityId !== fullLiveAuthorityId ||
    document.checkpoint !== checkpoint ||
    document.workflowId !== workflowId ||
    document.attemptId !== attemptId ||
    document.outerStateSha256 !== outerStateSha256 ||
    !HASH.test(document.requestSha256 ?? "") ||
    canonicalSha256({
      command,
      checkpoint,
      workflowId,
      attemptId,
      ...commandPayload,
      outerStateSha256,
    }) !== document.requestSha256 ||
    V213_PROJECT_IDENTITY_KEYS.some((key) => document[key] !== commandPayload[key]) ||
    !HASH.test(value.tokenSha256 ?? "") ||
    typeof value.expiresAt !== "string" ||
    Number.isNaN(Date.parse(value.expiresAt)) ||
    Date.parse(value.expiresAt) > Date.parse(state.expires_at) ||
    Date.parse(value.expiresAt) > Date.now() + 15 * 60 * 1000
  )
    fail("ACCEPTANCE_AUTHORITY_INPUT");
  validateV213Execution(
    value.execution,
    checkpoint,
    state,
    checkpoint === "V2-11"
      ? [
          commandPayload,
          ...(value.execution.call.request.scopes?.[1]
            ? [
                Object.fromEntries(
                  V213_PROJECT_IDENTITY_KEYS.map((key) => [
                    key,
                    value.execution.call.request.scopes[1][key],
                  ]),
                ),
              ]
            : []),
        ]
      : [commandPayload],
  );
  if (
    (checkpoint === "V2-10" || checkpoint === "V2-12") &&
    (value.execution.call.admission === null ||
      typeof value.execution.call.admission !== "object" ||
      Array.isArray(value.execution.call.admission) ||
      Object.keys(value.execution.call.admission).length === 0)
  )
    fail("ACCEPTANCE_AUTHORITY_EXECUTION");
  if (
    checkpoint === "V2-13" &&
    (value.execution.call.chromeArtifact?.rawEvidence === undefined ||
      value.execution.call.chromeArtifact.rawEvidence === null ||
      typeof value.execution.call.chromeArtifact.rawEvidence !== "object" ||
      Object.keys(value.execution.call.chromeArtifact.rawEvidence).length === 0 ||
      value.execution.call.evidenceArtifacts === null ||
      typeof value.execution.call.evidenceArtifacts !== "object" ||
      Object.keys(value.execution.call.evidenceArtifacts).length === 0 ||
      value.execution.call.releaseIdentity === null ||
      typeof value.execution.call.releaseIdentity !== "object" ||
      Object.keys(value.execution.call.releaseIdentity).length < 4)
  )
    fail("ACCEPTANCE_AUTHORITY_EXECUTION");
  return Object.freeze(value);
}

function readProtectedPostConsumptionMaterialization({
  environment = process.env,
  state,
  outerStateSha256,
} = {}) {
  const path = environment.VIDEOFORGE_V2_13_POST_CONSUMPTION_MATERIALIZATION_FILE;
  if (typeof path !== "string" || path === "" || !path.startsWith("/") || path.includes("\0"))
    fail("WORKFLOW_AUTHORITY_MATERIALIZATION_FILE");
  const seedPath = environment.VIDEOFORGE_V2_13_MATERIALIZATION_SEED_FILE;
  if (typeof seedPath === "string" && resolve(path) === resolve(seedPath))
    fail("WORKFLOW_AUTHORITY_MATERIALIZATION_FILE");
  let directory;
  let materializationFile;
  try {
    directory = protectedDirectory(dirname(path), "WORKFLOW_AUTHORITY_MATERIALIZATION_DIRECTORY");
    materializationFile = protectedFile(path, "WORKFLOW_AUTHORITY_MATERIALIZATION_FILE");
  } catch {
    fail("WORKFLOW_AUTHORITY_MATERIALIZATION_FILE");
  }
  if ((lstatSync(directory).mode & 0o777) !== 0o700)
    fail("WORKFLOW_AUTHORITY_MATERIALIZATION_DIRECTORY");
  if ((lstatSync(materializationFile).mode & 0o777) !== 0o600)
    fail("WORKFLOW_AUTHORITY_MATERIALIZATION_FILE");
  const raw = readFileSync(materializationFile);
  let value;
  try {
    value = JSON.parse(raw.toString("utf8"));
  } catch {
    fail("WORKFLOW_AUTHORITY_MATERIALIZATION_JSON");
  }
  if (Buffer.compare(raw, Buffer.from(`${canonicalJson(value)}\n`)) !== 0)
    fail("WORKFLOW_AUTHORITY_MATERIALIZATION_CANONICAL");
  const bearerPath = environment.VIDEOFORGE_V2_13_WORKER_OPERATOR_BEARER_FILE;
  if (
    typeof bearerPath !== "string" ||
    bearerPath === "" ||
    !bearerPath.startsWith("/") ||
    bearerPath.includes("\0")
  )
    fail("WORKFLOW_AUTHORITY_BEARER_FILE");
  let bearerDirectory;
  let bearerFile;
  try {
    bearerDirectory = protectedDirectory(
      dirname(bearerPath),
      "WORKFLOW_AUTHORITY_BEARER_DIRECTORY",
    );
    bearerFile = protectedFile(bearerPath, "WORKFLOW_AUTHORITY_BEARER_FILE");
  } catch {
    fail("WORKFLOW_AUTHORITY_BEARER_FILE");
  }
  if ((lstatSync(bearerDirectory).mode & 0o777) !== 0o700)
    fail("WORKFLOW_AUTHORITY_BEARER_DIRECTORY");
  if ((lstatSync(bearerFile).mode & 0o777) !== 0o600) fail("WORKFLOW_AUTHORITY_BEARER_FILE");
  const bearer = readFileSync(bearerFile);
  if (
    bearer.length === 0 ||
    bearer.includes(0) ||
    bearer.toString("utf8").trim() !== bearer.toString("utf8")
  )
    fail("WORKFLOW_AUTHORITY_BEARER_FILE");
  return exactPostConsumptionWorkflowMaterialization(
    value,
    state,
    outerStateSha256,
    sha256(bearer),
  );
}

const V213_POST_CONSUMPTION_CHALLENGE_SCHEMA =
  "videoforge.v213-post-consumption-materialization-challenge/v1";
const V213_POST_CONSUMPTION_RESPONSE_SCHEMA =
  "videoforge.v213-post-consumption-materialization-response/v1";
const V213_POST_CONSUMPTION_CHALLENGE_KEYS = Object.freeze([
  "approvalRecordSha256",
  "authorityId",
  "authoritySha256",
  "cumulativeLedgerSha256",
  "expiresAt",
  "fullLiveAuthorityId",
  "operationId",
  "outerStateSha256",
  "proposalSha256",
  "requestSha256",
  "schemaVersion",
  "sourceCommit",
  "tokenSha256",
  "workflowAuthorityId",
  "workerOperatorBearerSha256",
]);
const V213_POST_CONSUMPTION_RESPONSE_KEYS = Object.freeze([
  "challengeId",
  "challengeSha256",
  "selection",
  "selectionSha256",
  "responseHmacSha256",
  "schemaVersion",
]);
const V213_POST_CONSUMPTION_SELECTION_KEYS = Object.freeze([
  "fairnessProbe",
  "primary",
  "sameAccountWaiter",
  "secondary",
]);
const V213_POST_CONSUMPTION_SELECTION_IDENTITY_KEYS = Object.freeze([
  "accountId",
  "workspaceId",
  "projectId",
  "projectRevisionId",
]);
const V213_POST_CONSUMPTION_FACT_KEYS = Object.freeze([
  "fullLiveAuthorityId",
  "roleScopedIdentities",
]);
const V213_STATIC_RELEASE_DESCRIPTOR_SCHEMA_V1 = "videoforge.v213-static-release-descriptor/v1";
const V213_STATIC_RELEASE_DESCRIPTOR_SCHEMA_V2 = "videoforge.v213-static-release-descriptor/v2";
const V213_STATIC_RELEASE_GATE_POLICY = Object.freeze({
  operations_runbooks_ready: Object.freeze({
    claims: Object.freeze([
      "stuck_job_runbook",
      "provider_outage_runbook",
      "billing_runbook",
      "rollback_runbook",
    ]),
    metricKeys: Object.freeze([
      "billingRunbookSha256",
      "providerOutageRunbookSha256",
      "rollbackRunbookSha256",
      "stuckJobRunbookSha256",
    ]),
    metricsPass: (metrics) => Object.values(metrics).every((value) => HASH.test(value ?? "")),
  }),
  backup_restore_ready: Object.freeze({
    claims: Object.freeze([
      "backup_readback_passed",
      "restore_evidence_accepted",
      "schema_migration_disposition_recorded",
    ]),
    metricKeys: Object.freeze([
      "backupReadbackPassed",
      "restoreEvidenceAccepted",
      "schemaMigrationDisposition",
    ]),
    metricsPass: (metrics) =>
      metrics.backupReadbackPassed === true &&
      metrics.restoreEvidenceAccepted === true &&
      metrics.schemaMigrationDisposition === "DISPOSABLE_RESTORE_COMPLETED",
  }),
  security_clear: Object.freeze({
    claims: Object.freeze([
      "p0_zero",
      "p1_zero",
      "auth_tenant_boundary_passed",
      "ssrf_path_upload_boundary_passed",
      "secret_log_scan_passed",
      "cost_amplification_guards_passed",
      "legacy_runtime_bundle_scan_passed",
    ]),
    metricKeys: Object.freeze([
      "authTenantPassed",
      "costAmplificationGuardsPassed",
      "legacyRuntimeBundleScanPassed",
      "p0Count",
      "p1Count",
      "secretLogScanPassed",
      "ssrfPathUploadPassed",
    ]),
    metricsPass: (metrics) =>
      metrics.p0Count === 0 &&
      metrics.p1Count === 0 &&
      metrics.authTenantPassed === true &&
      metrics.ssrfPathUploadPassed === true &&
      metrics.secretLogScanPassed === true &&
      metrics.costAmplificationGuardsPassed === true &&
      metrics.legacyRuntimeBundleScanPassed === true,
  }),
  production_transport_real: Object.freeze({
    claims: Object.freeze([
      "hosted_client_api_truth",
      "fixture_controls_absent",
      "fake_gpu_absent",
      "fake_transport_absent",
      "manual_pod_controls_absent",
      "legacy_dispatch_exports_absent",
    ]),
    metricKeys: Object.freeze([
      "fakeGpuProfileInBundle",
      "fakeTransportInBundle",
      "fixtureControlsInBundle",
      "hostedClientApiTruth",
      "legacyDispatchExportsInBundle",
      "manualPodControlsInBundle",
    ]),
    metricsPass: (metrics) =>
      metrics.hostedClientApiTruth === true &&
      metrics.fixtureControlsInBundle === false &&
      metrics.fakeGpuProfileInBundle === false &&
      metrics.fakeTransportInBundle === false &&
      metrics.manualPodControlsInBundle === false &&
      metrics.legacyDispatchExportsInBundle === false,
  }),
});
const V213_STATIC_RELEASE_GATES = Object.freeze(Object.keys(V213_STATIC_RELEASE_GATE_POLICY));

function exactStaticReleaseDescriptor(value, expectedSourceCommit, expectedSha256) {
  const isV2 = value?.schemaVersion === V213_STATIC_RELEASE_DESCRIPTOR_SCHEMA_V2;
  if (
    !exactObjectKeys(value, [
      "auditFacts",
      "contractBundleSha256",
      "descriptorSha256",
      "productionUrlSha256",
      "schemaVersion",
      "sourceCommit",
      ...(isV2 ? ["workflowRegistrationEvidence"] : []),
    ]) ||
    ![V213_STATIC_RELEASE_DESCRIPTOR_SCHEMA_V1, V213_STATIC_RELEASE_DESCRIPTOR_SCHEMA_V2].includes(
      value.schemaVersion,
    ) ||
    value.sourceCommit !== expectedSourceCommit ||
    !HASH.test(value.productionUrlSha256 ?? "") ||
    !HASH.test(value.contractBundleSha256 ?? "") ||
    !HASH.test(value.descriptorSha256 ?? "") ||
    (expectedSha256 !== undefined && value.descriptorSha256 !== expectedSha256) ||
    !exactObjectKeys(value.auditFacts, V213_STATIC_RELEASE_GATES)
  )
    fail("STATIC_RELEASE_DESCRIPTOR_CONTRACT");
  if (isV2)
    exactSoulxWorkflowRegistrationEvidence(
      value.workflowRegistrationEvidence,
      expectedSourceCommit,
    );
  for (const gate of V213_STATIC_RELEASE_GATES) {
    const fact = value.auditFacts[gate];
    const policy = V213_STATIC_RELEASE_GATE_POLICY[gate];
    if (
      !exactObjectKeys(fact, [
        "claims",
        "evidenceClass",
        "evidencePath",
        "fixtureOrFakeTransportUsed",
        "gate",
        "metrics",
        "observedAt",
        "observerId",
        "sourceEvidenceSha256",
      ]) ||
      fact.gate !== gate ||
      fact.evidenceClass !== "INDEPENDENT_RELEASE_AUDIT" ||
      !HASH.test(fact.sourceEvidenceSha256 ?? "") ||
      typeof fact.observerId !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(fact.observerId) ||
      typeof fact.evidencePath !== "string" ||
      !/^project-context\/evidence\/[A-Za-z0-9._/-]+\.json$/u.test(fact.evidencePath) ||
      fact.evidencePath.includes("..") ||
      typeof fact.observedAt !== "string" ||
      Number.isNaN(Date.parse(fact.observedAt)) ||
      new Date(fact.observedAt).toISOString() !== fact.observedAt ||
      fact.fixtureOrFakeTransportUsed !== false ||
      !Array.isArray(fact.claims) ||
      JSON.stringify([...fact.claims].sort()) !== JSON.stringify([...policy.claims].sort()) ||
      !exactObjectKeys(fact.metrics, policy.metricKeys) ||
      !policy.metricsPass(fact.metrics)
    )
      fail("STATIC_RELEASE_DESCRIPTOR_FACTS");
  }
  const unsigned = { ...value };
  delete unsigned.descriptorSha256;
  if (canonicalSha256(unsigned) !== value.descriptorSha256) fail("STATIC_RELEASE_DESCRIPTOR_HASH");
  return Object.freeze(value);
}

function producerStaticReleaseDescriptor(environment, state, production) {
  const path = environment?.VIDEOFORGE_V2_13_STATIC_RELEASE_DESCRIPTOR_FILE;
  if (typeof path !== "string" || path === "" || !path.startsWith("/") || path.includes("\0"))
    fail("STATIC_RELEASE_DESCRIPTOR_FILE");
  let raw;
  try {
    protectedExactDirectory(dirname(path), "STATIC_RELEASE_DESCRIPTOR_DIRECTORY");
    protectedExactFile(path, "STATIC_RELEASE_DESCRIPTOR_FILE");
    raw = readFileSync(path);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("V2_13_FULL_LIVE_ADAPTER_")) throw error;
    fail("STATIC_RELEASE_DESCRIPTOR_FILE");
  }
  let value;
  try {
    value = JSON.parse(raw.toString("utf8"));
  } catch {
    fail("STATIC_RELEASE_DESCRIPTOR_JSON");
  }
  if (Buffer.compare(raw, Buffer.from(`${canonicalJson(value)}\n`)) !== 0)
    fail("STATIC_RELEASE_DESCRIPTOR_CANONICAL_BYTES");
  const expected = state.static_release_descriptor_sha256;
  if (
    !HASH.test(expected ?? "") ||
    production.value.authorityDocument?.staticReleaseDescriptorSha256 !== expected
  )
    fail("STATIC_RELEASE_DESCRIPTOR_AUTHORITY_BINDING");
  return exactStaticReleaseDescriptor(value, state.release_source_commit, expected);
}

function protectedExactDirectory(path, code) {
  const directory = protectedDirectory(path, code);
  if ((lstatSync(directory).mode & 0o777) !== 0o700) fail(code);
  return directory;
}

function protectedExactFile(path, code) {
  const file = protectedFile(path, code);
  if ((lstatSync(file).mode & 0o777) !== 0o600) fail(code);
  return file;
}

function producerWorkerBearer(environment) {
  const path = environment?.VIDEOFORGE_V2_13_WORKER_OPERATOR_BEARER_FILE;
  if (typeof path !== "string" || path === "" || !path.startsWith("/") || path.includes("\0"))
    fail("POST_CONSUMPTION_BEARER_FILE");
  try {
    protectedExactDirectory(dirname(path), "POST_CONSUMPTION_BEARER_DIRECTORY");
    protectedExactFile(path, "POST_CONSUMPTION_BEARER_FILE");
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("V2_13_FULL_LIVE_ADAPTER_")) throw error;
    fail("POST_CONSUMPTION_BEARER_FILE");
  }
  const value = readFileSync(path);
  if (
    value.length === 0 ||
    value.includes(0) ||
    value.toString("utf8").trim() !== value.toString("utf8")
  )
    fail("POST_CONSUMPTION_BEARER_FILE");
  return value;
}

function producerExistingProductionInput(environment) {
  const path = environment?.VIDEOFORGE_V2_13_PRODUCTION_INPUT_FILE;
  if (typeof path !== "string" || path === "" || !path.startsWith("/") || path.includes("\0"))
    fail("POST_CONSUMPTION_PRODUCTION_INPUT_FILE");
  let raw;
  try {
    protectedExactDirectory(dirname(path), "POST_CONSUMPTION_PRODUCTION_INPUT_DIRECTORY");
    protectedExactFile(path, "POST_CONSUMPTION_PRODUCTION_INPUT_FILE");
    raw = readFileSync(path);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("V2_13_FULL_LIVE_ADAPTER_")) throw error;
    fail("POST_CONSUMPTION_PRODUCTION_INPUT_FILE");
  }
  let value;
  try {
    value = JSON.parse(raw.toString("utf8"));
  } catch {
    fail("POST_CONSUMPTION_PRODUCTION_INPUT_JSON");
  }
  if (
    Buffer.compare(raw, Buffer.from(`${canonicalJson(value)}\n`)) !== 0 ||
    !exactObjectKeys(value, [
      "authorityDocument",
      "commandPayloads",
      "dualLaneInput",
      "fullLiveAuthorityId",
      "schemaVersion",
    ]) ||
    value.schemaVersion !== "videoforge.v213-full-live-outer-input/v1" ||
    !UUID.test(value.fullLiveAuthorityId ?? "") ||
    value.authorityDocument === null ||
    typeof value.authorityDocument !== "object" ||
    value.dualLaneInput === null ||
    typeof value.dualLaneInput !== "object" ||
    value.commandPayloads === null ||
    typeof value.commandPayloads !== "object" ||
    Array.isArray(value.commandPayloads)
  )
    fail("POST_CONSUMPTION_PRODUCTION_INPUT_CONTRACT");
  return Object.freeze({ value, raw });
}

function postConsumptionLedgerSha256(state) {
  if (HASH.test(state?.cumulative_ledger_sha256 ?? "")) return state.cumulative_ledger_sha256;
  const phases = Object.fromEntries(
    Object.entries(state?.phases ?? {}).map(([name, phase]) => [
      name,
      {
        reservedUsd: phase?.reserved_usd ?? 0,
        settledUsd: phase?.settled_usd ?? 0,
        state: phase?.state ?? "PENDING",
      },
    ]),
  );
  return canonicalSha256({
    maximumCumulativeFiniteRunpodSpendUsd:
      state?.maximum_cumulative_finite_runpod_spend_usd ?? 17.5,
    phases,
    totalReservedUsd: state?.total_reserved_usd ?? 0,
    totalSettledUsd: state?.total_settled_usd ?? 0,
  });
}

function exactPostConsumptionChallenge(value) {
  if (
    !exactObjectKeys(value, V213_POST_CONSUMPTION_CHALLENGE_KEYS) ||
    value.schemaVersion !== V213_POST_CONSUMPTION_CHALLENGE_SCHEMA ||
    !UUID.test(value.fullLiveAuthorityId ?? "") ||
    !UUID.test(value.workflowAuthorityId ?? "") ||
    !HASH.test(value.authoritySha256 ?? "") ||
    !HASH.test(value.approvalRecordSha256 ?? "") ||
    !HASH.test(value.cumulativeLedgerSha256 ?? "") ||
    !HASH.test(value.tokenSha256 ?? "") ||
    !HASH.test(value.workerOperatorBearerSha256 ?? "") ||
    !HASH.test(value.outerStateSha256 ?? "") ||
    !HASH.test(value.proposalSha256 ?? "") ||
    !COMMIT.test(value.sourceCommit ?? "") ||
    typeof value.authorityId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,190}$/u.test(value.authorityId) ||
    value.operationId !== "record-workflow-start-authority" ||
    typeof value.expiresAt !== "string" ||
    Number.isNaN(Date.parse(value.expiresAt)) ||
    !HASH.test(value.requestSha256 ?? "")
  )
    fail("POST_CONSUMPTION_CHALLENGE_CONTRACT");
  const unsigned = { ...value };
  delete unsigned.requestSha256;
  if (canonicalSha256(unsigned) !== value.requestSha256) fail("POST_CONSUMPTION_CHALLENGE_HASH");
  return Object.freeze(value);
}

function postConsumptionResponseHmac(response, bearer) {
  return `sha256:${createHmac("sha256", bearer)
    .update(
      canonicalJson({
        challengeId: response.challengeId,
        challengeSha256: response.challengeSha256,
        selection: response.selection,
        selectionSha256: response.selectionSha256,
      }),
    )
    .digest("hex")}`;
}

/**
 * The production app journey writes one authenticated identity at a time. The operator side
 * never trusts that response directly: it polls the SECURITY DEFINER readback until all three
 * distinct account selections are durable, verifies the DB hash, and signs the resulting selection with the
 * protected worker bearer before it enters the normal response validator.
 */
function createDatabasePostConsumptionHandshake({
  database,
  environment = process.env,
  timeoutMs = 60_000,
  pollIntervalMs = 500,
} = {}) {
  if (database === null || typeof database?.query !== "function")
    fail("POST_CONSUMPTION_DATABASE_REQUIRED");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 300_000)
    fail("POST_CONSUMPTION_TIMEOUT_BOUND");
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 100 || pollIntervalMs > 10_000)
    fail("POST_CONSUMPTION_POLL_INTERVAL_BOUND");
  const bearer = producerWorkerBearer(environment);
  return async (challenge) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      let result;
      try {
        result = await database.query(
          "SELECT public.videoforge_load_v213_materialization_selection($1::jsonb) AS selection",
          [
            JSON.stringify({
              challengeId: challenge.challengeId,
              challengeSha256: challenge.requestSha256,
            }),
          ],
        );
      } catch {
        throw new Error("POST_CONSUMPTION_HANDSHAKE_DATABASE");
      }
      if (result?.rows?.length !== 1) throw new Error("POST_CONSUMPTION_HANDSHAKE_AMBIGUOUS");
      const loaded = result.rows[0]?.selection;
      if (loaded !== null && loaded !== undefined) {
        if (
          typeof loaded !== "object" ||
          Array.isArray(loaded) ||
          !exactObjectKeys(loaded, ["selection", "selectionSha256"])
        )
          throw new Error("POST_CONSUMPTION_HANDSHAKE_CONTRACT");
        const selected = exactPostConsumptionSelection(loaded.selection);
        if (canonicalSha256(selected) !== loaded.selectionSha256)
          throw new Error("POST_CONSUMPTION_HANDSHAKE_HASH");
        const response = {
          schemaVersion: V213_POST_CONSUMPTION_RESPONSE_SCHEMA,
          challengeId: challenge.challengeId,
          challengeSha256: challenge.requestSha256,
          selection: selected,
          selectionSha256: loaded.selectionSha256,
        };
        return Object.freeze({
          ...response,
          responseHmacSha256: postConsumptionResponseHmac(response, bearer),
        });
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await new Promise((resolvePromise) =>
        setTimeout(resolvePromise, Math.min(pollIntervalMs, remaining)),
      );
    }
    throw new Error("POST_CONSUMPTION_HANDSHAKE_TIMEOUT");
  };
}

function exactPostConsumptionFacts(value) {
  if (!exactObjectKeys(value, V213_POST_CONSUMPTION_FACT_KEYS))
    fail("POST_CONSUMPTION_FACTS_CONTRACT");
  if (
    !UUID.test(value.fullLiveAuthorityId ?? "") ||
    !exactObjectKeys(value.roleScopedIdentities, [
      "fairnessProbe",
      "primary",
      "sameAccountWaiter",
      "secondary",
    ]) ||
    ![
      value.roleScopedIdentities.primary,
      value.roleScopedIdentities.sameAccountWaiter,
      value.roleScopedIdentities.secondary,
      value.roleScopedIdentities.fairnessProbe,
    ].every(
      (identity) =>
        exactObjectKeys(identity, V213_MATERIALIZATION_IDENTITY_KEYS) &&
        V213_MATERIALIZATION_IDENTITY_KEYS.every((key) => UUID.test(identity[key] ?? "")),
    ) ||
    ["accountId", "workspaceId", "projectId", "projectRevisionId"].some(
      (key) =>
        value.roleScopedIdentities.sameAccountWaiter[key] !==
        value.roleScopedIdentities.primary[key],
    ) ||
    ["accountId", "workspaceId", "projectId", "projectRevisionId", "generationRequestId"].some(
      (key) =>
        new Set([
          value.roleScopedIdentities.primary[key],
          value.roleScopedIdentities.secondary[key],
          value.roleScopedIdentities.fairnessProbe[key],
        ]).size !== 3,
    ) ||
    new Set([
      value.roleScopedIdentities.primary.generationRequestId,
      value.roleScopedIdentities.sameAccountWaiter.generationRequestId,
      value.roleScopedIdentities.secondary.generationRequestId,
      value.roleScopedIdentities.fairnessProbe.generationRequestId,
    ]).size !== 4
  )
    fail("POST_CONSUMPTION_FACTS_CONTRACT");
  return Object.freeze(value);
}

function exactPostConsumptionSelection(value) {
  if (
    !exactObjectKeys(value, V213_POST_CONSUMPTION_SELECTION_KEYS) ||
    !exactObjectKeys(value.primary, V213_POST_CONSUMPTION_SELECTION_IDENTITY_KEYS) ||
    !exactObjectKeys(value.sameAccountWaiter, V213_POST_CONSUMPTION_SELECTION_IDENTITY_KEYS) ||
    !exactObjectKeys(value.secondary, V213_POST_CONSUMPTION_SELECTION_IDENTITY_KEYS) ||
    !exactObjectKeys(value.fairnessProbe, V213_POST_CONSUMPTION_SELECTION_IDENTITY_KEYS) ||
    V213_POST_CONSUMPTION_SELECTION_IDENTITY_KEYS.some(
      (key) =>
        !UUID.test(value.primary[key] ?? "") ||
        !UUID.test(value.sameAccountWaiter[key] ?? "") ||
        !UUID.test(value.secondary[key] ?? "") ||
        !UUID.test(value.fairnessProbe[key] ?? ""),
    ) ||
    V213_POST_CONSUMPTION_SELECTION_IDENTITY_KEYS.some(
      (key) => value.sameAccountWaiter[key] !== value.primary[key],
    ) ||
    ["accountId", "workspaceId", "projectId", "projectRevisionId"].some(
      (key) =>
        new Set([value.primary[key], value.secondary[key], value.fairnessProbe[key]]).size !== 3,
    )
  )
    fail("POST_CONSUMPTION_SELECTION_CONTRACT");
  return Object.freeze(value);
}

function exactPostConsumptionResponse(value, challenge, bearer) {
  if (
    !exactObjectKeys(value, V213_POST_CONSUMPTION_RESPONSE_KEYS) ||
    value.schemaVersion !== V213_POST_CONSUMPTION_RESPONSE_SCHEMA ||
    value.challengeId !== challenge.challengeId ||
    value.challengeSha256 !== challenge.requestSha256 ||
    !HASH.test(value.selectionSha256 ?? "") ||
    !HASH.test(value.responseHmacSha256 ?? "")
  )
    fail("POST_CONSUMPTION_RESPONSE_CONTRACT");
  const selection = exactPostConsumptionSelection(value.selection);
  if (canonicalSha256(selection) !== value.selectionSha256) fail("POST_CONSUMPTION_RESPONSE_HASH");
  const expected = postConsumptionResponseHmac({ ...value, selection }, bearer);
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(value.responseHmacSha256);
  if (expectedBytes.length !== actualBytes.length || !timingSafeEqual(expectedBytes, actualBytes))
    fail("POST_CONSUMPTION_RESPONSE_SIGNATURE");
  return Object.freeze({ ...value, selection });
}

function buildPostConsumptionMaterialization({
  challenge,
  facts,
  staticReleaseDescriptorSha256,
  workflowStartAuthority,
  outerStateSha256,
  state,
}) {
  const materialization = {
    schemaVersion: V213_POST_CONSUMPTION_MATERIALIZATION_SCHEMA,
    fullLiveAuthorityId: facts.fullLiveAuthorityId,
    materializedAfterOuterConsumption: true,
    outerStateSha256,
    sourceCommit: state.release_source_commit,
    proposalSha256: state.proposal_sha256,
    approvalSha256: state.approval_sha256,
    workerOperatorBearerSha256: challenge.workerOperatorBearerSha256,
    roleScopedIdentities: facts.roleScopedIdentities,
    staticReleaseDescriptorSha256,
    workflowStartAuthority,
  };
  materialization.materializationSha256 = canonicalSha256(materialization);
  return exactPostConsumptionWorkflowMaterialization(
    materialization,
    state,
    outerStateSha256,
    challenge.workerOperatorBearerSha256,
  );
}

/**
 * Post-consumption producer boundary. The app receives only a one-use challenge and returns
 * selection facts; the operator database then supplies the three authoritative role-scoped
 * identities and their current generation request IDs.
 * Admissions and acceptance executions are
 * intentionally deferred to each JIT operation. A prewritten JSON file is never an input to this
 * path. The response is HMAC-bound to the protected worker bearer and the challenge, and the DB
 * readback is required before any authority is recorded.
 */
function createPostConsumptionMaterializationProducer({
  environment = process.env,
  handshake,
  selection,
  issueChallenge,
  loadFacts,
  recordStaticReleaseDescriptor,
  readback,
  materializationFile,
  fullLiveAuthorityId,
  cumulativeLedgerSha256,
  timeoutMs = 60_000,
} = {}) {
  const journey = handshake ?? selection;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 300_000)
    fail("POST_CONSUMPTION_TIMEOUT_BOUND");
  return async ({
    operation = {},
    state = {},
    priorResults = new Map(),
    outerStateSha256,
    database,
    databaseBinding,
  } = {}) => {
    const bounded = async (work, code) => {
      try {
        return await new Promise((resolvePromise, rejectPromise) => {
          const timer = setTimeout(() => rejectPromise(new Error("timeout")), timeoutMs);
          Promise.resolve()
            .then(work)
            .then(
              (value) => {
                clearTimeout(timer);
                resolvePromise(value);
              },
              (error) => {
                clearTimeout(timer);
                rejectPromise(error);
              },
            );
        });
      } catch {
        fail(code);
      }
    };
    if (
      (operation.id !== undefined && operation.id !== "record-workflow-start-authority") ||
      (operation.operationId !== undefined &&
        operation.operationId !== "record-workflow-start-authority")
    )
      fail("POST_CONSUMPTION_OPERATION");
    if (
      !["CONSUMED_SINGLE_EXECUTION_IN_PROGRESS", "CONSUMED_SINGLE_EXECUTION_CLEANUP_ONLY"].includes(
        state.state,
      ) ||
      !HASH.test(outerStateSha256 ?? "") ||
      !HASH.test(state.authority_sha256 ?? "") ||
      !HASH.test(state.proposal_sha256 ?? "") ||
      !HASH.test(state.approval_sha256 ?? "") ||
      !HASH.test(state.full_live_executor_sha256 ?? "") ||
      !COMMIT.test(state.release_source_commit ?? "")
    )
      fail("POST_CONSUMPTION_OUTER_BINDING");
    const bearer = producerWorkerBearer(environment);
    const bearerSha256 = sha256(bearer);
    const production = producerExistingProductionInput(environment);
    const staticReleaseDescriptor = producerStaticReleaseDescriptor(environment, state, production);
    const fullAuthority = fullLiveAuthorityId ?? production.value.fullLiveAuthorityId;
    if (!UUID.test(fullAuthority)) fail("POST_CONSUMPTION_FULL_LIVE_AUTHORITY");
    const ledgerSha256 = cumulativeLedgerSha256 ?? postConsumptionLedgerSha256(state);
    if (!HASH.test(ledgerSha256)) fail("POST_CONSUMPTION_LEDGER_BINDING");
    const workflowAuthorityId = randomUUID();
    const tokenSha256 = sha256(randomBytes(32));
    const stateExpiryMs = Date.parse(state.expires_at);
    const childExpiryMs = Math.min(stateExpiryMs, Date.now() + 15 * 60 * 1000);
    if (!Number.isFinite(stateExpiryMs) || childExpiryMs <= Date.now())
      fail("POST_CONSUMPTION_EXPIRY");
    const childExpiresAt = new Date(childExpiryMs).toISOString();
    const challengeWithoutHash = {
      schemaVersion: V213_POST_CONSUMPTION_CHALLENGE_SCHEMA,
      operationId: "record-workflow-start-authority",
      authorityId: state.authority_id,
      authoritySha256: state.authority_sha256,
      fullLiveAuthorityId: fullAuthority,
      outerStateSha256,
      proposalSha256: state.proposal_sha256,
      approvalRecordSha256: state.approval_sha256,
      sourceCommit: state.release_source_commit,
      workerOperatorBearerSha256: bearerSha256,
      cumulativeLedgerSha256: ledgerSha256,
      workflowAuthorityId,
      tokenSha256,
      // The outer approval may live for 24h, but every materialization/workflow authority is
      // independently capped at fifteen minutes by the database contract.
      expiresAt: childExpiresAt,
    };
    const challenge = exactPostConsumptionChallenge({
      ...challengeWithoutHash,
      requestSha256: canonicalSha256(challengeWithoutHash),
    });
    const queryOne = async (sql, parameters, key, code) => {
      if (database === null || typeof database?.query !== "function") fail(code);
      let result;
      try {
        result = await bounded(() => database.query(sql, parameters), code);
      } catch {
        fail(code);
      }
      if (result?.rows?.length !== 1 || result.rows[0]?.[key] === undefined) fail(code);
      return result.rows[0][key];
    };
    const recordDescriptor =
      recordStaticReleaseDescriptor ?? databaseBinding?.recordV213StaticReleaseDescriptor;
    const descriptorReadback =
      typeof recordDescriptor === "function"
        ? await bounded(
            () =>
              recordDescriptor({
                fullLiveAuthorityId: fullAuthority,
                outerStateSha256,
                descriptorSha256: staticReleaseDescriptor.descriptorSha256,
                descriptor: staticReleaseDescriptor,
              }),
            "STATIC_RELEASE_DESCRIPTOR_PERSIST_AMBIGUOUS",
          )
        : await queryOne(
            "SELECT public.videoforge_record_v213_static_release_descriptor($1::jsonb) AS descriptor",
            [
              JSON.stringify({
                fullLiveAuthorityId: fullAuthority,
                outerStateSha256,
                descriptorSha256: staticReleaseDescriptor.descriptorSha256,
                descriptor: staticReleaseDescriptor,
              }),
            ],
            "descriptor",
            "STATIC_RELEASE_DESCRIPTOR_PERSIST_REJECTED",
          );
    if (
      !exactObjectKeys(descriptorReadback, ["descriptorSha256"]) ||
      descriptorReadback.descriptorSha256 !== staticReleaseDescriptor.descriptorSha256
    )
      fail("STATIC_RELEASE_DESCRIPTOR_READBACK");
    const issue = issueChallenge ?? databaseBinding?.issueV213MaterializationChallenge;
    const issueResult =
      typeof issue === "function"
        ? await bounded(
            () => issue(challenge, { database, databaseBinding, state, priorResults }),
            "POST_CONSUMPTION_CHALLENGE_AMBIGUOUS",
          )
        : await queryOne(
            "SELECT public.videoforge_issue_v213_materialization_challenge($1::jsonb) AS challenge",
            [JSON.stringify(challenge)],
            "challenge",
            "POST_CONSUMPTION_CHALLENGE_REJECTED",
          );
    if (
      issueResult === null ||
      typeof issueResult !== "object" ||
      !exactObjectKeys(issueResult, ["authoritySha256", "challengeId", "challengeSha256"]) ||
      issueResult.challengeId === undefined ||
      issueResult.challengeSha256 !== challenge.requestSha256 ||
      issueResult.authoritySha256 !== challenge.authoritySha256
    )
      fail("POST_CONSUMPTION_CHALLENGE_REJECTED");
    const challengeId = issueResult.challengeId;
    if (!UUID.test(challengeId)) fail("POST_CONSUMPTION_CHALLENGE_ID");
    const issuedChallenge = Object.freeze({ ...challenge, challengeId });
    const respond = journey ?? databaseBinding?.postConsumptionHandshake;
    if (typeof respond !== "function") fail("POST_CONSUMPTION_HANDSHAKE_REQUIRED");
    const response = await bounded(
      () =>
        respond(issuedChallenge, {
          database,
          databaseBinding,
          state,
          priorResults,
          outerStateSha256,
        }),
      "POST_CONSUMPTION_HANDSHAKE_AMBIGUOUS",
    );
    const verifiedResponse = exactPostConsumptionResponse(response, issuedChallenge, bearer);
    const load = loadFacts ?? databaseBinding?.loadV213MaterializationFacts;
    const factsResult =
      typeof load === "function"
        ? await bounded(
            () =>
              load({
                challenge: issuedChallenge,
                response: verifiedResponse,
                selection: verifiedResponse.selection,
                database,
                databaseBinding,
                state,
                priorResults,
              }),
            "POST_CONSUMPTION_FACTS_AMBIGUOUS",
          )
        : await queryOne(
            "SELECT public.videoforge_complete_v213_materialization_challenge($1::jsonb) AS facts",
            [
              JSON.stringify({
                challengeId,
                challengeSha256: issuedChallenge.requestSha256,
                selection: verifiedResponse.selection,
                selectionSha256: verifiedResponse.selectionSha256,
              }),
            ],
            "facts",
            "POST_CONSUMPTION_FACTS_REJECTED",
          );
    if (
      factsResult === null ||
      typeof factsResult !== "object" ||
      !exactObjectKeys(factsResult, ["facts", "factsSha256"]) ||
      !HASH.test(factsResult.factsSha256 ?? "")
    )
      fail("POST_CONSUMPTION_FACTS_READBACK");
    const facts = exactPostConsumptionFacts(factsResult.facts);
    if (
      facts.fullLiveAuthorityId !== fullAuthority ||
      canonicalSha256(facts) !== factsResult.factsSha256
    )
      fail("POST_CONSUMPTION_FACTS_READBACK");
    const materialized = buildPostConsumptionMaterialization({
      challenge: issuedChallenge,
      facts,
      staticReleaseDescriptorSha256: staticReleaseDescriptor.descriptorSha256,
      workflowStartAuthority: {
        authorityId: fullAuthority,
        workflowAuthorityId,
        tokenSha256,
        expiresAt: childExpiresAt,
      },
      outerStateSha256,
      state,
    });
    const verify = readback ?? databaseBinding?.readV213MaterializationReadback;
    const observed =
      typeof verify === "function"
        ? await bounded(
            () =>
              verify({
                challenge: issuedChallenge,
                response: verifiedResponse,
                facts,
                materialization: materialized,
                database,
                databaseBinding,
                state,
                priorResults,
              }),
            "POST_CONSUMPTION_READBACK_AMBIGUOUS",
          )
        : await queryOne(
            "SELECT public.videoforge_read_v213_materialization_readback($1::jsonb) AS readback",
            [
              JSON.stringify({
                challengeId,
                challengeSha256: issuedChallenge.requestSha256,
                materializationSha256: materialized.materializationSha256,
                selectionSha256: verifiedResponse.selectionSha256,
                factsSha256: factsResult.factsSha256,
              }),
            ],
            "readback",
            "POST_CONSUMPTION_READBACK_REQUIRED",
          );
    if (
      observed === null ||
      typeof observed !== "object" ||
      observed.readbackVerified !== true ||
      observed.challengeId !== challengeId ||
      observed.materializationSha256 !== materialized.materializationSha256 ||
      observed.factsSha256 !== factsResult.factsSha256
    )
      fail("POST_CONSUMPTION_READBACK_INVALID");
    const path =
      materializationFile ?? environment.VIDEOFORGE_V2_13_POST_CONSUMPTION_MATERIALIZATION_FILE;
    if (
      typeof path !== "string" ||
      path === "" ||
      !path.startsWith("/") ||
      path.includes("\0") ||
      (typeof environment.VIDEOFORGE_V2_13_MATERIALIZATION_SEED_FILE === "string" &&
        resolve(path) === resolve(environment.VIDEOFORGE_V2_13_MATERIALIZATION_SEED_FILE))
    )
      fail("POST_CONSUMPTION_MATERIALIZATION_FILE");
    protectedExactDirectory(dirname(path), "POST_CONSUMPTION_MATERIALIZATION_DIRECTORY");
    exclusiveAtomicBytes(path, Buffer.from(`${canonicalJson(materialized)}\n`));
    return Object.freeze(materialized);
  };
}

function injectPostConsumptionCommandPayloads({
  productionInputFile,
  chainFile,
  commandPayloads,
  fullLiveAuthorityId,
  materializationSha256,
  state,
  priorResults,
  outerStateSha256,
} = {}) {
  if (
    typeof productionInputFile !== "string" ||
    productionInputFile === "" ||
    !productionInputFile.startsWith("/") ||
    productionInputFile.includes("\0") ||
    typeof chainFile !== "string" ||
    chainFile === "" ||
    !chainFile.startsWith("/") ||
    chainFile.includes("\0")
  )
    fail("WORKFLOW_AUTHORITY_PRODUCTION_INPUT_PATH");
  let raw;
  try {
    const directory = protectedDirectory(
      dirname(productionInputFile),
      "WORKFLOW_AUTHORITY_PRODUCTION_INPUT_DIRECTORY",
    );
    const file = protectedFile(productionInputFile, "WORKFLOW_AUTHORITY_PRODUCTION_INPUT_FILE");
    if ((lstatSync(directory).mode & 0o777) !== 0o700 || (lstatSync(file).mode & 0o777) !== 0o600)
      fail("WORKFLOW_AUTHORITY_PRODUCTION_INPUT_MODE");
    raw = readFileSync(file);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("V2_13_FULL_LIVE_ADAPTER_")) throw error;
    fail("WORKFLOW_AUTHORITY_PRODUCTION_INPUT_FILE");
  }
  let current;
  try {
    current = JSON.parse(raw.toString("utf8"));
  } catch {
    fail("WORKFLOW_AUTHORITY_PRODUCTION_INPUT_JSON");
  }
  if (
    current?.schemaVersion !== "videoforge.v213-full-live-outer-input/v1" ||
    current.fullLiveAuthorityId !== fullLiveAuthorityId ||
    !exactObjectKeys(current, [
      "authorityDocument",
      "commandPayloads",
      "dualLaneInput",
      "fullLiveAuthorityId",
      "schemaVersion",
    ]) ||
    Buffer.compare(raw, Buffer.from(`${canonicalJson(current)}\n`)) !== 0 ||
    commandPayloads === null ||
    typeof commandPayloads !== "object" ||
    Array.isArray(commandPayloads)
  )
    fail("WORKFLOW_AUTHORITY_PRODUCTION_INPUT_CONTRACT");
  const desiredPayloadsSha256 = canonicalSha256(commandPayloads);
  const existingPayloadsSha256 = canonicalSha256(current.commandPayloads);
  if (
    Object.keys(current.commandPayloads).length > 0 &&
    existingPayloadsSha256 !== desiredPayloadsSha256
  )
    fail("WORKFLOW_AUTHORITY_PRODUCTION_INPUT_REPLAY_DRIFT");
  const next = { ...current, commandPayloads };
  const nextBytes = Buffer.from(`${canonicalJson(next)}\n`);
  atomicExactTransition(productionInputFile, raw, nextBytes);
  const prior = priorResults?.get("promote-qualified-production");
  const priorEvidence = prior?.evidenceSha256 ?? prior?.databasePromotionSha256;
  const orderedPrior = HASH.test(priorEvidence ?? "")
    ? [["promote-qualified-production", priorEvidence]]
    : [];
  const chainEntrySha256 = atomicChainUpdate(chainFile, {
    kind: "post-consumption-command-payloads",
    authority_id: state.authority_id,
    outer_state_sha256: outerStateSha256,
    ordered_prior_operation_evidence_sha256s: orderedPrior,
    ordered_output_sha256s: [
      ["production_input_sha256", sha256(nextBytes)],
      ["command_payloads_sha256", desiredPayloadsSha256],
      ["post_consumption_materialization_sha256", materializationSha256],
    ],
  });
  return Object.freeze({ productionInputSha256: sha256(nextBytes), chainEntrySha256 });
}

function createAcceptanceAuthorityDatabaseAdapter(database) {
  if (database === null || typeof database !== "object" || typeof database.query !== "function")
    fail("DATABASE_ADAPTER_CONTRACT");
  return Object.freeze({
    async recordAcceptanceAuthority(authority) {
      let result;
      try {
        result = await database.query(
          "SELECT public.videoforge_record_v213_acceptance_authority($1::jsonb) AS authority",
          [JSON.stringify(authority)],
        );
      } catch {
        fail("DATABASE_ACCEPTANCE_AUTHORITY_RECORD");
      }
      if (
        result?.rows?.length !== 1 ||
        result.rows[0]?.authority === null ||
        typeof result.rows[0]?.authority !== "object"
      )
        fail("DATABASE_ACCEPTANCE_AUTHORITY_RESULT");
      return Object.freeze(result.rows[0].authority);
    },
  });
}

function createWorkflowStartAuthorityAdapter({
  database,
  databaseFactory,
  materialize,
  producer,
} = {}) {
  const staticDatabase =
    database !== null && typeof database === "object" && typeof database.query === "function"
      ? database
      : null;
  if (staticDatabase === null && typeof databaseFactory !== "function")
    return async () => fail("WORKFLOW_AUTHORITY_DATABASE_REQUIRED");
  const prepareAcceptanceAuthority = async ({
    command,
    checkpoint,
    commandId,
    fullLiveAuthorityId,
    predecessorEvidenceSha256s,
    state = {},
    outerStateSha256,
  } = {}) => {
    if (
      !V213_JIT_CHECKPOINTS.includes(checkpoint) ||
      V213_JIT_COMMANDS[checkpoint] !== command ||
      !UUID.test(fullLiveAuthorityId ?? "") ||
      typeof commandId !== "string" ||
      !HASH.test(outerStateSha256 ?? "") ||
      predecessorEvidenceSha256s === null ||
      typeof predecessorEvidenceSha256s !== "object" ||
      Array.isArray(predecessorEvidenceSha256s) ||
      Object.values(predecessorEvidenceSha256s).some((value) => !HASH.test(value ?? ""))
    )
      fail("ACCEPTANCE_AUTHORITY_PREPARATION_INPUT");
    const bound =
      staticDatabase ??
      (await databaseFactory({
        operation: { id: command },
        state,
        priorResults: new Map(),
        outerStateSha256,
      }));
    const rawDatabase = bound?.database ?? bound;
    if (
      rawDatabase === null ||
      typeof rawDatabase !== "object" ||
      typeof rawDatabase.query !== "function"
    )
      fail("WORKFLOW_AUTHORITY_DATABASE_REQUIRED");
    const close = typeof bound?.close === "function" ? bound.close : async () => {};
    try {
      const result = await rawDatabase.query(
        "SELECT public.videoforge_prepare_v213_jit_operation($1::jsonb) AS authority",
        [
          JSON.stringify({
            checkpoint,
            command,
            commandId,
            fullLiveAuthorityId,
            outerStateSha256,
            predecessorEvidenceSha256s,
          }),
        ],
      );
      if (result?.rows?.length !== 1 || result.rows[0]?.authority === null)
        fail("ACCEPTANCE_AUTHORITY_PREPARATION_RESULT");
      const prepared = result.rows[0].authority;
      if (
        !exactObjectKeys(prepared, [
          "checkpoint",
          "intentSha256",
          "operationId",
          "productionStageAuthorityId",
        ]) ||
        prepared.operationId !== command ||
        prepared.checkpoint !== checkpoint ||
        !HASH.test(prepared.intentSha256 ?? "") ||
        typeof prepared.productionStageAuthorityId !== "string"
      )
        fail("ACCEPTANCE_AUTHORITY_PREPARATION_RESULT");
      return Object.freeze(prepared);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("V2_13_FULL_LIVE_ADAPTER_"))
        throw error;
      fail("ACCEPTANCE_AUTHORITY_PREPARATION_REJECTED");
    } finally {
      await close();
    }
  };
  const adapter = async (
    operation = {},
    state = {},
    priorResults = new Map(),
    outerStateSha256,
  ) => {
    const bound =
      staticDatabase ??
      (await databaseFactory({ operation, state, priorResults, outerStateSha256 }));
    const rawDatabase = bound?.database ?? bound;
    if (
      rawDatabase === null ||
      typeof rawDatabase !== "object" ||
      typeof rawDatabase.query !== "function"
    )
      fail("WORKFLOW_AUTHORITY_DATABASE_REQUIRED");
    const close = typeof bound?.close === "function" ? bound.close : async () => {};
    const db = createPromotionDatabaseAdapter(rawDatabase);
    try {
      if (typeof producer !== "function" && typeof materialize !== "function")
        fail("WORKFLOW_AUTHORITY_MATERIALIZER_REQUIRED");
      const materializeContext = {
        operation,
        state,
        priorResults,
        outerStateSha256,
        database: rawDatabase,
        databaseBinding: bound,
      };
      const materialized = exactPostConsumptionWorkflowMaterialization(
        await (typeof producer === "function"
          ? producer(materializeContext)
          : materialize(materializeContext)),
        state,
        outerStateSha256,
      );
      const supplied = materialized.workflowStartAuthority;
      const authority = await db.recordWorkflowStartAuthority(supplied);
      if (
        authority === null ||
        typeof authority !== "object" ||
        Array.isArray(authority) ||
        JSON.stringify(Object.keys(authority).sort()) !==
          JSON.stringify(["authorityId", "expiresAt", "tokenSha256"].sort()) ||
        authority.authorityId !== supplied.workflowAuthorityId ||
        authority.tokenSha256 !== supplied.tokenSha256 ||
        typeof authority.expiresAt !== "string" ||
        Number.isNaN(Date.parse(authority.expiresAt))
      )
        fail("WORKFLOW_AUTHORITY_RESULT");
      return Object.freeze({ actualUsd: 0, ...authority });
    } finally {
      await close();
    }
  };
  // The property is intentionally attached to the operation adapter rather than exported as a
  // free-standing DB client. The concrete composition passes it to the acceptance bridge so a
  // child authority can only be minted with the same protected database binding.
  adapter.prepareAcceptanceAuthority = prepareAcceptanceAuthority;
  return adapter;
}

function createProtectedWorkflowStartAuthorityAdapter({
  environment = process.env,
  databaseFactory,
  materialize,
  producer,
  postConsumptionProducer,
  handshake,
  selection,
  issueChallenge,
  loadFacts,
  readback,
} = {}) {
  const protectedProducer =
    producer ??
    postConsumptionProducer ??
    (materialize === undefined
      ? createPostConsumptionMaterializationProducer({
          environment,
          handshake,
          selection,
          issueChallenge,
          loadFacts,
          readback,
        })
      : undefined);
  return createWorkflowStartAuthorityAdapter({
    materialize,
    producer: protectedProducer,
    databaseFactory:
      databaseFactory ??
      (async () => {
        const directory = environment.VIDEOFORGE_V2_13_POSTGRES_INPUT_DIR;
        const service = ownerServiceEndpoint(directory, "WORKFLOW_AUTHORITY_OWNER_SERVICE");
        const path =
          environment.VIDEOFORGE_V2_13_OPERATOR_DATABASE_URL_FILE ??
          resolve(directory, "operator.database-url");
        const databaseUrl = readFileSync(
          protectedFile(path, "WORKFLOW_AUTHORITY_DATABASE_URL"),
          "utf8",
        );
        parseExactOperatorDatabaseUrl(
          databaseUrl,
          { host: service.host, database: service.dbname },
          "WORKFLOW_AUTHORITY_DATABASE_URL",
        );
        const { Pool } = requireWeb("@neondatabase/serverless");
        const pool = new Pool({ connectionString: databaseUrl, max: 1 });
        const database = { query: (sql, parameters) => pool.query(sql, parameters) };
        return {
          database,
          // The app writes authenticated selections through its route; the operator only polls
          // this DB-owned projection and signs it with the protected bearer. Keeping this method
          // on the concrete binding makes the default path usable without an injected callback.
          postConsumptionHandshake: (challenge) =>
            createDatabasePostConsumptionHandshake({ database, environment })(challenge),
          close: () => pool.end(),
        };
      }),
  });
}

function createProtectedInputMaterializer({
  environment = process.env,
  run = productionCommand,
  readMediaWorkerRelease = readMediaWorkerReleaseReadback,
  validateProduction = loadBridgeProductionInput,
  validateGuarded = preflightGuardedActivationInputs,
  validatePromotion = preflightPromotionInputs,
  renderDisabledConfig,
} = {}) {
  const seedPath = () =>
    protectedFile(
      environment.VIDEOFORGE_V2_13_MATERIALIZATION_SEED_FILE,
      "MATERIALIZATION_SEED_FILE",
    );
  const seed = (state) => {
    let value;
    try {
      value = JSON.parse(readFileSync(seedPath(), "utf8"));
    } catch {
      fail("MATERIALIZATION_SEED_JSON");
    }
    // Keep the first-use materializer on the exact same nested contract as outer authority
    // consumption; this shared predicate is the single seed-shape boundary.
    if (!validateMaterializationSeedShape(value)) fail("MATERIALIZATION_SEED_CONTRACT");
    const seedSha256 = sha256(Buffer.from(`${canonicalJson(value)}\n`));
    if (
      !UUID.test(state?.full_live_authority_id ?? "") ||
      value.production_input_base.fullLiveAuthorityId !== state.full_live_authority_id ||
      !HASH.test(state?.materialization_seed_sha256 ?? "") ||
      state.materialization_seed_sha256 !== seedSha256
    )
      fail("MATERIALIZATION_SEED_OUTER_BINDING");
    return value;
  };
  const writeJson = (path, value) => {
    const bytes = Buffer.from(`${canonicalJson(value)}\n`);
    exclusiveAtomicBytes(path, bytes);
    return sha256(bytes);
  };
  const authorityDocument = (source, state) => ({
    ...source.production_input_base.authorityDocument,
    authorityId: state.authority_id,
    proposalSha256: state.proposal_sha256,
    approvalSha256: state.approval_sha256,
    proposalCommit: state.proposal_record_commit,
    sourceCommit: state.release_source_commit,
    executorSha256: state.full_live_executor_sha256,
    approvedAt: state.approved_at,
    expiresAt: state.expires_at,
    maximumCumulativeSpendUsd: 17.5,
    singleUse: true,
  });
  const dynamicDualLaneInput = (source, billingBaselineUsd) => {
    const value = structuredClone(source.production_input_base.dualLaneInput);
    const descriptor = value.qualificationCaseDescriptor;
    value.qualificationGeneratorSha256 = canonicalSha256(descriptor.generators);
    value.qualificationSourceRefs = {
      caseSource: descriptor.caseSource,
      generators: descriptor.generators,
      validators: descriptor.validators,
    };
    value.qualificationProtectedInputDescriptors = descriptor.protectedInputs;
    value.qualificationCaseDescriptors = [
      "mage",
      "soulx2s",
      "soulx4s",
      "soulx6s",
      "soulx10s",
      "soulxCancel",
      "soulxInvalidOutput",
      "soulxTimeout",
    ].map((key) => ({ key, ...descriptor.cases[key] }));
    value.qualificationR2 = {
      accountId: source.activation_record_base.cloudflare.account_id,
      bucketName: source.activation_record_base.cloudflare.r2_bucket_name,
    };
    value.billingBaselineUsd = billingBaselineUsd;
    delete value.qualificationCaseDescriptor;
    return value;
  };
  const record = ({ stage, state, outerStateSha256, inputs, outputs }) => {
    const chainPath = environment.VIDEOFORGE_V2_13_MATERIALIZATION_CHAIN_FILE;
    if (typeof chainPath !== "string" || chainPath === "" || chainPath.includes("\0"))
      fail("MATERIALIZATION_CHAIN_PATH");
    atomicChainUpdate(chainPath, {
      kind: stage,
      authority_id: state.authority_id,
      outer_state_sha256: outerStateSha256,
      ordered_prior_operation_evidence_sha256s: Object.entries(inputs),
      ordered_output_sha256s: Object.entries(outputs),
    });
  };
  return async ({ operationId, state, priorResults, outerStateSha256 }) => {
    if (!HASH.test(outerStateSha256 ?? "")) fail("MATERIALIZATION_OUTER_STATE");
    if (
      [
        "restore-endpoints-max-one",
        "prove-zero-workers",
        "read-settled-billing",
        "reconcile-exact-resources",
      ].includes(operationId) &&
      !lstatExists(environment.VIDEOFORGE_V2_13_CLEANUP_INPUT_FILE)
    ) {
      const source = seed(state);
      const preflight = priorResults.get("fresh-live-preflight");
      const noRunPodMutationReceipts = [
        "mage-live-qualification",
        "soulx-live-qualification",
        "create-exact-max-one-endpoints",
      ].every((id) => !priorResults.has(id));
      const billingBaselineUsd = preflight?.bridgeSummary?.admission?.cumulativeBillingUsd ?? null;
      if (
        (billingBaselineUsd === null && !noRunPodMutationReceipts) ||
        (billingBaselineUsd !== null &&
          (!Number.isFinite(billingBaselineUsd) || billingBaselineUsd < 0))
      )
        fail("MATERIALIZATION_CLEANUP_BILLING_BASELINE");
      const cleanup = {
        schemaVersion: "videoforge.v213-full-live-cleanup-input/v1",
        fullLiveAuthorityId: source.production_input_base.fullLiveAuthorityId,
        billingBaselineMode:
          billingBaselineUsd === null
            ? "ESTABLISH_CURRENT_NO_RUNPOD_MUTATION"
            : "PRIOR_FRESH_PREFLIGHT",
        billingBaselineUsd,
        totalCapUsd: 17.5,
        retainedLanes: ["mage", "soulx"].map((lane) => ({
          lane,
          volumeIdSha256: source.production_input_base.dualLaneInput[lane].volumeIdSha256,
          volumeManifestSha256:
            source.production_input_base.dualLaneInput[lane].volumeManifestSha256,
        })),
      };
      const output = writeJson(environment.VIDEOFORGE_V2_13_CLEANUP_INPUT_FILE, cleanup);
      record({
        stage: "cleanup-pre-endpoint-descriptor",
        state,
        outerStateSha256,
        inputs: {},
        outputs: { cleanup_input_sha256: output },
      });
    }
    if (operationId === "fresh-live-preflight") {
      // The read-only child consumes a descriptor-only projection of the seed. The full
      // production input cannot exist until Mage has fresh image and billing receipts.
      seed(state);
      const descriptor = loadBridgePrequalificationInput(environment, state, outerStateSha256);
      const descriptorSha256 = sha256(Buffer.from(`${canonicalJson(descriptor)}\n`));
      record({
        stage: "prequalification-descriptor",
        state,
        outerStateSha256,
        inputs: { materialization_seed: state.materialization_seed_sha256 },
        outputs: { prequalification_descriptor_sha256: descriptorSha256 },
      });
      return;
    }
    if (operationId === "mage-live-qualification") {
      const source = seed(state);
      const mage = exactReceipt(priorResults, "mage-image-workflow-verification");
      const soulx = exactReceipt(priorResults, "soulx-image-workflow-verification");
      const preflight = priorResults.get("fresh-live-preflight");
      const billingBaselineUsd = preflight?.bridgeSummary?.admission?.cumulativeBillingUsd;
      if (!Number.isFinite(billingBaselineUsd) || billingBaselineUsd < 0)
        fail("MATERIALIZATION_FRESH_BILLING_BASELINE");
      verifyMaterializationChainFile({
        environment,
        operation: "fresh-live-preflight",
        state,
      });
      const production = structuredClone(source.production_input_base);
      production.authorityDocument = authorityDocument(source, state);
      production.dualLaneInput = dynamicDualLaneInput(source, billingBaselineUsd);
      for (const [lane, receipt, repository] of [
        ["mage", mage, "pala-lakshmansai/videoforge-mage-v2-07"],
        ["soulx", soulx, "pala-lakshmansai/videoforge-soulx-serverless-v2-08"],
      ]) {
        production.dualLaneInput[lane].sourceCommit = state.release_source_commit;
        production.dualLaneInput[lane].publicImage = `ghcr.io/${repository}@${receipt.imageDigest}`;
        production.dualLaneInput[lane].deploymentSha256 = receipt.evidenceSha256;
      }
      const output = writeJson(environment.VIDEOFORGE_V2_13_PRODUCTION_INPUT_FILE, production);
      validateProduction(environment);
      record({
        stage: "production-input",
        state,
        outerStateSha256,
        inputs: {
          mage_image: mage.evidenceSha256,
          soulx_image: soulx.evidenceSha256,
          fresh_preflight: preflight.evidenceSha256,
        },
        outputs: { production_input_sha256: output },
      });
      return;
    }
    if (operationId === "guarded-activation-once") {
      const source = seed(state);
      const bootstrap = priorResults.get("bootstrap-prequalification-database");
      if (
        bootstrap?.schema_version !== PREQUALIFICATION_SCHEMA ||
        bootstrap.full_live_authority_id !== state.full_live_authority_id ||
        !HASH.test(bootstrap.operator_database_url_sha256 ?? "") ||
        !HASH.test(bootstrap.runtime_database_url_sha256 ?? "") ||
        !HASH.test(bootstrap.reconciler_database_url_sha256 ?? "") ||
        !HASH.test(bootstrap.database_role_credential_bundle_sha256 ?? "") ||
        bootstrap.credential_bootstrap_receipt_sha256 !== CREDENTIAL_BOOTSTRAP_RECEIPT_SHA256 ||
        !HASH.test(bootstrap.production_secret_bootstrap_sha256 ?? "") ||
        !HASH.test(bootstrap.production_secrets_sha256 ?? "") ||
        !HASH.test(bootstrap.materialization_seed_sha256 ?? "") ||
        bootstrap.materialization_seed_sha256 !== state.materialization_seed_sha256 ||
        !HASH.test(bootstrap.prequalification_database_bootstrap_sha256 ?? "")
      )
        fail("MATERIALIZATION_DATABASE_CREDENTIAL_RECEIPT");
      const mage = exactReceipt(priorResults, "mage-live-qualification");
      const soulx = exactReceipt(priorResults, "soulx-live-qualification");
      const endpoints = exactReceipt(priorResults, "create-exact-max-one-endpoints");
      const mageProduction = endpoints.materialization?.production?.mage;
      const soulxProduction = endpoints.materialization?.production?.soulx;
      if (
        !HASH.test(mageProduction?.deploymentSnapshotSha256 ?? "") ||
        !HASH.test(soulxProduction?.deploymentSnapshotSha256 ?? "") ||
        sha256(Buffer.from(mageProduction?.endpointId ?? "")) !==
          mageProduction?.endpointIdSha256 ||
        sha256(Buffer.from(soulxProduction?.endpointId ?? "")) !==
          soulxProduction?.endpointIdSha256 ||
        mageProduction.endpointId === soulxProduction.endpointId
      )
        fail("MATERIALIZATION_MAX_ONE_ENDPOINT_BINDINGS");
      if (typeof readMediaWorkerRelease !== "function")
        fail("MEDIA_WORKER_RELEASE_READBACK_UNAVAILABLE");
      const releaseReadback = exactMediaWorkerReleaseReadback(
        await readMediaWorkerRelease({
          parentOperationId: operationId,
          state,
          priorResults,
          outerStateSha256,
        }),
        state,
        outerStateSha256,
      );
      record({
        stage: "media-worker-release-readback",
        state,
        outerStateSha256,
        inputs: {
          prequalification_database_bootstrap: bootstrap.prequalification_database_bootstrap_sha256,
        },
        outputs: {
          media_worker_release_manifest_asset_sha256: releaseReadback.manifestSha256,
          media_worker_release_readback_sha256: releaseReadback.reconciliationSha256,
        },
      });
      const preEndpointSecrets = loadBridgeProductionSecrets(environment, {
        requireEndpoints: false,
        allowEither: true,
      });
      const productionSecrets = {
        ...preEndpointSecrets.value,
        schemaVersion: "videoforge.v213-full-live-production-secrets/v1",
        mageEndpointId: mageProduction.endpointId,
        soulxEndpointId: soulxProduction.endpointId,
      };
      const productionSecretsBytes = Buffer.from(`${canonicalJson(productionSecrets)}\n`);
      if (
        preEndpointSecrets.hasEndpoints &&
        sha256(Buffer.from(preEndpointSecrets.raw)) !== sha256(productionSecretsBytes)
      )
        fail("MATERIALIZATION_ENDPOINT_BINDING_DRIFT");
      atomicExactTransition(
        environment.VIDEOFORGE_V2_13_PRODUCTION_SECRETS_FILE,
        Buffer.from(preEndpointSecrets.raw),
        productionSecretsBytes,
      );
      loadBridgeProductionSecrets(environment, { requireEndpoints: true });
      const secretDirectory = protectedDirectory(
        environment.VIDEOFORGE_V2_13_SECRET_INPUT_DIR,
        "MATERIALIZATION_SECRET_INPUT_DIRECTORY",
      );
      const endpointSecrets = Object.freeze({
        VIDEOFORGE_MAGE_ENDPOINT_ID: mageProduction.endpointId,
        VIDEOFORGE_MAGE_ENDPOINT_ID_SHA256: mageProduction.endpointIdSha256,
        VIDEOFORGE_SOULX_ENDPOINT_ID: soulxProduction.endpointId,
        VIDEOFORGE_SOULX_ENDPOINT_ID_SHA256: soulxProduction.endpointIdSha256,
      });
      const existingSecretNames = readdirSync(secretDirectory).sort();
      if (
        existingSecretNames.some((name) => !GUARDED_SECRET_NAMES.includes(name)) ||
        GUARDED_SECRET_NAMES.filter((name) => !(name in endpointSecrets)).some(
          (name) => !existingSecretNames.includes(name),
        )
      )
        fail("MATERIALIZATION_SECRET_INPUT_ALLOWLIST");
      for (const [name, value] of Object.entries(endpointSecrets))
        exclusiveAtomicBytes(join(secretDirectory, name), Buffer.from(value));
      if (
        JSON.stringify(readdirSync(secretDirectory).sort()) !==
        JSON.stringify([...GUARDED_SECRET_NAMES].sort())
      )
        fail("MATERIALIZATION_SECRET_INPUT_ALLOWLIST");
      const secretSha256 = Object.fromEntries(
        GUARDED_SECRET_NAMES.map((name) => {
          const value = readFileSync(
            protectedFile(join(secretDirectory, name), "MATERIALIZATION_SECRET_INPUT_FILE"),
          );
          if (value.length === 0 || value.includes(0)) fail("MATERIALIZATION_SECRET_INPUT_FILE");
          return [name, sha256(value)];
        }),
      );
      const operatorDatabaseUrlSha256 = sha256(
        readFileSync(
          protectedFile(
            join(
              protectedDirectory(
                environment.VIDEOFORGE_V2_13_POSTGRES_INPUT_DIR,
                "MATERIALIZATION_POSTGRES_INPUT_DIRECTORY",
              ),
              "operator.database-url",
            ),
            "MATERIALIZATION_OPERATOR_DATABASE_URL",
          ),
        ),
      );
      if (
        operatorDatabaseUrlSha256 !== bootstrap.operator_database_url_sha256 ||
        secretSha256.DATABASE_URL !== bootstrap.runtime_database_url_sha256 ||
        secretSha256.VIDEOFORGE_RECONCILER_DATABASE_URL !== bootstrap.reconciler_database_url_sha256
      )
        fail("MATERIALIZATION_DATABASE_CREDENTIAL_BINDING");
      record({
        stage: "max-one-endpoint-bindings",
        state,
        outerStateSha256,
        inputs: { "create-exact-max-one-endpoints": endpoints.evidenceSha256 },
        outputs: {
          production_secrets_sha256: sha256(productionSecretsBytes),
          mage_deployment_snapshot_sha256: mageProduction.deploymentSnapshotSha256,
          soulx_deployment_snapshot_sha256: soulxProduction.deploymentSnapshotSha256,
          mage_endpoint_secret_sha256: secretSha256.VIDEOFORGE_MAGE_ENDPOINT_ID,
          mage_endpoint_hash_secret_sha256: secretSha256.VIDEOFORGE_MAGE_ENDPOINT_ID_SHA256,
          soulx_endpoint_secret_sha256: secretSha256.VIDEOFORGE_SOULX_ENDPOINT_ID,
          soulx_endpoint_hash_secret_sha256: secretSha256.VIDEOFORGE_SOULX_ENDPOINT_ID_SHA256,
        },
      });
      const manifestSha256 = writeJson(
        environment.VIDEOFORGE_V2_13_RELEASE_MANIFEST_FILE,
        releaseReadback.manifest,
      );
      const config = structuredClone(source.config_activation_base);
      config.authority.approved_at = state.approved_at;
      config.release.commit = state.release_source_commit;
      config.release.media_worker_release_manifest_sha256 = manifestSha256;
      const configSha256 = writeJson(environment.VIDEOFORGE_V2_13_CONFIG_ACTIVATION_RECORD, config);
      let renderedBytes;
      if (typeof renderDisabledConfig === "function") {
        renderedBytes = renderDisabledConfig({ environment, state });
      } else {
        const renderedDirectory = mkdtempSync(
          resolve(tmpdir(), "videoforge-v213-materialized-config-"),
        );
        try {
          const rendered = resolve(renderedDirectory, "disabled.json");
          exactCommand(run, process.execPath, [
            "deploy/v2-13/render-production-config.mjs",
            "--activate",
            "--activation-record",
            environment.VIDEOFORGE_V2_13_CONFIG_ACTIVATION_RECORD,
            "--release-manifest-file",
            environment.VIDEOFORGE_V2_13_RELEASE_MANIFEST_FILE,
            "--output",
            rendered,
          ]);
          renderedBytes = readFileSync(rendered);
        } finally {
          rmSync(renderedDirectory, { recursive: true, force: true });
        }
      }
      if (!Buffer.isBuffer(renderedBytes)) fail("MATERIALIZATION_DISABLED_CONFIG_BYTES");
      exclusiveAtomicBytes(environment.VIDEOFORGE_V2_13_DISABLED_CONFIG_FILE, renderedBytes);
      const activation = structuredClone(source.activation_record_base);
      activation.full_live_authority_id = state.full_live_authority_id;
      activation.database.operator_database_url_sha256 = operatorDatabaseUrlSha256;
      activation.secret_sha256 = secretSha256;
      Object.assign(activation.authority, {
        mode: "APPROVED_EXECUTE",
        authority_id: state.authority_id,
        proposal_sha256: state.proposal_sha256,
        approval_sha256: state.approval_sha256,
        approval_path: state.approval_record_path,
        approved_at: state.approved_at,
        expires_at: state.expires_at,
        execute_authorized: true,
        credential_access_authorized: true,
        database_mutation_authorized: true,
        cloudflare_secret_mutation_authorized: true,
        deployment_authorized: true,
        provider_calls_authorized: true,
      });
      Object.assign(activation.release, {
        commit: state.release_source_commit,
        migration_manifest_sha256: PREQUALIFICATION_MIGRATION_MANIFEST_SHA256,
        operator_grants_sha256: PREQUALIFICATION_OPERATOR_GRANTS_SHA256,
        production_config_activation_sha256: configSha256,
        media_worker_release_manifest_sha256: manifestSha256,
      });
      Object.assign(activation.gates, {
        mage_qualification_sha256: mage.evidenceSha256,
        soulx_qualification_sha256: soulx.evidenceSha256,
        mage_deployment_snapshot_sha256: mageProduction.deploymentSnapshotSha256,
        soulx_deployment_snapshot_sha256: soulxProduction.deploymentSnapshotSha256,
        paid_dispatch_authority_sha256: endpoints.evidenceSha256,
      });
      const activationSha256 = writeJson(
        environment.VIDEOFORGE_V2_13_ACTIVATION_RECORD,
        activation,
      );
      validateGuarded({ environment, state });
      record({
        stage: "activation-record",
        state,
        outerStateSha256,
        inputs: {
          mage_qualification: mage.evidenceSha256,
          media_worker_release_readback: releaseReadback.reconciliationSha256,
          soulx_qualification: soulx.evidenceSha256,
          max_one_endpoints: endpoints.evidenceSha256,
        },
        outputs: {
          activation_record_sha256: activationSha256,
          config_activation_sha256: configSha256,
          disabled_config_sha256: sha256(
            readFileSync(environment.VIDEOFORGE_V2_13_DISABLED_CONFIG_FILE),
          ),
          release_manifest_sha256: manifestSha256,
        },
      });
      return Object.freeze({
        mediaWorkerReleaseManifestAssetSha256: releaseReadback.manifestSha256,
        mediaWorkerReleaseManifestFileSha256: manifestSha256,
        mediaWorkerReleaseReadbackSha256: releaseReadback.reconciliationSha256,
      });
    }
    if (operationId === "promote-qualified-production") {
      const source = seed(state);
      const mage = exactReceipt(priorResults, "mage-live-qualification");
      const soulx = exactReceipt(priorResults, "soulx-live-qualification");
      const guarded = exactReceipt(priorResults, "guarded-activation-once");
      const endpoints = exactReceipt(priorResults, "create-exact-max-one-endpoints");
      const mageProduction = endpoints.materialization?.production?.mage;
      const soulxProduction = endpoints.materialization?.production?.soulx;
      if (
        !HASH.test(mageProduction?.deploymentSnapshotSha256 ?? "") ||
        !HASH.test(soulxProduction?.deploymentSnapshotSha256 ?? "")
      )
        fail("MATERIALIZATION_MAX_ONE_ENDPOINT_BINDINGS");
      const production = validateProduction(environment);
      const disabledBytes = readFileSync(
        protectedFile(
          environment.VIDEOFORGE_V2_13_DISABLED_CONFIG_FILE,
          "MATERIALIZATION_DISABLED_CONFIG",
        ),
      );
      const enabled = JSON.parse(disabledBytes);
      enabled.vars.VIDEOFORGE_GPU_TRANSPORT = "QUALIFIED_EXACT";
      const enabledBytes = Buffer.from(`${JSON.stringify(enabled, null, 2)}\n`);
      const promotion = structuredClone(source.promotion_record_base);
      Object.assign(promotion.release, {
        commit: state.release_source_commit,
        disabled_config_sha256: sha256(disabledBytes),
        enabled_config_sha256: sha256(enabledBytes),
      });
      Object.assign(promotion.approval, {
        authority_id: state.authority_id,
        proposal_sha256: state.proposal_sha256,
        approval_sha256: state.approval_sha256,
        approved_at: state.approved_at,
        expires_at: state.expires_at,
        single_use: true,
      });
      Object.assign(promotion.database, {
        full_live_authority_id: production.fullLiveAuthorityId,
        authority_document_sha256: sha256(
          Buffer.from(`${canonicalJson(production.authorityDocument)}\n`),
        ),
        executor_sha256: state.full_live_executor_sha256,
        paid_approval_sha256: state.approval_sha256,
      });
      Object.assign(promotion.lanes.mage_image, {
        qualification_record_sha256: mage.evidenceSha256,
        deployment_snapshot_sha256: mageProduction.deploymentSnapshotSha256,
      });
      Object.assign(promotion.lanes.soulx_avatar, {
        qualification_record_sha256: soulx.evidenceSha256,
        deployment_snapshot_sha256: soulxProduction.deploymentSnapshotSha256,
      });
      Object.assign(promotion.cloudflare, {
        disabled_version_id: guarded.materialization?.disabledVersionId,
        disabled_version_sha256: guarded.materialization?.disabledVersionSha256,
      });
      const promotionSha256 = writeJson(
        environment.VIDEOFORGE_V2_13_PROMOTION_RECORD_FILE,
        promotion,
      );
      validatePromotion({ environment, state });
      record({
        stage: "promotion-record",
        state,
        outerStateSha256,
        inputs: {
          mage_qualification: mage.evidenceSha256,
          soulx_qualification: soulx.evidenceSha256,
          max_one_endpoints: endpoints.evidenceSha256,
          guarded_activation: guarded.evidenceSha256,
        },
        outputs: { promotion_record_sha256: promotionSha256 },
      });
    }
  };
}

function bridgeChildTimeoutMs(state, context, command) {
  const cleanup =
    context?.cleanupOnly === true ||
    context?.earlyFailure === true ||
    [
      "restore-endpoints-max-one",
      "prove-zero-workers",
      "read-settled-billing",
      "reconcile-exact-resources",
    ].includes(command);
  const expiresAt = Date.parse(state?.expires_at ?? "");
  const maximum = cleanup ? BRIDGE_CLEANUP_CHILD_MAX_TIMEOUT_MS : BRIDGE_CHILD_MAX_TIMEOUT_MS;
  if (cleanup) {
    // Cleanup is allowed to finish after authority expiry, but it is still bounded.  While the
    // authority is live we cannot let the child outlast the authority; after expiry use the
    // bounded cleanup window rather than silently granting an unbounded process lifetime.
    const remaining = Number.isNaN(expiresAt) ? maximum : expiresAt - Date.now();
    return Math.max(1, Math.min(maximum, remaining > 0 ? remaining : maximum));
  }
  if (Number.isNaN(expiresAt) || expiresAt <= Date.now()) fail("BRIDGE_AUTHORITY_EXPIRED");
  return Math.max(1, Math.min(maximum, expiresAt - Date.now()));
}

/**
 * Resolve the only executable and TypeScript loader accepted by the bridge children.  The
 * previous pnpm wrapper changed the package cwd before launching the relative bridge path and
 * did not reliably carry arbitrary descriptor entries through its second process.  A direct Node
 * launch keeps the source path absolute and lets Node inherit the exact descriptor array below.
 * The loader is pinned both by its pnpm lockfile path/version and by the installed bytes; the
 * bridge source itself is checked against BRIDGE_CLI_SOURCE_SHA256 by each adapter factory.
 */
function resolveSourceBoundBridgeLaunch({
  root = ROOT,
  nodeExecutable = process.execPath,
  bridgePath = resolve(root, BRIDGE_PATH),
  loaderPath = resolve(root, BRIDGE_LOADER_PATH),
} = {}) {
  const repositoryRoot = resolve(root);
  const expectedBridgePath = resolve(repositoryRoot, BRIDGE_PATH);
  const expectedLoaderPath = resolve(repositoryRoot, BRIDGE_LOADER_PACKAGE_PATH);
  if (
    typeof nodeExecutable !== "string" ||
    nodeExecutable.length === 0 ||
    !nodeExecutable.startsWith("/") ||
    typeof bridgePath !== "string" ||
    !bridgePath.startsWith("/") ||
    typeof loaderPath !== "string" ||
    !loaderPath.startsWith("/")
  )
    fail("BRIDGE_LAUNCH_PATH_INVALID");

  let canonicalNodePath;
  let canonicalBridgePath;
  let canonicalLoaderPath;
  try {
    canonicalNodePath = realpathSync(nodeExecutable);
    canonicalBridgePath = realpathSync(bridgePath);
    canonicalLoaderPath = realpathSync(loaderPath);
  } catch {
    fail("BRIDGE_LAUNCH_PATH_INVALID");
  }
  if (
    canonicalNodePath !== nodeExecutable ||
    canonicalBridgePath !== expectedBridgePath ||
    canonicalLoaderPath !== expectedLoaderPath
  )
    fail("BRIDGE_LAUNCH_PATH_INVALID");

  let nodeMetadata;
  let bridgeBytes;
  let loaderBytes;
  try {
    nodeMetadata = lstatSync(canonicalNodePath);
    bridgeBytes = readFileSync(canonicalBridgePath);
    loaderBytes = readFileSync(canonicalLoaderPath);
    if (!nodeMetadata.isFile() || (nodeMetadata.mode & 0o111) === 0)
      fail("BRIDGE_EXECUTABLE_INVALID");
  } catch (error) {
    if (error instanceof Error && error.message === "BRIDGE_EXECUTABLE_INVALID") throw error;
    fail("BRIDGE_LAUNCH_PATH_INVALID");
  }
  if (sha256(loaderBytes) !== BRIDGE_LOADER_SOURCE_SHA256) fail("BRIDGE_LOADER_SOURCE_DRIFT");
  if (sha256(bridgeBytes) !== BRIDGE_CLI_SOURCE_SHA256) fail("BRIDGE_SOURCE_DRIFT");
  return Object.freeze({
    nodeExecutable: canonicalNodePath,
    bridgePath: canonicalBridgePath,
    loaderPath: canonicalLoaderPath,
  });
}

async function spawnSourceBoundBridgeChild({
  args,
  timeoutMs,
  stdio,
  childEnvironment,
  timeoutCode,
  executionCode,
  cancellationSignal,
}) {
  const launch = resolveSourceBoundBridgeLaunch();
  const result = await runCancellableChildProcess({
    command: launch.nodeExecutable,
    args: ["--import", launch.loaderPath, launch.bridgePath, ...args],
    options: {
      cwd: ROOT,
      encoding: "utf8",
      env: childEnvironment,
      stdio,
      maxBuffer: 4 * 1024 * 1024,
    },
    timeoutMs,
    cancellationSignal,
    timeoutCode,
    cancellationCode: "BRIDGE_CHILD_CANCELLED",
    executionCode,
  });
  if (result.status !== 0 || typeof result.stdout !== "string") fail(executionCode);
  return JSON.parse(result.stdout);
}

async function productionBridgeSpawn({
  environment,
  request,
  timeoutMs = BRIDGE_CHILD_MAX_TIMEOUT_MS,
  cancellationSignal,
}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > BRIDGE_CHILD_MAX_TIMEOUT_MS)
    fail("BRIDGE_CHILD_TIMEOUT_INVALID");
  const directory = mkdtempSync(resolve(tmpdir(), "videoforge-v213-bridge-"));
  const requestPath = resolve(directory, "request.json");
  const opened = [];
  try {
    writeFileSync(requestPath, `${JSON.stringify(request)}\n`, { encoding: "utf8", mode: 0o600 });
    const earlyCleanup = request.input?.schemaVersion === EARLY_CLEANUP_INPUT_SCHEMA;
    const qualification = ["mage-live-qualification", "soulx-live-qualification"].includes(
      request.command,
    );
    const protectedFiles = earlyCleanup
      ? BRIDGE_PROTECTED_FILES.filter(([fdName]) => fdName === "RUNPOD_API_KEY_FD")
      : request.command === "fresh-live-preflight"
        ? BRIDGE_PROTECTED_FILES.filter(([fdName]) =>
            ["RUNPOD_API_KEY_FD", "OPERATOR_DATABASE_URL_FD"].includes(fdName),
          )
        : CLEANUP_BRIDGE_COMMANDS.has(request.command)
          ? BRIDGE_PROTECTED_FILES.filter(([fdName]) =>
              ["RUNPOD_API_KEY_FD", "OPERATOR_DATABASE_URL_FD"].includes(fdName),
            )
          : BRIDGE_PROTECTED_FILES;
    const qualificationFiles = [];
    if (qualification) {
      const binding = request.input?.dualLaneInput?.qualificationR2;
      if (
        !exactObjectKeys(binding, ["accountId", "bucketName"]) ||
        !/^[0-9a-f]{32}$/u.test(binding.accountId ?? "") ||
        !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(binding.bucketName ?? "")
      )
        fail("QUALIFICATION_R2_BINDING");
      const accountPath = resolve(directory, "r2-account-id");
      const bucketPath = resolve(directory, "r2-bucket-name");
      writeFileSync(accountPath, binding.accountId, { encoding: "utf8", mode: 0o600, flag: "wx" });
      writeFileSync(bucketPath, binding.bucketName, { encoding: "utf8", mode: 0o600, flag: "wx" });
      const secretDirectory = protectedCanonicalDirectory(
        environment.VIDEOFORGE_V2_13_SECRET_INPUT_DIR,
        "QUALIFICATION_SECRET_INPUT_DIRECTORY",
      );
      qualificationFiles.push(
        ["QUALIFICATION_R2_ACCOUNT_ID_FD", accountPath],
        [
          "QUALIFICATION_R2_ACCESS_KEY_ID_FD",
          protectedSingleLinkFile(
            join(secretDirectory, "R2_ACCESS_KEY_ID"),
            "QUALIFICATION_R2_ACCESS_KEY_ID",
          ),
        ],
        [
          "QUALIFICATION_R2_SECRET_ACCESS_KEY_FD",
          protectedSingleLinkFile(
            join(secretDirectory, "R2_SECRET_ACCESS_KEY"),
            "QUALIFICATION_R2_SECRET_ACCESS_KEY",
          ),
        ],
        ["QUALIFICATION_R2_BUCKET_NAME_FD", bucketPath],
      );
      if (request.command === "soulx-live-qualification") {
        const inputs = qualificationProtectedInputFiles(
          request.input?.dualLaneInput?.qualificationProtectedInputDescriptors,
        );
        qualificationFiles.push(
          ["QUALIFICATION_AVATAR_SOURCE_FD", inputs.avatarSource],
          ["QUALIFICATION_AUDIO_2S_FD", inputs.soulx2s],
          ["QUALIFICATION_AUDIO_4S_FD", inputs.soulx4s],
          ["QUALIFICATION_AUDIO_6S_FD", inputs.soulx6s],
          ["QUALIFICATION_AUDIO_10S_FD", inputs.soulx10s],
        );
      }
    }
    const files = [
      ["REQUEST_FD", requestPath],
      ...protectedFiles.map(([fdName, variable]) => [
        fdName,
        protectedFile(environment[variable], `BRIDGE_PROTECTED_FILE:${variable}`),
      ]),
      ...qualificationFiles,
    ];
    for (const [, path] of files) opened.push(openSync(path, "r"));
    const childEnvironment = {
      PATH: environment.PATH ?? process.env.PATH,
      VIDEOFORGE_V213_BRIDGE_COMMAND: request.command,
    };
    files.forEach(([name], index) => {
      childEnvironment[`VIDEOFORGE_V213_BRIDGE_${name}`] = String(index + 3);
    });
    return await spawnSourceBoundBridgeChild({
      args: ["--execute", BRIDGE_CONFIRMATION],
      timeoutMs,
      stdio: ["ignore", "pipe", "pipe", ...opened],
      childEnvironment,
      timeoutCode: "BRIDGE_CHILD_TIMEOUT",
      executionCode: "BRIDGE_EXECUTION",
      cancellationSignal,
    });
  } finally {
    for (const fd of opened) closeSync(fd);
    rmSync(directory, { recursive: true, force: true });
  }
}

/** Separate zero-provider child. The FD allowlist is intentionally limited to the exact request,
 * operator database URL, and existing acceptance-evidence key container. */
async function productionReleaseCertificationSpawn({
  environment,
  request,
  timeoutMs = RELEASE_CERTIFICATION_CHILD_MAX_TIMEOUT_MS,
  cancellationSignal,
}) {
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > RELEASE_CERTIFICATION_CHILD_MAX_TIMEOUT_MS
  )
    fail("RELEASE_CERTIFICATION_CHILD_TIMEOUT_INVALID");
  const directory = mkdtempSync(resolve(tmpdir(), "videoforge-v213-certification-"));
  const requestPath = resolve(directory, "request.json");
  const opened = [];
  try {
    writeFileSync(requestPath, `${canonicalJson(request)}\n`, { encoding: "utf8", mode: 0o600 });
    const files = [
      ["REQUEST_FD", requestPath],
      [
        "OPERATOR_DATABASE_URL_FD",
        protectedFile(
          environment.VIDEOFORGE_V2_13_OPERATOR_DATABASE_URL_FILE,
          "RELEASE_CERTIFICATION_OPERATOR_DATABASE_URL_FILE",
        ),
      ],
      [
        "PRODUCTION_SECRETS_FD",
        protectedFile(
          environment.VIDEOFORGE_V2_13_PRODUCTION_SECRETS_FILE,
          "RELEASE_CERTIFICATION_PRODUCTION_SECRETS_FILE",
        ),
      ],
    ];
    for (const [, path] of files) opened.push(openSync(path, "r"));
    const childEnvironment = { PATH: environment.PATH ?? process.env.PATH };
    files.forEach(([name], index) => {
      childEnvironment[`VIDEOFORGE_V213_CERTIFICATION_${name}`] = String(index + 3);
    });
    return await spawnSourceBoundBridgeChild({
      args: ["--certify-release", RELEASE_CERTIFICATION_CONFIRMATION],
      timeoutMs,
      stdio: ["ignore", "pipe", "pipe", ...opened],
      childEnvironment,
      timeoutCode: "RELEASE_CERTIFICATION_CHILD_TIMEOUT",
      executionCode: "RELEASE_CERTIFICATION_EXECUTION",
      cancellationSignal,
    });
  } finally {
    for (const fd of opened) closeSync(fd);
    rmSync(directory, { recursive: true, force: true });
  }
}

/** A second child boundary after provider cleanup has returned. It receives no RunPod key,
 * provider endpoint, runtime database, Worker bearer, or production input. The only secret is the
 * existing evidence HMAC key copied into a mode-0600 ephemeral file for this one local process. */
async function productionCleanupReceiptSpawn({
  environment,
  request,
  timeoutMs = CLEANUP_RECEIPT_CHILD_MAX_TIMEOUT_MS,
  cancellationSignal,
}) {
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > CLEANUP_RECEIPT_CHILD_MAX_TIMEOUT_MS
  )
    fail("CLEANUP_RECEIPT_CHILD_TIMEOUT_INVALID");
  const directory = mkdtempSync(resolve(tmpdir(), "videoforge-v213-cleanup-receipt-"));
  const requestPath = resolve(directory, "request.json");
  const evidenceKeyPath = resolve(directory, "evidence-key.base64");
  const opened = [];
  try {
    const secrets = loadBridgeProductionSecrets(environment, { allowEither: true });
    writeFileSync(requestPath, `${canonicalJson(request)}\n`, { encoding: "utf8", mode: 0o600 });
    writeFileSync(evidenceKeyPath, secrets.value.acceptanceEvidenceSigningKeyBase64, {
      encoding: "utf8",
      mode: 0o600,
    });
    const files = [
      ["REQUEST_FD", requestPath],
      [
        "OPERATOR_DATABASE_URL_FD",
        protectedFile(
          environment.VIDEOFORGE_V2_13_OPERATOR_DATABASE_URL_FILE,
          "CLEANUP_RECEIPT_OPERATOR_DATABASE_URL_FILE",
        ),
      ],
      ["EVIDENCE_SIGNING_KEY_FD", evidenceKeyPath],
    ];
    for (const [, path] of files) opened.push(openSync(path, "r"));
    const childEnvironment = { PATH: environment.PATH ?? process.env.PATH };
    files.forEach(([name], index) => {
      childEnvironment[`VIDEOFORGE_V213_CLEANUP_RECEIPT_${name}`] = String(index + 3);
    });
    return await spawnSourceBoundBridgeChild({
      args: ["--finalize-cleanup-receipt", CLEANUP_RECEIPT_CONFIRMATION],
      timeoutMs,
      stdio: ["ignore", "pipe", "pipe", ...opened],
      childEnvironment,
      timeoutCode: "CLEANUP_RECEIPT_CHILD_TIMEOUT",
      executionCode: "CLEANUP_RECEIPT_EXECUTION",
      cancellationSignal,
    });
  } finally {
    for (const fd of opened) closeSync(fd);
    rmSync(directory, { recursive: true, force: true });
  }
}

function loadBridgePrequalificationInput(environment, state, outerStateSha256) {
  let seed;
  let bytes;
  try {
    bytes = readFileSync(
      protectedFile(
        environment.VIDEOFORGE_V2_13_MATERIALIZATION_SEED_FILE,
        "BRIDGE_PREQUALIFICATION_SEED_FILE",
      ),
    );
    seed = JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("BRIDGE_PREQUALIFICATION_SEED_FILE");
  }
  const canonical = Buffer.from(`${canonicalJson(seed)}\n`);
  if (
    Buffer.compare(bytes, canonical) !== 0 ||
    !validateMaterializationSeedShape(seed) ||
    seed.production_input_base.fullLiveAuthorityId !== state.full_live_authority_id ||
    sha256(canonical) !== state.materialization_seed_sha256
  )
    fail("BRIDGE_PREQUALIFICATION_SEED_BINDING");
  const staticDualLaneInput = structuredClone(seed.production_input_base.dualLaneInput);
  const descriptor = staticDualLaneInput.qualificationCaseDescriptor;
  staticDualLaneInput.qualificationGeneratorSha256 = canonicalSha256(descriptor.generators);
  staticDualLaneInput.qualificationSourceRefs = {
    caseSource: descriptor.caseSource,
    generators: descriptor.generators,
    validators: descriptor.validators,
  };
  staticDualLaneInput.qualificationProtectedInputDescriptors = descriptor.protectedInputs;
  staticDualLaneInput.qualificationCaseDescriptors = [
    "mage",
    "soulx2s",
    "soulx4s",
    "soulx6s",
    "soulx10s",
    "soulxCancel",
    "soulxInvalidOutput",
    "soulxTimeout",
  ].map((key) => ({ key, ...descriptor.cases[key] }));
  staticDualLaneInput.qualificationR2 = {
    accountId: seed.activation_record_base.cloudflare.account_id,
    bucketName: seed.activation_record_base.cloudflare.r2_bucket_name,
  };
  delete staticDualLaneInput.qualificationCaseDescriptor;
  return Object.freeze({
    schemaVersion: "videoforge.v213-full-live-prequalification-input/v1",
    outerStateSha256,
    fullLiveAuthorityId: seed.production_input_base.fullLiveAuthorityId,
    dualLaneInput: staticDualLaneInput,
    commandPayload: {
      authorityDocument: {
        authorityId: state.authority_id,
        proposalSha256: state.proposal_sha256,
        approvalSha256: state.approval_sha256,
        proposalCommit: state.proposal_record_commit,
        sourceCommit: state.release_source_commit,
        executorSha256: state.full_live_executor_sha256,
        approvedAt: state.approved_at,
        expiresAt: state.expires_at,
        maximumCumulativeSpendUsd: 17.5,
        singleUse: true,
      },
    },
  });
}

function loadBridgeProductionInput(environment) {
  const path = protectedFile(
    environment.VIDEOFORGE_V2_13_PRODUCTION_INPUT_FILE,
    "BRIDGE_PRODUCTION_INPUT_FILE",
  );
  let value;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    fail("BRIDGE_PRODUCTION_INPUT_JSON");
  }
  if (
    value?.schemaVersion !== "videoforge.v213-full-live-outer-input/v1" ||
    Object.keys(value).sort().join(",") !==
      "authorityDocument,commandPayloads,dualLaneInput,fullLiveAuthorityId,schemaVersion" ||
    !/^[0-9a-f-]{36}$/u.test(value.fullLiveAuthorityId ?? "") ||
    value.dualLaneInput === null ||
    typeof value.dualLaneInput !== "object" ||
    value.commandPayloads === null ||
    typeof value.commandPayloads !== "object" ||
    value.authorityDocument === null ||
    typeof value.authorityDocument !== "object"
  )
    fail("BRIDGE_PRODUCTION_INPUT");
  return value;
}

function loadBridgeCleanupInput(environment) {
  let value;
  try {
    value = JSON.parse(
      readFileSync(
        protectedFile(environment.VIDEOFORGE_V2_13_CLEANUP_INPUT_FILE, "BRIDGE_CLEANUP_INPUT_FILE"),
        "utf8",
      ),
    );
  } catch {
    fail("BRIDGE_CLEANUP_INPUT_JSON");
  }
  if (
    value?.schemaVersion !== "videoforge.v213-full-live-cleanup-input/v1" ||
    Object.keys(value).sort().join(",") !==
      "billingBaselineMode,billingBaselineUsd,fullLiveAuthorityId,retainedLanes,schemaVersion,totalCapUsd" ||
    !/^[0-9a-f-]{36}$/u.test(value.fullLiveAuthorityId ?? "") ||
    !["PRIOR_FRESH_PREFLIGHT", "ESTABLISH_CURRENT_NO_RUNPOD_MUTATION"].includes(
      value.billingBaselineMode,
    ) ||
    (value.billingBaselineMode === "PRIOR_FRESH_PREFLIGHT" &&
      (!Number.isFinite(value.billingBaselineUsd) || value.billingBaselineUsd < 0)) ||
    (value.billingBaselineMode === "ESTABLISH_CURRENT_NO_RUNPOD_MUTATION" &&
      value.billingBaselineUsd !== null) ||
    value.totalCapUsd !== 17.5 ||
    !Array.isArray(value.retainedLanes) ||
    value.retainedLanes.length !== 2 ||
    value.retainedLanes.some(
      (lane) =>
        !["mage", "soulx"].includes(lane?.lane) ||
        !HASH.test(lane?.volumeIdSha256 ?? "") ||
        !HASH.test(lane?.volumeManifestSha256 ?? "") ||
        Object.keys(lane ?? {})
          .sort()
          .join(",") !== "lane,volumeIdSha256,volumeManifestSha256",
    )
  )
    fail("BRIDGE_CLEANUP_INPUT");
  return value;
}

function loadBridgeProductionSecrets(
  environment,
  { requireEndpoints = false, allowEither = false } = {},
) {
  const raw = readFileSync(
    protectedFile(
      environment.VIDEOFORGE_V2_13_PRODUCTION_SECRETS_FILE,
      "BRIDGE_PRODUCTION_SECRETS_FILE",
    ),
    "utf8",
  );
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    fail("BRIDGE_PRODUCTION_SECRETS_JSON");
  }
  const baseKeys = [
    "acceptanceEvidenceSigningKeyBase64",
    "pairDispatchTokenKeyBase64",
    "pairDispatchTokenKeyId",
    "pairEnvelopeSigningKeyHex",
    "pairEnvelopeSigningKeyId",
    "pairProviderProofKeyHex",
    "pairProviderProofKeyId",
    "provenanceReceiptHmacKeyBase64",
    "provenanceReceiptKeyId",
    "schemaVersion",
    "stageAuthoritySigningKeyBase64",
  ];
  const hasEndpoints = value?.schemaVersion === "videoforge.v213-full-live-production-secrets/v1";
  if (
    (!allowEither && hasEndpoints !== requireEndpoints) ||
    (allowEither &&
      ![
        "videoforge.v213-full-live-pre-endpoint-secrets/v1",
        "videoforge.v213-full-live-production-secrets/v1",
      ].includes(value?.schemaVersion)) ||
    JSON.stringify(Object.keys(value ?? {}).sort()) !==
      JSON.stringify(
        (hasEndpoints ? [...baseKeys, "mageEndpointId", "soulxEndpointId"] : baseKeys).sort(),
      ) ||
    (hasEndpoints &&
      (typeof value.mageEndpointId !== "string" ||
        typeof value.soulxEndpointId !== "string" ||
        value.mageEndpointId === value.soulxEndpointId ||
        value.mageEndpointId === "" ||
        value.soulxEndpointId === ""))
  )
    fail("BRIDGE_PRODUCTION_SECRETS");
  const protectedKeyFields = [
    "stageAuthoritySigningKeyBase64",
    "provenanceReceiptHmacKeyBase64",
    "acceptanceEvidenceSigningKeyBase64",
    "pairDispatchTokenKeyBase64",
  ];
  const keyHashes = protectedKeyFields.map((field) => {
    const encoded = value?.[field];
    if (typeof encoded !== "string") fail("BRIDGE_PRODUCTION_SECRETS");
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.length < 32 || bytes.toString("base64") !== encoded)
      fail("BRIDGE_PRODUCTION_SECRETS");
    return sha256(bytes);
  });
  for (const field of ["pairEnvelopeSigningKeyHex", "pairProviderProofKeyHex"]) {
    const encoded = value?.[field];
    if (typeof encoded !== "string" || !/^(?:[0-9a-f]{2}){32,}$/u.test(encoded))
      fail("BRIDGE_PRODUCTION_SECRETS");
    keyHashes.push(sha256(Buffer.from(encoded, "hex")));
  }
  if (new Set(keyHashes).size !== keyHashes.length) fail("BRIDGE_PRODUCTION_SECRETS");
  return Object.freeze({ value, raw, hasEndpoints });
}

function preflightConcreteFullLiveInputs({
  environment = process.env,
  state,
  cleanupOnly = false,
  bootstrapOnly = false,
  bootstrapReconciliation = false,
  operatorOnly = false,
  allowUnmaterializedProductionInput = false,
  requireEndpointSecrets = false,
}) {
  if (bootstrapOnly) {
    const directory = protectedDirectory(
      environment.VIDEOFORGE_V2_13_POSTGRES_INPUT_DIR,
      "PREQUALIFICATION_POSTGRES_DIRECTORY",
    );
    const service = join(directory, "owner.pg_service.conf");
    const pass = join(directory, "owner.pgpass");
    protectedFile(pass, "PREQUALIFICATION_OWNER_PASS");
    protectedFile(service, "PREQUALIFICATION_OWNER_SERVICE");
    const receiptPath = prequalificationPath(environment);
    const credentialPaths = databaseCredentialPaths({
      directory,
      environment,
      receiptPath,
      authorityId: state?.authority_id,
    });
    const credentialFiles = databaseCredentialFinalPaths(credentialPaths);
    const observedCredentialStages = assertOnlyCurrentDatabaseCredentialStages(
      credentialPaths,
      "PREQUALIFICATION_DATABASE_CREDENTIAL_STAGING_AUTHORITY_DRIFT",
    );
    if (state?.operator_role_verified === true) {
      for (const path of credentialFiles)
        protectedSingleLinkFile(path, "PREQUALIFICATION_SETTLED_DATABASE_CREDENTIAL");
      if (observedCredentialStages.length !== 0)
        fail("PREQUALIFICATION_SETTLED_DATABASE_CREDENTIAL_STAGING_PRESENT");
    } else if (
      bootstrapReconciliation !== true &&
      (credentialFiles.some((path) => lstatExists(path)) || observedCredentialStages.length !== 0)
    ) {
      fail("PREQUALIFICATION_UNSETTLED_DATABASE_CREDENTIAL_PRESENT");
    }
    return Object.freeze({
      bootstrapOnly: true,
      bootstrapReconciliation,
      postgresInputDirectory: directory,
      databaseCredentialsPresent: state?.operator_role_verified === true,
    });
  }
  const productionPath = environment.VIDEOFORGE_V2_13_PRODUCTION_INPUT_FILE;
  if (typeof productionPath !== "string" || productionPath === "" || productionPath.includes("\0"))
    fail("BRIDGE_PRODUCTION_INPUT_FILE");
  const production =
    allowUnmaterializedProductionInput && !lstatExists(productionPath)
      ? null
      : loadBridgeProductionInput(environment);
  const authority = production?.authorityDocument;
  if (
    production !== null &&
    (production.fullLiveAuthorityId !== state.full_live_authority_id ||
      authority.authorityId !== state.authority_id ||
      authority.proposalSha256 !== state.proposal_sha256 ||
      authority.approvalSha256 !== state.approval_sha256 ||
      authority.proposalCommit !== state.proposal_record_commit ||
      authority.sourceCommit !== state.release_source_commit ||
      authority.executorSha256 !== state.full_live_executor_sha256 ||
      authority.approvedAt !== state.approved_at ||
      authority.expiresAt !== state.expires_at ||
      authority.maximumCumulativeSpendUsd !== 17.5 ||
      authority.singleUse !== true)
  )
    fail("BRIDGE_OUTER_AUTHORITY_LINEAGE");
  if (operatorOnly) {
    for (const [, variable] of BRIDGE_PROTECTED_FILES.filter(([fdName]) =>
      ["RUNPOD_API_KEY_FD", "OPERATOR_DATABASE_URL_FD"].includes(fdName),
    )) {
      const value = readFileSync(
        protectedFile(environment[variable], `BRIDGE_PROTECTED_FILE:${variable}`),
        "utf8",
      );
      if (value.length === 0 || value.length > 65_536 || value.includes("\0"))
        fail("BRIDGE_PROTECTED_CONTENT", variable);
      if (variable.endsWith("OPERATOR_DATABASE_URL_FILE")) {
        const serviceValues = ownerServiceEndpoint(environment.VIDEOFORGE_V2_13_POSTGRES_INPUT_DIR);
        parseExactOperatorDatabaseUrl(
          value,
          {
            host: serviceValues.host,
            database: serviceValues.dbname,
          },
          "BRIDGE_PROTECTED_URL",
        );
      }
    }
    return Object.freeze({ production, operatorOnly: true });
  }
  const bridgeValues = Object.fromEntries(
    BRIDGE_PROTECTED_FILES.map(([, variable]) => {
      const path = protectedFile(environment[variable], `BRIDGE_PROTECTED_FILE:${variable}`);
      const value = readFileSync(path, "utf8");
      if (value.length === 0 || value.length > 65_536 || value.includes("\0"))
        fail("BRIDGE_PROTECTED_CONTENT", variable);
      return [variable, value];
    }),
  );
  const databaseUrls = [
    bridgeValues.VIDEOFORGE_V2_13_OPERATOR_DATABASE_URL_FILE,
    bridgeValues.VIDEOFORGE_V2_13_RUNTIME_DATABASE_URL_FILE,
    bridgeValues.VIDEOFORGE_V2_13_RECONCILER_DATABASE_URL_FILE,
  ];
  const serviceValues = ownerServiceEndpoint(
    environment.VIDEOFORGE_V2_13_POSTGRES_INPUT_DIR,
    "BRIDGE_OWNER_SERVICE",
  );
  parseExactOperatorDatabaseUrl(
    bridgeValues.VIDEOFORGE_V2_13_OPERATOR_DATABASE_URL_FILE,
    { host: serviceValues.host, database: serviceValues.dbname },
    "BRIDGE_PROTECTED_URL",
  );
  let workerOrigin;
  try {
    workerOrigin = new URL(bridgeValues.VIDEOFORGE_V2_13_WORKER_ORIGIN_FILE);
    databaseUrls.forEach((value) => new URL(value));
  } catch {
    fail("BRIDGE_PROTECTED_URL");
  }
  if (
    bridgeValues.VIDEOFORGE_V2_13_RUNPOD_API_KEY_FILE.trim() !==
      bridgeValues.VIDEOFORGE_V2_13_RUNPOD_API_KEY_FILE ||
    bridgeValues.VIDEOFORGE_V2_13_RUNPOD_API_KEY_FILE.length < 20 ||
    databaseUrls.some((value) => value.trim() !== value || !value.startsWith("postgres")) ||
    new Set(databaseUrls).size !== 3 ||
    workerOrigin.protocol !== "https:" ||
    workerOrigin.origin !== bridgeValues.VIDEOFORGE_V2_13_WORKER_ORIGIN_FILE ||
    bridgeValues.VIDEOFORGE_V2_13_WORKER_OPERATOR_BEARER_FILE.trim() !==
      bridgeValues.VIDEOFORGE_V2_13_WORKER_OPERATOR_BEARER_FILE ||
    bridgeValues.VIDEOFORGE_V2_13_WORKER_OPERATOR_BEARER_FILE.length < 32
  )
    fail("BRIDGE_PROTECTED_CONTENT");
  loadBridgeProductionSecrets(environment, {
    requireEndpoints: requireEndpointSecrets,
    allowEither: !requireEndpointSecrets && cleanupOnly,
  });
  const secretDirectory = protectedCanonicalDirectory(
    environment.VIDEOFORGE_V2_13_SECRET_INPUT_DIR,
    "BRIDGE_SECRET_INPUT_DIRECTORY",
  );
  if (
    readExactProtectedBytes(
      join(secretDirectory, "VIDEOFORGE_V213_WORKFLOW_OPERATOR_TOKEN"),
      "BRIDGE_WORKER_BEARER_SECRET",
    ).toString("utf8") !== bridgeValues.VIDEOFORGE_V2_13_WORKER_OPERATOR_BEARER_FILE ||
    readExactProtectedBytes(
      join(secretDirectory, "RUNPOD_API_KEY"),
      "BRIDGE_RUNPOD_SECRET",
    ).toString("utf8") !== bridgeValues.VIDEOFORGE_V2_13_RUNPOD_API_KEY_FILE
  )
    fail("BRIDGE_PROTECTED_SECRET_COPY_BINDING");
  return Object.freeze({ production, cleanupOnly });
}

function preflightPromotionInputs({ environment = process.env, state, spawn = spawnSync }) {
  const { production } = preflightConcreteFullLiveInputs({
    environment,
    state,
    requireEndpointSecrets: true,
  });
  for (const variable of [
    "VIDEOFORGE_V2_13_PROMOTION_RECORD_FILE",
    "VIDEOFORGE_V2_13_DISABLED_CONFIG_FILE",
    "VIDEOFORGE_V2_13_OPERATOR_DATABASE_URL_FILE",
  ])
    protectedFile(environment[variable], `PROMOTION_PROTECTED_FILE:${variable}`);
  const oauthConfigPath = wranglerOAuthConfigPath(environment);
  protectedFile(oauthConfigPath, "PROMOTION_WRANGLER_OAUTH_CONFIG_FILE");
  let promotion;
  try {
    promotion = JSON.parse(
      readFileSync(environment.VIDEOFORGE_V2_13_PROMOTION_RECORD_FILE, "utf8"),
    );
  } catch {
    fail("PROMOTION_RECORD_JSON");
  }
  if (
    promotion?.database?.full_live_authority_id !== production.fullLiveAuthorityId ||
    promotion?.database?.executor_sha256 !== state.full_live_executor_sha256 ||
    promotion?.database?.paid_approval_sha256 !== state.approval_sha256 ||
    promotion?.approval?.authority_id !== state.authority_id ||
    promotion?.approval?.proposal_sha256 !== state.proposal_sha256 ||
    promotion?.approval?.approval_sha256 !== state.approval_sha256 ||
    promotion?.release?.commit !== state.release_source_commit
  )
    fail("PROMOTION_OUTER_AUTHORITY_LINEAGE");
  const disabledConfig = readFileSync(environment.VIDEOFORGE_V2_13_DISABLED_CONFIG_FILE);
  let disabledConfigValue;
  try {
    disabledConfigValue = JSON.parse(disabledConfig);
  } catch {
    fail("PROMOTION_DISABLED_CONFIG_JSON");
  }
  const accountId = String(disabledConfigValue?.account_id ?? "");
  if (
    !/^[0-9a-f]{32}$/u.test(accountId) ||
    sha256(Buffer.from(accountId)) !== promotion?.cloudflare?.account_id_sha256 ||
    sha256(disabledConfig) !== promotion?.release?.disabled_config_sha256
  )
    fail("PROMOTION_PROTECTED_CONTENT");
  // Promotion is a later consumer of the same source-bound OAuth authority. Keep the exact
  // scope set explicit at this seam; never fall back to whatever scopes happen to be in the
  // local Wrangler store.
  const expectedScopes = Object.freeze([...APPROVED_WRANGLER_OAUTH_SCOPES]);
  refreshWranglerOAuthReadback({
    configPath: oauthConfigPath,
    environment,
    accountId,
    expectedScopes,
    spawn,
  });
  return Object.freeze({ production, promotion, oauthConfigPath, accountId, expectedScopes });
}

function preflightGuardedActivationInputs({ environment = process.env, state }) {
  preflightConcreteFullLiveInputs({ environment, state, requireEndpointSecrets: true });
  for (const [argument, variable] of GUARDED_INPUTS) {
    const value = environment[variable];
    if (typeof value !== "string" || value === "" || value.includes("\0"))
      fail("GUARDED_INPUT", variable);
    if (!["evidence-output", "postgres-input-dir", "secret-input-dir"].includes(argument))
      protectedFile(value, `GUARDED_PROTECTED_FILE:${variable}`);
    if (["postgres-input-dir", "secret-input-dir"].includes(argument)) {
      const metadata = lstatSync(value);
      if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0)
        fail("GUARDED_PROTECTED_DIRECTORY", variable);
    }
  }
  const guardedOperatorUrl = protectedFile(
    resolve(environment.VIDEOFORGE_V2_13_POSTGRES_INPUT_DIR, "operator.database-url"),
    "GUARDED_OPERATOR_DATABASE_URL_FILE",
  );
  let guardedAuthority;
  try {
    guardedAuthority = JSON.parse(
      readFileSync(environment.VIDEOFORGE_V2_13_ACTIVATION_RECORD, "utf8"),
    );
  } catch {
    fail("GUARDED_ACTIVATION_RECORD_JSON");
  }
  if (
    sha256(readFileSync(guardedOperatorUrl)) !==
    guardedAuthority?.database?.operator_database_url_sha256
  )
    fail("GUARDED_OPERATOR_DATABASE_URL_LINEAGE");
  if (
    guardedAuthority?.release?.commit !== state.release_source_commit ||
    guardedAuthority?.authority?.authority_id !== state.authority_id ||
    guardedAuthority?.full_live_authority_id !== state.full_live_authority_id ||
    sha256(readFileSync(environment.VIDEOFORGE_V2_13_PROPOSAL_FILE)) !== state.proposal_sha256 ||
    sha256(readFileSync(environment.VIDEOFORGE_V2_13_USER_APPROVAL_FILE)) !== state.approval_sha256
  )
    fail("GUARDED_OUTER_AUTHORITY_LINEAGE");
  return Object.freeze({ guardedAuthority });
}

function exactCleanupReceiptFinalizationResult(value, request) {
  const durableDocument = value?.receiptDocument;
  const durableSummary = durableDocument?.summary;
  const currentDocument = {
    schemaVersion: "videoforge.v213-current-run-cleanup-receipt/v1",
    fullLiveAuthorityId: request.fullLiveAuthorityId,
    operationId: request.operationId,
    outerStateSha256: request.outerStateSha256,
    providerCleanupEvidenceSha256: request.providerCleanupEvidenceSha256,
    summary: request.summary,
  };
  if (
    !exactObjectKeys(value, [
      "fullLiveAuthorityId",
      "operationId",
      "providerCleanupEvidenceSha256",
      "readbackOnly",
      "receiptArtifactSha256",
      "receiptDocument",
      "releaseFactMaterializationSha256",
      "schemaVersion",
    ]) ||
    value.schemaVersion !== "videoforge.v213-cleanup-receipt-finalization-result/v1" ||
    value.fullLiveAuthorityId !== request.fullLiveAuthorityId ||
    value.operationId !== request.operationId ||
    value.readbackOnly !== request.readbackOnly ||
    !HASH.test(value.receiptArtifactSha256 ?? "") ||
    !exactObjectKeys(durableDocument, [
      "fullLiveAuthorityId",
      "operationId",
      "outerStateSha256",
      "providerCleanupEvidenceSha256",
      "schemaVersion",
      "summary",
    ]) ||
    durableDocument.schemaVersion !== "videoforge.v213-current-run-cleanup-receipt/v1" ||
    durableDocument.fullLiveAuthorityId !== request.fullLiveAuthorityId ||
    durableDocument.operationId !== request.operationId ||
    !HASH.test(durableDocument.outerStateSha256 ?? "") ||
    !HASH.test(durableDocument.providerCleanupEvidenceSha256 ?? "") ||
    durableSummary === null ||
    typeof durableSummary !== "object" ||
    Array.isArray(durableSummary) ||
    value.providerCleanupEvidenceSha256 !== durableDocument.providerCleanupEvidenceSha256 ||
    canonicalSha256(durableSummary) !== durableDocument.providerCleanupEvidenceSha256 ||
    canonicalSha256(durableDocument) !== value.receiptArtifactSha256 ||
    (!request.readbackOnly &&
      (value.providerCleanupEvidenceSha256 !== request.providerCleanupEvidenceSha256 ||
        canonicalSha256(durableDocument) !== canonicalSha256(currentDocument))) ||
    (request.failureCleanup
      ? value.releaseFactMaterializationSha256 !== null
      : !HASH.test(value.releaseFactMaterializationSha256 ?? ""))
  )
    fail("CLEANUP_RECEIPT_RESULT", request.operationId);
  return Object.freeze(value);
}

function createTypeScriptBridgeAdapters({
  environment = process.env,
  spawnBridge = productionBridgeSpawn,
  spawnCleanupReceipt = productionCleanupReceiptSpawn,
  cleanupPartialDatabaseCredentials = cleanupPartialDatabaseRoleCredentials,
  requirePrequalificationReceipt = false,
  prepareAcceptanceAuthority,
  expectedCliSha256 = BRIDGE_CLI_SOURCE_SHA256,
  expectedTransportSha256 = "sha256:6dc4f248e4bad0d7a5f81c471998f2d13c686f51d93c08b3b3afb53824865ee2",
} = {}) {
  const actualCliSha256 = sha256(readFileSync(resolve(ROOT, BRIDGE_PATH)));
  const actualTransportSha256 = sha256(readFileSync(resolve(ROOT, BRIDGE_TRANSPORT_PATH)));
  if (actualCliSha256 !== expectedCliSha256) fail("BRIDGE_SOURCE_DRIFT");
  if (actualTransportSha256 !== expectedTransportSha256) fail("BRIDGE_TRANSPORT_SOURCE_DRIFT");
  const bootstrapPartialCleanupPreambles = new Map();
  const run =
    (command) =>
    async (context = {}, state, priorResults, outerStateSha256) => {
      if (!HASH.test(outerStateSha256 ?? "")) fail("BRIDGE_OUTER_STATE");
      if (requirePrequalificationReceipt && command === "fresh-live-preflight") {
        const bootstrap = priorResults.get("bootstrap-prequalification-database");
        const receipt = prequalificationReceiptFromFile(prequalificationPath(environment));
        if (
          bootstrap?.prequalification_database_bootstrap_sha256 !==
          receipt?.prequalification_database_bootstrap_sha256
        )
          fail("BRIDGE_PREQUALIFICATION_RECEIPT");
      }
      const earlyCleanup = CLEANUP_BRIDGE_COMMANDS.has(command) && context?.earlyFailure === true;
      const bootstrapPartialCleanup =
        earlyCleanup && context?.cleanupMode === "BOOTSTRAP_PARTIAL_CLEANUP";
      if (
        earlyCleanup &&
        !["BOOTSTRAP_PARTIAL_CLEANUP", "EARLY_NO_DATABASE_CLEANUP"].includes(context?.cleanupMode)
      )
        fail("BRIDGE_EARLY_CLEANUP_MODE", command);
      if (earlyCleanup && context?.providerDispatchForbidden !== true)
        fail("BRIDGE_EARLY_CLEANUP_PROVIDER_DISPATCH_FENCE", command);
      let localDatabaseCredentialCleanup = null;
      if (bootstrapPartialCleanup) {
        let preamble = bootstrapPartialCleanupPreambles.get(state.authority_id);
        if (preamble === undefined) {
          preamble = Promise.resolve(
            cleanupPartialDatabaseCredentials({ environment, state }),
          ).then((value) => exactPartialDatabaseCleanupResult(value, state));
          bootstrapPartialCleanupPreambles.set(state.authority_id, preamble);
        }
        localDatabaseCredentialCleanup = await preamble;
      }
      const cleanup =
        CLEANUP_BRIDGE_COMMANDS.has(command) && !earlyCleanup
          ? loadBridgeCleanupInput(environment)
          : null;
      const cleanupReconciliation =
        cleanup !== null &&
        context?.resumed === true &&
        context?.authorizedUnsettled === true &&
        context?.reconciliationOnly === true &&
        context?.providerDispatchForbidden === true;
      const cleanupInitial =
        cleanup !== null &&
        (context?.resumed === false || context?.resumed === undefined) &&
        context?.authorizedUnsettled !== true &&
        context?.reconciliationOnly !== true &&
        context?.providerDispatchForbidden !== true;
      if (cleanup !== null && !cleanupInitial && !cleanupReconciliation)
        fail("BRIDGE_CLEANUP_EXECUTION_CONTEXT", command);
      // The executor may pass the original post-authorization outer state on restart.  Keep this
      // binding in the command input for the SQL journal; recovery flags/current state remain
      // outside its logical request identity and migration 0046 returns the first durable value.
      const cleanupAuthorizationOuterStateSha256 =
        context?.authorizedOuterStateSha256 ??
        context?.cleanupAuthorizationOuterStateSha256 ??
        outerStateSha256;
      let cleanupRequestInput =
        cleanup === null
          ? null
          : Object.freeze({
              ...cleanup,
              outerStateSha256: cleanupAuthorizationOuterStateSha256,
              authorizedUnsettled: cleanupReconciliation,
              reconciliationOnly: cleanupReconciliation,
              providerDispatchForbidden: cleanupReconciliation,
            });
      if (context?.qualifiedProductionCleanup !== undefined) {
        if (
          cleanup === null ||
          !["restore-endpoints-max-one", "reconcile-exact-resources"].includes(command)
        )
          fail("PROMOTION_CLEANUP_PROOF_SCOPE", command);
        const proof = exactQualifiedProductionCleanupProof(context.qualifiedProductionCleanup);
        if (proof.fullLiveAuthorityId !== cleanup.fullLiveAuthorityId)
          fail("PROMOTION_CLEANUP_PROOF_AUTHORITY", command);
        cleanupRequestInput = Object.freeze({
          ...cleanupRequestInput,
          qualifiedProductionCleanup: proof,
        });
      }
      const prequalification =
        command === "fresh-live-preflight" && !earlyCleanup
          ? loadBridgePrequalificationInput(environment, state, outerStateSha256)
          : null;
      const production =
        cleanup === null && prequalification === null && !earlyCleanup
          ? loadBridgeProductionInput(environment)
          : null;
      const earlyCleanupInput = earlyCleanup
        ? {
            schemaVersion: EARLY_CLEANUP_INPUT_SCHEMA,
            fullLiveAuthorityId: state.full_live_authority_id,
          }
        : null;
      if (requirePrequalificationReceipt && command === "mage-live-qualification") {
        preflightConcreteFullLiveInputs({
          environment,
          state,
          requireEndpointSecrets: false,
        });
      }
      if (
        production !== null &&
        (production.dualLaneInput?.mage?.sourceCommit !== state.release_source_commit ||
          production.dualLaneInput?.soulx?.sourceCommit !== state.release_source_commit)
      )
        fail("BRIDGE_SOURCE_LINEAGE");
      let commandPayload = production?.commandPayloads[command] ?? {};
      if (command === "fresh-live-preflight") {
        if (requirePrequalificationReceipt) {
          preflightConcreteFullLiveInputs({
            environment,
            state,
            operatorOnly: true,
            allowUnmaterializedProductionInput: true,
          });
        }
        commandPayload = prequalification.commandPayload;
      }
      if (command === "mage-live-qualification")
        commandPayload = { admission: priorResults.get("fresh-live-preflight")?.bridgeSummary };
      if (command === "soulx-live-qualification")
        commandPayload = {
          mageHandoffSha256: priorResults.get("mage-live-qualification")?.evidenceSha256,
        };
      if (command === "create-exact-max-one-endpoints")
        commandPayload = {
          mageHandoffSha256: priorResults.get("mage-live-qualification")?.evidenceSha256,
          soulxHandoffSha256: priorResults.get("soulx-live-qualification")?.evidenceSha256,
        };
      if (
        [
          "restore-endpoints-max-one",
          "prove-zero-workers",
          "read-settled-billing",
          "reconcile-exact-resources",
        ].includes(command)
      )
        commandPayload = {};
      const acceptanceCheckpoint = Object.entries(V213_JIT_COMMANDS).find(
        ([, acceptedCommand]) => acceptedCommand === command,
      )?.[0];
      let operationStageAuthorityId = (
        production ??
        prequalification ??
        cleanup ??
        earlyCleanupInput
      ).fullLiveAuthorityId;
      if (production !== null && acceptanceCheckpoint !== undefined) {
        if (typeof prepareAcceptanceAuthority === "function") {
          const predecessorEvidenceSha256s = {};
          const orderedJitCommands = V213_JIT_CHECKPOINTS.map(
            (checkpoint) => V213_JIT_COMMANDS[checkpoint],
          );
          const prerequisiteCommands = orderedJitCommands.slice(
            0,
            orderedJitCommands.indexOf(command),
          );
          for (const prerequisite of prerequisiteCommands) {
            const prior = priorResults?.get(prerequisite);
            const evidence = prior?.evidenceSha256 ?? prior?.proofSha256;
            if (HASH.test(evidence ?? "")) predecessorEvidenceSha256s[prerequisite] = evidence;
          }
          const prepared = await prepareAcceptanceAuthority({
            checkpoint: acceptanceCheckpoint,
            command,
            commandId: `v213:${production.fullLiveAuthorityId}:${command}`,
            fullLiveAuthorityId: production.fullLiveAuthorityId,
            outerStateSha256,
            predecessorEvidenceSha256s,
            state,
          });
          operationStageAuthorityId = prepared.productionStageAuthorityId;
        }
      }
      const request = {
        schemaVersion: "videoforge.v213-full-live-command/v1",
        commandId: `v213:${(production ?? prequalification ?? cleanup ?? earlyCleanupInput).fullLiveAuthorityId}:${command}`,
        stageAuthorityId: operationStageAuthorityId,
        command,
        input:
          earlyCleanupInput !== null
            ? earlyCleanupInput
            : prequalification !== null
              ? prequalification
              : cleanup === null
                ? {
                    schemaVersion: "videoforge.v213-full-live-production-input/v1",
                    outerStateSha256,
                    fullLiveAuthorityId: production.fullLiveAuthorityId,
                    dualLaneInput: production.dualLaneInput,
                    commandPayload,
                  }
                : cleanupRequestInput,
      };
      const result = await spawnBridge({
        environment,
        request,
        timeoutMs: bridgeChildTimeoutMs(state, context, command),
        cancellationSignal: context.cancellationSignal,
      });
      if (
        result?.schemaVersion !== "videoforge.v213-full-live-command-result/v1" ||
        result.commandId !== request.commandId ||
        result.command !== command ||
        result.state !== "TERMINAL" ||
        !HASH.test(result.evidenceSha256 ?? "") ||
        result.summary === null ||
        typeof result.summary !== "object"
      )
        fail("BRIDGE_RESULT", command);
      const summary = result.summary;
      if (
        cleanupRequestInput?.qualifiedProductionCleanup !== undefined &&
        canonicalJson(summary.qualifiedProductionCleanup) !==
          canonicalJson(cleanupRequestInput.qualifiedProductionCleanup)
      )
        fail("PROMOTION_CLEANUP_PROOF_READBACK", command);
      let durableEvidenceSha256 = result.evidenceSha256;
      let durableSummary = summary;
      if (cleanup !== null) {
        if (canonicalSha256(summary) !== result.evidenceSha256)
          fail("CLEANUP_RECEIPT_PROVIDER_EVIDENCE_DRIFT", command);
        if (!cleanupInitial && !cleanupReconciliation) fail("CLEANUP_RECEIPT_CONTEXT", command);
        const unsignedCleanupReceiptRequest = {
          schemaVersion: CLEANUP_RECEIPT_REQUEST_SCHEMA,
          fullLiveAuthorityId: cleanup.fullLiveAuthorityId,
          operationId: command,
          outerStateSha256:
            cleanupRequestInput?.outerStateSha256 ?? cleanupAuthorizationOuterStateSha256,
          providerCleanupEvidenceSha256: result.evidenceSha256,
          summary,
          readbackOnly: cleanupReconciliation,
          failureCleanup: context?.cleanupOnly === true,
        };
        const cleanupReceiptRequest = {
          ...unsignedCleanupReceiptRequest,
          requestSha256: canonicalSha256(unsignedCleanupReceiptRequest),
        };
        const finalized = exactCleanupReceiptFinalizationResult(
          await spawnCleanupReceipt({
            environment,
            request: cleanupReceiptRequest,
            timeoutMs: CLEANUP_RECEIPT_CHILD_MAX_TIMEOUT_MS,
            cancellationSignal: context.cancellationSignal,
          }),
          cleanupReceiptRequest,
        );
        durableEvidenceSha256 = finalized.receiptArtifactSha256;
        durableSummary = finalized.receiptDocument.summary;
      }
      const outputSummary = cleanup !== null ? durableSummary : summary;
      const base = {
        actualUsd: 0,
        evidenceSha256: durableEvidenceSha256,
        bridgeSummary: outputSummary,
      };
      if (command === "fresh-live-preflight")
        return {
          ...base,
          exactGpu: outputSummary.admission?.gpu,
          region: outputSummary.admission?.region,
          availability: outputSummary.admission?.availability,
          flexUsdPerGpuHour: outputSummary.admission?.flexRateUsdPerGpuHour,
          noFallback: true,
          inventorySha256: sha256(Buffer.from(JSON.stringify(outputSummary.admission))),
          billingBaselineSha256: sha256(
            Buffer.from(
              JSON.stringify({
                cumulativeBillingUsd: outputSummary.admission?.cumulativeBillingUsd,
              }),
            ),
          ),
        };
      if (command === "mage-live-qualification" || command === "soulx-live-qualification") {
        const before =
          command === "mage-live-qualification"
            ? priorResults.get("fresh-live-preflight")?.bridgeSummary?.admission
                ?.cumulativeBillingUsd
            : priorResults.get("mage-live-qualification")?.bridgeSummary?.billingAfterUsd;
        return {
          ...base,
          actualUsd: Number(outputSummary.billingAfterUsd) - Number(before),
          qualified: outputSummary.qualified === true,
          deploymentSha256:
            command === "mage-live-qualification"
              ? production.dualLaneInput.mage.deploymentSha256
              : production.dualLaneInput.soulx.deploymentSha256,
          zeroWorkersAfter: outputSummary.zeroWorkersAfter === true,
        };
      }
      if (command === "create-exact-max-one-endpoints") {
        const productionDeployments = outputSummary.result?.production ?? {};
        const deployments = Object.values(productionDeployments);
        return {
          ...base,
          createdExactTwoEndpoints: deployments.length === 2,
          distinctEndpointIds: new Set(deployments.map((item) => item.endpointIdSha256)).size === 2,
          bothMaxWorkersOne: deployments.every((item) => item.workersMax === 1),
          bothWorkersMinZero: deployments.every((item) => item.workersMin === 0),
          materialization: {
            production: exactProductionDeploymentMaterialization(productionDeployments),
          },
        };
      }
      if (command.startsWith("v2-")) {
        if (outputSummary.terminal !== true || outputSummary.zeroWorkersAfter !== true)
          fail("BRIDGE_ACCEPTANCE_NOT_TERMINAL", command);
        return {
          ...base,
          actualUsd: outputSummary.settledCostUsd,
          accepted: true,
          ...outputSummary,
        };
      }
      if (command === "restore-endpoints-max-one")
        return {
          ...base,
          proofSha256: durableEvidenceSha256,
          productionCleanupState: outputSummary.productionCleanupState,
          productionResourcesAbsent: outputSummary.productionResourcesAbsent,
          retainedProductionEndpoints: outputSummary.retainedProductionEndpoints,
          bothEndpointsMaxWorkersOne: outputSummary.bothEndpointsMaxWorkersOne === true,
        };
      if (command === "prove-zero-workers")
        return {
          ...base,
          proofSha256: durableEvidenceSha256,
          zeroWorkers: outputSummary.zeroWorkers === true,
          stableReads: outputSummary.reads?.length,
        };
      if (command === "read-settled-billing")
        return {
          ...base,
          proofSha256: durableEvidenceSha256,
          withinCumulativeCap: outputSummary.withinCumulativeCap === true,
          cumulativeUsd: outputSummary.cumulativeBillingUsd,
        };
      if (command === "reconcile-exact-resources") {
        const proofSha256 =
          localDatabaseCredentialCleanup === null
            ? durableEvidenceSha256
            : canonicalSha256({
                providerCleanupEvidenceSha256: durableEvidenceSha256,
                localDatabaseCredentialCleanupSha256: localDatabaseCredentialCleanup.cleanupSha256,
              });
        return {
          ...base,
          proofSha256,
          onlyApprovedRetainedVolumes: outputSummary.onlyApprovedRetainedVolumes === true,
          ...(localDatabaseCredentialCleanup === null ? {} : { localDatabaseCredentialCleanup }),
        };
      }
      return { ...base, proofSha256: durableEvidenceSha256 };
    };
  return Object.freeze(
    Object.fromEntries(BRIDGE_COMMANDS.map((command) => [command, run(command)])),
  );
}

function exactReleaseCertificationResult(value, predecessorEvidenceSha256s) {
  const keys = [
    "actualUsd",
    "certified",
    "currentRunEvidence",
    "evidenceSha256",
    "externalSpendUsd",
    "gateCount",
    "gpuUse",
    "invalidGateCount",
    "ledgerSha256",
    "liveReleaseAuthorized",
    "missingGateCount",
    "predecessorEvidenceSha256s",
    "providerMutationPerformed",
    "releaseIdentitySha256",
    "releaseStatus",
    "requiresExplicitReleaseAuthority",
    "schemaVersion",
  ];
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(keys.sort()) ||
    value.schemaVersion !== "videoforge.v213-final-release-certification-result/v1" ||
    value.actualUsd !== 0 ||
    value.externalSpendUsd !== 0 ||
    value.gpuUse !== false ||
    value.providerMutationPerformed !== false ||
    value.currentRunEvidence !== true ||
    value.certified !== true ||
    value.releaseStatus !== "release_certified" ||
    value.gateCount !== 15 ||
    value.missingGateCount !== 0 ||
    value.invalidGateCount !== 0 ||
    value.liveReleaseAuthorized !== false ||
    value.requiresExplicitReleaseAuthority !== true ||
    !HASH.test(value.releaseIdentitySha256 ?? "") ||
    !HASH.test(value.ledgerSha256 ?? "") ||
    value.evidenceSha256 !== value.ledgerSha256 ||
    canonicalJson(value.predecessorEvidenceSha256s) !== canonicalJson(predecessorEvidenceSha256s)
  )
    fail("RELEASE_CERTIFICATION_RESULT");
  return Object.freeze(value);
}

/** Operation 26 is intentionally absent from BRIDGE_COMMANDS. This adapter can only spawn the
 * dedicated DB-only child above; recovery carries the exact readback-only mode into that child. */
function createReleaseCertificationAdapter({
  environment = process.env,
  spawnCertification = productionReleaseCertificationSpawn,
  expectedCliSha256 = BRIDGE_CLI_SOURCE_SHA256,
} = {}) {
  const actualCliSha256 = sha256(readFileSync(resolve(ROOT, BRIDGE_PATH)));
  if (actualCliSha256 !== expectedCliSha256) fail("RELEASE_CERTIFICATION_SOURCE_DRIFT");
  return async (context = {}, state, priorResults, outerStateSha256) => {
    const reconciling =
      context.resumed === true &&
      context.authorizedUnsettled === true &&
      context.reconciliationOnly === true &&
      context.persistenceForbidden === true &&
      context.dispatchForbidden === true;
    const initial =
      context.resumed === false &&
      context.authorizedUnsettled === false &&
      context.reconciliationOnly === false &&
      (context.persistenceForbidden === false || context.persistenceForbidden === undefined) &&
      (context.dispatchForbidden === false || context.dispatchForbidden === undefined);
    if (
      context.operationId !== "certify-v2-13-release" ||
      context.cleanupOnly !== false ||
      context.earlyFailure !== false ||
      context.endpointFree !== false ||
      context.operatorRoleVerified !== true ||
      context.localCertification !== true ||
      context.providerDispatchForbidden !== true ||
      (!initial && !reconciling) ||
      !HASH.test(outerStateSha256 ?? "") ||
      !(priorResults instanceof Map)
    )
      fail("RELEASE_CERTIFICATION_CONTEXT");
    const workId = `${state?.authority_id}:certify-v2-13-release`.toLowerCase();
    if (
      state?.state !== "CONSUMED_SINGLE_EXECUTION_IN_PROGRESS" ||
      state.release_certification?.state !== "AUTHORIZED_ONCE_RECONCILIATION_ONLY" ||
      state.release_certification.work_id !== workId ||
      state.cleanup_proof === null ||
      typeof state.cleanup_proof !== "object"
    )
      fail("RELEASE_CERTIFICATION_AUTHORITY");
    const predecessorEvidenceSha256s = Object.fromEntries(
      RELEASE_CERTIFICATION_PREDECESSORS.map(([operationId, field]) => {
        const evidenceSha256 = priorResults.get(operationId)?.[field];
        if (!HASH.test(evidenceSha256 ?? ""))
          fail("RELEASE_CERTIFICATION_PREDECESSOR", operationId);
        return [operationId, evidenceSha256];
      }),
    );
    const production = loadBridgeProductionInput(environment);
    const unsigned = {
      schemaVersion: RELEASE_CERTIFICATION_REQUEST_SCHEMA,
      fullLiveAuthorityId: production.fullLiveAuthorityId,
      workId,
      outerStateSha256,
      predecessorEvidenceSha256s,
      resumed: reconciling,
      authorizedUnsettled: reconciling,
      reconciliationOnly: reconciling,
      persistenceForbidden: reconciling,
      dispatchForbidden: reconciling,
      providerDispatchForbidden: true,
    };
    const request = {
      ...unsigned,
      requestSha256: sha256(Buffer.from(canonicalJson(unsigned))),
    };
    const result = await spawnCertification({
      environment,
      request,
      timeoutMs: RELEASE_CERTIFICATION_CHILD_MAX_TIMEOUT_MS,
      cancellationSignal: context.cancellationSignal,
    });
    return exactReleaseCertificationResult(result, predecessorEvidenceSha256s);
  };
}

function createConcreteFullLiveAdapters(options = {}) {
  const concreteEnvironment =
    options.environment ??
    options.bridge?.environment ??
    options.materializer?.environment ??
    process.env;
  const verifyPrequalification =
    options.prequalificationVerifier === false
      ? null
      : (options.prequalificationVerifier?.verify ?? verifyPrequalificationDatabaseReceipt);
  const postConsumptionOptions =
    typeof options.postConsumptionProducer === "function"
      ? { producer: options.postConsumptionProducer }
      : (options.postConsumption ?? options.postConsumptionProducer ?? {});
  const workflowStartAuthorityAdapter = options.workflowStartAuthority
    ? createWorkflowStartAuthorityAdapter(options.workflowStartAuthority)
    : createProtectedWorkflowStartAuthorityAdapter({
        environment: concreteEnvironment,
        ...postConsumptionOptions,
      });
  const promotionAdapter = options.promotion
    ? createQualifiedPromotionAdapter(options.promotion)
    : createProtectedPromotionAdapter(options.protectedPromotion);
  const bridgeAdapters = {
    ...createTypeScriptBridgeAdapters({
      ...(options.bridge ?? {}),
      requirePrequalificationReceipt: true,
      prepareAcceptanceAuthority: workflowStartAuthorityAdapter.prepareAcceptanceAuthority,
    }),
    ...(options.cleanup?.adapters ?? {}),
  };
  const reconcilePromotionCleanup = (...args) => promotionAdapter.reconcileCleanup(...args);
  const hasPromotionMaterialization = (...args) =>
    promotionAdapter.hasCleanupMaterialization(...args);
  for (const operationId of ["restore-endpoints-max-one", "reconcile-exact-resources"])
    bridgeAdapters[operationId] = createPromotionAwareCleanupAdapter({
      operationId,
      adapter: bridgeAdapters[operationId],
      reconcilePromotionCleanup,
      hasPromotionMaterialization,
    });
  const adapters = {
    ...createGitReleaseAdapters(options.git),
    ...createGithubDispatchAdapters(options.github),
    ...createGithubVerificationAdapters(options.githubVerification),
    "bootstrap-prequalification-database": createPrequalificationDatabaseBootstrapAdapter({
      environment: concreteEnvironment,
      ...(options.prequalificationDatabase ?? {}),
      credentialBootstrapBinding: EXACT_CREDENTIAL_BOOTSTRAP_BINDING,
    }),
    "guarded-activation-once": createGuardedActivationAdapter({
      ...(options.guarded ?? {}),
      requirePrequalificationReceipt: true,
    }),
    ...(options.qualification ? createStagedQualificationAdapters(options.qualification) : {}),
    "promote-qualified-production": promotionAdapter,
    "record-workflow-start-authority": workflowStartAuthorityAdapter,
    ...(options.acceptance ? createV213AcceptanceAdapters(options.acceptance) : {}),
    ...bridgeAdapters,
    "certify-v2-13-release": createReleaseCertificationAdapter(options.releaseCertification),
  };
  const materialize =
    options.materializer === false
      ? null
      : (options.materializer?.materialize ??
        createProtectedInputMaterializer(options.materializer));
  if (materialize === null) return Object.freeze(adapters);
  return Object.freeze(
    Object.fromEntries(
      Object.entries(adapters).map(([operationId, adapter]) => [
        operationId,
        async (context, state, priorResults, outerStateSha256) => {
          const earlyCleanup =
            context?.earlyFailure === true &&
            [
              "restore-endpoints-max-one",
              "prove-zero-workers",
              "read-settled-billing",
              "reconcile-exact-resources",
            ].includes(operationId);
          const afterBootstrap = priorResults.has("bootstrap-prequalification-database");
          if (
            verifyPrequalification !== null &&
            !earlyCleanup &&
            afterBootstrap &&
            operationId !== "bootstrap-prequalification-database"
          )
            await verifyPrequalification({
              environment: concreteEnvironment,
              priorResults,
              run: options.prequalificationVerifier?.run ?? productionCommand,
            });
          const protectedMaterialization =
            !earlyCleanup && operationId !== "certify-v2-13-release"
              ? await materialize({ operationId, state, priorResults, outerStateSha256 })
              : undefined;
          const mutationAdmission = context?.mutationAdmission;
          if (RUNPOD_PER_MUTATION_OPERATION_IDS.has(operationId)) {
            if (
              mutationAdmission?.schemaVersion !== RUNPOD_PER_MUTATION_ADMISSION_SCHEMA ||
              mutationAdmission.operationId !== operationId ||
              mutationAdmission.outerStateSha256BeforeAuthorization !==
                context?.mutationAdmissionOuterStateSha256 ||
              !HASH.test(mutationAdmission.proofSha256 ?? "")
            )
              fail("RUNPOD_MUTATION_ADMISSION_CONTEXT", operationId);
            const unsignedAdmission = { ...mutationAdmission };
            delete unsignedAdmission.proofSha256;
            if (canonicalSha256(unsignedAdmission) !== mutationAdmission.proofSha256)
              fail("RUNPOD_MUTATION_ADMISSION_HASH", operationId);
          }
          const result = await adapter(context, state, priorResults, outerStateSha256);
          if (RUNPOD_PER_MUTATION_OPERATION_IDS.has(operationId))
            return Object.freeze({
              ...result,
              mutationAdmission: mutationAdmission,
              mutationAdmissionProofSha256: mutationAdmission.proofSha256,
              mutationAdmissionCheckedAt: mutationAdmission.checkedAt,
            });
          if (operationId !== "guarded-activation-once") return result;
          if (
            !exactObjectKeys(protectedMaterialization, [
              "mediaWorkerReleaseManifestAssetSha256",
              "mediaWorkerReleaseManifestFileSha256",
              "mediaWorkerReleaseReadbackSha256",
            ]) ||
            Object.values(protectedMaterialization).some((value) => !HASH.test(value ?? ""))
          )
            fail("MEDIA_WORKER_RELEASE_MATERIALIZATION_RESULT");
          return Object.freeze({
            ...result,
            materialization: Object.freeze({
              ...result.materialization,
              ...protectedMaterialization,
            }),
          });
        },
      ]),
    ),
  );
}

// These legacy validators remain solely to read historical protected records during archive
// reconciliation. They are intentionally not part of the live adapter catalog.
void MEDIA_WORKER_RELEASE_READBACK_PARENT_OPERATION_ID;
void V213_COMMAND_PAYLOAD_KEYS;
void exactJustInTimeAcceptanceAuthority;
void readProtectedPostConsumptionMaterialization;
void injectPostConsumptionCommandPayloads;
void createAcceptanceAuthorityDatabaseAdapter;

export {
  createConcreteFullLiveAdapters,
  createRunPodPerMutationAdmissionReader,
  createPrequalificationDatabaseBootstrapAdapter,
  createPrequalificationDatabaseAdapter,
  cleanupPartialDatabaseRoleCredentials,
  databaseCredentialStagingPath,
  verifyPrequalificationDatabaseReceipt,
  createWorkflowStartAuthorityAdapter,
  createProtectedWorkflowStartAuthorityAdapter,
  createPostConsumptionMaterializationProducer,
  postConsumptionResponseHmac,
  PREQUALIFICATION_OPERATOR_FUNCTIONS,
  PREQUALIFICATION_MIGRATION_MANIFEST_PATH,
  PREQUALIFICATION_MIGRATION_MANIFEST_SHA256,
  PREQUALIFICATION_OPERATOR_GRANTS_PATH,
  PREQUALIFICATION_OPERATOR_GRANTS_SHA256,
  PREQUALIFICATION_RECEIPT_FIELDS,
  closedTrustedTimeCommand,
  createGitReleaseAdapters,
  createGuardedActivationAdapter,
  createProtectedInputMaterializer,
  createDurablePromotionFileJournal,
  createPromotionAwareCleanupAdapter,
  createQualifiedPromotionAdapter,
  createQualifiedProductionCleanupProof,
  createRecoverableQualifiedPromotionTransport,
  createV213DurableStageStore,
  createV213AcceptanceAdapters,
  createStagedQualificationAdapters,
  createTypeScriptBridgeAdapters,
  createReleaseCertificationAdapter,
  runCancellableChildProcess,
  verifyMaterializationChainFile,
  productionBridgeSpawn,
  productionCleanupReceiptSpawn,
  productionReleaseCertificationSpawn,
  createGithubDispatchAdapters,
  createGithubVerificationAdapters,
  validateAnonymousGhcrPublicationProof,
  validateSoulxWorkflowRegistrationEvidence,
  hashV213DryOutputBundle,
  preflightGuardedActivationInputs,
  preflightConcreteFullLiveInputs,
  preflightPromotionInputs,
  prepareReleaseSourceWorktree,
  resolveSourceBoundBridgeLaunch,
  readAuthenticatedGithubTime,
  exactRemoteTag,
  TAG,
};

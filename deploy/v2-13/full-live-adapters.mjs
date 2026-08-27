import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  linkSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import {
  createPromotionDatabaseAdapter,
  promoteQualifiedProduction,
} from "./promote-qualified-production.mjs";
import {
  APPROVED_WRANGLER_OAUTH_SCOPES,
  refreshWranglerOAuthReadback,
  wranglerOAuthConfigPath,
  WRANGLER_OAUTH_CONFIG_ENV,
} from "./guarded-activation.mjs";
import { validateMaterializationSeedShape } from "./full-live-orchestration-authority.mjs";
import { parseService, validateServiceFile } from "../v2-06/validate-pg-service.mjs";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const TAG = "videoforge-v2-13-release-20260826-v3";
const APPROVAL_BRANCH = "codex/serverless-v2-roadmap";
const COMMIT = /^[0-9a-f]{40}$/u;
const HASH = /^sha256:[0-9a-f]{64}$/u;
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
const BRIDGE_TRANSPORT_PATH = "apps/web/src/server/providers/v213-runpod-dual-lane-transport.ts";
const PREQUALIFICATION_MIGRATION_MANIFEST_PATH = "packages/control-plane/migrations/manifest.json";
const PREQUALIFICATION_OPERATOR_GRANTS_PATH = "deploy/v2-13/neon-full-live-operator-grants.sql";
const PREQUALIFICATION_MIGRATION_MANIFEST_SHA256 = sha256(
  readFileSync(resolve(ROOT, PREQUALIFICATION_MIGRATION_MANIFEST_PATH)),
);
const PREQUALIFICATION_OPERATOR_GRANTS_SHA256 = sha256(
  readFileSync(resolve(ROOT, PREQUALIFICATION_OPERATOR_GRANTS_PATH)),
);
const BRIDGE_CONFIRMATION = "EXECUTE_EXACT_V2_13_TYPESCRIPT_BRIDGE_COMMAND";
const BRIDGE_CHILD_MAX_TIMEOUT_MS = 1_800_000;
const BRIDGE_CLEANUP_CHILD_MAX_TIMEOUT_MS = 60_000;
const EARLY_CLEANUP_INPUT_SCHEMA = "videoforge.v213-full-live-early-cleanup-input/v1";
const PREQUALIFICATION_SCHEMA = "videoforge.v213-prequalification-database-bootstrap-result/v1";
const PREQUALIFICATION_OPERATOR_ROLE = "videoforge_hosted_operator";
const PREQUALIFICATION_RUNTIME_ROLE = "videoforge_hosted_runtime";
const PREQUALIFICATION_RECONCILER_ROLE = "videoforge_hosted_reconciler";
const PREQUALIFICATION_RECEIPT_NAME = "prequalification-database-bootstrap.json";
const PREQUALIFICATION_RECOVERY_MODES = Object.freeze([
  "FRESH_36_TO_45",
  "RESUME_EXACT_PREFIX",
  "VERIFIED_EXISTING_45",
]);
const PREQUALIFICATION_LEDGER_PREFIX_COUNTS = Object.freeze([
  36, 37, 38, 39, 40, 41, 42, 43, 44, 45,
]);
const PREQUALIFICATION_OPERATOR_FUNCTIONS = Object.freeze([
  "videoforge_load_v213_bridge_acceptance_call(jsonb)",
  "videoforge_record_v213_stage_authority(uuid,jsonb)",
  "videoforge_record_hosted_full_live_authority(uuid,jsonb)",
  "videoforge_promote_hosted_full_live(uuid,uuid,jsonb)",
  "videoforge_record_v213_cloudflare_activation(uuid,jsonb)",
  "videoforge_record_v213_cloudflare_rollback(uuid,jsonb)",
  "videoforge_claim_v213_stage_authority(jsonb)",
  "videoforge_complete_v213_stage_authority(text,text,jsonb)",
  "videoforge_load_v213_stage_handoff(uuid,text,text)",
  "videoforge_load_v213_cleanup_scope(uuid)",
  "videoforge_claim_v213_operation(jsonb)",
  "videoforge_transition_v213_operation(jsonb)",
  "videoforge_claim_v213_bridge_command(jsonb)",
  "videoforge_transition_v213_bridge_command(jsonb)",
  "videoforge_record_v213_receipt_verification_key(text,text)",
  "videoforge_publish_v213_qualified_deployments(jsonb)",
  "videoforge_record_v213_workflow_start_authority(uuid,uuid,text,timestamptz)",
]);
const PREQUALIFICATION_RECEIPT_FIELDS = Object.freeze([
  "schema_version",
  "ledger_before_count",
  "ledger_before_sha256",
  "ledger_after_sha256",
  "operator_acl_sha256",
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
const BRIDGE_PROTECTED_FILES = Object.freeze([
  ["RUNPOD_API_KEY_FD", "VIDEOFORGE_V2_13_RUNPOD_API_KEY_FILE"],
  ["OPERATOR_DATABASE_URL_FD", "VIDEOFORGE_V2_13_OPERATOR_DATABASE_URL_FILE"],
  ["RUNTIME_DATABASE_URL_FD", "VIDEOFORGE_V2_13_RUNTIME_DATABASE_URL_FILE"],
  ["RECONCILER_DATABASE_URL_FD", "VIDEOFORGE_V2_13_RECONCILER_DATABASE_URL_FILE"],
  ["WORKER_ORIGIN_FD", "VIDEOFORGE_V2_13_WORKER_ORIGIN_FILE"],
  ["WORKER_OPERATOR_BEARER_FD", "VIDEOFORGE_V2_13_WORKER_OPERATOR_BEARER_FILE"],
  ["PRODUCTION_SECRETS_FD", "VIDEOFORGE_V2_13_PRODUCTION_SECRETS_FILE"],
]);

const fail = (code, detail = "") => {
  throw new Error(`V2_13_FULL_LIVE_ADAPTER_${code}${detail ? `:${detail}` : ""}`);
};

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
} = {}) {
  const response = exactCommand((command, args) => run(command, args, spawnTimeoutMs), "curl", [
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
    "https://api.github.com/rate_limit",
  ]);
  const dates = response.stdout
    .split(/\r?\n/u)
    .filter((line) => /^date:/iu.test(line))
    .map((line) => line.slice(line.indexOf(":") + 1).trim());
  if (dates.length !== 1 || Number.isNaN(Date.parse(dates[0]))) fail("TRUSTED_TIME_READBACK");
  return new Date(Date.parse(dates[0])).toISOString();
}

function createGitReleaseAdapters({ run = productionCommand } = {}) {
  return Object.freeze({
    "release-tag-create": async (_operation, state) => {
      const tag = state.release_ref?.exact_tag_name;
      const target = state.release_source_commit;
      if (tag !== TAG || !COMMIT.test(target ?? "")) fail("RELEASE_LINEAGE");
      const local = exactCommand(run, "git", ["show-ref", "--verify", `refs/tags/${tag}`], [0, 1]);
      if (local.status !== 1 || local.stdout !== "") fail("LOCAL_TAG_ALREADY_EXISTS");
      const remote = exactCommand(run, "git", [
        "ls-remote",
        "--refs",
        "origin",
        `refs/tags/${tag}`,
      ]);
      if (exactRemoteTag(remote.stdout, tag, target, true)) fail("REMOTE_TAG_ALREADY_EXISTS");
      exactCommand(run, "git", ["tag", tag, target]);
      const readback = exactCommand(run, "git", ["rev-parse", `refs/tags/${tag}^{commit}`]);
      if (readback.stdout.trim() !== target) fail("LOCAL_TAG_CREATE_READBACK");
      return { actualUsd: 0, created: true, targetCommit: target };
    },
    "release-tag-push": async (_operation, state) => {
      const tag = state.release_ref?.exact_tag_name;
      const target = state.release_source_commit;
      if (tag !== TAG || !COMMIT.test(target ?? "")) fail("RELEASE_LINEAGE");
      const local = exactCommand(run, "git", ["rev-parse", `refs/tags/${tag}^{commit}`]);
      if (local.stdout.trim() !== target) fail("LOCAL_TAG_PUSH_READBACK");
      exactCommand(run, "git", [
        "push",
        "--porcelain",
        "origin",
        `refs/tags/${tag}:refs/tags/${tag}`,
      ]);
      return { actualUsd: 0, tagName: tag, targetCommit: target, forceUsed: false };
    },
    "release-tag-readback": async (_operation, state) => {
      const tag = state.release_ref?.exact_tag_name;
      const target = state.release_source_commit;
      if (tag !== TAG || !COMMIT.test(target ?? "")) fail("RELEASE_LINEAGE");
      const remote = exactCommand(run, "git", [
        "ls-remote",
        "--refs",
        "origin",
        `refs/tags/${tag}`,
      ]);
      exactRemoteTag(remote.stdout, tag, target);
      return { actualUsd: 0, tagName: tag, targetCommit: target };
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
      if (!/^[0-9a-f]{40}\trefs\/heads\/codex\/serverless-v2-roadmap$/u.test(remoteBefore))
        fail("APPROVAL_BRANCH_READBACK");
      const remoteCommit = remoteBefore.slice(0, 40);
      exactCommand(run, "git", ["merge-base", "--is-ancestor", remoteCommit, commit]);
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
      return { actualUsd: 0, commit, branch: APPROVAL_BRANCH, exactRemoteReadback: true };
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

function createGithubDispatchAdapters({
  run = productionCommand,
  wait = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds)),
  maximumPolls = 30,
  pollIntervalMs = 2_000,
} = {}) {
  if (!Number.isInteger(maximumPolls) || maximumPolls < 1 || maximumPolls > 60)
    fail("GITHUB_POLL_BOUND");
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 0 || pollIntervalMs > 10_000)
    fail("GITHUB_POLL_INTERVAL");

  const dispatch = async ({ state, workflowFile, workflowName, fields }) => {
    const tag = state.release_ref?.exact_tag_name;
    const headSha = state.release_source_commit;
    if (
      state.release_ref?.state !== "VERIFIED_EXACT_REMOTE" ||
      tag !== TAG ||
      !COMMIT.test(headSha)
    )
      fail("WORKFLOW_RELEASE_REF");
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
        };
    }
    fail("GITHUB_DISPATCH_RUN_NOT_FOUND");
  };

  return Object.freeze({
    "mage-image-workflow-dispatch": async (_operation, state) =>
      dispatch({
        state,
        workflowFile: "mage-image.yml",
        workflowName: "mage-image",
        fields: [["publish", "true"]],
      }),
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
  },
  "soulx-image-workflow-verification": {
    workflowName: "avatar-primary-serverless-image",
    artifactName: "soulx-serverless-v2-08-deployability",
    fileName: "soulx-serverless-v2-08.json",
    checkpoint: "V2-08",
    lane: "soulx_avatar",
    repository: "pala-lakshmansai/videoforge-soulx-serverless-v2-08",
    digestKey: "image_digest",
  },
});

function createGithubVerificationAdapters({
  run = (command, args, timeoutMs) => boundedCommand(command, args, timeoutMs),
  wait = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds)),
  maximumPolls = 180,
  pollIntervalMs = 10_000,
  wallTimeoutMs = 1_800_000,
  deadlineNow = () => performance.now(),
  trustedTime = (timeoutMs) =>
    readAuthenticatedGithubTime({ spawnTimeoutMs: Math.min(12_000, timeoutMs) }),
  isCancelled = () => false,
} = {}) {
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
          if (
            evidence?.schema_version !== "videoforge-image-deployability/v1" ||
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
          remaining();
          return {
            actualUsd: 0,
            runId,
            headSha: state.release_source_commit,
            imageDigest: digest,
            evidenceSha256: sha256(evidenceBytes),
            publicManifestSha256: digest,
            publicAllBlobsVerified: true,
            conclusion: "success",
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
    const source = prepareSource(state.release_source_commit);
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

function createQualifiedPromotionAdapter({
  record,
  disabledConfigBytes,
  transport,
  database,
  cloudflare,
}) {
  if (!transport) {
    const db = createPromotionDatabaseAdapter(database);
    if (
      cloudflare === null ||
      typeof cloudflare !== "object" ||
      ["dryRun", "deploy", "readback", "routeReadback", "rollback"].some(
        (name) => typeof cloudflare[name] !== "function",
      )
    )
      fail("PROMOTION_CLOUDFLARE_TRANSPORT");
    transport = Object.freeze({
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
          readback: {
            schemaVersion: "videoforge.v213-cloudflare-activation-readback/v1",
            sourceCommit: readback.sourceCommit,
            versionIdSha256: readback.versionIdSha256,
            deployedConfigSha256: readback.deployedConfigSha256,
            observedAt: readback.observedAt,
          },
        }),
      recordRollback: ({ rollbackId, activationId, promotionId, ...readback }) =>
        db.recordCloudflareRollback({
          rollbackId,
          activationId,
          promotionId,
          readback: {
            schemaVersion: "videoforge.v213-cloudflare-rollback-readback/v1",
            disabledVersionIdSha256: readback.disabledVersionIdSha256,
            disabledConfigSha256: readback.disabledConfigSha256,
            routeStatus: readback.routeStatus,
            routeVersionSha256: readback.routeVersionSha256,
            observedAt: readback.observedAt,
          },
        }),
    });
  }
  return async () => ({
    actualUsd: 0,
    ...(await promoteQualifiedProduction({ record, disabledConfigBytes, transport })),
  });
}

function createProtectedPromotionAdapter({
  environment = process.env,
  spawn = spawnSync,
  fetchImpl = fetch,
} = {}) {
  return async (_operation, state) => {
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
    const runWrangler = (args) => {
      if (!/^[0-9a-f]{32}$/u.test(cloudflareAccountId ?? "")) fail("PROMOTION_ACCOUNT_ID_DRIFT");
      refreshWranglerOAuthReadback({
        configPath: oauthConfigPath,
        environment,
        accountId: cloudflareAccountId,
        expectedScopes,
        spawn,
      });
      const result = spawn("pnpm", ["--filter", "@videoforge/web", "exec", "wrangler", ...args], {
        cwd: ROOT,
        encoding: "utf8",
        shell: false,
        env: oauthEnvironment,
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 4 * 1024 * 1024,
      });
      if (result.status !== 0 || typeof result.stdout !== "string")
        fail("PROMOTION_CLOUDFLARE_COMMAND");
      return result.stdout;
    };
    const activeVersion = () => {
      let value;
      try {
        value = JSON.parse(
          runWrangler(["deployments", "status", "--json", "--config", enabledPath]),
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
    const cloudflare = {
      dryRun: async (bytes) => {
        enabledConfig = JSON.parse(bytes.toString("utf8"));
        if (!/^[0-9a-f]{32}$/u.test(String(enabledConfig.account_id ?? "")))
          fail("PROMOTION_ACCOUNT_ID_DRIFT");
        cloudflareAccountId = String(enabledConfig.account_id);
        if (cloudflareAccountId !== promotionPreflight.accountId)
          fail("PROMOTION_ACCOUNT_ID_DRIFT");
        if (sha256(Buffer.from(cloudflareAccountId)) !== record.cloudflare.account_id_sha256)
          fail("PROMOTION_ACCOUNT_ID_DRIFT");
        writeFileSync(enabledPath, bytes, { mode: 0o600 });
        const build = spawn("pnpm", ["--filter", "@videoforge/web", "build:cloudflare"], {
          cwd: ROOT,
          encoding: "utf8",
          shell: false,
          env: { PATH: environment.PATH ?? process.env.PATH, CI: "1" },
          stdio: ["ignore", "pipe", "pipe"],
        });
        if (build.status !== 0) fail("PROMOTION_PRODUCTION_FIREWALL");
        const stdout = runWrangler([
          "deploy",
          "--dry-run",
          "--outdir",
          dryOutput,
          "--config",
          enabledPath,
        ]);
        return {
          configSha256: sha256(bytes),
          bundleSha256: sha256(Buffer.from(stdout)),
          productionFirewallPassed: true,
          providerSendPerformed: false,
        };
      },
      deploy: async (bytes) => {
        runWrangler(["deploy", "--config", enabledPath]);
        const versionId = activeVersion();
        return {
          configSha256: sha256(bytes),
          versionSha256: sha256(Buffer.from(versionId)),
          versionId,
          providerSendPerformed: false,
        };
      },
      readback: async (deployed) => {
        const versionId = activeVersion();
        if (deployed.versionId !== versionId) fail("PROMOTION_DEPLOYED_VERSION_DRIFT");
        let version;
        try {
          version = JSON.parse(
            runWrangler(["versions", "view", versionId, "--json", "--config", enabledPath]),
          );
        } catch {
          fail("PROMOTION_BINDING_READBACK");
        }
        const versionText = JSON.stringify(version);
        const exactBindings = [
          "VIDEO_WORKFLOW",
          "HOSTED_PAIR_WORKFLOW",
          "VIDEOFORGE_RUNTIME_DATABASE",
          "VIDEOFORGE_RECONCILER_DATABASE",
          "VIDEOFORGE_GPU_TRANSPORT",
        ].every((name) => versionText.includes(name));
        const proof = {
          versionId,
          configSha256: record.release.enabled_config_sha256,
          exactBindings,
        };
        return {
          versionSha256: sha256(Buffer.from(versionId)),
          configSha256: record.release.enabled_config_sha256,
          workerName: record.cloudflare.worker_name,
          workflowName: record.cloudflare.workflow_name,
          pairWorkflowName: `${record.cloudflare.workflow_name}-pair`,
          publicOrigin: record.cloudflare.public_origin,
          gpuTransport: enabledConfig.vars.VIDEOFORGE_GPU_TRANSPORT,
          exactBindings,
          providerSendPerformed: false,
          evidenceSha256: sha256(Buffer.from(JSON.stringify(proof))),
        };
      },
      routeReadback: async (readback) => {
        let route;
        try {
          route = await fetchImpl(`${record.cloudflare.public_origin}/api/v2/hosted/status`, {
            method: "GET",
            redirect: "error",
            signal: AbortSignal.timeout(30_000),
          });
        } catch {
          fail("PROMOTION_ROUTE_READBACK");
        }
        const versionId = route.headers.get("x-videoforge-worker-version");
        let body;
        try {
          body = await route.json();
        } catch {
          fail("PROMOTION_ROUTE_READBACK");
        }
        return {
          routeReady: route.ok && sha256(Buffer.from(versionId ?? "")) === readback.versionSha256,
          routeStatus: route.status,
          routeVersionSha256: versionId ? sha256(Buffer.from(versionId)) : null,
          gpuTransport: body?.gpu_transport,
        };
      },
      rollback: async (bytes) => {
        writeFileSync(disabledRollbackPath, bytes, { mode: 0o600 });
        runWrangler([
          "rollback",
          record.cloudflare.disabled_version_id,
          "--yes",
          "--config",
          disabledRollbackPath,
        ]);
        const versionId = activeVersion();
        let route;
        try {
          route = await fetchImpl(`${record.cloudflare.public_origin}/api/v2/hosted/status`, {
            method: "GET",
            redirect: "error",
            signal: AbortSignal.timeout(30_000),
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
        return {
          gpuTransport: body?.gpu_transport,
          configSha256: sha256(bytes),
          versionSha256: sha256(Buffer.from(versionId)),
          providerSendPerformed: false,
          routeDisabled: versionId === record.cloudflare.disabled_version_id,
          routeStatus: route.status,
          routeVersionSha256: routeVersionId ? sha256(Buffer.from(routeVersionId)) : null,
          observedAt: new Date().toISOString(),
        };
      },
    };
    try {
      return {
        actualUsd: 0,
        ...(await promoteQualifiedProduction({
          record,
          disabledConfigBytes,
          transport: (() => {
            const db = createPromotionDatabaseAdapter(database);
            return {
              promoteDatabase: db.promote,
              ...cloudflare,
              recordActivation: ({ activationId, promotionId, ...readback }) =>
                db.recordCloudflareActivation({
                  activationId,
                  promotionId,
                  readback: {
                    schemaVersion: "videoforge.v213-cloudflare-activation-readback/v1",
                    sourceCommit: readback.sourceCommit,
                    versionIdSha256: readback.versionIdSha256,
                    deployedConfigSha256: readback.deployedConfigSha256,
                    observedAt: readback.observedAt,
                  },
                }),
              recordRollback: ({ rollbackId, activationId, promotionId, ...readback }) =>
                db.recordCloudflareRollback({
                  rollbackId,
                  activationId,
                  promotionId,
                  readback: {
                    schemaVersion: "videoforge.v213-cloudflare-rollback-readback/v1",
                    disabledVersionIdSha256: readback.disabledVersionIdSha256,
                    disabledConfigSha256: readback.disabledConfigSha256,
                    routeStatus: readback.routeStatus,
                    routeVersionSha256: readback.routeVersionSha256,
                    observedAt: readback.observedAt,
                  },
                }),
            };
          })(),
        })),
      };
    } finally {
      await pool.end();
      rmSync(directory, { recursive: true, force: true });
    }
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
  "production-input",
  "max-one-endpoint-bindings",
  "activation-record",
  "promotion-record",
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
    for (let index = 0; index < kinds.length; index += 1) {
      if (kinds[index] !== MATERIALIZATION_STAGE_ORDER[index]) fail("MATERIALIZATION_CHAIN_ORDER");
    }
  }
  return chain;
}

const materializationStageForOperation = (operationId) => {
  if (operationId === "fresh-live-preflight") return "production-input";
  if (operationId === "create-exact-max-one-endpoints") return "max-one-endpoint-bindings";
  if (operationId === "guarded-activation-once") return "activation-record";
  if (operationId === "promote-qualified-production") return "promotion-record";
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
      ? 1
      : MATERIALIZATION_STAGE_ORDER.indexOf(expectedKind) + 1;
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
      deployment.workersMin !== 0 ||
      deployment.workersMax !== 1 ||
      !HASH.test(deployment.deploymentSha256 ?? "")
    )
      fail("MAX_ONE_DEPLOYMENT_MATERIALIZATION", lane);
    output[lane] = Object.freeze({
      endpointId: deployment.endpointId,
      endpointIdSha256: deployment.endpointIdSha256,
      deploymentSnapshotSha256: sha256(Buffer.from(`${canonicalJson(deployment)}\n`)),
    });
  }
  if (output.mage.endpointId === output.soulx.endpointId)
    fail("MAX_ONE_DEPLOYMENT_MATERIALIZATION_DISTINCT");
  return Object.freeze(output);
}

function protectedDirectory(path, code) {
  const status = lstatSync(path);
  if (!status.isDirectory() || status.isSymbolicLink() || (status.mode & 0o077) !== 0) fail(code);
  return path;
}

function exclusiveAtomicBytes(path, bytes) {
  protectedDirectory(dirname(path), "MATERIALIZATION_OUTPUT_DIRECTORY");
  const temporary = `${path}.${randomBytes(8).toString("hex")}.next`;
  writeFileSync(temporary, bytes, { mode: 0o600, flag: "wx" });
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

function prequalificationFunctionSignatureSql(functionAlias = "p", namespaceAlias = "n") {
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
    manifest.migrations.length !== 45
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

function prequalificationReceiptFromFile(path) {
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
    !PREQUALIFICATION_LEDGER_PREFIX_COUNTS.includes(value.ledger_before_count) ||
    !HASH.test(value.ledger_before_sha256 ?? "") ||
    !HASH.test(value.ledger_after_sha256 ?? "") ||
    !HASH.test(value.operator_acl_sha256 ?? "") ||
    !HASH.test(value.pgcrypto_sha256 ?? "") ||
    !PREQUALIFICATION_RECOVERY_MODES.includes(value.recovery_mode) ||
    (value.recovery_mode === "FRESH_36_TO_45" && value.ledger_before_count !== 36) ||
    (value.recovery_mode === "RESUME_EXACT_PREFIX" &&
      ![37, 38, 39, 40, 41, 42, 43, 44].includes(value.ledger_before_count)) ||
    (value.recovery_mode === "VERIFIED_EXISTING_45" && value.ledger_before_count !== 45) ||
    value.runpod_calls !== 0 ||
    value.cloudflare_calls !== 0 ||
    value.application_secret_reads !== 0 ||
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
  run = productionCommand,
} = {}) {
  // Receipt bytes and the outer prior-result CAS are checked before any database credential,
  // RunPod key, or application secret is opened.
  const receipt = prequalificationReceiptFromFile(prequalificationPath(environment));
  const bootstrap = priorResults?.get?.("bootstrap-prequalification-database");
  if (
    bootstrap?.prequalification_database_bootstrap_sha256 !==
    receipt?.prequalification_database_bootstrap_sha256
  )
    fail("PREQUALIFICATION_RECEIPT_OUTER_CAS");

  const directory = protectedDirectory(
    environment.VIDEOFORGE_V2_13_POSTGRES_INPUT_DIR,
    "PREQUALIFICATION_VERIFY_POSTGRES_DIRECTORY",
  );
  const servicePath = join(directory, "owner.pg_service.conf");
  const passPath = join(directory, "owner.pgpass");
  const service = await parseService(servicePath, "videoforge_v2_13_owner");
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
    ledger.length !== 45 ||
    sha256(Buffer.from(`${canonicalJson(ledger)}\n`)) !== receipt.ledger_after_sha256
  )
    fail("PREQUALIFICATION_VERIFY_LEDGER");
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
} = {}) {
  return async () => {
    const directory = protectedDirectory(
      environment.VIDEOFORGE_V2_13_POSTGRES_INPUT_DIR,
      "PREQUALIFICATION_POSTGRES_DIRECTORY",
    );
    const servicePath = join(directory, "owner.pg_service.conf");
    const passPath = join(directory, "owner.pgpass");
    const operatorPath = join(directory, "operator.database-url");
    const service = await parseService(servicePath, "videoforge_v2_13_owner");
    protectedFile(passPath, "PREQUALIFICATION_OWNER_PASS");
    protectedFile(operatorPath, "PREQUALIFICATION_OPERATOR_DSN");
    await validateServiceFile(
      servicePath,
      "videoforge_v2_13_owner",
      service.get("host"),
      service.get("dbname"),
      service.get("user"),
    );
    if (service.get("user") === PREQUALIFICATION_OPERATOR_ROLE)
      fail("PREQUALIFICATION_OWNER_OPERATOR_COLLISION");
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
    const receiptPath = prequalificationPath(environment);
    const existing = prequalificationReceiptFromFile(receiptPath);
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
      (before.length < 45 && operatorCount !== 0)
    )
      fail("PREQUALIFICATION_OPERATOR_ROLE_DRIFT");
    if (operatorCount === 1) {
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
    if (existing && before.length !== 45) fail("PREQUALIFICATION_RECEIPT_STATE_DRIFT");
    const recoveryMode =
      before.length === 36
        ? "FRESH_36_TO_45"
        : before.length === 45
          ? "VERIFIED_EXISTING_45"
          : "RESUME_EXACT_PREFIX";
    if (!existing && before.length < 45) {
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
    if (!existing && operatorCount === 0) {
      // The operator DSN is deliberately not decoded or opened until the migration prefix is
      // complete.  Owner credentials are the only database inputs used for prefix discovery and
      // migrations; the operator password is needed only for the post-migration role creation.
      const operatorRaw = readFileSync(operatorPath, "utf8");
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
      // Role creation and grant application run after the migration prefix has reached 45.  The
      // role password is supplied through psql's private environment channel and never argv/logs.
      const createRoleSql = String.raw`BEGIN;
SELECT pg_advisory_xact_lock(${PREQUALIFICATION_ADVISORY_LOCK});
${prequalificationPrefixGuardSql(manifest, 45)}
\getenv operator_password V2_13_OPERATOR_PASSWORD
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS',${prequalificationLiteral(PREQUALIFICATION_OPERATOR_ROLE)}, :'operator_password') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=${prequalificationLiteral(PREQUALIFICATION_OPERATOR_ROLE)}) \gexec`;
      const roleSql = `${createRoleSql}\nCOMMIT;\n`;
      prequalificationCommand(
        run,
        "psql",
        ["--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--command", roleSql],
        operatorEnv,
        "PREQUALIFICATION_OPERATOR_CREATE",
      );
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
        dbEnv,
        "PREQUALIFICATION_OPERATOR_GRANTS",
      );
    }
    const ledger = prequalificationLockedLedger(query, manifest);
    if (ledger.length !== 45) fail("PREQUALIFICATION_LEDGER_FINAL");
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
        existing.pgcrypto_sha256 !== after.pgcrypto_sha256
      )
        fail("PREQUALIFICATION_RECEIPT_REPLAY_DRIFT");
    }
    const body = {
      schema_version: PREQUALIFICATION_SCHEMA,
      ledger_before_count: before.length,
      ledger_before_sha256: beforeSha256,
      ...after,
      recovery_mode: recoveryMode,
      runpod_calls: 0,
      cloudflare_calls: 0,
      application_secret_reads: 0,
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

function createWorkflowStartAuthorityAdapter({ database, input } = {}) {
  const db =
    database !== null && typeof database === "object" && typeof database.query === "function"
      ? createPromotionDatabaseAdapter(database)
      : null;
  return async (operation = {}, state = {}, priorResults = new Map()) => {
    if (db === null) fail("WORKFLOW_AUTHORITY_DATABASE_REQUIRED");
    const supplied =
      typeof input === "function"
        ? await input({ operation, state, priorResults })
        : (input ?? operation.workflowStartAuthority ?? state.workflow_start_authority);
    const expectedKeys = ["workflowAuthorityId", "authorityId", "tokenSha256", "expiresAt"];
    if (
      supplied === null ||
      typeof supplied !== "object" ||
      Array.isArray(supplied) ||
      JSON.stringify(Object.keys(supplied).sort()) !== JSON.stringify([...expectedKeys].sort()) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
        supplied.workflowAuthorityId ?? "",
      ) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
        supplied.authorityId ?? "",
      ) ||
      !HASH.test(supplied.tokenSha256 ?? "") ||
      typeof supplied.expiresAt !== "string" ||
      Number.isNaN(Date.parse(supplied.expiresAt))
    )
      fail("WORKFLOW_AUTHORITY_INPUT");
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
  };
}

function createProtectedInputMaterializer({
  environment = process.env,
  run = productionCommand,
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
    // consumption. The local checks below retain adapter-specific future-value diagnostics, while
    // this shared predicate prevents the two boundaries from drifting apart.
    if (!validateMaterializationSeedShape(value)) fail("MATERIALIZATION_SEED_CONTRACT");
    const forbiddenFutureKeys = new Set([
      "mageEndpointId",
      "soulxEndpointId",
      "endpointId",
      "endpointIdSha256",
      "deploymentSnapshotSha256",
      "deployment_snapshot_sha256",
      "mage_deployment_snapshot_sha256",
      "soulx_deployment_snapshot_sha256",
      "imageDigest",
      "publicManifestSha256",
      "versionId",
      "versionSha256",
      "disabledVersionId",
      "disabledVersionSha256",
      "futureOutputHash",
      "futureOutputSha256",
      "futureOutputHashes",
    ]);
    const forbiddenFutureKeysLower = new Set(
      [...forbiddenFutureKeys, ...GUARDED_SECRET_NAMES.slice(17, 21)].map((key) =>
        key.toLowerCase(),
      ),
    );
    const hasForbiddenFutureKey = (item) =>
      item !== null &&
      typeof item === "object" &&
      Object.entries(item).some(
        ([key, nested]) =>
          forbiddenFutureKeysLower.has(key.toLowerCase()) || hasForbiddenFutureKey(nested),
      );
    const hasForbiddenCommandSelector = (item) =>
      item !== null &&
      typeof item === "object" &&
      Object.entries(item).some(
        ([key, nested]) =>
          [
            "mageendpointid",
            "soulxendpointid",
            "endpointid",
            "endpointidsha256",
            "publicimage",
            "sourcecommit",
            "deploymentsha256",
            "deploymentsnapshotsha256",
            "deployment_snapshot_sha256",
          ].includes(key.toLowerCase()) || hasForbiddenCommandSelector(nested),
      );
    const laneFields = ["publicImage", "deploymentSha256", "sourceCommit"];
    const laneHasFutureValue = (lane) =>
      lane !== null &&
      typeof lane === "object" &&
      laneFields.some((field) => Object.hasOwn(lane, field) && lane[field] !== null);
    const dynamicSeedValues = [
      value?.production_input_base?.dualLaneInput?.mage?.publicImage,
      value?.production_input_base?.dualLaneInput?.mage?.deploymentSha256,
      value?.production_input_base?.dualLaneInput?.mage?.sourceCommit,
      value?.production_input_base?.dualLaneInput?.soulx?.publicImage,
      value?.production_input_base?.dualLaneInput?.soulx?.deploymentSha256,
      value?.production_input_base?.dualLaneInput?.soulx?.sourceCommit,
      value?.activation_record_base?.release?.production_config_activation_sha256,
      value?.activation_record_base?.release?.media_worker_release_manifest_sha256,
      value?.activation_record_base?.gates?.mage_qualification_sha256,
      value?.activation_record_base?.gates?.soulx_qualification_sha256,
      value?.activation_record_base?.gates?.mage_deployment_snapshot_sha256,
      value?.activation_record_base?.gates?.soulx_deployment_snapshot_sha256,
      value?.activation_record_base?.gates?.paid_dispatch_authority_sha256,
      value?.promotion_record_base?.release?.disabled_config_sha256,
      value?.promotion_record_base?.release?.enabled_config_sha256,
      value?.promotion_record_base?.database?.authority_document_sha256,
      value?.promotion_record_base?.lanes?.mage_image?.qualification_record_sha256,
      value?.promotion_record_base?.lanes?.mage_image?.deployment_snapshot_sha256,
      value?.promotion_record_base?.lanes?.soulx_avatar?.qualification_record_sha256,
      value?.promotion_record_base?.lanes?.soulx_avatar?.deployment_snapshot_sha256,
      value?.promotion_record_base?.cloudflare?.disabled_version_id,
      value?.promotion_record_base?.cloudflare?.disabled_version_sha256,
    ];
    const exactObjectKeys = (item, keys) =>
      item !== null &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      JSON.stringify(Object.keys(item).sort()) === JSON.stringify([...keys].sort());
    const exactEmptyObject = (item) => exactObjectKeys(item, []);
    const validateBaseObject = (item, keys, nested = []) =>
      item !== null &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      Object.keys(item).every((key) => keys.includes(key)) &&
      nested.every(
        ([key, nestedKeys]) => !Object.hasOwn(item, key) || exactObjectKeys(item[key], nestedKeys),
      );
    const validateNestedSeedShape = () => {
      const production = value?.production_input_base;
      const lanes = production?.dualLaneInput;
      const laneKeys = [
        "deploymentSha256",
        "publicImage",
        "sourceCommit",
        "volumeIdSha256",
        "volumeManifestSha256",
      ];
      if (
        !exactObjectKeys(production, [
          "authorityDocument",
          "commandPayloads",
          "dualLaneInput",
          "fullLiveAuthorityId",
          "schemaVersion",
        ]) ||
        production.schemaVersion !== "videoforge.v213-full-live-outer-input/v1" ||
        typeof production.fullLiveAuthorityId !== "string" ||
        production.fullLiveAuthorityId === "" ||
        !exactEmptyObject(production.authorityDocument) ||
        !exactObjectKeys(lanes, ["mage", "soulx"]) ||
        !exactEmptyObject(production.commandPayloads) ||
        !validateBaseObject(
          value.activation_record_base,
          ["authority", "database", "gates", "release"],
          [
            ["authority", []],
            ["database", []],
            ["gates", []],
            ["release", []],
          ],
        ) ||
        !validateBaseObject(
          value.config_activation_base,
          ["authority", "release"],
          [
            ["authority", []],
            ["release", []],
          ],
        ) ||
        !exactEmptyObject(value.release_manifest) ||
        !validateBaseObject(value.promotion_record_base, [
          "approval",
          "cloudflare",
          "database",
          "lanes",
          "release",
        ]) ||
        (Object.hasOwn(value.promotion_record_base, "lanes") &&
          (!exactObjectKeys(value.promotion_record_base.lanes, ["mage_image", "soulx_avatar"]) ||
            !exactEmptyObject(value.promotion_record_base.lanes.mage_image) ||
            !exactEmptyObject(value.promotion_record_base.lanes.soulx_avatar)))
      )
        return false;
      return [lanes.mage, lanes.soulx].every(
        (lane) =>
          lane !== null &&
          typeof lane === "object" &&
          !Array.isArray(lane) &&
          Object.keys(lane).every((key) => laneKeys.includes(key)) &&
          ["volumeIdSha256", "volumeManifestSha256"].every(
            (key) => !Object.hasOwn(lane, key) || HASH.test(lane[key] ?? ""),
          ) &&
          laneFields.every((key) => !Object.hasOwn(lane, key) || lane[key] === null),
      );
    };
    if (
      value?.schema_version !== "videoforge.v213-full-live-materialization-seed/v1" ||
      value.static_only !== true ||
      value.future_output_hashes_present !== false ||
      JSON.stringify(Object.keys(value).sort()) !==
        JSON.stringify(
          [
            "activation_record_base",
            "config_activation_base",
            "future_output_hashes_present",
            "production_input_base",
            "promotion_record_base",
            "release_manifest",
            "schema_version",
            "static_only",
          ].sort(),
        ) ||
      hasForbiddenFutureKey(value) ||
      hasForbiddenCommandSelector(value?.production_input_base?.commandPayloads) ||
      laneHasFutureValue(value?.production_input_base?.dualLaneInput?.mage) ||
      laneHasFutureValue(value?.production_input_base?.dualLaneInput?.soulx) ||
      dynamicSeedValues.some((item) => item !== undefined && item !== null) ||
      !validateNestedSeedShape()
    )
      fail("MATERIALIZATION_SEED_CONTRACT");
    const seedSha256 = sha256(Buffer.from(`${canonicalJson(value)}\n`));
    if (
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
      const source = seed(state);
      const mage = exactReceipt(priorResults, "mage-image-workflow-verification");
      const soulx = exactReceipt(priorResults, "soulx-image-workflow-verification");
      const production = structuredClone(source.production_input_base);
      production.authorityDocument = {
        ...production.authorityDocument,
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
      };
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
        },
        outputs: { production_input_sha256: output },
      });
      return;
    }
    if (operationId === "guarded-activation-once") {
      const source = seed(state);
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
        source.release_manifest,
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
      return;
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

function productionBridgeSpawn({ environment, request, timeoutMs = BRIDGE_CHILD_MAX_TIMEOUT_MS }) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > BRIDGE_CHILD_MAX_TIMEOUT_MS)
    fail("BRIDGE_CHILD_TIMEOUT_INVALID");
  const directory = mkdtempSync(resolve(tmpdir(), "videoforge-v213-bridge-"));
  const requestPath = resolve(directory, "request.json");
  const opened = [];
  try {
    writeFileSync(requestPath, `${JSON.stringify(request)}\n`, { encoding: "utf8", mode: 0o600 });
    const earlyCleanup = request.input?.schemaVersion === EARLY_CLEANUP_INPUT_SCHEMA;
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
    const files = [
      ["REQUEST_FD", requestPath],
      ...protectedFiles.map(([fdName, variable]) => [
        fdName,
        protectedFile(environment[variable], `BRIDGE_PROTECTED_FILE:${variable}`),
      ]),
    ];
    for (const [, path] of files) opened.push(openSync(path, "r"));
    const childEnvironment = {
      PATH: environment.PATH ?? process.env.PATH,
      VIDEOFORGE_V213_BRIDGE_COMMAND: request.command,
    };
    files.forEach(([name], index) => {
      childEnvironment[`VIDEOFORGE_V213_BRIDGE_${name}`] = String(index + 3);
    });
    const result = spawnSync(
      "pnpm",
      ["--filter", "@videoforge/web", "exec", "tsx", BRIDGE_PATH, "--execute", BRIDGE_CONFIRMATION],
      {
        cwd: ROOT,
        encoding: "utf8",
        env: childEnvironment,
        stdio: ["ignore", "pipe", "pipe", ...opened],
        maxBuffer: 4 * 1024 * 1024,
        timeout: timeoutMs,
        killSignal: "SIGTERM",
      },
    );
    if (
      result.error?.code === "ETIMEDOUT" ||
      (result.signal !== null && result.signal !== undefined)
    )
      fail("BRIDGE_CHILD_TIMEOUT");
    if (result.status !== 0 || typeof result.stdout !== "string") fail("BRIDGE_EXECUTION");
    return JSON.parse(result.stdout);
  } finally {
    for (const fd of opened) closeSync(fd);
    rmSync(directory, { recursive: true, force: true });
  }
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
    const operator = join(directory, "operator.database-url");
    protectedFile(pass, "PREQUALIFICATION_OWNER_PASS");
    protectedFile(operator, "PREQUALIFICATION_OPERATOR_DSN");
    protectedFile(service, "PREQUALIFICATION_OWNER_SERVICE");
    return Object.freeze({ bootstrapOnly: true, postgresInputDirectory: directory });
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
    (authority.authorityId !== state.authority_id ||
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
    sha256(readFileSync(environment.VIDEOFORGE_V2_13_PROPOSAL_FILE)) !== state.proposal_sha256 ||
    sha256(readFileSync(environment.VIDEOFORGE_V2_13_USER_APPROVAL_FILE)) !== state.approval_sha256
  )
    fail("GUARDED_OUTER_AUTHORITY_LINEAGE");
  return Object.freeze({ guardedAuthority });
}

function createTypeScriptBridgeAdapters({
  environment = process.env,
  spawnBridge = productionBridgeSpawn,
  requirePrequalificationReceipt = false,
  expectedCliSha256 = "sha256:2a5a29c71bf5f0c2aa776e4ad8ba2a66b7144d9b12108d37819d8a3baa9efcd7",
  expectedTransportSha256 = "sha256:7d2ac27d25f6906aae1147833618e4a471ef0ca72f7ea6159ea993444ae53fe6",
} = {}) {
  const actualCliSha256 = sha256(readFileSync(resolve(ROOT, BRIDGE_PATH)));
  const actualTransportSha256 = sha256(readFileSync(resolve(ROOT, BRIDGE_TRANSPORT_PATH)));
  if (actualCliSha256 !== expectedCliSha256) fail("BRIDGE_SOURCE_DRIFT");
  if (actualTransportSha256 !== expectedTransportSha256) fail("BRIDGE_TRANSPORT_SOURCE_DRIFT");
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
      const cleanup =
        CLEANUP_BRIDGE_COMMANDS.has(command) && !earlyCleanup
          ? loadBridgeCleanupInput(environment)
          : null;
      const production =
        cleanup === null && !earlyCleanup ? loadBridgeProductionInput(environment) : null;
      const earlyCleanupInput = earlyCleanup
        ? {
            schemaVersion: EARLY_CLEANUP_INPUT_SCHEMA,
            fullLiveAuthorityId: state.authority_id,
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
          });
        }
        commandPayload = { authorityDocument: production.authorityDocument };
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
      const request = {
        schemaVersion: "videoforge.v213-full-live-command/v1",
        commandId: `v213:${(production ?? cleanup ?? earlyCleanupInput).fullLiveAuthorityId}:${command}`,
        stageAuthorityId: (production ?? cleanup ?? earlyCleanupInput).fullLiveAuthorityId,
        command,
        input:
          earlyCleanupInput !== null
            ? earlyCleanupInput
            : cleanup === null
              ? {
                  schemaVersion: "videoforge.v213-full-live-production-input/v1",
                  outerStateSha256,
                  fullLiveAuthorityId: production.fullLiveAuthorityId,
                  dualLaneInput: production.dualLaneInput,
                  commandPayload,
                }
              : cleanup,
      };
      const result = await spawnBridge({
        environment,
        request,
        timeoutMs: bridgeChildTimeoutMs(state, context, command),
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
      const base = { actualUsd: 0, evidenceSha256: result.evidenceSha256, bridgeSummary: summary };
      if (command === "fresh-live-preflight")
        return {
          ...base,
          exactGpu: summary.admission?.gpu,
          region: summary.admission?.region,
          availability: summary.admission?.availability,
          flexUsdPerGpuHour: summary.admission?.flexRateUsdPerGpuHour,
          noFallback: true,
          inventorySha256: sha256(Buffer.from(JSON.stringify(summary.admission))),
          billingBaselineSha256: sha256(
            Buffer.from(
              JSON.stringify({ cumulativeBillingUsd: summary.admission?.cumulativeBillingUsd }),
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
          actualUsd: Number(summary.billingAfterUsd) - Number(before),
          qualified: summary.qualified === true,
          deploymentSha256:
            command === "mage-live-qualification"
              ? production.dualLaneInput.mage.deploymentSha256
              : production.dualLaneInput.soulx.deploymentSha256,
          zeroWorkersAfter: summary.zeroWorkersAfter === true,
        };
      }
      if (command === "create-exact-max-one-endpoints") {
        const productionDeployments = summary.result?.production ?? {};
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
        if (summary.terminal !== true || summary.zeroWorkersAfter !== true)
          fail("BRIDGE_ACCEPTANCE_NOT_TERMINAL", command);
        return { ...base, actualUsd: summary.settledCostUsd, accepted: true, ...summary };
      }
      if (command === "restore-endpoints-max-one")
        return {
          ...base,
          proofSha256: result.evidenceSha256,
          bothEndpointsMaxWorkersOne: summary.bothEndpointsMaxWorkersOne === true,
        };
      if (command === "prove-zero-workers")
        return {
          ...base,
          proofSha256: result.evidenceSha256,
          zeroWorkers: summary.zeroWorkers === true,
          stableReads: summary.reads?.length,
        };
      if (command === "read-settled-billing")
        return {
          ...base,
          proofSha256: result.evidenceSha256,
          withinCumulativeCap: summary.withinCumulativeCap === true,
          cumulativeUsd: summary.cumulativeBillingUsd,
        };
      return {
        ...base,
        proofSha256: result.evidenceSha256,
        onlyApprovedRetainedVolumes: summary.onlyApprovedRetainedVolumes === true,
      };
    };
  return Object.freeze(
    Object.fromEntries(BRIDGE_COMMANDS.map((command) => [command, run(command)])),
  );
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
  const adapters = {
    ...createGitReleaseAdapters(options.git),
    ...createGithubDispatchAdapters(options.github),
    ...createGithubVerificationAdapters(options.githubVerification),
    "bootstrap-prequalification-database": createPrequalificationDatabaseBootstrapAdapter(
      options.prequalificationDatabase,
    ),
    "guarded-activation-once": createGuardedActivationAdapter({
      ...(options.guarded ?? {}),
      requirePrequalificationReceipt: true,
    }),
    ...(options.qualification ? createStagedQualificationAdapters(options.qualification) : {}),
    "promote-qualified-production": options.promotion
      ? createQualifiedPromotionAdapter(options.promotion)
      : createProtectedPromotionAdapter(options.protectedPromotion),
    "record-workflow-start-authority": createWorkflowStartAuthorityAdapter(
      options.workflowStartAuthority,
    ),
    ...(options.acceptance ? createV213AcceptanceAdapters(options.acceptance) : {}),
    ...createTypeScriptBridgeAdapters({
      ...(options.bridge ?? {}),
      requirePrequalificationReceipt: true,
    }),
    ...(options.cleanup?.adapters ?? {}),
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
          if (!earlyCleanup)
            await materialize({ operationId, state, priorResults, outerStateSha256 });
          return adapter(context, state, priorResults, outerStateSha256);
        },
      ]),
    ),
  );
}

export {
  createConcreteFullLiveAdapters,
  createPrequalificationDatabaseBootstrapAdapter,
  createPrequalificationDatabaseAdapter,
  verifyPrequalificationDatabaseReceipt,
  createWorkflowStartAuthorityAdapter,
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
  createQualifiedPromotionAdapter,
  createV213DurableStageStore,
  createV213AcceptanceAdapters,
  createStagedQualificationAdapters,
  createTypeScriptBridgeAdapters,
  verifyMaterializationChainFile,
  productionBridgeSpawn,
  createGithubDispatchAdapters,
  createGithubVerificationAdapters,
  preflightGuardedActivationInputs,
  preflightConcreteFullLiveInputs,
  preflightPromotionInputs,
  prepareReleaseSourceWorktree,
  readAuthenticatedGithubTime,
  exactRemoteTag,
  TAG,
};

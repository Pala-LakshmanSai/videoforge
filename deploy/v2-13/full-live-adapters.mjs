import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  linkSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import {
  createPromotionDatabaseAdapter,
  promoteQualifiedProduction,
} from "./promote-qualified-production.mjs";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const TAG = "videoforge-v2-13-release-20260826-v3";
const APPROVAL_BRANCH = "codex/serverless-v2-roadmap";
const COMMIT = /^[0-9a-f]{40}$/u;
const HASH = /^sha256:[0-9a-f]{64}$/u;
const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const BRIDGE_PATH = "apps/web/src/server/providers/v213-full-live-cli.ts";
const BRIDGE_TRANSPORT_PATH = "apps/web/src/server/providers/v213-runpod-dual-lane-transport.ts";
const BRIDGE_CONFIRMATION = "EXECUTE_EXACT_V2_13_TYPESCRIPT_BRIDGE_COMMAND";
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

function productionCommand(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    env: process.env,
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
          const viewed = exactCommand((command, args) =>
            run(command, args, Math.min(60_000, remaining())), "gh", [
            "run",
            "view",
            runId,
            "--json",
            "databaseId,headSha,workflowName,status,conclusion",
          ]);
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
          exactCommand((command, args) =>
            run(command, args, Math.min(60_000, remaining())), "gh", [
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
  ["cloudflare-api-token-file", "VIDEOFORGE_V2_13_CLOUDFLARE_TOKEN_FILE"],
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
} = {}) {
  return async (_operation, state) => {
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
    preflightPromotionInputs({ environment, state });
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
    ).trim();
    const cloudflareToken = readFileSync(
      protectedFile(
        environment.VIDEOFORGE_V2_13_CLOUDFLARE_API_TOKEN_FILE,
        "PROMOTION_CLOUDFLARE_TOKEN_FILE",
      ),
      "utf8",
    ).trim();
    let record;
    try {
      record = JSON.parse(readFileSync(recordPath, "utf8"));
    } catch {
      fail("PROMOTION_RECORD_JSON");
    }
    if (!/^postgres(?:ql)?:\/\//u.test(databaseUrl) || cloudflareToken.length < 32)
      fail("PROMOTION_PROTECTED_INPUT");
    const disabledConfigBytes = readFileSync(disabledPath);
    const { Pool } = requireWeb("@neondatabase/serverless");
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const database = { query: (sql, parameters) => pool.query(sql, parameters) };
    const directory = mkdtempSync(resolve(tmpdir(), "videoforge-v213-promotion-"));
    const enabledPath = resolve(directory, "wrangler.enabled.json");
    const disabledRollbackPath = resolve(directory, "wrangler.disabled.json");
    const dryOutput = resolve(directory, "dry-run");
    let enabledConfig;
    const runWrangler = (args) => {
      const result = spawn("pnpm", ["--filter", "@videoforge/web", "exec", "wrangler", ...args], {
        cwd: ROOT,
        encoding: "utf8",
        shell: false,
        env: {
          PATH: environment.PATH ?? process.env.PATH,
          CI: "1",
          WRANGLER_SEND_METRICS: "false",
          CLOUDFLARE_API_TOKEN: cloudflareToken,
        },
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
        if (
          sha256(Buffer.from(String(enabledConfig.account_id))) !==
          record.cloudflare.account_id_sha256
        )
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

const MATERIALIZATION_GENESIS = sha256(
  Buffer.from("videoforge.v213-full-live-materialization-chain/v1:genesis"),
);

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
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
    if (sha256(readFileSync(path)) !== sha256(bytes))
      fail("MATERIALIZATION_OUTPUT_HASH_CAS", path);
  } finally {
    rmSync(temporary, { force: true });
  }
  protectedFile(path, "MATERIALIZATION_OUTPUT_FILE");
  if (sha256(readFileSync(path)) !== sha256(bytes)) fail("MATERIALIZATION_OUTPUT_READBACK");
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
    if (
      chain?.schema_version !== "videoforge.v213-full-live-materialization-chain/v1" ||
      !Array.isArray(chain.entries)
    )
      fail("MATERIALIZATION_CHAIN_CONTRACT");
    const previous = chain.entries.at(-1)?.entry_sha256 ?? MATERIALIZATION_GENESIS;
    if (chain.entries.some((item) => item?.kind === entry.kind))
      fail("MATERIALIZATION_CHAIN_STAGE_REPLAY", entry.kind);
    const unsigned = { ...entry, prior_chain_sha256: previous };
    const entrySha256 = sha256(Buffer.from(`${canonicalJson(unsigned)}\n`));
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
  const seed = () => {
    let value;
    try {
      value = JSON.parse(readFileSync(seedPath(), "utf8"));
    } catch {
      fail("MATERIALIZATION_SEED_JSON");
    }
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
        )
    )
      fail("MATERIALIZATION_SEED_CONTRACT");
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
      !lstatExists(environment.VIDEOFORGE_V2_13_PRODUCTION_INPUT_FILE)
    ) {
      const source = seed();
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
      production.dualLaneInput.mage.sourceCommit = state.release_source_commit;
      production.dualLaneInput.soulx.sourceCommit = state.release_source_commit;
      const output = writeJson(environment.VIDEOFORGE_V2_13_PRODUCTION_INPUT_FILE, production);
      validateProduction(environment);
      record({
        stage: "cleanup-production-input",
        state,
        outerStateSha256,
        inputs: {},
        outputs: { production_input_sha256: output },
      });
    }
    if (operationId === "fresh-live-preflight") {
      const source = seed();
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
      const source = seed();
      const mage = exactReceipt(priorResults, "mage-live-qualification");
      const soulx = exactReceipt(priorResults, "soulx-live-qualification");
      const endpoints = exactReceipt(priorResults, "create-exact-max-one-endpoints");
      const manifestSha256 = writeJson(
        environment.VIDEOFORGE_V2_13_RELEASE_MANIFEST_FILE,
        source.release_manifest,
      );
      const config = structuredClone(source.config_activation_base);
      config.authority.approved_at = state.approved_at;
      config.release.commit = state.release_source_commit;
      config.release.media_worker_release_manifest_sha256 = manifestSha256;
      const configSha256 = writeJson(
        environment.VIDEOFORGE_V2_13_CONFIG_ACTIVATION_RECORD,
        config,
      );
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
        production_config_activation_sha256: configSha256,
        media_worker_release_manifest_sha256: manifestSha256,
      });
      Object.assign(activation.gates, {
        mage_qualification_sha256: mage.evidenceSha256,
        soulx_qualification_sha256: soulx.evidenceSha256,
        mage_deployment_snapshot_sha256: mage.deploymentSha256,
        soulx_deployment_snapshot_sha256: soulx.deploymentSha256,
        paid_dispatch_authority_sha256: endpoints.evidenceSha256,
      });
      const activationSha256 = writeJson(
        environment.VIDEOFORGE_V2_13_ACTIVATION_RECORD,
        activation,
      );
      validateGuarded({ environment, state });
      record({
        stage: "guarded-activation",
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
      const source = seed();
      const mage = exactReceipt(priorResults, "mage-live-qualification");
      const soulx = exactReceipt(priorResults, "soulx-live-qualification");
      const guarded = exactReceipt(priorResults, "guarded-activation-once");
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
        deployment_snapshot_sha256: mage.deploymentSha256,
      });
      Object.assign(promotion.lanes.soulx_avatar, {
        qualification_record_sha256: soulx.evidenceSha256,
        deployment_snapshot_sha256: soulx.deploymentSha256,
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
        stage: "qualified-promotion",
        state,
        outerStateSha256,
        inputs: {
          mage_qualification: mage.evidenceSha256,
          soulx_qualification: soulx.evidenceSha256,
          guarded_activation: guarded.evidenceSha256,
        },
        outputs: { promotion_record_sha256: promotionSha256 },
      });
    }
  };
}

function productionBridgeSpawn({ environment, request }) {
  const directory = mkdtempSync(resolve(tmpdir(), "videoforge-v213-bridge-"));
  const requestPath = resolve(directory, "request.json");
  const opened = [];
  try {
    writeFileSync(requestPath, `${JSON.stringify(request)}\n`, { encoding: "utf8", mode: 0o600 });
    const files = [
      ["REQUEST_FD", requestPath],
      ...BRIDGE_PROTECTED_FILES.map(([fdName, variable]) => [
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
      },
    );
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

function preflightConcreteFullLiveInputs({
  environment = process.env,
  state,
  cleanupOnly = false,
  allowUnmaterializedProductionInput = false,
}) {
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
  let productionSecrets;
  try {
    productionSecrets = JSON.parse(bridgeValues.VIDEOFORGE_V2_13_PRODUCTION_SECRETS_FILE);
  } catch {
    fail("BRIDGE_PRODUCTION_SECRETS_JSON");
  }
  const protectedKeyFields = [
    "stageAuthoritySigningKeyBase64",
    "provenanceReceiptHmacKeyBase64",
    "acceptanceEvidenceSigningKeyBase64",
    "pairDispatchTokenKeyBase64",
  ];
  const keyHashes = protectedKeyFields.map((field) => {
    const encoded = productionSecrets?.[field];
    if (typeof encoded !== "string") fail("BRIDGE_PRODUCTION_SECRETS");
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.length < 32 || bytes.toString("base64") !== encoded)
      fail("BRIDGE_PRODUCTION_SECRETS");
    return sha256(bytes);
  });
  for (const field of ["pairEnvelopeSigningKeyHex", "pairProviderProofKeyHex"]) {
    const encoded = productionSecrets?.[field];
    if (typeof encoded !== "string" || !/^(?:[0-9a-f]{2}){32,}$/u.test(encoded))
      fail("BRIDGE_PRODUCTION_SECRETS");
    keyHashes.push(sha256(Buffer.from(encoded, "hex")));
  }
  if (
    productionSecrets?.schemaVersion !== "videoforge.v213-full-live-production-secrets/v1" ||
    new Set(keyHashes).size !== keyHashes.length
  )
    fail("BRIDGE_PRODUCTION_SECRETS");
  return Object.freeze({ production, cleanupOnly });
}

function preflightPromotionInputs({ environment = process.env, state }) {
  const { production } = preflightConcreteFullLiveInputs({ environment, state });
  for (const variable of [
    "VIDEOFORGE_V2_13_PROMOTION_RECORD_FILE",
    "VIDEOFORGE_V2_13_DISABLED_CONFIG_FILE",
    "VIDEOFORGE_V2_13_OPERATOR_DATABASE_URL_FILE",
    "VIDEOFORGE_V2_13_CLOUDFLARE_API_TOKEN_FILE",
  ])
    protectedFile(environment[variable], `PROMOTION_PROTECTED_FILE:${variable}`);
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
  const cloudflareToken = readFileSync(
    environment.VIDEOFORGE_V2_13_CLOUDFLARE_API_TOKEN_FILE,
    "utf8",
  );
  if (
    sha256(disabledConfig) !== promotion?.release?.disabled_config_sha256 ||
    cloudflareToken.trim() !== cloudflareToken ||
    cloudflareToken.length < 32
  )
    fail("PROMOTION_PROTECTED_CONTENT");
  return Object.freeze({ production, promotion });
}

function preflightGuardedActivationInputs({ environment = process.env, state }) {
  preflightConcreteFullLiveInputs({ environment, state });
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
  expectedCliSha256 = "sha256:ec6c459294769a04d3126e37d4e2d94be1578095a2ec11bfd9221fc02a6f8123",
  expectedTransportSha256 = "sha256:7d2ac27d25f6906aae1147833618e4a471ef0ca72f7ea6159ea993444ae53fe6",
} = {}) {
  const actualCliSha256 = sha256(readFileSync(resolve(ROOT, BRIDGE_PATH)));
  const actualTransportSha256 = sha256(readFileSync(resolve(ROOT, BRIDGE_TRANSPORT_PATH)));
  if (actualCliSha256 !== expectedCliSha256) fail("BRIDGE_SOURCE_DRIFT");
  if (actualTransportSha256 !== expectedTransportSha256) fail("BRIDGE_TRANSPORT_SOURCE_DRIFT");
  const run = (command) => async (_context, state, priorResults, outerStateSha256) => {
    if (!HASH.test(outerStateSha256 ?? "")) fail("BRIDGE_OUTER_STATE");
    const production = loadBridgeProductionInput(environment);
    if (
      production.dualLaneInput?.mage?.sourceCommit !== state.release_source_commit ||
      production.dualLaneInput?.soulx?.sourceCommit !== state.release_source_commit
    )
      fail("BRIDGE_SOURCE_LINEAGE");
    let commandPayload = production.commandPayloads[command] ?? {};
    if (command === "fresh-live-preflight")
      commandPayload = { authorityDocument: production.authorityDocument };
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
      commandId: `v213:${production.fullLiveAuthorityId}:${command}`,
      stageAuthorityId: production.fullLiveAuthorityId,
      command,
      input: {
        schemaVersion: "videoforge.v213-full-live-production-input/v1",
        outerStateSha256,
        fullLiveAuthorityId: production.fullLiveAuthorityId,
        dualLaneInput: production.dualLaneInput,
        commandPayload,
      },
    };
    const result = await spawnBridge({ environment, request });
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
          ? priorResults.get("fresh-live-preflight")?.bridgeSummary?.admission?.cumulativeBillingUsd
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
      const deployments = Object.values(summary.result?.production ?? {});
      return {
        ...base,
        createdExactTwoEndpoints: deployments.length === 2,
        distinctEndpointIds: new Set(deployments.map((item) => item.endpointIdSha256)).size === 2,
        bothMaxWorkersOne: deployments.every((item) => item.workersMax === 1),
        bothWorkersMinZero: deployments.every((item) => item.workersMin === 0),
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
  const adapters = {
    ...createGitReleaseAdapters(options.git),
    ...createGithubDispatchAdapters(options.github),
    ...createGithubVerificationAdapters(options.githubVerification),
    "guarded-activation-once": createGuardedActivationAdapter(options.guarded),
    ...(options.qualification ? createStagedQualificationAdapters(options.qualification) : {}),
    "promote-qualified-production": options.promotion
      ? createQualifiedPromotionAdapter(options.promotion)
      : createProtectedPromotionAdapter(options.protectedPromotion),
    ...(options.acceptance ? createV213AcceptanceAdapters(options.acceptance) : {}),
    ...createTypeScriptBridgeAdapters(options.bridge),
    ...(options.cleanup?.adapters ?? {}),
  };
  const materialize =
    options.materializer === false
      ? null
      : options.materializer?.materialize ??
        createProtectedInputMaterializer(options.materializer);
  if (materialize === null) return Object.freeze(adapters);
  return Object.freeze(
    Object.fromEntries(
      Object.entries(adapters).map(([operationId, adapter]) => [
        operationId,
        async (context, state, priorResults, outerStateSha256) => {
          await materialize({ operationId, state, priorResults, outerStateSha256 });
          return adapter(context, state, priorResults, outerStateSha256);
        },
      ]),
    ),
  );
}

export {
  createConcreteFullLiveAdapters,
  closedTrustedTimeCommand,
  createGitReleaseAdapters,
  createGuardedActivationAdapter,
  createProtectedInputMaterializer,
  createQualifiedPromotionAdapter,
  createV213DurableStageStore,
  createV213AcceptanceAdapters,
  createStagedQualificationAdapters,
  createTypeScriptBridgeAdapters,
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

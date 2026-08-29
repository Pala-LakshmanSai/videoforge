#!/usr/bin/env node

/*
 * The SoulX image workflow is present in the immutable release source but was not
 * registered on GitHub's default branch.  This module is the deliberately small
 * repair seam for that condition.
 *
 * Important properties of this seam:
 *   - importing it has no side effects;
 *   - invoking it without arguments is an explicit NO_ACTION dry run;
 *   - the exact resulting tree is prepared and independently validated elsewhere;
 *   - this module may only create that tree with an expected-head GraphQL commit,
 *     move the default branch to an exact prepared commit, or merge an exact
 *     already-open protected-branch pull request;
 *   - no force update, delete, tag, secret, workflow dispatch, retry, or fallback is
 *     representable in the generated command surface.
 *
 * Provider interaction is intentionally behind an injected command runner. Tests
 * use it without credentials or network access. The CLI first verifies local Git
 * trust-root bytes, obtains credential-free CA-verified time, durably consumes the
 * authority, and only then permits authenticated `gh api` reads.
 */

import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));

export const AUTHORITY_SCHEMA = "videoforge.v2-13-default-branch-workflow-repair-authority/v2";
export const VALIDATION_SCHEMA = "videoforge.v2-13-default-branch-workflow-repair-validation/v2";
export const RESULT_SCHEMA = "videoforge.v2-13-default-branch-workflow-repair-result/v2";
export const REPAIR_OPERATION_ID = "repair-default-branch-workflow-once";
export const CONFIRMATION = "EXECUTE_V2_13_DEFAULT_BRANCH_WORKFLOW_REPAIR_ONCE";
export const NO_ACTION_STATE = "NO_ACTION";
export const MUTATION_INTENT_STATE = "INTENT";
export const REGISTRATION_EVIDENCE_SCHEMA =
  "videoforge.v213-soulx-workflow-registration-evidence/v1";

const AUTHORITY_ID = /^v2-13-default-branch-repair-[a-z0-9][a-z0-9._-]{7,95}$/u;
const SHA1 = /^[0-9a-f]{40}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/u;
const WORKFLOW_PATH = /^\.github\/workflows\/[A-Za-z0-9._/-]+\.(?:ya?ml)$/u;
const RELATIVE_REPOSITORY_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]{1,400}$/u;
const COMMAND = "gh";
const TRUSTED_TIME_COMMAND = "curl";
const PROPOSAL_SCHEMA = "videoforge.v2-13-default-branch-workflow-repair-proposal/v2";
const APPROVAL_SCHEMA = "videoforge.v2-13-default-branch-workflow-repair-approval/v2";
export const GRAPHQL_CREATE_COMMIT_QUERY = `mutation CreateExactWorkflowCommit($input: CreateCommitOnBranchInput!) {
  createCommitOnBranch(input: $input) {
    commit {
      oid
      messageHeadline
      tree { oid }
      parents(first: 2) {
        totalCount
        pageInfo { hasNextPage }
        nodes { oid }
      }
    }
    ref {
      prefix
      name
      target { oid }
    }
  }
}`;

const FORBIDDEN_COMMAND_TOKENS = Object.freeze([
  "--force",
  "-f force=",
  "force-with-lease",
  "refs/tags/",
  "/tags/",
  "tag",
  "secret",
  "delete",
  "dispatch",
  "rerun",
  "retry",
  "replay",
  "fallback",
  "redispatch",
]);

const ALLOWED_AUTHORITY_STATES = new Set(["APPROVED_UNCONSUMED"]);
const CONSUMED_AUTHORITY_STATE = "CONSUMED_SINGLE_USE_NO_REPLAY";
const consumedAuthorityIds = new Set();
const ACK_UNKNOWN_STATE = "ACK_UNKNOWN";
const READBACK_ONLY_MODE = "READBACK_ONLY_RECONCILIATION";

const fail = (code) => {
  throw new Error(`V2_13_DEFAULT_BRANCH_WORKFLOW_REPAIR_${code}`);
};

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const safeBranchName = (value) =>
  BRANCH.test(value) && !value.includes("..") && !value.includes("//") && !value.endsWith("/");
const safeWorkflowPath = (value) =>
  WORKFLOW_PATH.test(value) &&
  value.split("/").every((part) => part !== "" && part !== "." && part !== "..");
const safeRelativePath = (value) =>
  RELATIVE_REPOSITORY_PATH.test(value) &&
  value.split("/").every((part) => part !== "" && part !== "." && part !== "..");

const exactKeys = (value, keys) =>
  isObject(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());

const canonicalJson = (value) => {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (isObject(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
};

const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

function assertArrayOfSha1(value) {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => !SHA1.test(item)))
    fail("AUTHORITY_INVALID");
  return value;
}

const withoutKey = (value, key) => {
  const copy = { ...value };
  delete copy[key];
  return copy;
};

function authorityBindingPayload(authority) {
  return {
    schema_version: authority.schema_version,
    authority_id: authority.authority_id,
    operation: authority.operation,
    lineage: withoutKey(authority.lineage, "lineage_sha256"),
    target: authority.target,
    mechanism: authority.mechanism,
    issued_at: authority.issued_at,
    expires_at: authority.expires_at,
  };
}

function assertLineage(lineage) {
  if (
    !exactKeys(lineage, [
      "proposal_path",
      "proposal_sha256",
      "proposal_record_commit",
      "approval_path",
      "approval_sha256",
      "approval_record_commit",
      "authority_record_path",
      "authority_record_commit",
      "validator_path",
      "validator_commit",
      "validator_sha256",
      "execution_control_commit",
      "release_source_commit",
      "lineage_sha256",
    ]) ||
    !safeRelativePath(lineage.proposal_path) ||
    !safeRelativePath(lineage.approval_path) ||
    !safeRelativePath(lineage.authority_record_path) ||
    !safeRelativePath(lineage.validator_path) ||
    !SHA256.test(lineage.proposal_sha256) ||
    !SHA256.test(lineage.approval_sha256) ||
    !SHA1.test(lineage.proposal_record_commit) ||
    !SHA1.test(lineage.approval_record_commit) ||
    lineage.authority_record_commit !== null ||
    !SHA1.test(lineage.validator_commit) ||
    !SHA256.test(lineage.validator_sha256) ||
    !SHA1.test(lineage.execution_control_commit) ||
    !SHA1.test(lineage.release_source_commit) ||
    !SHA256.test(lineage.lineage_sha256) ||
    sha256(Buffer.from(`${canonicalJson(withoutKey(lineage, "lineage_sha256"))}\n`)) !==
      lineage.lineage_sha256
  )
    fail("AUTHORITY_LINEAGE_INVALID");
}

function assertValidation(validation, authority) {
  if (
    !exactKeys(validation, [
      "schema_version",
      "status",
      "validator_commit",
      "validator_sha256",
      "authority_binding_sha256",
    ]) ||
    validation.schema_version !== VALIDATION_SCHEMA ||
    validation.status !== "PASS" ||
    !SHA1.test(validation.validator_commit) ||
    !SHA256.test(validation.validator_sha256) ||
    !SHA256.test(validation.authority_binding_sha256) ||
    validation.validator_commit !== authority.lineage.validator_commit ||
    validation.validator_sha256 !== authority.lineage.validator_sha256 ||
    sha256(Buffer.from(`${canonicalJson(authorityBindingPayload(authority))}\n`)) !==
      validation.authority_binding_sha256
  )
    fail("AUTHORITY_NOT_SEPARATELY_VALIDATED");
}

function assertAuthorityTimeWindow(authority, now) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) fail("TRUSTED_TIME_REQUIRED");
  if (new Date(authority.expires_at).getTime() <= now.getTime()) fail("AUTHORITY_EXPIRED");
  if (new Date(authority.issued_at).getTime() > now.getTime()) fail("AUTHORITY_NOT_YET_VALID");
}

function assertTarget(target) {
  if (
    !exactKeys(target, [
      "repository",
      "default_branch_name",
      "default_branch_sha",
      "release_source_commit",
      "workflow",
      "resulting",
      "workflow_registration",
    ]) ||
    !REPOSITORY.test(target.repository) ||
    !safeBranchName(target.default_branch_name) ||
    !SHA1.test(target.default_branch_sha) ||
    !SHA1.test(target.release_source_commit)
  )
    fail("AUTHORITY_INVALID");

  const workflow = target.workflow;
  if (
    !exactKeys(workflow, ["path", "blob_sha1", "blob_sha256"]) ||
    !safeWorkflowPath(workflow.path) ||
    !SHA1.test(workflow.blob_sha1) ||
    !SHA256.test(workflow.blob_sha256)
  )
    fail("AUTHORITY_INVALID");

  const resulting = target.resulting;
  if (
    !exactKeys(resulting, [
      "commit_sha",
      "tree_sha",
      "tree_entries_sha256",
      "parent_commit_shas",
    ]) ||
    !(resulting.commit_sha === null || SHA1.test(resulting.commit_sha)) ||
    !SHA1.test(resulting.tree_sha) ||
    !SHA256.test(resulting.tree_entries_sha256)
  )
    fail("AUTHORITY_INVALID");
  if (resulting.commit_sha === null) {
    if (
      resulting.parent_commit_shas !== null &&
      (!Array.isArray(resulting.parent_commit_shas) ||
        resulting.parent_commit_shas.some((item) => !SHA1.test(item)))
    )
      fail("AUTHORITY_INVALID");
  } else {
    assertArrayOfSha1(resulting.parent_commit_shas);
  }

  const registration = target.workflow_registration;
  if (
    !exactKeys(registration, ["name", "path", "state"]) ||
    typeof registration.name !== "string" ||
    registration.name.length < 1 ||
    registration.path !== workflow.path ||
    registration.state !== "active"
  )
    fail("AUTHORITY_INVALID");
}

function assertMechanism(mechanism, target) {
  if (!isObject(mechanism) || typeof mechanism.type !== "string") fail("AUTHORITY_INVALID");
  if (
    mechanism.force !== false ||
    mechanism.delete !== false ||
    mechanism.tags !== false ||
    mechanism.secrets !== false ||
    mechanism.dispatch !== false ||
    mechanism.fallback !== false ||
    mechanism.replay !== false
  )
    fail("UNSAFE_MECHANISM");

  if (mechanism.type === "FAST_FORWARD") {
    if (
      !exactKeys(mechanism, [
        "type",
        "force",
        "delete",
        "tags",
        "secrets",
        "dispatch",
        "fallback",
        "replay",
      ])
    )
      fail("AUTHORITY_INVALID");
    if (
      target.resulting.commit_sha === null ||
      target.resulting.parent_commit_shas.length !== 1 ||
      target.resulting.parent_commit_shas[0] !== target.default_branch_sha
    )
      fail("AUTHORITY_INVALID");
    return;
  }

  if (mechanism.type === "GRAPHQL_CREATE_COMMIT") {
    if (
      !exactKeys(mechanism, [
        "type",
        "graphql_mutation",
        "expected_head_oid",
        "additions_count",
        "deletions_count",
        "create_only",
        "commit_message",
        "request_sha256",
        "force",
        "delete",
        "tags",
        "secrets",
        "dispatch",
        "fallback",
        "replay",
      ]) ||
      mechanism.graphql_mutation !== "createCommitOnBranch" ||
      mechanism.expected_head_oid !== target.default_branch_sha ||
      mechanism.additions_count !== 1 ||
      mechanism.deletions_count !== 0 ||
      mechanism.create_only !== true ||
      !exactKeys(mechanism.commit_message, ["headline"]) ||
      typeof mechanism.commit_message.headline !== "string" ||
      mechanism.commit_message.headline.length < 1 ||
      mechanism.commit_message.headline.length > 72 ||
      mechanism.commit_message.headline.includes("\n") ||
      !SHA256.test(mechanism.request_sha256) ||
      target.resulting.commit_sha !== null ||
      !Array.isArray(target.resulting.parent_commit_shas) ||
      target.resulting.parent_commit_shas.length !== 1 ||
      target.resulting.parent_commit_shas[0] !== target.default_branch_sha
    )
      fail("AUTHORITY_INVALID");
    return;
  }

  if (mechanism.type !== "PROTECTED_BRANCH") fail("UNSAFE_MECHANISM");
  if (
    !exactKeys(mechanism, [
      "type",
      "force",
      "delete",
      "tags",
      "secrets",
      "dispatch",
      "fallback",
      "replay",
      "pull_request_number",
      "pull_request_head_ref",
      "pull_request_head_sha",
      "pull_request_base_ref",
      "pull_request_base_sha",
      "merge_method",
    ]) ||
    !Number.isSafeInteger(mechanism.pull_request_number) ||
    mechanism.pull_request_number <= 0 ||
    !safeBranchName(mechanism.pull_request_head_ref) ||
    !SHA1.test(mechanism.pull_request_head_sha) ||
    mechanism.pull_request_base_ref !== target.default_branch_name ||
    mechanism.pull_request_base_sha !== target.default_branch_sha ||
    mechanism.merge_method !== "merge" ||
    target.resulting.commit_sha !== null ||
    target.resulting.parent_commit_shas !== null
  )
    fail("AUTHORITY_INVALID");
}

/**
 * Validate the exact, already independently validated, one-use repair authority.
 *
 * The validator does not contact GitHub and does not read credentials.  It only
 * checks the authority envelope.  Remote state is checked separately immediately
 * before the one permitted branch mutation.
 */
export function validateRepairAuthority(authority, { now, skipTime = false } = {}) {
  if (
    !exactKeys(authority, [
      "schema_version",
      "authority_id",
      "state",
      "use_count",
      "validation",
      "operation",
      "lineage",
      "target",
      "mechanism",
      "issued_at",
      "expires_at",
      "consumed_at",
      "execution_id",
    ]) ||
    authority.schema_version !== AUTHORITY_SCHEMA ||
    !AUTHORITY_ID.test(authority.authority_id) ||
    !ALLOWED_AUTHORITY_STATES.has(authority.state) ||
    authority.use_count !== 0 ||
    authority.consumed_at !== null ||
    authority.execution_id !== null ||
    !ISO_TIME.test(authority.issued_at) ||
    !ISO_TIME.test(authority.expires_at)
  )
    fail("AUTHORITY_INVALID");
  const issuedAtMs = Date.parse(authority.issued_at);
  const expiresAtMs = Date.parse(authority.expires_at);
  if (!Number.isFinite(issuedAtMs) || !Number.isFinite(expiresAtMs) || expiresAtMs <= issuedAtMs)
    fail("AUTHORITY_INVALID");
  if (consumedAuthorityIds.has(authority.authority_id)) fail("AUTHORITY_REPLAY");
  assertLineage(authority.lineage);
  assertValidation(authority.validation, authority);
  if (
    !exactKeys(authority.operation, ["id", "action", "single_use"]) ||
    authority.operation.id !== REPAIR_OPERATION_ID ||
    authority.operation.action !==
      (authority.mechanism.type === "GRAPHQL_CREATE_COMMIT"
        ? "GRAPHQL_CREATE_EXACT_DEFAULT_BRANCH_WORKFLOW"
        : "FAST_FORWARD_OR_PROTECTED_BRANCH_WORKFLOW_REPAIR") ||
    authority.operation.single_use !== true
  )
    fail("AUTHORITY_INVALID");
  assertTarget(authority.target);
  if (authority.lineage.release_source_commit !== authority.target.release_source_commit)
    fail("AUTHORITY_LINEAGE_TARGET_MISMATCH");
  assertMechanism(authority.mechanism, authority.target);
  const nowMs =
    now === undefined ? Number.NaN : now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!skipTime && !Number.isFinite(nowMs)) fail("TRUSTED_TIME_REQUIRED");
  if (!skipTime) assertAuthorityTimeWindow(authority, new Date(nowMs));
  return authority;
}

/**
 * Hash the exact, normalized GitHub tree entries returned by the Git data API.
 * GitHub's tree SHA is authoritative for Git identity; this additional hash
 * catches an incomplete/truncated response or a response with altered entry data.
 */
export function canonicalTreeEntriesSha256(entries) {
  if (!Array.isArray(entries)) fail("TREE_READBACK_AMBIGUOUS");
  const normalized = entries
    .map((entry) => {
      if (
        !isObject(entry) ||
        typeof entry.path !== "string" ||
        typeof entry.mode !== "string" ||
        typeof entry.type !== "string" ||
        !SHA1.test(entry.sha)
      )
        fail("TREE_READBACK_AMBIGUOUS");
      return { mode: entry.mode, path: entry.path, sha: entry.sha, type: entry.type };
    })
    .sort((left, right) => {
      const pathOrder = left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
      if (pathOrder !== 0) return pathOrder;
      return left.mode < right.mode ? -1 : left.mode > right.mode ? 1 : 0;
    });
  return sha256(Buffer.from(`${canonicalJson(normalized)}\n`));
}

function defaultRunCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    shell: false,
    ...options,
  });
  if (result.error) throw result.error;
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function defaultRunGit(args, options = {}) {
  const result = spawnSync("git", args, {
    cwd: ROOT,
    encoding: null,
    shell: false,
    ...options,
  });
  if (result.error) throw result.error;
  return {
    status: result.status ?? 1,
    stdout: Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout ?? ""),
    stderr: Buffer.isBuffer(result.stderr) ? result.stderr : Buffer.from(result.stderr ?? ""),
  };
}

function normalizeGitResult(value) {
  if (!isObject(value) || !Number.isInteger(value.status)) fail("TRUST_ROOT_GIT_FAILED");
  const stdout = Buffer.isBuffer(value.stdout)
    ? value.stdout
    : typeof value.stdout === "string"
      ? Buffer.from(value.stdout)
      : null;
  if (stdout === null) fail("TRUST_ROOT_GIT_FAILED");
  return { status: value.status, stdout };
}

function gitRead(runGit, root, args, code) {
  let result;
  try {
    result = normalizeGitResult(runGit(args, { cwd: root, encoding: null, shell: false }));
  } catch (error) {
    if (String(error?.message ?? "").startsWith("V2_13_DEFAULT_BRANCH_WORKFLOW_REPAIR_"))
      throw error;
    fail(code);
  }
  if (result.status !== 0) fail(code);
  return result.stdout;
}

function gitAssert(runGit, root, args, code) {
  gitRead(runGit, root, args, code);
}

function parseTrustedJson(bytes, code) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    fail(code);
  }
}

/**
 * Verify the authority against immutable Git bytes and ancestry, not hashes
 * supplied by the authority itself. `authorityRecordCommit` is deliberately an
 * external trusted input: embedding the hash of a commit in the record that the
 * same commit introduces would be a self-referential and impossible seal.
 */
export function verifyRepairAuthorityTrustRoot(
  authority,
  { authorityFile, authorityRecordCommit, root = ROOT, runGit = defaultRunGit } = {},
) {
  validateRepairAuthority(authority, { skipTime: true });
  if (typeof authorityFile !== "string" || authorityFile === "")
    fail("TRUST_ROOT_AUTHORITY_FILE_REQUIRED");
  if (typeof runGit !== "function") fail("TRUST_ROOT_GIT_RUNNER_INVALID");
  const repositoryRoot = resolve(root);
  const lineage = authority.lineage;
  if (lineage.validator_path !== "deploy/v2-13/default-branch-workflow-repair.mjs")
    fail("TRUST_ROOT_VALIDATOR_PATH_INVALID");

  const recordCommit = authorityRecordCommit;
  if (!SHA1.test(recordCommit ?? "")) fail("TRUST_ROOT_AUTHORITY_COMMIT_INVALID");
  const commits = [
    lineage.release_source_commit,
    lineage.execution_control_commit,
    lineage.validator_commit,
    lineage.proposal_record_commit,
    lineage.approval_record_commit,
    recordCommit,
  ];
  for (const commit of new Set(commits))
    gitAssert(
      runGit,
      repositoryRoot,
      ["cat-file", "-e", `${commit}^{commit}`],
      "TRUST_ROOT_COMMIT_MISSING",
    );

  const parentOf = (commit) =>
    gitRead(runGit, repositoryRoot, ["rev-parse", `${commit}^`], "TRUST_ROOT_PARENT_INVALID")
      .toString("utf8")
      .trim();
  if (
    lineage.validator_commit !== lineage.execution_control_commit ||
    parentOf(lineage.proposal_record_commit) !== lineage.execution_control_commit ||
    parentOf(lineage.approval_record_commit) !== lineage.proposal_record_commit ||
    parentOf(recordCommit) !== lineage.approval_record_commit
  )
    fail("TRUST_ROOT_LINEAGE_INVALID");
  gitAssert(
    runGit,
    repositoryRoot,
    [
      "merge-base",
      "--is-ancestor",
      lineage.release_source_commit,
      lineage.execution_control_commit,
    ],
    "TRUST_ROOT_RELEASE_NOT_ANCESTOR",
  );

  const show = (commit, path, code) =>
    gitRead(runGit, repositoryRoot, ["show", `${commit}:${path}`], code);
  const proposalBytes = show(
    lineage.proposal_record_commit,
    lineage.proposal_path,
    "TRUST_ROOT_PROPOSAL_MISSING",
  );
  const approvalBytes = show(
    lineage.approval_record_commit,
    lineage.approval_path,
    "TRUST_ROOT_APPROVAL_MISSING",
  );
  const validatorBytes = show(
    lineage.validator_commit,
    lineage.validator_path,
    "TRUST_ROOT_VALIDATOR_MISSING",
  );
  const authorityRecordBytes = show(
    recordCommit,
    lineage.authority_record_path,
    "TRUST_ROOT_AUTHORITY_RECORD_MISSING",
  );
  let runtimeValidatorBytes;
  try {
    runtimeValidatorBytes = readFileSync(fileURLToPath(import.meta.url));
  } catch {
    fail("TRUST_ROOT_RUNTIME_VALIDATOR_READ_FAILED");
  }
  let protectedAuthorityBytes;
  try {
    protectedAuthorityBytes = readFileSync(resolve(authorityFile));
  } catch {
    fail("TRUST_ROOT_AUTHORITY_READ_FAILED");
  }
  if (
    sha256(proposalBytes) !== lineage.proposal_sha256 ||
    sha256(approvalBytes) !== lineage.approval_sha256 ||
    sha256(validatorBytes) !== lineage.validator_sha256 ||
    Buffer.compare(authorityRecordBytes, protectedAuthorityBytes) !== 0
  )
    fail("TRUST_ROOT_BYTES_DRIFT");
  if (Buffer.compare(runtimeValidatorBytes, validatorBytes) !== 0)
    fail("TRUST_ROOT_RUNTIME_VALIDATOR_DRIFT");

  const proposal = parseTrustedJson(proposalBytes, "TRUST_ROOT_PROPOSAL_JSON_INVALID");
  const approval = parseTrustedJson(approvalBytes, "TRUST_ROOT_APPROVAL_JSON_INVALID");
  if (
    proposal.schema_version !== PROPOSAL_SCHEMA ||
    proposal.authority_schema !== authority.schema_version ||
    proposal.authority_id !== authority.authority_id ||
    proposal.operation !== REPAIR_OPERATION_ID ||
    canonicalJson(proposal.target) !== canonicalJson(authority.target) ||
    canonicalJson(proposal.mechanism) !== canonicalJson(authority.mechanism) ||
    proposal.issued_at !== authority.issued_at ||
    proposal.expires_at !== authority.expires_at
  )
    fail("TRUST_ROOT_PROPOSAL_BINDING_INVALID");
  if (
    approval.schema_version !== APPROVAL_SCHEMA ||
    approval.approved !== true ||
    approval.authority_schema !== authority.schema_version ||
    approval.authority_id !== authority.authority_id ||
    approval.proposal_sha256 !== lineage.proposal_sha256
  )
    fail("TRUST_ROOT_APPROVAL_BINDING_INVALID");

  const commitParents = (commit) => {
    const tokens = gitRead(
      runGit,
      repositoryRoot,
      ["rev-list", "--parents", "-n", "1", commit],
      "TRUST_ROOT_LINEAGE_INVALID",
    )
      .toString("utf8")
      .trim()
      .split(/\s+/u)
      .filter(Boolean);
    if (
      tokens.length < 2 ||
      tokens[0] !== commit ||
      tokens.slice(1).some((parent) => !SHA1.test(parent))
    )
      fail("TRUST_ROOT_LINEAGE_INVALID");
    return tokens.slice(1);
  };
  const changedPaths = (commit) =>
    gitRead(
      runGit,
      repositoryRoot,
      ["diff-tree", "--no-commit-id", "--no-ext-diff", "--no-renames", "--name-only", "-r", commit],
      "TRUST_ROOT_CHANGED_PATHS_INVALID",
    )
      .toString("utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .sort();
  const recordLineage = [
    {
      commit: lineage.proposal_record_commit,
      expectedParent: lineage.execution_control_commit,
      expectedPath: lineage.proposal_path,
    },
    {
      commit: lineage.approval_record_commit,
      expectedParent: lineage.proposal_record_commit,
      expectedPath: lineage.approval_path,
    },
    {
      commit: recordCommit,
      expectedParent: lineage.approval_record_commit,
      expectedPath: lineage.authority_record_path,
    },
  ];
  for (const { commit, expectedParent, expectedPath } of recordLineage) {
    const parents = commitParents(commit);
    if (parents.length !== 1 || parents[0] !== expectedParent) fail("TRUST_ROOT_LINEAGE_INVALID");
    if (JSON.stringify(changedPaths(commit)) !== JSON.stringify([expectedPath]))
      fail("TRUST_ROOT_RECORD_COMMIT_NOT_EXCLUSIVE");
  }
  return { authorityRecordCommit: recordCommit };
}

function assertTrustedTimeRecord(value, expectedSource, expectedCredentialBearing) {
  if (
    !isObject(value) ||
    !exactKeys(value, [
      "authenticated",
      "credential_bearing",
      "iso",
      "source",
      "evidence_sha256",
    ]) ||
    value.authenticated !== true ||
    value.credential_bearing !== expectedCredentialBearing ||
    value.source !== expectedSource ||
    !ISO_TIME.test(value.iso) ||
    !SHA256.test(value.evidence_sha256) ||
    sha256(
      Buffer.from(
        `${canonicalJson({
          authenticated: true,
          credential_bearing: value.credential_bearing,
          iso: value.iso,
          source: value.source,
        })}\n`,
      ),
    ) !== value.evidence_sha256
  )
    fail("TRUSTED_TIME_INVALID");
  return value;
}

function authenticatedTimeEvidence(iso) {
  const base = {
    authenticated: true,
    credential_bearing: true,
    iso,
    source: "GITHUB_AUTHENTICATED_DATE",
  };
  return { ...base, evidence_sha256: sha256(Buffer.from(`${canonicalJson(base)}\n`)) };
}

function credentialFreeTimeEvidence(iso) {
  const base = {
    authenticated: true,
    credential_bearing: false,
    iso,
    source: "GITHUB_CA_VERIFIED_DATE",
  };
  return { ...base, evidence_sha256: sha256(Buffer.from(`${canonicalJson(base)}\n`)) };
}

export async function readCredentialFreeTrustedTime(runCommand = defaultRunCommand) {
  if (typeof runCommand !== "function") fail("COMMAND_RUNNER_INVALID");
  const args = [
    "--disable",
    "--silent",
    "--show-error",
    "--fail",
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
  let raw;
  try {
    raw = await runCommand(TRUSTED_TIME_COMMAND, args, {
      cwd: ROOT,
      encoding: "utf8",
      shell: false,
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", NO_PROXY: "*", no_proxy: "*" },
    });
  } catch {
    fail("TRUSTED_TIME_COMMAND_FAILED");
  }
  const result = normalizeCommandResult(raw);
  if (result.status !== 0 || /^authorization:/imu.test(result.stdout))
    fail("TRUSTED_TIME_COMMAND_FAILED");
  const dates = result.stdout
    .split(/\r?\n/u)
    .filter((line) => /^date:\s/iu.test(line))
    .map((line) => line.slice(line.indexOf(":") + 1).trim());
  if (dates.length !== 1 || Number.isNaN(Date.parse(dates[0]))) fail("TRUSTED_TIME_READBACK");
  return credentialFreeTimeEvidence(new Date(Date.parse(dates[0])).toISOString());
}

export async function readAuthenticatedTrustedTime(runCommand = defaultRunCommand) {
  if (typeof runCommand !== "function") fail("COMMAND_RUNNER_INVALID");
  const args = ["api", "--include", "rate_limit"];
  assertCommandSafe(COMMAND, args);
  let raw;
  try {
    raw = await runCommand(COMMAND, args, { cwd: ROOT, encoding: "utf8", shell: false });
  } catch {
    fail("TRUSTED_TIME_COMMAND_FAILED");
  }
  const result = normalizeCommandResult(raw);
  if (result.status !== 0 || /^authorization:/imu.test(result.stdout))
    fail("TRUSTED_TIME_COMMAND_FAILED");
  const dates = result.stdout
    .split(/\r?\n/u)
    .filter((line) => /^date:\s/iu.test(line))
    .map((line) => line.slice(line.indexOf(":") + 1).trim());
  if (dates.length !== 1 || Number.isNaN(Date.parse(dates[0]))) fail("TRUSTED_TIME_READBACK");
  return authenticatedTimeEvidence(new Date(Date.parse(dates[0])).toISOString());
}

function assertCommandSafe(command, args) {
  if (command !== COMMAND || !Array.isArray(args) || args[0] !== "api")
    fail("COMMAND_POLICY_VIOLATION");
  if (args[1] === "graphql") {
    if (canonicalJson(args) !== canonicalJson(["api", "graphql", "--input", "-"]))
      fail("COMMAND_POLICY_VIOLATION");
    return;
  }
  const joined = args.join(" ").toLowerCase();
  if (FORBIDDEN_COMMAND_TOKENS.some((token) => joined.includes(token)))
    fail("COMMAND_POLICY_VIOLATION");
  if (
    args.includes("--method") &&
    !["GET", "PATCH", "PUT"].includes(args[args.indexOf("--method") + 1])
  )
    fail("COMMAND_POLICY_VIOLATION");
  if (args.includes("--method") && args[args.indexOf("--method") + 1] === "PATCH") {
    const endpoint = args.find((arg) => arg.startsWith("repos/")) ?? "";
    if (!endpoint.includes("/git/refs/heads/")) fail("COMMAND_POLICY_VIOLATION");
    if (!args.some((arg) => arg.startsWith("-f sha="))) fail("COMMAND_POLICY_VIOLATION");
  }
  if (args.includes("--method") && args[args.indexOf("--method") + 1] === "PUT") {
    const endpoint = args.find((arg) => arg.startsWith("repos/")) ?? "";
    if (!endpoint.includes("/pulls/") || !endpoint.endsWith("/merge"))
      fail("COMMAND_POLICY_VIOLATION");
    if (!args.some((arg) => arg === "-f merge_method=merge")) fail("COMMAND_POLICY_VIOLATION");
  }
}

function normalizeCommandResult(result) {
  if (result === null || result === undefined) fail("COMMAND_FAILED");
  if (typeof result === "string") return { status: 0, stdout: result, stderr: "" };
  if (!isObject(result)) fail("COMMAND_FAILED");
  const status = result.status ?? result.exitCode;
  const stdout = result.stdout ?? result.output;
  if (!Number.isInteger(status) || typeof stdout !== "string") fail("COMMAND_FAILED");
  return {
    status,
    stdout,
    stderr: typeof result.stderr === "string" ? result.stderr : "",
  };
}

async function runJson(runCommand, args, label) {
  assertCommandSafe(COMMAND, ["api", ...args]);
  let raw;
  try {
    raw = await runCommand(COMMAND, ["api", ...args], {
      cwd: ROOT,
      encoding: "utf8",
      shell: false,
    });
  } catch {
    fail(`${label}_COMMAND_FAILED`);
  }
  const result = normalizeCommandResult(raw);
  if (result.status !== 0) fail(`${label}_COMMAND_FAILED`);
  try {
    return JSON.parse(result.stdout);
  } catch {
    fail(`${label}_JSON_INVALID`);
  }
}

async function runMutation(runCommand, args, label) {
  assertCommandSafe(COMMAND, ["api", ...args]);
  let raw;
  try {
    raw = await runCommand(COMMAND, ["api", ...args], {
      cwd: ROOT,
      encoding: "utf8",
      shell: false,
    });
  } catch {
    fail(`${label}_COMMAND_FAILED`);
  }
  const result = normalizeCommandResult(raw);
  if (result.status !== 0) fail(`${label}_COMMAND_FAILED`);
  if (!result.stdout.trim()) return {};
  try {
    return JSON.parse(result.stdout);
  } catch {
    fail(`${label}_JSON_INVALID`);
  }
}

export function createGraphqlCommitRequest(target, mechanism, sourceBytes) {
  if (!Buffer.isBuffer(sourceBytes) || sourceBytes.length === 0) fail("WORKFLOW_CONTENT_AMBIGUOUS");
  if (mechanism?.type !== "GRAPHQL_CREATE_COMMIT") fail("AUTHORITY_INVALID");
  const variables = {
    input: {
      branch: {
        repositoryNameWithOwner: target.repository,
        branchName: target.default_branch_name,
      },
      expectedHeadOid: target.default_branch_sha,
      message: { headline: mechanism.commit_message.headline },
      fileChanges: {
        additions: [
          {
            path: target.workflow.path,
            contents: sourceBytes.toString("base64"),
          },
        ],
      },
    },
  };
  const body = { query: GRAPHQL_CREATE_COMMIT_QUERY, variables };
  const input = `${canonicalJson(body)}\n`;
  return {
    args: ["api", "graphql", "--input", "-"],
    input,
    request_sha256: sha256(Buffer.from(input)),
  };
}

async function runGraphqlCreateCommit(runCommand, request) {
  assertCommandSafe(COMMAND, request.args);
  let raw;
  try {
    raw = await runCommand(COMMAND, request.args, {
      cwd: ROOT,
      encoding: "utf8",
      shell: false,
      input: request.input,
    });
  } catch {
    fail("GRAPHQL_CREATE_COMMIT_COMMAND_FAILED");
  }
  const result = normalizeCommandResult(raw);
  if (result.status !== 0) fail("GRAPHQL_CREATE_COMMIT_COMMAND_FAILED");
  let payload;
  try {
    payload = JSON.parse(result.stdout);
  } catch {
    fail("GRAPHQL_CREATE_COMMIT_JSON_INVALID");
  }
  if (!isObject(payload) || (Array.isArray(payload.errors) && payload.errors.length > 0))
    fail("GRAPHQL_CREATE_COMMIT_ACK_INVALID");
  return payload;
}

function apiPath(repository, suffix) {
  return suffix === "" ? `repos/${repository}` : `repos/${repository}/${suffix}`;
}

function contentPath(repository, workflowPath, ref) {
  return `${apiPath(repository, `contents/${workflowPath}`)}?ref=${encodeURIComponent(ref)}`;
}

function assertRepositoryReadback(repository, target) {
  if (!isObject(repository) || repository.full_name !== target.repository)
    fail("REMOTE_REPOSITORY_READBACK_DRIFT");
  if (repository.default_branch !== target.default_branch_name)
    fail("REMOTE_DEFAULT_BRANCH_NAME_DRIFT");
}

function assertRefReadback(ref, target, expectedSha, label) {
  if (
    !isObject(ref) ||
    ref.ref !== `refs/heads/${target.default_branch_name}` ||
    ref.object?.type !== "commit" ||
    ref.object?.sha !== expectedSha
  )
    fail(`${label}_DRIFT`);
}

function decodeGithubContent(content) {
  if (typeof content !== "string") fail("WORKFLOW_CONTENT_AMBIGUOUS");
  try {
    const normalized = content.replaceAll(/\s+/gu, "");
    if (
      normalized.length === 0 ||
      normalized.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/u.test(normalized) ||
      Buffer.from(normalized, "base64").toString("base64") !== normalized
    )
      fail("WORKFLOW_CONTENT_AMBIGUOUS");
    return Buffer.from(normalized, "base64");
  } catch {
    fail("WORKFLOW_CONTENT_AMBIGUOUS");
  }
}

function assertWorkflowContent(contentRecord, target, expectedRef) {
  const workflow = target.workflow;
  if (
    !isObject(contentRecord) ||
    contentRecord.type !== "file" ||
    contentRecord.path !== workflow.path ||
    contentRecord.sha !== workflow.blob_sha1 ||
    contentRecord.encoding !== "base64" ||
    (contentRecord.ref !== undefined && contentRecord.ref !== expectedRef)
  )
    fail("WORKFLOW_CONTENT_READBACK_DRIFT");
  const bytes = decodeGithubContent(contentRecord.content);
  if (sha256(bytes) !== workflow.blob_sha256) fail("WORKFLOW_BLOB_DRIFT");
  return bytes;
}

function assertCommitReadback(commit, target, expectedCommitSha, expectedParents) {
  const resulting = target.resulting;
  if (
    !isObject(commit) ||
    commit.sha !== expectedCommitSha ||
    commit.tree?.sha !== resulting.tree_sha ||
    JSON.stringify((commit.parents ?? []).map((parent) => parent.sha)) !==
      JSON.stringify(expectedParents)
  )
    fail("RESULT_COMMIT_DRIFT");
}

function assertGraphqlCreateCommitAck(payload, target, expectedMessageHeadline) {
  const result = payload?.data?.createCommitOnBranch;
  const commit = result?.commit;
  const ref = result?.ref;
  if (
    !isObject(result) ||
    !isObject(commit) ||
    !SHA1.test(commit.oid ?? "") ||
    commit.messageHeadline !== expectedMessageHeadline ||
    commit.tree?.oid !== target.resulting.tree_sha ||
    commit.parents?.totalCount !== 1 ||
    commit.parents?.pageInfo?.hasNextPage !== false ||
    !Array.isArray(commit.parents?.nodes) ||
    commit.parents.nodes.length !== 1 ||
    commit.parents.nodes[0]?.oid !== target.default_branch_sha ||
    !isObject(ref) ||
    ref.prefix !== "refs/heads/" ||
    ref.name !== target.default_branch_name ||
    ref.target?.oid !== commit.oid
  )
    fail("GRAPHQL_CREATE_COMMIT_ACK_INVALID");
  return commit.oid;
}

function assertBaseTreeReadback(tree, target) {
  if (
    !isObject(tree) ||
    !SHA1.test(tree.sha ?? "") ||
    tree.truncated !== false ||
    !Array.isArray(tree.tree)
  )
    fail("BASE_TREE_READBACK_AMBIGUOUS");
  canonicalTreeEntriesSha256(tree.tree);
  if (tree.tree.some((entry) => entry.path === target.workflow.path))
    fail("WORKFLOW_ALREADY_PRESENT_ON_DEFAULT_BRANCH");
}

function assertTreeReadback(tree, target) {
  const resulting = target.resulting;
  if (
    !isObject(tree) ||
    tree.sha !== resulting.tree_sha ||
    tree.truncated !== false ||
    !Array.isArray(tree.tree) ||
    canonicalTreeEntriesSha256(tree.tree) !== resulting.tree_entries_sha256
  )
    fail("RESULT_TREE_DRIFT");
  const workflowEntry = tree.tree.find((entry) => entry.path === target.workflow.path);
  if (
    !workflowEntry ||
    workflowEntry.type !== "blob" ||
    workflowEntry.sha !== target.workflow.blob_sha1
  )
    fail("RESULT_TREE_WORKFLOW_DRIFT");
}

function assertWorkflowRegistration(registration, target) {
  const expected = target.workflow_registration;
  if (
    !isObject(registration) ||
    !Number.isSafeInteger(registration.id) ||
    registration.id <= 0 ||
    registration.name !== expected.name ||
    registration.path !== expected.path ||
    registration.state !== expected.state
  )
    fail("WORKFLOW_REGISTRATION_READBACK_DRIFT");
  return registration;
}

function assertCredentialUse(value) {
  if (
    !exactKeys(value, [
      "authenticated",
      "provider",
      "source",
      "values_read",
      "values_exposed",
      "truncated",
    ]) ||
    value.authenticated !== true ||
    value.provider !== "github" ||
    value.source !== "gh-cli-auth" ||
    value.values_read !== false ||
    value.values_exposed !== false ||
    value.truncated !== false
  )
    fail("CREDENTIAL_USE_UNSAFE");
  return value;
}

export function createWorkflowRegistrationEvidence({ target, registration, resultingCommitSha }) {
  const workflowFilename = target.workflow.path.split("/").at(-1);
  if (!SHA1.test(resultingCommitSha ?? "")) fail("RESULT_COMMIT_UNBOUND");
  assertWorkflowRegistration(registration, target);
  const evidence = {
    schema_version: REGISTRATION_EVIDENCE_SCHEMA,
    repository: target.repository,
    default_branch: target.default_branch_name,
    default_branch_commit: resultingCommitSha,
    workflow_file: workflowFilename,
    workflow_name: registration.name,
    workflow_path: target.workflow.path,
    default_branch_workflow_sha256: target.workflow.blob_sha256,
    release_source_commit: target.release_source_commit,
    release_source_workflow_sha256: target.workflow.blob_sha256,
    registration_state: "REGISTERED_EXACT_DEFAULT_BRANCH",
    materialized: true,
    bound_to_release_source: true,
  };
  return {
    ...evidence,
    evidence_sha256: sha256(Buffer.from(canonicalJson(evidence))),
  };
}

function assertProtectedDirectory(path, code) {
  let metadata;
  try {
    metadata = lstatSync(path);
  } catch {
    fail(`${code}_PARENT_UNAVAILABLE`);
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o700)
    fail(`${code}_PARENT_PERMISSIONS`);
}

function durableJsonWrite(path, value, code) {
  if (typeof path !== "string" || path === "" || path.includes("\0")) fail(`${code}_PATH`);
  assertProtectedDirectory(dirname(path), code);
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  const expected = sha256(Buffer.from(payload));
  try {
    const existing = readFileSync(path);
    if (sha256(existing) !== expected) fail(`${code}_DRIFT`);
    return expected;
  } catch (error) {
    if (String(error?.message ?? "").startsWith("V2_13_DEFAULT_BRANCH_WORKFLOW_REPAIR_"))
      throw error;
    if (error?.code !== "ENOENT") fail(`${code}_READ_FAILED`);
  }
  const temporary = join(
    dirname(path),
    `.${process.pid}.${Math.random().toString(16).slice(2)}.${code.toLowerCase()}.tmp`,
  );
  let fileDescriptor;
  try {
    fileDescriptor = openSync(temporary, "wx", 0o600);
    writeFileSync(fileDescriptor, payload, { encoding: "utf8" });
    fsyncSync(fileDescriptor);
    closeSync(fileDescriptor);
    fileDescriptor = undefined;
    renameSync(temporary, path);
    const directoryDescriptor = openSync(dirname(path), "r");
    try {
      fsyncSync(directoryDescriptor);
    } finally {
      closeSync(directoryDescriptor);
    }
  } catch {
    if (fileDescriptor !== undefined) {
      try {
        closeSync(fileDescriptor);
      } catch {
        // Best-effort descriptor close; the operation still fails closed.
      }
    }
    try {
      unlinkSync(temporary);
    } catch {
      // The temporary name is unique and may already have been renamed.
    }
    fail(`${code}_WRITE_FAILED`);
  }
  return expected;
}

function defaultSidecarPath(authorityFile, explicitPath, suffix) {
  if (explicitPath !== undefined) {
    if (typeof explicitPath !== "string" || explicitPath === "" || explicitPath.includes("\0"))
      fail(`${suffix}_PATH`);
    return resolve(explicitPath);
  }
  if (authorityFile !== undefined) return `${resolve(authorityFile)}.${suffix.toLowerCase()}.json`;
  fail(`${suffix}_PATH_REQUIRED`);
}

function terminalRecordPath(authorityFile, explicitPath) {
  return defaultSidecarPath(authorityFile, explicitPath, "terminal-record");
}

function registrationEvidencePath(authorityFile, explicitPath) {
  return defaultSidecarPath(authorityFile, explicitPath, "registration-evidence");
}

function assertSidecarPathAvailable(path, code) {
  assertProtectedDirectory(dirname(path), code);
  try {
    lstatSync(path);
    fail(`${code}_PATH_OCCUPIED`);
  } catch (error) {
    if (String(error?.message ?? "").startsWith("V2_13_DEFAULT_BRANCH_WORKFLOW_REPAIR_"))
      throw error;
    if (error?.code !== "ENOENT") fail(`${code}_PATH_INSPECTION_FAILED`);
  }
}

function terminalRecordValue({
  path,
  consumed,
  target,
  mechanism,
  state = ACK_UNKNOWN_STATE,
  mutationStarted = true,
  resultingCommitSha = null,
  mutationRequestSha256 = null,
  priorBytesSha256 = null,
  authorityRecordCommit = null,
}) {
  const base = {
    schema_version: RESULT_SCHEMA,
    state,
    mode: READBACK_ONLY_MODE,
    operation: REPAIR_OPERATION_ID,
    authority_id: consumed.authority_id,
    authority_record_commit: authorityRecordCommit,
    repository: target.repository,
    default_branch: target.default_branch_name,
    workflow_path: target.workflow.path,
    expected_default_branch_sha: target.default_branch_sha,
    expected_resulting_tree_sha: target.resulting.tree_sha,
    resulting_commit_sha: resultingCommitSha,
    mutation_request_sha256: mutationRequestSha256,
    mutation_started: mutationStarted,
    no_retry: true,
    no_replay: true,
    no_fallback: true,
    no_redispatch: true,
    target:
      mechanism.type === "GRAPHQL_CREATE_COMMIT"
        ? target
        : {
            repository: target.repository,
            default_branch_name: target.default_branch_name,
            default_branch_sha: target.default_branch_sha,
            release_source_commit: target.release_source_commit,
            workflow: target.workflow,
            resulting: {
              commit_sha: resultingCommitSha,
              tree_sha: target.resulting.tree_sha,
              tree_entries_sha256: target.resulting.tree_entries_sha256,
              parent_commit_shas:
                resultingCommitSha === null
                  ? null
                  : resultingCommitSha === target.resulting.commit_sha
                    ? target.resulting.parent_commit_shas
                    : [target.default_branch_sha, mechanism?.pull_request_head_sha ?? null],
            },
            workflow_registration: target.workflow_registration,
          },
    mechanism,
    credential_use: {
      authenticated: true,
      provider: "github",
      source: "gh-cli-auth",
      values_read: false,
      values_exposed: false,
      truncated: false,
    },
    prior_authority_bytes_sha256: priorBytesSha256,
  };
  const record = {
    ...base,
    terminal_record_sha256: sha256(Buffer.from(`${canonicalJson(base)}\n`)),
  };
  return { path, record };
}

function writeMutationIntentRecord({
  path,
  consumed,
  target,
  mechanism,
  resultingCommitSha,
  mutationRequestSha256 = null,
  priorBytesSha256,
  authorityRecordCommit,
}) {
  const { record } = terminalRecordValue({
    path,
    consumed,
    target,
    mechanism,
    state: MUTATION_INTENT_STATE,
    mutationStarted: false,
    resultingCommitSha,
    mutationRequestSha256,
    priorBytesSha256,
    authorityRecordCommit,
  });
  return durableJsonWrite(path, record, "TERMINAL_RECORD");
}

function writeAckUnknownRecord({
  path,
  consumed,
  target,
  mechanism,
  resultingCommitSha = null,
  mutationRequestSha256 = null,
  priorBytesSha256 = null,
  authorityRecordCommit = null,
}) {
  const intentResultingCommitSha = ["PROTECTED_BRANCH", "GRAPHQL_CREATE_COMMIT"].includes(
    mechanism.type,
  )
    ? target.resulting.commit_sha
    : resultingCommitSha;
  const { record: expectedIntent } = terminalRecordValue({
    path,
    consumed,
    target,
    mechanism,
    state: MUTATION_INTENT_STATE,
    mutationStarted: false,
    resultingCommitSha: intentResultingCommitSha,
    mutationRequestSha256,
    priorBytesSha256,
    authorityRecordCommit,
  });
  const { record } = terminalRecordValue({
    path,
    consumed,
    target,
    mechanism,
    state: ACK_UNKNOWN_STATE,
    mutationStarted: true,
    resultingCommitSha,
    mutationRequestSha256,
    priorBytesSha256,
    authorityRecordCommit,
  });
  let current;
  try {
    current = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    fail("TERMINAL_INTENT_MISSING");
  }
  if (
    !isObject(current) ||
    current.state !== MUTATION_INTENT_STATE ||
    canonicalJson(current) !== canonicalJson(expectedIntent)
  )
    fail("TERMINAL_INTENT_DRIFT");
  replaceDurably(path, Buffer.from(`${JSON.stringify(record, null, 2)}\n`), "TERMINAL_RECORD");
  return sha256(Buffer.from(`${JSON.stringify(record, null, 2)}\n`));
}

function targetEndpoint(target, commitSha = target.resulting.commit_sha) {
  if (!SHA1.test(commitSha ?? "")) fail("RESULT_COMMIT_UNBOUND");
  return apiPath(target.repository, `git/commits/${commitSha}`);
}

function targetTreeEndpoint(target) {
  return apiPath(target.repository, `git/trees/${target.resulting.tree_sha}?recursive=1`);
}

async function readExactRemoteState({ target, mechanism, runCommand, phase }) {
  const repository = await runJson(
    runCommand,
    [apiPath(target.repository, "")],
    `${phase}_REPOSITORY`,
  );
  assertRepositoryReadback(repository, target);

  const ref = await runJson(
    runCommand,
    [apiPath(target.repository, `git/ref/heads/${target.default_branch_name}`)],
    `${phase}_DEFAULT_BRANCH`,
  );
  assertRefReadback(ref, target, target.default_branch_sha, `${phase}_DEFAULT_BRANCH`);

  const sourceContent = await runJson(
    runCommand,
    [contentPath(target.repository, target.workflow.path, target.release_source_commit)],
    `${phase}_SOURCE_WORKFLOW`,
  );
  const sourceBytes = assertWorkflowContent(sourceContent, target, target.release_source_commit);

  let resultingCommit = null;
  if (mechanism.type === "FAST_FORWARD") {
    resultingCommit = await runJson(runCommand, [targetEndpoint(target)], `${phase}_RESULT_COMMIT`);
    assertCommitReadback(
      resultingCommit,
      target,
      target.resulting.commit_sha,
      target.resulting.parent_commit_shas,
    );
  }
  // A protected-branch merge commit is intentionally dynamic.  Its exact tree
  // is checked only after GitHub returns the merge SHA; requiring the resulting
  // tree before the merge would turn a dynamic commit into a precondition.
  let resultingTree = null;
  if (mechanism.type === "FAST_FORWARD") {
    resultingTree = await runJson(runCommand, [targetTreeEndpoint(target)], `${phase}_RESULT_TREE`);
    assertTreeReadback(resultingTree, target);
  }

  let baseCommit = null;
  let baseTree = null;
  if (mechanism.type === "GRAPHQL_CREATE_COMMIT") {
    baseCommit = await runJson(
      runCommand,
      [targetEndpoint(target, target.default_branch_sha)],
      `${phase}_BASE_COMMIT`,
    );
    if (
      !isObject(baseCommit) ||
      baseCommit.sha !== target.default_branch_sha ||
      !SHA1.test(baseCommit.tree?.sha ?? "")
    )
      fail(`${phase}_BASE_COMMIT_DRIFT`);
    baseTree = await runJson(
      runCommand,
      [apiPath(target.repository, `git/trees/${baseCommit.tree.sha}?recursive=1`)],
      `${phase}_BASE_TREE`,
    );
    if (baseTree?.sha !== baseCommit.tree.sha) fail(`${phase}_BASE_TREE_DRIFT`);
    assertBaseTreeReadback(baseTree, target);
  }

  if (mechanism.type === "PROTECTED_BRANCH") {
    const pull = await runJson(
      runCommand,
      [apiPath(target.repository, `pulls/${mechanism.pull_request_number}`)],
      `${phase}_PROTECTED_BRANCH_PULL_REQUEST`,
    );
    if (
      !isObject(pull) ||
      pull.number !== mechanism.pull_request_number ||
      pull.base?.ref !== mechanism.pull_request_base_ref ||
      pull.base?.sha !== mechanism.pull_request_base_sha ||
      pull.head?.ref !== mechanism.pull_request_head_ref ||
      pull.head?.sha !== mechanism.pull_request_head_sha ||
      pull.state !== "open"
    )
      fail(`${phase}_PROTECTED_BRANCH_DRIFT`);
  }

  return {
    repository,
    ref,
    sourceContent,
    sourceBytes,
    resultingCommit,
    resultingTree,
    baseCommit,
    baseTree,
  };
}

async function readFinalRemoteState({
  target,
  runCommand,
  resultingCommitSha,
  expectedParents,
  expectedMessageHeadline,
}) {
  const commitSha = resultingCommitSha ?? target.resulting.commit_sha;
  if (!SHA1.test(commitSha ?? "")) fail("RESULT_COMMIT_UNBOUND");
  const repository = await runJson(
    runCommand,
    [apiPath(target.repository, "")],
    "FINAL_REPOSITORY",
  );
  assertRepositoryReadback(repository, target);
  const ref = await runJson(
    runCommand,
    [apiPath(target.repository, `git/ref/heads/${target.default_branch_name}`)],
    "FINAL_DEFAULT_BRANCH",
  );
  assertRefReadback(ref, target, commitSha, "FINAL_DEFAULT_BRANCH");
  const content = await runJson(
    runCommand,
    [contentPath(target.repository, target.workflow.path, commitSha)],
    "FINAL_WORKFLOW_CONTENT",
  );
  assertWorkflowContent(content, target, commitSha);
  const commit = await runJson(
    runCommand,
    [targetEndpoint(target, commitSha)],
    "FINAL_RESULT_COMMIT",
  );
  assertCommitReadback(
    commit,
    target,
    commitSha,
    expectedParents ?? target.resulting.parent_commit_shas,
  );
  if (expectedMessageHeadline !== undefined && commit.message !== expectedMessageHeadline)
    fail("RESULT_COMMIT_MESSAGE_DRIFT");
  const tree = await runJson(runCommand, [targetTreeEndpoint(target)], "FINAL_RESULT_TREE");
  assertTreeReadback(tree, target);
  const workflowFilename = target.workflow.path.split("/").at(-1);
  const registration = await runJson(
    runCommand,
    [apiPath(target.repository, `actions/workflows/${encodeURIComponent(workflowFilename)}`)],
    "FINAL_WORKFLOW_REGISTRATION",
  );
  assertWorkflowRegistration(registration, target);
  return { repository, ref, content, commit, tree, registration };
}

function consumeInMemoryAuthority(authority, now) {
  validateRepairAuthority(authority, { skipTime: true });
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) fail("TRUSTED_TIME_REQUIRED");
  consumedAuthorityIds.add(authority.authority_id);
  return {
    ...authority,
    state: CONSUMED_AUTHORITY_STATE,
    use_count: 1,
    consumed_at: now.toISOString(),
    execution_id: `${authority.authority_id}-${now.toISOString().replaceAll(/[^0-9A-Za-z]/gu, "")}`,
  };
}

function readAuthorityFileSnapshot(authorityFile) {
  let bytes;
  try {
    assertProtectedDirectory(dirname(authorityFile), "AUTHORITY_FILE");
    const metadata = lstatSync(authorityFile);
    const mode = metadata.mode & 0o777;
    if (!metadata.isFile() || metadata.isSymbolicLink() || mode !== 0o600)
      fail("AUTHORITY_FILE_PERMISSIONS");
    bytes = readFileSync(authorityFile);
  } catch (error) {
    if (String(error?.message ?? "").startsWith("V2_13_DEFAULT_BRANCH_WORKFLOW_REPAIR_"))
      throw error;
    fail("AUTHORITY_FILE_READ_FAILED");
  }
  try {
    return {
      authority: JSON.parse(bytes.toString("utf8")),
      bytesSha256: sha256(bytes),
    };
  } catch {
    fail("AUTHORITY_FILE_JSON_INVALID");
  }
}

function readAuthorityFile(authorityFile) {
  return readAuthorityFileSnapshot(authorityFile).authority;
}

function fsyncDirectory(path) {
  const descriptor = openSync(path, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function replaceDurably(path, bytes, code) {
  assertProtectedDirectory(dirname(path), code);
  const temporary = join(
    dirname(path),
    `.${process.pid}.${Math.random().toString(16).slice(2)}.${code.toLowerCase()}.tmp`,
  );
  let descriptor;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, path);
    fsyncDirectory(dirname(path));
  } catch {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // Best-effort descriptor close; the operation still fails closed.
      }
    }
    try {
      unlinkSync(temporary);
    } catch {
      // The temporary name is unique and may already have been renamed.
    }
    fail(`${code}_WRITE_FAILED`);
  }
}

export function consumeRepairAuthorityFile(
  authorityFile,
  { trustedTime, expectedPriorBytesSha256 } = {},
) {
  if (typeof authorityFile !== "string" || authorityFile === "") fail("AUTHORITY_FILE_INVALID");
  if (!(trustedTime instanceof Date) || !Number.isFinite(trustedTime.getTime()))
    fail("TRUSTED_TIME_REQUIRED");
  if (expectedPriorBytesSha256 !== undefined && !SHA256.test(expectedPriorBytesSha256))
    fail("AUTHORITY_PRIOR_BYTES_HASH_INVALID");
  assertProtectedDirectory(dirname(authorityFile), "AUTHORITY_FILE");
  const lockPath = `${authorityFile}.lock`;
  let lockDescriptor;
  let lockToken;
  let lockOwned = false;
  try {
    lockDescriptor = openSync(lockPath, "wx", 0o600);
    lockOwned = true;
    lockToken = Buffer.from(`${randomUUID()}\n`, "utf8");
    writeFileSync(lockDescriptor, lockToken);
    fsyncSync(lockDescriptor);
    fsyncDirectory(dirname(lockPath));
  } catch {
    if (lockOwned) {
      try {
        closeSync(lockDescriptor);
      } catch {
        // Best-effort close before releasing only our own failed lock.
      }
      try {
        unlinkSync(lockPath);
      } catch {
        // Do not mask the lock acquisition failure.
      }
    }
    fail("AUTHORITY_LOCK_BUSY_OR_UNAVAILABLE");
  }
  try {
    const metadata = lstatSync(authorityFile);
    if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o600)
      fail("AUTHORITY_FILE_PERMISSIONS");
    const priorBytes = readFileSync(authorityFile);
    const priorHash = sha256(priorBytes);
    if (expectedPriorBytesSha256 !== undefined && priorHash !== expectedPriorBytesSha256)
      fail("AUTHORITY_PRIOR_BYTES_CAS_DRIFT");
    let authority;
    try {
      authority = JSON.parse(priorBytes.toString("utf8"));
    } catch {
      fail("AUTHORITY_FILE_JSON_INVALID");
    }
    validateRepairAuthority(authority, { skipTime: true });
    if (new Date(authority.expires_at).getTime() <= trustedTime.getTime())
      fail("AUTHORITY_EXPIRED");
    if (new Date(authority.issued_at).getTime() > trustedTime.getTime())
      fail("AUTHORITY_NOT_YET_VALID");
    const consumed = consumeInMemoryAuthority(authority, trustedTime);
    const currentBytes = readFileSync(authorityFile);
    if (sha256(currentBytes) !== priorHash) fail("AUTHORITY_PRIOR_BYTES_CAS_DRIFT");
    replaceDurably(
      authorityFile,
      Buffer.from(`${JSON.stringify(consumed, null, 2)}\n`),
      "AUTHORITY_CONSUMPTION",
    );
    return { authority: consumed, priorBytesSha256: priorHash };
  } finally {
    try {
      closeSync(lockDescriptor);
    } catch {
      // The lock descriptor can already be closed if setup failed.
    }
    if (lockOwned && lockToken !== undefined) {
      let stillOwned = false;
      try {
        stillOwned = Buffer.compare(readFileSync(lockPath), lockToken) === 0;
      } catch {
        // The lock may already have been removed by a failed setup path.
      }
      if (stillOwned) {
        try {
          unlinkSync(lockPath);
          fsyncDirectory(dirname(lockPath));
        } catch {
          // Do not mask a terminal execution result with best-effort lock cleanup.
        }
      }
    }
  }
}

function noActionResult() {
  return {
    schema_version: RESULT_SCHEMA,
    state: NO_ACTION_STATE,
    operation: REPAIR_OPERATION_ID,
    external_calls: 0,
    mutations: 0,
    authenticated_credential_use: false,
    credential_values_read: 0,
    credential_values_exposed: 0,
    workflow_dispatches: 0,
    spend_usd: 0,
    authority_consumed: false,
  };
}

/**
 * Execute the one permitted default-branch repair.
 *
 * In-memory authority is accepted only behind the explicit provider-free test
 * flag and never with the production command runner. Production requires a
 * protected authority file and an externally supplied authority-record commit.
 */
export async function executeDefaultBranchWorkflowRepair({
  authority,
  authorityFile,
  authorityRecordCommit,
  runCommand = defaultRunCommand,
  confirm = false,
  preConsumptionTrustedTime,
  preMutationTrustedTime,
  verifyTrustRoot = verifyRepairAuthorityTrustRoot,
  testOnlyAllowInMemoryAuthority = false,
  terminalRecordFile,
  registrationEvidenceFile,
} = {}) {
  if (confirm !== true) fail("CONFIRMATION_REQUIRED");
  if (typeof runCommand !== "function") fail("COMMAND_RUNNER_INVALID");
  if (typeof verifyTrustRoot !== "function") fail("TRUST_ROOT_VERIFIER_INVALID");
  if (authorityFile !== undefined && authority !== undefined) fail("AUTHORITY_INPUT_AMBIGUOUS");
  if (authorityFile === undefined && testOnlyAllowInMemoryAuthority !== true)
    fail("DURABLE_AUTHORITY_FILE_REQUIRED");
  if (authorityFile === undefined && runCommand === defaultRunCommand)
    fail("IN_MEMORY_AUTHORITY_WITH_REAL_RUNNER_FORBIDDEN");
  if (authorityFile !== undefined && !SHA1.test(authorityRecordCommit ?? ""))
    fail("TRUST_ROOT_AUTHORITY_COMMIT_INVALID");
  let externalCalls = 0;
  const countedRunCommand = async (...args) => {
    externalCalls += 1;
    return runCommand(...args);
  };
  const authorityPath = authorityFile === undefined ? undefined : resolve(authorityFile);
  const authoritySnapshot =
    authorityPath === undefined ? undefined : readAuthorityFileSnapshot(authorityPath);
  const candidate = authorityPath === undefined ? authority : authoritySnapshot.authority;
  validateRepairAuthority(candidate, { skipTime: true });
  let trustResult;
  try {
    trustResult = await verifyTrustRoot(candidate, {
      authorityFile: authorityPath,
      authorityRecordCommit,
    });
  } catch (error) {
    if (String(error?.message ?? "").startsWith("V2_13_DEFAULT_BRANCH_WORKFLOW_REPAIR_"))
      throw error;
    fail("TRUST_ROOT_VERIFICATION_FAILED");
  }
  if (trustResult !== true && !isObject(trustResult)) fail("TRUST_ROOT_VERIFICATION_FAILED");
  const trustedAuthorityRecordCommit =
    (isObject(trustResult) ? trustResult.authorityRecordCommit : null) ??
    authorityRecordCommit ??
    null;
  if (authorityPath !== undefined && !SHA1.test(trustedAuthorityRecordCommit ?? ""))
    fail("TRUST_ROOT_AUTHORITY_COMMIT_INVALID");
  const terminalPath = terminalRecordPath(authorityPath, terminalRecordFile);
  const evidencePath = registrationEvidencePath(authorityPath, registrationEvidenceFile);
  if (
    terminalPath === evidencePath ||
    (authorityPath !== undefined &&
      [authorityPath, `${authorityPath}.lock`].includes(terminalPath)) ||
    (authorityPath !== undefined && [authorityPath, `${authorityPath}.lock`].includes(evidencePath))
  )
    fail("SIDECAR_PATH_AMBIGUOUS");
  assertSidecarPathAvailable(terminalPath, "TERMINAL_RECORD");
  assertSidecarPathAvailable(evidencePath, "REGISTRATION_EVIDENCE");
  const credentialFreeTimeProvider =
    preConsumptionTrustedTime ?? (() => readCredentialFreeTrustedTime(countedRunCommand));
  const authenticatedTimeProvider =
    preMutationTrustedTime ?? (() => readAuthenticatedTrustedTime(countedRunCommand));
  if (
    typeof credentialFreeTimeProvider !== "function" ||
    typeof authenticatedTimeProvider !== "function"
  )
    fail("TRUSTED_TIME_PROVIDER_INVALID");
  let trustedRecord;
  try {
    trustedRecord = assertTrustedTimeRecord(
      await credentialFreeTimeProvider(countedRunCommand),
      "GITHUB_CA_VERIFIED_DATE",
      false,
    );
  } catch (error) {
    if (String(error?.message ?? "").startsWith("V2_13_DEFAULT_BRANCH_WORKFLOW_REPAIR_"))
      throw error;
    fail("TRUSTED_TIME_INVALID");
  }
  const currentTime = new Date(trustedRecord.iso);
  validateRepairAuthority(candidate, { now: currentTime });
  const consumedInfo = authorityPath
    ? consumeRepairAuthorityFile(authorityPath, {
        trustedTime: currentTime,
        expectedPriorBytesSha256: authoritySnapshot.bytesSha256,
      })
    : {
        authority: consumeInMemoryAuthority(candidate, currentTime),
        priorBytesSha256: sha256(Buffer.from(`${JSON.stringify(candidate, null, 2)}\n`)),
      };
  const consumed = consumedInfo.authority;
  const target = consumed.target;
  let mutationStarted = false;
  let resultingCommitSha = target.resulting.commit_sha;
  let mutationRequest = null;
  let mutationRequestSha256 = null;
  try {
    const preflight = await readExactRemoteState({
      target,
      mechanism: consumed.mechanism,
      runCommand: countedRunCommand,
      phase: "PRE",
    });
    if (preflight.ref.object?.sha !== target.default_branch_sha) fail("PRE_DEFAULT_BRANCH_DRIFT");
    if (consumed.mechanism.type === "GRAPHQL_CREATE_COMMIT") {
      mutationRequest = createGraphqlCommitRequest(
        target,
        consumed.mechanism,
        preflight.sourceBytes,
      );
      mutationRequestSha256 = mutationRequest.request_sha256;
      if (mutationRequestSha256 !== consumed.mechanism.request_sha256)
        fail("GRAPHQL_CREATE_COMMIT_REQUEST_DRIFT");
    }

    let secondTrustedRecord;
    try {
      secondTrustedRecord = assertTrustedTimeRecord(
        await authenticatedTimeProvider(countedRunCommand),
        "GITHUB_AUTHENTICATED_DATE",
        true,
      );
    } catch (error) {
      if (String(error?.message ?? "").startsWith("V2_13_DEFAULT_BRANCH_WORKFLOW_REPAIR_"))
        throw error;
      fail("TRUSTED_TIME_INVALID");
    }
    assertAuthorityTimeWindow(candidate, new Date(secondTrustedRecord.iso));

    // Persist the one-shot mutation intent before entering PATCH/PUT. A hard
    // process crash can occur after the provider accepts the request but before
    // JavaScript receives a response; the durable intent is then the only legal
    // restart anchor. Reconciliation consumes no authority and never replays
    // this mutation.
    writeMutationIntentRecord({
      path: terminalPath,
      consumed,
      target,
      mechanism: consumed.mechanism,
      resultingCommitSha,
      mutationRequestSha256,
      priorBytesSha256: consumedInfo.priorBytesSha256,
      authorityRecordCommit: trustedAuthorityRecordCommit,
    });

    let mutationResponse;
    if (consumed.mechanism.type === "FAST_FORWARD") {
      mutationStarted = true;
      mutationResponse = await runMutation(
        countedRunCommand,
        [
          "--method",
          "PATCH",
          apiPath(target.repository, `git/refs/heads/${target.default_branch_name}`),
          `-f sha=${target.resulting.commit_sha}`,
        ],
        "FAST_FORWARD",
      );
    } else if (consumed.mechanism.type === "GRAPHQL_CREATE_COMMIT") {
      mutationStarted = true;
      mutationResponse = await runGraphqlCreateCommit(countedRunCommand, mutationRequest);
      resultingCommitSha = assertGraphqlCreateCommitAck(
        mutationResponse,
        target,
        consumed.mechanism.commit_message.headline,
      );
    } else {
      mutationStarted = true;
      mutationResponse = await runMutation(
        countedRunCommand,
        [
          "--method",
          "PUT",
          apiPath(target.repository, `pulls/${consumed.mechanism.pull_request_number}/merge`),
          "-f merge_method=merge",
          `-f sha=${consumed.mechanism.pull_request_head_sha}`,
        ],
        "PROTECTED_BRANCH",
      );
      if (
        !isObject(mutationResponse) ||
        mutationResponse.merged !== true ||
        !SHA1.test(mutationResponse.sha ?? "")
      )
        fail("PROTECTED_BRANCH_MERGE_ACK_INVALID");
      resultingCommitSha = mutationResponse.sha;
    }
    const expectedParents =
      consumed.mechanism.type === "PROTECTED_BRANCH"
        ? [consumed.mechanism.pull_request_base_sha, consumed.mechanism.pull_request_head_sha]
        : target.resulting.parent_commit_shas;
    const final = await readFinalRemoteState({
      target,
      runCommand: countedRunCommand,
      resultingCommitSha,
      expectedParents,
      expectedMessageHeadline:
        consumed.mechanism.type === "GRAPHQL_CREATE_COMMIT"
          ? consumed.mechanism.commit_message.headline
          : undefined,
    });
    const registrationEvidence = createWorkflowRegistrationEvidence({
      target,
      registration: final.registration,
      resultingCommitSha,
    });
    durableJsonWrite(evidencePath, registrationEvidence, "REGISTRATION_EVIDENCE");
    return {
      schema_version: RESULT_SCHEMA,
      state: "REPAIR_COMPLETE",
      operation: REPAIR_OPERATION_ID,
      authority_id: consumed.authority_id,
      authority_record_commit: trustedAuthorityRecordCommit,
      mechanism: consumed.mechanism.type,
      repository: target.repository,
      default_branch: target.default_branch_name,
      default_branch_sha: resultingCommitSha,
      workflow_path: target.workflow.path,
      workflow_blob_sha256: target.workflow.blob_sha256,
      resulting_commit_sha: resultingCommitSha,
      resulting_tree_sha: target.resulting.tree_sha,
      workflow_registration_id: final.registration.id,
      external_calls: externalCalls,
      mutations: 1,
      authenticated_credential_use: true,
      credential_values_read: 0,
      credential_values_exposed: 0,
      workflow_dispatches: 0,
      spend_usd: 0,
      authority_consumed: true,
      terminal_record_mode: READBACK_ONLY_MODE,
      registration_evidence_file: evidencePath,
      registration_evidence_sha256: registrationEvidence.evidence_sha256,
      credential_use: {
        authenticated: true,
        provider: "github",
        source: "gh-cli-auth",
        values_read: false,
        values_exposed: false,
        truncated: false,
      },
      mutation_response: isObject(mutationResponse)
        ? Object.fromEntries(
            Object.entries(mutationResponse).filter(([key]) =>
              ["sha", "merged", "message"].includes(key),
            ),
          )
        : {},
      remote_readback: {
        repository: final.repository.full_name,
        default_branch: final.repository.default_branch,
        ref: final.ref.ref,
        workflow_path: final.content.path,
        workflow_blob_sha1: final.content.sha,
        workflow_registration_state: final.registration.state,
      },
    };
  } catch (error) {
    // Never retry, redispatch, roll back with a force update, or attempt branch
    // deletion here.  Once the mutation call was entered, the only safe result is
    // an opaque terminal uncertainty for a caller to inspect independently.
    if (mutationStarted) {
      try {
        writeAckUnknownRecord({
          path: terminalPath,
          consumed,
          target,
          mechanism: consumed.mechanism,
          resultingCommitSha,
          mutationRequestSha256,
          priorBytesSha256: consumedInfo.priorBytesSha256,
          authorityRecordCommit: trustedAuthorityRecordCommit,
        });
      } catch {
        fail("ACK_UNKNOWN_DURABLE_RECORD_FAILED");
      }
      fail("ACK_UNKNOWN_READBACK_ONLY_NO_REPLAY");
    }
    throw error;
  }
}

/**
 * Reconcile an ACK_UNKNOWN terminal record.  This function has no mutation path:
 * it accepts only a terminal record, performs exact readbacks, and never consumes
 * authority or invokes PATCH/PUT.  A caller must create a fresh repair authority
 * for any future mutation, even when this readback is inconclusive.
 */
export async function reconcileDefaultBranchWorkflowRepair({
  terminalRecordFile,
  runCommand = defaultRunCommand,
  registrationEvidenceFile,
  reconciliationRecordFile,
} = {}) {
  if (typeof terminalRecordFile !== "string" || terminalRecordFile === "")
    fail("TERMINAL_RECORD_PATH_REQUIRED");
  if (typeof runCommand !== "function") fail("COMMAND_RUNNER_INVALID");
  const terminalPath = resolve(terminalRecordFile);
  const evidencePath = resolve(
    registrationEvidenceFile ?? `${terminalPath}.registration-evidence.json`,
  );
  const reconciliationPath = resolve(
    reconciliationRecordFile ?? `${terminalPath}.reconciliation.json`,
  );
  if (
    new Set([terminalPath, evidencePath, reconciliationPath]).size !== 3 ||
    [evidencePath, reconciliationPath].some((path) => path === `${terminalPath}.lock`)
  )
    fail("SIDECAR_PATH_AMBIGUOUS");
  assertProtectedDirectory(dirname(terminalPath), "TERMINAL_RECORD");
  assertProtectedDirectory(dirname(evidencePath), "REGISTRATION_EVIDENCE");
  assertProtectedDirectory(dirname(reconciliationPath), "RECONCILIATION_RECORD");
  let record;
  try {
    const metadata = lstatSync(terminalPath);
    if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o600)
      fail("TERMINAL_RECORD_PERMISSIONS");
    record = JSON.parse(readFileSync(terminalPath, "utf8"));
  } catch (error) {
    if (String(error?.message ?? "").startsWith("V2_13_DEFAULT_BRANCH_WORKFLOW_REPAIR_"))
      throw error;
    fail("TERMINAL_RECORD_READ_FAILED");
  }
  if (
    !isObject(record) ||
    !exactKeys(record, [
      "schema_version",
      "state",
      "mode",
      "operation",
      "authority_id",
      "authority_record_commit",
      "repository",
      "default_branch",
      "workflow_path",
      "expected_default_branch_sha",
      "expected_resulting_tree_sha",
      "resulting_commit_sha",
      "mutation_request_sha256",
      "mutation_started",
      "no_retry",
      "no_replay",
      "no_fallback",
      "no_redispatch",
      "target",
      "mechanism",
      "credential_use",
      "prior_authority_bytes_sha256",
      "terminal_record_sha256",
    ]) ||
    record.schema_version !== RESULT_SCHEMA ||
    ![ACK_UNKNOWN_STATE, MUTATION_INTENT_STATE].includes(record.state) ||
    record.mode !== READBACK_ONLY_MODE ||
    record.mutation_started !== (record.state === ACK_UNKNOWN_STATE) ||
    record.no_retry !== true ||
    record.no_replay !== true ||
    record.no_fallback !== true ||
    record.no_redispatch !== true ||
    !isObject(record.target) ||
    !AUTHORITY_ID.test(record.authority_id ?? "") ||
    !(record.authority_record_commit === null || SHA1.test(record.authority_record_commit)) ||
    record.repository !== record.target.repository ||
    record.default_branch !== record.target.default_branch_name ||
    record.workflow_path !== record.target.workflow.path ||
    record.expected_default_branch_sha !== record.target.default_branch_sha ||
    record.expected_resulting_tree_sha !== record.target.resulting.tree_sha ||
    (record.mechanism?.type === "GRAPHQL_CREATE_COMMIT"
      ? !(record.resulting_commit_sha === null || SHA1.test(record.resulting_commit_sha))
      : record.resulting_commit_sha !== record.target.resulting.commit_sha &&
        !(record.resulting_commit_sha === null && record.target.resulting.commit_sha === null)) ||
    (record.mechanism?.type === "GRAPHQL_CREATE_COMMIT"
      ? record.mutation_request_sha256 !== record.mechanism.request_sha256
      : record.mutation_request_sha256 !== null) ||
    (record.prior_authority_bytes_sha256 !== null &&
      !SHA256.test(record.prior_authority_bytes_sha256)) ||
    !SHA256.test(record.terminal_record_sha256 ?? "")
  )
    fail("TERMINAL_RECORD_INVALID");
  assertCredentialUse(record.credential_use);
  const withoutHash = withoutKey(record, "terminal_record_sha256");
  if (sha256(Buffer.from(`${canonicalJson(withoutHash)}\n`)) !== record.terminal_record_sha256)
    fail("TERMINAL_RECORD_DRIFT");
  const target = record.target;
  assertTarget(target);
  const mechanism = record.mechanism;
  assertMechanism(
    mechanism,
    mechanism.type === "PROTECTED_BRANCH"
      ? {
          ...target,
          resulting: { ...target.resulting, commit_sha: null, parent_commit_shas: null },
        }
      : target,
  );
  const expectedParents =
    mechanism.type === "PROTECTED_BRANCH"
      ? [mechanism.pull_request_base_sha, mechanism.pull_request_head_sha]
      : target.resulting.parent_commit_shas;
  let externalCalls = 0;
  const countedRunCommand = async (...args) => {
    externalCalls += 1;
    return runCommand(...args);
  };
  let resultingCommitSha = target.resulting.commit_sha;
  // Every intent/ACK_UNKNOWN restart begins with a fresh, readback-only ref
  // observation. The base SHA is an unresolved outcome, never permission to
  // replay the consumed PATCH/PUT. A fast-forward that landed on any other
  // commit is drift; a protected merge binds its dynamic result to this ref.
  const repository = await runJson(
    countedRunCommand,
    [apiPath(target.repository, "")],
    "RECONCILIATION_REPOSITORY",
  );
  assertRepositoryReadback(repository, target);
  const ref = await runJson(
    countedRunCommand,
    [apiPath(target.repository, `git/ref/heads/${target.default_branch_name}`)],
    "RECONCILIATION_DEFAULT_BRANCH",
  );
  if (
    !isObject(ref) ||
    ref.ref !== `refs/heads/${target.default_branch_name}` ||
    ref.object?.type !== "commit" ||
    !SHA1.test(ref.object?.sha ?? "")
  )
    fail("RECONCILIATION_RESULT_UNRESOLVED");
  if (ref.object.sha === target.default_branch_sha) fail("RECONCILIATION_RESULT_UNRESOLVED");
  if (mechanism.type === "FAST_FORWARD" && ref.object.sha !== resultingCommitSha)
    fail("RECONCILIATION_RESULT_DRIFT");
  if (!SHA1.test(resultingCommitSha ?? "")) {
    if (!["PROTECTED_BRANCH", "GRAPHQL_CREATE_COMMIT"].includes(mechanism.type))
      fail("TERMINAL_RECORD_COMMIT_UNBOUND");
    // If the merge response itself was lost, bind the unknown result to the
    // observed default-branch ref. This is readback only; the base SHA is an
    // unresolved outcome, never a reason to retry the merge.
    resultingCommitSha = ref.object.sha;
  }
  const final = await readFinalRemoteState({
    target,
    runCommand: countedRunCommand,
    resultingCommitSha,
    expectedParents,
    expectedMessageHeadline:
      mechanism.type === "GRAPHQL_CREATE_COMMIT" ? mechanism.commit_message.headline : undefined,
  });
  const registrationEvidence = createWorkflowRegistrationEvidence({
    target,
    registration: final.registration,
    resultingCommitSha,
  });
  durableJsonWrite(evidencePath, registrationEvidence, "REGISTRATION_EVIDENCE");
  const reconciliationBase = {
    schema_version: RESULT_SCHEMA,
    state: "RECONCILIATION_CONFIRMED",
    mode: READBACK_ONLY_MODE,
    operation: REPAIR_OPERATION_ID,
    authority_id: record.authority_id,
    authority_record_commit: record.authority_record_commit,
    resulting_commit_sha: resultingCommitSha,
    resulting_tree_sha: target.resulting.tree_sha,
    workflow_registration_id: final.registration.id,
    external_calls: externalCalls,
    mutations: 0,
    authenticated_credential_use: true,
    credential_values_read: 0,
    credential_values_exposed: 0,
    workflow_dispatches: 0,
    spend_usd: 0,
    credential_use: {
      authenticated: true,
      provider: "github",
      source: "gh-cli-auth",
      values_read: false,
      values_exposed: false,
      truncated: false,
    },
    source_terminal_record_sha256: record.terminal_record_sha256,
    registration_evidence_file: evidencePath,
    registration_evidence_sha256: registrationEvidence.evidence_sha256,
    reconciliation_record_file: reconciliationPath,
  };
  const reconciliationRecord = {
    ...reconciliationBase,
    reconciliation_record_sha256: sha256(Buffer.from(`${canonicalJson(reconciliationBase)}\n`)),
  };
  durableJsonWrite(reconciliationPath, reconciliationRecord, "RECONCILIATION_RECORD");
  return reconciliationRecord;
}

export function planDefaultBranchWorkflowRepair(authority, { now = new Date() } = {}) {
  validateRepairAuthority(authority, { now });
  return {
    schema_version: RESULT_SCHEMA,
    state: "PLAN_ONLY",
    operation: REPAIR_OPERATION_ID,
    authority_id: authority.authority_id,
    repository: authority.target.repository,
    default_branch: authority.target.default_branch_name,
    expected_default_branch_sha: authority.target.default_branch_sha,
    workflow_path: authority.target.workflow.path,
    expected_workflow_blob_sha256: authority.target.workflow.blob_sha256,
    resulting_commit_sha: authority.target.resulting.commit_sha,
    resulting_tree_sha: authority.target.resulting.tree_sha,
    mechanism: authority.mechanism.type,
    external_calls: 0,
    mutations: 0,
    authenticated_credential_use: false,
    credential_values_read: 0,
    credential_values_exposed: 0,
    spend_usd: 0,
    authority_consumed: false,
  };
}

function parseArgs(tokens) {
  let mode = null;
  let authorityFile;
  let authorityRecordCommit;
  let terminalRecordFile;
  let confirm = false;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--plan" || token === "--execute" || token === "--reconcile") {
      if (mode !== null) fail("ARGUMENTS_AMBIGUOUS");
      mode = token.slice(2);
      continue;
    }
    if (token === "--confirm") {
      confirm = true;
      continue;
    }
    if (token === "--authority-file") {
      authorityFile = tokens[++index];
      if (!authorityFile || authorityFile.startsWith("--")) fail("ARGUMENTS_INVALID");
      continue;
    }
    if (token === "--authority-record-commit") {
      authorityRecordCommit = tokens[++index];
      if (!SHA1.test(authorityRecordCommit ?? "")) fail("ARGUMENTS_INVALID");
      continue;
    }
    if (token === "--terminal-record-file") {
      terminalRecordFile = tokens[++index];
      if (!terminalRecordFile || terminalRecordFile.startsWith("--")) fail("ARGUMENTS_INVALID");
      continue;
    }
    fail("ARGUMENTS_INVALID");
  }
  if (mode === null) fail("ARGUMENTS_REQUIRE_PLAN_EXECUTE_OR_RECONCILE");
  if (mode !== "reconcile" && !authorityFile) fail("AUTHORITY_FILE_REQUIRED");
  if (mode === "execute" && !authorityRecordCommit) fail("TRUST_ROOT_AUTHORITY_COMMIT_INVALID");
  if (mode !== "execute" && authorityRecordCommit) fail("AUTHORITY_RECORD_COMMIT_ONLY_FOR_EXECUTE");
  if (mode === "reconcile" && authorityFile) fail("RECONCILE_AUTHORITY_FORBIDDEN");
  if (mode === "plan" && confirm) fail("PLAN_CONFIRMATION_FORBIDDEN");
  if (mode === "reconcile" && confirm) fail("RECONCILE_CONFIRMATION_FORBIDDEN");
  if (mode === "plan" && terminalRecordFile) fail("TERMINAL_RECORD_NOT_FOR_PLAN");
  if (mode === "execute" && !confirm) fail("CONFIRMATION_REQUIRED");
  if (mode === "reconcile" && !terminalRecordFile) fail("TERMINAL_RECORD_PATH_REQUIRED");
  return { mode, authorityFile, authorityRecordCommit, terminalRecordFile, confirm };
}

async function main() {
  const tokens = process.argv.slice(2);
  if (tokens.length === 0) {
    process.stdout.write(`${JSON.stringify(noActionResult())}\n`);
    return;
  }
  try {
    const { mode, authorityFile, authorityRecordCommit, terminalRecordFile, confirm } =
      parseArgs(tokens);
    const result =
      mode === "reconcile"
        ? await reconcileDefaultBranchWorkflowRepair({
            terminalRecordFile: resolve(terminalRecordFile),
          })
        : mode === "plan"
          ? planDefaultBranchWorkflowRepair(readAuthorityFile(resolve(authorityFile)))
          : await executeDefaultBranchWorkflowRepair({
              authorityFile: resolve(authorityFile),
              authorityRecordCommit,
              confirm,
            });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "V2_13_DEFAULT_BRANCH_WORKFLOW_REPAIR_FAILED"}\n`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

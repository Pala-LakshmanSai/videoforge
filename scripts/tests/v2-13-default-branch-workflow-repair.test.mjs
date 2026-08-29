import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";

import {
  AUTHORITY_SCHEMA,
  GRAPHQL_CREATE_COMMIT_QUERY,
  MUTATION_INTENT_STATE,
  REGISTRATION_EVIDENCE_SCHEMA,
  RESULT_SCHEMA,
  VALIDATION_SCHEMA,
  canonicalTreeEntriesSha256,
  consumeRepairAuthorityFile,
  createGraphqlCommitRequest,
  executeDefaultBranchWorkflowRepair,
  planDefaultBranchWorkflowRepair,
  readAuthenticatedTrustedTime,
  readCredentialFreeTrustedTime,
  reconcileDefaultBranchWorkflowRepair,
  validateRepairAuthority,
  verifyRepairAuthorityTrustRoot,
} from "../../deploy/v2-13/default-branch-workflow-repair.mjs";

const root = join(fileURLToPath(new URL("../..", import.meta.url)));
const script = join(root, "deploy/v2-13/default-branch-workflow-repair.mjs");
const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const sha = (letter) => letter.repeat(40);
const hash = (letter) => `sha256:${letter.repeat(64)}`;
const fixedNow = new Date("2026-08-29T06:00:00.000Z");
const canonicalJson = (value) =>
  Array.isArray(value)
    ? `[${value.map((item) => canonicalJson(item)).join(",")}]`
    : value !== null && typeof value === "object"
      ? `{${Object.keys(value)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
          .join(",")}}`
      : JSON.stringify(value);
const authenticatedTime = {
  authenticated: true,
  credential_bearing: true,
  iso: fixedNow.toISOString(),
  source: "GITHUB_AUTHENTICATED_DATE",
  evidence_sha256: sha256(
    Buffer.from(
      `${canonicalJson({
        authenticated: true,
        credential_bearing: true,
        iso: fixedNow.toISOString(),
        source: "GITHUB_AUTHENTICATED_DATE",
      })}\n`,
    ),
  ),
};
const credentialFreeTime = {
  authenticated: true,
  credential_bearing: false,
  iso: fixedNow.toISOString(),
  source: "GITHUB_CA_VERIFIED_DATE",
  evidence_sha256: sha256(
    Buffer.from(
      `${canonicalJson({
        authenticated: true,
        credential_bearing: false,
        iso: fixedNow.toISOString(),
        source: "GITHUB_CA_VERIFIED_DATE",
      })}\n`,
    ),
  ),
};

function makeFixture({ id = "test0001", mechanism = "FAST_FORWARD" } = {}) {
  const workflowPath = ".github/workflows/avatar-primary-serverless-image.yml";
  const workflowBytes = Buffer.from("name: avatar-primary-serverless-image\n", "utf8");
  const baseSha = sha("a");
  const resultSha = sha("b");
  const treeSha = sha("e");
  const baseTreeSha = sha("2");
  const blobSha = sha("c");
  const releaseSha = sha("f");
  const headSha = sha("d");
  const sidecarDir = mkdtempSync(join(tmpdir(), "videoforge-default-branch-sidecars-"));
  const treeEntries = [
    { mode: "100644", path: workflowPath, sha: blobSha, type: "blob" },
    { mode: "100644", path: "README.md", sha: sha("1"), type: "blob" },
  ];
  const authority = {
    schema_version: AUTHORITY_SCHEMA,
    authority_id: `v2-13-default-branch-repair-${id}`,
    state: "APPROVED_UNCONSUMED",
    use_count: 0,
    validation: {
      schema_version: VALIDATION_SCHEMA,
      status: "PASS",
      validator_commit: sha("1"),
      validator_sha256: hash("a"),
      authority_binding_sha256: hash("4"),
    },
    operation: {
      id: "repair-default-branch-workflow-once",
      action:
        mechanism === "GRAPHQL_CREATE_COMMIT"
          ? "GRAPHQL_CREATE_EXACT_DEFAULT_BRANCH_WORKFLOW"
          : "FAST_FORWARD_OR_PROTECTED_BRANCH_WORKFLOW_REPAIR",
      single_use: true,
    },
    target: {
      repository: "acme/videoforge",
      default_branch_name: "main",
      default_branch_sha: baseSha,
      release_source_commit: releaseSha,
      workflow: {
        path: workflowPath,
        blob_sha1: blobSha,
        blob_sha256: sha256(workflowBytes),
      },
      resulting: {
        commit_sha: ["PROTECTED_BRANCH", "GRAPHQL_CREATE_COMMIT"].includes(mechanism)
          ? null
          : resultSha,
        tree_sha: treeSha,
        tree_entries_sha256: canonicalTreeEntriesSha256(treeEntries),
        parent_commit_shas: mechanism === "PROTECTED_BRANCH" ? null : [baseSha],
      },
      workflow_registration: {
        name: "avatar-primary-serverless-image",
        path: workflowPath,
        state: "active",
      },
    },
    mechanism:
      mechanism === "PROTECTED_BRANCH"
        ? {
            type: "PROTECTED_BRANCH",
            force: false,
            delete: false,
            tags: false,
            secrets: false,
            dispatch: false,
            fallback: false,
            replay: false,
            pull_request_number: 17,
            pull_request_head_ref: "repair/soulx-workflow",
            pull_request_head_sha: headSha,
            pull_request_base_ref: "main",
            pull_request_base_sha: baseSha,
            merge_method: "merge",
          }
        : mechanism === "GRAPHQL_CREATE_COMMIT"
          ? {
              type: "GRAPHQL_CREATE_COMMIT",
              graphql_mutation: "createCommitOnBranch",
              expected_head_oid: baseSha,
              additions_count: 1,
              deletions_count: 0,
              create_only: true,
              commit_message: { headline: "Publish exact SoulX workflow on default branch" },
              request_sha256: hash("0"),
              force: false,
              delete: false,
              tags: false,
              secrets: false,
              dispatch: false,
              fallback: false,
              replay: false,
            }
          : {
              type: "FAST_FORWARD",
              force: false,
              delete: false,
              tags: false,
              secrets: false,
              dispatch: false,
              fallback: false,
              replay: false,
            },
    issued_at: "2026-08-29T04:00:00.000Z",
    expires_at: "2026-08-30T04:00:00.000Z",
    consumed_at: null,
    execution_id: null,
  };
  if (mechanism === "GRAPHQL_CREATE_COMMIT")
    authority.mechanism.request_sha256 = createGraphqlCommitRequest(
      authority.target,
      authority.mechanism,
      workflowBytes,
    ).request_sha256;
  const lineageBase = {
    proposal_path: "project-context/evidence/repair/proposal.json",
    proposal_sha256: hash("5"),
    proposal_record_commit: sha("6"),
    approval_path: "project-context/evidence/repair/approval.json",
    approval_sha256: hash("7"),
    approval_record_commit: sha("8"),
    authority_record_path: "project-context/evidence/repair/authority.json",
    authority_record_commit: null,
    validator_path: "deploy/v2-13/default-branch-workflow-repair.mjs",
    validator_commit: sha("1"),
    validator_sha256: hash("a"),
    execution_control_commit: sha("b"),
    release_source_commit: releaseSha,
  };
  authority.lineage = {
    ...lineageBase,
    lineage_sha256: sha256(Buffer.from(`${canonicalJson(lineageBase)}\n`)),
  };
  authority.validation.authority_binding_sha256 = sha256(
    Buffer.from(
      `${canonicalJson({
        schema_version: authority.schema_version,
        authority_id: authority.authority_id,
        operation: authority.operation,
        lineage: lineageBase,
        target: authority.target,
        mechanism: authority.mechanism,
        issued_at: authority.issued_at,
        expires_at: authority.expires_at,
      })}\n`,
    ),
  );
  const state = { mutated: false, calls: [] };
  const sourceContent = {
    type: "file",
    path: workflowPath,
    sha: blobSha,
    encoding: "base64",
    content: workflowBytes.toString("base64"),
  };
  const runner = async (command, args, options = {}) => {
    state.calls.push({ command, args: [...args], options });
    assert.equal(command, "gh");
    assert.equal(args[0], "api");
    const endpoint = args.find((arg) => arg.startsWith("repos/"));
    if (args[1] === "graphql") {
      state.mutated = true;
      return {
        status: 0,
        stdout: JSON.stringify({
          data: {
            createCommitOnBranch: {
              commit: {
                oid: resultSha,
                messageHeadline: authority.mechanism.commit_message?.headline,
                tree: { oid: treeSha },
                parents: {
                  totalCount: 1,
                  pageInfo: { hasNextPage: false },
                  nodes: [{ oid: baseSha }],
                },
              },
              ref: {
                prefix: "refs/heads/",
                name: "main",
                target: { oid: resultSha },
              },
            },
          },
        }),
      };
    }
    if (args.includes("--method") && args.includes("PATCH")) {
      state.mutated = true;
      return {
        status: 0,
        stdout: JSON.stringify({ ref: "refs/heads/main", object: { sha: resultSha } }),
      };
    }
    if (args.includes("--method") && args.includes("PUT")) {
      state.mutated = true;
      return { status: 0, stdout: JSON.stringify({ merged: true, sha: resultSha }) };
    }
    if (endpoint === "repos/acme/videoforge")
      return {
        status: 0,
        stdout: JSON.stringify({ full_name: "acme/videoforge", default_branch: "main" }),
      };
    if (endpoint === "repos/acme/videoforge/git/ref/heads/main")
      return {
        status: 0,
        stdout: JSON.stringify({
          ref: "refs/heads/main",
          object: { type: "commit", sha: state.mutated ? resultSha : baseSha },
        }),
      };
    if (endpoint?.startsWith("repos/acme/videoforge/contents/"))
      return { status: 0, stdout: JSON.stringify(sourceContent) };
    if (endpoint === `repos/acme/videoforge/git/commits/${resultSha}`)
      return {
        status: 0,
        stdout: JSON.stringify({
          sha: resultSha,
          message: authority.mechanism.commit_message?.headline,
          tree: { sha: treeSha },
          parents: (authority.target.resulting.parent_commit_shas ?? [baseSha, headSha]).map(
            (shaValue) => ({ sha: shaValue }),
          ),
        }),
      };
    if (endpoint === `repos/acme/videoforge/git/commits/${baseSha}`)
      return {
        status: 0,
        stdout: JSON.stringify({ sha: baseSha, tree: { sha: baseTreeSha }, parents: [] }),
      };
    if (endpoint === `repos/acme/videoforge/git/trees/${baseTreeSha}?recursive=1`)
      return {
        status: 0,
        stdout: JSON.stringify({
          sha: baseTreeSha,
          truncated: false,
          tree: [{ mode: "100644", path: "README.md", sha: sha("1"), type: "blob" }],
        }),
      };
    if (endpoint === `repos/acme/videoforge/git/trees/${treeSha}?recursive=1`)
      return {
        status: 0,
        stdout: JSON.stringify({ sha: treeSha, truncated: false, tree: treeEntries }),
      };
    if (endpoint === "repos/acme/videoforge/pulls/17")
      return {
        status: 0,
        stdout: JSON.stringify({
          number: 17,
          state: "open",
          base: { ref: "main", sha: baseSha },
          head: { ref: "repair/soulx-workflow", sha: headSha },
        }),
      };
    if (endpoint === "repos/acme/videoforge/actions/workflows/avatar-primary-serverless-image.yml")
      return {
        status: 0,
        stdout: JSON.stringify({
          ...authority.target.workflow_registration,
          id: 4321,
        }),
      };
    throw new Error(`unexpected fixture endpoint ${endpoint}`);
  };
  return {
    authority,
    runner,
    state,
    baseSha,
    resultSha,
    treeSha,
    workflowPath,
    preConsumptionTrustedTime: () => credentialFreeTime,
    preMutationTrustedTime: () => authenticatedTime,
    terminalRecordFile: join(sidecarDir, "terminal-record.json"),
    registrationEvidenceFile: join(sidecarDir, "registration-evidence.json"),
  };
}

function rebindAuthority(authority) {
  const lineage = { ...authority.lineage };
  delete lineage.lineage_sha256;
  authority.validation.authority_binding_sha256 = sha256(
    Buffer.from(
      `${canonicalJson({
        schema_version: authority.schema_version,
        authority_id: authority.authority_id,
        operation: authority.operation,
        lineage,
        target: authority.target,
        mechanism: authority.mechanism,
        issued_at: authority.issued_at,
        expires_at: authority.expires_at,
      })}\n`,
    ),
  );
  return authority;
}

function executeFixture(fixture, options = {}) {
  return executeDefaultBranchWorkflowRepair({
    authority: fixture.authority,
    runCommand: fixture.runner,
    confirm: true,
    preConsumptionTrustedTime: fixture.preConsumptionTrustedTime,
    preMutationTrustedTime: fixture.preMutationTrustedTime,
    verifyTrustRoot: () => true,
    testOnlyAllowInMemoryAuthority: true,
    terminalRecordFile: fixture.terminalRecordFile,
    registrationEvidenceFile: fixture.registrationEvidenceFile,
    ...options,
  });
}

test("default invocation is explicit NO_ACTION and performs no command", () => {
  const result = spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    schema_version: RESULT_SCHEMA,
    state: "NO_ACTION",
    operation: "repair-default-branch-workflow-once",
    external_calls: 0,
    mutations: 0,
    authenticated_credential_use: false,
    credential_values_read: 0,
    credential_values_exposed: 0,
    workflow_dispatches: 0,
    spend_usd: 0,
    authority_consumed: false,
  });
});

test("plan validates the separately approved authority without consuming or calling a runner", () => {
  const { authority } = makeFixture({ id: "plan0001" });
  const planned = planDefaultBranchWorkflowRepair(authority, { now: fixedNow });
  assert.equal(planned.state, "PLAN_ONLY");
  assert.equal(planned.external_calls, 0);
  assert.equal(planned.mutations, 0);
  assert.equal(authority.state, "APPROVED_UNCONSUMED");
});

test("external Git trust root binds exact proposal approval validator bytes and rejects a fully recomputed forgery", () => {
  const repository = mkdtempSync(join(tmpdir(), "videoforge-repair-trust-root-"));
  const protectedDirectory = join(repository, ".protected");
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: repository, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const commit = (message) => {
    git("add", ".");
    git("commit", "-q", "-m", message);
    return git("rev-parse", "HEAD");
  };
  try {
    mkdirSync(protectedDirectory, { mode: 0o700 });
    mkdirSync(join(repository, "deploy/v2-13"), { recursive: true });
    mkdirSync(join(repository, "project-context/evidence/repair"), { recursive: true });
    git("init", "-q");
    git("config", "user.email", "repair-test@example.invalid");
    git("config", "user.name", "Repair Test");
    writeFileSync(join(repository, "release.txt"), "release\n");
    const releaseCommit = commit("release");

    // The trust-root verifier must execute the exact validator bytes it
    // authenticated from the immutable commit, not merely a same-shaped API.
    const validatorBytes = readFileSync(script);
    writeFileSync(
      join(repository, "deploy/v2-13/default-branch-workflow-repair.mjs"),
      validatorBytes,
    );
    const executionCommit = commit("execution control");

    const fixture = makeFixture({ id: "trustroot0001" });
    fixture.authority.target.release_source_commit = releaseCommit;
    const proposal = {
      schema_version: "videoforge.v2-13-default-branch-workflow-repair-proposal/v2",
      authority_schema: fixture.authority.schema_version,
      authority_id: fixture.authority.authority_id,
      operation: "repair-default-branch-workflow-once",
      target: fixture.authority.target,
      mechanism: fixture.authority.mechanism,
      issued_at: fixture.authority.issued_at,
      expires_at: fixture.authority.expires_at,
    };
    const proposalPath = "project-context/evidence/repair/proposal.json";
    const proposalBytes = Buffer.from(`${JSON.stringify(proposal, null, 2)}\n`);
    writeFileSync(join(repository, proposalPath), proposalBytes);
    const proposalCommit = commit("proposal");
    const approval = {
      schema_version: "videoforge.v2-13-default-branch-workflow-repair-approval/v2",
      approved: true,
      authority_schema: fixture.authority.schema_version,
      authority_id: fixture.authority.authority_id,
      proposal_sha256: sha256(proposalBytes),
    };
    const approvalPath = "project-context/evidence/repair/approval.json";
    const approvalBytes = Buffer.from(`${JSON.stringify(approval, null, 2)}\n`);
    writeFileSync(join(repository, approvalPath), approvalBytes);
    const approvalCommit = commit("approval");

    const lineageBase = {
      proposal_path: proposalPath,
      proposal_sha256: sha256(proposalBytes),
      proposal_record_commit: proposalCommit,
      approval_path: approvalPath,
      approval_sha256: sha256(approvalBytes),
      approval_record_commit: approvalCommit,
      authority_record_path: "authority-record.json",
      authority_record_commit: null,
      validator_path: "deploy/v2-13/default-branch-workflow-repair.mjs",
      validator_commit: executionCommit,
      validator_sha256: sha256(validatorBytes),
      execution_control_commit: executionCommit,
      release_source_commit: releaseCommit,
    };
    fixture.authority.lineage = {
      ...lineageBase,
      lineage_sha256: sha256(Buffer.from(`${canonicalJson(lineageBase)}\n`)),
    };
    const binding = {
      schema_version: fixture.authority.schema_version,
      authority_id: fixture.authority.authority_id,
      operation: fixture.authority.operation,
      lineage: lineageBase,
      target: fixture.authority.target,
      mechanism: fixture.authority.mechanism,
      issued_at: fixture.authority.issued_at,
      expires_at: fixture.authority.expires_at,
    };
    fixture.authority.validation.validator_commit = executionCommit;
    fixture.authority.validation.validator_sha256 = sha256(validatorBytes);
    fixture.authority.validation.authority_binding_sha256 = sha256(
      Buffer.from(`${canonicalJson(binding)}\n`),
    );
    const authorityBytes = Buffer.from(`${JSON.stringify(fixture.authority, null, 2)}\n`);
    writeFileSync(join(repository, "authority-record.json"), authorityBytes);
    const authorityRecordCommit = commit("authority record");
    const authorityFile = join(protectedDirectory, "authority.json");
    writeFileSync(authorityFile, authorityBytes, { mode: 0o600 });
    const runGit = (args) => {
      const result = spawnSync("git", args, { cwd: repository, encoding: null });
      return { status: result.status ?? 1, stdout: result.stdout ?? Buffer.alloc(0) };
    };
    assert.deepEqual(
      verifyRepairAuthorityTrustRoot(fixture.authority, {
        authorityFile,
        authorityRecordCommit,
        root: repository,
        runGit,
      }),
      { authorityRecordCommit },
    );

    // The proposal, approval, and authority records are each an exact
    // one-parent/one-path commit. A direct child of the approval commit that
    // adds an unrelated path must not be accepted as an authority record.
    git("checkout", "-q", approvalCommit);
    writeFileSync(join(repository, "authority-record.json"), authorityBytes);
    writeFileSync(join(repository, "unrelated.txt"), "unrelated\n");
    git("add", "authority-record.json", "unrelated.txt");
    git("commit", "-q", "-m", "authority record with unrelated path");
    const extraPathAuthorityCommit = git("rev-parse", "HEAD");
    writeFileSync(authorityFile, authorityBytes, { mode: 0o600 });
    assert.throws(
      () =>
        verifyRepairAuthorityTrustRoot(fixture.authority, {
          authorityFile,
          authorityRecordCommit: extraPathAuthorityCommit,
          root: repository,
          runGit,
        }),
      /TRUST_ROOT_RECORD_COMMIT_NOT_EXCLUSIVE/u,
    );

    // A merge commit can expose the expected bytes while hiding an unrelated
    // parent. Its first-parent-looking ancestry is not sufficient authority.
    git("checkout", "-q", approvalCommit);
    git("checkout", "-q", "-b", "repair-merge-side");
    writeFileSync(join(repository, "authority-record.json"), authorityBytes);
    git("add", "authority-record.json");
    git("commit", "-q", "-m", "authority record side");
    const mergeSideCommit = git("rev-parse", "HEAD");
    git("checkout", "-q", approvalCommit);
    git("merge", "--no-ff", "-q", mergeSideCommit, "-m", "authority record merge");
    const mergeAuthorityCommit = git("rev-parse", "HEAD");
    writeFileSync(authorityFile, authorityBytes, { mode: 0o600 });
    assert.throws(
      () =>
        verifyRepairAuthorityTrustRoot(fixture.authority, {
          authorityFile,
          authorityRecordCommit: mergeAuthorityCommit,
          root: repository,
          runGit,
        }),
      /TRUST_ROOT_LINEAGE_INVALID/u,
    );

    const forged = structuredClone(fixture.authority);
    forged.authority_id = "v2-13-default-branch-repair-fully-recomputed-forgery";
    forged.validation.authority_binding_sha256 = sha256(
      Buffer.from(
        `${canonicalJson({
          ...binding,
          authority_id: forged.authority_id,
        })}\n`,
      ),
    );
    assert.doesNotThrow(() => validateRepairAuthority(forged, { now: fixedNow }));
    writeFileSync(authorityFile, `${JSON.stringify(forged, null, 2)}\n`, { mode: 0o600 });
    assert.throws(
      () =>
        verifyRepairAuthorityTrustRoot(forged, {
          authorityFile,
          authorityRecordCommit,
          root: repository,
          runGit,
        }),
      /TRUST_ROOT_BYTES_DRIFT/u,
    );
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("authority lineage and validation binding are cryptographic and reject self-attestation", () => {
  const lineageDrift = makeFixture({ id: "lineagedrift0001" }).authority;
  lineageDrift.lineage.proposal_sha256 = hash("9");
  assert.throws(
    () => validateRepairAuthority(lineageDrift, { now: fixedNow }),
    /AUTHORITY_LINEAGE_INVALID/u,
  );

  const bindingDrift = makeFixture({ id: "bindingdrift0001" }).authority;
  bindingDrift.target.default_branch_sha = sha("9");
  assert.throws(
    () => validateRepairAuthority(bindingDrift, { now: fixedNow }),
    /AUTHORITY_NOT_SEPARATELY_VALIDATED/u,
  );

  const selfAttested = makeFixture({ id: "selfattested0001" }).authority;
  selfAttested.validation.validated = true;
  assert.throws(
    () => validateRepairAuthority(selfAttested, { now: fixedNow }),
    /AUTHORITY_NOT_SEPARATELY_VALIDATED/u,
  );
});

test("trusted time must be authenticated and is rechecked before mutation", async () => {
  const unauthenticated = makeFixture({ id: "timeunauth0001" });
  await assert.rejects(
    executeFixture(unauthenticated, {
      preConsumptionTrustedTime: () => ({
        authenticated: false,
        credential_bearing: false,
        iso: fixedNow.toISOString(),
        source: "GITHUB_CA_VERIFIED_DATE",
        evidence_sha256: hash("0"),
      }),
    }),
    /TRUSTED_TIME_INVALID/u,
  );
  assert.equal(unauthenticated.state.calls.length, 0);

  const staleAtMutation = makeFixture({ id: "timestale0001" });
  await assert.rejects(
    executeFixture(staleAtMutation, {
      preMutationTrustedTime: () => {
        const iso = "2026-08-30T05:00:00.000Z";
        return {
          ...authenticatedTime,
          iso,
          evidence_sha256: sha256(
            Buffer.from(
              `${canonicalJson({
                authenticated: true,
                credential_bearing: true,
                iso,
                source: "GITHUB_AUTHENTICATED_DATE",
              })}\n`,
            ),
          ),
        };
      },
    }),
    /AUTHORITY_EXPIRED/u,
  );
  assert.equal(
    staleAtMutation.state.calls.some((call) => call.args.includes("PATCH")),
    false,
  );
});

test("authenticated trusted-time readback rejects exposed credentials and ambiguous dates", async () => {
  const safe = await readAuthenticatedTrustedTime(async (command, args) => {
    assert.equal(command, "gh");
    assert.deepEqual(args, ["api", "--include", "rate_limit"]);
    return { status: 0, stdout: "HTTP/2 200\ndate: Sat, 29 Aug 2026 06:00:00 GMT\n" };
  });
  assert.equal(safe.authenticated, true);
  assert.equal(safe.credential_bearing, true);
  assert.equal(safe.source, "GITHUB_AUTHENTICATED_DATE");
  assert.equal(typeof safe.evidence_sha256, "string");

  await assert.rejects(
    readAuthenticatedTrustedTime(async () => ({
      status: 0,
      stdout: "HTTP/2 200\ndate: Sat, 29 Aug 2026 06:00:00 GMT\nauthorization: Bearer hidden\n",
    })),
    /TRUSTED_TIME_COMMAND_FAILED/u,
  );
  await assert.rejects(
    readAuthenticatedTrustedTime(async () => ({
      status: 0,
      stdout:
        "HTTP/2 200\ndate: Sat, 29 Aug 2026 06:00:00 GMT\ndate: Sat, 29 Aug 2026 06:00:01 GMT\n",
    })),
    /TRUSTED_TIME_READBACK/u,
  );
});

test("pre-consumption trusted time is CA verified and credential free", async () => {
  const safe = await readCredentialFreeTrustedTime(async (command, args, options) => {
    assert.equal(command, "curl");
    assert.equal(args[0], "--disable");
    assert.equal(args.includes("--proto"), true);
    assert.equal(args.includes("=https"), true);
    assert.equal(args.at(-1), "https://api.github.com/");
    assert.deepEqual(Object.keys(options.env).sort(), ["NO_PROXY", "PATH", "no_proxy"]);
    return { status: 0, stdout: "HTTP/2 200\ndate: Sat, 29 Aug 2026 06:00:00 GMT\n" };
  });
  assert.equal(safe.authenticated, true);
  assert.equal(safe.credential_bearing, false);
  assert.equal(safe.source, "GITHUB_CA_VERIFIED_DATE");
});

test("successful fast-forward binds branch, workflow blob, exact commit/tree, and registration", async () => {
  const fixture = makeFixture({ id: "success0001" });
  const { state, resultSha, treeSha } = fixture;
  const result = await executeFixture(fixture);
  assert.equal(result.state, "REPAIR_COMPLETE");
  assert.equal(result.default_branch_sha, resultSha);
  assert.equal(result.resulting_tree_sha, treeSha);
  assert.equal(result.workflow_registration_id, 4321);
  assert.equal(result.external_calls, 12);
  assert.equal(result.mutations, 1);
  assert.equal(result.authenticated_credential_use, true);
  assert.equal(result.credential_values_read, 0);
  assert.equal(result.credential_values_exposed, 0);
  assert.equal(result.workflow_dispatches, 0);
  assert.equal(result.spend_usd, 0);
  assert.deepEqual(result.credential_use, {
    authenticated: true,
    provider: "github",
    source: "gh-cli-auth",
    values_read: false,
    values_exposed: false,
    truncated: false,
  });
  assert.equal(state.mutated, true);
  const mutation = state.calls.find((call) => call.args.includes("PATCH"));
  assert.ok(mutation);
  assert.equal(
    mutation.args.some((arg) => /force|delete|tag|secret|dispatch|retry|fallback/iu.test(arg)),
    false,
  );
});

test("protected-branch execution uses only an exact open PR merge and no direct force update", async () => {
  const fixture = makeFixture({
    id: "protected0001",
    mechanism: "PROTECTED_BRANCH",
  });
  const { state } = fixture;
  const result = await executeFixture(fixture);
  assert.equal(result.state, "REPAIR_COMPLETE");
  assert.equal(result.resulting_commit_sha, fixture.resultSha);
  assert.equal(result.workflow_registration_id, 4321);
  assert.equal(fixture.authority.target.resulting.commit_sha, null);
  const mutation = state.calls.find((call) => call.args.includes("PUT"));
  assert.ok(mutation);
  assert.equal(mutation.args.includes("-f merge_method=merge"), true);
  assert.equal(
    mutation.args.some((arg) => /force|delete|tag|secret|dispatch|retry|fallback/iu.test(arg)),
    false,
  );
  assert.equal(
    state.calls.some((call) => call.args.includes("PATCH")),
    false,
  );
  const registrationCall = state.calls.find((call) =>
    call.args.some((arg) => arg.includes("actions/workflows/")),
  );
  assert.ok(registrationCall);
  assert.equal(
    registrationCall.args.some(
      (arg) =>
        arg === "repos/acme/videoforge/actions/workflows/avatar-primary-serverless-image.yml",
    ),
    true,
  );
});

test("GraphQL createCommitOnBranch uses exact CAS, one addition, and a dynamic commit", async () => {
  const fixture = makeFixture({ id: "graphqlsuccess0001", mechanism: "GRAPHQL_CREATE_COMMIT" });
  const result = await executeFixture(fixture);
  assert.equal(result.state, "REPAIR_COMPLETE");
  assert.equal(result.mechanism, "GRAPHQL_CREATE_COMMIT");
  assert.equal(result.resulting_commit_sha, fixture.resultSha);
  assert.equal(result.resulting_tree_sha, fixture.treeSha);
  assert.equal(result.mutations, 1);
  const mutations = fixture.state.calls.filter((call) => call.args[1] === "graphql");
  assert.equal(mutations.length, 1);
  assert.deepEqual(mutations[0].args, ["api", "graphql", "--input", "-"]);
  const request = JSON.parse(mutations[0].options.input);
  assert.equal(request.query, GRAPHQL_CREATE_COMMIT_QUERY);
  assert.deepEqual(Object.keys(request.variables.input).sort(), [
    "branch",
    "expectedHeadOid",
    "fileChanges",
    "message",
  ]);
  assert.deepEqual(request.variables.input.branch, {
    repositoryNameWithOwner: "acme/videoforge",
    branchName: "main",
  });
  assert.equal(request.variables.input.expectedHeadOid, fixture.baseSha);
  assert.equal(request.variables.input.fileChanges.additions.length, 1);
  assert.equal(
    request.variables.input.fileChanges.additions[0].path,
    ".github/workflows/avatar-primary-serverless-image.yml",
  );
  assert.equal("deletions" in request.variables.input.fileChanges, false);
  assert.equal("author" in request.variables.input, false);
  assert.equal("committer" in request.variables.input, false);
  assert.equal(
    sha256(Buffer.from(mutations[0].options.input)),
    fixture.authority.mechanism.request_sha256,
  );
  assert.equal(
    fixture.state.calls.some((call) => call.args.includes("PATCH") || call.args.includes("PUT")),
    false,
  );
});

test("GraphQL mechanism schema rejects extra additions, deletion capability, and head mismatch", () => {
  for (const mutate of [
    (authority) => {
      authority.mechanism.additions_count = 2;
    },
    (authority) => {
      authority.mechanism.deletions_count = 1;
    },
    (authority) => {
      authority.mechanism.expected_head_oid = sha("9");
    },
    (authority) => {
      authority.mechanism.commit_message.body = "not representable";
    },
  ]) {
    const { authority } = makeFixture({
      id: `graphqlunsafe${Math.random().toString(16).slice(2)}`,
      mechanism: "GRAPHQL_CREATE_COMMIT",
    });
    mutate(authority);
    rebindAuthority(authority);
    assert.throws(
      () => validateRepairAuthority(authority, { now: fixedNow }),
      /AUTHORITY_INVALID/u,
    );
  }
});

test("GraphQL create-only preflight rejects an existing workflow before mutation", async () => {
  const fixture = makeFixture({ id: "graphqlpresent0001", mechanism: "GRAPHQL_CREATE_COMMIT" });
  const runner = async (command, args, options) => {
    const response = await fixture.runner(command, args, options);
    if (args.some((arg) => arg.includes("git/trees/2222222222222222222222222222222222222222"))) {
      const tree = JSON.parse(response.stdout);
      tree.tree.push({
        mode: "100644",
        path: fixture.workflowPath,
        sha: fixture.authority.target.workflow.blob_sha1,
        type: "blob",
      });
      return { ...response, stdout: JSON.stringify(tree) };
    }
    return response;
  };
  await assert.rejects(
    executeFixture(fixture, { runCommand: runner }),
    /WORKFLOW_ALREADY_PRESENT_ON_DEFAULT_BRANCH/u,
  );
  assert.equal(
    fixture.state.calls.some((call) => call.args[1] === "graphql"),
    false,
  );
});

test("GraphQL source-byte drift and truncated base tree stop before mutation", async () => {
  for (const mode of ["source-drift", "truncated-tree"]) {
    const fixture = makeFixture({
      id: `graphqlpreflight${mode.replaceAll("-", "")}`,
      mechanism: "GRAPHQL_CREATE_COMMIT",
    });
    const runner = async (command, args, options) => {
      const response = await fixture.runner(command, args, options);
      if (mode === "source-drift" && args.some((arg) => arg.includes("contents/"))) {
        const content = JSON.parse(response.stdout);
        content.content = Buffer.from("name: drifted\n", "utf8").toString("base64");
        return { ...response, stdout: JSON.stringify(content) };
      }
      if (
        mode === "truncated-tree" &&
        args.some((arg) => arg.includes("git/trees/2222222222222222222222222222222222222222"))
      ) {
        const tree = JSON.parse(response.stdout);
        tree.truncated = true;
        return { ...response, stdout: JSON.stringify(tree) };
      }
      return response;
    };
    await assert.rejects(
      executeFixture(fixture, { runCommand: runner }),
      /WORKFLOW_BLOB_DRIFT|BASE_TREE_READBACK_AMBIGUOUS/u,
    );
    assert.equal(
      fixture.state.calls.some((call) => call.args[1] === "graphql"),
      false,
    );
  }
});

test("GraphQL request hash drift stops before mutation", async () => {
  const fixture = makeFixture({
    id: "graphqlrequestdrift0001",
    mechanism: "GRAPHQL_CREATE_COMMIT",
  });
  fixture.authority.mechanism.request_sha256 = hash("9");
  rebindAuthority(fixture.authority);
  await assert.rejects(executeFixture(fixture), /GRAPHQL_CREATE_COMMIT_REQUEST_DRIFT/u);
  assert.equal(
    fixture.state.calls.some((call) => call.args[1] === "graphql"),
    false,
  );
});

test("GraphQL CAS rejection is ACK_UNKNOWN and never retried", async () => {
  const fixture = makeFixture({ id: "graphqlcas0001", mechanism: "GRAPHQL_CREATE_COMMIT" });
  const runner = async (command, args, options) => {
    if (args[1] === "graphql") {
      fixture.state.calls.push({ command, args: [...args], options });
      return { status: 1, stdout: "", stderr: "expectedHeadOid mismatch" };
    }
    return fixture.runner(command, args, options);
  };
  await assert.rejects(
    executeFixture(fixture, { runCommand: runner }),
    /ACK_UNKNOWN_READBACK_ONLY_NO_REPLAY/u,
  );
  const terminal = JSON.parse(readFileSync(fixture.terminalRecordFile, "utf8"));
  assert.equal(terminal.state, "ACK_UNKNOWN");
  assert.equal(terminal.resulting_commit_sha, null);
  assert.equal(terminal.mutation_request_sha256, fixture.authority.mechanism.request_sha256);
  fixture.state.calls.length = 0;
  await assert.rejects(
    reconcileDefaultBranchWorkflowRepair({
      terminalRecordFile: fixture.terminalRecordFile,
      runCommand: fixture.runner,
    }),
    /RECONCILIATION_RESULT_UNRESOLVED/u,
  );
  assert.equal(
    fixture.state.calls.some((call) => call.args[1] === "graphql"),
    false,
  );
});

test("GraphQL durable INTENT reconciles an accepted mutation after response loss", async () => {
  const fixture = makeFixture({ id: "graphqllostack0001", mechanism: "GRAPHQL_CREATE_COMMIT" });
  const runner = async (command, args, options) => {
    if (args[1] === "graphql") {
      const intent = JSON.parse(readFileSync(fixture.terminalRecordFile, "utf8"));
      assert.equal(intent.state, MUTATION_INTENT_STATE);
      assert.equal(intent.mutation_request_sha256, fixture.authority.mechanism.request_sha256);
      fixture.state.calls.push({ command, args: [...args], options });
      fixture.state.mutated = true;
      throw new Error("simulated lost GraphQL response");
    }
    return fixture.runner(command, args, options);
  };
  await assert.rejects(
    executeFixture(fixture, { runCommand: runner }),
    /ACK_UNKNOWN_READBACK_ONLY_NO_REPLAY/u,
  );
  const terminal = JSON.parse(readFileSync(fixture.terminalRecordFile, "utf8"));
  assert.equal(terminal.resulting_commit_sha, null);
  assert.deepEqual(terminal.target.resulting.parent_commit_shas, [fixture.baseSha]);
  fixture.state.calls.length = 0;
  const reconciled = await reconcileDefaultBranchWorkflowRepair({
    terminalRecordFile: fixture.terminalRecordFile,
    runCommand: fixture.runner,
  });
  assert.equal(reconciled.state, "RECONCILIATION_CONFIRMED");
  assert.equal(reconciled.resulting_commit_sha, fixture.resultSha);
  assert.equal(
    fixture.state.calls.some((call) => call.args[1] === "graphql"),
    false,
  );
  assert.equal(
    fixture.state.calls.some((call) => call.args.includes("PATCH") || call.args.includes("PUT")),
    false,
  );
});

test("GraphQL wrong tree ACK fails closed into readback-only recovery", async () => {
  const fixture = makeFixture({ id: "graphqlwrongtree0001", mechanism: "GRAPHQL_CREATE_COMMIT" });
  const runner = async (command, args, options) => {
    const response = await fixture.runner(command, args, options);
    if (args[1] === "graphql") {
      const payload = JSON.parse(response.stdout);
      payload.data.createCommitOnBranch.commit.tree.oid = sha("9");
      return { ...response, stdout: JSON.stringify(payload) };
    }
    return response;
  };
  await assert.rejects(
    executeFixture(fixture, { runCommand: runner }),
    /ACK_UNKNOWN_READBACK_ONLY_NO_REPLAY/u,
  );
  const terminal = JSON.parse(readFileSync(fixture.terminalRecordFile, "utf8"));
  assert.equal(terminal.state, "ACK_UNKNOWN");
  assert.equal(terminal.resulting_commit_sha, null);
});

test("GraphQL commit-message drift fails closed in ACK and reconciliation readback", async () => {
  const ackFixture = makeFixture({
    id: "graphqlwrongmessageack0001",
    mechanism: "GRAPHQL_CREATE_COMMIT",
  });
  const ackRunner = async (command, args, options) => {
    const response = await ackFixture.runner(command, args, options);
    if (args[1] === "graphql") {
      const payload = JSON.parse(response.stdout);
      payload.data.createCommitOnBranch.commit.messageHeadline = "Different commit message";
      return { ...response, stdout: JSON.stringify(payload) };
    }
    return response;
  };
  await assert.rejects(
    executeFixture(ackFixture, { runCommand: ackRunner }),
    /ACK_UNKNOWN_READBACK_ONLY_NO_REPLAY/u,
  );

  const reconcileFixture = makeFixture({
    id: "graphqlwrongmessagereconcile0001",
    mechanism: "GRAPHQL_CREATE_COMMIT",
  });
  const lostAckRunner = async (command, args, options) => {
    if (args[1] === "graphql") {
      reconcileFixture.state.calls.push({ command, args: [...args], options });
      reconcileFixture.state.mutated = true;
      throw new Error("simulated lost GraphQL response");
    }
    return reconcileFixture.runner(command, args, options);
  };
  await assert.rejects(
    executeFixture(reconcileFixture, { runCommand: lostAckRunner }),
    /ACK_UNKNOWN_READBACK_ONLY_NO_REPLAY/u,
  );
  reconcileFixture.state.calls.length = 0;
  const driftRunner = async (command, args, options) => {
    const response = await reconcileFixture.runner(command, args, options);
    if (args.some((arg) => arg.includes(`git/commits/${reconcileFixture.resultSha}`))) {
      const commit = JSON.parse(response.stdout);
      commit.message = "Different commit message";
      return { ...response, stdout: JSON.stringify(commit) };
    }
    return response;
  };
  await assert.rejects(
    reconcileDefaultBranchWorkflowRepair({
      terminalRecordFile: reconcileFixture.terminalRecordFile,
      runCommand: driftRunner,
    }),
    /RESULT_COMMIT_MESSAGE_DRIFT/u,
  );
  assert.equal(
    reconcileFixture.state.calls.some((call) => call.args[1] === "graphql"),
    false,
  );
});

test("GraphQL error payload is ACK_UNKNOWN and cannot expose a second mutation path", async () => {
  const fixture = makeFixture({ id: "graphqlerrors0001", mechanism: "GRAPHQL_CREATE_COMMIT" });
  const runner = async (command, args, options) => {
    if (args[1] === "graphql") {
      fixture.state.calls.push({ command, args: [...args], options });
      return {
        status: 0,
        stdout: JSON.stringify({ errors: [{ message: "repository rule rejected commit" }] }),
      };
    }
    return fixture.runner(command, args, options);
  };
  await assert.rejects(
    executeFixture(fixture, { runCommand: runner }),
    /ACK_UNKNOWN_READBACK_ONLY_NO_REPLAY/u,
  );
  assert.equal(fixture.state.calls.filter((call) => call.args[1] === "graphql").length, 1);
  assert.equal(
    fixture.state.calls.some((call) => call.args.includes("PATCH") || call.args.includes("PUT")),
    false,
  );
});

test("registration evidence uses the adapter contract and binds the observed registration", async () => {
  const fixture = makeFixture({ id: "evidence0001" });
  const result = await executeFixture(fixture);
  const evidence = JSON.parse(readFileSync(fixture.registrationEvidenceFile, "utf8"));
  const unsigned = { ...evidence };
  delete unsigned.evidence_sha256;
  assert.equal(evidence.schema_version, REGISTRATION_EVIDENCE_SCHEMA);
  assert.deepEqual(Object.keys(evidence).sort(), [
    "bound_to_release_source",
    "default_branch",
    "default_branch_commit",
    "default_branch_workflow_sha256",
    "evidence_sha256",
    "materialized",
    "registration_state",
    "release_source_commit",
    "release_source_workflow_sha256",
    "repository",
    "schema_version",
    "workflow_file",
    "workflow_name",
    "workflow_path",
  ]);
  assert.equal(evidence.default_branch_commit, result.resulting_commit_sha);
  assert.equal(result.registration_evidence_sha256, evidence.evidence_sha256);
  assert.equal(evidence.workflow_file, "avatar-primary-serverless-image.yml");
  assert.equal(evidence.registration_state, "REGISTERED_EXACT_DEFAULT_BRANCH");
  assert.equal(evidence.materialized, true);
  assert.equal(evidence.bound_to_release_source, true);
  assert.equal(evidence.evidence_sha256, sha256(Buffer.from(canonicalJson(unsigned))));
  assert.equal("workflow_id" in evidence, false);
});

test("default-branch SHA drift stops before any mutation", async () => {
  const fixture = makeFixture({ id: "branchdrift0001" });
  const runner = async (command, args) => {
    const result = await fixture.runner(command, args);
    if (args.some((arg) => arg === "repos/acme/videoforge/git/ref/heads/main")) {
      return {
        status: 0,
        stdout: JSON.stringify({
          ref: "refs/heads/main",
          object: { type: "commit", sha: sha("9") },
        }),
      };
    }
    return result;
  };
  await assert.rejects(
    executeFixture(fixture, { runCommand: runner }),
    /PRE_DEFAULT_BRANCH_DRIFT|DEFAULT_BRANCH_DRIFT/u,
  );
  assert.equal(
    fixture.state.calls.some((call) => call.args.includes("PATCH")),
    false,
  );
});

test("truncated result tree is ambiguous and cannot reach mutation", async () => {
  const fixture = makeFixture({ id: "treedrift0001" });
  const runner = async (command, args) => {
    const result = await fixture.runner(command, args);
    if (args.some((arg) => arg.includes("git/trees/")))
      return {
        status: 0,
        stdout: JSON.stringify({ sha: fixture.treeSha, truncated: true, tree: [] }),
      };
    return result;
  };
  await assert.rejects(
    executeFixture(fixture, { runCommand: runner }),
    /RESULT_TREE_DRIFT|TREE_READBACK_AMBIGUOUS/u,
  );
  assert.equal(
    fixture.state.calls.some((call) => call.args.includes("PATCH")),
    false,
  );
});

test("missing tree truncation proof is also ambiguous", async () => {
  const fixture = makeFixture({ id: "treemissing0001" });
  const runner = async (command, args) => {
    const result = await fixture.runner(command, args);
    if (args.some((arg) => arg.includes("git/trees/")))
      return {
        status: 0,
        stdout: JSON.stringify({ sha: fixture.treeSha, tree: [] }),
      };
    return result;
  };
  await assert.rejects(executeFixture(fixture, { runCommand: runner }), /RESULT_TREE_DRIFT/u);
  assert.equal(
    fixture.state.calls.some((call) => call.args.includes("PATCH")),
    false,
  );
});

test("unvalidated, unsafe, expired, and replayed authorities fail closed", async () => {
  const unvalidated = makeFixture({ id: "unvalidated0001" }).authority;
  unvalidated.validation.status = "UNVERIFIED";
  assert.throws(
    () => validateRepairAuthority(unvalidated, { now: fixedNow }),
    /AUTHORITY_NOT_SEPARATELY_VALIDATED/u,
  );

  const unsafe = makeFixture({ id: "unsafe0001" }).authority;
  unsafe.mechanism.force = true;
  assert.throws(
    () => validateRepairAuthority(unsafe, { now: fixedNow }),
    /AUTHORITY_(NOT_SEPARATELY_VALIDATED|LINEAGE)/u,
  );

  const expired = makeFixture({ id: "expired0001" }).authority;
  expired.expires_at = "2026-08-29T05:59:59.000Z";
  const expiredLineage = { ...expired.lineage };
  delete expiredLineage.lineage_sha256;
  expired.validation.authority_binding_sha256 = sha256(
    Buffer.from(
      `${canonicalJson({
        schema_version: expired.schema_version,
        authority_id: expired.authority_id,
        operation: expired.operation,
        lineage: expiredLineage,
        target: expired.target,
        mechanism: expired.mechanism,
        issued_at: expired.issued_at,
        expires_at: expired.expires_at,
      })}\n`,
    ),
  );
  assert.throws(() => validateRepairAuthority(expired, { now: fixedNow }), /AUTHORITY_EXPIRED/u);

  const fixture = makeFixture({ id: "replay0001" });
  await executeFixture(fixture);
  const callCount = fixture.state.calls.length;
  await assert.rejects(
    executeDefaultBranchWorkflowRepair({
      authority: fixture.authority,
      runCommand: async () => {
        throw new Error("runner must not be called on replay");
      },
      confirm: true,
      preConsumptionTrustedTime: fixture.preConsumptionTrustedTime,
      preMutationTrustedTime: fixture.preMutationTrustedTime,
      verifyTrustRoot: () => true,
      testOnlyAllowInMemoryAuthority: true,
      terminalRecordFile: fixture.terminalRecordFile,
      registrationEvidenceFile: fixture.registrationEvidenceFile,
    }),
    /AUTHORITY_REPLAY/u,
  );
  assert.equal(fixture.state.calls.length, callCount);
});

test("authority-file execution atomically consumes the one-use record before provider reads", async () => {
  const fixture = makeFixture({ id: "file0001" });
  const directory = mkdtempSync(join(tmpdir(), "videoforge-default-branch-repair-"));
  const authorityPath = join(directory, "authority.json");
  try {
    chmodSync(directory, 0o700);
    writeFileSync(authorityPath, `${JSON.stringify(fixture.authority)}\n`, { mode: 0o600 });
    const events = [];
    const orderedRunner = async (...args) => {
      events.push("authenticated-read");
      assert.equal(JSON.parse(readFileSync(authorityPath, "utf8")).use_count, 1);
      return fixture.runner(...args);
    };
    const result = await executeDefaultBranchWorkflowRepair({
      authorityFile: authorityPath,
      authorityRecordCommit: sha("9"),
      runCommand: orderedRunner,
      confirm: true,
      preConsumptionTrustedTime: () => {
        events.push("credential-free-time");
        assert.equal(JSON.parse(readFileSync(authorityPath, "utf8")).use_count, 0);
        return credentialFreeTime;
      },
      preMutationTrustedTime: () => {
        events.push("authenticated-time");
        assert.equal(JSON.parse(readFileSync(authorityPath, "utf8")).use_count, 1);
        return authenticatedTime;
      },
      verifyTrustRoot: () => {
        events.push("trust-root");
        return true;
      },
    });
    assert.equal(result.state, "REPAIR_COMPLETE");
    const consumed = JSON.parse(readFileSync(authorityPath, "utf8"));
    assert.equal(consumed.state, "CONSUMED_SINGLE_USE_NO_REPLAY");
    assert.equal(consumed.use_count, 1);
    assert.equal(consumed.consumed_at, fixedNow.toISOString());
    assert.equal(consumed.execution_id.startsWith(fixture.authority.authority_id), true);
    assert.deepEqual(events.slice(0, 3), [
      "trust-root",
      "credential-free-time",
      "authenticated-read",
    ]);
    assert.ok(events.indexOf("authenticated-time") > events.indexOf("authenticated-read"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("authority consumption fails closed while another process owns the durable lock", async () => {
  const fixture = makeFixture({ id: "lock0001" });
  const directory = mkdtempSync(join(tmpdir(), "videoforge-default-branch-lock-"));
  const authorityPath = join(directory, "authority.json");
  const lockPath = `${authorityPath}.lock`;
  writeFileSync(authorityPath, `${JSON.stringify(fixture.authority)}\n`, { mode: 0o600 });
  const holderSource = `
    import { openSync, writeFileSync, fsyncSync } from "node:fs";
    const descriptor = openSync(${JSON.stringify(lockPath)}, "wx", 0o600);
    writeFileSync(descriptor, "held-by-concurrent-process\\n");
    fsyncSync(descriptor);
    process.stdout.write("READY\\n");
    setInterval(() => {}, 1000);
  `;
  const holder = spawn(process.execPath, ["--input-type=module", "-e", holderSource], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await once(holder.stdout, "data");
    assert.throws(
      () =>
        consumeRepairAuthorityFile(authorityPath, {
          trustedTime: fixedNow,
        }),
      /AUTHORITY_LOCK_BUSY_OR_UNAVAILABLE/u,
    );
    assert.equal(JSON.parse(readFileSync(authorityPath, "utf8")).state, "APPROVED_UNCONSUMED");
  } finally {
    holder.kill("SIGTERM");
    await once(holder, "exit").catch(() => undefined);
    rmSync(directory, { recursive: true, force: true });
  }
});

test("durable consumption prevents replay from a separate process", () => {
  const fixture = makeFixture({ id: "crossprocess0001" });
  const directory = mkdtempSync(join(tmpdir(), "videoforge-default-branch-cross-process-"));
  const authorityPath = join(directory, "authority.json");
  const moduleUrl = new URL(
    "../../deploy/v2-13/default-branch-workflow-repair.mjs",
    import.meta.url,
  ).href;
  const childSource = `
    import { consumeRepairAuthorityFile } from ${JSON.stringify(moduleUrl)};
    try {
      consumeRepairAuthorityFile(${JSON.stringify(authorityPath)}, {
        trustedTime: new Date(${JSON.stringify(fixedNow.toISOString())}),
      });
      process.stdout.write("CONSUMED\\n");
    } catch (error) {
      process.stderr.write(String(error?.message ?? error) + "\\n");
      process.exitCode = 1;
    }
  `;
  try {
    chmodSync(directory, 0o700);
    writeFileSync(authorityPath, `${JSON.stringify(fixture.authority)}\n`, { mode: 0o600 });
    const first = spawnSync(process.execPath, ["--input-type=module", "-e", childSource], {
      encoding: "utf8",
    });
    assert.equal(first.status, 0, first.stderr);
    assert.equal(first.stdout.trim(), "CONSUMED");
    const second = spawnSync(process.execPath, ["--input-type=module", "-e", childSource], {
      encoding: "utf8",
    });
    assert.equal(second.status, 1);
    assert.match(second.stderr, /AUTHORITY_INVALID|AUTHORITY_REPLAY/u);
    assert.equal(JSON.parse(readFileSync(authorityPath, "utf8")).use_count, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("authority and durable sidecars require a non-symlink 0700 parent directory", () => {
  const fixture = makeFixture({ id: "permissions0001" });
  const directory = mkdtempSync(join(tmpdir(), "videoforge-default-branch-permissions-"));
  const authorityPath = join(directory, "authority.json");
  try {
    writeFileSync(authorityPath, `${JSON.stringify(fixture.authority)}\n`, { mode: 0o600 });
    chmodSync(directory, 0o755);
    assert.throws(
      () => consumeRepairAuthorityFile(authorityPath, { trustedTime: fixedNow }),
      /AUTHORITY_FILE_PARENT_PERMISSIONS/u,
    );
    assert.equal(JSON.parse(readFileSync(authorityPath, "utf8")).use_count, 0);
  } finally {
    chmodSync(directory, 0o700);
    rmSync(directory, { recursive: true, force: true });
  }
});

test("authority consumption checks the exact prior-byte hash before replacing the record", () => {
  const fixture = makeFixture({ id: "cas0001" });
  const directory = mkdtempSync(join(tmpdir(), "videoforge-default-branch-cas-"));
  const authorityPath = join(directory, "authority.json");
  try {
    const bytes = Buffer.from(`${JSON.stringify(fixture.authority)}\n`);
    writeFileSync(authorityPath, bytes, { mode: 0o600 });
    assert.throws(
      () =>
        consumeRepairAuthorityFile(authorityPath, {
          trustedTime: fixedNow,
          expectedPriorBytesSha256: hash("0"),
        }),
      /AUTHORITY_PRIOR_BYTES_CAS_DRIFT/u,
    );
    assert.equal(readFileSync(authorityPath).equals(bytes), true);
    assert.equal(existsSync(`${authorityPath}.lock`), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("execution confirmation and authority input are mandatory", async () => {
  const fixture = makeFixture({ id: "confirm0001" });
  await assert.rejects(
    executeDefaultBranchWorkflowRepair({
      authority: fixture.authority,
      runCommand: fixture.runner,
    }),
    /CONFIRMATION_REQUIRED/u,
  );
  await assert.rejects(
    executeDefaultBranchWorkflowRepair({
      runCommand: fixture.runner,
      confirm: true,
    }),
    /DURABLE_AUTHORITY_FILE_REQUIRED/u,
  );
  await assert.rejects(
    executeDefaultBranchWorkflowRepair({
      authority: fixture.authority,
      confirm: true,
      testOnlyAllowInMemoryAuthority: true,
      verifyTrustRoot: () => true,
      terminalRecordFile: fixture.terminalRecordFile,
      registrationEvidenceFile: fixture.registrationEvidenceFile,
    }),
    /IN_MEMORY_AUTHORITY_WITH_REAL_RUNNER_FORBIDDEN/u,
  );
});

test("post-mutation failures persist opaque ACK_UNKNOWN and reconcile without mutation", async () => {
  const fixture = makeFixture({ id: "ackunknown0001" });
  const failingRunner = async (command, args) => {
    if (args.some((arg) => arg.includes("actions/workflows/")))
      throw new Error("simulated final registration readback loss");
    return fixture.runner(command, args);
  };
  await assert.rejects(
    executeFixture(fixture, { runCommand: failingRunner }),
    /^Error: V2_13_DEFAULT_BRANCH_WORKFLOW_REPAIR_ACK_UNKNOWN_READBACK_ONLY_NO_REPLAY$/u,
  );
  const terminal = JSON.parse(readFileSync(fixture.terminalRecordFile, "utf8"));
  assert.equal(terminal.state, "ACK_UNKNOWN");
  assert.equal(terminal.mode, "READBACK_ONLY_RECONCILIATION");
  assert.equal(terminal.no_retry, true);
  assert.equal(terminal.no_replay, true);
  assert.equal(terminal.no_fallback, true);
  assert.equal(terminal.no_redispatch, true);
  assert.deepEqual(terminal.credential_use, {
    authenticated: true,
    provider: "github",
    source: "gh-cli-auth",
    values_read: false,
    values_exposed: false,
    truncated: false,
  });
  const unsigned = { ...terminal };
  delete unsigned.terminal_record_sha256;
  assert.equal(
    terminal.terminal_record_sha256,
    sha256(Buffer.from(`${canonicalJson(unsigned)}\n`)),
  );

  fixture.state.calls.length = 0;
  const reconciled = await reconcileDefaultBranchWorkflowRepair({
    terminalRecordFile: fixture.terminalRecordFile,
    runCommand: fixture.runner,
  });
  assert.equal(reconciled.state, "RECONCILIATION_CONFIRMED");
  assert.equal(reconciled.mutations, 0);
  assert.equal(reconciled.credential_use.truncated, false);
  assert.equal(reconciled.authenticated_credential_use, true);
  assert.equal(reconciled.credential_values_read, 0);
  assert.equal(existsSync(reconciled.registration_evidence_file), true);
  assert.equal(existsSync(reconciled.reconciliation_record_file), true);
  const durableReconciliation = JSON.parse(
    readFileSync(reconciled.reconciliation_record_file, "utf8"),
  );
  const unsignedReconciliation = { ...durableReconciliation };
  delete unsignedReconciliation.reconciliation_record_sha256;
  assert.equal(
    durableReconciliation.reconciliation_record_sha256,
    sha256(Buffer.from(`${canonicalJson(unsignedReconciliation)}\n`)),
  );
  assert.equal(
    fixture.state.calls.some((call) => call.args.includes("PATCH") || call.args.includes("PUT")),
    false,
  );
});

test("mutation intent is durable before PATCH and an intent restart reconciles without replay", async () => {
  const fixture = makeFixture({ id: "intentrestart0001" });
  const lostRunner = async (command, args) => {
    if (args.includes("PATCH")) {
      const intent = JSON.parse(readFileSync(fixture.terminalRecordFile, "utf8"));
      assert.equal(intent.state, MUTATION_INTENT_STATE);
      assert.equal(intent.mutation_started, false);
      // The provider accepted the request, but the process loses its ACK.
      fixture.state.mutated = true;
      throw new Error("simulated process crash after mutation intent");
    }
    return fixture.runner(command, args);
  };
  await assert.rejects(
    executeFixture(fixture, { runCommand: lostRunner }),
    /ACK_UNKNOWN_READBACK_ONLY_NO_REPLAY/u,
  );

  // Model a hard process exit after the durable INTENT write: the restart sees
  // only the intent, while the authority remains consumed and the branch has
  // already advanced. Reconciliation must be read-only and must not PATCH/PUT.
  const acknowledged = JSON.parse(readFileSync(fixture.terminalRecordFile, "utf8"));
  const intent = { ...acknowledged, state: MUTATION_INTENT_STATE, mutation_started: false };
  delete intent.terminal_record_sha256;
  intent.terminal_record_sha256 = sha256(Buffer.from(`${canonicalJson(intent)}\n`));
  writeFileSync(fixture.terminalRecordFile, `${JSON.stringify(intent, null, 2)}\n`, {
    mode: 0o600,
  });
  fixture.state.calls.length = 0;

  const reconciled = await reconcileDefaultBranchWorkflowRepair({
    terminalRecordFile: fixture.terminalRecordFile,
    runCommand: fixture.runner,
  });
  assert.equal(reconciled.state, "RECONCILIATION_CONFIRMED");
  assert.equal(reconciled.mutations, 0);
  assert.equal(
    fixture.state.calls.some((call) => call.args.includes("PATCH") || call.args.includes("PUT")),
    false,
  );
});

test("protected-branch ACK_UNKNOWN retains the returned merge SHA for readback-only reconciliation", async () => {
  const fixture = makeFixture({ id: "protectedack0001", mechanism: "PROTECTED_BRANCH" });
  const failingRunner = async (command, args) => {
    if (args.some((arg) => arg.includes(`git/commits/${fixture.resultSha}`)))
      throw new Error("simulated merge readback loss");
    return fixture.runner(command, args);
  };
  await assert.rejects(
    executeFixture(fixture, { runCommand: failingRunner }),
    /ACK_UNKNOWN_READBACK_ONLY_NO_REPLAY/u,
  );
  const terminal = JSON.parse(readFileSync(fixture.terminalRecordFile, "utf8"));
  assert.equal(terminal.resulting_commit_sha, fixture.resultSha);
  assert.equal(terminal.target.resulting.commit_sha, fixture.resultSha);
  assert.deepEqual(terminal.target.resulting.parent_commit_shas, [fixture.baseSha, "d".repeat(40)]);

  fixture.state.calls.length = 0;
  const reconciled = await reconcileDefaultBranchWorkflowRepair({
    terminalRecordFile: fixture.terminalRecordFile,
    runCommand: fixture.runner,
  });
  assert.equal(reconciled.state, "RECONCILIATION_CONFIRMED");
  assert.equal(reconciled.resulting_commit_sha, fixture.resultSha);
  assert.equal(
    fixture.state.calls.some((call) => call.args.includes("PATCH") || call.args.includes("PUT")),
    false,
  );
});

test("protected-branch ACK_UNKNOWN with a lost merge response reconciles from the observed ref", async () => {
  const fixture = makeFixture({ id: "protectedlostack0001", mechanism: "PROTECTED_BRANCH" });
  const lostRunner = async (command, args) => {
    if (args.includes("PUT")) {
      fixture.state.mutated = true;
      throw new Error("simulated lost merge response");
    }
    return fixture.runner(command, args);
  };
  await assert.rejects(
    executeFixture(fixture, { runCommand: lostRunner }),
    /ACK_UNKNOWN_READBACK_ONLY_NO_REPLAY/u,
  );
  const terminal = JSON.parse(readFileSync(fixture.terminalRecordFile, "utf8"));
  assert.equal(terminal.resulting_commit_sha, null);
  assert.equal(terminal.target.resulting.commit_sha, null);
  assert.equal(terminal.target.resulting.parent_commit_shas, null);

  fixture.state.calls.length = 0;
  const reconciled = await reconcileDefaultBranchWorkflowRepair({
    terminalRecordFile: fixture.terminalRecordFile,
    runCommand: fixture.runner,
  });
  assert.equal(reconciled.state, "RECONCILIATION_CONFIRMED");
  assert.equal(reconciled.resulting_commit_sha, fixture.resultSha);
  assert.equal(
    fixture.state.calls.some((call) => call.args.includes("PATCH") || call.args.includes("PUT")),
    false,
  );
});

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  executeFullLive as executeFullLiveRaw,
  missingConcreteTools,
  OPERATIONS,
} from "../../deploy/v2-13/full-live-executor.mjs";
import {
  enterCleanupOnly,
  initialConsumptionRecord,
  writeExclusive,
} from "../../deploy/v2-13/full-live-orchestration-authority.mjs";

const hash = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const proof = (letter) => `sha256:${letter.repeat(64)}`;
const executeFullLive = (options) =>
  executeFullLiveRaw({ trustedTime: async () => "2026-08-26T12:00:00.000Z", ...options });

function stateFixture() {
  const directory = mkdtempSync(join(tmpdir(), "videoforge-full-live-executor-"));
  chmodSync(directory, 0o700);
  const path = join(directory, "state.json");
  const authority = {
    authority_id: "v2-13-test-executor-0001",
    outer_orchestration: {
      full_live_executor_path: "deploy/v2-13/full-live-executor.mjs",
      full_live_executor_sha256: hash(readFileSync("deploy/v2-13/full-live-executor.mjs")),
    },
  };
  const authorityBytes = Buffer.from('{"authority":"test"}\n');
  const validated = {
    proposalSha256: proof("1"),
    approvalSha256: proof("2"),
    proposalRecordCommit: "b".repeat(40),
    authorityRecordCommit: "c".repeat(40),
    approvalRecordPath: "evidence/user-approval.json",
    authorityRecordPath: "evidence/approved-authority.json",
    releaseSourceCommit: "a".repeat(40),
    approvedAt: "2026-08-26T00:00:00.000Z",
    expiresAt: "2026-08-27T00:00:00.000Z",
  };
  writeExclusive(path, initialConsumptionRecord(authority, authorityBytes, validated));
  return { directory, path, sha256: hash(readFileSync(path)) };
}

function fakeResult(operation, state, priorResults) {
  const result = { actualUsd: operation.reserveUsd };
  if (operation.id === "release-tag-readback")
    Object.assign(result, {
      tagName: state.release_ref.exact_tag_name,
      targetCommit: state.release_ref.exact_target_commit,
    });
  if (operation.id === "release-tag-create")
    Object.assign(result, { created: true, targetCommit: state.release_source_commit });
  if (operation.id === "release-tag-push")
    Object.assign(result, {
      tagName: state.release_ref.exact_tag_name,
      targetCommit: state.release_source_commit,
      forceUsed: false,
    });
  if (operation.id === "approval-commit-push")
    Object.assign(result, {
      commit: state.authority_record_commit,
      exactRemoteReadback: true,
      branch: "codex/serverless-v2-roadmap",
    });
  if (operation.id.endsWith("image-workflow-dispatch"))
    Object.assign(result, {
      runId: operation.id.startsWith("mage") ? "1001" : "1002",
      headSha: state.release_source_commit,
      dispatchAccepted: true,
    });
  if (operation.id.endsWith("image-workflow-verification")) {
    const dispatchId = operation.id.replace("verification", "dispatch");
    Object.assign(result, {
      runId: priorResults.get(dispatchId).runId,
      headSha: state.release_source_commit,
      imageDigest: proof("3"),
      evidenceSha256: proof("4"),
      publicManifestSha256: proof("5"),
      publicAllBlobsVerified: true,
      conclusion: "success",
    });
  }
  if (operation.id === "fresh-live-preflight")
    Object.assign(result, {
      exactGpu: "NVIDIA GeForce RTX 4090",
      region: "EU-RO-1",
      availability: "LOW",
      flexUsdPerGpuHour: 1.1,
      noFallback: true,
      inventorySha256: proof("6"),
      billingBaselineSha256: proof("7"),
    });
  if (operation.id.includes("live-qualification"))
    Object.assign(result, {
      qualified: true,
      evidenceSha256: proof("8"),
      deploymentSha256: proof("9"),
      zeroWorkersAfter: true,
    });
  if (operation.id === "guarded-activation-once")
    Object.assign(result, { executedOnce: true, evidenceSha256: proof("f") });
  if (operation.id === "promote-qualified-production")
    Object.assign(result, {
      enabled: true,
      state: "QUALIFIED_EXACT",
      providerSendPerformed: false,
      evidenceSha256: proof("1"),
      versionSha256: proof("2"),
      databasePromotionSha256: proof("3"),
    });
  if (operation.id === "create-exact-max-one-endpoints")
    Object.assign(result, {
      createdExactTwoEndpoints: true,
      distinctEndpointIds: true,
      bothMaxWorkersOne: true,
      bothWorkersMinZero: true,
      evidenceSha256: proof("f"),
    });
  if (operation.id.startsWith("v2-"))
    Object.assign(result, {
      accepted: true,
      terminal: true,
      evidenceSha256: proof("a"),
      zeroWorkersAfter: true,
    });
  if (operation.id === "v2-09-short-hosted-project") result.durationSeconds = 40;
  if (operation.id === "v2-10-operator-free-ranga-pilot")
    Object.assign(result, { durationSeconds: 240, operatorIntervention: false });
  if (operation.id === "v2-11-two-concurrent-owned-projects")
    Object.assign(result, { projectCount: 2, concurrent: true, ownershipIsolated: true });
  if (operation.id === "v2-12-long-output") result.durationSeconds = 1800;
  if (operation.id === "v2-13-final-two-lane-smoke") result.twoLaneSmoke = true;
  if (operation.id === "restore-endpoints-max-one")
    Object.assign(result, { proofSha256: proof("b"), bothEndpointsMaxWorkersOne: true });
  if (operation.id === "prove-zero-workers")
    Object.assign(result, { proofSha256: proof("c"), zeroWorkers: true });
  if (operation.id === "read-settled-billing")
    Object.assign(result, { proofSha256: proof("d"), withinCumulativeCap: true });
  if (operation.id === "reconcile-exact-resources")
    Object.assign(result, { proofSha256: proof("e"), onlyApprovedRetainedVolumes: true });
  return result;
}

test("default command performs zero actions and reports every concrete tooling gap", () => {
  const result = spawnSync(process.execPath, ["deploy/v2-13/full-live-executor.mjs"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.deepEqual(
    { state: output.state, external_calls: output.external_calls, mutations: output.mutations },
    { state: "NO_ACTION", external_calls: 0, mutations: 0 },
  );
  assert.deepEqual(output.missing_concrete_tools, missingConcreteTools());
  assert.equal(output.ordered_operations.length, OPERATIONS.length);
});

test("execute mode has a closed concrete catalog and requires exact state binding", () => {
  const result = spawnSync(
    process.execPath,
    [
      "deploy/v2-13/full-live-executor.mjs",
      "--execute",
      "--confirm",
      "EXECUTE_EXACT_V2_13_FULL_LIVE_ONCE",
    ],
    { encoding: "utf8" },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /EXPECTED_STATE_SHA256/u);
  assert.doesNotMatch(result.stderr, /STATE_FILE|ENOENT/u);
});

test("global protected-input preflight fails before any operation runner", async () => {
  const fixture = stateFixture();
  let calls = 0;
  try {
    await assert.rejects(
      executeFullLive({
        statePath: fixture.path,
        expectedStateSha256: fixture.sha256,
        preflight: async () => {
          throw new Error("PROTECTED_INPUT_MISSING");
        },
        runOperation: async () => {
          calls += 1;
          throw new Error("must not run");
        },
      }),
      /PROTECTED_INPUT_MISSING/u,
    );
    assert.equal(calls, 0);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("expired authenticated time enters cleanup-only before any normal mutation operation", async () => {
  const fixture = stateFixture();
  const called = [];
  try {
    const result = await executeFullLiveRaw({
      statePath: fixture.path,
      expectedStateSha256: fixture.sha256,
      trustedTime: async () => "2026-08-27T00:00:01.000Z",
      runOperation: async (operation, current, prior) => {
        called.push(operation.id);
        return fakeResult(operation, current, prior);
      },
    });
    assert.deepEqual(called, [
      "restore-endpoints-max-one",
      "prove-zero-workers",
      "read-settled-billing",
      "reconcile-exact-resources",
    ]);
    assert.equal(result.failed, true);
    assert.equal(result.state.state, "CONSUMED_SINGLE_EXECUTION_CLEANUP_COMPLETE_NO_RETRY");
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("cleanup-only restart skips every publication, qualification, and acceptance operation", async () => {
  const fixture = stateFixture();
  try {
    const state = enterCleanupOnly(JSON.parse(readFileSync(fixture.path, "utf8")), {
      failureCode: "TEST_RESTART",
      eventId: "v2-13-test-executor-0001:cleanup-entry:failed",
    });
    writeFileSync(fixture.path, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    const called = [];
    const result = await executeFullLive({
      statePath: fixture.path,
      expectedStateSha256: hash(readFileSync(fixture.path)),
      runOperation: async (operation, current, prior) => {
        called.push(operation.id);
        return fakeResult(operation, current, prior);
      },
    });
    assert.deepEqual(called, [
      "restore-endpoints-max-one",
      "prove-zero-workers",
      "read-settled-billing",
      "reconcile-exact-resources",
    ]);
    assert.equal(result.state.state, "CONSUMED_SINGLE_EXECUTION_CLEANUP_COMPLETE_NO_RETRY");
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("authority-bound executor source drift fails the state contract before the fake runner", async () => {
  const fixture = stateFixture();
  try {
    const state = JSON.parse(readFileSync(fixture.path, "utf8"));
    state.full_live_executor_sha256 = proof("0");
    writeFileSync(fixture.path, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    let calls = 0;
    await assert.rejects(
      executeFullLive({
        statePath: fixture.path,
        expectedStateSha256: hash(readFileSync(fixture.path)),
        runOperation: async () => {
          calls += 1;
          return {};
        },
      }),
      /STATE_CONTRACT/u,
    );
    assert.equal(calls, 0);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("fake command integration preserves the exact graph and terminal cleanup proof", async () => {
  const fixture = stateFixture();
  const called = [];
  try {
    const result = await executeFullLive({
      statePath: fixture.path,
      expectedStateSha256: fixture.sha256,
      runOperation: async (operation, state, priorResults) => {
        called.push(operation.id);
        return fakeResult(operation, state, priorResults);
      },
    });
    assert.deepEqual(
      called,
      OPERATIONS.map(({ id }) => id),
    );
    assert.equal(result.failed, false);
    assert.equal(result.state.state, "CONSUMED_SINGLE_EXECUTION_COMPLETE");
    assert.equal(result.state.total_reserved_usd, 17.5);
    assert.equal(result.state.total_settled_usd, 17.5);
    assert.equal(result.state.cleanup_proof.zero_worker_proof_sha256, proof("c"));
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("operation failure enters cleanup-only and never dispatches later paid work", async () => {
  const fixture = stateFixture();
  const called = [];
  try {
    const result = await executeFullLive({
      statePath: fixture.path,
      expectedStateSha256: fixture.sha256,
      runOperation: async (operation, state, priorResults) => {
        called.push(operation.id);
        if (operation.id === "mage-live-qualification") throw new Error("fake provider failure");
        return fakeResult(operation, state, priorResults);
      },
    });
    assert.equal(result.failed, true);
    assert.equal(result.state.state, "CONSUMED_SINGLE_EXECUTION_CLEANUP_COMPLETE_NO_RETRY");
    assert.equal(called.includes("soulx-live-qualification"), false);
    assert.deepEqual(called.slice(-4), [
      "restore-endpoints-max-one",
      "prove-zero-workers",
      "read-settled-billing",
      "reconcile-exact-resources",
    ]);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("cleanup failure is durably cleanup-only and the ambiguous work is never retried", async () => {
  const fixture = stateFixture();
  const called = [];
  try {
    await assert.rejects(
      executeFullLive({
        statePath: fixture.path,
        expectedStateSha256: fixture.sha256,
        runOperation: async (operation, state, priorResults) => {
          called.push(operation.id);
          if (operation.id === "prove-zero-workers") throw new Error("fake cleanup transport gap");
          return fakeResult(operation, state, priorResults);
        },
      }),
      /fake cleanup transport gap/u,
    );
    const state = JSON.parse(readFileSync(fixture.path, "utf8"));
    assert.equal(state.state, "CONSUMED_SINGLE_EXECUTION_CLEANUP_ONLY");
    assert.equal(
      state.phases.cleanup_and_reconciliation.work["v2-13-test-executor-0001:prove-zero-workers"]
        .state,
      "AUTHORIZED_ONCE_NOT_REDISPATCHABLE",
    );
    assert.equal(called.filter((id) => id === "prove-zero-workers").length, 1);
    assert.equal(called.includes("read-settled-billing"), false);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("replay cannot reopen a consumed execution", async () => {
  const fixture = stateFixture();
  try {
    const first = await executeFullLive({
      statePath: fixture.path,
      expectedStateSha256: fixture.sha256,
      runOperation: async (operation, state, priorResults) =>
        fakeResult(operation, state, priorResults),
    });
    let calls = 0;
    await assert.rejects(
      executeFullLive({
        statePath: fixture.path,
        expectedStateSha256: first.sha256,
        runOperation: async () => {
          calls += 1;
          return {};
        },
      }),
      /NOT_IN_PROGRESS|PHASE_ORDER|PHASE_ALREADY_STARTED/u,
    );
    assert.equal(calls, 0);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("reported cost above an exact reservation stops all later paid work", async () => {
  const fixture = stateFixture();
  const called = [];
  try {
    const result = await executeFullLive({
      statePath: fixture.path,
      expectedStateSha256: fixture.sha256,
      runOperation: async (operation, state, priorResults) => {
        called.push(operation.id);
        const value = fakeResult(operation, state, priorResults);
        if (operation.id === "mage-live-qualification") value.actualUsd = 4.500001;
        return value;
      },
    });
    assert.equal(result.failed, true);
    assert.match(result.results.get("failure").message, /RESULT_COST/u);
    assert.equal(called.filter((id) => id === "mage-live-qualification").length, 1);
    assert.equal(called.includes("soulx-live-qualification"), false);
    assert.equal(result.state.state, "CONSUMED_SINGLE_EXECUTION_CLEANUP_COMPLETE_NO_RETRY");
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

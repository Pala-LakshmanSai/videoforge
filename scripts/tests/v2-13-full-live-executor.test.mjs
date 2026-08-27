import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  assertResult,
  certificationPredecessorEvidence,
  cleanupProofEvidence,
  executeFullLive as executeFullLiveRaw,
  missingConcreteTools,
  OPERATIONS,
  runPodMutationBoundaryReached,
  validateFullLiveSourceClosure,
} from "../../deploy/v2-13/full-live-executor.mjs";
import {
  enterCleanupOnly,
  initialConsumptionRecord,
  writeExclusive,
} from "../../deploy/v2-13/full-live-orchestration-authority.mjs";

const hash = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const proof = (letter) => `sha256:${letter.repeat(64)}`;
const executeFullLive = (options) =>
  executeFullLiveRaw({
    trustedTime: async () => "2026-08-26T12:00:00.000Z",
    verifyMaterializationSeed: async () => true,
    verifyStaticReleaseDescriptor: async () => true,
    ...options,
  });

test("production source closure rejects any covered byte drift before execution", () => {
  const directory = mkdtempSync(join(tmpdir(), "videoforge-source-closure-"));
  const sourcePath = join(directory, "production.ts");
  const manifestPath = join(directory, "closure.json");
  try {
    writeFileSync(sourcePath, "export const production = true;\n");
    writeFileSync(
      manifestPath,
      `${JSON.stringify({
        schema_version: "videoforge.v2-13-full-live-source-closure/v1",
        entries: [{ path: "production.ts", sha256: hash(readFileSync(sourcePath)) }],
      })}\n`,
    );
    assert.equal(
      validateFullLiveSourceClosure({ root: directory, manifestPath: "closure.json" }),
      1,
    );
    writeFileSync(sourcePath, "export const production = false;\n");
    assert.throws(
      () => validateFullLiveSourceClosure({ root: directory, manifestPath: "closure.json" }),
      /V2_13_FULL_LIVE_SOURCE_CLOSURE_DRIFT:production\.ts/u,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function stateFixture() {
  const directory = mkdtempSync(join(tmpdir(), "videoforge-full-live-executor-"));
  chmodSync(directory, 0o700);
  const path = join(directory, "state.json");
  const authority = {
    authority_id: "v2-13-test-executor-0001",
    materialization_seed_sha256: proof("a"),
    static_release_descriptor: {
      path: "project-context/evidence/acceptance/VF-10-13/static-release-descriptor.json",
      sha256: proof("d"),
    },
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
    staticReleaseDescriptorPath:
      "project-context/evidence/acceptance/VF-10-13/static-release-descriptor.json",
    staticReleaseDescriptorSha256: proof("d"),
  };
  writeExclusive(path, initialConsumptionRecord(authority, authorityBytes, validated));
  return { directory, path, sha256: hash(readFileSync(path)) };
}

function fakeResult(operation, state, priorResults) {
  const result = { actualUsd: operation.reserveUsd };
  if (operation.id === "bootstrap-prequalification-database")
    Object.assign(result, {
      schema_version: "videoforge.v213-prequalification-database-bootstrap-result/v1",
      ledger_before_count: 36,
      ledger_before_sha256: proof("1"),
      ledger_after_sha256: proof("2"),
      operator_acl_sha256: proof("3"),
      pgcrypto_sha256: proof("4"),
      prequalification_database_bootstrap_sha256: proof("5"),
      recovery_mode: "FRESH_36_TO_45",
      runpod_calls: 0,
      cloudflare_calls: 0,
      application_secret_reads: 0,
      gpu_use: false,
      external_spend_usd: 0,
    });
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
      flexUsdPerGpuHour: 1.116,
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
      gpuDispatchPerformed: false,
      cloudflareMutationPerformed: true,
      evidenceSha256: proof("1"),
      versionSha256: proof("2"),
      databasePromotionSha256: proof("3"),
    });
  if (operation.id === "record-workflow-start-authority")
    Object.assign(result, {
      authorityId: "11111111-1111-4111-8111-111111111111",
      tokenSha256: proof("6"),
      expiresAt: "2026-08-27T00:00:00.000Z",
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
  if (operation.id === "v2-13-final-two-lane-smoke")
    Object.assign(result, {
      schemaVersion: "videoforge.v213-fresh-two-lane-smoke-result/v1",
      twoLaneSmoke: true,
      smokeOnly: true,
      releaseCertified: false,
      signedSmokeEvidenceSha256: result.evidenceSha256,
    });
  if (operation.id === "restore-endpoints-max-one")
    Object.assign(result, {
      proofSha256: proof("b"),
      productionCleanupState: "EXACT_MAX_ONE_PAIR_RETAINED",
      productionResourcesAbsent: false,
      bothEndpointsMaxWorkersOne: true,
      retainedProductionEndpoints: 2,
    });
  if (operation.id === "prove-zero-workers")
    Object.assign(result, { proofSha256: proof("c"), zeroWorkers: true });
  if (operation.id === "read-settled-billing")
    Object.assign(result, { proofSha256: proof("d"), withinCumulativeCap: true });
  if (operation.id === "reconcile-exact-resources")
    Object.assign(result, { proofSha256: proof("e"), onlyApprovedRetainedVolumes: true });
  if (operation.id === "certify-v2-13-release") {
    const predecessorEvidenceSha256s = certificationPredecessorEvidence(priorResults);
    Object.assign(result, {
      schemaVersion: "videoforge.v213-final-release-certification-result/v1",
      externalSpendUsd: 0,
      gpuUse: false,
      providerMutationPerformed: false,
      currentRunEvidence: true,
      certified: true,
      releaseStatus: "release_certified",
      gateCount: 15,
      missingGateCount: 0,
      invalidGateCount: 0,
      liveReleaseAuthorized: false,
      requiresExplicitReleaseAuthority: true,
      releaseIdentitySha256: proof("f"),
      ledgerSha256: proof("0"),
      evidenceSha256: proof("0"),
      predecessorEvidenceSha256s,
    });
  }
  return result;
}

test("the resealed graph has exactly 26 operations and certifies only after reconciliation", () => {
  assert.equal(OPERATIONS.length, 26);
  assert.deepEqual(
    OPERATIONS.slice(-6).map(({ id, reserveUsd }) => [id, reserveUsd]),
    [
      ["v2-13-final-two-lane-smoke", 2],
      ["restore-endpoints-max-one", 0],
      ["prove-zero-workers", 0],
      ["read-settled-billing", 0],
      ["reconcile-exact-resources", 0],
      ["certify-v2-13-release", 0],
    ],
  );
  assert.equal(OPERATIONS.at(-1).phase, "cleanup_and_reconciliation");
});

function certificationPredecessorFixture() {
  return new Map([
    [
      "v2-13-final-two-lane-smoke",
      {
        schemaVersion: "videoforge.v213-fresh-two-lane-smoke-result/v1",
        smokeOnly: true,
        releaseCertified: false,
        twoLaneSmoke: true,
        evidenceSha256: proof("a"),
        signedSmokeEvidenceSha256: proof("a"),
      },
    ],
    [
      "restore-endpoints-max-one",
      {
        proofSha256: proof("b"),
        productionCleanupState: "EXACT_MAX_ONE_PAIR_RETAINED",
        productionResourcesAbsent: false,
        bothEndpointsMaxWorkersOne: true,
        retainedProductionEndpoints: 2,
      },
    ],
    ["prove-zero-workers", { proofSha256: proof("c"), zeroWorkers: true }],
    ["read-settled-billing", { proofSha256: proof("d"), withinCumulativeCap: true }],
    ["reconcile-exact-resources", { proofSha256: proof("e"), onlyApprovedRetainedVolumes: true }],
  ]);
}

test("final certification requires the exact five current-run predecessor receipts", () => {
  const results = certificationPredecessorFixture();
  assert.deepEqual(certificationPredecessorEvidence(results), {
    "v2-13-final-two-lane-smoke": proof("a"),
    "restore-endpoints-max-one": proof("b"),
    "prove-zero-workers": proof("c"),
    "read-settled-billing": proof("d"),
    "reconcile-exact-resources": proof("e"),
  });
  results.delete("read-settled-billing");
  assert.throws(
    () => certificationPredecessorEvidence(results),
    /CERTIFICATION_PREDECESSOR:read-settled-billing/u,
  );
});

test("production resource absence is explicit at every cleanup and certification boundary", () => {
  const results = certificationPredecessorFixture();
  delete results.get("restore-endpoints-max-one").productionResourcesAbsent;
  assert.throws(
    () => certificationPredecessorEvidence(results),
    /CERTIFICATION_PREDECESSOR_STATE/u,
  );
  assert.throws(() => cleanupProofEvidence(results), /CLEANUP_PROOF_READBACK/u);

  const operation = OPERATIONS.find(({ id }) => id === "restore-endpoints-max-one");
  const restoration = {
    actualUsd: 0,
    proofSha256: proof("b"),
    productionCleanupState: "EXACT_MAX_ONE_PAIR_RETAINED",
    bothEndpointsMaxWorkersOne: true,
    retainedProductionEndpoints: 2,
  };
  assert.throws(
    () => assertResult(operation, restoration, {}, new Map()),
    /CLEANUP_PRODUCTION_STATE/u,
  );
});

test("final certification rejects a ledger bound to an extra or different receipt", () => {
  const operation = OPERATIONS.at(-1);
  const results = certificationPredecessorFixture();
  const result = fakeResult(operation, {}, results);
  result.predecessorEvidenceSha256s = {
    ...result.predecessorEvidenceSha256s,
    "unexpected-future-operation": proof("9"),
  };
  assert.throws(
    () => assertResult(operation, result, {}, results),
    /RELEASE_CERTIFICATION_READBACK/u,
  );
});

test("the smoke operation cannot claim release certification", () => {
  const operation = OPERATIONS.find(({ id }) => id === "v2-13-final-two-lane-smoke");
  const result = {
    actualUsd: 2,
    accepted: true,
    terminal: true,
    zeroWorkersAfter: true,
    evidenceSha256: proof("a"),
    schemaVersion: "videoforge.v213-fresh-two-lane-smoke-result/v1",
    twoLaneSmoke: true,
    smokeOnly: true,
    releaseCertified: true,
    signedSmokeEvidenceSha256: proof("a"),
  };
  assert.throws(() => assertResult(operation, result, {}, new Map()), /V2_13_SCOPE/u);
});

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
  assert.equal(output.ordered_operations.length, 26);
  assert.equal(output.ordered_operations.at(-1).id, "certify-v2-13-release");
});

test("fresh preflight rejects a Serverless Flex rate above the exact current snapshot", () => {
  const operation = OPERATIONS.find(({ id }) => id === "fresh-live-preflight");
  assert.throws(
    () =>
      assertResult(
        operation,
        {
          actualUsd: 0,
          exactGpu: "NVIDIA GeForce RTX 4090",
          region: "EU-RO-1",
          availability: "LOW",
          flexUsdPerGpuHour: 1.116001,
          noFallback: true,
          inventorySha256: proof("6"),
          billingBaselineSha256: proof("7"),
        },
        {},
        new Map(),
      ),
    /PREFLIGHT_READBACK/u,
  );
});

test("all attributable production absent closes cleanup-only but never certifies normal release", async () => {
  const fixture = stateFixture();
  try {
    let certificationCalls = 0;
    await assert.rejects(
      executeFullLive({
        statePath: fixture.path,
        expectedStateSha256: fixture.sha256,
        runOperation: async (operation, state, priorResults) => {
          if (operation.id === "certify-v2-13-release") certificationCalls += 1;
          const value = fakeResult(operation, state, priorResults);
          if (operation.id === "restore-endpoints-max-one")
            Object.assign(value, {
              productionCleanupState: "ALL_ATTRIBUTABLE_PRODUCTION_ABSENT",
              productionResourcesAbsent: true,
              bothEndpointsMaxWorkersOne: false,
              retainedProductionEndpoints: 0,
            });
          return value;
        },
      }),
      /CERTIFICATION_PREDECESSOR_STATE/u,
    );
    const interrupted = JSON.parse(readFileSync(fixture.path, "utf8"));
    assert.equal(interrupted.state, "CONSUMED_SINGLE_EXECUTION_CLEANUP_ONLY");
    assert.notEqual(interrupted.cleanup_proof, null);
    assert.equal(interrupted.release_certification, null);
    assert.equal(certificationCalls, 0);

    const resumedCalls = [];
    const resumed = await executeFullLive({
      statePath: fixture.path,
      expectedStateSha256: hash(readFileSync(fixture.path)),
      runOperation: async (operation) => {
        resumedCalls.push(operation.id);
        throw new Error("settled cleanup must not rerun");
      },
    });
    assert.deepEqual(resumedCalls, []);
    assert.equal(resumed.state.state, "CONSUMED_SINGLE_EXECUTION_CLEANUP_COMPLETE_NO_RETRY");
    assert.equal(resumed.state.cleanup_proof.cleanup_work_ids.length, 4);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("cleanup proof rejects a production cleanup state that disagrees with retained resources", () => {
  const operation = OPERATIONS.find(({ id }) => id === "restore-endpoints-max-one");
  assert.throws(
    () =>
      assertResult(
        operation,
        {
          actualUsd: 0,
          proofSha256: proof("b"),
          productionCleanupState: "ALL_ATTRIBUTABLE_PRODUCTION_ABSENT",
          productionResourcesAbsent: true,
          bothEndpointsMaxWorkersOne: false,
          retainedProductionEndpoints: 1,
        },
        {},
        new Map(),
      ),
    /CLEANUP_PRODUCTION_STATE/u,
  );
  assert.throws(
    () =>
      assertResult(
        operation,
        {
          actualUsd: 0,
          proofSha256: proof("b"),
          productionCleanupState: "UNEXPECTED_STATE",
          bothEndpointsMaxWorkersOne: true,
          retainedProductionEndpoints: 2,
        },
        {},
        new Map(),
      ),
    /CLEANUP_PRODUCTION_STATE/u,
  );
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

test("global protected-input preflight enters endpoint-free cleanup before normal operations", async () => {
  const fixture = stateFixture();
  let calls = 0;
  try {
    const result = await executeFullLive({
      statePath: fixture.path,
      expectedStateSha256: fixture.sha256,
      preflight: async (_state, _sha256, mode) => {
        if (mode.initial) throw new Error("PROTECTED_INPUT_MISSING");
      },
      runOperation: async () => {
        calls += 1;
        throw new Error("must not run");
      },
      runCleanupOperation: async (operation, state, priorResults) =>
        fakeResult(operation, state, priorResults),
    });
    assert.equal(calls, 0);
    assert.equal(result.failed, true);
    assert.equal(result.state.state, "CONSUMED_SINGLE_EXECUTION_CLEANUP_COMPLETE_NO_RETRY");
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("early cleanup is selected only when no RunPod mutation operation has history", async () => {
  const fixture = stateFixture();
  const selected = [];
  try {
    const result = await executeFullLive({
      statePath: fixture.path,
      expectedStateSha256: fixture.sha256,
      preflight: async (_state, _sha256, mode) => {
        if (mode.initial) throw new Error("PROTECTED_INPUT_MISSING");
      },
      runOperation: async () => {
        throw new Error("must not run");
      },
      runCleanupOperation: async (operation, state, priorResults) => {
        selected.push("normal");
        return fakeResult(operation, state, priorResults);
      },
      runEarlyCleanupOperation: async (operation, state, priorResults) => {
        selected.push("early");
        return fakeResult(operation, state, priorResults);
      },
    });
    assert.deepEqual(selected, ["early", "early", "early", "early"]);
    assert.equal(result.state.state, "CONSUMED_SINGLE_EXECUTION_CLEANUP_COMPLETE_NO_RETRY");
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("an authorized RunPod mutation operation disables the fabricated early proof", () => {
  const fixture = stateFixture();
  try {
    const state = JSON.parse(readFileSync(fixture.path, "utf8"));
    const workId = `${state.authority_id}:mage-live-qualification`.toLowerCase();
    state.phases.mage_qualification.work[workId] = {
      state: "AUTHORIZED_ONCE_NOT_REDISPATCHABLE",
    };
    assert.equal(runPodMutationBoundaryReached(state), true);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("read-only history does not cross the RunPod mutation boundary", () => {
  const fixture = stateFixture();
  try {
    const state = JSON.parse(readFileSync(fixture.path, "utf8"));
    const workId = `${state.authority_id}:fresh-live-preflight`.toLowerCase();
    state.phases.mage_qualification.work[workId] = {
      state: "SETTLED_TERMINAL",
    };
    assert.equal(runPodMutationBoundaryReached(state), false);
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
      verifyMaterializationSeed: async () => true,
      verifyStaticReleaseDescriptor: async () => true,
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
    assert.equal(called.includes("certify-v2-13-release"), false);
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
    assert.equal(called.includes("certify-v2-13-release"), false);
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
  const preflights = [];
  try {
    const result = await executeFullLive({
      statePath: fixture.path,
      expectedStateSha256: fixture.sha256,
      preflight: async (_state, _sha256, mode, priorResults) => {
        preflights.push({ mode, priorOperationIds: [...priorResults.keys()] });
      },
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
    assert.deepEqual(result.state.cleanup_proof.cleanup_work_ids, [
      "v2-13-test-executor-0001:prove-zero-workers",
      "v2-13-test-executor-0001:read-settled-billing",
      "v2-13-test-executor-0001:reconcile-exact-resources",
      "v2-13-test-executor-0001:restore-endpoints-max-one",
    ]);
    assert.equal(
      result.state.release_certification.work_id,
      "v2-13-test-executor-0001:certify-v2-13-release",
    );
    assert.equal(result.state.release_certification.state, "SETTLED_TERMINAL");
    assert.equal(
      result.state.work_ids.includes("v2-13-test-executor-0001:certify-v2-13-release"),
      true,
    );
    assert.equal(result.state.work_ids.length, 26);
    assert.equal(called.at(-1), "certify-v2-13-release");
    assert.equal(preflights.length, 2);
    assert.equal(preflights[0].mode.initial, true);
    assert.deepEqual(preflights[0].priorOperationIds, []);
    assert.equal(preflights[1].mode.staged, true);
    assert.equal(
      preflights[1].priorOperationIds.includes("bootstrap-prequalification-database"),
      true,
    );
    assert.equal(preflights[1].priorOperationIds.includes("fresh-live-preflight"), true);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("invalid final certification evidence leaves the run non-certified and cleanup-only", async () => {
  const fixture = stateFixture();
  let certificationCalls = 0;
  try {
    await assert.rejects(
      executeFullLive({
        statePath: fixture.path,
        expectedStateSha256: fixture.sha256,
        runOperation: async (operation, state, priorResults) => {
          const result = fakeResult(operation, state, priorResults);
          if (operation.id === "certify-v2-13-release") {
            certificationCalls += 1;
            result.predecessorEvidenceSha256s = {
              ...result.predecessorEvidenceSha256s,
              "read-settled-billing": proof("9"),
            };
          }
          return result;
        },
      }),
      /RELEASE_CERTIFICATION_READBACK/u,
    );
    const state = JSON.parse(readFileSync(fixture.path, "utf8"));
    assert.equal(certificationCalls, 1);
    assert.equal(state.state, "CONSUMED_SINGLE_EXECUTION_CLEANUP_ONLY");
    assert.notEqual(state.cleanup_proof, null);
    assert.equal(state.cleanup_proof.cleanup_work_ids.length, 4);
    assert.equal(state.release_certification.state, "AUTHORIZED_ONCE_RECONCILIATION_ONLY");

    let resumedCertificationCalls = 0;
    const resumed = await executeFullLive({
      statePath: fixture.path,
      expectedStateSha256: hash(readFileSync(fixture.path)),
      runOperation: async (operation, state, priorResults) => {
        if (operation.id === "certify-v2-13-release") resumedCertificationCalls += 1;
        return fakeResult(operation, state, priorResults);
      },
    });
    assert.equal(resumedCertificationCalls, 0);
    assert.equal(resumed.state.state, "CONSUMED_SINGLE_EXECUTION_CLEANUP_COMPLETE_NO_RETRY");
    assert.equal(resumed.state.cleanup_proof.cleanup_work_ids.length, 4);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("throwing local certification preserves cleanup proof and restart completes without retry", async () => {
  const fixture = stateFixture();
  try {
    await assert.rejects(
      executeFullLive({
        statePath: fixture.path,
        expectedStateSha256: fixture.sha256,
        runOperation: async (operation, state, priorResults) => {
          if (operation.id === "certify-v2-13-release")
            throw new Error("local certification interrupted");
          return fakeResult(operation, state, priorResults);
        },
      }),
      /local certification interrupted/u,
    );
    const interrupted = JSON.parse(readFileSync(fixture.path, "utf8"));
    assert.equal(interrupted.state, "CONSUMED_SINGLE_EXECUTION_CLEANUP_ONLY");
    assert.equal(interrupted.cleanup_proof.cleanup_work_ids.length, 4);
    assert.equal(interrupted.release_certification.state, "AUTHORIZED_ONCE_RECONCILIATION_ONLY");

    let calls = 0;
    const resumed = await executeFullLive({
      statePath: fixture.path,
      expectedStateSha256: hash(readFileSync(fixture.path)),
      runOperation: async () => {
        calls += 1;
        throw new Error("no operation may restart after certification ambiguity");
      },
    });
    assert.equal(calls, 0);
    assert.equal(resumed.state.state, "CONSUMED_SINGLE_EXECUTION_CLEANUP_COMPLETE_NO_RETRY");
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("crash after certification side effect resumes one exact readback and never persists again", async () => {
  const fixture = stateFixture();
  const crashStatePath = join(fixture.directory, "certification-crash-state.json");
  let initialCertificationCalls = 0;
  try {
    await assert.rejects(
      executeFullLive({
        statePath: fixture.path,
        expectedStateSha256: fixture.sha256,
        runOperation: async (operation, state, priorResults, _sha256, context) => {
          if (operation.id === "certify-v2-13-release") {
            initialCertificationCalls += 1;
            assert.equal(context.reconciliationOnly, false);
            assert.equal(state.release_certification.state, "AUTHORIZED_ONCE_RECONCILIATION_ONLY");
            writeFileSync(crashStatePath, readFileSync(fixture.path), { mode: 0o600 });
            throw new Error("simulated process death after certification persistence");
          }
          return fakeResult(operation, state, priorResults);
        },
      }),
      /simulated process death/u,
    );
    assert.equal(initialCertificationCalls, 1);

    let reconciliationReads = 0;
    const resumed = await executeFullLive({
      statePath: crashStatePath,
      expectedStateSha256: hash(readFileSync(crashStatePath)),
      runOperation: async (operation, state, priorResults, _sha256, context) => {
        assert.equal(operation.id, "certify-v2-13-release");
        reconciliationReads += 1;
        assert.equal(context.resumed, true);
        assert.equal(context.authorizedUnsettled, true);
        assert.equal(context.reconciliationOnly, true);
        assert.equal(context.providerDispatchForbidden, true);
        assert.equal(context.persistenceForbidden, true);
        assert.equal(context.dispatchForbidden, true);
        assert.equal(state.release_certification.state, "AUTHORIZED_ONCE_RECONCILIATION_ONLY");
        return fakeResult(operation, state, priorResults);
      },
    });
    assert.equal(initialCertificationCalls, 1);
    assert.equal(reconciliationReads, 1);
    assert.equal(resumed.state.state, "CONSUMED_SINGLE_EXECUTION_COMPLETE");
    assert.equal(resumed.state.release_certification.state, "SETTLED_TERMINAL");
    assert.equal(resumed.state.cleanup_proof.cleanup_work_ids.length, 4);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("trusted time is checked immediately before local certification", async () => {
  const fixture = stateFixture();
  const events = [];
  try {
    const result = await executeFullLiveRaw({
      statePath: fixture.path,
      expectedStateSha256: fixture.sha256,
      verifyMaterializationSeed: async (_state, _sha256, context) => {
        if (context?.localCertification === true) events.push("certification-seed");
        return true;
      },
      verifyStaticReleaseDescriptor: async () => true,
      trustedTime: async () => {
        events.push("trusted-time");
        return "2026-08-26T12:00:00.000Z";
      },
      runOperation: async (operation, state, priorResults) => {
        if (operation.id === "certify-v2-13-release") events.push("certification-call");
        return fakeResult(operation, state, priorResults);
      },
    });
    assert.equal(result.state.state, "CONSUMED_SINGLE_EXECUTION_COMPLETE");
    assert.deepEqual(events.slice(-3), [
      "certification-seed",
      "trusted-time",
      "certification-call",
    ]);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("expiry immediately before certification closes release and preserves cleanup completion", async () => {
  const fixture = stateFixture();
  let trustedReads = 0;
  let certificationCalls = 0;
  try {
    await assert.rejects(
      executeFullLiveRaw({
        statePath: fixture.path,
        expectedStateSha256: fixture.sha256,
        verifyMaterializationSeed: async () => true,
        verifyStaticReleaseDescriptor: async () => true,
        trustedTime: async (state) => {
          trustedReads += 1;
          return state.cleanup_proof !== null
            ? "2026-08-27T00:00:00.001Z"
            : "2026-08-26T12:00:00.000Z";
        },
        runOperation: async (operation, state, priorResults) => {
          if (operation.id === "certify-v2-13-release") certificationCalls += 1;
          return fakeResult(operation, state, priorResults);
        },
      }),
      /TRUSTED_TIME_EXPIRED_OR_FORGED/u,
    );
    const interrupted = JSON.parse(readFileSync(fixture.path, "utf8"));
    assert.ok(trustedReads >= 2);
    assert.equal(certificationCalls, 0);
    assert.equal(interrupted.state, "CONSUMED_SINGLE_EXECUTION_CLEANUP_ONLY");
    assert.equal(interrupted.cleanup_proof.cleanup_work_ids.length, 4);
    assert.equal(interrupted.release_certification, null);
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
    assert.equal(result.state.cleanup_proof.cleanup_work_ids.length, 4);
    assert.equal(called.includes("soulx-live-qualification"), false);
    assert.deepEqual(called.slice(-4), [
      "restore-endpoints-max-one",
      "prove-zero-workers",
      "read-settled-billing",
      "reconcile-exact-resources",
    ]);
    assert.equal(called.includes("certify-v2-13-release"), false);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("authorized cleanup ambiguity resumes reconciliation only and never normal work", async () => {
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

    const reconciled = [];
    const resumed = await executeFullLive({
      statePath: fixture.path,
      expectedStateSha256: hash(readFileSync(fixture.path)),
      runOperation: async () => {
        throw new Error("normal runner forbidden during cleanup reconciliation");
      },
      runCleanupOperation: async (operation, state, priorResults, _sha256, mode) => {
        reconciled.push({ id: operation.id, mode });
        return fakeResult(operation, state, priorResults);
      },
    });
    assert.deepEqual(
      reconciled.map(({ id }) => id),
      ["prove-zero-workers", "read-settled-billing", "reconcile-exact-resources"],
    );
    assert.equal(reconciled[0].mode.authorizedUnsettled, true);
    assert.equal(reconciled[0].mode.reconciliationOnly, true);
    assert.equal(reconciled[0].mode.providerDispatchForbidden, true);
    assert.equal(
      reconciled.slice(1).every(({ mode }) => mode.cleanupOnly === true),
      true,
    );
    assert.equal(resumed.state.state, "CONSUMED_SINGLE_EXECUTION_CLEANUP_COMPLETE_NO_RETRY");
    assert.equal(resumed.state.cleanup_proof.cleanup_work_ids.length, 4);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("restart hydrates settled cleanup evidence and runs only unsettled cleanup work", async () => {
  const fixture = stateFixture();
  const firstCalled = [];
  let interruptAfterBilling = true;
  try {
    await assert.rejects(
      executeFullLive({
        statePath: fixture.path,
        expectedStateSha256: fixture.sha256,
        runOperation: async (operation, state, priorResults) => {
          firstCalled.push(operation.id);
          return fakeResult(operation, state, priorResults);
        },
        verifyChain: async (_state, _prior, context) => {
          if (interruptAfterBilling && context.operation.id === "read-settled-billing") {
            interruptAfterBilling = false;
            throw new Error("lost cleanup acknowledgement");
          }
        },
      }),
      /lost cleanup acknowledgement/u,
    );
    const interrupted = JSON.parse(readFileSync(fixture.path, "utf8"));
    const restore =
      interrupted.phases.cleanup_and_reconciliation.work[
        "v2-13-test-executor-0001:restore-endpoints-max-one"
      ];
    const prove =
      interrupted.phases.cleanup_and_reconciliation.work[
        "v2-13-test-executor-0001:prove-zero-workers"
      ];
    const billing =
      interrupted.phases.cleanup_and_reconciliation.work[
        "v2-13-test-executor-0001:read-settled-billing"
      ];
    assert.equal(restore.state, "SETTLED_TERMINAL");
    assert.equal(typeof restore.settled_result_sha256, "string");
    assert.equal(prove.state, "SETTLED_TERMINAL");
    assert.equal(billing.state, "SETTLED_TERMINAL");

    const resumedCalled = [];
    const resumed = await executeFullLive({
      statePath: fixture.path,
      expectedStateSha256: hash(readFileSync(fixture.path)),
      runOperation: async (operation, state, priorResults) => {
        resumedCalled.push(operation.id);
        return fakeResult(operation, state, priorResults);
      },
    });
    assert.deepEqual(resumedCalled, ["reconcile-exact-resources"]);
    assert.equal(resumed.state.state, "CONSUMED_SINGLE_EXECUTION_CLEANUP_COMPLETE_NO_RETRY");
    assert.equal(resumed.failed, true);
    assert.equal(firstCalled.includes("restore-endpoints-max-one"), true);
    assert.equal(firstCalled.includes("prove-zero-workers"), true);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("non-early cleanup restart verifies the bootstrap receipt before operator preflight", async () => {
  const fixture = stateFixture();
  let failQualification = true;
  let failCleanup = true;
  try {
    await assert.rejects(
      executeFullLive({
        statePath: fixture.path,
        expectedStateSha256: fixture.sha256,
        runOperation: async (operation, state, priorResults) => {
          if (operation.id === "mage-live-qualification" && failQualification) {
            failQualification = false;
            throw new Error("stop before cleanup restart test");
          }
          if (operation.id === "restore-endpoints-max-one" && failCleanup) {
            failCleanup = false;
            throw new Error("stop with verified operator");
          }
          return fakeResult(operation, state, priorResults);
        },
      }),
      /stop with verified operator/u,
    );
    const interrupted = JSON.parse(readFileSync(fixture.path, "utf8"));
    assert.equal(interrupted.state, "CONSUMED_SINGLE_EXECUTION_CLEANUP_ONLY");
    assert.equal(interrupted.operator_role_verified, true);
    const bootstrapWork =
      interrupted.phases.bootstrap_prequalification_database.work[
        "v2-13-test-executor-0001:bootstrap-prequalification-database"
      ];
    assert.equal(bootstrapWork.state, "SETTLED_TERMINAL");

    const events = [];
    const resumed = await executeFullLive({
      statePath: fixture.path,
      expectedStateSha256: hash(readFileSync(fixture.path)),
      verifyPrequalificationReceipt: async (_state, _sha256, mode, priorResults) => {
        events.push("receipt-db-reverify");
        assert.equal(mode.cleanupOnly, true);
        assert.equal(mode.earlyFailure, false);
        assert.equal(priorResults.has("bootstrap-prequalification-database"), true);
      },
      preflight: async (_state, _sha256, mode, priorResults) => {
        events.push("operator-runpod-protected-read");
        assert.equal(mode.operatorOnly, true);
        assert.equal(priorResults.has("bootstrap-prequalification-database"), true);
      },
      runOperation: async () => {
        throw new Error("normal runner forbidden during cleanup-only restart");
      },
      runCleanupOperation: async (operation, state, priorResults, _sha256, mode) => {
        assert.equal(mode.cleanupOnly, true);
        if (operation.id === "restore-endpoints-max-one") {
          assert.equal(mode.reconciliationOnly, true);
          assert.equal(mode.authorizedUnsettled, true);
        }
        return fakeResult(operation, state, priorResults);
      },
    });
    assert.deepEqual(events, ["receipt-db-reverify", "operator-runpod-protected-read"]);
    assert.equal(resumed.state.state, "CONSUMED_SINGLE_EXECUTION_CLEANUP_COMPLETE_NO_RETRY");
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

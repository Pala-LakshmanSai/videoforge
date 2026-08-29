import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { executeFullLive } from "../../deploy/v2-13/full-live-executor.mjs";
import {
  initialConsumptionRecord,
  writeExclusive,
} from "../../deploy/v2-13/full-live-orchestration-authority.mjs";
import { EXACT_PREDECESSOR_RELEASE_ATTEMPT } from "../../deploy/v2-13/validate-full-live-approval.mjs";

const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const proof = (character) => `sha256:${character.repeat(64)}`;

function stateFixture() {
  const directory = mkdtempSync(join(tmpdir(), "videoforge-cancellation-quiescence-"));
  chmodSync(directory, 0o700);
  const path = join(directory, "state.json");
  const authority = {
    authority_id: "v2-13-cancellation-quiescence-0001",
    full_live_authority_id: "11111111-1111-4111-8111-111111111111",
    materialization_seed_sha256: proof("a"),
    static_release_descriptor: {
      path: "project-context/evidence/acceptance/VF-10-13/static-release-descriptor.json",
      sha256: proof("d"),
    },
    outer_orchestration: {
      full_live_executor_path: "deploy/v2-13/full-live-executor.mjs",
      full_live_executor_sha256: sha256(readFileSync("deploy/v2-13/full-live-executor.mjs")),
    },
  };
  const validated = {
    proposalSha256: proof("1"),
    approvalSha256: proof("2"),
    proposalRecordCommit: "b".repeat(40),
    authorityRecordCommit: "c".repeat(40),
    approvalRecordPath: "evidence/user-approval.json",
    authorityRecordPath: "evidence/approved-authority.json",
    releaseSourceCommit: "a".repeat(40),
    executionControlCommit: "d".repeat(40),
    proposalSchema: "videoforge.v2-13-full-live-completion-proposal/v4",
    predecessorReleaseAttempt: EXACT_PREDECESSOR_RELEASE_ATTEMPT,
    fullLiveAuthorityId: authority.full_live_authority_id,
    approvedAt: "2026-08-26T00:00:00.000Z",
    expiresAt: "2026-08-27T00:00:00.000Z",
    staticReleaseDescriptorPath: authority.static_release_descriptor.path,
    staticReleaseDescriptorSha256: authority.static_release_descriptor.sha256,
  };
  writeExclusive(
    path,
    initialConsumptionRecord(
      authority,
      Buffer.from('{"authority":"quiescence-test"}\n'),
      validated,
    ),
  );
  return { directory, path, sha256: sha256(readFileSync(path)) };
}

function cleanupResult(operation) {
  const result = { actualUsd: 0 };
  if (operation.id === "restore-endpoints-max-one")
    Object.assign(result, {
      proofSha256: proof("b"),
      productionCleanupState: "ALL_ATTRIBUTABLE_PRODUCTION_ABSENT",
      productionResourcesAbsent: true,
      bothEndpointsMaxWorkersOne: false,
      retainedProductionEndpoints: 0,
    });
  if (operation.id === "prove-zero-workers")
    Object.assign(result, { proofSha256: proof("c"), zeroWorkers: true });
  if (operation.id === "read-settled-billing")
    Object.assign(result, { proofSha256: proof("d"), withinCumulativeCap: true });
  if (operation.id === "reconcile-exact-resources")
    Object.assign(result, { proofSha256: proof("e"), onlyApprovedRetainedVolumes: true });
  return result;
}

const execute = (options) =>
  executeFullLive({
    trustedTime: async () => "2026-08-26T12:00:00.000Z",
    verifyMaterializationSeed: async () => true,
    verifyStaticReleaseDescriptor: async () => true,
    ...options,
  });

test("cleanup waits for a delayed non-cooperative mutator to quiesce", async () => {
  const fixture = stateFixture();
  const controller = new AbortController();
  const order = [];
  let mutatorSettled = false;
  let cleanupStarted = false;
  let sideEffectAfterCleanup = false;
  try {
    const result = await execute({
      statePath: fixture.path,
      expectedStateSha256: fixture.sha256,
      cancellationSignal: controller.signal,
      runOperation: async (operation) => {
        assert.equal(operation.id, "release-tag-create");
        order.push("mutator-start");
        setImmediate(() => controller.abort());
        await new Promise((resolve) => setTimeout(resolve, 30));
        sideEffectAfterCleanup ||= cleanupStarted;
        order.push("mutator-side-effect");
        mutatorSettled = true;
        order.push("mutator-settled");
        return {
          actualUsd: 0,
          exactTagReady: true,
          targetCommit: "a".repeat(40),
          created: false,
          mutationPerformed: false,
        };
      },
      runCleanupOperation: async (operation) => {
        if (!cleanupStarted) {
          cleanupStarted = true;
          order.push("cleanup-start");
          assert.equal(mutatorSettled, true);
        }
        return cleanupResult(operation);
      },
    });
    assert.equal(result.failed, true);
    assert.equal(result.state.failure_code, "CANCELLATION_REQUESTED");
    assert.equal(sideEffectAfterCleanup, false);
    assert.ok(order.indexOf("mutator-settled") < order.indexOf("cleanup-start"));
    const work = Object.values(result.state.phases.publication.work);
    assert.equal(work.length, 1);
    assert.equal(work[0].state, "AUTHORIZED_ONCE_NOT_REDISPATCHABLE");
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("cooperative abort settles the active adapter before cleanup starts", async () => {
  const fixture = stateFixture();
  const controller = new AbortController();
  const order = [];
  let adapterTerminated = false;
  try {
    const result = await execute({
      statePath: fixture.path,
      expectedStateSha256: fixture.sha256,
      cancellationSignal: controller.signal,
      runOperation: async (_operation, _state, _prior, _outer, context) => {
        order.push("adapter-start");
        setImmediate(() => controller.abort());
        await new Promise((resolve) => {
          context.cancellationSignal.addEventListener("abort", resolve, { once: true });
        });
        adapterTerminated = true;
        order.push("adapter-abort-settled");
        throw new Error("cooperative child terminated");
      },
      runCleanupOperation: async (operation) => {
        if (!order.includes("cleanup-start")) {
          assert.equal(adapterTerminated, true);
          order.push("cleanup-start");
        }
        return cleanupResult(operation);
      },
    });
    assert.equal(result.failed, true);
    assert.equal(result.state.failure_code, "CANCELLATION_REQUESTED");
    assert.ok(order.indexOf("adapter-abort-settled") < order.indexOf("cleanup-start"));
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

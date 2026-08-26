#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  authorizeCleanupWork,
  authorizeWork,
  beginPhase,
  completeCleanupOnly,
  completePhase,
  enterCleanupOnly,
  recordCleanupProof,
  recordVerifiedReleaseRef,
  settleWork,
  settleCleanupWork,
  updateState,
  validateState,
} from "./full-live-orchestration-authority.mjs";
import {
  createConcreteFullLiveAdapters,
  preflightConcreteFullLiveInputs,
} from "./full-live-adapters.mjs";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const EXECUTOR_PATH = "deploy/v2-13/full-live-executor.mjs";
const EXECUTOR_SHA256 = `sha256:${createHash("sha256")
  .update(readFileSync(resolve(ROOT, EXECUTOR_PATH)))
  .digest("hex")}`;
const CONFIRMATION = "EXECUTE_EXACT_V2_13_FULL_LIVE_ONCE";
const HASH = /^sha256:[0-9a-f]{64}$/u;
const SOURCE_PINS = Object.freeze({
  "deploy/v2-13/full-live-adapters.mjs":
    "sha256:2d59c91bfcfd57e9b2f2ecfcdce2e85e4f288fe2dc63aedf7adcd86b14f10dea",
  "deploy/v2-13/promote-qualified-production.mjs":
    "sha256:efaf573c00109cc52ecedd617bebe48d03747d467f3ffc481fd6d2cb0d95ce66",
  "deploy/v2-13/guarded-activation.mjs":
    "sha256:8946676cae1ab8c414880e2d093fc8bbc957d97af6ee0f6a30ee052aea9bf8d0",
  "apps/web/src/server/providers/v213-full-live-cli.ts":
    "sha256:ec6c459294769a04d3126e37d4e2d94be1578095a2ec11bfd9221fc02a6f8123",
  "apps/web/src/server/providers/v213-runpod-dual-lane-transport.ts":
    "sha256:7d2ac27d25f6906aae1147833618e4a471ef0ca72f7ea6159ea993444ae53fe6",
  "packages/control-plane/migrations/0045_hosted_full_live_activation.sql":
    "sha256:fdb9c122c87603ff5f204a055eab902d41f362fec3be58d83be4ec088208b34d",
});
for (const [path, expected] of Object.entries(SOURCE_PINS)) {
  const actual = `sha256:${createHash("sha256")
    .update(readFileSync(resolve(ROOT, path)))
    .digest("hex")}`;
  if (actual !== expected) throw new Error(`V2_13_FULL_LIVE_EXECUTOR_SOURCE_DRIFT:${path}`);
}

// This is the only ordered live execution graph. A catalog entry is not executable until a
// concrete, reviewed adapter exists below. Missing adapters fail before authority consumption or
// any external action; arbitrary shell commands cannot be supplied at runtime.
const OPERATIONS = Object.freeze([
  { phase: "publication", id: "release-tag-create", reserveUsd: 0 },
  { phase: "publication", id: "release-tag-push", reserveUsd: 0 },
  { phase: "publication", id: "release-tag-readback", reserveUsd: 0 },
  { phase: "publication", id: "approval-commit-push", reserveUsd: 0 },
  { phase: "publication", id: "mage-image-workflow-dispatch", reserveUsd: 0 },
  { phase: "publication", id: "mage-image-workflow-verification", reserveUsd: 0 },
  { phase: "publication", id: "soulx-image-workflow-dispatch", reserveUsd: 0 },
  { phase: "publication", id: "soulx-image-workflow-verification", reserveUsd: 0 },
  { phase: "mage_qualification", id: "fresh-live-preflight", reserveUsd: 0 },
  { phase: "mage_qualification", id: "mage-live-qualification", reserveUsd: 4.5 },
  { phase: "soulx_qualification", id: "soulx-live-qualification", reserveUsd: 1 },
  {
    phase: "max_one_control_plane_and_guarded_activation",
    id: "create-exact-max-one-endpoints",
    reserveUsd: 0,
  },
  {
    phase: "max_one_control_plane_and_guarded_activation",
    id: "guarded-activation-once",
    reserveUsd: 0,
  },
  {
    phase: "max_one_control_plane_and_guarded_activation",
    id: "promote-qualified-production",
    reserveUsd: 0,
  },
  { phase: "v2_09_short_hosted_project", id: "v2-09-short-hosted-project", reserveUsd: 2 },
  {
    phase: "v2_10_operator_free_ranga_pilot",
    id: "v2-10-operator-free-ranga-pilot",
    reserveUsd: 2,
  },
  {
    phase: "v2_11_two_concurrent_owned_projects",
    id: "v2-11-two-concurrent-owned-projects",
    reserveUsd: 4,
  },
  { phase: "v2_12_long_output", id: "v2-12-long-output", reserveUsd: 2 },
  {
    phase: "v2_13_final_two_lane_smoke",
    id: "v2-13-final-two-lane-smoke",
    reserveUsd: 2,
  },
  { phase: "cleanup_and_reconciliation", id: "restore-endpoints-max-one", reserveUsd: 0 },
  { phase: "cleanup_and_reconciliation", id: "prove-zero-workers", reserveUsd: 0 },
  { phase: "cleanup_and_reconciliation", id: "read-settled-billing", reserveUsd: 0 },
  { phase: "cleanup_and_reconciliation", id: "reconcile-exact-resources", reserveUsd: 0 },
]);

// Guarded activation is real, but it cannot safely run before the preceding image, qualification,
// endpoint, and evidence adapters exist. Keep the closed-world live surface empty until all of the
// graph is callable and independently reviewed.
const CONCRETE_LIVE_ADAPTERS = createConcreteFullLiveAdapters();

const fail = (code, detail = "") => {
  throw new Error(`V2_13_FULL_LIVE_EXECUTOR_${code}${detail ? `:${detail}` : ""}`);
};

const eventId = (authorityId, operationId, suffix) =>
  `${authorityId}:${operationId}:${suffix}`.toLowerCase();

function missingConcreteTools(adapters = CONCRETE_LIVE_ADAPTERS) {
  return OPERATIONS.filter((operation) => typeof adapters[operation.id] !== "function").map(
    (operation) => operation.id,
  );
}

function assertResult(operation, result, state, results) {
  if (result === null || typeof result !== "object" || Array.isArray(result))
    fail("RESULT_CONTRACT", operation.id);
  if (
    typeof result.actualUsd !== "number" ||
    !Number.isFinite(result.actualUsd) ||
    result.actualUsd < 0 ||
    result.actualUsd > operation.reserveUsd
  )
    fail("RESULT_COST", operation.id);

  if (operation.id === "release-tag-create") {
    if (result.created !== true || result.targetCommit !== state.release_source_commit)
      fail("RELEASE_REF_CREATE", operation.id);
  }
  if (operation.id === "release-tag-push") {
    if (
      result.tagName !== state.release_ref.exact_tag_name ||
      result.targetCommit !== state.release_source_commit ||
      result.forceUsed !== false
    )
      fail("RELEASE_REF_PUSH", operation.id);
  }
  if (operation.id === "release-tag-readback") {
    if (
      result.tagName !== state.release_ref.exact_tag_name ||
      result.targetCommit !== state.release_ref.exact_target_commit
    )
      fail("RELEASE_REF_READBACK", operation.id);
  }
  if (operation.id === "approval-commit-push") {
    if (
      result.commit !== state.proposal_record_commit ||
      result.exactRemoteReadback !== true ||
      !/^[A-Za-z0-9._/-]{1,191}$/u.test(result.branch ?? "")
    )
      fail("APPROVAL_COMMIT_READBACK", operation.id);
  }
  if (operation.id.endsWith("image-workflow-dispatch")) {
    if (
      !/^[1-9][0-9]*$/u.test(String(result.runId ?? "")) ||
      result.headSha !== state.release_source_commit ||
      result.dispatchAccepted !== true
    )
      fail("WORKFLOW_DISPATCH_READBACK", operation.id);
  }
  if (operation.id.endsWith("image-workflow-verification")) {
    const dispatchId = operation.id.replace("verification", "dispatch");
    const dispatch = results.get(dispatchId);
    if (
      result.runId !== dispatch?.runId ||
      result.headSha !== state.release_source_commit ||
      !HASH.test(result.imageDigest ?? "") ||
      !HASH.test(result.evidenceSha256 ?? "") ||
      !HASH.test(result.publicManifestSha256 ?? "") ||
      result.publicAllBlobsVerified !== true ||
      result.conclusion !== "success"
    )
      fail("WORKFLOW_EVIDENCE_READBACK", operation.id);
  }
  if (operation.id === "fresh-live-preflight") {
    if (
      result.exactGpu !== "NVIDIA GeForce RTX 4090" ||
      result.region !== "EU-RO-1" ||
      !["LOW", "MEDIUM", "HIGH"].includes(result.availability) ||
      typeof result.flexUsdPerGpuHour !== "number" ||
      result.flexUsdPerGpuHour > 1.1 ||
      result.noFallback !== true ||
      !HASH.test(result.inventorySha256 ?? "") ||
      !HASH.test(result.billingBaselineSha256 ?? "")
    )
      fail("PREFLIGHT_READBACK", operation.id);
  }
  if (
    operation.id === "guarded-activation-once" &&
    (result.executedOnce !== true || !HASH.test(result.evidenceSha256 ?? ""))
  )
    fail("GUARDED_ACTIVATION_READBACK", operation.id);
  if (
    operation.id === "promote-qualified-production" &&
    (result.enabled !== true ||
      result.state !== "QUALIFIED_EXACT" ||
      result.providerSendPerformed !== false ||
      !HASH.test(result.evidenceSha256 ?? "") ||
      !HASH.test(result.versionSha256 ?? "") ||
      !HASH.test(result.databasePromotionSha256 ?? ""))
  )
    fail("QUALIFIED_PROMOTION_READBACK", operation.id);
  if (operation.id === "create-exact-max-one-endpoints") {
    if (
      result.createdExactTwoEndpoints !== true ||
      result.distinctEndpointIds !== true ||
      result.bothMaxWorkersOne !== true ||
      result.bothWorkersMinZero !== true ||
      !HASH.test(result.evidenceSha256 ?? "")
    )
      fail("MAX_ONE_ENDPOINT_READBACK", operation.id);
  }
  if (operation.phase.includes("qualification") && operation.id.includes("live-qualification")) {
    if (
      result.qualified !== true ||
      !HASH.test(result.evidenceSha256 ?? "") ||
      !HASH.test(result.deploymentSha256 ?? "") ||
      result.zeroWorkersAfter !== true
    )
      fail("QUALIFICATION_READBACK", operation.id);
  }
  if (operation.id.startsWith("v2-")) {
    if (
      result.accepted !== true ||
      result.terminal !== true ||
      !HASH.test(result.evidenceSha256 ?? "") ||
      result.zeroWorkersAfter !== true
    )
      fail("ACCEPTANCE_READBACK", operation.id);
  }
  if (
    operation.id === "v2-09-short-hosted-project" &&
    (result.durationSeconds < 30 || result.durationSeconds > 60)
  )
    fail("V2_09_DURATION", operation.id);
  if (
    operation.id === "v2-10-operator-free-ranga-pilot" &&
    (result.durationSeconds < 180 ||
      result.durationSeconds > 300 ||
      result.operatorIntervention !== false)
  )
    fail("V2_10_SCOPE", operation.id);
  if (
    operation.id === "v2-11-two-concurrent-owned-projects" &&
    (result.projectCount !== 2 || result.concurrent !== true || result.ownershipIsolated !== true)
  )
    fail("V2_11_SCOPE", operation.id);
  if (
    operation.id === "v2-12-long-output" &&
    (result.durationSeconds < 1740 || result.durationSeconds > 1860)
  )
    fail("V2_12_DURATION", operation.id);
  if (operation.id === "v2-13-final-two-lane-smoke" && result.twoLaneSmoke !== true)
    fail("V2_13_SCOPE", operation.id);
  return result;
}

function stateMutation(statePath, currentSha256, operation) {
  const updated = updateState(statePath, currentSha256, operation);
  return { state: updated.state, sha256: updated.sha256 };
}

async function executeFullLive({ statePath, expectedStateSha256, runOperation, preflight }) {
  if (typeof runOperation !== "function") fail("RUNNER_REQUIRED");
  let current = { state: null, sha256: expectedStateSha256 };
  const results = new Map();
  const first = OPERATIONS[0];
  if (!first) fail("EMPTY_GRAPH");
  current = stateMutation(statePath, current.sha256, (state) => {
    validateState(state);
    if (
      state.full_live_executor_path !== EXECUTOR_PATH ||
      state.full_live_executor_sha256 !== EXECUTOR_SHA256
    )
      fail("EXECUTOR_SOURCE_DRIFT");
    return state;
  });
  if (preflight !== undefined) {
    if (typeof preflight !== "function") fail("PREFLIGHT_CONTRACT");
    await preflight(structuredClone(current.state), current.sha256, {
      cleanupOnly: current.state.state === "CONSUMED_SINGLE_EXECUTION_CLEANUP_ONLY",
    });
  }

  const begin = (phase) => {
    current = stateMutation(statePath, current.sha256, (state) => beginPhase(state, phase));
  };
  const complete = (phase) => {
    current = stateMutation(statePath, current.sha256, (state) => completePhase(state, phase));
  };
  const runOne = async (operation) => {
    const workId = `${current.state.authority_id}:${operation.id}`.toLowerCase();
    current = stateMutation(statePath, current.sha256, (state) => {
      const event = eventId(state.authority_id, operation.id, "reserved");
      if (state.state === "CONSUMED_SINGLE_EXECUTION_CLEANUP_ONLY")
        return authorizeCleanupWork(state, { workId, eventId: event });
      return authorizeWork(state, {
        phaseName: operation.phase,
        workId,
        reservationUsd: operation.reserveUsd,
        eventId: event,
      });
    });
    // The reservation is durably written before this call. An ambiguous exit therefore leaves a
    // non-redispatchable work ID and can proceed only to cleanup.
    const raw = await runOperation(
      operation,
      structuredClone(current.state),
      new Map(results),
      current.sha256,
    );
    const result = assertResult(operation, raw, current.state, results);
    if (operation.id === "release-tag-readback") {
      current = stateMutation(statePath, current.sha256, (state) =>
        recordVerifiedReleaseRef(state, {
          tagName: result.tagName,
          targetCommit: result.targetCommit,
          eventId: eventId(state.authority_id, operation.id, "verified"),
        }),
      );
    }
    current = stateMutation(statePath, current.sha256, (state) => {
      const event = eventId(state.authority_id, operation.id, "settled");
      if (state.state === "CONSUMED_SINGLE_EXECUTION_CLEANUP_ONLY")
        return settleCleanupWork(state, { workId, eventId: event });
      return settleWork(state, {
        phaseName: operation.phase,
        workId,
        actualUsd: result.actualUsd,
        eventId: event,
      });
    });
    results.set(operation.id, result);
  };

  let activePhase = null;
  const resumedCleanupOnly = current.state.state === "CONSUMED_SINGLE_EXECUTION_CLEANUP_ONLY";
  if (!resumedCleanupOnly) {
    try {
      for (const operation of OPERATIONS.filter(
        (item) => item.phase !== "cleanup_and_reconciliation",
      )) {
        if (operation.phase !== activePhase) {
          if (activePhase !== null) complete(activePhase);
          begin(operation.phase);
          activePhase = operation.phase;
        }
        await runOne(operation);
      }
      if (activePhase !== null) complete(activePhase);
      begin("cleanup_and_reconciliation");
    } catch (error) {
      current = stateMutation(statePath, current.sha256, (state) =>
        enterCleanupOnly(state, {
          failureCode: "FULL_LIVE_OPERATION_FAILED",
          eventId: eventId(state.authority_id, "cleanup-entry", "failed"),
        }),
      );
      results.set("failure", { message: error instanceof Error ? error.message : String(error) });
    }
  }

  try {
    for (const operation of OPERATIONS.filter(
      (item) => item.phase === "cleanup_and_reconciliation",
    ))
      await runOne(operation);

    const zero = results.get("prove-zero-workers");
    const billing = results.get("read-settled-billing");
    const resources = results.get("reconcile-exact-resources");
    const maxOne = results.get("restore-endpoints-max-one");
    if (
      !HASH.test(zero?.proofSha256 ?? "") ||
      zero?.zeroWorkers !== true ||
      !HASH.test(billing?.proofSha256 ?? "") ||
      billing?.withinCumulativeCap !== true ||
      !HASH.test(resources?.proofSha256 ?? "") ||
      resources?.onlyApprovedRetainedVolumes !== true ||
      !HASH.test(maxOne?.proofSha256 ?? "") ||
      maxOne?.bothEndpointsMaxWorkersOne !== true
    )
      fail("CLEANUP_PROOF_READBACK");
    current = stateMutation(statePath, current.sha256, (state) =>
      recordCleanupProof(state, {
        zeroWorkerProofSha256: zero.proofSha256,
        billingProofSha256: billing.proofSha256,
        resourceProofSha256: resources.proofSha256,
        maxOneProofSha256: maxOne.proofSha256,
        eventId: eventId(state.authority_id, "cleanup-proof", "verified"),
      }),
    );
    current = stateMutation(statePath, current.sha256, (state) => {
      if (state.state === "CONSUMED_SINGLE_EXECUTION_CLEANUP_ONLY")
        return completeCleanupOnly(state);
      return completePhase(state, "cleanup_and_reconciliation");
    });
  } catch (error) {
    if (current.state.state === "CONSUMED_SINGLE_EXECUTION_IN_PROGRESS") {
      current = stateMutation(statePath, current.sha256, (state) =>
        enterCleanupOnly(state, {
          failureCode: "FULL_LIVE_CLEANUP_FAILED",
          eventId: eventId(state.authority_id, "cleanup-entry", "failed"),
        }),
      );
    }
    throw error;
  }
  return { ...current, results, failed: results.has("failure") };
}

function parseArgs(argv) {
  const args = new Map();
  let execute = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--execute") {
      execute = true;
      continue;
    }
    if (!token.startsWith("--") || index + 1 >= argv.length) fail("ARGUMENTS");
    args.set(token.slice(2), argv[index + 1]);
    index += 1;
  }
  return { args, execute };
}

async function main() {
  const { args, execute } = parseArgs(process.argv.slice(2));
  const gaps = missingConcreteTools();
  if (!execute) {
    process.stdout.write(
      `${JSON.stringify({ state: "NO_ACTION", external_calls: 0, mutations: 0, gpu_use: 0, spend_usd: 0, ordered_operations: OPERATIONS.map(({ phase, id, reserveUsd }) => ({ phase, id, reserve_usd: reserveUsd })), missing_concrete_tools: gaps })}\n`,
    );
    return;
  }
  if (args.get("confirm") !== CONFIRMATION) fail("CONFIRMATION");
  if (gaps.length > 0) fail("MISSING_CONCRETE_TOOLING", gaps.join(","));
  const statePath = resolve(ROOT, args.get("state-file") ?? "");
  const expectedStateSha256 = args.get("expected-state-sha256");
  if (!HASH.test(expectedStateSha256 ?? "")) fail("EXPECTED_STATE_SHA256");
  const result = await executeFullLive({
    statePath,
    expectedStateSha256,
    preflight: (state, _sha256, mode) =>
      preflightConcreteFullLiveInputs({ state, cleanupOnly: mode.cleanupOnly }),
    runOperation: async (operation, state, priorResults, outerStateSha256) =>
      CONCRETE_LIVE_ADAPTERS[operation.id](
        { ROOT, operation, state, priorResults, outerStateSha256 },
        state,
        priorResults,
        outerStateSha256,
      ),
  });
  process.stdout.write(
    `${JSON.stringify({ state_file: statePath, state_sha256: result.sha256, state: result.state.state, failed: result.failed })}\n`,
  );
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) await main();

export { CONFIRMATION, CONCRETE_LIVE_ADAPTERS, executeFullLive, missingConcreteTools, OPERATIONS };

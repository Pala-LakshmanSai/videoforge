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
  PHASES,
  recordCleanupProof,
  recordSettledResult,
  recordVerifiedReleaseRef,
  settleWork,
  settleCleanupWork,
  updateState,
  MATERIALIZATION_SEED_ENV,
  validateMaterializationSeedFile,
  validateState,
} from "./full-live-orchestration-authority.mjs";
import {
  createConcreteFullLiveAdapters,
  preflightConcreteFullLiveInputs,
  readAuthenticatedGithubTime,
  verifyPrequalificationDatabaseReceipt,
  verifyMaterializationChainFile,
} from "./full-live-adapters.mjs";
import { EXPECTED_SERVERLESS_FLEX_RATE_USD_PER_GPU_HOUR } from "./validate-full-live-approval.mjs";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const EXECUTOR_PATH = "deploy/v2-13/full-live-executor.mjs";
const EXECUTOR_SHA256 = `sha256:${createHash("sha256")
  .update(readFileSync(resolve(ROOT, EXECUTOR_PATH)))
  .digest("hex")}`;
const CONFIRMATION = "EXECUTE_EXACT_V2_13_FULL_LIVE_ONCE";
const HASH = /^sha256:[0-9a-f]{64}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PREQUALIFICATION_SCHEMA = "videoforge.v213-prequalification-database-bootstrap-result/v1";
const PREQUALIFICATION_RECOVERY_MODES = new Set([
  "FRESH_36_TO_45",
  "RESUME_EXACT_PREFIX",
  "VERIFIED_EXISTING_45",
]);
const SOURCE_PINS = Object.freeze({
  "deploy/v2-13/full-live-adapters.mjs":
    "sha256:0a2b929507609d0709cb0262b757e537576c3b9af192681548fd78a357ac5437",
  "deploy/v2-13/promote-qualified-production.mjs":
    "sha256:4151184dfa56dd687db22fbff378aed438f15d9fab2030b893b704ca7b67b6e0",
  "deploy/v2-13/guarded-activation.mjs":
    "sha256:1fc2d4b4b5246c6e0a6f407f7742f78acdca66723c60d2a0c1499e692a5162f7",
  "apps/web/src/server/providers/v213-full-live-cli.ts":
    "sha256:e9d369710ca75535b35b6c29123b595482fbddbd792b35e02ed40eb7ea6c28e6",
  "apps/web/src/server/providers/v213-runpod-dual-lane-transport.ts":
    "sha256:7d2ac27d25f6906aae1147833618e4a471ef0ca72f7ea6159ea993444ae53fe6",
  "packages/control-plane/migrations/0045_hosted_full_live_activation.sql":
    "sha256:fdb9c122c87603ff5f204a055eab902d41f362fec3be58d83be4ec088208b34d",
  "deploy/v2-13/neon-full-live-operator-grants.sql":
    "sha256:60922d36e5aeb05fe34705198967aa3adf20cdf9ec61283810a565b6690b2c39",
  "packages/control-plane/migrations/manifest.json":
    "sha256:93e793e66f8307681d494e9834debbc0458fd9ba04b55497be2b868fa2011baa",
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
  {
    phase: "bootstrap_prequalification_database",
    id: "bootstrap-prequalification-database",
    reserveUsd: 0,
  },
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
  {
    phase: "max_one_control_plane_and_guarded_activation",
    id: "record-workflow-start-authority",
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

export function assertResult(operation, result, state, results) {
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
      result.commit !== state.authority_record_commit ||
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
      !Number.isFinite(result.flexUsdPerGpuHour) ||
      result.flexUsdPerGpuHour < 0 ||
      result.flexUsdPerGpuHour > EXPECTED_SERVERLESS_FLEX_RATE_USD_PER_GPU_HOUR ||
      result.noFallback !== true ||
      !HASH.test(result.inventorySha256 ?? "") ||
      !HASH.test(result.billingBaselineSha256 ?? "")
    )
      fail("PREFLIGHT_READBACK", operation.id);
  }
  if (operation.id === "bootstrap-prequalification-database") {
    const bootstrapKeys = [
      "actualUsd",
      "application_secret_reads",
      "cloudflare_calls",
      "external_spend_usd",
      "gpu_use",
      "ledger_after_sha256",
      "ledger_before_count",
      "ledger_before_sha256",
      "operator_acl_sha256",
      "pgcrypto_sha256",
      "prequalification_database_bootstrap_sha256",
      "recovery_mode",
      "runpod_calls",
      "schema_version",
    ];
    if (
      JSON.stringify(Object.keys(result).sort()) !== JSON.stringify(bootstrapKeys.sort()) ||
      result.schema_version !== PREQUALIFICATION_SCHEMA ||
      !Number.isInteger(result.ledger_before_count) ||
      ![36, 37, 38, 39, 40, 41, 42, 43, 44, 45].includes(result.ledger_before_count) ||
      !HASH.test(result.ledger_after_sha256 ?? "") ||
      !HASH.test(result.ledger_before_sha256 ?? "") ||
      !HASH.test(result.operator_acl_sha256 ?? "") ||
      !HASH.test(result.pgcrypto_sha256 ?? "") ||
      !HASH.test(result.prequalification_database_bootstrap_sha256 ?? "") ||
      !PREQUALIFICATION_RECOVERY_MODES.has(result.recovery_mode) ||
      result.runpod_calls !== 0 ||
      result.cloudflare_calls !== 0 ||
      result.application_secret_reads !== 0 ||
      result.gpu_use !== false ||
      result.external_spend_usd !== 0
    )
      fail("PREQUALIFICATION_DATABASE_BOOTSTRAP_READBACK", operation.id);
    if (
      (result.recovery_mode === "FRESH_36_TO_45" && result.ledger_before_count !== 36) ||
      (result.recovery_mode === "RESUME_EXACT_PREFIX" &&
        ![37, 38, 39, 40, 41, 42, 43, 44].includes(result.ledger_before_count)) ||
      (result.recovery_mode === "VERIFIED_EXISTING_45" && result.ledger_before_count !== 45)
    )
      fail("PREQUALIFICATION_RECOVERY_MODE", operation.id);
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
  if (operation.id === "record-workflow-start-authority") {
    if (
      JSON.stringify(Object.keys(result).sort()) !==
        JSON.stringify(["actualUsd", "authorityId", "expiresAt", "tokenSha256"].sort()) ||
      !UUID.test(result.authorityId ?? "") ||
      !HASH.test(result.tokenSha256 ?? "") ||
      typeof result.expiresAt !== "string" ||
      Number.isNaN(Date.parse(result.expiresAt))
    )
      fail("WORKFLOW_START_AUTHORITY_READBACK", operation.id);
  }
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

async function executeFullLive({
  statePath,
  expectedStateSha256,
  runOperation,
  runCleanupOperation,
  runEarlyCleanupOperation,
  preflight,
  trustedTime,
  loadSettledResult,
  verifyMaterializationChain,
  verifyChain,
  verifyMaterializationSeed,
  verifyPrequalificationReceipt,
}) {
  if (typeof runOperation !== "function") fail("RUNNER_REQUIRED");
  if (typeof trustedTime !== "function") fail("TRUSTED_TIME_REQUIRED");
  if (runCleanupOperation !== undefined && typeof runCleanupOperation !== "function")
    fail("CLEANUP_RUNNER_CONTRACT");
  if (runEarlyCleanupOperation !== undefined && typeof runEarlyCleanupOperation !== "function")
    fail("EARLY_CLEANUP_RUNNER_CONTRACT");
  if (preflight !== undefined && typeof preflight !== "function") fail("PREFLIGHT_CONTRACT");
  if (loadSettledResult !== undefined && typeof loadSettledResult !== "function")
    fail("SETTLED_RESULT_LOADER_CONTRACT");
  const chainVerifier = verifyMaterializationChain ?? verifyChain;
  if (chainVerifier !== undefined && typeof chainVerifier !== "function")
    fail("CHAIN_VERIFIER_CONTRACT");
  if (typeof verifyMaterializationSeed !== "function")
    fail("MATERIALIZATION_SEED_VERIFIER_REQUIRED");
  if (
    verifyPrequalificationReceipt !== undefined &&
    typeof verifyPrequalificationReceipt !== "function"
  )
    fail("PREQUALIFICATION_RECEIPT_VERIFIER_CONTRACT");
  let current = { state: null, sha256: expectedStateSha256 };
  const results = new Map();
  // A settled bootstrap receipt is the durable boundary proving the operator role/ACL.  Do not
  // infer that boundary from whether the initial preflight happened: bootstrap can fail after
  // preflight, and a restarted process must derive it from settled work only.
  let operatorRoleVerified = false;
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
  operatorRoleVerified = current.state.operator_role_verified === true;
  if (
    [
      "CONSUMED_SINGLE_EXECUTION_COMPLETE",
      "CONSUMED_SINGLE_EXECUTION_CLEANUP_COMPLETE_NO_RETRY",
    ].includes(current.state.state)
  )
    fail("NOT_IN_PROGRESS");

  const verifySeed = async (context = {}) => {
    const result = await verifyMaterializationSeed(
      structuredClone(current.state),
      current.sha256,
      structuredClone(context),
    );
    if (result === false) fail("MATERIALIZATION_SEED_VERIFICATION", context.operationId ?? "");
  };
  await verifySeed({
    restart:
      current.state.current_phase_index > 0 ||
      current.state.state !== "CONSUMED_SINGLE_EXECUTION_IN_PROGRESS",
    recovery: current.state.state === "CONSUMED_SINGLE_EXECUTION_CLEANUP_ONLY",
  });

  const begin = (phase) => {
    current = stateMutation(statePath, current.sha256, (state) => beginPhase(state, phase));
  };
  const complete = (phase) => {
    current = stateMutation(statePath, current.sha256, (state) => completePhase(state, phase));
  };

  const workIdFor = (operation, state = current.state) =>
    `${state.authority_id}:${operation.id}`.toLowerCase();
  const workFor = (operation, state = current.state) =>
    state.phases[operation.phase]?.work?.[workIdFor(operation, state)];
  const isSettled = (operation, state = current.state) =>
    workFor(operation, state)?.state === "SETTLED_TERMINAL";

  const durableResult = (value) => {
    if (value === null || typeof value !== "object" || Array.isArray(value))
      fail("RESULT_CONTRACT");
    try {
      const parsed = JSON.parse(JSON.stringify(value));
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
        fail("RESULT_CONTRACT");
      return parsed;
    } catch {
      fail("RESULT_NOT_SERIALIZABLE");
    }
  };

  const checkTrustedTime = async () => {
    const trustedIso = await trustedTime(structuredClone(current.state));
    const trustedMs = Date.parse(trustedIso ?? "");
    if (
      Number.isNaN(trustedMs) ||
      trustedMs < Date.parse(current.state.approved_at) ||
      trustedMs > Date.parse(current.state.expires_at)
    )
      fail("TRUSTED_TIME_EXPIRED_OR_FORGED");
  };

  let earlyCleanupFailure = false;

  const verifyChainAtBoundary = async (operation, boundary) => {
    if (chainVerifier === undefined) return;
    await chainVerifier(structuredClone(current.state), new Map(results), {
      operation: structuredClone(operation),
      boundary,
      outerStateSha256: current.sha256,
      settledResultSha256:
        current.state.phases[operation.phase]?.work?.[workIdFor(operation)]?.settled_result_sha256,
      earlyFailure:
        current.state.state === "CONSUMED_SINGLE_EXECUTION_CLEANUP_ONLY" &&
        operatorRoleVerified !== true,
    });
  };

  // Rebuild the in-memory predecessor map in graph order before any resumed adapter is called.
  // Settled work is terminal: a missing durable result is a hard stop, never a reason to invoke
  // the adapter again. A deployment may provide a separate read-only result store for states
  // written by an older executor that did not embed the result, but it must return the exact
  // operation result and is persisted back through the state CAS below.
  const hydrateSettledResults = async () => {
    for (const operation of OPERATIONS) {
      const existing = workFor(operation);
      if (existing?.state !== "SETTLED_TERMINAL") continue;
      let prior = existing.settled_result;
      if (prior === undefined && loadSettledResult !== undefined) {
        prior = await loadSettledResult({
          operation: structuredClone(operation),
          state: structuredClone(current.state),
          workId: workIdFor(operation),
          work: structuredClone(existing),
          outerStateSha256: current.sha256,
        });
        prior = durableResult(prior);
        const loaded = assertResult(operation, prior, current.state, results);
        current = stateMutation(statePath, current.sha256, (state) =>
          recordSettledResult(state, {
            phaseName: operation.phase,
            workId: workIdFor(operation),
            result: loaded,
          }),
        );
        prior = loaded;
      }
      if (prior === undefined) fail("SETTLED_RESULT_UNAVAILABLE", operation.id);
      const result = assertResult(operation, durableResult(prior), current.state, results);
      if (
        operation.id === "bootstrap-prequalification-database" &&
        current.state.operator_role_verified !== true
      ) {
        current = stateMutation(statePath, current.sha256, (state) =>
          recordSettledResult(state, {
            phaseName: operation.phase,
            workId: workIdFor(operation),
            result,
          }),
        );
      }
      results.set(operation.id, result);
      operatorRoleVerified = current.state.operator_role_verified === true;
      await verifyChainAtBoundary(operation, "hydrated");
    }
  };

  const runOne = async (operation) => {
    const workId = workIdFor(operation);
    const existing = workFor(operation);
    await verifySeed({
      operationId: operation.id,
      resumed: existing !== undefined,
      recovery: current.state.state === "CONSUMED_SINGLE_EXECUTION_CLEANUP_ONLY",
    });
    if (existing?.state === "SETTLED_TERMINAL") {
      let prior = results.get(operation.id) ?? existing.settled_result;
      if (prior === undefined && loadSettledResult !== undefined) {
        prior = await loadSettledResult({
          operation: structuredClone(operation),
          state: structuredClone(current.state),
          workId,
          work: structuredClone(existing),
          outerStateSha256: current.sha256,
        });
        prior = durableResult(prior);
        const loaded = assertResult(operation, prior, current.state, results);
        current = stateMutation(statePath, current.sha256, (state) =>
          recordSettledResult(state, { phaseName: operation.phase, workId, result: loaded }),
        );
        prior = loaded;
      }
      if (prior === undefined) fail("SETTLED_RESULT_UNAVAILABLE", operation.id);
      const result = assertResult(operation, durableResult(prior), current.state, results);
      if (
        operation.id === "bootstrap-prequalification-database" &&
        current.state.operator_role_verified !== true
      ) {
        current = stateMutation(statePath, current.sha256, (state) =>
          recordSettledResult(state, { phaseName: operation.phase, workId, result }),
        );
      }
      results.set(operation.id, result);
      operatorRoleVerified = current.state.operator_role_verified === true;
      await verifyChainAtBoundary(operation, "settled");
      return result;
    }
    if (existing?.state === "AUTHORIZED_ONCE_NOT_REDISPATCHABLE")
      fail("REDISPATCH_FORBIDDEN", operation.id);
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
    const cleanupOnly = current.state.state === "CONSUMED_SINGLE_EXECUTION_CLEANUP_ONLY";
    const earlyCleanup = cleanupOnly && !operatorRoleVerified;
    const runner =
      earlyCleanup && runEarlyCleanupOperation !== undefined
        ? runEarlyCleanupOperation
        : cleanupOnly && runCleanupOperation !== undefined
          ? runCleanupOperation
          : runOperation;
    const executionContext = {
      operationId: operation.id,
      cleanupOnly,
      earlyFailure: earlyCleanup,
      endpointFree: earlyCleanup,
      operatorRoleVerified,
      resumed: existing !== undefined,
    };
    const raw = await runner(
      operation,
      structuredClone(current.state),
      new Map(results),
      current.sha256,
      executionContext,
    );
    const result = assertResult(operation, durableResult(raw), current.state, results);
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
        return settleCleanupWork(state, { workId, eventId: event, result });
      return settleWork(state, {
        phaseName: operation.phase,
        workId,
        actualUsd: result.actualUsd,
        eventId: event,
        result,
      });
    });
    operatorRoleVerified = current.state.operator_role_verified === true;
    results.set(operation.id, result);
    await verifyChainAtBoundary(operation, "settled");
    return result;
  };

  const resumedCleanupOnly = current.state.state === "CONSUMED_SINGLE_EXECUTION_CLEANUP_ONLY";
  if (resumedCleanupOnly) {
    // Hydrate before selecting the cleanup seam.  A restart must not widen a cleanup-only child
    // merely because its in-memory predecessor map started empty.
    await hydrateSettledResults();
    earlyCleanupFailure = !operatorRoleVerified;
  }
  if (!resumedCleanupOnly) {
    try {
      await hydrateSettledResults();
      if (preflight !== undefined)
        await preflight(
          structuredClone(current.state),
          current.sha256,
          {
            cleanupOnly: false,
            earlyFailure: false,
            endpointFree: false,
            operatorRoleVerified,
            bootstrapOnly: true,
            operatorOnly: false,
            initial: true,
            staged: false,
            requireEndpointSecrets: false,
          },
          new Map(results),
        );
      const normalPhases = [
        ...new Set(
          OPERATIONS.filter((operation) => operation.phase !== "cleanup_and_reconciliation").map(
            (operation) => operation.phase,
          ),
        ),
      ];
      for (const phaseName of normalPhases) {
        const phase = current.state.phases[phaseName];
        if (phase?.state === "COMPLETE") continue;
        const expectedPhaseIndex = PHASES.findIndex(([name]) => name === phaseName);
        if (
          expectedPhaseIndex < 0 ||
          current.state.current_phase_index !== expectedPhaseIndex ||
          !phase
        )
          fail("PHASE_ORDER");
        if (phase.state === "PENDING") begin(phaseName);
        else if (phase.state !== "ACTIVE") fail("PHASE_ORDER");
        for (const operation of OPERATIONS.filter((item) => item.phase === phaseName)) {
          if (!isSettled(operation)) await checkTrustedTime();
          await runOne(operation);
          if (operation.id === "fresh-live-preflight" && preflight !== undefined) {
            await checkTrustedTime();
            await preflight(
              structuredClone(current.state),
              current.sha256,
              {
                cleanupOnly: false,
                earlyFailure: false,
                endpointFree: false,
                operatorRoleVerified,
                bootstrapOnly: false,
                operatorOnly: false,
                initial: false,
                staged: true,
                requireEndpointSecrets: false,
              },
              new Map(results),
            );
          }
        }
        if (current.state.phases[phaseName].state === "ACTIVE") complete(phaseName);
      }
      const cleanupPhase = current.state.phases.cleanup_and_reconciliation;
      if (cleanupPhase.state === "PENDING") begin("cleanup_and_reconciliation");
      else if (cleanupPhase.state !== "ACTIVE") fail("PHASE_ORDER");
    } catch (error) {
      if (current.state.state === "CONSUMED_SINGLE_EXECUTION_IN_PROGRESS") {
        earlyCleanupFailure = !operatorRoleVerified;
        current = stateMutation(statePath, current.sha256, (state) =>
          enterCleanupOnly(state, {
            failureCode: "FULL_LIVE_OPERATION_FAILED",
            eventId: eventId(state.authority_id, "cleanup-entry", "failed"),
          }),
        );
        results.set("failure", { message: error instanceof Error ? error.message : String(error) });
      } else throw error;
    }
  } else {
    // An unverified bootstrap restart must enter the request+RunPod-only child directly.  The
    // normal cleanup preflight reads the operator DSN (and may inspect materialized input); both
    // are unavailable by contract until the bootstrap result has settled and been hydrated.
    if (preflight !== undefined && !earlyCleanupFailure) {
      const mode = {
        cleanupOnly: true,
        earlyFailure: earlyCleanupFailure,
        endpointFree: earlyCleanupFailure,
        operatorRoleVerified,
        bootstrapOnly: false,
        operatorOnly: true,
        initial: true,
        staged: false,
        requireEndpointSecrets: false,
      };
      if (verifyPrequalificationReceipt !== undefined)
        await verifyPrequalificationReceipt(
          structuredClone(current.state),
          current.sha256,
          mode,
          new Map(results),
        );
      await preflight(structuredClone(current.state), current.sha256, mode, new Map(results));
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
  return {
    ...current,
    results,
    failed:
      results.has("failure") ||
      current.state.state === "CONSUMED_SINGLE_EXECUTION_CLEANUP_COMPLETE_NO_RETRY",
  };
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
  const runConcreteOperation = async (
    operation,
    state,
    priorResults,
    outerStateSha256,
    executionContext,
  ) =>
    CONCRETE_LIVE_ADAPTERS[operation.id](
      { ROOT, operation, state, priorResults, outerStateSha256, ...executionContext },
      state,
      priorResults,
      outerStateSha256,
      executionContext,
    );
  const result = await executeFullLive({
    statePath,
    expectedStateSha256,
    preflight: async (state, _sha256, mode, priorResults) => {
      if (mode.staged === true)
        await verifyPrequalificationDatabaseReceipt({
          environment: process.env,
          priorResults,
        });
      return preflightConcreteFullLiveInputs({
        state,
        cleanupOnly: mode.cleanupOnly,
        bootstrapOnly: mode.bootstrapOnly === true,
        operatorOnly: mode.operatorOnly === true,
        requireEndpointSecrets: mode.requireEndpointSecrets === true,
        allowUnmaterializedProductionInput: true,
      });
    },
    trustedTime: () => readAuthenticatedGithubTime(),
    runOperation: runConcreteOperation,
    runCleanupOperation: runConcreteOperation,
    runEarlyCleanupOperation: runConcreteOperation,
    verifyMaterializationSeed: (state) =>
      validateMaterializationSeedFile({
        path: process.env[MATERIALIZATION_SEED_ENV],
        expectedSha256: state.materialization_seed_sha256,
      }),
    verifyPrequalificationReceipt: async (_state, _outerStateSha256, _mode, priorResults) =>
      verifyPrequalificationDatabaseReceipt({
        environment: process.env,
        priorResults,
      }),
    verifyMaterializationChain: (state, priorResults, context) =>
      verifyMaterializationChainFile({
        environment: process.env,
        state,
        priorResults,
        operation: context.operation,
        earlyFailure: context.earlyFailure === true,
      }),
  });
  process.stdout.write(
    `${JSON.stringify({ state_file: statePath, state_sha256: result.sha256, state: result.state.state, failed: result.failed })}\n`,
  );
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) await main();

export { CONFIRMATION, CONCRETE_LIVE_ADAPTERS, executeFullLive, missingConcreteTools, OPERATIONS };

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  COMBINED_AUTHORITY_SCHEMA,
  COMBINED_EXECUTION_SCHEMA,
  STAGED_OPERATION_IDS,
  STAGED_RECEIPTS_SCHEMA,
  executeCombinedQualifiedProductionForTest,
  executeCombinedQualifiedProductionWithDependenciesForTest,
  createDurableOuterState,
} from "./execute-combined-qualified-production.mjs";
import {
  COMPLETION_CAP_USD,
  INCREMENTAL_CAP_USD,
  OPERATION_IDS,
  QUALIFIED_LANES,
} from "./execute-qualified-production.mjs";

const SOURCE = "7".repeat(40);
const NOW = new Date("2026-09-07T10:00:00.000Z");
const hash = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const canonical = (value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
};
const signed = (value) => ({ ...value, receipt_sha256: hash(canonical(value)) });
const durableBaseline = (observedAt = "2026-09-07T10:00:00.000Z") => {
  const value = {
    schemaVersion: "videoforge.v2-09-global-completion-baseline/v1",
    accountCount: 1,
    workspaceCount: 1,
    attemptCount: 1,
    settledNetMicroUsd: 4_250_000,
    openReservationMicroUsd: 0,
    reportedUnsettledMicroUsd: 0,
    completionBaselineMicroUsd: 4_250_000,
    maximumCompletionBaselineMicroUsd: 15_500_000,
    derivation: "ALL_PROJECT_ATTEMPTS_SETTLED_PLUS_MAX_OPEN_RESERVATION_OR_REPORTED_ONCE",
    observedAt,
  };
  return { ...value, receiptSha256: hash(canonical(value)) };
};
const tenantBaseline = (observedAt = "2026-09-07T10:02:00.000Z") => {
  const value = {
    schemaVersion: "videoforge.v2-09-completion-baseline/v1",
    accountId: "11111111-1111-4111-8111-111111111111",
    workspaceId: "22222222-2222-4222-8222-222222222222",
    attemptCount: 1,
    settledNetMicroUsd: 4_250_000,
    openReservationMicroUsd: 0,
    reportedUnsettledMicroUsd: 0,
    completionBaselineMicroUsd: 4_250_000,
    maximumCompletionBaselineMicroUsd: 15_500_000,
    derivation: "GENERIC_PROJECT_ATTEMPT_SETTLED_PLUS_MAX_OPEN_RESERVATION_OR_REPORTED_ONCE",
    observedAt,
  };
  return { ...value, receiptSha256: hash(canonical(value)) };
};

function authority() {
  return {
    schema_version: COMBINED_AUTHORITY_SCHEMA,
    authority_id: "v2-09-combined-test-authority",
    proposal_sha256: hash("outer-proposal"),
    source_commit: SOURCE,
    issued_at: "2026-09-07T09:00:00.000Z",
    expires_at: "2026-09-07T12:00:00.000Z",
    single_use: true,
    execution: "V2_09_PREFLIGHT_THEN_QUALIFIED_PRODUCTION_ONCE",
    caps: {
      max_incremental_usd: INCREMENTAL_CAP_USD,
      max_completion_usd: COMPLETION_CAP_USD,
    },
    credential_reads: {
      database_operator_url_exact: 1,
      database_owner_url_exact: 1,
      preflight_runpod_api_key_exact: 1,
      staging_protected_snapshot_max: 2,
      receipt_derivation_protected_snapshot_exact: 1,
      inner_protected_snapshot_max: 2,
    },
    media_worker_inputs: {
      release: "0.1.15",
      execution_bundle_sha256: hash("media-bundle"),
      whisper_model_sha256: hash("whisper"),
      materialization_mode: "PREAUTHORIZED_STAGED_ONCE",
    },
    job_limits: {
      chrome_e2e_runs: 1,
      generation_requests: 1,
      redispatches: 0,
      stage_6_jobs: 0,
      stage_7_jobs: 0,
    },
    offering: {
      gpu: "NVIDIA GeForce RTX 4090",
      region: "EU-RO-1",
      availability_floor: "LOW",
      max_rate_usd_per_gpu_hour: 1.116,
    },
    frozen_lanes: QUALIFIED_LANES.map((lane) => ({ ...lane })),
    production_inputs: {
      worker_name: "videoforge-production-runtime",
      chrome_bootstrap_plan_sha256: hash("chrome-plan"),
      materialization_input_sha256: hash("materialization-input"),
      secret_allowlist_sha256: hash("allowlist"),
      secret_count: 22,
    },
    operations: [...OPERATION_IDS],
  };
}

function preflight(value = authority()) {
  const unsigned = {
    schemaVersion: "videoforge.v209-read-only-preflight/v1",
    checkpoint: "V2-09",
    checkedAt: "2026-09-07T10:00:00.000Z",
    expectedCleanSource: SOURCE,
    authority: {
      credentialReads: 1,
      databaseCalls: 0,
      externalSpendUsd: 0,
      gpuJobs: 0,
      providerMutations: 0,
      r2Calls: 0,
      runpodJobPosts: 0,
      stage6Reruns: 0,
      stage7Reruns: 0,
    },
    images: value.frozen_lanes.map((lane, index) => ({
      lane: index === 0 ? "mage_image" : "soulx_avatar",
      manifestDigest: lane.image_sha256,
      configDigest: lane.image_config_sha256,
      sourceCommit: lane.image_source_commit,
      frozenAnonymousProofSha256: lane.anonymous_proof_sha256,
      proofSha256: hash(`image-${index}`),
    })),
    runpod: {
      billing: {
        cumulativeEndpointBillingUsd: 3.75,
        rowsSha256: hash("billing-rows"),
      },
      inventory: { activeWorkers: 0, endpoints: 0, pods: 0, privateTemplates: 0 },
      offering: {
        availability: "LOW",
        gpu: "NVIDIA GeForce RTX 4090",
        region: "EU-RO-1",
        serverlessFlexRateUsdPerGpuHour: 1.116,
        catalogSha256: hash("catalog"),
      },
    },
  };
  return { ...unsigned, proofSha256: hash(canonical(unsigned)) };
}

function receipts(approved = authority(), proof = preflight(approved)) {
  return {
    schema_version: STAGED_RECEIPTS_SCHEMA,
    adapter: signed({
      adapter_set_sha256: hash("adapter-set"),
      preflight_proof_sha256: proof.proofSha256,
    }),
    media_release: signed({
      schema_version: "videoforge.v2-09-combined-media-release-receipt/v1",
      preflight_proof_sha256: proof.proofSha256,
      release: "0.1.15",
      execution_bundle_sha256: hash("media-bundle"),
      installer_asset_sha256: hash("installer"),
      release_manifest_sha256: hash("manifest"),
      signing_identity_sha256: hash("signer"),
      whisper_model_sha256: hash("whisper"),
    }),
    lanes: approved.frozen_lanes.map((lane) =>
      signed({
        schema_version: "videoforge.v2-09-combined-lane-receipt/v1",
        preflight_proof_sha256: proof.proofSha256,
        lane: lane.lane,
        qualified_lane: { ...lane },
      }),
    ),
    production: signed({
      schema_version: "videoforge.v2-09-combined-production-receipt/v1",
      preflight_proof_sha256: proof.proofSha256,
      protected_static_inputs: { ...approved.production_inputs },
      config_sha256: hash("config"),
      worker_bundle_sha256: hash("worker"),
      chrome_auth_state_sha256: hash("chrome-auth"),
      chrome_request_sha256: hash("chrome-request"),
    }),
    baseline: signed({
      schema_version: "videoforge.v2-09-combined-baseline-receipt/v1",
      preflight_proof_sha256: proof.proofSha256,
      billing_baseline_usd: 3.75,
      billing_rows_sha256: hash("billing-rows"),
      completion_baseline_derivation:
        "GENERIC_PROJECT_ATTEMPT_SETTLED_PLUS_MAX_OPEN_RESERVATION_OR_REPORTED_ONCE",
      global_completion_baseline_derivation:
        "ALL_PROJECT_ATTEMPTS_SETTLED_PLUS_MAX_OPEN_RESERVATION_OR_REPORTED_ONCE",
      completion_baseline_receipt_sha256: tenantBaseline().receiptSha256,
      global_completion_baseline_receipt_sha256: durableBaseline("2026-09-07T10:01:00.000Z")
        .receiptSha256,
      completion_baseline_usd: 4.25,
    }),
    configuration: { exact: "opaque-live-configuration" },
  };
}

const receiptSet = (staged) => ({
  schema_version: staged.schema_version,
  media_release: staged.media_release,
  lanes: staged.lanes,
  production: staged.production,
  adapter: staged.adapter,
  baseline: staged.baseline,
});

function state(events, { completionAckFails = false, executeCompletionAckFails = false } = {}) {
  let snapshot;
  let executeCompletionAckFailed = false;
  const clone = () => structuredClone(snapshot);
  return {
    async loadOrClaim({ authority: approved }) {
      if (snapshot) return clone();
      events.push("claim");
      snapshot = {
        schema_version: "videoforge.v2-09-combined-outer-state/v1",
        outer_authority_id: approved.authority_id,
        inner_authority_id: null,
        inner_authority_sha256: null,
        proposal_sha256: approved.proposal_sha256,
        source_commit: approved.source_commit,
        consumed_once: true,
        status: "CLAIMED",
        operations: STAGED_OPERATION_IDS.map((id) => ({
          id,
          status: "PENDING",
          result: null,
          result_sha256: null,
        })),
      };
      return clone();
    },
    async beginOperation({ operationId }) {
      const operation = snapshot.operations.find(({ id }) => id === operationId);
      if (operation.status === "PENDING") operation.status = "STARTED";
      return clone();
    },
    async completeOperation({ operationId, result }) {
      const operation = snapshot.operations.find(({ id }) => id === operationId);
      operation.status = "COMPLETED";
      operation.result = result;
      operation.result_sha256 = hash(canonical(result));
      if (
        operationId === "materialize-v209-postdeploy-chrome-auth" &&
        snapshot.status === "AWAITING_INTERACTIVE_CHROME_LOGIN"
      )
        snapshot.status = "CLAIMED";
      if (
        operationId === "execute-qualified-production" &&
        executeCompletionAckFails &&
        !executeCompletionAckFailed
      ) {
        executeCompletionAckFailed = true;
        throw new Error("EXECUTE_COMPLETION_ACK_LOST");
      }
      return clone();
    },
    async bindInnerAuthority({ innerAuthorityId, innerAuthoritySha256 }) {
      snapshot.inner_authority_id = innerAuthorityId;
      snapshot.inner_authority_sha256 = innerAuthoritySha256;
      return clone();
    },
    async awaitInteractiveChromeLogin() {
      snapshot.status = "AWAITING_INTERACTIVE_CHROME_LOGIN";
      return clone();
    },
    async resumeInteractiveChromeLogin() {
      return clone();
    },
    async enterCleanupOnly() {
      events.push("cleanup-only");
      snapshot.status = "CLEANUP_ONLY";
      return clone();
    },
    async completeSuccess() {
      events.push("complete");
      snapshot.status = "SUCCEEDED_CLEAN";
      if (completionAckFails) throw new Error("ACK_LOST");
      return clone();
    },
    async completeCleanup() {
      snapshot.status = "FAILED_CLEAN";
      return clone();
    },
    async reconcileSuccess() {
      return clone();
    },
  };
}

test("one outer authority runs preflight before staging and derives bounded inner authority", async () => {
  const approved = authority();
  const proof = preflight(approved);
  const staged = receipts(approved, proof);
  const events = [];
  let received;
  const result = await executeCombinedQualifiedProductionForTest({
    authority: approved,
    sourceCommit: SOURCE,
    now: NOW,
    outerState: state(events),
    loadApiKey: async () => "x".repeat(32),
    runPreflight: async () => {
      events.push("preflight");
      return proof;
    },
    stageOperation: async ({ operationId }) => {
      events.push(operationId);
      return operationId === "read-postlogin-tenant-completion-baseline"
        ? tenantBaseline()
        : operationId.includes("completion-baseline")
          ? durableBaseline(
              operationId.startsWith("read-post") ? "2026-09-07T10:01:00.000Z" : undefined,
            )
          : { operation_id: operationId };
    },
    materializeStagedReceipts: async () => receiptSet(staged),
    cleanupStaged: async () => {},
    loadConfiguration: async () => staged.configuration,
    executeProduction: async (input) => {
      events.push("execute");
      received = input;
      return {
        schema_version: "videoforge.v2-09-qualified-production-execution/v1",
        authority_id: input.authority.authority_id,
        status: "SUCCEEDED_CLEAN",
        operations: [...OPERATION_IDS],
        paid_dispatch_count: 1,
        redispatch_count: 0,
      };
    },
  });
  assert.equal(events[0], "claim");
  assert.equal(events[1], "preflight");
  assert.deepEqual(events.slice(2, -2), [
    "read-pre-mutation-completion-baseline",
    "materialize-v209-protected-inputs",
    ...OPERATION_IDS.slice(0, 4),
    "read-post-migration-completion-baseline",
    ...OPERATION_IDS.slice(4, 11),
    "materialize-v209-endpoint-secrets",
    ...OPERATION_IDS.slice(11, 17),
    "materialize-v209-postdeploy-chrome-auth",
    "read-postlogin-tenant-completion-baseline",
  ]);
  assert.deepEqual(events.slice(-2), ["execute", "complete"]);
  assert.equal(result.schema_version, COMBINED_EXECUTION_SCHEMA);
  assert.equal(result.preflight_proof_sha256, proof.proofSha256);
  assert.notEqual(result.inner_authority_id, result.authority_id);
  assert.equal(received.authority.proposal_sha256, approved.proposal_sha256);
  assert.equal(received.authority.caps.billing_baseline_usd, 3.75);
  assert.equal(received.authority.caps.billing_stop_usd, 5.75);
  assert.equal(received.authority.caps.completion_baseline_usd, 4.25);
  assert.equal(received.authority.caps.completion_stop_usd, 6.25);
  assert.deepEqual(received.configuration, staged.configuration);
  assert.equal(received.combinedExecution.operations.length, 17);
  assert.equal(
    received.combinedExecution.inner_authority_sha256,
    hash(canonical(received.authority)),
  );
  assert.match(received.combinedExecution.staged_receipts_sha256, /^sha256:[0-9a-f]{64}$/u);
  assert.deepEqual(
    received.combinedExecution.operations.map(({ operation_id }) => operation_id),
    OPERATION_IDS.slice(0, 17),
  );
});

test("preflight failure consumes once, enters cleanup-only, and cannot stage or execute", async () => {
  const events = [];
  await assert.rejects(
    executeCombinedQualifiedProductionForTest({
      authority: authority(),
      sourceCommit: SOURCE,
      now: NOW,
      outerState: state(events),
      loadApiKey: async () => "x".repeat(32),
      runPreflight: async () => {
        events.push("preflight");
        throw new Error("PREFLIGHT_FAILED");
      },
      stageOperation: async () => events.push("stage"),
      materializeStagedReceipts: async () => events.push("materialize"),
      loadConfiguration: async () => events.push("configuration"),
      executeProduction: async () => events.push("execute"),
      cleanupStaged: async () => events.push("stage-cleanup"),
    }),
    /PREFLIGHT_FAILED/u,
  );
  assert.deepEqual(events, ["claim", "preflight", "cleanup-only"]);
});

test("tampered staged receipt fails closed before production execution", async () => {
  const approved = authority();
  const proof = preflight(approved);
  const staged = receipts(approved, proof);
  staged.baseline.completion_baseline_usd = 5;
  const events = [];
  await assert.rejects(
    executeCombinedQualifiedProductionForTest({
      authority: approved,
      sourceCommit: SOURCE,
      now: NOW,
      outerState: state(events),
      loadApiKey: async () => "x".repeat(32),
      runPreflight: async () => {
        events.push("preflight");
        return proof;
      },
      stageOperation: async ({ operationId }) => {
        events.push(operationId);
        return operationId === "read-postlogin-tenant-completion-baseline"
          ? tenantBaseline()
          : operationId.includes("completion-baseline")
            ? durableBaseline(
                operationId.startsWith("read-post") ? "2026-09-07T10:01:00.000Z" : undefined,
              )
            : { operation_id: operationId };
      },
      materializeStagedReceipts: async () => receiptSet(staged),
      loadConfiguration: async () => staged.configuration,
      executeProduction: async () => events.push("execute"),
      cleanupStaged: async () => events.push("stage-cleanup"),
    }),
    /V2_09_COMBINED_BASELINE_RECEIPT_HASH_INVALID/u,
  );
  assert.equal(events.includes("execute"), false);
  assert.deepEqual(events.slice(-2), ["cleanup-only", "stage-cleanup"]);
});

function successfulOptions({ events, outerState, executeProduction }) {
  const approved = authority();
  const proof = preflight(approved);
  const staged = receipts(approved, proof);
  return {
    authority: approved,
    sourceCommit: SOURCE,
    now: NOW,
    outerState,
    loadApiKey: async () => "x".repeat(32),
    runPreflight: async () => proof,
    stageOperation: async ({ operationId }) => {
      events.push(operationId);
      return operationId === "read-postlogin-tenant-completion-baseline"
        ? tenantBaseline()
        : operationId.includes("completion-baseline")
          ? durableBaseline(
              operationId.startsWith("read-post") ? "2026-09-07T10:01:00.000Z" : undefined,
            )
          : { operation_id: operationId };
    },
    materializeStagedReceipts: async () => receiptSet(staged),
    loadConfiguration: async () => staged.configuration,
    executeProduction,
    cleanupStaged: async () => {},
  };
}

test("interrupted inner execution resumes cleanup-only without mutating redispatch", async () => {
  const events = [];
  const outerState = state(events);
  const modes = [];
  const options = successfulOptions({
    events,
    outerState,
    executeProduction: async ({ mode }) => {
      modes.push(mode);
      if (mode === "EXECUTE") throw new Error("PROCESS_CRASH");
      if (modes.filter((value) => value === "CLEANUP_ONLY").length === 1)
        throw new Error("CLEANUP_INTERRUPTED");
      return { status: "FAILED_CLEAN" };
    },
  });
  await assert.rejects(executeCombinedQualifiedProductionForTest(options), /CLEANUP_INTERRUPTED/u);
  await assert.rejects(
    executeCombinedQualifiedProductionForTest(options),
    /V2_09_COMBINED_CLEANUP_ONLY/u,
  );
  assert.deepEqual(modes, ["EXECUTE", "CLEANUP_ONLY", "CLEANUP_ONLY"]);
  assert.equal(events.filter((value) => value === "push-clean-source").length, 1);
});

test("lost outer completion acknowledgement reconciles durable success", async () => {
  const events = [];
  const outerState = state(events, { completionAckFails: true });
  const options = successfulOptions({
    events,
    outerState,
    executeProduction: async ({ authority: inner }) => ({
      schema_version: "videoforge.v2-09-qualified-production-execution/v1",
      authority_id: inner.authority_id,
      status: "SUCCEEDED_CLEAN",
      operations: [...OPERATION_IDS],
      paid_dispatch_count: 1,
      redispatch_count: 0,
    }),
  });
  const first = await executeCombinedQualifiedProductionForTest(options);
  const second = await executeCombinedQualifiedProductionForTest(options);
  assert.equal(first.status, "SUCCEEDED_CLEAN");
  assert.deepEqual(second, first);
});

test("persisted inner completion ACK loss uses inner cleanup and resumes cleanup-only", async () => {
  const events = [];
  const outerState = state(events, { executeCompletionAckFails: true });
  const modes = [];
  const options = successfulOptions({
    events,
    outerState,
    executeProduction: async ({ authority: inner, mode }) => {
      modes.push(mode);
      if (mode === "CLEANUP_ONLY") {
        if (modes.filter((value) => value === "CLEANUP_ONLY").length === 1)
          throw new Error("CLEANUP_INTERRUPTED_AFTER_ACK_LOSS");
        return { status: "FAILED_CLEAN" };
      }
      return {
        schema_version: "videoforge.v2-09-qualified-production-execution/v1",
        authority_id: inner.authority_id,
        status: "SUCCEEDED_CLEAN",
        operations: [...OPERATION_IDS],
        paid_dispatch_count: 1,
        redispatch_count: 0,
      };
    },
  });
  await assert.rejects(
    executeCombinedQualifiedProductionForTest(options),
    /CLEANUP_INTERRUPTED_AFTER_ACK_LOSS/u,
  );
  await assert.rejects(
    executeCombinedQualifiedProductionForTest(options),
    /V2_09_COMBINED_CLEANUP_ONLY/u,
  );
  assert.deepEqual(modes, ["EXECUTE", "CLEANUP_ONLY", "CLEANUP_ONLY"]);
  assert.equal(events.includes("stage-cleanup"), false);
});

test("live composition wiring runs fixed injected stages only after preflight pass", async () => {
  const directory = mkdtempSync(join(tmpdir(), "vf-v209-combined-test-"));
  const approved = authority();
  approved.issued_at = "2020-01-01T00:00:00.000Z";
  approved.expires_at = "2099-01-01T00:00:00.000Z";
  const proof = preflight(approved);
  const staged = receipts(approved, proof);
  staged.production = signed({
    ...Object.fromEntries(
      Object.entries(staged.production).filter(([key]) => key !== "receipt_sha256"),
    ),
    config_sha256: hash(canonical(staged.configuration)),
  });
  const configurationPath = join(directory, "configuration.json");
  writeFileSync(configurationPath, JSON.stringify(staged.configuration), { mode: 0o600 });
  const events = [];
  const result = await executeCombinedQualifiedProductionWithDependenciesForTest(
    {
      authority: approved,
      sourceCommit: SOURCE,
      configurationPath,
      statePath: join(directory, "unused-state"),
    },
    {
      testOnlyInjectedDependencies: true,
      loadApiKey: async () => {
        events.push("key");
        return "x".repeat(32);
      },
      gitState: async () => ({ head: SOURCE, trackedClean: true }),
      runPreflight: async () => {
        events.push("preflight");
        return proof;
      },
      createOuterState: () => state(events),
      stageOperation: async ({ operationId }) =>
        operationId === "read-postlogin-tenant-completion-baseline"
          ? tenantBaseline()
          : operationId.includes("completion-baseline")
            ? durableBaseline(
                operationId.startsWith("read-post") ? "2026-09-07T10:01:00.000Z" : undefined,
              )
            : { operation_id: operationId },
      materializeStagedReceipts: async () => receiptSet(staged),
      loadConfiguration: async () => staged.configuration,
      cleanupStaged: async () => {},
      executeProduction: async ({ authority: inner }) => ({
        schema_version: "videoforge.v2-09-qualified-production-execution/v1",
        authority_id: inner.authority_id,
        status: "SUCCEEDED_CLEAN",
        operations: [...OPERATION_IDS],
        paid_dispatch_count: 1,
        redispatch_count: 0,
      }),
    },
  );
  assert.equal(result.status, "SUCCEEDED_CLEAN");
  assert.deepEqual(events.slice(0, 3), ["claim", "key", "preflight"]);
});

test("durable outer state is mode 0600 and an existing claim is never replaced", () => {
  const directory = mkdtempSync(join(tmpdir(), "vf-v209-combined-state-"));
  const statePath = join(directory, "outer-state.json");
  const approved = authority();
  const first = createDurableOuterState(statePath).loadOrClaim({ authority: approved });
  const second = createDurableOuterState(statePath).loadOrClaim({ authority: approved });
  assert.deepEqual(second, first);
  assert.equal(statSync(statePath).mode & 0o777, 0o600);
});

test("durable outer state rejects a corrupt existing claim without replacing it", () => {
  const directory = mkdtempSync(join(tmpdir(), "vf-v209-combined-corrupt-state-"));
  const statePath = join(directory, "outer-state.json");
  writeFileSync(statePath, '{"corrupt":true}\n', { mode: 0o600 });
  assert.throws(
    () => createDurableOuterState(statePath).loadOrClaim({ authority: authority() }),
    /V2_09_COMBINED_OUTER_STATE_INVALID|V2_09_COMBINED_STATE_READ_FAILED/u,
  );
  assert.equal(statSync(statePath).size, 17);
});

test("a failure after a staged provider mutation runs cleanup and never starts inner execution", async () => {
  const approved = authority();
  const proof = preflight(approved);
  const staged = receipts(approved, proof);
  const events = [];
  await assert.rejects(
    executeCombinedQualifiedProductionForTest({
      authority: approved,
      sourceCommit: SOURCE,
      now: NOW,
      outerState: state(events),
      loadApiKey: async () => "x".repeat(32),
      runPreflight: async () => proof,
      stageOperation: async ({ operationId }) => {
        events.push(operationId);
        if (operationId === "create-soulx-production-lane-max-one")
          throw new Error("STAGED_MUTATION_FAILED");
        return operationId === "read-postlogin-tenant-completion-baseline"
          ? tenantBaseline()
          : operationId.includes("completion-baseline")
            ? durableBaseline(
                operationId.startsWith("read-post") ? "2026-09-07T10:01:00.000Z" : undefined,
              )
            : { operation_id: operationId };
      },
      materializeStagedReceipts: async () => receiptSet(staged),
      loadConfiguration: async () => staged.configuration,
      executeProduction: async () => events.push("inner-execute"),
      cleanupStaged: async () => events.push("full-stage-cleanup"),
    }),
    /STAGED_MUTATION_FAILED/u,
  );
  assert.equal(events.includes("inner-execute"), false);
  assert.equal(events.at(-1), "full-stage-cleanup");
});

test("interactive Chrome login pauses safely and resumes without replaying staged mutations", async () => {
  const events = [];
  const outerState = state(events);
  let authAttempts = 0;
  const options = successfulOptions({
    events,
    outerState,
    executeProduction: async ({ authority: inner }) => ({
      schema_version: "videoforge.v2-09-qualified-production-execution/v1",
      authority_id: inner.authority_id,
      status: "SUCCEEDED_CLEAN",
      operations: [...OPERATION_IDS],
      paid_dispatch_count: 1,
      redispatch_count: 0,
    }),
  });
  const baseStageOperation = options.stageOperation;
  options.stageOperation = async (context) => {
    if (context.operationId === "materialize-v209-postdeploy-chrome-auth") {
      authAttempts += 1;
      if (authAttempts < 2) {
        const error = new Error("V2_09_CHROME_BOOTSTRAP_AWAITING_INTERACTIVE_CHROME_LOGIN");
        error.code = error.message;
        error.resumable = true;
        throw error;
      }
    }
    return baseStageOperation(context);
  };
  const paused = await executeCombinedQualifiedProductionForTest(options);
  assert.equal(paused.status, "AWAITING_INTERACTIVE_CHROME_LOGIN");
  assert.equal(events.filter((value) => value === "push-clean-source").length, 1);
  assert.equal(events.includes("cleanup-only"), false);
  const resumed = await executeCombinedQualifiedProductionForTest(options);
  assert.equal(resumed.status, "SUCCEEDED_CLEAN");
  assert.equal(authAttempts, 2);
  assert.equal(events.filter((value) => value === "push-clean-source").length, 1);
});

test("post-login tenant baseline cannot exceed the conservative pre-mutation global baseline", async () => {
  const events = [];
  const outerState = state(events);
  const options = successfulOptions({
    events,
    outerState,
    executeProduction: async () => events.push("execute"),
  });
  const baseStageOperation = options.stageOperation;
  options.stageOperation = async (context) => {
    if (context.operationId !== "read-postlogin-tenant-completion-baseline")
      return baseStageOperation(context);
    const receipt = tenantBaseline();
    const unsigned = {
      ...receipt,
      completionBaselineMicroUsd: 4_250_001,
      settledNetMicroUsd: 4_250_001,
    };
    delete unsigned.receiptSha256;
    return { ...unsigned, receiptSha256: hash(canonical(unsigned)) };
  };
  await assert.rejects(
    executeCombinedQualifiedProductionForTest(options),
    /V2_09_COMBINED_TENANT_BASELINE_EXCEEDS_GLOBAL/u,
  );
  assert.equal(events.includes("execute"), false);
  assert.equal(events.includes("cleanup-only"), true);
});

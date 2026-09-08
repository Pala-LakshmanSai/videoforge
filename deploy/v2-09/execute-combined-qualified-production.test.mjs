import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  COMBINED_AUTHORITY_SCHEMA,
  COMBINED_EXECUTION_SCHEMA,
  STAGED_OPERATION_IDS,
  STAGED_RECEIPTS_SCHEMA,
  executeCombinedQualifiedProduction,
  executeCombinedQualifiedProductionForTest,
  executeCombinedQualifiedProductionWithDependenciesForTest,
  createDurableOuterState,
  createLiveMaterializerForTest,
  validateCombinedAuthority,
  validateV209PrivateOutputDirectories,
} from "./execute-combined-qualified-production.mjs";
import {
  COMPLETION_CAP_USD,
  COMBINED_PRECOMPLETED_OPERATION_IDS,
  INCREMENTAL_CAP_USD,
  OPERATION_IDS,
  QUALIFIED_LANES,
} from "./execute-qualified-production.mjs";
import {
  V209_MEDIA_WORKER_ADHOC_SIGNING_IDENTITY_SHA256,
  V209_MEDIA_WORKER_MATERIALIZATION_RECEIPT_SCHEMA,
} from "./media-worker-production-operator.mjs";

const SOURCE = "7".repeat(40);
const NOW = new Date("2026-09-07T10:00:00.000Z");
const hash = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const exactRoles = (authorityId) => {
  const suffix = hash(authorityId).slice(7, 15);
  return {
    operatorRole: `videoforge_v209_operator_${suffix}`,
    runtimeRole: `videoforge_v209_runtime_${suffix}`,
    reconcilerRole: `videoforge_v209_reconciler_${suffix}`,
  };
};
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

function exactExistingAuthority() {
  const approved = authority();
  approved.media_worker_inputs = {
    release: "0.1.15",
    materialization_mode: "PREAUTHORIZED_EXACT_EXISTING_ONLY",
    release_source_commit: "b".repeat(40),
    execution_bundle_sha256: hash("media-bundle"),
    whisper_model_sha256: hash("whisper"),
    release_manifest_sha256: hash("existing-manifest"),
    installer_asset_sha256: hash("existing-dmg"),
    windows_installer_asset_sha256: hash("existing-exe"),
    signing_identity_sha256: V209_MEDIA_WORKER_ADHOC_SIGNING_IDENTITY_SHA256,
  };
  return approved;
}

test("combined authority admits only a closed-world exact-existing media release source split", () => {
  const approved = exactExistingAuthority();
  assert.equal(validateCombinedAuthority(approved, { sourceCommit: SOURCE, now: NOW }), approved);
  assert.notEqual(approved.source_commit, approved.media_worker_inputs.release_source_commit);
  for (const mutate of [
    (value) => delete value.media_worker_inputs.release_source_commit,
    (value) => (value.media_worker_inputs.release_source_commit = SOURCE),
    (value) => (value.media_worker_inputs.windows_installer_asset_sha256 = "invalid"),
    (value) => (value.media_worker_inputs.unapproved = true),
  ]) {
    const invalid = structuredClone(approved);
    mutate(invalid);
    assert.throws(
      () => validateCombinedAuthority(invalid, { sourceCommit: SOURCE, now: NOW }),
      /V2_09_COMBINED_MEDIA_INPUT_INVALID/u,
    );
  }
});

test("exact-existing operation completes with the legacy inner precompleted result shape", async () => {
  const approved = exactExistingAuthority();
  approved.issued_at = "2026-01-01T00:00:00.000Z";
  approved.expires_at = "2027-01-01T00:00:00.000Z";
  const proof = preflight(approved);
  const media = approved.media_worker_inputs;
  const receiptFacts = {
    schema_version: V209_MEDIA_WORKER_MATERIALIZATION_RECEIPT_SCHEMA,
    authority_id: approved.authority_id,
    source_commit: SOURCE,
    repository: "Pala-LakshmanSai/videoforge",
    workflow_path: ".github/workflows/media-worker-release.yml",
    release_source_commit: media.release_source_commit,
    release_tag: "media-worker-v0.1.15",
    release: media.release,
    release_manifest_sha256: media.release_manifest_sha256,
    installer_asset_sha256: media.installer_asset_sha256,
    windows_installer_asset_sha256: media.windows_installer_asset_sha256,
    execution_bundle_sha256: media.execution_bundle_sha256,
    whisper_model_sha256: media.whisper_model_sha256,
    signing_identity_sha256: media.signing_identity_sha256,
    immutable_release: true,
    release_asset_count: 3,
  };
  const rawResult = {
    schema_version: "videoforge.v2-09-media-worker-publication-result/v1",
    operation_id: "publish-media-worker-0.1.15",
    mode: "ADOPTED_EXACT_EXISTING",
    publish_count: 0,
    materialization_receipt: {
      ...receiptFacts,
      materialization_receipt_sha256: hash(canonical(receiptFacts)),
    },
  };
  let completed;
  const materializer = createLiveMaterializerForTest({
    testOnly: true,
    options: { statePath: "/tmp/v209-existing-operation-completion" },
    loadConfiguration: async () => ({ exact: "sealed-configuration" }),
    loadMaterializationPlan: async () => ({ exact: "unused" }),
    createResumedAdapters: () => ({ identity_sha256: hash("unused") }),
    createStagingAdapters: () => ({
      state: {
        claimAuthority: async () => ({}),
        beginNormalOperation: async () => ({}),
        completeNormalOperation: async ({ result }) => {
          completed = result;
          return {};
        },
      },
      operations: { "publish-media-worker-0.1.15": async () => rawResult },
    }),
  });
  const result = await materializer.run({
    operationId: "publish-media-worker-0.1.15",
    authority: approved,
    preflight: proof,
    priorResults: {},
  });
  assert.deepEqual(result, completed);
  assert.deepEqual(Object.keys(result).sort(), [
    "execution_bundle_sha256",
    "immutable_release",
    "installer_asset_sha256",
    "mode",
    "operation_id",
    "publish_count",
    "release",
    "release_manifest_sha256",
    "schema_version",
    "whisper_model_sha256",
  ]);
  assert.equal(result.mode, "REUSED_EXACT_EXISTING");
  assert.equal(result.publish_count, 0);
});

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
        serverlessFlexRateSource:
          "https://docs.runpod.io/serverless/endpoints/endpoint-configurations",
        serverlessFlexRateSourceCheckedAt: "2026-09-07T10:00:00.000Z",
        serverlessFlexRateSourceSha256: hash("official-pricing"),
        serverlessFlexRateUsdPerSecond: 0.00031,
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

function state(
  events,
  { completionAckFails = false, executeCompletionAckFails = false, enterCleanupFails = false } = {},
) {
  let snapshot;
  let executeCompletionAckFailed = false;
  let enterCleanupFailed = false;
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
      if (enterCleanupFails && !enterCleanupFailed) {
        enterCleanupFailed = true;
        throw new Error("PROCESS_DIED_BEFORE_CLEANUP_STATE");
      }
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
    forceClaimedForTest() {
      snapshot.status = "CLAIMED";
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
    cleanupProtected: async () => {},
    hasProtectedCleanup: async () => false,
    hasInnerCleanup: async () => false,
    readInnerSuccess: async () => null,
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
    ...OPERATION_IDS.slice(4, 10),
    "materialize-v209-endpoint-secrets",
    ...OPERATION_IDS.slice(10, 17),
    "materialize-v209-postdeploy-chrome-auth",
    "read-postlogin-tenant-completion-baseline",
  ]);
  assert.deepEqual(events.slice(-2), ["execute", "complete"]);
  assert.equal(events.includes("protected-cleanup"), false);
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
      cleanupProtected: async () => events.push("protected-cleanup"),
      hasProtectedCleanup: async () => false,
      hasInnerCleanup: async () => false,
      readInnerSuccess: async () => null,
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
      cleanupProtected: async () => events.push("protected-cleanup"),
      hasProtectedCleanup: async () => false,
      hasInnerCleanup: async () => false,
      readInnerSuccess: async () => null,
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
    cleanupProtected: async () => events.push("protected-cleanup"),
    hasProtectedCleanup: async () => false,
    hasInnerCleanup: async () => false,
    readInnerSuccess: async () => null,
  };
}

function privateOutputPlan(directory, secretsDirectory = join(directory, "secrets")) {
  const secretFiles = Object.fromEntries(
    Array.from({ length: 22 }, (_, index) => [
      `SECRET_${index}`,
      join(secretsDirectory, `secret-${index}`),
    ]),
  );
  return {
    production_configuration: {
      databaseOwnerUrlFile: join(directory, "database-owner.url"),
      databaseOperatorUrlFile: join(directory, "database-operator.url"),
      databaseReconcilerUrlFile: join(directory, "database-reconciler.url"),
      runpodApiKeyFile: join(directory, "runpod.key"),
      runpodWorkerEnvironmentFile: join(directory, "runpod-worker-environment.json"),
      cloudflare: { secretFiles },
    },
    protected_input_materialization: {
      roleJournalPath: join(directory, "roles.journal"),
    },
  };
}

function liveCompositionFixture({ gitState, calls, events }) {
  const directory = mkdtempSync(join(tmpdir(), "vf-v209-combined-git-state-"));
  const approved = authority();
  const proof = preflight(approved);
  const staged = receipts(approved, proof);
  return {
    options: {
      authority: approved,
      sourceCommit: SOURCE,
      configurationPath: join(directory, "configuration.json"),
      statePath: join(directory, "outer-state.json"),
    },
    dependencies: {
      testOnlyInjectedDependencies: true,
      loadApiKey: async () => {
        calls.credential += 1;
        return "x".repeat(32);
      },
      gitState: async () => {
        calls.git += 1;
        return gitState;
      },
      runPreflight: async () => {
        calls.preflight += 1;
        return proof;
      },
      createOuterState: () => state(events),
      stageOperation: async ({ operationId }) => {
        calls.stage += 1;
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
      cleanupStaged: async () => {},
      cleanupProtected: async () => {},
      hasProtectedCleanup: async () => false,
      hasInnerCleanup: async () => false,
      readInnerSuccess: async () => null,
      executeProduction: async ({ authority: inner }) => ({
        schema_version: "videoforge.v2-09-qualified-production-execution/v1",
        authority_id: inner.authority_id,
        status: "SUCCEEDED_CLEAN",
        operations: [...OPERATION_IDS],
        paid_dispatch_count: 1,
        redispatch_count: 0,
      }),
    },
  };
}

test("missing private materialization output directory fails before claim, key, preflight, or stage", async () => {
  const directory = mkdtempSync(join(tmpdir(), "vf-v209-combined-output-dir-"));
  const approved = authority();
  const materializationPlan = privateOutputPlan(directory);
  const events = [];
  const options = successfulOptions({
    events,
    outerState: state(events),
    executeProduction: async () => events.push("execute"),
  });
  let credentialReads = 0;
  let preflightCalls = 0;
  let stageCalls = 0;
  options.loadApiKey = async () => {
    credentialReads += 1;
    return "x".repeat(32);
  };
  options.runPreflight = async () => {
    preflightCalls += 1;
    return preflight(approved);
  };
  options.stageOperation = async () => {
    stageCalls += 1;
    return {};
  };
  options.preClaim = async ({ authority: current }) =>
    validateV209PrivateOutputDirectories({
      authority: current,
      materializationPlan,
      statePath: join(directory, "outer-state.json"),
    });

  await assert.rejects(
    executeCombinedQualifiedProductionForTest(options),
    /V2_09_COMBINED_PRIVATE_OUTPUT_DIRECTORY_INVALID/u,
  );
  assert.deepEqual(events, []);
  assert.equal(credentialReads, 0);
  assert.equal(preflightCalls, 0);
  assert.equal(stageCalls, 0);
});

test("existing private materialization output directories pass the pre-claim gate", async () => {
  const directory = mkdtempSync(join(tmpdir(), "vf-v209-combined-output-dir-valid-"));
  const secretsDirectory = join(directory, "secrets");
  mkdirSync(secretsDirectory, { mode: 0o700 });
  const approved = authority();
  const materializationPlan = privateOutputPlan(directory, secretsDirectory);
  const events = [];
  const options = successfulOptions({
    events,
    outerState: state(events),
    executeProduction: async ({ authority: inner }) => ({
      schema_version: "videoforge.v2-09-qualified-production-execution/v1",
      authority_id: inner.authority_id,
      status: "SUCCEEDED_CLEAN",
      operations: [...OPERATION_IDS],
      paid_dispatch_count: 1,
      redispatch_count: 0,
    }),
  });
  let credentialReads = 0;
  let preflightCalls = 0;
  let stageCalls = 0;
  options.loadApiKey = async () => {
    credentialReads += 1;
    return "x".repeat(32);
  };
  options.runPreflight = async () => {
    preflightCalls += 1;
    return preflight(approved);
  };
  const stageOperation = options.stageOperation;
  options.stageOperation = async (context) => {
    stageCalls += 1;
    return stageOperation(context);
  };
  options.preClaim = async ({ authority: current }) =>
    validateV209PrivateOutputDirectories({
      authority: current,
      materializationPlan,
      statePath: join(directory, "outer-state.json"),
    });

  const result = await executeCombinedQualifiedProductionForTest(options);
  assert.equal(result.status, "SUCCEEDED_CLEAN");
  assert.equal(events[0], "claim");
  assert.equal(credentialReads, 1);
  assert.equal(preflightCalls, 1);
  assert.ok(stageCalls > 0);
});

test("pre-claim git state rejects wrong HEAD and dirty worktree before claim or execution", async () => {
  for (const gitState of [
    { head: "8".repeat(40), trackedClean: true },
    { head: SOURCE, trackedClean: false },
  ]) {
    const events = [];
    const calls = { credential: 0, git: 0, preflight: 0, stage: 0 };
    const fixture = liveCompositionFixture({ gitState, calls, events });
    await assert.rejects(
      executeCombinedQualifiedProductionWithDependenciesForTest(
        fixture.options,
        fixture.dependencies,
      ),
      /V2_09_COMBINED_GIT_STATE_INVALID/u,
    );
    assert.deepEqual(events, []);
    assert.equal(calls.git, 1);
    assert.equal(calls.credential, 0);
    assert.equal(calls.preflight, 0);
    assert.equal(calls.stage, 0);
  }
});

test("injected Chrome and media readiness preclaims fail before claim or execution", async () => {
  for (const failure of [
    "V2_09_CHROME_BOOTSTRAP_VOICEOVER_INVALID",
    "V2_09_MEDIA_WORKER_READINESS_INSTALLATION_STATE_MISSING",
  ]) {
    const events = [];
    const calls = { credential: 0, git: 0, preflight: 0, stage: 0 };
    const fixture = liveCompositionFixture({
      gitState: { head: SOURCE, trackedClean: true },
      calls,
      events,
    });
    fixture.dependencies.preClaim = async () => {
      throw new Error(failure);
    };
    await assert.rejects(
      executeCombinedQualifiedProductionWithDependenciesForTest(
        fixture.options,
        fixture.dependencies,
      ),
      new RegExp(failure, "u"),
    );
    assert.deepEqual(events, []);
    assert.equal(calls.git, 1);
    assert.equal(calls.credential, 0);
    assert.equal(calls.preflight, 0);
    assert.equal(calls.stage, 0);
  }
});

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
  assert.equal(events.filter((value) => value === "protected-cleanup").length, 1);
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

test("persisted inner completion ACK loss adopts exact success without cleanup", async () => {
  const events = [];
  const outerState = state(events, { executeCompletionAckFails: true });
  const modes = [];
  let terminal;
  const options = successfulOptions({
    events,
    outerState,
    executeProduction: async ({ authority: inner, mode }) => {
      modes.push(mode);
      terminal = {
        schema_version: "videoforge.v2-09-qualified-production-execution/v1",
        authority_id: inner.authority_id,
        status: "SUCCEEDED_CLEAN",
        operations: [...OPERATION_IDS],
        paid_dispatch_count: 1,
        redispatch_count: 0,
      };
      return terminal;
    },
  });
  options.readInnerSuccess = async () => terminal;
  const recovered = await executeCombinedQualifiedProductionForTest(options);
  assert.equal(recovered.status, "SUCCEEDED_CLEAN");
  assert.deepEqual(modes, ["EXECUTE"]);
  assert.equal(events.includes("cleanup-only"), false);
  assert.equal(events.includes("protected-cleanup"), false);
});

test("protected-cleanup tombstone closes outer ACK loss without reconstructing inner cleanup", async () => {
  const events = [];
  const outerState = state(events);
  const modes = [];
  let protectedClean = false;
  let protectedCleanupAttempts = 0;
  const options = successfulOptions({
    events,
    outerState,
    executeProduction: async ({ mode }) => {
      modes.push(mode);
      if (mode === "EXECUTE") throw new Error("INNER_PROCESS_FAILED");
      return { status: "FAILED_CLEAN" };
    },
  });
  options.cleanupProtected = async () => {
    protectedCleanupAttempts += 1;
    protectedClean = true;
    throw new Error("PROTECTED_CLEANUP_ACK_LOST");
  };
  options.hasProtectedCleanup = async () => protectedClean;

  await assert.rejects(
    executeCombinedQualifiedProductionForTest(options),
    /PROTECTED_CLEANUP_ACK_LOST/u,
  );
  assert.deepEqual(modes, ["EXECUTE", "CLEANUP_ONLY"]);
  await assert.rejects(
    executeCombinedQualifiedProductionForTest(options),
    /V2_09_COMBINED_CLEANUP_ONLY/u,
  );
  assert.deepEqual(modes, ["EXECUTE", "CLEANUP_ONLY"]);
  assert.equal(protectedCleanupAttempts, 1);
  await assert.rejects(
    executeCombinedQualifiedProductionForTest(options),
    /V2_09_COMBINED_FAILED_CLEAN/u,
  );
});

test("interrupted CLAIMED recovery persists CLEANUP_ONLY before deleting protected inputs", async () => {
  const events = [];
  const outerState = state(events, { enterCleanupFails: true });
  const modes = [];
  let protectedClean = false;
  const options = successfulOptions({
    events,
    outerState,
    executeProduction: async ({ mode }) => {
      modes.push(mode);
      if (mode === "EXECUTE") throw new Error("INNER_PROCESS_DIED");
      return { status: "FAILED_CLEAN" };
    },
  });
  options.cleanupProtected = async () => {
    protectedClean = true;
    throw new Error("PROTECTED_CLEANUP_ACK_LOST");
  };
  options.hasProtectedCleanup = async () => protectedClean;

  await assert.rejects(
    executeCombinedQualifiedProductionForTest(options),
    /PROCESS_DIED_BEFORE_CLEANUP_STATE/u,
  );
  await assert.rejects(
    executeCombinedQualifiedProductionForTest(options),
    /PROTECTED_CLEANUP_ACK_LOST/u,
  );
  await assert.rejects(
    executeCombinedQualifiedProductionForTest(options),
    /V2_09_COMBINED_CLEANUP_ONLY/u,
  );
  assert.deepEqual(modes, ["EXECUTE", "CLEANUP_ONLY"]);
  assert.equal(events.filter((value) => value === "cleanup-only").length, 2);
});

test("durable inner FAILED_CLEAN skips cleanup replay before protected rollback", async () => {
  const events = [];
  const outerState = state(events, { enterCleanupFails: true });
  const modes = [];
  let innerClean = false;
  let protectedAttempts = 0;
  const options = successfulOptions({
    events,
    outerState,
    executeProduction: async ({ mode }) => {
      modes.push(mode);
      if (mode === "EXECUTE") throw new Error("INNER_PROCESS_DIED");
      innerClean = true;
      return { status: "FAILED_CLEAN" };
    },
  });
  options.hasInnerCleanup = async () => innerClean;
  options.cleanupProtected = async () => {
    protectedAttempts += 1;
    if (protectedAttempts === 1) throw new Error("PROCESS_DIED_BEFORE_PROTECTED_CLEANUP");
  };

  await assert.rejects(
    executeCombinedQualifiedProductionForTest(options),
    /PROCESS_DIED_BEFORE_CLEANUP_STATE/u,
  );
  await assert.rejects(
    executeCombinedQualifiedProductionForTest(options),
    /PROCESS_DIED_BEFORE_PROTECTED_CLEANUP/u,
  );
  await assert.rejects(
    executeCombinedQualifiedProductionForTest(options),
    /V2_09_COMBINED_CLEANUP_ONLY/u,
  );
  assert.deepEqual(modes, ["EXECUTE", "CLEANUP_ONLY"]);
  assert.equal(protectedAttempts, 2);
});

test("durable inner SUCCEEDED_CLEAN is adopted without cleanup or execution replay", async () => {
  const events = [];
  const outerState = state(events, { enterCleanupFails: true });
  const modes = [];
  let innerSucceeded = false;
  const options = successfulOptions({
    events,
    outerState,
    executeProduction: async ({ mode }) => {
      modes.push(mode);
      innerSucceeded = true;
      throw new Error("PROCESS_DIED_AFTER_INNER_SUCCESS");
    },
  });
  options.readInnerSuccess = async ({ authority: inner }) =>
    innerSucceeded
      ? {
          schema_version: "videoforge.v2-09-qualified-production-execution/v1",
          authority_id: inner.authority_id,
          status: "SUCCEEDED_CLEAN",
          operations: [...OPERATION_IDS],
          paid_dispatch_count: 1,
          redispatch_count: 0,
        }
      : null;

  const adopted = await executeCombinedQualifiedProductionForTest(options);
  assert.equal(adopted.status, "SUCCEEDED_CLEAN");
  const replay = await executeCombinedQualifiedProductionForTest(options);
  assert.deepEqual(replay, adopted);
  assert.deepEqual(modes, ["EXECUTE"]);
  assert.equal(events.includes("protected-cleanup"), false);
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
  let gitStateCalls = 0;
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
      gitState: async () => {
        gitStateCalls += 1;
        return { head: SOURCE, trackedClean: true };
      },
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
      cleanupProtected: async () => {},
      hasProtectedCleanup: async () => false,
      hasInnerCleanup: async () => false,
      readInnerSuccess: async () => null,
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
  assert.equal(gitStateCalls, 2);
});

test("live execution rejects a future RunPod key copy before claiming authority", async () => {
  const directory = mkdtempSync(join(tmpdir(), "vf-v209-combined-plan-binding-"));
  const approved = authority();
  const plan = {
    schema_version: "videoforge.v2-09-combined-materialization-plan/v1",
    production_configuration: {
      runpodApiKeyFile: join(directory, "future-materialized-runpod.key"),
      ...exactRoles(approved.authority_id),
    },
    protected_input_materialization: {
      reusableSecretFiles: { RUNPOD_API_KEY: join(directory, "approved-source-runpod.key") },
    },
    chrome_bootstrap: {},
  };
  approved.production_inputs.materialization_input_sha256 = hash(
    canonical({
      production_configuration: plan.production_configuration,
      protected_input_materialization: plan.protected_input_materialization,
    }),
  );
  approved.production_inputs.chrome_bootstrap_plan_sha256 = hash(canonical(plan.chrome_bootstrap));
  const configurationPath = join(directory, "configuration.json");
  writeFileSync(configurationPath, JSON.stringify(plan), { mode: 0o600 });

  await assert.rejects(
    executeCombinedQualifiedProduction({
      authority: approved,
      sourceCommit: SOURCE,
      configurationPath,
      statePath: join(directory, "must-not-be-created.json"),
    }),
    /V2_09_COMBINED_MATERIALIZATION_PLAN_INVALID/u,
  );
  assert.equal(existsSync(join(directory, "must-not-be-created.json")), false);
});

test("live execution rejects authority-derived role suffix drift before key, preflight, or claim", async () => {
  const directory = mkdtempSync(join(tmpdir(), "vf-v209-combined-role-plan-"));
  const approved = authority();
  const plan = {
    schema_version: "videoforge.v2-09-combined-materialization-plan/v1",
    production_configuration: {
      runpodApiKeyFile: join(directory, "approved-source-runpod.key"),
      ...exactRoles(approved.authority_id),
      runtimeRole: "videoforge_v209_runtime_wrong",
    },
    protected_input_materialization: {
      reusableSecretFiles: { RUNPOD_API_KEY: join(directory, "approved-source-runpod.key") },
    },
    chrome_bootstrap: {},
  };
  approved.production_inputs.materialization_input_sha256 = hash(
    canonical({
      production_configuration: plan.production_configuration,
      protected_input_materialization: plan.protected_input_materialization,
    }),
  );
  approved.production_inputs.chrome_bootstrap_plan_sha256 = hash(canonical(plan.chrome_bootstrap));
  const configurationPath = join(directory, "configuration.json");
  const statePath = join(directory, "must-not-be-claimed.json");
  writeFileSync(configurationPath, JSON.stringify(plan), { mode: 0o600 });

  await assert.rejects(
    executeCombinedQualifiedProduction({
      authority: approved,
      sourceCommit: SOURCE,
      configurationPath,
      statePath,
    }),
    /V2_09_COMBINED_MATERIALIZATION_PLAN_INVALID/u,
  );
  assert.equal(existsSync(statePath), false);
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

test("a new process reconstructs receipt derivation after durable Chrome completion", async () => {
  const approved = authority();
  const proof = preflight(approved);
  const configuration = { exact: "sealed-configuration" };
  const prefixResults = Object.fromEntries(
    COMBINED_PRECOMPLETED_OPERATION_IDS.map((operationId) => [
      operationId,
      { operation_id: operationId },
    ]),
  );
  prefixResults["render-qualified-production-config"] = {
    operation_id: "render-qualified-production-config",
    config_sha256: hash("rendered-config"),
    worker_bundle_sha256: hash("worker-bundle"),
  };
  prefixResults["materialize-v209-postdeploy-chrome-auth"] = {
    auth_state_sha256: hash("auth-state"),
    chrome_request_sha256: hash("chrome-request"),
    generate_clicks: 0,
    post_deploy_authentication: true,
  };
  prefixResults["read-postlogin-tenant-completion-baseline"] = tenantBaseline();
  let snapshots = 0;
  const materializer = createLiveMaterializerForTest({
    testOnly: true,
    options: { statePath: "/tmp/v209-new-process-boundary" },
    loadConfiguration: async () => configuration,
    loadMaterializationPlan: async () => {
      throw new Error("MATERIALIZATION_PLAN_MUST_NOT_REPLAY");
    },
    createResumedAdapters: (receivedConfiguration, rehydration) => {
      snapshots += 1;
      assert.equal(
        receivedConfiguration.journalPath,
        "/tmp/v209-new-process-boundary.staging-journal",
      );
      assert.equal(rehydration.authority.authority_id, approved.authority_id);
      assert.deepEqual(rehydration.priorResults, prefixResults);
      return { identity_sha256: hash("resumed-adapter") };
    },
  });

  const result = await materializer.receipts({
    authority: approved,
    preflight: proof,
    baseline: durableBaseline("2026-09-07T10:01:00.000Z"),
    prefixResults,
    configuration,
  });
  assert.equal(snapshots, 1);
  assert.equal(result.adapter.adapter_set_sha256, hash("resumed-adapter"));
  assert.equal(result.production.chrome_auth_state_sha256, hash("auth-state"));
});

test("a new process restores exact-existing adoption provenance and normalizes inner media facts", async () => {
  const approved = exactExistingAuthority();
  const proof = preflight(approved);
  const configuration = { exact: "sealed-configuration" };
  const prefixResults = Object.fromEntries(
    COMBINED_PRECOMPLETED_OPERATION_IDS.map((operationId) => [
      operationId,
      { operation_id: operationId },
    ]),
  );
  prefixResults["publish-media-worker-0.1.15"] = {
    schema_version: "videoforge.v2-09-media-worker-publication-result/v1",
    operation_id: "publish-media-worker-0.1.15",
    mode: "REUSED_EXACT_EXISTING",
    publish_count: 0,
    release: approved.media_worker_inputs.release,
    execution_bundle_sha256: approved.media_worker_inputs.execution_bundle_sha256,
    whisper_model_sha256: approved.media_worker_inputs.whisper_model_sha256,
    release_manifest_sha256: approved.media_worker_inputs.release_manifest_sha256,
    installer_asset_sha256: approved.media_worker_inputs.installer_asset_sha256,
    immutable_release: true,
  };
  prefixResults["render-qualified-production-config"] = {
    operation_id: "render-qualified-production-config",
    config_sha256: hash("rendered-config"),
    worker_bundle_sha256: hash("worker-bundle"),
  };
  prefixResults["materialize-v209-postdeploy-chrome-auth"] = {
    auth_state_sha256: hash("auth-state"),
    chrome_request_sha256: hash("chrome-request"),
    generate_clicks: 0,
    post_deploy_authentication: true,
  };
  prefixResults["read-postlogin-tenant-completion-baseline"] = tenantBaseline();
  const materializer = createLiveMaterializerForTest({
    testOnly: true,
    options: { statePath: "/tmp/v209-existing-release-adoption" },
    loadConfiguration: async () => configuration,
    loadMaterializationPlan: async () => {
      throw new Error("MATERIALIZATION_PLAN_MUST_NOT_REPLAY");
    },
    createResumedAdapters: (_receivedConfiguration, rehydration) => {
      assert.deepEqual(rehydration.authority.media_worker, approved.media_worker_inputs);
      assert.equal(
        rehydration.authority.scope.allow_media_worker_existing_release_adoption_once,
        true,
      );
      assert.equal("allow_media_worker_materialization_once" in rehydration.authority.scope, false);
      return { identity_sha256: hash("resumed-adapter") };
    },
  });

  const result = await materializer.receipts({
    authority: approved,
    preflight: proof,
    baseline: durableBaseline("2026-09-07T10:01:00.000Z"),
    prefixResults,
    configuration,
  });
  assert.deepEqual(Object.keys(result.media_release).sort(), [
    "execution_bundle_sha256",
    "installer_asset_sha256",
    "preflight_proof_sha256",
    "receipt_sha256",
    "release",
    "release_manifest_sha256",
    "schema_version",
    "signing_identity_sha256",
    "whisper_model_sha256",
  ]);
  assert.equal("materialization_mode" in result.media_release, false);
  assert.equal("release_source_commit" in result.media_release, false);
  assert.equal("windows_installer_asset_sha256" in result.media_release, false);

  for (const mutate of [
    (value) => (value.mode = "PUBLISHED_ONCE"),
    (value) => (value.publish_count = 1),
    (value) => (value.immutable_release = false),
    (value) => (value.release_manifest_sha256 = hash("foreign-manifest")),
  ]) {
    const tamperedResults = structuredClone(prefixResults);
    mutate(tamperedResults["publish-media-worker-0.1.15"]);
    const rejectingMaterializer = createLiveMaterializerForTest({
      testOnly: true,
      options: { statePath: "/tmp/v209-existing-release-adoption-tamper" },
      loadConfiguration: async () => configuration,
      loadMaterializationPlan: async () => {
        throw new Error("MATERIALIZATION_PLAN_MUST_NOT_REPLAY");
      },
      createResumedAdapters: () => {
        throw new Error("TAMPER_MUST_FAIL_BEFORE_INNER_ADAPTER");
      },
    });
    await assert.rejects(
      rejectingMaterializer.receipts({
        authority: approved,
        preflight: proof,
        baseline: durableBaseline("2026-09-07T10:01:00.000Z"),
        prefixResults: tamperedResults,
        configuration,
      }),
      /V2_09_COMBINED_MEDIA_ADOPTION_RESTORE_INVALID/u,
    );
  }
});

test("postdeploy Chrome bootstrap receives only the exact outer authority expiry", async () => {
  const approved = authority();
  const proof = preflight(approved);
  const configuration = { exact: "sealed-configuration" };
  const plan = { chrome_bootstrap: { successHorizonSeconds: 1_660 } };
  const observed = [];
  const materializer = createLiveMaterializerForTest({
    testOnly: true,
    options: { statePath: "/tmp/v209-chrome-expiry-binding" },
    loadConfiguration: async () => configuration,
    loadMaterializationPlan: async () => plan,
    createResumedAdapters: () => ({ identity_sha256: hash("unused") }),
    materializeChromeBootstrap: async (receivedPlan, dependencies) => {
      observed.push({ receivedPlan, dependencies });
      if (dependencies?.authorityExpiresAt !== approved.expires_at)
        throw new Error("EXACT_OUTER_AUTHORITY_EXPIRY_REQUIRED");
      return { status: "AUTHENTICATED_READY_FOR_ONE_E2E" };
    },
  });
  await materializer.run({
    operationId: "materialize-v209-postdeploy-chrome-auth",
    authority: approved,
    preflight: proof,
    priorResults: {},
  });
  assert.deepEqual(observed, [
    {
      receivedPlan: plan.chrome_bootstrap,
      dependencies: { authorityExpiresAt: approved.expires_at },
    },
  ]);

  for (const expires_at of [undefined, "2026-09-07T11:59:59.999Z"]) {
    await assert.rejects(
      materializer.run({
        operationId: "materialize-v209-postdeploy-chrome-auth",
        authority: { ...approved, expires_at },
        preflight: proof,
        priorResults: {},
      }),
      /EXACT_OUTER_AUTHORITY_EXPIRY_REQUIRED/u,
    );
  }
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
      cleanupProtected: async () => events.push("protected-cleanup"),
      hasProtectedCleanup: async () => false,
      hasInnerCleanup: async () => false,
      readInnerSuccess: async () => null,
    }),
    /STAGED_MUTATION_FAILED/u,
  );
  assert.equal(events.includes("inner-execute"), false);
  assert.equal(events.at(-1), "full-stage-cleanup");
});

test("a partial endpoint-secret write restarts in staging cleanup without constructing production", async () => {
  const events = [];
  const outerState = state(events);
  let cleanupAttempts = 0;
  let endpointAttempts = 0;
  const options = successfulOptions({
    events,
    outerState,
    executeProduction: async () => events.push("inner-execute"),
  });
  const baseStageOperation = options.stageOperation;
  options.stageOperation = async (context) => {
    if (context.operationId === "materialize-v209-endpoint-secrets") {
      endpointAttempts += 1;
      throw new Error("PARTIAL_ENDPOINT_SECRET_WRITE");
    }
    return baseStageOperation(context);
  };
  options.cleanupStaged = async () => {
    cleanupAttempts += 1;
    events.push("staging-cleanup");
    if (cleanupAttempts === 1) throw new Error("CLEANUP_PROCESS_INTERRUPTED");
  };

  await assert.rejects(
    executeCombinedQualifiedProductionForTest(options),
    /CLEANUP_PROCESS_INTERRUPTED/u,
  );
  await assert.rejects(
    executeCombinedQualifiedProductionForTest(options),
    /V2_09_COMBINED_CLEANUP_ONLY/u,
  );
  assert.equal(cleanupAttempts, 2);
  assert.equal(endpointAttempts, 1);
  assert.equal(events.includes("inner-execute"), false);
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

test("a terminal resumed Chrome failure rolls back once and cannot replay authentication", async () => {
  const events = [];
  const outerState = state(events);
  let authAttempts = 0;
  let cleanupAttempts = 0;
  const options = successfulOptions({
    events,
    outerState,
    executeProduction: async () => events.push("execute"),
  });
  const baseStageOperation = options.stageOperation;
  options.stageOperation = async (context) => {
    if (context.operationId === "materialize-v209-postdeploy-chrome-auth") {
      authAttempts += 1;
      if (authAttempts === 1) {
        const error = new Error("V2_09_CHROME_BOOTSTRAP_AWAITING_INTERACTIVE_CHROME_LOGIN");
        error.code = error.message;
        error.resumable = true;
        throw error;
      }
      throw new Error("V2_09_CHROME_BOOTSTRAP_BROWSER_FAILED");
    }
    return baseStageOperation(context);
  };
  options.cleanupStaged = async () => {
    cleanupAttempts += 1;
  };

  const paused = await executeCombinedQualifiedProductionForTest(options);
  assert.equal(paused.status, "AWAITING_INTERACTIVE_CHROME_LOGIN");
  await assert.rejects(
    executeCombinedQualifiedProductionForTest(options),
    /V2_09_CHROME_BOOTSTRAP_BROWSER_FAILED/u,
  );
  await assert.rejects(
    executeCombinedQualifiedProductionForTest(options),
    /V2_09_COMBINED_FAILED_CLEAN/u,
  );
  assert.equal(authAttempts, 2);
  assert.equal(cleanupAttempts, 1);
  assert.equal(events.includes("execute"), false);
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

test("a crash after the claim-bound Chrome auth write adopts only the STARTED auth operation", async () => {
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
      if (authAttempts === 1) {
        const error = new Error("V2_09_CHROME_BOOTSTRAP_AWAITING_INTERACTIVE_CHROME_LOGIN");
        error.code = error.message;
        error.resumable = true;
        throw error;
      }
    }
    return baseStageOperation(context);
  };
  await executeCombinedQualifiedProductionForTest(options);
  outerState.forceClaimedForTest();
  const resumed = await executeCombinedQualifiedProductionForTest(options);
  assert.equal(resumed.status, "SUCCEEDED_CLEAN");
  assert.equal(authAttempts, 2);
  assert.equal(events.filter((value) => value === "push-clean-source").length, 1);
  assert.equal(events.includes("cleanup-only"), false);
});

test("expired authority never launches Chrome while awaiting interactive login", async () => {
  const events = [];
  const outerState = state(events);
  let authAttempts = 0;
  const options = successfulOptions({
    events,
    outerState,
    executeProduction: async () => events.push("execute"),
  });
  const baseStageOperation = options.stageOperation;
  options.stageOperation = async (context) => {
    if (context.operationId === "materialize-v209-postdeploy-chrome-auth") {
      authAttempts += 1;
      const error = new Error("V2_09_CHROME_BOOTSTRAP_AWAITING_INTERACTIVE_CHROME_LOGIN");
      error.code = error.message;
      error.resumable = true;
      throw error;
    }
    return baseStageOperation(context);
  };
  options.cleanupStaged = async () => events.push("expired-stage-cleanup");
  const paused = await executeCombinedQualifiedProductionForTest(options);
  assert.equal(paused.status, "AWAITING_INTERACTIVE_CHROME_LOGIN");
  options.now = new Date("2026-09-07T12:00:00.000Z");
  await assert.rejects(
    executeCombinedQualifiedProductionForTest(options),
    /V2_09_COMBINED_AUTHORITY_NOT_CURRENT/u,
  );
  assert.equal(authAttempts, 1);
  assert.equal(events.includes("execute"), false);
  assert.equal(events.filter((value) => value === "expired-stage-cleanup").length, 1);
  await assert.rejects(
    executeCombinedQualifiedProductionForTest(options),
    /V2_09_COMBINED_FAILED_CLEAN/u,
  );
});

test("repeated new-process Chrome waits do not replay the prefix or derive protected receipts", async () => {
  const events = [];
  const outerState = state(events);
  let authAttempts = 0;
  let receiptDerivations = 0;
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
  const baseMaterializeStagedReceipts = options.materializeStagedReceipts;
  options.stageOperation = async (context) => {
    if (context.operationId === "materialize-v209-postdeploy-chrome-auth") {
      authAttempts += 1;
      if (authAttempts <= 3) {
        const error = new Error("V2_09_CHROME_BOOTSTRAP_AWAITING_INTERACTIVE_CHROME_LOGIN");
        error.code = error.message;
        error.resumable = true;
        throw error;
      }
    }
    return baseStageOperation(context);
  };
  options.materializeStagedReceipts = async (context) => {
    receiptDerivations += 1;
    return baseMaterializeStagedReceipts(context);
  };

  for (let index = 0; index < 3; index += 1) {
    const paused = await executeCombinedQualifiedProductionForTest(options);
    assert.equal(paused.status, "AWAITING_INTERACTIVE_CHROME_LOGIN");
    assert.equal(receiptDerivations, 0);
  }
  const completed = await executeCombinedQualifiedProductionForTest(options);
  assert.equal(completed.status, "SUCCEEDED_CLEAN");
  assert.equal(authAttempts, 4);
  assert.equal(receiptDerivations, 1);
  assert.equal(events.filter((value) => value === "push-clean-source").length, 1);
  assert.equal(events.filter((value) => value === "apply-migrations-0074-0086").length, 1);
  assert.equal(events.includes("cleanup-only"), false);
});

test("postdeploy install failure never imports activation or starts Chrome and resumes cleanup only", async () => {
  const events = [];
  const outerState = state(events);
  const options = successfulOptions({
    events,
    outerState,
    executeProduction: async () => {
      throw new Error("PAID_EXECUTION_MUST_NOT_RUN");
    },
  });
  const stage = options.stageOperation;
  options.stageOperation = async (context) => {
    if (context.operationId === "install-media-worker-0.1.15") {
      assert.ok(events.includes("readback-qualified-production"));
      assert.ok(events.includes("materialize-v209-endpoint-secrets"));
      events.push(context.operationId);
      throw new Error("V2_09_MEDIA_WORKER_HEARTBEAT_READ_FAILED");
    }
    return stage(context);
  };
  let cleanupAttempts = 0;
  options.cleanupStaged = async () => {
    events.push("deployment-cleanup");
    if (++cleanupAttempts === 1) throw new Error("CLEANUP_TEMPORARILY_UNAVAILABLE");
  };
  await assert.rejects(executeCombinedQualifiedProductionForTest(options));
  assert.equal(events.includes("import-v209-qualified-activation"), false);
  assert.equal(events.includes("materialize-v209-postdeploy-chrome-auth"), false);
  assert.equal(events.includes("protected-cleanup"), false);
  const stageCount = events.filter((event) => STAGED_OPERATION_IDS.includes(event)).length;
  await assert.rejects(executeCombinedQualifiedProductionForTest(options));
  assert.equal(events.filter((event) => STAGED_OPERATION_IDS.includes(event)).length, stageCount);
  assert.equal(cleanupAttempts, 2);
});

test("durable diagnostics preserve original failure separately from cleanup without arbitrary text", async () => {
  const events = [];
  const directory = mkdtempSync(join(tmpdir(), "v209-failure-codes-"));
  const path = join(directory, "state.json");
  const outerState = createDurableOuterState(path);
  const options = successfulOptions({
    events,
    outerState,
    executeProduction: async () => {
      throw new Error("must not run");
    },
  });
  const stage = options.stageOperation;
  options.stageOperation = async (context) => {
    if (context.operationId === "materialize-v209-endpoint-secrets")
      throw Object.assign(new Error("open /private/secret token=password"), { code: "ENOENT" });
    return stage(context);
  };
  options.cleanupStaged = async () => {
    throw new Error("V2_09_STAGING_CLEANUP_INCOMPLETE");
  };
  await assert.rejects(
    executeCombinedQualifiedProductionForTest(options),
    /V2_09_STAGING_CLEANUP_INCOMPLETE/u,
  );
  let observed = await outerState.reconcileSuccess();
  assert.equal(observed.status, "CLEANUP_ONLY");
  assert.deepEqual(observed.failure, {
    operation_id: "materialize-v209-endpoint-secrets",
    operation_code: "ENOENT",
    cleanup_code: "V2_09_STAGING_CLEANUP_INCOMPLETE",
  });
  assert.equal(JSON.stringify(observed).includes("password"), false);
  await outerState.recordFailure({ error: new Error("token=private-value"), cleanup: true });
  observed = await createDurableOuterState(path).loadOrClaim({ authority: options.authority });
  assert.equal(observed.failure.operation_code, "ENOENT");
  assert.equal(observed.failure.cleanup_code, "UNKNOWN_ERROR");
  assert.equal(JSON.stringify(observed).includes("private-value"), false);
});

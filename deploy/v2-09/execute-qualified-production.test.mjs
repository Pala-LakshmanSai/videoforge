import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  AUTHORITY_SCHEMA,
  BRANCH,
  CLEANUP_OPERATIONS,
  COMPLETION_CAP_USD,
  DRY_RUN_SCHEMA,
  INCREMENTAL_CAP_USD,
  NORMAL_OPERATIONS,
  OPERATION_IDS,
  PUSH_REF,
  QUALIFIED_LANES,
  deriveInjectedAdapterIdentity,
  dryRunPlan,
  executeQualifiedProduction,
  executeQualifiedProductionForTest,
  validateAuthority,
} from "./execute-qualified-production.mjs";

const SOURCE_COMMIT = "a".repeat(40);
const NOW = new Date("2026-09-06T12:00:00Z");
const SCRIPT = fileURLToPath(new URL("./execute-qualified-production.mjs", import.meta.url));
const STATE_METHODS = [
  "claimAuthority",
  "beginNormalOperation",
  "completeNormalOperation",
  "enterCleanupOnly",
  "loadCleanupAuthority",
  "recordCleanupOperation",
  "completeCleanup",
  "completeSuccess",
  "reconcileSuccess",
];
const TEST_SOURCE_IDENTITY = Object.freeze({
  schema_version: "videoforge.v2-09-adapter-source-identity/v1",
  implementation_sha256: `sha256:${"1".repeat(64)}`,
  capability_source_sha256s: Object.freeze(
    Object.fromEntries(
      [...OPERATION_IDS, ...STATE_METHODS].map((name) => [name, `sha256:${"2".repeat(64)}`]),
    ),
  ),
});
let testAdapterIdentitySha256;

function authority(overrides = {}) {
  const value = {
    schema_version: AUTHORITY_SCHEMA,
    authority_id: "v2-09-test-authority",
    adapter_set_sha256: testAdapterIdentitySha256 ?? adapters().identity_sha256,
    proposal_sha256: `sha256:${"b".repeat(64)}`,
    source_commit: SOURCE_COMMIT,
    branch: BRANCH,
    push_ref: PUSH_REF,
    issued_at: "2026-09-06T11:00:00Z",
    expires_at: "2026-09-06T13:00:00Z",
    single_use: true,
    execution: "V2_09_QUALIFIED_PRODUCTION_ONCE",
    offering: {
      offering_id_sha256: `sha256:${"4".repeat(64)}`,
      gpu: "NVIDIA GeForce RTX 4090",
      region: "EU-RO-1",
      availability_floor: "LOW",
      max_rate_usd_per_gpu_hour: 1.116,
    },
    media_worker: {
      release: "0.1.15",
      execution_bundle_sha256: `sha256:${"6".repeat(64)}`,
      whisper_model_sha256: `sha256:${"7".repeat(64)}`,
      release_manifest_sha256: `sha256:${"a".repeat(64)}`,
      installer_asset_sha256: `sha256:${"b".repeat(64)}`,
      signing_identity_sha256: `sha256:${"c".repeat(64)}`,
    },
    production: {
      worker_name: "videoforge-production-runtime",
      chrome_auth_state_sha256: `sha256:${"d".repeat(64)}`,
      chrome_request_sha256: `sha256:${"e".repeat(64)}`,
      config_sha256: `sha256:${"8".repeat(64)}`,
      worker_bundle_sha256: `sha256:${"9".repeat(64)}`,
      secret_allowlist_sha256: `sha256:${"0".repeat(64)}`,
      secret_count: 22,
    },
    caps: {
      billing_baseline_usd: 3.5,
      incremental_cap_usd: INCREMENTAL_CAP_USD,
      billing_stop_usd: 5.5,
      completion_baseline_usd: 4,
      completion_cap_usd: COMPLETION_CAP_USD,
      completion_stop_usd: 6,
    },
    scope: {
      operations: [...OPERATION_IDS],
      stage_6: "FROZEN_QUALIFIED_NO_RERUN",
      stage_7: "FROZEN_QUALIFIED_NO_RERUN",
      allow_stage_6_or_7_qualification: false,
      allow_v2_10_plus: false,
      allow_redispatch: false,
      cleanup_only_recovery: true,
      lanes: QUALIFIED_LANES.map((lane) => ({ ...lane })),
      allow_image_publication: false,
      allow_gpu_fallback: false,
      allow_region_fallback: false,
      allow_model_download: false,
      allow_retained_volume_mutation: false,
      media_worker_release: "0.1.15",
    },
  };
  return { ...value, ...overrides };
}

function resultFor(id, value, outcome = "SUCCESS", priorResults = []) {
  if (id === "push-clean-source") {
    return {
      operation_id: id,
      source_commit: value.source_commit,
      destination_ref: PUSH_REF,
      push_count: 1,
    };
  }
  if (id === "readback-clean-source") {
    return { operation_id: id, source_commit: value.source_commit, destination_ref: PUSH_REF };
  }
  if (id === "fresh-read-only-admission") {
    return {
      schema_version: "videoforge.v2-09-rollout-admission/v1",
      operation_id: id,
      billing_baseline_usd: value.caps.billing_baseline_usd,
      offering_id_sha256: value.offering.offering_id_sha256,
      catalog_snapshot_sha256: `sha256:${"5".repeat(64)}`,
      observed_at: "2026-09-06T11:59:00Z",
      validated_at: "2026-09-06T12:00:00Z",
      completion_baseline_usd: value.caps.completion_baseline_usd,
      projected_incremental_usd: 1.25,
      projected_completion_usd: value.caps.completion_baseline_usd + 1.25,
      gpu: "NVIDIA GeForce RTX 4090",
      region: "EU-RO-1",
      availability: "LOW",
      rate_usd_per_gpu_hour: 1.116,
      zero_compute: true,
      retained_volume_count: 2,
      workers_min: 0,
      workers_max: 1,
    };
  }
  if (id === "run-one-v209-chrome-e2e") {
    return {
      schema_version: "videoforge.v2-09-one-chrome-e2e-result/v1",
      operation_id: id,
      project_id_sha256: `sha256:${"c".repeat(64)}`,
      generation_request_sha256: `sha256:${"a".repeat(64)}`,
      output_id_sha256: `sha256:${"b".repeat(64)}`,
      mp4_sha256: `sha256:${"2".repeat(64)}`,
      browser_evidence_sha256: `sha256:${"d".repeat(64)}`,
      chrome_version_sha256: `sha256:${"e".repeat(64)}`,
      duration_seconds: 45,
      playback_verified: true,
      seek_verified: true,
      download_verified: true,
      submission_count: 1,
      redispatch_count: 0,
      billing_total_usd: value.caps.billing_baseline_usd + 1,
      completion_total_usd: value.caps.completion_baseline_usd + 1,
    };
  }
  if (id === "apply-migrations-0074-0081") {
    return {
      operation_id: id,
      mode: "APPLIED_0074_0081",
      from_version: 73,
      to_version: 81,
      applied_versions: [74, 75, 76, 77, 78, 79, 80, 81],
    };
  }
  if (id === "apply-v209-grants") {
    return {
      schema_version: "videoforge.v2-09-grants-result/v1",
      operation_id: id,
      migration_head: 81,
      public_execute_count: 0,
      runtime_grants_verified: true,
      operator_grants_verified: true,
      reconciler_grants_verified: true,
    };
  }
  if (id === "publish-media-worker-0.1.15") {
    return {
      schema_version: "videoforge.v2-09-media-worker-publication-result/v1",
      operation_id: id,
      mode: "PUBLISHED_ONCE",
      release: value.media_worker.release,
      execution_bundle_sha256: value.media_worker.execution_bundle_sha256,
      whisper_model_sha256: value.media_worker.whisper_model_sha256,
      release_manifest_sha256: value.media_worker.release_manifest_sha256,
      installer_asset_sha256: value.media_worker.installer_asset_sha256,
      immutable_release: true,
      publish_count: 1,
    };
  }
  if (id === "readback-media-worker-0.1.15") {
    return {
      schema_version: "videoforge.v2-09-media-worker-readback-result/v1",
      operation_id: id,
      release: value.media_worker.release,
      execution_bundle_sha256: value.media_worker.execution_bundle_sha256,
      whisper_model_sha256: value.media_worker.whisper_model_sha256,
      release_manifest_sha256: value.media_worker.release_manifest_sha256,
      installer_asset_sha256: value.media_worker.installer_asset_sha256,
      release_asset_count: 1,
      immutable_readback: true,
    };
  }
  if (id === "install-media-worker-0.1.15") {
    return {
      schema_version: "videoforge.v2-09-media-worker-install-result/v1",
      operation_id: id,
      release: value.media_worker.release,
      execution_bundle_sha256: value.media_worker.execution_bundle_sha256,
      installer_asset_sha256: value.media_worker.installer_asset_sha256,
      signing_identity_sha256: value.media_worker.signing_identity_sha256,
      installed_release_sha256: `sha256:${"d".repeat(64)}`,
      online_heartbeat_sha256: `sha256:${"e".repeat(64)}`,
      code_signature_verified: true,
      online: true,
    };
  }
  if (
    id === "create-mage-production-lane-max-one" ||
    id === "create-soulx-production-lane-max-one"
  ) {
    const lane = id.startsWith("create-mage") ? QUALIFIED_LANES[0] : QUALIFIED_LANES[1];
    return {
      schema_version: "videoforge.v2-09-production-lane-result/v1",
      operation_id: id,
      lane: lane.lane,
      gpu: lane.gpu,
      region: lane.region,
      workers_min: lane.workers_min,
      workers_max: lane.workers_max,
      handler_concurrency: lane.handler_concurrency,
      retained_volume_size_gb: lane.volume_size_gb,
      image_sha256: lane.image_sha256,
      image_source_commit: lane.image_source_commit,
      image_config_sha256: lane.image_config_sha256,
      anonymous_proof_sha256: lane.anonymous_proof_sha256,
      acceptance_sha256: lane.acceptance_sha256,
      volume_id_sha256: lane.volume_id_sha256,
      volume_manifest_sha256: lane.volume_manifest_sha256,
      endpoint_id_sha256: `sha256:${"e".repeat(64)}`,
      template_id_sha256: `sha256:${"f".repeat(64)}`,
      deployment_sha256: `sha256:${"1".repeat(64)}`,
    };
  }
  if (id === "persist-qualified-production-deployments") {
    return {
      schema_version: "videoforge.v2-09-deployment-persistence-result/v1",
      operation_id: id,
      persisted_deployment_count: 2,
      deployments: QUALIFIED_LANES.map((lane, index) => ({
        lane: lane.lane,
        deployment_sha256: `sha256:${"1".repeat(64)}`,
        endpoint_id_sha256: `sha256:${"e".repeat(64)}`,
        template_id_sha256: `sha256:${"f".repeat(64)}`,
        deployment_row_id_sha256: `sha256:${String(index + 3).repeat(64)}`,
      })),
    };
  }
  if (id === "render-qualified-production-config") {
    return {
      operation_id: id,
      config_sha256: value.production.config_sha256,
      worker_bundle_sha256: value.production.worker_bundle_sha256,
    };
  }
  if (id === "readback-qualified-production") {
    return {
      schema_version: "videoforge.v2-09-qualified-readback-result/v1",
      operation_id: id,
      worker: value.production.worker_name,
      config_sha256: value.production.config_sha256,
      worker_bundle_sha256: value.production.worker_bundle_sha256,
      gpu_transport: "QUALIFIED_EXACT",
      exact_pair_bound: true,
      deployment_id_sha256: `sha256:${"4".repeat(64)}`,
    };
  }
  if (id === "deploy-cloudflare-disabled-bootstrap") {
    return {
      schema_version: "videoforge.v2-09-disabled-bootstrap-result/v1",
      operation_id: id,
      worker: value.production.worker_name,
      config_sha256: `sha256:${"2".repeat(64)}`,
      gpu_transport: "DISABLED_UNQUALIFIED",
      bootstrap_deploy_count: 1,
      full_disabled_deploy_count: 1,
      deploy_count: 2,
    };
  }
  if (id === "upload-cloudflare-production-secrets") {
    return {
      schema_version: "videoforge.v2-09-secret-upload-result/v1",
      operation_id: id,
      worker: value.production.worker_name,
      secret_allowlist_sha256: value.production.secret_allowlist_sha256,
      secret_count: value.production.secret_count,
      secret_put_count: value.production.secret_count,
      deploy_count: 1,
      mutation_count: value.production.secret_count + 1,
      transaction_count: 1,
    };
  }
  if (id === "deploy-cloudflare-qualified-production") {
    return {
      schema_version: "videoforge.v2-09-qualified-deploy-result/v1",
      operation_id: id,
      worker: value.production.worker_name,
      config_sha256: value.production.config_sha256,
      worker_bundle_sha256: value.production.worker_bundle_sha256,
      deployment_id_sha256: `sha256:${"4".repeat(64)}`,
      deploy_count: 1,
    };
  }
  if (id === "import-v209-qualified-activation") {
    return {
      schema_version: "videoforge.v2-09-activation-import-result/v1",
      operation_id: id,
      import_count: 1,
      qualified_activation_active: true,
      source_commit: value.source_commit,
      config_sha256: value.production.config_sha256,
      worker_bundle_sha256: value.production.worker_bundle_sha256,
      cloudflare_deployment_id_sha256: `sha256:${"4".repeat(64)}`,
      deployment_row_id_sha256s: [`sha256:${"3".repeat(64)}`, `sha256:${"4".repeat(64)}`],
    };
  }
  if (id === "verify-private-mp4-lineage") {
    return {
      schema_version: "videoforge.v2-09-private-mp4-lineage/v1",
      operation_id: id,
      project_id_sha256: `sha256:${"c".repeat(64)}`,
      generation_request_sha256: `sha256:${"a".repeat(64)}`,
      output_id_sha256: `sha256:${"b".repeat(64)}`,
      duration_seconds: 45,
      private_mp4: true,
      lineage_verified: true,
      ffprobe_verified: true,
      playback_verified: true,
      seek_verified: true,
      download_verified: true,
      mp4_sha256: `sha256:${"2".repeat(64)}`,
      lineage_evidence_sha256: `sha256:${"f".repeat(64)}`,
    };
  }
  if (id === "prove-three-zero-compute-reads") {
    const endpointIds = [
      priorResults.find(
        ([operationId]) => operationId === "create-mage-production-lane-max-one",
      )?.[1]?.endpoint_id_sha256,
      priorResults.find(
        ([operationId]) => operationId === "create-soulx-production-lane-max-one",
      )?.[1]?.endpoint_id_sha256,
    ]
      .filter(Boolean)
      .sort();
    return {
      operation_id: id,
      zero_compute_read_count: 3,
      reads: [0, 1, 2].map((second) => ({
        observed_at: `2026-09-06T12:30:0${second}Z`,
        active_worker_count: 0,
        queued_job_count: 0,
        in_progress_job_count: 0,
        running_pod_count: 0,
        endpoint_id_sha256s: endpointIds,
        attributable_running_pod_id_sha256s: [],
      })),
      validated_at: "2026-09-06T12:30:03Z",
    };
  }
  if (id === "read-settled-billing") {
    return {
      operation_id: id,
      settled: true,
      billing_baseline_usd: value.caps.billing_baseline_usd,
      billing_total_usd: value.caps.billing_baseline_usd + (outcome === "SUCCESS" ? 1 : 0),
      completion_total_usd: value.caps.completion_baseline_usd + (outcome === "SUCCESS" ? 1 : 0),
      redispatch_count: 0,
      duplicate_compute_usd: 0,
      terminal_jobs:
        outcome === "SUCCESS"
          ? [
              {
                lane: "mage",
                job_id_sha256: `sha256:${"5".repeat(64)}`,
                status: "COMPLETED",
                cost_usd: 0.4,
              },
              {
                lane: "soulx",
                job_id_sha256: `sha256:${"6".repeat(64)}`,
                status: "COMPLETED",
                cost_usd: 0.6,
              },
            ]
          : [],
      cost_itemization: {
        mage_usd: outcome === "SUCCESS" ? 0.4 : 0,
        soulx_usd: outcome === "SUCCESS" ? 0.6 : 0,
        total_usd: outcome === "SUCCESS" ? 1 : 0,
      },
    };
  }
  if (id === "verify-retained-resources") {
    return {
      operation_id: id,
      retained_volume_count: 2,
      retained_volume_mutated: false,
      retained_volume_monthly_usd: 7,
      production_pair_retained: outcome === "SUCCESS",
      volumes: QUALIFIED_LANES.map((lane) => ({
        lane: lane.lane,
        volume_id_sha256: lane.volume_id_sha256,
        volume_manifest_sha256: lane.volume_manifest_sha256,
        volume_size_gb: lane.volume_size_gb,
        mutated: false,
      })),
    };
  }
  if (id === "reconcile-v209-production-safety") {
    return {
      operation_id: id,
      admission_state: outcome === "SUCCESS" ? "ACTIVE_QUALIFIED" : "DISABLED_CLEAN",
      partial_resources_absent: true,
    };
  }
  if (id === "reconcile-attributable-runpod-work") {
    return {
      operation_id: id,
      active_worker_count: 0,
      queued_job_count: 0,
      in_progress_job_count: 0,
      running_pod_count: 0,
      partial_resources_absent: true,
      production_pair_retained: outcome === "SUCCESS",
    };
  }
  if (id === "clean-v209-transient-r2") {
    return { operation_id: id, transient_keys_absent: true };
  }
  return { operation_id: id };
}

function adapters({ failAt, resultOverrides = {}, calls = [] } = {}) {
  let cleanupOutcome = "SUCCESS";
  const operations = Object.fromEntries(
    OPERATION_IDS.map((id) => [
      id,
      async (context) => {
        calls.push(id);
        cleanupOutcome = context.outcome ?? cleanupOutcome;
        if (id === failAt) throw new Error("untrusted failure detail must not escape");
        const override = resultOverrides[id];
        return typeof override === "function"
          ? override(context)
          : (override ??
              resultFor(id, authority(), context.outcome ?? cleanupOutcome, context.priorResults));
      },
    ]),
  );
  const state = {
    claimAuthority: async ({ authority: value }) => ({
      authority_id: value.authority_id,
      status: "CLAIMED",
      consumed_once: true,
    }),
    beginNormalOperation: async ({ authorityId, operationId }) => ({
      authority_id: authorityId,
      operation_id: operationId,
      status: "STARTED",
      first_start: true,
    }),
    completeNormalOperation: async ({ authorityId, operationId }) => ({
      authority_id: authorityId,
      operation_id: operationId,
      status: "COMPLETED",
    }),
    enterCleanupOnly: async ({ authorityId }) => ({
      authority_id: authorityId,
      status: "CLEANUP_ONLY",
    }),
    loadCleanupAuthority: async ({ authority: value }) => ({
      authority_id: value.authority_id,
      status: "CLEANUP_ONLY",
    }),
    recordCleanupOperation: async ({ authorityId, operationId }) => ({
      authority_id: authorityId,
      operation_id: operationId,
      status: "CLEANUP_RECORDED",
    }),
    completeCleanup: async ({ authorityId }) => ({
      authority_id: authorityId,
      status: "FAILED_CLEAN",
    }),
    completeSuccess: async ({ authorityId }) => ({
      authority_id: authorityId,
      status: "SUCCEEDED_CLEAN",
    }),
    reconcileSuccess: async ({ authorityId }) => ({
      authority_id: authorityId,
      status: "SUCCEEDED_CLEAN",
    }),
  };
  return sealAdapters({ operations, state });
}

function sealAdapters({ operations, state }) {
  const identity_sha256 = deriveInjectedAdapterIdentity({
    operations,
    source_identity: TEST_SOURCE_IDENTITY,
    state,
  });
  return { identity_sha256, operations, source_identity: TEST_SOURCE_IDENTITY, state };
}

testAdapterIdentitySha256 = adapters().identity_sha256;

function executeTest(options) {
  return executeQualifiedProductionForTest({
    testOnlyInjectedAdapters: true,
    currentTime: options.currentTime ?? (() => options.now ?? NOW),
    ...options,
  });
}

test("default CLI is a provider-free, zero-mutation dry run", () => {
  const result = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  const report = JSON.parse(result.stdout);
  assert.equal(report.schema_version, DRY_RUN_SCHEMA);
  assert.equal(report.action, "NO_ACTION");
  assert.equal(report.provider_calls, 0);
  assert.equal(report.remote_mutations, 0);
  assert.equal(report.gpu_jobs, 0);
  assert.equal(report.spend_usd, 0);
  assert.deepEqual(
    report.normal_operations,
    NORMAL_OPERATIONS.map(({ id }) => id),
  );
  assert.deepEqual(
    report.cleanup_only_operations,
    CLEANUP_OPERATIONS.map(({ id }) => id),
  );
  assert.equal(report.stage_6_stage_7, "FROZEN_QUALIFIED_NO_RERUN");
  assert.equal(report.v2_10_plus, "FORBIDDEN");
  assert.equal(report.redispatch, "FORBIDDEN");
  assert.deepEqual(report, dryRunPlan());
});

test("authority is exact, source-bound, current, and fixed to both hard caps", () => {
  assert.equal(
    validateAuthority(authority(), { sourceCommit: SOURCE_COMMIT, now: NOW }).source_commit,
    SOURCE_COMMIT,
  );
  assert.throws(
    () => validateAuthority(authority(), { sourceCommit: "d".repeat(40), now: NOW }),
    /V2_09_AUTHORITY_SOURCE_MISMATCH/u,
  );
  assert.throws(
    () =>
      validateAuthority(authority({ caps: { ...authority().caps, incremental_cap_usd: 2.01 } }), {
        sourceCommit: SOURCE_COMMIT,
        now: NOW,
      }),
    /V2_09_AUTHORITY_CAPS_INVALID/u,
  );
  assert.throws(
    () =>
      validateAuthority(authority({ caps: { ...authority().caps, completion_stop_usd: 18 } }), {
        sourceCommit: SOURCE_COMMIT,
        now: NOW,
      }),
    /V2_09_AUTHORITY_CAPS_INVALID/u,
  );
  assert.throws(
    () =>
      validateAuthority(authority(), { sourceCommit: SOURCE_COMMIT, now: new Date("2026-09-07") }),
    /V2_09_AUTHORITY_NOT_CURRENT/u,
  );
});

test("authority refuses an unknown or later-checkpoint operation and any widened scope", () => {
  const widened = authority({
    scope: {
      ...authority().scope,
      operations: [...OPERATION_IDS.slice(0, -1), "v2-10-pilot"],
    },
  });
  assert.throws(
    () => validateAuthority(widened, { sourceCommit: SOURCE_COMMIT, now: NOW }),
    /V2_09_AUTHORITY_SCOPE_INVALID/u,
  );
  assert.throws(
    () =>
      validateAuthority(
        authority({ scope: { ...authority().scope, allow_stage_6_or_7_qualification: true } }),
        { sourceCommit: SOURCE_COMMIT, now: NOW },
      ),
    /V2_09_AUTHORITY_SCOPE_INVALID/u,
  );
  assert.throws(
    () =>
      validateAuthority(authority({ scope: { ...authority().scope, allow_redispatch: true } }), {
        sourceCommit: SOURCE_COMMIT,
        now: NOW,
      }),
    /V2_09_AUTHORITY_SCOPE_INVALID/u,
  );
});

test("successful execution invokes only the fixed V2-09 graph exactly once", async () => {
  const calls = [];
  const report = await executeTest({
    mode: "EXECUTE",
    authority: authority(),
    sourceCommit: SOURCE_COMMIT,
    now: NOW,
    adapters: adapters({ calls }),
  });
  assert.equal(report.status, "SUCCEEDED_CLEAN");
  assert.equal(report.paid_dispatch_count, 1);
  assert.equal(report.redispatch_count, 0);
  assert.deepEqual(calls, OPERATION_IDS);
  assert.deepEqual(report.operations, OPERATION_IDS);
  assert.equal(calls.filter((id) => id === "run-one-v209-chrome-e2e").length, 1);
  assert.equal(
    calls.some((id) => /v2-1[0-3]|stage-[67]|live-qualification/u.test(id)),
    false,
  );
});

test("unknown injected operation is rejected before authority consumption", async () => {
  let claimed = false;
  await assert.rejects(
    executeTest({
      mode: "EXECUTE",
      authority: authority(),
      sourceCommit: SOURCE_COMMIT,
      now: NOW,
      adapters: {
        identity_sha256: authority().adapter_set_sha256,
        operations: { "v2-10-pilot": async () => ({}) },
        state: {
          claimAuthority: async () => {
            claimed = true;
          },
        },
      },
    }),
    /V2_09_UNKNOWN_OPERATION:v2-10-pilot/u,
  );
  assert.equal(claimed, false);
});

test("normal failure is terminal cleanup-only and the paid dispatch is never retried", async () => {
  const calls = [];
  await assert.rejects(
    executeTest({
      mode: "EXECUTE",
      authority: authority(),
      sourceCommit: SOURCE_COMMIT,
      now: NOW,
      adapters: adapters({ failAt: "run-one-v209-chrome-e2e", calls }),
    }),
    /V2_09_ROLLOUT_FAILED_CLEAN:run-one-v209-chrome-e2e/u,
  );
  assert.equal(calls.filter((id) => id === "run-one-v209-chrome-e2e").length, 1);
  assert.equal(calls.includes("verify-private-mp4-lineage"), false);
  assert.deepEqual(
    calls.slice(-CLEANUP_OPERATIONS.length),
    CLEANUP_OPERATIONS.map(({ id }) => id),
  );
});

test("fresh successor authority may reuse exact migration head and immutable worker release", async () => {
  const calls = [];
  const value = authority();
  const report = await executeTest({
    mode: "EXECUTE",
    authority: value,
    sourceCommit: SOURCE_COMMIT,
    now: NOW,
    adapters: adapters({
      calls,
      resultOverrides: {
        "apply-migrations-0074-0081": {
          operation_id: "apply-migrations-0074-0081",
          mode: "VERIFIED_EXISTING_0081",
          from_version: 81,
          to_version: 81,
          applied_versions: [],
        },
        "publish-media-worker-0.1.15": {
          schema_version: "videoforge.v2-09-media-worker-publication-result/v1",
          operation_id: "publish-media-worker-0.1.15",
          mode: "REUSED_EXACT_EXISTING",
          release: value.media_worker.release,
          execution_bundle_sha256: value.media_worker.execution_bundle_sha256,
          whisper_model_sha256: value.media_worker.whisper_model_sha256,
          release_manifest_sha256: value.media_worker.release_manifest_sha256,
          installer_asset_sha256: value.media_worker.installer_asset_sha256,
          immutable_release: true,
          publish_count: 0,
        },
      },
    }),
  });
  assert.equal(report.status, "SUCCEEDED_CLEAN");
  assert.equal(calls.filter((id) => id === "publish-media-worker-0.1.15").length, 1);
});

test("a cost overrun fails closed and cannot dispatch again", async () => {
  const calls = [];
  const value = authority();
  await assert.rejects(
    executeTest({
      mode: "EXECUTE",
      authority: value,
      sourceCommit: SOURCE_COMMIT,
      now: NOW,
      adapters: adapters({
        calls,
        resultOverrides: {
          "run-one-v209-chrome-e2e": {
            ...resultFor("run-one-v209-chrome-e2e", value),
            billing_total_usd: value.caps.billing_stop_usd + 0.01,
          },
        },
      }),
    }),
    /V2_09_ROLLOUT_FAILED_CLEAN:run-one-v209-chrome-e2e/u,
  );
  assert.equal(calls.filter((id) => id === "run-one-v209-chrome-e2e").length, 1);
  assert.equal(calls.includes("verify-private-mp4-lineage"), false);
});

test("cleanup-only recovery never claims authority or invokes a normal operation", async () => {
  const calls = [];
  const injected = adapters({ calls });
  injected.state.claimAuthority = async () => assert.fail("cleanup must not reclaim authority");
  const sealed = sealAdapters(injected);
  const report = await executeTest({
    mode: "CLEANUP_ONLY",
    authority: authority({ adapter_set_sha256: sealed.identity_sha256 }),
    sourceCommit: SOURCE_COMMIT,
    now: NOW,
    adapters: sealed,
  });
  assert.equal(report.status, "FAILED_CLEAN");
  assert.equal(report.paid_dispatch_count, 0);
  assert.equal(report.redispatch_count, 0);
  assert.deepEqual(
    calls,
    CLEANUP_OPERATIONS.map(({ id }) => id),
  );
});

test("expired authority remains valid only for cleanup-only recovery", async () => {
  const calls = [];
  await assert.rejects(
    executeTest({
      mode: "EXECUTE",
      authority: authority(),
      sourceCommit: SOURCE_COMMIT,
      now: new Date("2026-09-07T00:00:00Z"),
      adapters: adapters({ calls }),
    }),
    /V2_09_AUTHORITY_NOT_CURRENT/u,
  );
  assert.deepEqual(calls, []);
  const report = await executeTest({
    mode: "CLEANUP_ONLY",
    authority: authority(),
    sourceCommit: SOURCE_COMMIT,
    now: new Date("2026-09-07T00:00:00Z"),
    adapters: adapters({ calls }),
  });
  assert.equal(report.status, "FAILED_CLEAN");
  assert.deepEqual(
    calls,
    CLEANUP_OPERATIONS.map(({ id }) => id),
  );
});

test("settled billing beyond either hard cap closes as failed after cleanup proof", async () => {
  const calls = [];
  const value = authority();
  await assert.rejects(
    executeTest({
      mode: "EXECUTE",
      authority: value,
      sourceCommit: SOURCE_COMMIT,
      now: NOW,
      adapters: adapters({
        calls,
        resultOverrides: {
          "read-settled-billing": {
            ...resultFor("read-settled-billing", value, "SUCCESS"),
            billing_total_usd: value.caps.billing_stop_usd + 0.01,
          },
        },
      }),
    }),
    /V2_09_ROLLOUT_FAILED_CLEAN:read-settled-billing/u,
  );
  assert.equal(calls.filter((id) => id === "run-one-v209-chrome-e2e").length, 1);
  assert.deepEqual(
    calls.slice(-CLEANUP_OPERATIONS.length),
    CLEANUP_OPERATIONS.map(({ id }) => id),
  );
  for (const { id } of CLEANUP_OPERATIONS) {
    assert.equal(calls.filter((called) => called === id).length, 2);
  }
});

test("authority store must prove the first normal start before any operation runs", async () => {
  const calls = [];
  const injected = adapters({ calls });
  injected.state.beginNormalOperation = async ({ authorityId, operationId }) => ({
    authority_id: authorityId,
    operation_id: operationId,
    status: "STARTED",
    first_start: false,
  });
  const sealed = sealAdapters(injected);
  await assert.rejects(
    executeTest({
      mode: "EXECUTE",
      authority: authority({ adapter_set_sha256: sealed.identity_sha256 }),
      sourceCommit: SOURCE_COMMIT,
      now: NOW,
      adapters: sealed,
    }),
    /V2_09_ROLLOUT_FAILED_CLEAN:push-clean-source/u,
  );
  assert.equal(calls.includes("push-clean-source"), false);
  assert.deepEqual(
    calls,
    CLEANUP_OPERATIONS.map(({ id }) => id),
  );
});

test("adapter identity is derived from the injected function bodies", async () => {
  let claimed = false;
  const injected = adapters();
  injected.operations["push-clean-source"] = async () => ({ operation_id: "push-clean-source" });
  injected.state.claimAuthority = async () => {
    claimed = true;
  };
  await assert.rejects(
    executeTest({
      mode: "EXECUTE",
      authority: authority(),
      sourceCommit: SOURCE_COMMIT,
      now: NOW,
      adapters: injected,
    }),
    /V2_09_ADAPTER_SET_IDENTITY_MISMATCH/u,
  );
  assert.equal(claimed, false);
});

test("fresh admission rejects future evidence before either lane is created", async () => {
  const calls = [];
  await assert.rejects(
    executeTest({
      mode: "EXECUTE",
      authority: authority(),
      sourceCommit: SOURCE_COMMIT,
      now: NOW,
      adapters: adapters({
        calls,
        resultOverrides: {
          "fresh-read-only-admission": {
            ...resultFor("fresh-read-only-admission", authority()),
            observed_at: "2026-09-06T12:01:00Z",
            validated_at: "2026-09-06T12:01:01Z",
          },
        },
      }),
    }),
    /V2_09_ROLLOUT_FAILED_CLEAN:fresh-read-only-admission/u,
  );
  assert.equal(calls.includes("create-mage-production-lane-max-one"), false);
});

test("authority is rechecked immediately before each external mutation", async () => {
  const calls = [];
  let reads = 0;
  await assert.rejects(
    executeTest({
      mode: "EXECUTE",
      authority: authority(),
      sourceCommit: SOURCE_COMMIT,
      now: NOW,
      currentTime: () => (++reads < 4 ? NOW : new Date("2026-09-06T13:00:00Z")),
      adapters: adapters({ calls }),
    }),
    /V2_09_ROLLOUT_FAILED_CLEAN:apply-migrations-0074-0081/u,
  );
  assert.equal(calls.includes("apply-migrations-0074-0081"), false);
});

test("lane and media proofs reject incomplete immutable bindings", async () => {
  const laneCalls = [];
  const mage = resultFor("create-mage-production-lane-max-one", authority());
  await assert.rejects(
    executeTest({
      mode: "EXECUTE",
      authority: authority(),
      sourceCommit: SOURCE_COMMIT,
      now: NOW,
      adapters: adapters({
        calls: laneCalls,
        resultOverrides: {
          "create-mage-production-lane-max-one": {
            ...mage,
            anonymous_proof_sha256: `sha256:${"0".repeat(64)}`,
          },
        },
      }),
    }),
    /V2_09_ROLLOUT_FAILED_CLEAN:create-mage-production-lane-max-one/u,
  );
  const mediaCalls = [];
  const install = resultFor("install-media-worker-0.1.15", authority());
  await assert.rejects(
    executeTest({
      mode: "EXECUTE",
      authority: authority(),
      sourceCommit: SOURCE_COMMIT,
      now: NOW,
      adapters: adapters({
        calls: mediaCalls,
        resultOverrides: {
          "install-media-worker-0.1.15": { ...install, online: false },
        },
      }),
    }),
    /V2_09_ROLLOUT_FAILED_CLEAN:install-media-worker-0.1.15/u,
  );
});

test("success requires two COMPLETED lane jobs", async () => {
  const value = authority();
  const settlement = resultFor("read-settled-billing", value, "SUCCESS");
  settlement.terminal_jobs[0].status = "FAILED";
  await assert.rejects(
    executeTest({
      mode: "EXECUTE",
      authority: value,
      sourceCommit: SOURCE_COMMIT,
      now: NOW,
      adapters: adapters({ resultOverrides: { "read-settled-billing": settlement } }),
    }),
    /V2_09_ROLLOUT_FAILED_CLEAN:SUCCESS_FINALIZATION/u,
  );
});

test("unknown success acknowledgement is reconciled or transitions through failure cleanup", async () => {
  const acknowledged = adapters();
  acknowledged.state.completeSuccess = async () => {
    throw new Error("ack lost");
  };
  acknowledged.state.reconcileSuccess = async ({ authorityId }) => ({
    authority_id: authorityId,
    status: "SUCCEEDED_CLEAN",
  });
  const sealedAcknowledged = sealAdapters(acknowledged);
  const success = await executeTest({
    mode: "EXECUTE",
    authority: authority({ adapter_set_sha256: sealedAcknowledged.identity_sha256 }),
    sourceCommit: SOURCE_COMMIT,
    now: NOW,
    adapters: sealedAcknowledged,
  });
  assert.equal(success.status, "SUCCEEDED_CLEAN");

  const calls = [];
  const unknown = adapters({ calls });
  unknown.state.completeSuccess = async () => {
    throw new Error("ack lost");
  };
  unknown.state.reconcileSuccess = async ({ authorityId }) => ({
    authority_id: authorityId,
    status: "NOT_SUCCEEDED",
  });
  const sealedUnknown = sealAdapters(unknown);
  await assert.rejects(
    executeTest({
      mode: "EXECUTE",
      authority: authority({ adapter_set_sha256: sealedUnknown.identity_sha256 }),
      sourceCommit: SOURCE_COMMIT,
      now: NOW,
      adapters: sealedUnknown,
    }),
    /V2_09_ROLLOUT_FAILED_CLEAN:SUCCESS_COMPLETION_ACK_UNKNOWN/u,
  );
  for (const { id } of CLEANUP_OPERATIONS)
    assert.equal(calls.filter((called) => called === id).length, 2);
});

test("live execution requires the sealed concrete configuration", async () => {
  await assert.rejects(
    executeQualifiedProduction({
      mode: "EXECUTE",
      authority: authority(),
      sourceCommit: SOURCE_COMMIT,
    }),
    /V2_09_LIVE_CONFIGURATION_REQUIRED/u,
  );
  await assert.rejects(
    executeQualifiedProduction({
      mode: "EXECUTE",
      authority: authority(),
      sourceCommit: SOURCE_COMMIT,
      configuration: {},
      now: NOW,
    }),
    /V2_09_LIVE_OPTION_INVALID/u,
  );
});

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  promoteQualifiedProduction,
  renderQualifiedConfig,
} from "../../deploy/v2-13/promote-qualified-production.mjs";
import {
  ACTIVATED_ASSETS_PATH,
  ACTIVATED_MAIN_PATH,
  parseProductionConfig,
  TEMPLATE_PATH,
  validateProductionConfig,
} from "../../deploy/v2-13/validate-production-config.mjs";

const hash = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const proof = (letter) => `sha256:${letter.repeat(64)}`;
const commit = "a".repeat(40);

const releaseManifest = {
  schema_version: "videoforge-media-worker-release/v1",
  version: "1.0.0",
  minimum_protocol_version: 1,
  execution_bundle_sha256: proof("1"),
  whisper_model_sha256: proof("2"),
  windows: {
    url: "https://downloads.videoforge.example/worker.exe",
    sha256: proof("3"),
    size_bytes: 1024,
    trust: "AUTHENTICODE_SIGNED",
  },
  macos: {
    url: "https://downloads.videoforge.example/worker.dmg",
    sha256: proof("4"),
    size_bytes: 2048,
    trust: "DEVELOPER_ID_NOTARIZED",
  },
};

function fixture() {
  const disabled = parseProductionConfig(readFileSync(TEMPLATE_PATH, "utf8"));
  disabled.main = ACTIVATED_MAIN_PATH;
  disabled.assets.directory = ACTIVATED_ASSETS_PATH;
  disabled.account_id = "b".repeat(32);
  disabled.r2_buckets[0].bucket_name = "videoforge-production-private";
  disabled.workflows[0].name = "videoforge-production-video";
  disabled.workflows[1].name = "videoforge-production-video-pair";
  Object.assign(disabled.vars, {
    VIDEOFORGE_COMMIT: commit,
    VIDEOFORGE_PUBLIC_ORIGIN: "https://app.videoforge.example",
    R2_ACCOUNT_ID: disabled.account_id,
    VIDEOFORGE_R2_BUCKET_NAME: disabled.r2_buckets[0].bucket_name,
    MEDIA_WORKER_RELEASE_MANIFEST_JSON: JSON.stringify(releaseManifest),
  });
  validateProductionConfig(disabled, { mode: "activated" });
  const disabledBytes = Buffer.from(`${JSON.stringify(disabled, null, 2)}\n`);
  const enabled = structuredClone(disabled);
  enabled.vars.VIDEOFORGE_GPU_TRANSPORT = "QUALIFIED_EXACT";
  const enabledBytes = Buffer.from(`${JSON.stringify(enabled, null, 2)}\n`);
  const record = {
    schema_version: "videoforge.v2-13-qualified-promotion/v1",
    approval: {
      authority_id: "v2-13-qualified-promotion-test",
      approved_at: "2026-08-26T00:00:00.000Z",
      proposal_sha256: proof("5"),
      approval_sha256: proof("6"),
      expires_at: "2026-08-27T00:00:00.000Z",
      single_use: true,
    },
    release: {
      commit,
      disabled_config_sha256: hash(disabledBytes),
      enabled_config_sha256: hash(enabledBytes),
    },
    database: {
      activation_id: "33333333-3333-4333-8333-333333333333",
      authority_document_sha256: proof("7"),
      executor_sha256: proof("0"),
      full_live_authority_id: "44444444-4444-4444-8444-444444444444",
      migration_ledger_sha256: proof("8"),
      paid_approval_sha256: proof("9"),
      promotion_id: "55555555-5555-4555-8555-555555555555",
      rollback_id: "88888888-8888-4888-8888-888888888888",
    },
    lanes: {
      mage_image: {
        deployment_id: "11111111-1111-4111-8111-111111111111",
        qualification_id: "66666666-6666-4666-8666-666666666666",
        qualification_record_sha256: proof("a"),
        deployment_snapshot_sha256: proof("b"),
      },
      soulx_avatar: {
        deployment_id: "22222222-2222-4222-8222-222222222222",
        qualification_id: "77777777-7777-4777-8777-777777777777",
        qualification_record_sha256: proof("c"),
        deployment_snapshot_sha256: proof("d"),
      },
    },
    cloudflare: {
      account_id_sha256: proof("e"),
      disabled_version_id: "88888888-8888-4888-8888-888888888888",
      disabled_version_sha256: hash(Buffer.from("88888888-8888-4888-8888-888888888888")),
      worker_name: "videoforge-production-runtime",
      workflow_name: "videoforge-production-video",
      public_origin: "https://app.videoforge.example",
    },
  };
  return { disabledBytes, enabledBytes, record };
}

function databaseSnapshot(record) {
  return {
    decision_sha256: proof("7"),
    migration_ledger_sha256: record.database.migration_ledger_sha256,
    database_now: "2026-08-26T12:00:00.000Z",
  };
}

test("qualified renderer permits exactly the one GPU transport transition", () => {
  const { disabledBytes, enabledBytes, record } = fixture();
  const rendered = renderQualifiedConfig(disabledBytes, record);
  assert.deepEqual(rendered.bytes, enabledBytes);
  assert.deepEqual(validateProductionConfig(rendered.config, { mode: "qualified" }), {
    mode: "qualified",
    gpu_transport: "QUALIFIED_EXACT",
    valid: true,
  });
});

test("promotion validates one atomic DB snapshot then deploys and reads exact enabled state", async () => {
  const { disabledBytes, record } = fixture();
  const calls = [];
  const result = await promoteQualifiedProduction({
    record,
    disabledConfigBytes: disabledBytes,
    transport: {
      promoteDatabase: async () => {
        calls.push("database");
        return databaseSnapshot(record);
      },
      dryRun: async (bytes) => {
        calls.push("dry-run");
        return {
          configSha256: hash(bytes),
          bundleSha256: proof("1"),
          productionFirewallPassed: true,
          gpuDispatchPerformed: false,
          cloudflareMutationPerformed: false,
        };
      },
      deploy: async (bytes) => {
        calls.push("deploy");
        return {
          configSha256: hash(bytes),
          versionSha256: proof("2"),
          gpuDispatchPerformed: false,
          cloudflareMutationPerformed: true,
        };
      },
      readback: async () => {
        calls.push("readback");
        return {
          versionSha256: proof("2"),
          configSha256: record.release.enabled_config_sha256,
          workerName: record.cloudflare.worker_name,
          workflowName: record.cloudflare.workflow_name,
          pairWorkflowName: `${record.cloudflare.workflow_name}-pair`,
          publicOrigin: record.cloudflare.public_origin,
          gpuTransport: "QUALIFIED_EXACT",
          exactBindings: true,
          routeReady: true,
          routeStatus: 200,
          routeVersionSha256: proof("2"),
          gpuDispatchPerformed: false,
          cloudflareMutationPerformed: false,
          evidenceSha256: proof("3"),
        };
      },
      recordActivation: async (readback) => {
        calls.push("record-activation");
        return {
          versionIdSha256: readback.versionIdSha256,
          deployedExecutableSha256: readback.deployedExecutableSha256,
          deployedConfigSha256: readback.deployedConfigSha256,
          productionUrlSha256: readback.productionUrlSha256,
          routeStatus: readback.routeStatus,
          routeBodySha256: readback.routeBodySha256,
          routeVersionSha256: readback.routeVersionSha256,
          routeReadbackSha256: readback.routeReadbackSha256,
          readbackSha256: proof("4"),
        };
      },
      routeReadback: async () => {
        calls.push("route-readback");
        return {
          routeReady: true,
          routeStatus: 200,
          routeVersionSha256: proof("2"),
          productionUrlSha256: proof("5"),
          routeBodySha256: proof("6"),
          gpuTransport: "QUALIFIED_EXACT",
          gpuDispatchPerformed: false,
          cloudflareMutationPerformed: false,
        };
      },
      rollback: async () => assert.fail("rollback must not run"),
      recordRollback: async () => assert.fail("rollback must not be recorded"),
    },
  });
  assert.deepEqual(calls, [
    "database",
    "dry-run",
    "deploy",
    "readback",
    "route-readback",
    "record-activation",
  ]);
  assert.equal(result.enabled, true);
  assert.equal(result.gpuDispatchPerformed, false);
  assert.equal(result.cloudflareMutationPerformed, true);
  assert.match(result.databasePromotionSha256, /^sha256:[0-9a-f]{64}$/u);
});

test("route drift rolls back before any activation record exists", async () => {
  const { disabledBytes, record } = fixture();
  const calls = [];
  await assert.rejects(
    promoteQualifiedProduction({
      record,
      disabledConfigBytes: disabledBytes,
      transport: {
        promoteDatabase: async () => databaseSnapshot(record),
        dryRun: async () => ({
          configSha256: record.release.enabled_config_sha256,
          bundleSha256: proof("1"),
          productionFirewallPassed: true,
          gpuDispatchPerformed: false,
          cloudflareMutationPerformed: false,
        }),
        deploy: async () => ({
          configSha256: record.release.enabled_config_sha256,
          versionSha256: proof("2"),
          gpuDispatchPerformed: false,
          cloudflareMutationPerformed: true,
        }),
        readback: async () => ({
          versionSha256: proof("2"),
          configSha256: record.release.enabled_config_sha256,
          workerName: record.cloudflare.worker_name,
          workflowName: record.cloudflare.workflow_name,
          pairWorkflowName: `${record.cloudflare.workflow_name}-pair`,
          publicOrigin: record.cloudflare.public_origin,
          gpuTransport: "QUALIFIED_EXACT",
          exactBindings: true,
          gpuDispatchPerformed: false,
          cloudflareMutationPerformed: false,
          evidenceSha256: proof("3"),
        }),
        recordActivation: async () => assert.fail("invalid route must not be recorded"),
        routeReadback: async () => ({ routeReady: false, routeStatus: 503 }),
        rollback: async () => ({
          gpuTransport: "DISABLED_UNQUALIFIED",
          configSha256: record.release.disabled_config_sha256,
          versionSha256: record.cloudflare.disabled_version_sha256,
          gpuDispatchPerformed: false,
          cloudflareMutationPerformed: true,
          routeDisabled: true,
          routeStatus: 503,
          routeVersionSha256: record.cloudflare.disabled_version_sha256,
          observedAt: "2026-08-26T00:00:00.000Z",
        }),
        recordRollback: async (input) => {
          calls.push(input);
          return {
            rollbackSha256: proof("5"),
            disabledVersionIdSha256: input.disabledVersionIdSha256,
            disabledConfigSha256: input.disabledConfigSha256,
          };
        },
      },
    }),
    /ACTIVATION_ROUTE_READBACK/u,
  );
  assert.equal(calls.length, 0);
});

test("promotion rejects a Cloudflare deploy that claims no external mutation", async () => {
  const { disabledBytes, record } = fixture();
  await assert.rejects(
    promoteQualifiedProduction({
      record,
      disabledConfigBytes: disabledBytes,
      transport: {
        promoteDatabase: async () => databaseSnapshot(record),
        dryRun: async () => ({
          configSha256: record.release.enabled_config_sha256,
          bundleSha256: proof("1"),
          productionFirewallPassed: true,
          gpuDispatchPerformed: false,
          cloudflareMutationPerformed: false,
        }),
        deploy: async () => ({
          configSha256: record.release.enabled_config_sha256,
          versionSha256: proof("2"),
          gpuDispatchPerformed: false,
          cloudflareMutationPerformed: false,
        }),
        readback: async () => assert.fail("invalid deploy must not be read back"),
        recordActivation: async () => assert.fail("invalid deploy must not be recorded"),
        routeReadback: async () => assert.fail("invalid deploy must not reach the route"),
        rollback: async () => ({
          gpuTransport: "DISABLED_UNQUALIFIED",
          configSha256: record.release.disabled_config_sha256,
          versionSha256: record.cloudflare.disabled_version_sha256,
          gpuDispatchPerformed: false,
          cloudflareMutationPerformed: true,
          routeDisabled: true,
          routeStatus: 503,
          routeVersionSha256: record.cloudflare.disabled_version_sha256,
          observedAt: "2026-08-26T00:00:00.000Z",
        }),
        recordRollback: async () => assert.fail("rollback record requires an activation"),
      },
    }),
    /DEPLOY_RESULT/u,
  );
});

test("readback mismatch rolls back only to the exact disabled quarantine", async () => {
  const { disabledBytes, record } = fixture();
  let rollbackCalls = 0;
  await assert.rejects(
    promoteQualifiedProduction({
      record,
      disabledConfigBytes: disabledBytes,
      transport: {
        promoteDatabase: async () => databaseSnapshot(record),
        dryRun: async () => ({
          configSha256: record.release.enabled_config_sha256,
          bundleSha256: proof("1"),
          productionFirewallPassed: true,
          gpuDispatchPerformed: false,
          cloudflareMutationPerformed: false,
        }),
        deploy: async () => ({
          configSha256: record.release.enabled_config_sha256,
          versionSha256: proof("2"),
          gpuDispatchPerformed: false,
          cloudflareMutationPerformed: true,
        }),
        readback: async () => ({ gpuTransport: "DISABLED_UNQUALIFIED" }),
        recordActivation: async () => assert.fail("activation must not be recorded"),
        routeReadback: async () => assert.fail("route must not be read"),
        rollback: async (bytes) => {
          rollbackCalls += 1;
          assert.deepEqual(bytes, disabledBytes);
          return {
            gpuTransport: "DISABLED_UNQUALIFIED",
            configSha256: record.release.disabled_config_sha256,
            versionSha256: record.cloudflare.disabled_version_sha256,
            gpuDispatchPerformed: false,
            cloudflareMutationPerformed: true,
            routeDisabled: true,
            routeStatus: 503,
            routeVersionSha256: record.cloudflare.disabled_version_sha256,
            observedAt: "2026-08-26T00:00:00.000Z",
          };
        },
        recordRollback: async () => assert.fail("rollback record requires an activation"),
      },
    }),
    /DEPLOY_READBACK/u,
  );
  assert.equal(rollbackCalls, 1);
});

test("promotion tool is zero-action by default", () => {
  const result = spawnSync(process.execPath, ["deploy/v2-13/promote-qualified-production.mjs"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    state: "NO_ACTION",
    database_reads: 0,
    provider_calls: 0,
    mutations: 0,
    provider_sends: 0,
    spend_usd: 0,
  });
});

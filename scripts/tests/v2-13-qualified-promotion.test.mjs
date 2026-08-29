import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createPromotionJournalEntry,
  promoteQualifiedProduction,
  reconcileQualifiedProductionCleanup,
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

function recoverableTransport(base, durable = {}) {
  const journalEntries = durable.journalEntries ?? new Map();
  const state = durable.state ?? {};
  const key = ({ promotionId, step, status }) => `${promotionId}:${step}:${status}`;
  const exactRecord = (entry) => {
    const entryKey = key(entry);
    const existing = journalEntries.get(entryKey);
    if (existing !== undefined) assert.deepEqual(existing, entry);
    else journalEntries.set(entryKey, structuredClone(entry));
    return structuredClone(journalEntries.get(entryKey));
  };
  const transport = {
    ...base,
    promoteDatabase: async (...args) => {
      const value = await base.promoteDatabase(...args);
      state.databasePromotion = structuredClone(value);
      return value;
    },
    deploy: async (...args) => {
      const value = await base.deploy(...args);
      state.deployment = structuredClone(value);
      return value;
    },
    recordActivation: async (...args) => {
      const value = await base.recordActivation(...args);
      state.activation = structuredClone(value);
      return value;
    },
    rollback: async (...args) => {
      const value = await base.rollback(...args);
      state.rollback = structuredClone(value);
      return value;
    },
    recordRollback: async (...args) => {
      const value = await base.recordRollback(...args);
      state.rollbackRecord = structuredClone(value);
      return value;
    },
    recordDisabledPromotionClosure: async (...args) => {
      const input = args[0];
      const value =
        typeof base.recordDisabledPromotionClosure === "function"
          ? await base.recordDisabledPromotionClosure(...args)
          : {
              rollbackSha256: proof("8"),
              disabledVersionIdSha256: input.closure.disabledVersionIdSha256,
              disabledConfigSha256: input.closure.disabledConfigSha256,
            };
      state.disabledPromotionClosure = structuredClone(value);
      return value;
    },
  };
  transport.recovery = {
    journal: {
      read: async (lookup) => structuredClone(journalEntries.get(key(lookup)) ?? null),
      record: async (entry) => exactRecord(entry),
    },
    reconcileDatabasePromotion: async () => structuredClone(state.databasePromotion ?? null),
    reconcileDeployment: async () => structuredClone(state.deployment ?? null),
    reconcileActivation: async () => structuredClone(state.activation ?? null),
    readDisabledDeployment: async () => structuredClone(state.rollback ?? null),
    reconcileRollback: async () => structuredClone(state.rollback ?? null),
    reconcileRollbackRecord: async () => structuredClone(state.rollbackRecord ?? null),
    reconcileDisabledPromotionClosure: async () =>
      structuredClone(state.disabledPromotionClosure ?? null),
  };
  return { transport, journalEntries, state };
}

function promotionValues(record) {
  const database = databaseSnapshot(record);
  const dryRun = {
    configSha256: record.release.enabled_config_sha256,
    bundleSha256: proof("1"),
    productionFirewallPassed: true,
    gpuDispatchPerformed: false,
    cloudflareMutationPerformed: false,
  };
  const deployment = {
    configSha256: record.release.enabled_config_sha256,
    versionSha256: proof("2"),
    gpuDispatchPerformed: false,
    cloudflareMutationPerformed: true,
  };
  const readback = {
    versionSha256: deployment.versionSha256,
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
  };
  const route = {
    routeReady: true,
    routeStatus: 200,
    routeVersionSha256: deployment.versionSha256,
    productionUrlSha256: proof("5"),
    routeBodySha256: proof("6"),
    gpuTransport: "QUALIFIED_EXACT",
    gpuDispatchPerformed: false,
    cloudflareMutationPerformed: false,
  };
  const routeReadbackSha256 = hash(
    Buffer.from(
      JSON.stringify({
        productionUrlSha256: route.productionUrlSha256,
        routeStatus: route.routeStatus,
        routeBodySha256: route.routeBodySha256,
        routeVersionSha256: route.routeVersionSha256,
        gpuTransport: route.gpuTransport,
      }),
    ),
  );
  const activationInput = {
    activationId: record.database.activation_id,
    promotionId: record.database.promotion_id,
    sourceCommit: record.release.commit,
    versionIdSha256: readback.versionSha256,
    deployedExecutableSha256: dryRun.bundleSha256,
    deployedConfigSha256: readback.configSha256,
    productionUrlSha256: route.productionUrlSha256,
    routeStatus: route.routeStatus,
    routeBodySha256: route.routeBodySha256,
    routeVersionSha256: route.routeVersionSha256,
    routeReadbackSha256,
    observedAt: database.database_now,
    evidenceSha256: readback.evidenceSha256,
  };
  const activation = {
    versionIdSha256: activationInput.versionIdSha256,
    deployedExecutableSha256: activationInput.deployedExecutableSha256,
    deployedConfigSha256: activationInput.deployedConfigSha256,
    productionUrlSha256: activationInput.productionUrlSha256,
    routeStatus: activationInput.routeStatus,
    routeBodySha256: activationInput.routeBodySha256,
    routeVersionSha256: activationInput.routeVersionSha256,
    routeReadbackSha256: activationInput.routeReadbackSha256,
    readbackSha256: proof("4"),
  };
  const rollback = {
    gpuTransport: "DISABLED_UNQUALIFIED",
    configSha256: record.release.disabled_config_sha256,
    versionSha256: record.cloudflare.disabled_version_sha256,
    gpuDispatchPerformed: false,
    cloudflareMutationPerformed: false,
    routeDisabled: true,
    routeStatus: 503,
    routeVersionSha256: record.cloudflare.disabled_version_sha256,
    observedAt: "2026-08-26T12:01:00.000Z",
  };
  const rollbackRecordInput = {
    rollbackId: record.database.rollback_id,
    activationId: record.database.activation_id,
    promotionId: record.database.promotion_id,
    disabledVersionIdSha256: rollback.versionSha256,
    disabledConfigSha256: rollback.configSha256,
    routeStatus: rollback.routeStatus,
    routeVersionSha256: rollback.routeVersionSha256,
    observedAt: rollback.observedAt,
  };
  const rollbackRecord = {
    rollbackSha256: proof("7"),
    disabledVersionIdSha256: rollback.versionSha256,
    disabledConfigSha256: rollback.configSha256,
  };
  return {
    database,
    dryRun,
    deployment,
    readback,
    route,
    activationInput,
    activation,
    rollback,
    rollbackRecordInput,
    rollbackRecord,
  };
}

function standardPromotionTransport(record, calls = []) {
  const values = promotionValues(record);
  return {
    values,
    base: {
      promoteDatabase: async () => {
        calls.push("database");
        return values.database;
      },
      dryRun: async () => {
        calls.push("dry-run");
        return values.dryRun;
      },
      deploy: async () => {
        calls.push("deploy");
        return values.deployment;
      },
      readback: async () => {
        calls.push("readback");
        return values.readback;
      },
      routeReadback: async () => {
        calls.push("route-readback");
        return values.route;
      },
      recordActivation: async () => {
        calls.push("record-activation");
        return values.activation;
      },
      rollback: async () => {
        calls.push("rollback");
        return { ...values.rollback, cloudflareMutationPerformed: true };
      },
      recordRollback: async () => {
        calls.push("record-rollback");
        return values.rollbackRecord;
      },
    },
  };
}

function seedJournal(journalEntries, entry) {
  journalEntries.set(`${entry.promotionId}:${entry.step}:${entry.status}`, structuredClone(entry));
}

function journalEntry(record, step, status, input, output = null) {
  return createPromotionJournalEntry({ record, step, status, input, output });
}

function databasePromotionInputFor(record) {
  return {
    authorityId: record.database.full_live_authority_id,
    promotionId: record.database.promotion_id,
    promotion: {
      authorityDocumentSha256: record.database.authority_document_sha256,
      sourceCommit: record.release.commit,
      executorSha256: record.database.executor_sha256,
      migrationLedgerSha256: record.database.migration_ledger_sha256,
      lanes: Object.fromEntries(
        Object.entries(record.lanes).map(([lane, item]) => [
          lane,
          {
            qualificationId: item.qualification_id,
            qualificationSha256: item.qualification_record_sha256,
            deploymentId: item.deployment_id,
            deploymentSnapshotSha256: item.deployment_snapshot_sha256,
          },
        ]),
      ),
      disabledConfigSha256: record.release.disabled_config_sha256,
      enabledConfigSha256: record.release.enabled_config_sha256,
    },
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
    transport: recoverableTransport({
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
    }).transport,
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
      transport: recoverableTransport({
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
        recordDisabledPromotionClosure: async (input) => {
          calls.push(input);
          return {
            rollbackSha256: proof("5"),
            disabledVersionIdSha256: input.closure.disabledVersionIdSha256,
            disabledConfigSha256: input.closure.disabledConfigSha256,
          };
        },
      }).transport,
    }),
    /ACTIVATION_ROUTE_READBACK/u,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].promotionId, record.database.promotion_id);
  assert.equal(calls[0].closure.routeStatus, 503);
});

test("cleanup reconciles ambiguous database promotion and records disabled closure without op15 redispatch", async () => {
  const { disabledBytes, record } = fixture();
  const values = promotionValues(record);
  const calls = [];
  const durable = recoverableTransport(
    {
      promoteDatabase: async () => assert.fail("database promotion must not be redispatched"),
      dryRun: async () => assert.fail("dry run must not run"),
      deploy: async () => assert.fail("deploy must not run"),
      readback: async () => assert.fail("readback must not run"),
      routeReadback: async () => assert.fail("route readback must not run"),
      recordActivation: async () => assert.fail("activation must not run"),
      rollback: async () => assert.fail("already-disabled provider must not mutate"),
      recordRollback: async () => assert.fail("activation rollback record must not run"),
      recordDisabledPromotionClosure: async (input) => {
        calls.push(input);
        return values.rollbackRecord;
      },
    },
    { state: { databasePromotion: values.database, rollback: values.rollback } },
  );
  const promotionInput = databasePromotionInputFor(record);
  seedJournal(
    durable.journalEntries,
    journalEntry(record, "DATABASE_PROMOTION", "INTENT", promotionInput),
  );
  const result = await reconcileQualifiedProductionCleanup({
    record,
    disabledConfigBytes: disabledBytes,
    transport: durable.transport,
  });
  assert.equal(result.databasePromotionAttempted, true);
  assert.equal(result.databasePromotionSha256, values.database.decision_sha256);
  assert.equal(result.rollbackRecorded, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].closure.schemaVersion, "videoforge.v213-disabled-promotion-closure/v1");
});

test("promotion rejects a Cloudflare deploy that claims no external mutation", async () => {
  const { disabledBytes, record } = fixture();
  await assert.rejects(
    promoteQualifiedProduction({
      record,
      disabledConfigBytes: disabledBytes,
      transport: recoverableTransport({
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
      }).transport,
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
      transport: recoverableTransport({
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
      }).transport,
    }),
    /DEPLOY_READBACK/u,
  );
  assert.equal(rollbackCalls, 1);
});

test("database lost ACK is reconciled from the durable intent without a second mutation", async () => {
  const { disabledBytes, record } = fixture();
  const calls = [];
  const state = {};
  let reconciliationAvailable = false;
  const { base, values } = standardPromotionTransport(record, calls);
  base.promoteDatabase = async () => {
    calls.push("database");
    state.databasePromotion = structuredClone(values.database);
    throw new Error("database ACK lost after commit");
  };
  const durable = recoverableTransport(base, { state });
  durable.transport.recovery.reconcileDatabasePromotion = async () => {
    if (!reconciliationAvailable) throw new Error("simulated hard crash");
    return structuredClone(state.databasePromotion);
  };
  await assert.rejects(
    promoteQualifiedProduction({
      record,
      disabledConfigBytes: disabledBytes,
      transport: durable.transport,
    }),
    /DATABASE_PROMOTION_ACK_UNKNOWN/u,
  );
  reconciliationAvailable = true;
  const result = await promoteQualifiedProduction({
    record,
    disabledConfigBytes: disabledBytes,
    transport: durable.transport,
  });
  assert.equal(result.enabled, true);
  assert.equal(calls.filter((value) => value === "database").length, 1);
  assert.equal(calls.filter((value) => value === "deploy").length, 1);
});

test("restart after an ambiguous Cloudflare deploy only reads it back and never redeploys", async () => {
  const { disabledBytes, record } = fixture();
  const calls = [];
  const { base, values } = standardPromotionTransport(record, calls);
  const durable = recoverableTransport(base, { state: { deployment: values.deployment } });
  const deployInput = {
    enabledConfigSha256: record.release.enabled_config_sha256,
    workerName: record.cloudflare.worker_name,
  };
  seedJournal(
    durable.journalEntries,
    journalEntry(record, "CLOUDFLARE_DEPLOY", "INTENT", deployInput),
  );
  const result = await promoteQualifiedProduction({
    record,
    disabledConfigBytes: disabledBytes,
    transport: durable.transport,
  });
  assert.equal(result.enabled, true);
  assert.equal(calls.includes("deploy"), false);
  assert.deepEqual(calls, [
    "database",
    "dry-run",
    "readback",
    "route-readback",
    "record-activation",
  ]);
});

test("restart after deploy readback reruns only safe readbacks before activation", async () => {
  const { disabledBytes, record } = fixture();
  const calls = [];
  const { base, values } = standardPromotionTransport(record, calls);
  const durable = recoverableTransport(base);
  seedJournal(
    durable.journalEntries,
    journalEntry(
      record,
      "CLOUDFLARE_DEPLOY",
      "CONFIRMED",
      {
        enabledConfigSha256: record.release.enabled_config_sha256,
        workerName: record.cloudflare.worker_name,
      },
      values.deployment,
    ),
  );
  await promoteQualifiedProduction({
    record,
    disabledConfigBytes: disabledBytes,
    transport: durable.transport,
  });
  assert.equal(calls.includes("deploy"), false);
  assert.equal(calls.filter((value) => value === "readback").length, 1);
  assert.equal(calls.filter((value) => value === "route-readback").length, 1);
});

test("restart after route readback never redeploys and repeats only safe readbacks", async () => {
  const { disabledBytes, record } = fixture();
  const calls = [];
  const { base, values } = standardPromotionTransport(record, calls);
  const durable = recoverableTransport(base);
  seedJournal(
    durable.journalEntries,
    journalEntry(
      record,
      "CLOUDFLARE_DEPLOY",
      "CONFIRMED",
      {
        enabledConfigSha256: record.release.enabled_config_sha256,
        workerName: record.cloudflare.worker_name,
      },
      values.deployment,
    ),
  );
  seedJournal(
    durable.journalEntries,
    journalEntry(
      record,
      "CLOUDFLARE_READBACK",
      "CONFIRMED",
      {
        enabledConfigSha256: record.release.enabled_config_sha256,
        versionSha256: values.deployment.versionSha256,
      },
      values.readback,
    ),
  );
  await promoteQualifiedProduction({
    record,
    disabledConfigBytes: disabledBytes,
    transport: durable.transport,
  });
  assert.equal(calls.includes("deploy"), false);
  assert.equal(calls.filter((value) => value === "readback").length, 1);
  assert.equal(calls.filter((value) => value === "route-readback").length, 1);
  assert.equal(calls.filter((value) => value === "record-activation").length, 1);
});

test("restart after a confirmed route readback revalidates the route before one activation", async () => {
  const { disabledBytes, record } = fixture();
  const calls = [];
  const { base, values } = standardPromotionTransport(record, calls);
  const durable = recoverableTransport(base);
  for (const [step, input, output] of [
    [
      "CLOUDFLARE_DEPLOY",
      {
        enabledConfigSha256: record.release.enabled_config_sha256,
        workerName: record.cloudflare.worker_name,
      },
      values.deployment,
    ],
    [
      "CLOUDFLARE_READBACK",
      {
        enabledConfigSha256: record.release.enabled_config_sha256,
        versionSha256: values.deployment.versionSha256,
      },
      values.readback,
    ],
    [
      "ROUTE_READBACK",
      {
        versionSha256: values.deployment.versionSha256,
        publicOrigin: record.cloudflare.public_origin,
      },
      values.route,
    ],
  ])
    seedJournal(durable.journalEntries, journalEntry(record, step, "CONFIRMED", input, output));
  await promoteQualifiedProduction({
    record,
    disabledConfigBytes: disabledBytes,
    transport: durable.transport,
  });
  assert.equal(calls.includes("deploy"), false);
  assert.equal(calls.filter((value) => value === "readback").length, 1);
  assert.equal(calls.filter((value) => value === "route-readback").length, 1);
  assert.equal(calls.filter((value) => value === "record-activation").length, 1);
});

test("activation ACK_UNKNOWN uses exact idempotent reconciliation and never inserts twice", async () => {
  const { disabledBytes, record } = fixture();
  const calls = [];
  const { base, values } = standardPromotionTransport(record, calls);
  const durable = recoverableTransport(base, { state: { activation: values.activation } });
  for (const [step, input, output] of [
    [
      "CLOUDFLARE_DEPLOY",
      {
        enabledConfigSha256: record.release.enabled_config_sha256,
        workerName: record.cloudflare.worker_name,
      },
      values.deployment,
    ],
    [
      "CLOUDFLARE_READBACK",
      {
        enabledConfigSha256: record.release.enabled_config_sha256,
        versionSha256: values.deployment.versionSha256,
      },
      values.readback,
    ],
    [
      "ROUTE_READBACK",
      {
        versionSha256: values.deployment.versionSha256,
        publicOrigin: record.cloudflare.public_origin,
      },
      values.route,
    ],
  ])
    seedJournal(durable.journalEntries, journalEntry(record, step, "CONFIRMED", input, output));
  seedJournal(
    durable.journalEntries,
    journalEntry(record, "ACTIVATION_RECORD", "INTENT", values.activationInput),
  );
  const result = await promoteQualifiedProduction({
    record,
    disabledConfigBytes: disabledBytes,
    transport: durable.transport,
  });
  assert.equal(result.enabled, true);
  assert.equal(calls.includes("deploy"), false);
  assert.equal(calls.includes("record-activation"), false);
});

test("cleanup reconciles rollback ACK_UNKNOWN and records the activation rollback once", async () => {
  const { disabledBytes, record } = fixture();
  const calls = [];
  const { base, values } = standardPromotionTransport(record, calls);
  const durable = recoverableTransport(base, {
    state: {
      databasePromotion: values.database,
      activation: values.activation,
      rollback: values.rollback,
    },
  });
  seedJournal(
    durable.journalEntries,
    journalEntry(
      record,
      "DATABASE_PROMOTION",
      "CONFIRMED",
      databasePromotionInputFor(record),
      values.database,
    ),
  );
  seedJournal(
    durable.journalEntries,
    journalEntry(
      record,
      "ACTIVATION_RECORD",
      "CONFIRMED",
      values.activationInput,
      values.activation,
    ),
  );
  seedJournal(
    durable.journalEntries,
    journalEntry(record, "CLOUDFLARE_ROLLBACK", "INTENT", {
      disabledConfigSha256: record.release.disabled_config_sha256,
      disabledVersionSha256: record.cloudflare.disabled_version_sha256,
      workerName: record.cloudflare.worker_name,
      publicOrigin: record.cloudflare.public_origin,
    }),
  );
  const result = await reconcileQualifiedProductionCleanup({
    record,
    disabledConfigBytes: disabledBytes,
    transport: durable.transport,
  });
  assert.equal(result.state, "DISABLED_UNQUALIFIED");
  assert.equal(result.rollbackRecorded, true);
  assert.equal(calls.includes("rollback"), false);
  assert.equal(calls.filter((value) => value === "record-rollback").length, 1);
});

test("rollback-record ACK_UNKNOWN is reconciled without a second database insert", async () => {
  const { disabledBytes, record } = fixture();
  const calls = [];
  const { base, values } = standardPromotionTransport(record, calls);
  const durable = recoverableTransport(base, {
    state: {
      databasePromotion: values.database,
      activation: values.activation,
      rollback: values.rollback,
      rollbackRecord: values.rollbackRecord,
    },
  });
  seedJournal(
    durable.journalEntries,
    journalEntry(
      record,
      "DATABASE_PROMOTION",
      "CONFIRMED",
      databasePromotionInputFor(record),
      values.database,
    ),
  );
  seedJournal(
    durable.journalEntries,
    journalEntry(
      record,
      "ACTIVATION_RECORD",
      "CONFIRMED",
      values.activationInput,
      values.activation,
    ),
  );
  const rollbackInput = {
    disabledConfigSha256: record.release.disabled_config_sha256,
    disabledVersionSha256: record.cloudflare.disabled_version_sha256,
    workerName: record.cloudflare.worker_name,
    publicOrigin: record.cloudflare.public_origin,
  };
  seedJournal(
    durable.journalEntries,
    journalEntry(record, "CLOUDFLARE_ROLLBACK", "CONFIRMED", rollbackInput, values.rollback),
  );
  seedJournal(
    durable.journalEntries,
    journalEntry(record, "ROLLBACK_RECORD", "INTENT", values.rollbackRecordInput),
  );
  const result = await reconcileQualifiedProductionCleanup({
    record,
    disabledConfigBytes: disabledBytes,
    transport: durable.transport,
  });
  assert.equal(result.rollbackRecorded, true);
  assert.equal(calls.includes("rollback"), false);
  assert.equal(calls.includes("record-rollback"), false);
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

#!/usr/bin/env node

import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseProductionConfig, validateProductionConfig } from "./validate-production-config.mjs";

const HASH = /^sha256:[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const fail = (code) => {
  throw new Error(`V2_13_QUALIFIED_PROMOTION_${code}`);
};
const exactKeys = (value, keys) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());

function validatePromotionRecord(value) {
  if (
    !exactKeys(value, [
      "approval",
      "cloudflare",
      "database",
      "lanes",
      "release",
      "schema_version",
    ]) ||
    value.schema_version !== "videoforge.v2-13-qualified-promotion/v1" ||
    !exactKeys(value.release, ["commit", "disabled_config_sha256", "enabled_config_sha256"]) ||
    !COMMIT.test(value.release.commit ?? "") ||
    !HASH.test(value.release.disabled_config_sha256 ?? "") ||
    !HASH.test(value.release.enabled_config_sha256 ?? "") ||
    !exactKeys(value.approval, [
      "approved_at",
      "approval_sha256",
      "authority_id",
      "expires_at",
      "proposal_sha256",
      "single_use",
    ]) ||
    typeof value.approval.authority_id !== "string" ||
    !HASH.test(value.approval.proposal_sha256 ?? "") ||
    !HASH.test(value.approval.approval_sha256 ?? "") ||
    value.approval.single_use !== true ||
    Number.isNaN(Date.parse(value.approval.approved_at ?? "")) ||
    Number.isNaN(Date.parse(value.approval.expires_at ?? "")) ||
    Date.parse(value.approval.approved_at) >= Date.parse(value.approval.expires_at) ||
    !exactKeys(value.database, [
      "activation_id",
      "authority_document_sha256",
      "executor_sha256",
      "full_live_authority_id",
      "migration_ledger_sha256",
      "paid_approval_sha256",
      "promotion_id",
      "rollback_id",
    ]) ||
    !UUID.test(value.database.activation_id ?? "") ||
    !UUID.test(value.database.full_live_authority_id ?? "") ||
    !UUID.test(value.database.promotion_id ?? "") ||
    !UUID.test(value.database.rollback_id ?? "") ||
    !HASH.test(value.database.authority_document_sha256 ?? "") ||
    !HASH.test(value.database.executor_sha256 ?? "") ||
    !HASH.test(value.database.migration_ledger_sha256 ?? "") ||
    !HASH.test(value.database.paid_approval_sha256 ?? "") ||
    !exactKeys(value.lanes, ["mage_image", "soulx_avatar"])
  )
    fail("RECORD_CONTRACT");
  for (const lane of ["mage_image", "soulx_avatar"]) {
    const item = value.lanes[lane];
    if (
      !exactKeys(item, [
        "deployment_id",
        "deployment_snapshot_sha256",
        "qualification_id",
        "qualification_record_sha256",
      ]) ||
      !UUID.test(item.deployment_id ?? "") ||
      !UUID.test(item.qualification_id ?? "") ||
      !HASH.test(item.deployment_snapshot_sha256 ?? "") ||
      !HASH.test(item.qualification_record_sha256 ?? "")
    )
      fail("LANE_CONTRACT");
  }
  if (
    !exactKeys(value.cloudflare, [
      "account_id_sha256",
      "disabled_version_id",
      "disabled_version_sha256",
      "public_origin",
      "worker_name",
      "workflow_name",
    ]) ||
    !HASH.test(value.cloudflare.account_id_sha256 ?? "") ||
    !UUID.test(value.cloudflare.disabled_version_id ?? "") ||
    sha256(Buffer.from(value.cloudflare.disabled_version_id)) !==
      value.cloudflare.disabled_version_sha256 ||
    !HASH.test(value.cloudflare.disabled_version_sha256 ?? "") ||
    value.cloudflare.worker_name !== "videoforge-production-runtime" ||
    typeof value.cloudflare.workflow_name !== "string" ||
    !/^https:\/\/[a-z0-9.-]+$/u.test(value.cloudflare.public_origin ?? "")
  )
    fail("CLOUDFLARE_CONTRACT");
  return value;
}

function renderQualifiedConfig(disabledBytes, record) {
  if (sha256(disabledBytes) !== record.release.disabled_config_sha256) fail("DISABLED_CONFIG_HASH");
  const disabled = parseProductionConfig(disabledBytes.toString("utf8"));
  validateProductionConfig(disabled, { mode: "activated" });
  if (disabled.vars.VIDEOFORGE_GPU_TRANSPORT !== "DISABLED_UNQUALIFIED")
    fail("DISABLED_CONFIG_STATE");
  const enabled = structuredClone(disabled);
  enabled.vars.VIDEOFORGE_GPU_TRANSPORT = "QUALIFIED_EXACT";
  validateProductionConfig(enabled, { mode: "qualified" });
  const enabledBytes = Buffer.from(`${JSON.stringify(enabled, null, 2)}\n`);
  if (sha256(enabledBytes) !== record.release.enabled_config_sha256) fail("ENABLED_CONFIG_HASH");
  const comparison = structuredClone(enabled);
  comparison.vars.VIDEOFORGE_GPU_TRANSPORT = "DISABLED_UNQUALIFIED";
  if (JSON.stringify(comparison) !== JSON.stringify(disabled)) fail("ENABLED_CONFIG_DIFF");
  return { config: enabled, bytes: enabledBytes };
}

function assertDatabasePromotion(snapshot, record) {
  if (
    snapshot?.decision_sha256 === undefined ||
    !HASH.test(snapshot.decision_sha256) ||
    snapshot.migration_ledger_sha256 !== record.database.migration_ledger_sha256 ||
    Number.isNaN(Date.parse(snapshot.database_now ?? ""))
  )
    fail("DATABASE_PROMOTION");
}

function createPromotionDatabaseAdapter(database) {
  if (database === null || typeof database !== "object" || typeof database.query !== "function")
    fail("DATABASE_ADAPTER_CONTRACT");
  return Object.freeze({
    async recordAuthority({ authorityId, authority }) {
      const result = await database.query(
        "SELECT * FROM public.videoforge_record_hosted_full_live_authority($1::uuid,$2::jsonb)",
        [authorityId, JSON.stringify(authority)],
      );
      if (result?.rows?.length !== 1) fail("DATABASE_AUTHORITY_RESULT");
      return Object.freeze(result.rows[0]);
    },
    async promote({ promotionId, authorityId, promotion }) {
      const result = await database.query(
        "SELECT * FROM public.videoforge_promote_hosted_full_live($1::uuid,$2::uuid,$3::jsonb)",
        [promotionId, authorityId, JSON.stringify(promotion)],
      );
      if (result?.rows?.length !== 1) fail("DATABASE_PROMOTION_RESULT");
      return Object.freeze(result.rows[0]);
    },
    async recordWorkflowStartAuthority({
      workflowAuthorityId,
      authorityId,
      tokenSha256,
      expiresAt,
    }) {
      if (
        !UUID.test(workflowAuthorityId ?? "") ||
        !UUID.test(authorityId ?? "") ||
        !HASH.test(tokenSha256 ?? "") ||
        Number.isNaN(Date.parse(expiresAt ?? ""))
      )
        fail("DATABASE_WORKFLOW_AUTHORITY_INPUT");
      const result = await database.query(
        "SELECT public.videoforge_record_v213_workflow_start_authority($1::uuid,$2::uuid,$3,$4::timestamptz) AS authority",
        [workflowAuthorityId, authorityId, tokenSha256, expiresAt],
      );
      if (result?.rows?.length !== 1) fail("DATABASE_WORKFLOW_AUTHORITY_RESULT");
      return Object.freeze(result.rows[0].authority);
    },
    async recordCloudflareActivation({ activationId, promotionId, readback }) {
      if (!UUID.test(activationId ?? "") || !UUID.test(promotionId ?? ""))
        fail("DATABASE_CLOUDFLARE_ACTIVATION_INPUT");
      const result = await database.query(
        "SELECT public.videoforge_record_v213_cloudflare_activation($1::uuid,$2::jsonb) AS activation",
        [activationId, JSON.stringify({ ...readback, promotionId })],
      );
      if (result?.rows?.length !== 1) fail("DATABASE_CLOUDFLARE_ACTIVATION_RESULT");
      return Object.freeze(result.rows[0].activation);
    },
    async recordCloudflareRollback({ rollbackId, activationId, promotionId, readback }) {
      if (
        !UUID.test(rollbackId ?? "") ||
        !UUID.test(activationId ?? "") ||
        !UUID.test(promotionId ?? "")
      )
        fail("DATABASE_CLOUDFLARE_ROLLBACK_INPUT");
      const result = await database.query(
        "SELECT public.videoforge_record_v213_cloudflare_rollback($1::uuid,$2::jsonb) AS rollback",
        [rollbackId, JSON.stringify({ ...readback, activationId, promotionId })],
      );
      if (result?.rows?.length !== 1) fail("DATABASE_CLOUDFLARE_ROLLBACK_RESULT");
      return Object.freeze(result.rows[0].rollback);
    },
  });
}

async function promoteQualifiedProduction({ record, disabledConfigBytes, transport }) {
  validatePromotionRecord(record);
  if (
    transport === null ||
    typeof transport !== "object" ||
    [
      "promoteDatabase",
      "dryRun",
      "deploy",
      "readback",
      "recordActivation",
      "recordRollback",
      "routeReadback",
      "rollback",
    ].some((name) => typeof transport[name] !== "function")
  )
    fail("TRANSPORT_CONTRACT");
  const promotionDocument = {
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
  };
  const databasePromotion = await transport.promoteDatabase({
    authorityId: record.database.full_live_authority_id,
    promotionId: record.database.promotion_id,
    promotion: promotionDocument,
  });
  assertDatabasePromotion(databasePromotion, record);
  const trustedNow = databasePromotion.database_now;
  const trustedMs = Date.parse(trustedNow ?? "");
  if (
    Number.isNaN(trustedMs) ||
    trustedMs < Date.parse(record.approval.approved_at) ||
    trustedMs > Date.parse(record.approval.expires_at)
  )
    fail("AUTHORITY_EXPIRED");
  const enabled = renderQualifiedConfig(disabledConfigBytes, record);
  const dryRun = await transport.dryRun(enabled.bytes);
  if (
    dryRun?.configSha256 !== record.release.enabled_config_sha256 ||
    !HASH.test(dryRun.bundleSha256 ?? "") ||
    dryRun.productionFirewallPassed !== true ||
    dryRun.providerSendPerformed !== false
  )
    fail("DRY_RUN");
  let recordedActivation = null;
  try {
    const deployed = await transport.deploy(enabled.bytes);
    if (
      !HASH.test(deployed?.versionSha256 ?? "") ||
      deployed.configSha256 !== record.release.enabled_config_sha256 ||
      deployed.providerSendPerformed !== false
    )
      fail("DEPLOY_RESULT");
    const readback = await transport.readback(deployed);
    if (
      readback?.versionSha256 !== deployed.versionSha256 ||
      readback.configSha256 !== record.release.enabled_config_sha256 ||
      readback.workerName !== record.cloudflare.worker_name ||
      readback.workflowName !== record.cloudflare.workflow_name ||
      readback.pairWorkflowName !== `${record.cloudflare.workflow_name}-pair` ||
      readback.publicOrigin !== record.cloudflare.public_origin ||
      readback.gpuTransport !== "QUALIFIED_EXACT" ||
      readback.exactBindings !== true ||
      readback.providerSendPerformed !== false ||
      !HASH.test(readback.evidenceSha256 ?? "")
    )
      fail("DEPLOY_READBACK");
    const recorded = await transport.recordActivation({
      activationId: record.database.activation_id,
      promotionId: record.database.promotion_id,
      sourceCommit: record.release.commit,
      versionIdSha256: readback.versionSha256,
      deployedConfigSha256: readback.configSha256,
      observedAt: trustedNow,
      evidenceSha256: readback.evidenceSha256,
    });
    if (
      recorded?.versionIdSha256 !== readback.versionSha256 ||
      recorded.deployedConfigSha256 !== record.release.enabled_config_sha256 ||
      !HASH.test(recorded.readbackSha256 ?? "")
    )
      fail("ACTIVATION_RECORD");
    recordedActivation = recorded;
    const route = await transport.routeReadback(readback);
    if (
      route?.routeReady !== true ||
      route.routeStatus !== 200 ||
      route.routeVersionSha256 !== deployed.versionSha256 ||
      route.gpuTransport !== "QUALIFIED_EXACT"
    )
      fail("ACTIVATION_ROUTE_READBACK");
    return Object.freeze({
      state: "QUALIFIED_EXACT",
      enabled: true,
      providerSendPerformed: false,
      versionSha256: deployed.versionSha256,
      evidenceSha256: readback.evidenceSha256,
      databasePromotionSha256: databasePromotion.decision_sha256,
    });
  } catch (error) {
    const rollback = await transport.rollback(disabledConfigBytes);
    if (
      rollback?.gpuTransport !== "DISABLED_UNQUALIFIED" ||
      rollback.configSha256 !== record.release.disabled_config_sha256 ||
      rollback.versionSha256 !== record.cloudflare.disabled_version_sha256 ||
      rollback.providerSendPerformed !== false ||
      rollback.routeDisabled !== true ||
      rollback.routeStatus !== 503 ||
      rollback.routeVersionSha256 !== record.cloudflare.disabled_version_sha256
    )
      fail("ROLLBACK_UNCONFIRMED");
    if (recordedActivation !== null) {
      const rollbackRecord = await transport.recordRollback({
        rollbackId: record.database.rollback_id,
        activationId: record.database.activation_id,
        promotionId: record.database.promotion_id,
        disabledVersionIdSha256: rollback.versionSha256,
        disabledConfigSha256: rollback.configSha256,
        routeStatus: rollback.routeStatus,
        routeVersionSha256: rollback.routeVersionSha256,
        observedAt: rollback.observedAt,
      });
      if (
        !HASH.test(rollbackRecord?.rollbackSha256 ?? "") ||
        rollbackRecord.disabledVersionIdSha256 !== record.cloudflare.disabled_version_sha256 ||
        rollbackRecord.disabledConfigSha256 !== record.release.disabled_config_sha256
      )
        fail("ROLLBACK_RECORD_UNCONFIRMED");
    }
    throw error;
  }
}

async function main() {
  if (process.argv.length === 2) {
    process.stdout.write(
      `${JSON.stringify({ state: "NO_ACTION", database_reads: 0, provider_calls: 0, mutations: 0, provider_sends: 0, spend_usd: 0 })}\n`,
    );
    return;
  }
  // Production Cloudflare/DB transport is deliberately not accepted as an arbitrary command.
  // The full-live executor must inject the reviewed transport after source integration is complete.
  fail("CANONICAL_EXECUTOR_REQUIRED");
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) await main();

export {
  createPromotionDatabaseAdapter,
  promoteQualifiedProduction,
  renderQualifiedConfig,
  validatePromotionRecord,
};

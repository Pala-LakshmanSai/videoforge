#!/usr/bin/env node

import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseProductionConfig, validateProductionConfig } from "./validate-production-config.mjs";

const HASH = /^sha256:[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const JOURNAL_SCHEMA = "videoforge.v213-qualified-promotion-journal-entry/v1";
const JOURNAL_STEPS = new Set([
  "DATABASE_PROMOTION",
  "DRY_RUN",
  "CLOUDFLARE_DEPLOY",
  "CLOUDFLARE_READBACK",
  "ROUTE_READBACK",
  "ACTIVATION_RECORD",
  "CLOUDFLARE_ROLLBACK",
  "ROLLBACK_RECORD",
  "PROMOTION_COMPLETE",
]);
const fail = (code) => {
  throw new Error(`V2_13_QUALIFIED_PROMOTION_${code}`);
};
const exactKeys = (value, keys) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());

function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  fail("JOURNAL_VALUE");
}

const valueSha256 = (value) => sha256(Buffer.from(canonicalJson(value)));

function createPromotionJournalEntry({ record, step, status, input, output = null }) {
  if (
    !UUID.test(record?.database?.promotion_id ?? "") ||
    !JOURNAL_STEPS.has(step) ||
    !["INTENT", "CONFIRMED"].includes(status) ||
    (status === "INTENT" && output !== null) ||
    (status === "CONFIRMED" && (output === null || typeof output !== "object"))
  )
    fail("JOURNAL_ENTRY_CONTRACT");
  const frozenInput = structuredClone(input);
  const frozenOutput = output === null ? null : structuredClone(output);
  return Object.freeze({
    schemaVersion: JOURNAL_SCHEMA,
    promotionId: record.database.promotion_id,
    authorityId: record.database.full_live_authority_id,
    step,
    status,
    inputSha256: valueSha256(frozenInput),
    input: frozenInput,
    outputSha256: frozenOutput === null ? null : valueSha256(frozenOutput),
    output: frozenOutput,
  });
}

function assertExactJournalEntry(value, expected) {
  if (
    !exactKeys(value, [
      "schemaVersion",
      "promotionId",
      "authorityId",
      "step",
      "status",
      "inputSha256",
      "input",
      "outputSha256",
      "output",
    ]) ||
    value.schemaVersion !== JOURNAL_SCHEMA ||
    value.promotionId !== expected.promotionId ||
    value.authorityId !== expected.authorityId ||
    value.step !== expected.step ||
    value.status !== expected.status ||
    value.inputSha256 !== expected.inputSha256 ||
    value.outputSha256 !== expected.outputSha256 ||
    canonicalJson(value.input) !== canonicalJson(expected.input) ||
    canonicalJson(value.output) !== canonicalJson(expected.output)
  )
    fail("JOURNAL_REPLAY_DRIFT");
  return Object.freeze(structuredClone(value));
}

function assertRecoveryContract(recovery) {
  // `journal.record` is a durable compare-and-set boundary: it may return only after the exact
  // entry is crash-stable, and `journal.read` must return that entry after process restart.
  // `reconcileDeployment` and `readDisabledDeployment` are read-only. `reconcileRollback` is
  // cleanup-only and may target only the already-bound disabled version; it must never deploy the
  // enabled config.
  if (
    recovery === null ||
    typeof recovery !== "object" ||
    recovery.journal === null ||
    typeof recovery.journal !== "object" ||
    typeof recovery.journal.read !== "function" ||
    typeof recovery.journal.record !== "function" ||
    [
      "reconcileDatabasePromotion",
      "reconcileDeployment",
      "reconcileActivation",
      "readDisabledDeployment",
      "reconcileRollback",
      "reconcileRollbackRecord",
    ].some((name) => typeof recovery[name] !== "function")
  )
    fail("RECOVERY_CONTRACT");
  return recovery;
}

async function readJournalEntry({ recovery, record, step, status, input }) {
  const expectedInput = structuredClone(input);
  const expectedInputSha256 = valueSha256(expectedInput);
  let value;
  try {
    value = await recovery.journal.read({
      promotionId: record.database.promotion_id,
      step,
      status,
    });
  } catch {
    fail("JOURNAL_READ");
  }
  if (value === null || value === undefined) return null;
  if (
    !exactKeys(value, [
      "schemaVersion",
      "promotionId",
      "authorityId",
      "step",
      "status",
      "inputSha256",
      "input",
      "outputSha256",
      "output",
    ]) ||
    value.schemaVersion !== JOURNAL_SCHEMA ||
    value.promotionId !== record.database.promotion_id ||
    value.authorityId !== record.database.full_live_authority_id ||
    value.step !== step ||
    value.status !== status ||
    value.inputSha256 !== expectedInputSha256 ||
    canonicalJson(value.input) !== canonicalJson(expectedInput) ||
    (status === "INTENT" && (value.output !== null || value.outputSha256 !== null)) ||
    (status === "CONFIRMED" &&
      (value.output === null ||
        typeof value.output !== "object" ||
        value.outputSha256 !== valueSha256(value.output)))
  )
    fail("JOURNAL_REPLAY_DRIFT");
  return Object.freeze(structuredClone(value));
}

async function readAnyJournalEntry({ recovery, record, step, status }) {
  let value;
  try {
    value = await recovery.journal.read({
      promotionId: record.database.promotion_id,
      step,
      status,
    });
  } catch {
    fail("JOURNAL_READ");
  }
  if (value === null || value === undefined) return null;
  if (
    !exactKeys(value, [
      "schemaVersion",
      "promotionId",
      "authorityId",
      "step",
      "status",
      "inputSha256",
      "input",
      "outputSha256",
      "output",
    ]) ||
    value.schemaVersion !== JOURNAL_SCHEMA ||
    value.promotionId !== record.database.promotion_id ||
    value.authorityId !== record.database.full_live_authority_id ||
    value.step !== step ||
    value.status !== status ||
    value.inputSha256 !== valueSha256(value.input) ||
    (status === "INTENT" && (value.output !== null || value.outputSha256 !== null)) ||
    (status === "CONFIRMED" &&
      (value.output === null ||
        typeof value.output !== "object" ||
        value.outputSha256 !== valueSha256(value.output)))
  )
    fail("JOURNAL_REPLAY_DRIFT");
  return Object.freeze(structuredClone(value));
}

async function persistJournalEntry({ recovery, entry }) {
  let value;
  try {
    value = await recovery.journal.record(structuredClone(entry));
  } catch {
    try {
      value = await recovery.journal.read({
        promotionId: entry.promotionId,
        step: entry.step,
        status: entry.status,
      });
    } catch {
      fail("JOURNAL_ACK_UNKNOWN");
    }
  }
  if (value === null || value === undefined) fail("JOURNAL_ACK_UNKNOWN");
  return assertExactJournalEntry(value, entry);
}

async function runJournaledMutation({
  recovery,
  record,
  step,
  input,
  mutate,
  reconcile,
  reconcileConfirmed = false,
  validate,
  ackUnknownCode,
}) {
  const confirmed = await readJournalEntry({
    recovery,
    record,
    step,
    status: "CONFIRMED",
    input,
  });
  if (confirmed !== null) {
    validate(confirmed.output);
    if (!reconcileConfirmed) return confirmed.output;
    let reconciled;
    try {
      reconciled = await reconcile(structuredClone(input));
    } catch {
      fail(ackUnknownCode);
    }
    if (reconciled === null || reconciled === undefined) fail(ackUnknownCode);
    validate(reconciled);
    if (canonicalJson(reconciled) !== canonicalJson(confirmed.output))
      fail(`${step}_RESTART_DRIFT`);
    return Object.freeze(structuredClone(reconciled));
  }
  const priorIntent = await readJournalEntry({
    recovery,
    record,
    step,
    status: "INTENT",
    input,
  });
  let output;
  if (priorIntent !== null) {
    // A durable intent without a confirmation may mean the prior process died after the call was
    // accepted. Never invoke the original mutation from this branch. The injected reconciler is
    // either read-only (Cloudflare) or an exact-key, replay-safe database function.
    try {
      output = await reconcile(structuredClone(input));
    } catch {
      fail(ackUnknownCode);
    }
  } else {
    await persistJournalEntry({
      recovery,
      entry: createPromotionJournalEntry({ record, step, status: "INTENT", input }),
    });
    try {
      output = await mutate();
    } catch {
      try {
        output = await reconcile(structuredClone(input));
      } catch {
        fail(ackUnknownCode);
      }
    }
  }
  if (output === null || output === undefined) fail(ackUnknownCode);
  validate(output);
  await persistJournalEntry({
    recovery,
    entry: createPromotionJournalEntry({
      record,
      step,
      status: "CONFIRMED",
      input,
      output,
    }),
  });
  return Object.freeze(structuredClone(output));
}

async function runJournaledRead({ recovery, record, step, input, read, validate }) {
  const prior = await readJournalEntry({
    recovery,
    record,
    step,
    status: "CONFIRMED",
    input,
  });
  const output = await read();
  validate(output);
  if (prior !== null) {
    validate(prior.output);
    if (canonicalJson(output) !== canonicalJson(prior.output)) fail(`${step}_RESTART_DRIFT`);
    return Object.freeze(structuredClone(output));
  }
  await persistJournalEntry({
    recovery,
    entry: createPromotionJournalEntry({
      record,
      step,
      status: "CONFIRMED",
      input,
      output,
    }),
  });
  return Object.freeze(structuredClone(output));
}

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

function databasePromotionInput(record) {
  return Object.freeze({
    authorityId: record.database.full_live_authority_id,
    promotionId: record.database.promotion_id,
    promotion: Object.freeze({
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
    }),
  });
}

function createPromotionDatabaseAdapter(database) {
  if (database === null || typeof database !== "object" || typeof database.query !== "function")
    fail("DATABASE_ADAPTER_CONTRACT");
  const canonicalExpiresAt = (value) => {
    const parsed = Date.parse(value ?? "");
    if (Number.isNaN(parsed)) fail("DATABASE_WORKFLOW_AUTHORITY_INPUT");
    return new Date(parsed).toISOString();
  };
  const workflowAuthorityReadSql =
    'SELECT id::text AS "workflowAuthorityId",full_live_authority_id::text AS "authorityId",token_sha256 AS "tokenSha256",to_char(expires_at AT TIME ZONE \'UTC\',\'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "expiresAt" FROM public.hosted_full_live_workflow_start_authorities WHERE id=$1::uuid';
  const readWorkflowStartAuthority = async ({ workflowAuthorityId }) => {
    let result;
    try {
      result = await database.query(workflowAuthorityReadSql, [workflowAuthorityId]);
    } catch {
      fail("DATABASE_WORKFLOW_AUTHORITY_READ");
    }
    if (!Array.isArray(result?.rows) || result.rows.length > 1)
      fail("DATABASE_WORKFLOW_AUTHORITY_READ_RESULT");
    return result.rows.length === 0 ? null : result.rows[0];
  };
  const exactWorkflowAuthority = (row, input) => {
    if (
      row === null ||
      typeof row !== "object" ||
      JSON.stringify(Object.keys(row).sort()) !==
        JSON.stringify(["authorityId", "expiresAt", "tokenSha256", "workflowAuthorityId"].sort()) ||
      row.workflowAuthorityId !== input.workflowAuthorityId ||
      row.authorityId !== input.authorityId ||
      row.tokenSha256 !== input.tokenSha256 ||
      canonicalExpiresAt(row.expiresAt) !== canonicalExpiresAt(input.expiresAt)
    )
      return false;
    return Object.freeze({
      authorityId: row.workflowAuthorityId,
      tokenSha256: row.tokenSha256,
      expiresAt: canonicalExpiresAt(row.expiresAt),
    });
  };
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
      const input = { workflowAuthorityId, authorityId, tokenSha256, expiresAt };
      // The migration function intentionally has no replay insert guard.  Always reconcile the
      // exact prior row before inserting, so a retry after an ambiguous commit cannot duplicate
      // or drift the workflow-start authority.
      const existing = await readWorkflowStartAuthority(input);
      if (existing !== null) {
        const reconciled = exactWorkflowAuthority(existing, input);
        if (reconciled === false) fail("DATABASE_WORKFLOW_AUTHORITY_REPLAY_DRIFT");
        return reconciled;
      }
      let result;
      try {
        result = await database.query(
          "SELECT public.videoforge_record_v213_workflow_start_authority($1::uuid,$2::uuid,$3,$4::timestamptz) AS authority",
          [workflowAuthorityId, authorityId, tokenSha256, expiresAt],
        );
        if (result?.rows?.length !== 1 || result.rows[0]?.authority === null)
          throw new Error("malformed workflow authority result");
      } catch {
        // The insert may have committed before the transport failed.  A second exact read is the
        // only safe recovery; never blindly call the INSERT function again.
        let reconciled;
        try {
          reconciled = await readWorkflowStartAuthority(input);
        } catch {
          fail("DATABASE_WORKFLOW_AUTHORITY_AMBIGUOUS");
        }
        if (reconciled !== null) {
          const exact = exactWorkflowAuthority(reconciled, input);
          if (exact !== false) return exact;
          fail("DATABASE_WORKFLOW_AUTHORITY_REPLAY_DRIFT");
        }
        fail("DATABASE_WORKFLOW_AUTHORITY_AMBIGUOUS");
      }
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
    async recordDisabledPromotionClosure({ closureId, promotionId, closure }) {
      if (
        !UUID.test(closureId ?? "") ||
        !UUID.test(promotionId ?? "") ||
        closure?.schemaVersion !== "videoforge.v213-disabled-promotion-closure/v1" ||
        closure.promotionId !== promotionId
      )
        fail("DATABASE_DISABLED_PROMOTION_CLOSURE_INPUT");
      const result = await database.query(
        "SELECT public.videoforge_record_v213_disabled_promotion_closure($1::uuid,$2::jsonb) AS rollback",
        [closureId, JSON.stringify(closure)],
      );
      if (result?.rows?.length !== 1 || result.rows[0]?.rollback === null)
        fail("DATABASE_DISABLED_PROMOTION_CLOSURE_RESULT");
      return Object.freeze(result.rows[0].rollback);
    },
  });
}

async function promoteQualifiedProduction({
  record,
  disabledConfigBytes,
  transport,
  recovery = transport?.recovery,
}) {
  validatePromotionRecord(record);
  const durableRecovery = assertRecoveryContract(recovery);
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
  const promotionInput = databasePromotionInput(record);
  const databasePromotion = await runJournaledMutation({
    recovery: durableRecovery,
    record,
    step: "DATABASE_PROMOTION",
    input: promotionInput,
    mutate: () => transport.promoteDatabase(promotionInput),
    reconcile: durableRecovery.reconcileDatabasePromotion,
    reconcileConfirmed: true,
    validate: (value) => assertDatabasePromotion(value, record),
    ackUnknownCode: "DATABASE_PROMOTION_ACK_UNKNOWN",
  });
  const trustedNow = databasePromotion.database_now;
  const trustedMs = Date.parse(trustedNow ?? "");
  if (
    Number.isNaN(trustedMs) ||
    trustedMs < Date.parse(record.approval.approved_at) ||
    trustedMs > Date.parse(record.approval.expires_at)
  )
    fail("AUTHORITY_EXPIRED");
  const enabled = renderQualifiedConfig(disabledConfigBytes, record);
  const dryRunInput = { enabledConfigSha256: record.release.enabled_config_sha256 };
  const validateDryRun = (value) => {
    if (
      value?.configSha256 !== record.release.enabled_config_sha256 ||
      !HASH.test(value.bundleSha256 ?? "") ||
      value.productionFirewallPassed !== true ||
      value.gpuDispatchPerformed !== false ||
      value.cloudflareMutationPerformed !== false
    )
      fail("DRY_RUN");
  };
  const dryRun = await runJournaledRead({
    recovery: durableRecovery,
    record,
    step: "DRY_RUN",
    input: dryRunInput,
    read: () => transport.dryRun(enabled.bytes),
    validate: validateDryRun,
  });
  try {
    const deployInput = {
      enabledConfigSha256: record.release.enabled_config_sha256,
      workerName: record.cloudflare.worker_name,
    };
    const validateDeployment = (value) => {
      if (
        !HASH.test(value?.versionSha256 ?? "") ||
        value.configSha256 !== record.release.enabled_config_sha256 ||
        value.gpuDispatchPerformed !== false ||
        value.cloudflareMutationPerformed !== true
      )
        fail("DEPLOY_RESULT");
    };
    const deployed = await runJournaledMutation({
      recovery: durableRecovery,
      record,
      step: "CLOUDFLARE_DEPLOY",
      input: deployInput,
      mutate: () => transport.deploy(enabled.bytes),
      reconcile: durableRecovery.reconcileDeployment,
      validate: validateDeployment,
      ackUnknownCode: "DEPLOY_ACK_UNKNOWN",
    });
    const readbackInput = {
      enabledConfigSha256: record.release.enabled_config_sha256,
      versionSha256: deployed.versionSha256,
    };
    const validateReadback = (value) => {
      if (
        value?.versionSha256 !== deployed.versionSha256 ||
        value.configSha256 !== record.release.enabled_config_sha256 ||
        value.workerName !== record.cloudflare.worker_name ||
        value.workflowName !== record.cloudflare.workflow_name ||
        value.pairWorkflowName !== `${record.cloudflare.workflow_name}-pair` ||
        value.publicOrigin !== record.cloudflare.public_origin ||
        value.gpuTransport !== "QUALIFIED_EXACT" ||
        value.exactBindings !== true ||
        value.gpuDispatchPerformed !== false ||
        value.cloudflareMutationPerformed !== false ||
        !HASH.test(value.evidenceSha256 ?? "")
      )
        fail("DEPLOY_READBACK");
    };
    const readback = await runJournaledRead({
      recovery: durableRecovery,
      record,
      step: "CLOUDFLARE_READBACK",
      input: readbackInput,
      read: () => transport.readback(deployed),
      validate: validateReadback,
    });
    const routeInput = {
      versionSha256: deployed.versionSha256,
      publicOrigin: record.cloudflare.public_origin,
    };
    const validateRoute = (value) => {
      if (
        value?.routeReady !== true ||
        value.routeStatus !== 200 ||
        value.routeVersionSha256 !== deployed.versionSha256 ||
        !HASH.test(value.productionUrlSha256 ?? "") ||
        !HASH.test(value.routeBodySha256 ?? "") ||
        value.gpuTransport !== "QUALIFIED_EXACT" ||
        value.gpuDispatchPerformed !== false ||
        value.cloudflareMutationPerformed !== false
      )
        fail("ACTIVATION_ROUTE_READBACK");
    };
    const route = await runJournaledRead({
      recovery: durableRecovery,
      record,
      step: "ROUTE_READBACK",
      input: routeInput,
      read: () => transport.routeReadback(readback),
      validate: validateRoute,
    });
    const routeReadbackSha256 = sha256(
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
      observedAt: trustedNow,
      evidenceSha256: readback.evidenceSha256,
    };
    const validateActivation = (value) => {
      if (
        value?.versionIdSha256 !== readback.versionSha256 ||
        value.deployedExecutableSha256 !== dryRun.bundleSha256 ||
        value.deployedConfigSha256 !== record.release.enabled_config_sha256 ||
        value.productionUrlSha256 !== route.productionUrlSha256 ||
        value.routeStatus !== 200 ||
        value.routeBodySha256 !== route.routeBodySha256 ||
        value.routeVersionSha256 !== deployed.versionSha256 ||
        value.routeReadbackSha256 !== routeReadbackSha256 ||
        !HASH.test(value.readbackSha256 ?? "")
      )
        fail("ACTIVATION_RECORD");
    };
    await runJournaledMutation({
      recovery: durableRecovery,
      record,
      step: "ACTIVATION_RECORD",
      input: activationInput,
      mutate: () => transport.recordActivation(activationInput),
      reconcile: durableRecovery.reconcileActivation,
      validate: validateActivation,
      ackUnknownCode: "ACTIVATION_ACK_UNKNOWN",
    });
    const result = Object.freeze({
      state: "QUALIFIED_EXACT",
      enabled: true,
      gpuDispatchPerformed: false,
      cloudflareMutationPerformed: true,
      versionSha256: deployed.versionSha256,
      deployedExecutableSha256: dryRun.bundleSha256,
      productionUrlSha256: route.productionUrlSha256,
      routeReadbackSha256,
      evidenceSha256: readback.evidenceSha256,
      databasePromotionSha256: databasePromotion.decision_sha256,
    });
    await persistJournalEntry({
      recovery: durableRecovery,
      entry: createPromotionJournalEntry({
        record,
        step: "PROMOTION_COMPLETE",
        status: "CONFIRMED",
        input: { promotionId: record.database.promotion_id },
        output: result,
      }),
    });
    return result;
  } catch (error) {
    await reconcileQualifiedProductionCleanup({
      record,
      disabledConfigBytes,
      transport,
      recovery: durableRecovery,
    });
    throw error;
  }
}

async function reconcileQualifiedProductionCleanup({
  record,
  disabledConfigBytes,
  transport,
  recovery = transport?.recovery,
}) {
  validatePromotionRecord(record);
  const durableRecovery = assertRecoveryContract(recovery);
  if (
    transport === null ||
    typeof transport !== "object" ||
    typeof transport.rollback !== "function" ||
    typeof transport.recordRollback !== "function"
  )
    fail("CLEANUP_TRANSPORT_CONTRACT");
  if (sha256(disabledConfigBytes) !== record.release.disabled_config_sha256)
    fail("DISABLED_CONFIG_HASH");

  // A durable INTENT may mean the database committed and only its ACK was lost. Reconcile that
  // exact idempotent write before deciding which database closure is required. Cleanup never
  // re-enters op15's provider path.
  const databaseIntent = await readAnyJournalEntry({
    recovery: durableRecovery,
    record,
    step: "DATABASE_PROMOTION",
    status: "INTENT",
  });
  const databaseConfirmed = await readAnyJournalEntry({
    recovery: durableRecovery,
    record,
    step: "DATABASE_PROMOTION",
    status: "CONFIRMED",
  });
  const promotionInput = databasePromotionInput(record);
  const databasePromotionEntry = databaseConfirmed ?? databaseIntent;
  let databasePromotion = null;
  if (databasePromotionEntry !== null) {
    if (canonicalJson(databasePromotionEntry.input) !== canonicalJson(promotionInput))
      fail("DATABASE_PROMOTION_CLEANUP_INPUT_DRIFT");
    databasePromotion = await runJournaledMutation({
      recovery: durableRecovery,
      record,
      step: "DATABASE_PROMOTION",
      input: promotionInput,
      mutate: () => fail("DATABASE_PROMOTION_REDISPATCH_FORBIDDEN"),
      reconcile: durableRecovery.reconcileDatabasePromotion,
      reconcileConfirmed: true,
      validate: (value) => assertDatabasePromotion(value, record),
      ackUnknownCode: "DATABASE_PROMOTION_ACK_UNKNOWN",
    });
  }

  const rollbackInput = {
    disabledConfigSha256: record.release.disabled_config_sha256,
    disabledVersionSha256: record.cloudflare.disabled_version_sha256,
    workerName: record.cloudflare.worker_name,
    publicOrigin: record.cloudflare.public_origin,
  };
  const validateRollback = (value) => {
    if (
      value?.gpuTransport !== "DISABLED_UNQUALIFIED" ||
      value.configSha256 !== record.release.disabled_config_sha256 ||
      value.versionSha256 !== record.cloudflare.disabled_version_sha256 ||
      value.gpuDispatchPerformed !== false ||
      typeof value.cloudflareMutationPerformed !== "boolean" ||
      value.routeDisabled !== true ||
      value.routeStatus !== 503 ||
      value.routeVersionSha256 !== record.cloudflare.disabled_version_sha256 ||
      Number.isNaN(Date.parse(value.observedAt ?? ""))
    )
      fail("ROLLBACK_UNCONFIRMED");
  };

  let alreadyDisabled = null;
  try {
    alreadyDisabled = await durableRecovery.readDisabledDeployment(structuredClone(rollbackInput));
  } catch {
    // A fresh rollback is still permitted below only when no prior rollback intent exists. If an
    // intent is present, runJournaledMutation enters reconciliation-only and fails closed.
  }
  if (alreadyDisabled !== null && alreadyDisabled !== undefined) {
    validateRollback(alreadyDisabled);
    const prior = await readJournalEntry({
      recovery: durableRecovery,
      record,
      step: "CLOUDFLARE_ROLLBACK",
      status: "CONFIRMED",
      input: rollbackInput,
    });
    if (prior === null)
      await persistJournalEntry({
        recovery: durableRecovery,
        entry: createPromotionJournalEntry({
          record,
          step: "CLOUDFLARE_ROLLBACK",
          status: "CONFIRMED",
          input: rollbackInput,
          output: alreadyDisabled,
        }),
      });
  }
  const rollback =
    alreadyDisabled ??
    (await runJournaledMutation({
      recovery: durableRecovery,
      record,
      step: "CLOUDFLARE_ROLLBACK",
      input: rollbackInput,
      mutate: () => transport.rollback(disabledConfigBytes),
      reconcile: durableRecovery.reconcileRollback,
      validate: validateRollback,
      ackUnknownCode: "ROLLBACK_ACK_UNKNOWN",
    }));

  // A cleanup result is current provider proof, not merely a historical journal confirmation.
  let currentDisabled;
  try {
    currentDisabled = await durableRecovery.readDisabledDeployment(structuredClone(rollbackInput));
  } catch {
    fail("ROLLBACK_ACK_UNKNOWN");
  }
  if (currentDisabled === null || currentDisabled === undefined) fail("ROLLBACK_ACK_UNKNOWN");
  validateRollback(currentDisabled);

  const activationIntent = await readAnyJournalEntry({
    recovery: durableRecovery,
    record,
    step: "ACTIVATION_RECORD",
    status: "INTENT",
  });
  const activationConfirmed = await readAnyJournalEntry({
    recovery: durableRecovery,
    record,
    step: "ACTIVATION_RECORD",
    status: "CONFIRMED",
  });
  const activationEntry = activationConfirmed ?? activationIntent;
  if (activationEntry !== null && databasePromotion === null)
    fail("ACTIVATION_WITHOUT_DATABASE_PROMOTION_JOURNAL");
  let activation = null;
  if (activationEntry !== null) {
    const activationInput = activationEntry.input;
    activation = await runJournaledMutation({
      recovery: durableRecovery,
      record,
      step: "ACTIVATION_RECORD",
      input: activationInput,
      mutate: () => fail("ACTIVATION_REDISPATCH_FORBIDDEN"),
      reconcile: durableRecovery.reconcileActivation,
      validate: (value) => {
        if (
          !HASH.test(value?.readbackSha256 ?? "") ||
          value.versionIdSha256 !== activationInput.versionIdSha256 ||
          value.deployedConfigSha256 !== record.release.enabled_config_sha256 ||
          value.routeStatus !== 200 ||
          value.routeVersionSha256 !== activationInput.routeVersionSha256
        )
          fail("ACTIVATION_RECORD");
      },
      ackUnknownCode: "ACTIVATION_ACK_UNKNOWN",
    });
  }

  let rollbackRecord = null;
  if (activation !== null) {
    const priorRollbackIntent = await readAnyJournalEntry({
      recovery: durableRecovery,
      record,
      step: "ROLLBACK_RECORD",
      status: "INTENT",
    });
    const priorRollbackConfirmed = await readAnyJournalEntry({
      recovery: durableRecovery,
      record,
      step: "ROLLBACK_RECORD",
      status: "CONFIRMED",
    });
    const rollbackRecordInput =
      (priorRollbackConfirmed ?? priorRollbackIntent)?.input ??
      Object.freeze({
        rollbackId: record.database.rollback_id,
        activationId: record.database.activation_id,
        promotionId: record.database.promotion_id,
        disabledVersionIdSha256: currentDisabled.versionSha256,
        disabledConfigSha256: currentDisabled.configSha256,
        routeStatus: currentDisabled.routeStatus,
        routeVersionSha256: currentDisabled.routeVersionSha256,
        observedAt: currentDisabled.observedAt,
      });
    rollbackRecord = await runJournaledMutation({
      recovery: durableRecovery,
      record,
      step: "ROLLBACK_RECORD",
      input: rollbackRecordInput,
      mutate: () => transport.recordRollback(rollbackRecordInput),
      reconcile: durableRecovery.reconcileRollbackRecord,
      validate: (value) => {
        if (
          !HASH.test(value?.rollbackSha256 ?? "") ||
          value.disabledVersionIdSha256 !== record.cloudflare.disabled_version_sha256 ||
          value.disabledConfigSha256 !== record.release.disabled_config_sha256
        )
          fail("ROLLBACK_RECORD_UNCONFIRMED");
      },
      ackUnknownCode: "ROLLBACK_RECORD_ACK_UNKNOWN",
    });
  } else if (databasePromotion !== null) {
    if (
      typeof transport.recordDisabledPromotionClosure !== "function" ||
      typeof durableRecovery.reconcileDisabledPromotionClosure !== "function"
    )
      fail("DISABLED_PROMOTION_CLOSURE_TRANSPORT_CONTRACT");
    const priorRollbackIntent = await readAnyJournalEntry({
      recovery: durableRecovery,
      record,
      step: "ROLLBACK_RECORD",
      status: "INTENT",
    });
    const priorRollbackConfirmed = await readAnyJournalEntry({
      recovery: durableRecovery,
      record,
      step: "ROLLBACK_RECORD",
      status: "CONFIRMED",
    });
    const closure = Object.freeze({
      schemaVersion: "videoforge.v213-disabled-promotion-closure/v1",
      promotionId: record.database.promotion_id,
      disabledVersionIdSha256: currentDisabled.versionSha256,
      disabledConfigSha256: currentDisabled.configSha256,
      routeStatus: currentDisabled.routeStatus,
      routeVersionSha256: currentDisabled.routeVersionSha256,
      observedAt: currentDisabled.observedAt,
    });
    const rollbackRecordInput =
      (priorRollbackConfirmed ?? priorRollbackIntent)?.input ??
      Object.freeze({
        closureId: record.database.rollback_id,
        promotionId: record.database.promotion_id,
        closure,
      });
    if (
      rollbackRecordInput.closureId !== record.database.rollback_id ||
      rollbackRecordInput.promotionId !== record.database.promotion_id ||
      rollbackRecordInput.closure?.schemaVersion !==
        "videoforge.v213-disabled-promotion-closure/v1" ||
      rollbackRecordInput.closure.promotionId !== record.database.promotion_id ||
      rollbackRecordInput.closure.disabledVersionIdSha256 !== currentDisabled.versionSha256 ||
      rollbackRecordInput.closure.disabledConfigSha256 !== currentDisabled.configSha256 ||
      rollbackRecordInput.closure.routeStatus !== currentDisabled.routeStatus ||
      rollbackRecordInput.closure.routeVersionSha256 !== currentDisabled.routeVersionSha256 ||
      Number.isNaN(Date.parse(rollbackRecordInput.closure.observedAt ?? ""))
    )
      fail("DISABLED_PROMOTION_CLOSURE_INPUT_DRIFT");
    rollbackRecord = await runJournaledMutation({
      recovery: durableRecovery,
      record,
      step: "ROLLBACK_RECORD",
      input: rollbackRecordInput,
      mutate: () => transport.recordDisabledPromotionClosure(rollbackRecordInput),
      reconcile: durableRecovery.reconcileDisabledPromotionClosure,
      validate: (value) => {
        if (
          !HASH.test(value?.rollbackSha256 ?? "") ||
          value.disabledVersionIdSha256 !== record.cloudflare.disabled_version_sha256 ||
          value.disabledConfigSha256 !== record.release.disabled_config_sha256
        )
          fail("DISABLED_PROMOTION_CLOSURE_UNCONFIRMED");
      },
      ackUnknownCode: "DISABLED_PROMOTION_CLOSURE_ACK_UNKNOWN",
    });
  }

  return Object.freeze({
    state: "DISABLED_UNQUALIFIED",
    enabled: false,
    gpuDispatchPerformed: false,
    cloudflareMutationPerformed: rollback.cloudflareMutationPerformed,
    versionSha256: currentDisabled.versionSha256,
    databasePromotionAttempted: databasePromotion !== null,
    databasePromotionSha256: databasePromotion?.decision_sha256 ?? null,
    rollbackRecorded: rollbackRecord !== null,
    rollbackSha256: rollbackRecord?.rollbackSha256 ?? null,
    evidenceSha256: valueSha256({
      rollback: currentDisabled,
      rollbackRecord,
    }),
  });
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
  createPromotionJournalEntry,
  createPromotionDatabaseAdapter,
  promoteQualifiedProduction,
  reconcileQualifiedProductionCleanup,
  renderQualifiedConfig,
  validatePromotionRecord,
};

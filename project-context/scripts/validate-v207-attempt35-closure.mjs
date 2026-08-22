import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const evidenceDir = resolve(
  root,
  "project-context/evidence/acceptance/VF-10-07/2026-08-21-live-qualification",
);
const candidateDir = resolve(
  root,
  "project-context/evidence/acceptance/VF-10-07/2026-08-22-attempt35-low-availability-candidate",
);
const expected = {
  proposal: "sha256:1df762844058f78db8171adcad3943ecfc03157c225070fcbc6506088169c87c",
  authority: "sha256:fc173408635e6af48f824188dad878cd6259526f407e655941848f092732ef37",
  acceptance: "sha256:fa701d3ef9f5619c585c6fc964007f660f19d5c92a3912d9af49e5d05bf7277d",
  closure: "sha256:d0278822d001fe2639d47920f6923c565882bdbbf6ff11c174b30e72aba6d6fa",
  cleanup: "sha256:ab3c5d668c7d2817bd0a9b3e40dbeab6bd3623ae92e9439292d1d32662ba57e1",
  max1: "sha256:d31a518831b9a978295047310800a34eaf81ed56dde58eea46918dc581563ca2",
  max2: "sha256:11665ee88f09c6cbe498026cacd8505b0fe02ee7f19ac8b4d3f68aa534f3435c",
};
const fail = (name) => {
  throw new Error(`V207_ATTEMPT35_CLOSURE_${name}`);
};
const assert = (condition, name) => {
  if (!condition) fail(name);
};
const bytes = (path) => readFileSync(path);
const text = (path) => String(bytes(path));
const json = (path) => JSON.parse(text(path));
const sha = (path) => `sha256:${createHash("sha256").update(bytes(path)).digest("hex")}`;

const closurePath = resolve(evidenceDir, "failed-attempt-35.json");
const cleanupPath = resolve(evidenceDir, "attempt35-cleanup-observation.json");
const closure = json(closurePath);
const cleanup = json(cleanupPath);
assert(sha(resolve(candidateDir, "combined-live-proposal.json")) === expected.proposal, "PROPOSAL_HASH");
assert(sha(resolve(candidateDir, "approved-authority.json")) === expected.authority, "AUTHORITY_HASH");
assert(sha(resolve(candidateDir, "acceptance.json")) === expected.acceptance, "ACCEPTANCE_HASH");
assert(sha(resolve(candidateDir, "staged-config-max1.json")) === expected.max1, "MAX1_HASH");
assert(sha(resolve(candidateDir, "staged-config-max2.json")) === expected.max2, "MAX2_HASH");
assert(sha(closurePath) === expected.closure, "CLOSURE_HASH");
assert(sha(cleanupPath) === expected.cleanup, "CLEANUP_HASH");

assert(closure.result === "NOT_QUALIFIED_CONCURRENT_READER_STATUS_RECONCILIATION_FAILED_CLOSED", "RESULT");
assert(closure.authority_state === "CONSUMED_CLOSED_DO_NOT_REUSE", "AUTHORITY_STATE");
assert(closure.proposal.sha256 === expected.proposal && closure.authority.sha256 === expected.authority, "LINEAGE");
assert(closure.authority.fresh_maximum_cumulative_finite_spend_usd === 4, "CAP");
assert(closure.authority.consumed === true && closure.authority.reusable === false, "NON_REUSE");
assert(closure.lineage.initial_config_sha256 === expected.max1, "MAX1_LINEAGE");
assert(closure.lineage.concurrent_reader_config_sha256 === expected.max2, "MAX2_LINEAGE");
assert(closure.accepted_batches.length === 3, "BATCH_COUNT");
assert(closure.accepted_batches.every((batch) => batch.item_count === 32 && batch.durable_readback_count === 32 && batch.replay_confirmed_commit_receipt_count === 32), "BATCH_DURABILITY");
assert(closure.accepted_totals.complete_batches === 3 && closure.accepted_totals.durable_outputs === 96 && closure.accepted_totals.replay_confirmed_v3_commit_receipts === 96, "TOTALS");
assert(closure.accepted_totals.duplicate_delivery_same_job === true && closure.accepted_totals.duplicate_provider_dispatch === false && closure.accepted_totals.duplicate_compute === false, "DUPLICATE_FENCE");
assert(closure.accepted_totals.manifest_before_after_equal === true && closure.accepted_totals.model_volume_mutation_detected === false && closure.accepted_totals.cross_mount_detected === false && closure.accepted_totals.runtime_download_or_quantization === false && closure.accepted_totals.cache_escape_detected === false, "SEALED_VOLUME");
assert(closure.failure.stage === "CONCURRENT_READER_STATUS_RECONCILIATION" && closure.failure.reader_jobs_dispatched === 2 && closure.failure.reader_batches_accepted === 0, "READER_FAILURE");
assert(closure.failure.cleanup_later_observed_both_reader_jobs === "COMPLETED" && closure.failure.retry_or_redispatch_performed === false, "READER_TERMINAL");
assert(closure.rollback.generated_outputs === "CONFIRMED" && closure.rollback.signer_secret_deleted === true && closure.rollback.worker_version_rolled_back === true && closure.rollback.route_restored_code === "V207_ROUTE_DISABLED", "ROLLBACK");
assert(closure.cost.settled_incremental_spend_usd === 0 && closure.cost.within_approved_cap === true && closure.cost.maximum_cumulative_finite_spend_usd === 4, "SETTLEMENT");
assert(closure.qualification.status === "OPEN" && closure.qualification.v2_07 === "NOT_QUALIFIED" && closure.qualification.v2_08_authorized === false, "GATE");

assert(cleanup.result === "CLEANUP_AND_SETTLEMENT_CONFIRMED", "CLEANUP_RESULT");
assert(cleanup.failed_cleanup.final_disposable_resources_absent === true && cleanup.failed_cleanup.endpoint_deleted === true && cleanup.failed_cleanup.template_deleted === true, "DISPOSABLE_CLEANUP");
const reconciliation = cleanup.three_stable_reconciliation_reads;
assert(reconciliation.pods === 0 && reconciliation.endpoints === 0 && reconciliation.private_templates === 0 && reconciliation.active_serverless_workers === 0 && reconciliation.running_pods === 0, "ZERO_COMPUTE");
assert(reconciliation.retained_volumes.length === 2 && reconciliation.retained_volumes.every((volume) => volume.size_gb === 50 && volume.region === "EU-RO-1"), "VOLUMES");
assert(reconciliation.incremental_spend_usd === 0 && reconciliation.within_approved_cap === true && reconciliation.settlement === "THREE_STABLE_READS", "FINAL_SETTLEMENT");
assert(cleanup.retention.mage_volume_retained_unchanged === true && cleanup.retention.model_volume_write_authorized_or_observed === false, "MAGE_RETENTION");

const context = [
  text(resolve(root, "project-context/CURRENT_STATE.yaml")),
  text(resolve(root, "project-context/GATES.yaml")),
  text(resolve(root, "project-context/00_START_HERE.md")),
  text(resolve(root, "project-context/tasks/VF-10-07.md")),
  text(resolve(root, "apps/web/src/server/providers/v207-activation-authority.ts")),
].join("\n");
for (const value of [expected.proposal, expected.authority, expected.closure, expected.cleanup]) assert(context.includes(value), `CONTEXT_${value.slice(-8)}`);
for (const value of ["provider_calls_authorized: false", "gpu_use_authorized: false", "maximum_external_spend_usd: 0", "CONSUMED_CLOSED_DO_NOT_REUSE", "V2-08"]) assert(context.includes(value), `BOUNDARY_${value}`);
assert(context.includes("V207_APPROVED_FINITE_CAP_USD: number | null = null"), "ACTIVATION_CAP_CLOSED");

console.log("V2-07 Attempt35 closure validation PASS");

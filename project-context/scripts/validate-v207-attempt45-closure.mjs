#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const LIVE = path.join(ROOT, "project-context/evidence/acceptance/VF-10-07/2026-08-21-live-qualification");
const CANDIDATE = path.join(ROOT, "project-context/evidence/acceptance/VF-10-07/2026-08-23-attempt45-resume-get-lifetime-repair-candidate");
const STATE = path.join(ROOT, "project-context/CURRENT_STATE.yaml");
const GATES = path.join(ROOT, "project-context/GATES.yaml");
const START = path.join(ROOT, "project-context/00_START_HERE.md");
const TASK = path.join(ROOT, "project-context/tasks/VF-10-07.md");
const expected = {
  proposal: "sha256:a2f336fe5bb0291ef436699d60a0f6885948c4a5cf52d724a184caa917718770",
  authority: "sha256:e73bd7ecdf22db25bfebbb260364c580831ce949e7338bb133bf4def1b2b6b67",
  closure: "sha256:f287a7ec8ea064587e251f5ccb9b5321025d37976fdbf40b0b894a962c71167c",
  cleanup: "sha256:d23b169a2920e27b25e691e04758fbe123d3f41f3f1eb618940f998bc89d2f55",
  reconciliation: "sha256:e786ee74546632ed38aeef5acf3860605693cd7255a4a19ba44d99ca91b82c2d",
  orchestrator: "sha256:e03a47850af3fc452fced31f45d5c62485e5a595e0b632e7dfce5fa12984c42a",
};
const fail = (message) => { throw new Error(`V207_ATTEMPT45_CLOSURE_INVALID: ${message}`); };
const ok = (condition, message) => { if (!condition) fail(message); };
const eq = (actual, wanted, label) => { if (actual !== wanted) fail(`${label} expected ${JSON.stringify(wanted)} got ${JSON.stringify(actual)}`); };
const sha = (file) => `sha256:${crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")}`;
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const closurePath = path.join(LIVE, "failed-attempt-45.json");
const cleanupPath = path.join(LIVE, "attempt45-cleanup-observation.json");
const reconciliationPath = path.join(LIVE, "attempt45-reconciliation-observation.json");
eq(sha(path.join(CANDIDATE, "combined-live-proposal.json")), expected.proposal, "proposal hash");
eq(sha(path.join(CANDIDATE, "approved-authority.json")), expected.authority, "authority hash");
eq(sha(closurePath), expected.closure, "closure hash");
eq(sha(cleanupPath), expected.cleanup, "cleanup hash");
eq(sha(reconciliationPath), expected.reconciliation, "reconciliation hash");
const closure = read(closurePath);
const cleanup = read(cleanupPath);
const reconciliation = read(reconciliationPath);
const state = fs.readFileSync(STATE, "utf8");
const gates = fs.readFileSync(GATES, "utf8");
const start = fs.readFileSync(START, "utf8");
const task = fs.readFileSync(TASK, "utf8");
eq(closure.result, "NOT_QUALIFIED_ATTEMPT45_SIGNER_DISABLED_DEPLOY_FAILED_CLEAN", "closure result");
eq(closure.proposal.sha256, expected.proposal, "closure proposal");
eq(closure.authority.sha256, expected.authority, "closure authority");
eq(closure.authority.maximum_cumulative_finite_spend_usd, 4, "closure cap");
eq(closure.authority.consumed, true, "closure consumed");
eq(closure.authority.reusable, false, "closure reusable");
eq(closure.execution.failure_code, "V207_SIGNER_DISABLED_DEPLOY_FAILED", "failure code");
eq(closure.execution.failure_stage, "cloudflare_signer_disabled_deploy", "failure stage");
eq(closure.execution.orchestrator_sha256, expected.orchestrator, "orchestrator hash");
eq(closure.execution.runpod_calls_reached, false, "RunPod calls");
eq(closure.execution.runpod_endpoint_or_template_created, false, "RunPod resources");
eq(closure.execution.runpod_jobs_submitted, 0, "jobs");
eq(closure.execution.gpu_use, false, "GPU");
eq(closure.execution.accepted_outputs, 0, "outputs");
eq(closure.execution.durable_readbacks, 0, "readbacks");
eq(closure.execution.v3_receipts, 0, "receipts");
eq(closure.independent_audit_finding.bound_canonical_activation_source_sha256, "sha256:82e3e571a304e96ace9cbd861c8cd2e691e36964223c40702d0115a17931f7d7", "bound canonical hash");
eq(closure.independent_audit_finding.recomputed_canonical_activation_source_sha256, "sha256:b7cc1e1e681cd8526f5b6c22d825a5e1b3b1ab8daf1c24ef604abb4f5bbead2e", "recomputed canonical hash");
eq(closure.independent_audit_finding.relationship_to_live_failure, "INDEPENDENT_BLOCKER; NOT CLAIMED AS DEPLOY_FAILURE_CAUSE", "audit attribution");
eq(closure.cleanup.sha256, expected.cleanup, "closure cleanup");
eq(closure.reconciliation.sha256, expected.reconciliation, "closure reconciliation");
eq(closure.qualification_status, "NOT_QUALIFIED", "qualification");
eq(cleanup.result, "CLEAN_ROLLBACK_CONFIRMED", "cleanup result");
eq(cleanup.cloudflare.signer_secret_activated, false, "signer secret");
eq(cleanup.cloudflare.worker_rollback_confirmed, true, "Worker rollback");
eq(cleanup.cloudflare.restored_route, "404 V207_ROUTE_DISABLED", "route");
eq(cleanup.protected_config.mode, "0600", "config mode");
eq(cleanup.protected_config.sha256, "sha256:da8c9232c9f6fe0f745a16f56f0855d726092df205e08eda6725fc0a146db774", "config hash");
eq(cleanup.protected_config.unchanged, true, "config unchanged");
eq(cleanup.runpod.jobs_submitted, 0, "cleanup jobs");
eq(cleanup.cleanup_uncertain, false, "cleanup uncertainty");
eq(cleanup.retained_volumes_untouched, true, "volumes untouched");
eq(reconciliation.result, "PASS_THREE_STABLE_READS_ZERO_DISPOSABLE_RESOURCES", "reconciliation result");
eq(reconciliation.provider_mutations_during_reconciliation, 0, "reconciliation mutations");
for (const key of ["pods", "endpoints", "private_templates", "active_serverless_workers", "running_pods"]) eq(reconciliation.inventory[key], 0, `inventory ${key}`);
eq(reconciliation.inventory.retained_volumes.length, 2, "volume count");
const mage = reconciliation.inventory.retained_volumes.find((volume) => volume.purpose === "Mage");
const soulx = reconciliation.inventory.retained_volumes.find((volume) => volume.purpose === "SoulX");
ok(mage, "Mage volume missing");
ok(soulx, "SoulX volume missing");
eq(mage.id_sha256, "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619", "Mage volume");
eq(mage.size_gb, 50, "Mage size");
eq(mage.region, "EU-RO-1", "Mage region");
eq(mage.mount, "/runpod-volume", "Mage mount");
eq(soulx.size_gb, 50, "SoulX size");
eq(soulx.region, "EU-RO-1", "SoulX region");
eq(reconciliation.billing.baseline_endpoint_spend_usd, 1.5903418626403436, "billing baseline");
eq(reconciliation.billing.final_endpoint_spend_usd, 1.6217972798040137, "billing final");
eq(reconciliation.billing.observed_increment_usd, 0.03145541716367006, "billing increment");
eq(reconciliation.billing.maximum_cumulative_finite_spend_usd, 4, "billing cap");
eq(reconciliation.billing.settlement, "THREE_STABLE_READS", "billing settlement");
eq(reconciliation.billing.attribution, "UNATTRIBUTED_LATE_PROVIDER_BILLING; ATTEMPT45_SUBMITTED_ZERO_RUNPOD_JOBS", "billing attribution");
eq(reconciliation.billing.within_approved_cap, true, "billing cap");
eq(reconciliation.retention.mage_volume_retained, true, "Mage retained");
eq(reconciliation.retention.soulx_volume_retained, true, "SoulX retained");
eq(reconciliation.retention.volume_mutation_authorized, false, "volume mutation authority");
eq(reconciliation.retention.volume_mutation_observed, false, "volume mutation observed");
eq(reconciliation.retention.existing_two_volume_charge_usd_per_month, 7, "volume charge");
eq(reconciliation.gpu_jobs_submitted_during_attempt45, 0, "reconciliation jobs");
eq(reconciliation.v2_08_authorized, false, "V2-08");
for (const [name, surface] of Object.entries({ state, gates, start, task })) {
  ok(surface.includes("failed-attempt-45.json"), `${name} closure pointer`);
  ok(surface.includes(expected.closure), `${name} closure hash`);
  ok(surface.includes("V2-08"), `${name} V2-08 fence`);
}
for (const [needle, label] of [
  ["phase: serverless_v2_v2_07_attempt46_candidate_pending_fresh_exact_approval", "state phase"],
  ["task_stage: provider_free_candidate", "state task stage"],
  ["provider_calls_authorized: false", "state provider calls"],
  ["read_only_provider_calls_authorized: false", "state read-only calls"],
  ["remote_or_cloud_mutations_authorized: false", "state mutations"],
  ["gpu_use_authorized: false", "state GPU"],
  ["maximum_external_spend_usd: 0", "state cap"],
  ["current_authority: null", "state current authority"],
  ["current_authority_sha256: null", "state current authority hash"],
  ["current_goal_authority: null", "state candidate authority"],
  ["current_authority_sha256: null", "state candidate authority hash"],
  ["authority_state: CONSUMED_CLOSED_DO_NOT_REUSE", "state authority state"],
  ["mode: closed_consumed_attempt45_signer_disabled_deploy_failed_clean", "state Attempt45 mode"],
  ["result: NOT_QUALIFIED_attempt45_signer_disabled_deploy_failed_clean", "state Attempt45 result"],
  ["latest_live_check:", "state latest live check"],
  ["f945392", "canonical repair"],
  ["7066520", "deploy diagnostics repair"],
].map(([needle, label]) => [needle, label])) {
  ok(state.includes(needle), label);
}
for (const [needle, label] of [
  ["current_candidate_authority: null", "gate current authority"],
  ["current_candidate_authority_mode: none", "gate authority mode"],
  ["pending_authority: null", "gate pending authority"],
  ["pending_numeric_cap_usd: null", "gate pending cap"],
  ["latest_closed_authority_mode: closed_consumed_attempt45_signer_disabled_deploy_failed", "gate Attempt45 authority state"],
  ["provider_calls_authorized: false", "gate provider calls"],
  ["provider_mutations_authorized: false", "gate mutations"],
  ["gpu_use_authorized: false", "gate GPU"],
  ["7066520", "gate deploy diagnostics repair"],
].map(([needle, label]) => [needle, label])) {
  ok(gates.includes(needle), label);
}
console.log("PASS validate-v207-attempt45-closure", JSON.stringify(expected));

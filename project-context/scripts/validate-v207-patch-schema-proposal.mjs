import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const candidate = resolve(
  root,
  "project-context/evidence/acceptance/VF-10-07/2026-08-21-patch-schema-requalification-candidate",
);
const proposalPath = resolve(candidate, "combined-live-proposal.json");
const authorityPath = resolve(candidate, "approved-authority.json");
const [proposalBytes, authorityBytes, attempt18Bytes, state, gate, task, activation, control, reconciliation, qualification] = await Promise.all([
  readFile(proposalPath),
  readFile(authorityPath),
  readFile(resolve(root, "project-context/evidence/acceptance/VF-10-07/2026-08-20-live-qualification/failed-attempt-18.json")),
  readFile(resolve(root, "project-context/CURRENT_STATE.yaml"), "utf8"),
  readFile(resolve(root, "project-context/GATES.yaml"), "utf8"),
  readFile(resolve(root, "project-context/tasks/VF-10-07.md"), "utf8"),
  readFile(resolve(root, "apps/web/src/server/providers/v207-activation-authority.ts"), "utf8"),
  readFile(resolve(root, "apps/web/src/server/providers/runpod-control.ts"), "utf8"),
  readFile(resolve(root, "apps/web/src/server/providers/runpod-v207-readonly-reconciliation.ts"), "utf8"),
  readFile(resolve(root, "apps/web/src/server/providers/v207-live-qualification.ts"), "utf8"),
]);
const proposal = JSON.parse(proposalBytes.toString("utf8"));
const authority = JSON.parse(authorityBytes.toString("utf8"));
const attempt18 = JSON.parse(attempt18Bytes.toString("utf8"));
const hash = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const proposalHash = hash(proposalBytes);
const expectedProposalHash =
  "sha256:2752b61dfe4481eaa15ef349f859d91650160971a828d7d19af2638f7c8715be";
const expectedAuthorityHash =
  "sha256:bd077b2ae63fcf60a6e9c7dca0b95c777f360f28c9c53a7e7cf1d2dcca60e11c";
const assert = (condition, label) => {
  if (!condition) throw new Error(`V207_PATCH_SCHEMA_PROPOSAL_INVALID:${label}`);
};

assert(proposalHash === expectedProposalHash, "proposal_hash");
assert(proposal.checkpoint === "V2-07", "checkpoint");
assert(proposal.user_approval?.maximum_cumulative_finite_spend_usd === null, "cap_null");
assert(proposal.user_approval?.exact_proposal_approved === false, "approval_pending");
assert(hash(authorityBytes) === expectedAuthorityHash, "authority_hash");
assert(authority.proposal?.sha256 === expectedProposalHash, "authority_proposal");
assert(authority.approval?.exact_proposal_approved === true, "authority_approved");
assert(authority.approval?.flashboot_true_accepted === true, "authority_flashboot");
assert(authority.approval?.low_eu_ro_1_availability_approved === true, "authority_low_availability");
assert(authority.approval?.maximum_cumulative_finite_spend_usd === 4, "authority_cap");
assert(authority.approval?.fresh_numeric_cap === true, "authority_fresh_cap");
assert(authority.approval?.historical_cap_reused === false, "authority_no_cap_reuse");
assert(proposal.lineage?.control_source_commit === "253723cf521a77d001fbaa4d165acb79b848415e", "control_commit");
assert(proposal.lineage?.prior_proposal_sha256 === "sha256:6bc0cef713615f5bdd47b85a5903249644f514f7666956941d5435288d6bd99c", "prior_proposal");
assert(proposal.staged_endpoint_configs?.length === 2, "two_configs");
for (const config of proposal.staged_endpoint_configs) {
  const bytes = await readFile(resolve(candidate, config.definition_path));
  assert(hash(bytes) === config.definition_sha256, `config_hash_${config.stage}`);
  const definition = JSON.parse(bytes.toString("utf8"));
  assert(definition.control_source_commit === proposal.lineage.control_source_commit, `config_control_commit_${config.stage}`);
  assert(config.flashboot === true, `flashboot_${config.stage}`);
  assert(config.gpu === "NVIDIA GeForce RTX 4090", `gpu_${config.stage}`);
}
assert(authority.lineage?.control_source_commit === proposal.lineage.control_source_commit, "authority_control_commit");
assert(authority.lineage?.initial_config_sha256 === proposal.staged_endpoint_configs[0].definition_sha256, "authority_max1");
assert(authority.lineage?.concurrent_reader_config_sha256 === proposal.staged_endpoint_configs[1].definition_sha256, "authority_max2");
assert(JSON.stringify(authority.authorized_operations) === JSON.stringify(proposal.proposed_operations_in_order), "authority_operations");
assert(JSON.stringify(authority.allowed_operations) === JSON.stringify(authority.authorized_operations), "authority_allowed_operations");
assert(JSON.stringify(authority.forbidden) === JSON.stringify(proposal.forbidden), "authority_forbidden");
assert(JSON.stringify(authority.stop_conditions) === JSON.stringify(proposal.cleanup_rollback_and_stop_conditions.stop_if), "authority_stop_conditions");
assert(authority.execution_boundary?.runpod_mutation_authorized_pending_execution === true, "authority_runpod");
assert(authority.execution_boundary?.cloudflare_mutation_authorized_pending_execution === true, "authority_cloudflare");
assert(authority.execution_boundary?.gpu_use_authorized_pending_execution === true, "authority_gpu");
assert(authority.execution_boundary?.v2_08_authorized === false, "authority_no_v208");
assert(hash(attempt18Bytes) === "sha256:86e0a4a0a8e3afd9fc26f94d5e2c04697a0d6f15dba4b757fa383eae6bc870a4", "attempt18_hash");
assert(attempt18.attempt === 18, "attempt18_number");
assert(attempt18.authority_status === "CLOSED_EXACT_ATTEMPT_CONSUMED_DO_NOT_REUSE", "attempt18_authority_closed");
assert(attempt18.failure?.code === "RUNPOD_ENDPOINT_ID_BINDING_UNCONFIRMED", "attempt18_failure");
assert(attempt18.failure?.gpu_jobs_submitted === 0 && attempt18.failure?.batch_count === 0, "attempt18_no_dispatch");
assert(attempt18.runpod_cleanup?.final_disposable_resources_absent === true, "attempt18_cleanup");
assert(attempt18.billing?.attempt_increment_usd_settled === 0, "attempt18_zero_spend");
assert(attempt18.qualification_boundaries?.v2_07 === "NOT_QUALIFIED", "attempt18_gate_open");
const failedAttemptBytes = await readFile(
  resolve(candidate, proposal.lineage.failed_attempt_evidence),
);
assert(hash(failedAttemptBytes) === proposal.lineage.failed_attempt_evidence_sha256, "attempt17_hash");
assert(proposal.last_observed_provider_truth?.pods === 0, "zero_pods");
assert(proposal.last_observed_provider_truth?.endpoints === 0, "zero_endpoints");
assert(proposal.last_observed_provider_truth?.private_templates === 0, "zero_templates");
assert(proposal.last_observed_provider_truth?.active_serverless_workers === 0, "zero_workers");
assert(proposal.rates_cost_and_retention?.serverless_flex_rtx4090_usd_per_gpu_hour === 1.1, "rate");
assert(proposal.rates_cost_and_retention?.existing_two_volume_charge_usd_per_month_total === 7, "volume_charge");
assert(proposal.forbidden?.includes("V2-08 or successor work"), "v2_08_forbidden");
assert(
  state.includes("provider_authority: &v2_07_provider_authority\n  mode: none\n  provider: null\n  cap_usd: 0"),
  "current_state_closed",
);
assert(state.includes(expectedAuthorityHash), "current_state_historical_authority");
assert(state.includes("task_stage: provider_free_repair"), "current_state_stage");
assert(state.includes("provider_calls_authorized: false"), "current_state_provider_boundary");
assert(gate.includes("failed-attempt-18.json"), "gate");
assert(task.includes(expectedProposalHash), "task");
assert(activation.includes(expectedProposalHash), "compiled_proposal");
assert(activation.includes("V207_APPROVED_FINITE_CAP_USD: number | null = null"), "compiled_authority_closed");
const bindMethod = control.slice(
  control.indexOf("async bindV207EndpointIdentity("),
  control.indexOf("async createNetworkVolume("),
);
assert(!bindMethod.includes('computeType: "GPU"'), "patch_compute_type_absent");
assert(bindMethod.includes('this.mutate("PATCH"'), "patch_present");
assert(!reconciliation.includes("ATTEMPT_17_BASELINE_ENDPOINT_SPEND_USD"), "no_hardcoded_attempt_baseline");
assert(reconciliation.includes("baselineEndpointSpendUsd: number"), "fresh_baseline_required");
assert(qualification.includes("const reconciliation = await reconcileV207Readonly({"), "failure_reconciliation_wired");
assert(qualification.includes("baselineEndpointSpendUsd: baseline"), "failure_reconciliation_uses_fresh_baseline");

process.stdout.write(`V2-07 patch-schema proposal validation PASS (${proposalHash})\n`);

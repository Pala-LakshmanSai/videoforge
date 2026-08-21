import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const candidate = resolve(
  root,
  "project-context/evidence/acceptance/VF-10-07/2026-08-21-patch-schema-requalification-candidate",
);
const proposalPath = resolve(candidate, "combined-live-proposal.json");
const [proposalBytes, state, gate, task, activation, control, reconciliation, qualification] = await Promise.all([
  readFile(proposalPath),
  readFile(resolve(root, "project-context/CURRENT_STATE.yaml"), "utf8"),
  readFile(resolve(root, "project-context/GATES.yaml"), "utf8"),
  readFile(resolve(root, "project-context/tasks/VF-10-07.md"), "utf8"),
  readFile(resolve(root, "apps/web/src/server/providers/v207-activation-authority.ts"), "utf8"),
  readFile(resolve(root, "apps/web/src/server/providers/runpod-control.ts"), "utf8"),
  readFile(resolve(root, "apps/web/src/server/providers/runpod-v207-readonly-reconciliation.ts"), "utf8"),
  readFile(resolve(root, "apps/web/src/server/providers/v207-live-qualification.ts"), "utf8"),
]);
const proposal = JSON.parse(proposalBytes.toString("utf8"));
const hash = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const proposalHash = hash(proposalBytes);
const expectedProposalHash =
  "sha256:2752b61dfe4481eaa15ef349f859d91650160971a828d7d19af2638f7c8715be";
const assert = (condition, label) => {
  if (!condition) throw new Error(`V207_PATCH_SCHEMA_PROPOSAL_INVALID:${label}`);
};

assert(proposalHash === expectedProposalHash, "proposal_hash");
assert(proposal.checkpoint === "V2-07", "checkpoint");
assert(proposal.user_approval?.maximum_cumulative_finite_spend_usd === null, "cap_null");
assert(proposal.user_approval?.exact_proposal_approved === false, "approval_pending");
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
assert(state.includes(expectedProposalHash) && state.includes("cap_usd: 0"), "current_state");
assert(gate.includes(expectedProposalHash), "gate");
assert(task.includes(expectedProposalHash), "task");
assert(activation.includes(expectedProposalHash), "compiled_proposal");
assert(activation.includes("V207_APPROVED_FINITE_CAP_USD: number | null = null"), "compiled_cap_null");
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

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const candidate = resolve(
  root,
  "project-context/evidence/acceptance/VF-10-07/2026-08-21-partial-patch-acknowledgement-candidate",
);
const proposalPath = resolve(candidate, "combined-live-proposal.json");
const expectedProposalHash =
  "sha256:33ab018224dd452aabb8eeafe22c3895cd89908f2c5251160eec92afecef920e";
const expectedControlCommit = "e09a2d0bf2cae873eb49ac545241baa427bbfa05";
const hash = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const assert = (condition, label) => {
  if (!condition) throw new Error(`V207_PARTIAL_PATCH_PROPOSAL_INVALID:${label}`);
};

const [proposalBytes, state, gate, task, activation, control, controlTest] = await Promise.all([
  readFile(proposalPath),
  readFile(resolve(root, "project-context/CURRENT_STATE.yaml"), "utf8"),
  readFile(resolve(root, "project-context/GATES.yaml"), "utf8"),
  readFile(resolve(root, "project-context/tasks/VF-10-07.md"), "utf8"),
  readFile(resolve(root, "apps/web/src/server/providers/v207-activation-authority.ts"), "utf8"),
  readFile(resolve(root, "apps/web/src/server/providers/runpod-control.ts"), "utf8"),
  readFile(resolve(root, "apps/web/src/server/providers/runpod-control.test.ts"), "utf8"),
]);
const proposal = JSON.parse(proposalBytes.toString("utf8"));

assert(hash(proposalBytes) === expectedProposalHash, "proposal_hash");
assert(proposal.checkpoint === "V2-07" && proposal.task_id === "VF-10-07", "scope");
assert(proposal.user_approval?.maximum_cumulative_finite_spend_usd === null, "cap_null");
assert(proposal.user_approval?.fresh_numeric_cap_required === true, "fresh_cap_required");
assert(proposal.user_approval?.exact_proposal_approved === false, "approval_pending");
assert(proposal.lineage?.control_source_commit === expectedControlCommit, "control_commit");
assert(
  proposal.lineage?.prior_proposal_sha256 ===
    "sha256:2752b61dfe4481eaa15ef349f859d91650160971a828d7d19af2638f7c8715be",
  "prior_proposal",
);
assert(
  proposal.lineage?.prior_authority_sha256 ===
    "sha256:bd077b2ae63fcf60a6e9c7dca0b95c777f360f28c9c53a7e7cf1d2dcca60e11c",
  "prior_authority",
);
assert(proposal.lineage?.prior_authority_state === "CLOSED_EXACT_ATTEMPT_CONSUMED_DO_NOT_REUSE", "prior_closed");
const attemptBytes = await readFile(resolve(candidate, proposal.lineage.failed_attempt_evidence));
assert(hash(attemptBytes) === proposal.lineage.failed_attempt_evidence_sha256, "attempt18_hash");
const attempt = JSON.parse(attemptBytes.toString("utf8"));
assert(attempt.attempt === 18 && attempt.billing?.attempt_increment_usd_settled === 0, "attempt18");
assert(attempt.runpod_cleanup?.final_disposable_resources_absent === true, "attempt18_cleanup");

assert(Array.isArray(proposal.staged_endpoint_configs) && proposal.staged_endpoint_configs.length === 2, "two_configs");
for (const config of proposal.staged_endpoint_configs) {
  const bytes = await readFile(resolve(candidate, config.definition_path));
  assert(hash(bytes) === config.definition_sha256, `config_hash_${config.stage}`);
  const definition = JSON.parse(bytes.toString("utf8"));
  assert(definition.schema_version === "videoforge.v2-07-staged-endpoint-definition/v5", `config_schema_${config.stage}`);
  assert(definition.control_source_commit === expectedControlCommit, `config_commit_${config.stage}`);
  assert(definition.flashboot === true && definition.region === "EU-RO-1", `config_placement_${config.stage}`);
  assert(definition.endpoint_identity_binding?.endpoint_patch_acknowledgement_requires_exact_endpoint_id === true, `ack_id_${config.stage}`);
  assert(definition.endpoint_identity_binding?.endpoint_patch_acknowledgement_omitted_fields_are_unconfirmed === true, `ack_omissions_${config.stage}`);
  assert(definition.endpoint_identity_binding?.endpoint_patch_acknowledgement_present_known_fields_must_match === true, `ack_conflicts_${config.stage}`);
  assert(definition.endpoint_identity_binding?.endpoint_get_readback_must_match_complete_config_and_environment === true, `strict_get_${config.stage}`);
}
assert(proposal.staged_endpoint_configs[0].workers_max === 1, "max_one");
assert(proposal.staged_endpoint_configs[1].workers_max === 2, "max_two");
assert(proposal.last_observed_provider_truth?.pods === 0, "zero_pods");
assert(proposal.last_observed_provider_truth?.endpoints === 0, "zero_endpoints");
assert(proposal.last_observed_provider_truth?.active_serverless_workers === 0, "zero_workers");
assert(proposal.rates_cost_and_retention?.serverless_flex_rtx4090_usd_per_gpu_hour === 1.1, "rate");
assert(proposal.rates_cost_and_retention?.existing_two_volume_charge_usd_per_month_total === 7, "volume_charge");
assert(proposal.forbidden?.includes("V2-08 or successor work"), "v2_08_forbidden");

assert(control.includes("const v207EndpointPatchAcknowledgementMatches"), "partial_ack_matcher");
assert(control.includes("value?.id === expected.endpointId"), "partial_ack_exact_id");
assert(control.includes("matchesIfPresent(value.workersMax, expected.policy.workersMax)"), "partial_ack_conflict_check");
assert(control.includes("const readbackValue = record(await this.read(`/endpoints/${endpointId}`))"), "mandatory_get");
assert(control.includes("v207EndpointBindingMatches(readbackValue, expected)"), "strict_get_matcher");
assert(controlTest.includes("partial PATCH acknowledgement"), "partial_ack_test");
assert(controlTest.includes("without the exact endpoint identity"), "missing_id_test");
assert(controlTest.includes("full GET configuration drift"), "strict_get_test");

assert(state.includes(expectedProposalHash), "state_proposal");
assert(state.includes("provider_calls_authorized: false"), "state_no_provider");
assert(state.includes("maximum_external_spend_usd: 0"), "state_zero_cap");
assert(gate.includes(expectedProposalHash.slice(7)), "gate_proposal");
assert(task.includes(expectedProposalHash), "task_proposal");
assert(activation.includes(expectedProposalHash), "activation_proposal");
assert(activation.includes("V207_APPROVED_FINITE_CAP_USD: number | null = null"), "activation_closed");

process.stdout.write(`V2-07 partial PATCH acknowledgement proposal validation PASS (${expectedProposalHash})\n`);

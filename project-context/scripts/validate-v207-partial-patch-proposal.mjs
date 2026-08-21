import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const candidate = resolve(
  root,
  "project-context/evidence/acceptance/VF-10-07/2026-08-21-partial-patch-acknowledgement-candidate",
);
const proposalPath = resolve(candidate, "combined-live-proposal.json");
const authorityPath = resolve(candidate, "approved-authority.json");
const expectedProposalHash =
  "sha256:ce11e4efb3b97f47c9ca70f83451ce6535e8467ac506b682527466f9327dafde";
const expectedAuthorityHash =
  "sha256:b824bea61e30c4ad1b5eda4bf8113c390c0ae0eff0a03c6fb279210e81d9e5c2";
const currentSuccessorProposal =
  "sha256:9e9675dcf6943dce35b4bf6155fdfc39f8dade5e9775bcc3ee9a427980d39e02";
const expectedControlCommit = "9331845d529fd54a8ec3afa5e2406e7c1ebb77bc";
const expectedImage =
  "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:bc662a182b2a874c6aeffb05f65cc3ffbdff6b5130c6a75c214618e86cf208b5";
const expectedVolume = "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619";
const expectedConfigHashes = [
  "sha256:da2f5a1ee7f412014ecc7b63911131da02b4b313bca1079f9471fef1fb807347",
  "sha256:889110673da3cfef09d8a534208acfc7bf8d980995ba1ad4ee1eec9c4ac95160",
];
const hash = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const assert = (condition, label) => {
  if (!condition) throw new Error(`V207_PARTIAL_PATCH_PROPOSAL_INVALID:${label}`);
};

const [proposalBytes, authorityBytes, attempt19Bytes, publicationBytes, state, gate, task, activation, control, controlTest, reconciliation, qualification] = await Promise.all([
  readFile(proposalPath),
  readFile(authorityPath),
  readFile(resolve(root, "project-context/evidence/acceptance/VF-10-07/2026-08-20-live-qualification/failed-attempt-19.json")),
  readFile(resolve(root, "project-context/evidence/acceptance/VF-10-07/2026-08-20-diagnostic-endpoint-bound-candidate/image-publication.json")),
  readFile(resolve(root, "project-context/CURRENT_STATE.yaml"), "utf8"),
  readFile(resolve(root, "project-context/GATES.yaml"), "utf8"),
  readFile(resolve(root, "project-context/tasks/VF-10-07.md"), "utf8"),
  readFile(resolve(root, "apps/web/src/server/providers/v207-activation-authority.ts"), "utf8"),
  readFile(resolve(root, "apps/web/src/server/providers/runpod-control.ts"), "utf8"),
  readFile(resolve(root, "apps/web/src/server/providers/runpod-control.test.ts"), "utf8"),
  readFile(resolve(root, "apps/web/src/server/providers/runpod-v207-readonly-reconciliation.ts"), "utf8"),
  readFile(resolve(root, "apps/web/src/server/providers/v207-live-qualification.ts"), "utf8"),
]);
const proposal = JSON.parse(proposalBytes.toString("utf8"));
const authority = JSON.parse(authorityBytes.toString("utf8"));
const attempt19 = JSON.parse(attempt19Bytes.toString("utf8"));

assert(hash(proposalBytes) === expectedProposalHash, "proposal_hash");
assert(proposal.checkpoint === "V2-07" && proposal.task_id === "VF-10-07", "scope");
assert(proposal.user_approval?.maximum_cumulative_finite_spend_usd === null, "cap_null");
assert(proposal.user_approval?.fresh_numeric_cap_required === true, "fresh_cap_required");
assert(proposal.user_approval?.exact_proposal_approved === false, "approval_pending");
assert(hash(authorityBytes) === expectedAuthorityHash, "authority_hash");
assert(authority.proposal?.sha256 === expectedProposalHash, "authority_proposal");
assert(authority.approval?.exact_proposal_approved === true, "authority_approved");
assert(authority.approval?.flashboot_true_accepted === true, "authority_flashboot");
assert(authority.approval?.low_eu_ro_1_availability_approved === true, "authority_low_availability");
assert(authority.approval?.maximum_cumulative_finite_spend_usd === 4, "authority_cap");
assert(authority.approval?.fresh_numeric_cap === true, "authority_fresh_cap");
assert(authority.approval?.historical_cap_reused === false, "authority_no_cap_reuse");
assert(proposal.lineage?.control_source_commit === expectedControlCommit, "control_commit");
assert(
  proposal.lineage?.model ===
    "Comfy-Org/Mage-Flow@d8c99241f6fa80fbd453014234af2bf337ea21e6#int8-convrot",
  "model",
);
assert(proposal.lineage?.model_manifest_sha256 === "sha256:cebcd5c6233c2eae32f26ced7510acef8192f0d92d7ec3e9dd3ee881d66d205b", "model_manifest");
assert(proposal.lineage?.volume_id_sha256 === expectedVolume, "volume");
assert(proposal.lineage?.volume_size_gb === 50 && proposal.lineage?.volume_region === "EU-RO-1", "volume_placement");
assert(proposal.lineage?.volume_mount === "/runpod-volume" && proposal.lineage?.model_root === "/runpod-volume/mage-model", "volume_paths");
assert(proposal.lineage?.final_image === expectedImage, "image");
assert(proposal.lineage?.image_manifest_sha256 === "sha256:bc662a182b2a874c6aeffb05f65cc3ffbdff6b5130c6a75c214618e86cf208b5", "image_manifest");
assert(proposal.lineage?.image_config_sha256 === "sha256:8e11a42cb91fa1d0d6a4e19fc6b4a6cfd5f77116c49a8516b6435813dfaab1de", "image_config");
assert(proposal.lineage?.image_layer_sha256 === "sha256:befafc2ec3d32a73b632f769069c9c02645d3fac049ebd2478fbf8ad3d5cdf38", "image_layer");
assert(proposal.lineage?.image_base_sha256 === "sha256:8a5b8f453c694b2eeee097e3d958b08c5e47c15290b5cdc17a4fb7e5e3e4f497", "image_base");
assert(proposal.lineage?.image_parent_config_sha256 === "sha256:de5c854ae5aa9e611e218b89d29a250eb03a0a316f0ac92d584d53a038d06ff2", "image_parent_config");
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
assert(authority.lineage?.failed_attempt_evidence_sha256 === proposal.lineage.failed_attempt_evidence_sha256, "authority_attempt18");
assert(authority.lineage?.image_publication_state === "ALREADY_PUBLISHED_EXACT_DIGEST_READBACK_PASS_NO_REPUBLICATION", "authority_publication_state");
assert(authority.lineage?.image_publication_evidence_sha256 !== hash(publicationBytes), "authority_publication_hash_mismatch_preserved");
assert(attempt19.attempt === 19 && attempt19.authority_status === "CLOSED_EXACT_ATTEMPT_CONSUMED_DO_NOT_REUSE", "attempt19_closed");
assert(attempt19.failure?.code === "RUNPOD_ENDPOINT_ID_BINDING_READBACK_UNCONFIRMED", "attempt19_failure");
assert(attempt19.runpod_cleanup?.final_disposable_resources_absent === true, "attempt19_cleanup");
assert(attempt19.billing?.attempt_increment_usd_settled === 0, "attempt19_zero_spend");
assert(attempt19.cloudflare_cleanup?.worker_version_restored === true, "attempt19_worker_restored");

assert(Array.isArray(proposal.staged_endpoint_configs) && proposal.staged_endpoint_configs.length === 2, "two_configs");
for (const [index, config] of proposal.staged_endpoint_configs.entries()) {
  assert(config.definition_sha256 === expectedConfigHashes[index], `config_expected_hash_${config.stage}`);
  const bytes = await readFile(resolve(candidate, config.definition_path));
  assert(hash(bytes) === config.definition_sha256, `config_hash_${config.stage}`);
  const definition = JSON.parse(bytes.toString("utf8"));
  assert(definition.schema_version === "videoforge.v2-07-staged-endpoint-definition/v5", `config_schema_${config.stage}`);
  assert(definition.control_source_commit === expectedControlCommit, `config_commit_${config.stage}`);
  assert(definition.flashboot === true && definition.region === "EU-RO-1", `config_placement_${config.stage}`);
  assert(definition.image === expectedImage && definition.network_volume_id_sha256 === expectedVolume, `config_identity_${config.stage}`);
  assert(definition.compute_type === "GPU" && definition.flex_only === true, `config_compute_${config.stage}`);
  assert(definition.workers_min === 0 && definition.handler_concurrency === 1, `config_workers_${config.stage}`);
  assert((definition.gpu_count ?? definition.gpu_count_per_worker) === 1, `config_gpu_count_${config.stage}`);
  assert(JSON.stringify(definition.gpu_type_ids) === JSON.stringify(["NVIDIA GeForce RTX 4090"]), `config_gpu_${config.stage}`);
  assert(definition.endpoint_identity_binding?.endpoint_patch_acknowledgement_requires_exact_endpoint_id === true, `ack_id_${config.stage}`);
  assert(definition.endpoint_identity_binding?.endpoint_patch_acknowledgement_omitted_fields_are_unconfirmed === true, `ack_omissions_${config.stage}`);
  assert(definition.endpoint_identity_binding?.endpoint_patch_acknowledgement_present_known_fields_must_match === true, `ack_conflicts_${config.stage}`);
  assert(definition.endpoint_identity_binding?.endpoint_get_readback_must_match_complete_config_and_environment === true, `strict_get_${config.stage}`);
}
assert(proposal.staged_endpoint_configs[0].workers_max === 1, "max_one");
assert(proposal.staged_endpoint_configs[1].workers_max === 2, "max_two");
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
assert(proposal.last_observed_provider_truth?.pods === 0, "zero_pods");
assert(proposal.last_observed_provider_truth?.endpoints === 0, "zero_endpoints");
assert(proposal.last_observed_provider_truth?.private_templates === 0, "zero_templates");
assert(proposal.last_observed_provider_truth?.active_serverless_workers === 0, "zero_workers");
assert(proposal.last_observed_provider_truth?.running_pods === 0, "zero_running_pods");
assert(proposal.last_observed_provider_truth?.intended_volume_count === 2, "two_volumes");
assert(proposal.rates_cost_and_retention?.serverless_flex_rtx4090_usd_per_gpu_hour === 1.1, "rate");
assert(proposal.rates_cost_and_retention?.existing_two_volume_charge_usd_per_month_total === 7, "volume_charge");
assert(proposal.forbidden?.includes("V2-08 or successor work"), "v2_08_forbidden");

assert(control.includes("const v207EndpointPatchAcknowledgementMatches"), "partial_ack_matcher");
assert(control.includes("value?.id === expected.endpointId"), "partial_ack_exact_id");
assert(control.includes("matchesIfPresent(value.workersMax, expected.policy.workersMax)"), "partial_ack_conflict_check");
assert(control.includes("const readbackValue = record(await this.read(`/endpoints/${endpointId}`))"), "mandatory_get");
assert(control.includes("classifyRunPodV207EndpointReadbackMismatch(readbackValue, expected)"), "strict_get_matcher");
assert(controlTest.includes("partial PATCH acknowledgement"), "partial_ack_test");
assert(controlTest.includes("without the exact endpoint identity"), "missing_id_test");
assert(controlTest.includes("full GET configuration drift"), "strict_get_test");
assert(reconciliation.includes("maximumCumulativeFiniteSpendUsd"), "reconciliation_cap_input");
assert(reconciliation.includes("V207_RECONCILIATION_FINITE_CAP_EXCEEDED"), "reconciliation_cap_exceeded");
assert(reconciliation.includes("within_approved_cap: true"), "reconciliation_cap_receipt");
assert(qualification.includes("maximumCumulativeFiniteSpendUsd: finiteCapUsd"), "qualification_cap_wiring");

assert(state.includes(expectedProposalHash), "state_proposal");
assert(state.includes(expectedAuthorityHash), "state_authority");
assert(state.includes("failed-attempt-19.json"), "state_attempt19");
assert(state.includes("task_stage: provider_free_repair") || state.includes("task_stage: bounded_mutation"), "state_stage");
assert(state.includes("provider_calls_authorized: false") || state.includes("provider_calls_authorized: true"), "state_provider_boundary");
assert(state.includes("maximum_external_spend_usd: 0") || state.includes("maximum_external_spend_usd: 4"), "state_cap_boundary");
assert(gate.includes("failed-attempt-22.json") && state.includes(currentSuccessorProposal), "gate_successor");
assert(task.includes(expectedProposalHash), "task_proposal");
assert(
  activation.includes("sha256:386dd8330f8e626d9afe8c8de8bbd1385fd9664b9fefbc472c24722105f917f9") ||
    activation.includes("sha256:be17430ce61a48a823a1ac87a128e83e44cfb88b01163331c285280e95274137") ||
    activation.includes("sha256:c8baa8a45b8e3e108904cac5f04f472ad22da2936dad75daa2a59d23476a8946"),
  "activation_successor_proposal",
);
assert(activation.includes("V207_APPROVED_FINITE_CAP_USD"), "activation_closed");

process.stdout.write(`V2-07 partial PATCH acknowledgement proposal validation PASS (${expectedProposalHash})\n`);

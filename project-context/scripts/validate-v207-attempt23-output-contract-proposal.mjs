import { createHash } from "node:crypto";
import { access, readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const candidate = resolve(
  root,
  "project-context/evidence/acceptance/VF-10-07/2026-08-21-attempt23-output-contract-diagnostic-candidate",
);
const paths = {
  proposal: resolve(candidate, "combined-live-proposal.json"),
  max1: resolve(candidate, "staged-config-max1.json"),
  max2: resolve(candidate, "staged-config-max2.json"),
  authority: resolve(candidate, "approved-authority.json"),
  acceptance: resolve(candidate, "acceptance.json"),
  closure: resolve(root, "project-context/evidence/acceptance/VF-10-07/2026-08-20-live-qualification/failed-attempt-22.json"),
  publication: resolve(root, "project-context/evidence/acceptance/VF-10-07/2026-08-20-diagnostic-endpoint-bound-candidate/image-publication.json"),
  state: resolve(root, "project-context/CURRENT_STATE.yaml"),
  gates: resolve(root, "project-context/GATES.yaml"),
  task: resolve(root, "project-context/tasks/VF-10-07.md"),
  start: resolve(root, "project-context/00_START_HERE.md"),
  activation: resolve(root, "apps/web/src/server/providers/v207-activation-authority.ts"),
  control: resolve(root, "apps/web/src/server/providers/v207-live-qualification.ts"),
  controlTest: resolve(root, "apps/web/src/server/providers/v207-live-qualification.test.ts"),
};

const EXPECTED = {
  proposal: "sha256:386dd8330f8e626d9afe8c8de8bbd1385fd9664b9fefbc472c24722105f917f9",
  max1: "sha256:45f8d447829d63517b78807ce710af7fbd81a9ff06d67cafe1a5a6bf37a15959",
  max2: "sha256:6b02604fd7a58ee98c350429663c038bbc5c93ea2e0786e64ac3a6ef3f476e8b",
  authority: "sha256:c59bd74673263eeeafed828dade74fe36ae2f27ed7914d413e37bfd6722a3b35",
  closure: "sha256:43f9db51e67a39e4a837614be5af14299d91c4fbdd446b9d78ecc51260da517a",
  control: "9f5a15c3382c03af675392dacc487b96811674ed",
  source: "79f123268b6ade640c02dd20616a89d16b43a5e6",
  image:
    "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:bc662a182b2a874c6aeffb05f65cc3ffbdff6b5130c6a75c214618e86cf208b5",
  manifest: "sha256:cebcd5c6233c2eae32f26ced7510acef8192f0d92d7ec3e9dd3ee881d66d205b",
  volume: "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619",
  model: "Comfy-Org/Mage-Flow@d8c99241f6fa80fbd453014234af2bf337ea21e6#int8-convrot",
  gpu: "NVIDIA GeForce RTX 4090",
  categories: [
    "identity",
    "environment",
    "flashboot",
    "region",
    "cuda",
    "volume",
    "gpu",
    "workers",
    "timing",
    "scaler",
  ],
  outputFields: [
    "error",
    "error_category",
    "output_status",
    "output_failure_code",
    "output_shape_kind",
    "output_shape_keys",
  ],
};

const hash = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const fail = (label) => {
  throw new Error(`V207_ATTEMPT23_OUTPUT_PROPOSAL_INVALID:${label}`);
};
const assert = (condition, label) => {
  if (!condition) fail(label);
};
const json = (bytes, label) => {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    fail(`${label}_json`);
  }
};
const exactArray = (left, right) => JSON.stringify(left) === JSON.stringify(right);

const [proposalBytes, max1Bytes, max2Bytes, authorityBytes, acceptanceBytes, closureBytes, publicationBytes, stateBytes, gatesBytes, taskBytes, startBytes, activationBytes, controlBytes, controlTestBytes] =
  await Promise.all([
    readFile(paths.proposal),
    readFile(paths.max1),
    readFile(paths.max2),
    readFile(paths.authority),
    readFile(paths.acceptance),
    readFile(paths.closure),
    readFile(paths.publication),
    readFile(paths.state),
    readFile(paths.gates),
    readFile(paths.task),
    readFile(paths.start),
    readFile(paths.activation),
    readFile(paths.control),
    readFile(paths.controlTest),
  ]);
const proposal = json(proposalBytes, "proposal");
const max1 = json(max1Bytes, "max1");
const max2 = json(max2Bytes, "max2");
const authority = json(authorityBytes, "authority");
const acceptance = json(acceptanceBytes, "acceptance");
const closure = json(closureBytes, "closure");
const state = stateBytes.toString("utf8");
const gates = gatesBytes.toString("utf8");
const task = taskBytes.toString("utf8");
const start = startBytes.toString("utf8");
const activation = activationBytes.toString("utf8");
const control = controlBytes.toString("utf8");
const controlTest = controlTestBytes.toString("utf8");

assert(hash(proposalBytes) === EXPECTED.proposal, "proposal_hash");
assert(hash(max1Bytes) === EXPECTED.max1, "max1_hash");
assert(hash(max2Bytes) === EXPECTED.max2, "max2_hash");
assert(hash(authorityBytes) === EXPECTED.authority, "authority_hash");
assert(hash(closureBytes) === EXPECTED.closure, "closure_hash");
assert(hash(publicationBytes) === "sha256:0191b33d692775f0877ac07cc126c6476d51cafaf37d8b8dac26f7da629e216e", "publication_hash");

assert(proposal.schema_version === "videoforge.v2-07-attempt23-output-contract-diagnostic-combined-live-proposal/v1", "proposal_schema");
assert(proposal.checkpoint === "V2-07" && proposal.task_id === "VF-10-07" && proposal.attempt === 23, "proposal_scope");
assert(proposal.authority_mode === "PENDING_FRESH_EXACT_APPROVAL_AND_NUMERIC_CAP", "proposal_authority_mode");
assert(proposal.user_approval?.maximum_cumulative_finite_spend_usd === null, "proposal_cap_null");
assert(proposal.user_approval?.fresh_numeric_cap_required === true && proposal.user_approval?.exact_proposal_approved === false, "proposal_approval_pending");
assert(proposal.user_approval?.flashboot_true_requested === true && proposal.user_approval?.minimum_approved_availability_requested === "LOW", "proposal_flashboot_availability");

const lineage = proposal.lineage;
assert(lineage?.model === EXPECTED.model && lineage?.model_manifest_sha256 === EXPECTED.manifest, "model_lineage");
assert(lineage?.image_source_commit === EXPECTED.source && lineage?.control_source_commit === EXPECTED.control, "source_lineage");
assert(lineage?.final_image === EXPECTED.image && lineage?.image_manifest_sha256 === "sha256:bc662a182b2a874c6aeffb05f65cc3ffbdff6b5130c6a75c214618e86cf208b5", "image_lineage");
assert(lineage?.volume_id_sha256 === EXPECTED.volume && lineage?.volume_size_gb === 50 && lineage?.volume_region === "EU-RO-1", "volume_identity");
assert(lineage?.volume_mount === "/runpod-volume" && lineage?.model_root === "/runpod-volume/mage-model" && lineage?.volume_write_policy === "APPLICATION_READ_ONLY", "volume_paths_policy");
assert(lineage?.image_publication_state === "ALREADY_PUBLISHED_EXACT_DIGEST_READBACK_PASS_NO_REPUBLICATION" && lineage?.image_publication_evidence_sha256 === hash(publicationBytes), "publication_lineage");
assert(lineage?.failed_attempt_evidence_sha256 === EXPECTED.closure && lineage?.prior_proposal_sha256 === "sha256:96ead6591874229d93537af46a3159002e2fe86c93cc2905c42bbb1326ccece7", "prior_attempt_lineage");
assert(lineage?.prior_authority_sha256 === "sha256:fecdfa6dee640d483a1787a726723bef08cdeaf455f5b7df0a2fbcdf3c3699f6" && lineage?.prior_authority_state === "CLOSED_EXACT_ATTEMPT_CONSUMED_DO_NOT_REUSE", "prior_authority_closed");

assert(exactArray(proposal.diagnostic_readback_policy?.mismatch_categories, EXPECTED.categories), "readback_categories");
assert(proposal.diagnostic_readback_policy?.evidence_field === "error_category" && proposal.diagnostic_readback_policy?.provider_response_values_retained === false && proposal.diagnostic_readback_policy?.provider_response_body_retained === false, "readback_safe");
assert(proposal.diagnostic_readback_policy?.mismatch_stops_before_dispatch === true && proposal.diagnostic_readback_policy?.readback_pass_continues_full_qualification === true, "readback_boundary");

const outputPolicy = proposal.output_contract_diagnostic_policy;
assert(outputPolicy?.first_completed_job_non_success === "persist_bounded_diagnostics_and_stop", "output_first_failure_policy");
assert(outputPolicy?.diagnostic_category === "output_contract" && exactArray(outputPolicy?.allowed_evidence_fields, EXPECTED.outputFields), "output_fields");
assert(outputPolicy?.provider_body_retained === false && outputPolicy?.raw_output_retained === false && outputPolicy?.unsafe_output_fields_retained === false, "output_redaction");
assert(outputPolicy?.stop_after_first_completed_job_non_success === true && outputPolicy?.retry_on_non_success === false && outputPolicy?.duplicate_dispatch_on_non_success === false, "output_no_retry");
assert(outputPolicy?.no_warm_batch_or_reader_after_non_success === true && outputPolicy?.durable_output_and_v3_receipt_required_for_success === true, "output_stop_scope");
assert(exactArray(outputPolicy?.output_shape_kind_allowlist, ["missing", "null", "array", "string", "number", "boolean", "object"]), "output_shape_kind_allowlist");
assert(exactArray(outputPolicy?.output_shape_keys_allowlist, ["status", "items", "failure_code", "error", "provenance_receipt"]), "output_shape_keys_allowlist");

for (const [index, [config, bytes, expectedHash]] of [[max1, max1Bytes, EXPECTED.max1], [max2, max2Bytes, EXPECTED.max2]].entries()) {
  assert(config.schema_version === "videoforge.v2-07-staged-endpoint-definition/v6", `config_${index}_schema`);
  assert(config.image === EXPECTED.image && config.image_source_commit === EXPECTED.source && config.control_source_commit === EXPECTED.control, `config_${index}_lineage`);
  assert(config.region === "EU-RO-1" && config.network_volume_id_sha256 === EXPECTED.volume && config.network_volume_size_gb === 50 && config.network_volume_region === "EU-RO-1", `config_${index}_volume`);
  assert(config.network_volume_mount === "/runpod-volume" && config.model_root === "/runpod-volume/mage-model" && config.volume_write_policy === "APPLICATION_READ_ONLY", `config_${index}_paths`);
  assert(exactArray(config.gpu_type_ids, [EXPECTED.gpu]) && (config.gpu_count ?? config.gpu_count_per_worker) === 1 && config.compute_type === "GPU" && config.flex_only === true, `config_${index}_gpu`);
  assert(config.workers_min === 0 && config.workers_max === index + 1 && config.scaler_type === "REQUEST_COUNT" && config.scaler_value === 1 && config.handler_concurrency === 1, `config_${index}_workers`);
  assert(config.flashboot === true && config.cuda_minimum === "13.0" && exactArray(config.cuda_allowed, ["13.0"]), `config_${index}_runtime`);
  assert(config.endpoint_identity_binding?.get_mismatch_category_persisted_redaction_safe === true && config.endpoint_identity_binding?.get_mismatch_category_stops_before_dispatch === true, `config_${index}_identity`);
  assert(config.output_contract_diagnostic?.retry_on_non_success === false && config.output_contract_diagnostic?.stop_before_next_batch_or_reader === true, `config_${index}_output_policy`);
  assert(hash(bytes) === expectedHash, `config_${index}_bytes`);
  const stage = proposal.staged_endpoint_configs?.[index];
  assert(stage?.definition_sha256 === expectedHash && stage?.workers_min === 0 && stage?.workers_max === index + 1 && stage?.flashboot === true, `proposal_stage_${index}`);
}

const operations = proposal.proposed_operations_in_order;
assert(Array.isArray(operations) && operations.includes("submit_two_simultaneous_read_only_complete_batches") && operations.includes("restore_flashboot_true_workers_max_one_and_wait_for_independent_workers_zero"), "operations_scope");
assert(operations.includes("if_completed_job_non_success_persist_only_bounded_output_category_status_failure_code_and_shape_facts_then_stop_without_retry"), "output_diagnostic_operation");
assert(proposal.cleanup_rollback_and_stop_conditions?.completed_job_non_success.includes("no retry") && proposal.cleanup_rollback_and_stop_conditions?.completed_job_non_success.includes("output_shape_keys"), "cleanup_output_policy");
assert(proposal.forbidden?.includes("V2-08 or successor work") && proposal.forbidden?.includes("model download preparation quantization or volume mutation"), "forbidden_scope");

const truth = proposal.last_observed_provider_truth;
assert(truth?.source_evidence_sha256 === EXPECTED.closure && truth?.pods === 0 && truth?.endpoints === 0 && truth?.private_templates === 0 && truth?.active_serverless_workers === 0 && truth?.running_pods === 0 && truth?.intended_volume_count === 2, "provider_zero_truth");
assert(truth?.provider_mutations_for_this_proposal === 0 && truth?.external_spend_for_this_proposal_usd === 0 && truth?.rtx4090_eu_ro_1_availability === "LOW", "provider_boundary");
assert(proposal.rates_cost_and_retention?.maximum_cumulative_finite_spend_usd === null && proposal.rates_cost_and_retention?.numeric_cap_must_be_supplied_by_user === true && proposal.rates_cost_and_retention?.existing_two_volume_charge_usd_per_month_total === 7, "rate_cap_retention");

assert(closure.attempt === 22 && closure.authority_status === "CLOSED_EXACT_ATTEMPT_CONSUMED_DO_NOT_REUSE" && closure.failure?.provider_job_status === "COMPLETED" && closure.failure?.accepted_batch_count === 0, "closure_boundary");
assert(closure.runpod_cleanup?.final_disposable_resources_absent === true && closure.runpod_cleanup?.network_volumes === 2 && closure.billing?.attempt_increment_usd_settled === 0, "closure_cleanup_cost");

assert(authority.schema_version === "videoforge.v2-07-attempt23-output-contract-diagnostic-authority/v1", "authority_schema");
assert(authority.checkpoint === "V2-07" && authority.task_id === "VF-10-07" && authority.attempt === 23, "authority_scope");
assert(authority.authority_mode === "bounded_mutation" && authority.status === "APPROVED_PREEXECUTION_PROVIDER_EXECUTION_PENDING", "authority_status");
assert(authority.proposal?.path === "combined-live-proposal.json" && authority.proposal?.sha256 === EXPECTED.proposal, "authority_proposal");
assert(authority.approval?.exact_proposal_approved === true && authority.approval?.flashboot_true_accepted === true && authority.approval?.low_eu_ro_1_availability_approved === true, "authority_approval_flags");
assert(authority.approval?.maximum_cumulative_finite_spend_usd === 4 && authority.approval?.fresh_numeric_cap === true && authority.approval?.historical_cap_reused === false && authority.approval?.prior_authority_reused === false, "authority_cap");
assert(authority.lineage?.model === proposal.lineage?.model && authority.lineage?.model_manifest_sha256 === proposal.lineage?.model_manifest_sha256, "authority_model_lineage");
assert(authority.lineage?.image_source_commit === EXPECTED.source && authority.lineage?.control_source_commit === EXPECTED.control && authority.lineage?.final_image === EXPECTED.image, "authority_image_lineage");
assert(authority.lineage?.volume_id_sha256 === EXPECTED.volume && authority.lineage?.volume_size_gb === 50 && authority.lineage?.volume_region === "EU-RO-1" && authority.lineage?.volume_mount === "/runpod-volume" && authority.lineage?.model_root === "/runpod-volume/mage-model", "authority_volume_lineage");
assert(authority.lineage?.initial_config_sha256 === EXPECTED.max1 && authority.lineage?.concurrent_reader_config_sha256 === EXPECTED.max2, "authority_config_lineage");
assert(authority.lineage?.failed_attempt_evidence_sha256 === EXPECTED.closure && authority.lineage?.prior_proposal_sha256 === proposal.lineage?.prior_proposal_sha256 && authority.lineage?.prior_authority_sha256 === proposal.lineage?.prior_authority_sha256, "authority_prior_lineage");
assert(authority.output_contract_diagnostic_policy?.diagnostic_category === "output_contract" && authority.output_contract_diagnostic_policy?.provider_body_retained === false && authority.output_contract_diagnostic_policy?.raw_output_retained === false && authority.output_contract_diagnostic_policy?.retry_on_non_success === false, "authority_output_policy");
assert(authority.execution_boundary?.provider_calls_completed === false && authority.execution_boundary?.external_spend_usd === 0 && authority.execution_boundary?.maximum_cumulative_finite_spend_usd === 4 && authority.execution_boundary?.v2_08_authorized === false, "authority_boundary");

assert(acceptance.candidate?.proposal_sha256 === EXPECTED.proposal && acceptance.candidate?.max1_sha256 === EXPECTED.max1 && acceptance.candidate?.max2_sha256 === EXPECTED.max2, "acceptance_hashes");
assert(acceptance.candidate?.authority_path === null && acceptance.candidate?.maximum_cumulative_finite_spend_usd === null && acceptance.candidate?.provider_calls_authorized === false && acceptance.candidate?.gpu_use_authorized === false, "candidate_handoff_snapshot");
assert(acceptance.prior_attempt22_closure?.sha256 === EXPECTED.closure && acceptance.output_contract_diagnostic?.retry_on_failure === false && acceptance.output_contract_diagnostic?.stop_immediately === true, "acceptance_output_policy");

const candidateNames = await readdir(candidate);
assert(candidateNames.includes("approved-authority.json"), "authority_record_present");
assert(
  (state.includes("phase: serverless_v2_v2_07_attempt23_authorized") && state.includes("provider_calls_authorized: true") && state.includes("maximum_external_spend_usd: 4")) ||
    (state.includes("phase: serverless_v2_v2_07_attempt23_closed") && state.includes("provider_calls_authorized: false") && state.includes("maximum_external_spend_usd: 0")),
  "state_authorized",
);
assert(state.includes("2026-08-21-attempt23-output-contract-diagnostic-candidate/combined-live-proposal.json") && state.includes(EXPECTED.proposal) && state.includes(EXPECTED.control), "state_candidate_pointer");
assert(
  (state.includes("current_authority: evidence/acceptance/VF-10-07/2026-08-21-attempt23-output-contract-diagnostic-candidate/approved-authority.json") && state.includes("mutation_authorized: true") && state.includes("gpu_use_authorized: true") && state.includes("spend_authorized_usd: 4")) ||
    (state.includes("current_authority: null") && state.includes("mutation_authorized: false") && state.includes("gpu_use_authorized: false") && state.includes("spend_authorized_usd: 0")),
  "state_authority",
);
assert(
  ((gates.includes("pending_proposal: \"evidence/acceptance/VF-10-07/2026-08-21-attempt23-output-contract-diagnostic-candidate/combined-live-proposal.json\"") || gates.includes("latest_closed_proposal: \"evidence/acceptance/VF-10-07/2026-08-21-attempt23-output-contract-diagnostic-candidate/combined-live-proposal.json\"")) && gates.includes(EXPECTED.proposal) && gates.includes(EXPECTED.control)),
  "gate_candidate_pointer",
);
assert(
  (gates.includes("pending_authority: \"evidence/acceptance/VF-10-07/2026-08-21-attempt23-output-contract-diagnostic-candidate/approved-authority.json\"") && gates.includes("pending_numeric_cap_usd: 4") && gates.includes("attempt23_bounded_mutation_authorized")) ||
    (gates.includes("closed_authority: \"evidence/acceptance/VF-10-07/2026-08-21-attempt23-output-contract-diagnostic-candidate/approved-authority.json\"") && gates.includes("pending_numeric_cap_usd: null") && gates.includes("none_attempt23_consumed")),
  "gate_authority",
);
assert(task.includes("Attempt23 output-contract diagnostic authority") && task.includes(EXPECTED.proposal) && task.includes(EXPECTED.control) && task.includes(EXPECTED.authority), "task_authority_pointer");
assert(start.includes("Attempt 23 candidate path") && start.includes(EXPECTED.proposal) && start.includes(EXPECTED.control), "start_candidate_pointer");
assert(activation.includes("V207_APPROVED_FINITE_CAP_USD: number | null = 4") || activation.includes("V207_APPROVED_FINITE_CAP_USD: number | null = null"), "activation_cap_approved");
assert(control.includes("V207OutputContractError") && control.includes("extractV207OutputContractDiagnostics") && control.includes('"output_contract"'), "control_output_diagnostic");
assert(controlTest.includes("persists bounded output-contract diagnostics") && controlTest.includes("fails closed and redacts unsafe output-contract fields"), "control_output_tests");

assert(!proposal.lineage.final_image.includes("6318edbc"), "negative_old_image");
assert(proposal.user_approval.maximum_cumulative_finite_spend_usd === null, "negative_cap_mutation");

process.stdout.write(`V2-07 Attempt23 output-contract authority validation PASS (${EXPECTED.proposal}; authority ${EXPECTED.authority}; control ${EXPECTED.control}; fresh USD 4 cap/no-retry invariants PASS)\n`);

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const candidate = resolve(
  root,
  "project-context/evidence/acceptance/VF-10-07/2026-08-21-attempt21-diagnostic-readback-candidate",
);
const paths = {
  proposal: resolve(candidate, "combined-live-proposal.json"),
  max1: resolve(candidate, "staged-config-max1.json"),
  max2: resolve(candidate, "staged-config-max2.json"),
  authority: resolve(candidate, "approved-authority.json"),
  attempt20: resolve(
    root,
    "project-context/evidence/acceptance/VF-10-07/2026-08-20-live-qualification/failed-attempt-20.json",
  ),
  publication: resolve(
    root,
    "project-context/evidence/acceptance/VF-10-07/2026-08-20-diagnostic-endpoint-bound-candidate/image-publication.json",
  ),
  state: resolve(root, "project-context/CURRENT_STATE.yaml"),
  gates: resolve(root, "project-context/GATES.yaml"),
  task: resolve(root, "project-context/tasks/VF-10-07.md"),
  start: resolve(root, "project-context/00_START_HERE.md"),
  activation: resolve(root, "apps/web/src/server/providers/v207-activation-authority.ts"),
  control: resolve(root, "apps/web/src/server/providers/runpod-control.ts"),
  controlTest: resolve(root, "apps/web/src/server/providers/runpod-control.test.ts"),
  qualification: resolve(root, "apps/web/src/server/providers/v207-live-qualification.ts"),
  qualificationTest: resolve(root, "apps/web/src/server/providers/v207-live-qualification.test.ts"),
};

const EXPECTED = {
  proposal: "sha256:13acabaed3c21b3a15fcca203072c211f9002057453d4cd9b0fb5a765444d2d4",
  authority: "sha256:bc7580ad3f4782504587904115abb76738da72e3f2a048314a959475ef7316ec",
  control: "8d62be71b9b10585ea99d0583a4a4267ed9a5a79",
  source: "79f123268b6ade640c02dd20616a89d16b43a5e6",
  image:
    "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:bc662a182b2a874c6aeffb05f65cc3ffbdff6b5130c6a75c214618e86cf208b5",
  manifest: "sha256:bc662a182b2a874c6aeffb05f65cc3ffbdff6b5130c6a75c214618e86cf208b5",
  config: "sha256:8e11a42cb91fa1d0d6a4e19fc6b4a6cfd5f77116c49a8516b6435813dfaab1de",
  layer: "sha256:befafc2ec3d32a73b632f769069c9c02645d3fac049ebd2478fbf8ad3d5cdf38",
  parent:
    "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:8a5b8f453c694b2eeee097e3d958b08c5e47c15290b5cdc17a4fb7e5e3e4f497",
  parentConfig: "sha256:de5c854ae5aa9e611e218b89d29a250eb03a0a316f0ac92d584d53a038d06ff2",
  volume: "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619",
  modelManifest: "sha256:cebcd5c6233c2eae32f26ced7510acef8192f0d92d7ec3e9dd3ee881d66d205b",
  attempt20: "sha256:82aae2abf02041620c18d6a016719bab0f92ef41ed77430c2239ebfab005a37d",
  priorProposal: "sha256:9e9675dcf6943dce35b4bf6155fdfc39f8dade5e9775bcc3ee9a427980d39e02",
  priorAuthority: "sha256:ac8f45bdb3d5429fa3b93e9624f62242f026ced07f19f28d740503dccfd8f56d",
  configs: [
    "sha256:39de7cd6c3905c5482bd5eb2b47a8af5d683286bf8f4b4df5df0ddb0cb3ddfcd",
    "sha256:7dd4b98be49c06095af3cf04ae01d96860a803ec3fe9811531cc397f9214884e",
  ],
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
  gpu: "NVIDIA GeForce RTX 4090",
};

const hash = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const fail = (label) => {
  throw new Error(`V207_ATTEMPT21_PROPOSAL_INVALID:${label}`);
};
const assert = (condition, label) => {
  if (!condition) fail(label);
};
const text = (bytes) => bytes.toString("utf8");
const json = (bytes, label) => {
  try {
    return JSON.parse(text(bytes));
  } catch {
    fail(`${label}_json`);
  }
};
const exactArray = (left, right) => JSON.stringify(left) === JSON.stringify(right);

const [proposalBytes, max1Bytes, max2Bytes, authorityBytes, attempt20Bytes, publicationBytes, stateBytes, gateBytes, taskBytes, startBytes, activationBytes, controlBytes, controlTestBytes, qualificationBytes, qualificationTestBytes] =
  await Promise.all([
    readFile(paths.proposal),
    readFile(paths.max1),
    readFile(paths.max2),
    readFile(paths.authority),
    readFile(paths.attempt20),
    readFile(paths.publication),
    readFile(paths.state),
    readFile(paths.gates),
    readFile(paths.task),
    readFile(paths.start),
    readFile(paths.activation),
    readFile(paths.control),
    readFile(paths.controlTest),
    readFile(paths.qualification),
    readFile(paths.qualificationTest),
  ]);
const proposal = json(proposalBytes, "proposal");
const max1 = json(max1Bytes, "max1");
const max2 = json(max2Bytes, "max2");
const authority = json(authorityBytes, "authority");
const attempt20 = json(attempt20Bytes, "attempt20");
const publication = json(publicationBytes, "publication");
const state = text(stateBytes);
const gates = text(gateBytes);
const task = text(taskBytes);
const start = text(startBytes);
const activation = text(activationBytes);
const control = text(controlBytes);
const controlTest = text(controlTestBytes);
const qualification = text(qualificationBytes);
const qualificationTest = text(qualificationTestBytes);

assert(hash(proposalBytes) === EXPECTED.proposal, "proposal_hash");
assert(hash(max1Bytes) === EXPECTED.configs[0], "max1_hash");
assert(hash(max2Bytes) === EXPECTED.configs[1], "max2_hash");
assert(hash(authorityBytes) === EXPECTED.authority, "authority_hash");
assert(hash(attempt20Bytes) === EXPECTED.attempt20, "attempt20_hash");
assert(hash(publicationBytes) === "sha256:0191b33d692775f0877ac07cc126c6476d51cafaf37d8b8dac26f7da629e216e", "publication_hash");

assert(proposal.schema_version === "videoforge.v2-07-attempt21-diagnostic-readback-combined-live-proposal/v1", "schema");
assert(proposal.checkpoint === "V2-07" && proposal.task_id === "VF-10-07" && proposal.attempt === 21, "scope");
assert(proposal.authority_mode === "PENDING_FRESH_EXACT_APPROVAL_AND_NUMERIC_CAP", "authority_mode");
assert(proposal.user_approval?.maximum_cumulative_finite_spend_usd === null, "proposal_cap_null");
assert(proposal.user_approval?.fresh_numeric_cap_required === true, "fresh_cap_required");
assert(proposal.user_approval?.exact_proposal_approved === false, "approval_pending");

const lineage = proposal.lineage;
assert(lineage?.model === "Comfy-Org/Mage-Flow@d8c99241f6fa80fbd453014234af2bf337ea21e6#int8-convrot", "model");
assert(lineage?.model_manifest_sha256 === EXPECTED.modelManifest, "model_manifest");
assert(lineage?.image_source_commit === EXPECTED.source && lineage?.control_source_commit === EXPECTED.control, "source_lineage");
assert(lineage?.final_image === EXPECTED.image && lineage?.image_manifest_sha256 === EXPECTED.manifest, "image");
assert(lineage?.image_config_sha256 === EXPECTED.config && lineage?.image_layer_sha256 === EXPECTED.layer, "image_layers");
assert(lineage?.image_parent === EXPECTED.parent && lineage?.image_parent_config_sha256 === EXPECTED.parentConfig, "image_parent");
assert(lineage?.volume_id_sha256 === EXPECTED.volume && lineage?.volume_size_gb === 50, "volume_identity");
assert(lineage?.volume_region === "EU-RO-1" && lineage?.volume_mount === "/runpod-volume" && lineage?.model_root === "/runpod-volume/mage-model", "volume_paths");
assert(lineage?.volume_write_policy === "APPLICATION_READ_ONLY", "volume_read_only");
assert(lineage?.image_publication_state === "ALREADY_PUBLISHED_EXACT_DIGEST_READBACK_PASS_NO_REPUBLICATION", "publication_state");
assert(lineage?.image_publication_evidence_sha256 === hash(publicationBytes), "publication_lineage");
assert(lineage?.failed_attempt_evidence_sha256 === hash(attempt20Bytes), "attempt_lineage");
assert(lineage?.prior_proposal_sha256 === EXPECTED.priorProposal && lineage?.prior_authority_sha256 === EXPECTED.priorAuthority, "prior_lineage");
assert(lineage?.prior_authority_state === "CLOSED_EXACT_ATTEMPT_CONSUMED_DO_NOT_REUSE", "prior_closed");

assert(exactArray(proposal.diagnostic_readback_policy?.mismatch_categories, EXPECTED.categories), "categories");
assert(proposal.diagnostic_readback_policy?.evidence_field === "error_category", "category_field");
assert(proposal.diagnostic_readback_policy?.provider_response_values_retained === false, "provider_values_not_retained");
assert(proposal.diagnostic_readback_policy?.provider_response_body_retained === false, "provider_body_not_retained");
assert(proposal.diagnostic_readback_policy?.mismatch_stops_before_dispatch === true, "mismatch_stop");
assert(proposal.diagnostic_readback_policy?.readback_pass_continues_full_qualification === true, "readback_continue");

assert(authority.schema_version === "videoforge.v2-07-attempt21-diagnostic-readback-authority/v1", "authority_schema");
assert(authority.checkpoint === "V2-07" && authority.task_id === "VF-10-07" && authority.attempt === 21, "authority_scope");
assert(authority.authority_mode === "bounded_mutation", "authority_mode_record");
assert(authority.proposal?.sha256 === EXPECTED.proposal && authority.approval?.exact_proposal_approved === true, "authority_proposal");
assert(authority.approval?.flashboot_true_accepted === true && authority.approval?.minimum_approved_availability === "LOW", "authority_availability");
assert(authority.approval?.maximum_cumulative_finite_spend_usd === 4 && authority.approval?.fresh_numeric_cap === true, "authority_cap");
assert(authority.lineage?.control_source_commit === EXPECTED.control, "authority_control");
assert(authority.lineage?.final_image === EXPECTED.image && authority.lineage?.image_manifest_sha256 === EXPECTED.manifest, "authority_image");
assert(authority.lineage?.image_config_sha256 === EXPECTED.config && authority.lineage?.image_layer_sha256 === EXPECTED.layer, "authority_image_layers");
assert(authority.lineage?.volume_id_sha256 === EXPECTED.volume && authority.lineage?.volume_size_gb === 50 && authority.lineage?.volume_region === "EU-RO-1", "authority_volume");
assert(authority.lineage?.volume_mount === "/runpod-volume" && authority.lineage?.model_root === "/runpod-volume/mage-model", "authority_mount");
assert(authority.lineage?.initial_config_sha256 === EXPECTED.configs[0] && authority.lineage?.concurrent_reader_config_sha256 === EXPECTED.configs[1], "authority_configs");
assert(authority.retention?.retain_both_volumes_all_outcomes === true && authority.retention?.volume_mutation_authorized === false, "authority_retention");
assert(Array.isArray(authority.authorized_operations) && JSON.stringify(authority.authorized_operations) === JSON.stringify(authority.allowed_operations), "authority_operations");
assert(authority.execution_boundary?.provider_calls_only_after_authority_commit === true && authority.execution_boundary?.maximum_cumulative_finite_spend_usd === 4, "authority_boundary");
assert(authority.forbidden?.includes("V2-08 or successor work"), "authority_v208_forbidden");

for (const [index, [config, bytes]] of [[max1, max1Bytes], [max2, max2Bytes]].entries()) {
  assert(config.schema_version === "videoforge.v2-07-staged-endpoint-definition/v6", `config_${index}_schema`);
  assert(config.control_source_commit === EXPECTED.control && config.image_source_commit === EXPECTED.source, `config_${index}_source`);
  assert(config.image === EXPECTED.image && config.region === "EU-RO-1", `config_${index}_image_region`);
  assert(config.network_volume_id_sha256 === EXPECTED.volume && config.network_volume_mount === "/runpod-volume", `config_${index}_volume`);
  assert(config.model_root === "/runpod-volume/mage-model" && config.network_volume_size_gb === 50, `config_${index}_mount`);
  assert(config.volume_write_policy === "APPLICATION_READ_ONLY", `config_${index}_read_only`);
  assert(exactArray(config.gpu_type_ids, [EXPECTED.gpu]) && (config.gpu_count ?? config.gpu_count_per_worker) === 1, `config_${index}_gpu`);
  assert(config.compute_type === "GPU" && config.flex_only === true && config.flashboot === true, `config_${index}_compute`);
  assert(config.workers_min === 0 && config.workers_max === index + 1 && config.handler_concurrency === 1, `config_${index}_workers`);
  assert(config.scaler_type === "REQUEST_COUNT" && config.scaler_value === 1, `config_${index}_scaler`);
  assert(config.idle_timeout_seconds === 5 && config.init_timeout_seconds === 800 && config.execution_timeout_seconds === 2400, `config_${index}_timeouts`);
  assert(config.request_authority_ttl_seconds === 7200 && config.container_disk_gb === 120, `config_${index}_ttl_disk`);
  assert(config.cuda_minimum === "13.0" && exactArray(config.cuda_allowed, ["13.0"]), `config_${index}_cuda`);
  assert(config.offline_environment?.HF_HUB_OFFLINE === "1" && config.offline_environment?.TRANSFORMERS_OFFLINE === "1" && config.offline_environment?.DIFFUSERS_OFFLINE === "1", `config_${index}_offline`);
  assert(config.endpoint_identity_binding?.get_mismatch_category_persisted_redaction_safe === true, `config_${index}_category_persist`);
  assert(config.endpoint_identity_binding?.get_mismatch_category_stops_before_dispatch === true, `config_${index}_category_stop`);
  assert(hash(bytes) === EXPECTED.configs[index], `config_${index}_bytes`);
  const proposalStage = proposal.staged_endpoint_configs?.[index];
  assert(proposalStage?.definition_sha256 === EXPECTED.configs[index], `proposal_config_${index}_hash`);
  assert(proposalStage?.workers_min === 0 && proposalStage?.workers_max === index + 1 && proposalStage?.flashboot === true, `proposal_config_${index}_identity`);
}

const expectedOperations = [
  "get_endpoint_and_require_exact_effective_environment_mandatory_primary_volume_and_all_returned_config_with_safe_mismatch_category_before_dispatch",
  "if_get_mismatch_persist_bounded_error_category_only_and_stop_before_any_job_dispatch_then_cleanup",
  "if_get_passes_submit_one_owned_diagnostic_sample_then_one_complete_32_image_batch_cold",
];
for (const operation of expectedOperations) assert(proposal.proposed_operations_in_order?.includes(operation), `operation_${operation}`);
assert(proposal.proposed_operations_in_order?.includes("submit_two_simultaneous_read_only_complete_batches"), "two_readers");
assert(proposal.proposed_operations_in_order?.includes("restore_flashboot_true_workers_max_one_and_wait_for_independent_workers_zero"), "drain");

const providerTruth = proposal.last_observed_provider_truth;
assert(providerTruth?.source_evidence_sha256 === EXPECTED.attempt20 && providerTruth?.observed_at === "2026-08-21T06:48:05.671Z", "provider_truth_basis");
assert(providerTruth?.pods === 0 && providerTruth?.endpoints === 0 && providerTruth?.private_templates === 0, "provider_zero_resources");
assert(providerTruth?.active_serverless_workers === 0 && providerTruth?.running_pods === 0 && providerTruth?.intended_volume_count === 2, "provider_zero_compute");
assert(providerTruth?.rtx4090_eu_ro_1_availability === "LOW" && providerTruth?.provider_mutations_for_this_proposal === 0 && providerTruth?.external_spend_for_this_proposal_usd === 0, "provider_boundary");
const rates = proposal.rates_cost_and_retention;
assert(rates?.serverless_flex_rtx4090_usd_per_gpu_hour === 1.1 && rates?.last_authenticated_eu_ro_1_secure_pod_reference_usd_per_hour === 0.74, "rates");
assert(rates?.existing_two_volume_charge_usd_per_month_total === 7 && rates?.retained_volume_charge_is_existing_and_outside_finite_cap === true, "retention");
assert(rates?.estimated_incremental_finite_compute_spend_usd_low === 0.9 && rates?.estimated_incremental_finite_compute_spend_usd_high === 1.65, "estimate_increment");
assert(rates?.estimated_checkpoint_cumulative_spend_usd_low === 1.0248003321234138 && rates?.estimated_checkpoint_cumulative_spend_usd_high === 1.7748003321234138, "estimate_cumulative");
assert(rates?.maximum_cumulative_finite_spend_usd === null && rates?.numeric_cap_must_be_supplied_by_user === true, "proposal_rate_cap_null");

assert(attempt20.attempt === 20 && attempt20.authority_status === "CLOSED_EXACT_ATTEMPT_CONSUMED_DO_NOT_REUSE", "attempt20_closed");
assert(attempt20.authority_proposal_sha256 === EXPECTED.priorProposal && attempt20.approved_authority?.sha256 === EXPECTED.priorAuthority, "attempt20_prior_authority");
assert(attempt20.failure?.code === "RUNPOD_ENDPOINT_ID_BINDING_READBACK_UNCONFIRMED" && attempt20.failure?.job_dispatch_reached === false && attempt20.failure?.gpu_jobs_submitted === 0, "attempt20_no_dispatch");
assert(attempt20.runpod_cleanup?.final_disposable_resources_absent === true && attempt20.runpod_cleanup?.network_volumes === 2, "attempt20_cleanup");
assert(attempt20.billing?.attempt_increment_usd_settled === 0 && attempt20.billing?.settlement_state === "STABLE_THREE_READS", "attempt20_spend");
assert(attempt20.cloudflare_cleanup?.worker_version_restored === true && attempt20.cloudflare_cleanup?.signer_secret_deleted === true, "attempt20_cloudflare_cleanup");

assert(control.includes("RunPodV207EndpointReadbackMismatchCategory"), "control_category_type");
assert(control.includes("classifyRunPodV207EndpointReadbackMismatch"), "control_classifier");
assert(controlTest.includes('"missing template environment"') && controlTest.includes('"malformed template environment"') && controlTest.includes('"empty CUDA list"'), "control_negative_categories");
assert(qualification.includes("extractV207EndpointReadbackMismatchCategory"), "qualification_category_extractor");
assert(qualification.includes("evidence.error_category = errorCategory"), "qualification_category_persist");
assert(qualificationTest.includes("error_category"), "qualification_category_tests");

assert(activation.includes("V207_APPROVED_FINITE_CAP_USD"), "activation_cap_closed");
assert(activation.includes("V207_FRESH_AUTHORITY_REQUIRED"), "activation_requires_fresh");
assert(proposal.forbidden?.includes("V2-08 or successor work"), "v208_forbidden");
assert(proposal.forbidden?.includes("model download preparation quantization or volume mutation"), "volume_forbidden");

for (const [label, value] of [["state", state], ["task", task], ["start", start]]) {
  assert(value.includes(EXPECTED.proposal), `${label}_proposal_pointer`);
  assert(value.includes("8d62be7"), `${label}_control_pointer`);
  assert(value.includes("failed-attempt-20.json"), `${label}_attempt20_pointer`);
}
assert(gates.includes(EXPECTED.authority) && gates.includes("failed-attempt-21.json"), "gates_proposal_pointer");
assert(
  state.includes("historical_v2_07_attempt21_authority:") &&
    state.includes("v2_07_attempt21_closed_authority_sha256:") &&
    state.includes("v2_07_attempt21_closure_sha256:"),
  "state_closed",
);
assert(state.includes("approved-authority.json") && state.includes("bc7580ad3f4782504587904115abb76738da72e3f2a048314a959475ef7316ec"), "state_authority");
assert(gates.includes("closure_evidence: \"evidence/acceptance/VF-10-07/2026-08-20-live-qualification/failed-attempt-21.json\"") && gates.includes("bc7580ad3f4782504587904115abb76738da72e3f2a048314a959475ef7316ec"), "gate_closed");
assert(task.includes("Fresh Attempt21 diagnostic authority") && task.includes("bc7580ad3f4782504587904115abb76738da72e3f2a048314a959475ef7316ec"), "task_authority");
assert(start.includes("bc7580ad3f4782504587904115abb76738da72e3f2a048314a959475ef7316ec"), "start_authority");
assert(
  gates.includes("AUTHORIZED_attempt22_") && task.includes("NOT_QUALIFIED") && start.includes("NOT_QUALIFIED"),
  "gate_open",
);

assert(!/^sha256:[0-9a-f]{64}0$/u.test(EXPECTED.attempt20), "negative_digest_length");
assert(proposal.user_approval.maximum_cumulative_finite_spend_usd === null, "negative_cap_mutation");
assert(proposal.lineage.final_image !== "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:6318edbc73b59d1a495566a765515831b3ff28302a4dc33c5e09ba52352215e3", "negative_old_image");

process.stdout.write(
  `V2-07 Attempt21 diagnostic proposal validation PASS (${EXPECTED.proposal}; control ${EXPECTED.control}; ten mismatch categories; negative invariants PASS)\n`,
);

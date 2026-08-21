import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const candidate = resolve(root, "project-context/evidence/acceptance/VF-10-07/2026-08-21-attempt26-finalize-transport-repair-candidate");
const paths = {
  proposal: resolve(candidate, "combined-live-proposal.json"),
  authority: resolve(candidate, "approved-authority.json"),
  max1: resolve(candidate, "staged-config-max1.json"),
  max2: resolve(candidate, "staged-config-max2.json"),
  closure: resolve(root, "project-context/evidence/acceptance/VF-10-07/2026-08-21-live-qualification/failed-attempt-25.json"),
  state: resolve(root, "project-context/CURRENT_STATE.yaml"),
  gates: resolve(root, "project-context/GATES.yaml"),
  task: resolve(root, "project-context/tasks/VF-10-07.md"),
  start: resolve(root, "project-context/00_START_HERE.md"),
  activation: resolve(root, "apps/web/src/server/providers/v207-activation-authority.ts"),
};
const EXPECTED = {
  proposal: "sha256:0112b0b72254ef286643fc63bee0176fce327edc401ce40de4a3a860a5e68632",
  authority: "sha256:b5b559ea7f59bf60943d5e9d88a5516e15ac93437341d990aefc261a63c5474e",
  max1: "sha256:b64d008bac42fb13ec342028675a1bb498836981c553e884529ad846d6cdf964",
  max2: "sha256:10f887ba47e8a7cac952374eb236fed08cb67962171769b65d96a4f0d3a7acf7",
  closure: "sha256:4b1d8b14f24b3e38a672cbe15b772590646bf35fe4e92f7a1046f23f13e5daf2",
  repair: "b8666dd8b8bc12578ffae8925f6ce73dbf53a841",
  image: "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:bc662a182b2a874c6aeffb05f65cc3ffbdff6b5130c6a75c214618e86cf208b5",
  imageSource: "79f123268b6ade640c02dd20616a89d16b43a5e6",
  model: "Comfy-Org/Mage-Flow@d8c99241f6fa80fbd453014234af2bf337ea21e6#int8-convrot",
  manifest: "sha256:cebcd5c6233c2eae32f26ced7510acef8192f0d92d7ec3e9dd3ee881d66d205b",
  volume: "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619",
  config: "sha256:8e11a42cb91fa1d0d6a4e19fc6b4a6cfd5f77116c49a8516b6435813dfaab1de",
  layer: "sha256:befafc2ec3d32a73b632f769069c9c02645d3fac049ebd2478fbf8ad3d5cdf38",
  base: "sha256:8a5b8f453c694b2eeee097e3d958b08c5e47c15290b5cdc17a4fb7e5e3e4f497",
  parentConfig: "sha256:de5c854ae5aa9e611e218b89d29a250eb03a0a316f0ac92d584d53a038d06ff2",
};
const hash = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const fail = (label) => { throw new Error(`V207_ATTEMPT26_FINALIZE_TRANSPORT_PROPOSAL_INVALID:${label}`); };
const assert = (condition, label) => { if (!condition) fail(label); };
const parse = (bytes, label) => { try { return JSON.parse(bytes.toString("utf8")); } catch { fail(`${label}_json`); } };

const [proposalBytes, authorityBytes, max1Bytes, max2Bytes, closureBytes, stateBytes, gatesBytes, taskBytes, startBytes, activationBytes] = await Promise.all([
  readFile(paths.proposal), readFile(paths.authority), readFile(paths.max1), readFile(paths.max2), readFile(paths.closure),
  readFile(paths.state), readFile(paths.gates), readFile(paths.task), readFile(paths.start), readFile(paths.activation),
]);
for (const [label, bytes, expected] of [["proposal", proposalBytes, EXPECTED.proposal], ["authority", authorityBytes, EXPECTED.authority], ["max1", max1Bytes, EXPECTED.max1], ["max2", max2Bytes, EXPECTED.max2], ["closure", closureBytes, EXPECTED.closure]]) {
  assert(hash(bytes) === expected, `${label}_hash`);
}
const proposal = parse(proposalBytes, "proposal");
const authority = parse(authorityBytes, "authority");
const max1 = parse(max1Bytes, "max1");
const max2 = parse(max2Bytes, "max2");
const closure = parse(closureBytes, "closure");
const state = stateBytes.toString("utf8");
const gates = gatesBytes.toString("utf8");
const task = taskBytes.toString("utf8");
const start = startBytes.toString("utf8");
const activation = activationBytes.toString("utf8");

assert(proposal.schema_version === "videoforge.v2-07-attempt26-finalize-transport-repair-combined-live-proposal/v1", "proposal_schema");
assert(proposal.checkpoint === "V2-07" && proposal.task_id === "VF-10-07" && proposal.attempt === 26, "proposal_scope");
assert(proposal.authority_mode === "PENDING_FRESH_EXACT_APPROVAL_AND_NUMERIC_CAP", "authority_mode");
assert(proposal.provider_mutation === false && proposal.publication === false && proposal.gpu_use === false && proposal.spend_usd === 0, "provider_free_boundary");
assert(proposal.user_approval?.maximum_cumulative_finite_spend_usd === null && proposal.user_approval?.fresh_numeric_cap_required === true && proposal.user_approval?.exact_proposal_approved === false && proposal.user_approval?.provider_mutation_or_gpu_use_authorized === false, "null_cap");

const lineage = proposal.lineage;
assert(lineage?.model === EXPECTED.model && lineage?.model_manifest_sha256 === EXPECTED.manifest, "model_lineage");
assert(lineage?.final_image === EXPECTED.image && lineage?.image_source_commit === EXPECTED.imageSource && lineage?.control_source_commit === EXPECTED.repair && lineage?.finalize_transport_repair_commit === EXPECTED.repair, "image_control_lineage");
assert(lineage?.image_config_sha256 === EXPECTED.config && lineage?.image_layer_sha256 === EXPECTED.layer && lineage?.image_base_sha256 === EXPECTED.base && lineage?.image_parent_config_sha256 === EXPECTED.parentConfig, "image_digest_lineage");
assert(lineage?.volume_id_sha256 === EXPECTED.volume && lineage?.volume_size_gb === 50 && lineage?.volume_region === "EU-RO-1" && lineage?.volume_mount === "/runpod-volume" && lineage?.model_root === "/runpod-volume/mage-model" && lineage?.volume_write_policy === "APPLICATION_READ_ONLY", "volume_lineage");
assert(lineage?.failed_attempt_evidence === "../2026-08-21-live-qualification/failed-attempt-25.json" && lineage?.failed_attempt_evidence_sha256 === EXPECTED.closure && lineage?.prior_proposal_sha256 === "sha256:c8baa8a45b8e3e108904cac5f04f472ad22da2936dad75daa2a59d23476a8946" && lineage?.prior_authority_sha256 === "sha256:2fc6072b88ca5069eef5510e6f0699faad977102565455495f89b56b02444b7c", "attempt25_lineage");

const repair = proposal.finalize_transport_repair;
assert(repair?.commit === EXPECTED.repair && repair?.commit_resolution === "FULL" && repair?.retryable_operation_only === "FINALIZE" && repair?.max_attempts === 3 && repair?.request_timeout_seconds === 30, "repair_identity");
assert(repair?.same_reservation_callback_tuple_required === true && repair?.put_retry_forbidden === true && repair?.non_finalize_post_retry_forbidden === true && repair?.provider_body_retained === false && repair?.signed_urls_or_secrets_retained === false, "repair_safety");
assert(repair?.transport_error_code === "V207_OUTPUT_PORT_FINALIZE_TRANSPORT" && repair?.response_error_code === "V207_OUTPUT_PORT_FINALIZE_RESPONSE_INVALID", "repair_errors");

const startup = proposal.startup_terminal_inventory_policy;
assert(startup?.allowed_before_dispatch_only === true && startup?.allowed_before_any_owned_job === true && startup?.post_dispatch_or_drain_fallback_forbidden === true && startup?.no_retry_or_duplicate_compute === true, "startup_scope");
assert(startup?.health_jobs_required_for_startup_fallback?.object_present === true && startup.health_jobs_required_for_startup_fallback.in_queue_exact === 0 && startup.health_jobs_required_for_startup_fallback.in_progress_exact === 0, "startup_health_jobs");
assert(startup?.health_jobs_reads_bracketing_inventory?.job_read_signatures_match === true && startup.health_jobs_reads_bracketing_inventory?.all_reads_required === true && startup.exact_inventory_required?.includes("exactly_two_stable_inventory_snapshots"), "startup_reads");

for (const [label, config, expectedHash, expectedMax] of [["max1", max1, EXPECTED.max1, 1], ["max2", max2, EXPECTED.max2, 2]]) {
  assert(config.schema_version === "videoforge.v2-07-staged-endpoint-definition/v6", `${label}_schema`);
  assert(config.image === EXPECTED.image && config.image_source_commit === EXPECTED.imageSource && config.control_source_commit === EXPECTED.repair && config.finalize_transport_repair_commit === EXPECTED.repair, `${label}_lineage`);
  assert(config.region === "EU-RO-1" && config.network_volume_id_sha256 === EXPECTED.volume && config.network_volume_size_gb === 50 && config.network_volume_region === "EU-RO-1" && config.network_volume_mount === "/runpod-volume" && config.model_root === "/runpod-volume/mage-model" && config.volume_write_policy === "APPLICATION_READ_ONLY", `${label}_volume`);
  assert(config.gpu_type_ids?.[0] === "NVIDIA GeForce RTX 4090" && config.compute_type === "GPU" && config.flex_only === true && config.workers_min === 0 && config.workers_max === expectedMax && config.flashboot === true && config.scaler_type === "REQUEST_COUNT" && config.scaler_value === 1 && config.handler_concurrency === 1 && config.idle_timeout_seconds === 5 && config.init_timeout_seconds === 800 && config.execution_timeout_seconds === 2400, `${label}_gpu_workers`);
  assert(config.output_finalization_transport_policy?.repair_commit === EXPECTED.repair && config.output_finalization_transport_policy?.retryable_operation_only === "FINALIZE" && config.output_finalization_transport_policy?.max_attempts === 3 && config.output_finalization_transport_policy?.put_is_never_retried === true, `${label}_finalize_policy`);
  assert(config.startup_terminal_inventory_fallback?.allowed_before_dispatch_only === true && config.startup_terminal_inventory_fallback?.post_dispatch_or_drain_fallback_forbidden === true && config.startup_terminal_inventory_fallback?.no_retry_or_duplicate_compute === true, `${label}_startup_policy`);
  const stage = proposal.staged_endpoint_configs?.find((item) => item.definition_path === `staged-config-${label}.json`);
  assert(stage?.definition_sha256 === expectedHash && stage?.workers_max === expectedMax && stage?.workers_min === 0 && stage?.flashboot === true && stage?.control_source_commit === EXPECTED.repair, `${label}_proposal_binding`);
}

for (const operation of ["provider_free_validate_finalize_transport_repair_commit_b8666dd8b8bc12578ffae8925f6ce73dbf53a841_full_resolution", "retry_only_idempotent_FINALIZE_transport_loss_or_invalid_response_with_same_reservation_callback_tuple", "submit_two_simultaneous_read_only_complete_batches", "restore_flashboot_true_workers_max_one_and_wait_for_independent_workers_zero_with_health_first_quiescence", "retain_both_existing_volumes_in_all_outcomes"]) {
  assert(proposal.proposed_operations_in_order?.includes(operation), `operation_${operation}`);
}
assert(proposal.negative_tests_required?.includes("wrong image bytes") && proposal.negative_tests_required?.includes("wrong path") && proposal.negative_tests_required?.includes("wrong volume") && proposal.negative_tests_required?.includes("wrong GPU") && proposal.negative_tests_required?.includes("wrong region") && proposal.negative_tests_required?.includes("writes") && proposal.negative_tests_required?.includes("cache escape") && proposal.negative_tests_required?.includes("malformed authority") && proposal.negative_tests_required?.includes("duplicate delivery") && proposal.negative_tests_required?.includes("cancel") && proposal.negative_tests_required?.includes("timeout") && proposal.negative_tests_required?.includes("two readers"), "negative_tests");
assert(proposal.rates_cost_and_retention?.serverless_flex_rtx4090_usd_per_gpu_hour === 1.1 && proposal.rates_cost_and_retention?.existing_two_volume_charge_usd_per_month_total === 7 && proposal.rates_cost_and_retention?.estimated_cumulative_gpu_hours_ceiling === 2 && proposal.rates_cost_and_retention?.estimated_finite_serverless_compute_usd_ceiling === 2.2 && proposal.rates_cost_and_retention?.maximum_cumulative_finite_spend_usd === null && proposal.rates_cost_and_retention?.numeric_cap_must_be_supplied_by_user === true, "rates_cap");
assert(proposal.execution_boundary?.provider_calls_completed === false && proposal.execution_boundary?.external_spend_usd === 0 && proposal.execution_boundary?.maximum_cumulative_finite_spend_usd === null && proposal.execution_boundary?.v2_08_authorized === false, "execution_boundary");
assert(closure.attempt === 25 && closure.final_reconciliation_checked_at === "2026-08-21T11:30:30.619Z" && closure.qualification_boundaries?.v2_07 === "NOT_QUALIFIED", "closure_binding");

assert(authority.schema_version === "videoforge.v2-07-attempt26-finalize-transport-repair-authority/v1" && authority.checkpoint === "V2-07" && authority.task_id === "VF-10-07" && authority.attempt === 26, "authority_scope");
assert(authority.proposal?.sha256 === EXPECTED.proposal && authority.approval?.exact_proposal_approved === true && authority.approval?.flashboot_true_accepted === true && authority.approval?.low_eu_ro_1_availability_approved === true && authority.approval?.maximum_cumulative_finite_spend_usd === 4 && authority.approval?.fresh_numeric_cap === true && authority.approval?.historical_cap_reused === false, "authority_approval");
assert(authority.lineage?.final_image === EXPECTED.image && authority.lineage?.image_source_commit === EXPECTED.imageSource && authority.lineage?.control_source_commit === EXPECTED.repair && authority.lineage?.model === EXPECTED.model && authority.lineage?.model_manifest_sha256 === EXPECTED.manifest && authority.lineage?.volume_id_sha256 === EXPECTED.volume, "authority_lineage");
assert(authority.lineage?.initial_config_sha256 === EXPECTED.max1 && authority.lineage?.concurrent_reader_config_sha256 === EXPECTED.max2 && authority.lineage?.failed_attempt_evidence_sha256 === EXPECTED.closure, "authority_evidence_lineage");
assert(authority.execution_boundary?.image_republication_authorized === false && authority.execution_boundary?.runpod_mutation_authorized_pending_execution === true && authority.execution_boundary?.cloudflare_mutation_authorized_pending_execution === true && authority.execution_boundary?.gpu_use_authorized_pending_execution === true && authority.execution_boundary?.provider_calls_completed === false && authority.execution_boundary?.external_spend_usd === 0 && authority.execution_boundary?.maximum_cumulative_finite_spend_usd === 4 && authority.execution_boundary?.v2_08_authorized === false, "authority_execution_boundary");
assert(authority.status === "APPROVED_PREEXECUTION_PROVIDER_EXECUTION_PENDING" && authority.retention?.retain_both_volumes_all_outcomes === true && authority.retention?.volume_mutation_authorized === false, "authority_status_retention");

assert(state.includes("phase: serverless_v2_v2_07_attempt26_finalize_transport_repair_authorized") && state.includes("task_stage: bounded_mutation") && state.includes("provider_calls_authorized: true") && state.includes("remote_or_cloud_mutations_authorized: true") && state.includes("gpu_use_authorized: true") && state.includes("maximum_external_spend_usd: 4"), "state_boundary");
assert(state.includes("2026-08-21-attempt26-finalize-transport-repair-candidate/combined-live-proposal.json") && state.includes("2026-08-21-attempt26-finalize-transport-repair-candidate/approved-authority.json") && state.includes(EXPECTED.proposal) && state.includes(EXPECTED.authority) && state.includes(EXPECTED.repair), "state_authority_pointer");
assert(gates.includes("pending_proposal: \"evidence/acceptance/VF-10-07/2026-08-21-attempt26-finalize-transport-repair-candidate/combined-live-proposal.json\"") && gates.includes(`pending_proposal_sha256: \"${EXPECTED.proposal}\"`) && gates.includes("pending_authority: \"evidence/acceptance/VF-10-07/2026-08-21-attempt26-finalize-transport-repair-candidate/approved-authority.json\"") && gates.includes(`pending_authority_sha256: \"${EXPECTED.authority}\"`) && gates.includes("authority_mode: attempt26_bounded_mutation_authorized") && gates.includes("pending_numeric_cap_usd: 4"), "gate_authority_pointer");
assert(task.includes("Attempt26 FINALIZE transport-repair candidate") && task.includes(EXPECTED.proposal) && task.includes(EXPECTED.authority) && task.includes("maximum cumulative finite spend of `$4`"), "task_authority_pointer");
assert(start.includes("Attempt26 approved pre-execution candidate") && start.includes(EXPECTED.proposal) && start.includes(EXPECTED.authority) && start.includes("fresh `$4` cap"), "start_authority_pointer");
assert(activation.includes(`V207_PENDING_PROPOSAL_SHA256`) && activation.includes(EXPECTED.proposal) && activation.includes(`V207_PENDING_CONTROL_SOURCE_COMMIT`) && activation.includes(EXPECTED.repair) && activation.includes("V207_APPROVED_FINITE_CAP_USD: number | null = 4"), "activation_authority_pointer");

process.stdout.write(`V2-07 Attempt26 FINALIZE transport authority validation PASS (${EXPECTED.proposal}; authority ${EXPECTED.authority}; control ${EXPECTED.repair}; USD 4 cap; pre-execution)\n`);

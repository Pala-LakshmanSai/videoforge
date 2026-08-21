import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isAttempt28Activation, isAttempt28Gate, isAttempt28State } from "./v207-attempt28-compat.mjs";

const root = resolve(import.meta.dirname, "../..");
const candidate = resolve(
  root,
  "project-context/evidence/acceptance/VF-10-07/2026-08-21-attempt25-startup-terminal-inventory-candidate",
);
const paths = {
  proposal: resolve(candidate, "combined-live-proposal.json"),
  max1: resolve(candidate, "staged-config-max1.json"),
  max2: resolve(candidate, "staged-config-max2.json"),
  acceptance: resolve(candidate, "acceptance.json"),
  authority: resolve(candidate, "approved-authority.json"),
  closure: resolve(root, "project-context/evidence/acceptance/VF-10-07/2026-08-21-live-qualification/failed-attempt-25.json"),
  state: resolve(root, "project-context/CURRENT_STATE.yaml"),
  gates: resolve(root, "project-context/GATES.yaml"),
  task: resolve(root, "project-context/tasks/VF-10-07.md"),
  start: resolve(root, "project-context/00_START_HERE.md"),
  activation: resolve(root, "apps/web/src/server/providers/v207-activation-authority.ts"),
};
const EXPECTED = {
  proposal: "sha256:c8baa8a45b8e3e108904cac5f04f472ad22da2936dad75daa2a59d23476a8946",
  max1: "sha256:d7a5791c80fa96f997994c70486208af5faea93989a1cc3fe5033a0a911ddacd",
  max2: "sha256:e1edf2d61b188428ce16e6f5597ceadc6ce7d58aa50dda4f8a7ea09e96bd0e38",
  acceptance: "sha256:e20f308d4e33095291978429869877cf81b5b14433bf5ec0f8873bf3683c60a7",
  authority: "sha256:2fc6072b88ca5069eef5510e6f0699faad977102565455495f89b56b02444b7c",
  closure: "sha256:4b1d8b14f24b3e38a672cbe15b772590646bf35fe4e92f7a1046f23f13e5daf2",
  priorClosure: "sha256:12ca4be38d063f761537cc4184b387ae83feeaebc6e9bb102260feff6c347bcb",
  control: "bb9abc03f286cae56bf874fe47dc1d7ebddb1fe9",
  source: "79f123268b6ade640c02dd20616a89d16b43a5e6",
  image:
    "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:bc662a182b2a874c6aeffb05f65cc3ffbdff6b5130c6a75c214618e86cf208b5",
  manifest: "sha256:cebcd5c6233c2eae32f26ced7510acef8192f0d92d7ec3e9dd3ee881d66d205b",
  volume: "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619",
  model: "Comfy-Org/Mage-Flow@d8c99241f6fa80fbd453014234af2bf337ea21e6#int8-convrot",
  gpu: "NVIDIA GeForce RTX 4090",
};
const hash = (bytes) => "sha256:" + createHash("sha256").update(bytes).digest("hex");
const fail = (label) => {
  throw new Error("V207_ATTEMPT25_STARTUP_TERMINAL_INVENTORY_PROPOSAL_INVALID:" + label);
};
const assert = (condition, label) => {
  if (!condition) fail(label);
};
const json = (bytes, label) => {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    fail(label + "_json");
  }
};
const exact = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const [proposalBytes, max1Bytes, max2Bytes, acceptanceBytes, authorityBytes, closureBytes, stateBytes, gatesBytes, taskBytes, startBytes, activationBytes] =
  await Promise.all([
    readFile(paths.proposal),
    readFile(paths.max1),
    readFile(paths.max2),
    readFile(paths.acceptance),
    readFile(paths.authority),
    readFile(paths.closure),
    readFile(paths.state),
    readFile(paths.gates),
    readFile(paths.task),
    readFile(paths.start),
    readFile(paths.activation),
  ]);
for (const [label, bytes, expected] of [
  ["proposal", proposalBytes, EXPECTED.proposal],
  ["max1", max1Bytes, EXPECTED.max1],
  ["max2", max2Bytes, EXPECTED.max2],
  ["acceptance", acceptanceBytes, EXPECTED.acceptance],
  ["authority", authorityBytes, EXPECTED.authority],
  ["closure", closureBytes, EXPECTED.closure],
]) {
  assert(hash(bytes) === expected, label + "_hash");
}
const proposal = json(proposalBytes, "proposal");
const max1 = json(max1Bytes, "max1");
const max2 = json(max2Bytes, "max2");
const acceptance = json(acceptanceBytes, "acceptance");
const authority = json(authorityBytes, "authority");
const closure = json(closureBytes, "closure");
const state = stateBytes.toString("utf8");
const gates = gatesBytes.toString("utf8");
const task = taskBytes.toString("utf8");
const start = startBytes.toString("utf8");
const activation = activationBytes.toString("utf8");

assert(proposal.schema_version === "videoforge.v2-07-attempt25-startup-terminal-inventory-combined-live-proposal/v1", "proposal_schema");
assert(proposal.checkpoint === "V2-07" && proposal.task_id === "VF-10-07" && proposal.attempt === 25, "proposal_scope");
assert(proposal.authority_mode === "PENDING_FRESH_EXACT_APPROVAL_AND_NUMERIC_CAP", "pending_authority_mode");
assert(proposal.user_approval?.exact_proposal_approved === false && proposal.user_approval?.provider_mutation_or_gpu_use_authorized === false, "unapproved");
assert(proposal.user_approval?.maximum_cumulative_finite_spend_usd === null && proposal.rates_cost_and_retention?.maximum_cumulative_finite_spend_usd === null, "null_cap");
const lineage = proposal.lineage;
assert(lineage?.model === EXPECTED.model && lineage?.model_manifest_sha256 === EXPECTED.manifest, "model_lineage");
assert(lineage?.final_image === EXPECTED.image && lineage?.image_source_commit === EXPECTED.source && lineage?.control_source_commit === EXPECTED.control, "image_control_lineage");
assert(lineage?.volume_id_sha256 === EXPECTED.volume && lineage?.volume_size_gb === 50 && lineage?.volume_region === "EU-RO-1" && lineage?.volume_mount === "/runpod-volume" && lineage?.model_root === "/runpod-volume/mage-model", "volume_lineage");
assert(lineage?.failed_attempt_evidence_sha256 === EXPECTED.priorClosure && lineage?.prior_proposal_sha256 === "sha256:be17430ce61a48a823a1ac87a128e83e44cfb88b01163331c285280e95274137" && lineage?.prior_authority_sha256 === "sha256:fccd60a68ee93f522d9e378012c5ccbefb182f6b03e26fde1b5940506ab9c412", "prior_lineage");
assert(proposal.diagnostic_readback_policy?.strict_get_required_before_dispatch === true && proposal.diagnostic_readback_policy?.post_dispatch_health_first === true && proposal.diagnostic_readback_policy?.post_drain_health_first === true, "readback_health_policy");
const startup = proposal.startup_terminal_inventory_policy;
assert(startup?.allowed_before_dispatch_only === true && startup?.allowed_before_any_owned_job === true && startup?.allowed_before_initial_qualification === true, "startup_scope");
assert(startup?.worker_health_counters_required_for_startup_fallback === false && startup?.post_dispatch_or_drain_fallback_forbidden === true && startup?.no_retry_or_duplicate_compute === true, "startup_fallback_bounds");
assert(startup?.health_jobs_required_for_startup_fallback?.object_present === true && startup.health_jobs_required_for_startup_fallback.in_queue_present === true && startup.health_jobs_required_for_startup_fallback.in_queue_exact === 0 && startup.health_jobs_required_for_startup_fallback.in_progress_present === true && startup.health_jobs_required_for_startup_fallback.in_progress_exact === 0, "startup_health_jobs_required");
assert(startup?.health_jobs_reads_bracketing_inventory?.before_first_inventory_snapshot === "required_object_present_and_exact_zero" && startup.health_jobs_reads_bracketing_inventory.after_first_inventory_snapshot === "required_object_present_and_exact_zero" && startup.health_jobs_reads_bracketing_inventory.before_second_inventory_snapshot === "required_object_present_and_exact_zero" && startup.health_jobs_reads_bracketing_inventory.after_second_inventory_snapshot === "required_object_present_and_exact_zero" && startup.health_jobs_reads_bracketing_inventory.job_read_signatures_match === true && startup.health_jobs_reads_bracketing_inventory.all_reads_required === true, "startup_health_jobs_bracketing");
assert(startup?.exact_inventory_required?.includes("exactly_two_stable_inventory_snapshots") && startup?.exact_inventory_required?.includes("matching_inventory_signatures") && startup?.exact_inventory_required?.includes("all_observed_worker_and_pod_records_terminal_EXITED_or_TERMINATED"), "startup_inventory_requirements");
assert(proposal.proposed_operations_in_order.some((item) => item.includes("startup_only_exact_terminal_inventory_fallback")), "startup_operation");
assert(proposal.proposed_operations_in_order.some((item) => item.includes("health_first_quiescence")), "health_first_operation");
for (const [label, config, expectedMax, expectedHash] of [
  ["max1", max1, 1, EXPECTED.max1],
  ["max2", max2, 2, EXPECTED.max2],
]) {
  assert(config.schema_version === "videoforge.v2-07-staged-endpoint-definition/v6", label + "_schema");
  assert(config.control_source_commit === EXPECTED.control && config.image === EXPECTED.image && config.image_source_commit === EXPECTED.source, label + "_lineage");
  assert(config.region === "EU-RO-1" && config.network_volume_id_sha256 === EXPECTED.volume && config.network_volume_size_gb === 50 && config.network_volume_region === "EU-RO-1" && config.network_volume_mount === "/runpod-volume" && config.model_root === "/runpod-volume/mage-model", label + "_volume");
  assert(config.gpu_type_ids?.length === 1 && config.gpu_type_ids[0] === EXPECTED.gpu && config.compute_type === "GPU" && config.flex_only === true && config.workers_min === 0 && config.workers_max === expectedMax && config.flashboot === true, label + "_gpu_workers");
  assert(exact(config.startup_terminal_inventory_fallback, startup), label + "_startup_policy");
  const proposalConfig = proposal.staged_endpoint_configs.find((item) => item.definition_path === "staged-config-" + label + ".json");
  assert(proposalConfig?.definition_sha256 === expectedHash, label + "_proposal_hash_binding");
}
assert(closure.schema_version === "videoforge.v2-07-live-failed-attempt/v1" && closure.attempt === 25 && closure.final_reconciliation_checked_at === "2026-08-21T11:30:30.619Z" && closure.qualification_boundaries?.v2_07 === "NOT_QUALIFIED", "attempt25_closure_scope");
assert(closure.authority_proposal_sha256 === EXPECTED.proposal && closure.approved_authority?.sha256 === EXPECTED.authority && closure.billing?.maximum_cumulative_finite_spend_usd === 4, "attempt25_closure_authority");
assert(closure.failure?.code === "MAGE_OUTPUT_NOT_SUCCEEDED" && closure.failure?.job_dispatch_reached === true && closure.failure?.gpu_jobs_submitted === 1 && closure.failure?.output_failure_stage === "output_finalization", "attempt25_closure_failure");
assert(closure.runpod_cleanup?.final_disposable_resources_absent === true && closure.runpod_cleanup?.pods === 0 && closure.runpod_cleanup?.endpoints === 0 && closure.runpod_cleanup?.private_templates === 0 && closure.runpod_cleanup?.active_serverless_workers === 0 && closure.runpod_cleanup?.running_pods === 0 && closure.runpod_cleanup?.network_volumes === 2, "attempt25_cleanup");
assert(closure.billing?.attempt_increment_usd_settled === 0 && closure.billing?.settlement_state === "THREE_STABLE_READS" && closure.billing?.reconciliation_read_count === 3, "attempt25_billing");
assert(acceptance.schema_version === "videoforge.v2-07-attempt25-startup-terminal-inventory-candidate-handoff/v1" && acceptance.attempt === 25 && acceptance.qualification_status === "NOT_QUALIFIED", "acceptance_scope");
assert(acceptance.candidate?.proposal_sha256 === EXPECTED.proposal && acceptance.candidate?.max1_sha256 === EXPECTED.max1 && acceptance.candidate?.max2_sha256 === EXPECTED.max2 && acceptance.candidate?.control_source_commit === EXPECTED.control && acceptance.candidate?.prior_attempt24_closure_sha256 === EXPECTED.priorClosure && acceptance.candidate?.maximum_cumulative_finite_spend_usd === null && acceptance.candidate?.fresh_numeric_cap_required === true && acceptance.candidate?.authority_path === "approved-authority.json" && acceptance.candidate?.authority_sha256 === EXPECTED.authority && acceptance.candidate?.provider_calls_authorized === false && acceptance.candidate?.provider_mutations_authorized === false && acceptance.candidate?.gpu_use_authorized === false, "acceptance_binding");
assert(acceptance.startup_terminal_inventory?.post_dispatch_or_drain_health_first === true && acceptance.provider_free_exit?.closure_cleanup_confirmed === true, "acceptance_boundary");

assert(authority.schema_version === "videoforge.v2-07-attempt25-startup-terminal-inventory-authority/v1", "authority_schema");
assert(authority.checkpoint === "V2-07" && authority.task_id === "VF-10-07" && authority.attempt === 25, "authority_scope");
assert(authority.authority_mode === "bounded_mutation" && authority.status === "APPROVED_PREEXECUTION_PROVIDER_EXECUTION_PENDING", "authority_status");
assert(authority.proposal?.path === "combined-live-proposal.json" && authority.proposal?.sha256 === EXPECTED.proposal, "authority_proposal");
assert(authority.approval?.exact_proposal_approved === true && authority.approval?.flashboot_true_accepted === true && authority.approval?.low_eu_ro_1_availability_approved === true && authority.approval?.minimum_approved_availability === "LOW" && authority.approval?.maximum_cumulative_finite_spend_usd === 4 && authority.approval?.fresh_numeric_cap === true && authority.approval?.historical_cap_reused === false && authority.approval?.prior_authority_reused === false, "authority_approval");
assert(authority.lineage?.model === EXPECTED.model && authority.lineage?.model_manifest_sha256 === EXPECTED.manifest && authority.lineage?.final_image === EXPECTED.image && authority.lineage?.image_source_commit === EXPECTED.source && authority.lineage?.control_source_commit === EXPECTED.control && authority.lineage?.volume_id_sha256 === EXPECTED.volume && authority.lineage?.volume_size_gb === 50 && authority.lineage?.volume_region === "EU-RO-1" && authority.lineage?.volume_mount === "/runpod-volume" && authority.lineage?.model_root === "/runpod-volume/mage-model" && authority.lineage?.initial_config_sha256 === EXPECTED.max1 && authority.lineage?.concurrent_reader_config_sha256 === EXPECTED.max2 && authority.lineage?.failed_attempt_evidence_sha256 === EXPECTED.priorClosure, "authority_lineage");
assert(authority.execution_boundary?.provider_calls_completed === false && authority.execution_boundary?.external_spend_usd === 0 && authority.execution_boundary?.maximum_cumulative_finite_spend_usd === 4 && authority.execution_boundary?.runpod_mutation_authorized_pending_execution === true && authority.execution_boundary?.gpu_use_authorized_pending_execution === true && authority.execution_boundary?.v2_08_authorized === false, "authority_boundary");
assert(authority.startup_terminal_inventory_policy?.allowed_before_dispatch_only === true && authority.startup_terminal_inventory_policy?.allowed_before_any_owned_job === true && authority.startup_terminal_inventory_policy?.post_dispatch_or_drain_fallback_forbidden === true && authority.startup_terminal_inventory_policy?.no_retry_or_duplicate_compute === true, "authority_startup_policy");
assert(Array.isArray(authority.authorized_operations) && authority.authorized_operations.includes("create_initial_flashboot_true_max_one_endpoint_in_eu_ro_1_on_exact_mage_volume") && authority.authorized_operations.includes("submit_two_simultaneous_read_only_complete_batches") && authority.authorized_operations.includes("retain_both_existing_volumes_in_all_outcomes"), "authority_operations");

const candidatePath = "evidence/acceptance/VF-10-07/2026-08-21-attempt25-startup-terminal-inventory-candidate/combined-live-proposal.json";
const attempt26ClosedState =
  state.includes("phase: serverless_v2_v2_07_attempt26_closed_finalize_response_invalid") &&
  state.includes("provider_calls_authorized: false") &&
  state.includes("maximum_external_spend_usd: 0");
const attempt27CandidateState =
  state.includes("phase: serverless_v2_v2_07_attempt27_hosted_png_crc32_repair_candidate_ready") &&
  state.includes("provider_calls_authorized: false") &&
  state.includes("maximum_external_spend_usd: 0");
const attempt27AuthorizedState =
  state.includes("phase: serverless_v2_v2_07_attempt27_hosted_png_crc32_repair_authorized") &&
  state.includes("task_stage: bounded_mutation") &&
  state.includes("provider_calls_authorized: true") &&
  state.includes("maximum_external_spend_usd: 4");
const attempt27ClosedState =
  state.includes("phase: serverless_v2_v2_07_attempt27_warm_idle_failure_closed") &&
  state.includes("task_stage: provider_free") &&
  state.includes("provider_calls_authorized: false") &&
  state.includes("remote_or_cloud_mutations_authorized: false") &&
  state.includes("gpu_use_authorized: false") &&
  state.includes("maximum_external_spend_usd: 0");
const attempt26ClosedGate =
  gates.includes("authority_mode: none_attempt26_consumed") &&
  gates.includes('result: "NOT_QUALIFIED_attempt26_closed_finalize_response_invalid"') &&
  gates.includes(
    'latest_closed_proposal_sha256: "sha256:0112b0b72254ef286643fc63bee0176fce327edc401ce40de4a3a860a5e68632"',
  );
const attempt27CandidateGate =
  gates.includes("authority_mode: none_attempt27_pending_fresh_approval") &&
  gates.includes('result: "NOT_QUALIFIED_attempt27_hosted_png_crc32_repair_candidate_ready"') &&
  gates.includes(
    'pending_proposal_sha256: "sha256:5cb96aa79a4bb6f1fda3e6dadba7d6997421cc87cd2ed27f6a8ed92bee9fe7ae"',
  );
const attempt27AuthorizedGate =
  gates.includes("authority_mode: attempt27_bounded_mutation_authorized") &&
  gates.includes('result: "NOT_QUALIFIED_attempt27_authorized_preexecution"') &&
  gates.includes(
    'pending_proposal_sha256: "sha256:5cb96aa79a4bb6f1fda3e6dadba7d6997421cc87cd2ed27f6a8ed92bee9fe7ae"',
  );
const attempt27ClosedGate =
  gates.includes("authority_mode: none_attempt27_consumed") &&
  gates.includes('result: "NOT_QUALIFIED_attempt27_closed_warm_idle_failure"') &&
  gates.includes(
    'latest_closed_proposal_sha256: "sha256:5cb96aa79a4bb6f1fda3e6dadba7d6997421cc87cd2ed27f6a8ed92bee9fe7ae"',
  ) &&
  gates.includes(
    'latest_closed_authority_sha256: "sha256:3bf923fb59df2ab0a0ff648ad8773ed549b2296aba66e82db9635c9fa7b66b10"',
  ) &&
  gates.includes("pending_numeric_cap_usd: null");
const attempt28State = isAttempt28State(state);
const attempt28Gate = isAttempt28Gate(gates);
assert(((state.includes("phase: serverless_v2_v2_07_attempt25_closed") || state.includes("phase: serverless_v2_v2_07_attempt26_finalize_transport_repair_candidate_ready")) && state.includes("maximum_external_spend_usd: 0")) || (state.includes("phase: serverless_v2_v2_07_attempt26_finalize_transport_repair_authorized") && state.includes("maximum_external_spend_usd: 4")) || attempt26ClosedState || attempt27CandidateState || attempt27AuthorizedState || attempt27ClosedState || attempt28State, "state_phase");
assert(state.includes(candidatePath) && state.includes(EXPECTED.proposal) && state.includes(EXPECTED.control) && state.includes(EXPECTED.authority), "state_pointer");
assert((gates.includes("latest_closed_proposal: \"" + candidatePath + "\"") && gates.includes("latest_closed_proposal_sha256: \"" + EXPECTED.proposal + "\"") && (gates.includes("authority_mode: none_attempt25_consumed") || gates.includes("authority_mode: none_attempt26_pending_fresh_approval") || gates.includes("authority_mode: attempt26_bounded_mutation_authorized")) && gates.includes("closed_authority: \"evidence/acceptance/VF-10-07/2026-08-21-attempt25-startup-terminal-inventory-candidate/approved-authority.json\"") && gates.includes(EXPECTED.authority) && (gates.includes("pending_numeric_cap_usd: null") || gates.includes("pending_numeric_cap_usd: 4"))) || attempt26ClosedGate || attempt27CandidateGate || attempt27AuthorizedGate || attempt27ClosedGate || attempt28Gate, "gate_pointer");
assert(task.includes("Attempt25 startup-terminal-inventory candidate") && task.includes(EXPECTED.proposal) && task.includes(EXPECTED.control) && task.includes(EXPECTED.closure), "task_pointer");
assert(start.includes("Attempt 25 startup-terminal-inventory candidate") && start.includes(EXPECTED.proposal) && start.includes(EXPECTED.control) && start.includes("fresh positive numeric cap"), "start_pointer");
assert(activation.includes("V207_PENDING_PROPOSAL_SHA256") && (activation.includes(EXPECTED.proposal) || activation.includes("sha256:0112b0b72254ef286643fc63bee0176fce327edc401ce40de4a3a860a5e68632") || activation.includes("sha256:5cb96aa79a4bb6f1fda3e6dadba7d6997421cc87cd2ed27f6a8ed92bee9fe7ae") || isAttempt28Activation(activation)) && (activation.includes("V207_APPROVED_FINITE_CAP_USD: number | null = null") || activation.includes("V207_APPROVED_FINITE_CAP_USD: number | null = 4")), "activation_approved");
process.stdout.write("V2-07 Attempt25 startup-terminal-inventory authority validation PASS (" + EXPECTED.proposal + "; authority " + EXPECTED.authority + "; consumed and closed)\n");

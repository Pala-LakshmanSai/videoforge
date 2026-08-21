import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isAttempt28Activation, isAttempt28Gate, isAttempt28State } from "./v207-attempt28-compat.mjs";

const root = resolve(import.meta.dirname, "../..");
const candidate = resolve(
  root,
  "project-context/evidence/acceptance/VF-10-07/2026-08-21-attempt24-verification-stage-diagnostic-candidate",
);
const paths = {
  proposal: resolve(candidate, "combined-live-proposal.json"),
  max1: resolve(candidate, "staged-config-max1.json"),
  max2: resolve(candidate, "staged-config-max2.json"),
  authority: resolve(candidate, "approved-authority.json"),
  acceptance: resolve(candidate, "acceptance.json"),
  closure: resolve(
    root,
    "project-context/evidence/acceptance/VF-10-07/2026-08-20-live-qualification/failed-attempt-23.json",
  ),
  state: resolve(root, "project-context/CURRENT_STATE.yaml"),
  gates: resolve(root, "project-context/GATES.yaml"),
  task: resolve(root, "project-context/tasks/VF-10-07.md"),
  start: resolve(root, "project-context/00_START_HERE.md"),
  activation: resolve(root, "apps/web/src/server/providers/v207-activation-authority.ts"),
};

const EXPECTED = {
  proposal: "sha256:be17430ce61a48a823a1ac87a128e83e44cfb88b01163331c285280e95274137",
  max1: "sha256:345072150945c7dfa686c6b90b36565accd65ad5666f5c2917e160d5cf9f308a",
  max2: "sha256:173e52dde1443d61f9a678e54ff859f2709797a3f4aa818f0402772887c2be8a",
  closure: "sha256:0f48f3bc82b6d0b7fb48e723c4a3fc36a142129de578447acd30d77157e1ca1b",
  control: "63517e605d441fa23020bea8bff2987cc4bc99c5",
  source: "79f123268b6ade640c02dd20616a89d16b43a5e6",
  image:
    "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:bc662a182b2a874c6aeffb05f65cc3ffbdff6b5130c6a75c214618e86cf208b5",
  manifest: "sha256:cebcd5c6233c2eae32f26ced7510acef8192f0d92d7ec3e9dd3ee881d66d205b",
  volume: "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619",
  model: "Comfy-Org/Mage-Flow@d8c99241f6fa80fbd453014234af2bf337ea21e6#int8-convrot",
  priorProposal: "sha256:386dd8330f8e626d9afe8c8de8bbd1385fd9664b9fefbc472c24722105f917f9",
  priorAuthority: "sha256:c59bd74673263eeeafed828dade74fe36ae2f27ed7914d413e37bfd6722a3b35",
  authority: "sha256:fccd60a68ee93f522d9e378012c5ccbefb182f6b03e26fde1b5940506ab9c412",
};

const hash = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const fail = (label) => {
  throw new Error(`V207_ATTEMPT24_VERIFICATION_STAGE_PROPOSAL_INVALID:${label}`);
};
const assert = (condition, label) => {
  if (!condition) fail(label);
};
const parseJson = (bytes, label) => {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    fail(`${label}_json`);
  }
};
const [proposalBytes, max1Bytes, max2Bytes, authorityBytes, acceptanceBytes, closureBytes, stateBytes, gatesBytes, taskBytes, startBytes, activationBytes] =
  await Promise.all([
    readFile(paths.proposal),
    readFile(paths.max1),
    readFile(paths.max2),
    readFile(paths.authority),
    readFile(paths.acceptance),
    readFile(paths.closure),
    readFile(paths.state, "utf8"),
    readFile(paths.gates, "utf8"),
    readFile(paths.task, "utf8"),
    readFile(paths.start, "utf8"),
    readFile(paths.activation, "utf8"),
  ]);
for (const [label, bytes, expected] of [
  ["proposal", proposalBytes, EXPECTED.proposal],
  ["max1", max1Bytes, EXPECTED.max1],
  ["max2", max2Bytes, EXPECTED.max2],
  ["authority", authorityBytes, EXPECTED.authority],
  ["closure", closureBytes, EXPECTED.closure],
]) assert(hash(bytes) === expected, `${label}_hash`);
const proposal = parseJson(proposalBytes, "proposal");
const max1 = parseJson(max1Bytes, "max1");
const max2 = parseJson(max2Bytes, "max2");
const authority = parseJson(authorityBytes, "authority");
const acceptance = parseJson(acceptanceBytes, "acceptance");
const closure = parseJson(closureBytes, "closure");
const state = stateBytes.toString("utf8");
const gates = gatesBytes.toString("utf8");
const task = taskBytes.toString("utf8");
const start = startBytes.toString("utf8");
const activation = activationBytes.toString("utf8");

assert(proposal.schema_version === "videoforge.v2-07-attempt24-verification-stage-diagnostic-combined-live-proposal/v1", "proposal_schema");
assert(proposal.checkpoint === "V2-07" && proposal.task_id === "VF-10-07" && proposal.attempt === 24, "proposal_scope");
assert(proposal.authority_mode === "PENDING_FRESH_EXACT_APPROVAL_AND_NUMERIC_CAP", "pending_authority_mode");
assert(proposal.user_approval?.exact_proposal_approved === false && proposal.user_approval?.provider_mutation_or_gpu_use_authorized === false, "proposal_unapproved");
assert(proposal.user_approval?.maximum_cumulative_finite_spend_usd === null && proposal.rates_cost_and_retention?.maximum_cumulative_finite_spend_usd === null, "proposal_null_cap");
const lineage = proposal.lineage;
assert(lineage?.model === EXPECTED.model && lineage?.model_manifest_sha256 === EXPECTED.manifest, "model_lineage");
assert(lineage?.final_image === EXPECTED.image && lineage?.image_source_commit === EXPECTED.source && lineage?.control_source_commit === EXPECTED.control, "image_control_lineage");
assert(lineage?.volume_id_sha256 === EXPECTED.volume && lineage?.volume_size_gb === 50 && lineage?.volume_region === "EU-RO-1" && lineage?.volume_mount === "/runpod-volume" && lineage?.model_root === "/runpod-volume/mage-model", "volume_lineage");
assert(lineage?.failed_attempt_evidence_sha256 === EXPECTED.closure && lineage?.prior_proposal_sha256 === EXPECTED.priorProposal && lineage?.prior_authority_sha256 === EXPECTED.priorAuthority, "prior_lineage");
assert(proposal.diagnostic_readback_policy?.strict_get_required_before_dispatch === true, "strict_readback");
assert(proposal.output_contract_diagnostic_policy?.diagnostic_category === "output_contract_with_structurally_branded_verification_stage", "diagnostic_category");
assert(proposal.output_contract_diagnostic_policy?.provider_body_retained === false && proposal.output_contract_diagnostic_policy?.raw_output_retained === false && proposal.output_contract_diagnostic_policy?.unsafe_output_fields_retained === false, "diagnostic_redaction");
assert(proposal.output_contract_diagnostic_policy?.stop_after_first_completed_job_non_success === true && proposal.output_contract_diagnostic_policy?.retry_on_non_success === false && proposal.output_contract_diagnostic_policy?.duplicate_dispatch_on_non_success === false && proposal.output_contract_diagnostic_policy?.no_warm_batch_or_reader_after_non_success === true, "diagnostic_stop");
assert(proposal.output_contract_diagnostic_policy?.allowed_evidence_fields?.includes("output_failure_stage"), "stage_field");
assert(proposal.output_contract_diagnostic_policy?.output_failure_stage_allowlist?.includes("output_finalization_replay"), "stage_allowlist");

const expectedStages = ["top_level", "item_count", "authority_count", "receipt_presence", "receipt_hash", "receipt_signature", "receipt_identity", "output_lineage", "output_readback", "output_png_probe", "output_finalization", "output_finalization_replay", "unknown"];
for (const [label, config, workersMax] of [["max1", max1, 1], ["max2", max2, 2]]) {
  assert(config.schema_version === "videoforge.v2-07-staged-endpoint-definition/v6", `${label}_schema`);
  assert(config.control_source_commit === EXPECTED.control && config.image === EXPECTED.image && config.image_source_commit === EXPECTED.source, `${label}_lineage`);
  assert(config.region === "EU-RO-1" && config.network_volume_id_sha256 === EXPECTED.volume && config.network_volume_size_gb === 50 && config.network_volume_region === "EU-RO-1" && config.network_volume_mount === "/runpod-volume" && config.model_root === "/runpod-volume/mage-model", `${label}_volume`);
  assert(config.gpu_type_ids?.length === 1 && config.gpu_type_ids[0] === "NVIDIA GeForce RTX 4090" && config.compute_type === "GPU" && config.flex_only === true && config.workers_min === 0 && config.workers_max === workersMax && config.flashboot === true, `${label}_gpu_workers`);
  assert(config.output_contract_diagnostic?.allowed_evidence_fields?.includes("output_failure_stage"), `${label}_stage_field`);
  assert(JSON.stringify(config.output_contract_diagnostic?.output_failure_stage_allowlist) === JSON.stringify(expectedStages), `${label}_stage_allowlist`);
}
assert(closure.schema_version === "videoforge.v2-07-live-failed-attempt/v1" && closure.attempt === 23 && closure.qualification_boundaries?.v2_07 === "NOT_QUALIFIED", "prior_closure_scope");
assert(closure.authority_proposal_sha256 === EXPECTED.priorProposal && closure.approved_authority?.sha256 === EXPECTED.priorAuthority && closure.billing?.maximum_cumulative_finite_spend_usd === 4, "prior_closure_authority");
assert(closure.failure?.provider_job_status === "COMPLETED" && closure.failure?.accepted_batch_count === 0 && closure.failure?.outputs_accepted === 0 && closure.failure?.inference_receipt_accepted === false, "prior_closure_output_boundary");
assert(closure.runpod_cleanup?.final_disposable_resources_absent === true && closure.runpod_cleanup?.pods === 0 && closure.runpod_cleanup?.endpoints === 0 && closure.runpod_cleanup?.private_templates === 0 && closure.runpod_cleanup?.active_serverless_workers === 0 && closure.runpod_cleanup?.running_pods === 0 && closure.runpod_cleanup?.network_volumes === 2, "prior_cleanup");
assert(closure.billing?.attempt_increment_usd_settled === 0 && closure.billing?.settlement_state === "STABLE_THREE_READS" && closure.billing?.reconciliation_read_count === 3, "prior_billing");
assert(acceptance.candidate?.proposal_sha256 === EXPECTED.proposal && acceptance.candidate?.control_source_commit === EXPECTED.control && acceptance.candidate?.maximum_cumulative_finite_spend_usd === null && acceptance.candidate?.authority_path === null, "acceptance_binding");
assert(acceptance.output_contract_diagnostic?.output_failure_stage_allowlist?.includes("receipt_finalization") === false && acceptance.output_contract_diagnostic?.output_failure_stage_allowlist?.includes("output_finalization"), "acceptance_stage_policy");

assert(authority.schema_version === "videoforge.v2-07-attempt24-verification-stage-diagnostic-authority/v1", "authority_schema");
assert(authority.checkpoint === "V2-07" && authority.task_id === "VF-10-07" && authority.attempt === 24, "authority_scope");
assert(authority.authority_mode === "bounded_mutation" && authority.status === "APPROVED_PREEXECUTION_PROVIDER_EXECUTION_PENDING", "authority_status");
assert(authority.proposal?.path === "combined-live-proposal.json" && authority.proposal?.sha256 === EXPECTED.proposal, "authority_proposal");
assert(authority.approval?.exact_proposal_approved === true && authority.approval?.flashboot_true_accepted === true && authority.approval?.low_eu_ro_1_availability_approved === true, "authority_approval_flags");
assert(authority.approval?.minimum_approved_availability === "LOW" && authority.approval?.maximum_cumulative_finite_spend_usd === 4 && authority.approval?.fresh_numeric_cap === true && authority.approval?.historical_cap_reused === false && authority.approval?.prior_authority_reused === false, "authority_cap");
assert(authority.lineage?.model === EXPECTED.model && authority.lineage?.model_manifest_sha256 === EXPECTED.manifest, "authority_model_lineage");
assert(authority.lineage?.image_source_commit === EXPECTED.source && authority.lineage?.control_source_commit === EXPECTED.control && authority.lineage?.final_image === EXPECTED.image, "authority_image_lineage");
assert(authority.lineage?.volume_id_sha256 === EXPECTED.volume && authority.lineage?.volume_size_gb === 50 && authority.lineage?.volume_region === "EU-RO-1" && authority.lineage?.volume_mount === "/runpod-volume" && authority.lineage?.model_root === "/runpod-volume/mage-model", "authority_volume_lineage");
assert(authority.lineage?.initial_config_sha256 === EXPECTED.max1 && authority.lineage?.concurrent_reader_config_sha256 === EXPECTED.max2 && authority.lineage?.failed_attempt_evidence_sha256 === EXPECTED.closure, "authority_config_prior_lineage");
assert(authority.output_contract_diagnostic_policy?.diagnostic_category === "output_contract_with_structurally_branded_verification_stage" && authority.output_contract_diagnostic_policy?.provider_body_retained === false && authority.output_contract_diagnostic_policy?.raw_output_retained === false && authority.output_contract_diagnostic_policy?.retry_on_non_success === false, "authority_output_policy");
assert(authority.execution_boundary?.provider_calls_completed === false && authority.execution_boundary?.external_spend_usd === 0 && authority.execution_boundary?.maximum_cumulative_finite_spend_usd === 4 && authority.execution_boundary?.v2_08_authorized === false, "authority_boundary");

const candidatePath = "evidence/acceptance/VF-10-07/2026-08-21-attempt24-verification-stage-diagnostic-candidate/combined-live-proposal.json";
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
assert(
  (state.includes("phase: serverless_v2_v2_07_attempt24_verification_stage_diagnostic_authorized") && state.includes("maximum_external_spend_usd: 4")) ||
    (state.includes("phase: serverless_v2_v2_07_attempt24_closed") && state.includes("maximum_external_spend_usd: 0")) ||
    (state.includes("phase: serverless_v2_v2_07_attempt25_startup_terminal_inventory_candidate") && state.includes("maximum_external_spend_usd: 0")) ||
    (state.includes("phase: serverless_v2_v2_07_attempt25_startup_terminal_inventory_authorized") && state.includes("maximum_external_spend_usd: 4")) ||
    (state.includes("phase: serverless_v2_v2_07_attempt25_closed") && state.includes("maximum_external_spend_usd: 0")) ||
    (state.includes("phase: serverless_v2_v2_07_attempt26_finalize_transport_repair_candidate_ready") && state.includes("maximum_external_spend_usd: 0")) ||
    attempt26ClosedState ||
    attempt27CandidateState ||
    attempt27AuthorizedState ||
    attempt27ClosedState ||
    attempt28State,
  "state_phase",
);
assert(
  state.includes(candidatePath) &&
    state.includes(EXPECTED.proposal) &&
    state.includes(EXPECTED.control) &&
    ((state.includes("provider_calls_authorized: true") &&
      state.includes("current_authority: evidence/acceptance/VF-10-07/2026-08-21-attempt24-verification-stage-diagnostic-candidate/approved-authority.json")) ||
      (state.includes("provider_calls_authorized: true") &&
        state.includes("current_authority: evidence/acceptance/VF-10-07/2026-08-21-attempt25-startup-terminal-inventory-candidate/approved-authority.json")) ||
      (attempt27AuthorizedState &&
        state.includes("current_authority: evidence/acceptance/VF-10-07/2026-08-21-attempt27-hosted-png-crc32-repair-candidate/approved-authority.json")) ||
      (state.includes("provider_calls_authorized: false") && state.includes("current_authority: null"))) &&
    state.includes(EXPECTED.authority),
  "state_pointer",
);
assert(
  ((gates.includes("pending_proposal: \"" + candidatePath + "\"") &&
    gates.includes("pending_control_source_commit: \"" + EXPECTED.control + "\"") &&
    gates.includes("authority_mode: attempt24_bounded_mutation_authorized")) ||
    (gates.includes("latest_closed_proposal: \"" + candidatePath + "\"") &&
      gates.includes("latest_approved_control_source_commit: \"" + EXPECTED.control + "\"") &&
      gates.includes("authority_mode: none_attempt24_consumed")) ||
    (gates.includes("pending_proposal: \"evidence/acceptance/VF-10-07/2026-08-21-attempt25-startup-terminal-inventory-candidate/combined-live-proposal.json\"") &&
      gates.includes("pending_proposal_sha256: \"sha256:c8baa8a45b8e3e108904cac5f04f472ad22da2936dad75daa2a59d23476a8946\"") &&
      gates.includes("pending_control_source_commit: \"bb9abc03f286cae56bf874fe47dc1d7ebddb1fe9\"") &&
      gates.includes("authority_mode: none_attempt25_pending_fresh_approval") &&
      gates.includes("pending_numeric_cap_usd: null")) ||
    (gates.includes("pending_proposal: \"evidence/acceptance/VF-10-07/2026-08-21-attempt25-startup-terminal-inventory-candidate/combined-live-proposal.json\"") &&
      gates.includes("pending_proposal_sha256: \"sha256:c8baa8a45b8e3e108904cac5f04f472ad22da2936dad75daa2a59d23476a8946\"") &&
      gates.includes("pending_control_source_commit: \"bb9abc03f286cae56bf874fe47dc1d7ebddb1fe9\"") &&
      gates.includes("pending_authority: \"evidence/acceptance/VF-10-07/2026-08-21-attempt25-startup-terminal-inventory-candidate/approved-authority.json\"") &&
      gates.includes("pending_authority_sha256: \"sha256:2fc6072b88ca5069eef5510e6f0699faad977102565455495f89b56b02444b7c\"") &&
      gates.includes("authority_mode: attempt25_bounded_mutation_authorized") &&
      gates.includes("pending_numeric_cap_usd: 4")) ||
    (gates.includes("historical_attempt24_proposal:") &&
      gates.includes("historical_attempt24_authority:") &&
      (gates.includes("authority_mode: none_attempt25_consumed") ||
        gates.includes("authority_mode: none_attempt26_pending_fresh_approval"))) ||
    (attempt26ClosedGate ||
      attempt27CandidateGate ||
      attempt27AuthorizedGate ||
      attempt27ClosedGate ||
      attempt28Gate)) &&
  gates.includes(EXPECTED.proposal) &&
  gates.includes(EXPECTED.authority),
  "gate_pointer",
);
assert(task.includes("Fresh Attempt24 verification-stage diagnostic authority") && task.includes(EXPECTED.proposal) && task.includes(EXPECTED.control) && task.includes(EXPECTED.authority) && task.includes("fresh maximum cumulative finite spend of `$4`"), "task_pointer");
assert(start.includes("Attempt 24 verification-stage diagnostic candidate") && start.includes(EXPECTED.proposal) && start.includes(EXPECTED.control) && start.includes("fresh positive numeric cap"), "start_pointer");
assert((start.includes("Attempt 24 exact authority is recorded") || start.includes("Attempt 24 exact authority was recorded")) && start.includes(EXPECTED.authority) && start.includes("fresh maximum cumulative finite spend of"), "start_authority_pointer");
assert(
  activation.includes("V207_PENDING_PROPOSAL_SHA256") &&
    (activation.includes(EXPECTED.proposal) ||
      activation.includes("sha256:c8baa8a45b8e3e108904cac5f04f472ad22da2936dad75daa2a59d23476a8946") ||
      activation.includes("sha256:0112b0b72254ef286643fc63bee0176fce327edc401ce40de4a3a860a5e68632") ||
      activation.includes("sha256:5cb96aa79a4bb6f1fda3e6dadba7d6997421cc87cd2ed27f6a8ed92bee9fe7ae") ||
      isAttempt28Activation(activation)) &&
    (activation.includes("V207_APPROVED_FINITE_CAP_USD: number | null = 4") ||
      activation.includes("V207_APPROVED_FINITE_CAP_USD: number | null = null")),
  "activation_approved",
);
await access(resolve(candidate, "combined-live-proposal.json"));
await access(resolve(candidate, "approved-authority.json"));
process.stdout.write(`V2-07 Attempt24 verification-stage proposal validation PASS (${EXPECTED.proposal}; authority ${EXPECTED.authority}; fresh USD 4 cap recorded; provider execution pending)
`);

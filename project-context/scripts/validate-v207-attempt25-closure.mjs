import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const evidenceRoot = resolve(root, "project-context/evidence/acceptance/VF-10-07");
const candidate = resolve(evidenceRoot, "2026-08-21-attempt25-startup-terminal-inventory-candidate");
const paths = {
  closure: resolve(evidenceRoot, "2026-08-21-live-qualification/failed-attempt-25.json"),
  authority: resolve(candidate, "approved-authority.json"),
  proposal: resolve(candidate, "combined-live-proposal.json"),
  max1: resolve(candidate, "staged-config-max1.json"),
  max2: resolve(candidate, "staged-config-max2.json"),
  acceptance: resolve(candidate, "acceptance.json"),
  state: resolve(root, "project-context/CURRENT_STATE.yaml"),
  gates: resolve(root, "project-context/GATES.yaml"),
  task: resolve(root, "project-context/tasks/VF-10-07.md"),
  start: resolve(root, "project-context/00_START_HERE.md"),
  activation: resolve(root, "apps/web/src/server/providers/v207-activation-authority.ts"),
};

const EXPECTED = {
  authority: "sha256:2fc6072b88ca5069eef5510e6f0699faad977102565455495f89b56b02444b7c",
  proposal: "sha256:c8baa8a45b8e3e108904cac5f04f472ad22da2936dad75daa2a59d23476a8946",
  max1: "sha256:d7a5791c80fa96f997994c70486208af5faea93989a1cc3fe5033a0a911ddacd",
  max2: "sha256:e1edf2d61b188428ce16e6f5597ceadc6ce7d58aa50dda4f8a7ea09e96bd0e38",
  authorityCommit: "cdb1bfe3e337e7daf05672dc09adae606d293d9a6",
  control: "bb9abc03f286cae56bf874fe47dc1d7ebddb1fe9",
  source: "79f123268b6ade640c02dd20616a89d16b43a5e6",
  image:
    "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:bc662a182b2a874c6aeffb05f65cc3ffbdff6b5130c6a75c214618e86cf208b5",
  model: "Comfy-Org/Mage-Flow@d8c99241f6fa80fbd453014234af2bf337ea21e6#int8-convrot",
  manifest: "sha256:cebcd5c6233c2eae32f26ced7510acef8192f0d92d7ec3e9dd3ee881d66d205b",
  volume: "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619",
  config: "sha256:8e11a42cb91fa1d0d6a4e19fc6b4a6cfd5f77116c49a8516b6435813dfaab1de",
  layer: "sha256:befafc2ec3d32a73b632f769069c9c02645d3fac049ebd2478fbf8ad3d5cdf38",
  base: "sha256:8a5b8f453c694b2eeee097e3d958b08c5e47c15290b5cdc17a4fb7e5e3e4f497",
  parentConfig: "sha256:de5c854ae5aa9e611e218b89d29a250eb03a0a316f0ac92d584d53a038d06ff2",
  template: "sha256:633fd11d4874dc71d3b23ee47cff75654a03b853acda1c5d93a4f27973c20329",
  endpoint: "sha256:bb35475fe019ca43e19af85cc84aef902d3b72659e274110262804727890cb5f",
  worker: "sha256:0ca150f857bbbbd63b474e220a008511805daf337ae7d0154489046e57419e53",
  cleanup: "sha256:91c67ac7dd8143589e9bb6d66609d6f793192791bbb0af1c2a5d86ee36e9cd1",
  reconciliation: "sha256:bf19c47747017355c6e1a56894aa2c384ceae0af231ca12631fee28849652fac",
  orchestrator: "sha256:9bfb1ca4a78ac65d91f06817553572483f7cba99460a03267c8d245d068cd374",
  qualification: "sha256:b6d4976ca415af1d899b5f0101f1a500ab81ef20665f6cd8f669dd757bd34051",
};

const hash = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const fail = (label) => {
  throw new Error(`V207_ATTEMPT25_CLOSURE_INVALID:${label}`);
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

const [closureBytes, authorityBytes, proposalBytes, max1Bytes, max2Bytes, acceptanceBytes, stateBytes, gatesBytes, taskBytes, startBytes, activationBytes] =
  await Promise.all([
    readFile(paths.closure),
    readFile(paths.authority),
    readFile(paths.proposal),
    readFile(paths.max1),
    readFile(paths.max2),
    readFile(paths.acceptance),
    readFile(paths.state),
    readFile(paths.gates),
    readFile(paths.task),
    readFile(paths.start),
    readFile(paths.activation),
  ]);

const closure = parseJson(closureBytes, "closure");
const authority = parseJson(authorityBytes, "authority");
const proposal = parseJson(proposalBytes, "proposal");
const max1 = parseJson(max1Bytes, "max1");
const max2 = parseJson(max2Bytes, "max2");
const acceptance = parseJson(acceptanceBytes, "acceptance");
const state = stateBytes.toString("utf8");
const gates = gatesBytes.toString("utf8");
const task = taskBytes.toString("utf8");
const start = startBytes.toString("utf8");
const activation = activationBytes.toString("utf8");

for (const [label, bytes, expected] of [
  ["authority", authorityBytes, EXPECTED.authority],
  ["proposal", proposalBytes, EXPECTED.proposal],
  ["max1", max1Bytes, EXPECTED.max1],
  ["max2", max2Bytes, EXPECTED.max2],
]) {
  assert(hash(bytes) === expected, `${label}_hash`);
}

const closureHash = hash(closureBytes);
const acceptanceHash = hash(acceptanceBytes);

assert(closure.schema_version === "videoforge.v2-07-live-failed-attempt/v1", "closure_schema");
assert(closure.checkpoint === "V2-07" && closure.task_id === "VF-10-07" && closure.attempt === 25, "closure_scope");
assert(closure.final_reconciliation_checked_at === "2026-08-21T11:30:30.619Z", "reconciliation_timestamp");
assert(
  closure.result === "FAILED_POSTDISPATCH_COMPLETED_JOB_OUTPUT_FINALIZATION_UNPROVEN_EXACT_CLEANUP_RECONCILIATION_COMPLETE",
  "closure_result",
);
assert(closure.authority_status === "CLOSED_EXACT_ATTEMPT25_CONSUMED_DO_NOT_REUSE", "authority_closed");
assert(closure.authority_commit === EXPECTED.authorityCommit && closure.authority_proposal_sha256 === EXPECTED.proposal, "authority_binding");
assert(
  closure.approved_authority?.sha256 === EXPECTED.authority &&
    closure.approved_authority?.maximum_cumulative_finite_spend_usd === 4 &&
    closure.approved_authority?.flashboot === true &&
    closure.approved_authority?.minimum_availability === "LOW" &&
    closure.approved_authority?.region === "EU-RO-1",
  "approved_authority",
);

const lineage = closure.artifact_lineage;
assert(
  lineage?.model === EXPECTED.model &&
    lineage?.image === EXPECTED.image &&
    lineage?.image_source_commit === EXPECTED.source &&
    lineage?.control_source_commit === EXPECTED.control,
  "artifact_lineage",
);
assert(
  lineage?.config_sha256 === EXPECTED.config &&
    lineage?.layer_sha256 === EXPECTED.layer &&
    lineage?.base_sha256 === EXPECTED.base &&
    lineage?.model_manifest_sha256 === EXPECTED.manifest,
  "image_lineage",
);
assert(
  lineage?.volume_id_sha256 === EXPECTED.volume &&
    lineage?.volume_size_gb === 50 &&
    lineage?.volume_region === "EU-RO-1" &&
    lineage?.volume_mount === "/runpod-volume" &&
    lineage?.model_root === "/runpod-volume/mage-model",
  "volume_lineage",
);
assert(lineage?.max_one_definition_sha256 === EXPECTED.max1 && lineage?.max_two_definition_sha256 === EXPECTED.max2, "staged_lineage");

const identity = closure.provider_identity;
assert(
  identity?.template_id_sha256 === EXPECTED.template &&
    identity?.endpoint_id_sha256 === EXPECTED.endpoint &&
    identity?.initial_config_hash === "sha256:f001fbc55f389e44f01826488a15ecb9c6cdd1f9a253eaaec3aabd35f1376199" &&
    identity?.concurrent_reader_config_hash === null &&
    identity?.initial_zero_worker_proof === true &&
    identity?.startup_terminal_inventory_proof === true &&
    identity?.quiescence_guard_confirmed === true,
  "provider_identity",
);

const failure = closure.failure;
assert(
  failure?.code === "MAGE_OUTPUT_NOT_SUCCEEDED" &&
    failure?.raw_phase === "status" &&
    failure?.raw_result === "FAILED" &&
    failure?.error_category === "output_contract" &&
    failure?.output_failure_stage === "output_finalization" &&
    failure?.output_status === "SUCCEEDED" &&
    failure?.output_failure_code === "UNKNOWN" &&
    failure?.output_shape_kind === "object" &&
    Array.isArray(failure?.output_shape_keys) &&
    failure.output_shape_keys.join(",") === "items,provenance_receipt,status",
  "failure_contract",
);
assert(
  failure?.provider_job_status === "COMPLETED" &&
    failure?.job_dispatch_reached === true &&
    failure?.gpu_jobs_submitted === 1 &&
    failure?.accepted_batch_count === 0 &&
    failure?.outputs_accepted === 0 &&
    failure?.inference_receipt_accepted === false &&
    failure?.measured_spend_usd === 0,
  "failure_boundary",
);
assert(failure?.provider_delay_time_ms === 77425 && failure?.provider_execution_time_ms === 122299, "failure_timings");

const cloudflare = closure.cloudflare_cleanup;
assert(
  cloudflare?.captured_worker_version_id_sha256 === EXPECTED.worker &&
    cloudflare?.signer_activation_status === 403 &&
    cloudflare?.signer_secret_deleted === true &&
    cloudflare?.worker_version_restored === true &&
    cloudflare?.restored_route?.status === 404 &&
    cloudflare?.restored_route?.code === "V207_ROUTE_DISABLED" &&
    cloudflare?.route_restoration === "CONFIRMED_16_CONSECUTIVE_EXACT_FINGERPRINTS_OVER_30_SECONDS_WITHIN_120_SECOND_DEADLINE",
  "cloudflare_cleanup",
);

const cleanup = closure.runpod_cleanup;
assert(cleanup?.initial_runner_cleanup === "UNCERTAIN" && cleanup?.narrow_exact_cleanup === "CONFIRMED", "cleanup_boundary");
assert(cleanup?.cleanup_evidence_sha256 === EXPECTED.cleanup, "cleanup_evidence");
assert(
  cleanup?.endpoint_id_sha256 === EXPECTED.endpoint &&
    cleanup?.template_id_sha256 === EXPECTED.template &&
    cleanup?.stable_terminal_snapshot_count === 2 &&
    cleanup?.terminal_endpoint_worker_record_count === 3 &&
    cleanup?.terminal_pod_record_count === 3,
  "cleanup_identity_snapshots",
);
assert(cleanup?.endpoint_deleted === true && cleanup?.template_deleted === true && cleanup?.final_disposable_resources_absent === true, "cleanup_deleted");
assert(
  cleanup?.pods === 0 &&
    cleanup?.endpoints === 0 &&
    cleanup?.private_templates === 0 &&
    cleanup?.active_serverless_workers === 0 &&
    cleanup?.running_pods === 0,
  "zero_compute",
);
assert(cleanup?.network_volumes === 2 && cleanup?.retained_volumes?.length === 2, "retained_volume_count");
assert(cleanup.retained_volumes.every((volume) => volume.size_gb === 50 && volume.region === "EU-RO-1"), "retained_volume_shape");
assert(
  cleanup.retained_volumes.some(
    (volume) => volume.purpose === "Mage" && volume.id_sha256 === EXPECTED.volume && volume.mount === "/runpod-volume",
  ),
  "mage_volume_retained",
);
assert(
  cleanup.retained_volumes.some(
    (volume) => volume.purpose === "SoulX" && volume.id_sha256 === "sha256:2a8633e14bbecab54f52e2ae7b5b06bfa562b09a6ac781fe0985eb28e70587be",
  ),
  "soulx_volume_retained",
);

assert(
  closure.billing?.baseline_endpoint_spend_usd === 0.22078647126909345 &&
    closure.billing?.final_endpoint_spend_usd === 0.22078647126909345 &&
    closure.billing?.attempt_increment_usd_settled === 0 &&
    closure.billing?.maximum_cumulative_finite_spend_usd === 4 &&
    closure.billing?.within_approved_cap === true &&
    closure.billing?.settlement_state === "THREE_STABLE_READS" &&
    closure.billing?.reconciliation_read_count === 3 &&
    closure.billing?.reconciliation_evidence_sha256 === EXPECTED.reconciliation,
  "billing_settled",
);
assert(closure.billing?.existing_two_volume_charge_usd_per_month === 7 && closure.billing?.existing_volume_charge_outside_finite_cap === true, "retained_charge");
assert(closure.output_cleanup?.generated_output_rollback === "CONFIRMED" && closure.output_cleanup?.durable_outputs_created === 0, "output_cleanup");

assert(
  closure.raw_local_evidence?.orchestrator_sha256 === EXPECTED.orchestrator &&
    closure.raw_local_evidence?.qualification_sha256 === EXPECTED.qualification &&
    closure.raw_local_evidence?.secrets_or_signed_urls_retained === false,
  "raw_evidence",
);
assert(
  closure.authority_closure?.proposal_reusable === false &&
    closure.authority_closure?.authority_reusable === false &&
    closure.authority_closure?.fresh_proposal_required === true &&
    closure.authority_closure?.fresh_numeric_cap_required === true &&
    closure.authority_closure?.actual_spend_usd === 0 &&
    closure.authority_closure?.gpu_jobs_submitted === 1 &&
    closure.authority_closure?.closed_after_exact_cleanup === true,
  "fresh_authority_required",
);
assert(closure.qualification_boundaries?.v2_07 === "NOT_QUALIFIED" && closure.qualification_boundaries?.v2_08_authorized === false, "qualification_boundary");

assert(authority.proposal?.sha256 === EXPECTED.proposal && authority.approval?.maximum_cumulative_finite_spend_usd === 4, "authority_file_binding");
assert(authority.approval?.fresh_numeric_cap === true && authority.approval?.historical_cap_reused === false && authority.approval?.prior_authority_reused === false, "authority_fresh_cap");
assert(proposal.lineage?.control_source_commit === EXPECTED.control && proposal.lineage?.image_source_commit === EXPECTED.source, "proposal_lineage");
assert(proposal.lineage?.volume_id_sha256 === EXPECTED.volume && proposal.lineage?.model_manifest_sha256 === EXPECTED.manifest, "proposal_volume_model");
assert(max1.workers_min === 0 && max1.workers_max === 1 && max2.workers_min === 0 && max2.workers_max === 2, "staged_workers");

assert(acceptance.schema_version === "videoforge.v2-07-attempt25-startup-terminal-inventory-candidate-handoff/v1", "acceptance_schema");
assert(acceptance.attempt === 25 && acceptance.qualification_status === "NOT_QUALIFIED", "acceptance_scope");
assert(
  acceptance.result === "FAILED_POSTDISPATCH_COMPLETED_JOB_OUTPUT_FINALIZATION_UNPROVEN_EXACT_CLEANUP_RECONCILIATION_COMPLETE" &&
    acceptance.candidate?.proposal_sha256 === EXPECTED.proposal &&
    acceptance.candidate?.authority_sha256 === EXPECTED.authority &&
    acceptance.candidate?.maximum_cumulative_finite_spend_usd === null &&
    acceptance.candidate?.fresh_numeric_cap_required === true &&
    acceptance.candidate?.provider_calls_authorized === false &&
    acceptance.candidate?.provider_mutations_authorized === false &&
    acceptance.candidate?.gpu_use_authorized === false &&
    acceptance.candidate?.closure_sha256 === closureHash &&
    acceptance.provider_free_exit?.external_spend_usd === 0 &&
    acceptance.provider_free_exit?.closure_cleanup_confirmed === true &&
    acceptance.provider_free_exit?.closure_reconciliation_evidence_sha256 === EXPECTED.reconciliation,
  "acceptance_closure_binding",
);

for (const [label, value] of [
  ["state", state],
  ["gates", gates],
  ["task", task],
  ["start", start],
]) {
  assert(value.includes("failed-attempt-25.json") && value.includes(closureHash), `${label}_closure_pointer`);
  assert(value.includes(EXPECTED.proposal) && value.includes(EXPECTED.authority), `${label}_attempt25_lineage`);
  assert(value.includes("NOT_QUALIFIED") && (((value.includes("fresh exact proposal") || value.includes("fresh exact approval") || value.includes("fresh exact Attempt26 proposal")) && value.includes("fresh positive numeric cap")) || value.includes("bad94e64eab6fcbc03edf6521f02159ddb2f1c49407a6ca30dfc027fecad2d05")), `${label}_fresh_boundary`);
}

assert(
  ((state.includes("phase: serverless_v2_v2_07_attempt25_closed") || state.includes("phase: serverless_v2_v2_07_attempt26_finalize_transport_repair_candidate_ready")) &&
    state.includes("task_stage: provider_free_repair") && state.includes("maximum_external_spend_usd: 0")) ||
    (state.includes("phase: serverless_v2_v2_07_attempt26_finalize_transport_repair_authorized") && state.includes("task_stage: bounded_mutation") && state.includes("maximum_external_spend_usd: 4") && state.includes("current_authority: evidence/acceptance/VF-10-07/2026-08-21-attempt26-finalize-transport-repair-candidate/approved-authority.json")),
  "state_closed",
);
assert(
  (gates.includes("authority_mode: none_attempt25_consumed") || gates.includes("authority_mode: none_attempt26_pending_fresh_approval") || gates.includes("authority_mode: attempt26_bounded_mutation_authorized")) &&
    (gates.includes("pending_numeric_cap_usd: null") || gates.includes("pending_numeric_cap_usd: 4")) &&
    (gates.includes('result: "NOT_QUALIFIED_attempt25_closed_output_finalization_failure_exact_cleanup_complete"') ||
      gates.includes('result: "NOT_QUALIFIED_attempt26_provider_free_finalize_transport_repair_candidate_ready"') ||
      gates.includes('result: "NOT_QUALIFIED_attempt26_authorized_preexecution"')),
  "gate_closed",
);
assert(state.includes(`v2_07_attempt25_candidate_sha256: "${acceptanceHash}"`), "state_acceptance_hash");
assert(activation.includes("V207_APPROVED_FINITE_CAP_USD: number | null = null") || activation.includes("V207_APPROVED_FINITE_CAP_USD: number | null = 4"), "activation_closed");

process.stdout.write(
  `V2-07 Attempt25 closure validation PASS (${closureHash}; completed job output-finalization failure; exact cleanup; settled increment $0; fresh authority required)\n`,
);

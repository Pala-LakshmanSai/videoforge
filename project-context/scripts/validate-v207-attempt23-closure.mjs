import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const evidenceRoot = resolve(root, "project-context/evidence/acceptance/VF-10-07");
const closurePath = resolve(evidenceRoot, "2026-08-20-live-qualification/failed-attempt-23.json");
const candidate = resolve(evidenceRoot, "2026-08-21-attempt23-output-contract-diagnostic-candidate");
const paths = {
  closure: closurePath,
  authority: resolve(candidate, "approved-authority.json"),
  proposal: resolve(candidate, "combined-live-proposal.json"),
  max1: resolve(candidate, "staged-config-max1.json"),
  max2: resolve(candidate, "staged-config-max2.json"),
  state: resolve(root, "project-context/CURRENT_STATE.yaml"),
  gates: resolve(root, "project-context/GATES.yaml"),
  task: resolve(root, "project-context/tasks/VF-10-07.md"),
  start: resolve(root, "project-context/00_START_HERE.md"),
  activation: resolve(root, "apps/web/src/server/providers/v207-activation-authority.ts"),
};

const EXPECTED = {
  closure: "sha256:0f48f3bc82b6d0b7fb48e723c4a3fc36a142129de578447acd30d77157e1ca1b",
  proposal: "sha256:386dd8330f8e626d9afe8c8de8bbd1385fd9664b9fefbc472c24722105f917f9",
  authority: "sha256:c59bd74673263eeeafed828dade74fe36ae2f27ed7914d413e37bfd6722a3b35",
  max1: "sha256:45f8d447829d63517b78807ce710af7fbd81a9ff06d67cafe1a5a6bf37a15959",
  max2: "sha256:6b02604fd7a58ee98c350429663c038bbc5c93ea2e0786e64ac3a6ef3f476e8b",
  priorClosure: "sha256:43f9db51e67a39e4a837614be5af14299d91c4fbdd446b9d78ecc51260da517a",
  authorityCommit: "bd4b02f6db5539ceb123451f8d569626f6452bfa",
  control: "9f5a15c3382c03af675392dacc487b96811674ed",
  source: "79f123268b6ade640c02dd20616a89d16b43a5e6",
  image:
    "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:bc662a182b2a874c6aeffb05f65cc3ffbdff6b5130c6a75c214618e86cf208b5",
  manifest: "sha256:cebcd5c6233c2eae32f26ced7510acef8192f0d92d7ec3e9dd3ee881d66d205b",
  volume: "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619",
  model: "Comfy-Org/Mage-Flow@d8c99241f6fa80fbd453014234af2bf337ea21e6#int8-convrot",
  endpoint: "sha256:8e2979c4d7da4b018d75c0393a6c5529af2880de508382bd05bd3f01616ceb10",
  template: "sha256:e84f8cc17aeaf116cac4bca406fc51fde3d5d4592e7207d4b9433c29d9b6fefe",
  worker: "sha256:0ca150f857bbbbd63b474e220a008511805daf337ae7d0154489046e57419e53",
  orchestrator: "sha256:218c35ac7a92b2c2297e35899b0ede7e6c195a5c2e71048fa02269d861cc85c1",
  live: "sha256:8f9b70bcd52b8ba4172545bdff9516367ef142d30f1ca35449dfecf2c40f2fee",
};

const hash = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const fail = (label) => {
  throw new Error(`V207_ATTEMPT23_CLOSURE_INVALID:${label}`);
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

const [closureBytes, authorityBytes, proposalBytes, max1Bytes, max2Bytes, stateBytes, gatesBytes, taskBytes, startBytes, activationBytes] =
  await Promise.all([
    readFile(paths.closure),
    readFile(paths.authority),
    readFile(paths.proposal),
    readFile(paths.max1),
    readFile(paths.max2),
    readFile(paths.state, "utf8"),
    readFile(paths.gates, "utf8"),
    readFile(paths.task, "utf8"),
    readFile(paths.start, "utf8"),
    readFile(paths.activation, "utf8"),
  ]);

const closure = parseJson(closureBytes, "closure");
const authority = parseJson(authorityBytes, "authority");
const proposal = parseJson(proposalBytes, "proposal");
const max1 = parseJson(max1Bytes, "max1");
const max2 = parseJson(max2Bytes, "max2");
const state = stateBytes.toString("utf8");
const gates = gatesBytes.toString("utf8");
const task = taskBytes.toString("utf8");
const start = startBytes.toString("utf8");
const activation = activationBytes.toString("utf8");

for (const [label, bytes, expected] of [
  ["closure", closureBytes, EXPECTED.closure],
  ["authority", authorityBytes, EXPECTED.authority],
  ["proposal", proposalBytes, EXPECTED.proposal],
  ["max1", max1Bytes, EXPECTED.max1],
  ["max2", max2Bytes, EXPECTED.max2],
]) {
  assert(hash(bytes) === expected, `${label}_hash`);
}

assert(closure.schema_version === "videoforge.v2-07-live-failed-attempt/v1", "closure_schema");
assert(closure.checkpoint === "V2-07" && closure.task_id === "VF-10-07" && closure.attempt === 23, "closure_scope");
assert(closure.result === "FAILED_POSTDISPATCH_COMPLETED_JOB_OUTPUT_CONTRACT_UNPROVEN_EXACT_CLEANUP_COMPLETE", "closure_result");
assert(closure.authority_status === "CLOSED_EXACT_ATTEMPT_CONSUMED_DO_NOT_REUSE", "authority_closed");
assert(closure.authority_commit === EXPECTED.authorityCommit, "authority_commit");
assert(closure.authority_proposal_sha256 === EXPECTED.proposal, "closure_proposal");
assert(closure.approved_authority?.sha256 === EXPECTED.authority && closure.approved_authority?.maximum_cumulative_finite_spend_usd === 4, "closure_authority");

const lineage = closure.artifact_lineage;
assert(lineage?.model === EXPECTED.model && lineage?.model_manifest_sha256 === EXPECTED.manifest, "model_lineage");
assert(lineage?.image === EXPECTED.image && lineage?.image_source_commit === EXPECTED.source && lineage?.control_source_commit === EXPECTED.control, "image_lineage");
assert(lineage?.volume_id_sha256 === EXPECTED.volume && lineage?.volume_size_gb === 50, "volume_identity");

const failure = closure.failure;
assert(failure?.code === "V207_QUALIFICATION_FAILED" && failure?.raw_phase === "status", "failure_code");
assert(failure?.provider_job_status === "COMPLETED" && failure?.provider_delay_time_ms === 32711 && failure?.provider_execution_time_ms === 112694, "provider_status_timing");
assert(failure?.job_dispatch_reached === true && failure?.gpu_jobs_submitted === 1 && failure?.accepted_batch_count === 0 && failure?.outputs_accepted === 0, "dispatch_boundary");
assert(failure?.inference_receipt_accepted === false && failure?.measured_spend_usd === 0, "output_boundary");
assert(failure?.exact_rejected_output_contract_field === "UNPROVEN_REDACTION_SAFE_EVIDENCE_RETAINED_ONLY_GENERIC_CODE", "output_field_unproven");
assert(failure?.output_status === "UNPROVEN" && failure?.output_failure_code === "UNPROVEN" && failure?.output_shape_kind === "UNPROVEN" && failure?.output_shape_keys === "UNPROVEN", "output_diagnostics_unproven");

const cloudflare = closure.cloudflare_cleanup;
assert(cloudflare?.captured_worker_version_id_sha256 === EXPECTED.worker && cloudflare?.signer_secret_deleted === true && cloudflare?.worker_version_restored === true, "cloudflare_cleanup");
assert(cloudflare?.restored_route?.status === 404 && cloudflare?.restored_route?.code === "V207_ROUTE_DISABLED" && cloudflare?.route_restoration === "CONFIRMED_DISABLED_404_STABLE", "route_disabled");

const cleanup = closure.runpod_cleanup;
assert(cleanup?.initial_runner_cleanup === "UNCERTAIN" && cleanup?.narrow_exact_cleanup === "CONFIRMED", "cleanup_boundary");
assert(cleanup?.endpoint_id_sha256 === EXPECTED.endpoint && cleanup?.template_id_sha256 === EXPECTED.template, "cleanup_identity");
assert(cleanup?.stable_terminal_snapshot_count === 2 && cleanup?.terminal_endpoint_worker_record_count === 3 && cleanup?.terminal_pod_record_count === 3, "cleanup_snapshots");
assert(cleanup?.endpoint_deleted === true && cleanup?.template_deleted === true && cleanup?.final_disposable_resources_absent === true, "cleanup_deleted");
assert(cleanup?.pods === 0 && cleanup?.endpoints === 0 && cleanup?.private_templates === 0 && cleanup?.active_serverless_workers === 0 && cleanup?.running_pods === 0, "zero_compute");
assert(cleanup?.network_volumes === 2 && cleanup?.retained_volumes?.length === 2 && cleanup.retained_volumes.every((volume) => volume.size_gb === 50 && volume.region === "EU-RO-1"), "retained_volumes");

assert(closure.billing?.baseline_endpoint_spend_usd === 0.12480033212341368 && closure.billing?.final_endpoint_spend_usd === 0.12480033212341368, "billing_baseline_final");
assert(closure.billing?.attempt_increment_usd_settled === 0 && closure.billing?.settlement_state === "STABLE_THREE_READS" && closure.billing?.reconciliation_read_count === 3, "billing_settled");
assert(closure.billing?.maximum_cumulative_finite_spend_usd === 4 && closure.billing?.within_approved_cap === true, "billing_cap");
assert(closure.output_cleanup?.generated_output_rollback === "CONFIRMED" && closure.output_cleanup?.durable_outputs_accepted === 0, "output_cleanup");

assert(closure.raw_local_evidence?.orchestrator_sha256 === EXPECTED.orchestrator && closure.raw_local_evidence?.qualification_sha256 === EXPECTED.live, "raw_evidence_hashes");
assert(closure.authority_closure?.proposal_reusable === false && closure.authority_closure?.authority_reusable === false && closure.authority_closure?.fresh_proposal_required === true && closure.authority_closure?.fresh_numeric_cap_required === true, "fresh_authority_required");
assert(closure.qualification_boundaries?.v2_07 === "NOT_QUALIFIED" && closure.qualification_boundaries?.v2_08_authorized === false, "qualification_boundary");

const prior = proposal.lineage?.failed_attempt_evidence_sha256;
assert(prior === EXPECTED.priorClosure, "proposal_prior_closure");
assert(proposal.lineage?.control_source_commit === EXPECTED.control && proposal.lineage?.image_source_commit === EXPECTED.source, "proposal_control_lineage");
assert(max1.workers_min === 0 && max1.workers_max === 1 && max2.workers_min === 0 && max2.workers_max === 2, "staged_workers");
assert(authority.proposal?.sha256 === EXPECTED.proposal && authority.approval?.maximum_cumulative_finite_spend_usd === 4, "authority_binding");

for (const [label, value] of [
  ["state", state],
  ["gates", gates],
  ["task", task],
  ["start", start],
]) {
  assert(value.includes("failed-attempt-23.json") && value.includes(EXPECTED.closure), `${label}_closure_pointer`);
  assert(value.includes(EXPECTED.proposal) && value.includes(EXPECTED.authority), `${label}_attempt23_lineage`);
  assert(value.includes("NOT_QUALIFIED"), `${label}_not_qualified`);
}

const attempt24Authorized =
  state.includes("phase: serverless_v2_v2_07_attempt24_verification_stage_diagnostic_authorized") &&
  state.includes("provider_calls_authorized: true") &&
  state.includes("maximum_external_spend_usd: 4");

assert(
  (state.includes("phase: serverless_v2_v2_07_attempt23_closed") ||
    state.includes("phase: serverless_v2_v2_07_attempt24_verification_stage_diagnostic_pending") ||
    state.includes("phase: serverless_v2_v2_07_attempt24_closed") ||
    state.includes("phase: serverless_v2_v2_07_attempt25_startup_terminal_inventory_candidate")) &&
    state.includes("maximum_external_spend_usd: 0") ||
    attempt24Authorized,
  "state_closed",
);
assert(
  (state.includes("provider_calls_authorized: false") &&
    state.includes("provider_mutations_authorized: false") &&
    state.includes("gpu_use_authorized: false")) ||
    (attempt24Authorized && state.includes("provider_mutations_authorized: true") && state.includes("gpu_use_authorized: true")),
  "state_no_authority",
);
assert(
  (state.includes("current_authority: null") && state.includes("spend_authorized_usd: 0")) ||
    (attempt24Authorized &&
      state.includes("current_authority: evidence/acceptance/VF-10-07/2026-08-21-attempt24-verification-stage-diagnostic-candidate/approved-authority.json") &&
      state.includes("spend_authorized_usd: 4")),
  "state_current_authority_null",
);
assert(
  ((gates.includes("authority_mode: none_attempt23_consumed") ||
    gates.includes("authority_mode: none_attempt24_pending_provider_free_candidate") ||
    gates.includes("authority_mode: none_attempt24_consumed") ||
    gates.includes("authority_mode: none_attempt25_pending_fresh_approval")) &&
    gates.includes("pending_numeric_cap_usd: null") &&
    (gates.includes('result: "NOT_QUALIFIED_attempt23_closed_output_contract_unproven_exact_cleanup_complete"') ||
      gates.includes(
        'result: "NOT_QUALIFIED_attempt23_closed_output_contract_unproven_fresh_attempt24_verification_stage_diagnostic_candidate"',
      ) ||
      gates.includes('result: "NOT_QUALIFIED_attempt24_closed_quiescence_failure_exact_cleanup_complete"') ||
      gates.includes('result: "NOT_QUALIFIED_attempt25_startup_terminal_inventory_candidate_pending_fresh_approval"'))) ||
    (attempt24Authorized &&
      gates.includes("authority_mode: attempt24_bounded_mutation_authorized") &&
      gates.includes("pending_numeric_cap_usd: 4") &&
      gates.includes('result: "NOT_QUALIFIED_attempt24_authorized_pre_execution"')),
  "gate_closed",
);
assert(task.includes("Attempt 23 closure") && task.includes("fresh exact proposal and fresh positive numeric cap are required"), "task_closure");
assert(start.includes("Attempt 23 closure") && start.includes("fresh exact proposal and fresh positive numeric cap are required"), "start_closure");
assert(
  activation.includes("V207_APPROVED_FINITE_CAP_USD: number | null = null") ||
    (attempt24Authorized && activation.includes("V207_APPROVED_FINITE_CAP_USD: number | null = 4")),
  "activation_closed",
);

process.stdout.write(`V2-07 Attempt23 closure validation PASS (${EXPECTED.closure}; one COMPLETED job rejected; cleanup exact; zero settled increment; fresh authority required)\n`);

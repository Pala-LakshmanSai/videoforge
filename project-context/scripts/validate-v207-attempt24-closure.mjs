import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const evidenceRoot = resolve(root, "project-context/evidence/acceptance/VF-10-07");
const closurePath = resolve(evidenceRoot, "2026-08-21-live-qualification/failed-attempt-24.json");
const candidate = resolve(evidenceRoot, "2026-08-21-attempt24-verification-stage-diagnostic-candidate");
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
  closure: "sha256:12ca4be38d063f761537cc4184b387ae83feeaebc6e9bb102260feff6c347bcb",
  proposal: "sha256:be17430ce61a48a823a1ac87a128e83e44cfb88b01163331c285280e95274137",
  authority: "sha256:fccd60a68ee93f522d9e378012c5ccbefb182f6b03e26fde1b5940506ab9c412",
  max1: "sha256:345072150945c7dfa686c6b90b36565accd65ad5666f5c2917e160d5cf9f308a",
  max2: "sha256:173e52dde1443d61f9a678e54ff859f2709797a3f4aa818f0402772887c2be8a",
  priorClosure: "sha256:0f48f3bc82b6d0b7fb48e723c4a3fc36a142129de578447acd30d77157e1ca1b",
  authorityCommit: "4e48c5c",
  control: "63517e605d441fa23020bea8bff2987cc4bc99c5",
  source: "79f123268b6ade640c02dd20616a89d16b43a5e6",
  image:
    "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:bc662a182b2a874c6aeffb05f65cc3ffbdff6b5130c6a75c214618e86cf208b5",
  manifest: "sha256:cebcd5c6233c2eae32f26ced7510acef8192f0d92d7ec3e9dd3ee881d66d205b",
  volume: "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619",
  template: "sha256:a65e34b1c55b75eaf2e291e3b44096a5ad8d47e8dbfe8417a9fbf5b98d29db1f",
  endpoint: "sha256:24038f6a76cb82a28ae19cf01a1f19b2d35ba2e9faa10e8c7a9b2ff2573be59e",
  worker: "sha256:0ca150f857bbbbd63b474e220a008511805daf337ae7d0154489046e57419e53",
  orchestrator: "sha256:42e38123ba9a1c3f09c3cbba79f93e51dc8c34bead22ce53884a82204c7206e5",
  live: "sha256:5fb281400bee172b87a4b94717f7977e571e7261c079e19055a50202c1d540e2",
};

const hash = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const fail = (label) => {
  throw new Error(`V207_ATTEMPT24_CLOSURE_INVALID:${label}`);
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
const attempt26ClosedState = state.includes(
  "phase: serverless_v2_v2_07_attempt26_closed_finalize_response_invalid",
);
const attempt27CandidateState = state.includes(
  "phase: serverless_v2_v2_07_attempt27_hosted_png_crc32_repair_candidate_ready",
);
const attempt27AuthorizedState =
  state.includes("phase: serverless_v2_v2_07_attempt27_hosted_png_crc32_repair_authorized") &&
  state.includes("task_stage: bounded_mutation") &&
  state.includes("provider_calls_authorized: true") &&
  state.includes("maximum_external_spend_usd: 4");
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
assert(closure.checkpoint === "V2-07" && closure.task_id === "VF-10-07" && closure.attempt === 24, "closure_scope");
assert(closure.result === "FAILED_PREDISPATCH_RUNPOD_QUIESCENT_NOT_CONFIRMED_EXACT_CLEANUP_COMPLETE", "closure_result");
assert(closure.authority_status === "CLOSED_EXACT_ATTEMPT_CONSUMED_DO_NOT_REUSE", "authority_closed");
assert(closure.authority_proposal_sha256 === EXPECTED.proposal, "closure_proposal");
assert(closure.approved_authority?.sha256 === EXPECTED.authority && closure.approved_authority?.maximum_cumulative_finite_spend_usd === 4, "closure_authority");

const lineage = closure.artifact_lineage;
assert(lineage?.model === "Comfy-Org/Mage-Flow@d8c99241f6fa80fbd453014234af2bf337ea21e6#int8-convrot", "model_lineage");
assert(lineage?.image === EXPECTED.image && lineage?.image_source_commit === EXPECTED.source && lineage?.control_source_commit === EXPECTED.control, "image_lineage");
assert(lineage?.model_manifest_sha256 === EXPECTED.manifest && lineage?.volume_id_sha256 === EXPECTED.volume && lineage?.volume_size_gb === 50 && lineage?.volume_region === "EU-RO-1", "volume_lineage");
assert(lineage?.volume_mount === "/runpod-volume" && lineage?.max_one_definition_sha256 === EXPECTED.max1 && lineage?.max_two_definition_sha256 === EXPECTED.max2, "staged_lineage");
assert(lineage?.config_sha256 === "sha256:8e11a42cb91fa1d0d6a4e19fc6b4a6cfd5f77116c49a8516b6435813dfaab1de" && lineage?.layer_sha256 === "sha256:befafc2ec3d32a73b632f769069c9c02645d3fac049ebd2478fbf8ad3d5cdf38", "image_layers");

const identity = closure.provider_identity;
assert(identity?.template_id_sha256 === EXPECTED.template && identity?.endpoint_id_sha256 === EXPECTED.endpoint, "provider_identity");
assert(identity?.initial_config_hash === null && identity?.concurrent_reader_config_hash === null && identity?.initial_zero_worker_proof === true && identity?.quiescence_guard_confirmed === false, "predispatch_boundary");

const failure = closure.failure;
assert(failure?.code === "RUNPOD_QUIESCENT_NOT_CONFIRMED" && failure?.raw_phase === "initialized" && failure?.raw_result === "FAILED", "failure_code");
assert(failure?.job_dispatch_reached === false && failure?.gpu_jobs_submitted === 0 && failure?.batch_count === 0 && failure?.outputs_created === 0 && failure?.inference_completed === false, "dispatch_boundary");
assert(failure?.error_category === "quiescence" && failure?.exact_mismatched_field === "UNPROVEN" && failure?.measured_spend_usd === 0, "failure_redaction");

const cloudflare = closure.cloudflare_cleanup;
assert(cloudflare?.captured_worker_version_id_sha256 === EXPECTED.worker && cloudflare?.signer_secret_deleted === true && cloudflare?.worker_version_restored === true, "cloudflare_cleanup");
assert(cloudflare?.restored_route?.status === 404 && cloudflare?.restored_route?.code === "V207_ROUTE_DISABLED" && cloudflare?.route_restoration === "CONFIRMED_16_CONSECUTIVE_EXACT_FINGERPRINTS_OVER_30_SECONDS_WITHIN_120_SECOND_DEADLINE", "route_disabled");

const cleanup = closure.runpod_cleanup;
assert(cleanup?.initial_runner_cleanup === "UNCERTAIN" && cleanup?.narrow_exact_cleanup === "CONFIRMED", "cleanup_boundary");
assert(cleanup?.endpoint_id_sha256 === EXPECTED.endpoint && cleanup?.template_id_sha256 === EXPECTED.template, "cleanup_identity");
assert(cleanup?.stable_terminal_snapshot_count === 2 && cleanup?.terminal_endpoint_worker_record_count === 1 && cleanup?.terminal_pod_record_count === 1, "cleanup_snapshots");
assert(cleanup?.endpoint_deleted === true && cleanup?.template_deleted === true && cleanup?.final_disposable_resources_absent === true, "cleanup_deleted");
assert(cleanup?.pods === 0 && cleanup?.endpoints === 0 && cleanup?.private_templates === 0 && cleanup?.active_serverless_workers === 0 && cleanup?.running_pods === 0, "zero_compute");
assert(cleanup?.network_volumes === 2 && cleanup?.retained_volumes?.length === 2 && cleanup.retained_volumes.every((volume) => volume.size_gb === 50 && volume.region === "EU-RO-1"), "retained_volumes");
assert(cleanup.retained_volumes.some((volume) => volume.purpose === "Mage" && volume.id_sha256 === EXPECTED.volume && volume.mount === "/runpod-volume"), "mage_retained");

assert(closure.billing?.baseline_endpoint_spend_usd === 0.18311072164215147 && closure.billing?.final_endpoint_spend_usd === 0.22078647126909345, "billing_baseline_final");
assert(closure.billing?.attempt_increment_usd_settled === 0.03767574962694198 && closure.billing?.settlement_state === "STABLE_THREE_READS" && closure.billing?.reconciliation_read_count === 3, "billing_settled");
assert(closure.billing?.maximum_cumulative_finite_spend_usd === 4 && closure.billing?.within_approved_cap === true, "billing_cap");
assert(closure.output_cleanup?.generated_output_rollback === "CONFIRMED" && closure.output_cleanup?.durable_outputs_created === 0, "output_cleanup");

assert(closure.raw_local_evidence?.orchestrator_sha256 === EXPECTED.orchestrator && closure.raw_local_evidence?.qualification_sha256 === EXPECTED.live, "raw_evidence_hashes");
assert(closure.authority_closure?.proposal_reusable === false && closure.authority_closure?.authority_reusable === false && closure.authority_closure?.fresh_proposal_required === true && closure.authority_closure?.fresh_numeric_cap_required === true, "fresh_authority_required");
assert(closure.qualification_boundaries?.v2_07 === "NOT_QUALIFIED" && closure.qualification_boundaries?.v2_08_authorized === false, "qualification_boundary");

assert(proposal.lineage?.failed_attempt_evidence_sha256 === EXPECTED.priorClosure, "proposal_prior_closure");
assert(proposal.lineage?.control_source_commit === EXPECTED.control && proposal.lineage?.image_source_commit === EXPECTED.source, "proposal_control_lineage");
assert(max1.workers_min === 0 && max1.workers_max === 1 && max2.workers_min === 0 && max2.workers_max === 2, "staged_workers");
assert(authority.proposal?.sha256 === EXPECTED.proposal && authority.approval?.maximum_cumulative_finite_spend_usd === 4, "authority_binding");

for (const [label, value] of [
  ["state", state],
  ["gates", gates],
  ["task", task],
  ["start", start],
]) {
  assert(value.includes("failed-attempt-24.json") && value.includes(EXPECTED.closure), `${label}_closure_pointer`);
  assert(value.includes(EXPECTED.proposal) && value.includes(EXPECTED.authority), `${label}_attempt24_lineage`);
  assert(value.includes("NOT_QUALIFIED"), `${label}_not_qualified`);
}

assert(
  (state.includes("phase: serverless_v2_v2_07_attempt24_closed") ||
    state.includes("phase: serverless_v2_v2_07_attempt25_startup_terminal_inventory_candidate") ||
    state.includes("phase: serverless_v2_v2_07_attempt25_closed") ||
    state.includes("phase: serverless_v2_v2_07_attempt26_finalize_transport_repair_candidate_ready")) &&
    state.includes("maximum_external_spend_usd: 0") ||
    (state.includes("phase: serverless_v2_v2_07_attempt25_startup_terminal_inventory_authorized") &&
      state.includes("maximum_external_spend_usd: 4")) ||
    attempt26ClosedState ||
    attempt27CandidateState ||
    attempt27AuthorizedState,
  "state_closed",
);
assert(
  (state.includes("provider_calls_authorized: false") && state.includes("provider_mutations_authorized: false") && state.includes("gpu_use_authorized: false")) ||
    (state.includes("phase: serverless_v2_v2_07_attempt25_startup_terminal_inventory_authorized") &&
      state.includes("provider_calls_authorized: true") &&
      state.includes("provider_mutations_authorized: true") &&
      state.includes("gpu_use_authorized: true")) ||
    attempt27AuthorizedState,
  "state_no_authority",
);
assert(
  (state.includes("current_authority: null") && state.includes("spend_authorized_usd: 0")) ||
    (state.includes("current_authority: evidence/acceptance/VF-10-07/2026-08-21-attempt25-startup-terminal-inventory-candidate/approved-authority.json") &&
      state.includes("spend_authorized_usd: 4")) ||
    (attempt27AuthorizedState &&
      state.includes("current_authority: evidence/acceptance/VF-10-07/2026-08-21-attempt27-hosted-png-crc32-repair-candidate/approved-authority.json") &&
      state.includes("spend_authorized_usd: 4")),
  "state_current_authority_null",
);
assert(
    (gates.includes("authority_mode: none_attempt24_consumed") ||
    gates.includes("authority_mode: none_attempt25_pending_fresh_approval") ||
    gates.includes("authority_mode: none_attempt25_consumed") ||
    gates.includes("authority_mode: none_attempt26_pending_fresh_approval")) &&
    gates.includes("pending_numeric_cap_usd: null") &&
    (gates.includes('result: "NOT_QUALIFIED_attempt24_closed_quiescence_failure_exact_cleanup_complete"') ||
      gates.includes('result: "NOT_QUALIFIED_attempt25_startup_terminal_inventory_candidate_pending_fresh_approval"') ||
      gates.includes('result: "NOT_QUALIFIED_attempt25_closed_output_finalization_failure_exact_cleanup_complete"') ||
      gates.includes('result: "NOT_QUALIFIED_attempt26_provider_free_finalize_transport_repair_candidate_ready"')) ||
    (gates.includes("authority_mode: attempt25_bounded_mutation_authorized") &&
      gates.includes("pending_numeric_cap_usd: 4") &&
      gates.includes('result: "NOT_QUALIFIED_attempt25_authorized_pre_execution"')) ||
    attempt26ClosedGate ||
    attempt27CandidateGate ||
    attempt27AuthorizedGate,
  "gate_closed",
);
assert(task.includes("Attempt 24 closure") && task.includes("fresh exact proposal and fresh positive numeric cap are required"), "task_closure");
assert(start.includes("Attempt 24 closure") && start.includes("fresh exact proposal and fresh positive numeric cap are required"), "start_closure");
assert(
  activation.includes("V207_APPROVED_FINITE_CAP_USD: number | null = null") ||
    (state.includes("phase: serverless_v2_v2_07_attempt25_startup_terminal_inventory_authorized") &&
      activation.includes("V207_APPROVED_FINITE_CAP_USD: number | null = 4")) ||
    (attempt27AuthorizedState && activation.includes("V207_APPROVED_FINITE_CAP_USD: number | null = 4")),
  "activation_closed",
);

process.stdout.write(`V2-07 Attempt24 closure validation PASS (${EXPECTED.closure}; pre-dispatch quiescence guard stopped /run/job; exact cleanup; settled increment $0.03767574962694198; fresh authority required)\n`);

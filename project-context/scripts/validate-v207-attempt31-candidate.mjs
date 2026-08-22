import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const candidate = resolve(
  root,
  "project-context/evidence/acceptance/VF-10-07/2026-08-22-attempt31-terminal-snapshot-stabilization-candidate",
);

// The acceptance hash is intentionally a single edit point. It changes only when
// acceptance.json records later provider-free verification results.
const expected = Object.freeze({
  proposal:
    "sha256:ace01c82b5eaa9e45c177e7c41b908b1f384fe13ae6ff6bd3f8e04cf8ecb98ea",
  acceptance:
    "sha256:a5eb856de192476501c9cb86eb92641305a0f39498235b7a1cafd624d4c74a6d",
  authority:
    "sha256:02b91db639ddf6e612c7103d38f9c5c1bae3ff0072afaeebb124274db1e3eab5",
  max1:
    "sha256:29b3c4ed8d05b91cf5f7fda0b9055a95f3a553dfc65dec8a5b5540c9b7e0e006",
  max2:
    "sha256:4013c7b9887994b6de2dfd947f13ea74e622dfc0fe5b5e429c29fffedc69ef9b",
  closure:
    "sha256:9846e19ee4348e73ef880202ecff5463bd076c5b1a2bd209e2815cba0500043c",
  cleanup:
    "sha256:112f7038d162613ebdde2176a7c257de24f629fdb3914b876a6edc490f46dbb0",
  control: "f513ac807c6d5e2298092a936495e3c4fc0e6a28",
  image:
    "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:bc662a182b2a874c6aeffb05f65cc3ffbdff6b5130c6a75c214618e86cf208b5",
  imageSource: "79f123268b6ade640c02dd20616a89d16b43a5e6",
  model: "Comfy-Org/Mage-Flow@d8c99241f6fa80fbd453014234af2bf337ea21e6#int8-convrot",
  manifest:
    "sha256:cebcd5c6233c2eae32f26ced7510acef8192f0d92d7ec3e9dd3ee881d66d205b",
  volume:
    "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619",
  soulxVolume:
    "sha256:2a8633e14bbecab54f52e2ae7b5b06bfa562b09a6ac781fe0985eb28e70587be",
  imageConfig:
    "sha256:8e11a42cb91fa1d0d6a4e19fc6b4a6cfd5f77116c49a8516b6435813dfaab1de",
  imageLayer:
    "sha256:befafc2ec3d32a73b632f769069c9c02645d3fac049ebd2478fbf8ad3d5cdf38",
  imageManifest:
    "sha256:bc662a182b2a874c6aeffb05f65cc3ffbdff6b5130c6a75c214618e86cf208b5",
  imageBase:
    "sha256:8a5b8f453c694b2eeee097e3d958b08c5e47c15290b5cdc17a4fb7e5e3e4f497",
  imageParentConfig:
    "sha256:de5c854ae5aa9e611e218b89d29a250eb03a0a316f0ac92d584d53a038d06ff2",
  finalizeReplay:
    "bf26c3a86ec6a48f619c39613d425da816eeae4d",
  terminalReplay:
    "7ba8e9181fe210858c23a3ba7c5c9aca768ac24b",
  scaleZero:
    "0084f6a13fdaa5a6d4b704e32e8b6cc22cecce14",
  crc32:
    "1960ea9307bb7fcb591c842b84fc1c622aec49eb",
});

const sha256 = (bytes) => "sha256:" + createHash("sha256").update(bytes).digest("hex");
const fail = (code) => {
  throw new Error("V207_ATTEMPT31_CANDIDATE_INVALID:" + code);
};
const assert = (condition, code) => {
  if (!condition) fail(code);
};
const parse = (bytes, code) => {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    fail(code + "_JSON");
  }
};
const hasAll = (text, values) => values.every((value) => text.includes(value));
const hasAny = (text, values) => values.some((value) => text.includes(value));
const isPendingOrPass = (value) =>
  value === "PENDING" || (typeof value === "string" && /^PASS(?:_|$)/u.test(value));
const hasItem = (array, predicate) =>
  Array.isArray(array) && array.some(predicate);

const paths = Object.freeze({
  proposal: resolve(candidate, "combined-live-proposal.json"),
  acceptance: resolve(candidate, "acceptance.json"),
  max1: resolve(candidate, "staged-config-max1.json"),
  max2: resolve(candidate, "staged-config-max2.json"),
  authority: resolve(candidate, "approved-authority.json"),
  closure: resolve(
    root,
    "project-context/evidence/acceptance/VF-10-07/2026-08-21-live-qualification/failed-attempt-30.json",
  ),
  cleanup: resolve(
    root,
    "project-context/evidence/acceptance/VF-10-07/2026-08-21-live-qualification/attempt30-cleanup-observation.json",
  ),
});

const [proposalBytes, acceptanceBytes, max1Bytes, max2Bytes, authorityBytes, closureBytes, cleanupBytes] =
  await Promise.all(Object.values(paths).map((path) => readFile(path)));
const acceptanceProbe = parse(acceptanceBytes, "ACCEPTANCE");
assert(sha256(proposalBytes) === expected.proposal, "PROPOSAL_HASH");
assert(
  sha256(acceptanceBytes) === expected.acceptance ||
    acceptanceProbe.result === "APPROVED_PREEXECUTION_PROVIDER_EXECUTION_PENDING",
  "ACCEPTANCE_HASH",
);
assert(sha256(max1Bytes) === expected.max1, "MAX1_HASH");
assert(sha256(max2Bytes) === expected.max2, "MAX2_HASH");
assert(sha256(authorityBytes) === expected.authority, "AUTHORITY_HASH");
assert(sha256(closureBytes) === expected.closure, "ATTEMPT30_CLOSURE_HASH");
assert(sha256(cleanupBytes) === expected.cleanup, "ATTEMPT30_CLEANUP_HASH");

const proposal = parse(proposalBytes, "PROPOSAL");
const acceptance = acceptanceProbe;
const max1 = parse(max1Bytes, "MAX1");
const max2 = parse(max2Bytes, "MAX2");
const authority = parse(authorityBytes, "AUTHORITY");
const closure = parse(closureBytes, "CLOSURE");
const cleanup = parse(cleanupBytes, "CLEANUP");
const acceptanceIsPending =
  acceptance.result === "PROVIDER_FREE_CANDIDATE_AWAITING_FRESH_APPROVAL_AND_CAP";
const acceptanceIsApproved =
  acceptance.result === "APPROVED_PREEXECUTION_PROVIDER_EXECUTION_PENDING";

assert(
  proposal.schema_version ===
    "videoforge.v2-07-terminal-snapshot-stabilization-combined-live-proposal/v1" &&
    proposal.checkpoint === "V2-07" &&
    proposal.task_id === "VF-10-07" &&
    proposal.attempt === 31 &&
    proposal.status === "PROVIDER_FREE_CANDIDATE_PENDING_FRESH_EXACT_APPROVAL_AND_NUMERIC_CAP" &&
    proposal.provider_mutation === false &&
    proposal.publication === false &&
    proposal.gpu_use === false &&
    proposal.spend_usd === 0,
  "PROPOSAL_SCOPE",
);
assert(
  proposal.authority_mode === "PENDING_FRESH_EXACT_APPROVAL_AND_NUMERIC_CAP" &&
    proposal.user_approval?.exact_proposal_approved === false &&
    proposal.user_approval?.flashboot_true_requested === true &&
    proposal.user_approval?.fresh_numeric_cap_required === true &&
    proposal.user_approval?.maximum_cumulative_finite_spend_usd === null &&
    proposal.user_approval?.minimum_approved_availability_requested === "LOW" &&
    proposal.user_approval?.provider_mutation_or_gpu_use_authorized === false &&
    proposal.execution_boundary?.image_republication_authorized === false &&
    proposal.execution_boundary?.runpod_mutation_authorized_pending_execution === false &&
    proposal.execution_boundary?.cloudflare_mutation_authorized_pending_execution === false &&
    proposal.execution_boundary?.gpu_use_authorized_pending_execution === false &&
    proposal.execution_boundary?.provider_calls_completed === false &&
    proposal.execution_boundary?.external_spend_usd === 0 &&
    proposal.execution_boundary?.maximum_cumulative_finite_spend_usd === null &&
    proposal.execution_boundary?.v2_08_authorized === false,
  "PROPOSAL_BOUNDARY",
);

const lineage = proposal.lineage;
assert(
  lineage?.model === expected.model &&
    lineage?.model_manifest_sha256 === expected.manifest &&
    lineage?.volume_id_sha256 === expected.volume &&
    lineage?.volume_size_gb === 50 &&
    lineage?.volume_region === "EU-RO-1" &&
    lineage?.volume_mount === "/runpod-volume" &&
    lineage?.model_root === "/runpod-volume/mage-model" &&
    lineage?.volume_write_policy === "APPLICATION_READ_ONLY" &&
    lineage?.image_source_commit === expected.imageSource &&
    lineage?.control_source_commit === expected.control &&
    lineage?.image_config_sha256 === expected.imageConfig &&
    lineage?.image_layer_sha256 === expected.imageLayer &&
    lineage?.image_manifest_sha256 === expected.imageManifest &&
    lineage?.image_parent ===
      "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:8a5b8f453c694b2eeee097e3d958b08c5e47c15290b5cdc17a4fb7e5e3e4f497" &&
    lineage?.image_base_sha256 === expected.imageBase &&
    lineage?.image_parent_config_sha256 === expected.imageParentConfig &&
    lineage?.final_image === expected.image &&
    lineage?.image_publication_state ===
      "ALREADY_PUBLISHED_EXACT_DIGEST_READBACK_PASS_NO_REPUBLICATION" &&
    lineage?.failed_attempt_evidence_sha256 === expected.closure &&
    lineage?.prior_closure_evidence_sha256 === expected.closure &&
    lineage?.prior_cleanup_evidence_sha256 === expected.cleanup &&
    lineage?.prior_attempt === 30 &&
    lineage?.prior_authority_state === "CLOSED_EXACT_ATTEMPT30_CONSUMED_DO_NOT_REUSE" &&
    lineage?.terminal_snapshot_stabilization_commit === expected.control &&
    lineage?.attempt30_closure_commit === "64f0122276fbfe56dbc1302a89a69289259bec7d",
  "LINEAGE",
);
assert(
  lineage?.prior_proposal_sha256 ===
    "sha256:2cb3d2a2ab73e968da1e964018fd2c100bf9e8cc7b277e9c5739b69355896c2a" &&
    lineage?.prior_authority_sha256 ===
      "sha256:6fd4560fcba507dbae51da056d09c309fe0c93ed65e713e3526ad3aa2f978131" &&
    lineage?.finalize_replay_fast_path_commit === expected.finalizeReplay &&
    lineage?.terminal_replay_queue_fence_commit === expected.terminalReplay &&
    lineage?.post_job_terminal_scale_zero_repair_commit === expected.scaleZero &&
    lineage?.hosted_png_crc32_repair_commit === expected.crc32,
  "PRIOR_LINEAGE",
);

assert(
  proposal.rates_cost_and_retention?.serverless_flex_rtx4090_usd_per_gpu_hour === 1.1 &&
    proposal.rates_cost_and_retention?.secure_rtx4090_reference_usd_per_gpu_hour === 0.74 &&
    proposal.rates_cost_and_retention?.existing_two_volume_charge_usd_per_month_total === 7 &&
    proposal.rates_cost_and_retention?.retained_volume_charge_is_existing_and_outside_finite_cap ===
      true &&
    proposal.rates_cost_and_retention?.maximum_cumulative_finite_spend_usd === null &&
    proposal.rates_cost_and_retention?.numeric_cap_must_be_supplied_by_user === true &&
    proposal.rates_cost_and_retention?.estimated_cumulative_gpu_hours_ceiling === 2 &&
    proposal.rates_cost_and_retention?.estimated_finite_serverless_compute_usd_ceiling === 2.2 &&
    proposal.rates_cost_and_retention?.current_rtx4090_eu_ro_1_availability === "HIGH" &&
    proposal.rates_cost_and_retention?.minimum_requested_availability === "LOW" &&
    proposal.rates_cost_and_retention?.availability_requirement_satisfied === true,
  "RATES_AND_CAP",
);
const snapshot = proposal.read_only_provider_snapshot;
assert(
  snapshot?.account_identity_verified === true &&
    snapshot?.pods === 0 &&
    snapshot?.endpoints === 0 &&
    snapshot?.private_templates === 0 &&
    snapshot?.active_serverless_workers === 0 &&
    snapshot?.running_pods === 0 &&
    snapshot?.retained_volume_count === 2 &&
    snapshot?.rtx4090_region === "EU-RO-1" &&
    snapshot?.rtx4090_availability === "HIGH" &&
    snapshot?.secure_pod_reference_usd_per_hour === 0.74 &&
    snapshot?.serverless_flex_usd_per_gpu_hour === 1.1 &&
    snapshot?.provider_mutations === 0 &&
    snapshot?.gpu_jobs_submitted === 0 &&
    snapshot?.external_spend_usd === 0,
  "READ_ONLY_SNAPSHOT",
);
assert(
  hasItem(
    snapshot?.retained_volumes,
    (volume) =>
      volume.id_sha256 === expected.volume &&
      volume.size_gb === 50 &&
      volume.region === "EU-RO-1",
  ) &&
    hasItem(
      snapshot?.retained_volumes,
      (volume) =>
        volume.id_sha256 === expected.soulxVolume &&
        volume.size_gb === 50 &&
        volume.region === "EU-RO-1",
    ),
  "RETAINED_VOLUMES",
);

assert(
  proposal.terminal_replay_queue_fence?.commit === expected.terminalReplay &&
    proposal.terminal_replay_queue_fence?.exact_terminal_replay_returns_original_job_identity ===
      true &&
    proposal.terminal_replay_queue_fence?.terminal_request_key_cannot_reenter_owned_jobs === true &&
    proposal.terminal_replay_queue_fence?.second_provider_run_post_forbidden === true &&
    proposal.terminal_replay_queue_fence?.duplicate_compute === false &&
    proposal.terminal_replay_queue_fence?.changed_work_under_same_request_key_rejected === true &&
    proposal.post_job_queue_empty_fallback?.commit === expected.terminalReplay &&
    proposal.post_job_queue_empty_fallback?.owned_jobs_must_be_zero === true &&
    proposal.post_job_queue_empty_fallback?.bounded_read_only_queue_empty_reads_required === true &&
    proposal.post_job_queue_empty_fallback?.queue_read_max_attempts === 12 &&
    proposal.post_job_queue_empty_fallback?.queue_read_poll_interval_ms === 250 &&
    proposal.post_job_queue_empty_fallback?.queue_reads_bracket_two_stable_terminal_inventory_snapshots ===
      true &&
    proposal.post_job_queue_empty_fallback
      ?.queue_reads_required_before_and_after_each_inventory_snapshot === true &&
    proposal.post_job_queue_empty_fallback
      ?.queued_running_malformed_active_nonterminal_mismatched_or_unstable_state_fails_closed ===
      true,
  "REPLAY_QUEUE_FENCE",
);
assert(
  proposal.terminal_snapshot_stabilization?.repair_commit === expected.control &&
    proposal.terminal_snapshot_stabilization?.maximum_snapshot_attempts === 40 &&
    proposal.terminal_snapshot_stabilization?.poll_interval_ms === 250 &&
    proposal.terminal_snapshot_stabilization?.queue_empty_reads_bracket_each_candidate_snapshot ===
      true &&
    proposal.terminal_snapshot_stabilization?.two_consecutive_exact_signatures_required === true &&
    proposal.terminal_snapshot_stabilization?.no_reader_dispatch_before_stable_proof === true &&
    proposal.terminal_snapshot_stabilization
      ?.active_nonterminal_mismatched_malformed_or_unstable_state_fails_closed === true &&
    JSON.stringify(proposal.terminal_snapshot_stabilization?.cleanup_accepts_only_separately_approved_workers_max) ===
      JSON.stringify([1, 2]),
  "TERMINAL_STABILIZATION",
);
assert(
  proposal.finalize_replay_fast_path?.repair_commit === expected.finalizeReplay &&
    proposal.hosted_png_crc32_repair?.commit === expected.crc32 &&
    proposal.post_job_terminal_scale_zero_repair?.commit === expected.scaleZero &&
    proposal.post_job_terminal_scale_zero_repair?.terminal_replay_queue_fence_commit ===
      expected.terminalReplay &&
    proposal.post_job_terminal_scale_zero_repair?.stable_exact_inventory_snapshots_required === 2,
  "REPAIRS",
);

const requiredOperations = [
  "create_exact_private_template",
  "create_initial_flashboot_true_max_one_endpoint",
  "complete_32_image_batch_cold",
  "submit_one_complete_32_image_batch_warm",
  "submit_two_simultaneous_read_only_complete_batches",
  "apply_separately_hashed_flashboot_true_max_two_reader_configuration",
  "restore_flashboot_true_workers_max_one",
  "retain_endpoint_private_template_mage_volume_and_soulx_volume_on_success",
  "cancel_only_owned_jobs_and_delete_only_disposable_endpoint_and_private_template_if_failed",
];
assert(
  requiredOperations.every((needle) =>
    proposal.proposed_operations_in_order?.some((operation) => operation.includes(needle)),
  ),
  "OPERATIONS",
);
const requiredNegatives = [
  "wrong image bytes",
  "wrong path",
  "wrong volume",
  "wrong GPU",
  "wrong region",
  "writes",
  "cache escape",
  "malformed authority",
  "duplicate delivery",
  "cancel",
  "timeout",
  "two readers",
  "terminal request-key replay",
];
assert(
  requiredNegatives.every((needle) => proposal.negative_tests_required?.includes(needle)),
  "NEGATIVE_TESTS",
);
assert(
  proposal.forbidden?.some((item) => item.includes("model download")) &&
    proposal.forbidden?.some((item) => item.includes("volume mutation")) &&
    proposal.forbidden?.some((item) => item.includes("V2-08")),
  "FORBIDDEN_BOUNDARY",
);

for (const [label, definition, workersMax, hash] of [
  ["max1", max1, 1, expected.max1],
  ["max2", max2, 2, expected.max2],
]) {
  const gpuCount = definition.gpu_count ?? definition.gpu_count_per_worker;
  assert(
    definition.schema_version === "videoforge.v2-07-staged-endpoint-definition/v8" &&
      definition.region === "EU-RO-1" &&
      definition.image === expected.image &&
      definition.image_source_commit === expected.imageSource &&
      definition.control_source_commit === expected.control &&
      definition.network_volume_id_sha256 === expected.volume &&
      definition.network_volume_size_gb === 50 &&
      definition.network_volume_region === "EU-RO-1" &&
      definition.network_volume_mount === "/runpod-volume" &&
      definition.model_root === "/runpod-volume/mage-model" &&
      definition.volume_write_policy === "APPLICATION_READ_ONLY" &&
      definition.gpu_type_ids?.length === 1 &&
      definition.gpu_type_ids[0] === "NVIDIA GeForce RTX 4090" &&
      gpuCount === 1 &&
      definition.compute_type === "GPU" &&
      definition.flex_only === true &&
      definition.workers_min === 0 &&
      definition.workers_max === workersMax &&
      definition.scaler_type === "REQUEST_COUNT" &&
      definition.scaler_value === 1 &&
      definition.handler_concurrency === 1 &&
      definition.idle_timeout_seconds === 5 &&
      definition.init_timeout_seconds === 800 &&
      definition.execution_timeout_seconds === 2400 &&
      definition.request_authority_ttl_seconds === 7200 &&
      definition.container_disk_gb === 120 &&
      definition.flashboot === true &&
      definition.flashboot_basis === "ATTEMPT_31_TERMINAL_SNAPSHOT_STABILIZATION_EXACTLY_PINNED" &&
      JSON.stringify(definition.cuda_allowed) === JSON.stringify(["13.0"]) &&
      definition.offline_environment?.HF_HUB_OFFLINE === "1" &&
      definition.offline_environment?.TRANSFORMERS_OFFLINE === "1" &&
      definition.offline_environment?.DIFFUSERS_OFFLINE === "1" &&
      proposal.staged_endpoint_configs?.some(
        (item) => item.definition_sha256 === hash && item.workers_max === workersMax,
      ),
    label.toUpperCase() + "_CONFIG",
  );
}

assert(
  acceptance.schema_version ===
    "videoforge.v2-07-terminal-snapshot-stabilization-candidate-handoff/v1" &&
    acceptance.checkpoint === "V2-07" &&
    acceptance.task_id === "VF-10-07" &&
    acceptance.attempt === 31 &&
    (acceptanceIsPending || acceptanceIsApproved) &&
    acceptance.qualification_status === "NOT_QUALIFIED",
  "ACCEPTANCE_SCOPE",
);
assert(
  acceptance.candidate?.proposal_sha256 === expected.proposal &&
    acceptance.candidate?.max1_sha256 === expected.max1 &&
    acceptance.candidate?.max2_sha256 === expected.max2 &&
    acceptance.candidate?.control_source_commit === expected.control &&
    acceptance.candidate?.prior_attempt30_closure_sha256 === expected.closure &&
    acceptance.candidate?.prior_attempt30_cleanup_sha256 === expected.cleanup &&
    acceptance.candidate?.image === expected.image &&
    acceptance.candidate?.image_source_commit === expected.imageSource &&
    acceptance.candidate?.model === expected.model &&
    acceptance.candidate?.model_manifest_sha256 === expected.manifest &&
    acceptance.candidate?.volume_id_sha256 === expected.volume &&
    acceptance.candidate?.volume_size_gb === 50 &&
    acceptance.candidate?.volume_region === "EU-RO-1" &&
    acceptance.candidate?.volume_mount === "/runpod-volume" &&
    acceptance.candidate?.flashboot === true &&
    acceptance.candidate?.availability === "HIGH" &&
    (acceptanceIsPending
      ? acceptance.candidate?.maximum_cumulative_finite_spend_usd === null &&
        acceptance.candidate?.fresh_numeric_cap_required === true &&
        acceptance.candidate?.authority_path === null &&
        acceptance.candidate?.authority_sha256 === null &&
        acceptance.candidate?.authority_recorded === false &&
        acceptance.candidate?.provider_calls_authorized === false &&
        acceptance.candidate?.provider_mutations_authorized === false &&
        acceptance.candidate?.gpu_use_authorized === false
      : acceptance.candidate?.maximum_cumulative_finite_spend_usd === 4 &&
        acceptance.candidate?.fresh_numeric_cap_required === false &&
        acceptance.candidate?.authority_path === "approved-authority.json" &&
        acceptance.candidate?.authority_sha256 === expected.authority &&
        acceptance.candidate?.authority_recorded === true &&
        acceptance.candidate?.provider_calls_authorized === true &&
        acceptance.candidate?.provider_mutations_authorized === true &&
        acceptance.candidate?.gpu_use_authorized === true) &&
    acceptance.candidate?.image_republication_authorized === false &&
    acceptance.candidate?.model_download_or_volume_mutation_authorized === false &&
    acceptance.candidate?.v2_08_authorized === false,
  "ACCEPTANCE_CANDIDATE",
);
assert(
  acceptance.read_only_provider_snapshot?.pods === 0 &&
    acceptance.read_only_provider_snapshot?.endpoints === 0 &&
    acceptance.read_only_provider_snapshot?.private_templates === 0 &&
    acceptance.read_only_provider_snapshot?.active_serverless_workers === 0 &&
    acceptance.read_only_provider_snapshot?.running_pods === 0 &&
    acceptance.read_only_provider_snapshot?.retained_volume_count === 2 &&
    acceptance.read_only_provider_snapshot?.rtx4090_region === "EU-RO-1" &&
    acceptance.read_only_provider_snapshot?.rtx4090_availability === "HIGH" &&
    acceptance.read_only_provider_snapshot?.provider_mutations === 0 &&
    acceptance.read_only_provider_snapshot?.gpu_jobs_submitted === 0 &&
    acceptance.read_only_provider_snapshot?.external_spend_usd === 0,
  "ACCEPTANCE_SNAPSHOT",
);
assert(
  acceptance.provider_boundary?.provider_calls === false &&
    acceptance.provider_boundary?.provider_mutations === false &&
    acceptance.provider_boundary?.publication === false &&
    acceptance.provider_boundary?.gpu_use === false &&
    acceptance.provider_boundary?.external_spend_usd === 0 &&
    acceptance.provider_boundary?.retained_volume_mutation === false &&
    acceptance.provider_boundary?.v2_08_authorized === false &&
    isPendingOrPass(acceptance.local_verification?.attempt31_proposal_validator) &&
    isPendingOrPass(acceptance.local_verification?.context_validation) &&
    isPendingOrPass(acceptance.local_verification?.secret_scan) &&
    isPendingOrPass(acceptance.local_verification?.format_check) &&
    isPendingOrPass(acceptance.local_verification?.git_diff_check) &&
    acceptance.local_verification?.all_v207_validators === "PASS" &&
    acceptance.local_verification?.terminal_snapshot_stabilization_tests === "PASS_98_OF_98",
  "ACCEPTANCE_VERIFICATION",
);

assert(
  closure.schema_version === "videoforge.v2-07-failed-attempt-closure/v1" &&
    closure.checkpoint === "V2-07" &&
    closure.task_id === "VF-10-07" &&
    closure.attempt === 30 &&
    closure.result === "NOT_QUALIFIED" &&
    closure.authority_state === "CONSUMED_SINGLE_BOUNDED_EXECUTION_DO_NOT_REUSE" &&
    cleanup.attempt === 30 &&
    cleanup.result?.endpoint_deleted === true &&
    cleanup.result?.template_deleted === true &&
    cleanup.result?.final_disposable_resources_absent === true,
  "PRIOR_CLOSED_EVIDENCE",
);

const [state, gates, task, start, activation, activationTest] = await Promise.all([
  readFile(resolve(root, "project-context/CURRENT_STATE.yaml"), "utf8"),
  readFile(resolve(root, "project-context/GATES.yaml"), "utf8"),
  readFile(resolve(root, "project-context/tasks/VF-10-07.md"), "utf8"),
  readFile(resolve(root, "project-context/00_START_HERE.md"), "utf8"),
  readFile(resolve(root, "apps/web/src/server/providers/v207-activation-authority.ts"), "utf8"),
  readFile(resolve(root, "apps/web/src/server/providers/v207-activation-authority.test.ts"), "utf8"),
]);
const attempt32Closed =
  state.includes("mode: closed_consumed_attempt32_concurrent_reader_drain_failure") &&
  gates.includes("authority_mode: attempt32_consumed_closed") &&
  gates.includes("failed-attempt-32.json");
for (const [label, text] of Object.entries({ state, gates, task, start })) {
  assert(
    attempt32Closed ||
      hasAll(text, [
      expected.proposal,
      expected.max1,
      expected.max2,
      expected.control,
      expected.closure,
      expected.cleanup,
      expected.authority,
    ]),
    label.toUpperCase() + "_POINTERS",
  );
}
for (const [label, text] of Object.entries({ activation, activationTest })) {
  assert(
    hasAll(text, [expected.proposal, expected.control]) &&
      text.includes(expected.authority) &&
      text.includes("V207_APPROVED_AUTHORITY_SHA256") &&
      text.includes("V207_APPROVED_FINITE_CAP_USD"),
    label.toUpperCase() + "_POINTERS",
  );
}
const stateHead = state.split("\n").slice(0, 24).join("\n");
const stateAuthorized =
  stateHead.includes("task_stage: bounded_mutation") &&
  stateHead.includes("provider_calls_authorized: true") &&
  stateHead.includes("gpu_use_authorized: true") &&
  stateHead.includes("maximum_external_spend_usd: 4");
assert(
  stateAuthorized ||
    attempt32Closed ||
    (stateHead.includes("task_stage: provider_free") &&
      stateHead.includes("provider_calls_authorized: false") &&
      stateHead.includes("provider_mutations_authorized: false") &&
      stateHead.includes("gpu_use_authorized: false") &&
      stateHead.includes("maximum_external_spend_usd: 0")),
  "STATE_BOUNDARY",
);
const gateAuthorized =
  gates.includes("pending_numeric_cap_usd: 4") &&
  /authority_mode:\s+[^\n]*attempt31[^\n]*authorized/iu.test(gates) &&
  /provider_calls_authorized:\s+true/u.test(gates);
assert(
  gateAuthorized ||
    attempt32Closed ||
    (gates.includes("pending_numeric_cap_usd: null") &&
      /authority_mode:\s+none[^\n]*/u.test(gates)),
  "GATE_BOUNDARY",
);
assert(
  attempt32Closed ||
    (activation.includes(`"${expected.authority}"`) &&
    activation.includes("V207_APPROVED_FINITE_CAP_USD: number | null = 4") &&
    activationTest.includes("V207_APPROVED_FINITE_CAP_USD).toBe(4)")) ||
    (activation.includes("V207_APPROVED_AUTHORITY_SHA256: string | null = null") &&
      activation.includes("V207_APPROVED_FINITE_CAP_USD: number | null = null") &&
      activationTest.includes("V207_APPROVED_AUTHORITY_SHA256).toBeNull()") &&
      activationTest.includes("V207_APPROVED_FINITE_CAP_USD).toBeNull()")),
  "ACTIVATION_BOUNDARY",
);
assert(
  !state.includes("TODO_ATTEMPT31") &&
    !gates.includes("TODO_ATTEMPT31") &&
    !task.includes("TODO_ATTEMPT31") &&
    !start.includes("TODO_ATTEMPT31"),
  "NO_TODO_OR_SUCCESSOR",
);

await access(resolve(candidate, "combined-live-proposal.json"));
process.stdout.write(
  "V2-07 Attempt31 candidate validation PASS (" +
    expected.proposal +
    "; max1 " +
    expected.max1 +
    "; max2 " +
    expected.max2 +
    "; acceptance " +
    sha256(acceptanceBytes) +
    "; authority " +
    expected.authority +
    "; cap " +
    (acceptanceIsApproved ? "$4" : "pending") +
    ")\n",
);

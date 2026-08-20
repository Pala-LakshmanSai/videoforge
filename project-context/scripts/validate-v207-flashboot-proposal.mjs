import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const evidenceRoot = path.join(
  repoRoot,
  "project-context/evidence/acceptance/VF-10-07/2026-08-20-flashboot-true-requalification-candidate",
);
const files = {
  max1: path.join(evidenceRoot, "staged-config-max1.json"),
  max2: path.join(evidenceRoot, "staged-config-max2.json"),
  proposal: path.join(evidenceRoot, "combined-live-proposal.json"),
  publication: path.join(evidenceRoot, "../2026-08-20-diagnostic-endpoint-bound-candidate/image-publication.json"),
  failedAttempt: path.join(evidenceRoot, "../2026-08-20-live-qualification/failed-attempt-14.json"),
  priorAuthority: path.join(evidenceRoot, "../2026-08-20-diagnostic-endpoint-bound-candidate/approved-authority.json"),
  control: path.join(repoRoot, "apps/web/src/server/providers/runpod-control.ts"),
  harness: path.join(repoRoot, "apps/web/src/server/providers/runpod-v207-qualification-harness.ts"),
  orchestrator: path.join(repoRoot, "apps/web/src/server/providers/v207-live-orchestrator.ts"),
  activation: path.join(repoRoot, "apps/web/src/server/providers/v207-activation-authority.ts"),
  currentState: path.join(repoRoot, "project-context/CURRENT_STATE.yaml"),
  gates: path.join(repoRoot, "project-context/GATES.yaml"),
  task: path.join(repoRoot, "project-context/tasks/VF-10-07.md"),
};
const expected = {
  proposal: "sha256:a2bb603aa97661d11b29335049449b36a4ed8542e183fbb55b96c16e5461843f",
  max1: "sha256:b350c68fabebd5ada39e48e6aec0e7d04f3abd53a805c61d70f87f53ac171838",
  max2: "sha256:8a6f643fcf8f90b3f698e54623246fa9f4abe2833be9f807359a93415bb70e9e",
  publication: "sha256:0191b33d692775f0877ac07cc126c6476d51cafaf37d8b8dac26f7da629e216e",
  failedAttempt: "sha256:8cf4c4a26f919ad29b716bbe9f87fff5c7f305823a5faf08044a5e186e785765",
  priorAuthority: "sha256:afa5a4ded8eb25cd6df6105d3e3f7813e01bfa7a13cd1d7eb3d4b3ba35b1bed2",
  image:
    "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:bc662a182b2a874c6aeffb05f65cc3ffbdff6b5130c6a75c214618e86cf208b5",
  imageSource: "79f123268b6ade640c02dd20616a89d16b43a5e6",
  controlSource: "ad2e2e0ad31bc259b3010ebef8f70cf8f79d1d68",
  volume: "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619",
};
const fail = (label) => {
  throw new Error(`V207_FLASHBOOT_PROPOSAL_INVALID:${label}`);
};
const assert = (condition, label) => {
  if (!condition) fail(label);
};
const bytes = (file) => readFileSync(file);
const text = (file) => bytes(file).toString("utf8");
const json = (file) => JSON.parse(text(file));
const sha256 = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

const proposalBytes = bytes(files.proposal);
const max1Bytes = bytes(files.max1);
const max2Bytes = bytes(files.max2);
const proposal = JSON.parse(proposalBytes.toString("utf8"));
const max1 = JSON.parse(max1Bytes.toString("utf8"));
const max2 = JSON.parse(max2Bytes.toString("utf8"));

assert(sha256(proposalBytes) === expected.proposal, "proposal_bytes");
assert(sha256(max1Bytes) === expected.max1, "max1_bytes");
assert(sha256(max2Bytes) === expected.max2, "max2_bytes");
assert(sha256(bytes(files.publication)) === expected.publication, "publication_bytes");
assert(sha256(bytes(files.failedAttempt)) === expected.failedAttempt, "failed_attempt_bytes");
assert(sha256(bytes(files.priorAuthority)) === expected.priorAuthority, "prior_authority_bytes");
assert(proposal.authority_mode === "PENDING_FRESH_EXACT_APPROVAL_AND_NUMERIC_CAP", "authority_mode");
assert(proposal.user_approval?.maximum_cumulative_finite_spend_usd === null, "null_cap");
assert(proposal.user_approval?.exact_proposal_approved === false, "not_approved");
assert(proposal.lineage?.final_image === expected.image, "image");
assert(proposal.lineage?.image_source_commit === expected.imageSource, "image_source");
assert(proposal.lineage?.control_source_commit === expected.controlSource, "control_source");
assert(proposal.lineage?.volume_id_sha256 === expected.volume, "volume");
assert(proposal.lineage?.prior_authority_state.includes("DO_NOT_REUSE"), "prior_closed");
assert(proposal.staged_endpoint_configs?.length === 2, "stage_count");

for (const [index, [stage, digest, workersMax]] of [
  [max1, expected.max1, 1],
  [max2, expected.max2, 2],
].entries()) {
  const proposalStage = proposal.staged_endpoint_configs[index];
  assert(stage.flashboot === true && proposalStage.flashboot === true, `stage_${index}_flashboot`);
  assert(stage.workers_min === 0 && stage.workers_max === workersMax, `stage_${index}_workers`);
  assert(stage.region === "EU-RO-1" && stage.network_volume_region === "EU-RO-1", `stage_${index}_region`);
  assert(stage.image === expected.image && stage.image_source_commit === expected.imageSource, `stage_${index}_image`);
  assert(stage.control_source_commit === expected.controlSource, `stage_${index}_control`);
  assert(stage.network_volume_id_sha256 === expected.volume, `stage_${index}_volume`);
  assert(stage.network_volume_size_gb === 50 && stage.network_volume_mount === "/runpod-volume", `stage_${index}_mount`);
  assert(stage.model_root === "/runpod-volume/mage-model", `stage_${index}_model_root`);
  assert(stage.volume_write_policy === "APPLICATION_READ_ONLY", `stage_${index}_read_only`);
  assert(JSON.stringify(stage.gpu_type_ids) === '["NVIDIA GeForce RTX 4090"]', `stage_${index}_gpu`);
  assert((index === 0 ? stage.gpu_count : stage.gpu_count_per_worker) === 1, `stage_${index}_gpu_count`);
  assert(stage.compute_type === "GPU" && stage.flex_only === true, `stage_${index}_flex`);
  assert(stage.scaler_type === "REQUEST_COUNT" && stage.scaler_value === 1, `stage_${index}_scaler`);
  assert(stage.handler_concurrency === 1, `stage_${index}_concurrency`);
  assert(stage.idle_timeout_seconds === 5, `stage_${index}_idle`);
  assert(stage.init_timeout_seconds === 800, `stage_${index}_init`);
  assert(stage.execution_timeout_seconds === 2400, `stage_${index}_execution`);
  assert(stage.request_authority_ttl_seconds === 7200, `stage_${index}_ttl`);
  assert(
    JSON.stringify(stage.offline_environment) ===
      '{"HF_HUB_OFFLINE":"1","TRANSFORMERS_OFFLINE":"1","DIFFUSERS_OFFLINE":"1"}',
    `stage_${index}_offline`,
  );
  assert(
    stage.ephemeral_secret_values ===
      "injected_at_execution_and_excluded_from_this_public_definition",
    `stage_${index}_secret_metadata`,
  );
  assert(proposalStage.definition_sha256 === digest, `stage_${index}_hash`);
  assert(proposalStage.compute_type === "GPU" && proposalStage.flex_only === true, `proposal_stage_${index}_flex`);
  assert((index === 0 ? proposalStage.gpu_count : proposalStage.gpu_count_per_worker) === 1, `proposal_stage_${index}_gpu_count`);
}

const operations = proposal.proposed_operations_in_order ?? [];
for (const operation of [
  "create_initial_flashboot_true_max_one_endpoint_in_eu_ro_1_on_exact_mage_volume",
  "get_endpoint_and_require_exact_environment_identity_flashboot_true_and_configuration_readback",
  "submit_one_owned_diagnostic_sample_then_one_complete_32_image_batch_cold",
  "status_reconcile_until_terminal_and_verify_private_durable_outputs_before_provider_expiry",
  "exercise_scoped_duplicate_delivery_cancellation_and_timeout_contracts",
  "apply_separately_hashed_flashboot_true_max_two_reader_configuration",
  "submit_two_simultaneous_read_only_complete_batches",
  "restore_flashboot_true_workers_max_one_and_wait_for_independent_workers_zero",
  "delete_ephemeral_signer_secret_rollback_exact_worker_version_and_poll_up_to_120_seconds_for_exact_route_fingerprint",
  "retain_endpoint_private_template_mage_volume_and_soulx_volume_on_success",
  "cancel_only_owned_jobs_and_delete_only_disposable_endpoint_and_private_template_if_failed",
  "retain_both_existing_volumes_in_all_outcomes",
]) {
  assert(operations.includes(operation), `operation_${operation}`);
}
assert(proposal.forbidden?.includes("image republication or tag mutation"), "no_republication");
assert(proposal.forbidden?.includes("V2-08 or successor work"), "v208_forbidden");
assert(proposal.rates_cost_and_retention?.existing_two_volume_charge_usd_per_month_total === 7, "volume_rate");
assert(proposal.rates_cost_and_retention?.serverless_flex_rtx4090_usd_per_gpu_hour === 1.1, "serverless_rate");
assert(proposal.rates_cost_and_retention?.maximum_cumulative_finite_spend_usd === null, "rate_null_cap");

const control = text(files.control);
const harness = text(files.harness);
const orchestrator = text(files.orchestrator);
const activation = text(files.activation);
assert(control.includes("V207_RUNPOD_FLASHBOOT = true"), "control_flashboot_true");
assert(!harness.includes("FLASHBOOT_NORMALIZATION_UNCONFIRMED"), "normalization_removed");
assert(orchestrator.includes("RESTORATION_PROPAGATION_WINDOW_MS = 120_000"), "route_window");
assert(orchestrator.includes("waitForRouteRestoration"), "route_poll");
assert(activation.includes("V207_APPROVED_FINITE_CAP_USD: number | null = null"), "activation_closed");

for (const [label, file] of [
  ["current_state", files.currentState],
  ["task", files.task],
]) {
  const value = text(file);
  assert(value.includes(expected.proposal), `${label}_proposal`);
  assert(value.includes("fresh"), `${label}_fresh_authority`);
  assert(value.includes("V2-08"), `${label}_v208`);
}
assert(text(files.gates).includes(expected.proposal.slice("sha256:".length)), "gates_proposal");

process.stdout.write(
  `V2-07 FlashBoot=true proposal validation PASS (${expected.proposal}; ${expected.image})\n`,
);

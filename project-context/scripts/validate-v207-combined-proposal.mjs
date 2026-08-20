import fs from "node:fs";

const proposalPath =
  "project-context/evidence/acceptance/VF-10-07/2026-08-20-provider-free-repair-handoff/combined-live-proposal.json";
const proposal = JSON.parse(fs.readFileSync(proposalPath, "utf8"));

if (
  proposal.schema_version !== "videoforge.v2-07-combined-live-proposal/v1" ||
  proposal.authority_mode !== "PENDING_FRESH_USER_CAP" ||
  proposal.provider_mutation !== false ||
  proposal.publication !== false ||
  proposal.gpu_use !== false ||
  proposal.spend_usd !== 0 ||
  proposal.user_approval?.numeric_maximum_cumulative_finite_spend_usd !== null
) {
  throw new Error("V207_PROPOSAL_BOUNDARY_INVALID");
}

const stages = proposal.staged_endpoint_configs;
if (!Array.isArray(stages) || stages.length !== 2) {
  throw new Error("V207_PROPOSAL_STAGE_COUNT_INVALID");
}
for (const stage of stages) {
  if (
    stage.region !== "EU-RO-1" ||
    stage.volume_mount !== "/runpod-volume" ||
    stage.volume_id_sha256 !==
      "sha256:eae4e1ece86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619" ||
    stage.gpu_type_ids?.length !== 1 ||
    stage.gpu_type_ids[0] !== "NVIDIA GeForce RTX 4090" ||
    stage.gpu_count_per_worker !== 1 ||
    stage.compute_type !== "GPU" ||
    stage.workers_min !== 0 ||
    stage.scaler_type !== "REQUEST_COUNT" ||
    stage.scaler_value !== 1 ||
    stage.handler_concurrency !== 1 ||
    stage.idle_timeout_seconds !== 5 ||
    stage.init_timeout_seconds !== 800 ||
    stage.execution_timeout_seconds !== 2400 ||
    stage.request_ttl_seconds !== 7200 ||
    stage.flashboot !== false ||
    stage.cuda_minimum !== "13.0" ||
    stage.config_hash !== null
  ) {
    throw new Error("V207_PROPOSAL_STAGE_IDENTITY_INVALID");
  }
}
if (stages[0].workers_max !== 1 || stages[1].workers_max !== 2) {
  throw new Error("V207_PROPOSAL_WORKER_STAGES_INVALID");
}
const requiredOperations = new Set([
  "publish_repaired_immutable_image",
  "create_private_template",
  "create_or_update_initial_max_one_endpoint",
  "submit_owned_samples_and_complete_32_image_batch",
  "status_reconcile_until_terminal_and_verify_durable_outputs",
  "exercise_duplicate_delivery_and_cancellation",
  "apply_hashed_max_two_reader_configuration",
  "submit_two_simultaneous_read_only_reader_batches",
  "status_reconcile_readers_and_verify_manifest_unchanged",
  "scale_down_to_workers_zero_then_restore_max_one",
  "retain_endpoint_template_and_both_existing_volumes_on_success",
  "delete_only_disposable_endpoint_and_template_if_failed",
]);
if (
  !Array.isArray(proposal.qualification_operations) ||
  proposal.qualification_operations.length !== requiredOperations.size ||
  proposal.qualification_operations.some((operation) => !requiredOperations.has(operation))
) {
  throw new Error("V207_PROPOSAL_OPERATIONS_INVALID");
}

console.log("V2-07 combined proposal validation PASS");

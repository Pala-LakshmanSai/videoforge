import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const candidate = resolve(
  root,
  "project-context/evidence/acceptance/VF-10-07/2026-08-23-attempt40-item-lineage-candidate",
);
const paths = {
  proposal: resolve(candidate, "combined-live-proposal.json"),
  acceptance: resolve(candidate, "acceptance.json"),
  max1: resolve(candidate, "staged-config-max1.json"),
  max2: resolve(candidate, "staged-config-max2.json"),
  worker: resolve(root, "workers/image-media/mage_serverless.py"),
  workflow: resolve(root, ".github/workflows/mage-image.yml"),
  state: resolve(root, "project-context/CURRENT_STATE.yaml"),
  gates: resolve(root, "project-context/GATES.yaml"),
  start: resolve(root, "project-context/00_START_HERE.md"),
  task: resolve(root, "project-context/tasks/VF-10-07.md"),
};
const expected = {
  proposal: "sha256:56cd650b61a56fb17a9abd602839992990d3a985a952eafc30afa60e82e02ae8",
  acceptance: "sha256:c55e31ab998cc98627265b7447ea3dafb0671307dfe499afcafbe617ea850d48",
  max1: "sha256:391dd6b208b4b6c2e045058295f03e47937da7f9361b6bf27e7b225dbb51432e",
  max2: "sha256:fee8426ec819aa4e742fd9e36e0e16113786fd773f66e9e46f29104b78ed044e",
  image: "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:79fe7e40b69c011c15cc31b2d84b356cd2c755ea338976172cd78cc581304d59",
  manifest: "sha256:79fe7e40b69c011c15cc31b2d84b356cd2c755ea338976172cd78cc581304d59",
  config: "sha256:b6c43cb1f2782540f52ac1f2f4584fea763237f1c75c8c7c1341ea70bcc915e6",
  layer: "sha256:f31fc51513e3573eb859897b7bcacd4b28bb525567b7523af1c98e4f370c8c3a",
  diffId: "sha256:9f759e3f49c84816de71246f51f9aca275fc080c7c9c082aaa39ce81e8b049e1",
  source: "a7b7a937d08dc9032b8922cca71c602195f3094c",
  control: "b811cdfd677775558aa79452a4930b50a07b7b1a",
  handler: "sha256:3a2559dd363bdf5032b019dab3cb8fe45cba6ed4308464f860a1965cfd18f1da",
  schema: "sha256:a94bf2c8c4175eef3f84ab719118c2b9b5b501ce8b2708c28713b25521b71c71",
  base: "sha256:8a5b8f453c694b2eeee097e3d958b08c5e47c15290b5cdc17a4fb7e5e3e4f497",
  parentConfig: "sha256:de5c854ae5aa9e611e218b89d29a250eb03a0a316f0ac92d584d53a038d06ff2",
  model: "Comfy-Org/Mage-Flow@d8c99241f6fa80fbd453014234af2bf337ea21e6#int8-convrot",
  modelManifest: "sha256:cebcd5c6233c2eae32f26ced7510acef8192f0d92d7ec3e9dd3ee881d66d205b",
  volume: "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619",
};
const prior = {
  proposal: "sha256:11203e32aff804dd9f31c674cd3411c8a0efb2cdca7057e891543f30377f5e57",
  authority: "sha256:a9d68f4125f58429699fe52e90ae238b72f0835b4627f9246be86b10e759352b",
  closure: "sha256:66f067c2789c5f1a725e764ea23b07a741fee90565ac87a5e0d5f3e8522f4e12",
  cleanup: "sha256:4dde8efb506f6cbceaaf7e8b66193eda251200ff872373664ee1e14b3ba70a68",
  reconciliation: "sha256:21cc221887ca44324948983e1ad4c001760cde7a9646b4faadfab7d15a2eb813",
};
const fail = (code) => { throw new Error(`V207_ATTEMPT40_CANDIDATE_${code}`); };
const assert = (condition, code) => { if (!condition) fail(code); };
const bytes = (path) => readFileSync(path);
const text = (path) => bytes(path).toString("utf8");
const json = (path) => JSON.parse(text(path));
const sha = (path) => `sha256:${createHash("sha256").update(bytes(path)).digest("hex")}`;
const proposal = json(paths.proposal);
const acceptance = json(paths.acceptance);
const max1 = json(paths.max1);
const max2 = json(paths.max2);

for (const [name, hash] of Object.entries({
  proposal: expected.proposal,
  acceptance: expected.acceptance,
  max1: expected.max1,
  max2: expected.max2,
})) assert(sha(paths[name]) === hash, `${name.toUpperCase()}_HASH`);

assert(
  proposal.schema_version === "videoforge.v2-07-attempt40-item-lineage-combined-live-proposal/v1" &&
    proposal.checkpoint === "V2-07" && proposal.task_id === "VF-10-07" && proposal.attempt === 40 &&
    proposal.authority_mode === "PENDING_FRESH_EXACT_APPROVAL_AND_NUMERIC_CAP" &&
    proposal.provider_mutation === false && proposal.publication === false &&
    proposal.publication_required === true && proposal.gpu_use === false && proposal.spend_usd === 0,
  "SCOPE",
);
assert(
  proposal.user_approval?.exact_proposal_approved === false &&
    proposal.user_approval.flashboot_true_requested === true &&
    proposal.user_approval.minimum_approved_availability_requested === "LOW-or-better" &&
    proposal.user_approval.maximum_cumulative_finite_spend_usd === null &&
    proposal.user_approval.fresh_positive_numeric_cap_required === true &&
    proposal.user_approval.prior_authority_or_cap_reuse_forbidden === true,
  "APPROVAL_STATE",
);
assert(
  proposal.lineage?.model === expected.model && proposal.lineage.model_manifest_sha256 === expected.modelManifest &&
    proposal.lineage.volume_id_sha256 === expected.volume && proposal.lineage.volume_size_gb === 50 &&
    proposal.lineage.volume_region === "EU-RO-1" && proposal.lineage.volume_mount === "/runpod-volume" &&
    proposal.lineage.model_root === "/runpod-volume/mage-model" &&
    proposal.lineage.image_source_commit === expected.source && proposal.lineage.control_source_commit === expected.control &&
    proposal.lineage.handler_source_sha256 === expected.handler &&
    proposal.lineage.execution_subset_schema_sha256 === expected.schema &&
    proposal.lineage.image_manifest_sha256 === expected.manifest && proposal.lineage.image_config_sha256 === expected.config &&
    proposal.lineage.image_layer_sha256 === expected.layer && proposal.lineage.image_layer_diff_id === expected.diffId &&
    proposal.lineage.image_base_sha256 === expected.base && proposal.lineage.image_parent_config_sha256 === expected.parentConfig &&
    proposal.lineage.final_image === expected.image &&
    proposal.lineage.image_publication_state === "PENDING_PUBLICATION_EXACT_DIGEST_READBACK_REQUIRED",
  "LINEAGE",
);
assert(
  proposal.lineage.prior_attempt?.attempt === 39 &&
    proposal.lineage.prior_attempt.proposal_sha256 === prior.proposal &&
    proposal.lineage.prior_attempt.authority_sha256 === prior.authority &&
    proposal.lineage.prior_attempt.closure_sha256 === prior.closure &&
    proposal.lineage.prior_attempt.cleanup_sha256 === prior.cleanup &&
    proposal.lineage.prior_attempt.reconciliation_sha256 === prior.reconciliation &&
    proposal.lineage.prior_attempt.authority_consumed === true &&
    proposal.lineage.prior_attempt.qualification_status === "NOT_QUALIFIED",
  "PRIOR_ATTEMPT",
);
assert(
  proposal.staged_endpoint_configs?.[0]?.definition_sha256 === expected.max1 &&
    proposal.staged_endpoint_configs?.[1]?.definition_sha256 === expected.max2 &&
    proposal.staged_endpoint_configs[0].control_source_commit === expected.control &&
    proposal.staged_endpoint_configs[1].control_source_commit === expected.control &&
    proposal.staged_endpoint_configs[0].workers_min === 0 && proposal.staged_endpoint_configs[0].workers_max === 1 &&
    proposal.staged_endpoint_configs[1].workers_min === 0 && proposal.staged_endpoint_configs[1].workers_max === 2,
  "STAGED_HASHES",
);
assert(
  /^[0-9a-f]{40}$/u.test(proposal.lineage.image_source_commit) &&
    /^[0-9a-f]{40}$/u.test(proposal.lineage.control_source_commit) &&
    proposal.staged_endpoint_configs.every((config) =>
      /^[0-9a-f]{40}$/u.test(config.control_source_commit),
    ),
  "COMMIT_SHAPES",
);
assert(
  proposal.read_only_preflight?.checked_at === "2026-08-23T02:42:00.951Z" &&
    proposal.read_only_preflight.region === "EU-RO-1" && proposal.read_only_preflight.availability_observed === "HIGH" &&
    proposal.read_only_preflight.availability_threshold === "LOW-or-better" &&
    proposal.read_only_preflight.gpu_rate_usd_per_hour === 1.1 && proposal.read_only_preflight.secure_reference_rate_usd_per_hour === 0.74 &&
    proposal.read_only_preflight.pods === 0 && proposal.read_only_preflight.endpoints === 0 &&
    proposal.read_only_preflight.private_templates === 0 && proposal.read_only_preflight.active_workers === 0 &&
    proposal.read_only_preflight.running_pods === 0 && proposal.read_only_preflight.retained_volumes?.length === 2 &&
    proposal.read_only_preflight.read_only_refresh_required_before_mutation === true,
  "READ_ONLY_PREFLIGHT",
);
assert(
  proposal.cost_estimate?.finite_action_estimate_usd === 3.7 && proposal.cost_estimate.proposed_finite_cap_usd === null &&
    proposal.cost_estimate.current_provider_rate_usd_per_gpu_hour === 1.1 &&
    proposal.cost_estimate.secure_reference_rate_usd_per_hour === 0.74 &&
    proposal.cost_estimate.ongoing_retained_volume_charge_usd_per_month === 7 &&
    proposal.cost_estimate.ongoing_volume_charge_separate_from_finite_cap === true,
  "COST_BOUNDARY",
);
assert(
  proposal.execution_boundary?.maximum_cumulative_finite_spend_usd === null &&
    proposal.execution_boundary.provider_calls_completed === false &&
    proposal.execution_boundary.runpod_mutation_authorized_pending_execution === false &&
    proposal.execution_boundary.gpu_use_authorized_pending_execution === false &&
    proposal.execution_boundary.retained_volume_mutation_authorized === false &&
    proposal.execution_boundary.v2_08_authorized === false &&
    proposal.execution_boundary.authority_file_present === false &&
    proposal.execution_boundary.read_only_refresh_required_before_mutation === true,
  "BOUNDARY",
);
const configs = [max1, max2];
for (const [index, config] of configs.entries()) {
  const max = index + 1;
  assert(
    config.schema_version === "videoforge.v2-07-staged-endpoint-definition/v9" && config.image === expected.image &&
      config.image_source_commit === expected.source && config.control_source_commit === expected.control &&
      config.handler_source_sha256 === expected.handler && config.execution_subset_schema_sha256 === expected.schema &&
      config.region === "EU-RO-1" && config.network_volume_id_sha256 === expected.volume &&
      config.network_volume_size_gb === 50 && config.network_volume_mount === "/runpod-volume" &&
      config.model_root === "/runpod-volume/mage-model" && config.workers_min === 0 && config.workers_max === max &&
      config.gpu_type_ids?.length === 1 && config.gpu_type_ids[0] === "NVIDIA GeForce RTX 4090" &&
      config.compute_type === "GPU" && config.flex_only === true && config.flashboot === true &&
      config.availability_threshold === "LOW-or-better" && config.idle_timeout_seconds === 5 &&
      config.init_timeout_seconds === 800 && config.execution_timeout_seconds === 2400 &&
      config.request_authority_ttl_seconds === 7200,
    `CONFIG_${max}`,
  );
}
assert(
  acceptance.schema_version === "videoforge.v2-07-attempt40-item-lineage-provider-free-candidate-acceptance/v1" &&
    acceptance.attempt === 40 && acceptance.result === "PENDING_FRESH_EXACT_APPROVAL_AND_PUBLICATION" &&
    acceptance.candidate?.proposal_sha256 === expected.proposal && acceptance.candidate.max1_sha256 === expected.max1 &&
    acceptance.candidate.max2_sha256 === expected.max2 && acceptance.candidate.control_source_commit === expected.control &&
    acceptance.candidate.authority_recorded === false && acceptance.candidate.maximum_cumulative_finite_spend_usd === null &&
    acceptance.candidate.publication_required === true && acceptance.candidate.read_only_refresh_required_before_mutation === true,
  "ACCEPTANCE",
);
assert(
  acceptance.provider_boundary?.provider_calls === false && acceptance.provider_boundary.provider_mutations === false &&
    acceptance.provider_boundary.gpu_use === false && acceptance.provider_boundary.authority_active === false &&
    acceptance.provider_boundary.external_spend_usd === 0 && acceptance.provider_boundary.authority_file_present === false &&
    acceptance.provider_boundary.publication_authorized === false && acceptance.provider_boundary.v2_08_authorized === false,
  "ACCEPTANCE_BOUNDARY",
);
const worker = text(paths.worker);
assert(worker.includes('"item_id": item.scene_id') && worker.includes("Runtime metadata cannot choose the durable item identity"), "WORKER_ITEM_LINEAGE");
const workflow = text(paths.workflow);
assert(
  workflow.includes(`expected_manifest_digest="${expected.manifest}"`) &&
    workflow.includes(`expected_config_digest="${expected.config}"`) &&
    workflow.includes(`expected_layer_digest="${expected.layer}"`) &&
    workflow.includes(`expected_source_commit="${expected.source}"`) &&
    workflow.includes(`expected_handler_sha="${expected.handler.slice("sha256:".length)}"`),
  "WORKFLOW_IMAGE_BINDING",
);
for (const [name, path] of Object.entries({
  state: paths.state,
  gates: paths.gates,
  start: paths.start,
  task: paths.task,
})) {
  const surface = text(path);
  assert(surface.includes(expected.proposal), `${name.toUpperCase()}_PROPOSAL`);
  assert(surface.includes(expected.acceptance), `${name.toUpperCase()}_ACCEPTANCE`);
  assert(surface.includes(expected.max1), `${name.toUpperCase()}_MAX1`);
  assert(surface.includes(expected.max2), `${name.toUpperCase()}_MAX2`);
  assert(surface.includes(expected.image), `${name.toUpperCase()}_IMAGE`);
}
const state = text(paths.state);
const gates = text(paths.gates);
assert(state.includes("phase: serverless_v2_v2_07_attempt40_candidate_pending_exact_approval"), "STATE_PHASE");
assert(state.includes("provider_calls_authorized: false"), "STATE_PROVIDER_BOUNDARY");
assert(state.includes("gpu_use_authorized: false"), "STATE_GPU_BOUNDARY");
assert(state.includes("maximum_external_spend_usd: 0"), "STATE_SPEND_BOUNDARY");
assert(gates.includes("pending_authority: null"), "GATES_AUTHORITY_BOUNDARY");
assert(gates.includes("pending_numeric_cap_usd: null"), "GATES_CAP_BOUNDARY");
console.log("V2-07 Attempt40 item-lineage candidate validation PASS (provider-free; publication and fresh approval/cap still required; no authority or spend)");

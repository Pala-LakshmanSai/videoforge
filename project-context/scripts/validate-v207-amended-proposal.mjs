import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const candidateDir = path.join(
  repoRoot,
  "project-context/evidence/acceptance/VF-10-07/2026-08-20-inline-wire-image-candidate",
);
const currentStatePath = path.join(repoRoot, "project-context/CURRENT_STATE.yaml");
const taskPath = path.join(repoRoot, "project-context/tasks/VF-10-07.md");

const EXPECTED = {
  model: "Comfy-Org/Mage-Flow@d8c99241f6fa80fbd453014234af2bf337ea21e6#int8-convrot",
  parentImage:
    "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:8a5b8f453c694b2eeee097e3d958b08c5e47c15290b5cdc17a4fb7e5e3e4f497",
  parentConfig:
    "sha256:de5c854ae5aa9e611e218b89d29a250eb03a0a316f0ac92d584d53a038d06ff2",
  sourceCommit: "a52e7e49b8e9cb945e6c5df5412b3f08fa5fff1c",
  sourceSha256:
    "sha256:5bf88ccf9b7c14ca2247b990578bfe081dca950a30f694a90f40195f9dee0a97",
  sourcePath: "workers/image-media/mage_serverless.py",
  modelManifest:
    "sha256:cebcd5c6233c2eae32f26ced7510acef8192f0d92d7ec3e9dd3ee881d66d205b",
  volumeId:
    "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619",
  layerDiffId:
    "sha256:554ac0a35755bfec64d70707512eee81ae57af62d596fbbd49e53e4140dece8d",
  layerDigest:
    "sha256:7dc5be30ec2116ff0729b524b1e5bea5e54c38f7e86132a95518fcda0e53470e",
  configDigest:
    "sha256:38b7633f199017ea66d39cc5b10d4d5a86ae34885f9e23e20fc20ea0be90cf5e",
  manifestDigest:
    "sha256:6318edbc73b59d1a495566a765515831b3ff28302a4dc33c5e09ba52352215e3",
  proposalDigest:
    "sha256:56f82ee2c32df36e1db3693c12002b008e17b34fed1998863a0ec020be6aac55",
  candidateImage:
    "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:6318edbc73b59d1a495566a765515831b3ff28302a4dc33c5e09ba52352215e3",
  candidateTag: "v2-07-inline-wire-a52e7e4",
  region: "EU-RO-1",
  gpu: "NVIDIA GeForce RTX 4090",
};

const assert = (condition, message) => {
  if (!condition) throw new Error(`V207_AMENDED_PROPOSAL_INVALID:${message}`);
};

const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const readBytes = (filePath) => readFileSync(filePath);
const historicalSourceBytes = () =>
  execFileSync("git", ["show", `${EXPECTED.sourceCommit}:${EXPECTED.sourcePath}`], {
    cwd: repoRoot,
    encoding: null,
  });
const readJson = (filePath, label) => {
  try {
    return JSON.parse(readBytes(filePath).toString("utf8"));
  } catch (error) {
    throw new Error(`V207_AMENDED_PROPOSAL_INVALID:${label}_json`, { cause: error });
  }
};
const digest = (value, label) => {
  assert(typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value), `${label}_digest`);
  return value;
};
const commit = (value, label) => {
  assert(typeof value === "string" && /^[0-9a-f]{40}$/.test(value), `${label}_commit`);
  return value;
};

const definitionPath = path.join(candidateDir, "definition.json");
const proposalPath = path.join(candidateDir, "amended-live-proposal.json");
const authorityPath = path.join(candidateDir, "approved-authority.json");
const maxOnePath = path.join(candidateDir, "staged-config-max1.json");
const maxTwoPath = path.join(candidateDir, "staged-config-max2.json");
const definition = readJson(definitionPath, "definition");
const proposalBytes = readBytes(proposalPath);
const proposal = readJson(proposalPath, "amended_live_proposal");
const authority = readJson(authorityPath, "approved_authority");
const maxOneBytes = readBytes(maxOnePath);
const maxTwoBytes = readBytes(maxTwoPath);
const maxOne = readJson(maxOnePath, "staged_config_max1");
const maxTwo = readJson(maxTwoPath, "staged_config_max2");

assert(definition.schema_version === "videoforge.v2-07-deterministic-image-definition/v1", "definition_schema");
assert(definition.checkpoint === "V2-07" && definition.task_id === "VF-10-07", "definition_identity");
assert(definition.provider_mutation === false, "definition_provider_mutation");
assert(definition.publication === false, "definition_publication");
assert(definition.gpu_use === false && definition.external_spend_usd === 0, "definition_spend_boundary");
assert(definition.parent_image === EXPECTED.parentImage, "definition_parent_image");
assert(digest(definition.parent_config_sha256, "definition_parent_config") === EXPECTED.parentConfig, "definition_parent_config_identity");
assert(definition.source_commit === EXPECTED.sourceCommit, "definition_source_commit");
assert(definition.source_path === EXPECTED.sourcePath, "definition_source_path");
const sourceDigest = digest(definition.source_sha256, "definition_source");
assert(sourceDigest === EXPECTED.sourceSha256, "definition_source_identity");
assert(sourceDigest === sha256(historicalSourceBytes()), "definition_historical_source_hash_drift");

const overlay = definition.overlay;
assert(overlay?.destination === "/opt/videoforge/mage_serverless.py", "overlay_destination");
assert(overlay?.file_count === 1, "overlay_file_count");
const layerDiffDigest = digest(overlay.layer_diff_id, "overlay_layer_diff");
const layerDigest = digest(overlay.layer_sha256, "overlay_layer");
const configDigest = digest(overlay.config_sha256, "overlay_config");
const manifestDigest = digest(overlay.manifest_sha256, "overlay_manifest");
assert(layerDiffDigest === EXPECTED.layerDiffId, "overlay_layer_diff_identity");
assert(layerDigest === EXPECTED.layerDigest, "overlay_layer_identity");
assert(configDigest === EXPECTED.configDigest, "overlay_config_identity");
assert(manifestDigest === EXPECTED.manifestDigest, "overlay_manifest_identity");
assert(overlay.layer_size_bytes === 7495, "overlay_layer_size");
assert(overlay.config_size_bytes === 15698, "overlay_config_size");
assert(overlay.media_type === "application/vnd.docker.distribution.manifest.v2+json", "overlay_media_type");
assert(overlay.os === "linux" && overlay.architecture === "amd64", "overlay_platform");
assert(definition.candidate_image === EXPECTED.candidateImage, "definition_candidate_image");
assert(definition.candidate_tag === EXPECTED.candidateTag, "definition_candidate_tag");
assert(definition.candidate_image.endsWith(`@${manifestDigest}`), "definition_manifest_binding");
assert(definition.derivation?.publisher_default_mode === "VALIDATE_ONLY_NO_NETWORK", "publisher_default_mode");
assert(definition.derivation?.publisher_mutation_switch === "--publish", "publisher_mutation_switch");
assert(definition.derivation?.publisher_exact_manifest_readback_required === true, "publisher_readback_policy");
assert(definition.independent_reproduction?.manifest_sha256_match === true, "manifest_reproduction");
assert(definition.independent_reproduction?.config_sha256_match === true, "config_reproduction");
assert(definition.independent_reproduction?.layer_sha256_match === true, "layer_reproduction");
assert(definition.independent_reproduction?.publisher_validation_only_pass === true, "publisher_reproduction");
assert(definition.publication_state === "NOT_AUTHORIZED_NOT_PUBLISHED", "publication_state");

assert(proposal.schema_version === "videoforge.v2-07-amended-combined-live-proposal/v1", "proposal_schema");
assert(proposal.checkpoint === "V2-07" && proposal.task_id === "VF-10-07", "proposal_identity");
assert(proposal.authority_mode === "PENDING_EXACT_CHANGED_IMAGE_APPROVAL", "proposal_authority_mode");
assert(proposal.user_approval?.low_eu_ro_1_availability_approved === true, "proposal_low_availability");
assert(proposal.user_approval?.maximum_cumulative_finite_spend_usd === 4, "proposal_cap");
assert(proposal.user_approval?.cap_unchanged === true, "proposal_cap_unchanged");
assert(proposal.user_approval?.changed_image_and_repeated_operations_approved === false, "proposal_pending_approval");

const lineage = proposal.lineage;
assert(lineage?.model === EXPECTED.model, "proposal_model");
assert(digest(lineage.model_manifest_sha256, "proposal_model_manifest") === EXPECTED.modelManifest, "proposal_model_manifest_identity");
assert(lineage.volume_id_sha256 === EXPECTED.volumeId, "proposal_volume");
assert(lineage.volume_size_gb === 50 && lineage.volume_region === EXPECTED.region, "proposal_volume_identity");
assert(lineage.volume_mount === "/runpod-volume" && lineage.model_root === "/runpod-volume/mage-model", "proposal_mount");
assert(lineage.volume_write_policy === "APPLICATION_READ_ONLY", "proposal_volume_write_policy");
assert(lineage.parent_image === EXPECTED.parentImage, "proposal_parent_image");
assert(lineage.parent_config_sha256 === definition.parent_config_sha256, "proposal_parent_config");
assert(lineage.repaired_source_commit === definition.source_commit, "proposal_source_commit");
assert(lineage.repaired_source_sha256 === sourceDigest, "proposal_source_hash");
assert(lineage.image_config_sha256 === configDigest, "proposal_config_binding");
assert(lineage.image_layer_sha256 === layerDigest, "proposal_layer_binding");
assert(lineage.final_image === definition.candidate_image, "proposal_manifest_binding");
assert(lineage.publication_tag === definition.candidate_tag, "proposal_tag_binding");
assert(lineage.image_definition_evidence === "definition.json", "proposal_definition_evidence");

const stageChecks = [
  { definition: maxOne, bytes: maxOneBytes, stage: "initial_qualification", workersMax: 1, path: maxOnePath },
  { definition: maxTwo, bytes: maxTwoBytes, stage: "bounded_concurrent_reader_proof_only", workersMax: 2, path: maxTwoPath },
];
assert(Array.isArray(proposal.staged_endpoint_configs) && proposal.staged_endpoint_configs.length === 2, "proposal_stage_count");
for (const [index, stage] of proposal.staged_endpoint_configs.entries()) {
  const check = stageChecks[index];
  assert(stage.definition_path === path.basename(check.path), `stage_${index}_path`);
  assert(stage.definition_sha256 === sha256(check.bytes), `stage_${index}_hash_drift`);
  assert(stage.stage === check.definition.stage && stage.workers_max === check.workersMax, `stage_${index}_metadata`);
  assert(check.definition.region === EXPECTED.region, `stage_${index}_region`);
  assert(check.definition.image === definition.candidate_image, `stage_${index}_image`);
  assert(check.definition.image_source_commit === definition.source_commit, `stage_${index}_source`);
  assert(check.definition.network_volume_id_sha256 === EXPECTED.volumeId, `stage_${index}_volume`);
  assert(check.definition.network_volume_size_gb === 50, `stage_${index}_volume_size`);
  assert(check.definition.network_volume_mount === "/runpod-volume", `stage_${index}_mount`);
  assert(check.definition.model_root === "/runpod-volume/mage-model", `stage_${index}_model_root`);
  assert(JSON.stringify(check.definition.gpu_type_ids) === JSON.stringify([EXPECTED.gpu]), `stage_${index}_gpu`);
  assert(check.definition.gpu_count === 1, `stage_${index}_gpu_count`);
  assert(check.definition.compute_type === "GPU", `stage_${index}_compute_type`);
  assert(check.definition.workers_min === 0 && check.definition.scaler_type === "REQUEST_COUNT", `stage_${index}_scaler`);
  assert(check.definition.scaler_value === 1 && check.definition.handler_concurrency === 1, `stage_${index}_concurrency`);
  assert(check.definition.idle_timeout_seconds === 5, `stage_${index}_idle_timeout`);
  assert(check.definition.init_timeout_seconds === 800, `stage_${index}_init_timeout`);
  assert(check.definition.execution_timeout_seconds === 2400, `stage_${index}_execution_timeout`);
  assert(check.definition.request_authority_ttl_seconds === 7200, `stage_${index}_authority_ttl`);
  assert(check.definition.container_disk_gb === 120, `stage_${index}_container_disk`);
  assert(check.definition.flashboot === false, `stage_${index}_flashboot`);
  assert(check.definition.cuda_minimum === "13.0" && JSON.stringify(check.definition.cuda_allowed) === JSON.stringify(["13.0"]), `stage_${index}_cuda`);
  assert(check.definition.offline_environment?.HF_HUB_OFFLINE === "1", `stage_${index}_offline_hf`);
  assert(check.definition.offline_environment?.TRANSFORMERS_OFFLINE === "1", `stage_${index}_offline_transformers`);
  assert(check.definition.offline_environment?.DIFFUSERS_OFFLINE === "1", `stage_${index}_offline_diffusers`);
}

const currentState = readBytes(currentStatePath).toString("utf8");
const task = readBytes(taskPath).toString("utf8");
const proposalDigest = sha256(proposalBytes);
assert(proposalDigest === EXPECTED.proposalDigest, "proposal_bytes_changed");
assert(authority.schema_version === "videoforge.v2-07-amended-live-authority/v1", "authority_schema");
assert(authority.checkpoint === "V2-07" && authority.task_id === "VF-10-07", "authority_identity");
assert(authority.authority_source === "explicit_user_approval_exact_amended_proposal", "authority_source");
assert(authority.proposal?.path === "amended-live-proposal.json", "authority_proposal_path");
assert(authority.proposal?.sha256 === proposalDigest, "authority_proposal_hash_binding");
assert(authority.approval?.exact_proposal_approved === true, "authority_approval");
assert(authority.approval?.low_eu_ro_1_availability_approved === true, "authority_low_availability");
assert(authority.approval?.minimum_approved_availability === "LOW", "authority_minimum_availability");
assert(authority.approval?.maximum_cumulative_finite_spend_usd === 4, "authority_cap");
assert(authority.approval?.historical_cap_reused === false, "authority_historical_cap");
assert(authority.approval?.recurring_retained_volume_charge_usd_per_month === 7, "authority_retention_rate");
assert(authority.approval?.recurring_charge_is_outside_finite_cap === true, "authority_retention_boundary");
assert(authority.lineage?.model === EXPECTED.model, "authority_model");
assert(authority.lineage?.model_manifest_sha256 === EXPECTED.modelManifest, "authority_manifest");
assert(authority.lineage?.volume_id_sha256 === EXPECTED.volumeId, "authority_volume");
assert(authority.lineage?.volume_size_gb === 50 && authority.lineage?.volume_region === EXPECTED.region, "authority_volume_identity");
assert(authority.lineage?.volume_mount === "/runpod-volume" && authority.lineage?.model_root === "/runpod-volume/mage-model", "authority_mount");
assert(authority.lineage?.volume_write_policy === "APPLICATION_READ_ONLY", "authority_volume_write_policy");
assert(authority.lineage?.parent_image === EXPECTED.parentImage, "authority_parent_image");
assert(authority.lineage?.parent_config_sha256 === EXPECTED.parentConfig, "authority_parent_config");
assert(authority.lineage?.repaired_source_commit === EXPECTED.sourceCommit, "authority_source_commit");
assert(authority.lineage?.repaired_source_sha256 === EXPECTED.sourceSha256, "authority_source_hash");
assert(authority.lineage?.image_config_sha256 === EXPECTED.configDigest, "authority_config");
assert(authority.lineage?.image_layer_sha256 === EXPECTED.layerDigest, "authority_layer");
assert(authority.lineage?.final_image === EXPECTED.candidateImage, "authority_image");
assert(authority.lineage?.publication_tag === EXPECTED.candidateTag, "authority_tag");
assert(JSON.stringify(authority.authorized_operations) === JSON.stringify(proposal.approved_if_user_confirms_operations), "authority_operations");
assert(authority.execution_boundary?.publication_authorized_pending_execution === true, "authority_publication_boundary");
assert(authority.execution_boundary?.runpod_mutation_authorized_pending_execution === true, "authority_runpod_boundary");
assert(authority.execution_boundary?.gpu_use_authorized_pending_execution === true, "authority_gpu_boundary");
assert(authority.execution_boundary?.provider_calls_completed === false, "authority_execution_state");
assert(authority.execution_boundary?.external_spend_usd === 0, "authority_spend_state");
assert(authority.execution_boundary?.v2_08_authorized === false, "authority_successor_boundary");
assert(authority.status === "APPROVED_PREEXECUTION", "authority_status");
assert(currentState.includes(proposalDigest), "current_state_historical_proposal_pointer_missing");
assert(currentState.includes("approved-authority.json"), "current_state_authority_path_drift");
assert(task.includes(proposalDigest), "task_proposal_hash_drift");
assert(task.includes(layerDigest), "task_layer_hash_drift");

process.stdout.write(
  `V2-07 amended proposal validation PASS (${proposalDigest}; ${definition.candidate_image})\n`,
);

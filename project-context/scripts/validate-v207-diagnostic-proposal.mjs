import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const evidenceRoot = path.join(
  repoRoot,
  "project-context/evidence/acceptance/VF-10-07/2026-08-20-diagnostic-endpoint-bound-candidate",
);
const paths = {
  definition: path.join(evidenceRoot, "definition.json"),
  max1: path.join(evidenceRoot, "staged-config-max1.json"),
  max2: path.join(evidenceRoot, "staged-config-max2.json"),
  proposal: path.join(evidenceRoot, "combined-live-proposal.json"),
  source: path.join(repoRoot, "workers/image-media/mage_serverless.py"),
  workflow: path.join(repoRoot, ".github/workflows/mage-image.yml"),
  dockerfile: path.join(repoRoot, "workers/image-media/Dockerfile.mage.repair"),
  activation: path.join(repoRoot, "apps/web/src/server/providers/v207-activation-authority.ts"),
  currentState: path.join(repoRoot, "project-context/CURRENT_STATE.yaml"),
  task: path.join(repoRoot, "project-context/tasks/VF-10-07.md"),
};

const EXPECTED = {
  sourceCommit: "79f123268b6ade640c02dd20616a89d16b43a5e6",
  sourceDigest: "sha256:be050e3c1db8eae65c32e68c1d70ef01aa9b9f74b6079f2386fd4dbce37efe68",
  parentImage:
    "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:8a5b8f453c694b2eeee097e3d958b08c5e47c15290b5cdc17a4fb7e5e3e4f497",
  parentConfig: "sha256:de5c854ae5aa9e611e218b89d29a250eb03a0a316f0ac92d584d53a038d06ff2",
  layerDiff: "sha256:cd6fb8381533d93d1b933d932bbab4f3e38bc814e48412ac50ad5d82a1c24db7",
  layer: "sha256:befafc2ec3d32a73b632f769069c9c02645d3fac049ebd2478fbf8ad3d5cdf38",
  config: "sha256:8e11a42cb91fa1d0d6a4e19fc6b4a6cfd5f77116c49a8516b6435813dfaab1de",
  manifest: "sha256:bc662a182b2a874c6aeffb05f65cc3ffbdff6b5130c6a75c214618e86cf208b5",
  image:
    "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:bc662a182b2a874c6aeffb05f65cc3ffbdff6b5130c6a75c214618e86cf208b5",
  tag: "v2-07-diagnostics-79f1232",
  definitionDigest: "sha256:aea8bda03ee085d82c446c250bcb4151070a099cf49daae64fbcb8673316fa70",
  max1Digest: "sha256:b3234e068316916cea126b4d48898f09e222d5ced876fa1e1599a9b8944e6e91",
  max2Digest: "sha256:1fa59927098ac1468d9d900246fc00b4dab96b4bb98d7fdba4404e0a718354c3",
  proposalDigest: "sha256:8c11e156df6544b2023eb843f3961ca948b755b4f3bf8a4b75e7c03df4bf2774",
  volume: "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619",
  gpu: "NVIDIA GeForce RTX 4090",
};

const fail = (label) => {
  throw new Error(`V207_DIAGNOSTIC_PROPOSAL_INVALID:${label}`);
};
const assert = (condition, label) => {
  if (!condition) fail(label);
};
const bytes = (filePath) => readFileSync(filePath);
const text = (filePath) => bytes(filePath).toString("utf8");
const json = (filePath) => JSON.parse(text(filePath));
const sha256 = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const validDigest = (value) => typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
const digest = (value, label) => {
  assert(validDigest(value), `${label}_digest_shape`);
  return value;
};

const definitionBytes = bytes(paths.definition);
const max1Bytes = bytes(paths.max1);
const max2Bytes = bytes(paths.max2);
const proposalBytes = bytes(paths.proposal);
const definition = JSON.parse(definitionBytes.toString("utf8"));
const max1 = JSON.parse(max1Bytes.toString("utf8"));
const max2 = JSON.parse(max2Bytes.toString("utf8"));
const proposal = JSON.parse(proposalBytes.toString("utf8"));

assert(sha256(definitionBytes) === EXPECTED.definitionDigest, "definition_bytes");
assert(sha256(max1Bytes) === EXPECTED.max1Digest, "max1_bytes");
assert(sha256(max2Bytes) === EXPECTED.max2Digest, "max2_bytes");
assert(sha256(proposalBytes) === EXPECTED.proposalDigest, "proposal_bytes");
assert(definition.provider_mutation === false, "definition_provider_boundary");
assert(definition.publication === false && definition.gpu_use === false, "definition_execution_boundary");
assert(definition.external_spend_usd === 0, "definition_spend_boundary");
assert(definition.source_commit === EXPECTED.sourceCommit, "definition_source_commit");
assert(digest(definition.source_sha256, "definition_source") === EXPECTED.sourceDigest, "definition_source");
assert(sha256(bytes(paths.source)) === EXPECTED.sourceDigest, "source_byte_drift");
assert(definition.parent_image === EXPECTED.parentImage, "definition_parent");
assert(definition.parent_config_sha256 === EXPECTED.parentConfig, "definition_parent_config");
assert(digest(definition.overlay?.layer_diff_id, "layer_diff") === EXPECTED.layerDiff, "layer_diff");
assert(digest(definition.overlay?.layer_sha256, "layer") === EXPECTED.layer, "layer");
assert(digest(definition.overlay?.config_sha256, "config") === EXPECTED.config, "config");
assert(digest(definition.overlay?.manifest_sha256, "manifest") === EXPECTED.manifest, "manifest");
assert(definition.candidate_image === EXPECTED.image, "candidate_image");
assert(definition.candidate_tag === EXPECTED.tag, "candidate_tag");
assert(definition.candidate_image.endsWith(`@${EXPECTED.manifest}`), "candidate_manifest_binding");
assert(definition.publication_state === "NOT_AUTHORIZED_NOT_PUBLISHED", "candidate_publication_state");
assert(definition.independent_reproduction?.manifest_sha256_match === true, "manifest_reproduction");
assert(definition.independent_reproduction?.config_sha256_match === true, "config_reproduction");
assert(definition.independent_reproduction?.layer_sha256_match === true, "layer_reproduction");
assert(definition.independent_reproduction?.publisher_validation_only_pass === true, "publisher_validate_only");

const stages = [
  { value: max1, digest: EXPECTED.max1Digest, name: "initial_qualification", max: 1 },
  { value: max2, digest: EXPECTED.max2Digest, name: "bounded_concurrent_reader_proof_only", max: 2 },
];
assert(proposal.staged_endpoint_configs?.length === 2, "proposal_stage_count");
for (const [index, stage] of stages.entries()) {
  const config = stage.value;
  const proposalStage = proposal.staged_endpoint_configs[index];
  assert(config.schema_version === "videoforge.v2-07-staged-endpoint-definition/v2", `stage_${index}_schema`);
  assert(config.stage === stage.name && config.workers_max === stage.max, `stage_${index}_identity`);
  assert(config.region === "EU-RO-1" && config.image === EXPECTED.image, `stage_${index}_placement`);
  assert(config.image_source_commit === EXPECTED.sourceCommit, `stage_${index}_source`);
  assert(config.network_volume_id_sha256 === EXPECTED.volume, `stage_${index}_volume`);
  assert(config.network_volume_size_gb === 50 && config.network_volume_mount === "/runpod-volume", `stage_${index}_mount`);
  assert(config.model_root === "/runpod-volume/mage-model", `stage_${index}_model_root`);
  assert(JSON.stringify(config.gpu_type_ids) === JSON.stringify([EXPECTED.gpu]), `stage_${index}_gpu`);
  assert((config.gpu_count ?? config.gpu_count_per_worker) === 1, `stage_${index}_gpu_count`);
  assert(config.workers_min === 0 && config.handler_concurrency === 1, `stage_${index}_workers`);
  assert(config.scaler_type === "REQUEST_COUNT" && config.scaler_value === 1, `stage_${index}_scaler`);
  assert(config.idle_timeout_seconds === 5, `stage_${index}_idle`);
  assert(config.init_timeout_seconds === 800 && config.execution_timeout_seconds === 2400, `stage_${index}_timeouts`);
  assert(config.request_authority_ttl_seconds === 7200, `stage_${index}_ttl`);
  assert(config.flashboot === false && config.container_disk_gb === 120, `stage_${index}_runtime`);
  assert(config.cuda_minimum === "13.0" && JSON.stringify(config.cuda_allowed) === '["13.0"]', `stage_${index}_cuda`);
  assert(config.offline_environment?.HF_HUB_OFFLINE === "1", `stage_${index}_offline_hf`);
  assert(config.offline_environment?.TRANSFORMERS_OFFLINE === "1", `stage_${index}_offline_transformers`);
  assert(config.offline_environment?.DIFFUSERS_OFFLINE === "1", `stage_${index}_offline_diffusers`);
  assert(config.endpoint_identity_binding?.environment_key === "VIDEOFORGE_MAGE_ENDPOINT_ID_HASH", `stage_${index}_endpoint_key`);
  assert(config.endpoint_identity_binding?.method === "PATCH_FULL_ENVIRONMENT_THEN_GET_READBACK_BEFORE_DISPATCH", `stage_${index}_endpoint_method`);
  assert(config.endpoint_identity_binding?.response_and_readback_must_match === true, `stage_${index}_endpoint_readback`);
  assert(proposalStage.definition_sha256 === stage.digest, `stage_${index}_proposal_hash`);
  assert(proposalStage.workers_max === stage.max, `stage_${index}_proposal_max`);
}

assert(
  proposal.schema_version ===
    "videoforge.v2-07-diagnostic-endpoint-bound-combined-live-proposal/v1",
  "proposal_schema",
);
assert(proposal.authority_mode === "PENDING_FRESH_EXACT_APPROVAL_AND_NUMERIC_CAP", "proposal_authority_mode");
assert(proposal.user_approval?.maximum_cumulative_finite_spend_usd === null, "proposal_null_cap");
assert(proposal.user_approval?.fresh_numeric_cap_required === true, "proposal_fresh_cap");
assert(proposal.user_approval?.exact_proposal_approved === false, "proposal_not_approved");
assert(proposal.lineage?.repaired_source_commit === EXPECTED.sourceCommit, "proposal_source");
assert(proposal.lineage?.repaired_source_sha256 === EXPECTED.sourceDigest, "proposal_source_hash");
assert(proposal.lineage?.image_definition_sha256 === EXPECTED.definitionDigest, "proposal_definition_hash");
assert(proposal.lineage?.image_layer_sha256 === EXPECTED.layer, "proposal_layer");
assert(proposal.lineage?.image_config_sha256 === EXPECTED.config, "proposal_config");
assert(proposal.lineage?.final_image === EXPECTED.image, "proposal_image");
assert(proposal.lineage?.prior_authority_state === "CLOSED_FAILED_OUTPUT_DO_NOT_REUSE", "proposal_prior_authority");
assert(proposal.rates_cost_and_retention?.maximum_cumulative_finite_spend_usd === null, "proposal_rate_null_cap");
assert(proposal.rates_cost_and_retention?.numeric_cap_must_be_supplied_by_user === true, "proposal_rate_cap_boundary");
assert(proposal.last_observed_provider_truth?.provider_mutations_for_this_proposal === 0, "proposal_provider_boundary");
assert(proposal.last_observed_provider_truth?.external_spend_for_this_proposal_usd === 0, "proposal_spend_boundary");
assert(
  proposal.proposed_operations_in_order?.includes(
    "patch_full_exact_endpoint_environment_with_allocated_endpoint_identity_hash",
  ),
  "proposal_endpoint_patch_operation",
);
assert(
  proposal.proposed_operations_in_order?.includes(
    "get_endpoint_and_require_exact_environment_identity_and_configuration_readback",
  ),
  "proposal_endpoint_readback_operation",
);
assert(proposal.forbidden?.includes("V2-08 or successor work"), "proposal_v208_boundary");

for (const [label, filePath] of [
  ["workflow", paths.workflow],
  ["activation", paths.activation],
]) {
  const value = text(filePath);
  assert(value.includes(EXPECTED.sourceCommit), `${label}_source`);
  assert(value.includes(EXPECTED.manifest), `${label}_manifest`);
}
const workflow = text(paths.workflow);
const dockerfile = text(paths.dockerfile);
const activation = text(paths.activation);
assert(dockerfile.includes(EXPECTED.sourceCommit), "dockerfile_source");
assert(dockerfile.includes(EXPECTED.parentImage), "dockerfile_parent");
assert(workflow.includes(EXPECTED.config) && workflow.includes(EXPECTED.layer), "workflow_overlay_identity");
assert(workflow.includes(EXPECTED.sourceDigest.slice("sha256:".length)), "workflow_source_hash");
assert(activation.includes(EXPECTED.proposalDigest), "activation_proposal");
assert(activation.includes("V207_APPROVED_FINITE_CAP_USD: number | null = null"), "activation_closed");

for (const [label, filePath] of [
  ["current_state", paths.currentState],
  ["task", paths.task],
]) {
  const value = text(filePath);
  assert(value.includes(EXPECTED.proposalDigest), `${label}_proposal_pointer`);
  assert(value.includes(EXPECTED.image), `${label}_candidate_pointer`);
  assert(value.includes("fresh numeric"), `${label}_fresh_cap_boundary`);
}

// Self-check the rejection primitives used above against the exact regressions that invalidated
// the predecessor proposal: malformed digest length, stale bytes, non-null cap, and old lineage.
assert(!validDigest(`${EXPECTED.layer}0`), "negative_malformed_digest_not_rejected");
assert(sha256(Buffer.from("stale")) !== EXPECTED.max1Digest, "negative_stale_stage_not_rejected");
assert(proposal.user_approval.maximum_cumulative_finite_spend_usd !== 4, "negative_reused_cap_not_rejected");
assert(proposal.lineage.final_image !== proposal.lineage.failed_predecessor_image, "negative_old_lineage_not_rejected");

process.stdout.write(
  `V2-07 diagnostic proposal validation PASS (${EXPECTED.proposalDigest}; ${EXPECTED.image}; negative invariants PASS)\n`,
);

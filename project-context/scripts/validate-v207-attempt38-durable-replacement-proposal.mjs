import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const candidateDir = resolve(root, "project-context/evidence/acceptance/VF-10-07/2026-08-23-attempt38-durable-replacement-candidate");
const proposalPath = resolve(candidateDir, "combined-live-proposal.json");
const acceptancePath = resolve(candidateDir, "acceptance.json");
const authorityPath = resolve(candidateDir, "approved-authority.json");
const max1Path = resolve(candidateDir, "staged-config-max1.json");
const max2Path = resolve(candidateDir, "staged-config-max2.json");
const expected = {
  proposal: "sha256:8613f60fb65a3d7c254daeb42901b217d392566bef11dfaa864d7cbbe000378c",
  acceptance: "sha256:ece14904625e051064d486b26c8e2e1399f2ff28616fffb20ca304579553841a",
  authority: "sha256:1933bf186c235089c13edfee0e68a28b2fa0ab2ebc89a25f81bb59a7eedd92b6",
  max1: "sha256:a61c41148a80e9371934c1eaf7fdee76ab821cbbe6cff371a55dcfbd70493436",
  max2: "sha256:13f17498808fd6062b0dbac187eaa82d836580b673d9e666cc3dae0a64480f01",
  control: "edb18154759a1c4da9f28789fe5f4c4ab74a92ed",
  source: "4249cafd4a5525b5723d0811f16496fb0e949653",
  handler: "sha256:dfc2cebede44c0a8903daf0e6348040cd6e2b5af1a00c77d3f767ddb10aa316c",
  schema: "sha256:a94bf2c8c4175eef3f84ab719118c2b9b5b501ce8b2708c28713b25521b71c71",
  image: "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:d37242d8413b1a5e52c2434b0ff12a04093ec5fdfacaed72faeb86fa2cbc67f2",
  imageManifest: "sha256:d37242d8413b1a5e52c2434b0ff12a04093ec5fdfacaed72faeb86fa2cbc67f2",
  imageConfig: "sha256:09d2ee0905ec4556857aae9df05b449802916cdf9e0d8ec4615a91b6d1fa9d06",
  imageLayer: "sha256:1b390600563d813a87e09c2fa075d52ea1c24558e83b67c5649aa422a2c69c78",
  imageDiffId: "sha256:0391cef74dd661df3c2c7b8b4fea1b391063abea0cfc004c806078a004915163",
  base: "sha256:8a5b8f453c694b2eeee097e3d958b08c5e47c15290b5cdc17a4fb7e5e3e4f497",
  parentConfig: "sha256:de5c854ae5aa9e611e218b89d29a250eb03a0a316f0ac92d584d53a038d06ff2",
  volume: "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619",
};
const fail = (code) => { throw new Error(`V207_ATTEMPT38_CANDIDATE_${code}`); };
const assert = (condition, code) => { if (!condition) fail(code); };
const bytes = (path) => readFileSync(path);
const text = (path) => String(bytes(path));
const json = (path) => JSON.parse(text(path));
const sha = (path) => `sha256:${createHash("sha256").update(bytes(path)).digest("hex")}`;
const proposal = json(proposalPath);
const acceptance = json(acceptancePath);
const authority = json(authorityPath);
const max1 = json(max1Path);
const max2 = json(max2Path);

assert(sha(proposalPath) === expected.proposal, "PROPOSAL_HASH");
assert(sha(acceptancePath) === expected.acceptance, "ACCEPTANCE_HASH");
assert(sha(authorityPath) === expected.authority, "AUTHORITY_HASH");
assert(sha(max1Path) === expected.max1, "MAX1_HASH");
assert(sha(max2Path) === expected.max2, "MAX2_HASH");
assert(proposal.attempt === 38 && proposal.checkpoint === "V2-07" && proposal.task_id === "VF-10-07", "SCOPE");
assert(proposal.authority_mode === "PENDING_FRESH_EXACT_APPROVAL_AND_NUMERIC_CAP", "AUTHORITY_MODE");
assert(proposal.execution_boundary?.maximum_cumulative_finite_spend_usd === null, "CAP_NOT_NULL");
assert(proposal.execution_boundary?.provider_calls_completed === false && proposal.execution_boundary?.runpod_mutation_authorized_pending_execution === false && proposal.execution_boundary?.gpu_use_authorized_pending_execution === false, "PROVIDER_BOUNDARY");
assert(proposal.execution_boundary?.retained_volume_mutation_authorized === false && proposal.execution_boundary?.v2_08_authorized === false, "SCOPE_BOUNDARY");
assert(proposal.user_approval?.exact_proposal_approved === false && proposal.user_approval?.prior_authority_or_cap_reuse_forbidden === true, "APPROVAL_STATE");

const lineage = proposal.lineage;
assert(lineage?.control_source_commit === expected.control && lineage?.image_source_commit === expected.source && lineage?.handler_source_sha256 === expected.handler && lineage?.execution_subset_schema_sha256 === expected.schema, "SOURCE_LINEAGE");
assert(lineage?.final_image === expected.image && lineage?.image_manifest_sha256 === expected.imageManifest && lineage?.image_config_sha256 === expected.imageConfig && lineage?.image_layer_sha256 === expected.imageLayer && lineage?.image_layer_diff_id === expected.imageDiffId && lineage?.image_base_sha256 === expected.base && lineage?.image_parent_config_sha256 === expected.parentConfig, "IMAGE_LINEAGE");
assert(lineage?.model_root === "/runpod-volume/mage-model" && lineage?.volume_mount === "/runpod-volume" && lineage?.volume_region === "EU-RO-1" && lineage?.volume_size_gb === 50 && lineage?.volume_id_sha256 === expected.volume && lineage?.volume_write_policy === "APPLICATION_READ_ONLY", "VOLUME_LINEAGE");
assert(lineage?.runtime_execution_contract?.runtime_download_or_quantization === false && lineage?.runtime_execution_contract?.cache_escape_forbidden === true && lineage?.runtime_execution_contract?.real_initialization_warmup_required === true, "RUNTIME_CONTRACT");

const ids = Array.from({ length: 32 }, (_, index) => `scene-${String(index + 1).padStart(2, "0")}`);
assert(JSON.stringify(proposal.execution_plan?.item_ids) === JSON.stringify(ids), "FULL_PLAN");
assert(JSON.stringify(proposal.execution_plan?.seed?.item_ids) === JSON.stringify([ids[0]]) && proposal.execution_plan?.seed?.exact_dispatch_count === 1 && proposal.execution_plan?.seed?.terminal_scale_zero_required_before_replacement === true, "SEED_PLAN");
assert(JSON.stringify(proposal.execution_plan?.replacement?.item_ids) === JSON.stringify(ids.slice(1)) && proposal.execution_plan?.replacement?.exact_dispatch_count === 1 && proposal.execution_plan?.replacement?.distinct_process_required === true && proposal.execution_plan?.replacement?.unresolved_only === true && proposal.execution_plan?.replacement?.accepted_units_never_regenerated === true, "REPLACEMENT_PLAN");
assert(proposal.execution_plan?.merge?.requires_exact_32_unique_items === true && proposal.execution_plan?.merge?.requires_plan_order === true && proposal.execution_plan?.merge?.requires_durable_readbacks_and_v3_receipts === true, "MERGE_PLAN");
assert(proposal.qualification_runs?.probe_composition?.includes("no additional probe dispatch") && proposal.qualification_runs?.cold_and_warm === true && proposal.qualification_runs?.duplicate_delivery_same_job_no_second_run === true && proposal.qualification_runs?.two_simultaneous_read_only_workers?.uses_max2_only === true, "QUALIFICATION_PLAN");
assert(proposal.approved_operations_to_be_proposed_once?.[0]?.includes("mage-image.yml") && proposal.approved_operations_to_be_proposed_once?.[0]?.includes("publish=true") && proposal.approved_operations_to_be_proposed_once?.some((value) => value.includes("without any extra probe dispatch")) && proposal.approved_operations_to_be_proposed_once?.at(-1) === "stop before V2-08", "EXACT_OPERATIONS");
assert(proposal.read_only_preflight?.checked_at === "2026-08-23T00:13:52.501Z" && proposal.read_only_preflight?.availability_observed === "HIGH" && proposal.read_only_preflight?.availability_threshold === "LOW-or-better" && proposal.read_only_preflight?.pods === 0 && proposal.read_only_preflight?.endpoints === 0 && proposal.read_only_preflight?.private_templates === 0 && proposal.read_only_preflight?.active_workers === 0 && proposal.read_only_preflight?.running_pods === 0 && proposal.read_only_preflight?.retained_volumes?.length === 2, "FRESH_PREFLIGHT");
assert(proposal.cost_estimate?.finite_action_estimate_usd === 3.7 && proposal.cost_estimate?.proposed_finite_cap_usd === null && proposal.cost_estimate?.current_provider_rate_usd_per_gpu_hour === 1.1 && proposal.cost_estimate?.secure_reference_rate_usd_per_hour === 0.74 && proposal.cost_estimate?.ongoing_retained_volume_charge_usd_per_month === 7 && proposal.cost_estimate?.ongoing_volume_charge_separate_from_finite_cap === true, "COST_BOUNDARY");
assert(proposal.official_rate_sources?.serverless_pricing === "https://docs.runpod.io/serverless/pricing" && proposal.official_rate_sources?.gpu_pricing === "https://www.runpod.io/pricing" && proposal.official_rate_sources?.network_volume_pricing === "https://docs.runpod.io/storage/network-volumes", "RATE_SOURCES");

const validateConfig = (config, workersMax, code) => {
  assert(config.image === expected.image && config.image_source_commit === expected.source && config.control_source_commit === expected.control && config.handler_source_sha256 === expected.handler && config.execution_subset_schema_sha256 === expected.schema, `${code}_LINEAGE`);
  assert(config.network_volume_id_sha256 === expected.volume && config.network_volume_size_gb === 50 && config.network_volume_region === "EU-RO-1" && config.network_volume_mount === "/runpod-volume" && config.model_root === "/runpod-volume/mage-model" && config.volume_write_policy === "APPLICATION_READ_ONLY", `${code}_VOLUME`);
  assert(config.region === "EU-RO-1" && config.compute_type === "GPU" && config.flex_only === true && config.flashboot === true && config.workers_min === 0 && config.workers_max === workersMax && (config.gpu_count ?? config.gpu_count_per_worker) === 1 && config.gpu_type_ids?.[0] === "NVIDIA GeForce RTX 4090", `${code}_IDENTITY`);
  assert(config.scaler_type === "REQUEST_COUNT" && config.scaler_value === 1 && config.handler_concurrency === 1 && config.idle_timeout_seconds === 5 && config.init_timeout_seconds === 800 && config.execution_timeout_seconds === 2400 && config.request_authority_ttl_seconds === 7200 && config.container_disk_gb === 120, `${code}_MEASURED_POLICY`);
  assert(config.runtime_execution_contract?.durable_per_unit_resume === "RETRY_ONLY_UNRESOLVED_UNACCEPTED_UNITS_NEVER_REGENERATE_ACCEPTED_UNITS" && config.timing_scaler_contract?.queue_timing_source === "RUNPOD_DELAY_TIME_MS" && config.timing_scaler_contract?.execution_timing_source === "RUNPOD_EXECUTION_TIME_MS", `${code}_CONTRACT`);
};
validateConfig(max1, 1, "MAX1");
validateConfig(max2, 2, "MAX2");
assert(proposal.staged_endpoint_configs?.[0]?.definition_sha256 === expected.max1 && proposal.staged_endpoint_configs?.[1]?.definition_sha256 === expected.max2, "STAGED_HASH_BINDING");

assert(acceptance.attempt === 38 && acceptance.result === "APPROVED_SINGLE_USE_PENDING_EXECUTION" && acceptance.qualification_status === "NOT_QUALIFIED_PENDING_EXECUTION", "ACCEPTANCE_STATE");
assert(acceptance.candidate?.proposal_sha256 === expected.proposal && acceptance.candidate?.max1_sha256 === expected.max1 && acceptance.candidate?.max2_sha256 === expected.max2 && acceptance.candidate?.authority_recorded === true && acceptance.candidate?.authority_path === "approved-authority.json" && acceptance.candidate?.authority_sha256 === expected.authority && acceptance.candidate?.maximum_cumulative_finite_spend_usd === 4, "ACCEPTANCE_BINDING");
assert(acceptance.provider_boundary?.provider_calls === true && acceptance.provider_boundary?.provider_mutations === true && acceptance.provider_boundary?.gpu_use === true && acceptance.provider_boundary?.authority_active === true && acceptance.provider_boundary?.cap_usd === 4 && acceptance.provider_boundary?.external_spend_usd === 0 && acceptance.provider_boundary?.v2_08_authorized === false, "ACCEPTANCE_BOUNDARY");
assert(acceptance.plan?.total_units === 32 && JSON.stringify(acceptance.plan?.item_ids) === JSON.stringify(ids) && JSON.stringify(acceptance.plan?.seed_item_ids) === JSON.stringify([ids[0]]) && JSON.stringify(acceptance.plan?.replacement_item_ids) === JSON.stringify(ids.slice(1)), "ACCEPTANCE_PLAN");

assert(authority.schema_version === "videoforge.v2-07-attempt38-durable-replacement-authority/v1" && authority.attempt === 38 && authority.authority_mode === "bounded_mutation" && authority.status === "APPROVED_SINGLE_USE_PENDING_EXECUTION", "AUTHORITY_SCOPE");
assert(authority.proposal?.sha256 === expected.proposal && authority.approval?.exact_proposal_approved === true && authority.approval?.flashboot_true_accepted === true && authority.approval?.low_or_better_eu_ro_1_availability_approved === true && authority.approval?.minimum_approved_availability === "LOW" && authority.approval?.observed_availability_at_proposal === "HIGH" && authority.approval?.maximum_cumulative_finite_spend_usd === 4 && authority.approval?.fresh_numeric_cap === true && authority.approval?.historical_cap_reused === false && authority.approval?.prior_authority_reused === false && authority.approval?.consumed === false, "AUTHORITY_APPROVAL");
assert(authority.lineage?.control_source_commit === expected.control && authority.lineage?.image_source_commit === expected.source && authority.lineage?.image === expected.image && authority.lineage?.image_manifest_sha256 === expected.imageManifest && authority.lineage?.image_config_sha256 === expected.imageConfig && authority.lineage?.image_layer_sha256 === expected.imageLayer && authority.lineage?.image_layer_diff_id === expected.imageDiffId && authority.lineage?.model_manifest_sha256 === lineage.model_manifest_sha256 && authority.lineage?.volume_id_sha256 === expected.volume && authority.lineage?.volume_mount === "/runpod-volume" && authority.lineage?.volume_region === "EU-RO-1" && authority.lineage?.volume_size_gb === 50 && authority.lineage?.model_root === "/runpod-volume/mage-model" && authority.lineage?.initial_config_sha256 === expected.max1 && authority.lineage?.concurrent_reader_config_sha256 === expected.max2, "AUTHORITY_LINEAGE");
assert(authority.runtime_contract?.offline_sealed_manifest_verification === true && authority.runtime_contract?.real_initialization_warmup === true && authority.runtime_contract?.application_read_only_model_files === true && authority.runtime_contract?.durable_per_unit_resume === true && authority.runtime_contract?.seed_then_distinct_replacement_process_required === true && authority.runtime_contract?.replacement_only_unresolved_units === true && authority.runtime_contract?.accepted_units_never_regenerated === true && authority.runtime_contract?.no_extra_probe_dispatch === true && authority.runtime_contract?.runtime_download_or_quantization === false && authority.runtime_contract?.cache_escape_forbidden === true, "AUTHORITY_RUNTIME");
assert(authority.authorized_operations?.proposal_sha256 === expected.proposal && authority.authorized_operations?.all_and_only_listed_operations_authorized === true && authority.authorized_operations?.publication_or_tag_mutation_authorized === true && authority.authorized_operations?.retained_volume_mutation_authorized === false && authority.authorized_operations?.model_download_preparation_or_quantization_authorized === false && authority.authorized_operations?.gpu_or_region_fallback_authorized === false && authority.authorized_operations?.v2_08_authorized === false, "AUTHORITY_OPERATIONS");
assert(authority.rate_snapshot?.checked_at === proposal.read_only_preflight?.checked_at && authority.rate_snapshot?.availability === "HIGH" && authority.rate_snapshot?.minimum_approved_availability === "LOW" && authority.rate_snapshot?.serverless_flex_rtx4090_usd_per_gpu_hour === 1.1 && authority.rate_snapshot?.maximum_cumulative_finite_spend_usd === 4 && authority.rate_snapshot?.estimated_finite_serverless_compute_usd_ceiling === 3.7 && authority.rate_snapshot?.existing_two_volume_charge_usd_per_month_total === 7, "AUTHORITY_RATES");
assert(authority.execution_boundary?.image_republication_authorized === true && authority.execution_boundary?.runpod_mutation_authorized_pending_execution === true && authority.execution_boundary?.cloudflare_mutation_authorized_pending_execution === true && authority.execution_boundary?.gpu_use_authorized_pending_execution === true && authority.execution_boundary?.provider_calls_completed === false && authority.execution_boundary?.external_spend_usd === 0 && authority.execution_boundary?.maximum_cumulative_finite_spend_usd === 4 && authority.execution_boundary?.retained_volume_mutation_authorized === false && authority.execution_boundary?.v2_08_authorized === false, "AUTHORITY_BOUNDARY");

const currentState = text(resolve(root, "project-context/CURRENT_STATE.yaml"));
const gateState = text(resolve(root, "project-context/GATES.yaml"));
const startHere = text(resolve(root, "project-context/00_START_HERE.md"));
const task = text(resolve(root, "project-context/tasks/VF-10-07.md"));
const activation = text(resolve(root, "apps/web/src/server/providers/v207-activation-authority.ts"));
assert(currentState.includes("2026-08-23-attempt38-durable-replacement-candidate/combined-live-proposal.json") && currentState.includes(expected.proposal), "CURRENT_STATE_POINTER");
assert(gateState.includes("2026-08-23-attempt38-durable-replacement-candidate/combined-live-proposal.json") && gateState.includes(expected.proposal), "GATE_POINTER");
assert(currentState.includes("v2_07_current_approved_authority: evidence/acceptance/VF-10-07/2026-08-23-attempt38-durable-replacement-candidate/approved-authority.json") && currentState.includes(`v2_07_current_approved_authority_sha256: "${expected.authority}"`) && currentState.includes("provider_calls_authorized: true") && currentState.includes("maximum_external_spend_usd: 4"), "CURRENT_AUTHORITY_BINDING");
assert(gateState.includes("pending_authority: \"evidence/acceptance/VF-10-07/2026-08-23-attempt38-durable-replacement-candidate/approved-authority.json\"") && gateState.includes(`pending_authority_sha256: "${expected.authority}"`) && gateState.includes("pending_numeric_cap_usd: 4") && gateState.includes("authority_mode: attempt38_bounded_mutation_authorized"), "GATE_AUTHORITY_BINDING");
assert(currentState.includes(`v2_07_current_proposal: evidence/acceptance/VF-10-07/2026-08-23-attempt38-durable-replacement-candidate/combined-live-proposal.json`) && currentState.includes(`v2_07_current_proposal_sha256: "${expected.proposal}"`) && currentState.includes("latest_live_check:\n    recorded_at_utc: \"2026-08-22T22:34:34.293Z\""), "CURRENT_ACTIVE_TRUTH");
assert(
  currentState.includes(
    `v2_07_current_candidate_max1_sha256: "${expected.max1}"`,
  ) &&
    currentState.includes(
      `v2_07_current_candidate_max2_sha256: "${expected.max2}"`,
    ) &&
    currentState.includes(
      "v2_07_current_candidate_acceptance: evidence/acceptance/VF-10-07/2026-08-23-attempt38-durable-replacement-candidate/acceptance.json",
    ) &&
    currentState.includes(
      `v2_07_current_candidate_acceptance_sha256: "${expected.acceptance}"`,
    ),
  "CURRENT_MODEL_RUNTIME_BINDING",
);
assert(
  currentState.includes(
    "latest_closed_authority: evidence/acceptance/VF-10-07/2026-08-23-attempt37-terminal-reader-result-recovery-candidate/approved-authority.json",
  ) &&
    currentState.includes(
      "v2_07_latest_closed_proposal: evidence/acceptance/VF-10-07/2026-08-23-attempt37-terminal-reader-result-recovery-candidate/combined-live-proposal.json",
    ),
  "CURRENT_LATEST_CLOSED_TRUTH",
);
assert(gateState.includes(`current_candidate_sha256: "${expected.proposal}"`) && gateState.includes(`pending_proposal_sha256: "${expected.proposal}"`) && gateState.includes("latest_closed_proposal_sha256: \"sha256:6ff97af22dd025e9298a830a9bcd946f18fe376745f39ed6e5c15b791e3f390e\""), "GATE_ACTIVE_AND_HISTORICAL");
assert(startHere.includes(expected.proposal) && task.includes(expected.proposal) && startHere.includes("Attempt38") && task.includes("Attempt38"), "HANDOFF_POINTERS");
assert(activation.includes(expected.proposal) && activation.includes(expected.image) && activation.includes(`V207_APPROVED_AUTHORITY_SHA256 =\n  \"${expected.authority}\"`) && activation.includes("V207_APPROVED_FINITE_CAP_USD: number | null = 4"), "ACTIVATION_AUTHORITY");

const handlerPath = resolve(root, "workers/image-media/mage_serverless.py");
const schemaPath = resolve(root, "packages/contracts/python/videoforge_contracts/_schema_documents.py");
assert(sha(handlerPath) === expected.handler && sha(schemaPath) === expected.schema, "LIVE_SOURCE_HASH");
console.log("V207_ATTEMPT38_DURABLE_REPLACEMENT_PROPOSAL_PASS");

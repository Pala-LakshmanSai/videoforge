import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const dir = resolve(
  root,
  "project-context/evidence/acceptance/VF-10-07/2026-08-23-attempt43-anchor-refresh-candidate",
);
const paths = {
  proposal: resolve(dir, "combined-live-proposal.json"),
  acceptance: resolve(dir, "acceptance.json"),
  authority: resolve(dir, "approved-authority.json"),
  preflight: resolve(dir, "read-only-preflight.json"),
  max1: resolve(dir, "staged-config-max1.json"),
  max2: resolve(dir, "staged-config-max2.json"),
  activation: resolve(root, "apps/web/src/server/providers/v207-activation-authority.ts"),
  activationTest: resolve(root, "apps/web/src/server/providers/v207-activation-authority.test.ts"),
  state: resolve(root, "project-context/CURRENT_STATE.yaml"),
  gates: resolve(root, "project-context/GATES.yaml"),
  start: resolve(root, "project-context/00_START_HERE.md"),
  task: resolve(root, "project-context/tasks/VF-10-07.md"),
};
const expected = {
  attempt: 43,
  image:
    "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:79fe7e40b69c011c15cc31b2d84b356cd2c755ea338976172cd78cc581304d59",
  imageSource: "a7b7a937d08dc9032b8922cca71c602195f3094c",
  imageConfig: "sha256:b6c43cb1f2782540f52ac1f2f4584fea763237f1c75c8c7c1341ea70bcc915e6",
  imageLayer: "sha256:f31fc51513e3573eb859897b7bcacd4b28bb525567b7523af1c98e4f370c8c3a",
  imageDiffId: "sha256:9f759e3f49c84816de71246f51f9aca275fc080c7c9c082aaa39ce81e8b049e1",
  imageParent:
    "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:8a5b8f453c694b2eeee097e3d958b08c5e47c15290b5cdc17a4fb7e5e3e4f497",
  imageParentConfig:
    "sha256:de5c854ae5aa9e611e218b89d29a250eb03a0a316f0ac92d584d53a038d06ff2",
  model: "Comfy-Org/Mage-Flow@d8c99241f6fa80fbd453014234af2bf337ea21e6#int8-convrot",
  manifest: "sha256:cebcd5c6233c2eae32f26ced7510acef8192f0d92d7ec3e9dd3ee881d66d205b",
  mageVolume: "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619",
  soulxVolume: "sha256:2a8633e14bbecab54f52e2ae7b5b06bfa562b09a6ac781fe0985eb28e70587be",
  handler: "sha256:3a2559dd363bdf5032b019dab3cb8fe45cba6ed4308464f860a1965cfd18f1da",
  subset: "sha256:a94bf2c8c4175eef3f84ab719118c2b9b5b501ce8b2708c28713b25521b71c71",
  baselineConfig: "sha256:085c49cad14e5e3b339f34065075f311a795c311d474c2355b6477f75c860175",
  projectedConfig: "sha256:a01a6ec7ffa45a187f8b4cc094ca1522c33a37a6f3e4aea06cb2a38b14120fd5",
  oldActiveVersionId:
    "sha256:534524220d7e478d7178a6a51a7cf1b3d77ff0bca3de3a57736c8fad1d90bf48",
  oldActiveRecord:
    "sha256:a4449873ab598a85a5bc0b15ebb9d46ee56bbef9efa936f450148614d132cd97",
  priorClosure: "sha256:ca9d1ba45cdaf028acc92f07bfe278b7ae6c4bf2cf182dae0e4ed51696435dbc",
  priorCleanup: "sha256:4d30c80b9ba2d42916c358a0768ddca71b876d8b1225d5223114152065550f81",
  priorReconciliation: "sha256:a73ffbf9fe0960d94027970f4036599f080d02e0b32359eeeabedd6bb266beac",
  anchorRefreshCommit: "a6c7266e0c19fce07757c78fbd588dd442b7d24f",
  typedAuthorityCommit: "e5571ed2478f0c526ebf508d0a4ce301bafa8203",
  helperCommit: "816d28699ab9ecad74c74f73bce984205b267ed5",
  orchestratorCommit: "3dda73fed6d82dc7116b18a6b7cfbe4b262fc7bc",
  pathPinCommit: "75c784ad1bd9ae4908a5a5204a2170052c44df92",
  qualificationCommit: "5e1e5a067357a0df4a2fe1ea32412a4b6af33404",
  orchestratorSource:
    "sha256:f8cad240cdfb4ba0aa0885aef3e00ab38e0b051950dcf41528f219bc7d7bb90a",
  typedAuthoritySource:
    "sha256:eecb4df971f67848a8ce01dc8faa8eb23b36fb06ee1e64cf7293248da51c57d7",
  helperSource:
    "sha256:8b059ade2b20ca3aea06a502af98858b6b5cce8e6e95f3008b45483712b28db8",
  liveQualificationSource:
    "sha256:5ca42cddc7ddb5055ae59592cececda859361b017d68a74edfebf0faf5244db6",
  successReconciliationSource:
    "sha256:d50a8d9bc1e99ac805f6602899b909534b5a02ad6c2386aea59a29b59a670eb1",
  qualificationHarnessSource:
    "sha256:ad49e6ab7d962c6aa88f16e67fb6d1247571fa96e484c7582b87d7d0505d3cbd",
  protectedConfigPath:
    "/Users/lakshmansai/.config/videoforge/v2-06/wrangler-current-3d8d467.json",
  markerKey: "V207_ROLLBACK_ANCHOR_REFRESH",
  markerValue: "two-phase-v1",
  authority:
    "sha256:e5c268b63583d28c18a3999ef9880f425d54e9bf50f759e376dbcd0f2b40a07b",
  finiteCapUsd: 4,
};
const fail = (code) => {
  throw new Error("V207_ATTEMPT43_CANDIDATE_" + code);
};
const assert = (condition, code) => {
  if (!condition) fail(code);
};
const bytes = (path) => readFileSync(path);
const text = (path) => bytes(path).toString("utf8");
const json = (path) => JSON.parse(text(path));
const sha = (path) => "sha256:" + createHash("sha256").update(bytes(path)).digest("hex");
const shaPattern = /^sha256:[a-f0-9]{64}$/u;

for (const path of Object.values(paths)) assert(existsSync(path), "MISSING_" + path);
const proposal = json(paths.proposal);
const acceptance = json(paths.acceptance);
const authority = json(paths.authority);
const preflight = json(paths.preflight);
const max1 = json(paths.max1);
const max2 = json(paths.max2);
const proposalHash = sha(paths.proposal);
const acceptanceHash = sha(paths.acceptance);
const authorityHash = sha(paths.authority);
const preflightHash = sha(paths.preflight);
const max1Hash = sha(paths.max1);
const max2Hash = sha(paths.max2);
const activationSource = text(paths.activation);
const proposalPointerPattern =
  /(\bexport const V207_PENDING_PROPOSAL_SHA256\s*=\s*(?:\r?\n\s*)?")sha256:([a-f0-9]{64})("\s+as const;)/gu;
const proposalPointerMatches = [...activationSource.matchAll(proposalPointerPattern)];
assert(proposalPointerMatches.length === 1, "ACTIVATION_PROPOSAL_POINTER_COUNT");
const replaceOne = (source, pattern, replacement, code) => {
  const matches = source.match(pattern);
  assert(matches?.length === 1, code);
  return source.replace(pattern, replacement);
};
// The proposal binds the pre-approval canonical source.  Approval only changes
// these three compiled constants plus the exact proposal pointer; normalize
// them back to their pre-approval values before checking the immutable hash.
let canonicalActivationSource = activationSource.replace(
  proposalPointerPattern,
  `$1sha256:${"0".repeat(64)}$3`,
);
canonicalActivationSource = replaceOne(
  canonicalActivationSource,
  /export const V207_APPROVED_AUTHORITY_SHA256: string \| null\s*=\s*"sha256:[a-f0-9]{64}";/gu,
  "export const V207_APPROVED_AUTHORITY_SHA256: string | null = null;",
  "ACTIVATION_AUTHORITY_CONSTANT_COUNT",
);
canonicalActivationSource = replaceOne(
  canonicalActivationSource,
  /export const V207_APPROVED_FINITE_CAP_USD: number \| null\s*=\s*4;/gu,
  "export const V207_APPROVED_FINITE_CAP_USD: number | null = null;",
  "ACTIVATION_CAP_CONSTANT_COUNT",
);
canonicalActivationSource = replaceOne(
  canonicalActivationSource,
  /export const V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED: boolean \| null\s*=\s*true;/gu,
  "export const V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED: boolean | null = null;",
  "ACTIVATION_ANCHOR_CONSTANT_COUNT",
);
const activationSourceHash =
  "sha256:" + createHash("sha256").update(canonicalActivationSource).digest("hex");
const activationProposalHash = `sha256:${proposalPointerMatches[0][2]}`;

for (const [name, value] of Object.entries({
  proposalHash,
  acceptanceHash,
  authorityHash,
  preflightHash,
  max1Hash,
  max2Hash,
})) {
  assert(shaPattern.test(value), name + "_FORMAT");
}
assert(proposal.attempt === expected.attempt, "PROPOSAL_ATTEMPT");
assert(
  proposal.authority_mode === "PENDING_FRESH_EXACT_APPROVAL_AND_NUMERIC_CAP" &&
    proposal.provider_mutation === false &&
    proposal.publication === false &&
    proposal.gpu_use === false &&
    proposal.spend_usd === 0,
  "PROPOSAL_BOUNDARY",
);
assert(
  proposal.user_approval?.exact_proposal_approved === false &&
    proposal.user_approval?.maximum_cumulative_finite_spend_usd === null &&
    proposal.user_approval?.fresh_positive_numeric_cap_required === true &&
    proposal.user_approval?.prior_authority_or_cap_reuse_forbidden === true,
  "PROPOSAL_APPROVAL_BOUNDARY",
);
assert(
  proposal.lineage?.model === expected.model &&
    proposal.lineage?.model_manifest_sha256 === expected.manifest &&
    proposal.lineage?.image === expected.image &&
    proposal.lineage?.image_source_commit === expected.imageSource &&
    proposal.lineage?.image_config_sha256 === expected.imageConfig &&
    proposal.lineage?.image_layer_sha256 === expected.imageLayer &&
    proposal.lineage?.image_layer_diff_id === expected.imageDiffId &&
    proposal.lineage?.image_parent === expected.imageParent &&
    proposal.lineage?.image_parent_config_sha256 === expected.imageParentConfig &&
    proposal.lineage?.volume_id_sha256 === expected.mageVolume &&
    proposal.lineage?.volume_size_gb === 50 &&
    proposal.lineage?.volume_region === "EU-RO-1" &&
    proposal.lineage?.volume_mount === "/runpod-volume" &&
    proposal.lineage?.model_root === "/runpod-volume/mage-model" &&
    proposal.lineage?.gpu === "NVIDIA GeForce RTX 4090" &&
    proposal.lineage?.flashboot === true &&
    proposal.lineage?.handler_source_sha256 === expected.handler &&
    proposal.lineage?.execution_subset_schema_sha256 === expected.subset,
  "PROPOSAL_LINEAGE",
);
assert(
  proposal.lineage?.prior_attempt?.attempt === 42 &&
    proposal.lineage?.prior_attempt?.closure_sha256 === expected.priorClosure &&
    proposal.lineage?.prior_attempt?.cleanup_sha256 === expected.priorCleanup &&
    proposal.lineage?.prior_attempt?.reconciliation_sha256 === expected.priorReconciliation &&
    proposal.lineage?.prior_attempt?.authority_consumed === true,
  "PRIOR_ATTEMPT_LINEAGE",
);
assert(
  proposal.protected_config_anchor_refresh?.path === expected.protectedConfigPath &&
    proposal.protected_config_anchor_refresh?.marker_key === expected.markerKey &&
    proposal.protected_config_anchor_refresh?.marker_value === expected.markerValue &&
    proposal.protected_config_anchor_refresh?.baseline_sha256 === expected.baselineConfig &&
    proposal.protected_config_anchor_refresh?.projected_marker_sha256 === expected.projectedConfig &&
    proposal.protected_config_anchor_refresh?.baseline_mode === "0600" &&
    proposal.protected_config_anchor_refresh?.projected_mode === "0600" &&
    proposal.protected_config_anchor_refresh?.baseline_marker_absent === true &&
    proposal.protected_config_anchor_refresh?.orchestrator_applies_before_remote_boundary === true &&
    proposal.protected_config_anchor_refresh?.revert_in_terminal_finally === true &&
    proposal.protected_config_anchor_refresh?.final_required_sha256 === expected.baselineConfig &&
    proposal.protected_config_anchor_refresh?.final_marker_absent === true,
  "PROTECTED_CONFIG_REFRESH",
);
assert(
  proposal.cloudflare_anchor_refresh?.old_active_version_id_sha256 === expected.oldActiveVersionId &&
    proposal.cloudflare_anchor_refresh?.old_active_record_sha256 === expected.oldActiveRecord &&
    proposal.cloudflare_anchor_refresh?.old_active_index_oldest_to_newest === 0 &&
    proposal.cloudflare_anchor_refresh?.old_active_window_length === 10 &&
    proposal.cloudflare_anchor_refresh?.old_active_version_id_sha256 ===
      preflight.cloudflare_anchor_basis?.old_active_version_id_sha256 &&
    proposal.cloudflare_anchor_refresh?.old_active_record_sha256 ===
      preflight.cloudflare_anchor_basis?.old_active_record_sha256 &&
    proposal.cloudflare_anchor_refresh?.pre_mutation_route?.status === 404 &&
    proposal.cloudflare_anchor_refresh?.pre_mutation_route?.code === "V207_ROUTE_DISABLED" &&
    proposal.cloudflare_anchor_refresh?.stale_signer_must_be_absent === true &&
    proposal.cloudflare_anchor_refresh?.new_anchor?.must_be_distinct_from_old === true &&
    proposal.cloudflare_anchor_refresh?.new_anchor?.exact_active_record_hash_captured === true &&
    proposal.cloudflare_anchor_refresh?.new_anchor?.must_be_in_newest_seven_of_at_most_ten === true &&
    proposal.cloudflare_anchor_refresh?.cleanup_rollback_requires_new_anchor_record_hash === true &&
    proposal.cloudflare_anchor_refresh?.cleanup_uncertain_on_any_hash_route_marker_or_signer_mismatch === true,
  "CLOUDFLARE_REFRESH",
);
assert(
  proposal.lineage?.control_source_commits?.anchor_refresh === expected.anchorRefreshCommit &&
    proposal.lineage?.control_source_commits?.exact_typed_activation_authority ===
      expected.typedAuthorityCommit &&
    proposal.lineage?.control_source_commits?.protected_config_helper === expected.helperCommit &&
    proposal.lineage?.control_source_commits?.orchestrator_owned_marker_lifecycle ===
      expected.orchestratorCommit &&
    proposal.lineage?.control_source_commits?.protected_config_path_pin ===
      expected.pathPinCommit &&
    proposal.lineage?.control_source_commits?.fresh_catalog_and_success_reconciliation ===
      expected.qualificationCommit &&
    proposal.lineage?.control_source_hashes?.orchestrator_source_sha256 ===
      expected.orchestratorSource &&
    proposal.lineage?.control_source_hashes?.typed_authority_source_sha256 === expected.typedAuthoritySource &&
    proposal.lineage?.control_source_hashes?.typed_authority_source_hash_mode ===
      "CANONICAL_ZEROED_PROPOSAL_POINTER_V1" &&
    proposal.lineage?.control_source_hashes?.typed_authority_source_sha256 === activationSourceHash &&
    proposal.lineage?.control_source_hashes?.protected_config_helper_source_sha256 === expected.helperSource &&
    proposal.lineage?.control_source_hashes?.live_qualification_source_sha256 ===
      expected.liveQualificationSource &&
    proposal.lineage?.control_source_hashes?.success_reconciliation_source_sha256 ===
      expected.successReconciliationSource &&
    proposal.lineage?.control_source_hashes?.qualification_harness_source_sha256 ===
      expected.qualificationHarnessSource &&
    proposal.protected_config_anchor_refresh?.helper_source_commit === expected.helperCommit,
  "CONTROL_COMMITS",
);
assert(
  proposal.read_only_preflight?.evidence === "read-only-preflight.json" &&
    proposal.read_only_preflight?.evidence_sha256 === preflightHash &&
    proposal.read_only_preflight?.inventory_zero_disposable_resources === true &&
    proposal.read_only_preflight?.both_exact_retained_volumes === true &&
    acceptance.candidate?.read_only_refresh_required_before_mutation === true &&
    proposal.read_only_preflight?.baseline_endpoint_spend_usd === preflight.billing?.baseline_endpoint_spend_usd &&
    proposal.read_only_preflight?.incremental_spend_usd === 0,
  "PREFLIGHT_BINDING",
);
assert(
  proposal.staged_endpoint_configs?.[0]?.definition_sha256 === max1Hash &&
    proposal.staged_endpoint_configs?.[1]?.definition_sha256 === max2Hash &&
    proposal.staged_endpoint_configs?.[0]?.workers_min === 0 &&
    proposal.staged_endpoint_configs?.[0]?.workers_max === 1 &&
    proposal.staged_endpoint_configs?.[1]?.workers_min === 0 &&
    proposal.staged_endpoint_configs?.[1]?.workers_max === 2,
  "STAGED_CONFIG_HASHES",
);
assert(
  proposal.cost_estimate?.finite_action_estimate_usd === 3.95 &&
    proposal.cost_estimate?.proposed_finite_cap_usd === null &&
    proposal.cost_estimate?.current_provider_rate_usd_per_gpu_hour === 1.1 &&
    proposal.cost_estimate?.secure_reference_rate_usd_per_hour === 0.74 &&
    proposal.cost_estimate?.ongoing_retained_volume_charge_usd_per_month === 7 &&
    proposal.cost_estimate?.ongoing_volume_charge_separate_from_finite_cap === true,
  "COST_BOUNDARY",
);
assert(
  authorityHash === expected.authority &&
    authority.schema_version === "videoforge.v2-07-attempt43-anchor-refresh-authority/v1" &&
    authority.checkpoint === "V2-07" &&
    authority.task_id === "VF-10-07" &&
    authority.attempt === expected.attempt &&
    authority.status === "APPROVED_SINGLE_USE_PENDING_EXECUTION" &&
    authority.proposal?.path === "combined-live-proposal.json" &&
    authority.proposal?.sha256 === proposalHash &&
    authority.approval?.exact_proposal_approved === true &&
    authority.approval?.flashboot_true_accepted === true &&
    authority.approval?.low_or_better_eu_ro_1_availability_approved === true &&
    authority.approval?.minimum_approved_availability === "LOW" &&
    authority.approval?.observed_availability_at_proposal === "HIGH" &&
    authority.approval?.maximum_cumulative_finite_spend_usd === expected.finiteCapUsd &&
    authority.approval?.fresh_numeric_cap === true &&
    authority.approval?.historical_cap_reused === false &&
    authority.approval?.prior_authority_reused === false &&
    authority.approval?.single_use === true &&
    authority.approval?.consumed === false &&
    authority.approval?.anchor_refresh_authorized === true &&
    authority.approval?.recurring_retained_volume_charge_usd_per_month === 7 &&
    authority.approval?.recurring_charge_is_outside_finite_cap === true,
  "AUTHORITY_APPROVAL",
);
assert(
  authority.lineage?.image === expected.image &&
    authority.lineage?.image_source_commit === expected.imageSource &&
    authority.lineage?.model === expected.model &&
    authority.lineage?.model_manifest_sha256 === expected.manifest &&
    authority.lineage?.volume_id_sha256 === expected.mageVolume &&
    authority.lineage?.volume_size_gb === 50 &&
    authority.lineage?.volume_region === "EU-RO-1" &&
    authority.lineage?.volume_mount === "/runpod-volume" &&
    authority.lineage?.model_root === "/runpod-volume/mage-model" &&
    authority.lineage?.gpu === "NVIDIA GeForce RTX 4090" &&
    authority.lineage?.flashboot === true &&
    authority.lineage?.initial_config_path === "staged-config-max1.json" &&
    authority.lineage?.initial_config_sha256 === max1Hash &&
    authority.lineage?.concurrent_reader_config_path === "staged-config-max2.json" &&
    authority.lineage?.concurrent_reader_config_sha256 === max2Hash &&
    authority.lineage?.protected_config_anchor_refresh?.baseline_sha256 === expected.baselineConfig &&
    authority.lineage?.protected_config_anchor_refresh?.projected_marker_sha256 === expected.projectedConfig &&
    authority.lineage?.cloudflare_anchor_refresh?.old_active_version_id_sha256 ===
      expected.oldActiveVersionId &&
    authority.lineage?.cloudflare_anchor_refresh?.old_active_record_sha256 === expected.oldActiveRecord,
  "AUTHORITY_LINEAGE",
);
assert(
  authority.lineage?.control_source_hashes?.typed_authority_source_sha256 === expected.typedAuthoritySource &&
    authority.lineage?.control_source_hashes?.typed_authority_source_hash_mode ===
      "CANONICAL_ZEROED_PROPOSAL_POINTER_V1" &&
    authority.authorized_operations?.source ===
      "combined-live-proposal.json#approved_operations_to_be_proposed_once" &&
    authority.authorized_operations?.proposal_sha256 === proposalHash &&
    authority.authorized_operations?.all_and_only_listed_operations_authorized === true &&
    authority.authorized_operations?.anchor_refresh_authorized === true &&
    authority.authorized_operations?.publication_or_tag_mutation_authorized === false &&
    authority.authorized_operations?.image_republication_authorized === false &&
    authority.authorized_operations?.retained_volume_mutation_authorized === false &&
    authority.authorized_operations?.model_download_preparation_or_quantization_authorized === false &&
    authority.authorized_operations?.gpu_or_region_fallback_authorized === false &&
    authority.authorized_operations?.v2_08_authorized === false,
  "AUTHORITY_OPERATIONS",
);
assert(
  authority.execution_boundary?.runpod_mutation_authorized_pending_execution === true &&
    authority.execution_boundary?.cloudflare_mutation_authorized_pending_execution === true &&
    authority.execution_boundary?.gpu_use_authorized_pending_execution === true &&
    authority.execution_boundary?.anchor_refresh_authorized === true &&
    authority.execution_boundary?.provider_calls_completed === false &&
    authority.execution_boundary?.external_spend_usd === 0 &&
    authority.execution_boundary?.maximum_cumulative_finite_spend_usd === expected.finiteCapUsd &&
    authority.execution_boundary?.retained_volume_mutation_authorized === false &&
    authority.execution_boundary?.v2_08_authorized === false,
  "AUTHORITY_EXECUTION_BOUNDARY",
);
for (const fragment of [
  "let the hashed orchestrator atomically apply two-phase-v1",
  "capture the old active Cloudflare Worker record",
  "require exact stable 404 V207_ROUTE_DISABLED before the first Worker mutation",
  "capture a distinct exact active record/hash",
  "make the new signer-disabled anchor the intended final Cloudflare baseline",
  "create or update one private EU-RO-1 endpoint",
  "submit one seed job",
  "submit one replacement job",
  "apply separately hashed max2 definition",
  "delete signer",
  "revert the marker through the helper",
  "stop before V2-08",
]) {
  assert(
    proposal.approved_operations_to_be_proposed_once?.some((operation) => operation.includes(fragment)),
    "MISSING_OPERATION_" + fragment.replaceAll(/[^A-Z0-9]+/gi, "_").toUpperCase(),
  );
}
assert(
  proposal.qualification_runs?.complete_image_batch === true &&
    proposal.qualification_runs?.cold_and_warm === true &&
    proposal.qualification_runs?.duplicate_delivery_same_job_no_second_run === true &&
    proposal.qualification_runs?.two_simultaneous_read_only_workers?.uses_max2_only === true &&
    proposal.qualification_runs?.two_simultaneous_read_only_workers?.restore_max1 === true &&
    proposal.qualification_runs?.durable_outputs_before_provider_expiry === true &&
    proposal.qualification_runs?.v3_authority_provenance_receipts === true &&
    proposal.qualification_runs?.manifest_before_after_equal === true &&
    proposal.qualification_runs?.model_volume_writes_zero === true &&
    proposal.negative_tests_and_stop_conditions?.length === 8,
  "QUALIFICATION_CONTRACT",
);
for (const [config, workers, hash] of [[max1, 1, max1Hash], [max2, 2, max2Hash]]) {
  assert(
    sha(workers === 1 ? paths.max1 : paths.max2) === hash &&
      config.image === expected.image &&
      config.image_source_commit === expected.imageSource &&
      config.model_manifest_sha256 === expected.manifest &&
      config.network_volume_id_sha256 === expected.mageVolume &&
      config.network_volume_size_gb === 50 &&
      config.network_volume_region === "EU-RO-1" &&
      config.network_volume_mount === "/runpod-volume" &&
      config.gpu_type_ids?.[0] === "NVIDIA GeForce RTX 4090" &&
      (config.gpu_count === 1 || config.gpu_count_per_worker === 1) &&
      config.compute_type === "GPU" &&
      config.flex_only === true &&
      config.flashboot === true &&
      config.workers_min === 0 &&
      config.workers_max === workers &&
      config.cloudflare_anchor_refresh_contract?.old_active_version_id_sha256 === expected.oldActiveVersionId &&
      config.cloudflare_anchor_refresh_contract?.old_active_record_sha256 === expected.oldActiveRecord &&
      config.control_source_commits?.includes(expected.anchorRefreshCommit) &&
      config.control_source_commits?.includes(expected.typedAuthorityCommit) &&
      config.control_source_commits?.includes(expected.helperCommit) &&
      config.control_source_commits?.includes(expected.orchestratorCommit) &&
      config.control_source_commits?.includes(expected.pathPinCommit) &&
      config.control_source_commits?.includes(expected.qualificationCommit) &&
      config.fresh_catalog_admission?.includes("LOW_OR_BETTER") &&
      config.cloudflare_anchor_refresh_contract?.success_reconciliation?.startsWith(
        "THREE_STABLE_READS",
      ),
    "CONFIG_" + workers,
  );
}
assert(
  preflight.attempt === expected.attempt &&
    preflight.read_only === true &&
    preflight.provider_mutations === 0 &&
    preflight.gpu_jobs_submitted === 0 &&
    preflight.external_spend_usd === 0 &&
    preflight.inventory?.pods === 0 &&
    preflight.inventory?.endpoints === 0 &&
    preflight.inventory?.private_templates === 0 &&
    preflight.inventory?.active_serverless_workers === 0 &&
    preflight.inventory?.running_pods === 0 &&
    preflight.inventory?.retained_volumes?.length === 2 &&
    preflight.selected_gpu?.offering_id === "NVIDIA GeForce RTX 4090" &&
    preflight.selected_gpu?.region === "EU-RO-1" &&
    preflight.selected_gpu?.availability === "HIGH" &&
    preflight.serverless_flex_rate?.usd_per_gpu_hour === 1.1 &&
    preflight.billing?.baseline_endpoint_spend_usd === 1.5709891965379938 &&
    preflight.billing?.incremental_spend_usd === 0 &&
    preflight.quota_lookup?.no_quota_claim_inferred === true &&
    preflight.cloudflare_anchor_basis?.protected_config_path === expected.protectedConfigPath &&
    preflight.cloudflare_anchor_basis?.baseline_config_sha256 === expected.baselineConfig &&
    preflight.cloudflare_anchor_basis?.projected_marker_config_sha256 === expected.projectedConfig &&
    preflight.cloudflare_anchor_basis?.baseline_config_mode === "0600" &&
    preflight.cloudflare_anchor_basis?.baseline_marker === null &&
    preflight.cloudflare_anchor_basis?.old_active_version_id_sha256 === expected.oldActiveVersionId &&
    preflight.cloudflare_anchor_basis?.old_active_record_sha256 === expected.oldActiveRecord &&
    preflight.cloudflare_anchor_basis?.old_active_index_oldest_to_newest === 0 &&
    preflight.cloudflare_anchor_basis?.route_status === 404 &&
    preflight.cloudflare_anchor_basis?.route_code === "V207_ROUTE_DISABLED" &&
    preflight.cloudflare_anchor_basis?.stale_signer_present === false &&
    preflight.raw_evidence?.source_reconciliation_sha256 === expected.priorReconciliation &&
    preflight.raw_evidence?.source_preflight_sha256 === undefined,
  "PREFLIGHT",
);
const volumes = new Map(preflight.inventory.retained_volumes.map((volume) => [volume.purpose, volume]));
assert(
  volumes.get("Mage")?.id_sha256 === expected.mageVolume &&
    volumes.get("Mage")?.size_gb === 50 &&
    volumes.get("Mage")?.region === "EU-RO-1" &&
    volumes.get("Mage")?.mount === "/runpod-volume" &&
    volumes.get("Mage")?.identity_unchanged === true &&
    volumes.get("SoulX")?.id_sha256 === expected.soulxVolume &&
    volumes.get("SoulX")?.identity_unchanged === true,
  "VOLUMES",
);
assert(
  acceptance.result === "APPROVED_SINGLE_USE_PENDING_EXECUTION" &&
    acceptance.qualification_status === "NOT_QUALIFIED_PENDING_EXECUTION" &&
    acceptance.attempt === expected.attempt &&
    acceptance.candidate?.proposal_sha256 === proposalHash &&
    acceptance.candidate?.max1_sha256 === max1Hash &&
    acceptance.candidate?.max2_sha256 === max2Hash &&
    acceptance.candidate?.authority_path === "approved-authority.json" &&
    acceptance.candidate?.authority_sha256 === authorityHash &&
    acceptance.candidate?.authority_recorded === true &&
    acceptance.candidate?.maximum_cumulative_finite_spend_usd === expected.finiteCapUsd &&
    acceptance.candidate?.fresh_numeric_cap_required === true &&
    acceptance.provider_boundary?.provider_calls_authorized === true &&
    acceptance.provider_boundary?.provider_mutations_authorized === true &&
    acceptance.provider_boundary?.gpu_use_authorized === true &&
    acceptance.provider_boundary?.authority_active === true &&
    acceptance.provider_boundary?.authority_file_present === true &&
    acceptance.provider_boundary?.maximum_cumulative_finite_spend_usd === expected.finiteCapUsd &&
    acceptance.provider_boundary?.anchor_refresh_authorized === true &&
    acceptance.provider_boundary?.read_only_refresh_completed === false &&
    acceptance.provider_boundary?.publication_authorized === false &&
    acceptance.provider_boundary?.image_republication_forbidden === true &&
    acceptance.provider_boundary?.retained_volume_mutation_authorized === false &&
    acceptance.provider_boundary?.v2_08_authorized === false,
  "ACCEPTANCE",
);
assert(
  acceptance.candidate_lineage?.old_active_version_id_sha256 === expected.oldActiveVersionId &&
    acceptance.candidate_lineage?.old_active_record_sha256 === expected.oldActiveRecord &&
    acceptance.candidate_lineage?.old_active_index_oldest_to_newest === 0 &&
    acceptance.candidate_lineage?.old_active_window_length === 10,
  "ACCEPTANCE_ANCHOR_LINEAGE",
);
const activation = activationSource;
const activationTest = text(paths.activationTest);
assert(
  activation.includes("V207_PENDING_PROPOSAL_SHA256") &&
    activationSourceHash === expected.typedAuthoritySource &&
    activationProposalHash === proposalHash &&
    activation.includes(expected.helperCommit) &&
    activation.includes(expected.typedAuthorityCommit) &&
    activation.includes(expected.orchestratorCommit) &&
    activation.includes(expected.qualificationCommit) &&
    activationTest.includes("Attempt43") &&
    activationTest.includes("V207_FINITE_CAP_REQUIRED") &&
    activationTest.includes("V207_FINITE_CAP_MISMATCH"),
  "ACTIVATION",
);
for (const [name, path] of Object.entries({ state: paths.state, gates: paths.gates, start: paths.start, task: paths.task })) {
  const surface = text(path);
  assert(
    surface.includes(proposalHash) &&
      surface.includes(expected.authority) &&
      surface.includes("approved-authority.json") &&
      surface.includes("V2-08"),
    name.toUpperCase() + "_POINTER",
  );
}
const state = text(paths.state);
const gates = text(paths.gates);
const start = text(paths.start);
const task = text(paths.task);
const attempt43Closed = state.includes(
  "phase: serverless_v2_v2_07_attempt43_closed_not_qualified",
);
if (attempt43Closed) {
  assert(
    state.includes("provider_calls_authorized: false") &&
      state.includes("gpu_use_authorized: false") &&
      state.includes("maximum_external_spend_usd: 0") &&
      state.includes("task_stage: provider_free_diagnosis") &&
      state.includes(expected.baselineConfig) &&
      state.includes(expected.projectedConfig) &&
      state.includes(expected.oldActiveVersionId) &&
      state.includes(expected.oldActiveRecord),
    "STATE_CLOSED_BOUNDARY",
  );
  assert(
    gates.includes("attempt43") &&
      gates.includes("pending_numeric_cap_usd: null") &&
      gates.includes("provider_calls_authorized: false") &&
      gates.includes("gpu_use_authorized: false") &&
      gates.includes(expected.oldActiveVersionId) &&
      gates.includes(expected.oldActiveRecord),
    "GATES_CLOSED_BOUNDARY",
  );
} else {
  assert(
    state.includes("attempt43") &&
      state.includes("provider_calls_authorized: true") &&
      state.includes("gpu_use_authorized: true") &&
      state.includes("maximum_external_spend_usd: 4") &&
      state.includes("task_stage: bounded_mutation") &&
      state.includes(expected.baselineConfig) &&
      state.includes(expected.projectedConfig) &&
      state.includes(expected.oldActiveVersionId) &&
      state.includes(expected.oldActiveRecord),
    "STATE_BOUNDARY",
  );
  assert(
    gates.includes("attempt43") &&
      gates.includes("pending_numeric_cap_usd: 4") &&
      gates.includes("provider_calls_authorized: true") &&
      gates.includes("gpu_use_authorized: true") &&
      gates.includes(expected.oldActiveVersionId) &&
      gates.includes(expected.oldActiveRecord),
    "GATES_BOUNDARY",
  );
}
if (attempt43Closed) {
  assert(
    start.includes(expected.baselineConfig) &&
      start.includes("failed-attempt-43.json") &&
      start.includes("NOT_QUALIFIED"),
    "START_CLOSED_LINEAGE",
  );
  assert(
    task.includes(expected.baselineConfig) &&
      task.includes("failed-attempt-43.json") &&
      task.includes("NOT_QUALIFIED"),
    "TASK_CLOSED_LINEAGE",
  );
} else {
  assert(start.includes(expected.baselineConfig) && start.includes(expected.projectedConfig), "START_LINEAGE");
  assert(
    start.includes(expected.oldActiveVersionId) && start.includes(expected.oldActiveRecord),
    "START_ANCHOR_LINEAGE",
  );
  assert(
    task.includes(expected.baselineConfig) &&
      task.includes(expected.projectedConfig) &&
      task.includes(expected.oldActiveVersionId) &&
      task.includes(expected.oldActiveRecord),
    "TASK_LINEAGE",
  );
}
console.log(
  `V2-07 Attempt43 candidate validation PASS (${attempt43Closed ? "historical consumed authority; closure is separately validated" : "pending single-use authority"})`,
);

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const candidate = resolve(
  root,
  "project-context/evidence/acceptance/VF-10-07/2026-08-23-attempt39-fresh-cap-rollback-retention-candidate",
);
const paths = {
  proposal: resolve(candidate, "combined-live-proposal.json"),
  acceptance: resolve(candidate, "acceptance.json"),
  authority: resolve(candidate, "approved-authority.json"),
  max1: resolve(candidate, "staged-config-max1.json"),
  max2: resolve(candidate, "staged-config-max2.json"),
  state: resolve(root, "project-context/CURRENT_STATE.yaml"),
  gates: resolve(root, "project-context/GATES.yaml"),
  start: resolve(root, "project-context/00_START_HERE.md"),
  task: resolve(root, "project-context/tasks/VF-10-07.md"),
  activation: resolve(root, "apps/web/src/server/providers/v207-activation-authority.ts"),
  reconciliation: resolve(root, "apps/web/src/server/providers/runpod-v207-readonly-reconciliation.ts"),
  orchestrator: resolve(root, "apps/web/src/server/providers/v207-live-orchestrator.ts"),
};
const expected = {
  proposal: "sha256:11203e32aff804dd9f31c674cd3411c8a0efb2cdca7057e891543f30377f5e57",
  acceptance: "sha256:d38096058821aa2d2eb76216960b1e6ceabee725328b55c82e47ce0828e74259",
  authority: "sha256:a9d68f4125f58429699fe52e90ae238b72f0835b4627f9246be86b10e759352b",
  max1: "sha256:26387b6f18d354af2ec9f034a3bbdb0645fcd50abe932f49278c16f36b8e4b66",
  max2: "sha256:6c8093e0292d53c5288904bcedb36b5f26a4f98c1109a16c7a9be0e9ddbf870f",
  control: "5aa2ccae639052fb61312a3b5a830402c275a2f8",
  source: "4249cafd4a5525b5723d0811f16496fb0e949653",
  handler: "sha256:dfc2cebede44c0a8903daf0e6348040cd6e2b5af1a00c77d3f767ddb10aa316c",
  schema: "sha256:a94bf2c8c4175eef3f84ab719118c2b9b5b501ce8b2708c28713b25521b71c71",
  image: "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:d37242d8413b1a5e52c2434b0ff12a04093ec5fdfacaed72faeb86fa2cbc67f2",
  manifest: "sha256:d37242d8413b1a5e52c2434b0ff12a04093ec5fdfacaed72faeb86fa2cbc67f2",
  config: "sha256:09d2ee0905ec4556857aae9df05b449802916cdf9e0d8ec4615a91b6d1fa9d06",
  layer: "sha256:1b390600563d813a87e09c2fa075d52ea1c24558e83b67c5649aa422a2c69c78",
  diffId: "sha256:0391cef74dd661df3c2c7b8b4fea1b391063abea0cfc004c806078a004915163",
  base: "sha256:8a5b8f453c694b2eeee097e3d958b08c5e47c15290b5cdc17a4fb7e5e3e4f497",
  parentConfig: "sha256:de5c854ae5aa9e611e218b89d29a250eb03a0a316f0ac92d584d53a038d06ff2",
  model: "Comfy-Org/Mage-Flow@d8c99241f6fa80fbd453014234af2bf337ea21e6#int8-convrot",
  modelManifest: "sha256:cebcd5c6233c2eae32f26ced7510acef8192f0d92d7ec3e9dd3ee881d66d205b",
  volume: "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619",
  priorProposal: "sha256:8613f60fb65a3d7c254daeb42901b217d392566bef11dfaa864d7cbbe000378c",
  priorAuthority: "sha256:1933bf186c235089c13edfee0e68a28b2fa0ab2ebc89a25f81bb59a7eedd92b6",
  priorClosure: "sha256:ab89f5f143c2f424c811a149e96ed0020b0095ce3399c5bbe33e64bb771a1a07",
  priorCleanup: "sha256:52d73dcbd15ca96e713306bf95877b1d2873025b934bab14306dae6011988ca4",
  priorReconciliation: "sha256:a9d6b96952892a33460e1aa592bbc97c8d6c3aad0d0580dda0f829d843788e10",
};
const fail = (code) => { throw new Error(`V207_ATTEMPT39_PROPOSAL_${code}`); };
const assert = (condition, code) => { if (!condition) fail(code); };
const bytes = (path) => readFileSync(path);
const text = (path) => bytes(path).toString("utf8");
const json = (path) => JSON.parse(text(path));
const sha = (path) => `sha256:${createHash("sha256").update(bytes(path)).digest("hex")}`;
const includesAll = (value, needles, code) => {
  for (const needle of needles) assert(value.includes(needle), `${code}_${needle}`);
};

for (const [name, hash] of Object.entries({
  proposal: expected.proposal,
  acceptance: expected.acceptance,
  authority: expected.authority,
  max1: expected.max1,
  max2: expected.max2,
})) assert(sha(paths[name]) === hash, `${name.toUpperCase()}_HASH`);

const proposal = json(paths.proposal);
const acceptance = json(paths.acceptance);
const authority = json(paths.authority);
const max1 = json(paths.max1);
const max2 = json(paths.max2);
const configs = [max1, max2];
const ids = Array.from({ length: 32 }, (_, index) => `scene-${String(index + 1).padStart(2, "0")}`);

assert(
  proposal.schema_version === "videoforge.v2-07-attempt39-fresh-cap-rollback-retention-combined-live-proposal/v1" &&
    proposal.attempt === 39 && proposal.checkpoint === "V2-07" && proposal.task_id === "VF-10-07" &&
    proposal.authority_mode === "PENDING_FRESH_EXACT_APPROVAL_AND_NUMERIC_CAP" &&
    proposal.provider_mutation === false && proposal.publication === false && proposal.gpu_use === false &&
    proposal.spend_usd === 0,
  "SCOPE",
);
assert(
  proposal.execution_boundary?.maximum_cumulative_finite_spend_usd === null &&
    proposal.execution_boundary?.provider_calls_completed === true &&
    proposal.execution_boundary?.runpod_mutation_authorized_pending_execution === false &&
    proposal.execution_boundary?.gpu_use_authorized_pending_execution === false &&
    proposal.execution_boundary?.retained_volume_mutation_authorized === false &&
    proposal.execution_boundary?.v2_08_authorized === false &&
    proposal.execution_boundary?.read_only_refresh_completed === true &&
    proposal.execution_boundary?.fresh_cap_required === true &&
    proposal.execution_boundary?.authority_file_present === false,
  "BOUNDARY",
);
assert(
  proposal.user_approval?.exact_proposal_approved === false &&
    proposal.user_approval?.flashboot_true_requested === true &&
    proposal.user_approval?.minimum_approved_availability_requested === "LOW" &&
    proposal.user_approval?.maximum_cumulative_finite_spend_usd === null &&
    proposal.user_approval?.fresh_positive_numeric_cap_required === true &&
    proposal.user_approval?.prior_authority_or_cap_reuse_forbidden === true,
  "APPROVAL_STATE",
);

const lineage = proposal.lineage;
assert(
  lineage?.model === expected.model && lineage?.model_manifest_sha256 === expected.modelManifest &&
    lineage?.volume_id_sha256 === expected.volume && lineage?.volume_size_gb === 50 &&
    lineage?.volume_region === "EU-RO-1" && lineage?.volume_mount === "/runpod-volume" &&
    lineage?.model_root === "/runpod-volume/mage-model" &&
    lineage?.volume_write_policy === "APPLICATION_READ_ONLY" &&
    lineage?.image_source_commit === expected.source && lineage?.control_source_commit === expected.control &&
    lineage?.handler_source_sha256 === expected.handler &&
    lineage?.execution_subset_schema_sha256 === expected.schema &&
    lineage?.image_manifest_sha256 === expected.manifest && lineage?.image_config_sha256 === expected.config &&
    lineage?.image_layer_sha256 === expected.layer && lineage?.image_layer_diff_id === expected.diffId &&
    lineage?.image_base_sha256 === expected.base && lineage?.image_parent_config_sha256 === expected.parentConfig &&
    lineage?.final_image === expected.image &&
    lineage?.image_publication_state === "ALREADY_PUBLISHED_EXACT_DIGEST_READBACK_PASS_NO_REPUBLICATION",
  "LINEAGE",
);
assert(
  lineage?.prior_attempt?.attempt === 38 && lineage.prior_attempt.proposal_sha256 === expected.priorProposal &&
    lineage.prior_attempt.authority_sha256 === expected.priorAuthority &&
    lineage.prior_attempt.closure_sha256 === expected.priorClosure &&
    lineage.prior_attempt.cleanup_sha256 === expected.priorCleanup &&
    lineage.prior_attempt.reconciliation_sha256 === expected.priorReconciliation &&
    lineage.prior_attempt.authority_consumed === true && lineage.prior_attempt.qualification_status === "NOT_QUALIFIED",
  "PRIOR_ATTEMPT",
);
assert(
  lineage?.runtime_execution_contract?.runtime_download_or_quantization === false &&
    lineage.runtime_execution_contract.cache_escape_forbidden === true &&
    lineage.runtime_execution_contract.real_initialization_warmup_required === true &&
    lineage.runtime_execution_contract.durable_per_unit_resume ===
      "RETRY_ONLY_UNRESOLVED_UNACCEPTED_UNITS_NEVER_REGENERATE_ACCEPTED_UNITS",
  "RUNTIME_CONTRACT",
);

assert(
  JSON.stringify(proposal.execution_plan?.item_ids) === JSON.stringify(ids) &&
    JSON.stringify(proposal.execution_plan?.seed?.item_ids) === JSON.stringify([ids[0]]) &&
    proposal.execution_plan.seed.exact_dispatch_count === 1 &&
    proposal.execution_plan.seed.terminal_scale_zero_required_before_replacement === true &&
    JSON.stringify(proposal.execution_plan.replacement.item_ids) === JSON.stringify(ids.slice(1)) &&
    proposal.execution_plan.replacement.exact_dispatch_count === 1 &&
    proposal.execution_plan.replacement.distinct_process_required === true &&
    proposal.execution_plan.replacement.unresolved_only === true &&
    proposal.execution_plan.replacement.accepted_units_never_regenerated === true &&
    proposal.execution_plan.merge.requires_exact_32_unique_items === true &&
    proposal.execution_plan.merge.requires_plan_order === true &&
    proposal.execution_plan.merge.requires_durable_readbacks_and_v3_receipts === true,
  "EXECUTION_PLAN",
);
assert(
  proposal.qualification_runs?.cold_and_warm === true &&
    proposal.qualification_runs.duplicate_delivery_same_job_no_second_run === true &&
    proposal.qualification_runs.two_simultaneous_read_only_workers?.uses_max2_only === true &&
    proposal.qualification_runs.cancel?.includes("CANCELED") && proposal.qualification_runs.timeout?.includes("TIMED_OUT"),
  "QUALIFICATION_PLAN",
);
assert(
  proposal.approved_operations_to_be_proposed_once?.[0]?.includes("without republication") &&
    proposal.approved_operations_to_be_proposed_once.some((value) => value.includes("newest seven")) &&
    proposal.approved_operations_to_be_proposed_once.some((value) => value.includes("404 V207_ROUTE_DISABLED")) &&
    proposal.approved_operations_to_be_proposed_once.at(-1) === "stop before V2-08",
  "OPERATIONS",
);

for (const [index, config] of configs.entries()) {
  const max = index + 1;
  assert(
    config.schema_version === "videoforge.v2-07-staged-endpoint-definition/v9" &&
      config.image === expected.image && config.image_source_commit === expected.source &&
      config.control_source_commit === expected.control && config.handler_source_sha256 === expected.handler &&
      config.execution_subset_schema_sha256 === expected.schema && config.workers_min === 0 &&
      config.workers_max === max && config.gpu_type_ids?.length === 1 &&
      config.gpu_type_ids[0] === "NVIDIA GeForce RTX 4090" &&
      ((max === 1 && config.gpu_count === 1) || (max === 2 && config.gpu_count_per_worker === 1)),
    `CONFIG_${max}_IDENTITY`,
  );
  assert(
    config.compute_type === "GPU" && config.flex_only === true && config.flashboot === true &&
      config.region === "EU-RO-1" && config.network_volume_id_sha256 === expected.volume &&
      config.network_volume_size_gb === 50 && config.network_volume_region === "EU-RO-1" &&
      config.network_volume_mount === "/runpod-volume" && config.model_root === "/runpod-volume/mage-model" &&
      config.volume_write_policy === "APPLICATION_READ_ONLY" && config.scaler_type === "REQUEST_COUNT" &&
      config.scaler_value === 1 && config.handler_concurrency === 1 && config.idle_timeout_seconds === 5 &&
      config.init_timeout_seconds === 800 && config.execution_timeout_seconds === 2400 &&
      config.request_authority_ttl_seconds === 7200,
    `CONFIG_${max}_POLICY`,
  );
  assert(
    config.fresh_cap_contract?.billing_measurement === "CUMULATIVE_ENDPOINT_TOTAL" &&
      config.fresh_cap_contract.approved_cap_is_incremental_allowance === true &&
      config.fresh_cap_contract.baseline_is_pre_attempt_cumulative_total === true &&
      config.fresh_cap_contract.downward_or_invalid_billing_read_fails_closed === true &&
      config.cloudflare_rollback_contract?.capture_active_version_record_before_any_mutation === true &&
      config.cloudflare_rollback_contract.capture_active_version_record_sha256 === true &&
      config.cloudflare_rollback_contract.versions_list_limit === 10 &&
      config.cloudflare_rollback_contract.required_anchor_retention === "NEWEST_SEVEN" &&
      config.cloudflare_rollback_contract.reject_absent_or_older_anchor_before_any_worker_or_secret_mutation === true &&
      config.cloudflare_rollback_contract.restore_exact_version_and_record_hash === true &&
      config.cloudflare_rollback_contract.latest_observed_route_status === 404 &&
      config.cloudflare_rollback_contract.latest_observed_route_code === "V207_ROUTE_DISABLED",
    `CONFIG_${max}_SAFETY`,
  );
}
assert(
  proposal.staged_endpoint_configs?.[0]?.definition_sha256 === expected.max1 &&
    proposal.staged_endpoint_configs?.[1]?.definition_sha256 === expected.max2 &&
    proposal.staged_endpoint_configs?.[0]?.control_source_commit === expected.control &&
    proposal.staged_endpoint_configs?.[1]?.control_source_commit === expected.control,
  "STAGED_HASHES",
);
assert(
  proposal.read_only_preflight?.checked_at === "2026-08-23T01:40:52.298Z" &&
    proposal.read_only_preflight.availability_observed === "HIGH" &&
    proposal.read_only_preflight.read_only_refresh_required_before_mutation === false &&
    proposal.read_only_preflight.pods === 0 && proposal.read_only_preflight.endpoints === 0 &&
    proposal.read_only_preflight.private_templates === 0 && proposal.read_only_preflight.active_workers === 0 &&
    proposal.read_only_preflight.running_pods === 0 &&
    proposal.read_only_preflight.latest_observed_cloudflare_route?.status === 404 &&
    proposal.read_only_preflight.latest_observed_cloudflare_route.code === "V207_ROUTE_DISABLED" &&
    proposal.read_only_preflight.retained_volumes?.length === 2,
  "READ_ONLY_PREFLIGHT",
);
assert(
  proposal.cost_estimate?.finite_action_estimate_usd === 3.7 &&
    proposal.cost_estimate.proposed_finite_cap_usd === null &&
    proposal.cost_estimate.current_provider_rate_usd_per_gpu_hour === 1.1 &&
    proposal.cost_estimate.secure_reference_rate_usd_per_hour === 0.74 &&
    proposal.cost_estimate.ongoing_retained_volume_charge_usd_per_month === 7 &&
    proposal.cost_estimate.ongoing_volume_charge_separate_from_finite_cap === true &&
    proposal.cost_estimate.fresh_cap_arithmetic?.approved_cap_is_incremental_allowance === true &&
    proposal.cost_estimate.fresh_cap_arithmetic.cumulative_billing_threshold_formula ===
      "baseline_endpoint_spend_usd + maximum_incremental_spend_usd",
  "COST_BOUNDARY",
);

assert(
  acceptance.schema_version === "videoforge.v2-07-attempt39-provider-free-candidate-acceptance/v1" &&
    acceptance.attempt === 39 && acceptance.result === "APPROVED_SINGLE_USE_PENDING_EXECUTION" &&
    acceptance.qualification_status === "NOT_QUALIFIED_PENDING_EXECUTION" &&
    acceptance.candidate?.proposal_sha256 === expected.proposal &&
    acceptance.candidate.max1_sha256 === expected.max1 && acceptance.candidate.max2_sha256 === expected.max2 &&
    acceptance.candidate.control_source_commit === expected.control &&
    acceptance.candidate.authority_recorded === true && acceptance.candidate.authority_path === "approved-authority.json" &&
    acceptance.candidate.authority_sha256 === expected.authority && acceptance.candidate.maximum_cumulative_finite_spend_usd === 4 &&
    acceptance.candidate.fresh_numeric_cap_required === true,
  "ACCEPTANCE",
);
assert(
  acceptance.provider_boundary?.provider_calls === true && acceptance.provider_boundary.provider_mutations === true &&
    acceptance.provider_boundary.gpu_use === false && acceptance.provider_boundary.authority_active === true &&
    acceptance.provider_boundary.cap_usd === 4 && acceptance.provider_boundary.external_spend_usd === 0 &&
    acceptance.provider_boundary.v2_08_authorized === false && acceptance.provider_boundary.authority_file_present === true &&
    acceptance.provider_boundary.read_only_refresh_required_before_mutation === false &&
    acceptance.provider_boundary.read_only_refresh_completed === true &&
    acceptance.provider_boundary.rollback_anchor_newest_seven_retention_required === true,
  "ACCEPTANCE_BOUNDARY",
);

const state = text(paths.state);
const gates = text(paths.gates);
const start = text(paths.start);
const task = text(paths.task);
const activation = text(paths.activation);
const reconciliation = text(paths.reconciliation);
const orchestrator = text(paths.orchestrator);
const candidatePath = "2026-08-23-attempt39-fresh-cap-rollback-retention-candidate";
includesAll(state, [candidatePath, expected.proposal, expected.acceptance, expected.authority, expected.max1, expected.max2, expected.control, "pending_authority: evidence/acceptance/VF-10-07/2026-08-23-attempt39-fresh-cap-rollback-retention-candidate/approved-authority.json", "maximum_external_spend_usd: 4", "provider_calls_authorized: true"], "STATE");
includesAll(gates, [candidatePath, expected.proposal, expected.acceptance, expected.authority, expected.max1, expected.max2, expected.control, "pending_authority: \"evidence/acceptance/VF-10-07/2026-08-23-attempt39-fresh-cap-rollback-retention-candidate/approved-authority.json\"", "pending_numeric_cap_usd: 4", "provider_calls_authorized: true"], "GATES");
includesAll(start, [candidatePath, expected.proposal, expected.authority, expected.control, "user approved it", "V2-08 remain forbidden"], "START");
includesAll(task, [candidatePath, expected.proposal, expected.authority, expected.control, "fresh maximum cumulative finite spend of `$4`", "V2-08 remains forbidden"], "TASK");
assert(activation.includes(expected.proposal) && activation.includes(expected.control) && activation.includes(expected.authority), "ACTIVATION_AUTHORITY_BINDING");
assert(
  authority.attempt === 39 && authority.status === "APPROVED_SINGLE_USE_PENDING_EXECUTION" &&
    authority.proposal?.sha256 === expected.proposal && authority.approval?.exact_proposal_approved === true &&
    authority.approval?.flashboot_true_accepted === true && authority.approval?.low_or_better_eu_ro_1_availability_approved === true &&
    authority.approval?.minimum_approved_availability === "LOW" && authority.approval?.maximum_cumulative_finite_spend_usd === 4 &&
    authority.approval?.consumed === false && authority.lineage?.control_source_commit === expected.control &&
    authority.lineage?.initial_config_sha256 === expected.max1 && authority.lineage?.concurrent_reader_config_sha256 === expected.max2 &&
    authority.execution_boundary?.retained_volume_mutation_authorized === false && authority.execution_boundary?.v2_08_authorized === false,
  "AUTHORITY_BINDING",
);
assert(reconciliation.includes("v207IncrementalSpendThreshold") && reconciliation.includes("v207IncrementalSpendFromBilling"), "FRESH_CAP_SOURCE");
assert(orchestrator.includes("assertV207WorkerRollbackAnchorRetained") && orchestrator.includes("V207_WORKER_VERSION_NEWEST_COUNT") && orchestrator.includes("versions"), "ROLLBACK_RETENTION_SOURCE");

console.log("V2-07 Attempt39 fresh-cap/rollback-retention proposal validation PASS (approved single-use authority; pending execution; zero Attempt39 spend)");

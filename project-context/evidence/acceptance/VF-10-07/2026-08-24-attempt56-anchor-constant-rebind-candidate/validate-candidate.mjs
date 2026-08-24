#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const dir = import.meta.dirname;
const root = path.resolve(dir, "../../../../../");
const E = {
  proposal: "sha256:d3c10f7af00591dea0afe73d2960b316a788235bb2585decab6ca479b4ce9ab9",
  acceptance: "sha256:3ddaf8f9fde45f93de0a9c4a770a09bc117168ff27dbd2ec312e7516cf9c094d",
  preflight: "sha256:4a1f95ee496afabedc33ca148bee8543010600ea302966f4b66b8b23c2425373",
  max1: "sha256:6bba5f707e19352b2935129429665f1a488f241065c9c84fe814a2f8677dae7a",
  max2: "sha256:19d4824c205b5c3c17edc351d7762578b249caee497d60ec4d8ff762fd41b37b",
  control: "85391b130673200e2d1f74fea4ea2581d5d83c1a",
  anchorRepair: "5c2fbe06ba559543c122876d32ef41cb26fd688b",
  orchestrator: "sha256:3d0580e1b6e4c8fedb3d1be6e7a639b89b0a53562d1806b0dc02eeca435b608c",
  canonical: "sha256:36a23948ce41b7344af81a8a8abfd44e7d356d9a12c10731aefed1f3ce36a6b3",
  anchorVersion: "sha256:36256382df0f40b1e654b041d5bfbcadefac429ab0b9de0709b567975e7a8ad6",
  anchorRecord: "sha256:9e37db7bcf43625ea1ff0679f3ed421d50ad4e951088e2fa0cdbfc707a0afac2",
};

const bytes = (file) => fs.readFileSync(file);
const text = (file) => bytes(file).toString("utf8");
const json = (file) => JSON.parse(text(file));
const sha = (file) => `sha256:${crypto.createHash("sha256").update(bytes(file)).digest("hex")}`;
const fail = (code) => {
  throw new Error(`V207_ATTEMPT56_${code}`);
};
const eq = (actual, expected, code) => {
  if (actual !== expected) fail(code);
};
const yes = (value, code) => {
  if (!value) fail(code);
};
const file = (name) => path.join(dir, name);

for (const [name, expected] of Object.entries({
  "combined-live-proposal.json": E.proposal,
  "acceptance.json": E.acceptance,
  "read-only-preflight.json": E.preflight,
  "staged-config-max1.json": E.max1,
  "staged-config-max2.json": E.max2,
})) {
  eq(sha(file(name)), expected, `${name.replaceAll(".", "_")}_HASH`);
}

// Attempt56 is an unapproved provider-free candidate. A same-directory authority file would
// make the candidate ambiguously executable, so fail closed if one is introduced.
yes(!fs.existsSync(file("approved-authority.json")), "APPROVED_AUTHORITY_FILE_PRESENT");

const proposal = json(file("combined-live-proposal.json"));
const acceptance = json(file("acceptance.json"));
const preflight = json(file("read-only-preflight.json"));
const max1 = json(file("staged-config-max1.json"));
const max2 = json(file("staged-config-max2.json"));
const configs = [max1, max2];

eq(proposal.attempt, 56, "ATTEMPT");
eq(proposal.authority_mode, "PENDING_FRESH_EXACT_APPROVAL_AND_POSITIVE_NUMERIC_CAP", "AUTHORITY_MODE");
eq(proposal.provider_calls_authorized, false, "PROVIDER_CALLS");
eq(proposal.provider_mutation_authorized, false, "PROVIDER_MUTATION");
eq(proposal.gpu_use_authorized, false, "GPU_USE");
eq(proposal.qualification_status, "NOT_QUALIFIED", "QUALIFICATION_STATUS");
eq(proposal.approval_request.exact_proposal_approved, false, "UNAPPROVED");
eq(proposal.approval_request.fresh_exact_approval_required, true, "FRESH_APPROVAL_REQUIRED");
eq(proposal.approval_request.requested_maximum_cumulative_finite_spend_usd, 4, "REQUESTED_CAP");
eq(proposal.approval_request.executable_cap_binding, null, "NULL_CAP");
eq(proposal.approval_request.anchor_refresh_mode, "two-phase-v1", "REFRESH_MODE");
eq(proposal.approval_request.anchor_refresh_authorized, null, "NULL_REFRESH");
eq(proposal.approval_request.flashboot, true, "FLASHBOOT");
eq(proposal.approval_request.minimum_availability, "LOW-or-better", "MIN_AVAILABILITY");
eq(proposal.approval_request.last_observed_availability, "LOW", "OBSERVED_AVAILABILITY");
eq(proposal.approval_request.attempt55_authority_or_cap_reuse_forbidden, true, "ATTEMPT55_AUTHORITY_REUSE");
eq(proposal.approval_request.attempt55_proposal_reuse_forbidden, true, "ATTEMPT55_PROPOSAL_REUSE");
eq(proposal.approval_request.executable_anchor_constants_binding_required, true, "ANCHOR_BINDING_REQUIRED");
eq(proposal.approval_request.validator_gate_required, true, "VALIDATOR_REQUIRED");
eq(proposal.provider_free_lineage.control_source_commit, E.control, "PROPOSAL_CONTROL");
eq(proposal.provider_free_lineage.anchor_repair_commit, E.anchorRepair, "PROPOSAL_ANCHOR_REPAIR");
eq(proposal.provider_free_lineage.orchestrator_source_sha256, E.orchestrator, "PROPOSAL_ORCHESTRATOR");
eq(proposal.provider_free_lineage.canonical_activation_source_sha256, E.canonical, "PROPOSAL_CANONICAL");
eq(proposal.provider_free_preflight.sha256, E.preflight, "PROPOSAL_PREFLIGHT");
eq(proposal.fresh_cloudflare_read_only_truth.active_version_id_sha256, E.anchorVersion, "PROPOSAL_ANCHOR_VERSION");
eq(proposal.fresh_cloudflare_read_only_truth.active_record_sha256, E.anchorRecord, "PROPOSAL_ANCHOR_RECORD");
eq(proposal.fresh_cloudflare_read_only_truth.active_anchor_retained, true, "PROPOSAL_ANCHOR_RETAINED");
eq(proposal.fresh_cloudflare_read_only_truth.active_anchor_index_oldest_to_newest, 7, "PROPOSAL_ANCHOR_INDEX");
eq(proposal.fresh_cloudflare_read_only_truth.version_window_length, 10, "PROPOSAL_VERSION_WINDOW");
eq(proposal.fresh_cloudflare_read_only_truth.protected_signer_secret_present, false, "PROPOSAL_SIGNER");
eq(proposal.fresh_cloudflare_read_only_truth.disabled_route_probe, "POST_404_V207_ROUTE_DISABLED_WITH_EXACT_ACTIVE_VERSION_HEADER", "PROPOSAL_ROUTE");
eq(proposal.fresh_runpod_read_only_truth.pods, 0, "PROPOSAL_PODS");
eq(proposal.fresh_runpod_read_only_truth.endpoints, 0, "PROPOSAL_ENDPOINTS");
eq(proposal.fresh_runpod_read_only_truth.private_templates, 0, "PROPOSAL_TEMPLATES");
eq(proposal.fresh_runpod_read_only_truth.active_workers, 0, "PROPOSAL_ACTIVE_WORKERS");
eq(proposal.fresh_runpod_read_only_truth.running_pods, 0, "PROPOSAL_RUNNING_PODS");
eq(proposal.fresh_runpod_read_only_truth.retained_volumes, 2, "PROPOSAL_VOLUMES");
eq(proposal.fresh_runpod_read_only_truth.incremental_spend_during_preflight_usd, 0, "PROPOSAL_PREFLIGHT_SPEND");
eq(proposal.fresh_catalog_read_only_truth.region, "EU-RO-1", "PROPOSAL_REGION");
eq(proposal.fresh_catalog_read_only_truth.availability, "LOW", "PROPOSAL_CATALOG_AVAILABILITY");
eq(proposal.fresh_catalog_read_only_truth.minimum_requested, "LOW-or-better", "PROPOSAL_CATALOG_THRESHOLD");
eq(proposal.fresh_catalog_read_only_truth.minimum_satisfied, true, "PROPOSAL_CATALOG_SATISFIED");
eq(proposal.fresh_catalog_read_only_truth.flashboot, true, "PROPOSAL_CATALOG_FLASHBOOT");
eq(proposal.cost.requested_maximum_cumulative_finite_spend_usd, 4, "COST_CAP");
eq(proposal.cost.finite_action_estimate_usd_ceiling, 3.95, "COST_ESTIMATE");
eq(proposal.cost.existing_two_50gb_volumes_usd_per_month, 7, "VOLUME_RETENTION_RATE");
eq(proposal.cost.volume_charge_separate_from_finite_cap, true, "VOLUME_CHARGE_SEPARATE");
eq(proposal.retained_volume_mutation_authorized, false, "VOLUME_MUTATION");
eq(proposal.gpu_or_region_fallback_authorized, false, "GPU_REGION_FALLBACK");
eq(proposal.v2_08_authorized, false, "V208_AUTHORITY");

eq(acceptance.attempt, 56, "ACCEPTANCE_ATTEMPT");
eq(acceptance.qualification_status, "NOT_QUALIFIED", "ACCEPTANCE_STATUS");
eq(acceptance.proposal_sha256, E.proposal, "ACCEPTANCE_PROPOSAL");
eq(acceptance.preflight_sha256, E.preflight, "ACCEPTANCE_PREFLIGHT");
eq(acceptance.max1_sha256, E.max1, "ACCEPTANCE_MAX1");
eq(acceptance.max2_sha256, E.max2, "ACCEPTANCE_MAX2");
eq(acceptance.lineage_acceptance.control_source_commit, E.control, "ACCEPTANCE_CONTROL");
eq(acceptance.lineage_acceptance.anchor_repair_commit, E.anchorRepair, "ACCEPTANCE_ANCHOR_REPAIR");
eq(acceptance.lineage_acceptance.orchestrator_source_sha256, E.orchestrator, "ACCEPTANCE_ORCHESTRATOR");
eq(acceptance.lineage_acceptance.canonical_activation_source_sha256, E.canonical, "ACCEPTANCE_CANONICAL");
eq(acceptance.lineage_acceptance.both_configs_exactly_match_repaired_lineage, true, "ACCEPTANCE_CONFIG_LINEAGE");
eq(acceptance.lineage_acceptance.attempt55_config_reuse, false, "ACCEPTANCE_ATTEMPT55_CONFIG_REUSE");
eq(acceptance.lineage_acceptance.attempt55_authority_or_cap_reuse, false, "ACCEPTANCE_ATTEMPT55_AUTHORITY_REUSE");
eq(acceptance.lineage_acceptance.attempt55_proposal_reuse, false, "ACCEPTANCE_ATTEMPT55_PROPOSAL_REUSE");
eq(acceptance.provider_state.provider_mutations, 0, "ACCEPTANCE_MUTATIONS");
eq(acceptance.provider_state.gpu_jobs_submitted, 0, "ACCEPTANCE_GPU_JOBS");
eq(acceptance.provider_state.external_spend_usd, 0, "ACCEPTANCE_SPEND");
eq(acceptance.provider_state.runpod_zero_compute, true, "ACCEPTANCE_ZERO_COMPUTE");
eq(acceptance.provider_state.cloudflare_exact_version_bound_disabled_route, true, "ACCEPTANCE_ROUTE");
eq(acceptance.provider_state.two_existing_volumes_retained, true, "ACCEPTANCE_VOLUMES");
eq(acceptance.v2_08_started, false, "ACCEPTANCE_V208");
eq(acceptance.authority.exact_proposal_approved, false, "ACCEPTANCE_APPROVED");
eq(acceptance.authority.authority_recorded, false, "ACCEPTANCE_AUTHORITY_RECORDED");
eq(acceptance.authority.maximum_cumulative_finite_spend_usd, null, "ACCEPTANCE_NULL_CAP");
eq(acceptance.authority.executable_cap_binding, null, "ACCEPTANCE_NULL_EXECUTABLE_CAP");
eq(acceptance.authority.anchor_refresh_authorized, null, "ACCEPTANCE_NULL_REFRESH");
eq(acceptance.authority.provider_mutations_authorized, false, "ACCEPTANCE_AUTHORITY_MUTATION");
eq(acceptance.authority.gpu_use_authorized, false, "ACCEPTANCE_AUTHORITY_GPU");
eq(acceptance.authority.v2_08_authorized, false, "ACCEPTANCE_AUTHORITY_V208");

eq(preflight.attempt, 56, "PREFLIGHT_ATTEMPT");
eq(preflight.read_only, true, "PREFLIGHT_READ_ONLY");
eq(preflight.fresh_provider_read, true, "PREFLIGHT_FRESH_READ");
eq(preflight.provider_mutations, 0, "PREFLIGHT_MUTATIONS");
eq(preflight.gpu_jobs_submitted, 0, "PREFLIGHT_GPU_JOBS");
eq(preflight.external_spend_usd, 0, "PREFLIGHT_SPEND");
eq(preflight.runpod.pods, 0, "PREFLIGHT_PODS");
eq(preflight.runpod.endpoints, 0, "PREFLIGHT_ENDPOINTS");
eq(preflight.runpod.private_templates, 0, "PREFLIGHT_TEMPLATES");
eq(preflight.runpod.active_serverless_workers, 0, "PREFLIGHT_ACTIVE_WORKERS");
eq(preflight.runpod.running_pods, 0, "PREFLIGHT_RUNNING_PODS");
eq(preflight.runpod.retained_volume_count, 2, "PREFLIGHT_VOLUMES");
eq(preflight.runpod.incremental_spend_usd, 0, "PREFLIGHT_RUNPOD_SPEND");
eq(preflight.cloudflare.active_version_id_sha256, E.anchorVersion, "PREFLIGHT_ANCHOR_VERSION");
eq(preflight.cloudflare.active_record_sha256, E.anchorRecord, "PREFLIGHT_ANCHOR_RECORD");
eq(preflight.cloudflare.active_anchor_retained, true, "PREFLIGHT_ANCHOR_RETAINED");
eq(preflight.cloudflare.protected_signer_secret_present, false, "PREFLIGHT_SIGNER");
eq(preflight.cloudflare.exact_route_probe.status, 404, "PREFLIGHT_ROUTE_STATUS");
eq(preflight.cloudflare.exact_route_probe.code, "V207_ROUTE_DISABLED", "PREFLIGHT_ROUTE_CODE");
eq(preflight.cloudflare.exact_route_probe.worker_version_header_present, true, "PREFLIGHT_ROUTE_HEADER");
eq(preflight.cloudflare.exact_route_probe.worker_version_id_sha256, E.anchorVersion, "PREFLIGHT_ROUTE_VERSION");
eq(preflight.cloudflare.exact_route_probe.matches_active_version, true, "PREFLIGHT_ROUTE_MATCH");
eq(preflight.authority.exact_proposal_approved, false, "PREFLIGHT_APPROVED");
eq(preflight.authority.authority_recorded, false, "PREFLIGHT_AUTHORITY_RECORDED");
eq(preflight.authority.maximum_cumulative_finite_spend_usd, null, "PREFLIGHT_NULL_CAP");
eq(preflight.authority.provider_mutations_authorized, false, "PREFLIGHT_AUTHORITY_MUTATION");
eq(preflight.authority.gpu_use_authorized, false, "PREFLIGHT_AUTHORITY_GPU");
eq(preflight.authority.v2_08_authorized, false, "PREFLIGHT_AUTHORITY_V208");
eq(preflight.raw_provider_ids_urls_bodies_or_secrets_retained, false, "PREFLIGHT_RAW_DATA");

for (const [index, config] of configs.entries()) {
  const workersMax = index + 1;
  const anchor = config.executable_anchor_constants_binding;
  const refresh = config.cloudflare_anchor_refresh_contract;
  eq(config.control_source_commit, E.control, `CONFIG_${workersMax}_CONTROL`);
  eq(config.historical_control_repair_commit, E.control, `CONFIG_${workersMax}_HISTORICAL_CONTROL`);
  eq(config.anchor_repair_commit, E.anchorRepair, `CONFIG_${workersMax}_ANCHOR_REPAIR`);
  eq(config.source_hashes.orchestrator_sha256, E.orchestrator, `CONFIG_${workersMax}_ORCHESTRATOR`);
  eq(config.source_hashes.canonical_activation_sha256, E.canonical, `CONFIG_${workersMax}_CANONICAL`);
  eq(anchor.source_file, "apps/web/src/server/providers/v207-live-orchestrator.ts", `CONFIG_${workersMax}_ANCHOR_SOURCE_FILE`);
  eq(anchor.source_sha256, E.orchestrator, `CONFIG_${workersMax}_ANCHOR_SOURCE_HASH`);
  eq(anchor.repair_commit, E.anchorRepair, `CONFIG_${workersMax}_ANCHOR_REPAIR_BINDING`);
  eq(anchor.expected_old_active_version_constant, "V207_ANCHOR_REFRESH_EXPECTED_OLD_ACTIVE_VERSION_ID_SHA256", `CONFIG_${workersMax}_VERSION_CONSTANT`);
  eq(anchor.expected_old_active_version_sha256, E.anchorVersion, `CONFIG_${workersMax}_VERSION_ANCHOR`);
  eq(anchor.expected_old_active_record_constant, "V207_ANCHOR_REFRESH_EXPECTED_OLD_ACTIVE_RECORD_SHA256", `CONFIG_${workersMax}_RECORD_CONSTANT`);
  eq(anchor.expected_old_active_record_sha256, E.anchorRecord, `CONFIG_${workersMax}_RECORD_ANCHOR`);
  eq(anchor.matches_fresh_cloudflare_read, true, `CONFIG_${workersMax}_FRESH_ANCHOR`);
  eq(config.region, "EU-RO-1", `CONFIG_${workersMax}_REGION`);
  eq(config.network_volume_region, "EU-RO-1", `CONFIG_${workersMax}_VOLUME_REGION`);
  eq(config.network_volume_size_gb, 50, `CONFIG_${workersMax}_VOLUME_SIZE`);
  eq(config.network_volume_mount, "/runpod-volume", `CONFIG_${workersMax}_VOLUME_MOUNT`);
  eq(config.workers_min, 0, `CONFIG_${workersMax}_MIN`);
  eq(config.workers_max, workersMax, `CONFIG_${workersMax}_MAX`);
  eq(config.flashboot, true, `CONFIG_${workersMax}_FLASHBOOT`);
  eq(config.availability_threshold, "LOW-or-better", `CONFIG_${workersMax}_AVAILABILITY`);
  eq(config.cloudflare_anchor_refresh_contract.activation, "V207_ROLLBACK_ANCHOR_REFRESH=two-phase-v1", `CONFIG_${workersMax}_REFRESH`);
  eq(refresh.expected_old_active_version_id_sha256, E.anchorVersion, `CONFIG_${workersMax}_REFRESH_VERSION`);
  eq(refresh.expected_old_active_record_sha256, E.anchorRecord, `CONFIG_${workersMax}_REFRESH_RECORD`);
  eq(refresh.executable_anchor_constants_binding.version_sha256, E.anchorVersion, `CONFIG_${workersMax}_REFRESH_BINDING_VERSION`);
  eq(refresh.executable_anchor_constants_binding.record_sha256, E.anchorRecord, `CONFIG_${workersMax}_REFRESH_BINDING_RECORD`);
  eq(refresh.executable_anchor_constants_binding.source_sha256, E.orchestrator, `CONFIG_${workersMax}_REFRESH_BINDING_SOURCE`);
  eq(refresh.executable_anchor_constants_binding.repair_commit, E.anchorRepair, `CONFIG_${workersMax}_REFRESH_BINDING_REPAIR`);
  eq(refresh.pre_and_post_refresh_route, "POST_404_V207_ROUTE_DISABLED_WITH_EXACT_EXPECTED_WORKER_VERSION", `CONFIG_${workersMax}_ROUTE`);
}
eq(max1.process_replacement_contract.redispatch_before_boundary, false, "MAX1_NO_REDISPATCH");
eq(max1.process_replacement_contract.additional_distinct_terminal_pod_history_allowed, true, "MAX1_HISTORY_ALLOWED");

const orchestratorPath = path.join(root, "apps/web/src/server/providers/v207-live-orchestrator.ts");
const orchestrator = text(orchestratorPath);
eq(sha(orchestratorPath), E.orchestrator, "ORCHESTRATOR_BYTES");
const readAnchorConstant = (name, code) => {
  const declarationPattern = new RegExp(`^export\\s+const\\s+${name}\\b`, "gmu");
  const declarationCount = orchestrator.match(declarationPattern)?.length ?? 0;
  const valuePattern = new RegExp(
    `^export\\s+const\\s+${name}\\s*=\\s*\\n?\\s*"(sha256:[a-f0-9]{64})"\\s+as\\s+const\\s*;`,
    "mu",
  );
  const match = orchestrator.match(valuePattern);
  if (declarationCount !== 1 || !match) fail(code);
  return match[1];
};
eq(
  readAnchorConstant("V207_ANCHOR_REFRESH_EXPECTED_OLD_ACTIVE_VERSION_ID_SHA256", "ORCHESTRATOR_VERSION_CONSTANT"),
  E.anchorVersion,
  "ORCHESTRATOR_VERSION_ANCHOR",
);
eq(
  readAnchorConstant("V207_ANCHOR_REFRESH_EXPECTED_OLD_ACTIVE_RECORD_SHA256", "ORCHESTRATOR_RECORD_CONSTANT"),
  E.anchorRecord,
  "ORCHESTRATOR_RECORD_ANCHOR",
);

const activationPath = path.join(root, "apps/web/src/server/providers/v207-activation-authority.ts");
const activation = text(activationPath);
yes(activation.includes(E.proposal), "ACTIVATION_PROPOSAL");
yes(activation.includes(`V207_PENDING_CONTROL_SOURCE_COMMIT =\n  "${E.control}"`), "ACTIVATION_CONTROL");
yes(/^export\s+const\s+V207_APPROVED_AUTHORITY_SHA256\s*:\s*string\s*\|\s*null\s*=\s*\n?\s*null\s*;/mu.test(activation), "ACTIVATION_AUTHORITY_NULL");
yes(/^export\s+const\s+V207_APPROVED_FINITE_CAP_USD\s*:\s*number\s*\|\s*null\s*=\s*\n?\s*null\s*;/mu.test(activation), "ACTIVATION_CAP_NULL");
yes(/^export\s+const\s+V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED\s*:\s*boolean\s*\|\s*null\s*=\s*\n?\s*null\s*;/mu.test(activation), "ACTIVATION_REFRESH_NULL");

const replaceOne = (source, pattern, replacement, code) => {
  eq((source.match(pattern) ?? []).length, 1, code);
  return source.replace(pattern, replacement);
};
const canonicalActivation = (source) => {
  let result = replaceOne(
    source,
    /^export\s+const\s+V207_PENDING_PROPOSAL_SHA256\s*=\s*"sha256:[a-f0-9]{64}"\s+as\s+const\s*;/gmu,
    `export const V207_PENDING_PROPOSAL_SHA256 = "sha256:${"0".repeat(64)}" as const;`,
    "CANONICAL_PROPOSAL",
  );
  result = replaceOne(
    result,
    /^export\s+const\s+V207_APPROVED_AUTHORITY_SHA256\s*:\s*string\s*\|\s*null\s*=\s*(?:"sha256:[a-f0-9]{64}"|null)\s*;/gmu,
    "export const V207_APPROVED_AUTHORITY_SHA256: string | null = null;",
    "CANONICAL_AUTHORITY",
  );
  result = replaceOne(
    result,
    /^export\s+const\s+V207_APPROVED_FINITE_CAP_USD\s*:\s*number\s*\|\s*null\s*=\s*(?:null|(?:0|[1-9]\d*)(?:\.\d+)?)\s*;/gmu,
    "export const V207_APPROVED_FINITE_CAP_USD: number | null = null;",
    "CANONICAL_CAP",
  );
  return replaceOne(
    result,
    /^export\s+const\s+V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED\s*:\s*boolean\s*\|\s*null\s*=\s*(?:true|false|null)\s*;/gmu,
    "export const V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED: boolean | null = null;",
    "CANONICAL_REFRESH",
  );
};
eq(
  `sha256:${crypto.createHash("sha256").update(canonicalActivation(activation), "utf8").digest("hex")}`,
  E.canonical,
  "CANONICAL_ACTIVATION_BYTES",
);

console.log("PASS validate-v207-attempt56-anchor-constant-rebind-candidate", JSON.stringify(E));

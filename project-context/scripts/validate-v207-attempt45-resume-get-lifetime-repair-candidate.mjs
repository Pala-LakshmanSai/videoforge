#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const DIR = path.join(ROOT, "project-context/evidence/acceptance/VF-10-07/2026-08-23-attempt45-resume-get-lifetime-repair-candidate");
const E = {
  proposal: "sha256:a2f336fe5bb0291ef436699d60a0f6885948c4a5cf52d724a184caa917718770",
  acceptance: "sha256:106c12b6be55f870ec17c52135eb90d09aa09fb60ad119e79a0d8174318353a2",
  preflight: "sha256:7a0e66ce4cf9cddaab6aa09692ed9f6cb385f43dedf8a288ffac57a41f6abffb",
  cloudflare: "sha256:0338d443c898295dd08508e4d9ea66ab82d37475c6d29b501d9f82bd11ae16bd",
  reconciliation: "sha256:30f56deb33f0756153fc16f8ac237f1f9e53e7daea472cd4acb31dc430dba298",
  max1: "sha256:fcd591f6ad384ad5ab20ae6ab24bbec6d1e3940f07ffbc3cb33bc3be6664973c",
  max2: "sha256:8c1d60cc939c3e01f95533733259ce8de5a2a8345429327af2fd869b2dd32a2c",
  closure: "sha256:695f438b4e2908a181d668a608588659f05075e2d6aa19d6bcfcca1a87d75be4",
  repair: "1a8a12de10869d163ddf7bb4dfa3f329407ba566",
  source: "sha256:c5187fb9636d53e214d90f60c1a67a13ed06dc47c558f4869628b6d09a27a9c5",
  closureCommit: "c9772731e202ce31084d5a56e165756afcec950c",
  volume: "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619",
  modelManifest: "sha256:cebcd5c6233c2eae32f26ced7510acef8192f0d92d7ec3e9dd3ee881d66d205b",
  image: "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:79fe7e40b69c011c15cc31b2d84b356cd2c755ea338976172cd78cc581304d59",
  imageConfig: "sha256:b6c43cb1f2782540f52ac1f2f4584fea763237f1c75c8c7c1341ea70bcc915e6",
  imageLayer: "sha256:f31fc51513e3573eb859897b7bcacd4b28bb525567b7523af1c98e4f370c8c3a",
  imageDiff: "sha256:9f759e3f49c84816de71246f51f9aca275fc080c7c9c082aaa39ce81e8b049e1",
  gpu: "NVIDIA GeForce RTX 4090",
};
function fail(message) { throw new Error("V207_ATTEMPT45_CANDIDATE_INVALID: " + message); }
function ok(condition, message) { if (!condition) fail(message); }
function eq(actual, expected, label) {
  if (actual !== expected) fail(label + " expected " + JSON.stringify(expected) + " got " + JSON.stringify(actual));
}
function has(value, label) { ok(value !== undefined && value !== null, label + " missing"); }
function file(name) {
  const p = path.join(DIR, name);
  ok(fs.existsSync(p), "missing " + name);
  return p;
}
function json(name) {
  try { return JSON.parse(fs.readFileSync(file(name), "utf8")); }
  catch (error) { fail(name + " invalid JSON: " + error.message); }
}
function hash(name) {
  return "sha256:" + crypto.createHash("sha256").update(fs.readFileSync(file(name))).digest("hex");
}
function checkHash(name, expected) { eq(hash(name), expected, name + " hash"); }
function includes(name, value, label) {
  ok(fs.readFileSync(path.join(ROOT, name), "utf8").includes(value), label + " missing " + value);
}
for (const [name, expected] of Object.entries({
  "combined-live-proposal.json": E.proposal,
  "acceptance.json": E.acceptance,
  "read-only-preflight.json": E.preflight,
  "cloudflare-anchor-observation.json": E.cloudflare,
  "runpod-reconciliation-observation.json": E.reconciliation,
  "staged-config-max1.json": E.max1,
  "staged-config-max2.json": E.max2,
})) checkHash(name, expected);
ok(!fs.existsSync(path.join(DIR, "approved-authority.json")), "candidate contains authority");

const proposal = json("combined-live-proposal.json");
const acceptance = json("acceptance.json");
const preflight = json("read-only-preflight.json");
const cloudflare = json("cloudflare-anchor-observation.json");
const reconciliation = json("runpod-reconciliation-observation.json");
const max1 = json("staged-config-max1.json");
const max2 = json("staged-config-max2.json");

eq(proposal.schema_version, "videoforge.v2-07-attempt45-resume-get-lifetime-repair-combined-live-proposal/v1", "proposal schema");
eq(proposal.checkpoint, "V2-07", "proposal checkpoint");
eq(proposal.task_id, "VF-10-07", "proposal task");
eq(proposal.attempt, 45, "proposal attempt");
eq(proposal.authority_mode, "PENDING_FRESH_EXACT_APPROVAL_AND_NUMERIC_CAP", "proposal authority mode");
eq(proposal.provider_mutation, false, "proposal mutation");
eq(proposal.publication, false, "proposal publication");
eq(proposal.gpu_use, false, "proposal GPU");
eq(proposal.spend_usd, 0, "proposal spend");
eq(proposal.user_approval.exact_proposal_approved, false, "proposal approval");
eq(proposal.user_approval.flashboot_true_requested, true, "proposal FlashBoot");
eq(proposal.user_approval.minimum_approved_availability_requested, "LOW-or-better", "proposal availability");
eq(proposal.user_approval.maximum_cumulative_finite_spend_usd, null, "proposal cap");
eq(proposal.user_approval.fresh_positive_numeric_cap_required, true, "proposal fresh cap");
eq(proposal.user_approval.prior_authority_or_cap_reuse_forbidden, true, "proposal authority reuse");

const l = proposal.lineage;
eq(l.model, "Comfy-Org/Mage-Flow@d8c99241f6fa80fbd453014234af2bf337ea21e6#int8-convrot", "model");
eq(l.model_manifest_sha256, E.modelManifest, "model manifest");
eq(l.image, E.image, "image");
eq(l.image_config_sha256, E.imageConfig, "image config");
eq(l.image_layer_sha256, E.imageLayer, "image layer");
eq(l.image_layer_diff_id, E.imageDiff, "image diff");
eq(l.volume_id_sha256, E.volume, "volume");
eq(l.volume_size_gb, 50, "volume size");
eq(l.volume_region, "EU-RO-1", "volume region");
eq(l.volume_mount, "/runpod-volume", "volume mount");
eq(l.model_root, "/runpod-volume/mage-model", "model root");
eq(l.volume_write_policy, "APPLICATION_READ_ONLY", "volume write");
eq(l.gpu, E.gpu, "GPU");
eq(l.flashboot, true, "FlashBoot");
eq(l.control_source_commits.resume_get_lifetime_repair, E.repair, "repair commit");
eq(l.control_source_hashes.live_qualification_source_sha256, E.source, "source hash");
eq(l.control_source_hashes.resume_get_lifetime_repair_source_sha256, E.source, "repair source hash");
eq(l.compiled_activation_boundary.pending_proposal_sha256, "sha256:a5c57dab66673cce1878c38aceff50b9f5341a4c3b069b250aeeac099dfeaa0e", "consumed proposal");
eq(l.compiled_activation_boundary.pending_proposal_state, "ATTEMPT44_CONSUMED_NOT_REUSABLE", "consumed state");
eq(l.compiled_activation_boundary.approved_authority_sha256, null, "compiled authority");
eq(l.compiled_activation_boundary.approved_finite_cap_usd, null, "compiled cap");
eq(l.compiled_activation_boundary.exact_consumed_attempt44_environment_rejected, true, "Attempt44 rejection");
eq(l.prior_attempt.attempt, 44, "prior attempt");
eq(l.prior_attempt.closure_sha256, E.closure, "prior closure");
eq(l.prior_attempt.closure_commit, E.closureCommit, "closure commit");
eq(l.prior_attempt.failure_stage, "output_resume_readback", "diagnosed stage");
eq(l.prior_attempt.recorded_failure_stage_stale, true, "stale diagnosis");
eq(l.prior_attempt.requested_resume_get_lifetime_seconds, 7200, "requested lifetime");
eq(l.prior_attempt.hosted_get_max_lifetime_seconds, 900, "hosted maximum");
eq(l.prior_attempt.repair_commit, E.repair, "prior repair");
eq(l.prior_attempt.live_qualification_source_sha256, E.source, "prior source");
eq(proposal.provider_free_repair.repair_commit, E.repair, "repair binding");
eq(proposal.provider_free_repair.attempt44_closure_sha256, E.closure, "repair closure");
eq(proposal.provider_free_repair.requested_resume_get_lifetime_seconds, 7200, "repair requested lifetime");
eq(proposal.provider_free_repair.hosted_get_max_lifetime_seconds, 900, "repair hosted maximum");
eq(proposal.provider_free_repair.actual_failure_stage, "output_resume_readback", "repair stage");
eq(proposal.provider_free_repair.recorded_failure_stage_stale, true, "repair stale stage");
eq(proposal.provider_free_repair.provider_calls, false, "repair provider calls");
eq(proposal.provider_free_repair.spend_usd, 0, "repair spend");
eq(proposal.cloudflare_version_metadata_probe.evidence_sha256, E.cloudflare, "proposal Cloudflare evidence");
eq(proposal.read_only_preflight.evidence_sha256, E.preflight, "proposal preflight evidence");
eq(proposal.read_only_preflight.reconciliation_sha256, E.reconciliation, "proposal reconciliation evidence");
eq(proposal.staged_endpoint_configs.length, 2, "staged config count");
eq(proposal.staged_endpoint_configs[0].definition_sha256, E.max1, "max1 proposal hash");
eq(proposal.staged_endpoint_configs[1].definition_sha256, E.max2, "max2 proposal hash");
eq(proposal.staged_endpoint_configs[0].workers_min, 0, "max1 workersMin");
eq(proposal.staged_endpoint_configs[0].workers_max, 1, "max1 workersMax");
eq(proposal.staged_endpoint_configs[1].workers_min, 0, "max2 workersMin");
eq(proposal.staged_endpoint_configs[1].workers_max, 2, "max2 workersMax");
for (const c of proposal.staged_endpoint_configs) {
  eq(c.gpu, E.gpu, "staged GPU");
  eq(c.compute_type, "GPU", "staged compute");
  eq(c.flex_only, true, "staged Flex");
  eq(c.flashboot, true, "staged FlashBoot");
  eq(c.region, "EU-RO-1", "staged region");
  eq(c.volume_mount, "/runpod-volume", "staged mount");
  eq(c.volume_size_gb, 50, "staged volume size");
}
eq(proposal.execution_plan.total_units, 32, "execution units");
ok(proposal.approved_operations_to_be_proposed_once_after_fresh_approval.includes("stop before V2-08"), "V2-08 operation");
ok(proposal.negative_tests_and_stop_conditions.some((x) => x.includes("resume GET lifetime above hosted maximum 900")), "resume lifetime negative test");
eq(proposal.cost_estimate.proposed_finite_cap_usd, null, "cost cap");
eq(proposal.cost_estimate.current_provider_rate_usd_per_gpu_hour, 1.1, "Flex rate");
eq(proposal.cost_estimate.secure_reference_rate_usd_per_hour, 0.74, "secure rate");
eq(proposal.cost_estimate.ongoing_retained_volume_charge_usd_per_month, 7, "volume charge");
for (const [key, value] of Object.entries({
  provider_calls_authorized: false,
  read_only_provider_calls_authorized: false,
  provider_mutations_authorized: false,
  gpu_use_authorized: false,
  external_spend_usd: 0,
  authority_file_present: false,
  maximum_cumulative_finite_spend_usd: null,
  v2_08_authorized: false,
})) eq(proposal.provider_boundary[key], value, "proposal boundary " + key);

eq(preflight.attempt, 45, "preflight attempt");
eq(preflight.read_only, true, "preflight read only");
eq(preflight.fresh_provider_read, false, "preflight reused marker");
eq(preflight.fresh_read_required_after_approval, true, "preflight fresh read");
eq(preflight.source_attempt44_closure.sha256, E.closure, "preflight closure");
for (const [key, value] of Object.entries({ pods: 0, endpoints: 0, private_templates: 0, active_serverless_workers: 0, running_pods: 0 })) eq(preflight.inventory[key], value, "preflight inventory " + key);
eq(preflight.inventory.retained_volumes.length, 2, "preflight retained volumes");
const mage = preflight.inventory.retained_volumes.find((v) => v.purpose === "Mage");
has(mage, "preflight Mage volume");
eq(mage.id_sha256, E.volume, "preflight Mage id");
eq(mage.size_gb, 50, "preflight Mage size");
eq(mage.region, "EU-RO-1", "preflight Mage region");
eq(mage.mount, "/runpod-volume", "preflight Mage mount");
eq(preflight.selected_gpu.offering, E.gpu, "preflight GPU");
eq(preflight.selected_gpu.region, "EU-RO-1", "preflight GPU region");
eq(preflight.selected_gpu.availability, "HIGH", "preflight availability");
eq(preflight.selected_gpu.flashboot, true, "preflight FlashBoot");
eq(preflight.selected_gpu.serverless_flex_rate_usd_per_gpu_hour, 1.1, "preflight Flex rate");
eq(preflight.selected_gpu.secure_rate_usd_per_gpu_hour, 0.74, "preflight secure rate");
eq(preflight.billing.baseline_endpoint_spend_usd, 1.5903418626403436, "preflight baseline");
eq(preflight.billing.incremental_spend_usd, 0, "preflight increment");
eq(preflight.billing.candidate_finite_cap_usd, null, "preflight cap");
eq(preflight.authority.provider_calls_authorized, false, "preflight provider calls");
eq(preflight.authority.maximum_cumulative_finite_spend_usd, null, "preflight authority cap");

eq(cloudflare.attempt, 45, "Cloudflare attempt");
eq(cloudflare.read_only, true, "Cloudflare read only");
eq(cloudflare.fresh_provider_read, false, "Cloudflare reused marker");
eq(cloudflare.fresh_read_required_after_approval, true, "Cloudflare fresh read");
eq(cloudflare.source_attempt44_closure.sha256, E.closure, "Cloudflare closure");
eq(cloudflare.current_anchor.version_id_sha256, "sha256:ee4c0d1dd0e4c05cb4067f312ea7a4e656d27f1e96e678c815565c2ca2ff4ea0", "Cloudflare version");
eq(cloudflare.current_anchor.record_sha256, "sha256:5b2768ef36f1ad131b1838e2fb3ca7eb1329827b607a6bcd1fca6a9c443c3878", "Cloudflare record");
eq(cloudflare.activation_probe_contract.expected_status, 403, "Cloudflare status");
eq(cloudflare.activation_probe_contract.expected_code, "V207_AUTHORITY_REJECTED", "Cloudflare code");
eq(cloudflare.anchor_refresh.authorized, false, "Cloudflare refresh");
eq(cloudflare.anchor_refresh.marker_mutation, false, "Cloudflare marker");
eq(cloudflare.no_provider_call_or_mutation, true, "Cloudflare boundary");

eq(reconciliation.attempt, 45, "reconciliation attempt");
eq(reconciliation.read_only, true, "reconciliation read only");
eq(reconciliation.fresh_provider_read, false, "reconciliation reused marker");
eq(reconciliation.fresh_read_required_after_approval, true, "reconciliation fresh read");
eq(reconciliation.stable_read_count, 3, "reconciliation reads");
eq(reconciliation.source_attempt44_closure.sha256, E.closure, "reconciliation closure");
for (const [key, value] of Object.entries({ pods: 0, endpoints: 0, private_templates: 0, active_serverless_workers: 0, running_pods: 0, retained_volume_count: 2 })) eq(reconciliation.inventory[key], value, "reconciliation inventory " + key);
eq(reconciliation.inventory.retained_volume_size_gb_each, 50, "reconciliation volume size");
eq(reconciliation.inventory.retained_volume_region, "EU-RO-1", "reconciliation volume region");
eq(reconciliation.inventory.mage_mount, "/runpod-volume", "reconciliation Mage mount");
eq(reconciliation.billing.baseline_endpoint_spend_usd, 1.5903418626403436, "reconciliation baseline");
eq(reconciliation.billing.final_endpoint_spend_usd, 1.5903418626403436, "reconciliation final");
eq(reconciliation.billing.incremental_spend_usd, 0, "reconciliation increment");
eq(reconciliation.billing.candidate_cap_usd, null, "reconciliation cap");
eq(reconciliation.no_provider_call_or_mutation_in_attempt45, true, "reconciliation boundary");

for (const [name, config, workersMax] of [["max1", max1, 1], ["max2", max2, 2]]) {
  eq(config.schema_version, "videoforge.v2-07-staged-endpoint-definition/v10", name + " schema");
  eq(config.region, "EU-RO-1", name + " region");
  eq(config.image, E.image, name + " image");
  eq(config.model_manifest_sha256, E.modelManifest, name + " manifest");
  eq(config.network_volume_id_sha256, E.volume, name + " volume");
  eq(config.network_volume_size_gb, 50, name + " volume size");
  eq(config.network_volume_mount, "/runpod-volume", name + " mount");
  eq(config.model_root, "/runpod-volume/mage-model", name + " model root");
  eq(config.gpu_type_ids[0], E.gpu, name + " GPU");
  eq(config.compute_type, "GPU", name + " compute");
  eq(config.flex_only, true, name + " Flex");
  eq(config.flashboot, true, name + " FlashBoot");
  eq(config.workers_min, 0, name + " workersMin");
  eq(config.workers_max, workersMax, name + " workersMax");
  eq(config.volume_write_policy, "APPLICATION_READ_ONLY", name + " volume write");
  eq(config.runtime_execution_contract.runtime_download_or_quantization, false, name + " download");
  eq(config.runtime_execution_contract.cache_escape_forbidden, true, name + " cache");
  eq(config.runtime_execution_contract.real_initialization_warmup_required, true, name + " warmup");
  ok(config.runtime_execution_contract.durable_per_unit_resume.includes("NEVER_REGENERATE_ACCEPTED_UNITS"), name + " resume");
}

eq(acceptance.schema_version, "videoforge.v2-07-attempt45-resume-get-lifetime-repair-candidate-acceptance/v1", "acceptance schema");
eq(acceptance.checkpoint, "V2-07", "acceptance checkpoint");
eq(acceptance.task_id, "VF-10-07", "acceptance task");
eq(acceptance.attempt, 45, "acceptance attempt");
eq(acceptance.result, "PROVIDER_FREE_CANDIDATE_PENDING_FRESH_APPROVAL", "acceptance result");
eq(acceptance.qualification_status, "NOT_QUALIFIED", "acceptance status");
eq(acceptance.candidate.proposal_sha256, E.proposal, "acceptance proposal");
eq(acceptance.candidate.max1_sha256, E.max1, "acceptance max1");
eq(acceptance.candidate.max2_sha256, E.max2, "acceptance max2");
eq(acceptance.candidate.live_qualification_source_sha256, E.source, "acceptance source");
eq(acceptance.candidate.prior_attempt44_closure_sha256, E.closure, "acceptance closure");
eq(acceptance.candidate.prior_attempt44_closure_commit, E.closureCommit, "acceptance closure commit");
eq(acceptance.candidate.authority_path, null, "acceptance authority path");
eq(acceptance.candidate.authority_sha256, null, "acceptance authority hash");
eq(acceptance.candidate.authority_recorded, false, "acceptance authority record");
eq(acceptance.candidate.maximum_cumulative_finite_spend_usd, null, "acceptance cap");
eq(acceptance.provider_free_repair.repair_commit, E.repair, "acceptance repair");
eq(acceptance.provider_free_repair.attempt44_closure_sha256, E.closure, "acceptance repair closure");
eq(acceptance.version_metadata_probe.evidence_sha256, E.cloudflare, "acceptance Cloudflare");
eq(acceptance.read_only_provider_snapshot.preflight_evidence_sha256, E.preflight, "acceptance preflight");
eq(acceptance.read_only_provider_snapshot.reconciliation_evidence_sha256, E.reconciliation, "acceptance reconciliation");
eq(acceptance.read_only_provider_snapshot.cumulative_endpoint_spend_usd, 1.5903418626403436, "acceptance spend");
eq(acceptance.read_only_provider_snapshot.incremental_spend_usd, 0, "acceptance increment");
eq(acceptance.provider_boundary.provider_calls, false, "acceptance provider calls");
eq(acceptance.provider_boundary.provider_mutations, false, "acceptance mutations");
eq(acceptance.provider_boundary.gpu_use, false, "acceptance GPU");
eq(acceptance.provider_boundary.cap_usd, null, "acceptance cap");
eq(acceptance.provider_boundary.v2_08_authorized, false, "acceptance V2-08");
eq(acceptance.local_verification_required.candidate_validator, "PASS", "acceptance validator");
eq(acceptance.local_verification_required.repair_source_binding, "PASS", "acceptance repair validation");

includes("project-context/CURRENT_STATE.yaml", E.closure, "CURRENT_STATE closure");
includes("project-context/CURRENT_STATE.yaml", E.repair, "CURRENT_STATE repair");
includes("project-context/CURRENT_STATE.yaml", "provider_calls_authorized: false", "CURRENT_STATE provider boundary");
includes("project-context/CURRENT_STATE.yaml", "authorized_spend_usd: 0", "CURRENT_STATE spend boundary");
includes("project-context/CURRENT_STATE.yaml", "V2-08: blocked_on_V2-07", "CURRENT_STATE V2-08");
includes("project-context/CURRENT_STATE.yaml", "current_authority: null", "CURRENT_STATE authority");
includes("project-context/GATES.yaml", E.closure, "GATES closure");
includes("project-context/GATES.yaml", E.repair, "GATES repair");
includes("project-context/GATES.yaml", E.source, "GATES source");
includes("project-context/GATES.yaml", "provider_calls_authorized: false", "GATES provider boundary");
includes("project-context/GATES.yaml", "v2_08_authorized: false", "GATES V2-08");
includes("project-context/00_START_HERE.md", E.closure, "START_HERE closure");
includes("project-context/00_START_HERE.md", E.repair.slice(0, 7), "START_HERE repair");
includes("project-context/00_START_HERE.md", "V2-08 forbidden", "START_HERE V2-08");
const activation = "apps/web/src/server/providers/v207-activation-authority.ts";
includes(activation, "export const V207_APPROVED_AUTHORITY_SHA256: string | null = null;", "activation authority");
includes(activation, "export const V207_APPROVED_FINITE_CAP_USD: number | null = null;", "activation cap");
includes(activation, "export const V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED: boolean | null = null;", "activation anchor");

console.log("PASS validate-v207-attempt45-resume-get-lifetime-repair-candidate", JSON.stringify({
  proposal_sha256: E.proposal,
  acceptance_sha256: E.acceptance,
  max1_sha256: E.max1,
  max2_sha256: E.max2,
  prior_attempt44_closure_sha256: E.closure,
  repair_commit: E.repair,
  live_qualification_source_sha256: E.source,
  provider_calls: false,
  gpu_use: false,
  external_spend_usd: 0,
}));

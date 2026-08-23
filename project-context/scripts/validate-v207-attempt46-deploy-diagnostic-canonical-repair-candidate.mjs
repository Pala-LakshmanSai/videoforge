#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const DIR = path.join(ROOT, "project-context/evidence/acceptance/VF-10-07/2026-08-23-attempt46-deploy-diagnostic-canonical-repair-candidate");
const E = {
  proposal: "sha256:653c44ceeb3aa3948dade2f7b2d0c68904152aeee66392f826b3b1ffd7b9c259",
  acceptance: "sha256:4e467eaf9190cb6cc93e344fdc608fcbc49c7bc6e99d7f68fe055e149484d5e8",
  max1: "sha256:624dafe2f1a5fdfbf0435b87e3eecaca997281386d4a6c41339bfb5e78eb457a",
  max2: "sha256:9774e90daf86cfa8f7f8f17c4bd9319475ac5881d0c2667ca61f0a7412a9bfcb",
  canonical: "sha256:858ebe43ef8ad6558825d6b1c756311a8944cd2ef27e58f42651d793ab191da9",
  orchestrator: "sha256:d8aa5ded8cd67141ad951f774245f8181adb34c1f3fafe2cc047ff244ae5f894",
  live: "sha256:c5187fb9636d53e214d90f60c1a67a13ed06dc47c558f4869628b6d09a27a9c5",
  closure: "sha256:f287a7ec8ea064587e251f5ccb9b5321025d37976fdbf40b0b894a962c71167c",
  authority: "sha256:86b5810de7fb360182c5ade95d2d0f4349cb76175cc41b4e10923e78262f5588",
  volume: "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619",
  manifest: "sha256:cebcd5c6233c2eae32f26ced7510acef8192f0d92d7ec3e9dd3ee881d66d205b",
  image: "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:79fe7e40b69c011c15cc31b2d84b356cd2c755ea338976172cd78cc581304d59",
};
const fail = (m) => { throw new Error(`V207_ATTEMPT46_CANDIDATE_INVALID: ${m}`); };
const ok = (v, m) => { if (!v) fail(m); };
const eq = (a, b, m) => { if (a !== b) fail(`${m}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); };
const sha = (p) => `sha256:${crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex")}`;
const file = (n) => path.join(DIR, n);
const json = (n) => JSON.parse(fs.readFileSync(file(n), "utf8"));

for (const [name, expected] of Object.entries({
  "combined-live-proposal.json": E.proposal,
  "acceptance.json": E.acceptance,
  "staged-config-max1.json": E.max1,
  "staged-config-max2.json": E.max2,
})) eq(sha(file(name)), expected, `${name} hash`);
eq(sha(file("approved-authority.json")), E.authority, "approved-authority.json hash");

const proposal = json("combined-live-proposal.json");
const acceptance = json("acceptance.json");
const max1 = json("staged-config-max1.json");
const max2 = json("staged-config-max2.json");
const authority = json("approved-authority.json");
eq(proposal.attempt, 46, "attempt");
eq(proposal.authority_mode, "PENDING_FRESH_EXACT_APPROVAL_AND_NUMERIC_CAP", "authority mode");
eq(proposal.requested_approval.maximum_cumulative_finite_spend_usd, null, "proposal cap");
eq(proposal.requested_approval.flashboot, true, "FlashBoot");
eq(proposal.requested_approval.minimum_availability, "LOW-or-better", "availability");
eq(proposal.lineage.image, E.image, "image");
eq(proposal.lineage.model_manifest_sha256, E.manifest, "manifest");
eq(proposal.lineage.volume_id_sha256, E.volume, "volume");
eq(proposal.lineage.volume_size_gb, 50, "volume size");
eq(proposal.lineage.volume_region, "EU-RO-1", "volume region");
eq(proposal.lineage.volume_mount, "/runpod-volume", "mount");
eq(proposal.lineage.gpu, "NVIDIA GeForce RTX 4090", "GPU");
eq(proposal.lineage.canonical_activation_source_sha256, E.canonical, "canonical source");
eq(proposal.lineage.orchestrator_source_sha256, E.orchestrator, "orchestrator source");
eq(proposal.lineage.live_qualification_source_sha256, E.live, "live source");
for (const commit of ["1a8a12de10869d163ddf7bb4dfa3f329407ba566", "f945392", "7066520", "926b149"]) {
  ok(proposal.lineage.repair_commits.includes(commit), `repair ${commit}`);
}
eq(proposal.prior_attempt.closure_sha256, E.closure, "prior closure");
eq(proposal.prior_attempt.authority_consumed, true, "prior consumed");
eq(proposal.prior_attempt.runpod_jobs_submitted, 0, "prior jobs");
eq(proposal.last_observed_provider_truth.fresh_read_required_after_approval, true, "fresh read");
for (const key of ["pods", "endpoints", "private_templates", "active_workers", "running_pods"]) eq(proposal.last_observed_provider_truth[key], 0, key);
eq(proposal.last_observed_provider_truth.retained_volumes, 2, "retained volumes");
eq(proposal.staged_endpoint_configs[0].sha256, E.max1, "max1 ref");
eq(proposal.staged_endpoint_configs[1].sha256, E.max2, "max2 ref");
eq(max1.workers_min, 0, "max1 min");
eq(max1.workers_max, 1, "max1 max");
eq(max2.workers_min, 0, "max2 min");
eq(max2.workers_max, 2, "max2 max");
for (const config of [max1, max2]) {
  eq(config.gpu_type_ids[0], "NVIDIA GeForce RTX 4090", "config GPU");
  eq(config.compute_type, "GPU", "config compute");
  eq(config.flex_only, true, "config Flex");
  eq(config.flashboot, true, "config FlashBoot");
  eq(config.region, "EU-RO-1", "config region");
  eq(config.network_volume_id_sha256, E.volume, "config volume");
  eq(config.network_volume_mount, "/runpod-volume", "config mount");
  eq(config.network_volume_size_gb, 50, "config size");
  for (const repair of ["f945392", "7066520", "926b149"]) ok(config.control_source_commits.includes(repair), `config repair ${repair}`);
}
eq(proposal.cost.serverless_flex_rtx4090_usd_per_gpu_hour, 1.1, "Flex rate");
eq(proposal.cost.finite_action_estimate_usd, 3.95, "estimate");
eq(proposal.cost.maximum_cumulative_finite_spend_usd, null, "cost cap");
eq(proposal.cost.existing_two_retained_volumes_usd_per_month, 7, "volume charge");
eq(proposal.provider_boundary.provider_calls_authorized, false, "provider calls");
eq(proposal.provider_boundary.provider_mutations_authorized, false, "mutations");
eq(proposal.provider_boundary.gpu_use_authorized, false, "GPU use");
eq(proposal.provider_boundary.spend_authorized_usd, 0, "spend");
eq(proposal.provider_boundary.authority_file_present, false, "authority file");
eq(proposal.provider_boundary.v2_08_authorized, false, "V2-08");
ok(proposal.operations.some((x) => x.includes("allowlisted deploy diagnostic")), "safe deploy diagnostics operation");
ok(proposal.operations.includes("stop before V2-08"), "stop boundary");
ok(proposal.forbidden.some((x) => x.includes("raw deploy stderr/stdout")), "raw diagnostic fence");
eq(acceptance.proposal_sha256, E.proposal, "acceptance proposal");
eq(acceptance.staged_max1_sha256, E.max1, "acceptance max1");
eq(acceptance.staged_max2_sha256, E.max2, "acceptance max2");
eq(acceptance.canonical_activation_source_sha256, E.canonical, "acceptance canonical");
eq(acceptance.authority_recorded, false, "acceptance authority");
eq(acceptance.finite_cap_usd, null, "acceptance cap");
eq(acceptance.provider_calls, false, "acceptance calls");
eq(acceptance.v2_07_qualified, false, "qualification");
eq(acceptance.v2_08_authorized, false, "successor");

eq(authority.schema_version, "videoforge.v2-07-attempt46-deploy-diagnostic-canonical-repair-authority/v1", "authority schema");
eq(authority.checkpoint, "V2-07", "authority checkpoint");
eq(authority.task_id, "VF-10-07", "authority task");
eq(authority.attempt, 46, "authority attempt");
eq(authority.authority_mode, "bounded_mutation", "authority mode");
eq(authority.status, "APPROVED_SINGLE_USE_PENDING_EXECUTION", "authority status");
eq(authority.proposal?.path, "combined-live-proposal.json", "authority proposal path");
eq(authority.proposal?.sha256, E.proposal, "authority proposal");
eq(authority.acceptance?.path, "acceptance.json", "authority acceptance path");
eq(authority.acceptance?.sha256, E.acceptance, "authority acceptance");
eq(authority.approval?.exact_proposal_approved, true, "authority exact approval");
eq(authority.approval?.flashboot_true_accepted, true, "authority FlashBoot");
eq(authority.approval?.low_or_better_eu_ro_1_availability_approved, true, "authority availability");
eq(authority.approval?.minimum_approved_availability, "LOW-or-better", "authority minimum");
eq(authority.approval?.maximum_cumulative_finite_spend_usd, 4, "authority cap");
eq(authority.approval?.fresh_numeric_cap, true, "authority fresh cap");
eq(authority.approval?.historical_cap_reused, false, "authority historical cap");
eq(authority.approval?.prior_authority_reused, false, "authority prior reuse");
eq(authority.approval?.single_use, true, "authority single use");
eq(authority.approval?.consumed, false, "authority consumed");
eq(authority.approval?.anchor_refresh_authorized, false, "authority anchor refresh");
eq(authority.lineage?.model_manifest_sha256, E.manifest, "authority manifest");
eq(authority.lineage?.image, E.image, "authority image");
eq(authority.lineage?.volume_id_sha256, E.volume, "authority volume");
eq(authority.lineage?.volume_size_gb, 50, "authority volume size");
eq(authority.lineage?.volume_region, "EU-RO-1", "authority volume region");
eq(authority.lineage?.volume_mount, "/runpod-volume", "authority volume mount");
eq(authority.lineage?.initial_config_sha256, E.max1, "authority max1");
eq(authority.lineage?.concurrent_reader_config_sha256, E.max2, "authority max2");
eq(authority.lineage?.canonical_activation_source_sha256, E.canonical, "authority canonical");
eq(authority.lineage?.orchestrator_source_sha256, E.orchestrator, "authority orchestrator");
eq(authority.lineage?.live_qualification_source_sha256, E.live, "authority live source");
eq(authority.lineage?.prior_attempt45_closure_sha256, E.closure, "authority prior closure");
eq(JSON.stringify(authority.approved_operations), JSON.stringify(proposal.operations), "authority operations");
eq(authority.execution_boundary?.maximum_cumulative_finite_spend_usd, 4, "authority boundary cap");
eq(authority.execution_boundary?.provider_calls_completed, false, "authority calls");
eq(authority.execution_boundary?.external_spend_usd, 0, "authority spend");
eq(authority.execution_boundary?.runpod_mutation_authorized_pending_execution, true, "authority RunPod");
eq(authority.execution_boundary?.gpu_use_authorized_pending_execution, true, "authority GPU");
eq(authority.execution_boundary?.image_republication_authorized, false, "authority publication");
eq(authority.execution_boundary?.retained_volume_mutation_authorized, false, "authority volume mutation");
eq(authority.execution_boundary?.v2_08_authorized, false, "authority successor");
eq(authority.runtime_contract?.offline_sealed_manifest_verification, true, "authority manifest verification");
eq(authority.runtime_contract?.application_read_only_model_files, true, "authority read-only model");
eq(authority.runtime_contract?.runtime_download_or_quantization, false, "authority runtime download");
eq(authority.runtime_contract?.durable_per_unit_resume, true, "authority resume");
eq(authority.cleanup_and_stop?.restore_max1_after_max2_reader_proof, true, "authority restore max1");
eq(authority.cleanup_and_stop?.terminal_workers_zero_required, true, "authority worker drain");
eq(authority.cleanup_and_stop?.stop_on_uncertain_cleanup, true, "authority cleanup stop");

const activation = fs.readFileSync(path.join(ROOT, "apps/web/src/server/providers/v207-activation-authority.ts"), "utf8");
eq(sha(path.join(ROOT, "apps/web/src/server/providers/v207-live-orchestrator.ts")), E.orchestrator, "orchestrator file");
eq(sha(path.join(ROOT, "apps/web/src/server/providers/v207-live-qualification.ts")), E.live, "live file");
ok(activation.includes(`export const V207_APPROVED_AUTHORITY_SHA256: string | null = null;`), "null authority");
ok(activation.includes(`export const V207_APPROVED_FINITE_CAP_USD: number | null = null;`), "null cap");
ok(
  activation.includes(
    "export const V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED: boolean | null = null;",
  ),
  "consumed anchor flag",
);
ok(!activation.includes(E.authority), "consumed authority removed from executable source");
console.log("PASS validate-v207-attempt46-deploy-diagnostic-canonical-repair-candidate", JSON.stringify(E));

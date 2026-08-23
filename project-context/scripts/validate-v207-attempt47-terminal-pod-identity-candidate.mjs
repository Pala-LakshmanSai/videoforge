#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const DIR = path.join(
  ROOT,
  "project-context/evidence/acceptance/VF-10-07/2026-08-23-attempt47-terminal-pod-identity-repair-candidate",
);
const E = {
  proposal:
    "sha256:e0e0e62014a770678485d780dbb2c852ae7e1786162fc58594f6d08afaa0ee53",
  acceptance:
    "sha256:be3f2c5bca77f90a2470f4e2f165f47b2811501a6cc9febee911edeb24b758e6",
  approvedAuthority:
    "sha256:aae6dfd8a282333a8a5caa3149e520e58a858c93b0730e4529d599f7d078a254",
  max1:
    "sha256:624dafe2f1a5fdfbf0435b87e3eecaca997281386d4a6c41339bfb5e78eb457a",
  max2:
    "sha256:9774e90daf86cfa8f7f8f17c4bd9319475ac5881d0c2667ca61f0a7412a9bfcb",
  closure:
    "sha256:e333bc34e7fbc72bf123e32ce65d28ee8a85da4e6b3542db929a4e63a520e8d2",
  cleanup:
    "sha256:f1a82b50408b8ad7a99beffcf4daf6a69976a5cd58620d314a4d873e463b3d75",
  reconciliation:
    "sha256:cf06ca26a87f25f5e95285f782289823b2f57766d1915fe3dc88dc7ec48b476b",
  harness:
    "sha256:18ed63b1cc720618cdb733005ea304c546aac590545c3615fbed18e1eb2113fd",
  harnessTest:
    "sha256:9888ca2b291867de5845dd0f6e5125ecc827e980df6b74baa0084c081d0a10a0",
  canonical:
    "sha256:858ebe43ef8ad6558825d6b1c756311a8944cd2ef27e58f42651d793ab191da9",
  orchestrator:
    "sha256:d8aa5ded8cd67141ad951f774245f8181adb34c1f3fafe2cc047ff244ae5f894",
  live:
    "sha256:c5187fb9636d53e214d90f60c1a67a13ed06dc47c558f4869628b6d09a27a9c5",
  authority:
    "sha256:86b5810de7fb360182c5ade95d2d0f4349cb76175cc41b4e10923e78262f5588",
  volume:
    "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619",
  manifest:
    "sha256:cebcd5c6233c2eae32f26ced7510acef8192f0d92d7ec3e9dd3ee881d66d205b",
  image:
    "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:79fe7e40b69c011c15cc31b2d84b356cd2c755ea338976172cd78cc581304d59",
  imageSource: "a7b7a937d08dc9032b8922cca71c602195f3094c",
  repairCommit: "1d39b716705a69cd8f8933d6a640fa5a9a98d37e",
  priorProposal:
    "sha256:653c44ceeb3aa3948dade2f7b2d0c68904152aeee66392f826b3b1ffd7b9c259",
  priorAuthority:
    "sha256:86b5810de7fb360182c5ade95d2d0f4349cb76175cc41b4e10923e78262f5588",
};
const fail = (message) => {
  throw new Error(`V207_ATTEMPT47_CANDIDATE_INVALID: ${message}`);
};
const ok = (value, message) => {
  if (!value) fail(message);
};
const eq = (actual, expected, message) => {
  if (actual !== expected) {
    fail(`${message}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
  }
};
const bytes = (file) => fs.readFileSync(file);
const text = (file) => bytes(file).toString("utf8");
const json = (file) => JSON.parse(text(file));
const sha = (file) => `sha256:${crypto.createHash("sha256").update(bytes(file)).digest("hex")}`;
const at = (name) => path.join(DIR, name);
const rootFile = (...parts) => path.join(ROOT, ...parts);

const expectedFiles = {
  "combined-live-proposal.json": E.proposal,
  "acceptance.json": E.acceptance,
  "staged-config-max1.json": E.max1,
  "staged-config-max2.json": E.max2,
};
for (const [name, expected] of Object.entries(expectedFiles)) {
  eq(sha(at(name)), expected, `${name} hash`);
}
eq(sha(at("approved-authority.json")), E.approvedAuthority, "approved authority hash");

const proposal = json(at("combined-live-proposal.json"));
const acceptance = json(at("acceptance.json"));
const authority = json(at("approved-authority.json"));
const max1 = json(at("staged-config-max1.json"));
const max2 = json(at("staged-config-max2.json"));
const closure = json(
  rootFile(
    "project-context/evidence/acceptance/VF-10-07/2026-08-21-live-qualification/failed-attempt-46.json",
  ),
);
const cleanup = json(
  rootFile(
    "project-context/evidence/acceptance/VF-10-07/2026-08-21-live-qualification/attempt46-cleanup-observation.json",
  ),
);
const reconciliation = json(
  rootFile(
    "project-context/evidence/acceptance/VF-10-07/2026-08-21-live-qualification/attempt46-reconciliation-observation.json",
  ),
);

eq(proposal.schema_version, "videoforge.v2-07-attempt47-terminal-pod-identity-repair-combined-live-proposal/v1", "proposal schema");
eq(proposal.checkpoint, "V2-07", "proposal checkpoint");
eq(proposal.task_id, "VF-10-07", "proposal task");
eq(proposal.attempt, 47, "proposal attempt");
eq(proposal.authority_mode, "PENDING_FRESH_EXACT_APPROVAL_AND_NUMERIC_CAP", "pending authority mode");
eq(proposal.provider_mutation, false, "proposal provider mutation");
eq(proposal.publication, false, "proposal publication");
eq(proposal.gpu_use, false, "proposal GPU use");
eq(proposal.spend_usd, 0, "proposal spend");
eq(proposal.requested_approval.exact_proposal_approved, false, "proposal approval");
eq(proposal.requested_approval.flashboot, true, "proposal FlashBoot");
eq(proposal.requested_approval.minimum_availability, "LOW-or-better", "proposal availability");
eq(proposal.requested_approval.region, "EU-RO-1", "proposal region");
eq(proposal.requested_approval.maximum_cumulative_finite_spend_usd, null, "proposal cap");
eq(proposal.requested_approval.fresh_positive_numeric_cap_required, true, "fresh cap required");
eq(proposal.provider_boundary.authority_file_present, false, "proposal authority absence");
eq(proposal.provider_boundary.provider_calls_authorized, false, "proposal provider calls");
eq(proposal.provider_boundary.provider_mutations_authorized, false, "proposal provider mutations");
eq(proposal.provider_boundary.gpu_use_authorized, false, "proposal GPU authorization");
eq(proposal.provider_boundary.spend_authorized_usd, 0, "proposal spend authorization");
eq(proposal.provider_boundary.v2_08_authorized, false, "proposal V2-08");
eq(proposal.lineage.model_manifest_sha256, E.manifest, "manifest");
eq(proposal.lineage.image, E.image, "image");
eq(proposal.lineage.image_source_commit, E.imageSource, "image source");
eq(proposal.lineage.volume_id_sha256, E.volume, "Mage volume");
eq(proposal.lineage.volume_size_gb, 50, "volume size");
eq(proposal.lineage.volume_region, "EU-RO-1", "volume region");
eq(proposal.lineage.volume_mount, "/runpod-volume", "volume mount");
eq(proposal.lineage.model_root, "/runpod-volume/mage-model", "model root");
eq(proposal.lineage.gpu, "NVIDIA GeForce RTX 4090", "GPU");
eq(proposal.lineage.flashboot, true, "lineage FlashBoot");
eq(proposal.lineage.canonical_activation_source_sha256, E.canonical, "canonical source");
eq(proposal.lineage.orchestrator_source_sha256, E.orchestrator, "orchestrator source");
eq(proposal.lineage.live_qualification_source_sha256, E.live, "live qualification source");
eq(proposal.lineage.qualification_harness_source_sha256, E.harness, "qualification harness source");
eq(proposal.lineage.qualification_harness_test_source_sha256, E.harnessTest, "qualification harness test source");
eq(proposal.lineage.process_replacement_identity_repair_commit, E.repairCommit, "repair commit");
ok(proposal.lineage.repair_commits.includes(E.repairCommit), "repair commit in lineage");
eq(proposal.lineage.process_replacement_identity_contract.terminal_pod_fallback_requires_exact_expected_pod_id, true, "exact Pod fallback");
eq(proposal.lineage.process_replacement_identity_contract.explicit_mismatched_worker_identity_rejected, true, "mismatch rejection");
eq(proposal.lineage.process_replacement_identity_contract.no_second_run_dispatch, true, "single dispatch fence");

eq(proposal.prior_attempt.attempt, 46, "prior attempt number");
eq(proposal.prior_attempt.proposal_sha256, E.priorProposal, "prior proposal");
eq(proposal.prior_attempt.authority_sha256, E.priorAuthority, "prior authority");
eq(proposal.prior_attempt.closure_sha256, E.closure, "prior closure");
eq(proposal.prior_attempt.cleanup_sha256, E.cleanup, "prior cleanup");
eq(proposal.prior_attempt.reconciliation_sha256, E.reconciliation, "prior reconciliation");
eq(proposal.prior_attempt.authority_consumed, true, "prior authority consumed");
eq(proposal.prior_attempt.runpod_calls_reached, true, "prior RunPod calls");
eq(proposal.prior_attempt.runpod_jobs_submitted, 1, "prior jobs");
eq(proposal.prior_attempt.gpu_use, true, "prior GPU use");
eq(proposal.prior_attempt.qualification_status, "NOT_QUALIFIED", "prior qualification");
eq(proposal.prior_attempt.identity_failure_code, "RUNPOD_PROCESS_REPLACEMENT_WORKER_IDENTITY_UNAVAILABLE", "prior failure");

eq(proposal.last_observed_provider_truth.evidence_sha256, E.reconciliation, "last reconciliation");
eq(proposal.last_observed_provider_truth.pods, 0, "last Pods");
eq(proposal.last_observed_provider_truth.endpoints, 0, "last endpoints");
eq(proposal.last_observed_provider_truth.private_templates, 0, "last templates");
eq(proposal.last_observed_provider_truth.active_workers, 0, "last active workers");
eq(proposal.last_observed_provider_truth.running_pods, 0, "last running Pods");
eq(proposal.last_observed_provider_truth.retained_volumes, 2, "last retained volumes");
eq(proposal.last_observed_provider_truth.attempt46_incremental_spend_usd, 0, "prior settled increment");
eq(proposal.last_observed_provider_truth.provider_mutations_during_reconciliation, 0, "reconciliation mutation count");
eq(proposal.last_observed_provider_truth.three_stable_reads, true, "three stable reads");
eq(proposal.staged_endpoint_configs[0].sha256, E.max1, "proposal max1");
eq(proposal.staged_endpoint_configs[1].sha256, E.max2, "proposal max2");
eq(proposal.cost.serverless_flex_rtx4090_usd_per_gpu_hour, 1.1, "Flex rate");
eq(proposal.cost.finite_action_estimate_usd, 3.95, "finite estimate");
eq(proposal.cost.maximum_cumulative_finite_spend_usd, null, "cost cap");
eq(proposal.cost.existing_two_retained_volumes_usd_per_month, 7, "retained volume charge");
ok(proposal.operations.some((operation) => operation.includes("submit and reconcile owned probe")), "owned qualification operations");
ok(proposal.operations.some((operation) => operation.includes("two simultaneous read-only workers")), "reader operations");
ok(proposal.operations.includes("stop before V2-08"), "V2-08 stop boundary");
ok(proposal.forbidden.some((forbidden) => forbidden.includes("volume write")), "volume-write prohibition");
ok(proposal.forbidden.some((forbidden) => forbidden.includes("raw deploy stderr/stdout")), "secret-safe diagnostics");

eq(acceptance.schema_version, "videoforge.v2-07-attempt47-terminal-pod-identity-repair-candidate-acceptance/v1", "acceptance schema");
eq(acceptance.checkpoint, "V2-07", "acceptance checkpoint");
eq(acceptance.task_id, "VF-10-07", "acceptance task");
eq(acceptance.attempt, 47, "acceptance attempt");
eq(acceptance.result, "PASS_PROVIDER_FREE_CANDIDATE_PENDING_FRESH_EXACT_APPROVAL", "acceptance result");
eq(acceptance.proposal_sha256, E.proposal, "acceptance proposal");
eq(acceptance.staged_max1_sha256, E.max1, "acceptance max1");
eq(acceptance.staged_max2_sha256, E.max2, "acceptance max2");
eq(acceptance.canonical_activation_source_sha256, E.canonical, "acceptance canonical");
eq(acceptance.orchestrator_source_sha256, E.orchestrator, "acceptance orchestrator");
eq(acceptance.live_qualification_source_sha256, E.live, "acceptance live qualification");
eq(acceptance.qualification_harness_source_sha256, E.harness, "acceptance harness");
eq(acceptance.qualification_harness_test_source_sha256, E.harnessTest, "acceptance harness test");
eq(acceptance.repairs.terminal_pod_identity_repair, E.repairCommit, "acceptance repair");
eq(acceptance.prior_attempt46.closure_sha256, E.closure, "acceptance prior closure");
eq(acceptance.prior_attempt46.cleanup_sha256, E.cleanup, "acceptance prior cleanup");
eq(acceptance.prior_attempt46.reconciliation_sha256, E.reconciliation, "acceptance prior reconciliation");
eq(acceptance.exact_image, E.image, "acceptance image");
eq(acceptance.model_manifest_sha256, E.manifest, "acceptance manifest");
eq(acceptance.volume_id_sha256, E.volume, "acceptance volume");
eq(acceptance.volume_size_gb, 50, "acceptance volume size");
eq(acceptance.volume_region, "EU-RO-1", "acceptance volume region");
eq(acceptance.volume_mount, "/runpod-volume", "acceptance volume mount");
eq(acceptance.gpu, "NVIDIA GeForce RTX 4090", "acceptance GPU");
eq(acceptance.flashboot, true, "acceptance FlashBoot");
eq(acceptance.minimum_availability, "LOW-or-better", "acceptance availability");
eq(acceptance.finite_estimate_usd, 3.95, "acceptance estimate");
eq(acceptance.finite_cap_usd, null, "acceptance cap");
eq(acceptance.provider_calls, false, "acceptance provider calls");
eq(acceptance.provider_mutations, false, "acceptance mutations");
eq(acceptance.gpu_use, false, "acceptance GPU");
eq(acceptance.spend_usd, 0, "acceptance spend");
eq(acceptance.authority_recorded, false, "acceptance authority");
eq(acceptance.authority_file_present, false, "acceptance authority file");
eq(acceptance.fresh_read_required_after_approval, true, "acceptance fresh read");
eq(acceptance.v2_07_qualified, false, "acceptance qualification");
eq(acceptance.v2_08_authorized, false, "acceptance successor");

eq(authority.schema_version, "videoforge.v2-07-attempt47-terminal-pod-identity-repair-authority/v1", "authority schema");
eq(authority.attempt, 47, "authority attempt");
eq(authority.status, "APPROVED_SINGLE_USE_PENDING_EXECUTION", "authority status");
eq(authority.proposal?.sha256, E.proposal, "authority proposal");
eq(authority.acceptance?.sha256, E.acceptance, "authority acceptance");
eq(authority.approval?.exact_proposal_approved, true, "authority exact approval");
eq(authority.approval?.flashboot_true_accepted, true, "authority FlashBoot");
eq(authority.approval?.minimum_approved_availability, "LOW-or-better", "authority availability");
eq(authority.approval?.maximum_cumulative_finite_spend_usd, 4, "authority cap");
eq(authority.approval?.fresh_numeric_cap, true, "authority fresh cap");
eq(authority.approval?.prior_authority_reused, false, "authority reuse fence");
eq(authority.approval?.single_use, true, "authority single use");
eq(authority.approval?.consumed, false, "authority pending consumption");
eq(authority.approval?.anchor_refresh_authorized, false, "authority anchor refresh");
eq(authority.lineage?.image, E.image, "authority image");
eq(authority.lineage?.model_manifest_sha256, E.manifest, "authority manifest");
eq(authority.lineage?.volume_id_sha256, E.volume, "authority volume");
eq(authority.lineage?.initial_config_sha256, E.max1, "authority max1");
eq(authority.lineage?.concurrent_reader_config_sha256, E.max2, "authority max2");
eq(authority.lineage?.process_replacement_identity_repair_commit, undefined, "authority repair encoded in repair commits");
ok(authority.lineage?.repair_commits?.includes(E.repairCommit), "authority terminal Pod repair");
eq(JSON.stringify(authority.approved_operations), JSON.stringify(proposal.operations), "authority operations");
eq(authority.execution_boundary?.maximum_cumulative_finite_spend_usd, 4, "authority boundary cap");
eq(authority.execution_boundary?.runpod_mutation_authorized_pending_execution, true, "authority RunPod mutation");
eq(authority.execution_boundary?.gpu_use_authorized_pending_execution, true, "authority GPU");
eq(authority.execution_boundary?.image_republication_authorized, false, "authority image publication");
eq(authority.execution_boundary?.retained_volume_mutation_authorized, false, "authority volume mutation");
eq(authority.execution_boundary?.v2_08_authorized, false, "authority successor");

eq(max1.workers_min, 0, "max1 workers min");
eq(max1.workers_max, 1, "max1 workers max");
eq(max1.gpu_type_ids?.[0], "NVIDIA GeForce RTX 4090", "max1 GPU");
eq(max1.compute_type, "GPU", "max1 compute");
eq(max1.flex_only, true, "max1 Flex");
eq(max1.flashboot, true, "max1 FlashBoot");
eq(max1.region, "EU-RO-1", "max1 region");
eq(max1.network_volume_id_sha256, E.volume, "max1 volume");
eq(max1.network_volume_mount, "/runpod-volume", "max1 mount");
eq(max1.network_volume_size_gb, 50, "max1 volume size");
eq(max2.workers_min, 0, "max2 workers min");
eq(max2.workers_max, 2, "max2 workers max");
eq(max2.gpu_type_ids?.[0], "NVIDIA GeForce RTX 4090", "max2 GPU");
eq(max2.compute_type, "GPU", "max2 compute");
eq(max2.flex_only, true, "max2 Flex");
eq(max2.flashboot, true, "max2 FlashBoot");
eq(max2.region, "EU-RO-1", "max2 region");
eq(max2.network_volume_id_sha256, E.volume, "max2 volume");
eq(max2.network_volume_mount, "/runpod-volume", "max2 mount");
eq(max2.network_volume_size_gb, 50, "max2 volume size");

eq(sha(rootFile("apps/web/src/server/providers/runpod-v207-qualification-harness.ts")), E.harness, "harness file");
eq(sha(rootFile("apps/web/src/server/providers/runpod-v207-qualification-harness.test.ts")), E.harnessTest, "harness test file");
eq(sha(rootFile("apps/web/src/server/providers/v207-live-orchestrator.ts")), E.orchestrator, "orchestrator file");
eq(sha(rootFile("apps/web/src/server/providers/v207-live-qualification.ts")), E.live, "live qualification file");
const activation = text(rootFile("apps/web/src/server/providers/v207-activation-authority.ts"));
ok(
  activation.includes(
    `export const V207_PENDING_PROPOSAL_SHA256 =\n  "${E.proposal}" as const;`,
  ),
  "activation source binds exact Attempt47 proposal",
);
ok(activation.includes(E.approvedAuthority), "activation exact authority");
ok(activation.includes("export const V207_APPROVED_FINITE_CAP_USD: number | null = 4;"), "activation exact cap");
ok(activation.includes("export const V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED: boolean | null = false;"), "activation anchor disabled");
ok(!activation.includes(E.priorAuthority), "activation source does not contain consumed authority");

eq(sha(rootFile("project-context/evidence/acceptance/VF-10-07/2026-08-21-live-qualification/failed-attempt-46.json")), E.closure, "closure file");
eq(sha(rootFile("project-context/evidence/acceptance/VF-10-07/2026-08-21-live-qualification/attempt46-cleanup-observation.json")), E.cleanup, "cleanup file");
eq(sha(rootFile("project-context/evidence/acceptance/VF-10-07/2026-08-21-live-qualification/attempt46-reconciliation-observation.json")), E.reconciliation, "reconciliation file");
eq(closure.attempt, 46, "closure attempt");
eq(closure.result, "NOT_QUALIFIED_ATTEMPT46_PROCESS_REPLACEMENT_WORKER_IDENTITY_UNAVAILABLE_CLEAN", "closure result");
eq(closure.qualification_status, "NOT_QUALIFIED", "closure status");
eq(closure.execution.runpod_jobs_submitted, 1, "closure jobs");
eq(closure.execution.accepted_batches, 1, "closure accepted probe");
eq(closure.execution.complete_cold_batch_reached, false, "closure cold batch");
eq(closure.execution.two_reader_test_reached, false, "closure reader proof");
eq(closure.cleanup.result, "CLEAN_ROLLBACK_CONFIRMED_AFTER_NARROW_EXACT_CLEANUP", "closure cleanup");
eq(closure.reconciliation.result, "PASS_THREE_STABLE_READS_ZERO_DISPOSABLE_RESOURCES", "closure reconciliation");
eq(cleanup.failure_code, "RUNPOD_PROCESS_REPLACEMENT_WORKER_IDENTITY_UNAVAILABLE", "cleanup failure");
eq(cleanup.runpod.jobs_submitted, 1, "cleanup jobs");
eq(cleanup.runpod.final_disposable_resources_absent, true, "cleanup disposable resources");
eq(cleanup.retained_volumes_deleted_or_mutated_by_cleanup, false, "cleanup retained volumes");
eq(cleanup.cleanup_uncertain, false, "cleanup certainty");
eq(reconciliation.result, "PASS_THREE_STABLE_READS_ZERO_DISPOSABLE_RESOURCES", "reconciliation result");
eq(reconciliation.inventory.pods, 0, "reconciliation Pods");
eq(reconciliation.inventory.endpoints, 0, "reconciliation endpoints");
eq(reconciliation.inventory.private_templates, 0, "reconciliation templates");
eq(reconciliation.inventory.active_serverless_workers, 0, "reconciliation workers");
eq(reconciliation.inventory.running_pods, 0, "reconciliation running Pods");
eq(reconciliation.billing.observed_increment_usd, 0, "reconciliation increment");
eq(reconciliation.billing.within_approved_cap, true, "reconciliation cap");
eq(reconciliation.retention.mage_volume_retained, true, "Mage retained");
eq(reconciliation.retention.volume_mutation_observed, false, "volume mutation");
eq(reconciliation.v2_08_authorized, false, "reconciliation V2-08");

console.log(
  "PASS validate-v207-attempt47-terminal-pod-identity-candidate",
  JSON.stringify(E),
);

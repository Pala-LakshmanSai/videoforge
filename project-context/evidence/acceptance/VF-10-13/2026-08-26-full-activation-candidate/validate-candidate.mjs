import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, "../../../../../");
const proposalPath = path.join(dir, "combined-live-proposal.json");
const expectedProposalSha256 = "sha256:f2d183e7668152c25b54b3844cc340058ecb5f59dec58689d6eb229328bcae32";
const expectedReleaseCommit = "407dc070f4b83bd78b1d4aa1cb546ec63c91f32f";
const expectedBranch = "codex/serverless-v2-roadmap";
const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const assert = (condition, code) => {
  if (!condition) throw new Error(code);
};
const exactKeys = (value, keys, code) => {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), `${code}_OBJECT`);
  assert(JSON.stringify(Object.keys(value)) === JSON.stringify(keys), `${code}_KEYS`);
};
const includesOperation = (phase, text) =>
  phase.operations.some((operation) => operation.includes(text));

const bytes = await readFile(proposalPath);
assert(sha256(bytes) === expectedProposalSha256, "PROPOSAL_BYTES_SHA256");
assert(bytes.at(-1) === 0x0a, "PROPOSAL_FINAL_NEWLINE");
const proposal = JSON.parse(bytes);
const candidateCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
assert(candidateCommit !== expectedReleaseCommit, "GIT_CANDIDATE_DISTINCT_FROM_RELEASE");
assert(execFileSync("git", ["rev-parse", "HEAD^"], { cwd: root, encoding: "utf8" }).trim() === expectedReleaseCommit, "GIT_CANDIDATE_PARENT_RELEASE_SOURCE");
assert(
  execFileSync("git", ["diff", "--name-only", `${expectedReleaseCommit}..${candidateCommit}`], {
    cwd: root,
    encoding: "utf8",
  }).trim() ===
    [
      "project-context/evidence/acceptance/VF-10-13/2026-08-26-full-activation-candidate/combined-live-proposal.json",
      "project-context/evidence/acceptance/VF-10-13/2026-08-26-full-activation-candidate/validate-candidate.mjs",
    ].join("\n"),
  "GIT_CANDIDATE_CHANGED_FILES",
);
assert(execFileSync("git", ["branch", "--show-current"], { cwd: root, encoding: "utf8" }).trim() === expectedBranch, "GIT_BRANCH");
execFileSync("git", ["diff", "--quiet"], { cwd: root });
execFileSync("git", ["diff", "--cached", "--quiet"], { cwd: root });

exactKeys(proposal, [
  "schema_version",
  "checkpoint_range",
  "task_id",
  "candidate_date",
  "proposal_status",
  "source",
  "authority",
  "fresh_read_only_preflight",
  "requested_scope",
  "guarded_activation_child_contract",
  "ordered_operations",
  "global_fences",
  "stop_conditions",
  "approval_request",
], "ROOT");
assert(proposal.schema_version === "videoforge.v2-13-full-live-completion-proposal/v2", "SCHEMA");
assert(JSON.stringify(proposal.checkpoint_range) === JSON.stringify(["V2-07", "V2-08", "V2-09", "V2-10", "V2-11", "V2-12", "V2-13"]), "CHECKPOINT_RANGE");
assert(proposal.task_id === "VF-10-13" && proposal.proposal_status === "PENDING_FRESH_EXACT_USER_APPROVAL", "IDENTITY_STATUS");

exactKeys(proposal.source, [
  "release_source_commit",
  "proposal_record_commit",
  "proposal_record_commit_must_be_recorded_by_future_approval",
  "release_and_proposal_commits_are_distinct_lineage_fields",
  "branch",
  "push_target",
  "proposal_path",
  "future_approval_record_basename",
], "SOURCE");
assert(proposal.source.release_source_commit === expectedReleaseCommit, "SOURCE_RELEASE_COMMIT");
assert(proposal.source.proposal_record_commit === null, "SOURCE_PROPOSAL_COMMIT_MUST_BE_FUTURE");
assert(proposal.source.proposal_record_commit_must_be_recorded_by_future_approval === true && proposal.source.release_and_proposal_commits_are_distinct_lineage_fields === true, "SOURCE_DISTINCT_LINEAGE");
assert(proposal.source.branch === expectedBranch && proposal.source.push_target === `origin/${expectedBranch}`, "SOURCE_REF");
assert(proposal.source.proposal_path.endsWith("/combined-live-proposal.json") && proposal.source.future_approval_record_basename === "user-approval.json", "SOURCE_RECORD_PATHS");

exactKeys(proposal.authority, [
  "exact_proposal_approved",
  "approval_sha256",
  "authority_id",
  "approved_at",
  "expires_at",
  "execute_authorized",
  "credential_access_authorized",
  "database_mutation_authorized",
  "cloudflare_secret_mutation_authorized",
  "deployment_authorized",
  "provider_calls_authorized",
  "provider_mutations_authorized",
  "gpu_use_authorized",
  "external_spend_authorized",
  "executable_finite_cap_usd",
  "retained_volume_continuation_authorized",
  "new_paid_retained_resources_authorized",
  "recurring_plan_change_authorized",
  "single_use",
  "consumed",
  "redispatch_authorized",
], "AUTHORITY");
for (const key of [
  "exact_proposal_approved",
  "execute_authorized",
  "credential_access_authorized",
  "database_mutation_authorized",
  "cloudflare_secret_mutation_authorized",
  "deployment_authorized",
  "provider_calls_authorized",
  "provider_mutations_authorized",
  "gpu_use_authorized",
  "external_spend_authorized",
  "retained_volume_continuation_authorized",
  "new_paid_retained_resources_authorized",
  "recurring_plan_change_authorized",
  "consumed",
  "redispatch_authorized",
]) assert(proposal.authority[key] === false, `AUTHORITY_${key}`);
for (const key of ["approval_sha256", "authority_id", "approved_at", "expires_at", "executable_finite_cap_usd"])
  assert(proposal.authority[key] === null, `AUTHORITY_NULL_${key}`);
assert(proposal.authority.single_use === true, "AUTHORITY_SINGLE_USE");

const preflight = proposal.fresh_read_only_preflight;
assert(preflight.made_no_mutations_and_incurred_no_spend === true, "PREFLIGHT_READ_ONLY");
assert(preflight.runpod.account_id_sha256 === "sha256:ce23456f35fb79195520689203584405ad191e8461e87f413ede02f01168143c", "RUNPOD_ACCOUNT");
for (const key of ["pods", "endpoints", "private_templates", "active_workers", "running_workers"])
  assert(preflight.runpod[key] === 0, `RUNPOD_ZERO_${key}`);
assert(preflight.runpod.stable_read_count === 3 && preflight.runpod.selected_gpu === "NVIDIA GeForce RTX 4090" && preflight.runpod.region === "EU-RO-1" && preflight.runpod.availability === "HIGH", "RUNPOD_GPU_TRUTH");
assert(preflight.runpod.secure_reference_rate_usd_per_gpu_hour === 0.74 && preflight.runpod.serverless_flex_rate_usd_per_gpu_hour === 1.1, "RUNPOD_RATES");
assert(preflight.runpod.cumulative_endpoint_billing_usd === 2.214659276913153 && preflight.runpod.late_increment_since_attempt64_baseline_usd === 0.118769721360877 && preflight.runpod.late_increment_attributed_to_this_preflight === false, "RUNPOD_BILLING");
assert(JSON.stringify(preflight.retained_volumes) === JSON.stringify([
  { lane: "mage", volume_id_sha256: "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619", size_gb: 50, region: "EU-RO-1", recurring_usd_per_month: 3.5 },
  { lane: "soulx", volume_id_sha256: "sha256:2a8633e14bbecab54f52e2ae7b5b06bfa562b09a6ac781fe0985eb28e70587be", size_gb: 50, region: "EU-RO-1", recurring_usd_per_month: 3.5 },
]), "RETAINED_VOLUMES");
assert(preflight.cloudflare.account_id_sha256 === "sha256:dc7e469ff433fab0fab50ce06a41a24e27de8ab78155299f706d82c63fdccbe8", "CLOUDFLARE_ACCOUNT");
assert(preflight.cloudflare.active_version_id_sha256 === "sha256:1e5d35b4c2709641024655c7df5832f360aeb665068804f07ecc600a68186e19" && preflight.cloudflare.active_record_sha256 === "sha256:54cd4dcb8a5b2afe8ca8cad9f7aad7dd6d47ef14b36ef0f7b03c7ba90a234c89" && preflight.cloudflare.protected_config_sha256 === "sha256:da8c9232c9f6fe0f745a16f56f0855d726092df205e08eda6725fc0a146db774", "CLOUDFLARE_HASHES");
assert(preflight.cloudflare.protected_config_mode === "0600" && preflight.cloudflare.route_probe_count === 3 && preflight.cloudflare.route_result === "POST_404_V207_ROUTE_DISABLED" && preflight.cloudflare.signer_present === false && preflight.cloudflare.production_worker_present === false && preflight.cloudflare.exact_production_workflows_present === false, "CLOUDFLARE_ABSENCE");
assert(preflight.cloudflare.staging_private_r2_bucket_present === true && JSON.stringify(preflight.cloudflare.required_activation_secrets_present) === JSON.stringify(["DATABASE_URL"]) && preflight.cloudflare.remaining_required_activation_secrets_absent === true, "CLOUDFLARE_BINDINGS");
assert(preflight.neon.owner_connection_read_only_succeeded === true && preflight.neon.remote_migration_ledger_first === 1 && preflight.neon.remote_migration_ledger_last === 36 && preflight.neon.local_migration_ledger_last === 44 && JSON.stringify(preflight.neon.migrations_to_apply) === JSON.stringify([37, 38, 39, 40, 41, 42, 43, 44]), "NEON_LEDGER");
assert(preflight.neon.pgcrypto_present === false && preflight.neon.runtime_role_present === false && preflight.neon.reconciler_role_present === false, "NEON_ABSENCE");
assert(preflight.local.external_calls_after_preflight === 0 && preflight.local.mutations === 0 && preflight.local.gpu_use === 0 && preflight.local.spend_usd === 0, "LOCAL_ZERO_ACTIVITY");

const scope = proposal.requested_scope;
const expectedPhaseCaps = {
  mage_qualification: 4.5,
  soulx_qualification: 1,
  v2_09_short_hosted_project: 2,
  v2_10_operator_free_ranga_pilot: 2,
  v2_11_two_concurrent_owned_projects: 4,
  v2_12_long_output: 2,
  v2_13_final_two_lane_smoke: 2,
};
assert(scope.maximum_cumulative_finite_runpod_spend_usd === 17.5, "TOTAL_CAP");
assert(JSON.stringify(scope.phase_caps_usd) === JSON.stringify(expectedPhaseCaps), "PHASE_CAPS");
assert(Object.values(scope.phase_caps_usd).reduce((sum, value) => sum + value, 0) === 17.5 && scope.phase_caps_sum_to_cumulative_cap === true, "PHASE_CAP_SUM");
assert(scope.billing_lag_requires_full_open_liability_reservation === true, "BILLING_LAG_RESERVE");
assert(Object.values(scope.provider_free_activation).slice(0, 3).every((value) => value === 0) && scope.provider_free_activation.stop_on_metered_plan_or_new_paid_resource === true, "PROVIDER_FREE_ZERO_SPEND");
assert(scope.gpu.exact_offering === "NVIDIA GeForce RTX 4090" && scope.gpu.region === "EU-RO-1" && scope.gpu.minimum_availability_at_each_mutation_boundary === "LOW-or-better" && scope.gpu.maximum_serverless_flex_rate_usd_per_gpu_hour === 1.1 && scope.gpu.fallback_allowed === false, "GPU_SCOPE");
assert(scope.retention.retain_only_the_two_preexisting_volumes === true && scope.retention.combined_size_gb === 100 && scope.retention.combined_recurring_usd_per_month === 7 && scope.retention.recurring_charge_is_separate_from_finite_cap === true && scope.retention.new_volumes_authorized === 0 && scope.retention.volume_resize_move_or_replacement_authorized === false && scope.retention.recurring_plan_change_authorized === false && scope.retention.separate_fresh_consent_required === true, "RETENTION_SCOPE");
assert(JSON.stringify(scope.creation_allowlist.cloudflare) === JSON.stringify([
  "disabled Worker videoforge-production-runtime",
  "disabled Workflow videoforge-production-runtime",
  "disabled Workflow videoforge-production-runtime-pair",
]), "CLOUDFLARE_CREATION_ALLOWLIST");
assert(scope.creation_allowlist.runpod_after_both_lane_qualifications_only.length === 4 && scope.creation_allowlist.database.length === 4, "CONTROL_RESOURCE_ALLOWLIST");
for (const key of ["r2_buckets", "volumes", "other_resources", "paid_retained_resources"])
  assert(scope.creation_allowlist[key].length === 0, `EMPTY_CREATION_${key}`);

const child = proposal.guarded_activation_child_contract;
assert(child.executor === "deploy/v2-13/guarded-activation.mjs" && child.maximum_cumulative_finite_external_spend_usd === 0 && child.current_provider_calls_authorized === false && child.future_execute_provider_calls_authorized === true && child.gpu_use_authorized === false && child.exact_quarantine_creation_only === true, "CHILD_ZERO_SPEND_AUTHORITY");
assert(child.worker_name === "videoforge-production-runtime" && JSON.stringify(child.workflow_names) === JSON.stringify(["videoforge-production-runtime", "videoforge-production-runtime-pair"]), "CHILD_EXACT_NAMES");
assert(child.initial_state === "DISABLED_UNQUALIFIED" && child.r2_bucket_creation_authorized === false && child.new_paid_retained_resources_authorized === false && child.other_resource_creation_authorized === false && child.plan_change_authorized === false, "CHILD_CREATION_FENCES");
for (const required of ["unique authority_id", "this exact proposal path and sha256", "future exact user-approval path and sha256", "proposal record commit", "at-most-24-hour expires_at", "durable pre-credential consumption fence", "absent two Workflow", "exact existing R2 bucket name plus complete inventory/readback hash"])
  assert(child.future_authority_must_bind.some((value) => value.includes(required)), `CHILD_BIND_${required}`);

const expectedPhases = [
  "publish_exact_candidate_record",
  "publish_public_lane_images",
  "fresh_provider_admission",
  "mage_qualification",
  "soulx_qualification",
  "create_exact_max_one_lane_control_plane",
  "guarded_cloudflare_database_and_secret_activation",
  "v2_09_short_hosted_project",
  "v2_10_operator_free_ranga_pilot",
  "v2_11_two_concurrent_owned_projects",
  "v2_12_long_output",
  "v2_13_final_two_lane_smoke_and_release",
  "final_cleanup_and_reconciliation",
];
assert(proposal.ordered_operations.length === expectedPhases.length && proposal.ordered_operations.every((phase, index) => phase.order === index + 1), "ORDERED_PHASES");
assert(JSON.stringify(proposal.ordered_operations.map((phase) => phase.phase)) === JSON.stringify(expectedPhases), "PHASE_ORDER");
const phase = Object.fromEntries(proposal.ordered_operations.map((value) => [value.phase, value]));
for (const [name, cap] of Object.entries({ mage_qualification: 4.5, soulx_qualification: 1, v2_09_short_hosted_project: 2, v2_10_operator_free_ranga_pilot: 2, v2_11_two_concurrent_owned_projects: 4, v2_12_long_output: 2, v2_13_final_two_lane_smoke_and_release: 2 }))
  assert(phase[name].phase_cap_usd === cap, `PHASE_CAP_${name}`);
assert(includesOperation(phase.publish_public_lane_images, "publish=true") && includesOperation(phase.publish_public_lane_images, "never pre-claim an image digest") && includesOperation(phase.publish_public_lane_images, "anonymous public manifest"), "PUBLICATION_CONTRACT");
assert(includesOperation(phase.fresh_provider_admission, "LOW-or-better") && includesOperation(phase.fresh_provider_admission, "no GPU, region, volume, image, model, endpoint, rate, account, or resource fallback"), "ADMISSION_CONTRACT");
assert(includesOperation(phase.mage_qualification, "do not begin SoulX") && includesOperation(phase.soulx_qualification, "2-second, 4-second, 6-second, and 10-second") && includesOperation(phase.soulx_qualification, "do not create production endpoints"), "SERIAL_QUALIFICATION");
assert(includesOperation(phase.guarded_cloudflare_database_and_secret_activation, "GPU=false") && includesOperation(phase.guarded_cloudflare_database_and_secret_activation, "provider calls limited to the exact approved database and Cloudflare activation operations") && includesOperation(phase.guarded_cloudflare_database_and_secret_activation, "create no R2 bucket, plan, or other retained resource") && includesOperation(phase.guarded_cloudflare_database_and_secret_activation, "empty secret set before database mutation") && includesOperation(phase.guarded_cloudflare_database_and_secret_activation, "only after the disabled quarantine readback") && includesOperation(phase.guarded_cloudflare_database_and_secret_activation, "apply only migrations 0037 through 0044") && includesOperation(phase.guarded_cloudflare_database_and_secret_activation, "21-name secret set"), "GUARDED_ACTIVATION_INTERNAL_ORDER");
assert(includesOperation(phase.v2_09_short_hosted_project, "sha256:f975e2be15db227e96c6ea06f025c3f7ead025a5f80b80e9e2b0ac1f9fd6a4ea") && includesOperation(phase.v2_09_short_hosted_project, "never redispatch"), "V209_CONTRACT");
assert(includesOperation(phase.v2_10_operator_free_ranga_pilot, "one operator-free 3-to-5-minute Ranga-style MP4") && includesOperation(phase.v2_10_operator_free_ranga_pilot, "do not substitute recovery tests"), "V210_SCOPE");
assert(includesOperation(phase.v2_11_two_concurrent_owned_projects, "restore both endpoints to workersMax=1") && includesOperation(phase.v2_12_long_output, "29-to-31-minute") && includesOperation(phase.final_cleanup_and_reconciliation, "three stable zero-active-worker"), "SUCCESSOR_AND_CLEANUP");

for (const key of Object.keys(proposal.global_fences)) assert(proposal.global_fences[key] === true, `GLOBAL_FENCE_${key}`);
assert(proposal.stop_conditions.length === 11, "STOP_COUNT");
for (const required of ["USD 17.50", "USD 7/month", "at-most-24-hour", "no fallback", "billing-lag liability", "new paid retained resource", "redispatch", "zero-compute", "user cancellation"])
  assert(proposal.stop_conditions.some((value) => value.includes(required)), `STOP_${required}`);
assert(proposal.approval_request.requested_maximum_cumulative_finite_runpod_spend_usd === 17.5 && JSON.stringify(proposal.approval_request.requested_exact_phase_caps_usd) === JSON.stringify([4.5, 1, 2, 2, 4, 2, 2]), "APPROVAL_CAPS");
assert(proposal.approval_request.requested_gpu.includes("LOW-or-better") && proposal.approval_request.requested_gpu.includes("USD 1.10/GPU-hour") && proposal.approval_request.requested_gpu.includes("no fallback"), "APPROVAL_GPU");
assert(proposal.approval_request.requested_separate_retention_consent.includes("same two exact 50 GB EU-RO-1 volumes") && proposal.approval_request.requested_separate_retention_consent.includes("USD 7/month") && proposal.approval_request.requested_new_volumes === 0 && proposal.approval_request.requested_new_paid_retained_resources === 0, "APPROVAL_RETENTION");
assert(proposal.approval_request.authority_becomes_executable_only_after_exact_hash_and_commits_approval_is_recorded === true, "APPROVAL_EXECUTION_FENCE");

console.log(JSON.stringify({
  status: "PASS",
  proposal_sha256: expectedProposalSha256,
  release_source_commit: expectedReleaseCommit,
  proposal_record_commit: null,
  authority: "ABSENT",
  executable_cap_usd: null,
  provider_calls: 0,
  mutations: 0,
  gpu_use: 0,
  spend_usd: 0,
}));

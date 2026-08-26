import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, "../../../../../");
const expectedProposalSha256 = "sha256:f2d183e7668152c25b54b3844cc340058ecb5f59dec58689d6eb229328bcae32";
const expectedApprovalSha256 = "sha256:a8e60fdd7bf77a1362cc89a0dc272ac281f2ba92bf610101e59d5e3bc2ef6e6e";
const expectedAuthoritySha256 = "sha256:a4267d5e61d74662197254e26f5e57b29e30335b48cac6f0993ef11653843369";
const proposalRecordCommit = "e3bdabc161c60e5334c4055b5636b7fd768a86df";
const releaseSourceCommit = "407dc070f4b83bd78b1d4aa1cb546ec63c91f32f";
const authorityId = "v2-13-full-live-20260826-033320z-e3bdabc";
const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const assert = (condition, code) => {
  if (!condition) throw new Error(code);
};
const exactKeys = (value, keys, code) => {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), `${code}_OBJECT`);
  assert(JSON.stringify(Object.keys(value)) === JSON.stringify(keys), `${code}_KEYS`);
};

const [proposalBytes, approvalBytes, authorityBytes] = await Promise.all([
  readFile(path.join(dir, "combined-live-proposal.json")),
  readFile(path.join(dir, "user-approval.json")),
  readFile(path.join(dir, "approved-authority.json")),
]);
assert(sha256(proposalBytes) === expectedProposalSha256, "PROPOSAL_SHA256");
assert(sha256(approvalBytes) === expectedApprovalSha256, "APPROVAL_SHA256");
assert(sha256(authorityBytes) === expectedAuthoritySha256, "AUTHORITY_SHA256");
assert(approvalBytes.at(-1) === 0x0a && authorityBytes.at(-1) === 0x0a, "FINAL_NEWLINES");
const proposal = JSON.parse(proposalBytes);
const approval = JSON.parse(approvalBytes);
const authority = JSON.parse(authorityBytes);
assert(execFileSync("git", ["rev-parse", `${proposalRecordCommit}^`], { cwd: root, encoding: "utf8" }).trim() === releaseSourceCommit, "RELEASE_SOURCE_PARENT");
execFileSync("git", ["merge-base", "--is-ancestor", proposalRecordCommit, "HEAD"], { cwd: root });

exactKeys(approval, [
  "schema_version",
  "checkpoint_range",
  "task_id",
  "authority_id",
  "approval_source",
  "approved_at",
  "expires_at",
  "proposal",
  "approval",
  "execution_fences",
  "statement",
], "APPROVAL");
assert(approval.schema_version === "videoforge.v2-13-full-live-user-approval/v1" && approval.task_id === "VF-10-13", "APPROVAL_IDENTITY");
assert(approval.authority_id === authorityId && approval.approval_source === "explicit_user_approval_in_current_codex_task", "APPROVAL_SOURCE");
assert(Date.parse(approval.approved_at) === Date.parse("2026-08-26T03:33:20Z"), "APPROVED_AT");
assert(Date.parse(approval.expires_at) > Date.parse(approval.approved_at) && Date.parse(approval.expires_at) - Date.parse(approval.approved_at) <= 86_400_000, "APPROVAL_MAX_24_HOURS");
assert(approval.proposal.sha256 === expectedProposalSha256 && approval.proposal.proposal_record_commit === proposalRecordCommit && approval.proposal.release_source_commit === releaseSourceCommit, "APPROVAL_PROPOSAL_LINEAGE");
assert(approval.proposal.path.endsWith("/combined-live-proposal.json"), "APPROVAL_PROPOSAL_PATH");
assert(approval.approval.exact_proposal_approved === true && approval.approval.all_and_only_ordered_operations_approved === true && approval.approval.single_use === true && approval.approval.redispatch_authorized === false, "APPROVAL_SCOPE");
assert(approval.approval.maximum_cumulative_finite_runpod_spend_usd === 17.5, "APPROVAL_CAP");
const expectedPhaseCaps = {
  mage_qualification: 4.5,
  soulx_qualification: 1,
  v2_09_short_hosted_project: 2,
  v2_10_operator_free_ranga_pilot: 2,
  v2_11_two_concurrent_owned_projects: 4,
  v2_12_long_output: 2,
  v2_13_final_two_lane_smoke: 2,
};
assert(JSON.stringify(approval.approval.phase_caps_usd) === JSON.stringify(expectedPhaseCaps), "APPROVAL_PHASE_CAPS");
assert(Object.values(approval.approval.phase_caps_usd).reduce((sum, value) => sum + value, 0) === 17.5, "APPROVAL_PHASE_CAP_SUM");
const gpu = approval.approval.gpu;
assert(gpu.exact_offering === "NVIDIA GeForce RTX 4090" && gpu.region === "EU-RO-1" && gpu.minimum_availability_at_each_mutation_boundary === "LOW-or-better" && gpu.maximum_serverless_flex_rate_usd_per_gpu_hour === 1.1 && gpu.fallback_allowed === false, "APPROVAL_GPU");
const retention = approval.approval.retention;
assert(retention.retain_only_the_same_two_exact_volumes === true && retention.volume_count === 2 && retention.size_gb_each === 50 && retention.region === "EU-RO-1" && retention.combined_recurring_usd_per_month === 7 && retention.recurring_charge_separate_from_finite_cap === true, "APPROVAL_RETENTION");
assert(retention.new_volume_or_paid_retained_resource_authorized === false && retention.volume_resize_move_or_replacement_authorized === false && retention.recurring_plan_change_authorized === false, "APPROVAL_RETENTION_FENCES");
const control = approval.approval.provider_free_control_plane;
assert(control.github_publication_expected_runpod_spend_usd === 0 && control.database_activation_expected_runpod_spend_usd === 0 && control.cloudflare_activation_expected_runpod_spend_usd === 0 && control.guarded_child_gpu_use_authorized === false && control.guarded_child_maximum_cumulative_finite_external_spend_usd === 0, "APPROVAL_CHILD_ZERO_SPEND");
assert(control.exact_disabled_quarantine_creation_authorized === true && control.new_r2_bucket_authorized === false && control.new_paid_retained_resource_authorized === false && control.other_resource_creation_authorized === false && control.plan_change_authorized === false && control.stop_on_metered_plan_or_new_paid_resource === true, "APPROVAL_CHILD_CREATION_FENCES");
for (const [key, value] of Object.entries(approval.execution_fences)) assert(value === true, `APPROVAL_FENCE_${key}`);
assert(approval.statement.includes(expectedProposalSha256) && approval.statement.includes(proposalRecordCommit) && approval.statement.includes("USD 17.50") && approval.statement.includes("USD 7 per month") && approval.statement.includes("no fallback"), "APPROVAL_STATEMENT");

exactKeys(authority, [
  "schema_version",
  "checkpoint_range",
  "task_id",
  "authority_id",
  "status",
  "approved_at",
  "expires_at",
  "single_use",
  "consumed",
  "consumed_at",
  "authority_record_commit",
  "lineage",
  "combined_execution_authority",
  "phase_caps_usd",
  "gpu_and_rate",
  "github_release_ref",
  "outer_orchestration",
  "retained_volume_consent",
  "creation_allowlist",
  "guarded_activation_child",
  "ordered_execution",
  "stop_and_cleanup",
  "provider_free_recording",
], "AUTHORITY");
assert(authority.schema_version === "videoforge.v2-13-full-live-approved-authority/v1" && authority.task_id === "VF-10-13", "AUTHORITY_IDENTITY");
assert(authority.authority_id === authorityId && authority.status === "SUPERSEDED_UNCONSUMED_NO_MUTATION" && authority.single_use === true && authority.consumed === false && authority.consumed_at === null && authority.authority_record_commit === null, "AUTHORITY_STATE");
assert(authority.approved_at === approval.approved_at && authority.expires_at === approval.expires_at, "AUTHORITY_TIME_BINDING");
assert(authority.lineage.proposal_sha256 === expectedProposalSha256 && authority.lineage.proposal_record_commit === proposalRecordCommit && authority.lineage.release_source_commit === releaseSourceCommit && authority.lineage.user_approval_sha256 === expectedApprovalSha256, "AUTHORITY_LINEAGE");
assert(authority.lineage.proposal_path === approval.proposal.path && authority.lineage.user_approval_path.endsWith("/user-approval.json"), "AUTHORITY_PATHS");
const combined = authority.combined_execution_authority;
for (const key of ["execute_authorized", "credential_access_authorized", "database_mutation_authorized", "cloudflare_secret_mutation_authorized", "deployment_authorized", "provider_calls_authorized", "provider_mutations_authorized", "gpu_use_authorized", "external_runpod_spend_authorized"])
  assert(combined[key] === false, `SUPERSEDED_COMBINED_${key}`);
assert(combined.maximum_cumulative_finite_runpod_spend_usd === null && combined.redispatch_authorized === false && combined.new_volume_authorized === false && combined.new_paid_retained_resource_authorized === false && combined.recurring_plan_change_authorized === false, "SUPERSEDED_COMBINED_LIMITS");
assert(JSON.stringify(authority.phase_caps_usd) === JSON.stringify(expectedPhaseCaps), "AUTHORITY_PHASE_CAPS");
assert(authority.gpu_and_rate.exact_offering === gpu.exact_offering && authority.gpu_and_rate.region === gpu.region && authority.gpu_and_rate.minimum_availability_at_each_mutation_boundary === gpu.minimum_availability_at_each_mutation_boundary && authority.gpu_and_rate.maximum_serverless_flex_rate_usd_per_gpu_hour === gpu.maximum_serverless_flex_rate_usd_per_gpu_hour && authority.gpu_and_rate.fallback_allowed === false && authority.gpu_and_rate.fresh_rate_catalog_inventory_and_billing_required === true, "AUTHORITY_GPU");
assert(authority.github_release_ref.required_for_workflow_dispatch === true && authority.github_release_ref.exact_target_commit === releaseSourceCommit && authority.github_release_ref.exact_ref_name === null && authority.github_release_ref.ref_creation_authorized_by_approved_proposal === false && authority.github_release_ref.status === "BLOCKED_EXACT_IMMUTABLE_REF_CREATION_REQUIRES_SEPARATE_AUTHORITY" && authority.github_release_ref.external_action_taken === false, "GITHUB_RELEASE_REF_BLOCKER");
assert(authority.outer_orchestration.approval_schema_validator_path === "deploy/v2-13/validate-full-live-approval.mjs" && authority.outer_orchestration.approval_schema_validator_sha256 === "sha256:ad116191f439188c44fc139aaa169fdd7a23a809d3fcd7ad91203455e5960c78" && authority.outer_orchestration.orchestration_tool_path === "deploy/v2-13/full-live-orchestration-authority.mjs" && authority.outer_orchestration.orchestration_tool_sha256 === "sha256:391a06d188a588db2c8eac6f7324b31eee06073ae73ba1ab3e0a314b3f84d410" && authority.outer_orchestration.guarded_activation_path === "deploy/v2-13/guarded-activation.mjs" && authority.outer_orchestration.guarded_activation_sha256 === "sha256:d909f756cd4d7e8fda8c07af0766ae9292171abc680613f628b3639b55004165" && authority.outer_orchestration.consumption_record_created === false && authority.outer_orchestration.consumption_record_sha256 === null && authority.outer_orchestration.consumption_required_before_credentials_or_external_calls === true && authority.outer_orchestration.state_updates_require_exact_prior_state_sha256_and_exclusive_lock === true && authority.outer_orchestration.phase_order_caps_cumulative_cap_and_no_redispatch_enforced === true, "OUTER_ORCHESTRATION_SEAL");
assert(authority.outer_orchestration.full_live_executor_path === "deploy/v2-13/full-live-executor.mjs" && authority.outer_orchestration.full_live_executor_sha256 === "sha256:15528fd626142e389bb065b6234f8294005c687304b5f10119d719829cd55002", "FULL_LIVE_EXECUTOR_SEAL");
assert(authority.retained_volume_consent.authorized === true && authority.retained_volume_consent.retain_only_same_two_exact_volumes === true && authority.retained_volume_consent.size_gb_each === 50 && authority.retained_volume_consent.region === "EU-RO-1" && authority.retained_volume_consent.combined_recurring_usd_per_month === 7 && authority.retained_volume_consent.recurring_charge_separate_from_finite_cap === true && authority.retained_volume_consent.resize_move_replace_or_add_authorized === false, "AUTHORITY_VOLUME_CONSENT");
assert(authority.retained_volume_consent.mage_volume_id_sha256 === proposal.fresh_read_only_preflight.retained_volumes[0].volume_id_sha256 && authority.retained_volume_consent.soulx_volume_id_sha256 === proposal.fresh_read_only_preflight.retained_volumes[1].volume_id_sha256, "AUTHORITY_VOLUME_IDENTITIES");
assert(JSON.stringify(authority.creation_allowlist.cloudflare) === JSON.stringify(proposal.requested_scope.creation_allowlist.cloudflare) && authority.creation_allowlist.runpod_after_both_fresh_lane_qualifications_only.length === 4 && authority.creation_allowlist.database.length === 4, "AUTHORITY_CREATION_ALLOWLIST");
for (const key of ["r2_buckets", "volumes", "other_resources", "paid_retained_resources"])
  assert(authority.creation_allowlist[key].length === 0, `AUTHORITY_EMPTY_${key}`);
const child = authority.guarded_activation_child;
assert(child.status === "NEVER_ISSUE_FROM_SUPERSEDED_AUTHORITY" && child.approved_parent_authority_id === authorityId && child.executor === "deploy/v2-13/guarded-activation.mjs" && child.future_authority_basename === "guarded-activation-authority.json", "CHILD_STATE");
assert(child.future_authority_must_reuse_parent_proposal_and_approval_hashes === true && child.future_authority_must_use_exact_parent_authority_id === true && child.future_authority_expiry_must_not_exceed_parent_expiry === true, "CHILD_LINEAGE_FENCES");
for (const key of ["future_execute_authorized", "future_credential_access_authorized", "future_database_mutation_authorized", "future_cloudflare_secret_mutation_authorized", "future_deployment_authorized", "future_provider_calls_authorized"])
  assert(child[key] === false, `SUPERSEDED_CHILD_${key}`);
assert(child.exact_quarantine_creation_authorized === true, "HISTORICAL_APPROVED_QUARANTINE_SCOPE");
assert(child.gpu_use_authorized === false && child.maximum_cumulative_finite_external_spend_usd === 0 && child.new_paid_retained_resources_authorized === false && child.other_resource_creation_authorized === false && child.plan_change_authorized === false, "CHILD_ZERO_SPEND_FENCES");
assert(child.unresolved_exact_inputs.length === 11 && child.unresolved_exact_inputs.some((value) => value.includes("returned after publication")) && child.unresolved_exact_inputs.some((value) => value.includes("exact existing R2 bucket name")) && child.unresolved_exact_inputs.some((value) => value.includes("21-name secret-file hashes")), "CHILD_UNRESOLVED_INPUTS");
assert(child.issuance_fence === "DO_NOT_CREATE_EXECUTABLE_GUARDED_AUTHORITY_FROM_THIS_SUPERSEDED_PARENT", "CHILD_ISSUANCE_FENCE");
assert(JSON.stringify(authority.ordered_execution.guarded_child_internal_order) === JSON.stringify([
  "exact secret-free disabled Cloudflare quarantine",
  "database pgcrypto, migrations 0037 through 0044, fresh roles, grants, and readbacks",
  "exact closed-world 21 secrets and final disabled deployment",
]), "CHILD_INTERNAL_ORDER");
for (const [key, value] of Object.entries(authority.stop_and_cleanup)) assert(value === true, `AUTHORITY_STOP_${key}`);
assert(JSON.stringify(authority.provider_free_recording) === JSON.stringify({ credentials_accessed: false, external_calls: 0, provider_mutations: 0, gpu_use: 0, runpod_spend_usd: 0, guarded_child_authority_created: false, superseded_before_external_action: true }), "PROVIDER_FREE_RECORDING");

console.log(JSON.stringify({
  status: "PASS",
  authority_id: authorityId,
  proposal_sha256: expectedProposalSha256,
  user_approval_sha256: expectedApprovalSha256,
  approved_authority_sha256: expectedAuthoritySha256,
  proposal_record_commit: proposalRecordCommit,
  release_source_commit: releaseSourceCommit,
  approved_at: authority.approved_at,
  expires_at: authority.expires_at,
  combined_authority: "SUPERSEDED_UNCONSUMED_NO_MUTATION",
  guarded_child_authority: "NEVER_ISSUE_FROM_SUPERSEDED_AUTHORITY",
  credentials_accessed: false,
  external_calls: 0,
  mutations: 0,
  gpu_use: 0,
  runpod_spend_usd: 0,
}));

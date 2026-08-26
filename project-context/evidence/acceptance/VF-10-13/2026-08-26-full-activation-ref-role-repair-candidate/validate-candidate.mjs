import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, "../../../../../");
const proposalPath = path.join(dir, "combined-live-proposal.json");
const expectedProposalSha256 =
  "sha256:d02d227916d3e61f8b26c5c6da8cce9f0727fe13fe2fcf619f5b3eb67cd9b700";
const baseSourceCommit = "7e561fd8fdb4e6281650c09a5a7859849f473a00";
const supersededProposalCommit = "e3bdabc161c60e5334c4055b5636b7fd768a86df";
const exactReleaseComponents = {
  full_live_executor: {
    path: "deploy/v2-13/full-live-executor.mjs",
    sha256: "sha256:2b782863fef0222527a10fcd1d4bb1c8bacfc58d601ebd764e1919968d781830",
    sole_canonical_live_mutation_path: true,
  },
  full_live_adapters: {
    path: "deploy/v2-13/full-live-adapters.mjs",
    sha256: "sha256:2d59c91bfcfd57e9b2f2ecfcdce2e85e4f288fe2dc63aedf7adcd86b14f10dea",
  },
  promotion: {
    path: "deploy/v2-13/promote-qualified-production.mjs",
    sha256: "sha256:efaf573c00109cc52ecedd617bebe48d03747d467f3ffc481fd6d2cb0d95ce66",
  },
  guarded_activation: {
    path: "deploy/v2-13/guarded-activation.mjs",
    sha256: "sha256:8946676cae1ab8c414880e2d093fc8bbc957d97af6ee0f6a30ee052aea9bf8d0",
  },
  orchestration_authority: {
    path: "deploy/v2-13/full-live-orchestration-authority.mjs",
    sha256: "sha256:be1bbca1d933cd555baa768d13a9ebf33cd75be4c4214df79e09cbe7e505b241",
  },
  typescript_cli_bridge: {
    path: "apps/web/src/server/providers/v213-full-live-cli.ts",
    sha256: "sha256:ec6c459294769a04d3126e37d4e2d94be1578095a2ec11bfd9221fc02a6f8123",
  },
  runpod_dual_lane_transport: {
    path: "apps/web/src/server/providers/v213-runpod-dual-lane-transport.ts",
    sha256: "sha256:7d2ac27d25f6906aae1147833618e4a471ef0ca72f7ea6159ea993444ae53fe6",
  },
  migration_0045: {
    path: "packages/control-plane/migrations/0045_hosted_full_live_activation.sql",
    sha256: "sha256:fdb9c122c87603ff5f204a055eab902d41f362fec3be58d83be4ec088208b34d",
  },
};
const exactOperationIds = [
  "release-tag-create", "release-tag-push", "release-tag-readback", "approval-commit-push",
  "mage-image-workflow-dispatch", "mage-image-workflow-verification",
  "soulx-image-workflow-dispatch", "soulx-image-workflow-verification", "fresh-live-preflight",
  "mage-live-qualification", "soulx-live-qualification", "create-exact-max-one-endpoints",
  "guarded-activation-once", "promote-qualified-production", "v2-09-short-hosted-project",
  "v2-10-operator-free-ranga-pilot", "v2-11-two-concurrent-owned-projects",
  "v2-12-long-output", "v2-13-final-two-lane-smoke", "restore-endpoints-max-one",
  "prove-zero-workers", "read-settled-billing", "reconcile-exact-resources",
];
const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const assert = (condition, code) => {
  if (!condition) throw new Error(code);
};

const bytes = await readFile(proposalPath);
assert(sha256(bytes) === expectedProposalSha256, "PROPOSAL_SHA256");
assert(bytes.at(-1) === 0x0a, "FINAL_NEWLINE");
const proposal = JSON.parse(bytes);
assert(proposal.schema_version === "videoforge.v2-13-full-live-completion-proposal/v3", "SCHEMA");
assert(proposal.task_id === "VF-10-13" && proposal.proposal_status === "BLOCKED_PENDING_NEW_CLEAN_SOURCE_COMMIT_AND_RESEAL", "STATUS");
assert(proposal.supersession.supersedes_proposal_record_commit === supersededProposalCommit && proposal.supersession.prior_approval_reusable === false && proposal.supersession.fresh_exact_approval_required === true, "SUPERSESSION");
assert(proposal.sealing.sealed_for_exact_user_approval === false && proposal.sealing.current_bytes_are_approval_ineligible === true, "UNSEALED");
assert(proposal.source.release_source_commit === null && proposal.source.base_source_commit_before_semantic_tag_repair === baseSourceCommit && proposal.source.proposal_record_commit === null && proposal.source.future_approval_record_commit === null, "SOURCE_LINEAGE");
assert(JSON.stringify(proposal.source.exact_release_components) === JSON.stringify(exactReleaseComponents), "EXACT_RELEASE_COMPONENTS");
for (const component of Object.values(exactReleaseComponents)) {
  const componentBytes = await readFile(path.join(root, component.path));
  assert(sha256(componentBytes) === component.sha256, `RELEASE_COMPONENT_${component.path}`);
}
for (const key of ["exact_proposal_approved", "execute_authorized", "credential_access_authorized", "database_mutation_authorized", "cloudflare_secret_mutation_authorized", "deployment_authorized", "provider_calls_authorized", "provider_mutations_authorized", "gpu_use_authorized", "external_spend_authorized", "immutable_release_ref_creation_authorized", "consumed", "redispatch_authorized"])
  assert(proposal.authority[key] === false, `AUTHORITY_${key}`);
for (const key of ["authority_id", "approval_sha256", "approved_at", "expires_at", "executable_finite_cap_usd"])
  assert(proposal.authority[key] === null, `AUTHORITY_NULL_${key}`);
assert(proposal.authority.single_use === true, "AUTHORITY_SINGLE_USE");
assert(JSON.stringify(proposal.exact_execution_graph.ordered_operation_ids) === JSON.stringify(exactOperationIds) && proposal.exact_execution_graph.operation_order_is_closed_and_non_reorderable === true && proposal.exact_execution_graph.missing_extra_or_repeated_operation_is_a_hard_stop === true, "EXACT_EXECUTION_GRAPH");
const ref = proposal.immutable_github_release_ref_request;
assert(ref.creation_requested === true && ref.exact_ref === "refs/tags/videoforge-v2-13-release-20260826-v3" && ref.exact_tag_name === "videoforge-v2-13-release-20260826-v3" && ref.exact_target_commit === null && ref.tag_kind === "LIGHTWEIGHT" && ref.maximum_new_refs === 1, "EXACT_RELEASE_REF");
assert(ref.force_update_authorized === false && ref.delete_or_retarget_authorized === false && ref.other_ref_creation_authorized === false && ref.remote === "origin" && ref.stop_on_presence_collision_or_drift === true, "RELEASE_REF_FENCES");
assert(ref.exact_mutation.includes("without force") && ref.required_readback.includes("newly pinned clean source commit"), "RELEASE_REF_OPERATION");
const scope = proposal.requested_scope;
const phaseCaps = { mage_qualification: 4.5, soulx_qualification: 1, v2_09_short_hosted_project: 2, v2_10_operator_free_ranga_pilot: 2, v2_11_two_concurrent_owned_projects: 4, v2_12_long_output: 2, v2_13_final_two_lane_smoke: 2 };
assert(scope.maximum_cumulative_finite_runpod_spend_usd === 17.5 && JSON.stringify(scope.phase_caps_usd) === JSON.stringify(phaseCaps) && Object.values(scope.phase_caps_usd).reduce((sum, value) => sum + value, 0) === 17.5, "CAPS");
assert(scope.gpu.exact_offering === "NVIDIA GeForce RTX 4090" && scope.gpu.region === "EU-RO-1" && scope.gpu.minimum_availability_at_each_mutation_boundary === "LOW-or-better" && scope.gpu.maximum_serverless_flex_rate_usd_per_gpu_hour === 1.1 && scope.gpu.fallback_allowed === false, "GPU");
assert(scope.retention.combined_recurring_usd_per_month === 7 && scope.retention.retain_only_the_same_two_exact_volumes === true && scope.retention.new_volume_or_paid_retained_resource_authorized === false, "RETENTION");
assert(scope.database.exact_runtime_role === "videoforge_hosted_runtime" && scope.database.exact_reconciler_role === "videoforge_hosted_reconciler" && scope.database.roles_must_be_fresh_absent_distinct_login_noinherit_hardened === true && JSON.stringify(scope.database.exact_migrations_to_apply) === JSON.stringify([37, 38, 39, 40, 41, 42, 43, 44, 45]), "DATABASE_ROLES");
assert(scope.other_new_git_refs === 0 && scope.new_r2_buckets === 0 && scope.new_volumes === 0 && scope.new_paid_retained_resources === 0 && scope.other_resource_creation_authorized === false && scope.plan_change_authorized === false, "NO_SCOPE_EXPANSION");
assert(proposal.ordered_operations.length === 10 && proposal.ordered_operations.every((phase, index) => phase.order === index + 1), "ORDER");
assert(proposal.ordered_operations[2].phase === "create_and_verify_exact_release_tag" && proposal.ordered_operations[3].phase === "push_exact_approval_branch_commit" && proposal.ordered_operations[4].phase === "publish_public_lane_images", "REF_BRANCH_PUBLICATION_ORDER");
assert(proposal.ordered_operations[5].operations.some((value) => value.includes("page=1&per_page=100")) && proposal.ordered_operations[7].operations.some((value) => value.includes("videoforge_hosted_runtime") && value.includes("videoforge_hosted_reconciler")), "PAGINATION_AND_ROLES");
assert(proposal.stop_conditions.some((value) => value.includes("exact release tag exists before mutation")) && proposal.stop_conditions.some((value) => value.includes("USD 17.50")) && proposal.stop_conditions.some((value) => value.includes("no fallback")) && proposal.stop_conditions.some((value) => value.includes("redispatch")), "STOP_CONDITIONS");
assert(proposal.approval_request.requested_exact_git_ref_mutation.includes("videoforge-v2-13-release-20260826-v3") && JSON.stringify(proposal.approval_request.requested_exact_database_roles) === JSON.stringify(["videoforge_hosted_runtime", "videoforge_hosted_reconciler"]) && proposal.approval_request.authority_becomes_executable_only_after_exact_hash_and_commit_approval_is_recorded === true, "APPROVAL_REQUEST");
execFileSync("git", ["merge-base", "--is-ancestor", supersededProposalCommit, "HEAD"], { cwd: root });
assert(execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim() === baseSourceCommit, "BASE_SOURCE_HEAD");
assert(execFileSync("git", ["rev-parse", `${supersededProposalCommit}^`], { cwd: root, encoding: "utf8" }).trim() === "407dc070f4b83bd78b1d4aa1cb546ec63c91f32f", "SUPERSEDED_COMMIT_LINEAGE");
for (const basename of ["user-approval.json", "approved-authority.json"]) {
  try {
    await access(path.join(dir, basename));
    assert(false, `AUTHORITY_RECORD_PRESENT_${basename}`);
  } catch (error) {
    assert(error?.code === "ENOENT", `AUTHORITY_RECORD_CHECK_${basename}`);
  }
}

console.log(JSON.stringify({ status: "BLOCKED_UNSEALED_AS_EXPECTED", proposal_sha256: expectedProposalSha256, release_source_commit: null, base_source_commit: baseSourceCommit, proposal_record_commit: null, authority: "ABSENT", exact_release_tag_requested: "videoforge-v2-13-release-20260826-v3", exact_database_roles: ["videoforge_hosted_runtime", "videoforge_hosted_reconciler"], external_calls: 0, mutations: 0, gpu_use: 0, spend_usd: 0 }));

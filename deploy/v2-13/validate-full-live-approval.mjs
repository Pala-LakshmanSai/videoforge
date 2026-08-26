import { createHash } from "node:crypto";

const AUTHORITY_ID = /^v2-13-[a-z0-9][a-z0-9._-]{7,95}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const HASH = /^sha256:[0-9a-f]{64}$/u;
const PROPOSAL_SCHEMA_V2 = "videoforge.v2-13-full-live-completion-proposal/v2";
const PROPOSAL_SCHEMA_V3 = "videoforge.v2-13-full-live-completion-proposal/v3";
const APPROVAL_SCHEMA_V1 = "videoforge.v2-13-full-live-user-approval/v1";
const APPROVAL_SCHEMA_V2 = "videoforge.v2-13-full-live-user-approval/v2";
const EXPECTED_PHASE_CAPS = Object.freeze({
  mage_qualification: 4.5,
  soulx_qualification: 1,
  v2_09_short_hosted_project: 2,
  v2_10_operator_free_ranga_pilot: 2,
  v2_11_two_concurrent_owned_projects: 4,
  v2_12_long_output: 2,
  v2_13_final_two_lane_smoke: 2,
});
const CHECKPOINT_RANGE = Object.freeze([
  "V2-07",
  "V2-08",
  "V2-09",
  "V2-10",
  "V2-11",
  "V2-12",
  "V2-13",
]);
const EXECUTION_FENCE_KEYS = Object.freeze([
  "proposal_bytes_must_rehash_exactly",
  "proposal_and_release_commits_must_remain_distinct_and_exact",
  "trusted_time_and_unexpired_authority_required_before_every_mutation_boundary",
  "durable_single_use_consumption_fence_required_before_credential_access",
  "fresh_exact_readbacks_and_complete_inventory_required_before_mutation",
  "returned_post_run_image_digests_only",
  "mage_must_pass_before_soulx",
  "both_lanes_must_pass_before_production_endpoints",
  "no_redispatch",
  "no_gpu_region_rate_image_model_volume_or_resource_fallback",
  "billing_lag_liability_reserved_before_paid_work",
  "phase_and_cumulative_caps_are_hard_stops",
  "cleanup_zero_worker_billing_and_max_one_restoration_required",
  "user_cancellation_is_immediate_stop",
]);

const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const exactKeys = (value, keys) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  JSON.stringify(Object.keys(value)) === JSON.stringify(keys);
const fail = (code) => {
  throw new Error(`V2_13_FULL_LIVE_APPROVAL_${code}`);
};
const parse = (bytes, code) => {
  try {
    return JSON.parse(bytes);
  } catch {
    fail(`${code}_JSON_INVALID`);
  }
};

function validateFullLiveUserApproval({
  proposalBytes,
  approvalBytes,
  expectedProposalSha256,
  expectedProposalRecordCommit,
  expectedReleaseSourceCommit,
}) {
  if (!Buffer.isBuffer(proposalBytes) || !Buffer.isBuffer(approvalBytes)) fail("BYTES_REQUIRED");
  if (!HASH.test(expectedProposalSha256 ?? "") || sha256(proposalBytes) !== expectedProposalSha256)
    fail("PROPOSAL_SHA256");
  if (!COMMIT.test(expectedProposalRecordCommit ?? "")) fail("PROPOSAL_COMMIT");
  if (!COMMIT.test(expectedReleaseSourceCommit ?? "")) fail("RELEASE_SOURCE_COMMIT");
  const proposal = parse(proposalBytes, "PROPOSAL");
  const approval = parse(approvalBytes, "APPROVAL");
  const isV3 = proposal.schema_version === PROPOSAL_SCHEMA_V3;
  if (
    ![PROPOSAL_SCHEMA_V2, PROPOSAL_SCHEMA_V3].includes(proposal.schema_version) ||
    proposal.task_id !== "VF-10-13" ||
    proposal.proposal_status !== "PENDING_FRESH_EXACT_USER_APPROVAL" ||
    proposal.source?.release_source_commit !== expectedReleaseSourceCommit ||
    proposal.source?.proposal_record_commit !== null ||
    proposal.requested_scope?.maximum_cumulative_finite_runpod_spend_usd !== 17.5 ||
    JSON.stringify(proposal.requested_scope?.phase_caps_usd) !== JSON.stringify(EXPECTED_PHASE_CAPS)
  )
    fail("PROPOSAL_CONTRACT");
  if (
    isV3 &&
    (proposal.supersession?.prior_approval_reusable !== false ||
      proposal.supersession?.fresh_exact_approval_required !== true ||
      proposal.authority?.exact_proposal_approved !== false ||
      proposal.authority?.execute_authorized !== false ||
      proposal.authority?.immutable_release_ref_creation_authorized !== false ||
      !exactKeys(proposal.source?.exact_full_live_executor, [
        "path",
        "sha256",
        "sole_canonical_live_mutation_path",
      ]) ||
      proposal.source.exact_full_live_executor.path !== "deploy/v2-13/full-live-executor.mjs" ||
      proposal.source.exact_full_live_executor.sha256 !==
        "sha256:15528fd626142e389bb065b6234f8294005c687304b5f10119d719829cd55002" ||
      proposal.source.exact_full_live_executor.sole_canonical_live_mutation_path !== true)
  )
    fail("V3_SUPERSESSION_OR_AUTHORITY");
  if (
    !exactKeys(approval, [
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
    ]) ||
    approval.schema_version !== (isV3 ? APPROVAL_SCHEMA_V2 : APPROVAL_SCHEMA_V1) ||
    approval.task_id !== "VF-10-13" ||
    JSON.stringify(approval.checkpoint_range) !== JSON.stringify(CHECKPOINT_RANGE) ||
    approval.approval_source !== "explicit_user_approval_in_current_codex_task" ||
    !AUTHORITY_ID.test(approval.authority_id)
  )
    fail("SCHEMA");
  if (
    !exactKeys(approval.proposal, [
      "path",
      "sha256",
      "proposal_record_commit",
      "release_source_commit",
    ]) ||
    !exactKeys(approval.approval, [
      "exact_proposal_approved",
      "all_and_only_ordered_operations_approved",
      "single_use",
      "redispatch_authorized",
      "maximum_cumulative_finite_runpod_spend_usd",
      "phase_caps_usd",
      "gpu",
      "retention",
      "provider_free_control_plane",
      ...(isV3 ? ["immutable_github_release_ref", "database_roles"] : []),
    ]) ||
    !exactKeys(approval.approval.phase_caps_usd, Object.keys(EXPECTED_PHASE_CAPS)) ||
    !exactKeys(approval.approval.gpu, [
      "exact_offering",
      "region",
      "minimum_availability_at_each_mutation_boundary",
      "maximum_serverless_flex_rate_usd_per_gpu_hour",
      "fallback_allowed",
    ]) ||
    !exactKeys(approval.approval.retention, [
      "retain_only_the_same_two_exact_volumes",
      "volume_count",
      "size_gb_each",
      "region",
      "combined_recurring_usd_per_month",
      "recurring_charge_separate_from_finite_cap",
      "new_volume_or_paid_retained_resource_authorized",
      "volume_resize_move_or_replacement_authorized",
      "recurring_plan_change_authorized",
    ]) ||
    !exactKeys(approval.approval.provider_free_control_plane, [
      "github_publication_expected_runpod_spend_usd",
      "database_activation_expected_runpod_spend_usd",
      "cloudflare_activation_expected_runpod_spend_usd",
      "guarded_child_gpu_use_authorized",
      "guarded_child_maximum_cumulative_finite_external_spend_usd",
      "exact_disabled_quarantine_creation_authorized",
      "new_r2_bucket_authorized",
      "new_paid_retained_resource_authorized",
      "other_resource_creation_authorized",
      "plan_change_authorized",
      "stop_on_metered_plan_or_new_paid_resource",
    ]) ||
    !exactKeys(approval.execution_fences, EXECUTION_FENCE_KEYS)
  )
    fail("NESTED_SCHEMA");
  const approvedAt = Date.parse(approval.approved_at ?? "");
  const expiresAt = Date.parse(approval.expires_at ?? "");
  if (
    Number.isNaN(approvedAt) ||
    Number.isNaN(expiresAt) ||
    expiresAt <= approvedAt ||
    expiresAt - approvedAt > 86_400_000
  )
    fail("EXPIRY");
  if (
    approval.proposal?.sha256 !== expectedProposalSha256 ||
    approval.proposal?.proposal_record_commit !== expectedProposalRecordCommit ||
    approval.proposal?.release_source_commit !== expectedReleaseSourceCommit ||
    approval.proposal?.path !== proposal.source.proposal_path
  )
    fail("LINEAGE");
  const approved = approval.approval;
  if (
    approved?.exact_proposal_approved !== true ||
    approved.all_and_only_ordered_operations_approved !== true ||
    approved.single_use !== true ||
    approved.redispatch_authorized !== false ||
    approved.maximum_cumulative_finite_runpod_spend_usd !== 17.5 ||
    JSON.stringify(approved.phase_caps_usd) !== JSON.stringify(EXPECTED_PHASE_CAPS) ||
    Object.values(approved.phase_caps_usd).reduce((sum, value) => sum + value, 0) !== 17.5
  )
    fail("CAPS_OR_SINGLE_USE");
  const gpu = approved.gpu;
  if (
    gpu?.exact_offering !== "NVIDIA GeForce RTX 4090" ||
    gpu.region !== "EU-RO-1" ||
    gpu.minimum_availability_at_each_mutation_boundary !== "LOW-or-better" ||
    gpu.maximum_serverless_flex_rate_usd_per_gpu_hour !== 1.1 ||
    gpu.fallback_allowed !== false
  )
    fail("GPU_RATE_REGION");
  const retention = approved.retention;
  if (
    retention?.retain_only_the_same_two_exact_volumes !== true ||
    retention.volume_count !== 2 ||
    retention.size_gb_each !== 50 ||
    retention.region !== "EU-RO-1" ||
    retention.combined_recurring_usd_per_month !== 7 ||
    retention.recurring_charge_separate_from_finite_cap !== true ||
    retention.new_volume_or_paid_retained_resource_authorized !== false ||
    retention.volume_resize_move_or_replacement_authorized !== false ||
    retention.recurring_plan_change_authorized !== false
  )
    fail("RETENTION");
  if (
    approved.provider_free_control_plane?.github_publication_expected_runpod_spend_usd !== 0 ||
    approved.provider_free_control_plane?.database_activation_expected_runpod_spend_usd !== 0 ||
    approved.provider_free_control_plane?.cloudflare_activation_expected_runpod_spend_usd !== 0 ||
    approved.provider_free_control_plane?.guarded_child_gpu_use_authorized !== false ||
    approved.provider_free_control_plane
      ?.guarded_child_maximum_cumulative_finite_external_spend_usd !== 0 ||
    approved.provider_free_control_plane?.new_r2_bucket_authorized !== false ||
    approved.provider_free_control_plane?.new_paid_retained_resource_authorized !== false ||
    approved.provider_free_control_plane?.other_resource_creation_authorized !== false ||
    approved.provider_free_control_plane?.plan_change_authorized !== false ||
    approved.provider_free_control_plane?.exact_disabled_quarantine_creation_authorized !== true ||
    approved.provider_free_control_plane?.stop_on_metered_plan_or_new_paid_resource !== true
  )
    fail("GUARDED_CHILD_SCOPE");
  if (isV3) {
    const requestedRef = proposal.immutable_github_release_ref_request;
    const approvedRef = approved.immutable_github_release_ref;
    const requestedDatabase = proposal.requested_scope?.database;
    const approvedDatabase = approved.database_roles;
    if (
      !exactKeys(approvedRef, [
        "creation_authorized",
        "exact_tag_name",
        "exact_target_commit",
        "tag_kind",
        "maximum_new_refs",
        "force_update_authorized",
        "delete_or_retarget_authorized",
        "other_ref_creation_authorized",
      ]) ||
      !exactKeys(approvedDatabase, [
        "exact_runtime_role",
        "exact_reconciler_role",
        "roles_must_be_fresh_absent_distinct_login_noinherit_hardened",
      ])
    )
      fail("V3_NESTED_SCHEMA");
    if (
      requestedRef?.exact_tag_name !== "videoforge-v2-13-release-407dc070" ||
      requestedRef.exact_target_commit !== expectedReleaseSourceCommit ||
      requestedRef.tag_kind !== "LIGHTWEIGHT" ||
      requestedRef.maximum_new_refs !== 1 ||
      requestedRef.force_update_authorized !== false ||
      requestedRef.delete_or_retarget_authorized !== false ||
      requestedRef.other_ref_creation_authorized !== false ||
      approvedRef?.creation_authorized !== true ||
      approvedRef.exact_tag_name !== requestedRef.exact_tag_name ||
      approvedRef.exact_target_commit !== requestedRef.exact_target_commit ||
      approvedRef.tag_kind !== "LIGHTWEIGHT" ||
      approvedRef.maximum_new_refs !== 1 ||
      approvedRef.force_update_authorized !== false ||
      approvedRef.delete_or_retarget_authorized !== false ||
      approvedRef.other_ref_creation_authorized !== false
    )
      fail("IMMUTABLE_RELEASE_REF");
    if (
      requestedDatabase?.exact_runtime_role !== "videoforge_hosted_runtime" ||
      requestedDatabase.exact_reconciler_role !== "videoforge_hosted_reconciler" ||
      requestedDatabase.roles_must_be_fresh_absent_distinct_login_noinherit_hardened !== true ||
      approvedDatabase?.exact_runtime_role !== requestedDatabase.exact_runtime_role ||
      approvedDatabase.exact_reconciler_role !== requestedDatabase.exact_reconciler_role ||
      approvedDatabase.roles_must_be_fresh_absent_distinct_login_noinherit_hardened !== true
    )
      fail("DATABASE_ROLES");
  }
  if (Object.values(approval.execution_fences).some((value) => value !== true))
    fail("EXECUTION_FENCES");
  if (
    typeof approval.statement !== "string" ||
    !approval.statement.includes(expectedProposalSha256) ||
    !approval.statement.includes(expectedProposalRecordCommit) ||
    !approval.statement.includes("USD 17.50") ||
    !approval.statement.includes("USD 7 per month") ||
    !approval.statement.includes("no fallback") ||
    (isV3 &&
      (!approval.statement.includes("videoforge-v2-13-release-407dc070") ||
        !approval.statement.includes("videoforge_hosted_runtime") ||
        !approval.statement.includes("videoforge_hosted_reconciler")))
  )
    fail("STATEMENT");
  return Object.freeze({
    authorityId: approval.authority_id,
    approvedAt: approval.approved_at,
    expiresAt: approval.expires_at,
    proposalSha256: expectedProposalSha256,
    approvalSha256: sha256(approvalBytes),
    proposalRecordCommit: expectedProposalRecordCommit,
    releaseSourceCommit: expectedReleaseSourceCommit,
    maximumCumulativeFiniteRunpodSpendUsd: 17.5,
    phaseCapsUsd: EXPECTED_PHASE_CAPS,
    proposalSchema: proposal.schema_version,
    exactRuntimeRole: isV3 ? approved.database_roles.exact_runtime_role : null,
    exactReconcilerRole: isV3 ? approved.database_roles.exact_reconciler_role : null,
  });
}

export { EXPECTED_PHASE_CAPS, validateFullLiveUserApproval };

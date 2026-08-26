import { createHash } from "node:crypto";

const AUTHORITY_ID = /^v2-13-[a-z0-9][a-z0-9._-]{7,95}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const HASH = /^sha256:[0-9a-f]{64}$/u;
const PROPOSAL_SCHEMA_V2 = "videoforge.v2-13-full-live-completion-proposal/v2";
const PROPOSAL_SCHEMA_V3 = "videoforge.v2-13-full-live-completion-proposal/v3";
const APPROVAL_SCHEMA_V1 = "videoforge.v2-13-full-live-user-approval/v1";
const APPROVAL_SCHEMA_V2 = "videoforge.v2-13-full-live-user-approval/v2";
const EXACT_V3_RELEASE_COMPONENTS = Object.freeze({
  full_live_executor: Object.freeze({
    path: "deploy/v2-13/full-live-executor.mjs",
    sha256: "sha256:2b782863fef0222527a10fcd1d4bb1c8bacfc58d601ebd764e1919968d781830",
    sole_canonical_live_mutation_path: true,
  }),
  full_live_adapters: Object.freeze({
    path: "deploy/v2-13/full-live-adapters.mjs",
    sha256: "sha256:2d59c91bfcfd57e9b2f2ecfcdce2e85e4f288fe2dc63aedf7adcd86b14f10dea",
  }),
  promotion: Object.freeze({
    path: "deploy/v2-13/promote-qualified-production.mjs",
    sha256: "sha256:efaf573c00109cc52ecedd617bebe48d03747d467f3ffc481fd6d2cb0d95ce66",
  }),
  guarded_activation: Object.freeze({
    path: "deploy/v2-13/guarded-activation.mjs",
    sha256: "sha256:8946676cae1ab8c414880e2d093fc8bbc957d97af6ee0f6a30ee052aea9bf8d0",
  }),
  orchestration_authority: Object.freeze({
    path: "deploy/v2-13/full-live-orchestration-authority.mjs",
    sha256: "sha256:be1bbca1d933cd555baa768d13a9ebf33cd75be4c4214df79e09cbe7e505b241",
  }),
  typescript_cli_bridge: Object.freeze({
    path: "apps/web/src/server/providers/v213-full-live-cli.ts",
    sha256: "sha256:ec6c459294769a04d3126e37d4e2d94be1578095a2ec11bfd9221fc02a6f8123",
  }),
  runpod_dual_lane_transport: Object.freeze({
    path: "apps/web/src/server/providers/v213-runpod-dual-lane-transport.ts",
    sha256: "sha256:7d2ac27d25f6906aae1147833618e4a471ef0ca72f7ea6159ea993444ae53fe6",
  }),
  migration_0045: Object.freeze({
    path: "packages/control-plane/migrations/0045_hosted_full_live_activation.sql",
    sha256: "sha256:fdb9c122c87603ff5f204a055eab902d41f362fec3be58d83be4ec088208b34d",
  }),
  approval_validator: Object.freeze({
    path: "deploy/v2-13/validate-full-live-approval.mjs",
    sha256: "sha256:b6ddaeda44f5d0921e6fb7b55549df0c603f57ab356327f7dfd06ec1ab0009e5",
  }),
});
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
const EXACT_CLOUDFLARE_SECRET_NAMES = Object.freeze([
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "WORKFLOW_CALLBACK_SECRET",
  "MEDIA_WORKER_TOKEN_SECRET",
  "VIDEOFORGE_RECONCILER_DATABASE_URL",
  "VIDEOFORGE_DISPATCH_TOKEN_KEY",
  "VIDEOFORGE_DISPATCH_TOKEN_KEY_ID",
  "VIDEOFORGE_ENVELOPE_SIGNING_KEY_HEX",
  "VIDEOFORGE_ENVELOPE_SIGNING_KEY_ID",
  "VIDEOFORGE_PROVIDER_PROOF_VERIFY_KEY",
  "VIDEOFORGE_PROVIDER_PROOF_KEY_ID",
  "RUNPOD_API_KEY",
  "RUNPOD_API_BASE_URL",
  "VIDEOFORGE_MAGE_ENDPOINT_ID",
  "VIDEOFORGE_MAGE_ENDPOINT_ID_SHA256",
  "VIDEOFORGE_SOULX_ENDPOINT_ID",
  "VIDEOFORGE_SOULX_ENDPOINT_ID_SHA256",
  "VIDEOFORGE_V213_WORKFLOW_OPERATOR_TOKEN",
]);
const EXACT_IMAGE_WORKFLOW_VERIFICATION_POLICY = Object.freeze({
  bind_only_previously_captured_run_id: true,
  maximum_reads: 180,
  poll_interval_ms: 10_000,
  wall_timeout_ms: 1_800_000,
  deadline_clock: "MONOTONIC",
  deadline_starts_before_first_cancellation_or_trusted_time_check: true,
  deadline_covers_trusted_time_subprocess_poll_subprocess_wait_download_and_evidence_validation: true,
  every_subprocess_timeout_is_positive_remaining_deadline_ms: true,
  trusted_time_subprocess_timeout_ms: 12_000,
  gh_subprocess_timeout_ms_or_remaining_if_less: 60_000,
  remaining_time_checked_before_and_after_every_await_or_spawn: true,
  every_wait_is_capped_to_positive_remaining_deadline_ms: true,
  no_positive_remaining_time_is_immediate_timeout: true,
  pollable_statuses: Object.freeze(["queued", "in_progress"]),
  accepted_terminal_status: "completed",
  accepted_conclusion: "success",
  immediate_stop_on_completed_non_success: true,
  immediate_stop_on_identity_drift: true,
  immediate_stop_on_authority_expiry: true,
  immediate_stop_on_injected_cancellation: true,
  verifier_dispatch_authorized: false,
  redispatch_authorized: false,
  timeout_transition: "OUTER_CLEANUP_ONLY_NO_RETRY",
});
const EXACT_INTERNAL_MATERIALIZATION_POLICY = Object.freeze({
  writer: "FULL_LIVE_EXECUTOR_INTERNAL_ONLY",
  external_mid_run_writer_authorized: false,
  future_result_files_required_at_initial_preflight: false,
  protected_seed_schema: "videoforge.v213-full-live-materialization-seed/v1",
  protected_seed_contains_only: Object.freeze([
    "outer-production-base",
    "pre-endpoint-secrets-base",
    "guarded-authority-base",
    "config-activation-base",
    "media-manifest",
    "promotion-base",
  ]),
  protected_seed_future_output_hashes_authorized: false,
  initial_production_secrets_schema: "videoforge.v213-full-live-pre-endpoint-secrets/v1",
  initial_seed_endpoint_identity_fields_present: false,
  initial_seed_forbidden_endpoint_identity_fields: Object.freeze([
    "mageEndpointId",
    "mageEndpointIdSha256",
    "soulxEndpointId",
    "soulxEndpointIdSha256",
  ]),
  guarded_endpoint_secret_file_names: Object.freeze([
    "VIDEOFORGE_MAGE_ENDPOINT_ID",
    "VIDEOFORGE_MAGE_ENDPOINT_ID_SHA256",
    "VIDEOFORGE_SOULX_ENDPOINT_ID",
    "VIDEOFORGE_SOULX_ENDPOINT_ID_SHA256",
  ]),
  seed_recursively_rejects_endpoint_identity_key_case_variants: true,
  production_input_base_lane_fields_must_be_absent_or_null_before_receipt_derivation: Object.freeze(
    ["publicImage", "deploymentSha256", "sourceCommit"],
  ),
  command_payloads_recursively_forbid_endpoint_or_deployment_snapshot_selectors: true,
  future_output_hash_or_identity_anywhere_in_seed_is_hard_stop: true,
  final_production_secrets_schema: "videoforge.v213-full-live-production-secrets/v1",
  cleanup_pre_endpoint_runtime: Object.freeze({
    schema: "videoforge.v213-full-live-cleanup-input/v1",
    exact_fields: Object.freeze([
      "schemaVersion",
      "fullLiveAuthorityId",
      "billingBaselineMode",
      "billingBaselineUsd",
      "totalCapUsd",
      "retainedLanes",
    ]),
    retained_lane_exact_fields: Object.freeze(["lane", "volumeIdSha256", "volumeManifestSha256"]),
    billing_baseline_modes: Object.freeze([
      "PRIOR_FRESH_PREFLIGHT",
      "ESTABLISH_CURRENT_NO_RUNPOD_MUTATION",
    ]),
    null_billing_baseline_allowed_only_for_establish_current_mode_with_no_prior_fresh_preflight_or_runpod_mutation_receipt: true,
    establish_current_mode_first_authenticated_current_read_is_baseline_then_bounded_final_read_with_no_intervening_provider_mutation: true,
    exact_child_fd_environment: Object.freeze([
      "REQUEST_FD",
      "RUNPOD_API_KEY_FD",
      "OPERATOR_DATABASE_URL_FD",
    ]),
    forbidden_inputs: Object.freeze([
      "exactProductionInput",
      "runtime-database-url",
      "reconciler-database-url",
      "worker-origin",
      "worker-token",
      "production-secrets-fd",
      "endpoint-ids-or-hashes",
      "receipt-or-signing-keys",
      "key-registration",
    ]),
    accepted_for_normal_guarded_or_acceptance_work: false,
  }),
  storage_parent: "OUTER_STATE_MODE_0700_DIRECTORY",
  record_file_mode: "0600",
  exclusive_create_or_exact_hash_cas_required: true,
  canonical_json_required: true,
  hash_chain_required: true,
  chain_binds_previous_outer_state_sha256_and_ordered_prior_result_sha256s: true,
  materialization_chain_committed_before_consumer_operation: true,
  chain_record_exact_fields: Object.freeze([
    "kind",
    "authority_id",
    "prior_chain_sha256",
    "outer_state_sha256",
    "ordered_prior_operation_evidence_sha256s",
    "ordered_output_sha256s",
    "entry_sha256",
  ]),
  entry_sha256_is_hash_of_preceding_six_fields: true,
  validate_each_output_immediately_at_first_use: true,
  records: Object.freeze([
    Object.freeze({
      kind: "production-input",
      materialize_after_operations: Object.freeze([
        "mage-image-workflow-verification",
        "soulx-image-workflow-verification",
      ]),
      consume_before_operation: "fresh-live-preflight",
      writes: Object.freeze(["production-input"]),
    }),
    Object.freeze({
      kind: "max-one-endpoint-bindings",
      materialize_after_operations: Object.freeze(["create-exact-max-one-endpoints"]),
      derives_only_from: "receipt.materialization.production",
      consume_before_materialization: "activation-record",
      writes: Object.freeze([
        "production-secrets",
        "VIDEOFORGE_MAGE_ENDPOINT_ID",
        "VIDEOFORGE_MAGE_ENDPOINT_ID_SHA256",
        "VIDEOFORGE_SOULX_ENDPOINT_ID",
        "VIDEOFORGE_SOULX_ENDPOINT_ID_SHA256",
        "mage-deployment-snapshot",
        "soulx-deployment-snapshot",
      ]),
      rebinds_all_guarded_secret_sha256_entries: 22,
      ordered_output_names: Object.freeze([
        "production_secrets_sha256",
        "mage_deployment_snapshot_sha256",
        "soulx_deployment_snapshot_sha256",
        "mage_endpoint_secret_sha256",
        "mage_endpoint_hash_secret_sha256",
        "soulx_endpoint_secret_sha256",
        "soulx_endpoint_hash_secret_sha256",
      ]),
    }),
    Object.freeze({
      kind: "activation-record",
      materialize_after_operations: Object.freeze([
        "mage-live-qualification",
        "soulx-live-qualification",
        "create-exact-max-one-endpoints",
      ]),
      consume_before_operation: "guarded-activation-once",
      requires_prior_materialization_kinds: Object.freeze(["max-one-endpoint-bindings"]),
      writes: Object.freeze([
        "media-manifest",
        "config-activation-record",
        "disabled-config",
        "activation-record",
      ]),
    }),
    Object.freeze({
      kind: "promotion-record",
      materialize_after_operations: Object.freeze([
        "mage-live-qualification",
        "soulx-live-qualification",
        "create-exact-max-one-endpoints",
        "guarded-activation-once",
      ]),
      consume_before_operation: "promote-qualified-production",
      writes: Object.freeze(["promotion-record"]),
    }),
    Object.freeze({
      kind: "cleanup-pre-endpoint-descriptor",
      cleanup_only: true,
      materialize_after_operations: Object.freeze([]),
      consume_before_operations: Object.freeze([
        "restore-endpoints-max-one",
        "prove-zero-workers",
        "read-settled-billing",
        "reconcile-exact-resources",
      ]),
      ordered_output_names: Object.freeze(["cleanup_input_sha256", "pre_endpoint_secrets_sha256"]),
      accepted_for_normal_or_acceptance_work: false,
    }),
  ]),
  missing_prior_result_receipt_path_mode_hash_chain_or_replay_is_hard_stop: true,
});
const EXACT_TRUSTED_TIME_POLICY = Object.freeze({
  credential_free_command:
    "curl --disable --silent --show-error --head --proto =https --tlsv1.2 --connect-timeout 5 --max-time 10 https://api.github.com/rate_limit",
  curl_disable_is_first_argument: true,
  exact_url: "https://api.github.com/rate_limit",
  request_method: "HEAD",
  transport_authentication: "SYSTEM_CA_VERIFIED_HTTPS_TLS_MINIMUM_1_2",
  credential_environment_or_authorization_header_allowed: false,
  ambient_gh_configuration_used: false,
  subprocess_environment_exact: Object.freeze({
    PATH: "INHERITED_ONLY_PATH",
    NO_PROXY: "*",
    no_proxy: "*",
  }),
  proxy_environment_allowed: false,
  curl_default_config_allowed: false,
  subprocess_timeout_ms: 12_000,
  required_date_header_count: 1,
  date_header_match: "CASE_INSENSITIVE_^date:",
  date_parse_valid_required: true,
  caller_supplied_trusted_time_forbidden: true,
  reread_before_every_non_cleanup_operation: true,
  check_before_local_reservation_or_phase_mutation: true,
  valid_interval: "approved_at<=trusted_time<=expires_at",
  invalid_or_expired_transition: "OUTER_CLEANUP_ONLY_NO_RETRY",
  cleanup_after_expiry_authorized_only_for: Object.freeze([
    "drain",
    "restore_max_one",
    "prove_zero_workers",
    "read_settled_billing",
    "reconcile_exact_resources",
  ]),
  normal_or_paid_operation_resume_after_expiry: false,
});
const EXACT_OPERATION_IDS = Object.freeze([
  "release-tag-create",
  "release-tag-push",
  "release-tag-readback",
  "approval-commit-push",
  "mage-image-workflow-dispatch",
  "mage-image-workflow-verification",
  "soulx-image-workflow-dispatch",
  "soulx-image-workflow-verification",
  "fresh-live-preflight",
  "mage-live-qualification",
  "soulx-live-qualification",
  "create-exact-max-one-endpoints",
  "guarded-activation-once",
  "promote-qualified-production",
  "v2-09-short-hosted-project",
  "v2-10-operator-free-ranga-pilot",
  "v2-11-two-concurrent-owned-projects",
  "v2-12-long-output",
  "v2-13-final-two-lane-smoke",
  "restore-endpoints-max-one",
  "prove-zero-workers",
  "read-settled-billing",
  "reconcile-exact-resources",
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
    (proposal.sealing?.sealed_for_exact_user_approval !== true ||
      proposal.sealing?.current_bytes_are_approval_ineligible !== false ||
      proposal.supersession?.prior_approval_reusable !== false ||
      proposal.supersession?.fresh_exact_approval_required !== true ||
      proposal.authority_record_commit_binding?.strategy !==
        "EXTERNAL_GIT_COMMIT_INPUT_VERIFIED_BEFORE_CONSUMPTION_NO_SELF_HASH" ||
      proposal.authority_record_commit_binding?.proposal_record_commit_is_distinct !== true ||
      proposal.authority_record_commit_binding
        ?.authority_record_commit_must_contain_exact_approval_and_authority_bytes !== true ||
      proposal.authority_record_commit_binding?.remote_readback_required !== true ||
      proposal.authority_record_commit_binding?.embedded_self_commit_hash_forbidden !== true ||
      proposal.authority?.exact_proposal_approved !== false ||
      proposal.authority?.execute_authorized !== false ||
      proposal.authority?.immutable_release_ref_creation_authorized !== false ||
      JSON.stringify(proposal.exact_execution_graph?.ordered_operation_ids) !==
        JSON.stringify(EXACT_OPERATION_IDS) ||
      proposal.exact_execution_graph?.operation_order_is_closed_and_non_reorderable !== true ||
      proposal.exact_execution_graph?.missing_extra_or_repeated_operation_is_a_hard_stop !== true ||
      JSON.stringify(proposal.exact_execution_graph?.image_workflow_verification_policy) !==
        JSON.stringify(EXACT_IMAGE_WORKFLOW_VERIFICATION_POLICY) ||
      JSON.stringify(proposal.exact_execution_graph?.internal_materialization_policy) !==
        JSON.stringify(EXACT_INTERNAL_MATERIALIZATION_POLICY) ||
      JSON.stringify(proposal.exact_execution_graph?.trusted_time_policy) !==
        JSON.stringify(EXACT_TRUSTED_TIME_POLICY) ||
      proposal.requested_scope?.cloudflare_secret_allowlist_count !==
        EXACT_CLOUDFLARE_SECRET_NAMES.length ||
      JSON.stringify(proposal.requested_scope?.cloudflare_secret_allowlist) !==
        JSON.stringify(EXACT_CLOUDFLARE_SECRET_NAMES) ||
      JSON.stringify(proposal.source?.exact_release_components) !==
        JSON.stringify(EXACT_V3_RELEASE_COMPONENTS))
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
      requestedRef?.exact_tag_name !== "videoforge-v2-13-release-20260826-v3" ||
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
      JSON.stringify(requestedDatabase.exact_migrations_to_apply) !==
        JSON.stringify([37, 38, 39, 40, 41, 42, 43, 44, 45]) ||
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
      (!approval.statement.includes("videoforge-v2-13-release-20260826-v3") ||
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

export {
  EXACT_CLOUDFLARE_SECRET_NAMES,
  EXACT_IMAGE_WORKFLOW_VERIFICATION_POLICY,
  EXACT_INTERNAL_MATERIALIZATION_POLICY,
  EXACT_TRUSTED_TIME_POLICY,
  EXPECTED_PHASE_CAPS,
  validateFullLiveUserApproval,
};

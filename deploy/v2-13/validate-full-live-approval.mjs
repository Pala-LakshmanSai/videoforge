import { createHash } from "node:crypto";

const AUTHORITY_ID = /^v2-13-[a-z0-9][a-z0-9._-]{7,95}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const HASH = /^sha256:[0-9a-f]{64}$/u;
const PROPOSAL_SCHEMA_V2 = "videoforge.v2-13-full-live-completion-proposal/v2";
const PROPOSAL_SCHEMA_V3 = "videoforge.v2-13-full-live-completion-proposal/v3";
const APPROVAL_SCHEMA_V1 = "videoforge.v2-13-full-live-user-approval/v1";
const APPROVAL_SCHEMA_V2 = "videoforge.v2-13-full-live-user-approval/v2";
const EXPECTED_SERVERLESS_FLEX_RATE_SOURCE = Object.freeze({
  provider: "RunPod",
  product: "SERVERLESS_FLEX",
  gpu: "NVIDIA GeForce RTX 4090",
  region: "EU-RO-1",
  billing_unit: "USD_PER_GPU_SECOND",
  rate_usd_per_second: 0.00031,
  rate_usd_per_gpu_hour: 1.116,
  source: "OFFICIAL_CURRENT_RUNPOD_SERVERLESS_FLEX_PRICING_SNAPSHOT",
});
const EXPECTED_SERVERLESS_FLEX_RATE_USD_PER_GPU_HOUR =
  EXPECTED_SERVERLESS_FLEX_RATE_SOURCE.rate_usd_per_gpu_hour;
// The validator is part of the proposal/authority verifier, so embedding the hash of this
// source file inside itself would require an impossible fixed point.  Bind it to the exact
// release commit's tree instead; the outer authority verifier reads that commit/path and hashes
// the tree entry before consuming authority.
const EXACT_APPROVAL_VALIDATOR_SOURCE_BINDING = Object.freeze({
  mode: "EXTERNAL_GIT_COMMIT_TREE_ENTRY",
  commit_field: "source.release_source_commit",
  tree_entry_path: "deploy/v2-13/validate-full-live-approval.mjs",
  verification: "GIT_SHOW_EXACT_COMMIT_PATH_THEN_SHA256",
  embedded_current_file_sha256: false,
  self_hash_forbidden: true,
});
const EXACT_V3_RELEASE_COMPONENTS = Object.freeze({
  full_live_executor: Object.freeze({
    path: "deploy/v2-13/full-live-executor.mjs",
    sha256: "sha256:4a4e328630aa1e8e863b99ca4b56528b0068dacf1ae4f77df2974acc89f469f5",
    sole_canonical_live_mutation_path: true,
  }),
  full_live_adapters: Object.freeze({
    path: "deploy/v2-13/full-live-adapters.mjs",
    sha256: "sha256:0a2b929507609d0709cb0262b757e537576c3b9af192681548fd78a357ac5437",
  }),
  promotion: Object.freeze({
    path: "deploy/v2-13/promote-qualified-production.mjs",
    sha256: "sha256:4151184dfa56dd687db22fbff378aed438f15d9fab2030b893b704ca7b67b6e0",
  }),
  guarded_activation: Object.freeze({
    path: "deploy/v2-13/guarded-activation.mjs",
    sha256: "sha256:1fc2d4b4b5246c6e0a6f407f7742f78acdca66723c60d2a0c1499e692a5162f7",
  }),
  orchestration_authority: Object.freeze({
    path: "deploy/v2-13/full-live-orchestration-authority.mjs",
    sha256: "sha256:fde2b699086d6a6c104a4fdc43a8e917b1cf94b1c830adc2868b6a12207742d6",
  }),
  typescript_cli_bridge: Object.freeze({
    path: "apps/web/src/server/providers/v213-full-live-cli.ts",
    sha256: "sha256:e9d369710ca75535b35b6c29123b595482fbddbd792b35e02ed40eb7ea6c28e6",
  }),
  runpod_dual_lane_transport: Object.freeze({
    path: "apps/web/src/server/providers/v213-runpod-dual-lane-transport.ts",
    sha256: "sha256:7d2ac27d25f6906aae1147833618e4a471ef0ca72f7ea6159ea993444ae53fe6",
  }),
  migration_0045: Object.freeze({
    path: "packages/control-plane/migrations/0045_hosted_full_live_activation.sql",
    sha256: "sha256:fdb9c122c87603ff5f204a055eab902d41f362fec3be58d83be4ec088208b34d",
  }),
  operator_grants: Object.freeze({
    path: "deploy/v2-13/neon-full-live-operator-grants.sql",
    sha256: "sha256:60922d36e5aeb05fe34705198967aa3adf20cdf9ec61283810a565b6690b2c39",
  }),
  migration_manifest: Object.freeze({
    path: "packages/control-plane/migrations/manifest.json",
    sha256: "sha256:93e793e66f8307681d494e9834debbc0458fd9ba04b55497be2b868fa2011baa",
  }),
  approval_validator: Object.freeze({
    path: "deploy/v2-13/validate-full-live-approval.mjs",
    source_commit_tree_binding: EXACT_APPROVAL_VALIDATOR_SOURCE_BINDING,
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
  materialization_seed_sha256_field: "materialization_seed_sha256",
  materialization_seed_sha256_must_be_bound_in_outer_authority: true,
  materialization_seed_sha256_must_be_bound_in_consumption_record: true,
  materialization_seed_sha256_verified_at_outer_consumption: true,
  materialization_seed_sha256_verified_before_every_seed_read: true,
  materialization_seed_sha256_verified_after_restart_or_recovery: true,
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
  chain_verifier_required_in_production_entrypoint: true,
  chain_verifier_function: "verifyMaterializationChainFile",
  chain_verifier_boundaries: Object.freeze(["hydrated", "settled"]),
  missing_chain_verifier_is_hard_stop_before_external_action: true,
  chain_stage_order: Object.freeze([
    "production-input",
    "max-one-endpoint-bindings",
    "activation-record",
    "promotion-record",
    "cleanup-pre-endpoint-descriptor",
  ]),
  early_cleanup_missing_chain_file_allowed_only_before_operator_verification: true,
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
const EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY = Object.freeze({
  operation_id: "bootstrap-prequalification-database",
  phase: "bootstrap_prequalification_database",
  phase_cap_usd: 0,
  result_schema: "videoforge.v213-prequalification-database-bootstrap-result/v1",
  ordered_before_operation: "fresh-live-preflight",
  exact_operator_role: "videoforge_hosted_operator",
  runtime_and_reconciler_roles_must_remain_absent: true,
  exact_initial_ledger_prefix_count: 36,
  exact_recoverable_prefix_counts: Object.freeze([37, 38, 39, 40, 41, 42, 43, 44, 45]),
  reject_ledger_drift_or_count_above_45: true,
  pgcrypto_then_exact_migrations: Object.freeze([37, 38, 39, 40, 41, 42, 43, 44, 45]),
  each_migration_requires_advisory_lock_and_single_transaction: true,
  owner_connection_uses_only_protected_pg_service_and_pgpass: true,
  operator_role_created_or_recovered_from_protected_operator_dsn_only_after_migrations: true,
  operator_role_contract: "LOGIN_NOINHERIT_HARDENED_NO_MEMBERSHIPS_OWNERSHIP_OR_TABLE_ACL",
  grants: "EXACT_OPERATOR_FUNCTION_ONLY",
  exact_readback: Object.freeze([
    "45-row-ledger",
    "pgcrypto",
    "operator-role-flags",
    "no-role-memberships",
    "no-object-ownership",
    "no-table-acl",
    "exact-operator-function-acl",
  ]),
  exact_operator_function_signature_count: 17,
  exact_operator_function_signature_namespace: "public",
  exact_operator_function_signature_canonicalization:
    "FUNCTION_NAME_PLUS_FORMAT_TYPE_IDENTITY_ARGUMENTS_WITH_TIMESTAMPTZ_NORMALIZATION",
  exact_operator_function_acl_comparison: "OID_SET_SORTED_EXACT_ALLOWLIST",
  exact_operator_function_acl_must_have_no_duplicates: true,
  public_function_execute_readback_count: 0,
  public_default_function_execute_readback_count: 0,
  ownership_catalogs: Object.freeze([
    "pg_database.datdba",
    "pg_extension.extowner",
    "pg_class.relowner",
    "pg_namespace.nspowner",
    "pg_proc.proowner",
    "pg_type.typowner",
    "pg_foreign_data_wrapper.fdwowner",
    "pg_foreign_server.srvowner",
    "pg_event_trigger.evtowner",
    "pg_tablespace.spcowner",
    "pg_publication.pubowner",
    "pg_subscription.subowner",
    "pg_largeobject_metadata.lomowner",
    "pg_collation.collowner",
    "pg_ts_dict.dictowner",
    "pg_ts_config.cfgowner",
  ]),
  ownership_readback_is_cluster_wide: true,
  receipt_exact_fields: Object.freeze([
    "schema_version",
    "ledger_before_count",
    "ledger_before_sha256",
    "ledger_after_sha256",
    "operator_acl_sha256",
    "pgcrypto_sha256",
    "recovery_mode",
    "runpod_calls",
    "cloudflare_calls",
    "application_secret_reads",
  ]),
  receipt_full_exact_fields: Object.freeze([
    "schema_version",
    "ledger_before_count",
    "ledger_before_sha256",
    "ledger_after_sha256",
    "operator_acl_sha256",
    "pgcrypto_sha256",
    "recovery_mode",
    "runpod_calls",
    "cloudflare_calls",
    "application_secret_reads",
    "prequalification_database_bootstrap_sha256",
  ]),
  receipt_path: "prequalification-database-bootstrap.json",
  receipt_hash_field: "prequalification_database_bootstrap_sha256",
  receipt_hash_is_sha256_of_canonical_body: true,
  receipt_file_mode: "0600",
  receipt_parent_directory_mode: "0700",
  receipt_secret_free: true,
  receipt_replay_requires_exact_all_fields: true,
  receipt_final_ledger_count: 45,
  receipt_recovery_mode_count_binding: Object.freeze({
    FRESH_36_TO_45: 36,
    RESUME_EXACT_PREFIX: Object.freeze([37, 38, 39, 40, 41, 42, 43, 44]),
    VERIFIED_EXISTING_45: 45,
  }),
  receipt_replay_cas_required: true,
  operator_grants_sql_path: "deploy/v2-13/neon-full-live-operator-grants.sql",
  operator_grants_sql_revoke_all_functions_before_allowlist: true,
  operator_grants_sql_revoke_public_execute: true,
  public_execute_readback_must_be_empty: true,
  exact_operator_acl_order: "LEXICAL_CANONICAL_SIGNATURE",
  operator_role_flags: Object.freeze({
    rolcanlogin: true,
    rolsuper: false,
    rolcreaterole: false,
    rolcreatedb: false,
    rolinherit: false,
    rolreplication: false,
    rolbypassrls: false,
    rolconfig: null,
  }),
  operator_acl_scope: Object.freeze({
    schema_usage_only: true,
    schema_create: false,
    database_acl: 0,
    table_acl: 0,
    sequence_acl: 0,
    default_acl: 0,
    ownership: 0,
    memberships: 0,
    public_function_acl: 0,
    public_default_function_acl: 0,
  }),
  owner_dsn_policy: Object.freeze({
    protected_input_directory_env: "VIDEOFORGE_V2_13_POSTGRES_INPUT_DIR",
    service_file: "owner.pg_service.conf",
    pass_file: "owner.pgpass",
    service_name: "videoforge_v2_13_owner",
    owner_only_for_migrations_and_readback: true,
    credentials_never_in_argv_or_logs: true,
  }),
  operator_dsn_policy: Object.freeze({
    file: "operator.database-url",
    exact_role: "videoforge_hosted_operator",
    accepted_protocols: Object.freeze(["postgres:", "postgresql:"]),
    sslmode: "require",
    channel_binding: "require",
    host_and_database_match_owner_service: true,
    only_after_migrations: true,
    metadata_read_before_migrations_allowed: true,
    value_read_after_migration_prefix_commit_count: 45,
    value_read_forbidden_before_migration_prefix_commit: true,
    used_for_role_creation_or_recovery_only_after_migrations: true,
    password_never_in_argv_or_logs: true,
  }),
  operator_verification_transition: Object.freeze({
    state_field: "operator_role_verified",
    initial_value: false,
    set_true_only_after:
      "SETTLED_TERMINAL_BOOTSTRAP_RESULT_AND_EXACT_RECEIPT_LEDGER45_OPERATOR_ACL_READBACK",
    restart_source: "SETTLED_TERMINAL_BOOTSTRAP_RESULT_ONLY",
    role_presence_or_preflight_is_not_sufficient: true,
    monotonic: true,
    required_before_normal_operator_dsn_cleanup: true,
  }),
  exact_operator_function_signatures: Object.freeze([
    "videoforge_load_v213_bridge_acceptance_call(jsonb)",
    "videoforge_record_v213_stage_authority(uuid,jsonb)",
    "videoforge_record_hosted_full_live_authority(uuid,jsonb)",
    "videoforge_promote_hosted_full_live(uuid,uuid,jsonb)",
    "videoforge_record_v213_cloudflare_activation(uuid,jsonb)",
    "videoforge_record_v213_cloudflare_rollback(uuid,jsonb)",
    "videoforge_claim_v213_stage_authority(jsonb)",
    "videoforge_complete_v213_stage_authority(text,text,jsonb)",
    "videoforge_load_v213_stage_handoff(uuid,text,text)",
    "videoforge_load_v213_cleanup_scope(uuid)",
    "videoforge_claim_v213_operation(jsonb)",
    "videoforge_transition_v213_operation(jsonb)",
    "videoforge_claim_v213_bridge_command(jsonb)",
    "videoforge_transition_v213_bridge_command(jsonb)",
    "videoforge_record_v213_receipt_verification_key(text,text)",
    "videoforge_publish_v213_qualified_deployments(jsonb)",
    "videoforge_record_v213_workflow_start_authority(uuid,uuid,text,timestamptz)",
  ]),
  recovery_modes: Object.freeze(["FRESH_36_TO_45", "RESUME_EXACT_PREFIX", "VERIFIED_EXISTING_45"]),
  recovery_mode_ledger_before_count: Object.freeze({
    FRESH_36_TO_45: 36,
    RESUME_EXACT_PREFIX: Object.freeze([37, 38, 39, 40, 41, 42, 43, 44]),
    VERIFIED_EXISTING_45: 45,
  }),
  recovery_mode_final_ledger_count: 45,
  output_name: "prequalification_database_bootstrap_sha256",
  runpod_calls: 0,
  cloudflare_calls: 0,
  application_secret_reads: 0,
  gpu_use: false,
  external_spend_usd: 0,
  failure_recovery:
    "CURRENT_MIGRATION_TRANSACTION_ROLLBACK_THEN_IDEMPOTENT_EXACT_PREFIX_RESUME_BEFORE_RUNPOD_NO_DESTRUCTIVE_RESTORE_OR_GUESSING",
  guarded_activation_consumes_verified_receipt: true,
  guarded_activation_receipt_verified_before_application_secret_reads: true,
  guarded_activation_receipt_verified_before_cloudflare_or_runtime_secret_reads: true,
  guarded_activation_creates_only_runtime_and_reconciler_roles_and_grants: true,
  guarded_activation_reapplies_migrations_or_operator_role: false,
  guarded_activation_requires_prefix_36: false,
  post_bootstrap_receipt_verifier: Object.freeze({
    function: "verifyPrequalificationDatabaseReceipt",
    adapter_wrapper: "createConcreteFullLiveAdapters",
    default_verifier_binding:
      "options.prequalificationVerifier.verify ?? verifyPrequalificationDatabaseReceipt",
    owner_only: true,
    protected_input_directory_env: "VIDEOFORGE_V2_13_POSTGRES_INPUT_DIR",
    owner_service_file: "owner.pg_service.conf",
    owner_pass_file: "owner.pgpass",
    owner_service_name: "videoforge_v2_13_owner",
    receipt_path_resolver: "prequalificationPath",
    prior_result_operation_id: "bootstrap-prequalification-database",
    prior_result_hash_field: "prequalification_database_bootstrap_sha256",
    receipt_hash_field: "prequalification_database_bootstrap_sha256",
    exact_prior_result_and_file_cas_required: true,
    verifier_disable_override_authorized: false,
    cas_before_owner_service_and_pass_read: true,
    cas_before_owner_database_read: true,
    cas_before_production_operator_runpod_application_secret_reads: true,
    readback_order: Object.freeze([
      "receipt_file",
      "prior_result_cas",
      "owner_pg_service",
      "owner_pgpass",
      "ledger45",
      "pgcrypto",
      "exact_operator_acl",
    ]),
    verifies_final_ledger_count: 45,
    verifies_pgcrypto: true,
    verifies_exact_operator_acl: true,
    verify_before_every_post_bootstrap_non_early_cleanup_operation: true,
    bootstrap_operation_exempt: true,
    early_cleanup_operations_exempt: true,
    early_cleanup_condition: "context.earlyFailure === true",
    operator_runtime_reconciler_dsns_not_read: true,
    runpod_calls: 0,
    cloudflare_calls: 0,
    application_secret_reads: 0,
  }),
});
const EXACT_WORKFLOW_START_AUTHORITY_POLICY = Object.freeze({
  operation_id: "record-workflow-start-authority",
  phase: "max_one_control_plane_and_guarded_activation",
  phase_cap_usd: 0,
  ordered_after_operation: "promote-qualified-production",
  ordered_before_operation: "v2-09-short-hosted-project",
  database_function: "videoforge_record_v213_workflow_start_authority(uuid,uuid,text,timestamptz)",
  result_exact_fields: Object.freeze(["authorityId", "tokenSha256", "expiresAt"]),
  result_authority_id_is_uuid: true,
  result_token_sha256_is_canonical_hash: true,
  result_expires_at_is_rfc3339_timestamp: true,
  provider_calls: 0,
  application_secret_reads: 0,
  gpu_use: false,
  external_spend_usd: 0,
  exact_once_or_reconcile: true,
  ambiguous_result_transition: "OUTER_CLEANUP_ONLY_NO_RETRY",
});
const EXACT_EARLY_NO_DATABASE_CLEANUP_POLICY = Object.freeze({
  schema: "videoforge.v213-full-live-early-cleanup-input/v1",
  trigger: "BEFORE_OPERATOR_ROLE_VERIFIED",
  runpod_only: true,
  runpod_key_required: true,
  exact_allowed_environment_names: Object.freeze([
    "VIDEOFORGE_V213_BRIDGE_COMMAND",
    "VIDEOFORGE_V213_BRIDGE_REQUEST_FD",
    "VIDEOFORGE_V213_BRIDGE_RUNPOD_API_KEY_FD",
  ]),
  exact_child_fd_environment: Object.freeze(["REQUEST_FD", "RUNPOD_API_KEY_FD"]),
  allowed_operation_ids: Object.freeze([
    "restore-endpoints-max-one",
    "prove-zero-workers",
    "read-settled-billing",
    "reconcile-exact-resources",
  ]),
  forbidden_inputs: Object.freeze([
    "OPERATOR_DATABASE_URL_FD",
    "RUNTIME_DATABASE_URL_FD",
    "RECONCILER_DATABASE_URL_FD",
    "exactProductionInput",
    "production-secrets-fd",
    "endpoint-ids-or-hashes",
    "receipt-or-signing-keys",
    "key-registration",
  ]),
  database_calls: 0,
  cloudflare_mutations: 0,
  cloudflare_calls: 0,
  provider_mutations: 0,
  runpod_calls: 0,
  runpod_mutations: 0,
  application_secret_reads: 0,
  gpu_use: false,
  external_spend_usd: 0,
  accepted_only_before_operator_verification: true,
  database_cleanup_claimed: false,
  never_claims_database_cleanup: true,
  after_operator_verified_cleanup: "NORMAL_OPERATOR_DSN_CLEANUP_RUNTIME",
});
const EXACT_CRASH_SAFE_CLEANUP_POLICY = Object.freeze({
  state_storage: "OUTER_STATE_MODE_0700_DIRECTORY_FILE_MODE_0600",
  durable_before_cleanup_dispatch: true,
  resumes_only_unsettled_cleanup_work: true,
  settled_cleanup_result_replay_cas_required: true,
  ambiguous_work_is_not_redispatched: true,
  cleanup_operations: Object.freeze([
    "restore-endpoints-max-one",
    "prove-zero-workers",
    "read-settled-billing",
    "reconcile-exact-resources",
  ]),
  failure_state: "CONSUMED_SINGLE_EXECUTION_CLEANUP_ONLY",
  committed_role_or_grant_failure: "MANUAL_RECONCILIATION_STOP",
  cleanup_proof_required: Object.freeze([
    "zero_worker_proof_sha256",
    "billing_proof_sha256",
    "resource_reconciliation_sha256",
    "max_one_restoration_sha256",
  ]),
});
const EXACT_DURABLE_BILLING_POLICY = Object.freeze({
  baseline_source: "AUTHENTICATED_RUNPOD_ACCOUNT_BILLING_READBACK",
  baseline_is_durable: true,
  reserve_open_liability_before_paid_dispatch: true,
  reservation_includes_billing_lag: true,
  settle_only_after_terminal_jobs_and_zero_workers: true,
  final_billing_readback_required: true,
  final_billing_stable_read_count: 3,
  stable_read_contract: Object.freeze({
    consecutive_authenticated_reads: true,
    exact_read_count: 3,
    equal_cumulative_values_required: true,
    no_provider_mutation_between_reads: true,
    inter_read_spacing_ms: 2_000,
    establish_current_mode_baseline_read_count: 1,
    establish_current_mode_total_provider_reads: 4,
    all_three_final_reads_are_included_in_proof: true,
    malformed_or_transport_read_is_hard_stop: true,
  }),
  observed_billing_is_not_settlement: true,
  ambiguous_or_late_billing_transition: "OUTER_CLEANUP_ONLY_NO_RETRY",
  cumulative_cap_usd: 17.5,
  phase_cap_overflow_hard_stop: true,
});
const EXACT_PREQUALIFICATION_BRIDGE_POLICY = Object.freeze({
  fresh_live_preflight_command: "fresh-live-preflight",
  prequalification_input_reader: "readV213PrequalificationProtectedInputs",
  prequalification_runtime_factory: "createV213PrequalificationRuntime",
  prequalification_protected_input_fields: Object.freeze([
    "request",
    "runpodApiKey",
    "operatorDatabaseUrl",
  ]),
  prequalification_allowed_environment_names: Object.freeze([
    "VIDEOFORGE_V213_BRIDGE_COMMAND",
    "VIDEOFORGE_V213_BRIDGE_REQUEST_FD",
    "VIDEOFORGE_V213_BRIDGE_RUNPOD_API_KEY_FD",
    "VIDEOFORGE_V213_BRIDGE_OPERATOR_DATABASE_URL_FD",
  ]),
  prequalification_forbidden_environment_names: Object.freeze([
    "VIDEOFORGE_V213_BRIDGE_RUNTIME_DATABASE_URL_FD",
    "VIDEOFORGE_V213_BRIDGE_RECONCILER_DATABASE_URL_FD",
    "VIDEOFORGE_V213_BRIDGE_WORKER_ORIGIN_FD",
    "VIDEOFORGE_V213_BRIDGE_WORKER_OPERATOR_BEARER_FD",
    "VIDEOFORGE_V213_BRIDGE_PRODUCTION_SECRETS_FD",
  ]),
  prequalification_rejects_other_prefixed_environment_names: true,
  prequalification_runtime_has_no_runtime_reconciler_or_production_secret_inputs: true,
  normal_input_reader: "readV213ProtectedInputs",
  normal_runtime_factory: "createV213ProductionRuntime",
  full_runtime_rejected_for_fresh_live_preflight: true,
  operator_only_preflight: Object.freeze({
    function: "preflightConcreteFullLiveInputs",
    operator_only: true,
    before_command: "fresh-live-preflight",
    protected_environment_inputs: Object.freeze([
      "VIDEOFORGE_V2_13_RUNPOD_API_KEY_FILE",
      "VIDEOFORGE_V2_13_OPERATOR_DATABASE_URL_FILE",
    ]),
    fresh_child_reader: "readV213PrequalificationProtectedInputs",
    fresh_child_runtime_factory: "createV213PrequalificationRuntime",
    fresh_child_operator_role: "videoforge_hosted_operator",
    fresh_child_allowed_database_input: "operatorDatabaseUrl",
    fresh_child_forbidden_database_inputs: Object.freeze([
      "ownerDatabaseUrl",
      "runtimeDatabaseUrl",
      "reconcilerDatabaseUrl",
    ]),
    fresh_child_forbidden_database_fd_names: Object.freeze([
      "OWNER_DATABASE_URL_FD",
      "RUNTIME_DATABASE_URL_FD",
      "RECONCILER_DATABASE_URL_FD",
    ]),
    fresh_child_receives_no_owner_runtime_or_reconciler_dsn: true,
  }),
  initial_executor_preflight: Object.freeze({
    function: "preflightConcreteFullLiveInputs",
    bootstrap_only: true,
    allow_unmaterialized_production_input: true,
    require_endpoint_secrets: false,
    before_operation: "release-tag-create",
  }),
  staged_full_preflight: Object.freeze({
    function: "preflightConcreteFullLiveInputs",
    after_operation: "fresh-live-preflight",
    before_command: "mage-live-qualification",
    bootstrap_receipt_cas_must_have_passed: true,
    require_endpoint_secrets: false,
  }),
  executor_receipt_gate: Object.freeze({
    verifier_function: "verifyPrequalificationDatabaseReceipt",
    settled_result_hydration_function: "hydrateSettledResults",
    prior_results_argument: "priorResults",
    initial_bootstrap_only_preflight_skips_full_receipt_verifier: true,
    staged_preflight: Object.freeze({
      mode_flag: "staged",
      verify_before_full_protected_preflight: true,
      full_protected_preflight_function: "preflightConcreteFullLiveInputs",
    }),
    restart_preflight: Object.freeze({
      hydrate_settled_results_before_preflight: true,
      use_hydrated_prior_results: true,
      repeat_receipt_verifier: true,
      verify_before_full_protected_preflight: true,
    }),
    no_role_presence_or_initial_preflight_substitution: true,
  }),
  child_process_timeout_policy: Object.freeze({
    production_child_max_timeout_ms: 1_800_000,
    cleanup_child_max_timeout_ms: 60_000,
    timeout_must_be_positive: true,
    timeout_must_be_bounded_by_authority_deadline: true,
    cleanup_timeout_remains_bounded_after_authority_expiry: true,
    spawn_timeout_is_required: true,
    kill_signal: "SIGTERM",
    timeout_transition: "OUTER_CLEANUP_ONLY_NO_RETRY",
  }),
  promotion_database_dsn_policy: Object.freeze({
    protected_file: "VIDEOFORGE_V2_13_OPERATOR_DATABASE_URL_FILE",
    exact_path: "operator.database-url",
    exact_role: "videoforge_hosted_operator",
    accepted_protocols: Object.freeze(["postgres:", "postgresql:"]),
    exact_query_parameters: Object.freeze({
      sslmode: "require",
      channel_binding: "require",
    }),
    host_and_database_source: "owner.pg_service.conf",
    fingerprint_field: "database.operator_database_url_sha256",
    fingerprint_algorithm: "SHA256_EXACT_PROTECTED_FILE_BYTES",
    fingerprint_must_match_guarded_authority_before_pool_creation: true,
    runtime_reconciler_and_owner_dsns_forbidden: true,
    password_never_in_argv_or_logs: true,
  }),
  post_bootstrap_full_bridge_commands: Object.freeze([
    "mage-live-qualification",
    "soulx-live-qualification",
    "create-exact-max-one-endpoints",
    "v2-09-short-hosted-project",
    "v2-10-operator-free-ranga-pilot",
    "v2-11-two-concurrent-owned-projects",
    "v2-12-long-output",
    "v2-13-final-two-lane-smoke",
  ]),
  receipt_gate: Object.freeze({
    adapter_option: "requirePrequalificationReceipt",
    verifier_function: "verifyPrequalificationDatabaseReceipt",
    verifier_owner_only_protected_readback: true,
    verifier_owner_service_file: "owner.pg_service.conf",
    verifier_owner_pass_file: "owner.pgpass",
    verifier_owner_service_name: "videoforge_v2_13_owner",
    verifier_protected_input_directory_env: "VIDEOFORGE_V2_13_POSTGRES_INPUT_DIR",
    receipt_file: "prequalification-database-bootstrap.json",
    prior_result_operation: "bootstrap-prequalification-database",
    receipt_hash_field: "prequalification_database_bootstrap_sha256",
    require_prior_result_and_file_hash_match: true,
    verifier_disable_override_authorized: false,
    cas_before_owner_service_and_pass_read: true,
    verify_ledger45_pgcrypto_and_exact_operator_acl: true,
    cas_precedes_all_production_operator_runpod_and_application_secret_reads: true,
    before_every_post_bootstrap_non_early_cleanup_operation: true,
    bootstrap_operation_exempt: true,
    early_cleanup_exempt: true,
    guarded_activation_receipt_verified_before_application_secret_reads: true,
    guarded_activation_receipt_verified_before_cloudflare_or_runtime_secret_reads: true,
    fresh_live_failure_code: "BRIDGE_PREQUALIFICATION_RECEIPT",
    guarded_activation_failure_code: "GUARDED_PREQUALIFICATION_RECEIPT",
  }),
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
  "bootstrap-prequalification-database",
  "fresh-live-preflight",
  "mage-live-qualification",
  "soulx-live-qualification",
  "create-exact-max-one-endpoints",
  "guarded-activation-once",
  "promote-qualified-production",
  "record-workflow-start-authority",
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
      proposal.authority_record_commit_binding
        ?.materialization_seed_sha256_required_in_authority_and_consumption_state !== true ||
      proposal.authority_record_commit_binding
        ?.materialization_seed_sha256_must_be_verified_before_execution !== true ||
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
      JSON.stringify(proposal.exact_execution_graph?.prequalification_database_bootstrap_policy) !==
        JSON.stringify(EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY) ||
      JSON.stringify(proposal.exact_execution_graph?.workflow_start_authority_policy) !==
        JSON.stringify(EXACT_WORKFLOW_START_AUTHORITY_POLICY) ||
      JSON.stringify(proposal.exact_execution_graph?.early_no_database_cleanup_policy) !==
        JSON.stringify(EXACT_EARLY_NO_DATABASE_CLEANUP_POLICY) ||
      JSON.stringify(proposal.exact_execution_graph?.crash_safe_cleanup_policy) !==
        JSON.stringify(EXACT_CRASH_SAFE_CLEANUP_POLICY) ||
      JSON.stringify(proposal.exact_execution_graph?.durable_billing_policy) !==
        JSON.stringify(EXACT_DURABLE_BILLING_POLICY) ||
      JSON.stringify(proposal.exact_execution_graph?.prequalification_bridge_policy) !==
        JSON.stringify(EXACT_PREQUALIFICATION_BRIDGE_POLICY) ||
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
    gpu.maximum_serverless_flex_rate_usd_per_gpu_hour !==
      EXPECTED_SERVERLESS_FLEX_RATE_USD_PER_GPU_HOUR ||
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
        "exact_operator_role",
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
      !exactKeys(requestedDatabase, [
        "exact_operator_role",
        "exact_runtime_role",
        "exact_reconciler_role",
        "roles_must_be_fresh_absent_distinct_login_noinherit_hardened",
        "pgcrypto_required",
        "prequalification_database_bootstrap_operator_function_signature_count",
        "prequalification_database_bootstrap_operator_function_signature_namespace",
        "prequalification_database_bootstrap_operator_function_signature_canonicalization",
        "prequalification_database_bootstrap_operator_acl_comparison",
        "prequalification_database_bootstrap_public_execute_readback_count",
        "prequalification_database_bootstrap_public_default_execute_readback_count",
        "prequalification_database_bootstrap_ownership_catalogs",
        "prequalification_database_bootstrap_ownership_readback_is_cluster_wide",
        "prequalification_database_bootstrap_operator_dsn_value_read_after_migration_prefix_commit_count",
        "prequalification_database_bootstrap_operator_dsn_value_read_forbidden_before_migration_prefix_commit",
        "prequalification_database_bootstrap_phase",
        "prequalification_database_bootstrap_phase_cap_usd",
        "prequalification_database_bootstrap_receipt_path",
        "prequalification_database_bootstrap_receipt_hash_field",
        "prequalification_database_bootstrap_receipt_replay_cas_required",
        "prequalification_database_bootstrap_recovery_mode_ledger_before_count",
        "prequalification_database_bootstrap_recovery_mode_final_ledger_count",
        "exact_operator_function_signatures",
        "exact_initial_ledger_prefix_count",
        "exact_recoverable_prefix_counts",
        "exact_migrations_to_apply",
      ]) ||
      requestedDatabase?.exact_operator_role !== "videoforge_hosted_operator" ||
      requestedDatabase?.exact_runtime_role !== "videoforge_hosted_runtime" ||
      requestedDatabase.exact_reconciler_role !== "videoforge_hosted_reconciler" ||
      requestedDatabase.roles_must_be_fresh_absent_distinct_login_noinherit_hardened !== true ||
      requestedDatabase.pgcrypto_required !== true ||
      requestedDatabase.prequalification_database_bootstrap_operator_function_signature_count !==
        EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.exact_operator_function_signature_count ||
      requestedDatabase.prequalification_database_bootstrap_operator_function_signature_namespace !==
        EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.exact_operator_function_signature_namespace ||
      requestedDatabase.prequalification_database_bootstrap_operator_function_signature_canonicalization !==
        EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.exact_operator_function_signature_canonicalization ||
      requestedDatabase.prequalification_database_bootstrap_operator_acl_comparison !==
        EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.exact_operator_function_acl_comparison ||
      requestedDatabase.prequalification_database_bootstrap_public_execute_readback_count !==
        EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.public_function_execute_readback_count ||
      requestedDatabase.prequalification_database_bootstrap_public_default_execute_readback_count !==
        EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.public_default_function_execute_readback_count ||
      JSON.stringify(requestedDatabase.prequalification_database_bootstrap_ownership_catalogs) !==
        JSON.stringify(EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.ownership_catalogs) ||
      requestedDatabase.prequalification_database_bootstrap_ownership_readback_is_cluster_wide !==
        EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.ownership_readback_is_cluster_wide ||
      requestedDatabase.prequalification_database_bootstrap_operator_dsn_value_read_after_migration_prefix_commit_count !==
        EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.operator_dsn_policy
          .value_read_after_migration_prefix_commit_count ||
      requestedDatabase.prequalification_database_bootstrap_operator_dsn_value_read_forbidden_before_migration_prefix_commit !==
        EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.operator_dsn_policy
          .value_read_forbidden_before_migration_prefix_commit ||
      requestedDatabase.prequalification_database_bootstrap_phase !==
        EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.phase ||
      requestedDatabase.prequalification_database_bootstrap_phase_cap_usd !==
        EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.phase_cap_usd ||
      requestedDatabase.prequalification_database_bootstrap_receipt_path !==
        EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.receipt_path ||
      requestedDatabase.prequalification_database_bootstrap_receipt_hash_field !==
        EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.receipt_hash_field ||
      requestedDatabase.prequalification_database_bootstrap_receipt_replay_cas_required !==
        EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.receipt_replay_cas_required ||
      JSON.stringify(
        requestedDatabase.prequalification_database_bootstrap_recovery_mode_ledger_before_count,
      ) !==
        JSON.stringify(
          EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.recovery_mode_ledger_before_count,
        ) ||
      requestedDatabase.prequalification_database_bootstrap_recovery_mode_final_ledger_count !==
        EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.recovery_mode_final_ledger_count ||
      JSON.stringify(requestedDatabase.exact_operator_function_signatures) !==
        JSON.stringify(
          EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.exact_operator_function_signatures,
        ) ||
      requestedDatabase.exact_initial_ledger_prefix_count !== 36 ||
      JSON.stringify(requestedDatabase.exact_recoverable_prefix_counts) !==
        JSON.stringify([37, 38, 39, 40, 41, 42, 43, 44, 45]) ||
      JSON.stringify(requestedDatabase.exact_migrations_to_apply) !==
        JSON.stringify([37, 38, 39, 40, 41, 42, 43, 44, 45]) ||
      approvedDatabase?.exact_operator_role !== requestedDatabase.exact_operator_role ||
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
        !approval.statement.includes("videoforge_hosted_operator") ||
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
    exactOperatorRole: isV3 ? approved.database_roles.exact_operator_role : null,
    exactRuntimeRole: isV3 ? approved.database_roles.exact_runtime_role : null,
    exactReconcilerRole: isV3 ? approved.database_roles.exact_reconciler_role : null,
  });
}

export {
  EXACT_APPROVAL_VALIDATOR_SOURCE_BINDING,
  EXACT_CLOUDFLARE_SECRET_NAMES,
  EXACT_IMAGE_WORKFLOW_VERIFICATION_POLICY,
  EXACT_INTERNAL_MATERIALIZATION_POLICY,
  EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY,
  EXACT_PREQUALIFICATION_BRIDGE_POLICY,
  EXACT_WORKFLOW_START_AUTHORITY_POLICY,
  EXACT_EARLY_NO_DATABASE_CLEANUP_POLICY,
  EXACT_CRASH_SAFE_CLEANUP_POLICY,
  EXACT_DURABLE_BILLING_POLICY,
  EXACT_OPERATION_IDS,
  EXACT_V3_RELEASE_COMPONENTS,
  EXACT_TRUSTED_TIME_POLICY,
  EXPECTED_SERVERLESS_FLEX_RATE_SOURCE,
  EXPECTED_SERVERLESS_FLEX_RATE_USD_PER_GPU_HOUR,
  EXPECTED_PHASE_CAPS,
  validateFullLiveUserApproval,
};

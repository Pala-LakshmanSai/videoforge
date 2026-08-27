import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const proposalPath = path.join(directory, "combined-live-proposal.json");
const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const assert = (condition, code) => {
  if (!condition) throw new Error(code);
};
const exactKeys = (value, keys, code) => {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), `${code}_OBJECT`);
  assert(JSON.stringify(Object.keys(value)) === JSON.stringify(keys), `${code}_KEYS`);
};
const includes = (values, text, code) =>
  assert(Array.isArray(values) && values.some((value) => value.includes(text)), code);

const bytes = await readFile(proposalPath);
assert(bytes.at(-1) === 0x0a, "PROPOSAL_FINAL_NEWLINE");
const proposal = JSON.parse(bytes);
const expectedProposalPath =
  "project-context/evidence/acceptance/VF-10-13/2026-08-27-cloudflare-credential-origin-repair-candidate/combined-live-proposal.json";
const previousProposalSha256 =
  "sha256:45894ac0b7648d3e9e48357a13c270d2cbbe7e65120fe425f4b449d00601aaca";
const previousProposalRecordCommit = "ec3884961318e46cbc8e09afc1289de279de5eae";
const previousAuthorityId = "v2-13-full-live-20260827-020135z-7444ed0";
const previousApprovalSha256 =
  "sha256:489796f855445176470766df3a62c8a80da5a110e317f512a1e4c24044c21c27";
const previousAuthorityCommit = "59dfe8a763abe947a53f66e734b967e5310fad61";
const previousAuthorityRecordPath =
  "project-context/evidence/acceptance/VF-10-13/2026-08-26-full-activation-ref-role-repair-candidate/approved-authority.json";
const previousApprovalRecordPath =
  "project-context/evidence/acceptance/VF-10-13/2026-08-26-full-activation-ref-role-repair-candidate/user-approval.json";
const previousAuthorityRecordSha256 =
  "sha256:42b122150ce2556afcbbf72d347bb0863d30ede0a126e384ae6e6c18ac0b3052";
const previousApprovalRecordSha256 = previousApprovalSha256;
const APPROVED_WRANGLER_OAUTH_SCOPES = Object.freeze([
  "account:read",
  "agent-memory:write",
  "ai-search:run",
  "ai-search:write",
  "ai:write",
  "artifacts:write",
  "browser:write",
  "challenge-widgets.write",
  "cloudchamber:write",
  "connectivity:admin",
  "containers:write",
  "d1:write",
  "email_routing:write",
  "email_sending:write",
  "flagship:write",
  "offline_access",
  "pages:write",
  "pipelines:write",
  "queues:write",
  "secrets_store:write",
  "ssl_certs:write",
  "user:read",
  "websearch.run",
  "workers:write",
  "workers_kv:write",
  "workers_routes:write",
  "workers_scripts:write",
  "workers_tail:read",
  "zone:read",
]);
const repositoryRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  cwd: process.cwd(),
  encoding: "utf8",
}).trim();
const readCommittedBytes = (commit, treePath, code) => {
  try {
    return execFileSync("git", ["show", `${commit}:${treePath}`], {
      cwd: repositoryRoot,
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch {
    throw new Error(code);
  }
};
const operations = [
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
];
const componentPaths = {
  full_live_executor: "deploy/v2-13/full-live-executor.mjs",
  full_live_adapters: "deploy/v2-13/full-live-adapters.mjs",
  promotion: "deploy/v2-13/promote-qualified-production.mjs",
  guarded_activation: "deploy/v2-13/guarded-activation.mjs",
  orchestration_authority: "deploy/v2-13/full-live-orchestration-authority.mjs",
  typescript_cli_bridge: "apps/web/src/server/providers/v213-full-live-cli.ts",
  runpod_dual_lane_transport: "apps/web/src/server/providers/v213-runpod-dual-lane-transport.ts",
  migration_0045: "packages/control-plane/migrations/0045_hosted_full_live_activation.sql",
  operator_grants: "deploy/v2-13/neon-full-live-operator-grants.sql",
  migration_manifest: "packages/control-plane/migrations/manifest.json",
};

exactKeys(
  proposal,
  [
    "schema_version",
    "checkpoint_range",
    "task_id",
    "candidate_date",
    "proposal_status",
    "sealing",
    "supersession",
    "source",
    "authority_record_commit_binding",
    "authority",
    "exact_execution_graph",
    "immutable_github_release_ref_request",
    "requested_scope",
    "ordered_operations",
    "stop_conditions",
    "approval_request",
  ],
  "ROOT",
);
assert(proposal.schema_version === "videoforge.v2-13-full-live-completion-proposal/v3", "SCHEMA");
assert(
  JSON.stringify(proposal.checkpoint_range) ===
    JSON.stringify(["V2-07", "V2-08", "V2-09", "V2-10", "V2-11", "V2-12", "V2-13"]),
  "CHECKPOINT_RANGE",
);
assert(proposal.task_id === "VF-10-13" && proposal.candidate_date === "2026-08-27", "IDENTITY");
assert(proposal.proposal_status === "BLOCKED_UNSEALED", "STATUS_BLOCKED_UNSEALED");
assert(
  proposal.sealing.sealed_for_exact_user_approval === false &&
    proposal.sealing.current_bytes_are_approval_ineligible === true &&
    proposal.sealing.required_next_action.includes("source-bound") &&
    proposal.sealing.required_next_action.includes("fresh exact user approval"),
  "SEALING_GATE",
);

assert(
  proposal.supersession.supersedes_proposal_sha256 === previousProposalSha256 &&
    proposal.supersession.supersedes_proposal_record_commit === previousProposalRecordCommit &&
    proposal.supersession.superseded_authority_id === previousAuthorityId &&
    proposal.supersession.superseded_approval_sha256 === previousApprovalSha256 &&
    proposal.supersession.superseded_approval_record_commit === previousAuthorityCommit &&
    proposal.supersession.superseded_authority_record_path === previousAuthorityRecordPath &&
    proposal.supersession.superseded_approval_record_path === previousApprovalRecordPath &&
    proposal.supersession.superseded_authority_record_sha256 === previousAuthorityRecordSha256 &&
    proposal.supersession.superseded_approval_record_sha256 === previousApprovalRecordSha256 &&
    proposal.supersession.superseded_authority_original_status ===
      "APPROVED_UNCONSUMED_PENDING_FRESH_EXECUTION_INPUTS" &&
    proposal.supersession.superseded_authority_state === "SUPERSEDED_UNCONSUMED_NO_MUTATION" &&
    proposal.supersession.prior_approval_reusable === false &&
    proposal.supersession.fresh_exact_approval_required === true,
  "SUPERSESSION_45894_59DFE8A",
);

const supersededAuthorityBytes = readCommittedBytes(
  previousAuthorityCommit,
  previousAuthorityRecordPath,
  "SUPERSESSION_AUTHORITY_RECORD_MISSING",
);
const supersededApprovalBytes = readCommittedBytes(
  previousAuthorityCommit,
  previousApprovalRecordPath,
  "SUPERSESSION_APPROVAL_RECORD_MISSING",
);
assert(sha256(supersededAuthorityBytes) === previousAuthorityRecordSha256, "SUPERSESSION_AUTHORITY_RECORD_HASH");
assert(sha256(supersededApprovalBytes) === previousApprovalRecordSha256, "SUPERSESSION_APPROVAL_RECORD_HASH");
let supersededAuthority;
let supersededApproval;
try {
  supersededAuthority = JSON.parse(supersededAuthorityBytes);
  supersededApproval = JSON.parse(supersededApprovalBytes);
} catch {
  throw new Error("SUPERSESSION_RECORD_JSON");
}
assert(
  supersededAuthority.authority_id === previousAuthorityId &&
    supersededAuthority.status === "APPROVED_UNCONSUMED_PENDING_FRESH_EXECUTION_INPUTS" &&
    supersededAuthority.lineage?.proposal_sha256 === previousProposalSha256 &&
    supersededAuthority.lineage?.proposal_record_commit === previousProposalRecordCommit &&
    supersededAuthority.lineage?.user_approval_sha256 === previousApprovalSha256 &&
    supersededAuthority.lineage?.user_approval_path === previousApprovalRecordPath &&
    supersededAuthority.lineage?.authority_record_path === previousAuthorityRecordPath,
  "SUPERSESSION_AUTHORITY_RECORD_BINDING",
);
assert(
  supersededApproval.authority_id === previousAuthorityId &&
    supersededApproval.proposal?.sha256 === previousProposalSha256 &&
    supersededApproval.proposal?.proposal_record_commit === previousProposalRecordCommit &&
    supersededApproval.proposal?.release_source_commit === "7444ed08ed16b618637b8aa29a93be7c89d1642a" &&
    supersededApproval.approval?.exact_proposal_approved === true &&
    supersededApproval.approval?.single_use === true,
  "SUPERSESSION_APPROVAL_RECORD_BINDING",
);

assert(
  proposal.source.release_source_commit === null &&
    proposal.source.repaired_release_source_commit === null &&
    proposal.source.proposal_record_commit === null &&
    proposal.source.future_approval_record_commit === null &&
    proposal.source.future_authority_record_commit === null &&
    proposal.source.proposal_path === expectedProposalPath,
  "SOURCE_BINDING_PENDING",
);
assert(
  JSON.stringify(proposal.source.exact_release_components.approval_validator) ===
    JSON.stringify({
      path: "deploy/v2-13/validate-full-live-approval.mjs",
      source_commit_tree_binding: {
        mode: "EXTERNAL_GIT_COMMIT_TREE_ENTRY",
        commit_field: "source.release_source_commit",
        tree_entry_path: "deploy/v2-13/validate-full-live-approval.mjs",
        verification: "GIT_SHOW_EXACT_COMMIT_PATH_THEN_SHA256",
        embedded_current_file_sha256: false,
        self_hash_forbidden: true,
      },
    }),
  "VALIDATOR_TREE_BINDING",
);
for (const [name, expectedPath] of Object.entries(componentPaths)) {
  assert(proposal.source.exact_release_components[name]?.path === expectedPath, `COMPONENT_PATH:${name}`);
  assert(proposal.source.exact_release_components[name]?.sha256 === null, `COMPONENT_HASH_PENDING:${name}`);
}

assert(
  proposal.authority_record_commit_binding.strategy ===
    "EXTERNAL_GIT_COMMIT_INPUT_VERIFIED_BEFORE_CONSUMPTION_NO_SELF_HASH" &&
    proposal.authority_record_commit_binding.proposal_record_commit_is_distinct === true &&
    proposal.authority_record_commit_binding
      .authority_record_commit_must_contain_exact_approval_and_authority_bytes === true &&
    proposal.authority_record_commit_binding.remote_readback_required === true &&
    proposal.authority_record_commit_binding.embedded_self_commit_hash_forbidden === true &&
    proposal.authority_record_commit_binding
      .materialization_seed_sha256_required_in_authority_and_consumption_state === true &&
    proposal.authority_record_commit_binding.materialization_seed_sha256_must_be_verified_before_execution ===
      true,
  "AUTHORITY_COMMIT_BINDING",
);
assert(
  proposal.authority.single_use === true &&
    proposal.authority.materialization_seed_sha256 === null &&
    Object.entries(proposal.authority).every(([key, value]) =>
      key === "single_use" ? value === true : value === false || value === null,
    ),
  "AUTHORITY_ABSENT",
);
const materialization = proposal.exact_execution_graph.internal_materialization_policy;
assert(
  materialization.materialization_seed_sha256_field === "materialization_seed_sha256" &&
    materialization.materialization_seed_sha256_must_be_bound_in_outer_authority === true &&
    materialization.materialization_seed_sha256_must_be_bound_in_consumption_record === true &&
    materialization.materialization_seed_sha256_verified_at_outer_consumption === true &&
    materialization.materialization_seed_sha256_verified_before_every_seed_read === true &&
    materialization.materialization_seed_sha256_verified_after_restart_or_recovery === true &&
    materialization.protected_seed_future_output_hashes_authorized === false,
  "MATERIALIZATION_SEED_OUTER_BINDING",
);

const bootstrapPolicy = proposal.exact_execution_graph.prequalification_database_bootstrap_policy;
assert(
  bootstrapPolicy.operation_id === "bootstrap-prequalification-database" &&
    bootstrapPolicy.phase === "bootstrap_prequalification_database" &&
    bootstrapPolicy.phase_cap_usd === 0 &&
    bootstrapPolicy.ordered_before_operation === "fresh-live-preflight" &&
    bootstrapPolicy.receipt_path === "prequalification-database-bootstrap.json" &&
    bootstrapPolicy.receipt_hash_field === "prequalification_database_bootstrap_sha256" &&
    bootstrapPolicy.receipt_hash_is_sha256_of_canonical_body === true &&
    bootstrapPolicy.receipt_file_mode === "0600" &&
    bootstrapPolicy.receipt_parent_directory_mode === "0700" &&
    bootstrapPolicy.receipt_secret_free === true &&
    bootstrapPolicy.receipt_replay_requires_exact_all_fields === true &&
    bootstrapPolicy.receipt_final_ledger_count === 45 &&
    JSON.stringify(bootstrapPolicy.receipt_exact_fields) ===
      JSON.stringify([
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
      ]) &&
    JSON.stringify(bootstrapPolicy.receipt_full_exact_fields) ===
      JSON.stringify([
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
  "PREQUALIFICATION_RECEIPT_POLICY",
);
const receiptVerifier = bootstrapPolicy.post_bootstrap_receipt_verifier;
assert(
  receiptVerifier.function === "verifyPrequalificationDatabaseReceipt" &&
    receiptVerifier.adapter_wrapper === "createConcreteFullLiveAdapters" &&
    receiptVerifier.default_verifier_binding ===
      "options.prequalificationVerifier.verify ?? verifyPrequalificationDatabaseReceipt" &&
    receiptVerifier.owner_only === true &&
    receiptVerifier.protected_input_directory_env === "VIDEOFORGE_V2_13_POSTGRES_INPUT_DIR" &&
    receiptVerifier.owner_service_file === "owner.pg_service.conf" &&
    receiptVerifier.owner_pass_file === "owner.pgpass" &&
    receiptVerifier.owner_service_name === "videoforge_v2_13_owner" &&
    receiptVerifier.receipt_path_resolver === "prequalificationPath" &&
    receiptVerifier.prior_result_operation_id === "bootstrap-prequalification-database" &&
    receiptVerifier.prior_result_hash_field === "prequalification_database_bootstrap_sha256" &&
    receiptVerifier.receipt_hash_field === "prequalification_database_bootstrap_sha256" &&
    receiptVerifier.exact_prior_result_and_file_cas_required === true &&
    receiptVerifier.verifier_disable_override_authorized === false &&
    receiptVerifier.cas_before_owner_service_and_pass_read === true &&
    receiptVerifier.cas_before_owner_database_read === true &&
    receiptVerifier.cas_before_production_operator_runpod_application_secret_reads === true &&
    JSON.stringify(receiptVerifier.readback_order) ===
      JSON.stringify([
        "receipt_file",
        "prior_result_cas",
        "owner_pg_service",
        "owner_pgpass",
        "ledger45",
        "pgcrypto",
        "exact_operator_acl",
      ]) &&
    receiptVerifier.verifies_final_ledger_count === 45 &&
    receiptVerifier.verifies_pgcrypto === true &&
    receiptVerifier.verifies_exact_operator_acl === true &&
    receiptVerifier.verify_before_every_post_bootstrap_non_early_cleanup_operation === true &&
    receiptVerifier.bootstrap_operation_exempt === true &&
    receiptVerifier.early_cleanup_operations_exempt === true &&
    receiptVerifier.early_cleanup_condition === "context.earlyFailure === true" &&
    receiptVerifier.operator_runtime_reconciler_dsns_not_read === true &&
    receiptVerifier.runpod_calls === 0 &&
    receiptVerifier.cloudflare_calls === 0 &&
    receiptVerifier.application_secret_reads === 0,
  "PREQUALIFICATION_RECEIPT_VERIFIER",
);

const exactCaps = {
  mage_qualification: 4.5,
  soulx_qualification: 1,
  v2_09_short_hosted_project: 2,
  v2_10_operator_free_ranga_pilot: 2,
  v2_11_two_concurrent_owned_projects: 4,
  v2_12_long_output: 2,
  v2_13_final_two_lane_smoke: 2,
};
const scope = proposal.requested_scope;
assert(scope.maximum_cumulative_finite_runpod_spend_usd === 17.5, "TOTAL_CAP");
assert(JSON.stringify(scope.phase_caps_usd) === JSON.stringify(exactCaps), "PHASE_CAPS");
assert(
  Object.values(scope.phase_caps_usd).reduce((sum, value) => sum + value, 0) === 17.5 &&
    scope.phase_caps_sum_to_cumulative_cap === true,
  "PHASE_CAP_SUM",
);
assert(
  scope.gpu.exact_offering === "NVIDIA GeForce RTX 4090" &&
    scope.gpu.region === "EU-RO-1" &&
    scope.gpu.minimum_availability_at_each_mutation_boundary === "LOW-or-better" &&
    scope.gpu.maximum_serverless_flex_rate_usd_per_gpu_hour === 1.1 &&
    scope.gpu.fallback_allowed === false,
  "GPU_SCOPE",
);
assert(
  scope.retention.retain_only_the_same_two_exact_volumes === true &&
    scope.retention.volume_count === 2 &&
    scope.retention.size_gb_each === 50 &&
    scope.retention.region === "EU-RO-1" &&
    scope.retention.combined_recurring_usd_per_month === 7 &&
    scope.retention.recurring_charge_separate_from_finite_cap === true &&
    scope.retention.new_volume_or_paid_retained_resource_authorized === false &&
    scope.retention.resize_move_replace_or_add_authorized === false &&
    scope.retention.recurring_plan_change_authorized === false,
  "RETENTION_SCOPE",
);

const cloudflareCredentials = scope.cloudflare_credential_scope;
assert(
  cloudflareCredentials.authentication_mode === "EXISTING_WRANGLER_OAUTH_CONFIG_ONLY" &&
    cloudflareCredentials.protected_binding_environment_name ===
      "VIDEOFORGE_V2_13_WRANGLER_OAUTH_CONFIG_FILE" &&
    cloudflareCredentials.protected_config_mode === "0600" &&
    JSON.stringify(cloudflareCredentials.oauth_scopes) ===
      JSON.stringify(APPROVED_WRANGLER_OAUTH_SCOPES) &&
    cloudflareCredentials.protected_config_path === null &&
    cloudflareCredentials.protected_config_sha256 === null &&
    cloudflareCredentials.authenticated_account_id === null &&
    cloudflareCredentials.authenticated_account_id_sha256 === null &&
    cloudflareCredentials.raw_api_token_file_authorized === false &&
    cloudflareCredentials.cloudflare_api_token_environment_export_authorized === false &&
    cloudflareCredentials.new_cloudflare_api_token_authorized === false &&
    cloudflareCredentials.new_oauth_credential_authorized === false &&
    cloudflareCredentials.credential_rotation_authorized === false &&
    cloudflareCredentials.oauth_account_readback_required === true &&
    cloudflareCredentials.oauth_config_readback_required_before_any_cloudflare_mutation === true,
  "CLOUDFLARE_OAUTH_SCOPE",
);

const google = scope.google_oauth_web_client_scope;
assert(
  google.authorized_client_count === 1 &&
    google.operation === "READBACK_EXACTLY_ONE_PREEXISTING_PROTECTED_GOOGLE_OAUTH_WEB_CLIENT" &&
    google.provisioning_mode === "PREEXISTING_PROTECTED_VALUE_ONLY" &&
    google.separate_future_credential_bootstrap_approval_required === true &&
    google.creation_or_rotation_authorized === false &&
    google.client_type === "WEB" &&
    google.project_access_mode === "USER_ACCESSIBLE_EXISTING_PROJECT_ONLY" &&
    google.accessible_project_count_observed === 0 &&
    google.project_id === null &&
    google.project_number_sha256 === null &&
    google.project_access_readback_required === true &&
    google.required_project_permission === "resourcemanager.projects.get" &&
    google.known_inaccessible_project_id === "videoforge-v2-06-staging-0817" &&
    google.inaccessible_project_reuse_authorized === false &&
    google.new_google_project_creation_authorized === false &&
    google.new_google_project_authority_required_if_count_is_zero === true &&
    google.google_project_access_grant_authorized === false &&
    google.if_no_user_accessible_project ===
      "HARD_STOP_AND_RESEAL_WITH_EXPLICIT_NEW_PROJECT_AUTHORITY" &&
    google.client_id_sha256 === null &&
    google.client_secret_sha256 === null &&
    google.authorized_redirect_uri_count === 1 &&
    google.authorized_redirect_uri_template === "{final_production_origin}/api/auth/callback/google" &&
    google.callback_must_bind_only_final_production_origin === true &&
    google.staging_local_preview_or_other_callback_uris_authorized === false &&
    JSON.stringify(google.authorized_javascript_origins) === "[]" &&
    google.other_google_oauth_client_creation_or_rotation_authorized === false &&
    google.old_client_disable_or_delete_authorized_before_new_readback === false &&
    google.identity_and_hashes_pending_credential_scope_audit === true &&
    google.protected_value_must_exist_before_reseal === true,
  "GOOGLE_OAUTH_SCOPE",
);

const r2 = scope.r2_s3_credential_scope;
assert(
  r2.authorized_credential_count === 1 &&
    r2.operation === "READBACK_EXACTLY_ONE_PREEXISTING_PROTECTED_LEAST_PRIVILEGE_R2_S3_CREDENTIAL" &&
    r2.provisioning_mode === "PREEXISTING_PROTECTED_VALUE_ONLY" &&
    r2.separate_future_credential_bootstrap_approval_required === true &&
    r2.creation_or_rotation_authorized === false &&
    r2.account_id === null &&
    r2.account_id_sha256 === null &&
    r2.authenticated_account_readback_required === true &&
    r2.existing_bucket_only === true &&
    r2.bucket_name === null &&
    r2.bucket_name_sha256 === null &&
    r2.bucket_existence_readback_required === true &&
    JSON.stringify(r2.allowed_actions_upper_bound) ===
      JSON.stringify(["ListBucket", "GetObject", "PutObject", "DeleteObject"]) &&
    r2.allowed_scope === "EXACT_AUTHENTICATED_ACCOUNT_AND_EXISTING_BUCKET_ONLY" &&
    r2.object_prefix === null &&
    r2.account_wide_or_wildcard_permissions_authorized === false &&
    r2.bucket_create_delete_or_replace_authorized === false &&
    r2.new_r2_bucket_authorized === false &&
    r2.other_r2_credential_creation_or_rotation_authorized === false &&
    r2.secret_values_or_hashes_in_proposal_or_seed === false &&
    r2.action_set_and_prefix_pending_credential_scope_audit === true &&
    r2.protected_value_must_exist_before_reseal === true,
  "R2_S3_SCOPE",
);

const pending = proposal.source.pending_source_contract;
assert(pending.status === "PENDING_SOURCE_WORKER_AND_CREDENTIAL_SCOPE_AUDIT", "PENDING_CONTRACT_STATUS");
assert(
  pending.release_source_commit === null &&
    pending.release_component_sha256s === null &&
    pending.source_hashes_must_be_bound_before_reseal === true,
  "PENDING_SOURCE_HASHES",
);
assert(
  pending.cloudflare_authentication.mode === "EXISTING_WRANGLER_OAUTH_CONFIG_ONLY" &&
    pending.cloudflare_authentication.protected_binding_environment_name ===
      "VIDEOFORGE_V2_13_WRANGLER_OAUTH_CONFIG_FILE" &&
    pending.cloudflare_authentication.protected_file_mode === "0600" &&
    JSON.stringify(pending.cloudflare_authentication.oauth_scopes) ===
      JSON.stringify(APPROVED_WRANGLER_OAUTH_SCOPES) &&
    pending.cloudflare_authentication.config_path_identity === null &&
    pending.cloudflare_authentication.config_sha256 === null &&
    pending.cloudflare_authentication.raw_api_token_file_authorized === false &&
    pending.cloudflare_authentication.cloudflare_api_token_environment_export_authorized === false &&
    pending.cloudflare_authentication.new_cloudflare_credential_creation_authorized === false &&
    pending.cloudflare_authentication.new_cloudflare_credential_rotation_authorized === false,
  "PENDING_CLOUDFLARE_OAUTH",
);
const origin = pending.account_and_workers_dev_origin;
assert(
  origin.account_id === null &&
    origin.account_id_sha256 === null &&
    origin.authenticated_account_readback_required === true &&
    origin.workers_dev_subdomain_endpoint === "/workers/subdomain" &&
    origin.workers_dev_subdomain === null &&
    origin.workers_dev_subdomain_sha256 === null &&
    origin.subdomain_readback_required === true &&
    origin.worker_name === "videoforge-production-runtime" &&
    origin.derived_origin_template === "https://{worker_name}.{workers_dev_subdomain}.workers.dev" &&
    origin.public_origin === null &&
    origin.public_origin_must_equal_derived_origin === true,
  "PENDING_ORIGIN_BINDING",
);
const routes = pending.route_readbacks;
assert(
  routes.path === "/api/v2/hosted/status" &&
    routes.method === "GET" &&
    routes.pre_mutation.worker_must_be_absent === true &&
    routes.pre_mutation.status === 404 &&
    routes.pre_mutation.content_type === "text/plain; charset=UTF-8" &&
    routes.pre_mutation.body_length === 17 &&
    routes.pre_mutation.body_sha256 ===
      "sha256:a4daf148dd64d1a3e8e8101040915e50d12df29153c5936d377cf2260ccc8ba0" &&
    routes.pre_mutation.observed_body_sha256_prefix === "a4daf148" &&
    routes.pre_mutation.json_body_authorized === false &&
    routes.pre_mutation.status_503_authorized === false &&
    routes.pre_mutation.exact_body_and_content_type_required === true &&
    routes.post_secret_free_quarantine.status === 200 &&
    routes.post_secret_free_quarantine.content_type === "application/json" &&
    routes.post_secret_free_quarantine.schema_version === "videoforge-hosted-status/v1" &&
    routes.post_secret_free_quarantine.gpu_transport === "DISABLED_UNQUALIFIED" &&
    routes.post_secret_free_quarantine.body_sha256 === null &&
    routes.post_qualification.status === 200 &&
    routes.post_qualification.content_type === "application/json" &&
    routes.post_qualification.schema_version === "videoforge-hosted-status/v1" &&
    routes.post_qualification.gpu_transport === "QUALIFIED_EXACT" &&
    routes.post_qualification.body_sha256 === null,
  "ROUTE_READBACK_CONTRACT",
);
const seed = pending.strict_nested_seed_hash_binding;
assert(
  seed.seed_schema === "videoforge.v213-full-live-materialization-seed/v1" &&
    seed.seed_file_environment_name === "VIDEOFORGE_V2_13_MATERIALIZATION_SEED_FILE" &&
    seed.materialization_seed_sha256_field === "materialization_seed_sha256" &&
    seed.seed_file_sha256 === null &&
    seed.outer_authority_must_bind_seed_hash === true &&
    seed.consumption_record_must_bind_seed_hash === true &&
    seed.verified_at_outer_consumption === true &&
    seed.verified_before_every_seed_read === true &&
    seed.verified_after_restart_or_recovery === true &&
    seed.hash_algorithm === "SHA256_CANONICAL_JSON_BYTES" &&
    seed.hash_binding_mode === "EXACT_NESTED_PATH_AND_HASH_CAS" &&
    seed.nested_hashes_must_bind_exact_values === true &&
    seed.missing_or_extra_nested_hashes_rejected === true &&
    seed.future_endpoint_or_deployment_identity_values_forbidden === true &&
    seed.credential_values_forbidden === true &&
    seed.exact_nested_hash_paths_pending_source_contract === true,
  "STRICT_NESTED_SEED_HASH_BINDING",
);

const prequalificationBridge = proposal.exact_execution_graph.prequalification_bridge_policy;
const bridgeReceiptGate = prequalificationBridge.receipt_gate;
assert(
  bridgeReceiptGate.adapter_option === "requirePrequalificationReceipt" &&
    bridgeReceiptGate.verifier_function === "verifyPrequalificationDatabaseReceipt" &&
    bridgeReceiptGate.verifier_owner_only_protected_readback === true &&
    bridgeReceiptGate.verifier_owner_service_file === "owner.pg_service.conf" &&
    bridgeReceiptGate.verifier_owner_pass_file === "owner.pgpass" &&
    bridgeReceiptGate.verifier_owner_service_name === "videoforge_v2_13_owner" &&
    bridgeReceiptGate.verifier_protected_input_directory_env ===
      "VIDEOFORGE_V2_13_POSTGRES_INPUT_DIR" &&
    bridgeReceiptGate.receipt_file === "prequalification-database-bootstrap.json" &&
    bridgeReceiptGate.prior_result_operation === "bootstrap-prequalification-database" &&
    bridgeReceiptGate.receipt_hash_field === "prequalification_database_bootstrap_sha256" &&
    bridgeReceiptGate.require_prior_result_and_file_hash_match === true &&
    bridgeReceiptGate.verifier_disable_override_authorized === false &&
    bridgeReceiptGate.cas_before_owner_service_and_pass_read === true &&
    bridgeReceiptGate.verify_ledger45_pgcrypto_and_exact_operator_acl === true &&
    bridgeReceiptGate.cas_precedes_all_production_operator_runpod_and_application_secret_reads ===
      true &&
    bridgeReceiptGate.before_every_post_bootstrap_non_early_cleanup_operation === true &&
    bridgeReceiptGate.bootstrap_operation_exempt === true &&
    bridgeReceiptGate.early_cleanup_exempt === true &&
    bridgeReceiptGate.guarded_activation_receipt_verified_before_application_secret_reads ===
      true &&
    bridgeReceiptGate.guarded_activation_receipt_verified_before_cloudflare_or_runtime_secret_reads ===
      true,
  "PREQUALIFICATION_RECEIPT_GATE",
);
const operatorOnlyPreflight = prequalificationBridge.operator_only_preflight;
assert(
  operatorOnlyPreflight.function === "preflightConcreteFullLiveInputs" &&
    operatorOnlyPreflight.operator_only === true &&
    operatorOnlyPreflight.before_command === "fresh-live-preflight" &&
    JSON.stringify(operatorOnlyPreflight.protected_environment_inputs) ===
      JSON.stringify([
        "VIDEOFORGE_V2_13_RUNPOD_API_KEY_FILE",
        "VIDEOFORGE_V2_13_OPERATOR_DATABASE_URL_FILE",
      ]) &&
    operatorOnlyPreflight.fresh_child_reader === "readV213PrequalificationProtectedInputs" &&
    operatorOnlyPreflight.fresh_child_runtime_factory === "createV213PrequalificationRuntime" &&
    operatorOnlyPreflight.fresh_child_operator_role === "videoforge_hosted_operator" &&
    operatorOnlyPreflight.fresh_child_allowed_database_input === "operatorDatabaseUrl" &&
    JSON.stringify(operatorOnlyPreflight.fresh_child_forbidden_database_inputs) ===
      JSON.stringify(["ownerDatabaseUrl", "runtimeDatabaseUrl", "reconcilerDatabaseUrl"]) &&
    JSON.stringify(operatorOnlyPreflight.fresh_child_forbidden_database_fd_names) ===
      JSON.stringify(["OWNER_DATABASE_URL_FD", "RUNTIME_DATABASE_URL_FD", "RECONCILER_DATABASE_URL_FD"]) &&
    operatorOnlyPreflight.fresh_child_receives_no_owner_runtime_or_reconciler_dsn === true,
  "PREQUALIFICATION_FRESH_CHILD_SEAM",
);
const executorReceiptGate = prequalificationBridge.executor_receipt_gate;
assert(
  executorReceiptGate.verifier_function === "verifyPrequalificationDatabaseReceipt" &&
    executorReceiptGate.settled_result_hydration_function === "hydrateSettledResults" &&
    executorReceiptGate.prior_results_argument === "priorResults" &&
    executorReceiptGate.initial_bootstrap_only_preflight_skips_full_receipt_verifier === true &&
    executorReceiptGate.staged_preflight?.mode_flag === "staged" &&
    executorReceiptGate.staged_preflight.verify_before_full_protected_preflight === true &&
    executorReceiptGate.staged_preflight.full_protected_preflight_function ===
      "preflightConcreteFullLiveInputs" &&
    executorReceiptGate.restart_preflight?.hydrate_settled_results_before_preflight === true &&
    executorReceiptGate.restart_preflight.use_hydrated_prior_results === true &&
    executorReceiptGate.restart_preflight.repeat_receipt_verifier === true &&
    executorReceiptGate.restart_preflight.verify_before_full_protected_preflight === true &&
    executorReceiptGate.no_role_presence_or_initial_preflight_substitution === true,
  "PREQUALIFICATION_EXECUTOR_RECEIPT_GATE",
);

const cloudflareGraph = proposal.exact_execution_graph.cloudflare_credential_origin_policy;
assert(
  cloudflareGraph.status === "PENDING_SOURCE_WORKER_AND_CREDENTIAL_SCOPE_AUDIT" &&
    cloudflareGraph.oauth_authentication.config_path_resolver === "wranglerOAuthConfigPath" &&
    cloudflareGraph.oauth_authentication.protected_config_reader === "readWranglerOAuthToken" &&
    cloudflareGraph.oauth_authentication.oauth_api_reader === "cloudflareOAuthApiResponse" &&
    cloudflareGraph.oauth_authentication.account_subdomain_reader ===
      "readCloudflareWorkersDevOrigin" &&
    cloudflareGraph.oauth_authentication.read_only_preflight === "cloudflareOAuthReadOnlyPreflight" &&
    cloudflareGraph.oauth_authentication.protected_binding_environment_name ===
      "VIDEOFORGE_V2_13_WRANGLER_OAUTH_CONFIG_FILE" &&
    cloudflareGraph.oauth_authentication.protected_file_mode === "0600" &&
    JSON.stringify(cloudflareGraph.oauth_authentication.oauth_scopes) ===
      JSON.stringify(APPROVED_WRANGLER_OAUTH_SCOPES) &&
    cloudflareGraph.oauth_authentication.raw_api_token_file_authorized === false &&
    cloudflareGraph.oauth_authentication.cloudflare_api_token_environment_export_authorized === false &&
    cloudflareGraph.oauth_authentication.new_cloudflare_credential_authorized === false,
  "CLOUDFLARE_GRAPH_OAUTH",
);
assert(
  cloudflareGraph.account_and_origin.workers_dev_subdomain_endpoint === "/workers/subdomain" &&
    cloudflareGraph.account_and_origin.workers_dev_subdomain_field === "result.subdomain" &&
    cloudflareGraph.account_and_origin.workers_dev_subdomain_sha256_field ===
      "subdomainReadbackSha256" &&
    cloudflareGraph.account_and_origin.origin_derivation ===
      "https://{worker_name}.{workers_dev_subdomain}.workers.dev" &&
    cloudflareGraph.account_and_origin.origin_must_equal_derived_account_bound_origin === true,
  "CLOUDFLARE_GRAPH_ORIGIN",
);
assert(
  cloudflareGraph.route_readback_contract.before_creation.status === 404 &&
    cloudflareGraph.route_readback_contract.before_creation.content_type ===
      "text/plain; charset=UTF-8" &&
    cloudflareGraph.route_readback_contract.before_creation.body_length === 17 &&
    cloudflareGraph.route_readback_contract.before_creation.body_sha256 ===
      "sha256:a4daf148dd64d1a3e8e8101040915e50d12df29153c5936d377cf2260ccc8ba0" &&
    cloudflareGraph.route_readback_contract.before_creation.observed_body_sha256_prefix ===
      "a4daf148" &&
    cloudflareGraph.route_readback_contract.before_creation.json_body_forbidden === true &&
    cloudflareGraph.route_readback_contract.before_creation.status_503_forbidden === true &&
    cloudflareGraph.route_readback_contract.after_secret_free_quarantine.status === 200 &&
    cloudflareGraph.route_readback_contract.after_secret_free_quarantine.gpu_transport ===
      "DISABLED_UNQUALIFIED" &&
    cloudflareGraph.route_readback_contract.after_qualification.status === 200 &&
    cloudflareGraph.route_readback_contract.after_qualification.gpu_transport === "QUALIFIED_EXACT",
  "CLOUDFLARE_GRAPH_ROUTES",
);
assert(cloudflareGraph.source_contract_must_reject_old_503_json_prestate === true, "NO_503_JSON_PRESTATE");
const credentialGraph = proposal.exact_execution_graph.credential_scope_policy;
assert(
  credentialGraph.status === "BOUND_PREEXISTING_CREDENTIAL_SCOPE_PENDING_IDENTITY_AUDIT" &&
    credentialGraph.credential_creation_or_rotation_removed_from_full_live_graph === true &&
    credentialGraph.separate_future_credential_bootstrap_approval_required === true &&
    credentialGraph.no_credential_identity_or_hash_finalized === true,
  "CREDENTIAL_GRAPH_PENDING",
);
assert(
  credentialGraph.google_oauth.authorized_operation ===
      "READBACK_EXACTLY_ONE_PREEXISTING_PROTECTED_GOOGLE_OAUTH_WEB_CLIENT" &&
    credentialGraph.google_oauth.provisioning_mode === "PREEXISTING_PROTECTED_VALUE_ONLY" &&
    credentialGraph.google_oauth.separate_future_credential_bootstrap_approval_required === true &&
    credentialGraph.google_oauth.creation_or_rotation_authorized === false &&
    credentialGraph.google_oauth.project_access === "USER_ACCESSIBLE_EXISTING_PROJECT_ONLY" &&
    credentialGraph.google_oauth.project_id === null &&
    credentialGraph.google_oauth.client_id_sha256 === null &&
    credentialGraph.google_oauth.client_secret_sha256 === null &&
    credentialGraph.google_oauth.callback_uri ===
      "{final_production_origin}/api/auth/callback/google" &&
    credentialGraph.google_oauth.callback_uri_count === 1 &&
    credentialGraph.google_oauth.final_production_origin_only === true &&
    credentialGraph.google_oauth.staging_local_preview_and_other_callbacks_forbidden === true &&
    credentialGraph.google_oauth.new_project_authorized === false &&
    credentialGraph.google_oauth.new_project_or_access_grant_requires_fresh_explicit_authority ===
      true &&
    credentialGraph.google_oauth.historical_inaccessible_project ===
      "videoforge-v2-06-staging-0817" &&
    credentialGraph.google_oauth.old_client_disable_before_new_readback === false &&
    credentialGraph.google_oauth.protected_value_must_exist_before_reseal === true,
  "CREDENTIAL_GRAPH_GOOGLE",
);
assert(
  credentialGraph.r2_s3.authorized_operation ===
      "READBACK_EXACTLY_ONE_PREEXISTING_PROTECTED_LEAST_PRIVILEGE_R2_S3_CREDENTIAL" &&
    credentialGraph.r2_s3.provisioning_mode === "PREEXISTING_PROTECTED_VALUE_ONLY" &&
    credentialGraph.r2_s3.separate_future_credential_bootstrap_approval_required === true &&
    credentialGraph.r2_s3.creation_or_rotation_authorized === false &&
    credentialGraph.r2_s3.account_id === null &&
    credentialGraph.r2_s3.bucket_name === null &&
    credentialGraph.r2_s3.account_and_existing_bucket_binding_required === true &&
    JSON.stringify(credentialGraph.r2_s3.allowed_actions_upper_bound) ===
      JSON.stringify(["ListBucket", "GetObject", "PutObject", "DeleteObject"]) &&
    credentialGraph.r2_s3.object_prefix === null &&
    credentialGraph.r2_s3.account_wide_or_wildcard_access_forbidden === true &&
    credentialGraph.r2_s3.new_bucket_authorized === false &&
    credentialGraph.r2_s3.other_credential_creation_or_rotation_authorized === false &&
    credentialGraph.r2_s3.action_set_and_prefix_pending_credential_scope_audit === true &&
    credentialGraph.r2_s3.protected_value_must_exist_before_reseal === true,
  "CREDENTIAL_GRAPH_R2",
);

assert(JSON.stringify(proposal.exact_execution_graph.ordered_operation_ids) === JSON.stringify(operations), "EXACT_25_OPS");
assert(proposal.exact_execution_graph.operation_order_is_closed_and_non_reorderable === true, "CLOSED_OPS");
assert(proposal.exact_execution_graph.missing_extra_or_repeated_operation_is_a_hard_stop === true, "OP_REPLAY_STOP");
assert(proposal.immutable_github_release_ref_request.exact_target_commit === null, "TARGET_PENDING");
assert(proposal.immutable_github_release_ref_request.other_ref_creation_authorized === false, "REF_SCOPE");
assert(
  proposal.approval_request.requested_maximum_cumulative_finite_runpod_spend_usd === 17.5 &&
    JSON.stringify(proposal.approval_request.requested_exact_phase_caps_usd) ===
      JSON.stringify([4.5, 1, 2, 2, 4, 2, 2]) &&
    proposal.approval_request.requested_gpu.includes("LOW-or-better") &&
    proposal.approval_request.requested_gpu.includes("USD 1.10/GPU-hour") &&
    proposal.approval_request.requested_gpu.includes("no fallback") &&
    proposal.approval_request.requested_separate_retention_consent.includes("USD 7/month") &&
    proposal.approval_request.requested_google_project_id === null &&
    proposal.approval_request.requested_google_client_id_sha256 === null &&
    proposal.approval_request.requested_r2_account_id === null &&
    proposal.approval_request.requested_r2_bucket_name === null &&
    proposal.approval_request.requested_credential_identities_and_hashes_must_be_finalized_before_reseal ===
      true &&
    proposal.approval_request.requested_exact_action.includes("pre-existing protected") &&
    proposal.approval_request.requested_exact_action.includes("separate future credential-bootstrap approval") &&
    proposal.approval_request.requested_google_oauth_scope.includes("pre-existing protected") &&
    proposal.approval_request.requested_google_oauth_scope.includes("no creation or rotation") &&
    proposal.approval_request.requested_google_oauth_scope.includes(
      "separate future credential-bootstrap approval",
    ) &&
    proposal.approval_request.requested_r2_s3_scope.includes("pre-existing protected") &&
    proposal.approval_request.requested_r2_s3_scope.includes("no creation or rotation") &&
    proposal.approval_request.requested_r2_s3_scope.includes(
      "separate future credential-bootstrap approval",
    ),
  "APPROVAL_SCOPE_PENDING",
);
const allOperations = proposal.ordered_operations.flatMap((phase) => phase.operations);
assert(
  !allOperations.some((operation) =>
    /(?:create|rotate)[^\n]*(?:Google OAuth|R2 S3)|(?:Google OAuth|R2 S3)[^\n]*(?:create|rotate)/iu.test(operation),
  ),
  "NO_CREDENTIAL_CREATE_OR_ROTATE_OPERATION",
);
includes(allOperations, "BLOCKED_UNSEALED", "BLOCKED_OPERATION");
includes(allOperations, "404 text/plain", "ABSENT_404_TEXT_PLAIN_OPERATION");
includes(allOperations, "not 503 JSON", "NO_503_OPERATION");
includes(allOperations, "protected Wrangler OAuth config", "OAUTH_OPERATION");
includes(allOperations, "Google OAuth WEB client", "GOOGLE_OPERATION");
includes(allOperations, "least-privilege R2 S3 credential", "R2_OPERATION");
includes(allOperations, "strict nested seed-hash", "SEED_OPERATION");
includes(proposal.stop_conditions, "raw Cloudflare API token", "NO_RAW_TOKEN_STOP");
includes(proposal.stop_conditions, "inaccessible Google project", "NO_INACCESSIBLE_PROJECT_STOP");
includes(proposal.stop_conditions, "exact HTTP 404 text/plain", "EXACT_404_STOP");
includes(proposal.stop_conditions, "CLOUDFLARE_API_TOKEN", "NO_TOKEN_EXPORT_STOP");

for (const name of ["user-approval.json", "approved-authority.json"]) {
  try {
    await access(path.join(directory, name));
    throw new Error(`DRAFT_MUST_NOT_CONTAIN_${name}`);
  } catch (error) {
    if (error?.message === `DRAFT_MUST_NOT_CONTAIN_${name}`) throw error;
  }
}
const files = await readdir(directory);
assert(
  JSON.stringify([...files].sort()) === JSON.stringify(["combined-live-proposal.json", "validate-candidate.mjs"]),
  "DRAFT_FILE_SET",
);

console.log(
  JSON.stringify({
    status: "PASS_BLOCKED_UNSEALED",
    proposal_sha256: sha256(bytes),
    proposal_record_commit: null,
    release_source_commit: null,
    superseded_proposal_sha256: previousProposalSha256,
    superseded_authority_id: previousAuthorityId,
    superseded_authority_commit: previousAuthorityCommit,
    authority: "ABSENT",
    source_hashes: "PENDING_SOURCE_WORKER_AND_CREDENTIAL_SCOPE_AUDIT",
    external_calls: 0,
    mutations: 0,
    gpu_use: 0,
    spend_usd: 0,
  }),
);

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const proposalPath = resolve(directory, "combined-credential-bootstrap-reuse-proposal.json");
const approvalPath = resolve(directory, "user-approval.json");
const authorityPath = resolve(directory, "approved-authority.json");
const PROPOSAL_RELATIVE_PATH =
  "project-context/evidence/acceptance/VF-10-13/2026-08-27-credential-bootstrap-reuse-adroit-archive-candidate/combined-credential-bootstrap-reuse-proposal.json";
const APPROVAL_RELATIVE_PATH =
  "project-context/evidence/acceptance/VF-10-13/2026-08-27-credential-bootstrap-reuse-adroit-archive-candidate/user-approval.json";
const AUTHORITY_RELATIVE_PATH =
  "project-context/evidence/acceptance/VF-10-13/2026-08-27-credential-bootstrap-reuse-adroit-archive-candidate/approved-authority.json";
const PROPOSAL_SHA256 =
  "sha256:90d6b19d6935ded1bfebdb6df53c64ea33edeba4dce750fe3a81b93708228ed4";
const PROPOSAL_RECORD_COMMIT = "68ea8a0de78ded973c3a007ba2173a24161c8c36";
const RELEASE_SOURCE_COMMIT = "3f7b588de4b96da7c1e56b6c1908df7381712710";
const AUTHORITY_ID = "v2-13-credential-bootstrap-reuse-20260827-082652z-90d6b19d";
const APPROVED_AT = "2026-08-27T08:26:52Z";
const EXPIRES_AT = "2026-08-28T08:26:52Z";
const INITIAL_AUTHORITY_STATUS = "APPROVED_UNCONSUMED_PENDING_FRESH_EXECUTION_INPUTS";
const EXECUTION_RESULT_STATUS = "STOPPED_AFTER_RESOURCE_CREATION_REQUIRES_FRESH_ROTATION_AUTHORITY";
const CONSUMED_AUTHORITY_STATUS =
  "CONSUMED_STOPPED_AFTER_RESOURCE_CREATION_REQUIRES_FRESH_ROTATION_AUTHORITY";
const CONSUMED_AT = "2026-08-27T08:59:15Z";
const INCIDENT_PATH =
  "project-context/evidence/acceptance/VF-10-13/2026-08-27-credential-bootstrap-reuse-adroit-archive-candidate/unexpected-firestore-api-enablement-incident.json";
const INCIDENT_SHA256 =
  "sha256:936117ccc777b37d6e6ee595c8d8feccb4fbd026e11d7705084af03230db2229";
const EXECUTION_RESULT_PATH =
  "project-context/evidence/acceptance/VF-10-13/2026-08-27-credential-bootstrap-reuse-adroit-archive-candidate/credential-bootstrap-execution-result.json";
const EXECUTION_RESULT_SHA256 =
  "sha256:b604579fcbf412468525c1fd3483235681fed6425cba7948c585356d3c009909";
const EXECUTION_INCIDENT_PATH =
  "project-context/evidence/acceptance/VF-10-13/2026-08-27-credential-bootstrap-reuse-adroit-archive-candidate/credential-bootstrap-secret-exposure-incident.json";
const EXECUTION_INCIDENT_SHA256 =
  "sha256:6afa7d32f4eaf1c625a1c788304694cfb6219a06a03d51bf9802535a0465e07f";
const EXECUTION_RECEIPT_PATH = "~/.videoforge/v2-13/bootstrap/receipt/credential-bootstrap.json";
const EXECUTION_RECEIPT_SHA256 =
  "sha256:9ac08caffa5758b14321c7a89ca9c76907a9f001f87adb803b7dabffb1723ea7";
const OPERATION_IDS = [
  "credential-bootstrap-reuse-google-project-preflight",
  "credential-bootstrap-reuse-r2-bucket-and-token-preflight",
  "credential-bootstrap-reuse-google-consent-configure",
  "credential-bootstrap-reuse-google-oauth-web-client-create-one",
  "credential-bootstrap-reuse-r2-production-token-create-one",
  "credential-bootstrap-reuse-protected-storage-write-four",
  "credential-bootstrap-reuse-exact-readback-and-receipt",
];
const REDIRECT_URI =
  "https://videoforge-production-runtime.lakshmansai121.workers.dev/api/auth/callback/google";
const R2_ACCOUNT_ID = "f9254d773a3426fcb469451b1f965d8c";
const R2_BUCKET_NAME = "videoforge-v2-06-staging-private";
const STAGING_CREDENTIAL_NAME = "VideoForge V2-06 staging private objects rotated";
const PRODUCTION_CREDENTIAL_NAME = "VideoForge V2-13 production private objects";
const TEST_USERS = ["lakshmansai121@gmail.com", "demo9gss@gmail.com"];
const FILE_NAMES = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
];
const RECEIPT_FIELDS = [
  "schema_version",
  "source_commit",
  "google_authenticated_account_sha256",
  "google_project_id",
  "google_project_id_sha256",
  "google_project_number_sha256",
  "google_oauth_client_id_sha256",
  "google_oauth_client_secret_sha256",
  "google_redirect_uris_canonical_sha256",
  "google_javascript_origins_canonical_sha256",
  "cloudflare_account_id_sha256",
  "r2_bucket_name_sha256",
  "r2_permission_group",
  "r2_credential_type",
  "r2_credential_lifetime",
  "r2_credential_expiration_policy",
  "r2_credential_expiration_at",
  "r2_access_key_id_sha256",
  "r2_secret_access_key_sha256",
  "application_key_grammar",
  "runpod_calls",
  "gpu_hours",
  "external_spend_usd",
];
const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const fail = (code) => {
  throw new Error(`V2_13_CREDENTIAL_BOOTSTRAP_REUSE_AUTHORITY_${code}`);
};
const parse = (bytes, code) => {
  try {
    return JSON.parse(bytes);
  } catch {
    fail(`${code}_JSON`);
  }
};
const exactKeys = (value, keys, code) => {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())
  )
    fail(code);
};
const same = (actual, expected, code) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(code);
};
const hashPattern = /^sha256:[0-9a-f]{64}$/u;
const requireTrue = (value, code) => {
  if (value !== true) fail(code);
};
const requireFalse = (value, code) => {
  if (value !== false) fail(code);
};
const requireNull = (value, code) => {
  if (value !== null) fail(code);
};

const proposalBytes = await readFile(proposalPath);
const approvalBytes = await readFile(approvalPath);
const authorityBytes = await readFile(authorityPath);
if (proposalBytes.at(-1) !== 0x0a || approvalBytes.at(-1) !== 0x0a || authorityBytes.at(-1) !== 0x0a)
  fail("FINAL_NEWLINE");
const proposal = parse(proposalBytes, "PROPOSAL");
const approval = parse(approvalBytes, "APPROVAL");
const authority = parse(authorityBytes, "AUTHORITY");
const approvalSha256 = sha256(approvalBytes);

let repositoryRoot;
for (const workingDirectory of [directory, process.cwd()]) {
  if (repositoryRoot) break;
  try {
    repositoryRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: workingDirectory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    // Mutation tests copy this validator outside the repository; use the test cwd next.
  }
}
if (!repositoryRoot) fail("REPOSITORY_ROOT");
if (sha256(proposalBytes) !== PROPOSAL_SHA256) fail("PROPOSAL_HASH");
let committedProposalBytes;
try {
  committedProposalBytes = execFileSync(
    "git",
    ["show", `${PROPOSAL_RECORD_COMMIT}:${PROPOSAL_RELATIVE_PATH}`],
    { cwd: repositoryRoot, stdio: ["ignore", "pipe", "ignore"] },
  );
} catch {
  fail("PROPOSAL_COMMIT");
}
if (sha256(committedProposalBytes) !== PROPOSAL_SHA256) fail("PROPOSAL_COMMIT_HASH");
if (!hashPattern.test(approvalSha256)) fail("APPROVAL_HASH");

exactKeys(
  approval,
  [
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
    "incident_acknowledgment",
    "statement",
  ],
  "APPROVAL_KEYS",
);
if (
  approval.schema_version !== "videoforge.v2-13-credential-bootstrap-reuse-user-approval/v1" ||
  JSON.stringify(approval.checkpoint_range) !== JSON.stringify(["V2-13"]) ||
  approval.task_id !== "VF-10-13-CREDENTIAL-BOOTSTRAP-REUSE-EXACT-PROJECT" ||
  approval.authority_id !== AUTHORITY_ID ||
  approval.approval_source !== "explicit_user_approval_in_current_codex_task" ||
  approval.approved_at !== APPROVED_AT ||
  approval.expires_at !== EXPIRES_AT ||
  Date.parse(approval.expires_at) <= Date.parse(approval.approved_at)
)
  fail("APPROVAL_IDENTITY");

exactKeys(
  approval.proposal,
  ["path", "sha256", "proposal_record_commit", "release_source_commit"],
  "APPROVAL_PROPOSAL_KEYS",
);
if (
  approval.proposal.path !== PROPOSAL_RELATIVE_PATH ||
  approval.proposal.sha256 !== PROPOSAL_SHA256 ||
  approval.proposal.proposal_record_commit !== PROPOSAL_RECORD_COMMIT ||
  approval.proposal.release_source_commit !== RELEASE_SOURCE_COMMIT
)
  fail("APPROVAL_PROPOSAL_BINDING");

exactKeys(
  approval.approval,
  [
    "exact_proposal_approved",
    "all_and_only_ordered_operations_approved",
    "single_use",
    "provider_calls_authorized",
    "provider_mutations_authorized",
    "credential_access_authorized",
    "google_project_reuse_authorized",
    "google_project_creation_authorized",
    "google_consent_configuration_authorized",
    "google_oauth_client_creation_authorized",
    "cloudflare_r2_credential_creation_authorized",
    "protected_storage_write_authorized",
    "database_mutation_authorized",
    "deployment_authorized",
    "runpod_calls_authorized",
    "gpu_use_authorized",
    "external_spend_authorized",
    "maximum_cumulative_runpod_spend_usd",
    "maximum_gpu_hours",
    "maximum_external_spend_usd",
    "redispatch_authorized",
    "no_retry_or_redispatch",
    "ordered_operation_ids",
    "google",
    "cloudflare_r2",
    "protected_storage",
  ],
  "APPROVAL_SCOPE_KEYS",
);
for (const key of [
  "exact_proposal_approved",
  "all_and_only_ordered_operations_approved",
  "single_use",
  "provider_calls_authorized",
  "provider_mutations_authorized",
  "credential_access_authorized",
  "google_project_reuse_authorized",
  "google_consent_configuration_authorized",
  "google_oauth_client_creation_authorized",
  "cloudflare_r2_credential_creation_authorized",
  "protected_storage_write_authorized",
  "no_retry_or_redispatch",
])
  requireTrue(approval.approval[key], `APPROVAL_SCOPE_${key}`);
for (const key of [
  "google_project_creation_authorized",
  "database_mutation_authorized",
  "deployment_authorized",
  "runpod_calls_authorized",
  "gpu_use_authorized",
  "external_spend_authorized",
  "redispatch_authorized",
])
  requireFalse(approval.approval[key], `APPROVAL_SCOPE_${key}`);
for (const key of [
  "maximum_cumulative_runpod_spend_usd",
  "maximum_gpu_hours",
  "maximum_external_spend_usd",
])
  if (approval.approval[key] !== 0) fail(`APPROVAL_ZERO_${key}`);
same(approval.approval.ordered_operation_ids, OPERATION_IDS, "APPROVAL_OPERATION_ORDER");

exactKeys(
  approval.approval.google,
  [
    "reuse_only_existing_active_project",
    "project_id",
    "project_number",
    "project_create_authorized",
    "project_delete_authorized",
    "project_rename_authorized",
    "project_transfer_authorized",
    "billing_account_association_authorized",
    "api_enablement_authorized",
    "access_grants_authorized",
    "application_name",
    "audience",
    "publishing_status",
    "test_users",
    "additional_oauth_scopes_authorized",
    "other_clients_or_test_users_authorized",
    "authorized_client_count",
    "client_type",
    "authorized_redirect_uris",
    "authorized_javascript_origins",
    "no_other_clients_or_callbacks",
    "hard_stop_if_api_enablement_required",
  ],
  "APPROVAL_GOOGLE_KEYS",
);
const google = approval.approval.google;
for (const key of [
  "reuse_only_existing_active_project",
  "no_other_clients_or_callbacks",
  "hard_stop_if_api_enablement_required",
])
  requireTrue(google[key], `APPROVAL_GOOGLE_${key}`);
for (const key of [
  "project_create_authorized",
  "project_delete_authorized",
  "project_rename_authorized",
  "project_transfer_authorized",
  "billing_account_association_authorized",
  "api_enablement_authorized",
  "access_grants_authorized",
  "other_clients_or_test_users_authorized",
])
  requireFalse(google[key], `APPROVAL_GOOGLE_${key}`);
if (
  google.project_id !== "adroit-archive-329710" ||
  google.project_number !== "984657838923" ||
  google.application_name !== "VideoForge" ||
  google.audience !== "EXTERNAL_TESTING" ||
  google.publishing_status !== "TESTING" ||
  google.authorized_client_count !== 1 ||
  google.client_type !== "WEB"
)
  fail("APPROVAL_GOOGLE_IDENTITY");
same(google.test_users, TEST_USERS, "APPROVAL_GOOGLE_TEST_USERS");
same(google.additional_oauth_scopes_authorized, [], "APPROVAL_GOOGLE_SCOPES");
same(google.authorized_redirect_uris, [REDIRECT_URI], "APPROVAL_GOOGLE_REDIRECT");
same(google.authorized_javascript_origins, [], "APPROVAL_GOOGLE_ORIGINS");

exactKeys(
  approval.approval.cloudflare_r2,
  [
    "account_id",
    "bucket_name",
    "preserve_existing_staging_credential",
    "existing_staging_credential_name",
    "new_credential_count",
    "new_production_credential_name",
    "credential_type",
    "credential_lifetime",
    "credential_expiration_policy",
    "credential_expiration_at",
    "console_permission_label",
    "permission_group",
    "credential_scope_model",
    "account_wide_permissions_authorized",
    "wildcard_permissions_authorized",
    "other_bucket_permissions_authorized",
    "new_bucket_authorized",
    "credential_rotation_authorized",
    "second_credential_authorized",
    "prefix_scope_claim_authorized",
    "post_creation_account_api_token_count",
    "post_creation_user_token_count",
  ],
  "APPROVAL_R2_KEYS",
);
const r2 = approval.approval.cloudflare_r2;
if (
  r2.account_id !== R2_ACCOUNT_ID ||
  r2.bucket_name !== R2_BUCKET_NAME ||
  r2.preserve_existing_staging_credential !== true ||
  r2.existing_staging_credential_name !== STAGING_CREDENTIAL_NAME ||
  r2.new_credential_count !== 1 ||
  r2.new_production_credential_name !== PRODUCTION_CREDENTIAL_NAME ||
  r2.credential_type !== "R2_S3_LONG_LIVED_ACCESS_KEY" ||
  r2.credential_lifetime !== "LONG_LIVED" ||
  r2.credential_expiration_policy !== "NO_EXPIRATION" ||
  r2.credential_expiration_at !== null ||
  r2.console_permission_label !== "Object Read & Write" ||
  r2.permission_group !== "Workers R2 Storage Bucket Item Write" ||
  r2.credential_scope_model !== "BUCKET_ONLY" ||
  r2.post_creation_account_api_token_count !== 2 ||
  r2.post_creation_user_token_count !== 0 ||
  Object.entries(r2).some(
    ([key, value]) =>
      key.endsWith("_authorized") && value !== false && key !== "preserve_existing_staging_credential",
  )
)
  fail("APPROVAL_R2_SCOPE");

exactKeys(
  approval.approval.protected_storage,
  [
    "directory_environment_name",
    "directory_mode",
    "file_mode",
    "file_names",
    "directory_creation",
    "file_creation",
    "path_must_not_be_repository_or_evidence",
    "receipt_environment_name",
    "receipt_file_name",
    "receipt_mode",
    "receipt_parent_directory_mode",
    "receipt_secret_free",
    "receipt_exact_fields",
    "overwrite_or_rotation_authorized",
    "raw_values_in_logs_or_receipt_authorized",
  ],
  "APPROVAL_STORAGE_KEYS",
);
const storage = approval.approval.protected_storage;
if (
  storage.directory_environment_name !== "VIDEOFORGE_V2_13_SECRET_INPUT_DIR" ||
  storage.directory_mode !== "0700" ||
  storage.file_mode !== "0600" ||
  storage.directory_creation !== "CREATE_NEW_DIRECTLY_WITH_MODE_0700" ||
  storage.file_creation !== "CREATE_NEW_DIRECTLY_WITH_MODE_0600_NO_TEMP_OR_RENAME" ||
  storage.path_must_not_be_repository_or_evidence !== true ||
  storage.receipt_environment_name !== "VIDEOFORGE_V2_13_CREDENTIAL_BOOTSTRAP_RECEIPT_FILE" ||
  storage.receipt_file_name !== "credential-bootstrap.json" ||
  storage.receipt_mode !== "0600" ||
  storage.receipt_parent_directory_mode !== "0700" ||
  storage.receipt_secret_free !== true ||
  storage.overwrite_or_rotation_authorized !== false ||
  storage.raw_values_in_logs_or_receipt_authorized !== false
)
  fail("APPROVAL_STORAGE_SCOPE");
same(storage.file_names, FILE_NAMES, "APPROVAL_STORAGE_FILES");
same(storage.receipt_exact_fields, RECEIPT_FIELDS, "APPROVAL_RECEIPT_FIELDS");

exactKeys(
  approval.execution_fences,
  [
    "authority_consumption_required_before_provider_or_credential_access",
    "fresh_exact_project_and_r2_readback_required_before_mutation",
    "preflight_must_reconfirm_incident_and_exact_inventory",
    "project_must_remain_active_and_accessible_to_authenticated_owner",
    "no_api_enablement_or_disablement",
    "no_project_create_delete_rename_transfer_or_access_grant",
    "no_alternate_resource_or_scope_expansion",
    "no_staging_credential_rotation_deletion_or_overwrite",
    "one_attempt_per_mutation_and_ambiguous_result_is_manual_stop",
    "credential_values_only_after_exact_creation_readback",
    "secret_free_receipt_and_no_raw_values_in_logs",
    "temporary_compute_drain_required_on_any_stop",
    "zero_worker_proof_required_if_compute_is_observed",
  ],
  "APPROVAL_FENCE_KEYS",
);
if (Object.values(approval.execution_fences).some((value) => value !== true))
  fail("APPROVAL_FENCES");

exactKeys(
  approval.incident_acknowledgment,
  [
    "acknowledged",
    "evidence_path",
    "evidence_sha256",
    "status",
    "newly_enabled_api_services",
    "rollback_authorized",
    "disablement_authorized",
    "further_api_enablement_authorized",
    "further_unrelated_provider_action_authorized",
  ],
  "APPROVAL_INCIDENT_KEYS",
);
if (
  approval.incident_acknowledgment.acknowledged !== true ||
  approval.incident_acknowledgment.evidence_path !== INCIDENT_PATH ||
  approval.incident_acknowledgment.evidence_sha256 !== INCIDENT_SHA256 ||
  approval.incident_acknowledgment.status !==
    "OBSERVED_OUTSIDE_APPROVAL_INDEPENDENTLY_REVIEWED_AND_CONTAINED" ||
  approval.incident_acknowledgment.rollback_authorized !== false ||
  approval.incident_acknowledgment.disablement_authorized !== false ||
  approval.incident_acknowledgment.further_api_enablement_authorized !== false ||
  approval.incident_acknowledgment.further_unrelated_provider_action_authorized !== false
)
  fail("APPROVAL_INCIDENT");
same(
  approval.incident_acknowledgment.newly_enabled_api_services,
  ["firestore.googleapis.com", "firebaserules.googleapis.com"],
  "APPROVAL_INCIDENT_APIS",
);
if (
  approval.statement !==
  "I approve proposal sha256:90d6b19d6935ded1bfebdb6df53c64ea33edeba4dce750fe3a81b93708228ed4 at commit 68ea8a0de78ded973c3a007ba2173a24161c8c36 for one single-use zero-spend execution. Reuse only existing ACTIVE Google project adroit-archive-329710 (number 984657838923); configure VideoForge as EXTERNAL_TESTING/TESTING with only lakshmansai121@gmail.com and demo9gss@gmail.com; create exactly one WEB OAuth client with no JavaScript origins and only redirect URI https://videoforge-production-runtime.lakshmansai121.workers.dev/api/auth/callback/google; preserve the existing staging R2 credential; create exactly one distinct long-lived, non-expiring R2 credential named VideoForge V2-13 production private objects, restricted to account f9254d773a3426fcb469451b1f965d8c and bucket videoforge-v2-06-staging-private with Object Read & Write / Workers R2 Storage Bucket Item Write only; write only the four approved mode-0600 files and secret-free receipt under a mode-0700 directory. No project/API/billing/access changes, deletion, rotation, alternate resource, RunPod, GPU, or spend. Stop on any drift, API-enable prompt, ambiguity, or failure; no retry or redispatch. I acknowledge the recorded unintended Firestore/Firebase API enablement and authorize no rollback, disablement, or further API enablement."
)
  fail("APPROVAL_STATEMENT");

const postExecutionAuthority = authority.status === CONSUMED_AUTHORITY_STATUS;
const authorityKeys = [
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
  "operation_allowlist",
  "google_scope",
  "cloudflare_r2_scope",
  "protected_storage_scope",
  "preflight_and_consumption",
  "incident_binding",
  "stop_and_cleanup",
  "provider_free_recording",
];
if (postExecutionAuthority) authorityKeys.push("execution_recording");
exactKeys(authority, authorityKeys, "AUTHORITY_KEYS");
if (
  authority.schema_version !==
    "videoforge.v2-13-credential-bootstrap-reuse-approved-authority/v1" ||
  JSON.stringify(authority.checkpoint_range) !== JSON.stringify(["V2-13"]) ||
  authority.task_id !== approval.task_id ||
  authority.authority_id !== AUTHORITY_ID ||
  authority.approved_at !== APPROVED_AT ||
  authority.expires_at !== EXPIRES_AT ||
  authority.single_use !== true ||
  authority.authority_record_commit !== null
)
  fail("AUTHORITY_IDENTITY");
if (!postExecutionAuthority) {
  if (
    authority.status !== INITIAL_AUTHORITY_STATUS ||
    authority.consumed !== false ||
    authority.consumed_at !== null
  )
    fail("AUTHORITY_IDENTITY");
} else if (
  authority.consumed !== true ||
  authority.consumed_at !== CONSUMED_AT
) {
  fail("AUTHORITY_IDENTITY");
}

if (postExecutionAuthority) {
  exactKeys(
    authority.execution_recording,
    [
      "path",
      "sha256",
      "result",
      "incident_path",
      "incident_sha256",
      "receipt_path",
      "receipt_sha256",
      "fresh_rotation_authority_required",
      "authority_reusable",
    ],
    "AUTHORITY_EXECUTION_RECORDING_KEYS",
  );
  if (
    authority.execution_recording.path !== EXECUTION_RESULT_PATH ||
    authority.execution_recording.sha256 !== EXECUTION_RESULT_SHA256 ||
    authority.execution_recording.result !== EXECUTION_RESULT_STATUS ||
    authority.execution_recording.incident_path !== EXECUTION_INCIDENT_PATH ||
    authority.execution_recording.incident_sha256 !== EXECUTION_INCIDENT_SHA256 ||
    authority.execution_recording.receipt_path !== EXECUTION_RECEIPT_PATH ||
    authority.execution_recording.receipt_sha256 !== EXECUTION_RECEIPT_SHA256 ||
    authority.execution_recording.fresh_rotation_authority_required !== true ||
    authority.execution_recording.authority_reusable !== false
  )
    fail("AUTHORITY_EXECUTION_RECORDING");
}

exactKeys(
  authority.lineage,
  [
    "proposal_path",
    "proposal_sha256",
    "proposal_record_commit",
    "release_source_commit",
    "user_approval_path",
    "user_approval_sha256",
    "authority_record_path",
  ],
  "AUTHORITY_LINEAGE_KEYS",
);
if (
  authority.lineage.proposal_path !== PROPOSAL_RELATIVE_PATH ||
  authority.lineage.proposal_sha256 !== PROPOSAL_SHA256 ||
  authority.lineage.proposal_record_commit !== PROPOSAL_RECORD_COMMIT ||
  authority.lineage.release_source_commit !== RELEASE_SOURCE_COMMIT ||
  authority.lineage.user_approval_path !== APPROVAL_RELATIVE_PATH ||
  authority.lineage.user_approval_sha256 !== approvalSha256 ||
  authority.lineage.authority_record_path !== AUTHORITY_RELATIVE_PATH
)
  fail("AUTHORITY_LINEAGE");

const combined = authority.combined_execution_authority;
exactKeys(
  combined,
  [
    "execute_authorized",
    "credential_access_authorized",
    "google_project_reuse_authorized",
    "google_project_creation_authorized",
    "google_consent_configuration_authorized",
    "google_oauth_client_creation_authorized",
    "cloudflare_r2_credential_creation_authorized",
    "protected_storage_write_authorized",
    "database_mutation_authorized",
    "deployment_authorized",
    "provider_calls_authorized",
    "provider_mutations_authorized",
    "runpod_calls_authorized",
    "gpu_use_authorized",
    "external_spend_authorized",
    "maximum_cumulative_finite_runpod_spend_usd",
    "maximum_gpu_hours",
    "maximum_external_spend_usd",
    "redispatch_authorized",
    "alternate_project_authorized",
    "project_delete_authorized",
    "project_rename_authorized",
    "project_transfer_authorized",
    "billing_account_association_authorized",
    "api_enablement_authorized",
    "api_disablement_authorized",
    "access_grants_authorized",
    "r2_rotation_authorized",
    "r2_deletion_authorized",
    "r2_other_bucket_authorized",
    "r2_second_credential_authorized",
    "new_bucket_authorized",
    "temporary_compute_authorized",
    "no_retry_authorized",
  ],
  "AUTHORITY_EXECUTION_KEYS",
);
for (const key of [
  "execute_authorized",
  "credential_access_authorized",
  "google_project_reuse_authorized",
  "google_consent_configuration_authorized",
  "google_oauth_client_creation_authorized",
  "cloudflare_r2_credential_creation_authorized",
  "protected_storage_write_authorized",
  "provider_calls_authorized",
  "provider_mutations_authorized",
  "no_retry_authorized",
])
  requireTrue(combined[key], `AUTHORITY_EXECUTION_${key}`);
for (const key of [
  "google_project_creation_authorized",
  "database_mutation_authorized",
  "deployment_authorized",
  "runpod_calls_authorized",
  "gpu_use_authorized",
  "external_spend_authorized",
  "redispatch_authorized",
  "alternate_project_authorized",
  "project_delete_authorized",
  "project_rename_authorized",
  "project_transfer_authorized",
  "billing_account_association_authorized",
  "api_enablement_authorized",
  "api_disablement_authorized",
  "access_grants_authorized",
  "r2_rotation_authorized",
  "r2_deletion_authorized",
  "r2_other_bucket_authorized",
  "r2_second_credential_authorized",
  "new_bucket_authorized",
  "temporary_compute_authorized",
])
  requireFalse(combined[key], `AUTHORITY_EXECUTION_${key}`);
for (const key of [
  "maximum_cumulative_finite_runpod_spend_usd",
  "maximum_gpu_hours",
  "maximum_external_spend_usd",
])
  if (combined[key] !== 0) fail(`AUTHORITY_ZERO_${key}`);

exactKeys(
  authority.operation_allowlist,
  [
    "all_and_only_ordered_operations",
    "operation_count",
    "ordered_operation_ids",
    "maximum_attempts_per_mutation",
    "ambiguous_result_action",
  ],
  "AUTHORITY_OPERATION_KEYS",
);
if (
  authority.operation_allowlist.all_and_only_ordered_operations !== true ||
  authority.operation_allowlist.operation_count !== OPERATION_IDS.length ||
  authority.operation_allowlist.maximum_attempts_per_mutation !== 1 ||
  authority.operation_allowlist.ambiguous_result_action !==
    "HARD_STOP_MANUAL_READBACK_NO_RETRY_OR_REDISPATCH"
)
  fail("AUTHORITY_OPERATION_SCOPE");
same(authority.operation_allowlist.ordered_operation_ids, OPERATION_IDS, "AUTHORITY_OPERATION_ORDER");

const projectionKeys = Object.keys(approval.approval.google);
if (JSON.stringify(Object.keys(authority.google_scope).sort()) !== JSON.stringify(projectionKeys.sort()))
  fail("AUTHORITY_GOOGLE_PROJECTION_KEYS");
same(authority.google_scope, approval.approval.google, "AUTHORITY_GOOGLE_PROJECTION");
same(authority.cloudflare_r2_scope, approval.approval.cloudflare_r2, "AUTHORITY_R2_PROJECTION");
same(authority.protected_storage_scope, approval.approval.protected_storage, "AUTHORITY_STORAGE_PROJECTION");

exactKeys(
  authority.preflight_and_consumption,
  [
    "fresh_exact_recheck_required_before_mutation",
    "authority_consumption_required_before_provider_or_credential_access",
    "recheck_project_active_accessible_owner",
    "recheck_project_number_and_exact_service_inventory",
    "recheck_oauth_zero_clients_and_unconfigured_or_exact_target_brand",
    "recheck_r2_exact_account_bucket_and_existing_staging_credential",
    "recheck_target_production_credential_absent",
    "recheck_protected_targets_absent_and_paths_unset",
    "recheck_incident_hash_and_no_further_api_action",
    "consumption_marker_must_be_durable_and_exclusive",
    "consumed_authority_must_never_be_reused",
  ],
  "AUTHORITY_PREFLIGHT_KEYS",
);
if (Object.values(authority.preflight_and_consumption).some((value) => value !== true))
  fail("AUTHORITY_PREFLIGHT");

exactKeys(
  authority.incident_binding,
  [
    "acknowledged",
    "evidence_path",
    "evidence_sha256",
    "status",
    "newly_enabled_api_services",
    "rollback_authorized",
    "disablement_authorized",
    "further_api_enablement_authorized",
    "further_unrelated_provider_action_authorized",
  ],
  "AUTHORITY_INCIDENT_KEYS",
);
if (
  authority.incident_binding.acknowledged !== true ||
  authority.incident_binding.evidence_path !== INCIDENT_PATH ||
  authority.incident_binding.evidence_sha256 !== INCIDENT_SHA256 ||
  authority.incident_binding.status !==
    "OBSERVED_OUTSIDE_APPROVAL_INDEPENDENTLY_REVIEWED_AND_CONTAINED" ||
  authority.incident_binding.rollback_authorized !== false ||
  authority.incident_binding.disablement_authorized !== false ||
  authority.incident_binding.further_api_enablement_authorized !== false ||
  authority.incident_binding.further_unrelated_provider_action_authorized !== false
)
  fail("AUTHORITY_INCIDENT");
same(
  authority.incident_binding.newly_enabled_api_services,
  ["firestore.googleapis.com", "firebaserules.googleapis.com"],
  "AUTHORITY_INCIDENT_APIS",
);

if (
  JSON.stringify(Object.keys(authority.stop_and_cleanup).sort()) !==
  JSON.stringify(
    [
      "stop_on_any_bound_identity_config_scope_inventory_or_permission_drift",
      "stop_on_api_enablement_prompt_or_required_api_mutation",
      "stop_on_ambiguous_provider_or_local_result",
      "stop_on_expiry_or_consumption_marker",
      "stop_on_nonzero_spend_or_runpod_gpu_activity",
      "stop_on_scope_expansion_or_alternate_resource",
      "no_retry",
      "no_redispatch",
      "cleanup_only_after_stop",
      "temporary_compute_drain_required",
      "zero_worker_proof_required_if_compute_is_observed",
      "preserve_existing_staging_r2_credential",
      "never_disable_or_rollback_recorded_firestore_side_effect",
    ].sort(),
  ) ||
  Object.values(authority.stop_and_cleanup).some((value) => value !== true)
)
  fail("AUTHORITY_STOP_CLEANUP");

exactKeys(
  authority.provider_free_recording,
  [
    "credentials_accessed",
    "authorized_execution_provider_calls",
    "authorized_execution_provider_mutations",
    "observed_preapproval_provider_mutations",
    "runpod_calls",
    "gpu_hours",
    "external_spend_usd",
    "temporary_compute_started",
    "authority_consumed",
    "execution_started",
    "consumption_record_created",
    "consumption_record_sha256",
  ],
  "AUTHORITY_RECORDING_KEYS",
);
if (!postExecutionAuthority) {
  if (
    authority.provider_free_recording.credentials_accessed !== false ||
    authority.provider_free_recording.authorized_execution_provider_calls !== 0 ||
    authority.provider_free_recording.authorized_execution_provider_mutations !== 0 ||
    authority.provider_free_recording.observed_preapproval_provider_mutations !== 1 ||
    authority.provider_free_recording.runpod_calls !== 0 ||
    authority.provider_free_recording.gpu_hours !== 0 ||
    authority.provider_free_recording.external_spend_usd !== 0 ||
    authority.provider_free_recording.temporary_compute_started !== false ||
    authority.provider_free_recording.authority_consumed !== false ||
    authority.provider_free_recording.execution_started !== false ||
    authority.provider_free_recording.consumption_record_created !== false ||
    authority.provider_free_recording.consumption_record_sha256 !== null
  )
    fail("AUTHORITY_RECORDING");
} else if (
  authority.provider_free_recording.credentials_accessed !== true ||
  authority.provider_free_recording.authorized_execution_provider_calls !== null ||
  authority.provider_free_recording.authorized_execution_provider_mutations !== 4 ||
  authority.provider_free_recording.observed_preapproval_provider_mutations !== 1 ||
  authority.provider_free_recording.runpod_calls !== 0 ||
  authority.provider_free_recording.gpu_hours !== 0 ||
  authority.provider_free_recording.external_spend_usd !== 0 ||
  authority.provider_free_recording.temporary_compute_started !== false ||
  authority.provider_free_recording.authority_consumed !== true ||
  authority.provider_free_recording.execution_started !== true ||
  authority.provider_free_recording.consumption_record_created !== true ||
  authority.provider_free_recording.consumption_record_sha256 !== EXECUTION_RESULT_SHA256
) {
  fail("AUTHORITY_RECORDING_POST");
}

process.stdout.write(
  `${JSON.stringify({
    status: authority.status,
    authority_id: authority.authority_id,
    proposal_sha256: PROPOSAL_SHA256,
    approval_sha256: approvalSha256,
    consumed: authority.consumed,
    provider_calls_made: authority.provider_free_recording.authorized_execution_provider_calls,
    provider_mutations_made: authority.provider_free_recording.authorized_execution_provider_mutations,
    observed_preapproval_provider_mutations:
      authority.provider_free_recording.observed_preapproval_provider_mutations,
    credentials_accessed: authority.provider_free_recording.credentials_accessed,
    runpod_calls: authority.provider_free_recording.runpod_calls,
    gpu_hours: authority.provider_free_recording.gpu_hours,
    external_spend_usd: authority.provider_free_recording.external_spend_usd,
  })}\n`,
);

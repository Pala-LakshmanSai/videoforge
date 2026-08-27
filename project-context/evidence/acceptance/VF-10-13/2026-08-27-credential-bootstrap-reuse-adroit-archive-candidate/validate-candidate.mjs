import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const proposalPath = resolve(directory, "combined-credential-bootstrap-reuse-proposal.json");
const bytes = await readFile(proposalPath);
const proposal = JSON.parse(bytes);
const sha256 = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const fail = (code) => {
  throw new Error(`V2_13_CREDENTIAL_BOOTSTRAP_REUSE_${code}`);
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
const isStringArray = (value) =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");
const includes = (values, value, code) => {
  if (!Array.isArray(values) || !values.some((entry) => entry.includes(value))) fail(code);
};

if (bytes.at(-1) !== 0x0a) fail("FINAL_NEWLINE");

exactKeys(
  proposal,
  [
    "schema_version",
    "task_id",
    "candidate_date",
    "proposal_status",
    "sealing",
    "supersession",
    "source",
    "authority",
    "read_only_binding",
    "receipt",
    "requested_scope",
    "exact_execution_graph",
    "ordered_operations",
    "stop_conditions",
    "approval_request",
    "unexpected_provider_side_effect",
    "independent_safety_verdict"
  ],
  "ROOT_KEYS"
);
if (
  proposal.schema_version !== "videoforge.v2-13-credential-bootstrap-reuse-proposal/v1" ||
  proposal.task_id !== "VF-10-13-CREDENTIAL-BOOTSTRAP-REUSE-EXACT-PROJECT" ||
  proposal.candidate_date !== "2026-08-27" ||
  proposal.proposal_status !== "PASS_SEALED_AWAITING_FRESH_EXACT_APPROVAL"
)
  fail("IDENTITY");

exactKeys(
  proposal.sealing,
  [
    "sealed_for_exact_user_approval",
    "current_bytes_are_approval_ineligible",
    "provider_free_audit_base_commit",
    "required_next_action"
  ],
  "SEALING_KEYS"
);
if (
  proposal.sealing.sealed_for_exact_user_approval !== true ||
  proposal.sealing.current_bytes_are_approval_ineligible !== false ||
  proposal.sealing.provider_free_audit_base_commit !==
    "4a568d3b3dfe6126462cb9d4aa8694144e7fd1e2" ||
  !proposal.sealing.required_next_action.includes("fresh exact user approval")
)
  fail("SEALING_GATE");

exactKeys(
  proposal.supersession,
  [
    "supersedes_proposal_path",
    "supersedes_proposal_sha256",
    "supersedes_proposal_record_commit",
    "prior_approval_reusable",
    "replacement_reason"
  ],
  "SUPERSESSION_KEYS"
);
if (
  proposal.supersession.supersedes_proposal_path !==
    "project-context/evidence/acceptance/VF-10-13/2026-08-27-credential-bootstrap-candidate/combined-credential-bootstrap-proposal.json" ||
  proposal.supersession.supersedes_proposal_sha256 !==
    "sha256:48bf5c7bb7304630eb3744b038fea7b7a11a53878bd1a18d94768c6f0e96e0ab" ||
  proposal.supersession.supersedes_proposal_record_commit !==
    "9106f9d6da9811a193824bc5e0d8104712fca415" ||
  proposal.supersession.prior_approval_reusable !== false ||
  !proposal.supersession.replacement_reason.includes("cannot authorize reuse")
)
  fail("SUPERSESSION_GATE");

exactKeys(
  proposal.source,
  [
    "release_source_commit",
    "binding",
    "branch",
    "required_clean_worktree",
    "source_hashes_bound",
    "source_contract_paths",
    "source_contract_hashes"
  ],
  "SOURCE_KEYS"
);
if (
  proposal.source.release_source_commit !== "3f7b588de4b96da7c1e56b6c1908df7381712710" ||
  proposal.source.binding !== "EXACT_CLEAN_GIT_COMMIT" ||
  proposal.source.branch !== "codex/serverless-v2-roadmap" ||
  proposal.source.required_clean_worktree !== true ||
  proposal.source.source_hashes_bound !== true
)
  fail("SOURCE_PENDING");
same(
  proposal.source.source_contract_paths,
  [
    "apps/web/src/server/hosted/auth.ts",
    "apps/web/src/server/hosted/r2.ts",
    "packages/control-plane/src/auth/better-auth-google.ts"
  ],
  "SOURCE_PATHS"
);
exactKeys(proposal.source.source_contract_hashes, proposal.source.source_contract_paths, "SOURCE_HASH_KEYS");
let repositoryRoot;
for (const workingDirectory of [directory, process.cwd()]) {
  if (repositoryRoot) break;
  try {
    repositoryRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: workingDirectory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    // The mutation tests copy this validator outside the repository; try cwd next.
  }
}
if (!repositoryRoot) fail("SOURCE_HASHES");
for (const sourcePath of proposal.source.source_contract_paths) {
  const expectedHash = proposal.source.source_contract_hashes[sourcePath];
  if (!/^sha256:[0-9a-f]{64}$/u.test(expectedHash)) fail("SOURCE_HASHES");
  let sourceBytes;
  try {
    sourceBytes = execFileSync(
      "git",
      ["show", `${proposal.source.release_source_commit}:${sourcePath}`],
      { cwd: repositoryRoot, stdio: ["ignore", "pipe", "ignore"] }
    );
  } catch {
    fail("SOURCE_HASHES");
  }
  if (sha256(sourceBytes) !== expectedHash) fail("SOURCE_HASHES");
}

const authorityKeys = [
  "single_use",
  "exact_proposal_approved",
  "authority_id",
  "approval_sha256",
  "approved_at",
  "expires_at",
  "consumed",
  "credential_access_authorized",
  "google_project_creation_authorized",
  "google_oauth_client_creation_authorized",
  "cloudflare_r2_credential_creation_authorized",
  "provider_calls_authorized",
  "provider_mutations_authorized",
  "runpod_calls_authorized",
  "gpu_use_authorized",
  "external_spend_authorized",
  "redispatch_authorized"
];
exactKeys(proposal.authority, authorityKeys, "AUTHORITY_KEYS");
if (
  proposal.authority.single_use !== true ||
  Object.entries(proposal.authority).some(
    ([key, value]) => key !== "single_use" && value !== false && value !== null
  )
)
  fail("AUTHORITY_ABSENT");

const binding = proposal.read_only_binding;
exactKeys(
  binding,
  ["status", "provider_calls_made", "provider_mutations_made", "credential_access_made", "google_project", "cloudflare_r2", "protected_storage"],
  "READ_ONLY_BINDING_KEYS"
);
if (
  binding.status !== "BOUND_COMPLETE_FRESH_RECHECK_REQUIRED_AFTER_APPROVAL" ||
  binding.provider_calls_made !== 0 ||
  binding.provider_mutations_made !== 1 ||
  binding.credential_access_made !== 0
)
  fail("READ_ONLY_PENDING");

const googleEvidence = binding.google_project;
exactKeys(
  googleEvidence,
  [
    "project_id",
    "project_display_name",
    "project_number",
    "project_id_sha256",
    "project_number_sha256",
    "authenticated_account_email",
    "authenticated_account_sha256",
    "accessible_to_authenticated_account",
    "lifecycle_state",
    "deletion_pending",
    "current_account_role",
    "iam_principal_count",
    "iam_owner_principal",
    "iam_owner_principal_sha256",
    "iam_owner_role",
    "service_account_count",
    "billing_account_present",
    "paid_service_or_api_required",
    "oauth_client_count",
    "api_key_count",
    "oauth_client_ids_sha256",
    "oauth_client_secrets_accessed",
    "oauth_brand_state",
    "oauth_brand_application_name",
    "oauth_brand_audience",
    "oauth_brand_publishing_status",
    "oauth_brand_test_users",
    "oauth_brand_extra_scopes",
    "oauth_brand_extra_users_or_brands",
    "oauth_existing_redirect_uris",
    "oauth_existing_javascript_origins",
    "required_apis_already_enabled",
    "enabled_api_inventory_count_before",
    "enabled_api_inventory_count_after",
    "newly_enabled_api_names",
    "newly_enabled_api_services",
    "enabled_api_inventory",
    "enabled_api_inventory_complete",
    "enabled_api_inventory_sha256",
    "cloud_storage_bucket_count",
    "cloud_sql_instance_count",
    "bigquery_dataset_count",
    "bigquery_mode",
    "cloud_sql_billing_required_for_creation",
    "firestore_database_count",
    "evidence_commit_or_receipt",
    "evidence_sha256",
    "oauth_configuration_form_path",
    "oauth_configuration_form_accessible_without_api_enablement_prompt",
    "required_api_mutation_authorized",
    "hard_stop_if_api_enablement_required",
    "oauth_client_creation_capability_proven",
    "oauth_capability_evidence"
  ],
  "GOOGLE_EVIDENCE_KEYS"
);
if (
  googleEvidence.project_id !== "adroit-archive-329710" ||
  googleEvidence.project_display_name !== "My First Project" ||
  googleEvidence.project_number !== "984657838923" ||
  googleEvidence.project_id_sha256 !==
    "sha256:0a57c6c9fc4b102fa4eef3ecb490a786cc632bd45440765eed188970c6b097ae" ||
  googleEvidence.project_number_sha256 !==
    "sha256:41ed11c7873b8727019969683f8063652a949a9a899a3b6b7d126135ea2c6347" ||
  googleEvidence.authenticated_account_email !== "palalakshmansai1432@gmail.com" ||
  googleEvidence.authenticated_account_sha256 !==
    "sha256:a7bca06b10386403d2757a5c78b397fb5722e0383bcd72cf9f29259e073bfcc7" ||
  googleEvidence.accessible_to_authenticated_account !== true ||
  googleEvidence.lifecycle_state !== "ACTIVE" ||
  googleEvidence.deletion_pending !== false ||
  googleEvidence.current_account_role !== "Owner" ||
  googleEvidence.iam_principal_count !== 1 ||
  googleEvidence.iam_owner_principal !== "palalakshmansai1432@gmail.com" ||
  googleEvidence.iam_owner_principal_sha256 !==
    "sha256:a7bca06b10386403d2757a5c78b397fb5722e0383bcd72cf9f29259e073bfcc7" ||
  googleEvidence.iam_owner_role !== "Owner" ||
  googleEvidence.service_account_count !== 0 ||
  googleEvidence.billing_account_present !== false ||
  googleEvidence.paid_service_or_api_required !== false ||
  googleEvidence.oauth_client_count !== 0 ||
  googleEvidence.api_key_count !== 0 ||
  JSON.stringify(googleEvidence.oauth_client_ids_sha256) !== "[]" ||
  googleEvidence.oauth_client_secrets_accessed !== false ||
  googleEvidence.oauth_brand_state !== "UNCONFIGURED" ||
  googleEvidence.enabled_api_inventory_count_before !== 13 ||
  googleEvidence.enabled_api_inventory_count_after !== 15 ||
  JSON.stringify(googleEvidence.newly_enabled_api_names) !==
    JSON.stringify(["Cloud Firestore API", "Firebase Rules API"]) ||
  JSON.stringify(googleEvidence.newly_enabled_api_services) !==
    JSON.stringify(["firestore.googleapis.com", "firebaserules.googleapis.com"]) ||
  JSON.stringify(googleEvidence.enabled_api_inventory) !==
    JSON.stringify([
      "BigQuery API",
      "BigQuery Storage API",
      "Cloud Datastore API",
      "Cloud Firestore API",
      "Cloud Logging API",
      "Cloud Monitoring API",
      "Cloud SQL",
      "Cloud Storage",
      "Cloud Storage API",
      "Cloud Trace API",
      "Firebase Rules API",
      "Google Cloud APIs",
      "Google Cloud Storage JSON API",
      "Service Management API",
      "Service Usage API"
    ]) ||
  googleEvidence.enabled_api_inventory_complete !== true ||
  googleEvidence.enabled_api_inventory_sha256 !==
    "sha256:3b55246afeb2fe025bb8cdc9764207f15519ce027c06e82416e610a838b30581" ||
  googleEvidence.cloud_storage_bucket_count !== 0 ||
  googleEvidence.cloud_sql_instance_count !== 0 ||
  googleEvidence.bigquery_dataset_count !== 0 ||
  googleEvidence.bigquery_mode !== "SANDBOX_NO_BILLING" ||
  googleEvidence.cloud_sql_billing_required_for_creation !== true ||
  googleEvidence.firestore_database_count !== 0 ||
  googleEvidence.oauth_configuration_form_path !== "/auth/overview/create" ||
  googleEvidence.oauth_configuration_form_accessible_without_api_enablement_prompt !== true ||
  googleEvidence.required_api_mutation_authorized !== false ||
  googleEvidence.hard_stop_if_api_enablement_required !== true ||
  googleEvidence.oauth_client_creation_capability_proven !== false
)
  fail("GOOGLE_EVIDENCE_BOUND_FACTS");
exactKeys(
  googleEvidence.oauth_capability_evidence,
  [
    "evidence_source",
    "auth_platform_state",
    "configuration_form_path",
    "configuration_form_accessible",
    "configuration_form_steps",
    "create_button_present",
    "oauth_configuration_form_accessible_without_api_enablement_prompt",
    "required_api_mutation_authorized",
    "hard_stop_if_api_enablement_required",
    "api_enablement_requirement",
    "oauth_client_creation_capability_proven",
    "provider_mutation_observed",
    "evidence_sha256"
  ],
  "GOOGLE_CAPABILITY_KEYS"
);
if (
  googleEvidence.oauth_capability_evidence.evidence_source !==
    "CHROME_UI_READ_ONLY_OBSERVATION" ||
  googleEvidence.oauth_capability_evidence.auth_platform_state !== "UNCONFIGURED" ||
  googleEvidence.oauth_capability_evidence.configuration_form_path !== "/auth/overview/create" ||
  googleEvidence.oauth_capability_evidence.configuration_form_accessible !== true ||
  !isStringArray(googleEvidence.oauth_capability_evidence.configuration_form_steps) ||
  JSON.stringify(googleEvidence.oauth_capability_evidence.configuration_form_steps) !==
    JSON.stringify(["App Information", "Audience", "Contact Information", "Finish"]) ||
  googleEvidence.oauth_capability_evidence.create_button_present !== true ||
  googleEvidence.oauth_capability_evidence.oauth_configuration_form_accessible_without_api_enablement_prompt !==
    true ||
  googleEvidence.oauth_capability_evidence.required_api_mutation_authorized !== false ||
  googleEvidence.oauth_capability_evidence.hard_stop_if_api_enablement_required !== true ||
  googleEvidence.oauth_capability_evidence.api_enablement_requirement !==
    "HARD_STOP_NO_API_ENABLEMENT_OR_CONTINUATION" ||
  googleEvidence.oauth_capability_evidence.oauth_client_creation_capability_proven !== false ||
  googleEvidence.oauth_capability_evidence.provider_mutation_observed !== false ||
  googleEvidence.oauth_capability_evidence.evidence_sha256 !== null
)
  fail("GOOGLE_CAPABILITY_EVIDENCE");
for (const key of ["oauth_existing_redirect_uris", "oauth_existing_javascript_origins"]) {
  if (googleEvidence[key] !== null && !isStringArray(googleEvidence[key]))
    fail("GOOGLE_EVIDENCE_UNBOUND");
}
if (
  Object.entries(googleEvidence).some(
    ([key, value]) =>
      [
        "project_id",
        "project_display_name",
        "project_number",
        "project_id_sha256",
        "project_number_sha256",
        "authenticated_account_email",
        "authenticated_account_sha256",
        "accessible_to_authenticated_account",
        "lifecycle_state",
        "deletion_pending",
        "current_account_role",
        "iam_principal_count",
        "iam_owner_principal",
        "iam_owner_principal_sha256",
        "iam_owner_role",
        "service_account_count",
        "billing_account_present",
        "paid_service_or_api_required",
        "oauth_client_count",
        "api_key_count",
        "oauth_client_ids_sha256",
        "oauth_client_secrets_accessed",
        "oauth_brand_state",
        "enabled_api_inventory_count_before",
        "enabled_api_inventory_count_after",
        "newly_enabled_api_names",
        "newly_enabled_api_services",
        "enabled_api_inventory",
        "enabled_api_inventory_complete",
        "enabled_api_inventory_sha256",
        "cloud_storage_bucket_count",
        "cloud_sql_instance_count",
        "bigquery_dataset_count",
        "bigquery_mode",
        "cloud_sql_billing_required_for_creation",
        "firestore_database_count",
        "oauth_configuration_form_path",
        "oauth_configuration_form_accessible_without_api_enablement_prompt",
        "required_api_mutation_authorized",
        "hard_stop_if_api_enablement_required",
        "oauth_client_creation_capability_proven",
        "oauth_capability_evidence"
      ].includes(key)
        ? false
        : value !== null
  )
)
  fail("GOOGLE_EVIDENCE_UNBOUND");

const r2Evidence = binding.cloudflare_r2;
exactKeys(
  r2Evidence,
  [
    "account_id",
    "account_id_sha256",
    "authenticated_account_sha256",
    "bucket_name",
    "bucket_name_sha256",
    "bucket_exists",
    "bucket_public_access",
    "bucket_storage_class",
    "bucket_size_display",
    "bucket_root_prefix",
    "bucket_root_prefix_sha256",
    "bucket_root_inventory_count",
    "bucket_root_inventory_exact",
    "target_credential_count",
    "target_credential_ids_sha256",
    "target_production_credential_name",
    "target_production_credential_name_sha256",
    "target_production_credential_count",
    "target_production_credential_status",
    "target_production_credential_type",
    "target_production_credential_lifetime",
    "target_production_credential_expiration_policy",
    "target_production_credential_expiration_at",
    "credential_scope_readback",
    "credential_secret_accessed",
    "post_creation_account_api_token_count",
    "post_creation_user_token_count",
    "evidence_commit_or_receipt",
    "evidence_sha256"
  ],
  "R2_EVIDENCE_KEYS"
);
exactKeys(
  r2Evidence.credential_scope_readback,
  [
    "credential_name",
    "credential_name_sha256",
    "status",
    "applied_bucket",
    "permission_label",
    "permission_group",
    "issued_date",
    "account_api_token_count",
    "user_token_count",
    "credential_type",
    "secret_available",
    "secret_accessed",
    "must_be_preserved"
  ],
  "R2_EXISTING_CREDENTIAL_KEYS"
);
if (
  r2Evidence.account_id !== "f9254d773a3426fcb469451b1f965d8c" ||
  r2Evidence.authenticated_account_sha256 !== sha256(r2Evidence.account_id) ||
  r2Evidence.authenticated_account_sha256 !== r2Evidence.account_id_sha256 ||
  r2Evidence.bucket_name !== "videoforge-v2-06-staging-private" ||
  r2Evidence.credential_secret_accessed !== false ||
  r2Evidence.account_id_sha256 !==
    "sha256:dc7e469ff433fab0fab50ce06a41a24e27de8ab78155299f706d82c63fdccbe8" ||
  r2Evidence.bucket_name_sha256 !==
    "sha256:410831a0659f71ee4959e9ad0778a565b97485442fdc7c4bd8bdd702089bfe1d" ||
  r2Evidence.bucket_exists !== true ||
  r2Evidence.bucket_public_access !== "Disabled" ||
  r2Evidence.bucket_storage_class !== "Standard" ||
  r2Evidence.bucket_size_display !== "55.59 MB" ||
  r2Evidence.bucket_root_prefix !== "tenant/" ||
  r2Evidence.bucket_root_prefix_sha256 !==
    "sha256:88c172b74a7989f77ac43f892d0cbef53fe38acde913ecd1d08671979f79fd90" ||
  r2Evidence.bucket_root_inventory_count !== 1 ||
  r2Evidence.bucket_root_inventory_exact !== true ||
  r2Evidence.target_credential_count !== 1 ||
  r2Evidence.target_production_credential_name !==
    "VideoForge V2-13 production private objects" ||
  r2Evidence.target_production_credential_name_sha256 !==
    "sha256:4ee1c2b2ca4586f0253b728996a8b326453baff12f4879c2c559a698ed13ce67" ||
  r2Evidence.target_production_credential_count !== 0 ||
  r2Evidence.target_production_credential_status !== "ABSENT" ||
  r2Evidence.target_production_credential_type !== null ||
  r2Evidence.target_production_credential_lifetime !== null ||
  r2Evidence.target_production_credential_expiration_policy !== null ||
  r2Evidence.target_production_credential_expiration_at !== null ||
  r2Evidence.credential_scope_readback?.credential_name !==
    "VideoForge V2-06 staging private objects rotated" ||
  r2Evidence.credential_scope_readback?.credential_name_sha256 !==
    "sha256:45840f0f1ad4d01482638eb974ffe6540ed83bdbf8388b236eaa01dd29584329" ||
  r2Evidence.credential_scope_readback?.status !== "ACTIVE" ||
  r2Evidence.credential_scope_readback?.applied_bucket !==
    "videoforge-v2-06-staging-private" ||
  r2Evidence.credential_scope_readback?.permission_label !== "Object Read & Write" ||
  r2Evidence.credential_scope_readback?.permission_group !==
    "Workers R2 Storage Bucket Item Write" ||
  r2Evidence.credential_scope_readback?.issued_date !== "2026-08-17" ||
  r2Evidence.credential_scope_readback?.account_api_token_count !== 1 ||
  r2Evidence.credential_scope_readback?.user_token_count !== 0 ||
  r2Evidence.credential_scope_readback?.credential_type !== "ACCOUNT_API_TOKEN" ||
  r2Evidence.credential_scope_readback?.secret_available !== false ||
  r2Evidence.credential_scope_readback?.secret_accessed !== false ||
  r2Evidence.credential_scope_readback?.must_be_preserved !== true ||
  r2Evidence.post_creation_account_api_token_count !== 2 ||
  r2Evidence.post_creation_user_token_count !== 0 ||
  Object.entries(r2Evidence).some(
    ([key, value]) =>
      [
        "account_id",
        "account_id_sha256",
        "authenticated_account_sha256",
        "bucket_name",
        "bucket_name_sha256",
        "bucket_exists",
        "bucket_public_access",
        "bucket_storage_class",
        "bucket_size_display",
        "bucket_root_prefix",
        "bucket_root_prefix_sha256",
        "bucket_root_inventory_count",
        "bucket_root_inventory_exact",
        "target_credential_count",
        "target_production_credential_name",
        "target_production_credential_name_sha256",
        "target_production_credential_count",
        "target_production_credential_status",
        "credential_scope_readback",
        "credential_secret_accessed"
        ,"post_creation_account_api_token_count",
        "post_creation_user_token_count"
      ].includes(key)
        ? false
        : value !== null
  )
)
  fail("R2_EVIDENCE_UNBOUND");

const storageEvidence = binding.protected_storage;
exactKeys(
  storageEvidence,
  [
    "directory_environment_name",
    "directory_mode",
    "file_mode",
    "path_must_not_be_repository_or_evidence",
    "directory_creation",
    "file_creation",
    "target_file_names",
    "preexisting_target_file_state",
    "environment_paths_unset",
    "credential_values_accessed",
    "receipt_environment_name",
    "receipt_file_name",
    "receipt_mode",
    "receipt_parent_directory_mode",
    "receipt_path_must_not_be_repository_or_evidence",
    "receipt_secret_free",
    "receipt_exact_fields",
    "evidence_sha256"
  ],
  "STORAGE_EVIDENCE_KEYS"
);
if (
  storageEvidence.directory_environment_name !== "VIDEOFORGE_V2_13_SECRET_INPUT_DIR" ||
  storageEvidence.directory_mode !== "0700" ||
  storageEvidence.file_mode !== "0600" ||
  storageEvidence.path_must_not_be_repository_or_evidence !== true ||
  storageEvidence.directory_creation !== "CREATE_NEW_DIRECTLY_WITH_MODE_0700" ||
  storageEvidence.file_creation !== "CREATE_NEW_DIRECTLY_WITH_MODE_0600_NO_TEMP_OR_RENAME" ||
  storageEvidence.preexisting_target_file_state !== "ABSENT" ||
  storageEvidence.environment_paths_unset !== true ||
  storageEvidence.credential_values_accessed !== false ||
  storageEvidence.receipt_environment_name !==
    "VIDEOFORGE_V2_13_CREDENTIAL_BOOTSTRAP_RECEIPT_FILE" ||
  storageEvidence.receipt_file_name !== "credential-bootstrap.json" ||
  storageEvidence.receipt_mode !== "0600" ||
  storageEvidence.receipt_parent_directory_mode !== "0700" ||
  storageEvidence.receipt_path_must_not_be_repository_or_evidence !== true ||
  storageEvidence.receipt_secret_free !== true ||
  !isStringArray(storageEvidence.receipt_exact_fields)
)
  fail("STORAGE_EVIDENCE_UNBOUND");
same(
  storageEvidence.target_file_names,
  ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"],
  "STORAGE_EVIDENCE_FILES"
);

const scope = proposal.requested_scope;
exactKeys(
  scope,
  [
    "executable",
    "activation_state",
    "execution_mode",
    "single_use",
    "maximum_cumulative_runpod_spend_usd",
    "maximum_gpu_hours",
    "maximum_external_spend_usd",
    "provider_calls_authorized",
    "provider_mutations_authorized",
    "credential_access_authorized",
    "google",
    "cloudflare_r2",
    "protected_storage"
  ],
  "SCOPE_KEYS"
);
if (
  scope.executable !== false ||
  scope.activation_state !== "NONE_UNTIL_READ_ONLY_EVIDENCE_BOUND_AND_FRESH_EXACT_APPROVAL" ||
  scope.execution_mode !== "CREDENTIAL_BOOTSTRAP_REUSE_EXISTING_PROJECT_ONLY" ||
  scope.single_use !== true ||
  scope.maximum_cumulative_runpod_spend_usd !== 0 ||
  scope.maximum_gpu_hours !== 0 ||
  scope.maximum_external_spend_usd !== 0 ||
  scope.provider_calls_authorized !== false ||
  scope.provider_mutations_authorized !== false ||
  scope.credential_access_authorized !== false
)
  fail("ZERO_NONEXECUTABLE_SCOPE");

const google = scope.google;
exactKeys(
  google,
  [
    "operation_after_fresh_approval",
    "reuse_exact_project_id",
    "project_create_authorized",
    "project_delete_authorized",
    "project_rename_authorized",
    "project_transfer_authorized",
    "billing_account_association_authorized",
    "api_enablement_authorized",
    "project_access_grants_authorized",
    "paid_service_or_api_enablement_authorized",
    "authorized_client_count",
    "client_type",
    "authorized_redirect_uris",
    "authorized_javascript_origins",
    "oauth_audience",
    "oauth_application_name",
    "oauth_publishing_status",
    "oauth_test_users",
    "additional_oauth_scopes_authorized",
    "other_clients_or_test_users_authorized",
    "alternate_project_authorized",
    "oauth_configuration_form_path",
    "oauth_configuration_form_accessible_without_api_enablement_prompt",
    "required_api_mutation_authorized",
    "hard_stop_if_api_enablement_required",
    "oauth_client_creation_capability_proven"
  ],
  "GOOGLE_SCOPE_KEYS"
);
if (
  !isStringArray(google.authorized_redirect_uris) ||
  !isStringArray(google.authorized_javascript_origins)
)
  fail("GOOGLE_SCOPE");
if (
  google.reuse_exact_project_id !== "adroit-archive-329710" ||
  google.project_create_authorized !== false ||
  google.project_delete_authorized !== false ||
  google.project_rename_authorized !== false ||
  google.project_transfer_authorized !== false ||
  google.billing_account_association_authorized !== false ||
  google.api_enablement_authorized !== false ||
  google.project_access_grants_authorized !== false ||
  google.paid_service_or_api_enablement_authorized !== false ||
  google.authorized_client_count !== 1 ||
  google.client_type !== "WEB" ||
  google.authorized_redirect_uris.length !== 1 ||
  google.authorized_redirect_uris[0] !==
    "https://videoforge-production-runtime.lakshmansai121.workers.dev/api/auth/callback/google" ||
  google.authorized_javascript_origins.length !== 0 ||
  google.oauth_audience !== "EXTERNAL_TESTING" ||
  google.oauth_application_name !== "VideoForge" ||
  google.oauth_publishing_status !== "TESTING" ||
  google.other_clients_or_test_users_authorized !== false ||
  google.alternate_project_authorized !== false ||
  google.oauth_configuration_form_path !== "/auth/overview/create" ||
  google.oauth_configuration_form_accessible_without_api_enablement_prompt !== true ||
  google.required_api_mutation_authorized !== false ||
  google.hard_stop_if_api_enablement_required !== true ||
  google.oauth_client_creation_capability_proven !== false
)
  fail("GOOGLE_SCOPE");
same(
  google.oauth_test_users,
  ["lakshmansai121@gmail.com", "demo9gss@gmail.com"],
  "GOOGLE_TEST_USERS"
);
same(google.additional_oauth_scopes_authorized, [], "GOOGLE_SCOPES");

const r2 = scope.cloudflare_r2;
exactKeys(
  r2,
  [
    "operation_after_fresh_approval",
    "account_id",
    "bucket_name",
    "existing_staging_credential_must_be_preserved",
    "existing_staging_credential_name",
    "existing_staging_credential_name_sha256",
    "new_production_credential_name",
    "new_production_credential_name_sha256",
    "new_production_credential_scope_bound",
    "credential_creation_authorized",
    "new_credential_count",
    "post_creation_account_api_token_count",
    "post_creation_user_token_count",
    "target_production_credential_status_preflight",
    "target_production_credential_name",
    "target_production_credential_name_sha256",
    "credential_type",
    "credential_lifetime",
    "credential_expiration_policy",
    "credential_expiration_at",
    "credential_type_readback_required",
    "credential_lifetime_readback_required",
    "credential_expiration_readback_required",
    "console_permission_label",
    "permission_group",
    "credential_scope_model",
    "account_wide_permissions_authorized",
    "wildcard_permissions_authorized",
    "other_bucket_permissions_authorized",
    "new_bucket_authorized",
    "credential_rotation_authorized",
    "second_credential_authorized",
    "prefix_scope_claim_authorized"
  ],
  "R2_SCOPE_KEYS"
);
if (
  r2.account_id !== "f9254d773a3426fcb469451b1f965d8c" ||
  r2.bucket_name !== "videoforge-v2-06-staging-private" ||
  r2.operation_after_fresh_approval !==
    "PRESERVE_EXISTING_STAGING_AND_CREATE_EXACTLY_ONE_DISTINCT_PRODUCTION_R2_S3_CREDENTIAL" ||
  r2.existing_staging_credential_must_be_preserved !== true ||
  r2.existing_staging_credential_name !==
    "VideoForge V2-06 staging private objects rotated" ||
  r2.existing_staging_credential_name_sha256 !==
    "sha256:45840f0f1ad4d01482638eb974ffe6540ed83bdbf8388b236eaa01dd29584329" ||
  r2.new_production_credential_name !== "VideoForge V2-13 production private objects" ||
  r2.new_production_credential_name_sha256 !==
    "sha256:4ee1c2b2ca4586f0253b728996a8b326453baff12f4879c2c559a698ed13ce67" ||
  r2.new_production_credential_scope_bound !== true ||
  r2.credential_creation_authorized !== false ||
  r2.new_credential_count !== 1 ||
  r2.post_creation_account_api_token_count !== 2 ||
  r2.post_creation_user_token_count !== 0 ||
  r2.target_production_credential_status_preflight !== "ABSENT" ||
  r2.target_production_credential_name !==
    "VideoForge V2-13 production private objects" ||
  r2.target_production_credential_name_sha256 !==
    "sha256:4ee1c2b2ca4586f0253b728996a8b326453baff12f4879c2c559a698ed13ce67" ||
  r2.credential_type !== "R2_S3_LONG_LIVED_ACCESS_KEY" ||
  r2.credential_lifetime !== "LONG_LIVED" ||
  r2.credential_expiration_policy !== "NO_EXPIRATION" ||
  r2.credential_expiration_at !== null ||
  r2.credential_type_readback_required !== true ||
  r2.credential_lifetime_readback_required !== true ||
  r2.credential_expiration_readback_required !== true ||
  r2.console_permission_label !== "Object Read & Write" ||
  r2.permission_group !== "Workers R2 Storage Bucket Item Write" ||
  r2.credential_scope_model !== "BUCKET_ONLY" ||
  r2.account_wide_permissions_authorized !== false ||
  r2.wildcard_permissions_authorized !== false ||
  r2.other_bucket_permissions_authorized !== false ||
  r2.new_bucket_authorized !== false ||
  r2.credential_rotation_authorized !== false ||
  r2.second_credential_authorized !== false ||
  r2.prefix_scope_claim_authorized !== false
)
  fail("R2_SCOPE");

const storage = scope.protected_storage;
exactKeys(
  storage,
  [
    "operation_after_fresh_approval",
    "directory_environment_name",
    "directory_mode",
    "file_mode",
    "path_must_not_be_repository_or_evidence",
    "directory_creation",
    "file_creation",
    "file_names",
    "receipt_environment_name",
    "receipt_file_name",
    "receipt_mode",
    "receipt_parent_directory_mode",
    "receipt_path_must_not_be_repository_or_evidence",
    "receipt_secret_free",
    "receipt_exact_fields",
    "raw_values_in_logs_or_receipt_authorized",
    "overwrite_or_rotation_authorized"
  ],
  "STORAGE_SCOPE_KEYS"
);
if (
  storage.directory_environment_name !== "VIDEOFORGE_V2_13_SECRET_INPUT_DIR" ||
  storage.directory_mode !== "0700" ||
  storage.file_mode !== "0600" ||
  storage.path_must_not_be_repository_or_evidence !== true ||
  storage.directory_creation !== "CREATE_NEW_DIRECTLY_WITH_MODE_0700" ||
  storage.file_creation !== "CREATE_NEW_DIRECTLY_WITH_MODE_0600_NO_TEMP_OR_RENAME" ||
  storage.receipt_environment_name !== "VIDEOFORGE_V2_13_CREDENTIAL_BOOTSTRAP_RECEIPT_FILE" ||
  storage.receipt_file_name !== "credential-bootstrap.json" ||
  storage.receipt_mode !== "0600" ||
  storage.receipt_parent_directory_mode !== "0700" ||
  storage.receipt_path_must_not_be_repository_or_evidence !== true ||
  storage.receipt_secret_free !== true ||
  storage.raw_values_in_logs_or_receipt_authorized !== false ||
  storage.overwrite_or_rotation_authorized !== false
)
  fail("STORAGE_SCOPE");
same(
  storage.file_names,
  ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"],
  "STORAGE_FILES"
);
same(
  storage.receipt_exact_fields,
  [
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
    "external_spend_usd"
  ],
  "STORAGE_RECEIPT_FIELDS"
);

const receipt = proposal.receipt;
exactKeys(
  receipt,
  [
    "schema_version",
    "receipt_environment_name",
    "receipt_file_name",
    "receipt_mode",
    "receipt_parent_directory_mode",
    "receipt_path_must_not_be_repository_or_evidence",
    "exact_fields",
    "hash_field_values_only",
    "raw_secret_values_authorized",
    "receipt_secret_free",
    "receipt_replay_requires_exact_all_fields",
    "runpod_calls",
    "gpu_hours",
    "external_spend_usd"
  ],
  "RECEIPT_KEYS"
);
if (
  receipt.schema_version !== "videoforge.v2-13-credential-bootstrap-result/v1" ||
  receipt.receipt_environment_name !== "VIDEOFORGE_V2_13_CREDENTIAL_BOOTSTRAP_RECEIPT_FILE" ||
  receipt.receipt_file_name !== "credential-bootstrap.json" ||
  receipt.receipt_mode !== "0600" ||
  receipt.receipt_parent_directory_mode !== "0700" ||
  receipt.receipt_path_must_not_be_repository_or_evidence !== true ||
  receipt.hash_field_values_only !== true ||
  receipt.raw_secret_values_authorized !== false ||
  receipt.receipt_secret_free !== true ||
  receipt.receipt_replay_requires_exact_all_fields !== true ||
  receipt.runpod_calls !== 0 ||
  receipt.gpu_hours !== 0 ||
  receipt.external_spend_usd !== 0
)
  fail("RECEIPT_CONTRACT");
same(receipt.exact_fields, storage.receipt_exact_fields, "RECEIPT_FIELDS");

exactKeys(
  proposal.exact_execution_graph,
  [
    "schema_version",
    "requires_fresh_exact_approval",
    "requires_fresh_preflight_recheck",
    "execution_authority_present",
    "provider_calls_without_authority",
    "maximum_external_spend_usd",
    "maximum_gpu_hours",
    "maximum_runpod_calls",
    "preserve_existing_staging_r2_credential",
    "post_state_account_api_token_count",
    "post_state_user_token_count",
    "forbidden_actions",
    "operation_ids"
  ],
  "GRAPH_KEYS"
);
const operationIds = [
  "credential-bootstrap-reuse-google-project-preflight",
  "credential-bootstrap-reuse-r2-bucket-and-token-preflight",
  "credential-bootstrap-reuse-google-consent-configure",
  "credential-bootstrap-reuse-google-oauth-web-client-create-one",
  "credential-bootstrap-reuse-r2-production-token-create-one",
  "credential-bootstrap-reuse-protected-storage-write-four",
  "credential-bootstrap-reuse-exact-readback-and-receipt"
];
if (
  proposal.exact_execution_graph.schema_version !==
    "videoforge.v2-13-credential-bootstrap-reuse-execution-graph/v1" ||
  proposal.exact_execution_graph.requires_fresh_exact_approval !== true ||
  proposal.exact_execution_graph.requires_fresh_preflight_recheck !== true ||
  proposal.exact_execution_graph.execution_authority_present !== false ||
  proposal.exact_execution_graph.provider_calls_without_authority !== false ||
  proposal.exact_execution_graph.maximum_external_spend_usd !== 0 ||
  proposal.exact_execution_graph.maximum_gpu_hours !== 0 ||
  proposal.exact_execution_graph.maximum_runpod_calls !== 0 ||
  proposal.exact_execution_graph.preserve_existing_staging_r2_credential !== true ||
  proposal.exact_execution_graph.post_state_account_api_token_count !== 2 ||
  proposal.exact_execution_graph.post_state_user_token_count !== 0
)
  fail("GRAPH_GATE");
same(proposal.exact_execution_graph.operation_ids, operationIds, "GRAPH_OPERATIONS");
if (!Array.isArray(proposal.ordered_operations) || proposal.ordered_operations.length !== 7)
  fail("OPERATIONS_COUNT");
same(
  proposal.ordered_operations.map((operation) => operation.id),
  operationIds,
  "OPERATIONS_ORDER"
);
if (
  proposal.ordered_operations.some(
    (operation, index) =>
      operation.order !== index + 1 ||
      operation.requires_user_approval !== true ||
      operation.runpod_calls !== 0 ||
      operation.gpu_hours !== 0 ||
      operation.spend_usd !== 0
  )
)
  fail("OPERATIONS_SCOPE");

const oauthClientOperation = proposal.ordered_operations[3];
exactKeys(
  oauthClientOperation,
  [
    "order",
    "id",
    "provider",
    "kind",
    "mutation",
    "requires_user_approval",
    "target_project_id",
    "client_type",
    "authorized_redirect_uris",
    "authorized_javascript_origins",
    "no_other_clients_or_callbacks",
    "max_attempts",
    "ambiguous_result",
    "runpod_calls",
    "gpu_hours",
    "spend_usd"
  ],
  "OAUTH_OPERATION_KEYS"
);
if (
  oauthClientOperation.provider !== "google" ||
  oauthClientOperation.kind !== "CREATE_EXACTLY_ONE_OAUTH_WEB_CLIENT" ||
  oauthClientOperation.mutation !== true ||
  oauthClientOperation.requires_user_approval !== true ||
  oauthClientOperation.target_project_id !== "adroit-archive-329710" ||
  oauthClientOperation.client_type !== "WEB" ||
  !isStringArray(oauthClientOperation.authorized_redirect_uris) ||
  !isStringArray(oauthClientOperation.authorized_javascript_origins) ||
  JSON.stringify(oauthClientOperation.authorized_redirect_uris) !==
    JSON.stringify([
      "https://videoforge-production-runtime.lakshmansai121.workers.dev/api/auth/callback/google"
    ]) ||
  oauthClientOperation.authorized_javascript_origins.length !== 0 ||
  oauthClientOperation.no_other_clients_or_callbacks !== true ||
  oauthClientOperation.max_attempts !== 1 ||
  oauthClientOperation.ambiguous_result !==
    "hard stop and manual readback; no retry or second client"
)
  fail("OAUTH_OPERATION_SCOPE");

const consentOperation = proposal.ordered_operations[2];
exactKeys(
  consentOperation,
  [
    "order",
    "id",
    "provider",
    "kind",
    "mutation",
    "requires_user_approval",
    "target_project_id",
    "precondition",
    "configuration",
    "configuration_form_path",
    "configuration_form_accessible_without_api_enablement_prompt",
    "required_api_mutation_authorized",
    "on_api_enablement_prompt_or_requirement",
    "forbidden",
    "max_attempts",
    "ambiguous_result",
    "runpod_calls",
    "gpu_hours",
    "spend_usd"
  ],
  "CONSENT_OPERATION_KEYS"
);
if (
  consentOperation.provider !== "google" ||
  consentOperation.kind !== "CONFIGURE_EXISTING_CONSENT_SCREEN" ||
  consentOperation.mutation !== true ||
  consentOperation.requires_user_approval !== true ||
  consentOperation.target_project_id !== "adroit-archive-329710" ||
  !consentOperation.precondition.includes("Auth Platform is unconfigured") ||
  !consentOperation.configuration.includes("VideoForge") ||
  !consentOperation.configuration.includes("EXTERNAL_TESTING") ||
  !consentOperation.configuration.includes("TESTING") ||
  !consentOperation.configuration.includes("lakshmansai121@gmail.com") ||
  !consentOperation.configuration.includes("demo9gss@gmail.com") ||
  consentOperation.configuration_form_path !== "/auth/overview/create" ||
  consentOperation.configuration_form_accessible_without_api_enablement_prompt !== true ||
  consentOperation.required_api_mutation_authorized !== false ||
  consentOperation.on_api_enablement_prompt_or_requirement !==
    "HARD_STOP_NO_API_ENABLEMENT_OR_CONTINUATION" ||
  consentOperation.max_attempts !== 1 ||
  consentOperation.ambiguous_result !== "hard stop; no retry or alternate configuration"
)
  fail("CONSENT_OPERATION_SCOPE");

const r2CreateOperation = proposal.ordered_operations[4];
exactKeys(
  r2CreateOperation,
  [
    "order",
    "id",
    "provider",
    "kind",
    "mutation",
    "requires_user_approval",
    "credential_name",
    "account_id",
    "bucket_name",
    "credential_type",
    "credential_lifetime",
    "credential_expiration_policy",
    "credential_expiration_at",
    "credential_type_readback_required",
    "credential_lifetime_readback_required",
    "credential_expiration_readback_required",
    "permission_label",
    "permission_group",
    "credential_scope_model",
    "preserve_existing_credential",
    "post_state_account_api_token_count",
    "post_state_user_token_count",
    "no_account_wide_or_wildcard_or_other_bucket_or_prefix_claim",
    "max_attempts",
    "ambiguous_result",
    "runpod_calls",
    "gpu_hours",
    "spend_usd"
  ],
  "R2_OPERATION_KEYS"
);
if (
  r2CreateOperation.provider !== "cloudflare_r2" ||
  r2CreateOperation.kind !== "CREATE_EXACTLY_ONE_LONG_LIVED_R2_S3_CREDENTIAL" ||
  r2CreateOperation.mutation !== true ||
  r2CreateOperation.requires_user_approval !== true ||
  r2CreateOperation.credential_name !== "VideoForge V2-13 production private objects" ||
  r2CreateOperation.account_id !== "f9254d773a3426fcb469451b1f965d8c" ||
  r2CreateOperation.bucket_name !== "videoforge-v2-06-staging-private" ||
  r2CreateOperation.credential_type !== "R2_S3_LONG_LIVED_ACCESS_KEY" ||
  r2CreateOperation.credential_lifetime !== "LONG_LIVED" ||
  r2CreateOperation.credential_expiration_policy !== "NO_EXPIRATION" ||
  r2CreateOperation.credential_expiration_at !== null ||
  r2CreateOperation.credential_type_readback_required !== true ||
  r2CreateOperation.credential_lifetime_readback_required !== true ||
  r2CreateOperation.credential_expiration_readback_required !== true ||
  r2CreateOperation.permission_label !== "Object Read & Write" ||
  r2CreateOperation.permission_group !== "Workers R2 Storage Bucket Item Write" ||
  r2CreateOperation.credential_scope_model !== "BUCKET_ONLY" ||
  r2CreateOperation.preserve_existing_credential !==
    "VideoForge V2-06 staging private objects rotated" ||
  r2CreateOperation.post_state_account_api_token_count !== 2 ||
  r2CreateOperation.post_state_user_token_count !== 0 ||
  r2CreateOperation.no_account_wide_or_wildcard_or_other_bucket_or_prefix_claim !== true ||
  r2CreateOperation.max_attempts !== 1 ||
  r2CreateOperation.ambiguous_result !==
    "hard stop and manual readback; no retry, rotation, deletion, or second new token"
)
  fail("R2_OPERATION_SCOPE");

const protectedStorageOperation = proposal.ordered_operations[5];
exactKeys(
  protectedStorageOperation,
  [
    "order",
    "id",
    "provider",
    "kind",
    "mutation",
    "requires_user_approval",
    "directory_environment_name",
    "directory_mode",
    "file_mode",
    "path_must_not_be_repository_or_evidence",
    "directory_creation",
    "file_creation",
    "file_names",
    "precondition",
    "receipt_environment_name",
    "receipt_file_name",
    "receipt_mode",
    "receipt_parent_directory_mode",
    "receipt_path_must_not_be_repository_or_evidence",
    "receipt_secret_free",
    "no_raw_values_in_logs_or_receipt",
    "no_overwrite_or_rotation",
    "runpod_calls",
    "gpu_hours",
    "spend_usd"
  ],
  "PROTECTED_STORAGE_OPERATION_KEYS"
);
if (
  protectedStorageOperation.provider !== "local_protected_storage" ||
  protectedStorageOperation.kind !== "WRITE_EXACTLY_FOUR_HASH_BOUND_MODE_0600_FILES" ||
  protectedStorageOperation.mutation !== true ||
  protectedStorageOperation.requires_user_approval !== true ||
  protectedStorageOperation.directory_environment_name !==
    "VIDEOFORGE_V2_13_SECRET_INPUT_DIR" ||
  protectedStorageOperation.directory_mode !== "0700" ||
  protectedStorageOperation.file_mode !== "0600" ||
  protectedStorageOperation.path_must_not_be_repository_or_evidence !== true ||
  protectedStorageOperation.directory_creation !== "CREATE_NEW_DIRECTLY_WITH_MODE_0700" ||
  protectedStorageOperation.file_creation !==
    "CREATE_NEW_DIRECTLY_WITH_MODE_0600_NO_TEMP_OR_RENAME" ||
  !isStringArray(protectedStorageOperation.file_names) ||
  JSON.stringify(protectedStorageOperation.file_names) !==
    JSON.stringify(["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]) ||
  !protectedStorageOperation.precondition.includes("target files absent") ||
  protectedStorageOperation.receipt_environment_name !==
    "VIDEOFORGE_V2_13_CREDENTIAL_BOOTSTRAP_RECEIPT_FILE" ||
  protectedStorageOperation.receipt_file_name !== "credential-bootstrap.json" ||
  protectedStorageOperation.receipt_mode !== "0600" ||
  protectedStorageOperation.receipt_parent_directory_mode !== "0700" ||
  protectedStorageOperation.receipt_path_must_not_be_repository_or_evidence !== true ||
  protectedStorageOperation.receipt_secret_free !== true ||
  protectedStorageOperation.no_raw_values_in_logs_or_receipt !== true ||
  protectedStorageOperation.no_overwrite_or_rotation !== true
)
  fail("PROTECTED_STORAGE_OPERATION");

const receiptOperation = proposal.ordered_operations[6];
exactKeys(
  receiptOperation,
  [
    "order",
    "id",
    "provider",
    "kind",
    "mutation",
    "requires_user_approval",
    "readback",
    "receipt_schema",
    "receipt_environment_name",
    "receipt_file_name",
    "receipt_file_mode",
    "receipt_parent_directory_mode",
    "receipt_path_must_not_be_repository_or_evidence",
    "receipt_secret_free",
    "receipt_exact_fields",
    "post_state_account_api_token_count",
    "post_state_user_token_count",
    "scope_mismatch",
    "runpod_calls",
    "gpu_hours",
    "spend_usd"
  ],
  "RECEIPT_OPERATION_KEYS"
);
if (
  receiptOperation.provider !== "google_and_cloudflare_r2" ||
  receiptOperation.kind !== "READBACK_AND_SECRET_FREE_RECEIPT" ||
  receiptOperation.mutation !== true ||
  receiptOperation.requires_user_approval !== true ||
  !receiptOperation.readback.includes("protected file hashes") ||
  receiptOperation.receipt_schema !== "videoforge.v2-13-credential-bootstrap-result/v1" ||
  receiptOperation.receipt_environment_name !==
    "VIDEOFORGE_V2_13_CREDENTIAL_BOOTSTRAP_RECEIPT_FILE" ||
  receiptOperation.receipt_file_name !== "credential-bootstrap.json" ||
  receiptOperation.receipt_file_mode !== "0600" ||
  receiptOperation.receipt_parent_directory_mode !== "0700" ||
  receiptOperation.receipt_path_must_not_be_repository_or_evidence !== true ||
  receiptOperation.receipt_secret_free !== true ||
  receiptOperation.post_state_account_api_token_count !== 2 ||
  receiptOperation.post_state_user_token_count !== 0 ||
  receiptOperation.scope_mismatch !==
    "hard stop; no rotation, deletion, retry, or second resource"
)
  fail("RECEIPT_OPERATION");
same(receiptOperation.receipt_exact_fields, receipt.exact_fields, "RECEIPT_OPERATION_FIELDS");

if (!Array.isArray(proposal.stop_conditions) || proposal.stop_conditions.length < 10)
  fail("STOP_CONDITIONS");
for (const marker of [
  "project create, delete, rename, transfer",
  "OAuth client",
  "target production credential",
  "RunPod call",
  "provider response is ambiguous"
])
  includes(proposal.stop_conditions, marker, "STOP_CONDITION");

const approval = proposal.approval_request;
exactKeys(
  approval,
  [
    "fresh_exact_approval_required",
    "approval_ineligible_until_read_only_evidence_bound",
    "requested_exact_action",
    "reuse_project_id",
    "oauth_callback",
    "r2_account_id",
    "r2_bucket_name",
    "existing_staging_r2_credential_name",
    "new_production_r2_credential_name",
    "new_production_r2_credential_name_sha256",
    "distinct_production_r2_credential_binding_required",
    "maximum_cumulative_runpod_spend_usd",
    "maximum_gpu_hours",
    "maximum_external_spend_usd",
    "single_use",
    "no_alternate_project_or_deletion",
    "temporary_compute_drain_required"
  ],
  "APPROVAL_KEYS"
);
if (
  approval.fresh_exact_approval_required !== true ||
  approval.approval_ineligible_until_read_only_evidence_bound !== false ||
  approval.reuse_project_id !== "adroit-archive-329710" ||
  approval.oauth_callback !==
    "https://videoforge-production-runtime.lakshmansai121.workers.dev/api/auth/callback/google" ||
  approval.r2_account_id !== "f9254d773a3426fcb469451b1f965d8c" ||
  approval.r2_bucket_name !== "videoforge-v2-06-staging-private" ||
  approval.existing_staging_r2_credential_name !==
    "VideoForge V2-06 staging private objects rotated" ||
  approval.new_production_r2_credential_name !==
    "VideoForge V2-13 production private objects" ||
  approval.new_production_r2_credential_name_sha256 !==
    "sha256:4ee1c2b2ca4586f0253b728996a8b326453baff12f4879c2c559a698ed13ce67" ||
  approval.distinct_production_r2_credential_binding_required !== true ||
  approval.maximum_cumulative_runpod_spend_usd !== 0 ||
  approval.maximum_gpu_hours !== 0 ||
  approval.maximum_external_spend_usd !== 0 ||
  approval.single_use !== true ||
  approval.no_alternate_project_or_deletion !== true ||
  approval.temporary_compute_drain_required !== true ||
  !approval.requested_exact_action.includes("reuses only Google project adroit-archive-329710") ||
  !approval.requested_exact_action.includes("no project, billing, API, access")
)
  fail("APPROVAL_SCOPE");

const sideEffect = proposal.unexpected_provider_side_effect;
exactKeys(
  sideEffect,
  [
    "status",
    "provider",
    "trigger",
    "mutation",
    "authorized",
    "operation",
    "api_inventory_count_before",
    "api_inventory_count_after",
    "newly_enabled_api_names",
    "newly_enabled_api_services",
    "resources_created",
    "billing_account_associated",
    "paid_spend_usd",
    "credential_accessed",
    "disable_or_rollback_authorized",
    "further_provider_actions_authorized",
    "must_not_be_concealed",
    "requires_independent_safety_verdict",
    "full_final_api_inventory_bound",
    "evidence_path",
    "evidence_sha256"
  ],
  "SIDE_EFFECT_KEYS"
);
if (
  sideEffect.status !== "OBSERVED_OUTSIDE_APPROVAL_INDEPENDENTLY_REVIEWED_AND_CONTAINED" ||
  sideEffect.provider !== "google" ||
  !sideEffect.trigger.includes("Firestore inventory page") ||
  sideEffect.mutation !== true ||
  sideEffect.authorized !== false ||
  sideEffect.operation !== "AUTOMATICALLY_ENABLE_CLOUD_FIRESTORE_AND_FIREBASE_RULES_APIS" ||
  sideEffect.api_inventory_count_before !== 13 ||
  sideEffect.api_inventory_count_after !== 15 ||
  JSON.stringify(sideEffect.newly_enabled_api_names) !==
    JSON.stringify(["Cloud Firestore API", "Firebase Rules API"]) ||
  JSON.stringify(sideEffect.newly_enabled_api_services) !==
    JSON.stringify(["firestore.googleapis.com", "firebaserules.googleapis.com"]) ||
  sideEffect.resources_created !== false ||
  sideEffect.billing_account_associated !== false ||
  sideEffect.paid_spend_usd !== 0 ||
  sideEffect.credential_accessed !== false ||
  sideEffect.disable_or_rollback_authorized !== false ||
  sideEffect.further_provider_actions_authorized !== false ||
  sideEffect.must_not_be_concealed !== true ||
  sideEffect.requires_independent_safety_verdict !== false ||
  sideEffect.full_final_api_inventory_bound !== true ||
  sideEffect.evidence_path !==
    "project-context/evidence/acceptance/VF-10-13/2026-08-27-credential-bootstrap-reuse-adroit-archive-candidate/unexpected-firestore-api-enablement-incident.json" ||
  sideEffect.evidence_sha256 !==
    "sha256:936117ccc777b37d6e6ee595c8d8feccb4fbd026e11d7705084af03230db2229"
)
  fail("UNEXPECTED_PROVIDER_SIDE_EFFECT");

exactKeys(
  proposal.independent_safety_verdict,
  [
    "status",
    "provider_free",
    "incident_contained",
    "incident_rollback_required",
    "further_api_enablement_authorized",
    "api_disablement_authorized",
    "reason"
  ],
  "SAFETY_VERDICT_KEYS"
);
if (
  proposal.independent_safety_verdict.status !==
    "PASS_REUSE_SAFE_ONLY_UNDER_EXACT_FRESH_APPROVAL_AND_STOP_CONDITIONS" ||
  proposal.independent_safety_verdict.provider_free !== true ||
  proposal.independent_safety_verdict.incident_contained !== true ||
  proposal.independent_safety_verdict.incident_rollback_required !== false ||
  proposal.independent_safety_verdict.further_api_enablement_authorized !== false ||
  proposal.independent_safety_verdict.api_disablement_authorized !== false
)
  fail("SAFETY_VERDICT");

process.stdout.write(
  `${JSON.stringify({
    status: "PASS_SEALED_AWAITING_FRESH_EXACT_APPROVAL",
    proposal_sha256: sha256(bytes),
    authority: "ABSENT_UNCONSUMED_NO_MUTATION",
    executable_graph: true,
    provider_calls: 0,
    provider_mutations: 1,
    credential_access: 0,
    runpod_calls: 0,
    gpu_hours: 0,
    external_spend_usd: 0
  })}\n`
);

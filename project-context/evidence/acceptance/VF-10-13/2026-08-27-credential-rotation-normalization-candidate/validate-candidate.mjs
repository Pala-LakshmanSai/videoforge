import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const proposalPath = resolve(directory, "combined-credential-rotation-normalization-proposal.json");
const proposalSha256 = "sha256:76f14ae25cff7840d0028be1ca0af87bbf325178d99a5ca2b80806aa3ddb2c73";
const sourceCommit = "3f7b588de4b96da7c1e56b6c1908df7381712710";
const priorProposalSha256 = "sha256:90d6b19d6935ded1bfebdb6df53c64ea33edeba4dce750fe3a81b93708228ed4";
const priorAuthorityId = "v2-13-credential-bootstrap-reuse-20260827-082652z-90d6b19d";
const priorAuthorityStatus = "CONSUMED_STOPPED_AFTER_RESOURCE_CREATION_REQUIRES_FRESH_ROTATION_AUTHORITY";
const priorResultSha256 = "sha256:b604579fcbf412468525c1fd3483235681fed6425cba7948c585356d3c009909";
const priorIncidentSha256 = "sha256:6afa7d32f4eaf1c625a1c788304694cfb6219a06a03d51bf9802535a0465e07f";
const oldSecretSha256 = "sha256:86bb8e2861781a66595c3d204c7cadc4fd9e32cda2347752bec08821740e06e6";
const clientIdSha256 = "sha256:0150569d559bc69055805f48be9d54e9748a1fa34e6dffa6c293701b9814d932";
const r2AccessStoredSha256 = "sha256:183c83dade1e32a1f732e35672ef9d751abbd6ef66a4f547463f448002050de0";
const r2SecretStoredSha256 = "sha256:d9c2239ae9d60be925dff87236f3bb334d8fb6ea992b62ac9586f4c8fa7159b2";
const r2AccessCanonicalSha256 = "sha256:a322bcb37f84d28ddd0fd841f0eb3ad2feaf368f71c21deece4f9d1f8433e335";
const r2SecretCanonicalSha256 = "sha256:227e83b53468d6053b983a844473e04cbde8eff81c27b499127f106c394a900e";
const resultPath = "project-context/evidence/acceptance/VF-10-13/2026-08-27-credential-rotation-normalization-candidate/credential-rotation-normalization-execution-result.json";
const receiptPath = "~/.videoforge/v2-13/bootstrap/receipt/credential-bootstrap.json";
const sourcePaths = [
  "apps/web/src/server/hosted/auth.ts",
  "apps/web/src/server/hosted/r2.ts",
  "packages/control-plane/src/auth/better-auth-google.ts",
];
const sourceHashes = {
  "apps/web/src/server/hosted/auth.ts": "sha256:ec4a23723f24139ea8d96a05a3932fd528188abab214e327a159b1297e848308",
  "apps/web/src/server/hosted/r2.ts": "sha256:473026cd897b6bd45df0a10d3ecff5b3705cafd6dd421924ea2114ad532baa71",
  "packages/control-plane/src/auth/better-auth-google.ts": "sha256:f674d92c96186ff7618e0ef6d58cd9b59c0d4a6462fd707c765f0eb18cf25d7f",
};
const operationIds = [
  "credential-rotation-normalization-fresh-exact-preflight",
  "credential-rotation-normalization-r2-remove-one-trailing-lf",
  "credential-rotation-google-add-one-client-secret",
  "credential-rotation-google-atomically-replace-secret-file",
  "credential-rotation-google-revoke-one-exposed-old-secret",
  "credential-rotation-normalization-refresh-secret-free-receipt",
  "credential-rotation-normalization-final-exact-readback",
];
const receiptFields = [
  "schema_version", "source_commit", "google_authenticated_account_sha256", "google_project_id",
  "google_project_id_sha256", "google_project_number_sha256", "google_oauth_client_id_sha256",
  "google_oauth_client_secret_sha256", "google_redirect_uris_canonical_sha256",
  "google_javascript_origins_canonical_sha256", "cloudflare_account_id_sha256", "r2_bucket_name_sha256",
  "r2_permission_group", "r2_credential_type", "r2_credential_lifetime",
  "r2_credential_expiration_policy", "r2_credential_expiration_at", "r2_access_key_id_sha256",
  "r2_secret_access_key_sha256", "application_key_grammar", "runpod_calls", "gpu_hours",
  "external_spend_usd",
];
const hashPattern = /^sha256:[0-9a-f]{64}$/u;
const hash = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const fail = (code) => {
  throw new Error(`V2_13_CREDENTIAL_ROTATION_NORMALIZATION_${code}`);
};
const equal = (actual, expected, code) => {
  if (actual !== expected) fail(code);
};
const same = (actual, expected, code) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(code);
};
const exactKeys = (value, expected, code) => {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())
  )
    fail(code);
};
const trueValue = (value, code) => equal(value, true, code);
const falseValue = (value, code) => equal(value, false, code);

const proposalBytes = await readFile(proposalPath);
if (proposalBytes.at(-1) !== 0x0a) fail("FINAL_NEWLINE");
const proposal = JSON.parse(proposalBytes);
equal(hash(proposalBytes), proposalSha256, "PROPOSAL_HASH");

exactKeys(proposal, [
  "schema_version", "task_id", "candidate_date", "proposal_status", "sealing", "supersession",
  "source", "authority", "prior_execution_binding", "current_identity", "requested_scope",
  "receipt", "exact_execution_graph", "stop_conditions", "provider_free_audit", "approval_request",
  "independent_safety_verdict",
], "ROOT_KEYS");
equal(proposal.schema_version, "videoforge.v2-13-credential-rotation-normalization-proposal/v1", "SCHEMA");
equal(proposal.task_id, "VF-10-13-CREDENTIAL-ROTATION-NORMALIZATION", "TASK");
equal(proposal.candidate_date, "2026-08-27", "DATE");
equal(proposal.proposal_status, "PASS_SEALED_AWAITING_FRESH_EXACT_APPROVAL", "STATUS");

exactKeys(proposal.sealing, [
  "sealed_for_exact_user_approval", "current_bytes_are_approval_ineligible",
  "provider_free_audit_base_commit", "required_next_action",
], "SEALING_KEYS");
trueValue(proposal.sealing.sealed_for_exact_user_approval, "SEALING_BOUND");
falseValue(proposal.sealing.current_bytes_are_approval_ineligible, "SEALING_ELIGIBLE");
equal(proposal.sealing.provider_free_audit_base_commit, "fb9ca56af6121f014c9766b96f082590747bcf1c", "SEALING_COMMIT");
if (!proposal.sealing.required_next_action.includes("fresh exact user approval")) fail("SEALING_NEXT");

exactKeys(proposal.supersession, [
  "supersedes_proposal_path", "supersedes_proposal_sha256", "superseded_authority_id",
  "superseded_authority_status", "superseded_execution_result_sha256", "superseded_incident_sha256",
  "prior_authority_reusable", "replacement_reason",
], "SUPERSESSION_KEYS");
equal(proposal.supersession.supersedes_proposal_sha256, priorProposalSha256, "SUPERSESSION_PROPOSAL");
equal(proposal.supersession.superseded_authority_id, priorAuthorityId, "SUPERSESSION_AUTHORITY");
equal(proposal.supersession.superseded_authority_status, priorAuthorityStatus, "SUPERSESSION_STATUS");
equal(proposal.supersession.superseded_execution_result_sha256, priorResultSha256, "SUPERSESSION_RESULT");
equal(proposal.supersession.superseded_incident_sha256, priorIncidentSha256, "SUPERSESSION_INCIDENT");
falseValue(proposal.supersession.prior_authority_reusable, "SUPERSESSION_REUSABLE");

exactKeys(proposal.source, [
  "release_source_commit", "binding", "branch", "required_clean_worktree",
  "source_hashes_bound", "source_contract_paths", "source_contract_hashes",
], "SOURCE_KEYS");
equal(proposal.source.release_source_commit, sourceCommit, "SOURCE_COMMIT");
equal(proposal.source.binding, "EXACT_CLEAN_GIT_COMMIT", "SOURCE_BINDING");
equal(proposal.source.branch, "codex/serverless-v2-roadmap", "SOURCE_BRANCH");
trueValue(proposal.source.required_clean_worktree, "SOURCE_CLEAN");
trueValue(proposal.source.source_hashes_bound, "SOURCE_HASH_BOUND");
same(proposal.source.source_contract_paths, sourcePaths, "SOURCE_PATHS");
exactKeys(proposal.source.source_contract_hashes, sourcePaths, "SOURCE_HASH_KEYS");
let repositoryRoot;
for (const candidate of [directory, process.cwd()]) {
  if (repositoryRoot) break;
  try {
    repositoryRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: candidate, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {}
}
if (!repositoryRoot) fail("SOURCE_ROOT");
for (const sourcePath of sourcePaths) {
  equal(proposal.source.source_contract_hashes[sourcePath], sourceHashes[sourcePath], `SOURCE_BINDING_${sourcePath}`);
  let sourceBytes;
  try {
    sourceBytes = execFileSync("git", ["show", `${sourceCommit}:${sourcePath}`], {
      cwd: repositoryRoot, stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    fail("SOURCE_READ");
  }
  equal(hash(sourceBytes), sourceHashes[sourcePath], `SOURCE_CONTENT_${sourcePath}`);
}

const authorityKeys = [
  "single_use", "exact_proposal_approved", "authority_id", "approval_sha256", "approved_at",
  "expires_at", "consumed", "credential_access_authorized", "google_secret_rotation_authorized",
  "google_old_secret_revoke_authorized", "google_project_or_oauth_config_mutation_authorized",
  "cloudflare_r2_mutation_authorized", "protected_storage_normalization_authorized",
  "provider_calls_authorized", "provider_mutations_authorized", "runpod_calls_authorized",
  "gpu_use_authorized", "external_spend_authorized", "redispatch_authorized",
];
exactKeys(proposal.authority, authorityKeys, "AUTHORITY_KEYS");
trueValue(proposal.authority.single_use, "AUTHORITY_SINGLE_USE");
for (const [key, value] of Object.entries(proposal.authority)) {
  if (key !== "single_use" && value !== false && value !== null) fail(`AUTHORITY_${key}`);
}

exactKeys(proposal.prior_execution_binding, [
  "prior_result_path", "prior_result_sha256", "secret_exposure_incident_path",
  "secret_exposure_incident_sha256", "old_exposed_google_client_secret_sha256",
  "current_google_client_id_sha256", "current_r2_access_key_stored_bytes_sha256",
  "current_r2_secret_stored_bytes_sha256", "current_r2_access_key_canonical_sha256",
  "current_r2_secret_canonical_sha256", "r2_trailing_lf_count_per_affected_file",
  "google_client_id_and_oauth_config_must_remain_unchanged",
  "cloudflare_credentials_and_bucket_must_remain_unchanged",
], "PRIOR_KEYS");
for (const [field, expected] of [
  ["prior_result_sha256", priorResultSha256],
  ["secret_exposure_incident_sha256", priorIncidentSha256],
  ["old_exposed_google_client_secret_sha256", oldSecretSha256],
  ["current_google_client_id_sha256", clientIdSha256],
  ["current_r2_access_key_stored_bytes_sha256", r2AccessStoredSha256],
  ["current_r2_secret_stored_bytes_sha256", r2SecretStoredSha256],
  ["current_r2_access_key_canonical_sha256", r2AccessCanonicalSha256],
  ["current_r2_secret_canonical_sha256", r2SecretCanonicalSha256],
]) equal(proposal.prior_execution_binding[field], expected, `PRIOR_${field}`);
equal(proposal.prior_execution_binding.r2_trailing_lf_count_per_affected_file, 1, "PRIOR_LF_COUNT");
trueValue(proposal.prior_execution_binding.google_client_id_and_oauth_config_must_remain_unchanged, "PRIOR_GOOGLE_IMMUTABLE");
trueValue(proposal.prior_execution_binding.cloudflare_credentials_and_bucket_must_remain_unchanged, "PRIOR_R2_IMMUTABLE");

const identity = proposal.current_identity;
exactKeys(identity, [
  "google_project_id", "google_project_number", "google_project_number_sha256", "google_oauth_client_id_sha256",
  "google_oauth_application_name", "google_oauth_audience", "google_oauth_publishing_status",
  "google_oauth_test_user_count", "google_oauth_client_type", "google_oauth_authorized_redirect_uri_sha256",
  "google_oauth_javascript_origin_count", "google_oauth_client_count", "google_oauth_config_mutation_authorized",
  "cloudflare_account_id", "cloudflare_bucket_name", "cloudflare_bucket_only_credential_name",
  "cloudflare_credential_mutation_authorized", "cloudflare_staging_credential_preserved",
  "runpod_calls_authorized", "gpu_use_authorized", "external_spend_authorized_usd",
], "IDENTITY_KEYS");
for (const [field, expected] of [
  ["google_project_id", "adroit-archive-329710"],
  ["google_project_number", "984657838923"],
  ["google_project_number_sha256", "sha256:41ed11c7873b8727019969683f8063652a949a9a899a3b6b7d126135ea2c6347"],
  ["google_oauth_client_id_sha256", clientIdSha256],
  ["google_oauth_application_name", "VideoForge"],
  ["google_oauth_audience", "EXTERNAL_TESTING"],
  ["google_oauth_publishing_status", "TESTING"],
  ["google_oauth_client_type", "WEB"],
  ["google_oauth_authorized_redirect_uri_sha256", "sha256:fb41ba23e86209bece0299efc81fec50febf2bd8774c1712fd77aa8d8b447c0d"],
  ["cloudflare_account_id", "f9254d773a3426fcb469451b1f965d8c"],
  ["cloudflare_bucket_name", "videoforge-v2-06-staging-private"],
  ["cloudflare_bucket_only_credential_name", "VideoForge V2-13 production private objects"],
]) equal(identity[field], expected, `IDENTITY_${field}`);
equal(identity.google_oauth_test_user_count, 2, "IDENTITY_USERS");
equal(identity.google_oauth_javascript_origin_count, 0, "IDENTITY_ORIGINS");
equal(identity.google_oauth_client_count, 1, "IDENTITY_CLIENT_COUNT");
for (const field of ["google_oauth_config_mutation_authorized", "cloudflare_credential_mutation_authorized", "runpod_calls_authorized", "gpu_use_authorized"]) falseValue(identity[field], `IDENTITY_${field}`);
trueValue(identity.cloudflare_staging_credential_preserved, "IDENTITY_STAGING");
equal(identity.external_spend_authorized_usd, 0, "IDENTITY_SPEND");

const scope = proposal.requested_scope;
exactKeys(scope, [
  "execution_mode", "single_use", "provider_calls_authorized_after_fresh_approval",
  "google_provider_mutations_authorized_after_fresh_approval", "cloudflare_provider_calls_authorized",
  "cloudflare_provider_mutations_authorized", "runpod_calls_authorized", "gpu_use_authorized",
  "external_spend_authorized_usd", "database_mutation_authorized", "deployment_authorized",
  "google", "local_protected_storage",
], "SCOPE_KEYS");
equal(scope.execution_mode, "GOOGLE_SECRET_ROTATION_AND_LOCAL_R2_NORMALIZATION_ONLY", "SCOPE_MODE");
trueValue(scope.single_use, "SCOPE_SINGLE_USE");
trueValue(scope.provider_calls_authorized_after_fresh_approval, "SCOPE_PROVIDER_CALLS");
trueValue(scope.google_provider_mutations_authorized_after_fresh_approval, "SCOPE_GOOGLE_MUTATION");
for (const field of ["cloudflare_provider_calls_authorized", "cloudflare_provider_mutations_authorized", "runpod_calls_authorized", "gpu_use_authorized", "database_mutation_authorized", "deployment_authorized"]) falseValue(scope[field], `SCOPE_${field}`);
equal(scope.external_spend_authorized_usd, 0, "SCOPE_SPEND");

const google = scope.google;
exactKeys(google, [
  "reuse_only_existing_project_id", "reuse_only_existing_project_number", "same_web_client_only",
  "client_id_sha256", "add_exactly_one_new_client_secret", "new_secret_hash_bound_only_after_execution",
  "old_exposed_secret_sha256", "capture_raw_new_secret_in_memory_or_protected_fd_only",
  "raw_new_secret_stdout_authorized", "raw_new_secret_stderr_authorized", "raw_new_secret_logs_authorized",
  "raw_new_secret_repository_or_receipt_authorized", "atomic_google_secret_file_replacement_required",
  "new_file_must_be_secured_and_hash_read_back_before_old_revoke", "revoke_only_exact_old_exposed_secret",
  "old_revoke_target_must_match_hash_bound_descriptor", "old_revoke_before_new_file_readback_authorized",
  "oauth_config_mutation_authorized", "additional_client_or_secret_authorized",
  "test_user_or_scope_mutation_authorized", "project_or_billing_mutation_authorized",
  "api_enablement_or_disablement_authorized",
], "GOOGLE_SCOPE_KEYS");
equal(google.reuse_only_existing_project_id, "adroit-archive-329710", "GOOGLE_PROJECT");
equal(google.reuse_only_existing_project_number, "984657838923", "GOOGLE_NUMBER");
trueValue(google.same_web_client_only, "GOOGLE_CLIENT");
equal(google.client_id_sha256, clientIdSha256, "GOOGLE_CLIENT_HASH");
trueValue(google.add_exactly_one_new_client_secret, "GOOGLE_NEW_SECRET");
trueValue(google.new_secret_hash_bound_only_after_execution, "GOOGLE_NEW_HASH");
equal(google.old_exposed_secret_sha256, oldSecretSha256, "GOOGLE_OLD_HASH");
for (const field of ["capture_raw_new_secret_in_memory_or_protected_fd_only", "atomic_google_secret_file_replacement_required", "new_file_must_be_secured_and_hash_read_back_before_old_revoke", "revoke_only_exact_old_exposed_secret", "old_revoke_target_must_match_hash_bound_descriptor"]) trueValue(google[field], `GOOGLE_${field}`);
for (const field of ["raw_new_secret_stdout_authorized", "raw_new_secret_stderr_authorized", "raw_new_secret_logs_authorized", "raw_new_secret_repository_or_receipt_authorized", "old_revoke_before_new_file_readback_authorized", "oauth_config_mutation_authorized", "additional_client_or_secret_authorized", "test_user_or_scope_mutation_authorized", "project_or_billing_mutation_authorized", "api_enablement_or_disablement_authorized"]) falseValue(google[field], `GOOGLE_${field}`);

const storage = scope.local_protected_storage;
exactKeys(storage, [
  "directory_path", "directory_mode", "file_mode", "exact_file_names", "google_client_id_must_be_unchanged",
  "normalize_exactly_one_trailing_lf_from_r2_access_key", "normalize_exactly_one_trailing_lf_from_r2_secret",
  "r2_normalization_is_local_only", "r2_provider_mutation_authorized", "no_other_file_change_authorized",
  "atomic_replacement_required", "receipt_path", "receipt_parent_directory_mode", "receipt_mode",
  "receipt_secret_free",
], "STORAGE_KEYS");
equal(storage.directory_path, "~/.videoforge/v2-13/bootstrap/secrets", "STORAGE_PATH");
equal(storage.directory_mode, "0700", "STORAGE_DIR_MODE");
equal(storage.file_mode, "0600", "STORAGE_FILE_MODE");
same(storage.exact_file_names, ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"], "STORAGE_FILES");
for (const field of ["google_client_id_must_be_unchanged", "normalize_exactly_one_trailing_lf_from_r2_access_key", "normalize_exactly_one_trailing_lf_from_r2_secret", "r2_normalization_is_local_only", "no_other_file_change_authorized", "atomic_replacement_required", "receipt_secret_free"]) trueValue(storage[field], `STORAGE_${field}`);
falseValue(storage.r2_provider_mutation_authorized, "STORAGE_R2_PROVIDER");
equal(storage.receipt_path, receiptPath, "STORAGE_RECEIPT_PATH");
equal(storage.receipt_parent_directory_mode, "0700", "STORAGE_RECEIPT_PARENT_MODE");
equal(storage.receipt_mode, "0600", "STORAGE_RECEIPT_MODE");

exactKeys(proposal.receipt, [
  "schema_version", "exact_field_count", "exact_fields", "receipt_path", "receipt_parent_directory_mode",
  "receipt_mode", "secret_free", "google_oauth_client_id_sha256_unchanged",
  "google_oauth_client_secret_sha256_must_differ_from_old", "r2_access_key_id_sha256_unchanged_canonical",
  "r2_secret_access_key_sha256_unchanged_canonical", "runpod_calls", "gpu_hours", "external_spend_usd",
], "RECEIPT_KEYS");
equal(proposal.receipt.schema_version, "videoforge.v2-13-credential-bootstrap-result/v1", "RECEIPT_SCHEMA");
equal(proposal.receipt.exact_field_count, 23, "RECEIPT_COUNT");
same(proposal.receipt.exact_fields, receiptFields, "RECEIPT_FIELDS");
equal(proposal.receipt.receipt_path, receiptPath, "RECEIPT_PATH");
equal(proposal.receipt.receipt_parent_directory_mode, "0700", "RECEIPT_PARENT_MODE");
equal(proposal.receipt.receipt_mode, "0600", "RECEIPT_MODE");
for (const field of ["secret_free", "google_oauth_client_id_sha256_unchanged", "google_oauth_client_secret_sha256_must_differ_from_old", "r2_access_key_id_sha256_unchanged_canonical", "r2_secret_access_key_sha256_unchanged_canonical"]) trueValue(proposal.receipt[field], `RECEIPT_${field}`);
for (const field of ["runpod_calls", "gpu_hours", "external_spend_usd"]) equal(proposal.receipt[field], 0, `RECEIPT_${field}`);

const graph = proposal.exact_execution_graph;
exactKeys(graph, ["operation_count", "all_and_only_operations", "no_retry_or_redispatch", "operations"], "GRAPH_KEYS");
equal(graph.operation_count, operationIds.length, "GRAPH_COUNT");
trueValue(graph.all_and_only_operations, "GRAPH_SCOPE");
trueValue(graph.no_retry_or_redispatch, "GRAPH_RETRY");
equal(graph.operations.length, operationIds.length, "GRAPH_LENGTH");
same(graph.operations.map((operation) => operation.operation_id), operationIds, "GRAPH_ORDER");
const operationKeySets = [
  ["order", "operation_id", "kind", "provider_mutation", "credential_value_output", "requires_fresh_approval"],
  ["order", "operation_id", "kind", "provider_mutation", "files", "requires_exact_preflight_hashes"],
  ["order", "operation_id", "kind", "provider_mutation", "count", "same_client_only", "raw_capture"],
  ["order", "operation_id", "kind", "provider_mutation", "file", "mode"],
  ["order", "operation_id", "kind", "provider_mutation", "count", "target", "requires_secure_new_file_readback"],
  ["order", "operation_id", "kind", "provider_mutation", "exact_field_count", "secret_free", "requires_new_secret_hash"],
  ["order", "operation_id", "kind", "provider_mutation", "requires_zero_runpod_gpu_spend", "requires_no_other_file_or_resource_change"],
];
for (const [index, operation] of graph.operations.entries()) {
  equal(operation.order, index + 1, `GRAPH_OPERATION_${index + 1}_ORDER`);
  exactKeys(operation, operationKeySets[index], `GRAPH_OPERATION_${index + 1}_KEYS`);
}
falseValue(graph.operations[0].provider_mutation, "GRAPH_PREFLIGHT_MUTATION");
falseValue(graph.operations[0].credential_value_output, "GRAPH_PREFLIGHT_OUTPUT");
trueValue(graph.operations[0].requires_fresh_approval, "GRAPH_PREFLIGHT_APPROVAL");
same(graph.operations[1].files, ["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"], "GRAPH_R2_FILES");
falseValue(graph.operations[1].provider_mutation, "GRAPH_R2_PROVIDER");
trueValue(graph.operations[1].requires_exact_preflight_hashes, "GRAPH_R2_HASHES");
trueValue(graph.operations[2].provider_mutation, "GRAPH_ADD_PROVIDER");
equal(graph.operations[2].count, 1, "GRAPH_ADD_COUNT");
trueValue(graph.operations[2].same_client_only, "GRAPH_ADD_CLIENT");
equal(graph.operations[2].raw_capture, "IN_MEMORY_OR_PROTECTED_FD_ONLY", "GRAPH_ADD_CAPTURE");
falseValue(graph.operations[3].provider_mutation, "GRAPH_FILE_PROVIDER");
equal(graph.operations[3].file, "GOOGLE_CLIENT_SECRET", "GRAPH_FILE_NAME");
equal(graph.operations[3].mode, "0600", "GRAPH_FILE_MODE");
trueValue(graph.operations[4].provider_mutation, "GRAPH_REVOKE_PROVIDER");
equal(graph.operations[4].count, 1, "GRAPH_REVOKE_COUNT");
equal(graph.operations[4].target, "OLD_EXPOSED_SECRET_HASH_BOUND_DESCRIPTOR_ONLY", "GRAPH_REVOKE_TARGET");
trueValue(graph.operations[4].requires_secure_new_file_readback, "GRAPH_REVOKE_ORDER");
falseValue(graph.operations[5].provider_mutation, "GRAPH_RECEIPT_PROVIDER");
equal(graph.operations[5].exact_field_count, 23, "GRAPH_RECEIPT_COUNT");
trueValue(graph.operations[5].secret_free, "GRAPH_RECEIPT_SECRET_FREE");
trueValue(graph.operations[5].requires_new_secret_hash, "GRAPH_RECEIPT_HASH");
falseValue(graph.operations[6].provider_mutation, "GRAPH_FINAL_PROVIDER");
trueValue(graph.operations[6].requires_zero_runpod_gpu_spend, "GRAPH_FINAL_ZERO");
trueValue(graph.operations[6].requires_no_other_file_or_resource_change, "GRAPH_FINAL_SCOPE");

const stop = proposal.stop_conditions;
const stopKeys = [
  "stop_on_any_project_client_oauth_config_drift", "stop_on_old_secret_descriptor_hash_ambiguity",
  "stop_on_new_secret_raw_output_or_log_exposure", "stop_on_new_secret_capture_or_provider_result_ambiguity",
  "stop_on_new_secret_file_hash_or_mode_mismatch", "stop_on_r2_file_hash_not_exactly_one_trailing_lf",
  "stop_on_any_unexpected_local_file_or_path", "stop_on_receipt_key_hash_or_mode_mismatch",
  "stop_on_cloudflare_mutation_or_unapproved_provider_call", "stop_on_runpod_gpu_spend_or_billing_activity",
  "stop_on_failure_expiry_or_consumption_marker", "no_retry", "no_redispatch",
  "no_delete_or_rotate_any_other_credential", "manual_reconciliation_required_after_partial_google_mutation",
];
exactKeys(stop, stopKeys, "STOP_KEYS");
for (const key of stopKeys) trueValue(stop[key], `STOP_${key}`);

exactKeys(proposal.provider_free_audit, [
  "provider_calls_made_during_drafting", "provider_mutations_made_during_drafting",
  "credential_values_accessed_during_drafting", "runpod_calls_during_drafting",
  "gpu_hours_during_drafting", "external_spend_usd_during_drafting",
  "protected_file_writes_during_drafting", "current_authority_consumed_and_non_reusable",
], "AUDIT_KEYS");
for (const key of ["provider_calls_made_during_drafting", "provider_mutations_made_during_drafting", "runpod_calls_during_drafting", "gpu_hours_during_drafting", "external_spend_usd_during_drafting", "protected_file_writes_during_drafting"]) equal(proposal.provider_free_audit[key], 0, `AUDIT_${key}`);
falseValue(proposal.provider_free_audit.credential_values_accessed_during_drafting, "AUDIT_CREDENTIALS");
trueValue(proposal.provider_free_audit.current_authority_consumed_and_non_reusable, "AUDIT_PRIOR_AUTHORITY");

exactKeys(proposal.approval_request, [
  "fresh_exact_approval_required", "approval_must_name_proposal_sha256_and_containing_commit",
  "approval_must_state_one_single_use_execution", "approval_must_bind_same_project_and_same_web_client",
  "approval_must_bind_one_new_secret_then_secure_readback_then_only_old_secret_revoke",
  "approval_must_bind_local_r2_one_lf_normalization_without_cloudflare_mutation",
  "approval_must_bind_four_files_0700_0600_and_23_field_secret_free_receipt",
  "approval_must_forbid_all_other_provider_or_local_changes",
  "approval_must_forbid_retry_redispatch_and_partial_continuation",
  "approval_must_require_stop_on_raw_output_ambiguity_or_drift", "requested_exact_action",
], "APPROVAL_KEYS");
for (const [key, value] of Object.entries(proposal.approval_request)) if (key !== "requested_exact_action") trueValue(value, `APPROVAL_${key}`);
for (const fragment of ["one single-use", "exact existing Google project", "OAuth client", "exactly one new Google client secret", "without raw output", "atomically replaces", "only the exact exposed old secret", "exactly one trailing LF", "without any Cloudflare mutation", "23-field secret-free receipt", "no other change", "no retry", "redispatch"]) if (!proposal.approval_request.requested_exact_action.includes(fragment)) fail(`APPROVAL_TEXT_${fragment}`);

exactKeys(proposal.independent_safety_verdict, [
  "status", "provider_free", "prior_authority_consumed", "prior_authority_reusable",
  "google_secret_rotation_is_narrowly_bounded", "r2_normalization_is_local_only",
  "cloudflare_mutation_forbidden", "runpod_gpu_spend_forbidden", "reason",
], "VERDICT_KEYS");
equal(proposal.independent_safety_verdict.status, "PASS_PROVIDER_FREE_DRAFT_ONLY_FRESH_EXACT_APPROVAL_REQUIRED", "VERDICT_STATUS");
for (const key of ["provider_free", "prior_authority_consumed", "google_secret_rotation_is_narrowly_bounded", "r2_normalization_is_local_only", "cloudflare_mutation_forbidden", "runpod_gpu_spend_forbidden"]) trueValue(proposal.independent_safety_verdict[key], `VERDICT_${key}`);
falseValue(proposal.independent_safety_verdict.prior_authority_reusable, "VERDICT_REUSABLE");

process.stdout.write(JSON.stringify({
  status: proposal.proposal_status,
  proposal_sha256: proposalSha256,
  source_commit: sourceCommit,
  prior_authority_id: priorAuthorityId,
  prior_authority_reusable: false,
  provider_calls_made_during_drafting: 0,
  provider_mutations_made_during_drafting: 0,
  credential_values_accessed_during_drafting: false,
  runpod_calls_during_drafting: 0,
  gpu_hours_during_drafting: 0,
  external_spend_usd_during_drafting: 0,
}) + "\n");

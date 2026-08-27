import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const resultPath = resolve(directory, "credential-bootstrap-execution-result.json");
const incidentPath = resolve(directory, "credential-bootstrap-secret-exposure-incident.json");
const authorityPath = resolve(directory, "approved-authority.json");
const receiptPath = resolve(homedir(), ".videoforge/v2-13/bootstrap/receipt/credential-bootstrap.json");
const secretDirectory = resolve(homedir(), ".videoforge/v2-13/bootstrap/secrets");
const proposalSha256 =
  "sha256:90d6b19d6935ded1bfebdb6df53c64ea33edeba4dce750fe3a81b93708228ed4";
const authorityId = "v2-13-credential-bootstrap-reuse-20260827-082652z-90d6b19d";
const sourceCommit = "3f7b588de4b96da7c1e56b6c1908df7381712710";
const resultStatus = "STOPPED_AFTER_RESOURCE_CREATION_REQUIRES_FRESH_ROTATION_AUTHORITY";
const authorityStatus = "CONSUMED_STOPPED_AFTER_RESOURCE_CREATION_REQUIRES_FRESH_ROTATION_AUTHORITY";
const fileNames = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"];
const operationIds = [
  "credential-bootstrap-reuse-google-project-preflight",
  "credential-bootstrap-reuse-r2-bucket-and-token-preflight",
  "credential-bootstrap-reuse-google-consent-configure",
  "credential-bootstrap-reuse-google-oauth-web-client-create-one",
  "credential-bootstrap-reuse-r2-production-token-create-one",
  "credential-bootstrap-reuse-protected-storage-write-four",
  "credential-bootstrap-reuse-exact-readback-and-receipt",
];
const receiptKeys = [
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
const resultRelativePath =
  "project-context/evidence/acceptance/VF-10-13/2026-08-27-credential-bootstrap-reuse-adroit-archive-candidate/credential-bootstrap-execution-result.json";
const incidentRelativePath =
  "project-context/evidence/acceptance/VF-10-13/2026-08-27-credential-bootstrap-reuse-adroit-archive-candidate/credential-bootstrap-secret-exposure-incident.json";
const receiptSha256 = "sha256:9ac08caffa5758b14321c7a89ca9c76907a9f001f87adb803b7dabffb1723ea7";
const incidentSha256 = "sha256:6afa7d32f4eaf1c625a1c788304694cfb6219a06a03d51bf9802535a0465e07f";
const hashPattern = /^sha256:[0-9a-f]{64}$/u;
const hash = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const same = (actual, expected, code) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`V2_13_CREDENTIAL_BOOTSTRAP_RESULT_${code}`);
};
const equal = (actual, expected, code) => {
  if (actual !== expected) throw new Error(`V2_13_CREDENTIAL_BOOTSTRAP_RESULT_${code}`);
};
const keys = (value, expected, code) => same(Object.keys(value).sort(), [...expected].sort(), code);
const mode = async (path, expected, code) => equal((await stat(path)).mode & 0o777, expected, code);

const resultBytes = await readFile(resultPath);
const incidentBytes = await readFile(incidentPath);
const authority = JSON.parse(await readFile(authorityPath, "utf8"));
const result = JSON.parse(resultBytes);
const incident = JSON.parse(incidentBytes);
const receipt = JSON.parse(await readFile(receiptPath, "utf8"));

equal(hash(resultBytes), "sha256:b604579fcbf412468525c1fd3483235681fed6425cba7948c585356d3c009909", "RESULT_HASH");
equal(hash(incidentBytes), incidentSha256, "INCIDENT_HASH");
equal(hash(await readFile(receiptPath)), receiptSha256, "RECEIPT_HASH");
keys(result, [
  "schema_version", "checkpoint", "task_id", "attempt", "result", "proposal_sha256", "proposal_commit",
  "release_source_commit", "authority_id", "authority_consumed", "authority_reusable", "recorded_at", "stop",
  "ordered_operations", "provider_readback", "protected_storage", "integration_defect", "receipt", "execution_counters", "secret_hygiene",
  "cleanup", "next_boundary",
], "RESULT_KEYS");
equal(result.schema_version, "videoforge.v2-13-credential-bootstrap-reuse-execution-result/v1", "RESULT_SCHEMA");
equal(result.result, resultStatus, "RESULT_STATUS");
equal(result.proposal_sha256, proposalSha256, "RESULT_PROPOSAL");
equal(result.proposal_commit, "68ea8a0de78ded973c3a007ba2173a24161c8c36", "RESULT_PROPOSAL_COMMIT");
equal(result.release_source_commit, sourceCommit, "RESULT_SOURCE");
equal(result.authority_id, authorityId, "RESULT_AUTHORITY_ID");
equal(result.authority_consumed, true, "RESULT_CONSUMED");
equal(result.authority_reusable, false, "RESULT_REUSABLE");
same(result.ordered_operations.completed_operation_ids, operationIds, "RESULT_OPERATION_ORDER");
equal(result.ordered_operations.all_and_only_approved_operations_started, true, "RESULT_OPERATION_SCOPE");
equal(result.ordered_operations.no_unapproved_operation_started, true, "RESULT_UNAPPROVED_OPERATION");
equal(result.ordered_operations.no_retry_or_redispatch, true, "RESULT_RETRY");
equal(result.stop.code, "RAW_GOOGLE_CLIENT_SECRET_APPEARED_IN_INTERNAL_TOOL_OUTPUT", "RESULT_STOP_CODE");
equal(result.stop.incident_path, incidentRelativePath, "RESULT_INCIDENT_PATH");
equal(result.stop.incident_sha256, incidentSha256, "RESULT_INCIDENT_BINDING");
equal(result.stop.fresh_rotation_authority_required, true, "RESULT_ROTATION_GATE");
equal(result.stop.rotation_authorized_by_this_attempt, false, "RESULT_ROTATION_SCOPE");
equal(result.provider_readback.google.project_id, "adroit-archive-329710", "GOOGLE_PROJECT");
equal(result.provider_readback.google.oauth_application_name, "VideoForge", "GOOGLE_APP");
equal(result.provider_readback.google.oauth_audience, "EXTERNAL_TESTING", "GOOGLE_AUDIENCE");
equal(result.provider_readback.google.oauth_publishing_status, "TESTING", "GOOGLE_STATUS");
same(result.provider_readback.google.test_users, ["lakshmansai121@gmail.com", "demo9gss@gmail.com"], "GOOGLE_USERS");
equal(result.provider_readback.google.oauth_client_count, 1, "GOOGLE_CLIENT_COUNT");
equal(result.provider_readback.google.oauth_client_type, "WEB", "GOOGLE_CLIENT_TYPE");
equal(result.provider_readback.google.javascript_origin_count, 0, "GOOGLE_ORIGINS");
equal(result.provider_readback.google.redirect_uri_count, 1, "GOOGLE_REDIRECT_COUNT");
equal(result.provider_readback.google.no_other_clients_or_callbacks, true, "GOOGLE_EXCLUSIVITY");
equal(result.provider_readback.cloudflare_r2.account_api_token_count, 2, "R2_ACCOUNT_TOKEN_COUNT");
equal(result.provider_readback.cloudflare_r2.user_token_count, 0, "R2_USER_TOKEN_COUNT");
equal(result.provider_readback.cloudflare_r2.existing_staging_credential_preserved, true, "R2_STAGING_PRESERVED");
equal(result.provider_readback.cloudflare_r2.new_production_credential_count, 1, "R2_PRODUCTION_COUNT");
equal(result.provider_readback.cloudflare_r2.credential_type, "R2_S3_LONG_LIVED_ACCESS_KEY", "R2_TYPE");
equal(result.provider_readback.cloudflare_r2.credential_lifetime, "LONG_LIVED", "R2_LIFETIME");
equal(result.provider_readback.cloudflare_r2.credential_expiration_policy, "NO_EXPIRATION", "R2_EXPIRATION");
equal(result.provider_readback.cloudflare_r2.credential_scope_model, "BUCKET_ONLY", "R2_SCOPE");
equal(result.provider_readback.cloudflare_r2.no_other_bucket_or_account_wide_scope, true, "R2_SCOPE_EXCLUSIVITY");
equal(result.protected_storage.directory_mode, "0700", "STORAGE_DIR_MODE");
equal(result.protected_storage.file_mode, "0600", "STORAGE_FILE_MODE");
same(result.protected_storage.exact_file_names, fileNames, "STORAGE_FILE_NAMES");
equal(result.protected_storage.no_extra_secret_files, true, "STORAGE_EXTRA_FILES");
equal(result.integration_defect.status, "GUARDED_LOADER_REJECTS_NONTRIMMED_CAPTURE", "INTEGRATION_DEFECT_STATUS");
equal(result.integration_defect.guarded_loader_requires_trimmed_values, true, "INTEGRATION_DEFECT_TRIMMED");
same(result.integration_defect.affected_files, ["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"], "INTEGRATION_DEFECT_FILES");
equal(result.integration_defect.affected_file_last_byte_hex.R2_ACCESS_KEY_ID, "0a", "INTEGRATION_DEFECT_R2_ID_BYTE");
equal(result.integration_defect.affected_file_last_byte_hex.R2_SECRET_ACCESS_KEY, "0a", "INTEGRATION_DEFECT_R2_SECRET_BYTE");
equal(result.integration_defect.google_files_verified_without_trailing_newline, true, "INTEGRATION_DEFECT_GOOGLE_BYTES");
equal(result.integration_defect.normalization_or_overwrite_authorized, false, "INTEGRATION_DEFECT_SCOPE");
equal(result.integration_defect.fresh_normalization_or_rotation_authority_required, true, "INTEGRATION_DEFECT_NEXT");
equal(result.receipt.path, "~/.videoforge/v2-13/bootstrap/receipt/credential-bootstrap.json", "RESULT_RECEIPT_PATH");
equal(result.receipt.sha256, receiptSha256, "RESULT_RECEIPT_BINDING");
equal(result.receipt.exact_field_count, receiptKeys.length, "RESULT_RECEIPT_FIELD_COUNT");
equal(result.receipt.exact_key_set_validated, true, "RESULT_RECEIPT_KEYS");
equal(result.receipt.hashes_match_protected_files, true, "RESULT_RECEIPT_FILE_HASHES");
equal(result.receipt.secret_free, true, "RESULT_RECEIPT_SECRET_FREE");
equal(result.execution_counters.provider_calls, null, "RESULT_PROVIDER_CALL_COUNT");
equal(result.execution_counters.provider_call_count_reconstructed, false, "RESULT_PROVIDER_CALL_RECONSTRUCTION");
equal(result.execution_counters.provider_mutation_operations, 4, "RESULT_MUTATION_COUNT");
equal(result.execution_counters.credential_values_captured, 4, "RESULT_CREDENTIAL_COUNT");
equal(result.execution_counters.protected_credential_files_written, 4, "RESULT_FILE_COUNT");
equal(result.execution_counters.runpod_calls, 0, "RESULT_RUNPOD");
equal(result.execution_counters.gpu_hours, 0, "RESULT_GPU");
equal(result.execution_counters.external_spend_usd, 0, "RESULT_SPEND");
equal(result.secret_hygiene.raw_values_in_this_result, false, "RESULT_RAW_VALUES");
equal(result.secret_hygiene.raw_values_in_incident_record, false, "INCIDENT_RAW_VALUES");
equal(result.secret_hygiene.raw_values_in_receipt, false, "RECEIPT_RAW_VALUES");
equal(result.secret_hygiene.raw_google_client_secret_exposed_once_in_internal_tool_output, true, "EXPOSURE_RECORDED");
equal(result.secret_hygiene.fresh_rotation_required, true, "EXPOSURE_ROTATION_GATE");

keys(incident, [
  "schema_version", "checkpoint", "task_id", "incident_id", "recorded_at", "status", "authority_id",
  "proposal_sha256", "exposure", "affected_execution", "integration_defect", "containment", "next_boundary",
], "INCIDENT_KEYS");
equal(incident.status, "CONTAINED_STOP_REQUIRES_FRESH_ROTATION_AUTHORITY", "INCIDENT_STATUS");
equal(incident.exposure.credential_kind, "GOOGLE_CLIENT_SECRET", "INCIDENT_CREDENTIAL_KIND");
equal(incident.exposure.exposure_count, 1, "INCIDENT_COUNT");
equal(incident.exposure.surface, "INTERNAL_BROWSER_TOOL_OUTPUT", "INCIDENT_SURFACE");
equal(incident.exposure.raw_value_retained_in_this_record, false, "INCIDENT_RAW_RECORD");
equal(incident.exposure.raw_value_retained_in_repository_or_evidence, false, "INCIDENT_RAW_REPOSITORY");
equal(incident.exposure.raw_value_retained_in_receipt, false, "INCIDENT_RAW_RECEIPT");
equal(incident.exposure.raw_value_in_user_visible_chat, false, "INCIDENT_CHAT");
equal(incident.integration_defect.status, "GUARDED_LOADER_REJECTS_NONTRIMMED_CAPTURE", "INCIDENT_INTEGRATION_STATUS");
equal(incident.integration_defect.guarded_loader_requires_trimmed_values, true, "INCIDENT_INTEGRATION_TRIMMED");
same(incident.integration_defect.affected_files, ["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"], "INCIDENT_INTEGRATION_FILES");
equal(incident.integration_defect.affected_file_last_byte_hex.R2_ACCESS_KEY_ID, "0a", "INCIDENT_INTEGRATION_R2_ID_BYTE");
equal(incident.integration_defect.affected_file_last_byte_hex.R2_SECRET_ACCESS_KEY, "0a", "INCIDENT_INTEGRATION_R2_SECRET_BYTE");
equal(incident.integration_defect.normalization_or_overwrite_authorized, false, "INCIDENT_INTEGRATION_SCOPE");
equal(incident.containment.authority_consumed, true, "INCIDENT_AUTHORITY");
equal(incident.containment.authority_reusable, false, "INCIDENT_REUSABLE");
equal(incident.containment.no_rotation_authorized, true, "INCIDENT_ROTATION");
equal(incident.containment.no_retry_or_redispatch, true, "INCIDENT_RETRY");
equal(incident.containment.runpod_calls, 0, "INCIDENT_RUNPOD");
equal(incident.containment.gpu_hours, 0, "INCIDENT_GPU");
equal(incident.containment.external_spend_usd, 0, "INCIDENT_SPEND");

keys(receipt, receiptKeys, "RECEIPT_KEYS");
equal(receipt.schema_version, "videoforge.v2-13-credential-bootstrap-result/v1", "RECEIPT_SCHEMA");
equal(receipt.source_commit, sourceCommit, "RECEIPT_SOURCE");
equal(receipt.google_project_id, "adroit-archive-329710", "RECEIPT_PROJECT");
equal(receipt.r2_permission_group, "Workers R2 Storage Bucket Item Write", "RECEIPT_R2_PERMISSION");
equal(receipt.r2_credential_type, "R2_S3_LONG_LIVED_ACCESS_KEY", "RECEIPT_R2_TYPE");
equal(receipt.r2_credential_lifetime, "LONG_LIVED", "RECEIPT_R2_LIFETIME");
equal(receipt.r2_credential_expiration_policy, "NO_EXPIRATION", "RECEIPT_R2_EXPIRATION");
equal(receipt.r2_credential_expiration_at, null, "RECEIPT_R2_EXPIRATION_AT");
for (const field of [
  "google_authenticated_account_sha256", "google_project_id_sha256", "google_project_number_sha256",
  "google_oauth_client_id_sha256", "google_oauth_client_secret_sha256", "google_redirect_uris_canonical_sha256",
  "google_javascript_origins_canonical_sha256", "cloudflare_account_id_sha256", "r2_bucket_name_sha256",
  "r2_access_key_id_sha256", "r2_secret_access_key_sha256",
]) equal(hashPattern.test(receipt[field]), true, `RECEIPT_HASH_${field}`);
equal(receipt.runpod_calls, 0, "RECEIPT_RUNPOD");
equal(receipt.gpu_hours, 0, "RECEIPT_GPU");
equal(receipt.external_spend_usd, 0, "RECEIPT_SPEND");

await mode(secretDirectory, 0o700, "SECRET_DIRECTORY_MODE");
await mode(resolve(secretDirectory, ".."), 0o700, "SECRET_PARENT_MODE");
await mode(resolve(secretDirectory, "../.."), 0o700, "SECRET_ROOT_MODE");
await mode(resolve(secretDirectory, "../../.."), 0o700, "VIDEOFORGE_ROOT_MODE");
await mode(dirname(receiptPath), 0o700, "RECEIPT_DIRECTORY_MODE");
await mode(receiptPath, 0o600, "RECEIPT_MODE");
same((await readdir(secretDirectory)).sort(), [...fileNames].sort(), "SECRET_FILE_SET");
const expectedStoredHashes = {
  GOOGLE_CLIENT_ID: "sha256:0150569d559bc69055805f48be9d54e9748a1fa34e6dffa6c293701b9814d932",
  GOOGLE_CLIENT_SECRET: "sha256:86bb8e2861781a66595c3d204c7cadc4fd9e32cda2347752bec08821740e06e6",
  R2_ACCESS_KEY_ID: "sha256:183c83dade1e32a1f732e35672ef9d751abbd6ef66a4f547463f448002050de0",
  R2_SECRET_ACCESS_KEY: "sha256:d9c2239ae9d60be925dff87236f3bb334d8fb6ea992b62ac9586f4c8fa7159b2",
};
for (const name of fileNames) {
  const filePath = resolve(secretDirectory, name);
  const bytes = await readFile(filePath);
  equal(hash(bytes), expectedStoredHashes[name], `SECRET_FILE_HASH_${name}`);
  await mode(filePath, 0o600, `SECRET_FILE_MODE_${name}`);
  const entry = result.protected_storage.files.find((value) => value.name === name);
  equal(entry?.stored_bytes_sha256, expectedStoredHashes[name], `RESULT_FILE_HASH_${name}`);
}
equal(receipt.google_oauth_client_id_sha256, "sha256:0150569d559bc69055805f48be9d54e9748a1fa34e6dffa6c293701b9814d932", "RECEIPT_GOOGLE_ID_HASH");
equal(receipt.google_oauth_client_secret_sha256, "sha256:86bb8e2861781a66595c3d204c7cadc4fd9e32cda2347752bec08821740e06e6", "RECEIPT_GOOGLE_SECRET_HASH");
const r2AccessBytes = await readFile(resolve(secretDirectory, "R2_ACCESS_KEY_ID"));
const r2SecretBytes = await readFile(resolve(secretDirectory, "R2_SECRET_ACCESS_KEY"));
equal(hash(r2AccessBytes.subarray(-1)[0] === 10 ? r2AccessBytes.subarray(0, -1) : r2AccessBytes), receipt.r2_access_key_id_sha256, "RECEIPT_R2_ID_HASH");
equal(hash(r2SecretBytes.subarray(-1)[0] === 10 ? r2SecretBytes.subarray(0, -1) : r2SecretBytes), receipt.r2_secret_access_key_sha256, "RECEIPT_R2_SECRET_HASH");

equal(authority.status, authorityStatus, "AUTHORITY_STATUS");
equal(authority.authority_id, authorityId, "AUTHORITY_ID");
equal(authority.consumed, true, "AUTHORITY_CONSUMED");
equal(authority.single_use, true, "AUTHORITY_SINGLE_USE");
equal(authority.lineage.proposal_sha256, proposalSha256, "AUTHORITY_PROPOSAL");
equal(authority.lineage.proposal_record_commit, "68ea8a0de78ded973c3a007ba2173a24161c8c36", "AUTHORITY_PROPOSAL_COMMIT");
equal(authority.lineage.release_source_commit, sourceCommit, "AUTHORITY_SOURCE");
equal(authority.execution_recording.path, resultRelativePath, "AUTHORITY_RESULT_PATH");
equal(authority.execution_recording.sha256, hash(resultBytes), "AUTHORITY_RESULT_HASH");
equal(authority.execution_recording.incident_path, incidentRelativePath, "AUTHORITY_INCIDENT_PATH");
equal(authority.execution_recording.incident_sha256, incidentSha256, "AUTHORITY_INCIDENT_HASH");
equal(authority.execution_recording.receipt_sha256, receiptSha256, "AUTHORITY_RECEIPT_HASH");
equal(authority.execution_recording.authority_reusable, false, "AUTHORITY_RESULT_REUSABLE");
equal(authority.provider_free_recording.credentials_accessed, true, "AUTHORITY_CREDENTIALS");
equal(authority.provider_free_recording.authorized_execution_provider_calls, null, "AUTHORITY_PROVIDER_CALLS");
equal(authority.provider_free_recording.authorized_execution_provider_mutations, 4, "AUTHORITY_MUTATIONS");
equal(authority.provider_free_recording.observed_preapproval_provider_mutations, 1, "AUTHORITY_PRIOR_MUTATION");
equal(authority.provider_free_recording.runpod_calls, 0, "AUTHORITY_RUNPOD");
equal(authority.provider_free_recording.gpu_hours, 0, "AUTHORITY_GPU");
equal(authority.provider_free_recording.external_spend_usd, 0, "AUTHORITY_SPEND");
equal(authority.provider_free_recording.temporary_compute_started, false, "AUTHORITY_COMPUTE");
equal(authority.provider_free_recording.authority_consumed, true, "AUTHORITY_RECORDING_CONSUMED");
equal(authority.provider_free_recording.execution_started, true, "AUTHORITY_RECORDING_STARTED");
equal(authority.provider_free_recording.consumption_record_created, true, "AUTHORITY_RECORDING_RESULT");
equal(authority.provider_free_recording.consumption_record_sha256, hash(resultBytes), "AUTHORITY_RECORDING_HASH");

process.stdout.write(`${JSON.stringify({
  status: resultStatus,
  authority_id: authorityId,
  result_sha256: hash(resultBytes),
  incident_sha256: incidentSha256,
  receipt_sha256: receiptSha256,
  protected_files: fileNames.length,
  receipt_keys: receiptKeys.length,
  runpod_calls: 0,
  gpu_hours: 0,
  external_spend_usd: 0,
})}\n`);

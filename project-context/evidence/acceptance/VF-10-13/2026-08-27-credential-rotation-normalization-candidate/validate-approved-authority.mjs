import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const proposalPath = resolve(directory, "combined-credential-rotation-normalization-proposal.json");
const approvalPath = resolve(directory, "user-approval.json");
const authorityPath = resolve(directory, "approved-authority.json");
const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const proposalBytes = readFileSync(proposalPath);
const approvalBytes = readFileSync(approvalPath);
const proposal = JSON.parse(proposalBytes);
const approval = JSON.parse(approvalBytes);
const authority = JSON.parse(readFileSync(authorityPath));
const fail = (code) => {
  throw new Error(`V2_13_CREDENTIAL_ROTATION_AUTHORITY_${code}`);
};
const exactKeys = (value, keys, code) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(code);
};

const proposalSha = "sha256:76f14ae25cff7840d0028be1ca0af87bbf325178d99a5ca2b80806aa3ddb2c73";
const proposalCommit = "1845be6c852654c8396f2973981733ce64a3d2d0";
const approvalSha = "sha256:94c1f9fb1c6f3fb42f4b957a2e1de7c91c2404cc299cd73c59e5a4ac8d1d80e6";
const authorityId = "v2-13-credential-rotation-normalization-20260827-095717z-76f14ae2";
if (sha256(proposalBytes) !== proposalSha || sha256(approvalBytes) !== approvalSha) fail("RAW_HASH");
if (proposal.proposal_status !== "PASS_SEALED_AWAITING_FRESH_EXACT_APPROVAL") fail("PROPOSAL_STATUS");

exactKeys(approval, [
  "schema_version", "checkpoint_range", "task_id", "authority_id", "approval_source",
  "approved_at", "expires_at", "proposal", "approval", "execution_fences",
  "incident_acknowledgment", "statement",
], "APPROVAL_KEYS");
if (
  approval.schema_version !== "videoforge.v2-13-credential-rotation-normalization-user-approval/v1" ||
  approval.authority_id !== authorityId ||
  approval.proposal?.sha256 !== proposalSha ||
  approval.proposal?.proposal_record_commit !== proposalCommit ||
  approval.approval?.single_use !== true ||
  approval.approval?.maximum_external_spend_usd !== 0 ||
  approval.approval?.maximum_cumulative_runpod_spend_usd !== 0 ||
  approval.approval?.maximum_gpu_hours !== 0
) fail("APPROVAL_SCOPE");
const approvedAt = Date.parse(approval.approved_at);
const expiresAt = Date.parse(approval.expires_at);
if (!Number.isFinite(approvedAt) || expiresAt - approvedAt !== 86_400_000) fail("APPROVAL_TIME");
const orderedOperations = [
  "credential-rotation-normalization-fresh-exact-preflight",
  "credential-rotation-normalization-r2-remove-one-trailing-lf",
  "credential-rotation-google-add-one-client-secret",
  "credential-rotation-google-atomically-replace-secret-file",
  "credential-rotation-google-revoke-one-exposed-old-secret",
  "credential-rotation-normalization-refresh-secret-free-receipt",
  "credential-rotation-normalization-final-exact-readback",
];

if (
  authority.schema_version !== "videoforge.v2-13-credential-rotation-normalization-approved-authority/v1" ||
  authority.authority_id !== authorityId ||
  authority.status !== "APPROVED_UNCONSUMED_PENDING_FRESH_EXECUTION_INPUTS" ||
  authority.single_use !== true || authority.consumed !== false || authority.consumed_at !== null ||
  authority.lineage?.proposal_sha256 !== proposalSha ||
  authority.lineage?.proposal_record_commit !== proposalCommit ||
  authority.lineage?.user_approval_sha256 !== approvalSha ||
  authority.combined_execution_authority?.execute_authorized !== true ||
  authority.combined_execution_authority?.google_secret_rotation_authorized !== true ||
  authority.combined_execution_authority?.google_old_secret_revoke_authorized !== true ||
  authority.combined_execution_authority?.cloudflare_r2_mutation_authorized !== false ||
  authority.combined_execution_authority?.runpod_calls_authorized !== false ||
  authority.combined_execution_authority?.gpu_use_authorized !== false ||
  authority.combined_execution_authority?.external_spend_authorized !== false ||
  authority.operation_allowlist?.operation_count !== 7 ||
  JSON.stringify(authority.operation_allowlist?.ordered_operation_ids) !== JSON.stringify(orderedOperations) ||
  authority.google_scope?.add_exactly_one_new_client_secret !== true ||
  authority.google_scope?.revoke_only_exact_old_exposed_secret !== true ||
  authority.google_scope?.raw_new_secret_stdout_authorized !== false ||
  authority.google_scope?.raw_new_secret_stderr_authorized !== false ||
  authority.google_scope?.raw_new_secret_logs_authorized !== false ||
  authority.protected_storage_scope?.normalize_exactly_one_trailing_lf_from_r2_access_key !== true ||
  authority.protected_storage_scope?.normalize_exactly_one_trailing_lf_from_r2_secret !== true ||
  authority.provider_free_recording?.credentials_accessed !== false ||
  authority.provider_free_recording?.authority_consumed !== false ||
  authority.provider_free_recording?.execution_started !== false ||
  authority.provider_free_recording?.runpod_calls !== 0 ||
  authority.provider_free_recording?.gpu_hours !== 0 ||
  authority.provider_free_recording?.external_spend_usd !== 0
) fail("AUTHORITY_SCOPE");
if (
  authority.stop_and_cleanup?.no_retry !== true ||
  authority.stop_and_cleanup?.no_redispatch !== true ||
  authority.stop_and_cleanup?.stop_on_new_secret_raw_output_or_log_exposure !== true ||
  authority.stop_and_cleanup?.no_delete_or_rotate_any_other_credential !== true
) fail("AUTHORITY_STOP");

console.log(JSON.stringify({
  status: authority.status,
  authority_id: authorityId,
  proposal_sha256: proposalSha,
  approval_sha256: approvalSha,
  consumed: false,
  provider_calls_made: 0,
  provider_mutations_made: 0,
  credentials_accessed: false,
  runpod_calls: 0,
  gpu_hours: 0,
  external_spend_usd: 0,
}));

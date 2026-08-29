import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  EXACT_BOOTSTRAP_PARTIAL_CLEANUP_POLICY,
  EXACT_CRASH_SAFE_CLEANUP_POLICY,
  EXACT_DURABLE_BILLING_POLICY,
  EXACT_EARLY_NO_DATABASE_CLEANUP_POLICY,
  EXACT_IMAGE_WORKFLOW_VERIFICATION_POLICY,
  EXACT_INTERNAL_MATERIALIZATION_POLICY,
  EXACT_OPERATION_IDS,
  EXACT_PREDECESSOR_RELEASE_ATTEMPT,
  EXACT_PREQUALIFICATION_BRIDGE_POLICY,
  EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY,
  EXACT_TRUSTED_TIME_POLICY,
  EXACT_V3_RELEASE_COMPONENTS,
  EXACT_V4_EXECUTION_CONTROL_COMPONENTS,
  EXACT_WORKFLOW_START_AUTHORITY_POLICY,
} from "../../../../../deploy/v2-13/validate-full-live-approval.mjs";
import { validateStaticReleaseDescriptorFile } from "../../../../../deploy/v2-13/full-live-orchestration-authority.mjs";

const ROOT = path.resolve(fileURLToPath(new URL("../../../../..", import.meta.url)));
const DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PROPOSAL_PATH = path.join(DIRECTORY, "combined-live-proposal.json");
const AUDIT_PATH = path.join(DIRECTORY, "source-readiness-audit.json");
const READ_ONLY_PREFLIGHT_PATH = path.join(DIRECTORY, "read-only-preflight.json");
const FACTS_PATH = path.join(ROOT, "project-context/evidence/acceptance/VF-10-13/materialization-seed-facts.json");
const DESCRIPTOR_PATH = path.join(ROOT, "protected-inputs/v2-13/static-release-descriptor.json");
const PROTECTED_INPUT_PATH = path.join(ROOT, "protected-inputs/v2-13/materialization-seed-input.json");
const RELEASE_SOURCE_COMMIT = "15af5e20ce3c80eb61d5d1e807a87e8840ed9685";
const EXECUTION_CONTROL_COMMIT = "67e5624ed8ba2c2596c42ce6839703f6c46263df";
const AUDITED_CODE_COMMIT = "18e46940aa47c6e17da4d3a90441f7ad638d9f96";
const FACTS_SHA256 = "sha256:b1b1f75e85115fef1805c43805428d43b4dd607f638e470e0d466b9d80f2b769";
const AUDIT_SHA256 = "sha256:71be2e9a0f672ede231e2afa8499f84a879a88c747e26eb6aa641c590189b90b";
const DESCRIPTOR_SHA256 = "sha256:704d2e92ffa6861069676942f25d981dfdd484f5cbbeb6b77dec633dea820f41";
const PROTECTED_INPUT_SHA256 = "sha256:28d8bd0baaaa382fb6a66a9b3dc2014db5da2c007ca57e53eed29e816edb0b87";
const FULL_LIVE_AUTHORITY_ID = "33d3218d-ac46-4881-a3b0-81c09205662e";
const TAG = "videoforge-v2-13-release-20260826-v3";
const EXACT_OAUTH_SCOPES = [
  "account:read", "agent-memory:write", "ai-search:run", "ai-search:write", "ai:write",
  "artifacts:write", "browser:write", "challenge-widgets.write", "cloudchamber:write",
  "connectivity:admin", "containers:write", "d1:write", "email_routing:write",
  "email_sending:write", "flagship:write", "offline_access", "pages:write", "pipelines:write",
  "queues:write", "secrets_store:write", "ssl_certs:write", "user:read", "websearch.run",
  "workers:write", "workers_kv:write", "workers_routes:write", "workers_scripts:write",
  "workers_tail:read", "zone:read",
];
const MAGE_VOLUME_ID_SHA256 = "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619";
const SOULX_VOLUME_ID_SHA256 = "sha256:2a8633e14bbecab54f52e2ae7b5b06bfa562b09a6ac781fe0985eb28e70587be";
const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const assert = (condition, code) => {
  if (!condition) throw new Error(code);
};
const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const gitBytes = (commit, relativePath) => execFileSync("git", ["show", `${commit}:${relativePath}`], { cwd: ROOT, encoding: "buffer", stdio: ["ignore", "pipe", "pipe"] });
const readJson = async (file, code) => {
  const bytes = await readFile(file);
  assert(bytes.at(-1) === 0x0a, `${code}_FINAL_NEWLINE`);
  try {
    return { bytes, value: JSON.parse(bytes) };
  } catch {
    throw new Error(`${code}_JSON`);
  }
};

const { bytes: proposalBytes, value: proposal } = await readJson(PROPOSAL_PATH, "PROPOSAL");
const { bytes: auditBytes, value: audit } = await readJson(AUDIT_PATH, "AUDIT");
const { value: readOnlyPreflight } = await readJson(READ_ONLY_PREFLIGHT_PATH, "READ_ONLY_PREFLIGHT");
const { bytes: factsBytes, value: facts } = await readJson(FACTS_PATH, "FACTS");
assert(sha256(auditBytes) === AUDIT_SHA256, "AUDIT_SHA256");
assert(sha256(factsBytes) === FACTS_SHA256, "FACTS_SHA256");
assert(
  audit.schema_version === "videoforge.v2-13-full-live-source-readiness-audit/v1" &&
    audit.audited_code_commit === AUDITED_CODE_COMMIT &&
    audit.audit_result === "PASS_READY_TO_RESEAL" &&
    audit.evidence_class === "INDEPENDENT_RELEASE_AUDIT" &&
    audit.fixture_or_fake_transport_used === false &&
    audit.external_calls === 0 && audit.provider_mutations === 0 && audit.gpu_use === 0 && audit.spend_usd === 0 &&
    audit.source_closure?.sha256 === EXACT_V4_EXECUTION_CONTROL_COMPONENTS.source_closure_manifest.sha256,
  "AUDIT_CONTRACT",
);
assert(
  facts.schema_version === "videoforge.v213-materialization-seed-facts/v1" &&
    facts.full_live_authority_id === FULL_LIVE_AUTHORITY_ID &&
    facts.protected_input?.sha256 === PROTECTED_INPUT_SHA256 &&
    facts.source_evidence?.source_readiness?.sha256 === AUDIT_SHA256,
  "FACTS_CONTRACT",
);
assert(sha256(await readFile(PROTECTED_INPUT_PATH)) === PROTECTED_INPUT_SHA256, "PROTECTED_INPUT");
validateStaticReleaseDescriptorFile({ path: DESCRIPTOR_PATH, expectedSha256: DESCRIPTOR_SHA256, expectedSourceCommit: RELEASE_SOURCE_COMMIT });

assert(
  proposal.schema_version === "videoforge.v2-13-full-live-completion-proposal/v4" &&
    proposal.task_id === "VF-10-13" && proposal.proposal_status === "PENDING_FRESH_EXACT_USER_APPROVAL" &&
    proposal.source?.release_source_commit === RELEASE_SOURCE_COMMIT &&
    proposal.source?.repaired_release_source_commit === RELEASE_SOURCE_COMMIT &&
    proposal.source?.proposal_record_commit === null &&
    proposal.source?.execution_control?.commit === EXECUTION_CONTROL_COMMIT,
  "PROPOSAL_IDENTITY",
);
assert(JSON.stringify(proposal.source.exact_release_components) === JSON.stringify(EXACT_V3_RELEASE_COMPONENTS), "IMMUTABLE_PAYLOAD_COMPONENTS");
assert(JSON.stringify(proposal.source.execution_control.exact_components) === JSON.stringify(EXACT_V4_EXECUTION_CONTROL_COMPONENTS), "EXECUTION_CONTROL_COMPONENTS");
assert(
  JSON.stringify(proposal.supersession?.predecessor_release_attempt) === JSON.stringify(EXACT_PREDECESSOR_RELEASE_ATTEMPT) &&
    proposal.supersession?.prior_approval_reusable === false && proposal.supersession?.fresh_exact_approval_required === true,
  "PREDECESSOR_BINDING",
);
const descriptorBinding = { path: "protected-inputs/v2-13/static-release-descriptor.json", sha256: DESCRIPTOR_SHA256 };
const factsBinding = { commit_field: "source.execution_control.commit", full_live_authority_id: FULL_LIVE_AUTHORITY_ID, path: "project-context/evidence/acceptance/VF-10-13/materialization-seed-facts.json", sha256: FACTS_SHA256 };
assert(
  JSON.stringify(proposal.sealing?.static_release_descriptor) === JSON.stringify(descriptorBinding) &&
    JSON.stringify(proposal.sealing?.materialization_seed_facts) === JSON.stringify(factsBinding) &&
    JSON.stringify(proposal.requested_scope?.static_release_descriptor) === JSON.stringify(descriptorBinding) &&
    JSON.stringify(proposal.requested_scope?.materialization_seed_facts) === JSON.stringify(factsBinding),
  "PROTECTED_BINDINGS",
);

const routeReadback = proposal.source.pending_source_contract.route_readbacks.pre_mutation;
assert(
  JSON.stringify(routeReadback) === JSON.stringify({
    worker_must_be_absent: true,
    status: 404,
    content_type: "text/html; charset=UTF-8",
    body_length: 19984,
    body_sha256: "sha256:2000e6b28a1517ba1268e1649cd3163326ef839492edfdba31e8959830580976",
    observed_body_sha256_prefix: "2000e6b2",
    json_body_authorized: false,
    status_503_authorized: false,
    exact_body_and_content_type_required: true,
  }),
  "ROUTE_READBACK_CONTRACT",
);
const cloudflareScope = proposal.requested_scope.cloudflare_credential_scope;
assert(
  cloudflareScope.cloudflare_api_token_environment_export_authorized === false &&
    cloudflareScope.raw_api_token_file_authorized === false &&
    JSON.stringify(cloudflareScope.oauth_scopes) === JSON.stringify(EXACT_OAUTH_SCOPES),
  "CLOUDFLARE_OAUTH_SCOPE",
);
const cloudflareGraph = proposal.exact_execution_graph.cloudflare_credential_origin_policy.oauth_authentication;
assert(
  cloudflareGraph.protected_config_reader === "readWranglerOAuthCredential" &&
    JSON.stringify(cloudflareGraph.oauth_scopes) === JSON.stringify(EXACT_OAUTH_SCOPES),
  "CLOUDFLARE_GRAPH",
);
assert(
  proposal.requested_scope.google_oauth_web_client_scope.authorized_redirect_uri_count === 1,
  "GOOGLE_OAUTH_SCOPE",
);
assert(
  proposal.requested_scope.r2_s3_credential_scope.new_r2_bucket_authorized === false,
  "R2_S3_SCOPE",
);
assert(
  proposal.exact_execution_graph.internal_materialization_policy
    .materialization_seed_sha256_verified_after_restart_or_recovery === true,
  "MATERIALIZATION_SEED_OUTER_BINDING",
);
assert(
  proposal.supersession.superseded_authority_record_sha256 ===
    "sha256:80cdb32dcfb6128ad4c21aa40de0e95e60e3dd8506c32d6cba0c6357c5fd8d9e",
  "SUPERSESSION_AUTHORITY_RECORD",
);
assert(
  proposal.exact_execution_graph.credential_scope_policy.google_oauth.authorized_operation ===
    "READBACK_EXACTLY_ONE_PREEXISTING_PROTECTED_GOOGLE_OAUTH_WEB_CLIENT",
  "CREDENTIAL_GRAPH_GOOGLE",
);
assert(
  proposal.approval_request.requested_r2_s3_scope ===
    "Read back exactly one completed-receipt-bound protected least-privilege R2 S3 credential for Cloudflare account f9254d773a3426fcb469451b1f965d8c and existing bucket videoforge-v2-06-staging-private only; use only the protected receipt-bound value, with no creation or rotation, new bucket, account-wide, wildcard, or second credential.",
  "APPROVAL_SCOPE_BOUND",
);
const dbBootstrap = proposal.exact_execution_graph.prequalification_database_bootstrap_policy;
assert(
  JSON.stringify(dbBootstrap.post_bootstrap_receipt_verifier) ===
    JSON.stringify(EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.post_bootstrap_receipt_verifier),
  "PREQUALIFICATION_RECEIPT_VERIFIER",
);
const bridgePolicy = proposal.exact_execution_graph.prequalification_bridge_policy;
assert(
  JSON.stringify(bridgePolicy.receipt_gate) ===
    JSON.stringify(EXACT_PREQUALIFICATION_BRIDGE_POLICY.receipt_gate),
  "PREQUALIFICATION_RECEIPT_GATE",
);
assert(
  JSON.stringify(bridgePolicy.executor_receipt_gate) ===
    JSON.stringify(EXACT_PREQUALIFICATION_BRIDGE_POLICY.executor_receipt_gate),
  "PREQUALIFICATION_EXECUTOR_RECEIPT_GATE",
);
assert(
  JSON.stringify(bridgePolicy.operator_only_preflight.fresh_child_forbidden_database_inputs) ===
    JSON.stringify(
      EXACT_PREQUALIFICATION_BRIDGE_POLICY.operator_only_preflight
        .fresh_child_forbidden_database_inputs,
    ),
  "PREQUALIFICATION_FRESH_CHILD_SEAM",
);
const retention = proposal.requested_scope.retention;
assert(
  retention.mage_volume_id_sha256 === MAGE_VOLUME_ID_SHA256 &&
    retention.soulx_volume_id_sha256 === SOULX_VOLUME_ID_SHA256,
  "RETENTION_SCOPE",
);
assert(
  JSON.stringify(readOnlyPreflight.runpod?.retained_volumes) ===
    JSON.stringify([
      { id_sha256: SOULX_VOLUME_ID_SHA256, size_gb: 50, region: "EU-RO-1" },
      { id_sha256: MAGE_VOLUME_ID_SHA256, size_gb: 50, region: "EU-RO-1" },
    ]),
  "READ_ONLY_PREFLIGHT_RUNPOD",
);

for (const [name, component] of Object.entries(EXACT_V3_RELEASE_COMPONENTS)) {
  if (typeof component.sha256 === "string") assert(sha256(gitBytes(RELEASE_SOURCE_COMMIT, component.path)) === component.sha256, `PAYLOAD:${name}`);
}
for (const [name, component] of Object.entries(EXACT_V4_EXECUTION_CONTROL_COMPONENTS)) {
  const componentBytes = gitBytes(EXECUTION_CONTROL_COMMIT, component.path);
  if (name !== "approval_validator") assert(sha256(componentBytes) === component.sha256, `CONTROL:${name}`);
}
assert(sha256(gitBytes(EXECUTION_CONTROL_COMMIT, "deploy/v2-13/validate-full-live-approval.mjs")) === sha256(await readFile(path.join(ROOT, "deploy/v2-13/validate-full-live-approval.mjs"))), "CONTROL:approval_validator");

const policies = proposal.exact_execution_graph;
for (const [actual, expected, code] of [
  [policies.ordered_operation_ids, EXACT_OPERATION_IDS, "OPERATIONS"],
  [policies.image_workflow_verification_policy, EXACT_IMAGE_WORKFLOW_VERIFICATION_POLICY, "IMAGE_POLICY"],
  [policies.internal_materialization_policy, EXACT_INTERNAL_MATERIALIZATION_POLICY, "MATERIALIZATION_POLICY"],
  [policies.trusted_time_policy, EXACT_TRUSTED_TIME_POLICY, "TIME_POLICY"],
  [policies.prequalification_database_bootstrap_policy, EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY, "DB_POLICY"],
  [policies.workflow_start_authority_policy, EXACT_WORKFLOW_START_AUTHORITY_POLICY, "WORKFLOW_POLICY"],
  [policies.early_no_database_cleanup_policy, EXACT_EARLY_NO_DATABASE_CLEANUP_POLICY, "EARLY_CLEANUP_POLICY"],
  [policies.bootstrap_partial_cleanup_policy, EXACT_BOOTSTRAP_PARTIAL_CLEANUP_POLICY, "BOOTSTRAP_CLEANUP_POLICY"],
  [policies.crash_safe_cleanup_policy, EXACT_CRASH_SAFE_CLEANUP_POLICY, "CRASH_POLICY"],
  [policies.durable_billing_policy, EXACT_DURABLE_BILLING_POLICY, "BILLING_POLICY"],
  [policies.prequalification_bridge_policy, EXACT_PREQUALIFICATION_BRIDGE_POLICY, "BRIDGE_POLICY"],
]) assert(JSON.stringify(actual) === JSON.stringify(expected), code);
assert(policies.operation_order_is_closed_and_non_reorderable === true && policies.missing_extra_or_repeated_operation_is_a_hard_stop === true, "CLOSED_GRAPH");

const scope = proposal.requested_scope;
assert(
  scope.maximum_cumulative_finite_runpod_spend_usd === 17.5 &&
    JSON.stringify(Object.values(scope.phase_caps_usd)) === JSON.stringify([4.5, 1, 2, 2, 4, 2, 2]) &&
    scope.gpu?.exact_offering === "NVIDIA GeForce RTX 4090" && scope.gpu?.region === "EU-RO-1" &&
    scope.gpu?.maximum_serverless_flex_rate_usd_per_gpu_hour === 1.116 &&
    scope.new_volumes === 0 && scope.new_paid_retained_resources === 0 && scope.plan_change_authorized === false,
  "SCOPE",
);
const ref = proposal.immutable_github_release_ref_request;
assert(
  ref?.creation_requested === false && ref?.exact_tag_name === TAG && ref?.exact_target_commit === RELEASE_SOURCE_COMMIT &&
    ref?.maximum_new_refs === 0 && ref?.predecessor_bound_reconciliation_only === true &&
    ref?.successor_tag_mutation_authorized === false && ref?.force_update_authorized === false && ref?.delete_or_retarget_authorized === false,
  "TAG_RECONCILIATION",
);
assert(
  proposal.authority?.exact_proposal_approved === false && proposal.authority?.execute_authorized === false &&
    proposal.authority?.credential_access_authorized === false && proposal.authority?.provider_calls_authorized === false &&
    proposal.authority?.provider_mutations_authorized === false && proposal.authority?.gpu_use_authorized === false &&
    proposal.authority?.external_spend_authorized === false && proposal.authority?.immutable_release_ref_creation_authorized === false,
  "NO_ACTIVE_AUTHORITY",
);
assert(
  proposal.stop_conditions.some((item) => item.includes("predecessor-created release tag is absent")) &&
    proposal.stop_conditions.some((item) => item.includes("replay")) &&
    proposal.stop_conditions.some((item) => item.includes("drift or uncertainty")),
  "STOP_CONDITIONS",
);

const head = git("rev-parse", "HEAD");
if (head !== EXECUTION_CONTROL_COMMIT) {
  assert(git("rev-parse", `${head}^`) === EXECUTION_CONTROL_COMMIT, "PROPOSAL_RECORD_PARENT");
  const proposalRecordPaths = git("diff-tree", "--no-commit-id", "--name-only", "-r", head)
    .split("\n")
    .filter(Boolean)
    .sort();
  assert(JSON.stringify(proposalRecordPaths) === JSON.stringify([
    "project-context/00_START_HERE.md",
    "project-context/CURRENT_STATE.yaml",
    "project-context/evidence/acceptance/VF-10-13/2026-08-27-cloudflare-credential-origin-repair-candidate/combined-live-proposal.json",
    "project-context/evidence/acceptance/VF-10-13/2026-08-27-cloudflare-credential-origin-repair-candidate/validate-candidate.mjs",
    "project-context/tasks/VF-10-13.md",
  ]), "PROPOSAL_RECORD_PATHS");
}
assert(git("rev-parse", `${EXECUTION_CONTROL_COMMIT}^`) === AUDITED_CODE_COMMIT, "EVIDENCE_PARENT");
const evidencePaths = git("diff-tree", "--no-commit-id", "--name-only", "-r", EXECUTION_CONTROL_COMMIT).split("\n").filter(Boolean).sort();
assert(JSON.stringify(evidencePaths) === JSON.stringify([
  "project-context/evidence/acceptance/VF-10-13/2026-08-27-cloudflare-credential-origin-repair-candidate/source-readiness-audit.json",
  "project-context/evidence/acceptance/VF-10-13/materialization-seed-facts.json",
]), "EVIDENCE_COMMIT_PATHS");
for (const name of ["user-approval.json", "approved-authority.json"])
  await access(path.join(DIRECTORY, name)).then(() => assert(false, `ACTIVE_${name}`), () => true);

const executor = JSON.parse(execFileSync(process.execPath, [path.join(ROOT, "deploy/v2-13/full-live-executor.mjs")], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
assert(executor.state === "NO_ACTION" && executor.ordered_operations?.length === 26 && executor.external_calls === 0 && executor.mutations === 0 && executor.gpu_use === 0 && executor.spend_usd === 0, "EXECUTOR_NO_ACTION");

process.stdout.write(`${JSON.stringify({
  schema_version: "videoforge.v2-13-successor-candidate-validation/v1",
  status:
    head === EXECUTION_CONTROL_COMMIT
      ? "PASS_BLOCKED_UNSEALED"
      : "PASS_SEALED_AWAITING_FRESH_EXACT_APPROVAL",
  state: "PASS_PENDING_FRESH_EXACT_APPROVAL",
  authority: "ABSENT",
  superseded_authority_id: proposal.supersession.superseded_authority_id,
  superseded_proposal_sha256: proposal.supersession.supersedes_proposal_sha256,
  proposal_sha256: sha256(proposalBytes),
  release_source_commit: RELEASE_SOURCE_COMMIT,
  execution_control_commit: EXECUTION_CONTROL_COMMIT,
  predecessor_terminal_state_sha256: EXACT_PREDECESSOR_RELEASE_ATTEMPT.terminal_state_sha256,
  external_calls: 0,
  mutations: 0,
  gpu_use: 0,
  spend_usd: 0,
})}\n`);

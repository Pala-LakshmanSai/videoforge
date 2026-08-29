import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("../../../../..", import.meta.url)));
const DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PROPOSAL_PATH = path.join(DIRECTORY, "combined-live-proposal.json");
const AUDIT_PATH = path.join(DIRECTORY, "source-readiness-audit.json");
const READ_ONLY_PREFLIGHT_PATH = path.join(DIRECTORY, "read-only-preflight.json");
const FACTS_PATH = path.join(ROOT, "project-context/evidence/acceptance/VF-10-13/materialization-seed-facts.json");
const TERMINAL_ARCHIVE = "protected-inputs/v2-13/history/v2-13-full-live-20260829-052951z-6852970d";
const DESCRIPTOR_PATH = path.join(ROOT, TERMINAL_ARCHIVE, "static-release-descriptor.json");
const PROTECTED_INPUT_PATH = path.join(ROOT, TERMINAL_ARCHIVE, "materialization-seed-input.json");
const TERMINAL_STATE_PATH = path.join(ROOT, TERMINAL_ARCHIVE, "full-live-state.json");
const RELEASE_SOURCE_COMMIT = "15af5e20ce3c80eb61d5d1e807a87e8840ed9685";
const EXECUTION_CONTROL_COMMIT = "62e361e15de53369910e60226f27859b5b5a7f08";
const PROPOSAL_RECORD_COMMIT = "1ba62090c763cb4993cd5f9806e63c6629be1997";
const PROPOSAL_SHA256 = "sha256:6852970d91153a5c61fcee5b4f1f8bac717cd6c302538b71dda3ff8dde86b7ce";
const AUDITED_CODE_COMMIT = "735a43f9c13976f59c7457e3674382a691d81437";
const FACTS_SHA256 = "sha256:1b09f8246046de1c94eaf993c13a08f4916f5801aa6c38d22b948a4315bee92c";
const AUDIT_SHA256 = "sha256:70bdfdb8110a8f16e52dd24613496706d3efa1f6f43bb5542c2032e2d22583bb";
const DESCRIPTOR_SHA256 = "sha256:62a3af33f8ecf33d5f4dcbddd827d0c8f983d34ca599b3654742e0bd89c7d4df";
const DESCRIPTOR_BYTES_SHA256 = "sha256:99d167b1137646a622f92d7ba72754fef37bf51cdda0111f990d15aa8be9cb01";
const PROTECTED_INPUT_SHA256 = "sha256:5bd197624e8b9496e2a88d262858447342f21aaf11be1581825050aa1b6b1518";
const FULL_LIVE_AUTHORITY_ID = "e6eff3f9-f0fe-48b6-a638-56a42a0f30bd";
const CONSUMED_AUTHORITY_ID = "v2-13-full-live-20260829-052951z-6852970d";
const TERMINAL_STATE_SHA256 = "sha256:f59fc1f3f989ff9b694053d911d9e38921e3f14b6e850afd2d5472318efdf2a9";
const TAG = "videoforge-v2-13-release-20260826-v3";
// Historical terminal validation must remain reproducible after a successor reseals the live
// validator. These are the exact predecessor and execution-control bytes approved for this
// consumed attempt; never import their mutable successor constants from the current validator.
const HISTORICAL_PREDECESSOR_RELEASE_ATTEMPT = Object.freeze({
  authority_id: "v2-13-full-live-20260829-022710z-62a9ebb2",
  authority_record_commit: "7e43a289a58b7ab0805f019fcfe82d0efa2c2848",
  proposal_sha256: "sha256:62a9ebb284b9e117f29077c84a213a051376914eb54a797dc746b81cea1f29c6",
  terminal_state_sha256: "sha256:1dbf573b408507cbe4eecb813e0e6ec5564153f96183a3329d5fd06b5342969b",
  terminal_state: "CONSUMED_SINGLE_EXECUTION_CLEANUP_COMPLETE_NO_RETRY",
  terminal: "CLEANUP_PROOFS_RECORDED_ZERO_WORKER_BILLING_RESOURCES_RECONCILED",
  failure_code: "APPROVAL_BRANCH_READBACK",
  exact_tag_name: TAG,
  exact_tag_target_commit: RELEASE_SOURCE_COMMIT,
  tag_create_result_sha256: "sha256:29d68b30b0f866fb40a32de97f6a08f6e27799790822a3bfb7409704cd9df5fc",
  tag_push_result_sha256: "sha256:f71b313cebd5080cb72cc48731ef48992d0987a37cf7d245b180a765c9f3036b",
  tag_readback_result_sha256: "sha256:e2f8d0a1a471423ac43c5031f65ff052a334eb29e9b6f922f569dcd9287c43ad",
});
const HISTORICAL_V4_EXECUTION_CONTROL_COMPONENTS = Object.freeze({
  approval_validator: Object.freeze({
    path: "deploy/v2-13/validate-full-live-approval.mjs",
    source_commit_tree_binding: Object.freeze({
      mode: "EXTERNAL_GIT_COMMIT_TREE_ENTRY",
      commit_field: "source.execution_control.commit",
      tree_entry_path: "deploy/v2-13/validate-full-live-approval.mjs",
      verification: "GIT_SHOW_EXACT_COMMIT_PATH_THEN_SHA256",
      embedded_current_file_sha256: false,
      self_hash_forbidden: true,
    }),
  }),
  full_live_adapters: Object.freeze({
    path: "deploy/v2-13/full-live-adapters.mjs",
    sha256: "sha256:3d7e6f2dfb320b2fe4f2f36a17bcd8b53b39ad8f271e0c60928ec7d6069033e0",
  }),
  full_live_executor: Object.freeze({
    path: "deploy/v2-13/full-live-executor.mjs",
    sha256: "sha256:d3c642c9a5a80a419acb6d5b6f9a842b9fa2fca40bbdb330ad141032f019bb1c",
  }),
  guarded_activation: Object.freeze({
    path: "deploy/v2-13/guarded-activation.mjs",
    sha256: "sha256:7522808e31aa83d92bd5d8bcdc768438ba11ce5cd69f6fd8be45e0671148fa85",
  }),
  materialization_seed_builder: Object.freeze({
    path: "deploy/v2-13/build-materialization-seed.mjs",
    sha256: "sha256:51c6f167f0681ed1287f72d1d60a6524e7d912302c3b2ca1e1d380ce20a3d2ea",
  }),
  orchestration_authority: Object.freeze({
    path: "deploy/v2-13/full-live-orchestration-authority.mjs",
    sha256: "sha256:81fb706019a2255a220e23fde21ea137016139617d4357f160cc715b141b52af",
  }),
  source_closure_manifest: Object.freeze({
    path: "deploy/v2-13/full-live-source-closure.json",
    sha256: "sha256:4d348ad85f803ad36ea3c3e3df54dfb601af45e308bfd55282c1d9ed1340433b",
  }),
});
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
const { bytes: terminalStateBytes, value: terminalState } = await readJson(TERMINAL_STATE_PATH, "TERMINAL_STATE");
assert(sha256(auditBytes) === AUDIT_SHA256, "AUDIT_SHA256");
assert(sha256(factsBytes) === FACTS_SHA256, "FACTS_SHA256");
assert(sha256(terminalStateBytes) === TERMINAL_STATE_SHA256, "TERMINAL_STATE_SHA256");
assert(
  terminalState.authority_id === CONSUMED_AUTHORITY_ID &&
    terminalState.state === "CONSUMED_SINGLE_EXECUTION_CLEANUP_COMPLETE_NO_RETRY" &&
    terminalState.terminal === "CLEANUP_PROOFS_RECORDED_ZERO_WORKER_BILLING_RESOURCES_RECONCILED" &&
    terminalState.no_redispatch === true,
  "TERMINAL_STATE_CONTRACT",
);
assert(
  audit.schema_version === "videoforge.v2-13-full-live-source-readiness-audit/v1" &&
    audit.audited_code_commit === AUDITED_CODE_COMMIT &&
    audit.audit_result === "PASS_READY_TO_RESEAL" &&
    audit.evidence_class === "INDEPENDENT_RELEASE_AUDIT" &&
    audit.fixture_or_fake_transport_used === false &&
    audit.external_calls === 0 && audit.provider_mutations === 0 && audit.gpu_use === 0 && audit.spend_usd === 0 &&
    audit.source_closure?.sha256 === HISTORICAL_V4_EXECUTION_CONTROL_COMPONENTS.source_closure_manifest.sha256,
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
const { bytes: descriptorBytes, value: descriptor } = await readJson(DESCRIPTOR_PATH, "DESCRIPTOR");
assert(
  sha256(descriptorBytes) === DESCRIPTOR_BYTES_SHA256 &&
    descriptor.sourceCommit === RELEASE_SOURCE_COMMIT &&
    descriptor.descriptorSha256 === DESCRIPTOR_SHA256,
  "DESCRIPTOR_CONTRACT",
);

assert(
  proposal.schema_version === "videoforge.v2-13-full-live-completion-proposal/v4" &&
    proposal.task_id === "VF-10-13" && proposal.proposal_status === "PENDING_FRESH_EXACT_USER_APPROVAL" &&
    proposal.source?.release_source_commit === RELEASE_SOURCE_COMMIT &&
    proposal.source?.repaired_release_source_commit === RELEASE_SOURCE_COMMIT &&
    proposal.source?.proposal_record_commit === null &&
    proposal.source?.execution_control?.commit === EXECUTION_CONTROL_COMMIT,
  "PROPOSAL_IDENTITY",
);
assert(
  Object.values(proposal.source.exact_release_components).every(
    (component) =>
      component !== null &&
      typeof component === "object" &&
      typeof component.path === "string" &&
      !component.path.startsWith("/") &&
      !component.path.split("/").includes("..") &&
      (typeof component.sha256 === "string" ||
        component.source_commit_tree_binding?.mode === "EXTERNAL_GIT_COMMIT_TREE_ENTRY"),
  ),
  "IMMUTABLE_PAYLOAD_COMPONENTS",
);
assert(JSON.stringify(proposal.source.execution_control.exact_components) === JSON.stringify(HISTORICAL_V4_EXECUTION_CONTROL_COMPONENTS), "EXECUTION_CONTROL_COMPONENTS");
assert(
  JSON.stringify(proposal.supersession?.predecessor_release_attempt) === JSON.stringify(HISTORICAL_PREDECESSOR_RELEASE_ATTEMPT) &&
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
const bridgePolicy = proposal.exact_execution_graph.prequalification_bridge_policy;
assert(
  dbBootstrap.post_bootstrap_receipt_verifier?.verifies_exact_operator_acl === true,
  "PREQUALIFICATION_RECEIPT_VERIFIER",
);
assert(
  bridgePolicy.receipt_gate?.verifier_function === "verifyPrequalificationDatabaseReceipt",
  "PREQUALIFICATION_RECEIPT_GATE",
);
assert(
  bridgePolicy.executor_receipt_gate?.restart_preflight?.repeat_receipt_verifier === true,
  "PREQUALIFICATION_EXECUTOR_RECEIPT_GATE",
);
assert(
  JSON.stringify(
    bridgePolicy.operator_only_preflight?.fresh_child_forbidden_database_inputs,
  ) === JSON.stringify(["ownerDatabaseUrl", "runtimeDatabaseUrl", "reconcilerDatabaseUrl"]),
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

for (const [name, component] of Object.entries(proposal.source.exact_release_components)) {
  if (typeof component.sha256 === "string") assert(sha256(gitBytes(RELEASE_SOURCE_COMMIT, component.path)) === component.sha256, `PAYLOAD:${name}`);
}
for (const [name, component] of Object.entries(HISTORICAL_V4_EXECUTION_CONTROL_COMPONENTS)) {
  const componentBytes = gitBytes(EXECUTION_CONTROL_COMMIT, component.path);
  if (name !== "approval_validator") assert(sha256(componentBytes) === component.sha256, `CONTROL:${name}`);
}
assert(
  gitBytes(EXECUTION_CONTROL_COMMIT, "deploy/v2-13/validate-full-live-approval.mjs").length > 0 &&
    HISTORICAL_V4_EXECUTION_CONTROL_COMPONENTS.approval_validator.source_commit_tree_binding
      .tree_entry_path === "deploy/v2-13/validate-full-live-approval.mjs",
  "CONTROL:approval_validator",
);

const policies = proposal.exact_execution_graph;
assert(
  Array.isArray(policies.ordered_operation_ids) &&
    policies.ordered_operation_ids.length === 26 &&
    new Set(policies.ordered_operation_ids).size === 26,
  "OPERATIONS",
);
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

assert(git("rev-parse", `${PROPOSAL_RECORD_COMMIT}^`) === EXECUTION_CONTROL_COMMIT, "PROPOSAL_RECORD_PARENT");
const proposalRecordPaths = git("diff-tree", "--no-commit-id", "--name-only", "-r", PROPOSAL_RECORD_COMMIT)
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
const head = PROPOSAL_RECORD_COMMIT;
assert(git("rev-parse", `${EXECUTION_CONTROL_COMMIT}^`) === AUDITED_CODE_COMMIT, "EVIDENCE_PARENT");
const evidencePaths = git("diff-tree", "--no-commit-id", "--name-only", "-r", EXECUTION_CONTROL_COMMIT).split("\n").filter(Boolean).sort();
assert(JSON.stringify(evidencePaths) === JSON.stringify([
  "project-context/evidence/acceptance/VF-10-13/2026-08-27-cloudflare-credential-origin-repair-candidate/source-readiness-audit.json",
  "project-context/evidence/acceptance/VF-10-13/materialization-seed-facts.json",
]), "EVIDENCE_COMMIT_PATHS");
for (const name of ["user-approval.json", "approved-authority.json"])
  await access(path.join(DIRECTORY, name)).then(() => assert(false, `ACTIVE_${name}`), () => true);

assert(
  proposal.exact_execution_graph.ordered_operation_ids.length === 26,
  "HISTORICAL_EXECUTOR_GRAPH",
);
assert(sha256(proposalBytes) === PROPOSAL_SHA256, "PROPOSAL_SHA256");

process.stdout.write(`${JSON.stringify({
  schema_version: "videoforge.v2-13-terminal-candidate-validation/v1",
  status: "PASS_TERMINAL_ARCHIVE_REPRODUCIBLE",
  state: terminalState.state,
  authority: CONSUMED_AUTHORITY_ID,
  reusable: false,
  no_redispatch: true,
  superseded_authority_id: proposal.supersession.superseded_authority_id,
  superseded_proposal_sha256: proposal.supersession.supersedes_proposal_sha256,
  proposal_sha256: sha256(proposalBytes),
  terminal_state_sha256: TERMINAL_STATE_SHA256,
  release_source_commit: RELEASE_SOURCE_COMMIT,
  execution_control_commit: EXECUTION_CONTROL_COMMIT,
  predecessor_terminal_state_sha256: HISTORICAL_PREDECESSOR_RELEASE_ATTEMPT.terminal_state_sha256,
  external_calls: 0,
  mutations: 0,
  gpu_use: 0,
  spend_usd: 0,
})}\n`);

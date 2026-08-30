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
  EXACT_PREDECESSOR_MAGE_RECONCILIATION_POLICY,
  EXACT_PREDECESSOR_RELEASE_ATTEMPT,
  EXACT_TERMINAL_FAILED_SUCCESSOR_ATTEMPT,
  EXACT_PREQUALIFICATION_BRIDGE_POLICY,
  EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY,
  EXACT_TRUSTED_TIME_POLICY,
  EXACT_V4_EXECUTION_CONTROL_COMPONENTS,
  EXACT_V5_RELEASE_COMPONENTS,
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
const RELEASE_SOURCE_COMMIT = "417e84d4f021699337e9bd411753777d689728d7";
const EXECUTION_CONTROL_COMMIT = "731ee45a9aa2641e1a0b941b3e04e99a686645fb";
const AUDITED_CODE_COMMIT = "cbbb38d173175bc417a98594cec60d1c31c9949e";
const FACTS_SHA256 = "sha256:3adee421edb98f921b1a18ca9483157af32801632d9269e3953d7aaf29c23c09";
const AUDIT_SHA256 = "sha256:ba3637f2707439a387f2b92427bb75c58f6b1dd421345e16cddb25ffbfa1d5a8";
const DESCRIPTOR_SHA256 = "sha256:9f1491160c953a4f75e09fa3ef4ba2574ea139c87db8f3b220eac9b0bde86c6f";
const PROTECTED_INPUT_SHA256 = "sha256:f21111919884a3270e5e98484998f3fecb67741593d716ae4b674ac7ef750b72";
const FULL_LIVE_AUTHORITY_ID = "a48680cb-6a46-412b-8531-488d86d374d3";
const SUPERSEDED_PROPOSAL_SHA256 =
  "sha256:d3bfbb4039a894ed469abfa303d3fbc50a7ad7e358de19b730e4229602ab598d";
const SUPERSEDED_PROPOSAL_RECORD_COMMIT = "c2b90f8a6f443978ef013ef6daed4750f4e2e2ec";
const SUPERSEDED_AUTHORITY_ID = "v2-13-full-live-20260830-021108z-d3bfbb40";
const SUPERSEDED_AUTHORITY_RECORD_COMMIT = "4e199ca114bfd9d5850c616fc4a237214f6c9ae5";
const SUPERSEDED_TERMINAL_SHA256 =
  "sha256:76e52ec7a273cda26ec1c87ba473f060927d85218560ccef3ee8f0a045aa064e";
const TAG = "videoforge-v2-13-release-20260830-v5";
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
const HISTORICAL_PROPOSAL_SHA256 =
  "sha256:6852970d91153a5c61fcee5b4f1f8bac717cd6c302538b71dda3ff8dde86b7ce";
const HISTORICAL_AUDIT_SHA256 =
  "sha256:70bdfdb8110a8f16e52dd24613496706d3efa1f6f43bb5542c2032e2d22583bb";
const HISTORICAL_FACTS_SHA256 =
  "sha256:1b09f8246046de1c94eaf993c13a08f4916f5801aa6c38d22b948a4315bee92c";
if (
  sha256(auditBytes) === HISTORICAL_AUDIT_SHA256 &&
  sha256(factsBytes) === HISTORICAL_FACTS_SHA256
) {
  const historicalProposal = JSON.parse(
    gitBytes(
      "1ba62090c763cb4993cd5f9806e63c6629be1997",
      "project-context/evidence/acceptance/VF-10-13/2026-08-27-cloudflare-credential-origin-repair-candidate/combined-live-proposal.json",
    ).toString("utf8"),
  );
  const historicalRouteReadback =
    proposal.source?.pending_source_contract?.route_readbacks?.pre_mutation;
  assert(
    JSON.stringify(historicalRouteReadback) ===
      JSON.stringify(historicalProposal.source.pending_source_contract.route_readbacks.pre_mutation),
    "ROUTE_READBACK_CONTRACT",
  );
  const historicalCloudflareScope = proposal.requested_scope?.cloudflare_credential_scope;
  assert(
    historicalCloudflareScope?.cloudflare_api_token_environment_export_authorized === false &&
      historicalCloudflareScope?.raw_api_token_file_authorized === false &&
      JSON.stringify(historicalCloudflareScope?.oauth_scopes) ===
        JSON.stringify(EXACT_OAUTH_SCOPES),
    "CLOUDFLARE_OAUTH_SCOPE",
  );
  const historicalCloudflareGraph =
    proposal.exact_execution_graph?.cloudflare_credential_origin_policy?.oauth_authentication;
  assert(
    historicalCloudflareGraph?.protected_config_reader === "readWranglerOAuthCredential" &&
      JSON.stringify(historicalCloudflareGraph?.oauth_scopes) ===
        JSON.stringify(EXACT_OAUTH_SCOPES),
    "CLOUDFLARE_GRAPH",
  );
  assert(
    proposal.requested_scope?.google_oauth_web_client_scope?.authorized_redirect_uri_count === 1,
    "GOOGLE_OAUTH_SCOPE",
  );
  assert(
    proposal.requested_scope?.r2_s3_credential_scope?.new_r2_bucket_authorized === false,
    "R2_S3_SCOPE",
  );
  assert(
    proposal.exact_execution_graph?.internal_materialization_policy
      ?.materialization_seed_sha256_verified_after_restart_or_recovery === true,
    "MATERIALIZATION_SEED_OUTER_BINDING",
  );
  assert(
    proposal.supersession?.superseded_authority_record_sha256 ===
      historicalProposal.supersession.superseded_authority_record_sha256,
    "SUPERSESSION_AUTHORITY_RECORD",
  );
  assert(
    proposal.exact_execution_graph?.credential_scope_policy?.google_oauth
      ?.authorized_operation ===
      "READBACK_EXACTLY_ONE_PREEXISTING_PROTECTED_GOOGLE_OAUTH_WEB_CLIENT",
    "CREDENTIAL_GRAPH_GOOGLE",
  );
  assert(
    proposal.approval_request?.requested_r2_s3_scope ===
      historicalProposal.approval_request.requested_r2_s3_scope,
    "APPROVAL_SCOPE_BOUND",
  );
  const historicalDbPolicy =
    historicalProposal.exact_execution_graph.prequalification_database_bootstrap_policy;
  const historicalBridge =
    historicalProposal.exact_execution_graph.prequalification_bridge_policy;
  const actualDbPolicy =
    proposal.exact_execution_graph?.prequalification_database_bootstrap_policy;
  const actualBridge = proposal.exact_execution_graph?.prequalification_bridge_policy;
  assert(
    JSON.stringify(actualDbPolicy?.post_bootstrap_receipt_verifier) ===
      JSON.stringify(historicalDbPolicy.post_bootstrap_receipt_verifier),
    "PREQUALIFICATION_RECEIPT_VERIFIER",
  );
  assert(
    JSON.stringify(actualBridge?.receipt_gate) ===
      JSON.stringify(historicalBridge.receipt_gate),
    "PREQUALIFICATION_RECEIPT_GATE",
  );
  assert(
    JSON.stringify(actualBridge?.executor_receipt_gate) ===
      JSON.stringify(historicalBridge.executor_receipt_gate),
    "PREQUALIFICATION_EXECUTOR_RECEIPT_GATE",
  );
  assert(
    JSON.stringify(actualBridge?.operator_only_preflight?.fresh_child_forbidden_database_inputs) ===
      JSON.stringify(
        historicalBridge.operator_only_preflight.fresh_child_forbidden_database_inputs,
      ),
    "PREQUALIFICATION_FRESH_CHILD_SEAM",
  );
  assert(
    proposal.requested_scope?.retention?.mage_volume_id_sha256 === MAGE_VOLUME_ID_SHA256 &&
      proposal.requested_scope?.retention?.soulx_volume_id_sha256 === SOULX_VOLUME_ID_SHA256,
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
  assert(sha256(proposalBytes) === HISTORICAL_PROPOSAL_SHA256, "HISTORICAL_PROPOSAL_SHA256");
  const historicalArchive = path.join(
    ROOT,
    "protected-inputs/v2-13/history/v2-13-full-live-20260829-052951z-6852970d",
  );
  const { bytes: historicalTerminalBytes, value: historicalTerminal } = await readJson(
    path.join(historicalArchive, "full-live-state.json"),
    "HISTORICAL_TERMINAL",
  );
  const { bytes: historicalDescriptorBytes, value: historicalDescriptor } = await readJson(
    path.join(historicalArchive, "static-release-descriptor.json"),
    "HISTORICAL_DESCRIPTOR",
  );
  assert(
    sha256(auditBytes) === HISTORICAL_AUDIT_SHA256 &&
      sha256(factsBytes) === HISTORICAL_FACTS_SHA256 &&
      sha256(historicalTerminalBytes) ===
        "sha256:f59fc1f3f989ff9b694053d911d9e38921e3f14b6e850afd2d5472318efdf2a9" &&
      sha256(historicalDescriptorBytes) ===
        "sha256:99d167b1137646a622f92d7ba72754fef37bf51cdda0111f990d15aa8be9cb01" &&
      sha256(await readFile(path.join(historicalArchive, "materialization-seed-input.json"))) ===
        "sha256:5bd197624e8b9496e2a88d262858447342f21aaf11be1581825050aa1b6b1518",
    "HISTORICAL_ARCHIVE_HASH",
  );
  assert(
    proposal.source?.execution_control?.commit ===
      "62e361e15de53369910e60226f27859b5b5a7f08" &&
      proposal.source?.release_source_commit === RELEASE_SOURCE_COMMIT &&
      facts.full_live_authority_id === "e6eff3f9-f0fe-48b6-a638-56a42a0f30bd" &&
      historicalDescriptor.descriptorSha256 ===
        "sha256:62a3af33f8ecf33d5f4dcbddd827d0c8f983d34ca599b3654742e0bd89c7d4df" &&
      historicalTerminal.authority_id ===
        "v2-13-full-live-20260829-052951z-6852970d" &&
      historicalTerminal.state ===
        "CONSUMED_SINGLE_EXECUTION_CLEANUP_COMPLETE_NO_RETRY" &&
      historicalTerminal.terminal ===
        "CLEANUP_PROOFS_RECORDED_ZERO_WORKER_BILLING_RESOURCES_RECONCILED" &&
      historicalTerminal.no_redispatch === true,
    "HISTORICAL_ARCHIVE_CONTRACT",
  );
  process.stdout.write(
    `${JSON.stringify({
      schema_version: "videoforge.v2-13-terminal-candidate-validation/v1",
      status: "PASS_TERMINAL_ARCHIVE_REPRODUCIBLE",
      state: historicalTerminal.state,
      authority: historicalTerminal.authority_id,
      superseded_authority_id: historicalTerminal.authority_id,
      superseded_proposal_sha256: HISTORICAL_PROPOSAL_SHA256,
      reusable: false,
      no_redispatch: true,
      terminal_state_sha256:
        "sha256:f59fc1f3f989ff9b694053d911d9e38921e3f14b6e850afd2d5472318efdf2a9",
      external_calls: 0,
      mutations: 0,
      gpu_use: 0,
      spend_usd: 0,
    })}\n`,
  );
  process.exit(0);
}
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
const { value: descriptor } = await readJson(DESCRIPTOR_PATH, "DESCRIPTOR");
const workflowRegistrationEvidence = {
  schema_version: "videoforge.v213-soulx-workflow-registration-evidence/v2",
  repository: "Pala-LakshmanSai/videoforge",
  default_branch: "main",
  default_branch_commit: "c24d37e164d3fcf93c04d53a1e8f06ab972c5d46",
  workflow_id: 345299384,
  workflow_path: ".github/workflows/avatar-primary-serverless-image.yml",
  workflow_file: "avatar-primary-serverless-image.yml",
  workflow_name: "avatar-primary-serverless-image",
  workflow_state: "active",
  release_source_commit: RELEASE_SOURCE_COMMIT,
  release_source_workflow_sha256:
    "sha256:9d6f37d1369b4b50de8053efb252b39c8728a51e578593ddafcfc9f02aa28ac2",
  default_branch_workflow_sha256:
    "sha256:14b242f63d6afc8bece80acbbb73f1fde6bac9df280f1b9b1d58e8e038a6e8da",
  default_branch_matches_release_source: false,
  registration_state: "REGISTERED_ACTIVE_DEFAULT_BRANCH_RELEASE_REF_BOUND",
  materialized: true,
  default_branch_registration_only: true,
  evidence_sha256:
    "sha256:2f3cedd3c7c6e228570e6839c8d62d89823b09d6a8ced4d62171482609f2fc15",
};
assert(
  JSON.stringify(Object.fromEntries(Object.entries(descriptor.workflowRegistrationEvidence).sort())) ===
    JSON.stringify(Object.fromEntries(Object.entries(workflowRegistrationEvidence).sort())) &&
    JSON.stringify(Object.fromEntries(Object.entries(proposal.sealing?.workflow_registration_evidence ?? {}).sort())) ===
      JSON.stringify(Object.fromEntries(Object.entries(workflowRegistrationEvidence).sort())) &&
    JSON.stringify(Object.fromEntries(Object.entries(proposal.requested_scope?.workflow_registration_evidence ?? {}).sort())) ===
      JSON.stringify(Object.fromEntries(Object.entries(workflowRegistrationEvidence).sort())),
  "WORKFLOW_REGISTRATION_EVIDENCE",
);

assert(
  proposal.schema_version === "videoforge.v2-13-full-live-completion-proposal/v5" &&
    proposal.task_id === "VF-10-13" && proposal.proposal_status === "PENDING_FRESH_EXACT_USER_APPROVAL" &&
    proposal.source?.release_source_commit === RELEASE_SOURCE_COMMIT &&
    proposal.source?.repaired_release_source_commit === RELEASE_SOURCE_COMMIT &&
    proposal.source?.proposal_record_commit === null &&
    proposal.source?.execution_control?.commit === EXECUTION_CONTROL_COMMIT,
  "PROPOSAL_IDENTITY",
);
assert(JSON.stringify(proposal.source.exact_release_components) === JSON.stringify(EXACT_V5_RELEASE_COMPONENTS), "SUCCESSOR_PAYLOAD_COMPONENTS");
assert(JSON.stringify(proposal.source.execution_control.exact_components) === JSON.stringify(EXACT_V4_EXECUTION_CONTROL_COMPONENTS), "EXECUTION_CONTROL_COMPONENTS");
assert(
  JSON.stringify(proposal.supersession?.predecessor_release_attempt) === JSON.stringify(EXACT_PREDECESSOR_RELEASE_ATTEMPT) &&
    JSON.stringify(proposal.supersession?.terminal_failed_successor_attempt) ===
      JSON.stringify(EXACT_TERMINAL_FAILED_SUCCESSOR_ATTEMPT) &&
    proposal.supersession?.prior_approval_reusable === false && proposal.supersession?.fresh_exact_approval_required === true,
  "PREDECESSOR_BINDING",
);
const supersededTerminalPath = path.join(
  ROOT,
  "protected-inputs/v2-13/history/v2-13-full-live-20260830-021108z-d3bfbb40/full-live-state.json",
);
const { bytes: supersededTerminalBytes, value: supersededTerminal } = await readJson(
  supersededTerminalPath,
  "SUPERSEDED_TERMINAL",
);
assert(
  sha256(supersededTerminalBytes) === SUPERSEDED_TERMINAL_SHA256 &&
    supersededTerminal.authority_id === SUPERSEDED_AUTHORITY_ID &&
    supersededTerminal.authority_record_commit === SUPERSEDED_AUTHORITY_RECORD_COMMIT &&
    supersededTerminal.proposal_sha256 === SUPERSEDED_PROPOSAL_SHA256 &&
    supersededTerminal.state === "CONSUMED_SINGLE_EXECUTION_CLEANUP_COMPLETE_NO_RETRY" &&
    supersededTerminal.terminal ===
      "CLEANUP_PROOFS_RECORDED_ZERO_WORKER_BILLING_RESOURCES_RECONCILED" &&
    supersededTerminal.failure_boundary === "OPERATION_EXECUTION" &&
    supersededTerminal.failure_code === "WORKFLOW_RUN_TERMINAL_FAILURE" &&
    supersededTerminal.total_reserved_usd === 0 &&
    supersededTerminal.total_settled_usd === 0 &&
    proposal.supersession?.supersedes_proposal_sha256 === SUPERSEDED_PROPOSAL_SHA256 &&
    proposal.supersession?.supersedes_proposal_record_commit ===
      SUPERSEDED_PROPOSAL_RECORD_COMMIT &&
    proposal.supersession?.superseded_authority_id === SUPERSEDED_AUTHORITY_ID &&
    proposal.supersession?.superseded_approval_record_path.startsWith(
      `git:${SUPERSEDED_AUTHORITY_RECORD_COMMIT}:`,
    ) &&
    proposal.supersession?.superseded_authority_record_path.startsWith(
      `git:${SUPERSEDED_AUTHORITY_RECORD_COMMIT}:`,
    ),
  "SUPERSEDED_TERMINAL_BINDING",
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
    "sha256:4e45de5838c53064e68aed1700b39aa26e8545f7e723df5baa98e0d4e2c546bb",
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

for (const [name, component] of Object.entries(EXACT_V5_RELEASE_COMPONENTS)) {
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
  [policies.predecessor_mage_reconciliation_policy, EXACT_PREDECESSOR_MAGE_RECONCILIATION_POLICY, "MAGE_RECONCILIATION_POLICY"],
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
const requestedDatabase = scope.database;
assert(
  requestedDatabase.prequalification_database_bootstrap_operator_function_signature_count === 45 &&
    JSON.stringify(requestedDatabase.exact_operator_function_signatures) ===
      JSON.stringify(EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.exact_operator_function_signatures) &&
    requestedDatabase.prequalification_database_bootstrap_credentials_materialized_after_migration_prefix_commit_count === 49 &&
    requestedDatabase.prequalification_database_bootstrap_operator_dsn_value_read_after_migration_prefix_commit_count === 49 &&
    JSON.stringify(requestedDatabase.prequalification_database_bootstrap_recovery_mode_ledger_before_count) ===
      JSON.stringify(EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.recovery_mode_ledger_before_count) &&
    requestedDatabase.prequalification_database_bootstrap_recovery_mode_final_ledger_count === 49 &&
    JSON.stringify(requestedDatabase.exact_recoverable_prefix_counts) ===
      JSON.stringify([37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48]) &&
    JSON.stringify(requestedDatabase.exact_migrations_to_apply) ===
      JSON.stringify([37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49]),
  "REQUESTED_DATABASE_LEDGER49_BINDING",
);
const ref = proposal.immutable_github_release_ref_request;
assert(
  ref?.creation_requested === true && ref?.exact_tag_name === TAG && ref?.exact_target_commit === RELEASE_SOURCE_COMMIT &&
    ref?.maximum_new_refs === 1 && ref?.predecessor_bound_reconciliation_only === false &&
    ref?.successor_tag_mutation_authorized === true && ref?.force_update_authorized === false && ref?.delete_or_retarget_authorized === false,
  "SUCCESSOR_TAG_CREATION",
);
assert(
  proposal.authority?.exact_proposal_approved === false && proposal.authority?.execute_authorized === false &&
    proposal.authority?.credential_access_authorized === false && proposal.authority?.provider_calls_authorized === false &&
    proposal.authority?.provider_mutations_authorized === false && proposal.authority?.gpu_use_authorized === false &&
    proposal.authority?.external_spend_authorized === false && proposal.authority?.immutable_release_ref_creation_authorized === false,
  "NO_ACTIVE_AUTHORITY",
);
assert(
  proposal.stop_conditions.some((item) => item.includes("successor tag")) &&
    proposal.stop_conditions.some((item) => item.includes("replay")) &&
    proposal.stop_conditions.some((item) => item.includes("drift or uncertainty")),
  "STOP_CONDITIONS",
);

const head = git("rev-parse", "HEAD");
if (head !== EXECUTION_CONTROL_COMMIT) {
  const allowedProposalRecordPaths = new Set([
    "project-context/00_START_HERE.md",
    "project-context/CURRENT_STATE.yaml",
    "project-context/evidence/acceptance/VF-10-13/2026-08-27-cloudflare-credential-origin-repair-candidate/combined-live-proposal.json",
    "project-context/evidence/acceptance/VF-10-13/2026-08-27-cloudflare-credential-origin-repair-candidate/validate-candidate.mjs",
    "project-context/tasks/VF-10-13.md",
  ]);
  const proposalRecordCommits = git(
    "rev-list",
    "--first-parent",
    "--reverse",
    `${EXECUTION_CONTROL_COMMIT}..${head}`,
  )
    .split("\n")
    .filter(Boolean);
  assert(proposalRecordCommits.length > 0, "PROPOSAL_RECORD_CHAIN");
  let parent = EXECUTION_CONTROL_COMMIT;
  for (const commit of proposalRecordCommits) {
    assert(git("rev-parse", `${commit}^`) === parent, "PROPOSAL_RECORD_PARENT");
    const proposalRecordPaths = git("diff-tree", "--no-commit-id", "--name-only", "-r", commit)
      .split("\n")
      .filter(Boolean);
    assert(
      proposalRecordPaths.length > 0 &&
        proposalRecordPaths.every((relativePath) => allowedProposalRecordPaths.has(relativePath)),
      "PROPOSAL_RECORD_PATHS",
    );
    parent = commit;
  }
}
const proposalRecordPaths = new Set([
  "project-context/00_START_HERE.md",
  "project-context/CURRENT_STATE.yaml",
  "project-context/evidence/acceptance/VF-10-13/2026-08-27-cloudflare-credential-origin-repair-candidate/combined-live-proposal.json",
  "project-context/evidence/acceptance/VF-10-13/2026-08-27-cloudflare-credential-origin-repair-candidate/validate-candidate.mjs",
  "project-context/tasks/VF-10-13.md",
]);
const evidencePaths = new Set([
  "project-context/evidence/acceptance/VF-10-13/2026-08-27-cloudflare-credential-origin-repair-candidate/source-readiness-audit.json",
  "project-context/evidence/acceptance/VF-10-13/materialization-seed-facts.json",
]);
const evidenceCommits = git(
  "rev-list",
  "--first-parent",
  "--reverse",
  `${AUDITED_CODE_COMMIT}..${EXECUTION_CONTROL_COMMIT}`,
)
  .split("\n")
  .filter(Boolean);
assert(
  JSON.stringify(evidenceCommits) ===
    JSON.stringify([
      "e3b6d5aa843c8aede2eef536d62b8543d28e1eaa",
      "6f0b4df7d2698c907c4c5179ab2a688722f9bd69",
      EXECUTION_CONTROL_COMMIT,
    ]),
  "EVIDENCE_COMMIT_CHAIN",
);
let evidenceParent = AUDITED_CODE_COMMIT;
for (const commit of evidenceCommits) {
  assert(git("rev-parse", `${commit}^`) === evidenceParent, "EVIDENCE_PARENT");
  const changed = git("diff-tree", "--no-commit-id", "--name-only", "-r", commit)
    .split("\n")
    .filter(Boolean);
  assert(
    changed.length > 0 && changed.every((relativePath) => evidencePaths.has(relativePath)),
    "EVIDENCE_COMMIT_PATHS",
  );
  evidenceParent = commit;
}
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

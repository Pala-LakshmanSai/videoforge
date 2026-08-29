import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

import {
  authorizeCleanupWork,
  authorizeReleaseCertification,
  authorizeWork,
  beginPhase,
  completeCleanupOnly,
  completePhase,
  enterCleanupOnly,
  initialConsumptionRecord,
  PHASES,
  recordCleanupProof,
  recordVerifiedReleaseRef,
  settleWork,
  settleCleanupWork,
  settleReleaseCertification,
  trustedCommitLineage,
  updateState,
  validateMaterializationSeedFile,
  validateOuterAuthority,
  validateStaticReleaseDescriptorFile,
  validateState,
  writeExclusive,
} from "../../deploy/v2-13/full-live-orchestration-authority.mjs";
import {
  EXACT_APPROVAL_VALIDATOR_SOURCE_BINDING,
  EXACT_BOOTSTRAP_PARTIAL_CLEANUP_POLICY,
  EXACT_CLOUDFLARE_SECRET_NAMES,
  EXACT_DURABLE_BILLING_POLICY,
  EXACT_EARLY_NO_DATABASE_CLEANUP_POLICY,
  EXACT_CRASH_SAFE_CLEANUP_POLICY,
  EXACT_IMAGE_WORKFLOW_VERIFICATION_POLICY,
  EXACT_INTERNAL_MATERIALIZATION_POLICY,
  EXACT_OPERATION_IDS,
  EXACT_PREDECESSOR_MAGE_RECONCILIATION_POLICY,
  EXACT_PREDECESSOR_RELEASE_ATTEMPT,
  EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY,
  EXACT_PREQUALIFICATION_BRIDGE_POLICY,
  EXACT_V3_RELEASE_COMPONENTS,
  EXACT_V4_EXECUTION_CONTROL_COMPONENTS,
  EXACT_WORKFLOW_START_AUTHORITY_POLICY,
  EXACT_TRUSTED_TIME_POLICY,
  EXPECTED_SERVERLESS_FLEX_RATE_USD_PER_GPU_HOUR,
  assertDistinctV4SuccessorAuthority,
  validateFullLiveUserApproval,
} from "../../deploy/v2-13/validate-full-live-approval.mjs";
import { materializationSeedFixture } from "./fixtures/v2-13-materialization-seed.mjs";

const directory =
  "project-context/evidence/acceptance/VF-10-13/2026-08-26-full-activation-candidate";
const proposalBytes = readFileSync(`${directory}/combined-live-proposal.json`);
const approvalBytes = readFileSync(`${directory}/user-approval.json`);
const currentApproval = JSON.parse(approvalBytes);
currentApproval.approval.gpu.maximum_serverless_flex_rate_usd_per_gpu_hour =
  EXPECTED_SERVERLESS_FLEX_RATE_USD_PER_GPU_HOUR;
const currentApprovalBytes = Buffer.from(`${JSON.stringify(currentApproval)}\n`);
const authorityBytes = readFileSync(`${directory}/approved-authority.json`);
const proposalSha256 = "sha256:f2d183e7668152c25b54b3844cc340058ecb5f59dec58689d6eb229328bcae32";
const proposalRecordCommit = "e3bdabc161c60e5334c4055b5636b7fd768a86df";
const releaseSourceCommit = "407dc070f4b83bd78b1d4aa1cb546ec63c91f32f";
const v3ReleaseSourceCommit = "e737eac44458a04c7de47a0f3f42d82cb9506d47";
const hash = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const proof = (letter) => `sha256:${letter.repeat(64)}`;
const approvalValidatorPath = "deploy/v2-13/validate-full-live-approval.mjs";
const canonicalJson = (value) =>
  Array.isArray(value)
    ? `[${value.map((item) => canonicalJson(item)).join(",")}]`
    : value !== null && typeof value === "object"
      ? `{${Object.keys(value)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
          .join(",")}}`
      : JSON.stringify(value);

function workflowRegistrationEvidenceFixture(sourceCommit = "a".repeat(40)) {
  const workflowSha256 = hash(Buffer.from("avatar-primary-serverless-image workflow\n"));
  const unsigned = {
    schema_version: "videoforge.v213-soulx-workflow-registration-evidence/v1",
    repository: "Pala-LakshmanSai/videoforge",
    default_branch: "main",
    default_branch_commit: "b".repeat(40),
    workflow_file: "avatar-primary-serverless-image.yml",
    workflow_name: "avatar-primary-serverless-image",
    workflow_path: ".github/workflows/avatar-primary-serverless-image.yml",
    default_branch_workflow_sha256: workflowSha256,
    release_source_commit: sourceCommit,
    release_source_workflow_sha256: workflowSha256,
    registration_state: "REGISTERED_EXACT_DEFAULT_BRANCH",
    materialized: true,
    bound_to_release_source: true,
  };
  return { ...unsigned, evidence_sha256: hash(Buffer.from(canonicalJson(unsigned))) };
}

function staticReleaseDescriptorFixture(
  sourceCommit = "a".repeat(40),
  schemaVersion = "videoforge.v213-static-release-descriptor/v1",
) {
  const sourceEvidenceSha256 = proof("1");
  const fact = (gate, claims, metrics) => ({
    claims,
    evidenceClass: "INDEPENDENT_RELEASE_AUDIT",
    evidencePath: `project-context/evidence/acceptance/VF-10-13/${gate}.json`,
    fixtureOrFakeTransportUsed: false,
    gate,
    metrics,
    observedAt: "2026-08-27T23:52:08.000Z",
    observerId: "codex.runtime-contract-audit",
    sourceEvidenceSha256,
  });
  const unsigned = {
    auditFacts: {
      backup_restore_ready: fact(
        "backup_restore_ready",
        [
          "backup_readback_passed",
          "restore_evidence_accepted",
          "schema_migration_disposition_recorded",
        ],
        {
          backupReadbackPassed: true,
          restoreEvidenceAccepted: true,
          schemaMigrationDisposition: "DISPOSABLE_RESTORE_COMPLETED",
        },
      ),
      operations_runbooks_ready: fact(
        "operations_runbooks_ready",
        ["stuck_job_runbook", "provider_outage_runbook", "billing_runbook", "rollback_runbook"],
        {
          billingRunbookSha256: proof("2"),
          providerOutageRunbookSha256: proof("3"),
          rollbackRunbookSha256: proof("4"),
          stuckJobRunbookSha256: proof("5"),
        },
      ),
      production_transport_real: fact(
        "production_transport_real",
        [
          "hosted_client_api_truth",
          "fixture_controls_absent",
          "fake_gpu_absent",
          "fake_transport_absent",
          "manual_pod_controls_absent",
          "legacy_dispatch_exports_absent",
        ],
        {
          fakeGpuProfileInBundle: false,
          fakeTransportInBundle: false,
          fixtureControlsInBundle: false,
          hostedClientApiTruth: true,
          legacyDispatchExportsInBundle: false,
          manualPodControlsInBundle: false,
        },
      ),
      security_clear: fact(
        "security_clear",
        [
          "p0_zero",
          "p1_zero",
          "auth_tenant_boundary_passed",
          "ssrf_path_upload_boundary_passed",
          "secret_log_scan_passed",
          "cost_amplification_guards_passed",
          "legacy_runtime_bundle_scan_passed",
        ],
        {
          authTenantPassed: true,
          costAmplificationGuardsPassed: true,
          legacyRuntimeBundleScanPassed: true,
          p0Count: 0,
          p1Count: 0,
          secretLogScanPassed: true,
          ssrfPathUploadPassed: true,
        },
      ),
    },
    contractBundleSha256: proof("6"),
    productionUrlSha256: proof("7"),
    schemaVersion,
    sourceCommit,
    ...(schemaVersion === "videoforge.v213-static-release-descriptor/v2"
      ? { workflowRegistrationEvidence: workflowRegistrationEvidenceFixture(sourceCommit) }
      : {}),
  };
  return {
    ...unsigned,
    descriptorSha256: hash(Buffer.from(canonicalJson(unsigned))),
  };
}

function writeStaticReleaseDescriptor(path, value) {
  writeFileSync(path, `${canonicalJson(value)}\n`, { mode: 0o600 });
}

function withApprovalValidatorReleaseTree(bytes, callback) {
  const repository = mkdtempSync(join(tmpdir(), "videoforge-approval-validator-tree-"));
  const oldGitDirectory = process.env.GIT_DIR;
  const oldGitWorkTree = process.env.GIT_WORK_TREE;
  const environment = { ...process.env, GIT_CONFIG_NOSYSTEM: "1" };
  delete environment.GIT_DIR;
  delete environment.GIT_WORK_TREE;
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: repository,
      encoding: "utf8",
      env: environment,
      maxBuffer: 4 * 1024 * 1024,
    }).trim();
  try {
    git("init", "--quiet");
    git("config", "user.email", "videoforge-tests@example.invalid");
    git("config", "user.name", "VideoForge Tests");
    mkdirSync(join(repository, dirname(approvalValidatorPath)), { recursive: true });
    writeFileSync(join(repository, approvalValidatorPath), bytes);
    git("add", "--all");
    git("commit", "--quiet", "-m", "release source");
    const releaseSourceCommit = git("rev-parse", "HEAD");
    const releaseSourceTree = git("rev-parse", "HEAD^{tree}");
    process.env.GIT_DIR = join(repository, ".git");
    process.env.GIT_WORK_TREE = repository;
    return callback(releaseSourceCommit, repository, releaseSourceTree);
  } finally {
    if (oldGitDirectory === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = oldGitDirectory;
    if (oldGitWorkTree === undefined) delete process.env.GIT_WORK_TREE;
    else process.env.GIT_WORK_TREE = oldGitWorkTree;
    rmSync(repository, { recursive: true, force: true });
  }
}

function repairExactPolicyFixture(proposal) {
  if (proposal.source?.execution_control) {
    proposal.source.execution_control.exact_components = structuredClone(
      EXACT_V4_EXECUTION_CONTROL_COMPONENTS,
    );
  }
  proposal.exact_execution_graph.ordered_operation_ids = [...EXACT_OPERATION_IDS];
  proposal.exact_execution_graph.internal_materialization_policy = structuredClone(
    EXACT_INTERNAL_MATERIALIZATION_POLICY,
  );
  proposal.exact_execution_graph.prequalification_database_bootstrap_policy = structuredClone(
    EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY,
  );
  proposal.exact_execution_graph.prequalification_bridge_policy = structuredClone(
    EXACT_PREQUALIFICATION_BRIDGE_POLICY,
  );
  proposal.exact_execution_graph.image_workflow_verification_policy = structuredClone(
    EXACT_IMAGE_WORKFLOW_VERIFICATION_POLICY,
  );
  if (proposal.schema_version === "videoforge.v2-13-full-live-completion-proposal/v4")
    proposal.exact_execution_graph.predecessor_mage_reconciliation_policy = structuredClone(
      EXACT_PREDECESSOR_MAGE_RECONCILIATION_POLICY,
    );
  else delete proposal.exact_execution_graph.predecessor_mage_reconciliation_policy;
  proposal.exact_execution_graph.trusted_time_policy = structuredClone(EXACT_TRUSTED_TIME_POLICY);
  proposal.exact_execution_graph.workflow_start_authority_policy = structuredClone(
    EXACT_WORKFLOW_START_AUTHORITY_POLICY,
  );
  proposal.exact_execution_graph.early_no_database_cleanup_policy = structuredClone(
    EXACT_EARLY_NO_DATABASE_CLEANUP_POLICY,
  );
  proposal.exact_execution_graph.bootstrap_partial_cleanup_policy = structuredClone(
    EXACT_BOOTSTRAP_PARTIAL_CLEANUP_POLICY,
  );
  proposal.exact_execution_graph.crash_safe_cleanup_policy = structuredClone(
    EXACT_CRASH_SAFE_CLEANUP_POLICY,
  );
  proposal.exact_execution_graph.durable_billing_policy = structuredClone(
    EXACT_DURABLE_BILLING_POLICY,
  );
  return proposal;
}

function repairExactDatabaseScope() {
  const bootstrap = EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY;
  return {
    exact_operator_role: "videoforge_hosted_operator",
    exact_runtime_role: "videoforge_hosted_runtime",
    exact_reconciler_role: "videoforge_hosted_reconciler",
    roles_must_be_fresh_absent_distinct_login_noinherit_hardened: true,
    pgcrypto_required: true,
    prequalification_database_bootstrap_operator_function_signature_count:
      bootstrap.exact_operator_function_signature_count,
    prequalification_database_bootstrap_operator_function_signature_namespace:
      bootstrap.exact_operator_function_signature_namespace,
    prequalification_database_bootstrap_operator_function_signature_canonicalization:
      bootstrap.exact_operator_function_signature_canonicalization,
    prequalification_database_bootstrap_operator_acl_comparison:
      bootstrap.exact_operator_function_acl_comparison,
    prequalification_database_bootstrap_public_execute_readback_count:
      bootstrap.public_function_execute_readback_count,
    prequalification_database_bootstrap_public_default_execute_readback_count:
      bootstrap.public_default_function_execute_readback_count,
    prequalification_database_bootstrap_ownership_catalogs: [...bootstrap.ownership_catalogs],
    prequalification_database_bootstrap_ownership_readback_is_cluster_wide:
      bootstrap.ownership_readback_is_cluster_wide,
    prequalification_database_bootstrap_requires_consumed_outer_authority:
      bootstrap.requires_consumed_outer_authority,
    prequalification_database_bootstrap_credential_bundle_schema:
      bootstrap.database_role_credential_bundle_schema,
    prequalification_database_bootstrap_credential_bundle_path:
      bootstrap.database_role_credential_bundle_path,
    prequalification_database_bootstrap_credentials_absent_before_consumed_bootstrap:
      bootstrap.database_role_credentials_absent_before_consumed_bootstrap,
    prequalification_database_bootstrap_credentials_materialized_after_migration_prefix_commit_count:
      bootstrap.database_role_credentials_materialized_after_migration_prefix_commit_count,
    prequalification_database_bootstrap_credential_roles: [
      ...bootstrap.database_role_credentials_exact_roles,
    ],
    prequalification_database_bootstrap_runtime_reconciler_credentials_staged_roles_absent_until_guarded_activation:
      bootstrap.runtime_and_reconciler_credentials_staged_but_roles_remain_absent_until_guarded_activation,
    prequalification_database_bootstrap_exact_one_time_database_role_credential_count:
      bootstrap.exact_one_time_database_role_credential_count,
    prequalification_database_bootstrap_exact_one_time_database_role_credential_scope:
      bootstrap.exact_one_time_database_role_credential_scope,
    prequalification_database_bootstrap_exact_one_time_internal_production_credential_count:
      bootstrap.exact_one_time_internal_production_credential_count,
    prequalification_database_bootstrap_exact_one_time_internal_production_credential_scope: [
      ...bootstrap.exact_one_time_internal_production_credential_scope,
    ],
    prequalification_database_bootstrap_operator_dsn_value_read_after_migration_prefix_commit_count:
      bootstrap.operator_dsn_policy.value_read_after_migration_prefix_commit_count,
    prequalification_database_bootstrap_operator_dsn_value_read_forbidden_before_migration_prefix_commit:
      bootstrap.operator_dsn_policy.value_read_forbidden_before_migration_prefix_commit,
    prequalification_database_bootstrap_phase: bootstrap.phase,
    prequalification_database_bootstrap_phase_cap_usd: bootstrap.phase_cap_usd,
    prequalification_database_bootstrap_receipt_path: bootstrap.receipt_path,
    prequalification_database_bootstrap_receipt_hash_field: bootstrap.receipt_hash_field,
    prequalification_database_bootstrap_receipt_replay_cas_required:
      bootstrap.receipt_replay_cas_required,
    prequalification_database_bootstrap_recovery_mode_ledger_before_count: structuredClone(
      bootstrap.recovery_mode_ledger_before_count,
    ),
    prequalification_database_bootstrap_recovery_mode_final_ledger_count:
      bootstrap.recovery_mode_final_ledger_count,
    exact_operator_function_signatures: [...bootstrap.exact_operator_function_signatures],
    exact_initial_ledger_prefix_count: 36,
    exact_recoverable_prefix_counts: [37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48],
    exact_migrations_to_apply: [37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49],
  };
}

function v3Fixture({ releaseSourceCommit = v3ReleaseSourceCommit } = {}) {
  const v3Directory =
    "project-context/evidence/acceptance/VF-10-13/2026-08-26-full-activation-ref-role-repair-candidate";
  const v3Proposal = JSON.parse(readFileSync(`${v3Directory}/combined-live-proposal.json`));
  v3Proposal.proposal_status = "PENDING_FRESH_EXACT_USER_APPROVAL";
  v3Proposal.sealing.sealed_for_exact_user_approval = true;
  v3Proposal.sealing.current_bytes_are_approval_ineligible = false;
  v3Proposal.source.release_source_commit = releaseSourceCommit;
  delete v3Proposal.source.base_source_commit_before_semantic_tag_repair;
  v3Proposal.immutable_github_release_ref_request.exact_target_commit = releaseSourceCommit;
  repairExactPolicyFixture(v3Proposal);
  v3Proposal.requested_scope.database = repairExactDatabaseScope(
    v3Proposal.requested_scope.database,
  );
  v3Proposal.authority_record_commit_binding.materialization_seed_sha256_required_in_authority_and_consumption_state = true;
  v3Proposal.authority_record_commit_binding.materialization_seed_sha256_must_be_verified_before_execution = true;
  v3Proposal.source.exact_release_components = structuredClone(EXACT_V3_RELEASE_COMPONENTS);
  const staticReleaseDescriptor = {
    path: `${v3Directory}/static-release-descriptor.json`,
    sha256: proof("d"),
  };
  v3Proposal.requested_scope.static_release_descriptor = structuredClone(staticReleaseDescriptor);
  v3Proposal.sealing.static_release_descriptor = structuredClone(staticReleaseDescriptor);
  const fullLiveAuthorityId = "11111111-1111-4111-8111-111111111111";
  const materializationSeedFacts = {
    commit_field: "source.release_source_commit",
    full_live_authority_id: fullLiveAuthorityId,
    path: "project-context/evidence/acceptance/VF-10-13/materialization-seed-facts.json",
    sha256: proof("c"),
  };
  v3Proposal.requested_scope.materialization_seed_facts = structuredClone(materializationSeedFacts);
  v3Proposal.sealing.materialization_seed_facts = structuredClone(materializationSeedFacts);
  const v3ProposalBytes = Buffer.from(`${JSON.stringify(v3Proposal, null, 2)}\n`);
  const v3ProposalSha256 = hash(v3ProposalBytes);
  const v3Commit = "f".repeat(40);
  const approval = structuredClone(JSON.parse(currentApprovalBytes));
  approval.schema_version = "videoforge.v2-13-full-live-user-approval/v2";
  approval.authority_id = "v2-13-v3-test-authority-0001";
  approval.proposal = {
    path: `${v3Directory}/combined-live-proposal.json`,
    sha256: v3ProposalSha256,
    proposal_record_commit: v3Commit,
    release_source_commit: releaseSourceCommit,
  };
  approval.approval.immutable_github_release_ref = {
    creation_authorized: true,
    exact_tag_name: "videoforge-v2-13-release-20260826-v3",
    exact_target_commit: releaseSourceCommit,
    tag_kind: "LIGHTWEIGHT",
    maximum_new_refs: 1,
    force_update_authorized: false,
    delete_or_retarget_authorized: false,
    other_ref_creation_authorized: false,
  };
  approval.approval.database_roles = {
    exact_operator_role: "videoforge_hosted_operator",
    exact_runtime_role: "videoforge_hosted_runtime",
    exact_reconciler_role: "videoforge_hosted_reconciler",
    roles_must_be_fresh_absent_distinct_login_noinherit_hardened: true,
    exact_one_time_credential_count:
      EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.exact_one_time_database_role_credential_count,
    exact_credential_scope:
      EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.exact_one_time_database_role_credential_scope,
    generated_only_after_consumption: true,
    other_database_credential_creation_or_rotation_forbidden: true,
  };
  approval.approval.internal_production_credentials = {
    exact_one_time_count:
      EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.exact_one_time_internal_production_credential_count,
    exact_scope: [
      ...EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.exact_one_time_internal_production_credential_scope,
    ],
    generated_only_after_consumption: true,
    other_credential_creation_or_rotation_forbidden: true,
  };
  const orderedApproval = {};
  for (const [key, value] of Object.entries(approval)) {
    orderedApproval[key] = value;
    if (key === "authority_id") orderedApproval.full_live_authority_id = fullLiveAuthorityId;
  }
  delete orderedApproval.statement;
  orderedApproval.static_release_descriptor = structuredClone(staticReleaseDescriptor);
  orderedApproval.statement = `I approve ${v3ProposalSha256} at ${v3Commit} with USD 17.50, USD 7 per month, no fallback, tag videoforge-v2-13-release-20260826-v3, and roles videoforge_hosted_operator, videoforge_hosted_runtime and videoforge_hosted_reconciler.`;
  const v3ApprovalBytes = Buffer.from(`${JSON.stringify(orderedApproval, null, 2)}\n`);
  const authority = structuredClone(JSON.parse(authorityBytes));
  authority.authority_id = orderedApproval.authority_id;
  authority.full_live_authority_id = orderedApproval.full_live_authority_id;
  authority.status = "APPROVED_UNCONSUMED_PENDING_FRESH_EXECUTION_INPUTS";
  authority.approved_at = orderedApproval.approved_at;
  authority.expires_at = orderedApproval.expires_at;
  authority.lineage = {
    proposal_path: orderedApproval.proposal.path,
    proposal_sha256: v3ProposalSha256,
    proposal_record_commit: v3Commit,
    release_source_commit: releaseSourceCommit,
    user_approval_path: `${v3Directory}/user-approval.json`,
    user_approval_sha256: hash(v3ApprovalBytes),
  };
  authority.combined_execution_authority.maximum_cumulative_finite_runpod_spend_usd = 17.5;
  for (const key of [
    "execute_authorized",
    "credential_access_authorized",
    "database_mutation_authorized",
    "cloudflare_secret_mutation_authorized",
    "deployment_authorized",
    "provider_calls_authorized",
    "provider_mutations_authorized",
    "gpu_use_authorized",
    "external_runpod_spend_authorized",
  ])
    authority.combined_execution_authority[key] = true;
  authority.github_release_ref = {
    required_for_workflow_dispatch: true,
    exact_target_commit: releaseSourceCommit,
    exact_tag_name: "videoforge-v2-13-release-20260826-v3",
    ref_creation_authorized_by_approved_proposal: true,
    status: "AUTHORIZED_EXACT_SINGLE_REF_PENDING_CREATION",
    external_action_taken: false,
  };
  authority.materialization_seed_sha256 = proof("a");
  authority.static_release_descriptor = structuredClone(orderedApproval.static_release_descriptor);
  authority.outer_orchestration.approval_schema_validator_sha256 = hash(
    readFileSync("deploy/v2-13/validate-full-live-approval.mjs"),
  );
  authority.outer_orchestration.orchestration_tool_sha256 = hash(
    readFileSync("deploy/v2-13/full-live-orchestration-authority.mjs"),
  );
  authority.outer_orchestration.guarded_activation_sha256 = hash(
    readFileSync("deploy/v2-13/guarded-activation.mjs"),
  );
  authority.outer_orchestration.full_live_executor_sha256 = hash(
    readFileSync("deploy/v2-13/full-live-executor.mjs"),
  );
  return {
    approvalBytes: v3ApprovalBytes,
    authority,
    authorityBytes: Buffer.from(`${JSON.stringify(authority, null, 2)}\n`),
    proposalBytes: v3ProposalBytes,
  };
}

function activeProposalFixture() {
  const activeProposal = JSON.parse(
    readFileSync(
      "project-context/evidence/acceptance/VF-10-13/2026-08-27-cloudflare-credential-origin-repair-candidate/combined-live-proposal.json",
    ),
  );
  repairExactPolicyFixture(activeProposal);
  activeProposal.supersession.predecessor_release_attempt = structuredClone(
    EXACT_PREDECESSOR_RELEASE_ATTEMPT,
  );
  activeProposal.requested_scope.database = repairExactDatabaseScope(
    activeProposal.requested_scope.database,
  );
  return activeProposal;
}

function v4ApprovalFixture() {
  const proposal = activeProposalFixture();
  const proposalBytes = Buffer.from(`${JSON.stringify(proposal, null, 2)}\n`);
  const proposalSha256 = hash(proposalBytes);
  const proposalRecordCommit = "e".repeat(40);
  const approval = JSON.parse(v3Fixture().approvalBytes);
  approval.schema_version = "videoforge.v2-13-full-live-user-approval/v3";
  approval.authority_id = "v2-13-v4-test-authority-0001";
  approval.full_live_authority_id =
    proposal.requested_scope.materialization_seed_facts.full_live_authority_id;
  approval.proposal = {
    path: proposal.source.proposal_path,
    sha256: proposalSha256,
    proposal_record_commit: proposalRecordCommit,
    release_source_commit: proposal.source.release_source_commit,
    execution_control_commit: proposal.source.execution_control.commit,
  };
  approval.approval.immutable_github_release_ref = {
    creation_authorized: false,
    exact_tag_name: proposal.immutable_github_release_ref_request.exact_tag_name,
    exact_target_commit: proposal.immutable_github_release_ref_request.exact_target_commit,
    tag_kind: "LIGHTWEIGHT",
    maximum_new_refs: 0,
    force_update_authorized: false,
    delete_or_retarget_authorized: false,
    other_ref_creation_authorized: false,
    predecessor_bound_reconciliation_only: true,
    successor_tag_mutation_authorized: false,
  };
  approval.static_release_descriptor = structuredClone(
    proposal.requested_scope.static_release_descriptor,
  );
  approval.statement = `I approve ${proposalSha256} at ${proposalRecordCommit}, execution control ${proposal.source.execution_control.commit}, predecessor terminal ${proposal.supersession.predecessor_release_attempt.terminal_state_sha256}, with USD 17.50, USD 7 per month, no fallback, readback-only tag videoforge-v2-13-release-20260826-v3, and roles videoforge_hosted_operator, videoforge_hosted_runtime and videoforge_hosted_reconciler.`;
  return {
    approvalBytes: Buffer.from(`${JSON.stringify(approval, null, 2)}\n`),
    proposal,
    proposalBytes,
    proposalRecordCommit,
    proposalSha256,
  };
}

function freshStateFixture() {
  return withApprovalValidatorReleaseTree(readFileSync(approvalValidatorPath), (releaseCommit) => {
    const fixture = v3Fixture({ releaseSourceCommit: releaseCommit });
    const { validated } = validateOuterAuthority(fixture);
    const state = initialConsumptionRecord(fixture.authority, fixture.authorityBytes, {
      ...validated,
      authorityRecordCommit: "e".repeat(40),
      approvalRecordPath: "project-context/evidence/acceptance/VF-10-13/test/user-approval.json",
      authorityRecordPath:
        "project-context/evidence/acceptance/VF-10-13/test/approved-authority.json",
    });
    // State mutations validate against the source-sealed executor identity. The V3 authority fixture
    // intentionally hashes current dirty bytes so validateOuterAuthority can exercise future source;
    // normalize only the derived state fixture back to the proposal-bound executor component.
    state.full_live_executor_sha256 = EXACT_V3_RELEASE_COMPONENTS.full_live_executor.sha256;
    return state;
  });
}

const exactCleanupSafetyOperationIds = [
  "restore-endpoints-max-one",
  "prove-zero-workers",
  "read-settled-billing",
  "reconcile-exact-resources",
];

function authorizeExactCleanupSafetyWork(state, { settle = true } = {}) {
  for (const [index, operationId] of exactCleanupSafetyOperationIds.entries()) {
    const workId = `${state.authority_id}:${operationId}`.toLowerCase();
    authorizeCleanupWork(state, {
      workId,
      eventId: `${state.authority_id}:${operationId}:authorized`.toLowerCase(),
    });
    if (settle)
      settleCleanupWork(state, {
        workId,
        eventId: `${state.authority_id}:${operationId}:settled`.toLowerCase(),
        result: { proofSha256: proof(String(index + 1)) },
      });
  }
}

test("V4 successor authority identity is distinct before outer consumption", () => {
  const predecessor = { authority_id: "v2-13-predecessor-authority" };
  assert.equal(
    assertDistinctV4SuccessorAuthority(
      "videoforge.v2-13-full-live-completion-proposal/v4",
      "v2-13-successor-authority",
      predecessor,
    ),
    true,
  );
  assert.throws(
    () =>
      assertDistinctV4SuccessorAuthority(
        "videoforge.v2-13-full-live-completion-proposal/v4",
        predecessor.authority_id,
        predecessor,
      ),
    /SUCCESSOR_AUTHORITY_REPLAY/u,
  );
  assert.equal(
    assertDistinctV4SuccessorAuthority(
      "videoforge.v2-13-full-live-completion-proposal/v3",
      predecessor.authority_id,
      predecessor,
    ),
    true,
  );
});

test("exact full-live approval schema binds proposal, caps, GPU, retention, and expiry", () => {
  const result = validateFullLiveUserApproval({
    proposalBytes,
    approvalBytes: currentApprovalBytes,
    expectedProposalSha256: proposalSha256,
    expectedProposalRecordCommit: proposalRecordCommit,
    expectedReleaseSourceCommit: releaseSourceCommit,
  });
  assert.equal(result.authorityId, "v2-13-full-live-20260826-033320z-e3bdabc");
  assert.equal(result.maximumCumulativeFiniteRunpodSpendUsd, 17.5);
  assert.equal(
    Object.values(result.phaseCapsUsd).reduce((sum, value) => sum + value, 0),
    17.5,
  );
});

test("V4 approval authorizes predecessor-bound tag reconciliation with zero successor refs", () => {
  const fixture = v4ApprovalFixture();
  const result = validateFullLiveUserApproval({
    proposalBytes: fixture.proposalBytes,
    approvalBytes: fixture.approvalBytes,
    expectedProposalSha256: fixture.proposalSha256,
    expectedProposalRecordCommit: fixture.proposalRecordCommit,
    expectedReleaseSourceCommit: fixture.proposal.source.release_source_commit,
  });
  assert.equal(result.proposalSchema, "videoforge.v2-13-full-live-completion-proposal/v4");
  assert.equal(result.executionControlCommit, fixture.proposal.source.execution_control.commit);
});

test("V4 successor preserves Mage operation IDs while forbidding predecessor redispatch", () => {
  const { proposal } = v4ApprovalFixture();
  assert.deepEqual(
    proposal.exact_execution_graph.predecessor_mage_reconciliation_policy,
    EXACT_PREDECESSOR_MAGE_RECONCILIATION_POLICY,
  );
  assert.deepEqual(proposal.exact_execution_graph.ordered_operation_ids.slice(4, 6), [
    "mage-image-workflow-dispatch",
    "mage-image-workflow-verification",
  ]);
  assert.equal(
    proposal.exact_execution_graph.predecessor_mage_reconciliation_policy
      .workflow_dispatch_authorized,
    false,
  );
  assert.equal(
    proposal.exact_execution_graph.predecessor_mage_reconciliation_policy.redispatch_authorized,
    false,
  );

  const drifted = structuredClone(proposal);
  drifted.exact_execution_graph.predecessor_mage_reconciliation_policy.workflow_dispatch_authorized = true;
  const proposalBytes = Buffer.from(`${JSON.stringify(drifted, null, 2)}\n`);
  const approval = JSON.parse(v4ApprovalFixture().approvalBytes);
  approval.proposal.sha256 = hash(proposalBytes);
  approval.statement = approval.statement.replace(/sha256:[0-9a-f]{64}/u, hash(proposalBytes));
  assert.throws(
    () =>
      validateFullLiveUserApproval({
        proposalBytes,
        approvalBytes: Buffer.from(`${JSON.stringify(approval, null, 2)}\n`),
        expectedProposalSha256: hash(proposalBytes),
        expectedProposalRecordCommit: approval.proposal.proposal_record_commit,
        expectedReleaseSourceCommit: drifted.source.release_source_commit,
      }),
    /V3_SUPERSESSION_OR_AUTHORITY/u,
  );
});

test("approval rejects a Serverless Flex rate above the exact current snapshot", () => {
  const overCap = structuredClone(JSON.parse(currentApprovalBytes));
  overCap.approval.gpu.maximum_serverless_flex_rate_usd_per_gpu_hour =
    EXPECTED_SERVERLESS_FLEX_RATE_USD_PER_GPU_HOUR + 0.000001;
  assert.throws(
    () =>
      validateFullLiveUserApproval({
        proposalBytes,
        approvalBytes: Buffer.from(`${JSON.stringify(overCap)}\n`),
        expectedProposalSha256: proposalSha256,
        expectedProposalRecordCommit: proposalRecordCommit,
        expectedReleaseSourceCommit: releaseSourceCommit,
      }),
    /GPU_RATE_REGION/u,
  );
});

test("outer authority rejects the superseded unconsumed authority", () => {
  assert.throws(
    () => validateOuterAuthority({ proposalBytes, approvalBytes, authorityBytes }),
    /AUTHORITY_CONTRACT/u,
  );
});

test("outer authority accepts only the exact approval validator bytes in the release tree", () => {
  withApprovalValidatorReleaseTree(readFileSync(approvalValidatorPath), (releaseCommit) => {
    const fixture = v3Fixture({ releaseSourceCommit: releaseCommit });
    const result = validateOuterAuthority(fixture);
    assert.equal(
      result.validated.proposalSchema,
      "videoforge.v2-13-full-live-completion-proposal/v3",
    );
    assert.equal(result.validated.releaseSourceCommit, releaseCommit);
    assert.equal(result.validated.exactRuntimeRole, "videoforge_hosted_runtime");
    assert.equal(result.validated.exactOperatorRole, "videoforge_hosted_operator");
    assert.equal(
      result.authority.github_release_ref.status,
      "AUTHORIZED_EXACT_SINGLE_REF_PENDING_CREATION",
    );
  });
});

test("outer authority rejects wrong approval validator bytes in the exact release tree", () => {
  withApprovalValidatorReleaseTree(Buffer.from("wrong validator bytes\n"), (releaseCommit) => {
    const fixture = v3Fixture({ releaseSourceCommit: releaseCommit });
    assert.throws(() => validateOuterAuthority(fixture), /APPROVAL_VALIDATOR_TREE_BYTES/u);
  });
});

test("outer authority rejects a tree object supplied as the release commit", () => {
  withApprovalValidatorReleaseTree(
    readFileSync(approvalValidatorPath),
    (_commit, _repository, tree) => {
      const fixture = v3Fixture({ releaseSourceCommit: tree });
      assert.throws(() => validateOuterAuthority(fixture), /APPROVAL_VALIDATOR_RELEASE_COMMIT/u);
    },
  );
});

test("outer authority rejects validator path drift before invoking the git runner", () => {
  withApprovalValidatorReleaseTree(
    readFileSync(approvalValidatorPath),
    (releaseCommit, repository) => {
      const fixture = v3Fixture({ releaseSourceCommit: releaseCommit });
      fixture.authority.outer_orchestration.approval_schema_validator_path =
        "deploy/v2-13/full-live-executor.mjs";
      fixture.authorityBytes = Buffer.from(`${JSON.stringify(fixture.authority, null, 2)}\n`);
      const tracePath = join(repository, "git-trace.log");
      const oldGitTrace = process.env.GIT_TRACE;
      process.env.GIT_TRACE = tracePath;
      try {
        assert.throws(() => validateOuterAuthority(fixture), /APPROVAL_VALIDATOR_TREE_BINDING/u);
        assert.equal(existsSync(tracePath), false);
      } finally {
        if (oldGitTrace === undefined) delete process.env.GIT_TRACE;
        else process.env.GIT_TRACE = oldGitTrace;
      }
    },
  );
});

test("V3 approval cannot drift from the proposal-sealed static release descriptor", () => {
  const fixture = v3Fixture();
  const approval = JSON.parse(fixture.approvalBytes);
  approval.static_release_descriptor.sha256 = proof("e");
  assert.throws(
    () =>
      validateFullLiveUserApproval({
        proposalBytes: fixture.proposalBytes,
        approvalBytes: Buffer.from(`${JSON.stringify(approval)}\n`),
        expectedProposalSha256: hash(fixture.proposalBytes),
        expectedProposalRecordCommit: "f".repeat(40),
        expectedReleaseSourceCommit: v3ReleaseSourceCommit,
      }),
    /STATIC_RELEASE_DESCRIPTOR_BINDING/u,
  );
});

test("V3 approval exactly authorizes three post-consumption database credentials", () => {
  const fixture = v3Fixture();
  for (const mutate of [
    (approval) => {
      approval.approval.database_roles.exact_one_time_credential_count = 4;
    },
    (approval) => {
      approval.approval.database_roles.exact_credential_scope = "OPERATOR_ONLY";
    },
    (approval) => {
      approval.approval.database_roles.generated_only_after_consumption = false;
    },
    (approval) => {
      approval.approval.database_roles.other_database_credential_creation_or_rotation_forbidden = false;
    },
  ]) {
    const approval = JSON.parse(fixture.approvalBytes);
    mutate(approval);
    assert.throws(
      () =>
        validateFullLiveUserApproval({
          proposalBytes: fixture.proposalBytes,
          approvalBytes: Buffer.from(`${JSON.stringify(approval)}\n`),
          expectedProposalSha256: hash(fixture.proposalBytes),
          expectedProposalRecordCommit: "f".repeat(40),
          expectedReleaseSourceCommit: v3ReleaseSourceCommit,
        }),
      /DATABASE_ROLES/u,
    );
  }
});

test("V3 full-live UUID is exact across sealed facts, approval, and outer authority", () => {
  const fixture = v3Fixture();
  const approval = JSON.parse(fixture.approvalBytes);
  approval.full_live_authority_id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  assert.throws(
    () =>
      validateFullLiveUserApproval({
        proposalBytes: fixture.proposalBytes,
        approvalBytes: Buffer.from(`${JSON.stringify(approval)}\n`),
        expectedProposalSha256: hash(fixture.proposalBytes),
        expectedProposalRecordCommit: "f".repeat(40),
        expectedReleaseSourceCommit: v3ReleaseSourceCommit,
      }),
    /SCHEMA/u,
  );

  const authority = structuredClone(fixture.authority);
  authority.full_live_authority_id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  assert.throws(
    () =>
      validateOuterAuthority({
        ...fixture,
        authority,
        authorityBytes: Buffer.from(`${JSON.stringify(authority)}\n`),
      }),
    /AUTHORITY_LINEAGE/u,
  );

  const proposal = JSON.parse(fixture.proposalBytes);
  proposal.requested_scope.materialization_seed_facts.full_live_authority_id =
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const proposalBytes = Buffer.from(`${JSON.stringify(proposal, null, 2)}\n`);
  assert.throws(
    () =>
      validateFullLiveUserApproval({
        proposalBytes,
        approvalBytes: fixture.approvalBytes,
        expectedProposalSha256: hash(proposalBytes),
        expectedProposalRecordCommit: "f".repeat(40),
        expectedReleaseSourceCommit: v3ReleaseSourceCommit,
      }),
    /V3_SUPERSESSION_OR_AUTHORITY/u,
  );
});

test("protected static release descriptor accepts exact canonical mode-0600 bytes before consumption", () => {
  const directory = mkdtempSync(join(tmpdir(), "videoforge-v213-static-release-authority-"));
  chmodSync(directory, 0o700);
  const descriptorPath = join(directory, "static-release-descriptor.json");
  const descriptor = staticReleaseDescriptorFixture();
  writeStaticReleaseDescriptor(descriptorPath, descriptor);
  try {
    assert.deepEqual(
      validateStaticReleaseDescriptorFile({
        path: descriptorPath,
        expectedSha256: descriptor.descriptorSha256,
        expectedSourceCommit: descriptor.sourceCommit,
      }),
      descriptor,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("descriptor v2 consumption durably copies and hash-binds exact repair evidence", () => {
  withApprovalValidatorReleaseTree(readFileSync(approvalValidatorPath), (releaseCommit) => {
    const fixture = v3Fixture({ releaseSourceCommit: releaseCommit });
    const { validated } = validateOuterAuthority(fixture);
    const descriptor = staticReleaseDescriptorFixture(
      releaseCommit,
      "videoforge.v213-static-release-descriptor/v2",
    );
    const state = initialConsumptionRecord(
      fixture.authority,
      fixture.authorityBytes,
      {
        ...validated,
        authorityRecordCommit: "e".repeat(40),
        approvalRecordPath: "project-context/evidence/acceptance/VF-10-13/test/user-approval.json",
        authorityRecordPath:
          "project-context/evidence/acceptance/VF-10-13/test/approved-authority.json",
      },
      descriptor,
    );
    state.full_live_executor_sha256 = EXACT_V3_RELEASE_COMPONENTS.full_live_executor.sha256;
    assert.equal(
      state.static_release_descriptor_schema_version,
      "videoforge.v213-static-release-descriptor/v2",
    );
    assert.deepEqual(
      state.soulx_workflow_registration_evidence,
      descriptor.workflowRegistrationEvidence,
    );
    assert.equal(
      state.soulx_workflow_registration_evidence_sha256,
      descriptor.workflowRegistrationEvidence.evidence_sha256,
    );
    assert.doesNotThrow(() => validateState(state));
    const drifted = structuredClone(state);
    drifted.soulx_workflow_registration_evidence.default_branch_commit = "c".repeat(40);
    assert.throws(() => validateState(drifted), /WORKFLOW_REGISTRATION_STATE_BINDING/u);
  });
});

test("historical descriptor v1 state remains validation-compatible without the new schema field", () => {
  const historical = freshStateFixture();
  delete historical.static_release_descriptor_schema_version;
  assert.doesNotThrow(() => validateState(historical));
});

test("V4 consume binds the protected descriptor to the immutable release payload commit", () => {
  const source = readFileSync("deploy/v2-13/full-live-orchestration-authority.mjs", "utf8");
  assert.match(
    source,
    /validateStaticReleaseDescriptorFile\(\{[\s\S]*?expectedSourceCommit:\s*validated\.releaseSourceCommit,[\s\S]*?\}\);/u,
  );
  assert.doesNotMatch(source, /expectedSourceCommit:\s*validated\.executionControlCommit\s*\?\?/u);
});

test("protected static release descriptor rejects newline self-hash and exact-key or source drift", () => {
  const directory = mkdtempSync(join(tmpdir(), "videoforge-v213-static-release-drift-"));
  chmodSync(directory, 0o700);
  const descriptorPath = join(directory, "static-release-descriptor.json");
  const assertRejected = (descriptor, expectedSourceCommit, code) => {
    writeStaticReleaseDescriptor(descriptorPath, descriptor);
    assert.throws(
      () =>
        validateStaticReleaseDescriptorFile({
          path: descriptorPath,
          expectedSha256: descriptor.descriptorSha256,
          expectedSourceCommit,
        }),
      code,
    );
  };
  const rehash = (descriptor) => {
    const unsigned = { ...descriptor };
    delete unsigned.descriptorSha256;
    descriptor.descriptorSha256 = hash(Buffer.from(canonicalJson(unsigned)));
    return descriptor;
  };
  try {
    const newlineHashed = staticReleaseDescriptorFixture();
    const newlineUnsigned = { ...newlineHashed };
    delete newlineUnsigned.descriptorSha256;
    newlineHashed.descriptorSha256 = hash(Buffer.from(`${canonicalJson(newlineUnsigned)}\n`));
    assertRejected(newlineHashed, newlineHashed.sourceCommit, /STATIC_RELEASE_DESCRIPTOR_HASH/u);

    const extraKey = { ...staticReleaseDescriptorFixture(), unexpected: true };
    const extraUnsigned = { ...extraKey };
    delete extraUnsigned.descriptorSha256;
    extraKey.descriptorSha256 = hash(Buffer.from(canonicalJson(extraUnsigned)));
    assertRejected(extraKey, extraKey.sourceCommit, /STATIC_RELEASE_DESCRIPTOR_CONTRACT/u);

    const missingKey = staticReleaseDescriptorFixture();
    delete missingKey.productionUrlSha256;
    const missingUnsigned = { ...missingKey };
    delete missingUnsigned.descriptorSha256;
    missingKey.descriptorSha256 = hash(Buffer.from(canonicalJson(missingUnsigned)));
    assertRejected(missingKey, missingKey.sourceCommit, /STATIC_RELEASE_DESCRIPTOR_CONTRACT/u);

    const sourceDrift = staticReleaseDescriptorFixture();
    assertRejected(sourceDrift, "b".repeat(40), /STATIC_RELEASE_DESCRIPTOR_CONTRACT/u);

    const booleanFacts = staticReleaseDescriptorFixture();
    booleanFacts.auditFacts.security_clear = true;
    assertRejected(
      rehash(booleanFacts),
      booleanFacts.sourceCommit,
      /STATIC_RELEASE_DESCRIPTOR_FACTS/u,
    );

    const nullEvidence = staticReleaseDescriptorFixture();
    nullEvidence.auditFacts.security_clear.observerId = null;
    assertRejected(
      rehash(nullEvidence),
      nullEvidence.sourceCommit,
      /STATIC_RELEASE_DESCRIPTOR_FACTS/u,
    );

    const reusedRestore = staticReleaseDescriptorFixture();
    reusedRestore.auditFacts.backup_restore_ready.metrics.schemaMigrationDisposition =
      "V206_RESTORE_REUSED_NO_SCHEMA_CHANGE";
    assertRejected(
      rehash(reusedRestore),
      reusedRestore.sourceCommit,
      /STATIC_RELEASE_DESCRIPTOR_FACTS/u,
    );

    const nonCanonicalObservedAt = staticReleaseDescriptorFixture();
    nonCanonicalObservedAt.auditFacts.operations_runbooks_ready.observedAt = "2026-08-27T23:52:08Z";
    assertRejected(
      rehash(nonCanonicalObservedAt),
      nonCanonicalObservedAt.sourceCommit,
      /STATIC_RELEASE_DESCRIPTOR_FACTS/u,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("protected static release descriptor rejects permissive modes and symlinks", () => {
  const directory = mkdtempSync(join(tmpdir(), "videoforge-v213-static-release-mode-"));
  chmodSync(directory, 0o700);
  const descriptorPath = join(directory, "static-release-descriptor.json");
  const descriptor = staticReleaseDescriptorFixture();
  writeStaticReleaseDescriptor(descriptorPath, descriptor);
  const validate = (path = descriptorPath) =>
    validateStaticReleaseDescriptorFile({
      path,
      expectedSha256: descriptor.descriptorSha256,
      expectedSourceCommit: descriptor.sourceCommit,
    });
  try {
    chmodSync(descriptorPath, 0o644);
    assert.throws(validate, /STATIC_RELEASE_DESCRIPTOR_MODE_OR_TYPE/u);
    chmodSync(descriptorPath, 0o600);
    chmodSync(directory, 0o755);
    assert.throws(validate, /STATIC_RELEASE_DESCRIPTOR_MODE_OR_TYPE/u);
    chmodSync(directory, 0o700);
    const symlinkPath = join(directory, "descriptor-link.json");
    symlinkSync(descriptorPath, symlinkPath);
    assert.throws(() => validate(symlinkPath), /STATIC_RELEASE_DESCRIPTOR_MODE_OR_TYPE/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("approval validator policies match the active sealed proposal exactly", () => {
  const activeProposal = activeProposalFixture();
  assert.equal(
    JSON.stringify(activeProposal.exact_execution_graph.prequalification_database_bootstrap_policy),
    JSON.stringify(EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY),
  );
  assert.equal(
    JSON.stringify(activeProposal.exact_execution_graph.prequalification_bridge_policy),
    JSON.stringify(EXACT_PREQUALIFICATION_BRIDGE_POLICY),
  );
});

test("protected materialization seed binding requires mode-0600 bytes and exact canonical hash", () => {
  const directory = mkdtempSync(join(tmpdir(), "videoforge-v213-seed-authority-"));
  chmodSync(directory, 0o700);
  const seedPath = join(directory, "seed.json");
  const seed = materializationSeedFixture();
  const canonical = (value) =>
    Array.isArray(value)
      ? `[${value.map((item) => canonical(item)).join(",")}]`
      : value !== null && typeof value === "object"
        ? `{${Object.keys(value)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
            .join(",")}}`
        : JSON.stringify(value);
  const expected = hash(Buffer.from(`${canonical(seed)}\n`));
  writeFileSync(seedPath, `${canonical(seed)}\n`, { mode: 0o600 });
  try {
    assert.equal(
      validateMaterializationSeedFile({ path: seedPath, expectedSha256: expected }).sha256,
      expected,
    );
    assert.throws(
      () =>
        validateMaterializationSeedFile({
          path: seedPath,
          expectedSha256: expected,
          expectedFullLiveAuthorityId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        }),
      /MATERIALIZATION_SEED_AUTHORITY_BINDING/u,
    );
    writeFileSync(seedPath, `${JSON.stringify(seed, null, 2)}\n`, { mode: 0o600 });
    assert.throws(
      () => validateMaterializationSeedFile({ path: seedPath, expectedSha256: expected }),
      /MATERIALIZATION_SEED_CANONICAL_BYTES/u,
    );
    writeFileSync(seedPath, `${canonical(seed)}\n`, { mode: 0o600 });
    assert.throws(
      () => validateMaterializationSeedFile({ path: seedPath, expectedSha256: proof("0") }),
      /MATERIALIZATION_SEED_HASH/u,
    );
    chmodSync(seedPath, 0o644);
    assert.throws(
      () => validateMaterializationSeedFile({ path: seedPath, expectedSha256: expected }),
      /MATERIALIZATION_SEED_MODE_OR_TYPE/u,
    );
    chmodSync(seedPath, 0o600);
    const nested = structuredClone(seed);
    nested.production_input_base.commandPayloads.endpointID = null;
    writeFileSync(seedPath, `${canonical(nested)}\n`, { mode: 0o600 });
    const nestedHash = hash(Buffer.from(`${canonical(nested)}\n`));
    assert.throws(
      () => validateMaterializationSeedFile({ path: seedPath, expectedSha256: nestedHash }),
      /MATERIALIZATION_SEED_CONTRACT/u,
    );
    const contractMutations = [
      (value) => {
        value.production_input_base.fullLiveAuthorityId = "not-a-uuid";
      },
      (value) => {
        value.production_input_base.dualLaneInput.accountIdSha256 = proof("0");
      },
      (value) => {
        delete value.production_input_base.dualLaneInput.mage.volumeManifestSha256;
      },
      (value) => {
        value.production_input_base.dualLaneInput.soulx.volumeIdSha256 = proof("0");
      },
      (value) => {
        value.production_input_base.dualLaneInput.envelopeSigningKeyId = "";
      },
      (value) => {
        value.production_input_base.dualLaneInput.billingBaselineUsd = -1;
      },
      (value) => {
        value.production_input_base.dualLaneInput.totalCapUsd = 18;
      },
      (value) => {
        value.production_input_base.dualLaneInput.stageAuthorityPublicKeyPem = "PUBLIC KEY";
      },
      (value) => {
        delete value.production_input_base.dualLaneInput.qualificationCaseDescriptor.cases
          .soulxTimeout;
      },
      (value) => {
        value.production_input_base.dualLaneInput.qualificationCaseDescriptor.cases.mage = {};
      },
      (value) => {
        value.activation_record_base = {};
      },
      (value) => {
        value.config_activation_base = {};
      },
      (value) => {
        value.release_manifest = {};
      },
      (value) => {
        value.promotion_record_base = {};
      },
    ];
    for (const mutate of contractMutations) {
      const invalid = structuredClone(seed);
      mutate(invalid);
      writeFileSync(seedPath, `${canonical(invalid)}\n`, { mode: 0o600 });
      const invalidHash = hash(Buffer.from(`${canonical(invalid)}\n`));
      assert.throws(
        () => validateMaterializationSeedFile({ path: seedPath, expectedSha256: invalidHash }),
        /MATERIALIZATION_SEED_CONTRACT/u,
      );
    }
    for (const [section, key] of [
      ["approval", "googleClientSecret"],
      ["cloudflare", "r2Credential"],
      ["database", "ownerDatabaseUrl"],
      ["release", "futureOutput"],
    ]) {
      const credential = structuredClone(seed);
      credential.promotion_record_base = { [section]: { [key]: "forbidden" } };
      writeFileSync(seedPath, `${canonical(credential)}\n`, { mode: 0o600 });
      const credentialHash = hash(Buffer.from(`${canonical(credential)}\n`));
      assert.throws(
        () => validateMaterializationSeedFile({ path: seedPath, expectedSha256: credentialHash }),
        /MATERIALIZATION_SEED_CONTRACT/u,
      );
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("V3 proposal mutation matrix rejects sealing, source-pin, and operation-order drift", () => {
  const fixture = v3Fixture();
  const mutations = [
    (proposal) => {
      proposal.sealing.sealed_for_exact_user_approval = false;
    },
    (proposal) => {
      proposal.source.exact_release_components.approval_validator.source_commit_tree_binding.mode =
        "CURRENT_WORKTREE_SELF_HASH";
    },
    (proposal) => {
      [
        proposal.exact_execution_graph.ordered_operation_ids[0],
        proposal.exact_execution_graph.ordered_operation_ids[1],
      ] = [
        proposal.exact_execution_graph.ordered_operation_ids[1],
        proposal.exact_execution_graph.ordered_operation_ids[0],
      ];
    },
    (proposal) => {
      proposal.requested_scope.cloudflare_secret_allowlist_count = 21;
    },
    (proposal) => {
      proposal.requested_scope.cloudflare_secret_allowlist =
        proposal.requested_scope.cloudflare_secret_allowlist.slice(0, -1);
    },
    (proposal) => {
      proposal.authority_record_commit_binding.embedded_self_commit_hash_forbidden = false;
    },
    (proposal) => {
      proposal.exact_execution_graph.image_workflow_verification_policy.maximum_reads = 181;
    },
    (proposal) => {
      proposal.exact_execution_graph.image_workflow_verification_policy.verifier_dispatch_authorized = true;
    },
    (proposal) => {
      proposal.exact_execution_graph.image_workflow_verification_policy.deadline_covers_trusted_time_subprocess_poll_subprocess_wait_download_and_evidence_validation = false;
    },
    (proposal) => {
      proposal.exact_execution_graph.internal_materialization_policy.external_mid_run_writer_authorized = false;
    },
    (proposal) => {
      proposal.exact_execution_graph.internal_materialization_policy.records[1].materialize_after_operations.pop();
    },
    (proposal) => {
      proposal.exact_execution_graph.internal_materialization_policy.entry_sha256_is_hash_of_preceding_six_fields = false;
    },
    (proposal) => {
      proposal.exact_execution_graph.internal_materialization_policy.initial_seed_endpoint_identity_fields_present = true;
    },
    (proposal) => {
      proposal.exact_execution_graph.internal_materialization_policy.seed_recursively_rejects_endpoint_identity_key_case_variants = false;
    },
    (proposal) => {
      proposal.exact_execution_graph.internal_materialization_policy.records.find(
        ({ kind }) => kind === "max-one-endpoint-bindings",
      ).rebinds_all_guarded_secret_sha256_entries = 21;
    },
    (proposal) => {
      proposal.exact_execution_graph.internal_materialization_policy.guarded_endpoint_secret_file_names[0] =
        "videoforge_mage_endpoint_id";
    },
    (proposal) => {
      proposal.exact_execution_graph.internal_materialization_policy.records.find(
        ({ kind }) => kind === "cleanup-pre-endpoint-descriptor",
      ).accepted_for_normal_or_acceptance_work = true;
    },
    (proposal) => {
      proposal.exact_execution_graph.internal_materialization_policy.cleanup_pre_endpoint_runtime.exact_child_fd_environment.push(
        "RUNTIME_DATABASE_URL_FD",
      );
    },
    (proposal) => {
      proposal.exact_execution_graph.internal_materialization_policy.cleanup_pre_endpoint_runtime.forbidden_inputs =
        proposal.exact_execution_graph.internal_materialization_policy.cleanup_pre_endpoint_runtime.forbidden_inputs.filter(
          (field) => field !== "exactProductionInput",
        );
    },
    (proposal) => {
      proposal.exact_execution_graph.internal_materialization_policy.cleanup_receipt_finalizer.exact_child_fd_environment.push(
        "RUNPOD_API_KEY_FD",
      );
    },
    (proposal) => {
      proposal.exact_execution_graph.trusted_time_policy.caller_supplied_trusted_time_forbidden = false;
    },
    (proposal) => {
      proposal.exact_execution_graph.trusted_time_policy.normal_or_paid_operation_resume_after_expiry = true;
    },
    (proposal) => {
      proposal.exact_execution_graph.trusted_time_policy.credential_environment_or_authorization_header_allowed = true;
    },
    (proposal) => {
      proposal.exact_execution_graph.trusted_time_policy.curl_disable_is_first_argument = false;
    },
    (proposal) => {
      proposal.exact_execution_graph.trusted_time_policy.proxy_environment_allowed = true;
    },
    (proposal) => {
      proposal.exact_execution_graph.prequalification_database_bootstrap_policy.runpod_calls = 1;
    },
    (proposal) => {
      proposal.exact_execution_graph.prequalification_database_bootstrap_policy.receipt_exact_fields.pop();
    },
    (proposal) => {
      proposal.exact_execution_graph.prequalification_database_bootstrap_policy.receipt_full_exact_fields.pop();
    },
    (proposal) => {
      proposal.exact_execution_graph.prequalification_database_bootstrap_policy.recovery_mode_ledger_before_count.RESUME_EXACT_PREFIX.pop();
    },
    (proposal) => {
      proposal.exact_execution_graph.prequalification_database_bootstrap_policy.guarded_activation_reapplies_migrations_or_operator_role = true;
    },
    (proposal) => {
      proposal.exact_execution_graph.prequalification_database_bootstrap_policy.operator_grants_sql_revoke_public_execute = false;
    },
    (proposal) => {
      proposal.exact_execution_graph.prequalification_database_bootstrap_policy.operator_role_flags.rolinherit = true;
    },
    (proposal) => {
      proposal.exact_execution_graph.prequalification_database_bootstrap_policy.guarded_activation_receipt_verified_before_non_database_application_secret_reads = false;
    },
    (proposal) => {
      proposal.exact_execution_graph.prequalification_database_bootstrap_policy.post_bootstrap_receipt_verifier.cas_before_owner_database_read = false;
    },
    (proposal) => {
      proposal.exact_execution_graph.workflow_start_authority_policy.phase_cap_usd = 1;
    },
    (proposal) => {
      proposal.exact_execution_graph.early_no_database_cleanup_policy.exact_child_fd_environment.push(
        "OPERATOR_DATABASE_URL_FD",
      );
    },
    (proposal) => {
      proposal.exact_execution_graph.bootstrap_partial_cleanup_policy.owner_database_mutation_forbidden = false;
    },
    (proposal) => {
      proposal.exact_execution_graph.durable_billing_policy.reserve_open_liability_before_paid_dispatch = false;
    },
    (proposal) => {
      proposal.exact_execution_graph.crash_safe_cleanup_policy.resumes_only_unsettled_cleanup_work = false;
    },
    (proposal) => {
      proposal.exact_execution_graph.prequalification_bridge_policy.receipt_gate.require_prior_result_and_file_hash_match = false;
    },
    (proposal) => {
      proposal.exact_execution_graph.prequalification_bridge_policy.operator_only_preflight.fresh_child_receives_no_owner_runtime_or_reconciler_dsn = false;
    },
    (proposal) => {
      proposal.exact_execution_graph.prequalification_bridge_policy.executor_receipt_gate.restart_preflight.repeat_receipt_verifier = false;
    },
    (proposal) => {
      proposal.exact_execution_graph.prequalification_bridge_policy.receipt_gate.cas_precedes_all_production_operator_runpod_and_application_secret_reads = false;
    },
    (proposal) => {
      proposal.exact_execution_graph.prequalification_bridge_policy.prequalification_allowed_environment_names.push(
        "VIDEOFORGE_V213_BRIDGE_RUNTIME_DATABASE_URL_FD",
      );
    },
    (proposal) => {
      proposal.exact_execution_graph.prequalification_bridge_policy.staged_full_preflight.bootstrap_receipt_cas_must_have_passed = false;
    },
    (proposal) => {
      proposal.exact_execution_graph.prequalification_bridge_policy.v2_09_post_terminal_chrome_policy.schedule_exactly_once_before_chrome_request = false;
    },
  ];
  for (const mutate of mutations) {
    const proposal = structuredClone(JSON.parse(fixture.proposalBytes));
    mutate(proposal);
    const mutatedBytes = Buffer.from(`${JSON.stringify(proposal, null, 2)}\n`);
    assert.throws(
      () =>
        validateFullLiveUserApproval({
          proposalBytes: mutatedBytes,
          approvalBytes: fixture.approvalBytes,
          expectedProposalSha256: hash(mutatedBytes),
          expectedProposalRecordCommit: "f".repeat(40),
          expectedReleaseSourceCommit: v3ReleaseSourceCommit,
        }),
      /V3_SUPERSESSION_OR_AUTHORITY/u,
    );
  }
});

test("V3 proposal binds authenticated time at every non-cleanup boundary", () => {
  const fixture = v3Fixture();
  const proposal = JSON.parse(fixture.proposalBytes);
  assert.deepEqual(proposal.exact_execution_graph.trusted_time_policy, EXACT_TRUSTED_TIME_POLICY);
  assert.equal(
    proposal.exact_execution_graph.trusted_time_policy.caller_supplied_trusted_time_forbidden,
    true,
  );
  assert.equal(
    proposal.exact_execution_graph.trusted_time_policy
      .credential_environment_or_authorization_header_allowed,
    false,
  );
  assert.equal(
    proposal.exact_execution_graph.trusted_time_policy.ambient_gh_configuration_used,
    false,
  );
  assert.deepEqual(
    proposal.exact_execution_graph.trusted_time_policy.subprocess_environment_exact,
    { PATH: "INHERITED_ONLY_PATH", NO_PROXY: "*", no_proxy: "*" },
  );
  assert.equal(proposal.exact_execution_graph.trusted_time_policy.subprocess_timeout_ms, 12_000);
  assert.equal(
    proposal.exact_execution_graph.trusted_time_policy.normal_or_paid_operation_resume_after_expiry,
    false,
  );
});

test("V3 proposal binds durable prior-result materialization before each consumer", () => {
  const fixture = v3Fixture();
  const proposal = JSON.parse(fixture.proposalBytes);
  assert.deepEqual(
    proposal.exact_execution_graph.internal_materialization_policy,
    EXACT_INTERNAL_MATERIALIZATION_POLICY,
  );
  assert.deepEqual(
    proposal.exact_execution_graph.internal_materialization_policy.records.map(({ kind }) => kind),
    [
      "production-input",
      "max-one-endpoint-bindings",
      "activation-record",
      "promotion-record",
      "post-consumption-command-payloads",
      "cleanup-pre-endpoint-descriptor",
    ],
  );
  const endpointBindings =
    proposal.exact_execution_graph.internal_materialization_policy.records[1];
  assert.equal(endpointBindings.derives_only_from, "receipt.materialization.production");
  assert.deepEqual(
    proposal.exact_execution_graph.internal_materialization_policy
      .guarded_endpoint_secret_file_names,
    [
      "VIDEOFORGE_MAGE_ENDPOINT_ID",
      "VIDEOFORGE_MAGE_ENDPOINT_ID_SHA256",
      "VIDEOFORGE_SOULX_ENDPOINT_ID",
      "VIDEOFORGE_SOULX_ENDPOINT_ID_SHA256",
    ],
  );
  assert.equal(endpointBindings.rebinds_all_guarded_secret_sha256_entries, 22);
  assert.deepEqual(endpointBindings.writes.slice(1, 5), [
    "VIDEOFORGE_MAGE_ENDPOINT_ID",
    "VIDEOFORGE_MAGE_ENDPOINT_ID_SHA256",
    "VIDEOFORGE_SOULX_ENDPOINT_ID",
    "VIDEOFORGE_SOULX_ENDPOINT_ID_SHA256",
  ]);
  assert.deepEqual(endpointBindings.ordered_output_names, [
    "production_secrets_sha256",
    "mage_deployment_snapshot_sha256",
    "soulx_deployment_snapshot_sha256",
    "mage_endpoint_secret_sha256",
    "mage_endpoint_hash_secret_sha256",
    "soulx_endpoint_secret_sha256",
    "soulx_endpoint_hash_secret_sha256",
  ]);
  const cleanupDescriptor =
    proposal.exact_execution_graph.internal_materialization_policy.records[5];
  assert.equal(cleanupDescriptor.cleanup_only, true);
  assert.equal(cleanupDescriptor.accepted_for_normal_or_acceptance_work, false);
  assert.deepEqual(cleanupDescriptor.ordered_output_names, [
    "cleanup_input_sha256",
    "pre_endpoint_secrets_sha256",
  ]);
  const cleanupRuntime =
    proposal.exact_execution_graph.internal_materialization_policy.cleanup_pre_endpoint_runtime;
  assert.equal(cleanupRuntime.schema, "videoforge.v213-full-live-cleanup-input/v1");
  assert.deepEqual(cleanupRuntime.exact_child_fd_environment, [
    "REQUEST_FD",
    "RUNPOD_API_KEY_FD",
    "OPERATOR_DATABASE_URL_FD",
  ]);
  assert.equal(cleanupRuntime.forbidden_inputs.includes("exactProductionInput"), true);
  assert.equal(cleanupRuntime.forbidden_inputs.includes("runtime-database-url"), true);
  assert.equal(cleanupRuntime.forbidden_inputs.includes("reconciler-database-url"), true);
  const cleanupReceiptFinalizer =
    proposal.exact_execution_graph.internal_materialization_policy.cleanup_receipt_finalizer;
  assert.equal(cleanupReceiptFinalizer.inside_existing_cleanup_operation, true);
  assert.equal(cleanupReceiptFinalizer.adds_graph_operation, false);
  assert.deepEqual(cleanupReceiptFinalizer.exact_child_fd_environment, [
    "REQUEST_FD",
    "OPERATOR_DATABASE_URL_FD",
    "EVIDENCE_SIGNING_KEY_FD",
  ]);
  assert.equal(cleanupReceiptFinalizer.provider_clients_constructed, false);
  assert.equal(cleanupReceiptFinalizer.recovery_readback_only, true);
  assert.deepEqual(
    proposal.exact_execution_graph.internal_materialization_policy.chain_record_exact_fields,
    [
      "kind",
      "authority_id",
      "prior_chain_sha256",
      "outer_state_sha256",
      "ordered_prior_operation_evidence_sha256s",
      "ordered_output_sha256s",
      "entry_sha256",
    ],
  );
  assert.equal(
    proposal.exact_execution_graph.internal_materialization_policy
      .entry_sha256_is_hash_of_preceding_six_fields,
    true,
  );
});

test("V3 proposal binds exact run-ID terminal polling without verifier dispatch", () => {
  const fixture = v3Fixture();
  const proposal = JSON.parse(fixture.proposalBytes);
  assert.deepEqual(
    proposal.exact_execution_graph.image_workflow_verification_policy,
    EXACT_IMAGE_WORKFLOW_VERIFICATION_POLICY,
  );
  assert.equal(
    proposal.exact_execution_graph.image_workflow_verification_policy.maximum_reads *
      proposal.exact_execution_graph.image_workflow_verification_policy.poll_interval_ms,
    1_800_000,
  );
  assert.equal(
    proposal.exact_execution_graph.image_workflow_verification_policy.redispatch_authorized,
    false,
  );
});

test("V3 proposal binds the zero-provider prequalification database bootstrap", () => {
  const fixture = v3Fixture();
  const proposal = JSON.parse(fixture.proposalBytes);
  const bootstrap = proposal.exact_execution_graph.prequalification_database_bootstrap_policy;
  assert.deepEqual(bootstrap, EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY);
  assert.deepEqual(
    proposal.exact_execution_graph.prequalification_bridge_policy,
    EXACT_PREQUALIFICATION_BRIDGE_POLICY,
  );
  assert.deepEqual(
    proposal.exact_execution_graph.workflow_start_authority_policy,
    EXACT_WORKFLOW_START_AUTHORITY_POLICY,
  );
  assert.deepEqual(
    proposal.exact_execution_graph.early_no_database_cleanup_policy,
    EXACT_EARLY_NO_DATABASE_CLEANUP_POLICY,
  );
  assert.deepEqual(
    proposal.exact_execution_graph.bootstrap_partial_cleanup_policy,
    EXACT_BOOTSTRAP_PARTIAL_CLEANUP_POLICY,
  );
  assert.deepEqual(
    proposal.exact_execution_graph.durable_billing_policy,
    EXACT_DURABLE_BILLING_POLICY,
  );
  assert.deepEqual(
    proposal.exact_execution_graph.crash_safe_cleanup_policy,
    EXACT_CRASH_SAFE_CLEANUP_POLICY,
  );
  assert.equal(proposal.exact_execution_graph.ordered_operation_ids.length, 26);
  assert.deepEqual(proposal.exact_execution_graph.ordered_operation_ids, EXACT_OPERATION_IDS);
  assert.deepEqual(proposal.exact_execution_graph.ordered_operation_ids.slice(7, 10), [
    "soulx-image-workflow-verification",
    "bootstrap-prequalification-database",
    "fresh-live-preflight",
  ]);
  assert.deepEqual(proposal.requested_scope.database, {
    exact_operator_role: "videoforge_hosted_operator",
    exact_runtime_role: "videoforge_hosted_runtime",
    exact_reconciler_role: "videoforge_hosted_reconciler",
    roles_must_be_fresh_absent_distinct_login_noinherit_hardened: true,
    pgcrypto_required: true,
    prequalification_database_bootstrap_operator_function_signature_count:
      EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.exact_operator_function_signature_count,
    prequalification_database_bootstrap_operator_function_signature_namespace: "public",
    prequalification_database_bootstrap_operator_function_signature_canonicalization:
      "FUNCTION_NAME_PLUS_FORMAT_TYPE_IDENTITY_ARGUMENTS_WITH_TIMESTAMPTZ_NORMALIZATION",
    prequalification_database_bootstrap_operator_acl_comparison: "OID_SET_SORTED_EXACT_ALLOWLIST",
    prequalification_database_bootstrap_public_execute_readback_count: 0,
    prequalification_database_bootstrap_public_default_execute_readback_count: 0,
    prequalification_database_bootstrap_ownership_catalogs: [
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
    ],
    prequalification_database_bootstrap_ownership_readback_is_cluster_wide: true,
    prequalification_database_bootstrap_requires_consumed_outer_authority: true,
    prequalification_database_bootstrap_credential_bundle_schema:
      "videoforge.v213-database-role-credential-bundle/v1",
    prequalification_database_bootstrap_credential_bundle_path: "database-role-credentials.json",
    prequalification_database_bootstrap_credentials_absent_before_consumed_bootstrap: true,
    prequalification_database_bootstrap_credentials_materialized_after_migration_prefix_commit_count: 49,
    prequalification_database_bootstrap_credential_roles: [
      "videoforge_hosted_operator",
      "videoforge_hosted_runtime",
      "videoforge_hosted_reconciler",
    ],
    prequalification_database_bootstrap_runtime_reconciler_credentials_staged_roles_absent_until_guarded_activation: true,
    prequalification_database_bootstrap_exact_one_time_database_role_credential_count:
      EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.exact_one_time_database_role_credential_count,
    prequalification_database_bootstrap_exact_one_time_database_role_credential_scope:
      EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.exact_one_time_database_role_credential_scope,
    prequalification_database_bootstrap_exact_one_time_internal_production_credential_count:
      EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.exact_one_time_internal_production_credential_count,
    prequalification_database_bootstrap_exact_one_time_internal_production_credential_scope: [
      ...EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.exact_one_time_internal_production_credential_scope,
    ],
    prequalification_database_bootstrap_operator_dsn_value_read_after_migration_prefix_commit_count: 49,
    prequalification_database_bootstrap_operator_dsn_value_read_forbidden_before_migration_prefix_commit: true,
    prequalification_database_bootstrap_phase: "bootstrap_prequalification_database",
    prequalification_database_bootstrap_phase_cap_usd: 0,
    prequalification_database_bootstrap_receipt_path: "prequalification-database-bootstrap.json",
    prequalification_database_bootstrap_receipt_hash_field:
      "prequalification_database_bootstrap_sha256",
    prequalification_database_bootstrap_receipt_replay_cas_required: true,
    prequalification_database_bootstrap_recovery_mode_ledger_before_count: {
      FRESH_36_TO_49: 36,
      RESUME_EXACT_PREFIX: [37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48],
      VERIFIED_EXISTING_49: 49,
    },
    prequalification_database_bootstrap_recovery_mode_final_ledger_count: 49,
    exact_operator_function_signatures: [
      ...EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.exact_operator_function_signatures,
    ],
    exact_initial_ledger_prefix_count: 36,
    exact_recoverable_prefix_counts: [37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48],
    exact_migrations_to_apply: [37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49],
  });
  assert.equal(bootstrap.receipt_exact_fields.includes("production_secret_bootstrap_sha256"), true);
  assert.equal(bootstrap.receipt_exact_fields.includes("database_identity_sha256"), true);
  assert.deepEqual(bootstrap.exact_owner_database_identity, {
    database: "neondb",
    host: "ep-sparkling-dew-azjhkwg6-pooler.c-3.ap-southeast-1.aws.neon.tech",
    owner_role: "neondb_owner",
  });
  assert.equal(
    bootstrap.exact_owner_database_identity_sha256,
    "sha256:7f2c802c531f4e5630d6a15b2f26bf65ea04f599b28c19fc3daa5d741c7567d7",
  );
  assert.equal(
    bootstrap.receipt_exact_fields.includes("credential_bootstrap_receipt_sha256"),
    true,
  );
  assert.deepEqual(bootstrap.receipt_full_exact_fields, [
    ...bootstrap.receipt_exact_fields,
    "prequalification_database_bootstrap_sha256",
  ]);
  assert.equal(bootstrap.receipt_hash_is_sha256_of_canonical_body, true);
  assert.equal(bootstrap.receipt_file_mode, "0600");
  assert.equal(bootstrap.receipt_parent_directory_mode, "0700");
  assert.equal(bootstrap.receipt_secret_free, true);
  assert.equal(bootstrap.receipt_replay_requires_exact_all_fields, true);
  assert.equal(bootstrap.receipt_final_ledger_count, 49);
  assert.equal(bootstrap.operator_grants_sql_revoke_public_execute, true);
  assert.equal(
    bootstrap.absent_operator_role_creation_and_exact_grants_share_one_database_transaction,
    true,
  );
  assert.equal(bootstrap.fresh_operator_password_available_only_inside_that_transaction, true);
  assert.equal(
    bootstrap.lost_transaction_commit_ack_reconciles_by_exact_acl_and_authenticated_operator_dsn,
    true,
  );
  assert.equal(bootstrap.public_execute_readback_must_be_empty, true);
  assert.equal(bootstrap.exact_operator_acl_order, "LEXICAL_CANONICAL_SIGNATURE");
  assert.equal(bootstrap.operator_dsn_policy.only_after_migrations, true);
  assert.equal(bootstrap.owner_dsn_policy.owner_only_for_migrations_and_readback, true);
  const grants = readFileSync("deploy/v2-13/neon-full-live-operator-grants.sql", "utf8");
  const grantStart = grants.indexOf("GRANT EXECUTE ON FUNCTION");
  const grantEnd = grants.indexOf("\nWITH target AS", grantStart);
  assert.notEqual(grantStart, -1);
  assert.notEqual(grantEnd, -1);
  const canonicalizeSignature = (signature) =>
    signature.replace(/\s+/gu, "").replaceAll("timestampwithtimezone", "timestamptz");
  const grantedSignatures = [
    ...grants.slice(grantStart, grantEnd).matchAll(/public\.(videoforge_[a-z0-9_]+\([^)]*\))/gu),
  ].map(([match]) => canonicalizeSignature(match.slice("public.".length)));
  const expectedSignatures = bootstrap.exact_operator_function_signatures
    .map(canonicalizeSignature)
    .sort();
  assert.equal(
    grantedSignatures.length,
    EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.exact_operator_function_signature_count,
  );
  assert.equal(new Set(grantedSignatures).size, grantedSignatures.length);
  assert.deepEqual([...grantedSignatures].sort(), expectedSignatures);
  assert.match(grants, /REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM :"operator_role";/u);
  assert.match(grants, /\\getenv operator_password V2_13_OPERATOR_PASSWORD/u);
  assert.ok(grants.indexOf("BEGIN;") < grants.indexOf("CREATE ROLE %I LOGIN PASSWORD %L"));
  assert.ok(grants.indexOf("CREATE ROLE %I LOGIN PASSWORD %L") < grantStart);
  assert.ok(grants.indexOf("COMMIT;") > grants.indexOf("\\gset", grantEnd));
  assert.match(grants, /REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;/u);
  assert.match(
    grants,
    /ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;/u,
  );
  assert.match(grants, /\nFROM role_acl\s*\\gset/u);
  assert.doesNotMatch(
    grants.slice(grantStart, grantEnd),
    /GRANT\s+EXECUTE\s+ON\s+FUNCTION[\s\S]*?\bTO\s+PUBLIC\b/iu,
  );
  const migration = [
    readFileSync("packages/control-plane/migrations/0045_hosted_full_live_activation.sql", "utf8"),
    readFileSync(
      "packages/control-plane/migrations/0046_hosted_full_live_cleanup_recovery.sql",
      "utf8",
    ),
  ].join("\n");
  const inviteMigration = readFileSync(
    "packages/control-plane/migrations/0047_hosted_invite_code_redemption.sql",
    "utf8",
  );
  assert.match(
    inviteMigration,
    /CREATE FUNCTION public\.videoforge_redeem_hosted_invite\(\s*supplied_session_token text,\s*supplied_verifier_sha256 text/u,
  );
  assert.match(
    inviteMigration,
    /REVOKE ALL ON FUNCTION public\.videoforge_redeem_hosted_invite\(text, text\) FROM PUBLIC;/u,
  );
  const systemAvatarMigration = readFileSync(
    "packages/control-plane/migrations/0048_hosted_system_avatar_asset_snapshot_reader.sql",
    "utf8",
  );
  assert.match(
    systemAvatarMigration,
    /CREATE FUNCTION public\.videoforge_read_system_avatar_version_assets\(\s*supplied_avatar_profile_version_id uuid/u,
  );
  assert.match(
    systemAvatarMigration,
    /LANGUAGE sql STABLE STRICT SECURITY DEFINER\s+SET search_path = pg_catalog, public/u,
  );
  assert.match(
    systemAvatarMigration,
    /REVOKE ALL ON FUNCTION public\.videoforge_read_system_avatar_version_assets\(uuid\) FROM PUBLIC;/u,
  );
  assert.match(
    systemAvatarMigration,
    /CREATE FUNCTION public\.videoforge_consume_hosted_rate_limit\(\s*supplied_session_token text,\s*supplied_operation text/u,
  );
  assert.match(
    systemAvatarMigration,
    /REVOKE ALL ON FUNCTION public\.videoforge_consume_hosted_rate_limit\(text, text\) FROM PUBLIC;/u,
  );
  const promotionLineageMigrationPath = EXACT_V4_EXECUTION_CONTROL_COMPONENTS.migration_0049.path;
  const promotionLineageMigration = readFileSync(promotionLineageMigrationPath, "utf8");
  assert.equal(
    hash(Buffer.from(promotionLineageMigration)),
    EXACT_V4_EXECUTION_CONTROL_COMPONENTS.migration_0049.sha256,
  );
  assert.match(
    promotionLineageMigration,
    /CREATE OR REPLACE FUNCTION public\.videoforge_promote_hosted_full_live\(/u,
  );
  assert.match(
    promotionLineageMigration,
    /version=49 AND name='hosted_full_live_promotion_lineage'\s+AND filename='0049_hosted_full_live_promotion_lineage\.sql'/u,
  );
  assert.match(
    promotionLineageMigration,
    /count\(\*\) FROM public\.videoforge_schema_migrations\)<>49/u,
  );
  assert.match(
    promotionLineageMigration,
    /max\(version\) FROM public\.videoforge_schema_migrations\)<>49/u,
  );
  const normalizedMigration = migration.replace(/\s+/gu, " ");
  for (const signature of bootstrap.exact_operator_function_signatures)
    assert.equal(
      normalizedMigration.includes(`REVOKE ALL ON FUNCTION public.${signature} FROM PUBLIC;`),
      true,
      `public execute revoke missing for ${signature}`,
    );
  assert.equal(bootstrap.runpod_calls, 0);
  assert.equal(bootstrap.cloudflare_calls, 0);
  assert.equal(bootstrap.application_secret_reads, 5);
  assert.equal(bootstrap.gpu_use, false);
  assert.equal(bootstrap.external_spend_usd, 0);
  assert.equal(bootstrap.guarded_activation_consumes_verified_receipt, true);
  assert.equal(
    bootstrap.guarded_activation_receipt_verified_before_non_database_application_secret_reads,
    true,
  );
  assert.equal(
    bootstrap.authorized_unsettled_reconciliation.existing_role_without_exact_bundle_fails_closed,
    true,
  );
  assert.equal(bootstrap.post_bootstrap_receipt_verifier.database_credential_hash_reads, 3);
  assert.equal(
    bootstrap.guarded_activation_receipt_verified_before_cloudflare_or_runtime_secret_reads,
    true,
  );
  assert.deepEqual(bootstrap.recovery_mode_ledger_before_count, {
    FRESH_36_TO_49: 36,
    RESUME_EXACT_PREFIX: [37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48],
    VERIFIED_EXISTING_49: 49,
  });
  assert.equal(bootstrap.recovery_mode_final_ledger_count, 49);
  assert.equal(bootstrap.guarded_activation_reapplies_migrations_or_operator_role, false);
});

test("V3 proposal separates proposal and authority-record commit lineage without a self hash", () => {
  const fixture = v3Fixture();
  const proposal = JSON.parse(fixture.proposalBytes);
  assert.equal(proposal.source.proposal_record_commit, null);
  assert.equal(proposal.source.future_authority_record_commit, null);
  assert.deepEqual(proposal.authority_record_commit_binding, {
    strategy: "EXTERNAL_GIT_COMMIT_INPUT_VERIFIED_BEFORE_CONSUMPTION_NO_SELF_HASH",
    proposal_record_commit_is_distinct: true,
    authority_record_commit_must_contain_exact_approval_and_authority_bytes: true,
    remote_readback_required: true,
    embedded_self_commit_hash_forbidden: true,
    materialization_seed_sha256_required_in_authority_and_consumption_state: true,
    materialization_seed_sha256_must_be_verified_before_execution: true,
  });
  assert.deepEqual(proposal.source.exact_release_components.approval_validator, {
    path: "deploy/v2-13/validate-full-live-approval.mjs",
    source_commit_tree_binding: EXACT_APPROVAL_VALIDATOR_SOURCE_BINDING,
  });
  assert.equal(
    Object.hasOwn(proposal.source.exact_release_components.approval_validator, "sha256"),
    false,
  );
  assert.deepEqual(proposal.source.exact_release_components, EXACT_V3_RELEASE_COMPONENTS);
  assert.match(proposal.ordered_operations[3].operations.join("\n"), /authority-record commit/u);
});

test("trusted lineage accepts an ancestor source and exact proposal-record diff chain", () => {
  const proposalPath =
    "project-context/evidence/acceptance/VF-10-13/2026-08-27-cloudflare-credential-origin-repair-candidate/combined-live-proposal.json";
  const proposalBytes = readFileSync(proposalPath);
  const repository = mkdtempSync(join(tmpdir(), "videoforge-lineage-accept-"));
  const oldGitDirectory = process.env.GIT_DIR;
  const oldGitWorkTree = process.env.GIT_WORK_TREE;
  const environment = { ...process.env, GIT_CONFIG_NOSYSTEM: "1" };
  delete environment.GIT_DIR;
  delete environment.GIT_WORK_TREE;
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: repository,
      encoding: "utf8",
      env: environment,
      maxBuffer: 4 * 1024 * 1024,
    }).trim();
  try {
    git("init", "--quiet");
    git("config", "user.email", "videoforge-tests@example.invalid");
    git("config", "user.name", "VideoForge Tests");
    mkdirSync(join(repository, dirname(proposalPath)), { recursive: true });
    writeFileSync(join(repository, proposalPath), Buffer.from("blocked draft\n"));
    git("add", "--all");
    git("commit", "--quiet", "-m", "source");
    const releaseSourceCommit = git("rev-parse", "HEAD");
    writeFileSync(join(repository, proposalPath), proposalBytes);
    git("add", "--all");
    git("commit", "--quiet", "-m", "proposal record");
    const proposalRecordCommit = git("rev-parse", "HEAD");
    process.env.GIT_DIR = join(repository, ".git");
    process.env.GIT_WORK_TREE = repository;
    const exact = {
      releaseSourceCommit,
      proposalRecordCommit,
      proposalSha256: hash(proposalBytes),
    };
    assert.doesNotThrow(() => trustedCommitLineage(exact, { proposalPath, proposalBytes }));
    assert.throws(
      () =>
        trustedCommitLineage(
          { ...exact, proposalRecordCommit: releaseSourceCommit },
          { proposalPath, proposalBytes },
        ),
      /COMMIT_LINEAGE/u,
    );
    assert.throws(
      () =>
        trustedCommitLineage(
          { ...exact, releaseSourceCommit: proposalRecordCommit },
          { proposalPath, proposalBytes },
        ),
      /COMMIT_LINEAGE/u,
    );
  } finally {
    if (oldGitDirectory === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = oldGitDirectory;
    if (oldGitWorkTree === undefined) delete process.env.GIT_WORK_TREE;
    else process.env.GIT_WORK_TREE = oldGitWorkTree;
    rmSync(repository, { recursive: true, force: true });
  }
});

test("trusted lineage rejects rename, merge, and extra-path proposal histories", () => {
  const proposalPath =
    "project-context/evidence/acceptance/VF-10-13/2026-08-27-cloudflare-credential-origin-repair-candidate/combined-live-proposal.json";
  const exactProposalBytes = readFileSync(proposalPath);
  const oldEnvironment = {
    GIT_DIR: process.env.GIT_DIR,
    GIT_WORK_TREE: process.env.GIT_WORK_TREE,
  };
  const gitEnvironment = () => {
    const environment = { ...process.env, GIT_CONFIG_NOSYSTEM: "1" };
    delete environment.GIT_DIR;
    delete environment.GIT_WORK_TREE;
    return environment;
  };
  const git = (repository, ...args) =>
    execFileSync("git", args, {
      cwd: repository,
      encoding: "utf8",
      env: gitEnvironment(),
      maxBuffer: 4 * 1024 * 1024,
    }).trim();
  const commit = (repository, message) => {
    git(repository, "add", "--all");
    git(repository, "commit", "--quiet", "-m", message);
    return git(repository, "rev-parse", "HEAD");
  };
  const withRepository = (callback) => {
    const repository = mkdtempSync(join(tmpdir(), "videoforge-lineage-"));
    const gitDirectory = join(repository, ".git");
    try {
      git(repository, "init", "--quiet");
      git(repository, "config", "user.email", "videoforge-tests@example.invalid");
      git(repository, "config", "user.name", "VideoForge Tests");
      process.env.GIT_DIR = gitDirectory;
      process.env.GIT_WORK_TREE = repository;
      callback(repository);
    } finally {
      if (oldEnvironment.GIT_DIR === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = oldEnvironment.GIT_DIR;
      if (oldEnvironment.GIT_WORK_TREE === undefined) delete process.env.GIT_WORK_TREE;
      else process.env.GIT_WORK_TREE = oldEnvironment.GIT_WORK_TREE;
      rmSync(repository, { recursive: true, force: true });
    }
  };

  withRepository((repository) => {
    mkdirSync(join(repository, dirname(proposalPath)), {
      recursive: true,
    });
    writeFileSync(join(repository, "evil.txt"), exactProposalBytes);
    const source = commit(repository, "source");
    git(repository, "mv", "evil.txt", proposalPath);
    const proposalRecordCommit = commit(repository, "malicious rename");
    assert.match(
      git(
        repository,
        "diff-tree",
        "--no-commit-id",
        "--name-status",
        "-r",
        "-M",
        proposalRecordCommit,
      ),
      /R\d+\tevil\.txt\tproject-context\/evidence\/acceptance\/VF-10-13\/2026-08-27-cloudflare-credential-origin-repair-candidate\/combined-live-proposal\.json/u,
    );
    assert.throws(
      () =>
        trustedCommitLineage(
          {
            releaseSourceCommit: source,
            proposalRecordCommit,
            proposalSha256: hash(exactProposalBytes),
          },
          { proposalPath, proposalBytes: exactProposalBytes },
        ),
      /COMMIT_LINEAGE/u,
    );
  });

  withRepository((repository) => {
    mkdirSync(join(repository, dirname(proposalPath)), {
      recursive: true,
    });
    writeFileSync(join(repository, proposalPath), Buffer.from(`${exactProposalBytes}old`));
    const source = commit(repository, "source");
    const baseBranch = git(repository, "branch", "--show-current");
    git(repository, "checkout", "--quiet", "-b", "side");
    writeFileSync(join(repository, "project-context/00_START_HERE.md"), "side\n");
    commit(repository, "side change");
    git(repository, "checkout", "--quiet", baseBranch);
    writeFileSync(join(repository, proposalPath), exactProposalBytes);
    commit(repository, "proposal change");
    git(repository, "merge", "--quiet", "--no-edit", "--no-ff", "side");
    const mergeProposalRecordCommit = git(repository, "rev-parse", "HEAD");
    assert.equal(
      git(repository, "rev-list", "--parents", "-n", "1", mergeProposalRecordCommit).split(" ")
        .length,
      3,
    );
    assert.throws(
      () =>
        trustedCommitLineage(
          {
            releaseSourceCommit: source,
            proposalRecordCommit: mergeProposalRecordCommit,
            proposalSha256: hash(exactProposalBytes),
          },
          { proposalPath, proposalBytes: exactProposalBytes },
        ),
      /COMMIT_LINEAGE/u,
    );
  });

  withRepository((repository) => {
    mkdirSync(join(repository, dirname(proposalPath)), {
      recursive: true,
    });
    writeFileSync(join(repository, proposalPath), Buffer.from(`${exactProposalBytes}old`));
    const source = commit(repository, "source");
    writeFileSync(join(repository, proposalPath), exactProposalBytes);
    writeFileSync(join(repository, "unexpected.txt"), "unexpected\n");
    const proposalRecordCommit = commit(repository, "extra path");
    assert.throws(
      () =>
        trustedCommitLineage(
          {
            releaseSourceCommit: source,
            proposalRecordCommit,
            proposalSha256: hash(exactProposalBytes),
          },
          { proposalPath, proposalBytes: exactProposalBytes },
        ),
      /COMMIT_LINEAGE/u,
    );
  });
});

test("consumed successor candidate remains reproducible from its terminal archive", () => {
  const historicalCommit = "1ba62090c763cb4993cd5f9806e63c6629be1997";
  const candidatePath =
    "project-context/evidence/acceptance/VF-10-13/2026-08-27-cloudflare-credential-origin-repair-candidate";
  const temporaryDirectory = mkdtempSync(
    join("project-context/evidence/acceptance/VF-10-13", ".tmp-terminal-candidate-"),
  );
  const historicalBytes = (relativePath) =>
    execFileSync("git", ["show", `${historicalCommit}:${relativePath}`], {
      encoding: "buffer",
    });
  let output;
  try {
    const validator = readFileSync(join(candidatePath, "validate-candidate.mjs"), "utf8").replace(
      'const FACTS_PATH = path.join(ROOT, "project-context/evidence/acceptance/VF-10-13/materialization-seed-facts.json");',
      'const FACTS_PATH = path.join(DIRECTORY, "materialization-seed-facts.json");',
    );
    writeFileSync(join(temporaryDirectory, "validate-candidate.mjs"), validator);
    for (const name of [
      "combined-live-proposal.json",
      "source-readiness-audit.json",
      "read-only-preflight.json",
    ])
      writeFileSync(join(temporaryDirectory, name), historicalBytes(`${candidatePath}/${name}`));
    writeFileSync(
      join(temporaryDirectory, "materialization-seed-facts.json"),
      historicalBytes(
        "project-context/evidence/acceptance/VF-10-13/materialization-seed-facts.json",
      ),
    );
    output = execFileSync("node", [join(temporaryDirectory, "validate-candidate.mjs")], {
      encoding: "utf8",
    });
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
  const result = JSON.parse(output);
  assert.equal(result.status, "PASS_TERMINAL_ARCHIVE_REPRODUCIBLE");
  assert.equal(result.state, "CONSUMED_SINGLE_EXECUTION_CLEANUP_COMPLETE_NO_RETRY");
  assert.equal(result.authority, "v2-13-full-live-20260829-052951z-6852970d");
  assert.equal(result.reusable, false);
  assert.equal(result.no_redispatch, true);
  assert.equal(
    result.terminal_state_sha256,
    "sha256:f59fc1f3f989ff9b694053d911d9e38921e3f14b6e850afd2d5472318efdf2a9",
  );
  const activeProposal = JSON.parse(
    readFileSync(
      "project-context/evidence/acceptance/VF-10-13/2026-08-27-cloudflare-credential-origin-repair-candidate/combined-live-proposal.json",
    ),
  );
  assert.equal(result.superseded_authority_id, activeProposal.supersession.superseded_authority_id);
  assert.equal(
    result.superseded_proposal_sha256,
    activeProposal.supersession.supersedes_proposal_sha256,
  );
});

test("V3 proposal binds the exact 22-name Cloudflare secret allowlist", () => {
  const fixture = v3Fixture();
  const proposal = JSON.parse(fixture.proposalBytes);
  assert.equal(proposal.requested_scope.cloudflare_secret_allowlist_count, 22);
  assert.deepEqual(
    proposal.requested_scope.cloudflare_secret_allowlist,
    EXACT_CLOUDFLARE_SECRET_NAMES,
  );
  assert.match(
    proposal.ordered_operations.flatMap((phase) => phase.operations).join("\n"),
    /provision 22 exact allowlisted secrets/u,
  );
});

test("single-use ledger enforces phase order, phase caps, cumulative cap, and no redispatch", () => {
  const state = freshStateFixture();
  beginPhase(state, "publication");
  assert.throws(() => completePhase(state, "publication"), /RELEASE_REF_NOT_VERIFIED/u);
  recordVerifiedReleaseRef(state, {
    tagName: "videoforge-v2-13-release-20260826-v3",
    targetCommit: state.release_source_commit,
    eventId: "release-ref-readback-event-0001",
  });
  completePhase(state, "publication");
  beginPhase(state, "bootstrap_prequalification_database");
  completePhase(state, "bootstrap_prequalification_database");
  beginPhase(state, "mage_qualification");
  authorizeWork(state, {
    phaseName: "mage_qualification",
    workId: "mage-qualification-work-0001",
    reservationUsd: 4.5,
    eventId: "mage-reserve-event-0001",
  });
  assert.throws(
    () =>
      authorizeWork(state, {
        phaseName: "mage_qualification",
        workId: "mage-qualification-work-0001",
        reservationUsd: 0,
        eventId: "mage-reserve-event-0002",
      }),
    /REDISPATCH_OR_EVENT_REPLAY/u,
  );
  assert.throws(
    () =>
      authorizeWork(state, {
        phaseName: "mage_qualification",
        workId: "mage-qualification-work-0002",
        reservationUsd: 0.01,
        eventId: "mage-reserve-event-0003",
      }),
    /CAP_EXCEEDED/u,
  );
  settleWork(state, {
    phaseName: "mage_qualification",
    workId: "mage-qualification-work-0001",
    actualUsd: 1.25,
    eventId: "mage-settle-event-0001",
  });
  assert.throws(
    () =>
      settleWork(state, {
        phaseName: "mage_qualification",
        workId: "mage-qualification-work-0001",
        actualUsd: 1.25,
        eventId: "mage-settle-event-0002",
      }),
    /WORK_NOT_SETTLEABLE/u,
  );
  completePhase(state, "mage_qualification");
  beginPhase(state, "soulx_qualification");
  assert.throws(
    () =>
      authorizeWork(state, {
        phaseName: "soulx_qualification",
        workId: "mage-qualification-work-0001",
        reservationUsd: 1,
        eventId: "soulx-reserve-event-0001",
      }),
    /REDISPATCH_OR_EVENT_REPLAY/u,
  );
  assert.equal(validateState(state).total_reserved_usd, 4.5);
  assert.equal(validateState(state).total_settled_usd, 1.25);
  const mismatchedPhaseReserved = structuredClone(state);
  mismatchedPhaseReserved.phases.mage_qualification.reserved_usd = 4.49;
  assert.throws(() => validateState(mismatchedPhaseReserved), /PHASE_WORK_SUM_MISMATCH/u);
  const mismatchedPhaseSettled = structuredClone(state);
  mismatchedPhaseSettled.phases.mage_qualification.settled_usd = 1.24;
  mismatchedPhaseSettled.total_settled_usd = 1.24;
  assert.throws(() => validateState(mismatchedPhaseSettled), /PHASE_WORK_SUM_MISMATCH/u);
  assert.throws(() => beginPhase(state, "v2_09_short_hosted_project"), /PHASE_ORDER/u);
});

test("failure is terminal cleanup-only and cannot reopen a paid phase", () => {
  const state = freshStateFixture();
  beginPhase(state, "publication");
  enterCleanupOnly(state, {
    failureBoundary: "TEST_OPERATION_EXECUTION",
    failureCode: "RELEASE_REF_COLLISION",
    eventId: "cleanup-entry-event-0001",
  });
  assert.equal(state.state, "CONSUMED_SINGLE_EXECUTION_CLEANUP_ONLY");
  assert.throws(() => beginPhase(state, "publication"), /NOT_IN_PROGRESS/u);
  assert.throws(() => completeCleanupOnly(state), /CLEANUP_INCOMPLETE/u);
  authorizeExactCleanupSafetyWork(state, { settle: false });
  assert.throws(
    () =>
      recordCleanupProof(state, {
        zeroWorkerProofSha256: `sha256:${"a".repeat(64)}`,
        billingProofSha256: `sha256:${"b".repeat(64)}`,
        resourceProofSha256: `sha256:${"c".repeat(64)}`,
        maxOneProofSha256: `sha256:${"d".repeat(64)}`,
        eventId: "cleanup-proof-too-early-0001",
      }),
    /CLEANUP_WORK_UNSETTLED/u,
  );
  for (const operationId of exactCleanupSafetyOperationIds) {
    settleCleanupWork(state, {
      workId: `${state.authority_id}:${operationId}`.toLowerCase(),
      eventId: `${state.authority_id}:${operationId}:settled`.toLowerCase(),
      result: { proofSha256: proof("e") },
    });
  }
  assert.throws(
    () =>
      authorizeCleanupWork(state, {
        workId: `${state.authority_id}:prove-zero-workers`.toLowerCase(),
        eventId: "cleanup-authorize-replay-0001",
      }),
    /REDISPATCH_OR_EVENT_REPLAY/u,
  );
  recordCleanupProof(state, {
    zeroWorkerProofSha256: `sha256:${"a".repeat(64)}`,
    billingProofSha256: `sha256:${"b".repeat(64)}`,
    resourceProofSha256: `sha256:${"c".repeat(64)}`,
    maxOneProofSha256: `sha256:${"d".repeat(64)}`,
    eventId: "cleanup-proof-event-0001",
  });
  completeCleanupOnly(state);
  assert.equal(state.state, "CONSUMED_SINGLE_EXECUTION_CLEANUP_COMPLETE_NO_RETRY");
  assert.deepEqual(
    state.cleanup_proof.cleanup_work_ids,
    exactCleanupSafetyOperationIds
      .map((operationId) => `${state.authority_id}:${operationId}`.toLowerCase())
      .sort(),
  );
});

test("cleanup-only state persists a bounded failure boundary and code", () => {
  const state = freshStateFixture();
  assert.equal(state.failure_boundary, null);
  assert.equal(state.failure_code, null);
  assert.equal(state.cleanup_failure_code, null);
  beginPhase(state, "publication");
  enterCleanupOnly(state, {
    failureBoundary: "INITIAL_PREFLIGHT",
    failureCode: "PREFLIGHT_CONTRACT",
    eventId: "cleanup-diagnostic-entry-event-0001",
  });
  assert.equal(state.failure_boundary, "INITIAL_PREFLIGHT");
  assert.equal(state.failure_code, "PREFLIGHT_CONTRACT");
  assert.equal(state.cleanup_failure_code, "PREFLIGHT_CONTRACT");
  assert.doesNotThrow(() => validateState(state));

  for (const [field, value] of [
    ["failure_boundary", "/private/secret/path"],
    ["failure_code", "raw secret message"],
    ["cleanup_failure_code", "raw secret message"],
  ]) {
    const mutated = structuredClone(state);
    mutated[field] = value;
    assert.throws(() => validateState(mutated), /FAILURE_DIAGNOSTIC/u);
  }
});

test("release certification is a separate record after the exact four-work cleanup proof", () => {
  const state = freshStateFixture();
  assert.equal(state.schema_version, "videoforge.v2-13-full-live-orchestration-consumption/v2");
  assert.equal(state.release_certification, null);
  for (const [phaseName] of PHASES) state.phases[phaseName].state = "COMPLETE";
  state.current_phase_index = PHASES.length - 1;
  state.phases.cleanup_and_reconciliation.state = "ACTIVE";
  for (const operationId of exactCleanupSafetyOperationIds) {
    const workId = `${state.authority_id}:${operationId}`.toLowerCase();
    authorizeWork(state, {
      phaseName: "cleanup_and_reconciliation",
      workId,
      reservationUsd: 0,
      eventId: `${state.authority_id}:${operationId}:authorized`.toLowerCase(),
    });
    settleWork(state, {
      phaseName: "cleanup_and_reconciliation",
      workId,
      actualUsd: 0,
      eventId: `${state.authority_id}:${operationId}:settled`.toLowerCase(),
      result: { proofSha256: proof("a") },
    });
  }
  recordCleanupProof(state, {
    zeroWorkerProofSha256: proof("a"),
    billingProofSha256: proof("b"),
    resourceProofSha256: proof("c"),
    maxOneProofSha256: proof("d"),
    eventId: `${state.authority_id}:cleanup-proof:verified`.toLowerCase(),
  });
  const result = { schemaVersion: "videoforge.v213-final-release-certification-result/v1" };
  const certificationWorkId = `${state.authority_id}:certify-v2-13-release`.toLowerCase();
  authorizeReleaseCertification(state, {
    workId: certificationWorkId,
    eventId: `${certificationWorkId}:authorized`,
  });
  assert.equal(state.release_certification.state, "AUTHORIZED_ONCE_RECONCILIATION_ONLY");
  assert.equal(state.work_ids.includes(certificationWorkId), true);
  assert.throws(
    () => completePhase(state, "cleanup_and_reconciliation"),
    /RELEASE_CERTIFICATION_REQUIRED/u,
  );
  settleReleaseCertification(state, {
    workId: certificationWorkId,
    result,
    eventId: `${certificationWorkId}:settled`,
  });
  assert.equal(state.cleanup_proof.cleanup_work_ids.length, 4);
  assert.equal(
    state.cleanup_proof.cleanup_work_ids.includes(
      `${state.authority_id}:certify-v2-13-release`.toLowerCase(),
    ),
    false,
  );
  assert.equal(state.release_certification.settled_result, result);
  assert.equal(state.release_certification.state, "SETTLED_TERMINAL");
  assert.throws(
    () =>
      authorizeReleaseCertification(state, {
        workId: certificationWorkId,
        result,
        eventId: `${certificationWorkId}:authorized`,
      }),
    /RELEASE_CERTIFICATION_REPLAY/u,
  );
});

test("state storage requires mode-0700 real directory, mode-0600 file, and exact prior hash", async () => {
  const state = freshStateFixture();
  const directory = mkdtempSync(join(tmpdir(), "videoforge-v2-13-outer-state-"));
  chmodSync(directory, 0o700);
  const path = join(directory, "state.json");
  try {
    writeExclusive(path, state);
    const before = hash(readFileSync(path));
    const updated = updateState(path, before, (value) => beginPhase(value, "publication"));
    assert.equal(updated.state.phases.publication.state, "ACTIVE");
    assert.throws(() => updateState(path, before, (value) => value), /STATE_SHA256/u);
    const nextPath = `${path}.next`;
    writeFileSync(nextPath, `${JSON.stringify(updated.state, null, 2)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    const recovered = updateState(path, updated.sha256, (value) => value);
    assert.equal(recovered.sha256, updated.sha256);
    assert.equal(existsSync(nextPath), false);

    writeFileSync(nextPath, "{}\n", { mode: 0o600, flag: "wx" });
    assert.throws(() => updateState(path, recovered.sha256, (value) => value), /NEXT_STATE_DRIFT/u);
    assert.equal(hash(readFileSync(path)), recovered.sha256);
    rmSync(nextPath);

    const lockPath = `${path}.lock`;
    writeFileSync(
      lockPath,
      `${JSON.stringify({ pid: process.pid, process_start_sha256: hash(Buffer.from(`${process.pid}\0${execFileSync("ps", ["-o", "lstart=", "-p", String(process.pid)], { encoding: "utf8" }).trim()}`)), expected_state_sha256: recovered.sha256 })}\n`,
      { mode: 0o600, flag: "wx" },
    );
    assert.throws(() => updateState(path, recovered.sha256, (value) => value), /STATE_LOCKED/u);
    rmSync(lockPath);
    writeFileSync(
      lockPath,
      `${JSON.stringify({ pid: 2147483647, process_start_sha256: proof("d"), expected_state_sha256: recovered.sha256 })}\n`,
      { mode: 0o600, flag: "wx" },
    );
    assert.equal(updateState(path, recovered.sha256, (value) => value).sha256, recovered.sha256);
    chmodSync(path, 0o644);
    assert.throws(
      () => updateState(path, updated.sha256, (value) => value),
      /STATE_FILE_MODE_OR_TYPE/u,
    );
    chmodSync(path, 0o600);
    const link = join(directory, "state-link.json");
    symlinkSync(path, link);
    assert.throws(
      () => updateState(link, updated.sha256, (value) => value),
      /STATE_FILE_MODE_OR_TYPE/u,
    );
    const authorityModule = resolve("deploy/v2-13/full-live-orchestration-authority.mjs");
    const childSource = `
      const { updateState } = await import(${JSON.stringify(authorityModule)});
      try {
        updateState(${JSON.stringify(path)}, ${JSON.stringify(recovered.sha256)}, (value) => {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
          value.concurrent_cas_winner = process.pid;
          return value;
        });
      } catch (error) {
        process.stderr.write(String(error?.message ?? error));
        process.exitCode = 1;
      }
    `;
    const runChild = () =>
      new Promise((done) => {
        const child = spawn(process.execPath, ["--input-type=module", "--eval", childSource], {
          stdio: ["ignore", "ignore", "pipe"],
        });
        let stderr = "";
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk) => {
          stderr += chunk;
        });
        child.on("close", (code) => done({ code, stderr }));
      });
    const raced = await Promise.all([runChild(), runChild()]);
    assert.equal(raced.filter(({ code }) => code === 0).length, 1);
    assert.equal(
      raced
        .filter(({ code }) => code !== 0)
        .every(({ stderr }) => /STATE_LOCKED|STATE_SHA256/u.test(stderr)),
      true,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("approval mutation fails exact schema validation", () => {
  const mutated = structuredClone(JSON.parse(currentApprovalBytes));
  mutated.approval.phase_caps_usd.v2_13_final_two_lane_smoke = 2.01;
  assert.throws(
    () =>
      validateFullLiveUserApproval({
        proposalBytes,
        approvalBytes: Buffer.from(`${JSON.stringify(mutated)}\n`),
        expectedProposalSha256: proposalSha256,
        expectedProposalRecordCommit: proposalRecordCommit,
        expectedReleaseSourceCommit: releaseSourceCommit,
      }),
    /CAPS_OR_SINGLE_USE/u,
  );
});

test("approval nested extras and missing execution fences fail closed", () => {
  const extra = structuredClone(JSON.parse(currentApprovalBytes));
  extra.approval.gpu.unapproved = true;
  assert.throws(
    () =>
      validateFullLiveUserApproval({
        proposalBytes,
        approvalBytes: Buffer.from(`${JSON.stringify(extra)}\n`),
        expectedProposalSha256: proposalSha256,
        expectedProposalRecordCommit: proposalRecordCommit,
        expectedReleaseSourceCommit: releaseSourceCommit,
      }),
    /NESTED_SCHEMA/u,
  );
  const missing = structuredClone(JSON.parse(currentApprovalBytes));
  delete missing.execution_fences.no_redispatch;
  assert.throws(
    () =>
      validateFullLiveUserApproval({
        proposalBytes,
        approvalBytes: Buffer.from(`${JSON.stringify(missing)}\n`),
        expectedProposalSha256: proposalSha256,
        expectedProposalRecordCommit: proposalRecordCommit,
        expectedReleaseSourceCommit: releaseSourceCommit,
      }),
    /NESTED_SCHEMA/u,
  );
});

test("forged terminal state is rejected and every normal mutation stays closed", () => {
  const fixture = v3Fixture();
  const validated = validateFullLiveUserApproval({
    proposalBytes: fixture.proposalBytes,
    approvalBytes: fixture.approvalBytes,
    expectedProposalSha256: hash(fixture.proposalBytes),
    expectedProposalRecordCommit: "f".repeat(40),
    expectedReleaseSourceCommit: v3ReleaseSourceCommit,
  });
  const recordValidated = {
    ...validated,
    authorityRecordCommit: "e".repeat(40),
    approvalRecordPath: "evidence/user-approval.json",
    authorityRecordPath: "evidence/approved-authority.json",
  };
  const forged = initialConsumptionRecord(
    fixture.authority,
    fixture.authorityBytes,
    recordValidated,
  );
  forged.full_live_executor_sha256 = EXACT_V3_RELEASE_COMPONENTS.full_live_executor.sha256;
  forged.state = "CONSUMED_SINGLE_EXECUTION_CLEANUP_COMPLETE_NO_RETRY";
  forged.terminal = "CLEANUP_PROOFS_RECORDED_ZERO_WORKER_BILLING_RESOURCES_RECONCILED";
  forged.failure_boundary = "TEST_OPERATION_EXECUTION";
  forged.failure_code = "TEST_FORGED_TERMINAL";
  forged.cleanup_failure_code = "TEST_FORGED_TERMINAL";
  assert.throws(() => validateState(forged), /CLEANUP_COMPLETE_STATE_INVARIANT/u);
  assert.throws(() => beginPhase(forged, "publication"), /CLEANUP_COMPLETE_STATE_INVARIANT/u);

  const terminal = initialConsumptionRecord(
    fixture.authority,
    fixture.authorityBytes,
    recordValidated,
  );
  terminal.full_live_executor_sha256 = EXACT_V3_RELEASE_COMPONENTS.full_live_executor.sha256;
  beginPhase(terminal, "publication");
  enterCleanupOnly(terminal, {
    failureBoundary: "TEST_OPERATION_EXECUTION",
    failureCode: "RELEASE_REF_COLLISION",
    eventId: "cleanup-entry-event-terminal-0001",
  });
  authorizeExactCleanupSafetyWork(terminal);
  recordCleanupProof(terminal, {
    zeroWorkerProofSha256: `sha256:${"a".repeat(64)}`,
    billingProofSha256: `sha256:${"b".repeat(64)}`,
    resourceProofSha256: `sha256:${"c".repeat(64)}`,
    maxOneProofSha256: `sha256:${"d".repeat(64)}`,
    eventId: "cleanup-proof-event-terminal-0001",
  });
  completeCleanupOnly(terminal);
  assert.throws(() => beginPhase(terminal, "publication"), /NOT_IN_PROGRESS/u);
  assert.throws(
    () =>
      authorizeWork(terminal, {
        phaseName: "cleanup_and_reconciliation",
        workId: "forged-terminal-work-0001",
        reservationUsd: 0,
        eventId: "forged-terminal-event-0001",
      }),
    /NOT_IN_PROGRESS/u,
  );
});

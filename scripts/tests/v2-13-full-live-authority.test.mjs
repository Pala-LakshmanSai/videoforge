import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  authorizeCleanupWork,
  authorizeWork,
  beginPhase,
  completeCleanupOnly,
  completePhase,
  enterCleanupOnly,
  initialConsumptionRecord,
  recordCleanupProof,
  recordVerifiedReleaseRef,
  settleWork,
  settleCleanupWork,
  trustedCommitLineage,
  updateState,
  validateMaterializationSeedFile,
  validateOuterAuthority,
  validateState,
  writeExclusive,
} from "../../deploy/v2-13/full-live-orchestration-authority.mjs";
import {
  EXACT_APPROVAL_VALIDATOR_SOURCE_BINDING,
  EXACT_CLOUDFLARE_SECRET_NAMES,
  EXACT_DURABLE_BILLING_POLICY,
  EXACT_EARLY_NO_DATABASE_CLEANUP_POLICY,
  EXACT_CRASH_SAFE_CLEANUP_POLICY,
  EXACT_IMAGE_WORKFLOW_VERIFICATION_POLICY,
  EXACT_INTERNAL_MATERIALIZATION_POLICY,
  EXACT_OPERATION_IDS,
  EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY,
  EXACT_PREQUALIFICATION_BRIDGE_POLICY,
  EXACT_V3_RELEASE_COMPONENTS,
  EXACT_WORKFLOW_START_AUTHORITY_POLICY,
  EXACT_TRUSTED_TIME_POLICY,
  EXPECTED_SERVERLESS_FLEX_RATE_USD_PER_GPU_HOUR,
  validateFullLiveUserApproval,
} from "../../deploy/v2-13/validate-full-live-approval.mjs";

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

function v3Fixture() {
  const v3Directory =
    "project-context/evidence/acceptance/VF-10-13/2026-08-26-full-activation-ref-role-repair-candidate";
  const v3Proposal = JSON.parse(readFileSync(`${v3Directory}/combined-live-proposal.json`));
  v3Proposal.proposal_status = "PENDING_FRESH_EXACT_USER_APPROVAL";
  v3Proposal.sealing.sealed_for_exact_user_approval = true;
  v3Proposal.sealing.current_bytes_are_approval_ineligible = false;
  v3Proposal.source.release_source_commit = v3ReleaseSourceCommit;
  delete v3Proposal.source.base_source_commit_before_semantic_tag_repair;
  v3Proposal.immutable_github_release_ref_request.exact_target_commit = v3ReleaseSourceCommit;
  v3Proposal.exact_execution_graph.internal_materialization_policy = structuredClone(
    EXACT_INTERNAL_MATERIALIZATION_POLICY,
  );
  v3Proposal.exact_execution_graph.prequalification_database_bootstrap_policy = structuredClone(
    EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY,
  );
  v3Proposal.exact_execution_graph.prequalification_bridge_policy = structuredClone(
    EXACT_PREQUALIFICATION_BRIDGE_POLICY,
  );
  v3Proposal.authority_record_commit_binding.materialization_seed_sha256_required_in_authority_and_consumption_state = true;
  v3Proposal.authority_record_commit_binding.materialization_seed_sha256_must_be_verified_before_execution = true;
  v3Proposal.source.exact_release_components = structuredClone(EXACT_V3_RELEASE_COMPONENTS);
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
    release_source_commit: v3ReleaseSourceCommit,
  };
  approval.approval.immutable_github_release_ref = {
    creation_authorized: true,
    exact_tag_name: "videoforge-v2-13-release-20260826-v3",
    exact_target_commit: v3ReleaseSourceCommit,
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
  };
  approval.statement = `I approve ${v3ProposalSha256} at ${v3Commit} with USD 17.50, USD 7 per month, no fallback, tag videoforge-v2-13-release-20260826-v3, and roles videoforge_hosted_operator, videoforge_hosted_runtime and videoforge_hosted_reconciler.`;
  const v3ApprovalBytes = Buffer.from(`${JSON.stringify(approval, null, 2)}\n`);
  const authority = structuredClone(JSON.parse(authorityBytes));
  authority.authority_id = approval.authority_id;
  authority.status = "APPROVED_UNCONSUMED_PENDING_FRESH_EXECUTION_INPUTS";
  authority.approved_at = approval.approved_at;
  authority.expires_at = approval.expires_at;
  authority.lineage = {
    proposal_path: approval.proposal.path,
    proposal_sha256: v3ProposalSha256,
    proposal_record_commit: v3Commit,
    release_source_commit: v3ReleaseSourceCommit,
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
    exact_target_commit: v3ReleaseSourceCommit,
    exact_tag_name: "videoforge-v2-13-release-20260826-v3",
    ref_creation_authorized_by_approved_proposal: true,
    status: "AUTHORIZED_EXACT_SINGLE_REF_PENDING_CREATION",
    external_action_taken: false,
  };
  authority.materialization_seed_sha256 = proof("a");
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

function freshStateFixture() {
  const fixture = v3Fixture();
  const { validated } = validateOuterAuthority(fixture);
  return initialConsumptionRecord(fixture.authority, fixture.authorityBytes, {
    ...validated,
    authorityRecordCommit: "e".repeat(40),
    approvalRecordPath: "project-context/evidence/acceptance/VF-10-13/test/user-approval.json",
    authorityRecordPath:
      "project-context/evidence/acceptance/VF-10-13/test/approved-authority.json",
  });
}

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

test("outer authority accepts a future exact V3 ref-authorized record", () => {
  const fixture = v3Fixture();
  const result = validateOuterAuthority(fixture);
  assert.equal(
    result.validated.proposalSchema,
    "videoforge.v2-13-full-live-completion-proposal/v3",
  );
  assert.equal(result.validated.exactRuntimeRole, "videoforge_hosted_runtime");
  assert.equal(result.validated.exactOperatorRole, "videoforge_hosted_operator");
  assert.equal(
    result.authority.github_release_ref.status,
    "AUTHORIZED_EXACT_SINGLE_REF_PENDING_CREATION",
  );
});

test("approval validator policies match the active sealed proposal exactly", () => {
  const activeProposal = JSON.parse(
    readFileSync(
      "project-context/evidence/acceptance/VF-10-13/2026-08-27-cloudflare-credential-origin-repair-candidate/combined-live-proposal.json",
    ),
  );
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
  const seed = {
    schema_version: "videoforge.v213-full-live-materialization-seed/v1",
    static_only: true,
    future_output_hashes_present: false,
    production_input_base: {
      schemaVersion: "videoforge.v213-full-live-outer-input/v1",
      fullLiveAuthorityId: "11111111-1111-4111-8111-111111111111",
      authorityDocument: {},
      dualLaneInput: {
        mage: {
          volumeIdSha256: proof("1"),
          volumeManifestSha256: proof("2"),
        },
        soulx: {
          volumeIdSha256: proof("3"),
          volumeManifestSha256: proof("4"),
        },
      },
      commandPayloads: {},
    },
    activation_record_base: {},
    config_activation_base: {},
    release_manifest: {},
    promotion_record_base: {},
  };
  const canonical = (value) =>
    Array.isArray(value)
      ? `[${value.map((item) => canonical(item)).join(",")}]`
      : value !== null && typeof value === "object"
        ? `{${Object.keys(value)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
            .join(",")}}`
        : JSON.stringify(value);
  writeFileSync(seedPath, `${JSON.stringify(seed)}\n`, { mode: 0o600 });
  const expected = hash(Buffer.from(`${canonical(seed)}\n`));
  try {
    assert.equal(
      validateMaterializationSeedFile({ path: seedPath, expectedSha256: expected }).sha256,
      expected,
    );
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
    writeFileSync(seedPath, `${JSON.stringify(nested)}\n`, { mode: 0o600 });
    const nestedHash = hash(Buffer.from(`${canonical(nested)}\n`));
    assert.throws(
      () => validateMaterializationSeedFile({ path: seedPath, expectedSha256: nestedHash }),
      /MATERIALIZATION_SEED_CONTRACT/u,
    );
    for (const [section, key] of [
      ["approval", "googleClientSecret"],
      ["cloudflare", "r2Credential"],
      ["database", "ownerDatabaseUrl"],
      ["release", "futureOutput"],
    ]) {
      const credential = structuredClone(seed);
      credential.promotion_record_base = { [section]: { [key]: "forbidden" } };
      writeFileSync(seedPath, `${JSON.stringify(credential)}\n`, { mode: 0o600 });
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
      proposal.exact_execution_graph.internal_materialization_policy.external_mid_run_writer_authorized = true;
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
      proposal.exact_execution_graph.prequalification_database_bootstrap_policy.guarded_activation_receipt_verified_before_application_secret_reads = false;
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
    proposal.exact_execution_graph.internal_materialization_policy.records[4];
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
    proposal.exact_execution_graph.durable_billing_policy,
    EXACT_DURABLE_BILLING_POLICY,
  );
  assert.deepEqual(
    proposal.exact_execution_graph.crash_safe_cleanup_policy,
    EXACT_CRASH_SAFE_CLEANUP_POLICY,
  );
  assert.equal(proposal.exact_execution_graph.ordered_operation_ids.length, 25);
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
    prequalification_database_bootstrap_operator_function_signature_count: 17,
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
    prequalification_database_bootstrap_operator_dsn_value_read_after_migration_prefix_commit_count: 45,
    prequalification_database_bootstrap_operator_dsn_value_read_forbidden_before_migration_prefix_commit: true,
    prequalification_database_bootstrap_phase: "bootstrap_prequalification_database",
    prequalification_database_bootstrap_phase_cap_usd: 0,
    prequalification_database_bootstrap_receipt_path: "prequalification-database-bootstrap.json",
    prequalification_database_bootstrap_receipt_hash_field:
      "prequalification_database_bootstrap_sha256",
    prequalification_database_bootstrap_receipt_replay_cas_required: true,
    prequalification_database_bootstrap_recovery_mode_ledger_before_count: {
      FRESH_36_TO_45: 36,
      RESUME_EXACT_PREFIX: [37, 38, 39, 40, 41, 42, 43, 44],
      VERIFIED_EXISTING_45: 45,
    },
    prequalification_database_bootstrap_recovery_mode_final_ledger_count: 45,
    exact_operator_function_signatures: [
      "videoforge_load_v213_bridge_acceptance_call(jsonb)",
      "videoforge_record_v213_stage_authority(uuid,jsonb)",
      "videoforge_record_hosted_full_live_authority(uuid,jsonb)",
      "videoforge_promote_hosted_full_live(uuid,uuid,jsonb)",
      "videoforge_record_v213_cloudflare_activation(uuid,jsonb)",
      "videoforge_record_v213_cloudflare_rollback(uuid,jsonb)",
      "videoforge_claim_v213_stage_authority(jsonb)",
      "videoforge_complete_v213_stage_authority(text,text,jsonb)",
      "videoforge_load_v213_stage_handoff(uuid,text,text)",
      "videoforge_load_v213_cleanup_scope(uuid)",
      "videoforge_claim_v213_operation(jsonb)",
      "videoforge_transition_v213_operation(jsonb)",
      "videoforge_claim_v213_bridge_command(jsonb)",
      "videoforge_transition_v213_bridge_command(jsonb)",
      "videoforge_record_v213_receipt_verification_key(text,text)",
      "videoforge_publish_v213_qualified_deployments(jsonb)",
      "videoforge_record_v213_workflow_start_authority(uuid,uuid,text,timestamptz)",
    ],
    exact_initial_ledger_prefix_count: 36,
    exact_recoverable_prefix_counts: [37, 38, 39, 40, 41, 42, 43, 44, 45],
    exact_migrations_to_apply: [37, 38, 39, 40, 41, 42, 43, 44, 45],
  });
  assert.deepEqual(bootstrap.receipt_exact_fields, [
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
  ]);
  assert.deepEqual(bootstrap.receipt_full_exact_fields, [
    ...bootstrap.receipt_exact_fields,
    "prequalification_database_bootstrap_sha256",
  ]);
  assert.equal(bootstrap.receipt_hash_is_sha256_of_canonical_body, true);
  assert.equal(bootstrap.receipt_file_mode, "0600");
  assert.equal(bootstrap.receipt_parent_directory_mode, "0700");
  assert.equal(bootstrap.receipt_secret_free, true);
  assert.equal(bootstrap.receipt_replay_requires_exact_all_fields, true);
  assert.equal(bootstrap.receipt_final_ledger_count, 45);
  assert.equal(bootstrap.operator_grants_sql_revoke_public_execute, true);
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
  assert.equal(grantedSignatures.length, 17);
  assert.equal(new Set(grantedSignatures).size, grantedSignatures.length);
  assert.deepEqual([...grantedSignatures].sort(), expectedSignatures);
  assert.match(grants, /REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM :"operator_role";/u);
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
  const migration = readFileSync(
    "packages/control-plane/migrations/0045_hosted_full_live_activation.sql",
    "utf8",
  );
  for (const signature of bootstrap.exact_operator_function_signatures)
    assert.equal(
      migration.includes(`REVOKE ALL ON FUNCTION public.${signature} FROM PUBLIC;`),
      true,
      `public execute revoke missing for ${signature}`,
    );
  assert.equal(bootstrap.runpod_calls, 0);
  assert.equal(bootstrap.cloudflare_calls, 0);
  assert.equal(bootstrap.application_secret_reads, 0);
  assert.equal(bootstrap.gpu_use, false);
  assert.equal(bootstrap.external_spend_usd, 0);
  assert.equal(bootstrap.guarded_activation_consumes_verified_receipt, true);
  assert.equal(bootstrap.guarded_activation_receipt_verified_before_application_secret_reads, true);
  assert.equal(
    bootstrap.guarded_activation_receipt_verified_before_cloudflare_or_runtime_secret_reads,
    true,
  );
  assert.deepEqual(bootstrap.recovery_mode_ledger_before_count, {
    FRESH_36_TO_45: 36,
    RESUME_EXACT_PREFIX: [37, 38, 39, 40, 41, 42, 43, 44],
    VERIFIED_EXISTING_45: 45,
  });
  assert.equal(bootstrap.recovery_mode_final_ledger_count, 45);
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

test("successor candidate validates its exact lifecycle gate and supersedes the prior authority", () => {
  const output = execFileSync(
    "node",
    [
      "project-context/evidence/acceptance/VF-10-13/2026-08-27-cloudflare-credential-origin-repair-candidate/validate-candidate.mjs",
    ],
    { encoding: "utf8" },
  );
  const result = JSON.parse(output);
  assert.ok(
    ["PASS_BLOCKED_UNSEALED", "PASS_SEALED_AWAITING_FRESH_EXACT_APPROVAL"].includes(result.status),
  );
  assert.equal(result.authority, "ABSENT");
  assert.equal(result.superseded_authority_id, "v2-13-full-live-20260827-020135z-7444ed0");
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
    targetCommit: v3ReleaseSourceCommit,
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
  assert.throws(() => beginPhase(state, "v2_09_short_hosted_project"), /PHASE_ORDER/u);
});

test("failure is terminal cleanup-only and cannot reopen a paid phase", () => {
  const state = freshStateFixture();
  beginPhase(state, "publication");
  enterCleanupOnly(state, {
    failureCode: "RELEASE_REF_COLLISION",
    eventId: "cleanup-entry-event-0001",
  });
  assert.equal(state.state, "CONSUMED_SINGLE_EXECUTION_CLEANUP_ONLY");
  assert.throws(() => beginPhase(state, "publication"), /NOT_IN_PROGRESS/u);
  assert.throws(() => completeCleanupOnly(state), /CLEANUP_INCOMPLETE/u);
  authorizeCleanupWork(state, {
    workId: "cleanup-zero-worker-readback-0001",
    eventId: "cleanup-authorize-event-0001",
  });
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
  settleCleanupWork(state, {
    workId: "cleanup-zero-worker-readback-0001",
    eventId: "cleanup-settle-event-0001",
  });
  assert.throws(
    () =>
      authorizeCleanupWork(state, {
        workId: "cleanup-zero-worker-readback-0001",
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
  assert.deepEqual(state.cleanup_proof.cleanup_work_ids, ["cleanup-zero-worker-readback-0001"]);
});

test("state storage requires mode-0700 real directory, mode-0600 file, and exact prior hash", () => {
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
  forged.state = "CONSUMED_SINGLE_EXECUTION_CLEANUP_COMPLETE_NO_RETRY";
  forged.terminal = "CLEANUP_PROOFS_RECORDED_ZERO_WORKER_BILLING_MAX_ONE";
  assert.throws(() => validateState(forged), /CLEANUP_COMPLETE_STATE_INVARIANT/u);
  assert.throws(() => beginPhase(forged, "publication"), /CLEANUP_COMPLETE_STATE_INVARIANT/u);

  const terminal = initialConsumptionRecord(
    fixture.authority,
    fixture.authorityBytes,
    recordValidated,
  );
  beginPhase(terminal, "publication");
  enterCleanupOnly(terminal, {
    failureCode: "RELEASE_REF_COLLISION",
    eventId: "cleanup-entry-event-terminal-0001",
  });
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

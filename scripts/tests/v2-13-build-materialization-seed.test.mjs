import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  assertSourceClosureOrder,
  assertSourceEvidenceLineage,
  buildV213MaterializationSeed,
  canonicalBytes,
  canonicalJson,
  FACTS_SCHEMA,
  PROTECTED_INPUT_SCHEMA,
  PROPOSAL_PATH,
  secureRead,
  sha256,
  writeCanonicalSeed,
  writeV213MaterializationSeed,
} from "../../deploy/v2-13/build-materialization-seed.mjs";
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
  EXACT_PREQUALIFICATION_BRIDGE_POLICY,
  EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY,
  EXACT_TRUSTED_TIME_POLICY,
  EXACT_V4_EXECUTION_CONTROL_COMPONENTS,
  EXACT_WORKFLOW_START_AUTHORITY_POLICY,
} from "../../deploy/v2-13/validate-full-live-approval.mjs";

const ROOT = new URL("../..", import.meta.url);
const APPROVAL_PATH =
  "project-context/evidence/acceptance/VF-10-08/2026-08-26-soulx-crop-profile-approval.json";
const CANDIDATE_PATH =
  "project-context/evidence/candidates/VF-10-08/soulx-crop-profile-candidate.json";
const READINESS_PATH =
  "project-context/evidence/acceptance/VF-10-13/2026-08-27-cloudflare-credential-origin-repair-candidate/source-readiness-audit.json";
const FACTS_PATH = "project-context/evidence/acceptance/VF-10-13/materialization-seed-facts.json";
const PROTECTED_PATH = "protected-inputs/v2-13/materialization-seed-input.json";
const BUILDER_PATH = "deploy/v2-13/build-materialization-seed.mjs";
const ENVELOPE_SCHEMA_PATH =
  "project-context/evidence/serverless_worker_job_envelope_v3.schema.json";
const CASE_SOURCE_PATH = "apps/web/src/server/providers/v213-dual-lane-live.ts";
const PRODUCTION_CONFIG_VALIDATOR_PATH = "deploy/v2-13/validate-production-config.mjs";
const APPROVAL_VALIDATOR_PATH = "deploy/v2-13/validate-full-live-approval.mjs";
const CLOSURE_PATH = "deploy/v2-13/full-live-source-closure.json";
const V3_PROPOSAL_SCHEMA = "videoforge.v2-13-full-live-completion-proposal/v3";
const V4_PROPOSAL_SCHEMA = "videoforge.v2-13-full-live-completion-proposal/v4";
const proof = (letter) => `sha256:${letter.repeat(64)}`;
const envelopeKeys = [
  "mage",
  "soulx10s",
  "soulx2s",
  "soulx4s",
  "soulx6s",
  "soulxCancel",
  "soulxInvalidOutput",
  "soulxTimeout",
];
const cases = {
  mage: { lane: "mage", id: "mage-cold-representative", seconds: 0 },
  soulx2s: { lane: "soulx", id: "soulx-cold-2s", seconds: 2 },
  soulx4s: { lane: "soulx", id: "soulx-warm-4s", seconds: 4 },
  soulx6s: { lane: "soulx", id: "soulx-warm-6s", seconds: 6 },
  soulx10s: { lane: "soulx", id: "soulx-warm-10s", seconds: 10 },
  soulxCancel: { lane: "soulx", id: "soulx-cancel", seconds: 2 },
  soulxInvalidOutput: { lane: "soulx", id: "soulx-invalid-output", seconds: 2 },
  soulxTimeout: { lane: "soulx", id: "soulx-timeout", seconds: 2 },
};

function staticReleaseDescriptorAuditFacts(
  sourceEvidenceSha256 = proof("1"),
  observedAt = "2026-08-27T23:59:30.000Z",
) {
  const fact = (gate, claims, metrics) => ({
    gate,
    sourceEvidenceSha256,
    observerId: "codex.runtime-contract-audit",
    evidencePath: READINESS_PATH,
    evidenceClass: "INDEPENDENT_RELEASE_AUDIT",
    observedAt,
    fixtureOrFakeTransportUsed: false,
    claims,
    metrics,
  });
  return {
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
  };
}

function workflowRegistrationEvidence(sourceCommit, overrides = {}) {
  const workflowSha256 = sha256(Buffer.from("avatar-primary-serverless-image workflow\n"));
  const unsigned = {
    schema_version: "videoforge.v213-soulx-workflow-registration-evidence/v1",
    repository: "Pala-LakshmanSai/videoforge",
    default_branch: "main",
    default_branch_commit: "9".repeat(40),
    workflow_file: "avatar-primary-serverless-image.yml",
    workflow_name: "avatar-primary-serverless-image",
    workflow_path: ".github/workflows/avatar-primary-serverless-image.yml",
    default_branch_workflow_sha256: workflowSha256,
    release_source_commit: sourceCommit,
    release_source_workflow_sha256: workflowSha256,
    registration_state: "REGISTERED_EXACT_DEFAULT_BRANCH",
    materialized: true,
    bound_to_release_source: true,
    ...overrides,
  };
  return { ...unsigned, evidence_sha256: sha256(Buffer.from(canonicalJson(unsigned))) };
}

function sourceReader(commit) {
  return (path) =>
    execFileSync("git", ["show", `${commit}:${path}`], {
      cwd: ROOT,
      encoding: "buffer",
      stdio: ["ignore", "pipe", "pipe"],
    });
}

function encode(value, pretty) {
  return pretty ? Buffer.from(`${JSON.stringify(value, null, 2)}\n`) : canonicalBytes(value);
}

function withSecureDirectory(run) {
  const root = mkdtempSync(join(tmpdir(), "v213-seed-builder-"));
  const protectedDirectory = join(root, "protected");
  mkdirSync(protectedDirectory, { mode: 0o700 });
  try {
    return run({ protectedDirectory, root });
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

function simulatedCrash() {
  const error = new Error("simulated hard crash");
  error.code = "SIMULATED_CRASH";
  return error;
}

function git(repository, ...args) {
  return execFileSync("git", args, {
    cwd: repository,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function write(repository, path, value) {
  const target = join(repository, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, value);
}

function commitAll(repository, message) {
  git(repository, "add", "-A");
  git(repository, "commit", "-m", message);
  return git(repository, "rev-parse", "HEAD");
}

function initializeRepository(root) {
  git(root, "init", "-q");
  git(root, "config", "user.email", "builder@example.invalid");
  git(root, "config", "user.name", "Builder Test");
}

function harness({
  caseSourceTransform = (bytes) => bytes,
  descriptorPretty = false,
  descriptorTransform = (value) => value,
  factsPretty = false,
  factsTransform = (value) => value,
  proposalSchema,
  proposalTransform = (value) => value,
  protectedPretty = false,
  protectedTransform = (value) => value,
} = {}) {
  const proposal = JSON.parse(readFileSync(new URL(PROPOSAL_PATH, ROOT)));
  if (proposalSchema !== undefined) {
    proposal.schema_version = proposalSchema;
    if (proposalSchema !== V4_PROPOSAL_SCHEMA) delete proposal.source.execution_control;
  }
  const isV4Proposal = proposal.schema_version === V4_PROPOSAL_SCHEMA;
  if (isV4Proposal) {
    proposal.source.execution_control.exact_components = structuredClone(
      EXACT_V4_EXECUTION_CONTROL_COMPONENTS,
    );
    proposal.source.execution_control.exact_components.approval_validator.source_commit_tree_binding.commit_field =
      "source.execution_control.commit";
  }
  proposal.exact_execution_graph.ordered_operation_ids = [...EXACT_OPERATION_IDS];
  for (const [key, value] of [
    ["bootstrap_partial_cleanup_policy", EXACT_BOOTSTRAP_PARTIAL_CLEANUP_POLICY],
    ["crash_safe_cleanup_policy", EXACT_CRASH_SAFE_CLEANUP_POLICY],
    ["durable_billing_policy", EXACT_DURABLE_BILLING_POLICY],
    ["early_no_database_cleanup_policy", EXACT_EARLY_NO_DATABASE_CLEANUP_POLICY],
    ["image_workflow_verification_policy", EXACT_IMAGE_WORKFLOW_VERIFICATION_POLICY],
    ["internal_materialization_policy", EXACT_INTERNAL_MATERIALIZATION_POLICY],
    ["prequalification_bridge_policy", EXACT_PREQUALIFICATION_BRIDGE_POLICY],
    [
      "prequalification_database_bootstrap_policy",
      EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY,
    ],
    ["trusted_time_policy", EXACT_TRUSTED_TIME_POLICY],
    ["workflow_start_authority_policy", EXACT_WORKFLOW_START_AUTHORITY_POLICY],
  ])
    proposal.exact_execution_graph[key] = structuredClone(value);
  if (isV4Proposal) {
    proposal.exact_execution_graph.predecessor_mage_reconciliation_policy = structuredClone(
      EXACT_PREDECESSOR_MAGE_RECONCILIATION_POLICY,
    );
    proposal.supersession.predecessor_release_attempt = structuredClone(
      EXACT_PREDECESSOR_RELEASE_ATTEMPT,
    );
  } else delete proposal.exact_execution_graph.predecessor_mage_reconciliation_policy;
  const database = proposal.requested_scope.database;
  const bootstrap = EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY;
  database.prequalification_database_bootstrap_operator_function_signature_count =
    bootstrap.exact_operator_function_signature_count;
  database.prequalification_database_bootstrap_operator_function_signature_namespace =
    bootstrap.exact_operator_function_signature_namespace;
  database.prequalification_database_bootstrap_operator_function_signature_canonicalization =
    bootstrap.exact_operator_function_signature_canonicalization;
  database.prequalification_database_bootstrap_operator_acl_comparison =
    bootstrap.exact_operator_function_acl_comparison;
  database.prequalification_database_bootstrap_public_execute_readback_count =
    bootstrap.public_function_execute_readback_count;
  database.prequalification_database_bootstrap_public_default_execute_readback_count =
    bootstrap.public_default_function_execute_readback_count;
  database.prequalification_database_bootstrap_ownership_catalogs = [
    ...bootstrap.ownership_catalogs,
  ];
  database.prequalification_database_bootstrap_ownership_readback_is_cluster_wide =
    bootstrap.ownership_readback_is_cluster_wide;
  database.prequalification_database_bootstrap_requires_consumed_outer_authority =
    bootstrap.requires_consumed_outer_authority;
  database.prequalification_database_bootstrap_credential_bundle_schema =
    bootstrap.database_role_credential_bundle_schema;
  database.prequalification_database_bootstrap_credential_bundle_path =
    bootstrap.database_role_credential_bundle_path;
  database.prequalification_database_bootstrap_credentials_absent_before_consumed_bootstrap =
    bootstrap.database_role_credentials_absent_before_consumed_bootstrap;
  database.prequalification_database_bootstrap_credentials_materialized_after_migration_prefix_commit_count =
    bootstrap.database_role_credentials_materialized_after_migration_prefix_commit_count;
  database.prequalification_database_bootstrap_credential_roles = [
    ...bootstrap.database_role_credentials_exact_roles,
  ];
  database.prequalification_database_bootstrap_runtime_reconciler_credentials_staged_roles_absent_until_guarded_activation =
    bootstrap.runtime_and_reconciler_credentials_staged_but_roles_remain_absent_until_guarded_activation;
  database.prequalification_database_bootstrap_exact_one_time_database_role_credential_count =
    bootstrap.exact_one_time_database_role_credential_count;
  database.prequalification_database_bootstrap_exact_one_time_database_role_credential_scope =
    bootstrap.exact_one_time_database_role_credential_scope;
  database.prequalification_database_bootstrap_exact_one_time_internal_production_credential_count =
    bootstrap.exact_one_time_internal_production_credential_count;
  database.prequalification_database_bootstrap_exact_one_time_internal_production_credential_scope =
    [...bootstrap.exact_one_time_internal_production_credential_scope];
  database.prequalification_database_bootstrap_operator_dsn_value_read_after_migration_prefix_commit_count =
    bootstrap.operator_dsn_policy.value_read_after_migration_prefix_commit_count;
  database.prequalification_database_bootstrap_operator_dsn_value_read_forbidden_before_migration_prefix_commit =
    bootstrap.operator_dsn_policy.value_read_forbidden_before_migration_prefix_commit;
  database.prequalification_database_bootstrap_phase = bootstrap.phase;
  database.prequalification_database_bootstrap_phase_cap_usd = bootstrap.phase_cap_usd;
  database.prequalification_database_bootstrap_receipt_path = bootstrap.receipt_path;
  database.prequalification_database_bootstrap_receipt_hash_field = bootstrap.receipt_hash_field;
  database.prequalification_database_bootstrap_receipt_replay_cas_required =
    bootstrap.receipt_replay_cas_required;
  database.prequalification_database_bootstrap_recovery_mode_ledger_before_count = structuredClone(
    bootstrap.recovery_mode_ledger_before_count,
  );
  database.prequalification_database_bootstrap_recovery_mode_final_ledger_count =
    bootstrap.recovery_mode_final_ledger_count;
  database.exact_operator_function_signatures = [...bootstrap.exact_operator_function_signatures];
  database.exact_initial_ledger_prefix_count = 36;
  database.exact_recoverable_prefix_counts = [37, 38, 39, 40, 41, 42, 43, 44, 45, 46];
  database.exact_migrations_to_apply = [37, 38, 39, 40, 41, 42, 43, 44, 45, 46];
  proposal.requested_scope.database = Object.fromEntries(
    [
      "exact_operator_role",
      "exact_runtime_role",
      "exact_reconciler_role",
      "roles_must_be_fresh_absent_distinct_login_noinherit_hardened",
      "pgcrypto_required",
      "prequalification_database_bootstrap_operator_function_signature_count",
      "prequalification_database_bootstrap_operator_function_signature_namespace",
      "prequalification_database_bootstrap_operator_function_signature_canonicalization",
      "prequalification_database_bootstrap_operator_acl_comparison",
      "prequalification_database_bootstrap_public_execute_readback_count",
      "prequalification_database_bootstrap_public_default_execute_readback_count",
      "prequalification_database_bootstrap_ownership_catalogs",
      "prequalification_database_bootstrap_ownership_readback_is_cluster_wide",
      "prequalification_database_bootstrap_requires_consumed_outer_authority",
      "prequalification_database_bootstrap_credential_bundle_schema",
      "prequalification_database_bootstrap_credential_bundle_path",
      "prequalification_database_bootstrap_credentials_absent_before_consumed_bootstrap",
      "prequalification_database_bootstrap_credentials_materialized_after_migration_prefix_commit_count",
      "prequalification_database_bootstrap_credential_roles",
      "prequalification_database_bootstrap_runtime_reconciler_credentials_staged_roles_absent_until_guarded_activation",
      "prequalification_database_bootstrap_exact_one_time_database_role_credential_count",
      "prequalification_database_bootstrap_exact_one_time_database_role_credential_scope",
      "prequalification_database_bootstrap_exact_one_time_internal_production_credential_count",
      "prequalification_database_bootstrap_exact_one_time_internal_production_credential_scope",
      "prequalification_database_bootstrap_operator_dsn_value_read_after_migration_prefix_commit_count",
      "prequalification_database_bootstrap_operator_dsn_value_read_forbidden_before_migration_prefix_commit",
      "prequalification_database_bootstrap_phase",
      "prequalification_database_bootstrap_phase_cap_usd",
      "prequalification_database_bootstrap_receipt_path",
      "prequalification_database_bootstrap_receipt_hash_field",
      "prequalification_database_bootstrap_receipt_replay_cas_required",
      "prequalification_database_bootstrap_recovery_mode_ledger_before_count",
      "prequalification_database_bootstrap_recovery_mode_final_ledger_count",
      "exact_operator_function_signatures",
      "exact_initial_ledger_prefix_count",
      "exact_recoverable_prefix_counts",
      "exact_migrations_to_apply",
    ].map((key) => [key, database[key]]),
  );
  const gitSource = sourceReader(proposal.source.release_source_commit);
  const origin = proposal.source.pending_source_contract.account_and_workers_dev_origin;
  const overlay = new Map();
  const migrationManifestPath = "packages/control-plane/migrations/manifest.json";
  const migrationManifestBytes = readFileSync(new URL(migrationManifestPath, ROOT));
  const migrationManifest = JSON.parse(migrationManifestBytes);
  overlay.set(migrationManifestPath, migrationManifestBytes);
  proposal.source.exact_release_components.migration_manifest = {
    path: migrationManifestPath,
    sha256: sha256(migrationManifestBytes),
  };
  proposal.source.pending_source_contract.release_component_sha256s.migration_manifest =
    sha256(migrationManifestBytes);
  for (const migration of migrationManifest.migrations) {
    const migrationPath = `packages/control-plane/migrations/${migration.filename}`;
    overlay.set(migrationPath, readFileSync(new URL(migrationPath, ROOT)));
  }
  const builderBytes = readFileSync(new URL(BUILDER_PATH, ROOT));
  const qualificationCaseSourceBytes = Buffer.from(
    caseSourceTransform(readFileSync(new URL(CASE_SOURCE_PATH, ROOT))),
  );
  const builderSha256 = sha256(builderBytes);
  proposal.source.exact_release_components.materialization_seed_builder = {
    path: BUILDER_PATH,
    sha256: builderSha256,
  };
  if (isV4Proposal) {
    proposal.source.execution_control.exact_components.migration_manifest = {
      path: migrationManifestPath,
      sha256: sha256(migrationManifestBytes),
    };
    proposal.source.execution_control.exact_components.materialization_seed_builder = {
      path: BUILDER_PATH,
      sha256: builderSha256,
    };
  }
  proposal.source.pending_source_contract.release_component_sha256s.materialization_seed_builder =
    builderSha256;
  overlay.set(BUILDER_PATH, builderBytes);
  overlay.set(CASE_SOURCE_PATH, qualificationCaseSourceBytes);
  for (const [key, path] of [
    ["materialization_seed_envelope_schema", ENVELOPE_SCHEMA_PATH],
    ["materialization_seed_qualification_case_source", CASE_SOURCE_PATH],
  ]) {
    const sourceSha256 = sha256(overlay.get(path) ?? gitSource(path));
    proposal.source.exact_release_components[key] = { path, sha256: sourceSha256 };
    proposal.source.pending_source_contract.release_component_sha256s[key] = sourceSha256;
  }
  const readSource = (path) => overlay.get(path) ?? gitSource(path);
  const ref = (path) => ({ path, sha256: sha256(readSource(path)) });
  const fullLiveAuthorityId = "12345678-1234-4123-8123-123456789abc";
  const envelopeSigningKeyId = `v213-envelope-${sha256(
    Buffer.from(`${fullLiveAuthorityId}\0envelope`),
  ).slice(7, 31)}`;
  const caseDocumentPath =
    "project-context/evidence/acceptance/VF-10-13/qualification-case-descriptor.json";
  const caseValidationPath =
    "project-context/evidence/acceptance/VF-10-13/qualification-case-validation.json";
  const releaseManifestPath =
    "project-context/evidence/acceptance/VF-10-13/media-worker-release-manifest.json";
  const mageValidatorPath = "workers/image-media/src/videoforge_image_media/mage_production.py";
  const soulxValidatorPath = "workers/avatar-primary/soulx_serverless.py";
  const mageGeneratorPath = "deploy/v2-13/generate-mage-qualification-case.mjs";
  const soulxGeneratorPath = "deploy/v2-13/generate-soulx-qualification-cases.mjs";
  overlay.set(mageGeneratorPath, Buffer.from('export const lane = "mage";\n'));
  overlay.set(soulxGeneratorPath, Buffer.from('export const lane = "soulx";\n'));
  for (const [key, path] of [
    ["materialization_seed_mage_case_generator", mageGeneratorPath],
    ["materialization_seed_soulx_case_generator", soulxGeneratorPath],
    ["materialization_seed_mage_case_validator", mageValidatorPath],
    ["materialization_seed_soulx_case_validator", soulxValidatorPath],
  ]) {
    proposal.source.exact_release_components[key] = ref(path);
    proposal.source.pending_source_contract.release_component_sha256s[key] = ref(path).sha256;
  }
  const caseDocument = {
    schema_version: "videoforge.v213-unsigned-qualification-cases/v1",
    envelope_schema: proposal.source.exact_release_components.materialization_seed_envelope_schema,
    cases: Object.fromEntries(
      envelopeKeys.map((name) => {
        const qualificationCase = cases[name];
        const requestBlueprint = {
          batch: {
            contract:
              qualificationCase.lane === "mage"
                ? "MAGE_INLINE_QUALIFICATION_V1"
                : "videoforge-soulx-span-batch/v1",
            case_id: qualificationCase.id,
            seconds: qualificationCase.seconds,
          },
          ports: {
            input_reservation_ids: [`input-${qualificationCase.id}`],
            output_reservation_ids: [`output-${qualificationCase.id}`],
          },
        };
        return [
          name,
          {
            case_id: qualificationCase.id,
            cold: name === "mage" || name === "soulx2s",
            lane: qualificationCase.lane,
            mode:
              name === "soulxCancel"
                ? "cancel"
                : name === "soulxInvalidOutput"
                  ? "invalid"
                  : name === "soulxTimeout"
                    ? "timeout"
                    : "complete",
            request_blueprint: requestBlueprint,
            request_blueprint_sha256: sha256(Buffer.from(canonicalJson(requestBlueprint))),
            seconds: qualificationCase.seconds,
          },
        ];
      }),
    ),
  };
  const caseDocumentBytes = canonicalBytes(caseDocument);
  overlay.set(caseDocumentPath, caseDocumentBytes);
  const caseValidation = {
    schema_version: "videoforge.v213-qualification-case-validation/v1",
    case_document_sha256: sha256(caseDocumentBytes),
    provider_free: true,
    result: "PASS_ACTUAL_MAGE_AND_SOULX_WORKER_CONTRACTS",
    validators: {
      mage: ref(mageValidatorPath),
      soulx: ref(soulxValidatorPath),
    },
  };
  const caseValidationBytes = canonicalBytes(caseValidation);
  overlay.set(caseValidationPath, caseValidationBytes);
  const releaseManifest = {
    schema_version: "videoforge-media-worker-release/v1",
    version: "1.0.0",
    minimum_protocol_version: 1,
    execution_bundle_sha256: proof("6"),
    whisper_model_sha256: proof("7"),
    windows: {
      url: "https://downloads.videoforge.example/worker.exe",
      sha256: proof("8"),
      size_bytes: 1,
      trust: "UNSIGNED_BETA",
    },
    macos: {
      url: "https://downloads.videoforge.example/worker.dmg",
      sha256: proof("9"),
      size_bytes: 1,
      trust: "AD_HOC_BETA",
    },
  };
  overlay.set(releaseManifestPath, canonicalBytes(releaseManifest));
  const closureEntries = [
    APPROVAL_VALIDATOR_PATH,
    BUILDER_PATH,
    CASE_SOURCE_PATH,
    ENVELOPE_SCHEMA_PATH,
    PRODUCTION_CONFIG_VALIDATOR_PATH,
    caseDocumentPath,
    caseValidationPath,
    releaseManifestPath,
    mageValidatorPath,
    soulxValidatorPath,
    mageGeneratorPath,
    soulxGeneratorPath,
    migrationManifestPath,
    ...migrationManifest.migrations.map(
      (migration) => `packages/control-plane/migrations/${migration.filename}`,
    ),
  ]
    .map((path) => ({ path, sha256: sha256(readSource(path)) }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const closureBytes = canonicalBytes({
    schema_version: "videoforge.v2-13-full-live-source-closure/v1",
    entries: closureEntries,
  });
  overlay.set(CLOSURE_PATH, closureBytes);
  proposal.source.exact_release_components.source_closure_manifest = ref(CLOSURE_PATH);
  proposal.source.pending_source_contract.release_component_sha256s.source_closure_manifest =
    sha256(closureBytes);
  if (isV4Proposal) {
    proposal.source.execution_control.exact_components.source_closure_manifest = ref(CLOSURE_PATH);
  }
  const auditFacts = staticReleaseDescriptorAuditFacts();
  const sourceClosureSha256 = sha256(closureBytes);
  const sourceReadiness = {
    schema_version: "videoforge.v2-13-full-live-source-readiness-audit/v1",
    audited_code_commit: "7c1f6c255cd8355295be93621e9347abe0442646",
    audit_result: "PASS_READY_TO_RESEAL",
    evidence_class: "INDEPENDENT_RELEASE_AUDIT",
    observer_id: "codex.runtime-contract-audit",
    fixture_or_fake_transport_used: false,
    observed_at: "2026-08-27T23:59:30.000Z",
    provider_state_observed: false,
    credential_accessed: false,
    external_calls: 0,
    provider_mutations: 0,
    gpu_use: 0,
    spend_usd: 0,
    source_closure: {
      path: CLOSURE_PATH,
      entry_count: closureEntries.length,
      sha256: sourceClosureSha256,
      exact: true,
    },
    contract_bundle: {
      definition: "CANONICAL_FULL_LIVE_SOURCE_CLOSURE_BYTES",
      path: CLOSURE_PATH,
      sha256: sourceClosureSha256,
    },
    qualification_case_validation: {
      path: caseValidationPath,
      sha256: sha256(caseValidationBytes),
      result: "PASS_ACTUAL_MAGE_AND_SOULX_WORKER_CONTRACTS",
    },
    production_origin: {
      value: origin.public_origin,
      sha256: sha256(Buffer.from(origin.public_origin)),
    },
    audit_facts: Object.fromEntries(
      Object.entries(auditFacts).map(([gate, fact]) => [
        gate,
        { claims: fact.claims, metrics: fact.metrics },
      ]),
    ),
  };
  const sourceReadinessBytes = Buffer.from(`${JSON.stringify(sourceReadiness, null, 2)}\n`);
  overlay.set(READINESS_PATH, sourceReadinessBytes);
  const protectedInput = protectedTransform({
    schema_version: PROTECTED_INPUT_SCHEMA,
    qualification: { envelope_signing_key_id: envelopeSigningKeyId },
  });
  const protectedInputBytes = encode(protectedInput, protectedPretty);
  const facts = factsTransform({
    schema_version: FACTS_SCHEMA,
    full_live_authority_id: fullLiveAuthorityId,
    database: {
      host: "ep-sparkling-dew-azjhkwg6-pooler.c-3.ap-southeast-1.aws.neon.tech",
      database: "neondb",
      owner_role: "neondb_owner",
    },
    retained_volume_manifest_sha256s: {
      mage: "sha256:cebcd5c6233c2eae32f26ced7510acef8192f0d92d7ec3e9dd3ee881d66d205b",
      soulx: "sha256:995a8e478b6a3265d5a116ca283229ad0d358a5348f16f851dc0fed564bf5626",
    },
    protected_input: {
      path: PROTECTED_PATH,
      schema_version: PROTECTED_INPUT_SCHEMA,
      sha256: sha256(protectedInputBytes),
    },
    source_evidence: { source_readiness: ref(READINESS_PATH) },
    soulx_crop_evidence: {
      approval: ref(APPROVAL_PATH),
      candidate: ref(CANDIDATE_PATH),
    },
  });
  const factsBytes = encode(facts, factsPretty);
  const factsBinding = {
    commit_field: isV4Proposal ? "source.execution_control.commit" : "source.release_source_commit",
    full_live_authority_id: fullLiveAuthorityId,
    path: FACTS_PATH,
    sha256: sha256(factsBytes),
  };
  proposal.sealing.materialization_seed_facts = structuredClone(factsBinding);
  proposal.requested_scope.materialization_seed_facts = structuredClone(factsBinding);
  let descriptor = descriptorTransform({
    schemaVersion: "videoforge.v213-static-release-descriptor/v1",
    sourceCommit: proposal.source.release_source_commit,
    productionUrlSha256: sourceReadiness.production_origin.sha256,
    contractBundleSha256: sourceReadiness.contract_bundle.sha256,
    auditFacts: staticReleaseDescriptorAuditFacts(sha256(sourceReadinessBytes)),
  });
  descriptor = {
    ...descriptor,
    descriptorSha256: sha256(Buffer.from(canonicalJson(descriptor))),
  };
  const staticReleaseDescriptorBytes = encode(descriptor, descriptorPretty);
  proposal.sealing.static_release_descriptor = {
    path: "protected-inputs/v2-13/static-release-descriptor.json",
    sha256: descriptor.descriptorSha256,
  };
  proposalTransform(proposal);
  overlay.set(FACTS_PATH, factsBytes);
  return {
    facts,
    overlay,
    proposal,
    protectedInput,
    staticReleaseDescriptorBytes,
    arguments: {
      proposalBytes: Buffer.from(`${JSON.stringify(proposal, null, 2)}\n`),
      proposalPath: PROPOSAL_PATH,
      protectedInputBytes,
      readSourceFile: (path) => overlay.get(path) ?? readSource(path),
      staticReleaseDescriptorBytes,
      validateSourceEvidenceLineage(input) {
        assert.equal(input.auditedCodeCommit, "7c1f6c255cd8355295be93621e9347abe0442646");
        assert.equal(
          input.releaseSourceCommit,
          isV4Proposal
            ? proposal.source.execution_control.commit
            : proposal.source.release_source_commit,
        );
        assert.equal(input.factsPath, FACTS_PATH);
        assert.equal(input.sourceReadinessPath, READINESS_PATH);
      },
    },
  };
}

function releaseTreeApprovalValidator(sourceBytes, exactReleaseComponents) {
  const source = Buffer.from(sourceBytes).toString("utf8");
  const start = source.indexOf("const EXACT_V3_RELEASE_COMPONENTS = Object.freeze(");
  const end = source.indexOf("const EXACT_V4_EXECUTION_CONTROL_COMPONENTS", start);
  assert.ok(
    start >= 0 && end > start,
    "approval validator must expose its exact component contract",
  );
  return Buffer.from(
    `${source.slice(0, start)}const EXACT_V3_RELEASE_COMPONENTS = Object.freeze(${JSON.stringify(exactReleaseComponents)});\n${source.slice(end)}`,
  );
}

function replaceDeep(value, from, to) {
  if (typeof value === "string") return value === from ? to : value;
  if (Array.isArray(value)) return value.map((item) => replaceDeep(item, from, to));
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, replaceDeep(child, from, to)]),
    );
  return value;
}

function buildTempGitEndToEndFixture() {
  const input = harness({ proposalSchema: V3_PROPOSAL_SCHEMA });
  const repositoryRoot = mkdtempSync(join(tmpdir(), "v213-seed-builder-git-"));
  initializeRepository(repositoryRoot);
  const sourceBytes = input.arguments.readSourceFile;

  // The approval validator has an explicit external tree-entry binding. It is intentionally not
  // part of the source-closure hash, which would otherwise create a self-referential hash cycle.
  const closure = JSON.parse(input.overlay.get(CLOSURE_PATH));
  closure.entries = closure.entries.filter((entry) => entry.path !== APPROVAL_VALIDATOR_PATH);
  const closureBytes = canonicalBytes(closure);
  input.overlay.set(CLOSURE_PATH, closureBytes);
  input.proposal.source.exact_release_components.source_closure_manifest = {
    path: CLOSURE_PATH,
    sha256: sha256(closureBytes),
  };
  input.proposal.source.pending_source_contract.release_component_sha256s.source_closure_manifest =
    sha256(closureBytes);
  const validatorBytes = releaseTreeApprovalValidator(
    readFileSync(new URL(APPROVAL_VALIDATOR_PATH, ROOT)),
    input.proposal.source.exact_release_components,
  );

  const sourcePaths = new Set(input.overlay.keys());
  sourcePaths.delete(FACTS_PATH);
  sourcePaths.delete(READINESS_PATH);
  sourcePaths.add(APPROVAL_VALIDATOR_PATH);
  for (const component of Object.values(input.proposal.source.exact_release_components))
    if (component?.path && component.path !== CLOSURE_PATH) sourcePaths.add(component.path);
  for (const path of [
    ENVELOPE_SCHEMA_PATH,
    PRODUCTION_CONFIG_VALIDATOR_PATH,
    "workers/image-media/src/videoforge_image_media/mage_production.py",
    "workers/avatar-primary/soulx_serverless.py",
    APPROVAL_PATH,
    CANDIDATE_PATH,
    "packages/control-plane/migrations/manifest.json",
  ])
    sourcePaths.add(path);
  const migrationManifest = JSON.parse(
    sourceBytes("packages/control-plane/migrations/manifest.json"),
  );
  for (const migration of migrationManifest.migrations)
    sourcePaths.add(`packages/control-plane/migrations/${migration.filename}`);
  sourcePaths.delete(PROPOSAL_PATH);

  for (const path of sourcePaths)
    write(
      repositoryRoot,
      path,
      path === APPROVAL_VALIDATOR_PATH ? validatorBytes : sourceBytes(path),
    );
  // The audited source commit contains the exact closure and all executable source inputs. The
  // evidence records are deliberately changed only by the linear release-source successor.
  write(repositoryRoot, FACTS_PATH, "{}\n");
  write(repositoryRoot, READINESS_PATH, "{}\n");
  const auditedCodeCommit = commitAll(repositoryRoot, "audited release source");

  const readiness = JSON.parse(input.overlay.get(READINESS_PATH));
  readiness.audited_code_commit = auditedCodeCommit;
  readiness.source_closure = {
    path: CLOSURE_PATH,
    entry_count: closure.entries.length,
    sha256: sha256(closureBytes),
    exact: true,
  };
  readiness.contract_bundle = {
    definition: "CANONICAL_FULL_LIVE_SOURCE_CLOSURE_BYTES",
    path: CLOSURE_PATH,
    sha256: sha256(closureBytes),
  };
  const readinessBytes = Buffer.from(`${JSON.stringify(readiness, null, 2)}\n`);
  const facts = JSON.parse(input.overlay.get(FACTS_PATH));
  facts.source_evidence.source_readiness = {
    path: READINESS_PATH,
    sha256: sha256(readinessBytes),
  };
  const factsBytes = canonicalBytes(facts);
  input.overlay.set(READINESS_PATH, readinessBytes);
  input.overlay.set(FACTS_PATH, factsBytes);
  const factsBinding = {
    commit_field: "source.release_source_commit",
    full_live_authority_id: facts.full_live_authority_id,
    path: FACTS_PATH,
    sha256: sha256(factsBytes),
  };
  input.proposal.sealing.materialization_seed_facts = structuredClone(factsBinding);
  input.proposal.requested_scope.materialization_seed_facts = structuredClone(factsBinding);
  write(repositoryRoot, FACTS_PATH, factsBytes);
  write(repositoryRoot, READINESS_PATH, readinessBytes);
  const releaseSourceCommit = commitAll(repositoryRoot, "committed release evidence");

  input.proposal = replaceDeep(
    input.proposal,
    "2f314531b4d65904bec99cb421db49aa579b5820",
    releaseSourceCommit,
  );
  input.proposal.source.release_source_commit = releaseSourceCommit;
  input.proposal.source.repaired_release_source_commit = releaseSourceCommit;
  input.proposal.source.pending_source_contract.release_source_commit = releaseSourceCommit;

  const descriptor = {
    schemaVersion: "videoforge.v213-static-release-descriptor/v1",
    sourceCommit: releaseSourceCommit,
    productionUrlSha256: readiness.production_origin.sha256,
    contractBundleSha256: readiness.contract_bundle.sha256,
    auditFacts: staticReleaseDescriptorAuditFacts(sha256(readinessBytes)),
  };
  descriptor.descriptorSha256 = sha256(Buffer.from(canonicalJson(descriptor)));
  const descriptorBytes = canonicalBytes(descriptor);
  const descriptorBinding = {
    path: "protected-inputs/v2-13/static-release-descriptor.json",
    sha256: descriptor.descriptorSha256,
  };
  input.proposal.sealing.static_release_descriptor = descriptorBinding;
  input.proposal.requested_scope.static_release_descriptor = structuredClone(descriptorBinding);
  input.proposal.immutable_github_release_ref_request.exact_target_commit = releaseSourceCommit;
  if (input.proposal.schema_version === V3_PROPOSAL_SCHEMA) {
    input.proposal.immutable_github_release_ref_request.creation_requested = true;
    input.proposal.immutable_github_release_ref_request.maximum_new_refs = 1;
  }

  const proposalBytes = Buffer.from(`${JSON.stringify(input.proposal, null, 2)}\n`);
  write(repositoryRoot, PROPOSAL_PATH, proposalBytes);
  const proposalRecordCommit = commitAll(repositoryRoot, "sealed proposal record");
  const proposalSha256 = sha256(proposalBytes);
  const approval = replaceDeep(
    JSON.parse(
      readFileSync(
        new URL(
          "../../project-context/evidence/acceptance/VF-10-13/2026-08-26-full-activation-ref-role-repair-candidate/user-approval.json",
          import.meta.url,
        ),
      ),
    ),
    "2d64eefd1f5f139907fa02839d7abd90b6f0a81aca3190a48ab7420f8cfe07cc",
    proposalSha256,
  );
  const approved = replaceDeep(
    approval,
    "febf05e247331db1a6105b4d526e07756f567a1c",
    proposalRecordCommit,
  );
  const approvalWithSource = replaceDeep(
    approved,
    "2f314531b4d65904bec99cb421db49aa579b5820",
    releaseSourceCommit,
  );
  approvalWithSource.proposal = {
    path: PROPOSAL_PATH,
    sha256: proposalSha256,
    proposal_record_commit: proposalRecordCommit,
    release_source_commit: releaseSourceCommit,
  };
  approvalWithSource.approval.gpu.maximum_serverless_flex_rate_usd_per_gpu_hour = 1.116;
  approvalWithSource.full_live_authority_id = facts.full_live_authority_id;
  approvalWithSource.static_release_descriptor = structuredClone(descriptorBinding);
  approvalWithSource.approval.immutable_github_release_ref.exact_target_commit =
    releaseSourceCommit;
  approvalWithSource.approval.internal_production_credentials = {
    exact_one_time_count:
      EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.exact_one_time_internal_production_credential_count,
    exact_scope:
      EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.exact_one_time_internal_production_credential_scope,
    generated_only_after_consumption: true,
    other_credential_creation_or_rotation_forbidden: true,
  };
  approvalWithSource.approval.database_roles = {
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
  approvalWithSource.statement = `I approve ${proposalSha256} at commit ${proposalRecordCommit} for one exact single-use execution with USD 17.50, USD 7 per month, no fallback, lightweight tag videoforge-v2-13-release-20260826-v3, and exact roles videoforge_hosted_operator, videoforge_hosted_runtime, and videoforge_hosted_reconciler.`;
  const orderedApproval = Object.fromEntries(
    [
      "schema_version",
      "checkpoint_range",
      "task_id",
      "authority_id",
      "full_live_authority_id",
      "approval_source",
      "approved_at",
      "expires_at",
      "proposal",
      "approval",
      "execution_fences",
      "static_release_descriptor",
      "statement",
    ].map((key) => [key, approvalWithSource[key]]),
  );
  const approvalBytes = Buffer.from(`${JSON.stringify(orderedApproval)}\n`);
  const approvalSha256 = sha256(approvalBytes);

  const protectedDirectory = join(repositoryRoot, "protected-inputs", "v2-13");
  mkdirSync(protectedDirectory, { recursive: true, mode: 0o700 });
  writeFileSync(
    join(repositoryRoot, facts.protected_input.path),
    input.arguments.protectedInputBytes,
    {
      mode: 0o600,
    },
  );
  writeFileSync(join(repositoryRoot, descriptorBinding.path), descriptorBytes, { mode: 0o600 });
  const approvalFile = join(protectedDirectory, "user-approval.json");
  writeFileSync(approvalFile, approvalBytes, { mode: 0o600 });
  const outputFile = join(protectedDirectory, "materialization-seed.json");
  return {
    approval,
    approvalBytes,
    approvalFile,
    approvalSha256,
    auditedCodeCommit,
    descriptorBytes,
    descriptorBinding,
    facts,
    outputFile,
    proposalBytes,
    proposalRecordCommit,
    proposalSha256,
    protectedInputFile: join(repositoryRoot, facts.protected_input.path),
    releaseSourceCommit,
    repositoryRoot,
    staticReleaseDescriptorFile: join(repositoryRoot, descriptorBinding.path),
  };
}

test("builds the exact static production seed from proposal-bound source and protected bytes", () => {
  const input = harness();
  const first = buildV213MaterializationSeed(input.arguments);
  const replay = buildV213MaterializationSeed(input.arguments);

  assert.deepEqual(first.bytes, canonicalBytes(first.seed));
  assert.equal(first.sha256, sha256(first.bytes));
  assert.equal(replay.sha256, first.sha256);
  assert.deepEqual(replay.bytes, first.bytes);
  assert.equal(first.seed.production_input_base.authorityDocument.constructor, Object);
  assert.deepEqual(first.seed.production_input_base.authorityDocument, {});
  assert.deepEqual(first.seed.production_input_base.commandPayloads, {});
  assert.equal(
    first.seed.activation_record_base.full_live_authority_id,
    first.seed.production_input_base.fullLiveAuthorityId,
  );
  assert.equal(first.seed.activation_record_base.database.operator_database_url_sha256, null);
  assert.equal(
    first.seed.promotion_record_base.database.migration_ledger_sha256,
    "sha256:f3a42c5ec4413216ee8334cb11d11c724b652f080dfa39b240587a5625f7ad9f",
  );
  assert.equal(
    Object.hasOwn(first.seed.production_input_base.dualLaneInput, "billingBaselineUsd"),
    false,
  );
  assert.equal(first.seed.release_manifest, null);
  assert.equal(
    Object.hasOwn(first.seed.production_input_base.dualLaneInput, "qualificationCaseBlueprints"),
    false,
  );
  assert.deepEqual(
    Object.keys(
      first.seed.production_input_base.dualLaneInput.qualificationCaseDescriptor.generators,
    ).sort(),
    ["mage", "soulx"],
  );
  assert.equal(first.seed.static_only, true);
  assert.equal(first.seed.future_output_hashes_present, false);
});

test("descriptor v2 embeds exact hash-bound repair evidence while v1 remains build-compatible", () => {
  const v2 = harness({
    descriptorTransform(descriptor) {
      descriptor.schemaVersion = "videoforge.v213-static-release-descriptor/v2";
      descriptor.workflowRegistrationEvidence = workflowRegistrationEvidence(
        descriptor.sourceCommit,
      );
      return descriptor;
    },
  });
  assert.doesNotThrow(() => buildV213MaterializationSeed(v2.arguments));

  const forged = harness({
    descriptorTransform(descriptor) {
      descriptor.schemaVersion = "videoforge.v213-static-release-descriptor/v2";
      descriptor.workflowRegistrationEvidence = workflowRegistrationEvidence(
        descriptor.sourceCommit,
      );
      descriptor.workflowRegistrationEvidence.default_branch_commit = "8".repeat(40);
      return descriptor;
    },
  });
  assert.throws(
    () => buildV213MaterializationSeed(forged.arguments),
    /STATIC_DESCRIPTOR_WORKFLOW_REGISTRATION/u,
  );
});

test("fails closed when the committed proposal does not bind the authenticated facts record", () => {
  const input = harness({
    proposalTransform(proposal) {
      delete proposal.sealing.materialization_seed_facts;
      delete proposal.requested_scope.materialization_seed_facts;
    },
  });
  assert.throws(
    () => buildV213MaterializationSeed(input.arguments),
    /V2_13_MATERIALIZATION_SEED_BUILDER_PROPOSAL_FACTS_BINDING/u,
  );
});

test("fails closed when the proposal-bound authority UUID drifts from committed facts", () => {
  const input = harness({
    proposalTransform(proposal) {
      const drifted = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      proposal.sealing.materialization_seed_facts.full_live_authority_id = drifted;
      proposal.requested_scope.materialization_seed_facts.full_live_authority_id = drifted;
    },
  });
  assert.throws(
    () => buildV213MaterializationSeed(input.arguments),
    /V2_13_MATERIALIZATION_SEED_BUILDER_FACTS_AUTHORITY_BINDING/u,
  );
});

test("rejects noncanonical committed facts bytes even when their raw hash is proposal-bound", () => {
  const input = harness({ factsPretty: true });
  assert.throws(
    () => buildV213MaterializationSeed(input.arguments),
    /V2_13_MATERIALIZATION_SEED_BUILDER_FACTS_NONCANONICAL/u,
  );
});

test("rejects noncanonical protected bytes even when the facts record binds their raw hash", () => {
  const input = harness({ protectedPretty: true });
  assert.throws(
    () => buildV213MaterializationSeed(input.arguments),
    /V2_13_MATERIALIZATION_SEED_BUILDER_PROTECTED_INPUT_NONCANONICAL/u,
  );
});

test("rejects protected raw-byte drift before inspecting its document", () => {
  const input = harness();
  input.arguments.protectedInputBytes = Buffer.concat([
    input.arguments.protectedInputBytes,
    Buffer.from(" "),
  ]);
  assert.throws(
    () => buildV213MaterializationSeed(input.arguments),
    /V2_13_MATERIALIZATION_SEED_BUILDER_PROTECTED_INPUT_HASH/u,
  );
});

test("rejects a missing authenticated database identity instead of inventing one", () => {
  const input = harness({
    factsTransform(facts) {
      delete facts.database.host;
      return facts;
    },
  });
  assert.throws(
    () => buildV213MaterializationSeed(input.arguments),
    /V2_13_MATERIALIZATION_SEED_BUILDER_FACTS_CONTRACT/u,
  );
});

test("rejects every database identity tuple drift from the evidence-backed Neon owner", () => {
  for (const [field, value] of [
    ["host", "ep-other.c-3.ap-southeast-1.aws.neon.tech"],
    ["database", "otherdb"],
    ["owner_role", "other_owner"],
  ]) {
    const input = harness({
      factsTransform(facts) {
        facts.database[field] = value;
        return facts;
      },
    });
    assert.throws(
      () => buildV213MaterializationSeed(input.arguments),
      /V2_13_MATERIALIZATION_SEED_BUILDER_FACTS_CONTRACT/u,
    );
  }
});

test("rejects drift in exact committed evidence referenced by the facts record", () => {
  const input = harness({
    factsTransform(facts) {
      facts.source_evidence.source_readiness.sha256 = proof("f");
      return facts;
    },
  });
  assert.throws(
    () => buildV213MaterializationSeed(input.arguments),
    /V2_13_MATERIALIZATION_SEED_BUILDER_SOURCE_READINESS_HASH/u,
  );
});

test("rejects descriptor evidence or top-level drift from committed readiness", () => {
  const mutations = [
    (descriptor) => {
      descriptor.auditFacts.security_clear = false;
    },
    (descriptor) => {
      descriptor.auditFacts.security_clear.claims.pop();
    },
    (descriptor) => {
      descriptor.auditFacts.security_clear.metrics.p0Count = 1;
    },
    (descriptor) => {
      descriptor.auditFacts.security_clear.evidencePath =
        "project-context/evidence/acceptance/VF-10-13/other.json";
    },
    (descriptor) => {
      descriptor.auditFacts.security_clear.sourceEvidenceSha256 = proof("f");
    },
    (descriptor) => {
      descriptor.auditFacts.security_clear.observedAt = "2026-08-28T00:00:01.000Z";
    },
    (descriptor) => {
      descriptor.auditFacts.security_clear.observerId = "different.auditor";
    },
    (descriptor) => {
      descriptor.auditFacts.security_clear.fixtureOrFakeTransportUsed = true;
    },
    (descriptor) => {
      descriptor.auditFacts.backup_restore_ready.metrics.schemaMigrationDisposition =
        "V206_RESTORE_REUSED_NO_SCHEMA_CHANGE";
    },
    (descriptor) => {
      descriptor.productionUrlSha256 = proof("f");
    },
    (descriptor) => {
      descriptor.contractBundleSha256 = proof("f");
    },
  ];
  for (const mutate of mutations) {
    const input = harness({
      descriptorTransform(descriptor) {
        mutate(descriptor);
        return descriptor;
      },
    });
    assert.throws(
      () => buildV213MaterializationSeed(input.arguments),
      /V2_13_MATERIALIZATION_SEED_BUILDER_STATIC_DESCRIPTOR_(?:CONTRACT|FACTS)/u,
    );
  }
});

test("rejects fixture markers and drift in exact case materializer components", () => {
  const marker = harness({
    protectedTransform(protectedInput) {
      protectedInput.qualification.envelope_signing_key_id = "fixture-signing-key";
      return protectedInput;
    },
  });
  assert.throws(
    () => buildV213MaterializationSeed(marker.arguments),
    /V2_13_MATERIALIZATION_SEED_BUILDER_PROTECTED_INPUT_CONTRACT/u,
  );
  const hashDrift = harness({
    proposalTransform(proposal) {
      const drift = proof("f");
      proposal.source.exact_release_components.materialization_seed_mage_case_generator.sha256 =
        drift;
      proposal.source.pending_source_contract.release_component_sha256s.materialization_seed_mage_case_generator =
        drift;
    },
  });
  assert.throws(
    () => buildV213MaterializationSeed(hashDrift.arguments),
    /V2_13_MATERIALIZATION_SEED_BUILDER_MAGE_CASE_GENERATOR_SOURCE_HASH/u,
  );
  const caseDrift = harness({
    caseSourceTransform(bytes) {
      return Buffer.from(bytes)
        .toString("utf8")
        .replace('id: "soulx-timeout"', 'id: "soulx-timeout-drift"');
    },
  });
  assert.throws(
    () => buildV213MaterializationSeed(caseDrift.arguments),
    /V2_13_MATERIALIZATION_SEED_BUILDER_QUALIFICATION_CASE_SOURCE/u,
  );
});

test("rejects post-consumption dynamic facts and requires audited lineage", () => {
  const dynamic = harness({
    factsTransform(facts) {
      facts.billing_baseline = { observed_at: "2026-08-27T23:00:00.000Z" };
      return facts;
    },
  });
  assert.throws(
    () => buildV213MaterializationSeed(dynamic.arguments),
    /V2_13_MATERIALIZATION_SEED_BUILDER_FACTS_CONTRACT/u,
  );
  const missing = harness();
  delete missing.arguments.validateSourceEvidenceLineage;
  assert.throws(
    () => buildV213MaterializationSeed(missing.arguments),
    /V2_13_MATERIALIZATION_SEED_BUILDER_SOURCE_EVIDENCE_LINEAGE_READER/u,
  );
});

test("secure protected reads enforce modes, reject leaf and component symlinks, and fail missing", () => {
  withSecureDirectory(({ protectedDirectory, root }) => {
    const file = join(protectedDirectory, "input.json");
    writeFileSync(file, "exact", { mode: 0o600 });
    assert.equal(secureRead(file, "TEST_INPUT", { anchorRoot: root }).toString(), "exact");
    chmodSync(file, 0o644);
    assert.throws(() => secureRead(file, "TEST_INPUT", { anchorRoot: root }), /MODE_OR_TYPE/u);
    chmodSync(file, 0o600);
    const leafLink = join(protectedDirectory, "leaf-link.json");
    symlinkSync(file, leafLink);
    assert.throws(() => secureRead(leafLink, "TEST_INPUT", { anchorRoot: root }), /MODE_OR_TYPE/u);
    const realDirectory = join(root, "real");
    mkdirSync(realDirectory, { mode: 0o700 });
    const realFile = join(realDirectory, "value.json");
    writeFileSync(realFile, "exact", { mode: 0o600 });
    const directoryLink = join(root, "linked");
    symlinkSync(realDirectory, directoryLink);
    assert.throws(
      () => secureRead(join(directoryLink, "value.json"), "TEST_INPUT", { anchorRoot: root }),
      /MODE_OR_TYPE/u,
    );
    assert.throws(
      () =>
        secureRead(join(protectedDirectory, "missing.json"), "TEST_INPUT", { anchorRoot: root }),
      /_READ/u,
    );
  });
});

test("atomic output CAS creates once, replays exact bytes, and rejects divergent or symlink state", () => {
  withSecureDirectory(({ protectedDirectory, root }) => {
    const output = join(protectedDirectory, "seed.json");
    const bytes = Buffer.from("exact-seed\n");
    assert.equal(writeCanonicalSeed(output, bytes, { anchorRoot: root }), true);
    assert.equal(writeCanonicalSeed(output, bytes, { anchorRoot: root }), false);
    assert.throws(
      () => writeCanonicalSeed(output, Buffer.from("drift\n"), { anchorRoot: root }),
      /OUTPUT_(FOREIGN_STAGE|REPLAY_DRIFT)/u,
    );
    const other = join(protectedDirectory, "other.json");
    writeFileSync(other, bytes, { mode: 0o600 });
    const linkedOutput = join(protectedDirectory, "linked-output.json");
    symlinkSync(other, linkedOutput);
    assert.throws(
      () => writeCanonicalSeed(linkedOutput, bytes, { anchorRoot: root }),
      /MODE_OR_TYPE/u,
    );
  });
});

test("atomic output reconciles same-byte races and deterministic before/after-link crashes", () => {
  for (const crashStep of ["TEMP_FSYNCED", "AFTER_PUBLISH"]) {
    withSecureDirectory(({ protectedDirectory, root }) => {
      const output = join(protectedDirectory, "seed.json");
      const bytes = Buffer.from("crash-safe-seed\n");
      assert.throws(
        () =>
          writeCanonicalSeed(output, bytes, {
            anchorRoot: root,
            onStep(step) {
              if (step === crashStep) throw simulatedCrash();
            },
          }),
        /simulated hard crash/u,
      );
      const stage = readdirSync(protectedDirectory).find((name) => name.includes(".stage-"));
      assert.ok(stage);
      assert.equal(
        writeCanonicalSeed(output, bytes, { anchorRoot: root }),
        crashStep === "TEMP_FSYNCED",
      );
      assert.equal(
        readdirSync(protectedDirectory).some((name) => name.includes(".stage-")),
        false,
      );
      assert.equal(lstatSync(output).nlink, 1);
      assert.deepEqual(readFileSync(output), bytes);
    });
  }
  withSecureDirectory(({ protectedDirectory, root }) => {
    const output = join(protectedDirectory, "seed.json");
    const bytes = Buffer.from("raced-seed\n");
    const created = writeCanonicalSeed(output, bytes, {
      anchorRoot: root,
      onStep(step) {
        if (step === "BEFORE_PUBLISH") writeFileSync(output, bytes, { mode: 0o600, flag: "wx" });
      },
    });
    assert.equal(created, false);
    assert.deepEqual(readFileSync(output), bytes);
    assert.equal(
      readdirSync(protectedDirectory).some((name) => name.includes(".stage-")),
      false,
    );
  });
});

test("atomic output rejects foreign deterministic stages instead of guessing cleanup ownership", () => {
  withSecureDirectory(({ protectedDirectory, root }) => {
    const output = join(protectedDirectory, "seed.json");
    writeFileSync(join(protectedDirectory, ".seed.json.stage-deadbeef"), "foreign", {
      mode: 0o600,
    });
    assert.throws(
      () => writeCanonicalSeed(output, Buffer.from("exact\n"), { anchorRoot: root }),
      /OUTPUT_FOREIGN_STAGE/u,
    );
  });
});

test("production CLI replays a real release-tree approval and temp-git source lineage", () => {
  const fixture = buildTempGitEndToEndFixture();
  try {
    const first = writeV213MaterializationSeed({
      approvalFile: fixture.approvalFile,
      approvalSha256: fixture.approvalSha256,
      outputFile: fixture.outputFile,
      proposalRecordCommit: fixture.proposalRecordCommit,
      proposalSha256: fixture.proposalSha256,
      protectedInputFile: fixture.protectedInputFile,
      repositoryRoot: fixture.repositoryRoot,
      staticReleaseDescriptorFile: fixture.staticReleaseDescriptorFile,
    });
    assert.equal(first.created, true);
    assert.equal(first.sha256, sha256(first.bytes));
    assert.deepEqual(first.bytes, canonicalBytes(first.seed));
    assert.equal(first.seed.static_only, true);
    assert.equal(first.seed.future_output_hashes_present, false);
    assert.equal(first.seed.activation_record_base.database.operator_database_url_sha256, null);
    assert.deepEqual(first.seed.production_input_base.authorityDocument, {});
    assert.deepEqual(first.seed.production_input_base.commandPayloads, {});
    assert.equal(
      Object.hasOwn(first.seed.production_input_base.dualLaneInput, "billingBaselineUsd"),
      false,
    );

    const replay = execFileSync(
      process.execPath,
      [
        BUILDER_PATH,
        "--approval-file",
        fixture.approvalFile,
        "--approval-sha256",
        fixture.approvalSha256,
        "--output-file",
        fixture.outputFile,
        "--proposal-record-commit",
        fixture.proposalRecordCommit,
        "--proposal-sha256",
        fixture.proposalSha256,
        "--protected-input-file",
        fixture.protectedInputFile,
        "--repository-root",
        fixture.repositoryRoot,
        "--static-release-descriptor-file",
        fixture.staticReleaseDescriptorFile,
      ],
      { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    const replayResult = JSON.parse(replay);
    assert.equal(replayResult.created, false);
    assert.equal(replayResult.sha256, first.sha256);
    assert.deepEqual(readFileSync(fixture.outputFile), first.bytes);
  } finally {
    rmSync(fixture.repositoryRoot, { recursive: true, force: true });
  }
});

test("production CLI rejects a mutated approval through the release-tree validator", () => {
  const fixture = buildTempGitEndToEndFixture();
  try {
    const approval = JSON.parse(readFileSync(fixture.approvalFile));
    approval.approval.gpu.maximum_serverless_flex_rate_usd_per_gpu_hour += 0.000001;
    const mutatedBytes = Buffer.from(`${JSON.stringify(approval)}\n`);
    writeFileSync(fixture.approvalFile, mutatedBytes);
    assert.throws(
      () =>
        writeV213MaterializationSeed({
          approvalFile: fixture.approvalFile,
          approvalSha256: sha256(mutatedBytes),
          outputFile: fixture.outputFile,
          proposalRecordCommit: fixture.proposalRecordCommit,
          proposalSha256: fixture.proposalSha256,
          protectedInputFile: fixture.protectedInputFile,
          repositoryRoot: fixture.repositoryRoot,
          staticReleaseDescriptorFile: fixture.staticReleaseDescriptorFile,
        }),
      /CANONICAL_APPROVAL_VALIDATION/u,
    );
  } finally {
    rmSync(fixture.repositoryRoot, { recursive: true, force: true });
  }
});

test("production CLI rejects a proposal-record first-parent mutation outside the allowed lineage", () => {
  const fixture = buildTempGitEndToEndFixture();
  try {
    write(
      fixture.repositoryRoot,
      "deploy/unauthorized-release-change.mjs",
      "export const drift = true;\n",
    );
    const mutatedProposalRecordCommit = commitAll(
      fixture.repositoryRoot,
      "unauthorized release change",
    );
    assert.throws(
      () =>
        writeV213MaterializationSeed({
          approvalFile: fixture.approvalFile,
          approvalSha256: fixture.approvalSha256,
          outputFile: fixture.outputFile,
          proposalRecordCommit: mutatedProposalRecordCommit,
          proposalSha256: fixture.proposalSha256,
          protectedInputFile: fixture.protectedInputFile,
          repositoryRoot: fixture.repositoryRoot,
          staticReleaseDescriptorFile: fixture.staticReleaseDescriptorFile,
        }),
      /COMMIT_LINEAGE/u,
    );
  } finally {
    rmSync(fixture.repositoryRoot, { recursive: true, force: true });
  }
});

test("production CLI rejects protected ancestry and permissive protected modes", () => {
  const fixture = buildTempGitEndToEndFixture();
  try {
    const protectedDirectory = dirname(fixture.approvalFile);
    const linked = join(fixture.repositoryRoot, "protected-link");
    symlinkSync(protectedDirectory, linked);
    assert.throws(
      () =>
        writeV213MaterializationSeed({
          approvalFile: join(linked, "user-approval.json"),
          approvalSha256: fixture.approvalSha256,
          outputFile: fixture.outputFile,
          proposalRecordCommit: fixture.proposalRecordCommit,
          proposalSha256: fixture.proposalSha256,
          protectedInputFile: fixture.protectedInputFile,
          repositoryRoot: fixture.repositoryRoot,
          staticReleaseDescriptorFile: fixture.staticReleaseDescriptorFile,
        }),
      /APPROVAL_MODE_OR_TYPE/u,
    );
    chmodSync(fixture.staticReleaseDescriptorFile, 0o644);
    assert.throws(
      () =>
        writeV213MaterializationSeed({
          approvalFile: fixture.approvalFile,
          approvalSha256: fixture.approvalSha256,
          outputFile: fixture.outputFile,
          proposalRecordCommit: fixture.proposalRecordCommit,
          proposalSha256: fixture.proposalSha256,
          protectedInputFile: fixture.protectedInputFile,
          repositoryRoot: fixture.repositoryRoot,
          staticReleaseDescriptorFile: fixture.staticReleaseDescriptorFile,
        }),
      /STATIC_DESCRIPTOR_MODE_OR_TYPE/u,
    );
  } finally {
    rmSync(fixture.repositoryRoot, { recursive: true, force: true });
  }
});

test("source evidence accepts only a linear facts/readiness successor and rejects extra paths", () => {
  withSecureDirectory(({ root }) => {
    initializeRepository(root);
    const sourcePath = "deploy/source.mjs";
    write(root, sourcePath, "export const exact = true;\n");
    const auditedCodeCommit = commitAll(root, "audited source");
    const factsPath = FACTS_PATH;
    const sourceReadinessPath = READINESS_PATH;
    write(root, factsPath, "{}\n");
    write(root, sourceReadinessPath, "{}\n");
    const releaseSourceCommit = commitAll(root, "evidence successor");
    const closure = {
      entries: [{ path: sourcePath, sha256: sha256(Buffer.from("export const exact = true;\n")) }],
    };
    assert.doesNotThrow(() =>
      assertSourceEvidenceLineage(root, {
        auditedCodeCommit,
        closure,
        factsPath,
        releaseSourceCommit,
        sourceReadinessPath,
      }),
    );
    write(root, "deploy/unaudited-change.mjs", "export const drift = true;\n");
    const extraPathRelease = commitAll(root, "extra path");
    assert.throws(
      () =>
        assertSourceEvidenceLineage(root, {
          auditedCodeCommit,
          closure,
          factsPath,
          releaseSourceCommit: extraPathRelease,
          sourceReadinessPath,
        }),
      /SOURCE_EVIDENCE_LINEAGE/u,
    );
  });
});

test("source evidence rejects rename and merge histories", () => {
  withSecureDirectory(({ root }) => {
    initializeRepository(root);
    write(root, "deploy/source.mjs", "export const exact = true;\n");
    write(root, READINESS_PATH, "before\n");
    const auditedCodeCommit = commitAll(root, "audited source");
    git(root, "mv", READINESS_PATH, FACTS_PATH);
    const renamedRelease = commitAll(root, "rename evidence");
    assert.throws(
      () =>
        assertSourceEvidenceLineage(root, {
          auditedCodeCommit,
          closure: {
            entries: [
              {
                path: "deploy/source.mjs",
                sha256: sha256(Buffer.from("export const exact = true;\n")),
              },
            ],
          },
          factsPath: FACTS_PATH,
          releaseSourceCommit: renamedRelease,
          sourceReadinessPath: READINESS_PATH,
        }),
      /SOURCE_EVIDENCE_LINEAGE/u,
    );
  });
  withSecureDirectory(({ root }) => {
    initializeRepository(root);
    write(root, "deploy/source.mjs", "export const exact = true;\n");
    const auditedCodeCommit = commitAll(root, "audited source");
    const baseBranch = git(root, "branch", "--show-current");
    git(root, "checkout", "-b", "readiness");
    write(root, READINESS_PATH, "{}\n");
    commitAll(root, "readiness");
    git(root, "checkout", baseBranch);
    write(root, FACTS_PATH, "{}\n");
    commitAll(root, "facts");
    git(root, "merge", "--no-ff", "readiness", "-m", "merge evidence");
    const mergeRelease = git(root, "rev-parse", "HEAD");
    assert.throws(
      () =>
        assertSourceEvidenceLineage(root, {
          auditedCodeCommit,
          closure: {
            entries: [
              {
                path: "deploy/source.mjs",
                sha256: sha256(Buffer.from("export const exact = true;\n")),
              },
            ],
          },
          factsPath: FACTS_PATH,
          releaseSourceCommit: mergeRelease,
          sourceReadinessPath: READINESS_PATH,
        }),
      /SOURCE_EVIDENCE_LINEAGE/u,
    );
  });
});

test("production builder has no fixture, environment, credential-reader, or provider-call seam", () => {
  const source = readFileSync(
    new URL("../../deploy/v2-13/build-materialization-seed.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /scripts\/tests\/fixtures|materializationSeedFixture/u);
  assert.doesNotMatch(source, /process\.env|fetch\s*\(|https\.request|cloudflareOAuthApiResponse/u);
  assert.doesNotMatch(source, /DATABASE_URL|RUNPOD_API_KEY|R2_SECRET_ACCESS_KEY/u);
  assert.match(source, /execFileSync\("git", \["show"/u);
});

test("production builder uses the generated real-live closure order and rejects mutations", () => {
  const closure = JSON.parse(readFileSync(new URL(CLOSURE_PATH, ROOT)));
  const entries = closure.entries;
  assert.ok(entries.length > 600);
  assert.deepEqual(
    entries.map((entry) => entry.path),
    entries.map((entry) => entry.path).sort(),
  );
  assert.doesNotThrow(() => assertSourceClosureOrder(entries));

  const reversed = [...entries].reverse();
  assert.throws(() => assertSourceClosureOrder(reversed), /SOURCE_CLOSURE_CONTRACT/u);

  const duplicated = [...entries, entries.at(-1)];
  assert.throws(() => assertSourceClosureOrder(duplicated), /SOURCE_CLOSURE_CONTRACT/u);
});

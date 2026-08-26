import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  EXACT_APPROVAL_VALIDATOR_SOURCE_BINDING,
  EXACT_CLOUDFLARE_SECRET_NAMES,
  EXACT_IMAGE_WORKFLOW_VERIFICATION_POLICY,
  EXACT_INTERNAL_MATERIALIZATION_POLICY,
  EXACT_DURABLE_BILLING_POLICY,
  EXACT_EARLY_NO_DATABASE_CLEANUP_POLICY,
  EXACT_CRASH_SAFE_CLEANUP_POLICY,
  EXACT_OPERATION_IDS,
  EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY,
  EXACT_PREQUALIFICATION_BRIDGE_POLICY,
  EXACT_TRUSTED_TIME_POLICY,
  EXACT_V3_RELEASE_COMPONENTS,
  EXACT_WORKFLOW_START_AUTHORITY_POLICY,
} from "../../../../../deploy/v2-13/validate-full-live-approval.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const readJson = async (name) => JSON.parse(await readFile(path.join(directory, name), "utf8"));
const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const assert = (condition, code) => {
  if (!condition) throw new Error(code);
};

const proposalBytes = await readFile(path.join(directory, "combined-live-proposal.json"));
const proposal = JSON.parse(proposalBytes);
const approvalBytes = await readFile(path.join(directory, "user-approval.json"));
const approval = JSON.parse(approvalBytes);
const authority = await readJson("approved-authority.json");
const operatorGrantsSql = await readFile(
  path.resolve(directory, "../../../../../deploy/v2-13/neon-full-live-operator-grants.sql"),
  "utf8",
);
const migration0045Sql = await readFile(
  path.resolve(
    directory,
    "../../../../../packages/control-plane/migrations/0045_hosted_full_live_activation.sql",
  ),
  "utf8",
);
const migrationManifest = await readFile(
  path.resolve(directory, "../../../../../packages/control-plane/migrations/manifest.json"),
);
const RELEASE_SOURCE_COMMIT = "7444ed08ed16b618637b8aa29a93be7c89d1642a";
const PROPOSAL_RECORD_PATH =
  "project-context/evidence/acceptance/VF-10-13/2026-08-26-full-activation-ref-role-repair-candidate/combined-live-proposal.json";
const SUPERSEDED_PROPOSAL_SHA256 =
  "sha256:2e6a605d3b1fd973a438207006d938bdedcc6456135f09cefaecc013295d2958";
const SUPERSEDED_PROPOSAL_RECORD_COMMIT = "9eaf276ebeda4d1fa63032d4c908a21415415678";
const SUPERSEDED_RELEASE_SOURCE_COMMIT = "a4bc4fd53fb04d9b61c7e2bac1bf8f7058000dc1";
const SUPERSEDED_AUTHORITY_ID = "v2-13-full-live-20260826-173620z-a4bc4fd";
const SUPERSEDED_APPROVAL_SHA256 =
  "sha256:23b911037f79bf3628429822824406bbfc66930d138b022acf8aa9fc7f6c649f";

assert(proposal.source.proposal_path === PROPOSAL_RECORD_PATH, "PROPOSAL_PATH");
assert(approval.proposal?.path === PROPOSAL_RECORD_PATH, "APPROVAL_PROPOSAL_PATH");
assert(authority.lineage?.proposal_path === PROPOSAL_RECORD_PATH, "AUTHORITY_PROPOSAL_PATH");
assert(
  approval.authority_id === SUPERSEDED_AUTHORITY_ID &&
    approval.proposal?.sha256 === SUPERSEDED_PROPOSAL_SHA256 &&
    approval.proposal?.proposal_record_commit === SUPERSEDED_PROPOSAL_RECORD_COMMIT &&
    approval.proposal?.release_source_commit === SUPERSEDED_RELEASE_SOURCE_COMMIT &&
    sha256(approvalBytes) === SUPERSEDED_APPROVAL_SHA256 &&
    authority.authority_id === SUPERSEDED_AUTHORITY_ID &&
    authority.lineage?.proposal_sha256 === SUPERSEDED_PROPOSAL_SHA256 &&
    authority.lineage?.proposal_record_commit === SUPERSEDED_PROPOSAL_RECORD_COMMIT &&
    authority.lineage?.release_source_commit === SUPERSEDED_RELEASE_SOURCE_COMMIT &&
    authority.lineage?.user_approval_sha256 === SUPERSEDED_APPROVAL_SHA256 &&
    authority.lineage?.authority_record_path ===
      "project-context/evidence/acceptance/VF-10-13/2026-08-26-full-activation-ref-role-repair-candidate/approved-authority.json",
  "SUPERSEDED_APPROVAL_AUTHORITY_LINEAGE",
);

assert(proposal.schema_version === "videoforge.v2-13-full-live-completion-proposal/v3", "SCHEMA");
assert(proposal.proposal_status === "PENDING_FRESH_EXACT_USER_APPROVAL", "STATUS");
assert(proposal.sealing.sealed_for_exact_user_approval === true, "SEALED");
assert(proposal.sealing.current_bytes_are_approval_ineligible === false, "APPROVAL_ELIGIBLE");
assert(proposal.source.release_source_commit === RELEASE_SOURCE_COMMIT, "RELEASE_SOURCE_COMMIT");
assert(
  proposal.source.repaired_release_source_commit === RELEASE_SOURCE_COMMIT,
  "REPAIRED_SOURCE_COMMIT",
);
assert(proposal.source.future_authority_record_commit === null, "AUTHORITY_COMMIT_MUST_BE_UNSET");
assert(
  JSON.stringify(proposal.source.exact_release_components.approval_validator) ===
    JSON.stringify({
      path: "deploy/v2-13/validate-full-live-approval.mjs",
      source_commit_tree_binding: EXACT_APPROVAL_VALIDATOR_SOURCE_BINDING,
    }) &&
    !Object.hasOwn(proposal.source.exact_release_components.approval_validator, "sha256"),
  "VALIDATOR_EXTERNAL_TREE_BINDING",
);
assert(
  JSON.stringify(proposal.source.exact_release_components) ===
    JSON.stringify(EXACT_V3_RELEASE_COMPONENTS),
  "EXACT_RELEASE_COMPONENTS",
);
assert(
  sha256(operatorGrantsSql) === EXACT_V3_RELEASE_COMPONENTS.operator_grants.sha256,
  "OPERATOR_GRANTS_SOURCE_HASH",
);
assert(
  sha256(migrationManifest) === EXACT_V3_RELEASE_COMPONENTS.migration_manifest.sha256,
  "MIGRATION_MANIFEST_SOURCE_HASH",
);
assert(
  JSON.stringify(proposal.exact_execution_graph.ordered_operation_ids) ===
    JSON.stringify(EXACT_OPERATION_IDS) &&
    proposal.exact_execution_graph.ordered_operation_ids.length === 25,
  "EXACT_25_OPERATION_GRAPH",
);
assert(
  proposal.authority_record_commit_binding.strategy ===
    "EXTERNAL_GIT_COMMIT_INPUT_VERIFIED_BEFORE_CONSUMPTION_NO_SELF_HASH" &&
    proposal.authority_record_commit_binding.proposal_record_commit_is_distinct === true &&
    proposal.authority_record_commit_binding
      .authority_record_commit_must_contain_exact_approval_and_authority_bytes === true &&
    proposal.authority_record_commit_binding.remote_readback_required === true &&
    proposal.authority_record_commit_binding.embedded_self_commit_hash_forbidden === true,
  "AUTHORITY_COMMIT_BINDING",
);
assert(
  proposal.requested_scope.cloudflare_secret_allowlist_count ===
    EXACT_CLOUDFLARE_SECRET_NAMES.length &&
    JSON.stringify(proposal.requested_scope.cloudflare_secret_allowlist) ===
      JSON.stringify(EXACT_CLOUDFLARE_SECRET_NAMES),
  "EXACT_22_SECRET_ALLOWLIST",
);
assert(
  JSON.stringify(proposal.exact_execution_graph.image_workflow_verification_policy) ===
    JSON.stringify(EXACT_IMAGE_WORKFLOW_VERIFICATION_POLICY),
  "EXACT_WORKFLOW_TERMINAL_POLLING",
);
assert(
  JSON.stringify(proposal.exact_execution_graph.internal_materialization_policy) ===
    JSON.stringify(EXACT_INTERNAL_MATERIALIZATION_POLICY),
  "EXACT_INTERNAL_MATERIALIZATION_POLICY",
);
assert(
  JSON.stringify(proposal.exact_execution_graph.trusted_time_policy) ===
    JSON.stringify(EXACT_TRUSTED_TIME_POLICY),
  "EXACT_TRUSTED_TIME_POLICY",
);
assert(
  JSON.stringify(proposal.exact_execution_graph.prequalification_database_bootstrap_policy) ===
    JSON.stringify(EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY),
  "EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY",
);
assert(
  JSON.stringify(proposal.exact_execution_graph.workflow_start_authority_policy) ===
    JSON.stringify(EXACT_WORKFLOW_START_AUTHORITY_POLICY),
  "EXACT_WORKFLOW_START_AUTHORITY_POLICY",
);
assert(
  JSON.stringify(proposal.exact_execution_graph.early_no_database_cleanup_policy) ===
    JSON.stringify(EXACT_EARLY_NO_DATABASE_CLEANUP_POLICY),
  "EXACT_EARLY_NO_DATABASE_CLEANUP_POLICY",
);
assert(
  JSON.stringify(proposal.exact_execution_graph.durable_billing_policy) ===
    JSON.stringify(EXACT_DURABLE_BILLING_POLICY),
  "EXACT_DURABLE_BILLING_POLICY",
);
assert(
  JSON.stringify(proposal.exact_execution_graph.crash_safe_cleanup_policy) ===
    JSON.stringify(EXACT_CRASH_SAFE_CLEANUP_POLICY),
  "EXACT_CRASH_SAFE_CLEANUP_POLICY",
);
assert(
  JSON.stringify(proposal.exact_execution_graph.prequalification_bridge_policy) ===
    JSON.stringify(EXACT_PREQUALIFICATION_BRIDGE_POLICY),
  "EXACT_PREQUALIFICATION_BRIDGE_POLICY",
);
assert(
  operatorGrantsSql.includes('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM :"operator_role";'),
  "OPERATOR_GRANTS_REVOKE_ALL_FUNCTIONS",
);
const grantStart = operatorGrantsSql.indexOf("GRANT EXECUTE ON FUNCTION");
const grantEnd = operatorGrantsSql.indexOf("\nWITH target AS", grantStart);
assert(grantStart >= 0 && grantEnd > grantStart, "OPERATOR_GRANTS_ALLOWLIST_BLOCK");
const canonicalizeSignature = (signature) =>
  signature.replace(/\s+/gu, "").replaceAll("timestampwithtimezone", "timestamptz");
const grantedSignatures = [
  ...operatorGrantsSql
    .slice(grantStart, grantEnd)
    .matchAll(/public\.(videoforge_[a-z0-9_]+\([^)]*\))/gu),
].map(([match]) => canonicalizeSignature(match.slice("public.".length)));
const expectedSignatures = EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.exact_operator_function_signatures
  .map(canonicalizeSignature)
  .sort();
assert(grantedSignatures.length === 17, "OPERATOR_GRANTS_SIGNATURE_COUNT");
assert(new Set(grantedSignatures).size === grantedSignatures.length, "OPERATOR_GRANTS_DUPLICATE_SIGNATURE");
assert(
  JSON.stringify([...grantedSignatures].sort()) === JSON.stringify(expectedSignatures),
  "OPERATOR_GRANTS_EXACT_SIGNATURE_ALLOWLIST",
);
assert(
  operatorGrantsSql.includes("REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;") &&
    operatorGrantsSql.includes(
      "ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;",
    ) &&
    !/GRANT\s+EXECUTE\s+ON\s+FUNCTION[\s\S]*?\bTO\s+PUBLIC\b/iu.test(
      operatorGrantsSql.slice(grantStart, grantEnd),
    ),
  "OPERATOR_GRANTS_PUBLIC_ZERO",
);
for (const signature of EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY.exact_operator_function_signatures)
  assert(
    migration0045Sql.includes(`REVOKE ALL ON FUNCTION public.${signature} FROM PUBLIC;`),
    `PUBLIC_EXECUTE_REVOKE:${signature}`,
  );
assert(
  JSON.stringify(proposal.exact_execution_graph.ordered_operation_ids.slice(7, 10)) ===
    JSON.stringify([
      "soulx-image-workflow-verification",
      "bootstrap-prequalification-database",
      "fresh-live-preflight",
    ]),
  "PREQUALIFICATION_DATABASE_BOOTSTRAP_ORDER",
);
assert(
  JSON.stringify(proposal.exact_execution_graph.ordered_operation_ids.slice(13, 18)) ===
    JSON.stringify([
      "guarded-activation-once",
      "promote-qualified-production",
      "record-workflow-start-authority",
      "v2-09-short-hosted-project",
      "v2-10-operator-free-ranga-pilot",
    ]),
  "WORKFLOW_START_AUTHORITY_ORDER",
);
assert(
  JSON.stringify(proposal.requested_scope.database) ===
    JSON.stringify({
      exact_operator_role: "videoforge_hosted_operator",
      exact_runtime_role: "videoforge_hosted_runtime",
      exact_reconciler_role: "videoforge_hosted_reconciler",
      roles_must_be_fresh_absent_distinct_login_noinherit_hardened: true,
      pgcrypto_required: true,
      prequalification_database_bootstrap_operator_function_signature_count: 17,
      prequalification_database_bootstrap_operator_function_signature_namespace: "public",
      prequalification_database_bootstrap_operator_function_signature_canonicalization:
        "FUNCTION_NAME_PLUS_FORMAT_TYPE_IDENTITY_ARGUMENTS_WITH_TIMESTAMPTZ_NORMALIZATION",
      prequalification_database_bootstrap_operator_acl_comparison:
        "OID_SET_SORTED_EXACT_ALLOWLIST",
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
      prequalification_database_bootstrap_operator_dsn_value_read_after_migration_prefix_commit_count:
        45,
      prequalification_database_bootstrap_operator_dsn_value_read_forbidden_before_migration_prefix_commit:
        true,
      prequalification_database_bootstrap_phase: "bootstrap_prequalification_database",
      prequalification_database_bootstrap_phase_cap_usd: 0,
      prequalification_database_bootstrap_receipt_path: "prequalification-database-bootstrap.json",
      prequalification_database_bootstrap_receipt_hash_field: "prequalification_database_bootstrap_sha256",
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
        "videoforge_record_v213_workflow_start_authority(uuid,uuid,text,timestamptz)"
      ],
      exact_initial_ledger_prefix_count: 36,
      exact_recoverable_prefix_counts: [37, 38, 39, 40, 41, 42, 43, 44, 45],
      exact_migrations_to_apply: [37, 38, 39, 40, 41, 42, 43, 44, 45],
    }),
  "PREQUALIFICATION_DATABASE_SCOPE",
);
assert(
  proposal.ordered_operations
    .flatMap((phase) => phase.operations)
    .some((operation) => operation.includes("provision 22 exact allowlisted secrets")),
  "EXACT_22_SECRET_OPERATION",
);
assert(
  proposal.ordered_operations.flatMap((phase) => phase.operations).some((operation) =>
    operation.includes("videoforge.v213-full-live-early-cleanup-input/v1") &&
    operation.includes("REQUEST_FD and RUNPOD_API_KEY_FD") &&
    operation.includes("never claim database cleanup"),
  ),
  "EARLY_NO_DATABASE_CLEANUP_OPERATION",
);
assert(
  proposal.ordered_operations.flatMap((phase) => phase.operations).some((operation) =>
    operation.includes("record-workflow-start-authority exactly once") &&
    operation.includes("phase cap USD 0"),
  ),
  "WORKFLOW_START_AUTHORITY_OPERATION",
);
assert(
  proposal.ordered_operations[3].operations.some((operation) =>
    operation.includes("authority-record commit"),
  ),
  "AUTHORITY_RECORD_COMMIT_OPERATION",
);
assert(
  Object.entries(proposal.authority).every(([key, value]) =>
    key === "single_use" ? value === true : value === false || value === null,
  ),
  "PROPOSAL_AUTHORITY_MUST_BE_ABSENT",
);
assert(
  proposal.supersession.supersedes_proposal_sha256 === SUPERSEDED_PROPOSAL_SHA256 &&
    proposal.supersession.supersedes_proposal_record_commit ===
      SUPERSEDED_PROPOSAL_RECORD_COMMIT &&
    proposal.supersession.superseded_authority_id === SUPERSEDED_AUTHORITY_ID &&
    proposal.supersession.superseded_authority_state === "SUPERSEDED_UNCONSUMED_NO_MUTATION" &&
    proposal.supersession.superseded_approval_sha256 === SUPERSEDED_APPROVAL_SHA256 &&
    proposal.supersession.superseded_approval_record_commit === SUPERSEDED_PROPOSAL_RECORD_COMMIT &&
    proposal.supersession.superseded_authority_record_path ===
      "project-context/evidence/acceptance/VF-10-13/2026-08-26-full-activation-ref-role-repair-candidate/approved-authority.json" &&
    proposal.supersession.supersession_reason === "SOURCE_LINEAGE_REPAIR_REQUIRED" &&
    proposal.supersession.prior_approval_reusable === false &&
    proposal.supersession.fresh_exact_approval_required === true,
  "HISTORICAL_SUPERSESSION_LINEAGE",
);
assert(
  authority.status === "SUPERSEDED_UNCONSUMED_NO_MUTATION" &&
    authority.consumed === false &&
    authority.consumed_at === null &&
    authority.authority_record_commit === null,
  "AUTHORITY_UNCONSUMED",
);
assert(
  JSON.stringify(authority.combined_execution_authority) ===
    JSON.stringify({
      execute_authorized: false,
      credential_access_authorized: false,
      database_mutation_authorized: false,
      cloudflare_secret_mutation_authorized: false,
      deployment_authorized: false,
      provider_calls_authorized: false,
      provider_mutations_authorized: false,
      gpu_use_authorized: false,
      external_runpod_spend_authorized: false,
      maximum_cumulative_finite_runpod_spend_usd: null,
      redispatch_authorized: false,
      new_volume_authorized: false,
      new_paid_retained_resource_authorized: false,
      recurring_plan_change_authorized: false,
    }),
  "EXECUTABLE_AUTHORITY_EXACT_SCOPE",
);
assert(
  authority.provider_free_recording.credentials_accessed === false &&
    authority.provider_free_recording.external_calls === 0 &&
    authority.provider_free_recording.provider_mutations === 0 &&
    authority.provider_free_recording.gpu_use === 0 &&
    authority.provider_free_recording.runpod_spend_usd === 0 &&
    authority.provider_free_recording.guarded_child_authority_created === false &&
    authority.provider_free_recording.authority_consumed === false &&
    authority.provider_free_recording.superseded_before_external_action === true &&
    authority.provider_free_recording.supersession_reason === "SOURCE_LINEAGE_REPAIR_REQUIRED",
  "NO_EXTERNAL_ACTION",
);

console.log(
  JSON.stringify({
    status: "PASS_SEALED_AWAITING_FRESH_EXACT_APPROVAL",
    proposal_sha256: sha256(proposalBytes),
    release_source_commit: RELEASE_SOURCE_COMMIT,
    cloudflare_secret_count: EXACT_CLOUDFLARE_SECRET_NAMES.length,
    authority_id: authority.authority_id,
    superseded_authority_id: SUPERSEDED_AUTHORITY_ID,
    authority: "SUPERSEDED_UNCONSUMED_NO_MUTATION",
    external_calls: 0,
    mutations: 0,
    gpu_use: 0,
    spend_usd: 0,
  }),
);

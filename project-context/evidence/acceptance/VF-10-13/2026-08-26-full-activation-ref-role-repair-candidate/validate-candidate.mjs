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
const approval = await readJson("user-approval.json");
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
const RELEASE_SOURCE_COMMIT = "a4bc4fd53fb04d9b61c7e2bac1bf8f7058000dc1";

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
  approval.proposal.sha256 ===
    "sha256:9425de8ed5905088f6d6e95d77ffbc6dbf0a4e800ef5f01734676bd76938899a",
  "HISTORICAL_APPROVAL_LINEAGE",
);
assert(authority.consumed === false && authority.consumed_at === null, "AUTHORITY_UNCONSUMED");
assert(
  authority.status === "SUPERSEDED_UNCONSUMED_NO_MUTATION_SOURCE_AND_SCOPE_REPAIR_REQUIRED",
  "AUTHORITY_SUPERSEDED",
);
assert(
  Object.entries(authority.combined_execution_authority).every(([key, value]) =>
    key === "redispatch_authorized" || key.endsWith("_authorized")
      ? value === false
      : key === "maximum_cumulative_finite_runpod_spend_usd"
        ? value === null
        : true,
  ),
  "EXECUTABLE_AUTHORITY_MUST_BE_ZERO",
);
assert(authority.provider_free_recording.superseded_before_external_action === true, "NO_EXTERNAL_ACTION");

console.log(
  JSON.stringify({
    status: "PASS_SEALED_AWAITING_FRESH_EXACT_APPROVAL",
    proposal_sha256: sha256(proposalBytes),
    release_source_commit: RELEASE_SOURCE_COMMIT,
    cloudflare_secret_count: EXACT_CLOUDFLARE_SECRET_NAMES.length,
    authority: "SUPERSEDED_UNCONSUMED_NO_MUTATION",
    external_calls: 0,
    mutations: 0,
    gpu_use: 0,
    spend_usd: 0,
  }),
);

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  EXACT_CLOUDFLARE_SECRET_NAMES,
  EXACT_IMAGE_WORKFLOW_VERIFICATION_POLICY,
  EXACT_INTERNAL_MATERIALIZATION_POLICY,
  EXACT_PREQUALIFICATION_DATABASE_BOOTSTRAP_POLICY,
  EXACT_PREQUALIFICATION_BRIDGE_POLICY,
  EXACT_TRUSTED_TIME_POLICY,
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

assert(proposal.schema_version === "videoforge.v2-13-full-live-completion-proposal/v3", "SCHEMA");
assert(proposal.proposal_status === "BLOCKED_UNSEALED_SOURCE_REPAIR_PENDING", "STATUS");
assert(proposal.sealing.sealed_for_exact_user_approval === false, "NOT_SEALED");
assert(proposal.sealing.current_bytes_are_approval_ineligible === true, "APPROVAL_INELIGIBLE");
assert(proposal.source.repaired_release_source_commit === null, "REPAIRED_SOURCE_MUST_BE_UNSET");
assert(proposal.source.future_authority_record_commit === null, "AUTHORITY_COMMIT_MUST_BE_UNSET");
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
  JSON.stringify(proposal.exact_execution_graph.prequalification_bridge_policy) ===
    JSON.stringify(EXACT_PREQUALIFICATION_BRIDGE_POLICY),
  "EXACT_PREQUALIFICATION_BRIDGE_POLICY",
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
  JSON.stringify(proposal.requested_scope.database) ===
    JSON.stringify({
      exact_operator_role: "videoforge_hosted_operator",
      exact_runtime_role: "videoforge_hosted_runtime",
      exact_reconciler_role: "videoforge_hosted_reconciler",
      roles_must_be_fresh_absent_distinct_login_noinherit_hardened: true,
      pgcrypto_required: true,
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
    status: "PASS_BLOCKED_UNSEALED",
    draft_sha256: sha256(proposalBytes),
    repaired_release_source_commit: null,
    cloudflare_secret_count: EXACT_CLOUDFLARE_SECRET_NAMES.length,
    authority: "SUPERSEDED_UNCONSUMED_NO_MUTATION",
    external_calls: 0,
    mutations: 0,
    gpu_use: 0,
    spend_usd: 0,
  }),
);

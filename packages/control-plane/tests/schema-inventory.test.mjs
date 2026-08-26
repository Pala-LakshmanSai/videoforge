import assert from "node:assert/strict";
import test from "node:test";

import {
  MIGRATION_TABLE_NAME,
  NON_PORTABLE_TABLE_NAMES,
  RELATIONAL_TABLE_NAMES,
  SCHEMA_REGISTRY_TABLE_NAMES,
  TENANT_VIEW_NAMES,
} from "../dist/src/index.js";
import { withMigratedDatabase } from "./support/pglite.mjs";

const REQUIRED_CUSTOM_INDEXES = [
  "assets_binary_sha256_idx",
  "assets_canonical_document_sha256_idx",
  "assets_object_key_uq",
  "global_queue_audits_actor_idx",
  "generation_sessions_one_open_uq",
  "global_queue_entries_live_position_uq",
  "global_queue_entries_one_active_uq",
  "attempts_external_job_uq",
  "attempts_one_accepted_result_uq",
  "avatar_generation_acceptances_span_idx",
  "avatar_profile_versions_open_draft_uq",
  "avatar_profile_versions_ready_hash_uq",
  "avatar_profiles_active_name_uq",
  "callback_receipts_attempt_idx",
  "cost_events_attempt_idx",
  "generation_requests_fair_head_idx",
  "generation_requests_one_active_video_per_account_uq",
  "generation_tasks_ready_idx",
  "hosted_auth_sessions_user_idx",
  "hosted_cpu_job_execution_uq",
  "hosted_cpu_job_reconcile_idx",
  "hosted_cpu_job_submission_idempotency_uq",
  "image_generation_acceptances_prompt_idx",
  "image_style_versions_open_draft_uq",
  "image_style_versions_published_hash_uq",
  "image_styles_active_name_uq",
  "memberships_active_name_uq",
  "memberships_user_idx",
  "outbox_delivery_idx",
  "project_inputs_one_current_kind_uq",
  "project_revisions_one_draft_uq",
  "prompt_scene_results_execution_idx",
  "prompt_writer_attempts_execution_idx",
  "pod_lifecycle_attempts_one_unresolved_lane_uq",
  "preset_preview_requests_fair_head_idx",
  "provider_workload_leases_one_active_account_uq",
  "provider_workload_leases_one_active_slot_uq",
  "projects_active_name_uq",
  "qa_results_one_terminal_acceptance_uq",
  "repository_mutation_receipts_operation_idx",
  "serverless_attempts_one_live_lane_uq",
  "serverless_attempts_reconciliation_idx",
  "serverless_cost_events_attempt_idx",
  "serverless_dispatch_outbox_ready_idx",
  "serverless_endpoint_deployments_active_lane_uq",
  "serverless_output_receipts_one_canonical_uq",
  "serverless_provider_assignments_one_current_uq",
  "timeline_segments_frame_idx",
  "timeline_segments_legacy_revision_index_uq",
  "timeline_segments_plan_frame_idx",
  "timeline_segments_plan_index_uq",
  "timeline_segments_plan_key_uq",
  "transcripts_idempotency_uq",
  "transcripts_input_fingerprint_uq",
  "transcripts_one_ready_per_revision_uq",
  "users_active_email_uq",
  "workflow_events_attempt_sequence_uq",
  "workflow_instances_external_id_uq",
  "workspaces_account_active_name_uq",
].sort();

const REQUIRED_TRIGGERS = [
  "app_admissions_append_only",
  "auth_identity_bindings_append_only",
  "attempts_accepted_result_consistent",
  "attempts_execution_profile_immutable",
  "avatar_generation_acceptances_append_only",
  "avatar_compatibility_assessments_execution_profile_immutable",
  "avatar_compatibility_assessments_terminal_immutable",
  "avatar_profile_versions_ready_immutable",
  "avatar_profile_test_attempts_execution_profile_matches",
  "avatar_profiles_active_version_ready",
  "avatar_renderer_bindings_append_only",
  "callback_receipts_append_only",
  "cost_events_append_only",
  "cost_events_monotonic_sequence",
  "compute_run_plans_active_only",
  "durable_generation_outputs_append_only",
  "durable_generation_outputs_validate_ownership",
  "execution_profiles_tested_immutable",
  "generation_tasks_accepted_result_consistent",
  "generation_queue_audits_append_only",
  "generation_sessions_transition_guard",
  "global_queue_entries_active_guard",
  "global_queue_entries_validate",
  "global_queue_audits_append_only",
  "global_session_cost_events_append_only",
  "global_session_events_append_only",
  "hosted_project_create_requests_tenant_account_derived",
  "hosted_project_create_requests_tenant_write_guard",
  "hosted_project_create_requests_validate_ready",
  "hosted_render_plans_append_only",
  "hosted_render_plans_tenant_account_derived",
  "hosted_render_plans_tenant_write_guard",
  "hosted_render_plans_validate_lineage",
  "hosted_project_reviews_append_only",
  "hosted_project_reviews_tenant_account_derived",
  "hosted_project_reviews_tenant_write_guard",
  "hosted_project_reviews_validate_output",
  "gpu_inventory_receipts_append_only",
  "invite_codes_transition_guard",
  "invite_redemptions_append_only",
  "image_generation_acceptances_append_only",
  "image_style_profile_artifacts_append_only",
  "image_style_profile_edits_append_only",
  "image_style_versions_profile_pointer_guard",
  "image_style_versions_published_immutable",
  "image_styles_active_version_published",
  "lane_demands_validate",
  "model_volume_manifests_append_only",
  "model_volumes_retained",
  "pod_lifecycle_attempts_validate",
  "pod_dispatch_authorizations_append_only",
  "pod_dispatch_authorizations_validate",
  "provider_workload_leases_validate",
  "project_revisions_locked_immutable",
  "project_revisions_validate_locked_snapshot",
  "prompt_executions_append_only",
  "prompt_scene_results_append_only",
  "prompt_writer_attempts_append_only",
  "repository_mutation_receipts_append_only",
  "revision_timing_heads_validate",
  "serverless_cost_events_append_only",
  "serverless_cost_events_monotonic_sequence",
  "serverless_dispatch_outbox_validate",
  "serverless_endpoint_deployments_retire_only",
  "serverless_output_receipts_append_only",
  "serverless_output_receipts_acceptance_fence",
  "serverless_predispatch_authorities_append_only",
  "serverless_progress_events_append_only",
  "serverless_provenance_receipts_append_only",
  "serverless_provider_assignments_validate",
  "serverless_reconciliations_append_only",
  "session_gpu_bindings_immutable",
  "session_gpu_bindings_validate",
  "session_gpu_revalidations_append_only",
  "session_gpu_revalidations_validate",
  "timeline_plans_immutable",
  "timeline_plans_validate_complete_lineage",
  "timeline_segments_durable_immutable",
  "timing_invalidations_immutable",
  "transcript_phrases_immutable",
  "transcript_sentences_immutable",
  "transcript_words_immutable",
  "transcripts_enforce_durable_completeness",
  "transcripts_validate_durable_lineage",
  "workflow_events_append_only",
  "workflow_events_monotonic_sequence",
].sort();

const REQUIRED_FOREIGN_KEY_FRAGMENTS = [
  "FOREIGN KEY (workspace_id, project_id, project_revision_id) REFERENCES project_revisions",
  "FOREIGN KEY (account_id, workspace_id, project_id) REFERENCES projects",
  "FOREIGN KEY (account_id, workspace_id, project_revision_id) REFERENCES project_revisions",
  "FOREIGN KEY (workspace_id, source_attempt_id) REFERENCES attempts",
  "FOREIGN KEY (workspace_id, id, active_version_id) REFERENCES avatar_profile_versions",
  "FOREIGN KEY (workspace_id, id, active_version_id) REFERENCES image_style_versions",
  "FOREIGN KEY (workspace_id, avatar_profile_id, avatar_profile_version_id) REFERENCES avatar_profile_versions",
  "FOREIGN KEY (workspace_id, image_style_id, image_style_version_id) REFERENCES image_style_versions",
  "FOREIGN KEY (workspace_id, task_id, owner_type, owner_id) REFERENCES generation_tasks",
  "FOREIGN KEY (workspace_id, task_id, attempt_id) REFERENCES attempts",
  "FOREIGN KEY (workspace_id, project_revision_id, transcript_id) REFERENCES transcripts",
  "FOREIGN KEY (workspace_id, project_revision_id, timeline_plan_id) REFERENCES timeline_plans",
  "FOREIGN KEY (workspace_id, project_revision_id, timeline_plan_id, timeline_segment_id) REFERENCES timeline_segments",
  "FOREIGN KEY (workspace_id, transcript_id, sentence_id) REFERENCES transcript_sentences",
];

const REQUIRED_HARDENING_FOREIGN_KEYS = [
  "avatar_profile_test_attempts_assessment_version_fk",
  "avatar_profile_test_attempts_execution_attempt_fk",
  "avatar_profile_test_attempts_outbox_fk",
  "avatar_profile_test_attempts_owner_task_fk",
  "avatar_profile_test_attempts_reservation_fk",
  "callback_receipts_attempt_fk",
  "callback_receipts_workflow_event_fk",
  "image_style_analysis_attempts_execution_attempt_fk",
  "image_style_analysis_attempts_outbox_fk",
  "image_style_analysis_attempts_owner_task_fk",
  "image_style_analysis_attempts_reservation_fk",
  "repository_mutation_receipts_workspace_fk",
  "timeline_segments_timeline_plan_fk",
  "transcripts_supersedes_fk",
].sort();

// These evidence tables carry tenant identity for lineage, but are written only by
// owner-controlled SECURITY DEFINER functions and intentionally have no tenant write guard.
const OPERATOR_ONLY_TABLES = [
  "hosted_v209_settlement_cost_evidence",
  "hosted_v209_terminal_acceptances",
].sort();

test("the migration exposes the expected tables, indexes, foreign keys, and invariant triggers", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    const tables = await executor.query(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_type = 'BASE TABLE'
        ORDER BY table_name`,
    );
    assert.deepEqual(
      tables.rows.map((row) => row.table_name),
      [
        ...RELATIONAL_TABLE_NAMES,
        ...SCHEMA_REGISTRY_TABLE_NAMES,
        ...NON_PORTABLE_TABLE_NAMES,
        MIGRATION_TABLE_NAME,
      ].sort(),
    );

    const views = await executor.query(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_type = 'VIEW'
        ORDER BY table_name`,
    );
    assert.deepEqual(
      views.rows.map((row) => row.table_name),
      [...TENANT_VIEW_NAMES].sort(),
    );

    const indexes = await executor.query(
      `SELECT indexname
         FROM pg_indexes
        WHERE schemaname = 'public'
        ORDER BY indexname`,
    );
    const indexNames = new Set(indexes.rows.map((row) => row.indexname));
    assert.deepEqual(
      REQUIRED_CUSTOM_INDEXES.filter((name) => indexNames.has(name)),
      REQUIRED_CUSTOM_INDEXES,
    );
    const foreignKeys = await executor.query(
      `SELECT conname, pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
        WHERE contype = 'f'
          AND connamespace = 'public'::regnamespace
        ORDER BY conrelid::regclass::text, conname`,
    );
    const definitions = foreignKeys.rows.map((row) => row.definition);
    for (const fragment of REQUIRED_FOREIGN_KEY_FRAGMENTS) {
      assert.ok(
        definitions.some((definition) => definition.includes(fragment)),
        fragment,
      );
    }
    const foreignKeyNames = new Set(foreignKeys.rows.map((row) => row.conname));
    assert.deepEqual(
      REQUIRED_HARDENING_FOREIGN_KEYS.filter((name) => foreignKeyNames.has(name)),
      REQUIRED_HARDENING_FOREIGN_KEYS,
    );

    const triggers = await executor.query(
      `SELECT tgname
         FROM pg_trigger trigger
         JOIN pg_class relation ON relation.oid = trigger.tgrelid
         JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
        WHERE NOT trigger.tgisinternal
          AND namespace.nspname = 'public'
        ORDER BY tgname`,
    );
    const triggerNames = new Set(triggers.rows.map((row) => row.tgname));
    assert.deepEqual(
      REQUIRED_TRIGGERS.filter((name) => triggerNames.has(name)),
      REQUIRED_TRIGGERS,
    );

    // Every tenant-owned table carries the ownership guard and declares its production RLS policy.
    const guarded = await executor.query(
      `SELECT relation.relname AS table_name,
              relation.relrowsecurity AS rls_enabled,
              relation.relforcerowsecurity AS rls_forced,
              EXISTS (
                SELECT 1 FROM pg_trigger guard
                 WHERE guard.tgrelid = relation.oid
                   AND guard.tgname = relation.relname || '_tenant_write_guard'
              ) AS has_write_guard,
              EXISTS (
                SELECT 1 FROM pg_policy policy
                 WHERE policy.polrelid = relation.oid
                   AND policy.polname = relation.relname || '_tenant_rls'
              ) AS has_policy,
              EXISTS (
                SELECT 1 FROM pg_policy policy
                 WHERE policy.polrelid = relation.oid
                   AND policy.polname = relation.relname || '_owner_only'
              ) AS has_owner_only_policy
         FROM pg_class relation
         JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
         JOIN pg_attribute owner
           ON owner.attrelid = relation.oid
          AND owner.attname = 'account_id'
          AND owner.attnum > 0
          AND NOT owner.attisdropped
        WHERE namespace.nspname = 'public'
          AND relation.relkind = 'r'
          AND relation.relname <> 'accounts'
          AND relation.relname <> ALL($1::text[])
        ORDER BY relation.relname`,
      [OPERATOR_ONLY_TABLES],
    );
    assert.ok(guarded.rows.length >= 55, "every tenant table must be discoverable");
    for (const row of guarded.rows) {
      assert.ok(row.rls_enabled, `${row.table_name} must enable row level security`);
      assert.ok(row.rls_forced, `${row.table_name} must force row level security`);
      if (OPERATOR_ONLY_TABLES.includes(row.table_name)) {
        assert.equal(row.has_write_guard, false, `${row.table_name} must remain owner-written`);
        assert.equal(row.has_policy, false, `${row.table_name} must not expose a tenant policy`);
        assert.ok(
          row.has_owner_only_policy,
          `${row.table_name} must declare its owner-only policy`,
        );
        continue;
      }
      assert.ok(row.has_write_guard, `${row.table_name} must carry the tenant write guard`);
      assert.ok(row.has_policy, `${row.table_name} must declare its tenant policy`);
      assert.equal(
        row.has_owner_only_policy,
        false,
        `${row.table_name} must not use an owner-only policy`,
      );
    }

    const operatorOnly = await executor.query(
      `SELECT relation.relname AS table_name,
              relation.relrowsecurity AS rls_enabled,
              relation.relforcerowsecurity AS rls_forced,
              policy.polname AS policy_name,
              pg_get_expr(policy.polqual, policy.polrelid) AS policy_qual,
              pg_get_expr(policy.polwithcheck, policy.polrelid) AS policy_with_check,
              EXISTS (
                SELECT 1 FROM pg_trigger guard
                 WHERE guard.tgrelid = relation.oid
                   AND guard.tgname = relation.relname || '_tenant_write_guard'
              ) AS has_write_guard
         FROM pg_class relation
         JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
         JOIN pg_policy policy ON policy.polrelid = relation.oid
        WHERE namespace.nspname = 'public'
          AND relation.relkind = 'r'
          AND relation.relname = ANY($1::text[])
        ORDER BY relation.relname`,
      [OPERATOR_ONLY_TABLES],
    );
    assert.equal(operatorOnly.rows.length, OPERATOR_ONLY_TABLES.length);
    assert.deepEqual(
      operatorOnly.rows.map((row) => row.table_name),
      OPERATOR_ONLY_TABLES,
    );
    for (const row of operatorOnly.rows) {
      assert.equal(row.rls_enabled, true, `${row.table_name} must enable row level security`);
      assert.equal(row.rls_forced, true, `${row.table_name} must force row level security`);
      assert.equal(row.policy_name, `${row.table_name}_owner_only`);
      assert.equal(row.policy_qual, "false");
      assert.equal(row.policy_with_check, "false");
      assert.equal(row.has_write_guard, false, `${row.table_name} must remain operator-only`);
    }
  });
});

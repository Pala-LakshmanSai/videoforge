import assert from "node:assert/strict";
import test from "node:test";

import { MIGRATION_TABLE_NAME, RELATIONAL_TABLE_NAMES } from "../dist/src/index.js";
import { withMigratedDatabase } from "./support/pglite.mjs";

const REQUIRED_CUSTOM_INDEXES = [
  "assets_binary_sha256_idx",
  "assets_canonical_document_sha256_idx",
  "assets_object_key_uq",
  "attempts_external_job_uq",
  "attempts_one_accepted_result_uq",
  "avatar_profile_versions_open_draft_uq",
  "avatar_profile_versions_ready_hash_uq",
  "avatar_profiles_active_name_uq",
  "callback_receipts_attempt_idx",
  "cost_events_attempt_idx",
  "generation_tasks_ready_idx",
  "image_style_versions_open_draft_uq",
  "image_style_versions_published_hash_uq",
  "image_styles_active_name_uq",
  "memberships_active_name_uq",
  "memberships_user_idx",
  "outbox_delivery_idx",
  "project_inputs_one_current_kind_uq",
  "project_revisions_one_draft_uq",
  "projects_active_name_uq",
  "qa_results_one_terminal_acceptance_uq",
  "repository_mutation_receipts_operation_idx",
  "timeline_segments_frame_idx",
  "transcripts_one_ready_per_revision_uq",
  "users_active_email_uq",
  "workflow_events_attempt_sequence_uq",
  "workflow_instances_external_id_uq",
  "workspaces_active_name_uq",
].sort();

const REQUIRED_TRIGGERS = [
  "attempts_accepted_result_consistent",
  "attempts_execution_profile_immutable",
  "avatar_compatibility_assessments_execution_profile_immutable",
  "avatar_compatibility_assessments_terminal_immutable",
  "avatar_profile_versions_ready_immutable",
  "avatar_profile_test_attempts_execution_profile_matches",
  "avatar_profiles_active_version_ready",
  "callback_receipts_append_only",
  "cost_events_append_only",
  "cost_events_monotonic_sequence",
  "execution_profiles_tested_immutable",
  "generation_tasks_accepted_result_consistent",
  "image_style_versions_published_immutable",
  "image_styles_active_version_published",
  "project_revisions_locked_immutable",
  "project_revisions_validate_locked_snapshot",
  "repository_mutation_receipts_append_only",
  "workflow_events_append_only",
  "workflow_events_monotonic_sequence",
].sort();

const REQUIRED_FOREIGN_KEY_FRAGMENTS = [
  "FOREIGN KEY (workspace_id, project_id, project_revision_id) REFERENCES project_revisions",
  "FOREIGN KEY (workspace_id, source_attempt_id) REFERENCES attempts",
  "FOREIGN KEY (workspace_id, id, active_version_id) REFERENCES avatar_profile_versions",
  "FOREIGN KEY (workspace_id, id, active_version_id) REFERENCES image_style_versions",
  "FOREIGN KEY (workspace_id, avatar_profile_id, avatar_profile_version_id) REFERENCES avatar_profile_versions",
  "FOREIGN KEY (workspace_id, image_style_id, image_style_version_id) REFERENCES image_style_versions",
  "FOREIGN KEY (workspace_id, task_id, owner_type, owner_id) REFERENCES generation_tasks",
  "FOREIGN KEY (workspace_id, task_id, attempt_id) REFERENCES attempts",
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
].sort();

test("the migration exposes the expected tables, indexes, foreign keys, and invariant triggers", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    const tables = await executor.query(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = 'public'
        ORDER BY table_name`,
    );
    assert.deepEqual(
      tables.rows.map((row) => row.table_name),
      [...RELATIONAL_TABLE_NAMES, MIGRATION_TABLE_NAME].sort(),
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
    assert.deepEqual(
      triggers.rows.map((row) => row.tgname),
      REQUIRED_TRIGGERS,
    );
  });
});

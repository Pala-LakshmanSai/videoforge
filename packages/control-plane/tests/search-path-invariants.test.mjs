import assert from "node:assert/strict";
import test from "node:test";

import {
  HASHES,
  IDS,
  seedLockedProjects,
  seedReadyPresets,
  seedWorkflow,
} from "./support/fixtures.mjs";
import { insertProjectRevisionDraft } from "./support/hardening-fixtures.mjs";
import {
  expectDatabaseError,
  FIXED_TIME,
  sha256,
  uuid,
  withMigratedDatabase,
} from "./support/pglite.mjs";

test("hostile shadow tables cannot make draft preset versions active", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedReadyPresets(executor);
    const avatarDraftId = uuid(1200);
    const styleDraftId = uuid(1201);
    await executor.query(
      `INSERT INTO public.avatar_profile_versions (
         id, workspace_id, profile_id, version_number, state
       ) VALUES ($1, $2, $3, 2, 'DRAFT')`,
      [avatarDraftId, IDS.workspaceA, IDS.avatarProfileA],
    );
    await executor.query(
      `INSERT INTO public.image_style_versions (
         id, workspace_id, style_id, version_number, state
       ) VALUES ($1, $2, $3, 2, 'DRAFT')`,
      [styleDraftId, IDS.workspaceA, IDS.styleA],
    );

    await executor.execute(`
      CREATE SCHEMA hostile;
      CREATE TABLE hostile.avatar_profile_versions (
        workspace_id uuid, profile_id uuid, id uuid, state text
      );
      CREATE TABLE hostile.image_style_versions (
        workspace_id uuid, style_id uuid, id uuid, state text
      );
    `);
    await executor.query(
      `INSERT INTO hostile.avatar_profile_versions (workspace_id, profile_id, id, state)
       VALUES ($1, $2, $3, 'READY')`,
      [IDS.workspaceA, IDS.avatarProfileA, avatarDraftId],
    );
    await executor.query(
      `INSERT INTO hostile.image_style_versions (workspace_id, style_id, id, state)
       VALUES ($1, $2, $3, 'PUBLISHED')`,
      [IDS.workspaceA, IDS.styleA, styleDraftId],
    );
    await executor.execute("SET search_path TO hostile, public");

    await expectDatabaseError(
      () =>
        executor.query(
          "UPDATE public.avatar_profiles SET active_version_id = $1 WHERE id = $2",
          [avatarDraftId, IDS.avatarProfileA],
        ),
      ["23503", "23514"],
    );
    await expectDatabaseError(
      () =>
        executor.query(
          "UPDATE public.image_styles SET active_version_id = $1 WHERE id = $2",
          [styleDraftId, IDS.styleA],
        ),
      ["23503", "23514"],
    );

    const pointers = await executor.query(
      `SELECT
         (SELECT active_version_id FROM public.avatar_profiles WHERE id = $1) AS avatar_version,
         (SELECT active_version_id FROM public.image_styles WHERE id = $2) AS style_version`,
      [IDS.avatarProfileA, IDS.styleA],
    );
    assert.deepEqual(pointers.rows[0], {
      avatar_version: IDS.avatarVersionA,
      style_version: IDS.styleVersionA,
    });
  });
});

test("hostile shadow rows cannot validate a mismatched locked revision snapshot", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedLockedProjects(executor);
    const draftId = uuid(1210);
    const forgedAvatarHash = sha256("forged-avatar-profile-snapshot");
    await insertProjectRevisionDraft(executor, {
      id: draftId,
      revisionNumber: 2,
      avatarProfileHash: forgedAvatarHash,
    });

    await executor.execute(`
      CREATE SCHEMA hostile;
      CREATE TABLE hostile.avatar_profile_versions (
        workspace_id uuid, profile_id uuid, id uuid, state text, profile_hash text,
        runtime_source_asset_id uuid, runtime_source_binary_sha256 text,
        source_preparation_profile text, source_validation_profile text
      );
      CREATE TABLE hostile.assets (
        workspace_id uuid, id uuid, binary_sha256 text, state text
      );
      CREATE TABLE hostile.image_style_versions (
        workspace_id uuid, style_id uuid, id uuid, state text, style_profile_hash text
      );
      CREATE TABLE hostile.avatar_compatibility_assessments (
        workspace_id uuid, avatar_profile_version_id uuid, id uuid,
        state text, evidence_hash text
      );
    `);
    await executor.query(
      `INSERT INTO hostile.avatar_profile_versions (
         workspace_id, profile_id, id, state, profile_hash,
         runtime_source_asset_id, runtime_source_binary_sha256,
         source_preparation_profile, source_validation_profile
       ) VALUES ($1, $2, $3, 'READY', $4, $5, $6,
                 'owned-preparation-v1', 'owned-validation-v1')`,
      [
        IDS.workspaceA,
        IDS.avatarProfileA,
        IDS.avatarVersionA,
        forgedAvatarHash,
        IDS.avatarRuntimeA,
        HASHES.avatarRuntimeA,
      ],
    );
    await executor.query(
      `INSERT INTO hostile.assets (workspace_id, id, binary_sha256, state)
       VALUES ($1, $2, $3, 'VERIFIED'), ($1, $4, $5, 'VERIFIED')`,
      [
        IDS.workspaceA,
        IDS.avatarRuntimeA,
        HASHES.avatarRuntimeA,
        IDS.voiceoverA,
        HASHES.voiceoverA,
      ],
    );
    await executor.query(
      `INSERT INTO hostile.image_style_versions (
         workspace_id, style_id, id, state, style_profile_hash
       ) VALUES ($1, $2, $3, 'PUBLISHED', $4)`,
      [IDS.workspaceA, IDS.styleA, IDS.styleVersionA, HASHES.styleA],
    );
    await executor.execute("SET search_path TO hostile, public");

    await expectDatabaseError(
      () =>
        executor.query(
          `UPDATE public.project_revisions
              SET status = 'LOCKED', locked_at = $1
            WHERE workspace_id = $2 AND id = $3`,
          [FIXED_TIME, IDS.workspaceA, draftId],
        ),
      "23514",
    );
    const draft = await executor.query(
      "SELECT status, locked_at FROM public.project_revisions WHERE id = $1",
      [draftId],
    );
    assert.deepEqual(draft.rows[0], { status: "DRAFT", locked_at: null });
  });
});

test("hostile shadow ledgers cannot admit late workflow or cost sequences", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedWorkflow(executor);
    await executor.query(
      `INSERT INTO public.workflow_events (
         id, workspace_id, workflow_instance_id, task_id, attempt_id,
         aggregate_type, aggregate_id, sequence, kind,
         payload_contract_name, payload_contract_version, payload_hash, payload, occurred_at
       ) VALUES ($1, $2, $3, $4, $5, 'ATTEMPT', $5, 3, 'ATTEMPT_CREATED',
                 'workflow-event', 'v1', $6, '{}'::jsonb, $7)`,
      [
        uuid(1220),
        IDS.workspaceA,
        IDS.workflowA,
        IDS.taskA,
        IDS.attemptA1,
        sha256("hostile-workflow-sequence-3"),
        FIXED_TIME,
      ],
    );
    await executor.query(
      `INSERT INTO public.cost_events (
         id, workspace_id, owner_type, owner_id, task_id, attempt_id,
         sequence, event_type, amount_micro_usd, idempotency_key, occurred_at
       ) VALUES ($1, $2, 'PROJECT_REVISION', $3, $4, $5,
                 3, 'RESERVED', 100000, 'hostile-cost-sequence-3', $6)`,
      [uuid(1221), IDS.workspaceA, IDS.revisionA, IDS.taskA, IDS.attemptA1, FIXED_TIME],
    );

    await executor.execute(`
      CREATE SCHEMA hostile;
      CREATE TABLE hostile.workflow_events (
        workspace_id uuid, aggregate_type text, aggregate_id uuid,
        attempt_id uuid, sequence integer
      );
      CREATE TABLE hostile.cost_events (
        workspace_id uuid, owner_type text, owner_id uuid, sequence integer
      );
      SET search_path TO hostile, public;
    `);

    await expectDatabaseError(
      () =>
        executor.query(
          `INSERT INTO public.workflow_events (
             id, workspace_id, workflow_instance_id, task_id, attempt_id,
             aggregate_type, aggregate_id, sequence, kind,
             payload_contract_name, payload_contract_version, payload_hash, payload, occurred_at
           ) VALUES ($1, $2, $3, $4, $5, 'ATTEMPT', $5, 2, 'DISPATCH_RECORDED',
                     'workflow-event', 'v1', $6, '{}'::jsonb, $7)`,
          [
            uuid(1222),
            IDS.workspaceA,
            IDS.workflowA,
            IDS.taskA,
            IDS.attemptA1,
            sha256("hostile-late-workflow"),
            FIXED_TIME,
          ],
        ),
      "23514",
    );
    await expectDatabaseError(
      () =>
        executor.query(
          `INSERT INTO public.cost_events (
             id, workspace_id, owner_type, owner_id, task_id, attempt_id,
             sequence, event_type, amount_micro_usd, idempotency_key, occurred_at
           ) VALUES ($1, $2, 'PROJECT_REVISION', $3, $4, $5,
                     2, 'REPORTED', 100000, 'hostile-late-cost', $6)`,
          [uuid(1223), IDS.workspaceA, IDS.revisionA, IDS.taskA, IDS.attemptA1, FIXED_TIME],
        ),
      "23514",
    );

    const sequences = await executor.query(
      `SELECT
         (SELECT array_agg(sequence ORDER BY sequence)
            FROM public.workflow_events
           WHERE workspace_id = $1 AND attempt_id = $2) AS workflow,
         (SELECT array_agg(sequence ORDER BY sequence)
            FROM public.cost_events
           WHERE workspace_id = $1 AND owner_type = 'PROJECT_REVISION' AND owner_id = $3) AS cost`,
      [IDS.workspaceA, IDS.attemptA1, IDS.revisionA],
    );
    assert.deepEqual(sequences.rows[0], { workflow: [3], cost: [3] });
  });
});

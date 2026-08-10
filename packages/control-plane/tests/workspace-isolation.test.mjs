import test from "node:test";

import { HASHES, IDS, insertAttempt, seedTask } from "./support/fixtures.mjs";
import { expectDatabaseError, sha256, uuid, withMigratedDatabase } from "./support/pglite.mjs";

async function insertCrossWorkspaceRevision(executor) {
  await executor.query(
    `INSERT INTO project_revisions (
       id, workspace_id, project_id, revision_number, status, title,
       voiceover_asset_id, voiceover_binary_sha256,
       avatar_profile_id, avatar_profile_version_id, avatar_profile_hash,
       avatar_runtime_source_asset_id, avatar_runtime_source_binary_sha256,
       avatar_source_preparation_profile, avatar_source_validation_profile,
       avatar_compatibility_state, avatar_compatibility_assessment_id,
       avatar_compatibility_evidence_hash,
       image_style_id, image_style_version_id, style_profile_hash,
       extra_prompt_keywords, apply_extra_prompt_keywords, generation_mode,
       maximum_cost_micro_usd, currency, seed,
       revision_config_contract_name, revision_config_contract_version,
       revision_config_payload, revision_config_hash, created_by_user_id
     )
     SELECT $1, workspace_id, project_id, 2, 'DRAFT', 'Cross Workspace Draft',
            voiceover_asset_id, voiceover_binary_sha256,
            $2, $3, $4, $5, $6,
            avatar_source_preparation_profile, avatar_source_validation_profile,
            avatar_compatibility_state, avatar_compatibility_assessment_id,
            avatar_compatibility_evidence_hash,
            image_style_id, image_style_version_id, style_profile_hash,
            extra_prompt_keywords, apply_extra_prompt_keywords, generation_mode,
            maximum_cost_micro_usd, currency, seed,
            revision_config_contract_name, revision_config_contract_version,
            revision_config_payload, $7, created_by_user_id
       FROM project_revisions
      WHERE workspace_id = $8 AND id = $9`,
    [
      uuid(920),
      IDS.avatarProfileA,
      IDS.avatarVersionA,
      HASHES.avatarProfileA,
      IDS.avatarRuntimeA,
      HASHES.avatarRuntimeA,
      sha256("cross-workspace-revision"),
      IDS.workspaceB,
      IDS.revisionB,
    ],
  );
}

test("workspace ownership rejects cross-tenant membership, preset, revision, asset, task, and attempt bindings", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedTask(executor);
    await insertAttempt(executor, {
      id: IDS.attemptA1,
      ordinal: 1,
      idempotencyKey: "attempt:owned:001",
    });

    await expectDatabaseError(
      () =>
        executor.query(
          `INSERT INTO avatar_profiles (id, workspace_id, name, normalized_name, created_by_user_id)
           VALUES ($1, $2, 'Cross Membership', 'cross membership', $3)`,
          [uuid(921), IDS.workspaceB, IDS.userA],
        ),
      "23503",
    );
    await expectDatabaseError(
      () =>
        executor.query(
          `INSERT INTO avatar_profile_versions (id, workspace_id, profile_id, version_number, state)
           VALUES ($1, $2, $3, 2, 'DRAFT')`,
          [uuid(922), IDS.workspaceB, IDS.avatarProfileA],
        ),
      "23503",
    );
    await expectDatabaseError(
      () =>
        executor.query(
          `INSERT INTO image_style_versions (id, workspace_id, style_id, version_number, state)
           VALUES ($1, $2, $3, 2, 'DRAFT')`,
          [uuid(923), IDS.workspaceB, IDS.styleA],
        ),
      "23503",
    );
    await expectDatabaseError(() => insertCrossWorkspaceRevision(executor), "23503");
    await expectDatabaseError(
      () =>
        executor.query(
          `INSERT INTO assets (id, workspace_id, project_id, kind, state)
           VALUES ($1, $2, $3, 'OTHER', 'UPLOADING')`,
          [uuid(924), IDS.workspaceB, IDS.projectA],
        ),
      "23503",
    );
    await expectDatabaseError(
      () =>
        executor.query(
          `INSERT INTO assets (id, workspace_id, source_attempt_id, kind, state)
           VALUES ($1, $2, $3, 'OTHER', 'UPLOADING')`,
          [uuid(925), IDS.workspaceB, IDS.attemptA1],
        ),
      "23503",
    );
    await expectDatabaseError(
      () =>
        executor.query(
          `INSERT INTO generation_tasks (
             id, workspace_id, owner_type, owner_id, project_revision_id, task_key, lane, state
           ) VALUES ($1, $2, 'PROJECT_REVISION', $3, $3, 'cross:task', 'IMAGE', 'READY')`,
          [IDS.taskB, IDS.workspaceB, IDS.revisionA],
        ),
      "23503",
    );
    await expectDatabaseError(
      () =>
        executor.query(
          `INSERT INTO attempts (
             id, workspace_id, task_id, ordinal, idempotency_key, state,
             dispatch_state, claim_state, execution_profile_id,
             execution_claim_token_hash, input_hash
           ) VALUES ($1, $2, $3, 1, 'cross:attempt', 'CREATED',
                     'NOT_SENT', 'UNCLAIMED', $4, $5, $6)`,
          [
            IDS.attemptB1,
            IDS.workspaceB,
            IDS.taskA,
            IDS.executionProfileB,
            sha256("cross-claim"),
            sha256("cross-input"),
          ],
        ),
      "23503",
    );
  });
});

import assert from "node:assert/strict";
import test from "node:test";

import { HASHES, IDS, seedLockedProjects, seedReadyPresets } from "./support/fixtures.mjs";
import {
  expectDatabaseError,
  FIXED_TIME,
  sha256,
  uuid,
  withMigratedDatabase,
} from "./support/pglite.mjs";

async function cloneRevisionAsDraft(executor, { id, revisionNumber, avatarProfileHash }) {
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
     SELECT $1, workspace_id, project_id, $2, 'DRAFT', 'Owned Draft',
            voiceover_asset_id, voiceover_binary_sha256,
            avatar_profile_id, avatar_profile_version_id, $3,
            avatar_runtime_source_asset_id, avatar_runtime_source_binary_sha256,
            avatar_source_preparation_profile, avatar_source_validation_profile,
            avatar_compatibility_state, avatar_compatibility_assessment_id,
            avatar_compatibility_evidence_hash,
            image_style_id, image_style_version_id, style_profile_hash,
            extra_prompt_keywords, apply_extra_prompt_keywords, generation_mode,
            maximum_cost_micro_usd, currency, seed,
            revision_config_contract_name, revision_config_contract_version,
            revision_config_payload, revision_config_hash, created_by_user_id
       FROM project_revisions
      WHERE workspace_id = $4 AND id = $5`,
    [id, revisionNumber, avatarProfileHash, IDS.workspaceA, IDS.revisionA],
  );
}

test("normalized active member and preset names are workspace-scoped", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedReadyPresets(executor);

    const allowedAcrossWorkspaces = await executor.query(
      `SELECT
         (SELECT count(*)::int FROM memberships WHERE normalized_name = 'owner' AND status = 'ACTIVE') AS members,
         (SELECT count(*)::int FROM avatar_profiles WHERE normalized_name = 'owned presenter' AND status = 'ACTIVE') AS avatars,
         (SELECT count(*)::int FROM image_styles WHERE normalized_name = 'owned documentary' AND status = 'ACTIVE') AS styles`,
    );
    assert.deepEqual(allowedAcrossWorkspaces.rows[0], { members: 2, avatars: 2, styles: 2 });

    await executor.query(
      `INSERT INTO users (id, email, normalized_email, display_name)
       VALUES ($1, 'extra@example.test', 'extra@example.test', 'Extra Owner')`,
      [IDS.userExtra],
    );
    await expectDatabaseError(
      () =>
        executor.query(
          `INSERT INTO memberships (id, workspace_id, user_id, normalized_name, role, status)
           VALUES ($1, $2, $3, 'owner', 'MEMBER', 'ACTIVE')`,
          [IDS.membershipExtra, IDS.workspaceA, IDS.userExtra],
        ),
      "23505",
    );
    await expectDatabaseError(
      () =>
        executor.query(
          `INSERT INTO avatar_profiles (id, workspace_id, name, normalized_name, created_by_user_id)
           VALUES ($1, $2, 'Owned Presenter', 'owned presenter', $3)`,
          [uuid(901), IDS.workspaceA, IDS.userA],
        ),
      "23505",
    );
    await expectDatabaseError(
      () =>
        executor.query(
          `INSERT INTO image_styles (id, workspace_id, name, normalized_name, created_by_user_id)
           VALUES ($1, $2, 'Owned Documentary', 'owned documentary', $3)`,
          [uuid(902), IDS.workspaceA, IDS.userA],
        ),
      "23505",
    );

    await executor.query(
      "UPDATE avatar_profiles SET status = 'ARCHIVED', archived_at = $1 WHERE id = $2",
      [FIXED_TIME, IDS.avatarProfileA],
    );
    await executor.query(
      `INSERT INTO avatar_profiles (id, workspace_id, name, normalized_name, created_by_user_id)
       VALUES ($1, $2, 'Owned Presenter', 'owned presenter', $3)`,
      [uuid(903), IDS.workspaceA, IDS.userA],
    );
  });
});

test("preset parents have one open draft and terminal same-parent active pointers", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedReadyPresets(executor);

    await executor.query(
      `INSERT INTO avatar_profile_versions (id, workspace_id, profile_id, version_number, state)
       VALUES ($1, $2, $3, 2, 'DRAFT')`,
      [IDS.avatarDraftA, IDS.workspaceA, IDS.avatarProfileA],
    );
    await expectDatabaseError(
      () =>
        executor.query(
          `INSERT INTO avatar_profile_versions (id, workspace_id, profile_id, version_number, state)
           VALUES ($1, $2, $3, 3, 'FAILED')`,
          [IDS.avatarDraftASecond, IDS.workspaceA, IDS.avatarProfileA],
        ),
      "23505",
    );
    await expectDatabaseError(
      () =>
        executor.query("UPDATE avatar_profiles SET active_version_id = $1 WHERE id = $2", [
          IDS.avatarDraftA,
          IDS.avatarProfileA,
        ]),
      "23503",
    );

    await executor.query(
      `INSERT INTO avatar_profiles (id, workspace_id, name, normalized_name, created_by_user_id)
       VALUES ($1, $2, 'Other Presenter', 'other presenter', $3)`,
      [IDS.avatarProfileAOther, IDS.workspaceA, IDS.userA],
    );
    await executor.query(
      `INSERT INTO avatar_profile_versions (
         id, workspace_id, profile_id, version_number, state,
         profile_contract_name, profile_contract_version, profile_payload, profile_hash,
         original_asset_id, runtime_source_asset_id, runtime_source_binary_sha256,
         source_preparation_profile, source_validation_profile,
         rights_attested_by_user_id, likeness_attested_by_user_id, ready_at
       ) VALUES (
         $1, $2, $3, 1, 'READY', 'avatar-profile-version', 'v1', '{}'::jsonb, $4,
         $5, $6, $7, 'owned-preparation-v1', 'owned-validation-v1', $8, $8, $9
       )`,
      [
        IDS.avatarVersionAOther,
        IDS.workspaceA,
        IDS.avatarProfileAOther,
        sha256("other-avatar-profile"),
        IDS.avatarOriginalA,
        IDS.avatarRuntimeA,
        HASHES.avatarRuntimeA,
        IDS.userA,
        FIXED_TIME,
      ],
    );
    await executor.query("UPDATE avatar_profiles SET active_version_id = $1 WHERE id = $2", [
      IDS.avatarVersionAOther,
      IDS.avatarProfileAOther,
    ]);
    await expectDatabaseError(
      () =>
        executor.query("UPDATE avatar_profiles SET active_version_id = $1 WHERE id = $2", [
          IDS.avatarVersionAOther,
          IDS.avatarProfileA,
        ]),
      "23503",
    );

    await executor.query(
      `INSERT INTO image_style_versions (id, workspace_id, style_id, version_number, state)
       VALUES ($1, $2, $3, 2, 'DRAFT')`,
      [IDS.styleDraftA, IDS.workspaceA, IDS.styleA],
    );
    await expectDatabaseError(
      () =>
        executor.query(
          `INSERT INTO image_style_versions (id, workspace_id, style_id, version_number, state)
           VALUES ($1, $2, $3, 3, 'FAILED')`,
          [IDS.styleDraftASecond, IDS.workspaceA, IDS.styleA],
        ),
      "23505",
    );
    await expectDatabaseError(
      () =>
        executor.query("UPDATE image_styles SET active_version_id = $1 WHERE id = $2", [
          IDS.styleDraftA,
          IDS.styleA,
        ]),
      "23503",
    );

    await executor.query(
      `INSERT INTO image_styles (id, workspace_id, name, normalized_name, created_by_user_id)
       VALUES ($1, $2, 'Other Style', 'other style', $3)`,
      [IDS.styleAOther, IDS.workspaceA, IDS.userA],
    );
    await executor.query(
      `INSERT INTO image_style_versions (
         id, workspace_id, style_id, version_number, state,
         profile_contract_name, profile_contract_version, profile_payload,
         style_profile_hash, disclosure_attested_by_user_id, published_at
       ) VALUES ($1, $2, $3, 1, 'PUBLISHED', 'image-style-profile', 'v1', '{}'::jsonb, $4, $5, $6)`,
      [
        IDS.styleVersionAOther,
        IDS.workspaceA,
        IDS.styleAOther,
        sha256("other-style-profile"),
        IDS.userA,
        FIXED_TIME,
      ],
    );
    await executor.query("UPDATE image_styles SET active_version_id = $1 WHERE id = $2", [
      IDS.styleVersionAOther,
      IDS.styleAOther,
    ]);
    await expectDatabaseError(
      () =>
        executor.query("UPDATE image_styles SET active_version_id = $1 WHERE id = $2", [
          IDS.styleVersionAOther,
          IDS.styleA,
        ]),
      "23503",
    );
  });
});

test("terminal avatar and style version payloads are immutable", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedReadyPresets(executor);
    await expectDatabaseError(
      () =>
        executor.query(
          "UPDATE avatar_profile_versions SET profile_payload = '{}'::jsonb WHERE id = $1",
          [IDS.avatarVersionA],
        ),
      "23514",
    );
    await expectDatabaseError(
      () =>
        executor.query("DELETE FROM avatar_profile_versions WHERE id = $1", [IDS.avatarVersionA]),
      "23514",
    );
    await expectDatabaseError(
      () =>
        executor.query(
          "UPDATE image_style_versions SET profile_payload = '{}'::jsonb WHERE id = $1",
          [IDS.styleVersionA],
        ),
      "23514",
    );
    await expectDatabaseError(
      () => executor.query("DELETE FROM image_style_versions WHERE id = $1", [IDS.styleVersionA]),
      "23514",
    );
  });
});

test("locked revisions retain exact preset, runtime-source, and config snapshots immutably", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedLockedProjects(executor);
    const snapshot = await executor.query(
      `SELECT avatar_profile_id, avatar_profile_version_id, avatar_profile_hash,
              avatar_runtime_source_asset_id, avatar_runtime_source_binary_sha256,
              image_style_id, image_style_version_id, style_profile_hash,
              revision_config_hash
         FROM project_revisions
        WHERE workspace_id = $1 AND id = $2`,
      [IDS.workspaceA, IDS.revisionA],
    );
    assert.deepEqual(snapshot.rows[0], {
      avatar_profile_id: IDS.avatarProfileA,
      avatar_profile_version_id: IDS.avatarVersionA,
      avatar_profile_hash: HASHES.avatarProfileA,
      avatar_runtime_source_asset_id: IDS.avatarRuntimeA,
      avatar_runtime_source_binary_sha256: HASHES.avatarRuntimeA,
      image_style_id: IDS.styleA,
      image_style_version_id: IDS.styleVersionA,
      style_profile_hash: HASHES.styleA,
      revision_config_hash: HASHES.revisionA,
    });
    await expectDatabaseError(
      () =>
        executor.query("UPDATE project_revisions SET title = 'Mutated' WHERE id = $1", [
          IDS.revisionA,
        ]),
      "23514",
    );
    await expectDatabaseError(
      () => executor.query("DELETE FROM project_revisions WHERE id = $1", [IDS.revisionA]),
      "23514",
    );

    await cloneRevisionAsDraft(executor, {
      id: IDS.revisionDraftA,
      revisionNumber: 2,
      avatarProfileHash: sha256("mismatched-avatar-profile"),
    });
    await expectDatabaseError(
      () =>
        executor.query(
          "UPDATE project_revisions SET status = 'LOCKED', locked_at = $1 WHERE id = $2",
          [FIXED_TIME, IDS.revisionDraftA],
        ),
      "23514",
    );
    await expectDatabaseError(
      () =>
        cloneRevisionAsDraft(executor, {
          id: IDS.revisionDraftASecond,
          revisionNumber: 3,
          avatarProfileHash: HASHES.avatarProfileA,
        }),
      "23505",
    );
  });
});

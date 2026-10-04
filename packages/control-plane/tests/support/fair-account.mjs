import { FIXED_TIME, sha256, uuid } from "./pglite.mjs";
export async function seedFairAccount(executor, index) {
  const base = 400_000 + index * 100;
  const identity = {
    accountId: uuid(base + 1),
    workspaceId: uuid(base + 2),
    userId: uuid(base + 3),
    membershipId: uuid(base + 4),
    avatarOriginalId: uuid(base + 5),
    avatarRuntimeId: uuid(base + 6),
    voiceoverId: uuid(base + 7),
    avatarProfileId: uuid(base + 8),
    avatarVersionId: uuid(base + 9),
    styleId: uuid(base + 10),
    styleVersionId: uuid(base + 11),
    projectId: uuid(base + 12),
    revisionId: uuid(base + 13),
  };
  const email = `fair-${index}@example.test`;
  await executor.query(
    `INSERT INTO users (id, email, normalized_email, display_name)
     VALUES ($1, $2, $2, $3)`,
    [identity.userId, email, `Fair account ${index}`],
  );
  await executor.query(
    `INSERT INTO accounts (id, scope_kind, owner_user_id, normalized_email, status)
     VALUES ($1, 'USER', $2, $3, 'ACTIVE')`,
    [identity.accountId, identity.userId, email],
  );
  await executor.query(
    `INSERT INTO workspaces (id, name, normalized_name, account_id, is_default)
     VALUES ($1, $2, $3, $4, true)`,
    [
      identity.workspaceId,
      `Fair workspace ${index}`,
      `fair workspace ${index}`,
      identity.accountId,
    ],
  );
  await executor.query(
    `INSERT INTO memberships (id, workspace_id, user_id, normalized_name, role, status)
     VALUES ($1, $2, $3, $4, 'ADMIN', 'ACTIVE')`,
    [identity.membershipId, identity.workspaceId, identity.userId, `fair owner ${index}`],
  );
  for (const [assetId, kind, label] of [
    [identity.avatarOriginalId, "AVATAR_ORIGINAL", "avatar-original"],
    [identity.avatarRuntimeId, "AVATAR_RUNTIME", "avatar-runtime"],
    [identity.voiceoverId, "VOICEOVER", "voiceover"],
  ]) {
    await executor.query(
      `INSERT INTO assets (
         id, workspace_id, kind, state, object_key, binary_sha256,
         content_type, byte_size, verified_at
       ) VALUES ($1, $2, $3, 'VERIFIED', $4, $5, 'application/octet-stream', 128, $6)`,
      [
        assetId,
        identity.workspaceId,
        kind,
        `workspace/fair-${index}/${label}.bin`,
        sha256(`fair-${index}-${label}`),
        FIXED_TIME,
      ],
    );
  }
  await executor.query(
    `INSERT INTO avatar_profiles (id, workspace_id, name, normalized_name, created_by_user_id)
     VALUES ($1, $2, 'Fair Presenter', 'fair presenter', $3)`,
    [identity.avatarProfileId, identity.workspaceId, identity.userId],
  );
  await executor.query(
    `INSERT INTO avatar_profile_versions (
       id, workspace_id, profile_id, version_number, state,
       profile_contract_name, profile_contract_version, profile_payload, profile_hash,
       original_asset_id, runtime_source_asset_id, runtime_source_binary_sha256,
       source_preparation_profile, source_validation_profile,
       rights_attested_by_user_id, likeness_attested_by_user_id, ready_at
     ) VALUES ($1, $2, $3, 1, 'READY', 'avatar-profile-version', 'v1',
               '{"source":"owned-synthetic"}'::jsonb, $4, $5, $6, $7,
               'owned-preparation-v1', 'owned-validation-v1', $8, $8, $9)`,
    [
      identity.avatarVersionId,
      identity.workspaceId,
      identity.avatarProfileId,
      sha256(`fair-${index}-avatar-profile`),
      identity.avatarOriginalId,
      identity.avatarRuntimeId,
      sha256(`fair-${index}-avatar-runtime`),
      identity.userId,
      FIXED_TIME,
    ],
  );
  await executor.query(`UPDATE avatar_profiles SET active_version_id = $1 WHERE id = $2`, [
    identity.avatarVersionId,
    identity.avatarProfileId,
  ]);
  await executor.query(
    `INSERT INTO image_styles (id, workspace_id, name, normalized_name, created_by_user_id)
     VALUES ($1, $2, 'Fair Documentary', 'fair documentary', $3)`,
    [identity.styleId, identity.workspaceId, identity.userId],
  );
  await executor.query(
    `INSERT INTO image_style_versions (
       id, workspace_id, style_id, version_number, state,
       profile_contract_name, profile_contract_version, profile_payload, style_profile_hash,
       disclosure_attested_by_user_id, published_at
     ) VALUES ($1, $2, $3, 1, 'PUBLISHED', 'image-style-profile', 'v1',
               '{"source":"owned-synthetic"}'::jsonb, $4, $5, $6)`,
    [
      identity.styleVersionId,
      identity.workspaceId,
      identity.styleId,
      sha256(`fair-${index}-style`),
      identity.userId,
      FIXED_TIME,
    ],
  );
  await executor.query(`UPDATE image_styles SET active_version_id = $1 WHERE id = $2`, [
    identity.styleVersionId,
    identity.styleId,
  ]);
  await executor.query(
    `INSERT INTO projects (id, workspace_id, owner_user_id, name, normalized_name)
     VALUES ($1, $2, $3, 'Fair Project', 'fair project')`,
    [identity.projectId, identity.workspaceId, identity.userId],
  );
  await executor.query(
    `INSERT INTO project_revisions (
       id, workspace_id, project_id, revision_number, status, title,
       voiceover_asset_id, voiceover_binary_sha256,
       avatar_profile_id, avatar_profile_version_id, avatar_profile_hash,
       avatar_runtime_source_asset_id, avatar_runtime_source_binary_sha256,
       avatar_source_preparation_profile, avatar_source_validation_profile,
       avatar_compatibility_state, image_style_id, image_style_version_id, style_profile_hash,
       generation_mode, maximum_cost_micro_usd, seed,
       revision_config_contract_name, revision_config_contract_version,
       revision_config_payload, revision_config_hash, created_by_user_id, locked_at
     ) VALUES ($1, $2, $3, 1, 'LOCKED', $4, $5, $6, $7, $8, $9, $10, $11,
               'owned-preparation-v1', 'owned-validation-v1', 'UNTESTED', $12, $13, $14,
               'LOWEST_COST', 1500000, $15, 'project-revision-config', 'v2',
               '{"source":"owned-synthetic"}'::jsonb, $16, $17, $18)`,
    [
      identity.revisionId,
      identity.workspaceId,
      identity.projectId,
      `Fair Revision ${index}`,
      identity.voiceoverId,
      sha256(`fair-${index}-voiceover`),
      identity.avatarProfileId,
      identity.avatarVersionId,
      sha256(`fair-${index}-avatar-profile`),
      identity.avatarRuntimeId,
      sha256(`fair-${index}-avatar-runtime`),
      identity.styleId,
      identity.styleVersionId,
      sha256(`fair-${index}-style`),
      index,
      sha256(`fair-${index}-revision`),
      identity.userId,
      FIXED_TIME,
    ],
  );
  return identity;
}

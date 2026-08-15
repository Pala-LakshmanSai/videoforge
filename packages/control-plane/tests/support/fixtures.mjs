import { FIXED_TIME, sha256, uuid } from "./pglite.mjs";

export const IDS = Object.freeze({
  accountA: uuid(901),
  accountB: uuid(902),
  workspaceA: uuid(1),
  workspaceB: uuid(2),
  userA: uuid(11),
  userB: uuid(12),
  userExtra: uuid(13),
  membershipA: uuid(21),
  membershipB: uuid(22),
  membershipExtra: uuid(23),
  avatarOriginalA: uuid(101),
  avatarRuntimeA: uuid(102),
  voiceoverA: uuid(103),
  outputA1: uuid(104),
  outputA2: uuid(105),
  avatarOriginalB: uuid(111),
  avatarRuntimeB: uuid(112),
  voiceoverB: uuid(113),
  avatarProfileA: uuid(201),
  avatarProfileAOther: uuid(202),
  avatarProfileB: uuid(203),
  avatarVersionA: uuid(211),
  avatarVersionAOther: uuid(212),
  avatarVersionB: uuid(213),
  avatarDraftA: uuid(214),
  avatarDraftASecond: uuid(215),
  styleA: uuid(301),
  styleAOther: uuid(302),
  styleB: uuid(303),
  styleVersionA: uuid(311),
  styleVersionAOther: uuid(312),
  styleVersionB: uuid(313),
  styleDraftA: uuid(314),
  styleDraftASecond: uuid(315),
  projectA: uuid(401),
  projectB: uuid(402),
  revisionA: uuid(411),
  revisionB: uuid(412),
  revisionDraftA: uuid(413),
  revisionDraftASecond: uuid(414),
  executionProfileA: uuid(501),
  executionProfileB: uuid(502),
  taskA: uuid(601),
  taskASecond: uuid(602),
  taskB: uuid(603),
  attemptA1: uuid(611),
  attemptA2: uuid(612),
  attemptA3: uuid(613),
  attemptB1: uuid(614),
  workflowA: uuid(701),
  eventA1: uuid(711),
  eventA2: uuid(712),
  eventA3: uuid(713),
  costA1: uuid(721),
  costA2: uuid(722),
  outboxA1: uuid(731),
  outboxA2: uuid(732),
  rollbackAttempt: uuid(811),
  rollbackCost: uuid(812),
  rollbackOutbox: uuid(813),
});

export const HASHES = Object.freeze({
  avatarOriginalA: sha256("avatar-original-a"),
  avatarRuntimeA: sha256("avatar-runtime-a"),
  avatarProfileA: sha256("avatar-profile-a"),
  voiceoverA: sha256("voiceover-a"),
  outputA1: sha256("output-a-1"),
  outputA2: sha256("output-a-2"),
  avatarOriginalB: sha256("avatar-original-b"),
  avatarRuntimeB: sha256("avatar-runtime-b"),
  avatarProfileB: sha256("avatar-profile-b"),
  voiceoverB: sha256("voiceover-b"),
  styleA: sha256("style-a"),
  styleB: sha256("style-b"),
  revisionA: sha256("revision-a"),
  revisionB: sha256("revision-b"),
  executionProfileA: sha256("execution-profile-a"),
  executionProfileB: sha256("execution-profile-b"),
  attemptInputA1: sha256("attempt-input-a-1"),
  attemptInputA2: sha256("attempt-input-a-2"),
  claimA1: sha256("claim-a-1"),
  claimA2: sha256("claim-a-2"),
  payloadA1: sha256("payload-a-1"),
  payloadA2: sha256("payload-a-2"),
});

async function insertBinaryAsset(executor, { id, workspaceId, kind, objectKey, sha256: hash }) {
  await executor.query(
    `INSERT INTO assets (
       id, workspace_id, kind, state, object_key, binary_sha256, content_type, byte_size, verified_at
     ) VALUES ($1, $2, $3, 'VERIFIED', $4, $5, 'application/octet-stream', 128, $6)`,
    [id, workspaceId, kind, objectKey, hash, FIXED_TIME],
  );
}

/** True once migration 0018 has introduced tenant ownership; false on a pre-V2 chain. */
async function hasTenantScope(executor) {
  const result = await executor.query(
    `SELECT to_regclass('public.accounts') IS NOT NULL AS present`,
  );
  return result.rows[0]?.present === true;
}

export async function seedIdentity(executor) {
  await executor.query(
    `INSERT INTO users (id, email, normalized_email, display_name)
     VALUES ($1, 'owner-a@example.test', 'owner-a@example.test', 'Owner A'),
            ($2, 'owner-b@example.test', 'owner-b@example.test', 'Owner B')`,
    [IDS.userA, IDS.userB],
  );

  if (await hasTenantScope(executor)) {
    await executor.query(
      `INSERT INTO accounts (id, scope_kind, owner_user_id, normalized_email, status)
       VALUES ($1, 'USER', $3, 'owner-a@example.test', 'ACTIVE'),
              ($2, 'USER', $4, 'owner-b@example.test', 'ACTIVE')`,
      [IDS.accountA, IDS.accountB, IDS.userA, IDS.userB],
    );
    await executor.query(
      `INSERT INTO workspaces (id, name, normalized_name, account_id, is_default)
       VALUES ($1, 'Owned Workspace A', 'owned workspace a', $3, true),
              ($2, 'Owned Workspace B', 'owned workspace b', $4, true)`,
      [IDS.workspaceA, IDS.workspaceB, IDS.accountA, IDS.accountB],
    );
  } else {
    await executor.query(
      `INSERT INTO workspaces (id, name, normalized_name)
       VALUES ($1, 'Owned Workspace A', 'owned workspace a'),
              ($2, 'Owned Workspace B', 'owned workspace b')`,
      [IDS.workspaceA, IDS.workspaceB],
    );
  }
  await executor.query(
    `INSERT INTO memberships (id, workspace_id, user_id, normalized_name, role, status)
     VALUES ($1, $2, $3, 'owner', 'ADMIN', 'ACTIVE'),
            ($4, $5, $6, 'owner', 'ADMIN', 'ACTIVE')`,
    [IDS.membershipA, IDS.workspaceA, IDS.userA, IDS.membershipB, IDS.workspaceB, IDS.userB],
  );
}

export async function seedAssets(executor) {
  await seedIdentity(executor);
  const assets = [
    {
      id: IDS.avatarOriginalA,
      workspaceId: IDS.workspaceA,
      kind: "AVATAR_ORIGINAL",
      objectKey: "workspace/a/avatar/original.bin",
      sha256: HASHES.avatarOriginalA,
    },
    {
      id: IDS.avatarRuntimeA,
      workspaceId: IDS.workspaceA,
      kind: "AVATAR_RUNTIME",
      objectKey: "workspace/a/avatar/runtime.bin",
      sha256: HASHES.avatarRuntimeA,
    },
    {
      id: IDS.voiceoverA,
      workspaceId: IDS.workspaceA,
      kind: "VOICEOVER",
      objectKey: "workspace/a/project/voiceover.wav",
      sha256: HASHES.voiceoverA,
    },
    {
      id: IDS.outputA1,
      workspaceId: IDS.workspaceA,
      kind: "IMAGE",
      objectKey: "workspace/a/project/output-1.png",
      sha256: HASHES.outputA1,
    },
    {
      id: IDS.outputA2,
      workspaceId: IDS.workspaceA,
      kind: "IMAGE",
      objectKey: "workspace/a/project/output-2.png",
      sha256: HASHES.outputA2,
    },
    {
      id: IDS.avatarOriginalB,
      workspaceId: IDS.workspaceB,
      kind: "AVATAR_ORIGINAL",
      objectKey: "workspace/b/avatar/original.bin",
      sha256: HASHES.avatarOriginalB,
    },
    {
      id: IDS.avatarRuntimeB,
      workspaceId: IDS.workspaceB,
      kind: "AVATAR_RUNTIME",
      objectKey: "workspace/b/avatar/runtime.bin",
      sha256: HASHES.avatarRuntimeB,
    },
    {
      id: IDS.voiceoverB,
      workspaceId: IDS.workspaceB,
      kind: "VOICEOVER",
      objectKey: "workspace/b/project/voiceover.wav",
      sha256: HASHES.voiceoverB,
    },
  ];
  for (const asset of assets) {
    await insertBinaryAsset(executor, asset);
  }
}

async function insertReadyAvatar(executor, values) {
  await executor.query(
    `INSERT INTO avatar_profiles (id, workspace_id, name, normalized_name, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [values.profileId, values.workspaceId, values.name, values.normalizedName, values.userId],
  );
  await executor.query(
    `INSERT INTO avatar_profile_versions (
       id, workspace_id, profile_id, version_number, state,
       profile_contract_name, profile_contract_version, profile_payload, profile_hash,
       original_asset_id, runtime_source_asset_id, runtime_source_binary_sha256,
       source_preparation_profile, source_validation_profile,
       rights_attested_by_user_id, likeness_attested_by_user_id, ready_at
     ) VALUES (
       $1, $2, $3, 1, 'READY',
       'avatar-profile-version', 'v1', '{"source":"owned-synthetic"}'::jsonb, $4,
       $5, $6, $7, 'owned-preparation-v1', 'owned-validation-v1', $8, $8, $9
     )`,
    [
      values.versionId,
      values.workspaceId,
      values.profileId,
      values.profileHash,
      values.originalAssetId,
      values.runtimeAssetId,
      values.runtimeHash,
      values.userId,
      FIXED_TIME,
    ],
  );
  await executor.query("UPDATE avatar_profiles SET active_version_id = $1 WHERE id = $2", [
    values.versionId,
    values.profileId,
  ]);
}

async function insertPublishedStyle(executor, values) {
  await executor.query(
    `INSERT INTO image_styles (id, workspace_id, name, normalized_name, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [values.styleId, values.workspaceId, values.name, values.normalizedName, values.userId],
  );
  await executor.query(
    `INSERT INTO image_style_versions (
       id, workspace_id, style_id, version_number, state,
       profile_contract_name, profile_contract_version, profile_payload, style_profile_hash,
       disclosure_attested_by_user_id, published_at
     ) VALUES (
       $1, $2, $3, 1, 'PUBLISHED',
       'image-style-profile', 'v1', $4::jsonb, $5, $6, $7
     )`,
    [
      values.versionId,
      values.workspaceId,
      values.styleId,
      JSON.stringify(values.profilePayload ?? { source: "owned-synthetic" }),
      values.styleHash,
      values.userId,
      FIXED_TIME,
    ],
  );
  await executor.query("UPDATE image_styles SET active_version_id = $1 WHERE id = $2", [
    values.versionId,
    values.styleId,
  ]);
}

export async function seedReadyPresets(executor, overrides = {}) {
  await seedAssets(executor);
  await insertReadyAvatar(executor, {
    profileId: IDS.avatarProfileA,
    versionId: IDS.avatarVersionA,
    workspaceId: IDS.workspaceA,
    userId: IDS.userA,
    name: "Owned Presenter",
    normalizedName: "owned presenter",
    profileHash: HASHES.avatarProfileA,
    originalAssetId: IDS.avatarOriginalA,
    runtimeAssetId: IDS.avatarRuntimeA,
    runtimeHash: HASHES.avatarRuntimeA,
  });
  await insertReadyAvatar(executor, {
    profileId: IDS.avatarProfileB,
    versionId: IDS.avatarVersionB,
    workspaceId: IDS.workspaceB,
    userId: IDS.userB,
    name: "Owned Presenter",
    normalizedName: "owned presenter",
    profileHash: HASHES.avatarProfileB,
    originalAssetId: IDS.avatarOriginalB,
    runtimeAssetId: IDS.avatarRuntimeB,
    runtimeHash: HASHES.avatarRuntimeB,
  });
  await insertPublishedStyle(executor, {
    styleId: IDS.styleA,
    versionId: IDS.styleVersionA,
    workspaceId: IDS.workspaceA,
    userId: IDS.userA,
    name: "Owned Documentary",
    normalizedName: "owned documentary",
    styleHash: HASHES.styleA,
    profilePayload: overrides.styleAProfilePayload,
  });
  await insertPublishedStyle(executor, {
    styleId: IDS.styleB,
    versionId: IDS.styleVersionB,
    workspaceId: IDS.workspaceB,
    userId: IDS.userB,
    name: "Owned Documentary",
    normalizedName: "owned documentary",
    styleHash: HASHES.styleB,
  });
}

async function insertExecutionProfile(executor, values) {
  await executor.query(
    `INSERT INTO execution_profiles (
       id, workspace_id, name, revision, lane, state, dispatch_target,
       configuration, configuration_hash, maximum_rate_micro_usd, checked_at
     ) VALUES ($1, $2, 'owned-local', 1, 'IMAGE_MEDIA', 'TESTED', 'LOCAL',
               '{"provider":"none"}'::jsonb, $3, 0, $4)`,
    [values.id, values.workspaceId, values.hash, FIXED_TIME],
  );
}

async function insertLockedRevision(executor, values) {
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
       maximum_cost_micro_usd, seed, revision_config_contract_name,
       revision_config_contract_version, revision_config_payload, revision_config_hash,
       created_by_user_id, locked_at
     ) VALUES (
       $1, $2, $3, 1, 'LOCKED', $4,
       $5, $6, $7, $8, $9, $10, $11,
       'owned-preparation-v1', 'owned-validation-v1',
       'UNTESTED', NULL, NULL, $12, $13, $14,
       '', false, 'LOWEST_COST', 1500000, $15,
       'project-revision-config', 'v2', $16::jsonb, $17,
       $18, $19
     )`,
    [
      values.revisionId,
      values.workspaceId,
      values.projectId,
      values.title,
      values.voiceoverAssetId,
      values.voiceoverHash,
      values.avatarProfileId,
      values.avatarVersionId,
      values.avatarProfileHash,
      values.avatarRuntimeAssetId,
      values.avatarRuntimeHash,
      values.styleId,
      values.styleVersionId,
      values.styleHash,
      values.seed ?? 42,
      JSON.stringify(values.revisionConfigPayload ?? { source: "owned-synthetic" }),
      values.revisionHash,
      values.userId,
      FIXED_TIME,
    ],
  );
}

export async function seedLockedProjects(executor, overrides = {}) {
  await seedReadyPresets(executor, {
    styleAProfilePayload: overrides.styleAProfilePayload,
  });
  await executor.query(
    `INSERT INTO projects (id, workspace_id, owner_user_id, name, normalized_name)
     VALUES ($1, $2, $3, 'Owned Project', 'owned project'),
            ($4, $5, $6, 'Owned Project', 'owned project')`,
    [IDS.projectA, IDS.workspaceA, IDS.userA, IDS.projectB, IDS.workspaceB, IDS.userB],
  );
  await insertLockedRevision(executor, {
    revisionId: IDS.revisionA,
    workspaceId: IDS.workspaceA,
    projectId: IDS.projectA,
    title: "Owned Revision A",
    voiceoverAssetId: IDS.voiceoverA,
    voiceoverHash: HASHES.voiceoverA,
    avatarProfileId: IDS.avatarProfileA,
    avatarVersionId: IDS.avatarVersionA,
    avatarProfileHash: HASHES.avatarProfileA,
    avatarRuntimeAssetId: IDS.avatarRuntimeA,
    avatarRuntimeHash: HASHES.avatarRuntimeA,
    styleId: IDS.styleA,
    styleVersionId: IDS.styleVersionA,
    styleHash: HASHES.styleA,
    revisionHash: overrides.revisionA?.revisionHash ?? HASHES.revisionA,
    revisionConfigPayload: overrides.revisionA?.revisionConfigPayload,
    seed: overrides.revisionA?.seed,
    userId: IDS.userA,
  });
  await insertLockedRevision(executor, {
    revisionId: IDS.revisionB,
    workspaceId: IDS.workspaceB,
    projectId: IDS.projectB,
    title: "Owned Revision B",
    voiceoverAssetId: IDS.voiceoverB,
    voiceoverHash: HASHES.voiceoverB,
    avatarProfileId: IDS.avatarProfileB,
    avatarVersionId: IDS.avatarVersionB,
    avatarProfileHash: HASHES.avatarProfileB,
    avatarRuntimeAssetId: IDS.avatarRuntimeB,
    avatarRuntimeHash: HASHES.avatarRuntimeB,
    styleId: IDS.styleB,
    styleVersionId: IDS.styleVersionB,
    styleHash: HASHES.styleB,
    revisionHash: HASHES.revisionB,
    userId: IDS.userB,
  });
  await insertExecutionProfile(executor, {
    id: IDS.executionProfileA,
    workspaceId: IDS.workspaceA,
    hash: HASHES.executionProfileA,
  });
  await insertExecutionProfile(executor, {
    id: IDS.executionProfileB,
    workspaceId: IDS.workspaceB,
    hash: HASHES.executionProfileB,
  });
}

export async function seedTask(executor) {
  await seedLockedProjects(executor);
  await executor.query(
    `INSERT INTO generation_tasks (
       id, workspace_id, owner_type, owner_id, project_revision_id, task_key, lane, state
     ) VALUES ($1, $2, 'PROJECT_REVISION', $3, $3, 'image:owned:001', 'IMAGE', 'READY')`,
    [IDS.taskA, IDS.workspaceA, IDS.revisionA],
  );
}

export async function insertAttempt(
  executor,
  {
    id,
    ordinal,
    idempotencyKey,
    state = "CREATED",
    outputAssetId = null,
    disposition = "PENDING",
    inputHash = HASHES.attemptInputA1,
    claimHash = HASHES.claimA1,
    finishedAt = null,
  },
) {
  await executor.query(
    `INSERT INTO attempts (
       id, workspace_id, task_id, ordinal, idempotency_key, state,
       dispatch_state, claim_state, execution_profile_id, execution_claim_token_hash,
       input_hash, output_asset_id, result_disposition, finished_at
     ) VALUES ($1, $2, $3, $4, $5, $6, 'NOT_SENT', 'UNCLAIMED', $7, $8, $9, $10, $11, $12)`,
    [
      id,
      IDS.workspaceA,
      IDS.taskA,
      ordinal,
      idempotencyKey,
      state,
      IDS.executionProfileA,
      claimHash,
      inputHash,
      outputAssetId,
      disposition,
      finishedAt,
    ],
  );
}

export async function seedAttempt(executor) {
  await seedTask(executor);
  await insertAttempt(executor, {
    id: IDS.attemptA1,
    ordinal: 1,
    idempotencyKey: "attempt:owned:001",
  });
}

export async function seedWorkflow(executor) {
  await seedAttempt(executor);
  await executor.query(
    `INSERT INTO workflow_instances (
       id, workspace_id, owner_type, owner_id, task_id, workflow_type,
       state, external_system, idempotency_key
     ) VALUES ($1, $2, 'PROJECT_REVISION', $3, $4, 'GENERATE', 'QUEUED', 'LOCAL', 'workflow:owned:001')`,
    [IDS.workflowA, IDS.workspaceA, IDS.revisionA, IDS.taskA],
  );
}

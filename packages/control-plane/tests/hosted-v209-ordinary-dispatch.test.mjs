import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { HASHES, IDS, seedReadyPresets } from "./support/fixtures.mjs";
import {
  expectDatabaseError,
  sha256,
  uuid,
  withPgcryptoMigratedDatabase,
} from "./support/pglite.mjs";

const EXACT_AVATAR_SHA256 =
  "sha256:37f07580badf2c459db496e0a74a15e524534b91432478d5e84e8f084e6b1e83";
const SYSTEM_ACCOUNT_ID = "ffffffff-ffff-4fff-8fff-000000000001";
const SYSTEM_WORKSPACE_ID = "ffffffff-ffff-4fff-8fff-000000000011";
const SYSTEM_USER_ID = "ffffffff-ffff-4fff-8fff-000000000021";

async function seedOrdinaryAvatarGuardFixture(
  executor,
  {
    sourceSha256 = EXACT_AVATAR_SHA256,
    contentType = "image/png",
    compatibilityState: requestedCompatibilityState = "UNTESTED",
    executionProfileState = "TESTED",
    driftAssessment = false,
  } = {},
) {
  const systemProfileId = uuid(81101);
  const systemVersionId = uuid(81102);
  const systemOriginalAssetId = uuid(81103);
  const systemRuntimeAssetId = uuid(81104);
  const systemOriginalLinkId = uuid(81105);
  const systemRuntimeLinkId = uuid(81106);
  const tenantRuntimeLinkId = uuid(81107);
  const projectId = uuid(81108);
  const revisionId = uuid(81109);
  const generationRequestId = uuid(81110);
  const assessmentId = uuid(81111);
  const executionProfileId = uuid(81112);
  const extension =
    contentType === "image/png" ? "png" : contentType === "image/jpeg" ? "jpg" : "webp";
  const objectKey =
    `tenant/${SYSTEM_ACCOUNT_ID}/workspace/${SYSTEM_WORKSPACE_ID}/avatar-profile/` +
    `${systemProfileId}/version/${systemVersionId}/canonical/avatar.${extension}`;
  await seedReadyPresets(executor);
  await executor.query(`SELECT set_config('videoforge.account_id',$1,false)`, [IDS.accountA]);
  await executor.execute(`ALTER TABLE assets DISABLE TRIGGER USER`);
  await executor.execute(`ALTER TABLE avatar_profile_versions DISABLE TRIGGER USER`);
  await executor.query(
    `UPDATE assets SET object_key=$1,binary_sha256=$2,content_type=$3,byte_size=1912005,
       width_px=1672,height_px=941,metadata=jsonb_build_object(
         'system_source_asset_id',$4::text,'system_source_scope','SYSTEM',
         'materialization','hosted-system-preset-snapshot-v1')
      WHERE account_id=$5 AND workspace_id=$6 AND id=$7`,
    [
      objectKey,
      sourceSha256,
      contentType,
      systemRuntimeAssetId,
      IDS.accountA,
      IDS.workspaceA,
      IDS.avatarRuntimeA,
    ],
  );
  await executor.query(
    `UPDATE avatar_profile_versions SET runtime_source_binary_sha256=$1
      WHERE account_id=$2 AND workspace_id=$3 AND id=$4`,
    [sourceSha256, IDS.accountA, IDS.workspaceA, IDS.avatarVersionA],
  );
  await executor.execute(`ALTER TABLE avatar_profile_versions ENABLE TRIGGER USER`);
  await executor.execute(`ALTER TABLE assets ENABLE TRIGGER USER`);
  await executor.query(
    `INSERT INTO avatar_profile_assets(id,account_id,workspace_id,profile_id,version_id,asset_id,
       role,binary_sha256,retention_state) VALUES($1,$2,$3,$4,$5,$6,'RUNTIME',$7,'RETAIN')`,
    [
      tenantRuntimeLinkId,
      IDS.accountA,
      IDS.workspaceA,
      IDS.avatarProfileA,
      IDS.avatarVersionA,
      IDS.avatarRuntimeA,
      sourceSha256,
    ],
  );

  await executor.query(`SELECT set_config('videoforge.account_id',$1,false)`, [SYSTEM_ACCOUNT_ID]);
  await executor.query(
    `INSERT INTO assets(id,account_id,workspace_id,kind,state,object_key,binary_sha256,
       content_type,byte_size,width_px,height_px,verified_at) VALUES
       ($1,$2,$3,'AVATAR_ORIGINAL','VERIFIED',$4,$5,'image/png',2048,1672,941,transaction_timestamp()),
       ($6,$2,$3,'AVATAR_RUNTIME','VERIFIED',$7,$8,$9,1912005,1672,941,transaction_timestamp())`,
    [
      systemOriginalAssetId,
      SYSTEM_ACCOUNT_ID,
      SYSTEM_WORKSPACE_ID,
      objectKey.replace(`/canonical/avatar.${extension}`, "/original/avatar.png"),
      sha256("0081-system-original"),
      systemRuntimeAssetId,
      objectKey,
      sourceSha256,
      contentType,
    ],
  );
  await executor.query(
    `INSERT INTO avatar_profiles(id,account_id,workspace_id,name,normalized_name,status,
       created_by_user_id,scope_kind) VALUES($1,$2,$3,'Exact System Presenter',
       'exact system presenter','ACTIVE',$4,'SYSTEM')`,
    [systemProfileId, SYSTEM_ACCOUNT_ID, SYSTEM_WORKSPACE_ID, SYSTEM_USER_ID],
  );
  await executor.query(
    `INSERT INTO avatar_profile_versions(id,account_id,workspace_id,profile_id,version_number,state,
       profile_contract_name,profile_contract_version,profile_payload,profile_hash,original_asset_id,
       runtime_source_asset_id,runtime_source_binary_sha256,source_preparation_profile,
       source_validation_profile,rights_attested_by_user_id,likeness_attested_by_user_id,ready_at,
       scope_kind) VALUES($1,$2,$3,$4,1,'READY','avatar-profile-version','v1',
       '{"source":"system-0081"}'::jsonb,$5,$6,$7,$8,'owned-preparation-v1','owned-validation-v1',
       $9,$9,transaction_timestamp(),'SYSTEM')`,
    [
      systemVersionId,
      SYSTEM_ACCOUNT_ID,
      SYSTEM_WORKSPACE_ID,
      systemProfileId,
      HASHES.avatarProfileA,
      systemOriginalAssetId,
      systemRuntimeAssetId,
      sourceSha256,
      SYSTEM_USER_ID,
    ],
  );
  await executor.execute(`ALTER TABLE avatar_profiles DISABLE TRIGGER USER`);
  await executor.query(`UPDATE avatar_profiles SET active_version_id=$1 WHERE id=$2`, [
    systemVersionId,
    systemProfileId,
  ]);
  await executor.execute(`ALTER TABLE avatar_profiles ENABLE TRIGGER USER`);
  await executor.query(
    `INSERT INTO avatar_profile_assets(id,account_id,workspace_id,profile_id,version_id,asset_id,
       role,binary_sha256,retention_state) VALUES
       ($1,$2,$3,$4,$5,$6,'ORIGINAL',$7,'RETAIN'),
       ($8,$2,$3,$4,$5,$9,'RUNTIME',$10,'RETAIN')`,
    [
      systemOriginalLinkId,
      SYSTEM_ACCOUNT_ID,
      SYSTEM_WORKSPACE_ID,
      systemProfileId,
      systemVersionId,
      systemOriginalAssetId,
      sha256("0081-system-original"),
      systemRuntimeLinkId,
      systemRuntimeAssetId,
      sourceSha256,
    ],
  );

  await executor.query(`SELECT set_config('videoforge.account_id',$1,false)`, [IDS.accountA]);
  let compatibilityState = driftAssessment ? "PASSED" : requestedCompatibilityState;
  let compatibilityAssessmentId = null;
  let compatibilityEvidenceHash = null;
  let compatibilityEvidence = null;
  if (["PASSED", "STALE", "CANCELLED", "FAILED"].includes(compatibilityState)) {
    const executionConfiguration = { provider: "runpod", model: "soulx" };
    const evidencePayload = { result: "passed" };
    compatibilityAssessmentId = assessmentId;
    compatibilityEvidenceHash = sha256("noncanonical-evidence-hash");
    compatibilityEvidence = {
      assessment_id: assessmentId,
      assessment_hash: driftAssessment
        ? sha256("drifted-config-assessment-hash")
        : compatibilityEvidenceHash,
      status: compatibilityState,
      model_profile_id: "serverless-soulx-flashhead-pro-v1",
      assessed_at: "2026-09-06T00:00:00Z",
    };
    await executor.query(
      `INSERT INTO execution_profiles(id,account_id,workspace_id,name,revision,lane,state,
         dispatch_target,configuration,configuration_hash,maximum_rate_micro_usd,checked_at,retired_at)
       VALUES($1,$2,$3,'serverless-soulx-flashhead-pro-v1',1,'AVATAR_PRIMARY',$5,
         'RUNPOD',$4::jsonb,'sha256:'||encode(sha256(convert_to(
           videoforge_canonical_jsonb($4::jsonb),'UTF8')),'hex'),1116000,
         '2026-09-06T00:00:00.000Z',CASE WHEN $5='RETIRED' THEN
           '2026-09-06T00:01:00.000Z'::timestamptz ELSE NULL END)`,
      [
        executionProfileId,
        IDS.accountA,
        IDS.workspaceA,
        JSON.stringify(executionConfiguration),
        executionProfileState,
      ],
    );
    await executor.query(
      `INSERT INTO avatar_compatibility_assessments(id,account_id,workspace_id,
         avatar_profile_version_id,execution_profile_id,state,evidence_contract_name,
         evidence_contract_version,evidence_payload,evidence_hash,model_snapshot_hash,
         reviewer_user_id,finished_at)
       VALUES($1,$2,$3,$4,$5,$6,'avatar-compatibility','v1',$7::jsonb,$8,$9,$10,
         '2026-09-06T00:00:00.000Z')`,
      [
        assessmentId,
        IDS.accountA,
        IDS.workspaceA,
        IDS.avatarVersionA,
        executionProfileId,
        compatibilityState,
        JSON.stringify(evidencePayload),
        compatibilityEvidenceHash,
        sha256("model-snapshot"),
        IDS.userA,
      ],
    );
  }
  const revisionConfig = {
    schema_version: "project-revision-config/v2",
    project_id: projectId,
    project_revision_id: revisionId,
    avatar_binding: {
      avatar_profile_id: IDS.avatarProfileA,
      avatar_profile_version_id: IDS.avatarVersionA,
      avatar_display_name_snapshot: "Owned Presenter",
      avatar_profile_hash: HASHES.avatarProfileA,
      runtime_source_asset_id: IDS.avatarRuntimeA,
      runtime_source_sha256: sourceSha256,
      source_preparation_version: "owned-preparation-v1",
      source_validation_profile_version: "owned-validation-v1",
      compatibility_state_at_preflight: compatibilityState,
      compatibility_evidence: compatibilityEvidence,
    },
    execution_profiles: {
      image_media_profile_id: "serverless-mage-image-v1",
      avatar_primary_profile_id: "serverless-soulx-flashhead-pro-v1",
      avatar_repair_profile_id: null,
      avatar_quality_profile_id: null,
    },
  };
  await executor.query(
    `INSERT INTO projects(id,account_id,workspace_id,owner_user_id,name,normalized_name,project_kind)
     VALUES($1,$2,$3,$4,'0081 Guard Project','0081 guard project','USER')`,
    [projectId, IDS.accountA, IDS.workspaceA, IDS.userA],
  );
  await executor.query(
    `INSERT INTO project_revisions(id,account_id,workspace_id,project_id,revision_number,status,
       title,voiceover_asset_id,voiceover_binary_sha256,avatar_profile_id,
       avatar_profile_version_id,avatar_profile_hash,avatar_runtime_source_asset_id,
       avatar_runtime_source_binary_sha256,avatar_source_preparation_profile,
       avatar_source_validation_profile,avatar_compatibility_state,
       avatar_compatibility_assessment_id,avatar_compatibility_evidence_hash,image_style_id,
       image_style_version_id,style_profile_hash,extra_prompt_keywords,apply_extra_prompt_keywords,
       generation_mode,maximum_cost_micro_usd,seed,revision_config_contract_name,
       revision_config_contract_version,revision_config_payload,revision_config_hash,
       created_by_user_id,locked_at)
     VALUES($1,$2,$3,$4,1,'LOCKED','0081 Guard Revision',$5,$6,$7,$8,$9,$10,$11,
       'owned-preparation-v1','owned-validation-v1',$12,$13,$14,$15,$16,$17,NULL,false,
       'LOWEST_COST',1000000,42,'project-revision-config','v2',$18::jsonb,
       'sha256:'||encode(sha256(convert_to(videoforge_canonical_jsonb($18::jsonb),'UTF8')),'hex'),
       $19,transaction_timestamp())`,
    [
      revisionId,
      IDS.accountA,
      IDS.workspaceA,
      projectId,
      IDS.voiceoverA,
      HASHES.voiceoverA,
      IDS.avatarProfileA,
      IDS.avatarVersionA,
      HASHES.avatarProfileA,
      IDS.avatarRuntimeA,
      sourceSha256,
      compatibilityState,
      compatibilityAssessmentId,
      compatibilityEvidenceHash,
      IDS.styleA,
      IDS.styleVersionA,
      HASHES.styleA,
      JSON.stringify(revisionConfig),
      IDS.userA,
    ],
  );
  await executor.query(
    `INSERT INTO generation_requests(id,account_id,workspace_id,project_id,project_revision_id,
       created_by_user_id,state,queue_order,available_at,attempt_ordinal,idempotency_key,admitted_at,
       created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'ACTIVE',1,transaction_timestamp(),1,
       '0081-avatar-guard',transaction_timestamp(),transaction_timestamp(),transaction_timestamp())`,
    [generationRequestId, IDS.accountA, IDS.workspaceA, projectId, revisionId, IDS.userA],
  );
  if (contentType !== "image/webp") {
    await executor.query(
      `SELECT public.videoforge_materialize_hosted_v209_system_avatar_reference($1,$2,$3,$4)`,
      [IDS.accountA, IDS.workspaceA, IDS.userA, projectId],
    );
  }
  return { projectId, revisionId, generationRequestId };
}

async function assertNoOrdinaryPaidBoundaryRows(executor) {
  const result = await executor.query(
    `SELECT
       (SELECT count(*)::integer FROM hosted_v209_ordinary_dispatch_candidates) candidates,
       (SELECT count(*)::integer FROM hosted_paid_dispatch_approvals) approvals,
       (SELECT count(*)::integer FROM hosted_paid_dispatch_claims) claims,
       (SELECT count(*)::integer FROM hosted_v209_short_admissions) admissions,
       (SELECT count(*)::integer FROM serverless_attempts) attempts,
       (SELECT count(*)::integer FROM serverless_cost_ledgers) cost_ledgers,
       (SELECT count(*)::integer FROM serverless_cost_events) cost_events,
       (SELECT count(*)::integer FROM hosted_dispatch_token_vault) token_vault,
       (SELECT count(*)::integer FROM hosted_v209_ordinary_lane_materializations) materializations,
       (SELECT count(*)::integer FROM serverless_predispatch_authorities) authorities,
       (SELECT count(*)::integer FROM serverless_dispatch_outbox) outbox`,
  );
  assert.deepEqual(result.rows, [
    {
      candidates: 0,
      approvals: 0,
      claims: 0,
      admissions: 0,
      attempts: 0,
      cost_ledgers: 0,
      cost_events: 0,
      token_vault: 0,
      materializations: 0,
      authorities: 0,
      outbox: 0,
    },
  ]);
}

const migrationUrl = new URL(
  "../migrations/0074_hosted_v209_ordinary_dispatch.sql",
  import.meta.url,
);
const ledgerRepairUrl = new URL(
  "../migrations/0081_hosted_v209_ordinary_avatar_predispatch_guard.sql",
  import.meta.url,
);
const fixturePredispatchUrl = new URL(
  "../migrations/0042_hosted_atomic_pair_predispatch.sql",
  import.meta.url,
);

test("0081 admits the exact qualified SYSTEM PNG through the predispatch avatar guard", async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    const fixture = await seedOrdinaryAvatarGuardFixture(executor);
    const guarded = await executor.query(
      `SELECT public.videoforge_assert_hosted_v209_ordinary_avatar_source($1,$2,$3) AS value`,
      [IDS.accountA, IDS.workspaceA, fixture.generationRequestId],
    );
    assert.equal(guarded.rows.length, 1);
    await assert.rejects(
      () =>
        executor.query(
          `SELECT public.videoforge_materialize_hosted_v209_ordinary_dispatch($1,$2,$3,$4)`,
          [IDS.accountA, IDS.workspaceA, IDS.userA, fixture.projectId],
        ),
      /hosted V2-09 ordinary lineage is not dispatch ready/u,
    );
    await assertNoOrdinaryPaidBoundaryRows(executor);
  });
});

for (const compatibilityState of ["RUNNING", "PASSED", "STALE", "CANCELLED"]) {
  test(`0081 accepts exact ${compatibilityState} compatibility parity`, async () => {
    await withPgcryptoMigratedDatabase(async ({ executor }) => {
      const fixture = await seedOrdinaryAvatarGuardFixture(executor, { compatibilityState });
      const guarded = await executor.query(
        `SELECT public.videoforge_assert_hosted_v209_ordinary_avatar_source($1,$2,$3) AS value`,
        [IDS.accountA, IDS.workspaceA, fixture.generationRequestId],
      );
      assert.equal(guarded.rows.length, 1);
      await assertNoOrdinaryPaidBoundaryRows(executor);
    });
  });
}

test("0081 accepts an exact STALE snapshot after its execution profile retires", async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    const fixture = await seedOrdinaryAvatarGuardFixture(executor, {
      compatibilityState: "STALE",
      executionProfileState: "RETIRED",
    });
    const guarded = await executor.query(
      `SELECT public.videoforge_assert_hosted_v209_ordinary_avatar_source($1,$2,$3) AS value`,
      [IDS.accountA, IDS.workspaceA, fixture.generationRequestId],
    );
    assert.equal(guarded.rows.length, 1);
    await assertNoOrdinaryPaidBoundaryRows(executor);
  });
});

test("0081 rejects FAILED compatibility directly at the avatar guard", async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    const fixture = await seedOrdinaryAvatarGuardFixture(executor, {
      compatibilityState: "FAILED",
    });
    await assert.rejects(
      () =>
        executor.query(
          `SELECT public.videoforge_assert_hosted_v209_ordinary_avatar_source($1,$2,$3)`,
          [IDS.accountA, IDS.workspaceA, fixture.generationRequestId],
        ),
      /known incompatible with SoulX/u,
    );
    await assertNoOrdinaryPaidBoundaryRows(executor);
  });
});

test("0081 rejects a real config-to-assessment hash mismatch at the avatar guard", async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    const fixture = await seedOrdinaryAvatarGuardFixture(executor, { driftAssessment: true });
    await assert.rejects(
      () =>
        executor.query(
          `SELECT public.videoforge_assert_hosted_v209_ordinary_avatar_source($1,$2,$3)`,
          [IDS.accountA, IDS.workspaceA, fixture.generationRequestId],
        ),
      /terminal avatar compatibility evidence drifted/u,
    );
    await assertNoOrdinaryPaidBoundaryRows(executor);
  });
});

for (const [label, source] of [
  ["wrong SHA-256", { sourceSha256: sha256("wrong-ordinary-avatar") }],
  ["JPEG bytes", { contentType: "image/jpeg" }],
  ["WEBP bytes", { contentType: "image/webp" }],
]) {
  test(`0081 rejects ${label} before candidate, approval, attempt, authority, or outbox`, async () => {
    await withPgcryptoMigratedDatabase(async ({ executor }) => {
      const fixture = await seedOrdinaryAvatarGuardFixture(executor, source);
      await expectDatabaseError(
        () =>
          executor.query(
            `SELECT public.videoforge_materialize_hosted_v209_ordinary_dispatch($1,$2,$3,$4)`,
            [IDS.accountA, IDS.workspaceA, IDS.userA, fixture.projectId],
          ),
        "23514",
      );
      await assertNoOrdinaryPaidBoundaryRows(executor);
    });
  });
}

test("0074 installs the additive ordinary V2-09 DB boundaries without weakening 0042", async () => {
  await withPgcryptoMigratedDatabase(async ({ executor, sources }) => {
    assert.ok(
      sources.some(({ filename }) => filename === "0074_hosted_v209_ordinary_dispatch.sql"),
    );
    const routines = await executor.query(
      `SELECT p.oid::regprocedure::text AS signature, p.prosecdef AS security_definer,
              pg_get_functiondef(p.oid) AS definition,
              has_function_privilege('public',p.oid,'EXECUTE') AS public_execute
         FROM pg_catalog.pg_proc p
         JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname=ANY($1::text[])
        ORDER BY p.proname`,
      [
        [
          "videoforge_commit_hosted_v209_ordinary_pair",
          "videoforge_begin_hosted_v209_ordinary_send",
          "videoforge_commit_hosted_v209_ordinary_lane_materialization",
          "videoforge_import_hosted_v209_qualified_activation",
          "videoforge_load_hosted_gpu_activation_v2",
          "videoforge_load_hosted_pair_activation_v2",
          "videoforge_load_hosted_v209_ordinary_lane_materialization",
          "videoforge_materialize_hosted_v209_ordinary_dispatch",
        ],
      ],
    );
    assert.equal(routines.rows.length, 8);
    assert.ok(routines.rows.every((row) => row.security_definer === true));
    assert.ok(routines.rows.every((row) => row.public_execute === false));
    const privateAvatarFunctions = await executor.query(
      `SELECT p.proname,has_function_privilege('public',p.oid,'EXECUTE') AS public_execute
         FROM pg_catalog.pg_proc p
         JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname=ANY($1::text[])
        ORDER BY p.proname`,
      [
        [
          "videoforge_assert_hosted_v209_ordinary_avatar_source",
          "videoforge_v209_ordinary_materialize_legacy_0081",
          "videoforge_v209_ordinary_pair_legacy_0081",
          "videoforge_v209_ordinary_load_lane_legacy_0081",
          "videoforge_v209_ordinary_commit_lane_legacy_0081",
          "videoforge_v209_ordinary_begin_send_legacy_0081",
          "videoforge_load_hosted_gpu_activation_v2_head0081",
        ],
      ],
    );
    assert.equal(privateAvatarFunctions.rows.length, 7);
    assert.ok(privateAvatarFunctions.rows.every((row) => row.public_execute === false));
    const activationLoaders = routines.rows.filter(
      (row) =>
        row.signature.startsWith("videoforge_load_hosted_gpu_activation_v2(") ||
        row.signature.startsWith("videoforge_load_hosted_pair_activation_v2("),
    );
    assert.equal(activationLoaders.length, 2);
    assert.ok(activationLoaders.every((row) => /version BETWEEN 37 AND 84/u.test(row.definition)));

    const policies = await executor.query(
      `SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,count(policy.polname)::integer AS policies
         FROM pg_catalog.pg_class c
         JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
         LEFT JOIN pg_catalog.pg_policy policy ON policy.polrelid=c.oid
        WHERE n.nspname='public' AND c.relname=ANY($1::text[])
        GROUP BY c.relname,c.relrowsecurity,c.relforcerowsecurity ORDER BY c.relname`,
      [
        [
          "hosted_v209_ordinary_dispatch_candidates",
          "hosted_v209_ordinary_lane_materializations",
          "hosted_v209_qualified_activations",
        ],
      ],
    );
    assert.deepEqual(
      policies.rows.map((row) => [
        row.relname,
        row.relrowsecurity,
        row.relforcerowsecurity,
        row.policies,
      ]),
      [
        ["hosted_v209_ordinary_dispatch_candidates", true, true, 1],
        ["hosted_v209_ordinary_lane_materializations", true, true, 1],
        ["hosted_v209_qualified_activations", false, false, 0],
      ],
    );
  });

  const fixtureSource = await readFile(fixturePredispatchUrl, "utf8");
  assert.equal(
    sha256(fixtureSource),
    "sha256:d7168a4143a813df7b9114f76f1efe71aa287bec4b1f137ab414a98e65e6b967",
  );
});

test("0074 derives deterministic UUIDs and fails closed without tenant-owned current lineage", async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    const generationRequestId = uuid(74001);
    const first = await executor.query(
      `SELECT public.videoforge_hosted_v209_uuid('candidate',$1::uuid,'ordinary') AS id`,
      [generationRequestId],
    );
    const replay = await executor.query(
      `SELECT public.videoforge_hosted_v209_uuid('candidate',$1::uuid,'ordinary') AS id`,
      [generationRequestId],
    );
    assert.match(first.rows[0].id, /^[0-9a-f-]{36}$/u);
    assert.equal(first.rows[0].id, replay.rows[0].id);
    await expectDatabaseError(
      () =>
        executor.query(
          `SELECT public.videoforge_materialize_hosted_v209_ordinary_dispatch(
             $1::uuid,$2::uuid,$3::uuid,$4::uuid)`,
          [uuid(74002), uuid(74003), uuid(74004), uuid(74005)],
        ),
      "42501",
    );
    await expectDatabaseError(
      () => executor.query(`SELECT public.videoforge_load_hosted_gpu_activation_v2()`),
      "42501",
    );
  });
});

test("0074 pins frozen Stage 6/7 artifacts without requiring nonexistent historical receipts", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  for (const pinned of [
    "sha256:aeef45f237fd07e0937cdd51eaaf545ac0d8bb4c90eb105708f1681da787cc79",
    "sha256:aec6b4eca1b51db5b1742e806d28a26c32359a1ddecb615afae1a834dbdf15aa",
    "sha256:0f3203ceaedd8d570dcca301e32ca6d0ecb4d1136c32d5cd7d76fdc292a030cb",
    "sha256:f3b1d1414308d0783fe006d33e6482c027e05b6029a07843af66e4a9e1c1380e",
    "sha256:eca6cfe6acec62ed63ec1f7c9d40e7fb14e908c6e594da3864f936fa53670704",
    "sha256:9929d19da89ab2c20e280ac45ad152bc325b8bf56ef1e9c21e83d473c3408bc4",
  ]) {
    assert.match(sql, new RegExp(pinned.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  }
  assert.doesNotMatch(sql, /videoforge_verify_v213_qualification_receipt/u);
  const ledgerRepair = await readFile(ledgerRepairUrl, "utf8");
  assert.equal((ledgerRepair.match(/version BETWEEN 37 AND 81/gu) ?? []).length, 2);
  assert.match(
    ledgerRepair,
    /REVOKE ALL ON FUNCTION public\.videoforge_load_hosted_pair_activation_v2\(uuid,uuid,uuid\) FROM PUBLIC/u,
  );
  assert.match(
    ledgerRepair,
    /REVOKE ALL ON FUNCTION public\.videoforge_load_hosted_gpu_activation_v2\(\) FROM PUBLIC/u,
  );
  assert.match(sql, /videoforge-hosted-qualified-gpu-activation-verifier-v1/u);
  assert.match(sql, /'enabledConfigSha256',activation\.deployed_config_sha256/u);
  assert.match(sql, /a\.state='MATERIALIZED'/u);
  assert.match(sql, /audio\.kind='AUDIO_SPAN'/u);
  assert.match(sql, /span_row\.span_content_type<>'audio\/wav'/u);
  assert.match(sql, /span_row\.span_sample_rate_hz IS DISTINCT FROM 48000/u);
  assert.match(sql, /'spanAudioSampleRateHz',span_row\.span_sample_rate_hz/u);
  assert.match(sql, /'paddedSamples48k',span_row\.padded_samples_48k/u);
  assert.match(sql, /'trimStartSample48k',span_row\.trim_start_sample_48k/u);
  assert.match(sql, /span_row\.trim_start_sample_48k%1920<>0/u);
  assert.match(sql, /\(task_row\.end_frame_exclusive-task_row\.start_frame\)\*1920/u);
  assert.match(sql, /'avatarSourceInputReservationId',avatar_input_id/u);
  assert.match(sql, /'spanAudioInputReservationId',input_id/u);
  assert.match(sql, /'avatarSourceInputReservationId',avatar_input_id/u);
  assert.match(sql, /CREATE TABLE public\.hosted_v209_ordinary_lane_materializations/u);
  assert.match(sql, /target\.attempt_state<>'PLANNED' OR target\.outbox_state IS NOT NULL/u);
  assert.match(sql, /supplied_request_body_sha256<>computed_request_sha/u);
  assert.match(sql, /supplied_expected_envelope_sha256<>computed_envelope_sha/u);
  assert.match(
    sql,
    /batch\.input_manifest_sha256,supplied_request_body_sha256,supplied_expected_envelope_sha256/u,
  );
  assert.match(sql, /authority_hash,supplied_request_body_sha256,/u);
  assert.match(sql, /supplied_lane='mage_image' AND deployment\.request_ttl_seconds<>7200/u);
  assert.match(sql, /supplied_lane='soulx_avatar' AND deployment\.request_ttl_seconds<>3600/u);
  assert.match(sql, /target\.deadline_at<>target\.attempt_created_at\+/u);
  assert.match(sql, /ARRAY\['inputs','outputs'\]::text\[\]/u);
  assert.match(sql, /ARRAY\['inputs'\]::text\[\]/u);
  assert.match(
    sql,
    /IF lane_name='mage_image' THEN[\s\S]*jsonb_agg\(value->>'output_reservation_id' ORDER BY ordinal\)[\s\S]*INTO worker_reservation_ids/u,
  );
  assert.match(
    sql,
    /worker_reservation_ids:=jsonb_build_array\(avatar_input_id\)\|\|[\s\S]*value->>'input_reservation_id'[\s\S]*\|\|[\s\S]*value->>'output_reservation_id'/u,
  );
  assert.match(sql, /'worker_transfer_port_reservation_ids',worker_reservation_ids/u);
  assert.match(
    sql,
    /'\{artifacts,transfer_port_reservation_ids\}',target\.worker_reservation_ids,false/u,
  );
  assert.match(sql, /'\{limits,issued_at\}'/u);
  assert.match(sql, /'\{limits,expires_at\}'/u);
  assert.match(sql, /'baseEnvelopeTemplateSha256',finalized_envelope_sha/u);
  assert.doesNotMatch(sql, /'unsignedEnvelopeTemplateSha256',finalized_envelope_sha/u);
  assert.match(sql, /public\.videoforge_canonical_jsonb\(supplied_request_body->'batch'\)/u);
  assert.match(
    sql,
    /supplied_request_body->'envelope'->'work'->>'items_manifest_sha256'<>computed_batch_sha/u,
  );
  assert.match(
    sql,
    /supplied_request_body->'envelope'->'artifacts'->>'plan_manifest_sha256'<>computed_batch_sha/u,
  );
});

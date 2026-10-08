import assert from "node:assert/strict";
import test from "node:test";

import { sha256, uuid, withPgcryptoMigratedDatabase } from "./support/pglite.mjs";

async function admit(executor, serial, email) {
  const rawCode = `voiceover-library-invite-${serial}`;
  const userId = `voiceover-library-user-${String(serial).padStart(4, "0")}`;
  const authAccountId = `voiceover-library-google-${String(serial).padStart(4, "0")}`;
  const sessionId = `voiceover-library-session-${String(serial).padStart(4, "0")}`;
  const token = `voiceover-library-token-${String(serial).padStart(32, "0")}`;
  await executor.query(
    `INSERT INTO invite_codes(
       id,verifier_sha256,intended_normalized_email,state,expires_at,created_at
     ) VALUES(gen_random_uuid(),$1,$2,'ACTIVE',now()+interval '1 day',now())`,
    [sha256(rawCode), email],
  );
  await executor.query(
    `INSERT INTO hosted_auth_users(id,name,email,email_verified,created_at,updated_at)
     VALUES($1,$2,$3,true,now(),now())`,
    [userId, `Voiceover User ${serial}`, email],
  );
  await executor.query(
    `INSERT INTO hosted_auth_accounts(
       id,provider_account_id,provider_id,user_id,created_at,updated_at
     ) VALUES($1,$1,'google',$2,now(),now())`,
    [authAccountId, userId],
  );
  await executor.query(
    `INSERT INTO hosted_auth_sessions(id,expires_at,token,created_at,updated_at,user_id)
     VALUES($1,now()+interval '1 hour',$2,now(),now(),$3)`,
    [sessionId, token, userId],
  );
  const outcome = (
    await executor.query("SELECT outcome FROM videoforge_redeem_hosted_invite($1,$2)", [
      token,
      sha256(rawCode),
    ])
  ).rows[0]?.outcome;
  assert.equal(outcome, "ADMITTED");
  const scope = (
    await executor.query(
      `SELECT user_id,account_id,workspace_id,normalized_email
         FROM videoforge_hosted_session_scope($1)`,
      [token],
    )
  ).rows[0];
  assert.ok(scope, `admitted scope missing for ${email}`);
  return { ...scope, token };
}

async function tenantCall(executor, functionName, args) {
  const placeholders = args.map((_, index) => `$${index + 1}`).join(",");
  const sql = `WITH bound AS (
    SELECT set_config('videoforge.account_id',($1::uuid)::text,true)
  ) SELECT public.${functionName}(${placeholders}) AS value FROM bound`;
  return (await executor.query(sql, args)).rows[0]?.value;
}

async function tokenCall(executor, functionName, args) {
  const placeholders = args.map((_, index) => `$${index + 1}`).join(",");
  return (await executor.query(`SELECT public.${functionName}(${placeholders}) AS value`, args))
    .rows[0]?.value;
}

test("saved voice collections share only active users' emails and selected voice IDs and preserve private writes", async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    const a = await admit(executor, 801, "voice-a@example.test");
    const b = await admit(executor, 802, "voice-b@example.test");
    const save = (identity, id, saved) =>
      tenantCall(executor, "videoforge_save_voice", [
        identity.account_id,
        identity.workspace_id,
        id,
        saved,
        saved,
      ]);
    const read = (identity) =>
      tenantCall(executor, "videoforge_shared_saved_voice_collections", [
        identity.account_id,
        identity.workspace_id,
      ]);
    await save(a, "shared-a", true);
    await save(b, "shared-b", true);
    await tenantCall(executor, "videoforge_import_voice", [
      a.account_id,
      a.workspace_id,
      "hidden-import",
    ]);
    await save(a, "hidden-import", false);
    const result = await read(b);
    assert.equal(result.length, 2);
    assert.equal(result.find((item) => item.id === a.account_id).email, "voice-a@example.test");
    assert.equal(result.find((item) => item.id === b.account_id).email, "voice-b@example.test");
    assert.deepEqual(result.find((item) => item.id === a.account_id).voice_ids, ["shared-a"]);
    assert.equal(result.find((item) => item.id === b.account_id).is_current_user, true);
    assert.deepEqual(Object.keys(result[0]).sort(), [
      "email",
      "id",
      "is_current_user",
      "name",
      "voice_ids",
    ]);
    await save(b, "shared-a", true);
    await save(a, "shared-a", false);
    assert.deepEqual((await read(b)).find((item) => item.id === b.account_id).voice_ids, [
      "shared-a",
      "shared-b",
    ]);
    assert.deepEqual(
      await tenantCall(executor, "videoforge_saved_voices", [a.account_id, a.workspace_id]),
      [{ voice_id: "hidden-import", imported: true, saved: false, starred: false }],
    );
    await assert.rejects(
      executor.query("SELECT videoforge_shared_saved_voice_collections($1,$2)", [
        a.account_id,
        a.workspace_id,
      ]),
      /voiceover tenant scope invalid/,
    );
    await executor.query(
      "INSERT INTO hosted_access_revocations(hosted_auth_user_id,revoked_by) VALUES($1,$1)",
      ["voiceover-library-user-0801"],
    );
    assert.deepEqual(
      (await read(b)).map((item) => item.id),
      [b.account_id],
    );
    await assert.rejects(read(a), /voiceover tenant scope invalid/);
    const grants = (
      await executor.query(
        "SELECT has_function_privilege('videoforge_v209_runtime_dc9612d6','videoforge_shared_saved_voice_collections(uuid,uuid)','EXECUTE') AS allowed",
      )
    ).rows[0];
    assert.equal(grants.allowed, true);
  });
});

test("avatar collections expose ready previews only and retain owner-only archival and raw-table isolation", async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    const a = await admit(executor, 811, "avatar-a@example.test");
    const b = await admit(executor, 812, "avatar-b@example.test");
    const c = await admit(executor, 813, "avatar-empty@example.test");
    const profileId = uuid(88101),
      versionId = uuid(88102),
      assetId = uuid(88103);
    const objectKey = `tenant/${a.account_id}/workspace/${a.workspace_id}/avatar-profile/${profileId}/version/${versionId}/original/source`;
    await executor.query("SELECT set_config('videoforge.account_id',$1,false)", [a.account_id]);
    await executor.query(
      `INSERT INTO assets(id,account_id,workspace_id,kind,state,object_key,binary_sha256,content_type,byte_size,verified_at)
      VALUES($1,$2,$3,'AVATAR_ORIGINAL','VERIFIED',$4,$5,'image/webp',2048,now())`,
      [assetId, a.account_id, a.workspace_id, objectKey, sha256("shared-avatar-source")],
    );
    await executor.query(
      `INSERT INTO avatar_profiles(id,account_id,workspace_id,name,normalized_name,created_by_user_id)
      VALUES($1,$2,$3,'Shared presenter','shared presenter',$4)`,
      [profileId, a.account_id, a.workspace_id, a.user_id],
    );
    await executor.query(
      `INSERT INTO avatar_profile_versions(id,account_id,workspace_id,profile_id,version_number,state,
      profile_contract_name,profile_contract_version,profile_payload,profile_hash,original_asset_id,runtime_source_asset_id,
      runtime_source_binary_sha256,source_preparation_profile,source_validation_profile,rights_attested_by_user_id,
      likeness_attested_by_user_id,ready_at) VALUES($1,$2,$3,$4,1,'READY','avatar-profile-version','v1',
      '{"source":"shared-avatar-fixture"}',$5,$6,$6,$7,'hosted-avatar-source-pass-through-v1','owned-validation-v1',$8,$8,now())`,
      [
        versionId,
        a.account_id,
        a.workspace_id,
        profileId,
        sha256("shared-avatar-profile"),
        assetId,
        sha256("shared-avatar-source"),
        a.user_id,
      ],
    );
    await executor.query("UPDATE avatar_profiles SET active_version_id=$1 WHERE id=$2", [
      versionId,
      profileId,
    ]);
    await executor.query(
      `INSERT INTO avatar_profile_assets(id,account_id,workspace_id,profile_id,version_id,asset_id,role,binary_sha256)
       VALUES($1,$2,$3,$4,$5,$6,'ORIGINAL',$7)`,
      [
        uuid(88104),
        a.account_id,
        a.workspace_id,
        profileId,
        versionId,
        assetId,
        sha256("shared-avatar-source"),
      ],
    );
    const read = (identity) =>
      tenantCall(executor, "videoforge_shared_avatar_collections", [
        identity.account_id,
        identity.workspace_id,
      ]);
    const preview = async (identity, target = versionId) =>
      (
        await executor.query(
          `WITH bound AS (
      SELECT set_config('videoforge.account_id',$1,true)
    ) SELECT p.* FROM bound CROSS JOIN LATERAL videoforge_shared_avatar_preview($1::uuid,$2::uuid,$3::uuid) p`,
          [identity.account_id, identity.workspace_id, target],
        )
      ).rows;
    const source = (identity, target = versionId) =>
      tenantCall(executor, "videoforge_shared_avatar_source", [
        identity.account_id,
        identity.workspace_id,
        target,
      ]);
    const originalSnapshot = (
      await executor.query(
        "SELECT to_jsonb(v) AS value FROM avatar_profile_versions v WHERE id=$1",
        [versionId],
      )
    ).rows[0].value;
    const selectedSource = await source(b);
    assert.equal(selectedSource.account_id, a.account_id);
    assert.equal(selectedSource.profile_id, profileId);
    assert.equal(selectedSource.version_id, versionId);
    assert.equal(selectedSource.profile_hash, sha256("shared-avatar-profile"));
    assert.equal(selectedSource.rights_attested_by_user_id, a.user_id);
    assert.equal(selectedSource.likeness_attested_by_user_id, a.user_id);
    assert.deepEqual(selectedSource.original, selectedSource.runtime);
    assert.deepEqual(selectedSource.runtime, {
      id: assetId,
      object_key: objectKey,
      binary_sha256: sha256("shared-avatar-source"),
      content_type: "image/webp",
      byte_size: 2048,
      width_px: null,
      height_px: null,
    });
    assert.equal(await source(b, uuid(88999)), null);
    const draftVersionId = uuid(88105);
    await executor.query(
      "INSERT INTO avatar_profile_versions(id,account_id,workspace_id,profile_id,version_number,state) VALUES($1,$2,$3,$4,2,'DRAFT')",
      [draftVersionId, a.account_id, a.workspace_id, profileId],
    );
    assert.equal(await source(b, draftVersionId), null);
    await assert.rejects(
      tenantCall(executor, "videoforge_shared_avatar_source", [
        a.account_id,
        b.workspace_id,
        versionId,
      ]),
      /tenant scope invalid/,
    );
    await assert.rejects(
      executor.query(
        `WITH bound AS (SELECT set_config('videoforge.account_id',$1,true))
       SELECT videoforge_shared_avatar_source($2,$3,$4) FROM bound`,
        [b.account_id, a.account_id, a.workspace_id, versionId],
      ),
      /tenant scope invalid/,
    );
    await executor.query("SELECT set_config('videoforge.account_id','',false)");
    await assert.rejects(
      executor.query("SELECT videoforge_shared_avatar_source($1,$2,$3)", [
        b.account_id,
        b.workspace_id,
        versionId,
      ]),
      /tenant scope invalid/,
    );
    await executor.query("SELECT set_config('videoforge.account_id',$1,false)", [a.account_id]);
    for (const [column, invalid, valid] of [
      ["state", "UPLOADING", "VERIFIED"],
      ["content_type", "video/mp4", "image/webp"],
      ["byte_size", 20971521, 2048],
      ["binary_sha256", sha256("different-source"), sha256("shared-avatar-source")],
      [
        "object_key",
        `tenant/${b.account_id}/workspace/${b.workspace_id}/avatar-profile/${profileId}/version/${versionId}/original/source`,
        objectKey,
      ],
    ]) {
      await executor.query(`UPDATE assets SET ${column}=$1 WHERE id=$2`, [invalid, assetId]);
      assert.equal(await source(b), null, `invalid ${column} cannot expose a shared source`);
      await executor.query("SELECT set_config('videoforge.account_id',$1,false)", [a.account_id]);
      await executor.query(`UPDATE assets SET ${column}=$1 WHERE id=$2`, [valid, assetId]);
    }
    await executor.query(
      "UPDATE avatar_profile_assets SET retention_state='DELETE_REQUESTED' WHERE version_id=$1",
      [versionId],
    );
    assert.equal(await source(b), null);
    await executor.query("SELECT set_config('videoforge.account_id',$1,false)", [a.account_id]);
    await executor.query(
      "UPDATE avatar_profile_assets SET retention_state='RETAIN' WHERE version_id=$1",
      [versionId],
    );
    assert.deepEqual(await source(b), selectedSource);
    const canonicalVersionId = uuid(88106),
      canonicalOriginalId = uuid(88107),
      canonicalRuntimeId = uuid(88108);
    await executor.query(
      `INSERT INTO assets(id,account_id,workspace_id,kind,state,object_key,binary_sha256,content_type,byte_size,verified_at)
       SELECT $1,account_id,workspace_id,'AVATAR_ORIGINAL',state,replace(object_key,$2,$3),binary_sha256,content_type,byte_size,verified_at
       FROM assets WHERE id=$4`,
      [canonicalOriginalId, versionId, canonicalVersionId, assetId],
    );
    await executor.query(
      `INSERT INTO assets(id,account_id,workspace_id,kind,state,object_key,binary_sha256,content_type,byte_size,verified_at)
       SELECT $1,account_id,workspace_id,'AVATAR_RUNTIME',state,replace(object_key,'original/source','canonical/avatar.webp'),
              binary_sha256,content_type,byte_size,verified_at FROM assets WHERE id=$2`,
      [canonicalRuntimeId, canonicalOriginalId],
    );
    await executor.query(
      `INSERT INTO avatar_profile_versions(id,account_id,workspace_id,profile_id,version_number,state,
       profile_contract_name,profile_contract_version,profile_payload,profile_hash,original_asset_id,runtime_source_asset_id,
       runtime_source_binary_sha256,source_preparation_profile,source_validation_profile,rights_attested_by_user_id,
       likeness_attested_by_user_id,ready_at)
       SELECT $1,account_id,workspace_id,profile_id,3,state,profile_contract_name,profile_contract_version,profile_payload,$2,$3,$4,
       runtime_source_binary_sha256,source_preparation_profile,source_validation_profile,rights_attested_by_user_id,
       likeness_attested_by_user_id,ready_at FROM avatar_profile_versions WHERE id=$5`,
      [
        canonicalVersionId,
        sha256("canonical-avatar-profile"),
        canonicalOriginalId,
        canonicalRuntimeId,
        versionId,
      ],
    );
    await executor.query(
      `INSERT INTO avatar_profile_assets(id,account_id,workspace_id,profile_id,version_id,asset_id,role,binary_sha256)
       VALUES($1,$2,$3,$4,$5,$6,'ORIGINAL',$7)`,
      [
        uuid(88109),
        a.account_id,
        a.workspace_id,
        profileId,
        canonicalVersionId,
        canonicalOriginalId,
        sha256("shared-avatar-source"),
      ],
    );
    assert.equal(
      await source(b, canonicalVersionId),
      null,
      "distinct runtime requires its retained link",
    );
    await executor.query("SELECT set_config('videoforge.account_id',$1,false)", [a.account_id]);
    await executor.query(
      `INSERT INTO avatar_profile_assets(id,account_id,workspace_id,profile_id,version_id,asset_id,role,binary_sha256)
       VALUES($1,$2,$3,$4,$5,$6,'RUNTIME',$7)`,
      [
        uuid(88110),
        a.account_id,
        a.workspace_id,
        profileId,
        canonicalVersionId,
        canonicalRuntimeId,
        sha256("shared-avatar-source"),
      ],
    );
    assert.equal((await source(b, canonicalVersionId)).runtime.id, canonicalRuntimeId);
    await executor.query("UPDATE avatar_profile_assets SET binary_sha256=$1 WHERE id=$2", [
      sha256("wrong-runtime-link"),
      uuid(88110),
    ]);
    assert.equal(await source(b, canonicalVersionId), null, "runtime link checksum is pinned");
    await executor.query("SELECT set_config('videoforge.account_id',$1,false)", [a.account_id]);
    await executor.query("UPDATE avatar_profile_assets SET binary_sha256=$1 WHERE id=$2", [
      sha256("shared-avatar-source"),
      uuid(88110),
    ]);
    const systemAccount = "ffffffff-ffff-4fff-8fff-000000000001",
      systemWorkspace = "ffffffff-ffff-4fff-8fff-000000000011",
      systemUser = "ffffffff-ffff-4fff-8fff-000000000021",
      systemProfile = uuid(88201),
      systemVersion = uuid(88202),
      systemOriginal = uuid(88203),
      systemRuntime = uuid(88204);
    const systemPrefix = `tenant/${systemAccount}/workspace/${systemWorkspace}/avatar-profile/${systemProfile}/version/${systemVersion}/`;
    await executor.query("SELECT set_config('videoforge.account_id',$1,false)", [systemAccount]);
    await executor.query(
      `INSERT INTO assets(id,account_id,workspace_id,kind,state,object_key,binary_sha256,content_type,byte_size,verified_at)
       SELECT CASE WHEN id=$1 THEN $2::uuid ELSE $3::uuid END,$4,$5,kind,state,
         $6||CASE kind WHEN 'AVATAR_ORIGINAL' THEN 'original/source' ELSE 'canonical/avatar.webp' END,
         binary_sha256,content_type,byte_size,verified_at FROM assets WHERE id=ANY($7::uuid[])`,
      [
        canonicalOriginalId,
        systemOriginal,
        systemRuntime,
        systemAccount,
        systemWorkspace,
        systemPrefix,
        [canonicalOriginalId, canonicalRuntimeId],
      ],
    );
    await executor.query(
      "INSERT INTO avatar_profiles(id,account_id,workspace_id,name,normalized_name,created_by_user_id,scope_kind) VALUES($1,$2,$3,'Immutable built-in','immutable built-in',$4,'SYSTEM')",
      [systemProfile, systemAccount, systemWorkspace, systemUser],
    );
    await executor.query(
      `INSERT INTO avatar_profile_versions(id,account_id,workspace_id,profile_id,version_number,state,scope_kind,
       profile_contract_name,profile_contract_version,profile_payload,profile_hash,original_asset_id,runtime_source_asset_id,
       runtime_source_binary_sha256,source_preparation_profile,source_validation_profile,rights_attested_by_user_id,
       likeness_attested_by_user_id,ready_at)
       SELECT $1,$2,$3,$4,1,state,'SYSTEM',profile_contract_name,profile_contract_version,profile_payload,profile_hash,$5,$6,
         runtime_source_binary_sha256,source_preparation_profile,source_validation_profile,$7,$7,ready_at
       FROM avatar_profile_versions WHERE id=$8`,
      [
        systemVersion,
        systemAccount,
        systemWorkspace,
        systemProfile,
        systemOriginal,
        systemRuntime,
        systemUser,
        canonicalVersionId,
      ],
    );
    await executor.execute(
      "ALTER TABLE avatar_profiles DISABLE TRIGGER avatar_profiles_system_immutable",
    );
    await executor.query("UPDATE avatar_profiles SET active_version_id=$1 WHERE id=$2", [
      systemVersion,
      systemProfile,
    ]);
    await executor.execute(
      "ALTER TABLE avatar_profiles ENABLE TRIGGER avatar_profiles_system_immutable",
    );
    await executor.query(
      `INSERT INTO avatar_profile_assets(id,account_id,workspace_id,profile_id,version_id,asset_id,role,binary_sha256)
       SELECT gen_random_uuid(),account_id,workspace_id,$1,$2,id,
         CASE kind WHEN 'AVATAR_ORIGINAL' THEN 'ORIGINAL' ELSE 'RUNTIME' END,binary_sha256
       FROM assets WHERE id=ANY($3::uuid[])`,
      [systemProfile, systemVersion, [systemOriginal, systemRuntime]],
    );
    await executor.query("SELECT set_config('videoforge.account_id',$1,false)", [a.account_id]);
    await executor.query(
      `UPDATE assets SET object_key=$1||CASE kind WHEN 'AVATAR_ORIGINAL' THEN 'original/source' ELSE 'canonical/avatar.webp' END,
       metadata=jsonb_build_object('system_source_scope','SYSTEM','materialization','hosted-system-preset-snapshot-v1',
         'system_source_asset_id',CASE kind WHEN 'AVATAR_ORIGINAL' THEN $2 ELSE $3 END)
       WHERE id=ANY($4::uuid[])`,
      [systemPrefix, systemOriginal, systemRuntime, [canonicalOriginalId, canonicalRuntimeId]],
    );
    assert.equal(
      (await source(b, canonicalVersionId)).runtime.object_key,
      `${systemPrefix}canonical/avatar.webp`,
    );
    await executor.query(
      "UPDATE assets SET metadata=metadata||jsonb_build_object('system_source_asset_id',$1::text) WHERE id=$2",
      [assetId, canonicalRuntimeId],
    );
    assert.equal(
      await source(b, canonicalVersionId),
      null,
      "SYSTEM metadata cannot authorize an ordinary foreign asset",
    );
    await executor.query("SELECT set_config('videoforge.account_id',$1,false)", [a.account_id]);
    await executor.query(
      "UPDATE assets SET metadata=metadata||jsonb_build_object('system_source_asset_id',$1::text) WHERE id=$2",
      [systemRuntime, canonicalRuntimeId],
    );
    await executor.query("SELECT set_config('videoforge.account_id',$1,false)", [systemAccount]);
    await executor.query(
      "UPDATE avatar_profile_assets SET retention_state='DELETE_REQUESTED' WHERE asset_id=$1",
      [systemRuntime],
    );
    assert.equal(
      await source(b, canonicalVersionId),
      null,
      "SYSTEM source still requires retained immutable links",
    );
    await executor.query("SELECT set_config('videoforge.account_id',$1,false)", [systemAccount]);
    await executor.query(
      "UPDATE avatar_profile_assets SET retention_state='RETAIN' WHERE asset_id=$1",
      [systemRuntime],
    );
    assert.equal((await source(b, canonicalVersionId)).runtime.id, canonicalRuntimeId);
    const copyAssetId = uuid(88111),
      copyProfileId = uuid(88112),
      copyVersionId = uuid(88113);
    await executor.query("SELECT set_config('videoforge.account_id',$1,false)", [b.account_id]);
    await executor.query(
      `INSERT INTO assets(id,account_id,workspace_id,kind,state,object_key,binary_sha256,content_type,byte_size)
       VALUES($1,$2,$3,'AVATAR_ORIGINAL','UPLOADING',$4,$5,'image/webp',2048)`,
      [
        copyAssetId,
        b.account_id,
        b.workspace_id,
        `tenant/${b.account_id}/workspace/${b.workspace_id}/avatar-profile/${copyProfileId}/version/${copyVersionId}/original/source`,
        sha256("shared-avatar-source"),
      ],
    );
    await executor.query(
      "INSERT INTO avatar_profiles(id,account_id,workspace_id,name,normalized_name,created_by_user_id) VALUES($1,$2,$3,'Private copy','private copy',$4)",
      [copyProfileId, b.account_id, b.workspace_id, b.user_id],
    );
    await executor.query(
      "INSERT INTO avatar_profile_versions(id,account_id,workspace_id,profile_id,version_number,state,original_asset_id) VALUES($1,$2,$3,$4,1,'DRAFT',$5)",
      [copyVersionId, b.account_id, b.workspace_id, copyProfileId, copyAssetId],
    );
    // Emulate the existing runtime table grants provisioned outside the migration chain.
    await executor.execute(
      "GRANT SELECT ON assets,avatar_profiles,avatar_profile_versions,workspaces TO videoforge_v209_runtime_dc9612d6",
    );
    await executor.execute("GRANT UPDATE ON assets TO videoforge_v209_runtime_dc9612d6");
    const provenance = {
      shared_source_version_id: versionId,
      shared_source_profile_hash: selectedSource.profile_hash,
      shared_source_runtime_sha256: selectedSource.runtime.binary_sha256,
      shared_source_account_id: a.account_id,
      shared_source_rights_attested_by_user_id: a.user_id,
      shared_source_likeness_attested_by_user_id: a.user_id,
      shared_use_accepted_by_user_id: b.user_id,
    };
    const recordProvenance = (identity, target = copyVersionId, expectedSource = versionId) =>
      executor.query(
        `UPDATE assets asset SET metadata=metadata||$4::jsonb
       FROM avatar_profile_versions version JOIN avatar_profiles profile ON profile.account_id=version.account_id
         AND profile.workspace_id=version.workspace_id AND profile.id=version.profile_id
       WHERE asset.account_id=$1 AND asset.workspace_id=$2 AND version.account_id=asset.account_id
         AND version.workspace_id=asset.workspace_id AND version.id=$3 AND asset.id=version.original_asset_id
         AND profile.status='ACTIVE' AND (asset.metadata->>'shared_source_version_id' IS NULL
           OR asset.metadata->>'shared_source_version_id'=$5)
       RETURNING asset.metadata`,
        [
          identity.account_id,
          identity.workspace_id,
          target,
          JSON.stringify(provenance),
          expectedSource,
        ],
      );
    await executor.execute("SET ROLE videoforge_v209_runtime_dc9612d6");
    try {
      assert.deepEqual(await source(b), selectedSource);
      assert.deepEqual(
        (await executor.query("SELECT * FROM assets WHERE id=$1", [assetId])).rows,
        [],
      );
      assert.deepEqual((await recordProvenance(b)).rows, [{ metadata: provenance }]);
      await executor.query("UPDATE assets SET state='VERIFIED' WHERE id=$1", [copyAssetId]);
      assert.deepEqual((await recordProvenance(b)).rows, [{ metadata: provenance }]);
      assert.deepEqual((await recordProvenance(a, versionId)).rows, []);
      assert.deepEqual((await recordProvenance(b, copyVersionId, uuid(88999))).rows, []);
    } finally {
      await executor.execute("RESET ROLE");
      await executor.query("SELECT set_config('videoforge.account_id',$1,false)", [a.account_id]);
    }
    for (const [role, allowed] of [
      ["videoforge_v209_runtime_dc9612d6", true],
      ["public", false],
    ]) {
      assert.equal(
        (
          await executor.query(
            "SELECT has_function_privilege($1,'videoforge_shared_avatar_source(uuid,uuid,uuid)','EXECUTE') AS allowed",
            [role],
          )
        ).rows[0].allowed,
        allowed,
      );
    }
    const result = await read(b);
    assert.equal(result.length, 3);
    assert.deepEqual(result.find((item) => item.id === c.account_id).avatars, []);
    const shared = result.find((item) => item.id === a.account_id);
    assert.equal(shared.email, "avatar-a@example.test");
    assert.equal(
      shared.avatars.some((avatar) => avatar.version_id === versionId),
      true,
    );
    assert.equal(JSON.stringify(result).includes(objectKey), false);
    assert.deepEqual(await preview(b), [{ object_key: objectKey, content_type: "image/webp" }]);
    assert.deepEqual(await preview(b, uuid(88999)), []);
    assert.deepEqual((await read(a)).find((item) => item.is_current_user).avatars, shared.avatars);
    await executor.query("SELECT set_config('videoforge.account_id',$1,false)", [b.account_id]);
    assert.equal(
      (
        await executor.query("SELECT * FROM videoforge_archive_hosted_preset($1,$2,'AVATAR',$3)", [
          b.account_id,
          b.workspace_id,
          profileId,
        ])
      ).rows.length,
      0,
    );
    await assert.rejects(
      tenantCall(executor, "videoforge_shared_avatar_collections", [a.account_id, b.workspace_id]),
      /tenant scope invalid/,
    );
    await executor.query("SELECT set_config('videoforge.account_id','',false)");
    await assert.rejects(
      executor.query("SELECT videoforge_shared_avatar_collections($1,$2)", [
        a.account_id,
        a.workspace_id,
      ]),
      /tenant scope invalid/,
    );
    for (const table of ["avatar_profiles", "avatar_profile_versions", "assets"]) {
      assert.equal(
        (
          await executor.query("SELECT has_table_privilege('public',$1,'SELECT') AS allowed", [
            table,
          ])
        ).rows[0].allowed,
        false,
      );
      const rls = (
        await executor.query(
          "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=$1::regclass",
          [table],
        )
      ).rows[0];
      assert.deepEqual(rls, { relrowsecurity: true, relforcerowsecurity: true });
    }
    await executor.query(
      "INSERT INTO hosted_access_revocations(hosted_auth_user_id,revoked_by) VALUES($1,$1)",
      ["voiceover-library-user-0811"],
    );
    assert.equal(
      (await read(b)).some((item) => item.id === a.account_id),
      false,
    );
    assert.deepEqual(await preview(b), []);
    assert.equal(await source(b), null);
    await assert.rejects(read(a), /tenant scope invalid/);
    await assert.rejects(source(a), /tenant scope invalid/);
    await executor.query("DELETE FROM hosted_access_revocations WHERE hosted_auth_user_id=$1", [
      "voiceover-library-user-0811",
    ]);
    await executor.query("SELECT set_config('videoforge.account_id',$1,false)", [a.account_id]);
    await executor.query("SELECT * FROM videoforge_archive_hosted_preset($1,$2,'AVATAR',$3)", [
      a.account_id,
      a.workspace_id,
      profileId,
    ]);
    assert.deepEqual((await read(b)).find((item) => item.id === a.account_id).avatars, []);
    assert.deepEqual(await preview(b), []);
    assert.equal(await source(b), null);
    await executor.query("SELECT set_config('videoforge.account_id',$1,false)", [a.account_id]);
    assert.equal(
      (await executor.query("SELECT binary_sha256 FROM assets WHERE id=$1", [assetId])).rows[0]
        .binary_sha256,
      sha256("shared-avatar-source"),
    );
    assert.deepEqual(
      (
        await executor.query(
          "SELECT to_jsonb(v) AS value FROM avatar_profile_versions v WHERE id=$1",
          [versionId],
        )
      ).rows[0].value,
      originalSnapshot,
    );
  });
});

function queueArgs(identity, jobId, suffix = "one") {
  return [
    identity.account_id,
    identity.workspace_id,
    identity.user_id,
    jobId,
    sha256(`voiceover-request-${suffix}`),
    `Narration ${suffix}`,
    `voice-${suffix}`,
    `${suffix}.mp3`,
    `Voiceover ${suffix}`,
    `Narrator ${suffix}`,
  ];
}

async function queue(executor, identity, jobId, suffix = "one") {
  return tenantCall(
    executor,
    "videoforge_queue_standalone_voiceover",
    queueArgs(identity, jobId, suffix),
  );
}

async function insertCompletedJob(executor, identity, jobId, suffix) {
  const args = queueArgs(identity, jobId, suffix);
  const providerJobId = `provider-${suffix}`;
  await executor.query(
    `WITH bound AS (
       SELECT set_config('videoforge.account_id',($1::uuid)::text,true)
     )
     INSERT INTO hosted_voiceover_jobs(
       id,account_id,workspace_id,request_hash,script,voice_id,filename,state,provider_job_id
     )
     SELECT $4::uuid,$1::uuid,$2::uuid,$5::text,$6::text,$7::text,$8::text,'COMPLETED',$9::text
       FROM bound WHERE $3::uuid IS NOT NULL`,
    [
      identity.account_id,
      identity.workspace_id,
      identity.user_id,
      args[3],
      args[4],
      args[5],
      args[6],
      args[7],
      providerJobId,
    ],
  );
  return { args, providerJobId };
}

async function insertPipelineProject(executor, identity, projectId, jobId, suffix) {
  const args = queueArgs(identity, jobId, suffix);
  await executor.query(
    `WITH bound AS (
       SELECT set_config('videoforge.account_id',($1::uuid)::text,true)
     )
     INSERT INTO projects(id,account_id,workspace_id,owner_user_id,name,normalized_name)
     SELECT $3::uuid,$1::uuid,$2::uuid,$4::uuid,$5::text,$6::text FROM bound`,
    [
      identity.account_id,
      identity.workspace_id,
      projectId,
      identity.user_id,
      `Pipeline ${suffix}`,
      `pipeline-${suffix}`,
    ],
  );
  await executor.query(
    `WITH bound AS (
       SELECT set_config('videoforge.account_id',($1::uuid)::text,true)
     )
     INSERT INTO hosted_script_projects(
       project_id,account_id,workspace_id,idempotency_key,request_sha256,options,
       script,voice_id,voice_name,voiceover_job_id,state
     )
     SELECT $3::uuid,$1::uuid,$2::uuid,$5::text,$6::text,'{}'::jsonb,$7::text,$8::text,$9::text,$4::uuid,'WAITING' FROM bound`,
    [
      identity.account_id,
      identity.workspace_id,
      projectId,
      jobId,
      `pipeline-${suffix}`,
      args[4],
      args[5],
      args[6],
      `Pipeline voice ${suffix}`,
    ],
  );
}

async function completeArchive(executor, identity, jobId, suffix, claimId) {
  const queued = await queue(executor, identity, jobId, suffix);
  assert.equal(queued.claimed, true);
  const providerJobId = `provider-${suffix}`;
  const submitClaim = uuid(Number(String(jobId).replace(/-/g, "").slice(-6), 16));
  const submitted = await tenantCall(executor, "videoforge_claim_voiceover_submission", [
    identity.account_id,
    identity.workspace_id,
    jobId,
    submitClaim,
  ]);
  assert.equal(submitted.state, "SUBMITTING");
  await tenantCall(executor, "videoforge_record_voiceover_job", [
    identity.account_id,
    identity.workspace_id,
    jobId,
    "PROCESSING",
    providerJobId,
    null,
  ]);
  await tenantCall(executor, "videoforge_record_voiceover_job", [
    identity.account_id,
    identity.workspace_id,
    jobId,
    "COMPLETED",
    providerJobId,
    null,
  ]);
  const claimed = await tenantCall(executor, "videoforge_claim_voiceover_library_archive", [
    identity.account_id,
    identity.workspace_id,
    jobId,
    claimId,
  ]);
  assert.equal(claimed.provider_job_id, providerJobId);
  const objectKey = `${claimed.object_prefix}${claimId}.mp3`;
  const finalized = await tenantCall(executor, "videoforge_finalize_voiceover_library_archive", [
    identity.account_id,
    identity.workspace_id,
    jobId,
    claimId,
    objectKey,
    "audio/mpeg",
    42,
    sha256(`audio-${suffix}`),
    1_045,
  ]);
  return { providerJobId, queued, claimed, finalized, objectKey };
}

test("0289 standalone voiceover library preserves identity, tenancy, archive fencing, and no-video admission", async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    const owner = await admit(executor, 1, "demo9gss@gmail.com");
    const memberA = await admit(executor, 2, "voiceover-a@example.test");
    const memberB = await admit(executor, 3, "voiceover-b@example.test");
    const jobA = uuid(2_890_001);
    const beforeProjects = (
      await executor.query("SELECT count(*)::int AS count FROM projects WHERE workspace_id=$1", [
        memberA.workspace_id,
      ])
    ).rows[0].count;
    const beforeScriptProjects = (
      await executor.query(
        "SELECT count(*)::int AS count FROM hosted_script_projects WHERE workspace_id=$1",
        [memberA.workspace_id],
      )
    ).rows[0].count;

    const first = await queue(executor, memberA, jobA);
    assert.equal(first.claimed, true);
    assert.equal(first.job.state, "WAITING");
    const replay = await queue(executor, memberA, jobA);
    assert.equal(replay.claimed, false);
    assert.equal(replay.job.id, jobA);
    await assert.rejects(
      queue(executor, memberA, jobA, "different-input"),
      /VOICEOVER_REQUEST_CONFLICT|VOICEOVER_LIBRARY_REQUEST_CONFLICT/,
    );

    const afterProjects = (
      await executor.query("SELECT count(*)::int AS count FROM projects WHERE workspace_id=$1", [
        memberA.workspace_id,
      ])
    ).rows[0].count;
    const afterScriptProjects = (
      await executor.query(
        "SELECT count(*)::int AS count FROM hosted_script_projects WHERE workspace_id=$1",
        [memberA.workspace_id],
      )
    ).rows[0].count;
    assert.equal(afterProjects, beforeProjects);
    assert.equal(afterScriptProjects, beforeScriptProjects);
    // Release the account's single queued admission before seeding completed
    // provider identities for the guard cases below.
    await executor.query(
      "UPDATE hosted_voiceover_jobs SET state='CANCELLED',updated_at=now() WHERE id=$1",
      [jobA],
    );

    // A J1 identity admitted by the video pipeline cannot be promoted into the
    // standalone library, even when its request payload matches. An existing
    // hosted job without a standalone asset is likewise never adopted.
    const pipelineJob = uuid(2_890_003);
    await insertCompletedJob(executor, memberA, pipelineJob, "pipeline");
    await insertPipelineProject(executor, memberA, uuid(2_890_004), pipelineJob, "pipeline");
    await assert.rejects(
      queue(executor, memberA, pipelineJob, "pipeline"),
      /VOICEOVER_LIBRARY_PIPELINE_JOB_CONFLICT/,
    );
    const orphanJob = uuid(2_890_005);
    await insertCompletedJob(executor, memberA, orphanJob, "orphan");
    await assert.rejects(
      queue(executor, memberA, orphanJob, "orphan"),
      /VOICEOVER_LIBRARY_EXISTING_JOB_CONFLICT/,
    );
    assert.equal(
      (
        await executor.query(
          "SELECT count(*)::int AS count FROM hosted_voiceover_library_assets WHERE voiceover_job_id = ANY($1::uuid[])",
          [[pipelineJob, orphanJob]],
        )
      ).rows[0].count,
      0,
    );

    await assert.rejects(
      tenantCall(executor, "videoforge_finalize_voiceover_library_archive", [
        memberB.account_id,
        memberB.workspace_id,
        jobA,
        uuid(2_890_002),
        `tenant/${memberB.account_id}/workspace/${memberB.workspace_id}/voiceover/${jobA}/${uuid(2_890_002)}.mp3`,
        "audio/mpeg",
        42,
        sha256("foreign"),
        1_045,
      ]),
      /VOICEOVER_NOT_READY/,
    );

    const own = await tokenCall(executor, "videoforge_read_voiceover_library", [
      memberA.token,
      false,
      null,
      "",
      null,
      0,
    ]);
    assert.equal(own.total, 1);
    assert.equal(own.voiceovers[0].id, jobA);
    const foreign = await tokenCall(executor, "videoforge_read_voiceover_library", [
      memberB.token,
      false,
      jobA,
      "",
      null,
      0,
    ]);
    assert.equal(foreign.total, 0);
    assert.deepEqual(
      await tokenCall(executor, "videoforge_read_voiceover_library", [
        memberA.token,
        true,
        null,
        "",
        null,
        0,
      ]),
      { error: "CENTRALIZED_LIBRARY_FORBIDDEN" },
    );

    const jobB = uuid(2_890_011);
    const claimB = uuid(2_890_012);
    const completedB = await completeArchive(executor, memberB, jobB, "member-b", claimB);
    const central = await tokenCall(executor, "videoforge_read_voiceover_library", [
      owner.token,
      true,
      null,
      "",
      null,
      0,
    ]);
    assert.equal(central.total, 2);
    assert.equal(central.voiceovers.find((voiceover) => voiceover.id === jobB).id, jobB);
    assert.deepEqual(central.creators, [
      {
        id: memberA.account_id,
        name: "Voiceover User 2",
        email: "voiceover-a@example.test",
      },
      {
        id: memberB.account_id,
        name: "Voiceover User 3",
        email: "voiceover-b@example.test",
      },
    ]);
    assert.equal(
      central.voiceovers.find((voiceover) => voiceover.id === jobB).object_key,
      completedB.objectKey,
    );

    const jobC = uuid(2_890_021);
    const claimC1 = uuid(2_890_022);
    const claimC2 = uuid(2_890_023);
    await queue(executor, memberA, jobC, "claim-race");
    await executor.query(
      "UPDATE provider_api_policies SET next_start_at='-infinity',cooldown_until='-infinity' WHERE provider='J1_TTS'",
    );
    const submissionClaimC = uuid(2_890_024);
    const providerJobC = "provider-claim-race";
    assert.equal(
      (
        await tenantCall(executor, "videoforge_claim_voiceover_submission", [
          memberA.account_id,
          memberA.workspace_id,
          jobC,
          submissionClaimC,
        ])
      ).state,
      "SUBMITTING",
    );
    await tenantCall(executor, "videoforge_record_voiceover_job", [
      memberA.account_id,
      memberA.workspace_id,
      jobC,
      "PROCESSING",
      providerJobC,
      null,
    ]);
    await tenantCall(executor, "videoforge_record_voiceover_job", [
      memberA.account_id,
      memberA.workspace_id,
      jobC,
      "COMPLETED",
      providerJobC,
      null,
    ]);
    const [claimOne, claimTwo] = await Promise.all([
      tenantCall(executor, "videoforge_claim_voiceover_library_archive", [
        memberA.account_id,
        memberA.workspace_id,
        jobC,
        claimC1,
      ]),
      tenantCall(executor, "videoforge_claim_voiceover_library_archive", [
        memberA.account_id,
        memberA.workspace_id,
        jobC,
        claimC2,
      ]),
    ]);
    assert.equal([claimOne, claimTwo].filter(Boolean).length, 1);
    const winningClaim = claimOne ? claimC1 : claimC2;
    const winningKey = `${(claimOne ?? claimTwo).object_prefix}${winningClaim}.mp3`;
    await executor.query(
      "UPDATE hosted_voiceover_library_assets SET deleted_at=now() WHERE voiceover_job_id=$1",
      [jobC],
    );
    await assert.rejects(
      tenantCall(executor, "videoforge_finalize_voiceover_library_archive", [
        memberA.account_id,
        memberA.workspace_id,
        jobC,
        winningClaim,
        winningKey,
        "audio/mpeg",
        42,
        sha256("deleted"),
        1_045,
      ]),
      /VOICEOVER_NOT_READY/,
    );

    const ownDeletePlan = await tokenCall(executor, "videoforge_delete_voiceover_library", [
      memberB.token,
      false,
      jobB,
      false,
    ]);
    assert.equal(ownDeletePlan.object_key, completedB.objectKey);
    assert.deepEqual(
      await tokenCall(executor, "videoforge_delete_voiceover_library", [
        memberA.token,
        false,
        jobB,
        false,
      ]),
      { error: "VOICEOVER_NOT_FOUND" },
    );
    assert.deepEqual(
      await tokenCall(executor, "videoforge_delete_voiceover_library", [
        memberB.token,
        false,
        jobB,
        true,
      ]),
      { deleted: true },
    );
    assert.deepEqual(
      await tokenCall(executor, "videoforge_delete_voiceover_library", [
        memberB.token,
        false,
        jobB,
        false,
      ]),
      { deleted: true },
    );
  });
});

test("standalone queue retains successive scripts and advances in FIFO order without browser polling", async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    const member = await admit(executor, 10, "voiceover-queue@example.test");
    const first = uuid(2_890_100),
      second = uuid(2_890_101);
    const scope = [member.account_id, member.workspace_id];
    await executor.query(
      "UPDATE provider_api_policies SET max_inflight=1,min_start_interval_ms=0,next_start_at='-infinity',cooldown_until='-infinity' WHERE provider='J1_TTS'",
    );
    assert.equal((await queue(executor, member, first, "first")).job.state, "WAITING");
    assert.equal((await queue(executor, member, second, "second")).job.state, "WAITING");
    const claim = (id) =>
      tenantCall(executor, "videoforge_claim_voiceover_submission", [
        ...scope,
        id,
        uuid(2_890_102),
      ]);
    assert.equal(await claim(second), null);
    assert.equal((await claim(first)).state, "SUBMITTING");
    await tenantCall(executor, "videoforge_record_voiceover_job", [
      ...scope,
      first,
      "PROCESSING",
      "provider-first",
      null,
    ]);
    assert.equal(await claim(second), null);
    const saved = await tokenCall(executor, "videoforge_read_voiceover_library", [
      member.token,
      false,
      null,
      "",
      null,
      0,
    ]);
    assert.equal(saved.voiceovers.length, 2);
    assert.equal(saved.voiceovers.find((row) => row.id === second).state, "WAITING");
    await tenantCall(executor, "videoforge_record_voiceover_job", [
      ...scope,
      first,
      "COMPLETED",
      "provider-first",
      null,
    ]);
    assert.equal((await claim(second)).state, "SUBMITTING");
    assert.equal(await claim(second), null);
  });
});

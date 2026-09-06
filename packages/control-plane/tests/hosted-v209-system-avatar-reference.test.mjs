import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { HASHES, IDS, seedLockedProjects } from "./support/fixtures.mjs";
import {
  createMigratedDatabase,
  expectDatabaseError,
  sha256,
  uuid,
  withPgcryptoMigratedDatabase,
} from "./support/pglite.mjs";
import {
  exportMetadataSnapshot,
  restoreMetadataSnapshot,
  serializeMetadataSnapshot,
} from "../dist/src/index.js";

const SYSTEM_ACCOUNT_ID = "ffffffff-ffff-4fff-8fff-000000000001";
const SYSTEM_WORKSPACE_ID = "ffffffff-ffff-4fff-8fff-000000000011";
const SYSTEM_USER_ID = "ffffffff-ffff-4fff-8fff-000000000021";
const SYSTEM_PROFILE_ID = uuid(76001);
const SYSTEM_VERSION_ID = uuid(76002);
const SYSTEM_ORIGINAL_ASSET_ID = uuid(76003);
const SYSTEM_RUNTIME_ASSET_ID = uuid(76004);
const SYSTEM_ORIGINAL_LINK_ID = uuid(76005);
const SYSTEM_RUNTIME_LINK_ID = uuid(76006);
const GENERATION_REQUEST_ID = uuid(76007);
const SYSTEM_RUNTIME_SHA256 = HASHES.avatarRuntimeA;
const SYSTEM_OBJECT_KEY =
  `tenant/${SYSTEM_ACCOUNT_ID}/workspace/${SYSTEM_WORKSPACE_ID}/avatar-profile/` +
  `${SYSTEM_PROFILE_ID}/version/${SYSTEM_VERSION_ID}/canonical/avatar.png`;

async function seedSystemAvatar(executor) {
  await executor.query(`SELECT set_config('videoforge.account_id',$1,false)`, [SYSTEM_ACCOUNT_ID]);
  await executor.query(
    `INSERT INTO assets(id,account_id,workspace_id,kind,state,object_key,binary_sha256,
       content_type,byte_size,verified_at) VALUES
       ($1,$2,$3,'AVATAR_ORIGINAL','VERIFIED',$4,$5,'image/png',2048,transaction_timestamp()),
       ($6,$2,$3,'AVATAR_RUNTIME','VERIFIED',$7,$8,'image/png',4096,transaction_timestamp())`,
    [
      SYSTEM_ORIGINAL_ASSET_ID,
      SYSTEM_ACCOUNT_ID,
      SYSTEM_WORKSPACE_ID,
      SYSTEM_OBJECT_KEY.replace("canonical/avatar.png", "original/avatar.png"),
      sha256("0076-system-original"),
      SYSTEM_RUNTIME_ASSET_ID,
      SYSTEM_OBJECT_KEY,
      SYSTEM_RUNTIME_SHA256,
    ],
  );
  await executor.query(
    `INSERT INTO avatar_profiles(id,account_id,workspace_id,name,normalized_name,status,
       created_by_user_id,scope_kind) VALUES($1,$2,$3,'System Presenter','system presenter','ACTIVE',$4,'SYSTEM')`,
    [SYSTEM_PROFILE_ID, SYSTEM_ACCOUNT_ID, SYSTEM_WORKSPACE_ID, SYSTEM_USER_ID],
  );
  await executor.query(
    `INSERT INTO avatar_profile_versions(id,account_id,workspace_id,profile_id,version_number,state,
       profile_contract_name,profile_contract_version,profile_payload,profile_hash,original_asset_id,
       runtime_source_asset_id,runtime_source_binary_sha256,source_preparation_profile,
       source_validation_profile,rights_attested_by_user_id,likeness_attested_by_user_id,ready_at,
       scope_kind) VALUES($1,$2,$3,$4,1,'READY','avatar-profile-version','v1',
       '{"source":"system-0076"}'::jsonb,$5,$6,$7,$8,'owned-preparation-v1','owned-validation-v1',
       $9,$9,transaction_timestamp(),'SYSTEM')`,
    [
      SYSTEM_VERSION_ID,
      SYSTEM_ACCOUNT_ID,
      SYSTEM_WORKSPACE_ID,
      SYSTEM_PROFILE_ID,
      HASHES.avatarProfileA,
      SYSTEM_ORIGINAL_ASSET_ID,
      SYSTEM_RUNTIME_ASSET_ID,
      SYSTEM_RUNTIME_SHA256,
      SYSTEM_USER_ID,
    ],
  );
  await executor.execute(
    `ALTER TABLE avatar_profiles DISABLE TRIGGER avatar_profiles_system_immutable`,
  );
  await executor.query(`UPDATE avatar_profiles SET active_version_id=$1 WHERE id=$2`, [
    SYSTEM_VERSION_ID,
    SYSTEM_PROFILE_ID,
  ]);
  await executor.execute(
    `ALTER TABLE avatar_profiles ENABLE TRIGGER avatar_profiles_system_immutable`,
  );
  await executor.query(
    `INSERT INTO avatar_profile_assets(id,account_id,workspace_id,profile_id,version_id,asset_id,
       role,binary_sha256,retention_state) VALUES
       ($1,$2,$3,$4,$5,$6,'ORIGINAL',$7,'RETAIN'),
       ($8,$2,$3,$4,$5,$9,'RUNTIME',$10,'RETAIN')`,
    [
      SYSTEM_ORIGINAL_LINK_ID,
      SYSTEM_ACCOUNT_ID,
      SYSTEM_WORKSPACE_ID,
      SYSTEM_PROFILE_ID,
      SYSTEM_VERSION_ID,
      SYSTEM_ORIGINAL_ASSET_ID,
      sha256("0076-system-original"),
      SYSTEM_RUNTIME_LINK_ID,
      SYSTEM_RUNTIME_ASSET_ID,
      SYSTEM_RUNTIME_SHA256,
    ],
  );
  await executor.query(`SELECT set_config('videoforge.account_id',$1,false)`, [IDS.accountA]);
}

async function seedSystemAvatarClone(executor) {
  await seedLockedProjects(executor);
  await executor.query(
    `INSERT INTO generation_requests(id,account_id,workspace_id,project_id,project_revision_id,
       created_by_user_id,state,queue_order,available_at,attempt_ordinal,idempotency_key,admitted_at,
       created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'ACTIVE',1,transaction_timestamp(),1,
       '0076-system-avatar',transaction_timestamp(),transaction_timestamp(),transaction_timestamp())`,
    [GENERATION_REQUEST_ID, IDS.accountA, IDS.workspaceA, IDS.projectA, IDS.revisionA, IDS.userA],
  );
  await seedSystemAvatar(executor);
}

async function convertTenantAvatarToSystemClone(executor) {
  await executor.query(
    `UPDATE assets SET object_key=$1,content_type='image/png',byte_size=4096,
       metadata=jsonb_build_object('system_source_asset_id',$2::text,'system_source_scope','SYSTEM',
         'materialization','hosted-system-preset-snapshot-v1')
     WHERE account_id=$3 AND workspace_id=$4 AND id=$5`,
    [SYSTEM_OBJECT_KEY, SYSTEM_RUNTIME_ASSET_ID, IDS.accountA, IDS.workspaceA, IDS.avatarRuntimeA],
  );
  await executor.query(
    `INSERT INTO avatar_profile_assets(id,account_id,workspace_id,profile_id,version_id,asset_id,
       role,binary_sha256,retention_state)
     VALUES($1,$2,$3,$4,$5,$6,'RUNTIME',$7,'RETAIN')`,
    [
      uuid(76008),
      IDS.accountA,
      IDS.workspaceA,
      IDS.avatarProfileA,
      IDS.avatarVersionA,
      IDS.avatarRuntimeA,
      SYSTEM_RUNTIME_SHA256,
    ],
  );
}

test("0076 derives and materializes one exact tenant SYSTEM avatar input reference", async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    await seedSystemAvatarClone(executor);

    const workspace = await executor.query(
      `SELECT public.videoforge_materialize_hosted_v209_system_avatar_reference($1,$2,$3,$4) AS value`,
      [IDS.accountA, IDS.workspaceA, IDS.userA, IDS.projectA],
    );
    assert.equal(workspace.rows[0].value.referenceRequired, false);

    await convertTenantAvatarToSystemClone(executor);
    await expectDatabaseError(
      executor.query(
        `INSERT INTO artifact_reservations(id,account_id,workspace_id,project_id,
           project_revision_id,asset_id,lane,job_id,artifact_id,object_key,method,content_type,
           content_length,checksum_sha256,expires_at,max_uses,used_count,state,retention_class,
           deletion_owner_account_id) VALUES($1,$2,$3,$4,$5,$6,'INPUT',$7,$8,$9,'GET',
           'image/png',4096,$10,transaction_timestamp()+interval '1 hour',1,1,'COMMITTED',
           'PROJECT',$2)`,
        [
          uuid(76009),
          IDS.accountA,
          IDS.workspaceA,
          IDS.projectA,
          IDS.revisionA,
          IDS.avatarRuntimeA,
          `v209-system-avatar-${IDS.revisionA}`,
          IDS.avatarRuntimeA,
          SYSTEM_OBJECT_KEY,
          SYSTEM_RUNTIME_SHA256,
        ],
      ),
      "23514",
    );
    const first = await executor.query(
      `SELECT public.videoforge_materialize_hosted_v209_system_avatar_reference($1,$2,$3,$4) AS value`,
      [IDS.accountA, IDS.workspaceA, IDS.userA, IDS.projectA],
    );
    assert.equal(first.rows[0].value.referenceRequired, true);
    assert.equal(first.rows[0].value.referenceReady, true);
    assert.equal(first.rows[0].value.objectKey, SYSTEM_OBJECT_KEY);
    assert.equal(first.rows[0].value.checksumSha256, SYSTEM_RUNTIME_SHA256);
    assert.equal(first.rows[0].value.replayed, false);
    const candidateReservation = await executor.query(
      `SELECT public.videoforge_hosted_v209_uuid(
         'input-reservation',$1::uuid,'avatar-source') AS id`,
      [GENERATION_REQUEST_ID],
    );
    assert.equal(
      first.rows[0].value.reservationId,
      candidateReservation.rows[0].id,
      "the durable SYSTEM reference must use the exact 0074 candidate reservation",
    );

    const stored = await executor.query(
      `SELECT reservation.method,reservation.lane,reservation.state,reservation.project_revision_id,
              reservation.asset_id,receipt.object_key,receipt.checksum_sha256,receipt.probe
         FROM artifact_reservations reservation
         JOIN artifact_receipts receipt ON receipt.reservation_id=reservation.id
        WHERE reservation.id=$1`,
      [first.rows[0].value.reservationId],
    );
    assert.deepEqual(
      [stored.rows[0].method, stored.rows[0].lane, stored.rows[0].state],
      ["GET", "INPUT", "COMMITTED"],
    );
    assert.equal(stored.rows[0].project_revision_id, IDS.revisionA);
    assert.equal(stored.rows[0].asset_id, IDS.avatarRuntimeA);
    assert.equal(stored.rows[0].object_key, SYSTEM_OBJECT_KEY);
    assert.equal(stored.rows[0].checksum_sha256, SYSTEM_RUNTIME_SHA256);
    assert.equal(stored.rows[0].probe.system_runtime_source_asset_id, SYSTEM_RUNTIME_ASSET_ID);

    const projection = await executor.query(
      `SELECT public.videoforge_read_hosted_v209_system_avatar_projection($1,$2,$3) AS value`,
      [IDS.accountA, IDS.workspaceA, IDS.revisionA],
    );
    assert.deepEqual(projection.rows[0].value, {
      sourceScopeKind: "SYSTEM",
      systemSourceReferenceVerified: true,
      systemAvatarProfileId: SYSTEM_PROFILE_ID,
      systemAvatarProfileVersionId: SYSTEM_VERSION_ID,
      systemRuntimeSourceAssetId: SYSTEM_RUNTIME_ASSET_ID,
      systemRuntimeProfileAssetLinkId: SYSTEM_RUNTIME_LINK_ID,
    });

    const replay = await executor.query(
      `SELECT public.videoforge_materialize_hosted_v209_system_avatar_reference($1,$2,$3,$4) AS value`,
      [IDS.accountA, IDS.workspaceA, IDS.userA, IDS.projectA],
    );
    assert.equal(replay.rows[0].value.reservationId, first.rows[0].value.reservationId);
    assert.equal(replay.rows[0].value.replayed, true);

    await expectDatabaseError(
      executor.query(`UPDATE artifact_reservations SET updated_at=now() WHERE id=$1`, [
        first.rows[0].value.reservationId,
      ]),
      "55000",
    );
    await executor.query(`SELECT set_config('videoforge.account_id',$1,false)`, [IDS.accountB]);
    await expectDatabaseError(
      executor.query(
        `SELECT public.videoforge_materialize_hosted_v209_system_avatar_reference($1,$2,$3,$4)`,
        [IDS.accountA, IDS.workspaceA, IDS.userA, IDS.projectA],
      ),
      "42501",
    );
  });
});

test("0076 keeps the SYSTEM exception narrow and the ready-render marker DB-owned", async () => {
  const source = await readFile(
    new URL("../migrations/0076_hosted_v209_system_avatar_reference.sql", import.meta.url),
    "utf8",
  );
  assert.match(source, /method='GET' AND lane='INPUT'/u);
  assert.match(source, /systemSourceReferenceVerified',true/u);
  assert.match(
    source,
    /videoforge_is_hosted_v209_system_avatar_reference\(reservation\.account_id/u,
  );
  assert.doesNotMatch(source, /signed_url|authorization|secret|token_ciphertext/iu);
  const repair = await readFile(
    new URL(
      "../migrations/0077_hosted_v209_system_avatar_candidate_reservation.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    repair,
    /videoforge_hosted_v209_uuid\(\s*'input-reservation',target\.generation_request_id,'avatar-source'\)/u,
  );
  assert.doesNotMatch(repair, /hosted-v209-system-avatar-reservation:/u);
});

test("0076 SYSTEM reference receipts survive a secret-free metadata backup and restore", async () => {
  const source = await createMigratedDatabase();
  const destination = await createMigratedDatabase();
  try {
    await seedSystemAvatarClone(source.executor);
    await convertTenantAvatarToSystemClone(source.executor);
    const materialized = await source.executor.query(
      `SELECT public.videoforge_materialize_hosted_v209_system_avatar_reference($1,$2,$3,$4) AS value`,
      [IDS.accountA, IDS.workspaceA, IDS.userA, IDS.projectA],
    );
    const snapshot = serializeMetadataSnapshot(await exportMetadataSnapshot(source.executor));
    await seedSystemAvatar(destination.executor);
    await destination.executor.query(`SELECT set_config('videoforge.account_id','',false)`);
    let restored;
    try {
      restored = await restoreMetadataSnapshot(destination.executor, snapshot);
    } catch (error) {
      throw error.cause ?? error;
    }
    assert.ok(restored.restoredRows > 0);
    await destination.executor.query(`SELECT set_config('videoforge.account_id',$1,false)`, [
      IDS.accountA,
    ]);
    const receipt = await destination.executor.query(
      `SELECT reservation.method,reservation.state,receipt.object_key,receipt.checksum_sha256
         FROM artifact_reservations reservation
         JOIN artifact_receipts receipt ON receipt.reservation_id=reservation.id
        WHERE reservation.id=$1`,
      [materialized.rows[0].value.reservationId],
    );
    assert.deepEqual(receipt.rows[0], {
      method: "GET",
      state: "COMMITTED",
      object_key: SYSTEM_OBJECT_KEY,
      checksum_sha256: SYSTEM_RUNTIME_SHA256,
    });
  } finally {
    await source.database.close();
    await destination.database.close();
  }
});

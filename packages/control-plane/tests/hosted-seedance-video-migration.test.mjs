import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createFixtureDatabase, applyMigrationSliceThrough } from "./support/pglite.mjs";
import { IDS, seedLockedProjects } from "./support/fixtures.mjs";
const source = readFileSync(
  new URL("../migrations/0240_hosted_seedance_video.sql", import.meta.url),
  "utf8",
);
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = "sha256:" + "a".repeat(64);

test("0240 applies to the real prior chain and enforces private immutable video planning and no replay", async () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../migrations/manifest.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(
    manifest.migrations.find((entry) => entry.version === 240),
    {
      version: 240,
      name: "hosted_seedance_video",
      filename: "0240_hosted_seedance_video.sql",
      sha256: `sha256:${createHash("sha256").update(source).digest("hex")}`,
    },
  );
  const { database: db, executor, sources } = await createFixtureDatabase();
  try {
    await applyMigrationSliceThrough(executor, 239, sources);
    await seedLockedProjects(executor);
    // Real prior constraint accepts immutable SYSTEM avatar GET references. Preserve a
    // preexisting key during migration validation; the metadata-only fixture skips the
    // lineage trigger here, but keeps the original CHECK constraints enabled.
    await db.query("SELECT set_config('videoforge.account_id',$1,false)", [IDS.accountA]);
    const legacyAvatarKey = `tenant/ffffffff-ffff-4fff-8fff-000000000001/workspace/ffffffff-ffff-4fff-8fff-000000000011/avatar-profile/${id(240090)}/version/${id(240091)}/canonical/avatar.png`;
    await db.exec("ALTER TABLE artifact_reservations DISABLE TRIGGER ALL");
    try {
      await db.query(
        `INSERT INTO artifact_reservations(id,account_id,workspace_id,project_id,project_revision_id,lane,job_id,artifact_id,object_key,method,content_type,content_length,checksum_sha256,expires_at,max_uses,retention_class,deletion_owner_account_id) VALUES($1,$2,$3,$4,$5,'INPUT','legacy-avatar','legacy-avatar',$6,'GET','image/png',2000,$7,now()+interval '1 hour',1,'PROJECT',$2)`,
        [
          id(240092),
          IDS.accountA,
          IDS.workspaceA,
          IDS.projectA,
          IDS.revisionA,
          legacyAvatarKey,
          hash,
        ],
      );
    } finally {
      await db.exec("ALTER TABLE artifact_reservations ENABLE TRIGGER ALL");
    }
    const priorConstraint = (
      await db.query(
        "SELECT pg_get_expr(conbin,conrelid) AS predicate FROM pg_constraint WHERE conrelid='artifact_reservations'::regclass AND conname='artifact_reservations_object_key_check'",
      )
    ).rows[0].predicate;
    await executor.execute(source);
    const extendedConstraint = (
      await db.query(
        "SELECT pg_get_expr(conbin,conrelid) AS predicate FROM pg_constraint WHERE conrelid='artifact_reservations'::regclass AND conname='artifact_reservations_object_key_check'",
      )
    ).rows[0].predicate;
    // PostgreSQL flattens OR parentheses when deparsing; compare native predicate
    // outcomes, including the established special reference and forbidden PUT.
    for (const [objectKey, method, lane, priorAllowed, extendedAllowed] of [
      [legacyAvatarKey, "GET", "INPUT", true, true],
      [legacyAvatarKey, "PUT", "INPUT", false, false],
      [
        `tenant/${IDS.accountA}/workspace/${IDS.workspaceA}/project/${IDS.projectA}/revision/${IDS.revisionA}/lane/mage-image/job/old/artifact/old`,
        "PUT",
        "MAGE_IMAGE",
        true,
        true,
      ],
      [
        `tenant/${IDS.accountA}/workspace/${IDS.workspaceA}/project/${IDS.projectA}/revision/${IDS.revisionA}/lane/scene-video/job/new/artifact/new`,
        "PUT",
        "SCENE_VIDEO",
        false,
        true,
      ],
      ["tenant/invalid", "PUT", "SCENE_VIDEO", false, false],
    ]) {
      const predicates = (
        await db.query(
          `SELECT (${priorConstraint}) AS old_allowed, (${extendedConstraint}) AS new_allowed FROM (SELECT $1::text AS object_key,$2::text AS method,$3::text AS lane) candidate`,
          [objectKey, method, lane],
        )
      ).rows[0];
      assert.equal(predicates.old_allowed, priorAllowed);
      assert.equal(predicates.new_allowed, extendedAllowed);
    }
    assert.equal(
      (await db.query("SELECT object_key FROM artifact_reservations WHERE id=$1", [id(240092)]))
        .rows[0].object_key,
      legacyAvatarKey,
    );
    const a = IDS.accountA,
      w = IDS.workspaceA,
      p = id(240001),
      r = id(240002),
      g = id(240003),
      task = id(240004),
      runtime = id(240005),
      claim = id(240006),
      sourceJob = id(240007),
      sourceAsset = id(240008),
      sourceReceipt = id(240009),
      sourceReservation = id(240010),
      timeline = id(240011),
      segment = id(240012);
    await db.query("SELECT set_config('videoforge.account_id',$1,false)", [a]);
    await db.query(
      "INSERT INTO projects(id,workspace_id,owner_user_id,name,normalized_name,generation_provider) VALUES($1,$2,$3,'Seedance proof','seedance proof','KIE_FAL')",
      [p, w, IDS.userA],
    );
    await db.query(
      `INSERT INTO project_revisions SELECT (jsonb_populate_record(NULL::project_revisions,to_jsonb(rev)||jsonb_build_object('id',$1::text,'project_id',$2::text,'created_at',now(),'locked_at',now()))).* FROM project_revisions rev WHERE rev.id=$3`,
      [r, p, IDS.revisionA],
    );
    const call = async (name, args) =>
      (
        await db.query(
          `SELECT public.${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) AS value`,
          args,
        )
      ).rows[0].value;
    const plan = await call("videoforge_pin_hosted_video_plan", [a, w, r]);
    assert.equal(plan.model, "bytedance:2@2");
    assert.equal(plan.coverage_percent, 7);
    assert.equal(plan.width, 1248);
    assert.equal(plan.height, 704);
    assert.deepEqual(await call("videoforge_pin_hosted_video_plan", [a, w, r]), plan);
    await assert.rejects(
      call("videoforge_pin_hosted_video_plan", [IDS.accountB, IDS.workspaceB, r]),
      /scope invalid/,
    );
    assert.equal(
      (
        await db.query(
          "SELECT has_table_privilege('videoforge_v209_runtime_dc9612d6','hosted_video_jobs','INSERT') AS allowed",
        )
      ).rows[0].allowed,
      false,
    );
    // Minimal predecessor metadata is fixture-seeded; every new video function/constraint/trigger
    // and the existing private artifact acceptance guard runs normally. No provider proof is claimed.
    const seed = async (table, sql, args = []) => {
      await db.exec(`ALTER TABLE ${table} DISABLE TRIGGER ALL`);
      try {
        await db.query(sql, args);
      } finally {
        await db.exec(`ALTER TABLE ${table} ENABLE TRIGGER ALL`);
      }
    };
    await seed(
      "generation_requests",
      `INSERT INTO generation_requests(id,account_id,workspace_id,project_id,project_revision_id,created_by_user_id,state,queue_order,available_at,idempotency_key,admitted_at,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'ACTIVE',1,now(),'seedance-fixture',now(),now(),now())`,
      [g, a, w, p, r, IDS.userA],
    );
    const unplanned = await call("videoforge_read_hosted_video_jobs", [a, w, g]);
    assert.equal(unplanned.hasPlan, true);
    assert.equal(unplanned.plannedJobCount, null);
    assert.deepEqual(unplanned.jobs, []);
    await seed(
      "generation_requests",
      `INSERT INTO generation_requests(id,account_id,workspace_id,project_id,project_revision_id,created_by_user_id,state,queue_order,available_at,idempotency_key,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'WAITING',2,now(),'legacy-video-fixture',now(),now())`,
      [id(240099), a, w, IDS.projectA, IDS.revisionA, IDS.userA],
    );
    const legacy = await call("videoforge_read_hosted_video_jobs", [a, w, id(240099)]);
    assert.equal(legacy.hasPlan, false);
    assert.equal(legacy.plannedJobCount, null);
    await seed(
      "generation_tasks",
      `INSERT INTO generation_tasks(id,account_id,workspace_id,owner_type,owner_id,project_revision_id,task_key,lane,state) VALUES($1,$2,$3,'PROJECT_REVISION',$4,$4,'image:scene','IMAGE','BLOCKED')`,
      [task, a, w, r],
    );
    await seed(
      "timeline_segments",
      `INSERT INTO timeline_segments(id,account_id,workspace_id,project_revision_id,timeline_plan_id,segment_key,segment_index,start_frame,end_frame_exclusive,source_audio_start_ms,source_audio_end_ms_exclusive,word_start,word_end_exclusive,timeline_composition,in_image_shot_role,narration,required_slots,timeline_plan_hash) VALUES($1,$2,$3,$4,$5,'scene',0,0,6000,0,200000,0,1,'IMAGE_FULL','HANDS_ACTION','Physical demonstration','{"image":{"task_key":"image:scene"}}',$6)`,
      [segment, a, w, r, timeline, hash],
    );
    await seed(
      "hosted_canonical_timing_bridges",
      `INSERT INTO hosted_canonical_timing_bridges(hosted_asr_attempt_id,account_id,workspace_id,project_id,project_revision_id,transcript_id,transcript_document_hash,timeline_plan_id,timeline_document_hash,asr_input_sha256,asr_result_sha256,generation_plan_sha256,task_manifest,append_payload,completed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$7,$7,$7,$7,'[{"id":"${task}","lane":"IMAGE"}]','{"schema_version":"videoforge-hosted-canonical-timing-append/v1"}',now())`,
      [id(240013), a, w, p, r, id(240014), hash, timeline],
    );
    const selection = [
      {
        segmentId: "scene",
        sourceTaskKey: "image:scene",
        videoFrameCount: 300,
        durationSeconds: 10,
      },
    ];
    await assert.rejects(
      call("videoforge_plan_hosted_video_selections", [
        a,
        w,
        r,
        JSON.stringify([{ ...selection[0], videoFrameCount: 421, durationSeconds: 12 }]),
      ]),
      /full image scene|seven percent/,
    );
    await assert.rejects(
      call("videoforge_plan_hosted_video_selections", [
        a,
        w,
        r,
        JSON.stringify([{ ...selection[0], sourceTaskKey: "image:foreign" }]),
      ]),
      /full image scene/,
    );
    const selected = await call("videoforge_plan_hosted_video_selections", [
      a,
      w,
      r,
      JSON.stringify(selection),
    ]);
    assert.equal(selected.selections[0].videoFrameCount, 300);
    const notMaterialized = await call("videoforge_read_hosted_video_jobs", [a, w, g]);
    assert.equal(notMaterialized.plannedJobCount, 1);
    assert.deepEqual(notMaterialized.jobs, []);
    await assert.rejects(
      call("videoforge_plan_hosted_video_selections", [
        a,
        w,
        r,
        JSON.stringify([{ ...selection[0], videoFrameCount: 299 }]),
      ]),
      /replay drift/,
    );
    const sourceKey = `tenant/${a}/workspace/${w}/project/${p}/revision/${r}/lane/mage-image/job/${sourceJob}/artifact/${task}`;
    await seed(
      "hosted_api_generation_jobs",
      `INSERT INTO hosted_api_generation_jobs(id,account_id,workspace_id,project_id,project_revision_id,generation_request_id,generation_task_id,task_key,lane,input_manifest,input_sha256,output_object_key) VALUES($1,$2,$3,$4,$5,$6,$7,'image:scene','IMAGE','{"prompt":"Documentary physical demonstration"}',$8,$9)`,
      [sourceJob, a, w, p, r, g, task, hash, sourceKey],
    );
    const materialized = await call("videoforge_materialize_hosted_video_jobs", [a, w, g]);
    assert.equal(materialized.hasPlan, true);
    assert.equal(materialized.plannedJobCount, 1);
    assert.equal(materialized.jobs.length, 1);
    const j = materialized.jobs[0].id;
    assert.match(j, /^[0-9a-f-]{14}4[0-9a-f]{3}-8/);
    assert.equal(
      (await call("videoforge_claim_hosted_video_job", [a, w, g, j, claim])).state,
      "PREPARED",
    );
    // Pin a source image with its real accepted asset and scoped commit receipt.
    await seed(
      "assets",
      `INSERT INTO assets(id,account_id,workspace_id,project_id,project_revision_id,kind,state,object_key,binary_sha256,content_type,byte_size,width_px,height_px,verified_at) VALUES($1,$2,$3,$4,$5,'IMAGE','ACCEPTED',$6,$7,'image/png',2000,1920,1080,now())`,
      [sourceAsset, a, w, p, r, sourceKey, hash],
    );
    await db.query(
      `INSERT INTO artifact_reservations(id,account_id,workspace_id,project_id,project_revision_id,asset_id,lane,job_id,artifact_id,object_key,method,content_type,content_length,checksum_sha256,expires_at,max_uses,used_count,state,retention_class,deletion_owner_account_id) VALUES($1,$2,$3,$4,$5,$6,'MAGE_IMAGE',$7,$8,$9,'PUT','image/png',2000,$10,now()+interval '1 hour',1,1,'COMMITTED','PROJECT',$2)`,
      [sourceReservation, a, w, p, r, sourceAsset, sourceJob, task, sourceKey, hash],
    );
    await db.query(
      `INSERT INTO artifact_receipts(id,account_id,workspace_id,reservation_id,callback_id,object_key,content_type,content_length,checksum_sha256,probe,receipt_sha256,committed_at) VALUES($1,$2,$3,$4,'source-fixture',$5,'image/png',2000,$6,'{"width":1920,"height":1080}',$6,now())`,
      [sourceReceipt, a, w, sourceReservation, sourceKey, hash],
    );
    await seed(
      "hosted_api_generation_jobs",
      `UPDATE hosted_api_generation_jobs SET state='SUCCEEDED',claim_id=$2,provider_task_id='source-task',output_sha256=$3,output_bytes=2000,output_content_type='image/png',output_asset_id=$4,output_receipt_id=$5,completed_at=now() WHERE id=$1`,
      [sourceJob, claim, hash, sourceAsset, sourceReceipt],
    );
    await seed(
      "provider_workload_leases",
      `INSERT INTO provider_workload_leases(id,slot,account_id,workspace_id,request_kind,generation_request_id,owner_token_sha256,state,acquired_at,heartbeat_at,expires_at) VALUES($1,1,$2,$3,'VIDEO',$4,$5,'ACTIVE',now(),now(),now()+interval '1 hour')`,
      [id(240015), a, w, g, hash],
    );
    await seed(
      "video_runtime_states",
      `INSERT INTO video_runtime_states(id,account_id,workspace_id,project_id,project_revision_id,generation_request_id,stage,preparation_manifest_sha256,admitted_at,prepared_at,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'WAITING_FOR_WORKER',$7,now(),now(),now(),now())`,
      [runtime, a, w, p, r, g, hash],
    );
    const claimed = await call("videoforge_claim_hosted_video_job", [a, w, g, j, claim]);
    assert.equal(claimed.state, "SUBMITTING");
    assert.equal(claimed.inputManifest.sourceImageSha256, hash);
    assert.match(claimed.inputManifest.prompt, /One continuous documentary shot/);
    assert.equal(
      (await call("videoforge_claim_hosted_video_job", [a, w, g, j, id(240016)])).claimId,
      claim,
    );
    await call("videoforge_mark_hosted_video_unknown", [a, w, g, j, claim]);
    assert.equal(
      (await call("videoforge_claim_hosted_video_job", [a, w, g, j, id(240016)])).state,
      "UNKNOWN_NO_RETRY",
    );
    await assert.rejects(
      call("videoforge_record_hosted_video_task", [a, w, g, j, claim, id(999)]),
      /identity drift/,
    );
    await assert.rejects(
      db.query(
        `UPDATE provider_workload_leases SET state='RELEASED',released_at=now(),release_reason='bad' WHERE generation_request_id=$1`,
        [g],
      ),
      /settle before lease release/,
    );
    await call("videoforge_record_hosted_video_task", [a, w, g, j, claim, j]);
    assert.equal(
      (
        await db.query(
          "SELECT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl WHERE p.oid='public.videoforge_record_hosted_video_cost(uuid,uuid,uuid,uuid,numeric)'::regprocedure AND acl.grantee=0 AND acl.privilege_type='EXECUTE') AS allowed",
        )
      ).rows[0].allowed,
      false,
    );
    await assert.rejects(
      call("videoforge_record_hosted_video_cost", [IDS.accountB, IDS.workspaceB, g, j, 0.1336]),
      /video cost invalid/,
    );
    await db.query("SELECT set_config('videoforge.account_id',$1,false)", [IDS.accountB]);
    const foreign = await call("videoforge_read_hosted_video_jobs", [
      IDS.accountB,
      IDS.workspaceB,
      g,
    ]);
    assert.deepEqual(foreign.jobs, []);
    assert.equal(foreign.hasPlan, false);
    assert.equal(foreign.plannedJobCount, null);
    await assert.rejects(
      call("videoforge_record_hosted_video_cost", [IDS.accountB, IDS.workspaceB, g, j, 0.1336]),
      /video cost state or price invalid/,
    );
    await db.query("SELECT set_config('videoforge.account_id',$1,false)", [a]);
    await call("videoforge_record_hosted_video_cost", [a, w, g, j, 0.1336]);
    await assert.rejects(
      call("videoforge_record_hosted_video_cost", [a, w, g, j, 0.14]),
      /cost replay drift/,
    );
    const probe = { width: 1248, height: 704, durationMs: 10000 };
    await assert.rejects(
      call("videoforge_commit_hosted_video_output", [
        a,
        w,
        g,
        j,
        hash,
        2000,
        "video/mp4",
        JSON.stringify({ ...probe, width: 1280 }),
        0.1336,
      ]),
      /contract or price/,
    );
    await db.exec("BEGIN; SAVEPOINT paid_video");
    const result = await call("videoforge_commit_hosted_video_output", [
      a,
      w,
      g,
      j,
      hash,
      2000,
      "video/mp4",
      JSON.stringify(probe),
      0.1336,
    ]);
    assert.equal(result.state, "SUCCEEDED");
    assert.equal(result.outputCostUsd, 0.1336);
    assert.equal(
      (
        await call("videoforge_commit_hosted_video_output", [
          a,
          w,
          g,
          j,
          hash,
          2000,
          "video/mp4",
          JSON.stringify(probe),
          0.1336,
        ])
      ).id,
      j,
    );
    await db.exec("SAVEPOINT invalid_replay");
    await assert.rejects(
      call("videoforge_commit_hosted_video_output", [
        a,
        w,
        g,
        j,
        hash,
        2001,
        "video/mp4",
        JSON.stringify(probe),
        0.1336,
      ]),
      /replay drift/,
    );
    await db.exec("ROLLBACK TO SAVEPOINT invalid_replay");
    assert.equal(
      (await db.query("SELECT state FROM hosted_api_generation_jobs WHERE id=$1", [sourceJob]))
        .rows[0].state,
      "SUCCEEDED",
    );
    assert.equal(await call("videoforge_hosted_videos_ready", [a, w, g]), true);
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int n FROM artifact_receipts WHERE object_key LIKE '%/lane/scene-video/%'",
        )
      ).rows[0].n,
      1,
    );
    const outputAsset = (
      await db.query("SELECT output_asset_id FROM hosted_video_jobs WHERE id=$1", [j])
    ).rows[0].output_asset_id;
    const manifest = {
      schema_version: "resolved-render-manifest/v2",
      segments: [
        {
          segment_id: "scene",
          timeline_composition: "IMAGE_FULL",
          accepted_assets: {
            image: { asset_id: sourceAsset, sha256: hash },
            video: { asset_id: outputAsset, sha256: hash },
          },
          render: { video_source_profile: "seedance-pro-fast-1248x704-v1", video_frame_count: 300 },
        },
      ],
    };
    assert.equal(
      await call("videoforge_hosted_video_manifest_valid", [a, w, g, JSON.stringify(manifest)]),
      true,
    );
    assert.equal(
      await call("videoforge_hosted_video_manifest_valid", [
        a,
        w,
        g,
        JSON.stringify({ ...manifest, schema_version: "resolved-render-manifest/v1" }),
      ]),
      false,
    );
    assert.equal(
      await call("videoforge_hosted_video_manifest_valid", [
        a,
        w,
        g,
        JSON.stringify({
          ...manifest,
          segments: [
            {
              ...manifest.segments[0],
              render: { ...manifest.segments[0].render, video_frame_count: 299 },
            },
          ],
        }),
      ]),
      false,
    );

    assert.equal(
      (
        await db.query(
          "SELECT state FROM provider_workload_leases WHERE generation_request_id=$1",
          [g],
        )
      ).rows[0].state,
      "ACTIVE",
    );
    await db.exec("ROLLBACK TO SAVEPOINT paid_video");
    // Existing lane completions remain independently accepted; last VIDEO closes the combined barrier.
    for (const [n, lane] of [
      [240020, "mage_image"],
      [240021, "soulx_avatar"],
    ])
      await seed(
        "video_runtime_lane_states",
        `INSERT INTO video_runtime_lane_states(id,account_id,workspace_id,runtime_id,project_revision_id,lane,state,items_manifest_sha256,planned_item_count,accepted_item_count,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'SUCCEEDED',$7,0,0,now(),now())`,
        [id(n), a, w, runtime, r, lane, hash],
      );
    await db.query("UPDATE global_generation_capacity SET active_lease_count=1");
    await call("videoforge_commit_hosted_video_output", [
      a,
      w,
      g,
      j,
      hash,
      2000,
      "video/mp4",
      JSON.stringify(probe),
      0.1336,
    ]);
    assert.equal(
      (await db.query("SELECT stage FROM video_runtime_states WHERE id=$1", [runtime])).rows[0]
        .stage,
      "RENDERING",
    );
    assert.equal(
      (
        await db.query(
          "SELECT state FROM provider_workload_leases WHERE generation_request_id=$1",
          [g],
        )
      ).rows[0].state,
      "RELEASED",
    );
    await db.exec("ROLLBACK TO SAVEPOINT paid_video");
    await db.query("UPDATE global_generation_capacity SET active_lease_count=1");
    const stop = (
      await db.query("SELECT * FROM videoforge_cancel_hosted_project_predispatch($1,$2,$3)", [
        a,
        w,
        p,
      ])
    ).rows[0];
    assert.equal(stop.state, "CANCELLING");
    assert.equal(
      (await call("videoforge_read_hosted_video_jobs", [a, w, g])).requestState,
      "CANCELLING",
    );
    assert.equal(
      (await call("videoforge_settle_hosted_video_cancellation", [a, w, g])).state,
      "WAITING",
    );
    await call("videoforge_commit_hosted_video_output", [
      a,
      w,
      g,
      j,
      hash,
      2000,
      "video/mp4",
      JSON.stringify(probe),
      0.1336,
    ]);
    assert.equal(
      (await call("videoforge_settle_hosted_video_cancellation", [a, w, g])).state,
      "SETTLED",
    );
    assert.equal(
      (await db.query("SELECT state FROM generation_requests WHERE id=$1", [g])).rows[0].state,
      "CANCELLED",
    );
    assert.equal(
      (await db.query("SELECT state FROM hosted_video_jobs WHERE id=$1", [j])).rows[0].state,
      "SUCCEEDED",
    );
    assert.equal(
      (await db.query("SELECT state FROM hosted_api_generation_jobs WHERE id=$1", [sourceJob]))
        .rows[0].state,
      "SUCCEEDED",
    );

    await db.exec("ROLLBACK");
  } finally {
    await db.close();
  }
});

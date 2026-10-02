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
const costSource = readFileSync(
  new URL("../migrations/0241_hosted_seedance_video_cost.sql", import.meta.url),
  "utf8",
);
const noTaskSource = readFileSync(
  new URL("../migrations/0242_hosted_seedance_video_unknown_no_task.sql", import.meta.url),
  "utf8",
);
const firstPostSource = readFileSync(
  new URL("../migrations/0243_hosted_seedance_video_first_post.sql", import.meta.url),
  "utf8",
);
const fallbackSource = readFileSync(
  new URL("../migrations/0244_hosted_seedance_video_static_fallback.sql", import.meta.url),
  "utf8",
);
const readerGrantSource = readFileSync(
  new URL("../migrations/0245_hosted_seedance_video_render_reader_grant.sql", import.meta.url),
  "utf8",
);
const segmentSource = readFileSync(
  new URL("../migrations/0246_hosted_seedance_video_canonical_segment.sql", import.meta.url),
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
  assert.deepEqual(
    manifest.migrations.find((entry) => entry.version === 241),
    {
      version: 241,
      name: "hosted_seedance_video_cost",
      filename: "0241_hosted_seedance_video_cost.sql",
      sha256: `sha256:${createHash("sha256").update(costSource).digest("hex")}`,
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
    await executor.execute(costSource);
    await executor.execute(noTaskSource);
    await executor.execute(firstPostSource);
    await executor.execute(fallbackSource);
    // CREATE after RENAME changed the reader OID: 0192's reconciler grant stayed
    // on the predecessor. Reproduce the actual caller-role denial before repair.
    const readerSignature = "videoforge_read_hosted_v209_ready_render_inputs(uuid,uuid,uuid)";
    const readerRole = "videoforge_v209_reconciler_dc9612d6";
    assert.equal(
      (
        await db.query("SELECT has_function_privilege($1,$2,'EXECUTE') allowed", [
          readerRole,
          readerSignature,
        ])
      ).rows[0].allowed,
      false,
    );
    assert.equal(
      (
        await db.query(
          "SELECT has_function_privilege($1,'videoforge_read_hosted_v209_ready_render_inputs_before_video(uuid,uuid,uuid)','EXECUTE') allowed",
          [readerRole],
        )
      ).rows[0].allowed,
      true,
    );
    await db.exec("BEGIN; SET LOCAL ROLE videoforge_v209_reconciler_dc9612d6");
    await assert.rejects(
      db.query("SELECT videoforge_read_hosted_v209_ready_render_inputs($1,$2,$3)", [
        IDS.accountA,
        IDS.workspaceA,
        id(999),
      ]),
      /permission denied for function videoforge_read_hosted_v209_ready_render_inputs/,
    );
    await db.exec("ROLLBACK");
    await executor.execute(readerGrantSource);
    assert.equal(
      (
        await db.query("SELECT has_function_privilege($1,$2,'EXECUTE') allowed", [
          readerRole,
          readerSignature,
        ])
      ).rows[0].allowed,
      true,
    );
    // The fix grants no table writes, helper entrypoints or operator recovery.
    for (const signature of [
      "videoforge_hosted_videos_ready(uuid,uuid,uuid)",
      "videoforge_hosted_video_manifest_valid(uuid,uuid,uuid,jsonb)",
      "videoforge_reconcile_hosted_video_unknown_no_task(uuid,uuid,uuid,uuid,uuid,text,text,text)",
      "videoforge_authorize_hosted_video_first_post(uuid,uuid,uuid,uuid,uuid,text,text,text,numeric)",
    ])
      assert.equal(
        (
          await db.query("SELECT has_function_privilege($1,$2,'EXECUTE') allowed", [
            readerRole,
            signature,
          ])
        ).rows[0].allowed,
        false,
      );
    assert.equal(
      (
        await db.query("SELECT has_table_privilege($1,'hosted_video_jobs','UPDATE') allowed", [
          readerRole,
        ])
      ).rows[0].allowed,
      false,
    );

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
    // Cloud ASR recovery creates a fresh successor before generation. Its guarded
    // application pin must retain the saved choice without opting legacy videos in.
    const successor = id(240030),
      legacyParent = id(240031),
      legacySuccessor = id(240032);
    for (const [revisionId, revisionNumber] of [
      [successor, 2],
      [legacyParent, 3],
      [legacySuccessor, 4],
    ]) {
      await db.query(
        `INSERT INTO project_revisions SELECT (jsonb_populate_record(NULL::project_revisions,to_jsonb(rev)||jsonb_build_object('id',$1::text,'revision_number',$2::integer,'created_at',now(),'locked_at',now()))).* FROM project_revisions rev WHERE rev.id=$3`,
        [revisionId, revisionNumber, r],
      );
    }
    const recoverPlan = async (revisionId, priorRevisionId) =>
      db.query(
        `SELECT public.videoforge_pin_hosted_video_plan($1::uuid,$2::uuid,$3::uuid) AS plan
           WHERE EXISTS(SELECT 1 FROM hosted_video_plans
             WHERE account_id=$1 AND workspace_id=$2 AND project_revision_id=$4::uuid)`,
        [a, w, revisionId, priorRevisionId],
      );
    const inherited = (await recoverPlan(successor, r)).rows[0].plan;
    assert.equal(inherited.project_revision_id, successor);
    assert.equal(inherited.coverage_percent, 7);
    assert.equal(inherited.model, plan.model);
    assert.equal(inherited.selections, null, "fresh canonical timing must select its own scenes");
    assert.deepEqual((await recoverPlan(successor, r)).rows[0].plan, inherited);
    assert.equal((await recoverPlan(legacySuccessor, legacyParent)).rows.length, 0);
    assert.equal((await recoverPlan(legacySuccessor, legacyParent)).rows.length, 0);
    assert.deepEqual(
      (
        await db.query(
          "SELECT project_revision_id FROM hosted_video_plans WHERE account_id=$1 AND workspace_id=$2 AND project_revision_id=ANY($3::uuid[]) ORDER BY project_revision_id",
          [a, w, [successor, legacyParent, legacySuccessor]],
        )
      ).rows,
      [{ project_revision_id: successor }],
    );
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
    const firstPost = (overrides = {}) =>
      call("videoforge_authorize_hosted_video_first_post", [
        overrides.account ?? a,
        overrides.workspace ?? w,
        overrides.request ?? g,
        overrides.job ?? j,
        overrides.claim ?? claim,
        overrides.input ?? claimed.inputSha256,
        overrides.evidence ?? hash,
        overrides.reason ?? "WORKER_FETCH_REJECTED_BEFORE_NETWORK",
        overrides.budget ?? 1,
      ]);
    for (const overrides of [
      { account: IDS.accountB },
      { workspace: IDS.workspaceB },
      { request: id(999) },
      { job: id(999) },
      { claim: id(999) },
      { input: hash },
      { evidence: "invalid" },
      { reason: "TASK_NOT_FOUND" },
      { budget: 0 },
      { budget: -1 },
      { budget: 4.01 },
      { budget: 0.1 },
      { budget: "NaN" },
      { budget: "Infinity" },
    ])
      await assert.rejects(firstPost(overrides), /video first POST/);
    for (const role of ["videoforge_v209_runtime_dc9612d6", "videoforge_v209_reconciler_dc9612d6"])
      assert.equal(
        (
          await db.query(
            "SELECT has_function_privilege($1,'videoforge_authorize_hosted_video_first_post(uuid,uuid,uuid,uuid,uuid,text,text,text,numeric)','EXECUTE') AS allowed",
            [role],
          )
        ).rows[0].allowed,
        false,
      );
    await db.exec("BEGIN; SAVEPOINT first_post");
    await db.exec("SET LOCAL ROLE videoforge_v209_runtime_dc9612d6");
    await assert.rejects(firstPost(), /permission denied/);
    await db.exec("ROLLBACK TO SAVEPOINT first_post");
    await call("videoforge_record_hosted_video_cost", [a, w, g, j, 0.01]);
    await db.exec("SAVEPOINT charged_first_post");
    await assert.rejects(firstPost(), /state lease or budget invalid/);
    await db.exec("ROLLBACK TO SAVEPOINT first_post");
    await call("videoforge_record_hosted_video_task", [a, w, g, j, claim, j]);
    await db.exec("SAVEPOINT acknowledged_first_post");
    await assert.rejects(firstPost(), /state lease or budget invalid/);
    await db.exec("ROLLBACK TO SAVEPOINT first_post");
    const pendingSibling = async (n) => {
      const sibling = id(n),
        siblingInput = {
          ...claimed.inputManifest,
          taskUUID: sibling,
          durationSeconds: 2,
          videoFrameCount: 60,
          segmentId: `pending-${n}`,
        };
      await db.query(
        `INSERT INTO hosted_video_jobs(id,account_id,workspace_id,project_id,project_revision_id,generation_request_id,segment_id,source_task_key,video_frame_count,duration_seconds,state,claim_id,provider_task_id,input_manifest,input_sha256,source_api_job_id,source_asset_id,source_sha256,output_object_key) VALUES($1::uuid,$2,$3,$4,$5,$6,$7,'image:scene',60,2,'SUBMITTED',$8,$1::uuid::text,$9::jsonb,'sha256:'||encode(sha256(convert_to(videoforge_canonical_jsonb($9::jsonb),'UTF8')),'hex'),$10,$11,$12,$13)`,
        [
          sibling,
          a,
          w,
          p,
          r,
          g,
          `pending-${n}`,
          claim,
          JSON.stringify(siblingInput),
          sourceJob,
          sourceAsset,
          hash,
          `tenant/${a}/workspace/${w}/project/${p}/revision/${r}/lane/scene-video/job/${sibling}/artifact/${sibling}`,
        ],
      );
      return sibling;
    };
    const overpricedSibling = await pendingSibling(240060);
    await call("videoforge_record_hosted_video_cost", [a, w, g, overpricedSibling, 0.2]);
    await db.exec("SAVEPOINT price_fence_first_post");
    await assert.rejects(firstPost(), /state lease or budget invalid/);
    await db.exec("ROLLBACK TO SAVEPOINT first_post");
    for (const n of [240060, 240061, 240062, 240063]) await pendingSibling(n);
    await db.exec("SAVEPOINT capacity_first_post");
    await assert.rejects(firstPost(), /state lease or budget invalid/);
    await db.exec("ROLLBACK TO SAVEPOINT first_post");
    await db.query("DELETE FROM provider_workload_leases WHERE generation_request_id=$1", [g]);
    await db.exec("SAVEPOINT absent_lease_first_post");
    await assert.rejects(firstPost(), /state lease or budget invalid/);
    await db.exec("ROLLBACK TO SAVEPOINT first_post");
    await db.query(
      "UPDATE artifact_receipts SET deleted_at=now(),deletion_reason='fixture tombstone' WHERE id=$1",
      [sourceReceipt],
    );
    await db.exec("SAVEPOINT missing_source_first_post");
    await assert.rejects(firstPost(), /accepted source invalid/);
    await db.exec("ROLLBACK TO SAVEPOINT first_post");
    const authorized = await firstPost();
    assert.equal(authorized.authorized, true);
    assert.equal(authorized.job.state, "SUBMITTING");
    assert.equal(authorized.job.claimId, claim);
    assert.equal(authorized.job.id, j);
    assert.deepEqual(authorized.job.inputManifest, claimed.inputManifest);
    assert.equal(authorized.job.inputSha256, claimed.inputSha256);
    assert.equal(authorized.job.providerTaskId, null);
    assert.equal((await firstPost()).authorized, false);
    await call("videoforge_mark_hosted_video_unknown", [a, w, g, j, claim]);
    assert.equal(
      (await firstPost()).authorized,
      false,
      "a later uncertain response never reauthorizes POST",
    );
    const intent = (
      await db.query(
        "SELECT result_payload FROM repository_mutation_receipts WHERE workspace_id=$1 AND idempotency_key=$2",
        [w, `seedance-first-post:${j}`],
      )
    ).rows[0].result_payload;
    assert.equal(intent.input_sha256, claimed.inputSha256);
    assert.equal(intent.evidence_sha256, hash);
    assert.equal(intent.remaining_budget_usd, 1);
    assert.equal(intent.quote_usd, 0.1336);
    assert.equal(
      (
        await db.query(
          "SELECT state FROM provider_workload_leases WHERE generation_request_id=$1",
          [g],
        )
      ).rows[0].state,
      "ACTIVE",
    );
    assert.equal(
      (await db.query("SELECT state FROM hosted_api_generation_jobs WHERE id=$1", [sourceJob]))
        .rows[0].state,
      "SUCCEEDED",
    );
    assert.deepEqual(
      (
        await db.query("SELECT selections FROM hosted_video_plans WHERE project_revision_id=$1", [
          r,
        ])
      ).rows[0].selections,
      selection,
    );
    await db.exec("SAVEPOINT first_post_drift");
    await assert.rejects(
      firstPost({ evidence: "sha256:" + "b".repeat(64) }),
      /evidence replay drift/,
    );
    await db.exec("ROLLBACK TO SAVEPOINT first_post_drift");
    await db.exec("ROLLBACK");
    // Operator closure requires a saved exact-provider absence receipt. It cannot
    // become an ordinary retry path or discard acknowledged/charged work.
    const closeUnknown = (overrides = {}) =>
      call("videoforge_reconcile_hosted_video_unknown_no_task", [
        overrides.account ?? a,
        overrides.workspace ?? w,
        overrides.request ?? g,
        overrides.job ?? j,
        overrides.claim ?? claim,
        overrides.state ?? "UNKNOWN_NO_RETRY",
        overrides.reason ?? "RUNWARE_ARCHIVE_CONFIRMED_NO_TASK",
        overrides.evidence ?? hash,
      ]);
    for (const overrides of [
      { claim: id(999) },
      { job: id(999) },
      { request: id(999) },
      { workspace: IDS.workspaceB },
      { state: "SUBMITTED" },
      { reason: "TASK_NOT_FOUND" },
      { evidence: "invalid" },
      { account: IDS.accountB },
    ])
      await assert.rejects(closeUnknown(overrides), /reconciliation|scope invalid/);
    assert.equal(
      (
        await db.query(
          "SELECT has_function_privilege('videoforge_v209_runtime_dc9612d6','videoforge_reconcile_hosted_video_unknown_no_task(uuid,uuid,uuid,uuid,uuid,text,text,text)','EXECUTE') AS allowed",
        )
      ).rows[0].allowed,
      false,
    );
    assert.equal(
      (
        await db.query(
          "SELECT has_function_privilege('videoforge_v209_reconciler_dc9612d6','videoforge_reconcile_hosted_video_unknown_no_task(uuid,uuid,uuid,uuid,uuid,text,text,text)','EXECUTE') AS allowed",
        )
      ).rows[0].allowed,
      false,
    );
    await db.exec("BEGIN; SAVEPOINT no_task");
    await db.exec("SET LOCAL ROLE videoforge_v209_runtime_dc9612d6");
    await db.query("SELECT set_config('videoforge.account_id',$1,true)", [IDS.accountB]);
    assert.equal(
      (
        await db.query("SELECT count(*)::integer AS visible FROM hosted_video_jobs WHERE id=$1", [
          j,
        ])
      ).rows[0].visible,
      0,
    );
    await db.exec("SAVEPOINT denied_operator");
    await assert.rejects(closeUnknown(), /permission denied/);
    await db.exec("ROLLBACK TO SAVEPOINT no_task");
    await call("videoforge_record_hosted_video_cost", [a, w, g, j, 0.01]);
    await db.exec("SAVEPOINT charged_no_task");
    await assert.rejects(closeUnknown(), /identity or cost invalid/);
    await db.exec("ROLLBACK TO SAVEPOINT no_task");
    await call("videoforge_record_hosted_video_task", [a, w, g, j, claim, j]);
    await db.exec("SAVEPOINT acknowledged_no_task");
    await assert.rejects(closeUnknown(), /identity or cost invalid/);
    await db.exec("ROLLBACK TO SAVEPOINT no_task");
    await call("videoforge_record_hosted_video_cost", [a, w, g, j, 0]);
    assert.equal((await closeUnknown()).outputCostUsd, 0);
    await db.exec("ROLLBACK TO SAVEPOINT no_task");
    const closed = await closeUnknown();
    assert.equal(closed.state, "FAILED");
    assert.equal(closed.failureCode, "RUNWARE_ARCHIVE_CONFIRMED_NO_TASK");
    assert.equal(closed.claimId, claim);
    assert.equal(closed.providerTaskId, null);
    assert.equal(closed.outputCostUsd, null);
    assert.deepEqual(closed.inputManifest, claimed.inputManifest);
    assert.deepEqual(await closeUnknown(), closed);
    const proof = (
      await db.query(
        "SELECT result_payload FROM repository_mutation_receipts WHERE workspace_id=$1 AND idempotency_key=$2",
        [w, `seedance-no-task:${j}`],
      )
    ).rows[0].result_payload;
    assert.equal(proof.evidence_sha256, hash);
    assert.equal(proof.job_id, j);
    assert.equal(
      (
        await db.query(
          "SELECT state FROM provider_workload_leases WHERE generation_request_id=$1",
          [g],
        )
      ).rows[0].state,
      "ACTIVE",
    );
    assert.equal(
      (await db.query("SELECT state FROM generation_requests WHERE id=$1", [g])).rows[0].state,
      "ACTIVE",
    );
    assert.equal(
      (await db.query("SELECT state FROM hosted_api_generation_jobs WHERE id=$1", [sourceJob]))
        .rows[0].state,
      "SUCCEEDED",
    );
    await db.exec("SAVEPOINT no_task_drift");
    await assert.rejects(closeUnknown({ evidence: "sha256:" + "b".repeat(64) }), /replay drift/);
    await db.exec("ROLLBACK TO SAVEPOINT no_task_drift");
    await db.exec("ROLLBACK");
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
    for (const invalidCost of ["NaN", "Infinity", "-Infinity", "-1"])
      await assert.rejects(
        call("videoforge_record_hosted_video_cost", [a, w, g, j, invalidCost]),
        /video cost invalid/,
      );
    // An invoice remains durable when price policy rejects it. Existing native gates
    // stop unpaid siblings and release admission only after paid work is terminal.
    for (const actualCost of [0.2, 1.25]) {
      await db.exec("BEGIN; SAVEPOINT unexpected_invoice");
      const sibling = id(240050),
        futureTask = id(240051),
        futureApi = id(240052);
      await db.query(
        `INSERT INTO hosted_video_jobs(id,account_id,workspace_id,project_id,project_revision_id,generation_request_id,segment_id,source_task_key,video_frame_count,duration_seconds,output_object_key) VALUES($1,$2,$3,$4,$5,$6,'cost-future','image:scene',60,2,$7)`,
        [
          sibling,
          a,
          w,
          p,
          r,
          g,
          `tenant/${a}/workspace/${w}/project/${p}/revision/${r}/lane/scene-video/job/${sibling}/artifact/${sibling}`,
        ],
      );
      await seed(
        "generation_tasks",
        `INSERT INTO generation_tasks(id,account_id,workspace_id,owner_type,owner_id,project_revision_id,task_key,lane,state) VALUES($1,$2,$3,'PROJECT_REVISION',$4,$4,'image:cost-future','IMAGE','BLOCKED')`,
        [futureTask, a, w, r],
      );
      await seed(
        "hosted_api_generation_jobs",
        `INSERT INTO hosted_api_generation_jobs(id,account_id,workspace_id,project_id,project_revision_id,generation_request_id,generation_task_id,task_key,lane,input_manifest,input_sha256,output_object_key) VALUES($1,$2,$3,$4,$5,$6,$7,'image:cost-future','IMAGE','{"prompt":"Documentary physical demonstration"}',$8,$9)`,
        [
          futureApi,
          a,
          w,
          p,
          r,
          g,
          futureTask,
          hash,
          `tenant/${a}/workspace/${w}/project/${p}/revision/${r}/lane/mage-image/job/${futureApi}/artifact/${futureTask}`,
        ],
      );
      assert.equal(
        (await call("videoforge_record_hosted_video_cost", [a, w, g, j, actualCost])).outputCostUsd,
        actualCost,
      );
      assert.equal(
        (await call("videoforge_claim_hosted_video_job", [a, w, g, sibling, claim])).state,
        "PREPARED",
      );
      assert.equal(
        (await call("videoforge_claim_hosted_api_job", [a, w, g, futureTask, claim])).state,
        "PREPARED",
      );
      assert.equal(
        (await call("videoforge_claim_hosted_video_job", [a, w, g, j, claim])).state,
        "SUBMITTED",
      );
      assert.equal(
        (await call("videoforge_claim_hosted_api_job", [a, w, g, task, claim])).state,
        "SUCCEEDED",
      );
      await db.exec("SAVEPOINT cost_drift");
      await assert.rejects(
        call("videoforge_record_hosted_video_cost", [a, w, g, j, actualCost + 0.01]),
        /cost replay drift/,
      );
      await db.exec("ROLLBACK TO SAVEPOINT cost_drift");
      await db.exec("SAVEPOINT cost_output");
      await assert.rejects(
        call("videoforge_commit_hosted_video_output", [
          a,
          w,
          g,
          j,
          hash,
          2000,
          "video/mp4",
          JSON.stringify({ width: 1248, height: 704, durationMs: 10000 }),
          actualCost,
        ]),
        actualCost > 1 ? /video output invalid/ : /contract or price/,
      );
      await db.exec("ROLLBACK TO SAVEPOINT cost_output");
      await call("videoforge_fail_hosted_video_job", [a, w, g, j, "SEEDANCE_PRICE_CHANGED"]);
      assert.equal(
        (await call("videoforge_record_hosted_video_cost", [a, w, g, j, actualCost])).outputCostUsd,
        actualCost,
      );
      await db.query("UPDATE global_generation_capacity SET active_lease_count=1");
      assert.equal(
        (await call("videoforge_settle_hosted_api_failure", [a, w, g])).state,
        "SETTLED",
      );
      assert.equal(
        (
          await db.query(
            "SELECT output_cost_usd::float8 AS cost FROM hosted_video_jobs WHERE id=$1",
            [j],
          )
        ).rows[0].cost,
        actualCost,
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
      assert.equal(
        (await db.query("SELECT state FROM hosted_api_generation_jobs WHERE id=$1", [sourceJob]))
          .rows[0].state,
        "SUCCEEDED",
      );
      await db.exec("ROLLBACK");
    }
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
    // Definite optional failures retain the original image and actual charge. Unknown,
    // cancellation, operator closure and unexpected invoices cannot become a fallback.
    for (const code of [
      "SEEDANCE_RESULT_INVALID",
      "SEEDANCE_CLIP_TOO_SHORT",
      "SEEDANCE_PROVIDER_FAILED",
      "SEEDANCE_SUBMIT_REJECTED",
      "SEEDANCE_INPUT_INVALID",
    ])
      assert.equal(
        await call("videoforge_hosted_video_static_fallback", ["FAILED", code, 0.1336, 10]),
        true,
      );
    for (const [state, code, cost, duration] of [
      ["UNKNOWN_NO_RETRY", "SEEDANCE_RESULT_INVALID", 0.1336, 10],
      ["SUCCEEDED", "SEEDANCE_RESULT_INVALID", 0.1336, 10],
      ["FAILED", "SEEDANCE_PRICE_CHANGED", 0.1336, 10],
      ["FAILED", "OWNER_CANCELLED", 0, 10],
      ["FAILED", "RUNWARE_ARCHIVE_CONFIRMED_NO_TASK", 0, 10],
      ["FAILED", "SEEDANCE_RESULT_INVALID", 1.25, 10],
      ["FAILED", "SEEDANCE_RESULT_INVALID", "NaN", 10],
      ["FAILED", "SEEDANCE_RESULT_INVALID", "Infinity", 10],
      ["FAILED", "SEEDANCE_RESULT_INVALID", -1, 10],
      ["FAILED", "SEEDANCE_RESULT_INVALID", 0, "NaN"],
    ])
      assert.equal(
        await call("videoforge_hosted_video_static_fallback", [state, code, cost, duration]),
        false,
      );
    const staticManifest = {
      schema_version: "resolved-render-manifest/v1",
      segments: [
        {
          segment_id: "scene",
          timeline_composition: "IMAGE_FULL",
          accepted_assets: { image: { asset_id: sourceAsset, sha256: hash } },
          render: {},
        },
      ],
    };
    const originalPlan = (
      await db.query(
        "SELECT to_jsonb(p) value FROM hosted_video_plans p WHERE project_revision_id=$1",
        [r],
      )
    ).rows[0].value;
    await db.exec("BEGIN; SAVEPOINT fallback_cases");
    const failedStatic = await call("videoforge_fail_hosted_video_job", [
      a,
      w,
      g,
      j,
      "SEEDANCE_RESULT_INVALID",
    ]);
    assert.equal(failedStatic.staticFallback, true);
    assert.equal(failedStatic.state, "FAILED");
    assert.equal(failedStatic.outputCostUsd, 0.1336);
    assert.equal(
      (await call("videoforge_settle_hosted_api_failure", [a, w, g])).state,
      "NO_FAILURE",
    );
    assert.deepEqual(failedStatic.inputManifest, claimed.inputManifest);
    assert.equal(await call("videoforge_hosted_videos_ready", [a, w, g]), true);
    assert.equal(await call("videoforge_hosted_videos_ready", [IDS.accountB, w, g]), false);
    assert.equal(
      await call("videoforge_hosted_video_manifest_valid", [
        a,
        w,
        g,
        JSON.stringify(staticManifest),
      ]),
      true,
    );
    assert.equal(
      await call("videoforge_hosted_video_manifest_valid", [
        a,
        w,
        g,
        JSON.stringify({
          ...staticManifest,
          segments: [
            {
              ...staticManifest.segments[0],
              accepted_assets: { image: { asset_id: id(999), sha256: hash } },
            },
          ],
        }),
      ]),
      false,
    );
    assert.equal(
      await call("videoforge_hosted_video_manifest_valid", [
        a,
        w,
        g,
        JSON.stringify({ ...staticManifest, schema_version: "resolved-render-manifest/v2" }),
      ]),
      false,
    );
    assert.equal(
      (await db.query("SELECT count(*)::int n FROM assets WHERE kind='VIDEO_CLIP'")).rows[0].n,
      0,
    );
    assert.deepEqual(
      (
        await db.query(
          "SELECT to_jsonb(p) value FROM hosted_video_plans p WHERE project_revision_id=$1",
          [r],
        )
      ).rows[0].value,
      originalPlan,
    );
    assert.equal(
      (
        await db.query(
          "SELECT state FROM provider_workload_leases WHERE generation_request_id=$1",
          [g],
        )
      ).rows[0].state,
      "ACTIVE",
      "original lanes must complete before release",
    );
    // Minimal committed-manifest metadata lets the native input gate prove the
    // all-static v1 exception is exact-hash-bound, not a generalized v1 bypass.
    await seed(
      "hosted_v209_ordinary_resolved_render_manifests",
      `INSERT INTO hosted_v209_ordinary_resolved_render_manifests(generation_request_id,account_id,workspace_id,project_id,project_revision_id,asset_id,reservation_id,manifest_sha256,manifest_document,object_key,content_length,receipt_sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,'manifest-fixture',100,$8)`,
      [g, a, w, p, r, sourceAsset, sourceReservation, hash, JSON.stringify(staticManifest)],
    );
    const staticRenderInput = {
      schema_version: "render-job-input/v1",
      resolved_render_manifest: { sha256: hash },
    };
    assert.equal(
      await call("videoforge_hosted_video_render_input_valid", [
        a,
        w,
        r,
        JSON.stringify(staticRenderInput),
      ]),
      true,
    );
    assert.equal(
      await call("videoforge_hosted_video_render_input_valid", [
        a,
        w,
        r,
        JSON.stringify({
          ...staticRenderInput,
          resolved_render_manifest: { sha256: "sha256:" + "b".repeat(64) },
        }),
      ]),
      false,
    );
    await db.exec("SAVEPOINT missing_static_source");
    await db.query(
      "UPDATE artifact_receipts SET deleted_at=now(),deletion_reason='OWNER_DELETE' WHERE id=$1",
      [sourceReceipt],
    );
    assert.equal(await call("videoforge_hosted_videos_ready", [a, w, g]), false);
    await db.exec("ROLLBACK TO SAVEPOINT missing_static_source");
    await db.exec("SAVEPOINT immutable_static");
    await assert.rejects(
      db.query("UPDATE hosted_video_jobs SET state='PREPARED' WHERE id=$1", [j]),
      /immutable/,
    );
    await db.exec("ROLLBACK TO SAVEPOINT immutable_static");
    await db.exec("ROLLBACK TO SAVEPOINT fallback_cases");
    for (const code of [
      "SEEDANCE_PRICE_CHANGED",
      "OWNER_CANCELLED",
      "RUNWARE_ARCHIVE_CONFIRMED_NO_TASK",
    ]) {
      await call("videoforge_fail_hosted_video_job", [a, w, g, j, code]);
      assert.equal(await call("videoforge_hosted_videos_ready", [a, w, g]), false);
      assert.equal(
        await call("videoforge_hosted_video_manifest_valid", [
          a,
          w,
          g,
          JSON.stringify(staticManifest),
        ]),
        false,
      );
      await db.exec("ROLLBACK TO SAVEPOINT fallback_cases");
    }
    // A permitted failed sibling leaves remaining PREPARED jobs eligible for their
    // first paid claim; a partial accepted subset maps to v2 with the original still.
    const sibling = id(244001);
    await seed(
      "hosted_video_plans",
      "UPDATE hosted_video_plans SET selections=selections||$2::jsonb WHERE project_revision_id=$1",
      [
        r,
        JSON.stringify([
          {
            segmentId: "scene-next",
            sourceTaskKey: "image:scene",
            videoFrameCount: 60,
            durationSeconds: 2,
          },
        ]),
      ],
    );
    await db.query(
      `INSERT INTO hosted_video_jobs(id,account_id,workspace_id,project_id,project_revision_id,generation_request_id,segment_id,source_task_key,video_frame_count,duration_seconds,output_object_key)
      SELECT $2::uuid,account_id,workspace_id,project_id,project_revision_id,generation_request_id,'scene-next',source_task_key,60,2,
       'tenant/'||account_id||'/workspace/'||workspace_id||'/project/'||project_id||'/revision/'||project_revision_id||'/lane/scene-video/job/'||$2::uuid||'/artifact/'||$2::uuid FROM hosted_video_jobs WHERE id=$1`,
      [j, sibling],
    );
    await call("videoforge_fail_hosted_video_job", [a, w, g, j, "SEEDANCE_RESULT_INVALID"]);
    assert.equal(await call("videoforge_hosted_videos_ready", [a, w, g]), false);
    const nextClaim = await call("videoforge_claim_hosted_video_job", [a, w, g, sibling, claim]);
    assert.equal(nextClaim.state, "SUBMITTING");
    await call("videoforge_record_hosted_video_task", [a, w, g, sibling, claim, sibling]);
    await call("videoforge_record_hosted_video_cost", [a, w, g, sibling, 0.02672]);
    const acceptedNext = await call("videoforge_commit_hosted_video_output", [
      a,
      w,
      g,
      sibling,
      hash,
      2000,
      "video/mp4",
      JSON.stringify({ width: 1248, height: 704, durationMs: 2000 }),
      0.02672,
    ]);
    assert.equal(acceptedNext.state, "SUCCEEDED");
    assert.equal(await call("videoforge_hosted_videos_ready", [a, w, g]), true);
    const siblingAsset = (
      await db.query("SELECT output_asset_id FROM hosted_video_jobs WHERE id=$1", [sibling])
    ).rows[0].output_asset_id;
    const mixedManifest = {
      schema_version: "resolved-render-manifest/v2",
      segments: [
        staticManifest.segments[0],
        {
          segment_id: "scene-next",
          timeline_composition: "IMAGE_FULL",
          accepted_assets: {
            image: { asset_id: sourceAsset, sha256: hash },
            video: { asset_id: siblingAsset, sha256: hash },
          },
          render: { video_source_profile: "seedance-pro-fast-1248x704-v1", video_frame_count: 60 },
        },
      ],
    };
    assert.equal(
      await call("videoforge_hosted_video_manifest_valid", [
        a,
        w,
        g,
        JSON.stringify(mixedManifest),
      ]),
      true,
    );
    assert.equal(
      await call("videoforge_hosted_video_manifest_valid", [
        a,
        w,
        g,
        JSON.stringify({ ...mixedManifest, segments: [mixedManifest.segments[1]] }),
      ]),
      false,
    );
    // Reproduce the real persisted relational key versus canonical UUID before
    // 0246; only metadata fixture seeding changes this immutable terminal row.
    const canonicalSegment = id(246001);
    await seed("hosted_video_jobs", "UPDATE hosted_video_jobs SET segment_id=$2 WHERE id=$1", [
      sibling,
      `segment:${canonicalSegment}`,
    ]);
    const canonicalManifest = {
      ...mixedManifest,
      segments: [
        mixedManifest.segments[0],
        { ...mixedManifest.segments[1], segment_id: canonicalSegment },
      ],
    };
    assert.equal(
      await call("videoforge_hosted_video_manifest_valid", [
        a,
        w,
        g,
        JSON.stringify(canonicalManifest),
      ]),
      false,
    );
    await executor.execute(segmentSource);
    const durableVideoBefore = (
      await db.query("SELECT to_jsonb(j) value FROM hosted_video_jobs j WHERE id=$1", [sibling])
    ).rows[0].value;
    assert.equal(
      await call("videoforge_hosted_video_manifest_valid", [
        a,
        w,
        g,
        JSON.stringify(canonicalManifest),
      ]),
      true,
    );
    for (const changed of [
      {
        ...canonicalManifest,
        segments: [
          canonicalManifest.segments[0],
          { ...canonicalManifest.segments[1], segment_id: id(246002) },
        ],
      },
      {
        ...canonicalManifest,
        segments: [
          canonicalManifest.segments[0],
          { ...canonicalManifest.segments[1], segment_id: `other:${canonicalSegment}` },
        ],
      },
      {
        ...canonicalManifest,
        segments: [
          canonicalManifest.segments[0],
          {
            ...canonicalManifest.segments[1],
            accepted_assets: {
              ...canonicalManifest.segments[1].accepted_assets,
              image: { asset_id: id(999), sha256: hash },
            },
          },
        ],
      },
      {
        ...canonicalManifest,
        segments: [
          canonicalManifest.segments[0],
          {
            ...canonicalManifest.segments[1],
            accepted_assets: {
              ...canonicalManifest.segments[1].accepted_assets,
              image: { asset_id: sourceAsset, sha256: "sha256:" + "e".repeat(64) },
            },
          },
        ],
      },
      {
        ...canonicalManifest,
        segments: [
          canonicalManifest.segments[0],
          {
            ...canonicalManifest.segments[1],
            render: { ...canonicalManifest.segments[1].render, video_frame_count: 59 },
          },
        ],
      },
      {
        ...canonicalManifest,
        segments: [
          ...canonicalManifest.segments,
          { ...canonicalManifest.segments[1], segment_id: `segment:${canonicalSegment}` },
        ],
      },
    ])
      assert.equal(
        await call("videoforge_hosted_video_manifest_valid", [a, w, g, JSON.stringify(changed)]),
        false,
      );
    assert.equal(
      await call("videoforge_hosted_video_manifest_valid", [
        IDS.accountB,
        w,
        g,
        JSON.stringify(canonicalManifest),
      ]),
      false,
    );
    assert.deepEqual(
      (await db.query("SELECT to_jsonb(j) value FROM hosted_video_jobs j WHERE id=$1", [sibling]))
        .rows[0].value,
      durableVideoBefore,
    );
    await db.exec("SAVEPOINT source_key_mapping");
    await seed(
      "hosted_video_jobs",
      "UPDATE hosted_video_jobs SET source_task_key='image:foreign' WHERE id=$1",
      [sibling],
    );
    assert.equal(
      await call("videoforge_hosted_video_manifest_valid", [
        a,
        w,
        g,
        JSON.stringify(canonicalManifest),
      ]),
      false,
    );
    await db.exec("ROLLBACK TO SAVEPOINT source_key_mapping");
    // The same exact mapping also preserves a failed scene's original image.
    const canonicalStaticSegment = id(246003);
    await seed("hosted_video_jobs", "UPDATE hosted_video_jobs SET segment_id=$2 WHERE id=$1", [
      j,
      `segment:${canonicalStaticSegment}`,
    ]);
    assert.equal(
      await call("videoforge_hosted_video_manifest_valid", [
        a,
        w,
        g,
        JSON.stringify({
          ...canonicalManifest,
          segments: [
            { ...canonicalManifest.segments[0], segment_id: canonicalStaticSegment },
            canonicalManifest.segments[1],
          ],
        }),
      ]),
      true,
    );
    await seed("hosted_video_jobs", "UPDATE hosted_video_jobs SET segment_id='scene' WHERE id=$1", [
      j,
    ]);
    // Neither arbitrary prefix stripping nor repeated segment: prefixes is accepted.
    await seed("hosted_video_jobs", "UPDATE hosted_video_jobs SET segment_id=$2 WHERE id=$1", [
      sibling,
      `segment:segment:${canonicalSegment}`,
    ]);
    assert.equal(
      await call("videoforge_hosted_video_manifest_valid", [
        a,
        w,
        g,
        JSON.stringify(canonicalManifest),
      ]),
      false,
    );
    assert.equal((await call("videoforge_read_hosted_video_jobs", [a, w, g])).plannedJobCount, 2);
    assert.equal(
      (await db.query("SELECT state FROM generation_requests WHERE id=$1", [g])).rows[0].state,
      "ACTIVE",
    );
    await db.exec("ROLLBACK TO SAVEPOINT fallback_cases");
    await executor.execute(segmentSource);
    // Last definite failure closes the same native stage/lease barrier as a clip commit.
    for (const [n, lane] of [
      [244010, "mage_image"],
      [244011, "soulx_avatar"],
    ])
      await seed(
        "video_runtime_lane_states",
        `INSERT INTO video_runtime_lane_states(id,account_id,workspace_id,runtime_id,project_revision_id,lane,state,items_manifest_sha256,planned_item_count,accepted_item_count,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'SUCCEEDED',$7,0,0,now(),now())`,
        [id(n), a, w, runtime, r, lane, hash],
      );
    await db.query("UPDATE global_generation_capacity SET active_lease_count=1");
    await call("videoforge_fail_hosted_video_job", [a, w, g, j, "SEEDANCE_CLIP_TOO_SHORT"]);
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
    assert.equal(
      (await db.query("SELECT state FROM generation_requests WHERE id=$1", [g])).rows[0].state,
      "ACTIVE",
    );
    assert.equal(
      (await call("videoforge_fail_hosted_video_job", [a, w, g, j, "SEEDANCE_CLIP_TOO_SHORT"]))
        .staticFallback,
      true,
    );
    assert.equal(
      (await db.query("SELECT state FROM hosted_api_generation_jobs WHERE id=$1", [sourceJob]))
        .rows[0].state,
      "SUCCEEDED",
    );
    // Native positive handoff proof under each real deployment role. Seed only
    // predecessor acceptance metadata; the real reader chain, video barrier,
    // SECURITY DEFINER boundary and tenant checks all execute without mocks.
    const voiceAsset = id(245001),
      voiceReservation = id(245002),
      voiceReceipt = id(245003);
    const voiceHash = "sha256:" + "d".repeat(64);
    const voiceKey = `tenant/${a}/workspace/${w}/project/${p}/revision/${r}/lane/input/job/voiceover/artifact/${voiceAsset}`;
    await seed(
      "assets",
      `INSERT INTO assets(id,account_id,workspace_id,project_id,project_revision_id,kind,state,object_key,binary_sha256,content_type,byte_size,verified_at) VALUES($1,$2,$3,$4,$5,'VOICEOVER','ACCEPTED',$6,$7,'audio/wav',2000,now())`,
      [voiceAsset, a, w, p, r, voiceKey, voiceHash],
    );
    await seed(
      "project_revisions",
      "UPDATE project_revisions SET voiceover_asset_id=$2,voiceover_binary_sha256=$3 WHERE id=$1",
      [r, voiceAsset, voiceHash],
    );
    await seed(
      "artifact_reservations",
      `INSERT INTO artifact_reservations(id,account_id,workspace_id,project_id,project_revision_id,asset_id,lane,job_id,artifact_id,object_key,method,content_type,content_length,checksum_sha256,expires_at,max_uses,used_count,state,retention_class,deletion_owner_account_id) VALUES($1,$2,$3,$4,$5,$6::uuid,'INPUT','voiceover',$6::uuid::text,$7,'PUT','audio/wav',2000,$8,now()+interval '1 hour',1,1,'COMMITTED','PROJECT',$2)`,
      [voiceReservation, a, w, p, r, voiceAsset, voiceKey, voiceHash],
    );
    await db.query(
      `INSERT INTO artifact_receipts(id,account_id,workspace_id,reservation_id,callback_id,object_key,content_type,content_length,checksum_sha256,probe,receipt_sha256,committed_at) VALUES($1,$2,$3,$4,'voice-role-fixture',$5,'audio/wav',2000,$6,'{}',$6,now())`,
      [voiceReceipt, a, w, voiceReservation, voiceKey, voiceHash],
    );
    await seed(
      "video_runtime_accepted_units",
      `INSERT INTO video_runtime_accepted_units(id,account_id,workspace_id,runtime_id,project_revision_id,lane,item_id,object_key,checksum_sha256,content_length,accepted_attempt_id,api_job_id,accepted_at) VALUES($1,$2,$3,$4,$5,'mage_image','scene',$6,$7,2000,NULL,$8,now())`,
      [id(245004), a, w, runtime, r, sourceKey, hash, sourceJob],
    );
    for (const role of [readerRole, "videoforge_v209_runtime_dc9612d6"]) {
      await db.exec(`SET LOCAL ROLE ${role}`);
      const readyUnderRole = (
        await db.query("SELECT videoforge_read_hosted_v209_ready_render_inputs($1,$2,$3) value", [
          a,
          w,
          g,
        ])
      ).rows[0].value;
      assert.equal(readyUnderRole.generationRequestId, g);
      assert.equal(readyUnderRole.schemaVersion, "videoforge.hosted-v209-ready-render-inputs/v1");
      assert.equal(readyUnderRole.videoPlan.coverage_percent, 7);
      assert.deepEqual(readyUnderRole.acceptedVideos, []);
      assert.equal(readyUnderRole.acceptedVisuals.length, 1);
      assert.equal(readyUnderRole.acceptedVisuals[0].assetId, sourceAsset);
      assert.equal(readyUnderRole.voiceover.assetId, voiceAsset);
      assert.equal(
        (
          await db.query("SELECT videoforge_read_hosted_v209_ready_render_inputs($1,$2,$3) value", [
            IDS.accountB,
            IDS.workspaceB,
            g,
          ])
        ).rows[0].value,
        null,
      );
      await db.exec("RESET ROLE");
    }
    await db.exec("ROLLBACK");
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

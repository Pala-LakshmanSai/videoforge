import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createFixtureDatabase, applyMigrationSliceThrough } from "./support/pglite.mjs";
import { IDS, seedLockedProjects } from "./support/fixtures.mjs";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = "sha256:" + "a".repeat(64);
const source = readFileSync(
  new URL("../migrations/0270_hosted_avatar_composition.sql", import.meta.url),
  "utf8",
);

test("0270 preserves historical pins, validates avatar opt-out, and binds opening split footage", async () => {
  const { database: db, executor, sources } = await createFixtureDatabase();
  try {
    await applyMigrationSliceThrough(executor, 269, sources);
    await seedLockedProjects(executor);
    const a = IDS.accountA,
      w = IDS.workspaceA,
      p = id(270001);
    await db.query("SELECT set_config('videoforge.account_id',$1,false)", [a]);
    await db.query(
      "INSERT INTO projects(id,workspace_id,owner_user_id,name,normalized_name,generation_provider) VALUES($1,$2,$3,'Composition proof','composition proof','KIE_FAL')",
      [p, w, IDS.userA],
    );
    const call = async (name, args) =>
      (
        await db.query(
          `SELECT public.${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) value`,
          args,
        )
      ).rows[0].value;
    const definition = () =>
      db.query(
        "SELECT pg_get_functiondef('videoforge_pin_hosted_video_plan(uuid,uuid,uuid,integer,text)'::regprocedure) value",
      );
    const before = (await definition()).rows[0].value;
    await db.exec("BEGIN");
    await executor.execute(source);
    assert.equal((await definition()).rows[0].value, before);
    await db.exec("ROLLBACK");
    assert.equal((await definition()).rows[0].value, before);
    assert.equal(
      (
        await db.query(
          "SELECT is_nullable FROM information_schema.columns WHERE table_name='project_revisions' AND column_name='avatar_profile_id'",
        )
      ).rows[0].is_nullable,
      "NO",
    );
    await executor.execute(source);
    assert.equal((await definition()).rows[0].value, before);
    const seed = async (table, sql, args = []) => {
      await db.exec(`ALTER TABLE ${table} DISABLE TRIGGER ALL`);
      try {
        await db.query(sql, args);
      } finally {
        await db.exec(`ALTER TABLE ${table} ENABLE TRIGGER ALL`);
      }
    };
    let nextId = 270100,
      revisionNumber = 0;
    const secondsByRevision = new Map();
    const revision = async (avatarEnabled, seconds, overrides = {}) => {
      const r = id(nextId++);
      const off =
        avatarEnabled === false
          ? Object.fromEntries(
              [
                "avatar_profile_id",
                "avatar_profile_version_id",
                "avatar_profile_hash",
                "avatar_runtime_source_asset_id",
                "avatar_runtime_source_binary_sha256",
                "avatar_source_preparation_profile",
                "avatar_source_validation_profile",
              ].map((key) => [key, null]),
            )
          : {};
      const payload =
        avatarEnabled === undefined
          ? { source: "historical" }
          : {
              scheduler_version: "scheduler-v12",
              avatar_enabled: avatarEnabled,
              ai_video_opening_seconds: seconds,
              ...(avatarEnabled ? {} : { avatar_binding: null }),
            };
      const changes = {
        id: r,
        project_id: p,
        revision_number: ++revisionNumber,
        ...off,
        revision_config_payload: payload,
        ...overrides,
      };
      await db.query(
        `INSERT INTO project_revisions SELECT (jsonb_populate_record(NULL::project_revisions,to_jsonb(rev)||$1::jsonb)).* FROM project_revisions rev WHERE rev.id=$2`,
        [JSON.stringify(changes), IDS.revisionA],
      );
      secondsByRevision.set(r, seconds);
      return r;
    };
    const pin = (r, coverage, seconds) =>
      call("videoforge_pin_hosted_video_plan", [
        a,
        w,
        r,
        coverage,
        "FOOTAGE_COMPOSITION_V5",
        seconds,
      ]);
    const select = (r, selections) =>
      call("videoforge_plan_hosted_video_selections", [a, w, r, JSON.stringify(selections)]);
    const empty = (r) => call("videoforge_hosted_video_empty_avatar_allowed", [a, w, r]);
    const legacy = await revision(undefined, 0);
    assert.equal(
      (await call("videoforge_pin_hosted_video_plan", [a, w, legacy, 7, "WHOLE_SCENE_V2"]))
        .replacement_policy,
      "WHOLE_SCENE_V2",
    );
    await assert.rejects(
      revision(undefined, 0, { avatar_profile_id: null }),
      /avatar_toggle_check|avatar snapshot/,
    );
    await assert.rejects(
      revision(true, 6, { avatar_profile_id: null }),
      /avatar_toggle_check|avatar snapshot/,
    );
    await assert.rejects(
      revision(false, 6, {
        revision_config_payload: {
          scheduler_version: "scheduler-v10",
          avatar_enabled: false,
          avatar_binding: null,
        },
      }),
      /avatar_toggle_check|avatar snapshot/,
    );
    await assert.rejects(
      revision(false, 6, { avatar_profile_id: IDS.avatarProfileA }),
      /avatar_toggle_check|avatar snapshot/,
    );
    const makeTiming = async (r, avatarEnabled = true, suppliedRanges) => {
      const timeline = id(nextId++),
        segments = [],
        tasks = [];
      const ranges = suppliedRanges ?? [
        [0, 90, "AVATAR_FULL"],
        [90, 150, "IMAGE_FULL"],
        [150, 210, "AVATAR_SPLIT_IMAGE"],
        [210, 240, "IMAGE_FULL"],
        [240, 540, "IMAGE_FULL"],
        [540, 600, "AVATAR_SPLIT_IMAGE"],
      ];
      for (const [index, [start, end, originalComposition]] of ranges.entries()) {
        const composition = avatarEnabled ? originalComposition : "IMAGE_FULL";
        const segmentId = id(nextId++),
          key = `segment:${segmentId}`,
          taskId = id(nextId++),
          taskKey = `${composition === "AVATAR_FULL" ? "avatar" : "image"}:${segmentId}`;
        const lane = composition === "AVATAR_FULL" ? "AVATAR" : "IMAGE";
        await seed(
          "generation_tasks",
          `INSERT INTO generation_tasks(id,account_id,workspace_id,owner_type,owner_id,project_revision_id,task_key,lane,state) VALUES($1,$2,$3,'PROJECT_REVISION',$4,$4,$5,$6,'BLOCKED')`,
          [taskId, a, w, r, taskKey, lane],
        );
        await seed(
          "timeline_segments",
          `INSERT INTO timeline_segments(id,account_id,workspace_id,project_revision_id,timeline_plan_id,segment_key,segment_index,start_frame,end_frame_exclusive,source_audio_start_ms,source_audio_end_ms_exclusive,word_start,word_end_exclusive,timeline_composition,in_image_shot_role,narration,required_slots,timeline_plan_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$7,$12,$13,$14,'Opening scene',$15::jsonb,$16)`,
          [
            segmentId,
            a,
            w,
            r,
            timeline,
            key,
            index,
            start,
            end,
            Math.round((start / 30) * 1000),
            Math.round((end / 30) * 1000),
            index + 1,
            composition,
            composition === "AVATAR_FULL" ? null : "HANDS_ACTION",
            JSON.stringify(
              composition === "AVATAR_SPLIT_IMAGE"
                ? {
                    avatar: { task_key: `avatar:${segmentId}` },
                    right_image: { task_key: taskKey },
                  }
                : { [lane === "IMAGE" ? "image" : "avatar"]: { task_key: taskKey } },
            ),
            hash,
          ],
        );
        segments.push({
          segmentId: key,
          sourceTaskKey: taskKey,
          videoFrameCount: end - start,
          durationSeconds: Math.max(1.2, Math.ceil((end - start + 3) / 3) / 10),
          start,
          end,
          composition,
          id: segmentId,
        });
        tasks.push({ id: taskId, task_key: taskKey, timeline_segment_id: segmentId, lane });
        if (composition === "AVATAR_SPLIT_IMAGE") {
          const avatarTaskId = id(nextId++),
            avatarTaskKey = `avatar:${segmentId}`;
          await seed(
            "generation_tasks",
            `INSERT INTO generation_tasks(id,account_id,workspace_id,owner_type,owner_id,project_revision_id,task_key,lane,state) VALUES($1,$2,$3,'PROJECT_REVISION',$4,$4,$5,'AVATAR','BLOCKED')`,
            [avatarTaskId, a, w, r, avatarTaskKey],
          );
          tasks.push({
            id: avatarTaskId,
            task_key: avatarTaskKey,
            timeline_segment_id: segmentId,
            lane: "AVATAR",
          });
        }
      }
      await seed(
        "timeline_plans",
        `INSERT INTO timeline_plans(id,account_id,workspace_id,project_revision_id,transcript_id,plan_sequence,revision_config_hash,transcript_document_hash,scheduler_version,scheduler_config_hash,seed,input_fingerprint_hash,contract_name,contract_version,canonical_document_asset_id,canonical_document_hash,output_fps_num,output_fps_den,total_frames,idempotency_key,created_by_user_id,created_at) VALUES($1::uuid,$2,$3,$4,$5,1,$6,$6,$7,$6,1,$6,'timelinePlan','v1',$8,$6,30,1,$9,$1::text,$10,now())`,
        [timeline, a, w, r, id(nextId++), hash, "scheduler-v12", IDS.outputA1, 600, IDS.userA],
      );
      await seed(
        "hosted_canonical_timing_bridges",
        `INSERT INTO hosted_canonical_timing_bridges(hosted_asr_attempt_id,account_id,workspace_id,project_id,project_revision_id,transcript_id,transcript_document_hash,timeline_plan_id,timeline_document_hash,asr_input_sha256,asr_result_sha256,generation_plan_sha256,task_manifest,append_payload,completed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$7,$7,$7,$7,$9::jsonb,'{"schema_version":"videoforge-hosted-canonical-timing-append/v1"}',now())`,
        [id(nextId++), a, w, p, r, id(nextId++), hash, timeline, JSON.stringify(tasks)],
      );
      const selected = (segment) =>
        Object.fromEntries(
          Object.entries(segment).filter(([key]) =>
            ["segmentId", "sourceTaskKey", "videoFrameCount", "durationSeconds"].includes(key),
          ),
        );
      return {
        timeline,
        segments,
        mandatory: segments
          .filter(
            (s) =>
              s.start < (secondsByRevision.get(r) ?? 0) * 30 && s.composition !== "AVATAR_FULL",
          )
          .map(selected),
        optional: segments
          .filter(
            (s) =>
              s.start >= (secondsByRevision.get(r) ?? 0) * 30 && s.composition === "IMAGE_FULL",
          )
          .map(selected),
      };
    };

    const requests = new Map();
    const request = async (r) => {
      const g = id(nextId++);
      await seed(
        "generation_requests",
        "UPDATE generation_requests SET state='FAILED',terminal_at=now(),version=version+1 WHERE account_id=$1 AND state='ACTIVE'",
        [a],
      );
      await seed(
        "generation_requests",
        `INSERT INTO generation_requests(id,account_id,workspace_id,project_id,project_revision_id,created_by_user_id,state,queue_order,available_at,idempotency_key,admitted_at,created_at,updated_at) VALUES($1::uuid,$2,$3,$4,$5,$6,'ACTIVE',$7,now(),$1::uuid::text,now(),now(),now())`,
        [g, a, w, p, r, IDS.userA, nextId],
      );
      requests.set(r, g);
      return g;
    };
    const job = async (r, g, s) => {
      const j = id(nextId++),
        claim = id(nextId++);
      await seed(
        "hosted_video_jobs",
        `INSERT INTO hosted_video_jobs(id,account_id,workspace_id,project_id,project_revision_id,generation_request_id,segment_id,source_task_key,video_frame_count,duration_seconds,state,claim_id,provider_task_id,input_manifest,output_object_key) VALUES($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,'SUBMITTED',$11,$1::uuid::text,'{}','tenant/'||$2::uuid||'/workspace/'||$3::uuid||'/project/'||$4::uuid||'/revision/'||$5::uuid||'/lane/scene-video/job/'||$1::uuid||'/artifact/'||$1::uuid)`,
        [
          j,
          a,
          w,
          p,
          r,
          g,
          s.segmentId,
          s.sourceTaskKey,
          s.videoFrameCount,
          s.durationSeconds,
          claim,
        ],
      );
      return j;
    };
    await makeTiming(legacy);
    assert.deepEqual(
      (await call("videoforge_plan_hosted_video_selections", [a, w, legacy, "[]"])).selections,
      [],
    );

    for (const avatarEnabled of [true, false]) {
      for (const seconds of [0, 6]) {
        const r = await revision(avatarEnabled, seconds);
        const pinned = await pin(r, 25, seconds);
        assert.equal(pinned.opening_seconds, seconds);
        assert.deepEqual(await pin(r, 25, seconds), pinned);
        await assert.rejects(pin(r, 26, seconds), /replay drift/);
        await assert.rejects(pin(r, 25, seconds + 6), /revision binding invalid/);
        await assert.rejects(
          call("videoforge_pin_hosted_video_plan", [
            IDS.accountB,
            IDS.workspaceB,
            r,
            25,
            "FOOTAGE_COMPOSITION_V5",
            seconds,
          ]),
          /scope invalid/,
        );
        const timing = await makeTiming(r, avatarEnabled);
        assert.equal(await empty(r), !avatarEnabled);
        if (seconds === 0) {
          assert.deepEqual((await select(r, [timing.optional[avatarEnabled ? 0 : 1]])).selections, [
            timing.optional[avatarEnabled ? 0 : 1],
          ]);
          assert.equal(
            (await call("videoforge_hosted_video_opening_wire_policy", [a, w, r])).coverage_percent,
            25,
          );
          continue;
        }
        assert.equal(timing.mandatory.length, avatarEnabled ? 2 : 3);
        assert.equal(timing.mandatory.at(-1).sourceTaskKey.startsWith("image:"), true);
        await assert.rejects(select(r, timing.mandatory.slice(1)), /opening selections/);
        await assert.rejects(
          select(r, [
            { ...timing.mandatory[0], sourceTaskKey: "image:wrong" },
            ...timing.mandatory.slice(1),
          ]),
          /full image scene/,
        );
        await assert.rejects(
          select(r, [
            { ...timing.mandatory[0], videoFrameCount: 59 },
            ...timing.mandatory.slice(1),
          ]),
          /full image scene/,
        );
        await assert.rejects(
          select(r, [...timing.mandatory, timing.optional[1]]),
          /post-opening coverage/,
        );
        // Remaining allowance is floor((600-180)*25%) minus the 30-frame crossing suffix: 75.
        const selected = [...timing.mandatory, timing.optional[0]];
        const planned = await select(r, selected);
        assert.deepEqual(planned.selections, selected);
        assert.deepEqual((await select(r, selected)).selections, selected);
        await assert.rejects(select(r, [...selected].reverse()), /replay drift/);
        const wire = await call("videoforge_hosted_video_opening_wire_policy", [a, w, r]);
        assert.equal(wire.coverage_percent, avatarEnabled ? 33 : 48);
        assert.equal(wire.selection_sha256, planned.selection_sha256);
        const copied = await revision(avatarEnabled, seconds);
        assert.equal(
          (await call("videoforge_copy_hosted_video_plan", [a, w, r, copied])).opening_seconds,
          seconds,
        );
      }
    }
    const zero = await revision(true, 6);
    await pin(zero, 0, 6);
    const timing = await makeTiming(zero);
    await assert.rejects(
      select(zero, [...timing.mandatory, timing.optional[0]]),
      /post-opening coverage/,
    );
    await select(zero, timing.mandatory);
    assert.equal(
      (await call("videoforge_hosted_video_opening_wire_policy", [a, w, zero])).coverage_percent,
      20,
    );
    const off = await revision(false, 0);
    await pin(off, 0, 0);
    const offTiming = await makeTiming(off, false);
    assert.equal(await empty(off), true);
    await seed(
      "timeline_plans",
      "UPDATE timeline_plans SET scheduler_version='scheduler-v10' WHERE id=$1",
      [offTiming.timeline],
    );
    assert.equal(await empty(off), false);
    await assert.rejects(select(off, []), /opening selections/);
    const short = await revision(true, 6);
    await pin(short, 0, 6);
    const shortTiming = await makeTiming(short, true, [[0, 150, "AVATAR_SPLIT_IMAGE"]]);
    const shortG = await request(short);
    await select(short, shortTiming.mandatory);
    await call("videoforge_prepare_hosted_v209_runtime", [a, w, IDS.userA, p, shortG]);
    // Real accepted image metadata and the native video output commit prove the
    // opening validator delegates all existing asset/source/receipt barriers.
    const sourceJob = id(nextId++),
      sourceAsset = id(nextId++),
      sourceReservation = id(nextId++),
      sourceReceipt = id(nextId++);
    const shortSegment = shortTiming.segments[0];
    const sourceTask = (
      await db.query(
        "SELECT id FROM generation_tasks WHERE project_revision_id=$1 AND lane='IMAGE'",
        [short],
      )
    ).rows[0].id;
    const sourceKey = `tenant/${a}/workspace/${w}/project/${p}/revision/${short}/lane/mage-image/job/${sourceJob}/artifact/${sourceTask}`;
    await seed(
      "assets",
      `INSERT INTO assets(id,account_id,workspace_id,project_id,project_revision_id,kind,state,object_key,binary_sha256,content_type,byte_size,width_px,height_px,verified_at) VALUES($1,$2,$3,$4,$5,'IMAGE','ACCEPTED',$6,$7,'image/png',2000,1920,1080,now())`,
      [sourceAsset, a, w, p, short, sourceKey, hash],
    );
    await db.query(
      `INSERT INTO artifact_reservations(id,account_id,workspace_id,project_id,project_revision_id,asset_id,lane,job_id,artifact_id,object_key,method,content_type,content_length,checksum_sha256,expires_at,max_uses,used_count,state,retention_class,deletion_owner_account_id) VALUES($1,$2,$3,$4,$5,$6,'MAGE_IMAGE',$7,$8,$9,'PUT','image/png',2000,$10,now()+interval '1 hour',1,1,'COMMITTED','PROJECT',$2)`,
      [sourceReservation, a, w, p, short, sourceAsset, sourceJob, sourceTask, sourceKey, hash],
    );
    await db.query(
      `INSERT INTO artifact_receipts(id,account_id,workspace_id,reservation_id,callback_id,object_key,content_type,content_length,checksum_sha256,probe,receipt_sha256,committed_at) VALUES($1,$2,$3,$4,'opening-source-fixture',$5,'image/png',2000,$6,'{"width":1920,"height":1080}',$6,now())`,
      [sourceReceipt, a, w, sourceReservation, sourceKey, hash],
    );
    await seed(
      "hosted_api_generation_jobs",
      `INSERT INTO hosted_api_generation_jobs(id,account_id,workspace_id,project_id,project_revision_id,generation_request_id,generation_task_id,task_key,lane,input_manifest,input_sha256,output_object_key,state,claim_id,provider_task_id,output_sha256,output_bytes,output_content_type,output_asset_id,output_receipt_id,completed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'IMAGE','{"prompt":"Opening scene"}',$9,$10,'SUCCEEDED',$11,'opening-source-task',$9,2000,'image/png',$12,$13,now())`,
      [
        sourceJob,
        a,
        w,
        p,
        short,
        shortG,
        sourceTask,
        shortSegment.sourceTaskKey,
        hash,
        sourceKey,
        id(nextId++),
        sourceAsset,
        sourceReceipt,
      ],
    );
    const shortJob = await job(short, shortG, shortTiming.mandatory[0]);
    await seed(
      "hosted_video_jobs",
      "UPDATE hosted_video_jobs SET source_api_job_id=$2,source_asset_id=$3,source_sha256=$4 WHERE id=$1",
      [shortJob, sourceJob, sourceAsset, hash],
    );
    const output = await call("videoforge_commit_hosted_video_output", [
      a,
      w,
      shortG,
      shortJob,
      hash,
      2000,
      "video/mp4",
      JSON.stringify({ width: 1248, height: 704, durationMs: 5100 }),
      0.068136,
    ]);
    assert.equal(output.state, "SUCCEEDED");
    assert.equal(await call("videoforge_hosted_videos_ready", [a, w, shortG]), true);
    const videoAsset = (
      await db.query("SELECT output_asset_id FROM hosted_video_jobs WHERE id=$1", [shortJob])
    ).rows[0].output_asset_id;
    const shortWire = await call("videoforge_hosted_video_opening_wire_policy", [a, w, short]);
    const acceptedManifest = {
      schema_version: "resolved-render-manifest/v4",
      total_frames: 150,
      video_policy: shortWire,
      segments: [
        {
          segment_id: shortSegment.id,
          start_frame: 0,
          end_frame_exclusive: 150,
          timeline_composition: "AVATAR_SPLIT_IMAGE",
          accepted_assets: {
            right_image: { asset_id: sourceAsset, sha256: hash },
            video: { asset_id: videoAsset, sha256: hash },
          },
          render: { video_source_profile: "seedance-pro-fast-1248x704-v1", video_frame_count: 150 },
        },
      ],
    };
    assert.equal(
      await call("videoforge_hosted_video_manifest_valid", [
        a,
        w,
        shortG,
        JSON.stringify(acceptedManifest),
      ]),
      true,
    );
    for (const forged of [
      { ...acceptedManifest, video_policy: { ...shortWire, coverage_percent: 0 } },
      { ...acceptedManifest, video_policy: { ...shortWire, replacement_policy: "OPENING_180_V3" } },
      {
        ...acceptedManifest,
        video_policy: { ...shortWire, selection_sha256: "sha256:" + "b".repeat(64) },
      },
      { ...acceptedManifest, schema_version: "resolved-render-manifest/v3" },
      { ...acceptedManifest, total_frames: 151 },
      {
        ...acceptedManifest,
        segments: [
          {
            ...acceptedManifest.segments[0],
            accepted_assets: {
              ...acceptedManifest.segments[0].accepted_assets,
              right_image: { asset_id: sourceAsset, sha256: "sha256:" + "b".repeat(64) },
            },
          },
        ],
      },
      {
        ...acceptedManifest,
        segments: [
          {
            ...acceptedManifest.segments[0],
            accepted_assets: {
              ...acceptedManifest.segments[0].accepted_assets,
              right_image: { asset_id: id(nextId++), sha256: hash },
            },
          },
        ],
      },
      {
        ...acceptedManifest,
        segments: [{ ...acceptedManifest.segments[0], timeline_composition: "AVATAR_FULL" }],
      },
      {
        ...acceptedManifest,
        segments: [
          {
            ...acceptedManifest.segments[0],
            render: { ...acceptedManifest.segments[0].render, video_frame_count: 149 },
          },
        ],
      },
      {
        ...acceptedManifest,
        segments: [
          {
            ...acceptedManifest.segments[0],
            accepted_assets: {
              right_image: acceptedManifest.segments[0].accepted_assets.right_image,
            },
          },
        ],
      },
    ])
      assert.equal(
        await call("videoforge_hosted_video_manifest_valid", [
          a,
          w,
          shortG,
          JSON.stringify(forged),
        ]),
        false,
      );
    await seed(
      "artifact_receipts",
      "UPDATE artifact_receipts SET deleted_at=now(),deletion_reason='fixture' WHERE id=$1",
      [sourceReceipt],
    );
    assert.equal(
      await call("videoforge_hosted_video_manifest_valid", [
        a,
        w,
        shortG,
        JSON.stringify(acceptedManifest),
      ]),
      false,
    );

    for (const seconds of [null, -6, 1, 3606])
      await assert.rejects(pin(legacy, 7, seconds), /invalid/);
  } finally {
    await db.close();
  }
});

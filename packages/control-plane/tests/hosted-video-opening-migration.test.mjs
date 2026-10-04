import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import { createFixtureDatabase, applyMigrationSliceThrough } from "./support/pglite.mjs";
import { IDS, seedLockedProjects } from "./support/fixtures.mjs";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = "sha256:" + "a".repeat(64);
const filename = "0267_hosted_video_opening.sql";
const source = readFileSync(new URL(`../migrations/${filename}`, import.meta.url), "utf8");

test("0267 pins private mandatory opening, post-opening budget, immutable old policies and safe failures", async () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../migrations/manifest.json", import.meta.url), "utf8"),
  );
  assert.equal(
    manifest.migrations.find((entry) => entry.version === 267).sha256,
    `sha256:${createHash("sha256").update(source).digest("hex")}`,
  );
  const { database: db, executor, sources } = await createFixtureDatabase();
  try {
    await applyMigrationSliceThrough(executor, 266, sources);
    await seedLockedProjects(executor);
    const a = IDS.accountA,
      w = IDS.workspaceA,
      p = id(267001);
    await db.query("SELECT set_config('videoforge.account_id',$1,false)", [a]);
    await db.query(
      "INSERT INTO projects(id,workspace_id,owner_user_id,name,normalized_name,generation_provider) VALUES($1,$2,$3,'Opening proof','opening proof','KIE_FAL')",
      [p, w, IDS.userA],
    );
    const call = async (name, args) =>
      (
        await db.query(
          `SELECT public.${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) value`,
          args,
        )
      ).rows[0].value;
    const seed = async (table, sql, args = []) => {
      await db.exec(`ALTER TABLE ${table} DISABLE TRIGGER ALL`);
      try {
        await db.query(sql, args);
      } catch (error) {
        error.message = `${table}: ${error.message}`;
        throw error;
      } finally {
        await db.exec(`ALTER TABLE ${table} ENABLE TRIGGER ALL`);
      }
    };
    let nextId = 267100,
      revisionNumber = 0;
    const revision = async (policy, coverage) => {
      const r = id(nextId++);
      await db.query(
        `INSERT INTO project_revisions SELECT (jsonb_populate_record(NULL::project_revisions,to_jsonb(rev)||jsonb_build_object('id',$1::text,'project_id',$2::text,'revision_number',$4::integer,'created_at',now(),'locked_at',now()))).* FROM project_revisions rev WHERE rev.id=$3`,
        [r, p, IDS.revisionA, ++revisionNumber],
      );
      await call("videoforge_pin_hosted_video_plan", [a, w, r, coverage, policy]);
      return r;
    };
    const legacy = await revision("WHOLE_SCENE_V2", 0);
    const legacyBefore = (
      await db.query(
        "SELECT to_jsonb(p) value FROM hosted_video_plans p WHERE project_revision_id=$1",
        [legacy],
      )
    ).rows[0].value;
    await executor.execute(source);
    assert.deepEqual(
      (
        await db.query(
          "SELECT to_jsonb(p) value FROM hosted_video_plans p WHERE project_revision_id=$1",
          [legacy],
        )
      ).rows[0].value,
      legacyBefore,
    );
    const makeTiming = async (r, short = false, avatarOpening = false) => {
      const timeline = id(nextId++),
        segments = [],
        tasks = [];
      const ranges = short
        ? [[0, 150, "IMAGE_FULL"]]
        : [
            ...Array.from({ length: 17 }, (_, i) => [i * 300, (i + 1) * 300, "IMAGE_FULL"]),
            [5100, 5457, "IMAGE_FULL"],
            [5457, 5517, "IMAGE_FULL"],
            [5517, 5817, "IMAGE_FULL"],
            [5817, 6000, "AVATAR_FULL"],
          ];
      for (const [index, [start, end, originalComposition]] of ranges.entries()) {
        const composition = avatarOpening && index === 0 ? "AVATAR_FULL" : originalComposition;
        const segmentId = id(nextId++),
          key = `segment:${segmentId}`,
          taskId = id(nextId++),
          taskKey = `${composition === "IMAGE_FULL" ? "image" : "avatar"}:${segmentId}`;
        const lane = composition === "IMAGE_FULL" ? "IMAGE" : "AVATAR";
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
            composition === "IMAGE_FULL" ? "HANDS_ACTION" : null,
            JSON.stringify({ [lane === "IMAGE" ? "image" : "avatar"]: { task_key: taskKey } }),
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
      }
      await seed(
        "timeline_plans",
        `INSERT INTO timeline_plans(id,account_id,workspace_id,project_revision_id,transcript_id,plan_sequence,revision_config_hash,transcript_document_hash,scheduler_version,scheduler_config_hash,seed,input_fingerprint_hash,contract_name,contract_version,canonical_document_asset_id,canonical_document_hash,output_fps_num,output_fps_den,total_frames,idempotency_key,created_by_user_id,created_at) VALUES($1::uuid,$2,$3,$4,$5,1,$6,$6,$7,$6,1,$6,'timelinePlan','v1',$8,$6,30,1,$9,$1::text,$10,now())`,
        [
          timeline,
          a,
          w,
          r,
          id(nextId++),
          hash,
          short ? "scheduler-v9" : "scheduler-v8",
          IDS.outputA1,
          short ? 150 : 6000,
          IDS.userA,
        ],
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
          .filter((s) => s.start < 5400 && s.composition === "IMAGE_FULL")
          .map(selected),
        optional: segments
          .filter((s) => s.start >= 5400 && s.composition === "IMAGE_FULL")
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
    for (const coverage of [0, 25, 50, 100]) {
      const r = await revision("OPENING_180_V3", coverage),
        timing = await makeTiming(r);
      const pinned = await call("videoforge_pin_hosted_video_plan", [
        a,
        w,
        r,
        coverage,
        "OPENING_180_V3",
      ]);
      assert.equal(pinned.coverage_percent, coverage);
      await assert.rejects(
        call("videoforge_pin_hosted_video_plan", [
          a,
          w,
          r,
          coverage === 100 ? 99 : coverage + 1,
          "OPENING_180_V3",
        ]),
        /replay drift/,
      );
      await assert.rejects(
        call("videoforge_pin_hosted_video_plan", [
          IDS.accountB,
          IDS.workspaceB,
          r,
          coverage,
          "OPENING_180_V3",
        ]),
        /scope invalid/,
      );
      await assert.rejects(
        db.query(
          "UPDATE hosted_video_plans SET replacement_policy='WHOLE_SCENE_V2' WHERE project_revision_id=$1",
          [r],
        ),
        /immutable/,
      );
      await assert.rejects(
        call("videoforge_plan_hosted_video_selections", [a, w, r, "[]"]),
        /opening selections/,
      );
      await assert.rejects(
        call("videoforge_plan_hosted_video_selections", [
          a,
          w,
          r,
          JSON.stringify(timing.mandatory.slice(1)),
        ]),
        /opening selections/,
      );
      await assert.rejects(
        call("videoforge_plan_hosted_video_selections", [
          a,
          w,
          r,
          JSON.stringify([
            { ...timing.mandatory[0], videoFrameCount: 299 },
            ...timing.mandatory.slice(1),
          ]),
        ]),
        /full image scene/,
      );
      await assert.rejects(
        call("videoforge_plan_hosted_video_selections", [
          a,
          w,
          r,
          JSON.stringify([
            { ...timing.mandatory[0], sourceTaskKey: "image:forged" },
            ...timing.mandatory.slice(1),
          ]),
        ]),
        /full image scene/,
      );
      if (coverage < 100)
        await assert.rejects(
          call("videoforge_plan_hosted_video_selections", [
            a,
            w,
            r,
            JSON.stringify([...timing.mandatory, timing.optional[1]]),
          ]),
          /opening selections/,
        );
      if (coverage === 0)
        await assert.rejects(
          call("videoforge_plan_hosted_video_selections", [
            a,
            w,
            r,
            JSON.stringify([...timing.mandatory, timing.optional[0]]),
          ]),
          /opening selections/,
        );
      const selected = [
        ...timing.mandatory,
        ...(coverage === 0 ? [] : coverage === 100 ? timing.optional : [timing.optional[0]]),
      ];
      const plan = await call("videoforge_plan_hosted_video_selections", [
        a,
        w,
        r,
        JSON.stringify(selected),
      ]);
      assert.deepEqual(
        (await call("videoforge_plan_hosted_video_selections", [a, w, r, JSON.stringify(selected)]))
          .selections,
        selected,
      );
      await assert.rejects(
        call("videoforge_plan_hosted_video_selections", [
          a,
          w,
          r,
          JSON.stringify([...selected].reverse()),
        ]),
        /replay drift/,
      );
      const wire = await call("videoforge_hosted_video_opening_wire_policy", [a, w, r]);
      assert.deepEqual(wire, {
        coverage_percent: Math.min(
          100,
          Math.ceil(((5457 + Math.max(0, Math.floor((600 * coverage) / 100) - 57)) * 100) / 6000),
        ),
        replacement_policy: "WHOLE_SCENE_V2",
        selection_sha256: plan.selection_sha256,
      });
      const g = await request(r);
      const forged = {
        schema_version: "resolved-render-manifest/v3",
        total_frames: 6000,
        video_policy: wire,
        segments: timing.segments.map((s) => ({
          segment_id: s.id,
          start_frame: s.start,
          end_frame_exclusive: s.end,
          timeline_composition: s.composition,
          accepted_assets: {},
          render: {},
        })),
      };
      assert.equal(
        await call("videoforge_hosted_video_manifest_valid", [a, w, g, JSON.stringify(forged)]),
        false,
        "missing accepted opening video never publishes",
      );
      assert.equal(
        await call("videoforge_hosted_video_render_input_valid", [
          a,
          w,
          r,
          JSON.stringify({
            schema_version: "render-job-input/v3",
            video_policy: wire,
            resolved_render_manifest: { sha256: hash },
          }),
        ]),
        false,
      );
      if (coverage === 25) {
        await call("videoforge_prepare_hosted_v209_runtime", [a, w, IDS.userA, p, g]);
        await seed(
          "provider_workload_leases",
          `INSERT INTO provider_workload_leases(id,slot,account_id,workspace_id,request_kind,generation_request_id,owner_token_sha256,state,acquired_at,heartbeat_at,expires_at) VALUES($1,1,$2,$3,'VIDEO',$4,$5,'ACTIVE',now(),now(),now()+interval '1 hour')`,
          [id(nextId++), a, w, g, hash],
        );
        const openingJob = await job(r, g, timing.mandatory[0]);
        const failed = await call("videoforge_fail_hosted_video_job", [
          a,
          w,
          g,
          openingJob,
          "SEEDANCE_RESULT_INVALID",
        ]);
        assert.equal(failed.failureCode, "REQUIRED_OPENING_SEEDANCE_RESULT_INVALID");
        assert.equal(failed.staticFallback, false);
        assert.equal(
          (
            await call("videoforge_fail_hosted_video_job", [
              a,
              w,
              g,
              openingJob,
              "SEEDANCE_RESULT_INVALID",
            ])
          ).failureCode,
          failed.failureCode,
        );
        await assert.rejects(
          call("videoforge_fail_hosted_video_job", [
            a,
            w,
            g,
            openingJob,
            "SEEDANCE_PROVIDER_FAILED",
          ]),
          /replay drift/,
        );
        assert.equal(await call("videoforge_hosted_videos_ready", [a, w, g]), false);
        assert.equal(
          await call("videoforge_provider_api_waiter_eligible", ["API", a, id(267999)]),
          false,
        );
        const optionalJob = await job(r, g, timing.optional[0]);
        const optionalFailure = await call("videoforge_fail_hosted_video_job", [
          a,
          w,
          g,
          optionalJob,
          "SEEDANCE_RESULT_INVALID",
        ]);
        assert.equal(optionalFailure.failureCode, "SEEDANCE_RESULT_INVALID");
        assert.equal(optionalFailure.staticFallback, true);
        await db.query(
          "UPDATE global_generation_capacity SET active_lease_count=1,version=version+1,updated_at=now() WHERE singleton",
        );
        assert.equal(
          (await call("videoforge_settle_hosted_api_failure", [a, w, g])).state,
          "SETTLED",
        );
        assert.equal(
          (
            await db.query(
              "SELECT stage FROM video_runtime_states WHERE generation_request_id=$1",
              [g],
            )
          ).rows[0].stage,
          "FAILED",
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
      }
    }
    const badOpening = await revision("OPENING_180_V3", 100),
      bad = await makeTiming(badOpening, false, true);
    await assert.rejects(
      call("videoforge_plan_hosted_video_selections", [
        a,
        w,
        badOpening,
        JSON.stringify([...bad.mandatory, ...bad.optional]),
      ]),
      /opening selections/,
    );
    const short = await revision("OPENING_180_V3", 0),
      shortTiming = await makeTiming(short, true),
      shortG = await request(short);
    await call("videoforge_plan_hosted_video_selections", [
      a,
      w,
      short,
      JSON.stringify(shortTiming.mandatory),
    ]);
    assert.equal(
      (await call("videoforge_hosted_video_opening_wire_policy", [a, w, short])).coverage_percent,
      100,
    );
    assert.equal(await call("videoforge_hosted_video_empty_avatar_allowed", [a, w, short]), true);
    assert.equal(
      await call("videoforge_hosted_video_empty_avatar_allowed", [IDS.accountB, w, short]),
      false,
    );
    await call("videoforge_prepare_hosted_v209_runtime", [a, w, IDS.userA, p, shortG]);
    await call("videoforge_prepare_hosted_v209_runtime", [a, w, IDS.userA, p, shortG]);
    const lanes = (
      await db.query(
        "SELECT lane,state,planned_item_count,accepted_item_count FROM video_runtime_lane_states WHERE project_revision_id=$1 ORDER BY lane",
        [short],
      )
    ).rows;
    assert.deepEqual(lanes, [
      {
        lane: "mage_image",
        state: "MANIFEST_DURABLE",
        planned_item_count: 1,
        accepted_item_count: 0,
      },
      { lane: "soulx_avatar", state: "SUCCEEDED", planned_item_count: 0, accepted_item_count: 0 },
    ]);
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
      schema_version: "resolved-render-manifest/v3",
      total_frames: 150,
      video_policy: shortWire,
      segments: [
        {
          segment_id: shortSegment.id,
          start_frame: 0,
          end_frame_exclusive: 150,
          timeline_composition: "IMAGE_FULL",
          accepted_assets: {
            image: { asset_id: sourceAsset, sha256: hash },
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
      { ...acceptedManifest, total_frames: 151 },
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
            accepted_assets: { image: acceptedManifest.segments[0].accepted_assets.image },
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
    await seed(
      "artifact_receipts",
      "UPDATE artifact_receipts SET deleted_at=NULL,deletion_reason=NULL WHERE id=$1",
      [sourceReceipt],
    );
    await seed(
      "hosted_v209_ordinary_resolved_render_manifests",
      `INSERT INTO hosted_v209_ordinary_resolved_render_manifests(generation_request_id,account_id,workspace_id,project_id,project_revision_id,asset_id,reservation_id,manifest_sha256,manifest_document,object_key,content_length,receipt_sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,'opening-manifest-fixture',100,$8)`,
      [
        shortG,
        a,
        w,
        p,
        short,
        sourceAsset,
        sourceReservation,
        hash,
        JSON.stringify(acceptedManifest),
      ],
    );
    const renderInput = {
      schema_version: "render-job-input/v3",
      video_policy: shortWire,
      resolved_render_manifest: { sha256: hash },
    };
    assert.equal(
      await call("videoforge_hosted_video_render_input_valid", [
        a,
        w,
        short,
        JSON.stringify(renderInput),
      ]),
      true,
    );
    for (const forged of [
      { ...renderInput, video_policy: { ...shortWire, coverage_percent: 0 } },
      { ...renderInput, resolved_render_manifest: { sha256: "sha256:" + "b".repeat(64) } },
      { ...renderInput, schema_version: "render-job-input/v2" },
    ])
      assert.equal(
        await call("videoforge_hosted_video_render_input_valid", [
          a,
          w,
          short,
          JSON.stringify(forged),
        ]),
        false,
      );
    await assert.rejects(
      db.query(
        "UPDATE video_runtime_lane_states SET state='SUCCEEDED',planned_item_count=0,version=version+1 WHERE project_revision_id=$1 AND lane='mage_image'",
        [short],
      ),
      /durably accepted/,
    );
    const oldShort = await revision("WHOLE_SCENE_V2", 0);
    await makeTiming(oldShort, true);
    const oldG = await request(oldShort);
    assert.equal(
      await call("videoforge_hosted_video_empty_avatar_allowed", [a, w, oldShort]),
      false,
    );
    await assert.rejects(
      call("videoforge_prepare_hosted_v209_runtime", [a, w, IDS.userA, p, oldG]),
      /task manifest invalid/,
    );
    const successor = await revision("OPENING_180_V3", 0);
    assert.equal(
      (await call("videoforge_copy_hosted_video_plan", [a, w, short, successor]))
        .replacement_policy,
      "OPENING_180_V3",
    );
    await db.exec("SET ROLE videoforge_v209_runtime_dc9612d6");
    await db.query("SELECT set_config('videoforge.account_id',$1,false)", [IDS.accountB]);
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::integer count FROM hosted_video_plans WHERE project_revision_id=$1",
          [short],
        )
      ).rows[0].count,
      0,
    );
    await db.exec("RESET ROLE");
    assert.equal(
      (
        await db.query(
          "SELECT has_table_privilege('videoforge_v209_runtime_dc9612d6','hosted_video_plans','UPDATE') allowed",
        )
      ).rows[0].allowed,
      false,
    );
    assert.equal(
      (
        await db.query(
          "SELECT has_function_privilege('videoforge_v209_reconciler_dc9612d6','videoforge_pin_hosted_video_plan(uuid,uuid,uuid,integer,text)','EXECUTE') allowed",
        )
      ).rows[0].allowed,
      false,
    );
  } finally {
    await db.close();
  }
});

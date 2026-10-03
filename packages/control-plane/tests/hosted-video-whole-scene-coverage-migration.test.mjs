import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import { createFixtureDatabase, applyMigrationSliceThrough } from "./support/pglite.mjs";
import { IDS, seedLockedProjects } from "./support/fixtures.mjs";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = "sha256:" + "a".repeat(64);
const filename = "0248_hosted_video_whole_scene_coverage.sql";
const source = readFileSync(new URL(`../migrations/${filename}`, import.meta.url), "utf8");

test("0248 pins private exact coverage, copies recovery policy and rejects partial scenes and budget forgery", async () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../migrations/manifest.json", import.meta.url), "utf8"),
  );
  assert.equal(
    manifest.migrations.find((entry) => entry.version === 248).sha256,
    `sha256:${createHash("sha256").update(source).digest("hex")}`,
  );
  const { database: db, executor, sources } = await createFixtureDatabase();
  try {
    await applyMigrationSliceThrough(executor, 247, sources);
    await seedLockedProjects(executor);
    const a = IDS.accountA,
      w = IDS.workspaceA,
      p = id(248001);
    await db.query("SELECT set_config('videoforge.account_id',$1,false)", [a]);
    await db.query(
      "INSERT INTO projects(id,workspace_id,owner_user_id,name,normalized_name,generation_provider) VALUES($1,$2,$3,'Whole scene proof','whole scene proof','KIE_FAL')",
      [p, w, IDS.userA],
    );
    const revision = async (r, n) =>
      db.query(
        `INSERT INTO project_revisions SELECT (jsonb_populate_record(NULL::project_revisions,to_jsonb(rev)||jsonb_build_object('id',$1::text,'project_id',$2::text,'revision_number',$4::integer,'created_at',now(),'locked_at',now()))).* FROM project_revisions rev WHERE rev.id=$3`,
        [r, p, IDS.revisionA, n],
      );
    const call = async (name, args) =>
      (
        await db.query(
          `SELECT public.${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) AS value`,
          args,
        )
      ).rows[0].value;
    const legacy = id(248002);
    await revision(legacy, 1);
    await call("videoforge_pin_hosted_video_plan", [a, w, legacy]);
    await executor.execute(source);
    assert.equal(
      (await call("videoforge_pin_hosted_video_plan", [a, w, legacy])).replacement_policy,
      "LEGACY_PREFIX_V1",
    );
    for (const [index, coverage] of [0, 7, 15, 25, 50, 75, 100].entries()) {
      const r = id(248010 + index),
        next = id(248020 + index);
      await revision(r, 2 + index);
      await revision(next, 20 + index);
      const plan = await call("videoforge_pin_hosted_video_plan", [
        a,
        w,
        r,
        coverage,
        "WHOLE_SCENE_V2",
      ]);
      assert.equal(plan.coverage_percent, coverage);
      assert.equal(plan.replacement_policy, "WHOLE_SCENE_V2");
      assert.deepEqual(
        await call("videoforge_pin_hosted_video_plan", [a, w, r, coverage, "WHOLE_SCENE_V2"]),
        plan,
      );
      await assert.rejects(
        call("videoforge_pin_hosted_video_plan", [
          a,
          w,
          r,
          coverage === 100 ? 99 : coverage + 1,
          "WHOLE_SCENE_V2",
        ]),
        /replay drift/,
      );
      const copied = await call("videoforge_copy_hosted_video_plan", [a, w, r, next]);
      assert.equal(copied.coverage_percent, coverage);
      assert.equal(copied.replacement_policy, "WHOLE_SCENE_V2");
      assert.equal(copied.selections, null);
      await assert.rejects(
        call("videoforge_pin_hosted_video_plan", [
          IDS.accountB,
          IDS.workspaceB,
          r,
          coverage,
          "WHOLE_SCENE_V2",
        ]),
        /scope invalid/,
      );
      await assert.rejects(
        db.query("UPDATE hosted_video_plans SET coverage_percent=$1 WHERE project_revision_id=$2", [
          coverage === 100 ? 99 : coverage + 1,
          r,
        ]),
        /immutable/,
      );
    }
    for (const [coverage, policy] of [
      [-1, "WHOLE_SCENE_V2"],
      [101, "WHOLE_SCENE_V2"],
      [25, "LEGACY_PREFIX_V1"],
      [7, "FORGED"],
    ])
      await assert.rejects(
        call("videoforge_pin_hosted_video_plan", [a, w, id(248010), coverage, policy]),
        /policy invalid/,
      );
    const seed = async (table, sql, args) => {
      await db.exec(`ALTER TABLE ${table} DISABLE TRIGGER ALL`);
      try {
        await db.query(sql, args);
      } finally {
        await db.exec(`ALTER TABLE ${table} ENABLE TRIGGER ALL`);
      }
    };
    // Metadata setup bypasses unrelated lineage triggers; SQL selection/ready gates and CHECKs stay live.
    for (const [index, coverage] of [0, 7, 15, 25, 50, 75, 100].entries()) {
      const r = id(248010 + index),
        timeline = id(248100 + index),
        task = id(248200 + index),
        g = id(248300 + index);
      await seed(
        "generation_tasks",
        `INSERT INTO generation_tasks(id,account_id,workspace_id,owner_type,owner_id,project_revision_id,task_key,lane,state) VALUES($1,$2,$3,'PROJECT_REVISION',$4,$4,'image:scene','IMAGE','BLOCKED')`,
        [task, a, w, r],
      );
      await seed(
        "timeline_segments",
        `INSERT INTO timeline_segments(id,account_id,workspace_id,project_revision_id,timeline_plan_id,segment_key,segment_index,start_frame,end_frame_exclusive,source_audio_start_ms,source_audio_end_ms_exclusive,word_start,word_end_exclusive,timeline_composition,in_image_shot_role,narration,required_slots,timeline_plan_hash) VALUES($1,$2,$3,$4,$5,'scene',0,0,150,0,5000,0,1,'IMAGE_FULL','HANDS_ACTION','Physical demonstration','{"image":{"task_key":"image:scene"}}',$6)`,
        [id(248400 + index), a, w, r, timeline, hash],
      );
      await seed(
        "timeline_segments",
        `INSERT INTO timeline_segments(id,account_id,workspace_id,project_revision_id,timeline_plan_id,segment_key,segment_index,start_frame,end_frame_exclusive,source_audio_start_ms,source_audio_end_ms_exclusive,word_start,word_end_exclusive,timeline_composition,in_image_shot_role,narration,required_slots,timeline_plan_hash) VALUES($1,$2,$3,$4,$5,'avatar',1,150,600,5000,20000,1,2,'AVATAR_FULL',NULL,'Physical demonstration','{}',$6)`,
        [id(248500 + index), a, w, r, timeline, hash],
      );
      await seed(
        "hosted_canonical_timing_bridges",
        `INSERT INTO hosted_canonical_timing_bridges(hosted_asr_attempt_id,account_id,workspace_id,project_id,project_revision_id,transcript_id,transcript_document_hash,timeline_plan_id,timeline_document_hash,asr_input_sha256,asr_result_sha256,generation_plan_sha256,task_manifest,append_payload,completed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$7,$7,$7,$7,$9::jsonb,'{"schema_version":"videoforge-hosted-canonical-timing-append/v1"}',now())`,
        [
          id(248600 + index),
          a,
          w,
          p,
          r,
          id(248700 + index),
          hash,
          timeline,
          JSON.stringify([{ id: task, lane: "IMAGE" }]),
        ],
      );
      const select = (frames) => [
        {
          segmentId: "scene",
          sourceTaskKey: "image:scene",
          videoFrameCount: frames,
          durationSeconds: 5.1,
        },
      ];
      await assert.rejects(
        call("videoforge_plan_hosted_video_selections", [a, w, r, JSON.stringify(select(149))]),
        /full image scene/,
      );
      for (const bad of [null, "150", 150.5, -1])
        await assert.rejects(
          call("videoforge_plan_hosted_video_selections", [a, w, r, JSON.stringify(select(bad))]),
          /shape invalid/,
        );
      await assert.rejects(
        call("videoforge_plan_hosted_video_selections", [
          a,
          w,
          r,
          JSON.stringify([{ ...select(150)[0], durationSeconds: 5 }]),
        ]),
        /full image scene/,
      );
      await assert.rejects(
        call("videoforge_plan_hosted_video_selections", [
          a,
          w,
          r,
          JSON.stringify([{ ...select(150)[0], sourceTaskKey: "image:other" }]),
        ]),
        /full image scene/,
      );
      if (coverage < 25)
        await assert.rejects(
          call("videoforge_plan_hosted_video_selections", [a, w, r, JSON.stringify(select(150))]),
          /exceed pinned coverage/,
        );
      const plan = await call("videoforge_plan_hosted_video_selections", [
        a,
        w,
        r,
        JSON.stringify(coverage < 25 ? [] : select(150)),
      ]);
      assert.equal(plan.selections.length, coverage < 25 ? 0 : 1);
      assert.equal(
        plan.selection_sha256,
        `sha256:${createHash("sha256")
          .update(
            (
              await db.query("SELECT videoforge_canonical_jsonb($1::jsonb) value", [
                JSON.stringify(plan.selections),
              ])
            ).rows[0].value,
          )
          .digest("hex")}`,
      );
      await seed(
        "generation_requests",
        `INSERT INTO generation_requests(id,account_id,workspace_id,project_id,project_revision_id,created_by_user_id,state,queue_order,available_at,idempotency_key,admitted_at,created_at,updated_at) VALUES($1::uuid,$2,$3,$4,$5,$6,'WAITING',$7,now(),$1::uuid::text,NULL,now(),now())`,
        [g, a, w, p, r, IDS.userA, index + 1],
      );
      const document = {
        schema_version: "resolved-render-manifest/v3",
        total_frames: 600,
        segments: [],
        video_policy: {
          coverage_percent: coverage,
          replacement_policy: "WHOLE_SCENE_V2",
          selection_sha256: plan.selection_sha256,
        },
      };
      if (coverage < 25) {
        assert.equal(
          await call("videoforge_hosted_video_manifest_valid", [a, w, g, JSON.stringify(document)]),
          true,
        );
        for (const forged of [
          { ...document, video_policy: { ...document.video_policy, coverage_percent: 100 } },
          { ...document, schema_version: "resolved-render-manifest/v1" },
          { ...document, total_frames: 601 },
        ])
          assert.equal(
            await call("videoforge_hosted_video_manifest_valid", [a, w, g, JSON.stringify(forged)]),
            false,
          );
      } else
        assert.equal(
          await call("videoforge_hosted_video_manifest_valid", [a, w, g, JSON.stringify(document)]),
          false,
        ); // Missing exact jobs blocks readiness.
    }
    assert.equal(
      (
        await db.query(
          "SELECT has_function_privilege('videoforge_v209_runtime_dc9612d6','videoforge_pin_hosted_video_plan(uuid,uuid,uuid,integer,text)','EXECUTE') allowed",
        )
      ).rows[0].allowed,
      true,
    );
    assert.equal(
      (
        await db.query(
          "SELECT has_function_privilege('videoforge_v209_reconciler_dc9612d6','videoforge_pin_hosted_video_plan(uuid,uuid,uuid,integer,text)','EXECUTE') allowed",
        )
      ).rows[0].allowed,
      false,
    );
    assert.equal(
      (
        await db.query(
          "SELECT has_table_privilege('videoforge_v209_runtime_dc9612d6','hosted_video_plans','UPDATE') allowed",
        )
      ).rows[0].allowed,
      false,
    );
  } finally {
    await db.close();
  }
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import { createFixtureDatabase, applyMigrationSliceThrough } from "./support/pglite.mjs";
import { IDS, seedLockedProjects } from "./support/fixtures.mjs";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = `sha256:${"a".repeat(64)}`;
const filename = "0269_cloud_asr_preparation_failure_recovery.sql";
const migration = readFileSync(new URL("../migrations/" + filename, import.meta.url), "utf8");
test("0269 permits only exact prelaunch ASR preparation failure and preserves prior recovery guards and evidence", async () => {
  const { database: db, executor, sources } = await createFixtureDatabase();
  try {
    const manifest = JSON.parse(
      readFileSync(new URL("../migrations/manifest.json", import.meta.url), "utf8"),
    );
    assert.equal(
      manifest.migrations.find((row) => row.version === 269).sha256,
      "sha256:" + createHash("sha256").update(migration).digest("hex"),
    );
    await applyMigrationSliceThrough(executor, 268, sources);
    const facts = async () =>
      (
        await db.query(
          "SELECT pg_get_functiondef(oid) definition,proacl,prosecdef FROM pg_proc WHERE oid='videoforge_prepare_cloud_media_asr_recovery(uuid,uuid,uuid,uuid,uuid)'::regprocedure",
        )
      ).rows[0];
    const beforeFunction = await facts();
    await db.exec("BEGIN");
    await executor.execute(migration);
    await db.exec("ROLLBACK");
    assert.deepEqual(await facts(), beforeFunction);
    await executor.execute(migration);
    assert.deepEqual((await facts()).proacl, beforeFunction.proacl);
    assert.equal((await facts()).prosecdef, true);
    await seedLockedProjects(executor);
    await db.query("SELECT set_config('videoforge.account_id',$1,false)", [IDS.accountA]);
    await db.query(
      `INSERT INTO projects(id,workspace_id,owner_user_id,name,normalized_name,generation_provider)
   VALUES($1,$2,$3,'Cloud transcription retry','cloud transcription retry','KIE_FAL')`,
      [id(4000), IDS.workspaceA, IDS.userA],
    );
    await db.query(
      `INSERT INTO project_revisions SELECT (jsonb_populate_record(NULL::project_revisions,to_jsonb(r)||jsonb_build_object(
   'id',$1::text,'project_id',$2::text,'media_execution_backend','RUNPOD_POD','created_at',now(),'locked_at',now(),
   'revision_config_payload',doc.payload,'revision_config_hash','sha256:'||encode(sha256(convert_to(videoforge_canonical_jsonb(doc.payload),'UTF8')),'hex')))).*
   FROM project_revisions r CROSS JOIN LATERAL (SELECT r.revision_config_payload||jsonb_build_object(
     'project_id',$2::text,'project_revision_id',$1::text) AS payload) doc WHERE r.id=$3`,
      [id(4001), id(4000), IDS.revisionA],
    );
    const voice = (
      await db.query(
        "SELECT voiceover_asset_id,voiceover_binary_sha256 FROM project_revisions WHERE id=$1",
        [id(4001)],
      )
    ).rows[0];
    const objectKey = `tenant/${IDS.accountA}/workspace/${IDS.workspaceA}/project/${id(4000)}/revision/${id(4001)}/lane/input/job/browser-upload/artifact/voiceover`;
    await db.query(
      `INSERT INTO artifact_reservations(id,account_id,workspace_id,project_id,project_revision_id,asset_id,lane,job_id,artifact_id,
   object_key,method,content_type,content_length,checksum_sha256,expires_at,max_uses,state,retention_class,deletion_owner_account_id)
   VALUES($1,$2,$3,$4,$5,$6,'INPUT','browser-upload','voiceover',$7,'PUT','audio/mpeg',100,$8,now()+interval '1 hour',1,'COMMITTED','PROJECT',$2)`,
      [
        id(4002),
        IDS.accountA,
        IDS.workspaceA,
        id(4000),
        id(4001),
        voice.voiceover_asset_id,
        objectKey,
        voice.voiceover_binary_sha256,
      ],
    );
    await db.query(
      `INSERT INTO artifact_receipts(id,account_id,workspace_id,reservation_id,callback_id,object_key,content_type,content_length,
   checksum_sha256,receipt_sha256,committed_at) VALUES($1,$2,$3,$4,'cloud-recovery-fixture',$5,'audio/mpeg',100,$6,$7,now())`,
      [
        id(4003),
        IDS.accountA,
        IDS.workspaceA,
        id(4002),
        objectKey,
        voice.voiceover_binary_sha256,
        hash,
      ],
    );
    const seedAttempt = async (attempt, revision, state = "FAILED", kind = "ASR") => {
      const prefix = `tenant/${IDS.accountA}/workspace/${IDS.workspaceA}/project/${id(4000)}/revision/${revision}/lane/input/job/${attempt}/artifact`;
      await db.query(
        `INSERT INTO hosted_cpu_job_attempts(id,account_id,workspace_id,project_id,project_revision_id,kind,state,execution_backend,
    execution_bundle_sha256,request_sha256,job_spec_object_key,job_spec_content_length,job_spec_checksum_sha256,result_object_key,image_digest,
    callback_token_sha256,deadline_at,submitted_at,terminal_at,retain_until)
    VALUES($1,$2,$3,$4,$5,$6,$7,'RUNPOD_POD',$8,$8,$9,100,$8,$10,$8,$8,now()+interval '1 hour',
     CASE WHEN $7='FAILED' THEN now() END,CASE WHEN $7='FAILED' THEN now() END,CASE WHEN $7='FAILED' THEN now()+interval '1 hour' END)`,
        [
          attempt,
          IDS.accountA,
          IDS.workspaceA,
          id(4000),
          revision,
          kind,
          state,
          hash,
          `${prefix}/job-spec`,
          `${prefix}/result-document`,
        ],
      );
    };
    const seedFailedRequest = async (revision, key) =>
      db.query(
        `INSERT INTO generation_requests(id,account_id,workspace_id,project_id,project_revision_id,
    created_by_user_id,state,queue_order,available_at,attempt_ordinal,idempotency_key,version,terminal_at,created_at,updated_at)
    VALUES($1,$2,$3,$4,$5,$6,'FAILED',(SELECT COALESCE(max(queue_order),0)+1 FROM generation_requests WHERE account_id=$2),now(),1,$7,1,now(),now(),now())`,
        [
          key,
          IDS.accountA,
          IDS.workspaceA,
          id(4000),
          revision,
          IDS.userA,
          `cloud-asr-recovery-fixture-${key}`,
        ],
      );
    await seedAttempt(id(4004), id(4001));
    await seedAttempt(id(4005), id(4001), "PLANNED", "RENDER");

    const run = async () =>
      (
        await db.query("SELECT videoforge_prepare_cloud_media_asr_recovery($1,$2,$3,$4,$5) value", [
          IDS.accountA,
          IDS.workspaceA,
          IDS.userA,
          id(4000),
          id(4004),
        ])
      ).rows[0].value;
    await db.query("SELECT videoforge_pin_hosted_video_plan($1,$2,$3,20,'WHOLE_SCENE_V2')", [
      IDS.accountA,
      IDS.workspaceA,
      id(4001),
    ]);
    // Match the real app catch's exact immutable job checksum, event identity and timestamp.
    await assert.rejects(run(), /not eligible/);
    await db.query(
      `INSERT INTO hosted_cpu_job_events(id,account_id,workspace_id,attempt_id,sequence,kind,facts_sha256,occurred_at)
    SELECT md5(id::text||':preparation-failed:1')::uuid,account_id,workspace_id,id,1,'FAILED',
     'sha256:'||encode(sha256(convert_to('PREPARATION_FAILED:'||job_spec_checksum_sha256,'UTF8')),'hex'),terminal_at
    FROM hosted_cpu_job_attempts WHERE id=$1`,
      [id(4004)],
    );
    const snapshot = async () =>
      (
        await db.query(
          `SELECT jsonb_build_object('revision',(SELECT to_jsonb(r) FROM project_revisions r WHERE id=$1),
   'attempt',(SELECT to_jsonb(a) FROM hosted_cpu_job_attempts a WHERE id=$2),
   'event',(SELECT to_jsonb(e) FROM hosted_cpu_job_events e WHERE attempt_id=$2),
   'receipt',(SELECT to_jsonb(r) FROM artifact_receipts r WHERE id=$3),
   'policy',(SELECT to_jsonb(p) FROM hosted_video_plans p WHERE project_revision_id=$1)) value`,
          [id(4001), id(4004), id(4003)],
        )
      ).rows[0].value;
    const original = await snapshot();
    const rejectMutation = async (operation) => {
      await db.exec("BEGIN");
      try {
        await operation();
        await assert.rejects(run(), /not eligible|retained voiceover missing/);
      } finally {
        await db.exec("ROLLBACK");
      }
      assert.deepEqual(await snapshot(), original);
    };
    await db.query("SELECT set_config('videoforge.account_id',$1,false)", [IDS.accountB]);
    await assert.rejects(run(), /owner rejected/);
    await db.query("SELECT set_config('videoforge.account_id',$1,false)", [IDS.accountA]);
    for (const changes of [
      "facts_sha256='" + hash + "'",
      "id='" + id(4090) + "'",
      "sequence=2",
      "occurred_at=occurred_at+interval '1 second'",
    ]) {
      await rejectMutation(async () => {
        // Synthetic corrupt evidence fixture only; production events remain append-only.
        await db.exec("ALTER TABLE hosted_cpu_job_events DISABLE TRIGGER USER");
        await db.query("UPDATE hosted_cpu_job_events SET " + changes + " WHERE attempt_id=$1", [
          id(4004),
        ]);
        await db.exec("ALTER TABLE hosted_cpu_job_events ENABLE TRIGGER USER");
      });
    }
    await rejectMutation(() =>
      db.query(
        `INSERT INTO hosted_cpu_job_events(id,account_id,workspace_id,attempt_id,sequence,kind,facts_sha256,occurred_at)
   VALUES($1,$2,$3,$4,2,'OUTBOXED',$5,now())`,
        [id(4091), IDS.accountA, IDS.workspaceA, id(4004), hash],
      ),
    );
    for (const changes of [
      "result_checksum_sha256='" + hash + "'",
      "result_receipt_sha256='" + hash + "'",
      "result_content_length=1",
      "provider_operation_name='projects/video-project/locations/us-central1/operations/operation1'",
      "provider_operation_name_sha256='" + hash + "'",
      "provider_execution_name='projects/video-project/locations/us-central1/jobs/job1/executions/execution1'",
      "execution_name_sha256='" + hash + "'",
      "replay_count=1",
      "cancellation_requested_at=now()",
      "retention_deleted_at=now()",
      "failure_code='CLOUD_MEDIA_FAILED'",
      "state='SUBMITTED',terminal_at=NULL,retain_until=NULL",
      "state='RECONCILING',terminal_at=NULL,retain_until=NULL",
    ]) {
      await rejectMutation(() =>
        db.query("UPDATE hosted_cpu_job_attempts SET " + changes + " WHERE id=$1", [id(4004)]),
      );
    }
    await rejectMutation(async () => {
      await seedFailedRequest(id(4001), id(4080));
      await db.query("UPDATE generation_requests SET state='CANCELLED' WHERE id=$1", [id(4080)]);
    });
    await rejectMutation(() =>
      db.query(
        "UPDATE artifact_receipts SET deleted_at=now(),deletion_reason='fixture' WHERE id=$1",
        [id(4003)],
      ),
    );
    await rejectMutation(async () => {
      await db.query(
        `INSERT INTO cloud_media_budget_authorities(id,allowed_account_ids,allowed_project_ids,total_cap_usd,max_reservation_usd,max_hourly_usd,max_rental_seconds,image,source_sha256,runtime_sha256,expires_at)
    VALUES($1,ARRAY[$2::uuid],ARRAY[$3::uuid],3,.2,.8,900,$4,$5,$5,now()+interval '1 hour')`,
        [id(4020), IDS.accountA, id(4000), "repo@" + hash, hash],
      );
      await db.query(
        `INSERT INTO cloud_media_reservations(id,account_id,workspace_id,project_id,project_revision_id,attempt_id,leased_attempt_id,budget_authority_id,fence_id,capability_sha256,pod_name,image,source_sha256,runtime_sha256,tooling,disk_gb,max_hourly_usd,budget_usd,rental_seconds,state,placement_deadline_at)
    VALUES($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$10,$11,$9,$9,'{}',100,.8,.2,900,'WAITING_CAPACITY',now()+interval '180 seconds')`,
        [
          id(4021),
          IDS.accountA,
          IDS.workspaceA,
          id(4000),
          id(4001),
          id(4004),
          id(4020),
          id(4022),
          hash,
          "videoforge-media-" + id(4021),
          "repo@" + hash,
        ],
      );
      // A fully cleaned reservation still disproves that no launch was ever authorized.
      await db.query(
        "UPDATE cloud_media_reservations SET state='CLEAN',cleanup_verified_at=now(),failure_settled_at=now() WHERE id=$1",
        [id(4021)],
      );
    });
    assert.equal(
      (
        await db.query("SELECT count(*)::int n FROM generation_requests WHERE project_id=$1", [
          id(4000),
        ])
      ).rows[0].n,
      0,
    );
    await db.exec("SET ROLE videoforge_v209_runtime_dc9612d6");
    const successor = await run();
    assert.equal(await run(), successor);
    await db.exec("RESET ROLE");
    assert.deepEqual(await snapshot(), original);
    assert.equal(
      (await db.query("SELECT state FROM hosted_cpu_job_attempts WHERE id=$1", [id(4005)])).rows[0]
        .state,
      "CANCELLED",
    );
    assert.equal(
      (
        await db.query(
          "SELECT source_receipt_id FROM cloud_media_asr_recoveries WHERE project_revision_id=$1",
          [successor],
        )
      ).rows[0].source_receipt_id,
      id(4003),
    );
    await db.query("SELECT videoforge_copy_hosted_video_plan($1,$2,$3,$4)", [
      IDS.accountA,
      IDS.workspaceA,
      id(4001),
      successor,
    ]);
    assert.deepEqual(
      (
        await db.query(
          "SELECT coverage_percent,replacement_policy,opening_seconds FROM hosted_video_plans WHERE project_revision_id=$1",
          [successor],
        )
      ).rows[0],
      { coverage_percent: 20, replacement_policy: "WHOLE_SCENE_V2", opening_seconds: 0 },
    );
    assert.equal(
      (
        await db.query("SELECT count(*)::int n FROM generation_requests WHERE project_id=$1", [
          id(4000),
        ])
      ).rows[0].n,
      0,
    );
    assert.equal(
      (await db.query("SELECT count(*)::int n FROM cloud_media_reservations")).rows[0].n,
      0,
    );
    assert.equal((await db.query("SELECT count(*)::int n FROM cloud_media_jobs")).rows[0].n, 0);
    assert.equal(
      (await db.query("SELECT count(*)::int n FROM provider_workload_leases WHERE state='ACTIVE'"))
        .rows[0].n,
      0,
    );
    // Existing settled runtime failures still use their terminal generation request,
    // without inventing a preparation event or relaxing their original guards.
    await seedAttempt(id(4007), successor);
    await seedFailedRequest(successor, id(4008));
    const settledSuccessor = (
      await db.query("SELECT videoforge_prepare_cloud_media_asr_recovery($1,$2,$3,$4,$5) value", [
        IDS.accountA,
        IDS.workspaceA,
        IDS.userA,
        id(4000),
        id(4007),
      ])
    ).rows[0].value;
    assert.notEqual(settledSuccessor, successor);
    await seedAttempt(id(4009), settledSuccessor);
    await seedFailedRequest(settledSuccessor, id(4010));
    await assert.rejects(
      db.query("SELECT videoforge_prepare_cloud_media_asr_recovery($1,$2,$3,$4,$5)", [
        IDS.accountA,
        IDS.workspaceA,
        IDS.userA,
        id(4000),
        id(4009),
      ]),
      /bounded limit reached/,
    );

    // Configurable On recovery retains its exact duration and optional percentage.
    await db.query(
      `INSERT INTO projects(id,workspace_id,owner_user_id,name,normalized_name,generation_provider)
     VALUES($1,$2,$3,'Custom opening recovery','custom opening recovery','KIE_FAL')`,
      [id(4100), IDS.workspaceA, IDS.userA],
    );
    await db.query(
      `INSERT INTO project_revisions SELECT (jsonb_populate_record(NULL::project_revisions,to_jsonb(r)||jsonb_build_object(
     'id',$1::text,'project_id',$2::text,'revision_number',1,'created_at',now(),'locked_at',now(),
     'revision_config_payload',doc.payload,'revision_config_hash','sha256:'||encode(sha256(convert_to(videoforge_canonical_jsonb(doc.payload),'UTF8')),'hex')))).*
     FROM project_revisions r CROSS JOIN LATERAL(SELECT r.revision_config_payload||jsonb_build_object('project_id',$2::text,'project_revision_id',$1::text,'scheduler_version','scheduler-v10','ai_video_opening_seconds',120) payload) doc WHERE r.id=$3`,
      [id(4101), id(4100), id(4001)],
    );
    const onKey = `tenant/${IDS.accountA}/workspace/${IDS.workspaceA}/project/${id(4100)}/revision/${id(4101)}/lane/input/job/browser-upload/artifact/voiceover`;
    await db.query(
      `INSERT INTO artifact_reservations SELECT (jsonb_populate_record(NULL::artifact_reservations,to_jsonb(r)||jsonb_build_object('id',$1::text,'project_id',$2::text,'project_revision_id',$3::text,'object_key',$4::text))).* FROM artifact_reservations r WHERE id=$5`,
      [id(4102), id(4100), id(4101), onKey, id(4002)],
    );
    await db.query(
      `INSERT INTO artifact_receipts SELECT (jsonb_populate_record(NULL::artifact_receipts,to_jsonb(r)||jsonb_build_object('id',$1::text,'reservation_id',$2::text,'callback_id','custom-opening-recovery-fixture','object_key',$3::text,'receipt_sha256','sha256:'||encode(sha256(convert_to($3::text,'UTF8')),'hex')))).* FROM artifact_receipts r WHERE id=$4`,
      [id(4103), id(4102), onKey, id(4003)],
    );
    const onPrefix = `tenant/${IDS.accountA}/workspace/${IDS.workspaceA}/project/${id(4100)}/revision/${id(4101)}/lane/input/job/${id(4104)}/artifact`;
    await db.query(
      `INSERT INTO hosted_cpu_job_attempts SELECT (jsonb_populate_record(NULL::hosted_cpu_job_attempts,to_jsonb(a)||jsonb_build_object('id',$1::text,'project_id',$2::text,'project_revision_id',$3::text,'job_spec_object_key',$4::text,'result_object_key',$5::text))).* FROM hosted_cpu_job_attempts a WHERE id=$6`,
      [
        id(4104),
        id(4100),
        id(4101),
        onPrefix + "/job-spec",
        onPrefix + "/result-document",
        id(4004),
      ],
    );
    await db.query(
      `INSERT INTO hosted_cpu_job_events(id,account_id,workspace_id,attempt_id,sequence,kind,facts_sha256,occurred_at)
     SELECT md5(id::text||':preparation-failed:1')::uuid,account_id,workspace_id,id,1,'FAILED','sha256:'||encode(sha256(convert_to('PREPARATION_FAILED:'||job_spec_checksum_sha256,'UTF8')),'hex'),terminal_at FROM hosted_cpu_job_attempts WHERE id=$1`,
      [id(4104)],
    );
    await db.query("SELECT videoforge_pin_hosted_video_plan($1,$2,$3,7,'OPENING_CONFIG_V4',120)", [
      IDS.accountA,
      IDS.workspaceA,
      id(4101),
    ]);
    const onSuccessor = (
      await db.query("SELECT videoforge_prepare_cloud_media_asr_recovery($1,$2,$3,$4,$5) value", [
        IDS.accountA,
        IDS.workspaceA,
        IDS.userA,
        id(4100),
        id(4104),
      ])
    ).rows[0].value;
    await db.query("SELECT videoforge_copy_hosted_video_plan($1,$2,$3,$4)", [
      IDS.accountA,
      IDS.workspaceA,
      id(4101),
      onSuccessor,
    ]);
    assert.deepEqual(
      (
        await db.query(
          "SELECT coverage_percent,replacement_policy,opening_seconds FROM hosted_video_plans WHERE project_revision_id=$1",
          [onSuccessor],
        )
      ).rows[0],
      { coverage_percent: 7, replacement_policy: "OPENING_CONFIG_V4", opening_seconds: 120 },
    );
    assert.equal(
      (
        await db.query(
          "SELECT revision_config_payload->'ai_video_opening_seconds' seconds FROM project_revisions WHERE id=$1",
          [onSuccessor],
        )
      ).rows[0].seconds,
      120,
    );
    assert.equal(
      (
        await db.query("SELECT count(*)::int n FROM generation_requests WHERE project_id=$1", [
          id(4100),
        ])
      ).rows[0].n,
      0,
    );
    assert.deepEqual(await snapshot(), original);
    assert.equal(
      (
        await db.query(
          "SELECT has_table_privilege('videoforge_v209_runtime_dc9612d6','cloud_media_asr_recoveries','INSERT') allowed",
        )
      ).rows[0].allowed,
      false,
    );
  } finally {
    await db.close();
  }
});

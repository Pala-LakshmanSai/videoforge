import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { PGliteExecutor } from "./support/pglite.mjs";
import { IDS, seedLockedProjects } from "./support/fixtures.mjs";
const migration = readFileSync(
  new URL("../migrations/0257_hosted_asr_timing_recovery.sql", import.meta.url),
  "utf8",
);
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = `sha256:${"a".repeat(64)}`;

test("accepted ASR timing recovery preserves exact evidence, fences downstream work and holds new paid stages", async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  try {
    await db.exec("CREATE EXTENSION pgcrypto");
    const executor = new PGliteExecutor(db);
    const manifest = JSON.parse(
      readFileSync(new URL("../migrations/manifest.json", import.meta.url), "utf8"),
    );
    for (const entry of manifest.migrations.filter((row) => row.version <= 256)) {
      if (entry.version === 195) continue;
      const bytes = readFileSync(
        new URL(`../migrations/${entry.filename}`, import.meta.url),
        "utf8",
      );
      assert.equal(`sha256:${createHash("sha256").update(bytes).digest("hex")}`, entry.sha256);
      await executor.execute(bytes);
    }
    await executor.execute(migration);
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
     CASE WHEN $7 IN ('FAILED','SUCCEEDED') THEN now() END,CASE WHEN $7 IN ('FAILED','SUCCEEDED') THEN now() END,CASE WHEN $7 IN ('FAILED','SUCCEEDED') THEN now()+interval '1 hour' END)`,
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
    await seedAttempt(id(4004), id(4001));
    await db.query(
      "UPDATE hosted_cpu_job_attempts SET state='SUCCEEDED',result_receipt_sha256=$1,result_checksum_sha256=$1,result_content_length=100 WHERE id=$2",
      [hash, id(4004)],
    );
    const admission = (
      await db.query("SELECT videoforge_admit_hosted_v209_generation($1,$2,$3,$4) AS value", [
        IDS.accountA,
        IDS.workspaceA,
        IDS.userA,
        id(4000),
      ])
    ).rows[0].value;
    assert.equal(admission.state, "ACTIVE");
    const acceptedBefore = (
      await db.query("SELECT to_jsonb(a) AS value FROM hosted_cpu_job_attempts a WHERE id=$1", [
        id(4004),
      ])
    ).rows[0].value;
    const old = (
      await db.query("SELECT to_jsonb(r) AS value FROM project_revisions r WHERE id=$1", [id(4001)])
    ).rows[0].value;
    const run = async (checksum = hash) =>
      (
        await db.query(
          "SELECT videoforge_prepare_hosted_asr_timing_recovery($1,$2,$3,$4,$5,$6,$7) AS revision",
          [IDS.accountA, IDS.workspaceA, IDS.userA, id(4000), id(4001), id(4004), checksum],
        )
      ).rows[0].revision;
    assert.equal(
      (
        await db.query(
          "SELECT has_function_privilege('videoforge_v209_runtime_dc9612d6','videoforge_prepare_hosted_asr_timing_recovery(uuid,uuid,uuid,uuid,uuid,uuid,text)','EXECUTE') AS yes",
        )
      ).rows[0].yes,
      false,
    );
    await db.exec("SET ROLE videoforge_v209_runtime_dc9612d6");
    await assert.rejects(run(), /permission denied/);
    await db.exec("RESET ROLE");
    await assert.rejects(run("sha256:" + "b".repeat(64)), /accepted identity rejected/);
    await db.query("SELECT set_config('videoforge.account_id',$1,false)", [IDS.accountB]);
    await assert.rejects(run(), /owner rejected/);
    await db.query("SELECT set_config('videoforge.account_id',$1,false)", [IDS.accountA]);
    await seedAttempt(id(4005), id(4001), "PLANNED", "RENDER");
    await assert.rejects(run(), /not eligible/);
    await db.query("DELETE FROM hosted_cpu_job_attempts WHERE id=$1", [id(4005)]);
    const first = await run();
    assert.equal(await run(), first);
    assert.deepEqual(
      (
        await db.query("SELECT to_jsonb(r) AS value FROM project_revisions r WHERE id=$1", [
          id(4001),
        ])
      ).rows[0].value,
      old,
    );
    assert.deepEqual(
      (
        await db.query("SELECT to_jsonb(a) AS value FROM hosted_cpu_job_attempts a WHERE id=$1", [
          id(4004),
        ])
      ).rows[0].value,
      acceptedBefore,
    );
    const next = (await db.query("SELECT * FROM project_revisions WHERE id=$1", [first])).rows[0];
    assert.equal(next.revision_number, 2);
    assert.equal(next.voiceover_asset_id, voice.voiceover_asset_id);
    assert.equal(next.voiceover_binary_sha256, voice.voiceover_binary_sha256);
    assert.equal(next.revision_config_payload.project_revision_id, first);
    assert.equal(
      next.revision_config_hash,
      (
        await db.query(
          "SELECT 'sha256:'||encode(sha256(convert_to(videoforge_canonical_jsonb($1::jsonb),'UTF8')),'hex') AS hash",
          [next.revision_config_payload],
        )
      ).rows[0].hash,
    );
    assert.equal(
      (
        await db.query("SELECT state FROM generation_requests WHERE id=$1", [
          admission.generationRequestId,
        ])
      ).rows[0].state,
      "CANCELLED",
    );
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int AS n FROM provider_workload_leases WHERE state='ACTIVE'",
        )
      ).rows[0].n,
      0,
    );
    const recovery = (
      await db.query("SELECT * FROM cloud_media_asr_recoveries WHERE project_revision_id=$1", [
        first,
      ])
    ).rows[0];
    assert.equal(recovery.source_receipt_id, id(4003));
    assert.equal(recovery.preparation_only, true);
    const paused = (
      await db.query("SELECT videoforge_load_hosted_prompt_plan($1,$2,$3,$4) AS plan", [
        IDS.accountA,
        IDS.workspaceA,
        IDS.userA,
        id(4000),
      ])
    ).rows[0].plan;
    assert.deepEqual(paused, { preparation_only: true });
    assert.equal(
      (await db.query("SELECT count(*)::int AS n FROM hosted_prompt_runs")).rows[0].n,
      0,
    );
    assert.equal((await db.query("SELECT count(*)::int AS n FROM artifact_receipts")).rows[0].n, 1);
    const app = readFileSync(
      new URL("../../../apps/web/src/server/hosted/app.ts", import.meta.url),
      "utf8",
    );
    const queryStart = app.indexOf(
      "`SELECT receipt.id, receipt.object_key",
      app.indexOf("const artifacts ="),
    );
    const inputSql = app.slice(queryStart + 1, app.indexOf("`", queryStart + 1));
    assert.equal(
      (await db.query(inputSql, [IDS.accountA, IDS.workspaceA, [id(4003)], id(4000), first, "ASR"]))
        .rows.length,
      1,
    );
    assert.equal(
      (await db.query(inputSql, [IDS.accountB, IDS.workspaceB, [id(4003)], id(4000), first, "ASR"]))
        .rows.length,
      0,
    );
  } finally {
    await db.close();
  }
});

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = new URL("../migrations/0211_hosted_api_bounded_local_render_recovery.sql", import.meta.url);
const bytes = readFileSync(migration);
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const account = id(1);
const workspace = id(2);
const user = id(3);
const project = id(4);
const revision = id(5);
const request = id(6);
const runtime = id(7);
const failed = id(8);
const retry = id(9);
const oldBundle = `sha256:${"a".repeat(64)}`;
const newBundle = `sha256:${"b".repeat(64)}`;

test("0211 retries local failures without a required error sequence and preserves accepted inputs", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE videoforge_v209_runtime_dc9612d6;
      CREATE TABLE projects (id uuid PRIMARY KEY, account_id uuid, workspace_id uuid,
        status text, generation_provider text);
      CREATE TABLE generation_requests (id uuid PRIMARY KEY, account_id uuid, workspace_id uuid,
        project_id uuid, project_revision_id uuid, created_by_user_id uuid, state text,
        terminal_at timestamptz, version integer, updated_at timestamptz, created_at timestamptz,
        UNIQUE(account_id,workspace_id,id));
      CREATE TABLE video_runtime_states (id uuid PRIMARY KEY, account_id uuid, workspace_id uuid,
        project_id uuid, project_revision_id uuid, generation_request_id uuid, stage text,
        terminal_reason text, terminal_at timestamptz, final_output_sha256 text,
        render_manifest_sha256 text, version integer, updated_at timestamptz,
        UNIQUE(account_id,workspace_id,id));
      CREATE TABLE hosted_cpu_job_attempts (id uuid PRIMARY KEY, account_id uuid, workspace_id uuid,
        project_id uuid, project_revision_id uuid, kind text, state text, terminal_at timestamptz,
        result_content_length bigint, result_checksum_sha256 text, result_receipt_sha256 text,
        image_digest text, execution_bundle_sha256 text, created_at timestamptz DEFAULT now(), UNIQUE(account_id,workspace_id,id));
      CREATE TABLE provider_workload_leases (id uuid PRIMARY KEY, account_id uuid, workspace_id uuid,
        generation_request_id uuid, state text, release_reason text);
      CREATE TABLE media_worker_leases (attempt_id uuid, account_id uuid, workspace_id uuid,
        state text, failure_code text, created_at timestamptz DEFAULT now());
      CREATE TABLE hosted_cpu_upload_authorities (attempt_id uuid, account_id uuid,
        workspace_id uuid, issued_at timestamptz);
      CREATE TABLE serverless_attempts (generation_request_id uuid);
      CREATE TABLE hosted_render_plans (account_id uuid, workspace_id uuid, project_id uuid,
        project_revision_id uuid, schema_version text, payload jsonb, payload_sha256 text);
      CREATE TABLE video_runtime_lane_states (runtime_id uuid, state text);
      CREATE TABLE video_runtime_events (id uuid PRIMARY KEY, account_id uuid, workspace_id uuid,
        runtime_id uuid, project_revision_id uuid, lane text, from_state text, to_state text,
        reason text, detail jsonb, occurred_at timestamptz);
      CREATE TABLE hosted_api_render_recoveries (generation_request_id uuid,
        account_id uuid, workspace_id uuid, project_id uuid, failed_attempt_id uuid);
      CREATE TABLE hosted_api_render_io_recoveries (generation_request_id uuid,
        account_id uuid, workspace_id uuid, project_id uuid, retry_attempt_id uuid, failed_attempt_id uuid);
      CREATE TABLE hosted_api_render_input_recoveries (generation_request_id uuid, account_id uuid,workspace_id uuid,project_id uuid,failed_attempt_id uuid);
      CREATE TABLE hosted_api_first_render_input_recoveries (account_id uuid,workspace_id uuid,project_id uuid,failed_attempt_id uuid);
      CREATE TABLE hosted_api_second_render_process_recoveries (account_id uuid,workspace_id uuid,project_id uuid,failed_attempt_id uuid);
      CREATE TABLE hosted_api_third_render_signal_recoveries (account_id uuid,workspace_id uuid,project_id uuid,failed_attempt_id uuid);
      CREATE TABLE hosted_api_fourth_render_output_recoveries (account_id uuid,workspace_id uuid,project_id uuid,failed_attempt_id uuid);
      CREATE FUNCTION videoforge_current_account_id() RETURNS uuid LANGUAGE sql STABLE
        AS $$ SELECT '${account}'::uuid $$;
      CREATE FUNCTION videoforge_v209_api_outputs_accepted(uuid,uuid,uuid,uuid)
        RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
      CREATE FUNCTION videoforge_canonical_jsonb(jsonb) RETURNS text LANGUAGE sql IMMUTABLE
        AS $$ SELECT $1::text $$;
      CREATE FUNCTION sha256(bytea) RETURNS bytea LANGUAGE sql IMMUTABLE
        AS $$ SELECT decode(repeat('0',64),'hex') $$;
      CREATE FUNCTION videoforge_validate_video_runtime_state() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN
  IF OLD.stage IN ('COMPLETE', 'FAILED', 'CANCELED') THEN
    RAISE EXCEPTION 'terminal runtime';
  END IF;
  RETURN NEW;
END; $$;
      CREATE TRIGGER validate_video_runtime_state BEFORE UPDATE ON video_runtime_states
        FOR EACH ROW EXECUTE FUNCTION videoforge_validate_video_runtime_state();
      CREATE FUNCTION videoforge_prepare_hosted_api_render_recovery(
        uuid,uuid,uuid,uuid,uuid,uuid,text,text) RETURNS jsonb LANGUAGE sql
        AS $$ SELECT '{"legacy":true}'::jsonb $$;
    `);
    // 0207 must see the 0199 terminal-state branch in the prior trigger body.
    await db.exec(`CREATE OR REPLACE FUNCTION videoforge_validate_video_runtime_state()
      RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF EXISTS (SELECT 1 FROM hosted_api_fourth_render_output_recoveries) THEN RETURN NEW; END IF;
  IF OLD.stage IN ('COMPLETE', 'FAILED', 'CANCELED') THEN
    RAISE EXCEPTION 'terminal runtime';
  END IF;
  RETURN NEW;
END; $$;`);
    await db.exec(bytes.toString("utf8"));
    assert.equal((await db.query(`SELECT has_function_privilege(
      'videoforge_v209_runtime_dc9612d6',
      'public.videoforge_prepare_hosted_api_render_recovery(uuid,uuid,uuid,uuid,uuid,uuid,text,text)',
      'EXECUTE') AS allowed`)).rows[0].allowed, true);
    await db.query(`INSERT INTO projects VALUES ($1,$2,$3,'ACTIVE','KIE_FAL')`,
      [project, account, workspace]);
    await db.query(`INSERT INTO generation_requests VALUES
      ($1,$2,$3,$4,$5,$6,'FAILED',now(),1,now(),now())`,
      [request, account, workspace, project, revision, user]);
    await db.query(`INSERT INTO video_runtime_states VALUES
      ($1,$2,$3,$4,$5,$6,'FAILED','RENDER_FAILURE',now(),NULL,$7,1,now())`,
      [runtime, account, workspace, project, revision, request, `sha256:${"c".repeat(64)}`]);
    await db.query(`INSERT INTO hosted_cpu_job_attempts VALUES
      ($1,$2,$3,$4,$5,'RENDER','FAILED',now(),NULL,NULL,NULL,$6,$6)`,
      [failed, account, workspace, project, revision, oldBundle]);
    await db.query(`INSERT INTO media_worker_leases VALUES
      ($1,$2,$3,'FAILED','RENDER_INPUT_INVALID')`, [failed, account, workspace]);
    await db.query(`INSERT INTO provider_workload_leases VALUES
      ($1,$2,$3,$4,'RELEASED','HOSTED_API_OUTPUTS_ACCEPTED')`,
      [id(10), account, workspace, request]);
    await db.query(`INSERT INTO hosted_render_plans VALUES
      ($1,$2,$3,$4,'videoforge-hosted-cpu-submission/v1','{"kind":"RENDER"}'::jsonb,
       'sha256:'||repeat('0',64))`, [account, workspace, project, revision]);

    const call = (bundle, retryId = retry) => db.query(
      `SELECT videoforge_prepare_hosted_api_render_recovery($1,$2,$3,$4,$5,$6,$7,'0.1.39') AS value`,
      [account, workspace, user, project, failed, retryId, bundle]);
    const updateRequired = (await db.query(`SELECT videoforge_read_hosted_api_render_recovery_status($1,$2,$3,$4,$5) AS value`,
      [account,workspace,user,project,oldBundle])).rows[0].value;
    assert.deepEqual([updateRequired.eligible,updateRequired.reason],[false,'WORKER_UPDATE_REQUIRED']);
    await assert.rejects(call(oldBundle), /evidence rejected/u);
    await db.query(`INSERT INTO serverless_attempts VALUES ($1)`, [request]);
    await assert.rejects(call(newBundle), /evidence rejected/u);
    await db.query(`DELETE FROM serverless_attempts`);
    await db.query(`INSERT INTO hosted_cpu_upload_authorities VALUES ($1,$2,$3,now())`,
      [failed, account, workspace]);
    await assert.rejects(call(newBundle), /evidence rejected/u);
    await db.query(`DELETE FROM hosted_cpu_upload_authorities`);

    const first = (await call(newBundle)).rows[0].value;
    assert.deepEqual([first.recovery_kind, first.retry_attempt_id, first.replayed],
      ["LOCAL", retry, false]);
    const states = (await db.query(`SELECT request.state AS request_state,
      runtime.stage AS runtime_stage, recovery.state AS recovery_state,
      recovery.replacement_bundle_sha256
      FROM generation_requests request JOIN video_runtime_states runtime
      ON runtime.generation_request_id=request.id
      JOIN hosted_api_local_render_recoveries recovery
      ON recovery.generation_request_id=request.id WHERE request.id=$1`, [request])).rows[0];
    assert.deepEqual([states.request_state, states.runtime_stage, states.recovery_state,
      states.replacement_bundle_sha256], ["ACTIVE", "RENDERING", "CONSUMED", newBundle]);
    assert.equal((await db.query(`SELECT count(*)::int AS count FROM hosted_cpu_job_attempts
      WHERE kind='RENDER'`)).rows[0].count, 1);
    assert.equal((await db.query(`SELECT detail->>'provider_actions_created' AS paid
      FROM video_runtime_events WHERE reason='LOCAL_RENDER_RECOVERY'`)).rows[0].paid, "false");
    const replay = (await call(newBundle, id(11))).rows[0].value;
    assert.deepEqual([replay.retry_attempt_id, replay.replayed], [retry, true]);
    await assert.rejects(call(oldBundle, id(11)), /identity drift/u);
    const status = (await db.query(`SELECT videoforge_read_hosted_api_render_recovery_status($1,$2,$3,$4,$5) AS value`,
      [account,workspace,user,project,newBundle])).rows[0].value;
    assert.equal(status.eligible, false);
    await db.query(`UPDATE generation_requests SET state='FAILED',terminal_at=now()`);
    await db.query(`UPDATE video_runtime_states SET stage='FAILED',terminal_reason='RENDER_FAILURE',terminal_at=now()`);
    await db.query(`INSERT INTO hosted_cpu_job_attempts VALUES
      ($1,$2,$3,$4,$5,'RENDER','FAILED',now(),NULL,NULL,NULL,$6,$6,now()+interval '1 second')`,
      [retry,account,workspace,project,revision,newBundle]);
    await db.query(`INSERT INTO media_worker_leases VALUES ($1,$2,$3,'FAILED','MEDIA_EXECUTION_TIMEOUT')`,
      [retry,account,workspace]);
    const timeoutStatus = (await db.query(`SELECT videoforge_read_hosted_api_render_recovery_status($1,$2,$3,$4,$5) AS value`,
      [account,workspace,user,project,newBundle])).rows[0].value;
    assert.equal(timeoutStatus.eligible, true);
    const next = (await db.query(`SELECT videoforge_prepare_hosted_api_render_recovery($1,$2,$3,$4,$5,$6,$7,'0.1.39') AS value`,
      [account,workspace,user,project,retry,id(20),newBundle])).rows[0].value;
    assert.equal(next.retry_attempt_id,id(20));
    assert.notEqual(next.recovery_key, first.recovery_key);
    assert.equal((await db.query(`SELECT count(*)::int AS count FROM hosted_api_local_render_recoveries`)).rows[0].count,2);
    await db.query(`INSERT INTO hosted_api_first_render_input_recoveries VALUES ($1,$2,$3,$4)`,
      [account,workspace,project,failed]);
    assert.deepEqual((await call(newBundle)).rows[0].value,{legacy:true});

    await db.query(`UPDATE generation_requests SET state='FAILED',terminal_at=now()`);
    await db.query(`UPDATE video_runtime_states SET stage='FAILED',terminal_reason='RENDER_FAILURE',terminal_at=now()`);
    for (const n of [21,22,23]) {
      await db.query(`INSERT INTO hosted_cpu_job_attempts VALUES
        ($1,$2,$3,$4,$5,'RENDER','FAILED',now(),NULL,NULL,NULL,$6,$6,now()+interval '30 seconds')`,
        [id(n),account,workspace,project,revision,newBundle]);
      await db.query(`INSERT INTO media_worker_leases VALUES ($1,$2,$3,'FAILED','RENDER_PROCESS_FAILED')`,
        [id(n),account,workspace]);
    }
    const capped = (await db.query(`SELECT videoforge_read_hosted_api_render_recovery_status($1,$2,$3,$4,$5) AS value`,
      [account,workspace,user,project,newBundle])).rows[0].value;
    assert.deepEqual([capped.eligible,capped.reason],[false,'RETRY_LIMIT_REACHED']);
    await assert.rejects(db.query(`SELECT videoforge_prepare_hosted_api_render_recovery($1,$2,$3,$4,$5,$6,$7,'0.1.39')`,
      [account,workspace,user,project,id(23),id(24),newBundle]),/evidence rejected/u);
    assert.equal((await db.query(`SELECT count(*)::int AS count FROM hosted_api_local_render_recoveries`)).rows[0].count,2);
    await db.query(`INSERT INTO hosted_api_first_render_input_recoveries VALUES ($1,$2,$3,$4)`,
      [account,workspace,project,failed]);
    assert.deepEqual((await call(newBundle)).rows[0].value,{legacy:true});

  } finally {
    await db.close();
  }
});

test("0211 retains its exact manifest entry", () => {
  const manifest = JSON.parse(readFileSync(new URL("../migrations/manifest.json", import.meta.url)));
  const entry = manifest.migrations.find((item) => item.version === 211);
  assert.deepEqual([entry.version, entry.name, entry.filename],
    [211, "hosted_api_bounded_local_render_recovery", "0211_hosted_api_bounded_local_render_recovery.sql"]);
  assert.equal(entry.sha256, `sha256:${createHash("sha256").update(bytes).digest("hex")}`);
});

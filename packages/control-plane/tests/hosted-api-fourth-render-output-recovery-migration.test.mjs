import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration207 = readFileSync(new URL("../migrations/0207_hosted_api_first_render_input_recovery.sql", import.meta.url));
const migration208 = readFileSync(new URL("../migrations/0208_hosted_api_second_render_process_recovery.sql", import.meta.url));
const migration209 = readFileSync(new URL("../migrations/0209_hosted_api_third_render_signal_recovery.sql", import.meta.url));
const migration210 = readFileSync(new URL("../migrations/0210_hosted_api_fourth_render_output_recovery.sql", import.meta.url));
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const account = id(1), workspace = id(2), user = id(3), project = id(4), revision = id(5);
const request = id(6), runtime = id(7), firstAttempt = id(8), secondAttempt = id(9);
const thirdAttempt = id(10), fourthAttempt = id(12), fifthAttempt = id(13);
const firstBundle = `sha256:${"a".repeat(64)}`;
const secondBundle = `sha256:${"b".repeat(64)}`;
const thirdBundle = `sha256:${"c".repeat(64)}`;
const fourthBundle = `sha256:${"e".repeat(64)}`;
const fifthBundle = `sha256:${"f".repeat(64)}`;

test("0210 permits one exact provider-free output recovery on worker 0.1.37+", async () => {
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
        image_digest text, execution_bundle_sha256 text, UNIQUE(account_id,workspace_id,id));
      CREATE TABLE provider_workload_leases (id uuid PRIMARY KEY, account_id uuid, workspace_id uuid,
        generation_request_id uuid, state text, release_reason text);
      CREATE TABLE media_worker_leases (attempt_id uuid, account_id uuid, workspace_id uuid,
        state text, failure_code text);
      CREATE TABLE media_worker_devices (account_id uuid, workspace_id uuid,
        status text, removed_at timestamptz, execution_bundle_sha256 text,
        worker_version text, last_seen_at timestamptz);
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
        account_id uuid, workspace_id uuid, project_id uuid);
      CREATE TABLE hosted_api_render_io_recoveries (generation_request_id uuid,
        account_id uuid, workspace_id uuid, project_id uuid, retry_attempt_id uuid);
      CREATE TABLE hosted_api_render_input_recoveries (generation_request_id uuid);
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
  IF EXISTS (SELECT 1 FROM hosted_api_render_input_recoveries) THEN RETURN NEW; END IF;
  IF OLD.stage IN ('COMPLETE', 'FAILED', 'CANCELED') THEN
    RAISE EXCEPTION 'terminal runtime';
  END IF;
  RETURN NEW;
END; $$;
      CREATE TRIGGER validate_video_runtime_state BEFORE UPDATE ON video_runtime_states
        FOR EACH ROW EXECUTE FUNCTION videoforge_validate_video_runtime_state();
      CREATE FUNCTION videoforge_prepare_hosted_api_render_recovery(
        uuid,uuid,uuid,uuid,uuid,uuid) RETURNS jsonb LANGUAGE sql
        AS $$ SELECT '{}'::jsonb $$;
    `);
    await db.exec(migration207.toString("utf8"));
    await db.exec(migration208.toString("utf8"));
    await db.exec(migration209.toString("utf8"));
    await db.exec(migration210.toString("utf8"));
    assert.equal((await db.query(`SELECT has_function_privilege(
      'videoforge_v209_runtime_dc9612d6',
      'public.videoforge_prepare_hosted_api_render_recovery(uuid,uuid,uuid,uuid,uuid,uuid,text,text)',
      'EXECUTE') AS allowed`)).rows[0].allowed, true);
    assert.equal((await db.query(`SELECT has_function_privilege(
      'videoforge_v209_runtime_dc9612d6',
      'public.videoforge_prepare_hosted_api_fourth_render_output_recovery(uuid,uuid,uuid,uuid,uuid,uuid,text)',
      'EXECUTE') AS allowed`)).rows[0].allowed, false);
    await db.query(`INSERT INTO projects VALUES ($1,$2,$3,'ACTIVE','KIE_FAL')`,
      [project, account, workspace]);
    await db.query(`INSERT INTO generation_requests VALUES
      ($1,$2,$3,$4,$5,$6,'FAILED',now(),1,now(),now())`,
      [request, account, workspace, project, revision, user]);
    await db.query(`INSERT INTO video_runtime_states VALUES
      ($1,$2,$3,$4,$5,$6,'FAILED','RENDER_FAILURE',now(),NULL,$7,1,now())`,
      [runtime, account, workspace, project, revision, request, `sha256:${"d".repeat(64)}`]);
    await db.query(`INSERT INTO hosted_cpu_job_attempts VALUES
      ($1,$2,$3,$4,$5,'RENDER','FAILED',now(),NULL,NULL,NULL,$6,$6)`,
      [firstAttempt, account, workspace, project, revision, firstBundle]);
    await db.query(`INSERT INTO media_worker_leases VALUES
      ($1,$2,$3,'FAILED','RENDER_INPUT_INVALID')`, [firstAttempt, account, workspace]);
    await db.query(`INSERT INTO provider_workload_leases VALUES
      ($1,$2,$3,$4,'RELEASED','HOSTED_API_OUTPUTS_ACCEPTED')`,
      [id(11), account, workspace, request]);
    await db.query(`INSERT INTO hosted_render_plans VALUES
      ($1,$2,$3,$4,'videoforge-hosted-cpu-submission/v1','{"kind":"RENDER"}'::jsonb,
       'sha256:'||repeat('0',64))`, [account, workspace, project, revision]);
    const call = (bundle, version = "0.1.37", failedId = fourthAttempt, retryId = fifthAttempt) => db.query(
      `SELECT videoforge_prepare_hosted_api_render_recovery($1,$2,$3,$4,$5,$6,$7,$8) AS value`,
      [account, workspace, user, project, failedId, retryId, bundle, version]);
    await db.query(`SELECT videoforge_prepare_hosted_api_render_recovery(
      $1,$2,$3,$4,$5,$6,$7)`,
      [account, workspace, user, project, firstAttempt, secondAttempt, secondBundle]);
    await db.query(`INSERT INTO hosted_cpu_job_attempts VALUES
      ($1,$2,$3,$4,$5,'RENDER','FAILED',now(),NULL,NULL,NULL,$6,$6)`,
      [secondAttempt, account, workspace, project, revision, secondBundle]);
    await db.query(`INSERT INTO media_worker_leases VALUES
      ($1,$2,$3,'FAILED','RENDER_PROCESS_FAILED')`, [secondAttempt, account, workspace]);
    await db.query(`UPDATE generation_requests SET state='FAILED',terminal_at=now() WHERE id=$1`,
      [request]);
    await db.query(`UPDATE video_runtime_states SET stage='FAILED',terminal_reason='RENDER_FAILURE',
      terminal_at=now() WHERE id=$1`, [runtime]);
    await db.query(`SELECT videoforge_prepare_hosted_api_render_recovery(
      $1,$2,$3,$4,$5,$6,$7)`,
      [account, workspace, user, project, secondAttempt, thirdAttempt, thirdBundle]);
    await db.query(`INSERT INTO hosted_cpu_job_attempts VALUES
      ($1,$2,$3,$4,$5,'RENDER','FAILED',now(),NULL,NULL,NULL,$6,$6)`,
      [thirdAttempt, account, workspace, project, revision, thirdBundle]);
    await db.query(`INSERT INTO media_worker_leases VALUES
      ($1,$2,$3,'FAILED','RENDER_PROCESS_FAILED')`, [thirdAttempt, account, workspace]);
    await db.query(`UPDATE generation_requests SET state='FAILED',terminal_at=now() WHERE id=$1`,
      [request]);
    await db.query(`UPDATE video_runtime_states SET stage='FAILED',terminal_reason='RENDER_FAILURE',
      terminal_at=now() WHERE id=$1`, [runtime]);
    await call(fourthBundle, "0.1.36", thirdAttempt, fourthAttempt);
    await db.query(`INSERT INTO hosted_cpu_job_attempts VALUES
      ($1,$2,$3,$4,$5,'RENDER','FAILED',now(),NULL,NULL,NULL,$6,$6)`,
      [fourthAttempt, account, workspace, project, revision, fourthBundle]);
    await db.query(`INSERT INTO media_worker_leases VALUES
      ($1,$2,$3,'FAILED','RENDER_OUTPUT_INVALID')`, [fourthAttempt, account, workspace]);
    await db.query(`UPDATE generation_requests SET state='FAILED',terminal_at=now() WHERE id=$1`,
      [request]);
    await db.query(`UPDATE video_runtime_states SET stage='FAILED',terminal_reason='RENDER_FAILURE',
      terminal_at=now() WHERE id=$1`, [runtime]);
    await assert.rejects(call(fifthBundle, "0.1.36"), /requires worker 0.1.37/u);
    await assert.rejects(call(fourthBundle), /evidence rejected/u);
    await assert.rejects(call(fifthBundle), /evidence rejected/u);
    await db.query(`INSERT INTO media_worker_devices VALUES
      ($1,$2,'ONLINE',NULL,$3,'0.1.37',now())`, [account, workspace, fifthBundle]);
    await db.query(`INSERT INTO serverless_attempts VALUES ($1)`, [request]);
    await assert.rejects(call(fifthBundle), /evidence rejected/u);
    await db.query(`DELETE FROM serverless_attempts`);
    await db.query(`INSERT INTO hosted_cpu_upload_authorities VALUES ($1,$2,$3,now())`,
      [fourthAttempt, account, workspace]);
    await assert.rejects(call(fifthBundle), /evidence rejected/u);
    await db.query(`DELETE FROM hosted_cpu_upload_authorities`);
    const first = (await call(fifthBundle)).rows[0].value;
    assert.deepEqual([first.recovery_kind, first.retry_attempt_id, first.replayed],
      ["OUTPUT", fifthAttempt, false]);
    const state = (await db.query(`SELECT request.state AS request_state,
      runtime.stage AS runtime_stage, recovery.state AS recovery_state
      FROM generation_requests request JOIN video_runtime_states runtime
        ON runtime.generation_request_id=request.id
      JOIN hosted_api_fourth_render_output_recoveries recovery
        ON recovery.generation_request_id=request.id WHERE request.id=$1`, [request])).rows[0];
    assert.deepEqual([state.request_state, state.runtime_stage, state.recovery_state],
      ["ACTIVE", "RENDERING", "CONSUMED"]);
    assert.equal((await db.query(`SELECT count(*)::int AS count FROM hosted_cpu_job_attempts
      WHERE kind='RENDER'`)).rows[0].count, 4);
    assert.equal((await db.query(`SELECT detail->>'provider_actions_created' AS paid
      FROM video_runtime_events WHERE reason='LOCAL_RENDER_OUTPUT_RECOVERY'`)).rows[0].paid, "false");
    const replay = (await call(fifthBundle, "0.1.37", fourthAttempt, id(14))).rows[0].value;
    assert.deepEqual([replay.retry_attempt_id, replay.replayed], [fifthAttempt, true]);
    await assert.rejects(call(firstBundle, "0.1.37", fourthAttempt, id(14)), /identity drift/u);
    await assert.rejects(call(fifthBundle, "0.1.37", fifthAttempt, id(14)), /identity drift/u);
    assert.equal((await db.query(`SELECT count(*)::int AS count
      FROM hosted_api_fourth_render_output_recoveries`)).rows[0].count, 1);
  } finally {
    await db.close();
  }
});

test("0210 is the exact manifest tail", () => {
  const manifest = JSON.parse(readFileSync(new URL("../migrations/manifest.json", import.meta.url)));
  const tail = manifest.migrations.at(-1);
  assert.deepEqual([tail.version, tail.name, tail.filename],
    [210, "hosted_api_fourth_render_output_recovery", "0210_hosted_api_fourth_render_output_recovery.sql"]);
  assert.equal(tail.sha256, `sha256:${createHash("sha256").update(migration210).digest("hex")}`);
});

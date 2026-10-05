import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const readMigration = (name) =>
  readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8");
const migration = readMigration("0271_render_asset_missing_recovery.sql");
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [account, workspace, user, project, revision, request, runtime, failed, retry] = Array.from(
  { length: 9 },
  (_, i) => id(i + 1),
);
const oldBundle = `sha256:${"a".repeat(64)}`;
const newBundle = `sha256:${"b".repeat(64)}`;

// Use the actual 0211/0214 recovery bodies and 0224 reader against the existing bounded-retry fixture.
test("0271 requires an upgraded renderer for missing assets and preserves recovery fences", async (t) => {
  for (const cloud of [false, true])
    await t.test(cloud ? "Cloud" : "Local", async () => {
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
        await db.exec(readMigration("0211_hosted_api_bounded_local_render_recovery.sql"));
        assert.equal(
          (
            await db.query(`SELECT has_function_privilege(
      'videoforge_v209_runtime_dc9612d6',
      'public.videoforge_prepare_hosted_api_render_recovery(uuid,uuid,uuid,uuid,uuid,uuid,text,text)',
      'EXECUTE') AS allowed`)
          ).rows[0].allowed,
          true,
        );
        await db.query(`INSERT INTO projects VALUES ($1,$2,$3,'ACTIVE','KIE_FAL')`, [
          project,
          account,
          workspace,
        ]);
        await db.query(
          `INSERT INTO generation_requests VALUES
      ($1,$2,$3,$4,$5,$6,'FAILED',now(),1,now(),now())`,
          [request, account, workspace, project, revision, user],
        );
        await db.query(
          `INSERT INTO video_runtime_states VALUES
      ($1,$2,$3,$4,$5,$6,'FAILED','RENDER_FAILURE',now(),NULL,$7,1,now())`,
          [runtime, account, workspace, project, revision, request, `sha256:${"c".repeat(64)}`],
        );
        await db.query(
          `INSERT INTO hosted_cpu_job_attempts VALUES
      ($1,$2,$3,$4,$5,'RENDER','FAILED',now(),NULL,NULL,NULL,$6,$6)`,
          [failed, account, workspace, project, revision, oldBundle],
        );
        await db.query(
          `INSERT INTO media_worker_leases VALUES
      ($1,$2,$3,'FAILED','RENDER_INPUT_INVALID')`,
          [failed, account, workspace],
        );
        await db.query(
          `INSERT INTO provider_workload_leases VALUES
      ($1,$2,$3,$4,'RELEASED','HOSTED_API_OUTPUTS_ACCEPTED')`,
          [id(10), account, workspace, request],
        );
        await db.query(
          `INSERT INTO hosted_render_plans VALUES
      ($1,$2,$3,$4,'videoforge-hosted-cpu-submission/v1','{"kind":"RENDER"}'::jsonb,
       'sha256:'||repeat('0',64))`,
          [account, workspace, project, revision],
        );

        await db.exec(`ALTER TABLE hosted_cpu_job_attempts ADD COLUMN execution_backend text DEFAULT 'PERSONAL_WORKER';
        ALTER TABLE hosted_cpu_job_attempts ADD COLUMN failure_code text;
        CREATE TABLE cloud_media_reservations(id uuid PRIMARY KEY,account_id uuid,state text,cleanup_verified_at timestamptz);
        CREATE TABLE cloud_media_jobs(reservation_id uuid,attempt_id uuid);`);
        const cloudSql = readMigration("0214_optional_runpod_media.sql");
        await db.exec(
          cloudSql.slice(
            cloudSql.indexOf("CREATE TABLE public.cloud_media_render_recoveries"),
            cloudSql.indexOf("CREATE FUNCTION public.videoforge_guard_media_backend_lineage"),
          ),
        );
        await db.exec(readMigration("0224_hosted_cloud_render_retry_status.sql"));
        const signatures = [
          "public.videoforge_prepare_hosted_api_local_render_recovery(uuid,uuid,uuid,uuid,uuid,uuid,text)",
          "public.videoforge_prepare_cloud_media_render_recovery(uuid,uuid,uuid,uuid,uuid,uuid,text)",
          "public.videoforge_read_hosted_api_render_recovery_status(uuid,uuid,uuid,uuid,text)",
        ];
        const definitions = () =>
          Promise.all(
            signatures.map(
              async (signature) =>
                (
                  await db.query("SELECT pg_get_functiondef($1::regprocedure) AS definition", [
                    signature,
                  ])
                ).rows[0].definition,
            ),
          );
        const before = await definitions();
        await db.exec("BEGIN");
        await db.exec(migration);
        await db.exec("ROLLBACK");
        assert.deepEqual(await definitions(), before, "rollback restores all function bytes");
        await db.exec(migration);
        assert.deepEqual(
          await definitions(),
          before.map((definition) =>
            definition.replaceAll(
              "'RENDER_INPUT_INVALID','RENDER_OUTPUT_INVALID'",
              "'RENDER_INPUT_INVALID','RENDER_OUTPUT_INVALID','RENDER_ASSET_MISSING'",
            ),
          ),
          "only the failure allowlist and changed-bundle guard change",
        );
        await assert.rejects(db.exec(migration), /preimage mismatch/);
        await db.exec(`UPDATE media_worker_leases SET failure_code='RENDER_ASSET_MISSING';
        UPDATE hosted_cpu_job_attempts SET failure_code='RENDER_ASSET_MISSING',
          execution_backend='${cloud ? "RUNPOD_POD" : "PERSONAL_WORKER"}';
        INSERT INTO cloud_media_reservations VALUES('${id(30)}','${account}','CLEAN',now());
        INSERT INTO cloud_media_jobs VALUES('${id(30)}','${failed}');`);
        const functionName = cloud
          ? "videoforge_prepare_cloud_media_render_recovery"
          : "videoforge_prepare_hosted_api_render_recovery";
        const call = (
          bundle = newBundle,
          owner = account,
          actor = user,
          target = failed,
          retryId = retry,
        ) =>
          db.query(
            `SELECT ${functionName}($1,$2,$3,$4,$5,$6,$7${cloud ? "" : ",'0.1.51'"}) AS value`,
            [owner, workspace, actor, project, target, retryId, bundle],
          );
        const status = async (bundle = newBundle, owner = account) =>
          (
            await db.query(
              "SELECT videoforge_read_hosted_api_render_recovery_status($1,$2,$3,$4,$5) AS value",
              [owner, workspace, user, project, bundle],
            )
          ).rows[0].value;
        assert.equal((await status(oldBundle)).reason, "WORKER_UPDATE_REQUIRED");
        assert.equal((await status()).eligible, true);
        await assert.rejects(call(oldBundle), /evidence rejected/);
        await assert.rejects(call(newBundle, id(90)), /tenant or identity invalid/);
        await assert.rejects(call(newBundle, account, id(90)), /evidence rejected/);
        await assert.rejects(call(newBundle, account, user, id(90)), /evidence rejected/);
        assert.equal((await status(newBundle, id(90))).eligible, false);
        async function rejectedMutation(sql, expectedReason) {
          await db.exec("BEGIN");
          try {
            await db.exec(sql);
            if (expectedReason) assert.equal((await status()).reason, expectedReason);
            await assert.rejects(call(), /evidence rejected/);
          } finally {
            await db.exec("ROLLBACK");
          }
        }
        await rejectedMutation("UPDATE hosted_cpu_job_attempts SET state='UNKNOWN'", "NOT_FAILED");
        await rejectedMutation(
          "UPDATE media_worker_leases SET failure_code='UNKNOWN_FAILURE'; UPDATE hosted_cpu_job_attempts SET failure_code='UNKNOWN_FAILURE'",
          "FAILURE_NOT_RECOVERABLE",
        );
        await rejectedMutation(
          `UPDATE hosted_cpu_job_attempts SET image_digest='${newBundle}'`,
          "ACCEPTED_INPUTS_NOT_READY",
        );
        await rejectedMutation(
          "UPDATE hosted_render_plans SET payload_sha256='sha256:'||repeat('f',64)",
          "ACCEPTED_INPUTS_NOT_READY",
        );
        await rejectedMutation(
          "UPDATE hosted_cpu_job_attempts SET result_content_length=1",
          "ACCEPTED_INPUTS_NOT_READY",
        );
        await rejectedMutation(
          "ALTER TABLE video_runtime_states DISABLE TRIGGER validate_video_runtime_state; UPDATE video_runtime_states SET final_output_sha256='sha256:'||repeat('f',64); ALTER TABLE video_runtime_states ENABLE TRIGGER validate_video_runtime_state",
          "ACCEPTED_INPUTS_NOT_READY",
        );
        await rejectedMutation(
          `INSERT INTO serverless_attempts VALUES('${request}')`,
          "ACCEPTED_INPUTS_NOT_READY",
        );
        await rejectedMutation(
          "UPDATE provider_workload_leases SET state='ACTIVE'",
          "ACCEPTED_INPUTS_NOT_READY",
        );
        await rejectedMutation(
          `CREATE OR REPLACE FUNCTION videoforge_v209_api_outputs_accepted(uuid,uuid,uuid,uuid)
        RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$`,
          "ACCEPTED_INPUTS_NOT_READY",
        );
        if (cloud) {
          await rejectedMutation(
            "UPDATE cloud_media_reservations SET state='STOPPING',cleanup_verified_at=NULL",
            "CLEANUP_PENDING",
          );
        } else {
          await rejectedMutation(
            `INSERT INTO hosted_cpu_upload_authorities VALUES('${failed}','${account}','${workspace}',now())`,
            "ACCEPTED_INPUTS_NOT_READY",
          );
        }
        await rejectedMutation(
          `INSERT INTO hosted_cpu_job_attempts(id,account_id,workspace_id,project_id,project_revision_id,kind,state,terminal_at,image_digest,execution_bundle_sha256,created_at,execution_backend,failure_code)
        SELECT md5('cap-'||n)::uuid,'${account}','${workspace}','${project}','${revision}','RENDER','FAILED',now(),'${oldBundle}','${oldBundle}',now()-interval '1 day','${cloud ? "RUNPOD_POD" : "PERSONAL_WORKER"}','RENDER_ASSET_MISSING' FROM generate_series(1,4) n`,
          "RETRY_LIMIT_REACHED",
        );
        const preserved = async () =>
          (
            await db.query(`SELECT jsonb_build_object(
        'attempts',(SELECT jsonb_agg(to_jsonb(a)) FROM hosted_cpu_job_attempts a),
        'plans',(SELECT jsonb_agg(to_jsonb(p)) FROM hosted_render_plans p),
        'leases',(SELECT jsonb_agg(to_jsonb(l)) FROM provider_workload_leases l),
        'rentals',(SELECT jsonb_agg(to_jsonb(r)) FROM cloud_media_reservations r)) AS value`)
          ).rows[0].value;
        const pinned = await preserved();
        const result = (await call()).rows[0].value;
        assert.deepEqual(
          [result.recovery_kind, result.retry_attempt_id, result.replayed],
          [cloud ? "CLOUD" : "LOCAL", retry, false],
        );
        assert.deepEqual(
          await preserved(),
          pinned,
          "no regeneration, rental, or accepted-input mutation",
        );
        assert.equal(
          (await db.query("SELECT state FROM generation_requests")).rows[0].state,
          "ACTIVE",
        );
        assert.equal(
          (await db.query("SELECT stage FROM video_runtime_states")).rows[0].stage,
          "RENDERING",
        );
        assert.equal(
          (await call(newBundle, account, user, failed, id(40))).rows[0].value.retry_attempt_id,
          retry,
        );
        assert.equal((await call()).rows[0].value.replayed, true);
        await assert.rejects(call(oldBundle), /identity drift/);
        assert.equal(
          (
            await db.query(
              "SELECT detail->>'provider_actions_created' AS paid FROM video_runtime_events",
            )
          ).rows[0].paid,
          "false",
        );
      } finally {
        await db.close();
      }
    });
});

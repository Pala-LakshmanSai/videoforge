import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const readMigration = (name) =>
  readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8");
const migration = readMigration("0272_render_recovery_cleanup_isolation.sql");
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [account, workspace, user, project, revision, request, runtime, failed, retry] = Array.from(
  { length: 9 },
  (_, i) => id(i + 1),
);
const oldBundle = `sha256:${"a".repeat(64)}`;
const newBundle = `sha256:${"b".repeat(64)}`;

// Actual recovery functions and the existing tenant-scoped 0235 cleanup-only predicate.
test("0272 isolates historical cleanup without weakening current render recovery", async () => {
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

    await db.exec(readMigration("0271_render_asset_missing_recovery.sql"));
    await db.exec(`
      ALTER TABLE cloud_media_reservations ADD COLUMN workspace_id uuid;
      ALTER TABLE cloud_media_reservations ADD COLUMN project_id uuid;
      ALTER TABLE cloud_media_reservations ADD COLUMN project_revision_id uuid;
      ALTER TABLE cloud_media_reservations ADD COLUMN leased_attempt_id uuid;
      ALTER TABLE cloud_media_reservations ADD COLUMN budget_authority_id uuid;
      ALTER TABLE cloud_media_reservations ADD COLUMN deadline_at timestamptz;
      ALTER TABLE cloud_media_reservations ADD COLUMN launch_outcome text;
      ALTER TABLE cloud_media_reservations ADD COLUMN pod_id text;
      CREATE TABLE cloud_media_budget_authorities(id uuid PRIMARY KEY,enabled boolean,expires_at timestamptz);
      CREATE TABLE cloud_media_budget_debits(reservation_id uuid,amount_usd numeric);
      CREATE TABLE hosted_api_generation_jobs(account_id uuid,workspace_id uuid,project_id uuid,project_revision_id uuid);
      UPDATE media_worker_leases SET failure_code='RENDER_ASSET_MISSING';
      UPDATE hosted_cpu_job_attempts SET execution_backend='RUNPOD_POD',failure_code='RENDER_ASSET_MISSING';
      INSERT INTO cloud_media_reservations(id,account_id,state,cleanup_verified_at) VALUES('${id(30)}','${account}','CLEAN',now());
      INSERT INTO cloud_media_jobs VALUES('${id(30)}','${failed}');
      INSERT INTO cloud_media_budget_authorities VALUES('${id(43)}',false,now()-interval '1 day');
      INSERT INTO hosted_cpu_job_attempts(id,account_id,workspace_id,project_id,project_revision_id,kind,state,terminal_at)
        VALUES('${id(44)}','${account}','${workspace}','${id(41)}','${id(42)}','SPAN_AUDIO','FAILED',now()-interval '1 day');
      INSERT INTO cloud_media_reservations(id,account_id,workspace_id,project_id,project_revision_id,leased_attempt_id,budget_authority_id,deadline_at,launch_outcome,state)
        VALUES('${id(40)}','${account}','${workspace}','${id(41)}','${id(42)}','${id(44)}','${id(43)}',now()-interval '1 day','UNKNOWN','STOPPING');
      INSERT INTO cloud_media_budget_debits VALUES('${id(40)}',0.20);`);
    const isolation = readMigration("0235_cloud_cleanup_local_isolation.sql");
    await db.exec(
      isolation.slice(
        isolation.indexOf("CREATE FUNCTION public.videoforge_cloud_cleanup_only"),
        isolation.indexOf("DO $migration$"),
      ),
    );
    const helper = async (r = id(40)) =>
      (await db.query("SELECT videoforge_cloud_cleanup_only($1) AS value", [r])).rows[0].value;
    assert.equal(await helper(), true);
    const call = (bundle = newBundle, owner = account, actor = user) =>
      db.query(
        "SELECT videoforge_prepare_cloud_media_render_recovery($1,$2,$3,$4,$5,$6,$7) AS value",
        [owner, workspace, actor, project, failed, retry, bundle],
      );
    const status = async (bundle = newBundle, owner = account) =>
      (
        await db.query(
          "SELECT videoforge_read_hosted_api_render_recovery_status($1,$2,$3,$4,$5) AS value",
          [owner, workspace, user, project, bundle],
        )
      ).rows[0].value;
    assert.equal((await status()).reason, "CLEANUP_PENDING");
    await assert.rejects(call(), /evidence rejected/);
    const signatures = [
      "public.videoforge_prepare_cloud_media_render_recovery(uuid,uuid,uuid,uuid,uuid,uuid,text)",
      "public.videoforge_read_hosted_api_render_recovery_status(uuid,uuid,uuid,uuid,text)",
    ];
    const definitions = () =>
      Promise.all(
        signatures.map(
          async (s) =>
            (await db.query("SELECT pg_get_functiondef($1::regprocedure) AS value", [s])).rows[0]
              .value,
        ),
      );
    const before = await definitions();
    await db.exec("BEGIN");
    await db.exec(migration);
    await db.exec("ROLLBACK");
    assert.deepEqual(await definitions(), before);
    await db.exec(migration);
    const markers = [
      [
        "WHERE r.account_id=supplied_account_id AND r.state NOT IN ('WAITING_CAPACITY','CLEAN'))",
        "WHERE r.account_id=supplied_account_id AND r.state NOT IN ('WAITING_CAPACITY','CLEAN')\n         AND NOT public.videoforge_cloud_cleanup_only(r.id))",
      ],
      [
        "AND (r.state<>'CLEAN' OR r.cleanup_verified_at IS NULL)) THEN 'CLEANUP_PENDING'",
        "AND (r.state<>'CLEAN' OR r.cleanup_verified_at IS NULL)\n        AND (NOT public.videoforge_cloud_cleanup_only(r.id) OR EXISTS(\n          SELECT 1 FROM cloud_media_jobs job WHERE job.reservation_id=r.id\n            AND job.attempt_id=candidate.failed_id))) THEN 'CLEANUP_PENDING'",
      ],
    ];
    assert.deepEqual(
      await definitions(),
      before.map((d, i) => d.replace(...markers[i])),
      "only account-wide cleanup predicates change",
    );
    await assert.rejects(db.exec(migration), /preimage mismatch/);
    assert.equal((await status()).reason, "ELIGIBLE");
    assert.equal((await status(oldBundle)).reason, "WORKER_UPDATE_REQUIRED");
    await assert.rejects(call(oldBundle), /evidence rejected/);
    await assert.rejects(call(newBundle, id(99)), /tenant or identity invalid/);
    await assert.rejects(call(newBundle, account, id(99)), /evidence rejected/);
    assert.equal((await status(newBundle, id(99))).eligible, false);
    async function rejectMutation(sql, reason = "CLEANUP_PENDING", helperExpected) {
      await db.exec("BEGIN");
      try {
        await db.exec(sql);
        if (helperExpected !== undefined) assert.equal(await helper(), helperExpected);
        assert.equal((await status()).reason, reason);
        await assert.rejects(call(), /evidence rejected/);
      } finally {
        await db.exec("ROLLBACK");
      }
    }
    await rejectMutation(
      `UPDATE cloud_media_reservations SET state='STOPPING',cleanup_verified_at=NULL WHERE id='${id(30)}'`,
    );
    // Even a cleanup-only rental attached to this failed attempt is never exempted.
    await rejectMutation(
      `INSERT INTO cloud_media_jobs VALUES('${id(40)}','${failed}')`,
      "CLEANUP_PENDING",
      true,
    );
    await rejectMutation(
      `UPDATE cloud_media_reservations SET deadline_at=now()+interval '1 day' WHERE id='${id(40)}'`,
      "CLEANUP_PENDING",
      false,
    );
    await rejectMutation(
      "UPDATE cloud_media_budget_authorities SET enabled=true,expires_at=now()+interval '1 day'",
      "CLEANUP_PENDING",
      false,
    );
    await rejectMutation(
      `UPDATE cloud_media_reservations SET state='RUNNING' WHERE id='${id(40)}'`,
      "CLEANUP_PENDING",
      false,
    );
    await rejectMutation(
      `UPDATE cloud_media_reservations SET launch_outcome='CONFIRMED',pod_id='owned-pod' WHERE id='${id(40)}'`,
      "CLEANUP_PENDING",
      false,
    );
    await rejectMutation(
      `UPDATE hosted_cpu_job_attempts SET state='RUNNING',terminal_at=NULL WHERE id='${id(44)}'`,
      "CLEANUP_PENDING",
      false,
    );
    await rejectMutation(
      `INSERT INTO hosted_api_generation_jobs VALUES('${account}','${workspace}','${id(41)}','${id(42)}')`,
      "CLEANUP_PENDING",
      false,
    );
    await rejectMutation(
      `INSERT INTO media_worker_leases(attempt_id,account_id,workspace_id,state) VALUES('${id(44)}','${account}','${workspace}','RUNNING')`,
      "CLEANUP_PENDING",
      false,
    );
    await rejectMutation(
      "UPDATE hosted_render_plans SET payload_sha256='sha256:'||repeat('f',64)",
      "ACCEPTED_INPUTS_NOT_READY",
      true,
    );
    await rejectMutation(
      `UPDATE hosted_cpu_job_attempts SET state='UNKNOWN' WHERE id='${failed}'`,
      "NOT_FAILED",
      true,
    );
    await rejectMutation(
      `CREATE OR REPLACE FUNCTION videoforge_v209_api_outputs_accepted(uuid,uuid,uuid,uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$`,
      "ACCEPTED_INPUTS_NOT_READY",
      true,
    );
    // Other tenants never inherit this helper's exemption or affect this account's recovery.
    await db.exec("BEGIN");
    await db.exec(
      `UPDATE cloud_media_reservations SET account_id='${id(99)}' WHERE id='${id(40)}'`,
    );
    assert.equal(await helper(), false);
    assert.equal((await status()).reason, "ELIGIBLE");
    await db.exec("ROLLBACK");
    const preserved = async () =>
      (
        await db.query(`SELECT jsonb_build_object(
      'reservations',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM cloud_media_reservations r),
      'debits',(SELECT jsonb_agg(to_jsonb(d)) FROM cloud_media_budget_debits d),
      'attempts',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM hosted_cpu_job_attempts a),
      'plans',(SELECT jsonb_agg(to_jsonb(p)) FROM hosted_render_plans p)) AS value`)
      ).rows[0].value;
    const identities = await preserved();
    const result = (await call()).rows[0].value;
    assert.equal(result.recovery_kind, "CLOUD");
    assert.equal(result.replayed, false);
    assert.deepEqual(
      await preserved(),
      identities,
      "unknown rental/debit and accepted inputs are untouched",
    );
    assert.equal((await call()).rows[0].value.replayed, true);
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

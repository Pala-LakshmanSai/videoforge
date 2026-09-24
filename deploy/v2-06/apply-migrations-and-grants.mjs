import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validateServiceFile } from "./validate-pg-service.mjs";

const root = resolve(new URL("../..", import.meta.url).pathname);
const migrationsDirectory = resolve(root, "packages/control-plane/migrations");
const grantsPath = resolve(root, "deploy/v2-06/neon-runtime-grants.sql");
const fail = (message) => {
  throw new Error(`V2-06 Neon activation: ${message}`);
};
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const EXPECTED_TABLE_PRIVILEGES = new Map([
  ["hosted_auth_users", ["DELETE", "INSERT", "SELECT", "UPDATE"]],
  ["hosted_auth_accounts", ["DELETE", "INSERT", "SELECT", "UPDATE"]],
  ["hosted_auth_sessions", ["DELETE", "INSERT", "SELECT", "UPDATE"]],
  ["hosted_auth_verifications", ["DELETE", "INSERT", "SELECT", "UPDATE"]],
  ["hosted_cpu_job_attempts", ["INSERT", "SELECT", "UPDATE"]],
  ["hosted_cpu_upload_authorities", ["INSERT", "SELECT", "UPDATE"]],
  ["hosted_project_create_requests", ["INSERT", "SELECT", "UPDATE"]],
  ["media_worker_enrollments", ["INSERT", "SELECT", "UPDATE"]],
  ["media_worker_devices", ["INSERT", "SELECT", "UPDATE"]],
  ["media_worker_leases", ["INSERT", "SELECT", "UPDATE"]],
  ["projects", ["INSERT", "SELECT", "UPDATE"]],
  ["project_revisions", ["INSERT", "SELECT", "UPDATE"]],
  ["assets", ["INSERT", "SELECT", "UPDATE"]],
  ["artifact_reservations", ["INSERT", "SELECT", "UPDATE"]],
  ["avatar_profiles", ["INSERT", "SELECT", "UPDATE"]],
  ["avatar_profile_versions", ["INSERT", "SELECT", "UPDATE"]],
  ["avatar_profile_assets", ["INSERT", "SELECT"]],
  ["image_styles", ["INSERT", "SELECT", "UPDATE"]],
  ["image_style_versions", ["INSERT", "SELECT", "UPDATE"]],
  ["image_style_references", ["INSERT", "SELECT"]],
  ["workspaces", ["SELECT"]],
  ["hosted_render_plans", ["SELECT"]],
  ["revision_timing_heads", ["SELECT"]],
  ["timeline_plans", ["SELECT"]],
  ["generation_tasks", ["SELECT"]],
  ["generation_requests", ["SELECT"]],
  ["hosted_api_generation_jobs", ["SELECT"]],
  ["hosted_api_image_regeneration_jobs", ["SELECT"]],
  ["video_runtime_states", ["SELECT"]],
  ["video_runtime_lane_states", ["SELECT"]],
  ["serverless_attempts", ["SELECT"]],
  ["serverless_progress_events", ["SELECT"]],
  ["serverless_cost_ledgers", ["SELECT"]],
  ["serverless_output_receipts", ["SELECT"]],
  ["hosted_pair_zero_worker_observations", ["SELECT"]],
  ["hosted_voiceover_contexts", ["SELECT"]],
  ["hosted_prompt_runs", ["SELECT"]],
  ["hosted_prompt_scene_progress", ["SELECT"]],
  ["hosted_prompt_batch_progress", ["SELECT"]],
  ["prompt_executions", ["SELECT"]],
  ["prompt_scene_results", ["SELECT"]],
  ["timeline_segments", ["SELECT"]],
  ["cost_events", ["SELECT"]],
  ["media_worker_input_objects", ["INSERT", "SELECT"]],
  ["hosted_cpu_job_events", ["INSERT", "SELECT"]],
  ["media_worker_events", ["INSERT", "SELECT"]],
  ["artifact_receipts", ["INSERT", "SELECT"]],
  ["hosted_project_reviews", ["INSERT", "SELECT"]],
]);

const EXPECTED_RUNTIME_FUNCTIONS = [
  "videoforge_authorize_hosted_cpu_upload(uuid,text,text,text,text,bigint,text,timestamp with time zone)",
  "videoforge_archive_hosted_project(uuid,uuid,uuid)",
  "videoforge_archive_hosted_preset(uuid,uuid,text,uuid)",
  "videoforge_finish_hosted_style_analysis(uuid,text,text,text,bigint,bigint,bigint)",
  "videoforge_read_hosted_style_analysis_state(uuid,uuid,uuid)",
  "videoforge_reserve_hosted_style_analysis(uuid,text,uuid)",
  "videoforge_current_account_id()",
  "videoforge_due_hosted_cpu_retention(integer)",
  "videoforge_finish_hosted_cpu_retention(uuid,text)",
  "videoforge_hosted_cpu_expected_primary_output(uuid,text)",
  "videoforge_hosted_session_scope(text)",
  "videoforge_media_worker_device_scope(text)",
  "videoforge_media_worker_enrollment_consume(uuid,text)",
  "videoforge_media_worker_enrollment_poll(uuid,text,timestamp with time zone)",
  "videoforge_redeem_hosted_invite(text,text)",
  "videoforge_read_system_avatar_version_assets(uuid)",
  "videoforge_consume_hosted_rate_limit(text,text)",
  "videoforge_append_hosted_render_plan(uuid,uuid,uuid,uuid,text,jsonb,text)",
  "videoforge_append_hosted_canonical_timing(uuid,uuid,uuid,uuid,uuid,uuid,jsonb)",
  "videoforge_prepare_hosted_voiceover_context(jsonb)",
  "videoforge_complete_hosted_voiceover_context(jsonb)",
  "videoforge_fail_hosted_voiceover_context(uuid,text,text,boolean)",
  "videoforge_load_hosted_prompt_plan(uuid,uuid,uuid,uuid)",
  "videoforge_prepare_hosted_prompt_run(jsonb)",
  "videoforge_complete_hosted_prompt_run(jsonb)",
  "videoforge_record_hosted_prompt_scene(uuid,jsonb)",
  "videoforge_record_hosted_prompt_batch(uuid,jsonb)",
  "videoforge_fail_hosted_prompt_run(uuid,text,text,boolean,bigint)",
  "videoforge_reconcile_stale_hosted_prompt_dispatches(uuid)",
  "videoforge_reconcile_unknown_hosted_voiceover_context(jsonb)",
  "videoforge_begin_hosted_pair_send(uuid,uuid,uuid,text,uuid,text)",
  "videoforge_begin_hosted_pair_parallel_send(uuid,uuid,uuid,uuid,text,uuid,text)",
  "videoforge_finish_hosted_pair_parallel_send(uuid,uuid,uuid,text,text,text,uuid,text)",
  "videoforge_cancel_hosted_project_predispatch(uuid,uuid,uuid)",
  "videoforge_commit_hosted_atomic_pair_predispatch(uuid,text,uuid,uuid,uuid,uuid,uuid,uuid,text,uuid,jsonb,numeric,timestamp with time zone,jsonb,jsonb)",
  "videoforge_finish_hosted_pair_send(uuid,uuid,uuid,text,text,text,uuid,text)",
  "videoforge_inspect_hosted_pair_runtime(uuid,uuid,uuid)",
  "videoforge_load_hosted_pair_activation(uuid,uuid,uuid)",
  "videoforge_load_hosted_pair_activation_v2(uuid,uuid,uuid)",
  "videoforge_load_hosted_gpu_activation_v1()",
  "videoforge_load_hosted_gpu_activation_v2()",
  "videoforge_materialize_hosted_v209_ordinary_dispatch(uuid,uuid,uuid,uuid)",
  "videoforge_commit_hosted_v209_ordinary_pair(uuid,uuid,uuid,uuid,jsonb)",
  "videoforge_load_hosted_v209_ordinary_lane_materialization(uuid,uuid,uuid,text)",
  "videoforge_commit_hosted_v209_ordinary_lane_materialization(uuid,uuid,uuid,text,uuid,text,jsonb,text)",
  "videoforge_begin_hosted_v209_ordinary_send(uuid,uuid,uuid,text,uuid,text,text)",
  "videoforge_materialize_hosted_v209_span_audio_jobs(uuid,uuid,uuid,uuid)",
  "videoforge_finalize_hosted_v209_span_audio(uuid,uuid,uuid,jsonb)",
  "videoforge_materialize_hosted_v209_system_avatar_reference(uuid,uuid,uuid,uuid)",
  "videoforge_read_hosted_api_jobs(uuid,uuid,uuid)",
  "videoforge_materialize_hosted_api_jobs(uuid,uuid,uuid,uuid)",
  "videoforge_claim_hosted_api_job(uuid,uuid,uuid,uuid,uuid)",
  "videoforge_bind_hosted_api_image_prompt(uuid,uuid,uuid,uuid,text)",
  "videoforge_record_hosted_api_task(uuid,uuid,uuid,uuid,uuid,text)",
  "videoforge_mark_hosted_api_unknown(uuid,uuid,uuid,uuid,uuid)",
  "videoforge_fail_hosted_api_job(uuid,uuid,uuid,uuid,text)",
  "videoforge_commit_hosted_api_output(uuid,uuid,uuid,uuid,text,bigint,text,jsonb)",
  "videoforge_read_hosted_v209_ready_render_inputs(uuid,uuid,uuid)",
  "videoforge_settle_hosted_api_failure(uuid,uuid,uuid)",
  "videoforge_read_hosted_api_image_regeneration_source(uuid,uuid,uuid,uuid,uuid)",
  "videoforge_create_hosted_api_image_regeneration(uuid,uuid,uuid,uuid,uuid,text,text)",
  "videoforge_get_hosted_api_image_regeneration(uuid,uuid,uuid,uuid,uuid)",
  "videoforge_load_hosted_api_image_regeneration(uuid,uuid)",
  "videoforge_claim_hosted_api_image_regeneration(uuid,uuid)",
  "videoforge_record_hosted_api_image_regeneration_task(uuid,uuid,text)",
  "videoforge_mark_hosted_api_image_regeneration_unknown(uuid,uuid)",
  "videoforge_fail_hosted_api_image_regeneration(uuid,text)",
  "videoforge_commit_hosted_api_image_regeneration(uuid,text,bigint,text,jsonb)",
  "videoforge_read_hosted_api_image_regenerations(uuid,uuid,uuid,uuid)",
  "videoforge_claim_v213_workflow_start(jsonb)",
  "videoforge_complete_v213_workflow_start(jsonb)",
  "videoforge_load_v213_workflow_start(jsonb)",
  "videoforge_claim_v213_operator_acceptance(jsonb)",
  "videoforge_complete_v213_operator_acceptance(jsonb)",
  "videoforge_claim_v213_live_acceptance(jsonb)",
  "videoforge_complete_v213_live_acceptance(jsonb)",
  "videoforge_fail_v213_live_acceptance(jsonb)",
  "videoforge_record_v213_signed_evidence(jsonb)",
  "videoforge_load_v213_signed_evidence(jsonb)",
  "videoforge_v213_short_pilot_repository(jsonb)",
  "videoforge_v213_production_length_repository(jsonb)",
  "videoforge_load_hosted_pair_workflow_schedule(uuid,uuid,uuid)",
  "videoforge_materialize_hosted_lane_batches(uuid,uuid,uuid,uuid,uuid,text,jsonb)",
  "videoforge_prepare_hosted_pair_send(uuid,uuid,uuid)",
  "videoforge_recover_hosted_atomic_pair_tokens(uuid,uuid,uuid)",
].sort();

const required = (name) => {
  const value = process.env[name];
  if (!value) fail(`${name} is required and must remain in the environment, never argv`);
  return value;
};

const mode0600 = async (path, label) => {
  let metadata;
  try {
    metadata = await lstat(path);
  } catch {
    fail(`${label} is not readable`);
  }
  if (metadata.isSymbolicLink() || !metadata.isFile() || (metadata.mode & 0o777) !== 0o600)
    fail(`${label} must be a regular mode-0600 file`);
};

const psql = (args, environment) =>
  new Promise((resolvePromise, reject) => {
    const child = spawn("psql", args, {
      cwd: root,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", () => {});
    child.on("error", (error) => reject(error));
    child.on("close", (status) => resolvePromise({ status, stdout }));
  });

const runPsql = async (args, environment) => {
  let result;
  try {
    result = await psql(args, environment);
  } catch {
    fail("psql could not be started");
  }
  if (result.status !== 0)
    fail("psql failed; no database error or credential was written to evidence");
  return result.stdout.trim();
};

const query = (sql, environment) =>
  runPsql(
    ["--no-psqlrc", "--tuples-only", "--no-align", "--field-separator", "\t", "--command", sql],
    environment,
  );

const migrationManifest = JSON.parse(
  await readFile(resolve(migrationsDirectory, "manifest.json"), "utf8"),
);
if (
  migrationManifest.schema_version !== "videoforge-migration-manifest/v1" ||
  !Array.isArray(migrationManifest.migrations) ||
  migrationManifest.migrations.length === 0
)
  fail("migration manifest schema is not the committed V2 manifest");
const migrations = [];
let previousMigrationVersion = 0;
for (const [index, entry] of migrationManifest.migrations.entries()) {
  // The committed manifest omits superseded historical migrations. Keep retained entries
  // strictly increasing and filename-bound; ledger validation checks omitted rows separately.
  if (
    !Number.isSafeInteger(entry.version) ||
    entry.version <= previousMigrationVersion ||
    !entry.filename.startsWith(`${String(entry.version).padStart(4, "0")}_`)
  )
    fail(`migration manifest position ${index + 1} is not the expected ordered version`);
  previousMigrationVersion = entry.version;
  const sql = await readFile(resolve(migrationsDirectory, entry.filename), "utf8");
  const actual = `sha256:${sha256(sql)}`;
  if (actual !== entry.sha256) fail(`migration ${entry.filename} does not match its manifest hash`);
  migrations.push({ ...entry, sql });
}

const parseLedger = (text) =>
  text
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => {
      const fields = line.split("\t");
      if (fields.length !== 4 || !/^(?:0|[1-9][0-9]*)$/u.test(fields[0]))
        fail("migration ledger row is malformed");
      const [version, name, filename, sha256Value] = fields;
      return { version: Number(version), name, filename, sha256: sha256Value };
    });

const migrationByVersion = new Map(migrations.map((migration) => [migration.version, migration]));
// Read-only production inventory on 2026-09-24 found this exact historical ledger. Migration
// 0148 is in the manifest but absent from that ledger, so it must never be backfilled after 0187.
const liveHistoricalVersions = [
  ...Array.from({ length: 114 }, (_, index) => index + 1),
  ...Array.from({ length: 32 }, (_, index) => index + 116),
  161,
  ...Array.from({ length: 5 }, (_, index) => index + 164),
  ...Array.from({ length: 18 }, (_, index) => index + 170),
];

const validateMigrationLedger = async (ledger, { complete = false } = {}) => {
  const appliedVersions = new Set();
  let previousVersion = 0;
  for (const [index, actual] of ledger.entries()) {
    const { version, name, filename, sha256: recordedHash } = actual;
    if (
      !Number.isSafeInteger(version) ||
      version <= previousVersion ||
      version > migrations.at(-1).version ||
      !/^[a-z0-9_]+$/u.test(name ?? "") ||
      filename !== `${String(version).padStart(4, "0")}_${name}.sql` ||
      !/^sha256:[0-9a-f]{64}$/u.test(recordedHash ?? "")
    )
      fail(`migration ledger position ${index + 1} has an unknown or reordered version`);
    const retained = migrationByVersion.get(version);
    if (retained) {
      if (
        retained.name !== name ||
        retained.filename !== filename ||
        retained.sha256 !== recordedHash
      )
        fail(`migration ledger position ${index + 1} does not match the committed manifest`);
    } else {
      // Historical rows outside the retained manifest require committed SQL byte proof.
      let historicalSql;
      let committedSql;
      try {
        historicalSql = await readFile(resolve(migrationsDirectory, filename), "utf8");
        committedSql = execFileSync(
          "git",
          ["show", `HEAD:packages/control-plane/migrations/${filename}`],
          { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
        );
      } catch {
        fail(`migration ledger position ${index + 1} has no committed SQL file`);
      }
      if (historicalSql !== committedSql)
        fail(`migration ledger position ${index + 1} has uncommitted SQL drift`);
      if (`sha256:${sha256(historicalSql)}` !== recordedHash)
        fail(`migration ledger position ${index + 1} does not match committed SQL`);
    }
    appliedVersions.add(version);
    previousVersion = version;
  }
  const versions = ledger.map(({ version }) => version);
  const manifestPrefix = migrations.slice(0, versions.length).map(({ version }) => version);
  const liveSuccessors = migrations
    .filter(({ version }) => version >= 188)
    .map(({ version }) => version);
  const liveHistory =
    versions.length >= liveHistoricalVersions.length &&
    versions.length <= liveHistoricalVersions.length + liveSuccessors.length
      ? [
          ...liveHistoricalVersions,
          ...liveSuccessors.slice(0, versions.length - liveHistoricalVersions.length),
        ]
      : [];
  if (
    JSON.stringify(versions) !== JSON.stringify(manifestPrefix) &&
    JSON.stringify(versions) !== JSON.stringify(liveHistory)
  )
    fail(
      "migration ledger version sequence is neither a manifest prefix nor the verified live history",
    );
  const pending = migrations.filter(({ version }) =>
    liveHistory.length > 0 ? version > previousVersion : !appliedVersions.has(version),
  );
  if (complete && pending.length > 0)
    fail(`migration ledger is missing ${pending.length} committed manifest rows`);
  return pending;
};

const safeIdentifier = (value, label) => {
  if (!/^[a-z_][a-z0-9_]{0,62}$/u.test(value)) fail(`${label} is not a safe PostgreSQL identifier`);
  return `"${value.replaceAll('"', '""')}"`;
};

const safeLiteral = (value) => `'${value.replaceAll("'", "''")}'`;

const main = async () => {
  const verifyOnly = process.argv.includes("--verify-only");
  const applyGrants = process.argv.includes("--apply-grants");
  const ownerOnly = process.argv.includes("--owner-only");
  if (verifyOnly && !ownerOnly && !applyGrants)
    fail("--verify-only requires --owner-only or --apply-grants");
  if (ownerOnly && applyGrants) fail("--owner-only and --apply-grants are mutually exclusive");

  const serviceFile = required("V2_06_PG_SERVICEFILE");
  const serviceName = required("V2_06_PG_SERVICE");
  const passFile = required("V2_06_PGPASSFILE");
  const approvedHost = required("V2_06_APPROVED_NEON_HOST");
  const expectedDatabase = required("V2_06_EXPECTED_DATABASE");
  const expectedOwnerRole = required("V2_06_EXPECTED_OWNER_ROLE");
  await mode0600(serviceFile, "PGSERVICEFILE");
  await mode0600(passFile, "PGPASSFILE");
  await validateServiceFile(
    serviceFile,
    serviceName,
    approvedHost,
    expectedDatabase,
    expectedOwnerRole,
  );
  const environment = {
    ...process.env,
    PGSERVICEFILE: serviceFile,
    PGSERVICE: serviceName,
    PGPASSFILE: passFile,
  };
  for (const key of ["DATABASE_URL", "PGPASSWORD", "PGHOST", "PGPORT", "PGDATABASE", "PGUSER"])
    delete environment[key];

  const identity = await query("SELECT current_user::text", environment);
  if (identity !== expectedOwnerRole)
    fail("connected PostgreSQL role is not the approved migration owner");
  const pgcrypto = await query(
    "SELECT extversion::text FROM pg_extension WHERE extname = 'pgcrypto'",
    environment,
  );
  if (!pgcrypto)
    fail(
      "pgcrypto extension is required before migration 0042 (gen_random_bytes and pgp_sym_encrypt/decrypt)",
    );

  const ledgerExists = await query(
    "SELECT (to_regclass('public.videoforge_schema_migrations') IS NOT NULL)::text",
    environment,
  );
  if (ledgerExists !== "true" && ledgerExists !== "false")
    fail("migration ledger existence read failed");
  const ledgerText =
    ledgerExists === "true"
      ? await query(
          "SELECT version::text, name, filename, sha256 FROM public.videoforge_schema_migrations ORDER BY public.videoforge_schema_migrations.version",
          environment,
        )
      : "";
  const ledger = parseLedger(ledgerText);
  const pendingMigrations = await validateMigrationLedger(ledger, { complete: verifyOnly });
  let applyRuntimeRole;
  let applyRuntimeRoleIdentifier;
  if (applyGrants && !verifyOnly) {
    applyRuntimeRole = required("V2_06_RUNTIME_ROLE");
    applyRuntimeRoleIdentifier = safeIdentifier(applyRuntimeRole, "V2_06_RUNTIME_ROLE");
    const roleRows = await query(
      `SELECT rolname, rolsuper::text, rolcreaterole::text, rolcreatedb::text, rolinherit::text, rolreplication::text, rolbypassrls::text FROM pg_roles WHERE rolname = ${safeLiteral(applyRuntimeRole)}`,
      environment,
    );
    if (!roleRows)
      fail(
        "runtime role does not exist; create it through the approved Neon owner operation first",
      );
    const roleFlags = roleRows.split("\t").slice(1);
    if (roleFlags.length !== 6 || roleFlags.some((value) => value !== "false"))
      fail(
        "runtime role must already be NOSUPERUSER/NOCREATEDB/NOCREATEROLE/NOINHERIT/NOREPLICATION/NOBYPASSRLS before grants",
      );
  }
  if (!verifyOnly) {
    const requiredPrefix = process.env.V2_06_REQUIRED_LEDGER_PREFIX_VERSION;
    if (
      requiredPrefix !== undefined &&
      (!/^\d+$/u.test(requiredPrefix) || ledger.length !== Number(requiredPrefix))
    )
      fail(`database must have exactly ${requiredPrefix} manifest rows before this activation`);
    if (applyGrants) {
      const preMigrationRuntimeDisableSql = [
        "BEGIN;",
        "SELECT pg_advisory_xact_lock(1448494662, 1);",
        `REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM ${applyRuntimeRoleIdentifier};`,
        "COMMIT;",
      ].join("\n");
      await runPsql(
        ["--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--command", preMigrationRuntimeDisableSql],
        environment,
      );
    }
    if (ledgerExists === "false") {
      await runPsql(
        [
          "--no-psqlrc",
          "--command",
          "CREATE TABLE IF NOT EXISTS public.videoforge_schema_migrations (version integer PRIMARY KEY CHECK (version > 0), name text NOT NULL CHECK (name ~ '^[a-z0-9_]+$'), filename text NOT NULL UNIQUE, sha256 text NOT NULL CHECK (sha256 ~ '^sha256:[0-9a-f]{64}$'), applied_at timestamptz NOT NULL DEFAULT now())",
        ],
        environment,
      );
    }
    for (const migration of pendingMigrations) {
      const temporaryDirectory = await mkdtemp(resolve(tmpdir(), "videoforge-v2-06-migration-"));
      const temporarySql = resolve(temporaryDirectory, migration.filename);
      const migrationSql = [
        "BEGIN;",
        "SELECT pg_advisory_xact_lock(1448494662, 1);",
        `DO $$ BEGIN IF EXISTS (SELECT 1 FROM public.videoforge_schema_migrations WHERE version = ${migration.version}) THEN RAISE EXCEPTION 'migration ledger changed during activation'; END IF; END $$;`,
        migration.sql,
        `INSERT INTO public.videoforge_schema_migrations (version, name, filename, sha256) VALUES (${migration.version}, ${safeLiteral(migration.name)}, ${safeLiteral(migration.filename)}, ${safeLiteral(migration.sha256)});`,
        "COMMIT;",
        "",
      ].join("\n");
      try {
        await writeFile(temporarySql, migrationSql, { encoding: "utf8", mode: 0o600, flag: "wx" });
        await runPsql(
          ["--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--file", temporarySql],
          environment,
        );
      } finally {
        await rm(temporaryDirectory, { recursive: true, force: true });
      }
    }
  }

  if (applyGrants && !verifyOnly) {
    const grantsSql = (await readFile(grantsPath, "utf8"))
      .split(/\r?\n/u)
      .filter((line) => !/^\s*\\(?:if|else|endif|quit)\b/u.test(line))
      .join("\n")
      .replaceAll(':"runtime_role"', applyRuntimeRoleIdentifier);
    const temporaryDirectory = await mkdtemp(resolve(tmpdir(), "videoforge-v2-06-grants-"));
    const temporarySql = resolve(temporaryDirectory, "runtime-grants.sql");
    try {
      await writeFile(temporarySql, grantsSql, { encoding: "utf8", mode: 0o600, flag: "wx" });
      await runPsql(
        ["--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--file", temporarySql],
        environment,
      );
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }

  const finalLedger = parseLedger(
    await query(
      "SELECT version::text, name, filename, sha256 FROM public.videoforge_schema_migrations ORDER BY public.videoforge_schema_migrations.version",
      environment,
    ),
  );
  await validateMigrationLedger(finalLedger, { complete: true });
  if (ownerOnly) {
    console.log(
      `V2-06 migration ledger verified: ${finalLedger.length} ledger rows covering ${migrations.length} manifest entries.`,
    );
    return;
  }

  const runtimeRole = required("V2_06_RUNTIME_ROLE");
  const role = (
    await query(
      `SELECT rolsuper::text, rolcreaterole::text, rolcreatedb::text, rolinherit::text, rolreplication::text, rolbypassrls::text FROM pg_roles WHERE rolname = ${safeLiteral(runtimeRole)}`,
      environment,
    )
  ).split("\t");
  if (role.length !== 6 || role.some((value) => value !== "false"))
    fail(
      "runtime role is not NOSUPERUSER/NOCREATEDB/NOCREATEROLE/NOINHERIT/NOREPLICATION/NOBYPASSRLS",
    );
  const unprotectedTables = await query(
    "SELECT c.relname, c.relrowsecurity::text, c.relforcerowsecurity::text FROM pg_class AS c JOIN pg_namespace AS n ON n.oid = c.relnamespace JOIN pg_attribute AS a ON a.attrelid = c.oid AND a.attname = 'account_id' AND a.attnum > 0 AND NOT a.attisdropped WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> 'accounts' AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)",
    environment,
  );
  if (unprotectedTables) fail(`tenant tables without FORCE RLS remain: ${unprotectedTables}`);
  const actualGrants = (
    await query(
      `SELECT table_name, privilege_type FROM information_schema.role_table_grants WHERE grantee = ${safeLiteral(runtimeRole)} AND table_schema = 'public' ORDER BY table_name, privilege_type`,
      environment,
    )
  )
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => line.replaceAll("\t", ":"));
  const expectedGrants = [...EXPECTED_TABLE_PRIVILEGES.entries()]
    .flatMap(([table, privileges]) => privileges.map((privilege) => `${table}:${privilege}`))
    .sort();
  if (JSON.stringify(actualGrants) !== JSON.stringify(expectedGrants))
    fail("runtime table grants do not exactly match the least-privilege allowlist");
  const hostedPlanPrivileges = await query(
    `SELECT has_table_privilege(${safeLiteral(runtimeRole)}, 'public.hosted_render_plans', 'SELECT')::text, has_table_privilege(${safeLiteral(runtimeRole)}, 'public.hosted_render_plans', 'INSERT')::text, has_table_privilege(${safeLiteral(runtimeRole)}, 'public.hosted_render_plans', 'UPDATE')::text, has_table_privilege(${safeLiteral(runtimeRole)}, 'public.hosted_render_plans', 'DELETE')::text`,
    environment,
  );
  if (hostedPlanPrivileges !== "true\tfalse\tfalse\tfalse")
    fail("hosted render plans are not read-only for the runtime role");
  const hostedPlanAppendCapability = await query(
    `SELECT has_function_privilege(${safeLiteral(runtimeRole)}, 'public.videoforge_append_hosted_render_plan(uuid,uuid,uuid,uuid,text,jsonb,text)', 'EXECUTE')::text`,
    environment,
  );
  if (hostedPlanAppendCapability !== "true")
    fail("runtime role lacks the exact hosted render-plan append function capability");
  const hostedTimingAppendCapability = await query(
    `SELECT has_function_privilege(${safeLiteral(runtimeRole)}, 'public.videoforge_append_hosted_canonical_timing(uuid,uuid,uuid,uuid,uuid,uuid,jsonb)', 'EXECUTE')::text`,
    environment,
  );
  if (hostedTimingAppendCapability !== "true")
    fail("runtime role lacks the exact hosted canonical-timing append function capability");
  const schemaPrivileges = await query(
    `SELECT has_schema_privilege(${safeLiteral(runtimeRole)}, 'public', 'USAGE')::text, has_schema_privilege(${safeLiteral(runtimeRole)}, 'public', 'CREATE')::text`,
    environment,
  );
  if (schemaPrivileges !== "true\tfalse") fail("runtime schema privileges are not USAGE-only");
  const runtimeFunctions = (
    await query(
      `SELECT p.oid::regprocedure::text FROM pg_proc AS p JOIN pg_namespace AS n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND has_function_privilege(${safeLiteral(runtimeRole)}, p.oid, 'EXECUTE') AND NOT EXISTS (SELECT 1 FROM pg_depend AS d JOIN pg_extension AS e ON e.oid = d.refobjid WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e') ORDER BY p.oid::regprocedure::text`,
      environment,
    )
  )
    .split(/\r?\n/u)
    .filter(Boolean);
  if (JSON.stringify(runtimeFunctions) !== JSON.stringify(EXPECTED_RUNTIME_FUNCTIONS))
    fail("runtime function grants do not exactly match the least-privilege allowlist");
  // Neon owns pgcrypto's extension members and retains their standard PUBLIC execute ACL. They
  // are provider-managed primitives, not application capabilities; audit application-owned
  // public functions separately so the runtime allowlist remains exact without claiming ownership
  // of extension ACLs that the migration role cannot revoke.
  const publicFunctions = await query(
    "SELECT p.oid::regprocedure::text FROM pg_proc AS p JOIN pg_namespace AS n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND has_function_privilege('public', p.oid, 'EXECUTE') AND NOT EXISTS (SELECT 1 FROM pg_depend AS d JOIN pg_extension AS e ON e.oid = d.refobjid WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e') ORDER BY p.oid::regprocedure::text",
    environment,
  );
  if (publicFunctions)
    fail(`PUBLIC retains EXECUTE on public-schema functions: ${publicFunctions}`);
  console.log(
    `V2-06 Neon verified: ${finalLedger.length} applied ledger rows, ${migrations.length} retained manifest entries, runtime role ${runtimeRole}, FORCE RLS complete, exact table grants and function grants, hosted_render_plans direct writes denied with exact append-function capability.`,
  );
};

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) await main();

export {
  EXPECTED_RUNTIME_FUNCTIONS,
  EXPECTED_TABLE_PRIVILEGES,
  parseLedger,
  validateMigrationLedger,
};

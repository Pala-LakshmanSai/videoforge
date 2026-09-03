import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
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
  "videoforge_commit_hosted_atomic_pair_predispatch(uuid,text,uuid,uuid,uuid,uuid,uuid,uuid,text,uuid,jsonb,numeric,timestamp with time zone,jsonb,jsonb)",
  "videoforge_finish_hosted_pair_send(uuid,uuid,uuid,text,text,text,uuid,text)",
  "videoforge_inspect_hosted_pair_runtime(uuid,uuid,uuid)",
  "videoforge_load_hosted_pair_activation(uuid,uuid,uuid)",
  "videoforge_load_hosted_pair_activation_v2(uuid,uuid,uuid)",
  "videoforge_load_hosted_gpu_activation_v1()",
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
for (const [index, entry] of migrationManifest.migrations.entries()) {
  if (entry.version !== index + 1) fail("migration manifest must be one contiguous version chain");
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
      const [version, name, filename, sha256Value] = line.split("\t");
      return { version: Number(version), name, filename, sha256: sha256Value };
    });

const assertLedger = (ledger) => {
  if (ledger.length !== migrations.length)
    fail(`migration ledger contains ${ledger.length} rows; expected exactly ${migrations.length}`);
  for (const [index, expected] of migrations.entries()) {
    const actual = ledger[index];
    if (
      !actual ||
      actual.version !== expected.version ||
      actual.name !== expected.name ||
      actual.filename !== expected.filename ||
      actual.sha256 !== expected.sha256
    )
      fail(`migration ledger position ${index + 1} does not match the committed manifest`);
  }
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

  let ledgerText;
  try {
    ledgerText = await query(
      "SELECT version::text, name, filename, sha256 FROM public.videoforge_schema_migrations ORDER BY public.videoforge_schema_migrations.version",
      environment,
    );
  } catch {
    ledgerText = "";
  }
  const ledger = parseLedger(ledgerText);
  if (!verifyOnly) {
    const requiredPrefix = process.env.V2_06_REQUIRED_LEDGER_PREFIX_VERSION;
    if (
      requiredPrefix !== undefined &&
      (!/^\d+$/u.test(requiredPrefix) || ledger.length !== Number(requiredPrefix))
    )
      fail(`database must have exactly ${requiredPrefix} manifest rows before this activation`);
    if (ledger.length > migrations.length)
      fail("database migration ledger is longer than the committed manifest");
    for (const [index, applied] of ledger.entries()) {
      const expected = migrations[index];
      if (
        !expected ||
        applied.version !== expected.version ||
        applied.name !== expected.name ||
        applied.filename !== expected.filename ||
        applied.sha256 !== expected.sha256
      )
        fail(`existing migration ledger position ${index + 1} is not an exact manifest prefix`);
    }
    if (ledger.length === 0 && !ledgerText) {
      await runPsql(
        [
          "--no-psqlrc",
          "--command",
          "CREATE TABLE IF NOT EXISTS public.videoforge_schema_migrations (version integer PRIMARY KEY CHECK (version > 0), name text NOT NULL CHECK (name ~ '^[a-z0-9_]+$'), filename text NOT NULL UNIQUE, sha256 text NOT NULL CHECK (sha256 ~ '^sha256:[0-9a-f]{64}$'), applied_at timestamptz NOT NULL DEFAULT now())",
        ],
        environment,
      );
    }
    for (const migration of migrations.slice(ledger.length)) {
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
    const runtimeRole = required("V2_06_RUNTIME_ROLE");
    const roleIdentifier = safeIdentifier(runtimeRole, "V2_06_RUNTIME_ROLE");
    const roleRows = await query(
      `SELECT rolname, rolsuper::text, rolcreaterole::text, rolcreatedb::text, rolinherit::text, rolreplication::text, rolbypassrls::text FROM pg_roles WHERE rolname = ${safeLiteral(runtimeRole)}`,
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
    const grantsSql = (await readFile(grantsPath, "utf8"))
      .split(/\r?\n/u)
      .filter((line) => !/^\s*\\(?:if|else|endif|quit)\b/u.test(line))
      .join("\n")
      .replaceAll(':"runtime_role"', roleIdentifier);
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
  assertLedger(finalLedger);
  if (ownerOnly) {
    console.log(
      `V2-06 migration ledger verified: ${finalLedger.length}/${migrations.length} exact manifest rows.`,
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
    `V2-06 Neon verified: migration ${finalLedger.length}/${migrations.length}, runtime role ${runtimeRole}, FORCE RLS complete, exact table grants and function grants, hosted_render_plans direct writes denied with exact append-function capability.`,
  );
};

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) await main();

export { EXPECTED_RUNTIME_FUNCTIONS, EXPECTED_TABLE_PRIVILEGES, parseLedger };

import { createHash } from "node:crypto";
import {
  constants,
  openSync,
  closeSync,
  fstatSync,
  readFileSync,
  writeFileSync,
  fsyncSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { spawnSync } from "node:child_process";

const fail = (code) => {
  throw new Error(`V2_09_NATIVE_DATABASE_${code}`);
};
export const databaseBytesHash = (bytes) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const literal = (v) => `'${String(v).replaceAll("'", "''")}'`;
function privateBytes(path) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const s = fstatSync(fd);
    if (
      !s.isFile() ||
      s.uid !== process.getuid() ||
      s.nlink !== 1 ||
      (s.mode & 511) !== 384 ||
      s.size > 1048576
    )
      fail("PRIVATE_INPUT");
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** Exact forward-only transaction. Applied historical migration bytes are never rewritten. */
export function renderNativeMigration87Sql(input) {
  return renderExactNativeMigration(input, 87);
}
export function renderNativeMigration88Sql(input) {
  return renderExactNativeMigration(input, 88);
}
export function renderNativeMigration89Sql(input) {
  return renderExactNativeMigration(input, 89);
}
export function renderNativeMigration90Sql(input) {
  return renderExactNativeMigration(input, 90);
}
export function renderNativeMigration91Sql(input) {
  return renderExactNativeMigration(input, 91);
}
export function renderNativeMigration92Sql(input) {
  return renderExactNativeMigration(input, 92);
}
export function renderNativeMigration93Sql(input) {
  return renderExactNativeMigration(input, 93);
}
export function renderNativeMigration94Sql(input) {
  return renderExactNativeMigration(input, 94);
}
export function renderNativeMigration95Sql(input) {
  return renderExactNativeMigration(input, 95);
}
export function renderNativeMigration96Sql(input) {
  return renderExactNativeMigration(input, 96);
}
export function renderNativeMigration97Sql(input) {
  return renderExactNativeMigration(input, 97);
}
export function renderNativeMigration98Sql(input) {
  return renderExactNativeMigration(input, 98);
}
export function renderNativeMigration99Sql(input) {
  return renderExactNativeMigration(input, 99);
}
export function renderNativeMigration100Sql(input) {
  return renderExactNativeMigration(input, 100);
}
export function renderNativeMigration101Sql(input) {
  return renderExactNativeMigration(input, 101);
}
export function renderNativeMigration102Sql(input) {
  return renderExactNativeMigration(input, 102);
}
export function renderNativeMigration103Sql(input) {
  return renderExactNativeMigration(input, 103);
}
export function renderNativeMigration104Sql(input) {
  return renderExactNativeMigration(input, 104);
}
export function renderNativeMigration105Sql(input) {
  return renderExactNativeMigration(input, 105);
}
function renderExactNativeMigration({ migrationRoot, manifestSha256, migrationSha256 }, target) {
  const bytes = readFileSync(resolve(migrationRoot, "manifest.json"));
  if (databaseBytesHash(bytes) !== manifestSha256) fail("MANIFEST_HASH");
  const manifest = JSON.parse(bytes);
  if (
    manifest.schema_version !== "videoforge-migration-manifest/v1" ||
    manifest.migrations?.length !== target ||
    manifest.migrations.some((e, i) => e.version !== i + 1)
  )
    fail("MANIFEST");
  const entries = manifest.migrations;
  const entry = entries[target - 1];
  if (
    !new RegExp(`^${String(target).padStart(4, "0")}_[a-z0-9_]+\\.sql$`).test(entry.filename) ||
    entry.sha256 !== migrationSha256
  )
    fail("MIGRATION_IDENTITY");
  for (const e of entries) {
    if (
      !/^\d{4}_[a-z0-9_]+\.sql$/.test(e.filename) ||
      databaseBytesHash(readFileSync(resolve(migrationRoot, e.filename))) !== e.sha256
    )
      fail("MIGRATION_HASH");
  }
  const ledger = (n) =>
    JSON.stringify(
      entries
        .slice(0, n)
        .map(({ version, name, filename, sha256 }) => [version, name, filename, sha256]),
    );
  const guard = (n) =>
    `DO $guard$ BEGIN IF COALESCE((SELECT jsonb_agg(jsonb_build_array(version,name,filename,sha256) ORDER BY version) FROM public.videoforge_schema_migrations),'[]'::jsonb) IS DISTINCT FROM ${literal(ledger(n))}::jsonb THEN RAISE EXCEPTION 'V209 native migration ledger drift'; END IF; END $guard$;`;
  return [
    "\\set ON_ERROR_STOP on",
    "BEGIN;",
    "SELECT pg_advisory_xact_lock(1448494662,9);",
    guard(target - 1),
    readFileSync(resolve(migrationRoot, entry.filename), "utf8"),
    `INSERT INTO public.videoforge_schema_migrations(version,name,filename,sha256) VALUES(${target},${literal(entry.name)},${literal(entry.filename)},${literal(entry.sha256)});`,
    guard(target),
    "COMMIT;",
    `SELECT jsonb_build_object('schema_version','videoforge.v2-09-native-migration-result/v1','from_version',${target - 1},'to_version',${target});`,
    "",
  ].join("\n");
}

/** Journal INTENT is exclusive and fsynced before PostgreSQL; uncertainty is never retried. */
export function executeNativeDatabaseOnce({
  credentialPath,
  sql,
  journalPath,
  operation,
  expectedSqlSha256,
}) {
  if (
    ![
      "APPLY_0087",
      "APPLY_0088",
      "APPLY_0089",
      "APPLY_0090",
      "APPLY_0091",
      "APPLY_0092",
      "APPLY_0093",
      "APPLY_0094",
      "APPLY_0095",
      "APPLY_0096",
      "APPLY_0097",
      "APPLY_0098",
      "APPLY_0099",
      "APPLY_0100",
      "APPLY_0101",
      "APPLY_0102",
      "APPLY_0103",
      "APPLY_0104",
      "APPLY_0105",
      "APPLY_V209_RUNTIME_GRANTS",
      "IMPORT_REPLACEMENT_ACTIVATION",
    ].includes(operation) ||
    databaseBytesHash(sql) !== expectedSqlSha256
  )
    fail("OPERATION");
  const url = new URL(privateBytes(credentialPath).toString("utf8").trim());
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !url.hostname ||
    !url.username ||
    !url.password ||
    url.searchParams.get("sslmode") !== "require" ||
    url.searchParams.get("channel_binding") !== "require"
  )
    fail("DATABASE_IDENTITY");
  const env = {
    PATH: "/opt/homebrew/bin:/usr/bin:/bin",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGSSLMODE: "require",
    PGCHANNELBINDING: "require",
    PGCONNECT_TIMEOUT: "15",
  };
  const fd = openSync(
    journalPath,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  const record = (value) => {
    writeFileSync(fd, JSON.stringify(value) + "\n");
    fsyncSync(fd);
  };
  try {
    record({
      operation,
      status: "INTENT",
      sql_sha256: expectedSqlSha256,
      at: new Date().toISOString(),
    });
    const directory = openSync(dirname(journalPath), constants.O_RDONLY);
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
    const result = spawnSync(
      "/opt/homebrew/opt/libpq/bin/psql",
      ["--no-psqlrc", "--quiet", "--tuples-only", "--no-align", "--set", "ON_ERROR_STOP=1"],
      { input: sql, encoding: "utf8", env, timeout: 120000, maxBuffer: 4194304 },
    );
    if (result.error || result.status !== 0) {
      record({
        operation,
        status: "UNKNOWN_NO_RETRY",
        diagnostic_sha256: databaseBytesHash(result.stderr || ""),
        exit_code: result.status,
        at: new Date().toISOString(),
      });
      fail("EXECUTION_UNCERTAIN");
    }
    record({
      operation,
      status: "COMMITTED",
      stdout_sha256: databaseBytesHash(result.stdout),
      at: new Date().toISOString(),
    });
    return result.stdout;
  } finally {
    closeSync(fd);
  }
}

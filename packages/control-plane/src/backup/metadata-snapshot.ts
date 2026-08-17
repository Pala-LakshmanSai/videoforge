import type { SqlExecutor, TransactionalSqlExecutor } from "../database/ports.js";
import {
  MIGRATION_MANIFEST,
  MIGRATION_TABLE_NAME,
  NON_PORTABLE_TABLE_NAMES,
  RELATIONAL_TABLE_NAMES,
  SCHEMA_REGISTRY_TABLE_NAMES,
  type RelationalTableName,
} from "../database/index.js";

export const METADATA_SNAPSHOT_SCHEMA_VERSION = "videoforge.metadata-snapshot/v1" as const;

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const MAX_SERIALIZED_SNAPSHOT_BYTES = 128 * 1_024 * 1_024;
const MAX_SECRET_SCAN_NODES = 1_000_000;

/**
 * Migration 0018 seeds the reserved SYSTEM and LEGACY scope rows into every database, so they are
 * schema baseline rather than tenant metadata. Excluding them keeps a freshly migrated destination
 * restorable and keeps two databases comparable without re-inserting rows that already exist.
 */
const RESERVED_SCOPE_ROW_FILTERS = Object.freeze({
  accounts: `source.id NOT IN (
    'ffffffff-ffff-4fff-8fff-000000000001'::uuid,
    'ffffffff-ffff-4fff-8fff-000000000002'::uuid
  )`,
  workspaces: `source.id NOT IN (
    'ffffffff-ffff-4fff-8fff-000000000011'::uuid,
    'ffffffff-ffff-4fff-8fff-000000000012'::uuid
  )`,
  users: `source.id <> 'ffffffff-ffff-4fff-8fff-000000000021'::uuid`,
  memberships: `source.id <> 'ffffffff-ffff-4fff-8fff-000000000031'::uuid`,
} satisfies Partial<Record<RelationalTableName, string>>);

function reservedScopeFilter(tableName: RelationalTableName): string {
  const predicate = (RESERVED_SCOPE_ROW_FILTERS as Partial<Record<string, string>>)[tableName];
  return predicate === undefined ? "" : ` WHERE ${predicate}`;
}

const DEFERRED_COLUMNS = Object.freeze({
  assets: Object.freeze(["project_id", "project_revision_id", "source_attempt_id"]),
  attempts: Object.freeze(["parent_attempt_id"]),
  avatar_profiles: Object.freeze(["active_version_id", "thumbnail_asset_id"]),
  generation_tasks: Object.freeze(["accepted_attempt_id"]),
  image_styles: Object.freeze(["active_version_id", "cover_asset_id"]),
} satisfies Partial<Record<RelationalTableName, readonly string[]>>);

const RESTORE_INSERT_ORDER = Object.freeze([
  "users",
  "accounts",
  "account_queue_heads",
  "invite_codes",
  "auth_identity_bindings",
  "invite_redemptions",
  "app_admissions",
  "workspaces",
  "memberships",
  "media_worker_enrollments",
  "media_worker_devices",
  "assets",
  "execution_profiles",
  "avatar_profiles",
  "avatar_profile_versions",
  "avatar_profile_assets",
  "avatar_compatibility_assessments",
  "image_styles",
  "image_style_versions",
  "image_style_references",
  "image_style_previews",
  "projects",
  "project_inputs",
  "project_revisions",
  "generation_requests",
  "preset_preview_requests",
  "provider_workload_leases",
  "global_generation_capacity",
  "generation_queue_audits",
  "serverless_endpoint_deployments",
  "serverless_attempts",
  "serverless_predispatch_authorities",
  "serverless_dispatch_outbox",
  "serverless_provider_assignments",
  "serverless_progress_events",
  "serverless_provenance_receipts",
  "serverless_output_receipts",
  "serverless_cancellations",
  "serverless_reconciliations",
  "serverless_cost_ledgers",
  "serverless_cost_events",
  "artifact_reservations",
  "artifact_receipts",
  "transcripts",
  "transcript_words",
  "transcript_sentences",
  "transcript_phrases",
  "timeline_plans",
  "timeline_segments",
  "selected_span_audio",
  "timing_invalidations",
  "revision_timing_heads",
  "generation_tasks",
  "attempts",
  "qa_results",
  "render_jobs",
  "cost_events",
  "workflow_instances",
  "workflow_events",
  "outbox",
  "prompt_executions",
  "prompt_writer_attempts",
  "prompt_scene_results",
  "callback_receipts",
  "image_style_analysis_attempts",
  "image_style_profile_artifacts",
  "image_style_profile_edits",
  "image_generation_acceptances",
  "avatar_generation_acceptances",
  "avatar_renderer_bindings",
  "avatar_profile_test_attempts",
  "repository_mutation_receipts",
  "model_volumes",
  "model_volume_manifests",
  "gpu_inventory_receipts",
  "generation_sessions",
  "session_gpu_bindings",
  "session_gpu_revalidations",
  "global_queue_entries",
  "compute_run_plans",
  "pod_lifecycle_attempts",
  "pod_dispatch_authorizations",
  "lane_demands",
  "durable_generation_outputs",
  "global_session_cost_events",
  "global_session_events",
  "global_queue_audits",
  "video_runtime_states",
  "video_runtime_lane_states",
  "video_runtime_accepted_units",
  "video_runtime_events",
  "hosted_cpu_job_attempts",
  "media_worker_input_objects",
  "media_worker_leases",
  "hosted_cpu_upload_authorities",
  "hosted_cpu_job_events",
  "media_worker_events",
] satisfies readonly RelationalTableName[]);

const RESTORE_INSERT_TABLES = new Set<RelationalTableName>(RESTORE_INSERT_ORDER);
if (
  RESTORE_INSERT_TABLES.size !== RELATIONAL_TABLE_NAMES.length ||
  RELATIONAL_TABLE_NAMES.some((tableName) => !RESTORE_INSERT_TABLES.has(tableName))
) {
  throw new Error("The metadata restore plan must include every relational table exactly once.");
}

type SnapshotErrorCode =
  | "METADATA_DESTINATION_NOT_CLEAN"
  | "METADATA_RESTORE_FAILED"
  | "METADATA_RESTORE_VERIFICATION_FAILED"
  | "METADATA_SECRET_BYTES_FORBIDDEN"
  | "METADATA_SNAPSHOT_CHECKSUM_MISMATCH"
  | "METADATA_SNAPSHOT_INVALID"
  | "METADATA_SNAPSHOT_MIGRATION_INCOMPATIBLE"
  | "METADATA_SNAPSHOT_TABLE_ORDER_INVALID"
  | "METADATA_SNAPSHOT_VERSION_UNSUPPORTED"
  | "METADATA_SOURCE_SCHEMA_INCOMPATIBLE";

export class MetadataSnapshotError extends Error {
  readonly code: SnapshotErrorCode;
  readonly recovery: string;

  constructor(code: SnapshotErrorCode, message: string, recovery: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "MetadataSnapshotError";
    this.code = code;
    this.recovery = recovery;
  }
}

export interface MetadataMigrationLedgerEntry {
  readonly version: number;
  readonly name: string;
  readonly filename: string;
  readonly sha256: `sha256:${string}`;
}

export interface MetadataTableSnapshot {
  readonly ordinal: number;
  readonly tableName: RelationalTableName;
  readonly rowCount: number;
  /** Exact PostgreSQL jsonb text, ordered by the complete canonical row document. */
  readonly rows: readonly string[];
  readonly rowsSha256: `sha256:${string}`;
}

export interface MetadataSnapshot {
  readonly schemaVersion: typeof METADATA_SNAPSHOT_SCHEMA_VERSION;
  readonly migrationLedger: readonly MetadataMigrationLedgerEntry[];
  readonly tables: readonly MetadataTableSnapshot[];
  readonly snapshotSha256: `sha256:${string}`;
}

export interface MetadataRestoreResult {
  readonly snapshotSha256: `sha256:${string}`;
  readonly restoredRows: number;
  readonly alreadyRestored: boolean;
}

interface MigrationRow extends Record<string, unknown> {
  readonly version: number;
  readonly name: string;
  readonly filename: string;
  readonly sha256: string;
}

interface RowJson extends Record<string, unknown> {
  readonly row_json: string;
}

interface CountRow extends Record<string, unknown> {
  readonly count: string;
}

interface TableNameRow extends Record<string, unknown> {
  readonly table_name: string;
}

interface ColumnRow extends Record<string, unknown> {
  readonly table_name: string;
  readonly column_name: string;
  readonly data_type: string;
}

type CanonicalJson =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalJson[]
  | { readonly [key: string]: CanonicalJson };

function snapshotProblem(
  code: SnapshotErrorCode,
  message: string,
  recovery: string,
  cause?: unknown,
): MetadataSnapshotError {
  return new MetadataSnapshotError(code, message, recovery, cause);
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function qualifiedTable(tableName: RelationalTableName): string {
  return `public.${quoteIdentifier(tableName)}`;
}

function canonicalJson(value: CanonicalJson): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON numbers must be finite.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonicalJson(
          (value as { readonly [key: string]: CanonicalJson })[key] ?? null,
        )}`,
    )
    .join(",")}}`;
}

async function sha256(value: string): Promise<`sha256:${string}`> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

function unsignedSnapshot(snapshot: MetadataSnapshot): CanonicalJson {
  return {
    migrationLedger: snapshot.migrationLedger as unknown as CanonicalJson,
    schemaVersion: snapshot.schemaVersion,
    tables: snapshot.tables as unknown as CanonicalJson,
  };
}

function normalizeKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .replace(/[^A-Za-z0-9]+/gu, "_")
    .toLowerCase();
}

function isSecretBearingKey(key: string): boolean {
  const normalized = normalizeKey(key);
  if (normalized.endsWith("_hash") || normalized.endsWith("_sha256")) return false;
  return /(^|_)(?:api_key|authorization|callback_token|cancel_token|cookie|credential|password|private_key|refresh_token|secret|session_token|signed_url|token|uri|url)(?:_|$)/u.test(
    normalized,
  );
}

function isPortableReferenceKey(tableName: RelationalTableName, key: string): boolean {
  return tableName === "media_worker_input_objects" && normalizeKey(key) === "uri";
}

function rejectSecretBearingJson(tableName: RelationalTableName, rowJson: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rowJson) as unknown;
  } catch (error) {
    throw snapshotProblem(
      "METADATA_SOURCE_SCHEMA_INCOMPATIBLE",
      `Table ${tableName} did not produce valid JSON metadata.`,
      "Repair the source metadata row and retry the export.",
      error,
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw snapshotProblem(
      "METADATA_SOURCE_SCHEMA_INCOMPATIBLE",
      `Table ${tableName} produced a non-object metadata row.`,
      "Repair the source metadata row and retry the export.",
    );
  }
  const pending: Array<{ readonly path: string; readonly value: unknown }> = [
    { path: tableName, value: parsed },
  ];
  let visited = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    visited += 1;
    if (visited > MAX_SECRET_SCAN_NODES) {
      throw snapshotProblem(
        "METADATA_SOURCE_SCHEMA_INCOMPATIBLE",
        `Table ${tableName} exceeds the bounded metadata inspection limit.`,
        "Move oversized documents out of Postgres metadata before retrying the export.",
      );
    }
    if (Array.isArray(current.value)) {
      current.value.forEach((value, index) =>
        pending.push({ path: `${current.path}[${String(index)}]`, value }),
      );
      continue;
    }
    if (typeof current.value !== "object" || current.value === null) continue;
    for (const [key, value] of Object.entries(current.value)) {
      const path = `${current.path}.${key}`;
      if (isSecretBearingKey(key) && !isPortableReferenceKey(tableName, key)) {
        throw snapshotProblem(
          "METADATA_SECRET_BYTES_FORBIDDEN",
          `Secret-bearing metadata field ${path} cannot enter a portable snapshot.`,
          "Replace raw credentials and signed URLs with durable hashes or references, reconcile any in-flight dispatch, and retry.",
        );
      }
      pending.push({ path, value });
    }
  }
}

async function configureStableSession(executor: SqlExecutor): Promise<void> {
  await executor.execute("SET LOCAL search_path = public, pg_catalog");
  await executor.execute("SET LOCAL TIME ZONE 'UTC'");
  await executor.execute("SET LOCAL DateStyle = 'ISO, YMD'");
}

async function assertExpectedSchema(executor: SqlExecutor): Promise<void> {
  const tables = await executor.query<TableNameRow>(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
      ORDER BY table_name`,
  );
  const expected = [
    ...RELATIONAL_TABLE_NAMES,
    ...SCHEMA_REGISTRY_TABLE_NAMES,
    ...NON_PORTABLE_TABLE_NAMES,
    MIGRATION_TABLE_NAME,
  ].sort();
  const actual = tables.rows.map((row) => row.table_name);
  if (actual.length !== expected.length || actual.some((name, index) => name !== expected[index])) {
    throw snapshotProblem(
      "METADATA_SOURCE_SCHEMA_INCOMPATIBLE",
      "The database table inventory does not match the committed metadata snapshot contract.",
      "Apply the exact committed migration chain and matching application version before exporting.",
    );
  }
  const columns = await executor.query<ColumnRow>(
    `SELECT table_name, column_name, data_type
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN (${RELATIONAL_TABLE_NAMES.map((tableName) => `'${tableName}'`).join(", ")})
      ORDER BY table_name, ordinal_position`,
  );
  const forbidden = columns.rows.find(
    (column) =>
      column.data_type === "bytea" ||
      (isSecretBearingKey(column.column_name) &&
        !isPortableReferenceKey(column.table_name as RelationalTableName, column.column_name)),
  );
  if (forbidden !== undefined) {
    throw snapshotProblem(
      "METADATA_SECRET_BYTES_FORBIDDEN",
      `Column ${forbidden.table_name}.${forbidden.column_name} is not safe for a metadata-only snapshot.`,
      "Keep private bytes and raw credentials outside the portable metadata schema.",
    );
  }
}

async function readMigrationLedger(
  executor: SqlExecutor,
): Promise<readonly MetadataMigrationLedgerEntry[]> {
  const result = await executor.query<MigrationRow>(
    `SELECT version, name, filename, sha256
       FROM public.${quoteIdentifier(MIGRATION_TABLE_NAME)}
      ORDER BY version`,
  );
  const expected = MIGRATION_MANIFEST;
  if (
    result.rows.length !== expected.length ||
    result.rows.some((row, index) => {
      const migration = expected[index];
      return (
        migration === undefined ||
        row.version !== migration.version ||
        row.name !== migration.name ||
        row.filename !== migration.filename ||
        row.sha256 !== migration.sha256
      );
    })
  ) {
    throw snapshotProblem(
      "METADATA_SNAPSHOT_MIGRATION_INCOMPATIBLE",
      "The applied migration ledger does not exactly match the committed chain.",
      "Use the application version matching the source migration ledger; never skip or reorder migrations.",
    );
  }
  return Object.freeze(
    result.rows.map((row) =>
      Object.freeze({
        version: row.version,
        name: row.name,
        filename: row.filename,
        sha256: row.sha256 as `sha256:${string}`,
      }),
    ),
  );
}

async function exportFromExecutor(executor: SqlExecutor): Promise<MetadataSnapshot> {
  await configureStableSession(executor);
  await assertExpectedSchema(executor);
  const migrationLedger = await readMigrationLedger(executor);
  const tables: MetadataTableSnapshot[] = [];
  for (const [ordinal, tableName] of RELATIONAL_TABLE_NAMES.entries()) {
    const result = await executor.query<RowJson>(
      `SELECT to_jsonb(source)::text AS row_json
         FROM ${qualifiedTable(tableName)} AS source${reservedScopeFilter(tableName)}
        ORDER BY to_jsonb(source)::text`,
    );
    const rows = result.rows.map((row) => row.row_json);
    rows.forEach((row) => rejectSecretBearingJson(tableName, row));
    tables.push(
      Object.freeze({
        ordinal,
        tableName,
        rowCount: rows.length,
        rows: Object.freeze(rows),
        rowsSha256: await sha256(canonicalJson(rows)),
      }),
    );
  }
  const provisional = {
    schemaVersion: METADATA_SNAPSHOT_SCHEMA_VERSION,
    migrationLedger,
    tables: Object.freeze(tables),
    snapshotSha256: `sha256:${"0".repeat(64)}` as `sha256:${string}`,
  } satisfies MetadataSnapshot;
  return Object.freeze({
    ...provisional,
    snapshotSha256: await sha256(canonicalJson(unsignedSnapshot(provisional))),
  });
}

export async function exportMetadataSnapshot(
  database: TransactionalSqlExecutor,
): Promise<MetadataSnapshot> {
  return database.transaction(async (transaction) => {
    await transaction.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
    return exportFromExecutor(transaction);
  });
}

export function serializeMetadataSnapshot(snapshot: MetadataSnapshot): string {
  return canonicalJson(snapshot as unknown as CanonicalJson);
}

function invalidSnapshot(message: string, cause?: unknown): MetadataSnapshotError {
  return snapshotProblem(
    "METADATA_SNAPSHOT_INVALID",
    message,
    "Use one complete snapshot emitted by the matching VideoForge exporter and retry.",
    cause,
  );
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidSnapshot(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (
    actual.length !== sortedExpected.length ||
    actual.some((key, index) => key !== sortedExpected[index])
  ) {
    throw invalidSnapshot(`${label} has an unexpected shape.`);
  }
}

async function validateParsedSnapshot(value: unknown): Promise<MetadataSnapshot> {
  const root = record(value, "Metadata snapshot");
  exactKeys(
    root,
    ["schemaVersion", "migrationLedger", "tables", "snapshotSha256"],
    "Metadata snapshot",
  );
  if (root.schemaVersion !== METADATA_SNAPSHOT_SCHEMA_VERSION) {
    throw snapshotProblem(
      "METADATA_SNAPSHOT_VERSION_UNSUPPORTED",
      "The metadata snapshot version is not supported by this application build.",
      "Restore with the exact application version that emitted the snapshot, then migrate forward.",
    );
  }
  if (!Array.isArray(root.migrationLedger) || !Array.isArray(root.tables)) {
    throw invalidSnapshot("Metadata snapshot ledger and tables must be arrays.");
  }
  const migrationLedger: MetadataMigrationLedgerEntry[] = root.migrationLedger.map(
    (candidate, index) => {
      const entry = record(candidate, `Migration ledger entry ${String(index)}`);
      exactKeys(entry, ["version", "name", "filename", "sha256"], "Migration ledger entry");
      const expected = MIGRATION_MANIFEST[index];
      if (
        expected === undefined ||
        entry.version !== expected.version ||
        entry.name !== expected.name ||
        entry.filename !== expected.filename ||
        entry.sha256 !== expected.sha256
      ) {
        throw snapshotProblem(
          "METADATA_SNAPSHOT_MIGRATION_INCOMPATIBLE",
          "The snapshot migration ledger does not match the committed chain.",
          "Use the exact application version that emitted the snapshot; never edit or reorder its ledger.",
        );
      }
      return Object.freeze({ ...expected });
    },
  );
  if (migrationLedger.length !== MIGRATION_MANIFEST.length) {
    throw snapshotProblem(
      "METADATA_SNAPSHOT_MIGRATION_INCOMPATIBLE",
      "The snapshot migration ledger is incomplete.",
      "Use one complete snapshot from the exact matching application version.",
    );
  }
  if (root.tables.length !== RELATIONAL_TABLE_NAMES.length) {
    throw snapshotProblem(
      "METADATA_SNAPSHOT_TABLE_ORDER_INVALID",
      "The snapshot table sequence is incomplete.",
      "Use the complete deterministic table sequence emitted by the exporter.",
    );
  }
  const tables: MetadataTableSnapshot[] = [];
  for (const [ordinal, candidate] of root.tables.entries()) {
    const table = record(candidate, `Table snapshot ${String(ordinal)}`);
    exactKeys(table, ["ordinal", "tableName", "rowCount", "rows", "rowsSha256"], "Table snapshot");
    const expectedName = RELATIONAL_TABLE_NAMES[ordinal];
    if (expectedName === undefined) {
      throw snapshotProblem(
        "METADATA_SNAPSHOT_TABLE_ORDER_INVALID",
        "The snapshot contains an unexpected table position.",
        "Use the complete deterministic table sequence emitted by the exporter.",
      );
    }
    if (table.ordinal !== ordinal || table.tableName !== expectedName) {
      throw snapshotProblem(
        "METADATA_SNAPSHOT_TABLE_ORDER_INVALID",
        "The snapshot table order does not match the committed restore plan.",
        "Use the snapshot exactly as emitted; do not reorder tables or rows.",
      );
    }
    if (
      !Number.isSafeInteger(table.rowCount) ||
      Number(table.rowCount) < 0 ||
      !Array.isArray(table.rows) ||
      table.rows.length !== table.rowCount ||
      table.rows.some((row) => typeof row !== "string") ||
      typeof table.rowsSha256 !== "string" ||
      !SHA256_PATTERN.test(table.rowsSha256)
    ) {
      throw invalidSnapshot(`Table ${expectedName} has invalid row metadata.`);
    }
    const rows = table.rows as string[];
    for (const rowJson of rows) {
      rejectSecretBearingJson(expectedName, rowJson);
    }
    const actualRowsSha256 = await sha256(canonicalJson(rows));
    if (actualRowsSha256 !== table.rowsSha256) {
      throw snapshotProblem(
        "METADATA_SNAPSHOT_CHECKSUM_MISMATCH",
        `Table ${expectedName} does not match its recorded SHA-256.`,
        "Discard the altered or truncated copy and use the original complete snapshot.",
      );
    }
    tables.push(
      Object.freeze({
        ordinal,
        tableName: expectedName,
        rowCount: rows.length,
        rows: Object.freeze([...rows]),
        rowsSha256: table.rowsSha256 as `sha256:${string}`,
      }),
    );
  }
  if (typeof root.snapshotSha256 !== "string" || !SHA256_PATTERN.test(root.snapshotSha256)) {
    throw invalidSnapshot("Metadata snapshot SHA-256 is invalid.");
  }
  const snapshot = Object.freeze({
    schemaVersion: METADATA_SNAPSHOT_SCHEMA_VERSION,
    migrationLedger: Object.freeze(migrationLedger),
    tables: Object.freeze(tables),
    snapshotSha256: root.snapshotSha256 as `sha256:${string}`,
  });
  const actualSnapshotSha256 = await sha256(canonicalJson(unsignedSnapshot(snapshot)));
  if (actualSnapshotSha256 !== snapshot.snapshotSha256) {
    throw snapshotProblem(
      "METADATA_SNAPSHOT_CHECKSUM_MISMATCH",
      "The metadata snapshot does not match its recorded SHA-256.",
      "Discard the altered or truncated copy and use the original complete snapshot.",
    );
  }
  return snapshot;
}

export async function parseMetadataSnapshot(serialized: string): Promise<MetadataSnapshot> {
  if (
    typeof serialized !== "string" ||
    serialized.length === 0 ||
    new TextEncoder().encode(serialized).byteLength > MAX_SERIALIZED_SNAPSHOT_BYTES
  ) {
    throw invalidSnapshot("The serialized metadata snapshot is empty or exceeds the size limit.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized) as unknown;
  } catch (error) {
    throw invalidSnapshot(
      "The serialized metadata snapshot is truncated or is not valid JSON.",
      error,
    );
  }
  return validateParsedSnapshot(parsed);
}

function tableSnapshot(
  snapshot: MetadataSnapshot,
  tableName: RelationalTableName,
): MetadataTableSnapshot {
  const ordinal = RELATIONAL_TABLE_NAMES.indexOf(tableName);
  const table = snapshot.tables[ordinal];
  if (table === undefined || table.tableName !== tableName) {
    throw invalidSnapshot(`Table ${tableName} is missing from the validated snapshot.`);
  }
  return table;
}

function rowsDocument(table: MetadataTableSnapshot): string {
  return `[${table.rows.join(",")}]`;
}

async function insertTable(
  executor: SqlExecutor,
  snapshot: MetadataSnapshot,
  tableName: RelationalTableName,
): Promise<number> {
  const table = tableSnapshot(snapshot, tableName);
  if (table.rowCount === 0) return 0;
  if (tableName === "global_generation_capacity") {
    const result = await executor.query(
      `UPDATE ${qualifiedTable(tableName)} AS target
          SET active_lease_count = source.active_lease_count,
              schedule_sequence = source.schedule_sequence,
              video_fair_cursor = source.video_fair_cursor,
              preview_fair_cursor = source.preview_fair_cursor,
              version = source.version,
              updated_at = source.updated_at
         FROM jsonb_populate_recordset(NULL::${qualifiedTable(tableName)}, $1::jsonb) AS source
        WHERE target.singleton = source.singleton`,
      [rowsDocument(table)],
    );
    if (result.affectedRows !== table.rowCount) {
      throw snapshotProblem(
        "METADATA_RESTORE_VERIFICATION_FAILED",
        `Table ${tableName} restored ${String(result.affectedRows)} of ${String(table.rowCount)} rows.`,
        "Discard the destination and retry into a fresh migrated database.",
      );
    }
    return result.affectedRows;
  }
  const deferred = DEFERRED_COLUMNS[tableName as keyof typeof DEFERRED_COLUMNS] as
    | readonly string[]
    | undefined;
  const source =
    deferred === undefined
      ? "$1::jsonb"
      : `(SELECT jsonb_agg(value${deferred.map((column) => ` - '${column}'`).join("")})
            FROM jsonb_array_elements($1::jsonb))`;
  const orderedSource =
    tableName === "cost_events"
      ? " ORDER BY owner_type, owner_id, sequence"
      : tableName === "workflow_events"
        ? " ORDER BY aggregate_type, aggregate_id, sequence"
        : tableName === "serverless_cost_events"
          ? " ORDER BY attempt_id, sequence"
          : "";
  const result = await executor.query(
    `INSERT INTO ${qualifiedTable(tableName)}
     SELECT * FROM jsonb_populate_recordset(NULL::${qualifiedTable(tableName)}, ${source})${orderedSource}`,
    [rowsDocument(table)],
  );
  if (result.affectedRows !== table.rowCount) {
    throw snapshotProblem(
      "METADATA_RESTORE_VERIFICATION_FAILED",
      `Table ${tableName} restored ${String(result.affectedRows)} of ${String(table.rowCount)} rows.`,
      "Discard the destination and retry into a fresh migrated database.",
    );
  }
  return result.affectedRows;
}

async function restoreDeferredColumns(
  executor: SqlExecutor,
  snapshot: MetadataSnapshot,
): Promise<void> {
  for (const [tableName, columns] of Object.entries(DEFERRED_COLUMNS) as Array<
    [RelationalTableName, readonly string[]]
  >) {
    const table = tableSnapshot(snapshot, tableName);
    if (table.rowCount === 0) continue;
    const assignments = columns
      .map((column) => `${quoteIdentifier(column)} = source.${quoteIdentifier(column)}`)
      .join(", ");
    const result = await executor.query(
      `UPDATE ${qualifiedTable(tableName)} AS target
          SET ${assignments}
         FROM jsonb_populate_recordset(NULL::${qualifiedTable(tableName)}, $1::jsonb) AS source
        WHERE target.id = source.id`,
      [rowsDocument(table)],
    );
    if (result.affectedRows !== table.rowCount) {
      throw snapshotProblem(
        "METADATA_RESTORE_VERIFICATION_FAILED",
        `Deferred relationships for ${tableName} were not restored completely.`,
        "Discard the destination and retry into a fresh migrated database.",
      );
    }
  }
}

async function countDataRows(executor: SqlExecutor): Promise<number> {
  let total = 0;
  for (const tableName of RELATIONAL_TABLE_NAMES) {
    // Migration 0021 seeds this singleton. Its cursors remain portable data, but the baseline row
    // does not make an otherwise fresh migrated restore destination dirty.
    if (tableName === "global_generation_capacity") continue;
    const result = await executor.query<CountRow>(
      `SELECT count(*)::text AS count
         FROM ${qualifiedTable(tableName)} AS source${reservedScopeFilter(tableName)}`,
    );
    const count = Number(result.rows[0]?.count ?? "NaN");
    if (!Number.isSafeInteger(count) || count < 0) {
      throw snapshotProblem(
        "METADATA_SOURCE_SCHEMA_INCOMPATIBLE",
        `Table ${tableName} returned an invalid row count.`,
        "Repair the destination schema before retrying restore.",
      );
    }
    total += count;
  }
  return total;
}

export async function restoreMetadataSnapshot(
  database: TransactionalSqlExecutor,
  serialized: string,
): Promise<MetadataRestoreResult> {
  const snapshot = await parseMetadataSnapshot(serialized);
  try {
    return await database.transaction(async (transaction) => {
      await configureStableSession(transaction);
      await transaction.execute("SET CONSTRAINTS ALL DEFERRED");
      await assertExpectedSchema(transaction);
      await readMigrationLedger(transaction);
      const existingRows = await countDataRows(transaction);
      if (existingRows > 0) {
        const existing = await exportFromExecutor(transaction);
        if (existing.snapshotSha256 === snapshot.snapshotSha256) {
          return Object.freeze({
            snapshotSha256: snapshot.snapshotSha256,
            restoredRows: 0,
            alreadyRestored: true,
          });
        }
        throw snapshotProblem(
          "METADATA_DESTINATION_NOT_CLEAN",
          "The destination contains metadata that does not match this snapshot.",
          "Use a fresh migrated database, or resume only with the exact snapshot already restored there.",
        );
      }

      let restoredRows = 0;
      for (const tableName of RESTORE_INSERT_ORDER) {
        restoredRows += await insertTable(transaction, snapshot, tableName);
      }
      await restoreDeferredColumns(transaction, snapshot);
      const restored = await exportFromExecutor(transaction);
      if (restored.snapshotSha256 !== snapshot.snapshotSha256) {
        throw snapshotProblem(
          "METADATA_RESTORE_VERIFICATION_FAILED",
          "The restored database does not reproduce the source snapshot checksum.",
          "The transaction was rolled back; retry into a fresh migrated database after inspecting the restore adapter.",
        );
      }
      return Object.freeze({
        snapshotSha256: snapshot.snapshotSha256,
        restoredRows,
        alreadyRestored: false,
      });
    });
  } catch (error) {
    if (error instanceof MetadataSnapshotError) throw error;
    throw snapshotProblem(
      "METADATA_RESTORE_FAILED",
      "Metadata restore failed and the destination transaction was rolled back.",
      "Retry the same snapshot against the clean destination; if it repeats, inspect the local database error without deleting source data.",
      error,
    );
  }
}

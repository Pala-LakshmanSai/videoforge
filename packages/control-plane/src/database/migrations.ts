import migrationManifestDocument from "../../migrations/manifest.json" with { type: "json" };

import type { SqlExecutor, TransactionalSqlExecutor } from "./ports.js";

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;

export interface MigrationManifestEntry {
  readonly version: number;
  readonly name: string;
  readonly filename: string;
  readonly sha256: `sha256:${string}`;
}

export interface MigrationSource extends MigrationManifestEntry {
  readonly sql: string;
}

export interface MigrationApplicationResult {
  readonly appliedVersions: readonly number[];
  readonly alreadyAppliedVersions: readonly number[];
}

interface AppliedMigrationRow extends Record<string, unknown> {
  readonly version: number;
  readonly name: string;
  readonly filename: string;
  readonly sha256: string;
}

const MIGRATION_LOCK_NAMESPACE = 1_448_494_662;
const MIGRATION_LOCK_KEY = 1;

function parseManifest(value: unknown): readonly MigrationManifestEntry[] {
  if (typeof value !== "object" || value === null || !("migrations" in value)) {
    throw new Error("The migration manifest must contain a migrations array.");
  }

  const migrations = (value as { readonly migrations?: unknown }).migrations;
  if (!Array.isArray(migrations)) {
    throw new Error("The migration manifest migrations field must be an array.");
  }

  let priorVersion = 0;
  const filenames = new Set<string>();
  return Object.freeze(
    migrations.map((candidate) => {
      if (typeof candidate !== "object" || candidate === null) {
        throw new Error("Every migration manifest entry must be an object.");
      }
      const entry = candidate as Record<string, unknown>;
      if (!Number.isSafeInteger(entry.version) || Number(entry.version) <= priorVersion) {
        throw new Error("Migration versions must be positive, unique, and strictly increasing.");
      }
      if (typeof entry.name !== "string" || !/^[a-z0-9_]+$/.test(entry.name)) {
        throw new Error(`Migration ${String(entry.version)} has an invalid name.`);
      }
      if (typeof entry.filename !== "string" || !/^\d{4}_[a-z0-9_]+\.sql$/.test(entry.filename)) {
        throw new Error(`Migration ${String(entry.version)} has an invalid filename.`);
      }
      const expectedFilename = `${String(entry.version).padStart(4, "0")}_${entry.name}.sql`;
      if (entry.filename !== expectedFilename) {
        throw new Error(`Migration ${String(entry.version)} filename must be ${expectedFilename}.`);
      }
      if (filenames.has(entry.filename)) {
        throw new Error(`Migration filename ${entry.filename} is duplicated.`);
      }
      if (typeof entry.sha256 !== "string" || !SHA256_PATTERN.test(entry.sha256)) {
        throw new Error(`Migration ${String(entry.version)} has an invalid SHA-256.`);
      }

      priorVersion = Number(entry.version);
      filenames.add(entry.filename);
      return Object.freeze({
        version: Number(entry.version),
        name: entry.name,
        filename: entry.filename,
        sha256: entry.sha256 as `sha256:${string}`,
      });
    }),
  );
}

export const MIGRATION_MANIFEST = parseManifest(migrationManifestDocument);

const CREATE_MIGRATION_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS public.videoforge_schema_migrations (
  version integer PRIMARY KEY CHECK (version > 0),
  name text NOT NULL CHECK (name ~ '^[a-z0-9_]+$'),
  filename text NOT NULL UNIQUE,
  sha256 text NOT NULL CHECK (sha256 ~ '^sha256:[0-9a-f]{64}$'),
  applied_at timestamptz NOT NULL DEFAULT now()
)
`;

export async function computeMigrationSha256(sql: string): Promise<`sha256:${string}`> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(sql));
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

async function validateSources(sources: readonly MigrationSource[]): Promise<void> {
  if (sources.length !== MIGRATION_MANIFEST.length) {
    throw new Error("Migration sources must exactly match the committed manifest.");
  }
  for (const [index, expected] of MIGRATION_MANIFEST.entries()) {
    const source = sources[index];
    if (
      source === undefined ||
      source.version !== expected.version ||
      source.name !== expected.name ||
      source.filename !== expected.filename ||
      source.sha256 !== expected.sha256 ||
      source.sql.trim().length === 0
    ) {
      throw new Error(`Migration source ${expected.filename} does not match the manifest.`);
    }
    const actualSha256 = await computeMigrationSha256(source.sql);
    if (actualSha256 !== expected.sha256) {
      throw new Error(`Migration SQL ${expected.filename} does not match its committed SHA-256.`);
    }
  }
}

export async function applyMigrations(
  database: TransactionalSqlExecutor,
  sources: readonly MigrationSource[],
): Promise<MigrationApplicationResult> {
  await validateSources(sources);

  return database.transaction(async (transaction: SqlExecutor) => {
    await transaction.execute("SET LOCAL search_path = public, pg_catalog");
    await transaction.query("SELECT pg_advisory_xact_lock($1, $2)", [
      MIGRATION_LOCK_NAMESPACE,
      MIGRATION_LOCK_KEY,
    ]);
    await transaction.execute(CREATE_MIGRATION_TABLE_SQL);

    const existing = await transaction.query<AppliedMigrationRow>(
      `SELECT version, name, filename, sha256
         FROM public.videoforge_schema_migrations
        ORDER BY version`,
    );
    if (existing.rows.length > sources.length) {
      throw new Error("Database migration chain is longer than the committed manifest.");
    }
    for (const [index, applied] of existing.rows.entries()) {
      const expected = sources[index];
      if (
        expected === undefined ||
        applied.version !== expected.version ||
        applied.name !== expected.name ||
        applied.filename !== expected.filename ||
        applied.sha256 !== expected.sha256
      ) {
        throw new Error(
          `Applied migration at chain position ${String(index + 1)} does not match committed metadata.`,
        );
      }
    }

    const alreadyAppliedVersions = existing.rows.map((migration) => migration.version);
    const appliedVersions: number[] = [];
    for (const migration of sources.slice(existing.rows.length)) {
      await transaction.execute(migration.sql);
      await transaction.query(
        `INSERT INTO public.videoforge_schema_migrations (version, name, filename, sha256)
         VALUES ($1, $2, $3, $4)`,
        [migration.version, migration.name, migration.filename, migration.sha256],
      );
      appliedVersions.push(migration.version);
    }

    return Object.freeze({
      appliedVersions: Object.freeze(appliedVersions),
      alreadyAppliedVersions: Object.freeze(alreadyAppliedVersions),
    });
  });
}

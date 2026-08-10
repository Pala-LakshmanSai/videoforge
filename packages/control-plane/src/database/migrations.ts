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
  readonly sha256: string;
}

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
CREATE TABLE IF NOT EXISTS videoforge_schema_migrations (
  version integer PRIMARY KEY CHECK (version > 0),
  name text NOT NULL CHECK (name ~ '^[a-z0-9_]+$'),
  filename text NOT NULL UNIQUE,
  sha256 text NOT NULL CHECK (sha256 ~ '^sha256:[0-9a-f]{64}$'),
  applied_at timestamptz NOT NULL DEFAULT now()
)
`;

function validateSources(sources: readonly MigrationSource[]): void {
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
  }
}

export async function applyMigrations(
  database: TransactionalSqlExecutor,
  sources: readonly MigrationSource[],
): Promise<MigrationApplicationResult> {
  validateSources(sources);
  await database.execute(CREATE_MIGRATION_TABLE_SQL);

  const existing = await database.query<AppliedMigrationRow>(
    "SELECT version, name, sha256 FROM videoforge_schema_migrations ORDER BY version",
  );
  const expectedVersions = new Set(sources.map((migration) => migration.version));
  for (const applied of existing.rows) {
    if (!expectedVersions.has(applied.version)) {
      throw new Error(`Database contains unknown migration version ${String(applied.version)}.`);
    }
    const expected = sources.find((migration) => migration.version === applied.version);
    if (expected === undefined || expected.name !== applied.name || expected.sha256 !== applied.sha256) {
      throw new Error(`Applied migration ${String(applied.version)} does not match committed metadata.`);
    }
  }

  const alreadyApplied = new Set(existing.rows.map((migration) => migration.version));
  const appliedVersions: number[] = [];
  for (const migration of sources) {
    if (alreadyApplied.has(migration.version)) {
      continue;
    }
    await database.transaction(async (transaction: SqlExecutor) => {
      await transaction.execute(migration.sql);
      await transaction.query(
        `INSERT INTO videoforge_schema_migrations (version, name, filename, sha256)
         VALUES ($1, $2, $3, $4)`,
        [migration.version, migration.name, migration.filename, migration.sha256],
      );
    });
    appliedVersions.push(migration.version);
  }

  return Object.freeze({
    appliedVersions: Object.freeze(appliedVersions),
    alreadyAppliedVersions: Object.freeze([...alreadyApplied].sort((left, right) => left - right)),
  });
}

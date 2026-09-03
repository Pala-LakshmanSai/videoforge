import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

import { applyMigrations, MIGRATION_MANIFEST } from "../../dist/src/index.js";

export class PGliteExecutor {
  constructor(database) {
    this.database = database;
  }

  async execute(sql) {
    await this.database.exec(sql);
  }

  async query(sql, parameters = []) {
    const result = await this.database.query(sql, [...parameters]);
    return {
      rows: result.rows,
      affectedRows: result.affectedRows ?? 0,
    };
  }

  async transaction(work) {
    return this.database.transaction((transaction) => work(new PGliteExecutor(transaction)));
  }
}

export async function loadMigrationSources() {
  return Promise.all(
    MIGRATION_MANIFEST.map(async (entry) => {
      const sql = await readFile(
        new URL(`../../migrations/${entry.filename}`, import.meta.url),
        "utf8",
      );
      const sha256 = `sha256:${createHash("sha256").update(sql).digest("hex")}`;
      assert.equal(sha256, entry.sha256, `${entry.filename} checksum drifted`);
      return { ...entry, sql };
    }),
  );
}

export async function createMigratedDatabase(dataDir) {
  const database = new PGlite(dataDir);
  const executor = new PGliteExecutor(database);
  const sources = await loadMigrationSources();
  await applyMigrations(executor, sources);
  return { database, executor, sources };
}

/**
 * Opens the V2-05 compatibility window for one test session.
 *
 * Migration 0028 fences every superseded global-session and Pod contract against ordinary writes.
 * Only compatibility evidence may replay them, and only by setting this session flag explicitly,
 * which production code never does.
 */
export async function enableLegacyCompatibilityFixture(executor) {
  await executor.query(`SELECT set_config('videoforge.legacy_compatibility_fixture', 'on', false)`);
}

export async function withMigratedDatabase(work) {
  const postgresUrl = process.env.VIDEOFORGE_TEST_POSTGRES_URL;
  if (postgresUrl !== undefined && postgresUrl.length > 0) {
    const { withPostgresDatabase } = await import("./postgres.mjs");
    return withPostgresDatabase(postgresUrl, work);
  }
  const context = await createMigratedDatabase();
  try {
    return await work(context);
  } finally {
    await context.database.close();
  }
}

export async function withPgcryptoMigratedDatabase(work) {
  const database = new PGlite({ extensions: { pgcrypto } });
  try {
    await database.exec("CREATE EXTENSION IF NOT EXISTS pgcrypto");
    const executor = new PGliteExecutor(database);
    const sources = await loadMigrationSources();
    await applyMigrations(executor, sources);
    return await work({ database, executor, sources });
  } finally {
    await database.close();
  }
}

/** Run historical migration tests against their exact terminal ledger. */
export async function withPgcryptoMigrationsThrough(version, work) {
  assert.ok(Number.isSafeInteger(version) && version > 0);
  const database = new PGlite({ extensions: { pgcrypto } });
  try {
    await database.exec("CREATE EXTENSION IF NOT EXISTS pgcrypto");
    const executor = new PGliteExecutor(database);
    const allSources = await loadMigrationSources();
    const sources = allSources.filter((entry) => entry.version <= version);
    assert.equal(sources.at(-1)?.version, version, `migration ${version} is unavailable`);
    await executor.execute(
      `CREATE TABLE public.videoforge_schema_migrations(
        version integer PRIMARY KEY CHECK(version>0),name text NOT NULL,
        filename text NOT NULL UNIQUE,sha256 text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now())`,
    );
    await executor.transaction(async (transaction) => {
      for (const migration of sources) {
        await transaction.execute(migration.sql);
        await transaction.query(
          `INSERT INTO public.videoforge_schema_migrations(version,name,filename,sha256)
           VALUES($1,$2,$3,$4)`,
          [migration.version, migration.name, migration.filename, migration.sha256],
        );
      }
    });
    return await work({ database, executor, sources });
  } finally {
    await database.close();
  }
}

export async function expectDatabaseError(action, expectedCodes) {
  await assert.rejects(action, (error) => {
    assert.ok(error instanceof Error);
    if (expectedCodes !== undefined) {
      const allowedCodes = Array.isArray(expectedCodes) ? expectedCodes : [expectedCodes];
      assert.ok(
        allowedCodes.includes(error.code),
        `expected PostgreSQL code ${allowedCodes.join(" or ")}, received ${String(error.code)}: ${error.message}`,
      );
    }
    return true;
  });
}

export function uuid(serial) {
  assert.ok(Number.isSafeInteger(serial) && serial > 0 && serial <= 999_999_999_999);
  return `00000000-0000-4000-8000-${String(serial).padStart(12, "0")}`;
}

export function sha256(label) {
  return `sha256:${createHash("sha256").update(label).digest("hex")}`;
}

export const FIXED_TIME = "2026-08-10T04:00:00.000Z";

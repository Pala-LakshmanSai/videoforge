import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

import { applyMigrations, MIGRATION_MANIFEST } from "../../dist/src/index.js";

/**
 * The deployment roles the migration chain grants to.
 *
 * Migrations 0147/0161/0162/0163 and 0192 grant EXECUTE to production roles by name,
 * and no migration creates them: private activation tooling does that out of band.
 * Every fixture database emulates that deployment,
 * so each executor creates the role before its first statement, or each of those GRANTs raises 42704
 * (`role ... does not exist`).
 */
const DEPLOYMENT_ROLES = Object.freeze([
  "videoforge_v209_runtime_dc9612d6",
  "videoforge_v209_reconciler_dc9612d6",
]);

export class PGliteExecutor {
  constructor(database) {
    this.database = database;
    // Seeded once per executor, before the first statement it runs, and only for a top-level
    // executor: a transaction-scoped executor must leave the transaction's first statement to the
    // caller (a fixture that opens with SET TRANSACTION ISOLATION LEVEL cannot have a role check run
    // ahead of it). The DO-block is idempotent and never touches the public schema the inventory
    // assertions inspect.
    this.ready = typeof database.transaction === "function" ? this.#seedDeploymentRoles() : null;
  }

  async #seedDeploymentRoles() {
    for (const role of DEPLOYMENT_ROLES) {
      await this.database.exec(
        `DO $$ BEGIN
           IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
             EXECUTE 'CREATE ROLE ${role} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS';
           END IF;
         END $$;`,
      );
    }
  }

  async execute(sql) {
    if (this.ready) await this.ready;
    await this.database.exec(sql);
  }

  async query(sql, parameters = []) {
    if (this.ready) await this.ready;
    const result = await this.database.query(sql, [...parameters]);
    return {
      rows: result.rows,
      affectedRows: result.affectedRows ?? 0,
    };
  }

  async transaction(work) {
    if (this.ready) await this.ready;
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

/**
 * Applies a version-bounded slice of the committed manifest the way applyMigrations does.
 *
 * applyMigrations refuses a partial source list - the sources must match the committed manifest
 * exactly - which is right for a deployment and useless for the historical-chain tests that stop
 * mid-chain and hand-apply the migration under test afterwards.
 */
export async function applyMigrationSliceThrough(executor, version, allSources) {
  assert.ok(Number.isSafeInteger(version) && version > 0);
  const sources = (allSources ?? (await loadMigrationSources())).filter(
    (entry) => entry.version <= version,
  );
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
  return sources;
}

/** Run historical migration tests against their exact terminal ledger. */
export async function withPgcryptoMigrationsThrough(version, work) {
  assert.ok(Number.isSafeInteger(version) && version > 0);
  const database = new PGlite({ extensions: { pgcrypto } });
  try {
    await database.exec("CREATE EXTENSION IF NOT EXISTS pgcrypto");
    const executor = new PGliteExecutor(database);
    const sources = await applyMigrationSliceThrough(executor, version);
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

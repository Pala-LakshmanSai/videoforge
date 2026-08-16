import assert from "node:assert/strict";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

import {
  applyMigrations,
  MIGRATION_TABLE_NAME,
  NON_PORTABLE_TABLE_NAMES,
  RELATIONAL_TABLE_NAMES,
  SCHEMA_REGISTRY_TABLE_NAMES,
  TENANT_VIEW_NAMES,
} from "../dist/src/index.js";
import { loadMigrationSources, PGliteExecutor, sha256 } from "./support/pglite.mjs";

async function withDatabase(work) {
  const database = new PGlite();
  try {
    return await work(new PGliteExecutor(database));
  } finally {
    await database.close();
  }
}

function trackingExecutor(executor, migrationSql, executedVersions) {
  return {
    async execute(sql) {
      const version = migrationSql.get(sql);
      if (version !== undefined) {
        executedVersions.push(version);
      }
      return executor.execute(sql);
    },
    query(sql, parameters = []) {
      return executor.query(sql, parameters);
    },
    transaction(work) {
      return executor.transaction((transaction) =>
        work(trackingExecutor(transaction, migrationSql, executedVersions)),
      );
    },
  };
}

test("the executor rejects changed SQL bytes before touching the database", async () => {
  const sources = await loadMigrationSources();
  const tampered = sources.map((source, index) =>
    index === 0
      ? {
          ...source,
          sql: `${source.sql}\nCREATE TABLE public.executor_checksum_bypass (id integer);`,
        }
      : source,
  );
  const databaseCalls = [];
  const untouchedDatabase = {
    async execute() {
      databaseCalls.push("execute");
      throw new Error("database must not be touched for invalid migration bytes");
    },
    async query() {
      databaseCalls.push("query");
      throw new Error("database must not be touched for invalid migration bytes");
    },
    async transaction() {
      databaseCalls.push("transaction");
      throw new Error("database must not be touched for invalid migration bytes");
    },
  };

  await assert.rejects(() => applyMigrations(untouchedDatabase, tampered));
  assert.deepEqual(databaseCalls, []);
});

test("every stored migration metadata field is authenticated", async (context) => {
  const sources = await loadMigrationSources();
  const driftCases = [
    {
      name: "filename",
      sql: "UPDATE public.videoforge_schema_migrations SET filename = $1 WHERE version = $2",
      value: "9999_wrong_but_well_formed.sql",
    },
    {
      name: "name",
      sql: "UPDATE public.videoforge_schema_migrations SET name = $1 WHERE version = $2",
      value: "wrong_but_well_formed_name",
    },
    {
      name: "digest",
      sql: "UPDATE public.videoforge_schema_migrations SET sha256 = $1 WHERE version = $2",
      value: sha256("wrong-but-well-formed-ledger-digest"),
    },
  ];

  for (const drift of driftCases) {
    await context.test(drift.name, async () => {
      await withDatabase(async (executor) => {
        await applyMigrations(executor, sources);
        await executor.query(drift.sql, [drift.value, sources[0].version]);
        await assert.rejects(() => applyMigrations(executor, sources));
      });
    });
  }
});

test("the stored migration ledger must be an exact manifest prefix", async () => {
  const sources = await loadMigrationSources();
  assert.ok(sources.length >= 2, "VF-1-01A requires an additive corrective migration");

  await withDatabase(async (executor) => {
    await applyMigrations(executor, sources);
    await executor.query("DELETE FROM public.videoforge_schema_migrations WHERE version = $1", [
      sources[0].version,
    ]);

    const migrationSql = new Map(sources.map((source) => [source.sql, source.version]));
    const executedVersions = [];
    const tracked = trackingExecutor(executor, migrationSql, executedVersions);
    await assert.rejects(() => applyMigrations(tracked, sources));
    assert.deepEqual(
      executedVersions,
      [],
      "chain drift must fail before any migration SQL executes",
    );
  });
});

test("an exact applied prefix resumes with only the remaining migrations", async () => {
  const sources = await loadMigrationSources();
  assert.ok(sources.length >= 2, "VF-1-01A requires an additive corrective migration");

  await withDatabase(async (executor) => {
    const first = sources[0];
    await executor.transaction(async (transaction) => {
      await transaction.execute("SET LOCAL search_path = public, pg_catalog");
      await transaction.execute(`
        CREATE TABLE public.videoforge_schema_migrations (
          version integer PRIMARY KEY CHECK (version > 0),
          name text NOT NULL CHECK (name ~ '^[a-z0-9_]+$'),
          filename text NOT NULL UNIQUE,
          sha256 text NOT NULL CHECK (sha256 ~ '^sha256:[0-9a-f]{64}$'),
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      await transaction.execute(first.sql);
      await transaction.query(
        `INSERT INTO public.videoforge_schema_migrations (version, name, filename, sha256)
         VALUES ($1, $2, $3, $4)`,
        [first.version, first.name, first.filename, first.sha256],
      );
    });

    const result = await applyMigrations(executor, sources);
    assert.deepEqual(result.alreadyAppliedVersions, [first.version]);
    assert.deepEqual(
      result.appliedVersions,
      sources.slice(1).map((source) => source.version),
    );
  });
});

test("concurrent migration runners serialize into one application and one no-op", async () => {
  const sources = await loadMigrationSources();

  await withDatabase(async (executor) => {
    const results = await Promise.all([
      applyMigrations(executor, sources),
      applyMigrations(executor, sources),
    ]);
    results.sort((left, right) => right.appliedVersions.length - left.appliedVersions.length);

    assert.deepEqual(
      results[0].appliedVersions,
      sources.map((source) => source.version),
    );
    assert.deepEqual(results[0].alreadyAppliedVersions, []);
    assert.deepEqual(results[1].appliedVersions, []);
    assert.deepEqual(
      results[1].alreadyAppliedVersions,
      sources.map((source) => source.version),
    );

    const ledger = await executor.query(
      `SELECT version, count(*)::int AS rows
         FROM public.videoforge_schema_migrations
        GROUP BY version
        ORDER BY version`,
    );
    assert.deepEqual(
      ledger.rows,
      sources.map((source) => ({ version: source.version, rows: 1 })),
    );
  });
});

test("a hostile search_path cannot relocate migration objects outside public", async () => {
  const sources = await loadMigrationSources();

  await withDatabase(async (executor) => {
    await executor.execute("CREATE SCHEMA hostile; SET search_path TO hostile, public");
    await applyMigrations(executor, sources);

    const publicTables = await executor.query(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = 'public'
        ORDER BY table_name`,
    );
    assert.deepEqual(
      publicTables.rows.map((row) => row.table_name),
      [
        ...RELATIONAL_TABLE_NAMES,
        ...SCHEMA_REGISTRY_TABLE_NAMES,
        ...NON_PORTABLE_TABLE_NAMES,
        ...TENANT_VIEW_NAMES,
        MIGRATION_TABLE_NAME,
      ].sort(),
    );

    const hostileObjects = await executor.query(
      `SELECT
         (SELECT count(*)::int
            FROM pg_class relation
            JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
           WHERE namespace.nspname = 'hostile'
             AND relation.relkind IN ('r', 'p', 'i', 'S', 'v', 'm')) AS relations,
         (SELECT count(*)::int
            FROM pg_proc function
            JOIN pg_namespace namespace ON namespace.oid = function.pronamespace
           WHERE namespace.nspname = 'hostile') AS functions`,
    );
    assert.deepEqual(hostileObjects.rows[0], { relations: 0, functions: 0 });
  });
});

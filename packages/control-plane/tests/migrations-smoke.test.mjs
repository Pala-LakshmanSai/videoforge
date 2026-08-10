import assert from "node:assert/strict";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

import {
  applyMigrations,
  MIGRATION_TABLE_NAME,
  RELATIONAL_TABLE_NAMES,
} from "../dist/src/index.js";
import { loadMigrationSources, PGliteExecutor } from "./support/pglite.mjs";

test("a fresh PGlite database applies the committed migration chain idempotently", async () => {
  const database = new PGlite();
  try {
    const executor = new PGliteExecutor(database);
    const sources = await loadMigrationSources();
    const versions = sources.map((source) => source.version);

    const first = await applyMigrations(executor, sources);
    assert.deepEqual(first.appliedVersions, versions);
    assert.deepEqual(first.alreadyAppliedVersions, []);

    const second = await applyMigrations(executor, sources);
    assert.deepEqual(second.appliedVersions, []);
    assert.deepEqual(second.alreadyAppliedVersions, versions);

    const inventory = await executor.query(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = 'public'
        ORDER BY table_name`,
    );
    assert.deepEqual(
      inventory.rows.map((row) => row.table_name),
      [...RELATIONAL_TABLE_NAMES, MIGRATION_TABLE_NAME].sort(),
    );
  } finally {
    await database.close();
  }
});

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

import {
  applyMigrations,
  MIGRATION_MANIFEST,
  MIGRATION_TABLE_NAME,
  RELATIONAL_TABLE_NAMES,
} from "../dist/src/index.js";

class PGliteExecutor {
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

async function loadMigrationSources() {
  return Promise.all(
    MIGRATION_MANIFEST.map(async (entry) => {
      const sql = await readFile(new URL(`../migrations/${entry.filename}`, import.meta.url), "utf8");
      const sha256 = `sha256:${createHash("sha256").update(sql).digest("hex")}`;
      assert.equal(sha256, entry.sha256, `${entry.filename} checksum drifted`);
      return { ...entry, sql };
    }),
  );
}

test("a fresh PGlite database applies the committed migration chain idempotently", async () => {
  const database = new PGlite();
  try {
    const executor = new PGliteExecutor(database);
    const sources = await loadMigrationSources();

    const first = await applyMigrations(executor, sources);
    assert.deepEqual(first.appliedVersions, [1]);
    assert.deepEqual(first.alreadyAppliedVersions, []);

    const second = await applyMigrations(executor, sources);
    assert.deepEqual(second.appliedVersions, []);
    assert.deepEqual(second.alreadyAppliedVersions, [1]);

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

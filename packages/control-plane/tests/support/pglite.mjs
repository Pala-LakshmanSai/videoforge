import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";

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

export async function withMigratedDatabase(work) {
  const context = await createMigratedDatabase();
  try {
    return await work(context);
  } finally {
    await context.database.close();
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

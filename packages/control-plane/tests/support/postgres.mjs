import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import pg from "pg";

import { applyMigrations } from "../../dist/src/index.js";
import { loadMigrationSources } from "./pglite.mjs";

const { Pool } = pg;

class PostgresExecutor {
  constructor(client, migrationPrerequisites = new Map()) {
    this.client = client;
    this.migrationPrerequisites = migrationPrerequisites;
  }

  async execute(sql) {
    const prerequisite = this.migrationPrerequisites.get(sql);
    if (prerequisite !== undefined) await this.client.query(prerequisite);
    await this.client.query(sql);
  }

  async query(sql, parameters = []) {
    const result = await this.client.query(sql, [...parameters]);
    return { rows: result.rows, affectedRows: result.rowCount ?? 0 };
  }

  async transaction(work) {
    const client = await this.client.connect();
    try {
      await client.query("BEGIN");
      const result = await work(new PostgresExecutor(client, this.migrationPrerequisites));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

function databaseUrl(baseUrl, databaseName) {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

export async function withPostgresDatabase(baseUrl, work) {
  const databaseName = `videoforge_v2_03_${process.pid}_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: databaseUrl(baseUrl, "postgres"), max: 2 });
  let pool;
  try {
    await admin.query(`CREATE DATABASE ${databaseName}`);
    pool = new Pool({ connectionString: databaseUrl(baseUrl, databaseName), max: 20 });
    await pool.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
    const sources = await loadMigrationSources();
    const continuationGrants = sources.find((source) => source.version === 195);
    if (continuationGrants === undefined)
      throw new Error("fixture continuation grant migration is missing");
    const prerequisites = await Promise.all(
      [
        "0160_hosted_continuation_heartbeats.sql",
        "0162_hosted_continuation_tenant_scoped_sweeps.sql",
        "0163_hosted_continuation_heartbeat_sequence.sql",
      ].map((filename) =>
        readFile(new URL(`../../migrations/${filename}`, import.meta.url), "utf8"),
      ),
    );
    const executor = new PostgresExecutor(
      pool,
      new Map([[continuationGrants.sql, prerequisites.join("\n")]]),
    );
    await applyMigrations(executor, sources);
    return await work({ database: pool, executor, sources });
  } finally {
    if (pool !== undefined) await pool.end();
    await admin.query(`DROP DATABASE IF EXISTS ${databaseName}`);
    await admin.end();
  }
}

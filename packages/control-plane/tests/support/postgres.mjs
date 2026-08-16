import { randomUUID } from "node:crypto";

import pg from "pg";

import { applyMigrations } from "../../dist/src/index.js";
import { loadMigrationSources } from "./pglite.mjs";

const { Pool } = pg;

class PostgresExecutor {
  constructor(client) {
    this.client = client;
  }

  async execute(sql) {
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
      const result = await work(new PostgresExecutor(client));
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
    const executor = new PostgresExecutor(pool);
    const sources = await loadMigrationSources();
    await applyMigrations(executor, sources);
    return await work({ database: pool, executor, sources });
  } finally {
    if (pool !== undefined) await pool.end();
    await admin.query(`DROP DATABASE IF EXISTS ${databaseName}`);
    await admin.end();
  }
}

import assert from "node:assert/strict";
import test from "node:test";

import { createPostgreSqlExecutor } from "../dist/src/adapters/index.js";

function fixturePool({ failRollback = false } = {}) {
  const calls = [];
  let releases = 0;
  const connection = {
    async query(sql, parameters = []) {
      calls.push([sql, [...parameters]]);
      if (sql === "ROLLBACK" && failRollback) throw new Error("rollback unavailable");
      return { rows: sql.startsWith("SELECT") ? [{ value: 7 }] : [], rowCount: 1 };
    },
    release() {
      releases += 1;
    },
  };
  return {
    pool: {
      ...connection,
      async connect() {
        return connection;
      },
    },
    calls,
    releases: () => releases,
  };
}

test("PostgreSQL adapter commits one checked-out transaction and releases it", async () => {
  const fixture = fixturePool();
  const database = createPostgreSqlExecutor(fixture.pool);
  const value = await database.transaction(async (transaction) => {
    const result = await transaction.query("SELECT $1::int AS value", [7]);
    return result.rows[0].value;
  });
  assert.equal(value, 7);
  assert.deepEqual(
    fixture.calls.map(([sql]) => sql),
    ["BEGIN", "SELECT $1::int AS value", "COMMIT"],
  );
  assert.equal(fixture.releases(), 1);
});

test("PostgreSQL adapter rolls back failures and preserves rollback ambiguity", async () => {
  const fixture = fixturePool();
  const database = createPostgreSqlExecutor(fixture.pool);
  await assert.rejects(
    database.transaction(async () => {
      throw new Error("typed failure");
    }),
    /typed failure/,
  );
  assert.deepEqual(
    fixture.calls.map(([sql]) => sql),
    ["BEGIN", "ROLLBACK"],
  );
  assert.equal(fixture.releases(), 1);

  const ambiguous = fixturePool({ failRollback: true });
  await assert.rejects(
    createPostgreSqlExecutor(ambiguous.pool).transaction(async () => {
      throw new Error("write failed");
    }),
    AggregateError,
  );
  assert.equal(ambiguous.releases(), 1);
});

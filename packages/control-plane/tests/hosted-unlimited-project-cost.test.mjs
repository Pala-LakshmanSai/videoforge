import assert from "node:assert/strict";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

import { applyMigrations } from "../dist/src/index.js";
import { loadMigrationSources, PGliteExecutor } from "./support/pglite.mjs";

test("0086 makes NULL the unlimited project cost representation without weakening accounting", async () => {
  const database = new PGlite();
  try {
    const executor = new PGliteExecutor(database);
    await applyMigrations(executor, await loadMigrationSources());

    const column = await executor.query(
      `SELECT is_nullable
         FROM information_schema.columns
        WHERE table_schema='public' AND table_name='project_revisions'
          AND column_name='maximum_cost_micro_usd'`,
    );
    assert.deepEqual(column.rows, [{ is_nullable: "YES" }]);

    const functions = await executor.query(
      `SELECT proname, pg_get_functiondef(oid) AS definition
         FROM pg_proc
        WHERE pronamespace='public'::regnamespace
          AND proname IN (
            'videoforge_prepare_hosted_voiceover_context',
            'videoforge_prepare_hosted_prompt_run'
          )
        ORDER BY proname`,
    );
    assert.equal(functions.rows.length, 2);
    for (const row of functions.rows) {
      assert.match(row.definition, /maximum_cost_micro_usd IS NULL/u);
    }

    const constraint = await executor.query(
      `SELECT pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
        WHERE conname='project_revisions_maximum_cost_micro_usd_check'`,
    );
    assert.match(constraint.rows[0].definition, /maximum_cost_micro_usd IS NULL/u);
    assert.match(constraint.rows[0].definition, /50000/u);
    assert.match(constraint.rows[0].definition, /2000000/u);
  } finally {
    await database.close();
  }
});

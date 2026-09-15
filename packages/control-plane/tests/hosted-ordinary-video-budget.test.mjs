import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { applyMigrations } from "../dist/src/index.js";
import { loadMigrationSources, PGliteExecutor } from "./support/pglite.mjs";

test("ordinary budget migration applies after the current production schema", async () => {
  const database = new PGlite();
  try {
    await applyMigrations(
      new PGliteExecutor(database),
      (await loadMigrationSources()).filter((e) => e.version < 134),
    );
    await database.exec(
      await readFile(
        new URL("../migrations/0134_hosted_v209_mage_long_plan_successor.sql", import.meta.url),
        "utf8",
      ),
    );
    await database.exec("BEGIN");
    await database.exec(
      await readFile(
        new URL("../migrations/0135_hosted_ordinary_video_budget.sql", import.meta.url),
        "utf8",
      ),
    );
    const rows = await database.query(
      "SELECT public.videoforge_ordinary_video_budget(108000) AS budget",
    );
    assert.equal(rows.rows[0].budget.hardVariableCostCeilingMicroUsd, 5000000);
    assert.equal(rows.rows[0].budget.soulxAvatarTimeoutSeconds, 6600);
    const short = await database.query(
      "SELECT public.videoforge_ordinary_video_budget(32747) AS budget",
    );
    assert.equal(short.rows[0].budget.hardVariableCostCeilingMicroUsd, 2000000);
    assert.equal(short.rows[0].budget.mageImageTimeoutSeconds, 2400);
    await database.query(
      "SELECT set_config('videoforge.account_id','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false)",
    );
    const deadlines = await database.query(
      "SELECT * FROM public.videoforge_hosted_pair_funded_deadlines('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','cccccccc-cccc-4ccc-8ccc-cccccccccccc')",
    );
    assert.deepEqual(deadlines.rows, []);
    const constraint = (
      await database.query(
        "SELECT pg_get_constraintdef(oid) AS expression FROM pg_constraint WHERE conname='hosted_admission_funded_budget'",
      )
    ).rows[0].expression;
    const expression = constraint.replace(/^CHECK \(/, "").replace(/\)$/, "");
    const check = await database.query(`SELECT ${expression} AS valid FROM (SELECT
      '{"cost":{"budgetVersion":"ordinary-video-budget/v1"}}'::jsonb AS admission_document,
      2000000 AS phase_cap_micro_usd, now() AS database_observed_at,
      now()+interval '40 minutes' AS cancel_at,now()+interval '50 minutes' AS stop_at) input`);
    assert.equal(
      check.rows[0].valid,
      false,
      "missing funded fields must fail closed, including SQL NULL",
    );
    await assert.rejects(
      database.query("SELECT public.videoforge_ordinary_video_budget(108001)"),
      /ORDINARY_VIDEO_DURATION_OUT_OF_RANGE/,
    );
    await database.exec("ROLLBACK");
  } finally {
    await database.close();
  }
});

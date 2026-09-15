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
    // Execute the actual materializer UPDATE with its actual local variable names.
    // Only the table is substituted to isolate this statement from provider authority.
    await database.exec(`CREATE TEMP TABLE budget_lease_fixture (
      id integer, state text, expires_at timestamptz, released_at timestamptz,
      heartbeat_at timestamptz, version integer);
      INSERT INTO budget_lease_fixture VALUES (1,'ACTIVE',now()+interval '2 hours',NULL,now(),1)`);
    const installLeaseProbe = async () => {
      const definition = (await database.query(`SELECT pg_get_functiondef(
        'public.videoforge_materialize_hosted_v209_ordinary_dispatch(uuid,uuid,uuid,uuid)'::regprocedure) AS body`)).rows[0].body;
      const update = definition.match(/UPDATE public\.provider_workload_leases(?: AS funded_lease)? SET[\s\S]*?INTO lease;/)?.[0];
      assert.ok(update, "actual funded lease UPDATE must be present");
      await database.exec(`CREATE OR REPLACE FUNCTION pg_temp.probe_budget_lease()
        RETURNS integer LANGUAGE plpgsql AS $$
        DECLARE lease budget_lease_fixture%ROWTYPE; expires_at timestamptz;
          db_now timestamptz:=now(); budget jsonb:='{"soulxAvatarTimeoutSeconds":2400}';
        BEGIN SELECT * INTO lease FROM budget_lease_fixture WHERE id=1;
          ${update.replace("public.provider_workload_leases", "budget_lease_fixture")}
          RETURN lease.version;
        END; $$`);
    };
    await installLeaseProbe();
    await database.exec("SAVEPOINT ambiguous_lease");
    await assert.rejects(database.query("SELECT pg_temp.probe_budget_lease()"),
      (error) => error.code === "42702" && /expires_at.*ambiguous/.test(error.message));
    await database.exec("ROLLBACK TO SAVEPOINT ambiguous_lease");
    await database.exec(await readFile(new URL(
      "../migrations/0136_hosted_ordinary_budget_lease_alias.sql", import.meta.url), "utf8"));
    await installLeaseProbe();
    assert.equal((await database.query("SELECT pg_temp.probe_budget_lease() AS version")).rows[0].version, 2);
    assert.equal((await database.query(`SELECT expires_at=now()+interval '2 hours' AS preserved
      FROM budget_lease_fixture WHERE id=1`)).rows[0].preserved, true);
    await assert.rejects(
      database.query("SELECT public.videoforge_ordinary_video_budget(108001)"),
      /ORDINARY_VIDEO_DURATION_OUT_OF_RANGE/,
    );
    await database.exec("ROLLBACK");
  } finally {
    await database.close();
  }
});

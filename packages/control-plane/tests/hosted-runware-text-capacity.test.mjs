import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createFixtureDatabase,
  applyMigrationSliceThrough,
  sha256,
  uuid,
} from "./support/pglite.mjs";
import { seedAdaptivePromptRun } from "./hosted-prompt-adaptive-batches-migration.test.mjs";
import { IDS } from "./support/fixtures.mjs";

test("0261 cooldown blocks paid prompt claim then resumes same waiting ordinal without invented concurrency cap", async () => {
  const { database: db, executor, sources } = await createFixtureDatabase();
  try {
    await applyMigrationSliceThrough(executor, 257, sources);
    for (const file of ["0259_provider_api_capacity.sql", "0261_runware_text_capacity.sql"])
      await executor.execute(
        readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"),
      );
    const run = await seedAdaptivePromptRun(executor, {
      sceneCount: 2,
      plannedBatchCount: 2,
      reservedMicroUsd: 500000,
    });
    const policy = "RUNWARE_TEXT:google:gemini@3.5-flash";
    const request = JSON.stringify([
      { taskType: "textInference", taskUUID: uuid(261001), model: "google:gemini@3.5-flash" },
    ]);
    const args = [run.runId, 0, uuid(261001), request, sha256(request)];
    const claim = () =>
      executor.query(
        "SELECT videoforge_claim_next_hosted_prompt_batch($1,$2,$3,$4,$5) AS claimed",
        args,
      );
    await db.query(
      "UPDATE provider_api_policies SET cooldown_until=clock_timestamp()+interval '60 seconds' WHERE provider=$1",
      [policy],
    );
    assert.equal((await claim()).rows[0].claimed, false);
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::integer AS n FROM hosted_prompt_batch_claims WHERE run_id=$1",
          [run.runId],
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await db.query("SELECT count(*)::integer AS n FROM provider_api_waiters WHERE job_id=$1", [
          run.runId,
        ])
      ).rows[0].n,
      1,
    );
    await db.query(
      "UPDATE provider_api_policies SET cooldown_until='-infinity',next_start_at='-infinity' WHERE provider=$1",
      [policy],
    );
    assert.equal(
      (await claim()).rows[0].claimed,
      true,
      "existing waiting run resumes after cooldown",
    );
    assert.equal((await claim()).rows[0].claimed, false, "ordinary duplicate remains no replay");
    const pauseArgs = [run.runId, uuid(261001), sha256("exact rejected response"), 60000];
    await executor.query("SELECT videoforge_pause_hosted_prompt_capacity($1,$2,$3,$4)", pauseArgs);
    const until = (
      await db.query(
        "SELECT cooldown_until::text AS value FROM provider_api_policies WHERE provider=$1",
        [policy],
      )
    ).rows[0].value;
    await executor.query("SELECT videoforge_pause_hosted_prompt_capacity($1,$2,$3,$4)", pauseArgs);
    assert.equal(
      (
        await db.query(
          "SELECT cooldown_until::text AS value FROM provider_api_policies WHERE provider=$1",
          [policy],
        )
      ).rows[0].value,
      until,
      "repeated archive receipt never extends cooldown",
    );
    assert.equal(
      (await db.query("SELECT count(*)::integer AS n FROM hosted_prompt_batch_replacements"))
        .rows[0].n,
      0,
    );
    assert.equal(
      (await db.query("SELECT max_inflight FROM provider_api_policies WHERE provider=$1", [policy]))
        .rows[0].max_inflight,
      null,
    );
    await executor.query("SELECT set_config('videoforge.account_id',$1,false)", [IDS.accountB]);
    await assert.rejects(
      executor.query("SELECT videoforge_pause_hosted_prompt_capacity($1,$2,$3,$4)", pauseArgs),
      /scope invalid/,
    );
  } finally {
    await db.close();
  }
});

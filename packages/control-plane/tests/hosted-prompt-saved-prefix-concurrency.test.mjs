import assert from "node:assert/strict";
import test from "node:test";
import {
  seedAdaptivePromptRun,
  scenePayload,
} from "./hosted-prompt-adaptive-batches-migration.test.mjs";
import { IDS } from "./support/fixtures.mjs";
import { sha256, uuid, withPgcryptoMigratedDatabase } from "./support/pglite.mjs";

test("0228 accepts exact duplicate callbacks and reopens only a wholly saved prefix without new costs or claims", async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    const run = await seedAdaptivePromptRun(executor, {
      sceneCount: 2,
      plannedBatchCount: 2,
      reservedMicroUsd: 500000,
    });
    const bytes = JSON.stringify([
      { taskType: "textInference", taskUUID: uuid(228001), model: "google:gemini@3.5-flash" },
    ]);
    const supplied = {
      batch_ordinal: 0,
      first_scene_ordinal: 0,
      request_bytes: bytes,
      request_hash: sha256(bytes),
      response_bytes: "response",
      response_hash: sha256("response"),
      input_tokens: 10,
      output_tokens: 20,
      reported_cost_micro_usd: 123,
      scenes: scenePayload(0, 1),
    };
    const record = "SELECT videoforge_record_hosted_prompt_batch($1,$2::jsonb) AS recorded";
    const recover = "SELECT videoforge_recover_hosted_prompt_batch($1,$2,$3::jsonb) AS recorded";
    const reopen = "SELECT videoforge_reopen_saved_hosted_prompt_prefix($1) AS reopened";
    const fail =
      "SELECT videoforge_fail_hosted_prompt_run($1,'UNKNOWN','HOSTED_PROMPT_EXECUTION_UNKNOWN',true,0)";
    await executor.query(fail, [run.runId]);
    await assert.rejects(executor.query(reopen, [run.runId]), /evidence is invalid/);
    // Restore the seed state, then save one exact claimed result.
    await executor.query(
      "UPDATE hosted_prompt_runs SET state='DISPATCHING',problem_code=NULL,provider_may_have_charged=false,finished_at=NULL WHERE id=$1",
      [run.runId],
    );
    await executor.query(
      "UPDATE attempts SET state='RUNNING',dispatch_state='RECONCILED',problem_code=NULL,finished_at=NULL WHERE id=$1",
      [run.attemptId],
    );
    await executor.query(
      "UPDATE generation_tasks SET state='RUNNING',finished_at=NULL WHERE id=$1",
      [run.taskId],
    );
    await executor.query("SELECT videoforge_claim_hosted_prompt_batch($1,0,$2,$3,$4)", [
      run.runId,
      JSON.parse(bytes)[0].taskUUID,
      bytes,
      sha256(bytes),
    ]);
    assert.equal(
      (await executor.query(record, [run.runId, JSON.stringify(supplied)])).rows[0].recorded,
      true,
    );
    const snapshot = async () =>
      (
        await executor.query(
          "SELECT (SELECT jsonb_agg(to_jsonb(p)) FROM hosted_prompt_batch_progress p WHERE run_id=$1) AS progress,(SELECT jsonb_agg(to_jsonb(c)) FROM hosted_prompt_batch_claims c WHERE run_id=$1) AS claims,(SELECT jsonb_agg(to_jsonb(c) ORDER BY sequence) FROM cost_events c WHERE attempt_id=$2) AS costs",
          [run.runId, run.attemptId],
        )
      ).rows;
    const before = await snapshot();
    assert.equal(
      (await executor.query(record, [run.runId, JSON.stringify(supplied)])).rows[0].recorded,
      true,
    );
    assert.equal(
      (
        await executor.query(recover, [
          run.runId,
          JSON.parse(bytes)[0].taskUUID,
          JSON.stringify(supplied),
        ])
      ).rows[0].recorded,
      true,
    );
    await assert.rejects(
      executor.query(record, [
        run.runId,
        JSON.stringify({ ...supplied, reported_cost_micro_usd: 124 }),
      ]),
    );
    await assert.rejects(
      executor.query(recover, [run.runId, uuid(228002), JSON.stringify(supplied)]),
    );
    await executor.query(fail, [run.runId]);
    await executor.query("SELECT videoforge_pause_hosted_prompt_for_credits($1)", [run.runId]);
    await executor.query("SELECT videoforge_pause_hosted_prompt_for_credits($1)", [run.runId]);
    assert.deepEqual(await snapshot(), before);
    await executor.query("SELECT set_config('videoforge.account_id',$1,false)", [IDS.accountB]);
    await assert.rejects(executor.query(reopen, [run.runId]), /state is invalid/);
    await assert.rejects(executor.query(record, [run.runId, JSON.stringify(supplied)]));
    await executor.query("SELECT set_config('videoforge.account_id',$1,false)", [IDS.accountA]);
    assert.equal((await executor.query(reopen, [run.runId])).rows[0].reopened, true);
    assert.equal((await executor.query(reopen, [run.runId])).rows[0].reopened, false);
    assert.deepEqual(await snapshot(), before);
    const nextClaim = "SELECT videoforge_claim_next_hosted_prompt_batch($1,0,$2,$3,$4) AS claimed";
    const exactArgs = [run.runId, JSON.parse(bytes)[0].taskUUID, bytes, sha256(bytes)];
    assert.equal((await executor.query(nextClaim, exactArgs)).rows[0].claimed, false);
    await executor.query(fail, [run.runId]);
    assert.equal((await executor.query(nextClaim, exactArgs)).rows[0].claimed, false);
    assert.equal(
      (await executor.query("SELECT state FROM hosted_prompt_runs WHERE id=$1", [run.runId]))
        .rows[0].state,
      "UNKNOWN",
    );
    await assert.rejects(executor.query(nextClaim, [...exactArgs.slice(0, 3), sha256("drift")]));
    await executor.query("SELECT set_config('videoforge.account_id',$1,false)", [IDS.accountB]);
    await assert.rejects(executor.query(nextClaim, exactArgs), /tenant is invalid/);
    await executor.query("SELECT set_config('videoforge.account_id',$1,false)", [IDS.accountA]);

    const next = bytes.replace(uuid(228001), uuid(228003));
    await executor.query("SELECT videoforge_claim_next_hosted_prompt_batch($1,1,$2,$3,$4)", [
      run.runId,
      uuid(228003),
      next,
      sha256(next),
    ]);
    await executor.query("SELECT videoforge_reconcile_stale_hosted_prompt_dispatches($1)", [
      IDS.projectA,
    ]);
    assert.equal(
      (await executor.query("SELECT state FROM hosted_prompt_runs WHERE id=$1", [run.runId]))
        .rows[0].state,
      "DISPATCHING",
    );
    await executor.query(fail, [run.runId]);
    await assert.rejects(executor.query(reopen, [run.runId]), /evidence is invalid/);
    assert.equal((await executor.query("SELECT videoforge_claim_next_hosted_prompt_batch($1,1,$2,$3,$4) AS claimed",[run.runId,uuid(228003),next,sha256(next)])).rows[0].claimed,false);
    assert.equal(
      (
        await executor.query(
          "SELECT has_function_privilege('public','videoforge_hosted_prompt_batch_matches_saved(uuid,jsonb)','EXECUTE') AS helper,has_function_privilege('public','videoforge_reopen_saved_hosted_prompt_prefix(uuid)','EXECUTE') AS reopen",
        )
      ).rows[0].helper,
      false,
    );
  });
});

test("0233 pauses before the first claim without costs and reopens only that provider-free empty prefix", async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    const run = await seedAdaptivePromptRun(executor, { sceneCount: 2, plannedBatchCount: 2, reservedMicroUsd: 500000 });
    const snapshot = async () => (await executor.query(
      "SELECT (SELECT jsonb_agg(to_jsonb(c)) FROM cost_events c WHERE attempt_id=$2) AS costs,(SELECT count(*) FROM hosted_prompt_batch_claims WHERE run_id=$1) AS claims", [run.runId,run.attemptId])).rows;
    const before = await snapshot();
    const pause = "SELECT videoforge_pause_hosted_prompt_for_credits($1) AS paused";
    await executor.query("SELECT set_config('videoforge.account_id',$1,false)", [IDS.accountB]);
    await assert.rejects(executor.query(pause,[run.runId]), /state is invalid/);
    await executor.query("SELECT set_config('videoforge.account_id',$1,false)", [IDS.accountA]);
    assert.equal((await executor.query(pause,[run.runId])).rows[0].paused,true);
    assert.equal((await executor.query(pause,[run.runId])).rows[0].paused,true);
    assert.deepEqual(await snapshot(),before);
    assert.equal((await executor.query("SELECT videoforge_reopen_saved_hosted_prompt_prefix($1) AS reopened",[run.runId])).rows[0].reopened,true);
    assert.deepEqual(await snapshot(),before);
    await executor.query("SELECT videoforge_fail_hosted_prompt_run($1,'UNKNOWN','HOSTED_PROMPT_EXECUTION_UNKNOWN',true,0)",[run.runId]);
    await assert.rejects(executor.query(pause,[run.runId]), /evidence is invalid/);
    await assert.rejects(executor.query("SELECT videoforge_reopen_saved_hosted_prompt_prefix($1)",[run.runId]), /evidence is invalid/);
  });
});

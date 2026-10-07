import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  seedAdaptivePromptRun,
  seedSucceededVoiceoverContext,
} from "./hosted-prompt-adaptive-batches-migration.test.mjs";
import { IDS } from "./support/fixtures.mjs";
import { sha256, uuid, withPgcryptoMigratedDatabase } from "./support/pglite.mjs";

test("0288 reserves bounded one-batch correction headroom without expanding pinned runs", async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    // The retained chain omits 0156, which installed the production redispatch counter.
    await executor.query(
      "ALTER TABLE hosted_prompt_runs ADD COLUMN IF NOT EXISTS redispatch_count integer NOT NULL DEFAULT 0",
    );
    const run = await seedAdaptivePromptRun(executor, {
      sceneCount: 2,
      plannedBatchCount: 1,
      materializeRun: false,
    });
    await seedSucceededVoiceoverContext(executor, 2880000);
    const supplied = {
      account_id: IDS.accountA,
      workspace_id: IDS.workspaceA,
      user_id: IDS.userA,
      project_id: IDS.projectA,
      revision_id: IDS.revisionA,
      timeline_id: run.timelineId,
      task_id: run.taskId,
      attempt_id: run.attemptId,
      outbox_id: run.outboxId,
      execution_profile_id: run.profileId,
      reservation_cost_event_id: uuid(2880010),
      run_id: run.runId,
      input_hash: run.inputHash,
      claim_token_hash: run.claimHash,
      timeline_hash: run.timelineHash,
      batch_plan_hash: run.batchPlanHash,
      planned_batch_count: 1,
      planned_scene_count: 2,
      reserved_cost_micro_usd: 500000,
      request_policy: "runware-luna-grounded-v2",
    };
    const prepare = (body) =>
      executor.query("SELECT videoforge_prepare_hosted_prompt_run($1::jsonb)", [
        JSON.stringify(body),
      ]);
    await assert.rejects(
      prepare({ ...supplied, reserved_cost_micro_usd: 250000 }),
      /reservation is invalid/u,
    );
    await prepare(supplied);
    const definition = (
      await executor.query(
        "SELECT pg_get_functiondef('videoforge_prepare_hosted_prompt_run(jsonb)'::regprocedure) AS definition",
      )
    ).rows[0].definition;
    assert.match(definition, /input repair evidence is invalid/u);
    assert.match(definition, /hosted prompt generation is terminal or cancelling/u);
    assert.match(
      definition,
      /greatest\(500000::numeric,least\(8000000::numeric,planned_batch_count::numeric\*250000::numeric\)\)/u,
    );
    await assert.rejects(
      prepare({ ...supplied, redispatch: true, reserved_cost_micro_usd: 750000 }),
      /reservation is invalid/u,
    );
    const request = (attempt, id) =>
      JSON.stringify([
        {
          taskType: "textInference",
          taskUUID: uuid(id),
          model: "openai:gpt@6-luna",
          settings: { systemPrompt: "Sealed instructions" },
          messages: [
            {
              role: "user",
              content: JSON.stringify({
                batch_id: "bounded-one",
                attempt_index: attempt,
                scenes: [{ scene_id: "scene-000" }, { scene_id: "scene-001" }],
              }),
            },
          ],
        },
      ]);
    const first = request(1, 2880020),
      replacement = request(2, 2880021);
    await executor.query("SELECT videoforge_claim_next_hosted_prompt_batch($1,0,$2,$3,$4)", [
      run.runId,
      uuid(2880020),
      first,
      sha256(first),
    ]);
    const result = {
      status: "succeeded",
      outputText: "{}",
      usage: {
        inputTokens: 2,
        outputTokens: 2,
        totalTokens: 4,
        cachedInputTokens: 0,
        cacheWriteTokens: 1,
        reasoningTokens: 1,
      },
      costUsd: 0.000002,
      estimatedCostMicroUsd: 2,
      costBasis: "PINNED_RATE_ESTIMATE",
      responseId: "chatcmpl-288-test",
      wireHash: sha256("wire"),
      providerModel: "openai:gpt@6-luna",
      finishReason: "stop",
      latencyMs: 1,
    };
    await executor.query("SELECT videoforge_record_hosted_prompt_response($1,$2,$3,$4::jsonb)", [
      run.runId,
      uuid(2880020),
      sha256(first),
      JSON.stringify(result),
    ]);
    const replaced = await executor.query(
      "SELECT videoforge_replace_invalid_hosted_prompt_batch($1,0,$2,$3,2,$4,$5) AS replaced",
      [run.runId, uuid(2880020), sha256("{}"), replacement, sha256(replacement)],
    );
    assert.equal(replaced.rows[0].replaced, true);
    const state = (
      await executor.query(
        "SELECT reserved_cost_micro_usd::integer AS reserved,discarded_cost_micro_usd::integer AS discarded FROM hosted_prompt_runs WHERE id=$1",
        [run.runId],
      )
    ).rows[0];
    assert.deepEqual(state, { reserved: 500000, discarded: 2 });
    assert.equal(
      (
        await executor.query(
          "SELECT count(*)::integer AS n FROM hosted_prompt_batch_replacements WHERE run_id=$1",
          [run.runId],
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      (
        await executor.query(
          "SELECT count(*)::integer AS n FROM cost_events WHERE attempt_id=$1 AND event_type='RESERVED'",
          [run.attemptId],
        )
      ).rows[0].n,
      1,
    );
  });
});

test("0288 keeps a historical one-batch 250000 reservation pinned on redispatch", async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    // Reconstruct only the immediately prior reservation predicate inside the fully provisioned fixture.
    const current = (
      await executor.query(
        "SELECT pg_get_functiondef('videoforge_prepare_hosted_prompt_run(jsonb)'::regprocedure) AS definition",
      )
    ).rows[0].definition;
    const before = current.replace(
      "greatest(500000::numeric,least(8000000::numeric,planned_batch_count::numeric*250000::numeric))",
      "least(8000000::numeric,planned_batch_count::numeric*250000::numeric)",
    );
    assert.notEqual(current, before);
    await executor.execute(before);
    await executor.query(
      "ALTER TABLE hosted_prompt_runs ADD COLUMN IF NOT EXISTS redispatch_count integer NOT NULL DEFAULT 0",
    );
    const run = await seedAdaptivePromptRun(executor, {
      sceneCount: 2,
      plannedBatchCount: 1,
      materializeRun: false,
    });
    await seedSucceededVoiceoverContext(executor, 2881000);
    const supplied = {
      account_id: IDS.accountA,
      workspace_id: IDS.workspaceA,
      user_id: IDS.userA,
      project_id: IDS.projectA,
      revision_id: IDS.revisionA,
      timeline_id: run.timelineId,
      task_id: run.taskId,
      attempt_id: run.attemptId,
      outbox_id: run.outboxId,
      execution_profile_id: run.profileId,
      reservation_cost_event_id: uuid(2881010),
      run_id: run.runId,
      input_hash: run.inputHash,
      claim_token_hash: run.claimHash,
      timeline_hash: run.timelineHash,
      batch_plan_hash: run.batchPlanHash,
      planned_batch_count: 1,
      planned_scene_count: 2,
      reserved_cost_micro_usd: 250000,
      request_policy: "runware-luna-grounded-v2",
    };
    const prepare = (body) =>
      executor.query("SELECT videoforge_prepare_hosted_prompt_run($1::jsonb)", [
        JSON.stringify(body),
      ]);
    await prepare(supplied);
    await executor.query(
      "SELECT videoforge_fail_hosted_prompt_run($1,'FAILED','HOSTED_PROMPT_PROVIDER_UNAVAILABLE',false,0)",
      [run.runId],
    );
    await executor.execute(
      readFileSync(
        new URL(
          "../migrations/0288_hosted_prompt_single_batch_correction_headroom.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const redispatch = {
      ...supplied,
      redispatch: true,
      task_id: uuid(2881020),
      attempt_id: uuid(2881021),
      outbox_id: uuid(2881022),
      execution_profile_id: uuid(2881023),
      reservation_cost_event_id: uuid(2881024),
      run_id: uuid(2881025),
      input_hash: sha256("redispatch-input"),
      batch_plan_hash: sha256("redispatch-plan"),
    };
    await assert.rejects(
      prepare({ ...redispatch, reserved_cost_micro_usd: 500000 }),
      /reservation is invalid/u,
    );
    await prepare(redispatch);
    assert.equal(
      (
        await executor.query(
          "SELECT reserved_cost_micro_usd::integer AS reserved FROM hosted_prompt_runs WHERE id=$1",
          [run.runId],
        )
      ).rows[0].reserved,
      250000,
    );
  });
});

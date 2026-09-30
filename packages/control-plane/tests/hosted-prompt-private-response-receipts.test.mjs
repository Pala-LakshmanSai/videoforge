import assert from "node:assert/strict";
import test from "node:test";
import { seedAdaptivePromptRun } from "./hosted-prompt-adaptive-batches-migration.test.mjs";
import { IDS } from "./support/fixtures.mjs";
import { sha256, uuid, withPgcryptoMigratedDatabase } from "./support/pglite.mjs";

test("0226 privately preserves invalid native prompt results with exact tenant/claim replay binding", async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    const run = await seedAdaptivePromptRun(executor, {
      sceneCount: 1,
      plannedBatchCount: 1,
      reservedMicroUsd: 250000,
    });
    const taskUUID = uuid(226001),
      bytes = JSON.stringify([{ taskType: "textInference", taskUUID }]),
      requestHash = sha256(bytes);
    await executor.query("SELECT videoforge_claim_hosted_prompt_batch($1,0,$2,$3,$4)", [
      run.runId,
      taskUUID,
      bytes,
      requestHash,
    ]);
    const result = {
      status: "succeeded",
      outputText: "invalid JSON that must remain recoverable",
      usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3, cachedInputTokens: 0 },
      costUsd: 0.07,
      finishReason: "stop",
      providerModel: "google:gemini@3.5-flash",
      latencyMs: 31000,
    };
    const record =
      "SELECT videoforge_record_hosted_prompt_response($1,$2,$3,$4::jsonb) AS recorded";
    const args = [run.runId, taskUUID, requestHash, JSON.stringify(result)];
    assert.equal((await executor.query(record, args)).rows[0].recorded, true);
    assert.equal((await executor.query(record, args)).rows[0].recorded, false);
    const load = "SELECT videoforge_load_hosted_prompt_response($1,$2,$3) AS result";
    assert.deepEqual((await executor.query(load, args.slice(0, 3))).rows[0].result, result);
    await assert.rejects(
      executor.query(record, [
        ...args.slice(0, 3),
        JSON.stringify({ ...result, outputText: "changed" }),
      ]),
      /evidence drifted/,
    );
    await assert.rejects(
      executor.query(record, [run.runId, taskUUID, sha256("wrong"), args[3]]),
      /claim is invalid/,
    );
    await assert.rejects(
      executor.query(record, [run.runId, uuid(226002), requestHash, args[3]]),
      /claim is invalid/,
    );
    await assert.rejects(
      executor.query(record, [...args.slice(0, 3), JSON.stringify({ ...result, usage: {} })]),
      /shape is invalid/,
    );
    await executor.query("SELECT set_config('videoforge.account_id',$1,false)", [IDS.accountB]);
    assert.equal((await executor.query(load, args.slice(0, 3))).rows[0].result, null);
    await assert.rejects(executor.query(record, args), /identity or shape is invalid/);
    await executor.query("SELECT set_config('videoforge.account_id',$1,false)", [IDS.accountA]);
    await assert.rejects(
      executor.query(
        "UPDATE repository_mutation_receipts SET result_payload='{}'::jsonb WHERE operation='hosted_prompt_response'",
      ),
      /immutable/,
    );
    const counts = (
      await executor.query(
        "SELECT (SELECT count(*) FROM hosted_prompt_batch_progress)::int AS accepted,(SELECT count(*) FROM hosted_prompt_batch_claims)::int AS claims",
      )
    ).rows[0];
    assert.deepEqual(counts, { accepted: 0, claims: 1 });
  });
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  seedAdaptivePromptRun,
  scenePayload,
} from "./hosted-prompt-adaptive-batches-migration.test.mjs";
import { IDS, HASHES } from "./support/fixtures.mjs";
import { FIXED_TIME, sha256, uuid, withPgcryptoMigratedDatabase } from "./support/pglite.mjs";

test("0225 preserves the accepted prefix, claims one replacement, and conserves all provider charges", async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    const run = await seedAdaptivePromptRun(executor, {
      sceneCount: 2,
      plannedBatchCount: 2,
      reservedMicroUsd: 500000,
    });
    const request = (ordinal, attemptIndex = 1) =>
      JSON.stringify([
        {
          taskType: "textInference",
          taskUUID: uuid(225010 + ordinal * 2 + attemptIndex),
          model: "google:gemini@3.5-flash",
          deliveryMethod: "sync",
          includeCost: true,
          messages: [
            {
              role: "user",
              content: JSON.stringify({
                batch_id: `batch-${ordinal}`,
                attempt_index: attemptIndex,
                scenes: [{ scene_id: `scene-${ordinal}` }],
              }),
            },
          ],
        },
      ]);
    const payload = (ordinal, bytes, cost) => ({
      batch_ordinal: ordinal,
      first_scene_ordinal: ordinal,
      request_bytes: bytes,
      request_hash: sha256(bytes),
      response_bytes: `response-${ordinal}`,
      response_hash: sha256(`response-${ordinal}`),
      input_tokens: 10,
      output_tokens: 20,
      reported_cost_micro_usd: cost,
      scenes: scenePayload(ordinal, 1),
    });
    const claim = async (ordinal, bytes) =>
      executor.query("SELECT videoforge_claim_hosted_prompt_batch($1,$2,$3,$4,$5)", [
        run.runId,
        ordinal,
        JSON.parse(bytes)[0].taskUUID,
        bytes,
        sha256(bytes),
      ]);
    const first = request(0);
    await claim(0, first);
    await executor.query("SELECT videoforge_record_hosted_prompt_batch($1,$2::jsonb)", [
      run.runId,
      JSON.stringify(payload(0, first, 123)),
    ]);
    const prefix = (
      await executor.query(
        "SELECT row_to_json(p) AS row FROM hosted_prompt_batch_progress p WHERE run_id=$1",
        [run.runId],
      )
    ).rows;
    const original = request(1),
      replacement = request(1, 2);
    await claim(1, original);
    await executor.query(
      "SELECT videoforge_fail_hosted_prompt_run($1,'UNKNOWN','HOSTED_PROMPT_EXECUTION_UNKNOWN',true,0)",
      [run.runId],
    );
    const args = [
      run.runId,
      1,
      JSON.parse(original)[0].taskUUID,
      sha256("redacted terminal response"),
      77804,
      replacement,
      sha256(replacement),
    ];
    const replaceSql =
      "SELECT videoforge_replace_invalid_hosted_prompt_batch($1,$2,$3,$4,$5,$6,$7) AS claimed";
    await assert.rejects(
      executor.query(replaceSql, [run.runId, 0, ...args.slice(2)]),
      /replacement claim is invalid/,
    );
    const drifted = replacement.replace("scene-1", "different-scene");
    await assert.rejects(
      executor.query(replaceSql, [...args.slice(0, 5), drifted, sha256(drifted)]),
      /replacement request drifted/,
    );
    await executor.query("SELECT set_config('videoforge.account_id',$1,false)", [IDS.accountB]);
    await assert.rejects(executor.query(replaceSql, args), /replacement identity is invalid/);
    await executor.query("SELECT set_config('videoforge.account_id',$1,false)", [IDS.accountA]);
    assert.equal((await executor.query(replaceSql, args)).rows[0].claimed, true);
    assert.equal((await executor.query(replaceSql, args)).rows[0].claimed, false);
    await assert.rejects(
      executor.query(replaceSql, [...args.slice(0, 4), 77805, ...args.slice(5)]),
      /evidence drifted/,
    );
    assert.deepEqual(
      (
        await executor.query(
          "SELECT row_to_json(p) AS row FROM hosted_prompt_batch_progress p WHERE run_id=$1",
          [run.runId],
        )
      ).rows,
      prefix,
    );
    assert.equal(
      (
        await executor.query(
          "SELECT request_bytes FROM hosted_prompt_batch_claims WHERE run_id=$1 AND batch_ordinal=1",
          [run.runId],
        )
      ).rows[0].request_bytes,
      original,
    );
    await assert.rejects(
      executor.query("UPDATE hosted_prompt_batch_replacements SET known_cost_micro_usd=0"),
      /immutable/,
    );
    // Simulate losing the replacement's synchronous reply. Only retrieve its exact persisted task.
    await executor.query(
      "SELECT videoforge_fail_hosted_prompt_run($1,'UNKNOWN','HOSTED_PROMPT_EXECUTION_UNKNOWN',true,0)",
      [run.runId],
    );
    await assert.rejects(
      executor.query("SELECT videoforge_recover_hosted_prompt_batch($1,$2,$3::jsonb)", [
        run.runId,
        JSON.parse(original)[0].taskUUID,
        JSON.stringify(payload(1, replacement, 456)),
      ]),
      /recovery claim is invalid/,
    );
    await executor.query("SELECT videoforge_recover_hosted_prompt_batch($1,$2,$3::jsonb)", [
      run.runId,
      JSON.parse(replacement)[0].taskUUID,
      JSON.stringify(payload(1, replacement, 456)),
    ]);
    const scenes = scenePayload(0, 2);
    const accepted = {
      workspaceId: IDS.workspaceA,
      projectId: IDS.projectA,
      revisionId: IDS.revisionA,
      timelineId: run.timelineId,
      taskId: run.taskId,
      attemptId: run.attemptId,
      outboxId: uuid(971008),
      inputHash: run.inputHash,
      schemaVersion: "videoforge.durable-prompt-execution/v1",
      requestHash: sha256("requests"),
      responseHash: sha256("responses"),
      compiledOutputHash: sha256("compiled"),
      acceptanceFingerprintHash: sha256("acceptance"),
      timelineHash: run.timelineHash,
      styleProfileHash: HASHES.styleA,
      reportedCostMicroUsd: 579,
      acceptedAt: FIXED_TIME,
      writerAttempts: [
        {
          attemptIndex: 1,
          requestedSceneIds: scenes.map((s) => s.scene_id),
          requestBytes: "requests",
          requestHash: sha256("requests"),
          responseBytes: "responses",
          responseHash: sha256("responses"),
          retryOfRequestHash: null,
          acceptedSceneIds: scenes.map((s) => s.scene_id),
          unresolvedSceneIds: [],
          inputTokens: 20,
          outputTokens: 40,
          reportedCostMicroUsd: 579,
        },
      ],
      writerOutput: { scenes: scenes.map((s) => s.writer_output) },
      compiledPrompts: scenes.map((s) => s.compiled_prompt),
    };
    await executor.query("SELECT videoforge_complete_hosted_prompt_run($1::jsonb)", [
      JSON.stringify({
        run_id: run.runId,
        output_asset_id: uuid(225100),
        prompt_execution_id: uuid(225101),
        acceptance: accepted,
      }),
    ]);
    const costs = (
      await executor.query(
        "SELECT event_type,amount_micro_usd FROM cost_events WHERE attempt_id=$1 ORDER BY sequence",
        [run.attemptId],
      )
    ).rows;
    assert.deepEqual(costs, [
      { event_type: "RESERVED", amount_micro_usd: 500000 },
      { event_type: "REPORTED", amount_micro_usd: 78383 },
      { event_type: "SETTLED", amount_micro_usd: 78383 },
      { event_type: "RELEASED", amount_micro_usd: 421617 },
    ]);
    assert.equal(
      (
        await executor.query(
          "SELECT reported_cost_micro_usd FROM prompt_executions WHERE task_id=$1",
          [run.taskId],
        )
      ).rows[0].reported_cost_micro_usd,
      579,
    );
    assert.equal(
      (
        await executor.query("SELECT reported_cost_micro_usd FROM hosted_prompt_runs WHERE id=$1", [
          run.runId,
        ])
      ).rows[0].reported_cost_micro_usd,
      78383,
    );
  });
});

test("0225 stops after the replacement fails and settles both known charges", async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    const run = await seedAdaptivePromptRun(executor, {
      sceneCount: 2,
      plannedBatchCount: 1,
      reservedMicroUsd: 500000,
    });
    const request = (attemptIndex) =>
      JSON.stringify([
        {
          taskType: "textInference",
          taskUUID: uuid(225200 + attemptIndex),
          messages: [
            {
              role: "user",
              content: JSON.stringify({
                batch_id: "one",
                attempt_index: attemptIndex,
                scenes: ["scene-0", "scene-1"],
              }),
            },
          ],
        },
      ]);
    const original = request(1),
      replacement = request(2);
    await executor.query("SELECT videoforge_claim_hosted_prompt_batch($1,0,$2,$3,$4)", [
      run.runId,
      uuid(225201),
      original,
      sha256(original),
    ]);
    const args = [
      run.runId,
      0,
      uuid(225201),
      sha256("first invalid"),
      77804,
      replacement,
      sha256(replacement),
    ];
    const sql = "SELECT videoforge_replace_invalid_hosted_prompt_batch($1,$2,$3,$4,$5,$6,$7)";
    await executor.query(
      "UPDATE hosted_prompt_runs SET reserved_cost_micro_usd=250000 WHERE id=$1",
      [run.runId],
    );
    await assert.rejects(executor.query(sql, args), /state or budget is invalid/);
    await executor.query(
      "UPDATE hosted_prompt_runs SET reserved_cost_micro_usd=500000 WHERE id=$1",
      [run.runId],
    );
    // A finished, strictly invalid original can be replaced directly from DISPATCHING.
    await executor.query(sql, args);
    await executor.query(
      "SELECT videoforge_fail_hosted_prompt_run($1,'UNKNOWN','HOSTED_PROMPT_EXECUTION_UNKNOWN',true,0)",
      [run.runId],
    );
    await executor.query("SELECT videoforge_adjudicate_invalid_hosted_prompt_batch($1,$2,$3,$4)", [
      run.runId,
      uuid(225202),
      sha256("second invalid"),
      60000,
    ]);
    const costs = (
      await executor.query(
        "SELECT event_type,amount_micro_usd FROM cost_events WHERE attempt_id=$1 ORDER BY sequence",
        [run.attemptId],
      )
    ).rows;
    assert.deepEqual(costs, [
      { event_type: "RESERVED", amount_micro_usd: 500000 },
      { event_type: "REPORTED", amount_micro_usd: 137804 },
      { event_type: "SETTLED", amount_micro_usd: 137804 },
      { event_type: "RELEASED", amount_micro_usd: 362196 },
    ]);
    assert.equal(
      (await executor.query("SELECT state FROM hosted_prompt_runs WHERE id=$1", [run.runId]))
        .rows[0].state,
      "FAILED",
    );
    assert.equal(
      (
        await executor.query(
          "SELECT videoforge_adjudicate_invalid_hosted_prompt_batch($1,$2,$3,$4) AS changed",
          [run.runId, uuid(225202), sha256("second invalid"), 60000],
        )
      ).rows[0].changed,
      false,
    );
    assert.equal(
      (await executor.query("SELECT count(*)::integer AS n FROM hosted_prompt_batch_replacements"))
        .rows[0].n,
      1,
    );
  });
});

test("0234 gives a fresh replacement its own timeout window without replaying the old claim", async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    const run = await seedAdaptivePromptRun(executor, {
      sceneCount: 1,
      plannedBatchCount: 1,
      reservedMicroUsd: 500000,
    });
    const request = (attemptIndex) =>
      JSON.stringify([
        {
          taskType: "textInference",
          taskUUID: uuid(234010 + attemptIndex),
          model: "google:gemini@3.5-flash",
          deliveryMethod: "sync",
          includeCost: true,
          messages: [
            {
              role: "user",
              content: JSON.stringify({
                batch_id: "batch-0",
                attempt_index: attemptIndex,
                scenes: [{ scene_id: "scene-0" }],
              }),
            },
          ],
        },
      ]);
    const original = request(1),
      replacement = request(2);
    // Immutable history is seeded old; the real replacement helper creates the new timestamp.
    await executor.query(
      `INSERT INTO hosted_prompt_batch_claims (
      id,account_id,workspace_id,run_id,task_id,attempt_id,outbox_id,batch_ordinal,
      provider_task_uuid,request_bytes,request_hash,created_at
    ) SELECT $1,account_id,workspace_id,id,task_id,attempt_id,outbox_id,0,$2,$3,$4,
      clock_timestamp()-interval '30 minutes' FROM hosted_prompt_runs WHERE id=$5`,
      [uuid(234001), JSON.parse(original)[0].taskUUID, original, sha256(original), run.runId],
    );
    await executor.query(
      "SELECT videoforge_fail_hosted_prompt_run($1,'UNKNOWN','HOSTED_PROMPT_EXECUTION_UNKNOWN',true,0)",
      [run.runId],
    );
    await executor.query(
      "SELECT videoforge_replace_invalid_hosted_prompt_batch($1,0,$2,$3,0,$4,$5)",
      [
        run.runId,
        JSON.parse(original)[0].taskUUID,
        sha256("terminal rejection"),
        replacement,
        sha256(replacement),
      ],
    );
    const snapshot = async () =>
      (
        await executor.query(
          `SELECT
      (SELECT jsonb_agg(to_jsonb(c)) FROM hosted_prompt_batch_claims c WHERE run_id=$1) AS claims,
      (SELECT jsonb_agg(to_jsonb(c)) FROM hosted_prompt_batch_replacements c WHERE run_id=$1) AS replacements,
      (SELECT jsonb_agg(to_jsonb(c)) FROM cost_events c WHERE attempt_id=$2) AS costs`,
          [run.runId, run.attemptId],
        )
      ).rows;
    const before = await snapshot();
    assert.equal(
      (
        await executor.query(
          "SELECT videoforge_reconcile_stale_hosted_prompt_dispatches($1) AS result",
          [IDS.projectA],
        )
      ).rows[0].result.prompt_reconciled,
      0,
    );
    assert.equal(
      (await executor.query("SELECT state FROM hosted_prompt_runs WHERE id=$1", [run.runId]))
        .rows[0].state,
      "DISPATCHING",
    );
    await executor.query("SELECT set_config('videoforge.account_id',$1,false)", [IDS.accountB]);
    assert.equal(
      (
        await executor.query(
          "SELECT videoforge_reconcile_stale_hosted_prompt_dispatches($1) AS result",
          [IDS.projectA],
        )
      ).rows[0].result.prompt_reconciled,
      0,
    );
    await executor.query("SELECT set_config('videoforge.account_id',$1,false)", [IDS.accountA]);
    assert.deepEqual(await snapshot(), before);
  });
});

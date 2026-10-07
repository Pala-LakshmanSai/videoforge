import assert from "node:assert/strict";
import test from "node:test";
import {
  seedAdaptivePromptRun,
  seedSucceededVoiceoverContext,
} from "./hosted-prompt-adaptive-batches-migration.test.mjs";
import { IDS } from "./support/fixtures.mjs";
import { sha256, uuid, withPgcryptoMigratedDatabase } from "./support/pglite.mjs";

const prepare = "SELECT videoforge_prepare_hosted_prompt_run($1::jsonb) AS prepared";

test("0287 permits only an exact provider-free failed input repair and preserves old settlement", async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    // The retained chain omits 0156, which originally installed the production redispatch counter.
    await executor.query(
      "ALTER TABLE hosted_prompt_runs ADD COLUMN IF NOT EXISTS redispatch_count integer NOT NULL DEFAULT 0",
    );
    const run = await seedAdaptivePromptRun(executor, {
      sceneCount: 2,
      plannedBatchCount: 1,
      materializeRun: false,
      reservedMicroUsd: 250000,
    });
    await seedSucceededVoiceoverContext(executor, 2870000);
    const initial = {
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
      reservation_cost_event_id: uuid(2870010),
      run_id: run.runId,
      input_hash: run.inputHash,
      claim_token_hash: run.claimHash,
      timeline_hash: run.timelineHash,
      batch_plan_hash: run.batchPlanHash,
      reserved_cost_micro_usd: 250000,
      planned_batch_count: 1,
      planned_scene_count: 2,
      request_policy: "runware-luna-grounded-v2",
    };
    await executor.query(prepare, [JSON.stringify(initial)]);
    await executor.query(
      "SELECT videoforge_fail_hosted_prompt_run($1,'FAILED','HOSTED_PROMPT_INPUT_INVALID',false,0)",
      [run.runId],
    );
    const retry = {
      ...initial,
      task_id: uuid(2870021),
      attempt_id: uuid(2870022),
      outbox_id: uuid(2870023),
      execution_profile_id: uuid(2870024),
      reservation_cost_event_id: uuid(2870025),
      run_id: uuid(2870026),
      input_hash: sha256("fresh identity input"),
      batch_plan_hash: sha256("fresh identity plan"),
      redispatch: true,
      input_repair_redispatch: true,
      original_run_id: run.runId,
      original_input_hash: run.inputHash,
      original_batch_plan_hash: run.batchPlanHash,
      original_planned_batch_count: 1,
      original_planned_scene_count: 2,
      original_reserved_cost_micro_usd: 250000,
    };
    await executor.query(
      `INSERT INTO generation_requests(id,account_id,workspace_id,project_id,project_revision_id,created_by_user_id,state,queue_order,available_at,attempt_ordinal,idempotency_key,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,'WAITING',1,transaction_timestamp(),1,'input-repair-owner',transaction_timestamp(),transaction_timestamp())`,
      [uuid(2870090), IDS.accountA, IDS.workspaceA, IDS.projectA, IDS.revisionA, IDS.userA],
    );
    const snapshot = async () =>
      (
        await executor.query(
          "SELECT row_to_json(run) AS row FROM hosted_prompt_runs run WHERE id=$1",
          [run.runId],
        )
      ).rows[0];
    const before = await snapshot();
    const deny = async (mutation, body = retry) => {
      await executor.transaction(async (tx) => {
        await tx.query("SAVEPOINT input_repair");
        if (mutation) await mutation(tx);
        await assert.rejects(
          tx.query(prepare, [JSON.stringify(body)]),
          /input repair evidence is invalid|plan is not executable|authority is invalid|terminal or cancelling/u,
        );
        await tx.query("ROLLBACK TO SAVEPOINT input_repair");
      });
      assert.deepEqual(await snapshot(), before);
    };
    for (const field of [
      "original_run_id",
      "original_input_hash",
      "original_batch_plan_hash",
      "original_planned_batch_count",
      "original_planned_scene_count",
      "original_reserved_cost_micro_usd",
    ])
      await deny(null, { ...retry, [field]: field.endsWith("hash") ? sha256("wrong") : "999" });
    await deny(null, { ...retry, input_repair_redispatch: false });
    await deny(null, { ...retry, redispatch: false });
    await deny(async (tx) =>
      tx.query(
        "UPDATE hosted_prompt_runs SET state='UNKNOWN',provider_may_have_charged=true,problem_code='HOSTED_PROMPT_EXECUTION_UNKNOWN' WHERE id=$1",
        [run.runId],
      ),
    );
    await deny(async (tx) =>
      tx.query("UPDATE hosted_prompt_runs SET reported_cost_micro_usd=1 WHERE id=$1", [run.runId]),
    );
    await deny(async (tx) =>
      tx.query("UPDATE hosted_prompt_runs SET redispatch_count=29 WHERE id=$1", [run.runId]),
    );
    await deny(async (tx) =>
      tx.query(
        "UPDATE generation_requests SET state='CANCELLED',terminal_at=clock_timestamp() WHERE id=$1",
        [uuid(2870090)],
      ),
    );
    await deny(async (tx) =>
      tx.query(
        "UPDATE generation_requests SET state='CANCELLING',admitted_at=clock_timestamp() WHERE id=$1",
        [uuid(2870090)],
      ),
    );
    await deny(async (tx) =>
      tx.query(
        `INSERT INTO cost_events(id,account_id,workspace_id,owner_type,owner_id,task_id,attempt_id,sequence,event_type,amount_micro_usd,idempotency_key,details,occurred_at,created_at)
      SELECT $2,account_id,workspace_id,owner_type,owner_id,task_id,attempt_id,999,'SETTLED',1,'repair-invalid-settlement','{}'::jsonb,clock_timestamp(),clock_timestamp() FROM cost_events WHERE attempt_id=$1 AND event_type='RELEASED'`,
        [run.attemptId, uuid(2870080)],
      ),
    );
    await deny(async (tx) =>
      tx.query(
        "INSERT INTO repository_mutation_receipts(workspace_id,idempotency_key,operation,input_hash,result_codec,result_payload,result_hash,created_at) VALUES ($1,'blocked-receipt','hosted_prompt_response',$2,'repository-result/v1',$3::jsonb,$2,clock_timestamp())",
        [IDS.workspaceA, sha256("receipt"), JSON.stringify({ run_id: run.runId })],
      ),
    );
    // A durable claim is already sufficient to forbid redispatch, even without a provider response.
    await deny(async (tx) =>
      tx.query(
        `INSERT INTO hosted_prompt_batch_claims(id,account_id,workspace_id,run_id,task_id,attempt_id,outbox_id,
        batch_ordinal,provider_task_uuid,request_bytes,request_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,0,$8,'[]',$9)`,
        [
          uuid(2870050),
          IDS.accountA,
          IDS.workspaceA,
          run.runId,
          run.taskId,
          run.attemptId,
          run.outboxId,
          uuid(2870051),
          sha256("[]"),
        ],
      ),
    );
    await deny(async (tx) =>
      tx.query(
        `INSERT INTO hosted_prompt_scene_progress(id,account_id,workspace_id,run_id,scene_ordinal,scene_id,request_bytes,request_hash,response_bytes,response_hash,writer_output,compiled_prompt,input_tokens,output_tokens,reported_cost_micro_usd)
      VALUES ($1,$2,$3,$4,0,'scene-000','request',$5,'response',$6,'{}'::jsonb,'{}'::jsonb,1,2,0)`,
        [
          uuid(2870081),
          IDS.accountA,
          IDS.workspaceA,
          run.runId,
          sha256("request"),
          sha256("response"),
        ],
      ),
    );
    const oldCosts = (
      await executor.query(
        "SELECT row_to_json(c) AS row FROM cost_events c WHERE attempt_id=$1 ORDER BY sequence",
        [run.attemptId],
      )
    ).rows;
    const result = await executor.query(prepare, [JSON.stringify(retry)]);
    assert.equal(result.rows[0].prepared.created, true);
    assert.equal(result.rows[0].prepared.run_id, run.runId);
    const after = (await snapshot()).row;
    assert.equal(after.state, "DISPATCHING");
    assert.equal(after.task_id, retry.task_id);
    assert.equal(after.redispatch_count, 1);
    assert.equal(after.reserved_cost_micro_usd, 250000);
    assert.equal(after.batch_plan_hash, retry.batch_plan_hash);
    assert.deepEqual(
      (
        await executor.query(
          "SELECT row_to_json(c) AS row FROM cost_events c WHERE attempt_id=$1 ORDER BY sequence",
          [run.attemptId],
        )
      ).rows,
      oldCosts,
    );
    assert.equal(
      (await executor.query("SELECT required FROM generation_tasks WHERE id=$1", [run.taskId]))
        .rows[0].required,
      false,
    );
    assert.equal(
      (
        await executor.query(
          "SELECT count(*)::integer AS n FROM cost_events WHERE attempt_id=$1 AND event_type='RESERVED'",
          [retry.attempt_id],
        )
      ).rows[0].n,
      1,
    );
    // Repeated manual clicks cannot use the already-consumed terminal evidence again.
    await assert.rejects(
      executor.query(prepare, [JSON.stringify(retry)]),
      /input repair evidence is invalid/u,
    );
  });
});

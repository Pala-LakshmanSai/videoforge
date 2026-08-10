import assert from "node:assert/strict";
import test from "node:test";

import { IDS, seedWorkflow } from "./support/fixtures.mjs";
import {
  expectDatabaseError,
  FIXED_TIME,
  sha256,
  uuid,
  withMigratedDatabase,
} from "./support/pglite.mjs";

async function insertEvent(
  executor,
  { id, aggregateType, aggregateId, taskId, attemptId, sequence },
) {
  await executor.query(
    `INSERT INTO public.workflow_events (
       id, workspace_id, workflow_instance_id, task_id, attempt_id,
       aggregate_type, aggregate_id, sequence, kind,
       payload_contract_name, payload_contract_version, payload_hash, payload, occurred_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'RECONCILIATION_RECORDED',
               'workflow-event', 'v1', $9, '{}'::jsonb, $10)`,
    [
      id,
      IDS.workspaceA,
      IDS.workflowA,
      taskId,
      attemptId,
      aggregateType,
      aggregateId,
      sequence,
      sha256(`workflow-shape-${id}`),
      FIXED_TIME,
    ],
  );
}

test("workflow event aggregate discriminators require their exact reference shape", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedWorkflow(executor);
    const validEvents = [
      {
        id: uuid(1400),
        aggregateType: "WORKFLOW",
        aggregateId: IDS.workflowA,
        taskId: null,
        attemptId: null,
        sequence: 1,
      },
      {
        id: uuid(1401),
        aggregateType: "TASK",
        aggregateId: IDS.taskA,
        taskId: IDS.taskA,
        attemptId: null,
        sequence: 1,
      },
      {
        id: uuid(1402),
        aggregateType: "ATTEMPT",
        aggregateId: IDS.attemptA1,
        taskId: IDS.taskA,
        attemptId: IDS.attemptA1,
        sequence: 1,
      },
    ];
    for (const event of validEvents) {
      await insertEvent(executor, event);
    }

    const invalidEvents = [
      {
        id: uuid(1410),
        aggregateType: "WORKFLOW",
        aggregateId: IDS.workflowA,
        taskId: IDS.taskA,
        attemptId: null,
        sequence: 2,
      },
      {
        id: uuid(1411),
        aggregateType: "TASK",
        aggregateId: IDS.taskA,
        taskId: null,
        attemptId: null,
        sequence: 2,
      },
      {
        id: uuid(1412),
        aggregateType: "ATTEMPT",
        aggregateId: IDS.attemptA1,
        taskId: null,
        attemptId: null,
        sequence: 2,
      },
    ];
    for (const event of invalidEvents) {
      await expectDatabaseError(() => insertEvent(executor, event), "23514");
    }

    const stored = await executor.query(
      `SELECT aggregate_type, task_id, attempt_id
         FROM public.workflow_events
        WHERE workspace_id = $1
        ORDER BY aggregate_type`,
      [IDS.workspaceA],
    );
    assert.deepEqual(stored.rows, [
      { aggregate_type: "ATTEMPT", task_id: IDS.taskA, attempt_id: IDS.attemptA1 },
      { aggregate_type: "TASK", task_id: IDS.taskA, attempt_id: null },
      { aggregate_type: "WORKFLOW", task_id: null, attempt_id: null },
    ]);
  });
});

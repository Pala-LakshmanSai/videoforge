import assert from "node:assert/strict";
import test from "node:test";

import {
  HASHES,
  IDS,
  insertAttempt,
  seedAttempt,
  seedTask,
  seedWorkflow,
} from "./support/fixtures.mjs";
import {
  expectDatabaseError,
  FIXED_TIME,
  sha256,
  uuid,
  withMigratedDatabase,
} from "./support/pglite.mjs";

async function insertOutbox(executor, { id, dedupeKey }) {
  await executor.query(
    `INSERT INTO outbox (
       id, workspace_id, task_id, attempt_id, kind, state, dedupe_key,
       payload_contract_name, payload_contract_version, payload_hash, payload, available_at
     ) VALUES ($1, $2, $3, $4, 'DISPATCH', 'PENDING', $5,
               'worker-job-envelope', 'v1', $6, '{"transport":"none"}'::jsonb, $7)`,
    [id, IDS.workspaceA, IDS.taskA, IDS.attemptA1, dedupeKey, HASHES.payloadA1, FIXED_TIME],
  );
}

async function insertWorkflowEvent(executor, { id, sequence, kind, hash }) {
  await executor.query(
    `INSERT INTO workflow_events (
       id, workspace_id, workflow_instance_id, task_id, attempt_id,
       aggregate_type, aggregate_id, sequence, kind,
       payload_contract_name, payload_contract_version, payload_hash, payload, occurred_at
     ) VALUES ($1, $2, $3, $4, $5, 'ATTEMPT', $5, $6, $7,
               'workflow-event', 'v1', $8, '{"source":"owned-synthetic"}'::jsonb, $9)`,
    [id, IDS.workspaceA, IDS.workflowA, IDS.taskA, IDS.attemptA1, sequence, kind, hash, FIXED_TIME],
  );
}

async function insertCostEvent(
  executor,
  { id, sequence, amount, idempotencyKey, ownerId = IDS.revisionA },
) {
  await executor.query(
    `INSERT INTO cost_events (
       id, workspace_id, owner_type, owner_id, task_id, attempt_id,
       sequence, event_type, amount_micro_usd, idempotency_key, occurred_at
     ) VALUES ($1, $2, 'PROJECT_REVISION', $3, $4, $5, $6, 'RESERVED', $7, $8, $9)`,
    [
      id,
      IDS.workspaceA,
      ownerId,
      IDS.taskA,
      IDS.attemptA1,
      sequence,
      amount,
      idempotencyKey,
      FIXED_TIME,
    ],
  );
}

test("task, attempt, cost, and outbox keys make reservations idempotent", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedAttempt(executor);
    await expectDatabaseError(
      () =>
        executor.query(
          `INSERT INTO generation_tasks (
             id, workspace_id, owner_type, owner_id, project_revision_id, task_key, lane, state
           ) VALUES ($1, $2, 'PROJECT_REVISION', $3, $3, 'image:owned:001', 'IMAGE', 'READY')`,
          [IDS.taskASecond, IDS.workspaceA, IDS.revisionA],
        ),
      "23505",
    );
    await expectDatabaseError(
      () =>
        insertAttempt(executor, {
          id: IDS.attemptA2,
          ordinal: 2,
          idempotencyKey: "attempt:owned:001",
          inputHash: HASHES.attemptInputA2,
          claimHash: HASHES.claimA2,
        }),
      "23505",
    );

    await insertCostEvent(executor, {
      id: IDS.costA1,
      sequence: 1,
      amount: 0,
      idempotencyKey: "cost:owned:001",
    });
    await expectDatabaseError(
      () =>
        insertCostEvent(executor, {
          id: IDS.costA2,
          sequence: 2,
          amount: 0,
          idempotencyKey: "cost:owned:001",
        }),
      "23505",
    );

    await insertOutbox(executor, { id: IDS.outboxA1, dedupeKey: "dispatch:owned:001" });
    await expectDatabaseError(
      () => insertOutbox(executor, { id: IDS.outboxA2, dedupeKey: "dispatch:owned:001" }),
      "23505",
    );
  });
});

test("workflow and cost events are append-only, unique, and strictly monotonic", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedWorkflow(executor);
    await insertWorkflowEvent(executor, {
      id: IDS.eventA1,
      sequence: 1,
      kind: "ATTEMPT_CREATED",
      hash: HASHES.payloadA1,
    });
    await insertWorkflowEvent(executor, {
      id: IDS.eventA2,
      sequence: 3,
      kind: "DISPATCH_RECORDED",
      hash: HASHES.payloadA2,
    });
    await expectDatabaseError(
      () =>
        insertWorkflowEvent(executor, {
          id: IDS.eventA3,
          sequence: 2,
          kind: "DISPATCH_ACKNOWLEDGED",
          hash: sha256("late-event"),
        }),
      "23514",
    );
    await expectDatabaseError(
      () =>
        executor.query("UPDATE workflow_events SET payload = '{}'::jsonb WHERE id = $1", [
          IDS.eventA1,
        ]),
      "23514",
    );
    await expectDatabaseError(
      () => executor.query("DELETE FROM workflow_events WHERE id = $1", [IDS.eventA1]),
      "23514",
    );

    await insertCostEvent(executor, {
      id: IDS.costA1,
      sequence: 1,
      amount: 0,
      idempotencyKey: "cost:owned:001",
    });
    await insertCostEvent(executor, {
      id: IDS.costA2,
      sequence: 3,
      amount: 25,
      idempotencyKey: "cost:owned:003",
    });
    await expectDatabaseError(
      () =>
        insertCostEvent(executor, {
          id: uuid(941),
          sequence: 2,
          amount: 10,
          idempotencyKey: "cost:owned:002",
        }),
      "23514",
    );
    await expectDatabaseError(
      () =>
        executor.query("UPDATE cost_events SET amount_micro_usd = 99 WHERE id = $1", [IDS.costA1]),
      "23514",
    );
    await expectDatabaseError(
      () => executor.query("DELETE FROM cost_events WHERE id = $1", [IDS.costA1]),
      "23514",
    );
  });
});

test("cost ledger amounts are nonnegative and every event has a matching owner", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedAttempt(executor);
    await expectDatabaseError(
      () =>
        insertCostEvent(executor, {
          id: IDS.costA1,
          sequence: 1,
          amount: -1,
          idempotencyKey: "cost:negative",
        }),
      "23514",
    );
    await expectDatabaseError(
      () =>
        executor.query(
          `INSERT INTO cost_events (
             id, workspace_id, owner_type, owner_id, task_id, attempt_id,
             sequence, event_type, amount_micro_usd, idempotency_key, occurred_at
           ) VALUES ($1, $2, 'PROJECT_REVISION', NULL, $3, $4, 1, 'RESERVED', 0, 'cost:no-owner', $5)`,
          [IDS.costA1, IDS.workspaceA, IDS.taskA, IDS.attemptA1, FIXED_TIME],
        ),
      "23502",
    );
    await expectDatabaseError(
      () =>
        insertCostEvent(executor, {
          id: IDS.costA1,
          sequence: 1,
          amount: 0,
          idempotencyKey: "cost:wrong-owner",
          ownerId: IDS.revisionB,
        }),
      "23503",
    );
    await insertCostEvent(executor, {
      id: IDS.costA1,
      sequence: 1,
      amount: 0,
      idempotencyKey: "cost:valid-owner",
    });
    const stored = await executor.query(
      "SELECT owner_type, owner_id, amount_micro_usd::int AS amount FROM cost_events WHERE id = $1",
      [IDS.costA1],
    );
    assert.deepEqual(stored.rows[0], {
      owner_type: "PROJECT_REVISION",
      owner_id: IDS.revisionA,
      amount: 0,
    });
  });
});

test("one task has one accepted result while every duplicate attempt remains visible", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedTask(executor);
    await insertAttempt(executor, {
      id: IDS.attemptA1,
      ordinal: 1,
      idempotencyKey: "attempt:owned:001",
      state: "FAILED",
      disposition: "REJECTED",
    });
    await insertAttempt(executor, {
      id: IDS.attemptA2,
      ordinal: 2,
      idempotencyKey: "attempt:owned:002",
      state: "SUCCEEDED",
      outputAssetId: IDS.outputA1,
      disposition: "ACCEPTED",
      inputHash: HASHES.attemptInputA2,
      claimHash: HASHES.claimA2,
    });
    await insertAttempt(executor, {
      id: IDS.attemptA3,
      ordinal: 3,
      idempotencyKey: "attempt:owned:003",
      state: "SUCCEEDED",
      outputAssetId: IDS.outputA2,
      disposition: "REJECTED",
      inputHash: sha256("attempt-input-a-3"),
      claimHash: sha256("claim-a-3"),
    });
    await executor.query("UPDATE generation_tasks SET accepted_attempt_id = $1 WHERE id = $2", [
      IDS.attemptA2,
      IDS.taskA,
    ]);
    await expectDatabaseError(
      () =>
        executor.query("UPDATE attempts SET result_disposition = 'ACCEPTED' WHERE id = $1", [
          IDS.attemptA3,
        ]),
      "23505",
    );

    const attempts = await executor.query(
      `SELECT id, ordinal, state, result_disposition
         FROM attempts
        WHERE workspace_id = $1 AND task_id = $2
        ORDER BY ordinal`,
      [IDS.workspaceA, IDS.taskA],
    );
    assert.deepEqual(attempts.rows, [
      { id: IDS.attemptA1, ordinal: 1, state: "FAILED", result_disposition: "REJECTED" },
      { id: IDS.attemptA2, ordinal: 2, state: "SUCCEEDED", result_disposition: "ACCEPTED" },
      { id: IDS.attemptA3, ordinal: 3, state: "SUCCEEDED", result_disposition: "REJECTED" },
    ]);
    const task = await executor.query(
      "SELECT accepted_attempt_id FROM generation_tasks WHERE id = $1",
      [IDS.taskA],
    );
    assert.equal(task.rows[0].accepted_attempt_id, IDS.attemptA2);
  });
});

test("a failed unit-of-work transaction leaves no attempt, reservation, or outbox orphan", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedTask(executor);
    await assert.rejects(
      executor.transaction(async (transaction) => {
        await transaction.query(
          `INSERT INTO attempts (
             id, workspace_id, task_id, ordinal, idempotency_key, state,
             dispatch_state, claim_state, execution_profile_id,
             execution_claim_token_hash, input_hash
           ) VALUES ($1, $2, $3, 1, 'rollback:attempt', 'CREATED',
                     'NOT_SENT', 'UNCLAIMED', $4, $5, $6)`,
          [
            IDS.rollbackAttempt,
            IDS.workspaceA,
            IDS.taskA,
            IDS.executionProfileA,
            sha256("rollback-claim"),
            sha256("rollback-input"),
          ],
        );
        await transaction.query(
          `INSERT INTO cost_events (
             id, workspace_id, owner_type, owner_id, task_id, attempt_id,
             sequence, event_type, amount_micro_usd, idempotency_key, occurred_at
           ) VALUES ($1, $2, 'PROJECT_REVISION', $3, $4, $5,
                     1, 'RESERVED', 50, 'rollback:cost', $6)`,
          [
            IDS.rollbackCost,
            IDS.workspaceA,
            IDS.revisionA,
            IDS.taskA,
            IDS.rollbackAttempt,
            FIXED_TIME,
          ],
        );
        await transaction.query(
          `INSERT INTO outbox (
             id, workspace_id, task_id, attempt_id, kind, state, dedupe_key,
             payload_contract_name, payload_contract_version, payload_hash, payload, available_at
           ) VALUES ($1, $2, $3, $4, 'DISPATCH', 'PENDING', 'rollback:dispatch',
                     'worker-job-envelope', 'v1', $5, '{}'::jsonb, $6)`,
          [
            IDS.rollbackOutbox,
            IDS.workspaceA,
            IDS.taskA,
            IDS.rollbackAttempt,
            sha256("rollback-payload"),
            FIXED_TIME,
          ],
        );
        throw new Error("owned synthetic rollback");
      }),
      /owned synthetic rollback/,
    );
    const orphans = await executor.query(
      `SELECT
         (SELECT count(*)::int FROM attempts WHERE id = $1) AS attempts,
         (SELECT count(*)::int FROM cost_events WHERE id = $2) AS costs,
         (SELECT count(*)::int FROM outbox WHERE id = $3) AS outbox`,
      [IDS.rollbackAttempt, IDS.rollbackCost, IDS.rollbackOutbox],
    );
    assert.deepEqual(orphans.rows[0], { attempts: 0, costs: 0, outbox: 0 });
  });
});

test("archive changes catalog visibility without destroying revision, attempt, or asset lineage", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedTask(executor);
    await insertAttempt(executor, {
      id: IDS.attemptA1,
      ordinal: 1,
      idempotencyKey: "attempt:owned:001",
      state: "SUCCEEDED",
      outputAssetId: IDS.outputA1,
      disposition: "ACCEPTED",
    });
    await executor.query("UPDATE generation_tasks SET accepted_attempt_id = $1 WHERE id = $2", [
      IDS.attemptA1,
      IDS.taskA,
    ]);
    await executor.query("UPDATE assets SET source_attempt_id = $1 WHERE id = $2", [
      IDS.attemptA1,
      IDS.outputA1,
    ]);

    await executor.query(
      "UPDATE avatar_profiles SET status = 'ARCHIVED', archived_at = $1 WHERE id = $2",
      [FIXED_TIME, IDS.avatarProfileA],
    );
    await executor.query(
      "UPDATE image_styles SET status = 'ARCHIVED', archived_at = $1 WHERE id = $2",
      [FIXED_TIME, IDS.styleA],
    );
    await executor.query(
      "UPDATE projects SET status = 'ARCHIVED', archived_at = $1 WHERE id = $2",
      [FIXED_TIME, IDS.projectA],
    );
    await executor.query(
      "UPDATE assets SET state = 'ARCHIVED', archived_at = $1 WHERE id IN ($2, $3)",
      [FIXED_TIME, IDS.voiceoverA, IDS.outputA1],
    );

    const lineage = await executor.query(
      `SELECT project.status AS project_status,
              revision.status AS revision_status,
              avatar.status AS avatar_status,
              avatar_version.state AS avatar_version_state,
              style.status AS style_status,
              style_version.state AS style_version_state,
              attempt.result_disposition,
              output.state AS output_state,
              output.source_attempt_id
         FROM project_revisions revision
         JOIN projects project
           ON project.workspace_id = revision.workspace_id AND project.id = revision.project_id
         JOIN avatar_profiles avatar
           ON avatar.workspace_id = revision.workspace_id AND avatar.id = revision.avatar_profile_id
         JOIN avatar_profile_versions avatar_version
           ON avatar_version.workspace_id = revision.workspace_id AND avatar_version.id = revision.avatar_profile_version_id
         JOIN image_styles style
           ON style.workspace_id = revision.workspace_id AND style.id = revision.image_style_id
         JOIN image_style_versions style_version
           ON style_version.workspace_id = revision.workspace_id AND style_version.id = revision.image_style_version_id
         JOIN generation_tasks task
           ON task.workspace_id = revision.workspace_id AND task.project_revision_id = revision.id
         JOIN attempts attempt
           ON attempt.workspace_id = task.workspace_id AND attempt.id = task.accepted_attempt_id
         JOIN assets output
           ON output.workspace_id = attempt.workspace_id AND output.id = attempt.output_asset_id
        WHERE revision.workspace_id = $1 AND revision.id = $2`,
      [IDS.workspaceA, IDS.revisionA],
    );
    assert.deepEqual(lineage.rows[0], {
      project_status: "ARCHIVED",
      revision_status: "LOCKED",
      avatar_status: "ARCHIVED",
      avatar_version_state: "READY",
      style_status: "ARCHIVED",
      style_version_state: "PUBLISHED",
      result_disposition: "ACCEPTED",
      output_state: "ARCHIVED",
      source_attempt_id: IDS.attemptA1,
    });
  });
});

import assert from "node:assert/strict";
import test from "node:test";

import { IDS, insertAttempt, seedWorkflow } from "./support/fixtures.mjs";
import {
  expectDatabaseError,
  FIXED_TIME,
  sha256,
  uuid,
  withMigratedDatabase,
} from "./support/pglite.mjs";

const RECEIPT_ID = uuid(901);
const EVENT_ID = uuid(911);
const NONCE_HASH = sha256("callback-nonce-001");
const PAYLOAD_HASH = sha256("callback-payload-001");

async function insertCallbackEvent(
  executor,
  { id = EVENT_ID, attemptId = IDS.attemptA1, sequence = 1, payloadHash = PAYLOAD_HASH } = {},
) {
  return executor.query(
    `INSERT INTO workflow_events (
       id, workspace_id, workflow_instance_id, task_id, attempt_id,
       aggregate_type, aggregate_id, sequence, kind,
       payload_contract_name, payload_contract_version, payload_hash, payload, occurred_at
     ) VALUES ($1, $2, $3, $4, $5, 'ATTEMPT', $5, $6, 'DISPATCH_ACKNOWLEDGED',
               'callback-event', 'v1', $7, '{"source":"owned-callback"}'::jsonb, $8)`,
    [id, IDS.workspaceA, IDS.workflowA, IDS.taskA, attemptId, sequence, payloadHash, FIXED_TIME],
  );
}

async function insertReceipt(
  executor,
  {
    id = RECEIPT_ID,
    workspaceId = IDS.workspaceA,
    taskId = IDS.taskA,
    attemptId = IDS.attemptA1,
    workflowEventId = EVENT_ID,
    nonceHash = NONCE_HASH,
    payloadHash = PAYLOAD_HASH,
  } = {},
) {
  return executor.query(
    `INSERT INTO callback_receipts (
       id, workspace_id, task_id, attempt_id, workflow_event_id, callback_kind,
       nonce_hash, payload_hash, signature_key_id, signed_at, expires_at, received_at
     ) VALUES ($1, $2, $3, $4, $5, 'WORKER_PROGRESS', $6, $7, 'local-test-key-v1',
               $8, $9::timestamptz + interval '5 minutes', $9)`,
    [
      id,
      workspaceId,
      taskId,
      attemptId,
      workflowEventId,
      nonceHash,
      payloadHash,
      FIXED_TIME,
      FIXED_TIME,
    ],
  );
}

test("callback nonces are workspace-scoped, attempt-bound, and replay-safe", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedWorkflow(executor);
    await insertCallbackEvent(executor);
    await insertReceipt(executor);

    await insertCallbackEvent(executor, {
      id: uuid(912),
      sequence: 2,
      payloadHash: sha256("changed-replay-payload"),
    });

    await expectDatabaseError(
      () =>
        insertReceipt(executor, {
          id: uuid(902),
          workflowEventId: uuid(912),
          nonceHash: NONCE_HASH,
          payloadHash: sha256("changed-replay-payload"),
        }),
      "23505",
    );

    await insertCallbackEvent(executor, {
      id: uuid(913),
      sequence: 3,
      payloadHash: sha256("unknown-attempt-callback"),
    });
    await expectDatabaseError(
      () =>
        insertReceipt(executor, {
          id: uuid(903),
          taskId: IDS.taskA,
          attemptId: IDS.attemptA2,
          workflowEventId: uuid(913),
          nonceHash: sha256("unknown-attempt-nonce"),
        }),
      "23503",
    );

    const stored = await executor.query(
      `SELECT workspace_id, task_id, attempt_id, workflow_event_id, nonce_hash, payload_hash
         FROM callback_receipts
        WHERE id = $1`,
      [RECEIPT_ID],
    );
    assert.deepEqual(stored.rows, [
      {
        workspace_id: IDS.workspaceA,
        task_id: IDS.taskA,
        attempt_id: IDS.attemptA1,
        workflow_event_id: EVENT_ID,
        nonce_hash: NONCE_HASH,
        payload_hash: PAYLOAD_HASH,
      },
    ]);
  });
});

test("callback receipt and state mutation share rollback fate", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedWorkflow(executor);

    await assert.rejects(() =>
      executor.transaction(async (transaction) => {
        await insertReceipt(transaction);
        await insertCallbackEvent(transaction);
        throw new Error("synthetic callback mutation failure");
      }),
    );

    const afterRollback = await executor.query(
      "SELECT count(*)::int AS rows FROM callback_receipts WHERE nonce_hash = $1",
      [NONCE_HASH],
    );
    assert.deepEqual(afterRollback.rows, [{ rows: 0 }]);

    await executor.transaction(async (transaction) => {
      await insertReceipt(transaction);
      await insertCallbackEvent(transaction);
    });
    const afterRetry = await executor.query(
      "SELECT count(*)::int AS rows FROM callback_receipts WHERE nonce_hash = $1",
      [NONCE_HASH],
    );
    assert.deepEqual(afterRetry.rows, [{ rows: 1 }]);
  });
});

test("callback receipts bind the exact event attempt and authenticated payload hash", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedWorkflow(executor);
    await insertAttempt(executor, {
      id: IDS.attemptA2,
      ordinal: 2,
      idempotencyKey: "attempt:owned:002",
      inputHash: sha256("attempt-input-002"),
      claimHash: sha256("attempt-claim-002"),
    });

    const otherAttemptEventId = uuid(914);
    await insertCallbackEvent(executor, {
      id: otherAttemptEventId,
      attemptId: IDS.attemptA2,
      payloadHash: PAYLOAD_HASH,
    });
    await expectDatabaseError(
      () =>
        insertReceipt(executor, {
          id: uuid(904),
          attemptId: IDS.attemptA1,
          workflowEventId: otherAttemptEventId,
          nonceHash: sha256("callback-nonce-wrong-attempt"),
          payloadHash: PAYLOAD_HASH,
        }),
      "23503",
    );

    const exactAttemptEventId = uuid(915);
    await insertCallbackEvent(executor, {
      id: exactAttemptEventId,
      attemptId: IDS.attemptA1,
      sequence: 2,
      payloadHash: PAYLOAD_HASH,
    });
    await expectDatabaseError(
      () =>
        insertReceipt(executor, {
          id: uuid(905),
          attemptId: IDS.attemptA1,
          workflowEventId: exactAttemptEventId,
          nonceHash: sha256("callback-nonce-wrong-payload"),
          payloadHash: sha256("different-authenticated-payload"),
        }),
      "23503",
    );

    const receipts = await executor.query(
      "SELECT count(*)::int AS rows FROM callback_receipts",
    );
    assert.deepEqual(receipts.rows, [{ rows: 0 }]);
  });
});

test("callback receipts are immutable audit evidence", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedWorkflow(executor);
    await insertCallbackEvent(executor);
    await insertReceipt(executor);

    await expectDatabaseError(
      () =>
        executor.query("UPDATE callback_receipts SET payload_hash = $1 WHERE id = $2", [
          sha256("mutated-callback-payload"),
          RECEIPT_ID,
        ]),
      "23514",
    );
    await expectDatabaseError(
      () => executor.query("DELETE FROM callback_receipts WHERE id = $1", [RECEIPT_ID]),
      "23514",
    );
  });
});

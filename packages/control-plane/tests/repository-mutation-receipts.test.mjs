import assert from "node:assert/strict";
import test from "node:test";

import { IDS, seedIdentity } from "./support/fixtures.mjs";
import { expectDatabaseError, sha256, withMigratedDatabase } from "./support/pglite.mjs";

async function insertReceipt(
  executor,
  {
    workspaceId = IDS.workspaceA,
    idempotencyKey = "repository:test:mutation:1",
    operation = "test_mutation",
    inputHash = sha256("repository-test-input"),
    resultHash = sha256("repository-test-result"),
  } = {},
) {
  return executor.query(
    `INSERT INTO repository_mutation_receipts (
       workspace_id, idempotency_key, operation, input_hash,
       result_codec, result_payload, result_hash
     ) VALUES ($1, $2, $3, $4, 'repository-result/v1', $5::jsonb, $6)`,
    [workspaceId, idempotencyKey, operation, inputHash, '{"value":{"id":"owned"}}', resultHash],
  );
}

test("repository mutation receipts are workspace-scoped exact-key authorities", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedIdentity(executor);
    await insertReceipt(executor);

    await expectDatabaseError(() => insertReceipt(executor), "23505");
    await expectDatabaseError(
      () => insertReceipt(executor, { operation: "different_operation" }),
      "23505",
    );
    await expectDatabaseError(
      () => insertReceipt(executor, { inputHash: sha256("changed-input") }),
      "23505",
    );

    await insertReceipt(executor, { accountId: IDS.accountB, workspaceId: IDS.workspaceB });
    const rows = await executor.query(
      `SELECT workspace_id, idempotency_key, operation, input_hash, result_codec, result_hash
         FROM repository_mutation_receipts
        ORDER BY workspace_id`,
    );
    assert.equal(rows.rows.length, 2);
    assert.deepEqual(
      rows.rows.map((row) => row.idempotency_key),
      ["repository:test:mutation:1", "repository:test:mutation:1"],
    );
  });
});

test("repository mutation receipts are immutable and shape checked", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedIdentity(executor);
    await insertReceipt(executor);

    await expectDatabaseError(
      () =>
        executor.query(
          "UPDATE repository_mutation_receipts SET input_hash = $1 WHERE workspace_id = $2 AND idempotency_key = $3",
          [sha256("mutated-input"), IDS.workspaceA, "repository:test:mutation:1"],
        ),
      "23514",
    );
    await expectDatabaseError(
      () =>
        executor.query(
          "DELETE FROM repository_mutation_receipts WHERE workspace_id = $1 AND idempotency_key = $2",
          [IDS.workspaceA, "repository:test:mutation:1"],
        ),
      "23514",
    );
    await expectDatabaseError(
      () =>
        insertReceipt(executor, {
          idempotencyKey: "repository:test:invalid-operation",
          operation: "INVALID-OPERATION",
        }),
      "23514",
    );
  });
});

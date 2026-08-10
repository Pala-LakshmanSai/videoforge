import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  MetadataSnapshotError,
  RELATIONAL_TABLE_NAMES,
  exportMetadataSnapshot,
  restoreMetadataSnapshot,
  serializeMetadataSnapshot,
} from "../dist/src/index.js";
import { createPGliteControlPlaneRepositories } from "../dist/src/adapters/index.js";
import { DurableRecoveryCoordinator } from "../dist/src/recovery/index.js";
import { HASHES, IDS, seedLockedProjects } from "./support/fixtures.mjs";
import { createMigratedDatabase, FIXED_TIME, sha256, uuid } from "./support/pglite.mjs";

const SCOPE = Object.freeze({ workspaceId: IDS.workspaceA });
const TASK_ID = uuid(40_001);
const ATTEMPT_ID = uuid(40_002);
const COST_ID = uuid(40_003);
const OUTBOX_ID = uuid(40_004);
const CHILD_ATTEMPT_ID = uuid(40_005);
const WORKFLOW_ID = uuid(40_006);
const WORKFLOW_EVENT_ID = uuid(40_007);

function ok(result, label) {
  assert.equal(result.ok, true, `${label} failed`);
  return result.value;
}

function reservation(payload = { taskId: TASK_ID, attemptId: ATTEMPT_ID, provider: "none" }) {
  return {
    idempotencyKey: "restore-smoke:attempt:1",
    task: {
      taskId: TASK_ID,
      owner: {
        ownerType: "PROJECT_REVISION",
        ownerId: IDS.revisionA,
        projectRevisionId: IDS.revisionA,
      },
      taskKey: "restore-smoke:image:1",
      lane: "IMAGE",
      initialState: "READY",
      required: true,
      dependsOn: [],
    },
    attempt: {
      attemptId: ATTEMPT_ID,
      ordinal: 1,
      idempotencyKey: "restore-smoke:attempt:1",
      executionProfileId: IDS.executionProfileA,
      executionClaimTokenHash: sha256("restore-smoke-claim"),
      inputHash: sha256("restore-smoke-input"),
      parentAttemptId: null,
      fallbackReason: null,
    },
    costReservation: {
      costEventId: COST_ID,
      sequence: 1,
      amountMicroUsd: 5_000n,
      idempotencyKey: "restore-smoke:cost:reserved",
      details: { provider: "none", source: "metadata-restore-smoke" },
      occurredAt: FIXED_TIME,
    },
    dispatchOutbox: {
      outboxId: OUTBOX_ID,
      dedupeKey: "restore-smoke:dispatch",
      payloadContractName: "worker-job-envelope",
      payloadContractVersion: "v1",
      payloadHash: sha256("restore-smoke-payload"),
      payload,
      availableAt: FIXED_TIME,
    },
  };
}

async function seedRecoveryMetadata(executor, payload) {
  await seedLockedProjects(executor);
  const repositories = createPGliteControlPlaneRepositories(executor);
  ok(
    await repositories.execution.reserveTaskAttempt(SCOPE, reservation(payload)),
    "task reservation",
  );
  await executor.transaction(async (transaction) => {
    await transaction.query(
      `UPDATE assets
          SET project_id = $1, project_revision_id = $2, source_attempt_id = $3
        WHERE workspace_id = $4 AND id = $5`,
      [IDS.projectA, IDS.revisionA, ATTEMPT_ID, IDS.workspaceA, IDS.outputA1],
    );
    await transaction.query(
      `UPDATE attempts
          SET state = 'SUCCEEDED', output_asset_id = $1,
              result_disposition = 'ACCEPTED', finished_at = $2
        WHERE workspace_id = $3 AND id = $4`,
      [IDS.outputA1, FIXED_TIME, IDS.workspaceA, ATTEMPT_ID],
    );
    await transaction.query(
      `INSERT INTO attempts (
         id, workspace_id, task_id, ordinal, idempotency_key, state,
         dispatch_state, claim_state, execution_profile_id, execution_claim_token_hash,
         input_hash, result_disposition, parent_attempt_id, fallback_reason, finished_at
       ) VALUES (
         $1, $2, $3, 2, 'restore-smoke:attempt:2', 'FAILED',
         'NOT_SENT', 'UNCLAIMED', $4, $5, $6, 'REJECTED', $7, 'RESTORE_LINEAGE', $8
       )`,
      [
        CHILD_ATTEMPT_ID,
        IDS.workspaceA,
        TASK_ID,
        IDS.executionProfileA,
        sha256("restore-smoke-child-claim"),
        sha256("restore-smoke-child-input"),
        ATTEMPT_ID,
        FIXED_TIME,
      ],
    );
    await transaction.query(
      `UPDATE generation_tasks
          SET state = 'COMPLETE', accepted_attempt_id = $1, finished_at = $2
        WHERE workspace_id = $3 AND id = $4`,
      [ATTEMPT_ID, FIXED_TIME, IDS.workspaceA, TASK_ID],
    );
    await transaction.query(
      `UPDATE outbox
          SET state = 'DEAD_LETTER', updated_at = $1
        WHERE workspace_id = $2 AND id = $3`,
      [FIXED_TIME, IDS.workspaceA, OUTBOX_ID],
    );
  });
  await executor.query(
    `INSERT INTO workflow_instances (
       id, workspace_id, owner_type, owner_id, task_id, workflow_type,
       state, external_system, idempotency_key, finished_at
     ) VALUES (
       $1, $2, 'PROJECT_REVISION', $3, $4, 'GENERATE',
       'READY_FOR_REVIEW', 'LOCAL', 'restore-smoke:workflow', $5
     )`,
    [WORKFLOW_ID, IDS.workspaceA, IDS.revisionA, TASK_ID, FIXED_TIME],
  );
  ok(
    await repositories.events.appendWorkflowEvent(SCOPE, {
      idempotencyKey: "restore-smoke:event:1",
      eventId: WORKFLOW_EVENT_ID,
      workflowInstanceId: WORKFLOW_ID,
      aggregate: {
        aggregateType: "ATTEMPT",
        aggregateId: ATTEMPT_ID,
        taskId: TASK_ID,
        attemptId: ATTEMPT_ID,
      },
      sequence: 1,
      kind: "ATTEMPT_SUCCEEDED",
      payloadContractName: "workflow-event",
      payloadContractVersion: "v1",
      payloadHash: sha256("restore-smoke-event"),
      payload: { state: "SUCCEEDED", provider: "none" },
      occurredAt: FIXED_TIME,
    }),
    "workflow event",
  );
}

function expectSnapshotError(error, code) {
  assert.ok(error instanceof MetadataSnapshotError);
  assert.equal(error.code, code);
  assert.ok(error.recovery.length > 20);
  return true;
}

async function totalDataRows(executor) {
  let total = 0;
  for (const tableName of RELATIONAL_TABLE_NAMES) {
    const result = await executor.query(
      `SELECT count(*)::text AS count FROM public."${tableName}"`,
    );
    total += Number(result.rows[0].count);
  }
  return total;
}

test("the same metadata snapshot restores exactly, resumes idempotently, and remains repository/recovery capable", async () => {
  const destinationRoot = await mkdtemp(join(tmpdir(), "videoforge-metadata-restore-"));
  const destinationData = join(destinationRoot, "pgdata");
  const source = await createMigratedDatabase();
  let destination = await createMigratedDatabase(destinationData);
  try {
    await seedRecoveryMetadata(source.executor);
    const first = await exportMetadataSnapshot(source.executor);
    const second = await exportMetadataSnapshot(source.executor);
    const serialized = serializeMetadataSnapshot(first);
    assert.equal(serializeMetadataSnapshot(second), serialized);
    assert.equal(second.snapshotSha256, first.snapshotSha256);
    assert.equal(first.migrationLedger.length, 7);
    assert.equal(first.tables.length, RELATIONAL_TABLE_NAMES.length);
    for (const requiredTable of [
      "memberships",
      "avatar_profile_versions",
      "project_revisions",
      "assets",
      "generation_tasks",
      "attempts",
      "cost_events",
      "outbox",
      "workflow_instances",
      "workflow_events",
    ]) {
      assert.ok(first.tables.find((table) => table.tableName === requiredTable).rowCount > 0);
    }

    const expectedRows = first.tables.reduce((total, table) => total + table.rowCount, 0);
    assert.deepEqual(await restoreMetadataSnapshot(destination.executor, serialized), {
      snapshotSha256: first.snapshotSha256,
      restoredRows: expectedRows,
      alreadyRestored: false,
    });
    assert.equal(
      serializeMetadataSnapshot(await exportMetadataSnapshot(destination.executor)),
      serialized,
    );
    assert.deepEqual(await restoreMetadataSnapshot(destination.executor, serialized), {
      snapshotSha256: first.snapshotSha256,
      restoredRows: 0,
      alreadyRestored: true,
    });

    await destination.database.close();
    destination = await createMigratedDatabase(destinationData);
    const repositories = createPGliteControlPlaneRepositories(destination.executor);
    const revision = await repositories.projects.resolveExactRevision(SCOPE, {
      projectId: IDS.projectA,
      revisionId: IDS.revisionA,
    });
    assert.equal(revision.ok, true);
    assert.equal(revision.value.revisionConfig.canonicalDocumentSha256, HASHES.revisionA);
    const recovery = new DurableRecoveryCoordinator(repositories, {
      deliverNext: async () => {
        throw new Error("post-restore inspection must not dispatch");
      },
    });
    const recovered = await recovery.inspect(SCOPE, TASK_ID);
    assert.equal(recovered.ok, true);
    assert.equal(recovered.value.task.acceptedAttemptId, ATTEMPT_ID);
    assert.equal(recovered.value.attemptCount, 2);
    assert.equal(recovered.value.acceptedAttemptCount, 1);
    assert.equal(recovered.value.deadLetterOutboxCount, 1);
    assert.equal(recovered.value.cost.reservedMicroUsd, 5_000n);
  } finally {
    await source.database.close();
    await destination.database.close();
    await rm(destinationRoot, { recursive: true, force: true });
  }
});

test("truncated, reordered, incompatible, and tampered snapshots fail before changing a clean destination", async () => {
  const source = await createMigratedDatabase();
  const destination = await createMigratedDatabase();
  try {
    await seedRecoveryMetadata(source.executor);
    const serialized = serializeMetadataSnapshot(await exportMetadataSnapshot(source.executor));
    const variants = [];

    variants.push({
      code: "METADATA_SNAPSHOT_INVALID",
      serialized: serialized.slice(0, -1),
    });

    const incompatible = JSON.parse(serialized);
    incompatible.schemaVersion = "videoforge.metadata-snapshot/v999";
    variants.push({
      code: "METADATA_SNAPSHOT_VERSION_UNSUPPORTED",
      serialized: JSON.stringify(incompatible),
    });

    const incompatibleLedger = JSON.parse(serialized);
    incompatibleLedger.migrationLedger[0].sha256 = sha256("incompatible-migration");
    variants.push({
      code: "METADATA_SNAPSHOT_MIGRATION_INCOMPATIBLE",
      serialized: JSON.stringify(incompatibleLedger),
    });

    const reordered = JSON.parse(serialized);
    [reordered.tables[0], reordered.tables[1]] = [reordered.tables[1], reordered.tables[0]];
    variants.push({
      code: "METADATA_SNAPSHOT_TABLE_ORDER_INVALID",
      serialized: JSON.stringify(reordered),
    });

    const tampered = JSON.parse(serialized);
    const projectTable = tampered.tables.find((table) => table.tableName === "projects");
    projectTable.rows[0] = projectTable.rows[0].replace("Owned Project", "Altered Project");
    variants.push({
      code: "METADATA_SNAPSHOT_CHECKSUM_MISMATCH",
      serialized: JSON.stringify(tampered),
    });

    for (const variant of variants) {
      await assert.rejects(
        restoreMetadataSnapshot(destination.executor, variant.serialized),
        (error) => expectSnapshotError(error, variant.code),
      );
      assert.equal(await totalDataRows(destination.executor), 0);
    }
  } finally {
    await source.database.close();
    await destination.database.close();
  }
});

test("an injected partial restore failure rolls the destination transaction back and the exact retry succeeds", async () => {
  const source = await createMigratedDatabase();
  const destination = await createMigratedDatabase();
  try {
    await seedRecoveryMetadata(source.executor);
    const snapshot = await exportMetadataSnapshot(source.executor);
    const serialized = serializeMetadataSnapshot(snapshot);
    let injected = false;
    const failingDatabase = {
      execute: (sql) => destination.executor.execute(sql),
      query: (sql, parameters) => destination.executor.query(sql, parameters),
      transaction: (work) =>
        destination.executor.transaction((transaction) =>
          work({
            execute: (sql) => transaction.execute(sql),
            query: (sql, parameters) => {
              if (!injected && sql.includes('INSERT INTO public."project_revisions"')) {
                injected = true;
                throw new Error("injected restore interruption");
              }
              return transaction.query(sql, parameters);
            },
          }),
        ),
    };
    await assert.rejects(restoreMetadataSnapshot(failingDatabase, serialized), (error) =>
      expectSnapshotError(error, "METADATA_RESTORE_FAILED"),
    );
    assert.equal(injected, true);
    assert.equal(await totalDataRows(destination.executor), 0);
    const retried = await restoreMetadataSnapshot(destination.executor, serialized);
    assert.equal(retried.snapshotSha256, snapshot.snapshotSha256);
    assert.equal(retried.alreadyRestored, false);
  } finally {
    await source.database.close();
    await destination.database.close();
  }
});

test("secret-shaped outbox payloads fail closed instead of entering metadata backup bytes", async () => {
  const source = await createMigratedDatabase();
  try {
    await seedRecoveryMetadata(source.executor, {
      taskId: TASK_ID,
      attemptId: ATTEMPT_ID,
      callback_token: "synthetic-raw-secret-that-must-not-be-exported",
    });
    await assert.rejects(exportMetadataSnapshot(source.executor), (error) =>
      expectSnapshotError(error, "METADATA_SECRET_BYTES_FORBIDDEN"),
    );
  } finally {
    await source.database.close();
  }
});

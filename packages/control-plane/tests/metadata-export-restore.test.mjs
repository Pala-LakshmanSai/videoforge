import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  MetadataSnapshotError,
  MIGRATION_MANIFEST,
  RELATIONAL_TABLE_NAMES,
  exportMetadataSnapshot,
  restoreMetadataSnapshot,
  serializeMetadataSnapshot,
} from "../dist/src/index.js";
import { createPGliteControlPlaneRepositories } from "../dist/src/adapters/index.js";
import { DurableRecoveryCoordinator } from "../dist/src/recovery/index.js";
import { HASHES, IDS, seedLockedProjects } from "./support/fixtures.mjs";
import { createMigratedDatabase, FIXED_TIME, sha256, uuid } from "./support/pglite.mjs";

const SCOPE = Object.freeze({ accountId: IDS.accountA, workspaceId: IDS.workspaceA });
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

async function seedFootageMetadata(executor) {
  const requestId = uuid(40_009),
    jobId = uuid(40_010),
    claimId = uuid(40_011);
  await executor.transaction(async (transaction) => {
    await transaction.query("SELECT set_config('videoforge.account_id',$1,true)", [IDS.accountA]);
    const selections = [
      {
        segmentId: "restore-video-scene",
        sourceTaskKey: "restore-smoke:image:1",
        videoFrameCount: 150,
        durationSeconds: 5.1,
      },
    ];
    await transaction.query(
      `INSERT INTO hosted_video_plans(account_id,workspace_id,project_revision_id,coverage_percent,replacement_policy,selections,selection_sha256,planned_at)
      VALUES($1,$2,$3,75,'WHOLE_SCENE_V2',$4::jsonb,'sha256:'||encode(sha256(convert_to(videoforge_canonical_jsonb($4::jsonb),'UTF8')),'hex'),$5)`,
      [IDS.accountA, IDS.workspaceA, IDS.revisionA, JSON.stringify(selections), FIXED_TIME],
    );
    await transaction.query(
      `INSERT INTO generation_requests(id,account_id,workspace_id,project_id,project_revision_id,created_by_user_id,state,queue_order,available_at,idempotency_key,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,'WAITING',1,$7,'restore-smoke:video-request',$7,$7)`,
      [requestId, IDS.accountA, IDS.workspaceA, IDS.projectA, IDS.revisionA, IDS.userA, FIXED_TIME],
    );
    await transaction.query(
      `INSERT INTO hosted_video_jobs(id,account_id,workspace_id,project_id,project_revision_id,generation_request_id,segment_id,source_task_key,video_frame_count,duration_seconds,state,claim_id,input_manifest,input_sha256,output_object_key,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,'restore-video-scene','restore-smoke:image:1',150,5.1,'UNKNOWN_NO_RETRY',$7,$8::jsonb,$9,$10,$11,$11)`,
      [
        jobId,
        IDS.accountA,
        IDS.workspaceA,
        IDS.projectA,
        IDS.revisionA,
        requestId,
        claimId,
        JSON.stringify({ taskUUID: jobId }),
        sha256("restore-smoke:video-input"),
        `tenant/${IDS.accountA}/workspace/${IDS.workspaceA}/project/${IDS.projectA}/revision/${IDS.revisionA}/lane/scene-video/job/${jobId}/artifact/${jobId}`,
        FIXED_TIME,
      ],
    );
    await transaction.query("SELECT set_config('videoforge.account_id',$1,true)", [IDS.accountB]);
    await transaction.query(
      "INSERT INTO hosted_video_plans(account_id,workspace_id,project_revision_id,created_at) VALUES($1,$2,$3,$4)",
      [IDS.accountB, IDS.workspaceB, IDS.revisionB, FIXED_TIME],
    );
  });
}

async function footageMetadata(executor) {
  const result = await executor.query(`SELECT jsonb_build_object(
    'plans',(SELECT jsonb_agg(to_jsonb(plan) ORDER BY project_revision_id) FROM hosted_video_plans plan),
    'jobs',(SELECT jsonb_agg(to_jsonb(job) ORDER BY id) FROM hosted_video_jobs job)) AS value`);
  return result.rows[0].value;
}

function expectSnapshotError(error, code) {
  assert.ok(error instanceof MetadataSnapshotError);
  assert.equal(error.code, code);
  assert.ok(error.recovery.length > 20);
  return true;
}

// Migrations seed reserved scopes and the fair-capacity singleton into every migrated database, so
// these rows are schema baseline rather than evidence that a restore destination contains tenants.
const RESERVED_SCOPE_ROW_FILTER = Object.freeze({
  accounts:
    " WHERE id NOT IN ('ffffffff-ffff-4fff-8fff-000000000001'," +
    "'ffffffff-ffff-4fff-8fff-000000000002')",
  workspaces:
    " WHERE id NOT IN ('ffffffff-ffff-4fff-8fff-000000000011'," +
    "'ffffffff-ffff-4fff-8fff-000000000012')",
  users: " WHERE id <> 'ffffffff-ffff-4fff-8fff-000000000021'",
  memberships: " WHERE id <> 'ffffffff-ffff-4fff-8fff-000000000031'",
  global_generation_capacity: " WHERE false",
  ...Object.fromEntries(
    [
      "assets",
      "avatar_profiles",
      "avatar_profile_versions",
      "avatar_profile_assets",
      "avatar_compatibility_assessments",
      "image_styles",
      "image_style_versions",
      "image_style_references",
    ].map((table) => [table, " WHERE account_id <> 'ffffffff-ffff-4fff-8fff-000000000001'"]),
  ),
});

async function totalDataRows(executor) {
  let total = 0;
  for (const tableName of RELATIONAL_TABLE_NAMES) {
    const result = await executor.query(
      `SELECT count(*)::text AS count FROM public."${tableName}"` +
        (RESERVED_SCOPE_ROW_FILTER[tableName] ?? ""),
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
    await seedFootageMetadata(source.executor);
    const originalFootage = await footageMetadata(source.executor);
    await source.executor.query(
      `INSERT INTO public.media_worker_connect_commands
         (id,account_id,workspace_id,token_sha256,expires_at)
       VALUES ($1,$2,$3,$4,now()+interval '1 hour')`,
      [uuid(40_008), IDS.accountA, IDS.workspaceA, sha256("fixture-connect-authority")],
    );
    await source.executor.query(
      `INSERT INTO public.hosted_continuation_heartbeats(cron,due_count) VALUES ('fixture',0)`,
    );
    const first = await exportMetadataSnapshot(source.executor);
    const second = await exportMetadataSnapshot(source.executor);
    const serialized = serializeMetadataSnapshot(first);
    assert.equal(serializeMetadataSnapshot(second), serialized);
    assert.equal(second.snapshotSha256, first.snapshotSha256);
    assert.equal(first.migrationLedger.length, MIGRATION_MANIFEST.length);
    assert.equal(first.tables.length, RELATIONAL_TABLE_NAMES.length);
    assert.equal(serialized.includes(sha256("fixture-connect-authority")), false);
    assert.equal(
      first.tables.some((table) => table.tableName === "hosted_continuation_heartbeats"),
      false,
    );
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
      "hosted_video_plans",
      "hosted_video_jobs",
    ]) {
      assert.ok(first.tables.find((table) => table.tableName === requiredTable).rowCount > 0);
    }

    const expectedRows = first.tables.reduce((total, table) => total + table.rowCount, 0);
    assert.deepEqual(await restoreMetadataSnapshot(destination.executor, serialized), {
      snapshotSha256: first.snapshotSha256,
      restoredRows: expectedRows,
      alreadyRestored: false,
    });
    const ephemeralRows = await destination.executor.query(
      `SELECT (SELECT count(*)::integer FROM public.media_worker_connect_commands) AS commands,
              (SELECT count(*)::integer FROM public.hosted_continuation_heartbeats) AS heartbeats`,
    );
    assert.deepEqual(ephemeralRows.rows, [{ commands: 0, heartbeats: 0 }]);
    assert.equal(
      serializeMetadataSnapshot(await exportMetadataSnapshot(destination.executor)),
      serialized,
    );
    assert.deepEqual(await restoreMetadataSnapshot(destination.executor, serialized), {
      snapshotSha256: first.snapshotSha256,
      restoredRows: 0,
      alreadyRestored: true,
    });

    assert.deepEqual(await footageMetadata(destination.executor), originalFootage);
    const restoredVideo = (await footageMetadata(destination.executor)).jobs[0];
    assert.equal(restoredVideo.state, "UNKNOWN_NO_RETRY");
    assert.equal(restoredVideo.id, uuid(40_010));
    assert.equal(restoredVideo.claim_id, uuid(40_011));
    await destination.executor.query("SELECT set_config('videoforge.account_id',$1,false)", [
      IDS.accountA,
    ]);
    await assert.rejects(
      destination.executor.query(
        "UPDATE hosted_video_plans SET coverage_percent=100 WHERE project_revision_id=$1",
        [IDS.revisionA],
      ),
      /immutable/,
    );
    await assert.rejects(
      destination.executor.query(
        "UPDATE hosted_video_jobs SET state='PREPARED',claim_id=NULL,input_manifest=NULL,input_sha256=NULL WHERE id=$1",
        [uuid(40_010)],
      ),
      /immutable.*cannot replay/,
    );
    await destination.executor.query("SELECT set_config('videoforge.account_id','',false)");
    await destination.database.close();
    destination = await createMigratedDatabase(destinationData);
    assert.deepEqual(await footageMetadata(destination.executor), originalFootage);
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

import assert from "node:assert/strict";
import test from "node:test";

import { IDS, seedLockedProjects } from "./support/fixtures.mjs";
import { insertTestedExecutionProfile } from "./support/hardening-fixtures.mjs";
import {
  expectDatabaseError,
  FIXED_TIME,
  sha256,
  uuid,
  withMigratedDatabase,
} from "./support/pglite.mjs";

async function insertOwnedExecutionTuple(
  executor,
  { ownerType, ownerId, taskId, attemptId, costId, outboxId, taskKey },
) {
  const imageStyleVersionId = ownerType === "IMAGE_STYLE_VERSION" ? ownerId : null;
  const avatarProfileVersionId = ownerType === "AVATAR_PROFILE_VERSION" ? ownerId : null;
  await executor.query(
    `INSERT INTO public.generation_tasks (
       id, workspace_id, owner_type, owner_id,
       image_style_version_id, avatar_profile_version_id,
       task_key, lane, state
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'QA', 'READY')`,
    [
      taskId,
      IDS.workspaceA,
      ownerType,
      ownerId,
      imageStyleVersionId,
      avatarProfileVersionId,
      taskKey,
    ],
  );
  await executor.query(
    `INSERT INTO public.attempts (
       id, workspace_id, task_id, ordinal, idempotency_key, state,
       dispatch_state, claim_state, execution_profile_id,
       execution_claim_token_hash, input_hash
     ) VALUES ($1, $2, $3, 1, $4, 'CREATED', 'NOT_SENT', 'UNCLAIMED', $5, $6, $7)`,
    [
      attemptId,
      IDS.workspaceA,
      taskId,
      `${taskKey}:attempt`,
      IDS.executionProfileA,
      sha256(`${taskKey}:claim`),
      sha256(`${taskKey}:input`),
    ],
  );
  await executor.query(
    `INSERT INTO public.cost_events (
       id, workspace_id, owner_type, owner_id, task_id, attempt_id,
       sequence, event_type, amount_micro_usd, idempotency_key, occurred_at
     ) VALUES ($1, $2, $3, $4, $5, $6, 1, 'RESERVED', 100000, $7, $8)`,
    [
      costId,
      IDS.workspaceA,
      ownerType,
      ownerId,
      taskId,
      attemptId,
      `${taskKey}:reservation`,
      FIXED_TIME,
    ],
  );
  await executor.query(
    `INSERT INTO public.outbox (
       id, workspace_id, task_id, attempt_id, kind, state, dedupe_key,
       payload_contract_name, payload_contract_version, payload_hash, payload, available_at
     ) VALUES ($1, $2, $3, $4, 'DISPATCH', 'PENDING', $5,
               'worker-job-envelope', 'v1', $6, '{}'::jsonb, $7)`,
    [
      outboxId,
      IDS.workspaceA,
      taskId,
      attemptId,
      `${taskKey}:dispatch`,
      sha256(`${taskKey}:payload`),
      FIXED_TIME,
    ],
  );
}

test("image style analysis requires and accepts one atomic owned execution tuple", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedLockedProjects(executor);
    await expectDatabaseError(
      () =>
        executor.query(
          `INSERT INTO public.image_style_analysis_attempts (
             id, workspace_id, style_version_id, ordinal, idempotency_key, request_hash,
             state, provider, model, model_revision,
             task_id, execution_attempt_id, reservation_cost_event_id,
             reservation_event_type, outbox_id, outbox_kind
           ) VALUES ($1, $2, $3, 1, 'style-analysis:orphan', $4,
                     'CREATED', 'FIXTURE', 'none', 'owned-v1',
                     $5, $6, $7, 'RESERVED', $8, 'DISPATCH')`,
          [
            uuid(1300),
            IDS.workspaceA,
            IDS.styleVersionA,
            sha256("style-analysis-orphan-request"),
            uuid(1301),
            uuid(1302),
            uuid(1303),
            uuid(1304),
          ],
        ),
      "23503",
    );

    const tuple = {
      ownerType: "IMAGE_STYLE_VERSION",
      ownerId: IDS.styleVersionA,
      taskId: uuid(1310),
      attemptId: uuid(1311),
      costId: uuid(1312),
      outboxId: uuid(1313),
      taskKey: "style-analysis:owned",
    };
    const analysisId = uuid(1314);
    await executor.transaction(async (transaction) => {
      await insertOwnedExecutionTuple(transaction, tuple);
      await transaction.query(
        `INSERT INTO public.image_style_analysis_attempts (
           id, workspace_id, style_version_id, ordinal, idempotency_key, request_hash,
           state, provider, model, model_revision,
           task_id, execution_attempt_id, reservation_cost_event_id,
           reservation_event_type, outbox_id, outbox_kind
         ) VALUES ($1, $2, $3, 1, 'style-analysis:owned:attempt', $4,
                   'CREATED', 'FIXTURE', 'none', 'owned-v1',
                   $5, $6, $7, 'RESERVED', $8, 'DISPATCH')`,
        [
          analysisId,
          IDS.workspaceA,
          IDS.styleVersionA,
          sha256("style-analysis-owned-request"),
          tuple.taskId,
          tuple.attemptId,
          tuple.costId,
          tuple.outboxId,
        ],
      );
    });

    const linked = await executor.query(
      `SELECT analysis.task_id, analysis.execution_attempt_id,
              analysis.reservation_cost_event_id, analysis.reservation_event_type,
              analysis.outbox_id, analysis.outbox_kind,
              task.owner_type, task.owner_id
         FROM public.image_style_analysis_attempts analysis
         JOIN public.generation_tasks task
           ON task.workspace_id = analysis.workspace_id AND task.id = analysis.task_id
        WHERE analysis.workspace_id = $1 AND analysis.id = $2`,
      [IDS.workspaceA, analysisId],
    );
    assert.deepEqual(linked.rows[0], {
      task_id: tuple.taskId,
      execution_attempt_id: tuple.attemptId,
      reservation_cost_event_id: tuple.costId,
      reservation_event_type: "RESERVED",
      outbox_id: tuple.outboxId,
      outbox_kind: "DISPATCH",
      owner_type: tuple.ownerType,
      owner_id: tuple.ownerId,
    });

    await expectDatabaseError(
      () =>
        executor.query(
          `INSERT INTO public.image_style_analysis_attempts (
             id, workspace_id, style_version_id, ordinal, idempotency_key, request_hash,
             state, provider, model, model_revision,
             task_id, execution_attempt_id, reservation_cost_event_id,
             reservation_event_type, outbox_id, outbox_kind
           ) VALUES ($1, $2, $3, 2, 'style-analysis:wrong-cost-kind', $4,
                     'CREATED', 'FIXTURE', 'none', 'owned-v1',
                     $5, $6, $7, 'REPORTED', $8, 'DISPATCH')`,
          [
            uuid(1315),
            IDS.workspaceA,
            IDS.styleVersionA,
            sha256("style-analysis-wrong-cost-kind"),
            tuple.taskId,
            tuple.attemptId,
            tuple.costId,
            tuple.outboxId,
          ],
        ),
      "23514",
    );
    await expectDatabaseError(
      () =>
        executor.query(
          `INSERT INTO public.image_style_analysis_attempts (
             id, workspace_id, style_version_id, ordinal, idempotency_key, request_hash,
             state, provider, model, model_revision,
             task_id, execution_attempt_id, reservation_cost_event_id,
             reservation_event_type, outbox_id, outbox_kind
           ) VALUES ($1, $2, $3, 3, 'style-analysis:wrong-outbox-kind', $4,
                     'CREATED', 'FIXTURE', 'none', 'owned-v1',
                     $5, $6, $7, 'RESERVED', $8, 'CANCEL')`,
          [
            uuid(1316),
            IDS.workspaceA,
            IDS.styleVersionA,
            sha256("style-analysis-wrong-outbox-kind"),
            tuple.taskId,
            tuple.attemptId,
            tuple.costId,
            tuple.outboxId,
          ],
        ),
      "23514",
    );
  });
});

test("avatar compatibility attempts require and accept one atomic owned execution tuple", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedLockedProjects(executor);
    const assessmentId = uuid(1320);
    await executor.query(
      `INSERT INTO public.avatar_compatibility_assessments (
         id, workspace_id, avatar_profile_version_id, execution_profile_id, state
       ) VALUES ($1, $2, $3, $4, 'RUNNING')`,
      [assessmentId, IDS.workspaceA, IDS.avatarVersionA, IDS.executionProfileA],
    );
    await expectDatabaseError(
      () =>
        executor.query(
          `INSERT INTO public.avatar_profile_test_attempts (
             id, workspace_id, assessment_id, ordinal, idempotency_key, state,
             task_id, execution_attempt_id, reservation_cost_event_id,
             reservation_event_type, outbox_id, outbox_kind, avatar_profile_version_id
           ) VALUES ($1, $2, $3, 1, 'avatar-test:orphan', 'CREATED',
                     $4, $5, $6, 'RESERVED', $7, 'DISPATCH', $8)`,
          [
            uuid(1321),
            IDS.workspaceA,
            assessmentId,
            uuid(1322),
            uuid(1323),
            uuid(1324),
            uuid(1325),
            IDS.avatarVersionA,
          ],
        ),
      "23503",
    );

    const tuple = {
      ownerType: "AVATAR_PROFILE_VERSION",
      ownerId: IDS.avatarVersionA,
      taskId: uuid(1330),
      attemptId: uuid(1331),
      costId: uuid(1332),
      outboxId: uuid(1333),
      taskKey: "avatar-test:owned",
    };
    const testAttemptId = uuid(1334);
    await executor.transaction(async (transaction) => {
      await insertOwnedExecutionTuple(transaction, tuple);
      await transaction.query(
        `INSERT INTO public.avatar_profile_test_attempts (
           id, workspace_id, assessment_id, ordinal, idempotency_key, state,
           task_id, execution_attempt_id, reservation_cost_event_id,
           reservation_event_type, outbox_id, outbox_kind, avatar_profile_version_id
         ) VALUES ($1, $2, $3, 1, 'avatar-test:owned:attempt', 'CREATED',
                   $4, $5, $6, 'RESERVED', $7, 'DISPATCH', $8)`,
        [
          testAttemptId,
          IDS.workspaceA,
          assessmentId,
          tuple.taskId,
          tuple.attemptId,
          tuple.costId,
          tuple.outboxId,
          IDS.avatarVersionA,
        ],
      );
    });

    const linked = await executor.query(
      `SELECT test.task_id, test.execution_attempt_id,
              test.reservation_cost_event_id, test.reservation_event_type,
              test.outbox_id, test.outbox_kind, test.avatar_profile_version_id,
              task.owner_type, task.owner_id
         FROM public.avatar_profile_test_attempts test
         JOIN public.generation_tasks task
           ON task.workspace_id = test.workspace_id AND task.id = test.task_id
        WHERE test.workspace_id = $1 AND test.id = $2`,
      [IDS.workspaceA, testAttemptId],
    );
    assert.deepEqual(linked.rows[0], {
      task_id: tuple.taskId,
      execution_attempt_id: tuple.attemptId,
      reservation_cost_event_id: tuple.costId,
      reservation_event_type: "RESERVED",
      outbox_id: tuple.outboxId,
      outbox_kind: "DISPATCH",
      avatar_profile_version_id: IDS.avatarVersionA,
      owner_type: tuple.ownerType,
      owner_id: tuple.ownerId,
    });
  });
});

test("avatar test insertion rejects an assessment and general attempt profile mismatch", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedLockedProjects(executor);
    const alternateProfileId = uuid(1340);
    await insertTestedExecutionProfile(executor, {
      id: alternateProfileId,
      name: "owned-avatar-mismatch-profile",
    });
    const assessmentId = uuid(1341);
    await executor.query(
      `INSERT INTO public.avatar_compatibility_assessments (
         id, workspace_id, avatar_profile_version_id, execution_profile_id, state
       ) VALUES ($1, $2, $3, $4, 'RUNNING')`,
      [assessmentId, IDS.workspaceA, IDS.avatarVersionA, alternateProfileId],
    );

    const tuple = {
      ownerType: "AVATAR_PROFILE_VERSION",
      ownerId: IDS.avatarVersionA,
      taskId: uuid(1342),
      attemptId: uuid(1343),
      costId: uuid(1344),
      outboxId: uuid(1345),
      taskKey: "avatar-test:profile-mismatch",
    };
    await expectDatabaseError(
      () =>
        executor.transaction(async (transaction) => {
          await insertOwnedExecutionTuple(transaction, tuple);
          await transaction.query(
            `INSERT INTO public.avatar_profile_test_attempts (
               id, workspace_id, assessment_id, ordinal, idempotency_key, state,
               task_id, execution_attempt_id, reservation_cost_event_id,
               reservation_event_type, outbox_id, outbox_kind, avatar_profile_version_id
             ) VALUES ($1, $2, $3, 1, 'avatar-test:profile-mismatch:attempt', 'CREATED',
                       $4, $5, $6, 'RESERVED', $7, 'DISPATCH', $8)`,
            [
              uuid(1346),
              IDS.workspaceA,
              assessmentId,
              tuple.taskId,
              tuple.attemptId,
              tuple.costId,
              tuple.outboxId,
              IDS.avatarVersionA,
            ],
          );
        }),
      "23514",
    );

    const rolledBack = await executor.query(
      `SELECT
         (SELECT count(*)::int FROM public.generation_tasks WHERE id = $1) AS tasks,
         (SELECT count(*)::int FROM public.attempts WHERE id = $2) AS attempts,
         (SELECT count(*)::int FROM public.avatar_profile_test_attempts WHERE task_id = $1) AS tests`,
      [tuple.taskId, tuple.attemptId],
    );
    assert.deepEqual(rolledBack.rows[0], { tasks: 0, attempts: 0, tests: 0 });
  });
});

test("specialized UNKNOWN attempts retain unresolved terminal fields", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedLockedProjects(executor);
    const styleTuple = {
      ownerType: "IMAGE_STYLE_VERSION",
      ownerId: IDS.styleVersionA,
      taskId: uuid(1350),
      attemptId: uuid(1351),
      costId: uuid(1352),
      outboxId: uuid(1353),
      taskKey: "style-analysis:unknown",
    };
    await executor.transaction(async (transaction) => {
      await insertOwnedExecutionTuple(transaction, styleTuple);
      await transaction.query(
        `INSERT INTO public.image_style_analysis_attempts (
           id, workspace_id, style_version_id, ordinal, idempotency_key, request_hash,
           state, provider, model, model_revision,
           task_id, execution_attempt_id, reservation_cost_event_id,
           reservation_event_type, outbox_id, outbox_kind
         ) VALUES ($1, $2, $3, 1, 'style-analysis:unknown:valid', $4,
                   'UNKNOWN', 'FIXTURE', 'none', 'owned-v1',
                   $5, $6, $7, 'RESERVED', $8, 'DISPATCH')`,
        [
          uuid(1354),
          IDS.workspaceA,
          IDS.styleVersionA,
          sha256("style-analysis-unknown-valid"),
          styleTuple.taskId,
          styleTuple.attemptId,
          styleTuple.costId,
          styleTuple.outboxId,
        ],
      );
    });
    const invalidStyleRows = [
      { id: uuid(1355), ordinal: 2, finishedAt: FIXED_TIME, responseHash: null },
      { id: uuid(1356), ordinal: 3, finishedAt: null, responseHash: sha256("resolved-response") },
    ];
    for (const row of invalidStyleRows) {
      await expectDatabaseError(
        () =>
          executor.query(
            `INSERT INTO public.image_style_analysis_attempts (
               id, workspace_id, style_version_id, ordinal, idempotency_key, request_hash,
               state, provider, model, model_revision, response_hash, finished_at,
               task_id, execution_attempt_id, reservation_cost_event_id,
               reservation_event_type, outbox_id, outbox_kind
             ) VALUES ($1, $2, $3, $4, $5, $6,
                       'UNKNOWN', 'FIXTURE', 'none', 'owned-v1', $7, $8,
                       $9, $10, $11, 'RESERVED', $12, 'DISPATCH')`,
            [
              row.id,
              IDS.workspaceA,
              IDS.styleVersionA,
              row.ordinal,
              `style-analysis:unknown:invalid:${String(row.ordinal)}`,
              sha256(`style-analysis-unknown-invalid-${String(row.ordinal)}`),
              row.responseHash,
              row.finishedAt,
              styleTuple.taskId,
              styleTuple.attemptId,
              styleTuple.costId,
              styleTuple.outboxId,
            ],
          ),
        "23514",
      );
    }

    const assessmentId = uuid(1360);
    await executor.query(
      `INSERT INTO public.avatar_compatibility_assessments (
         id, workspace_id, avatar_profile_version_id, execution_profile_id, state
       ) VALUES ($1, $2, $3, $4, 'RUNNING')`,
      [assessmentId, IDS.workspaceA, IDS.avatarVersionA, IDS.executionProfileA],
    );
    const avatarTuple = {
      ownerType: "AVATAR_PROFILE_VERSION",
      ownerId: IDS.avatarVersionA,
      taskId: uuid(1361),
      attemptId: uuid(1362),
      costId: uuid(1363),
      outboxId: uuid(1364),
      taskKey: "avatar-test:unknown",
    };
    await executor.transaction(async (transaction) => {
      await insertOwnedExecutionTuple(transaction, avatarTuple);
      await transaction.query(
        `INSERT INTO public.avatar_profile_test_attempts (
           id, workspace_id, assessment_id, ordinal, idempotency_key, state,
           task_id, execution_attempt_id, reservation_cost_event_id,
           reservation_event_type, outbox_id, outbox_kind, avatar_profile_version_id
         ) VALUES ($1, $2, $3, 1, 'avatar-test:unknown:valid', 'UNKNOWN',
                   $4, $5, $6, 'RESERVED', $7, 'DISPATCH', $8)`,
        [
          uuid(1365),
          IDS.workspaceA,
          assessmentId,
          avatarTuple.taskId,
          avatarTuple.attemptId,
          avatarTuple.costId,
          avatarTuple.outboxId,
          IDS.avatarVersionA,
        ],
      );
    });
    const invalidAvatarRows = [
      { id: uuid(1366), ordinal: 2, finishedAt: FIXED_TIME, outputAssetId: null },
      { id: uuid(1367), ordinal: 3, finishedAt: null, outputAssetId: IDS.outputA1 },
    ];
    for (const row of invalidAvatarRows) {
      await expectDatabaseError(
        () =>
          executor.query(
            `INSERT INTO public.avatar_profile_test_attempts (
               id, workspace_id, assessment_id, ordinal, idempotency_key, state,
               output_asset_id, finished_at,
               task_id, execution_attempt_id, reservation_cost_event_id,
               reservation_event_type, outbox_id, outbox_kind, avatar_profile_version_id
             ) VALUES ($1, $2, $3, $4, $5, 'UNKNOWN', $6, $7,
                       $8, $9, $10, 'RESERVED', $11, 'DISPATCH', $12)`,
            [
              row.id,
              IDS.workspaceA,
              assessmentId,
              row.ordinal,
              `avatar-test:unknown:invalid:${String(row.ordinal)}`,
              row.outputAssetId,
              row.finishedAt,
              avatarTuple.taskId,
              avatarTuple.attemptId,
              avatarTuple.costId,
              avatarTuple.outboxId,
              IDS.avatarVersionA,
            ],
          ),
        "23514",
      );
    }

    const validUnknown = await executor.query(
      `SELECT
         (SELECT state FROM public.image_style_analysis_attempts WHERE id = $1) AS style_state,
         (SELECT finished_at FROM public.image_style_analysis_attempts WHERE id = $1) AS style_finished,
         (SELECT response_hash FROM public.image_style_analysis_attempts WHERE id = $1) AS style_response,
         (SELECT state FROM public.avatar_profile_test_attempts WHERE id = $2) AS avatar_state,
         (SELECT finished_at FROM public.avatar_profile_test_attempts WHERE id = $2) AS avatar_finished,
         (SELECT output_asset_id FROM public.avatar_profile_test_attempts WHERE id = $2) AS avatar_output`,
      [uuid(1354), uuid(1365)],
    );
    assert.deepEqual(validUnknown.rows[0], {
      style_state: "UNKNOWN",
      style_finished: null,
      style_response: null,
      avatar_state: "UNKNOWN",
      avatar_finished: null,
      avatar_output: null,
    });
  });
});

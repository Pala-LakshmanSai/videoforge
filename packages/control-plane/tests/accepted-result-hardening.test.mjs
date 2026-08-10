import assert from "node:assert/strict";
import test from "node:test";

import { HASHES, IDS, insertAttempt, seedTask } from "./support/fixtures.mjs";
import { expectDatabaseError, FIXED_TIME, uuid, withMigratedDatabase } from "./support/pglite.mjs";

test("accepted task pointers and attempt dispositions require the same successful pair", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedTask(executor);
    await insertAttempt(executor, {
      id: IDS.attemptA1,
      ordinal: 1,
      idempotencyKey: "accepted-hardening:rejected",
      state: "FAILED",
      disposition: "REJECTED",
    });
    await expectDatabaseError(
      () =>
        executor.query(
          "UPDATE public.generation_tasks SET accepted_attempt_id = $1 WHERE id = $2",
          [IDS.attemptA1, IDS.taskA],
        ),
      "23514",
    );

    await insertAttempt(executor, {
      id: IDS.attemptA2,
      ordinal: 2,
      idempotencyKey: "accepted-hardening:pending",
      state: "SUCCEEDED",
      outputAssetId: IDS.outputA1,
      disposition: "PENDING",
      inputHash: HASHES.attemptInputA2,
      claimHash: HASHES.claimA2,
      finishedAt: FIXED_TIME,
    });
    await expectDatabaseError(
      () =>
        executor.query("UPDATE public.attempts SET result_disposition = 'ACCEPTED' WHERE id = $1", [
          IDS.attemptA2,
        ]),
      "23514",
    );
  });
});

test("one transaction can atomically establish an accepted task-attempt pair", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedTask(executor);
    await insertAttempt(executor, {
      id: IDS.attemptA2,
      ordinal: 1,
      idempotencyKey: "accepted-hardening:atomic",
      state: "SUCCEEDED",
      outputAssetId: IDS.outputA1,
      disposition: "PENDING",
      inputHash: HASHES.attemptInputA2,
      claimHash: HASHES.claimA2,
      finishedAt: FIXED_TIME,
    });

    await executor.transaction(async (transaction) => {
      await transaction.execute("SET CONSTRAINTS ALL DEFERRED");
      await transaction.query(
        "UPDATE public.attempts SET result_disposition = 'ACCEPTED' WHERE id = $1",
        [IDS.attemptA2],
      );
      await transaction.query(
        `UPDATE public.generation_tasks
            SET accepted_attempt_id = $1, state = 'COMPLETE', finished_at = $2
          WHERE id = $3`,
        [IDS.attemptA2, FIXED_TIME, IDS.taskA],
      );
    });

    const pair = await executor.query(
      `SELECT task.accepted_attempt_id, attempt.result_disposition, attempt.state,
              attempt.output_asset_id
         FROM public.generation_tasks task
         JOIN public.attempts attempt
           ON attempt.workspace_id = task.workspace_id
          AND attempt.task_id = task.id
          AND attempt.id = task.accepted_attempt_id
        WHERE task.workspace_id = $1 AND task.id = $2`,
      [IDS.workspaceA, IDS.taskA],
    );
    assert.deepEqual(pair.rows[0], {
      accepted_attempt_id: IDS.attemptA2,
      result_disposition: "ACCEPTED",
      state: "SUCCEEDED",
      output_asset_id: IDS.outputA1,
    });

    await expectDatabaseError(
      () =>
        executor.query("UPDATE public.attempts SET result_disposition = 'REJECTED' WHERE id = $1", [
          IDS.attemptA2,
        ]),
      "23514",
    );
    await expectDatabaseError(
      () =>
        executor.query(
          "UPDATE public.generation_tasks SET accepted_attempt_id = NULL WHERE id = $1",
          [IDS.taskA],
        ),
      "23514",
    );
  });
});

test("hostile shadow tables cannot forge accepted-result consistency", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedTask(executor);
    await insertAttempt(executor, {
      id: IDS.attemptA1,
      ordinal: 1,
      idempotencyKey: "accepted-hardening:hostile-rejected",
      state: "FAILED",
      disposition: "REJECTED",
    });
    await insertAttempt(executor, {
      id: IDS.attemptA2,
      ordinal: 2,
      idempotencyKey: "accepted-hardening:hostile-pending",
      state: "SUCCEEDED",
      outputAssetId: IDS.outputA1,
      disposition: "PENDING",
      inputHash: HASHES.attemptInputA2,
      claimHash: HASHES.claimA2,
      finishedAt: FIXED_TIME,
    });

    await executor.execute(`
      CREATE SCHEMA hostile;
      CREATE TABLE hostile.attempts (
        workspace_id uuid, task_id uuid, id uuid, state text,
        result_disposition text, output_asset_id uuid
      );
      CREATE TABLE hostile.generation_tasks (
        workspace_id uuid, id uuid, accepted_attempt_id uuid, state text, finished_at timestamptz
      );
    `);
    await executor.query(
      `INSERT INTO hostile.attempts (
         workspace_id, task_id, id, state, result_disposition, output_asset_id
       ) VALUES ($1, $2, $3, 'SUCCEEDED', 'ACCEPTED', $4)`,
      [IDS.workspaceA, IDS.taskA, IDS.attemptA1, IDS.outputA1],
    );
    await executor.query(
      `INSERT INTO hostile.generation_tasks (
         workspace_id, id, accepted_attempt_id, state, finished_at
       ) VALUES ($1, $2, $3, 'COMPLETE', $4)`,
      [IDS.workspaceA, IDS.taskA, IDS.attemptA2, FIXED_TIME],
    );
    await executor.execute("SET search_path TO hostile, public");

    await expectDatabaseError(
      () =>
        executor.query(
          `UPDATE public.generation_tasks
              SET accepted_attempt_id = $1, state = 'COMPLETE', finished_at = $2
            WHERE id = $3`,
          [IDS.attemptA1, FIXED_TIME, IDS.taskA],
        ),
      "23514",
    );
    await expectDatabaseError(
      () =>
        executor.query("UPDATE public.attempts SET result_disposition = 'ACCEPTED' WHERE id = $1", [
          IDS.attemptA2,
        ]),
      "23514",
    );

    const publicState = await executor.query(
      `SELECT
         (SELECT accepted_attempt_id FROM public.generation_tasks WHERE id = $1) AS accepted_attempt_id,
         (SELECT result_disposition FROM public.attempts WHERE id = $2) AS result_disposition`,
      [IDS.taskA, IDS.attemptA2],
    );
    assert.deepEqual(publicState.rows[0], {
      accepted_attempt_id: null,
      result_disposition: "PENDING",
    });
  });
});

test("accepted-result enforcement rejects a pointer to an attempt from another task", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedTask(executor);
    await executor.query(
      `INSERT INTO public.generation_tasks (
         id, workspace_id, owner_type, owner_id, project_revision_id, task_key, lane, state
       ) VALUES ($1, $2, 'PROJECT_REVISION', $3, $3, 'image:accepted:second', 'IMAGE', 'READY')`,
      [uuid(1100), IDS.workspaceA, IDS.revisionA],
    );
    await insertAttempt(executor, {
      id: IDS.attemptA1,
      ordinal: 1,
      idempotencyKey: "accepted-hardening:wrong-task",
      state: "SUCCEEDED",
      outputAssetId: IDS.outputA1,
      disposition: "PENDING",
      finishedAt: FIXED_TIME,
    });
    await expectDatabaseError(
      () =>
        executor.query(
          `UPDATE public.generation_tasks
              SET accepted_attempt_id = $1, state = 'COMPLETE', finished_at = $2
            WHERE id = $3`,
          [IDS.attemptA1, FIXED_TIME, uuid(1100)],
        ),
      ["23503", "23514"],
    );
  });
});

test("COMPLETE tasks require one accepted attempt and pointer", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedTask(executor);
    await expectDatabaseError(
      () =>
        executor.query(
          `UPDATE public.generation_tasks
              SET state = 'COMPLETE', finished_at = $1
            WHERE workspace_id = $2 AND id = $3`,
          [FIXED_TIME, IDS.workspaceA, IDS.taskA],
        ),
      "23514",
    );

    const task = await executor.query(
      `SELECT state, accepted_attempt_id, finished_at
         FROM public.generation_tasks
        WHERE workspace_id = $1 AND id = $2`,
      [IDS.workspaceA, IDS.taskA],
    );
    assert.deepEqual(task.rows[0], {
      state: "READY",
      accepted_attempt_id: null,
      finished_at: null,
    });
  });
});

test("an accepted attempt requires its own finish timestamp", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedTask(executor);
    await insertAttempt(executor, {
      id: IDS.attemptA2,
      ordinal: 1,
      idempotencyKey: "accepted-hardening:missing-finished-at",
      state: "SUCCEEDED",
      outputAssetId: IDS.outputA1,
      disposition: "PENDING",
      inputHash: HASHES.attemptInputA2,
      claimHash: HASHES.claimA2,
      finishedAt: null,
    });

    await expectDatabaseError(
      () =>
        executor.transaction(async (transaction) => {
          await transaction.execute("SET CONSTRAINTS ALL DEFERRED");
          await transaction.query(
            "UPDATE public.attempts SET result_disposition = 'ACCEPTED' WHERE id = $1",
            [IDS.attemptA2],
          );
          await transaction.query(
            `UPDATE public.generation_tasks
                SET accepted_attempt_id = $1, state = 'COMPLETE', finished_at = $2
              WHERE id = $3`,
            [IDS.attemptA2, FIXED_TIME, IDS.taskA],
          );
        }),
      "23514",
    );

    const state = await executor.query(
      `SELECT
         (SELECT state FROM public.generation_tasks WHERE id = $1) AS task_state,
         (SELECT accepted_attempt_id FROM public.generation_tasks WHERE id = $1) AS accepted_attempt_id,
         (SELECT result_disposition FROM public.attempts WHERE id = $2) AS result_disposition`,
      [IDS.taskA, IDS.attemptA2],
    );
    assert.deepEqual(state.rows[0], {
      task_state: "READY",
      accepted_attempt_id: null,
      result_disposition: "PENDING",
    });
  });
});

test("an accepted attempt requires a verified or already accepted output asset", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedTask(executor);
    const uploadingAssetId = uuid(1110);
    await executor.query(
      `INSERT INTO public.assets (id, workspace_id, kind, state)
       VALUES ($1, $2, 'IMAGE', 'UPLOADING')`,
      [uploadingAssetId, IDS.workspaceA],
    );
    await insertAttempt(executor, {
      id: IDS.attemptA2,
      ordinal: 1,
      idempotencyKey: "accepted-hardening:unverified-output",
      state: "SUCCEEDED",
      outputAssetId: uploadingAssetId,
      disposition: "PENDING",
      inputHash: HASHES.attemptInputA2,
      claimHash: HASHES.claimA2,
      finishedAt: FIXED_TIME,
    });

    await expectDatabaseError(
      () =>
        executor.transaction(async (transaction) => {
          await transaction.execute("SET CONSTRAINTS ALL DEFERRED");
          await transaction.query(
            "UPDATE public.attempts SET result_disposition = 'ACCEPTED' WHERE id = $1",
            [IDS.attemptA2],
          );
          await transaction.query(
            `UPDATE public.generation_tasks
                SET accepted_attempt_id = $1, state = 'COMPLETE', finished_at = $2
              WHERE id = $3`,
            [IDS.attemptA2, FIXED_TIME, IDS.taskA],
          );
        }),
      "23514",
    );
  });
});

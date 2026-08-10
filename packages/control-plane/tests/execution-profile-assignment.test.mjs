import assert from "node:assert/strict";
import test from "node:test";

import { IDS, insertAttempt, seedTask } from "./support/fixtures.mjs";
import { insertTestedExecutionProfile } from "./support/hardening-fixtures.mjs";
import {
  expectDatabaseError,
  FIXED_TIME,
  uuid,
  withMigratedDatabase,
} from "./support/pglite.mjs";

test("attempt and assessment execution profile assignments cannot be rewritten", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedTask(executor);
    const alternateProfileId = uuid(1600);
    await insertTestedExecutionProfile(executor, { id: alternateProfileId });
    await insertAttempt(executor, {
      id: IDS.attemptA1,
      ordinal: 1,
      idempotencyKey: "profile-assignment:attempt",
    });

    await expectDatabaseError(
      () =>
        executor.query(
          "UPDATE public.attempts SET execution_profile_id = $1 WHERE id = $2",
          [alternateProfileId, IDS.attemptA1],
        ),
      "23514",
    );
    await executor.query(
      `UPDATE public.attempts
          SET execution_profile_id = $1, provider_details = '{"unchanged_profile":true}'::jsonb
        WHERE id = $2`,
      [IDS.executionProfileA, IDS.attemptA1],
    );

    const assessmentId = uuid(1601);
    await executor.query(
      `INSERT INTO public.avatar_compatibility_assessments (
         id, workspace_id, avatar_profile_version_id, execution_profile_id, state
       ) VALUES ($1, $2, $3, $4, 'RUNNING')`,
      [assessmentId, IDS.workspaceA, IDS.avatarVersionA, IDS.executionProfileA],
    );
    await expectDatabaseError(
      () =>
        executor.query(
          `UPDATE public.avatar_compatibility_assessments
              SET execution_profile_id = $1
            WHERE id = $2`,
          [alternateProfileId, assessmentId],
        ),
      "23514",
    );
    await executor.query(
      `UPDATE public.avatar_compatibility_assessments
          SET execution_profile_id = $1, updated_at = $2
        WHERE id = $3`,
      [IDS.executionProfileA, FIXED_TIME, assessmentId],
    );

    const pinned = await executor.query(
      `SELECT
         (SELECT execution_profile_id FROM public.attempts WHERE id = $1) AS attempt_profile,
         (SELECT provider_details FROM public.attempts WHERE id = $1) AS provider_details,
         (SELECT execution_profile_id
            FROM public.avatar_compatibility_assessments WHERE id = $2) AS assessment_profile`,
      [IDS.attemptA1, assessmentId],
    );
    assert.deepEqual(pinned.rows[0], {
      attempt_profile: IDS.executionProfileA,
      provider_details: { unchanged_profile: true },
      assessment_profile: IDS.executionProfileA,
    });
  });
});

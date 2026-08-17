import assert from "node:assert/strict";
import test from "node:test";

import { IDS, seedLockedProjects } from "./support/fixtures.mjs";
import {
  expectDatabaseError,
  FIXED_TIME,
  sha256,
  uuid,
  withMigratedDatabase,
} from "./support/pglite.mjs";

async function insertAttempt(executor, { serial, accountId, workspaceId, projectId, revisionId }) {
  const attemptId = uuid(serial);
  const artifactPrefix =
    `tenant/${accountId}/workspace/${workspaceId}/project/${projectId}` +
    `/revision/${revisionId}/lane/render/job/${attemptId}/artifact`;
  await executor.query(
    `INSERT INTO hosted_cpu_job_attempts (
       id, account_id, workspace_id, project_id, project_revision_id, kind, state,
       request_sha256, job_spec_object_key, job_spec_content_length,
       job_spec_checksum_sha256, result_object_key, image_digest,
       callback_token_sha256, deadline_at, created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, 'RENDER', 'PLANNED', $6, $7, 128, $8, $9, $10, $11,
       '2026-08-11T04:00:00.000Z', $12, $12
     )`,
    [
      attemptId,
      accountId,
      workspaceId,
      projectId,
      revisionId,
      sha256(`request-${serial}`),
      `${artifactPrefix}/job-spec`,
      sha256(`job-spec-${serial}`),
      `${artifactPrefix}/result`,
      sha256(`image-${serial}`),
      sha256(`callback-${serial}`),
      FIXED_TIME,
    ],
  );
  return attemptId;
}

async function cloneProject(executor, { projectId, revisionId }) {
  await executor.query(
    `INSERT INTO projects (id, workspace_id, owner_user_id, name, normalized_name)
     VALUES ($1, $2, $3, 'Second owned project', 'second owned project')`,
    [projectId, IDS.workspaceA, IDS.userA],
  );
  await executor.query(
    `INSERT INTO project_revisions
     SELECT (jsonb_populate_record(
       NULL::project_revisions,
       to_jsonb(source) || jsonb_build_object(
         'id', $1::text,
         'project_id', $2::text,
         'title', 'Second owned revision'
       )
     )).* FROM project_revisions AS source WHERE source.id = $3`,
    [revisionId, projectId, IDS.revisionA],
  );
}

test("hosted CPU admission allows one active project per account and two projects globally", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedLockedProjects(executor);
    const secondProjectA = uuid(960_100);
    const secondRevisionA = uuid(960_101);
    await cloneProject(executor, { projectId: secondProjectA, revisionId: secondRevisionA });

    const attemptA = await insertAttempt(executor, {
      serial: 960_001,
      accountId: IDS.accountA,
      workspaceId: IDS.workspaceA,
      projectId: IDS.projectA,
      revisionId: IDS.revisionA,
    });
    const retryA = await insertAttempt(executor, {
      serial: 960_002,
      accountId: IDS.accountA,
      workspaceId: IDS.workspaceA,
      projectId: IDS.projectA,
      revisionId: IDS.revisionA,
    });
    const attemptB = await insertAttempt(executor, {
      serial: 960_003,
      accountId: IDS.accountB,
      workspaceId: IDS.workspaceB,
      projectId: IDS.projectB,
      revisionId: IDS.revisionB,
    });

    await expectDatabaseError(
      () =>
        insertAttempt(executor, {
          serial: 960_004,
          accountId: IDS.accountA,
          workspaceId: IDS.workspaceA,
          projectId: secondProjectA,
          revisionId: secondRevisionA,
        }),
      "23514",
    );

    await executor.query(
      `UPDATE hosted_cpu_job_attempts
          SET state = 'FAILED', submitted_at = $2, terminal_at = $2, updated_at = $2
        WHERE id = ANY($1::uuid[])`,
      [[attemptA, retryA], FIXED_TIME],
    );
    const replacementA = await insertAttempt(executor, {
      serial: 960_005,
      accountId: IDS.accountA,
      workspaceId: IDS.workspaceA,
      projectId: secondProjectA,
      revisionId: secondRevisionA,
    });

    const rows = await executor.query(
      `SELECT DISTINCT account_id, project_id
         FROM hosted_cpu_job_attempts
        WHERE state IN ('PLANNED', 'OUTBOXED', 'SUBMITTED', 'RUNNING', 'RECONCILING', 'CANCEL_REQUESTED')
        ORDER BY account_id, project_id`,
    );
    assert.deepEqual(rows.rows, [
      { account_id: IDS.accountA, project_id: secondProjectA },
      { account_id: IDS.accountB, project_id: IDS.projectB },
    ]);
    assert.ok([attemptB, replacementA].every((id) => typeof id === "string"));
  });
});

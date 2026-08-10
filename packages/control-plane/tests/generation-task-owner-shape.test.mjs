import assert from "node:assert/strict";
import test from "node:test";

import { IDS, seedLockedProjects } from "./support/fixtures.mjs";
import { expectDatabaseError, uuid, withMigratedDatabase } from "./support/pglite.mjs";

async function insertTask(
  executor,
  {
    id,
    ownerType,
    ownerId,
    projectRevisionId = null,
    imageStyleVersionId = null,
    avatarProfileVersionId = null,
  },
) {
  await executor.query(
    `INSERT INTO public.generation_tasks (
       id, workspace_id, owner_type, owner_id,
       project_revision_id, image_style_version_id, avatar_profile_version_id,
       task_key, lane, state
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'QA', 'READY')`,
    [
      id,
      IDS.workspaceA,
      ownerType,
      ownerId,
      projectRevisionId,
      imageStyleVersionId,
      avatarProfileVersionId,
      `owner-shape:${id}`,
    ],
  );
}

test("generation task owner discriminators require exactly one matching non-null reference", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedLockedProjects(executor);

    const validTasks = [
      {
        id: uuid(1500),
        ownerType: "PROJECT_REVISION",
        ownerId: IDS.revisionA,
        projectRevisionId: IDS.revisionA,
      },
      {
        id: uuid(1501),
        ownerType: "IMAGE_STYLE_VERSION",
        ownerId: IDS.styleVersionA,
        imageStyleVersionId: IDS.styleVersionA,
      },
      {
        id: uuid(1502),
        ownerType: "AVATAR_PROFILE_VERSION",
        ownerId: IDS.avatarVersionA,
        avatarProfileVersionId: IDS.avatarVersionA,
      },
    ];
    for (const task of validTasks) {
      await insertTask(executor, task);
    }

    const invalidTasks = [
      {
        id: uuid(1510),
        ownerType: "PROJECT_REVISION",
        ownerId: IDS.revisionA,
      },
      {
        id: uuid(1511),
        ownerType: "IMAGE_STYLE_VERSION",
        ownerId: IDS.styleVersionA,
      },
      {
        id: uuid(1512),
        ownerType: "AVATAR_PROFILE_VERSION",
        ownerId: IDS.avatarVersionA,
      },
    ];
    for (const task of invalidTasks) {
      await expectDatabaseError(() => insertTask(executor, task), "23514");
    }

    const stored = await executor.query(
      `SELECT owner_type, owner_id, project_revision_id,
              image_style_version_id, avatar_profile_version_id
         FROM public.generation_tasks
        WHERE workspace_id = $1 AND id = ANY($2::uuid[])
        ORDER BY owner_type`,
      [IDS.workspaceA, validTasks.map((task) => task.id)],
    );
    assert.deepEqual(stored.rows, [
      {
        owner_type: "AVATAR_PROFILE_VERSION",
        owner_id: IDS.avatarVersionA,
        project_revision_id: null,
        image_style_version_id: null,
        avatar_profile_version_id: IDS.avatarVersionA,
      },
      {
        owner_type: "IMAGE_STYLE_VERSION",
        owner_id: IDS.styleVersionA,
        project_revision_id: null,
        image_style_version_id: IDS.styleVersionA,
        avatar_profile_version_id: null,
      },
      {
        owner_type: "PROJECT_REVISION",
        owner_id: IDS.revisionA,
        project_revision_id: IDS.revisionA,
        image_style_version_id: null,
        avatar_profile_version_id: null,
      },
    ]);
  });
});

import assert from "node:assert/strict";
import test from "node:test";

import { TENANT_PRINCIPAL_SETTING } from "../dist/src/index.js";
import { IDS, seedLockedProjects } from "./support/fixtures.mjs";
import {
  expectDatabaseError,
  sha256,
  uuid,
  withPgcryptoMigratedDatabase,
} from "./support/pglite.mjs";

async function seedSucceededAsr(executor, serial) {
  const asrAttemptId = uuid(serial);
  const artifactPrefix =
    `tenant/${IDS.accountA}/workspace/${IDS.workspaceA}/project/${IDS.projectA}` +
    `/revision/${IDS.revisionA}/lane/input/job/${asrAttemptId}/artifact`;
  await executor.query(
    `INSERT INTO hosted_cpu_job_attempts (
       id, account_id, workspace_id, project_id, project_revision_id, kind, state,
       request_sha256, job_spec_object_key, job_spec_content_length,
       job_spec_checksum_sha256, result_object_key, result_content_type, result_max_bytes,
       image_digest, callback_token_sha256, result_receipt_sha256, result_content_length,
       result_checksum_sha256, deadline_at, submitted_at, terminal_at, created_at, updated_at
     ) VALUES (
       $1,$2,$3,$4,$5,'ASR','SUCCEEDED',$6,$12,128,$7,
       $13,'application/json',4096,$8,$9,$10,256,$11,
       clock_timestamp()+interval '1 hour',clock_timestamp(),clock_timestamp(),
       clock_timestamp(),clock_timestamp()
     )`,
    [
      asrAttemptId,
      IDS.accountA,
      IDS.workspaceA,
      IDS.projectA,
      IDS.revisionA,
      sha256(`context-request-${serial}`),
      sha256(`context-job-spec-${serial}`),
      sha256(`context-image-${serial}`),
      sha256(`context-callback-${serial}`),
      sha256(`context-receipt-${serial}`),
      sha256(`context-result-${serial}`),
      `${artifactPrefix}/job-spec`,
      `${artifactPrefix}/result-document`,
    ],
  );
  return asrAttemptId;
}

function contextClaim(asrAttemptId, serial) {
  return {
    account_id: IDS.accountA,
    workspace_id: IDS.workspaceA,
    user_id: IDS.userA,
    project_id: IDS.projectA,
    revision_id: IDS.revisionA,
    asr_attempt_id: asrAttemptId,
    context_id: uuid(serial + 1),
    task_id: uuid(serial + 2),
    attempt_id: uuid(serial + 3),
    outbox_id: uuid(serial + 4),
    execution_profile_id: uuid(serial + 5),
    reservation_cost_event_id: uuid(serial + 6),
    transcript_hash: sha256(`context-transcript-${serial}`),
    request_hash: sha256(`context-provider-request-${serial}`),
    claim_token_hash: sha256(`context-claim-${serial}`),
    reserved_cost_micro_usd: 10_000,
  };
}

async function insertContextProfile(executor, { id, operation = "voiceover-context-v8" }) {
  const configuration = {
    model: "deepseek:v4@flash",
    operation,
    provider: "runware",
  };
  await executor.query(
    `INSERT INTO execution_profiles (
       id, account_id, workspace_id, name, revision, lane, state, dispatch_target,
       configuration, configuration_hash, maximum_rate_micro_usd, checked_at
     ) VALUES (
       $1,$2,$3,'Hosted Runware voiceover context',6,'PROMPT','TESTED','RUNWARE',
       $4::jsonb,'sha256:'||encode(digest(convert_to(($4::jsonb)::text,'UTF8'),'sha256'),'hex'),
       10000,clock_timestamp()
     )`,
    [id, IDS.accountA, IDS.workspaceA, JSON.stringify(configuration)],
  );
}

test("0067 reuses the workspace compatible DeepSeek profile for a new project claim", async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    await seedLockedProjects(executor);
    await executor.query(`SELECT set_config($1, $2, false)`, [
      TENANT_PRINCIPAL_SETTING,
      IDS.accountA,
    ]);
    const existingProfileId = uuid(960_001);
    await insertContextProfile(executor, { id: existingProfileId });
    const asrAttemptId = await seedSucceededAsr(executor, 960_010);
    const supplied = contextClaim(asrAttemptId, 960_020);

    const prepared = await executor.query(
      `SELECT public.videoforge_prepare_hosted_voiceover_context($1::jsonb) AS prepared`,
      [JSON.stringify(supplied)],
    );
    assert.equal(prepared.rows[0].prepared.created, true);
    const attempts = await executor.query(
      `SELECT execution_profile_id::text AS execution_profile_id
         FROM attempts WHERE id=$1`,
      [supplied.attempt_id],
    );
    assert.deepEqual(attempts.rows, [{ execution_profile_id: existingProfileId }]);
    const profiles = await executor.query(
      `SELECT id::text AS id FROM execution_profiles
        WHERE workspace_id=$1 AND name='Hosted Runware voiceover context' AND revision=6`,
      [IDS.workspaceA],
    );
    assert.deepEqual(profiles.rows, [{ id: existingProfileId }]);
  });
});

test("0067 fails before claim or reservation when the compatible profile drifted", async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    await seedLockedProjects(executor);
    await executor.query(`SELECT set_config($1, $2, false)`, [
      TENANT_PRINCIPAL_SETTING,
      IDS.accountA,
    ]);
    await insertContextProfile(executor, {
      id: uuid(960_101),
      operation: "drifted-context-operation",
    });
    const asrAttemptId = await seedSucceededAsr(executor, 960_110);
    const supplied = contextClaim(asrAttemptId, 960_120);

    await expectDatabaseError(
      () =>
        executor.query(
          `SELECT public.videoforge_prepare_hosted_voiceover_context($1::jsonb) AS prepared`,
          [JSON.stringify(supplied)],
        ),
      "23514",
    );
    const durableRows = await executor.query(
      `SELECT
         (SELECT count(*)::integer FROM hosted_voiceover_contexts WHERE project_revision_id=$1) AS contexts,
         (SELECT count(*)::integer FROM generation_tasks WHERE id=$2) AS tasks,
         (SELECT count(*)::integer FROM cost_events WHERE attempt_id=$3) AS costs`,
      [IDS.revisionA, supplied.task_id, supplied.attempt_id],
    );
    assert.deepEqual(durableRows.rows, [{ contexts: 0, tasks: 0, costs: 0 }]);
  });
});

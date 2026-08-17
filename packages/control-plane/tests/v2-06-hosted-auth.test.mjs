import assert from "node:assert/strict";
import test from "node:test";

import {
  FIXED_TIME,
  expectDatabaseError,
  sha256,
  uuid,
  withMigratedDatabase,
} from "./support/pglite.mjs";
import { IDS, seedLockedProjects } from "./support/fixtures.mjs";

const NOW = Date.now();
const LATER = new Date(NOW + 24 * 60 * 60 * 1_000).toISOString();
const EARLIER = new Date(NOW - 24 * 60 * 60 * 1_000).toISOString();

async function seedInvite(executor, ordinal, email, expiresAt = LATER) {
  await executor.query(
    `INSERT INTO invite_codes (
       id, verifier_sha256, intended_normalized_email, state, expires_at, version, created_at
     ) VALUES ($1, $2, $3, 'ACTIVE', $4, 1, $5)`,
    [uuid(1_100_000 + ordinal), sha256(`invite-${ordinal}`), email, expiresAt, FIXED_TIME],
  );
}

async function insertHostedUser(executor, id, email, verified = true) {
  await executor.query(
    `INSERT INTO hosted_auth_users (
       id, name, email, email_verified, image, created_at, updated_at
     ) VALUES ($1, 'Hosted User', $2, $3, NULL, $4, $4)`,
    [id, email, verified, FIXED_TIME],
  );
}

async function insertGoogleAccount(executor, id, userId) {
  await executor.query(
    `INSERT INTO hosted_auth_accounts (
       id, provider_account_id, provider_id, user_id, created_at, updated_at
     ) VALUES ($1, $2, 'google', $3, $4, $4)`,
    [id, `google-subject-${id}`, userId, FIXED_TIME],
  );
}

async function insertSession(executor, id, userId, token) {
  await executor.query(
    `INSERT INTO hosted_auth_sessions (
       id, expires_at, token, created_at, updated_at, user_id
     ) VALUES ($1, $2, $3, $4, $4, $5)`,
    [id, LATER, token, FIXED_TIME, userId],
  );
}

test("hosted auth rejects uninvited, expired, and unverified identities before session", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await expectDatabaseError(
      insertHostedUser(executor, "hosted-user-uninvited-0001", "uninvited@example.test"),
      "42501",
    );

    await seedInvite(executor, 1, "expired@example.test", EARLIER);
    await expectDatabaseError(
      insertHostedUser(executor, "hosted-user-expired-000001", "expired@example.test"),
      "42501",
    );

    await seedInvite(executor, 2, "pending@example.test");
    await insertHostedUser(executor, "hosted-user-pending-000001", "pending@example.test", false);
    await insertGoogleAccount(
      executor,
      "hosted-account-pending-0001",
      "hosted-user-pending-000001",
    );
    await expectDatabaseError(
      insertSession(
        executor,
        "hosted-session-pending-0001",
        "hosted-user-pending-000001",
        "pending-session-token-000000000000000000000001",
      ),
      "42501",
    );
  });
});

test("first verified session atomically consumes one invite and creates one private account", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    const identities = [
      [11, "hosted-user-alpha-00000001", "alpha@example.test"],
      [12, "hosted-user-bravo-00000001", "bravo@example.test"],
    ];
    for (const [ordinal, userId, email] of identities) {
      await seedInvite(executor, ordinal, email);
      await insertHostedUser(executor, userId, email);
      await insertGoogleAccount(executor, `hosted-account-${ordinal}-00000001`, userId);
      await insertSession(
        executor,
        `hosted-session-${ordinal}-00000001`,
        userId,
        `hosted-session-token-${ordinal}-000000000000000000000001`,
      );
    }

    const truth = await executor.query(
      `SELECT
         (SELECT count(*)::int FROM hosted_auth_links) AS links,
         (SELECT count(*)::int FROM accounts WHERE scope_kind = 'USER') AS accounts,
         (SELECT count(*)::int FROM workspaces workspace
           JOIN accounts account ON account.id = workspace.account_id
          WHERE workspace.is_default AND account.scope_kind = 'USER') AS workspaces,
         (SELECT count(*)::int FROM memberships membership
           JOIN accounts account ON account.id = membership.account_id
          WHERE membership.status = 'ACTIVE' AND account.scope_kind = 'USER') AS memberships,
         (SELECT count(*)::int FROM invite_codes WHERE state = 'CONSUMED') AS consumed,
         (SELECT count(*)::int FROM invite_redemptions) AS redemptions`,
    );
    assert.deepEqual(truth.rows, [
      {
        links: 2,
        accounts: 2,
        workspaces: 2,
        memberships: 2,
        consumed: 2,
        redemptions: 2,
      },
    ]);

    await insertSession(
      executor,
      "hosted-session-alpha-replay-01",
      "hosted-user-alpha-00000001",
      "hosted-session-token-alpha-replay-00000000000001",
    );
    const replay = await executor.query(
      `SELECT count(*)::int AS links FROM hosted_auth_links
       WHERE hosted_auth_user_id = 'hosted-user-alpha-00000001'`,
    );
    assert.equal(replay.rows[0].links, 1);

    const scopes = await executor.query(
      `SELECT admitted_account_id AS account_id, workspace_id FROM hosted_auth_links ORDER BY hosted_auth_user_id`,
    );
    assert.equal(scopes.rows[0].account_id === scopes.rows[1].account_id, false);
    assert.equal(scopes.rows[0].workspace_id === scopes.rows[1].workspace_id, false);

    const resolved = await executor.query(`SELECT * FROM videoforge_hosted_session_scope($1)`, [
      "hosted-session-token-11-000000000000000000000001",
    ]);
    assert.equal(resolved.rows.length, 1);
    assert.equal(resolved.rows[0].normalized_email, "alpha@example.test");
  });
});

test("hosted CPU callbacks bind exact execution/object facts and replay without reviving cancel", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedLockedProjects(executor);
    const attempt = uuid(1_200_001);
    const cancelledAttempt = uuid(1_200_002);
    const operation = "projects/videoforge-staging/locations/asia-south1/operations/op-a";
    const execution =
      "projects/videoforge-staging/locations/asia-south1/jobs/videoforge-asr/executions/execution-a";
    const resultKey = `tenant/${IDS.accountA}/workspace/${IDS.workspaceA}/project/${IDS.projectA}/revision/${IDS.revisionA}/lane/input/job/${attempt}/artifact/result-a`;
    await executor.query(`SELECT set_config('videoforge.account_id', $1, false)`, [IDS.accountA]);
    for (const [id, state] of [
      [attempt, "SUBMITTED"],
      [cancelledAttempt, "CANCEL_REQUESTED"],
    ]) {
      await executor.query(
        `INSERT INTO hosted_cpu_job_attempts (
           id, account_id, workspace_id, project_id, project_revision_id, kind, state,
           request_sha256, job_spec_object_key, job_spec_content_length,
           job_spec_checksum_sha256, result_object_key, result_content_type, result_max_bytes,
           image_digest, provider_operation_name, provider_operation_name_sha256,
           provider_execution_name, execution_name_sha256, callback_token_sha256,
           deadline_at, cancellation_requested_at, submitted_at, created_at, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5, 'ASR', $6, $7, $8, 256, $9, $10,
           'application/json', 1048576, $11, $12, $13, $14, $15, $16,
           $17, CASE WHEN $6 = 'CANCEL_REQUESTED' THEN $18::timestamptz ELSE NULL END,
           $18, $18, $18
         )`,
        [
          id,
          IDS.accountA,
          IDS.workspaceA,
          IDS.projectA,
          IDS.revisionA,
          state,
          sha256(`request-${id}`),
          `tenant/${IDS.accountA}/workspace/${IDS.workspaceA}/project/${IDS.projectA}/revision/${IDS.revisionA}/lane/input/job/${id}/artifact/spec-a`,
          sha256(`spec-${id}`),
          id === attempt ? resultKey : resultKey.replace(attempt, cancelledAttempt),
          sha256("image"),
          operation.replace("op-a", id),
          sha256(`operation-${id}`),
          execution.replace("execution-a", id),
          sha256(`execution-${id}`),
          sha256(`callback-${id}`),
          LATER,
          FIXED_TIME,
        ],
      );
    }
    await executor.query(`SELECT set_config('videoforge.account_id', '', false)`);

    const callback = [
      attempt,
      sha256(`callback-${attempt}`),
      execution.replace("execution-a", attempt),
      "SUCCEEDED",
      resultKey,
      512,
      sha256("result-bytes"),
      sha256("commit-receipt"),
      sha256("callback-facts"),
      FIXED_TIME,
    ];
    const accepted = await executor.query(
      `SELECT videoforge_accept_hosted_cpu_callback($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS accepted`,
      callback,
    );
    assert.equal(accepted.rows[0].accepted, true);
    await executor.query(
      `SELECT videoforge_accept_hosted_cpu_callback($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      callback,
    );
    const replay = await executor.query(
      `SELECT state, result_receipt_sha256, result_content_length,
              result_checksum_sha256, replay_count,
              (SELECT count(*)::int FROM hosted_cpu_job_events WHERE attempt_id = $1) AS events
         FROM hosted_cpu_job_attempts WHERE id = $1`,
      [attempt],
    );
    assert.deepEqual(replay.rows, [
      {
        state: "RECONCILING",
        result_receipt_sha256: sha256("commit-receipt"),
        result_content_length: 512,
        result_checksum_sha256: sha256("result-bytes"),
        replay_count: 1,
        events: 1,
      },
    ]);

    const cancelled = await executor.query(
      `SELECT videoforge_accept_hosted_cpu_callback($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS accepted`,
      [
        cancelledAttempt,
        sha256(`callback-${cancelledAttempt}`),
        execution.replace("execution-a", cancelledAttempt),
        "SUCCEEDED",
        resultKey.replace(attempt, cancelledAttempt),
        512,
        sha256("late-bytes"),
        sha256("late-receipt"),
        sha256("late-facts"),
        FIXED_TIME,
      ],
    );
    assert.equal(cancelled.rows[0].accepted, true);
    const fence = await executor.query(
      `SELECT state, result_receipt_sha256 FROM hosted_cpu_job_attempts WHERE id = $1`,
      [cancelledAttempt],
    );
    assert.deepEqual(fence.rows, [{ state: "CANCEL_REQUESTED", result_receipt_sha256: null }]);

    await executor.query(`SELECT set_config('videoforge.account_id', $1, false)`, [IDS.accountA]);
    await executor.query(
      `UPDATE hosted_cpu_job_attempts
          SET state = 'CANCELLED', terminal_at = now() - interval '2 hours',
              deadline_at = now() - interval '2 hours', retain_until = now() - interval '1 hour'
        WHERE id = $1`,
      [cancelledAttempt],
    );
    await executor.query(`SELECT set_config('videoforge.account_id', '', false)`);
    const due = await executor.query(
      `SELECT attempt_id, object_prefix FROM videoforge_due_hosted_cpu_retention(25)`,
    );
    assert.deepEqual(due.rows, [
      {
        attempt_id: cancelledAttempt,
        object_prefix: resultKey
          .replace(attempt, cancelledAttempt)
          .replace(/\/artifact\/[^/]+$/u, "/artifact/"),
      },
    ]);
    const retained = await executor.query(
      `SELECT videoforge_finish_hosted_cpu_retention($1, $2) AS accepted`,
      [cancelledAttempt, sha256("retention-facts")],
    );
    assert.equal(retained.rows[0].accepted, true);
    const retention = await executor.query(
      `SELECT retention_deleted_at IS NOT NULL AS deleted,
              (SELECT kind FROM hosted_cpu_job_events WHERE attempt_id = $1 ORDER BY sequence DESC LIMIT 1) AS kind
         FROM hosted_cpu_job_attempts WHERE id = $1`,
      [cancelledAttempt],
    );
    assert.deepEqual(retention.rows, [{ deleted: true, kind: "RETENTION_DELETED" }]);
  });
});

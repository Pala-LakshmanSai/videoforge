import assert from "node:assert/strict";
import test from "node:test";

import {
  FIXED_TIME,
  expectDatabaseError,
  sha256,
  uuid,
  withMigratedDatabase,
} from "./support/pglite.mjs";
import { HASHES, IDS, seedLockedProjects } from "./support/fixtures.mjs";

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

test("hosted auth database rejects credential-provider rows", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedInvite(executor, 3, "google-only@example.test");
    await insertHostedUser(executor, "hosted-user-google-only-0001", "google-only@example.test");
    await expectDatabaseError(
      executor.query(
        `INSERT INTO hosted_auth_accounts (
           id, provider_account_id, provider_id, user_id, password, created_at, updated_at
         ) VALUES ($1, $2, 'credential', $3, 'forbidden-password', $4, $4)`,
        [
          "hosted-account-credential-0001",
          "credential-google-only-0001",
          "hosted-user-google-only-0001",
          FIXED_TIME,
        ],
      ),
      "23514",
    );
  });
});

test("exact hosted invite redemption atomically consumes one invite and creates one private account", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    const identities = [
      [11, "hosted-user-alpha-00000001", "alpha@example.test"],
      [12, "hosted-user-bravo-00000001", "bravo@example.test"],
    ];
    const sessions = [];
    for (const [ordinal, userId, email] of identities) {
      await seedInvite(executor, ordinal, email);
      await insertHostedUser(executor, userId, email);
      await insertGoogleAccount(executor, `hosted-account-${ordinal}-00000001`, userId);
      const sessionToken = `hosted-session-token-${ordinal}-000000000000000000000001`;
      await insertSession(executor, `hosted-session-${ordinal}-00000001`, userId, sessionToken);
      sessions.push([sessionToken, sha256(`invite-${ordinal}`)]);
    }

    const beforeRedemption = await executor.query(
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
    assert.deepEqual(beforeRedemption.rows, [
      {
        links: 0,
        accounts: 0,
        workspaces: 0,
        memberships: 0,
        consumed: 0,
        redemptions: 0,
      },
    ]);

    for (const [sessionToken, verifierSha256] of sessions) {
      const redemption = await executor.query(
        `SELECT * FROM videoforge_redeem_hosted_invite($1, $2)`,
        [sessionToken, verifierSha256],
      );
      assert.deepEqual(redemption.rows, [{ outcome: "ADMITTED" }]);
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
    const primaryKey = resultKey.replace("result-a", "primary-a");
    for (const [ordinal, id, source, objectKey, contentType, maxBytes] of [
      [1, attempt, "PRIMARY_RESULT_OUTPUT", primaryKey, "video/mp4", 4096],
      [2, attempt, "RESULT_DOCUMENT", resultKey, "application/json", 1048576],
      [
        3,
        cancelledAttempt,
        "RESULT_DOCUMENT",
        resultKey.replace(attempt, cancelledAttempt),
        "application/json",
        1048576,
      ],
    ]) {
      await executor.query(
        `INSERT INTO hosted_cpu_upload_authorities (
           id, account_id, workspace_id, attempt_id, source, object_key,
           content_type, max_bytes, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          uuid(1_210_000 + ordinal),
          IDS.accountA,
          IDS.workspaceA,
          id,
          source,
          objectKey,
          contentType,
          maxBytes,
          FIXED_TIME,
        ],
      );
    }
    await executor.query(`SELECT set_config('videoforge.account_id', '', false)`);

    const upload = [
      attempt,
      sha256(`callback-${attempt}`),
      "PRIMARY_RESULT_OUTPUT",
      primaryKey,
      "video/mp4",
      2048,
      sha256("primary-output"),
      FIXED_TIME,
    ];
    const authorizedUpload = await executor.query(
      `SELECT videoforge_authorize_hosted_cpu_upload($1,$2,$3,$4,$5,$6,$7,$8) AS authorized`,
      upload,
    );
    assert.equal(authorizedUpload.rows[0].authorized, true);
    const replayedUpload = await executor.query(
      `SELECT videoforge_authorize_hosted_cpu_upload($1,$2,$3,$4,$5,$6,$7,$8) AS authorized`,
      upload,
    );
    assert.equal(replayedUpload.rows[0].authorized, true);
    const expectedPrimary = await executor.query(
      `SELECT * FROM videoforge_hosted_cpu_expected_primary_output($1, $2)`,
      [attempt, sha256(`callback-${attempt}`)],
    );
    assert.deepEqual(expectedPrimary.rows, [
      {
        object_key: primaryKey,
        content_type: "video/mp4",
        content_length: 2048,
        checksum_sha256: sha256("primary-output"),
      },
    ]);
    const activeCancellation = await executor.query(
      `SELECT videoforge_hosted_cpu_cancellation_requested($1, $2) AS cancelled`,
      [attempt, sha256(`callback-${attempt}`)],
    );
    assert.equal(activeCancellation.rows[0].cancelled, false);
    const requestedCancellation = await executor.query(
      `SELECT videoforge_hosted_cpu_cancellation_requested($1, $2) AS cancelled`,
      [cancelledAttempt, sha256(`callback-${cancelledAttempt}`)],
    );
    assert.equal(requestedCancellation.rows[0].cancelled, true);
    const forgedCancellation = await executor.query(
      `SELECT videoforge_hosted_cpu_cancellation_requested($1, $2) AS cancelled`,
      [cancelledAttempt, sha256("forged")],
    );
    assert.equal(forgedCancellation.rows[0].cancelled, null);
    const changedUpload = await executor.query(
      `SELECT videoforge_authorize_hosted_cpu_upload($1,$2,$3,$4,$5,$6,$7,$8) AS authorized`,
      [...upload.slice(0, 6), sha256("changed-output"), FIXED_TIME],
    );
    assert.equal(changedUpload.rows[0].authorized, false);
    const cancelledUpload = await executor.query(
      `SELECT videoforge_authorize_hosted_cpu_upload($1,$2,$3,$4,$5,$6,$7,$8) AS authorized`,
      [
        cancelledAttempt,
        sha256(`callback-${cancelledAttempt}`),
        "RESULT_DOCUMENT",
        resultKey.replace(attempt, cancelledAttempt),
        "application/json",
        512,
        sha256("late-result"),
        FIXED_TIME,
      ],
    );
    assert.equal(cancelledUpload.rows[0].authorized, false);

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

test("personal workers are tenant-bound, single-leased, and queued cancellation stays valid", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedLockedProjects(executor);
    const cancelledAttempt = uuid(1_300_001);
    const leasedAttempt = uuid(1_300_002);
    const enrollment = uuid(1_300_003);
    const device = uuid(1_300_004);
    const lease = uuid(1_300_005);
    const installation = uuid(1_300_006);
    const objectKey = (attempt) =>
      `tenant/${IDS.accountA}/workspace/${IDS.workspaceA}/project/${IDS.projectA}/revision/${IDS.revisionA}/lane/render/job/${attempt}/artifact/result`;

    await executor.query(`SELECT set_config('videoforge.account_id', $1, false)`, [IDS.accountA]);
    for (const attempt of [cancelledAttempt, leasedAttempt]) {
      await executor.query(
        `INSERT INTO hosted_cpu_job_attempts (
           id, account_id, workspace_id, project_id, project_revision_id, kind, state,
           request_sha256, job_spec_object_key, job_spec_content_length,
           job_spec_checksum_sha256, result_object_key, image_digest,
           callback_token_sha256, deadline_at, execution_backend, execution_bundle_sha256,
           created_at, updated_at
         ) VALUES (
           $1,$2,$3,$4,$5,'RENDER','OUTBOXED',$6,$7,128,$8,$9,$10,$11,$12,
           'PERSONAL_WORKER',$13,$14,$14
         )`,
        [
          attempt,
          IDS.accountA,
          IDS.workspaceA,
          IDS.projectA,
          IDS.revisionA,
          sha256(`request-${attempt}`),
          objectKey(attempt).replace("result", "job-spec"),
          sha256(`spec-${attempt}`),
          objectKey(attempt),
          sha256("execution-bundle"),
          sha256(`callback-${attempt}`),
          LATER,
          sha256("execution-bundle"),
          FIXED_TIME,
        ],
      );
    }

    const queuedCancellation = await executor.query(
      `UPDATE hosted_cpu_job_attempts
          SET state = 'CANCELLED', cancellation_requested_at = now(),
              submitted_at = COALESCE(submitted_at, now()), terminal_at = now(),
              retain_until = GREATEST(deadline_at, now() + interval '30 minutes'), version = version + 1
        WHERE id = $1 AND state = 'OUTBOXED'
      RETURNING state, submitted_at IS NOT NULL AS submitted`,
      [cancelledAttempt],
    );
    assert.deepEqual(queuedCancellation.rows, [{ state: "CANCELLED", submitted: true }]);

    await executor.query(
      `INSERT INTO media_worker_enrollments (
         id, display_name, platform, architecture, worker_version, protocol_version,
         execution_bundle_sha256, installation_id, pkce_challenge, poll_token_sha256, credential_token_sha256,
         state, account_id, workspace_id, expires_at, approved_at, created_at
       ) VALUES ($1,'Editing PC','WINDOWS','X86_64','0.1.0',1,'sha256:${"b".repeat(64)}',$2,$3,$4,$5,
                 'APPROVED',$6,$7,$8,$9,$9)`,
      [
        enrollment,
        installation,
        "a".repeat(43),
        sha256("poll"),
        sha256("device-token"),
        IDS.accountA,
        IDS.workspaceA,
        LATER,
        FIXED_TIME,
      ],
    );
    await executor.query(
      `INSERT INTO media_worker_devices (
         id, account_id, workspace_id, enrollment_id, display_name, platform, architecture,
         worker_version, protocol_version, execution_bundle_sha256, installation_id, credential_token_sha256, status,
         last_seen_at, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,'Editing PC','WINDOWS','X86_64','0.1.0',1,
                 'sha256:${"b".repeat(64)}',$5,$6,'BUSY',$7,$7,$7)`,
      [
        device,
        IDS.accountA,
        IDS.workspaceA,
        enrollment,
        installation,
        sha256("device-token"),
        FIXED_TIME,
      ],
    );
    await executor.query(
      `INSERT INTO media_worker_leases (
         id, account_id, workspace_id, attempt_id, device_id, lease_token_sha256, state,
         lease_expires_at, last_heartbeat_at, claimed_at, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,'RUNNING',$7,$8,$8,$8,$8)`,
      [
        lease,
        IDS.accountA,
        IDS.workspaceA,
        leasedAttempt,
        device,
        sha256("lease-token"),
        LATER,
        FIXED_TIME,
      ],
    );
    await expectDatabaseError(
      executor.query(
        `INSERT INTO media_worker_leases (
           id, account_id, workspace_id, attempt_id, device_id, lease_token_sha256, state,
           lease_expires_at, last_heartbeat_at, claimed_at
         ) VALUES ($1,$2,$3,$4,$5,$6,'RUNNING',$7,$8,$8)`,
        [
          uuid(1_300_007),
          IDS.accountA,
          IDS.workspaceA,
          leasedAttempt,
          device,
          sha256("other-lease-token"),
          LATER,
          FIXED_TIME,
        ],
      ),
      "23505",
    );

    await executor.query(`SELECT set_config('videoforge.account_id', '', false)`);
    const authenticated = await executor.query(
      `SELECT * FROM videoforge_media_worker_device_scope($1)`,
      [sha256("device-token")],
    );
    assert.equal(authenticated.rows.length, 1);
    assert.equal(authenticated.rows[0].account_id, IDS.accountA);
    const forged = await executor.query(`SELECT * FROM videoforge_media_worker_device_scope($1)`, [
      sha256("forged-device-token"),
    ]);
    assert.deepEqual(forged.rows, []);

    const foreignEnrollment = uuid(1_300_008);
    await executor.query(
      `INSERT INTO media_worker_enrollments (
         id, display_name, platform, architecture, worker_version, protocol_version,
         execution_bundle_sha256, installation_id, pkce_challenge, poll_token_sha256,
         credential_token_sha256, state, account_id, workspace_id, expires_at, approved_at, created_at
       ) VALUES ($1,'Foreign Mac','MACOS','AARCH64','0.1.0',1,'sha256:${"b".repeat(64)}',$2,$3,$4,$5,
                 'APPROVED',$6,$7,$8,$9,$9)`,
      [
        foreignEnrollment,
        uuid(1_300_009),
        "c".repeat(43),
        sha256("foreign-poll"),
        sha256("foreign-device-token"),
        IDS.accountB,
        IDS.workspaceB,
        LATER,
        FIXED_TIME,
      ],
    );
    await executor.query(`SELECT set_config('videoforge.account_id', $1, false)`, [IDS.accountA]);
    await expectDatabaseError(
      executor.query(
        `INSERT INTO media_worker_devices (
           id, account_id, workspace_id, enrollment_id, display_name, platform, architecture,
           worker_version, protocol_version, execution_bundle_sha256, installation_id,
           credential_token_sha256, status
         ) VALUES ($1,$2,$3,$4,'Forged','MACOS','AARCH64','0.1.0',1,
                   'sha256:${"b".repeat(64)}',$5,$6,'OFFLINE')`,
        [
          uuid(1_300_010),
          IDS.accountA,
          IDS.workspaceA,
          foreignEnrollment,
          uuid(1_300_011),
          sha256("forged-foreign-device"),
        ],
      ),
      "23503",
    );

    await executor.query(`SELECT set_config('videoforge.account_id', $1, false)`, [IDS.accountB]);
    await expectDatabaseError(
      executor.query(
        `UPDATE media_worker_devices SET display_name = 'Cross tenant' WHERE id = $1`,
        [device],
      ),
      "42501",
    );
  });
});

test("hosted project readiness and review accept only exact tenant-owned durable lineage", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedLockedProjects(executor);
    const requestId = uuid(1_400_001);
    const reservationId = uuid(1_400_002);
    const receiptId = uuid(1_400_003);
    const attemptId = uuid(1_400_004);
    const authorityId = uuid(1_400_005);
    const reviewId = uuid(1_400_006);
    const inputKey =
      `tenant/${IDS.accountA}/workspace/${IDS.workspaceA}/project/${IDS.projectA}` +
      `/revision/${IDS.revisionA}/lane/input/job/browser-upload/artifact/voiceover`;
    const outputKey =
      `tenant/${IDS.accountA}/workspace/${IDS.workspaceA}/project/${IDS.projectA}` +
      `/revision/${IDS.revisionA}/lane/render/job/${attemptId}/artifact/final-video`;
    const outputChecksum = sha256("hosted-review-output");

    await executor.query(`SELECT set_config('videoforge.account_id', $1, false)`, [IDS.accountA]);
    await executor.query(
      `INSERT INTO artifact_reservations (
         id, account_id, workspace_id, project_id, project_revision_id, asset_id,
         lane, job_id, artifact_id, object_key, method, content_type, content_length,
         checksum_sha256, expires_at, max_uses, retention_class, deletion_owner_account_id
       ) VALUES ($1,$2,$3,$4,$5,$6,'INPUT','browser-upload','voiceover',$7,'PUT',
                 'audio/wav',128,$8,'2099-01-01T00:10:00Z',1,'PROJECT',$2)`,
      [
        reservationId,
        IDS.accountA,
        IDS.workspaceA,
        IDS.projectA,
        IDS.revisionA,
        IDS.voiceoverA,
        inputKey,
        HASHES.voiceoverA,
      ],
    );
    await executor.query(
      `INSERT INTO hosted_project_create_requests (
         id, account_id, workspace_id, idempotency_key, request_sha256, project_id,
         project_revision_id, voiceover_asset_id, upload_reservation_id,
         upload_receipt_id, state
       ) VALUES ($1,$2,$3,'hosted-project-lineage-0001',$4,$5,$6,$7,$8,$9,'UPLOAD_PENDING')`,
      [
        requestId,
        IDS.accountA,
        IDS.workspaceA,
        sha256("hosted-project-request"),
        IDS.projectA,
        IDS.revisionA,
        IDS.voiceoverA,
        reservationId,
        receiptId,
      ],
    );
    await expectDatabaseError(
      executor.query(
        `UPDATE hosted_project_create_requests SET state = 'READY', ready_at = $2 WHERE id = $1`,
        [requestId, FIXED_TIME],
      ),
      "23514",
    );
    await executor.query(
      `INSERT INTO artifact_receipts (
         id, account_id, workspace_id, reservation_id, callback_id, object_key,
         content_type, content_length, checksum_sha256, receipt_sha256, committed_at
       ) VALUES ($1,$2,$3,$4,'browser-upload',$5,'audio/wav',128,$6,$7,$8)`,
      [
        receiptId,
        IDS.accountA,
        IDS.workspaceA,
        reservationId,
        inputKey,
        HASHES.voiceoverA,
        sha256("hosted-voiceover-receipt"),
        FIXED_TIME,
      ],
    );
    await executor.query(
      `UPDATE artifact_reservations SET state = 'COMMITTED', used_count = 1 WHERE id = $1`,
      [reservationId],
    );
    await executor.query(
      `UPDATE hosted_project_create_requests SET state = 'READY', ready_at = $2 WHERE id = $1`,
      [requestId, FIXED_TIME],
    );

    await executor.query(
      `INSERT INTO hosted_cpu_job_attempts (
         id, account_id, workspace_id, project_id, project_revision_id, kind, state,
         request_sha256, job_spec_object_key, job_spec_content_length,
         job_spec_checksum_sha256, result_object_key, image_digest,
         callback_token_sha256, result_receipt_sha256, deadline_at,
         submitted_at, terminal_at, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,'RENDER','SUCCEEDED',$6,$7,128,$8,$9,$10,$11,$12,$13,$14,$14,$14,$14)`,
      [
        attemptId,
        IDS.accountA,
        IDS.workspaceA,
        IDS.projectA,
        IDS.revisionA,
        sha256("hosted-render-request"),
        outputKey.replace("final-video", "job-spec"),
        sha256("hosted-render-job-spec"),
        outputKey.replace("final-video", "result-document"),
        sha256("hosted-render-image"),
        sha256("hosted-render-callback"),
        sha256("hosted-render-result-receipt"),
        LATER,
        FIXED_TIME,
      ],
    );
    await executor.query(
      `INSERT INTO hosted_cpu_upload_authorities (
         id, account_id, workspace_id, attempt_id, source, object_key, content_type,
         max_bytes, issued_content_length, issued_checksum_sha256, issued_at, created_at
       ) VALUES ($1,$2,$3,$4,'PRIMARY_RESULT_OUTPUT',$5,'video/mp4',1048576,2048,$6,$7,$7)`,
      [authorityId, IDS.accountA, IDS.workspaceA, attemptId, outputKey, outputChecksum, FIXED_TIME],
    );
    await expectDatabaseError(
      executor.query(
        `INSERT INTO hosted_project_reviews (
           id, account_id, workspace_id, project_id, render_attempt_id,
           output_checksum_sha256, approved_by_user_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          reviewId,
          IDS.accountA,
          IDS.workspaceA,
          IDS.projectA,
          attemptId,
          sha256("forged"),
          IDS.userA,
        ],
      ),
      "23514",
    );
    await executor.query(
      `INSERT INTO hosted_project_reviews (
         id, account_id, workspace_id, project_id, render_attempt_id,
         output_checksum_sha256, approved_by_user_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [reviewId, IDS.accountA, IDS.workspaceA, IDS.projectA, attemptId, outputChecksum, IDS.userA],
    );
    await expectDatabaseError(
      executor.query(`DELETE FROM hosted_project_reviews WHERE id = $1`, [reviewId]),
      "55000",
    );

    await executor.query(`SELECT set_config('videoforge.account_id', $1, false)`, [IDS.accountB]);
    await expectDatabaseError(
      executor.query(
        `UPDATE hosted_project_create_requests SET ready_at = ready_at WHERE id = $1`,
        [requestId],
      ),
      "42501",
    );
  });
});

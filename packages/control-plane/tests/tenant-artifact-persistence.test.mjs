import assert from "node:assert/strict";
import test from "node:test";

import { IDS, seedLockedProjects } from "./support/fixtures.mjs";
import { expectDatabaseError, sha256, uuid, withMigratedDatabase } from "./support/pglite.mjs";

const RESERVATION = uuid(9201);
const RECEIPT = uuid(9202);
const key = `tenant/${IDS.accountA}/workspace/${IDS.workspaceA}/project/${IDS.projectA}/revision/${IDS.revisionA}/lane/input/job/job-a/artifact/artifact-a`;

async function insertReservation(executor, overrides = {}) {
  const values = {
    id: RESERVATION,
    accountId: IDS.accountA,
    workspaceId: IDS.workspaceA,
    projectId: IDS.projectA,
    revisionId: IDS.revisionA,
    key,
    deletionOwner: IDS.accountA,
    lane: "INPUT",
    jobId: "job-a",
    artifactId: "artifact-a",
    retentionClass: "PROJECT",
    retainUntil: "2099-02-01T00:00:00Z",
    ...overrides,
  };
  return executor.query(
    `INSERT INTO artifact_reservations (
       id, account_id, workspace_id, project_id, project_revision_id, asset_id,
       lane, job_id, artifact_id, object_key, method, content_type, content_length,
       checksum_sha256, expires_at, max_uses, retention_class, retain_until,
       deletion_owner_account_id, created_at
     ) VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, $8, $9,
               'PUT', 'audio/wav', 128, $10, '2099-01-01T00:10:00Z', 1, $11,
               $12, $13, '2099-01-01T00:00:00Z')`,
    [
      values.id,
      values.accountId,
      values.workspaceId,
      values.projectId,
      values.revisionId,
      values.lane,
      values.jobId,
      values.artifactId,
      values.key,
      sha256("artifact-a"),
      values.retentionClass,
      values.retainUntil,
      values.deletionOwner,
    ],
  );
}

test("artifact persistence binds trusted lineage, exact transfer scope, receipt hash/probe, and owner deletion", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedLockedProjects(executor);
    await executor.query("SELECT set_config('videoforge.account_id', $1, false)", [IDS.accountA]);
    await insertReservation(executor);
    await executor.query(
      `INSERT INTO artifact_receipts (
         id, account_id, workspace_id, reservation_id, callback_id, object_key,
         content_type, content_length, checksum_sha256, probe, receipt_sha256, committed_at
       ) VALUES ($1, $2, $3, $4, 'callback-a', $5, 'audio/wav', 128, $6,
                 '{"duration_ms":1000,"decoded":true}'::jsonb, $7, '2099-01-01T00:05:00Z')`,
      [
        RECEIPT,
        IDS.accountA,
        IDS.workspaceA,
        RESERVATION,
        key,
        sha256("artifact-a"),
        sha256("receipt-a"),
      ],
    );
    const stored = await executor.query(
      `SELECT reservation.object_key, reservation.method, reservation.content_type,
              reservation.content_length::text, reservation.checksum_sha256,
              reservation.retention_class, reservation.deletion_owner_account_id,
              receipt.probe::text, receipt.receipt_sha256
         FROM videoforge_tenant_artifact_reservations reservation
         JOIN videoforge_tenant_artifact_receipts receipt
           ON receipt.account_id = reservation.account_id
          AND receipt.workspace_id = reservation.workspace_id
          AND receipt.reservation_id = reservation.id`,
    );
    assert.equal(stored.rows.length, 1);
    assert.equal(stored.rows[0].object_key, key);
    assert.equal(stored.rows[0].method, "PUT");
    assert.equal(stored.rows[0].content_length, "128");
    assert.equal(stored.rows[0].deletion_owner_account_id, IDS.accountA);
    assert.match(stored.rows[0].probe, /duration_ms/u);
  });
});

test("forged keys, cross-tenant ownership, stale receipts, and duplicate callbacks fail in the database", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedLockedProjects(executor);
    await executor.query("SELECT set_config('videoforge.account_id', $1, false)", [IDS.accountA]);
    await expectDatabaseError(
      insertReservation(executor, {
        id: uuid(9211),
        key: `tenant/${IDS.accountB}/workspace/${IDS.workspaceB}/project/${IDS.projectB}/revision/${IDS.revisionB}/lane/input/job/job-a/artifact/artifact-a`,
      }),
      "23514",
    );
    await expectDatabaseError(
      insertReservation(executor, { id: uuid(9212), deletionOwner: IDS.accountB }),
      "23514",
    );
    await expectDatabaseError(
      insertReservation(executor, {
        id: uuid(9215),
        key: key.replace(
          "/lane/input/job/job-a/artifact/artifact-a",
          "/lane/render/job/other-job/artifact/other-artifact",
        ),
      }),
      "23514",
    );
    await insertReservation(executor);
    await expectDatabaseError(
      executor.query(
        `INSERT INTO artifact_receipts (
           id, account_id, workspace_id, reservation_id, callback_id, object_key,
           content_type, content_length, checksum_sha256, receipt_sha256, committed_at
         ) VALUES ($1, $2, $3, $4, 'stale', $5, 'audio/wav', 128, $6, $7,
                   '2099-01-01T00:11:00Z')`,
        [
          uuid(9213),
          IDS.accountA,
          IDS.workspaceA,
          RESERVATION,
          key,
          sha256("artifact-a"),
          sha256("stale"),
        ],
      ),
      "23514",
    );
    await executor.query(
      `INSERT INTO artifact_receipts (
         id, account_id, workspace_id, reservation_id, callback_id, object_key,
         content_type, content_length, checksum_sha256, receipt_sha256, committed_at
       ) VALUES ($1, $2, $3, $4, 'callback-a', $5, 'audio/wav', 128, $6, $7,
                 '2099-01-01T00:05:00Z')`,
      [
        RECEIPT,
        IDS.accountA,
        IDS.workspaceA,
        RESERVATION,
        key,
        sha256("artifact-a"),
        sha256("receipt"),
      ],
    );
    await expectDatabaseError(
      executor.query(
        `INSERT INTO artifact_receipts (
           id, account_id, workspace_id, reservation_id, callback_id, object_key,
           content_type, content_length, checksum_sha256, receipt_sha256, committed_at
         ) VALUES ($1, $2, $3, $4, 'callback-b', $5, 'audio/wav', 128, $6, $7,
                   '2099-01-01T00:05:00Z')`,
        [
          uuid(9214),
          IDS.accountA,
          IDS.workspaceA,
          RESERVATION,
          key,
          sha256("artifact-a"),
          sha256("duplicate"),
        ],
      ),
      "23505",
    );

    await expectDatabaseError(
      executor.query(
        `UPDATE artifact_receipts
            SET deleted_at = '2099-01-01T00:06:00Z', deletion_reason = 'before retention'
          WHERE id = $1`,
        [RECEIPT],
      ),
      "23514",
    );

    const reservationB = uuid(9216);
    const receiptB = uuid(9217);
    const keyB = `tenant/${IDS.accountB}/workspace/${IDS.workspaceB}/project/${IDS.projectB}/revision/${IDS.revisionB}/lane/input/job/job-a/artifact/artifact-a`;
    await executor.query("SELECT set_config('videoforge.account_id', $1, false)", [IDS.accountB]);
    await insertReservation(executor, {
      id: reservationB,
      accountId: IDS.accountB,
      workspaceId: IDS.workspaceB,
      projectId: IDS.projectB,
      revisionId: IDS.revisionB,
      key: keyB,
      deletionOwner: IDS.accountB,
    });
    await executor.query(
      `INSERT INTO artifact_receipts (
         id, account_id, workspace_id, reservation_id, callback_id, object_key,
         content_type, content_length, checksum_sha256, receipt_sha256, committed_at
       ) VALUES ($1, $2, $3, $4, 'callback-a', $5, 'audio/wav', 128, $6, $7,
                 '2099-01-01T00:05:00Z')`,
      [
        receiptB,
        IDS.accountB,
        IDS.workspaceB,
        reservationB,
        keyB,
        sha256("artifact-a"),
        sha256("receipt"),
      ],
    );
    const sameHash = await executor.query(
      "SELECT count(*)::int AS count FROM artifact_receipts WHERE receipt_sha256 = $1",
      [sha256("receipt")],
    );
    assert.equal(sameHash.rows[0].count, 2);
  });
});

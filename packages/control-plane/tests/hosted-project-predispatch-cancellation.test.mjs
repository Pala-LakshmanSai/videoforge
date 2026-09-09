import assert from "node:assert/strict";
import test from "node:test";

import { IDS, seedLockedProjects } from "./support/fixtures.mjs";
import { uuid, withMigratedDatabase } from "./support/pglite.mjs";

const CANCELLATION = Object.freeze({
  request: uuid(2_090_910),
  runtime: uuid(2_090_911),
  mageLane: uuid(2_090_912),
  soulxLane: uuid(2_090_913),
});

test("hosted project owner cancellation terminalizes a waiting predispatch runtime", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedLockedProjects(executor);
    await executor.query("SELECT set_config($1,$2,false)", [
      "videoforge.account_id",
      IDS.accountA,
    ]);
    await executor.query(
      `INSERT INTO generation_requests(id,account_id,workspace_id,project_id,project_revision_id,
        created_by_user_id,state,queue_order,available_at,attempt_ordinal,idempotency_key,
        created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,'WAITING',1,transaction_timestamp(),1,
        'hosted-project-owner-cancel',transaction_timestamp(),transaction_timestamp())`,
      [
        CANCELLATION.request,
        IDS.accountA,
        IDS.workspaceA,
        IDS.projectA,
        IDS.revisionA,
        IDS.userA,
      ],
    );
    await executor.query(
      `INSERT INTO video_runtime_states(id,account_id,workspace_id,project_id,project_revision_id,
        generation_request_id,stage,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,'QUEUED',transaction_timestamp(),transaction_timestamp())`,
      [
        CANCELLATION.runtime,
        IDS.accountA,
        IDS.workspaceA,
        IDS.projectA,
        IDS.revisionA,
        CANCELLATION.request,
      ],
    );
    for (const [id, lane] of [
      [CANCELLATION.mageLane, "mage_image"],
      [CANCELLATION.soulxLane, "soulx_avatar"],
    ]) {
      await executor.query(
        `INSERT INTO video_runtime_lane_states(id,account_id,workspace_id,runtime_id,
          project_revision_id,lane,state,created_at,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,'BLOCKED_ON_PREPARATION',transaction_timestamp(),
          transaction_timestamp())`,
        [id, IDS.accountA, IDS.workspaceA, CANCELLATION.runtime, IDS.revisionA, lane],
      );
    }

    const cancelled = await executor.query(
      `SELECT * FROM videoforge_cancel_hosted_project_predispatch($1,$2,$3)`,
      [IDS.accountA, IDS.workspaceA, IDS.projectA],
    );
    assert.deepEqual(cancelled.rows, [
      {
        project_id: IDS.projectA,
        generation_request_id: CANCELLATION.request,
        state: "CANCELLED",
        replayed: false,
      },
    ]);
    const request = await executor.query(
      `SELECT state,terminal_at IS NOT NULL AS terminal FROM generation_requests WHERE id=$1`,
      [CANCELLATION.request],
    );
    assert.deepEqual(request.rows, [{ state: "CANCELLED", terminal: true }]);
    const runtime = await executor.query(
      `SELECT stage,terminal_reason,terminal_at IS NOT NULL AS terminal
         FROM video_runtime_states WHERE id=$1`,
      [CANCELLATION.runtime],
    );
    assert.deepEqual(runtime.rows, [
      { stage: "CANCELED", terminal_reason: "SYSTEM_CANCELLED", terminal: true },
    ]);
    const lanes = await executor.query(
      `SELECT lane,state FROM video_runtime_lane_states WHERE runtime_id=$1 ORDER BY lane`,
      [CANCELLATION.runtime],
    );
    assert.deepEqual(lanes.rows, [
      { lane: "mage_image", state: "CANCELED" },
      { lane: "soulx_avatar", state: "CANCELED" },
    ]);
    const audit = await executor.query(
      `SELECT operation,request_id,lease_id,detail->>'reason' AS reason
         FROM generation_queue_audits WHERE request_id=$1`,
      [CANCELLATION.request],
    );
    assert.deepEqual(audit.rows, [
      {
        operation: "CANCEL_WAITING",
        request_id: CANCELLATION.request,
        lease_id: null,
        reason: "OWNER_CANCELLED_BEFORE_PROVIDER_DISPATCH",
      },
    ]);
  });
});

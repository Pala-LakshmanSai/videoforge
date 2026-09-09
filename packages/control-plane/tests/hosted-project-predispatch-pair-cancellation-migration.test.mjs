import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { IDS, seedLockedProjects } from "./support/fixtures.mjs";
import { expectDatabaseError, sha256, uuid, withMigratedDatabase } from "./support/pglite.mjs";

const SQL = readFileSync(
  new URL("../migrations/0112_hosted_project_owner_pair_cancellation.sql", import.meta.url),
  "utf8",
);

const PAIR = Object.freeze({
  request: uuid(2_112_001),
  runtime: uuid(2_112_002),
  mageLane: uuid(2_112_003),
  soulxLane: uuid(2_112_004),
  mageTask: uuid(2_112_005),
  soulxTask: uuid(2_112_006),
  mageDeployment: uuid(2_112_007),
  soulxDeployment: uuid(2_112_008),
  mageAttempt: uuid(2_112_009),
  soulxAttempt: uuid(2_112_010),
  mageAuthority: uuid(2_112_011),
  soulxAuthority: uuid(2_112_012),
  mageOutbox: uuid(2_112_013),
  soulxOutbox: uuid(2_112_014),
  mageMaterialization: uuid(2_112_015),
  soulxMaterialization: uuid(2_112_016),
});

async function seedExactPair(executor) {
  await seedLockedProjects(executor);
  await executor.query("SELECT set_config($1,$2,false)", ["videoforge.account_id", IDS.accountA]);
  await executor.query(
    `INSERT INTO generation_requests(id,account_id,workspace_id,project_id,project_revision_id,
      created_by_user_id,state,queue_order,available_at,attempt_ordinal,idempotency_key,admitted_at,
      created_at,updated_at)
     VALUES($1,$2,$3,$4,$5,$6,'ACTIVE',1,transaction_timestamp(),1,$7,
       transaction_timestamp(),transaction_timestamp(),transaction_timestamp())`,
    [
      PAIR.request,
      IDS.accountA,
      IDS.workspaceA,
      IDS.projectA,
      IDS.revisionA,
      IDS.userA,
      "0112-cancel-pair",
    ],
  );
  await executor.query(
    `INSERT INTO provider_workload_leases(id,slot,account_id,workspace_id,request_kind,
      generation_request_id,owner_token_sha256,state,acquired_at,heartbeat_at,expires_at)
     VALUES($1,1,$2,$3,'VIDEO',$4,$5,'ACTIVE',transaction_timestamp(),transaction_timestamp(),
       transaction_timestamp()+interval '1 hour')`,
    [
      uuid(2_112_017),
      IDS.accountA,
      IDS.workspaceA,
      PAIR.request,
      sha256("0112-owner"),
    ],
  );
  await executor.query(
    `INSERT INTO video_runtime_states(id,account_id,workspace_id,project_id,project_revision_id,
      generation_request_id,stage,preparation_manifest_sha256,admitted_at,prepared_at,
      created_at,updated_at)
     VALUES($1,$2,$3,$4,$5,$6,'WAITING_FOR_WORKER',$7,transaction_timestamp(),
       transaction_timestamp(),transaction_timestamp(),transaction_timestamp())`,
    [
      PAIR.runtime,
      IDS.accountA,
      IDS.workspaceA,
      IDS.projectA,
      IDS.revisionA,
      PAIR.request,
      sha256("0112-preparation"),
    ],
  );
  for (const [id, lane] of [
    [PAIR.mageLane, "mage_image"],
    [PAIR.soulxLane, "soulx_avatar"],
  ]) {
    await executor.query(
      `INSERT INTO video_runtime_lane_states(id,account_id,workspace_id,runtime_id,
        project_revision_id,lane,state,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,'BLOCKED_ON_PREPARATION',transaction_timestamp(),
        transaction_timestamp())`,
      [id, IDS.accountA, IDS.workspaceA, PAIR.runtime, IDS.revisionA, lane],
    );
  }
  for (const [id, lane] of [
    [PAIR.mageTask, "IMAGE"],
    [PAIR.soulxTask, "AVATAR"],
  ]) {
    await executor.query(
      `INSERT INTO generation_tasks(id,account_id,workspace_id,owner_type,owner_id,
        project_revision_id,task_key,lane,state,required,depends_on,created_at,updated_at)
       VALUES($1,$2,$3,'PROJECT_REVISION',$4,$4,$5,$6,'BLOCKED',true,'[]',
        transaction_timestamp(),transaction_timestamp())`,
      [id, IDS.accountA, IDS.workspaceA, IDS.revisionA, `0112:${lane.toLowerCase()}`, lane],
    );
  }

  const lanes = [
    {
      lane: "mage_image",
      digit: "mage",
      deploymentId: PAIR.mageDeployment,
      attemptId: PAIR.mageAttempt,
      authorityId: PAIR.mageAuthority,
      outboxId: PAIR.mageOutbox,
      materializationId: PAIR.mageMaterialization,
      taskId: PAIR.mageTask,
      checkpoint: "V2-07",
    },
    {
      lane: "soulx_avatar",
      digit: "soulx",
      deploymentId: PAIR.soulxDeployment,
      attemptId: PAIR.soulxAttempt,
      authorityId: PAIR.soulxAuthority,
      outboxId: PAIR.soulxOutbox,
      materializationId: PAIR.soulxMaterialization,
      taskId: PAIR.soulxTask,
      checkpoint: "V2-08",
    },
  ];
  for (const item of lanes) {
    const endpointProfile = `test:${item.digit}`;
    await executor.query(
      `INSERT INTO serverless_endpoint_deployments(id,lane,endpoint_profile_id,endpoint_id_sha256,
        endpoint_config_sha256,worker_image_digest,model_manifest_sha256,region,volume_id_sha256,
        volume_manifest_sha256,volume_mount,volume_size_gb,gpu_allowlist,gpu_count_per_worker,
        worker_count_min,worker_count_max,worker_ceiling_scope,retained_active_workers,scaler_type,
        scaler_value,handler_concurrency,idle_timeout_seconds,init_timeout_seconds,
        execution_timeout_seconds,request_ttl_seconds,request_ttl_scope,reconciliation_deadline_seconds,
        provider_result_window_seconds,polling_interval_seconds,max_replacement_attempts,
        blind_resubmit_permitted,timeout_evidence,deployment_version,is_active,record_sha256,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,'EU-RO-1',$8,$9,'/runpod-volume',50,
        ARRAY['NVIDIA GeForce RTX 4090'],1,0,2,'ACTIVE_PLUS_FLEX',0,'REQUEST_COUNT',1,1,
        5,900,2400,7200,'PROVIDER_QUEUE_PLUS_EXECUTION_PLUS_OUTPUT_UPLOAD',1500,1800,5,1,
        false,$10::jsonb,1,true,$11,transaction_timestamp())`,
      [
        item.deploymentId,
        item.lane,
        endpointProfile,
        sha256(`${item.digit}-endpoint`),
        sha256(`${item.digit}-config`),
        sha256(`${item.digit}-image`),
        sha256(`${item.digit}-model`),
        sha256(`${item.digit}-volume`),
        sha256(`${item.digit}-volume-manifest`),
        JSON.stringify({ provider_defaults_accepted: false }),
        sha256(`${item.digit}-deployment`),
      ],
    );
    const token = sha256(`0112-token-${item.lane}`);
    const body = sha256(`0112-body-${item.lane}`);
    const items = sha256(`0112-items-${item.lane}`);
    const input = sha256(`0112-input-${item.lane}`);
    const envelope = sha256(`0112-envelope-${item.lane}`);
    const authority = sha256(`0112-authority-${item.lane}`);
    const outputPrefix =
      `tenant/${IDS.accountA}/workspace/${IDS.workspaceA}/project/${IDS.projectA}/revision/${IDS.revisionA}/lane/${item.lane}/job/${item.attemptId}`;
    await executor.query(
      `INSERT INTO serverless_attempts(id,account_id,workspace_id,project_id,project_revision_id,
        generation_request_id,task_id,deployment_id,lane,attempt_ordinal,state,
        dispatch_token_sha256,items_manifest_sha256,item_count,input_manifest_sha256,output_prefix,
        deadline_at,reconciliation_deadline_at,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,1,'OUTBOXED',$10,$11,1,$12,$13,
        transaction_timestamp()+interval '1 hour',transaction_timestamp()+interval '30 minutes',
        transaction_timestamp(),transaction_timestamp())`,
      [
        item.attemptId,
        IDS.accountA,
        IDS.workspaceA,
        IDS.projectA,
        IDS.revisionA,
        PAIR.request,
        item.taskId,
        item.deploymentId,
        item.lane,
        token,
        items,
        input,
        outputPrefix,
      ],
    );
    await executor.query(
      `INSERT INTO serverless_predispatch_authorities(
        id,account_id,workspace_id,project_revision_id,attempt_id,dispatch_token_sha256,
        checkpoint_id,authority_mode,non_transferable,allowed_operations,deployment_id,
        endpoint_id_sha256,endpoint_config_sha256,worker_image_digest,model_manifest_sha256,
        volume_id_sha256,volume_manifest_sha256,region,gpu_allowlist,items_manifest_sha256,
        input_manifest_sha256,request_body_sha256,envelope_sha256,deadline_at,
        reconciliation_deadline_at,request_ttl_seconds,execution_timeout_seconds,
        init_timeout_seconds,spend_ceiling_usd,reservation_usd,rate_source,rate_checked_at,
        fixed_retained_volume_usd_excluded,authority_sha256,committed_at)
       SELECT $1,$2,$3,$4,$5,$6,$7,'paid',true,
         ARRAY['serverless_run','serverless_status','serverless_cancel'],d.id,
         d.endpoint_id_sha256,d.endpoint_config_sha256,d.worker_image_digest,d.model_manifest_sha256,
         d.volume_id_sha256,d.volume_manifest_sha256,d.region,d.gpu_allowlist,$8,$9,$10,$11,
         transaction_timestamp()+interval '1 hour',transaction_timestamp()+interval '30 minutes',
         2400,7200,900,1,0.5,'0112-test',transaction_timestamp(),true,$12,transaction_timestamp()
       FROM serverless_endpoint_deployments d WHERE d.id=$13`,
      [
        item.authorityId,
        IDS.accountA,
        IDS.workspaceA,
        IDS.revisionA,
        item.attemptId,
        token,
        item.checkpoint,
        items,
        input,
        body,
        envelope,
        authority,
        item.deploymentId,
      ],
    );
    await executor.query(
      `INSERT INTO serverless_dispatch_outbox(
        id,account_id,workspace_id,project_revision_id,attempt_id,dispatch_token_sha256,
        authority_sha256,request_body_sha256,state,send_attempt_count,max_send_attempts,
        created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,'READY_TO_DISPATCH',0,1,
        transaction_timestamp(),transaction_timestamp())`,
      [
        item.outboxId,
        IDS.accountA,
        IDS.workspaceA,
        IDS.revisionA,
        item.attemptId,
        token,
        authority,
        body,
      ],
    );
    await executor.query(
      `INSERT INTO hosted_v209_ordinary_lane_materializations(
        attempt_id,account_id,workspace_id,generation_request_id,lane,envelope_sha256,
        full_request_sha256,request_body,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,transaction_timestamp())`,
      [
        item.attemptId,
        IDS.accountA,
        IDS.workspaceA,
        PAIR.request,
        item.lane,
        envelope,
        sha256(`0112-full-request-${item.lane}`),
        JSON.stringify({ schema_version: "videoforge-hosted-v209-ordinary-request/v1" }),
      ],
    );
  }
  return lanes;
}

test("0112 cancels an exact untouched OUTBOXED pair and retains immutable lineage", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedExactPair(executor);
    const cancelled = await executor.query(
      "SELECT * FROM videoforge_cancel_hosted_project_predispatch($1,$2,$3)",
      [IDS.accountA, IDS.workspaceA, IDS.projectA],
    );
    assert.deepEqual(cancelled.rows, [
      {
        project_id: IDS.projectA,
        generation_request_id: PAIR.request,
        state: "CANCELLED",
        replayed: false,
      },
    ]);
    assert.deepEqual(
      (
        await executor.query(
          `SELECT state,send_attempt_count FROM serverless_dispatch_outbox
             WHERE attempt_id IN ($1,$2) ORDER BY attempt_id`,
          [PAIR.mageAttempt, PAIR.soulxAttempt],
        )
      ).rows,
      [
        { state: "DEAD_LETTER", send_attempt_count: 0 },
        { state: "DEAD_LETTER", send_attempt_count: 0 },
      ],
    );
    assert.deepEqual(
      (
        await executor.query(
          `SELECT state FROM serverless_attempts
             WHERE id IN ($1,$2) ORDER BY id`,
          [PAIR.mageAttempt, PAIR.soulxAttempt],
        )
      ).rows,
      [{ state: "CANCELLED" }, { state: "CANCELLED" }],
    );
    assert.equal(
      (
        await executor.query(
          "SELECT count(*)::int AS count FROM hosted_v209_ordinary_lane_materializations",
        )
      ).rows[0].count,
      2,
    );
    assert.equal(
      (
        await executor.query(
          "SELECT count(*)::int AS count FROM serverless_predispatch_authorities",
        )
      ).rows[0].count,
      2,
    );
    assert.deepEqual(
      (
        await executor.query(
          `SELECT request.state,lease.state AS lease_state,runtime.stage,runtime.terminal_reason,
              (SELECT count(*) FROM generation_tasks WHERE state='CANCELLED')::int AS cancelled_tasks
             FROM generation_requests request
             JOIN provider_workload_leases lease ON lease.generation_request_id=request.id
             JOIN video_runtime_states runtime ON runtime.generation_request_id=request.id
            WHERE request.id=$1`,
          [PAIR.request],
        )
      ).rows,
      [
        {
          state: "CANCELLED",
          lease_state: "RELEASED",
          stage: "CANCELED",
          terminal_reason: "OWNER_CANCELLED",
          cancelled_tasks: 2,
        },
      ],
    );
  });
});

test("0112 treats materialization as construction lineage and guards every provider evidence table", () => {
  const providerBoundary = SQL.slice(
    SQL.indexOf("  SELECT\n    (SELECT count(*) FROM public.serverless_provider_assignments"),
    SQL.indexOf("  IF provider_boundary_count<>0"),
  );
  assert.doesNotMatch(providerBoundary, /hosted_v209_ordinary_lane_materializations/u);
  for (const evidence of [
    "serverless_provider_assignments",
    "serverless_progress_events",
    "serverless_output_receipts",
    "serverless_reconciliations",
    "serverless_provenance_receipts",
    "hosted_pair_cleanup_observations",
    "hosted_serverless_output_barrier_completions",
    "hosted_pair_runtime_states",
  ])
    assert.match(SQL, new RegExp(evidence, "u"));
  assert.match(SQL, /state='DEAD_LETTER'/u);
  assert.match(SQL, /attempt\.state IN \('PLANNED','OUTBOXED'\)/u);
  assert.match(SQL, /materialization_count NOT IN \(0,2\)/u);
});

test("0112 rejects an exact-looking pair after an outbox send", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedExactPair(executor);
    await executor.query(
      `UPDATE serverless_dispatch_outbox
          SET state='SENT',send_attempt_count=1,version=version+1,updated_at=transaction_timestamp()
        WHERE attempt_id=$1`,
      [PAIR.mageAttempt],
    );
    await expectDatabaseError(
      () =>
        executor.query(
          "SELECT * FROM videoforge_cancel_hosted_project_predispatch($1,$2,$3)",
          [IDS.accountA, IDS.workspaceA, IDS.projectA],
        ),
      "55000",
    );
    assert.equal(
      (
        await executor.query("SELECT state FROM generation_requests WHERE id=$1", [PAIR.request])
      ).rows[0].state,
      "ACTIVE",
    );
  });
});

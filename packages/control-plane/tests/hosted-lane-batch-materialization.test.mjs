import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalSha256,
  exportMetadataSnapshot,
  restoreMetadataSnapshot,
  serializeMetadataSnapshot,
} from "../dist/src/index.js";
import { IDS, seedLockedProjects } from "./support/fixtures.mjs";
import {
  createMigratedDatabase,
  expectDatabaseError,
  sha256,
  uuid,
  withMigratedDatabase,
} from "./support/pglite.mjs";

export async function seedMaterialization(executor) {
  await seedLockedProjects(executor);
  await executor.query("SELECT set_config($1,$2,false)", ["videoforge.account_id", IDS.accountA]);
  const generationRequestId = uuid(1_410_001);
  const leaseId = uuid(1_410_002);
  const runtimeId = uuid(1_410_003);
  const planSha256 = sha256("0041-plan");
  const tasks = [
    { id: uuid(1_410_011), task_key: "image:segment:001", lane: "IMAGE", segment: uuid(1_410_021) },
    {
      id: uuid(1_410_012),
      task_key: "avatar:segment:002",
      lane: "AVATAR",
      segment: uuid(1_410_022),
    },
  ];
  await executor.query(
    `INSERT INTO generation_requests(id,account_id,workspace_id,project_id,project_revision_id,
      created_by_user_id,state,queue_order,available_at,attempt_ordinal,idempotency_key,admitted_at,
      created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'ACTIVE',1,transaction_timestamp(),1,
      '0041-request',transaction_timestamp(),transaction_timestamp(),transaction_timestamp())`,
    [generationRequestId, IDS.accountA, IDS.workspaceA, IDS.projectA, IDS.revisionA, IDS.userA],
  );
  await executor.query(
    `INSERT INTO provider_workload_leases(id,slot,account_id,workspace_id,request_kind,
      generation_request_id,owner_token_sha256,state,acquired_at,heartbeat_at,expires_at)
      VALUES($1,1,$2,$3,'VIDEO',$4,$5,'ACTIVE',transaction_timestamp(),transaction_timestamp(),
      transaction_timestamp()+interval '1 hour')`,
    [leaseId, IDS.accountA, IDS.workspaceA, generationRequestId, sha256("0041-owner")],
  );
  for (const task of tasks) {
    await executor.query(
      `INSERT INTO generation_tasks(id,account_id,workspace_id,owner_type,owner_id,
        project_revision_id,task_key,lane,state,required,depends_on)
       VALUES($1,$2,$3,'PROJECT_REVISION',$4,$4,$5,$6,'BLOCKED',true,'[]')`,
      [task.id, IDS.accountA, IDS.workspaceA, IDS.revisionA, task.task_key, task.lane],
    );
  }
  await executor.execute("ALTER TABLE hosted_canonical_timing_bridges DISABLE TRIGGER ALL");
  await executor.query(
    `INSERT INTO hosted_canonical_timing_bridges(hosted_asr_attempt_id,account_id,workspace_id,
      project_id,project_revision_id,transcript_id,transcript_document_hash,timeline_plan_id,
      timeline_document_hash,asr_input_sha256,asr_result_sha256,generation_plan_sha256,
      task_manifest,append_payload,completed_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,transaction_timestamp())`,
    [
      uuid(1_410_030),
      IDS.accountA,
      IDS.workspaceA,
      IDS.projectA,
      IDS.revisionA,
      uuid(1_410_031),
      sha256("transcript"),
      uuid(1_410_032),
      sha256("timeline"),
      sha256("asr-input"),
      sha256("asr-output"),
      planSha256,
      JSON.stringify(
        tasks.map((task) => ({
          id: task.id,
          task_key: task.task_key,
          lane: task.lane,
          timeline_segment_id: task.segment,
          depends_on: [],
        })),
      ),
      JSON.stringify({ schema_version: "videoforge-hosted-canonical-timing-append/v1" }),
    ],
  );
  await executor.execute("ALTER TABLE hosted_canonical_timing_bridges ENABLE TRIGGER ALL");
  await executor.query(
    `INSERT INTO video_runtime_states(id,account_id,workspace_id,project_id,project_revision_id,
      generation_request_id,stage,preparation_manifest_sha256,admitted_at,prepared_at,created_at,updated_at)
     VALUES($1,$2,$3,$4,$5,$6,'WAITING_FOR_WORKER',$7,transaction_timestamp(),
       transaction_timestamp(),transaction_timestamp(),transaction_timestamp())`,
    [
      runtimeId,
      IDS.accountA,
      IDS.workspaceA,
      IDS.projectA,
      IDS.revisionA,
      generationRequestId,
      sha256("preparation"),
    ],
  );
  const laneDefinitions = [
    [
      "mage_image",
      canonicalSha256([
        {
          item_id: tasks[0].id,
          task_id: tasks[0].id,
          task_key: tasks[0].task_key,
          timeline_segment_id: tasks[0].segment,
        },
      ]),
      uuid(1_410_041),
    ],
    [
      "soulx_avatar",
      canonicalSha256([
        {
          item_id: tasks[1].id,
          task_id: tasks[1].id,
          task_key: tasks[1].task_key,
          timeline_segment_id: tasks[1].segment,
        },
      ]),
      uuid(1_410_042),
    ],
  ];
  for (const [lane, manifest, id] of laneDefinitions) {
    await executor.query(
      `INSERT INTO video_runtime_lane_states(id,account_id,workspace_id,runtime_id,
        project_revision_id,lane,state,items_manifest_sha256,planned_item_count,attempt_ordinal,
        current_attempt_id,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,'MANIFEST_DURABLE',$7,1,0,NULL,
         transaction_timestamp(),transaction_timestamp())`,
      [id, IDS.accountA, IDS.workspaceA, runtimeId, IDS.revisionA, lane, manifest],
    );
  }
  const deployments = [];
  for (const [index, lane] of ["mage_image", "soulx_avatar"].entries()) {
    const id = uuid(1_410_050 + index);
    const digit = lane === "mage_image" ? "mage" : "soulx";
    const lineage = {
      endpointIdSha256: sha256(`${digit}-endpoint`),
      endpointTemplateIdSha256: sha256(`${digit}-template`),
      endpointConfigSha256: sha256(`${digit}-config`),
      workerImageDigest: sha256(`${digit}-image`),
      modelManifestSha256: sha256(`${digit}-model`),
      volumeIdSha256: sha256(`${digit}-volume`),
      volumeManifestSha256: sha256(`${digit}-volume-manifest`),
      imageSourceCommit: "a".repeat(40),
      qualificationSourceSha256: sha256(`${digit}-qualification`),
      dependencyLockSha256: sha256(`${digit}-lock`),
      acceptanceContractSha256: sha256(`${digit}-acceptance`),
      region: "EU-RO-1",
      gpu: "NVIDIA GeForce RTX 4090",
      max1GateConfigSha256: sha256(`${digit}-max1`),
      max1EndpointProfileSha256: sha256(`${digit}-max1-profile`),
      max2GateConfigSha256: sha256(`${digit}-max2`),
      max2EndpointProfileSha256: sha256(`${digit}-max2-profile`),
    };
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
        id,
        lane,
        `template:${lineage.endpointTemplateIdSha256}`,
        lineage.endpointIdSha256,
        lineage.endpointConfigSha256,
        lineage.workerImageDigest,
        lineage.modelManifestSha256,
        lineage.volumeIdSha256,
        lineage.volumeManifestSha256,
        JSON.stringify({ provider_defaults_accepted: false, sealed_lineage: lineage }),
        sha256(`${digit}-record`),
      ],
    );
    const snapshot = await executor.query(
      "SELECT videoforge_hosted_deployment_snapshot_sha256($1) AS sha256",
      [id],
    );
    deployments.push({ id, lane, snapshot: snapshot.rows[0].sha256 });
  }
  const batches = [];
  for (const [index, task] of tasks.entries()) {
    const lane = task.lane === "IMAGE" ? "mage_image" : "soulx_avatar";
    const dispatchTaskId = uuid(1_410_060 + index);
    const attempt = await executor.query(
      "SELECT videoforge_hosted_dispatch_uuid('attempt',$1,$2,1)::text AS id",
      [generationRequestId, dispatchTaskId],
    );
    const outputPrefix = `tenant/${IDS.accountA}/workspace/${IDS.workspaceA}/project/${IDS.projectA}/revision/${IDS.revisionA}/lane/${lane === "mage_image" ? "mage-image" : "soulx-avatar"}/job/${attempt.rows[0].id}`;
    const artifactInput = {
      reservation_id: uuid(1_410_070 + index * 2),
      object_key: `${outputPrefix}/artifact/input-${index}`,
    };
    const outputReservation = {
      reservation_id: uuid(1_410_071 + index * 2),
      object_prefix: outputPrefix,
    };
    const item = {
      item_ordinal: 1,
      item_id: task.id,
      task_id: task.id,
      task_key: task.task_key,
      timeline_segment_id: task.segment,
      input_reservation_id: artifactInput.reservation_id,
      output_reservation_id: outputReservation.reservation_id,
      artifact_input: artifactInput,
      output_reservation: outputReservation,
    };
    const itemManifest = [
      {
        item_id: item.item_id,
        task_id: item.task_id,
        task_key: item.task_key,
        timeline_segment_id: item.timeline_segment_id,
      },
    ];
    const reservationManifest = [
      {
        input_reservation_id: item.input_reservation_id,
        output_reservation_id: item.output_reservation_id,
        artifact_input: artifactInput,
        output_reservation: outputReservation,
      },
    ];
    const requestBody = { schema_version: "serverless-v3", lane, task_id: dispatchTaskId };
    const envelope = {
      schema: "serverless-worker-job-envelope/v3",
      tenant: { account_id: IDS.accountA, workspace_id: IDS.workspaceA },
      work: {
        project_revision_id: IDS.revisionA,
        generation_request_id: generationRequestId,
        task_id: dispatchTaskId,
        attempt_id: attempt.rows[0].id,
        lane,
        items_manifest_sha256: canonicalSha256(itemManifest),
        item_count: 1,
      },
      artifacts: {
        input_manifest_sha256: canonicalSha256([artifactInput]),
        output_prefix: outputPrefix,
        plan_manifest_sha256: planSha256,
        transfer_port_reservation_ids: [item.input_reservation_id, item.output_reservation_id],
      },
    };
    batches.push({
      schema_version: "videoforge-hosted-lane-batch/v1",
      id: uuid(1_410_080 + index),
      dispatch_task_id: dispatchTaskId,
      lane,
      batch_ordinal: index + 1,
      attempt_ordinal: 1,
      generation_plan_sha256: planSha256,
      deployment_id: deployments[index].id,
      deployment_snapshot_sha256: deployments[index].snapshot,
      items: [item],
      items_manifest_sha256: canonicalSha256(itemManifest),
      input_manifest_sha256: canonicalSha256([artifactInput]),
      reservation_manifest_sha256: canonicalSha256(reservationManifest),
      request_body: requestBody,
      request_body_sha256: canonicalSha256(requestBody),
      envelope,
      envelope_sha256: canonicalSha256(envelope),
      output_prefix: outputPrefix,
      max_input_bytes: 1000,
      max_output_bytes: 10000,
      spend_ceiling_usd: 1,
      reservation_usd: 0.5,
      rate_source: "provider-free-test",
      rate_checked_at: new Date().toISOString(),
      authority_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    });
  }
  return { generationRequestId, planSha256, batches };
}

test("0041 installs immutable tenant batches, narrow capability, and attempt lineage", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    const tables = await executor.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema='public' AND table_name LIKE 'hosted_lane_batch%'
        ORDER BY table_name`,
    );
    assert.deepEqual(
      tables.rows.map((row) => row.table_name),
      ["hosted_lane_batch_items", "hosted_lane_batches"],
    );
    const policies = await executor.query(
      `SELECT tablename,policyname FROM pg_policies
        WHERE schemaname='public' AND tablename LIKE 'hosted_lane_batch%'
        ORDER BY tablename`,
    );
    assert.equal(policies.rows.length, 2);
    const triggers = await executor.query(
      `SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname IN
        ('hosted_lane_batches_append_only','hosted_lane_batch_items_append_only',
         'serverless_attempts_hosted_batch_lineage') ORDER BY tgname`,
    );
    assert.equal(triggers.rows.length, 3);
    const privilege = await executor.query(
      `SELECT has_function_privilege('public',
        'public.videoforge_materialize_hosted_lane_batches(uuid,uuid,uuid,uuid,uuid,text,jsonb)',
        'EXECUTE') AS allowed`,
    );
    assert.equal(privilege.rows[0].allowed, false);
  });
});

test("0041 derives the same stable attempt UUID and rejects invalid ordinals", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    const request = "55555555-5555-4555-8555-555555555555";
    const task = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const result = await executor.query(
      `SELECT public.videoforge_hosted_dispatch_uuid('attempt',$1,$2,1)::text AS id`,
      [request, task],
    );
    assert.equal(result.rows[0].id, "1d196036-8ea3-5ce9-808b-99825c222406");
    await assert.rejects(
      executor.query(`SELECT public.videoforge_hosted_dispatch_uuid('attempt',$1,$2,0)`, [
        request,
        task,
      ]),
      /hosted dispatch uuid input invalid/u,
    );
  });
});

test("0041 function source pins atomic replay, order, tenant, admission, reservations, and hashes", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    const result = await executor.query(
      `SELECT pg_get_functiondef('public.videoforge_materialize_hosted_lane_batches(uuid,uuid,uuid,uuid,uuid,text,jsonb)'::regprocedure) AS source`,
    );
    const source = result.rows[0].source;
    for (const required of [
      "videoforge_current_account_id",
      "pg_advisory_xact_lock",
      "jsonb_array_length(supplied_batches) <> 2",
      "partial replay is forbidden",
      "provider_workload_leases",
      "video_runtime_lane_states",
      "MANIFEST_DURABLE",
      "current_attempt_id IS NOT NULL",
      "generation_plan_sha256",
      "items_manifest_sha256",
      "input_manifest_sha256",
      "request_body_sha256",
      "envelope_sha256",
      "transfer_port_reservation_ids",
      "output_reservation",
      "mage-image",
      "soulx-avatar",
    ])
      assert.ok(source.includes(required), `missing ${required}`);
  });
});

test("0041 executes atomic success, replay/conflict, rollback, concurrency, lineage, RLS, and restore", async () => {
  const source = await createMigratedDatabase();
  const destination = await createMigratedDatabase();
  try {
    const seeded = await seedMaterialization(source.executor);
    const append = (batches = seeded.batches, accountId = IDS.accountA) =>
      source.executor.transaction(async (transaction) => {
        await transaction.query("SELECT set_config($1,$2,true)", [
          "videoforge.account_id",
          accountId,
        ]);
        return transaction.query(
          `SELECT replayed FROM videoforge_materialize_hosted_lane_batches($1,$2,$3,$4,$5,$6,$7::jsonb)`,
          [
            IDS.accountA,
            IDS.workspaceA,
            IDS.projectA,
            IDS.revisionA,
            seeded.generationRequestId,
            seeded.planSha256,
            JSON.stringify(batches),
          ],
        );
      });

    const invalidCandidates = [];
    const reservationDrift = structuredClone(seeded.batches);
    reservationDrift[1].items[0].output_reservation_id = uuid(1_419_999);
    invalidCandidates.push([reservationDrift, "23514"]);
    const extraReservation = structuredClone(seeded.batches);
    extraReservation[0].envelope.artifacts.transfer_port_reservation_ids.push(uuid(1_419_998));
    extraReservation[0].envelope_sha256 = canonicalSha256(extraReservation[0].envelope);
    invalidCandidates.push([extraReservation, "23514"]);
    const duplicateReservation = structuredClone(seeded.batches);
    duplicateReservation[1].items[0].input_reservation_id =
      duplicateReservation[0].items[0].input_reservation_id;
    invalidCandidates.push([duplicateReservation, "42501"]);
    const laneOrderDrift = structuredClone(seeded.batches).reverse();
    invalidCandidates.push([laneOrderDrift, "42501"]);
    const requestHashDrift = structuredClone(seeded.batches);
    requestHashDrift[0].request_body.foreign = true;
    invalidCandidates.push([requestHashDrift, "23514"]);
    for (const [invalid, code] of invalidCandidates) {
      await expectDatabaseError(() => append(invalid), code);
      assert.equal(
        (await source.executor.query("SELECT count(*)::int AS count FROM hosted_lane_batches"))
          .rows[0].count,
        0,
      );
      assert.equal(
        (await source.executor.query("SELECT count(*)::int AS count FROM hosted_lane_batch_items"))
          .rows[0].count,
        0,
      );
    }

    const concurrent = await Promise.all([append(), append()]);
    assert.deepEqual(concurrent.map((result) => result.rows[0].replayed).sort(), [false, true]);
    assert.deepEqual((await append()).rows, [{ replayed: true }]);
    const drift = structuredClone(seeded.batches);
    drift[0].rate_source = "drift";
    await expectDatabaseError(() => append(drift), "23505");

    const batchRows = await source.executor.query(
      "SELECT lane,item_count FROM hosted_lane_batches ORDER BY batch_ordinal",
    );
    assert.deepEqual(batchRows.rows, [
      { lane: "mage_image", item_count: 1 },
      { lane: "soulx_avatar", item_count: 1 },
    ]);
    await expectDatabaseError(
      () =>
        source.executor.query(
          `INSERT INTO serverless_attempts(id,account_id,workspace_id,project_id,project_revision_id,
          generation_request_id,task_id,deployment_id,lane,attempt_ordinal,state,dispatch_token_sha256,
          items_manifest_sha256,item_count,input_manifest_sha256,output_prefix,deadline_at,
          reconciliation_deadline_at,created_at,updated_at)
         SELECT $1,b.account_id,b.workspace_id,b.project_id,b.project_revision_id,b.generation_request_id,
          $2,b.deployment_id,b.lane,1,'PLANNED',$3,b.items_manifest_sha256,b.item_count,
          b.input_manifest_sha256,b.output_prefix,transaction_timestamp()+interval '1 hour',
          transaction_timestamp()+interval '30 minutes',transaction_timestamp(),transaction_timestamp()
         FROM hosted_lane_batches b WHERE b.lane='mage_image'`,
          [uuid(1_410_090), uuid(1_410_091), sha256("wrong-dispatch")],
        ),
      "23503",
    );

    await source.executor.execute("CREATE ROLE vf_0041_reader NOSUPERUSER NOINHERIT");
    await source.executor.execute("GRANT USAGE ON SCHEMA public TO vf_0041_reader");
    await source.executor.execute("GRANT SELECT ON hosted_lane_batches TO vf_0041_reader");
    await source.executor.execute(
      "GRANT EXECUTE ON FUNCTION videoforge_current_account_id() TO vf_0041_reader",
    );
    await source.executor.execute("SET ROLE vf_0041_reader");
    await source.executor.query("SELECT set_config($1,$2,false)", [
      "videoforge.account_id",
      IDS.accountB,
    ]);
    assert.equal(
      (await source.executor.query("SELECT count(*)::int AS count FROM hosted_lane_batches"))
        .rows[0].count,
      0,
    );
    await source.executor.execute("RESET ROLE");
    await expectDatabaseError(() => append(seeded.batches, IDS.accountB), "42501");
    await source.executor.query("SELECT set_config($1,$2,false)", [
      "videoforge.account_id",
      IDS.accountA,
    ]);

    // The synthetic bridge above deliberately bypasses its separately-tested ASR/transcript parents.
    // Remove only that invalid test scaffold so this restore proves the populated 0041 rows and their
    // real project/request/task/deployment parents reproduce exactly.
    await source.executor.execute(
      "ALTER TABLE hosted_canonical_timing_bridges DISABLE TRIGGER ALL",
    );
    await source.executor.execute("DELETE FROM hosted_canonical_timing_bridges");
    await source.executor.execute("ALTER TABLE hosted_canonical_timing_bridges ENABLE TRIGGER ALL");
    const snapshot = await exportMetadataSnapshot(source.executor);
    assert.equal(
      snapshot.tables.find((table) => table.tableName === "hosted_lane_batches")?.rowCount,
      2,
    );
    assert.equal(
      snapshot.tables.find((table) => table.tableName === "hosted_lane_batch_items")?.rowCount,
      2,
    );
    const serialized = serializeMetadataSnapshot(snapshot);
    const restored = await restoreMetadataSnapshot(destination.executor, serialized).catch(
      (error) => {
        throw error.cause ?? error;
      },
    );
    assert.equal(restored.alreadyRestored, false);
    assert.equal(
      serializeMetadataSnapshot(await exportMetadataSnapshot(destination.executor)),
      serialized,
    );
  } finally {
    await source.database.close();
    await destination.database.close();
  }
});

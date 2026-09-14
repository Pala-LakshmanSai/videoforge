/* Opt-in migration 0129 behavior tests. PGlite runs the complete migration chain; no provider calls. */
import assert from "node:assert/strict";
import test from "node:test";

import { canonicalSha256 } from "../dist/src/index.js";
import { FairAdmissionRepository } from "../dist/src/admission/index.js";
import { IDS, seedLockedProjects } from "./support/fixtures.mjs";
import {
  FIXED_TIME,
  expectDatabaseError,
  sha256,
  uuid,
  withPgcryptoMigratedDatabase,
} from "./support/pglite.mjs";

const enabled = process.env.VIDEOFORGE_REGENERATION_DB_TEST === "1";

const IDS_REGEN = Object.freeze({
  request: uuid(1_290_001),
  runtime: uuid(1_290_002),
  sourceAttempt: uuid(1_290_003),
  sourceReservation: uuid(1_290_004),
  sourceReceipt: uuid(1_290_005),
  deployment: uuid(1_290_006),
});

const SOURCE_IMAGE_LENGTH = 123;
const SOURCE_IMAGE_HASH = sha256("accepted-source-image");
const SOURCE_IMAGE_KEY = (attemptId = IDS_REGEN.sourceAttempt) =>
  `tenant/${IDS.accountA}/workspace/${IDS.workspaceA}/project/${IDS.projectA}/revision/${IDS.revisionA}/lane/mage-image/job/${attemptId}/artifact/${IDS.taskA}`;

async function setAccount(executor, accountId) {
  await executor.query("SELECT set_config('videoforge.account_id', $1, false)", [accountId]);
}

async function seedAcceptedScene(executor) {
  await seedLockedProjects(executor);
  await setAccount(executor, IDS.accountA);

  await executor.query(
    `INSERT INTO generation_requests(
       id,account_id,workspace_id,project_id,project_revision_id,created_by_user_id,
       state,queue_order,available_at,attempt_ordinal,idempotency_key,admitted_at,
       created_at,updated_at
     ) VALUES($1,$2,$3,$4,$5,$6,'ACTIVE',1,$7,1,'regen-source-request',$7,$7,$7)`,
    [
      IDS_REGEN.request,
      IDS.accountA,
      IDS.workspaceA,
      IDS.projectA,
      IDS.revisionA,
      IDS.userA,
      FIXED_TIME,
    ],
  );

  await executor.query(
    `INSERT INTO video_runtime_states(
       id,account_id,workspace_id,project_id,project_revision_id,generation_request_id,
       stage,preparation_manifest_sha256,render_manifest_sha256,final_output_sha256,
       terminal_reason,admitted_at,prepared_at,terminal_at,created_at,updated_at
     ) VALUES($1,$2,$3,$4,$5,$6,'COMPLETE',$7,$8,$9,'SUCCEEDED',$10,$10,$11,$10,$11)`,
    [
      IDS_REGEN.runtime,
      IDS.accountA,
      IDS.workspaceA,
      IDS.projectA,
      IDS.revisionA,
      IDS_REGEN.request,
      sha256("source-preparation-manifest"),
      sha256("source-render-manifest"),
      sha256("source-final-output"),
      FIXED_TIME,
      "2026-08-10T04:00:10.000Z",
    ],
  );

  await executor.query(
    `INSERT INTO generation_tasks(
       id,account_id,workspace_id,owner_type,owner_id,project_revision_id,
       task_key,lane,state,required,depends_on,finished_at,created_at,updated_at
     ) VALUES($1,$2,$3,'PROJECT_REVISION',$4,$4,'image:regen:001','IMAGE','READY',true,'[]',NULL,$5,$5)`,
    [IDS.taskA, IDS.accountA, IDS.workspaceA, IDS.revisionA, FIXED_TIME],
  );
  await executor.transaction(async (transaction) => {
    await transaction.query(
      `INSERT INTO attempts(
         id,workspace_id,task_id,ordinal,idempotency_key,state,
         dispatch_state,claim_state,execution_profile_id,execution_claim_token_hash,
         input_hash,output_asset_id,result_disposition,finished_at
       ) VALUES($1,$2,$3,1,'regen-source-attempt','SUCCEEDED',
         'NOT_SENT','UNCLAIMED',$4,$5,$6,$7,'ACCEPTED',$8)`,
      [
        IDS_REGEN.sourceAttempt,
        IDS.workspaceA,
        IDS.taskA,
        IDS.executionProfileA,
        sha256("source-execution-claim"),
        sha256("source-input"),
        IDS.outputA1,
        FIXED_TIME,
      ],
    );
    await transaction.query(
      `UPDATE generation_tasks
          SET state='COMPLETE',accepted_attempt_id=$1,finished_at=$2,updated_at=$2
        WHERE workspace_id=$3 AND id=$4`,
      [IDS_REGEN.sourceAttempt, FIXED_TIME, IDS.workspaceA, IDS.taskA],
    );
  });

  const deployment = {
    id: IDS_REGEN.deployment,
    lane: "mage_image",
    endpointProfileId: "regen-test-profile",
    endpointIdSha256: sha256("regen-endpoint"),
    endpointConfigSha256: sha256("regen-config"),
    workerImageDigest: sha256("regen-image"),
    modelManifestSha256: sha256("regen-model"),
    volumeIdSha256: sha256("regen-volume"),
    volumeManifestSha256: sha256("regen-volume-manifest"),
    recordSha256: sha256("regen-deployment-record"),
  };
  await executor.query(
    `INSERT INTO serverless_endpoint_deployments(
       id,lane,endpoint_profile_id,endpoint_id_sha256,endpoint_config_sha256,
       worker_image_digest,model_manifest_sha256,region,volume_id_sha256,
       volume_manifest_sha256,volume_mount,volume_size_gb,gpu_allowlist,
       gpu_count_per_worker,worker_count_min,worker_count_max,worker_ceiling_scope,
       retained_active_workers,scaler_type,scaler_value,handler_concurrency,
       idle_timeout_seconds,init_timeout_seconds,execution_timeout_seconds,
       request_ttl_seconds,request_ttl_scope,reconciliation_deadline_seconds,
       provider_result_window_seconds,polling_interval_seconds,max_replacement_attempts,
       blind_resubmit_permitted,timeout_evidence,deployment_version,is_active,
       record_sha256,created_at
     ) VALUES(
       $1,$2,$3,$4,$5,$6,$7,'EU-RO-1',$8,$9,'/runpod-volume',50,
       ARRAY['NVIDIA GeForce RTX 4090']::text[],1,0,2,'ACTIVE_PLUS_FLEX',0,
       'REQUEST_COUNT',1,1,5,900,2400,3600,
       'PROVIDER_QUEUE_PLUS_EXECUTION_PLUS_OUTPUT_UPLOAD',1500,1800,5,1,false,
       '{"provider_defaults_accepted":false}'::jsonb,1,true,$10,$11
     )`,
    [
      deployment.id,
      deployment.lane,
      deployment.endpointProfileId,
      deployment.endpointIdSha256,
      deployment.endpointConfigSha256,
      deployment.workerImageDigest,
      deployment.modelManifestSha256,
      deployment.volumeIdSha256,
      deployment.volumeManifestSha256,
      deployment.recordSha256,
      FIXED_TIME,
    ],
  );

  await executor.query(
    `INSERT INTO serverless_attempts(
       id,account_id,workspace_id,project_id,project_revision_id,generation_request_id,
       task_id,deployment_id,lane,attempt_ordinal,state,dispatch_token_sha256,
       items_manifest_sha256,item_count,input_manifest_sha256,output_prefix,deadline_at,
       reconciliation_deadline_at,submitted_at,ttl_expires_at,terminal_at,created_at,updated_at
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'mage_image',1,'SUCCEEDED',$9,$10,1,$11,$12,$13,$14,$15,$16,$17,$18,$17)`,
    [
      IDS_REGEN.sourceAttempt,
      IDS.accountA,
      IDS.workspaceA,
      IDS.projectA,
      IDS.revisionA,
      IDS_REGEN.request,
      IDS.taskA,
      deployment.id,
      sha256("source-dispatch-token"),
      sha256("source-items-manifest"),
      sha256("source-input-manifest"),
      `tenant/${IDS.accountA}/workspace/${IDS.workspaceA}/project/${IDS.projectA}/revision/${IDS.revisionA}/lane/mage-image/job/${IDS_REGEN.sourceAttempt}`,
      "2026-08-10T05:00:00.000Z",
      "2026-08-10T04:30:00.000Z",
      "2026-08-10T04:00:01.000Z",
      "2026-08-10T05:00:00.000Z",
      "2026-08-10T04:00:02.000Z",
      FIXED_TIME,
    ],
  );

  await executor.query(
    `INSERT INTO artifact_reservations(
       id,account_id,workspace_id,project_id,project_revision_id,lane,job_id,artifact_id,
       object_key,method,content_type,content_length,checksum_sha256,expires_at,max_uses,
       used_count,state,retention_class,deletion_owner_account_id,created_at,updated_at
     ) VALUES($1,$2,$3,$4,$5,'MAGE_IMAGE',$6,$7,$8,'PUT','image/png',$9,$10,$11,1,1,
       'COMMITTED','PROJECT',$2,$12,$13)`,
    [
      IDS_REGEN.sourceReservation,
      IDS.accountA,
      IDS.workspaceA,
      IDS.projectA,
      IDS.revisionA,
      IDS_REGEN.sourceAttempt,
      IDS.taskA,
      SOURCE_IMAGE_KEY(),
      SOURCE_IMAGE_LENGTH,
      SOURCE_IMAGE_HASH,
      "2026-08-10T05:00:00.000Z",
      FIXED_TIME,
      "2026-08-10T04:00:02.000Z",
    ],
  );

  await executor.query(
    `INSERT INTO artifact_receipts(
       id,account_id,workspace_id,reservation_id,callback_id,object_key,content_type,
       content_length,checksum_sha256,probe,receipt_sha256,committed_at
     ) VALUES($1,$2,$3,$4,'regen-source-receipt',$5,'image/png',$6,$7,'{}'::jsonb,$8,$9)`,
    [
      IDS_REGEN.sourceReceipt,
      IDS.accountA,
      IDS.workspaceA,
      IDS_REGEN.sourceReservation,
      SOURCE_IMAGE_KEY(),
      SOURCE_IMAGE_LENGTH,
      SOURCE_IMAGE_HASH,
      sha256("source-receipt"),
      "2026-08-10T04:00:03.000Z",
    ],
  );

  await executor.query(
    `INSERT INTO video_runtime_accepted_units(
       id,account_id,workspace_id,runtime_id,project_revision_id,lane,item_id,object_key,
       checksum_sha256,content_length,accepted_attempt_id,accepted_at
     ) VALUES($1,$2,$3,$4,$5,'mage_image',$6,$7,$8,$9,$10,$11)`,
    [
      uuid(1_290_007),
      IDS.accountA,
      IDS.workspaceA,
      IDS_REGEN.runtime,
      IDS.revisionA,
      IDS.taskA,
      SOURCE_IMAGE_KEY(),
      SOURCE_IMAGE_HASH,
      SOURCE_IMAGE_LENGTH,
      IDS_REGEN.sourceAttempt,
      "2026-08-10T04:00:04.000Z",
    ],
  );

  return { ...IDS_REGEN, deployment, endpointIdSha256: deployment.endpointIdSha256 };
}

async function createRequest(executor) {
  const result = await executor.query(
    `SELECT public.videoforge_create_hosted_image_regeneration($1,$2,$3,$4,$5,$6,$7) AS value`,
    [
      IDS.accountA,
      IDS.workspaceA,
      IDS.projectA,
      IDS.revisionA,
      IDS.taskA,
      "A revised documentary scene",
      "regen-idempotency-key",
    ],
  );
  return result.rows[0].value;
}

function prepareDocuments(request, fixture) {
  const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
  const envelope = {
    schema: "hosted-image-regeneration-envelope/v1",
    tenant: { account_id: IDS.accountA, workspace_id: IDS.workspaceA },
    work: {
      attempt_id: request.attempt_id,
      project_revision_id: IDS.revisionA,
      lane: "mage_image",
      item_count: 1,
    },
    limits: { expires_at: expiresAt },
    dispatch_token: "regen-dispatch-token",
  };
  const body = {
    schema: "hosted-image-regeneration-body/v1",
    envelope,
    prompt: request.edited_prompt,
  };
  const lineage = {
    schema: "hosted-image-regeneration-lineage/v1",
    binding: {
      accountId: IDS.accountA,
      workspaceId: IDS.workspaceA,
      projectId: IDS.projectA,
      projectRevisionId: IDS.revisionA,
      attemptId: request.attempt_id,
      endpointIdSha256: fixture.endpointIdSha256,
    },
  };
  return {
    body,
    envelope,
    lineage,
    bodyHash: canonicalSha256(body),
    envelopeHash: canonicalSha256(envelope),
  };
}

async function prepareAssigned(executor, fixture) {
  const request = await createRequest(executor);
  const documents = prepareDocuments(request, fixture);
  const prepared = await executor.query(
    `SELECT public.videoforge_prepare_hosted_image_regeneration($1,$2::jsonb,$3::jsonb,$4,$5,$6::jsonb) AS value`,
    [
      request.id,
      JSON.stringify(documents.body),
      JSON.stringify(documents.envelope),
      documents.bodyHash,
      documents.envelopeHash,
      JSON.stringify(documents.lineage),
    ],
  );
  assert.equal(prepared.rows[0].value.state, "PREPARED");
  const sent = await executor.query(
    `SELECT public.videoforge_image_regeneration_transition($1,'SENT',NULL,$2,$3) AS value`,
    [request.id, documents.bodyHash, documents.envelopeHash],
  );
  assert.equal(sent.rows[0].value.state, "SENT");
  const assigned = await executor.query(
    `SELECT public.videoforge_image_regeneration_transition($1,'ASSIGNED',$2) AS value`,
    [request.id, "regen-provider-job"],
  );
  assert.equal(assigned.rows[0].value.state, "ASSIGNED");
  return { request: assigned.rows[0].value, documents };
}

function replacementArtifact(request, overrides = {}) {
  return {
    itemId: request.image_task_id,
    reservationId: request.output_reservation_id,
    objectKey: `tenant/${request.account_id}/workspace/${request.workspace_id}/project/${request.project_id}/revision/${request.project_revision_id}/lane/mage-image/job/${request.attempt_id}/artifact/${request.image_task_id}`,
    contentType: "image/png",
    contentLength: 456,
    checksumSha256: sha256("replacement-image"),
    probe: { width: 512, height: 512 },
    ...overrides,
  };
}

test("0129 exposes tenant scoped image regeneration persistence functions", { skip: !enabled }, async () => {
  await withPgcryptoMigratedDatabase(async ({ executor, sources }) => {
    const surface = await executor.query(`
      SELECT to_regclass('public.hosted_image_regeneration_requests') IS NOT NULL AS has_table,
             to_regprocedure('public.videoforge_prepare_hosted_image_regeneration(uuid,jsonb,jsonb,text,text,jsonb)') IS NOT NULL AS has_prepare,
             to_regprocedure('public.videoforge_image_regeneration_transition(uuid,text,text,text,text)') IS NOT NULL AS has_transition,
             to_regprocedure('public.videoforge_commit_hosted_image_regeneration(uuid,jsonb,text,jsonb)') IS NOT NULL AS has_commit,
             to_regprocedure('public.videoforge_load_hosted_image_regeneration(uuid,uuid)') IS NOT NULL AS has_load`);
    assert.deepEqual(surface.rows[0], {
      has_table: true,
      has_prepare: true,
      has_transition: true,
      has_commit: true,
      has_load: true,
    });
    assert.equal(sources.at(-1)?.version, 129);
    assert.equal(sources.at(-1)?.filename, "0129_hosted_image_regeneration.sql");
  });
});

test("0129 rejects create when GUC tenant differs from requested account", { skip: !enabled }, async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    const fixture = await seedAcceptedScene(executor);
    await setAccount(executor, IDS.accountB);
    await expectDatabaseError(() => createRequest(executor), "23514");
    const rows = await executor.query("SELECT count(*)::int AS count FROM hosted_image_regeneration_requests");
    assert.equal(rows.rows[0].count, 0);
  });
});

test("0129 creates one request for a valid accepted scene and replays idempotently", { skip: !enabled }, async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    const fixture = await seedAcceptedScene(executor);
    await setAccount(executor, IDS.accountA);
    const first = await createRequest(executor, fixture);
    const second = await createRequest(executor, fixture);
    assert.deepEqual(second, first);
    assert.equal(first.state, "QUEUED");
    assert.equal(first.source_attempt_id, fixture.sourceAttempt);
    assert.equal(first.generation_request_id, fixture.request);
    const count = await executor.query(
      "SELECT count(*)::int AS count FROM hosted_image_regeneration_requests WHERE account_id=$1",
      [IDS.accountA],
    );
    assert.equal(count.rows[0].count, 1);
  });
});

test("regeneration lease keeps its own identity during capacity reconstruction", { skip: !enabled }, async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    const fixture = await seedAcceptedScene(executor);
    await setAccount(executor, IDS.accountA);
    const { request } = await prepareAssigned(executor, fixture);
    const sourceBefore = await executor.query(
      `SELECT state,version,admitted_at,terminal_at,attempt_ordinal
         FROM generation_requests
        WHERE id=$1`,
      [fixture.request],
    );
    const leaseBefore = await executor.query(
      `SELECT request_kind,generation_request_id,preset_preview_request_id,
              image_regeneration_request_id,state
         FROM provider_workload_leases
        WHERE id=$1`,
      [request.lease_id],
    );
    assert.deepEqual(leaseBefore.rows, [{
      request_kind: "IMAGE_REGENERATION",
      generation_request_id: null,
      preset_preview_request_id: null,
      image_regeneration_request_id: request.id,
      state: "ACTIVE",
    }]);

    const rebuilt = await new FairAdmissionRepository(executor).reconstruct({
      now: new Date().toISOString(),
      auditId: uuid(1_290_009),
    });
    assert.deepEqual(rebuilt, {
      activeLeaseCount: 1,
      accountIds: [IDS.accountA],
    });

    const sourceAfter = await executor.query(
      `SELECT state,version,admitted_at,terminal_at,attempt_ordinal
         FROM generation_requests
        WHERE id=$1`,
      [fixture.request],
    );
    assert.deepEqual(sourceAfter.rows, sourceBefore.rows);
    const capacity = await executor.query(
      `SELECT active_lease_count FROM global_generation_capacity WHERE singleton`,
    );
    assert.equal(capacity.rows[0].active_lease_count, 1);
  });
});

test("0129 returns acquired false for transition CAS loser", { skip: !enabled }, async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    const fixture = await seedAcceptedScene(executor);
    await setAccount(executor, IDS.accountA);
    const { request, documents } = await prepareAssigned(executor, fixture);
    const loser = await executor.query(
      `SELECT public.videoforge_image_regeneration_transition($1,'SENT',NULL,$2,$3) AS value`,
      [request.id, documents.bodyHash, documents.envelopeHash],
    );
    assert.equal(loser.rows[0].value.acquired, false);
    assert.equal(loser.rows[0].value.state, "ASSIGNED");
  });
});

test("regeneration lease expiry does not reopen its original generation request", { skip: !enabled }, async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    const fixture = await seedAcceptedScene(executor);
    await setAccount(executor, IDS.accountA);
    const request = await createRequest(executor);
    const documents = prepareDocuments(request, fixture);
    const prepared = await executor.query(
      `SELECT public.videoforge_prepare_hosted_image_regeneration($1,$2::jsonb,$3::jsonb,$4,$5,$6::jsonb) AS value`,
      [
        request.id,
        JSON.stringify(documents.body),
        JSON.stringify(documents.envelope),
        documents.bodyHash,
        documents.envelopeHash,
        JSON.stringify(documents.lineage),
      ],
    );
    const leaseId = prepared.rows[0].value.lease_id;
    assert.ok(leaseId);
    const repository = new FairAdmissionRepository(executor);
    const recovered = await repository.reclaimExpired({
      now: new Date(Date.now() + 31 * 60_000).toISOString(),
      expirations: [{ leaseId, auditId: uuid(1_290_008) }],
    });
    assert.deepEqual(recovered, []);
    const durable = await executor.query(
      `SELECT request.state AS request_state,request.version AS request_version,
              lease.state AS lease_state,lease.version AS lease_version
         FROM generation_requests request
         CROSS JOIN provider_workload_leases lease
        WHERE request.id=$1 AND lease.id=$2`,
      [fixture.request, leaseId],
    );
    assert.deepEqual(durable.rows, [{
      request_state: "ACTIVE",
      request_version: 1,
      lease_state: "ACTIVE",
      lease_version: 1,
    }]);
  });
});

test("0129 rejects forged commit before writing replacement receipt", { skip: !enabled }, async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    const fixture = await seedAcceptedScene(executor);
    await setAccount(executor, IDS.accountA);
    const { request } = await prepareAssigned(executor, fixture);
    const forged = replacementArtifact(request, { objectKey: "tenant/forged/object.png" });
    await expectDatabaseError(
      () => executor.query(
        `SELECT public.videoforge_commit_hosted_image_regeneration($1,$2::jsonb,$3,$4::jsonb) AS value`,
        [request.id, JSON.stringify(forged), sha256("forged-receipt"), JSON.stringify({ forged: true })],
      ),
      "23514",
    );
    const counts = await executor.query(
      `SELECT
         (SELECT count(*)::int FROM artifact_reservations WHERE job_id=$1) AS reservations,
         (SELECT count(*)::int FROM artifact_receipts WHERE callback_id='regen:'||$2) AS receipts`,
      [request.attempt_id, request.id],
    );
    assert.deepEqual(counts.rows[0], { reservations: 0, receipts: 0 });
  });
});

test("0129 replacement commit leaves accepted source image provenance unchanged", { skip: !enabled }, async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    const fixture = await seedAcceptedScene(executor);
    await setAccount(executor, IDS.accountA);
    const sourceBefore = await executor.query(
      `SELECT object_key,checksum_sha256,content_length,accepted_attempt_id
         FROM video_runtime_accepted_units
        WHERE runtime_id=$1 AND lane='mage_image' AND item_id=$2`,
      [fixture.runtime, IDS.taskA],
    );
    const { request } = await prepareAssigned(executor, fixture);
    const committed = await executor.query(
      `SELECT public.videoforge_commit_hosted_image_regeneration($1,$2::jsonb,$3,$4::jsonb) AS value`,
      [
        request.id,
        JSON.stringify(replacementArtifact(request)),
        sha256("replacement-receipt"),
        JSON.stringify({ sourceAttemptId: request.source_attempt_id, sourceImageSha256: SOURCE_IMAGE_HASH }),
      ],
    );
    assert.equal(committed.rows[0].value.state, "COMPLETED");
    const sourceAfter = await executor.query(
      `SELECT object_key,checksum_sha256,content_length,accepted_attempt_id
         FROM video_runtime_accepted_units
        WHERE runtime_id=$1 AND lane='mage_image' AND item_id=$2`,
      [fixture.runtime, IDS.taskA],
    );
    assert.deepEqual(sourceAfter.rows, sourceBefore.rows);
    const sourceReceipt = await executor.query(
      `SELECT object_key,checksum_sha256,content_length FROM artifact_receipts WHERE id=$1`,
      [fixture.sourceReceipt],
    );
    assert.deepEqual(sourceReceipt.rows, [{ object_key: SOURCE_IMAGE_KEY(), checksum_sha256: SOURCE_IMAGE_HASH, content_length: SOURCE_IMAGE_LENGTH }]);
  });
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { IDS, HASHES, seedLockedProjects } from "./support/fixtures.mjs";
import { sha256, uuid, withMigratedDatabase } from "./support/pglite.mjs";

const IDS_84 = Object.freeze({
  reservation: uuid(2_090_840),
  receipt: uuid(2_090_841),
  createRequest: uuid(2_090_842),
  generationRequest: uuid(2_090_843),
  runtime: uuid(2_090_844),
  mageLane: uuid(2_090_845),
  soulxLane: uuid(2_090_846),
  mageAttempt: uuid(2_090_847),
  soulxAttempt: uuid(2_090_848),
  mageTask: uuid(2_090_849),
  soulxTask: uuid(2_090_850),
  mageOutbox: uuid(2_090_851),
  soulxOutbox: uuid(2_090_852),
  extraOutbox: uuid(2_090_853),
  extraAssignment: uuid(2_090_856),
  lateProject: uuid(2_090_857),
  lateRevision: uuid(2_090_858),
  lateAsset: uuid(2_090_859),
  lateReservation: uuid(2_090_860),
  lateReceipt: uuid(2_090_861),
  lateCpuAttempt: uuid(2_090_863),
});

const ROOT = resolve(new URL("../../..", import.meta.url).pathname);

async function seedProjectOnlyClick(executor) {
  await seedLockedProjects(executor);
  await executor.query("SELECT set_config($1,$2,false)", ["videoforge.account_id", IDS.accountA]);
  const objectKey = `tenant/${IDS.accountA}/workspace/${IDS.workspaceA}/project/${IDS.projectA}/revision/${IDS.revisionA}/lane/input/job/v209-stage-click/artifact/voiceover`;
  await executor.query(
    `INSERT INTO artifact_reservations(id,account_id,workspace_id,project_id,project_revision_id,
      asset_id,lane,job_id,artifact_id,object_key,method,content_type,content_length,
      checksum_sha256,expires_at,max_uses,state,retention_class,deletion_owner_account_id)
     VALUES($1,$2,$3,$4,$5,$6,'INPUT','v209-stage-click','voiceover',$7,'PUT','audio/wav',128,
      $8,transaction_timestamp()+interval '1 hour',1,'ISSUED','PROJECT',$2)`,
    [
      IDS_84.reservation,
      IDS.accountA,
      IDS.workspaceA,
      IDS.projectA,
      IDS.revisionA,
      IDS.voiceoverA,
      objectKey,
      HASHES.voiceoverA,
    ],
  );
  await executor.query(
    `INSERT INTO hosted_project_create_requests(id,account_id,workspace_id,idempotency_key,
      request_sha256,project_id,project_revision_id,voiceover_asset_id,upload_reservation_id,
      upload_receipt_id,state,created_at)
     VALUES($1,$2,$3,'v209-staged-click-idempotency',$4,$5,$6,$7,$8,$9,'UPLOAD_PENDING',
      transaction_timestamp())`,
    [
      IDS_84.createRequest,
      IDS.accountA,
      IDS.workspaceA,
      sha256("v209-staged-create-request"),
      IDS.projectA,
      IDS.revisionA,
      IDS.voiceoverA,
      IDS_84.reservation,
      IDS_84.receipt,
    ],
  );
}

async function seedWaitingClick(executor) {
  await seedProjectOnlyClick(executor);
  await executor.query(
    `INSERT INTO generation_requests(id,account_id,workspace_id,project_id,project_revision_id,
      created_by_user_id,state,queue_order,available_at,attempt_ordinal,idempotency_key,
      created_at,updated_at)
     VALUES($1,$2,$3,$4,$5,$6,'WAITING',1,transaction_timestamp(),1,
      'v209-staged-generation',transaction_timestamp(),transaction_timestamp())`,
    [
      IDS_84.generationRequest,
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
      IDS_84.runtime,
      IDS.accountA,
      IDS.workspaceA,
      IDS.projectA,
      IDS.revisionA,
      IDS_84.generationRequest,
    ],
  );
  for (const [id, lane] of [
    [IDS_84.mageLane, "mage_image"],
    [IDS_84.soulxLane, "soulx_avatar"],
  ]) {
    await executor.query(
      `INSERT INTO video_runtime_lane_states(id,account_id,workspace_id,runtime_id,
        project_revision_id,lane,state,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,'BLOCKED_ON_PREPARATION',transaction_timestamp(),
        transaction_timestamp())`,
      [id, IDS.accountA, IDS.workspaceA, IDS_84.runtime, IDS.revisionA, lane],
    );
  }
}

async function seedPlannedCpuAttempt(executor) {
  const prefix =
    `tenant/${IDS.accountA}/workspace/${IDS.workspaceA}/project/${IDS.projectA}` +
    `/revision/${IDS.revisionA}/lane/render/job/${IDS_84.lateCpuAttempt}/artifact`;
  await executor.query(
    `INSERT INTO hosted_cpu_job_attempts(id,account_id,workspace_id,project_id,
      project_revision_id,kind,state,request_sha256,job_spec_object_key,
      job_spec_content_length,job_spec_checksum_sha256,result_object_key,image_digest,
      callback_token_sha256,deadline_at,created_at,updated_at)
     VALUES($1,$2,$3,$4,$5,'RENDER','PLANNED',$6,$7,128,$8,$9,$10,$11,
      transaction_timestamp()+interval '1 hour',transaction_timestamp(),transaction_timestamp())`,
    [
      IDS_84.lateCpuAttempt,
      IDS.accountA,
      IDS.workspaceA,
      IDS.projectA,
      IDS.revisionA,
      sha256("v209-84-late-cpu-request"),
      `${prefix}/job-spec`,
      sha256("v209-84-late-cpu-spec"),
      `${prefix}/result`,
      sha256("v209-84-late-cpu-image"),
      sha256("v209-84-late-cpu-callback"),
    ],
  );
}

async function seedProviderPairScaffold(
  executor,
  { extraAssignment = false, extraOutbox = false, liveOutboxes = false },
) {
  await seedWaitingClick(executor);
  await executor.execute("ALTER TABLE serverless_attempts DISABLE TRIGGER ALL");
  for (const [id, taskId, lane, token] of [
    [IDS_84.mageAttempt, IDS_84.mageTask, "mage_image", sha256("v209-84-mage-token")],
    [IDS_84.soulxAttempt, IDS_84.soulxTask, "soulx_avatar", sha256("v209-84-soulx-token")],
  ]) {
    await executor.query(
      `INSERT INTO serverless_attempts(id,account_id,workspace_id,project_id,project_revision_id,
        generation_request_id,task_id,deployment_id,lane,attempt_ordinal,state,dispatch_token_sha256,
        items_manifest_sha256,item_count,input_manifest_sha256,output_prefix,deadline_at,
        reconciliation_deadline_at,terminal_at,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,1,'PERMANENT_FAILED',$10,$11,1,$12,$13,
        transaction_timestamp()+interval '1 hour',transaction_timestamp()+interval '30 minutes',
        transaction_timestamp(),transaction_timestamp(),transaction_timestamp())`,
      [
        id,
        IDS.accountA,
        IDS.workspaceA,
        IDS.projectA,
        IDS.revisionA,
        IDS_84.generationRequest,
        taskId,
        uuid(lane === "mage_image" ? 2_090_854 : 2_090_855),
        lane,
        token,
        sha256(`${lane}-items`),
        sha256(`${lane}-input`),
        `tenant/${IDS.accountA}/v209-84/${lane}`,
      ],
    );
  }
  await executor.execute("ALTER TABLE serverless_attempts ENABLE TRIGGER ALL");
  await executor.execute("ALTER TABLE serverless_dispatch_outbox DISABLE TRIGGER ALL");
  const state = liveOutboxes ? "READY_TO_DISPATCH" : "DEAD_LETTER";
  for (const [id, attemptId, token, requestBody] of [
    [IDS_84.mageOutbox, IDS_84.mageAttempt, sha256("v209-84-mage-token"), sha256("mage-body")],
    [IDS_84.soulxOutbox, IDS_84.soulxAttempt, sha256("v209-84-soulx-token"), sha256("soulx-body")],
  ]) {
    await executor.query(
      `INSERT INTO serverless_dispatch_outbox(id,account_id,workspace_id,project_revision_id,
        attempt_id,dispatch_token_sha256,authority_sha256,request_body_sha256,state,
        created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,transaction_timestamp(),transaction_timestamp())`,
      [
        id,
        IDS.accountA,
        IDS.workspaceA,
        IDS.revisionA,
        attemptId,
        token,
        sha256(`${attemptId}-authority`),
        requestBody,
        state,
      ],
    );
  }
  if (extraOutbox) {
    await executor.query(
      `INSERT INTO serverless_dispatch_outbox(id,account_id,workspace_id,project_revision_id,
        attempt_id,dispatch_token_sha256,authority_sha256,request_body_sha256,state,
        created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,'DEAD_LETTER',transaction_timestamp(),transaction_timestamp())`,
      [
        IDS_84.extraOutbox,
        IDS.accountA,
        IDS.workspaceA,
        IDS.revisionA,
        IDS_84.mageAttempt,
        sha256("v209-84-extra-token"),
        sha256("v209-84-extra-authority"),
        sha256("v209-84-extra-body"),
      ],
    );
  }
  await executor.execute("ALTER TABLE serverless_dispatch_outbox ENABLE TRIGGER ALL");
  if (extraAssignment) {
    await executor.execute("ALTER TABLE serverless_provider_assignments DISABLE TRIGGER ALL");
    await executor.query(
      `INSERT INTO serverless_provider_assignments(id,account_id,workspace_id,project_revision_id,
        attempt_id,dispatch_token_sha256,provider_job_id,provider_job_id_sha256,assignment_source,
        assigned_at,is_current,superseded_at)
       VALUES($1,$2,$3,$4,$5,$6,'v209-84-stale-job',$7,'RUN_RESPONSE',
        transaction_timestamp()-interval '1 minute',false,transaction_timestamp())`,
      [
        IDS_84.extraAssignment,
        IDS.accountA,
        IDS.workspaceA,
        IDS.revisionA,
        IDS_84.mageAttempt,
        sha256("v209-84-mage-token"),
        sha256("v209-84-stale-job"),
      ],
    );
    await executor.execute("ALTER TABLE serverless_provider_assignments ENABLE TRIGGER ALL");
  }
  if (liveOutboxes) {
    await executor.execute("ALTER TABLE generation_requests DISABLE TRIGGER ALL");
    await executor.query(
      `UPDATE generation_requests SET state='FAILED',terminal_at=transaction_timestamp(),
        updated_at=transaction_timestamp() WHERE id=$1`,
      [IDS_84.generationRequest],
    );
    await executor.execute("ALTER TABLE generation_requests ENABLE TRIGGER ALL");
    await executor.execute("ALTER TABLE video_runtime_states DISABLE TRIGGER ALL");
    await executor.query(
      `UPDATE video_runtime_states SET stage='FAILED',admitted_at=transaction_timestamp(),
        terminal_reason='LANE_PERMANENT_FAILURE',terminal_at=transaction_timestamp(),
        updated_at=transaction_timestamp() WHERE id=$1`,
      [IDS_84.runtime],
    );
    await executor.execute("ALTER TABLE video_runtime_states ENABLE TRIGGER ALL");
    await executor.query(
      `INSERT INTO hosted_pair_runtime_states(generation_request_id,account_id,workspace_id,phase,
        created_at,updated_at) VALUES($1,$2,$3,'SETTLED',transaction_timestamp(),transaction_timestamp())`,
      [IDS_84.generationRequest, IDS.accountA, IDS.workspaceA],
    );
  }
}

function reconcile(executor, claimId = `sha256:${"8".repeat(64)}`) {
  return executor.query(
    "SELECT videoforge_reconcile_hosted_v209_staged_click($1::jsonb) AS value",
    [
      JSON.stringify({
        schemaVersion: "videoforge.v2-09-staged-click-reconciliation/v1",
        accountId: IDS.accountA,
        workspaceId: IDS.workspaceA,
        claimId,
        stage: "GENERATION_CREATED",
        issuedAt: "2026-01-01T00:00:00.000Z",
        idempotencyKey: "v209-staged-click-idempotency",
        createRequestSha256: sha256("v209-staged-create-request"),
        projectId: IDS.projectA,
        projectRevisionId: IDS.revisionA,
        generationRequestId: IDS_84.generationRequest,
      }),
    ],
  );
}

function reconcileProjectOnly(executor, claimId = `sha256:${"8".repeat(64)}`) {
  return executor.query(
    "SELECT videoforge_reconcile_hosted_v209_staged_click($1::jsonb) AS value",
    [
      JSON.stringify({
        schemaVersion: "videoforge.v2-09-staged-click-reconciliation/v1",
        accountId: IDS.accountA,
        workspaceId: IDS.workspaceA,
        claimId,
        stage: "PROJECT_CREATED",
        issuedAt: "2026-01-01T00:00:00.000Z",
        idempotencyKey: "v209-staged-click-idempotency",
        createRequestSha256: sha256("v209-staged-create-request"),
        projectId: IDS.projectA,
        projectRevisionId: IDS.revisionA,
        generationRequestId: null,
      }),
    ],
  );
}

function reconcileCreateRequested(executor, claimId = `sha256:${"8".repeat(64)}`) {
  return executor.query(
    "SELECT videoforge_reconcile_hosted_v209_staged_click($1::jsonb) AS value",
    [
      JSON.stringify({
        schemaVersion: "videoforge.v2-09-staged-click-reconciliation/v1",
        accountId: IDS.accountA,
        workspaceId: IDS.workspaceA,
        claimId,
        stage: "CREATE_REQUESTED",
        issuedAt: "2026-01-01T00:00:00.000Z",
        idempotencyKey: "v209-staged-click-idempotency",
        createRequestSha256: sha256("v209-staged-create-request"),
        projectId: null,
        projectRevisionId: null,
        generationRequestId: null,
      }),
    ],
  );
}

test("0084 cancels and archives only the exact pristine staged click and replays without mutation", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedWaitingClick(executor);
    const first = (await reconcile(executor)).rows[0].value;
    assert.equal(first.schemaVersion, "videoforge.v2-09-staged-click-reconciliation-result/v2");
    assert.equal(first.action, "NO_PROVIDER_REQUEST_TERMINATED_PROJECT_ARCHIVED");
    assert.equal(first.generationRequestId, IDS_84.generationRequest);
    assert.equal(first.generationRequestState, "CANCELLED");
    assert.equal(first.runtimeStage, "CANCELED");
    assert.equal(first.activeLeaseCount, 0);
    assert.equal(first.generationAttemptCount, 0);
    assert.equal(first.projectArchived, true);
    assert.equal(first.replayed, false);
    assert.match(first.receiptSha256, /^sha256:[0-9a-f]{64}$/u);

    const replay = (await reconcile(executor)).rows[0].value;
    assert.equal(replay.action, "NO_PROVIDER_REQUEST_TERMINATED_PROJECT_ARCHIVED");
    assert.equal(replay.replayed, true);
    await assert.rejects(
      reconcile(executor, `sha256:${"9".repeat(64)}`),
      /V2-09 staged (?:archive replay identity|terminal replay) drift/u,
    );
    const state = await executor.query(
      `SELECT request.state request_state,request.version request_version,runtime.stage runtime_stage,
        runtime.terminal_reason,runtime.version runtime_version,project.status project_state,
        (SELECT count(*)::int FROM generation_queue_audits audit
          WHERE audit.request_id=request.id AND audit.operation='CANCEL_WAITING') audit_count,
        (SELECT count(*)::int FROM video_runtime_events event
          WHERE event.runtime_id=runtime.id) runtime_event_count
       FROM generation_requests request
       JOIN video_runtime_states runtime ON runtime.generation_request_id=request.id
       JOIN projects project ON project.id=request.project_id WHERE request.id=$1`,
      [IDS_84.generationRequest],
    );
    assert.deepEqual(state.rows[0], {
      request_state: "CANCELLED",
      request_version: 2,
      runtime_stage: "CANCELED",
      terminal_reason: "SYSTEM_CANCELLED",
      runtime_version: 2,
      project_state: "ARCHIVED",
      audit_count: 1,
      runtime_event_count: 3,
    });
  });
});

test("0084 reports sent or ACK-unknown unassigned provider work as possibly charged", () => {
  const source = readFileSync(
    resolve(ROOT, "packages/control-plane/migrations/0084_hosted_v209_staged_click_cleanup.sql"),
    "utf8",
  );
  assert.match(
    source,
    /'providerMayHaveCharged',jsonb_array_length\(upstream_work\)>0 OR assignment_count>0 OR sent_count>0/u,
  );
  assert.match(
    source,
    /outbox\.send_attempt_count<>0\s+OR outbox\.state IN \('SENT','DISPATCH_ACK_UNKNOWN','ASSIGNED'\)/u,
  );
  assert.match(source, /count\(DISTINCT row\.lane\).*<>2/su);
  assert.match(source, /count\(DISTINCT row\.task_id\).*<>2/su);
  assert.match(
    source,
    /video_runtime_lane_states row\s+WHERE row\.runtime_id=runtime\.id AND row\.lane IN \('mage_image','soulx_avatar'\)\)<>2/u,
  );
});

test("0084 rejects a provider pair with an extra same-attempt outbox", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedProviderPairScaffold(executor, { extraOutbox: true });
    await assert.rejects(reconcile(executor), /outbox or assignment cardinality drift/u);
  });
});

test("0084 rejects a provider pair with an extra historical assignment", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedProviderPairScaffold(executor, { extraAssignment: true });
    await assert.rejects(reconcile(executor), /outbox or assignment cardinality drift/u);
  });
});

test("0084 rejects terminal project archival while either provider outbox remains live", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedProviderPairScaffold(executor, { liveOutboxes: true });
    await assert.rejects(reconcile(executor), /failed request provider pair archive drift/u);
  });
});

test("0084 project-only archive replays only the same durable click claim", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedProjectOnlyClick(executor);
    const first = (await reconcileProjectOnly(executor)).rows[0].value;
    assert.equal(first.action, "PROJECT_WITHOUT_GENERATION_PROJECT_ARCHIVED");
    assert.equal(first.replayed, false);
    const replay = (await reconcileProjectOnly(executor)).rows[0].value;
    assert.equal(replay.action, first.action);
    assert.equal(replay.replayed, true);
    await assert.rejects(
      reconcileProjectOnly(executor, `sha256:${"9".repeat(64)}`),
      /V2-09 staged archive replay identity drift/u,
    );
    const receipt = await executor.query(
      `SELECT claim_id,stage,project_id,project_revision_id,generation_request_id,action,
        evidence_sha256 FROM hosted_v209_staged_click_reconciliations
       WHERE create_request_id=$1`,
      [IDS_84.createRequest],
    );
    assert.equal(receipt.rows.length, 1);
    assert.deepEqual(receipt.rows[0], {
      claim_id: `sha256:${"8".repeat(64)}`,
      stage: "PROJECT_CREATED",
      project_id: IDS.projectA,
      project_revision_id: IDS.revisionA,
      generation_request_id: null,
      action: "PROJECT_WITHOUT_GENERATION_PROJECT_ARCHIVED",
      evidence_sha256: receipt.rows[0].evidence_sha256,
    });
    assert.match(receipt.rows[0].evidence_sha256, /^sha256:[0-9a-f]{64}$/u);
  });
});

test("0084 tombstone makes a late create transaction roll back before it can orphan a project", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedLockedProjects(executor);
    await executor.query("SELECT set_config($1,$2,false)", ["videoforge.account_id", IDS.accountA]);
    const first = (await reconcileCreateRequested(executor)).rows[0].value;
    assert.equal(first.action, "REQUEST_NOT_MATERIALIZED");
    assert.equal(first.requestMaterialized, false);
    assert.equal(first.replayed, false);
    const replay = (await reconcileCreateRequested(executor)).rows[0].value;
    assert.equal(replay.replayed, true);
    await assert.rejects(
      executor.transaction(async (transaction) => {
        await transaction.query("SELECT set_config($1,$2,true)", [
          "videoforge.account_id",
          IDS.accountA,
        ]);
        await transaction.query(
          `INSERT INTO projects(id,workspace_id,owner_user_id,name,normalized_name,project_kind)
           VALUES($1,$2,$3,'Late create','late create','USER')`,
          [IDS_84.lateProject, IDS.workspaceA, IDS.userA],
        );
        await transaction.query(
          `INSERT INTO hosted_project_create_requests(id,account_id,workspace_id,idempotency_key,
            request_sha256,project_id,project_revision_id,voiceover_asset_id,upload_reservation_id,
            upload_receipt_id,state)
           VALUES($1,$2,$3,'v209-staged-click-idempotency',$4,$5,$6,$7,$8,$9,'UPLOAD_PENDING')`,
          [
            uuid(2_090_862),
            IDS.accountA,
            IDS.workspaceA,
            sha256("v209-staged-create-request"),
            IDS_84.lateProject,
            IDS_84.lateRevision,
            IDS_84.lateAsset,
            IDS_84.lateReservation,
            IDS_84.lateReceipt,
          ],
        );
      }),
      /hosted project create was durably cancelled/u,
    );
    const rows = await executor.query("SELECT count(*)::int count FROM projects WHERE id=$1", [
      IDS_84.lateProject,
    ]);
    assert.equal(rows.rows[0].count, 0);
    await assert.rejects(
      reconcileCreateRequested(executor, `sha256:${"9".repeat(64)}`),
      /staged create tombstone drift/u,
    );
  });
});

test("0084 closes commit, Workflow launch, reconciliation, and claim after staged cleanup", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedProjectOnlyClick(executor);
    await seedPlannedCpuAttempt(executor);
    const cleaned = (await reconcileProjectOnly(executor)).rows[0].value;
    assert.equal(cleaned.action, "PROJECT_WITHOUT_GENERATION_PROJECT_ARCHIVED");
    assert.equal(cleaned.activeCpuWorkCount, 0);

    const cpu = await executor.query("SELECT state FROM hosted_cpu_job_attempts WHERE id=$1", [
      IDS_84.lateCpuAttempt,
    ]);
    assert.equal(cpu.rows[0].state, "CANCELLED");

    const createCommitGuard = await executor.query(
      `SELECT create_request.project_id,create_request.project_revision_id
       FROM hosted_project_create_requests create_request
       WHERE create_request.account_id=$1 AND create_request.workspace_id=$2
        AND create_request.project_id=$3 AND create_request.project_revision_id=$4
       FOR UPDATE OF create_request`,
      [IDS.accountA, IDS.workspaceA, IDS.projectA, IDS.revisionA],
    );
    assert.equal(createCommitGuard.rows.length, 1);
    const projectCommitGuard = await executor.query(
      `SELECT project.status FROM projects project
       WHERE project.account_id=$1 AND project.workspace_id=$2 AND project.id=$3
        AND project.status='ACTIVE' FOR UPDATE OF project`,
      [IDS.accountA, IDS.workspaceA, IDS.projectA],
    );
    assert.equal(projectCommitGuard.rows.length, 0);

    const launchGuard = await executor.query(
      `SELECT attempt.id FROM hosted_cpu_job_attempts attempt
       JOIN projects project ON project.account_id=attempt.account_id
        AND project.workspace_id=attempt.workspace_id AND project.id=attempt.project_id
       WHERE attempt.account_id=$1 AND attempt.workspace_id=$2 AND attempt.id=$3
        AND attempt.project_id=$4 AND attempt.project_revision_id=$5
        AND attempt.state='PLANNED' AND project.status='ACTIVE'
       FOR UPDATE OF project,attempt`,
      [IDS.accountA, IDS.workspaceA, IDS_84.lateCpuAttempt, IDS.projectA, IDS.revisionA],
    );
    assert.equal(launchGuard.rows.length, 0);

    const personalWorkerGuard = await executor.query(
      `SELECT attempt.id FROM hosted_cpu_job_attempts attempt
       JOIN projects project ON project.account_id=attempt.account_id
        AND project.workspace_id=attempt.workspace_id AND project.id=attempt.project_id
       WHERE attempt.account_id=$1 AND attempt.workspace_id=$2
        AND attempt.execution_backend='PERSONAL_WORKER'
        AND attempt.state IN ('PLANNED','OUTBOXED') AND project.status='ACTIVE'
       FOR UPDATE OF project,attempt SKIP LOCKED`,
      [IDS.accountA, IDS.workspaceA],
    );
    assert.equal(personalWorkerGuard.rows.length, 0);

    const productSource = readFileSync(
      resolve(ROOT, "apps/web/src/server/hosted/product.ts"),
      "utf8",
    );
    const appSource = readFileSync(resolve(ROOT, "apps/web/src/server/hosted/app.ts"), "utf8");
    const workerSource = readFileSync(
      resolve(ROOT, "apps/web/src/server/hosted/personal-worker.ts"),
      "utf8",
    );
    const commitStart = productSource.indexOf("async function commitProject(");
    const createLock = productSource.indexOf("FOR UPDATE OF create_request", commitStart);
    const projectLock = productSource.indexOf("FOR UPDATE OF project", createLock + 1);
    assert.ok(commitStart >= 0 && createLock > commitStart && projectLock > createLock);
    assert.match(
      appSource,
      /attempt\.state='PLANNED' AND project\.status='ACTIVE'.*FOR UPDATE OF project,attempt/su,
    );
    assert.match(
      workerSource,
      /attempt\.state = 'OUTBOXED'.*project\.status='ACTIVE'.*FOR UPDATE OF project,attempt SKIP LOCKED/su,
    );
  });
});

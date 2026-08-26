import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { canonicalizeJson } from "@videoforge/contracts";

import {
  expectDatabaseError,
  sha256,
  uuid,
  withPgcryptoMigratedDatabase,
} from "./support/pglite.mjs";

const authorityId = uuid(45001);
const mageDeploymentId = uuid(45002);
const soulxDeploymentId = uuid(45003);
const mageQualificationId = uuid(45004);
const soulxQualificationId = uuid(45005);

async function authorityDocument(executor, suffix = "main", ttlMs = 3_600_000) {
  const [{ now }] = (await executor.query("SELECT transaction_timestamp()::text now")).rows;
  const approvedAt = new Date(Date.parse(now) - 60_000).toISOString();
  const expiresAt = new Date(Date.parse(now) + ttlMs).toISOString();
  return {
    schemaVersion: "videoforge-v2-13-full-live-authority/v1",
    authorityId: `authority-${suffix}`,
    proposalSha256: sha256(`proposal-${suffix}`),
    approvalSha256: sha256(`approval-${suffix}`),
    proposalCommit: "a".repeat(40),
    sourceCommit: "b".repeat(40),
    executorSha256: sha256(`executor-${suffix}`),
    phaseCapsUsd: {
      mage_qualification: 4.5,
      soulx_qualification: 1,
      v2_09_short_hosted_project: 2,
      v2_10_operator_free_ranga_pilot: 2,
      v2_11_two_concurrent_owned_projects: 4,
      v2_12_long_output: 2,
      v2_13_final_two_lane_smoke: 2,
    },
    maximumCumulativeSpendUsd: 17.5,
    retention: {
      region: "EU-RO-1",
      volumeCount: 2,
      volumeSizeGb: 50,
      monthlyUsd: 7,
      separatelyApproved: true,
    },
    singleUse: true,
    approvedAt,
    expiresAt,
  };
}

test("0045 permits only exact cleanup bridge claims after authority expiry", async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    const expiredAuthorityId = uuid(45991);
    const authority = await authorityDocument(executor, "cleanup-expiry", 1_000);
    await executor.query(
      "SELECT * FROM videoforge_record_hosted_full_live_authority($1::uuid,$2::jsonb)",
      [expiredAuthorityId, JSON.stringify(authority)],
    );
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const cleanup = {
      operationId: "cleanup-after-expiry",
      stageAuthorityId: expiredAuthorityId,
      kind: "status",
      requestSha256: sha256("cleanup-after-expiry"),
      resourceKey: "v213:prove-zero-workers:cleanup-after-expiry",
    };
    const [{ claim }] = (
      await executor.query("SELECT videoforge_claim_v213_bridge_command($1::jsonb) claim", [
        JSON.stringify(cleanup),
      ])
    ).rows;
    assert.equal(claim.action, "EXECUTE");
    await expectDatabaseError(
      executor.query("SELECT videoforge_claim_v213_bridge_command($1::jsonb)", [
        JSON.stringify({
          ...cleanup,
          operationId: "dispatch-after-expiry",
          kind: "dispatch",
          requestSha256: sha256("dispatch-after-expiry"),
          resourceKey: "v213:v2-09-short-hosted-project:dispatch-after-expiry",
        }),
      ]),
      "42501",
    );
    await expectDatabaseError(
      executor.query("SELECT videoforge_claim_v213_bridge_command($1::jsonb)", [
        JSON.stringify({
          ...cleanup,
          operationId: "forged-cleanup-after-expiry",
          kind: "dispatch",
          requestSha256: sha256("forged-cleanup-after-expiry"),
          resourceKey: "v213:prove-zero-workers:forged-cleanup-after-expiry",
        }),
      ]),
      "42501",
    );
  });
});

async function seedLane(executor, lane, deploymentId, qualificationId, serial, workersMax = 1) {
  const h = (label) => sha256(`${lane}-${label}-${serial}`);
  await executor.query(
    `INSERT INTO serverless_endpoint_deployments(id,lane,endpoint_profile_id,endpoint_id_sha256,
      endpoint_config_sha256,worker_image_digest,model_manifest_sha256,region,volume_id_sha256,
      volume_manifest_sha256,volume_mount,volume_size_gb,gpu_allowlist,gpu_count_per_worker,
      worker_count_min,worker_count_max,worker_ceiling_scope,retained_active_workers,scaler_type,
      scaler_value,handler_concurrency,idle_timeout_seconds,init_timeout_seconds,
      execution_timeout_seconds,request_ttl_seconds,request_ttl_scope,
      reconciliation_deadline_seconds,provider_result_window_seconds,polling_interval_seconds,
      max_replacement_attempts,blind_resubmit_permitted,timeout_evidence,deployment_version,
      is_active,record_sha256,created_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,'EU-RO-1',$8,$9,'/runpod-volume',50,
       ARRAY['NVIDIA GeForce RTX 4090']::text[],1,0,$12,'ACTIVE_PLUS_FLEX',0,'REQUEST_COUNT',1,1,
       300,900,1800,3600,'PROVIDER_QUEUE_PLUS_EXECUTION_PLUS_OUTPUT_UPLOAD',1200,1800,5,0,false,
       $10::jsonb,1,true,$11,transaction_timestamp())`,
    [
      deploymentId,
      lane,
      `v213-${lane}`,
      h("endpoint"),
      h("config"),
      h("image"),
      h("model"),
      h("volume"),
      h("volume-manifest"),
      JSON.stringify({ provider_defaults_accepted: "false", sealed_lineage: { lane, serial } }),
      h("record"),
      workersMax,
    ],
  );
  const [{ snapshot }] = (
    await executor.query("SELECT videoforge_hosted_deployment_snapshot_sha256($1::uuid) snapshot", [
      deploymentId,
    ])
  ).rows;
  await executor.query(
    `INSERT INTO hosted_serverless_qualification_attestations(id,lane,deployment_id,
       deployment_snapshot_sha256,qualification_record_sha256,independent_audit_accepted,
       verified_at,expires_at,created_by_operator,created_at)
     VALUES($1,$2,$3,$4,$5,true,transaction_timestamp()-interval '1 minute',
       transaction_timestamp()+interval '1 hour','test-operator',transaction_timestamp())`,
    [qualificationId, lane, deploymentId, snapshot, h("qualification")],
  );
  return {
    deploymentId,
    qualificationId,
    deploymentSnapshotSha256: snapshot,
    qualificationSha256: h("qualification"),
  };
}

async function promotionDocument(executor, authorityHash, mage, soulx, suffix = "main") {
  const [{ ledger }] = (
    await executor.query(`SELECT 'sha256:'||encode(sha256(convert_to(videoforge_canonical_jsonb(
      jsonb_agg(jsonb_build_object('version',version,'name',name,'filename',filename,'sha256',sha256)
      ORDER BY version)),'UTF8')),'hex') ledger FROM videoforge_schema_migrations`)
  ).rows;
  return {
    authorityDocumentSha256: authorityHash,
    sourceCommit: "b".repeat(40),
    executorSha256: sha256(`executor-${suffix}`),
    migrationLedgerSha256: ledger,
    disabledConfigSha256: sha256("disabled"),
    enabledConfigSha256: sha256("enabled"),
    lanes: { mage_image: mage, soulx_avatar: soulx },
  };
}

const receiptSecret = Buffer.alloc(32, 45);
const receiptKeyId = "v213-publication-receipt-key";

function signedReceipt(lane, serial, volumeIdSha256, volumeManifestSha256, imageDigest, issuedAt) {
  const body = {
    schema_version: "serverless-provenance-receipt/v1",
    receipt_id: `receipt-${lane}-${serial}`,
    attestation_scope: "VIDEOFORGE_APPLICATION_SIGNED_FACTS_NOT_PROVIDER_HARDWARE_ATTESTATION",
    dispatch_token: `dispatch-${lane}-${serial}`,
    envelope_sha256: sha256(`envelope-${lane}-${serial}`),
    request_sha256: sha256(`request-${lane}-${serial}`),
    attempt_id: `attempt-${lane}-${serial}`,
    provider_job_id: `job-${lane}-${serial}`,
    worker_id: `worker-${lane}-${serial}`,
    tenant: { account_id: "account-test", workspace_id: "workspace-test" },
    lane,
    deployment: {
      deployment_id: `qualification-${lane}`,
      endpoint_id_sha256: sha256(`qualification-endpoint-${lane}`),
      container_digest: imageDigest,
      intended_region: "EU-RO-1",
      intended_volume_id_sha256: volumeIdSha256,
      model_manifest_sha256: sha256(`model-${lane}`),
    },
    runtime_probe: {
      gpu_name: "NVIDIA GeForce RTX 4090",
      gpu_count: 1,
      total_vram_bytes: 25_769_803_776,
      peak_vram_bytes: 10_000_000_000,
      gpu_uuid_sha256: sha256(`gpu-${lane}-${serial}`),
      driver_version: "test",
      cuda_version: "test",
      probe_source: "WORKER_RUNTIME_SELF_REPORT",
    },
    volume_verification: {
      manifest_sha256_before: volumeManifestSha256,
      manifest_sha256_after: volumeManifestSha256,
      mutation_detected: false,
      cross_mount_detected: false,
    },
    model_ready_evidence: {
      state: "MODEL_READY",
      warmup_completed: true,
      warmup_output_sha256: sha256(`warmup-${lane}-${serial}`),
    },
    timings: { total_ms: 1000 },
    items: [
      {
        item_id: `item-${serial}`,
        state: "SUCCEEDED",
        output_object_key: `tenant/test/${lane}/${serial}`,
        output_sha256: sha256(`output-${lane}-${serial}`),
        output_bytes: 100,
        probe: { decode_ok: true },
      },
    ],
    scratch_cleanup: { terminal_reason: "SUCCESS", removed: true, scratch_on_model_volume: false },
    receipt_nonce: serial,
    issued_at: issuedAt,
  };
  const receiptSha256 = sha256(canonicalizeJson(body));
  const value = createHmac("sha256", receiptSecret)
    .update(canonicalizeJson({ key_id: receiptKeyId, receipt_sha256: receiptSha256 }))
    .digest("hex");
  return {
    ...body,
    receipt_sha256: receiptSha256,
    signature: { algorithm: "HMAC-SHA256", key_id: receiptKeyId, value },
  };
}

function sealHandoff(document) {
  return { ...document, handoffSha256: sha256(canonicalizeJson(document)) };
}

function productionDeployment(lane, serial, volumeIdSha256, volumeManifestSha256, imageDigest) {
  return {
    lane,
    purpose: "production",
    endpointId: `endpoint-${lane}-${serial}`,
    endpointIdSha256: sha256(`endpoint-${lane}-${serial}`),
    templateId: `template-${lane}-${serial}`,
    templateIdSha256: sha256(`template-${lane}-${serial}`),
    image: `ghcr.io/videoforge/${lane}@${imageDigest}`,
    sourceCommit: "b".repeat(40),
    deploymentSha256: sha256(`deployment-config-${lane}`),
    volumeIdSha256,
    volumeManifestSha256,
    volumeSizeGb: 50,
    volumeMount: "/runpod-volume",
    region: "EU-RO-1",
    gpu: "NVIDIA GeForce RTX 4090",
    gpuCount: 1,
    workersMin: 0,
    workersMax: 1,
    handlerConcurrency: 1,
    scalerType: "REQUEST_COUNT",
    scalerValue: 1,
    initTimeoutSeconds: 800,
  };
}

test("0045 atomically records exact authority and promotes both fresh max-one lanes once", async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    const authority = await authorityDocument(executor);
    const [recorded] = (
      await executor.query(
        "SELECT * FROM videoforge_record_hosted_full_live_authority($1::uuid,$2::jsonb)",
        [authorityId, JSON.stringify(authority)],
      )
    ).rows;
    const [lostResponseReplay] = (
      await executor.query(
        "SELECT * FROM videoforge_record_hosted_full_live_authority($1::uuid,$2::jsonb)",
        [authorityId, JSON.stringify(authority)],
      )
    ).rows;
    assert.equal(lostResponseReplay.authority_document_sha256, recorded.authority_document_sha256);
    await expectDatabaseError(
      executor.query(
        "SELECT * FROM videoforge_record_hosted_full_live_authority($1::uuid,$2::jsonb)",
        [
          authorityId,
          JSON.stringify({ ...authority, authorityId: `${authority.authorityId}-drift` }),
        ],
      ),
    );
    const [{ dbNow }] = (
      await executor.query(
        'SELECT to_char(transaction_timestamp() AT TIME ZONE \'UTC\',\'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') "dbNow"',
      )
    ).rows;
    const stageAuthority = {
      schemaVersion: "videoforge.v213-stage-authority/v1",
      authorityId: "v213-mage-test",
      stage: "mage",
      inputSha256: sha256("stage-input"),
      predecessorHandoffSha256: sha256("stage-predecessor"),
      nonce: "n".repeat(32),
      issuedAt: dbNow,
      expiresAt: new Date(Date.parse(dbNow) + 600_000).toISOString(),
      singleUse: true,
      signatureBase64: "A".repeat(88),
    };
    const [{ stage }] = (
      await executor.query("SELECT videoforge_record_v213_stage_authority($1,$2::jsonb) stage", [
        authorityId,
        JSON.stringify(stageAuthority),
      ])
    ).rows;
    assert.deepEqual(stage, stageAuthority);
    await expectDatabaseError(
      executor.query("SELECT videoforge_record_v213_stage_authority($1,$2::jsonb)", [
        authorityId,
        JSON.stringify({
          ...stageAuthority,
          authorityId: "v213-mage-duplicate",
          nonce: "d".repeat(32),
        }),
      ]),
    );
    const [{ consumed }] = (
      await executor.query("SELECT videoforge_claim_v213_stage_authority($1::jsonb) consumed", [
        JSON.stringify(stageAuthority),
      ])
    ).rows;
    assert.equal(consumed.decision, "EXECUTE");
    const [{ replay }] = (
      await executor.query("SELECT videoforge_claim_v213_stage_authority($1::jsonb) replay", [
        JSON.stringify(stageAuthority),
      ])
    ).rows;
    assert.equal(replay.decision, "REPLAY_REJECTED");
    const operation = {
      operationId: "v213-mage-create",
      stageAuthorityId: stageAuthority.authorityId,
      kind: "create",
      requestSha256: sha256("operation-request"),
      resourceKey: "v213-mage-qualification-resource",
      evidence: { sealed: true },
    };
    const [{ claim }] = (
      await executor.query("SELECT videoforge_claim_v213_operation($1::jsonb) claim", [
        JSON.stringify(operation),
      ])
    ).rows;
    assert.equal(claim.action, "EXECUTE");
    const [{ transitioned }] = (
      await executor.query("SELECT videoforge_transition_v213_operation($1::jsonb) transitioned", [
        JSON.stringify({
          operationId: operation.operationId,
          from: "IN_FLIGHT",
          to: "ACK_UNKNOWN",
          evidence: { bounded: true },
        }),
      ])
    ).rows;
    assert.equal(transitioned.state, "ACK_UNKNOWN");
    const [{ reconcile }] = (
      await executor.query("SELECT videoforge_claim_v213_operation($1::jsonb) reconcile", [
        JSON.stringify(operation),
      ])
    ).rows;
    assert.equal(reconcile.action, "RECONCILE");
    const [{ cleanupScope }] = (
      await executor.query('SELECT videoforge_load_v213_cleanup_scope($1) "cleanupScope"', [
        authorityId,
      ])
    ).rows;
    assert.equal(cleanupScope.schemaVersion, "videoforge.v213-cleanup-scope/v1");
    assert.equal(cleanupScope.stages.length, 1);
    assert.equal(cleanupScope.stages[0].stageAuthorityId, stageAuthority.authorityId);
    assert.equal(cleanupScope.stages[0].operations[0].state, "ACK_UNKNOWN");
    const handoffBase = {
      schemaVersion: "videoforge.v213-mage-qualification-handoff/v1",
      inputSha256: sha256("stage-input"),
      priorHandoffSha256: sha256("stage-predecessor"),
      receipt: { dispatch_token: "secret-one-use-token" },
      billingAfterUsd: 0.25,
      authorityConsumption: consumed,
      zeroWorkersAfter: true,
      threeStableZeroWorkerReads: true,
    };
    const [{ handoffHash }] = (
      await executor.query(
        `SELECT 'sha256:'||encode(sha256(convert_to(videoforge_canonical_jsonb($1::jsonb),'UTF8')),'hex') "handoffHash"`,
        [JSON.stringify(handoffBase)],
      )
    ).rows;
    const handoff = { ...handoffBase, handoffSha256: handoffHash };
    const completeHandoff = () =>
      executor.query(
        `SELECT videoforge_complete_v213_stage_authority($1,$2,$3::jsonb)
           FROM (SELECT set_config('videoforge.v213_handoff_key',$4,true)) configured`,
        [stageAuthority.authorityId, handoffHash, JSON.stringify(handoff), "k".repeat(64)],
      );
    await completeHandoff();
    await completeHandoff();
    const [{ loadedHandoff }] = (
      await executor.query(
        `SELECT videoforge_load_v213_stage_handoff($1,'mage',$2) "loadedHandoff"
           FROM (SELECT set_config('videoforge.v213_handoff_key',$3,true)) configured`,
        [authorityId, handoffHash, "k".repeat(64)],
      )
    ).rows;
    assert.deepEqual(loadedHandoff, handoff);
    await expectDatabaseError(
      executor.query(
        `SELECT videoforge_load_v213_stage_handoff($1,'mage',$2)
           FROM (SELECT set_config('videoforge.v213_handoff_key',$3,true)) configured`,
        [authorityId, handoffHash, "w".repeat(64)],
      ),
    );
    const mage = await seedLane(executor, "mage_image", mageDeploymentId, mageQualificationId, 1);
    const soulx = await seedLane(
      executor,
      "soulx_avatar",
      soulxDeploymentId,
      soulxQualificationId,
      2,
    );
    const promotion = await promotionDocument(
      executor,
      recorded.authority_document_sha256,
      mage,
      soulx,
    );
    const [result] = (
      await executor.query("SELECT * FROM videoforge_promote_hosted_full_live($1,$2,$3::jsonb)", [
        uuid(45006),
        authorityId,
        JSON.stringify(promotion),
      ])
    ).rows;
    assert.match(result.decision_sha256, /^sha256:[0-9a-f]{64}$/u);
    const [promotionReplay] = (
      await executor.query("SELECT * FROM videoforge_promote_hosted_full_live($1,$2,$3::jsonb)", [
        uuid(45006),
        authorityId,
        JSON.stringify(promotion),
      ])
    ).rows;
    assert.equal(promotionReplay.decision_sha256, result.decision_sha256);
    await expectDatabaseError(
      executor.query("SELECT * FROM videoforge_promote_hosted_full_live($1,$2,$3::jsonb)", [
        uuid(45006),
        authorityId,
        JSON.stringify({ ...promotion, enabledConfigSha256: sha256("enabled-drift") }),
      ]),
    );
    const cloudflareReadback = {
      schemaVersion: "videoforge.v213-cloudflare-activation-readback/v1",
      promotionId: uuid(45006),
      sourceCommit: authority.sourceCommit,
      versionIdSha256: sha256("cloudflare-version"),
      deployedConfigSha256: promotion.enabledConfigSha256,
      observedAt: dbNow,
    };
    const [{ cloudflareActivation }] = (
      await executor.query(
        'SELECT videoforge_record_v213_cloudflare_activation($1::uuid,$2::jsonb) "cloudflareActivation"',
        [uuid(45011), JSON.stringify(cloudflareReadback)],
      )
    ).rows;
    assert.equal(cloudflareActivation.versionIdSha256, cloudflareReadback.versionIdSha256);
    const [{ cloudflareReplay }] = (
      await executor.query(
        'SELECT videoforge_record_v213_cloudflare_activation($1::uuid,$2::jsonb) "cloudflareReplay"',
        [uuid(45011), JSON.stringify(cloudflareReadback)],
      )
    ).rows;
    assert.deepEqual(cloudflareReplay, cloudflareActivation);
    await expectDatabaseError(
      executor.query("SELECT videoforge_record_v213_cloudflare_activation($1::uuid,$2::jsonb)", [
        uuid(45011),
        JSON.stringify({ ...cloudflareReadback, versionIdSha256: sha256("drift") }),
      ]),
    );
    const [{ snapshot }] = (
      await executor.query("SELECT videoforge_load_hosted_gpu_activation_v1() snapshot")
    ).rows;
    assert.deepEqual(Object.keys(snapshot).sort(), ["evidence", "verification"]);
    assert.equal(snapshot.verification.accepted, true);
    assert.equal(snapshot.verification.signatureVerified, true);
    assert.equal(snapshot.verification.sourceCommit, authority.sourceCommit);
    assert.deepEqual(snapshot.verification.gate.migrationLedger.at(-1), {
      version: 45,
      sha256: "sha256:fdb9c122c87603ff5f204a055eab902d41f362fec3be58d83be4ec088208b34d",
    });
    assert.equal(snapshot.verification.gate.gpuTransport, "QUALIFIED_EXACT");
    assert.deepEqual(snapshot.verification.gate.cloudflare, {
      sourceCommit: authority.sourceCommit,
      versionIdSha256: cloudflareReadback.versionIdSha256,
      deployedConfigSha256: promotion.enabledConfigSha256,
      readbackSha256: cloudflareActivation.readbackSha256,
      observedAt: dbNow,
    });
    const workflowAuthorityId = uuid(45008);
    const workflowTokenSha256 = sha256("opaque-workflow-token");
    const [{ workflowAuthority }] = (
      await executor.query(
        `SELECT videoforge_record_v213_workflow_start_authority(
        $1::uuid,$2::uuid,$3,transaction_timestamp()+interval '10 minutes') "workflowAuthority"`,
        [workflowAuthorityId, authorityId, workflowTokenSha256],
      )
    ).rows;
    assert.equal(workflowAuthority.tokenSha256, workflowTokenSha256);
    const generationRequestId = uuid(45009);
    const workflowClaim = {
      tokenSha256: workflowTokenSha256,
      workflowId: `hosted-pair-${generationRequestId}`,
      generationRequestId,
      requestSha256: sha256("workflow-request"),
      outerStateSha256: sha256("outer-state"),
      paramsSha256: sha256("workflow-params"),
    };
    const [{ workflowClaimed }] = (
      await executor.query(
        'SELECT videoforge_claim_v213_workflow_start($1::jsonb) "workflowClaimed"',
        [JSON.stringify(workflowClaim)],
      )
    ).rows;
    assert.equal(workflowClaimed.action, "CREATE");
    const [{ workflowReconcile }] = (
      await executor.query(
        'SELECT videoforge_claim_v213_workflow_start($1::jsonb) "workflowReconcile"',
        [JSON.stringify(workflowClaim)],
      )
    ).rows;
    assert.equal(workflowReconcile.action, "RECONCILE");
    const workflowResult = {
      schemaVersion: "videoforge.v213-pair-workflow-start-result/v1",
      workflowId: workflowClaim.workflowId,
      requestSha256: workflowClaim.requestSha256,
      outerStateSha256: workflowClaim.outerStateSha256,
      state: "STARTED",
    };
    const completion = {
      tokenSha256: workflowTokenSha256,
      workflowId: workflowClaim.workflowId,
      requestSha256: workflowClaim.requestSha256,
      outerStateSha256: workflowClaim.outerStateSha256,
      result: workflowResult,
    };
    const [{ workflowCompleted }] = (
      await executor.query(
        'SELECT videoforge_complete_v213_workflow_start($1::jsonb) "workflowCompleted"',
        [JSON.stringify(completion)],
      )
    ).rows;
    assert.deepEqual(workflowCompleted, workflowResult);
    const [{ workflowLoaded }] = (
      await executor.query(
        'SELECT videoforge_load_v213_workflow_start($1::jsonb) "workflowLoaded"',
        [
          JSON.stringify({
            tokenSha256: workflowTokenSha256,
            workflowId: workflowClaim.workflowId,
            requestSha256: workflowClaim.requestSha256,
            outerStateSha256: workflowClaim.outerStateSha256,
          }),
        ],
      )
    ).rows;
    assert.equal(workflowLoaded.action, "EXISTING");
    assert.deepEqual(workflowLoaded.result, workflowResult);
    const secondGenerationRequestId = uuid(45010);
    await expectDatabaseError(
      () =>
        executor.query("SELECT videoforge_claim_v213_workflow_start($1::jsonb)", [
          JSON.stringify({
            ...workflowClaim,
            workflowId: `hosted-pair-${secondGenerationRequestId}`,
            generationRequestId: secondGenerationRequestId,
            requestSha256: sha256("second-workflow"),
          }),
        ]),
      "23505",
    );
    await expectDatabaseError(
      () =>
        executor.query("SELECT videoforge_claim_v213_workflow_start($1::jsonb)", [
          JSON.stringify({ ...workflowClaim, outerStateSha256: sha256("drift") }),
        ]),
      "23505",
    );
    await expectDatabaseError(
      () =>
        executor.query("SELECT * FROM videoforge_promote_hosted_full_live($1,$2,$3::jsonb)", [
          uuid(45007),
          authorityId,
          JSON.stringify(promotion),
        ]),
      "23505",
    );
    assert.deepEqual(
      (await executor.query("SELECT count(*)::int count FROM hosted_full_live_promotions")).rows,
      [{ count: 1 }],
    );
    const rollbackReadback = {
      schemaVersion: "videoforge.v213-cloudflare-rollback-readback/v1",
      activationId: uuid(45011),
      promotionId: uuid(45006),
      disabledVersionIdSha256: sha256("disabled-cloudflare-version"),
      disabledConfigSha256: promotion.disabledConfigSha256,
      routeStatus: 503,
      routeVersionSha256: sha256("disabled-cloudflare-version"),
      observedAt: dbNow,
    };
    const [{ rollback }] = (
      await executor.query(
        'SELECT videoforge_record_v213_cloudflare_rollback($1::uuid,$2::jsonb) "rollback"',
        [uuid(45012), JSON.stringify(rollbackReadback)],
      )
    ).rows;
    assert.match(rollback.rollbackSha256, /^sha256:[0-9a-f]{64}$/u);
    const [{ replayedRollback }] = (
      await executor.query(
        'SELECT videoforge_record_v213_cloudflare_rollback($1::uuid,$2::jsonb) "replayedRollback"',
        [uuid(45012), JSON.stringify(rollbackReadback)],
      )
    ).rows;
    assert.deepEqual(replayedRollback, rollback);
    await expectDatabaseError(
      executor.query("SELECT videoforge_load_hosted_gpu_activation_v1()"),
      "23514",
    );
  });
});

test("0045 publishes HMAC-verified staged qualifications and exact max-one deployments once", async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    await executor.query("SELECT set_config('videoforge.v213_handoff_key',$1,false)", [
      "test-only-v213-handoff-encryption-key-45",
    ]);
    const liveAuthorityId = uuid(45101);
    const authority = await authorityDocument(executor, "publication");
    await executor.query(
      "SELECT * FROM videoforge_record_hosted_full_live_authority($1,$2::jsonb)",
      [liveAuthorityId, JSON.stringify(authority)],
    );
    await executor.query("SELECT videoforge_record_v213_receipt_verification_key($1,$2)", [
      receiptKeyId,
      receiptSecret.toString("base64"),
    ]);
    const [{ dbNow }] = (
      await executor.query(
        'SELECT to_char(transaction_timestamp() AT TIME ZONE \'UTC\',\'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') "dbNow"',
      )
    ).rows;
    const inputSha256 = sha256("publication-input");
    const stage = async (stageName, authorityIdValue, predecessorHandoffSha256, handoff) => {
      const stageAuthority = {
        schemaVersion: "videoforge.v213-stage-authority/v1",
        authorityId: authorityIdValue,
        stage: stageName,
        inputSha256,
        predecessorHandoffSha256,
        nonce: `${stageName}-publication-nonce-${"x".repeat(24)}`,
        issuedAt: dbNow,
        expiresAt: new Date(Date.parse(dbNow) + 600_000).toISOString(),
        singleUse: true,
        signatureBase64: "A".repeat(88),
      };
      await executor.query("SELECT videoforge_record_v213_stage_authority($1,$2::jsonb)", [
        liveAuthorityId,
        JSON.stringify(stageAuthority),
      ]);
      const [{ claimed }] = (
        await executor.query("SELECT videoforge_claim_v213_stage_authority($1::jsonb) claimed", [
          JSON.stringify(stageAuthority),
        ])
      ).rows;
      assert.equal(claimed.decision, "EXECUTE");
      const handoffSha256 = handoff.handoffSha256 ?? sha256(canonicalizeJson(handoff));
      await executor.query("SELECT videoforge_complete_v213_stage_authority($1,$2,$3::jsonb)", [
        authorityIdValue,
        handoffSha256,
        JSON.stringify(handoff),
      ]);
      return handoffSha256;
    };
    const mageImage = sha256("mage-publication-image");
    const soulxImage = sha256("soulx-publication-image");
    const mageVolume = sha256("mage-retained-volume");
    const soulxVolume = sha256("soulx-retained-volume");
    const mageManifest = sha256("mage-sealed-volume-manifest");
    const soulxManifest = sha256("soulx-sealed-volume-manifest");
    const mageReceipt = signedReceipt("mage_image", 1, mageVolume, mageManifest, mageImage, dbNow);
    const soulxReceipts = [2, 3, 4, 5].map((serial) =>
      signedReceipt("soulx_avatar", serial, soulxVolume, soulxManifest, soulxImage, dbNow),
    );
    const mageAuthorityId = "v213-publication-mage";
    const soulxAuthorityId = "v213-publication-soulx";
    const productionAuthorityId = "v213-publication-production";
    const mageHandoff = sealHandoff({
      schemaVersion: "videoforge.v213-mage-qualification-handoff/v1",
      inputSha256,
      priorHandoffSha256: sha256("publication-admission"),
      receipt: mageReceipt,
      billingAfterUsd: 1,
      authorityConsumption: { authorityId: mageAuthorityId },
      zeroWorkersAfter: true,
      threeStableZeroWorkerReads: true,
    });
    await stage("mage", mageAuthorityId, mageHandoff.priorHandoffSha256, mageHandoff);
    const soulxHandoff = sealHandoff({
      schemaVersion: "videoforge.v213-soulx-qualification-handoff/v1",
      inputSha256,
      priorHandoffSha256: mageHandoff.handoffSha256,
      receipts: soulxReceipts,
      billingAfterUsd: 1.5,
      authorityConsumption: { authorityId: soulxAuthorityId },
      zeroWorkersAfter: true,
      threeStableZeroWorkerReads: true,
    });
    await stage("soulx", soulxAuthorityId, mageHandoff.handoffSha256, soulxHandoff);
    const productionResult = {
      schemaVersion: "videoforge.v213-dual-lane-live/v1",
      qualified: true,
      productionAuthorityConsumption: { authorityId: productionAuthorityId },
      qualificationReceipts: [mageReceipt, ...soulxReceipts],
      production: {
        mage: productionDeployment("mage", 1, mageVolume, mageManifest, mageImage),
        soulx: productionDeployment("soulx", 2, soulxVolume, soulxManifest, soulxImage),
      },
      settled: {
        baselineBillingUsd: 0,
        finalBillingUsd: 1.5,
        observedIncrementUsd: 1.5,
        threeStableZeroWorkerReads: true,
      },
    };
    await stage("production", productionAuthorityId, soulxHandoff.handoffSha256, productionResult);
    const publication = {
      schemaVersion: "videoforge.v213-qualified-deployment-publication/v1",
      fullLiveAuthorityId: liveAuthorityId,
      mageStageAuthorityId: mageAuthorityId,
      soulxStageAuthorityId: soulxAuthorityId,
      productionStageAuthorityId: productionAuthorityId,
      receiptKeyId,
      mageDeploymentId: uuid(45102),
      mageQualificationId: uuid(45103),
      soulxDeploymentId: uuid(45104),
      soulxQualificationId: uuid(45105),
    };
    const [{ published }] = (
      await executor.query(
        "SELECT videoforge_publish_v213_qualified_deployments($1::jsonb) published",
        [JSON.stringify(publication)],
      )
    ).rows;
    assert.equal(published.replayed, false);
    assert.deepEqual(Object.keys(published.lanes).sort(), ["mage_image", "soulx_avatar"]);
    const [{ deployments, qualifications }] = (
      await executor.query(`SELECT
        (SELECT count(*)::integer FROM serverless_endpoint_deployments WHERE worker_count_min=0 AND worker_count_max=1) deployments,
        (SELECT count(*)::integer FROM hosted_serverless_qualification_attestations WHERE independent_audit_accepted) qualifications`)
    ).rows;
    assert.equal(deployments, 2);
    assert.equal(qualifications, 2);
    const [{ replayed }] = (
      await executor.query(
        "SELECT videoforge_publish_v213_qualified_deployments($1::jsonb) replayed",
        [JSON.stringify(publication)],
      )
    ).rows;
    assert.equal(replayed.replayed, true);
    const forged = structuredClone(mageReceipt);
    forged.signature.value = "0".repeat(64);
    const [{ accepted }] = (
      await executor.query(
        "SELECT videoforge_verify_v213_qualification_receipt($1::jsonb,$2) accepted",
        [JSON.stringify(forged), receiptKeyId],
      )
    ).rows;
    assert.equal(accepted, false);
    await expectDatabaseError(
      () =>
        executor.query("SELECT videoforge_publish_v213_qualified_deployments($1::jsonb)", [
          JSON.stringify({ ...publication, mageDeploymentId: uuid(45106) }),
        ]),
      "23505",
    );
  });
});

test("0045 rejects cap drift and rolls back an aborted authority transaction", async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    const bad = await authorityDocument(executor, "bad-cap");
    bad.phaseCapsUsd.v2_13_final_two_lane_smoke = 2.01;
    await expectDatabaseError(
      () =>
        executor.query("SELECT * FROM videoforge_record_hosted_full_live_authority($1,$2::jsonb)", [
          uuid(45100),
          JSON.stringify(bad),
        ]),
      "23514",
    );
    const [{ dbNow }] = (
      await executor.query(
        'SELECT to_char(transaction_timestamp() AT TIME ZONE \'UTC\',\'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') "dbNow"',
      )
    ).rows;
    await expectDatabaseError(
      executor.query("SELECT videoforge_record_v213_stage_authority($1,$2::jsonb)", [
        uuid(45999),
        JSON.stringify({
          schemaVersion: "videoforge.v213-stage-authority/v1",
          authorityId: "v213-stage-before-full-authority",
          stage: "mage",
          inputSha256: sha256("unregistered-input"),
          predecessorHandoffSha256: sha256("unregistered-predecessor"),
          nonce: "u".repeat(32),
          issuedAt: dbNow,
          expiresAt: new Date(Date.parse(dbNow) + 600_000).toISOString(),
          singleUse: true,
          signatureBase64: "A".repeat(88),
        }),
      ]),
      "23514",
    );
    const rolled = await authorityDocument(executor, "rollback");
    await assert.rejects(
      executor.transaction(async (tx) => {
        await tx.query("SELECT * FROM videoforge_record_hosted_full_live_authority($1,$2::jsonb)", [
          uuid(45101),
          JSON.stringify(rolled),
        ]);
        throw new Error("abort");
      }),
    );
    assert.deepEqual(
      (await executor.query("SELECT count(*)::int count FROM hosted_full_live_authorities")).rows,
      [{ count: 0 }],
    );
  });
});

test("0045 rejects a fresh qualification bound to a max-two deployment", async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    const authority = await authorityDocument(executor, "max-two");
    const [recorded] = (
      await executor.query(
        "SELECT * FROM videoforge_record_hosted_full_live_authority($1,$2::jsonb)",
        [uuid(45110), JSON.stringify(authority)],
      )
    ).rows;
    // Seed normally, then reproduce the pre-0045 max-two shape in one setup transaction before the
    // immutable qualification row exists. Production cannot update this append-only deployment.
    const mage = await seedLane(executor, "mage_image", uuid(45111), uuid(45112), 11, 2);
    const soulx = await seedLane(executor, "soulx_avatar", uuid(45113), uuid(45114), 12);
    const promotion = await promotionDocument(
      executor,
      recorded.authority_document_sha256,
      mage,
      soulx,
      "max-two",
    );
    await expectDatabaseError(
      () =>
        executor.query("SELECT * FROM videoforge_promote_hosted_full_live($1,$2,$3::jsonb)", [
          uuid(45115),
          uuid(45110),
          JSON.stringify(promotion),
        ]),
      "23514",
    );
  });
});

test("0045 serializes concurrent promotion attempts and commits exactly one", async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    const authority = await authorityDocument(executor, "concurrent");
    const [recorded] = (
      await executor.query(
        "SELECT * FROM videoforge_record_hosted_full_live_authority($1,$2::jsonb)",
        [uuid(45120), JSON.stringify(authority)],
      )
    ).rows;
    const mage = await seedLane(executor, "mage_image", uuid(45121), uuid(45122), 21);
    const soulx = await seedLane(executor, "soulx_avatar", uuid(45123), uuid(45124), 22);
    const promotion = await promotionDocument(
      executor,
      recorded.authority_document_sha256,
      mage,
      soulx,
      "concurrent",
    );
    const attempts = await Promise.allSettled(
      [uuid(45125), uuid(45126)].map((id) =>
        executor.query("SELECT * FROM videoforge_promote_hosted_full_live($1,$2,$3::jsonb)", [
          id,
          uuid(45120),
          JSON.stringify(promotion),
        ]),
      ),
    );
    assert.equal(attempts.filter((item) => item.status === "fulfilled").length, 1);
    assert.equal(attempts.filter((item) => item.status === "rejected").length, 1);
    assert.deepEqual(
      (await executor.query("SELECT count(*)::int count FROM hosted_full_live_promotions")).rows,
      [{ count: 1 }],
    );
  });
});

test("0045 grants runtime only activation and token-fenced Workflow functions; reconciler has none", async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    await executor.execute(
      "CREATE ROLE vf_0045_runtime; CREATE ROLE vf_0045_reconciler; GRANT USAGE ON SCHEMA public TO vf_0045_runtime,vf_0045_reconciler",
    );
    await executor.execute(
      "GRANT EXECUTE ON FUNCTION videoforge_load_hosted_gpu_activation_v1() TO vf_0045_runtime",
    );
    await executor.execute(
      "GRANT EXECUTE ON FUNCTION videoforge_claim_v213_workflow_start(jsonb), videoforge_complete_v213_workflow_start(jsonb), videoforge_load_v213_workflow_start(jsonb) TO vf_0045_runtime",
    );
    await executor.execute(
      "GRANT EXECUTE ON FUNCTION videoforge_claim_v213_operator_acceptance(jsonb), videoforge_complete_v213_operator_acceptance(jsonb), videoforge_claim_v213_live_acceptance(jsonb), videoforge_complete_v213_live_acceptance(jsonb), videoforge_fail_v213_live_acceptance(jsonb), videoforge_record_v213_signed_evidence(jsonb), videoforge_load_v213_signed_evidence(jsonb), videoforge_v213_short_pilot_repository(jsonb), videoforge_v213_production_length_repository(jsonb) TO vf_0045_runtime",
    );
    const [privileges] = (
      await executor.query(`SELECT
      has_function_privilege('vf_0045_runtime','videoforge_load_hosted_gpu_activation_v1()','EXECUTE') runtime_load,
      has_function_privilege('vf_0045_runtime','videoforge_claim_v213_workflow_start(jsonb)','EXECUTE') runtime_workflow_claim,
      has_function_privilege('vf_0045_runtime','videoforge_claim_v213_live_acceptance(jsonb)','EXECUTE') runtime_acceptance_claim,
      has_function_privilege('vf_0045_runtime','videoforge_promote_hosted_full_live(uuid,uuid,jsonb)','EXECUTE') runtime_promote,
      has_function_privilege('vf_0045_runtime','videoforge_record_v213_receipt_verification_key(text,text)','EXECUTE') runtime_key_register,
      has_function_privilege('vf_0045_runtime','videoforge_publish_v213_qualified_deployments(jsonb)','EXECUTE') runtime_publish,
      has_function_privilege('vf_0045_reconciler','videoforge_load_hosted_gpu_activation_v1()','EXECUTE') reconciler_load,
      has_table_privilege('vf_0045_runtime','hosted_full_live_promotions','INSERT') runtime_insert,
      has_table_privilege('vf_0045_runtime','hosted_provider_proof_keys','INSERT') runtime_key_insert`)
    ).rows;
    assert.deepEqual(privileges, {
      runtime_load: true,
      runtime_workflow_claim: true,
      runtime_acceptance_claim: true,
      runtime_promote: false,
      runtime_key_register: false,
      runtime_publish: false,
      reconciler_load: false,
      runtime_insert: false,
      runtime_key_insert: false,
    });
    await expectDatabaseError(
      async () =>
        executor.transaction(async (tx) => {
          await tx.execute("SET ROLE vf_0045_runtime");
          await tx.query("SELECT videoforge_load_hosted_gpu_activation_v1()");
        }),
      "42501",
    );
  });
});

test("0045 durable authority tables are required by metadata and encrypted backup checks", async () => {
  const [metadata, backup, restore] = await Promise.all([
    readFile(new URL("../src/backup/metadata-snapshot.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../deploy/v2-06/backup.sh", import.meta.url), "utf8"),
    readFile(new URL("../../../deploy/v2-06/restore-drill.sh", import.meta.url), "utf8"),
  ]);
  for (const name of [
    "hosted_full_live_authorities",
    "hosted_full_live_promotions",
    "hosted_full_live_cloudflare_activations",
    "hosted_full_live_cloudflare_rollbacks",
    "hosted_full_live_workflow_start_authorities",
    "hosted_full_live_workflow_start_claims",
    "hosted_full_live_workflow_start_results",
    "hosted_full_live_acceptance_authorities",
    "hosted_full_live_acceptance_claims",
    "hosted_full_live_acceptance_results",
    "hosted_full_live_acceptance_operator_results",
    "hosted_full_live_signed_evidence",
    "hosted_full_live_acceptance_repository_records",
    "hosted_v209_settlement_cost_evidence",
    "hosted_v209_terminal_acceptances",
  ]) {
    assert.match(metadata, new RegExp(`"${name}"`, "u"));
    assert.match(backup, new RegExp(name, "u"));
    assert.match(restore, new RegExp(name, "u"));
  }
});

test("0045 V2-09 terminal result derives signed duration and phase spend from durable evidence", async () => {
  const migration = await readFile(
    new URL("../migrations/0045_hosted_full_live_activation.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /jsonb_typeof\(chrome\.document->'durationSeconds'\)='number'/u);
  assert.match(migration, /duration_seconds<30 OR duration_seconds>60/u);
  assert.match(
    migration,
    /phase_spend_micro_usd:=greatest\([\s\S]*final_cumulative_endpoint_billing_micro_usd-admission\.billing_baseline_micro_usd,[\s\S]*ledger_spend_micro_usd\)/u,
  );
  for (const field of [
    "'accepted',true",
    "'terminal',true",
    "'zeroWorkersAfter',true",
    "'durationSeconds',duration_seconds",
    "'settledCostUsd',phase_spend_micro_usd::numeric/1000000",
  ])
    assert.ok(migration.includes(field), `missing trusted V2-09 result field ${field}`);
});

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

async function authorityDocument(
  executor,
  suffix = "main",
  ttlMs = 3_600_000,
  staticReleaseDescriptorSha256 = sha256(`static-release-descriptor-${suffix}`),
) {
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
    staticReleaseDescriptorSha256,
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

function staticReleaseDescriptor() {
  const common = (gate) => ({
    gate,
    sourceEvidenceSha256: sha256(`static-source-${gate}`),
    observerId: `independent-auditor-${gate}`,
    evidencePath: `project-context/evidence/acceptance/VF-10-13/${gate}.json`,
    evidenceClass: "INDEPENDENT_RELEASE_AUDIT",
    observedAt: "2026-08-28T09:55:00.000Z",
    fixtureOrFakeTransportUsed: false,
  });
  const unsigned = {
    schemaVersion: "videoforge.v213-static-release-descriptor/v1",
    sourceCommit: "b".repeat(40),
    productionUrlSha256: sha256("cloudflare-production-url"),
    contractBundleSha256: sha256("static-contract-bundle"),
    auditFacts: {
      operations_runbooks_ready: {
        ...common("operations_runbooks_ready"),
        claims: [
          "stuck_job_runbook",
          "provider_outage_runbook",
          "billing_runbook",
          "rollback_runbook",
        ],
        metrics: {
          stuckJobRunbookSha256: sha256("stuck-runbook"),
          providerOutageRunbookSha256: sha256("provider-runbook"),
          billingRunbookSha256: sha256("billing-runbook"),
          rollbackRunbookSha256: sha256("rollback-runbook"),
        },
      },
      backup_restore_ready: {
        ...common("backup_restore_ready"),
        claims: [
          "backup_readback_passed",
          "restore_evidence_accepted",
          "schema_migration_disposition_recorded",
        ],
        metrics: {
          backupReadbackPassed: true,
          restoreEvidenceAccepted: true,
          schemaMigrationDisposition: "DISPOSABLE_RESTORE_COMPLETED",
        },
      },
      security_clear: {
        ...common("security_clear"),
        claims: [
          "p0_zero",
          "p1_zero",
          "auth_tenant_boundary_passed",
          "ssrf_path_upload_boundary_passed",
          "secret_log_scan_passed",
          "cost_amplification_guards_passed",
          "legacy_runtime_bundle_scan_passed",
        ],
        metrics: {
          p0Count: 0,
          p1Count: 0,
          authTenantPassed: true,
          ssrfPathUploadPassed: true,
          secretLogScanPassed: true,
          costAmplificationGuardsPassed: true,
          legacyRuntimeBundleScanPassed: true,
        },
      },
      production_transport_real: {
        ...common("production_transport_real"),
        claims: [
          "hosted_client_api_truth",
          "fixture_controls_absent",
          "fake_gpu_absent",
          "fake_transport_absent",
          "manual_pod_controls_absent",
          "legacy_dispatch_exports_absent",
        ],
        metrics: {
          hostedClientApiTruth: true,
          fixtureControlsInBundle: false,
          fakeGpuProfileInBundle: false,
          fakeTransportInBundle: false,
          manualPodControlsInBundle: false,
          legacyDispatchExportsInBundle: false,
        },
      },
    },
  };
  return { ...unsigned, descriptorSha256: sha256(canonicalizeJson(unsigned)) };
}

test("0045 rejects JSON null static release provenance, claims, metrics, and fake evidence", async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    const fact = staticReleaseDescriptor().auditFacts.operations_runbooks_ready;
    const assertInvalid = async (label, candidate) => {
      const [{ valid }] = (
        await executor.query(
          "SELECT videoforge_v213_static_release_fact_valid($1,$2::jsonb) valid",
          ["operations_runbooks_ready", JSON.stringify(candidate)],
        )
      ).rows;
      assert.equal(valid, false, label);
    };

    for (const field of [
      "gate",
      "sourceEvidenceSha256",
      "observerId",
      "evidencePath",
      "evidenceClass",
      "observedAt",
    ]) {
      await assertInvalid(`JSON null provenance field: ${field}`, { ...fact, [field]: null });
    }
    await assertInvalid("JSON null fixture marker", {
      ...fact,
      fixtureOrFakeTransportUsed: null,
    });
    await assertInvalid("JSON null claims", { ...fact, claims: null });
    await assertInvalid("JSON null metrics", { ...fact, metrics: null });
    for (const metric of [
      "stuckJobRunbookSha256",
      "providerOutageRunbookSha256",
      "billingRunbookSha256",
      "rollbackRunbookSha256",
    ]) {
      await assertInvalid(`JSON null runbook metric hash: ${metric}`, {
        ...fact,
        metrics: { ...fact.metrics, [metric]: null },
      });
    }
    await assertInvalid("wrong static release claims", {
      ...fact,
      claims: [...fact.claims.slice(0, -1), "wrong_claim"],
    });
    await assertInvalid("fake static release evidence marker", {
      ...fact,
      fixtureOrFakeTransportUsed: true,
    });
    await assertInvalid("fake static release evidence class", {
      ...fact,
      evidenceClass: "FAKE_EVIDENCE",
    });
  });
});

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
    const descriptor = staticReleaseDescriptor();
    const authority = await authorityDocument(
      executor,
      "main",
      3_600_000,
      descriptor.descriptorSha256,
    );
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
    const outerStateSha256 = sha256("main-outer-state");
    const descriptorInput = {
      fullLiveAuthorityId: authorityId,
      outerStateSha256,
      descriptorSha256: descriptor.descriptorSha256,
      descriptor,
    };
    const [{ staticDescriptor }] = (
      await executor.query(
        'SELECT videoforge_record_v213_static_release_descriptor($1::jsonb) "staticDescriptor"',
        [JSON.stringify(descriptorInput)],
      )
    ).rows;
    assert.deepEqual(staticDescriptor, { descriptorSha256: descriptor.descriptorSha256 });
    const [{ staticDescriptorReplay }] = (
      await executor.query(
        'SELECT videoforge_record_v213_static_release_descriptor($1::jsonb) "staticDescriptorReplay"',
        [JSON.stringify(descriptorInput)],
      )
    ).rows;
    assert.deepEqual(staticDescriptorReplay, staticDescriptor);
    await expectDatabaseError(
      executor.query("SELECT videoforge_record_v213_static_release_descriptor($1::jsonb)", [
        JSON.stringify({ ...descriptorInput, outerStateSha256: sha256("outer-drift") }),
      ]),
    );
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
      deployedExecutableSha256: sha256("cloudflare-executable"),
      deployedConfigSha256: promotion.enabledConfigSha256,
      productionUrlSha256: descriptor.productionUrlSha256,
      routeStatus: 200,
      routeBodySha256: sha256("cloudflare-route-body"),
      routeVersionSha256: sha256("cloudflare-version"),
      routeReadbackSha256: "",
      observedAt: dbNow,
    };
    cloudflareReadback.routeReadbackSha256 = sha256(
      JSON.stringify({
        productionUrlSha256: cloudflareReadback.productionUrlSha256,
        routeStatus: cloudflareReadback.routeStatus,
        routeBodySha256: cloudflareReadback.routeBodySha256,
        routeVersionSha256: cloudflareReadback.routeVersionSha256,
        gpuTransport: "QUALIFIED_EXACT",
      }),
    );
    const [{ cloudflareActivation }] = (
      await executor.query(
        'SELECT videoforge_record_v213_cloudflare_activation($1::uuid,$2::jsonb) "cloudflareActivation"',
        [uuid(45011), JSON.stringify(cloudflareReadback)],
      )
    ).rows;
    assert.equal(cloudflareActivation.versionIdSha256, cloudflareReadback.versionIdSha256);
    assert.equal(
      cloudflareActivation.deployedExecutableSha256,
      cloudflareReadback.deployedExecutableSha256,
    );
    assert.equal(cloudflareActivation.productionUrlSha256, cloudflareReadback.productionUrlSha256);
    assert.equal(cloudflareActivation.routeStatus, 200);
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
      version: 48,
      sha256: "sha256:8181d1c050690a8e15ce5cef7473a5caa872d5f868b18f059574dbd4fcbdc82d",
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
  const [metadata, vocabulary, backup, restore] = await Promise.all([
    readFile(new URL("../src/backup/metadata-snapshot.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/database/vocabulary.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../deploy/v2-06/backup.sh", import.meta.url), "utf8"),
    readFile(new URL("../../../deploy/v2-06/restore-drill.sh", import.meta.url), "utf8"),
  ]);
  for (const name of [
    "hosted_full_live_authorities",
    "hosted_full_live_promotions",
    "hosted_full_live_cloudflare_activations",
    "hosted_full_live_cloudflare_rollbacks",
    "hosted_full_live_qualification_materialization_intents",
    "hosted_full_live_workflow_start_authorities",
    "hosted_full_live_workflow_start_claims",
    "hosted_full_live_workflow_start_results",
    "hosted_full_live_acceptance_authorities",
    "hosted_full_live_acceptance_claims",
    "hosted_full_live_acceptance_results",
    "hosted_full_live_acceptance_operator_results",
    "hosted_full_live_signed_evidence",
    "hosted_full_live_acceptance_repository_records",
    "hosted_full_live_materialization_challenges",
    "hosted_full_live_materialization_challenge_assignments",
    "hosted_full_live_materialization_selections",
    "hosted_full_live_materialization_facts",
    "hosted_full_live_materialization_readbacks",
    "hosted_full_live_jit_materialization_intents",
    "hosted_full_live_jit_materializations",
    "hosted_full_live_jit_materialization_readbacks",
    "hosted_full_live_static_release_descriptors",
    "hosted_full_live_jit_operation_authorities",
    "hosted_full_live_acceptance_workflow_events",
    "hosted_full_live_acceptance_operator_evidence_requests",
    "hosted_full_live_acceptance_operator_evidence",
    "hosted_full_live_acceptance_zero_worker_reads",
    "hosted_full_live_acceptance_technical_captures",
    "hosted_full_live_acceptance_workflow_outputs",
    "hosted_full_live_v211_policy_actions",
    "hosted_full_live_v211_scenario_events",
    "hosted_full_live_v211_restore_authorizations",
    "hosted_full_live_v211_probe_cancellations",
    "hosted_full_live_v211_probe_reconciliations",
    "hosted_full_live_operation_receipts",
    "hosted_full_live_release_identity_facts",
    "hosted_full_live_release_gate_facts",
    "hosted_full_live_release_fact_materializations",
    "hosted_full_live_release_chrome_associations",
    "hosted_full_live_release_certifications",
    "hosted_v209_settlement_cost_evidence",
    "hosted_v209_terminal_acceptances",
  ]) {
    assert.match(metadata, new RegExp(`"${name}"`, "u"));
    assert.match(backup, new RegExp(name, "u"));
    assert.match(restore, new RegExp(name, "u"));
  }
  for (const name of [
    "hosted_full_live_manifest_read_claims",
    "hosted_full_live_qualification_materializations",
  ]) {
    assert.match(vocabulary, new RegExp(`"${name}"`, "u"));
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

test("0045 acceptance Workflow advances from operator pause through three distinct zero reads", async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    const fullLiveAuthorityId = uuid(45200);
    const authority = await authorityDocument(executor, "workflow-phases");
    await executor.query(
      "SELECT * FROM videoforge_record_hosted_full_live_authority($1::uuid,$2::jsonb)",
      [fullLiveAuthorityId, JSON.stringify(authority)],
    );
    const [{ now }] = (await executor.query("SELECT transaction_timestamp() now")).rows;
    const issuedAt = new Date(Date.parse(now) - 60_000).toISOString();
    const childExpiresAt = new Date(Date.parse(now) + 600_000).toISOString();
    const workloadDeadlineAt = new Date(Date.parse(now) + 1_800_000).toISOString();
    const stageAuthorityId = "v213-production-workflow-phases";
    const operationId = "v2-10-operator-free-ranga-pilot";
    const requestSha256 = sha256("workflow-phases-request");
    const outputBindingSha256 = sha256("workflow-phases-output");
    const workflowId = "v213-v2-10-workflow-phases";
    await executor.query(
      `INSERT INTO hosted_full_live_stage_authorities(authority_id,full_live_authority_id,stage,
         input_sha256,predecessor_handoff_sha256,nonce_sha256,signed_authority,issued_at,expires_at)
       VALUES($1,$2,'production',$3,$4,$5,'{}'::jsonb,$6,$7)`,
      [
        stageAuthorityId,
        fullLiveAuthorityId,
        sha256("workflow-phases-input"),
        sha256("workflow-phases-predecessor"),
        sha256("workflow-phases-nonce"),
        issuedAt,
        childExpiresAt,
      ],
    );
    await executor.query(
      `INSERT INTO hosted_full_live_jit_operation_authorities(full_live_authority_id,operation_id,
         checkpoint,command_id,production_stage_authority_id,outer_state_sha256,command_payload,
         predecessor_evidence_sha256s,materialization_request_sha256,intent_sha256,candidate_sha256,
         candidate_document,token_sha256,issued_at,expires_at,workload_deadline_at,poll_interval_ms)
       VALUES($1,$2,'V2-10','workflow-phases-command',$3,$4,'{}'::jsonb,'{}'::jsonb,$5,$6,$7,
         '{}'::jsonb,$8,$9,$10,$11,250)`,
      [
        fullLiveAuthorityId,
        operationId,
        stageAuthorityId,
        sha256("workflow-phases-outer"),
        sha256("workflow-phases-materialization"),
        sha256("workflow-phases-intent"),
        sha256("workflow-phases-candidate"),
        sha256("workflow-phases-token"),
        issuedAt,
        childExpiresAt,
        workloadDeadlineAt,
      ],
    );
    await executor.query(
      `INSERT INTO hosted_full_live_acceptance_workflow_events(full_live_authority_id,operation_id,
         sequence,kind,workflow_id,request_sha256)
       VALUES($1,$2,1,'CLAIMED',$3,$4)`,
      [fullLiveAuthorityId, operationId, workflowId, requestSha256],
    );
    await executor.execute(`CREATE OR REPLACE FUNCTION videoforge_v213_acceptance_output_binding(
      supplied_full_live_authority_id uuid,supplied_operation_id text)
      RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
        SELECT '${outputBindingSha256}'::text
      $$`);
    const workflowParams = {
      schemaVersion: "videoforge.v213-acceptance-workflow-params/v1",
      kind: "V213_DATABASE_ACCEPTANCE",
      fullLiveAuthorityId,
      operationId,
      checkpoint: "V2-10",
      workflowId,
      requestSha256,
    };
    const [{ technical }] = (
      await executor.query("SELECT videoforge_read_v213_acceptance_workflow($1::jsonb) technical", [
        JSON.stringify(workflowParams),
      ])
    ).rows;
    assert.equal(technical.phase, "TECHNICAL_CAPTURE");
    await executor.query(
      `INSERT INTO hosted_full_live_acceptance_technical_captures(full_live_authority_id,
         operation_id,output_binding_sha256,plan_sha256,capture_sha256,capture_document)
       VALUES($1,$2,$3,$4,$5,'{}'::jsonb)`,
      [
        fullLiveAuthorityId,
        operationId,
        outputBindingSha256,
        sha256("workflow-phases-technical-plan"),
        sha256("workflow-phases-technical-capture"),
      ],
    );
    const [{ paused }] = (
      await executor.query("SELECT videoforge_read_v213_acceptance_workflow($1::jsonb) paused", [
        JSON.stringify(workflowParams),
      ])
    ).rows;
    assert.equal(paused.phase, "PAUSED_AWAITING_OPERATOR_EVIDENCE");
    assert.equal(paused.zeroWorkerReadCount, 0);
    for (const [ordinal, kind] of ["V210_REAL_CHROME", "V210_VISUAL_DECISION"].entries()) {
      await executor.query(
        `INSERT INTO hosted_full_live_acceptance_operator_evidence(full_live_authority_id,
           operation_id,execution_request_sha256,kind,request_sha256,nonce_sha256,
           binding_document,evidence_document,evidence_sha256,issued_at)
         VALUES($1,$2,$3,$4,$5,$6,'{}'::jsonb,'{}'::jsonb,$7,transaction_timestamp())`,
        [
          fullLiveAuthorityId,
          operationId,
          requestSha256,
          kind,
          sha256(`workflow-phases-evidence-request-${ordinal}`),
          sha256(`workflow-phases-evidence-nonce-${ordinal}`),
          sha256(`workflow-phases-evidence-${ordinal}`),
        ],
      );
    }
    const [{ zero }] = (
      await executor.query("SELECT videoforge_read_v213_acceptance_workflow($1::jsonb) zero", [
        JSON.stringify(workflowParams),
      ])
    ).rows;
    assert.equal(zero.phase, "ZERO_WORKER_READS");
    const base = Date.parse(now) - 7_000;
    for (const ordinal of [0, 1, 2]) {
      const mageObservedAt = new Date(base + ordinal * 2_000).toISOString();
      const soulxObservedAt = new Date(base + ordinal * 2_000 + 250).toISOString();
      const [{ state }] = (
        await executor.query(
          "SELECT videoforge_record_v213_acceptance_zero_worker_read($1::jsonb) state",
          [
            JSON.stringify({
              workflowParams,
              ordinal,
              observations: {
                mage: { workersTotal: 0, queuedJobs: 0, observedAt: mageObservedAt },
                soulx: { workersTotal: 0, queuedJobs: 0, observedAt: soulxObservedAt },
              },
            }),
          ],
        )
      ).rows;
      assert.equal(state.zeroWorkerReadCount, ordinal + 1);
      assert.equal(state.phase, ordinal === 2 ? "BILLING_SETTLEMENT" : "ZERO_WORKER_READS");
    }
    const [{ aggregate }] = (
      await executor.query(
        `SELECT to_char(observed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') aggregate
           FROM hosted_full_live_acceptance_zero_worker_reads
          WHERE full_live_authority_id=$1 AND operation_id=$2 AND ordinal=2`,
        [fullLiveAuthorityId, operationId],
      )
    ).rows;
    assert.equal(aggregate, new Date(base + 4_250).toISOString());
  });
});

test("0045 finalizes a durable V2-13 Workflow exactly once", async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    const fullLiveAuthorityId = uuid(45250);
    const promotionId = uuid(45251);
    const operationId = "v2-13-final-two-lane-smoke";
    const stageAuthorityId = "v213-production-finalizer-lifecycle";
    const workflowId = "v213-v2-13-finalizer-lifecycle";
    const requestSha256 = sha256("finalizer-lifecycle-request");
    const outerStateSha256 = sha256("finalizer-lifecycle-outer");
    const outputBindingSha256 = sha256("finalizer-lifecycle-output-binding");
    const accountId = uuid(45252);
    const workspaceId = uuid(45253);
    const projectId = uuid(45254);
    const projectRevisionId = uuid(45255);
    const generationRequestId = uuid(45256);
    const runtimeId = uuid(45257);
    const finalOutputSha256 = sha256("finalizer-lifecycle-output");
    const finalOutputReceiptSha256 = sha256("finalizer-lifecycle-output-receipt");
    const authority = await authorityDocument(executor, "finalizer-lifecycle");
    const [{ authority_document_sha256: authoritySha256 }] = (
      await executor.query(
        "SELECT * FROM videoforge_record_hosted_full_live_authority($1::uuid,$2::jsonb)",
        [fullLiveAuthorityId, JSON.stringify(authority)],
      )
    ).rows;
    const mage = await seedLane(executor, "mage_image", uuid(45258), uuid(45259), 250);
    const soulx = await seedLane(executor, "soulx_avatar", uuid(45260), uuid(45261), 251);
    const promotion = await promotionDocument(
      executor,
      authoritySha256,
      mage,
      soulx,
      "finalizer-lifecycle",
    );
    const [{ decision_sha256: promotionDecisionSha256 }] = (
      await executor.query("SELECT * FROM videoforge_promote_hosted_full_live($1,$2,$3::jsonb)", [
        promotionId,
        fullLiveAuthorityId,
        JSON.stringify(promotion),
      ])
    ).rows;
    const [{ now }] = (await executor.query("SELECT transaction_timestamp() now")).rows;
    const issuedAt = new Date(Date.parse(now) - 60_000).toISOString();
    const childExpiresAt = new Date(Date.parse(now) + 600_000).toISOString();
    const workloadDeadlineAt = new Date(Date.parse(now) + 1_800_000).toISOString();
    const outputCommittedAt = new Date(Date.parse(now) - 8_000).toISOString();
    const request = {
      executionId: "finalizer-lifecycle-execution",
      proposalSha256: authority.proposalSha256,
      authoritySha256,
      approvalRecordSha256: authority.approvalSha256,
      cumulativeLedgerSha256: sha256("finalizer-lifecycle-ledger"),
      executorSha256: authority.executorSha256,
      promotionDecisionSha256,
      sourceCommit: authority.sourceCommit,
      scopes: [{ accountId, workspaceId, projectId, projectRevisionId }],
      maximumVariableCostMicroUsd: 2_000_000,
      maximumCumulativeVariableCostMicroUsd: 17_500_000,
      billingBaselineMicroUsd: 1_000_000,
      cumulativeLedgerSpentBeforeMicroUsd: 1_000_000,
    };
    const workflowParams = {
      schemaVersion: "videoforge.v213-acceptance-workflow-params/v1",
      kind: "V213_DATABASE_ACCEPTANCE",
      fullLiveAuthorityId,
      operationId,
      checkpoint: "V2-13",
      workflowId,
      requestSha256,
    };
    const primaryIdentity = {
      accountId,
      workspaceId,
      projectId,
      projectRevisionId,
      generationRequestId,
    };
    const challengeId = uuid(45262);
    await executor.execute("SET session_replication_role=replica");
    try {
      await executor.query(
        `INSERT INTO hosted_full_live_stage_authorities(authority_id,full_live_authority_id,stage,
           input_sha256,predecessor_handoff_sha256,nonce_sha256,signed_authority,issued_at,expires_at)
         VALUES($1,$2,'production',$3,$4,$5,'{}'::jsonb,$6,$7)`,
        [
          stageAuthorityId,
          fullLiveAuthorityId,
          sha256("finalizer-lifecycle-stage-input"),
          sha256("finalizer-lifecycle-stage-predecessor"),
          sha256("finalizer-lifecycle-stage-nonce"),
          issuedAt,
          childExpiresAt,
        ],
      );
      await executor.query(
        `INSERT INTO hosted_full_live_jit_operation_authorities(full_live_authority_id,operation_id,
           checkpoint,command_id,production_stage_authority_id,outer_state_sha256,command_payload,
           predecessor_evidence_sha256s,materialization_request_sha256,intent_sha256,candidate_sha256,
           candidate_document,token_sha256,issued_at,expires_at,workload_deadline_at,poll_interval_ms)
         VALUES($1,$2,'V2-13','finalizer-lifecycle-command',$3,$4,'{}'::jsonb,'{}'::jsonb,$5,$6,$7,
           '{}'::jsonb,$8,$9,$10,$11,250)`,
        [
          fullLiveAuthorityId,
          operationId,
          stageAuthorityId,
          outerStateSha256,
          sha256("finalizer-lifecycle-materialization-request"),
          sha256("finalizer-lifecycle-intent"),
          sha256("finalizer-lifecycle-candidate"),
          sha256("finalizer-lifecycle-token"),
          issuedAt,
          childExpiresAt,
          workloadDeadlineAt,
        ],
      );
      await executor.query(
        `INSERT INTO hosted_full_live_materialization_challenges(id,full_live_authority_id,
           challenge_sha256,challenge_document,issued_at,expires_at)
         VALUES($1,$2,$3,$4::jsonb,$5,$6)`,
        [
          challengeId,
          fullLiveAuthorityId,
          sha256("finalizer-lifecycle-challenge"),
          JSON.stringify({ outerStateSha256 }),
          issuedAt,
          childExpiresAt,
        ],
      );
      await executor.query(
        `INSERT INTO hosted_full_live_materialization_facts(challenge_id,selection_sha256,
           facts_sha256,facts_document)
         VALUES($1,$2,$3,$4::jsonb)`,
        [
          challengeId,
          sha256("finalizer-lifecycle-selection"),
          sha256("finalizer-lifecycle-facts"),
          JSON.stringify({ roleScopedIdentities: { primary: primaryIdentity } }),
        ],
      );
      await executor.query(
        `INSERT INTO hosted_full_live_jit_materializations(full_live_authority_id,operation_id,
           checkpoint,candidate_sha256,call_sha256,request_sha256,execution_sha256,request_document,
           execution_document,call_document,expires_at,token_sha256)
         VALUES($1,$2,'V2-13',$3,$4,$5,$6,'{}'::jsonb,$7::jsonb,$8::jsonb,$9,$10)`,
        [
          fullLiveAuthorityId,
          operationId,
          sha256("finalizer-lifecycle-candidate"),
          sha256("finalizer-lifecycle-call"),
          requestSha256,
          sha256("finalizer-lifecycle-execution-document"),
          JSON.stringify({ call: { request } }),
          JSON.stringify({ request }),
          childExpiresAt,
          sha256("finalizer-lifecycle-token"),
        ],
      );
      await executor.query(
        `INSERT INTO hosted_full_live_acceptance_workflow_events(full_live_authority_id,operation_id,
           sequence,kind,workflow_id,request_sha256) VALUES($1,$2,1,'CLAIMED',$3,$4)`,
        [fullLiveAuthorityId, operationId, workflowId, requestSha256],
      );
      await executor.query(
        `INSERT INTO hosted_full_live_acceptance_technical_captures(full_live_authority_id,
           operation_id,output_binding_sha256,plan_sha256,capture_sha256,capture_document)
         VALUES($1,$2,$3,$4,$5,'{}'::jsonb)`,
        [
          fullLiveAuthorityId,
          operationId,
          outputBindingSha256,
          sha256("finalizer-lifecycle-capture-plan"),
          sha256("finalizer-lifecycle-capture"),
        ],
      );
      await executor.query(
        `INSERT INTO video_runtime_states(id,account_id,workspace_id,project_id,project_revision_id,
           generation_request_id,stage,preparation_manifest_sha256,render_manifest_sha256,
           final_output_sha256,terminal_reason,admitted_at,prepared_at,terminal_at,created_at,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,'COMPLETE',$7,$8,$9,'SUCCEEDED',$10,$10,$11,$10,$11)`,
        [
          runtimeId,
          accountId,
          workspaceId,
          projectId,
          projectRevisionId,
          generationRequestId,
          sha256("finalizer-lifecycle-preparation"),
          sha256("finalizer-lifecycle-render"),
          finalOutputSha256,
          issuedAt,
          outputCommittedAt,
        ],
      );
      await executor.query(
        `INSERT INTO video_runtime_events(id,account_id,workspace_id,runtime_id,project_revision_id,
           from_state,to_state,reason,detail,occurred_at)
         VALUES($1,$2,$3,$4,$5,'RENDERING','COMPLETE','FINAL_OUTPUT_DURABLE',$6::jsonb,$7)`,
        [
          uuid(45263),
          accountId,
          workspaceId,
          runtimeId,
          projectRevisionId,
          JSON.stringify({
            final_output_sha256: finalOutputSha256,
            final_output_receipt_sha256: finalOutputReceiptSha256,
          }),
          outputCommittedAt,
        ],
      );
      for (const [index, lane] of ["mage_image", "soulx_avatar"].entries()) {
        const attemptId = uuid(45264 + index * 4);
        const assignmentId = uuid(45265 + index * 4);
        const ledgerId = uuid(45266 + index * 4);
        const dispatchTokenSha256 = sha256(`finalizer-lifecycle-dispatch-${lane}`);
        await executor.query(
          `INSERT INTO serverless_attempts(id,account_id,workspace_id,project_id,project_revision_id,
             generation_request_id,task_id,deployment_id,lane,attempt_ordinal,state,
             dispatch_token_sha256,items_manifest_sha256,item_count,input_manifest_sha256,
             output_prefix,deadline_at,reconciliation_deadline_at,submitted_at,ttl_expires_at,
             terminal_at,created_at,updated_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,1,'SUCCEEDED',$10,$11,1,$12,$13,$14,$15,$16,$14,$17,$16,$17)`,
          [
            attemptId,
            accountId,
            workspaceId,
            projectId,
            projectRevisionId,
            generationRequestId,
            uuid(45272 + index),
            lane === "mage_image" ? mage.deploymentId : soulx.deploymentId,
            lane,
            dispatchTokenSha256,
            sha256(`finalizer-lifecycle-items-${lane}`),
            sha256(`finalizer-lifecycle-input-${lane}`),
            `tenant/${accountId}/workspace/${workspaceId}/lane/${lane}`,
            workloadDeadlineAt,
            childExpiresAt,
            issuedAt,
            outputCommittedAt,
          ],
        );
        await executor.query(
          `INSERT INTO serverless_provider_assignments(id,account_id,workspace_id,
             project_revision_id,attempt_id,dispatch_token_sha256,provider_job_id,
             provider_job_id_sha256,assignment_source,assigned_at,is_current)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,'RUN_RESPONSE',$9,true)`,
          [
            assignmentId,
            accountId,
            workspaceId,
            projectRevisionId,
            attemptId,
            dispatchTokenSha256,
            `finalizer-lifecycle-${lane}`,
            sha256(`finalizer-lifecycle-job-${lane}`),
            issuedAt,
          ],
        );
        await executor.query(
          `INSERT INTO serverless_cost_ledgers(id,account_id,workspace_id,project_revision_id,
             attempt_id,owner_type,owner_id,ceiling_usd,settled_usd,
             fixed_retained_volume_usd_excluded,updated_at)
           VALUES($1,$2,$3,$4,$5,'PROJECT_REVISION',$6,2,0.05,true,$7)`,
          [ledgerId, accountId, workspaceId, projectRevisionId, attemptId, projectRevisionId, now],
        );
        await executor.query(
          `INSERT INTO serverless_cost_events(id,account_id,workspace_id,project_revision_id,
             attempt_id,ledger_id,sequence,kind,amount_usd,rate_source,rate_checked_at,
             confidence,recorded_at)
           VALUES($1,$2,$3,$4,$5,$6,1,'SETTLED',0.05,'test-finalizer',$7,'MEASURED',$7)`,
          [
            uuid(45267 + index * 4),
            accountId,
            workspaceId,
            projectRevisionId,
            attemptId,
            ledgerId,
            now,
          ],
        );
      }
      for (const ordinal of [0, 1, 2]) {
        const observedAt = new Date(Date.parse(now) - 3_000 + ordinal * 1_000).toISOString();
        await executor.query(
          `INSERT INTO hosted_full_live_acceptance_zero_worker_reads(full_live_authority_id,
             operation_id,ordinal,observations,observed_at)
           VALUES($1,$2,$3,$4::jsonb,$5)`,
          [
            fullLiveAuthorityId,
            operationId,
            ordinal,
            JSON.stringify({
              mage: { workersTotal: 0, queuedJobs: 0, observedAt },
              soulx: { workersTotal: 0, queuedJobs: 0, observedAt },
            }),
            observedAt,
          ],
        );
      }
    } finally {
      await executor.execute("SET session_replication_role=origin");
    }
    await executor.execute(`CREATE OR REPLACE FUNCTION videoforge_v213_acceptance_output_binding(
      supplied_full_live_authority_id uuid,supplied_operation_id text)
      RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
        SELECT '${outputBindingSha256}'::text
      $$`);
    const [{ before }] = (
      await executor.query("SELECT videoforge_read_v213_acceptance_workflow($1::jsonb) before", [
        JSON.stringify(workflowParams),
      ])
    ).rows;
    assert.equal(before.phase, "BILLING_SETTLEMENT");
    const [{ completed }] = (
      await executor.query(
        "SELECT videoforge_finalize_v213_acceptance_workflow($1::jsonb) completed",
        [JSON.stringify(workflowParams)],
      )
    ).rows;
    assert.equal(completed.phase, "COMPLETE");
    assert.equal(completed.terminal, true);
    assert.equal(completed.output.rawEvidence.finalOutputSha256, finalOutputSha256);
    assert.equal(completed.output.rawEvidence.finalOutputReceiptSha256, finalOutputReceiptSha256);
    assert.equal(completed.output.receipt.billingSettled, true);
    assert.equal(completed.output.receipt.variableCostMicroUsd, 100_000);
    assert.equal(completed.output.cleanup.accepted, true);
    const [{ replay }] = (
      await executor.query(
        "SELECT videoforge_finalize_v213_acceptance_workflow($1::jsonb) replay",
        [JSON.stringify(workflowParams)],
      )
    ).rows;
    assert.deepEqual(replay.output, completed.output);
    await expectDatabaseError(
      executor.query("SELECT videoforge_finalize_v213_acceptance_workflow($1::jsonb)", [
        JSON.stringify({ ...workflowParams, requestSha256: sha256("finalizer-lifecycle-drift") }),
      ]),
      "42501",
    );
  });
});

test("0045 keeps manifest and operator-evidence ingress off the operator role", async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    await executor.execute(`CREATE ROLE vf_0045_jit_operator;
      CREATE ROLE vf_0045_jit_runtime;
      CREATE ROLE vf_0045_jit_reconciler;
      GRANT USAGE ON SCHEMA public TO vf_0045_jit_operator,vf_0045_jit_runtime,vf_0045_jit_reconciler;
      GRANT EXECUTE ON FUNCTION videoforge_prepare_v213_jit_operation(jsonb),
        videoforge_project_v213_jit_operation(jsonb),
        videoforge_persist_v213_jit_materialization(jsonb),
        videoforge_read_v213_jit_materialization(jsonb),
        videoforge_record_v213_static_release_descriptor(jsonb),
        videoforge_materialize_v213_release_facts(jsonb),
        videoforge_read_v213_release_fact_materialization(jsonb),
        videoforge_project_v213_release_chrome(jsonb),
        videoforge_persist_v213_release_chrome(jsonb),
        videoforge_read_v213_release_chrome(jsonb),
        videoforge_project_v213_release_certification(jsonb),
        videoforge_persist_v213_release_certification(jsonb),
        videoforge_read_v213_release_certification(jsonb) TO vf_0045_jit_operator;
      GRANT EXECUTE ON FUNCTION videoforge_claim_v213_resolved_render_manifest_read(jsonb),
        videoforge_ingest_v213_acceptance_operator_evidence(jsonb),
        videoforge_prepare_v213_acceptance_technical_capture(jsonb),
        videoforge_prepare_v213_v211_policy_action(jsonb),
        videoforge_prepare_v213_v211_scenario_step(jsonb),
        videoforge_cancel_v213_v211_promoted_probe(jsonb),
        videoforge_authorize_v213_v211_restore(jsonb),
        videoforge_claim_v213_acceptance_workflow(jsonb),
        videoforge_read_v213_acceptance_workflow(jsonb) TO vf_0045_jit_runtime;
      GRANT EXECUTE ON FUNCTION videoforge_record_v213_acceptance_technical_capture(jsonb),
        videoforge_record_v213_v211_policy_action(jsonb),
        videoforge_record_v213_v211_scenario_step(jsonb),
        videoforge_record_v213_v211_promoted_probe_reconciliation(jsonb),
        videoforge_record_v213_acceptance_zero_worker_read(jsonb),
        videoforge_finalize_v213_acceptance_workflow(jsonb) TO vf_0045_jit_reconciler`);
    const [privileges] = (
      await executor.query(`SELECT
        has_function_privilege('vf_0045_jit_operator','videoforge_prepare_v213_jit_operation(jsonb)','EXECUTE') operator_prepare,
        has_function_privilege('vf_0045_jit_operator','videoforge_claim_v213_resolved_render_manifest_read(jsonb)','EXECUTE') operator_manifest,
        has_function_privilege('vf_0045_jit_operator','videoforge_ingest_v213_acceptance_operator_evidence(jsonb)','EXECUTE') operator_evidence,
        has_function_privilege('vf_0045_jit_operator','videoforge_record_v213_static_release_descriptor(jsonb)','EXECUTE') operator_static_descriptor,
        has_function_privilege('vf_0045_jit_operator','videoforge_record_v213_release_identity_facts(jsonb)','EXECUTE') operator_release_identity,
        has_function_privilege('vf_0045_jit_operator','videoforge_materialize_v213_release_facts(jsonb)','EXECUTE') operator_release_materialize,
        has_function_privilege('vf_0045_jit_operator','videoforge_project_v213_release_chrome(jsonb)','EXECUTE') operator_release_chrome,
        has_function_privilege('vf_0045_jit_operator','videoforge_project_v213_release_certification(jsonb)','EXECUTE') operator_release_certification,
        has_function_privilege('vf_0045_jit_runtime','videoforge_claim_v213_resolved_render_manifest_read(jsonb)','EXECUTE') runtime_manifest,
        has_function_privilege('vf_0045_jit_runtime','videoforge_ingest_v213_acceptance_operator_evidence(jsonb)','EXECUTE') runtime_evidence,
        has_function_privilege('vf_0045_jit_runtime','videoforge_prepare_v213_acceptance_technical_capture(jsonb)','EXECUTE') runtime_technical_prepare,
        has_function_privilege('vf_0045_jit_runtime','videoforge_prepare_v213_v211_policy_action(jsonb)','EXECUTE') runtime_v211_policy_prepare,
        has_function_privilege('vf_0045_jit_runtime','videoforge_cancel_v213_v211_promoted_probe(jsonb)','EXECUTE') runtime_v211_cancel,
        has_function_privilege('vf_0045_jit_runtime','videoforge_record_v213_v211_policy_action(jsonb)','EXECUTE') runtime_v211_policy_record,
        has_function_privilege('vf_0045_jit_runtime','videoforge_prepare_v213_jit_operation(jsonb)','EXECUTE') runtime_prepare,
        has_function_privilege('vf_0045_jit_runtime','videoforge_project_v213_release_chrome(jsonb)','EXECUTE') runtime_release_chrome,
        has_function_privilege('vf_0045_jit_reconciler','videoforge_record_v213_acceptance_technical_capture(jsonb)','EXECUTE') reconciler_technical_record,
        has_function_privilege('vf_0045_jit_reconciler','videoforge_record_v213_v211_policy_action(jsonb)','EXECUTE') reconciler_v211_policy_record,
        has_function_privilege('vf_0045_jit_reconciler','videoforge_cancel_v213_v211_promoted_probe(jsonb)','EXECUTE') reconciler_v211_cancel,
        has_function_privilege('vf_0045_jit_reconciler','videoforge_record_v213_acceptance_zero_worker_read(jsonb)','EXECUTE') reconciler_zero,
        has_function_privilege('vf_0045_jit_reconciler','videoforge_ingest_v213_acceptance_operator_evidence(jsonb)','EXECUTE') reconciler_evidence`)
    ).rows;
    assert.deepEqual(privileges, {
      operator_prepare: true,
      operator_manifest: false,
      operator_evidence: false,
      operator_static_descriptor: true,
      operator_release_identity: false,
      operator_release_materialize: true,
      operator_release_chrome: true,
      operator_release_certification: true,
      runtime_manifest: true,
      runtime_evidence: true,
      runtime_technical_prepare: true,
      runtime_v211_policy_prepare: true,
      runtime_v211_cancel: true,
      runtime_v211_policy_record: false,
      runtime_prepare: false,
      runtime_release_chrome: false,
      reconciler_technical_record: true,
      reconciler_v211_policy_record: true,
      reconciler_v211_cancel: false,
      reconciler_zero: true,
      reconciler_evidence: false,
    });
  });
});

test("0045 certification projection rejects noncanonical work identity before readback", async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    const fullLiveAuthorityId = uuid(45300);
    const predecessors = {
      "v2-13-final-two-lane-smoke": sha256("cert-smoke"),
      "restore-endpoints-max-one": sha256("cert-restore"),
      "prove-zero-workers": sha256("cert-zero"),
      "read-settled-billing": sha256("cert-billing"),
      "reconcile-exact-resources": sha256("cert-reconcile"),
    };
    const malformed = {
      fullLiveAuthorityId,
      workId: `${fullLiveAuthorityId}:wrong-certification`,
      outerStateSha256: sha256("cert-outer"),
      predecessorEvidenceSha256s: predecessors,
    };
    await expectDatabaseError(
      executor.query("SELECT videoforge_project_v213_release_certification($1::jsonb)", [
        JSON.stringify({
          ...malformed,
          certificationIdentitySha256: sha256(canonicalizeJson(malformed)),
        }),
      ]),
      "23514",
    );
    const canonical = {
      ...malformed,
      workId: `${fullLiveAuthorityId}:certify-v2-13-release`,
    };
    await expectDatabaseError(
      executor.query("SELECT videoforge_project_v213_release_certification($1::jsonb)", [
        JSON.stringify({
          ...canonical,
          certificationIdentitySha256: sha256(canonicalizeJson(canonical)),
        }),
      ]),
      "42501",
    );
  });
});

import assert from "node:assert/strict";
import test from "node:test";

import { canonicalSha256, trustedTenantScope } from "../dist/src/index.js";
import { IDS, seedLockedProjects } from "./support/fixtures.mjs";
import { expectDatabaseError, sha256, uuid, withMigratedDatabase } from "./support/pglite.mjs";

const SIGNATURE =
  "public.videoforge_claim_hosted_paid_dispatch(uuid,text,uuid,uuid,uuid,uuid,uuid,uuid,text,uuid,jsonb,numeric,numeric,timestamp with time zone)";
const DEPLOYMENT_CREATED_AT = "2026-08-25T10:00:00.000Z";

function sealedLineage(digit) {
  return {
    endpointIdSha256: sha256(`endpoint-${digit}`),
    endpointTemplateIdSha256: sha256(`template-${digit}`),
    endpointConfigSha256: sha256(`config-${digit}`),
    workerImageDigest: sha256(`image-${digit}`),
    modelManifestSha256: sha256(`model-${digit}`),
    volumeIdSha256: sha256(`volume-${digit}`),
    volumeManifestSha256: sha256(`volume-manifest-${digit}`),
    imageSourceCommit: "a".repeat(40),
    qualificationSourceSha256: sha256(`qualification-${digit}`),
    dependencyLockSha256: sha256(`lock-${digit}`),
    acceptanceContractSha256: sha256(`acceptance-${digit}`),
    region: "EU-RO-1",
    gpu: "NVIDIA GeForce RTX 4090",
    max1GateConfigSha256: sha256(`max1-gate-${digit}`),
    max1EndpointProfileSha256: sha256(`max1-profile-${digit}`),
    max2GateConfigSha256: sha256(`max2-gate-${digit}`),
    max2EndpointProfileSha256: sha256(`max2-profile-${digit}`),
  };
}

function deployment(lane, deploymentId, digit) {
  return {
    deploymentId,
    lane,
    endpointProfileId: `template:${sha256(`template-${digit}`)}`,
    endpointIdSha256: sha256(`endpoint-${digit}`),
    endpointConfigSha256: sha256(`config-${digit}`),
    workerImageDigest: sha256(`image-${digit}`),
    modelManifestSha256: sha256(`model-${digit}`),
    volumeIdSha256: sha256(`volume-${digit}`),
    volumeManifestSha256: sha256(`volume-manifest-${digit}`),
    idleTimeoutSeconds: 5,
    initTimeoutSeconds: 900,
    executionTimeoutSeconds: 2400,
    requestTtlSeconds: 7200,
    reconciliationDeadlineSeconds: 1500,
    pollingIntervalSeconds: 5,
    maxReplacementAttempts: 1,
    timeoutEvidence: {
      provider_defaults_accepted: false,
      sealed_lineage: sealedLineage(digit),
    },
    deploymentVersion: 1,
    createdAt: DEPLOYMENT_CREATED_AT,
  };
}

function binding(lane, deploymentId, digit) {
  const persisted = deployment(lane, deploymentId, digit);
  const lineage = sealedLineage(digit);
  return {
    lane,
    checkpoint_id: lane === "mage_image" ? "V2-07" : "V2-08",
    operations: ["serverless_run", "serverless_status", "serverless_cancel"],
    resources: [
      `endpoint:${deploymentId}`,
      "gpu:nvidia-geforce-rtx-4090-eu-ro-1",
      `image:${sha256(`image-${digit}`).slice(7)}`,
      `volume:${sha256(`volume-${digit}`).slice(7)}`,
    ],
    deployment_id: deploymentId,
    endpoint_id_sha256: sha256(`endpoint-${digit}`),
    endpoint_config_sha256: sha256(`config-${digit}`),
    worker_image_digest: sha256(`image-${digit}`),
    model_manifest_sha256: sha256(`model-${digit}`),
    volume_id_sha256: sha256(`volume-${digit}`),
    volume_manifest_sha256: sha256(`volume-manifest-${digit}`),
    deployment_snapshot_sha256: canonicalSha256({
      deployment: persisted,
      sealedLineage: lineage,
      sealedLineageSha256: canonicalSha256(lineage),
    }),
  };
}

async function seed(executor) {
  await seedLockedProjects(executor);
  const generationRequestId = uuid(1_400_001);
  const leaseId = uuid(1_400_002);
  const approvalId = uuid(1_400_003);
  const mageDeploymentId = uuid(1_400_004);
  const soulxDeploymentId = uuid(1_400_005);
  const generationPlanSha256 = sha256("generation-plan");
  const approvalSha256 = sha256("operator-approval");
  const scope = trustedTenantScope(IDS.accountA, IDS.workspaceA);
  await executor.query("SELECT set_config($1, $2, false)", [
    "videoforge.account_id",
    scope.accountId,
  ]);
  const clock = await executor.query(
    `SELECT (transaction_timestamp() - interval '1 minute') AS approved_at,
            (transaction_timestamp() + interval '1 hour') AS expires_at`,
  );
  const approvedAt = clock.rows[0].approved_at;
  const expiresAt = clock.rows[0].expires_at;
  await executor.query(
    `INSERT INTO generation_requests (
       id, account_id, workspace_id, project_id, project_revision_id, created_by_user_id,
       state, queue_order, available_at, attempt_ordinal, idempotency_key, admitted_at,
       created_at, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE',1,transaction_timestamp(),1,'paid-gate-test',
       transaction_timestamp(),transaction_timestamp(),transaction_timestamp())`,
    [generationRequestId, IDS.accountA, IDS.workspaceA, IDS.projectA, IDS.revisionA, IDS.userA],
  );
  await executor.query(
    `INSERT INTO provider_workload_leases (
       id, slot, account_id, workspace_id, request_kind, generation_request_id,
       owner_token_sha256, state, acquired_at, heartbeat_at, expires_at
     ) VALUES ($1,1,$2,$3,'VIDEO',$4,$5,'ACTIVE',transaction_timestamp(),
       transaction_timestamp(),transaction_timestamp() + interval '30 minutes')`,
    [leaseId, IDS.accountA, IDS.workspaceA, generationRequestId, sha256("owner-token")],
  );
  // This test owns only the claim gate. The canonical timing bridge has its own full append tests;
  // install its already-validated durable truth without rebuilding the ASR fixture here.
  await executor.execute(`ALTER TABLE hosted_canonical_timing_bridges DISABLE TRIGGER ALL`);
  await executor.query(
    `INSERT INTO hosted_canonical_timing_bridges (
      hosted_asr_attempt_id,account_id,workspace_id,project_id,project_revision_id,
      transcript_id,transcript_document_hash,timeline_plan_id,timeline_document_hash,
      asr_input_sha256,asr_result_sha256,generation_plan_sha256,task_manifest,
      append_payload,completed_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'[{}]'::jsonb,$13::jsonb,
      transaction_timestamp())`,
    [
      uuid(1_400_040),
      IDS.accountA,
      IDS.workspaceA,
      IDS.projectA,
      IDS.revisionA,
      uuid(1_400_041),
      sha256("transcript"),
      uuid(1_400_042),
      sha256("timeline"),
      sha256("asr-input"),
      sha256("asr-result"),
      generationPlanSha256,
      JSON.stringify({ schema_version: "videoforge-hosted-canonical-timing-append/v1" }),
    ],
  );
  await executor.execute(`ALTER TABLE hosted_canonical_timing_bridges ENABLE TRIGGER ALL`);
  for (const [lane, deploymentId, digit] of [
    ["mage_image", mageDeploymentId, "mage"],
    ["soulx_avatar", soulxDeploymentId, "soulx"],
  ]) {
    const exact = binding(lane, deploymentId, digit);
    const persisted = deployment(lane, deploymentId, digit);
    await executor.query(
      `INSERT INTO serverless_endpoint_deployments (
        id,lane,endpoint_profile_id,endpoint_id_sha256,endpoint_config_sha256,
        worker_image_digest,model_manifest_sha256,region,volume_id_sha256,
        volume_manifest_sha256,volume_mount,volume_size_gb,gpu_allowlist,gpu_count_per_worker,
        worker_count_min,worker_count_max,worker_ceiling_scope,retained_active_workers,
        scaler_type,scaler_value,handler_concurrency,idle_timeout_seconds,init_timeout_seconds,
        execution_timeout_seconds,request_ttl_seconds,request_ttl_scope,
        reconciliation_deadline_seconds,provider_result_window_seconds,polling_interval_seconds,
        max_replacement_attempts,blind_resubmit_permitted,timeout_evidence,deployment_version,
        is_active,record_sha256,created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,'EU-RO-1',$8,$9,'/runpod-volume',50,
        ARRAY['NVIDIA GeForce RTX 4090'],1,0,2,'ACTIVE_PLUS_FLEX',0,'REQUEST_COUNT',1,1,
        5,900,2400,7200,'PROVIDER_QUEUE_PLUS_EXECUTION_PLUS_OUTPUT_UPLOAD',1500,1800,5,1,
        false,$10::jsonb,1,true,$11,$12)`,
      [
        deploymentId,
        lane,
        persisted.endpointProfileId,
        exact.endpoint_id_sha256,
        exact.endpoint_config_sha256,
        exact.worker_image_digest,
        exact.model_manifest_sha256,
        exact.volume_id_sha256,
        exact.volume_manifest_sha256,
        JSON.stringify(persisted.timeoutEvidence),
        sha256(`record-${digit}`),
        DEPLOYMENT_CREATED_AT,
      ],
    );
    const databaseHash = await executor.query(
      `SELECT public.videoforge_hosted_deployment_snapshot_sha256($1) AS sha256`,
      [deploymentId],
    );
    assert.equal(databaseHash.rows[0].sha256, exact.deployment_snapshot_sha256);
  }
  const lanes = [
    binding("mage_image", mageDeploymentId, "mage"),
    binding("soulx_avatar", soulxDeploymentId, "soulx"),
  ];
  await executor.query(
    `INSERT INTO hosted_paid_dispatch_approvals (
      id,approval_sha256,account_id,workspace_id,project_id,project_revision_id,
      generation_request_id,generation_plan_sha256,lease_id,lane_bindings,
      maximum_cumulative_finite_cap_usd,expires_at,approved_by_operator,approved_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,2,$11,'test-operator',$12)`,
    [
      approvalId,
      approvalSha256,
      IDS.accountA,
      IDS.workspaceA,
      IDS.projectA,
      IDS.revisionA,
      generationRequestId,
      generationPlanSha256,
      leaseId,
      JSON.stringify(lanes),
      expiresAt,
      approvedAt,
    ],
  );
  return {
    approvalId,
    approvalSha256,
    generationRequestId,
    generationPlanSha256,
    leaseId,
    lanes,
    expiresAt,
  };
}

function claim(executor, fixture, claimId, overrides = {}) {
  return executor.query(
    `SELECT * FROM public.videoforge_claim_hosted_paid_dispatch(
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::numeric,$13::numeric,$14
    )`,
    [
      fixture.approvalId,
      fixture.approvalSha256,
      claimId,
      IDS.accountA,
      IDS.workspaceA,
      IDS.projectA,
      IDS.revisionA,
      fixture.generationRequestId,
      overrides.generationPlanSha256 ?? fixture.generationPlanSha256,
      fixture.leaseId,
      JSON.stringify(overrides.lanes ?? fixture.lanes),
      2,
      overrides.cumulativeReservationUsd ?? 1.5,
      fixture.expiresAt,
    ],
  );
}

test("migration 0040 exposes only one DB-trusted least-privilege claim capability", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    const definition = await executor.query(
      `SELECT prosecdef, proconfig, pg_get_functiondef(oid) AS definition
         FROM pg_catalog.pg_proc WHERE proname = 'videoforge_claim_hosted_paid_dispatch'`,
    );
    assert.equal(definition.rows.length, 1);
    assert.equal(definition.rows[0].prosecdef, true);
    assert.deepEqual(definition.rows[0].proconfig, ["search_path=public, pg_catalog"]);
    assert.match(definition.rows[0].definition, /transaction_timestamp\(\)/u);
    assert.match(definition.rows[0].definition, /current_lease\.expires_at <= db_now/u);
    assert.match(definition.rows[0].definition, /FOR UPDATE/u);
    assert.match(
      definition.rows[0].definition,
      /approval\.lane_bindings IS DISTINCT FROM supplied_lane_bindings/u,
    );
    const lockOrder = [
      "FROM public.generation_requests request",
      "FROM public.project_revisions revision",
      "FROM public.provider_workload_leases lease",
      "FROM public.hosted_canonical_timing_bridges bridge",
      "FROM public.serverless_endpoint_deployments candidate",
    ].map((fragment) => definition.rows[0].definition.indexOf(fragment));
    assert.ok(lockOrder.every((offset) => offset >= 0));
    assert.deepEqual(
      lockOrder,
      [...lockOrder].sort((left, right) => left - right),
    );
    const privilege = await executor.query(
      `SELECT has_function_privilege('public', $1, 'EXECUTE') AS public_execute`,
      [SIGNATURE],
    );
    assert.deepEqual(privilege.rows, [{ public_execute: false }]);
  });
});

test("exact claim wins once and DB rejects replay, cap drift, and full-lane drift", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    const fixture = await seed(executor);
    await expectDatabaseError(
      () => claim(executor, fixture, uuid(1_400_010), { cumulativeReservationUsd: 2.01 }),
      "42501",
    );
    const drifted = structuredClone(fixture.lanes);
    drifted[0].deployment_snapshot_sha256 = sha256("drifted-snapshot");
    await expectDatabaseError(
      () => claim(executor, fixture, uuid(1_400_011), { lanes: drifted }),
      "42501",
    );
    const claimed = await claim(executor, fixture, uuid(1_400_012));
    assert.equal(claimed.rows.length, 1);
    assert.equal(claimed.rows[0].claim_id, uuid(1_400_012));
    assert.ok(
      new Date(claimed.rows[0].claimed_at).getTime() < new Date(fixture.expiresAt).getTime(),
    );
    await expectDatabaseError(() => claim(executor, fixture, uuid(1_400_013)), "23505");
    const rows = await executor.query(
      `SELECT count(*)::int AS count FROM hosted_paid_dispatch_claims WHERE approval_id = $1`,
      [fixture.approvalId],
    );
    assert.equal(rows.rows[0].count, 1);
  });
});

test("two concurrent claims have exactly one durable winner", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    const fixture = await seed(executor);
    const results = await Promise.allSettled([
      claim(executor, fixture, uuid(1_400_020)),
      claim(executor, fixture, uuid(1_400_021)),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    const rows = await executor.query(
      `SELECT id FROM hosted_paid_dispatch_claims WHERE approval_id = $1`,
      [fixture.approvalId],
    );
    assert.equal(rows.rows.length, 1);
    assert.ok([uuid(1_400_020), uuid(1_400_021)].includes(rows.rows[0].id));
  });
});

test("stale persisted generation-plan truth rejects an otherwise exact approval", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    const fixture = await seed(executor);
    await executor.execute(
      `ALTER TABLE hosted_canonical_timing_bridges DISABLE TRIGGER hosted_canonical_timing_bridges_append_only`,
    );
    await executor.query(
      `UPDATE hosted_canonical_timing_bridges SET generation_plan_sha256 = $1
        WHERE project_revision_id = $2`,
      [sha256("new-current-plan"), IDS.revisionA],
    );
    await executor.execute(
      `ALTER TABLE hosted_canonical_timing_bridges ENABLE TRIGGER hosted_canonical_timing_bridges_append_only`,
    );
    await expectDatabaseError(() => claim(executor, fixture, uuid(1_400_050)), "23514");
  });
});

test("an operator-row snapshot echo cannot replace the DB-derived sealed snapshot", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    const fixture = await seed(executor);
    const drifted = structuredClone(fixture.lanes);
    drifted[0].deployment_snapshot_sha256 = sha256("operator-echo-only");
    await executor.execute(
      `ALTER TABLE hosted_paid_dispatch_approvals DISABLE TRIGGER hosted_paid_dispatch_approvals_append_only`,
    );
    await executor.query(
      `UPDATE hosted_paid_dispatch_approvals SET lane_bindings = $1::jsonb WHERE id = $2`,
      [JSON.stringify(drifted), fixture.approvalId],
    );
    await executor.execute(
      `ALTER TABLE hosted_paid_dispatch_approvals ENABLE TRIGGER hosted_paid_dispatch_approvals_append_only`,
    );
    await expectDatabaseError(
      () => claim(executor, { ...fixture, lanes: drifted }, uuid(1_400_051)),
      "23514",
    );
  });
});

test("lease release or deployment retirement wins before claim and fails closed", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    const fixture = await seed(executor);
    await executor.query(
      `UPDATE provider_workload_leases
          SET state = 'RELEASED', released_at = transaction_timestamp(),
              release_reason = 'race-test', version = version + 1
        WHERE id = $1`,
      [fixture.leaseId],
    );
    await expectDatabaseError(() => claim(executor, fixture, uuid(1_400_052)), "23514");
  });
  await withMigratedDatabase(async ({ executor }) => {
    const fixture = await seed(executor);
    await executor.query(
      `UPDATE serverless_endpoint_deployments SET is_active = false
        WHERE id = $1`,
      [fixture.lanes[0].deployment_id],
    );
    await expectDatabaseError(() => claim(executor, fixture, uuid(1_400_053)), "23514");
  });
});

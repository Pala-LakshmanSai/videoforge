import assert from "node:assert/strict";
import test from "node:test";

import {
  FakeServerlessEndpoint,
  PROVENANCE_ATTESTATION_SCOPE,
  ProvenanceReceiptSigner,
  ServerlessDispatchService,
  mintDispatchToken,
  providerFreeV2Authority,
  trustedTenantActorScope,
  trustedTenantScope,
} from "../dist/src/index.js";
import { FairAdmissionRepository } from "../dist/src/admission/index.js";
import { IDS, seedLockedProjects } from "./support/fixtures.mjs";
import {
  FIXED_TIME,
  expectDatabaseError,
  sha256,
  uuid,
  withMigratedDatabase,
} from "./support/pglite.mjs";

const TABLE = "hosted_serverless_output_barrier_completions";
const signer = new ProvenanceReceiptSigner("barrier-migration-test", Buffer.alloc(32, 4));
const endpointIdSha256 = sha256("barrier-endpoint");
const deployment = Object.freeze({
  deploymentId: uuid(970_100),
  lane: "mage_image",
  endpointProfileId: "barrier-profile-v1",
  endpointIdSha256,
  endpointConfigSha256: sha256("barrier-config"),
  workerImageDigest: sha256("barrier-image"),
  modelManifestSha256: sha256("barrier-model"),
  volumeIdSha256: sha256("barrier-volume"),
  volumeManifestSha256: sha256("barrier-volume-manifest"),
  idleTimeoutSeconds: 5,
  initTimeoutSeconds: 900,
  executionTimeoutSeconds: 2400,
  requestTtlSeconds: 3600,
  reconciliationDeadlineSeconds: 1500,
  pollingIntervalSeconds: 5,
  maxReplacementAttempts: 1,
  timeoutEvidence: {
    source: "PROVIDER_FREE_MIGRATION_TEST",
    provider_defaults_accepted: false,
  },
  deploymentVersion: 1,
  createdAt: FIXED_TIME,
});

async function acceptedCanonicalFixture(executor) {
  await seedLockedProjects(executor);
  const scope = trustedTenantScope(IDS.accountA, IDS.workspaceA);
  const actor = trustedTenantActorScope(scope, IDS.userA);
  const admission = new FairAdmissionRepository(executor);
  const requestId = uuid(970_101);
  await admission.enqueueVideo(actor, {
    requestId,
    projectId: IDS.projectA,
    projectRevisionId: IDS.revisionA,
    idempotencyKey: "barrier-migration-video",
    now: FIXED_TIME,
    auditId: uuid(970_102),
  });
  await admission.promoteNext({
    leaseId: uuid(970_103),
    auditId: uuid(970_104),
    ownerTokenSha256: sha256("barrier-lease"),
    now: "2026-08-10T04:00:01.000Z",
    expiresAt: "2026-08-10T05:00:00.000Z",
  });

  const service = new ServerlessDispatchService(executor, signer);
  await service.publishEndpointDeployment(deployment);
  const attemptId = uuid(970_105);
  const outputPrefix =
    `tenant/${IDS.accountA}/workspace/${IDS.workspaceA}/project/${IDS.projectA}` +
    `/revision/${IDS.revisionA}/lane/mage-image/job/${attemptId}`;
  const commit = await service.commitPredispatch(scope, {
    dispatchToken: mintDispatchToken(),
    envelope: { schema: "serverless-worker-job-envelope/v3" },
    attemptId,
    authorityId: uuid(970_106),
    outboxId: uuid(970_107),
    ledgerId: uuid(970_108),
    costEventId: uuid(970_109),
    projectId: IDS.projectA,
    projectRevisionId: IDS.revisionA,
    generationRequestId: requestId,
    taskId: uuid(970_110),
    lane: "mage_image",
    attemptOrdinal: 1,
    itemsManifestSha256: sha256("barrier-items"),
    itemCount: 1,
    inputManifestSha256: sha256("barrier-input"),
    outputPrefix,
    maxInputBytes: 1024,
    maxOutputBytes: 4096,
    requestBody: { lane: "mage_image", items: 1 },
    spendCeilingUsd: 0.5,
    reservationUsd: 0.4,
    rateSource: "provider-free:test",
    rateCheckedAt: FIXED_TIME,
    now: "2026-08-10T04:00:02.000Z",
    checkpointAuthority: providerFreeV2Authority("V2-04"),
  });
  const endpoint = new FakeServerlessEndpoint({
    endpointIdSha256,
    callbackTokenSha256: sha256("callback-token"),
    jobIdPrefix: "barrier",
  });
  const dispatch = await service.dispatchOnce(scope, {
    commit,
    endpoint,
    endpointIdSha256,
    envelope: { schema: "serverless-worker-job-envelope/v3" },
    requestBodySha256: commit.requestBodySha256,
    assignmentId: uuid(970_111),
    leaseId: uuid(970_112),
    holderSha256: sha256("barrier-holder"),
    now: "2026-08-10T04:00:03.000Z",
  });
  assert.equal(dispatch.kind, "ASSIGNED");

  const item = Object.freeze({
    item_id: "scene-a",
    state: "SUCCEEDED",
    output_object_key: `${outputPrefix}/artifact/scene-a`,
    output_sha256: sha256("scene-a"),
    output_bytes: 123,
    probe: { width: 1280, height: 720 },
  });
  const receipt = signer.sign({
    schema_version: "serverless-provenance-receipt/v1",
    receipt_id: "barrier-provenance",
    attestation_scope: PROVENANCE_ATTESTATION_SCOPE,
    dispatch_token: commit.dispatchToken,
    attempt_id: attemptId,
    provider_job_id: dispatch.providerJobId,
    worker_id: "worker-a",
    tenant: { account_id: IDS.accountA, workspace_id: IDS.workspaceA },
    lane: "mage_image",
    deployment: {
      deployment_id: deployment.deploymentId,
      endpoint_id_sha256: deployment.endpointIdSha256,
      container_digest: deployment.workerImageDigest,
      intended_region: "EU-RO-1",
      intended_volume_id_sha256: deployment.volumeIdSha256,
      model_manifest_sha256: deployment.modelManifestSha256,
    },
    runtime_probe: {
      gpu_name: "NVIDIA GeForce RTX 4090",
      gpu_count: 1,
      total_vram_bytes: 24 * 1024 ** 3,
      peak_vram_bytes: 12 * 1024 ** 3,
      gpu_uuid_sha256: sha256("gpu"),
      driver_version: "550.90.07",
      cuda_version: "12.4",
      probe_source: "WORKER_RUNTIME_SELF_REPORT",
    },
    volume_verification: {
      manifest_sha256_before: deployment.volumeManifestSha256,
      manifest_sha256_after: deployment.volumeManifestSha256,
      mutation_detected: false,
      cross_mount_detected: false,
    },
    model_ready_evidence: {
      state: "MODEL_READY",
      warmup_completed: true,
      warmup_output_sha256: sha256("warmup"),
    },
    timings: { total_ms: 100 },
    items: [item],
    scratch_cleanup: {
      terminal_reason: "SUCCESS",
      removed: true,
      scratch_on_model_volume: false,
    },
    receipt_nonce: 1,
    issued_at: "2026-08-10T04:00:04.000Z",
  });
  const artifactCommitSha256 = sha256("artifact-commit");
  await executor.query(`SELECT set_config('videoforge.account_id', $1, false)`, [IDS.accountA]);
  await executor.query(
    `INSERT INTO artifact_reservations (
       id, account_id, workspace_id, project_id, project_revision_id, lane, job_id, artifact_id,
       object_key, method, content_type, content_length, checksum_sha256, expires_at, max_uses,
       used_count, state, retention_class, deletion_owner_account_id, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, 'MAGE_IMAGE', $6, $7, $8, 'PUT', 'image/png', $9, $10,
               '2026-08-10T05:00:00.000Z', 1, 1, 'COMMITTED', 'PROJECT', $2,
               '2026-08-10T04:00:03.000Z', '2026-08-10T04:00:04.000Z')`,
    [
      uuid(970_113),
      IDS.accountA,
      IDS.workspaceA,
      IDS.projectA,
      IDS.revisionA,
      attemptId,
      item.item_id,
      item.output_object_key,
      item.output_bytes,
      item.output_sha256,
    ],
  );
  await executor.query(
    `INSERT INTO artifact_receipts (
       id, account_id, workspace_id, reservation_id, callback_id, object_key, content_type,
       content_length, checksum_sha256, probe, receipt_sha256, committed_at
     ) VALUES ($1, $2, $3, $4, 'barrier-artifact-callback', $5, 'image/png', $6, $7, $8::jsonb,
               $9, '2026-08-10T04:00:05.000Z')`,
    [
      uuid(970_114),
      IDS.accountA,
      IDS.workspaceA,
      uuid(970_113),
      item.output_object_key,
      item.output_bytes,
      item.output_sha256,
      JSON.stringify(item.probe),
      artifactCommitSha256,
    ],
  );
  assert.equal(
    await service.acceptOutput(scope, {
      outputReceiptId: uuid(970_115),
      provenanceRowId: uuid(970_116),
      attemptId,
      receipt,
      artifactCommitReceiptSha256s: [artifactCommitSha256],
      now: "2026-08-10T04:00:06.000Z",
    }),
    "ACCEPTED_CANONICAL",
  );
  return {
    attemptId,
    receipt,
    artifactCommitSha256,
    providerJobId: dispatch.providerJobId,
    dispatchTokenSha256: commit.dispatchTokenSha256,
  };
}

test("migration 0037 seals the hosted output completion relation", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    const columns = await executor.query(
      `SELECT column_name, is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position`,
      [TABLE],
    );
    assert.deepEqual(
      columns.rows.map((row) => row.column_name),
      [
        "attempt_id",
        "account_id",
        "workspace_id",
        "project_id",
        "project_revision_id",
        "lane",
        "assignment_id",
        "provider_job_id",
        "dispatch_token_sha256",
        "deployment_id",
        "endpoint_id_sha256",
        "endpoint_config_sha256",
        "worker_image_digest",
        "model_manifest_sha256",
        "volume_id_sha256",
        "volume_manifest_sha256",
        "region",
        "gpu_allowlist",
        "expected_objects",
        "binding_components",
        "binding_sha256",
        "callback_sha256",
        "provenance_receipt_sha256",
        "artifact_commit_receipt_sha256s",
        "completed_at",
        "created_at",
      ],
    );
    assert.equal(
      columns.rows.every((row) => row.is_nullable === "NO"),
      true,
    );

    const relation = await executor.query(
      `SELECT relrowsecurity, relforcerowsecurity
         FROM pg_catalog.pg_class
        WHERE oid = $1::regclass`,
      [`public.${TABLE}`],
    );
    assert.deepEqual(relation.rows, [{ relrowsecurity: true, relforcerowsecurity: true }]);

    const triggers = await executor.query(
      `SELECT tgname
         FROM pg_catalog.pg_trigger
        WHERE tgrelid = $1::regclass AND NOT tgisinternal
        ORDER BY tgname`,
      [`public.${TABLE}`],
    );
    assert.deepEqual(
      triggers.rows.map((row) => row.tgname),
      [
        "hosted_serverless_output_barrier_completions_append_only",
        "hosted_serverless_output_barrier_completions_derive",
        "hosted_serverless_output_barrier_completions_tenant_write_guard",
      ],
    );

    const constraints = await executor.query(
      `SELECT conname, contype
         FROM pg_catalog.pg_constraint
        WHERE conrelid = $1::regclass
        ORDER BY conname`,
      [`public.${TABLE}`],
    );
    for (const required of [
      "hosted_serverless_output_barrier_attempt_fk",
      "hosted_serverless_output_barrier_assignment_fk",
      "hosted_serverless_output_barrier_deployment_fk",
      "hosted_serverless_output_barrier_project_fk",
      "hosted_serverless_output_barrier_provenance_fk",
      "hosted_serverless_output_barrier_revision_fk",
      "hosted_serverless_output_barrier_workspace_fk",
      "hosted_serverless_output_barrier_completions_pkey",
      "hosted_output_barrier_tenant_attempt_uq",
      "hosted_output_barrier_callback_uq",
      "hosted_output_barrier_provenance_uq",
    ]) {
      assert.ok(
        constraints.rows.some((row) => row.conname === required),
        required,
      );
    }

    const policy = await executor.query(
      `SELECT policyname, cmd, qual, with_check
         FROM pg_catalog.pg_policies
        WHERE schemaname = 'public' AND tablename = $1`,
      [TABLE],
    );
    assert.equal(policy.rows.length, 1);
    assert.equal(policy.rows[0].policyname, `${TABLE}_tenant_rls`);
    assert.match(policy.rows[0].qual, /videoforge_current_account_id/u);
    assert.match(policy.rows[0].with_check, /videoforge_current_account_id/u);

    const derivation = await executor.query(
      `SELECT pg_get_functiondef(oid) AS definition
         FROM pg_catalog.pg_proc
        WHERE proname = 'videoforge_derive_hosted_output_barrier_completion'`,
    );
    assert.match(derivation.rows[0].definition, /ORDER BY reservation\.artifact_id COLLATE "C"/u);
    assert.match(derivation.rows[0].definition, /bound_assignment\.dispatch_token_sha256/u);
    assert.match(derivation.rows[0].definition, /bound_provenance\.project_revision_id/u);
  });
});

test("migration 0037 refuses a completion without exact durable lineage", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await executor.query(`SELECT set_config('videoforge.account_id', $1, false)`, [IDS.accountA]);
    await expectDatabaseError(
      executor.query(
        `INSERT INTO hosted_serverless_output_barrier_completions (
           account_id, workspace_id, attempt_id, binding_sha256, callback_sha256,
           binding_components, provenance_receipt_sha256,
           artifact_commit_receipt_sha256s, completed_at
         ) VALUES ($1, $2, $3, $4, $5, '{}'::jsonb, $6, $7::jsonb,
                   '2026-08-25T10:00:00.000Z')`,
        [
          IDS.accountA,
          IDS.workspaceA,
          uuid(970_001),
          sha256("binding"),
          sha256("callback"),
          sha256("provenance"),
          JSON.stringify([sha256("artifact-commit")]),
        ],
      ),
      "23514",
    );
    const stored = await executor.query(`SELECT count(*)::int AS total FROM ${TABLE}`);
    assert.deepEqual(stored.rows, [{ total: 0 }]);
  });
});

test("migration 0037 derives sealed lineage once and makes completion append-only", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    const fixture = await acceptedCanonicalFixture(executor);
    const bindingSha256 = sha256("full-binding");
    const callbackSha256 = sha256("exact-callback");
    const expectedObjects = [
      {
        item_id: "scene-a",
        object_key:
          `tenant/${IDS.accountA}/workspace/${IDS.workspaceA}/project/${IDS.projectA}` +
          `/revision/${IDS.revisionA}/lane/mage-image/job/${fixture.attemptId}/artifact/scene-a`,
        content_type: "image/png",
        content_length: 123,
        checksum_sha256: sha256("scene-a"),
      },
    ];
    const bindingComponents = {
      account_id: IDS.accountA,
      workspace_id: IDS.workspaceA,
      project_id: IDS.projectA,
      project_revision_id: IDS.revisionA,
      lane: "mage_image",
      attempt_id: fixture.attemptId,
      provider_job_id: fixture.providerJobId,
      dispatch_token_sha256: fixture.dispatchTokenSha256,
      deployment_id: deployment.deploymentId,
      endpoint_id_sha256: deployment.endpointIdSha256,
      endpoint_config_sha256: deployment.endpointConfigSha256,
      worker_image_digest: deployment.workerImageDigest,
      model_manifest_sha256: deployment.modelManifestSha256,
      volume_id_sha256: deployment.volumeIdSha256,
      volume_manifest_sha256: deployment.volumeManifestSha256,
      expected_objects: expectedObjects,
    };
    await executor.query(
      `INSERT INTO hosted_serverless_output_barrier_completions (
         account_id, workspace_id, attempt_id, binding_sha256, callback_sha256,
         binding_components, provenance_receipt_sha256,
         artifact_commit_receipt_sha256s, completed_at
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb,
                 '2026-08-10T04:00:06.000Z')`,
      [
        IDS.accountA,
        IDS.workspaceA,
        fixture.attemptId,
        bindingSha256,
        callbackSha256,
        JSON.stringify(bindingComponents),
        fixture.receipt.receipt_sha256,
        JSON.stringify([fixture.artifactCommitSha256]),
      ],
    );
    const stored = await executor.query(
      `SELECT account_id, workspace_id, project_id, project_revision_id, lane, provider_job_id,
              endpoint_id_sha256, endpoint_config_sha256, worker_image_digest,
              model_manifest_sha256, volume_id_sha256, volume_manifest_sha256, region,
              gpu_allowlist, expected_objects, binding_sha256, callback_sha256
         FROM hosted_serverless_output_barrier_completions
        WHERE attempt_id = $1`,
      [fixture.attemptId],
    );
    assert.equal(stored.rows.length, 1);
    assert.deepEqual(
      {
        account_id: stored.rows[0].account_id,
        workspace_id: stored.rows[0].workspace_id,
        project_id: stored.rows[0].project_id,
        project_revision_id: stored.rows[0].project_revision_id,
        lane: stored.rows[0].lane,
        endpoint_id_sha256: stored.rows[0].endpoint_id_sha256,
        endpoint_config_sha256: stored.rows[0].endpoint_config_sha256,
        worker_image_digest: stored.rows[0].worker_image_digest,
        model_manifest_sha256: stored.rows[0].model_manifest_sha256,
        volume_id_sha256: stored.rows[0].volume_id_sha256,
        volume_manifest_sha256: stored.rows[0].volume_manifest_sha256,
        region: stored.rows[0].region,
        gpu_allowlist: stored.rows[0].gpu_allowlist,
        binding_sha256: stored.rows[0].binding_sha256,
        callback_sha256: stored.rows[0].callback_sha256,
      },
      {
        account_id: IDS.accountA,
        workspace_id: IDS.workspaceA,
        project_id: IDS.projectA,
        project_revision_id: IDS.revisionA,
        lane: "mage_image",
        endpoint_id_sha256: deployment.endpointIdSha256,
        endpoint_config_sha256: deployment.endpointConfigSha256,
        worker_image_digest: deployment.workerImageDigest,
        model_manifest_sha256: deployment.modelManifestSha256,
        volume_id_sha256: deployment.volumeIdSha256,
        volume_manifest_sha256: deployment.volumeManifestSha256,
        region: "EU-RO-1",
        gpu_allowlist: ["NVIDIA GeForce RTX 4090"],
        binding_sha256: bindingSha256,
        callback_sha256: callbackSha256,
      },
    );
    assert.deepEqual(stored.rows[0].expected_objects, expectedObjects);

    await expectDatabaseError(
      executor.query(
        `UPDATE hosted_serverless_output_barrier_completions SET callback_sha256 = $2
          WHERE attempt_id = $1`,
        [fixture.attemptId, sha256("mutated")],
      ),
      "55000",
    );
    await expectDatabaseError(
      executor.query(
        `DELETE FROM hosted_serverless_output_barrier_completions WHERE attempt_id = $1`,
        [fixture.attemptId],
      ),
      "55000",
    );
  });
});

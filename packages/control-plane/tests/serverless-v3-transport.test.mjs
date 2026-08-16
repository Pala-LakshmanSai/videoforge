import assert from "node:assert/strict";
import test from "node:test";

import {
  FakeServerlessEndpoint,
  FakeTransportError,
  PROVENANCE_ATTESTATION_SCOPE,
  ProvenanceReceiptSigner,
  ServerlessAuthorityError,
  ServerlessBatchError,
  ServerlessDispatchError,
  ServerlessDispatchService,
  buildAcceptedUnitResumeBatch,
  digestUtf8,
  providerFreeV2Authority,
  trustedTenantActorScope,
  trustedTenantScope,
  validateV2ProviderAuthority,
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

const t = (seconds) => new Date(Date.parse(FIXED_TIME) + seconds * 1_000).toISOString();
const scopeA = () => trustedTenantScope(IDS.accountA, IDS.workspaceA);
const scopeB = () => trustedTenantScope(IDS.accountB, IDS.workspaceB);
const actorA = () => trustedTenantActorScope(scopeA(), IDS.userA);
const actorB = () => trustedTenantActorScope(scopeB(), IDS.userB);

const RATE_SOURCE = "https://docs.runpod.io/serverless/pricing";
const ENDPOINT_ID_SHA256 = sha256("mage-endpoint-id");
const CALLBACK_TOKEN_SHA256 = sha256("mage-callback-token");
const SIGNER = new ProvenanceReceiptSigner("worker-key-1", Buffer.alloc(32, 7));

const DEPLOYMENT = Object.freeze({
  deploymentId: uuid(700_001),
  lane: "mage_image",
  endpointProfileId: "mage-serverless-v1",
  endpointIdSha256: ENDPOINT_ID_SHA256,
  endpointConfigSha256: sha256("mage-endpoint-config"),
  workerImageDigest: sha256("mage-worker-image"),
  modelManifestSha256: sha256("mage-model-manifest"),
  volumeIdSha256: sha256("mage-volume-id"),
  volumeManifestSha256: sha256("mage-volume-manifest"),
  idleTimeoutSeconds: 5,
  initTimeoutSeconds: 900,
  executionTimeoutSeconds: 2400,
  requestTtlSeconds: 3600,
  reconciliationDeadlineSeconds: 1500,
  pollingIntervalSeconds: 5,
  maxReplacementAttempts: 1,
  timeoutEvidence: {
    source: "PROVISIONAL_PROVIDER_FREE_BOUND",
    measured_at: FIXED_TIME,
    evidence_path:
      "project-context/evidence/acceptance/VF-10-04/2026-08-16-serverless-v3-contracts/acceptance.json",
    provider_defaults_accepted: false,
  },
  deploymentVersion: 1,
  createdAt: FIXED_TIME,
});

function outputPrefix(scope, projectId, revisionId, attemptId) {
  return `tenant/${scope.accountId}/workspace/${scope.workspaceId}/project/${projectId}/revision/${revisionId}/lane/mage-image/job/${attemptId}`;
}

function predispatchInput(
  serial,
  scope,
  { projectId, revisionId, requestId, lane = "mage_image" },
) {
  const attemptId = uuid(serial);
  return {
    attemptId,
    authorityId: uuid(serial + 1),
    outboxId: uuid(serial + 2),
    ledgerId: uuid(serial + 3),
    costEventId: uuid(serial + 4),
    projectId,
    projectRevisionId: revisionId,
    generationRequestId: requestId,
    taskId: uuid(serial + 5),
    lane,
    attemptOrdinal: 1,
    itemsManifestSha256: sha256(`items-${serial}`),
    itemCount: 3,
    inputManifestSha256: sha256(`inputs-${serial}`),
    outputPrefix: outputPrefix(scope, projectId, revisionId, attemptId),
    maxInputBytes: 268_435_456,
    maxOutputBytes: 2_147_483_648,
    requestBody: { lane, items: 3, manifest: sha256(`items-${serial}`) },
    spendCeilingUsd: 0.5,
    reservationUsd: 0.4,
    rateSource: RATE_SOURCE,
    rateCheckedAt: FIXED_TIME,
    now: FIXED_TIME,
    checkpointAuthority: providerFreeV2Authority("V2-04"),
  };
}

function receiptFor(commit, options = {}) {
  const body = {
    schema_version: "serverless-provenance-receipt/v1",
    receipt_id: options.receiptId ?? `provenance-${commit.attemptId}`,
    attestation_scope: options.attestationScope ?? PROVENANCE_ATTESTATION_SCOPE,
    dispatch_token: options.dispatchToken ?? commit.dispatchToken,
    attempt_id: options.attemptId ?? commit.attemptId,
    provider_job_id: options.providerJobId ?? null,
    worker_id: options.workerId ?? "worker-a",
    tenant: options.tenant ?? { account_id: IDS.accountA, workspace_id: IDS.workspaceA },
    lane: "mage_image",
    deployment: {
      deployment_id: DEPLOYMENT.deploymentId,
      endpoint_id_sha256: DEPLOYMENT.endpointIdSha256,
      container_digest: DEPLOYMENT.workerImageDigest,
      intended_region: "EU-RO-1",
      intended_volume_id_sha256: options.volumeIdSha256 ?? DEPLOYMENT.volumeIdSha256,
      model_manifest_sha256: DEPLOYMENT.modelManifestSha256,
    },
    runtime_probe: {
      gpu_name: options.gpuName ?? "NVIDIA GeForce RTX 4090",
      gpu_count: 1,
      gpu_uuid_sha256: sha256("gpu-uuid"),
      driver_version: "550.90.07",
      cuda_version: "12.4",
      probe_source: "WORKER_RUNTIME_SELF_REPORT",
    },
    volume_verification: {
      manifest_sha256_before: DEPLOYMENT.volumeManifestSha256,
      manifest_sha256_after: options.manifestAfter ?? DEPLOYMENT.volumeManifestSha256,
      mutation_detected: options.mutationDetected ?? false,
      cross_mount_detected: false,
    },
    model_ready_evidence: {
      state: "MODEL_READY",
      warmup_completed: true,
      warmup_output_sha256: sha256("warmup"),
    },
    timings: {
      allocation_ms: 1200,
      container_ready_ms: 8000,
      volume_verified_ms: 900,
      model_load_ms: 41_000,
      warmup_ms: 6000,
      first_inference_ms: 2100,
      upload_ms: 3000,
      total_ms: 62_200,
    },
    items: [
      {
        item_id: "scene-1",
        state: "SUCCEEDED",
        output_object_key: `${commit.outputPrefix ?? "tenant/x"}/artifact/scene-1`,
        output_sha256: sha256("scene-1"),
        output_bytes: 812_345,
        probe: { width: 1280, height: 720 },
      },
    ],
    scratch_cleanup: {
      terminal_reason: "SUCCESS",
      removed: options.scratchRemoved ?? true,
      scratch_on_model_volume: false,
    },
    receipt_nonce: options.nonce ?? 1,
    issued_at: options.issuedAt ?? t(90),
  };
  return SIGNER.sign(body);
}

async function seeded(work) {
  return withMigratedDatabase(async (context) => {
    await seedLockedProjects(context.executor);
    const admission = new FairAdmissionRepository(context.executor);
    const service = new ServerlessDispatchService(context.executor, SIGNER);
    await service.publishEndpointDeployment(DEPLOYMENT);
    return work({ ...context, admission, service });
  });
}

async function admitVideo(admission, actor, serial, projectId, revisionId) {
  const requestId = uuid(serial);
  await admission.enqueueVideo(actor, {
    requestId,
    projectId,
    projectRevisionId: revisionId,
    idempotencyKey: `video-${serial}`,
    now: FIXED_TIME,
    auditId: uuid(serial + 500),
  });
  await admission.promoteNext({
    leaseId: uuid(serial + 600),
    auditId: uuid(serial + 700),
    ownerTokenSha256: sha256(`lease-${serial}`),
    now: t(1),
    expiresAt: t(3600),
  });
  return requestId;
}

function endpoint() {
  return new FakeServerlessEndpoint({
    endpointIdSha256: ENDPOINT_ID_SHA256,
    callbackTokenSha256: CALLBACK_TOKEN_SHA256,
    jobIdPrefix: "mage",
  });
}

async function dispatch(service, scope, commit, transport, serial, now = t(2)) {
  return service.dispatchOnce(scope, {
    commit,
    endpoint: transport,
    endpointIdSha256: ENDPOINT_ID_SHA256,
    envelope: { schema: "serverless-worker-job-envelope/v3" },
    requestBodySha256: commit.requestBodySha256,
    assignmentId: uuid(serial + 10),
    leaseId: uuid(serial + 11),
    holderSha256: sha256(`holder-${serial}`),
    now,
  });
}

// ---------------------------------------------------------------------------------------------
// Checkpoint-generic authority validation
// ---------------------------------------------------------------------------------------------

test("checkpoint-generic V2 authority keeps exact read-only, paid, resource, rate, and cap rules", () => {
  assert.equal(providerFreeV2Authority("V2-04").mode, "none");

  assert.throws(
    () => validateV2ProviderAuthority({ ...providerFreeV2Authority("V2-04"), capUsd: 0.25 }),
    (error) => error instanceof ServerlessAuthorityError && error.code === "AUTHORITY_CAP_INVALID",
  );

  const readOnly = {
    checkpointId: "V2-07",
    mode: "read_only",
    provider: "runpod",
    capUsd: 0,
    nonTransferable: true,
    resources: ["endpoint:mage", "volume:mage-50gb"],
    allowedOperations: ["inventory_lookup", "rate_lookup"],
    authorizedOperations: ["rate_lookup", "inventory_lookup"],
    rateSnapshot: [],
    authorizedByUserAt: FIXED_TIME,
    modelId: null,
  };
  assert.equal(validateV2ProviderAuthority(readOnly).mode, "read_only");

  // A read-only checkpoint can never smuggle a mutation into its operation list.
  assert.throws(
    () =>
      validateV2ProviderAuthority({
        ...readOnly,
        allowedOperations: ["inventory_lookup", "endpoint_create"],
        authorizedOperations: ["inventory_lookup", "endpoint_create"],
      }),
    (error) =>
      error instanceof ServerlessAuthorityError && error.code === "AUTHORITY_OPERATION_FORBIDDEN",
  );
  // Wildcards never replace exact resources.
  assert.throws(
    () => validateV2ProviderAuthority({ ...readOnly, resources: ["endpoint:*"] }),
    (error) =>
      error instanceof ServerlessAuthorityError && error.code === "AUTHORITY_RESOURCES_INVALID",
  );
  // Allowed and authorized lists must be the same set.
  assert.throws(
    () => validateV2ProviderAuthority({ ...readOnly, authorizedOperations: ["rate_lookup"] }),
    (error) =>
      error instanceof ServerlessAuthorityError && error.code === "AUTHORITY_OPERATIONS_INVALID",
  );
  // A local checkpoint can never hold external authority.
  assert.throws(
    () => validateV2ProviderAuthority({ ...readOnly, checkpointId: "V2-04" }),
    (error) =>
      error instanceof ServerlessAuthorityError && error.code === "AUTHORITY_CHECKPOINT_INVALID",
  );

  const paid = {
    checkpointId: "V2-07",
    mode: "paid",
    provider: "runpod",
    capUsd: 5,
    nonTransferable: true,
    resources: ["endpoint:mage", "volume:mage-50gb", "image:mage-digest", "gpu:rtx-4090"],
    allowedOperations: ["serverless_run", "serverless_status"],
    authorizedOperations: ["serverless_status", "serverless_run"],
    rateSnapshot: [
      {
        resourceId: "gpu:rtx-4090",
        billingUnit: "second",
        usdPerUnit: 0.00031,
        checkedAt: FIXED_TIME,
      },
    ],
    authorizedByUserAt: FIXED_TIME,
    modelId: "Comfy-Org/Mage-Flow",
  };
  assert.equal(validateV2ProviderAuthority(paid).mode, "paid");
  assert.throws(
    () => validateV2ProviderAuthority({ ...paid, resources: paid.resources.slice(0, 3) }),
    (error) =>
      error instanceof ServerlessAuthorityError && error.code === "AUTHORITY_RESOURCES_INVALID",
  );
  assert.throws(
    () => validateV2ProviderAuthority({ ...paid, rateSnapshot: [] }),
    (error) =>
      error instanceof ServerlessAuthorityError && error.code === "AUTHORITY_RATE_SNAPSHOT_INVALID",
  );
  assert.throws(
    () => validateV2ProviderAuthority({ ...paid, modelId: null }),
    (error) =>
      error instanceof ServerlessAuthorityError && error.code === "AUTHORITY_MODEL_ID_REQUIRED",
  );
  assert.throws(
    () => validateV2ProviderAuthority({ ...paid, capUsd: 0 }),
    (error) => error instanceof ServerlessAuthorityError && error.code === "AUTHORITY_CAP_INVALID",
  );
});

// ---------------------------------------------------------------------------------------------
// Predispatch, dispatch, status, and durable acceptance
// ---------------------------------------------------------------------------------------------

test("a stable dispatch token and outbox row exist before the fake /run call", async () => {
  await seeded(async ({ executor, admission, service }) => {
    const requestId = await admitVideo(admission, actorA(), 800_001, IDS.projectA, IDS.revisionA);
    const commit = await service.commitPredispatch(
      scopeA(),
      predispatchInput(810_001, scopeA(), {
        projectId: IDS.projectA,
        revisionId: IDS.revisionA,
        requestId,
      }),
    );

    const transport = endpoint();
    // Nothing has been sent yet, and the durable record already binds every dispatch fact.
    assert.equal(transport.acceptedJobCount(), 0);
    const outbox = await executor.query(
      `SELECT state, send_attempt_count, dispatch_token_sha256, authority_sha256
         FROM serverless_dispatch_outbox WHERE attempt_id = $1`,
      [commit.attemptId],
    );
    assert.equal(outbox.rows[0].state, "READY_TO_DISPATCH");
    assert.equal(outbox.rows[0].send_attempt_count, 0);
    assert.equal(outbox.rows[0].dispatch_token_sha256, digestUtf8(commit.dispatchToken));

    const authority = await executor.query(
      `SELECT checkpoint_id, authority_mode, allowed_operations, spend_ceiling_usd,
              request_ttl_seconds, execution_timeout_seconds, init_timeout_seconds,
              volume_id_sha256, gpu_allowlist, region
         FROM serverless_predispatch_authorities WHERE attempt_id = $1`,
      [commit.attemptId],
    );
    const bound = authority.rows[0];
    assert.equal(bound.checkpoint_id, "V2-04");
    assert.equal(bound.authority_mode, "provider_free_fixture");
    assert.deepEqual(bound.allowed_operations, [
      "serverless_run",
      "serverless_status",
      "serverless_cancel",
    ]);
    assert.equal(Number(bound.spend_ceiling_usd), 0.5);
    assert.equal(bound.request_ttl_seconds, 3600);
    assert.equal(bound.volume_id_sha256, DEPLOYMENT.volumeIdSha256);
    assert.deepEqual(bound.gpu_allowlist, ["NVIDIA GeForce RTX 4090"]);
    assert.equal(bound.region, "EU-RO-1");

    // The reservation is committed with the authority, not after the provider answers.
    const ledger = await executor.query(
      `SELECT reserved_usd, ceiling_usd, fixed_retained_volume_usd_excluded
         FROM serverless_cost_ledgers WHERE attempt_id = $1`,
      [commit.attemptId],
    );
    assert.equal(Number(ledger.rows[0].reserved_usd), 0.4);
    assert.equal(ledger.rows[0].fixed_retained_volume_usd_excluded, true);
  });
});

test("endpoint and request bytes must match predispatch before the outbox can be leased", async () => {
  await seeded(async ({ executor, admission, service }) => {
    const requestId = await admitVideo(admission, actorA(), 800_101, IDS.projectA, IDS.revisionA);
    const commit = await service.commitPredispatch(
      scopeA(),
      predispatchInput(810_101, scopeA(), {
        projectId: IDS.projectA,
        revisionId: IDS.revisionA,
        requestId,
      }),
    );
    const transport = endpoint();

    await assert.rejects(
      service.dispatchOnce(scopeA(), {
        commit,
        endpoint: transport,
        endpointIdSha256: sha256("wrong-endpoint"),
        envelope: { schema: "serverless-worker-job-envelope/v3" },
        requestBodySha256: commit.requestBodySha256,
        assignmentId: uuid(820_101),
        leaseId: uuid(820_102),
        holderSha256: sha256("holder-810101"),
        now: t(2),
      }),
      (error) =>
        error instanceof ServerlessDispatchError && error.code === "ENDPOINT_BINDING_MISMATCH",
    );
    await assert.rejects(
      service.dispatchOnce(scopeA(), {
        commit,
        endpoint: transport,
        endpointIdSha256: commit.endpointIdSha256,
        envelope: { schema: "serverless-worker-job-envelope/v3" },
        requestBodySha256: sha256("wrong-request-bytes"),
        assignmentId: uuid(820_103),
        leaseId: uuid(820_104),
        holderSha256: sha256("holder-810102"),
        now: t(2),
      }),
      (error) => error instanceof ServerlessDispatchError && error.code === "REQUEST_BODY_MISMATCH",
    );

    assert.equal(transport.acceptedJobCount(), 0);
    const outbox = await executor.query(
      `SELECT state, send_attempt_count FROM serverless_dispatch_outbox WHERE id = $1`,
      [commit.outboxId],
    );
    assert.deepEqual(outbox.rows, [{ state: "READY_TO_DISPATCH", send_attempt_count: 0 }]);
  });
});

test("a predispatch failure rolls back the attempt, authority, outbox, and reservation together", async () => {
  await seeded(async ({ executor, admission, service }) => {
    const requestId = await admitVideo(admission, actorA(), 800_002, IDS.projectA, IDS.revisionA);
    await assert.rejects(
      service.commitPredispatch(scopeA(), {
        ...predispatchInput(810_002, scopeA(), {
          projectId: IDS.projectA,
          revisionId: IDS.revisionA,
          requestId,
        }),
        beforeCommit: () => {
          throw new Error("injected predispatch failure");
        },
      }),
    );
    for (const table of [
      "serverless_attempts",
      "serverless_predispatch_authorities",
      "serverless_dispatch_outbox",
      "serverless_cost_ledgers",
      "serverless_cost_events",
    ]) {
      const rows = await executor.query(`SELECT count(*)::int AS total FROM ${table}`);
      assert.equal(rows.rows[0].total, 0, `${table} must not retain a rolled-back predispatch`);
    }
  });
});

test("fake run, status, and cancel bind exactly one provider job before any output is accepted", async () => {
  await seeded(async ({ executor, admission, service }) => {
    const requestId = await admitVideo(admission, actorA(), 800_003, IDS.projectA, IDS.revisionA);
    const commit = await service.commitPredispatch(
      scopeA(),
      predispatchInput(810_003, scopeA(), {
        projectId: IDS.projectA,
        revisionId: IDS.revisionA,
        requestId,
      }),
    );
    const transport = endpoint();
    const outcome = await dispatch(service, scopeA(), commit, transport, 820_003);
    assert.equal(outcome.kind, "ASSIGNED");
    assert.equal(transport.acceptedJobCount(), 1);

    const assignment = await service.currentAssignment(commit.attemptId);
    assert.equal(assignment.provider_job_id, outcome.providerJobId);
    assert.equal(transport.status(outcome.providerJobId).status, "IN_QUEUE");

    transport.execute(outcome.providerJobId, (execution, workerId) =>
      receiptFor(
        { ...commit, outputPrefix: `tenant/${IDS.accountA}` },
        {
          providerJobId: outcome.providerJobId,
          workerId,
          nonce: execution,
        },
      ),
    );
    assert.equal(transport.status(outcome.providerJobId).status, "COMPLETED");

    await service.recordPolledStatus(scopeA(), {
      eventId: uuid(830_003),
      attemptId: commit.attemptId,
      providerStatus: "COMPLETED",
      attemptState: "UPLOADING",
      itemsCompleted: 3,
      observedAt: t(120),
    });

    const [receipt] = transport.provenanceReceiptsFor(commit.dispatchToken);
    const acceptance = await service.acceptOutput(scopeA(), {
      outputReceiptId: uuid(840_003),
      provenanceRowId: uuid(841_003),
      attemptId: commit.attemptId,
      receipt,
      artifactCommitReceiptSha256: sha256("commit-receipt"),
      artifacts: [
        {
          item_id: "scene-1",
          object_key: `${commit.attemptId}`,
          checksum_sha256: sha256("scene-1"),
        },
      ],
      now: t(130),
    });
    assert.equal(acceptance, "ACCEPTED_CANONICAL");

    const attempt = await service.attempt(commit.attemptId);
    assert.equal(attempt.state, "SUCCEEDED");

    const stored = await executor.query(
      `SELECT acceptance, durable_truth_source FROM serverless_output_receipts
        WHERE attempt_id = $1`,
      [commit.attemptId],
    );
    assert.equal(stored.rows[0].acceptance, "ACCEPTED_CANONICAL");
    assert.equal(stored.rows[0].durable_truth_source, "SIGNED_PRIVATE_R2_RECEIPT");

    // Progress observations record polled status as authoritative and nothing else.
    const progress = await executor.query(
      `SELECT advisory_source, authoritative FROM serverless_progress_events WHERE attempt_id = $1`,
      [commit.attemptId],
    );
    assert.deepEqual(progress.rows, [{ advisory_source: "POLL_STATUS", authoritative: true }]);
  });
});

// ---------------------------------------------------------------------------------------------
// Response loss before and after provider acceptance
// ---------------------------------------------------------------------------------------------

test("a response lost before provider acceptance never resubmits blindly and stops when unprovable", async () => {
  await seeded(async ({ executor, admission, service }) => {
    const requestId = await admitVideo(admission, actorA(), 800_004, IDS.projectA, IDS.revisionA);
    const commit = await service.commitPredispatch(
      scopeA(),
      predispatchInput(810_004, scopeA(), {
        projectId: IDS.projectA,
        revisionId: IDS.revisionA,
        requestId,
      }),
    );
    const transport = endpoint();
    transport.injectFault("RUN_RESPONSE_LOST_BEFORE_ACCEPT");
    const outcome = await dispatch(service, scopeA(), commit, transport, 820_004);
    assert.equal(outcome.kind, "DISPATCH_ACK_UNKNOWN");
    assert.equal(transport.acceptedJobCount(), 0);

    // The same outbox row can never be leased and sent a second time.
    await assert.rejects(
      dispatch(service, scopeA(), commit, transport, 821_004),
      (error) => error instanceof ServerlessDispatchError && error.code === "OUTBOX_NOT_SENDABLE",
    );
    assert.equal(transport.acceptedJobCount(), 0);

    const outcomeAtDeadline = await service.reconcile(scopeA(), {
      reconciliationId: uuid(850_004),
      attemptId: commit.attemptId,
      assignmentId: uuid(851_004),
      outboxId: commit.outboxId,
      trigger: "DISPATCH_ACK_UNKNOWN",
      durableReceipts: [],
      statusPolls: 6,
      possibleDuplicateComputeUsd: 0.03,
      now: t(2000),
    });
    assert.equal(outcomeAtDeadline, "AMBIGUOUS_STOP");

    const attempt = await service.attempt(commit.attemptId);
    assert.equal(attempt.state, "PERMANENT_FAILED");
    assert.equal(Number(attempt.possible_duplicate_cost_usd), 0.03);

    const reconciliation = await executor.query(
      `SELECT outcome, new_dispatch_permitted, queue_purge_used
         FROM serverless_reconciliations WHERE attempt_id = $1`,
      [commit.attemptId],
    );
    assert.equal(reconciliation.rows[0].outcome, "AMBIGUOUS_STOP");
    assert.equal(reconciliation.rows[0].new_dispatch_permitted, false);
    assert.equal(reconciliation.rows[0].queue_purge_used, false);

    const ledger = await executor.query(
      `SELECT possible_duplicate_usd FROM serverless_cost_ledgers WHERE attempt_id = $1`,
      [commit.attemptId],
    );
    assert.equal(Number(ledger.rows[0].possible_duplicate_usd), 0.03);
  });
});

test("a response lost after provider acceptance reconciles to one unique assignment from the durable receipt", async () => {
  await seeded(async ({ executor, admission, service }) => {
    const requestId = await admitVideo(admission, actorA(), 800_005, IDS.projectA, IDS.revisionA);
    const commit = await service.commitPredispatch(
      scopeA(),
      predispatchInput(810_005, scopeA(), {
        projectId: IDS.projectA,
        revisionId: IDS.revisionA,
        requestId,
      }),
    );
    const transport = endpoint();
    transport.injectFault("RUN_RESPONSE_LOST_AFTER_ACCEPT");
    const outcome = await dispatch(service, scopeA(), commit, transport, 820_005);
    assert.equal(outcome.kind, "DISPATCH_ACK_UNKNOWN");
    // The provider did create the job, so a lost response is never proof that no job exists.
    assert.equal(transport.acceptedJobCount(), 1);
    assert.equal(await service.currentAssignment(commit.attemptId), null);

    transport.execute("mage-0001", (execution, workerId) =>
      receiptFor(commit, { providerJobId: "mage-0001", workerId, nonce: execution }),
    );

    const reconciled = await service.reconcile(scopeA(), {
      reconciliationId: uuid(850_005),
      attemptId: commit.attemptId,
      assignmentId: uuid(851_005),
      outboxId: commit.outboxId,
      trigger: "DISPATCH_ACK_UNKNOWN",
      durableReceipts: transport.provenanceReceiptsForTokenHash(commit.dispatchTokenSha256),
      statusPolls: 3,
      possibleDuplicateComputeUsd: 0,
      now: t(300),
    });
    assert.equal(reconciled, "UNIQUE_ASSIGNMENT_PROVED");

    const assignment = await service.currentAssignment(commit.attemptId);
    assert.equal(assignment.provider_job_id, "mage-0001");
    const source = await executor.query(
      `SELECT assignment_source, worker_id FROM serverless_provider_assignments WHERE id = $1`,
      [assignment.id],
    );
    assert.equal(source.rows[0].assignment_source, "BOUNDED_RECONCILIATION");
    assert.equal(source.rows[0].worker_id, "worker-mage-0001-1");
  });
});

// ---------------------------------------------------------------------------------------------
// Duplicate execution, duplicate delivery, and duplicate output
// ---------------------------------------------------------------------------------------------

test("duplicate provider execution yields at most one accepted output and visible duplicate cost", async () => {
  await seeded(async ({ executor, admission, service }) => {
    const requestId = await admitVideo(admission, actorA(), 800_006, IDS.projectA, IDS.revisionA);
    const commit = await service.commitPredispatch(
      scopeA(),
      predispatchInput(810_006, scopeA(), {
        projectId: IDS.projectA,
        revisionId: IDS.revisionA,
        requestId,
      }),
    );
    const transport = endpoint();
    transport.injectFault("DUPLICATE_EXECUTION");
    const outcome = await dispatch(service, scopeA(), commit, transport, 820_006);
    transport.execute(outcome.providerJobId, (execution, workerId) =>
      receiptFor(commit, { providerJobId: outcome.providerJobId, workerId, nonce: execution }),
    );

    const receipts = transport.provenanceReceiptsFor(commit.dispatchToken);
    assert.equal(receipts.length, 2, "the provider ran the accepted job twice");
    assert.equal(transport.status(outcome.providerJobId).executionCount, 2);

    const first = await service.acceptOutput(scopeA(), {
      outputReceiptId: uuid(840_006),
      provenanceRowId: uuid(841_006),
      attemptId: commit.attemptId,
      receipt: receipts[0],
      artifactCommitReceiptSha256: sha256("commit-receipt"),
      artifacts: [],
      now: t(130),
    });
    const second = await service.acceptOutput(scopeA(), {
      outputReceiptId: uuid(842_006),
      provenanceRowId: uuid(843_006),
      attemptId: commit.attemptId,
      receipt: receipts[1],
      artifactCommitReceiptSha256: sha256("commit-receipt"),
      artifacts: [],
      now: t(140),
    });
    assert.equal(first, "ACCEPTED_CANONICAL");
    assert.equal(second, "QUARANTINED_DUPLICATE");

    const accepted = await executor.query(
      `SELECT count(*)::int AS total FROM serverless_output_receipts
        WHERE attempt_id = $1 AND acceptance = 'ACCEPTED_CANONICAL'`,
      [commit.attemptId],
    );
    assert.equal(accepted.rows[0].total, 1);

    // Duplicate compute is real and stays visible; nothing claims exactly-once billing.
    await service.recordCost(scopeA(), {
      costEventId: uuid(844_006),
      attemptId: commit.attemptId,
      kind: "POSSIBLE_DUPLICATE",
      amountUsd: 0.019,
      rateSource: RATE_SOURCE,
      rateCheckedAt: FIXED_TIME,
      now: t(150),
    });
    const ledger = await executor.query(
      `SELECT possible_duplicate_usd FROM serverless_cost_ledgers WHERE attempt_id = $1`,
      [commit.attemptId],
    );
    assert.equal(Number(ledger.rows[0].possible_duplicate_usd), 0.019);
  });
});

test("replaying an identical delivery is idempotent and never promotes a second canonical output", async () => {
  await seeded(async ({ executor, admission, service }) => {
    const requestId = await admitVideo(admission, actorA(), 800_007, IDS.projectA, IDS.revisionA);
    const commit = await service.commitPredispatch(
      scopeA(),
      predispatchInput(810_007, scopeA(), {
        projectId: IDS.projectA,
        revisionId: IDS.revisionA,
        requestId,
      }),
    );
    const transport = endpoint();
    const outcome = await dispatch(service, scopeA(), commit, transport, 820_007);
    transport.execute(outcome.providerJobId, (execution, workerId) =>
      receiptFor(commit, { providerJobId: outcome.providerJobId, workerId, nonce: execution }),
    );
    const [receipt] = transport.provenanceReceiptsFor(commit.dispatchToken);

    assert.equal(
      await service.acceptOutput(scopeA(), {
        outputReceiptId: uuid(840_007),
        provenanceRowId: uuid(841_007),
        attemptId: commit.attemptId,
        receipt,
        artifactCommitReceiptSha256: sha256("commit-receipt"),
        artifacts: [],
        now: t(130),
      }),
      "ACCEPTED_CANONICAL",
    );
    assert.equal(
      await service.acceptOutput(scopeA(), {
        outputReceiptId: uuid(842_007),
        provenanceRowId: uuid(843_007),
        attemptId: commit.attemptId,
        receipt,
        artifactCommitReceiptSha256: sha256("commit-receipt"),
        artifacts: [],
        now: t(140),
      }),
      "QUARANTINED_DUPLICATE",
    );

    const rows = await executor.query(
      `SELECT acceptance FROM serverless_output_receipts WHERE attempt_id = $1 ORDER BY accepted_at`,
      [commit.attemptId],
    );
    assert.deepEqual(
      rows.rows.map((row) => row.acceptance),
      ["ACCEPTED_CANONICAL", "QUARANTINED_DUPLICATE"],
    );
  });
});

// ---------------------------------------------------------------------------------------------
// Webhook loss, replay, forgery, and staleness
// ---------------------------------------------------------------------------------------------

test("webhook loss changes nothing and a replayed or forged callback never becomes truth", async () => {
  await seeded(async ({ executor, admission, service }) => {
    const requestId = await admitVideo(admission, actorA(), 800_008, IDS.projectA, IDS.revisionA);
    const commit = await service.commitPredispatch(
      scopeA(),
      predispatchInput(810_008, scopeA(), {
        projectId: IDS.projectA,
        revisionId: IDS.revisionA,
        requestId,
      }),
    );
    const transport = endpoint();
    const outcome = await dispatch(service, scopeA(), commit, transport, 820_008);
    transport.execute(outcome.providerJobId, (execution, workerId) =>
      receiptFor(commit, { providerJobId: outcome.providerJobId, workerId, nonce: execution }),
    );

    const deliveries = transport.drainWebhooks();
    assert.equal(deliveries.length, 1);

    // Losing every webhook leaves the polled path fully able to finish the attempt.
    await service.recordPolledStatus(scopeA(), {
      eventId: uuid(830_008),
      attemptId: commit.attemptId,
      providerStatus: "COMPLETED",
      attemptState: "UPLOADING",
      itemsCompleted: 3,
      observedAt: t(120),
    });
    const [receipt] = transport.provenanceReceiptsFor(commit.dispatchToken);
    assert.equal(
      await service.acceptOutput(scopeA(), {
        outputReceiptId: uuid(840_008),
        provenanceRowId: uuid(841_008),
        attemptId: commit.attemptId,
        receipt,
        artifactCommitReceiptSha256: sha256("commit-receipt"),
        artifacts: [],
        now: t(130),
      }),
      "ACCEPTED_CANONICAL",
    );

    // A forged callback token is rejected before it can touch attempt state.
    await assert.rejects(
      service.ingestWebhook(scopeA(), {
        eventId: uuid(831_008),
        attemptId: commit.attemptId,
        delivery: { ...deliveries[0], callbackTokenSha256: sha256("forged-callback-token") },
        expectedCallbackTokenSha256: CALLBACK_TOKEN_SHA256,
        attemptState: "SUCCEEDED",
        itemsCompleted: 3,
        observedAt: t(140),
      }),
      (error) =>
        error instanceof ServerlessDispatchError && error.code === "CALLBACK_UNAUTHENTICATED",
    );

    // A callback naming a job that is not the current assignment cannot claim authority.
    await assert.rejects(
      service.ingestWebhook(scopeA(), {
        eventId: uuid(832_008),
        attemptId: commit.attemptId,
        delivery: { ...deliveries[0], providerJobId: "mage-9999" },
        expectedCallbackTokenSha256: CALLBACK_TOKEN_SHA256,
        attemptState: "SUCCEEDED",
        itemsCompleted: 3,
        observedAt: t(150),
      }),
      (error) => error instanceof ServerlessDispatchError && error.code === "ASSIGNMENT_CONFLICT",
    );

    // A valid webhook replay is recorded twice as advisory only and never rewrites the attempt.
    for (const [index, at] of [
      [0, t(160)],
      [1, t(170)],
    ]) {
      await service.ingestWebhook(scopeA(), {
        eventId: uuid(833_008 + index),
        attemptId: commit.attemptId,
        delivery: deliveries[0],
        expectedCallbackTokenSha256: CALLBACK_TOKEN_SHA256,
        attemptState: "SUCCEEDED",
        itemsCompleted: 3,
        observedAt: at,
      });
    }
    const advisory = await executor.query(
      `SELECT count(*)::int AS total FROM serverless_progress_events
        WHERE attempt_id = $1 AND advisory_source = 'WEBHOOK' AND authoritative = false`,
      [commit.attemptId],
    );
    assert.equal(advisory.rows[0].total, 2);
    assert.equal((await service.attempt(commit.attemptId)).state, "SUCCEEDED");
  });
});

test("the database refuses to record any authoritative webhook observation", async () => {
  await seeded(async ({ executor, admission, service }) => {
    const requestId = await admitVideo(admission, actorA(), 800_009, IDS.projectA, IDS.revisionA);
    const commit = await service.commitPredispatch(
      scopeA(),
      predispatchInput(810_009, scopeA(), {
        projectId: IDS.projectA,
        revisionId: IDS.revisionA,
        requestId,
      }),
    );
    const transport = endpoint();
    const outcome = await dispatch(service, scopeA(), commit, transport, 820_009);
    const assignment = await service.currentAssignment(commit.attemptId);
    await expectDatabaseError(
      executor.query(
        `INSERT INTO serverless_progress_events (
           id, account_id, workspace_id, project_revision_id, attempt_id, assignment_id, sequence,
           advisory_source, authoritative, provider_status, attempt_state, items_completed,
           items_total, observed_at
         ) VALUES ($1, $2, $3, $4, $5, $6, 99, 'WEBHOOK', true, 'COMPLETED', 'SUCCEEDED', 3, 3, $7)`,
        [
          uuid(834_009),
          IDS.accountA,
          IDS.workspaceA,
          IDS.revisionA,
          commit.attemptId,
          assignment.id,
          t(200),
        ],
      ),
      ["23514"],
    );
    assert.equal(outcome.kind, "ASSIGNED");
  });
});

// ---------------------------------------------------------------------------------------------
// Worker death, timeout, and TTL
// ---------------------------------------------------------------------------------------------

for (const [fault, providerStatus, label] of [
  ["WORKER_DEATH", "FAILED", "worker death"],
  ["EXECUTION_TIMEOUT", "TIMED_OUT", "execution timeout"],
  ["TTL_EXPIRY", "TIMED_OUT", "TTL expiry covering queue and execution"],
]) {
  test(`${label} produces no accepted output and leaves billed compute visible`, async () => {
    await seeded(async ({ executor, admission, service }) => {
      const serial = 800_010 + fault.length;
      const requestId = await admitVideo(admission, actorA(), serial, IDS.projectA, IDS.revisionA);
      const commit = await service.commitPredispatch(
        scopeA(),
        predispatchInput(serial + 10_000, scopeA(), {
          projectId: IDS.projectA,
          revisionId: IDS.revisionA,
          requestId,
        }),
      );
      const transport = endpoint();
      transport.injectFault(fault);
      const outcome = await dispatch(service, scopeA(), commit, transport, serial + 20_000);
      transport.execute(outcome.providerJobId, () => {
        throw new Error("a failed worker never signs a receipt");
      });

      assert.equal(transport.status(outcome.providerJobId).status, providerStatus);
      assert.equal(transport.provenanceReceiptsFor(commit.dispatchToken).length, 0);
      assert.ok(transport.totalBilledSeconds() > 0, "consumed provider time stays visible");

      await service.recordPolledStatus(scopeA(), {
        eventId: uuid(serial + 30_000),
        attemptId: commit.attemptId,
        providerStatus,
        attemptState: "RETRYABLE_FAILED",
        itemsCompleted: 0,
        observedAt: t(400),
      });
      const accepted = await executor.query(
        `SELECT count(*)::int AS total FROM serverless_output_receipts
          WHERE attempt_id = $1 AND acceptance = 'ACCEPTED_CANONICAL'`,
        [commit.attemptId],
      );
      assert.equal(accepted.rows[0].total, 0);
      assert.equal((await service.attempt(commit.attemptId)).state, "RETRYABLE_FAILED");
    });
  });
}

// ---------------------------------------------------------------------------------------------
// Cancellation and races
// ---------------------------------------------------------------------------------------------

test("cancellation targets the exact owned job, promises no refund, and loses a race to acceptance", async () => {
  await seeded(async ({ executor, admission, service }) => {
    const requestId = await admitVideo(admission, actorA(), 800_011, IDS.projectA, IDS.revisionA);
    const commit = await service.commitPredispatch(
      scopeA(),
      predispatchInput(810_011, scopeA(), {
        projectId: IDS.projectA,
        revisionId: IDS.revisionA,
        requestId,
      }),
    );
    const transport = endpoint();
    const outcome = await dispatch(service, scopeA(), commit, transport, 820_011);
    const result = await service.cancel(scopeA(), {
      cancellationId: uuid(860_011),
      attemptId: commit.attemptId,
      requestedBy: "OWNER_ACCOUNT",
      endpoint: transport,
      settledCostUsd: 0.004,
      now: t(90),
    });
    assert.equal(result.providerTerminalState, "CANCELLED");

    const record = await executor.query(
      `SELECT target_scope, refund_promised, possible_unrefunded_cost_usd, provider_cancel_called
         FROM serverless_cancellations WHERE attempt_id = $1`,
      [commit.attemptId],
    );
    assert.equal(record.rows[0].target_scope, "EXACT_OWNED_PROVIDER_JOB_ID");
    assert.equal(record.rows[0].refund_promised, false);
    assert.equal(record.rows[0].provider_cancel_called, true);
    assert.equal(Number(record.rows[0].possible_unrefunded_cost_usd), 0.004);
    assert.equal((await service.attempt(commit.attemptId)).state, "CANCELLED");

    // A late receipt racing the cancellation cannot resurrect the attempt.
    transport.execute(outcome.providerJobId, (execution, workerId) =>
      receiptFor(commit, { providerJobId: outcome.providerJobId, workerId, nonce: execution }),
    );
    assert.equal(transport.provenanceReceiptsFor(commit.dispatchToken).length, 0);

    // Re-issuing the same cancellation is idempotent.
    await service.cancel(scopeA(), {
      cancellationId: uuid(861_011),
      attemptId: commit.attemptId,
      requestedBy: "OWNER_ACCOUNT",
      endpoint: transport,
      settledCostUsd: 0.004,
      now: t(95),
    });
    const total = await executor.query(
      `SELECT count(*)::int AS total FROM serverless_cancellations WHERE attempt_id = $1`,
      [commit.attemptId],
    );
    assert.equal(total.rows[0].total, 1);
  });
});

// ---------------------------------------------------------------------------------------------
// Restart, accepted-unit resume, and cost conservation
// ---------------------------------------------------------------------------------------------

test("restart reconstruction resumes in-flight transport without inventing provider facts", async () => {
  await seeded(async ({ admission, service }) => {
    const requestId = await admitVideo(admission, actorA(), 800_012, IDS.projectA, IDS.revisionA);
    const commit = await service.commitPredispatch(
      scopeA(),
      predispatchInput(810_012, scopeA(), {
        projectId: IDS.projectA,
        revisionId: IDS.revisionA,
        requestId,
      }),
    );
    const transport = endpoint();
    const outcome = await dispatch(service, scopeA(), commit, transport, 820_012);

    const reconstructed = await service.reconstructAfterRestart();
    assert.deepEqual(reconstructed, [
      { attemptId: commit.attemptId, state: "ASSIGNED", outboxState: "ASSIGNED" },
    ]);

    transport.execute(outcome.providerJobId, (execution, workerId) =>
      receiptFor(commit, { providerJobId: outcome.providerJobId, workerId, nonce: execution }),
    );
    const [receipt] = transport.provenanceReceiptsFor(commit.dispatchToken);
    assert.equal(
      await service.acceptOutput(scopeA(), {
        outputReceiptId: uuid(840_012),
        provenanceRowId: uuid(841_012),
        attemptId: commit.attemptId,
        receipt,
        artifactCommitReceiptSha256: sha256("commit-receipt"),
        artifacts: [],
        now: t(200),
      }),
      "ACCEPTED_CANONICAL",
    );
    assert.deepEqual(await service.reconstructAfterRestart(), []);
  });
});

test("a replacement attempt needs a new token and can only start after the prior attempt is terminal", async () => {
  await seeded(async ({ admission, service }) => {
    const requestId = await admitVideo(admission, actorA(), 800_013, IDS.projectA, IDS.revisionA);
    const first = await service.commitPredispatch(
      scopeA(),
      predispatchInput(810_013, scopeA(), {
        projectId: IDS.projectA,
        revisionId: IDS.revisionA,
        requestId,
      }),
    );

    // A second live attempt on the same video and lane is impossible while the first is open.
    await expectDatabaseError(
      service.commitPredispatch(scopeA(), {
        ...predispatchInput(812_013, scopeA(), {
          projectId: IDS.projectA,
          revisionId: IDS.revisionA,
          requestId,
        }),
        attemptOrdinal: 2,
      }),
      ["23505"],
    );

    const transport = endpoint();
    await service.cancel(scopeA(), {
      cancellationId: uuid(860_013),
      attemptId: first.attemptId,
      requestedBy: "SYSTEM_DEADLINE",
      endpoint: transport,
      settledCostUsd: 0,
      now: t(90),
    });

    const replacement = await service.commitPredispatch(scopeA(), {
      ...predispatchInput(814_013, scopeA(), {
        projectId: IDS.projectA,
        revisionId: IDS.revisionA,
        requestId,
      }),
      attemptOrdinal: 2,
    });
    assert.notEqual(replacement.dispatchToken, first.dispatchToken);
    assert.notEqual(replacement.dispatchTokenSha256, first.dispatchTokenSha256);
  });
});

test("accepted-unit resume carries only unresolved items and never regenerates accepted units", () => {
  const resumed = buildAcceptedUnitResumeBatch([
    {
      itemId: "scene-accepted",
      inputSha256: sha256("accepted-input"),
      outputObjectKey: `tenant/${IDS.accountA}/scene-accepted`,
      state: "ACCEPTED",
    },
    {
      itemId: "scene-failed",
      inputSha256: sha256("failed-input"),
      outputObjectKey: `tenant/${IDS.accountA}/scene-failed`,
      state: "FAILED",
    },
    {
      itemId: "scene-pending",
      inputSha256: sha256("pending-input"),
      outputObjectKey: `tenant/${IDS.accountA}/scene-pending`,
      state: "PENDING",
    },
  ]);
  assert.deepEqual(
    resumed.map((item) => [item.itemId, item.state]),
    [
      ["scene-failed", "CARRIED_FORWARD"],
      ["scene-pending", "CARRIED_FORWARD"],
    ],
  );
  assert.throws(
    () =>
      buildAcceptedUnitResumeBatch([
        {
          itemId: "scene-accepted",
          inputSha256: sha256("accepted-input"),
          outputObjectKey: `tenant/${IDS.accountA}/scene-accepted`,
          state: "ACCEPTED",
        },
      ]),
    (error) => error instanceof ServerlessBatchError && error.code === "BATCH_EMPTY_REPLACEMENT",
  );
});

test("cost stays conserved: the ledger tracks reservation, settlement, and duplicate exposure separately", async () => {
  await seeded(async ({ executor, admission, service }) => {
    const requestId = await admitVideo(admission, actorA(), 800_014, IDS.projectA, IDS.revisionA);
    const commit = await service.commitPredispatch(
      scopeA(),
      predispatchInput(810_014, scopeA(), {
        projectId: IDS.projectA,
        revisionId: IDS.revisionA,
        requestId,
      }),
    );
    await service.recordCost(scopeA(), {
      costEventId: uuid(870_014),
      attemptId: commit.attemptId,
      kind: "PROVIDER_REPORT",
      amountUsd: 0.21,
      rateSource: RATE_SOURCE,
      rateCheckedAt: FIXED_TIME,
      now: t(120),
    });
    await service.recordCost(scopeA(), {
      costEventId: uuid(871_014),
      attemptId: commit.attemptId,
      kind: "SETTLED",
      amountUsd: 0.21,
      rateSource: RATE_SOURCE,
      rateCheckedAt: FIXED_TIME,
      now: t(130),
    });

    const ledger = await executor.query(
      `SELECT ceiling_usd, reserved_usd, reported_usd, settled_usd, possible_duplicate_usd
         FROM serverless_cost_ledgers WHERE attempt_id = $1`,
      [commit.attemptId],
    );
    const row = ledger.rows[0];
    assert.equal(Number(row.ceiling_usd), 0.5);
    assert.equal(Number(row.reserved_usd), 0.4);
    assert.equal(Number(row.reported_usd), 0.21);
    assert.equal(Number(row.settled_usd), 0.21);
    assert.equal(Number(row.possible_duplicate_usd), 0);
    assert.ok(Number(row.settled_usd) <= Number(row.ceiling_usd));

    const events = await executor.query(
      `SELECT sequence, kind, confidence FROM serverless_cost_events
        WHERE attempt_id = $1 ORDER BY sequence`,
      [commit.attemptId],
    );
    assert.deepEqual(
      events.rows.map((event) => [Number(event.sequence), event.kind, event.confidence]),
      [
        [1, "RESERVATION", "ESTIMATED"],
        [2, "PROVIDER_REPORT", "PROVIDER_REPORTED"],
        [3, "SETTLED", "MEASURED"],
      ],
    );

    // A cost event can never rewind the ledger sequence.
    await expectDatabaseError(
      executor.query(
        `INSERT INTO serverless_cost_events (
           id, account_id, workspace_id, project_revision_id, attempt_id, ledger_id, sequence,
           kind, amount_usd, rate_source, rate_checked_at, confidence, recorded_at
         ) SELECT $1, account_id, workspace_id, project_revision_id, attempt_id, ledger_id, 2,
                  'SETTLED', 0.01, $2, $3, 'MEASURED', $3
              FROM serverless_cost_events WHERE attempt_id = $4 LIMIT 1`,
        [uuid(872_014), RATE_SOURCE, t(140), commit.attemptId],
      ),
      ["23505", "23514"],
    );
  });
});

// ---------------------------------------------------------------------------------------------
// Tenant, endpoint, volume, and GPU mismatches
// ---------------------------------------------------------------------------------------------

test("foreign tenants, wrong endpoints, mutated volumes, and unqualified GPUs all fail closed", async () => {
  await seeded(async ({ admission, service }) => {
    const requestId = await admitVideo(admission, actorA(), 800_015, IDS.projectA, IDS.revisionA);
    await admitVideo(admission, actorB(), 800_016, IDS.projectB, IDS.revisionB);
    const commit = await service.commitPredispatch(
      scopeA(),
      predispatchInput(810_015, scopeA(), {
        projectId: IDS.projectA,
        revisionId: IDS.revisionA,
        requestId,
      }),
    );
    const transport = endpoint();
    const outcome = await dispatch(service, scopeA(), commit, transport, 820_015);

    // A different endpoint never accepts this lane's request.
    assert.throws(
      () =>
        transport.run({
          endpointIdSha256: sha256("soulx-endpoint-id"),
          dispatchToken: commit.dispatchToken,
          requestBodySha256: sha256("request"),
          envelope: {},
        }),
      (error) => error instanceof FakeTransportError && error.code === "PROVIDER_JOB_UNKNOWN",
    );

    const base = {
      attemptId: commit.attemptId,
      artifactCommitReceiptSha256: sha256("commit-receipt"),
      artifacts: [],
      now: t(200),
    };
    // A receipt signed for another tenant is quarantined as foreign.
    assert.equal(
      await service.acceptOutput(scopeA(), {
        ...base,
        outputReceiptId: uuid(880_015),
        provenanceRowId: uuid(881_015),
        receipt: receiptFor(commit, {
          providerJobId: outcome.providerJobId,
          tenant: { account_id: IDS.accountB, workspace_id: IDS.workspaceB },
        }),
      }),
      "QUARANTINED_FOREIGN",
    );
    // A receipt naming another dispatch token is foreign too.
    assert.equal(
      await service.acceptOutput(scopeA(), {
        ...base,
        outputReceiptId: uuid(882_015),
        provenanceRowId: uuid(883_015),
        receipt: receiptFor(commit, {
          providerJobId: outcome.providerJobId,
          dispatchToken: "dt-0000000000000000000000000000000000000000000000000000",
        }),
      }),
      "QUARANTINED_FOREIGN",
    );
    // A mutated sealed volume is never accepted.
    assert.equal(
      await service.acceptOutput(scopeA(), {
        ...base,
        outputReceiptId: uuid(884_015),
        provenanceRowId: uuid(885_015),
        receipt: receiptFor(commit, {
          providerJobId: outcome.providerJobId,
          manifestAfter: sha256("mutated-volume-manifest"),
          mutationDetected: true,
        }),
      }),
      "QUARANTINED_SUPERSEDED",
    );
    // An unqualified GPU class is never accepted.
    assert.equal(
      await service.acceptOutput(scopeA(), {
        ...base,
        outputReceiptId: uuid(886_015),
        provenanceRowId: uuid(887_015),
        receipt: receiptFor(commit, {
          providerJobId: outcome.providerJobId,
          gpuName: "NVIDIA GeForce RTX 5090",
        }),
      }),
      "QUARANTINED_SUPERSEDED",
    );
    // A receipt claiming provider hardware attestation is never accepted.
    assert.equal(
      await service.acceptOutput(scopeA(), {
        ...base,
        outputReceiptId: uuid(888_015),
        provenanceRowId: uuid(889_015),
        receipt: receiptFor(commit, {
          providerJobId: outcome.providerJobId,
          attestationScope: "RUNPOD_PROVIDER_HARDWARE_ATTESTATION",
        }),
      }),
      "QUARANTINED_SUPERSEDED",
    );

    // The owning account still has no canonical output, and the foreign account cannot see one.
    const attempt = await service.attempt(commit.attemptId);
    assert.notEqual(attempt.state, "SUCCEEDED");
    await assert.rejects(
      service.commitPredispatch(
        scopeB(),
        predispatchInput(890_015, scopeB(), {
          projectId: IDS.projectA,
          revisionId: IDS.revisionA,
          requestId,
        }),
      ),
    );
  });
});

// ---------------------------------------------------------------------------------------------
// Structural guarantees
// ---------------------------------------------------------------------------------------------

test("no ordinary transport surface can purge an endpoint queue", () => {
  const transport = endpoint();
  for (const name of ["purgeQueue", "purge_queue", "purge"]) {
    assert.equal(name in transport, false, `the transport must not expose ${name}`);
  }
  const surface = Object.getOwnPropertyNames(Object.getPrototypeOf(transport));
  assert.equal(
    surface.some((member) => member.toLowerCase().includes("purge")),
    false,
  );
  assert.deepEqual(
    surface.filter((member) => ["run", "status", "cancel"].includes(member)).sort(),
    ["cancel", "run", "status"],
  );
});

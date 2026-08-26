import {
  FakeServerlessEndpoint,
  PROVENANCE_ATTESTATION_SCOPE,
  ProvenanceReceiptSigner,
  mintDispatchToken,
  providerFreeV2Authority,
} from "../../dist/src/index.js";

import { FIXED_TIME, sha256, uuid } from "./pglite.mjs";

/**
 * Shared provider-free harness for the V2-05 runtime cutover proof.
 *
 * Nothing here reaches a provider: both lane endpoints are the fake in-process transports the
 * V2-04 contracts already prove, and every authority is the $0 provider-free checkpoint authority.
 */
export const RATE_SOURCE = "https://docs.runpod.io/serverless/pricing";
export const SIGNER = new ProvenanceReceiptSigner("worker-key-v2-05", Buffer.alloc(32, 5));

export const LANE_ENDPOINTS = Object.freeze({
  mage_image: Object.freeze({
    endpointIdSha256: sha256("v2-05-mage-endpoint-id"),
    callbackTokenSha256: sha256("v2-05-mage-callback-token"),
    jobIdPrefix: "mage",
  }),
  soulx_avatar: Object.freeze({
    endpointIdSha256: sha256("v2-05-soulx-endpoint-id"),
    callbackTokenSha256: sha256("v2-05-soulx-callback-token"),
    jobIdPrefix: "soulx",
  }),
});

export function at(seconds) {
  return new Date(Date.parse(FIXED_TIME) + seconds * 1_000).toISOString();
}

export function deploymentFor(lane, serial) {
  return Object.freeze({
    deploymentId: uuid(serial),
    lane,
    endpointProfileId: `${lane}-serverless-v1`,
    endpointIdSha256: LANE_ENDPOINTS[lane].endpointIdSha256,
    endpointConfigSha256: sha256(`${lane}-endpoint-config`),
    workerImageDigest: sha256(`${lane}-worker-image`),
    modelManifestSha256: sha256(`${lane}-model-manifest`),
    volumeIdSha256: sha256(`${lane}-volume-id`),
    volumeManifestSha256: sha256(`${lane}-volume-manifest`),
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
        "project-context/evidence/acceptance/VF-10-05/2026-08-16-provider-free-cutover/acceptance.json",
      provider_defaults_accepted: false,
    },
    deploymentVersion: 1,
    createdAt: FIXED_TIME,
  });
}

export function laneEndpoint(lane) {
  return new FakeServerlessEndpoint(LANE_ENDPOINTS[lane]);
}

export function laneObjectPrefix(scope, lane, projectId, revisionId, attemptId) {
  const laneSegment = lane === "mage_image" ? "mage-image" : "soulx-avatar";
  return `tenant/${scope.accountId}/workspace/${scope.workspaceId}/project/${projectId}/revision/${revisionId}/lane/${laneSegment}/job/${attemptId}`;
}

export function itemIdsFor(lane, count) {
  const stem = lane === "mage_image" ? "image" : "span";
  return Array.from({ length: count }, (_, index) => `${stem}-${String(index + 1)}`);
}

export function predispatchFor({
  serial,
  scope,
  lane,
  projectId,
  revisionId,
  requestId,
  itemIds,
  now = FIXED_TIME,
}) {
  const attemptId = uuid(serial);
  const itemsManifestSha256 = sha256(`${lane}-items-${itemIds.join("|")}`);
  const dispatchToken = mintDispatchToken();
  return {
    attemptId,
    itemsManifestSha256,
    itemIds,
    input: {
      dispatchToken,
      envelope: { schema: "serverless-worker-job-envelope/v3" },
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
      itemsManifestSha256,
      itemCount: itemIds.length,
      inputManifestSha256: sha256(`${lane}-inputs-${String(serial)}`),
      outputPrefix: laneObjectPrefix(scope, lane, projectId, revisionId, attemptId),
      maxInputBytes: 268_435_456,
      maxOutputBytes: 2_147_483_648,
      requestBody: { lane, items: itemIds.length, manifest: itemsManifestSha256 },
      spendCeilingUsd: 0.5,
      reservationUsd: 0.4,
      rateSource: RATE_SOURCE,
      rateCheckedAt: FIXED_TIME,
      now,
      checkpointAuthority: providerFreeV2Authority("V2-05"),
    },
  };
}

export function receiptFor({ commit, lane, deployment, scope, itemIds, options = {} }) {
  const body = {
    schema_version: "serverless-provenance-receipt/v1",
    receipt_id: options.receiptId ?? `provenance-${commit.attemptId}`,
    attestation_scope: PROVENANCE_ATTESTATION_SCOPE,
    dispatch_token: commit.dispatchToken,
    attempt_id: commit.attemptId,
    provider_job_id: options.providerJobId ?? null,
    worker_id: options.workerId ?? `worker-${lane}`,
    tenant: { account_id: scope.accountId, workspace_id: scope.workspaceId },
    lane,
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
      gpu_uuid_sha256: sha256(`gpu-uuid-${lane}`),
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
      warmup_output_sha256: sha256(`warmup-${lane}`),
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
    items: itemIds.map((itemId, index) => ({
      item_id: itemId,
      state: "SUCCEEDED",
      output_object_key: `${commit.outputPrefix}/artifact/${itemId}`,
      output_sha256: sha256(`${commit.attemptId}-${itemId}`),
      output_bytes: 512_345 + index,
      probe: { width: 1280, height: 720, unit: index + 1 },
    })),
    scratch_cleanup: {
      terminal_reason: "SUCCESS",
      removed: true,
      scratch_on_model_volume: false,
    },
    receipt_nonce: options.nonce ?? 1,
    issued_at: options.issuedAt ?? at(90),
  };
  return SIGNER.sign(body);
}

/**
 * Persists the tenant-private commit receipts the worker's upload produced. Canonical output
 * acceptance and every accepted runtime unit join against these exact rows.
 */
export async function persistCommitReceipts(executor, commit, receipt, serial) {
  const attempt = await executor.query(
    `SELECT account_id, workspace_id, project_id, project_revision_id, lane, output_prefix
       FROM serverless_attempts WHERE id = $1`,
    [commit.attemptId],
  );
  const bound = attempt.rows[0];
  await executor.query(`SELECT set_config('videoforge.account_id', $1, false)`, [bound.account_id]);
  const hashes = [];
  for (const [index, item] of receipt.items.entries()) {
    const reservationId = uuid(serial + index * 2);
    const receiptId = uuid(serial + index * 2 + 1);
    const receiptSha256 = sha256(`commit-${commit.attemptId}-${item.item_id}`);
    await executor.query(
      `INSERT INTO artifact_reservations (
         id, account_id, workspace_id, project_id, project_revision_id, lane, job_id, artifact_id,
         object_key, method, content_type, content_length, checksum_sha256, expires_at, max_uses,
         used_count, state, retention_class, deletion_owner_account_id, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PUT', 'image/png', $10, $11, $12, 1, 1,
                 'COMMITTED', 'PROJECT', $2, $13, $14)`,
      [
        reservationId,
        bound.account_id,
        bound.workspace_id,
        bound.project_id,
        bound.project_revision_id,
        bound.lane === "mage_image" ? "MAGE_IMAGE" : "SOULX_AVATAR",
        commit.attemptId,
        item.item_id,
        item.output_object_key,
        item.output_bytes,
        item.output_sha256,
        at(600),
        at(1),
        at(100),
      ],
    );
    await executor.query(
      `INSERT INTO artifact_receipts (
         id, account_id, workspace_id, reservation_id, callback_id, object_key, content_type,
         content_length, checksum_sha256, probe, receipt_sha256, committed_at
       ) VALUES ($1, $2, $3, $4, $5, $6, 'image/png', $7, $8, $9::jsonb, $10, $11)`,
      [
        receiptId,
        bound.account_id,
        bound.workspace_id,
        reservationId,
        `callback-${commit.attemptId}-${item.item_id}`,
        item.output_object_key,
        item.output_bytes,
        item.output_sha256,
        JSON.stringify(item.probe),
        receiptSha256,
        at(110),
      ],
    );
    hashes.push(receiptSha256);
  }
  return hashes;
}

export function acceptedUnitsFrom(receipt) {
  return receipt.items.map((item) => ({
    itemId: item.item_id,
    objectKey: item.output_object_key,
    checksumSha256: item.output_sha256,
    contentLength: item.output_bytes,
  }));
}

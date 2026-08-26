import {
  PROVENANCE_ATTESTATION_SCOPE,
  ProvenanceReceiptSigner,
  canonicalSha256,
  digestUtf8,
  type ProvenanceReceipt,
  type ProvenanceReceiptBody,
  type Sha256,
} from "@videoforge/control-plane";
import { describe, expect, it } from "vitest";

import {
  compareUtf8Bytes,
  createHostedServerlessOutputBarrier,
  type HostedLaneCompletionRecord,
  type HostedLaneCompletionRepository,
  type HostedPrivateArtifactBarrierPort,
  type HostedServerlessAttemptBinding,
} from "./hosted-serverless-output-barrier.js";

const signer = new ProvenanceReceiptSigner("ordinary-output-test", Buffer.alloc(32, 9));
const sha = (label: string): Sha256 => canonicalSha256({ label });
const dispatchToken = "ordinary-tenant-dispatch-token";
const observedAt = "2026-08-25T10:00:00.000Z";

function binding(): HostedServerlessAttemptBinding {
  const base = {
    accountId: "account-a",
    workspaceId: "workspace-a",
    projectId: "project-a",
    projectRevisionId: "revision-7",
    lane: "mage_image" as const,
    attemptId: "attempt-11",
    providerJobId: "provider-job-22",
    dispatchTokenSha256: digestUtf8(dispatchToken),
    envelopeSha256: sha("envelope"),
    requestSha256: sha("request"),
    deploymentId: "deployment-3",
    endpointIdSha256: sha("endpoint"),
    endpointConfigSha256: sha("endpoint-config"),
    workerImageDigest: sha("image"),
    modelManifestSha256: sha("model"),
    volumeIdSha256: sha("volume-id"),
    volumeManifestSha256: sha("volume-manifest"),
  };
  const prefix =
    "tenant/account-a/workspace/workspace-a/project/project-a/revision/revision-7/" +
    "lane/mage-image/job/attempt-11/artifact/";
  return Object.freeze({
    ...base,
    expectedObjects: Object.freeze([
      Object.freeze({
        itemId: "scene-1",
        objectKey: `${prefix}scene-1.png`,
        contentType: "image/png" as const,
        contentLength: 101,
        checksumSha256: sha("scene-1"),
      }),
      Object.freeze({
        itemId: "scene-2",
        objectKey: `${prefix}scene-2.png`,
        contentType: "image/png" as const,
        contentLength: 202,
        checksumSha256: sha("scene-2"),
      }),
    ]),
  });
}

function receiptFor(
  bound: HostedServerlessAttemptBinding,
  override: Partial<ProvenanceReceiptBody> = {},
): ProvenanceReceipt {
  const body: ProvenanceReceiptBody = {
    schema_version: "serverless-provenance-receipt/v1",
    receipt_id: "ordinary-receipt-1",
    attestation_scope: PROVENANCE_ATTESTATION_SCOPE,
    dispatch_token: dispatchToken,
    envelope_sha256: bound.envelopeSha256,
    request_sha256: bound.requestSha256,
    attempt_id: bound.attemptId,
    provider_job_id: bound.providerJobId,
    worker_id: "worker-1",
    tenant: { account_id: bound.accountId, workspace_id: bound.workspaceId },
    lane: bound.lane,
    deployment: {
      deployment_id: bound.deploymentId,
      endpoint_id_sha256: bound.endpointIdSha256,
      container_digest: bound.workerImageDigest,
      intended_region: "EU-RO-1",
      intended_volume_id_sha256: bound.volumeIdSha256,
      model_manifest_sha256: bound.modelManifestSha256,
    },
    runtime_probe: {
      gpu_name: "NVIDIA GeForce RTX 4090",
      gpu_count: 1,
      total_vram_bytes: 24 * 1024 ** 3,
      peak_vram_bytes: 12 * 1024 ** 3,
      gpu_uuid_sha256: sha("gpu"),
      driver_version: "550.90.07",
      cuda_version: "12.4",
      probe_source: "WORKER_RUNTIME_SELF_REPORT",
    },
    volume_verification: {
      manifest_sha256_before: bound.volumeManifestSha256,
      manifest_sha256_after: bound.volumeManifestSha256,
      mutation_detected: false,
      cross_mount_detected: false,
    },
    model_ready_evidence: {
      state: "MODEL_READY",
      warmup_completed: true,
      warmup_output_sha256: sha("warmup"),
    },
    timings: { total_ms: 42 },
    items: bound.expectedObjects.map((item) => ({
      item_id: item.itemId,
      state: "SUCCEEDED" as const,
      output_object_key: item.objectKey,
      output_sha256: item.checksumSha256,
      output_bytes: item.contentLength,
      probe: { private_readback_required: true },
    })),
    scratch_cleanup: {
      terminal_reason: "SUCCESS",
      removed: true,
      scratch_on_model_volume: false,
    },
    receipt_nonce: 1,
    issued_at: observedAt,
    ...override,
  };
  return signer.sign(body);
}

const commitHashes = Object.freeze([sha("commit-1"), sha("commit-2")]);

function callback(receipt: ProvenanceReceipt, overrides: Record<string, unknown> = {}) {
  return {
    schema_version: "videoforge-hosted-serverless-output-callback/v1",
    transport_status: "COMPLETED",
    provenance_receipt: receipt,
    artifact_commit_receipt_sha256s: commitHashes,
    observed_at: observedAt,
    ...overrides,
  };
}

class MemoryRepository implements HostedLaneCompletionRepository {
  readonly records = new Map<string, HostedLaneCompletionRecord>();
  completeCalls = 0;
  nonces = new Set<number>();

  async accepted(attemptId: string) {
    return this.records.get(attemptId) ?? null;
  }

  async seenReceiptNonces() {
    return this.nonces;
  }

  async completeVerified({ record }: { readonly record: HostedLaneCompletionRecord }) {
    this.completeCalls += 1;
    const existing = this.records.get(record.attemptId);
    if (existing) return { record: existing, inserted: false };
    this.records.set(record.attemptId, record);
    this.nonces.add(1);
    return { record, inserted: true };
  }
}

function exactArtifacts(bound: HostedServerlessAttemptBinding) {
  const calls: string[] = [];
  const port: HostedPrivateArtifactBarrierPort = {
    async readCommitted(receivedBinding, expected) {
      calls.push(expected.itemId);
      expect(receivedBinding).toBe(bound);
      const index = bound.expectedObjects.findIndex((item) => item.itemId === expected.itemId);
      return {
        ...expected,
        reservationState: "COMMITTED",
        artifactCommitReceiptSha256: commitHashes[index]!,
        readbackChecksumSha256: expected.checksumSha256,
        readbackContentLength: expected.contentLength,
        readbackContentType: expected.contentType,
      };
    },
  };
  return { port, calls };
}

function expectCode(promise: Promise<unknown>, code: string) {
  return expect(promise).rejects.toMatchObject({ code });
}

describe("ordinary hosted serverless output barrier", () => {
  it("uses bytewise UTF-8 ordering for mixed case, punctuation, and non-ASCII item ids", () => {
    expect(["a_", "é", "a-", "a", "A"].sort(compareUtf8Bytes)).toEqual(["A", "a", "a-", "a_", "é"]);
  });

  it("marks complete only after exact signed receipt and every private artifact readback", async () => {
    const bound = binding();
    const artifacts = exactArtifacts(bound);
    const repository = new MemoryRepository();
    const barrier = createHostedServerlessOutputBarrier({
      signer,
      artifacts: artifacts.port,
      repository,
    });

    await expect(barrier.accept(bound, callback(receiptFor(bound)))).resolves.toBe(
      "LANE_COMPLETED",
    );
    expect(artifacts.calls).toEqual(["scene-1", "scene-2"]);
    expect(repository.completeCalls).toBe(1);
    const completed = repository.records.get(bound.attemptId)!;
    expect(completed.artifactCommitReceiptSha256s).toEqual([...commitHashes].sort());
    expect(completed.bindingSha256).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it("accepts the exact duplicate idempotently without repeating private reads", async () => {
    const bound = binding();
    const artifacts = exactArtifacts(bound);
    const repository = new MemoryRepository();
    const barrier = createHostedServerlessOutputBarrier({
      signer,
      artifacts: artifacts.port,
      repository,
    });
    const value = callback(receiptFor(bound));

    await barrier.accept(bound, value);
    await expect(barrier.accept(bound, value)).resolves.toBe("DUPLICATE_IDEMPOTENT");
    expect(artifacts.calls).toHaveLength(2);
    expect(repository.completeCalls).toBe(1);
  });

  it("rejects a duplicate when immutable endpoint config lineage drifts", async () => {
    const bound = binding();
    const artifacts = exactArtifacts(bound);
    const repository = new MemoryRepository();
    const barrier = createHostedServerlessOutputBarrier({
      signer,
      artifacts: artifacts.port,
      repository,
    });
    const value = callback(receiptFor(bound));
    await barrier.accept(bound, value);

    await expectCode(
      barrier.accept({ ...bound, endpointConfigSha256: sha("drifted-config") }, value),
      "HOSTED_OUTPUT_IDEMPOTENCY_CONFLICT",
    );
    expect(repository.completeCalls).toBe(1);
  });

  it("fails closed for foreign tenant, job, and deployment lineage", async () => {
    const bound = binding();
    const repository = new MemoryRepository();
    const artifacts = exactArtifacts(bound);
    const barrier = createHostedServerlessOutputBarrier({
      signer,
      artifacts: artifacts.port,
      repository,
    });
    const cases: Array<[Partial<ProvenanceReceiptBody>, string]> = [
      [
        { tenant: { account_id: "foreign", workspace_id: bound.workspaceId } },
        "HOSTED_OUTPUT_FOREIGN",
      ],
      [{ provider_job_id: "foreign-job" }, "HOSTED_OUTPUT_FOREIGN"],
      [{ lane: "soulx_avatar" }, "HOSTED_OUTPUT_FOREIGN"],
      [
        {
          deployment: {
            ...receiptFor(bound).deployment,
            container_digest: sha("foreign-image"),
          },
        },
        "HOSTED_OUTPUT_RECEIPT_INVALID",
      ],
    ];

    for (const [override, code] of cases) {
      await expectCode(barrier.accept(bound, callback(receiptFor(bound, override))), code);
    }
    expect(artifacts.calls).toHaveLength(0);
    expect(repository.completeCalls).toBe(0);
  });

  it("rejects missing, extra, or mismatched expected objects", async () => {
    const bound = binding();
    const artifacts = exactArtifacts(bound);
    const repository = new MemoryRepository();
    const barrier = createHostedServerlessOutputBarrier({
      signer,
      artifacts: artifacts.port,
      repository,
    });
    const missing = receiptFor(bound, { items: receiptFor(bound).items.slice(0, 1) });
    const duplicated = receiptFor(bound, {
      items: [receiptFor(bound).items[0]!, receiptFor(bound).items[0]!],
    });

    await expectCode(barrier.accept(bound, callback(missing)), "HOSTED_OUTPUT_OBJECT_SET_MISMATCH");
    await expectCode(
      barrier.accept(bound, callback(duplicated)),
      "HOSTED_OUTPUT_OBJECT_SET_MISMATCH",
    );
    await expectCode(
      barrier.accept(
        bound,
        callback(receiptFor(bound), {
          artifact_commit_receipt_sha256s: [...commitHashes, sha("extra-commit")],
        }),
      ),
      "HOSTED_OUTPUT_OBJECT_SET_MISMATCH",
    );
    expect(repository.completeCalls).toBe(0);
  });

  it("rejects malformed and unknown transport callbacks before artifact access", async () => {
    const bound = binding();
    const artifacts = exactArtifacts(bound);
    const repository = new MemoryRepository();
    const barrier = createHostedServerlessOutputBarrier({
      signer,
      artifacts: artifacts.port,
      repository,
    });

    await expectCode(barrier.accept(bound, { no: "receipt" }), "HOSTED_OUTPUT_CALLBACK_MALFORMED");
    await expectCode(
      barrier.accept(bound, callback(receiptFor(bound), { transport_status: "UNKNOWN" })),
      "HOSTED_OUTPUT_TRANSPORT_NOT_COMPLETE",
    );
    await expectCode(
      barrier.accept(bound, callback({ malformed: true } as unknown as ProvenanceReceipt)),
      "HOSTED_OUTPUT_RECEIPT_INVALID",
    );
    expect(artifacts.calls).toHaveLength(0);
  });

  it("fails closed when a committed private artifact is missing or readback differs", async () => {
    const bound = binding();
    const repository = new MemoryRepository();
    const missing: HostedPrivateArtifactBarrierPort = {
      async readCommitted() {
        return null;
      },
    };
    const barrier = createHostedServerlessOutputBarrier({ signer, artifacts: missing, repository });

    await expectCode(
      barrier.accept(bound, callback(receiptFor(bound))),
      "HOSTED_OUTPUT_PRIVATE_READBACK_FAILED",
    );
    expect(repository.completeCalls).toBe(0);
  });

  it("rejects replayed signed receipt nonces without any qualification route state", async () => {
    const bound = binding();
    const artifacts = exactArtifacts(bound);
    const repository = new MemoryRepository();
    repository.nonces.add(1);
    const barrier = createHostedServerlessOutputBarrier({
      signer,
      artifacts: artifacts.port,
      repository,
    });

    await expectCode(
      barrier.accept(bound, callback(receiptFor(bound))),
      "HOSTED_OUTPUT_RECEIPT_INVALID",
    );
    expect(artifacts.calls).toHaveLength(0);
    expect(repository.completeCalls).toBe(0);
  });
});

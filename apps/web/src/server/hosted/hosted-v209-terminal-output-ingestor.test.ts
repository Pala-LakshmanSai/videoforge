// @vitest-environment node

import { createHash } from "node:crypto";

import { canonicalizeJson, type JsonValue } from "@videoforge/contracts";
import {
  PROVENANCE_ATTESTATION_SCOPE,
  ProvenanceReceiptSigner,
  canonicalSha256,
  digestUtf8,
  type ProvenanceReceiptBody,
  type Sha256,
  type SqlPrimitive,
  type SqlQueryResult,
  type TransactionalSqlExecutor,
} from "@videoforge/control-plane";
import { describe, expect, it, vi } from "vitest";

import type { HostedR2BucketBinding } from "./configuration";
import {
  createHostedServerlessOutputBarrier,
  type HostedLaneCompletionRecord,
} from "../runtime/hosted-serverless-output-barrier";
import {
  HostedV209TerminalOutputError,
  HostedSqlV209TerminalOutputStore,
  createHostedV209TerminalOutputIngestor,
  type HostedV209TerminalLineage,
  type HostedV209TerminalOutputStore,
} from "./hosted-v209-terminal-output-ingestor";

const ids = Object.freeze({
  account: "11111111-1111-4111-8111-111111111111",
  workspace: "22222222-2222-4222-8222-222222222222",
  project: "33333333-3333-4333-8333-333333333333",
  revision: "44444444-4444-4444-8444-444444444444",
  attempt: "55555555-5555-4555-8555-555555555555",
  deployment: "66666666-6666-4666-8666-666666666666",
  task: "77777777-7777-4777-8777-777777777777",
  reservation: "88888888-8888-4888-8888-888888888888",
});
const key = Buffer.alloc(32, 17);
const keyId = "hosted-v209-receipt-v1";
const artifactBytes = Buffer.from("png-data", "utf8");
const artifactSha = `sha256:${createHash("sha256").update(artifactBytes).digest("hex")}` as Sha256;
const sha = (label: string): Sha256 => canonicalSha256({ label });
const prefix =
  `tenant/${ids.account}/workspace/${ids.workspace}/project/${ids.project}` +
  `/revision/${ids.revision}/lane/mage-image/job/${ids.attempt}`;
const objectKey = `${prefix}/artifact/${ids.task}`;

function fixture(options: { foreignAccount?: boolean; badGet?: boolean } = {}) {
  const dispatchToken = "dispatch-token-0123456789abcdef0123456789abcdef";
  const requestBody = {
    envelope: { schema_version: "serverless-envelope/v3" },
    batch: { attempt_id: ids.attempt, items: [{ scene_id: ids.task }] },
    ports: { inputs: [], outputs: [] },
    input_get_urls: [],
    generated_output_authorities: [
      {
        reservation_id: ids.reservation,
        path: `/${objectKey}`,
        content_type: "image/png",
        max_uses: 1,
      },
    ],
    output_put_urls: ["redacted-worker-url"],
  };
  const workerRequestBody = Object.fromEntries(
    Object.entries(requestBody).filter(([key]) => key !== "envelope"),
  );
  const lineage: HostedV209TerminalLineage = Object.freeze({
    binding: Object.freeze({
      accountId: ids.account,
      workspaceId: ids.workspace,
      projectId: ids.project,
      projectRevisionId: ids.revision,
      lane: "mage_image",
      attemptId: ids.attempt,
      providerJobId: "provider-job-1",
      dispatchTokenSha256: digestUtf8(dispatchToken),
      envelopeSha256: sha("envelope"),
      requestSha256: canonicalSha256(workerRequestBody),
      deploymentId: ids.deployment,
      endpointIdSha256: sha("endpoint"),
      endpointConfigSha256: sha("endpoint-config"),
      workerImageDigest: sha("container"),
      modelManifestSha256: sha("model"),
      volumeIdSha256: sha("volume"),
      volumeManifestSha256: sha("manifest"),
    }),
    deadlineAt: "2026-09-06T12:00:00.000Z",
    requestBody,
    candidateWork: Object.freeze([
      Object.freeze({
        taskId: ids.task,
        outputReservationId: ids.reservation,
        outputPrefix: prefix,
      }),
    ]),
  });
  const probe = Object.freeze({ width: 1280, height: 720, format: "png" });
  const body: ProvenanceReceiptBody = {
    schema_version: "serverless-provenance-receipt/v1",
    receipt_id: `mage-${ids.attempt}`,
    attestation_scope: PROVENANCE_ATTESTATION_SCOPE,
    dispatch_token: dispatchToken,
    envelope_sha256: lineage.binding.envelopeSha256,
    request_sha256: lineage.binding.requestSha256,
    attempt_id: ids.attempt,
    provider_job_id: "provider-job-1",
    worker_id: "worker-1",
    tenant: {
      account_id: options.foreignAccount ? "99999999-9999-4999-8999-999999999999" : ids.account,
      workspace_id: ids.workspace,
    },
    lane: "mage_image",
    deployment: {
      deployment_id: ids.deployment,
      endpoint_id_sha256: lineage.binding.endpointIdSha256,
      container_digest: lineage.binding.workerImageDigest,
      intended_region: "EU-RO-1",
      intended_volume_id_sha256: lineage.binding.volumeIdSha256,
      model_manifest_sha256: lineage.binding.modelManifestSha256,
    },
    runtime_probe: {
      gpu_name: "NVIDIA GeForce RTX 4090",
      gpu_count: 1,
      total_vram_bytes: 24 * 1024 ** 3,
      peak_vram_bytes: 12 * 1024 ** 3,
      gpu_uuid_sha256: null,
      driver_version: "550.90.07",
      cuda_version: "12.4",
      probe_source: "WORKER_RUNTIME_SELF_REPORT",
    },
    volume_verification: {
      manifest_sha256_before: lineage.binding.volumeManifestSha256,
      manifest_sha256_after: lineage.binding.volumeManifestSha256,
      mutation_detected: false,
      cross_mount_detected: false,
    },
    model_ready_evidence: {
      state: "MODEL_READY",
      warmup_completed: true,
      warmup_output_sha256: sha("warmup"),
    },
    timings: {
      allocation_ms: 1,
      container_ready_ms: 2,
      volume_verified_ms: 3,
      model_load_ms: 4,
      warmup_ms: 5,
      first_inference_ms: 6,
      upload_ms: 7,
      total_ms: 28,
    },
    items: [
      {
        item_id: ids.task,
        state: "SUCCEEDED",
        output_object_key: objectKey,
        output_sha256: artifactSha,
        output_bytes: artifactBytes.byteLength,
        probe,
      },
    ],
    scratch_cleanup: { terminal_reason: "SUCCESS", removed: true, scratch_on_model_volume: false },
    receipt_nonce: 1,
    issued_at: "2026-09-06T10:00:00.000Z",
  };
  const receiptBytes = Buffer.from(canonicalizeJson(body as unknown as JsonValue), "utf8");
  const receipt = new ProvenanceReceiptSigner(keyId, key).signOverBytes(body, receiptBytes);
  const output = {
    status: "SUCCEEDED",
    items: [
      {
        item_id: ids.task,
        output_port_reservation_id: ids.reservation,
        output_object_key: objectKey,
        output_sha256: artifactSha,
        output_bytes: artifactBytes.byteLength,
        probe,
      },
    ],
    provenance_receipt: receipt,
    provenance_receipt_body_base64: receiptBytes.toString("base64"),
  };
  const commitHash = sha("artifact-commit");
  const commitArtifacts = vi.fn(async () => Object.freeze([commitHash]));
  const store: HostedV209TerminalOutputStore = {
    async load() {
      return lineage;
    },
    commitArtifacts,
  };
  const bytes = options.badGet ? Buffer.from("bad-data", "utf8") : artifactBytes;
  const bucket = {
    async head() {
      return {
        size: artifactBytes.byteLength,
        httpMetadata: { contentType: "image/png" },
        checksums: {}, // R2 need not expose a checksum header; GET bytes remain authoritative.
      };
    },
    async get() {
      return {
        size: artifactBytes.byteLength,
        httpMetadata: { contentType: "image/png" },
        async arrayBuffer() {
          return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        },
      };
    },
  } as unknown as HostedR2BucketBinding;
  return { lineage, output, store, bucket, commitHash, commitArtifacts };
}

function request(output: unknown) {
  return {
    accountId: ids.account,
    workspaceId: ids.workspace,
    attemptId: ids.attempt,
    lane: "mage_image" as const,
    providerJobId: "provider-job-1",
    output,
    observedAt: "2026-09-06T10:01:00.000Z",
  };
}

function ingestor(value: ReturnType<typeof fixture>) {
  const accepted = new Set<string>();
  const acceptBarrier = vi.fn(async (_binding, completed) => {
    const identity = `${completed.receipt.receipt_sha256}:${completed.artifactCommitReceiptSha256s.join(",")}`;
    if (accepted.has(identity)) return "DUPLICATE_IDEMPOTENT" as const;
    accepted.add(identity);
    return "LANE_COMPLETED" as const;
  });
  return {
    acceptBarrier,
    service: createHostedV209TerminalOutputIngestor({
      database: {} as TransactionalSqlExecutor,
      bucket: value.bucket,
      receiptKeyId: keyId,
      receiptKey: key,
      store: value.store,
      acceptBarrier,
    }),
  };
}

describe("hosted V2-09 terminal output ingestor", () => {
  it("accepts a checksum-header-free bounded GET and exposes idempotent replay", async () => {
    const value = fixture();
    const { service, acceptBarrier } = ingestor(value);
    await expect(service.acceptCompleted(request(value.output))).resolves.toMatchObject({
      state: "LANE_COMPLETED",
      acceptedItemCount: 1,
      artifactCommitReceiptSha256s: [value.commitHash],
    });
    await expect(service.acceptCompleted(request(value.output))).resolves.toMatchObject({
      state: "DUPLICATE_IDEMPOTENT",
      acceptedItemCount: 1,
    });
    expect(value.commitArtifacts).toHaveBeenCalledTimes(2);
    expect(acceptBarrier).toHaveBeenCalledTimes(2);
  });

  it("treats a repeated internal COMPLETED observation as replay despite a later poll time", async () => {
    const value = fixture();
    const receipt = value.output.provenance_receipt;
    let stored: HostedLaneCompletionRecord | null = null;
    const barrier = createHostedServerlessOutputBarrier({
      signer: new ProvenanceReceiptSigner(keyId, key),
      artifacts: {
        async readCommitted(_binding, expected) {
          return {
            ...expected,
            reservationState: "COMMITTED" as const,
            artifactCommitReceiptSha256: value.commitHash,
            readbackChecksumSha256: expected.checksumSha256,
            readbackContentLength: expected.contentLength,
            readbackContentType: expected.contentType,
          };
        },
      },
      repository: {
        async accepted() {
          return stored;
        },
        async seenReceiptNonces() {
          return new Set<number>();
        },
        async completeVerified(input) {
          stored ??= input.record;
          return { record: stored, inserted: stored === input.record };
        },
      },
    });
    const binding = {
      ...value.lineage.binding,
      expectedObjects: [
        {
          itemId: ids.task,
          objectKey,
          contentType: "image/png" as const,
          contentLength: artifactBytes.byteLength,
          checksumSha256: artifactSha,
        },
      ],
    };
    await expect(
      barrier.acceptCompleted(binding, {
        transportStatus: "COMPLETED",
        receipt,
        artifactCommitReceiptSha256s: [value.commitHash],
        observedAt: "2026-09-06T10:01:00.000Z",
      }),
    ).resolves.toBe("LANE_COMPLETED");
    await expect(
      barrier.acceptCompleted(binding, {
        transportStatus: "COMPLETED",
        receipt,
        artifactCommitReceiptSha256s: [value.commitHash],
        observedAt: "2026-09-06T10:02:00.000Z",
      }),
    ).resolves.toBe("DUPLICATE_IDEMPOTENT");
  });

  it("rejects tampered raw receipt bytes before artifact commit", async () => {
    const value = fixture();
    const tampered = structuredClone(value.output);
    tampered.provenance_receipt_body_base64 = Buffer.from("{}", "utf8").toString("base64");
    const { service } = ingestor(value);
    await expect(service.acceptCompleted(request(tampered))).rejects.toThrow();
    expect(value.commitArtifacts).not.toHaveBeenCalled();
  });

  it("rejects a validly signed foreign-tenant receipt", async () => {
    const value = fixture({ foreignAccount: true });
    const { service } = ingestor(value);
    await expect(service.acceptCompleted(request(value.output))).rejects.toThrow();
    expect(value.commitArtifacts).not.toHaveBeenCalled();
  });

  it("rejects bytes whose computed GET checksum does not match the receipt", async () => {
    const value = fixture({ badGet: true });
    const { service } = ingestor(value);
    await expect(service.acceptCompleted(request(value.output))).rejects.toBeInstanceOf(
      HostedV209TerminalOutputError,
    );
    expect(value.commitArtifacts).not.toHaveBeenCalled();
  });

  it("binds every artifact reservation SQL parameter without shifting tenant lineage", async () => {
    const value = fixture();
    let reservationParameters: readonly SqlPrimitive[] = [];
    let receiptParameters: readonly SqlPrimitive[] = [];
    const executor: TransactionalSqlExecutor = {
      async execute() {},
      async query<Row extends Record<string, unknown>>(
        sql: string,
        parameters: readonly SqlPrimitive[] = [],
      ): Promise<SqlQueryResult<Row>> {
        if (sql.includes("SELECT attempt.state")) {
          return {
            rows: [{ state: "IN_PROGRESS", provider_job_id: "provider-job-1" }] as unknown as Row[],
            affectedRows: 1,
          };
        }
        if (sql.includes("INSERT INTO artifact_reservations")) reservationParameters = parameters;
        if (sql.includes("INSERT INTO artifact_receipts")) receiptParameters = parameters;
        if (sql.includes("SELECT reservation.id::text")) {
          return {
            rows: [
              {
                reservation_id: ids.reservation,
                artifact_id: ids.task,
                object_key: objectKey,
                content_type: "image/png",
                content_length: artifactBytes.byteLength,
                checksum_sha256: artifactSha,
                state: "COMMITTED",
                receipt_sha256: receiptParameters[10],
              },
            ] as unknown as Row[],
            affectedRows: 1,
          };
        }
        return { rows: [], affectedRows: 1 };
      },
      async transaction<Value>(work: (transaction: TransactionalSqlExecutor) => Promise<Value>) {
        return work(executor);
      },
    };
    const store = new HostedSqlV209TerminalOutputStore(executor);
    await store.commitArtifacts({
      lineage: value.lineage,
      artifacts: [
        {
          reservationId: ids.reservation,
          itemId: ids.task,
          objectKey,
          contentType: "image/png",
          contentLength: artifactBytes.byteLength,
          checksumSha256: artifactSha,
          probe: { width: 1280, height: 720, format: "png" },
        },
      ],
      committedAt: "2026-09-06T10:01:00.000Z",
    });
    expect(reservationParameters).toEqual([
      ids.reservation,
      ids.account,
      ids.workspace,
      ids.project,
      ids.revision,
      "MAGE_IMAGE",
      ids.attempt,
      ids.task,
      objectKey,
      "image/png",
      artifactBytes.byteLength,
      artifactSha,
      value.lineage.deadlineAt,
    ]);
  });
});

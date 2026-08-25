import {
  ReceiptVerificationError,
  canonicalSha256,
  verifyProvenanceReceipt,
  type ProvenanceReceipt,
  type ProvenanceReceiptSigner,
  type ServerlessLane,
  type Sha256,
} from "@videoforge/control-plane";

export type HostedOutputBarrierErrorCode =
  | "HOSTED_OUTPUT_CALLBACK_MALFORMED"
  | "HOSTED_OUTPUT_TRANSPORT_NOT_COMPLETE"
  | "HOSTED_OUTPUT_FOREIGN"
  | "HOSTED_OUTPUT_RECEIPT_INVALID"
  | "HOSTED_OUTPUT_OBJECT_SET_MISMATCH"
  | "HOSTED_OUTPUT_PRIVATE_READBACK_FAILED"
  | "HOSTED_OUTPUT_IDEMPOTENCY_CONFLICT";

export class HostedOutputBarrierError extends Error {
  constructor(readonly code: HostedOutputBarrierErrorCode) {
    super(code);
    this.name = "HostedOutputBarrierError";
  }
}

export interface HostedExpectedServerlessObject {
  readonly itemId: string;
  readonly objectKey: string;
  readonly contentType: "image/png" | "video/mp4";
  readonly contentLength: number;
  readonly checksumSha256: Sha256;
}

export interface HostedServerlessAttemptBinding {
  readonly accountId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly projectRevisionId: string;
  readonly lane: ServerlessLane;
  readonly attemptId: string;
  readonly providerJobId: string;
  readonly dispatchTokenSha256: Sha256;
  readonly deploymentId: string;
  readonly endpointIdSha256: Sha256;
  readonly endpointConfigSha256: Sha256;
  readonly workerImageDigest: Sha256;
  readonly modelManifestSha256: Sha256;
  readonly volumeIdSha256: Sha256;
  readonly volumeManifestSha256: Sha256;
  readonly expectedObjects: readonly HostedExpectedServerlessObject[];
}

export interface HostedPrivateArtifactReadback extends HostedExpectedServerlessObject {
  readonly reservationState: "COMMITTED";
  readonly artifactCommitReceiptSha256: Sha256;
  readonly readbackChecksumSha256: Sha256;
  readonly readbackContentLength: number;
  readonly readbackContentType: string;
}

export interface HostedPrivateArtifactBarrierPort {
  readCommitted(
    binding: HostedServerlessAttemptBinding,
    expected: HostedExpectedServerlessObject,
  ): Promise<HostedPrivateArtifactReadback | null>;
}

export interface HostedLaneCompletionRecord {
  readonly attemptId: string;
  /** Canonical digest of every immutable tenant, revision, lane, deployment and object binding. */
  readonly bindingSha256: Sha256;
  readonly callbackSha256: Sha256;
  readonly provenanceReceiptSha256: Sha256;
  readonly artifactCommitReceiptSha256s: readonly Sha256[];
  readonly completedAt: string;
}

export interface HostedLaneCompletionRepository {
  accepted(attemptId: string): Promise<HostedLaneCompletionRecord | null>;
  seenReceiptNonces(attemptId: string): Promise<ReadonlySet<number>>;
  /** Rechecks nonce state and atomically persists exact provenance plus completion. */
  completeVerified(input: {
    readonly record: HostedLaneCompletionRecord;
    readonly binding: HostedServerlessAttemptBinding;
    readonly receipt: ProvenanceReceipt;
  }): Promise<{ readonly record: HostedLaneCompletionRecord; readonly inserted: boolean }>;
}

interface ParsedCallback {
  readonly transportStatus: "COMPLETED";
  readonly receipt: ProvenanceReceipt;
  readonly artifactCommitReceiptSha256s: readonly Sha256[];
  readonly observedAt: string;
}

export type HostedOutputBarrierOutcome = "LANE_COMPLETED" | "DUPLICATE_IDEMPOTENT";

const SHA256 = /^sha256:[0-9a-f]{64}$/u;

function parseCallback(value: unknown): ParsedCallback {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HostedOutputBarrierError("HOSTED_OUTPUT_CALLBACK_MALFORMED");
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !==
      "artifact_commit_receipt_sha256s,observed_at,provenance_receipt,schema_version,transport_status" ||
    record.schema_version !== "videoforge-hosted-serverless-output-callback/v1" ||
    typeof record.observed_at !== "string" ||
    Number.isNaN(Date.parse(record.observed_at)) ||
    !Array.isArray(record.artifact_commit_receipt_sha256s) ||
    record.artifact_commit_receipt_sha256s.length < 1 ||
    record.artifact_commit_receipt_sha256s.some(
      (candidate) => typeof candidate !== "string" || !SHA256.test(candidate),
    ) ||
    new Set(record.artifact_commit_receipt_sha256s).size !==
      record.artifact_commit_receipt_sha256s.length ||
    !record.provenance_receipt ||
    typeof record.provenance_receipt !== "object" ||
    Array.isArray(record.provenance_receipt)
  ) {
    throw new HostedOutputBarrierError("HOSTED_OUTPUT_CALLBACK_MALFORMED");
  }
  if (record.transport_status !== "COMPLETED") {
    throw new HostedOutputBarrierError("HOSTED_OUTPUT_TRANSPORT_NOT_COMPLETE");
  }
  return {
    transportStatus: "COMPLETED",
    receipt: record.provenance_receipt as ProvenanceReceipt,
    artifactCommitReceiptSha256s: record.artifact_commit_receipt_sha256s as readonly Sha256[],
    observedAt: record.observed_at,
  };
}

function objectPrefix(binding: HostedServerlessAttemptBinding): string {
  return (
    `tenant/${binding.accountId}/workspace/${binding.workspaceId}/project/${binding.projectId}` +
    `/revision/${binding.projectRevisionId}/lane/${binding.lane.replace("_", "-")}` +
    `/job/${binding.attemptId}/artifact/`
  );
}

function exactExpectedObjects(binding: HostedServerlessAttemptBinding): void {
  const ids = new Set<string>();
  const keys = new Set<string>();
  const prefix = objectPrefix(binding);
  if (binding.expectedObjects.length < 1 || binding.expectedObjects.length > 4096) {
    throw new HostedOutputBarrierError("HOSTED_OUTPUT_OBJECT_SET_MISMATCH");
  }
  for (const expected of binding.expectedObjects) {
    if (
      !expected.itemId ||
      !expected.objectKey.startsWith(prefix) ||
      ids.has(expected.itemId) ||
      keys.has(expected.objectKey) ||
      !Number.isSafeInteger(expected.contentLength) ||
      expected.contentLength < 1 ||
      !SHA256.test(expected.checksumSha256)
    ) {
      throw new HostedOutputBarrierError("HOSTED_OUTPUT_OBJECT_SET_MISMATCH");
    }
    ids.add(expected.itemId);
    keys.add(expected.objectKey);
  }
}

function verifyReceiptObjectSet(
  binding: HostedServerlessAttemptBinding,
  receipt: ProvenanceReceipt,
): void {
  const expected = new Map(binding.expectedObjects.map((item) => [item.itemId, item]));
  const seen = new Set<string>();
  if (receipt.items.length !== expected.size) {
    throw new HostedOutputBarrierError("HOSTED_OUTPUT_OBJECT_SET_MISMATCH");
  }
  for (const item of receipt.items) {
    const bound = expected.get(item.item_id);
    if (
      !bound ||
      seen.has(item.item_id) ||
      item.state !== "SUCCEEDED" ||
      item.output_object_key !== bound.objectKey ||
      item.output_sha256 !== bound.checksumSha256 ||
      item.output_bytes !== bound.contentLength
    ) {
      throw new HostedOutputBarrierError("HOSTED_OUTPUT_OBJECT_SET_MISMATCH");
    }
    seen.add(item.item_id);
  }
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  const sortedRight = [...right].sort(compareUtf8Bytes);
  return (
    left.length === right.length &&
    [...left].sort(compareUtf8Bytes).every((value, index) => value === sortedRight[index])
  );
}

const utf8 = new TextEncoder();

/** PostgreSQL `COLLATE "C"` ordering: compare encoded bytes, never locale rules. */
export function compareUtf8Bytes(left: string, right: string): number {
  const leftBytes = utf8.encode(left);
  const rightBytes = utf8.encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    const difference = leftBytes[index]! - rightBytes[index]!;
    if (difference !== 0) return difference;
  }
  return leftBytes.length - rightBytes.length;
}

export function hostedOutputBindingComponents(
  binding: HostedServerlessAttemptBinding,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    account_id: binding.accountId,
    workspace_id: binding.workspaceId,
    project_id: binding.projectId,
    project_revision_id: binding.projectRevisionId,
    lane: binding.lane,
    attempt_id: binding.attemptId,
    provider_job_id: binding.providerJobId,
    dispatch_token_sha256: binding.dispatchTokenSha256,
    deployment_id: binding.deploymentId,
    endpoint_id_sha256: binding.endpointIdSha256,
    endpoint_config_sha256: binding.endpointConfigSha256,
    worker_image_digest: binding.workerImageDigest,
    model_manifest_sha256: binding.modelManifestSha256,
    volume_id_sha256: binding.volumeIdSha256,
    volume_manifest_sha256: binding.volumeManifestSha256,
    expected_objects: [...binding.expectedObjects]
      .sort((left, right) => compareUtf8Bytes(left.itemId, right.itemId))
      .map((item) => ({
        item_id: item.itemId,
        object_key: item.objectKey,
        content_type: item.contentType,
        content_length: item.contentLength,
        checksum_sha256: item.checksumSha256,
      })),
  });
}

export function hostedOutputBindingSha256(binding: HostedServerlessAttemptBinding): Sha256 {
  return canonicalSha256(hostedOutputBindingComponents(binding));
}

/** Ordinary tenant callback barrier. It has no qualification nonce or operator route dependency. */
export function createHostedServerlessOutputBarrier(input: {
  readonly signer: ProvenanceReceiptSigner;
  readonly artifacts: HostedPrivateArtifactBarrierPort;
  readonly repository: HostedLaneCompletionRepository;
}) {
  return Object.freeze({
    async accept(
      binding: HostedServerlessAttemptBinding,
      callbackValue: unknown,
    ): Promise<HostedOutputBarrierOutcome> {
      exactExpectedObjects(binding);
      const callback = parseCallback(callbackValue);
      let callbackSha256: Sha256;
      try {
        callbackSha256 = canonicalSha256(callbackValue as Readonly<Record<string, unknown>>);
      } catch {
        throw new HostedOutputBarrierError("HOSTED_OUTPUT_CALLBACK_MALFORMED");
      }
      const immutableBindingSha256 = hostedOutputBindingSha256(binding);
      const existing = await input.repository.accepted(binding.attemptId);
      if (existing) {
        if (
          existing.callbackSha256 !== callbackSha256 ||
          existing.bindingSha256 !== immutableBindingSha256
        ) {
          throw new HostedOutputBarrierError("HOSTED_OUTPUT_IDEMPOTENCY_CONFLICT");
        }
        return "DUPLICATE_IDEMPOTENT";
      }

      try {
        verifyProvenanceReceipt(input.signer, callback.receipt, {
          dispatchTokenSha256: binding.dispatchTokenSha256,
          attemptId: binding.attemptId,
          providerJobId: binding.providerJobId,
          accountId: binding.accountId,
          workspaceId: binding.workspaceId,
          deploymentId: binding.deploymentId,
          endpointIdSha256: binding.endpointIdSha256,
          containerDigest: binding.workerImageDigest,
          volumeIdSha256: binding.volumeIdSha256,
          volumeManifestSha256: binding.volumeManifestSha256,
          modelManifestSha256: binding.modelManifestSha256,
          gpuAllowlist: ["NVIDIA GeForce RTX 4090"],
          seenNonces: await input.repository.seenReceiptNonces(binding.attemptId),
        });
        if (callback.receipt.lane !== binding.lane) {
          throw new HostedOutputBarrierError("HOSTED_OUTPUT_FOREIGN");
        }
      } catch (error) {
        if (error instanceof HostedOutputBarrierError) throw error;
        if (!(error instanceof ReceiptVerificationError)) {
          throw new HostedOutputBarrierError("HOSTED_OUTPUT_RECEIPT_INVALID");
        }
        const foreign = [
          "RECEIPT_TENANT_MISMATCH",
          "RECEIPT_TOKEN_MISMATCH",
          "RECEIPT_ATTEMPT_MISMATCH",
          "RECEIPT_JOB_MISMATCH",
        ].includes(error.code);
        throw new HostedOutputBarrierError(
          foreign ? "HOSTED_OUTPUT_FOREIGN" : "HOSTED_OUTPUT_RECEIPT_INVALID",
        );
      }
      verifyReceiptObjectSet(binding, callback.receipt);

      const commitHashes: Sha256[] = [];
      for (const expected of binding.expectedObjects) {
        let readback: HostedPrivateArtifactReadback | null;
        try {
          readback = await input.artifacts.readCommitted(binding, expected);
        } catch {
          throw new HostedOutputBarrierError("HOSTED_OUTPUT_PRIVATE_READBACK_FAILED");
        }
        if (
          !readback ||
          readback.itemId !== expected.itemId ||
          readback.objectKey !== expected.objectKey ||
          readback.contentType !== expected.contentType ||
          readback.contentLength !== expected.contentLength ||
          readback.checksumSha256 !== expected.checksumSha256 ||
          readback.reservationState !== "COMMITTED" ||
          readback.readbackChecksumSha256 !== expected.checksumSha256 ||
          readback.readbackContentLength !== expected.contentLength ||
          readback.readbackContentType !== expected.contentType ||
          !SHA256.test(readback.artifactCommitReceiptSha256)
        ) {
          throw new HostedOutputBarrierError("HOSTED_OUTPUT_PRIVATE_READBACK_FAILED");
        }
        commitHashes.push(readback.artifactCommitReceiptSha256);
      }
      if (!sameStringSet(commitHashes, callback.artifactCommitReceiptSha256s)) {
        throw new HostedOutputBarrierError("HOSTED_OUTPUT_OBJECT_SET_MISMATCH");
      }

      const proposed: HostedLaneCompletionRecord = Object.freeze({
        attemptId: binding.attemptId,
        bindingSha256: immutableBindingSha256,
        callbackSha256,
        provenanceReceiptSha256: callback.receipt.receipt_sha256,
        artifactCommitReceiptSha256s: Object.freeze([...commitHashes].sort()),
        completedAt: callback.observedAt,
      });
      const completion = await input.repository.completeVerified({
        record: proposed,
        binding,
        receipt: callback.receipt,
      });
      const committed = completion.record;
      if (
        committed.callbackSha256 !== callbackSha256 ||
        committed.bindingSha256 !== immutableBindingSha256
      ) {
        throw new HostedOutputBarrierError("HOSTED_OUTPUT_IDEMPOTENCY_CONFLICT");
      }
      return completion.inserted ? "LANE_COMPLETED" : "DUPLICATE_IDEMPOTENT";
    },
  });
}

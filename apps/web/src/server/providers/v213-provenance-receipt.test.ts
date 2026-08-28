// @vitest-environment node

import { canonicalizeJson, type JsonValue } from "@videoforge/contracts";
import {
  PROVENANCE_ATTESTATION_SCOPE,
  ProvenanceReceiptSigner,
  ReceiptVerificationError,
  canonicalSha256,
  digestUtf8,
  type ProvenanceReceiptBody,
  type ReceiptExpectation,
  type Sha256,
} from "@videoforge/control-plane";
import { describe, expect, it } from "vitest";

import {
  V213ProvenanceReceiptError,
  v213SoulxWarmupAttestationSha256,
  verifyV213WorkerReceipt,
} from "./v213-provenance-receipt";

const sha = (value: string): Sha256 => canonicalSha256({ value });
const signer = new ProvenanceReceiptSigner("receipt-key-v1", Buffer.alloc(32, 7));

function fixture() {
  const body: ProvenanceReceiptBody = {
    schema_version: "serverless-provenance-receipt/v1",
    receipt_id: "receipt-a",
    attestation_scope: PROVENANCE_ATTESTATION_SCOPE,
    dispatch_token: "dispatch-token-0123456789abcdef0123456789abcdef",
    envelope_sha256: sha("envelope"),
    request_sha256: sha("request"),
    attempt_id: "attempt-a",
    provider_job_id: "job-a",
    worker_id: "worker-a",
    tenant: { account_id: "account-a", workspace_id: "workspace-a" },
    lane: "mage_image",
    deployment: {
      deployment_id: "deployment-a",
      endpoint_id_sha256: sha("endpoint"),
      container_digest: sha("image"),
      intended_region: "EU-RO-1",
      intended_volume_id_sha256: sha("volume"),
      model_manifest_sha256: sha("model"),
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
      manifest_sha256_before: sha("manifest"),
      manifest_sha256_after: sha("manifest"),
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
        item_id: "item-a",
        state: "SUCCEEDED",
        output_object_key: "tenant/account-a/workspace/workspace-a/item-a.png",
        output_sha256: sha("output"),
        output_bytes: 10,
        probe: { width: 1280, height: 720 },
      },
    ],
    scratch_cleanup: {
      terminal_reason: "SUCCESS",
      removed: true,
      scratch_on_model_volume: false,
    },
    receipt_nonce: 1,
    issued_at: "2026-08-26T00:00:00.000Z",
  };
  const bytes = Buffer.from(canonicalizeJson(body as unknown as JsonValue), "utf8");
  const receipt = signer.signOverBytes(body, bytes);
  const expectation: ReceiptExpectation = {
    dispatchTokenSha256: digestUtf8(body.dispatch_token),
    envelopeSha256: body.envelope_sha256,
    requestSha256: body.request_sha256,
    attemptId: body.attempt_id,
    providerJobId: body.provider_job_id,
    accountId: body.tenant.account_id,
    workspaceId: body.tenant.workspace_id,
    deploymentId: body.deployment.deployment_id,
    endpointIdSha256: body.deployment.endpoint_id_sha256,
    containerDigest: body.deployment.container_digest,
    volumeIdSha256: body.deployment.intended_volume_id_sha256,
    volumeManifestSha256: body.volume_verification.manifest_sha256_before,
    modelManifestSha256: body.deployment.model_manifest_sha256,
    gpuAllowlist: ["NVIDIA GeForce RTX 4090"],
    seenNonces: new Set(),
  };
  return { body, bytes, receipt, expectation };
}

describe("V2-13 HMAC provenance receipt verifier", () => {
  it("accepts the exact worker body bytes and all durable request bindings", () => {
    const value = fixture();
    expect(
      verifyV213WorkerReceipt(
        signer,
        { receipt: value.receipt, receiptBodyBase64: value.bytes.toString("base64") },
        value.expectation,
      ).receipt,
    ).toBe(value.receipt);
  });

  it.each([
    ["envelopeSha256", "RECEIPT_ENVELOPE_MISMATCH"],
    ["requestSha256", "RECEIPT_REQUEST_MISMATCH"],
  ] as const)("rejects %s drift", (field, code) => {
    const value = fixture();
    expect(() =>
      verifyV213WorkerReceipt(
        signer,
        { receipt: value.receipt, receiptBodyBase64: value.bytes.toString("base64") },
        { ...value.expectation, [field]: sha("wrong") },
      ),
    ).toThrowError(expect.objectContaining({ code } satisfies Partial<ReceiptVerificationError>));
  });

  it("derives an exact deployment-bound SoulX attestation and rejects receipt drift", () => {
    const value = fixture();
    const expected = v213SoulxWarmupAttestationSha256(value.body.deployment.container_digest);
    expect(expected).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(v213SoulxWarmupAttestationSha256(`sha256:${"3".repeat(64)}`)).toBe(
      "sha256:7d57d52f414f17a0b3a47e1909da6048cb4c72e8236c9c48c39e3ccdec6219a0",
    );
    expect(() =>
      verifyV213WorkerReceipt(
        signer,
        { receipt: value.receipt, receiptBodyBase64: value.bytes.toString("base64") },
        { ...value.expectation, warmupAttestationSha256: expected },
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "RECEIPT_WARMUP_ATTESTATION_MISMATCH",
      } satisfies Partial<ReceiptVerificationError>),
    );
  });

  it("rejects a substituted body even when the receipt HMAC remains valid", () => {
    const value = fixture();
    const substituted = Buffer.from(
      canonicalizeJson({ ...value.body, attempt_id: "attempt-foreign" } as unknown as JsonValue),
      "utf8",
    );
    expect(() =>
      verifyV213WorkerReceipt(
        signer,
        { receipt: value.receipt, receiptBodyBase64: substituted.toString("base64") },
        value.expectation,
      ),
    ).toThrowError(V213ProvenanceReceiptError);
  });

  it("rejects a receipt signed by a different protected HMAC key", () => {
    const value = fixture();
    const foreign = new ProvenanceReceiptSigner("receipt-key-v1", Buffer.alloc(32, 8));
    const forged = foreign.signOverBytes(value.body, value.bytes);
    expect(() =>
      verifyV213WorkerReceipt(
        signer,
        { receipt: forged, receiptBodyBase64: value.bytes.toString("base64") },
        value.expectation,
      ),
    ).toThrowError(expect.objectContaining({ code: "RECEIPT_SIGNATURE_INVALID" }));
  });
});

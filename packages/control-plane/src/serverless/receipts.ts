import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { canonicalizeJson } from "@videoforge/contracts/canonical-json";

import type { Sha256 } from "../repositories/types.js";
import { canonicalSha256, digestUtf8 } from "./authority.js";

/** Hash of the exact bytes a worker emitted, with no re-serialization in between. */
export function digestBytes(bytes: Uint8Array): Sha256 {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export const PROVENANCE_ATTESTATION_SCOPE =
  "VIDEOFORGE_APPLICATION_SIGNED_FACTS_NOT_PROVIDER_HARDWARE_ATTESTATION" as const;

export interface ProvenanceRuntimeProbe {
  readonly gpu_name: string;
  readonly gpu_count: 1;
  readonly gpu_uuid_sha256: Sha256 | null;
  readonly driver_version: string;
  readonly cuda_version: string;
  readonly probe_source: "WORKER_RUNTIME_SELF_REPORT";
}

export interface ProvenanceItem {
  readonly item_id: string;
  readonly state: "SUCCEEDED" | "FAILED";
  readonly output_object_key: string | null;
  readonly output_sha256: Sha256 | null;
  readonly output_bytes: number;
  readonly probe: Readonly<Record<string, boolean | number | string | null>>;
}

export interface ProvenanceReceipt {
  readonly schema_version: "serverless-provenance-receipt/v1";
  readonly receipt_id: string;
  readonly attestation_scope: typeof PROVENANCE_ATTESTATION_SCOPE;
  readonly dispatch_token: string;
  readonly attempt_id: string;
  readonly provider_job_id: string | null;
  readonly worker_id: string | null;
  readonly tenant: { readonly account_id: string; readonly workspace_id: string };
  readonly lane: "mage_image" | "soulx_avatar";
  readonly deployment: {
    readonly deployment_id: string;
    readonly endpoint_id_sha256: Sha256;
    readonly container_digest: Sha256;
    readonly intended_region: "EU-RO-1";
    readonly intended_volume_id_sha256: Sha256;
    readonly model_manifest_sha256: Sha256;
  };
  readonly runtime_probe: ProvenanceRuntimeProbe;
  readonly volume_verification: {
    readonly manifest_sha256_before: Sha256;
    readonly manifest_sha256_after: Sha256;
    readonly mutation_detected: boolean;
    readonly cross_mount_detected: boolean;
  };
  readonly model_ready_evidence: {
    readonly state: "MODEL_READY";
    readonly warmup_completed: true;
    readonly warmup_output_sha256: Sha256;
  };
  readonly timings: Readonly<Record<string, number>>;
  readonly items: readonly ProvenanceItem[];
  readonly scratch_cleanup: {
    readonly terminal_reason: "SUCCESS" | "FAILURE" | "CANCEL" | "TIMEOUT" | "SIGNAL" | "REFRESH";
    readonly removed: boolean;
    readonly scratch_on_model_volume: boolean;
  };
  readonly receipt_nonce: number;
  readonly issued_at: string;
  readonly receipt_sha256: Sha256;
  readonly signature: {
    readonly algorithm: "HMAC-SHA256";
    readonly key_id: string;
    readonly value: string;
  };
}

export type ProvenanceReceiptBody = Omit<ProvenanceReceipt, "receipt_sha256" | "signature">;

export type ReceiptVerificationErrorCode =
  | "RECEIPT_ATTEMPT_MISMATCH"
  | "RECEIPT_ATTESTATION_SCOPE_INVALID"
  | "RECEIPT_DEPLOYMENT_MISMATCH"
  | "RECEIPT_GPU_NOT_ALLOWED"
  | "RECEIPT_HASH_MISMATCH"
  | "RECEIPT_JOB_MISMATCH"
  | "RECEIPT_NONCE_REPLAYED"
  | "RECEIPT_REGION_MISMATCH"
  | "RECEIPT_SCRATCH_UNSAFE"
  | "RECEIPT_SIGNATURE_INVALID"
  | "RECEIPT_TENANT_MISMATCH"
  | "RECEIPT_TOKEN_MISMATCH"
  | "RECEIPT_VOLUME_MUTATED";

export class ReceiptVerificationError extends Error {
  constructor(
    readonly code: ReceiptVerificationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ReceiptVerificationError";
  }
}

/** The worker-side signing key. It proves VideoForge worker code signed these facts, nothing more. */
export class ProvenanceReceiptSigner {
  readonly #secret: Uint8Array;
  readonly #keyId: string;

  constructor(keyId: string, secret: Uint8Array) {
    if (secret.byteLength < 32) throw new RangeError("a receipt key needs at least 32 bytes");
    this.#keyId = keyId;
    this.#secret = secret.slice();
  }

  get keyId(): string {
    return this.#keyId;
  }

  sign(body: ProvenanceReceiptBody): ProvenanceReceipt {
    const receiptSha256 = canonicalSha256(body);
    const value = createHmac("sha256", this.#secret)
      .update(canonicalizeJson({ receipt_sha256: receiptSha256, key_id: this.#keyId }))
      .digest("hex");
    return Object.freeze({
      ...body,
      receipt_sha256: receiptSha256,
      signature: { algorithm: "HMAC-SHA256", key_id: this.#keyId, value },
    }) as ProvenanceReceipt;
  }

  /**
   * Signs a receipt whose hash covers the exact bytes a worker emitted. A Python lane worker uses
   * this shape because TypeScript, not Python, is the RFC 8785 authority.
   */
  signOverBytes(body: ProvenanceReceiptBody, emittedBytes: Uint8Array): ProvenanceReceipt {
    const receiptSha256 = digestBytes(emittedBytes);
    const value = createHmac("sha256", this.#secret)
      .update(canonicalizeJson({ receipt_sha256: receiptSha256, key_id: this.#keyId }))
      .digest("hex");
    return Object.freeze({
      ...body,
      receipt_sha256: receiptSha256,
      signature: { algorithm: "HMAC-SHA256", key_id: this.#keyId, value },
    }) as ProvenanceReceipt;
  }

  /**
   * `rawBytes` are the exact bytes the worker emitted. TypeScript is the sole RFC 8785 authority,
   * so a Python worker hashes the bytes it actually wrote and the control plane verifies those
   * bytes rather than re-canonicalizing a foreign document.
   */
  verifySignature(receipt: ProvenanceReceipt, rawBytes?: Uint8Array): void {
    let expectedHash: Sha256;
    if (rawBytes === undefined) {
      const body: Record<string, unknown> = { ...receipt };
      delete body.receipt_sha256;
      delete body.signature;
      expectedHash = canonicalSha256(body);
    } else {
      expectedHash = digestBytes(rawBytes);
    }
    if (expectedHash !== receipt.receipt_sha256) {
      throw new ReceiptVerificationError(
        "RECEIPT_HASH_MISMATCH",
        "The receipt hash does not cover its own bytes.",
      );
    }
    if (receipt.signature.key_id !== this.#keyId) {
      throw new ReceiptVerificationError(
        "RECEIPT_SIGNATURE_INVALID",
        "The receipt names an unknown signing key.",
      );
    }
    const expected = createHmac("sha256", this.#secret)
      .update(canonicalizeJson({ receipt_sha256: receipt.receipt_sha256, key_id: this.#keyId }))
      .digest();
    const supplied = Buffer.from(receipt.signature.value, "hex");
    if (supplied.byteLength !== expected.byteLength || !timingSafeEqual(supplied, expected)) {
      throw new ReceiptVerificationError(
        "RECEIPT_SIGNATURE_INVALID",
        "The receipt signature is invalid.",
      );
    }
  }
}

export interface ReceiptExpectation {
  readonly dispatchTokenSha256: Sha256;
  readonly attemptId: string;
  readonly providerJobId: string | null;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly deploymentId: string;
  readonly endpointIdSha256: Sha256;
  readonly containerDigest: Sha256;
  readonly volumeIdSha256: Sha256;
  readonly volumeManifestSha256: Sha256;
  readonly modelManifestSha256: Sha256;
  readonly gpuAllowlist: readonly string[];
  /** Every previously accepted nonce for this attempt. A receipt may never reuse one. */
  readonly seenNonces: ReadonlySet<number>;
}

/**
 * Validates a signed provenance receipt against the exact predispatch bindings. A valid signature
 * only proves VideoForge's worker key produced these facts; it is never a provider attestation of
 * hardware, delivery uniqueness, or billing.
 */
export function verifyProvenanceReceipt(
  signer: ProvenanceReceiptSigner,
  receipt: ProvenanceReceipt,
  expectation: ReceiptExpectation,
  rawBytes?: Uint8Array,
): void {
  signer.verifySignature(receipt, rawBytes);
  if (receipt.attestation_scope !== PROVENANCE_ATTESTATION_SCOPE) {
    throw new ReceiptVerificationError(
      "RECEIPT_ATTESTATION_SCOPE_INVALID",
      "A receipt cannot claim provider hardware attestation.",
    );
  }
  if (digestUtf8(receipt.dispatch_token) !== expectation.dispatchTokenSha256) {
    throw new ReceiptVerificationError(
      "RECEIPT_TOKEN_MISMATCH",
      "The receipt was issued for a different dispatch token.",
    );
  }
  if (receipt.attempt_id !== expectation.attemptId) {
    throw new ReceiptVerificationError(
      "RECEIPT_ATTEMPT_MISMATCH",
      "The receipt names a different attempt.",
    );
  }
  if (
    expectation.providerJobId !== null &&
    receipt.provider_job_id !== null &&
    receipt.provider_job_id !== expectation.providerJobId
  ) {
    throw new ReceiptVerificationError(
      "RECEIPT_JOB_MISMATCH",
      "The receipt names a different provider job than the current assignment.",
    );
  }
  if (
    receipt.tenant.account_id !== expectation.accountId ||
    receipt.tenant.workspace_id !== expectation.workspaceId
  ) {
    throw new ReceiptVerificationError(
      "RECEIPT_TENANT_MISMATCH",
      "The receipt names a different tenant.",
    );
  }
  if (
    receipt.deployment.deployment_id !== expectation.deploymentId ||
    receipt.deployment.endpoint_id_sha256 !== expectation.endpointIdSha256 ||
    receipt.deployment.container_digest !== expectation.containerDigest ||
    receipt.deployment.model_manifest_sha256 !== expectation.modelManifestSha256
  ) {
    throw new ReceiptVerificationError(
      "RECEIPT_DEPLOYMENT_MISMATCH",
      "The receipt does not match the bound endpoint deployment.",
    );
  }
  if (receipt.deployment.intended_region !== "EU-RO-1") {
    throw new ReceiptVerificationError(
      "RECEIPT_REGION_MISMATCH",
      "The receipt reports a region outside the approved lane.",
    );
  }
  if (receipt.deployment.intended_volume_id_sha256 !== expectation.volumeIdSha256) {
    throw new ReceiptVerificationError(
      "RECEIPT_DEPLOYMENT_MISMATCH",
      "The receipt reports a different model volume than the bound lane volume.",
    );
  }
  if (!expectation.gpuAllowlist.includes(receipt.runtime_probe.gpu_name)) {
    throw new ReceiptVerificationError(
      "RECEIPT_GPU_NOT_ALLOWED",
      "The runtime probe reports a GPU outside the qualified allowlist.",
    );
  }
  if (
    receipt.volume_verification.mutation_detected ||
    receipt.volume_verification.cross_mount_detected ||
    receipt.volume_verification.manifest_sha256_before !== expectation.volumeManifestSha256 ||
    receipt.volume_verification.manifest_sha256_after !== expectation.volumeManifestSha256
  ) {
    throw new ReceiptVerificationError(
      "RECEIPT_VOLUME_MUTATED",
      "The sealed model volume changed or was cross-mounted during the attempt.",
    );
  }
  if (!receipt.scratch_cleanup.removed || receipt.scratch_cleanup.scratch_on_model_volume) {
    throw new ReceiptVerificationError(
      "RECEIPT_SCRATCH_UNSAFE",
      "Job scratch must live outside the model volume and be erased on every terminal path.",
    );
  }
  if (expectation.seenNonces.has(receipt.receipt_nonce)) {
    throw new ReceiptVerificationError(
      "RECEIPT_NONCE_REPLAYED",
      "A provenance receipt nonce cannot be replayed.",
    );
  }
}

import { validateContract } from "@videoforge/contracts";
import {
  canonicalSha256,
  ReceiptVerificationError,
  verifyProvenanceReceipt,
  type ProvenanceReceipt,
  type ProvenanceReceiptSigner,
  type ReceiptExpectation,
} from "@videoforge/control-plane";

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

export function v213SoulxWarmupAttestationSha256(containerDigest: `sha256:${string}`) {
  return canonicalSha256({
    schema_version: "videoforge.soulx-warmup-attestation/v1",
    container_digest: containerDigest,
    source: {
      repository: "Soul-AILab/SoulX-FlashHead",
      revision: "9bc03de06bb0de82cd6bc477804512ae06144bf2",
    },
    model: {
      repository: "Soul-AILab/SoulX-FlashHead-1_3B",
      revision: "59119b6c681230c3eeee157e224ae1941746711e",
      manifest_sha256: "sha256:995a8e478b6a3265d5a116ca283229ad0d358a5348f16f851dc0fed564bf5626",
    },
    volume_schema_version: "videoforge.soulx-flashhead-pro-volume/v1",
    runtime_profile_id: "videoforge_soulx_flashhead_pro_bf16_v1",
    observed_facts: {
      base_data_completed: true,
      audio_embedding_completed: true,
      pipeline_output_contract: "33_RGB_512X512_FINITE_NONCONSTANT",
      cuda_synchronize_completed: true,
      sample_rate_hz: 16_000,
      target_fps: 25,
      frame_count: 33,
      motion_frame_count: 5,
    },
  });
}

export class V213ProvenanceReceiptError extends Error {
  constructor(
    readonly code: "V213_RECEIPT_BODY_INVALID" | "V213_RECEIPT_SCHEMA_INVALID",
    readonly reason?: string,
  ) {
    super(reason === undefined ? code : `${code}:${reason}`);
    this.name = "V213ProvenanceReceiptError";
  }
}

export interface V213WorkerReceiptDelivery {
  readonly receipt: ProvenanceReceipt;
  /** Exact unsigned JSON bytes returned by the worker's receipt signer. */
  readonly receiptBodyBase64: string;
}

/**
 * Verifies the real worker contract. The HMAC secret remains inside ProvenanceReceiptSigner; this
 * adapter accepts no public-key normalization and never serializes the secret or exposes it to a
 * command line.
 */
export function verifyV213WorkerReceipt(
  signer: ProvenanceReceiptSigner,
  delivery: V213WorkerReceiptDelivery,
  expectation: ReceiptExpectation,
): Readonly<{ receipt: ProvenanceReceipt; receiptBodyBytes: Uint8Array }> {
  if (
    typeof delivery.receiptBodyBase64 !== "string" ||
    delivery.receiptBodyBase64.length === 0 ||
    delivery.receiptBodyBase64.length > 4_000_000 ||
    !BASE64.test(delivery.receiptBodyBase64)
  ) {
    throw new V213ProvenanceReceiptError("V213_RECEIPT_BODY_INVALID");
  }
  const bodyBytes = Buffer.from(delivery.receiptBodyBase64, "base64");
  if (bodyBytes.toString("base64") !== delivery.receiptBodyBase64) {
    throw new V213ProvenanceReceiptError("V213_RECEIPT_BODY_INVALID");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyBytes.toString("utf8"));
  } catch {
    throw new V213ProvenanceReceiptError("V213_RECEIPT_BODY_INVALID");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new V213ProvenanceReceiptError("V213_RECEIPT_BODY_INVALID");
  }
  // The worker emits the unsigned receipt body as the signed byte string and the provider
  // response repeats that body as `provenance_receipt`. The byte string is authoritative: a
  // provider-side JSON round trip may normalize an otherwise equivalent value (or omit an
  // optional field), and comparing the two copies made valid completed jobs fail closed before
  // the actual signature/binding checks ran. Rebuild the receipt from the exact signed body and
  // carry over only the signature envelope from the response.
  const receipt = {
    ...(parsed as Record<string, unknown>),
    receipt_sha256: delivery.receipt.receipt_sha256,
    signature: delivery.receipt.signature,
  } as unknown as ProvenanceReceipt;
  try {
    const validation = validateContract("serverlessProvenanceReceiptV1", receipt);
    if (!validation.success) {
      const issue = validation.issues[0];
      throw new V213ProvenanceReceiptError(
        "V213_RECEIPT_SCHEMA_INVALID",
        `contract:${issue?.instancePath || "$"}:${issue?.keyword || "invalid"}`,
      );
    }
  } catch (error) {
    if (error instanceof V213ProvenanceReceiptError) throw error;
    throw new V213ProvenanceReceiptError("V213_RECEIPT_SCHEMA_INVALID", "contract:exception");
  }
  try {
    verifyProvenanceReceipt(signer, receipt, expectation, bodyBytes);
  } catch (error) {
    if (error instanceof ReceiptVerificationError) throw error;
    throw new V213ProvenanceReceiptError("V213_RECEIPT_SCHEMA_INVALID", "verification:exception");
  }
  return Object.freeze({ receipt, receiptBodyBytes: new Uint8Array(bodyBytes) });
}

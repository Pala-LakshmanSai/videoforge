import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateContract } from "@videoforge/contracts";

import {
  EnvelopeQuarantineError,
  QUARANTINED_DISPATCH_SCHEMAS,
  SERVERLESS_V3_ENVELOPE_SCHEMA,
  assertDispatchableEnvelope,
} from "../dist/src/index.js";

const fixtureRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../contracts/generated/fixtures",
);

const loadFixture = async (name) =>
  JSON.parse(await readFile(path.join(fixtureRoot, name), "utf8"));

test("superseded Pod-era contracts stay replayable as read-only compatibility evidence", async () => {
  const podEnvelope = await loadFixture("pod_worker_job_envelope.valid.json");
  const globalSession = await loadFixture("global_generation_session.valid.json");

  // Historical bytes still validate; V2-04 quarantines them rather than rewriting them.
  assert.equal(validateContract("podWorkerJobEnvelope", podEnvelope).success, true);
  assert.equal(validateContract("globalGenerationSession", globalSession).success, true);
});

test("a superseded Pod envelope can never satisfy the Serverless v3 contract", async () => {
  const podEnvelope = await loadFixture("pod_worker_job_envelope.valid.json");
  assert.equal(validateContract("serverlessWorkerJobEnvelopeV3", podEnvelope).success, false);

  const v3Envelope = await loadFixture("serverless_worker_job_envelope_v3.valid.json");
  assert.equal(validateContract("serverlessWorkerJobEnvelopeV3", v3Envelope).success, true);
  // The v3 envelope is equally unusable as a Pod envelope, so the two paths cannot be confused.
  assert.equal(validateContract("podWorkerJobEnvelope", v3Envelope).success, false);
});

test("the dispatch firewall rejects every quarantined schema before any transport call", async () => {
  for (const schema of QUARANTINED_DISPATCH_SCHEMAS) {
    assert.throws(
      () => assertDispatchableEnvelope({ schema, dispatch_token: "dt-legacy" }),
      (error) =>
        error instanceof EnvelopeQuarantineError &&
        error.code === "ENVELOPE_SCHEMA_QUARANTINED" &&
        error.observedSchema === schema,
    );
    assert.throws(
      () => assertDispatchableEnvelope({ schema_version: schema }),
      (error) =>
        error instanceof EnvelopeQuarantineError && error.code === "ENVELOPE_SCHEMA_QUARANTINED",
    );
  }

  for (const invalid of [null, [], "envelope", 7, {}, { schema: "some-other/v9" }]) {
    assert.throws(
      () => assertDispatchableEnvelope(invalid),
      (error) => error instanceof EnvelopeQuarantineError,
    );
  }

  const v3Envelope = await loadFixture("serverless_worker_job_envelope_v3.valid.json");
  assert.equal(assertDispatchableEnvelope(v3Envelope).schema, SERVERLESS_V3_ENVELOPE_SCHEMA);
});

test("the v3 envelope forbids model download, volume mutation, Pod lifecycle, and queue purge", async () => {
  const envelope = await loadFixture("serverless_worker_job_envelope_v3.valid.json");
  assert.deepEqual(envelope.policy, {
    model_download_permitted: false,
    volume_mutation_permitted: false,
    pod_lifecycle_permitted: false,
    queue_purge_permitted: false,
  });
  assert.equal(envelope.runtime.volume_mount, "/runpod-volume");
  assert.equal(envelope.runtime.volume_write_policy, "APPLICATION_READ_ONLY");
  assert.equal(envelope.runtime.scratch_root_policy, "JOB_LOCAL_SCRATCH_OUTSIDE_MODEL_VOLUME");
  assert.deepEqual(envelope.runtime.gpu_allowlist, ["NVIDIA GeForce RTX 4090"]);
});

test("the measured timeout envelope keeps TTL, execution, init, and reconciliation separate", async () => {
  const deployment = await loadFixture("serverless_endpoint_deployment_v3.valid.json");
  assert.equal(
    deployment.request_ttl_scope,
    "PROVIDER_QUEUE_PLUS_EXECUTION_PLUS_OUTPUT_UPLOAD",
    "provider TTL covers queued life as well as execution",
  );
  assert.equal(deployment.timeout_evidence.provider_defaults_accepted, false);
  assert.equal(deployment.provider_result_window_seconds, 1800);
  assert.ok(
    deployment.reconciliation_deadline_seconds < deployment.provider_result_window_seconds,
    "reconciliation must finish inside the asynchronous result window",
  );
  // Scale to zero: no retained Active worker, and the ceiling counts Active plus Flex.
  assert.equal(deployment.worker_count_min, 0);
  assert.equal(deployment.retained_active_workers, 0);
  assert.equal(deployment.worker_count_max, 2);
  assert.equal(deployment.worker_ceiling_scope, "ACTIVE_PLUS_FLEX");
  assert.equal(deployment.retry_policy.blind_resubmit_permitted, false);
  assert.equal(deployment.retry_policy.requires_prior_attempt_terminal_or_reconciled, true);
});

test("no canonical Serverless contract claims exactly-once execution or billing", async () => {
  const attempt = await loadFixture("serverless_request_attempt_v3.valid.json");
  const manifest = await loadFixture("production_manifest_v3.valid.json");
  assert.equal(attempt.exactly_once_execution_claimed, false);
  assert.equal(attempt.exactly_once_billing_claimed, false);
  assert.equal(attempt.duplicate_exposure.operator_visible, true);
  assert.equal(
    manifest.serverless_lineage.guarantees.at_most_one_accepted_output_per_attempt,
    true,
  );
  assert.equal(
    manifest.serverless_lineage.guarantees.provider_exactly_once_execution_claimed,
    false,
  );
  assert.equal(manifest.serverless_lineage.guarantees.provider_exactly_once_billing_claimed, false);
  assert.equal(manifest.serverless_lineage.guarantees.queue_purge_used, false);
});

test("a worker-emitted receipt is verified against its exact bytes and request bindings", async () => {
  const {
    ProvenanceReceiptSigner,
    ReceiptVerificationError,
    digestBytes,
    digestUtf8,
    verifyProvenanceReceipt,
  } = await import("../dist/src/index.js");
  const signer = new ProvenanceReceiptSigner("worker-key-1", Buffer.alloc(32, 7));
  const fixture = await loadFixture("serverless_provenance_receipt_v1.valid.json");
  const body = { ...fixture };
  delete body.receipt_sha256;
  delete body.signature;

  // A Python worker hashes the bytes it actually wrote. TypeScript stays the sole RFC 8785
  // authority and verifies those exact bytes instead of canonicalizing a foreign document, so a
  // worker-chosen key order is still verifiable.
  const reordered = Object.fromEntries(Object.entries(body).reverse());
  const emitted = Buffer.from(JSON.stringify(reordered), "utf8");
  const receipt = signer.signOverBytes(body, emitted);

  assert.equal(receipt.receipt_sha256, digestBytes(emitted));
  signer.verifySignature(receipt, emitted);
  const expectation = {
    dispatchTokenSha256: digestUtf8(receipt.dispatch_token),
    envelopeSha256: receipt.envelope_sha256,
    requestSha256: receipt.request_sha256,
    attemptId: receipt.attempt_id,
    providerJobId: receipt.provider_job_id,
    accountId: receipt.tenant.account_id,
    workspaceId: receipt.tenant.workspace_id,
    deploymentId: receipt.deployment.deployment_id,
    endpointIdSha256: receipt.deployment.endpoint_id_sha256,
    containerDigest: receipt.deployment.container_digest,
    volumeIdSha256: receipt.deployment.intended_volume_id_sha256,
    volumeManifestSha256: receipt.volume_verification.manifest_sha256_before,
    modelManifestSha256: receipt.deployment.model_manifest_sha256,
    gpuAllowlist: ["NVIDIA GeForce RTX 4090"],
    seenNonces: new Set(),
  };
  verifyProvenanceReceipt(signer, receipt, expectation, emitted);
  for (const [field, code] of [
    ["envelopeSha256", "RECEIPT_ENVELOPE_MISMATCH"],
    ["requestSha256", "RECEIPT_REQUEST_MISMATCH"],
  ]) {
    assert.throws(
      () =>
        verifyProvenanceReceipt(
          signer,
          receipt,
          { ...expectation, [field]: `sha256:${"0".repeat(64)}` },
          emitted,
        ),
      (error) => error instanceof ReceiptVerificationError && error.code === code,
    );
  }

  // The same receipt fails when checked against a different serialization of the same facts.
  assert.throws(
    () => signer.verifySignature(receipt),
    (error) => error instanceof ReceiptVerificationError && error.code === "RECEIPT_HASH_MISMATCH",
  );

  // Tampering with a single emitted byte breaks verification.
  const tampered = Buffer.from(emitted);
  tampered[tampered.length - 2] ^= 0x01;
  assert.throws(
    () => signer.verifySignature(receipt, tampered),
    (error) => error instanceof ReceiptVerificationError && error.code === "RECEIPT_HASH_MISMATCH",
  );
});

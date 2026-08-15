import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { validateContract } from "../../contracts/dist/src/index.js";
import {
  ArtifactPortError,
  deriveArtifactObjectKey,
  FakeR2ArtifactPlane,
  trustedTenantScope,
} from "../dist/src/index.js";

const NOW = new Date("2026-08-15T12:00:00.000Z");
const LATER = new Date("2026-08-15T12:06:00.000Z");
const bytes = new TextEncoder().encode("two tenants can both upload portrait.png safely");
const hash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const scopeA = trustedTenantScope("account-a", "workspace-a");
const scopeB = trustedTenantScope("account-b", "workspace-b");

function identity(scope, suffix = "same-name") {
  return {
    scope,
    projectId: "project-1",
    projectRevisionId: "revision-1",
    lane: "INPUT",
    jobId: `job-${suffix}`,
    artifactId: `artifact-${suffix}`,
  };
}

function options(overrides = {}) {
  return {
    contentType: "image/png",
    contentLength: bytes.byteLength,
    checksumSha256: hash,
    now: NOW,
    retentionClass: "PROJECT",
    ...overrides,
  };
}

function uploadRequest(port, body = bytes, overrides = {}) {
  return {
    path: port.path,
    contentType: port.content_type,
    contentLength: port.content_length,
    checksumSha256: port.checksum_sha256,
    body,
    now: NOW,
    ...overrides,
  };
}

function expectCode(code, work) {
  assert.throws(work, (error) => error instanceof ArtifactPortError && error.code === code);
}

test("trusted identity derives opaque immutable tenant keys and ignores identical filenames", () => {
  const keyA = deriveArtifactObjectKey(identity(scopeA));
  const keyB = deriveArtifactObjectKey(identity(scopeB));
  assert.notEqual(keyA, keyB);
  assert.match(keyA, /^tenant\/account-a\/workspace\/workspace-a\/project\//u);
  assert.ok(!keyA.includes("portrait.png"));
  expectCode("INVALID_ARTIFACT_ID", () =>
    deriveArtifactObjectKey({ ...identity(scopeA), artifactId: "../../foreign" }),
  );
});

test("exact upload ports reject forged scope, method, path, type, length, hash, replay, and expiry", () => {
  const plane = new FakeR2ArtifactPlane(new Uint8Array(32).fill(7));
  const port = plane.reserveUpload(identity(scopeA, "exact"), options());
  expectCode("ARTIFACT_NOT_FOUND", () =>
    plane.upload({ ...port, capability_handle: "00".repeat(32) }, uploadRequest(port)),
  );
  expectCode("ARTIFACT_NOT_FOUND", () =>
    plane.upload({ ...port, method: "GET" }, uploadRequest(port)),
  );
  expectCode("ARTIFACT_NOT_FOUND", () =>
    plane.upload({ ...port, content_type: "text/plain" }, uploadRequest(port)),
  );
  expectCode("PORT_SCOPE_MISMATCH", () =>
    plane.upload(
      port,
      uploadRequest(port, bytes, { path: port.path.replace("account-a", "account-b") }),
    ),
  );

  const expired = plane.reserveUpload(identity(scopeA, "expired"), options());
  expectCode("PORT_EXPIRED", () =>
    plane.upload(expired, uploadRequest(expired, bytes, { now: LATER })),
  );

  const wrongLength = plane.reserveUpload(identity(scopeA, "length"), options());
  expectCode("LENGTH_MISMATCH", () =>
    plane.upload(wrongLength, uploadRequest(wrongLength, bytes.subarray(1))),
  );

  const wrongHash = plane.reserveUpload(identity(scopeA, "hash"), options());
  expectCode("HASH_MISMATCH", () =>
    plane.upload(wrongHash, uploadRequest(wrongHash, new Uint8Array(bytes.byteLength))),
  );

  const replay = plane.reserveUpload(identity(scopeA, "replay"), options());
  plane.upload(replay, uploadRequest(replay));
  expectCode("PORT_REPLAYED", () => plane.upload(replay, uploadRequest(replay)));
});

test("partial uploads never commit; expired uncommitted objects are cleaned after a crash", () => {
  const plane = new FakeR2ArtifactPlane(new Uint8Array(32).fill(8));
  const partial = plane.reserveUpload(identity(scopeA, "partial"), options());
  expectCode("LENGTH_MISMATCH", () =>
    plane.upload(partial, uploadRequest(partial, bytes.subarray(0, 4))),
  );

  const crashed = plane.reserveUpload(identity(scopeA, "crash"), options());
  plane.upload(crashed, uploadRequest(crashed));
  assert.equal(plane.cleanupOrphans(LATER), 1);
  expectCode("STALE_RECEIPT", () =>
    plane.commitUpload(scopeA, crashed.reservation_id, "callback-crash", {}, LATER),
  );
});

test("commit receipts are durable and idempotent for one callback but reject stale duplicates", () => {
  const plane = new FakeR2ArtifactPlane(new Uint8Array(32).fill(9));
  const port = plane.reserveUpload(identity(scopeA, "receipt"), options());
  plane.upload(port, uploadRequest(port));
  const receipt = plane.commitUpload(
    scopeA,
    port.reservation_id,
    "callback-1",
    { width: 1280, height: 720, decoded: true },
    NOW,
  );
  assert.equal(plane.commitUpload(scopeA, port.reservation_id, "callback-1", {}, NOW), receipt);
  expectCode("DUPLICATE_CALLBACK", () =>
    plane.commitUpload(scopeA, port.reservation_id, "callback-2", {}, NOW),
  );
  expectCode("ARTIFACT_NOT_FOUND", () =>
    plane.commitUpload(scopeB, port.reservation_id, "callback-1", {}, NOW),
  );
  assert.match(receipt.receipt_sha256, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(receipt.retention_class, "PROJECT");
  assert.equal(validateContract("artifactTransferPortV3", port).success, true);
  assert.equal(validateContract("artifactCommitReceiptV3", receipt).success, true);
});

test("an accepted immutable object cannot be replaced by a later reservation", () => {
  const plane = new FakeR2ArtifactPlane(new Uint8Array(32).fill(12));
  const first = plane.reserveUpload(identity(scopeA, "immutable"), options());
  plane.upload(first, uploadRequest(first));
  plane.commitUpload(scopeA, first.reservation_id, "callback-immutable", {}, NOW);
  const replacementBytes = new TextEncoder().encode("replacement bytes are forbidden");
  const replacementHash = `sha256:${createHash("sha256").update(replacementBytes).digest("hex")}`;
  const replacement = plane.reserveUpload(
    identity(scopeA, "immutable"),
    options({
      contentLength: replacementBytes.byteLength,
      checksumSha256: replacementHash,
      now: new Date(NOW.getTime() + 1_000),
    }),
  );
  expectCode("ARTIFACT_ALREADY_EXISTS", () =>
    plane.upload(
      replacement,
      uploadRequest(replacement, replacementBytes, { now: new Date(NOW.getTime() + 1_000) }),
    ),
  );
});

test("two concurrent tenants with identical logical names cannot read, delete, copy, move, list, or dedup-discover", () => {
  const plane = new FakeR2ArtifactPlane(new Uint8Array(32).fill(10));
  const portA = plane.reserveUpload(identity(scopeA, "concurrent"), options());
  const portB = plane.reserveUpload(identity(scopeB, "concurrent"), options());
  plane.upload(portA, uploadRequest(portA));
  plane.upload(portB, uploadRequest(portB));
  plane.commitUpload(scopeA, portA.reservation_id, "callback-a", {}, NOW);
  plane.commitUpload(scopeB, portB.reservation_id, "callback-b", {}, NOW);

  const downloadA = plane.reserveDownload(identity(scopeA, "concurrent"), options({ maxUses: 2 }));
  assert.deepEqual(
    plane.download(downloadA, {
      path: downloadA.path,
      contentType: downloadA.content_type,
      contentLength: downloadA.content_length,
      checksumSha256: downloadA.checksum_sha256,
      now: NOW,
    }),
    bytes,
  );
  expectCode("ARTIFACT_NOT_FOUND", () =>
    plane.reserveDownload(
      { ...identity(scopeA, "only-account-a"), scope: scopeB },
      options({ maxUses: 2 }),
    ),
  );
  assert.equal("list" in plane, false);
  assert.equal("copy" in plane, false);
  assert.equal("move" in plane, false);
  assert.equal("findByHash" in plane, false);
});

test("deletion is owner-scoped and retention-bound", () => {
  const plane = new FakeR2ArtifactPlane(new Uint8Array(32).fill(11));
  const upload = plane.reserveUpload(
    identity(scopeA, "retained"),
    options({ retainUntil: LATER.toISOString() }),
  );
  plane.upload(upload, uploadRequest(upload));
  plane.commitUpload(scopeA, upload.reservation_id, "callback-retained", {}, NOW);
  const deletion = plane.reserveDelete(
    identity(scopeA, "retained"),
    options({ retainUntil: LATER.toISOString() }),
  );
  expectCode("RETENTION_ACTIVE", () =>
    plane.delete(scopeA, deletion, {
      path: deletion.path,
      contentType: deletion.content_type,
      contentLength: deletion.content_length,
      checksumSha256: deletion.checksum_sha256,
      now: NOW,
    }),
  );

  const legalHoldUpload = plane.reserveUpload(
    identity(scopeA, "legal-hold"),
    options({ retentionClass: "LEGAL_HOLD" }),
  );
  plane.upload(legalHoldUpload, uploadRequest(legalHoldUpload));
  plane.commitUpload(scopeA, legalHoldUpload.reservation_id, "callback-legal-hold", {}, NOW);
  const legalHoldDeletion = plane.reserveDelete(
    identity(scopeA, "legal-hold"),
    options({ retentionClass: "LEGAL_HOLD" }),
  );
  expectCode("RETENTION_ACTIVE", () =>
    plane.delete(scopeA, legalHoldDeletion, {
      path: legalHoldDeletion.path,
      contentType: legalHoldDeletion.content_type,
      contentLength: legalHoldDeletion.content_length,
      checksumSha256: legalHoldDeletion.checksum_sha256,
      now: NOW,
    }),
  );
});

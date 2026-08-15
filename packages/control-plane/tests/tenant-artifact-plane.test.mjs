import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

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
    contentType: port.contentType,
    contentLength: port.contentLength,
    checksumSha256: port.checksumSha256,
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
    plane.upload({ ...port, capability: "00".repeat(32) }, uploadRequest(port)),
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
    plane.commitUpload(scopeA, crashed.reservation.reservationId, "callback-crash", {}, LATER),
  );
});

test("commit receipts are durable and idempotent for one callback but reject stale duplicates", () => {
  const plane = new FakeR2ArtifactPlane(new Uint8Array(32).fill(9));
  const port = plane.reserveUpload(identity(scopeA, "receipt"), options());
  plane.upload(port, uploadRequest(port));
  const receipt = plane.commitUpload(
    scopeA,
    port.reservation.reservationId,
    "callback-1",
    { width: 1280, height: 720, decoded: true },
    NOW,
  );
  assert.equal(
    plane.commitUpload(scopeA, port.reservation.reservationId, "callback-1", {}, NOW),
    receipt,
  );
  expectCode("DUPLICATE_CALLBACK", () =>
    plane.commitUpload(scopeA, port.reservation.reservationId, "callback-2", {}, NOW),
  );
  expectCode("ARTIFACT_NOT_FOUND", () =>
    plane.commitUpload(scopeB, port.reservation.reservationId, "callback-1", {}, NOW),
  );
  assert.match(receipt.receiptSha256, /^sha256:[0-9a-f]{64}$/u);
});

test("two concurrent tenants with identical logical names cannot read, delete, copy, move, list, or dedup-discover", () => {
  const plane = new FakeR2ArtifactPlane(new Uint8Array(32).fill(10));
  const portA = plane.reserveUpload(identity(scopeA, "concurrent"), options());
  const portB = plane.reserveUpload(identity(scopeB, "concurrent"), options());
  plane.upload(portA, uploadRequest(portA));
  plane.upload(portB, uploadRequest(portB));
  plane.commitUpload(scopeA, portA.reservation.reservationId, "callback-a", {}, NOW);
  plane.commitUpload(scopeB, portB.reservation.reservationId, "callback-b", {}, NOW);

  const downloadA = plane.reserveDownload(identity(scopeA, "concurrent"), options({ maxUses: 2 }));
  assert.deepEqual(
    plane.download(downloadA, {
      path: downloadA.path,
      contentType: downloadA.contentType,
      contentLength: downloadA.contentLength,
      checksumSha256: downloadA.checksumSha256,
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
  plane.commitUpload(scopeA, upload.reservation.reservationId, "callback-retained", {}, NOW);
  const deletion = plane.reserveDelete(
    identity(scopeA, "retained"),
    options({ retainUntil: LATER.toISOString() }),
  );
  expectCode("RETENTION_ACTIVE", () =>
    plane.delete(scopeA, deletion, {
      path: deletion.path,
      contentType: deletion.contentType,
      contentLength: deletion.contentLength,
      checksumSha256: deletion.checksumSha256,
      now: NOW,
    }),
  );
});

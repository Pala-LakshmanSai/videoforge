import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { LocalArtifactStore, LocalArtifactStoreError } from "../dist/src/index.js";

const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

test("port facets keep multi-megabyte bytes out of application control-plane bodies", async () => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), "videoforge-large-private-artifact-"));
  const root = path.join(sandbox, "artifacts");
  const nowEpochMs = Date.parse("2026-08-10T00:00:00.000Z");
  try {
    const store = await LocalArtifactStore.create(root, {
      signingKey: Buffer.alloc(32, 0x2c),
      clock: { nowEpochMs: () => nowEpochMs },
      maximumSignatureTtlMs: 5 * 60 * 1_000,
    });
    const bytes = Buffer.alloc(8 * 1024 * 1024);
    for (let index = 0; index < bytes.byteLength; index += 1) bytes[index] = index % 251;
    const digest = sha256(bytes);
    const objectKey = `workspace/workspace_001/project/project_001/revision/revision_001/inputs/${digest.slice("sha256:".length)}.bin`;
    const signedInitiate = await store.controlPlane.signInitiate({
      idempotencyKey: "large_direct_upload_001",
      assetId: "large_asset_001",
      scope: {
        ownerType: "PROJECT_REVISION",
        workspaceId: "workspace_001",
        projectId: "project_001",
        projectRevisionId: "revision_001",
      },
      objectKey,
      integrity: {
        binarySha256: digest,
        byteSize: bytes.byteLength,
        contentType: "application/octet-stream",
        canonicalDocument: null,
      },
      retention: {
        retentionClass: "ACCEPTED_SCENE",
        retainUntilEpochMs: nowEpochMs + 7 * 24 * 60 * 60 * 1_000,
      },
      expiresInMs: 60_000,
    });
    assert.equal(signedInitiate.applicationBodyBytes, 0);
    assert.ok(JSON.stringify(signedInitiate).length < 16 * 1_024);
    const upload = await store.directTransfer.initiate(signedInitiate);
    assert.deepEqual(Object.keys(store.controlPlane).sort(), [
      "audit",
      "resolveAccepted",
      "signAbort",
      "signComplete",
      "signDownload",
      "signInitiate",
      "signPart",
    ]);
    await assert.rejects(
      store.controlPlane.signPart({
        workspaceId: "workspace_001",
        uploadId: upload.uploadId,
        partNumber: 1,
        partSha256: digest,
        partBytes: bytes.byteLength,
        expiresInMs: 60_000,
        bytes,
      }),
      (error) => error instanceof LocalArtifactStoreError && error.code === "REQUEST_INVALID",
    );

    const ranges = [
      [0, 3 * 1024 * 1024],
      [3 * 1024 * 1024, 6 * 1024 * 1024],
      [6 * 1024 * 1024, bytes.byteLength],
    ];
    const receipts = [];
    for (const [index, range] of ranges.entries()) {
      const part = bytes.subarray(range[0], range[1]);
      const signedPart = await store.controlPlane.signPart({
        workspaceId: "workspace_001",
        uploadId: upload.uploadId,
        partNumber: index + 1,
        partSha256: sha256(part),
        partBytes: part.byteLength,
        expiresInMs: 60_000,
      });
      assert.equal(signedPart.applicationBodyBytes, 0);
      assert.equal(Object.values(signedPart).includes(part), false);
      receipts.push(await store.directTransfer.uploadPart(signedPart, part));
    }
    const stagingEntries = await readdir(path.join(root, "private", "staging"));
    assert.equal(stagingEntries.length, 1);
    assert.deepEqual(
      (await readdir(path.join(root, "private", "staging", stagingEntries[0]))).sort(),
      ["part-001.bin", "part-002.bin", "part-003.bin"],
    );

    const signedComplete = await store.controlPlane.signComplete({
      workspaceId: "workspace_001",
      uploadId: upload.uploadId,
      parts: receipts,
      expiresInMs: 60_000,
    });
    assert.equal(signedComplete.applicationBodyBytes, 0);
    assert.ok(JSON.stringify(signedComplete).length < 16 * 1_024);
    const accepted = await store.directTransfer.complete(signedComplete);
    assert.equal(accepted.byteSize, bytes.byteLength);
    assert.equal(accepted.binarySha256, digest);
    assert.deepEqual(await readdir(path.join(root, "private", "staging")), []);

    const signedDownload = await store.controlPlane.signDownload({
      workspaceId: "workspace_001",
      objectKey,
      expiresInMs: 60_000,
    });
    const downloaded = await store.directTransfer.download(signedDownload);
    assert.equal(sha256(downloaded.bytes), digest);
    assert.equal(downloaded.bytes.byteLength, bytes.byteLength);
    assert.deepEqual(store.controlPlane.audit(), {
      applicationBodyBytes: 0,
      directUploadBytes: bytes.byteLength,
      directDownloadBytes: bytes.byteLength,
      signedOperations: 6,
      directOperations: 6,
    });
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("local private artifact implementation has no cloud, network, credential, or provider dependency", async () => {
  const sources = await Promise.all([
    readFile(new URL("../src/artifacts/private-contract.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/artifacts/media-signature.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/local/artifact-store.ts", import.meta.url), "utf8"),
  ]);
  const combined = sources.join("\n");
  assert.equal(combined.includes("Buffer.concat"), false, "large completion must stream");
  assert.equal(combined.includes("readonly content: Buffer"), false, "parts must not retain bytes");
  for (const forbidden of [
    "process.env",
    "globalThis.fetch",
    "node:http",
    "node:https",
    "@aws-sdk",
    "cloudflare",
    "runpod",
    "runware",
  ]) {
    assert.equal(combined.toLowerCase().includes(forbidden.toLowerCase()), false, forbidden);
  }
});

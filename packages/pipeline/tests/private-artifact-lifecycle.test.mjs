import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { LocalArtifactStore, LocalArtifactStoreError } from "../dist/src/index.js";

const DAY_MS = 24 * 60 * 60 * 1_000;
const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

async function withSignedStore(run) {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), "videoforge-private-artifact-"));
  const root = path.join(sandbox, "artifacts");
  const clock = { now: Date.parse("2026-08-10T00:00:00.000Z"), nowEpochMs: () => clock.now };
  const signingOptions = {
    signingKey: Buffer.alloc(32, 0x4a),
    clock,
    maximumSignatureTtlMs: 5 * 60 * 1_000,
  };
  try {
    const store = await LocalArtifactStore.create(root, signingOptions);
    await run({ store, root, clock, signingOptions });
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
}

function projectIntent(bytes, nowEpochMs, overrides = {}) {
  const binarySha256 = sha256(bytes);
  const binaryHex = binarySha256.slice("sha256:".length);
  return {
    idempotencyKey: "upload_voiceover_001",
    assetId: "asset_voiceover_001",
    scope: {
      ownerType: "PROJECT_REVISION",
      workspaceId: "workspace_001",
      projectId: "project_001",
      projectRevisionId: "revision_001",
    },
    objectKey: `workspace/workspace_001/project/project_001/revision/revision_001/inputs/${binaryHex}.bin`,
    integrity: {
      binarySha256,
      byteSize: bytes.byteLength,
      contentType: "application/octet-stream",
      canonicalDocument: {
        contractName: "voiceover-binding",
        contractVersion: "v1",
        canonicalDocumentSha256: sha256(Buffer.from("canonical metadata", "utf8")),
      },
    },
    retention: {
      retentionClass: "ACCEPTED_SCENE",
      retainUntilEpochMs: nowEpochMs + 10 * DAY_MS,
    },
    expiresInMs: 60_000,
    ...overrides,
  };
}

async function uploadPart(store, uploadId, workspaceId, partNumber, bytes) {
  const operation = await store.controlPlane.signPart({
    workspaceId,
    uploadId,
    partNumber,
    partSha256: sha256(bytes),
    partBytes: bytes.byteLength,
    expiresInMs: 60_000,
  });
  return {
    operation,
    receipt: await store.directTransfer.uploadPart(operation, bytes),
  };
}

async function durableIdempotencyBindingFiles(root) {
  const bindingRoot = path.join(root, "private", "idempotency");
  const files = [];
  for (const prefix of await readdir(bindingRoot, { withFileTypes: true })) {
    if (!prefix.isDirectory()) continue;
    for (const entry of await readdir(path.join(bindingRoot, prefix.name), {
      withFileTypes: true,
    })) {
      if (entry.isFile() && entry.name.endsWith(".json")) {
        files.push(path.join(prefix.name, entry.name));
      }
    }
  }
  return files.sort();
}

test("signed multipart lifecycle is deterministic, immutable, and idempotent through download", async () => {
  await withSignedStore(async ({ store, root, clock }) => {
    const bytes = Buffer.from("deterministic voiceover bytes for a private upload", "utf8");
    const firstPart = bytes.subarray(0, 19);
    const secondPart = bytes.subarray(19);
    const intent = projectIntent(bytes, clock.now);

    const firstInitiate = await store.controlPlane.signInitiate(intent);
    const repeatedSignature = await store.controlPlane.signInitiate(intent);
    assert.deepEqual(repeatedSignature, firstInitiate);
    assert.equal(firstInitiate.applicationBodyBytes, 0);
    assert.equal("bytes" in firstInitiate, false);

    const initiated = await store.directTransfer.initiate(firstInitiate);
    assert.equal(initiated.state, "UPLOADING");
    assert.equal(initiated.replayed, false);
    assert.equal((await store.directTransfer.initiate(firstInitiate)).replayed, true);

    const partOne = await uploadPart(
      store,
      initiated.uploadId,
      intent.scope.workspaceId,
      1,
      firstPart,
    );
    const repeatedPart = await store.directTransfer.uploadPart(partOne.operation, firstPart);
    assert.equal(partOne.receipt.replayed, false);
    assert.equal(repeatedPart.replayed, true);
    assert.match(partOne.receipt.etag, /^etag_[A-Za-z0-9_-]{43}$/u);
    assert.notEqual(partOne.receipt.etag, partOne.receipt.partSha256);
    const partTwo = await uploadPart(
      store,
      initiated.uploadId,
      intent.scope.workspaceId,
      2,
      secondPart,
    );
    const activeStaging = await readdir(path.join(root, "private", "staging"));
    assert.equal(activeStaging.length, 1);
    assert.deepEqual(
      (await readdir(path.join(root, "private", "staging", activeStaging[0]))).sort(),
      ["part-001.bin", "part-002.bin"],
    );

    const completeOperation = await store.controlPlane.signComplete({
      workspaceId: intent.scope.workspaceId,
      uploadId: initiated.uploadId,
      parts: [partOne.receipt, partTwo.receipt],
      expiresInMs: 60_000,
    });
    const accepted = await store.directTransfer.complete(completeOperation);
    assert.equal(accepted.replayed, false);
    assert.equal(accepted.binarySha256, intent.integrity.binarySha256);
    assert.notEqual(
      accepted.binarySha256,
      accepted.canonicalDocument.canonicalDocumentSha256,
      "binary and canonical-document addresses must remain distinct",
    );
    assert.equal(accepted.storageUri, `vf-local-private:///${intent.objectKey}`);
    assert.deepEqual(await readdir(path.join(root, "private", "staging")), []);
    const repeatedComplete = await store.directTransfer.complete(completeOperation);
    assert.equal(repeatedComplete.replayed, true);
    assert.equal(repeatedComplete.acceptedAtEpochMs, accepted.acceptedAtEpochMs);
    assert.deepEqual(
      await store.controlPlane.resolveAccepted(intent.scope.workspaceId, intent.objectKey),
      accepted,
    );

    const downloadOperation = await store.controlPlane.signDownload({
      workspaceId: intent.scope.workspaceId,
      objectKey: intent.objectKey,
      expiresInMs: 60_000,
    });
    const firstDownload = await store.directTransfer.download(downloadOperation);
    const repeatedDownload = await store.directTransfer.download(downloadOperation);
    assert.deepEqual(Buffer.from(firstDownload.bytes), bytes);
    assert.deepEqual(Buffer.from(repeatedDownload.bytes), bytes);
    assert.equal(firstDownload.artifact.binarySha256, accepted.binarySha256);

    await assert.rejects(
      store.readObject(intent.integrity.binarySha256, "bin"),
      errorCode("NOT_FOUND"),
    );
    await store.putObject(bytes, "bin");
    const legacyRead = await store.readObject(intent.integrity.binarySha256, "bin");
    assert.deepEqual(
      Buffer.from(legacyRead.content),
      bytes,
      "legacy filesystem media slice remains live",
    );

    assert.deepEqual(store.controlPlane.audit(), {
      applicationBodyBytes: 0,
      directUploadBytes: bytes.byteLength,
      directDownloadBytes: bytes.byteLength * 2,
      signedOperations: 6,
      directOperations: 9,
    });
  });
});

test("abort is idempotent and permanently closes its multipart upload", async () => {
  await withSignedStore(async ({ store, root, clock }) => {
    const bytes = Buffer.from("upload that will be aborted", "utf8");
    const intent = projectIntent(bytes, clock.now);
    const initiation = await store.controlPlane.signInitiate(intent);
    const upload = await store.directTransfer.initiate(initiation);
    const part = await uploadPart(store, upload.uploadId, intent.scope.workspaceId, 1, bytes);
    const signedAbort = await store.controlPlane.signAbort({
      workspaceId: intent.scope.workspaceId,
      uploadId: upload.uploadId,
      expiresInMs: 60_000,
    });

    assert.deepEqual(await store.directTransfer.abort(signedAbort), {
      uploadId: upload.uploadId,
      workspaceId: intent.scope.workspaceId,
      objectKey: intent.objectKey,
      state: "ABORTED",
      replayed: false,
    });
    assert.deepEqual(await readdir(path.join(root, "private", "staging")), []);
    assert.equal((await store.directTransfer.abort(signedAbort)).replayed, true);
    const refreshedAbort = await store.controlPlane.signAbort({
      workspaceId: intent.scope.workspaceId,
      uploadId: upload.uploadId,
      expiresInMs: 60_000,
    });
    assert.equal((await store.directTransfer.abort(refreshedAbort)).replayed, true);

    await assert.rejects(
      store.directTransfer.uploadPart(part.operation, bytes),
      errorCode("UPLOAD_STATE_CONFLICT"),
    );
    await assert.rejects(
      store.controlPlane.signComplete({
        workspaceId: intent.scope.workspaceId,
        uploadId: upload.uploadId,
        parts: [part.receipt],
        expiresInMs: 60_000,
      }),
      errorCode("UPLOAD_STATE_CONFLICT"),
    );
    assert.equal(
      await store.controlPlane.resolveAccepted(intent.scope.workspaceId, intent.objectKey),
      null,
    );
  });
});

test("an idempotency key cannot be rebound to different immutable upload metadata", async () => {
  await withSignedStore(async ({ store, clock }) => {
    const firstBytes = Buffer.from("first immutable body", "utf8");
    const secondBytes = Buffer.from("second immutable body", "utf8");
    const first = projectIntent(firstBytes, clock.now);
    const second = projectIntent(secondBytes, clock.now);
    await store.directTransfer.initiate(await store.controlPlane.signInitiate(first));

    await assert.rejects(
      store.directTransfer.initiate(await store.controlPlane.signInitiate(second)),
      errorCode("IDEMPOTENCY_CONFLICT"),
    );
  });
});

test("atomic private acceptance converges across stores and survives a verified reopen", async () => {
  await withSignedStore(async ({ store: firstStore, root, clock, signingOptions }) => {
    const secondStore = await LocalArtifactStore.create(root, signingOptions);
    const bytes = Buffer.from("durable exact private bytes", "utf8");
    const intent = projectIntent(bytes, clock.now, {
      idempotencyKey: "durable_acceptance_001",
      assetId: "durable_asset_001",
    });

    async function prepare(store) {
      const upload = await store.directTransfer.initiate(
        await store.controlPlane.signInitiate(intent),
      );
      const part = await uploadPart(store, upload.uploadId, intent.scope.workspaceId, 1, bytes);
      const completion = await store.controlPlane.signComplete({
        workspaceId: intent.scope.workspaceId,
        uploadId: upload.uploadId,
        parts: [part.receipt],
        expiresInMs: 60_000,
      });
      return { upload, part, completion };
    }

    const [first, second] = await Promise.all([prepare(firstStore), prepare(secondStore)]);
    const accepted = await Promise.all([
      firstStore.directTransfer.complete(first.completion),
      secondStore.directTransfer.complete(second.completion),
    ]);
    assert.deepEqual(
      accepted.map((entry) => entry.replayed).sort(),
      [false, true],
      "one atomic publisher wins and the exact concurrent acceptance replays",
    );
    assert.equal(accepted[0].binarySha256, accepted[1].binarySha256);
    assert.equal(accepted[0].acceptedAtEpochMs, accepted[1].acceptedAtEpochMs);
    assert.deepEqual(await readdir(path.join(root, "private", "staging")), []);

    const reopened = await LocalArtifactStore.create(root, signingOptions);
    const resolved = await reopened.controlPlane.resolveAccepted(
      intent.scope.workspaceId,
      intent.objectKey,
    );
    assert.equal(resolved?.binarySha256, intent.integrity.binarySha256);
    assert.equal(resolved?.acceptedAtEpochMs, accepted[0].acceptedAtEpochMs);
    const replayedUpload = await reopened.directTransfer.initiate(
      await reopened.controlPlane.signInitiate(intent),
    );
    assert.equal(replayedUpload.state, "COMPLETED");
    assert.equal(replayedUpload.replayed, true);
    const replayedCompletion = await reopened.controlPlane.signComplete({
      workspaceId: intent.scope.workspaceId,
      uploadId: replayedUpload.uploadId,
      parts: [first.part.receipt],
      expiresInMs: 60_000,
    });
    assert.equal((await reopened.directTransfer.complete(replayedCompletion)).replayed, true);
    const download = await reopened.directTransfer.download(
      await reopened.controlPlane.signDownload({
        workspaceId: intent.scope.workspaceId,
        objectKey: intent.objectKey,
        expiresInMs: 60_000,
      }),
    );
    assert.deepEqual(Buffer.from(download.bytes), bytes);
    await assert.rejects(
      reopened.readObject(intent.integrity.binarySha256, "bin"),
      errorCode("NOT_FOUND"),
    );

    const reboundBytes = Buffer.from("different durable body", "utf8");
    const reboundIntent = projectIntent(reboundBytes, clock.now, {
      idempotencyKey: intent.idempotencyKey,
      assetId: "different_durable_asset",
    });
    await assert.rejects(
      reopened.directTransfer.initiate(await reopened.controlPlane.signInitiate(reboundIntent)),
      errorCode("IDEMPOTENCY_CONFLICT"),
    );

    const conflicting = {
      ...intent,
      idempotencyKey: "durable_acceptance_conflict",
      assetId: "different_asset_metadata",
    };
    await assert.rejects(
      reopened.directTransfer.initiate(await reopened.controlPlane.signInitiate(conflicting)),
      errorCode("IMMUTABLE_COLLISION"),
    );
  });
});

test("one durable idempotency binding wins across stores with different object keys", async () => {
  await withSignedStore(async ({ store: firstStore, root, clock, signingOptions }) => {
    const secondStore = await LocalArtifactStore.create(root, signingOptions);
    const firstBytes = Buffer.from("cross-store idempotency winner one", "utf8");
    const secondBytes = Buffer.from("cross-store idempotency winner two", "utf8");
    const sharedKey = "durable_cross_store_key_001";
    const firstIntent = projectIntent(firstBytes, clock.now, {
      idempotencyKey: sharedKey,
      assetId: "cross_store_asset_one",
    });
    const secondIntent = projectIntent(secondBytes, clock.now, {
      idempotencyKey: sharedKey,
      assetId: "cross_store_asset_two",
    });

    async function prepare(store, intent, bytes) {
      const upload = await store.directTransfer.initiate(
        await store.controlPlane.signInitiate(intent),
      );
      const part = await uploadPart(store, upload.uploadId, intent.scope.workspaceId, 1, bytes);
      return {
        upload,
        completion: await store.controlPlane.signComplete({
          workspaceId: intent.scope.workspaceId,
          uploadId: upload.uploadId,
          parts: [part.receipt],
          expiresInMs: 60_000,
        }),
      };
    }

    const [first, second] = await Promise.all([
      prepare(firstStore, firstIntent, firstBytes),
      prepare(secondStore, secondIntent, secondBytes),
    ]);
    const results = await Promise.allSettled([
      firstStore.directTransfer.complete(first.completion),
      secondStore.directTransfer.complete(second.completion),
    ]);
    const accepted = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    assert.equal(accepted.length, 1);
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].reason instanceof LocalArtifactStoreError, true);
    assert.equal(rejected[0].reason.code, "IDEMPOTENCY_CONFLICT");
    const bindingFiles = await durableIdempotencyBindingFiles(root);
    assert.equal(bindingFiles.length, 1);
    assert.match(bindingFiles[0], /^[0-9a-f]{2}\/[0-9a-f]{64}\.json$/u);
    assert.deepEqual(await readdir(path.join(root, "private", "staging")), []);

    const winner = accepted[0].value;
    const winnerIntent = winner.objectKey === firstIntent.objectKey ? firstIntent : secondIntent;
    const loserIntent = winnerIntent === firstIntent ? secondIntent : firstIntent;
    const reopened = await LocalArtifactStore.create(root, signingOptions);
    const replay = await reopened.directTransfer.initiate(
      await reopened.controlPlane.signInitiate(winnerIntent),
    );
    assert.equal(replay.state, "COMPLETED");
    assert.equal(replay.replayed, true);
    await assert.rejects(
      reopened.directTransfer.initiate(await reopened.controlPlane.signInitiate(loserIntent)),
      errorCode("IDEMPOTENCY_CONFLICT"),
    );

    const abortedBytes = Buffer.from("aborted intent does not bind durably", "utf8");
    const abortedIntent = projectIntent(abortedBytes, clock.now, {
      idempotencyKey: "durable_aborted_key_001",
      assetId: "durable_aborted_asset_001",
    });
    const abortedUpload = await reopened.directTransfer.initiate(
      await reopened.controlPlane.signInitiate(abortedIntent),
    );
    await reopened.directTransfer.abort(
      await reopened.controlPlane.signAbort({
        workspaceId: abortedIntent.scope.workspaceId,
        uploadId: abortedUpload.uploadId,
        expiresInMs: 60_000,
      }),
    );
    assert.equal((await durableIdempotencyBindingFiles(root)).length, 1);

    const afterAbort = await LocalArtifactStore.create(root, signingOptions);
    const replacementBytes = Buffer.from("replacement after durable abort", "utf8");
    const replacementIntent = projectIntent(replacementBytes, clock.now, {
      idempotencyKey: abortedIntent.idempotencyKey,
      assetId: "durable_replacement_asset_001",
    });
    const replacement = await afterAbort.directTransfer.initiate(
      await afterAbort.controlPlane.signInitiate(replacementIntent),
    );
    assert.equal(replacement.state, "UPLOADING");
    await afterAbort.directTransfer.abort(
      await afterAbort.controlPlane.signAbort({
        workspaceId: replacementIntent.scope.workspaceId,
        uploadId: replacement.uploadId,
        expiresInMs: 60_000,
      }),
    );

    const invalidJson = Buffer.from("{not-json", "utf8");
    const failedBase = projectIntent(invalidJson, clock.now, {
      idempotencyKey: "durable_failed_key_001",
      assetId: "durable_failed_asset_001",
    });
    const failedIntent = {
      ...failedBase,
      objectKey: failedBase.objectKey.replace(/\.bin$/u, ".json"),
      integrity: { ...failedBase.integrity, contentType: "application/json" },
    };
    const failedUpload = await afterAbort.directTransfer.initiate(
      await afterAbort.controlPlane.signInitiate(failedIntent),
    );
    const failedPart = await uploadPart(
      afterAbort,
      failedUpload.uploadId,
      failedIntent.scope.workspaceId,
      1,
      invalidJson,
    );
    await assert.rejects(
      afterAbort.directTransfer.complete(
        await afterAbort.controlPlane.signComplete({
          workspaceId: failedIntent.scope.workspaceId,
          uploadId: failedUpload.uploadId,
          parts: [failedPart.receipt],
          expiresInMs: 60_000,
        }),
      ),
      errorCode("MEDIA_SIGNATURE_INVALID"),
    );
    assert.equal((await durableIdempotencyBindingFiles(root)).length, 1);

    const afterFailure = await LocalArtifactStore.create(root, signingOptions);
    const validJson = Buffer.from('{"replacement":true}', "utf8");
    const replacementBase = projectIntent(validJson, clock.now, {
      idempotencyKey: failedIntent.idempotencyKey,
      assetId: "durable_failed_replacement_asset_001",
    });
    const failedReplacementIntent = {
      ...replacementBase,
      objectKey: replacementBase.objectKey.replace(/\.bin$/u, ".json"),
      integrity: { ...replacementBase.integrity, contentType: "application/json" },
    };
    const afterFailureUpload = await afterFailure.directTransfer.initiate(
      await afterFailure.controlPlane.signInitiate(failedReplacementIntent),
    );
    assert.equal(afterFailureUpload.state, "UPLOADING");
    await afterFailure.directTransfer.abort(
      await afterFailure.controlPlane.signAbort({
        workspaceId: failedReplacementIntent.scope.workspaceId,
        uploadId: afterFailureUpload.uploadId,
        expiresInMs: 60_000,
      }),
    );
    assert.deepEqual(await readdir(path.join(root, "private", "staging")), []);
  });
});

const errorCode = (code) => (error) =>
  error instanceof LocalArtifactStoreError && error.code === code;

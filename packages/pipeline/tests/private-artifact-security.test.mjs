import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { LocalArtifactStore, LocalArtifactStoreError } from "../dist/src/index.js";

const DAY_MS = 24 * 60 * 60 * 1_000;
const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const errorCode =
  (...codes) =>
  (error) =>
    error instanceof LocalArtifactStoreError && codes.includes(error.code);

async function withStore(run, options = {}) {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), "videoforge-artifact-security-"));
  const root = path.join(sandbox, "artifacts");
  const clock = { now: Date.parse("2026-08-10T00:00:00.000Z"), nowEpochMs: () => clock.now };
  try {
    const store = await LocalArtifactStore.create(root, {
      signingKey: Buffer.alloc(32, 0x73),
      clock,
      maximumSignatureTtlMs: options.maximumSignatureTtlMs ?? 5 * 60 * 1_000,
    });
    await run({ store, root, clock });
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
}

function projectIntent(bytes, nowEpochMs, overrides = {}) {
  const binarySha256 = sha256(bytes);
  const hex = binarySha256.slice("sha256:".length);
  return {
    idempotencyKey: "upload_security_001",
    assetId: "asset_security_001",
    scope: {
      ownerType: "PROJECT_REVISION",
      workspaceId: "workspace_001",
      projectId: "project_001",
      projectRevisionId: "revision_001",
    },
    objectKey: `workspace/workspace_001/project/project_001/revision/revision_001/inputs/${hex}.bin`,
    integrity: {
      binarySha256,
      byteSize: bytes.byteLength,
      contentType: "application/octet-stream",
      canonicalDocument: null,
    },
    retention: {
      retentionClass: "ACCEPTED_SCENE",
      retainUntilEpochMs: nowEpochMs + 10 * DAY_MS,
    },
    expiresInMs: 60_000,
    ...overrides,
  };
}

async function initiate(store, intent) {
  const signed = await store.controlPlane.signInitiate(intent);
  return { signed, upload: await store.directTransfer.initiate(signed) };
}

async function uploadSinglePart(store, workspaceId, uploadId, bytes) {
  const signed = await store.controlPlane.signPart({
    workspaceId,
    uploadId,
    partNumber: 1,
    partSha256: sha256(bytes),
    partBytes: bytes.byteLength,
    expiresInMs: 60_000,
  });
  return { signed, receipt: await store.directTransfer.uploadPart(signed, bytes) };
}

async function uploadPart(store, uploadId, workspaceId, partNumber, bytes) {
  const signed = await store.controlPlane.signPart({
    workspaceId,
    uploadId,
    partNumber,
    partSha256: sha256(bytes),
    partBytes: bytes.byteLength,
    expiresInMs: 60_000,
  });
  return store.directTransfer.uploadPart(signed, bytes);
}

async function completeSinglePart(store, intent, uploadId, receipt) {
  const signed = await store.controlPlane.signComplete({
    workspaceId: intent.scope.workspaceId,
    uploadId,
    parts: [receipt],
    expiresInMs: 60_000,
  });
  return { signed, artifact: await store.directTransfer.complete(signed) };
}

test("private operations fail closed without explicit valid signing configuration", async () => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), "videoforge-artifact-config-"));
  try {
    const root = path.join(sandbox, "artifacts");
    const legacyOnly = await LocalArtifactStore.create(root);
    const bytes = Buffer.from("legacy media remains available", "utf8");
    assert.equal((await legacyOnly.putObject(bytes, "bin")).sha256, sha256(bytes));
    await assert.rejects(
      legacyOnly.controlPlane.signInitiate(projectIntent(bytes, Date.now())),
      errorCode("SIGNING_NOT_CONFIGURED"),
    );

    await assert.rejects(
      LocalArtifactStore.create(path.join(sandbox, "short-key"), {
        signingKey: Buffer.alloc(31),
        clock: { nowEpochMs: () => 1 },
      }),
      errorCode("SIGNING_CONFIGURATION_INVALID"),
    );
    await assert.rejects(
      LocalArtifactStore.create(path.join(sandbox, "unsafe-ttl"), {
        signingKey: Buffer.alloc(32),
        clock: { nowEpochMs: () => 1 },
        maximumSignatureTtlMs: 15 * 60 * 1_000 + 1,
      }),
      errorCode("SIGNING_CONFIGURATION_INVALID"),
    );
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("owner prefix, traversal, checksum filename, content type, and retention validate before signing", async () => {
  await withStore(async ({ store, clock }) => {
    const bytes = Buffer.from("metadata-bound bytes", "utf8");
    const base = projectIntent(bytes, clock.now);
    const hex = base.integrity.binarySha256.slice("sha256:".length);
    const invalidIntents = [
      {
        expected: "OBJECT_KEY_INVALID",
        intent: { ...base, objectKey: base.objectKey.replace("/inputs/", "/inputs/../") },
      },
      {
        expected: "OBJECT_KEY_INVALID",
        intent: { ...base, objectKey: base.objectKey.replace("/inputs/", "/inputs/%2e%2e/") },
      },
      {
        expected: "SCOPE_MISMATCH",
        intent: {
          ...base,
          objectKey: base.objectKey.replace("workspace/workspace_001", "workspace/workspace_002"),
        },
      },
      {
        expected: "SCOPE_MISMATCH",
        intent: {
          ...base,
          objectKey: base.objectKey.replace("project/project_001", "project/project_002"),
        },
      },
      {
        expected: "SCOPE_MISMATCH",
        intent: {
          ...base,
          objectKey: base.objectKey.replace("revision/revision_001", "revision/revision_002"),
        },
      },
      {
        expected: "CONTENT_HASH_MISMATCH",
        intent: { ...base, objectKey: base.objectKey.replace(hex, "0".repeat(64)) },
      },
      {
        expected: "CONTENT_TYPE_MISMATCH",
        intent: { ...base, objectKey: base.objectKey.replace(/\.bin$/u, ".mp4") },
      },
      {
        expected: "CONTENT_TYPE_MISMATCH",
        intent: { ...base, integrity: { ...base.integrity, contentType: "text/plain" } },
      },
      {
        expected: "REQUEST_INVALID",
        intent: { ...base, integrity: { ...base.integrity, byteSize: 0 } },
      },
      {
        expected: "RETENTION_INVALID",
        intent: {
          ...base,
          retention: {
            retentionClass: "FAILED_TEMPORARY",
            retainUntilEpochMs: clock.now + DAY_MS + 1,
          },
        },
      },
      {
        expected: "RETENTION_INVALID",
        intent: {
          ...base,
          retention: {
            retentionClass: "WORKER_INTERMEDIATE",
            retainUntilEpochMs: clock.now + 8 * DAY_MS,
          },
        },
      },
      {
        expected: "RETENTION_INVALID",
        intent: {
          ...base,
          retention: {
            retentionClass: "FINAL_RENDER",
            retainUntilEpochMs: clock.now + 31 * DAY_MS,
          },
        },
      },
      {
        expected: "RETENTION_INVALID",
        intent: {
          ...base,
          retention: {
            retentionClass: "RETAIN_WHILE_REFERENCED",
            retainUntilEpochMs: clock.now + DAY_MS,
          },
        },
      },
    ];

    for (const { intent, expected } of invalidIntents) {
      await assert.rejects(store.controlPlane.signInitiate(intent), errorCode(expected));
    }
    assert.deepEqual(store.controlPlane.audit(), {
      applicationBodyBytes: 0,
      directUploadBytes: 0,
      directDownloadBytes: 0,
      signedOperations: 0,
      directOperations: 0,
    });
  });
});

test("all three locked owner layouts accept only their declared directory families", async () => {
  await withStore(async ({ store }) => {
    const fixtures = [
      {
        bytes: Buffer.from("project", "utf8"),
        scope: {
          ownerType: "PROJECT_REVISION",
          workspaceId: "workspace_001",
          projectId: "project_001",
          projectRevisionId: "revision_001",
        },
        prefix: "workspace/workspace_001/project/project_001/revision/revision_001/renders",
        extension: "mp4",
        contentType: "video/mp4",
      },
      {
        bytes: Buffer.from("style", "utf8"),
        scope: {
          ownerType: "IMAGE_STYLE_VERSION",
          workspaceId: "workspace_001",
          imageStyleId: "style_001",
          imageStyleVersionId: "style_version_001",
        },
        prefix:
          "workspace/workspace_001/image-style/style_001/version/style_version_001/references/original",
        extension: "png",
        contentType: "image/png",
      },
      {
        bytes: Buffer.from("avatar", "utf8"),
        scope: {
          ownerType: "AVATAR_PROFILE_VERSION",
          workspaceId: "workspace_001",
          avatarProfileId: "avatar_001",
          avatarProfileVersionId: "avatar_version_001",
        },
        prefix:
          "workspace/workspace_001/avatar-profile/avatar_001/version/avatar_version_001/source/runtime",
        extension: "webp",
        contentType: "image/webp",
      },
    ];

    for (const [index, fixture] of fixtures.entries()) {
      const digest = sha256(fixture.bytes);
      const signed = await store.controlPlane.signInitiate({
        idempotencyKey: `owner_layout_${index}`,
        assetId: `owner_asset_${index}`,
        scope: fixture.scope,
        objectKey: `${fixture.prefix}/${digest.slice("sha256:".length)}.${fixture.extension}`,
        integrity: {
          binarySha256: digest,
          byteSize: fixture.bytes.byteLength,
          contentType: fixture.contentType,
          canonicalDocument: null,
        },
        retention: { retentionClass: "RETAIN_WHILE_REFERENCED", retainUntilEpochMs: null },
        expiresInMs: 60_000,
      });
      assert.equal((await store.directTransfer.initiate(signed)).state, "UPLOADING");
    }
  });
});

test("tampered, cross-workspace, overlong, and expired signatures never reach transfer state", async () => {
  await withStore(async ({ store, clock }) => {
    const bytes = Buffer.from("signed transfer boundary", "utf8");
    const intent = projectIntent(bytes, clock.now, { expiresInMs: 1_000 });
    const signed = await store.controlPlane.signInitiate(intent);
    const tamperedDescriptor = {
      ...signed,
      objectKey: signed.objectKey.replace("workspace_001", "workspace_002"),
    };
    const tamperedToken = {
      ...signed,
      token: `${signed.token.slice(0, -1)}${signed.token.endsWith("0") ? "1" : "0"}`,
    };
    const extraField = { ...signed, unexpected: "bytes" };

    await assert.rejects(
      store.directTransfer.initiate(tamperedDescriptor),
      errorCode("SIGNATURE_INVALID"),
    );
    await assert.rejects(
      store.directTransfer.initiate(tamperedToken),
      errorCode("SIGNATURE_INVALID"),
    );
    await assert.rejects(
      store.directTransfer.initiate(extraField),
      errorCode("REQUEST_INVALID", "SIGNATURE_INVALID"),
    );

    clock.now += 1_000;
    await assert.rejects(store.directTransfer.initiate(signed), errorCode("SIGNATURE_EXPIRED"));
    assert.equal(store.controlPlane.audit().directOperations, 0);

    const refreshed = await store.controlPlane.signInitiate(intent);
    assert.equal(refreshed.uploadId, signed.uploadId);
    assert.notEqual(refreshed.token, signed.token);
    assert.equal((await store.directTransfer.initiate(refreshed)).state, "UPLOADING");

    await assert.rejects(
      store.controlPlane.signPart({
        workspaceId: "workspace_002",
        uploadId: refreshed.uploadId,
        partNumber: 1,
        partSha256: sha256(bytes),
        partBytes: bytes.byteLength,
        expiresInMs: 60_000,
      }),
      errorCode("UPLOAD_NOT_FOUND"),
    );
    await assert.rejects(
      store.controlPlane.signInitiate({ ...intent, expiresInMs: 5 * 60 * 1_000 + 1 }),
      errorCode("REQUEST_INVALID"),
    );
  });
});

test("part and completion checksum, size, ordering, and receipt mismatches fail closed", async () => {
  await withStore(async ({ store, clock }) => {
    const bytes = Buffer.from("multipart integrity boundary", "utf8");
    const intent = projectIntent(bytes, clock.now);
    const { upload } = await initiate(store, intent);
    const first = bytes.subarray(0, 10);
    const second = bytes.subarray(10);
    const signedFirst = await store.controlPlane.signPart({
      workspaceId: intent.scope.workspaceId,
      uploadId: upload.uploadId,
      partNumber: 1,
      partSha256: sha256(first),
      partBytes: first.byteLength,
      expiresInMs: 60_000,
    });
    await assert.rejects(
      store.directTransfer.uploadPart(signedFirst, Buffer.concat([first, Buffer.from("x")])),
      errorCode("BYTE_SIZE_MISMATCH"),
    );
    await assert.rejects(
      store.directTransfer.uploadPart(signedFirst, Buffer.alloc(first.byteLength, 0x78)),
      errorCode("CONTENT_HASH_MISMATCH"),
    );
    const receiptOne = await store.directTransfer.uploadPart(signedFirst, first);
    const partTwo = await store.controlPlane.signPart({
      workspaceId: intent.scope.workspaceId,
      uploadId: upload.uploadId,
      partNumber: 2,
      partSha256: sha256(second),
      partBytes: second.byteLength,
      expiresInMs: 60_000,
    });
    const receiptTwo = await store.directTransfer.uploadPart(partTwo, second);

    await assert.rejects(
      store.controlPlane.signComplete({
        workspaceId: intent.scope.workspaceId,
        uploadId: upload.uploadId,
        parts: [receiptOne],
        expiresInMs: 60_000,
      }),
      errorCode("MULTIPART_INCOMPLETE"),
    );
    await assert.rejects(
      store.controlPlane.signComplete({
        workspaceId: intent.scope.workspaceId,
        uploadId: upload.uploadId,
        parts: [receiptTwo, receiptOne],
        expiresInMs: 60_000,
      }),
      errorCode("MULTIPART_INCOMPLETE"),
    );
    await assert.rejects(
      store.controlPlane.signComplete({
        workspaceId: intent.scope.workspaceId,
        uploadId: upload.uploadId,
        parts: [{ ...receiptOne, etag: sha256(Buffer.from("other")) }, receiptTwo],
        expiresInMs: 60_000,
      }),
      errorCode("PART_INVALID"),
    );

    const complete = await store.controlPlane.signComplete({
      workspaceId: intent.scope.workspaceId,
      uploadId: upload.uploadId,
      parts: [receiptOne, receiptTwo],
      expiresInMs: 60_000,
    });
    await assert.rejects(
      store.directTransfer.complete({ ...complete, partNumber: 1 }),
      errorCode("SIGNATURE_INVALID"),
    );
    assert.equal((await store.directTransfer.complete(complete)).binarySha256, sha256(bytes));
  });
});

test("whole-object size and checksum are independently verified at immutable acceptance", async () => {
  await withStore(async ({ store, clock }) => {
    const bytes = Buffer.from("whole object integrity", "utf8");
    for (const [index, integrity] of [
      { binarySha256: sha256(bytes), byteSize: bytes.byteLength + 1 },
      { binarySha256: sha256(Buffer.from("declared other bytes")), byteSize: bytes.byteLength },
    ].entries()) {
      const declaredHex = integrity.binarySha256.slice("sha256:".length);
      const base = projectIntent(bytes, clock.now, {
        idempotencyKey: `whole_object_${index}`,
        assetId: `whole_asset_${index}`,
      });
      const intent = {
        ...base,
        objectKey: base.objectKey.replace(
          base.integrity.binarySha256.slice("sha256:".length),
          declaredHex,
        ),
        integrity: { ...base.integrity, ...integrity },
      };
      const { upload } = await initiate(store, intent);
      const part = await uploadSinglePart(store, intent.scope.workspaceId, upload.uploadId, bytes);
      const completionRequest = {
        workspaceId: intent.scope.workspaceId,
        uploadId: upload.uploadId,
        parts: [part.receipt],
        expiresInMs: 60_000,
      };
      if (index === 0) {
        await assert.rejects(
          store.controlPlane.signComplete(completionRequest),
          errorCode("BYTE_SIZE_MISMATCH"),
        );
        continue;
      }
      const signedComplete = await store.controlPlane.signComplete(completionRequest);
      await assert.rejects(
        store.directTransfer.complete(signedComplete),
        errorCode(index === 0 ? "BYTE_SIZE_MISMATCH" : "CONTENT_HASH_MISMATCH"),
      );
      assert.equal(
        await store.controlPlane.resolveAccepted(intent.scope.workspaceId, intent.objectKey),
        null,
      );
    }
  });
});

test("workspace and retention checks protect signed downloads and delayed completion", async () => {
  await withStore(async ({ store, clock }) => {
    const bytes = Buffer.from("short retention artifact", "utf8");
    const intent = projectIntent(bytes, clock.now, {
      retention: {
        retentionClass: "ACCEPTED_SCENE",
        retainUntilEpochMs: clock.now + 2 * 60_000,
      },
    });
    const { upload } = await initiate(store, intent);
    const part = await uploadSinglePart(store, intent.scope.workspaceId, upload.uploadId, bytes);
    const completed = await completeSinglePart(store, intent, upload.uploadId, part.receipt);

    await assert.rejects(
      store.controlPlane.signDownload({
        workspaceId: "workspace_002",
        objectKey: intent.objectKey,
        expiresInMs: 60_000,
      }),
      errorCode("SCOPE_MISMATCH"),
    );
    assert.equal(await store.controlPlane.resolveAccepted("workspace_002", intent.objectKey), null);
    await assert.rejects(
      store.controlPlane.signDownload({
        workspaceId: intent.scope.workspaceId,
        objectKey: intent.objectKey.replace(/inputs\/[^/]+$/u, `inputs/${"f".repeat(64)}.bin`),
        expiresInMs: 60_000,
      }),
      errorCode("NOT_FOUND"),
    );

    const download = await store.controlPlane.signDownload({
      workspaceId: intent.scope.workspaceId,
      objectKey: intent.objectKey,
      expiresInMs: 5 * 60_000,
    });
    clock.now += 3 * 60_000;
    await assert.rejects(store.directTransfer.download(download), errorCode("RETENTION_INVALID"));
    await assert.rejects(
      store.controlPlane.signDownload({
        workspaceId: intent.scope.workspaceId,
        objectKey: intent.objectKey,
        expiresInMs: 60_000,
      }),
      errorCode("RETENTION_INVALID"),
    );
    assert.equal(
      await store.controlPlane.resolveAccepted(intent.scope.workspaceId, intent.objectKey),
      null,
      "expired retained artifacts must disappear from ordinary resolution",
    );
    assert.equal(
      completed.artifact.retention.retainUntilEpochMs,
      intent.retention.retainUntilEpochMs,
    );
  });

  await withStore(async ({ store, clock }) => {
    const bytes = Buffer.from("expires before completion", "utf8");
    const intent = projectIntent(bytes, clock.now, {
      retention: {
        retentionClass: "ACCEPTED_SCENE",
        retainUntilEpochMs: clock.now + 1_000,
      },
    });
    const { upload } = await initiate(store, intent);
    const part = await uploadSinglePart(store, intent.scope.workspaceId, upload.uploadId, bytes);
    const signedComplete = await store.controlPlane.signComplete({
      workspaceId: intent.scope.workspaceId,
      uploadId: upload.uploadId,
      parts: [part.receipt],
      expiresInMs: 60_000,
    });
    clock.now += 2_000;
    await assert.rejects(
      store.directTransfer.complete(signedComplete),
      errorCode("RETENTION_INVALID"),
    );
  });
});

test("plain-data snapshots reject accessors, unknown cycles, sparse parts, and oversized tokens", async () => {
  await withStore(async ({ store, clock }) => {
    const bytes = Buffer.from("plain data boundary", "utf8");
    const intent = projectIntent(bytes, clock.now);
    let accessorReads = 0;
    const accessorIntent = { ...intent };
    Object.defineProperty(accessorIntent, "unexpected", {
      enumerable: true,
      get() {
        accessorReads += 1;
        return bytes;
      },
    });
    await assert.rejects(
      store.controlPlane.signInitiate(accessorIntent),
      errorCode("REQUEST_INVALID"),
    );
    assert.equal(accessorReads, 0);

    const nestedIntegrity = { ...intent.integrity };
    Object.defineProperty(nestedIntegrity, "contentType", {
      enumerable: true,
      get() {
        accessorReads += 1;
        return "application/octet-stream";
      },
    });
    await assert.rejects(
      store.controlPlane.signInitiate({ ...intent, integrity: nestedIntegrity }),
      errorCode("REQUEST_INVALID"),
    );
    assert.equal(accessorReads, 0);

    const cyclic = {};
    cyclic.self = cyclic;
    await assert.rejects(
      store.controlPlane.signInitiate({ ...intent, unexpected: cyclic }),
      errorCode("REQUEST_INVALID"),
    );
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    await assert.rejects(
      store.controlPlane.signInitiate(revoked.proxy),
      errorCode("REQUEST_INVALID"),
    );

    const signed = await store.controlPlane.signInitiate(intent);
    const tokenAccessor = { ...signed };
    delete tokenAccessor.token;
    Object.defineProperty(tokenAccessor, "token", {
      enumerable: true,
      get() {
        accessorReads += 1;
        return signed.token;
      },
    });
    await assert.rejects(
      store.directTransfer.initiate(tokenAccessor),
      errorCode("REQUEST_INVALID"),
    );
    assert.equal(accessorReads, 0);

    await assert.rejects(
      store.directTransfer.initiate({ ...signed, token: "x".repeat(96 * 1_024 + 1) }),
      errorCode("SIGNATURE_INVALID"),
    );
    assert.equal(store.controlPlane.audit().directOperations, 0);

    const upload = await store.directTransfer.initiate(signed);
    const part = await uploadSinglePart(store, intent.scope.workspaceId, upload.uploadId, bytes);
    const sparseParts = [];
    sparseParts.length = 1;
    await assert.rejects(
      store.controlPlane.signComplete({
        workspaceId: intent.scope.workspaceId,
        uploadId: upload.uploadId,
        parts: sparseParts,
        expiresInMs: 60_000,
      }),
      errorCode("REQUEST_INVALID"),
    );
    const accessorParts = [part.receipt];
    Object.defineProperty(accessorParts, "0", {
      enumerable: true,
      get() {
        accessorReads += 1;
        return part.receipt;
      },
    });
    await assert.rejects(
      store.controlPlane.signComplete({
        workspaceId: intent.scope.workspaceId,
        uploadId: upload.uploadId,
        parts: accessorParts,
        expiresInMs: 60_000,
      }),
      errorCode("REQUEST_INVALID"),
    );
    assert.equal(accessorReads, 0);
  });
});

test("multipart ceilings, cumulative bytes, and idle expiry fail closed with cleanup", async () => {
  await withStore(async ({ store, root, clock }) => {
    const oversizedDigest = sha256(Buffer.from("declared oversized", "utf8"));
    const oversized = projectIntent(Buffer.from("x"), clock.now, {
      objectKey: `workspace/workspace_001/project/project_001/revision/revision_001/inputs/${oversizedDigest.slice("sha256:".length)}.bin`,
      integrity: {
        binarySha256: oversizedDigest,
        byteSize: 1_024 * 1_024 * 1_024 + 1,
        contentType: "application/octet-stream",
        canonicalDocument: null,
      },
    });
    await assert.rejects(
      store.controlPlane.signInitiate(oversized),
      errorCode("ARTIFACT_LIMIT_EXCEEDED"),
    );

    const declared = Buffer.alloc(10, 0x41);
    const intent = projectIntent(declared, clock.now, {
      idempotencyKey: "bounded_upload_001",
      assetId: "bounded_asset_001",
    });
    const { upload } = await initiate(store, intent);
    for (const invalidPart of [
      { partNumber: 257, partBytes: 1 },
      { partNumber: 1, partBytes: 64 * 1_024 * 1_024 + 1 },
    ]) {
      await assert.rejects(
        store.controlPlane.signPart({
          workspaceId: intent.scope.workspaceId,
          uploadId: upload.uploadId,
          partNumber: invalidPart.partNumber,
          partSha256: sha256(Buffer.from("x")),
          partBytes: invalidPart.partBytes,
          expiresInMs: 60_000,
        }),
        errorCode("ARTIFACT_LIMIT_EXCEEDED"),
      );
    }

    const firstBytes = Buffer.alloc(6, 0x41);
    await uploadPart(store, upload.uploadId, intent.scope.workspaceId, 1, firstBytes);
    const secondBytes = Buffer.alloc(5, 0x41);
    const secondOperation = await store.controlPlane.signPart({
      workspaceId: intent.scope.workspaceId,
      uploadId: upload.uploadId,
      partNumber: 2,
      partSha256: sha256(secondBytes),
      partBytes: secondBytes.byteLength,
      expiresInMs: 60_000,
    });
    await assert.rejects(
      store.directTransfer.uploadPart(secondOperation, secondBytes),
      errorCode("ARTIFACT_LIMIT_EXCEEDED"),
    );

    clock.now += 15 * 60 * 1_000;
    const abort = await store.controlPlane.signAbort({
      workspaceId: intent.scope.workspaceId,
      uploadId: upload.uploadId,
      expiresInMs: 60_000,
    });
    assert.equal((await store.directTransfer.abort(abort)).replayed, true);
    assert.deepEqual(await readdir(path.join(root, "private", "staging")), []);
  });
});

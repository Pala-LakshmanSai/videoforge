import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { deflateSync } from "node:zlib";

import { LocalArtifactStore, LocalArtifactStoreError } from "../dist/src/index.js";

const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const errorCode = (code) => (error) =>
  error instanceof LocalArtifactStoreError && error.code === code;

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function pngChunk(kind, data) {
  const type = Buffer.from(kind, "ascii");
  const chunk = Buffer.alloc(12 + data.byteLength);
  chunk.writeUInt32BE(data.byteLength, 0);
  type.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([type, data])), 8 + data.byteLength);
  return chunk;
}

function validPng() {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(Buffer.from([0, 0xff, 0, 0, 0xff]))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function validWav() {
  const buffer = Buffer.alloc(48);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(40, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(48_000, 24);
  buffer.writeUInt32LE(96_000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(4, 40);
  buffer.set([0, 0, 1, 0], 44);
  return buffer;
}

function validFlac() {
  const buffer = Buffer.alloc(44);
  buffer.write("fLaC", 0, "ascii");
  buffer[4] = 0x80;
  buffer.writeUIntBE(34, 5, 3);
  buffer.writeUInt16BE(16, 8);
  buffer.writeUInt16BE(16, 10);
  const packed = (48_000n << 44n) | (15n << 36n) | 1n;
  buffer.writeBigUInt64BE(packed, 18);
  buffer[42] = 0xff;
  buffer[43] = 0xf8;
  return buffer;
}

function mp4Box(kind, payload) {
  const box = Buffer.alloc(8 + payload.byteLength);
  box.writeUInt32BE(box.byteLength, 0);
  box.write(kind, 4, "ascii");
  payload.copy(box, 8);
  return box;
}

function validMp4(handler) {
  const ftyp = Buffer.alloc(12);
  ftyp.write("isom", 0, "ascii");
  ftyp.writeUInt32BE(0x200, 4);
  ftyp.write("isom", 8, "ascii");
  const hdlr = Buffer.alloc(20);
  hdlr.write(handler, 8, "ascii");
  return Buffer.concat([
    mp4Box("ftyp", ftyp),
    mp4Box("moov", mp4Box("trak", mp4Box("mdia", mp4Box("hdlr", hdlr)))),
    mp4Box("mdat", Buffer.from([1, 2, 3, 4])),
  ]);
}

function validJpeg() {
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x01, 0x00, 0x01, 0x03, 0x01, 0x11, 0x00, 0x02,
    0x11, 0x00, 0x03, 0x11, 0x00, 0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x00, 0x03, 0x00,
    0x00, 0x3f, 0x00, 0x00, 0xff, 0xd9,
  ]);
}

function validWebp() {
  const payload = Buffer.from([0x2f, 0, 0, 0, 0]);
  const chunk = Buffer.alloc(8 + payload.byteLength + 1);
  chunk.write("VP8L", 0, "ascii");
  chunk.writeUInt32LE(payload.byteLength, 4);
  payload.copy(chunk, 8);
  const buffer = Buffer.concat([Buffer.from("RIFF0000WEBP", "ascii"), chunk]);
  buffer.writeUInt32LE(buffer.byteLength - 8, 4);
  return buffer;
}

const xWavFixture = validWav();
xWavFixture[44] = 2;

const fixtures = [
  ["application/json", "json", Buffer.from('{"schema":"valid"}', "utf8")],
  ["application/octet-stream", "bin", Buffer.from([1, 2, 3])],
  ["audio/flac", "flac", validFlac()],
  ["audio/mp4", "m4a", validMp4("soun")],
  ["audio/mpeg", "mp3", Buffer.from([0xff, 0xfb, 0x90, 0x64, 0])],
  ["audio/wav", "wav", validWav()],
  ["audio/x-wav", "wav", xWavFixture],
  ["image/jpeg", "jpg", validJpeg()],
  ["image/png", "png", validPng()],
  ["image/webp", "webp", validWebp()],
  ["video/mp4", "mp4", validMp4("vide")],
];

function intentFor(bytes, contentType, extension, index) {
  const digest = sha256(bytes);
  return {
    idempotencyKey: `media_${index}`,
    assetId: `media_asset_${index}`,
    scope: {
      ownerType: "PROJECT_REVISION",
      workspaceId: "workspace_001",
      projectId: "project_001",
      projectRevisionId: "revision_001",
    },
    objectKey: `workspace/workspace_001/project/project_001/revision/revision_001/inputs/${digest.slice("sha256:".length)}.${extension}`,
    integrity: {
      binarySha256: digest,
      byteSize: bytes.byteLength,
      contentType,
      canonicalDocument: null,
    },
    retention: { retentionClass: "RETAIN_WHILE_REFERENCED", retainUntilEpochMs: null },
    expiresInMs: 60_000,
  };
}

async function completeBytes(store, intent, bytes) {
  const upload = await store.directTransfer.initiate(await store.controlPlane.signInitiate(intent));
  const partOperation = await store.controlPlane.signPart({
    workspaceId: intent.scope.workspaceId,
    uploadId: upload.uploadId,
    partNumber: 1,
    partSha256: sha256(bytes),
    partBytes: bytes.byteLength,
    expiresInMs: 60_000,
  });
  const receipt = await store.directTransfer.uploadPart(partOperation, bytes);
  const completion = await store.controlPlane.signComplete({
    workspaceId: intent.scope.workspaceId,
    uploadId: upload.uploadId,
    parts: [receipt],
    expiresInMs: 60_000,
  });
  return { upload, completion, receipt };
}

test("every allowlisted content type requires bounded structural byte validation", async () => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), "videoforge-media-signatures-"));
  const nowEpochMs = Date.parse("2026-08-10T00:00:00.000Z");
  try {
    const store = await LocalArtifactStore.create(path.join(sandbox, "artifacts"), {
      signingKey: Buffer.alloc(32, 0x5d),
      clock: { nowEpochMs: () => nowEpochMs },
    });
    for (const [index, [contentType, extension, bytes]] of fixtures.entries()) {
      const intent = intentFor(bytes, contentType, extension, index);
      const { completion } = await completeBytes(store, intent, bytes);
      const accepted = await store.directTransfer.complete(completion);
      assert.equal(accepted.contentType, contentType);
      assert.equal(accepted.binarySha256, sha256(bytes));
    }
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("invalid signatures fail closed and terminal completion failure releases parts", async () => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), "videoforge-media-invalid-"));
  const root = path.join(sandbox, "artifacts");
  const nowEpochMs = Date.parse("2026-08-10T00:00:00.000Z");
  try {
    const store = await LocalArtifactStore.create(root, {
      signingKey: Buffer.alloc(32, 0x6e),
      clock: { nowEpochMs: () => nowEpochMs },
    });
    for (const [index, [contentType, extension]] of fixtures.entries()) {
      if (contentType === "application/octet-stream") continue;
      const bytes = Buffer.from(`not-valid-${contentType}`, "utf8");
      const intent = intentFor(bytes, contentType, extension, `invalid_${index}`);
      const { upload, completion } = await completeBytes(store, intent, bytes);
      await assert.rejects(
        store.directTransfer.complete(completion),
        errorCode("MEDIA_SIGNATURE_INVALID"),
      );
      assert.deepEqual(await readdir(path.join(root, "private", "staging")), []);
      const abort = await store.controlPlane.signAbort({
        workspaceId: intent.scope.workspaceId,
        uploadId: upload.uploadId,
        expiresInMs: 60_000,
      });
      assert.equal((await store.directTransfer.abort(abort)).replayed, true);
    }
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

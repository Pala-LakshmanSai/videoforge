import { createHash, createHmac } from "node:crypto";
import { DecompressionStream as NodeDecompressionStream } from "node:stream/web";
import { deflateSync } from "node:zlib";

import { beforeAll, describe, expect, it, vi } from "vitest";

import type { HostedR2BucketBinding } from "./configuration";
import {
  handleV207DisposableOutputPort,
  V207_DISPOSABLE_OUTPUT_ROUTE,
} from "./v207-disposable-output-ports";

const nonce = "a".repeat(64);
const origin = `https://videoforge-v207-output.example.test${V207_DISPOSABLE_OUTPUT_ROUTE}`;
const objectKey =
  "tenant/account-a/workspace/workspace-a/project/project-a/revision/revision-a/lane/mage-image/job/attempt-a/artifact/scene-a";

beforeAll(() => vi.stubGlobal("DecompressionStream", NodeDecompressionStream));

const crcTable = new Uint32Array(256);
for (let index = 0; index < crcTable.length; index += 1) {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  crcTable[index] = crc >>> 0;
}

function crc32(value: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of value) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff]!;
  return (crc ^ 0xffffffff) >>> 0;
}

function png1280x720(): Uint8Array {
  const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const result = new Uint8Array(12 + data.byteLength);
    const view = new DataView(result.buffer);
    view.setUint32(0, data.byteLength);
    result.set(new TextEncoder().encode(type), 4);
    result.set(data, 8);
    view.setUint32(8 + data.byteLength, crc32(result.subarray(4, 8 + data.byteLength)));
    return result;
  };
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, 1280);
  view.setUint32(4, 720);
  header.set([8, 2, 0, 0, 0], 8);
  const scanlines = new Uint8Array((1 + 1280 * 3) * 720);
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", new Uint8Array(deflateSync(scanlines))),
    chunk("IEND", new Uint8Array()),
  ];
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function memoryBucket(outputMetadata: "present" | "absent" | "wrong" = "present"): {
  bucket: HostedR2BucketBinding;
  objects: Map<string, { bytes: Uint8Array; contentType: string }>;
} {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  const metadataFor = (key: string, contentType: string) =>
    key !== objectKey || outputMetadata === "present"
      ? { contentType }
      : outputMetadata === "absent"
        ? undefined
        : { contentType: "application/octet-stream" };
  const bucket: HostedR2BucketBinding = {
    async head(key) {
      const value = objects.get(key);
      return value
        ? { size: value.bytes.byteLength, httpMetadata: metadataFor(key, value.contentType) }
        : null;
    },
    async get(key) {
      const value = objects.get(key);
      return value
        ? {
            size: value.bytes.byteLength,
            httpMetadata: metadataFor(key, value.contentType),
            async arrayBuffer() {
              return value.bytes.slice().buffer as ArrayBuffer;
            },
          }
        : null;
    },
    async put(key, body, options) {
      const putOptions = options as
        | {
            httpMetadata?: { contentType?: string };
            onlyIf?: { etagDoesNotMatch?: string };
          }
        | undefined;
      if (putOptions?.onlyIf?.etagDoesNotMatch === "*" && objects.has(key)) return null;
      const bytes =
        typeof body === "string"
          ? new TextEncoder().encode(body)
          : new Uint8Array(body as ArrayBuffer).slice();
      objects.set(key, {
        bytes,
        contentType: putOptions?.httpMetadata?.contentType ?? "application/octet-stream",
      });
      return {};
    },
    async list() {
      throw new Error("broad list forbidden");
    },
    async delete(key) {
      for (const item of typeof key === "string" ? [key] : key) objects.delete(item);
    },
  };
  return { bucket, objects };
}

function controlRequest(body: Record<string, unknown>, authority = nonce): Request {
  return new Request(origin, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-videoforge-v207-authority": authority,
    },
    body: JSON.stringify(body),
  });
}

async function generatedPutPort(runtime: ReturnType<typeof memoryBucket>, maximum = 1024) {
  const environment = {
    PRIVATE_ARTIFACTS: runtime.bucket,
    VIDEOFORGE_V207_AUTHORITY_NONCE: nonce,
  };
  const response = await handleV207DisposableOutputPort(
    controlRequest({
      schema_version: "videoforge-v207-generated-output-port-request/v1",
      operation: "PUT",
      account_id: "account-a",
      workspace_id: "workspace-a",
      object_key: objectKey,
      content_type: "image/png",
      max_content_length: maximum,
      lifetime_seconds: 300,
    }),
    environment,
  );
  const value = (await response?.json()) as { url: string };
  return { url: value.url, environment };
}

describe("V2-07 disposable output Worker", () => {
  it("is disabled without the ephemeral nonce and rejects wrong authority", async () => {
    const runtime = memoryBucket();
    const disabled = await handleV207DisposableOutputPort(controlRequest({}), {
      PRIVATE_ARTIFACTS: runtime.bucket,
    });
    expect(disabled?.status).toBe(404);
    const rejected = await handleV207DisposableOutputPort(controlRequest({}, "b".repeat(64)), {
      PRIVATE_ARTIFACTS: runtime.bucket,
      VIDEOFORGE_V207_AUTHORITY_NONCE: nonce,
    });
    expect(rejected?.status).toBe(403);
  });

  it("writes and reads one exact object through capability URLs, then deletes only its tuple", async () => {
    const runtime = memoryBucket();
    const environment = {
      PRIVATE_ARTIFACTS: runtime.bucket,
      VIDEOFORGE_V207_AUTHORITY_NONCE: nonce,
    };
    const putPort = await handleV207DisposableOutputPort(
      controlRequest({
        schema_version: "videoforge-v207-generated-output-port-request/v1",
        operation: "PUT",
        account_id: "account-a",
        workspace_id: "workspace-a",
        object_key: objectKey,
        content_type: "image/png",
        max_content_length: 1024,
        lifetime_seconds: 300,
      }),
      environment,
    );
    expect(putPort?.status).toBe(200);
    const putValue = (await putPort?.json()) as Record<string, any>;
    expect(putValue.authority).toMatchObject({
      schema_version: "artifact-generated-output-authority/v1",
      method: "PUT",
      path: `/${objectKey}`,
      max_uses: 1,
    });
    expect(Object.keys(putValue.authority).sort()).toEqual(
      [
        "account_id",
        "capability_handle",
        "content_type",
        "expires_at",
        "max_content_length",
        "max_uses",
        "method",
        "path",
        "reservation_id",
        "schema_version",
        "workspace_id",
      ].sort(),
    );
    expect(putValue.capabilities).toBeUndefined();

    const bytes = new TextEncoder().encode("bounded-png-fixture");
    const upload = await handleV207DisposableOutputPort(
      new Request(putValue.url, {
        method: "PUT",
        headers: { "content-type": "image/png", "content-length": String(bytes.byteLength) },
        body: bytes,
      }),
      environment,
    );
    expect(upload?.status).toBe(201);

    const checksum = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const getPort = await handleV207DisposableOutputPort(
      controlRequest({
        schema_version: "videoforge-v207-generated-output-port-request/v1",
        operation: "GET",
        account_id: "account-a",
        workspace_id: "workspace-a",
        object_key: objectKey,
        content_type: "image/png",
        max_content_length: 1024,
        lifetime_seconds: 300,
        content_length: bytes.byteLength,
        checksum_sha256: checksum,
      }),
      environment,
    );
    expect(getPort?.status).toBe(200);
    const getValue = (await getPort?.json()) as Record<string, any>;
    expect(getValue.authority).toMatchObject({
      schema_version: "artifact-transfer-port/v3",
      method: "GET",
      checksum_sha256: checksum,
      max_uses: 1,
    });
    const concurrentDownloads = await Promise.all([
      handleV207DisposableOutputPort(new Request(getValue.url, { method: "GET" }), environment),
      handleV207DisposableOutputPort(new Request(getValue.url, { method: "GET" }), environment),
    ]);
    expect(concurrentDownloads.map((response) => response?.status).sort()).toEqual([200, 409]);
    const successfulDownload = concurrentDownloads.find((response) => response?.status === 200)!;
    expect(Array.from(new Uint8Array(await successfulDownload.arrayBuffer()))).toEqual(
      Array.from(bytes),
    );

    const rollbackToken = createHmac("sha256", nonce).update(objectKey).digest("hex");
    const deleted = await handleV207DisposableOutputPort(
      controlRequest({
        schema_version: "videoforge-v207-generated-output-port-request/v1",
        operation: "DELETE",
        account_id: "account-a",
        workspace_id: "workspace-a",
        object_key: objectKey,
        rollback_token: rollbackToken,
      }),
      environment,
    );
    expect(deleted?.status).toBe(200);
    expect(runtime.objects.size).toBe(0);
  });

  it("rejects oversized direct PUT before writing bytes", async () => {
    const runtime = memoryBucket();
    const environment = {
      PRIVATE_ARTIFACTS: runtime.bucket,
      VIDEOFORGE_V207_AUTHORITY_NONCE: nonce,
    };
    const port = await handleV207DisposableOutputPort(
      controlRequest({
        schema_version: "videoforge-v207-generated-output-port-request/v1",
        operation: "PUT",
        account_id: "account-a",
        workspace_id: "workspace-a",
        object_key: objectKey,
        content_type: "image/png",
        max_content_length: 4,
        lifetime_seconds: 60,
      }),
      environment,
    );
    const value = (await port?.json()) as Record<string, any>;
    const response = await handleV207DisposableOutputPort(
      new Request(value.url, {
        method: "PUT",
        headers: { "content-type": "image/png", "content-length": "5" },
        body: new Uint8Array(5),
      }),
      environment,
    );
    expect(response?.status).toBe(400);
    expect(runtime.objects.has(objectKey)).toBe(false);
  });

  it("accepts a bounded generated PUT when ingress omits Content-Length", async () => {
    const runtime = memoryBucket();
    const { url, environment } = await generatedPutPort(runtime);
    const response = await handleV207DisposableOutputPort(
      new Request(url, {
        method: "PUT",
        headers: { "content-type": "image/png" },
        body: new TextEncoder().encode("bounded-png-fixture"),
      }),
      environment,
    );
    expect(response?.status).toBe(201);
    expect(runtime.objects.has(objectKey)).toBe(true);
  });

  it("rejects a present Content-Length that differs from the actual body", async () => {
    const runtime = memoryBucket();
    const { url, environment } = await generatedPutPort(runtime);
    const response = await handleV207DisposableOutputPort(
      new Request(url, {
        method: "PUT",
        headers: { "content-type": "image/png", "content-length": "20" },
        body: new TextEncoder().encode("short"),
      }),
      environment,
    );
    expect(response?.status).toBe(400);
    expect(runtime.objects.has(objectKey)).toBe(false);
  });

  it("accepts exact size confirmation when R2 omits optional HTTP metadata", async () => {
    const runtime = memoryBucket("absent");
    const { url, environment } = await generatedPutPort(runtime);
    const bytes = new TextEncoder().encode("bounded-png-fixture");
    const response = await handleV207DisposableOutputPort(
      new Request(url, {
        method: "PUT",
        headers: { "content-type": "image/png", "content-length": String(bytes.byteLength) },
        body: bytes,
      }),
      environment,
    );
    expect(response?.status).toBe(201);
  });

  it("rejects explicit conflicting R2 content-type metadata after write", async () => {
    const runtime = memoryBucket("wrong");
    const { url, environment } = await generatedPutPort(runtime);
    const bytes = new TextEncoder().encode("bounded-png-fixture");
    const response = await handleV207DisposableOutputPort(
      new Request(url, {
        method: "PUT",
        headers: { "content-type": "image/png", "content-length": String(bytes.byteLength) },
        body: bytes,
      }),
      environment,
    );
    expect(response?.status).toBe(503);
  });

  it("finalizes a real 1280x720 PNG idempotently with a checksum-bound receipt", async () => {
    const runtime = memoryBucket();
    const environment = {
      PRIVATE_ARTIFACTS: runtime.bucket,
      VIDEOFORGE_V207_AUTHORITY_NONCE: nonce,
    };
    const putPort = await handleV207DisposableOutputPort(
      controlRequest({
        schema_version: "videoforge-v207-generated-output-port-request/v1",
        operation: "PUT",
        account_id: "account-a",
        workspace_id: "workspace-a",
        object_key: objectKey,
        content_type: "image/png",
        max_content_length: 4 * 1024 * 1024,
        lifetime_seconds: 300,
      }),
      environment,
    );
    const port = (await putPort?.json()) as Record<string, any>;
    const png = png1280x720();
    const upload = await handleV207DisposableOutputPort(
      new Request(port.url, {
        method: "PUT",
        headers: { "content-type": "image/png", "content-length": String(png.byteLength) },
        body: png.slice().buffer as ArrayBuffer,
      }),
      environment,
    );
    expect(upload?.status).toBe(201);
    const checksum = `sha256:${createHash("sha256").update(png).digest("hex")}`;
    const finalizeBody = {
      schema_version: "videoforge-v207-generated-output-port-request/v1",
      operation: "FINALIZE",
      account_id: "account-a",
      workspace_id: "workspace-a",
      object_key: objectKey,
      content_type: "image/png",
      content_length: png.byteLength,
      checksum_sha256: checksum,
      reservation_id: port.authority.reservation_id,
      capability_handle: port.authority.capability_handle,
      callback_id: "callback-attempt-a-01",
    };
    const first = await handleV207DisposableOutputPort(controlRequest(finalizeBody), environment);
    expect(first?.status).toBe(200);
    const firstValue = (await first?.json()) as Record<string, any>;
    expect(firstValue).toMatchObject({
      schema_version: "videoforge-v207-generated-output-finalization/v1",
      idempotent: false,
      receipt: {
        schema_version: "artifact-commit-receipt/v3",
        checksum_sha256: checksum,
        probe: { width: 1280, height: 720, format: "png", decoded: true },
      },
    });
    const replay = await handleV207DisposableOutputPort(controlRequest(finalizeBody), environment);
    const replayValue = (await replay?.json()) as Record<string, any>;
    expect(replayValue.idempotent).toBe(true);
    expect(replayValue.receipt.receipt_sha256).toBe(firstValue.receipt.receipt_sha256);
  });
});

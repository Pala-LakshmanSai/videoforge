import { deflateSync } from "node:zlib";
import { DecompressionStream as NodeDecompressionStream } from "node:stream/web";

import { beforeAll, describe, expect, it, vi } from "vitest";

import { hostedRuntimeConfiguration, type HostedRuntimeEnvironment } from "./configuration";
import { handleV207GeneratedOutputPort, v207RollbackToken } from "./v207-output-ports";

beforeAll(() => vi.stubGlobal("DecompressionStream", NodeDecompressionStream));

const nonce = "a".repeat(64);
const objectKey =
  "tenant/account-a/workspace/workspace-a/project/project-a/revision/revision-a/lane/mage-image/job/attempt-a/artifact/scene-a";

function environment(): HostedRuntimeEnvironment {
  return {
    PRIVATE_ARTIFACTS: {
      async head() {
        return null;
      },
      async get() {
        return null;
      },
      async put() {
        return {};
      },
      async list() {
        return { objects: [], truncated: false };
      },
      async delete() {},
    },
    VIDEO_WORKFLOW: {
      async create() {
        return { id: "workflow-a" };
      },
      async get() {
        return { async status() {}, async sendEvent() {} };
      },
    },
    VIDEOFORGE_PROVIDER_MODE: "staging",
    VIDEOFORGE_COMMIT: "v207-test",
    VIDEOFORGE_PUBLIC_ORIGIN: "https://staging.example.test",
    VIDEOFORGE_R2_BUCKET_NAME: "videoforge-v2-06-staging-private",
    R2_ACCOUNT_ID: "account-id",
    R2_ACCESS_KEY_ID: "access-key-id",
    R2_SECRET_ACCESS_KEY: "secret-access-key",
    DATABASE_URL:
      "postgresql://fixture:fixture@fixture.example.test/videoforge?sslmode=require&channel_binding=require",
    BETTER_AUTH_SECRET: "better-auth-secret-000000000000000000000000",
    GOOGLE_CLIENT_ID: "google-client.apps.example.test",
    GOOGLE_CLIENT_SECRET: "google-client-secret",
    WORKFLOW_CALLBACK_SECRET: "workflow-callback-secret-000000000000000000000",
    MEDIA_WORKER_TOKEN_SECRET: "media-worker-token-secret-00000000000000000000",
    MEDIA_WORKER_RELEASE_MANIFEST_JSON: JSON.stringify({
      schema_version: "videoforge-media-worker-release/v1",
      version: "0.1.0",
      minimum_protocol_version: 1,
      execution_bundle_sha256: `sha256:${"a".repeat(64)}`,
      whisper_model_sha256: `sha256:${"b".repeat(64)}`,
      windows: {
        url: "https://downloads.example.test/worker.exe",
        sha256: `sha256:${"c".repeat(64)}`,
        size_bytes: 1,
        trust: "UNSIGNED_BETA",
      },
      macos: {
        url: "https://downloads.example.test/worker.dmg",
        sha256: `sha256:${"d".repeat(64)}`,
        size_bytes: 1,
        trust: "AD_HOC_BETA",
      },
    }),
    VIDEOFORGE_V207_AUTHORITY_NONCE: nonce,
  };
}

function statefulEnvironment(): {
  readonly environment: HostedRuntimeEnvironment;
  readonly objects: Map<string, { bytes: Uint8Array; contentType: string }>;
} {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  const base = environment();
  const bucket = {
    async head(key: string) {
      const stored = objects.get(key);
      return stored
        ? { size: stored.bytes.byteLength, httpMetadata: { contentType: stored.contentType } }
        : null;
    },
    async get(key: string) {
      const stored = objects.get(key);
      return stored
        ? {
            size: stored.bytes.byteLength,
            httpMetadata: { contentType: stored.contentType },
            async arrayBuffer() {
              return stored.bytes.slice().buffer as ArrayBuffer;
            },
          }
        : null;
    },
    async put(key: string, value: ReadableStream | ArrayBuffer | string, options?: unknown) {
      const isArrayBuffer = Object.prototype.toString.call(value) === "[object ArrayBuffer]";
      const bytes =
        typeof value === "string"
          ? new TextEncoder().encode(value)
          : isArrayBuffer
            ? new Uint8Array(value as ArrayBuffer)
            : ArrayBuffer.isView(value)
              ? new Uint8Array(value.buffer as ArrayBuffer, value.byteOffset, value.byteLength)
              : null;
      if (bytes === null) throw new Error("stream fixture not supported");
      const metadata = options as { httpMetadata?: { contentType?: string } } | undefined;
      objects.set(key, {
        bytes: bytes.slice(),
        contentType: metadata?.httpMetadata?.contentType ?? "application/octet-stream",
      });
      return {};
    },
    async list() {
      return { objects: [], truncated: false };
    },
    async delete(key: string | readonly string[]) {
      for (const candidate of Array.isArray(key) ? key : [key]) objects.delete(candidate);
    },
  };
  return { environment: { ...base, PRIVATE_ARTIFACTS: bucket }, objects };
}

function png1280x720(): Uint8Array {
  const crc32 = (value: Uint8Array): number => {
    let crc = 0xffffffff;
    for (const byte of value) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
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
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, 1280);
  headerView.setUint32(4, 720);
  header.set([8, 2, 0, 0, 0], 8);
  const scanlines = new Uint8Array((1 + 1280 * 3) * 720);
  const compressed = new Uint8Array(deflateSync(scanlines));
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", compressed),
    chunk("IEND", new Uint8Array()),
  ];
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

async function sha256Checksum(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", bytes.slice().buffer as ArrayBuffer),
  );
  return `sha256:${[...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function request(body: unknown, authority = nonce): Request {
  return new Request("https://staging.example.test/api/v2/v207/generated-output-port", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-videoforge-v207-authority": authority,
    },
    body: JSON.stringify(body),
  });
}

describe("V2-07 hosted generated-output port", () => {
  const config = hostedRuntimeConfiguration(environment());

  it("signs a bounded PUT without predeclaring output bytes", async () => {
    const response = await handleV207GeneratedOutputPort(
      request({
        schema_version: "videoforge-v207-generated-output-port-request/v1",
        operation: "PUT",
        account_id: "account-a",
        workspace_id: "workspace-a",
        object_key: objectKey,
        content_type: "image/png",
        max_content_length: 4 * 1024 * 1024,
        lifetime_seconds: 300,
      }),
      config,
      environment(),
    );
    expect(response?.status).toBe(200);
    const value = (await response?.json()) as Record<string, unknown>;
    expect(value.schema_version).toBe("videoforge-v207-generated-output-port/v1");
    expect(value.method).toBe("PUT");
    expect(value.maxContentLength).toBe(4 * 1024 * 1024);
    expect(value.url).toMatch(/^https:\/\//u);
  });

  it("persists one deterministic reservation and finalizes measured PNG facts idempotently", async () => {
    const runtime = statefulEnvironment();
    const putBody = {
      schema_version: "videoforge-v207-generated-output-port-request/v1",
      operation: "PUT",
      account_id: "account-a",
      workspace_id: "workspace-a",
      object_key: objectKey,
      content_type: "image/png",
      max_content_length: 4 * 1024 * 1024,
      lifetime_seconds: 7_200,
    };
    const first = await handleV207GeneratedOutputPort(
      request(putBody),
      config,
      runtime.environment,
    );
    const firstValue = (await first?.json()) as Record<string, any>;
    expect(first?.status).toBe(200);
    const authority = firstValue.authority as Record<string, any>;
    expect(authority.schema_version).toBe("artifact-generated-output-authority/v1");
    expect(authority.max_uses).toBe(1);
    expect(new URL(firstValue.url).searchParams.get("X-Amz-Expires")).toBe("7200");
    const reservationKey =
      "tenant/account-a/workspace/workspace-a/project/project-a/revision/revision-a/lane/provenance/job/attempt-a/artifact/scene-a.generated-output-reservation";
    expect(runtime.objects.has(reservationKey)).toBe(true);

    const replayedPut = await handleV207GeneratedOutputPort(
      request(putBody),
      config,
      runtime.environment,
    );
    expect(replayedPut?.status).toBe(200);
    const replayedValue = (await replayedPut?.json()) as Record<string, any>;
    expect(replayedValue.authority).toEqual(authority);

    const bytes = png1280x720();
    const checksum = await sha256Checksum(bytes);
    runtime.objects.set(objectKey, { bytes, contentType: "image/png" });
    const finalizeBody = {
      schema_version: "videoforge-v207-generated-output-port-request/v1",
      operation: "FINALIZE",
      account_id: "account-a",
      workspace_id: "workspace-a",
      object_key: objectKey,
      content_type: "image/png",
      content_length: bytes.byteLength,
      checksum_sha256: checksum,
      reservation_id: authority.reservation_id,
      capability_handle: authority.capability_handle,
      callback_id: "callback-attempt-a-01",
    };
    const finalized = await handleV207GeneratedOutputPort(
      request(finalizeBody),
      config,
      runtime.environment,
    );
    expect(finalized?.status, JSON.stringify(await finalized?.clone().json())).toBe(200);
    const finalizedValue = (await finalized?.json()) as Record<string, any>;
    expect(finalizedValue.schema_version).toBe("videoforge-v207-generated-output-finalization/v1");
    expect(finalizedValue.idempotent).toBe(false);
    expect(finalizedValue.receipt).toMatchObject({
      schema_version: "artifact-commit-receipt/v3",
      reservation_id: authority.reservation_id,
      callback_id: "callback-attempt-a-01",
      content_type: "image/png",
      content_length: bytes.byteLength,
      checksum_sha256: checksum,
      probe: { width: 1280, height: 720, format: "png", decoded: true },
      retention_class: "PROJECT",
      retain_until: null,
    });
    const receiptKey =
      "tenant/account-a/workspace/workspace-a/project/project-a/revision/revision-a/lane/provenance/job/attempt-a/artifact/scene-a.artifact-commit-receipt-v3";
    expect(runtime.objects.has(receiptKey)).toBe(true);

    const finalizeReplay = await handleV207GeneratedOutputPort(
      request(finalizeBody),
      config,
      runtime.environment,
    );
    expect(finalizeReplay?.status).toBe(200);
    const replayValue = (await finalizeReplay?.json()) as Record<string, any>;
    expect(replayValue.idempotent).toBe(true);
    expect(replayValue.receipt).toEqual(finalizedValue.receipt);
  });

  it("rejects finalize authority and measured-fact mismatches", async () => {
    const runtime = statefulEnvironment();
    const put = await handleV207GeneratedOutputPort(
      request({
        schema_version: "videoforge-v207-generated-output-port-request/v1",
        operation: "PUT",
        account_id: "account-a",
        workspace_id: "workspace-a",
        object_key: objectKey,
        content_type: "image/png",
        max_content_length: 4 * 1024 * 1024,
        lifetime_seconds: 300,
      }),
      config,
      runtime.environment,
    );
    const putValue = (await put?.json()) as Record<string, any>;
    const authority = putValue.authority as Record<string, any>;
    const bytes = png1280x720();
    runtime.objects.set(objectKey, { bytes, contentType: "image/png" });
    const finalize = {
      schema_version: "videoforge-v207-generated-output-port-request/v1",
      operation: "FINALIZE",
      account_id: "account-a",
      workspace_id: "workspace-a",
      object_key: objectKey,
      content_type: "image/png",
      content_length: bytes.byteLength,
      checksum_sha256: await sha256Checksum(bytes),
      reservation_id: authority.reservation_id,
      capability_handle: authority.capability_handle,
      callback_id: "callback-attempt-a-02",
    };
    expect(
      (
        await handleV207GeneratedOutputPort(
          request({ ...finalize, capability_handle: "b".repeat(64) }),
          config,
          runtime.environment,
        )
      )?.status,
    ).toBe(403);
    expect(
      (
        await handleV207GeneratedOutputPort(
          request({ ...finalize, checksum_sha256: `sha256:${"f".repeat(64)}` }),
          config,
          runtime.environment,
        )
      )?.status,
    ).toBe(409);
    expect(
      (
        await handleV207GeneratedOutputPort(
          request({ ...finalize, callback_id: "callback-attempt-a-02", content_length: 1 }),
          config,
          runtime.environment,
        )
      )?.status,
    ).toBe(409);
    const corruptPng = bytes.slice();
    corruptPng[42] = (corruptPng[42] ?? 0) ^ 1;
    runtime.objects.set(objectKey, { bytes: corruptPng, contentType: "image/png" });
    expect(
      (
        await handleV207GeneratedOutputPort(
          request({
            ...finalize,
            content_length: corruptPng.byteLength,
            checksum_sha256: await sha256Checksum(corruptPng),
          }),
          config,
          runtime.environment,
        )
      )?.status,
    ).toBe(409);
  });

  it("signs a checksum-bound GET only after measured output facts exist", async () => {
    const response = await handleV207GeneratedOutputPort(
      request({
        schema_version: "videoforge-v207-generated-output-port-request/v1",
        operation: "GET",
        account_id: "account-a",
        workspace_id: "workspace-a",
        object_key: objectKey,
        content_type: "image/png",
        max_content_length: 4 * 1024 * 1024,
        lifetime_seconds: 300,
        content_length: 3,
        checksum_sha256: `sha256:${"e".repeat(64)}`,
      }),
      config,
      environment(),
    );
    expect(response?.status).toBe(200);
    const value = (await response?.json()) as Record<string, unknown>;
    expect(value.schema_version).toBe("videoforge-v207-generated-output-read-port/v1");
    expect(value.method).toBe("GET");
    expect(value.contentLength).toBe(3);
  });

  it("rejects wrong nonce, scope/path, and extra fields", async () => {
    const base = {
      schema_version: "videoforge-v207-generated-output-port-request/v1",
      operation: "PUT",
      account_id: "account-a",
      workspace_id: "workspace-a",
      object_key: objectKey,
      content_type: "image/png",
      max_content_length: 4 * 1024 * 1024,
      lifetime_seconds: 300,
    };
    expect(
      (await handleV207GeneratedOutputPort(request(base, "b".repeat(64)), config, environment()))
        ?.status,
    ).toBe(403);
    expect(
      (
        await handleV207GeneratedOutputPort(
          request({ ...base, object_key: objectKey.replace("account-a", "account-b") }),
          config,
          environment(),
        )
      )?.status,
    ).toBe(400);
    expect(
      (
        await handleV207GeneratedOutputPort(
          request({ ...base, unexpected: true }),
          config,
          environment(),
        )
      )?.status,
    ).toBe(400);
  });

  it("deletes one exact generated object only with the activation nonce", async () => {
    const deleted: string[] = [];
    const runtime = environment();
    runtime.PRIVATE_ARTIFACTS!.delete = async (key) => {
      deleted.push(...(Array.isArray(key) ? key : [key]));
    };
    const response = await handleV207GeneratedOutputPort(
      request({
        schema_version: "videoforge-v207-generated-output-port-request/v1",
        operation: "DELETE",
        account_id: "account-a",
        workspace_id: "workspace-a",
        object_key: objectKey,
        rollback_token: await v207RollbackToken(nonce, objectKey),
      }),
      config,
      runtime,
    );
    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toMatchObject({
      schema_version: "videoforge-v207-generated-output-delete/v1",
      deleted: true,
    });
    expect(deleted).toEqual([
      objectKey,
      "tenant/account-a/workspace/workspace-a/project/project-a/revision/revision-a/lane/provenance/job/attempt-a/artifact/scene-a.generated-output-reservation",
      "tenant/account-a/workspace/workspace-a/project/project-a/revision/revision-a/lane/provenance/job/attempt-a/artifact/scene-a.artifact-commit-receipt-v3",
    ]);
    expect(
      (
        await handleV207GeneratedOutputPort(
          request(
            {
              schema_version: "videoforge-v207-generated-output-port-request/v1",
              operation: "DELETE",
              account_id: "account-a",
              workspace_id: "workspace-a",
              object_key: objectKey,
              rollback_token: await v207RollbackToken("b".repeat(64), objectKey),
            },
            "b".repeat(64),
          ),
          config,
          runtime,
        )
      )?.status,
    ).toBe(403);
  });

  it("rejects nested, cross-scope, and malformed DELETE targets", async () => {
    const base = {
      schema_version: "videoforge-v207-generated-output-port-request/v1",
      operation: "DELETE",
      account_id: "account-a",
      workspace_id: "workspace-a",
      object_key: objectKey,
      rollback_token: await v207RollbackToken(nonce, objectKey),
    };
    const invalidKeys = [`${objectKey}/nested`, objectKey.replace("scene-a", "scene-b/other")];
    for (const invalidKey of invalidKeys) {
      const response = await handleV207GeneratedOutputPort(
        request({
          ...base,
          object_key: invalidKey,
          rollback_token: await v207RollbackToken(nonce, invalidKey),
        }),
        config,
        environment(),
      );
      expect(response?.status).toBe(400);
    }
    for (const crossScopeKey of [
      objectKey.replace("project-a", "project-b"),
      objectKey.replace("revision-a", "revision-b"),
      objectKey.replace("attempt-a", "attempt-b"),
      objectKey.replace("scene-a", "scene-b"),
    ]) {
      const response = await handleV207GeneratedOutputPort(
        request({ ...base, object_key: crossScopeKey }),
        config,
        environment(),
      );
      expect(response?.status).toBe(403);
    }
    const malformed = await handleV207GeneratedOutputPort(
      request({ ...base, unexpected: true }),
      config,
      environment(),
    );
    expect(malformed?.status).toBe(400);
  });

  it("fails closed when DELETE binding is unavailable or absence cannot be verified", async () => {
    const body = {
      schema_version: "videoforge-v207-generated-output-port-request/v1",
      operation: "DELETE",
      account_id: "account-a",
      workspace_id: "workspace-a",
      object_key: objectKey,
      rollback_token: await v207RollbackToken(nonce, objectKey),
    };
    const unavailable: HostedRuntimeEnvironment = {
      ...environment(),
      PRIVATE_ARTIFACTS: undefined,
    };
    const unavailableResponse = await handleV207GeneratedOutputPort(
      request(body),
      config,
      unavailable,
    );
    expect(unavailableResponse?.status).toBe(503);
    await expect(unavailableResponse?.json()).resolves.toMatchObject({
      error: { code: "V207_DELETE_UNAVAILABLE" },
    });

    const stillPresent = environment();
    stillPresent.PRIVATE_ARTIFACTS!.head = async () => ({ size: 1 });
    const unconfirmedResponse = await handleV207GeneratedOutputPort(
      request(body),
      config,
      stillPresent,
    );
    expect(unconfirmedResponse?.status).toBe(503);
    await expect(unconfirmedResponse?.json()).resolves.toMatchObject({
      error: { code: "V207_DELETE_UNCONFIRMED" },
    });

    const verificationFailure = environment();
    verificationFailure.PRIVATE_ARTIFACTS!.head = async () => {
      throw new Error("head unavailable");
    };
    const failedResponse = await handleV207GeneratedOutputPort(
      request(body),
      config,
      verificationFailure,
    );
    expect(failedResponse?.status).toBe(503);
    await expect(failedResponse?.json()).resolves.toMatchObject({
      error: { code: "V207_DELETE_VERIFY_FAILED" },
    });
  });
});

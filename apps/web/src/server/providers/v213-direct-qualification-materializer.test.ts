// @vitest-environment node

import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { HostedR2BucketBinding } from "../hosted/configuration.js";
import {
  buildV213SoulXQualificationWav,
  createV213DirectR2Bucket,
  createV213DirectQualificationMaterializer,
  type V213QualificationProtectedInputDescriptor,
  type V213QualificationProtectedInputDescriptors,
  type V213QualificationProtectedSourceBytes,
} from "./v213-direct-qualification-materializer.js";

const hash = (value: Uint8Array | string) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}` as const;
const proof = (character: string) => `sha256:${character.repeat(64)}` as const;
const SOURCE_COMMIT = "1".repeat(40);
const FULL_AUTHORITY = "12345678-1234-4123-8123-123456789abc";
const NOW = new Date("2026-08-28T00:00:00.000Z");

function pcm16Mono16k(seconds: 2 | 4 | 6 | 10): Uint8Array<ArrayBuffer> {
  const frames = seconds * 16_000;
  const bytes = new Uint8Array(44 + frames * 2);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  view.setUint32(4, bytes.byteLength - 8, true);
  bytes.set(new TextEncoder().encode("WAVEfmt "), 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16_000, true);
  view.setUint32(28, 32_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  bytes.set(new TextEncoder().encode("data"), 36);
  view.setUint32(40, frames * 2, true);
  for (let index = 0; index < frames; index += 1)
    view.setInt16(44 + index * 2, (index % 511) - 255, true);
  return bytes;
}

function png(): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(44);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  new DataView(bytes.buffer).setUint32(8, 13, false);
  bytes.set(new TextEncoder().encode("IHDR"), 12);
  new DataView(bytes.buffer).setUint32(16, 512, false);
  new DataView(bytes.buffer).setUint32(20, 512, false);
  bytes[24] = 8;
  bytes[25] = 2;
  return bytes;
}

function protectedInputs(): {
  readonly descriptors: V213QualificationProtectedInputDescriptors;
  readonly sources: V213QualificationProtectedSourceBytes;
} {
  const sources = {
    avatarSource: png(),
    soulx2s: pcm16Mono16k(2),
    soulx4s: pcm16Mono16k(4),
    soulx6s: pcm16Mono16k(6),
    soulx10s: pcm16Mono16k(10),
  };
  const descriptor = (
    path: string,
    bytes: Uint8Array,
    contentType: "image/png" | "audio/wav",
  ): V213QualificationProtectedInputDescriptor => ({
    path,
    sha256: hash(bytes),
    sizeBytes: bytes.byteLength,
    contentType,
  });
  return {
    sources,
    descriptors: {
      avatarSource: descriptor(".videoforge/private/avatar.png", sources.avatarSource, "image/png"),
      soulx2s: descriptor(".videoforge/private/audio-2s.wav", sources.soulx2s, "audio/wav"),
      soulx4s: descriptor(".videoforge/private/audio-4s.wav", sources.soulx4s, "audio/wav"),
      soulx6s: descriptor(".videoforge/private/audio-6s.wav", sources.soulx6s, "audio/wav"),
      soulx10s: descriptor(".videoforge/private/audio-10s.wav", sources.soulx10s, "audio/wav"),
    },
  };
}

function sourceRefs() {
  return {
    caseSource: {
      path: "apps/web/src/server/providers/v213-dual-lane-live.ts",
      sha256: proof("1"),
    },
    generators: {
      mage: { path: "deploy/v2-13/generate-mage-qualification-case.mjs", sha256: proof("2") },
      soulx: {
        path: "deploy/v2-13/generate-soulx-qualification-cases.mjs",
        sha256: proof("3"),
      },
    },
    validators: {
      mage: {
        path: "workers/image-media/src/videoforge_image_media/mage_production.py",
        sha256: proof("4"),
      },
      soulx: { path: "workers/avatar-primary/soulx_serverless.py", sha256: proof("5") },
    },
  } as const;
}

function deployment(lane: "mage" | "soulx") {
  return {
    lane,
    purpose: "qualification" as const,
    endpointId: `endpoint-${lane}`,
    endpointIdSha256: hash(`endpoint-${lane}`),
    templateId: `template-${lane}`,
    templateIdSha256: hash(`template-${lane}`),
    image: `ghcr.io/videoforge/${lane}@${proof("a")}`,
    sourceCommit: SOURCE_COMMIT,
    deploymentSha256: proof("b"),
    volumeIdSha256: proof("c"),
    volumeManifestSha256: proof("d"),
    volumeSizeGb: 50 as const,
    volumeMount: "/runpod-volume" as const,
    region: "EU-RO-1" as const,
    gpu: "NVIDIA GeForce RTX 4090" as const,
    gpuCount: 1 as const,
    workersMin: 0 as const,
    workersMax: 1 as const,
    idleTimeoutSeconds: 5 as const,
    handlerConcurrency: 1 as const,
    scalerType: "REQUEST_COUNT" as const,
    scalerValue: 1 as const,
    initTimeoutSeconds: 800,
  };
}

function harness() {
  const objects = new Map<
    string,
    { readonly bytes: Uint8Array; readonly contentType: string; readonly checksum: ArrayBuffer }
  >();
  const puts = vi.fn();
  const bucket: HostedR2BucketBinding = {
    head: async (key) => {
      const value = objects.get(key);
      return value
        ? {
            size: value.bytes.byteLength,
            httpMetadata: { contentType: value.contentType },
            checksums: { sha256: value.checksum },
          }
        : null;
    },
    get: async (key) => {
      const value = objects.get(key);
      return value
        ? {
            size: value.bytes.byteLength,
            httpMetadata: { contentType: value.contentType },
            arrayBuffer: async () => value.bytes.slice().buffer,
          }
        : null;
    },
    put: async (key, value, rawOptions) => {
      puts(key);
      const bytes = new Uint8Array(value as ArrayBuffer);
      const options = rawOptions as { readonly httpMetadata?: { readonly contentType?: string } };
      objects.set(key, {
        bytes,
        contentType: options.httpMetadata?.contentType ?? "application/octet-stream",
        checksum: await crypto.subtle.digest("SHA-256", bytes),
      });
      return {};
    },
    delete: async (keys) => {
      for (const key of typeof keys === "string" ? [keys] : keys) objects.delete(key);
    },
    list: async () => ({ objects: [], truncated: false }),
  };
  let persisted: unknown = null;
  const query = vi.fn(async (sql: string, parameters?: readonly unknown[]) => {
    if (sql.includes("set_config")) return { rows: [{ value: true }] };
    if (sql.includes("claim_v213_qualification_materialization"))
      return { rows: [{ value: "EXECUTE" }] };
    if (sql.includes("persist_v213_qualification_materialization")) {
      persisted = JSON.parse(String(parameters?.[0])).materialization;
      return { rows: [{ value: persisted }] };
    }
    if (sql.includes("read_v213_qualification_materialization"))
      return { rows: [{ value: persisted }] };
    throw new Error(`unexpected SQL: ${sql}`);
  });
  const database = {
    query,
    transaction: async (callback: (transaction: { query: typeof query }) => Promise<unknown>) =>
      callback({ query }),
  };
  let nonce = 0;
  const r2Signer = {
    sign: async (input: {
      readonly objectKey: string;
      readonly contentType: string;
      readonly contentLength: number;
      readonly checksumSha256: string;
    }) => ({
      method: "GET" as const,
      url: `https://r2.invalid/get/${input.objectKey}`,
      requiredHeaders: {},
      expiresAt: "2026-08-28T00:15:00.000Z",
      contentType: input.contentType,
      contentLength: input.contentLength,
      checksumSha256: input.checksumSha256,
    }),
    signGenerated: async (input: {
      readonly objectKey: string;
      readonly contentType: string;
      readonly maxContentLength: number;
    }) => ({
      method: "PUT" as const,
      url: `https://r2.invalid/put/${input.objectKey}`,
      requiredHeaders: { "content-type": input.contentType },
      expiresAt: "2026-08-28T00:15:00.000Z",
      contentType: input.contentType,
      maxContentLength: input.maxContentLength,
    }),
  };
  return {
    bucket,
    database,
    puts,
    query,
    r2Signer,
    randomHex: (bytes: number) => (++nonce).toString(16).padStart(bytes * 2, "0"),
  };
}

describe("V2-13 direct protected qualification materializer", () => {
  it("converts actual 16 kHz PCM to the exact 48 kHz worker contract", () => {
    const source = pcm16Mono16k(2);
    const result = buildV213SoulXQualificationWav(source, 2);
    const view = new DataView(result.buffer);
    expect(result.byteLength).toBe(44 + 144_000 * 2);
    expect(view.getUint32(24, true)).toBe(48_000);
    expect(view.getInt16(44, true)).toBe(view.getInt16(46, true));
    expect(view.getInt16(46, true)).toBe(view.getInt16(48, true));
    expect(view.getInt16(44 + 120_000 * 2, true)).toBe(0);
  });

  describe("direct R2 bounded reads", () => {
    const config = {
      accountId: "a".repeat(32),
      bucketName: "videoforge-private",
      accessKeyId: "A".repeat(24),
      secretAccessKey: "S".repeat(40),
    };
    const objectKey = ".videoforge/private/fixture.bin";
    type RangedBucket = HostedR2BucketBinding & {
      get(
        key: string,
        options?: { readonly range?: { readonly offset: number; readonly length: number } },
      ): ReturnType<HostedR2BucketBinding["get"]>;
    };
    const rangedGet = (
      bucket: HostedR2BucketBinding,
      key: string,
      options?: { readonly range?: { readonly offset: number; readonly length: number } },
    ) => (bucket as RangedBucket).get(key, options);

    it("sends a signed bounded Range and returns the full object size", async () => {
      const requests: Request[] = [];
      const bytes = Uint8Array.from([3, 4, 5]);
      const fetchPort = vi.fn(async (input: RequestInfo | URL) => {
        const request = input instanceof Request ? input : new Request(input);
        requests.push(request);
        return new Response(bytes, {
          status: 206,
          headers: {
            "content-length": "3",
            "content-range": "bytes 2-4/10",
            "content-type": "application/octet-stream",
          },
        });
      });
      const bucket = createV213DirectR2Bucket({ config, fetch: fetchPort });
      const object = await rangedGet(bucket, objectKey, { range: { offset: 2, length: 3 } });

      expect(object?.size).toBe(10);
      expect(requests[0]?.headers.get("range")).toBe("bytes=2-4");
      await expect(object?.arrayBuffer()).resolves.toEqual(bytes.buffer);
    });

    it.each([
      { range: { offset: -1, length: 1 } },
      { range: { offset: 0, length: 0 } },
      { range: { offset: 0, length: 16 * 1024 * 1024 + 1 } },
      { range: { offset: 1, length: 2 }, extra: true },
    ])("rejects malformed bounded range %#", async (options) => {
      const fetchPort = vi.fn();
      const bucket = createV213DirectR2Bucket({ config, fetch: fetchPort });
      await expect(rangedGet(bucket, objectKey, options)).rejects.toThrow(
        "V213_QUALIFICATION_R2_RANGE_INVALID",
      );
      expect(fetchPort).not.toHaveBeenCalled();
    });

    it("rejects range status, Content-Range, and body-length drift", async () => {
      const responses = [
        new Response(new Uint8Array([3, 4, 5]), {
          status: 200,
          headers: { "content-length": "3", "content-range": "bytes 2-4/10" },
        }),
        new Response(new Uint8Array([3, 4, 5]), {
          status: 206,
          headers: { "content-length": "3", "content-range": "bytes 1-3/10" },
        }),
        new Response(new Uint8Array([3, 4]), {
          status: 206,
          headers: { "content-length": "3", "content-range": "bytes 2-4/10" },
        }),
      ];
      for (const [index, expected] of [
        "V213_QUALIFICATION_R2_GET_REJECTED",
        "V213_QUALIFICATION_R2_GET_READBACK_DRIFT",
        "V213_QUALIFICATION_R2_GET_READBACK_DRIFT",
      ].entries()) {
        const fetchPort = vi.fn(async () => responses[index]!);
        const bucket = createV213DirectR2Bucket({ config, fetch: fetchPort });
        const objectPromise = rangedGet(bucket, objectKey, { range: { offset: 2, length: 3 } });
        if (index < 2) {
          await expect(objectPromise).rejects.toThrow(expected);
        } else {
          const object = await objectPromise;
          await expect(object?.arrayBuffer()).rejects.toThrow(expected);
        }
      }
    });

    it("preserves the full GET 200 path", async () => {
      const bytes = Uint8Array.from([7, 8, 9, 10]);
      const requests: Request[] = [];
      const fetchPort = vi.fn(async (input: RequestInfo | URL) => {
        const request = input instanceof Request ? input : new Request(input);
        requests.push(request);
        return new Response(bytes, {
          status: 200,
          headers: { "content-length": "4", "content-type": "application/octet-stream" },
        });
      });
      const bucket = createV213DirectR2Bucket({ config, fetch: fetchPort });
      const object = await bucket.get(objectKey);

      expect(object?.size).toBe(4);
      expect(requests[0]?.headers.get("range")).toBeNull();
      await expect(object?.arrayBuffer()).resolves.toEqual(bytes.buffer);
    });
  });

  it("materializes SoulX only after protected rehash, R2 CAS, HMAC, persist, and readback", async () => {
    const protectedValues = protectedInputs();
    const test = harness();
    const materialize = createV213DirectQualificationMaterializer({
      fullLiveAuthorityId: FULL_AUTHORITY,
      operationId: "soulx-live-qualification",
      outerStateSha256: proof("6"),
      sourceCommit: SOURCE_COMMIT,
      sourceRefs: sourceRefs(),
      protectedInputDescriptors: protectedValues.descriptors,
      protectedSourceBytes: protectedValues.sources,
      r2: {
        accountId: "a".repeat(32),
        bucketName: "videoforge-private",
        accessKeyId: "A".repeat(24),
        secretAccessKey: "S".repeat(40),
      },
      signing: { secretHex: "ab".repeat(32), keyId: "qualification-key-v1" },
      database: test.database as never,
      bucket: test.bucket,
      r2Signer: test.r2Signer,
      now: () => NOW,
      randomHex: test.randomHex,
    });
    const result = await materialize({
      descriptor: {
        key: "soulx2s",
        lane: "soulx",
        id: "soulx-cold-2s",
        seconds: 2,
        mode: "complete",
        cold: true,
      },
      deployment: deployment("soulx"),
      stageAuthorityId: "soulx-stage-authority",
      inputSha256: proof("7"),
    });
    expect(result.schemaVersion).toBe("videoforge.v213-qualification-case-materialization/v1");
    expect((result.request as Record<string, unknown>).envelope).toBeTruthy();
    expect(test.puts).toHaveBeenCalledTimes(2);
    expect(test.query.mock.calls.some(([sql]) => sql.includes("persist_v213"))).toBe(true);
    expect(test.query.mock.calls.some(([sql]) => sql.includes("read_v213"))).toBe(true);
    expect(Object.keys(test)).not.toContain("dispatch");
  });

  it("fails protected byte drift before any DB or R2 call", () => {
    const protectedValues = protectedInputs();
    const test = harness();
    const drifted = {
      ...protectedValues.sources,
      soulx4s: Uint8Array.from(protectedValues.sources.soulx4s, (value, index) =>
        index === 50 ? value ^ 1 : value,
      ),
    };
    expect(() =>
      createV213DirectQualificationMaterializer({
        fullLiveAuthorityId: FULL_AUTHORITY,
        operationId: "soulx-live-qualification",
        outerStateSha256: proof("8"),
        sourceCommit: SOURCE_COMMIT,
        sourceRefs: sourceRefs(),
        protectedInputDescriptors: protectedValues.descriptors,
        protectedSourceBytes: drifted,
        r2: {
          accountId: "a".repeat(32),
          bucketName: "videoforge-private",
          accessKeyId: "A".repeat(24),
          secretAccessKey: "S".repeat(40),
        },
        signing: { secretHex: "ab".repeat(32), keyId: "qualification-key-v1" },
        database: test.database as never,
        bucket: test.bucket,
        r2Signer: test.r2Signer,
      }),
    ).toThrow("V213_QUALIFICATION_PROTECTED_INPUT_DRIFT");
    expect(test.query).not.toHaveBeenCalled();
    expect(test.puts).not.toHaveBeenCalled();
  });
});

import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { HostedR2BucketBinding } from "./configuration.js";
import {
  buildV213QualificationMaterializationRequest,
  cleanupV213QualificationInputs,
  materializeV213QualificationCase,
  V208_SOULX_WHOLE_SPAN_DESCRIPTORS,
  type V213QualificationMaterializationRequest,
  type V213QualificationMaterializationRouteResult,
  type V213QualificationMaterializationStore,
} from "./v213-qualification-materializer.js";

const hash = (bytes: Uint8Array | string) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}` as const;
const proof = (letter: string) => `sha256:${letter.repeat(64)}` as const;
const NOW = "2026-08-28T00:00:00.000Z";
const FULL_AUTHORITY = "12345678-1234-4123-8123-123456789abc";
const SOURCE = "1".repeat(40);

function png(): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  new DataView(bytes.buffer).setUint32(8, 13, false);
  bytes.set(new TextEncoder().encode("IHDR"), 12);
  new DataView(bytes.buffer).setUint32(16, 512, false);
  new DataView(bytes.buffer).setUint32(20, 512, false);
  bytes[24] = 8;
  bytes[25] = 2;
  return bytes;
}

function wav(frames = 144_000): Uint8Array {
  const bytes = new Uint8Array(44 + frames * 2);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  view.setUint32(4, bytes.byteLength - 8, true);
  bytes.set(new TextEncoder().encode("WAVEfmt "), 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 48_000, true);
  view.setUint32(28, 96_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  bytes.set(new TextEncoder().encode("data"), 36);
  view.setUint32(40, frames * 2, true);
  return bytes;
}

const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

function deployment(lane: "mage" | "soulx") {
  return {
    lane,
    purpose: "qualification" as const,
    endpointId: `endpoint-${lane}`,
    endpointIdSha256: hash(`endpoint-${lane}`),
    templateId: `template-${lane}`,
    templateIdSha256: hash(`template-${lane}`),
    image: `registry.example/videoforge-${lane}@${proof("a")}`,
    sourceCommit: SOURCE,
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

function refs(lane: "mage" | "soulx") {
  return {
    caseSourceRef: {
      path: "apps/web/src/server/providers/v213-dual-lane-live.ts",
      sha256: proof("1"),
    },
    generatorRef: {
      path:
        lane === "mage"
          ? "deploy/v2-13/generate-mage-qualification-case.mjs"
          : "deploy/v2-13/generate-soulx-qualification-cases.mjs",
      sha256: proof("2"),
    },
    validatorRef: {
      path:
        lane === "mage"
          ? "workers/image-media/src/videoforge_image_media/mage_production.py"
          : "workers/avatar-primary/soulx_serverless.py",
      sha256: proof("3"),
    },
  };
}

function soulxRequest(
  mode: "complete" | "cancel" | "invalid" | "timeout" = "complete",
): V213QualificationMaterializationRequest {
  const source = png();
  const audio = wav();
  return buildV213QualificationMaterializationRequest({
    schemaVersion: "videoforge.v213-qualification-materialization-request/v1",
    fullLiveAuthorityId: FULL_AUTHORITY,
    operationId: "soulx-live-qualification",
    stageAuthorityId: "soulx-stage-authority",
    outerStateSha256: proof("4"),
    inputSha256: proof("5"),
    sourceCommit: SOURCE,
    descriptor: {
      key:
        mode === "cancel"
          ? "soulxCancel"
          : mode === "invalid"
            ? "soulxInvalidOutput"
            : mode === "timeout"
              ? "soulxTimeout"
              : "soulx2s",
      lane: "soulx",
      id:
        mode === "cancel"
          ? "soulx-cancel"
          : mode === "invalid"
            ? "soulx-invalid-output"
            : mode === "timeout"
              ? "soulx-timeout"
              : "soulx-cold-2s",
      seconds: 2,
      mode,
      cold: mode === "complete",
    },
    ...refs("soulx"),
    deployment: deployment("soulx"),
    inputs: [
      {
        role: "avatar_source",
        assetId: "source",
        reservationId: "source-port",
        contentType: "image/png",
        sha256: hash(source),
        bodyBase64: base64(source),
      },
      {
        role: "audio",
        assetId: "audio-2s",
        reservationId: "audio-port-2s",
        contentType: "audio/wav",
        sha256: hash(audio),
        bodyBase64: base64(audio),
      },
    ],
  });
}

function wholeSpanRequest(): V213QualificationMaterializationRequest {
  const source = png();
  const seconds = [2, 4, 6, 10] as const;
  return buildV213QualificationMaterializationRequest({
    schemaVersion: "videoforge.v213-qualification-materialization-request/v1",
    fullLiveAuthorityId: FULL_AUTHORITY,
    operationId: "soulx-live-qualification",
    stageAuthorityId: "soulx-stage-authority",
    outerStateSha256: proof("4"),
    inputSha256: proof("5"),
    sourceCommit: SOURCE,
    descriptor: V208_SOULX_WHOLE_SPAN_DESCRIPTORS[0],
    ...refs("soulx"),
    deployment: deployment("soulx"),
    inputs: [
      {
        role: "avatar_source",
        assetId: "source",
        reservationId: "source-port",
        contentType: "image/png",
        sha256: hash(source),
        bodyBase64: base64(source),
      },
      ...seconds.map((value) => {
        const audio = wav(Math.max(144_000, value * 48_000));
        return {
          role: "audio" as const,
          assetId: `audio-${value}s`,
          reservationId: `audio-port-${value}s`,
          contentType: "audio/wav" as const,
          sha256: hash(audio),
          bodyBase64: base64(audio),
        };
      }),
    ],
  });
}

function mageRequest(): V213QualificationMaterializationRequest {
  return buildV213QualificationMaterializationRequest({
    schemaVersion: "videoforge.v213-qualification-materialization-request/v1",
    fullLiveAuthorityId: FULL_AUTHORITY,
    operationId: "mage-live-qualification",
    stageAuthorityId: "mage-stage-authority",
    outerStateSha256: proof("6"),
    inputSha256: proof("7"),
    sourceCommit: SOURCE,
    descriptor: {
      key: "mage",
      lane: "mage",
      id: "mage-cold-representative",
      seconds: 0,
      mode: "complete",
      cold: true,
    },
    ...refs("mage"),
    deployment: deployment("mage"),
    inputs: [],
  });
}

function harness(
  options: {
    failPutNumber?: number;
    deleteLostAck?: boolean;
    putLostAck?: boolean;
    persistLostAck?: boolean;
    persistAbsent?: boolean;
    readAmbiguousAfterPersist?: boolean;
  } = {},
) {
  const objects = new Map<
    string,
    { bytes: Uint8Array; contentType: string; checksum: ArrayBuffer }
  >();
  const puts = vi.fn();
  const deletes = vi.fn();
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
            arrayBuffer: async () => value.bytes.buffer as ArrayBuffer,
          }
        : null;
    },
    put: async (key, value, rawOptions) => {
      puts(key);
      if (options.failPutNumber === puts.mock.calls.length) throw new Error("put failed");
      const bytes = new Uint8Array(value as ArrayBuffer);
      const optionsValue = rawOptions as { httpMetadata?: { contentType?: string } };
      const checksum = await crypto.subtle.digest("SHA-256", bytes);
      objects.set(key, {
        bytes,
        contentType: optionsValue.httpMetadata?.contentType ?? "application/octet-stream",
        checksum,
      });
      if (options.putLostAck) throw new Error("lost ack");
      return {};
    },
    list: async () => ({ objects: [], truncated: false }),
    delete: async (keys) => {
      deletes(keys);
      for (const key of typeof keys === "string" ? [keys] : keys) objects.delete(key);
      if (options.deleteLostAck) throw new Error("lost delete ack");
    },
  };
  let intentRequest: V213QualificationMaterializationRequest | null = null;
  let result: V213QualificationMaterializationRouteResult | null = null;
  let persistenceAttempted = false;
  const store: V213QualificationMaterializationStore = {
    claim: async (request) => {
      if (!intentRequest) {
        intentRequest = structuredClone(request);
        return "EXECUTE";
      }
      if (intentRequest.requestSha256 !== request.requestSha256)
        throw new Error("source/authority replay drift");
      return result ? "EXISTING" : "RECONCILE";
    },
    persist: async (_request, value) => {
      persistenceAttempted = true;
      if (!options.persistAbsent) result = structuredClone(value);
      if (options.persistLostAck || options.persistAbsent || options.readAmbiguousAfterPersist)
        throw new Error("lost persist ack");
      return value;
    },
    read: async () => {
      if (options.readAmbiguousAfterPersist && persistenceAttempted)
        throw new Error("read ambiguity");
      return result;
    },
  };
  let random = 0;
  return {
    bucket,
    objects,
    puts,
    deletes,
    store,
    dependencies: {
      bucket,
      store,
      signing: { secretHex: "ab".repeat(32), keyId: "qualification-key-v1" },
      r2Signer: {
        sign: async ({
          objectKey,
          contentType,
          contentLength,
          checksumSha256,
        }: {
          objectKey: string;
          contentType: string;
          contentLength: number;
          checksumSha256: string;
        }) => ({
          method: "GET" as const,
          url: `https://r2.invalid/get/${objectKey}`,
          requiredHeaders: {},
          expiresAt: "2026-08-28T00:15:00.000Z",
          contentType,
          contentLength,
          checksumSha256,
        }),
        signGenerated: async ({
          objectKey,
          contentType,
          maxContentLength,
        }: {
          objectKey: string;
          contentType: string;
          maxContentLength: number;
        }) => ({
          method: "PUT" as const,
          url: `https://r2.invalid/put/${objectKey}`,
          requiredHeaders: { "content-type": contentType },
          expiresAt: "2026-08-28T00:15:00.000Z",
          contentType,
          maxContentLength,
        }),
      },
      now: () => new Date(NOW),
      randomHex: (bytes: number) => (++random).toString(16).padStart(bytes * 2, "0"),
    },
  };
}

describe("V2-13 JIT qualification materializer", () => {
  it("materializes the distinct V2-08 2/4/6/10 whole-span batch without changing V2-13", async () => {
    const test = harness();
    const result = await materializeV213QualificationCase(wholeSpanRequest(), test.dependencies);
    const worker = result.materialization.request as Record<string, unknown>;
    const batch = worker.batch as { spans: readonly unknown[] };
    expect(batch.spans).toHaveLength(4);
    expect(worker.input_get_urls).toHaveLength(5);
    expect(worker.output_put_urls).toHaveLength(4);
    expect(worker.generated_output_authorities).toHaveLength(4);
    expect(
      (worker.envelope as { limits: { execution_timeout_seconds: number } }).limits
        .execution_timeout_seconds,
    ).toBe(800);
  });

  it("stages exact SoulX inputs and returns a signed worker-contract request with bounded ports", async () => {
    const test = harness();
    const request = soulxRequest();
    const result = await materializeV213QualificationCase(request, test.dependencies);
    const worker = result.materialization.request as Record<string, unknown>;
    const envelope = worker.envelope as Record<string, unknown>;
    const ports = worker.ports as { inputs: readonly Record<string, unknown>[] };
    expect(envelope.schema).toBe("serverless-worker-job-envelope/v3");
    expect((envelope.signature as Record<string, unknown>).key_id).toBe("qualification-key-v1");
    expect(ports.inputs.map((port) => port.method)).toEqual(["GET", "GET"]);
    expect(worker.input_get_urls).toHaveLength(2);
    expect(worker.output_put_urls).toHaveLength(1);
    expect(test.puts).toHaveBeenCalledTimes(2);
    expect(test.deletes).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("abababababababab");
  });

  it("materializes invalid-output with the exact authenticated worker probe", async () => {
    const test = harness();
    const result = await materializeV213QualificationCase(
      soulxRequest("invalid"),
      test.dependencies,
    );
    const worker = result.materialization.request as Record<string, unknown>;
    expect(worker.qualification_probe).toBe("SOULX_INVALID_OUTPUT_CONTRACT_V1");
    expect(
      (worker.envelope as { limits: { execution_timeout_seconds: number } }).limits
        .execution_timeout_seconds,
    ).toBe(60);
  });

  it("materializes timeout with the exact authenticated worker probe", async () => {
    const test = harness();
    const result = await materializeV213QualificationCase(
      soulxRequest("timeout"),
      test.dependencies,
    );
    const worker = result.materialization.request as Record<string, unknown>;
    expect(worker.qualification_probe).toBe("RUNPOD_EXECUTION_TIMEOUT_V1");
    expect(
      (worker.envelope as { limits: { execution_timeout_seconds: number } }).limits
        .execution_timeout_seconds,
    ).toBe(5);
  });

  it("materializes cancellation with the exact signed 60-second ceiling and no probe", async () => {
    const test = harness();
    const result = await materializeV213QualificationCase(
      soulxRequest("cancel"),
      test.dependencies,
    );
    const worker = result.materialization.request as Record<string, unknown>;
    expect(worker).not.toHaveProperty("qualification_probe");
    expect(
      (worker.envelope as { limits: { execution_timeout_seconds: number } }).limits
        .execution_timeout_seconds,
    ).toBe(60);
  });

  it("builds the complete 32-item MageJob and never exposes a provider dispatch surface", async () => {
    const test = harness();
    const result = await materializeV213QualificationCase(mageRequest(), test.dependencies);
    const worker = result.materialization.request as Record<string, unknown>;
    const batch = worker.batch as { items: readonly unknown[] };
    expect(batch.items).toHaveLength(32);
    expect(worker.output_put_urls).toHaveLength(32);
    expect(Object.keys(test.dependencies).sort()).not.toContain("dispatch");
    expect(test.puts).not.toHaveBeenCalled();
  });

  it("reconciles a lost R2 PUT acknowledgement by exact size/type/checksum readback", async () => {
    const test = harness({ putLostAck: true });
    await expect(
      materializeV213QualificationCase(soulxRequest(), test.dependencies),
    ).resolves.toBeTruthy();
    expect(test.puts).toHaveBeenCalledTimes(2);
  });

  it("returns the exact persisted materialization on replay without restaging or reminting ports", async () => {
    const test = harness();
    const request = soulxRequest();
    const first = await materializeV213QualificationCase(request, test.dependencies);
    const second = await materializeV213QualificationCase(request, test.dependencies);
    expect(second).toEqual(first);
    expect(test.puts).toHaveBeenCalledTimes(2);
  });

  it("recovers a lost database persistence acknowledgement without deleting live staged inputs", async () => {
    const test = harness({ persistLostAck: true });
    await expect(
      materializeV213QualificationCase(soulxRequest(), test.dependencies),
    ).resolves.toBeTruthy();
    expect(test.deletes).not.toHaveBeenCalled();
  });

  it("retains staged inputs when persistence readback is ambiguous", async () => {
    const test = harness({ readAmbiguousAfterPersist: true });
    await expect(
      materializeV213QualificationCase(soulxRequest(), test.dependencies),
    ).rejects.toThrow("PERSISTENCE_READ_AMBIGUOUS");
    expect(test.deletes).not.toHaveBeenCalled();
    expect(test.objects.size).toBe(2);
  });

  it("deletes only attributable staged inputs when persistence is proven absent", async () => {
    const test = harness({ persistAbsent: true });
    await expect(
      materializeV213QualificationCase(soulxRequest(), test.dependencies),
    ).rejects.toThrow("PERSIST_ACK_UNKNOWN");
    expect(test.deletes).toHaveBeenCalledTimes(2);
    expect(test.objects.size).toBe(0);
  });

  it("cleans an attributable earlier input when staging a later input fails", async () => {
    const test = harness({ failPutNumber: 2 });
    await expect(
      materializeV213QualificationCase(soulxRequest(), test.dependencies),
    ).rejects.toThrow("R2_PUT_ACK_UNKNOWN");
    expect(test.deletes).toHaveBeenCalledTimes(1);
    expect(test.objects.size).toBe(0);
  });

  it.each(["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"] as const)(
    "deletes and proves all staged inputs absent after terminal %s",
    async (terminalOutcome) => {
      const test = harness();
      const request = soulxRequest();
      await materializeV213QualificationCase(request, test.dependencies);
      expect(test.objects.size).toBe(2);
      const evidence = await cleanupV213QualificationInputs(request, {
        bucket: test.bucket,
        terminalOutcome,
      });
      expect(evidence).toMatchObject({
        schemaVersion: "videoforge.v213-qualification-input-cleanup/v1",
        requestSha256: request.requestSha256,
        terminalOutcome,
        absenceVerified: true,
      });
      expect(evidence.deletedObjectKeySha256s).toHaveLength(2);
      expect(test.objects.size).toBe(0);
    },
  );

  it("reconciles lost terminal delete acknowledgements only after absence readback", async () => {
    const test = harness({ deleteLostAck: true });
    const request = soulxRequest();
    await materializeV213QualificationCase(request, test.dependencies);
    await expect(
      cleanupV213QualificationInputs(request, { bucket: test.bucket, terminalOutcome: "FAILED" }),
    ).resolves.toMatchObject({ absenceVerified: true });
    expect(test.objects.size).toBe(0);
  });

  it("fails before R2 mutation on source, authority, body, or operation drift", async () => {
    const test = harness();
    const valid = soulxRequest();
    for (const mutation of [
      { ...valid, sourceCommit: "2".repeat(40) },
      { ...valid, outerStateSha256: proof("9") },
      { ...valid, operationId: "mage-live-qualification" as const },
      { ...valid, requestSha256: proof("8") },
      { ...valid, generatorRef: { ...valid.generatorRef, path: "deploy/v2-13/foreign.mjs" } },
      {
        ...valid,
        deployment: { ...valid.deployment, endpointIdSha256: proof("7") },
      },
      { ...valid, inputs: [...valid.inputs].reverse() },
    ]) {
      await expect(materializeV213QualificationCase(mutation, test.dependencies)).rejects.toThrow();
    }
    expect(test.puts).not.toHaveBeenCalled();
  });

  it("rejects a conflicting existing R2 object without mutation or cleanup", async () => {
    const test = harness();
    const request = soulxRequest();
    const source = request.inputs[0]!;
    const attemptId = `v213-${request.descriptor.id}-${request.requestSha256.slice(7, 19)}`;
    const key =
      `tenant/${FULL_AUTHORITY}/workspace/soulx-stage-authority/project/v213-qualification/` +
      `revision/${SOURCE}/lane/input/job/${attemptId}/artifact/${source.assetId}`;
    test.objects.set(key, {
      bytes: new Uint8Array([1]),
      contentType: "image/png",
      checksum: await crypto.subtle.digest("SHA-256", new Uint8Array([1])),
    });
    await expect(materializeV213QualificationCase(request, test.dependencies)).rejects.toThrow(
      "R2_OBJECT_DRIFT",
    );
    expect(test.puts).not.toHaveBeenCalled();
    expect(test.deletes).not.toHaveBeenCalled();
  });
});

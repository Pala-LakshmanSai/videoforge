import { describe, expect, it, vi } from "vitest";

import {
  cleanupFailedV207Resources,
  loadConfiguredRunPodKey,
  V207_FAILED_CLEANUP_ENDPOINT_NAME,
  V207_FAILED_CLEANUP_MANIFEST_SHA256,
  V207_FAILED_CLEANUP_RECEIPT_KEY_ID,
  V207_FAILED_CLEANUP_TEMPLATE_NAME,
  V207_FAILED_CLEANUP_VOLUME_ID,
  V207_FAILED_CLEANUP_VOLUME_ID_HASH,
} from "./runpod-v207-failed-cleanup";
import { RunPodControlClient } from "./runpod-control";
import { V207_REPAIRED_IMAGE } from "./v207-activation-authority";

const apiKey = "runpod-test-key-at-least-twenty-characters";
const controlBaseUrl = "http://127.0.0.1:43123";
const jsonResponse = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });

const templateEnvironment = {
  DIFFUSERS_OFFLINE: "1",
  HF_HUB_OFFLINE: "1",
  LOG_LEVEL: "INFO",
  MAGE_MODEL_ROOT: "/runpod-volume/mage-model",
  RUNPOD_INIT_TIMEOUT: "800",
  TRANSFORMERS_OFFLINE: "1",
  VIDEOFORGE_MAGE_GPU_OFFERING_ID: "NVIDIA GeForce RTX 4090",
  VIDEOFORGE_MAGE_MANIFEST_SHA256: V207_FAILED_CLEANUP_MANIFEST_SHA256,
  VIDEOFORGE_MAGE_VOLUME_ID_HASH: V207_FAILED_CLEANUP_VOLUME_ID_HASH,
  VIDEOFORGE_MAGE_WORKER_IMAGE_DIGEST: V207_REPAIRED_IMAGE,
  VIDEOFORGE_MAGE_WORKER_TOKEN: "a".repeat(64),
  VIDEOFORGE_RECEIPT_KEY_ID: V207_FAILED_CLEANUP_RECEIPT_KEY_ID,
  VIDEOFORGE_RECEIPT_SIGNING_KEY_HEX: "b".repeat(64),
};

const health = {
  workers: {
    idle: 0,
    running: 0,
    initializing: 0,
    ready: 0,
    throttled: 0,
    unhealthy: 0,
  },
  jobs: { inQueue: 0, inProgress: 0 },
};

type FixtureOptions = {
  readonly endpointPatch?: Record<string, unknown>;
  readonly templatePatch?: Record<string, unknown>;
  readonly volumePatch?: Record<string, unknown>;
  readonly workerStatus?: string;
  readonly keepEndpointAfterDelete?: boolean;
  readonly keepTemplateAfterDelete?: boolean;
  readonly unstableWorkers?: boolean;
};

function makeFixture(options: FixtureOptions = {}) {
  let endpointPresent = true;
  let templatePresent = true;
  let endpointReads = 0;
  const calls: Array<{ readonly method: string; readonly path: string }> = [];
  const workerStatus = options.workerStatus ?? "EXITED";
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const path = url.pathname;
    calls.push({ method, path });

    if (path === "/pods") {
      return jsonResponse(
        endpointPresent
          ? [
              {
                id: "pod_10",
                desiredStatus: workerStatus,
                status: workerStatus,
                endpointId: "endpoint_10",
              },
            ]
          : [],
      );
    }
    if (path === "/networkvolumes") {
      return jsonResponse([
        {
          id: V207_FAILED_CLEANUP_VOLUME_ID,
          size: 50,
          dataCenterId: "EU-RO-1",
        },
        { id: "soulx_volume", size: 50, dataCenterId: "EU-RO-1" },
      ]);
    }
    if (path === "/endpoints" && method === "GET") {
      endpointReads += 1;
      const currentWorkerStatus =
        options.unstableWorkers && endpointReads >= 4 ? "TERMINATED" : workerStatus;
      if (!endpointPresent) return jsonResponse([]);
      return jsonResponse([
        {
          id: "endpoint_10",
          name: V207_FAILED_CLEANUP_ENDPOINT_NAME,
          templateId: "template_10",
          computeType: "GPU",
          workersMin: 0,
          workersMax: 1,
          gpuCount: 1,
          gpuTypeIds: ["NVIDIA GeForce RTX 4090"],
          allowedCudaVersions: ["13.0"],
          minCudaVersion: "13.0",
          flashboot: false,
          networkVolumeId: V207_FAILED_CLEANUP_VOLUME_ID,
          dataCenterIds: ["EU-RO-1"],
          idleTimeout: 5,
          executionTimeoutMs: 2_400_000,
          scalerType: "REQUEST_COUNT",
          scalerValue: 1,
          workers: [{ desiredStatus: currentWorkerStatus, status: currentWorkerStatus }],
          ...options.endpointPatch,
        },
      ]);
    }
    if (path === "/templates" && method === "GET") {
      if (!templatePresent) return jsonResponse([]);
      return jsonResponse([
        {
          id: "template_10",
          name: V207_FAILED_CLEANUP_TEMPLATE_NAME,
          imageName: V207_REPAIRED_IMAGE,
          containerDiskInGb: 120,
          isPublic: false,
          isServerless: true,
          volumeInGb: 0,
          volumeMountPath: "/runpod-volume",
          env: templateEnvironment,
          ...options.templatePatch,
        },
      ]);
    }
    if (path === "/endpoints/endpoint_10" && method === "DELETE") {
      if (!options.keepEndpointAfterDelete) endpointPresent = false;
      return new Response(null, { status: 204 });
    }
    if (path === "/templates/template_10" && method === "DELETE") {
      if (!options.keepTemplateAfterDelete) templatePresent = false;
      return new Response(null, { status: 204 });
    }
    throw new Error(`unexpected request ${method} ${path}`);
  });
  return { calls, fetch };
}

function makeControl(fetch: typeof globalThis.fetch): RunPodControlClient {
  return new RunPodControlClient({ apiKey, fetch, baseUrl: controlBaseUrl });
}

async function cleanupFixture(options: FixtureOptions = {}) {
  const fixture = makeFixture(options);
  const result = await cleanupFailedV207Resources({
    apiKey,
    control: makeControl(fixture.fetch),
    fetch: fixture.fetch,
    sleep: async () => undefined,
  });
  return { fixture, result };
}

describe("V2-07 failed-resource cleanup", () => {
  it("loads a configured key without logging or accepting malformed credentials", async () => {
    const loader = vi.fn(async () => apiKey);
    await expect(loadConfiguredRunPodKey({}, loader)).resolves.toBe(apiKey);
    expect(loader).toHaveBeenCalledOnce();
    await expect(loadConfiguredRunPodKey({ RUNPOD_KEY: "too-short" }, loader)).rejects.toThrow(
      "V207_CLEANUP_AUTH_INVALID",
    );
    expect(loader).toHaveBeenCalledOnce();
  });

  it("validates two stable terminal snapshots, deletes endpoint then template, and never touches volumes", async () => {
    const { fixture, result } = await cleanupFixture();
    expect(result).toMatchObject({
      schemaVersion: "videoforge.v2-07-failed-cleanup/v1",
      stableTerminalSnapshotCount: 2,
      endpointWorkerRecordCount: 1,
      terminalPodRecordCount: 1,
      endpointDeleted: true,
      templateDeleted: true,
      finalDisposableResourcesAbsent: true,
      retainedVolumeIdHash: V207_FAILED_CLEANUP_VOLUME_ID_HASH,
    });
    expect(fixture.calls.filter((call) => call.method === "DELETE")).toEqual([
      { method: "DELETE", path: "/endpoints/endpoint_10" },
      { method: "DELETE", path: "/templates/template_10" },
    ]);
    expect(
      fixture.calls.some((call) => call.method === "DELETE" && call.path === "/networkvolumes"),
    ).toBe(false);
  });

  it("accepts the provider's desiredStatus-only terminal worker shape", async () => {
    const { result } = await cleanupFixture({
      endpointPatch: { workers: [{ desiredStatus: "EXITED" }] },
    });
    expect(result.finalDisposableResourcesAbsent).toBe(true);
  });

  it.each([
    ["image", { templatePatch: { imageName: "ghcr.io/wrong/image@sha256:" + "c".repeat(64) } }],
    ["GPU", { endpointPatch: { gpuTypeIds: ["NVIDIA GeForce RTX 5090"] } }],
    ["CUDA", { endpointPatch: { minCudaVersion: "12.8" } }],
    ["volume", { endpointPatch: { networkVolumeId: "other_volume" } }],
    ["region", { endpointPatch: { dataCenterIds: ["US-KS-2"] } }],
    ["policy", { endpointPatch: { workersMax: 2 } }],
    ["FlashBoot", { endpointPatch: { flashboot: true } }],
  ] as const)("fails closed for exact %s drift before mutation", async (_label, options) => {
    const fixture = makeFixture(options);
    await expect(
      cleanupFailedV207Resources({
        apiKey,
        control: makeControl(fixture.fetch),
        fetch: fixture.fetch,
        sleep: async () => undefined,
      }),
    ).rejects.toThrow(/V207_CLEANUP_(?:TEMPLATE|ENDPOINT|VOLUME)_/u);
    expect(fixture.calls.some((call) => call.method === "DELETE")).toBe(false);
  });

  it.each([
    ["active worker", { workerStatus: "RUNNING" }],
    ["unstable terminal snapshots", { unstableWorkers: true }],
    ["missing worker records", { endpointPatch: { workers: undefined } }],
    [
      "conflicting worker statuses",
      { endpointPatch: { workers: [{ desiredStatus: "EXITED", status: "TERMINATED" }] } },
    ],
  ] as const)("does not delete on %s", async (_label, options) => {
    const fixture = makeFixture(options);
    await expect(
      cleanupFailedV207Resources({
        apiKey,
        control: makeControl(fixture.fetch),
        fetch: fixture.fetch,
        sleep: async () => undefined,
      }),
    ).rejects.toThrow();
    expect(fixture.calls.some((call) => call.method === "DELETE")).toBe(false);
  });

  it("does not delete the bound template when endpoint absence is not read back", async () => {
    const fixture = makeFixture({ keepEndpointAfterDelete: true });
    await expect(
      cleanupFailedV207Resources({
        apiKey,
        control: makeControl(fixture.fetch),
        fetch: fixture.fetch,
        sleep: async () => undefined,
      }),
    ).rejects.toThrow("V207_CLEANUP_ENDPOINT_ABSENCE_UNCONFIRMED");
    expect(fixture.calls).toContainEqual({ method: "DELETE", path: "/endpoints/endpoint_10" });
    expect(fixture.calls).not.toContainEqual({
      method: "DELETE",
      path: "/templates/template_10",
    });
  });

  it("reports template cleanup uncertainty without retrying or touching volumes", async () => {
    const fixture = makeFixture({ keepTemplateAfterDelete: true });
    await expect(
      cleanupFailedV207Resources({
        apiKey,
        control: makeControl(fixture.fetch),
        fetch: fixture.fetch,
        sleep: async () => undefined,
      }),
    ).rejects.toThrow("V207_CLEANUP_RESOURCE_ABSENCE_UNCONFIRMED");
    expect(fixture.calls.filter((call) => call.method === "DELETE")).toEqual([
      { method: "DELETE", path: "/endpoints/endpoint_10" },
      { method: "DELETE", path: "/templates/template_10" },
    ]);
    expect(
      fixture.calls.some((call) => call.method === "DELETE" && call.path === "/networkvolumes"),
    ).toBe(false);
  });
});

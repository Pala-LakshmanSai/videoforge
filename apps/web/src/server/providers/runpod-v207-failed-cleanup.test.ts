import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

import {
  cleanupFailedV207Resources,
  loadConfiguredRunPodKey,
  V207_FAILED_CLEANUP_ENDPOINT_NAME,
  V207_FAILED_CLEANUP_MANIFEST_SHA256,
  V207_FAILED_CLEANUP_RECEIPT_KEY_ID,
  V207_FAILED_CLEANUP_SOULX_VOLUME_ID_HASH,
  V207_FAILED_CLEANUP_TEMPLATE_NAME,
  V207_FAILED_CLEANUP_VOLUME_ID,
  V207_FAILED_CLEANUP_VOLUME_ID_HASH,
} from "./runpod-v207-failed-cleanup";
import { RunPodControlClient } from "./runpod-control";
import { V207_REPAIRED_IMAGE } from "./v207-activation-authority";

const apiKey = "runpod-test-key-at-least-twenty-characters";
const controlBaseUrl = "http://127.0.0.1:43123";
const endpointIdHash = `sha256:${createHash("sha256").update("endpoint_10").digest("hex")}`;
const workerToken = "a".repeat(64);
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
  VIDEOFORGE_ENVELOPE_KEY_ID: "worker-key-1",
  VIDEOFORGE_ENVELOPE_KEY_SHA256: `sha256:${createHash("sha256")
    .update(Buffer.from(workerToken, "hex"))
    .digest("hex")}`,
  VIDEOFORGE_ENVELOPE_SIGNING_KEY_HEX: workerToken,
  VIDEOFORGE_JOB_SCRATCH_ROOT: "/tmp/videoforge-jobs",
  VIDEOFORGE_MAGE_GPU_OFFERING_ID: "NVIDIA GeForce RTX 4090",
  VIDEOFORGE_MAGE_MANIFEST_SHA256: V207_FAILED_CLEANUP_MANIFEST_SHA256,
  VIDEOFORGE_MAGE_VOLUME_ID_HASH: V207_FAILED_CLEANUP_VOLUME_ID_HASH,
  VIDEOFORGE_MAGE_WORKER_IMAGE_DIGEST: V207_REPAIRED_IMAGE,
  VIDEOFORGE_MAGE_WORKER_TOKEN: workerToken,
  VIDEOFORGE_RECEIPT_KEY_ID: V207_FAILED_CLEANUP_RECEIPT_KEY_ID,
  VIDEOFORGE_RECEIPT_SIGNING_KEY_HEX: "b".repeat(64),
};

type FixtureOptions = {
  readonly endpointPatch?: Record<string, unknown>;
  readonly templatePatch?: Record<string, unknown>;
  readonly volumePatch?: Record<string, unknown>;
  readonly workerStatus?: string;
  readonly keepEndpointAfterDelete?: boolean;
  readonly keepTemplateAfterDelete?: boolean;
  readonly unstableFlashboot?: boolean;
  readonly unstableWorkers?: boolean;
  readonly unstableEndpointBinding?: boolean;
  readonly postDeleteBindingDrift?: boolean;
  readonly keepFinalPod?: boolean;
  readonly extraVolume?: boolean;
};

function makeFixture(options: FixtureOptions = {}) {
  let endpointPresent = true;
  let templatePresent = true;
  let endpointReads = 0;
  let templateReads = 0;
  const calls: Array<{ readonly method: string; readonly path: string }> = [];
  const workerStatus = options.workerStatus ?? "EXITED";
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const path = url.pathname;
    calls.push({ method, path });

    if (path === "/pods") {
      return jsonResponse(
        endpointPresent || options.keepFinalPod
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
          ...options.volumePatch,
        },
        { id: "soulx_volume", size: 50, dataCenterId: "EU-RO-1" },
        ...(options.extraVolume
          ? [{ id: "unexpected_volume", size: 50, dataCenterId: "EU-RO-1" }]
          : []),
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
          flashboot: options.unstableFlashboot && endpointReads >= 4 ? true : false,
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
      templateReads += 1;
      if (!templatePresent) return jsonResponse([]);
      const environment: Record<string, unknown> = {
        ...templateEnvironment,
        ...asTemplateEnvironment(options.templatePatch?.env),
      };
      if (options.unstableEndpointBinding && templateReads >= 4) {
        environment.VIDEOFORGE_MAGE_ENDPOINT_ID_HASH = endpointIdHash;
      }
      if (options.postDeleteBindingDrift && !endpointPresent) {
        delete environment.VIDEOFORGE_MAGE_ENDPOINT_ID_HASH;
      }
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
          ...options.templatePatch,
          env: environment,
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

function asTemplateEnvironment(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function makeControl(fetch: typeof globalThis.fetch): RunPodControlClient {
  const control = new RunPodControlClient({ apiKey, fetch, baseUrl: controlBaseUrl });
  const inventory = control.inventory.bind(control);
  vi.spyOn(control, "inventory").mockImplementation(async () => {
    const value = await inventory();
    return {
      ...value,
      networkVolumes: value.networkVolumes.map((volume) =>
        volume.idHash === `sha256:${createHash("sha256").update("soulx_volume").digest("hex")}`
          ? { ...volume, idHash: V207_FAILED_CLEANUP_SOULX_VOLUME_ID_HASH }
          : volume,
      ),
    };
  });
  return control;
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

  it("deletes the exact failed endpoint when the provider forced FlashBoot on", async () => {
    const { fixture, result } = await cleanupFixture({ endpointPatch: { flashboot: true } });
    expect(result.finalDisposableResourcesAbsent).toBe(true);
    expect(fixture.calls.filter((call) => call.method === "DELETE")).toEqual([
      { method: "DELETE", path: "/endpoints/endpoint_10" },
      { method: "DELETE", path: "/templates/template_10" },
    ]);
  });

  it("deletes the exact failed endpoint after the approved max-two stage was applied", async () => {
    const { fixture, result } = await cleanupFixture({
      endpointPatch: { workersMax: 2 },
    });
    expect(result.finalDisposableResourcesAbsent).toBe(true);
    expect(fixture.calls.filter((call) => call.method === "DELETE")).toEqual([
      { method: "DELETE", path: "/endpoints/endpoint_10" },
      { method: "DELETE", path: "/templates/template_10" },
    ]);
  });

  it("accepts only the exact template-bound endpoint identity hash", async () => {
    const { result } = await cleanupFixture({
      templatePatch: {
        env: { ...templateEnvironment, VIDEOFORGE_MAGE_ENDPOINT_ID_HASH: endpointIdHash },
      },
    });
    expect(result.finalDisposableResourcesAbsent).toBe(true);

    const wrong = makeFixture({
      templatePatch: {
        env: {
          ...templateEnvironment,
          VIDEOFORGE_MAGE_ENDPOINT_ID_HASH: `sha256:${"0".repeat(64)}`,
        },
      },
    });
    await expect(
      cleanupFailedV207Resources({
        apiKey,
        control: makeControl(wrong.fetch),
        fetch: wrong.fetch,
        sleep: async () => undefined,
      }),
    ).rejects.toThrow("V207_CLEANUP_TEMPLATE_ENDPOINT_IDENTITY_MISMATCH");
    expect(wrong.calls.some((call) => call.method === "DELETE")).toBe(false);
  });

  it("rejects endpoint-binding drift between terminal snapshots before deletion", async () => {
    const fixture = makeFixture({ unstableEndpointBinding: true });
    await expect(
      cleanupFailedV207Resources({
        apiKey,
        control: makeControl(fixture.fetch),
        fetch: fixture.fetch,
        sleep: async () => undefined,
      }),
    ).rejects.toThrow("V207_CLEANUP_TERMINAL_INVENTORY_UNSTABLE");
    expect(fixture.calls.some((call) => call.method === "DELETE")).toBe(false);
  });

  it("rejects endpoint-binding drift after endpoint deletion before deleting the template", async () => {
    const fixture = makeFixture({
      templatePatch: {
        env: { ...templateEnvironment, VIDEOFORGE_MAGE_ENDPOINT_ID_HASH: endpointIdHash },
      },
      postDeleteBindingDrift: true,
    });
    await expect(
      cleanupFailedV207Resources({
        apiKey,
        control: makeControl(fixture.fetch),
        fetch: fixture.fetch,
        sleep: async () => undefined,
      }),
    ).rejects.toThrow("V207_CLEANUP_TEMPLATE_BINDING_UNCONFIRMED");
    expect(fixture.calls).toContainEqual({ method: "DELETE", path: "/endpoints/endpoint_10" });
    expect(fixture.calls).not.toContainEqual({
      method: "DELETE",
      path: "/templates/template_10",
    });
  });

  it.each([
    ["extra environment key", { env: { ...templateEnvironment, UNPLANNED: "1" } }],
    [
      "malformed endpoint identity",
      { env: { ...templateEnvironment, VIDEOFORGE_MAGE_ENDPOINT_ID_HASH: "sha256:short" } },
    ],
  ] as const)("rejects a template with %s before deletion", async (_label, templatePatch) => {
    const fixture = makeFixture({ templatePatch });
    await expect(
      cleanupFailedV207Resources({
        apiKey,
        control: makeControl(fixture.fetch),
        fetch: fixture.fetch,
        sleep: async () => undefined,
      }),
    ).rejects.toThrow(/V207_CLEANUP_TEMPLATE_(?:ENVIRONMENT|ENDPOINT_IDENTITY)_MISMATCH/u);
    expect(fixture.calls.some((call) => call.method === "DELETE")).toBe(false);
  });

  it.each([
    ["image", { templatePatch: { imageName: "ghcr.io/wrong/image@sha256:" + "c".repeat(64) } }],
    ["GPU", { endpointPatch: { gpuTypeIds: ["NVIDIA GeForce RTX 5090"] } }],
    ["CUDA", { endpointPatch: { minCudaVersion: "12.8" } }],
    ["volume", { endpointPatch: { networkVolumeId: "other_volume" } }],
    ["region", { endpointPatch: { dataCenterIds: ["US-KS-2"] } }],
    ["policy", { endpointPatch: { workersMax: 3 } }],
    ["malformed FlashBoot", { endpointPatch: { flashboot: "true" } }],
    ["retained-volume size", { volumePatch: { size: 49 } }],
    ["unexpected third volume", { extraVolume: true }],
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
    ["unstable FlashBoot snapshots", { unstableFlashboot: true }],
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

  it("does not delete a FlashBoot endpoint while its attributable worker is active", async () => {
    const fixture = makeFixture({
      workerStatus: "RUNNING",
      endpointPatch: { flashboot: true },
    });
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

  it("fails closed if a Pod remains after both disposable resources are deleted", async () => {
    const fixture = makeFixture({ keepFinalPod: true });
    await expect(
      cleanupFailedV207Resources({
        apiKey,
        control: makeControl(fixture.fetch),
        fetch: fixture.fetch,
        sleep: async () => undefined,
      }),
    ).rejects.toThrow("V207_CLEANUP_FINAL_RESOURCE_STATE_UNCONFIRMED");
    expect(fixture.calls.filter((call) => call.method === "DELETE")).toEqual([
      { method: "DELETE", path: "/endpoints/endpoint_10" },
      { method: "DELETE", path: "/templates/template_10" },
    ]);
  });
});

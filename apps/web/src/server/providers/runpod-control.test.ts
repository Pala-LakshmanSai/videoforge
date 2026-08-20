import { describe, expect, it, vi } from "vitest";

import {
  RunPodControlClient,
  RunPodDrainGuard,
  RunPodServerlessJobClient,
  assertRunPodEndpointPolicy,
  assertRunPodV207ConcurrentReaderPolicy,
} from "./runpod-control";

const key = "runpod-test-key-at-least-twenty-characters";
const response = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

describe("RunPod scale-zero control", () => {
  it("accepts only the bounded zero-idle endpoint policy", () => {
    expect(() =>
      assertRunPodEndpointPolicy({
        workersMin: 0,
        workersMax: 1,
        gpuCount: 1,
        idleTimeout: 5,
        executionTimeoutMs: 600_000,
      }),
    ).not.toThrow();
    for (const policy of [
      { workersMin: 1, workersMax: 1, gpuCount: 1, idleTimeout: 5, executionTimeoutMs: 600_000 },
      { workersMin: 0, workersMax: 2, gpuCount: 1, idleTimeout: 5, executionTimeoutMs: 600_000 },
      { workersMin: 0, workersMax: 1, gpuCount: 2, idleTimeout: 5, executionTimeoutMs: 600_000 },
    ]) {
      expect(() => assertRunPodEndpointPolicy(policy as never)).toThrow(
        "RUNPOD_SCALE_ZERO_POLICY_INVALID",
      );
    }
  });

  it("blocks dispatch until exact zero is confirmed and fails closed after uncertain drain", () => {
    const guard = new RunPodDrainGuard();
    expect(() => guard.assertDispatchAllowed()).toThrow("RUNPOD_DISPATCH_BLOCKED");
    guard.confirmZero(0, 0);
    expect(() => guard.assertDispatchAllowed()).not.toThrow();
    guard.markActive();
    guard.beginDrain();
    expect(() => guard.confirmZero(1, 0)).toThrow("RUNPOD_ZERO_NOT_CONFIRMED");
    expect(guard.snapshot()).toBe("unknown");
    expect(() => guard.assertDispatchAllowed()).toThrow("RUNPOD_DISPATCH_BLOCKED");
  });

  it("permits one sequential dispatch only after provider health proves warm idle", async () => {
    const guard = new RunPodDrainGuard();
    guard.confirmZero(0, 0);
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/run"))
        return response({ id: `job_${fetch.mock.calls.length}`, status: "IN_QUEUE" });
      return response({
        workers: { idle: 1, running: 0 },
        jobs: { inQueue: 0, inProgress: 0 },
      });
    });
    const client = new RunPodServerlessJobClient({
      apiKey: key,
      endpointId: "endpoint_01",
      guard,
      fetch,
      baseUrl: "http://127.0.0.1:43123",
    });

    await client.dispatch("attempt_01", { value: "first" });
    expect(() => guard.assertDispatchAllowed()).toThrow("RUNPOD_DISPATCH_BLOCKED");
    await client.confirmWarmIdle();
    expect(guard.snapshot()).toBe("warm_idle");
    await expect(client.dispatch("attempt_02", { value: "second" })).resolves.toMatchObject({
      status: "IN_QUEUE",
    });
    expect(
      fetch.mock.calls.filter(([input]) => new URL(String(input)).pathname.endsWith("/run")),
    ).toHaveLength(2);
  });

  it("fails closed when warm-idle health reports running, queued, or excess workers", () => {
    for (const counts of [
      [0, 1, 0],
      [1, 0, 1],
      [2, 0, 0],
    ] as const) {
      const guard = new RunPodDrainGuard();
      guard.confirmZero(0, 0);
      guard.markActive();
      expect(() => guard.confirmWarmIdle(counts[0], counts[1], counts[2])).toThrow(
        "RUNPOD_WARM_IDLE_NOT_CONFIRMED",
      );
      expect(guard.snapshot()).toBe("unknown");
    }
  });

  it("returns redacted live-shaped inventory and preserves the bearer only in transport", async () => {
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${key}`);
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/pods"))
        return response([
          {
            id: "pod_01",
            desiredStatus: "EXITED",
            endpointId: "endpoint_01",
            costPerHr: "0.69",
          },
        ]);
      if (path.endsWith("/endpoints"))
        return response([
          {
            id: "endpoint_01",
            workersMin: 0,
            workersMax: 1,
            workers: [
              { desiredStatus: "EXITED" },
              { desiredStatus: "TERMINATED" },
              { desiredStatus: "UNKNOWN" },
            ],
          },
        ]);
      if (path.endsWith("/templates")) return response([{ id: "template_01" }]);
      return response([{ id: "volume_01", size: 50, dataCenterId: "EU-RO-1" }]);
    });
    const inventory = await new RunPodControlClient({
      apiKey: key,
      fetch,
      baseUrl: "http://127.0.0.1:43123",
    }).inventory(new Date("2026-08-11T17:20:00Z"));
    expect(inventory).toMatchObject({
      runningPodCount: 0,
      activeServerlessWorkerCount: 0,
      privateTemplateCount: 1,
      networkVolumes: [
        {
          sizeGb: 50,
          dataCenterId: "EU-RO-1",
        },
      ],
      endpoints: [
        {
          workersMin: 0,
          workersMax: 1,
          workerRecordCount: 3,
          activeWorkerCount: 0,
          exitedWorkerCount: 2,
          workerStatuses: ["EXITED", "TERMINATED", "UNKNOWN"],
          scaleZeroCompliant: true,
        },
      ],
    });
    expect(JSON.stringify(inventory)).not.toContain(key);
    expect(JSON.stringify(inventory)).not.toContain("pod_01");
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("maps auth, malformed data, and network ambiguity to secret-free codes", async () => {
    for (const [fetch, code] of [
      [async () => response({}, 401), "RUNPOD_AUTH_REJECTED"],
      [async () => new Response("bad-json"), "RUNPOD_RESPONSE_INVALID"],
      [async () => Promise.reject(new Error(key)), "RUNPOD_READ_AMBIGUOUS"],
    ] as const) {
      const client = new RunPodControlClient({
        apiKey: key,
        fetch,
        baseUrl: "http://127.0.0.1:43123",
      });
      await expect(client.inventory()).rejects.toMatchObject({ code });
      try {
        await client.inventory();
      } catch (error) {
        expect(String(error)).not.toContain(key);
      }
    }
  });

  it("replays exact dispatch once, confirms cancellation, and requires health-proven drain", async () => {
    const guard = new RunPodDrainGuard();
    guard.confirmZero(0, 0);
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/run")) return response({ id: "job_01", status: "IN_QUEUE" });
      if (path.includes("/cancel/")) return response({ id: "job_01", status: "CANCELLED" });
      if (path.endsWith("/health"))
        return response({ workers: { idle: 0, running: 0 }, jobs: { inQueue: 0, inProgress: 0 } });
      return response({
        id: "job_01",
        status: "IN_PROGRESS",
        delayTime: 1200,
        executionTime: 3400,
      });
    });
    const client = new RunPodServerlessJobClient({
      apiKey: key,
      endpointId: "endpoint_01",
      guard,
      fetch,
      baseUrl: "http://127.0.0.1:43123",
    });
    const first = client.dispatch("attempt_01", { value: "owned" });
    const replay = client.dispatch("attempt_01", { value: "owned" });
    await expect(first).resolves.toEqual(await replay);
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(client.status("job_01")).resolves.toMatchObject({
      id: "job_01",
      status: "IN_PROGRESS",
      delayTimeMs: 1200,
      executionTimeMs: 3400,
    });
    guard.beginDrain();
    await expect(client.cancel("job_01")).resolves.toMatchObject({ status: "CANCELLED" });
    expect(() => guard.assertDispatchAllowed()).toThrow("RUNPOD_DISPATCH_BLOCKED");
    await client.confirmDrained();
    expect(() => guard.assertDispatchAllowed()).not.toThrow();
  });

  it("keeps provider stream diagnostics redacted to the terminal status tuple", async () => {
    const guard = new RunPodDrainGuard();
    guard.confirmZero(0, 0);
    const fetch = vi.fn(async (input: string | URL | Request) => {
      expect(new URL(String(input)).pathname).toBe("/endpoint_01/stream/job_01");
      return response({
        status: "COMPLETED",
        output: {
          status: "FAILED",
          error: { code: "MAGE_CUDA_VERSION_INCOMPATIBLE", message: "runtime rejected" },
          secret: "must-not-escape",
        },
        logs: "must-not-escape",
      });
    });
    const client = new RunPodServerlessJobClient({
      apiKey: key,
      endpointId: "endpoint_01",
      guard,
      fetch,
      baseUrl: "http://127.0.0.1:43123",
    });
    await expect(client.diagnostic("job_01")).resolves.toEqual({
      status: "COMPLETED",
      code: "MAGE_CUDA_VERSION_INCOMPATIBLE",
      message: "runtime rejected",
      reason: null,
    });
  });

  it("keeps ambiguous dispatch blocked until an independent zero confirmation", async () => {
    const guard = new RunPodDrainGuard();
    guard.confirmZero(0, 0);
    const client = new RunPodServerlessJobClient({
      apiKey: key,
      endpointId: "endpoint_01",
      guard,
      fetch: async () => Promise.reject(new Error(key)),
      baseUrl: "http://127.0.0.1:43123",
    });
    await expect(client.dispatch("attempt_01", { value: "owned" })).rejects.toMatchObject({
      code: "RUNPOD_MUTATION_AMBIGUOUS",
    });
    expect(() => guard.assertDispatchAllowed()).toThrow("RUNPOD_DISPATCH_BLOCKED");
  });

  it("reconciles transient reads against the same job without redispatch", async () => {
    const guard = new RunPodDrainGuard();
    guard.confirmZero(0, 0);
    const sleep = vi.fn(async () => undefined);
    let statusReads = 0;
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/run")) return response({ id: "job_01", status: "IN_QUEUE" });
      statusReads += 1;
      if (statusReads === 1) throw new Error("transient secret-bearing transport failure");
      return response({ id: "job_01", status: "IN_PROGRESS" });
    });
    const client = new RunPodServerlessJobClient({
      apiKey: key,
      endpointId: "endpoint_01",
      guard,
      fetch,
      baseUrl: "http://127.0.0.1:43123",
      readRetryDelaysMs: [0],
      sleep,
    });
    const dispatched = await client.dispatch("attempt_01", { value: "owned" });
    await expect(client.status(dispatched.id)).resolves.toMatchObject({ status: "IN_PROGRESS" });
    expect(
      fetch.mock.calls.filter(([input]) => new URL(String(input)).pathname.endsWith("/run")),
    ).toHaveLength(1);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(0);
  });

  it("fails closed after bounded read reconciliation exhaustion", async () => {
    const guard = new RunPodDrainGuard();
    guard.confirmZero(0, 0);
    const sleep = vi.fn(async () => undefined);
    const client = new RunPodServerlessJobClient({
      apiKey: key,
      endpointId: "endpoint_01",
      guard,
      fetch: async () => Promise.reject(new Error(key)),
      baseUrl: "http://127.0.0.1:43123",
      readRetryDelaysMs: [0, 0],
      sleep,
    });
    await expect(client.status("job_01")).rejects.toMatchObject({
      code: "RUNPOD_READ_AMBIGUOUS",
    });
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("aborts bounded read reconciliation without redispatch", async () => {
    const guard = new RunPodDrainGuard();
    guard.confirmZero(0, 0);
    const controller = new AbortController();
    const fetch = vi.fn(async () => Promise.reject(new Error(key)));
    const client = new RunPodServerlessJobClient({
      apiKey: key,
      endpointId: "endpoint_01",
      guard,
      fetch,
      baseUrl: "http://127.0.0.1:43123",
      readRetryDelaysMs: [0, 0],
      sleep: async () => controller.abort(),
      signal: controller.signal,
    });
    await expect(client.status("job_01")).rejects.toMatchObject({
      code: "RUNPOD_READ_ABORTED",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("updates or deletes an endpoint only after exact zero and confirmation", async () => {
    const guard = new RunPodDrainGuard();
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      return response({
        id: "endpoint_01",
        workersMin: 0,
        workersMax: 1,
        gpuCount: 1,
        gpuTypeIds: ["NVIDIA GeForce RTX 4090"],
        scalerType: "REQUEST_COUNT",
        scalerValue: 1,
      });
    });
    const client = new RunPodControlClient({
      apiKey: key,
      fetch,
      baseUrl: "http://127.0.0.1:43123",
    });
    const policy = {
      workersMin: 0 as const,
      workersMax: 1 as const,
      gpuCount: 1 as const,
      idleTimeout: 5,
      executionTimeoutMs: 600_000,
    };
    await expect(client.enforceEndpointPolicy("endpoint_01", policy, guard)).rejects.toThrow(
      "RUNPOD_DISPATCH_BLOCKED",
    );
    guard.confirmZero(0, 0);
    await expect(
      client.enforceEndpointPolicy("endpoint_01", policy, guard),
    ).resolves.toBeUndefined();
    await expect(client.deleteEndpoint("endpoint_01", guard)).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("allows endpoint termination after queue drain without waiting on a paid idle worker", async () => {
    const guard = new RunPodDrainGuard();
    guard.confirmZero(0, 0);
    guard.markActive();
    guard.beginDrain();
    guard.confirmQueueEmpty(0);
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    const client = new RunPodControlClient({
      apiKey: key,
      fetch,
      baseUrl: "http://127.0.0.1:43123",
    });
    await expect(client.deleteEndpoint("endpoint_01", guard)).resolves.toBeUndefined();
    expect(() => guard.assertDispatchAllowed()).toThrow("RUNPOD_DISPATCH_BLOCKED");
  });

  it("creates only private pinned templates and scale-zero endpoints", async () => {
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      const body = init?.body === undefined ? null : JSON.parse(String(init.body));
      if (path.endsWith("/templates")) {
        expect(body).toMatchObject({
          isPublic: false,
          isServerless: true,
          volumeInGb: 0,
          volumeMountPath: "/runpod-volume",
          env: { LOG_LEVEL: "INFO", RUNPOD_INIT_TIMEOUT: "800" },
        });
        return response({
          id: "template_01",
          name: body.name,
          imageName: body.imageName,
          containerDiskInGb: body.containerDiskInGb,
          isPublic: false,
          isServerless: true,
          volumeInGb: 0,
          volumeMountPath: "/runpod-volume",
        });
      }
      expect(body).toMatchObject({
        computeType: "GPU",
        workersMin: 0,
        workersMax: 1,
        gpuCount: 1,
        gpuTypeIds: ["NVIDIA GeForce RTX 4090"],
        allowedCudaVersions: ["13.0"],
        minCudaVersion: "13.0",
        flashboot: false,
        networkVolumeId: "volume_01",
        dataCenterIds: ["EU-RO-1"],
        scalerType: "REQUEST_COUNT",
        scalerValue: 1,
      });
      return response({
        id: "endpoint_01",
        templateId: body.templateId,
        computeType: "GPU",
        workersMin: 0,
        workersMax: 1,
        gpuCount: 1,
        gpuTypeIds: ["NVIDIA GeForce RTX 4090"],
        allowedCudaVersions: ["13.0"],
        minCudaVersion: "13.0",
        flashboot: false,
        networkVolumeId: "volume_01",
        dataCenterIds: ["EU-RO-1"],
        scalerType: "REQUEST_COUNT",
        scalerValue: 1,
      });
    });
    const client = new RunPodControlClient({
      apiKey: key,
      fetch,
      baseUrl: "http://127.0.0.1:43123",
    });
    const template = await client.createServerlessTemplate(
      "vf_avatar_cd226f4",
      "ghcr.io/palalakshmansai/videoforge-avatar-primary@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      100,
    );
    const endpoint = await client.createScaleZeroEndpoint(
      "vf_avatar_cd226f4",
      template.id,
      ["NVIDIA GeForce RTX 4090"],
      {
        workersMin: 0,
        workersMax: 1,
        gpuCount: 1,
        idleTimeout: 5,
        executionTimeoutMs: 1_800_000,
      },
      { networkVolumeId: "volume_01", dataCenterIds: ["EU-RO-1"] },
    );
    expect(template.idHash).toMatch(/^sha256:/u);
    expect(endpoint.idHash).toMatch(/^sha256:/u);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("rejects any non-Mage GPU or non-EU-RO-1 placement before mutation", async () => {
    const fetch = vi.fn(async () => response({ id: "unexpected" }));
    const client = new RunPodControlClient({
      apiKey: key,
      fetch,
      baseUrl: "http://127.0.0.1:43123",
    });
    const policy = {
      workersMin: 0 as const,
      workersMax: 1 as const,
      gpuCount: 1 as const,
      idleTimeout: 5,
      executionTimeoutMs: 600_000,
    };
    await expect(
      client.createScaleZeroEndpoint("endpoint_01", "template_01", ["NVIDIA L40S"], policy, {
        networkVolumeId: "volume_01",
        dataCenterIds: ["EU-RO-1"],
      }),
    ).rejects.toThrow("RUNPOD_ENDPOINT_INPUT_INVALID");
    await expect(
      client.createScaleZeroEndpoint(
        "endpoint_01",
        "template_01",
        ["NVIDIA GeForce RTX 4090"],
        policy,
        { networkVolumeId: "volume_01", dataCenterIds: ["US-KS-2"] },
      ),
    ).rejects.toThrow("RUNPOD_ENDPOINT_PLACEMENT_INVALID");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fails closed when template or endpoint identity is missing from mutation response", async () => {
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      return path.endsWith("/templates")
        ? response({ id: "template_01" })
        : response({ id: "endpoint_01", workersMin: 0, workersMax: 1 });
    });
    const client = new RunPodControlClient({
      apiKey: key,
      fetch,
      baseUrl: "http://127.0.0.1:43123",
    });
    await expect(
      client.createServerlessTemplate(
        "vf_v207",
        "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:" + "a".repeat(64),
        100,
      ),
    ).rejects.toThrow("RUNPOD_RESPONSE_INVALID");
  });

  it("allows only the separately bounded max-two concurrent-reader proof", () => {
    expect(() =>
      assertRunPodV207ConcurrentReaderPolicy({
        workersMin: 0,
        workersMax: 2,
        gpuCount: 1,
        idleTimeout: 5,
        executionTimeoutMs: 600_000,
      }),
    ).not.toThrow();
    expect(() =>
      assertRunPodV207ConcurrentReaderPolicy({
        workersMin: 0,
        workersMax: 1,
        gpuCount: 1,
        idleTimeout: 5,
        executionTimeoutMs: 600_000,
      } as never),
    ).toThrow("RUNPOD_CONCURRENT_READER_POLICY_INVALID");
  });

  it("updates the endpoint with the exact max-two proof identity", async () => {
    const guard = new RunPodDrainGuard();
    guard.confirmZero(0, 0);
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(new URL(String(input)).pathname).toBe("/endpoints/endpoint_01/update");
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        workersMin: 0,
        workersMax: 2,
        gpuCount: 1,
        gpuTypeIds: ["NVIDIA GeForce RTX 4090"],
        allowedCudaVersions: ["13.0"],
        minCudaVersion: "13.0",
        flashboot: false,
        networkVolumeId: "volume_01",
        dataCenterIds: ["EU-RO-1"],
        scalerType: "REQUEST_COUNT",
        scalerValue: 1,
      });
      return response({
        id: "endpoint_01",
        templateId: "template_01",
        computeType: "GPU",
        workersMin: 0,
        workersMax: 2,
        gpuCount: 1,
        gpuTypeIds: ["NVIDIA GeForce RTX 4090"],
        allowedCudaVersions: ["13.0"],
        minCudaVersion: "13.0",
        flashboot: false,
        networkVolumeId: "volume_01",
        dataCenterIds: ["EU-RO-1"],
        idleTimeout: 5,
        executionTimeoutMs: 2_400_000,
        scalerType: "REQUEST_COUNT",
        scalerValue: 1,
      });
    });
    const client = new RunPodControlClient({
      apiKey: key,
      fetch,
      baseUrl: "http://127.0.0.1:43123",
    });
    await expect(
      client.enforceV207EndpointPolicy(
        "endpoint_01",
        "template_01",
        {
          workersMin: 0,
          workersMax: 2,
          gpuCount: 1,
          idleTimeout: 5,
          executionTimeoutMs: 2_400_000,
        },
        { networkVolumeId: "volume_01", dataCenterIds: ["EU-RO-1"] },
        guard,
      ),
    ).resolves.toBeUndefined();
  });
});

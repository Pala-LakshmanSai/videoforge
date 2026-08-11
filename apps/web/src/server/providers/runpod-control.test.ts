import { describe, expect, it, vi } from "vitest";

import {
  RunPodControlClient,
  RunPodDrainGuard,
  RunPodServerlessJobClient,
  assertRunPodEndpointPolicy,
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

  it("returns redacted live-shaped inventory and preserves the bearer only in transport", async () => {
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${key}`);
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/pods"))
        return response([{ id: "pod_01", desiredStatus: "EXITED", costPerHr: "0.69" }]);
      if (path.endsWith("/endpoints"))
        return response([{ id: "endpoint_01", workersMin: 0, workersMax: 1, workers: [] }]);
      if (path.endsWith("/templates")) return response([{ id: "template_01" }]);
      return response([{ id: "volume_01", size: 50 }]);
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
      endpoints: [{ workersMin: 0, workersMax: 1, scaleZeroCompliant: true }],
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

  it("updates or deletes an endpoint only after exact zero and confirmation", async () => {
    const guard = new RunPodDrainGuard();
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      return response({ id: "endpoint_01", workersMin: 0, workersMax: 1 });
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
        expect(body).toMatchObject({ isPublic: false, isServerless: true, volumeInGb: 0 });
        return response({ id: "template_01" });
      }
      expect(body).toMatchObject({
        workersMin: 0,
        workersMax: 1,
        gpuCount: 1,
        gpuTypeIds: ["NVIDIA L40S", "NVIDIA A100 80GB PCIe"],
      });
      return response({ id: "endpoint_01", workersMin: 0, workersMax: 1 });
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
      ["NVIDIA L40S", "NVIDIA A100 80GB PCIe"],
      {
        workersMin: 0,
        workersMax: 1,
        gpuCount: 1,
        idleTimeout: 5,
        executionTimeoutMs: 1_800_000,
      },
    );
    expect(template.idHash).toMatch(/^sha256:/u);
    expect(endpoint.idHash).toMatch(/^sha256:/u);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

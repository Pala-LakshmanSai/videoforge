import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

import { canonicalizeJson } from "@videoforge/contracts";

import { RunPodControlClient, type RunPodV207Placement } from "./runpod-control";
import {
  buildDispatchRequest,
  buildV207PlanManifest,
  hashV207PlanManifest,
  RunPodV207QualificationHarness,
  redactRunPodEvidence,
  V207_TIMEOUT_EXECUTION_TIMEOUT_MS,
  V207_TIMEOUT_TTL_MS,
  type RunPodV207DispatchBatchInput,
  type RunPodV207OutputAuthority,
  type RunPodV207WorkerProcessIdentity,
} from "./runpod-v207-qualification-harness";
import { V207_REPAIRED_IMAGE } from "./v207-activation-authority";

const apiKey = "runpod-test-key-at-least-twenty-characters";
const jsonResponse = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });

const placement: RunPodV207Placement = {
  networkVolumeId: "volume_01",
  dataCenterIds: ["EU-RO-1"],
};

const image = V207_REPAIRED_IMAGE;
const hashValue = (value: string): string =>
  `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
const outputPrefix =
  "tenant/account_a/workspace/workspace_a/project/project_a/revision/revision_a/lane/mage-image/job/attempt_a";

const authority = (
  attemptId = "attempt_a",
  reservationId = "reservation_a",
): RunPodV207OutputAuthority => {
  const prefix = outputPrefix.replace("attempt_a", attemptId);
  return {
    schemaVersion: "artifact-generated-output-authority/v1",
    attemptId,
    accountId: "account_a",
    workspaceId: "workspace_a",
    outputPrefix: prefix,
    authorities: [
      {
        schema_version: "artifact-generated-output-authority/v1",
        reservation_id: reservationId,
        account_id: "account_a",
        workspace_id: "workspace_a",
        method: "PUT",
        path: `/${prefix}/artifact/scene_a`,
        content_type: "image/png",
        max_content_length: 4 * 1024 * 1024,
        expires_at: "2099-01-01T00:00:00.000Z",
        max_uses: 1,
        capability_handle: "c".repeat(64),
      },
    ],
    outputPutUrls: ["https://r2.example.test/put?signature=opaque"],
  };
};

const oneItemInput = (
  attemptId = "attempt_a",
  reservationId = "reservation_a",
): {
  readonly requestKey: string;
  readonly attemptId: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly outputAuthority: RunPodV207OutputAuthority;
} => ({
  requestKey: attemptId,
  attemptId,
  input: {
    envelope: {
      artifacts: {
        output_prefix: outputPrefix.replace("attempt_a", attemptId),
        transfer_port_reservation_ids: [reservationId],
      },
    },
    batch: { items: [{ scene_id: `${attemptId}_scene` }] },
  },
  outputAuthority: authority(attemptId, reservationId),
});

function harnessFetch(
  volume: { readonly id: string; readonly size: number; readonly dataCenterId?: string } = {
    id: "volume_01",
    size: 50,
    dataCenterId: "EU-RO-1",
  },
) {
  let runCount = 0;
  let statusCount = 0;
  let endpointEnvironment: Record<string, string> | null = null;
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname;
    const body = init?.body === undefined ? null : JSON.parse(String(init.body));
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    if (path === "/pods") return jsonResponse([]);
    if (path === "/endpoints" && init?.method === undefined) return jsonResponse([]);
    if (path === "/templates" && init?.method === undefined) return jsonResponse([]);
    if (path === "/networkvolumes") return jsonResponse([volume]);
    if (path === "/templates" && init?.method === "POST") {
      return jsonResponse(
        {
          id: "template_01",
          name: body.name,
          imageName: body.imageName,
          containerDiskInGb: body.containerDiskInGb,
          isPublic: false,
          isServerless: true,
          env: { LOG_LEVEL: "INFO", RUNPOD_INIT_TIMEOUT: "800" },
          volumeInGb: 0,
          volumeMountPath: "/runpod-volume",
        },
        201,
      );
    }
    if (path === "/endpoints" && init?.method === "POST") {
      return jsonResponse(
        {
          id: "endpoint_01",
          templateId: body.templateId,
          computeType: "GPU",
          workersMin: 0,
          workersMax: body.workersMax,
          gpuCount: 1,
          gpuTypeIds: ["NVIDIA GeForce RTX 4090"],
          allowedCudaVersions: ["13.0"],
          minCudaVersion: "13.0",
          flashboot: true,
          networkVolumeId: "volume_01",
          dataCenterIds: ["EU-RO-1"],
          idleTimeout: body.idleTimeout,
          executionTimeoutMs: body.executionTimeoutMs,
          scalerType: "REQUEST_COUNT",
          scalerValue: 1,
        },
        201,
      );
    }
    if (path === "/templates/template_01/update" && init?.method === "POST") {
      endpointEnvironment = body.env;
      return jsonResponse({ id: "template_01", env: endpointEnvironment });
    }
    if (path === "/templates/template_01" && init?.method === undefined) {
      return jsonResponse({
        id: "template_01",
        name: "vf_mage_v207_test",
        imageName: image,
        containerDiskInGb: 120,
        isPublic: false,
        isServerless: true,
        env: endpointEnvironment ?? { LOG_LEVEL: "INFO", RUNPOD_INIT_TIMEOUT: "800" },
        volumeInGb: 0,
        volumeMountPath: "/runpod-volume",
      });
    }
    if (path === "/endpoints/endpoint_01" && init?.method === "PATCH") {
      expect(body).not.toHaveProperty("computeType");
      return jsonResponse({ ...body, id: "endpoint_01", computeType: "GPU" });
    }
    if (path === "/endpoints/endpoint_01" && init?.method === undefined) {
      return jsonResponse({
        id: "endpoint_01",
        templateId: "template_01",
        computeType: "GPU",
        workersMin: 0,
        workersMax: 1,
        gpuCount: 1,
        gpuTypeIds: ["NVIDIA GeForce RTX 4090"],
        allowedCudaVersions: ["13.0"],
        minCudaVersion: "13.0",
        flashboot: true,
        networkVolumeId: "volume_01",
        dataCenterIds: ["EU-RO-1"],
        idleTimeout: 5,
        executionTimeoutMs: 2_400_000,
        scalerType: "REQUEST_COUNT",
        scalerValue: 1,
        env: endpointEnvironment,
      });
    }
    if (path === "/endpoints/endpoint_01/update") {
      return jsonResponse({
        id: "endpoint_01",
        templateId: "template_01",
        computeType: "GPU",
        workersMin: 0,
        workersMax: body.workersMax,
        gpuCount: 1,
        gpuTypeIds: ["NVIDIA GeForce RTX 4090"],
        allowedCudaVersions: ["13.0"],
        minCudaVersion: "13.0",
        flashboot: true,
        networkVolumeId: "volume_01",
        dataCenterIds: ["EU-RO-1"],
        idleTimeout: body.idleTimeout,
        executionTimeoutMs: body.executionTimeoutMs,
        scalerType: "REQUEST_COUNT",
        scalerValue: 1,
      });
    }
    if (path.endsWith("/run")) {
      runCount += 1;
      return jsonResponse({ id: `job_0${runCount}`, status: "IN_QUEUE" });
    }
    if (path.includes("/status/")) {
      statusCount += 1;
      return jsonResponse({
        id: path.endsWith("job_01") ? "job_01" : "job_02",
        status: statusCount === 1 ? "IN_PROGRESS" : "COMPLETED",
        executionTime: 100,
        delayTime: 20,
      });
    }
    if (path.endsWith("/health")) {
      return jsonResponse({
        workers: {
          idle: 0,
          running: 0,
          initializing: 0,
          ready: 0,
          throttled: 0,
          unhealthy: 0,
        },
        jobs: { inQueue: 0, inProgress: 0 },
      });
    }
    if (path.includes("/cancel/")) return jsonResponse({ id: "job_01", status: "CANCELLED" });
    throw new Error(`unexpected request ${path}`);
  });
}

function timeoutTerminalFetch() {
  const baseFetch = harnessFetch();
  const runBodies: Record<string, unknown>[] = [];
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/run")) {
      runBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    }
    if (path.includes("/status/")) {
      const jobId = path.split("/").at(-1) ?? "job_01";
      return jsonResponse({
        id: jobId,
        status: "TIMED_OUT",
        executionTime: 2_400_000,
        delayTime: 0,
      });
    }
    return baseFetch(input, init);
  });
  return { fetch, runBodies };
}

function cleanupCancellationFetch() {
  const baseFetch = harnessFetch();
  let cancellationRequested = false;
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    if (path.includes("/cancel/")) {
      cancellationRequested = true;
      return baseFetch(input, init);
    }
    if (cancellationRequested && path.includes("/status/")) {
      const jobId = path.split("/").at(-1) ?? "job_01";
      return jsonResponse({ id: jobId, status: "CANCELLED", executionTime: null, delayTime: null });
    }
    return baseFetch(input, init);
  });
  return { fetch, cancellationRequested: () => cancellationRequested };
}

function makeHarness(
  fetch: typeof globalThis.fetch,
  spendSnapshotUsd: () => Promise<number> = async () => 0,
  finiteSpendCapUsd = 4,
  monotonicNowMs?: () => number,
) {
  const control = new RunPodControlClient({
    apiKey,
    fetch,
    baseUrl: "http://127.0.0.1:43123",
  });
  return new RunPodV207QualificationHarness({
    control,
    apiKey,
    templateName: "vf_mage_v207_test",
    endpointName: "vf_mage_v207_test",
    imageName: image,
    containerDiskInGb: 120,
    placement,
    initialPolicy: {
      workersMin: 0,
      workersMax: 1,
      gpuCount: 1,
      idleTimeout: 5,
      executionTimeoutMs: 2_400_000,
    },
    concurrentReaderPolicy: {
      workersMin: 0,
      workersMax: 2,
      gpuCount: 1,
      idleTimeout: 5,
      executionTimeoutMs: 2_400_000,
    },
    finiteSpendCapUsd,
    spendSnapshotUsd,
    fetch,
    baseUrl: "http://127.0.0.1:43123",
    pollIntervalMs: 1,
    maxPolls: 3,
    sleep: async () => undefined,
    monotonicNowMs,
  });
}

it("deletes only the disposable endpoint and template when identity binding fails", async () => {
  const baseFetch = harnessFetch();
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    if (path === "/templates/template_01/update" && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return jsonResponse({ ...body, id: "template_01", env: {} });
    }
    return baseFetch(input, init);
  });
  const harness = makeHarness(fetch);
  await expect(harness.create()).rejects.toThrow("RUNPOD_TEMPLATE_ENVIRONMENT_UPDATE_UNCONFIRMED");
  const deletes = fetch.mock.calls
    .filter(([, init]) => init?.method === "DELETE")
    .map(([input]) => new URL(String(input)).pathname);
  expect(deletes).toEqual(["/endpoints/endpoint_01", "/templates/template_01"]);
});

const reconciledTemplate = {
  id: "template_01",
  name: "vf_mage_v207_test",
  imageName: image,
  containerDiskInGb: 120,
  isPublic: false,
  isServerless: true,
  env: { LOG_LEVEL: "INFO", RUNPOD_INIT_TIMEOUT: "800" },
  volumeInGb: 0,
  volumeMountPath: "/runpod-volume",
};

const reconciledEndpoint = {
  id: "endpoint_01",
  name: "vf_mage_v207_test",
  templateId: "template_01",
  computeType: "GPU",
  workersMin: 0,
  workersMax: 1,
  gpuCount: 1,
  gpuTypeIds: ["NVIDIA GeForce RTX 4090"],
  allowedCudaVersions: ["13.0"],
  minCudaVersion: "13.0",
  flashboot: true,
  networkVolumeId: "volume_01",
  dataCenterIds: ["EU-RO-1"],
  idleTimeout: 5,
  executionTimeoutMs: 2_400_000,
  scalerType: "REQUEST_COUNT",
  scalerValue: 1,
  workers: [],
};

function terminalScaleZeroFetch(
  options: {
    readonly workerStatus?: string;
    readonly workerStatusAfterDispatch?: string;
    readonly workerCurrentStatus?: string;
    readonly workerId?: string | null;
    readonly podId?: string;
    readonly podStatus?: string;
    readonly podStatusAfterDispatch?: string;
    readonly podCurrentStatus?: string;
    readonly podEndpointId?: string | null;
    readonly podEndpointIdAfterDispatch?: string | null;
    readonly extraEndpoint?: boolean;
    readonly extraTemplate?: boolean;
    readonly endpointDrift?: Readonly<Record<string, unknown>>;
    readonly endpointDriftAfterDispatch?: Readonly<Record<string, unknown>>;
    readonly healthWorkers?: Readonly<Record<string, unknown>>;
    readonly healthWorkersBeforeDispatch?: Readonly<Record<string, unknown>>;
    readonly healthWorkersAfterDispatch?: Readonly<Record<string, unknown>>;
    readonly healthJobs?: Readonly<Record<string, unknown>>;
    readonly healthJobsAfterFirstSnapshot?: Readonly<Record<string, unknown>>;
    readonly healthAfterFirstSnapshot?: Readonly<Record<string, number>>;
  } = {},
) {
  const baseFetch = harnessFetch();
  let created = false;
  let dispatched = false;
  let terminalInventoryReads = 0;
  let workersMax = 1;
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    const body = init?.body === undefined ? null : JSON.parse(String(init.body));
    if (path === "/endpoints" && init?.method === "POST") {
      created = true;
      workersMax = body.workersMax;
      return baseFetch(input, init);
    }
    if (path === "/endpoints/endpoint_01/update") {
      workersMax = body.workersMax;
      return baseFetch(input, init);
    }
    if (path.endsWith("/run")) {
      dispatched = true;
      return baseFetch(input, init);
    }
    if (created && path === "/endpoint_01/health") {
      return jsonResponse({
        workers:
          terminalInventoryReads > 0 && options.healthAfterFirstSnapshot
            ? options.healthAfterFirstSnapshot
            : dispatched
              ? (options.healthWorkersAfterDispatch ??
                options.healthWorkers ?? {
                  idle: 0,
                  running: 0,
                  initializing: 0,
                  ready: 0,
                  throttled: 1,
                  unhealthy: 0,
                })
              : (options.healthWorkersBeforeDispatch ??
                options.healthWorkers ?? {
                  idle: 0,
                  running: 0,
                  initializing: 0,
                  ready: 0,
                  throttled: 1,
                  unhealthy: 0,
                }),
        jobs:
          terminalInventoryReads > 0
            ? (options.healthJobsAfterFirstSnapshot ??
              options.healthJobs ?? {
                inQueue: 0,
                inProgress: 0,
              })
            : (options.healthJobs ?? { inQueue: 0, inProgress: 0 }),
      });
    }
    if (created && path === "/pods" && init?.method === undefined) {
      terminalInventoryReads += 1;
      return jsonResponse([
        {
          id: options.podId ?? "pod_01",
          ...((dispatched ? options.podEndpointIdAfterDispatch : options.podEndpointId) === null
            ? {}
            : {
                endpointId:
                  (dispatched ? options.podEndpointIdAfterDispatch : options.podEndpointId) ??
                  "endpoint_01",
              }),
          desiredStatus:
            (dispatched ? options.podStatusAfterDispatch : undefined) ??
            options.podStatus ??
            "EXITED",
          ...(options.podCurrentStatus === undefined ? {} : { status: options.podCurrentStatus }),
        },
      ]);
    }
    if (created && path === "/endpoints" && init?.method === undefined) {
      const endpoint = {
        ...reconciledEndpoint,
        workersMax,
        workers: [
          {
            ...((options.workerId === null
              ? {}
              : { id: options.workerId ?? "worker_01" }) as Record<string, unknown>),
            desiredStatus:
              (dispatched ? options.workerStatusAfterDispatch : undefined) ??
              options.workerStatus ??
              "EXITED",
            ...(options.workerCurrentStatus === undefined
              ? {}
              : { status: options.workerCurrentStatus }),
          },
        ],
        ...options.endpointDrift,
        ...(dispatched ? options.endpointDriftAfterDispatch : {}),
      };
      return jsonResponse(
        options.extraEndpoint
          ? [endpoint, { ...endpoint, id: "endpoint_02", name: "vf_mage_v207_extra" }]
          : [endpoint],
      );
    }
    if (created && path === "/templates" && init?.method === undefined) {
      return jsonResponse(
        options.extraTemplate
          ? [
              reconciledTemplate,
              { ...reconciledTemplate, id: "template_02", name: "vf_mage_v207_extra" },
            ]
          : [reconciledTemplate],
      );
    }
    return baseFetch(input, init);
  });
}

describe("V2-07 qualification harness", () => {
  it.each([
    ["wrong id", { id: "volume_other", size: 50, dataCenterId: "EU-RO-1" }],
    ["wrong size", { id: "volume_01", size: 100, dataCenterId: "EU-RO-1" }],
    ["wrong region", { id: "volume_01", size: 50, dataCenterId: "US-KS-2" }],
    ["unreported region", { id: "volume_01", size: 50 }],
  ] as const)("requires the exact retained Mage volume (%s)", async (_label, volume) => {
    const fetch = harnessFetch(volume);
    const instance = makeHarness(fetch);
    await expect(instance.create()).rejects.toThrow("RUNPOD_MAGE_VOLUME_IDENTITY_UNCONFIRMED");
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("reconciles an ambiguous template create by exact-name read and deletes only that template", async () => {
    const baseFetch = harnessFetch();
    let templateVisible = false;
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path === "/templates" && init?.method === "POST") {
        templateVisible = true;
        throw new Error("ambiguous template response");
      }
      if (path === "/templates" && init?.method === undefined && templateVisible) {
        return jsonResponse([reconciledTemplate]);
      }
      return baseFetch(input, init);
    });
    const instance = makeHarness(fetch);
    await expect(instance.create()).rejects.toThrow("RUNPOD_MUTATION_AMBIGUOUS");
    expect(
      fetch.mock.calls.filter(
        ([url, init]) =>
          init?.method === "DELETE" &&
          new URL(String(url)).pathname.endsWith("/templates/template_01"),
      ),
    ).toHaveLength(1);
    expect(
      fetch.mock.calls.filter(
        ([url, init]) =>
          init?.method === "DELETE" && new URL(String(url)).pathname.includes("/networkvolumes/"),
      ),
    ).toHaveLength(0);
  });

  it("rechecks startup queue emptiness after the first terminal snapshot", async () => {
    const fetch = terminalScaleZeroFetch({
      healthWorkers: {
        idle: 0,
        running: 0,
        initializing: 0,
        throttled: 1,
        unhealthy: 0,
      },
      healthJobs: { inQueue: 0, inProgress: 0 },
      healthJobsAfterFirstSnapshot: { inQueue: 0, inProgress: 1 },
    });
    const instance = makeHarness(fetch);
    await expect(instance.create()).rejects.toThrow("RUNPOD_STARTUP_QUEUE_NOT_CONFIRMED");
    expect(
      fetch.mock.calls.filter(([url]) => new URL(String(url)).pathname.endsWith("/run")),
    ).toHaveLength(0);
  });

  it("reconciles an ambiguous endpoint create, drains it, and deletes exact endpoint and template", async () => {
    const baseFetch = harnessFetch();
    let resourcesVisible = false;
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path === "/endpoints" && init?.method === "POST") {
        resourcesVisible = true;
        throw new Error("ambiguous endpoint response");
      }
      if (path === "/endpoints" && init?.method === undefined && resourcesVisible) {
        return jsonResponse([reconciledEndpoint]);
      }
      if (path === "/templates" && init?.method === undefined && resourcesVisible) {
        return jsonResponse([reconciledTemplate]);
      }
      return baseFetch(input, init);
    });
    const instance = makeHarness(fetch);
    await expect(instance.create()).rejects.toThrow("RUNPOD_MUTATION_AMBIGUOUS");
    expect(
      fetch.mock.calls.filter(
        ([url, init]) =>
          init?.method === "DELETE" &&
          new URL(String(url)).pathname.endsWith("/endpoints/endpoint_01"),
      ),
    ).toHaveLength(1);
    expect(
      fetch.mock.calls.filter(
        ([url, init]) =>
          init?.method === "DELETE" &&
          new URL(String(url)).pathname.endsWith("/templates/template_01"),
      ),
    ).toHaveLength(1);
    expect(
      fetch.mock.calls.filter(
        ([url, init]) =>
          init?.method === "DELETE" && new URL(String(url)).pathname.includes("/networkvolumes/"),
      ),
    ).toHaveLength(0);
  });

  it("reconciles the provider endpoint shape when compute type and region are omitted", async () => {
    const baseFetch = harnessFetch();
    let resourcesVisible = false;
    const providerShapeEndpoint = { ...reconciledEndpoint };
    delete (providerShapeEndpoint as Record<string, unknown>).computeType;
    delete (providerShapeEndpoint as Record<string, unknown>).dataCenterIds;
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path === "/endpoints" && init?.method === "POST") {
        resourcesVisible = true;
        throw new Error("ambiguous endpoint response");
      }
      if (path === "/endpoints" && init?.method === undefined && resourcesVisible) {
        return jsonResponse([providerShapeEndpoint]);
      }
      if (path === "/templates" && init?.method === undefined && resourcesVisible) {
        return jsonResponse([reconciledTemplate]);
      }
      return baseFetch(input, init);
    });
    const instance = makeHarness(fetch);
    await expect(instance.create()).rejects.toThrow("RUNPOD_MUTATION_AMBIGUOUS");
    expect(
      fetch.mock.calls.filter(
        ([url, init]) =>
          init?.method === "DELETE" &&
          new URL(String(url)).pathname.endsWith("/endpoints/endpoint_01"),
      ),
    ).toHaveLength(1);
  });

  it.each(["gpuTypeIds", "allowedCudaVersions"] as const)(
    "rejects an ambiguous endpoint readback that omits %s",
    async (field) => {
      const baseFetch = harnessFetch();
      let resourcesVisible = false;
      const incompleteEndpoint = { ...reconciledEndpoint } as Record<string, unknown>;
      delete incompleteEndpoint[field];
      const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const path = new URL(String(input)).pathname;
        if (path === "/endpoints" && init?.method === "POST") {
          resourcesVisible = true;
          throw new Error("ambiguous endpoint response");
        }
        if (path === "/endpoints" && init?.method === undefined && resourcesVisible) {
          return jsonResponse([incompleteEndpoint]);
        }
        if (path === "/templates" && init?.method === undefined && resourcesVisible) {
          return jsonResponse([reconciledTemplate]);
        }
        return baseFetch(input, init);
      });
      const instance = makeHarness(fetch);
      await expect(instance.create()).rejects.toThrow(
        "RUNPOD_RESOURCE_RECONCILIATION_IDENTITY_MISMATCH",
      );
      expect(
        fetch.mock.calls.filter(([url]) =>
          new URL(String(url)).pathname.endsWith("/endpoints/endpoint_01/update"),
        ),
      ).toHaveLength(0);
    },
  );

  it("fails closed without policy update or dispatch when FlashBoot differs from the exact true config", async () => {
    const baseFetch = harnessFetch();
    let resourcesVisible = false;
    const driftedEndpoint = { ...reconciledEndpoint, flashboot: false };
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path === "/endpoints" && init?.method === "POST") {
        resourcesVisible = true;
        throw new Error("ambiguous endpoint response");
      }
      if (path === "/endpoints" && init?.method === undefined && resourcesVisible) {
        return jsonResponse([driftedEndpoint]);
      }
      if (path === "/templates" && init?.method === undefined && resourcesVisible) {
        return jsonResponse([reconciledTemplate]);
      }
      return baseFetch(input, init);
    });
    const instance = makeHarness(fetch);
    await expect(instance.create()).rejects.toThrow(
      "RUNPOD_RESOURCE_RECONCILIATION_IDENTITY_MISMATCH",
    );
    expect(
      fetch.mock.calls.filter(
        ([url, init]) =>
          init?.method === "POST" &&
          new URL(String(url)).pathname.endsWith("/endpoints/endpoint_01/update"),
      ),
    ).toHaveLength(0);
    expect(
      fetch.mock.calls.filter(([url]) => new URL(String(url)).pathname.endsWith("/run")),
    ).toHaveLength(0);
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(0);
  });

  it("fails closed on name drift during ambiguous endpoint recovery", async () => {
    const baseFetch = harnessFetch();
    let resourcesVisible = false;
    const driftedEndpoint = { ...reconciledEndpoint, name: "vf_mage_v207_other" };
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path === "/endpoints" && init?.method === "POST") {
        resourcesVisible = true;
        throw new Error("ambiguous endpoint response");
      }
      if (path === "/endpoints" && init?.method === undefined && resourcesVisible) {
        return jsonResponse([driftedEndpoint]);
      }
      if (path === "/templates" && init?.method === undefined && resourcesVisible) {
        return jsonResponse([reconciledTemplate]);
      }
      return baseFetch(input, init);
    });
    const instance = makeHarness(fetch);
    await expect(instance.create()).rejects.toThrow("RUNPOD_RESOURCE_RECONCILIATION_NAME_DRIFT");
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(0);
  });

  it("fails closed when an endpoint create is ambiguous but inventory cannot prove the endpoint", async () => {
    const baseFetch = harnessFetch();
    let endpointCreateAttempted = false;
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path === "/endpoints" && init?.method === "POST") {
        endpointCreateAttempted = true;
        throw new Error("ambiguous endpoint response");
      }
      if (path === "/endpoints" && init?.method === undefined && endpointCreateAttempted) {
        return jsonResponse([]);
      }
      if (path === "/templates" && init?.method === undefined && endpointCreateAttempted) {
        return jsonResponse([reconciledTemplate]);
      }
      return baseFetch(input, init);
    });
    const instance = makeHarness(fetch);
    await expect(instance.create()).rejects.toThrow(
      "RUNPOD_RESOURCE_RECONCILIATION_ENDPOINT_MISSING",
    );
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(0);
  });

  it("fails closed when ambiguous-create inventory contains multiple disposable endpoints", async () => {
    const baseFetch = harnessFetch();
    let resourcesVisible = false;
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path === "/endpoints" && init?.method === "POST") {
        resourcesVisible = true;
        throw new Error("ambiguous endpoint response");
      }
      if (path === "/endpoints" && init?.method === undefined && resourcesVisible) {
        return jsonResponse([reconciledEndpoint, { ...reconciledEndpoint, id: "endpoint_02" }]);
      }
      if (path === "/templates" && init?.method === undefined && resourcesVisible) {
        return jsonResponse([reconciledTemplate]);
      }
      return baseFetch(input, init);
    });
    const instance = makeHarness(fetch);
    await expect(instance.create()).rejects.toThrow("RUNPOD_RESOURCE_RECONCILIATION_AMBIGUOUS");
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(0);
  });

  it("checks the finite cap before applying max-two reader policy", async () => {
    const fetch = harnessFetch();
    let spend = 0;
    const instance = makeHarness(fetch, async () => spend);
    await instance.create();
    expect((await instance.evidence()).events).toContainEqual(
      expect.objectContaining({ event: "endpoint_identity_bound" }),
    );
    await instance.drain();
    instance.markInitialQualificationComplete();
    spend = 5;
    await expect(instance.applyConcurrentReaderPolicy()).rejects.toThrow(
      "RUNPOD_FINITE_SPEND_CAP_EXCEEDED",
    );
    expect(
      fetch.mock.calls.filter(([url]) =>
        new URL(String(url)).pathname.endsWith("/endpoints/endpoint_01/update"),
      ),
    ).toHaveLength(0);
  });

  it("fails closed when endpoint baseline spend exceeds the cap", async () => {
    const fetch = harnessFetch();
    const spendSnapshotUsd = vi
      .fn<() => Promise<number>>()
      .mockResolvedValueOnce(0) // pre-mutation guard
      .mockResolvedValueOnce(5); // post-baseline guard
    const instance = makeHarness(fetch, spendSnapshotUsd);
    await expect(instance.create()).rejects.toThrow("RUNPOD_FINITE_SPEND_CAP_EXCEEDED");
    expect(
      fetch.mock.calls.filter(
        ([url, init]) =>
          init?.method === "DELETE" &&
          new URL(String(url)).pathname.endsWith("/endpoints/endpoint_01"),
      ),
    ).toHaveLength(0);
    expect(
      fetch.mock.calls.filter(
        ([url, init]) =>
          init?.method === "DELETE" &&
          new URL(String(url)).pathname.endsWith("/templates/template_01"),
      ),
    ).toHaveLength(1);
  });

  it("does not delete a template when an endpoint drain is uncertain", async () => {
    const baseFetch = harnessFetch();
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/health")) return new Response("bad-json");
      return baseFetch(input, init);
    });
    const instance = makeHarness(fetch);
    await expect(instance.create()).rejects.toThrow("RUNPOD_RESPONSE_INVALID");
    expect(
      fetch.mock.calls.filter(
        ([url, init]) =>
          init?.method === "DELETE" && new URL(String(url)).pathname.includes("/endpoints/"),
      ),
    ).toHaveLength(0);
    expect(
      fetch.mock.calls.filter(
        ([url, init]) =>
          init?.method === "DELETE" && new URL(String(url)).pathname.includes("/templates/"),
      ),
    ).toHaveLength(0);
    expect((await instance.evidence()).events).toContainEqual(
      expect.objectContaining({ event: "template_cleanup_deferred_endpoint_uncertain" }),
    );
  });

  it("requires exact generated-output authority and records a bounded lifecycle", async () => {
    const fetch = harnessFetch();
    const instance = makeHarness(fetch);
    await instance.create();
    const input = {
      envelope: {
        artifacts: {
          output_prefix: outputPrefix,
          transfer_port_reservation_ids: ["reservation_a"],
        },
      },
      batch: { items: [{ scene_id: "scene_a" }] },
    };
    await expect(
      instance.dispatchBatch({
        requestKey: "attempt_a",
        attemptId: "attempt_a",
        input,
        outputAuthority: { ...authority(), outputPutUrls: ["http://insecure.example/put"] },
      }),
    ).rejects.toThrow("RUNPOD_OUTPUT_URL_INVALID");
    const job = await instance.dispatchBatch({
      requestKey: "attempt_a",
      attemptId: "attempt_a",
      input,
      outputAuthority: authority(),
    });
    await expect(instance.reconcile(job.id)).resolves.toMatchObject({ status: "COMPLETED" });
    await instance.drain();
    instance.markInitialQualificationComplete();
    await expect(instance.applyConcurrentReaderPolicy()).resolves.toMatch(/^sha256:/u);
    await instance.scaleDownToInitial();
    await instance.cleanup({ deleteIfFailed: false, failed: false });
    const evidence = await instance.evidence();
    expect(evidence.endpointIdHash).toMatch(/^sha256:/u);
    expect(evidence.initialConfigHash).toMatch(/^sha256:/u);
    expect(evidence.concurrentReaderConfigHash).toMatch(/^sha256:/u);
    expect(evidence.measuredSpendUsd).toBe(0);
    expect(JSON.stringify(evidence)).not.toContain("opaque");
  });

  it("records a provider TIMED_OUT terminal and cleans only the disposable endpoint/template", async () => {
    const timeout = timeoutTerminalFetch();
    const instance = makeHarness(timeout.fetch);
    await instance.create();
    const input = {
      envelope: {
        artifacts: {
          output_prefix: outputPrefix,
          transfer_port_reservation_ids: ["reservation_a"],
        },
      },
      batch: { items: [{ scene_id: "scene_a" }] },
    };
    const job = await instance.dispatchTimeoutBatch({
      requestKey: "attempt_a",
      attemptId: "attempt_a",
      input,
      outputAuthority: authority(),
    });
    await expect(instance.reconcile(job.id)).resolves.toMatchObject({ status: "TIMED_OUT" });
    expect(timeout.runBodies[0]).toMatchObject({
      policy: {
        executionTimeout: V207_TIMEOUT_EXECUTION_TIMEOUT_MS,
        ttl: V207_TIMEOUT_TTL_MS,
      },
    });
    expect(timeout.runBodies[0]).not.toHaveProperty("input.policy");
    await expect(
      instance.dispatchBatch({
        requestKey: "attempt_a",
        attemptId: "attempt_a",
        input,
        outputAuthority: authority(),
      }),
    ).rejects.toThrow("RUNPOD_REQUEST_REPLAY_MISMATCH");
    await instance.cleanup({ deleteIfFailed: true, failed: true });
    const events = (await instance.evidence()).events;
    expect(events).toContainEqual(
      expect.objectContaining({ event: "job_status", status: "TIMED_OUT" }),
    );
    expect(
      timeout.fetch.mock.calls.filter(
        ([url, init]) =>
          init?.method === "DELETE" && new URL(String(url)).pathname.endsWith("/endpoint_01"),
      ),
    ).toHaveLength(1);
    expect(
      timeout.fetch.mock.calls.filter(
        ([url, init]) =>
          init?.method === "DELETE" && new URL(String(url)).pathname.endsWith("/template_01"),
      ),
    ).toHaveLength(1);
    expect(
      timeout.fetch.mock.calls.some(([url]) =>
        new URL(String(url)).pathname.includes("/networkvolumes/"),
      ),
    ).toBe(false);
  });

  it("rejects timeout policy injection on ordinary dispatch", async () => {
    const fetch = harnessFetch();
    const instance = makeHarness(fetch);
    await instance.create();
    const input = {
      policy: {
        executionTimeout: V207_TIMEOUT_EXECUTION_TIMEOUT_MS,
        ttl: V207_TIMEOUT_TTL_MS,
      },
      envelope: {
        artifacts: {
          output_prefix: outputPrefix,
          transfer_port_reservation_ids: ["reservation_a"],
        },
      },
      batch: { items: [{ scene_id: "scene_a" }] },
    };
    await expect(
      instance.dispatchBatch({
        requestKey: "attempt_a",
        attemptId: "attempt_a",
        input,
        outputAuthority: authority(),
      }),
    ).rejects.toThrow("RUNPOD_QUALIFICATION_INPUT_INVALID");
    expect(
      fetch.mock.calls.filter(([url]) => new URL(String(url)).pathname.endsWith("/run")),
    ).toHaveLength(0);
  });

  it("cancels an acknowledged in-flight job before drain without redispatch", async () => {
    const cancellation = cleanupCancellationFetch();
    const instance = makeHarness(cancellation.fetch);
    await instance.create();
    const input = {
      envelope: {
        artifacts: {
          output_prefix: outputPrefix,
          transfer_port_reservation_ids: ["reservation_a"],
        },
      },
      batch: { items: [{ scene_id: "scene_a" }] },
    };
    await instance.dispatchBatch({
      requestKey: "attempt_a",
      attemptId: "attempt_a",
      input,
      outputAuthority: authority(),
    });
    await instance.cleanup({ deleteIfFailed: true, failed: true });
    expect(cancellation.cancellationRequested()).toBe(true);
    expect(
      cancellation.fetch.mock.calls.filter(([url]) =>
        new URL(String(url)).pathname.endsWith("/run"),
      ),
    ).toHaveLength(1);
    expect((await instance.evidence()).events).toContainEqual(
      expect.objectContaining({ event: "owned_job_cleanup_cancelled", status: "CANCELLED" }),
    );
  });

  it("checks the finite cap before concurrent reader dispatch", async () => {
    let spend = 0;
    const fetch = harnessFetch();
    const instance = makeHarness(fetch, async () => spend);
    await instance.create();
    await instance.drain();
    instance.markInitialQualificationComplete();
    await instance.applyConcurrentReaderPolicy();
    spend = 5;
    const input = {
      envelope: {
        artifacts: {
          output_prefix: outputPrefix,
          transfer_port_reservation_ids: ["reservation_a"],
        },
      },
      batch: { items: [{ scene_id: "scene_a" }] },
    };
    const inputB = {
      envelope: {
        artifacts: {
          output_prefix: outputPrefix.replace("attempt_a", "attempt_b"),
          transfer_port_reservation_ids: ["reservation_b"],
        },
      },
      batch: { items: [{ scene_id: "scene_b" }] },
    };
    await expect(
      instance.dispatchConcurrentReaders([
        { requestKey: "attempt_a", attemptId: "attempt_a", input, outputAuthority: authority() },
        {
          requestKey: "attempt_b",
          attemptId: "attempt_b",
          input: inputB,
          outputAuthority: authority("attempt_b", "reservation_b"),
        },
      ]),
    ).rejects.toThrow("RUNPOD_FINITE_SPEND_CAP_EXCEEDED");
    expect(
      fetch.mock.calls.filter(([url]) => new URL(String(url)).pathname.endsWith("/run")),
    ).toHaveLength(0);
  });

  it("prevalidates both concurrent reader inputs before either reader dispatches", async () => {
    const fetch = harnessFetch();
    const instance = makeHarness(fetch);
    await instance.create();
    await instance.drain();
    instance.markInitialQualificationComplete();
    await instance.applyConcurrentReaderPolicy();
    const input = {
      envelope: {
        artifacts: {
          output_prefix: outputPrefix,
          transfer_port_reservation_ids: ["reservation_a"],
        },
      },
      batch: { items: [{ scene_id: "scene_a" }] },
    };
    const inputB = {
      envelope: {
        artifacts: {
          output_prefix: outputPrefix.replace("attempt_a", "attempt_b"),
          transfer_port_reservation_ids: ["reservation_b"],
        },
      },
      batch: { items: [{ scene_id: "scene_b" }] },
    };
    const invalidAuthority = {
      ...authority("attempt_b", "reservation_b"),
      outputPutUrls: ["not-a-url"],
    };
    await expect(
      instance.dispatchConcurrentReaders([
        { requestKey: "attempt_a", attemptId: "attempt_a", input, outputAuthority: authority() },
        {
          requestKey: "attempt_b",
          attemptId: "attempt_b",
          input: inputB,
          outputAuthority: invalidAuthority,
        },
      ]),
    ).rejects.toThrow("RUNPOD_OUTPUT_URL_INVALID");
    expect(
      fetch.mock.calls.filter(([url]) => new URL(String(url)).pathname.endsWith("/run")),
    ).toHaveLength(0);
  });

  it("blocks concurrent readers when the max-two endpoint is only quiescent", async () => {
    const baseFetch = harnessFetch();
    let maxTwoApplied = false;
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path === "/endpoints/endpoint_01/update") {
        const body = init?.body === undefined ? null : JSON.parse(String(init.body));
        const response = await baseFetch(input, init);
        if (body?.workersMax === 2) maxTwoApplied = true;
        return response;
      }
      if (path === "/endpoint_01/health" && maxTwoApplied) {
        return jsonResponse({
          workers: {
            idle: 0,
            running: 0,
            initializing: 0,
            ready: 0,
            throttled: 1,
            unhealthy: 0,
          },
          jobs: { inQueue: 0, inProgress: 0 },
        });
      }
      return baseFetch(input, init);
    });
    const instance = makeHarness(fetch);
    await instance.create();
    await instance.drain();
    instance.markInitialQualificationComplete();
    await expect(instance.applyConcurrentReaderPolicy()).rejects.toThrow(
      "RUNPOD_CONCURRENT_READER_BASELINE_UNCONFIRMED",
    );
    expect((await instance.evidence()).concurrentReaderConfigHash).toBeNull();
    expect(
      fetch.mock.calls.filter(([url]) => new URL(String(url)).pathname.endsWith("/run")),
    ).toHaveLength(0);
    await expect(instance.cleanup({ deleteIfFailed: true, failed: true })).rejects.toThrow(
      "RUNPOD_CLEANUP_UNCERTAIN",
    );
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(0);
  });

  it("promotes ghost-throttled health to initial scale-zero only with terminal exact inventory", async () => {
    const fetch = terminalScaleZeroFetch();
    const instance = makeHarness(fetch);
    await instance.create();
    const input = {
      envelope: {
        artifacts: {
          output_prefix: outputPrefix,
          transfer_port_reservation_ids: ["reservation_a"],
        },
      },
      batch: { items: [{ scene_id: "scene_a" }] },
    };
    await expect(
      instance.dispatchBatch({
        requestKey: "attempt_a",
        attemptId: "attempt_a",
        input,
        outputAuthority: authority(),
      }),
    ).resolves.toMatchObject({ status: "IN_QUEUE" });
    expect(
      (await instance.evidence()).events.some(
        (event) => event.event === "provider_terminal_worker_scale_zero_baseline",
      ),
    ).toBe(true);
  });

  it("recovers a post-job stale throttled health read only through two stable terminal snapshots", async () => {
    const fetch = terminalScaleZeroFetch({
      healthWorkersBeforeDispatch: {
        idle: 1,
        running: 0,
        initializing: 0,
        ready: 0,
        throttled: 0,
        unhealthy: 0,
      },
      healthWorkersAfterDispatch: {
        idle: 0,
        running: 0,
        initializing: 0,
        ready: 0,
        throttled: 1,
        unhealthy: 0,
      },
    });
    const instance = makeHarness(fetch);
    await instance.create();
    const job = await instance.dispatchBatch(oneItemInput());
    await expect(instance.reconcile(job.id)).resolves.toMatchObject({ status: "COMPLETED" });
    await expect(instance.confirmWarmIdle()).resolves.toBeUndefined();

    const evidence = await instance.evidence();
    expect(evidence.events).toContainEqual(
      expect.objectContaining({
        event: "post_job_warm_idle_fallback",
        direct_error: "RUNPOD_WARM_IDLE_NOT_CONFIRMED",
        fallback_reason: "post_job_direct_warm_idle_unconfirmed",
      }),
    );
    expect(evidence.events).toContainEqual(
      expect.objectContaining({
        event: "post_job_terminal_worker_scale_zero",
        stable_terminal_snapshot_count: 2,
      }),
    );
    expect(
      fetch.mock.calls.filter(([url]) => new URL(String(url)).pathname === "/pods"),
    ).toHaveLength(3); // one account-zero preflight plus two post-job terminal snapshots
    expect(
      fetch.mock.calls.filter(([url]) => new URL(String(url)).pathname.endsWith("/run")),
    ).toHaveLength(1);
  });

  it("fences the one-item seed at terminal scale-zero before replacement dispatch", async () => {
    const fetch = terminalScaleZeroFetch({ workerId: "worker_seed" });
    const instance = makeHarness(fetch);
    await instance.create();
    const seed = await instance.dispatchBatch(oneItemInput());
    await expect(instance.reconcile(seed.id)).resolves.toMatchObject({ status: "COMPLETED" });
    const seedIdentity: RunPodV207WorkerProcessIdentity = {
      schema_version: "videoforge-v207-worker-process-identity/v1",
      worker_id_sha256: hashValue("worker_seed"),
      pod_id_sha256: hashValue("pod_seed"),
    };
    const boundary = await instance.prepareProcessReplacement(seed.id, seedIdentity);
    expect(boundary).toMatchObject({
      seed_job_id_sha256: hashValue(seed.id),
      seed_worker_id_sha256: hashValue("worker_seed"),
      terminal_provider_worker_id_sha256: hashValue("worker_seed"),
      terminal_scale_zero_confirmed: true,
    });
    await expect(
      instance.dispatchBatch(oneItemInput("attempt_b", "reservation_b")),
    ).resolves.toMatchObject({ status: "IN_QUEUE" });
    instance.assertProcessReplacementIdentity(boundary, {
      schema_version: "videoforge-v207-worker-process-identity/v1",
      worker_id_sha256: hashValue("worker_replacement"),
      pod_id_sha256: hashValue("pod_replacement"),
    });
    expect(
      fetch.mock.calls.filter(([url]) => new URL(String(url)).pathname.endsWith("/run")),
    ).toHaveLength(2);
    const events = (await instance.evidence()).events;
    expect(events).toContainEqual(
      expect.objectContaining({
        event: "process_replacement_seed_drained",
        terminal_scale_zero_confirmed: true,
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        event: "process_replacement_identity_distinct",
        distinct_worker_identity: true,
        distinct_process_identity: true,
      }),
    );
  });

  it("fails closed when the terminal provider worker identity is unavailable", async () => {
    const fetch = terminalScaleZeroFetch({ workerId: null });
    const instance = makeHarness(fetch);
    await instance.create();
    const seed = await instance.dispatchBatch(oneItemInput());
    await expect(instance.reconcile(seed.id)).resolves.toMatchObject({ status: "COMPLETED" });
    await expect(
      instance.prepareProcessReplacement(seed.id, {
        schema_version: "videoforge-v207-worker-process-identity/v1",
        worker_id_sha256: hashValue("worker_seed"),
        pod_id_sha256: hashValue("pod_seed"),
      }),
    ).rejects.toThrow("RUNPOD_PROCESS_REPLACEMENT_WORKER_IDENTITY_UNAVAILABLE");
    expect(
      fetch.mock.calls.filter(([url]) => new URL(String(url)).pathname.endsWith("/run")),
    ).toHaveLength(1);
  });

  it("uses the exact unique terminal provider Pod identity when the worker record omits id", async () => {
    const fetch = terminalScaleZeroFetch({ workerId: null, podId: "pod_seed" });
    const instance = makeHarness(fetch);
    await instance.create();
    const seed = await instance.dispatchBatch(oneItemInput());
    await expect(instance.reconcile(seed.id)).resolves.toMatchObject({ status: "COMPLETED" });
    await expect(
      instance.prepareProcessReplacement(seed.id, {
        schema_version: "videoforge-v207-worker-process-identity/v1",
        worker_id_sha256: hashValue("worker_seed"),
        pod_id_sha256: hashValue("pod_seed"),
      }),
    ).resolves.toMatchObject({
      terminal_provider_worker_id_sha256: hashValue("pod_seed"),
      terminal_provider_identity_source: "terminal_pod_record",
      terminal_scale_zero_confirmed: true,
    });
    expect(
      fetch.mock.calls.filter(([url]) => new URL(String(url)).pathname.endsWith("/run")),
    ).toHaveLength(1);
  });

  it("never lets a matching Pod identity override an explicit mismatched worker identity", async () => {
    const fetch = terminalScaleZeroFetch({ workerId: "worker_other", podId: "pod_seed" });
    const instance = makeHarness(fetch);
    await instance.create();
    const seed = await instance.dispatchBatch(oneItemInput());
    await expect(instance.reconcile(seed.id)).resolves.toMatchObject({ status: "COMPLETED" });
    await expect(
      instance.prepareProcessReplacement(seed.id, {
        schema_version: "videoforge-v207-worker-process-identity/v1",
        worker_id_sha256: hashValue("worker_seed"),
        pod_id_sha256: hashValue("pod_seed"),
      }),
    ).rejects.toThrow("RUNPOD_PROCESS_REPLACEMENT_WORKER_IDENTITY_UNAVAILABLE");
    expect(
      fetch.mock.calls.filter(([url]) => new URL(String(url)).pathname.endsWith("/run")),
    ).toHaveLength(1);
  });

  it("rejects a replacement that reuses either signed worker or process identity", async () => {
    const fetch = terminalScaleZeroFetch({ workerId: "worker_seed" });
    const instance = makeHarness(fetch);
    await instance.create();
    const seed = await instance.dispatchBatch(oneItemInput());
    await expect(instance.reconcile(seed.id)).resolves.toMatchObject({ status: "COMPLETED" });
    const boundary = await instance.prepareProcessReplacement(seed.id, {
      schema_version: "videoforge-v207-worker-process-identity/v1",
      worker_id_sha256: hashValue("worker_seed"),
      pod_id_sha256: hashValue("pod_seed"),
    });
    expect(() =>
      instance.assertProcessReplacementIdentity(boundary, {
        schema_version: "videoforge-v207-worker-process-identity/v1",
        worker_id_sha256: hashValue("worker_new"),
        pod_id_sha256: hashValue("pod_seed"),
      }),
    ).toThrow("RUNPOD_PROCESS_REPLACEMENT_IDENTITY_NOT_DISTINCT");
  });

  it("does not resurrect an owned job on exact terminal duplicate replay", async () => {
    const fetch = terminalScaleZeroFetch({
      healthWorkersBeforeDispatch: {
        idle: 1,
        running: 0,
        initializing: 0,
        ready: 0,
        throttled: 0,
        unhealthy: 0,
      },
      healthWorkersAfterDispatch: {
        idle: 0,
        running: 0,
        initializing: 0,
        ready: 0,
        throttled: 1,
        unhealthy: 0,
      },
    });
    const instance = makeHarness(fetch);
    await instance.create();
    const input = oneItemInput();
    const first = await instance.dispatchBatch(input);
    await expect(instance.reconcile(first.id)).resolves.toMatchObject({ status: "COMPLETED" });
    const replay = await instance.dispatchBatch(input);
    expect(replay).toMatchObject({ id: first.id, status: "IN_QUEUE" });
    await expect(instance.confirmWarmIdle()).resolves.toBeUndefined();

    const events = (await instance.evidence()).events;
    expect(events).toContainEqual(
      expect.objectContaining({
        event: "duplicate_delivery_reconciled",
        replay_same_job: true,
        no_new_provider_dispatch: true,
        duplicate_compute: false,
      }),
    );
    expect(
      fetch.mock.calls.filter(([url]) => new URL(String(url)).pathname.endsWith("/run")),
    ).toHaveLength(1);
    expect(
      fetch.mock.calls.filter(([url]) => new URL(String(url)).pathname.includes("/cancel/")),
    ).toHaveLength(0);
  });

  it("never uses post-job terminal inventory to hide queued or running work", async () => {
    const fetch = terminalScaleZeroFetch({
      healthWorkersBeforeDispatch: {
        idle: 1,
        running: 0,
        initializing: 0,
        ready: 0,
        throttled: 0,
        unhealthy: 0,
      },
      healthWorkersAfterDispatch: {
        idle: 0,
        running: 0,
        initializing: 0,
        ready: 0,
        throttled: 1,
        unhealthy: 0,
      },
      healthJobsAfterFirstSnapshot: { inQueue: 0, inProgress: 1 },
    });
    const instance = makeHarness(fetch);
    await instance.create();
    const first = await instance.dispatchBatch(oneItemInput());
    await expect(instance.reconcile(first.id)).resolves.toMatchObject({ status: "COMPLETED" });
    await expect(instance.confirmWarmIdle()).rejects.toThrow("RUNPOD_QUEUE_EMPTY_NOT_CONFIRMED");
    await expect(
      instance.dispatchBatch(oneItemInput("attempt_b", "reservation_b")),
    ).rejects.toThrow("RUNPOD_DISPATCH_BLOCKED");
    expect(
      fetch.mock.calls.filter(([url]) => new URL(String(url)).pathname.endsWith("/run")),
    ).toHaveLength(1);
  });

  it.each([
    ["nonterminal worker", { workerStatusAfterDispatch: "RUNNING" }],
    ["endpoint identity drift", { endpointDriftAfterDispatch: { workersMax: 2 } }],
    ["mismatched pod", { podEndpointIdAfterDispatch: "endpoint_02" }],
  ] as const)(
    "fails closed and blocks dispatch on post-job %s inventory",
    async (_label, options) => {
      const fetch = terminalScaleZeroFetch({
        ...options,
        healthWorkersBeforeDispatch: {
          idle: 1,
          running: 0,
          initializing: 0,
          ready: 0,
          throttled: 0,
          unhealthy: 0,
        },
        healthWorkersAfterDispatch: {
          idle: 0,
          running: 0,
          initializing: 0,
          ready: 0,
          throttled: 1,
          unhealthy: 0,
        },
      });
      const instance = makeHarness(fetch);
      await instance.create();
      const job = await instance.dispatchBatch(oneItemInput());
      await expect(instance.reconcile(job.id)).resolves.toMatchObject({ status: "COMPLETED" });
      await expect(instance.confirmWarmIdle()).rejects.toThrow(
        "RUNPOD_TERMINAL_SCALE_ZERO_NOT_CONFIRMED",
      );
      await expect(
        instance.dispatchBatch(oneItemInput("attempt_b", "reservation_b")),
      ).rejects.toThrow("RUNPOD_DISPATCH_BLOCKED");
      expect(
        fetch.mock.calls.filter(([url]) => new URL(String(url)).pathname.endsWith("/run")),
      ).toHaveLength(1);
    },
  );

  it("uses exact startup inventory when FlashBoot health counters are incomplete", async () => {
    const fetch = terminalScaleZeroFetch({
      healthWorkers: {
        idle: 0,
        running: 0,
        initializing: 0,
        throttled: 1,
        unhealthy: 0,
      },
    });
    const instance = makeHarness(fetch);
    await expect(instance.create()).resolves.toBeUndefined();
    const evidence = await instance.evidence();
    expect(evidence.initialConfigHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(evidence.events).toContainEqual(
      expect.objectContaining({
        event: "provider_terminal_worker_scale_zero_baseline",
        startup_health_proof: "fresh_endpoint_no_owned_job_inventory_only",
        startup_queue_proof_read_count: 4,
        stable_terminal_snapshot_count: 2,
      }),
    );
    expect(
      fetch.mock.calls.filter(([url]) => new URL(String(url)).pathname.endsWith("/run")),
    ).toHaveLength(0);
  });

  it.each([
    ["queued job", { inQueue: 1, inProgress: 0 }],
    ["in-progress job", { inQueue: 0, inProgress: 1 }],
    ["missing inQueue counter", { inProgress: 0 }],
    ["unknown inQueue counter", { inQueue: "0", inProgress: 0 }],
  ] as const)("fails startup inventory fallback closed with %s", async (_label, jobs) => {
    const fetch = terminalScaleZeroFetch({
      healthWorkers: {
        idle: 0,
        running: 0,
        initializing: 0,
        throttled: 1,
        unhealthy: 0,
      },
      healthJobs: jobs,
    });
    const instance = makeHarness(fetch);
    await expect(instance.create()).rejects.toThrow("RUNPOD_STARTUP_QUEUE_NOT_CONFIRMED");
    expect(
      fetch.mock.calls.filter(([url]) => new URL(String(url)).pathname.endsWith("/run")),
    ).toHaveLength(0);
  });

  it.each([
    ["running worker", { workerStatus: "RUNNING" }],
    ["unknown worker", { workerStatus: "UNKNOWN" }],
    ["conflicting worker status", { workerStatus: "EXITED", workerCurrentStatus: "RUNNING" }],
    ["running pod", { podStatus: "RUNNING" }],
    ["conflicting pod status", { podStatus: "EXITED", podCurrentStatus: "RUNNING" }],
    ["unattributed pod", { podEndpointId: null }],
    ["wrong endpoint pod", { podEndpointId: "endpoint_02" }],
    ["extra endpoint", { extraEndpoint: true }],
    ["extra template", { extraTemplate: true }],
    ["worker-limit drift", { endpointDrift: { workersMax: 2 } }],
    ["missing worker records", { endpointDrift: { workers: undefined } }],
    ["flashboot drift", { endpointDrift: { flashboot: false } }],
    ["GPU drift", { endpointDrift: { gpuTypeIds: ["NVIDIA A40"] } }],
  ] as const)("rejects terminal scale-zero proof with %s", async (_label, options) => {
    const fetch = terminalScaleZeroFetch(options);
    const instance = makeHarness(fetch);
    await expect(instance.create()).rejects.toThrow("RUNPOD_TERMINAL_SCALE_ZERO_NOT_CONFIRMED");
    expect(
      fetch.mock.calls.filter(([url]) => new URL(String(url)).pathname.endsWith("/run")),
    ).toHaveLength(0);
  });

  it("keeps post-drain terminal promotion health-first", async () => {
    const baseFetch = harnessFetch();
    let healthReads = 0;
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/health")) {
        healthReads += 1;
        if (healthReads === 1) {
          return jsonResponse({
            workers: {
              idle: 1,
              running: 0,
              initializing: 0,
              ready: 0,
              throttled: 0,
              unhealthy: 0,
            },
            jobs: { inQueue: 0, inProgress: 0 },
          });
        }
        return jsonResponse({
          workers: {
            idle: 0,
            running: 0,
            initializing: 0,
            throttled: 1,
            unhealthy: 0,
          },
          jobs: { inQueue: 0, inProgress: 0 },
        });
      }
      return baseFetch(input, init);
    });
    const instance = makeHarness(fetch);
    await instance.create();
    await expect(instance.drain()).rejects.toThrow("RUNPOD_QUIESCENT_NOT_CONFIRMED");
    expect(
      fetch.mock.calls.filter(([url]) => new URL(String(url)).pathname.endsWith("/run")),
    ).toHaveLength(0);
  });

  it("permits max-two dispatch only after a second exact terminal scale-zero proof", async () => {
    const fetch = terminalScaleZeroFetch();
    const instance = makeHarness(fetch);
    await instance.create();
    instance.markInitialQualificationComplete();
    await expect(instance.applyConcurrentReaderPolicy()).resolves.toMatch(/^sha256:/u);
    const input = {
      envelope: {
        artifacts: {
          output_prefix: outputPrefix,
          transfer_port_reservation_ids: ["reservation_a"],
        },
      },
      batch: { items: [{ scene_id: "scene_a" }] },
    };
    const inputB = {
      envelope: {
        artifacts: {
          output_prefix: outputPrefix.replace("attempt_a", "attempt_b"),
          transfer_port_reservation_ids: ["reservation_b"],
        },
      },
      batch: { items: [{ scene_id: "scene_b" }] },
    };
    await expect(
      instance.dispatchConcurrentReaders([
        { requestKey: "attempt_a", attemptId: "attempt_a", input, outputAuthority: authority() },
        {
          requestKey: "attempt_b",
          attemptId: "attempt_b",
          input: inputB,
          outputAuthority: authority("attempt_b", "reservation_b"),
        },
      ]),
    ).resolves.toHaveLength(2);
    expect(
      (await instance.evidence()).events.some(
        (event) => event.event === "concurrent_reader_terminal_worker_scale_zero_baseline",
      ),
    ).toBe(true);
  });

  it("waits for two consecutive exact max-two terminal snapshots before reader dispatch", async () => {
    const baseFetch = terminalScaleZeroFetch();
    let maxTwoApplied = false;
    let generation = 0;
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      const body = init?.body === undefined ? null : JSON.parse(String(init.body));
      if (path === "/endpoints/endpoint_01/update" && body?.workersMax === 2) {
        maxTwoApplied = true;
      }
      if (maxTwoApplied && path === "/pods" && init?.method === undefined) {
        generation = Math.min(2, generation + 1);
        return jsonResponse(
          Array.from({ length: generation }, (_, index) => ({
            id: `pod_${index + 1}`,
            endpointId: "endpoint_01",
            desiredStatus: "EXITED",
          })),
        );
      }
      if (maxTwoApplied && path === "/endpoints" && init?.method === undefined) {
        return jsonResponse([
          {
            ...reconciledEndpoint,
            workersMax: 2,
            workers: Array.from({ length: generation }, () => ({ desiredStatus: "EXITED" })),
          },
        ]);
      }
      return baseFetch(input, init);
    });
    const instance = makeHarness(fetch);
    await instance.create();
    instance.markInitialQualificationComplete();
    await expect(instance.applyConcurrentReaderPolicy()).resolves.toMatch(/^sha256:/u);
    expect((await instance.evidence()).events).toContainEqual(
      expect.objectContaining({
        event: "concurrent_reader_terminal_worker_scale_zero_baseline",
        stable_terminal_snapshot_count: 2,
        endpoint_worker_record_count: 2,
        terminal_pod_record_count: 2,
      }),
    );
    expect(
      fetch.mock.calls.filter(([url]) => new URL(String(url)).pathname === "/pods").length,
    ).toBeGreaterThanOrEqual(4);
  });

  it("proves terminal max-two drain, restores max-one, and retains intended resources", async () => {
    const fetch = terminalScaleZeroFetch({
      // Reproduces Attempt32: two terminal reader workers remain reflected by stale max-two
      // health counters while exact worker/Pod inventory is already terminal.
      healthWorkersAfterDispatch: {
        idle: 0,
        running: 0,
        initializing: 0,
        ready: 0,
        throttled: 2,
        unhealthy: 0,
      },
    });
    const instance = makeHarness(fetch);
    await instance.create();
    instance.markInitialQualificationComplete();
    await instance.applyConcurrentReaderPolicy();
    const input = {
      envelope: {
        artifacts: {
          output_prefix: outputPrefix,
          transfer_port_reservation_ids: ["reservation_a"],
        },
      },
      batch: { items: [{ scene_id: "scene_a" }] },
    };
    const inputB = {
      envelope: {
        artifacts: {
          output_prefix: outputPrefix.replace("attempt_a", "attempt_b"),
          transfer_port_reservation_ids: ["reservation_b"],
        },
      },
      batch: { items: [{ scene_id: "scene_b" }] },
    };
    const jobs = await instance.dispatchConcurrentReaders([
      { requestKey: "attempt_a", attemptId: "attempt_a", input, outputAuthority: authority() },
      {
        requestKey: "attempt_b",
        attemptId: "attempt_b",
        input: inputB,
        outputAuthority: authority("attempt_b", "reservation_b"),
      },
    ]);
    await instance.reconcileConcurrentReaders([jobs[0].id, jobs[1].id]);
    await instance.drain();
    await instance.scaleDownToInitial();
    await instance.cleanup({ deleteIfFailed: false, failed: false });
    const updateWorkersMax = fetch.mock.calls
      .filter(([url]) => new URL(String(url)).pathname.endsWith("/endpoints/endpoint_01/update"))
      .map(([, init]) => JSON.parse(String(init?.body)).workersMax);
    expect(updateWorkersMax).toEqual([2, 1]);
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(0);
    const events = (await instance.evidence()).events;
    expect(events).toContainEqual(expect.objectContaining({ event: "workers_zero_confirmed" }));
    expect(events).toContainEqual(
      expect.objectContaining({
        event: "concurrent_reader_terminal_worker_drain_confirmed",
        post_job_health_proof: "queue_empty_only_terminal_inventory",
        stable_terminal_snapshot_count: 2,
      }),
    );
    expect(events).toContainEqual(expect.objectContaining({ event: "scaled_down_to_max_one" }));
    expect(events).toContainEqual(
      expect.objectContaining({ event: "resources_retained_after_drain" }),
    );
  });

  it("promotes reader jobs observed terminal during cleanup without redispatch", async () => {
    const baseFetch = terminalScaleZeroFetch({
      healthWorkersAfterDispatch: {
        idle: 0,
        running: 0,
        initializing: 0,
        ready: 0,
        throttled: 2,
        unhealthy: 0,
      },
    });
    let statusReads = 0;
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path.includes("/status/")) {
        statusReads += 1;
        const jobId = path.split("/").at(-1) ?? "job_01";
        return jsonResponse({
          id: jobId,
          status: statusReads <= 12 ? "IN_PROGRESS" : "COMPLETED",
          executionTime: 100,
          delayTime: 20,
        });
      }
      return baseFetch(input, init);
    });
    const instance = makeHarness(fetch);
    await instance.create();
    instance.markInitialQualificationComplete();
    await instance.applyConcurrentReaderPolicy();
    const input = {
      envelope: {
        artifacts: {
          output_prefix: outputPrefix,
          transfer_port_reservation_ids: ["reservation_a"],
        },
      },
      batch: { items: [{ scene_id: "scene_a" }] },
    };
    const inputB = {
      envelope: {
        artifacts: {
          output_prefix: outputPrefix.replace("attempt_a", "attempt_b"),
          transfer_port_reservation_ids: ["reservation_b"],
        },
      },
      batch: { items: [{ scene_id: "scene_b" }] },
    };
    const jobs = await instance.dispatchConcurrentReaders([
      { requestKey: "attempt_a", attemptId: "attempt_a", input, outputAuthority: authority() },
      {
        requestKey: "attempt_b",
        attemptId: "attempt_b",
        input: inputB,
        outputAuthority: authority("attempt_b", "reservation_b"),
      },
    ]);
    await expect(instance.reconcileConcurrentReaders([jobs[0].id, jobs[1].id])).rejects.toThrow(
      "RUNPOD_CONCURRENT_READER_RECOVERY_UNCONFIRMED",
    );
    await instance.cleanup({ deleteIfFailed: true, failed: true });
    expect(
      fetch.mock.calls.filter(([url]) => new URL(String(url)).pathname.endsWith("/run")),
    ).toHaveLength(2);
    const deletePaths = fetch.mock.calls
      .filter(([, init]) => init?.method === "DELETE")
      .map(([url]) => new URL(String(url)).pathname);
    expect(deletePaths).toEqual(["/endpoints/endpoint_01", "/templates/template_01"]);
    const events = (await instance.evidence()).events;
    const dispatchedReaderHashes = events
      .filter((event) => event.event === "two_concurrent_readers_dispatched")
      .flatMap((event) => event.job_id_hashes as string[]);
    const cleanupReaderHashes = events
      .filter((event) => event.event === "owned_job_cleanup_status" && event.status === "COMPLETED")
      .map((event) => event.job_id_hash as string);
    expect(new Set(cleanupReaderHashes)).toEqual(new Set(dispatchedReaderHashes));
    expect(cleanupReaderHashes).toHaveLength(2);
    expect(events).toContainEqual(
      expect.objectContaining({ event: "concurrent_reader_terminal_worker_drain_confirmed" }),
    );
    expect(events).not.toContainEqual(
      expect.objectContaining({ event: "cleanup_drain_uncertain" }),
    );
  });

  it("recovers exact completed readers after ordinary timeout and exposes ordered output verification", async () => {
    const baseFetch = terminalScaleZeroFetch({
      healthWorkersAfterDispatch: {
        idle: 0,
        running: 0,
        initializing: 0,
        ready: 0,
        throttled: 2,
        unhealthy: 0,
      },
    });
    let statusReads = 0;
    const outputFor = (attemptId: string) => {
      const key = String(authority(attemptId).authorities[0]!.path).slice(1);
      return {
        status: "SUCCEEDED",
        items: [{ output_object_key: key }],
        provenance_receipt: { items: [{ output_object_key: key }] },
      };
    };
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path.includes("/status/")) {
        statusReads += 1;
        const jobId = path.split("/").at(-1) ?? "job_01";
        const attemptId = jobId === "job_01" ? "attempt_a" : "attempt_b";
        return jsonResponse({
          id: jobId,
          status: statusReads <= 6 ? "IN_PROGRESS" : "COMPLETED",
          ...(statusReads <= 6 ? {} : { output: outputFor(attemptId) }),
          executionTime: 100,
          delayTime: 20,
        });
      }
      return baseFetch(input, init);
    });
    const instance = makeHarness(fetch);
    await instance.create();
    instance.markInitialQualificationComplete();
    await instance.applyConcurrentReaderPolicy();
    const inputA = oneItemInput("attempt_a", "reservation_a");
    const inputB = oneItemInput("attempt_b", "reservation_b");
    const jobs = await instance.dispatchConcurrentReaders([inputA, inputB]);
    const verified: string[] = [];
    const recovered = await instance.reconcileConcurrentReaders(
      [jobs[0].id, jobs[1].id],
      async (results, inputs) => {
        verified.push(
          `${results[0].id}:${results[1].id}:${inputs[0].attemptId}:${inputs[1].attemptId}`,
        );
        expect(results.map((result) => result.status)).toEqual(["COMPLETED", "COMPLETED"]);
        expect((results[0].output as Record<string, unknown>).status).toBe("SUCCEEDED");
        expect((results[1].output as Record<string, unknown>).status).toBe("SUCCEEDED");
      },
    );
    expect(recovered.map((result) => result.id)).toEqual([jobs[0].id, jobs[1].id]);
    expect(verified).toEqual(["job_01:job_02:attempt_a:attempt_b"]);
    await instance.drain();
    expect(
      fetch.mock.calls.filter(([url]) => new URL(String(url)).pathname.endsWith("/run")),
    ).toHaveLength(2);
    const events = (await instance.evidence()).events;
    const recoveryArmedIndex = events.findIndex(
      (event) => event.event === "concurrent_reader_terminal_recovery_armed",
    );
    expect(recoveryArmedIndex).toBeGreaterThan(-1);
    expect(
      events
        .slice(0, recoveryArmedIndex)
        .filter((event) => event.event === "concurrent_reader_job_status"),
    ).toHaveLength(6);
    expect(events).toContainEqual(
      expect.objectContaining({
        event: "concurrent_reader_terminal_recovery_completed",
        output_verifier_run: true,
      }),
    );
  });

  it("rejects a reversed or foreign reader tuple without another /run", async () => {
    const baseFetch = terminalScaleZeroFetch();
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path.includes("/status/")) {
        const jobId = path.split("/").at(-1) ?? "job_01";
        return jsonResponse({
          id: jobId,
          status: "IN_PROGRESS",
          executionTime: 100,
          delayTime: 20,
        });
      }
      return baseFetch(input, init);
    });
    const instance = makeHarness(fetch);
    await instance.create();
    instance.markInitialQualificationComplete();
    await instance.applyConcurrentReaderPolicy();
    const jobs = await instance.dispatchConcurrentReaders([
      oneItemInput(),
      oneItemInput("attempt_b", "reservation_b"),
    ]);
    await expect(instance.reconcileConcurrentReaders([jobs[1].id, jobs[0].id])).rejects.toThrow(
      "RUNPOD_CONCURRENT_READER_JOB_ID_MISMATCH",
    );
    expect(
      fetch.mock.calls.filter(([url]) => new URL(String(url)).pathname.endsWith("/run")),
    ).toHaveLength(2);
  });

  it("cancels and fails closed when exact readers remain nonterminal after recovery", async () => {
    const baseFetch = terminalScaleZeroFetch();
    let cancelRequested = false;
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path.includes("/cancel/")) {
        cancelRequested = true;
        return jsonResponse({ id: path.split("/").at(-1), status: "CANCELLED" });
      }
      if (path.includes("/status/")) {
        const jobId = path.split("/").at(-1) ?? "job_01";
        return jsonResponse({
          id: jobId,
          status: cancelRequested ? "CANCELLED" : "IN_PROGRESS",
          executionTime: 100,
          delayTime: 20,
        });
      }
      return baseFetch(input, init);
    });
    const instance = makeHarness(fetch);
    await instance.create();
    instance.markInitialQualificationComplete();
    await instance.applyConcurrentReaderPolicy();
    const jobs = await instance.dispatchConcurrentReaders([
      oneItemInput(),
      oneItemInput("attempt_b", "reservation_b"),
    ]);
    await expect(instance.reconcileConcurrentReaders([jobs[0].id, jobs[1].id])).rejects.toThrow(
      "RUNPOD_CONCURRENT_READER_RECOVERY_UNCONFIRMED",
    );
    expect(cancelRequested).toBe(true);
    expect(
      fetch.mock.calls.filter(([url]) => new URL(String(url)).pathname.endsWith("/run")),
    ).toHaveLength(2);
  });

  it("rejects completed readers whose output or receipt ordering crosses authorities", async () => {
    const baseFetch = terminalScaleZeroFetch();
    let statusReads = 0;
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path.includes("/status/")) {
        statusReads += 1;
        const jobId = path.split("/").at(-1) ?? "job_01";
        const wrongKey = String(authority("attempt_b").authorities[0]!.path).slice(1);
        return jsonResponse({
          id: jobId,
          status: statusReads <= 6 ? "IN_PROGRESS" : "COMPLETED",
          ...(statusReads <= 6
            ? {}
            : {
                output: {
                  status: "SUCCEEDED",
                  items: [{ output_object_key: wrongKey }],
                  provenance_receipt: { items: [{ output_object_key: wrongKey }] },
                },
              }),
          executionTime: 100,
          delayTime: 20,
        });
      }
      return baseFetch(input, init);
    });
    const instance = makeHarness(fetch);
    await instance.create();
    instance.markInitialQualificationComplete();
    await instance.applyConcurrentReaderPolicy();
    const jobs = await instance.dispatchConcurrentReaders([
      oneItemInput(),
      oneItemInput("attempt_b", "reservation_b"),
    ]);
    await expect(
      instance.reconcileConcurrentReaders([jobs[0].id, jobs[1].id], async () => undefined),
    ).rejects.toThrow("RUNPOD_CONCURRENT_READER_OUTPUT_ORDER_INVALID");
    expect(
      fetch.mock.calls.filter(([url]) => new URL(String(url)).pathname.endsWith("/run")),
    ).toHaveLength(2);
  });

  it("never uses the max-two terminal inventory fallback to hide queued reader work", async () => {
    const fetch = terminalScaleZeroFetch({
      healthWorkersBeforeDispatch: {
        idle: 1,
        running: 0,
        initializing: 0,
        ready: 0,
        throttled: 0,
        unhealthy: 0,
      },
      healthWorkersAfterDispatch: {
        idle: 0,
        running: 0,
        initializing: 0,
        ready: 0,
        throttled: 2,
        unhealthy: 0,
      },
      healthJobsAfterFirstSnapshot: { inQueue: 0, inProgress: 1 },
    });
    const instance = makeHarness(fetch);
    await instance.create();
    instance.markInitialQualificationComplete();
    await instance.applyConcurrentReaderPolicy();
    const input = {
      envelope: {
        artifacts: {
          output_prefix: outputPrefix,
          transfer_port_reservation_ids: ["reservation_a"],
        },
      },
      batch: { items: [{ scene_id: "scene_a" }] },
    };
    const inputB = {
      envelope: {
        artifacts: {
          output_prefix: outputPrefix.replace("attempt_a", "attempt_b"),
          transfer_port_reservation_ids: ["reservation_b"],
        },
      },
      batch: { items: [{ scene_id: "scene_b" }] },
    };
    const jobs = await instance.dispatchConcurrentReaders([
      { requestKey: "attempt_a", attemptId: "attempt_a", input, outputAuthority: authority() },
      {
        requestKey: "attempt_b",
        attemptId: "attempt_b",
        input: inputB,
        outputAuthority: authority("attempt_b", "reservation_b"),
      },
    ]);
    await instance.reconcileConcurrentReaders([jobs[0].id, jobs[1].id]);
    await expect(instance.drain()).rejects.toThrow("RUNPOD_CONCURRENT_READER_DRAIN_UNCERTAIN");
  });

  it("requires both reader job identities to be reconciled terminal before max-two fallback", async () => {
    const fetch = terminalScaleZeroFetch({
      healthWorkersAfterDispatch: {
        idle: 0,
        running: 0,
        initializing: 0,
        ready: 0,
        throttled: 2,
        unhealthy: 0,
      },
    });
    const instance = makeHarness(fetch);
    await instance.create();
    instance.markInitialQualificationComplete();
    await instance.applyConcurrentReaderPolicy();
    const input = {
      envelope: {
        artifacts: {
          output_prefix: outputPrefix,
          transfer_port_reservation_ids: ["reservation_a"],
        },
      },
      batch: { items: [{ scene_id: "scene_a" }] },
    };
    const inputB = {
      envelope: {
        artifacts: {
          output_prefix: outputPrefix.replace("attempt_a", "attempt_b"),
          transfer_port_reservation_ids: ["reservation_b"],
        },
      },
      batch: { items: [{ scene_id: "scene_b" }] },
    };
    await instance.dispatchConcurrentReaders([
      { requestKey: "attempt_a", attemptId: "attempt_a", input, outputAuthority: authority() },
      {
        requestKey: "attempt_b",
        attemptId: "attempt_b",
        input: inputB,
        outputAuthority: authority("attempt_b", "reservation_b"),
      },
    ]);
    await expect(instance.drain()).rejects.toThrow("RUNPOD_CONCURRENT_READER_DRAIN_UNCERTAIN");
  });

  it("blocks max-one restore and deletion when post-reader terminal inventory is active", async () => {
    const fetch = terminalScaleZeroFetch({
      workerStatusAfterDispatch: "RUNNING",
      podStatusAfterDispatch: "RUNNING",
    });
    const instance = makeHarness(fetch);
    await instance.create();
    instance.markInitialQualificationComplete();
    await instance.applyConcurrentReaderPolicy();
    const input = {
      envelope: {
        artifacts: {
          output_prefix: outputPrefix,
          transfer_port_reservation_ids: ["reservation_a"],
        },
      },
      batch: { items: [{ scene_id: "scene_a" }] },
    };
    const inputB = {
      envelope: {
        artifacts: {
          output_prefix: outputPrefix.replace("attempt_a", "attempt_b"),
          transfer_port_reservation_ids: ["reservation_b"],
        },
      },
      batch: { items: [{ scene_id: "scene_b" }] },
    };
    await instance.dispatchConcurrentReaders([
      { requestKey: "attempt_a", attemptId: "attempt_a", input, outputAuthority: authority() },
      {
        requestKey: "attempt_b",
        attemptId: "attempt_b",
        input: inputB,
        outputAuthority: authority("attempt_b", "reservation_b"),
      },
    ]);
    await expect(instance.scaleDownToInitial()).rejects.toThrow(
      "RUNPOD_CONCURRENT_READER_DRAIN_UNCERTAIN",
    );
    const updateWorkersMax = fetch.mock.calls
      .filter(([url]) => new URL(String(url)).pathname.endsWith("/endpoints/endpoint_01/update"))
      .map(([, init]) => JSON.parse(String(init?.body)).workersMax);
    expect(updateWorkersMax).toEqual([2]);
    await expect(instance.cleanup({ deleteIfFailed: true, failed: true })).resolves.toBeUndefined();
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(0);
  });

  it("fails closed when a single dispatch crosses the cap", async () => {
    const fetch = harnessFetch();
    const spendSnapshotUsd = vi
      .fn<() => Promise<number>>()
      .mockResolvedValueOnce(0) // pre-mutation guard
      .mockResolvedValueOnce(0) // endpoint warm-idle baseline
      .mockResolvedValueOnce(0) // pre-dispatch guard
      .mockResolvedValueOnce(5); // post-dispatch guard
    const instance = makeHarness(fetch, spendSnapshotUsd);
    await instance.create();
    const input = {
      envelope: {
        artifacts: {
          output_prefix: outputPrefix,
          transfer_port_reservation_ids: ["reservation_a"],
        },
      },
      batch: { items: [{ scene_id: "scene_a" }] },
    };
    await expect(
      instance.dispatchBatch({
        requestKey: "attempt_a",
        attemptId: "attempt_a",
        input,
        outputAuthority: authority(),
      }),
    ).rejects.toThrow("RUNPOD_FINITE_SPEND_CAP_EXCEEDED");
    expect(
      fetch.mock.calls.filter(([url]) => new URL(String(url)).pathname.endsWith("/run")),
    ).toHaveLength(0);
  });

  it("rejects $3.95 observed spend against a $4 cap before the first potentially billed endpoint mutation", async () => {
    const fetch = harnessFetch();
    const spendSnapshotUsd = vi.fn<() => Promise<number>>().mockResolvedValue(3.95);
    const instance = makeHarness(fetch, spendSnapshotUsd, 4);

    await expect(instance.create()).rejects.toThrow("RUNPOD_FINITE_SPEND_HEADROOM_INSUFFICIENT");
    expect(
      fetch.mock.calls.filter(
        ([url, init]) => init?.method === "POST" && new URL(String(url)).pathname === "/endpoints",
      ),
    ).toHaveLength(0);
    expect(
      fetch.mock.calls.filter(([url]) => new URL(String(url)).pathname.endsWith("/run")),
    ).toHaveLength(0);
  });

  it("reserves both concurrent-reader worst-case liabilities atomically before either /run", async () => {
    let observedSpend = 0;
    const spendSnapshotUsd = vi.fn<() => Promise<number>>(async () => observedSpend);
    const fetch = harnessFetch();
    const instance = makeHarness(fetch, spendSnapshotUsd, 4);
    await instance.create();
    await instance.drain();
    instance.markInitialQualificationComplete();
    await instance.applyConcurrentReaderPolicy();
    observedSpend = 2.6;

    await expect(
      instance.dispatchConcurrentReaders([
        oneItemInput("attempt_a", "reservation_a"),
        oneItemInput("attempt_b", "reservation_b"),
      ]),
    ).rejects.toThrow("RUNPOD_FINITE_SPEND_HEADROOM_INSUFFICIENT");
    expect(
      fetch.mock.calls.filter(([url]) => new URL(String(url)).pathname.endsWith("/run")),
    ).toHaveLength(0);
  });

  it("does not treat warm_idle with zero idle workers as an initialization credit", async () => {
    const fetch = harnessFetch();
    const spendSnapshotUsd = vi.fn<() => Promise<number>>().mockResolvedValue(0);
    const instance = makeHarness(fetch, spendSnapshotUsd, 1.2);
    await instance.create();

    const first = await instance.dispatchBatch(oneItemInput("attempt_a", "reservation_a"));
    await instance.reconcile(first.id);
    await instance.confirmWarmIdle();
    await expect(
      instance.dispatchBatch(oneItemInput("attempt_b", "reservation_b")),
    ).rejects.toThrow("RUNPOD_FINITE_SPEND_HEADROOM_INSUFFICIENT");
    expect(
      fetch.mock.calls.filter(([url]) => new URL(String(url)).pathname.endsWith("/run")),
    ).toHaveLength(1);
  });

  it("admits exact six-plus-two under $4 after null cancel settles through monotonic stable zero", async () => {
    const baseFetch = harnessFetch();
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      const jobId = path.split("/").at(-1) ?? "job_01";
      if (path.includes("/cancel/")) {
        return jsonResponse({ id: jobId, status: "CANCELLED" });
      }
      if (path.includes("/status/")) {
        return jsonResponse({
          id: jobId,
          status: jobId === "job_05" ? "CANCELLED" : jobId === "job_06" ? "TIMED_OUT" : "COMPLETED",
          executionTime: jobId === "job_05" ? null : jobId === "job_06" ? 5_000 : 100,
          delayTime: 20,
        });
      }
      return baseFetch(input, init);
    });
    const spendSnapshotUsd = vi.fn<() => Promise<number>>().mockResolvedValue(0);
    let monotonicNow = 0;
    const instance = makeHarness(fetch, spendSnapshotUsd, 4, () => monotonicNow);
    await instance.create();

    for (const stage of ["probe", "resume", "cold", "warm"] as const) {
      const job = await instance.dispatchBatch(
        oneItemInput(`attempt_${stage}`, `reservation_${stage}`),
      );
      await instance.reconcile(job.id);
      await instance.confirmWarmIdle();
    }
    instance.markInitialQualificationComplete();

    const cancelJob = await instance.dispatchBatch(
      oneItemInput("attempt_cancel", "reservation_cancel"),
    );
    await instance.cancel(cancelJob.id);
    monotonicNow = 1_000;
    await instance.scaleDownToInitial();

    const timeoutJob = await instance.dispatchTimeoutBatch(
      oneItemInput("attempt_timeout", "reservation_timeout"),
    );
    await instance.reconcile(timeoutJob.id);
    await instance.scaleDownToInitial();

    await instance.applyConcurrentReaderPolicy();
    const readers = await instance.dispatchConcurrentReaders([
      oneItemInput("attempt_reader_a", "reservation_reader_a"),
      oneItemInput("attempt_reader_b", "reservation_reader_b"),
    ]);
    await instance.reconcileConcurrentReaders([readers[0].id, readers[1].id]);

    expect(readers).toHaveLength(2);
    expect(
      fetch.mock.calls.filter(([url]) => new URL(String(url)).pathname.endsWith("/run")),
    ).toHaveLength(8);
    const evidence = await instance.evidence();
    expect(evidence.projectedSpendUsd).not.toBeNull();
    expect(evidence.projectedSpendUsd!).toBeLessThan(4);
    expect(evidence.newPaidWorkFenced).toBe(false);
    expect(evidence.events).toContainEqual(
      expect.objectContaining({
        event: "cancel_liability_settled_after_stable_zero",
        elapsed_through_stable_zero_ms: 1_000,
        stable_zero_read_count: 2,
      }),
    );
  });

  it("rejects the readers under $4 when the six-stage cancel execution time is unknown", async () => {
    const baseFetch = harnessFetch();
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      const jobId = path.split("/").at(-1) ?? "job_01";
      if (path.includes("/cancel/")) {
        return jsonResponse({ id: jobId, status: "CANCELLED" });
      }
      if (path.includes("/status/")) {
        return jsonResponse({
          id: jobId,
          status: jobId === "job_05" ? "CANCELLED" : jobId === "job_06" ? "TIMED_OUT" : "COMPLETED",
          executionTime: jobId === "job_05" ? null : jobId === "job_06" ? 5_000 : 100,
          delayTime: 20,
        });
      }
      return baseFetch(input, init);
    });
    let monotonicNow = 0;
    const instance = makeHarness(
      fetch,
      async () => 0,
      4,
      () => monotonicNow,
    );
    await instance.create();

    for (const stage of ["probe", "resume", "cold", "warm"] as const) {
      const job = await instance.dispatchBatch(
        oneItemInput(`attempt_${stage}`, `reservation_${stage}`),
      );
      await instance.reconcile(job.id);
      await instance.confirmWarmIdle();
    }
    instance.markInitialQualificationComplete();
    const cancelJob = await instance.dispatchBatch(
      oneItemInput("attempt_cancel", "reservation_cancel"),
    );
    await instance.cancel(cancelJob.id);
    monotonicNow = 2_400_000;
    await instance.scaleDownToInitial();
    const timeoutJob = await instance.dispatchTimeoutBatch(
      oneItemInput("attempt_timeout", "reservation_timeout"),
    );
    await instance.reconcile(timeoutJob.id);
    await instance.scaleDownToInitial();
    await instance.applyConcurrentReaderPolicy();

    await expect(
      instance.dispatchConcurrentReaders([
        oneItemInput("attempt_reader_a", "reservation_reader_a"),
        oneItemInput("attempt_reader_b", "reservation_reader_b"),
      ]),
    ).rejects.toThrow("RUNPOD_FINITE_SPEND_HEADROOM_INSUFFICIENT");
    expect(
      fetch.mock.calls.filter(([url]) => new URL(String(url)).pathname.endsWith("/run")),
    ).toHaveLength(6);
    const evidence = await instance.evidence();
    const rejection = evidence.events.find(
      (event) => event.event === "finite_spend_headroom_insufficient",
    );
    expect(rejection?.projected_spend_usd).toBeCloseTo(4.316, 3);
    expect(evidence.newPaidWorkFenced).toBe(true);
  });

  it.each([
    ["nonfinite capture", [Number.NaN]],
    ["backward clock", [100, 50]],
  ] as const)("retains full cancel liability and fences on %s", async (_label, readings) => {
    const baseFetch = harnessFetch();
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      const jobId = path.split("/").at(-1) ?? "job_01";
      if (path.includes("/cancel/")) return jsonResponse({ id: jobId, status: "CANCELLED" });
      if (path.includes("/status/")) {
        return jsonResponse({ id: jobId, status: "CANCELLED", executionTime: null });
      }
      return baseFetch(input, init);
    });
    let readIndex = 0;
    const clock = vi.fn(() => readings[Math.min(readIndex++, readings.length - 1)]!);
    const instance = makeHarness(fetch, async () => 0, 4, clock);
    await instance.create();
    const job = await instance.dispatchBatch(oneItemInput());
    await instance.cancel(job.id);
    await instance.scaleDownToInitial();

    await expect(
      instance.dispatchBatch(oneItemInput("attempt_b", "reservation_b")),
    ).rejects.toThrow("RUNPOD_FINITE_SPEND_HEADROOM_INSUFFICIENT");
    const evidence = await instance.evidence();
    expect(evidence.newPaidWorkFenced).toBe(true);
    expect(evidence.activeWorstCaseLiabilityUsd).toBe(0);
  });

  it.each([1, 2])(
    "retains full cancel liability when stable-zero read %i fails",
    async (failedRead) => {
      const baseFetch = harnessFetch();
      let cancelled = false;
      let postCancelHealthReads = 0;
      const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const path = new URL(String(input)).pathname;
        const jobId = path.split("/").at(-1) ?? "job_01";
        if (path.includes("/cancel/")) {
          cancelled = true;
          return jsonResponse({ id: jobId, status: "CANCELLED" });
        }
        if (path.includes("/status/")) {
          return jsonResponse({ id: jobId, status: "CANCELLED", executionTime: null });
        }
        if (path.endsWith("/health") && cancelled) {
          postCancelHealthReads += 1;
          const running = postCancelHealthReads === failedRead ? 1 : 0;
          return jsonResponse({
            workers: {
              idle: 0,
              running,
              initializing: 0,
              ready: 0,
              throttled: 0,
              unhealthy: 0,
            },
            jobs: { inQueue: 0, inProgress: 0 },
          });
        }
        return baseFetch(input, init);
      });
      const instance = makeHarness(
        fetch,
        async () => 0,
        4,
        () => 100,
      );
      await instance.create();
      const job = await instance.dispatchBatch(oneItemInput());
      await instance.cancel(job.id);
      await expect(instance.scaleDownToInitial()).rejects.toThrow();
      const evidence = await instance.evidence();
      expect(evidence.newPaidWorkFenced).toBe(true);
      expect(evidence.activeWorstCaseLiabilityUsd).toBeGreaterThan(0);
    },
  );

  it("does not reset the cancellation clock on exact dispatch replay", async () => {
    const baseFetch = harnessFetch();
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      const jobId = path.split("/").at(-1) ?? "job_01";
      if (path.includes("/cancel/")) return jsonResponse({ id: jobId, status: "CANCELLED" });
      if (path.includes("/status/")) {
        return jsonResponse({ id: jobId, status: "CANCELLED", executionTime: null });
      }
      return baseFetch(input, init);
    });
    const clock = vi.fn().mockReturnValueOnce(100).mockReturnValue(1_100);
    const instance = makeHarness(fetch, async () => 0, 4, clock);
    await instance.create();
    const input = oneItemInput();
    const job = await instance.dispatchBatch(input);
    await instance.dispatchBatch(input);
    await instance.cancel(job.id);
    await instance.scaleDownToInitial();

    const evidence = await instance.evidence();
    expect(evidence.events).toContainEqual(
      expect.objectContaining({
        event: "cancel_liability_settled_after_stable_zero",
        elapsed_through_stable_zero_ms: 1_000,
      }),
    );
    expect(clock).toHaveBeenCalledTimes(2);
    expect(
      fetch.mock.calls.filter(([url]) => new URL(String(url)).pathname.endsWith("/run")),
    ).toHaveLength(1);
  });

  it("fails closed when the max-two policy update crosses the cap", async () => {
    const fetch = harnessFetch();
    const spendSnapshotUsd = vi
      .fn<() => Promise<number>>()
      .mockResolvedValueOnce(0) // pre-mutation guard
      .mockResolvedValueOnce(0) // endpoint warm-idle baseline
      .mockResolvedValueOnce(0) // pre-policy guard
      .mockResolvedValueOnce(5); // post-policy guard
    const instance = makeHarness(fetch, spendSnapshotUsd);
    await instance.create();
    await instance.drain();
    instance.markInitialQualificationComplete();
    await expect(instance.applyConcurrentReaderPolicy()).rejects.toThrow(
      "RUNPOD_FINITE_SPEND_CAP_EXCEEDED",
    );
    expect(
      fetch.mock.calls.filter(([url]) =>
        new URL(String(url)).pathname.endsWith("/endpoints/endpoint_01/update"),
      ),
    ).toHaveLength(0);
  });

  it("checks the finite cap after concurrent reader dispatch", async () => {
    const spendSnapshotUsd = vi
      .fn<() => Promise<number>>()
      .mockResolvedValueOnce(0) // create
      .mockResolvedValueOnce(0) // endpoint warm-idle baseline
      .mockResolvedValueOnce(0) // max-two policy preflight
      .mockResolvedValueOnce(0) // max-two policy postflight
      .mockResolvedValueOnce(0) // reader one preflight
      .mockResolvedValueOnce(0) // reader two preflight
      .mockResolvedValueOnce(5); // post-dispatch guard
    const fetch = harnessFetch();
    const instance = makeHarness(fetch, spendSnapshotUsd);
    await instance.create();
    await instance.drain();
    instance.markInitialQualificationComplete();
    await instance.applyConcurrentReaderPolicy();
    const input = {
      envelope: {
        artifacts: {
          output_prefix: outputPrefix,
          transfer_port_reservation_ids: ["reservation_a"],
        },
      },
      batch: { items: [{ scene_id: "scene_a" }] },
    };
    const inputB = {
      envelope: {
        artifacts: {
          output_prefix: outputPrefix.replace("attempt_a", "attempt_b"),
          transfer_port_reservation_ids: ["reservation_b"],
        },
      },
      batch: { items: [{ scene_id: "scene_b" }] },
    };
    await expect(
      instance.dispatchConcurrentReaders([
        { requestKey: "attempt_a", attemptId: "attempt_a", input, outputAuthority: authority() },
        {
          requestKey: "attempt_b",
          attemptId: "attempt_b",
          input: inputB,
          outputAuthority: authority("attempt_b", "reservation_b"),
        },
      ]),
    ).rejects.toThrow("RUNPOD_FINITE_SPEND_CAP_EXCEEDED");
    expect(
      fetch.mock.calls.filter(([url]) => new URL(String(url)).pathname.endsWith("/run")),
    ).toHaveLength(2);
    await instance.drain();
  });

  it("keeps the primary dispatch fence active until both reader guards drain", async () => {
    const fetch = harnessFetch();
    const instance = makeHarness(fetch);
    await instance.create();
    await instance.drain();
    instance.markInitialQualificationComplete();
    await instance.applyConcurrentReaderPolicy();
    const input = {
      envelope: {
        artifacts: {
          output_prefix: outputPrefix,
          transfer_port_reservation_ids: ["reservation_a"],
        },
      },
      batch: { items: [{ scene_id: "scene_a" }] },
    };
    const inputB = {
      envelope: {
        artifacts: {
          output_prefix: outputPrefix.replace("attempt_a", "attempt_b"),
          transfer_port_reservation_ids: ["reservation_b"],
        },
      },
      batch: { items: [{ scene_id: "scene_b" }] },
    };
    await expect(
      instance.dispatchBatch({
        requestKey: "attempt_primary_before_readers",
        attemptId: "attempt_primary_before_readers",
        input,
        outputAuthority: authority("attempt_primary_before_readers", "reservation_a"),
      }),
    ).rejects.toThrow("RUNPOD_CONCURRENT_READER_FENCE_ACTIVE");
    await instance.dispatchConcurrentReaders([
      { requestKey: "attempt_a", attemptId: "attempt_a", input, outputAuthority: authority() },
      {
        requestKey: "attempt_b",
        attemptId: "attempt_b",
        input: inputB,
        outputAuthority: authority("attempt_b", "reservation_b"),
      },
    ]);
    await expect(
      instance.dispatchBatch({
        requestKey: "attempt_primary",
        attemptId: "attempt_primary",
        input,
        outputAuthority: authority("attempt_primary", "reservation_a"),
      }),
    ).rejects.toThrow("RUNPOD_CONCURRENT_READER_FENCE_ACTIVE");
    await instance.drain();
    await expect(
      instance.dispatchBatch({
        requestKey: "attempt_a",
        attemptId: "attempt_a",
        input,
        outputAuthority: authority(),
      }),
    ).resolves.toMatchObject({ status: "IN_QUEUE" });
  });

  it("fails closed when a concurrent reader drain is ambiguous", async () => {
    const baseFetch = harnessFetch();
    let dispatched = false;
    let healthReadsAfterDispatch = 0;
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/run")) dispatched = true;
      if (path.endsWith("/health") && dispatched) {
        healthReadsAfterDispatch += 1;
        if (healthReadsAfterDispatch >= 2) throw new Error("ambiguous reader health");
      }
      return baseFetch(input, init);
    });
    const instance = makeHarness(fetch);
    await instance.create();
    instance.markInitialQualificationComplete();
    await instance.applyConcurrentReaderPolicy();
    const input = {
      envelope: {
        artifacts: {
          output_prefix: outputPrefix,
          transfer_port_reservation_ids: ["reservation_a"],
        },
      },
      batch: { items: [{ scene_id: "scene_a" }] },
    };
    const inputB = {
      envelope: {
        artifacts: {
          output_prefix: outputPrefix.replace("attempt_a", "attempt_b"),
          transfer_port_reservation_ids: ["reservation_b"],
        },
      },
      batch: { items: [{ scene_id: "scene_b" }] },
    };
    await instance.dispatchConcurrentReaders([
      { requestKey: "attempt_a", attemptId: "attempt_a", input, outputAuthority: authority() },
      {
        requestKey: "attempt_b",
        attemptId: "attempt_b",
        input: inputB,
        outputAuthority: authority("attempt_b", "reservation_b"),
      },
    ]);
    await expect(instance.drain()).rejects.toThrow("RUNPOD_CONCURRENT_READER_DRAIN_UNCERTAIN");
    expect((await instance.evidence()).events).toContainEqual(
      expect.objectContaining({ event: "concurrent_reader_drain_uncertain" }),
    );
  });

  it("redacts secrets and signed URLs from evidence", () => {
    const redacted = redactRunPodEvidence({
      apiKey,
      capability_handle: "c".repeat(64),
      output_url: "https://r2.example.test/put?signature=secret",
      endpoint_id_hash: "sha256:" + "a".repeat(64),
    });
    expect(JSON.stringify(redacted)).not.toContain(apiKey);
    expect(JSON.stringify(redacted)).not.toContain("signature=secret");
    expect(redacted.endpoint_id_hash).toMatch(/^sha256:/u);
  });

  it("forwards exact accepted records and allocates only unresolved authorities", () => {
    const account = "account-a";
    const workspace = "workspace-a";
    const project = "project-a";
    const revision = "revision-a";
    const attemptId = "replacement-attempt";
    const sourceAttemptId = "prior-attempt";
    const outputPrefix =
      `tenant/${account}/workspace/${workspace}/project/${project}/revision/${revision}` +
      `/lane/mage-image/job/${attemptId}`;
    const sourceObjectKey =
      `tenant/${account}/workspace/${workspace}/project/${project}/revision/${revision}` +
      `/lane/mage-image/job/${sourceAttemptId}/artifact/scene-01`;
    const outputHash = `sha256:${"a".repeat(64)}`;
    const authorities = Array.from({ length: 31 }, (_, index) => {
      const itemId = `scene-${String(index + 2).padStart(2, "0")}`;
      return {
        schema_version: "artifact-generated-output-authority/v1",
        reservation_id: `resume-reservation-${index + 2}`,
        account_id: account,
        workspace_id: workspace,
        method: "PUT",
        path: `/${outputPrefix}/artifact/${itemId}`,
        content_type: "image/png",
        max_content_length: 4 * 1024 * 1024,
        expires_at: "2099-01-01T00:00:00.000Z",
        max_uses: 1,
        capability_handle: "b".repeat(64),
      };
    });
    const reservationIds = authorities.map((entry) => entry.reservation_id);
    const planItems = Array.from({ length: 32 }, (_, index) => ({
      scene_id: `scene-${String(index + 1).padStart(2, "0")}`,
    }));
    const planManifest = buildV207PlanManifest(planItems, "model-revision");
    const planManifestSha256 = hashV207PlanManifest(planManifest);
    const resume = {
      schema_version: "serverless-unit-resume/v1",
      plan_manifest: planManifest,
      plan_manifest_sha256: planManifestSha256,
      accepted_units: [
        {
          tenant: { account_id: account, workspace_id: workspace },
          project_id: project,
          revision_id: revision,
          lane: "mage-image",
          plan_manifest: planManifest,
          plan_manifest_sha256: planManifestSha256,
          source_attempt_id: sourceAttemptId,
          item_id: "scene-01",
          output_object_key: sourceObjectKey,
          output_sha256: outputHash,
          output_bytes: 42,
          artifact_commit_receipt_sha256: `sha256:${"c".repeat(64)}`,
          signed_provenance_receipt_sha256: `sha256:${"e".repeat(64)}`,
          readback_port: {
            schema_version: "artifact-transfer-port/v3",
            reservation_id: "resume-readback",
            account_id: account,
            workspace_id: workspace,
            method: "GET",
            path: `/${sourceObjectKey}`,
            content_type: "image/png",
            content_length: 42,
            checksum_sha256: outputHash,
            expires_at: "2099-01-01T00:00:00.000Z",
            max_uses: 1,
            capability_handle: "d".repeat(64),
          },
          readback_get_url: "https://r2.example.test/readback",
        },
      ],
    };
    const execution = {
      schema_version: "serverless-execution-subset/v1",
      plan_manifest_sha256: planManifestSha256,
      item_ids: planItems.slice(1).map((item) => item.scene_id),
    };
    const resumeCanonicalJson = canonicalizeJson(resume);
    const executionCanonicalJson = canonicalizeJson(execution);
    const input = {
      requestKey: "request-replacement",
      attemptId,
      input: {
        envelope: {
          artifacts: {
            output_prefix: outputPrefix,
            transfer_port_reservation_ids: reservationIds,
            plan_manifest_sha256: planManifestSha256,
            resume_manifest_sha256: `sha256:${createHash("sha256")
              .update(resumeCanonicalJson)
              .digest("hex")}`,
            execution_manifest_sha256: `sha256:${createHash("sha256")
              .update(executionCanonicalJson)
              .digest("hex")}`,
          },
        },
        batch: {
          attempt_id: attemptId,
          model_revision: "model-revision",
          items: planItems,
        },
        resume,
        resume_canonical_json: resumeCanonicalJson,
        plan_manifest_canonical_json: canonicalizeJson(planManifest),
        execution,
        execution_canonical_json: executionCanonicalJson,
      },
      outputAuthority: {
        schemaVersion: "artifact-generated-output-authority/v1",
        attemptId,
        accountId: account,
        workspaceId: workspace,
        outputPrefix,
        authorities,
        outputPutUrls: authorities.map(
          (_, index) => `https://r2.example.test/put/${String(index + 2).padStart(2, "0")}`,
        ),
      },
    };
    const request = buildDispatchRequest(input as RunPodV207DispatchBatchInput) as Record<
      string,
      any
    >;
    expect(request.resume).toEqual(resume);
    expect(request.execution).toEqual(execution);
    expect(request.generated_output_authorities).toHaveLength(31);
    expect(request.generated_output_authorities[0].path).toContain("/artifact/scene-02");
    expect(request.generated_output_authorities.at(-1).path).toContain("/artifact/scene-32");

    const tamperedExecution = structuredClone(input);
    tamperedExecution.input.execution.item_ids[0] = "scene-01";
    expect(() => buildDispatchRequest(tamperedExecution as RunPodV207DispatchBatchInput)).toThrow(
      "RUNPOD_EXECUTION_SUBSET_INVALID",
    );

    const tamperedCanonicalBytes = structuredClone(input);
    tamperedCanonicalBytes.input.execution_canonical_json += " ";
    expect(() =>
      buildDispatchRequest(tamperedCanonicalBytes as RunPodV207DispatchBatchInput),
    ).toThrow("RUNPOD_EXECUTION_SUBSET_INVALID");
  });

  it("rejects tampered durable bytes and same-attempt source records before dispatch", () => {
    const input = {
      requestKey: "request-replacement",
      attemptId: "replacement-attempt",
      input: {
        envelope: { artifacts: { output_prefix: "x", transfer_port_reservation_ids: [] } },
        batch: { items: [] },
        resume: { schema_version: "serverless-unit-resume/v1", accepted_units: [{}] },
      },
      outputAuthority: {
        schemaVersion: "artifact-generated-output-authority/v1",
        attemptId: "replacement-attempt",
        accountId: "account-a",
        workspaceId: "workspace-a",
        outputPrefix: "x",
        authorities: [],
        outputPutUrls: [],
      },
    };
    expect(() => buildDispatchRequest(input as RunPodV207DispatchBatchInput)).toThrow(
      "RUNPOD_RESUME_AUTHORITY_INVALID",
    );
  });
});

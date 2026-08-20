import { describe, expect, it, vi } from "vitest";

import { RunPodControlClient, type RunPodV207Placement } from "./runpod-control";
import {
  RunPodV207QualificationHarness,
  redactRunPodEvidence,
  type RunPodV207OutputAuthority,
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

function harnessFetch(
  volume: { readonly id: string; readonly size: number; readonly dataCenterId?: string } = {
    id: "volume_01",
    size: 50,
    dataCenterId: "EU-RO-1",
  },
) {
  let runCount = 0;
  let statusCount = 0;
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
          flashboot: false,
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
        flashboot: false,
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
        workers: { idle: 0, running: 0 },
        jobs: { inQueue: 0, inProgress: 0 },
      });
    }
    if (path.includes("/cancel/")) return jsonResponse({ id: "job_01", status: "CANCELLED" });
    throw new Error(`unexpected request ${path}`);
  });
}

function makeHarness(
  fetch: typeof globalThis.fetch,
  spendSnapshotUsd: () => Promise<number> = async () => 0,
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
    finiteSpendCapUsd: 4,
    spendSnapshotUsd,
    fetch,
    baseUrl: "http://127.0.0.1:43123",
    pollIntervalMs: 1,
    maxPolls: 3,
    sleep: async () => undefined,
  });
}

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
  flashboot: false,
  networkVolumeId: "volume_01",
  dataCenterIds: ["EU-RO-1"],
  idleTimeout: 5,
  executionTimeoutMs: 2_400_000,
  scalerType: "REQUEST_COUNT",
  scalerValue: 1,
  workers: [],
};

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

  it("normalizes one explicit flashboot=true create and continues after false readback", async () => {
    const baseFetch = harnessFetch();
    let resourcesVisible = false;
    let flashboot = true;
    const providerShapeEndpoint = { ...reconciledEndpoint };
    delete (providerShapeEndpoint as Record<string, unknown>).computeType;
    delete (providerShapeEndpoint as Record<string, unknown>).dataCenterIds;
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      const body = init?.body === undefined ? null : JSON.parse(String(init.body));
      if (path === "/endpoints" && init?.method === "POST") {
        resourcesVisible = true;
        throw new Error("ambiguous endpoint response");
      }
      if (path === "/endpoints/endpoint_01/update") {
        expect(body?.flashboot).toBe(false);
        flashboot = false;
        return jsonResponse({ ...providerShapeEndpoint, flashboot });
      }
      if (path === "/endpoints" && init?.method === undefined && resourcesVisible) {
        return jsonResponse([{ ...providerShapeEndpoint, flashboot }]);
      }
      if (path === "/templates" && init?.method === undefined && resourcesVisible) {
        return jsonResponse([reconciledTemplate]);
      }
      return baseFetch(input, init);
    });
    const instance = makeHarness(fetch);
    await expect(instance.create()).resolves.toBeUndefined();
    expect(
      fetch.mock.calls.filter(
        ([url, init]) =>
          init?.method === "POST" &&
          new URL(String(url)).pathname.endsWith("/endpoints/endpoint_01/update"),
      ),
    ).toHaveLength(1);
    expect(
      (await instance.evidence()).events.some(
        (event) => event.event === "endpoint_flashboot_normalized",
      ),
    ).toBe(true);
  });

  it("fails closed when flashboot normalization readback stays enabled", async () => {
    const baseFetch = harnessFetch();
    let resourcesVisible = false;
    const driftedEndpoint = { ...reconciledEndpoint, flashboot: true };
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
      "RUNPOD_RESOURCE_RECONCILIATION_FLASHBOOT_NORMALIZATION_UNCONFIRMED",
    );
    expect((await instance.evidence()).endpointIdHash).toMatch(/^sha256:/u);
    expect(
      fetch.mock.calls.filter(
        ([url, init]) =>
          init?.method === "POST" &&
          new URL(String(url)).pathname.endsWith("/endpoints/endpoint_01/update"),
      ),
    ).toHaveLength(1);
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
    ).toHaveLength(1);
    expect(
      fetch.mock.calls.filter(([url]) =>
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
    ).toHaveLength(1);
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
    let healthReads = 0;
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (new URL(String(input)).pathname.endsWith("/health")) {
        healthReads += 1;
        if (healthReads >= 3) throw new Error("ambiguous reader health");
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
});

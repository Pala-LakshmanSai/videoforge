import { describe, expect, it, vi } from "vitest";

import {
  RunPodControlClient,
  type RunPodV207Placement,
} from "./runpod-control";
import {
  RunPodV207QualificationHarness,
  redactRunPodEvidence,
  type RunPodV207OutputAuthority,
} from "./runpod-v207-qualification-harness";

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

const image =
  "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:" + "a".repeat(64);
const outputPrefix =
  "tenant/account_a/workspace/workspace_a/project/project_a/revision/revision_a/lane/mage-image/job/attempt_a";

const authority = (): RunPodV207OutputAuthority => ({
  schemaVersion: "artifact-generated-output-authority/v1",
  attemptId: "attempt_a",
  accountId: "account_a",
  workspaceId: "workspace_a",
  outputPrefix,
  authorities: [
    {
      schema_version: "artifact-generated-output-authority/v1",
      reservation_id: "reservation_a",
      account_id: "account_a",
      workspace_id: "workspace_a",
      method: "PUT",
      path: `/${outputPrefix}/artifact/scene_a`,
      content_type: "image/png",
      max_content_length: 4 * 1024 * 1024,
      expires_at: "2099-01-01T00:00:00.000Z",
      max_uses: 1,
      capability_handle: "c".repeat(64),
    },
  ],
  outputPutUrls: ["https://r2.example.test/put?signature=opaque"],
});

function harnessFetch() {
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
    if (path === "/networkvolumes") return jsonResponse([{ id: "volume_01", size: 50 }]);
    if (path === "/templates" && init?.method === "POST") {
      return jsonResponse({
        id: "template_01",
        name: body.name,
        imageName: body.imageName,
        containerDiskInGb: body.containerDiskInGb,
        isPublic: false,
        isServerless: true,
        volumeInGb: 0,
        volumeMountPath: "/runpod-volume",
      }, 201);
    }
    if (path === "/endpoints" && init?.method === "POST") {
      return jsonResponse({
        id: "endpoint_01",
        templateId: body.templateId,
        computeType: "GPU",
        workersMin: 0,
        workersMax: body.workersMax,
        gpuCount: 1,
        gpuTypeIds: ["NVIDIA GeForce RTX 4090"],
        networkVolumeId: "volume_01",
        dataCenterIds: ["EU-RO-1"],
        scalerType: "REQUEST_COUNT",
        scalerValue: 1,
      }, 201);
    }
    if (path === "/endpoints/endpoint_01/update") {
      return jsonResponse({
        id: "endpoint_01",
        workersMin: 0,
        workersMax: body.workersMax,
        gpuCount: 1,
        gpuTypeIds: ["NVIDIA GeForce RTX 4090"],
        networkVolumeId: "volume_01",
        dataCenterIds: ["EU-RO-1"],
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
      return jsonResponse({ workers: { idle: 0, running: 0 }, jobs: { inQueue: 0, inProgress: 0 } });
    }
    if (path.includes("/cancel/")) return jsonResponse({ id: "job_01", status: "CANCELLED" });
    throw new Error(`unexpected request ${path}`);
  });
}

function makeHarness(fetch: typeof globalThis.fetch) {
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
    containerDiskInGb: 100,
    placement,
    initialPolicy: {
      workersMin: 0,
      workersMax: 1,
      gpuCount: 1,
      idleTimeout: 5,
      executionTimeoutMs: 600_000,
    },
    concurrentReaderPolicy: {
      workersMin: 0,
      workersMax: 2,
      gpuCount: 1,
      idleTimeout: 5,
      executionTimeoutMs: 600_000,
    },
    finiteSpendCapUsd: 4,
    spendSnapshotUsd: async () => 0,
    fetch,
    baseUrl: "http://127.0.0.1:43123",
    pollIntervalMs: 1,
    maxPolls: 3,
    sleep: async () => undefined,
  });
}

describe("V2-07 qualification harness", () => {
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

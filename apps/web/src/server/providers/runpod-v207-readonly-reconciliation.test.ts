import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { SUJAL_RUNPOD_ACCOUNT_ID_SHA256 } from "./keychain";
import type { RunPodDisposableResourceInventory, RunPodInventory } from "./runpod-control";
import {
  V207_FAILED_CLEANUP_SOULX_VOLUME_ID_HASH,
  V207_FAILED_CLEANUP_VOLUME_ID_HASH,
} from "./runpod-v207-failed-cleanup";
import {
  reconcileV207Readonly,
  reconcileV207SuccessReadonly,
  v207IncrementalSpendFromBilling,
  v207IncrementalSpendThreshold,
} from "./runpod-v207-readonly-reconciliation";

const hashResourceId = (value: string): string =>
  `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
const SUCCESS_ENDPOINT_ID = "endpoint-id";
const SUCCESS_TEMPLATE_ID = "template-id";
const SUCCESS_ENDPOINT_ID_HASH = hashResourceId(SUCCESS_ENDPOINT_ID);
const SUCCESS_TEMPLATE_ID_HASH = hashResourceId(SUCCESS_TEMPLATE_ID);
const SUCCESS_IMAGE = `ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:${"a".repeat(64)}`;
const SUCCESS_VOLUME_ID = "mage-volume-id";
const SUCCESS_ENVIRONMENT = Object.freeze({
  LOG_LEVEL: "INFO",
  RUNPOD_INIT_TIMEOUT: "800",
  MAGE_MODEL_ROOT: "/runpod-volume/mage-model",
  VIDEOFORGE_JOB_SCRATCH_ROOT: "/tmp/videoforge-jobs",
  VIDEOFORGE_MAGE_ENDPOINT_ID_HASH: SUCCESS_ENDPOINT_ID_HASH,
});
const SUCCESS_CONFIGURATION = Object.freeze({
  endpointName: "videoforge_mage_v207",
  templateName: "videoforge_mage_v207",
  imageName: SUCCESS_IMAGE,
  containerDiskInGb: 120 as const,
  networkVolumeId: SUCCESS_VOLUME_ID,
  environment: SUCCESS_ENVIRONMENT,
});

const inventory = (patch: Partial<RunPodInventory> = {}): RunPodInventory => ({
  checkedAt: "2026-08-21T04:00:00.000Z",
  pods: [],
  endpoints: [],
  privateTemplateCount: 0,
  networkVolumes: [
    {
      idHash: V207_FAILED_CLEANUP_SOULX_VOLUME_ID_HASH,
      sizeGb: 50,
      dataCenterId: "EU-RO-1",
    },
    {
      idHash: V207_FAILED_CLEANUP_VOLUME_ID_HASH,
      sizeGb: 50,
      dataCenterId: "EU-RO-1",
    },
  ],
  runningPodCount: 0,
  activeServerlessWorkerCount: 0,
  ...patch,
});

const successInventory = (patch: Partial<RunPodInventory> = {}): RunPodInventory =>
  inventory({
    endpoints: [
      {
        idHash: SUCCESS_ENDPOINT_ID_HASH,
        workersMin: 0,
        workersMax: 1,
        workerRecordsReported: true,
        workerRecordCount: 0,
        activeWorkerCount: 0,
        exitedWorkerCount: 0,
        workerStatuses: [],
        scaleZeroCompliant: true,
      },
    ],
    privateTemplateCount: 1,
    ...patch,
  });

const successResources = (
  mutate: (resources: RunPodDisposableResourceInventory) => RunPodDisposableResourceInventory = (
    resources,
  ) => resources,
): RunPodDisposableResourceInventory =>
  mutate({
    endpoints: [
      {
        id: SUCCESS_ENDPOINT_ID,
        name: "videoforge_mage_v207",
        raw: {
          id: SUCCESS_ENDPOINT_ID,
          name: "videoforge_mage_v207",
          templateId: SUCCESS_TEMPLATE_ID,
          computeType: "GPU",
          gpuCount: 1,
          gpuTypeIds: ["NVIDIA GeForce RTX 4090"],
          workersMin: 0,
          workersMax: 1,
          allowedCudaVersions: ["13.0"],
          minCudaVersion: "13.0",
          flashboot: true,
          networkVolumeId: SUCCESS_VOLUME_ID,
          networkVolumeIds: [SUCCESS_VOLUME_ID],
          dataCenterIds: ["EU-RO-1"],
          idleTimeout: 5,
          executionTimeoutMs: 2_400_000,
          scalerType: "REQUEST_COUNT",
          scalerValue: 1,
          env: SUCCESS_ENVIRONMENT,
        },
      },
    ],
    templates: [
      {
        id: SUCCESS_TEMPLATE_ID,
        name: "videoforge_mage_v207",
        raw: {
          id: SUCCESS_TEMPLATE_ID,
          name: "videoforge_mage_v207",
          imageName: SUCCESS_IMAGE,
          containerDiskInGb: 120,
          dockerEntrypoint: [],
          dockerStartCmd: [],
          env: SUCCESS_ENVIRONMENT,
          isPublic: false,
          isServerless: true,
          ports: [],
          volumeInGb: 0,
          volumeMountPath: "/workspace",
        },
      },
    ],
  });

const driftSuccessResources = (
  target: "endpoint" | "template",
  patch: Record<string, unknown>,
): RunPodDisposableResourceInventory => {
  const resources = successResources();
  if (target === "endpoint") {
    const endpoint = resources.endpoints[0]!;
    return {
      ...resources,
      endpoints: [{ ...endpoint, raw: { ...endpoint.raw, ...patch } }],
    };
  }
  const template = resources.templates[0]!;
  return {
    ...resources,
    templates: [{ ...template, raw: { ...template.raw, ...patch } }],
  };
};

describe("V2-07 read-only reconciliation", () => {
  it("requires three stable zero-compute, exact-volume, billing reads", async () => {
    const readInventory = vi.fn(async () => inventory());
    const readBilling = vi.fn(async () => 0.12480033212341368);
    const wait = vi.fn(async () => undefined);
    const result = await reconcileV207Readonly({
      accountIdHash: SUJAL_RUNPOD_ACCOUNT_ID_SHA256,
      baselineEndpointSpendUsd: 0.12480033212341368,
      maximumCumulativeFiniteSpendUsd: 4,
      inventory: readInventory,
      billingAmount: readBilling,
      wait,
    });
    expect(result).toMatchObject({
      provider_mutations: 0,
      gpu_jobs_submitted: 0,
      inventory: {
        pods: 0,
        endpoints: 0,
        private_templates: 0,
        active_serverless_workers: 0,
        running_pods: 0,
      },
      billing: {
        incremental_spend_usd: 0,
        maximum_cumulative_finite_spend_usd: 4,
        within_approved_cap: true,
        settlement: "THREE_STABLE_READS",
      },
    });
    expect(readInventory).toHaveBeenCalledTimes(3);
    expect(readBilling).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["Pod", { pods: [{ idHash: "sha256:x" }] }],
    ["endpoint", { endpoints: [{ idHash: "sha256:x" }] }],
    ["template", { privateTemplateCount: 1 }],
    ["active worker", { activeServerlessWorkerCount: 1 }],
    ["running Pod", { runningPodCount: 1 }],
    ["missing volume", { networkVolumes: [] }],
  ] as const)("rejects a remaining or drifted %s", async (_label, patch) => {
    await expect(
      reconcileV207Readonly({
        accountIdHash: SUJAL_RUNPOD_ACCOUNT_ID_SHA256,
        baselineEndpointSpendUsd: 0.12480033212341368,
        maximumCumulativeFiniteSpendUsd: 4,
        inventory: async () => inventory(patch as Partial<RunPodInventory>),
        billingAmount: async () => 0.12480033212341368,
        wait: async () => undefined,
      }),
    ).rejects.toThrow("V207_RECONCILIATION_INVENTORY_MISMATCH");
  });

  it("rejects billing drift instead of claiming settlement", async () => {
    const amounts = [0.12480033212341368, 0.1249];
    await expect(
      reconcileV207Readonly({
        accountIdHash: SUJAL_RUNPOD_ACCOUNT_ID_SHA256,
        baselineEndpointSpendUsd: 0.12480033212341368,
        maximumCumulativeFiniteSpendUsd: 4,
        inventory: async () => inventory(),
        billingAmount: async () => amounts.shift() ?? 0.1249,
        wait: async () => undefined,
      }),
    ).rejects.toThrow("V207_RECONCILIATION_BILLING_UNSETTLED");
  });

  it("rejects a missing or invalid fresh-attempt baseline", async () => {
    await expect(
      reconcileV207Readonly({
        accountIdHash: SUJAL_RUNPOD_ACCOUNT_ID_SHA256,
        baselineEndpointSpendUsd: Number.NaN,
        maximumCumulativeFiniteSpendUsd: 4,
        inventory: async () => inventory(),
        billingAmount: async () => 0.12480033212341368,
        wait: async () => undefined,
      }),
    ).rejects.toThrow("V207_RECONCILIATION_BASELINE_INVALID");
  });

  it("treats the approved cap as an absolute cumulative ceiling", async () => {
    await expect(
      reconcileV207Readonly({
        accountIdHash: SUJAL_RUNPOD_ACCOUNT_ID_SHA256,
        baselineEndpointSpendUsd: 0.12480033212341368,
        maximumCumulativeFiniteSpendUsd: Number.NaN,
        inventory: async () => inventory(),
        billingAmount: async () => 0.12480033212341368,
        wait: async () => undefined,
      }),
    ).rejects.toThrow("V207_RECONCILIATION_FINITE_CAP_INVALID");
    await expect(
      reconcileV207Readonly({
        accountIdHash: SUJAL_RUNPOD_ACCOUNT_ID_SHA256,
        baselineEndpointSpendUsd: 5,
        maximumCumulativeFiniteSpendUsd: 5.1,
        inventory: async () => inventory(),
        billingAmount: async () => 5.1,
        wait: async () => undefined,
      }),
    ).resolves.toMatchObject({
      billing: {
        baseline_endpoint_spend_usd: 5,
        final_endpoint_spend_usd: 5.1,
        incremental_spend_usd: 0.09999999999999964,
        maximum_cumulative_finite_spend_usd: 5.1,
        within_approved_cap: true,
      },
    });
  });

  it("fails closed when settled incremental billing exceeds the approved cap", async () => {
    await expect(
      reconcileV207Readonly({
        accountIdHash: SUJAL_RUNPOD_ACCOUNT_ID_SHA256,
        baselineEndpointSpendUsd: 5,
        maximumCumulativeFiniteSpendUsd: 5.2,
        inventory: async () => inventory(),
        billingAmount: async () => 5.21,
        wait: async () => undefined,
      }),
    ).rejects.toThrow("V207_RECONCILIATION_FINITE_CAP_EXCEEDED");
  });

  it("keeps threshold arithmetic and downward reads fail-closed", () => {
    const baseline = 2.507309638109291;
    const absoluteCap = 4.5;
    expect(v207IncrementalSpendThreshold(baseline, absoluteCap)).toBe(absoluteCap);
    expect(absoluteCap - baseline).toBeCloseTo(1.992690361890709);
    expect(v207IncrementalSpendFromBilling(baseline, absoluteCap, absoluteCap)).toBeCloseTo(
      1.992690361890709,
    );
    expect(() => v207IncrementalSpendFromBilling(baseline, 4.500001, absoluteCap)).toThrow(
      "V207_RECONCILIATION_FINITE_CAP_EXCEEDED",
    );
    expect(() => v207IncrementalSpendFromBilling(baseline, baseline - 0.01, absoluteCap)).toThrow(
      "V207_RECONCILIATION_BILLING_INVALID",
    );
    expect(() => v207IncrementalSpendThreshold(4.500001, absoluteCap)).toThrow(
      "V207_RECONCILIATION_FINITE_CAP_INVALID",
    );
  });

  it("enforces the absolute cap in both failed and success reconciliation", async () => {
    const baseline = 2.507309638109291;
    await expect(
      reconcileV207Readonly({
        accountIdHash: SUJAL_RUNPOD_ACCOUNT_ID_SHA256,
        baselineEndpointSpendUsd: baseline,
        maximumCumulativeFiniteSpendUsd: 4.5,
        inventory: async () => inventory(),
        billingAmount: async () => 4.500001,
        wait: async () => undefined,
      }),
    ).rejects.toThrow("V207_RECONCILIATION_FINITE_CAP_EXCEEDED");
    await expect(
      reconcileV207SuccessReadonly({
        accountIdHash: SUJAL_RUNPOD_ACCOUNT_ID_SHA256,
        baselineEndpointSpendUsd: baseline,
        maximumCumulativeFiniteSpendUsd: 4.5,
        expectedEndpointIdHash: SUCCESS_ENDPOINT_ID_HASH,
        expectedTemplateIdHash: SUCCESS_TEMPLATE_ID_HASH,
        expectedConfiguration: SUCCESS_CONFIGURATION,
        inventory: async () => successInventory(),
        resources: async () => successResources(),
        queueEmpty: async () => undefined,
        billingAmount: async () => 4.500001,
        wait: async () => undefined,
      }),
    ).rejects.toThrow("V207_RECONCILIATION_FINITE_CAP_EXCEEDED");
  });

  it("requires three stable read-only snapshots while retaining the exact endpoint/template", async () => {
    const readInventory = vi.fn(async () => successInventory());
    const readResources = vi.fn(async () => successResources());
    const readBilling = vi.fn(async () => 0.12480033212341368);
    const queueEmpty = vi.fn(async () => undefined);
    const wait = vi.fn(async () => undefined);
    const result = await reconcileV207SuccessReadonly({
      accountIdHash: SUJAL_RUNPOD_ACCOUNT_ID_SHA256,
      baselineEndpointSpendUsd: 0.12480033212341368,
      maximumCumulativeFiniteSpendUsd: 4,
      expectedEndpointIdHash: SUCCESS_ENDPOINT_ID_HASH,
      expectedTemplateIdHash: SUCCESS_TEMPLATE_ID_HASH,
      expectedConfiguration: SUCCESS_CONFIGURATION,
      inventory: readInventory,
      resources: readResources,
      queueEmpty,
      billingAmount: readBilling,
      wait,
    });
    expect(result).toMatchObject({
      stable_read_count: 3,
      provider_mutations: 0,
      gpu_jobs_submitted: 0,
      inventory: {
        endpoint_count: 1,
        private_template_count: 1,
        running_pods: 0,
        active_serverless_workers: 0,
      },
      retained_resources: {
        endpoint_count: 1,
        template_count: 1,
        endpoint_id_hash: SUCCESS_ENDPOINT_ID_HASH,
        template_id_hash: SUCCESS_TEMPLATE_ID_HASH,
      },
      billing: {
        incremental_spend_usd: 0,
        settlement: "THREE_STABLE_READS",
        within_approved_cap: true,
      },
    });
    expect(readInventory).toHaveBeenCalledTimes(3);
    expect(readResources).toHaveBeenCalledTimes(3);
    expect(readBilling).toHaveBeenCalledTimes(3);
    expect(queueEmpty).toHaveBeenCalledTimes(6);
    expect(wait).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["image digest", "template", { imageName: `${SUCCESS_IMAGE}-drift` }],
    ["template environment", "template", { env: { ...SUCCESS_ENVIRONMENT, LOG_LEVEL: "DEBUG" } }],
    ["GPU allowlist", "endpoint", { gpuTypeIds: ["NVIDIA L4"] }],
    ["region", "endpoint", { dataCenterIds: ["US-TX-3"] }],
    ["Flex scaler", "endpoint", { scalerType: "QUEUE_DELAY" }],
    ["FlashBoot", "endpoint", { flashboot: false }],
    ["CUDA", "endpoint", { allowedCudaVersions: ["12.8"] }],
    ["idle timeout", "endpoint", { idleTimeout: 6 }],
    ["execution timeout", "endpoint", { executionTimeoutMs: 2_399_999 }],
    ["mount", "template", { volumeMountPath: "/runpod-volume/other" }],
    ["concurrency", "endpoint", { workersMax: 2 }],
    ["template binding", "endpoint", { templateId: "template-other" }],
  ] as const)("rejects terminal raw configuration drift in %s", async (_label, target, patch) => {
    await expect(
      reconcileV207SuccessReadonly({
        accountIdHash: SUJAL_RUNPOD_ACCOUNT_ID_SHA256,
        baselineEndpointSpendUsd: 0.12480033212341368,
        maximumCumulativeFiniteSpendUsd: 4,
        expectedEndpointIdHash: SUCCESS_ENDPOINT_ID_HASH,
        expectedTemplateIdHash: SUCCESS_TEMPLATE_ID_HASH,
        expectedConfiguration: SUCCESS_CONFIGURATION,
        inventory: async () => successInventory(),
        resources: async () => driftSuccessResources(target, patch),
        queueEmpty: async () => undefined,
        billingAmount: async () => 0.12480033212341368,
        wait: async () => undefined,
      }),
    ).rejects.toThrow("V207_SUCCESS_RECONCILIATION_CONFIGURATION_MISMATCH");
  });

  it.each([
    ["missing retained endpoint", { endpoints: [], privateTemplateCount: 1 }],
    [
      "running Pod",
      {
        pods: [
          {
            idHash: "sha256:p",
            desiredStatus: "RUNNING",
            observedStatuses: ["RUNNING"],
            endpointWorker: true,
            endpointIdHash: SUCCESS_ENDPOINT_ID_HASH,
            costPerHourUsd: 1,
          },
        ],
        runningPodCount: 1,
        activeServerlessWorkerCount: 1,
      },
    ],
  ] as const)("rejects success reconciliation when %s", async (_label, patch) => {
    await expect(
      reconcileV207SuccessReadonly({
        accountIdHash: SUJAL_RUNPOD_ACCOUNT_ID_SHA256,
        baselineEndpointSpendUsd: 0.12480033212341368,
        maximumCumulativeFiniteSpendUsd: 4,
        expectedEndpointIdHash: SUCCESS_ENDPOINT_ID_HASH,
        expectedTemplateIdHash: SUCCESS_TEMPLATE_ID_HASH,
        expectedConfiguration: SUCCESS_CONFIGURATION,
        inventory: async () => successInventory(patch as Partial<RunPodInventory>),
        resources: async () => successResources(),
        queueEmpty: async () => undefined,
        billingAmount: async () => 0.12480033212341368,
        wait: async () => undefined,
      }),
    ).rejects.toThrow("V207_SUCCESS_RECONCILIATION_INVENTORY_MISMATCH");
  });

  it("rejects a missing exact template, queue work, or unstable retained snapshot", async () => {
    await expect(
      reconcileV207SuccessReadonly({
        accountIdHash: SUJAL_RUNPOD_ACCOUNT_ID_SHA256,
        baselineEndpointSpendUsd: 0.12480033212341368,
        maximumCumulativeFiniteSpendUsd: 4,
        expectedEndpointIdHash: SUCCESS_ENDPOINT_ID_HASH,
        expectedTemplateIdHash: SUCCESS_TEMPLATE_ID_HASH,
        expectedConfiguration: SUCCESS_CONFIGURATION,
        inventory: async () => successInventory(),
        resources: async () => ({ ...successResources(), templates: [] }),
        queueEmpty: async () => undefined,
        billingAmount: async () => 0.12480033212341368,
        wait: async () => undefined,
      }),
    ).rejects.toThrow("V207_SUCCESS_RECONCILIATION_INVENTORY_MISMATCH");

    await expect(
      reconcileV207SuccessReadonly({
        accountIdHash: SUJAL_RUNPOD_ACCOUNT_ID_SHA256,
        baselineEndpointSpendUsd: 0.12480033212341368,
        maximumCumulativeFiniteSpendUsd: 4,
        expectedEndpointIdHash: SUCCESS_ENDPOINT_ID_HASH,
        expectedTemplateIdHash: SUCCESS_TEMPLATE_ID_HASH,
        expectedConfiguration: SUCCESS_CONFIGURATION,
        inventory: async () => successInventory(),
        resources: async () => successResources(),
        queueEmpty: async () => {
          throw new Error("RUNPOD_QUEUE_EMPTY_NOT_CONFIRMED");
        },
        billingAmount: async () => 0.12480033212341368,
        wait: async () => undefined,
      }),
    ).rejects.toThrow("V207_SUCCESS_RECONCILIATION_QUEUE_NOT_EMPTY");

    let read = 0;
    await expect(
      reconcileV207SuccessReadonly({
        accountIdHash: SUJAL_RUNPOD_ACCOUNT_ID_SHA256,
        baselineEndpointSpendUsd: 0.12480033212341368,
        maximumCumulativeFiniteSpendUsd: 4,
        expectedEndpointIdHash: SUCCESS_ENDPOINT_ID_HASH,
        expectedTemplateIdHash: SUCCESS_TEMPLATE_ID_HASH,
        expectedConfiguration: SUCCESS_CONFIGURATION,
        inventory: async () => {
          read += 1;
          return successInventory(
            read < 2
              ? {}
              : {
                  endpoints: [
                    {
                      ...successInventory().endpoints[0]!,
                      workerStatuses: ["EXITED"],
                      workerRecordCount: 1,
                      exitedWorkerCount: 1,
                    },
                  ],
                },
          );
        },
        resources: async () => successResources(),
        queueEmpty: async () => undefined,
        billingAmount: async () => 0.12480033212341368,
        wait: async () => undefined,
      }),
    ).rejects.toThrow("V207_SUCCESS_RECONCILIATION_INVENTORY_UNSETTLED");
  });
});

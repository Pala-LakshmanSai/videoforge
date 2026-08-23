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

const successResources = (): RunPodDisposableResourceInventory => ({
  endpoints: [
    {
      id: SUCCESS_ENDPOINT_ID,
      name: "videoforge_mage_v207",
      raw: {},
    },
  ],
  templates: [
    {
      id: SUCCESS_TEMPLATE_ID,
      name: "videoforge_mage_v207",
      raw: {},
    },
  ],
});

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

  it("treats the fresh cap as incremental over a historical baseline", async () => {
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
        maximumCumulativeFiniteSpendUsd: 0.1,
        inventory: async () => inventory(),
        billingAmount: async () => 5.1,
        wait: async () => undefined,
      }),
    ).resolves.toMatchObject({
      billing: {
        baseline_endpoint_spend_usd: 5,
        final_endpoint_spend_usd: 5.1,
        incremental_spend_usd: 0.09999999999999964,
        maximum_cumulative_finite_spend_usd: 0.1,
        within_approved_cap: true,
      },
    });
  });

  it("fails closed when settled incremental billing exceeds the approved cap", async () => {
    await expect(
      reconcileV207Readonly({
        accountIdHash: SUJAL_RUNPOD_ACCOUNT_ID_SHA256,
        baselineEndpointSpendUsd: 5,
        maximumCumulativeFiniteSpendUsd: 0.2,
        inventory: async () => inventory(),
        billingAmount: async () => 5.21,
        wait: async () => undefined,
      }),
    ).rejects.toThrow("V207_RECONCILIATION_FINITE_CAP_EXCEEDED");
  });

  it("keeps threshold arithmetic and downward reads fail-closed", () => {
    expect(v207IncrementalSpendThreshold(5, 0.2)).toBe(5.2);
    expect(v207IncrementalSpendFromBilling(5, 5.2, 0.2)).toBeCloseTo(0.2);
    expect(() => v207IncrementalSpendFromBilling(5, 4.99, 0.2)).toThrow(
      "V207_RECONCILIATION_BILLING_INVALID",
    );
    expect(() => v207IncrementalSpendThreshold(Number.MAX_VALUE, Number.MAX_VALUE)).toThrow(
      "V207_RECONCILIATION_FINITE_CAP_INVALID",
    );
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

import { describe, expect, it, vi } from "vitest";

import { SUJAL_RUNPOD_ACCOUNT_ID_SHA256 } from "./keychain";
import type { RunPodInventory } from "./runpod-control";
import {
  V207_FAILED_CLEANUP_SOULX_VOLUME_ID_HASH,
  V207_FAILED_CLEANUP_VOLUME_ID_HASH,
} from "./runpod-v207-failed-cleanup";
import { reconcileV207Readonly } from "./runpod-v207-readonly-reconciliation";

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

  it("rejects a missing, invalid, or already-exceeded cumulative finite cap", async () => {
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
        baselineEndpointSpendUsd: 0.12480033212341368,
        maximumCumulativeFiniteSpendUsd: 0.1,
        inventory: async () => inventory(),
        billingAmount: async () => 0.12480033212341368,
        wait: async () => undefined,
      }),
    ).rejects.toThrow("V207_RECONCILIATION_FINITE_CAP_INVALID");
  });

  it("fails closed when settled cumulative billing exceeds the approved cap", async () => {
    await expect(
      reconcileV207Readonly({
        accountIdHash: SUJAL_RUNPOD_ACCOUNT_ID_SHA256,
        baselineEndpointSpendUsd: 0.12480033212341368,
        maximumCumulativeFiniteSpendUsd: 0.2,
        inventory: async () => inventory(),
        billingAmount: async () => 0.21,
        wait: async () => undefined,
      }),
    ).rejects.toThrow("V207_RECONCILIATION_FINITE_CAP_EXCEEDED");
  });
});

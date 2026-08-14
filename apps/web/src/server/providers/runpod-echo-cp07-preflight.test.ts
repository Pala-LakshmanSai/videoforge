import { describe, expect, it } from "vitest";

import { SUJAL_RUNPOD_ACCOUNT_ID_SHA256 } from "./keychain";
import {
  Cp07PreflightError,
  parseCp07Catalog,
  runCp07ReadOnlyPreflight,
  type Cp07Inventory,
} from "./runpod-echo-cp07-preflight";

const inventory = (): Cp07Inventory => ({
  checkedAt: "2026-08-14T15:00:00Z",
  pods: [],
  endpoints: [],
  privateTemplateCount: 0,
  networkVolumes: [{ idHash: `sha256:${"a".repeat(64)}`, sizeGb: 50 }],
  runningPodCount: 0,
  activeServerlessWorkerCount: 0,
});

const catalog = {
  gpus: [
    {
      id: "NVIDIA GeForce RTX 5090",
      name: "RTX 5090",
      manufacturer: "NVIDIA",
      secure: true,
      memory: 32,
      availability: "HIGH",
      price: { secure: 0.69 },
      maxCount: { secure: 1 },
      dataCenters: [{ id: "EU-RO-1", availability: "HIGH" }],
    },
    {
      id: "NVIDIA GeForce RTX 4090",
      name: "RTX 4090",
      manufacturer: "NVIDIA",
      secure: true,
      memory: 24,
      availability: "HIGH",
      price: { secure: 0.74 },
      maxCount: { secure: 1 },
      dataCenters: [{ id: "EU-RO-1", availability: "HIGH" }],
    },
    {
      id: "NVIDIA RTX 4000 Ada Generation",
      name: "RTX 4000 Ada",
      manufacturer: "NVIDIA",
      secure: true,
      memory: 20,
      availability: "HIGH",
      price: { secure: 0.34 },
      maxCount: { secure: 1 },
      dataCenters: [{ id: "EU-RO-1", availability: "HIGH" }],
    },
  ],
};

describe("CP-07 read-only preflight", () => {
  it("returns only exact secure EU-RO-1 Echo candidates sorted by rate", () => {
    expect(parseCp07Catalog(catalog).map((candidate) => candidate.offeringId)).toEqual([
      "NVIDIA GeForce RTX 5090",
      "NVIDIA GeForce RTX 4090",
    ]);
  });

  it("proves zero compute, one retained Mage volume, and a separate proposed Echo volume", async () => {
    const candidates = parseCp07Catalog(catalog);
    const result = await runCp07ReadOnlyPreflight({
      apiKey: "configured-api-key-redacted",
      assertAccount: async () => ({ accountIdHash: SUJAL_RUNPOD_ACCOUNT_ID_SHA256 }),
      inventory: async () => inventory(),
      fetchCatalog: async () => candidates,
      checkedAt: "2026-08-14T15:00:01Z",
    });
    expect(result).toMatchObject({
      external_spend_usd: 0,
      provider_mutations: 0,
      inventory: { pods: 0, network_volumes: 1, echo_volume_exists: false },
      echo_artifact: {
        selected_source_bytes: 23_922_317_735,
        proposed_volume_size_gb: 50,
        minimum_post_preparation_headroom_bytes: 22_077_682_265,
      },
      volume_pricing: { proposed_ongoing_charge_usd_per_month: 3.5 },
    });
    expect(JSON.stringify(result)).not.toContain("configured-api-key-redacted");
  });

  it("fails on account drift, compute presence, or unexpected volumes", async () => {
    const base = {
      apiKey: "configured-api-key-redacted",
      assertAccount: async () => ({ accountIdHash: SUJAL_RUNPOD_ACCOUNT_ID_SHA256 }),
      inventory: async () => inventory(),
      fetchCatalog: async () => parseCp07Catalog(catalog),
      checkedAt: "2026-08-14T15:00:01Z",
    };
    await expect(
      runCp07ReadOnlyPreflight({
        ...base,
        assertAccount: async () => ({ accountIdHash: `sha256:${"b".repeat(64)}` }),
      }),
    ).rejects.toMatchObject({ code: "CP07_ACCOUNT_IDENTITY_MISMATCH" });
    await expect(
      runCp07ReadOnlyPreflight({
        ...base,
        inventory: async () => ({ ...inventory(), runningPodCount: 1 }),
      }),
    ).rejects.toBeInstanceOf(Cp07PreflightError);
    await expect(
      runCp07ReadOnlyPreflight({
        ...base,
        inventory: async () => ({ ...inventory(), networkVolumes: [] }),
      }),
    ).rejects.toMatchObject({ code: "CP07_EXPECTED_SINGLE_MAGE_VOLUME_MISMATCH" });
  });
});

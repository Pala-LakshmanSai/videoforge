import { describe, expect, it } from "vitest";

import {
  assertCp07CumulativeReservation,
  assertCp07ReplacementInventory,
  CP06_MAGE_VOLUME_ID_HASH,
  CP07_INVALID_ECHO_VOLUME_ID_HASH,
  CP07_CAPACITY_RETRY_DELAY_MS,
  CP07_CAPACITY_RETRY_LIMIT,
  CP07_REGION,
  CP07_PRIOR_CONSERVATIVE_SPEND_USD,
  CP07_VOLUME_NAME,
  CP07_VOLUME_ATTACHMENT_SETTLE_MS,
  CP07_REUSE_VERIFIED_EMPTY_ECHO_VOLUME,
  Cp07PhaseBError,
  isCp07CapacityUnavailable,
  sanitizeCp07ProviderFailure,
} from "./runpod-echo-cp07-phase-b-live";

const exactVolumes = () =>
  [
    {
      idHash: CP06_MAGE_VOLUME_ID_HASH,
      name: "videoforge-mage-cp06-model-volume-eu-ro-1-50gb",
      size: 50,
      dataCenterId: CP07_REGION,
    },
    {
      idHash: CP07_INVALID_ECHO_VOLUME_ID_HASH,
      name: CP07_VOLUME_NAME,
      size: 50,
      dataCenterId: CP07_REGION,
    },
  ] as const;

describe("CP-07 invalid Echo volume replacement boundary", () => {
  it("reuses only the exact proven-empty replacement volume after zero-Pod allocation failures", () => {
    expect(CP07_REUSE_VERIFIED_EMPTY_ECHO_VOLUME).toBe(true);
  });
  it("redacts provider URLs and opaque identities before diagnostics", () => {
    const safe = sanitizeCp07ProviderFailure(
      "failed privateVolumeIdentity123456789 at https://private.example/path",
    );
    expect(safe).toBe("failed [redacted-token] at [redacted-url]");
    expect(safe).not.toContain("privateVolumeIdentity");
  });
  it("uses a bounded provider attachment-settle delay before Pod creation", () => {
    expect(CP07_VOLUME_ATTACHMENT_SETTLE_MS).toBe(30_000);
  });
  it("retries only the exact provider no-capacity response with a bounded cadence", () => {
    expect(CP07_CAPACITY_RETRY_DELAY_MS).toBe(30_000);
    expect(CP07_CAPACITY_RETRY_LIMIT).toBe(20);
    expect(
      isCp07CapacityUnavailable(
        new Cp07PhaseBError(
          "CP07_PROVIDER_MUTATION_FAILED",
          "status:500;provider:create pod: There are no instances currently available",
        ),
      ),
    ).toBe(true);
    expect(
      isCp07CapacityUnavailable(
        new Cp07PhaseBError("CP07_PROVIDER_MUTATION_AMBIGUOUS"),
      ),
    ).toBe(false);
  });
  it("selects only the exact retained invalid Echo volume beside the exact Mage volume", () => {
    expect(assertCp07ReplacementInventory(exactVolumes())).toBe(CP07_INVALID_ECHO_VOLUME_ID_HASH);
  });

  it.each([
    ["missing Echo", exactVolumes().slice(0, 1)],
    ["extra volume", [...exactVolumes(), exactVolumes()[1]]],
    [
      "foreign Echo hash",
      [
        { ...exactVolumes()[0] },
        {
          ...exactVolumes()[1],
          idHash: `sha256:${"f".repeat(64)}` as `sha256:${string}`,
        },
      ],
    ],
    ["wrong size", [{ ...exactVolumes()[0] }, { ...exactVolumes()[1], size: 51 }]],
    ["wrong region", [{ ...exactVolumes()[0] }, { ...exactVolumes()[1], dataCenterId: "EU-SE-1" }]],
  ])("rejects %s", (_label, volumes) => {
    expect(() => assertCp07ReplacementInventory(volumes)).toThrow(
      "CP07_REPLACEMENT_VOLUME_INVENTORY_MISMATCH",
    );
  });
});

describe("CP-07 cumulative finite-cost boundary", () => {
  it("includes the prior attempt and Pod lifecycle reserve in every reservation", () => {
    expect(CP07_PRIOR_CONSERVATIVE_SPEND_USD).toBe(1.876725);
    const prep = assertCp07CumulativeReservation(0, 5_100);
    const sample = assertCp07CumulativeReservation(prep, 2_700);
    const sampleTwo = assertCp07CumulativeReservation(prep + sample, 2_700);
    const sampleThree = assertCp07CumulativeReservation(prep + sample + sampleTwo, 2_700);
    const cumulative =
      CP07_PRIOR_CONSERVATIVE_SPEND_USD + prep + sample + sampleTwo + sampleThree;
    expect(cumulative).toBeCloseTo(3.738725, 6);
    expect(6 - cumulative).toBeCloseTo(2.261275, 6);
  });

  it("rejects a next Pod whose reservation could cross the cumulative cap", () => {
    expect(() => assertCp07CumulativeReservation(4.88, 60)).toThrow("CP07_CUMULATIVE_CAP_RISK");
  });

  it.each([
    [Number.NaN, 60],
    [-1, 60],
    [0, 0],
    [0, 1.5],
  ])("rejects invalid reservation inputs", (spent, seconds) => {
    expect(() => assertCp07CumulativeReservation(spent, seconds)).toThrow(
      "CP07_COST_RESERVATION_INVALID",
    );
  });
});

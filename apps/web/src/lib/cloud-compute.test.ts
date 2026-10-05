import { describe, expect, it } from "vitest";
import { cloudComputeNeedsPolling, cloudRentalAccrued, type CloudRental } from "./cloud-compute";

const start = Date.parse("2026-10-05T09:00:00.000Z");
const rental: CloudRental = {
  id: "rental",
  machine: "RTX 4090",
  hourly_usd: 0.8,
  started_at: new Date(start).toISOString(),
  stopped_at: null,
  status: "RUNNING",
};

describe("Cloud rental charges", () => {
  it("uses the recorded rental rate for every powered-on second and freezes at confirmed stop", () => {
    expect(cloudRentalAccrued(rental, start + 3_600_000)).toEqual({
      milliseconds: 3_600_000,
      usd: 0.8,
    });
    const stopped = {
      ...rental,
      status: "STOPPED" as const,
      stopped_at: new Date(start + 900_000).toISOString(),
    };
    expect(cloudRentalAccrued(stopped, start + 9_000_000)).toEqual({
      milliseconds: 900_000,
      usd: 0.2,
    });
    expect(cloudRentalAccrued(rental, start - 1)).toEqual({ milliseconds: 0, usd: 0 });
  });

  it("keeps missing or invalid billing facts unknown instead of inventing a zero charge", () => {
    for (const rate of [null, 0, -1, NaN, Infinity]) {
      expect(cloudRentalAccrued({ ...rental, hourly_usd: rate }, start + 60_000)).toEqual({
        milliseconds: 60_000,
        usd: null,
      });
    }
    for (const started_at of [null, "invalid"]) {
      expect(cloudRentalAccrued({ ...rental, started_at, status: "UNCONFIRMED" }, start)).toEqual({
        milliseconds: null,
        usd: null,
      });
    }
    expect(cloudRentalAccrued({ ...rental, stopped_at: "invalid" }, start)).toEqual({
      milliseconds: null,
      usd: null,
    });
  });

  it("charges zero only for a rental confirmed never to have started, and polls unresolved cleanup", () => {
    const neverStarted = {
      ...rental,
      started_at: null,
      hourly_usd: null,
      status: "NOT_STARTED" as const,
    };
    expect(cloudRentalAccrued(neverStarted, start)).toEqual({ milliseconds: 0, usd: 0 });
    const snapshot = (rentals: CloudRental[]) => ({
      observed_at: new Date(start).toISOString(),
      rentals,
    });
    expect(cloudComputeNeedsPolling(snapshot([rental]))).toBe(true);
    expect(
      cloudComputeNeedsPolling(snapshot([{ ...rental, started_at: null, status: "UNCONFIRMED" }])),
    ).toBe(true);
    expect(cloudComputeNeedsPolling(snapshot([neverStarted]))).toBe(false);
    expect(
      cloudComputeNeedsPolling(
        snapshot([{ ...rental, status: "STOPPED", stopped_at: new Date(start).toISOString() }]),
      ),
    ).toBe(false);
    expect(cloudComputeNeedsPolling(null)).toBe(false);
  });
});

// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { readImageRegenerationCost } from "./hosted-image-regeneration-cost";

vi.mock("../runtime/v209-short-live-cost", () => ({
  readV209ShortProviderObservation: vi.fn(async () => ({
    providerObservedAt: "2026-09-14T00:00:00.000Z",
    rate: { flexRateMicroUsdPerGpuHour: 1_116_000 },
    billing: { cumulativeEndpointBillingMicroUsd: 123_456 },
  })),
}));

describe("image regeneration cost admission", () => {
  it.each([null, undefined, "", "invalid", -1, 4.999999])(
    "rejects missing or insufficient balance %s",
    async (clientBalance) => {
      const fetchPort = vi.fn(async () => Response.json({ data: { myself: { clientBalance } } }));
      await expect(readImageRegenerationCost("test", async () => "", fetchPort)).rejects.toThrow(
        "BALANCE_UNAVAILABLE_OR_BELOW_FLOOR",
      );
    },
  );
  it("seals a conservative one-image estimate including cancellation tail without inventing a settled bill", async () => {
    const fetchPort = vi.fn(async () =>
      Response.json({ data: { myself: { clientBalance: "7.25" } } }),
    );
    await expect(
      readImageRegenerationCost("test", async () => "", fetchPort),
    ).resolves.toMatchObject({
      balance_micro_usd: 7_250_000,
      maximum_cost_micro_usd: 2_000_000,
      estimated_cost_micro_usd: 316_200,
      cumulative_endpoint_billing_micro_usd: 123_456,
    });
  });
});

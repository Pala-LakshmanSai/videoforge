import { describe, expect, it } from "vitest";
import { quoteOrdinaryVideoBudget } from "./ordinary-video-budget";

describe("ordinary video finite budget", () => {
  it("keeps the verified 18-minute input at $2 with a shared 40-minute GPU allowance", () => {
    expect(quoteOrdinaryVideoBudget(1_091_553)).toMatchObject({
      hardVariableCostCeilingMicroUsd: 2_000_000,
      primaryExecutionForecastMicroUsd: 744_000,
      possibleDuplicateLiabilityMicroUsd: 744_000,
      settlementReserveMicroUsd: 512_000,
      totalGpuTimeoutSeconds: 2_400,
      mageImageTimeoutSeconds: 2_400,
      soulxAvatarTimeoutSeconds: 2_400,
      noRedispatch: true,
    });
  });
  it("bounds one hour to $5 including duplicate liability and settlement reserve", () => {
    const quote = quoteOrdinaryVideoBudget(3_600_000);
    expect(quote.hardVariableCostCeilingMicroUsd).toBe(5_000_000);
    expect(quote.mageImageTimeoutSeconds).toBe(3_000);
    expect(quote.soulxAvatarTimeoutSeconds).toBe(6_600);
    expect(
      quote.primaryExecutionForecastMicroUsd +
        quote.possibleDuplicateLiabilityMicroUsd +
        quote.settlementReserveMicroUsd,
    ).toBeLessThanOrEqual(5_000_000);
    expect(
      (quote.totalGpuTimeoutSeconds * quote.maximumFlexRateMicroUsdPerGpuHour) / 3_600,
    ).toBeLessThanOrEqual(quote.primaryExecutionForecastMicroUsd);
  });
  it.each([0, -1, 3_600_001, 1.5, NaN, Infinity])("rejects invalid duration %s", (duration) => {
    expect(() => quoteOrdinaryVideoBudget(duration)).toThrow(
      "ORDINARY_VIDEO_DURATION_OUT_OF_RANGE",
    );
  });
  it("quotes monotonic cent-rounded budgets between 20 minutes and one hour", () => {
    let previous = 2_000_000;
    for (let seconds = 1_200; seconds <= 3_600; seconds += 1) {
      const quote = quoteOrdinaryVideoBudget(seconds * 1_000);
      expect(quote.hardVariableCostCeilingMicroUsd).toBeGreaterThanOrEqual(previous);
      expect(quote.hardVariableCostCeilingMicroUsd).toBeLessThanOrEqual(5_000_000);
      expect(quote.hardVariableCostCeilingMicroUsd % 10_000).toBe(0);
      previous = quote.hardVariableCostCeilingMicroUsd;
    }
  });
});

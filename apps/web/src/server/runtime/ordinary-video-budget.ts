/** Finite ordinary-video quote. This does not authorize or dispatch provider work. */
export const ORDINARY_VIDEO_MAX_DURATION_MS = 3_600_000;
const SHORT_DURATION_MS = 1_200_000;
const RESERVE_MICRO_USD = 512_000;
const MAX_RATE_MICRO_USD_PER_HOUR = 1_116_000;

export function quoteOrdinaryVideoBudget(durationMs: number) {
  if (
    !Number.isSafeInteger(durationMs) ||
    durationMs < 1 ||
    durationMs > ORDINARY_VIDEO_MAX_DURATION_MS
  )
    throw new RangeError("ORDINARY_VIDEO_DURATION_OUT_OF_RANGE");
  // Keep existing <=20-minute videos within $2. Longer videos rise linearly to $5/hour.
  // Round the quote upward to cents; never infer approval from this quote.
  const hardVariableCostCeilingMicroUsd =
    2_000_000 +
    Math.ceil(
      (Math.max(0, durationMs - SHORT_DURATION_MS) * 3_000_000) /
        (ORDINARY_VIDEO_MAX_DURATION_MS - SHORT_DURATION_MS) /
        10_000,
    ) *
      10_000;
  const primaryExecutionForecastMicroUsd = Math.floor(
    (hardVariableCostCeilingMicroUsd - RESERVE_MICRO_USD) / 2,
  );
  // Equal duplicate liability is reserved even though automatic redispatch remains forbidden.
  const possibleDuplicateLiabilityMicroUsd = primaryExecutionForecastMicroUsd;
  const totalBillableSeconds = Math.floor(
    (primaryExecutionForecastMicroUsd * 3_600) / MAX_RATE_MICRO_USD_PER_HOUR,
  );
  // Both lanes share this funded wall-clock pool, including queue and cold start.
  // Individual hard limits leave ten minutes for settlement inside signed TTLs.
  const mageImageTimeoutSeconds = Math.min(totalBillableSeconds, 3_000);
  const soulxAvatarTimeoutSeconds = Math.min(totalBillableSeconds, 6_600);
  return Object.freeze({
    durationMs,
    maximumFlexRateMicroUsdPerGpuHour: MAX_RATE_MICRO_USD_PER_HOUR,
    hardVariableCostCeilingMicroUsd,
    primaryExecutionForecastMicroUsd,
    possibleDuplicateLiabilityMicroUsd,
    settlementReserveMicroUsd: RESERVE_MICRO_USD,
    totalGpuTimeoutSeconds: totalBillableSeconds,
    mageImageTimeoutSeconds,
    soulxAvatarTimeoutSeconds,
    noRedispatch: true as const,
  });
}

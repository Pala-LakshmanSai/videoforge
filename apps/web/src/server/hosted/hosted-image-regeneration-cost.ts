import { readV209ShortProviderObservation } from "../runtime/v209-short-live-cost";

/** Account-wide observations are conservative admission evidence, not a per-job invoice. */
export async function readImageRegenerationCost(
  apiKey: string,
  databaseNow: () => Promise<string>,
  fetchPort: typeof fetch = fetch,
) {
  const [observation, response] = await Promise.all([
    readV209ShortProviderObservation(apiKey, databaseNow, fetchPort),
    fetchPort("https://api.runpod.io/graphql", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ query: "query { myself { clientBalance } }" }),
      signal: AbortSignal.timeout(30_000),
    }),
  ]);
  const body = (await response.json()) as {
    errors?: unknown;
    data?: { myself?: { clientBalance?: unknown } };
  };
  const value = body.data?.myself?.clientBalance;
  const balance =
    typeof value === "number" || (typeof value === "string" && value.trim() !== "")
      ? Number(value)
      : NaN;
  const balanceMicroUsd = Math.floor(balance * 1_000_000);
  if (
    !response.ok ||
    body.errors ||
    !Number.isSafeInteger(balanceMicroUsd) ||
    balanceMicroUsd < 5_000_000
  )
    throw new Error("HOSTED_IMAGE_REGENERATION_BALANCE_UNAVAILABLE_OR_BELOW_FLOOR");
  return {
    schema_version: "videoforge-image-regeneration-cost/v1",
    observed_at: observation.providerObservedAt,
    flex_rate_micro_usd_per_gpu_hour: observation.rate.flexRateMicroUsdPerGpuHour,
    balance_micro_usd: balanceMicroUsd,
    cumulative_endpoint_billing_micro_usd: observation.billing.cumulativeEndpointBillingMicroUsd,
    estimated_cost_micro_usd: Math.ceil(
      (observation.rate.flexRateMicroUsdPerGpuHour * 1_020_000) / 3_600_000,
    ),
    maximum_cost_micro_usd: 2_000_000,
    balance_floor_micro_usd: 3_000_000,
  };
}

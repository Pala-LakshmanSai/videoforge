import { describe, expect, it } from "vitest";
import {
  assertV209ShortSettlement,
  freezeV209ShortLiveAdmission,
  readV209ShortProviderObservation,
  V209_SHORT_LIVE_COST_PROFILE,
} from "./v209-short-live-cost.js";
import canonicalPlan from "../../../../../project-context/evidence/fixtures/resolved_render_manifest.v209-short.valid.json";

const plan = () => structuredClone(canonicalPlan);
const observation = () => ({
  databaseNow: "2026-08-26T06:00:00.000Z",
  providerObservedAt: "2026-08-26T05:59:30.000Z",
  rate: {
    gpu: "NVIDIA GeForce RTX 4090" as const,
    region: "EU-RO-1" as const,
    availability: "HIGH" as const,
    secureReferenceRateMicroUsdPerGpuHour: 740_000,
    flexRateMicroUsdPerGpuHour: 1_100_000,
    checkedAt: "2026-08-26T05:59:30.000Z",
  },
  billing: { cumulativeEndpointBillingMicroUsd: 2_214_659, checkedAt: "2026-08-26T05:59:30.000Z" },
  phaseCapMicroUsd: 2_000_000 as const,
  combinedCompletionCapMicroUsd: 17_500_000 as const,
  redispatchAuthorized: false as const,
});

describe("V2-09 exact short live admission", () => {
  it("reads trusted catalog rate and cumulative billing before the DB clock", async () => {
    const fetchPort = async (input: string | URL | Request) =>
      String(input).includes("catalog/gpus")
        ? Response.json({
            gpus: [
              {
                id: "NVIDIA GeForce RTX 4090",
                manufacturer: "NVIDIA",
                secure: true,
                price: { secure: 0.74 },
                dataCenters: [{ id: "EU-RO-1", availability: "LOW" }],
              },
            ],
          })
        : Response.json([{ amount: "2.214659" }]);
    const result = await readV209ShortProviderObservation(
      "r".repeat(32),
      async () => new Date(Date.now() + 1_000).toISOString(),
      fetchPort,
    );
    expect(result.rate).toMatchObject({
      availability: "LOW",
      secureReferenceRateMicroUsdPerGpuHour: 740_000,
      flexRateMicroUsdPerGpuHour: 1_100_000,
    });
    expect(result.billing.cumulativeEndpointBillingMicroUsd).toBe(2_214_659);
  });

  it("binds every segment/artifact and counts split right-image as Mage work", async () => {
    const admitted = await freezeV209ShortLiveAdmission(plan(), observation());
    expect(admitted.work.mage_image).toEqual([
      {
        segmentId: "seg_v209_split",
        role: "right_image",
        assetId: "asset_v209_split_right",
        sha256: `sha256:${"6".repeat(64)}`,
      },
    ]);
    expect(admitted.work.soulx_avatar).toHaveLength(2);
    expect(admitted.planSha256).toBe(V209_SHORT_LIVE_COST_PROFILE.canonicalPlanSha256);
    expect(admitted.cancelAt).toBe("2026-08-26T06:20:00.000Z");
    expect(admitted.stopAt).toBe("2026-08-26T06:30:00.000Z");
    expect(V209_SHORT_LIVE_COST_PROFILE).toMatchObject({
      primaryExecutionForecastMicroUsd: 733_334,
      possibleDuplicateLiabilityMicroUsd: 733_334,
      settlementBillingLagAndCancellationReserveMicroUsd: 533_332,
      hardVariableCostCeilingMicroUsd: 2_000_000,
      combinedCompletionCapMicroUsd: 17_500_000,
      noRedispatch: true,
    });
  });

  it.each([
    [
      "artifact",
      (value: any) => {
        value.segments[1].accepted_assets.right_image.asset_id = "drift";
      },
    ],
    [
      "work",
      (value: any) => {
        value.segments[1].timeline_composition = "AVATAR_FULL";
        delete value.segments[1].accepted_assets.right_image;
      },
    ],
    [
      "crop",
      (value: any) => {
        value.soulx_crop_profile_approval.approval_sha256 = `sha256:${"9".repeat(64)}`;
      },
    ],
  ])("rejects %s plan drift", async (_name, mutate) => {
    const value = plan();
    mutate(value);
    await expect(freezeV209ShortLiveAdmission(value, observation())).rejects.toThrow(
      /V209_SHORT_PLAN_/u,
    );
  });

  it("rejects stale/expensive rate, stale billing, and cap drift", async () => {
    await expect(
      freezeV209ShortLiveAdmission(plan(), {
        ...observation(),
        rate: { ...observation().rate, flexRateMicroUsdPerGpuHour: 1_100_001 },
      }),
    ).rejects.toThrow("V209_SHORT_RATE_ADMISSION_INVALID");
    await expect(
      freezeV209ShortLiveAdmission(plan(), {
        ...observation(),
        billing: { ...observation().billing, checkedAt: "2026-08-26T05:00:00.000Z" },
      }),
    ).rejects.toThrow("V209_SHORT_BILLING_BASELINE_INVALID");
    await expect(
      freezeV209ShortLiveAdmission(plan(), {
        ...observation(),
        billing: {
          ...observation().billing,
          cumulativeEndpointBillingMicroUsd: 15_500_001,
        },
      }),
    ).rejects.toThrow("V209_SHORT_BILLING_BASELINE_INVALID");
    await expect(
      freezeV209ShortLiveAdmission(plan(), {
        ...observation(),
        combinedCompletionCapMicroUsd: 17_499_999 as 17_500_000,
      }),
    ).rejects.toThrow("V209_SHORT_AUTHORITY_SCOPE_INVALID");
    await expect(
      freezeV209ShortLiveAdmission(plan(), {
        ...observation(),
        providerObservedAt: "2026-08-26T06:00:00.001Z",
      }),
    ).rejects.toThrow("V209_SHORT_RATE_ADMISSION_INVALID");
    await expect(
      freezeV209ShortLiveAdmission(plan(), {
        ...observation(),
        billing: { ...observation().billing, checkedAt: "2026-08-26T06:00:00.001Z" },
      }),
    ).rejects.toThrow("V209_SHORT_BILLING_BASELINE_INVALID");
  });

  it("requires settled cost, terminal pair, zero workers, and no redispatch", async () => {
    const admission = await freezeV209ShortLiveAdmission(plan(), observation());
    expect(() =>
      assertV209ShortSettlement({
        admission,
        finalCumulativeEndpointBillingMicroUsd: 2_814_659,
        settledVariableCostMicroUsd: 600_000,
        possibleDuplicateCostMicroUsd: 0,
        terminalJobCount: 2,
        activeWorkers: 0,
        runningPods: 0,
        redispatchCount: 0,
      }),
    ).not.toThrow();
    expect(() =>
      assertV209ShortSettlement({
        admission,
        finalCumulativeEndpointBillingMicroUsd: 4_214_660,
        settledVariableCostMicroUsd: 600_000,
        possibleDuplicateCostMicroUsd: 0,
        terminalJobCount: 2,
        activeWorkers: 0,
        runningPods: 0,
        redispatchCount: 0,
      }),
    ).toThrow("V209_SHORT_SETTLEMENT_INVALID");
  });
});

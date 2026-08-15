import { describe, expect, it } from "vitest";

import { projectSoulXAvatarEconomics } from "./runpod-soulx-vf924s-live";

describe("VF-9-24T SoulX economics", () => {
  it("projects one cold boot plus measured generation over the exact work plan", () => {
    const projection = projectSoulXAvatarEconomics({
      outputDurationSeconds: 10,
      generationWallMs: 25_000,
      podStartToReadyMs: 190_000,
      rateUsdPerHour: 0.74,
    });

    expect(projection.padded_avatar_seconds).toBe(481.32);
    expect(projection.span_count).toBe(103);
    expect(projection.measured_request_equivalents).toBeCloseTo(48.132, 6);
    expect(projection.warm_batched_gpu_ms).toBeCloseTo(1_393_300, 3);
    expect(projection.warm_batched_gpu_cost_usd).toBeCloseTo(0.286401, 6);
  });

  it("rejects nonpositive measurements", () => {
    expect(() =>
      projectSoulXAvatarEconomics({
        outputDurationSeconds: 0,
        generationWallMs: 1,
        podStartToReadyMs: 1,
        rateUsdPerHour: 0.74,
      }),
    ).toThrow("VF924T_ECONOMICS_INPUT_INVALID");
  });
});

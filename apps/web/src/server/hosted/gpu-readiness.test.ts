import { describe, expect, it } from "vitest";

import { hostedGpuReadiness, hostedGpuReadinessForConfiguration } from "./gpu-readiness";

describe("hosted GPU readiness", () => {
  it("reports the exact fail-closed Mage and SoulX groundwork state", () => {
    const readiness = hostedGpuReadiness();

    expect(readiness).toMatchObject({
      schema_version: "videoforge-hosted-gpu-readiness/v1",
      gpu_transport: "DISABLED_UNQUALIFIED",
      provider_calls_authorized: false,
      dispatch_available: false,
    });
    expect(readiness.lanes).toEqual([
      expect.objectContaining({
        lane: "MAGE_IMAGE",
        checkpoint: "V2-07",
        qualification: "NOT_QUALIFIED",
        visual_approval: "NOT_APPLICABLE",
        missing_gates: ["identity_output", "cancellation_timeout", "max2_concurrency"],
      }),
      expect.objectContaining({
        lane: "SOULX_AVATAR",
        checkpoint: "V2-08",
        qualification: "NOT_QUALIFIED",
        visual_approval: "APPROVED_EXACT_FULL_AND_SPLIT",
        missing_gates: [
          "V2_07_MAGE_QUALIFICATION",
          "V2_08_IMAGE_PUBLICATION_AND_ENDPOINT_CONFIGURATION",
          "V2_08_MAX1_LIVE_QUALIFICATION",
        ],
      }),
    ]);
  });

  it("exposes data only, with no raw lifecycle capability", () => {
    const readiness = hostedGpuReadiness();
    const serialized = JSON.stringify(readiness);

    expect(serialized).not.toMatch(
      /"(?:endpoint_id|template_id|dispatch_url|runpod|start|stop|cancel)"\s*:/iu,
    );
    expect(Object.values(readiness).every((value) => typeof value !== "function")).toBe(true);
    expect(Object.isFrozen(readiness)).toBe(true);
    expect(Object.isFrozen(readiness.lanes)).toBe(true);
  });

  it("projects qualified truth only from an already verified qualified configuration", () => {
    expect(
      hostedGpuReadinessForConfiguration({
        gpuTransport: "QUALIFIED_EXACT",
        gpuActivation: { evidence: "verified-upstream" },
      }),
    ).toMatchObject({
      gpu_transport: "QUALIFIED_EXACT",
      provider_calls_authorized: true,
      dispatch_available: true,
      lanes: [
        { lane: "MAGE_IMAGE", qualification: "QUALIFIED_EXACT", missing_gates: [] },
        { lane: "SOULX_AVATAR", qualification: "QUALIFIED_EXACT", missing_gates: [] },
      ],
    });
    expect(
      hostedGpuReadinessForConfiguration({
        gpuTransport: "QUALIFIED_EXACT",
        gpuActivation: null,
      }),
    ).toBe(hostedGpuReadiness());
  });
});

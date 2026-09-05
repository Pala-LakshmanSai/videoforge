// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  V208_EXECUTION_ENTRYPOINT,
  V208_SOULX_VOLUME_ID_SHA256,
  V208_V207_ATTEMPT85_CLOSURE_SHA256,
  buildV208SoulXQualificationPlan,
  parseV208SoulXAuthority,
  validateV208SoulXQualificationResult,
  validateV208SoulXAuthority,
  type V208CompiledAuthority,
  type V208SoulXQualificationResult,
} from "./v208-soulx-qualification.js";

const proof = (character: string) => `sha256:${character.repeat(64)}`;
const compiled = (): V208CompiledAuthority => ({
  proposalSha256: proof("1"),
  authoritySha256: proof("2"),
  finiteCapUsd: 1,
  image: `ghcr.io/pala-lakshmansai/videoforge-soulx-v2-08@${proof("3")}`,
  imageSourceCommit: "4".repeat(40),
  runpodAccountIdSha256: proof("5"),
});
const environment = () => ({
  V208_EXECUTION_ENTRYPOINT,
  V208_PROPOSAL_SHA256: proof("1"),
  V208_AUTHORITY_SHA256: proof("2"),
  V208_FINITE_CAP_USD: "1",
  V208_IMAGE: `ghcr.io/pala-lakshmansai/videoforge-soulx-v2-08@${proof("3")}`,
  V208_IMAGE_SOURCE_COMMIT: "4".repeat(40),
  V208_RUNPOD_ACCOUNT_ID_SHA256: proof("5"),
  V208_PREDECESSOR_CLOSURE_SHA256: V208_V207_ATTEMPT85_CLOSURE_SHA256,
});

describe("V2-08 SoulX-only qualification wrapper", () => {
  it("is fail-closed until a fresh exact proposal, authority, cap and image are compiled", () => {
    expect(() => parseV208SoulXAuthority(environment())).toThrow(
      "V208_FRESH_EXACT_AUTHORITY_REQUIRED",
    );
  });

  it("requires every exact source-bound authority field", () => {
    const cases: ReadonlyArray<[string, string | undefined, string]> = [
      ["V208_EXECUTION_ENTRYPOINT", "wrong", "V208_EXECUTION_ENTRYPOINT_MISMATCH"],
      ["V208_PROPOSAL_SHA256", proof("9"), "V208_PROPOSAL_MISMATCH"],
      ["V208_AUTHORITY_SHA256", proof("9"), "V208_AUTHORITY_MISMATCH"],
      ["V208_IMAGE", `ghcr.io/example/wrong@${proof("9")}`, "V208_IMAGE_MISMATCH"],
      ["V208_IMAGE_SOURCE_COMMIT", "9".repeat(40), "V208_IMAGE_SOURCE_COMMIT_MISMATCH"],
      ["V208_RUNPOD_ACCOUNT_ID_SHA256", proof("9"), "V208_RUNPOD_ACCOUNT_MISMATCH"],
      ["V208_PREDECESSOR_CLOSURE_SHA256", proof("9"), "V208_V207_PREDECESSOR_MISMATCH"],
      ["V208_FINITE_CAP_USD", "2", "V208_FINITE_CAP_MISMATCH"],
    ];
    for (const [key, value, code] of cases) {
      expect(() =>
        validateV208SoulXAuthority({ ...environment(), [key]: value }, compiled()),
      ).toThrow(code);
    }
  });

  it("builds only the exact max-one SoulX Stage 7 plan and preserves Stage 6 as evidence", () => {
    const authority = validateV208SoulXAuthority(environment(), compiled());
    const plan = buildV208SoulXQualificationPlan(authority);
    expect(plan.predecessor).toMatchObject({
      checkpoint: "V2-07",
      result: "QUALIFIED_PASS_CLEAN",
      closureSha256: V208_V207_ATTEMPT85_CLOSURE_SHA256,
    });
    expect(plan.deployment).toMatchObject({
      region: "EU-RO-1",
      gpu: "NVIDIA GeForce RTX 4090",
      workersMin: 0,
      workersMax: 1,
      handlerConcurrency: 1,
      volumeMount: "/runpod-volume",
      volumeSizeGb: 50,
      volumeIdSha256: V208_SOULX_VOLUME_ID_SHA256,
      volumeMode: "READ_ONLY",
      noGpuFallback: true,
    });
    expect(plan.qualification.completeSpanSeconds).toEqual([2, 4, 6, 10]);
    expect(plan.qualification).toMatchObject({
      requiredWholeSpanBatch: true,
      existingMaterializerWholeSpanBatch: true,
    });
    expect(plan.qualification.wholeSpanDescriptors.map((item) => item.key)).toEqual([
      "soulxWholeSpanCold",
      "soulxWholeSpanWarm",
    ]);
    expect(plan.qualification.caseDescriptors.map((item) => item.key)).toEqual([
      "soulx2s",
      "soulx4s",
      "soulx6s",
      "soulx10s",
      "soulxCancel",
      "soulxInvalidOutput",
      "soulxTimeout",
    ]);
    expect(plan.qualification.caseDescriptors.every((item) => item.lane === "soulx")).toBe(true);
    expect(plan.cleanup).toEqual({
      deleteOutputs: true,
      deleteEndpoint: true,
      deleteTemplate: true,
      finalZeroComputeReads: 3,
      retainSoulXVolumeUnchanged: true,
    });
    expect(plan.planSha256).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it("defines a strict accepted result contract for the existing lifecycle adapter", async () => {
    const authority = validateV208SoulXAuthority(environment(), compiled());
    const plan = buildV208SoulXQualificationPlan(authority);
    const valid: V208SoulXQualificationResult = {
      schemaVersion: "videoforge.v208-soulx-qualification-result/v1",
      planSha256: plan.planSha256,
      qualified: true,
      completeSpanSeconds: [2, 4, 6, 10],
      coldModelReadyMs: 419_999,
      nativeFullSplitReadbackVerified: true,
      exactAudioVideoProbeVerified: true,
      workerReceiptsVerified: 2,
      outputItemsVerified: 8,
      cancellationVerified: true,
      invalidOutputVerified: true,
      timeoutVerified: true,
      endpointDeleted: true,
      templateDeleted: true,
      outputsDeleted: true,
      finalZeroComputeReads: 3,
      retainedSoulXVolumeUnchanged: true,
      workersMin: 0,
      workersMax: 1,
      observedSpendUsd: 1,
    };
    const executeSoulXQualification = vi.fn(async (receivedPlan: typeof plan) => {
      expect(receivedPlan.planSha256).toBe(plan.planSha256);
      return valid;
    });

    // The runtime entrypoint is intentionally sealed shut until the activation constants are set;
    // exercise the adapter result contract directly without weakening that production guard.
    const result = await executeSoulXQualification(plan);
    expect(validateV208SoulXQualificationResult(plan, result)).toEqual(valid);
    expect(executeSoulXQualification).toHaveBeenCalledTimes(1);

    expect(valid.coldModelReadyMs).toBeLessThan(plan.qualification.coldModelReadyLimitMs);
    expect(valid.observedSpendUsd).toBeLessThanOrEqual(authority.finiteCapUsd);
    expect(() =>
      validateV208SoulXQualificationResult(plan, {
        ...valid,
        coldModelReadyMs: plan.qualification.coldModelReadyLimitMs,
      }),
    ).toThrow("V208_SOULX_QUALIFICATION_RESULT_REJECTED");
    expect(() =>
      validateV208SoulXQualificationResult(plan, { ...valid, workersMax: 2 as 1 }),
    ).toThrow("V208_SOULX_QUALIFICATION_RESULT_REJECTED");
    expect(() =>
      validateV208SoulXQualificationResult(plan, { ...valid, observedSpendUsd: 1.000_001 }),
    ).toThrow("V208_SOULX_QUALIFICATION_RESULT_REJECTED");
  });
});

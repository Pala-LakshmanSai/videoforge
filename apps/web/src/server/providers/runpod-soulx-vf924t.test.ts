import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { projectSoulXAvatarEconomics, runSoulXVf924s } from "./runpod-soulx-vf924s-live";

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

  it("rejects a VF-9-24U input hash mismatch before any provider access", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "vf924u-hash-"));
    const sourceImagePath = path.join(root, "avatar.png");
    const sourceAudioPath = path.join(root, "audio.wav");
    const splitContextImagePath = path.join(root, "context.png");
    await Promise.all([
      writeFile(sourceImagePath, "owned-avatar"),
      writeFile(sourceAudioPath, "owned-audio"),
      writeFile(splitContextImagePath, "owned-context"),
    ]);
    try {
      await expect(
        runSoulXVf924s({
          taskId: "VF-9-24U",
          finiteCapUsd: 1,
          imageDigest:
            "ghcr.io/pala-lakshmansai/videoforge-soulx-flashhead-pro-vf924s@sha256:0538d16199f04cac0a68ad4570b3fc260470b079200da025fe8f36640fb69a9b",
          sourceImagePath,
          sourceAudioPath,
          splitContextImagePath,
          artifactRoot: path.join(root, "artifacts"),
          renderCropPreviews: true,
          fullPreviewProfile: "source-16x9-v1",
          expectedSourceImageSha256: `sha256:${"0".repeat(64)}`,
          expectedSourceAudioSha256: `sha256:${"1".repeat(64)}`,
          expectedSplitContextImageSha256: `sha256:${"2".repeat(64)}`,
        }),
      ).rejects.toThrow("VF924T_INPUT_HASH_MISMATCH");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { buildProviderFreeProjectBundle } from "../provider-free-foundations";
import { createNodeProviderFreeArtifactRuntime } from "./node-provider-free-artifacts";

const execute = promisify(execFile);

describe("Node provider-free artifact runtime", () => {
  it("persists exact lane assets and renders a checksum-bound 40-second MP4 with direct FFmpeg", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "videoforge-cp05-artifacts-"));
    try {
      const bundle = await buildProviderFreeProjectBundle("node-render-probe");
      const runtime = createNodeProviderFreeArtifactRuntime(root);
      const mage = await runtime.laneReceipt(bundle, "mage_image");
      const echo = await runtime.laneReceipt(bundle, "echo_avatar");
      expect(mage.artifactCount).toBeGreaterThan(1);
      expect(echo.artifactCount).toBeGreaterThan(1);
      const receipt = await runtime.render(bundle);
      expect(receipt).toMatchObject({
        projectId: "node-render-probe",
        renderer: "DIRECT_FFMPEG",
        durationMs: 40_000,
        totalFrames: 1_200,
        width: 1920,
        height: 1080,
        videoCodec: "h264",
        audioCodec: "aac",
        durable: true,
      });
      const bytes = await runtime.read(receipt.finalMp4Sha256);
      expect(bytes?.byteLength).toBe(receipt.byteSize);
      const file = path.join(root, "probe.mp4");
      const objectHex = receipt.finalMp4Sha256.slice("sha256:".length);
      const objectFile = path.join(root, "objects", objectHex.slice(0, 2), `${objectHex}.mp4`);
      const { stdout } = await execute("ffprobe", [
        "-v",
        "error",
        "-show_entries",
        "format=duration:stream=codec_name,width,height",
        "-of",
        "json",
        objectFile,
      ]);
      expect(file).not.toBe(objectFile);
      const probe = JSON.parse(stdout) as {
        streams: Array<{ codec_name: string; width?: number; height?: number }>;
        format: { duration: string };
      };
      expect(Number(probe.format.duration)).toBeCloseTo(40, 1);
      expect(probe.streams).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ codec_name: "h264", width: 1920, height: 1080 }),
          expect.objectContaining({ codec_name: "aac" }),
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 120_000);
});

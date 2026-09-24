// @vitest-environment node
import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";

import type { HostedR2BucketBinding } from "../hosted/configuration";
import { observeFalAvatarJob, submitFalAvatarJob } from "./fal-avatar-job";
import { FalFlashheadError, type FalFlashheadClient } from "./fal-flashhead-client";

const requestId = "764cabcf-b745-4b3e-ae38-1200304cf45b";
const objectKey =
  "tenant/account/workspace/workspace/project/project/revision/revision/lane/soulx-avatar/job/attempt/artifact/clip";

describe("Fal avatar job", () => {
  it("claims before one paid submission and preserves an ambiguous outcome", async () => {
    const order: string[] = [];
    const client = {
      submit: vi.fn(async () => {
        order.push("post");
        throw new Error("transport lost reply");
      }),
    } as unknown as FalFlashheadClient;
    await expect(
      submitFalAvatarJob({
        imageUrl: "https://private.example/portrait",
        audioUrl: "https://private.example/audio",
        client,
        claimSubmission: async () => {
          order.push("claim");
          return true;
        },
        persistRequestId: async () => {
          order.push("persist");
        },
        markSubmissionFailed: async () => {
          order.push("failed");
        },
        markSubmissionUnknown: async () => {
          order.push("unknown");
        },
      }),
    ).rejects.toThrow("transport lost reply");
    expect(order).toEqual(["claim", "post", "unknown"]);
    expect(client.submit).toHaveBeenCalledTimes(1);
  });

  it("marks a definite provider rejection FAILED without an unknown replay state", async () => {
    const order: string[] = [];
    const client = {
      submit: vi.fn(async () => {
        order.push("post");
        throw new FalFlashheadError("SUBMIT_REJECTED");
      }),
    } as unknown as FalFlashheadClient;
    await expect(
      submitFalAvatarJob({
        imageUrl: "https://private.example/portrait",
        audioUrl: "https://private.example/audio",
        client,
        claimSubmission: async () => {
          order.push("claim");
          return true;
        },
        persistRequestId: async () => {
          order.push("persist");
        },
        markSubmissionFailed: async () => {
          order.push("failed");
        },
        markSubmissionUnknown: async () => {
          order.push("unknown");
        },
      }),
    ).rejects.toMatchObject({ code: "SUBMIT_REJECTED" });
    expect(order).toEqual(["claim", "post", "failed"]);
  });

  it("downloads a real H.264 MP4 and verifies private storage readback", async () => {
    // Small square MP4 generated with ffmpeg; tests the actual MP4 metadata parser.
    const bytes = Uint8Array.from(
      await readFile(new URL("./fixtures/h264-square-sample.mp4", import.meta.url)),
    );
    let stored: Uint8Array | null = null;
    const bucket = {
      get: async () =>
        stored && {
          size: stored.byteLength,
          httpMetadata: { contentType: "video/mp4" },
          arrayBuffer: async () => stored!.buffer.slice(0) as ArrayBuffer,
        },
      put: async (_key: string, value: ArrayBuffer) => {
        stored = new Uint8Array(value);
      },
    } as unknown as HostedR2BucketBinding;
    const client = {
      status: vi.fn(async () => "COMPLETED"),
      result: vi.fn(async () => ({
        videoUrl: "https://v3b.fal.media/files/b/clip.mp4",
        durationSeconds: 0.16,
      })),
    } as unknown as FalFlashheadClient;
    const fetchPort = vi.fn(async () => new Response(bytes));
    const first = await observeFalAvatarJob({ requestId, objectKey, client, bucket, fetchPort });
    expect(first.state).toBe("SUCCEEDED");
    if (first.state !== "SUCCEEDED") return;
    expect(first.artifact).toMatchObject({
      objectKey,
      byteSize: bytes.byteLength,
      width: 512,
      height: 512,
      videoCodec: "h264",
      contentType: "video/mp4",
    });
    expect(first.artifact.durationSeconds).toBeCloseTo(0.16, 1);
    const second = await observeFalAvatarJob({ requestId, objectKey, client, bucket, fetchPort });
    expect(second).toEqual(first);
    expect(fetchPort).toHaveBeenCalledTimes(1);
    expect(fetchPort).toHaveBeenCalledWith("https://v3b.fal.media/files/b/clip.mp4", {
      redirect: "manual",
    });
  });
});

import { describe, expect, it, vi } from "vitest";

import { FalFlashheadClient, FalFlashheadError } from "./fal-flashhead-client";

const requestId = "764cabcf-b745-4b3e-ae38-1200304cf45b";
const endpoint = "https://queue.fal.run/fal-ai/flashhead/audio-to-video";
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

describe("FalFlashheadClient", () => {
  it("submits the exact audio model input and retrieves the matching video", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ request_id: requestId, status: "IN_QUEUE" }))
      .mockResolvedValueOnce(response({ request_id: requestId, status: "COMPLETED" }))
      .mockResolvedValueOnce(
        response({ video: { url: "https://v3b.fal.media/files/b/clip.mp4" }, duration: 5.4 }),
      );
    const client = new FalFlashheadClient("private-test-key", fetcher);
    expect(
      await client.submit({
        imageUrl: "https://private.example/avatar.jpg?signature=hidden",
        audioUrl: "https://private.example/span.wav?signature=hidden",
      }),
    ).toBe(requestId);
    expect(fetcher).toHaveBeenCalledWith(endpoint, {
      method: "POST",
      headers: { Authorization: "Key private-test-key", "Content-Type": "application/json" },
      body: JSON.stringify({
        image_url: "https://private.example/avatar.jpg?signature=hidden",
        audio_url: "https://private.example/span.wav?signature=hidden",
      }),
    });
    expect(await client.status(requestId)).toBe("COMPLETED");
    expect(await client.result(requestId)).toEqual({
      videoUrl: "https://v3b.fal.media/files/b/clip.mp4",
      durationSeconds: 5.4,
    });
  });

  it("keeps ambiguous submissions terminal for this attempt and hides signed inputs", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("contains signed URL"));
    const client = new FalFlashheadClient("private-test-key", fetcher);
    await expect(
      client.submit({
        imageUrl: "https://private.example/a?secret=s",
        audioUrl: "https://private.example/b?secret=s",
      }),
    ).rejects.toMatchObject({ code: "SUBMIT_UNKNOWN", message: "SUBMIT_UNKNOWN" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await client.cancel(requestId).catch((error: FalFlashheadError) => error.code)).toBe(
      "CANCEL_UNKNOWN",
    );
  });

  it("rejects untrusted result URLs", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ video: { url: "http://127.0.0.1/clip.mp4" }, duration: 5 }));
    await expect(new FalFlashheadClient("key", fetcher).result(requestId)).rejects.toMatchObject({
      code: "RESULT_INVALID",
    });
  });
});

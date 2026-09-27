// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { FalZImageClient } from "./fal-z-image";
import { observeKieImageJob, submitKieImageJob } from "./kie-image-job";

const id = "764cabcf-b745-4b3e-ae38-1200304cf45b";
const jobUrl = `https://queue.fal.run/fal-ai/z-image/requests/${id}`;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const submitted = () =>
  json({ request_id: id, status_url: `${jobUrl}/status`, response_url: jobUrl });

describe("Fal Z-Image Turbo", () => {
  it("submits one landscape PNG through Fal with a new random seed", async () => {
    const fetcher = vi.fn().mockResolvedValue(submitted());
    const client = new FalZImageClient("private-key", fetcher);
    await expect(
      client.create({ prompt: "Candid documentary photo.", aspectRatio: "16:9" }),
    ).resolves.toBe(id);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith("https://queue.fal.run/fal-ai/z-image/turbo", {
      method: "POST",
      headers: { Authorization: "Key private-key", "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "Candid documentary photo.",
        image_size: { width: 1280, height: 720 },
        num_images: 1,
        num_inference_steps: 8,
        enable_safety_checker: true,
        enable_prompt_expansion: false,
        output_format: "png",
      }),
    });
  });

  it("claims before submission and distinguishes a rejected request from an uncertain POST", async () => {
    for (const response of [json({}, 422), json({}, 503), json({})]) {
      const events: string[] = [];
      const client = new FalZImageClient(
        "private-key",
        vi.fn(async () => {
          events.push("POST");
          return response;
        }),
      );
      await expect(
        submitKieImageJob({
          manifest: { prompt: "Documentary photo.", aspectRatio: "16:9" },
          client,
          claimSubmission: async () => {
            events.push("claim");
            return true;
          },
          persistTaskId: async () => {
            events.push("persist");
          },
          markRequestRejected: async () => {
            events.push("rejected");
          },
          markSubmissionUnknown: async () => {
            events.push("unknown");
          },
        }),
      ).rejects.toThrow();
      expect(events).toEqual(["claim", "POST", response.status === 422 ? "rejected" : "unknown"]);
    }
  });

  it("polls only the saved request and rejects mismatched identities and unsafe output", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({ request_id: id, status: "IN_QUEUE" }))
      .mockResolvedValueOnce(json({ request_id: "another-request", status: "COMPLETED" }))
      .mockResolvedValueOnce(json({ request_id: id, status: "COMPLETED" }))
      .mockResolvedValueOnce(
        json({ images: [{ url: "https://v3.fal.media/image.png" }], has_nsfw_concepts: [true] }),
      );
    const client = new FalZImageClient("private-key", fetcher);
    await expect(client.get(id)).resolves.toMatchObject({ state: "generating", taskId: id });
    await expect(client.get(id)).rejects.toThrow("RESPONSE_INVALID");
    await expect(client.get(id)).rejects.toThrow("RESPONSE_INVALID");
    expect(fetcher.mock.calls.every(([, init]) => !init.method)).toBe(true);
  });

  it("retries read-only status failures and recognizes definite model failure", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(json({ request_id: id, status: "COMPLETED" }))
      .mockResolvedValueOnce(json({ detail: "model rejected input" }, 422));
    const client = new FalZImageClient("private-key", fetcher);
    await expect(client.get(id)).rejects.toThrow("STATUS_UNKNOWN");
    await expect(client.get(id)).resolves.toMatchObject({ state: "fail" });
  });

  it("accepts a Fal result only through exact private image readback", async () => {
    const png = Uint8Array.from(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
        "base64",
      ),
    );
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({ request_id: id, status: "COMPLETED" }))
      .mockResolvedValueOnce(
        json({ images: [{ url: "https://v3.fal.media/image.png" }], has_nsfw_concepts: [false] }),
      );
    const objectKey = `tenant/${id}/workspace/${id}/artifact/${id}`;
    let saved: ArrayBuffer | null = null;
    const bucket = {
      get: vi.fn(async () =>
        saved
          ? {
              size: saved.byteLength,
              httpMetadata: { contentType: "image/png" },
              arrayBuffer: async () => saved,
            }
          : null,
      ),
      put: vi.fn(async (_key: string, bytes: ArrayBuffer) => {
        saved = bytes;
      }),
    };
    const result = await observeKieImageJob({
      taskId: id,
      objectKey,
      client: new FalZImageClient("private-key", fetcher),
      bucket: bucket as never,
      fetchPort: vi.fn(async () => new Response(png)),
    });
    expect(result).toMatchObject({
      state: "SUCCEEDED",
      artifact: {
        objectKey,
        contentType: "image/png",
        width: 1,
        height: 1,
        byteSize: png.length,
      },
    });
    expect(bucket.put).toHaveBeenCalledOnce();
    expect(bucket.get).toHaveBeenCalledTimes(2);
  });
});

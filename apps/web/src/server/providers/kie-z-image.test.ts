import { describe, expect, it, vi } from "vitest";

import { KieZImageClient, KieZImageError } from "./kie-z-image";

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("Kie z-image task client", () => {
  it("submits the documented model and reads the exact task result", async () => {
    const fetchPort = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ code: 200, data: { taskId: "task_z-image_123" } }))
      .mockResolvedValueOnce(
        json({
          code: 200,
          data: {
            taskId: "task_z-image_123",
            model: "z-image",
            state: "success",
            resultJson: JSON.stringify({ resultUrls: ["https://example.com/image.png"] }),
          },
        }),
      );
    const client = new KieZImageClient("test-key", fetchPort);
    const taskId = await client.create({ prompt: "A mountain", aspectRatio: "16:9" });
    expect(taskId).toBe("task_z-image_123");
    expect(fetchPort).toHaveBeenNthCalledWith(
      1,
      "https://api.kie.ai/api/v1/jobs/createTask",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          model: "z-image",
          input: { prompt: "A mountain", aspect_ratio: "16:9", nsfw_checker: true },
        }),
      }),
    );
    expect(await client.get(taskId)).toEqual({
      state: "success",
      taskId,
      imageUrl: "https://example.com/image.png",
    });
    expect(fetchPort).toHaveBeenNthCalledWith(
      2,
      "https://api.kie.ai/api/v1/jobs/recordInfo?taskId=task_z-image_123",
      expect.any(Object),
    );
  });

  it("keeps a lost submission response uncertain so callers cannot replay automatically", async () => {
    const client = new KieZImageClient(
      "secret",
      vi.fn<typeof fetch>().mockRejectedValue(new Error("network failed")),
    );
    await expect(client.create({ prompt: "A mountain", aspectRatio: "1:1" })).rejects.toMatchObject(
      {
        code: "SUBMISSION_UNKNOWN",
      } satisfies Partial<KieZImageError>,
    );
  });

  it("rejects foreign task identity and invalid result URLs", async () => {
    const mismatch = new KieZImageClient(
      "secret",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          json({ data: { taskId: "other", model: "z-image", state: "generating" } }),
        ),
    );
    await expect(mismatch.get("task_1")).rejects.toMatchObject({ code: "RESPONSE_INVALID" });
    const invalidUrl = new KieZImageClient(
      "secret",
      vi.fn<typeof fetch>().mockResolvedValue(
        json({
          data: {
            taskId: "task_1",
            model: "z-image",
            state: "success",
            resultJson: JSON.stringify({ resultUrls: ["http://localhost/private"] }),
          },
        }),
      ),
    );
    await expect(invalidUrl.get("task_1")).rejects.toMatchObject({
      code: "RESPONSE_INVALID",
    });
  });
});

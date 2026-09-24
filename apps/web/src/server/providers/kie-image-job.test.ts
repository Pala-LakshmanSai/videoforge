import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

import type { HostedR2BucketBinding } from "../hosted/configuration";
import { KieZImageClient } from "./kie-z-image";
import { buildKieScenePrompt, observeKieImageJob, submitKieImageJob } from "./kie-image-job";

const TASK_ID = "task_z-image_123";
const OUTPUT_KEY =
  "tenant/11111111-1111-4111-8111-111111111111/project/p/artifact/22222222-2222-4222-8222-222222222222";
const PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
    "base64",
  ),
);
const JPEG = Uint8Array.from(
  Buffer.from(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABgj/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCCACVbP//Z",
    "base64",
  ),
);

function response(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
  });
}

function bucket(): HostedR2BucketBinding & { readonly put: ReturnType<typeof vi.fn> } {
  let stored: ArrayBuffer | null = null;
  let contentType: string | undefined;
  const put = vi.fn(async (_key: string, value: ArrayBuffer, options?: unknown) => {
    stored = value;
    contentType = (options as { httpMetadata?: { contentType?: string } })?.httpMetadata
      ?.contentType;
  });
  return {
    put,
    async get(key) {
      if (key !== OUTPUT_KEY || !stored) return null;
      const bytes = stored;
      return {
        size: bytes.byteLength,
        httpMetadata: { contentType },
        async arrayBuffer() {
          return bytes;
        },
      };
    },
    async head() {
      return null;
    },
    async list() {
      return { objects: [], truncated: false };
    },
    async delete() {},
  };
}

describe("Kie image job", () => {
  it("maps style negatives and mandatory exclusions into Kie's single prompt", () => {
    const prompt = buildKieScenePrompt({
      components: {
        literalContent: "A candid farmer holding a basket",
        continuityAndShotRole: "same farm, medium shot",
        cropGuidance: "center-safe framing",
        stylePositiveSuffix: "documentary photo",
        extraPromptKeywords: "natural light",
        styleNegativeSuffix: "CGI, glossy commercial polish",
      },
    } as never);
    expect(prompt).toContain("A candid farmer");
    expect(prompt).toContain("Avoid: CGI, glossy commercial polish");
    expect(prompt).toContain("No visible text");
    expect(() =>
      buildKieScenePrompt({
        components: {
          literalContent: "x".repeat(1000),
          continuityAndShotRole: "",
          cropGuidance: "",
          stylePositiveSuffix: "",
          extraPromptKeywords: null,
          styleNegativeSuffix: "",
        },
      } as never),
    ).toThrow("INPUT_INVALID");
  });

  it("fits the exact built-in documentary style without truncating scene content", () => {
    const profile = JSON.parse(
      readFileSync("../../project-context/evidence/default_image_style_v1.json", "utf8"),
    ) as {
      prompt_profile: {
        positive_suffix: string;
        negative_suffix: string;
        full_image_guidance: string;
      };
    };
    const prompt = buildKieScenePrompt({
      components: {
        literalContent: "A farmer walks through a field at dawn with freshly harvested vegetables",
        continuityAndShotRole: "same farm, required viewpoint: observational human medium",
        cropGuidance: profile.prompt_profile.full_image_guidance,
        stylePositiveSuffix: profile.prompt_profile.positive_suffix,
        extraPromptKeywords: null,
        styleNegativeSuffix: profile.prompt_profile.negative_suffix,
      },
    } as never);
    expect(prompt.length).toBeLessThanOrEqual(800);
    expect(prompt).toContain("A farmer walks through a field");
    expect(prompt).toContain("Avoid: illustration, CGI");
  });

  it("keeps production-length scene content intact within Kie's 800-character limit", () => {
    const literal = "subject: A person, action: depicting the narration-supported visible moment, environment: a room with a wooden desk next to a large window.";
    const prompt = buildKieScenePrompt({
      components: {
        literalContent: literal,
        continuityAndShotRole:
          "keep one consistent subject, setting and physical state across the video, required viewpoint: human medium. wide horizontal and center-safe.",
        cropGuidance: "wide horizontal and center-safe",
        stylePositiveSuffix:
          "Photorealistic high-fidelity digital landscape photography, wide field of view, deep focus, steady unobstructed perspective, direct high-noon sunlight or golden hour, high-contrast shadows",
        extraPromptKeywords: "natural light",
        styleNegativeSuffix:
          "blurry, soft focus, low resolution, artificial, over-saturated, human-centric, portrait, watermark, text",
      },
    } as never);
    expect(prompt.length).toBeLessThanOrEqual(800);
    expect(prompt).toContain(literal);
    expect(prompt).toContain("wide horizontal and center-safe");
    expect(prompt).toContain("Photorealistic high-fidelity");
    expect(prompt).toContain("natural light");
    expect(prompt).toContain("No visible text");
    expect(prompt).toContain("motion graphics or decorative transitions");
  });

  it("claims before submission and persists the provider task ID", async () => {
    const sequence: string[] = [];
    const client = new KieZImageClient("secret", async () => {
      sequence.push("POST");
      return response({ code: 200, data: { taskId: TASK_ID } });
    });
    const result = await submitKieImageJob({
      manifest: { prompt: "A mountain", aspectRatio: "16:9" },
      client,
      async claimSubmission() {
        sequence.push("CLAIM");
        return true;
      },
      async persistTaskId(id) {
        sequence.push(`PERSIST:${id}`);
      },
      async markRequestRejected() {
        throw new Error("unexpected rejection");
      },
      async markSubmissionUnknown() {
        throw new Error("unexpected ambiguity");
      },
    });
    expect(result).toEqual({ state: "SUBMITTED", taskId: TASK_ID });
    expect(sequence).toEqual(["CLAIM", "POST", `PERSIST:${TASK_ID}`]);
  });

  it("marks a lost paid response unknown without retry", async () => {
    const markUnknown = vi.fn(async () => {});
    const fetchPort = vi.fn<typeof fetch>().mockRejectedValue(new Error("lost response"));
    const client = new KieZImageClient("secret", fetchPort);
    await expect(
      submitKieImageJob({
        manifest: { prompt: "A mountain", aspectRatio: "16:9" },
        client,
        claimSubmission: async () => true,
        persistTaskId: async () => {},
        markRequestRejected: async () => {},
        markSubmissionUnknown: markUnknown,
      }),
    ).rejects.toMatchObject({ code: "SUBMISSION_UNKNOWN" });
    expect(fetchPort).toHaveBeenCalledOnce();
    expect(markUnknown).toHaveBeenCalledOnce();
  });

  it("stores verified PNG and returns existing R2 bytes after interrupted acceptance", async () => {
    const apiFetch = vi.fn<typeof fetch>().mockImplementation(async () =>
      response({
        data: {
          taskId: TASK_ID,
          model: "z-image",
          state: "success",
          resultJson: JSON.stringify({ resultUrls: ["https://cdn.example.com/image.png"] }),
        },
      }),
    );
    const imageFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(PNG.slice().buffer, { headers: { "Content-Type": "image/png" } }),
      );
    const storage = bucket();
    const input = {
      taskId: TASK_ID,
      objectKey: OUTPUT_KEY,
      client: new KieZImageClient("secret", apiFetch),
      bucket: storage,
      fetchPort: imageFetch,
    };
    const first = await observeKieImageJob(input);
    expect(first).toMatchObject({
      state: "SUCCEEDED",
      artifact: { objectKey: OUTPUT_KEY, byteSize: PNG.byteLength, width: 1, height: 1 },
    });
    expect(storage.put).toHaveBeenCalledOnce();
    expect(await observeKieImageJob(input)).toEqual(first);
    expect(imageFetch).toHaveBeenCalledOnce();
  });

  it("stores a validated JPEG with the observed MIME type and checksum", async () => {
    const client = new KieZImageClient("secret", async () =>
      response({
        data: {
          taskId: TASK_ID,
          model: "z-image",
          state: "success",
          resultJson: JSON.stringify({ resultUrls: ["https://cdn.example.com/image.jpg"] }),
        },
      }),
    );
    const storage = bucket();
    const input = {
      taskId: TASK_ID,
      objectKey: OUTPUT_KEY,
      client,
      bucket: storage,
      fetchPort: async () => new Response(JPEG.slice().buffer),
    };
    const first = await observeKieImageJob(input);
    expect(first).toMatchObject({
      state: "SUCCEEDED",
      artifact: {
        objectKey: OUTPUT_KEY,
        byteSize: JPEG.byteLength,
        width: 1,
        height: 1,
        contentType: "image/jpeg",
      },
    });
    expect(storage.put).toHaveBeenCalledOnce();
    expect(await observeKieImageJob(input)).toEqual(first);
  });

  it("rejects a truncated JPEG without writing private storage", async () => {
    const client = new KieZImageClient("secret", async () =>
      response({
        data: {
          taskId: TASK_ID,
          model: "z-image",
          state: "success",
          resultJson: JSON.stringify({ resultUrls: ["https://cdn.example.com/image.jpg"] }),
        },
      }),
    );
    const storage = bucket();
    await expect(
      observeKieImageJob({
        taskId: TASK_ID,
        objectKey: OUTPUT_KEY,
        client,
        bucket: storage,
        fetchPort: async () => new Response(new Uint8Array([0xff, 0xd8, 0xff]).buffer),
      }),
    ).rejects.toMatchObject({ code: "RESULT_MEDIA_INVALID" });
    expect(storage.put).not.toHaveBeenCalled();
  });

  it("rejects a PNG with corrupted image data checksum", async () => {
    const client = new KieZImageClient("secret", async () =>
      response({
        data: {
          taskId: TASK_ID,
          model: "z-image",
          state: "success",
          resultJson: JSON.stringify({ resultUrls: ["https://cdn.example.com/image.png"] }),
        },
      }),
    );
    const corrupt = PNG.slice();
    corrupt[45] = (corrupt[45] ?? 0) ^ 1;
    const storage = bucket();
    await expect(
      observeKieImageJob({
        taskId: TASK_ID,
        objectKey: OUTPUT_KEY,
        client,
        bucket: storage,
        fetchPort: async () => new Response(corrupt.buffer),
      }),
    ).rejects.toMatchObject({ code: "RESULT_MEDIA_INVALID" });
    expect(storage.put).not.toHaveBeenCalled();
  });
});

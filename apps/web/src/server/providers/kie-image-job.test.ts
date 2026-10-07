import type { CompiledImagePrompt } from "@videoforge/pipeline";
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { compileImagePrompt, NATURAL_DOCUMENTARY_STYLE_PROFILE_HASH } from "@videoforge/pipeline";

import type { HostedR2BucketBinding } from "../hosted/configuration";
import { KieZImageClient } from "./kie-z-image";
import {
  buildKieScenePrompt,
  KIE_HAND_ANATOMY_GUIDANCE,
  observeKieImageJob,
  submitKieImageJob,
} from "./kie-image-job";

import { kieScenePromptLiteralCharacterLimit } from "./kie-image-prompt";

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
  it("bounds a stalled result body and retries only the persisted task", async () => {
    const controller = new AbortController();
    const deadline = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    const stored = bucket();
    const client = {
      get: vi.fn(async () => ({
        state: "success" as const,
        taskId: TASK_ID,
        imageUrl: "https://media.example/image",
      })),
    };
    const stalledFetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.signal).toBe(controller.signal);
      return new Response(
        new ReadableStream({
          start(stream) {
            init!.signal!.addEventListener("abort", () => stream.error(controller.signal.reason), {
              once: true,
            });
            queueMicrotask(() => controller.abort(new DOMException("Timed out", "TimeoutError")));
          },
        }),
      );
    });
    try {
      await expect(
        observeKieImageJob({
          taskId: TASK_ID,
          objectKey: OUTPUT_KEY,
          client,
          bucket: stored,
          fetchPort: stalledFetch,
        }),
      ).rejects.toMatchObject({ code: "RESULT_DOWNLOAD_FAILED" });
      expect(deadline).toHaveBeenCalledWith(30_000);
      expect(stored.put).not.toHaveBeenCalled();
      deadline.mockRestore();
      await expect(
        observeKieImageJob({
          taskId: TASK_ID,
          objectKey: OUTPUT_KEY,
          client,
          bucket: stored,
          fetchPort: async () => new Response(PNG),
        }),
      ).resolves.toMatchObject({ state: "SUCCEEDED" });
      expect(client.get.mock.calls).toEqual([[TASK_ID], [TASK_ID]]);
      expect(stored.put).toHaveBeenCalledTimes(1);
    } finally {
      deadline.mockRestore();
    }
  });
  it("retains essential face and hand framing in both layouts within the provider limit", () => {
    for (const [subject, action] of [
      [
        "A vineyard owner in a tight chest-up view with a large unobstructed face",
        "looking over the vineyard",
      ],
      ["Weathered hands in close unobstructed view", "turning a valve with a simple grip"],
    ]) {
      for (const crop of [
        "wide horizontal center-safe",
        "narrow vertical right panel center-safe",
      ]) {
        const literal = `subject: ${subject}, action: ${action}, environment: a vineyard irrigation pipe`;
        const prompt = buildKieScenePrompt({
          components: {
            literalContent: literal,
            continuityAndShotRole: "same subject/setting/state, viewpoint: human medium",
            cropGuidance: crop,
            stylePositiveSuffix: "documentary photo with natural light",
            extraPromptKeywords: null,
            styleNegativeSuffix: "CGI, malformed anatomy",
          },
        } as never);
        expect(prompt.length).toBeLessThanOrEqual(800);
        expect(prompt).toContain(literal);
        expect(prompt).toContain(crop);
        expect(prompt).toContain("No visible text/pseudo-text");
      }
    }
  });

  it("keeps v4 required roles and enabled keywords at 800 while preserving legacy assembly", () => {
    const components = {
      literalContent: "x",
      cropGuidance: "continuous photo",
      stylePositiveSuffix: "documentary",
      continuityAndShotRole: "viewpoint: hands action",
      extraPromptKeywords: "natural light",
      styleNegativeSuffix: "",
    };
    const fixed =
      buildKieScenePrompt({ promptCompilerVersion: "prompt-compiler-v4", components } as never)
        .length - 1;
    const full = { ...components, literalContent: "x".repeat(800 - fixed) };
    const prompt = buildKieScenePrompt({
      promptCompilerVersion: "prompt-compiler-v4",
      components: full,
    } as never);
    expect(prompt).toHaveLength(800);
    expect(prompt).toContain("viewpoint: hands action");
    expect(prompt).toContain("natural light");
    expect(() =>
      buildKieScenePrompt({
        promptCompilerVersion: "prompt-compiler-v4",
        components: { ...full, literalContent: `${full.literalContent}x` },
      } as never),
    ).toThrow("INPUT_INVALID");
    expect(
      buildKieScenePrompt({
        promptCompilerVersion: "prompt-compiler-v3",
        components: full,
      } as never),
    ).not.toContain("viewpoint: hands action");
  });

  it("excludes optional filler from fresh literal budgets without changing existing Kie bytes", () => {
    for (const version of ["prompt-compiler-v3", "prompt-compiler-v4", "prompt-compiler-v5"]) {
      for (const role of ["reaction result", "hands action"]) {
        const compiled = {
          promptCompilerVersion: version,
          components: {
            literalContent: "subject: x, action: x, environment: x",
            cropGuidance: "continuous photo",
            stylePositiveSuffix: "documentary",
            continuityAndShotRole: `viewpoint: ${role}`,
            extraPromptKeywords: "natural light",
            styleNegativeSuffix: "illustration, CGI",
          },
        } as CompiledImagePrompt;
        const unchanged = buildKieScenePrompt(compiled, { handAnatomy: true });
        expect(unchanged).toContain("Avoid: illustration, CGI");
        const oldLimit = kieScenePromptLiteralCharacterLimit(compiled);
        const limit = kieScenePromptLiteralCharacterLimit(compiled, { requiredOnly: true });
        expect(limit).toBeGreaterThan(oldLimit);
        const full = {
          ...compiled,
          components: {
            ...compiled.components,
            literalContent: `subject: ${"x".repeat(limit - 2)}, action: x, environment: x`,
          },
        };
        const wire = buildKieScenePrompt(full, { handAnatomy: true });
        expect(wire).toHaveLength(800);
        expect(wire).toContain("natural light");
        expect(wire).toContain("No visible text/pseudo-text");
        if (role === "hands action") expect(wire).toContain(KIE_HAND_ANATOMY_GUIDANCE);
        expect(() =>
          buildKieScenePrompt(
            {
              ...full,
              components: {
                ...full.components,
                literalContent: `${full.components.literalContent}x`,
              },
            },
            { handAnatomy: true, requiredOnly: true },
          ),
        ).toThrow("INPUT_INVALID");
        expect(buildKieScenePrompt(compiled, { handAnatomy: true })).toBe(unchanged);
      }
    }
  });

  it("maps fresh v5 object-only HUMAN_MEDIUM scenes without inventing a visible face, retaining legacy v4 bytes", () => {
    const input = {
      styleProfileHash: NATURAL_DOCUMENTARY_STYLE_PROFILE_HASH,
      writerOutput: {
        scene_id: "bottle",
        literal_subject: "An unmarked bottle",
        action: "Standing on a shelf",
        environment: "A grocery store aisle",
        in_image_shot_role: "HUMAN_MEDIUM" as const,
        lighting_context: "daylight",
        continuity_tags: [],
        prompt_core: "An unmarked bottle stands on a grocery store shelf.",
      },
      expectedScene: {
        sceneId: "bottle",
        phrase: "The bottle stands on a shelf.",
        sentenceContext: "The bottle stands on a shelf.",
        priorContext: null,
        nextContext: null,
        inImageShotRole: "HUMAN_MEDIUM" as const,
        layout: "IMAGE_FULL" as const,
      },
      style: {
        positiveSuffix: "documentary photography",
        negativeSuffix: "malformed hands",
        fullImageGuidance: "16:9 center-safe horizontal photograph",
        splitImageGuidance: "8:9 center-safe right panel",
      },
      extraPromptKeywords: null,
      applyExtraPromptKeywords: false,
    };
    const legacy = compileImagePrompt(input);
    const fresh = compileImagePrompt({ ...input, compilerPolicy: "local-evidence-v1" });
    expect(legacy.promptCompilerVersion).toBe("prompt-compiler-v4");
    expect(fresh.promptCompilerVersion).toBe("prompt-compiler-v5");
    expect(buildKieScenePrompt(legacy)).toContain("Complete head and face visible");
    expect(fresh.positivePrompt).not.toMatch(/\b(?:head|face|chest-up)\b/iu);
    expect(legacy.positivePrompt).toMatch(/complete head and face visible/iu);
    const freshWire = buildKieScenePrompt(fresh);
    expect(freshWire).toContain("An unmarked bottle");
    expect(freshWire).toMatch(/medium view.*stated subject/iu);
    expect(freshWire).not.toMatch(/\b(?:head|face|chest-up)\b/iu);
    expect(buildKieScenePrompt(compileImagePrompt(input))).toBe(buildKieScenePrompt(legacy));
  });

  it("retains mandatory hand ownership when optional negatives cannot fit, without changing stored v3/v4 prompts", () => {
    for (const styleProfileHash of [NATURAL_DOCUMENTARY_STYLE_PROFILE_HASH, undefined]) {
      const compiled = compileImagePrompt({
        styleProfileHash,
        writerOutput: {
          scene_id: "hands_scene",
          literal_subject: "Two mechanics' hands and wrists",
          action: "turn a nut with a wrench",
          environment: "an engine workshop",
          in_image_shot_role: "HANDS_ACTION",
          lighting_context: "daylight",
          continuity_tags: [],
          prompt_core: "Mechanics turn a nut with a wrench.",
        },
        expectedScene: {
          sceneId: "hands_scene",
          phrase: "Mechanics turn a nut with a wrench.",
          sentenceContext: "Mechanics turn a nut with a wrench.",
          priorContext: null,
          nextContext: null,
          inImageShotRole: "HANDS_ACTION",
          layout: "IMAGE_FULL",
        },
        style: {
          positiveSuffix: "documentary photography",
          negativeSuffix: "malformed hands",
          fullImageGuidance: "16:9 center-safe horizontal photograph",
          splitImageGuidance: "8:9 center-safe right panel",
        },
        extraPromptKeywords: null,
        applyExtraPromptKeywords: false,
      });
      const components = {
        ...compiled.components,
        stylePositiveSuffix: "documentary photo ".repeat(17).trim(),
      };
      const wire = buildKieScenePrompt({ ...compiled, components }, { handAnatomy: true });
      expect(wire.length).toBeGreaterThan(640);
      expect(wire.length).toBeLessThanOrEqual(800);
      expect(wire).toContain(KIE_HAND_ANATOMY_GUIDANCE);
      expect(wire).toContain("Two mechanics' hands");
      expect(wire).toContain("turn a nut with a wrench");
      expect(wire).not.toContain("Avoid: malformed hands");
      expect(buildKieScenePrompt(compiled)).not.toContain(KIE_HAND_ANATOMY_GUIDANCE);
    }
  });

  it("keeps full/split hand constraints at exact 800 bounds with unchanged components and no landscape people", () => {
    for (const cropGuidance of ["One horizontal photograph", "One continuous narrow photograph"]) {
      const components = {
        literalContent: "x",
        cropGuidance,
        stylePositiveSuffix: "documentary",
        continuityAndShotRole: "same subject/setting/state, viewpoint: hands action",
        extraPromptKeywords: "natural light",
        styleNegativeSuffix: "",
      };
      expect(KIE_HAND_ANATOMY_GUIDANCE.length).toBe(components.continuityAndShotRole.length);
      const compiled = { promptCompilerVersion: "prompt-compiler-v4", components };
      const fixed = buildKieScenePrompt(compiled as never, { handAnatomy: true }).length - 1;
      const full = {
        ...compiled,
        components: { ...components, literalContent: "x".repeat(800 - fixed) },
      };
      const snapshot = JSON.stringify(full);
      const prompt = buildKieScenePrompt(full as never, { handAnatomy: true });
      expect(prompt).toHaveLength(800);
      expect(prompt).toContain(KIE_HAND_ANATOMY_GUIDANCE);
      expect(prompt).toContain("natural light");
      expect(JSON.stringify(full)).toBe(snapshot);
      expect(() =>
        buildKieScenePrompt(
          {
            ...full,
            components: {
              ...full.components,
              literalContent: `${full.components.literalContent}x`,
            },
          } as never,
          { handAnatomy: true },
        ),
      ).toThrow("INPUT_INVALID");
      const landscape = {
        ...full,
        components: {
          ...components,
          literalContent: "Coastal cliffs overlook the sea",
          continuityAndShotRole: "viewpoint: environmental wide",
        },
      };
      expect(buildKieScenePrompt(landscape as never, { handAnatomy: true })).toBe(
        buildKieScenePrompt(landscape as never),
      );
    }
  });

  it("maps style negatives and mandatory exclusions into Kie's single prompt", () => {
    const prompt = buildKieScenePrompt({
      components: {
        literalContent: "A candid farmer holding a basket",
        continuityAndShotRole: "same farm, medium shot",
        cropGuidance: "center-safe framing",
        stylePositiveSuffix: "documentary photo",
        extraPromptKeywords: "natural light",
        styleNegativeSuffix: "CGI, watermark, text, glossy commercial polish",
      },
    } as never);
    expect(prompt).toContain("A candid farmer");
    expect(prompt).toContain("Avoid: CGI, glossy commercial polish");
    expect(prompt).not.toContain("watermark, text");
    expect(prompt).toContain("No visible text/pseudo-text");
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
    expect(prompt.length).toBeLessThanOrEqual(640);
    expect(prompt).toContain("A farmer walks through a field");
    expect(prompt).toContain("Avoid: illustration, CGI");
  });

  it("keeps production-length scene content intact within Kie's medium target", () => {
    const literal =
      "subject: A person, action: depicting the narration-supported visible moment, environment: a room with a wooden desk next to a large window.";
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
    expect(prompt.length).toBeLessThanOrEqual(640);
    expect(prompt).toContain(literal);
    expect(prompt).toContain("wide horizontal and center-safe");
    expect(prompt).toContain("Photorealistic high-fidelity");
    expect(prompt).toContain("natural light");
    expect(prompt).toContain("Same subject, setting, state; viewpoint: human medium");
    expect(prompt).toContain("No visible text/pseudo-text");
    expect(prompt).toContain("motion graphics");
    expect(prompt).toContain("unmarked surfaces");
    expect(prompt).toContain("Avoid: blurry, soft focus, low resolution");
    expect(prompt).not.toContain("watermark, text");
  });

  it("keeps a NAPAA landscape prompt medium while preserving scene, crop, and photographic cues", () => {
    const literal =
      "subject: A winemaker in a simple linen shirt, action: looking out over straight rows of grapevines, environment: A vineyard entrance with a rustic stone gate and distant mountains";
    const crop =
      "wide horizontal, center-safe 80%; keep evidence clear during slow zoom; retain environmental context";
    const style =
      "photorealistic digital landscape photo; wide deep-focus unobstructed or aerial view; high-noon or golden-hour sun, strong shadows";
    const prompt = buildKieScenePrompt({
      components: {
        literalContent: literal,
        continuityAndShotRole: "same subject/setting/state, viewpoint: environmental wide",
        cropGuidance: crop,
        stylePositiveSuffix: style,
        extraPromptKeywords: "documentary stock photography",
        styleNegativeSuffix:
          "blurry, soft focus, low resolution, artificial, over-saturated, human-centric, portrait, watermark, text",
      },
    } as never);
    expect(prompt.length).toBeLessThanOrEqual(640);
    expect(prompt).toContain(literal);
    expect(prompt).toContain(crop);
    expect(prompt).toContain(style);
    expect(prompt).toContain("documentary stock photography");
    expect(prompt).toContain("photorealistic");
    expect(prompt).toContain("No visible text/pseudo-text");
    expect(prompt).toContain("overlays");
    expect(prompt).toContain("motion graphics");
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
    const apiFetch = vi.fn<typeof fetch>().mockImplementation(async (input) =>
      String(input).endsWith("/common/download-url")
        ? response({ code: 200, data: "https://storage.r2.example.com/image.png?signature=test" })
        : response({
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
    expect(
      apiFetch.mock.calls.filter(([url]) => String(url).endsWith("/common/download-url")),
    ).toHaveLength(1);
    expect(apiFetch.mock.calls.some(([url]) => String(url).includes("createTask"))).toBe(false);
    expect(imageFetch).toHaveBeenCalledWith(
      "https://storage.r2.example.com/image.png?signature=test",
      {
        redirect: "manual",
        signal: expect.any(AbortSignal),
      },
    );
  });

  it("stores a validated JPEG with the observed MIME type and checksum", async () => {
    const client = new KieZImageClient("secret", async (input) =>
      String(input).endsWith("/common/download-url")
        ? response({ code: 200, data: "https://cdn.example.com/image.jpg" })
        : response({
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
    const client = new KieZImageClient("secret", async (input) =>
      String(input).endsWith("/common/download-url")
        ? response({ code: 200, data: "https://cdn.example.com/image.jpg" })
        : response({
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
    const client = new KieZImageClient("secret", async (input) =>
      String(input).endsWith("/common/download-url")
        ? response({ code: 200, data: "https://cdn.example.com/image.png" })
        : response({
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

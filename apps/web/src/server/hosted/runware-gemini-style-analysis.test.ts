import { describe, expect, it, vi } from "vitest";
import { buildStyleAnalyzerRequest, DeterministicFixtureStyleAnalyzer } from "@videoforge/pipeline";

import {
  analyzeStyleWithRunwareGemini,
  inspectNormalizedWebp,
  runwareGeminiStyleActualCostMicroUsd,
  RUNWARE_GEMINI_STYLE_MODEL,
  RunwareGeminiStyleAnalysisError,
} from "./runware-gemini-style-analysis";

function webp(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30);
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  bytes.set([22, 0, 0, 0], 4);
  bytes.set(new TextEncoder().encode("WEBP"), 8);
  bytes.set(new TextEncoder().encode("VP8 "), 12);
  bytes.set([10, 0, 0, 0], 16);
  bytes.set([0, 0, 0, 0x9d, 0x01, 0x2a], 20);
  bytes.set([width & 0xff, (width >> 8) & 0x3f, height & 0xff, (height >> 8) & 0x3f], 26);
  return bytes;
}

function webpWithIccProfile(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(60);
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  bytes.set([52, 0, 0, 0], 4);
  bytes.set(new TextEncoder().encode("WEBP"), 8);
  bytes.set(new TextEncoder().encode("VP8X"), 12);
  bytes.set([10, 0, 0, 0], 16);
  bytes.set([0x20, 0, 0, 0], 20);
  bytes.set(
    [
      (width - 1) & 0xff,
      ((width - 1) >> 8) & 0xff,
      ((width - 1) >> 16) & 0xff,
      (height - 1) & 0xff,
      ((height - 1) >> 8) & 0xff,
      ((height - 1) >> 16) & 0xff,
    ],
    24,
  );
  bytes.set(new TextEncoder().encode("ICCP"), 30);
  bytes.set([4, 0, 0, 0], 34);
  bytes.set([1, 2, 3, 4], 38);
  bytes.set(new TextEncoder().encode("VP8 "), 42);
  bytes.set([10, 0, 0, 0], 46);
  bytes.set([0, 0, 0, 0x9d, 0x01, 0x2a], 50);
  bytes.set([width & 0xff, (width >> 8) & 0x3f, height & 0xff, (height >> 8) & 0x3f], 56);
  return bytes;
}

const images = Array.from({ length: 3 }, (_, index) => ({
  alias: `ref_${String(index + 1).padStart(2, "0")}`,
  mimeType: "image/webp" as const,
  sha256: `sha256:${String(index + 1).repeat(64)}` as const,
  width: 1280,
  height: 720,
  bytes: webp(1280, 720),
}));

async function output() {
  return new DeterministicFixtureStyleAnalyzer().analyze(
    buildStyleAnalyzerRequest(
      images.map((image) => ({
        alias: image.alias,
        derivativeSha256: image.sha256,
        mimeType: image.mimeType,
        width: image.width,
        height: image.height,
        bytes: image.bytes.byteLength,
      })),
    ),
  );
}

describe("Runware Gemini hosted style analysis", () => {
  it("accepts a browser-normalized WebP carrying an ICC color profile", () => {
    expect(inspectNormalizedWebp(webpWithIccProfile(1376, 768))).toEqual({
      width: 1376,
      height: 768,
    });
  });

  it("sends normalized derivatives to the pinned vision model and validates the profile", async () => {
    const taskUUID = "11111111-1111-4111-8111-111111111111";
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ authorization: "Bearer test-secret" });
      expect(_url).toBe("https://api.runware.ai/v1");
      const body = JSON.parse(String(init?.body)) as Array<Record<string, unknown>>;
      expect(body).toHaveLength(1);
      expect(body[0]?.model).toBe(RUNWARE_GEMINI_STYLE_MODEL);
      expect(body[0]?.outputFormat).toBe("JSON");
      expect(body[0]?.includeCost).toBe(true);
      expect(body[0]?.includeUsage).toBe(true);
      expect(body[0]?.jsonSchema).toMatchObject({ strict: true });
      expect(body[0]).not.toHaveProperty("providerSettings");
      expect(body[0]).not.toHaveProperty("tenant_id");
      expect(body[0]?.inputs).toMatchObject({
        images: expect.arrayContaining([expect.stringMatching(/^data:image\/webp;base64,/u)]),
      });
      expect(String(init?.body)).not.toContain("test-secret");
      expect(String(init?.body).match(/data:image\/webp;base64,/gu)).toHaveLength(3);
      return Response.json({
        data: [
          {
            taskUUID,
            taskType: "textInference",
            model: RUNWARE_GEMINI_STYLE_MODEL,
            text: JSON.stringify(await output()),
            usage: { promptTokens: 100, completionTokens: 200, totalTokens: 300 },
            cost: 0.000308,
            finishReason: "stop",
          },
        ],
      });
    });

    const result = await analyzeStyleWithRunwareGemini({
      apiKey: "test-secret",
      baseUrl: "https://api.runware.ai/v1",
      images,
      taskUUID,
      fetcher,
    });

    expect(result.model).toBe(RUNWARE_GEMINI_STYLE_MODEL);
    expect(result.trusted.profile.analysis.analysis_kind).toBe("VISION_ANALYSIS");
    expect(result.usage.totalTokens).toBe(300);
    expect(result.costUsd).toBe(0.000308);
    expect(runwareGeminiStyleActualCostMicroUsd(result.costUsd)).toBe(308);
    expect(result.responseSha256).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("fails closed on a malformed successful response", async () => {
    await expect(
      analyzeStyleWithRunwareGemini({
        apiKey: "test-secret",
        baseUrl: "https://api.runware.ai/v1",
        images,
        fetcher: async () => Response.json({ choices: [] }),
      }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" } satisfies Partial<RunwareGeminiStyleAnalysisError>);
  });

  it("rejects reference sets above the bounded payload before fetch", async () => {
    const fetcher = vi.fn();
    await expect(
      analyzeStyleWithRunwareGemini({
        apiKey: "test-secret",
        baseUrl: "https://api.runware.ai/v1",
        images: images.map((image) => ({
          ...image,
          bytes: new Uint8Array(11 * 1024 * 1024),
        })),
        fetcher,
      }),
    ).rejects.toMatchObject({ code: "INPUT_REJECTED" } satisfies Partial<RunwareGeminiStyleAnalysisError>);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ["network failure", async () => Promise.reject(new Error("socket closed"))],
    ["rate limit", async () => new Response(null, { status: 429 })],
    ["provider failure", async () => new Response(null, { status: 503 })],
  ])("marks %s as ambiguous so callers cannot redispatch", async (_label, fetcher) => {
    await expect(
      analyzeStyleWithRunwareGemini({
        apiKey: "test-secret",
        baseUrl: "https://api.runware.ai/v1",
        images,
        fetcher,
      }),
    ).rejects.toMatchObject({ code: "AMBIGUOUS" } satisfies Partial<RunwareGeminiStyleAnalysisError>);
  });

  it("rejects a normalized container carrying metadata before provider dispatch", async () => {
    const unsafe = webp(1280, 720);
    unsafe.set(new TextEncoder().encode("EXIF"), 12);
    const fetcher = vi.fn();
    await expect(
      analyzeStyleWithRunwareGemini({
        apiKey: "test-secret",
        baseUrl: "https://api.runware.ai/v1",
        images: [{ ...images[0]!, bytes: unsafe }, images[1]!, images[2]!],
        fetcher,
      }),
    ).rejects.toMatchObject({ code: "INPUT_REJECTED" } satisfies Partial<RunwareGeminiStyleAnalysisError>);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("distinguishes a provider request rejection from invalid image input", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(
      analyzeStyleWithRunwareGemini({
        apiKey: "test-secret",
        baseUrl: "https://api.runware.ai/v1",
        images,
        fetcher: async () =>
          Response.json(
            {
              errors: [{
                code: "invalid_value",
                parameter: "generation_config.provider_settings",
                type: "invalid_request_error",
                message: "must never be logged",
              }],
            },
            { status: 400 },
          ),
      }),
    ).rejects.toMatchObject({
      code: "PROVIDER_REJECTED",
    } satisfies Partial<RunwareGeminiStyleAnalysisError>);
    expect(info).toHaveBeenCalledWith(
      "hosted_style_analysis_dispatch",
      expect.objectContaining({ reference_count: 3, normalized_input_bytes: 90 }),
    );
    expect(warning).toHaveBeenCalledWith("hosted_style_analysis_provider_rejected", {
      model: RUNWARE_GEMINI_STYLE_MODEL,
      status: 400,
      provider_code: "invalid_value",
      provider_parameter: "generation_config.provider_settings",
      provider_type: "invalid_request_error",
    });
    expect(JSON.stringify(warning.mock.calls)).not.toContain("must never be logged");
  });
});

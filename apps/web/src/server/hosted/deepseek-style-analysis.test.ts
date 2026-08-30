import { describe, expect, it, vi } from "vitest";
import { buildStyleAnalyzerRequest, DeterministicFixtureStyleAnalyzer } from "@videoforge/pipeline";

import {
  analyzeStyleWithDeepSeek,
  deepSeekStylePeakCostMicroUsd,
  DEEPSEEK_STYLE_MODEL,
  DeepSeekStyleAnalysisError,
} from "./deepseek-style-analysis";

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

describe("direct DeepSeek hosted style analysis", () => {
  it("sends normalized derivatives to the pinned vision model and validates the profile", async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ authorization: "Bearer test-secret" });
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.model).toBe(DEEPSEEK_STYLE_MODEL);
      expect(body).not.toHaveProperty("tenant_id");
      expect(String(init?.body)).not.toContain("test-secret");
      expect(String(init?.body).match(/data:image\/webp;base64,/gu)).toHaveLength(3);
      return Response.json({
        id: "provider-request-1",
        model: DEEPSEEK_STYLE_MODEL,
        choices: [{ message: { content: JSON.stringify(await output()) } }],
        usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
      });
    });

    const result = await analyzeStyleWithDeepSeek({
      apiKey: "test-secret",
      baseUrl: "https://api.deepseek.com",
      images,
      fetcher,
    });

    expect(result.model).toBe(DEEPSEEK_STYLE_MODEL);
    expect(result.trusted.profile.analysis.analysis_kind).toBe("VISION_ANALYSIS");
    expect(result.usage.totalTokens).toBe(300);
    expect(deepSeekStylePeakCostMicroUsd(result.usage)).toBe(308);
    expect(result.responseSha256).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("fails closed on a malformed successful response", async () => {
    await expect(
      analyzeStyleWithDeepSeek({
        apiKey: "test-secret",
        baseUrl: "https://api.deepseek.com",
        images,
        fetcher: async () => Response.json({ choices: [] }),
      }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" } satisfies Partial<DeepSeekStyleAnalysisError>);
  });

  it("rejects reference sets above the bounded payload before fetch", async () => {
    const fetcher = vi.fn();
    await expect(
      analyzeStyleWithDeepSeek({
        apiKey: "test-secret",
        baseUrl: "https://api.deepseek.com",
        images: images.map((image) => ({
          ...image,
          bytes: new Uint8Array(11 * 1024 * 1024),
        })),
        fetcher,
      }),
    ).rejects.toMatchObject({ code: "REJECTED" } satisfies Partial<DeepSeekStyleAnalysisError>);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ["network failure", async () => Promise.reject(new Error("socket closed"))],
    ["rate limit", async () => new Response(null, { status: 429 })],
    ["provider failure", async () => new Response(null, { status: 503 })],
  ])("marks %s as ambiguous so callers cannot redispatch", async (_label, fetcher) => {
    await expect(
      analyzeStyleWithDeepSeek({
        apiKey: "test-secret",
        baseUrl: "https://api.deepseek.com",
        images,
        fetcher,
      }),
    ).rejects.toMatchObject({ code: "AMBIGUOUS" } satisfies Partial<DeepSeekStyleAnalysisError>);
  });

  it("rejects a normalized container carrying metadata before provider dispatch", async () => {
    const unsafe = webp(1280, 720);
    unsafe.set(new TextEncoder().encode("EXIF"), 12);
    const fetcher = vi.fn();
    await expect(
      analyzeStyleWithDeepSeek({
        apiKey: "test-secret",
        baseUrl: "https://api.deepseek.com",
        images: [{ ...images[0]!, bytes: unsafe }, images[1]!, images[2]!],
        fetcher,
      }),
    ).rejects.toMatchObject({ code: "REJECTED" } satisfies Partial<DeepSeekStyleAnalysisError>);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { j1Fetch, parseJ1Voices, J1Error, publicVoiceoverJob } from "./j1tts";
afterEach(() => vi.unstubAllGlobals());
describe("J1TTS provider boundary", () => {
  it("normalizes real list envelopes and drops invalid IDs", () => {
    expect(
      parseJ1Voices({
        voices: [
          {
            voice_id: "a",
            name: "Alice",
            tags: "Calm",
            languages: "us",
            preview_url: "/sample.mp3",
          },
          { voice_id: "../secret", name: "Bad" },
        ],
      }),
    ).toEqual([
      { voice_id: "a", name: "Alice", tags: "Calm", languages: "us", preview_url: "/sample.mp3" },
    ]);
  });
  it("keeps credentials only at fixed provider origin and refuses redirects", async () => {
    const fetcher = vi.fn(async () => Response.json({ id: "job" }));
    await j1Fetch(
      "private-test-key",
      "/v1/tts",
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
      fetcher,
    );
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]).toEqual([
      "https://api.j1tts.com/v1/tts",
      expect.objectContaining({
        redirect: "manual",
        headers: expect.objectContaining({ Authorization: "Bearer private-test-key" }),
      }),
    ]);
  });
  it("rejects a redirect without forwarding credentials or repeating submission", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(null, { status: 302, headers: { location: "https://untrusted.example/" } }),
    );
    await expect(
      j1Fetch("private-key", "/v1/tts", { method: "POST" }, fetcher),
    ).rejects.toMatchObject({ code: "J1TTS_REDIRECT_REJECTED", ambiguous: true });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it.each([429, 401, 403, 400])(
    "classifies an explicit %s rejection without replay",
    async (status) => {
      const fetcher = vi.fn(async () => new Response(null, { status }));
      try {
        await j1Fetch("key", "/v1/tts", { method: "POST" }, fetcher);
        throw new Error("expected failure");
      } catch (e) {
        expect(e).toBeInstanceOf(J1Error);
        expect((e as J1Error).ambiguous).toBe(false);
      }
      expect(fetcher).toHaveBeenCalledOnce();
    },
  );
  it.each([500, 503])("treats %s submissions as uncertain", async (status) => {
    await expect(
      j1Fetch("key", "/v1/tts", { method: "POST" }, async () => new Response(null, { status })),
    ).rejects.toMatchObject({ ambiguous: true });
  });
  it("never retries an ambiguous paid submission", async () => {
    const fetcher = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(j1Fetch("key", "/v1/tts", { method: "POST" }, fetcher)).rejects.toMatchObject({
      code: "J1TTS_NETWORK_UNCERTAIN",
      ambiguous: true,
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("never publishes provider job identity or credentials", () => {
    const data = publicVoiceoverJob({
      id: "local",
      state: "COMPLETED",
      filename: "demo.mp3",
      voice_id: "voice",
      provider_job_id: "private-provider-id",
      failure_code: null,
      created_at: "today",
    });
    expect(data?.audio_url).toBe("/api/v2/voiceovers/jobs/local/audio");
    expect(JSON.stringify(data)).not.toContain("private-provider-id");
  });
});

it("retains explicit long Retry-After for confirmed throttling", async () => {
  await expect(
    j1Fetch(
      "fixture",
      "/v1/tts",
      { method: "POST" },
      async () =>
        new Response(null, {
          status: 429,
          headers: { "retry-after": "7200" },
        }),
    ),
  ).rejects.toMatchObject({ code: "J1TTS_RATE_LIMITED", ambiguous: false, retryAfterMs: 7200000 });
});

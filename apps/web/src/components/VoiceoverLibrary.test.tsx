import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VoiceoverLibrary } from "./VoiceoverLibrary";

const voiceover = {
  id: "voiceover-1",
  title: "Morning brief",
  voice_name: "A.J.",
  voice_id: "aj",
  state: "COMPLETED",
  filename: "morning-brief.mp3",
  created_at: "2026-10-07T08:00:00.000Z",
  script: "Good morning, everyone.",
  character_count: 25,
  duration_ms: 12_300,
  content_length: 512_000,
  creator_id: "creator-1",
  creator_name: "Alex",
  creator_email: "alex@example.test",
  audio_url: "/api/v2/voiceovers/library/voiceover-1/audio",
  download_url: "/api/v2/voiceovers/library/voiceover-1/audio?download=1",
};

function show(centralized = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <VoiceoverLibrary centralized={centralized} />
    </QueryClientProvider>,
  );
  return client;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("VoiceoverLibrary", () => {
  it("loads an audio card with playback, details, creator and download controls", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        voiceovers: [voiceover],
        creators: [{ id: "creator-1", name: "Alex", email: "alex@example.test" }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    show();

    const card = await screen.findByRole("article");
    expect(within(card).getByText("Morning brief")).toBeVisible();
    expect(within(card).getByText("Created by Alex")).toBeVisible();
    expect(within(card).getByText("A.J.")).toBeVisible();
    expect(within(card).getByText("0:12")).toBeVisible();
    expect(within(card).getByText("25 characters")).toBeVisible();
    expect(card.querySelector("audio")).toHaveAttribute("src", voiceover.audio_url);
    expect(within(card).getByRole("link", { name: "Download Morning brief" })).toHaveAttribute(
      "href",
      voiceover.download_url,
    );
    expect(within(card).getByRole("link", { name: "Download Morning brief" })).toHaveAttribute(
      "download",
      "",
    );
    expect(within(card).getByRole("button", { name: "Delete Morning brief" })).toBeEnabled();
  });

  it.each([
    ["FAILED", "Generation failed"],
    ["ARCHIVE_FAILED", "Archive failed"],
  ] as const)(
    "keeps %s errors visible and disables deletion with stale URLs",
    async (state, label) => {
      const fetchMock = vi.fn(async () =>
        Response.json({
          voiceovers: [
            {
              ...voiceover,
              state,
              audio_url: "/stale/audio.mp3",
              download_url: "/stale/audio.mp3?download=1",
            },
          ],
          creators: [],
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      show();

      const card = await screen.findByRole("article");
      expect(within(card).getByText(label)).toBeVisible();
      expect(within(card).getByRole("button", { name: "Delete Morning brief" })).toBeDisabled();
    },
  );

  it("requires both audio URLs before enabling deletion", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          voiceovers: [{ ...voiceover, download_url: null }],
          creators: [],
        }),
      ),
    );

    show();

    const card = await screen.findByRole("article");
    expect(within(card).getByText("Archiving MP3")).toBeVisible();
    expect(within(card).getByRole("button", { name: "Delete Morning brief" })).toBeDisabled();
  });

  it("uses owner or centralized endpoints and confirms deletion", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") return new Response(null, { status: 204 });
      return Response.json({
        voiceovers: [voiceover],
        creators: [{ id: "creator-1", name: "Alex", email: "alex@example.test" }],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    show(true);
    const card = await screen.findByRole("article");
    fireEvent.click(within(card).getByRole("button", { name: "Delete Morning brief" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete voiceover" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v2/voiceovers/library/voiceover-1/delete?centralized=1",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v2/voiceovers/library?centralized=1&page=0");
  });

  it("shows a recoverable error for an unavailable collection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 503 })),
    );

    show();

    expect(await screen.findByText("Voiceover Library unavailable")).toBeVisible();
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
  });

  it("uses server search and pagination parameters", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        voiceovers: [voiceover],
        total: 49,
        total_voiceovers: 49,
        page: 0,
        page_size: 48,
        creators: [{ id: "creator-1", name: "Alex", email: "alex@example.test" }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    show(true);
    await screen.findByRole("article");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        "/api/v2/voiceovers/library?centralized=1&page=1",
        expect.anything(),
      ),
    );
    fireEvent.change(screen.getByRole("searchbox", { name: "Search voiceovers" }), {
      target: { value: "morning" },
    });
    await waitFor(
      () =>
        expect(fetchMock).toHaveBeenLastCalledWith(
          "/api/v2/voiceovers/library?centralized=1&search=morning&page=0",
          expect.anything(),
        ),
      { timeout: 1_500 },
    );
  });
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/voiceovers">{children}</a>,
}));
import { VoiceoverHub, ScriptVoiceover } from "./VoiceoverHub";
const voices = [
  {
    voice_id: "alice",
    name: "Alice",
    tags: "Warm narration",
    languages: "us",
    saved: true,
    starred: true,
    preview_url: "/alice.mp3",
  },
  {
    voice_id: "bob",
    name: "Bob",
    tags: "Calm",
    languages: "gb",
    saved: false,
    starred: false,
    preview_url: null,
  },
];
function wrap(node: ReactNode) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}
    >
      {node}
    </QueryClientProvider>,
  );
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("shows private saved voices and saves a star through authenticated API", async () => {
  const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") return Response.json({ saved: true, starred: true });
    return Response.json({ voices });
  });
  vi.stubGlobal("fetch", fetcher);
  wrap(<VoiceoverHub />);
  await screen.findByRole("heading", { name: "Alice" });
  expect(screen.queryByRole("heading", { name: "Bob" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "All voices" }));
  await screen.findByRole("heading", { name: "Bob" });
  fireEvent.click(screen.getByRole("button", { name: "Star Bob" }));
  await waitFor(() =>
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v2/voiceovers/voices/bob",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ saved: true, starred: true }),
      }),
    ),
  );
});
it("defaults to starred voice and never synthesizes on selection or typing", async () => {
  const fetcher = vi.fn(async (url: RequestInfo | URL, _init?: RequestInit) =>
    Response.json(String(url).endsWith("/voices") ? { voices } : { job: null }),
  );
  vi.stubGlobal("fetch", fetcher);
  wrap(<ScriptVoiceover disabled={false} onReady={vi.fn()} onInvalidate={vi.fn()} />);
  await waitFor(() => expect(screen.getByLabelText("Script voice")).toHaveValue("alice"));
  fireEvent.change(screen.getByLabelText("Voiceover script"), {
    target: { value: "A complete script for a short voiceover." },
  });
  expect(screen.getByRole("button", { name: "Generate voiceover" })).toBeEnabled();
  expect(
    fetcher.mock.calls.every(
      (call) => call.length === 1 || !(call[1] as RequestInit | undefined)?.method,
    ),
  ).toBe(true);
});
it("retains exact request after a lost response and prevents paid duplicate identity", async () => {
  const bodies: string[] = [];
  let posts = 0;
  const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") {
      bodies.push(init.body as string);
      posts++;
      if (posts === 1) throw new TypeError("fetch failed");
      return Response.json({
        job: {
          id: JSON.parse(init.body as string).id,
          state: "UNKNOWN_NO_RETRY",
          filename: "voiceover.mp3",
          voice_id: "alice",
          failure_code: "J1TTS_NETWORK_UNCERTAIN",
          audio_url: null,
        },
      });
    }
    return Response.json(String(url).endsWith("/voices") ? { voices } : { job: null });
  });
  vi.stubGlobal("fetch", fetcher);
  wrap(<ScriptVoiceover disabled={false} onReady={vi.fn()} onInvalidate={vi.fn()} />);
  await waitFor(() => expect(screen.getByLabelText("Script voice")).toHaveValue("alice"));
  fireEvent.change(screen.getByLabelText("Voiceover script"), {
    target: { value: "This request must keep the same durable identity." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Generate voiceover" }));
  await screen.findByText("fetch failed");
  fireEvent.click(screen.getByRole("button", { name: "Generate voiceover" }));
  await screen.findByText(/provider response is uncertain/);
  expect(bodies).toHaveLength(2);
  expect(bodies[0]).toBe(bodies[1]);
  expect(screen.getByRole("button", { name: "Generate voiceover" })).toBeDisabled();
});
it("restores completed MP3 without submitting TTS again", async () => {
  const onReady = vi.fn();
  vi.stubGlobal("URL", { ...URL, createObjectURL: () => "blob:audio", revokeObjectURL: vi.fn() });
  const fetcher = vi.fn(async (url: RequestInfo | URL, _init?: RequestInit) => {
    if (String(url).endsWith("/audio"))
      return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/mpeg" } });
    return Response.json(
      String(url).endsWith("/voices")
        ? { voices }
        : {
            job: {
              id: "saved",
              state: "COMPLETED",
              filename: "saved.mp3",
              voice_id: "alice",
              audio_url: "/jobs/saved/audio",
            },
          },
    );
  });
  vi.stubGlobal("fetch", fetcher);
  wrap(<ScriptVoiceover disabled={false} onReady={onReady} onInvalidate={vi.fn()} />);
  await waitFor(() => expect(onReady).toHaveBeenCalledOnce());
  expect(onReady.mock.calls[0]?.[0].name).toBe("saved.mp3");
  expect(fetcher.mock.calls.every((call) => !(call[1] as RequestInit | undefined)?.method)).toBe(
    true,
  );
});

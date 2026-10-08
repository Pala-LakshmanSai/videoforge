import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/voiceovers">{children}</a>,
}));
import { VoiceoverHub, ScriptVoiceover } from "./VoiceoverHub";
import { VoiceSelect } from "./VoiceSelect";
import { VoiceFilterSelect } from "./VoiceFilterSelect";
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
  vi.restoreAllMocks();
});

it("browses everyone's saved voices and each user's partition without changing their stars", async () => {
  const items = voices.map((voice) => ({ ...voice }));
  const collections = [
    { id: "other", name: "Other user", is_current_user: false, voice_ids: ["bob"] },
  ];
  const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") {
      const change = JSON.parse(init.body as string) as { saved: boolean; starred: boolean };
      Object.assign(items.find((voice) => String(url).endsWith(voice.voice_id))!, change);
      return Response.json(change);
    }
    return Response.json({ voices: items, collections });
  });
  vi.stubGlobal("fetch", fetcher);
  wrap(<VoiceoverHub />);
  await screen.findByRole("heading", { name: "Bob" });
  expect(screen.getByRole("heading", { name: "Alice" })).toBeVisible();
  const select = screen.getByRole("combobox", { name: "Saved by" });
  fireEvent.click(select);
  fireEvent.click(screen.getByRole("option", { name: "Other user 1" }));
  expect(screen.queryByRole("heading", { name: "Alice" })).toBeNull();
  expect(screen.getByRole("button", { name: "Star Bob" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Star Bob" }));
  await screen.findByRole("button", { name: "Unstar Bob" });
  expect(collections[0]?.voice_ids).toEqual(["bob"]);
  fireEvent.click(select);
  fireEvent.click(screen.getByRole("option", { name: "My saved voices" }));
  expect(screen.getByRole("heading", { name: "Alice" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "Bob" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Unstar Bob" }));
  await waitFor(() => expect(screen.queryByRole("heading", { name: "Bob" })).toBeNull());
  fireEvent.click(select);
  fireEvent.click(screen.getByRole("option", { name: "Other user 1" }));
  expect(screen.getByRole("heading", { name: "Bob" })).toBeVisible();
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(2);
});
it("keeps a queued narration locked and observes it without creating another request", async () => {
  const job = {
    id: "queued-voice",
    state: "WAITING",
    script: "Saved narration script.",
    voice_id: "alice",
    filename: "saved.mp3",
    audio_url: null,
  };
  const fetcher = vi.fn(async (url: RequestInfo | URL) =>
    Response.json(String(url).endsWith("/voices") ? { voices } : { job }),
  );
  vi.stubGlobal("fetch", fetcher);
  wrap(<ScriptVoiceover disabled={false} onReady={vi.fn()} onInvalidate={vi.fn()} />);
  await screen.findByText("Waiting for voiceover capacity… You can return later.");
  expect(screen.getByLabelText("Voiceover script")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Generate voiceover" })).toBeDisabled();
  await waitFor(() =>
    expect(fetcher.mock.calls.some(([url]) => String(url).endsWith("/jobs/queued-voice"))).toBe(
      true,
    ),
  );
});
it("uses only the star to add and remove saved voices, including existing unstarred saves", async () => {
  const items = [{ ...voices[0]!, starred: false }, { ...voices[1]! }];
  const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") {
      const change = JSON.parse(init.body as string) as { saved: boolean; starred: boolean };
      Object.assign(items.find((v) => String(url).endsWith(v.voice_id))!, change);
      return Response.json(change);
    }
    return Response.json({ voices: items });
  });
  vi.stubGlobal("fetch", fetcher);
  wrap(<VoiceoverHub />);
  await screen.findByRole("heading", { name: "Alice" });
  expect(screen.queryByRole("button", { name: /^Starred/ })).toBeNull();
  expect(screen.queryByRole("button", { name: /^(Save|Remove) (Alice|Bob)$/ })).toBeNull();
  expect(screen.getByRole("button", { name: "Unstar Alice" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  fireEvent.click(screen.getByRole("button", { name: "Unstar Alice" }));
  await waitFor(() => expect(screen.queryByRole("heading", { name: "Alice" })).toBeNull());
  expect(fetcher).toHaveBeenCalledWith(
    "/api/v2/voiceovers/voices/alice",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ saved: false, starred: false }),
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: /^All voices/ }));
  fireEvent.click(screen.getByRole("button", { name: "Star Bob" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Unstar Bob" })).toBeEnabled());
  expect(fetcher).toHaveBeenCalledWith(
    "/api/v2/voiceovers/voices/bob",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ saved: true, starred: true }),
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: /^Saved/ }));
  expect(screen.getByRole("heading", { name: "Bob" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Unstar Bob" }));
  await waitFor(() => expect(screen.queryByRole("heading", { name: "Bob" })).toBeNull());
});
it("defaults to starred voice and never synthesizes on selection or typing", async () => {
  const fetcher = vi.fn(async (url: RequestInfo | URL, _init?: RequestInit) =>
    Response.json(String(url).endsWith("/voices") ? { voices } : { job: null }),
  );
  vi.stubGlobal("fetch", fetcher);
  wrap(<ScriptVoiceover disabled={false} onReady={vi.fn()} onInvalidate={vi.fn()} />);
  await waitFor(() => expect(screen.getByLabelText("Script voice")).toHaveValue("Alice"));
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
  await waitFor(() => expect(screen.getByLabelText("Script voice")).toHaveValue("Alice"));
  fireEvent.change(screen.getByLabelText("Voiceover script"), {
    target: { value: "This request must keep the same durable identity." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Generate voiceover" }));
  await screen.findByText("fetch failed");
  expect(screen.getByLabelText("Voiceover script")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Check generation" }));
  await screen.findByText(/provider response is uncertain/);
  expect(bodies).toHaveLength(2);
  expect(bodies[0]).toBe(bodies[1]);
  expect(screen.getByRole("button", { name: "Generate voiceover" })).toBeDisabled();
});
it("checks the same new request after a lost response when an older job was completed", async () => {
  const bodies: string[] = [];
  vi.stubGlobal("URL", { ...URL, createObjectURL: () => "blob:audio", revokeObjectURL: vi.fn() });
  const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") {
      bodies.push(init.body as string);
      if (bodies.length === 1) throw new TypeError("fetch failed");
      return Response.json({
        job: {
          id: JSON.parse(bodies[0]!).id,
          state: "UNKNOWN_NO_RETRY",
          filename: "saved.mp3",
          voice_id: "alice",
          audio_url: null,
        },
      });
    }
    if (String(url).endsWith("/audio")) return new Response(new Uint8Array([1, 2, 3]));
    return Response.json(
      String(url).endsWith("/voices")
        ? { voices }
        : {
            job: {
              id: "older",
              state: "COMPLETED",
              filename: "saved.mp3",
              script: "Older narration.",
              voice_id: "alice",
              audio_url: "/older/audio",
            },
          },
    );
  });
  vi.stubGlobal("fetch", fetcher);
  const onReady = vi.fn();
  wrap(<ScriptVoiceover disabled={false} onReady={onReady} onInvalidate={vi.fn()} />);
  await waitFor(() => expect(onReady).toHaveBeenCalledOnce());
  fireEvent.change(screen.getByLabelText("Voiceover script"), {
    target: { value: "New narration after the older completed job." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Generate voiceover" }));
  await screen.findByText("fetch failed");
  expect(screen.queryByRole("button", { name: "Load saved voiceover" })).toBeNull();
  expect(screen.getByLabelText("Voiceover script")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Check generation" }));
  await screen.findByText(/provider response is uncertain/);
  expect(bodies).toHaveLength(2);
  expect(bodies[0]).toBe(bodies[1]);
  expect(JSON.parse(bodies[0]!).id).not.toBe("older");
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
              script: "Original narration restored after refresh.",
              voice_id: "bob",
              audio_url: "/jobs/saved/audio",
            },
          },
    );
  });
  vi.stubGlobal("fetch", fetcher);
  wrap(<ScriptVoiceover disabled={false} onReady={onReady} onInvalidate={vi.fn()} />);
  await waitFor(() => expect(onReady).toHaveBeenCalledOnce());
  expect(onReady.mock.calls[0]?.[0].name).toBe("saved.mp3");
  expect(screen.getByLabelText("Voiceover script")).toHaveValue(
    "Original narration restored after refresh.",
  );
  expect(screen.getByLabelText("Script voice")).toHaveValue("Bob");
  expect(fetcher.mock.calls.every((call) => !(call[1] as RequestInit | undefined)?.method)).toBe(
    true,
  );
});
it("reads a script file and generates only after the explicit button", async () => {
  const posts: Record<string, unknown>[] = [];
  const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") {
      const body = JSON.parse(init.body as string);
      posts.push(body);
      return Response.json({
        job: {
          id: body.id,
          state: "PROCESSING",
          filename: body.filename,
          voice_id: body.voice_id,
          audio_url: null,
        },
      });
    }
    return Response.json(String(url).endsWith("/voices") ? { voices } : { job: null });
  });
  vi.stubGlobal("fetch", fetcher);
  wrap(<ScriptVoiceover disabled={false} onReady={vi.fn()} onInvalidate={vi.fn()} />);
  await waitFor(() => expect(screen.getByLabelText("Script file")).toBeEnabled());
  const file = new File(["River narration."], "river.txt", { type: "text/plain" });
  Object.defineProperty(file, "text", { value: async () => "River narration." });
  fireEvent.change(screen.getByLabelText("Script file"), { target: { files: [file] } });
  await waitFor(() =>
    expect(screen.getByLabelText("Voiceover script")).toHaveValue("River narration."),
  );
  expect(posts).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Generate voiceover" }));
  await waitFor(() => expect(posts).toHaveLength(1));
  expect(posts[0]).toMatchObject({
    script: "River narration.",
    voice_id: "alice",
    filename: "river.mp3",
  });
});

it("searches name prefixes instead of country codes and reports filtered empty states", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        voices: [
          { ...voices[0], languages: "gb,br", tags: "British, Bold" },
          { ...voices[1], name: "Béatrice", preview_url: "/beatrice.mp3" },
          { ...voices[1], voice_id: "abby", name: "Abby" },
        ],
      }),
    ),
  );
  wrap(<VoiceoverHub />);
  await screen.findByRole("heading", { name: "Alice" });
  fireEvent.click(screen.getByRole("button", { name: /^All voices/ }));
  fireEvent.change(screen.getByRole("searchbox", { name: "Search voices" }), {
    target: { value: "  B " },
  });
  expect(screen.getByRole("heading", { name: "Béatrice" })).toBeVisible();
  expect(screen.queryByRole("heading", { name: "Alice" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "Abby" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /^Saved/ }));
  expect(screen.getByRole("heading", { name: "No matching voices" })).toBeVisible();
  expect(screen.queryByText("Build your voice library")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Clear voice search" }));
  expect(screen.getByRole("heading", { name: "Alice" })).toBeVisible();
  expect(screen.getByRole("searchbox", { name: "Search voices" })).toHaveFocus();
});

it("opens the full library for a new user and resets pagination for a new search", async () => {
  const catalog = Array.from({ length: 75 }, (_, n) => ({
    ...voices[1],
    voice_id: `voice-${n}`,
    name: `Brian ${String(n).padStart(2, "0")}`,
  }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ voices: catalog })),
  );
  wrap(<VoiceoverHub />);
  await screen.findByRole("heading", { name: "Brian 00" });
  expect(screen.getByRole("button", { name: /^All voices/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(screen.getAllByRole("article")).toHaveLength(60);
  fireEvent.click(screen.getByRole("button", { name: "Show more voices" }));
  expect(screen.getAllByRole("article")).toHaveLength(75);
  fireEvent.change(screen.getByRole("searchbox", { name: "Search voices" }), {
    target: { value: "b" },
  });
  await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(60));
});

it("keeps one closeable preview and explains failed playback", async () => {
  const reload = vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        voices: voices.map((voice) => ({
          ...voice,
          saved: true,
          preview_url: `/${voice.voice_id}.mp3`,
        })),
      }),
    ),
  );
  const { container } = wrap(<VoiceoverHub />);
  await screen.findByRole("heading", { name: "Alice" });
  fireEvent.click(screen.getByRole("button", { name: "Listen to Alice" }));
  fireEvent.play(screen.getByLabelText("Alice preview"));
  expect(screen.getByRole("button", { name: "Pause Alice" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Listen to Bob" }));
  expect(container.querySelectorAll("audio")).toHaveLength(1);
  fireEvent.error(screen.getByLabelText("Bob preview"));
  expect(screen.getByRole("alert")).toHaveTextContent("Preview unavailable");
  fireEvent.click(screen.getByRole("button", { name: "Listen to Bob" }));
  expect(reload).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Close voice preview" }));
  expect(container.querySelector("audio")).toBeNull();
});

it("reselecting a voice leaves existing narration intact and locking closes the picker", () => {
  const change = vi.fn();
  const view = render(
    <VoiceSelect voices={voices} value="alice" disabled={false} onChange={change} />,
  );
  const picker = screen.getByRole("combobox", { name: "Script voice" });
  fireEvent.focus(picker);
  fireEvent.keyDown(picker, { key: "Enter" });
  expect(change).not.toHaveBeenCalled();
  expect(picker).toHaveValue("Alice");
  fireEvent.focus(picker);
  view.rerender(<VoiceSelect voices={voices} value="alice" disabled onChange={change} />);
  expect(picker).toBeDisabled();
  expect(screen.queryByRole("grid")).toBeNull();
  expect(change).not.toHaveBeenCalled();
});

it("imports with Enter, clears a stale search, and exposes the saved voice", async () => {
  let imported = false;
  const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") {
      imported = true;
      return Response.json({ imported: true });
    }
    return Response.json({
      voices: imported
        ? [...voices, { ...voices[1], voice_id: "new", name: "Zara", saved: true }]
        : voices,
    });
  });
  vi.stubGlobal("fetch", fetcher);
  const { container } = wrap(<VoiceoverHub />);
  await screen.findByRole("heading", { name: "Alice" });
  fireEvent.change(screen.getByRole("searchbox", { name: "Search voices" }), {
    target: { value: "b" },
  });
  fireEvent.change(screen.getByLabelText("ElevenLabs voice ID"), { target: { value: " new " } });
  fireEvent.submit(container.querySelector("form")!);
  await screen.findByRole("heading", { name: "Zara" });
  expect(screen.getByRole("searchbox", { name: "Search voices" })).toHaveValue("");
  expect(fetcher).toHaveBeenCalledWith(
    "/api/v2/voiceovers/import",
    expect.objectContaining({ method: "POST", body: JSON.stringify({ voice_id: "new" }) }),
  );
});

it("uses the same prefix search in the script picker with keyboard selection and no generation", async () => {
  const fetcher = vi.fn(async (url: RequestInfo | URL, _init?: RequestInit) =>
    Response.json(
      String(url).endsWith("/voices")
        ? {
            voices: [
              { ...voices[0], languages: "gb,br", tags: "British" },
              voices[1],
              { ...voices[1], voice_id: "brian", name: "Brian", saved: true, starred: true },
            ],
          }
        : { job: null },
    ),
  );
  vi.stubGlobal("fetch", fetcher);
  wrap(<ScriptVoiceover disabled={false} onReady={vi.fn()} onInvalidate={vi.fn()} />);
  const picker = screen.getByRole("combobox", { name: "Script voice" });
  await waitFor(() => expect(picker).toHaveValue("Alice"));
  fireEvent.focus(picker);
  fireEvent.change(picker, { target: { value: " B " } });
  const list = screen.getByRole("grid", { name: "Voice options" });
  expect(within(list).getAllByRole("row")).toHaveLength(2);
  expect(within(list).queryByText("Alice")).toBeNull();
  expect(within(list).getAllByRole("row")[0]).toHaveTextContent("Brian");
  fireEvent.keyDown(picker, { key: "Enter" });
  expect(picker).toHaveValue("Brian");
  expect(screen.queryByRole("grid")).toBeNull();
  fireEvent.focus(picker);
  fireEvent.change(picker, { target: { value: "zzz" } });
  expect(screen.getByText(/No matching voices/)).toBeVisible();
  fireEvent.keyDown(picker, { key: "Escape" });
  expect(picker).toHaveValue("Brian");
  fireEvent.focus(picker);
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole("grid")).toBeNull();
  expect(
    fetcher.mock.calls.every(
      (call) => call.length === 1 || !(call[1] as RequestInit | undefined)?.method,
    ),
  ).toBe(true);
});

it("previews inside the picker without selecting or submitting, and stops on dismissal", async () => {
  const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  const change = vi.fn();
  const samples = voices.map((v) => ({ ...v, preview_url: `/${v.voice_id}.mp3` }));
  const { container } = render(
    <VoiceSelect voices={samples} value="alice" disabled={false} onChange={change} />,
  );
  const picker = screen.getByRole("combobox", { name: "Script voice" });
  fireEvent.focus(picker);
  fireEvent.click(screen.getByRole("button", { name: "Listen to Bob" }));
  expect(change).not.toHaveBeenCalled();
  expect(picker).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByText("Loading sample…")).toBeVisible();
  const bob = screen.getByLabelText("Bob voice sample");
  fireEvent.playing(bob);
  fireEvent.click(screen.getByRole("button", { name: "Pause Bob" }));
  expect(pause).toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Listen to Bob" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Listen to Alice" }));
  expect(container.querySelectorAll("audio")).toHaveLength(1);
  expect(screen.queryByLabelText("Bob voice sample")).toBeNull();
  fireEvent.keyDown(picker, { key: "Escape" });
  expect(container.querySelector("audio")).toBeNull();
  expect(picker).toHaveValue("Alice");
  expect(change).not.toHaveBeenCalled();
  expect(play).toHaveBeenCalledTimes(2);
});

it("supports keyboard samples, unavailable voices, error retry, and disabled cleanup", async () => {
  const play = vi
    .spyOn(HTMLMediaElement.prototype, "play")
    .mockRejectedValueOnce(new Error("network"))
    .mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  const load = vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  const change = vi.fn();
  const view = render(
    <VoiceSelect voices={voices} value="alice" disabled={false} onChange={change} />,
  );
  const picker = screen.getByRole("combobox", { name: "Script voice" });
  fireEvent.focus(picker);
  expect(screen.getByRole("button", { name: "Preview unavailable for Bob" })).toBeDisabled();
  fireEvent.keyDown(picker, { key: "p", altKey: true });
  await screen.findByText("Couldn't play sample. Try again.");
  fireEvent.click(screen.getByRole("button", { name: "Listen to Alice" }));
  expect(load).toHaveBeenCalledOnce();
  fireEvent.playing(screen.getByLabelText("Alice voice sample"));
  fireEvent.ended(screen.getByLabelText("Alice voice sample"));
  expect(screen.getByRole("button", { name: "Listen to Alice" })).toBeVisible();
  view.rerender(<VoiceSelect voices={voices} value="alice" disabled onChange={change} />);
  expect(view.container.querySelector("audio")).toBeNull();
  expect(screen.queryByRole("grid")).toBeNull();
  expect(change).not.toHaveBeenCalled();
  expect(play).toHaveBeenCalledTimes(2);
});

it("ignores a stale playback rejection after switching voices", async () => {
  let rejectFirst: (reason: Error) => void = () => {};
  vi.spyOn(HTMLMediaElement.prototype, "play")
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectFirst = reject;
        }),
    )
    .mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  const samples = voices.map((v) => ({ ...v, preview_url: `/${v.voice_id}.mp3` }));
  render(<VoiceSelect voices={samples} value="alice" disabled={false} onChange={vi.fn()} />);
  fireEvent.focus(screen.getByRole("combobox", { name: "Script voice" }));
  fireEvent.click(screen.getByRole("button", { name: "Listen to Alice" }));
  fireEvent.click(screen.getByRole("button", { name: "Listen to Bob" }));
  fireEvent.playing(screen.getByLabelText("Bob voice sample"));
  rejectFirst(new Error("aborted"));
  await waitFor(() => expect(screen.getByRole("button", { name: "Pause Bob" })).toBeVisible());
  expect(screen.queryByText("Couldn't play sample. Try again.")).toBeNull();
});

it("combines counted voice filters with search, library tabs, sorting and resets without mutations", async () => {
  const items = [
    {
      ...voices[0],
      name: "Alice - British",
      tags: "Female, Calm, Narrative Story, Mature",
      languages: "gb,us",
    },
    {
      ...voices[1],
      tags: "Male, Calm, Conversational",
      name: "Bob - Young American",
      languages: "us",
    },
    {
      ...voices[1],
      voice_id: "bea",
      tags: "Female, Deep, Advertisement",
      name: "Bea - Indian",
      languages: "in",
      preview_url: "/bea.mp3",
    },
    { ...voices[1], voice_id: "unknown", name: "Zoe", tags: "", languages: "" },
  ];
  const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
    Response.json({ voices: items }),
  );
  vi.stubGlobal("fetch", fetcher);
  wrap(<VoiceoverHub />);
  await screen.findByRole("heading", { name: "Alice - British" });
  fireEvent.click(screen.getByRole("button", { name: /^All voices/ }));
  expect(
    within(screen.getByRole("heading", { name: "Alice - British" }).closest("article")!).getByText(
      "Age: Mature",
    ),
  ).toBeVisible();
  expect(
    within(screen.getByRole("heading", { name: "Zoe" }).closest("article")!).getByText(
      "Age: Not specified",
    ),
  ).toBeVisible();
  chooseFilter("Gender", "Male");
  chooseFilter("Age", "Young");
  expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
    "Bob - Young American",
  ]);
  fireEvent.click(screen.getByRole("button", { name: "Remove Age filter" }));
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  chooseFilter("Age", "Not specified");
  expect(screen.queryByRole("heading", { name: "Alice - British" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  chooseFilter("Gender", "Female");
  expect(screen.queryByRole("heading", { name: "Bob - Young American" })).toBeNull();
  fireEvent.click(screen.getByRole("combobox", { name: "Accent" }));
  expect(screen.getByRole("option", { name: "American 0" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  fireEvent.click(screen.getByRole("option", { name: "Indian 1" }));
  expect(screen.getByRole("heading", { name: "Bea - Indian" })).toBeVisible();
  expect(screen.queryByRole("heading", { name: "Alice - British" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /^Saved/ }));
  expect(screen.getByRole("heading", { name: "No matching voices" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Explore all voices" }));
  expect(screen.getByRole("heading", { name: "Bea - Indian" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Remove Accent filter" }));
  chooseFilter("Style / tone", "Calm");
  chooseFilter("Use case", "Narrative Story");
  chooseFilter("Language / region", "United Kingdom");
  expect(screen.getByRole("heading", { name: "Alice - British" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  fireEvent.click(screen.getByLabelText("Has audio preview"));
  expect(screen.queryByRole("heading", { name: "Bob - Young American" })).toBeNull();
  chooseFilter("Sort", "Name Z–A");
  expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
    "Bea - Indian",
    "Alice - British",
  ]);
  fireEvent.change(screen.getByRole("searchbox", { name: "Search voices" }), {
    target: { value: " B " },
  });
  expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
    "Bea - Indian",
  ]);
  expect(fetcher.mock.calls.every((call) => !(call[1] as RequestInit | undefined)?.method)).toBe(
    true,
  );
});

it("filters the complete catalog beyond the first page and resets pagination", async () => {
  const items = Array.from({ length: 70 }, (_, i) => ({
    ...voices[1],
    voice_id: `voice-${i}`,
    name: `Voice ${String(i).padStart(2, "0")}`,
    tags: i === 69 ? "Female" : "Male",
  }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ voices: items })),
  );
  wrap(<VoiceoverHub />);
  await screen.findByRole("heading", { name: "Voice 00" });
  expect(screen.queryByRole("heading", { name: "Voice 69" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Show more voices" }));
  expect(screen.getByRole("heading", { name: "Voice 69" })).toBeVisible();
  chooseFilter("Gender", "Female");
  expect(screen.getByRole("heading", { name: "Voice 69" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Show more voices" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  expect(screen.queryByRole("heading", { name: "Voice 69" })).toBeNull();
  expect(screen.getByRole("button", { name: "Show more voices" })).toBeVisible();
});

it("sorts saved voices alphabetically when explicitly requested, preserving the default favorite order", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        voices: [
          { ...voices[0], name: "Zoe", starred: true },
          { ...voices[1], name: "Alice", saved: true },
        ],
      }),
    ),
  );
  wrap(<VoiceoverHub />);
  await screen.findByRole("heading", { name: "Zoe" });
  expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
    "Zoe",
    "Alice",
  ]);
  chooseFilter("Sort", "Name A–Z");
  expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
    "Alice",
    "Zoe",
  ]);
});

function chooseFilter(label: string, option: string) {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  fireEvent.click(screen.getByRole("option", { name: new RegExp(`^${option}(?: |$)`) }));
}

it("navigates styled filter menus with keyboard, skips unavailable options and dismisses safely", () => {
  const change = vi.fn();
  const options = [
    { value: "", label: "Any gender" },
    { value: "female", label: "Female", count: 0, disabled: true },
    { value: "male", label: "Male", count: 1 },
    { value: "unspecified", label: "Not specified", count: 0, disabled: true },
  ];
  const view = render(
    <VoiceFilterSelect label="Gender" value="" options={options} onChange={change} />,
  );
  const trigger = screen.getByRole("combobox", { name: "Gender" });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("option", { name: "Any gender" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  fireEvent.click(screen.getByRole("option", { name: "Female 0" }));
  expect(change).not.toHaveBeenCalled();
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  expect(trigger.getAttribute("aria-activedescendant")).toBe(
    screen.getByRole("option", { name: "Male 1" }).id,
  );
  fireEvent.keyDown(trigger, { key: "Enter" });
  expect(change).toHaveBeenCalledWith("male");
  expect(trigger).toHaveFocus();
  expect(screen.queryByRole("listbox")).toBeNull();
  fireEvent.click(trigger);
  fireEvent.keyDown(trigger, { key: "End" });
  expect(trigger.getAttribute("aria-activedescendant")).toBe(
    screen.getByRole("option", { name: "Male 1" }).id,
  );
  fireEvent.keyDown(trigger, { key: "Home" });
  fireEvent.keyDown(trigger, { key: "m" });
  expect(trigger.getAttribute("aria-activedescendant")).toBe(
    screen.getByRole("option", { name: "Male 1" }).id,
  );
  fireEvent.keyDown(trigger, { key: "Escape" });
  expect(screen.queryByRole("listbox")).toBeNull();
  fireEvent.click(trigger);
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole("listbox")).toBeNull();
  fireEvent.click(trigger);
  fireEvent.blur(trigger, { relatedTarget: document.body });
  expect(screen.queryByRole("listbox")).toBeNull();
  fireEvent.click(trigger);
  view.rerender(
    <VoiceFilterSelect label="Gender" value="" options={options} disabled onChange={change} />,
  );
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(trigger).toBeDisabled();
  expect(change).toHaveBeenCalledTimes(1);
});

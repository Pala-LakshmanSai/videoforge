import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => (
    <a href={String(props.to ?? "/")} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("./HostedIdentity", () => ({
  useHostedIdentity: () => ({ email: "owner@example.test" }),
}));

import { StandaloneVoiceover } from "./StandaloneVoiceover";

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
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("starts with the preferred voice and waits for an explicit create action", async () => {
  const fetcher = vi.fn(async (_url: RequestInfo | URL) => Response.json({ voices }));
  vi.stubGlobal("fetch", fetcher);
  wrap(<StandaloneVoiceover />);

  await waitFor(() => expect(screen.getByLabelText("Script voice")).toHaveValue("Alice"));
  expect(
    fetcher.mock.calls.filter(([url]) => String(url).endsWith("/voiceovers/voices")),
  ).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Add to queue" })).toBeDisabled();
});

it("loads a text script and submits title, script, voice, filename, and one durable id", async () => {
  let posted: Record<string, string> | null = null;
  const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") {
      posted = JSON.parse(String(init.body)) as Record<string, string>;
      return Response.json({
        job: {
          id: posted.id,
          state: "COMPLETED",
          title: posted.title,
          filename: posted.filename,
          voice_id: posted.voice_id,
          audio_url: "/api/v2/voiceovers/library/audio-ready",
          download_url: "/api/v2/voiceovers/library/audio-ready?download=1",
        },
      });
    }
    if (String(url).includes("/library?")) return Response.json({ voiceovers: [] });
    return Response.json({ voices });
  });
  vi.stubGlobal("fetch", fetcher);
  wrap(<StandaloneVoiceover />);
  await waitFor(() => expect(screen.getByLabelText("Script voice")).toHaveValue("Alice"));
  fireEvent.change(screen.getByLabelText("Voiceover title"), {
    target: { value: "A quiet beginning" },
  });
  fireEvent.change(screen.getByLabelText("Voiceover script"), {
    target: { value: "A short narration for testing." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add to queue" }));

  await screen.findByText("Voiceover ready");
  expect(posted).toMatchObject({
    title: "A quiet beginning",
    script: "A short narration for testing.",
    voice_id: "alice",
    filename: "A_quiet_beginning.mp3",
  });
  expect((posted as unknown as Record<string, string>).id).toMatch(/^[0-9a-f-]{36}$/u);
  expect(screen.getByRole("link", { name: "Download A quiet beginning" })).toHaveAttribute(
    "href",
    "/api/v2/voiceovers/library/audio-ready?download=1",
  );
  expect(screen.getByRole("link", { name: "Download A quiet beginning" })).not.toHaveAttribute(
    "download",
  );
  expect(screen.getByLabelText("Voiceover title")).toHaveValue("");
  expect(screen.getByLabelText("Voiceover script")).toHaveValue("");
  expect(screen.getByLabelText("Script voice")).toHaveValue("Alice");
});

it("keeps uncertainty hidden while POST is preparing and shows it after failure", async () => {
  let rejectPost!: (reason: unknown) => void;
  const pendingPost = new Promise<Response>((_, reject) => {
    rejectPost = reject;
  });
  const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") return pendingPost;
    return Response.json({ voices });
  });
  vi.stubGlobal("fetch", fetcher);
  wrap(<StandaloneVoiceover />);
  await waitFor(() => expect(screen.getByLabelText("Script voice")).toHaveValue("Alice"));
  fireEvent.change(screen.getByLabelText("Voiceover script"), {
    target: { value: "Wait for this request to finish." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add to queue" }));

  await screen.findByRole("button", { name: "Adding…" });
  expect(
    screen.queryByText("Request status is uncertain. Check the saved request before retrying."),
  ).toBeNull();
  const saved = JSON.parse(window.sessionStorage.getItem("videoforge.standalone-voiceover.v1")!);
  expect(saved.unconfirmed).toBe(true);

  rejectPost(new TypeError("fetch failed"));
  await screen.findByText("Request status is uncertain. Check the saved request before retrying.");
});

it("keeps the same request id after an uncertain response and checks before resubmitting", async () => {
  const posts: Record<string, string>[] = [];
  let checkCount = 0;
  const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") {
      posts.push(JSON.parse(String(init.body)) as Record<string, string>);
      if (posts.length === 1) throw new TypeError("fetch failed");
      return Response.json({
        job: {
          id: posts[0]!.id,
          state: "COMPLETED",
          filename: posts[0]!.filename,
          voice_id: "alice",
          audio_url: "/ready.mp3",
          download_url: "/ready.mp3?download=1",
        },
      });
    }
    if (String(url).includes("/jobs/")) {
      checkCount += 1;
      if (checkCount === 1)
        return Response.json({ error: { code: "VOICEOVER_NOT_FOUND" } }, { status: 404 });
      return Response.json({
        job: {
          id: posts[0]!.id,
          state: "COMPLETED",
          filename: posts[0]!.filename,
          voice_id: "alice",
          audio_url: "/ready.mp3",
        },
      });
    }
    return Response.json({ voices });
  });
  vi.stubGlobal("fetch", fetcher);
  wrap(<StandaloneVoiceover />);
  await waitFor(() => expect(screen.getByLabelText("Script voice")).toHaveValue("Alice"));
  fireEvent.change(screen.getByLabelText("Voiceover script"), {
    target: { value: "This request keeps one id." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add to queue" }));
  await screen.findByRole("button", { name: "Check generation" });
  fireEvent.click(screen.getByRole("button", { name: "Check generation" }));
  await screen.findByText("Voiceover ready");
  expect(posts).toHaveLength(2);
  expect(posts[0]!.id).toBe(posts[1]!.id);
  expect(posts[0]).toEqual(posts[1]);
});

it("rechecks a WAITING uncertain request with the original body before freeing the composer", async () => {
  const posts: Record<string, string>[] = [];
  let checked = false;
  const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") {
      posts.push(JSON.parse(String(init.body)) as Record<string, string>);
      if (posts.length === 1) throw new TypeError("fetch failed");
      return Response.json({
        job: {
          id: posts[0]!.id,
          state: "WAITING",
          title: posts[0]!.title,
          filename: posts[0]!.filename,
          voice_id: "alice",
          audio_url: null,
        },
      });
    }
    if (String(url).includes("/jobs/")) {
      checked = true;
      return Response.json({
        job: {
          id: posts[0]!.id,
          state: "WAITING",
          title: posts[0]!.title,
          filename: posts[0]!.filename,
          voice_id: "alice",
          audio_url: null,
        },
      });
    }
    if (String(url).includes("/library?")) return Response.json({ voiceovers: [] });
    return Response.json({ voices });
  });
  vi.stubGlobal("fetch", fetcher);
  wrap(<StandaloneVoiceover />);
  await waitFor(() => expect(screen.getByLabelText("Script voice")).toHaveValue("Alice"));
  fireEvent.change(screen.getByLabelText("Voiceover script"), {
    target: { value: "Keep this exact request while checking queue admission." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add to queue" }));
  await screen.findByRole("button", { name: "Check generation" });
  fireEvent.click(screen.getByRole("button", { name: "Check generation" }));

  await waitFor(() => expect(checked).toBe(true));
  await screen.findByText("Queued");
  expect(posts).toHaveLength(2);
  expect(posts[0]!.id).toBe(posts[1]!.id);
  expect(posts[0]).toEqual(posts[1]);
  expect(screen.getByLabelText("Voiceover script")).toHaveValue("");
});

it("adds successive scripts without losing the first ready queue item", async () => {
  const posts: Record<string, string>[] = [];
  const libraryJobs: Record<string, unknown>[] = [];
  const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Record<string, string>;
      posts.push(body);
      const job = {
        id: body.id,
        state: "COMPLETED",
        title: body.title,
        filename: body.filename,
        voice_id: body.voice_id,
        voice_name: "Alice",
        audio_url: `/audio/${body.id}.mp3`,
        download_url: `/audio/${body.id}.mp3?download=1`,
        created_at: new Date().toISOString(),
        script: body.script,
        duration_ms: 8_000,
        content_length: 128,
      };
      libraryJobs.unshift(job);
      return Response.json({ job });
    }
    if (String(url).includes("/library?")) return Response.json({ voiceovers: libraryJobs });
    return Response.json({ voices });
  });
  vi.stubGlobal("fetch", fetcher);
  wrap(<StandaloneVoiceover />);
  await waitFor(() => expect(screen.getByLabelText("Script voice")).toHaveValue("Alice"));

  fireEvent.change(screen.getByLabelText("Voiceover title"), {
    target: { value: "First take" },
  });
  fireEvent.change(screen.getByLabelText("Voiceover script"), {
    target: { value: "First queued narration." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add to queue" }));
  await screen.findByText("First take");
  expect(screen.getByLabelText("Voiceover title")).toHaveValue("");
  expect(screen.getByLabelText("Voiceover script")).toHaveValue("");

  fireEvent.change(screen.getByLabelText("Voiceover title"), {
    target: { value: "Second take" },
  });
  fireEvent.change(screen.getByLabelText("Voiceover script"), {
    target: { value: "Second queued narration." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add to queue" }));

  await screen.findByText("Second take");
  expect(screen.getByText("First take")).toBeVisible();
  expect(screen.getByRole("link", { name: "Download First take" })).toHaveAttribute(
    "href",
    expect.stringContaining("download=1"),
  );
  expect(posts).toHaveLength(2);
  expect(posts[0]!.id).not.toBe(posts[1]!.id);
});

it("reloads recent queued and ready jobs from the library endpoint", async () => {
  const jobs = [
    {
      id: "00000000-0000-4000-8000-000000000001",
      state: "COMPLETED",
      title: "Ready after reload",
      filename: "ready-after-reload.mp3",
      voice_id: "alice",
      voice_name: "Alice",
      audio_url: "/audio/ready.mp3",
      download_url: "/audio/ready.mp3?download=1",
      created_at: "2026-10-07T10:00:00.000Z",
      script: "Ready script.",
      duration_ms: 12_000,
      content_length: 256,
    },
    {
      id: "00000000-0000-4000-8000-000000000002",
      state: "PROCESSING",
      title: "Still generating after reload",
      filename: "still-generating.mp3",
      voice_id: "alice",
      voice_name: "Alice",
      audio_url: null,
      download_url: null,
      created_at: "2026-10-07T09:00:00.000Z",
      script: "Processing script.",
      duration_ms: null,
      content_length: null,
    },
  ];
  const fetcher = vi.fn(async (url: RequestInfo | URL) =>
    String(url).includes("/library?")
      ? Response.json({ voiceovers: jobs })
      : Response.json({ voices }),
  );
  vi.stubGlobal("fetch", fetcher);
  const first = wrap(<StandaloneVoiceover />);
  await screen.findByText("Ready after reload");
  await screen.findByText("Still generating after reload");
  expect(screen.getByLabelText("Listen to Ready after reload")).toBeVisible();
  expect(screen.getByText("Generating MP3")).toBeVisible();

  first.unmount();
  wrap(<StandaloneVoiceover />);
  await screen.findByText("Ready after reload");
  await screen.findByText("Still generating after reload");
  expect(fetcher.mock.calls.filter(([url]) => String(url).includes("/library?"))).not.toHaveLength(
    0,
  );
});

it("persists the request before a lost POST and reloads into check-only recovery", async () => {
  const posts: Record<string, string>[] = [];
  let recovered = false;
  const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") {
      posts.push(JSON.parse(String(init.body)) as Record<string, string>);
      throw new TypeError("fetch failed");
    }
    if (String(url).includes("/jobs/")) {
      recovered = true;
      return Response.json({
        job: {
          id: posts[0]!.id,
          state: "PROCESSING",
          filename: "voiceover.mp3",
          voice_id: "alice",
          audio_url: null,
        },
      });
    }
    return Response.json({ voices });
  });
  vi.stubGlobal("fetch", fetcher);
  const first = wrap(<StandaloneVoiceover />);
  await waitFor(() => expect(screen.getByLabelText("Script voice")).toHaveValue("Alice"));
  fireEvent.change(screen.getByLabelText("Voiceover script"), {
    target: { value: "Recover this exact request after the tab closes." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add to queue" }));
  await screen.findByRole("button", { name: "Check generation" });
  const saved = JSON.parse(window.sessionStorage.getItem("videoforge.standalone-voiceover.v1")!);
  expect(saved.unconfirmed).toBe(true);
  expect(saved.request.id).toBe(posts[0]!.id);
  expect(posts).toHaveLength(1);

  first.unmount();
  wrap(<StandaloneVoiceover />);
  await screen.findByRole("button", { name: "Check generation" });
  expect(posts).toHaveLength(1);
  fireEvent.submit(screen.getByRole("button", { name: "Check generation" }).closest("form")!);
  await waitFor(() => expect(recovered).toBe(true));
  expect(posts).toHaveLength(1);
});

it("checks an uncertain queued job without submitting it again", async () => {
  let checked = false;
  const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    expect(init?.method).not.toBe("POST");
    const job = {
      id: "uncertain-job",
      title: "Saved request",
      filename: "saved.mp3",
      voice_id: "alice",
      state: checked ? "PROCESSING" : "UNKNOWN_NO_RETRY",
    };
    if (String(url).endsWith("/jobs/uncertain-job")) {
      checked = true;
      return Response.json({ job });
    }
    if (String(url).includes("/library?")) return Response.json({ voiceovers: [job] });
    return Response.json({ voices });
  });
  vi.stubGlobal("fetch", fetcher);
  wrap(<StandaloneVoiceover />);
  fireEvent.click(await screen.findByRole("button", { name: "Check status" }));
  await screen.findByText("Generating MP3");
  expect(checked).toBe(true);
  expect(screen.getByLabelText("Voiceover script")).toBeEnabled();
});

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
  const fetcher = vi.fn(async () => Response.json({ voices }));
  vi.stubGlobal("fetch", fetcher);
  wrap(<StandaloneVoiceover />);

  await waitFor(() => expect(screen.getByLabelText("Script voice")).toHaveValue("Alice"));
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Create voiceover" })).toBeDisabled();
});

it("loads a text script and submits title, script, voice, filename, and one durable id", async () => {
  let posted: Record<string, string> | null = null;
  const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") {
      posted = JSON.parse(String(init.body)) as Record<string, string>;
      return Response.json({
        job: {
          id: posted.id,
          state: "PROCESSING",
          title: posted.title,
          filename: posted.filename,
          voice_id: posted.voice_id,
          audio_url: null,
        },
      });
    }
    if (String(url).endsWith("/alice")) return Response.json({});
    if (String(url).includes("/jobs/"))
      return Response.json({
        job: {
          id: posted?.id,
          state: "COMPLETED",
          title: "A quiet beginning",
          filename: "A_quiet_beginning.mp3",
          voice_id: "alice",
          voice_name: "Alice",
          audio_url: "/api/v2/voiceovers/jobs/audio-ready",
          duration_ms: 8_000,
        },
      });
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
  fireEvent.click(screen.getByRole("button", { name: "Create voiceover" }));

  await screen.findByText("Voiceover ready");
  expect(posted).toMatchObject({
    title: "A quiet beginning",
    script: "A short narration for testing.",
    voice_id: "alice",
    filename: "A_quiet_beginning.mp3",
  });
  expect((posted as unknown as Record<string, string>).id).toMatch(/^[0-9a-f-]{36}$/u);
  expect(screen.getByRole("link", { name: "Download MP3" })).toHaveAttribute(
    "href",
    "/api/v2/voiceovers/jobs/audio-ready?download=1",
  );
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
          state: "PROCESSING",
          filename: posts[0]!.filename,
          voice_id: "alice",
          audio_url: null,
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
  fireEvent.click(screen.getByRole("button", { name: "Create voiceover" }));
  await screen.findByRole("button", { name: "Check generation" });
  fireEvent.click(screen.getByRole("button", { name: "Check generation" }));
  await screen.findByText("Voiceover ready");
  expect(posts).toHaveLength(2);
  expect(posts[0]!.id).toBe(posts[1]!.id);
  expect(posts[0]).toEqual(posts[1]);
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
  fireEvent.click(screen.getByRole("button", { name: "Create voiceover" }));
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

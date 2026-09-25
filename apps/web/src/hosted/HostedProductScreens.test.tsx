import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const routerState = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="#hosted-route">{children}</a>,
  useNavigate: () => routerState.navigate,
}));

vi.mock("../lib/media-validation", async () => {
  const actual =
    await vi.importActual<typeof import("../lib/media-validation")>("../lib/media-validation");
  const normalizedBytes = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  ]);
  const normalizedBytesBase64 = btoa(String.fromCharCode(...normalizedBytes));
  return {
    ...actual,
    normalizeImageStyleReference: vi.fn(async (file: File) => {
      const marker = file.name.includes("one") ? "1" : file.name.includes("two") ? "2" : "3";
      return {
        bytesBase64: normalizedBytesBase64,
        checksum: "sha256:" + "a".repeat(64),
        clientReferenceId: "test-" + file.name,
        filename: file.name,
        height: 512,
        mediaType: "image/webp" as const,
        objectUrl: "blob:" + file.name,
        width: 512,
        original: {
          bytesBase64: btoa("source"),
          checksum: "sha256:" + marker.repeat(64),
          height: 512,
          mediaType: "image/png" as const,
          width: 512,
        },
        normalized: {
          bytesBase64: normalizedBytesBase64,
          checksum: "sha256:" + "a".repeat(64),
          height: 512,
          mediaType: "image/webp" as const,
          width: 512,
        },
      };
    }),
  };
});

import {
  HostedAvatarHubScreen,
  HostedCreateProjectScreen,
  HostedPresetCreationScreen,
  HostedPresetCreationUnavailableScreen,
  HostedProjectScreen,
  HostedStylesHubScreen,
  HostedUsageScreen,
  HostedElapsed,
  HOSTED_SHA256_CHUNK_BYTES,
  audioDurationMs,
  hostedFileSha256,
  hostedVoiceoverFilename,
  hostedProjectPollInterval,
  hostedPreflightEstimateText,
  hostedSignedUrlExpiresAtMs,
  isFailClosedGpuReadiness,
  normalizeHostedReturnTo,
  parseWavDurationMs,
  preflightBlockers,
  readJson,
  stableHostedMediaUrl,
  transcriptionFailureMessage,
} from "./HostedProductScreens";

it("ticks elapsed stage time and freezes on success, failure, cancellation and reload", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-15T10:00:05Z"));
  const since = "2026-09-15T10:00:00Z";
  const view = render(<HostedElapsed since={since} until={null} />);
  expect(screen.getByLabelText("Elapsed time")).toHaveTextContent("0m 05s");
  act(() => vi.advanceTimersByTime(2_000));
  expect(screen.getByLabelText("Elapsed time")).toHaveTextContent("0m 07s");
  view.rerender(<HostedElapsed since={since} until="2026-09-15T10:00:06Z" running={false} />);
  act(() => vi.advanceTimersByTime(60_000));
  expect(screen.getByLabelText("Elapsed time")).toHaveTextContent("0m 06s");
  view.unmount();
  const restored = render(
    <HostedElapsed since={since} until="2026-09-15T10:00:06Z" running={false} />,
  );
  expect(screen.getByLabelText("Elapsed time")).toHaveTextContent("0m 06s");
  restored.rerender(<HostedElapsed since={since} until={null} running={false} />);
  expect(screen.getByLabelText("Elapsed time")).toHaveTextContent("—");
  restored.rerender(<HostedElapsed since={null} until={null} running={false} />);
  expect(screen.getByLabelText("Elapsed time")).toHaveTextContent("—");
  restored.unmount();
  vi.setSystemTime(new Date("2026-09-15T10:00:10Z"));
  const intervals = [
    { since, until: "2026-09-15T10:00:06Z", running: false },
    { since: "2026-09-15T10:00:08Z", until: null, running: true },
    { since: null, until: null, running: false },
  ];
  const total = render(<HostedElapsed since={null} until={null} intervals={intervals} />);
  expect(screen.getByLabelText("Elapsed time")).toHaveTextContent("0m 08s");
  act(() => vi.advanceTimersByTime(2_000));
  expect(screen.getByLabelText("Elapsed time")).toHaveTextContent("0m 10s");
  total.unmount();
  vi.useRealTimers();
});

describe("hosted project polling", () => {
  const detail = (overrides: Partial<ProjectDetailResponseForPolling> = {}) => ({
    project: {
      id: "11111111-1111-4111-8111-111111111111",
      title: "Private project",
      created_at: "2026-09-02T10:00:00.000Z",
      revision_id: "22222222-2222-4222-8222-222222222222",
      revision_state: "LOCKED",
    },
    attempts: [],
    gpu_transport: "DISABLED_UNQUALIFIED" as const,
    gpu_readiness: gpuReadiness,
    generation: null,
    ...overrides,
  });

  type ProjectDetailResponseForPolling = Parameters<typeof hostedProjectPollInterval>[0] extends
    | infer T
    | undefined
    ? NonNullable<T>
    : never;

  it("refreshes a running project while the browser tab is unfocused", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(
        detail({
          stages: [{ id: "image-generation", name: "Generate images", status: "RUNNING" }],
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    focusManager.setFocused(false);
    renderHosted(<HostedProjectScreen projectId="11111111-1111-4111-8111-111111111111" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(1), { timeout: 3_500 });
  });

  it("stops background reads after a terminal Stage 3 provider failure", () => {
    expect(
      hostedProjectPollInterval(
        detail({
          voiceover_context: {
            id: "44444444-4444-4444-8444-444444444444",
            state: "FAILED",
            transcript_hash: `sha256:${"b".repeat(64)}`,
            reserved_cost_micro_usd: 10_000,
            problem_code: "VOICEOVER_CONTEXT_PROVIDER_REJECTED",
          },
        }),
      ),
    ).toBe(false);
  });

  it("keeps polling while a nonterminal hosted stage is running", () => {
    expect(
      hostedProjectPollInterval(
        detail({
          stages: [
            {
              id: "voiceover-context",
              name: "Understand voiceover context",
              status: "RUNNING",
              progress_percent: 50,
            },
          ],
        }),
      ),
    ).toBe(2_000);
  });

  it("stops background reads after a blocked hosted stage", () => {
    expect(
      hostedProjectPollInterval(
        detail({
          stages: [
            {
              id: "prompt-writing",
              name: "Write image prompts",
              status: "BLOCKED",
              progress_percent: 0,
            },
          ],
        }),
      ),
    ).toBe(false);
  });

  it("keeps polling when a downstream stage is blocked while an earlier stage runs", () => {
    expect(
      hostedProjectPollInterval(
        detail({
          stages: [
            {
              id: "prompt-writing",
              name: "Write image prompts",
              status: "RUNNING",
              progress_percent: 50,
            },
            {
              id: "image-generation",
              name: "Generate images",
              status: "BLOCKED",
              progress_percent: 0,
            },
          ],
        }),
      ),
    ).toBe(2_000);
  });

  it("keeps polling when a blocked stage has an active attempt", () => {
    expect(
      hostedProjectPollInterval(
        detail({
          stages: [
            {
              id: "prompt-writing",
              name: "Write image prompts",
              status: "BLOCKED",
              progress_percent: 0,
            },
          ],
          attempts: [
            {
              id: "33333333-3333-4333-8333-333333333333",
              kind: "MAGE_IMAGE",
              state: "RUNNING",
              version: 1,
              created_at: "2026-09-03T10:00:00.000Z",
              updated_at: "2026-09-03T10:00:01.000Z",
              terminal_at: null,
              output_checksum_sha256: null,
              approved_at: null,
              preview_url: null,
            },
          ],
        }),
      ),
    ).toBe(2_000);
  });
});

it("reuses signed media URLs until their refresh window and refreshes expired URLs", () => {
  const issuedAt = Date.parse("2026-09-25T10:00:00.000Z");
  const firstUrl =
    "https://artifacts.example/clip.mp4?X-Amz-Date=20260925T100000Z&X-Amz-Expires=300&X-Amz-Signature=first";
  const refreshedUrl =
    "https://artifacts.example/clip.mp4?X-Amz-Date=20260925T100004Z&X-Amz-Expires=300&X-Amz-Signature=second";
  const replacementUrl =
    "https://artifacts.example/replacement.mp4?X-Amz-Date=20260925T100004Z&X-Amz-Expires=300&X-Amz-Signature=replacement";
  const cache = new Map();
  const item = { id: "clip-1", video_url: firstUrl };

  expect(hostedSignedUrlExpiresAtMs(firstUrl)).toBe(issuedAt + 300_000);
  expect(stableHostedMediaUrl(cache, "project:revision", "avatar", item, issuedAt)).toBe(
    firstUrl,
  );
  expect(
    stableHostedMediaUrl(
      cache,
      "project:revision",
      "avatar",
      { ...item, video_url: refreshedUrl },
      issuedAt + 60_000,
    ),
  ).toBe(firstUrl);
  expect(
    stableHostedMediaUrl(
      cache,
      "project:revision",
      "avatar",
      { ...item, video_url: refreshedUrl },
      issuedAt + 271_000,
    ),
  ).toBe(refreshedUrl);
  expect(
    stableHostedMediaUrl(
      cache,
      "project:revision",
      "avatar",
      { ...item, video_url: replacementUrl },
      issuedAt + 272_000,
    ),
  ).toBe(replacementUrl);
});

it("keeps an open avatar viewer URL stable across project polling", async () => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-25T10:00:00.000Z"));
  const projectId = "33333333-3333-4333-8333-333333333333";
  const firstUrl =
    "https://artifacts.example/avatar.mp4?X-Amz-Date=20260925T100000Z&X-Amz-Expires=300&X-Amz-Signature=first";
  const refreshedUrl =
    "https://artifacts.example/avatar.mp4?X-Amz-Date=20260925T100001Z&X-Amz-Expires=300&X-Amz-Signature=second";
  let reads = 0;
  const detail = () => ({
    project: {
      id: projectId,
      title: "Avatar preview",
      created_at: "2026-09-25T05:00:00.000Z",
      revision_id: "44444444-4444-4444-8444-444444444444",
      revision_state: "LOCKED",
    },
    attempts: [],
    generation: null,
    gpu_transport: "DISABLED_UNQUALIFIED" as const,
    gpu_readiness: gpuReadiness,
    stages: [
      { id: "avatar-generation", name: "Generate avatar video", status: "COMPLETE" },
      { id: "render", name: "Assemble final video", status: "RUNNING" },
    ],
    avatar_footage: [
      { id: "avatar-1", video_url: reads === 1 ? firstUrl : refreshedUrl, label: "Avatar clip 1" },
    ],
  });
  const fetchMock = vi.fn(async () => {
    reads += 1;
    return Response.json(detail());
  });
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <HostedProjectScreen projectId={projectId} />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "View avatar videos/footage" }));
  const video = screen.getByLabelText("Avatar clip 1");
  expect(video).toHaveAttribute("src", firstUrl);

  await act(async () => {
    await client.invalidateQueries({ queryKey: ["hosted-project", projectId] });
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(video).toHaveAttribute("src", firstUrl);
});

it("does not render the previous project while a new project detail is loading", async () => {
  const firstProjectId = "11111111-1111-4111-8111-111111111111";
  const secondProjectId = "22222222-2222-4222-8222-222222222222";
  const makeDetail = (projectId: string, title: string) => ({
    project: {
      id: projectId,
      title,
      created_at: "2026-09-25T05:00:00.000Z",
      revision_id: `${projectId.slice(0, 8)}-revision`,
      revision_state: "LOCKED",
    },
    attempts: [],
    generation: null,
    gpu_transport: "DISABLED_UNQUALIFIED" as const,
    gpu_readiness: gpuReadiness,
    stages: stageList({ prepare: "COMPLETE" }),
  });
  let releaseSecondProject = () => {};
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith(`/projects/${firstProjectId}`)) {
        return Promise.resolve(Response.json(makeDetail(firstProjectId, "First project")));
      }
      return new Promise<Response>((resolve) => {
        releaseSecondProject = () =>
          resolve(Response.json(makeDetail(secondProjectId, "Second project")));
      });
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <HostedProjectScreen projectId={firstProjectId} />
    </QueryClientProvider>,
  );
  expect(await screen.findByText("First project")).toBeInTheDocument();

  view.rerender(
    <QueryClientProvider client={client}>
      <HostedProjectScreen projectId={secondProjectId} />
    </QueryClientProvider>,
  );
  expect(screen.queryByText("First project")).not.toBeInTheDocument();
  expect(screen.getByText("Connecting to your project and personal media worker…")).toBeVisible();
  releaseSecondProject();
  expect(await screen.findByText("Second project")).toBeInTheDocument();
});

function renderHosted(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

/**
 * A failed stage owns its retry control, so these assertions read the button out of the stage row
 * that stopped rather than from a notice under the pipeline.
 */
function stageRow(label: string): HTMLElement {
  // The progress hero repeats the active stage name in an h2, so read the row out of the stage list.
  const list = screen.getByRole("list", { name: "Project stages" });
  const row = within(list).getByText(label).closest("li");
  if (!row) throw new Error(`stage row not found: ${label}`);
  return row as HTMLElement;
}

/** The server's stage projection as the project payload carries it; only the asserted rows matter. */
function stageList(overrides: Readonly<Record<string, string>> = {}) {
  const rows: readonly (readonly [string, string])[] = [
    ["prepare", "Prepare project"],
    ["transcription", "Transcribe voiceover"],
    ["voiceover-context", "Understand voiceover context"],
    ["planning", "Plan scenes"],
    ["prompt-writing", "Write image prompts"],
    ["audio-spanning", "Audio spanning"],
    ["image-generation", "Generate images"],
    ["avatar-generation", "Generate avatar video"],
    ["render", "Assemble final video"],
    ["technical-check", "Technical check"],
    ["review", "Review and approve"],
  ];
  return rows.map(([id, name]) => ({
    id,
    name,
    status: overrides[id] ?? "PENDING",
    progress_percent: null,
    started_at: null,
    completed_at: null,
    detail: null,
  }));
}

it.each([
  {
    overrun: false,
    expectedValue: "~2–5 min",
    expectedDetail: /based on recent short runs; times vary/i,
  },
  {
    overrun: true,
    expectedValue: "Taking longer",
    expectedDetail: /than recent short runs; API and render times vary/i,
  },
])("shows an honest API project time estimate when overrun=$overrun", async ({
  overrun,
  expectedValue,
  expectedDetail,
}) => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({
    project: { id: "estimate", title: "Estimated video", created_at: "2026-09-25T05:00:00Z",
      revision_id: "revision", revision_state: "LOCKED" },
    generation_provider: "KIE_FAL",
    attempts: [],
    generation: null,
    gpu_transport: "DISABLED_UNQUALIFIED",
    gpu_readiness: gpuReadiness,
    stages: stageList({ prepare: "COMPLETE", transcription: "RUNNING" }),
    time_estimate: {
      remaining_min_ms: 120_000,
      remaining_max_ms: 300_000,
      basis: "RECENT_API_SHORT_RUN",
      overrun,
    },
  })));
  renderHosted(<HostedProjectScreen projectId="estimate" />);
  const hero = await screen.findByRole("region", { name: "Live video progress" });
  expect(within(hero).getByText(expectedValue)).toBeInTheDocument();
  expect(within(hero).getByText(expectedDetail)).toBeInTheDocument();
  expect(within(hero).queryByText("Not reported")).not.toBeInTheDocument();
});

it("refreshes a running project's time estimate without reloading", async () => {
  let reads = 0;
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({
    project: { id: "estimate-live", title: "Estimated video", created_at: "2026-09-25T05:00:00Z",
      revision_id: "revision", revision_state: "LOCKED" },
    generation_provider: "KIE_FAL",
    attempts: [],
    generation: null,
    gpu_transport: "DISABLED_UNQUALIFIED",
    gpu_readiness: gpuReadiness,
    stages: stageList({ prepare: "COMPLETE", transcription: "RUNNING" }),
    time_estimate: ++reads === 1 ? null : {
      remaining_min_ms: 120_000,
      remaining_max_ms: 300_000,
      basis: "RECENT_API_SHORT_RUN",
      overrun: false,
    },
  })));
  renderHosted(<HostedProjectScreen projectId="estimate-live" />);
  const hero = await screen.findByRole("region", { name: "Live video progress" });
  const estimateMetric = within(hero).getByText("Estimated").closest<HTMLElement>(".metric");
  expect(estimateMetric).not.toBeNull();
  expect(within(estimateMetric!).getByText("After scene plan")).toBeInTheDocument();
  await waitFor(() => expect(within(estimateMetric!).getByText("~2–5 min")).toBeInTheDocument(), {
    timeout: 3_500,
  });
});

it("shows ready without stale remaining time or generation notice after render succeeds", async () => {
  let completed = false;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).endsWith("/gpu-dispatch")) {
      completed = true;
      return Response.json({
        schema_version: "videoforge-hosted-v209-project-dispatch/v1",
        state: "SCHEDULED",
        correlation_id: "completed-generation",
      }, { status: 202 });
    }
    return Response.json({
      project: { id: "estimate-ready", title: "Ready video", created_at: "2026-09-25T05:00:00Z",
        revision_id: "revision", revision_state: "LOCKED" },
      generation_provider: "KIE_FAL",
      attempts: completed ? [{ id: "render", kind: "RENDER", state: "SUCCEEDED",
        terminal_at: "2026-09-25T05:03:00Z" }] : [],
      generation: { id: "generation", timeline_plan_sha256: `sha256:${"a".repeat(64)}`,
        planned_tasks: 2, completed_tasks: completed ? 2 : 0, failed_tasks: 0,
        stage: completed ? "READY_FOR_RENDER" : "READY_FOR_GPU_DISPATCH" },
      gpu_transport: "DISABLED_UNQUALIFIED",
      gpu_readiness: gpuReadiness,
      queue: null,
      stages: stageList(completed
        ? { prepare: "COMPLETE", transcription: "COMPLETE", "voiceover-context": "COMPLETE",
          planning: "COMPLETE", "prompt-writing": "COMPLETE", "audio-spanning": "COMPLETE",
          "image-generation": "COMPLETE", "avatar-generation": "COMPLETE", render: "COMPLETE",
          "technical-check": "COMPLETE" }
        : { prepare: "COMPLETE", transcription: "COMPLETE", "voiceover-context": "COMPLETE",
          planning: "COMPLETE", "prompt-writing": "COMPLETE" }),
      time_estimate: {
        remaining_min_ms: completed ? 0 : 120_000,
        remaining_max_ms: completed ? 0 : 300_000,
        basis: "RECENT_API_SHORT_RUN",
        overrun: false,
      },
    });
  }));
  renderHosted(<HostedProjectScreen projectId="estimate-ready" />);
  const hero = await screen.findByRole("region", { name: "Live video progress" });
  const metric = within(hero).getByText("Estimated").closest<HTMLElement>(".metric");
  expect(metric).not.toBeNull();
  await waitFor(() => expect(within(metric!).getByText("Ready")).toBeInTheDocument());
  expect(within(metric!).getByText("ready for review")).toBeInTheDocument();
  expect(screen.queryByText(/Generation is running/u)).not.toBeInTheDocument();
});

it("shows a reasoned disabled Retry for every failed stage without a safe recovery route", async () => {
  const projectId = "11111111-1111-4111-8111-111111111111";
  const stages = stageList(Object.fromEntries([
    "prepare", "transcription", "voiceover-context", "planning", "prompt-writing",
    "audio-spanning", "image-generation", "avatar-generation", "render",
    "technical-check", "review",
  ].map((id) => [id, "FAILED"])));
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({
    project: { id: projectId, title: "Stopped video", created_at: "2026-09-25T05:00:00Z",
      revision_id: "22222222-2222-4222-8222-222222222222", revision_state: "LOCKED" },
    generation_provider: "KIE_FAL",
    attempts: [],
    generation: null,
    gpu_transport: "DISABLED_UNQUALIFIED",
    gpu_readiness: gpuReadiness,
    stages,
  }));
  vi.stubGlobal("fetch", fetchMock);
  renderHosted(<HostedProjectScreen projectId={projectId} />);
  const list = await screen.findByRole("list", { name: "Project stages" });
  const rows = within(list).getAllByRole("listitem");
  expect(rows).toHaveLength(11);
  for (const row of rows) {
    expect(within(row).getByRole("button", { name: "Retry" })).toBeDisabled();
    expect(within(row).getByRole("alert")).toHaveTextContent(/no safe retry|cannot be sent|not authorized|exhausted|outside the verified|No safe retry/i);
  }
  expect(within(stageRow("Generate images")).getByRole("link", { name: "Create a new video" }))
    .toBeVisible();
  expect(fetchMock.mock.calls.every(([, init]) => init?.method !== "POST")).toBe(true);
});

it("offers local render retry for the exact three failed attempts", async () => {
  const projectId = "11111111-1111-4111-8111-111111111111";
  const attempts = [
    { id: "11111111-1111-4111-8111-111111111112", kind: "RENDER", state: "FAILED",
      error_code: "MEDIA_EXECUTION_DISK_SPACE_INSUFFICIENT" },
    { id: "11111111-1111-4111-8111-111111111113", kind: "RENDER", state: "FAILED",
      error_code: "MEDIA_EXECUTION_IO_FAILED" },
    { id: "11111111-1111-4111-8111-111111111114", kind: "RENDER", state: "FAILED",
      error_code: "RENDER_INPUT_INVALID" },
  ];
  const detail = {
    project: { id: projectId, title: "Render recovery", created_at: "2026-09-25T05:00:00Z",
      revision_id: "22222222-2222-4222-8222-222222222222", revision_state: "LOCKED" },
    generation_provider: "KIE_FAL",
    attempts,
    generation: null,
    gpu_transport: "DISABLED_UNQUALIFIED" as const,
    gpu_readiness: gpuReadiness,
    stages: stageList({ render: "FAILED" }),
  };
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith(`/projects/${projectId}/render-retry`)) {
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toMatchObject({ failed_attempt_id: attempts[2]?.id });
      return Response.json({ state: "OUTBOXED" }, { status: 202 });
    }
    return Response.json(detail);
  });
  vi.stubGlobal("fetch", fetchMock);
  renderHosted(<HostedProjectScreen projectId={projectId} />);
  await screen.findByRole("list", { name: "Project stages" });
  const retry = within(stageRow("Assemble final video")).getByRole("button", { name: "Retry" });
  fireEvent.click(retry);
  await waitFor(() => expect(fetchMock.mock.calls.some(([input]) =>
    String(input).endsWith(`/projects/${projectId}/render-retry`))).toBe(true));
  expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/gpu-dispatch"))).toHaveLength(0);
});

it("shows frozen elapsed times in stage rows and the audio spanning panel", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        project: {
          id: "timers",
          title: "Stage timers",
          created_at: "2026-09-15T10:00:00Z",
          revision_id: "revision",
          revision_state: "LOCKED",
        },
        attempts: [],
        generation: null,
        gpu_transport: "DISABLED_UNQUALIFIED",
        gpu_readiness: gpuReadiness,
        stages: [
          {
            id: "transcription",
            name: "Transcribe voiceover",
            status: "SUCCEEDED",
            started_at: "2026-09-15T10:00:00Z",
            completed_at: "2026-09-15T10:02:12Z",
          },
          {
            id: "render",
            name: "Assemble final video",
            status: "FAILED",
            started_at: "2026-09-15T10:10:00Z",
            completed_at: "2026-09-15T10:12:30Z",
          },
          { id: "review", name: "Review and approve", status: "WAITING" },
        ],
        span_audio: {
          total: 4,
          materialized: 4,
          planned: 0,
          running: 0,
          queued: 0,
          succeeded: 4,
          failed: 0,
          started_at: "2026-09-15T10:03:00Z",
          completed_at: "2026-09-15T10:04:01Z",
        },
      }),
    ),
  );
  renderHosted(<HostedProjectScreen projectId="timers" />);
  expect(await screen.findByLabelText("Transcribe voiceover elapsed time")).toHaveTextContent(
    "2m 12s",
  );
  expect(screen.getByLabelText("Assemble final video elapsed time")).toHaveTextContent("2m 30s");
  expect(screen.getByLabelText("Review and approve elapsed time")).toHaveTextContent("—");
  expect(screen.getByLabelText("Span audio elapsed time")).toHaveTextContent("1m 01s");
  expect(screen.getByLabelText("Total elapsed time")).toHaveTextContent("4m 42s");
});

it.each(["KIE_FAL", "RUNPOD"] as const)(
  "%s uses persisted API lane times only for API image and avatar stages",
  async (generationProvider) => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-15T10:02:30Z"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          project: {
            id: "lane-timers",
            title: "Lane timers",
            created_at: "2026-09-15T10:00:00Z",
            revision_id: "revision",
            revision_state: "LOCKED",
          },
          attempts: [],
          generation: null,
          generation_provider: generationProvider,
          cost: generationProvider === "KIE_FAL"
            ? {
                projected_usd: 0.023,
                api_estimate: {
                  kie_images: 2,
                  kie_usd: 0.008,
                  fal_avatar_seconds: 3,
                  fal_usd: 0.015,
                  pricing_checked_at: "2026-09-25",
                },
              }
            : null,
          gpu_transport: "DISABLED_UNQUALIFIED",
          gpu_readiness: gpuReadiness,
          stages: [
            { id: "image-generation", name: "Generate images", status: "SUCCEEDED" },
            { id: "avatar-generation", name: "Generate avatar video", status: "WAITING" },
          ],
          gpu_lanes: [
            {
              lane: "mage_image",
              attempt_state: "SUCCEEDED",
              runtime_state: "SUCCEEDED",
              planned_item_count: 2,
              accepted_item_count: 2,
              attempt_ordinal: null,
              created_at: "2026-09-15T10:00:00Z",
              submitted_at: "2026-09-15T10:00:30Z",
              terminal_at: "2026-09-15T10:02:00Z",
            },
            {
              lane: "soulx_avatar",
              attempt_state: "SUBMITTING",
              runtime_state: "WAITING",
              planned_item_count: 1,
              accepted_item_count: 0,
              attempt_ordinal: null,
              created_at: "2026-09-15T10:01:00Z",
              submitted_at: null,
              terminal_at: null,
            },
          ],
        }),
      ),
    );
    renderHosted(<HostedProjectScreen projectId="lane-timers" />);
    expect(await screen.findByLabelText("Generate images elapsed time")).toHaveTextContent(
      generationProvider === "KIE_FAL" ? "2m 00s" : "—",
    );
    if (generationProvider === "KIE_FAL") {
      expect(screen.getByText("$0.02")).toBeInTheDocument();
      expect(screen.getByText("2 Kie images + 3.0s Fal avatar · published-rate estimate")).toBeInTheDocument();
      expect(screen.getByLabelText("Generate avatar video elapsed time")).toHaveTextContent(
        "1m 30s",
      );
      expect(screen.getByLabelText("Total elapsed time")).toHaveTextContent("3m 30s");
    }
  },
);

it.each(["RUNPOD", "KIE_FAL"] as const)(
  "%s regenerates one accepted image with its edited prompt and refreshes only after acceptance",
  async (generationProvider) => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    const imageTaskId = "33333333-3333-4333-8333-333333333333";
    const requestId = "44444444-4444-4444-8444-444444444444";
    let replacementReady = false;
    let statusReads = 0;
    const detail = () => ({
      project: {
        id: projectId,
        title: "Private project",
        created_at: "2026-09-06T10:00:00.000Z",
        revision_id: "22222222-2222-4222-8222-222222222222",
        revision_state: "LOCKED",
      },
      attempts: [],
      generation_provider: generationProvider,
      gpu_transport: "DISABLED_UNQUALIFIED" as const,
      gpu_readiness: gpuReadiness,
      generation: null,
      stages: [
        {
          id: "image-generation",
          name: "Generate images",
          status: "COMPLETE",
          progress_percent: 100,
        },
      ],
      contact_sheet: [
        {
          id: imageTaskId,
          image_url: replacementReady ? "/replacement.png" : "/original.png",
          prompt: replacementReady ? "Edited image prompt" : "Original image prompt",
          label: "Generated image 1",
        },
      ],
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith(`/images/${imageTaskId}/regenerate`)) {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(body).toMatchObject({
          schema_version: "videoforge-hosted-image-regeneration/v1",
          prompt: "Edited image prompt",
          revision_id: "22222222-2222-4222-8222-222222222222",
        });
        expect(typeof body.idempotency_key).toBe("string");
        return Response.json(
          {
            request_id: requestId,
            attempt_id: "55555555-5555-4555-8555-555555555555",
            state: "QUEUED",
          },
          { status: 202 },
        );
      }
      if (path.endsWith(`/images/${imageTaskId}/regenerate/${requestId}`)) {
        statusReads += 1;
        if (statusReads === 1) return Response.json({ state: "PENDING" });
        replacementReady = true;
        return Response.json({ state: "SUCCEEDED", replacement_url: "/replacement.png" });
      }
      return Response.json(detail());
    });
    vi.stubGlobal("fetch", fetchMock);
    renderHosted(<HostedProjectScreen projectId={projectId} />);

    fireEvent.click(await screen.findByRole("button", { name: "View generated images" }));
    expect(
      screen.getByText(
        generationProvider === "KIE_FAL"
          ? "Regeneration may incur an API charge."
          : "Regeneration costs up to $2.",
      ),
    ).toBeVisible();
    const prompt = screen.getByRole("textbox", { name: "Image prompt" });
    fireEvent.change(prompt, { target: { value: "Edited image prompt" } });
    fireEvent.keyDown(prompt, { key: "Enter" });
    expect(await screen.findByRole("button", { name: "Regenerating…" })).toBeDisabled();
    expect(screen.getByRole("img", { name: "Generated image 1" })).toHaveAttribute(
      "src",
      "/original.png",
    );
    await waitFor(() =>
      expect(screen.getByRole("img", { name: "Generated image 1" })).toHaveAttribute(
        "src",
        "/replacement.png",
      ),
    );
    expect(screen.getByRole("status", { name: "" })).toHaveTextContent("Image regenerated.");
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).endsWith(`/images/${imageTaskId}/regenerate/${requestId}`),
      ),
    ).toBe(true);
  },
);

it("reuses one idempotency key when the regeneration POST response is lost", async () => {
  const projectId = "11111111-1111-4111-8111-111111111111";
  const imageTaskId = "33333333-3333-4333-8333-333333333333";
  const requestId = "44444444-4444-4444-8444-444444444444";
  let postCount = 0;
  let firstKey: unknown;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path.endsWith(`/images/${imageTaskId}/regenerate`)) {
      postCount += 1;
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      firstKey ??= body.idempotency_key;
      expect(body.idempotency_key).toBe(firstKey);
      if (postCount === 1) throw new TypeError("network connection lost");
      return Response.json(
        {
          request_id: requestId,
          attempt_id: "55555555-5555-4555-8555-555555555555",
          state: "QUEUED",
        },
        { status: 202 },
      );
    }
    if (path.endsWith(`/images/${imageTaskId}/regenerate/${requestId}`)) {
      return Response.json({ state: "SUCCEEDED", replacement_url: "/replacement.png" });
    }
    return Response.json({
      project: {
        id: projectId,
        title: "Private project",
        created_at: "2026-09-06T10:00:00.000Z",
        revision_id: "22222222-2222-4222-8222-222222222222",
        revision_state: "LOCKED",
      },
      attempts: [],
      gpu_transport: "DISABLED_UNQUALIFIED" as const,
      gpu_readiness: gpuReadiness,
      generation: null,
      stages: [
        {
          id: "image-generation",
          name: "Generate images",
          status: "COMPLETE",
          progress_percent: 100,
        },
      ],
      contact_sheet: [
        {
          id: imageTaskId,
          image_url: "/original.png",
          prompt: "Original image prompt",
          label: "Generated image 1",
        },
      ],
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  renderHosted(<HostedProjectScreen projectId={projectId} />);

  fireEvent.click(await screen.findByRole("button", { name: "View generated images" }));
  fireEvent.click(screen.getByRole("button", { name: "Regenerate image" }));
  await waitFor(() => expect(screen.getByText("Image regenerated.")).toBeInTheDocument());
  expect(postCount).toBe(2);
});

it("restores an unresolved request after remount and reuses its idempotency key", async () => {
  const projectId = "11111111-1111-4111-8111-111111111111";
  const imageTaskId = "33333333-3333-4333-8333-333333333333";
  const requestId = "44444444-4444-4444-8444-444444444444";
  const editedPrompt = "An edited prompt that survives a page refresh.";
  let postCount = 0;
  const postKeys: unknown[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path.endsWith(`/images/${imageTaskId}/regenerate`)) {
      postCount += 1;
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      postKeys.push(body.idempotency_key);
      if (postCount < 3) throw new TypeError("network connection lost");
      return Response.json(
        {
          request_id: requestId,
          attempt_id: "55555555-5555-4555-8555-555555555555",
          state: "QUEUED",
        },
        { status: 202 },
      );
    }
    if (path.endsWith(`/images/${imageTaskId}/regenerate/${requestId}`)) {
      return Response.json({ state: "SUCCEEDED", replacement_url: "/replacement.png" });
    }
    return Response.json({
      project: {
        id: projectId,
        title: "Private project",
        created_at: "2026-09-06T10:00:00.000Z",
        revision_id: "22222222-2222-4222-8222-222222222222",
        revision_state: "LOCKED",
      },
      attempts: [],
      gpu_transport: "DISABLED_UNQUALIFIED" as const,
      gpu_readiness: gpuReadiness,
      generation: null,
      stages: [
        {
          id: "image-generation",
          name: "Generate images",
          status: "COMPLETE",
          progress_percent: 100,
        },
      ],
      contact_sheet: [
        {
          id: imageTaskId,
          image_url: "/original.png",
          prompt: "Original image prompt",
          label: "Generated image 1",
        },
      ],
    });
  });
  vi.stubGlobal("fetch", fetchMock);

  const first = renderHosted(<HostedProjectScreen projectId={projectId} />);
  fireEvent.click(await screen.findByRole("button", { name: "View generated images" }));
  const firstPrompt = screen.getByRole("textbox", { name: "Image prompt" });
  fireEvent.change(firstPrompt, { target: { value: editedPrompt } });
  fireEvent.click(screen.getByRole("button", { name: "Regenerate image" }));
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent("could not be confirmed"),
  );
  expect(postCount).toBe(2);
  expect(postKeys[0]).toBe(postKeys[1]);

  first.unmount();
  renderHosted(<HostedProjectScreen projectId={projectId} />);
  fireEvent.click(await screen.findByRole("button", { name: "View generated images" }));
  expect(screen.getByRole("textbox", { name: "Image prompt" })).toHaveValue(editedPrompt);
  fireEvent.click(screen.getByRole("button", { name: "Regenerate image" }));
  await waitFor(() => expect(screen.getByText("Image regenerated.")).toBeInTheDocument());
  expect(postCount).toBe(3);
  expect(postKeys[2]).toBe(postKeys[0]);
});

it("keeps an uncertain Kie regeneration identity and blocks another submission", async () => {
  const projectId = "11111111-1111-4111-8111-111111111111";
  const revisionId = "22222222-2222-4222-8222-222222222222";
  const imageTaskId = "33333333-3333-4333-8333-333333333333";
  const requestId = "44444444-4444-4444-8444-444444444444";
  let postCount = 0;
  let statusCount = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith(`/images/${imageTaskId}/regenerate`)) {
        postCount += 1;
        return Response.json(
          { request_id: requestId, attempt_id: requestId, state: "QUEUED" },
          { status: 202 },
        );
      }
      if (path.endsWith(`/images/${imageTaskId}/regenerate/${requestId}`)) {
        statusCount += 1;
        return Response.json({
          request_id: requestId,
          attempt_id: requestId,
          state: "ACTION_REQUIRED",
          error_code: "UNKNOWN_NO_RETRY",
        });
      }
      return Response.json({
        project: {
          id: projectId,
          title: "Private project",
          created_at: "2026-09-06T10:00:00.000Z",
          revision_id: revisionId,
          revision_state: "LOCKED",
        },
        attempts: [],
        generation_provider: "KIE_FAL",
        gpu_transport: "DISABLED_UNQUALIFIED",
        gpu_readiness: gpuReadiness,
        generation: null,
        stages: [
          {
            id: "image-generation",
            name: "Generate images",
            status: "COMPLETE",
            progress_percent: 100,
          },
        ],
        contact_sheet: [
          { id: imageTaskId, image_url: "/original.png", prompt: "Original image prompt" },
        ],
      });
    }),
  );

  const first = renderHosted(<HostedProjectScreen projectId={projectId} />);
  fireEvent.click(await screen.findByRole("button", { name: "View generated images" }));
  fireEvent.click(screen.getByRole("button", { name: "Regenerate image" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("provider result is unconfirmed");
  expect(screen.getByRole("alert")).toHaveTextContent("will not be submitted again automatically");
  expect(
    screen.getByText(
      "Refresh the project to check this request. Do not submit another image request.",
    ),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "Regenerate image" })).toBeDisabled();
  expect(postCount).toBe(1);
  expect(statusCount).toBe(1);
  expect(
    JSON.parse(
      window.sessionStorage.getItem(
        `videoforge.hosted-image-regeneration.v1:${projectId}:${revisionId}:${imageTaskId}`,
      ) ?? "null",
    ),
  ).toMatchObject({ requestId });

  first.unmount();
  renderHosted(<HostedProjectScreen projectId={projectId} />);
  fireEvent.click(await screen.findByRole("button", { name: "View generated images" }));
  fireEvent.click(screen.getByRole("button", { name: "Regenerate image" }));
  await waitFor(() => expect(statusCount).toBe(2));
  expect(postCount).toBe(1);
});

afterEach(() => {
  cleanup();
  focusManager.setFocused(undefined);
  window.sessionStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  routerState.navigate.mockReset();
});

const gpuReadiness = {
  schema_version: "videoforge-hosted-gpu-readiness/v1" as const,
  gpu_transport: "DISABLED_UNQUALIFIED" as const,
  provider_calls_authorized: false as const,
  dispatch_available: false as const,
  lanes: [
    {
      lane: "MAGE_IMAGE" as const,
      checkpoint: "V2-07" as const,
      qualification: "NOT_QUALIFIED" as const,
      visual_approval: "NOT_APPLICABLE" as const,
      provider_free_groundwork_commits: ["1283a23248c9b79832b6fb331b00474e1df70f81"],
      missing_gates: ["identity_output", "cancellation_timeout", "max2_concurrency"],
    },
    {
      lane: "SOULX_AVATAR" as const,
      checkpoint: "V2-08" as const,
      qualification: "NOT_QUALIFIED" as const,
      visual_approval: "APPROVED_EXACT_FULL_AND_SPLIT" as const,
      provider_free_groundwork_commits: [
        "7039092707103ab35e8010c009e14409a6e52f63",
        "84e00881d98e3e77dd8aad121453ed6e7287bc74",
        "e49b93854d58c4faeb8bdd10b9b9df07321026db",
        "f3557059d7d5f0637ea223b3e758389fbd80a52b",
      ],
      missing_gates: [
        "V2_07_MAGE_QUALIFICATION",
        "V2_08_IMAGE_PUBLICATION_AND_ENDPOINT_CONFIGURATION",
        "V2_08_MAX1_LIVE_QUALIFICATION",
      ],
    },
  ] as const,
};

const qualifiedGpuReadiness = {
  ...gpuReadiness,
  gpu_transport: "QUALIFIED_EXACT" as const,
  provider_calls_authorized: true as const,
  dispatch_available: true as const,
  lanes: gpuReadiness.lanes.map((lane) => ({
    ...lane,
    qualification: "QUALIFIED_EXACT" as const,
    missing_gates: [] as const,
  })),
};

describe("hosted product errors", () => {
  it("maps insufficient disk space to safe local cleanup guidance without a worker update", () => {
    const code = "MEDIA_EXECUTION_DISK_SPACE_INSUFFICIENT";
    const message = transcriptionFailureMessage(code);

    expect(message).toBe(
      "Your project and voiceover are safe. Free disk space on your connected computer before retrying transcription.",
    );
    expect(message).not.toContain(code);
    expect(message).not.toMatch(/update/i);
    expect(message.length).toBeLessThan(240);
  });

  it.each([
    [
      "MEDIA_EXECUTION_IO_FAILED",
      "The local media worker could not read or save the transcription data. Free disk space and update the personal media worker before retrying.",
    ],
    [
      "MEDIA_EXECUTION_CONTRACT_INVALID",
      "The local media worker returned an invalid transcription result. Update the personal media worker before retrying.",
    ],
    [
      "ASR_RESULT_INVALID",
      "The local media worker returned an invalid transcription result. Update the personal media worker before retrying.",
    ],
  ])("maps %s to a bounded actionable transcription message", (code, message) => {
    expect(transcriptionFailureMessage(code)).toBe(message);
    expect(message).not.toContain(code);
    expect(message.length).toBeLessThan(240);
  });

  it("shows the safe duplicate-style message instead of its internal code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            error: {
              code: "STYLE_NAME_CONFLICT",
              message: "That style name is already in use. Choose a different name.",
            },
          },
          { status: 409 },
        ),
      ),
    );

    await expect(readJson("/api/v2/hosted/styles", { method: "POST", body: "{}" })).rejects.toThrow(
      "That style name is already in use. Choose a different name.",
    );
  });

  it("turns a legacy project-title conflict code into an actionable message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: { code: "PROJECT_TITLE_CONFLICT" } }, { status: 409 }),
      ),
    );

    await expect(
      readJson("/api/v2/hosted/projects", { method: "POST", body: "{}" }),
    ).rejects.toThrow(
      "Another active project already uses this title. Open Progress to continue that project or delete it, or choose a different title.",
    );
  });
});

describe("hosted browser security boundaries", () => {
  const origin = "https://videoforge.example";

  it("normalizes a same-origin internal return path with query and hash", () => {
    expect(
      normalizeHostedReturnTo("/projects/../review?project=private#output", "/projects", origin),
    ).toBe("/review?project=private#output");
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,unsafe",
    "https://attacker.example/phish",
    "//attacker.example/phish",
    "///attacker.example/phish",
    "\\\\attacker.example\\phish",
    "/safe\\attacker",
    "/%5c%5cattacker.example",
    "/safe\nheader",
    "/safe%0d%0aheader",
  ])("rejects unsafe return target %s", (value) => {
    expect(normalizeHostedReturnTo(value, "/avatars", origin)).toBe("/avatars");
  });

  it("hashes the exact file bytes with incremental SHA-256", async () => {
    await expect(
      hostedFileSha256(new File(["abc"], "voiceover.mp3", { type: "audio/mpeg" })),
    ).resolves.toBe("sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("maps an overlong local voiceover name to one stable server-safe filename", () => {
    const checksum = `sha256:${"a".repeat(64)}`;
    expect(
      hostedVoiceoverFilename(`${"long-export-name-".repeat(15)}.mp3`, "audio/mpeg", checksum),
    ).toBe("voiceover-aaaaaaaaaaaaaaaa.mp3");
    expect(hostedVoiceoverFilename("voiceover.wav", "audio/wav", checksum)).toBe("voiceover.wav");
  });

  it("bounds a declared 1 GiB file read to one fixed-size slice when cancelled", async () => {
    const controller = new AbortController();
    const ranges: [number, number][] = [];
    const wholeFileRead = vi.fn();
    const syntheticFile = {
      size: 1_073_741_824,
      arrayBuffer: wholeFileRead,
      slice(start = 0, end = 1_073_741_824) {
        ranges.push([start, end]);
        return { size: end - start } as Blob;
      },
    } as unknown as Blob;

    await expect(
      hostedFileSha256(syntheticFile, {
        signal: controller.signal,
        readChunk: async (chunk) => {
          controller.abort();
          return new ArrayBuffer(chunk.size);
        },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(ranges).toEqual([[0, HOSTED_SHA256_CHUNK_BYTES]]);
    expect(wholeFileRead).not.toHaveBeenCalled();
  });
});

describe("hosted product journey", () => {
  it("keeps cost and blocker diagnostics user-facing", () => {
    expect(
      hostedPreflightEstimateText(
        {
          projected_usd: null,
          cap_usd: 1,
          detail: "GPU_TRANSPORT_DISABLED_UNQUALIFIED internal lane detail",
        },
        true,
      ),
    ).toBe("Estimate pending");
    expect(hostedPreflightEstimateText({ projected_usd: 0.73, cap_usd: null }, true)).toBe(
      "Estimated variable cost $0.73",
    );
    expect(hostedPreflightEstimateText({ projected_usd: 0.73 }, false)).toBe(
      "No paid video generation in this beta",
    );
    expect(
      preflightBlockers({
        blockers: [
          {
            code: "MEDIA_WORKER_OFFLINE",
            severity: "BLOCKING",
            message: "Connect your personal media worker before generating.",
          },
          {
            code: "GPU_TRANSPORT_DISABLED_UNQUALIFIED",
            severity: "ADVISORY",
            message: "Internal GPU advisory.",
          },
        ],
      }),
    ).toEqual(["Connect your personal media worker before generating."]);
  });

  it("accepts only the exact closed-world hosted GPU readiness payload", () => {
    expect(isFailClosedGpuReadiness(gpuReadiness)).toBe(true);
    expect(
      isFailClosedGpuReadiness({
        ...gpuReadiness,
        gpu_transport: "QUALIFIED_EXACT",
        provider_calls_authorized: true,
        dispatch_available: true,
        lanes: gpuReadiness.lanes.map((lane) => ({
          ...lane,
          qualification: "QUALIFIED_EXACT",
          missing_gates: [],
        })),
      }),
    ).toBe(true);

    const variants: unknown[] = [
      { ...gpuReadiness, dispatch_available: true },
      { ...gpuReadiness, gpu_transport: "QUALIFIED_EXACT" },
      { ...gpuReadiness, extra: "unexpected" },
      { ...gpuReadiness, schema_version: "videoforge-hosted-gpu-readiness/v0" },
      { ...gpuReadiness, lanes: [...gpuReadiness.lanes].reverse() },
      {
        ...gpuReadiness,
        lanes: [{ ...gpuReadiness.lanes[0], qualification: "QUALIFIED" }, gpuReadiness.lanes[1]],
      },
      {
        ...gpuReadiness,
        lanes: [
          {
            ...gpuReadiness.lanes[0],
            missing_gates: [...gpuReadiness.lanes[0].missing_gates, "unknown_gate"],
          },
          gpuReadiness.lanes[1],
        ],
      },
      {
        ...gpuReadiness,
        lanes: [
          gpuReadiness.lanes[0],
          {
            ...gpuReadiness.lanes[1],
            provider_free_groundwork_commits: [
              ...gpuReadiness.lanes[1].provider_free_groundwork_commits.slice(1),
              gpuReadiness.lanes[1].provider_free_groundwork_commits[0],
            ],
          },
        ],
      },
      {
        ...gpuReadiness,
        lanes: [gpuReadiness.lanes[0], { ...gpuReadiness.lanes[1], endpoint_id: "forbidden" }],
      },
    ];

    for (const variant of variants) expect(isFailClosedGpuReadiness(variant)).toBe(false);
  });

  it("reads WAV duration from the uploaded container before browser media events", async () => {
    const bytes = new ArrayBuffer(44 + 640_000);
    const view = new DataView(bytes);
    const write = (offset: number, value: string) =>
      [...value].forEach((character, index) =>
        view.setUint8(offset + index, character.charCodeAt(0)),
      );
    write(0, "RIFF");
    view.setUint32(4, bytes.byteLength - 8, true);
    write(8, "WAVE");
    write(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 16_000, true);
    view.setUint32(28, 32_000, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    write(36, "data");
    view.setUint32(40, 640_000, true);

    expect(parseWavDurationMs(bytes)).toBe(20_000);
  });

  it("reads uploaded WAV bytes through the browser FileReader path", async () => {
    const bytes = new ArrayBuffer(44 + 640_000);
    const view = new DataView(bytes);
    const write = (offset: number, value: string) =>
      [...value].forEach((character, index) =>
        view.setUint8(offset + index, character.charCodeAt(0)),
      );
    write(0, "RIFF");
    view.setUint32(4, bytes.byteLength - 8, true);
    write(8, "WAVE");
    write(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint32(24, 16_000, true);
    view.setUint32(28, 32_000, true);
    write(36, "data");
    view.setUint32(40, 640_000, true);

    await expect(
      audioDurationMs(new File([bytes], "voiceover.wav", { type: "audio/wav" })),
    ).resolves.toBe(20_000);
  });

  it("flags a custom avatar that cannot produce avatar video, and leaves a qualified one unmarked", async () => {
    const catalogFor = (avatar: Record<string, unknown>) => ({
      avatars: [avatar],
      styles: [{ style_id: "s1", version_id: "sv1", name: "Documentary", version_number: 1 }],
      media_worker_state: "ONLINE",
      gpu_transport: "DISABLED_UNQUALIFIED",
      gpu_readiness: gpuReadiness,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          catalogFor({
            profile_id: "p-helen",
            version_id: "a-helen",
            name: "helen",
            version_number: 1,
            state: "READY",
            status: "ACTIVE",
            rights_status: "ATTESTED",
            avatar_video_source_ready: false,
          }),
        ),
      ),
    );
    const custom = renderHosted(<HostedCreateProjectScreen />);
    // Assert on the rendered text rather than one node: the picker remounts when the catalog settles.
    await waitFor(() =>
      expect(document.body.textContent ?? "").toContain("Version 1 · no avatar video yet"),
    );
    custom.unmount();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          catalogFor({
            profile_id: "p-system",
            version_id: "a-system",
            name: "V2-09 qualified SoulX avatar (system copy)",
            version_number: 1,
            state: "READY",
            status: "ACTIVE",
            rights_status: "ATTESTED",
            avatar_video_source_ready: true,
          }),
        ),
      ),
    );
    renderHosted(<HostedCreateProjectScreen />);
    await waitFor(() =>
      expect(document.body.textContent ?? "").toContain(
        "V2-09 qualified SoulX avatar (system copy)",
      ),
    );
    expect(document.body.textContent ?? "").not.toContain("no avatar video yet");
  });

  it("explains the Chrome file-access prerequisite when the chooser yields no file", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          avatars: [{ profile_id: "p1", version_id: "a1", name: "Owner", version_number: 1 }],
          styles: [{ style_id: "s1", version_id: "sv1", name: "Documentary", version_number: 1 }],
          media_worker_state: "ONLINE",
          gpu_transport: "DISABLED_UNQUALIFIED",
          gpu_readiness: gpuReadiness,
        }),
      ),
    );
    renderHosted(<HostedCreateProjectScreen />);

    const input = await screen.findByLabelText("Final voiceover");
    fireEvent.change(input, { target: { files: [] } });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /Chrome could not read the selected file/u,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/Allow access to file URLs/u);
  });

  it("loads the tenant-owned avatar and style catalog without fixture API calls", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (!String(input).endsWith("/api/v2/hosted/project-catalog")) {
        throw new Error(`Unexpected hosted request: ${String(input)}`);
      }
      return Response.json({
        avatars: [
          {
            profile_id: "p1",
            version_id: "a1",
            name: "Owner",
            version_number: 1,
            state: "READY",
            status: "ACTIVE",
            thumbnail_url: "/api/v2/hosted/avatars/a1/preview",
            profile_hash: "sha256:private-avatar-hash",
            rights_status: "ATTESTED",
          },
        ],
        styles: [
          {
            style_id: "s1",
            version_id: "sv1",
            name: "Documentary",
            version_number: 1,
            state: "PUBLISHED",
            status: "ACTIVE",
            cover_url: "/api/v2/hosted/styles/sv1/preview",
            profile_hash: "sha256:private-style-hash",
            reference_count: 3,
            reference_urls: [
              "/api/v2/hosted/styles/sv1/preview?reference=1",
              "/api/v2/hosted/styles/sv1/preview?reference=2",
              "/api/v2/hosted/styles/sv1/preview?reference=3",
            ],
            profile: {
              schema_version: "image-style-profile/v1",
              summary: "Clean commercial photography with tactile retail detail.",
              visual_profile: {
                medium_family: "commercial digital photography",
                realism: "high fidelity and naturalistic",
                subject_treatment: "polished but approachable",
                camera_language: "eye-level observational framing",
                image_framing: "balanced retail compositions",
                lighting: "soft naturalistic retail light",
                color: {
                  descriptors: ["cool neutral", "restrained saturation"],
                  approximate_hex: ["#D8D7D2", "#526174"],
                },
                contrast_and_exposure: "controlled highlights and open shadows",
                depth_of_field: "moderate subject separation",
                texture_and_grain: "sharp textile texture with minimal grain",
                environment_and_material_detail: "tactile fabric and clean fixtures",
                mood: ["polished", "approachable"],
                must_include: ["tactile material detail"],
                must_avoid: ["plastic-looking surfaces"],
                flexible_properties: ["subject placement"],
              },
              prompt_profile: {
                positive_suffix: "commercial realism, tactile textile detail",
                negative_suffix: "plastic surfaces, oversaturated color",
              },
            },
          },
        ],
        media_worker_state: "ONLINE",
        gpu_transport: "DISABLED_UNQUALIFIED",
        gpu_readiness: gpuReadiness,
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderHosted(
      <>
        <HostedAvatarHubScreen />
        <HostedStylesHubScreen />
      </>,
    );

    expect(await screen.findByText("Owner")).toBeInTheDocument();
    expect(await screen.findByText("Documentary")).toBeInTheDocument();
    expect(screen.getByAltText("Owner presenter")).toHaveAttribute(
      "src",
      "/api/v2/hosted/avatars/a1/preview",
    );
    expect(screen.getByAltText("Documentary cover")).toHaveAttribute(
      "src",
      "/api/v2/hosted/styles/sv1/preview",
    );
    const styleCard = screen.getByRole("heading", { name: "Documentary" }).closest("article");
    expect(styleCard).not.toBeNull();
    fireEvent.click(within(styleCard!).getByRole("button", { name: "Details" }));
    expect(screen.getByAltText("Documentary reference 1 of 3")).toHaveAttribute(
      "src",
      "/api/v2/hosted/styles/sv1/preview?reference=1",
    );
    expect(screen.getByText("1 of 3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next reference image" }));
    expect(screen.getByAltText("Documentary reference 2 of 3")).toHaveAttribute(
      "src",
      "/api/v2/hosted/styles/sv1/preview?reference=2",
    );
    expect(screen.getByText("2 of 3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Previous reference image" }));
    expect(screen.getByAltText("Documentary reference 1 of 3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Previous reference image" }));
    expect(screen.getByAltText("Documentary reference 3 of 3")).toBeInTheDocument();
    expect(screen.getByText("Analysis")).toBeInTheDocument();
    expect(
      screen.getByText("Clean commercial photography with tactile retail detail."),
    ).toBeInTheDocument();
    expect(screen.getByText("Visual character")).toBeInTheDocument();
    expect(screen.getByText("commercial digital photography")).toBeInTheDocument();
    expect(screen.getByText("Generation rules")).toBeInTheDocument();
    expect(screen.getByText("tactile material detail")).toBeInTheDocument();
    expect(screen.queryByText(/sha256:private-style-hash/u)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close details" }));
    expect(screen.getAllByRole("searchbox")).toHaveLength(2);
    expect(screen.queryByText(/Private hosted staging/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/Tenant-private catalog/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/Use this catalog in a project/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/sha256:private/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/a1|sv1/u)).not.toBeInTheDocument();
    expect(screen.queryByText("ACTIVE")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      fetchMock.mock.calls.every(([input]) =>
        String(input).endsWith("/api/v2/hosted/project-catalog"),
      ),
    ).toBe(true);
  });

  it("fails closed with an explicit activation message when the hosted catalog is empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          avatars: [],
          styles: [],
          media_worker_state: "ONLINE",
          gpu_transport: "DISABLED_UNQUALIFIED",
          gpu_readiness: gpuReadiness,
        }),
      ),
    );
    renderHosted(<HostedAvatarHubScreen />);

    expect(await screen.findByText("No ready avatars yet")).toBeInTheDocument();
    expect(screen.getByText(/Add a reusable avatar to use in a project/u)).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Create your first avatar" }),
    ).not.toBeInTheDocument();
  });

  it("uses a deliberate cover and plain Details action when a published style has no references", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          avatars: [],
          styles: [
            {
              style_id: "s1",
              version_id: "sv1",
              name: "Documentary",
              version_number: 1,
              state: "PUBLISHED",
              cover_url: null,
              reference_count: 0,
            },
          ],
          media_worker_state: "ONLINE",
          gpu_transport: "DISABLED_UNQUALIFIED",
          gpu_readiness: gpuReadiness,
        }),
      ),
    );
    renderHosted(<HostedStylesHubScreen />);

    expect(await screen.findByRole("img", { name: "Documentary cover unavailable" })).toHaveClass(
      "hosted-style-placeholder",
    );
    expect(screen.getByRole("button", { name: "Details" })).toBeInTheDocument();
    expect(screen.queryByText(/References \(0\)/u)).not.toBeInTheDocument();
  });

  it("shows unfinished avatar and style drafts with friendly resume and remove actions", async () => {
    let removedStyle = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/api/v2/hosted/project-catalog")) {
        return Response.json({
          avatars: [],
          avatar_drafts: [
            {
              profile_id: "draft-avatar-profile-id",
              version_id: "draft-avatar-version-id",
              name: "Saved presenter",
              version_number: 1,
              state: "NEEDS_REVIEW",
              scope_kind: "WORKSPACE",
              profile_hash: "sha256:private-avatar-draft",
            },
            {
              profile_id: "incomplete-avatar-profile-id",
              version_id: "incomplete-avatar-version-id",
              name: "Incomplete upload",
              version_number: 1,
              state: "DRAFT",
              scope_kind: "WORKSPACE",
              source_verified: false,
            },
          ],
          styles: [],
          style_drafts: removedStyle
            ? []
            : [
                {
                  style_id: "draft-style-id",
                  version_id: "draft-style-version-id",
                  name: "Will Carter",
                  version_number: 1,
                  state: "DRAFT",
                  scope_kind: "WORKSPACE",
                  reference_count: 7,
                  references_verified: true,
                  profile_hash: "sha256:private-style-draft",
                },
                {
                  style_id: "analyzing-style-id",
                  version_id: "analyzing-style-version-id",
                  name: "Analysis running",
                  version_number: 1,
                  state: "ANALYZING",
                  analysis_state: "UNKNOWN",
                  scope_kind: "WORKSPACE",
                },
                {
                  style_id: "failed-style-id",
                  version_id: "failed-style-version-id",
                  name: "Failed style",
                  version_number: 1,
                  state: "FAILED",
                  scope_kind: "WORKSPACE",
                },
              ],
          media_worker_state: "ONLINE",
          gpu_transport: "DISABLED_UNQUALIFIED",
          gpu_readiness: gpuReadiness,
        });
      }
      if (init?.method === "DELETE") {
        expect(path).toBe("/api/v2/hosted/styles/draft-style-version-id");
        removedStyle = true;
        return Response.json({ state: "ARCHIVED" });
      }
      throw new Error(`Unexpected hosted request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderHosted(
      <>
        <HostedAvatarHubScreen />
        <HostedStylesHubScreen />
      </>,
    );

    expect(await screen.findByText("Saved presenter")).toBeInTheDocument();
    expect(await screen.findByText("Will Carter")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "Continue setup" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "Continue setup" })).toHaveLength(4);
    expect(screen.getByText("Photo saved. Continue setup.")).toBeInTheDocument();
    expect(screen.getByText("7 references saved.")).toBeInTheDocument();
    expect(screen.getByText("Analysis result unconfirmed")).toBeInTheDocument();
    expect(screen.getByText("Analysis stopped. No automatic retry.")).toBeInTheDocument();
    expect(
      screen.getByText("Analysis failed. References saved; retry from this draft."),
    ).toBeInTheDocument();
    const styleResumeLink = screen
      .getAllByRole("link", { name: "Continue setup" })
      .find((link) => link.getAttribute("href")?.startsWith("/styles/new"));
    expect(styleResumeLink).toHaveAttribute(
      "href",
      "/styles/new?resumeVersionId=draft-style-version-id&returnTo=%2Fstyles",
    );
    expect(
      screen.queryByText(/draft-(?:style|avatar)-(?:id|version-id)|sha256:/u),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Remove style" })[0]!);
    await waitFor(() => expect(screen.queryByText("Will Carter")).not.toBeInTheDocument());
  });

  it.each([
    ["DRAFT", "Analyze"],
    ["FAILED", "Analyze"],
    ["NEEDS_REVIEW", "Publish"],
  ] as const)("resumes a saved style in the correct wizard step (%s)", async (state, heading) => {
    window.history.replaceState({}, "", `/styles/new?resumeVersionId=resume-style-version`);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          avatars: [],
          styles: [],
          style_drafts: [
            {
              style_id: "resume-style-id",
              version_id: "resume-style-version",
              name: "Saved documentary",
              version_number: 2,
              state,
              scope_kind: "WORKSPACE",
              reference_count: 4,
              references_verified: true,
              rights_attested: true,
              processing_disclosure_acknowledged: true,
              original_retention_policy: "RETAIN",
              profile:
                state === "NEEDS_REVIEW"
                  ? { summary: "Natural available light and tactile detail." }
                  : null,
            },
          ],
          media_worker_state: "ONLINE",
          gpu_transport: "DISABLED_UNQUALIFIED",
          gpu_readiness: gpuReadiness,
        }),
      ),
    );
    renderHosted(<HostedPresetCreationScreen kind="styles" />);

    expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
    expect(screen.getByText("Continuing “Saved documentary”")).toBeInTheDocument();
    expect(screen.queryByLabelText("Upload style references")).not.toBeInTheDocument();
    if (state === "DRAFT") {
      expect(screen.getByRole("button", { name: "Analyze once" })).toBeEnabled();
    } else if (state === "FAILED") {
      expect(screen.getByRole("button", { name: "Retry analysis" })).toBeEnabled();
    } else {
      expect(screen.getByRole("button", { name: "Publish style" })).toBeEnabled();
      expect(screen.queryByLabelText("Profile reviewed")).not.toBeInTheDocument();
    }
    window.history.replaceState({}, "", "/");
  });

  it("repairs a resumed style with replacement uploads before analysis", async () => {
    window.history.replaceState({}, "", "/styles/new?resumeVersionId=resume-unverified-style");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/api/v2/hosted/project-catalog")) {
        return Response.json({
          avatars: [],
          styles: [],
          style_drafts: [
            {
              style_id: "resume-style-id",
              version_id: "resume-unverified-style",
              name: "Will Carter",
              version_number: 1,
              state: "DRAFT",
              scope_kind: "WORKSPACE",
              reference_count: 7,
              references_verified: false,
              rights_attested: true,
              processing_disclosure_acknowledged: true,
              original_retention_policy: "RETAIN",
            },
          ],
          media_worker_state: "ONLINE",
          gpu_transport: "DISABLED_UNQUALIFIED",
          gpu_readiness: gpuReadiness,
        });
      }
      if (path.endsWith("/api/v2/hosted/styles/resume-unverified-style/references/retry")) {
        expect(init?.method).toBe("POST");
        expect(init?.headers).toMatchObject({ "idempotency-key": expect.any(String) });
        const body = JSON.parse(String(init?.body));
        expect(body).toMatchObject({
          schema_version: "videoforge-hosted-style-reference-replace/v1",
        });
        expect(body.references).toHaveLength(3);
        return Response.json({
          style_id: "resume-style-id",
          version_id: "repaired-style-version",
          state: "DRAFT",
          uploads: [
            { url: "https://upload.test/original-1" },
            { url: "https://upload.test/original-2" },
            { url: "https://upload.test/original-3" },
          ],
          normalized_uploads: [
            { url: "https://upload.test/normalized-1" },
            { url: "https://upload.test/normalized-2" },
            { url: "https://upload.test/normalized-3" },
          ],
        });
      }
      if (path.endsWith("/api/v2/hosted/styles/repaired-style-version/commit")) {
        expect(init).toMatchObject({ method: "POST", body: "{}" });
        return Response.json({
          style_id: "resume-style-id",
          version_id: "repaired-style-version",
          state: "DRAFT",
        });
      }
      if (init?.method === "PUT") return new Response(null, { status: 200 });
      throw new Error("Unexpected hosted request: " + path);
    });
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: () => undefined,
    });
    renderHosted(<HostedPresetCreationScreen kind="styles" />);

    expect(await screen.findByText("Continuing “Will Carter”")).toBeInTheDocument();
    expect(screen.getByText("Select 3–8 replacement images.")).toBeInTheDocument();
    const references = [
      new File(["reference one"], "reference-one.png", { type: "image/png" }),
      new File(["reference two"], "reference-two.png", { type: "image/png" }),
      new File(["reference three"], "reference-three.png", { type: "image/png" }),
    ];
    fireEvent.change(screen.getByLabelText("Upload style references"), {
      target: { files: references },
    });
    expect(await screen.findByText("3 references selected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Review replacement references" }));
    expect(await screen.findByRole("heading", { name: "Review" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save replacement references" }));

    expect(await screen.findByRole("heading", { name: "Analyze" })).toBeInTheDocument();
    const writePaths = fetchMock.mock.calls
      .filter(([, init]) => init?.method === "POST")
      .map(([input]) => String(input));
    expect(writePaths).toEqual([
      "/api/v2/hosted/styles/resume-unverified-style/references/retry",
      "/api/v2/hosted/styles/repaired-style-version/commit",
    ]);
    expect(writePaths.some((path) => path.endsWith("/analyze"))).toBe(false);
    window.history.replaceState({}, "", "/");
  });

  it("offers the saved repair path for an unfinished duplicate style", async () => {
    window.history.replaceState({}, "", "/styles/new");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          avatars: [],
          styles: [],
          style_drafts: [
            {
              style_id: "unfinished-style-id",
              version_id: "unfinished-style-version",
              name: "Will Carter",
              version_number: 1,
              state: "DRAFT",
              scope_kind: "WORKSPACE",
              references_verified: false,
              reference_count: 3,
            },
          ],
          media_worker_state: "ONLINE",
          gpu_transport: "DISABLED_UNQUALIFIED",
          gpu_readiness: gpuReadiness,
        }),
      ),
    );
    renderHosted(<HostedPresetCreationScreen kind="styles" />);

    fireEvent.change(await screen.findByLabelText("Style name"), {
      target: { value: "Will Carter" },
    });
    expect(screen.getByText("Draft already exists. Continue from the Hub.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continue setup" })).toHaveAttribute(
      "href",
      "/styles/new?resumeVersionId=unfinished-style-version&returnTo=%2Fstyles",
    );
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    window.history.replaceState({}, "", "/");
  });

  it("deletes a workspace avatar from its card while protecting system avatars", async () => {
    let removed = false;
    let catalogLoads = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/api/v2/hosted/project-catalog")) {
        catalogLoads += 1;
        return Response.json({
          avatars: removed
            ? [
                {
                  profile_id: "system-profile",
                  version_id: "system-version",
                  name: "Built-in presenter",
                  version_number: 1,
                  state: "READY",
                  scope_kind: "SYSTEM",
                  rights_status: "SYSTEM_OWNED",
                },
              ]
            : [
                {
                  profile_id: "workspace-profile",
                  version_id: "workspace-version",
                  name: "Workspace presenter",
                  version_number: 1,
                  state: "READY",
                  scope_kind: "WORKSPACE",
                  thumbnail_url: "/api/v2/hosted/avatars/workspace-version/preview",
                },
                {
                  profile_id: "system-profile",
                  version_id: "system-version",
                  name: "Built-in presenter",
                  version_number: 1,
                  state: "READY",
                  scope_kind: "SYSTEM",
                  rights_status: "SYSTEM_OWNED",
                },
              ],
          styles: [],
          media_worker_state: "ONLINE",
          gpu_transport: "DISABLED_UNQUALIFIED",
          gpu_readiness: gpuReadiness,
        });
      }
      if (init?.method === "DELETE") {
        expect(path).toBe("/api/v2/hosted/avatars/workspace-profile");
        removed = true;
        return Response.json({ state: "ARCHIVED" });
      }
      throw new Error(`Unexpected hosted request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderHosted(<HostedAvatarHubScreen />);

    expect(await screen.findByText("Workspace presenter")).toBeInTheDocument();
    // The destructive action is available on the card without opening Details.
    const removeAvatar = screen.getByRole("button", { name: "Remove avatar" });
    expect(screen.getAllByRole("button", { name: "Details" })).toHaveLength(2);
    expect(
      screen.queryByRole("button", { name: "Remove built-in avatar" }),
    ).not.toBeInTheDocument();

    fireEvent.click(removeAvatar);
    expect(confirm).toHaveBeenCalledWith(
      "Remove this avatar from your Avatar Hub? Existing projects will keep their pinned version.",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);

    confirm.mockReturnValue(true);
    fireEvent.click(removeAvatar);
    await waitFor(() => expect(screen.queryByText("Workspace presenter")).not.toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v2/hosted/avatars/workspace-profile",
      expect.objectContaining({ method: "DELETE", body: "{}" }),
    );
    expect(catalogLoads).toBe(2);
    expect(screen.getByText("Built-in presenter")).toBeInTheDocument();
  });

  it("deletes a workspace style from its card while protecting system styles", async () => {
    let removed = false;
    let catalogLoads = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/api/v2/hosted/project-catalog")) {
        catalogLoads += 1;
        return Response.json({
          avatars: [],
          styles: removed
            ? [
                {
                  style_id: "system-style",
                  version_id: "system-style-version",
                  name: "Built-in style",
                  version_number: 1,
                  state: "PUBLISHED",
                  scope_kind: "SYSTEM",
                  reference_count: 0,
                },
              ]
            : [
                {
                  style_id: "workspace-style",
                  version_id: "workspace-style-version",
                  name: "Workspace style",
                  version_number: 1,
                  state: "PUBLISHED",
                  scope_kind: "WORKSPACE",
                  reference_count: 3,
                },
                {
                  style_id: "system-style",
                  version_id: "system-style-version",
                  name: "Built-in style",
                  version_number: 1,
                  state: "PUBLISHED",
                  scope_kind: "SYSTEM",
                  reference_count: 0,
                },
              ],
          media_worker_state: "ONLINE",
          gpu_transport: "DISABLED_UNQUALIFIED",
          gpu_readiness: gpuReadiness,
        });
      }
      if (init?.method === "DELETE") {
        expect(path).toBe("/api/v2/hosted/styles/workspace-style");
        removed = true;
        return Response.json({ state: "ARCHIVED" });
      }
      throw new Error(`Unexpected hosted request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderHosted(<HostedStylesHubScreen />);

    expect(await screen.findByText("Workspace style")).toBeInTheDocument();
    // The destructive action is available on the card without opening Details.
    const removeStyle = screen.getByRole("button", { name: "Remove style" });
    const workspaceCard = screen
      .getByRole("heading", { name: "Workspace style" })
      .closest("article");
    expect(workspaceCard).not.toBeNull();
    expect(within(workspaceCard!).getByRole("button", { name: "Details" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove built-in style" })).not.toBeInTheDocument();

    fireEvent.click(removeStyle);
    expect(confirm).toHaveBeenCalledWith(
      "Remove this style from your Image Styles? Existing projects will keep their pinned version.",
    );
    await waitFor(() => expect(screen.queryByText("Workspace style")).not.toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v2/hosted/styles/workspace-style",
      expect.objectContaining({ method: "DELETE", body: "{}" }),
    );
    expect(catalogLoads).toBe(2);
    expect(screen.getByText("Built-in style")).toBeInTheDocument();
  });

  it("does not expose fixture-only preset mutation screens in hosted staging", () => {
    renderHosted(<HostedPresetCreationUnavailableScreen kind="styles" />);

    expect(screen.getByText("Image Styles creation unavailable")).toBeInTheDocument();
    expect(screen.getByText("Read-only catalog")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View Image Styles" })).toBeInTheDocument();
  });

  it("exposes the provider-free hosted style workflow only in private beta staging", () => {
    vi.stubEnv("VITE_VIDEOFORGE_PROVIDER_MODE", "staging");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ styles: [], avatars: [] })),
    );

    renderHosted(<HostedPresetCreationScreen kind="styles" />);

    expect(screen.getByRole("heading", { name: "New image style" })).toBeInTheDocument();
    expect(screen.getByLabelText("Style name")).toHaveClass("input", "preset-name-input");
    expect(screen.getByLabelText("Upload style references")).toBeInTheDocument();
    expect(screen.getByText("Add a name and images.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    expect(document.querySelector(".preset-create-panel")).toBeInTheDocument();
  });

  it("renders a readable, guided avatar creation form", () => {
    vi.stubEnv("VITE_VIDEOFORGE_PROVIDER_MODE", "staging");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ styles: [], avatars: [] })),
    );

    renderHosted(<HostedPresetCreationScreen kind="avatars" />);

    const nameInput = screen.getByLabelText("Avatar name");
    expect(nameInput).toHaveClass("input", "preset-name-input");
    fireEvent.change(nameInput, { target: { value: "Studio presenter" } });
    expect(nameInput).toHaveValue("Studio presenter");
    expect(screen.getByText("Choose a photo.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("blocks generation until the account-owned personal worker is online", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          avatars: [{ profile_id: "p1", version_id: "a1", name: "Owner", version_number: 1 }],
          styles: [{ style_id: "s1", version_id: "sv1", name: "Documentary", version_number: 1 }],
          media_worker_state: "WAITING_FOR_YOUR_COMPUTER",
          gpu_transport: "DISABLED_UNQUALIFIED",
          gpu_readiness: gpuReadiness,
        }),
      ),
    );
    renderHosted(<HostedCreateProjectScreen />);

    expect(await screen.findByText("Connect your computer")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Settings" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create project & start" })).toBeDisabled();
    expect(screen.getByLabelText("Video title")).toHaveClass("input");
    expect(screen.getByLabelText("Final voiceover")).toHaveAttribute(
      "accept",
      "audio/wav,audio/mpeg,.wav,.mp3",
    );
    expect(
      screen.getByText("WAV or MP3 · 10 seconds to 60 minutes · max 1 GB"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup", { name: "Avatar options" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("radiogroup", { name: "Image style options" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Owner")).toBeInTheDocument();
    expect(screen.getByText("Documentary")).toBeInTheDocument();
    expect(screen.queryByLabelText("Maximum spend")).not.toBeInTheDocument();
    expect(screen.getByText(/no paid GPU work will start/u)).toBeInTheDocument();
    expect(
      screen.queryByText(
        /Tenant-private Neon|GPU transport|DISABLED_UNQUALIFIED|V2-07|V2-08|MAGE_IMAGE|SOULX_AVATAR|Missing gates|APPROVED_EXACT|identity_output|cancellation_timeout|sha256:/u,
      ),
    ).not.toBeInTheDocument();
  });

  it("imports a dropped voiceover through the hosted picker", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          avatars: [{ profile_id: "p1", version_id: "a1", name: "Owner", version_number: 1 }],
          styles: [{ style_id: "s1", version_id: "sv1", name: "Documentary", version_number: 1 }],
          media_worker_state: "ONLINE",
          gpu_transport: "DISABLED_UNQUALIFIED",
          gpu_readiness: gpuReadiness,
        }),
      ),
    );
    renderHosted(<HostedCreateProjectScreen />);
    const dropzone = (await screen.findByText("Choose or drop your final voiceover")).closest(
      "label",
    );
    expect(dropzone).not.toBeNull();
    fireEvent.drop(dropzone!, {
      dataTransfer: { files: [new File(["invalid"], "notes.txt", { type: "text/plain" })] },
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Use a WAV or MP3 voiceover");
    const file = new File(["audio"], "narration.wav", { type: "audio/wav" });
    fireEvent.dragOver(dropzone!, { dataTransfer: { files: [file], dropEffect: "none" } });
    expect(dropzone).toHaveClass("is-drag-over");
    fireEvent.drop(dropzone!, { dataTransfer: { files: [file] } });
    expect(dropzone).not.toHaveClass("is-drag-over");
    expect(screen.getByText("narration.wav")).toBeInTheDocument();
    expect(screen.getByText(/ready to check/u)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reuses project creation identity after a failure and rotates it when inputs change", async () => {
    const projectRequests: { readonly body: string; readonly key: string }[] = [];
    const bytes = new ArrayBuffer(44 + 640_000);
    const view = new DataView(bytes);
    const write = (offset: number, value: string) =>
      [...value].forEach((character, index) =>
        view.setUint8(offset + index, character.charCodeAt(0)),
      );
    write(0, "RIFF");
    view.setUint32(4, bytes.byteLength - 8, true);
    write(8, "WAVE");
    write(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 16_000, true);
    view.setUint32(28, 32_000, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    write(36, "data");
    view.setUint32(40, 640_000, true);
    const voiceover = new File([bytes], "voiceover.wav", { type: "audio/wav" });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/api/v2/hosted/project-catalog"))
        return Response.json({
          avatars: [{ profile_id: "p1", version_id: "a1", name: "Owner", version_number: 1 }],
          styles: [{ style_id: "s1", version_id: "sv1", name: "Documentary", version_number: 1 }],
          media_worker_state: "ONLINE",
          gpu_transport: "DISABLED_UNQUALIFIED",
          gpu_readiness: gpuReadiness,
        });
      if (path.endsWith("/api/v2/hosted/projects/preflight"))
        return Response.json({ ok: true, ready: true, estimate: { projected_usd: 0 } });
      if (path.endsWith("/api/v2/hosted/projects")) {
        const headers = new Headers(init?.headers);
        projectRequests.push({
          body: String(init?.body),
          key: headers.get("idempotency-key") ?? "",
        });
        throw new TypeError("network connection lost");
      }
      throw new Error(`Unexpected hosted request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderHosted(<HostedCreateProjectScreen />);

    const title = await screen.findByLabelText("Video title");
    fireEvent.change(title, { target: { value: "First title" } });
    fireEvent.change(await screen.findByLabelText("Final voiceover"), {
      target: { files: [voiceover] },
    });
    const action = screen.getByRole("button", { name: "Create project & start" });
    fireEvent.click(action);
    await waitFor(() => expect(projectRequests).toHaveLength(1));
    expect(screen.getByRole("alert")).toHaveTextContent("network connection lost");

    fireEvent.click(screen.getByRole("button", { name: "Create project & start" }));
    await waitFor(() => expect(projectRequests).toHaveLength(2));
    expect(projectRequests[1]).toEqual(projectRequests[0]);

    fireEvent.change(title, { target: { value: "Second title" } });
    fireEvent.click(screen.getByRole("button", { name: "Create project & start" }));
    await waitFor(() => expect(projectRequests).toHaveLength(3));
    expect(projectRequests[2]!.key).not.toBe(projectRequests[0]!.key);
    expect(projectRequests[2]!.body).not.toBe(projectRequests[0]!.body);
  });

  it("fails closed when authenticated catalog readiness is absent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          avatars: [],
          styles: [],
          media_worker_state: "ONLINE",
          gpu_transport: "DISABLED_UNQUALIFIED",
        }),
      ),
    );
    renderHosted(<HostedCreateProjectScreen />);

    expect(await screen.findByText("Create Project unavailable")).toBeInTheDocument();
    expect(screen.queryByText(/MAGE_IMAGE/u)).not.toBeInTheDocument();
  });

  it("keeps the overall status running while a downstream stage is blocked", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          project: {
            id: "11111111-1111-4111-8111-111111111111",
            title: "Private project",
            created_at: "2026-08-17T10:00:00.000Z",
            revision_id: "22222222-2222-4222-8222-222222222222",
            revision_state: "LOCKED",
          },
          attempts: [],
          gpu_transport: "DISABLED_UNQUALIFIED" as const,
          gpu_readiness: gpuReadiness,
          generation: null,
          stages: [
            {
              id: "prepare",
              name: "Prepare",
              status: "COMPLETE",
              progress_percent: 100,
            },
            {
              id: "prompt-writing",
              name: "Write image prompts",
              status: "RUNNING",
              progress_percent: 50,
            },
            {
              id: "image-generation",
              name: "Generate images",
              status: "BLOCKED",
              progress_percent: 0,
            },
          ],
        }),
      ),
    );
    renderHosted(<HostedProjectScreen projectId="11111111-1111-4111-8111-111111111111" />);

    const progressHero = await screen.findByRole("region", { name: "Live video progress" });
    expect(within(progressHero).getAllByText("Running").length).toBeGreaterThan(0);
    expect(within(progressHero).queryByText("Blocked")).not.toBeInTheDocument();
  });

  it("requires a second deliberate click before stopping active transcription", async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    const attemptId = "33333333-3333-4333-8333-333333333333";
    let cancellationRequests = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith(`/api/v2/cpu-attempts/${attemptId}`)) {
        cancellationRequests += 1;
        expect(init).toMatchObject({
          method: "POST",
          body: JSON.stringify({
            schema_version: "videoforge-hosted-cpu-cancellation/v1",
            attempt_id: attemptId,
            confirmation: "STOP",
          }),
        });
        return Response.json({ id: attemptId, state: "CANCEL_REQUESTED" }, { status: 202 });
      }
      return Response.json({
        project: {
          id: projectId,
          title: "Private project",
          created_at: "2026-08-17T10:00:00.000Z",
          revision_id: "22222222-2222-4222-8222-222222222222",
          revision_state: "LOCKED",
        },
        attempts: [
          {
            id: attemptId,
            kind: "ASR" as const,
            state: "RUNNING",
            version: 1,
            created_at: "2026-08-17T10:00:00.000Z",
            updated_at: "2026-08-17T10:01:00.000Z",
            terminal_at: null,
            output_checksum_sha256: null,
            approved_at: null,
            preview_url: null,
          },
        ],
        gpu_transport: "DISABLED_UNQUALIFIED" as const,
        gpu_readiness: gpuReadiness,
        generation: null,
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderHosted(<HostedProjectScreen projectId={projectId} />);

    fireEvent.click(await screen.findByRole("button", { name: "Stop transcription" }));
    expect(cancellationRequests).toBe(0);
    const confirmation = screen.getByRole("button", { name: "Confirm stop transcription" });
    fireEvent.click(confirmation);

    await waitFor(() => expect(cancellationRequests).toBe(1));
  });

  it("labels active span audio as audio preparation", async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    const attemptId = "33333333-3333-4333-8333-333333333333";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          project: {
            id: projectId,
            title: "Private project",
            created_at: "2026-08-17T10:00:00.000Z",
            revision_id: "22222222-2222-4222-8222-222222222222",
            revision_state: "LOCKED",
          },
          attempts: [
            {
              id: attemptId,
              kind: "SPAN_AUDIO" as const,
              state: "RUNNING",
              version: 1,
              created_at: "2026-08-17T10:00:00.000Z",
              updated_at: "2026-08-17T10:01:00.000Z",
              terminal_at: null,
              output_checksum_sha256: null,
              approved_at: null,
              preview_url: null,
            },
          ],
          gpu_transport: "DISABLED_UNQUALIFIED" as const,
          gpu_readiness: gpuReadiness,
          generation: null,
        }),
      ),
    );

    renderHosted(<HostedProjectScreen projectId={projectId} />);

    expect(
      await screen.findByRole("button", { name: "Stop audio preparation" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop assembly" })).not.toBeInTheDocument();
  });

  it("disarms stop confirmation after its bounded timeout", async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    const attemptId = "33333333-3333-4333-8333-333333333333";
    let cancellationRequests = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith(`/api/v2/cpu-attempts/${attemptId}`)) {
          cancellationRequests += 1;
        }
        return Response.json({
          project: {
            id: projectId,
            title: "Private project",
            created_at: "2026-08-17T10:00:00.000Z",
            revision_id: "22222222-2222-4222-8222-222222222222",
            revision_state: "LOCKED",
          },
          attempts: [
            {
              id: attemptId,
              kind: "ASR" as const,
              state: "SUBMITTED",
              version: 1,
              created_at: "2026-08-17T10:00:00.000Z",
              updated_at: "2026-08-17T10:01:00.000Z",
              terminal_at: null,
              output_checksum_sha256: null,
              approved_at: null,
              preview_url: null,
            },
          ],
          gpu_transport: "DISABLED_UNQUALIFIED" as const,
          gpu_readiness: gpuReadiness,
          generation: null,
        });
      }),
    );
    renderHosted(<HostedProjectScreen projectId={projectId} />);

    const stop = await screen.findByRole("button", { name: "Stop transcription" });
    vi.useFakeTimers();
    fireEvent.click(stop);
    expect(screen.getByRole("button", { name: "Confirm stop transcription" })).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTime(5_001));
    vi.useRealTimers();

    expect(screen.getByRole("button", { name: "Stop transcription" })).toBeInTheDocument();
    expect(cancellationRequests).toBe(0);
  });

  it("disarms stop confirmation when the attempt state changes", async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    const attemptId = "33333333-3333-4333-8333-333333333333";
    let attemptState = "SUBMITTED";
    let cancellationRequests = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith(`/api/v2/cpu-attempts/${attemptId}`)) {
          cancellationRequests += 1;
        }
        return Response.json({
          project: {
            id: projectId,
            title: "Private project",
            created_at: "2026-08-17T10:00:00.000Z",
            revision_id: "22222222-2222-4222-8222-222222222222",
            revision_state: "LOCKED",
          },
          attempts: [
            {
              id: attemptId,
              kind: "ASR" as const,
              state: attemptState,
              version: attemptState === "SUBMITTED" ? 1 : 2,
              created_at: "2026-08-17T10:00:00.000Z",
              updated_at: "2026-08-17T10:01:00.000Z",
              terminal_at: null,
              output_checksum_sha256: null,
              approved_at: null,
              preview_url: null,
            },
          ],
          gpu_transport: "DISABLED_UNQUALIFIED" as const,
          gpu_readiness: gpuReadiness,
          generation: null,
        });
      }),
    );
    renderHosted(<HostedProjectScreen projectId={projectId} />);

    fireEvent.click(await screen.findByRole("button", { name: "Stop transcription" }));
    expect(screen.getByRole("button", { name: "Confirm stop transcription" })).toBeInTheDocument();
    attemptState = "RUNNING";
    fireEvent.click(screen.getByRole("button", { name: "Refresh now" }));

    await screen.findByRole("button", { name: "Stop transcription" });
    expect(cancellationRequests).toBe(0);
  });

  it("offers an idempotent recovery action for a cancellation left pending", async () => {
    const attemptId = "33333333-3333-4333-8333-333333333333";
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith(`/api/v2/cpu-attempts/${attemptId}`)) {
        expect(init).toMatchObject({
          method: "POST",
          body: JSON.stringify({
            schema_version: "videoforge-hosted-cpu-cancellation/v1",
            attempt_id: attemptId,
            confirmation: "STOP",
          }),
        });
        return Response.json({ id: attemptId, state: "CANCEL_REQUESTED" }, { status: 202 });
      }
      return Response.json({
        project: {
          id: "11111111-1111-4111-8111-111111111111",
          title: "Private project",
          created_at: "2026-08-17T10:00:00.000Z",
          revision_id: "22222222-2222-4222-8222-222222222222",
          revision_state: "LOCKED",
        },
        attempts: [
          {
            id: attemptId,
            kind: "ASR" as const,
            state: "CANCEL_REQUESTED",
            version: 2,
            created_at: "2026-08-17T10:00:00.000Z",
            updated_at: "2026-08-17T10:01:00.000Z",
            terminal_at: null,
            output_checksum_sha256: null,
            approved_at: null,
            preview_url: null,
          },
        ],
        gpu_transport: "DISABLED_UNQUALIFIED" as const,
        gpu_readiness: gpuReadiness,
        generation: null,
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderHosted(<HostedProjectScreen projectId="11111111-1111-4111-8111-111111111111" />);

    const stopButton = await screen.findByRole("button", {
      name: "Finish stopping transcription",
    });
    expect(stopButton.parentElement).toHaveClass("current-run-actions");
    fireEvent.click(stopButton);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/v2/cpu-attempts/${attemptId}`,
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            schema_version: "videoforge-hosted-cpu-cancellation/v1",
            attempt_id: attemptId,
            confirmation: "STOP",
          }),
        }),
      ),
    );
  });

  it("requires confirmation and archives a hosted project before returning home", async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        return Response.json({
          schema_version: "videoforge-hosted-project-archive-response/v1",
          project_id: projectId,
          state: "ARCHIVED",
          lineage_retention: "PRESERVED",
        });
      }
      return Response.json({
        project: {
          id: projectId,
          title: "Private project",
          created_at: "2026-08-17T10:00:00.000Z",
          revision_id: "22222222-2222-4222-8222-222222222222",
          revision_state: "LOCKED",
        },
        attempts: [],
        gpu_transport: "DISABLED_UNQUALIFIED" as const,
        gpu_readiness: gpuReadiness,
        generation: null,
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderHosted(<HostedProjectScreen projectId={projectId} />);

    fireEvent.click(await screen.findByRole("button", { name: "Delete project" }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Billing and security history"));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/v2/hosted/projects/${projectId}`,
        expect.objectContaining({ method: "DELETE", body: "{}" }),
      ),
    );
    await waitFor(() => expect(routerState.navigate).toHaveBeenCalledWith({ to: "/" }));
  });

  it("offers exact provider-safe cancellation before deleting active project work", async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith(`/projects/${projectId}/cancel`)) {
        return Response.json({
          schema_version: "videoforge-hosted-project-cancellation-response/v1",
          project_id: projectId,
          generation_request_id: "55555555-5555-4555-8555-555555555555",
          state: "CANCELLED",
          replayed: false,
          provider_actions_created: false,
          redispatch: false,
        });
      }
      return Response.json({
        project: {
          id: projectId,
          title: "Private project",
          created_at: "2026-08-17T10:00:00.000Z",
          revision_id: "22222222-2222-4222-8222-222222222222",
          revision_state: "LOCKED",
        },
        attempts: [
          {
            id: "33333333-3333-4333-8333-333333333333",
            kind: "MAGE_IMAGE" as const,
            state: "PLANNED",
            version: 1,
            created_at: "2026-08-17T10:00:00.000Z",
            updated_at: "2026-08-17T10:01:00.000Z",
            terminal_at: null,
            output_checksum_sha256: null,
            approved_at: null,
            preview_url: null,
          },
          {
            id: "44444444-4444-4444-8444-444444444444",
            kind: "SOULX_AVATAR" as const,
            state: "PLANNED",
            version: 1,
            created_at: "2026-08-17T10:00:00.000Z",
            updated_at: "2026-08-17T10:01:00.000Z",
            terminal_at: null,
            output_checksum_sha256: null,
            approved_at: null,
            preview_url: null,
          },
        ],
        gpu_transport: "QUALIFIED_EXACT" as const,
        gpu_readiness: gpuReadiness,
        generation: {
          id: "55555555-5555-4555-8555-555555555555",
          timeline_plan_sha256: `sha256:${"a".repeat(64)}`,
          planned_tasks: 2,
          completed_tasks: 0,
          failed_tasks: 0,
          stage: "READY_FOR_GPU_DISPATCH" as const,
        },
        queue: { status: "ACTIVE", position: 1 },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderHosted(<HostedProjectScreen projectId={projectId} />);

    fireEvent.click(await screen.findByRole("button", { name: "Cancel project work" }));
    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining("No provider request will be retried"),
    );
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/v2/hosted/projects/${projectId}/cancel`,
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            schema_version: "videoforge-hosted-project-cancellation/v1",
            project_id: projectId,
            confirmation: "STOP",
          }),
        }),
      ),
    );
  });

  it("offers reconciliation for an already-assigned provider pair", async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith(`/projects/${projectId}/cancel`)) {
        return Response.json(
          {
            schema_version: "videoforge-hosted-project-cancellation-response/v1",
            project_id: projectId,
            generation_request_id: "55555555-5555-4555-8555-555555555555",
            state: "RECONCILING",
            replayed: false,
            provider_actions_created: false,
            redispatch: false,
            reconciliation_scheduled: true,
          },
          { status: 202 },
        );
      }
      return Response.json({
        project: {
          id: projectId,
          title: "Assigned provider project",
          created_at: "2026-08-17T10:00:00.000Z",
          revision_id: "22222222-2222-4222-8222-222222222222",
          revision_state: "LOCKED",
        },
        attempts: [
          {
            id: "33333333-3333-4333-8333-333333333333",
            kind: "MAGE_IMAGE" as const,
            state: "ASSIGNED",
            version: 4,
            created_at: "2026-08-17T10:00:00.000Z",
            updated_at: "2026-08-17T10:01:00.000Z",
            terminal_at: null,
            output_checksum_sha256: null,
            approved_at: null,
            preview_url: null,
          },
          {
            id: "44444444-4444-4444-8444-444444444444",
            kind: "SOULX_AVATAR" as const,
            state: "ASSIGNED",
            version: 4,
            created_at: "2026-08-17T10:00:00.000Z",
            updated_at: "2026-08-17T10:01:00.000Z",
            terminal_at: null,
            output_checksum_sha256: null,
            approved_at: null,
            preview_url: null,
          },
        ],
        gpu_transport: "QUALIFIED_EXACT" as const,
        gpu_readiness: gpuReadiness,
        generation: {
          id: "55555555-5555-4555-8555-555555555555",
          timeline_plan_sha256: `sha256:${"a".repeat(64)}`,
          planned_tasks: 2,
          completed_tasks: 0,
          failed_tasks: 0,
          stage: "READY_FOR_GPU_DISPATCH" as const,
        },
        queue: { status: "ACTIVE", position: 1 },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderHosted(<HostedProjectScreen projectId={projectId} />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Stop and reconcile provider work" }),
    );
    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining("No provider request will be retried"),
    );
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/v2/hosted/projects/${projectId}/cancel`,
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("offers a safe explicit retry when personal-worker transcription fails", async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    const detail = {
      project: {
        id: projectId,
        title: "Private project",
        created_at: "2026-08-17T10:00:00.000Z",
        revision_id: "22222222-2222-4222-8222-222222222222",
        revision_state: "LOCKED",
      },
      attempts: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          kind: "ASR" as const,
          state: "FAILED",
          version: 2,
          created_at: "2026-08-17T10:00:00.000Z",
          updated_at: "2026-08-17T10:01:00.000Z",
          terminal_at: "2026-08-17T10:01:00.000Z",
          output_checksum_sha256: null,
          approved_at: null,
          preview_url: null,
          error_code: "MEDIA_EXECUTION_FAILED",
        },
      ],
      gpu_transport: "DISABLED_UNQUALIFIED" as const,
      gpu_readiness: gpuReadiness,
      stages: stageList({ prepare: "COMPLETE", transcription: "FAILED" }),
      generation: null,
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith(`/projects/${projectId}/asr`)) {
        expect(init).toMatchObject({ method: "POST", body: "{}" });
        return Response.json(
          { cpu_submission: { schema_version: "videoforge-hosted-cpu-submission/v1" } },
          { status: 202 },
        );
      }
      if (path.endsWith("/api/v2/cpu-attempts")) {
        expect(init?.method).toBe("POST");
        return Response.json({ state: "OUTBOXED" }, { status: 202 });
      }
      return Response.json(detail);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderHosted(<HostedProjectScreen projectId={projectId} />);

    expect(
      await screen.findByText("Transcription stopped before the transcript could be saved."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/local transcription process stopped unexpectedly/u),
    ).toBeInTheDocument();
    expect(screen.queryByText(/ASR_OUTPUT_INVALID/u)).not.toBeInTheDocument();
    const transcription = stageRow("Transcribe voiceover");
    expect(within(transcription).getByText("FAILED")).toBeInTheDocument();
    fireEvent.click(within(transcription).getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([input]) => String(input).endsWith("/api/v2/cpu-attempts")),
      ).toBe(true),
    );
  });

  it("shows the server's refusal inside the stage row when a retry is rejected", async () => {
    // Pressing Retry when the server refuses used to change nothing on screen: the refused reason
    // landed only in the notice below the pipeline. The row that was pressed must carry it.
    const projectId = "11111111-1111-4111-8111-111111111111";
    const refusal =
      "Transcription failed this many times on the voiceover itself. Keep the project saved and contact support.";
    const detail = {
      project: {
        id: projectId,
        title: "Private project",
        created_at: "2026-08-17T10:00:00.000Z",
        revision_id: "22222222-2222-4222-8222-222222222222",
        revision_state: "LOCKED",
      },
      attempts: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          kind: "ASR" as const,
          state: "FAILED",
          version: 2,
          created_at: "2026-08-17T10:00:00.000Z",
          updated_at: "2026-08-17T10:01:00.000Z",
          terminal_at: "2026-08-17T10:01:00.000Z",
          output_checksum_sha256: null,
          approved_at: null,
          preview_url: null,
          error_code: "MEDIA_EXECUTION_FAILED",
        },
      ],
      gpu_transport: "DISABLED_UNQUALIFIED" as const,
      gpu_readiness: gpuReadiness,
      stages: stageList({ prepare: "COMPLETE", transcription: "FAILED" }),
      generation: null,
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith(`/projects/${projectId}/asr`))
        return Response.json(
          { error: { code: "HOSTED_ASR_RETRY_LIMIT_REACHED", message: refusal } },
          { status: 409 },
        );
      return Response.json(detail);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderHosted(<HostedProjectScreen projectId={projectId} />);

    expect(
      await screen.findByText("Transcription stopped before the transcript could be saved."),
    ).toBeInTheDocument();
    const transcription = stageRow("Transcribe voiceover");
    expect(within(transcription).queryByText(refusal)).not.toBeInTheDocument();
    fireEvent.click(within(transcription).getByRole("button", { name: "Retry" }));
    expect(await within(transcription).findByText(refusal)).toBeInTheDocument();
    // Still the only stage with the control, and still no invented fraction on a stopped stage.
    expect(within(transcription).queryByText("50/100")).not.toBeInTheDocument();
    expect(
      within(stageRow("Prepare project")).queryByRole("button", { name: "Retry" }),
    ).not.toBeInTheDocument();
  });

  it("puts the retry inside only the failed stage, directly after its FAILED badge", async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          project: {
            id: projectId,
            title: "Private project",
            created_at: "2026-08-17T10:00:00.000Z",
            revision_id: "22222222-2222-4222-8222-222222222222",
            revision_state: "LOCKED",
          },
          attempts: [
            {
              id: "33333333-3333-4333-8333-333333333333",
              kind: "ASR" as const,
              state: "FAILED",
              version: 2,
              created_at: "2026-08-17T10:00:00.000Z",
              updated_at: "2026-08-17T10:01:00.000Z",
              terminal_at: "2026-08-17T10:01:00.000Z",
              output_checksum_sha256: null,
              approved_at: null,
              preview_url: null,
              error_code: "MEDIA_EXECUTION_FAILED",
            },
          ],
          gpu_transport: "DISABLED_UNQUALIFIED" as const,
          gpu_readiness: gpuReadiness,
          stages: stageList({ prepare: "COMPLETE", transcription: "FAILED" }),
        }),
      ),
    );
    renderHosted(<HostedProjectScreen projectId={projectId} />);

    await screen.findByText("Transcription stopped before the transcript could be saved.");
    const transcription = stageRow("Transcribe voiceover");
    const badge = within(transcription).getByText("FAILED");
    const retry = within(transcription).getByRole("button", { name: "Retry" });
    // The control sits immediately after the badge, inside the same stage header.
    expect(badge.parentElement).toBe(retry.parentElement?.parentElement);
    expect(within(badge.nextElementSibling as HTMLElement).getByRole("button")).toBe(retry);

    // A complete stage and a stage that has not run yet carry no retry control.
    expect(within(stageRow("Prepare project")).queryByRole("button")).not.toBeInTheDocument();
    expect(within(stageRow("Understand voiceover context")).queryByRole("button")).not.toBeInTheDocument();
    expect(within(stageRow("Plan scenes")).queryByRole("button")).not.toBeInTheDocument();
  });

  it("continues automatically into bounded context extraction after transcription", async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    const asrId = "33333333-3333-4333-8333-333333333333";
    const detail = {
      project: {
        id: projectId,
        title: "Private project",
        created_at: "2026-08-17T10:00:00.000Z",
        revision_id: "22222222-2222-4222-8222-222222222222",
        revision_state: "LOCKED",
      },
      attempts: [
        {
          id: asrId,
          kind: "ASR" as const,
          state: "SUCCEEDED",
          version: 3,
          created_at: "2026-08-17T10:00:00.000Z",
          updated_at: "2026-08-17T10:01:00.000Z",
          terminal_at: "2026-08-17T10:01:00.000Z",
          output_checksum_sha256: `sha256:${"a".repeat(64)}`,
          approved_at: null,
          preview_url: null,
        },
      ],
      gpu_transport: "DISABLED_UNQUALIFIED" as const,
      gpu_readiness: gpuReadiness,
      generation: null,
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith(`/projects/${projectId}/context`)) {
        expect(init).toMatchObject({
          method: "POST",
          body: JSON.stringify({
            asr_attempt_id: asrId,
            maximum_context_spend_micro_usd: 10_000,
          }),
        });
        return Response.json({ state: "COMPLETE", context_cost_usd: 0.001 });
      }
      return Response.json(detail);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderHosted(<HostedProjectScreen projectId={projectId} />);

    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/render"))).toBe(false);
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith(`/context`))).toBe(true),
    );
    expect(screen.queryByRole("button", { name: /extract context/u })).not.toBeInTheDocument();
    expect(screen.queryByText(/Maximum charge: \$0\.01/u)).not.toBeInTheDocument();
  });

  it("keeps saved progress visible when context start and its background refetch fail", async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    const asrId = "33333333-3333-4333-8333-333333333333";
    let projectReads = 0;
    const detail = {
      project: {
        id: projectId,
        title: "Private project",
        created_at: "2026-08-17T10:00:00.000Z",
        revision_id: "22222222-2222-4222-8222-222222222222",
        revision_state: "LOCKED",
      },
      attempts: [
        {
          id: asrId,
          kind: "ASR" as const,
          state: "SUCCEEDED",
          version: 3,
          created_at: "2026-08-17T10:00:00.000Z",
          updated_at: "2026-08-17T10:01:00.000Z",
          terminal_at: "2026-08-17T10:01:00.000Z",
          output_checksum_sha256: `sha256:${"a".repeat(64)}`,
          approved_at: null,
          preview_url: null,
        },
      ],
      gpu_transport: "DISABLED_UNQUALIFIED" as const,
      gpu_readiness: gpuReadiness,
      voiceover_context: null,
      generation: null,
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith(`/projects/${projectId}/context`)) {
        return Response.json(
          { error: { message: "Automatic context extraction could not start safely." } },
          { status: 500 },
        );
      }
      projectReads += 1;
      return projectReads === 1
        ? Response.json(detail)
        : Response.json(
            { error: { message: "Latest progress read is temporarily unavailable." } },
            { status: 500 },
          );
    });
    vi.stubGlobal("fetch", fetchMock);
    renderHosted(<HostedProjectScreen projectId={projectId} />);

    expect(
      await screen.findByText("Automatic context extraction could not start."),
    ).toBeInTheDocument();
    await waitFor(() => expect(projectReads).toBeGreaterThanOrEqual(2));
    expect(screen.getByRole("heading", { name: "Private project" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Video production stages" })).toBeInTheDocument();
    expect(
      screen.getByText("Automatic context extraction could not start safely."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Retry automatic continuation" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Live progress is temporarily unavailable")).not.toBeInTheDocument();
  });

  it("reports a failed automatic context start inside stage 03 instead of a running row", async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    const asrId = "33333333-3333-4333-8333-333333333333";
    const automaticStartDetail =
      "VideoForge is starting voiceover context automatically within the project limit.";
    const detail = {
      project: {
        id: projectId,
        title: "Private project",
        created_at: "2026-08-17T10:00:00.000Z",
        revision_id: "22222222-2222-4222-8222-222222222222",
        revision_state: "LOCKED",
      },
      attempts: [
        {
          id: asrId,
          kind: "ASR" as const,
          state: "SUCCEEDED",
          version: 3,
          created_at: "2026-08-17T10:00:00.000Z",
          updated_at: "2026-08-17T10:01:00.000Z",
          terminal_at: "2026-08-17T10:01:00.000Z",
          output_checksum_sha256: `sha256:${"a".repeat(64)}`,
          approved_at: null,
          preview_url: null,
        },
      ],
      gpu_transport: "DISABLED_UNQUALIFIED" as const,
      gpu_readiness: gpuReadiness,
      voiceover_context: null,
      // The Worker's own stage projection while no context row exists: asr succeeded, so stage 03 is
      // reported RUNNING with the automatic-start sentence no matter how the request actually ended.
      stages: stageList({
        prepare: "COMPLETE",
        transcription: "COMPLETE",
        "voiceover-context": "RUNNING",
      }).map((stage) =>
        stage.id === "voiceover-context" ? { ...stage, detail: automaticStartDetail } : stage,
      ),
      generation: null,
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith(`/projects/${projectId}/context`)) {
        // The escaped production failure: the stage-3 capability refused the write, so the Worker
        // answered 500 with an HTML error page whose body readJson cannot parse. The user-visible
        // reason is therefore readJson's own fallback sentence.
        return new Response("<!doctype html><html><body>500 Internal Server Error</body></html>", {
          status: 500,
          headers: { "content-type": "text/html" },
        });
      }
      return Response.json(detail);
    });
    const contextPosts = () =>
      fetchMock.mock.calls.filter(([input]) =>
        String(input).endsWith(`/projects/${projectId}/context`),
      );
    vi.stubGlobal("fetch", fetchMock);
    renderHosted(<HostedProjectScreen projectId={projectId} />);

    await waitFor(() => expect(contextPosts()).toHaveLength(1));
    await waitFor(() =>
      expect(
        within(stageRow("Understand voiceover context")).getByText("FAILED"),
      ).toBeInTheDocument(),
    );
    const contextRow = stageRow("Understand voiceover context");
    // The row tells the truth about the failure: the reason the request threw, announced as an alert,
    // instead of a stage that keeps reading RUNNING with the automatic-start sentence and 0/100.
    expect(
      within(contextRow).getAllByText("VideoForge hosted request failed.").length,
    ).toBeGreaterThan(0);
    expect(within(contextRow).getByRole("alert")).toHaveTextContent(
      "VideoForge hosted request failed.",
    );
    expect(within(contextRow).queryByText("RUNNING")).not.toBeInTheDocument();
    expect(
      within(contextRow).queryByText(/starting voiceover context automatically/iu),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(automaticStartDetail)).not.toBeInTheDocument();
    // The notice below the pipeline keeps its plain auto-start copy and its own control; a FAILED
    // stage 03 must not push it into the needs-review branch, which belongs to a context row.
    expect(screen.getByText("Automatic context extraction could not start.")).toBeInTheDocument();
    expect(screen.queryByText("Context extraction needs review.")).not.toBeInTheDocument();
    expect(screen.queryByText("Stopped safely; no automatic retry.")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Retry automatic continuation" }),
    ).toBeInTheDocument();
    // The FAILED row carries the same fresh bounded request, so a press sends it again.
    fireEvent.click(within(contextRow).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(contextPosts()).toHaveLength(2));
  });

  it("keeps the auto-start notice copy when the stage projection already reads FAILED", async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    const asrId = "33333333-3333-4333-8333-333333333333";
    const detail = {
      project: {
        id: projectId,
        title: "Private project",
        created_at: "2026-08-17T10:00:00.000Z",
        revision_id: "22222222-2222-4222-8222-222222222222",
        revision_state: "LOCKED",
      },
      attempts: [
        {
          id: asrId,
          kind: "ASR" as const,
          state: "SUCCEEDED",
          version: 3,
          created_at: "2026-08-17T10:00:00.000Z",
          updated_at: "2026-08-17T10:01:00.000Z",
          terminal_at: "2026-08-17T10:01:00.000Z",
          output_checksum_sha256: `sha256:${"a".repeat(64)}`,
          approved_at: null,
          preview_url: null,
        },
      ],
      gpu_transport: "DISABLED_UNQUALIFIED" as const,
      gpu_readiness: gpuReadiness,
      voiceover_context: null,
      stages: stageList({
        prepare: "COMPLETE",
        transcription: "COMPLETE",
        "voiceover-context": "FAILED",
      }),
      generation: null,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith(`/projects/${projectId}/context`)
          ? new Response("Internal Server Error", { status: 500 })
          : Response.json(detail),
      ),
    );
    renderHosted(<HostedProjectScreen projectId={projectId} />);

    expect(
      await screen.findByText("Automatic context extraction could not start."),
    ).toBeInTheDocument();
    // A failed stage 03 with no context row is not a needs-review context, so the notice must keep the
    // reason and the retry control instead of the needs-review copy.
    expect(screen.queryByText("Context extraction needs review.")).not.toBeInTheDocument();
    expect(screen.queryByText("Stopped safely; no automatic retry.")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Retry automatic continuation" }),
    ).toBeInTheDocument();
    expect(
      within(stageRow("Understand voiceover context")).getByRole("button", { name: "Retry" }),
    ).toBeInTheDocument();
  });

  it("keeps an approved completed video on the final stage", async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          project: {
            id: projectId,
            title: "Finished video",
            revision_id: "22222222-2222-4222-8222-222222222222",
            revision_state: "LOCKED",
          },
          attempts: [
            {
              id: "33333333-3333-4333-8333-333333333333",
              kind: "RENDER",
              state: "SUCCEEDED",
              approved_at: "2026-09-14T10:00:00Z",
              preview_url: null,
            },
          ],
          gpu_transport: "DISABLED_UNQUALIFIED",
          gpu_readiness: gpuReadiness,
          generation: null,
          stages: Array.from({ length: 10 }, (_, index) => ({
            id: `stage-${index + 1}`,
            name: index === 9 ? "Review and approve" : `Stage ${index + 1}`,
            status: "COMPLETE",
            progress_percent: 100,
          })),
        }),
      ),
    );
    renderHosted(<HostedProjectScreen projectId={projectId} />);
    const progress = await screen.findByRole("region", { name: "Live video progress" });
    expect(within(progress).getByText("10/10")).toBeInTheDocument();
    expect(
      within(progress).getByRole("heading", { name: "Review and approve" }),
    ).toBeInTheDocument();
    expect(within(progress).getByText("Approved")).toBeInTheDocument();
  });

  it.each([
    "VOICEOVER_CONTEXT_PROVIDER_UNCERTAIN",
    "VOICEOVER_CONTEXT_INVALID",
    "VOICEOVER_CONTEXT_PROVIDER_UNAVAILABLE",
  ])("checks an UNKNOWN context once without retrying inference (%s)", async (problemCode) => {
    const providerFailed = problemCode === "VOICEOVER_CONTEXT_PROVIDER_UNAVAILABLE";
    const projectId = "11111111-1111-4111-8111-111111111111";
    const contextId = "44444444-4444-4444-8444-444444444444";
    let reconciliationCalls = 0;
    let projectReads = 0;
    const detail = {
      project: {
        id: projectId,
        title: "Private project",
        created_at: "2026-08-17T10:00:00.000Z",
        revision_id: "22222222-2222-4222-8222-222222222222",
        revision_state: "LOCKED",
      },
      attempts: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          kind: "ASR" as const,
          state: "SUCCEEDED",
          version: 3,
          created_at: "2026-08-17T10:00:00.000Z",
          updated_at: "2026-08-17T10:01:00.000Z",
          terminal_at: "2026-08-17T10:01:00.000Z",
          output_checksum_sha256: `sha256:${"a".repeat(64)}`,
          approved_at: null,
          preview_url: null,
        },
      ],
      gpu_transport: "DISABLED_UNQUALIFIED" as const,
      gpu_readiness: gpuReadiness,
      stages: stageList({ prepare: "COMPLETE", transcription: "COMPLETE", "voiceover-context": "FAILED" }),
      voiceover_context: {
        id: contextId,
        state: "UNKNOWN" as const,
        transcript_hash: `sha256:${"b".repeat(64)}`,
        reserved_cost_micro_usd: 10_000,
        problem_code: problemCode,
      },
      generation: null,
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith(`/projects/${projectId}/reconcile-context`)) {
        reconciliationCalls += 1;
        expect(init).toMatchObject({ method: "POST", body: "{}" });
        return Response.json(
          {
            error: {
              code: providerFailed
                ? "HOSTED_CONTEXT_RECONCILIATION_RUNWARE_TASK_PROVIDER_FAILED"
                : "HOSTED_CONTEXT_RECONCILIATION_RUNWARE_TASK_DETAILS_UNAVAILABLE",
              message: "The original provider result is not available yet.",
            },
          },
          { status: 409 },
        );
      }
      if (path.endsWith(`/projects/${projectId}/context`)) {
        expect(init?.method).toBe("POST");
        return Response.json({ state: "COMPLETE" }, { status: 200 });
      }
      projectReads += 1;
      return projectReads === 1
        ? Response.json(detail)
        : Response.json(
            { error: { message: "Latest progress read is temporarily unavailable." } },
            { status: 500 },
          );
    });
    vi.stubGlobal("fetch", fetchMock);
    renderHosted(<HostedProjectScreen projectId={projectId} />);

    expect(
      await screen.findByText(
        providerFailed
          ? "Provider task failed."
          : problemCode === "VOICEOVER_CONTEXT_INVALID"
            ? "Context result failed validation."
            : "Provider result needs confirmation.",
      ),
    ).toBeInTheDocument();
    expect(reconciliationCalls).toBe(1);
    await waitFor(() => expect(projectReads).toBeGreaterThanOrEqual(2));
    expect(screen.getByRole("heading", { name: "Private project" })).toBeInTheDocument();
    expect(screen.queryByText("Live progress is temporarily unavailable")).not.toBeInTheDocument();
    expect(
      screen.getByText("The original provider result is not available yet."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/retry.*provider|retry.*context/iu)).not.toBeInTheDocument();

    if (providerFailed) {
      // The provider confirmed the original task produced nothing usable, so this row now offers the
      // only recovery that can work: a brand-new request through the bounded redispatch.
      const retry = within(stageRow("Understand voiceover context")).getByRole("button", {
        name: "Retry",
      });
      expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/context"))).toBe(
        false,
      );
      fireEvent.click(retry);
      await waitFor(() =>
        expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/context"))).toBe(
          true,
        ),
      );
      expect(reconciliationCalls).toBe(1);
    } else if (problemCode === "VOICEOVER_CONTEXT_INVALID") {
      expect(
        within(stageRow("Understand voiceover context")).getByRole("button", { name: "Retry" }),
      ).toBeDisabled();
      expect(reconciliationCalls).toBe(1);
    } else {
      fireEvent.click(
        within(stageRow("Understand voiceover context")).getByRole("button", { name: "Retry" }),
      );
      await waitFor(() => expect(reconciliationCalls).toBe(2));
    }
  });

  it("continues from an UNKNOWN context after automatic provider-result reconciliation succeeds", async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    let reconciled = false;
    const base = {
      project: {
        id: projectId,
        title: "Private project",
        created_at: "2026-08-17T10:00:00.000Z",
        revision_id: "22222222-2222-4222-8222-222222222222",
        revision_state: "LOCKED",
      },
      attempts: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          kind: "ASR" as const,
          state: "SUCCEEDED",
          version: 3,
          created_at: "2026-08-17T10:00:00.000Z",
          updated_at: "2026-08-17T10:01:00.000Z",
          terminal_at: "2026-08-17T10:01:00.000Z",
          output_checksum_sha256: `sha256:${"a".repeat(64)}`,
          approved_at: null,
          preview_url: null,
        },
      ],
      gpu_transport: "DISABLED_UNQUALIFIED" as const,
      gpu_readiness: gpuReadiness,
      stages: stageList({
        prepare: "COMPLETE",
        transcription: "COMPLETE",
        "voiceover-context": reconciled ? "COMPLETE" : "FAILED",
      }),
      generation: { id: "55555555-5555-4555-8555-555555555555" },
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith(`/projects/${projectId}/reconcile-context`)) {
        reconciled = true;
        return Response.json({ state: "COMPLETE" });
      }
      if (path.endsWith(`/projects/${projectId}/prompts`))
        return Response.json({ state: "COMPLETE" });
      return Response.json({
        ...base,
        stages: stageList({
          prepare: "COMPLETE",
          transcription: "COMPLETE",
          "voiceover-context": reconciled ? "COMPLETE" : "FAILED",
        }),
        voiceover_context: reconciled
          ? {
              id: "44444444-4444-4444-8444-444444444444",
              state: "SUCCEEDED",
              transcript_hash: `sha256:${"b".repeat(64)}`,
              context_hash: `sha256:${"c".repeat(64)}`,
              context_document: {
                subject: "workshop object demonstration",
                visual_facts: ["same presenter", "same physical object", "workshop"],
                continuity: ["same presenter and object across demonstrations"],
                resolved_references: [],
              },
              reserved_cost_micro_usd: 10_000,
            }
          : {
              id: "44444444-4444-4444-8444-444444444444",
              state: "UNKNOWN",
              transcript_hash: `sha256:${"b".repeat(64)}`,
              reserved_cost_micro_usd: 10_000,
            },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderHosted(<HostedProjectScreen projectId={projectId} />);

    expect(await screen.findByRole("heading", { name: "Extracted context" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Subject: workshop object demonstration | Visual facts: same presenter; same physical object; workshop | Continuity: same presenter and object across demonstrations",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Inspect saved context")).not.toBeInTheDocument();
    expect(
      within(stageRow("Understand voiceover context")).queryByRole("button", { name: "Retry" }),
    ).not.toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/reconcile-context")),
    ).toHaveLength(1);
  });

  it("keeps the full-page recovery state for an initial project read failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: { message: "Latest progress read is temporarily unavailable." } },
          { status: 500 },
        ),
      ),
    );
    renderHosted(<HostedProjectScreen projectId="11111111-1111-4111-8111-111111111111" />);

    expect(await screen.findByText("Live progress is temporarily unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry progress" })).toBeInTheDocument();
  });

  it("fails closed when ASR succeeds without an exact render plan", async () => {
    let planned = false;
    const detail = {
      project: {
        id: "11111111-1111-4111-8111-111111111111",
        title: "Private project",
        created_at: "2026-08-17T10:00:00.000Z",
        revision_id: "22222222-2222-4222-8222-222222222222",
        revision_state: "LOCKED",
      },
      attempts: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          kind: "ASR" as const,
          state: "SUCCEEDED",
          version: 3,
          created_at: "2026-08-17T10:00:00.000Z",
          updated_at: "2026-08-17T10:01:00.000Z",
          terminal_at: "2026-08-17T10:01:00.000Z",
          output_checksum_sha256: `sha256:${"a".repeat(64)}`,
          approved_at: null,
          preview_url: null,
        },
      ],
      gpu_transport: "DISABLED_UNQUALIFIED" as const,
      gpu_readiness: gpuReadiness,
      voiceover_context: {
        state: "SUCCEEDED" as const,
        transcript_hash: `sha256:${"b".repeat(64)}`,
        context_hash: `sha256:${"c".repeat(64)}`,
        context_document: { primary_topic: "Private project" },
        reserved_cost_micro_usd: 10_000,
        reported_cost_micro_usd: 1_000,
      },
      generation: null,
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/render"))
        return Response.json(
          {
            error: {
              code: "HOSTED_PROJECT_PLANNING_FAILED",
              message:
                "Video planning could not finish. Your transcript is saved; try planning again.",
            },
          },
          { status: 409 },
        );
      return Response.json(
        planned
          ? {
              ...detail,
              generation: {
                id: "55555555-5555-4555-8555-555555555555",
                stage: "RUNNING",
                planned_tasks: 2,
                completed_tasks: 0,
                failed_tasks: 0,
              },
              stages: [
                { id: "planning", name: "Plan scenes", status: "COMPLETE" },
                { id: "prompt-writing", name: "Write image prompts", status: "COMPLETE" },
                { id: "image-generation", name: "Generate images", status: "RUNNING" },
              ],
            }
          : detail,
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    renderHosted(<HostedProjectScreen projectId="11111111-1111-4111-8111-111111111111" />);

    expect(
      await screen.findByText(/generation planning could not be verified/u),
    ).toBeInTheDocument();
    expect(screen.getByText(/Your transcript is saved; try planning again/u)).toBeInTheDocument();
    expect(screen.queryByText(/HOSTED_/u)).not.toBeInTheDocument();
    expect(screen.getByText(/This will retry planning only/u)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry planning" }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/render")),
      ).toHaveLength(2),
    );
    expect(
      fetchMock.mock.calls.some(([input]) => String(input).endsWith("/api/v2/cpu-attempts")),
    ).toBe(false);
    expect(screen.queryByRole("link", { name: "Review video" })).not.toBeInTheDocument();
    planned = true;
    fireEvent.click(screen.getByRole("button", { name: "Refresh now" }));
    await waitFor(() =>
      expect(screen.queryByText(/generation planning could not be verified/u)).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: "Retry planning" })).not.toBeInTheDocument();
  });

  it("re-arms one automatic render handoff for a successor revision reusing ASR evidence", async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    const predecessorRevisionId = "22222222-2222-4222-8222-222222222222";
    const successorRevisionId = "33333333-3333-4333-8333-333333333333";
    const asrId = "44444444-4444-4444-8444-444444444444";
    let revisionId = predecessorRevisionId;
    let renderCalls = 0;
    const detail = () => ({
      project: {
        id: projectId,
        title: "Private project",
        created_at: "2026-09-06T10:00:00.000Z",
        revision_id: revisionId,
        revision_state: "LOCKED",
      },
      attempts: [
        {
          id: asrId,
          kind: "ASR" as const,
          state: "SUCCEEDED",
          version: 1,
          created_at: "2026-09-06T10:00:00.000Z",
          updated_at: "2026-09-06T10:01:00.000Z",
          terminal_at: "2026-09-06T10:01:00.000Z",
          output_checksum_sha256: `sha256:${"a".repeat(64)}`,
          approved_at: null,
          preview_url: null,
        },
      ],
      gpu_transport: "DISABLED_UNQUALIFIED" as const,
      gpu_readiness: gpuReadiness,
      voiceover_context: {
        id: "55555555-5555-4555-8555-555555555555",
        state: "SUCCEEDED" as const,
        transcript_hash: `sha256:${"b".repeat(64)}`,
        context_hash: `sha256:${"c".repeat(64)}`,
        context_document: { primary_topic: "Private project" },
        reserved_cost_micro_usd: 10_000,
        reported_cost_micro_usd: 1_000,
      },
      generation: null,
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/render")) {
        renderCalls += 1;
        return Response.json(
          {
            error: {
              code: "HOSTED_PROJECT_PLANNING_FAILED",
              message: "Video planning could not finish. Your transcript is saved; try again.",
            },
          },
          { status: 409 },
        );
      }
      return Response.json(detail());
    });
    vi.stubGlobal("fetch", fetchMock);
    renderHosted(<HostedProjectScreen projectId={projectId} />);

    expect(
      await screen.findByText(/generation planning could not be verified/u),
    ).toBeInTheDocument();
    expect(renderCalls).toBe(1);

    revisionId = successorRevisionId;
    fireEvent.click(screen.getByRole("button", { name: "Refresh now" }));
    await waitFor(() => expect(renderCalls).toBe(2));
    await new Promise((resolve) => window.setTimeout(resolve, 25));
    expect(renderCalls).toBe(2);
  });

  it("plans after successful ASR and remains provider-inert while GPU lanes are unqualified", async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    const revisionId = "22222222-2222-4222-8222-222222222222";
    const asrId = "33333333-3333-4333-8333-333333333333";
    let planned = false;
    const detail = () => ({
      project: {
        id: projectId,
        title: "Private project",
        created_at: "2026-08-17T10:00:00.000Z",
        revision_id: revisionId,
        revision_state: "LOCKED",
      },
      attempts: [
        {
          id: asrId,
          kind: "ASR" as const,
          state: "SUCCEEDED",
          version: 3,
          created_at: "2026-08-17T10:00:00.000Z",
          updated_at: "2026-08-17T10:01:00.000Z",
          terminal_at: "2026-08-17T10:01:00.000Z",
          output_checksum_sha256: `sha256:${"a".repeat(64)}`,
          approved_at: null,
          preview_url: null,
        },
      ],
      gpu_transport: "DISABLED_UNQUALIFIED" as const,
      gpu_readiness: gpuReadiness,
      voiceover_context: {
        state: "SUCCEEDED" as const,
        transcript_hash: `sha256:${"b".repeat(64)}`,
        context_hash: `sha256:${"c".repeat(64)}`,
        context_document: { primary_topic: "Private project" },
        reserved_cost_micro_usd: 10_000,
        reported_cost_micro_usd: 1_000,
      },
      generation: planned
        ? {
            id: "55555555-5555-4555-8555-555555555555",
            timeline_plan_sha256: `sha256:${"f".repeat(64)}`,
            planned_tasks: 12,
            completed_tasks: 0,
            failed_tasks: 0,
            stage: "WAITING_FOR_GPU_QUALIFICATION" as const,
          }
        : null,
      stages: planned
        ? [
            {
              id: "planning",
              name: "Plan scenes",
              status: "COMPLETE",
              progress_percent: 100,
            },
            {
              id: "prompt-writing",
              name: "Write image prompts",
              status: "WAITING",
              progress_percent: 0,
              detail: "No durable accepted image prompts have been written yet.",
            },
            {
              id: "image-generation",
              name: "Generate images",
              status: "WAITING_FOR_GPU_QUALIFICATION",
              progress_percent: 0,
            },
          ]
        : undefined,
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/render")) {
        planned = true;
        return Response.json(
          {
            state: "WAITING_FOR_GPU_QUALIFICATION",
            missing_lane_gates: gpuReadiness.lanes.map((lane) => ({
              lane: lane.lane,
              gates: lane.missing_gates,
            })),
            serverless_attempt_count: 0,
            outbox_count: 0,
            authority_count: 0,
            transport_call_count: 0,
            provider_call_count: 0,
            spend_usd: 0,
          },
          { status: 202 },
        );
      }
      if (path.endsWith("/prompts")) {
        expect(init).toMatchObject({
          method: "POST",
          body: JSON.stringify({ maximum_prompt_spend_micro_usd: 40_000 }),
        });
        return Response.json({ state: "COMPLETE", prompt_cost_usd: 0.004 }, { status: 202 });
      }
      return Response.json(detail());
    });
    vi.stubGlobal("fetch", fetchMock);
    renderHosted(<HostedProjectScreen projectId={projectId} />);

    expect(await screen.findByText("Writing image prompts…")).toBeInTheDocument();
    expect(screen.getAllByRole("progressbar", { name: "Overall video progress" })).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "Video production stages" })).toBeInTheDocument();
    expect(
      screen.queryByText(/V2-07|V2-08|identity_output|MAGE_QUALIFICATION/u),
    ).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/render"))).toBe(true);
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/prompts"))).toBe(true),
    );
    expect(screen.queryByRole("button", { name: "Write image prompts" })).not.toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([input]) => String(input).endsWith("/api/v2/cpu-attempts")),
    ).toBe(false);
  });

  it("shows live Stage 5 writing status without redispatching a running prompt batch", async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      void input;
      return Response.json({
        project: {
          id: projectId,
          title: "Private project",
          created_at: "2026-08-17T10:00:00.000Z",
          revision_id: "22222222-2222-4222-8222-222222222222",
          revision_state: "LOCKED",
        },
        attempts: [],
        gpu_transport: "DISABLED_UNQUALIFIED" as const,
        gpu_readiness: gpuReadiness,
        voiceover_context: {
          id: "44444444-4444-4444-8444-444444444444",
          state: "SUCCEEDED" as const,
          transcript_hash: `sha256:${"b".repeat(64)}`,
          context_hash: `sha256:${"c".repeat(64)}`,
          context_document: { primary_topic: "Private project" },
          reserved_cost_micro_usd: 10_000,
        },
        generation: {
          id: "55555555-5555-4555-8555-555555555555",
          timeline_plan_sha256: `sha256:${"f".repeat(64)}`,
          planned_tasks: 2,
          completed_tasks: 0,
          failed_tasks: 0,
          total_segments: 8,
          image_scene_count: 6,
          avatar_segment_count: 2,
          stage: "WAITING_FOR_GPU_QUALIFICATION" as const,
        },
        stages: [
          {
            id: "prompt-writing",
            name: "Write image prompts",
            status: "RUNNING",
            progress_percent: 50,
          },
        ],
        prompts: [],
        prompt_progress: {
          total_scenes: 6,
          accepted_scenes: 0,
          total_batches: 2,
          accepted_batches: 0,
          active_batch_ordinal: 1,
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderHosted(<HostedProjectScreen projectId={projectId} />);

    expect(await screen.findByRole("heading", { name: "Image prompts" })).toBeInTheDocument();
    expect(screen.getByText("Batch 1 of 2 · 0 / 6 prompts accepted")).toBeInTheDocument();
    expect(screen.getByText(/Writing batch 1 of 2/u)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Plan scenes detail" })).toBeInTheDocument();
    expect(screen.getByText("Total segments")).toBeInTheDocument();
    expect(screen.getByText("Image scenes")).toBeInTheDocument();
    expect(screen.getByText("Avatar segments")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getByText("6")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/prompts"))).toBe(false);
  });

  it.each([
    ["FAILED", null, true],
    ["UNKNOWN", null, false],
    ["FAILED", "HOSTED_PROMPT_OUTPUT_INVALID", false],
  ] as const)("shows Stage 5 %s progress with a safe retry only when definite", async (state, problemCode, retryable) => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      void input;
      return Response.json({
        project: {
          id: projectId,
          title: "Private project",
          created_at: "2026-08-17T10:00:00.000Z",
          revision_id: "22222222-2222-4222-8222-222222222222",
          revision_state: "LOCKED",
        },
        attempts: [],
        gpu_transport: "DISABLED_UNQUALIFIED" as const,
        gpu_readiness: gpuReadiness,
        voiceover_context: {
          id: "44444444-4444-4444-8444-444444444444",
          state: "SUCCEEDED" as const,
          transcript_hash: `sha256:${"b".repeat(64)}`,
          context_hash: `sha256:${"c".repeat(64)}`,
          context_document: { primary_topic: "Private project" },
          reserved_cost_micro_usd: 10_000,
        },
        generation: {
          id: "55555555-5555-4555-8555-555555555555",
          timeline_plan_sha256: `sha256:${"f".repeat(64)}`,
          planned_tasks: 1,
          completed_tasks: 0,
          failed_tasks: 1,
          total_segments: 16,
          image_scene_count: 16,
          avatar_segment_count: 0,
          stage: "FAILED" as const,
        },
        stages: [
          {
            id: "prompt-writing",
            name: "Write image prompts",
            status: "FAILED",
            progress_percent: 0,
          },
        ],
        prompts: [],
        prompt_progress: {
          state,
          problem_code: problemCode,
          total_scenes: 16,
          accepted_scenes: 0,
          total_batches: 1,
          accepted_batches: 0,
          active_batch_ordinal: null,
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderHosted(<HostedProjectScreen projectId={projectId} />);

    expect(await screen.findByRole("heading", { name: "Image prompts" })).toBeInTheDocument();
    expect(screen.getByText("Prompt writing stopped")).toBeInTheDocument();
    expect(screen.getByText("Stopped · 0 / 1 batches accepted")).toBeInTheDocument();
    expect(screen.queryByText("Preparing batch of 1")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "No accepted prompts were saved. VideoForge stopped without redispatching the request.",
      ),
    ).toBeInTheDocument();
    expect(within(stageRow("Write image prompts")).getByRole("button", { name: "Retry" }))
      .toHaveProperty("disabled", !retryable);
    if (problemCode === "HOSTED_PROMPT_OUTPUT_INVALID")
      expect(screen.getAllByText(/original provider result was invalid/u).length).toBeGreaterThan(0);
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/prompts"))).toBe(false);
  });

  it("shows final and batch-accepted prompts while Stage 5 writes the next batch", async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      void input;
      return Response.json({
        project: {
          id: projectId,
          title: "Private project",
          created_at: "2026-08-17T10:00:00.000Z",
          revision_id: "22222222-2222-4222-8222-222222222222",
          revision_state: "LOCKED",
        },
        attempts: [],
        gpu_transport: "DISABLED_UNQUALIFIED" as const,
        gpu_readiness: gpuReadiness,
        voiceover_context: {
          id: "44444444-4444-4444-8444-444444444444",
          state: "SUCCEEDED" as const,
          transcript_hash: `sha256:${"b".repeat(64)}`,
          context_hash: `sha256:${"c".repeat(64)}`,
          context_document: { primary_topic: "Private project" },
          reserved_cost_micro_usd: 10_000,
        },
        generation: {
          id: "55555555-5555-4555-8555-555555555555",
          timeline_plan_sha256: `sha256:${"f".repeat(64)}`,
          planned_tasks: 25,
          completed_tasks: 0,
          failed_tasks: 0,
          stage: "WAITING_FOR_GPU_QUALIFICATION" as const,
        },
        stages: [
          {
            id: "prompt-writing",
            name: "Write image prompts",
            status: "RUNNING",
            progress_percent: 50,
          },
        ],
        prompts: [
          {
            scene_ordinal: 0,
            scene_id: "scene-one",
            narration: "A maker checks the first prototype at a workbench.",
            in_image_shot_role: "HUMAN_MEDIUM",
            timeline_composition: "IMAGE_FULL",
            positive_prompt:
              "Natural documentary photograph of a maker checking a worn prototype at a cluttered workbench.",
            negative_prompt: "text, captions, logos, motion graphics, staged advertising pose",
            image_style_version_id: "style-version",
            style_profile_hash: `sha256:${"d".repeat(64)}`,
            style_name: "Documentary",
            durable: true,
          },
          {
            scene_ordinal: 1,
            scene_id: "scene-draft",
            narration: "This row was saved with the accepted first batch.",
            in_image_shot_role: "HUMAN_DETAIL",
            timeline_composition: "IMAGE_FULL",
            positive_prompt: "Batch-accepted practical prompt",
            negative_prompt: "",
            image_style_version_id: "style-version",
            style_profile_hash: `sha256:${"d".repeat(64)}`,
            style_name: "Documentary",
            durable: false,
          },
        ],
        prompt_progress: {
          total_scenes: 4,
          accepted_scenes: 2,
          total_batches: 2,
          accepted_batches: 1,
          active_batch_ordinal: 2,
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderHosted(<HostedProjectScreen projectId={projectId} />);

    expect(await screen.findByText("Batch 2 of 2 · 2 / 4 prompts accepted")).toBeInTheDocument();
    expect(screen.getByText("2 / 4 prompts accepted")).toBeInTheDocument();
    const promptRegion = screen.getByRole("region", { name: "Accepted image prompts" });
    expect(within(promptRegion).getAllByRole("listitem")).toHaveLength(2);
    expect(within(promptRegion).getByText(/maker checking a worn prototype/u)).toBeInTheDocument();
    expect(within(promptRegion).getByText("Batch-accepted practical prompt")).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/prompts"))).toBe(false);
  });

  it("shows every accepted Stage 5 prompt in the compact prompt region", async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          project: {
            id: projectId,
            title: "Private project",
            created_at: "2026-08-17T10:00:00.000Z",
            revision_id: "22222222-2222-4222-8222-222222222222",
            revision_state: "LOCKED",
          },
          attempts: [],
          gpu_transport: "DISABLED_UNQUALIFIED" as const,
          gpu_readiness: gpuReadiness,
          voiceover_context: {
            id: "44444444-4444-4444-8444-444444444444",
            state: "SUCCEEDED" as const,
            transcript_hash: `sha256:${"b".repeat(64)}`,
            context_hash: `sha256:${"c".repeat(64)}`,
            context_document: { primary_topic: "Private project" },
            reserved_cost_micro_usd: 10_000,
          },
          generation: {
            id: "55555555-5555-4555-8555-555555555555",
            timeline_plan_sha256: `sha256:${"f".repeat(64)}`,
            planned_tasks: 2,
            completed_tasks: 0,
            failed_tasks: 0,
            stage: "WAITING_FOR_GPU_QUALIFICATION" as const,
          },
          stages: [
            {
              id: "prompt-writing",
              name: "Write image prompts",
              status: "COMPLETE",
              progress_percent: 100,
            },
          ],
          prompts: [
            {
              scene_ordinal: 0,
              scene_id: "scene-one",
              narration: "A maker checks the first prototype at a workbench.",
              in_image_shot_role: "wide_establishing",
              timeline_composition: "centered workbench",
              positive_prompt: "Documentary footage of a maker inspecting a real prototype.",
              negative_prompt: "text, captions, motion graphics, staged stock-photo posing",
              image_style_version_id: "style-version",
              style_profile_hash: `sha256:${"d".repeat(64)}`,
              style_name: "Documentary",
            },
            {
              scene_ordinal: 1,
              scene_id: "scene-two",
              narration: "Her hands adjust the worn metal mechanism.",
              in_image_shot_role: "detail_insert",
              timeline_composition: "hands and mechanism",
              positive_prompt: "Close documentary detail of hands adjusting worn metal parts.",
              negative_prompt: "logos, watermarks, interface text, implausible hands",
              image_style_version_id: "style-version",
              style_profile_hash: `sha256:${"d".repeat(64)}`,
              style_name: "Documentary",
            },
          ],
        }),
      ),
    );
    renderHosted(<HostedProjectScreen projectId={projectId} />);

    expect(await screen.findByText("2 accepted prompts")).toBeInTheDocument();
    const promptRegion = screen.getByRole("region", { name: "Accepted image prompts" });
    expect(within(promptRegion).getAllByRole("listitem")).toHaveLength(2);
    expect(
      within(promptRegion).getByText(/maker inspecting a real prototype/u),
    ).toBeInTheDocument();
    expect(within(promptRegion).getByText(/implausible hands/u)).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Voiceover-to-image plan" }),
    ).not.toBeInTheDocument();
  });

  it("starts the ready V2-09 pair exactly once and shows only its opaque correlation ID", async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    let resolveDispatch!: (response: Response) => void;
    const dispatchResponse = new Promise<Response>((resolve) => {
      resolveDispatch = resolve;
    });
    const detail = {
      project: {
        id: projectId,
        title: "Private project",
        created_at: "2026-09-06T10:00:00.000Z",
        revision_id: "22222222-2222-4222-8222-222222222222",
        revision_state: "LOCKED",
      },
      attempts: [],
      gpu_transport: "QUALIFIED_EXACT" as const,
      gpu_readiness: qualifiedGpuReadiness,
      voiceover_context: {
        id: "33333333-3333-4333-8333-333333333333",
        state: "SUCCEEDED" as const,
        transcript_hash: `sha256:${"a".repeat(64)}`,
        reserved_cost_micro_usd: 10_000,
      },
      generation: {
        id: "44444444-4444-4444-8444-444444444444",
        timeline_plan_sha256: `sha256:${"b".repeat(64)}`,
        planned_tasks: 2,
        completed_tasks: 0,
        failed_tasks: 0,
        stage: "READY_FOR_GPU_DISPATCH" as const,
      },
      queue: null,
      stages: [
        {
          id: "prompt-writing",
          name: "Write image prompts",
          status: "COMPLETE",
          progress_percent: 100,
        },
      ],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/gpu-dispatch")) {
        expect(init).toMatchObject({ method: "POST", body: "{}" });
        expect(Object.keys(init?.headers ?? {})).not.toContain("authorization");
        return dispatchResponse;
      }
      return Response.json(detail);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderHosted(<HostedProjectScreen projectId={projectId} />);

    expect(await screen.findByText(/Generation is starting/u)).toBeInTheDocument();
    resolveDispatch(
      Response.json(
        {
          schema_version: "videoforge-hosted-v209-project-dispatch/v1",
          state: "SCHEDULED",
          generation_request_id: "private-generation-id",
          workflow_id: "private-workflow-id",
          correlation_id: "v209-correlation-a",
        },
        { status: 202 },
      ),
    );
    const correlationId = await screen.findByText("v209-correlation-a");
    expect(correlationId.parentElement).toHaveTextContent(
      "Generation is running. Correlation ID: v209-correlation-a",
    );
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/gpu-dispatch")),
      ).toHaveLength(1),
    );
    expect(screen.queryByText("private-generation-id")).not.toBeInTheDocument();
    expect(screen.queryByText("private-workflow-id")).not.toBeInTheDocument();
  });

  it.each(["mount", "refresh", "queued-only"])(
    "uses durable span progress after %s instead of redispatching",
    async (mode) => {
      const projectId = "11111111-1111-4111-8111-111111111111";
      const detail = {
        project: {
          id: projectId,
          title: "Private project",
          created_at: "2026-09-06T10:00:00.000Z",
          revision_id: "22222222-2222-4222-8222-222222222222",
          revision_state: "LOCKED",
        },
        attempts: [],
        gpu_transport: "QUALIFIED_EXACT" as const,
        gpu_readiness: qualifiedGpuReadiness,
        generation: {
          id: "44444444-4444-4444-8444-444444444444",
          timeline_plan_sha256: `sha256:${"b".repeat(64)}`,
          planned_tasks: 2,
          completed_tasks: 0,
          failed_tasks: 0,
          stage: "READY_FOR_GPU_DISPATCH" as const,
        },
        queue: { status: "ACTIVE", position: 1, ahead: 0, total: 1 },
        stages: [
          {
            id: "prompt-writing",
            name: "Write image prompts",
            status: "COMPLETE",
            progress_percent: 100,
          },
        ],
      };
      const spanAudio = {
        total: 65,
        materialized: 32,
        planned: 0,
        running: 1,
        queued: 32,
        succeeded: 32,
        failed: 0,
      };
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      let dispatches = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) => {
          if (String(input).endsWith("/gpu-dispatch")) {
            dispatches += 1;
            return Response.json({ error: { code: "HOSTED_PAIR_ACK_UNKNOWN" } }, { status: 504 });
          }
          return Response.json({
            ...detail,
            ...(mode === "mount" ? { span_audio: spanAudio } : {}),
            ...(mode === "queued-only"
              ? {
                  span_audio: {
                    ...spanAudio,
                    materialized: 0,
                    running: 0,
                    queued: 65,
                    succeeded: 0,
                  },
                }
              : {}),
          });
        }),
      );
      render(
        <QueryClientProvider client={client}>
          <HostedProjectScreen projectId={projectId} />
        </QueryClientProvider>,
      );
      if (mode === "queued-only") {
        expect(await screen.findByRole("button", { name: "Retry generation" })).toBeInTheDocument();
        expect(dispatches).toBe(1);
        expect(
          screen.queryByText("Preparing exact avatar audio. Generation continues when ready."),
        ).not.toBeInTheDocument();
        client.clear();
        return;
      }
      if (mode === "refresh") {
        expect(
          await screen.findByText(/VideoForge will not retry automatically/u),
        ).toBeInTheDocument();
        act(() => {
          client.setQueryData(["hosted-project", projectId], { ...detail, span_audio: spanAudio });
        });
      }
      expect(
        await screen.findByText("Preparing exact avatar audio. Generation continues when ready."),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Retry generation" })).not.toBeInTheDocument();
      expect(
        screen.queryByText(/Generation start could not be confirmed/u),
      ).not.toBeInTheDocument();
      expect(dispatches).toBe(mode === "mount" ? 0 : 1);
      if (mode === "mount") {
        // Once preparation completes, the normal dispatch handoff remains available.
        act(() => {
          client.setQueryData(["hosted-project", projectId], {
            ...detail,
            span_audio: { ...spanAudio, materialized: 65, running: 0, queued: 0, succeeded: 65 },
          });
        });
        expect(await screen.findByRole("button", { name: "Retry generation" })).toBeInTheDocument();
        expect(dispatches).toBe(1);
      }
      if (mode === "refresh") {
        act(() => {
          client.setQueryData(["hosted-project", projectId], {
            ...detail,
            span_audio: { ...spanAudio, failed: 1 },
          });
        });
        expect(await screen.findByRole("button", { name: "Retry generation" })).toBeInTheDocument();
        expect(dispatches).toBe(1);
      }
      client.clear();
    },
  );

  it("never automatically redispatches an uncertain start and retries only through the same seam", async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    const detail = {
      project: {
        id: projectId,
        title: "Private project",
        created_at: "2026-09-06T10:00:00.000Z",
        revision_id: "22222222-2222-4222-8222-222222222222",
        revision_state: "LOCKED",
      },
      attempts: [],
      gpu_transport: "QUALIFIED_EXACT" as const,
      gpu_readiness: qualifiedGpuReadiness,
      generation: {
        id: "44444444-4444-4444-8444-444444444444",
        timeline_plan_sha256: `sha256:${"b".repeat(64)}`,
        planned_tasks: 2,
        completed_tasks: 0,
        failed_tasks: 0,
        stage: "READY_FOR_GPU_DISPATCH" as const,
      },
      queue: { status: "ACTIVE", position: 1, ahead: 0, total: 1 },
      stages: [
        {
          id: "prompt-writing",
          name: "Write image prompts",
          status: "COMPLETE",
          progress_percent: 100,
        },
      ],
    };
    let dispatches = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (!path.endsWith("/gpu-dispatch")) return Response.json(detail);
      expect(init).toMatchObject({ method: "POST", body: "{}" });
      dispatches += 1;
      if (dispatches === 1)
        return Response.json({ error: { code: "HOSTED_PAIR_ACK_UNKNOWN" } }, { status: 504 });
      return Response.json(
        {
          schema_version: "videoforge-hosted-v209-project-dispatch/v1",
          state: "SCHEDULED",
          generation_request_id: "private-generation-id",
          workflow_id: "private-workflow-id",
          correlation_id: "v209-correlation-recovered",
        },
        { status: 202 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    renderHosted(<HostedProjectScreen projectId={projectId} />);

    expect(await screen.findByText(/VideoForge will not retry automatically/u)).toBeInTheDocument();
    await new Promise((resolve) => window.setTimeout(resolve, 25));
    expect(dispatches).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Retry generation" }));
    expect(await screen.findByText(/v209-correlation-recovered/u)).toBeInTheDocument();
    expect(dispatches).toBe(2);
    expect(
      fetchMock.mock.calls
        .filter(([input]) => String(input).endsWith("/gpu-dispatch"))
        .every(([input]) => String(input) === `/api/v2/hosted/projects/${projectId}/gpu-dispatch`),
    ).toBe(true);
  });

  it("clears a stale uncertain-start notice after durable generation begins", async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const beforeStart = {
      project: {
        id: projectId,
        title: "Private project",
        created_at: "2026-09-06T10:00:00.000Z",
        revision_id: "22222222-2222-4222-8222-222222222222",
        revision_state: "LOCKED",
      },
      attempts: [],
      gpu_transport: "QUALIFIED_EXACT" as const,
      gpu_readiness: qualifiedGpuReadiness,
      generation: {
        id: "44444444-4444-4444-8444-444444444444",
        timeline_plan_sha256: `sha256:${"b".repeat(64)}`,
        planned_tasks: 2,
        completed_tasks: 0,
        failed_tasks: 0,
        stage: "READY_FOR_GPU_DISPATCH" as const,
      },
      queue: { status: "ACTIVE", position: 1, ahead: 0, total: 1 },
      stages: [
        {
          id: "prompt-writing",
          name: "Write image prompts",
          status: "COMPLETE",
          progress_percent: 100,
        },
      ],
    };
    const afterStart = {
      ...beforeStart,
      stages: [
        ...beforeStart.stages,
        {
          id: "audio-spanning",
          name: "Audio spanning",
          status: "COMPLETE",
          progress_percent: 100,
        },
        {
          id: "image-generation",
          name: "Generate images",
          status: "COMPLETE",
          progress_percent: 100,
        },
        {
          id: "avatar-generation",
          name: "Generate avatar video",
          status: "RUNNING",
          progress_percent: 4,
        },
        { id: "render", name: "Assemble final video", status: "RUNNING", progress_percent: 0 },
      ],
    };
    let dispatches = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith("/gpu-dispatch")) {
          dispatches += 1;
          return Response.json({ error: { code: "HOSTED_PAIR_ACK_UNKNOWN" } }, { status: 504 });
        }
        return Response.json(beforeStart);
      }),
    );
    render(
      <QueryClientProvider client={client}>
        <HostedProjectScreen projectId={projectId} />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByText(/Generation start could not be confirmed/u),
    ).toBeInTheDocument();
    expect(dispatches).toBe(1);
    act(() => client.setQueryData(["hosted-project", projectId], afterStart));
    await waitFor(() => {
      expect(
        screen.queryByText(/Generation start could not be confirmed/u),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Retry generation" })).not.toBeInTheDocument();
    });
    expect(dispatches).toBe(1);

    act(() =>
      client.setQueryData(["hosted-project", projectId], {
        ...afterStart,
        stages: afterStart.stages.map((stage) =>
          stage.id === "avatar-generation"
            ? { ...stage, status: "COMPLETE", progress_percent: 100 }
            : stage.id === "render"
              ? { ...stage, status: "FAILED" }
              : stage,
        ),
      }),
    );
    expect(
      screen.queryByText(/Generation start could not be confirmed/u),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry generation" })).not.toBeInTheDocument();
    expect(dispatches).toBe(1);
  });

  it("shows confirmed pre-send candidate validation failure without a retry action", async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (!String(input).endsWith("/gpu-dispatch"))
        return Response.json({
          project: {
            id: projectId,
            title: "Private project",
            created_at: "2026-09-06T10:00:00.000Z",
            revision_id: "22222222-2222-4222-8222-222222222222",
            revision_state: "LOCKED",
          },
          attempts: [],
          gpu_transport: "QUALIFIED_EXACT" as const,
          gpu_readiness: qualifiedGpuReadiness,
          generation: {
            id: "44444444-4444-4444-8444-444444444444",
            timeline_plan_sha256: `sha256:${"b".repeat(64)}`,
            planned_tasks: 2,
            completed_tasks: 0,
            failed_tasks: 0,
            stage: "READY_FOR_GPU_DISPATCH" as const,
          },
          queue: { status: "ACTIVE", position: 1, ahead: 0, total: 1 },
          stages: [
            {
              id: "prompt-writing",
              name: "Write image prompts",
              status: "COMPLETE",
              progress_percent: 100,
            },
          ],
        });
      return Response.json(
        {
          error: {
            code: "V209_ORDINARY_CANDIDATE_HASH_INVALID",
            message: "Generation has not started. Prepared generation data failed validation.",
            retryable: false,
            phase: "PRE_SEND",
          },
        },
        { status: 409 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    renderHosted(<HostedProjectScreen projectId={projectId} />);

    expect(
      await screen.findByText(
        "Generation has not started. Prepared generation data failed validation.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry generation" })).not.toBeInTheDocument();
  });

  it.each(["MAGE_IMAGE", "SOULX_AVATAR"])(
    "does not offer generation resume after a %s attempt exists",
    async (kind) => {
      const projectId = "11111111-1111-4111-8111-111111111111";
      const fetchMock = vi.fn(async () =>
        Response.json({
          project: {
            id: projectId,
            title: "Stopped generation",
            revision_id: "22222222-2222-4222-8222-222222222222",
            revision_state: "LOCKED",
          },
          attempts: [
            {
              id: "33333333-3333-4333-8333-333333333333",
              kind,
              state: "FAILED",
              approved_at: null,
            },
          ],
          gpu_transport: "QUALIFIED_EXACT",
          gpu_readiness: qualifiedGpuReadiness,
          generation: { id: "44444444-4444-4444-8444-444444444444", stage: "FAILED" },
          queue: { status: "ACTIVE" },
          stages: [
            {
              id: "prompt-writing",
              name: "Write image prompts",
              status: "COMPLETE",
              progress_percent: 100,
            },
          ],
        }),
      );
      vi.stubGlobal("fetch", fetchMock);
      renderHosted(<HostedProjectScreen projectId={projectId} />);
      await screen.findByRole("heading", { name: "Stopped generation" });
      expect(screen.queryByRole("button", { name: "Resume generation" })).not.toBeInTheDocument();
      expect(fetchMock.mock.calls).toHaveLength(1);
    },
  );

  it("resumes one same-generation dispatch after server-owned span audio preparation", async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    const base = {
      project: {
        id: projectId,
        title: "Private project",
        created_at: "2026-09-06T10:00:00.000Z",
        revision_id: "22222222-2222-4222-8222-222222222222",
        revision_state: "LOCKED",
      },
      gpu_transport: "QUALIFIED_EXACT" as const,
      gpu_readiness: qualifiedGpuReadiness,
      voiceover_context: {
        id: "33333333-3333-4333-8333-333333333333",
        state: "SUCCEEDED" as const,
        transcript_hash: `sha256:${"a".repeat(64)}`,
        reserved_cost_micro_usd: 10_000,
      },
      generation: {
        id: "44444444-4444-4444-8444-444444444444",
        timeline_plan_sha256: `sha256:${"b".repeat(64)}`,
        planned_tasks: 2,
        completed_tasks: 0,
        failed_tasks: 0,
        stage: "READY_FOR_GPU_DISPATCH" as const,
      },
      queue: { status: "ACTIVE", position: 1, ahead: 0, total: 1 },
      stages: [{ id: "prompt-writing", name: "Write image prompts", status: "COMPLETE" }],
    };
    const spanAttempts = [
      {
        id: "55555555-5555-4555-8555-555555555555",
        kind: "SPAN_AUDIO" as const,
        state: "SUCCEEDED",
        version: 1,
        created_at: "2026-09-06T10:00:00.000Z",
        updated_at: "2026-09-06T10:01:00.000Z",
        terminal_at: "2026-09-06T10:01:00.000Z",
        output_checksum_sha256: `sha256:${"c".repeat(64)}`,
        approved_at: null,
        preview_url: null,
      },
      {
        id: "66666666-6666-4666-8666-666666666666",
        kind: "SPAN_AUDIO" as const,
        state: "SUCCEEDED",
        version: 1,
        created_at: "2026-09-06T10:00:00.000Z",
        updated_at: "2026-09-06T10:01:00.000Z",
        terminal_at: "2026-09-06T10:01:00.000Z",
        output_checksum_sha256: `sha256:${"d".repeat(64)}`,
        approved_at: null,
        preview_url: null,
      },
    ];
    let phase: "READY" | "PREPARING" | "READY_AFTER_INPUTS" | "RUNNING" = "READY";
    let preparationReads = 0;
    let dispatches = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (!String(input).endsWith("/gpu-dispatch")) {
        if (phase === "PREPARING") {
          preparationReads += 1;
          if (preparationReads >= 2) phase = "READY_AFTER_INPUTS";
        }
        return Response.json({
          ...base,
          attempts: phase === "READY" ? [] : spanAttempts,
          generation: {
            ...base.generation,
            stage:
              phase === "PREPARING"
                ? "ACTIVE"
                : phase === "RUNNING"
                  ? "ACTIVE"
                  : "READY_FOR_GPU_DISPATCH",
          },
          stages:
            phase === "PREPARING"
              ? [
                  ...base.stages,
                  { id: "image-generation", name: "Generate images", status: "RUNNING" },
                ]
              : base.stages,
        });
      }
      dispatches += 1;
      if (dispatches === 1) phase = "PREPARING";
      else phase = "RUNNING";
      return Response.json(
        {
          schema_version: "videoforge-hosted-v209-project-dispatch/v1",
          state: dispatches === 1 ? "PREPARING_INPUTS" : "SCHEDULED",
          generation_request_id: base.generation.id,
          correlation_id: `v209-span-${dispatches}`,
        },
        { status: 202 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    renderHosted(<HostedProjectScreen projectId={projectId} />);

    expect(await screen.findByText(/Preparing exact avatar audio/u)).toBeInTheDocument();
    await waitFor(() => expect(dispatches).toBe(2), { timeout: 6_000 });
    expect(base.generation.id).toBe("44444444-4444-4444-8444-444444444444");
    expect(
      fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/gpu-dispatch")),
    ).toHaveLength(2);
    expect(await screen.findByText(/Generation is running/u)).toBeInTheDocument();
  });

  it("uses provider lane truth for stage outcome and item counters", async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    const detail = {
      project: {
        id: projectId,
        title: "Terminal pair",
        created_at: "2026-09-06T10:00:00.000Z",
        revision_id: "22222222-2222-4222-8222-222222222222",
        revision_state: "LOCKED",
      },
      attempts: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          kind: "MAGE_IMAGE" as const,
          state: "PERMANENT_FAILED",
          version: 1,
          created_at: "2026-09-06T10:00:00.000Z",
          updated_at: "2026-09-06T10:01:00.000Z",
          terminal_at: "2026-09-06T10:01:00.000Z",
          output_checksum_sha256: null,
          approved_at: null,
          preview_url: null,
        },
        {
          id: "44444444-4444-4444-8444-444444444444",
          kind: "SOULX_AVATAR" as const,
          state: "SUCCEEDED",
          version: 1,
          created_at: "2026-09-06T10:00:00.000Z",
          updated_at: "2026-09-06T10:01:00.000Z",
          terminal_at: "2026-09-06T10:01:00.000Z",
          output_checksum_sha256: `sha256:${"a".repeat(64)}`,
          approved_at: null,
          preview_url: null,
        },
        {
          id: "66666666-6666-4666-8666-666666666666",
          kind: "ASR" as const,
          state: "SUCCEEDED",
          version: 1,
          created_at: "2026-09-06T10:00:00.000Z",
          updated_at: "2026-09-06T10:01:00.000Z",
          terminal_at: "2026-09-06T10:01:00.000Z",
          output_checksum_sha256: `sha256:${"c".repeat(64)}`,
          approved_at: null,
          preview_url: null,
        },
      ],
      gpu_transport: "QUALIFIED_EXACT" as const,
      gpu_readiness: qualifiedGpuReadiness,
      voiceover_context: {
        id: "77777777-7777-4777-8777-777777777777",
        state: "SUCCEEDED" as const,
        transcript_hash: `sha256:${"c".repeat(64)}`,
        reserved_cost_micro_usd: 0,
      },
      generation: {
        id: "55555555-5555-4555-8555-555555555555",
        timeline_plan_sha256: `sha256:${"b".repeat(64)}`,
        planned_tasks: 276,
        completed_tasks: 65,
        failed_tasks: 1,
        stage: "FAILED" as const,
      },
      stages: [
        { id: "image-generation", name: "Generate images", status: "FAILED", progress_percent: 0 },
        {
          id: "avatar-generation",
          name: "Generate avatar video",
          status: "FAILED",
          progress_percent: 0,
        },
      ],
      gpu_lanes: [
        {
          lane: "mage_image" as const,
          attempt_state: "PERMANENT_FAILED",
          provider_status: "IN_PROGRESS",
          runtime_state: "FAILED",
          planned_item_count: 211,
          accepted_item_count: 0,
          attempt_ordinal: 1,
          submitted_at: "2026-09-06T10:00:00.000Z",
          created_at: "2026-09-06T10:00:00.000Z",
          terminal_at: "2026-09-06T10:01:00.000Z",
        },
        {
          lane: "soulx_avatar" as const,
          attempt_state: "ASSIGNED",
          provider_status: "COMPLETED",
          runtime_state: "FAILED",
          planned_item_count: 65,
          accepted_item_count: 65,
          attempt_ordinal: 1,
          submitted_at: "2026-09-06T10:00:00.000Z",
          created_at: "2026-09-06T10:00:00.000Z",
          terminal_at: "2026-09-06T10:01:00.000Z",
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith("/render")
          ? Response.json({ state: "WAITING_FOR_GPU_QUALIFICATION", missing_lane_gates: [] })
          : Response.json(detail),
      ),
    );

    renderHosted(<HostedProjectScreen projectId={projectId} />);

    const stageList = await screen.findByRole("list", { name: "Project stages" });
    const imageStage = within(stageList).getByText("Generate images").closest("li");
    const avatarStage = within(stageList).getByText("Generate avatar video").closest("li");
    expect(imageStage).not.toBeNull();
    expect(avatarStage).not.toBeNull();
    expect(within(imageStage!).getByText("FAILED")).toBeInTheDocument();
    expect(within(imageStage!).getByText("0/211")).toBeInTheDocument();
    expect(within(avatarStage!).getByText("COMPLETE")).toBeInTheDocument();
    expect(
      screen.getAllByText("0 of 211 accepted · The provider run ended without an accepted result."),
    ).toHaveLength(2);
    expect(screen.getByText("65 of 65 accepted · All items accepted.")).toBeInTheDocument();
    expect(await screen.findByText("Generation stopped.")).toBeInTheDocument();
    expect(screen.queryByText("Ready to generate.")).not.toBeInTheDocument();
  });

  it("shows waiting for GPU capacity and keeps queued lanes live", async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    let dispatches = 0;
    const detail = {
      project: {
        id: projectId,
        title: "Queued pair",
        created_at: "2026-09-06T10:00:00.000Z",
        revision_id: "22222222-2222-4222-8222-222222222222",
        revision_state: "LOCKED",
      },
      attempts: [],
      gpu_transport: "QUALIFIED_EXACT" as const,
      gpu_readiness: qualifiedGpuReadiness,
      generation: {
        id: "55555555-5555-4555-8555-555555555555",
        timeline_plan_sha256: `sha256:${"b".repeat(64)}`,
        planned_tasks: 276,
        completed_tasks: 0,
        failed_tasks: 0,
        stage: "READY_FOR_GPU_DISPATCH" as const,
      },
      queue: { status: "ACTIVE", position: 1, ahead: 0, total: 1 },
      stages: [
        {
          id: "prompt-writing",
          name: "Write image prompts",
          status: "COMPLETE",
          progress_percent: 100,
        },
        {
          id: "image-generation",
          name: "Generate images",
          status: "WAITING_FOR_GPU_QUALIFICATION",
          progress_percent: 0,
        },
        {
          id: "avatar-generation",
          name: "Generate avatar video",
          status: "WAITING_FOR_GPU_QUALIFICATION",
          progress_percent: 0,
        },
      ],
      gpu_lanes: [
        {
          lane: "mage_image" as const,
          attempt_state: "ASSIGNED",
          provider_status: "IN_QUEUE",
          runtime_state: "WAITING_FOR_WORKER",
          planned_item_count: 211,
          accepted_item_count: 0,
          attempt_ordinal: 1,
          submitted_at: null,
          created_at: "2026-09-06T10:00:00.000Z",
          terminal_at: null,
        },
        {
          lane: "soulx_avatar" as const,
          attempt_state: "ASSIGNED",
          provider_status: "IN_QUEUE",
          runtime_state: "WAITING_FOR_WORKER",
          planned_item_count: 65,
          accepted_item_count: 0,
          attempt_ordinal: 1,
          submitted_at: null,
          created_at: "2026-09-06T10:00:00.000Z",
          terminal_at: null,
        },
      ],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/gpu-dispatch")) {
        dispatches += 1;
        return Response.json(
          {
            schema_version: "videoforge-hosted-v209-project-dispatch/v1",
            state: "WAITING_FOR_GPUS",
            retry_after_seconds: 30,
            correlation_id: "v209-gpu-wait",
          },
          { status: 202 },
        );
      }
      return Response.json(detail);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderHosted(<HostedProjectScreen projectId={projectId} />);

    expect(
      await screen.findByText(
        "Waiting for GPUs. Generation will start automatically when capacity opens.",
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Waiting for GPUs").length).toBeGreaterThanOrEqual(2);
    expect(
      screen.getAllByText(
        "0 of 211 accepted · No GPU worker is available yet. Your generation will start automatically when capacity opens.",
      ),
    ).toHaveLength(2);
    await waitFor(() => expect(dispatches).toBe(1));
    expect(screen.queryByText(/Generation start could not be confirmed/u)).not.toBeInTheDocument();
    expect(screen.getByText("Projected cost")).toBeInTheDocument();
  });

  it("shows independent progress when images run while avatar waits for GPU", async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    const detail = {
      project: {
        id: projectId,
        title: "Provider progress pair",
        created_at: "2026-09-06T10:00:00.000Z",
        revision_id: "22222222-2222-4222-8222-222222222222",
        revision_state: "LOCKED",
      },
      attempts: [],
      gpu_transport: "QUALIFIED_EXACT" as const,
      gpu_readiness: qualifiedGpuReadiness,
      generation: {
        id: "55555555-5555-4555-8555-555555555555",
        timeline_plan_sha256: `sha256:${"b".repeat(64)}`,
        planned_tasks: 276,
        completed_tasks: 0,
        failed_tasks: 0,
        stage: "READY_FOR_GPU_DISPATCH" as const,
      },
      queue: { status: "ACTIVE", position: 1, ahead: 0, total: 1 },
      stages: [
        {
          id: "prompt-writing",
          name: "Write image prompts",
          status: "COMPLETE",
          progress_percent: 100,
        },
        { id: "image-generation", name: "Generate images", status: "RUNNING", progress_percent: 0 },
        {
          id: "avatar-generation",
          name: "Generate avatar video",
          status: "RUNNING",
          progress_percent: 0,
        },
      ],
      gpu_lanes: [
        {
          lane: "mage_image" as const,
          attempt_state: "ASSIGNED",
          provider_status: "IN_PROGRESS",
          runtime_state: "WAITING_FOR_WORKER",
          planned_item_count: 206,
          accepted_item_count: 0,
          attempt_ordinal: 1,
          submitted_at: null,
          created_at: "2026-09-06T10:00:00.000Z",
          terminal_at: null,
        },
        {
          lane: "soulx_avatar" as const,
          attempt_state: "ASSIGNED",
          provider_status: "IN_QUEUE",
          runtime_state: "WAITING_FOR_WORKER",
          planned_item_count: 64,
          accepted_item_count: 0,
          attempt_ordinal: 1,
          submitted_at: null,
          created_at: "2026-09-06T10:00:00.000Z",
          terminal_at: null,
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith("/gpu-dispatch")
          ? Response.json({
              schema_version: "videoforge-hosted-v209-project-dispatch/v1",
              state: "SCHEDULED",
              correlation_id: "v209-provider-progress",
            })
          : Response.json(detail),
      ),
    );

    renderHosted(<HostedProjectScreen projectId={projectId} />);

    expect((await screen.findAllByText("Waiting for GPUs")).length).toBeGreaterThanOrEqual(2);
    const stageList = await screen.findByRole("list", { name: "Project stages" });
    const imageStage = within(stageList).getByText("Generate images").closest("li");
    const avatarStage = within(stageList).getByText("Generate avatar video").closest("li");
    expect(imageStage).not.toBeNull();
    expect(avatarStage).not.toBeNull();
    expect(within(imageStage!).getByText("RUNNING")).toBeInTheDocument();
    expect(within(avatarStage!).getByText("QUEUED")).toBeInTheDocument();
    expect(within(imageStage!).getByText("0/206")).toBeInTheDocument();
    expect(
      within(avatarStage!).getByText(
        "0 of 64 accepted · No GPU worker is available yet. Your generation will start automatically when capacity opens.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(
        "0 of 206 accepted · The provider has not reported any completed items yet.",
      ),
    ).toHaveLength(2);
  });

  it("reports only measured personal-worker and retained-object facts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          current_month_provider_cpu_usd: 0,
          current_month_gpu_usd: 0,
          attempts: 4,
          succeeded: 2,
          failed: 1,
          personal_worker_seconds: 125,
          retained_bytes: 1_073_741_824,
          storage_policy: "DURABLE_UNTIL_EXPLICIT_DELETE",
        }),
      ),
    );
    renderHosted(<HostedUsageScreen />);

    expect(await screen.findByText("2m 05s")).toBeInTheDocument();
    expect(screen.getByText("1.000 GB")).toBeInTheDocument();
    expect(screen.getByText("Not tracked")).toBeInTheDocument();
    expect(screen.queryByText(/estimated/u)).not.toBeInTheDocument();
  });
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="#hosted-route">{children}</a>,
}));

import {
  HostedAvatarHubScreen,
  HostedCreateProjectScreen,
  HostedPresetCreationUnavailableScreen,
  HostedProjectScreen,
  HostedStylesHubScreen,
  HostedUsageScreen,
  audioDurationMs,
  parseWavDurationMs,
} from "./HostedProductScreens";

function renderHosted(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("hosted product journey", () => {
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

  it("loads the tenant-owned avatar and style catalog without fixture API calls", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (!String(input).endsWith("/api/v2/hosted/project-catalog")) {
        throw new Error(`Unexpected hosted request: ${String(input)}`);
      }
      return Response.json({
        avatars: [{ profile_id: "p1", version_id: "a1", name: "Owner", version_number: 1 }],
        styles: [{ style_id: "s1", version_id: "sv1", name: "Documentary", version_number: 1 }],
        media_worker_state: "ONLINE",
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
      vi.fn(async () => Response.json({ avatars: [], styles: [], media_worker_state: "ONLINE" })),
    );
    renderHosted(<HostedAvatarHubScreen />);

    expect(await screen.findByText("No ready avatars yet")).toBeInTheDocument();
    expect(screen.getByText(/activation owner must provision/u)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Settings" })).toBeInTheDocument();
  });

  it("does not expose fixture-only preset mutation screens in hosted staging", () => {
    renderHosted(<HostedPresetCreationUnavailableScreen kind="styles" />);

    expect(screen.getByText("Image Styles creation unavailable")).toBeInTheDocument();
    expect(screen.getByText("Read-only hosted catalog")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Image Styles" })).toBeInTheDocument();
  });

  it("blocks generation until the account-owned personal worker is online", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          avatars: [{ profile_id: "p1", version_id: "a1", name: "Owner", version_number: 1 }],
          styles: [{ style_id: "s1", version_id: "sv1", name: "Documentary", version_number: 1 }],
          media_worker_state: "WAITING_FOR_YOUR_COMPUTER",
        }),
      ),
    );
    renderHosted(<HostedCreateProjectScreen />);

    expect(await screen.findByText("Waiting for your computer.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create and transcribe" })).toBeDisabled();
    expect(screen.getByText(/GPU transport disabled during V2-06 staging/u)).toBeInTheDocument();
  });

  it("fails closed when ASR succeeds without an exact render plan", async () => {
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
      gpu_transport: "DISABLED_FAKE_ONLY" as const,
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/render"))
        return Response.json({ error: { code: "HOSTED_RENDER_PLAN_NOT_READY" } }, { status: 409 });
      return Response.json(detail);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderHosted(<HostedProjectScreen projectId="11111111-1111-4111-8111-111111111111" />);

    expect(
      await screen.findByText(/render is waiting for the exact project plan/u),
    ).toBeInTheDocument();
    expect(screen.getByText(/HOSTED_RENDER_PLAN_NOT_READY/u)).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([input]) => String(input).endsWith("/api/v2/cpu-attempts")),
    ).toBe(false);
    expect(screen.queryByRole("link", { name: "Review video" })).not.toBeInTheDocument();
  });

  it("hands a successful ASR result to the owned render attempt", async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    const revisionId = "22222222-2222-4222-8222-222222222222";
    const asrId = "33333333-3333-4333-8333-333333333333";
    const renderId = "44444444-4444-4444-8444-444444444444";
    const manifestHash = `sha256:${"c".repeat(64)}`;
    const voiceoverHash = `sha256:${"a".repeat(64)}`;
    const avatarHash = `sha256:${"d".repeat(64)}`;
    const imageHash = `sha256:${"e".repeat(64)}`;
    const renderSubmission = {
      schema_version: "videoforge-hosted-cpu-submission/v1",
      idempotency_key: `project-${projectId}-render-v1`,
      project_id: projectId,
      project_revision_id: revisionId,
      kind: "RENDER",
      input_document: {
        schema_version: "render-job-input/v1",
        project_revision_id: revisionId,
        attempt_id: renderId,
        resolved_render_manifest: {
          asset_id: "manifest-001",
          sha256: manifestHash,
          artifact_uri: `vf-local://objects/sha256/cc/${"c".repeat(64)}.json`,
        },
        assets: [
          {
            asset_id: "voiceover-001",
            sha256: voiceoverHash,
            artifact_uri: `vf-local://objects/sha256/aa/${"a".repeat(64)}.wav`,
            kind: "VOICEOVER",
          },
          {
            asset_id: "avatar-001",
            sha256: avatarHash,
            artifact_uri: `vf-local://objects/sha256/dd/${"d".repeat(64)}.mp4`,
            kind: "AVATAR_CLIP",
          },
          {
            asset_id: "image-001",
            sha256: imageHash,
            artifact_uri: `vf-local://objects/sha256/ee/${"e".repeat(64)}.png`,
            kind: "IMAGE",
          },
        ],
        output: {
          result_uri: "vf-local-run://placeholder/attempt/output.mp4",
          filename: "fixture.mp4",
        },
        tools: { ffmpeg_version: "8.1.2", ffprobe_version: "8.1.2" },
        cancel_token: "fixture-render-cancel-token-0000000000000001",
      },
      objects: [
        {
          artifact_receipt_id: "66666666-6666-4666-8666-666666666666",
          uri: `vf-local://objects/sha256/cc/${"c".repeat(64)}.json`,
        },
        {
          artifact_receipt_id: "77777777-7777-4777-8777-777777777777",
          uri: `vf-local://objects/sha256/aa/${"a".repeat(64)}.wav`,
        },
        {
          artifact_receipt_id: "88888888-8888-4888-8888-888888888888",
          uri: `vf-local://objects/sha256/dd/${"d".repeat(64)}.mp4`,
        },
        {
          artifact_receipt_id: "99999999-9999-4999-8999-999999999999",
          uri: `vf-local://objects/sha256/ee/${"e".repeat(64)}.png`,
        },
      ],
    };
    let renderSubmitted = false;
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
        ...(renderSubmitted
          ? [
              {
                id: renderId,
                kind: "RENDER" as const,
                state: "OUTBOXED",
                version: 1,
                created_at: "2026-08-17T10:02:00.000Z",
                updated_at: "2026-08-17T10:02:00.000Z",
                terminal_at: null,
                output_checksum_sha256: null,
                approved_at: null,
                preview_url: null,
              },
            ]
          : []),
      ],
      gpu_transport: "DISABLED_FAKE_ONLY" as const,
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/render"))
        return Response.json({
          schema_version: "videoforge-hosted-render-handoff/v1",
          project_id: projectId,
          project_revision_id: revisionId,
          asr_attempt_id: asrId,
          cpu_submission: renderSubmission,
        });
      if (path.endsWith("/api/v2/cpu-attempts")) {
        renderSubmitted = true;
        expect(JSON.parse(String(init?.body))).toEqual(renderSubmission);
        return Response.json({ id: renderId, state: "OUTBOXED" }, { status: 202 });
      }
      return Response.json(detail());
    });
    vi.stubGlobal("fetch", fetchMock);
    renderHosted(<HostedProjectScreen projectId={projectId} />);

    expect(await screen.findByText("Render final video")).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/render"))).toBe(true);
    expect(
      fetchMock.mock.calls.some(([input]) => String(input).endsWith("/api/v2/cpu-attempts")),
    ).toBe(true);
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

    expect(await screen.findByText("125s")).toBeInTheDocument();
    expect(screen.getByText("1.000 GB")).toBeInTheDocument();
    expect(screen.getAllByText("$0.00")).toHaveLength(2);
    expect(screen.queryByText(/estimated/u)).not.toBeInTheDocument();
  });
});

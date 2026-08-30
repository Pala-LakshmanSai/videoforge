import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="#hosted-route">{children}</a>,
}));

import {
  HostedAvatarHubScreen,
  HostedCreateProjectScreen,
  HostedPresetCreationScreen,
  HostedPresetCreationUnavailableScreen,
  HostedProjectScreen,
  HostedStylesHubScreen,
  HostedUsageScreen,
  HOSTED_SHA256_CHUNK_BYTES,
  audioDurationMs,
  hostedFileSha256,
  hostedPreflightEstimateText,
  isFailClosedGpuReadiness,
  normalizeHostedReturnTo,
  parseWavDurationMs,
  preflightBlockers,
  readJson,
} from "./HostedProductScreens";

function renderHosted(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
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

describe("hosted product errors", () => {
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
        1,
      ),
    ).toBe("Estimate pending · maximum $1.00");
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
    expect(screen.getByRole("button", { name: /Details/u })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /References \(3\)/u })).toBeInTheDocument();
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
    expect(
      screen.getByText(/Create your first avatar before starting a project/u),
    ).toBeInTheDocument();
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
    expect(screen.getByText("Unfinished avatars")).toBeInTheDocument();
    expect(screen.getByText("Unfinished styles")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Continue setup" })).toHaveLength(3);
    expect(
      screen.getByText(
        "Your avatar draft is saved. Continue to verify the photo upload, then approve it.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "7 references are saved. Continue to verify the uploads, then analyze and publish this style.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Analysis is in progress. We will update this style when it finishes.")).toBeInTheDocument();
    expect(screen.getByText("This style could not be completed. Remove it and start again with new references.")).toBeInTheDocument();
    const styleResumeLink = screen
      .getAllByRole("link", { name: "Continue setup" })
      .find((link) => link.getAttribute("href")?.startsWith("/styles/new"));
    expect(styleResumeLink).toHaveAttribute(
      "href",
      "/styles/new?resumeVersionId=draft-style-version-id&returnTo=%2Fstyles",
    );
    expect(screen.queryByText(/draft-(?:style|avatar)-(?:id|version-id)|sha256:/u)).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Remove style" })[0]!);
    await waitFor(() => expect(screen.queryByText("Will Carter")).not.toBeInTheDocument());
  });

  it.each([
    ["DRAFT", "Analyze references"],
    ["NEEDS_REVIEW", "Review and publish"],
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
      expect(screen.getByRole("button", { name: "Analyze this draft once" })).toBeEnabled();
    } else {
      expect(screen.getByRole("button", { name: "Publish immutable style version" })).toBeDisabled();
    }
    window.history.replaceState({}, "", "/");
  });

  it("verifies a resumed style upload before starting its one analysis", async () => {
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
      if (path.endsWith("/api/v2/hosted/styles/resume-unverified-style/commit")) {
        expect(init).toMatchObject({ method: "POST", body: "{}" });
        return Response.json({
          style_id: "resume-style-id",
          version_id: "resume-unverified-style",
          state: "DRAFT",
        });
      }
      if (path.endsWith("/api/v2/hosted/styles/resume-unverified-style/analyze")) {
        expect(init).toMatchObject({ method: "POST" });
        return Response.json({
          style_id: "resume-style-id",
          version_id: "resume-unverified-style",
          state: "NEEDS_REVIEW",
          profile: { summary: "Natural light and restrained texture." },
        });
      }
      throw new Error(`Unexpected hosted request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderHosted(<HostedPresetCreationScreen kind="styles" />);

    expect(await screen.findByRole("heading", { name: "Analyze references" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Verify uploads and analyze once" }));

    expect(await screen.findByRole("heading", { name: "Review and publish" })).toBeInTheDocument();
    const writePaths = fetchMock.mock.calls
      .filter(([, init]) => init?.method === "POST")
      .map(([input]) => String(input));
    expect(writePaths).toEqual([
      "/api/v2/hosted/styles/resume-unverified-style/commit",
      "/api/v2/hosted/styles/resume-unverified-style/analyze",
    ]);
    window.history.replaceState({}, "", "/");
  });

  it("confirms removal for workspace avatars and hides it for system avatars", async () => {
    let removed = false;
    let resolveDelete: (response: Response) => void = () => undefined;
    const pendingDelete = new Promise<Response>((resolve) => {
      resolveDelete = resolve;
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/api/v2/hosted/project-catalog")) {
        return Response.json({
          avatars: removed
            ? []
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
        return pendingDelete;
      }
      throw new Error(`Unexpected hosted request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderHosted(<HostedAvatarHubScreen />);

    expect(await screen.findByText("Workspace presenter")).toBeInTheDocument();
    const details = screen.getAllByRole("button", { name: "Details" });
    expect(details).toHaveLength(2);
    fireEvent.click(details[0]!);
    const remove = await screen.findByRole("button", { name: "Remove avatar" });
    expect(screen.queryByRole("button", { name: "Remove built-in avatar" })).not.toBeInTheDocument();

    fireEvent.click(remove);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    confirm.mockReturnValue(true);
    fireEvent.click(remove);
    expect(await screen.findByRole("button", { name: /Removing avatar/u })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    resolveDelete(new Response(null, { status: 204 }));
    await waitFor(() => expect(screen.queryByText("Workspace presenter")).not.toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v2/hosted/avatars/workspace-profile",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("keeps the style details open with an actionable error when removal fails", async () => {
    let rejectDelete: (reason?: unknown) => void = () => undefined;
    const pendingDelete = new Promise<Response>((_, reject) => {
      rejectDelete = reject;
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/api/v2/hosted/project-catalog")) {
        return Response.json({
          avatars: [],
          styles: [
            {
              style_id: "workspace-style",
              version_id: "workspace-style-version",
              name: "Workspace style",
              version_number: 1,
              state: "PUBLISHED",
              scope_kind: "WORKSPACE",
              reference_count: 3,
            },
          ],
          media_worker_state: "ONLINE",
          gpu_transport: "DISABLED_UNQUALIFIED",
          gpu_readiness: gpuReadiness,
        });
      }
      if (init?.method === "DELETE") {
        expect(path).toBe("/api/v2/hosted/styles/workspace-style");
        return pendingDelete;
      }
      throw new Error(`Unexpected hosted request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderHosted(<HostedStylesHubScreen />);

    expect(await screen.findByText("Workspace style")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "References (3)" }));
    const remove = await screen.findByRole("button", { name: "Remove style" });
    fireEvent.click(remove);
    expect(await screen.findByRole("button", { name: /Removing style/u })).toHaveAttribute(
      "aria-busy",
      "true",
    );

    rejectDelete(new Error("Preset is currently used by a project."));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Preset is currently used by a project.",
    );
    expect(screen.getByRole("button", { name: "Remove style" })).toBeInTheDocument();
  });

  it("does not expose fixture-only preset mutation screens in hosted staging", () => {
    renderHosted(<HostedPresetCreationUnavailableScreen kind="styles" />);

    expect(screen.getByText("Image Styles creation unavailable")).toBeInTheDocument();
    expect(screen.getByText("Read-only hosted catalog")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Image Styles" })).toBeInTheDocument();
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
    expect(screen.getByText("Add a name and reference images to continue.")).toBeInTheDocument();
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
    expect(screen.getByText("Choose a photo to continue.")).toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: "Check cost & readiness" })).toBeDisabled();
    expect(screen.getByLabelText("Video title")).toHaveClass("input");
    expect(screen.getByLabelText("Final voiceover")).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Avatar options" })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Image style options" })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("radio", { name: /Owner/u })).toHaveAttribute("aria-checked", "true"),
    );
    expect(screen.getByRole("radio", { name: /Documentary/u })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByLabelText("Maximum spend")).toHaveClass("input");
    expect(screen.getByLabelText("Maximum spend")).toHaveValue(1);
    expect(screen.getByText(/no paid GPU work will start/u)).toBeInTheDocument();
    expect(
      screen.queryByText(
        /Tenant-private Neon|GPU transport|DISABLED_UNQUALIFIED|V2-07|V2-08|MAGE_IMAGE|SOULX_AVATAR|Missing gates|APPROVED_EXACT|identity_output|cancellation_timeout|sha256:/u,
      ),
    ).not.toBeInTheDocument();
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

  it("offers an idempotent recovery action for a cancellation left pending", async () => {
    const attemptId = "33333333-3333-4333-8333-333333333333";
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith(`/api/v2/cpu-attempts/${attemptId}`)) {
        expect(init).toMatchObject({ method: "POST", body: "{}" });
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

    fireEvent.click(await screen.findByRole("button", { name: "Settle cancellation" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/v2/cpu-attempts/${attemptId}`,
        expect.objectContaining({ method: "POST", body: "{}" }),
      ),
    );
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
      gpu_transport: "DISABLED_UNQUALIFIED" as const,
      gpu_readiness: gpuReadiness,
      generation: null,
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/render"))
        return Response.json({ error: { code: "HOSTED_RENDER_PLAN_NOT_READY" } }, { status: 409 });
      return Response.json(detail);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderHosted(<HostedProjectScreen projectId="11111111-1111-4111-8111-111111111111" />);

    expect(
      await screen.findByText(/generation planning could not be verified/u),
    ).toBeInTheDocument();
    expect(screen.getByText(/HOSTED_RENDER_PLAN_NOT_READY/u)).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([input]) => String(input).endsWith("/api/v2/cpu-attempts")),
    ).toBe(false);
    expect(screen.queryByRole("link", { name: "Review video" })).not.toBeInTheDocument();
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
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
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
      return Response.json(detail());
    });
    vi.stubGlobal("fetch", fetchMock);
    renderHosted(<HostedProjectScreen projectId={projectId} />);

    expect(
      await screen.findByText(/generation is waiting for GPU qualification/u),
    ).toBeInTheDocument();
    expect(screen.getByText(/V2-07 missing: identity_output/u)).toBeInTheDocument();
    expect(screen.getByText(/V2-08 missing: V2_07_MAGE_QUALIFICATION/u)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/render"))).toBe(true);
    expect(
      fetchMock.mock.calls.some(([input]) => String(input).endsWith("/api/v2/cpu-attempts")),
    ).toBe(false);
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

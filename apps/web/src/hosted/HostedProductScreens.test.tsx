import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    expect(screen.getByText("Gemini analysis")).toBeInTheDocument();
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
    expect(screen.getAllByRole("link", { name: "Continue setup" })).toHaveLength(4);
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
    expect(
      screen.getByText("Analysis is in progress. We will update this style when it finishes."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "The analysis request failed, but your verified references are saved. Continue setup to retry safely.",
      ),
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
    ["DRAFT", "Analyze references"],
    ["FAILED", "Analyze references"],
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
    } else if (state === "FAILED") {
      expect(screen.getByRole("button", { name: "Retry saved analysis" })).toBeEnabled();
    } else {
      expect(screen.getByRole("button", { name: "Publish immutable style version" })).toBeEnabled();
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
    expect(
      screen.getByText(
        "Some saved references could not be verified. Reselect 3–8 images to repair this saved draft.",
      ),
    ).toBeInTheDocument();
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
    expect(await screen.findByRole("heading", { name: "Technical review" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Verify replacement references" }));

    expect(await screen.findByRole("heading", { name: "Analyze references" })).toBeInTheDocument();
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
    expect(
      screen.getByText("This unfinished style is already in the Hub. Continue setup from there."),
    ).toBeInTheDocument();
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
    expect(screen.getByLabelText("Maximum spend")).toHaveClass("input");
    expect(screen.getByLabelText("Maximum spend")).toHaveValue(1);
    fireEvent.change(screen.getByLabelText("Maximum spend"), { target: { value: "0.05" } });
    expect(screen.getByLabelText("Maximum spend")).toHaveValue(0.05);
    expect(screen.queryByText(/finite spend cap/u)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Maximum spend"), { target: { value: "0.04" } });
    expect(screen.getByText("Enter a finite spend cap of at least $0.05.")).toBeInTheDocument();
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

    const stopButton = await screen.findByRole("button", {
      name: "Finish stopping transcription",
    });
    expect(stopButton.parentElement).toHaveClass("current-run-actions");
    fireEvent.click(stopButton);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/v2/cpu-attempts/${attemptId}`,
        expect.objectContaining({ method: "POST", body: "{}" }),
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
    fireEvent.click(screen.getByRole("button", { name: "Retry transcription" }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([input]) => String(input).endsWith("/api/v2/cpu-attempts")),
      ).toBe(true),
    );
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

  it("checks an UNKNOWN context once and offers provider-result reconciliation without retrying inference", async () => {
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
      voiceover_context: {
        id: contextId,
        state: "UNKNOWN" as const,
        transcript_hash: `sha256:${"b".repeat(64)}`,
        reserved_cost_micro_usd: 10_000,
        problem_code: "VOICEOVER_CONTEXT_PROVIDER_UNCERTAIN",
      },
      generation: null,
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith(`/projects/${projectId}/reconcile-context`)) {
        reconciliationCalls += 1;
        expect(init).toMatchObject({ method: "POST", body: "{}" });
        return Response.json(
          { error: { message: "The original provider result is not available yet." } },
          { status: 409 },
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

    expect(await screen.findByText("Provider result needs confirmation.")).toBeInTheDocument();
    expect(reconciliationCalls).toBe(1);
    await waitFor(() => expect(projectReads).toBeGreaterThanOrEqual(2));
    expect(screen.getByRole("heading", { name: "Private project" })).toBeInTheDocument();
    expect(screen.queryByText("Live progress is temporarily unavailable")).not.toBeInTheDocument();
    expect(
      screen.getByText("The original provider result is not available yet."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/retry.*provider|retry.*context/iu)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Check provider result" }));
    await waitFor(() => expect(reconciliationCalls).toBe(2));
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
        voiceover_context: reconciled
          ? {
              id: "44444444-4444-4444-8444-444444444444",
              state: "SUCCEEDED",
              transcript_hash: `sha256:${"b".repeat(64)}`,
              context_hash: `sha256:${"c".repeat(64)}`,
              context_document: { primary_topic: "Private project" },
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

    expect(await screen.findByText("Whole-voiceover understanding")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Check provider result" })).not.toBeInTheDocument();
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
      return Response.json(detail);
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

    expect(
      await screen.findByText(/image prompts are starting automatically/u),
    ).toBeInTheDocument();
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
    expect(screen.getAllByText("$0.00")).toHaveLength(1);
    expect(screen.queryByText(/estimated/u)).not.toBeInTheDocument();
  });
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="#hosted-route">{children}</a>,
  useNavigate: () => vi.fn(),
}));

import { HostedAvatarHubScreen } from "./HostedProductScreens";
import { NewAvatarScreen } from "../screens/NewAvatarScreen";

const gpuReadiness = {
  schema_version: "videoforge-hosted-gpu-readiness/v1",
  gpu_transport: "QUALIFIED_EXACT",
  provider_calls_authorized: true,
  dispatch_available: true,
  lanes: [
    {
      lane: "MAGE_IMAGE",
      checkpoint: "V2-07",
      qualification: "QUALIFIED_EXACT",
      visual_approval: "NOT_APPLICABLE",
      provider_free_groundwork_commits: ["1283a23248c9b79832b6fb331b00474e1df70f81"],
      missing_gates: [],
    },
    {
      lane: "SOULX_AVATAR",
      checkpoint: "V2-08",
      qualification: "QUALIFIED_EXACT",
      visual_approval: "APPROVED_EXACT_FULL_AND_SPLIT",
      provider_free_groundwork_commits: [
        "7039092707103ab35e8010c009e14409a6e52f63",
        "84e00881d98e3e77dd8aad121453ed6e7287bc74",
        "e49b93854d58c4faeb8bdd10b9b9df07321026db",
        "f3557059d7d5f0637ea223b3e758389fbd80a52b",
      ],
      missing_gates: [],
    },
  ],
};

function renderHosted(node: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("production avatar creation", () => {
  it("defaults to own avatars and browses named/email collections with private owner actions", async () => {
    vi.stubEnv("VITE_VIDEOFORGE_PROVIDER_MODE", "production");
    const avatar = (name: string, id: string) => ({
      name,
      profile_id: id,
      version_id: id,
      version_number: 1,
      state: "READY",
      thumbnail_url: `/api/v2/hosted/avatars/${id}/preview`,
    });
    const mine = avatar("My presenter", "own");
    const other = avatar("Shared presenter", "other");
    const fetchMock = vi.fn(async () =>
      Response.json({
        avatars: [mine],
        avatar_drafts: [
          {
            name: "Private draft",
            profile_id: "draft",
            version_id: "draft",
            version_number: 1,
            state: "DRAFT",
          },
        ],
        avatar_collections: [
          {
            id: "a",
            name: "Alex",
            email: "a@example.test",
            is_current_user: true,
            avatars: [mine],
          },
          {
            id: "b",
            name: "Alex",
            email: "b@example.test",
            is_current_user: false,
            avatars: [other],
          },
          {
            id: "c",
            name: "Empty user",
            email: "c@example.test",
            is_current_user: false,
            avatars: [],
          },
        ],
        styles: [],
        gpu_transport: "QUALIFIED_EXACT",
        gpu_readiness: gpuReadiness,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderHosted(<HostedAvatarHubScreen />);
    expect(await screen.findByRole("heading", { name: "My presenter" })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Collection" })).toHaveTextContent("My avatars");
    expect(screen.getByRole("combobox")).toHaveTextContent("a@example.test");
    expect(screen.queryByRole("heading", { name: "Shared presenter" })).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("heading", { name: "My presenter" }).closest("article")!).getByRole(
        "button",
        { name: "Remove avatar" },
      ),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByRole("option", { name: /Alex \(2\)/ }));
    const card = screen.getByRole("heading", { name: "Shared presenter" }).closest("article")!;
    expect(within(card).getByText("b@example.test")).toBeVisible();
    expect(within(card).queryByRole("button", { name: "Remove avatar" })).not.toBeInTheDocument();
    expect(screen.queryByText("Private draft")).not.toBeInTheDocument();
    expect(screen.getByAltText("Shared presenter presenter")).toHaveAttribute(
      "src",
      "/api/v2/hosted/avatars/other/preview",
    );
    fireEvent.click(within(card).getByRole("button", { name: "Details" }));
    expect(screen.getByAltText("Shared presenter full avatar crop")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Close details" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "not found" } });
    expect(screen.getByText("No matching avatars")).toBeVisible();
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByRole("option", { name: /Empty user/ }));
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(screen.getByText("No avatars in this collection")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Browse everyone" }));
    expect(screen.getByRole("heading", { name: "Shared presenter" })).toBeVisible();
    expect(screen.getAllByRole("heading", { name: "My presenter" })).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("exposes the add action and opens the hosted workflow", async () => {
    vi.stubEnv("VITE_VIDEOFORGE_PROVIDER_MODE", "production");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          avatars: [],
          styles: [],
          media_worker_state: "ONLINE",
          gpu_transport: "QUALIFIED_EXACT",
          gpu_readiness: gpuReadiness,
        }),
      ),
    );

    renderHosted(<HostedAvatarHubScreen />);
    expect(await screen.findByRole("link", { name: "New avatar" })).toBeVisible();

    cleanup();
    renderHosted(<NewAvatarScreen />);
    expect(await screen.findByRole("heading", { name: "New avatar" })).toBeVisible();
    expect(screen.getByLabelText("Avatar name")).toBeVisible();
    expect(screen.getByLabelText("Upload avatar source")).toBeVisible();
  });
});

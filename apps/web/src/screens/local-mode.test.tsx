import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProjectSummary } from "../lib/types";
import { LibraryScreen } from "./LibraryScreen";
import { NewAvatarScreen } from "./NewAvatarScreen";
import { NewStyleScreen } from "./NewStyleScreen";
import { SettingsScreen } from "./SettingsScreen";

const apiMocks = vi.hoisted(() => ({
  avatars: vi.fn(),
  health: vi.fn(),
  projects: vi.fn(),
  styles: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="#fixture-route">{children}</a>,
}));

vi.mock("../lib/api", () => ({
  api: {
    avatars: apiMocks.avatars,
    health: apiMocks.health,
    projects: apiMocks.projects,
    styles: apiMocks.styles,
  },
}));

vi.mock("../lib/scenario", () => ({
  currentScenario: () => "happy_generating",
}));

function renderWithQueryClient(node: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>);
}

const localHealth = {
  app: "videoforge",
  status: "ok",
  mode: "local",
  commit: "abcdef1",
  fixture_id: null,
  synthetic: true,
  provider_calls_authorized: false,
  authorized_spend_usd: 0,
} as const;

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});

describe("bounded local screens", () => {
  it("renders and downloads the approved real MP4 from Library", async () => {
    const project = {
      id: "project_local_owned_001",
      title: "Owned local slice",
      status: "APPROVED",
      actualCost: 0,
      latestArtifact: {
        kind: "VIDEO",
        url: "/api/v1/projects/project_local_owned_001/preview",
        label: "Local synthetic 1080p30 MP4",
        sha256: `sha256:${"a".repeat(64)}`,
        bytes: 42,
        filename: "videoforge-local-owned-slice.mp4",
      },
      review: {
        downloadUrl: "/api/v1/projects/project_local_owned_001/download",
      },
    } as unknown as ProjectSummary;
    apiMocks.projects.mockResolvedValue([project]);

    const { container } = renderWithQueryClient(<LibraryScreen />);

    expect(await screen.findByRole("heading", { name: "Owned local slice" })).toBeVisible();
    expect(container.querySelector("video")).toHaveAttribute(
      "src",
      "/api/v1/projects/project_local_owned_001/preview",
    );
    expect(screen.getByRole("link", { name: "Download MP4" })).toHaveAttribute(
      "download",
      "videoforge-local-owned-slice.mp4",
    );
    expect(screen.getByText(`sha256:${"a".repeat(64)}`)).toBeInTheDocument();
    expect(screen.queryByText("Synthetic contact sheet")).not.toBeInTheDocument();
  });

  it("fails closed before exposing unsupported avatar or style uploads", async () => {
    apiMocks.health.mockResolvedValue(localHealth);
    apiMocks.avatars.mockResolvedValue([]);
    apiMocks.styles.mockResolvedValue([]);

    renderWithQueryClient(<NewAvatarScreen />);
    expect(
      await screen.findByRole("heading", { name: "Avatar creation is unavailable locally" }),
    ).toBeVisible();
    expect(screen.queryByLabelText("Upload avatar source")).not.toBeInTheDocument();

    cleanup();
    renderWithQueryClient(<NewStyleScreen />);
    expect(
      await screen.findByRole("heading", { name: "Style creation is unavailable locally" }),
    ).toBeVisible();
    expect(screen.queryByLabelText("Upload style references")).not.toBeInTheDocument();
  });

  it("labels local provider and spend settings truthfully", async () => {
    apiMocks.health.mockResolvedValue(localHealth);

    renderWithQueryClient(<SettingsScreen />);

    expect(await screen.findByText("LOCAL · $0")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Local media slice" })).toBeVisible();
    expect(screen.getByText("$0.10 bounded request cap")).toBeVisible();
    expect(screen.getByText("$0 authorized")).toBeInTheDocument();
  });
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LibraryScreen } from "./LibraryScreen";
import { ReviewScreen } from "./ReviewScreen";

const apiMocks = vi.hoisted(() => ({
  health: vi.fn(() => new Promise(() => undefined)),
  project: vi.fn(() => new Promise(() => undefined)),
  projects: vi.fn(() => new Promise(() => undefined)),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="#fixture-route">{children}</a>,
}));

vi.mock("../hosted/HostedProductScreens", () => ({
  HostedReviewScreen: () => <h1>Hosted review</h1>,
}));

vi.mock("../lib/api", () => ({
  api: apiMocks,
}));

vi.mock("../lib/scenario", () => ({
  currentScenario: () => "project_ready_for_review",
}));

function renderScreen(node: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("product screen provider-mode routing", () => {
  it.each([undefined, "fixture", "local", "sandbox"])(
    "keeps fixture screens active for non-hosted mode %s",
    (providerMode) => {
      if (providerMode !== undefined) vi.stubEnv("VITE_VIDEOFORGE_PROVIDER_MODE", providerMode);

      renderScreen(
        <>
          <ReviewScreen projectId="project_fixture_001" />
          <LibraryScreen />
        </>,
      );

      expect(screen.getByRole("heading", { name: "Loading candidate" })).toBeVisible();
      expect(screen.getByRole("heading", { name: "Loading Library" })).toBeVisible();
      expect(screen.queryByRole("heading", { name: "Hosted review" })).not.toBeInTheDocument();
    },
  );

  it.each(["staging", "production"])("uses hosted screens in %s mode", (providerMode) => {
    vi.stubEnv("VITE_VIDEOFORGE_PROVIDER_MODE", providerMode);

    renderScreen(<ReviewScreen projectId="project_fixture_001" />);

    expect(screen.getByRole("heading", { name: "Hosted review" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Loading candidate" })).not.toBeInTheDocument();
  });
});

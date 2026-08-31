import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  vi.stubEnv("VITE_VIDEOFORGE_PROVIDER_MODE", "staging");
});

import { AppShell } from "./AppShell";

describe("hosted AppShell progress navigation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("places Progress immediately after New Project and opens the latest saved project", async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === "/api/v2/hosted/status")
          return Response.json({ commit: "fixture", environment: "staging" });
        if (String(input) === "/api/v2/hosted/projects")
          return Response.json({ projects: [{ id: projectId }] });
        throw new Error(`Unexpected request ${String(input)}`);
      }),
    );
    const rootRoute = createRootRoute({
      component: () => (
        <AppShell>
          <p>Current page</p>
        </AppShell>
      ),
    });
    const router = createRouter({
      routeTree: rootRoute,
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    const navigation = await screen.findByRole("navigation", { name: "Primary navigation" });
    const progressLink = await within(navigation).findByRole("link", { name: "Progress" });
    const links = within(navigation).getAllByRole("link");
    expect(links.slice(0, 3).map((link) => link.textContent?.trim())).toEqual([
      "QueueQueue",
      "New ProjectNew",
      "Progress",
    ]);
    expect(progressLink).toHaveAttribute("href", `/projects/${projectId}`);
  });
});

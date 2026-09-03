import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  vi.stubEnv("VITE_VIDEOFORGE_PROVIDER_MODE", "fixture");
});

import { AppShell } from "./AppShell";

describe("local AppShell provider mode", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("uses the local health endpoint and shows the fixture as healthy", async () => {
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
        const url = String(input);
        if (url === "/api/health?fixture=happy_generating")
          return Response.json({
            app: "videoforge",
            status: "ok",
            mode: "fixture",
            commit: "fixture",
            fixture_id: "happy_generating",
            synthetic: true,
            provider_calls_authorized: false,
            authorized_spend_usd: 0,
          });
        if (url === "/api/v1/bootstrap?fixture=happy_generating")
          return Response.json({
            scenario: "happy_generating",
            access: {
              state: "AUTHORIZED",
              selectedAccount: {
                displayName: "Fixture owner",
                email: "fixture@example.invalid",
              },
              workspaceName: "Fixture workspace",
              adminContact: null,
            },
            currentProjectId: null,
          });
        throw new Error(`Unexpected request ${url}`);
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
      history: createMemoryHistory({ initialEntries: ["/?fixture=happy_generating"] }),
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("API healthy")).toBeVisible();
    expect(screen.getByText("Fixture mode")).toBeVisible();
    expect(screen.queryByText("Private staging")).not.toBeInTheDocument();
  });
});

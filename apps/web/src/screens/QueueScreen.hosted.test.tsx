import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { QueueScreen } from "./QueueScreen";

describe("hosted queue", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it.each(["staging", "production"] as const)(
    "shows one project-level job and sends an explicit cancellation in %s mode",
    async (providerMode) => {
      vi.stubEnv("VITE_VIDEOFORGE_PROVIDER_MODE", providerMode);
      const attemptId = "11111111-1111-4111-8111-111111111111";
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === "/api/v2/hosted/queue") {
          return Response.json({
            schema_version: "videoforge-hosted-queue/v2",
            worker_state: "ONLINE",
            projects: [
              {
                project_id: "22222222-2222-4222-8222-222222222222",
                title: "My private render",
                state: "IN_PROGRESS",
                stage: "Final assembly",
                cancellable_attempt_id: attemptId,
                created_at: "2026-08-17T10:00:00.000Z",
                updated_at: "2026-08-17T10:01:00.000Z",
              },
            ],
          });
        }
        if (String(input) === `/api/v2/cpu-attempts/${attemptId}`) {
          expect(init).toMatchObject({ method: "POST", body: "{}" });
          return Response.json({ id: attemptId, state: "CANCEL_REQUESTED" }, { status: 202 });
        }
        throw new Error(`Unexpected request ${String(input)}`);
      });
      vi.stubGlobal("fetch", fetchMock);
      const rootRoute = createRootRoute({ component: QueueScreen });
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

      expect(await screen.findByText("My private render")).toBeInTheDocument();
      expect(screen.getByText("Final assembly")).toBeInTheDocument();
      expect(screen.getByText("In progress", { selector: ".badge" })).toBeInTheDocument();
      expect(screen.getByText("Connected")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      await waitFor(() =>
        expect(fetchMock).toHaveBeenCalledWith(
          `/api/v2/cpu-attempts/${attemptId}`,
          expect.objectContaining({ method: "POST" }),
        ),
      );
    },
  );

  it("shows an actionable project failure without presenting completed attempts", async () => {
    vi.stubEnv("VITE_VIDEOFORGE_PROVIDER_MODE", "staging");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          schema_version: "videoforge-hosted-queue/v2",
          worker_state: "ONLINE",
          projects: [
            {
              project_id: "22222222-2222-4222-8222-222222222222",
              title: "Context recovery",
              state: "NEEDS_ATTENTION",
              stage: "Voiceover context",
              cancellable_attempt_id: null,
              created_at: "2026-08-17T10:00:00.000Z",
              updated_at: "2026-08-17T10:01:00.000Z",
            },
          ],
        }),
      ),
    );
    const rootRoute = createRootRoute({ component: QueueScreen });
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

    expect(await screen.findByText("Context recovery")).toBeInTheDocument();
    expect(screen.getByText("Voiceover context")).toBeInTheDocument();
    expect(screen.getByText("Needs attention", { selector: ".badge" })).toBeInTheDocument();
    expect(screen.queryByText("Completed")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  });
});

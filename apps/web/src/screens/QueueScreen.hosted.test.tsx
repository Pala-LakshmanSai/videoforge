import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    vi.useRealTimers();
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it.each(["staging", "production"] as const)(
    "requires deliberate confirmation before cancelling one project-level job in %s mode",
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
      fireEvent.click(screen.getByRole("button", { name: "Cancel job" }));
      expect(screen.getByRole("button", { name: "Confirm cancel" })).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalledWith(
        `/api/v2/cpu-attempts/${attemptId}`,
        expect.anything(),
      );
      fireEvent.click(screen.getByRole("button", { name: "Confirm cancel" }));
      await waitFor(() =>
        expect(fetchMock).toHaveBeenCalledWith(
          `/api/v2/cpu-attempts/${attemptId}`,
          expect.objectContaining({ method: "POST" }),
        ),
      );
    },
  );

  it("auto-disarms cancellation confirmation after the bounded window", async () => {
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
              title: "Timed confirmation",
              state: "IN_PROGRESS",
              stage: "Transcription",
              cancellable_attempt_id: "11111111-1111-4111-8111-111111111111",
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

    expect(await screen.findByText("Timed confirmation")).toBeInTheDocument();
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Cancel job" }));
    expect(screen.getByRole("button", { name: "Confirm cancel" })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(6_001));
    expect(screen.getByRole("button", { name: "Cancel job" })).toBeInTheDocument();
  });

  it("disarms confirmation when the active attempt disappears", async () => {
    vi.stubEnv("VITE_VIDEOFORGE_PROVIDER_MODE", "staging");
    let active = true;
    const fetchMock = vi.fn(async () =>
      Response.json({
        schema_version: "videoforge-hosted-queue/v2",
        worker_state: "ONLINE",
        projects: [
          {
            project_id: "22222222-2222-4222-8222-222222222222",
            title: "Settling job",
            state: active ? "IN_PROGRESS" : "CANCELLED",
            stage: "Transcription",
            cancellable_attempt_id: active ? "11111111-1111-4111-8111-111111111111" : null,
            created_at: "2026-08-17T10:00:00.000Z",
            updated_at: "2026-08-17T10:01:00.000Z",
          },
        ],
      }),
    );
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

    expect(await screen.findByText("Settling job")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel job" }));
    expect(screen.getByRole("button", { name: "Confirm cancel" })).toBeInTheDocument();
    active = false;
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ["hosted-queue"] });
    });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Confirm cancel" })).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: "Cancel job" })).not.toBeInTheDocument();
  });

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
    expect(screen.getByText("Action needed")).toBeInTheDocument();
    expect(screen.getByText("Voiceover context")).toBeInTheDocument();
    expect(screen.getByText("Needs attention", { selector: ".badge" })).toBeInTheDocument();
    expect(screen.queryByText("Completed")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel job" })).not.toBeInTheDocument();
  });

  it("deletes an idle project after one deliberate confirmation", async () => {
    vi.stubEnv("VITE_VIDEOFORGE_PROVIDER_MODE", "production");
    const projectId = "33333333-3333-4333-8333-333333333333";
    let deleted = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/v2/hosted/queue") {
        return Response.json({
          schema_version: "videoforge-hosted-queue/v2",
          worker_state: "ONLINE",
          projects: deleted
            ? []
            : [
                {
                  project_id: projectId,
                  title: "Abandoned draft",
                  state: "WAITING",
                  stage: "Project setup",
                  cancellable_attempt_id: null,
                  can_cancel_project: false,
                  can_delete_project: true,
                  created_at: "2026-08-17T10:00:00.000Z",
                  updated_at: "2026-08-17T10:01:00.000Z",
                },
              ],
        });
      }
      if (String(input) === `/api/v2/hosted/projects/${projectId}` && init?.method === "DELETE") {
        deleted = true;
        return Response.json({ project_id: projectId, state: "ARCHIVED" });
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

    expect(await screen.findByText("Abandoned draft")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(fetchMock).not.toHaveBeenCalledWith(
      `/api/v2/hosted/projects/${projectId}`,
      expect.objectContaining({ method: "DELETE" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/v2/hosted/projects/${projectId}`,
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
  });

  it("cancels predispatch project work and surfaces a refused action", async () => {
    vi.stubEnv("VITE_VIDEOFORGE_PROVIDER_MODE", "production");
    const projectId = "44444444-4444-4444-8444-444444444444";
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/v2/hosted/queue") {
        return Response.json({
          schema_version: "videoforge-hosted-queue/v2",
          worker_state: "ONLINE",
          projects: [
            {
              project_id: projectId,
              title: "Queued generation",
              state: "WAITING",
              stage: "Project setup",
              cancellable_attempt_id: null,
              can_cancel_project: true,
              can_delete_project: false,
              created_at: "2026-08-17T10:00:00.000Z",
              updated_at: "2026-08-17T10:01:00.000Z",
            },
          ],
        });
      }
      if (String(input) === `/api/v2/hosted/projects/${projectId}/cancel`) {
        expect(init).toMatchObject({
          method: "POST",
          body: JSON.stringify({
            schema_version: "videoforge-hosted-project-cancellation/v1",
            project_id: projectId,
            confirmation: "STOP",
          }),
        });
        return Response.json(
          {
            error: {
              code: "PROJECT_CANCELLATION_UNAVAILABLE",
              message: "This project already crossed the provider boundary.",
            },
          },
          { status: 409 },
        );
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

    expect(await screen.findByText("Queued generation")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Stop project" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm stop" }));
    expect(
      await screen.findByText("This project already crossed the provider boundary."),
    ).toBeInTheDocument();
  });

  it("filters the visible projects by state and title", async () => {
    vi.stubEnv("VITE_VIDEOFORGE_PROVIDER_MODE", "production");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          schema_version: "videoforge-hosted-queue/v2",
          worker_state: "ONLINE",
          projects: [
            {
              project_id: "55555555-5555-4555-8555-555555555555",
              title: "Alpha render",
              state: "IN_PROGRESS",
              stage: "Final assembly",
              cancellable_attempt_id: null,
              created_at: "2026-08-17T10:00:00.000Z",
              updated_at: "2026-08-17T10:01:00.000Z",
            },
            {
              project_id: "66666666-6666-4666-8666-666666666666",
              title: "Beta prompts",
              state: "NEEDS_ATTENTION",
              stage: "Image prompts",
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

    expect(await screen.findByText("Alpha render")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Needs attention 1/ }));
    expect(screen.queryByText("Alpha render")).not.toBeInTheDocument();
    expect(screen.getByText("Beta prompts")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^All 2/ }));
    fireEvent.change(screen.getByLabelText("Search your projects"), {
      target: { value: "alpha" },
    });
    expect(screen.getByText("Alpha render")).toBeInTheDocument();
    expect(screen.queryByText("Beta prompts")).not.toBeInTheDocument();
  });
});

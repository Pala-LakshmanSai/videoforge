import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LibraryScreen } from "./LibraryScreen";

describe("hosted Library", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it.each(["staging", "production"] as const)(
    "downloads through a short-lived port and deletes only after explicit confirmation in %s mode",
    async (providerMode) => {
      vi.stubEnv("VITE_VIDEOFORGE_PROVIDER_MODE", providerMode);
      const attemptId = "11111111-1111-4111-8111-111111111111";
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === "/api/v2/library") {
          return Response.json({
            schema_version: "videoforge-hosted-library/v1",
            outputs: [
              {
                attempt_id: attemptId,
                project_id: "22222222-2222-4222-8222-222222222222",
                title: "Owned render",
                created_at: "2026-08-17T10:00:00.000Z",
                content_length: 12_000_000,
                checksum_sha256: `sha256:${"a".repeat(64)}`,
                download_url: "https://private.example.test/signed-output",
                download_expires_at: "2026-08-17T10:05:00.000Z",
              },
            ],
          });
        }
        if (String(input) === `/api/v2/cpu-attempts/${attemptId}/output`) {
          expect(init?.method).toBe("DELETE");
          return new Response(null, { status: 204 });
        }
        throw new Error(`Unexpected request ${String(input)}`);
      });
      vi.stubGlobal("fetch", fetchMock);
      vi.spyOn(window, "confirm").mockReturnValue(true);
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

      render(
        <QueryClientProvider client={queryClient}>
          <LibraryScreen />
        </QueryClientProvider>,
      );

      const download = await screen.findByRole("link", { name: /Download MP4/u });
      expect(download).toHaveAttribute("href", "https://private.example.test/signed-output");
      expect(download).toHaveAttribute("download", "");
      expect(screen.getByRole("link", { name: "View video" })).toBeVisible();
      expect(screen.queryByRole("link", { name: "Review" })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Delete" }));
      await waitFor(() =>
        expect(fetchMock).toHaveBeenCalledWith(
          `/api/v2/cpu-attempts/${attemptId}/output`,
          expect.objectContaining({ method: "DELETE" }),
        ),
      );
    },
  );
  it("refreshes a newly finished output within five seconds without an approval request", async () => {
    vi.stubEnv("VITE_VIDEOFORGE_PROVIDER_MODE", "production");
    let ready = false;
    const fetchMock = vi.fn(async () =>
      Response.json({
        schema_version: "videoforge-hosted-library/v1",
        outputs: ready
          ? [
              {
                attempt_id: "render",
                project_id: "project",
                title: "Newly finished",
                content_length: 1_000_000,
                download_url: "/api/v2/hosted/projects/project/download",
              },
            ]
          : [],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <LibraryScreen />
      </QueryClientProvider>,
    );
    await screen.findByText("No finished videos");
    ready = true;
    expect(await screen.findByText("Newly finished", {}, { timeout: 6_500 })).toBeVisible();
    expect(screen.getByRole("link", { name: "Download MP4" })).toBeVisible();
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
    expect(
      vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method || init.method === "GET"),
    ).toBe(true);
  }, 10_000);
});

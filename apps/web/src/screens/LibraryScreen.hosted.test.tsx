import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LibraryScreen } from "./LibraryScreen";

describe("hosted Library", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_VIDEOFORGE_PROVIDER_MODE", "staging");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("downloads through a short-lived port and deletes only after explicit confirmation", async () => {
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
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/v2/cpu-attempts/${attemptId}/output`,
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
  });
});

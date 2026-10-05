import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HostedIdentityContext } from "../hosted/HostedIdentity";
import { CentralizedLibraryScreen } from "./CentralizedLibraryScreen";
const video = {
  attempt_id: "render",
  title: "Harbor film",
  creator_id: "creator",
  creator_name: "Alex",
  creator_email: "alex@example.test",
  created_at: "2026-10-05",
  content_length: 12000000,
  available: true,
  watch_url: "/api/v2/centralized-library/render/watch",
  download_url: "/api/v2/centralized-library/render/download",
};
function show(allowed: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <HostedIdentityContext.Provider
        value={{
          email: allowed ? "demo9gss@gmail.com" : "other@example.test",
          canManageTeam: true,
          canViewCentralizedLibrary: allowed,
          signOut: async () => {},
        }}
      >
        <CentralizedLibraryScreen />
      </HostedIdentityContext.Provider>
    </QueryClientProvider>,
  );
  return client;
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("centralized collection", () => {
  it("does not request cross-user content without the server-granted capability", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    show(false);
    expect(screen.getByText("Owner access only")).toBeVisible();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("opens the exact render, filters across the complete collection, paginates and closes on denied access", async () => {
    let denied = false;
    const fetch = vi.fn(async () =>
      denied
        ? new Response(null, { status: 403 })
        : Response.json({
            outputs: [video],
            total: 50,
            total_videos: 50,
            total_bytes: 600000000,
            creators: [video],
            page_size: 48,
          }),
    );
    vi.stubGlobal("fetch", fetch);
    const client = show(true);
    await screen.findByRole("button", { name: "Watch Harbor film" });
    const card = screen.getByRole("article");
    expect(within(card).getByText("Created by Alex")).toBeVisible();
    expect(within(card).getByText("alex@example.test")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Watch Harbor film" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("link", { name: "Download MP4" })).toHaveAttribute(
      "href",
      video.download_url,
    );
    expect(dialog.querySelector("video")).toHaveAttribute("src", video.watch_url);
    fireEvent.click(within(dialog).getByRole("button", { name: "Close video" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search videos" }), {
      target: { value: "harbor" },
    });
    await waitFor(() =>
      expect(fetch).toHaveBeenLastCalledWith(
        expect.stringContaining("search=harbor"),
        expect.anything(),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(fetch).toHaveBeenLastCalledWith(expect.stringContaining("page=1"), expect.anything()),
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Filter by creator" }), {
      target: { value: "creator" },
    });
    await waitFor(() =>
      expect(fetch).toHaveBeenLastCalledWith(
        expect.stringContaining("creator=creator"),
        expect.anything(),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Watch Harbor film" }));
    denied = true;
    await act(async () => {
      await client.refetchQueries({ queryKey: ["centralized-library"] });
    });
    await screen.findByText("Collection unavailable");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Download Harbor film" })).not.toBeInTheDocument();
  });
});

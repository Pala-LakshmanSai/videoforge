import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MediaWorkerSetup } from "./MediaWorkerSetup";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function setup() {
  const copy = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copy } });
  const fetcher = vi.fn(async (url: string) =>
    Response.json(
      url.includes("connect-command")
        ? {
            expires_at: new Date(Date.now() + 900000).toISOString(),
            macos: "curl 'https://app.test/connect.sh' | bash",
            windows: "powershell.exe -Command connect",
          }
        : {
            schema_version: "videoforge-media-worker-list/v1",
            devices: [],
            release: {
              version: "0.1.44",
              minimum_protocol_version: 1,
              macos: { url: "https://app.test/worker.dmg", size_bytes: 42, trust: "AD_HOC_BETA" },
              windows: {
                url: "https://app.test/worker.exe",
                size_bytes: 43,
                trust: "UNSIGNED_BETA",
              },
            },
          },
    ),
  );
  vi.stubGlobal("fetch", fetcher);
  render(<MediaWorkerSetup />);
  return { copy, fetcher };
}
it("copies commands for the selected OS and keeps manual downloads available", async () => {
  const { copy } = setup();
  await waitFor(() => expect(screen.getByRole("button", { name: "Copy" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "macOS" }));
  fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  await waitFor(() =>
    expect(copy).toHaveBeenCalledWith("curl 'https://app.test/connect.sh' | bash"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Windows" }));
  fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  await waitFor(() => expect(copy).toHaveBeenCalledWith("powershell.exe -Command connect"));
  fireEvent.click(screen.getByText("Other ways to install, or a computer waiting for approval"));
  expect(screen.getByRole("link", { name: /Download for Windows/ })).toHaveAttribute(
    "href",
    "https://app.test/worker.exe",
  );
  expect(screen.getByRole("link", { name: /Download for Mac/ })).toHaveAttribute(
    "href",
    "https://app.test/worker.dmg",
  );
});
it("refreshes the command explicitly without changing OS selection", async () => {
  const { fetcher } = setup();
  await waitFor(() => expect(screen.getByRole("button", { name: "Copy" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Windows" }));
  fireEvent.click(screen.getByRole("button", { name: "Get a fresh command" }));
  await waitFor(() =>
    expect(fetcher.mock.calls.filter(([url]) => url.includes("connect-command"))).toHaveLength(2),
  );
  expect(screen.getByRole("button", { name: "Windows" })).toHaveAttribute("aria-pressed", "true");
});

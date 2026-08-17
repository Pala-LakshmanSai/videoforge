import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MediaWorkerSetup } from "./MediaWorkerSetup";

const workerList = {
  schema_version: "videoforge-media-worker-list/v1",
  devices: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      display_name: "Editing PC",
      platform: "WINDOWS",
      architecture: "X86_64",
      worker_version: "0.1.0",
      protocol_version: 1,
      status: "ONLINE",
      last_seen_at: "2026-08-17T10:00:00.000Z",
      current_attempt_id: null,
    },
  ],
  release: {
    version: "0.1.0",
    minimum_protocol_version: 1,
    windows: {
      url: "https://downloads.example.test/worker.exe",
      sha256: `sha256:${"a".repeat(64)}`,
      size_bytes: 20 * 1024 * 1024,
    },
    macos: {
      url: "https://downloads.example.test/worker.dmg",
      sha256: `sha256:${"b".repeat(64)}`,
      size_bytes: 24 * 1024 * 1024,
    },
  },
};

describe("personal worker onboarding", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("recommends the detected installer while retaining both supported downloads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workerList)),
    );
    render(<MediaWorkerSetup />);

    const windows = await screen.findByRole("link", { name: /Download for Windows/u });
    const mac = screen.getByRole("link", { name: /Download for Mac/u });
    expect(windows).toHaveAttribute("href", "https://downloads.example.test/worker.exe");
    expect(windows).toHaveTextContent("Recommended");
    expect(mac).toHaveAttribute("href", "https://downloads.example.test/worker.dmg");
    expect(screen.getByText("Editing PC")).toBeInTheDocument();
    expect(screen.queryByText("11111111-1111-4111-8111-111111111111")).not.toBeInTheDocument();
    expect(
      screen.getByText(/needs no keys, folders, URLs, or technical setup/u),
    ).toBeInTheDocument();
  });

  it("requires one explicit browser confirmation for an installer enrollment", async () => {
    const enrollmentId = "22222222-2222-4222-8222-222222222222";
    window.history.replaceState(null, "", `/?enrollment=${enrollmentId}`);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v2/media-workers") return Response.json(workerList);
      if (url.endsWith(`/media-worker-enrollments/${enrollmentId}`)) {
        return Response.json({
          id: enrollmentId,
          display_name: "Lakshman’s Mac",
          platform: "MACOS",
          architecture: "AARCH64",
          worker_version: "0.1.0",
          protocol_version: 1,
          state: "PENDING",
          expires_at: "2026-08-17T11:00:00.000Z",
        });
      }
      if (url.endsWith(`/media-worker-enrollments/${enrollmentId}/approve`)) {
        expect(init?.method).toBe("POST");
        return Response.json({ state: "APPROVED" }, { status: 202 });
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<MediaWorkerSetup />);

    expect(await screen.findByText("Connect Lakshman’s Mac?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Connect this computer" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Connected. The worker will come online automatically",
      ),
    );
  });
});

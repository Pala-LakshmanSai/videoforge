import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  vi.stubEnv("VITE_VIDEOFORGE_PROVIDER_MODE", "production");
});

import { SettingsScreen } from "./SettingsScreen";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("production screens", () => {
  it("keeps production generation unavailable while personal computer work stays free", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === "/api/v2/tenant") {
          return Response.json({
            workspace_name: "Private workspace",
            user: { email: "owner@example.test", name: "Owner" },
          });
        }
        if (String(input) === "/api/v2/media-workers") {
          return Response.json({
            schema_version: "videoforge-media-worker-list/v1",
            devices: [],
            release: {
              version: "1.0.0",
              minimum_protocol_version: 1,
              windows: {
                url: "/worker.exe",
                sha256: `sha256:${"a".repeat(64)}`,
                size_bytes: 1,
                trust: "UNSIGNED_BETA",
              },
              macos: {
                url: "/worker.dmg",
                sha256: `sha256:${"b".repeat(64)}`,
                size_bytes: 1,
                trust: "AD_HOC_BETA",
              },
            },
          });
        }
        throw new Error(`Unexpected hosted request: ${String(input)}`);
      }),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <SettingsScreen />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("owner@example.test")).toBeVisible();
    expect(screen.getByText("Not enabled in this beta")).toBeInTheDocument();
    expect(screen.getByText("Your computer · no processing charge")).toBeInTheDocument();
    expect(screen.queryByText(/fake transport/u)).not.toBeInTheDocument();
  });
});

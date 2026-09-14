import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="#hosted-route">{children}</a>,
  useNavigate: () => vi.fn(),
}));

import { HostedStylesHubScreen } from "./HostedProductScreens";
import { NewStyleScreen } from "../screens/NewStyleScreen";

function renderHosted(node: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("production image style creation", () => {
  it("exposes the add action and opens the hosted workflow", async () => {
    vi.stubEnv("VITE_VIDEOFORGE_PROVIDER_MODE", "production");
    const catalog = {
      styles: [],
      avatars: [],
      media_worker_state: "ONLINE",
      gpu_transport: "QUALIFIED_EXACT",
      gpu_readiness: {
        schema_version: "videoforge-hosted-gpu-readiness/v1",
        gpu_transport: "QUALIFIED_EXACT",
        provider_calls_authorized: true,
        dispatch_available: true,
        lanes: [
          {
            lane: "MAGE_IMAGE",
            checkpoint: "V2-07",
            qualification: "QUALIFIED_EXACT",
            visual_approval: "NOT_APPLICABLE",
            provider_free_groundwork_commits: ["1283a23248c9b79832b6fb331b00474e1df70f81"],
            missing_gates: [],
          },
          {
            lane: "SOULX_AVATAR",
            checkpoint: "V2-08",
            qualification: "QUALIFIED_EXACT",
            visual_approval: "APPROVED_EXACT_FULL_AND_SPLIT",
            provider_free_groundwork_commits: [
              "7039092707103ab35e8010c009e14409a6e52f63",
              "84e00881d98e3e77dd8aad121453ed6e7287bc74",
              "e49b93854d58c4faeb8bdd10b9b9df07321026db",
              "f3557059d7d5f0637ea223b3e758389fbd80a52b",
            ],
            missing_gates: [],
          },
        ],
      },
    } as const;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(catalog)),
    );

    renderHosted(<HostedStylesHubScreen />);
    expect(await screen.findByRole("link", { name: "New style" })).toBeVisible();

    cleanup();
    renderHosted(<NewStyleScreen />);
    expect(await screen.findByRole("heading", { name: "New image style" })).toBeVisible();
    expect(screen.getByLabelText("Style name")).toBeVisible();
    expect(screen.getByLabelText("Upload style references")).toBeVisible();
  });
});

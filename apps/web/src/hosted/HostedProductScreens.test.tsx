import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="#hosted-route">{children}</a>,
}));

import {
  HostedCreateProjectScreen,
  HostedProjectScreen,
  HostedUsageScreen,
} from "./HostedProductScreens";

function renderHosted(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("hosted product journey", () => {
  it("blocks generation until the account-owned personal worker is online", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          avatars: [{ profile_id: "p1", version_id: "a1", name: "Owner", version_number: 1 }],
          styles: [{ style_id: "s1", version_id: "sv1", name: "Documentary", version_number: 1 }],
          media_worker_state: "WAITING_FOR_YOUR_COMPUTER",
        }),
      ),
    );
    renderHosted(<HostedCreateProjectScreen />);

    expect(await screen.findByText("Waiting for your computer.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create and transcribe" })).toBeDisabled();
    expect(screen.getByText(/GPU transport disabled during V2-06 staging/u)).toBeInTheDocument();
  });

  it("shows completed ASR without inventing a final render", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          project: {
            id: "11111111-1111-4111-8111-111111111111",
            title: "Private project",
            created_at: "2026-08-17T10:00:00.000Z",
            revision_id: "22222222-2222-4222-8222-222222222222",
            revision_state: "LOCKED",
          },
          attempts: [
            {
              id: "33333333-3333-4333-8333-333333333333",
              kind: "ASR",
              state: "SUCCEEDED",
              version: 3,
              created_at: "2026-08-17T10:00:00.000Z",
              updated_at: "2026-08-17T10:01:00.000Z",
              terminal_at: "2026-08-17T10:01:00.000Z",
              output_checksum_sha256: `sha256:${"a".repeat(64)}`,
              approved_at: null,
              preview_url: null,
            },
          ],
          gpu_transport: "DISABLED_FAKE_ONLY",
        }),
      ),
    );
    renderHosted(<HostedProjectScreen projectId="11111111-1111-4111-8111-111111111111" />);

    expect(await screen.findByText("Transcription complete.")).toBeInTheDocument();
    expect(screen.getByText(/no fake final video is being claimed/u)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Review video" })).not.toBeInTheDocument();
  });

  it("reports only measured personal-worker and retained-object facts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          current_month_provider_cpu_usd: 0,
          current_month_gpu_usd: 0,
          attempts: 4,
          succeeded: 2,
          failed: 1,
          personal_worker_seconds: 125,
          retained_bytes: 1_073_741_824,
          storage_policy: "DURABLE_UNTIL_EXPLICIT_DELETE",
        }),
      ),
    );
    renderHosted(<HostedUsageScreen />);

    expect(await screen.findByText("125s")).toBeInTheDocument();
    expect(screen.getByText("1.000 GB")).toBeInTheDocument();
    expect(screen.getAllByText("$0.00")).toHaveLength(2);
    expect(screen.queryByText(/estimated/u)).not.toBeInTheDocument();
  });
});

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

  it("fails closed when ASR succeeds without an exact render plan", async () => {
    const detail = {
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
          kind: "ASR" as const,
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
      gpu_transport: "DISABLED_FAKE_ONLY" as const,
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/render"))
        return Response.json({ error: { code: "HOSTED_RENDER_PLAN_NOT_READY" } }, { status: 409 });
      return Response.json(detail);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderHosted(<HostedProjectScreen projectId="11111111-1111-4111-8111-111111111111" />);

    expect(
      await screen.findByText(/render is waiting for the exact project plan/u),
    ).toBeInTheDocument();
    expect(screen.getByText(/HOSTED_RENDER_PLAN_NOT_READY/u)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/api/v2/cpu-attempts"))).toBe(
      false,
    );
    expect(screen.queryByRole("link", { name: "Review video" })).not.toBeInTheDocument();
  });

  it("hands a successful ASR result to the owned render attempt", async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    const revisionId = "22222222-2222-4222-8222-222222222222";
    const asrId = "33333333-3333-4333-8333-333333333333";
    const renderId = "44444444-4444-4444-8444-444444444444";
    const renderSubmission = {
      schema_version: "videoforge-hosted-cpu-submission/v1",
      idempotency_key: `project-${projectId}-render-v1`,
      project_id: projectId,
      project_revision_id: revisionId,
      kind: "RENDER",
      input_document: {
        schema_version: "render-job-input/v1",
        output: { result_uri: "vf-local-run://placeholder/output.mp4" },
      },
      objects: [
        {
          artifact_receipt_id: "55555555-5555-4555-8555-555555555555",
          uri: `vf-local://objects/sha256/cc/${"c".repeat(64)}.mp4`,
        },
      ],
    };
    let renderSubmitted = false;
    const detail = () => ({
      project: {
        id: projectId,
        title: "Private project",
        created_at: "2026-08-17T10:00:00.000Z",
        revision_id: revisionId,
        revision_state: "LOCKED",
      },
      attempts: [
        {
          id: asrId,
          kind: "ASR" as const,
          state: "SUCCEEDED",
          version: 3,
          created_at: "2026-08-17T10:00:00.000Z",
          updated_at: "2026-08-17T10:01:00.000Z",
          terminal_at: "2026-08-17T10:01:00.000Z",
          output_checksum_sha256: `sha256:${"a".repeat(64)}`,
          approved_at: null,
          preview_url: null,
        },
        ...(renderSubmitted
          ? [
              {
                id: renderId,
                kind: "RENDER" as const,
                state: "OUTBOXED",
                version: 1,
                created_at: "2026-08-17T10:02:00.000Z",
                updated_at: "2026-08-17T10:02:00.000Z",
                terminal_at: null,
                output_checksum_sha256: null,
                approved_at: null,
                preview_url: null,
              },
            ]
          : []),
      ],
      gpu_transport: "DISABLED_FAKE_ONLY" as const,
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/render"))
        return Response.json({
          schema_version: "videoforge-hosted-render-handoff/v1",
          project_id: projectId,
          project_revision_id: revisionId,
          asr_attempt_id: asrId,
          cpu_submission: renderSubmission,
        });
      if (path.endsWith("/api/v2/cpu-attempts")) {
        renderSubmitted = true;
        expect(JSON.parse(String(init?.body))).toEqual(renderSubmission);
        return Response.json({ id: renderId, state: "OUTBOXED" }, { status: 202 });
      }
      return Response.json(detail());
    });
    vi.stubGlobal("fetch", fetchMock);
    renderHosted(<HostedProjectScreen projectId={projectId} />);

    expect(await screen.findByText("Render final video")).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([input]) => String(input).endsWith("/render")),
    ).toBe(true);
    expect(
      fetchMock.mock.calls.some(([input]) => String(input).endsWith("/api/v2/cpu-attempts")),
    ).toBe(true);
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

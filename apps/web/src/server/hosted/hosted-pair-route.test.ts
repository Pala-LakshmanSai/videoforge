import { describe, expect, it, vi } from "vitest";
import canonicalPlan from "../../../../../project-context/evidence/fixtures/resolved_render_manifest.v209-short.valid.json";

import { handleHostedPairDispatch } from "./app";

const ids = {
  generation: "33333333-3333-4333-8333-333333333333",
  approval: "44444444-4444-4444-8444-444444444444",
  claim: "55555555-5555-4555-8555-555555555555",
  project: "66666666-6666-4666-8666-666666666666",
  revision: "77777777-7777-4777-8777-777777777777",
  lease: "88888888-8888-4888-8888-888888888888",
  account: "11111111-1111-4111-8111-111111111111",
  workspace: "22222222-2222-4222-8222-222222222222",
} as const;

const config = {
  publicOrigin: "https://videoforge.example",
  neon: { databaseUrl: "postgres://runtime.invalid/db" },
  gpuTransport: "QUALIFIED_EXACT",
  gpuActivation: { evidenceSha256: `sha256:${"e".repeat(64)}` },
} as never;
const disabledConfig = {
  publicOrigin: "https://videoforge.example",
  neon: { databaseUrl: "postgres://runtime.invalid/db" },
  gpuTransport: "DISABLED_UNQUALIFIED",
  gpuActivation: null,
} as never;
const context = { waitUntil: vi.fn() } as never;
const qualifiedEnvironment = {
  VIDEOFORGE_GPU_TRANSPORT: "QUALIFIED_EXACT",
  VIDEOFORGE_RECONCILER_DATABASE_URL: "postgres://reconciler.invalid/db",
} as never;
const request = (body: unknown, origin = "https://videoforge.example") =>
  new Request(`https://videoforge.example/api/v2/hosted/generations/${ids.generation}/dispatch`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
const body = () => ({
  approvalId: ids.approval,
  approvalSha256: `sha256:${"a".repeat(64)}`,
  claimId: ids.claim,
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  generationPlanSha256: "sha256:f975e2be15db227e96c6ea06f025c3f7ead025a5f80b80e9e2b0ac1f9fd6a4ea",
  laneBindings: [{ lane: "mage_image" }, { lane: "soulx_avatar" }],
  leaseId: ids.lease,
  pair: [{ lane: "mage_image" }, { lane: "soulx_avatar" }],
  renderPlan: structuredClone(canonicalPlan),
  projectId: ids.project,
  projectRevisionId: ids.revision,
  totalCapUsd: 2,
});

function dependencies() {
  const runtime = {
    query: vi.fn().mockResolvedValue({
      rows: [{ account_id: ids.account, workspace_id: ids.workspace }],
    }),
    end: vi.fn().mockResolvedValue(undefined),
  };
  const reconciler = { query: vi.fn(), end: vi.fn().mockResolvedValue(undefined) };
  const createPool = vi.fn().mockReturnValueOnce(runtime).mockReturnValueOnce(reconciler);
  const commitAndSchedule = vi
    .fn()
    .mockResolvedValue({ id: `hosted-pair-${ids.generation}`, recovered: false });
  const observeAdmission = vi.fn().mockResolvedValue({
    databaseNow: "2026-08-26T06:00:00.000Z",
    providerObservedAt: "2026-08-26T05:59:30.000Z",
    rate: {
      gpu: "NVIDIA GeForce RTX 4090",
      region: "EU-RO-1",
      availability: "HIGH",
      secureReferenceRateMicroUsdPerGpuHour: 740_000,
      flexRateMicroUsdPerGpuHour: 1_100_000,
      checkedAt: "2026-08-26T05:59:30.000Z",
    },
    billing: {
      cumulativeEndpointBillingMicroUsd: 2_000_000,
      checkedAt: "2026-08-26T05:59:30.000Z",
    },
    phaseCapMicroUsd: 2_000_000,
    combinedCompletionCapMicroUsd: 17_500_000,
    redispatchAuthorized: false,
  });
  return {
    runtime,
    reconciler,
    commitAndSchedule,
    observeAdmission,
    value: {
      createPool,
      createExecutor: (pool: unknown) => pool,
      session: vi.fn().mockResolvedValue({
        user: { id: "user-1" },
        session: { token: "opaque-session" },
      }),
      observeAdmission,
      commitAndSchedule,
    } as never,
  };
}

describe("authenticated hosted pair dispatch route", () => {
  it("keeps DISABLED_UNQUALIFIED at zero database and Workflow calls", async () => {
    const deps = dependencies();
    const response = await handleHostedPairDispatch(
      request(body()),
      { VIDEOFORGE_GPU_TRANSPORT: "DISABLED_UNQUALIFIED" } as never,
      disabledConfig,
      context,
      ids.generation,
      deps.value,
    );
    expect(response.status).toBe(503);
    expect(deps.commitAndSchedule).not.toHaveBeenCalled();
    expect(deps.runtime.query).not.toHaveBeenCalled();
  });

  it("rejects cross-origin writes before session or database access", async () => {
    const deps = dependencies();
    const response = await handleHostedPairDispatch(
      request(body(), "https://attacker.example"),
      qualifiedEnvironment,
      config,
      context,
      ids.generation,
      deps.value,
    );
    expect(response.status).toBe(403);
    expect(deps.commitAndSchedule).not.toHaveBeenCalled();
    expect(deps.runtime.query).not.toHaveBeenCalled();
  });

  it("rejects a body that tries to forge tenant scope", async () => {
    const deps = dependencies();
    const response = await handleHostedPairDispatch(
      request({ ...body(), accountId: "99999999-9999-4999-8999-999999999999" }),
      qualifiedEnvironment,
      config,
      context,
      ids.generation,
      deps.value,
    );
    expect(response.status).toBe(400);
    expect(deps.commitAndSchedule).not.toHaveBeenCalled();
  });

  it("uses admitted session scope and invokes exactly one durable Workflow scheduler", async () => {
    const deps = dependencies();
    const response = await handleHostedPairDispatch(
      request(body()),
      qualifiedEnvironment,
      config,
      context,
      ids.generation,
      deps.value,
    );
    expect(response.status).toBe(202);
    expect(deps.commitAndSchedule).toHaveBeenCalledTimes(1);
    expect(deps.observeAdmission).toHaveBeenCalledTimes(1);
    expect(deps.commitAndSchedule.mock.calls[0]?.[3]).toMatchObject({
      accountId: ids.account,
      workspaceId: ids.workspace,
      generationRequestId: ids.generation,
    });
    expect(deps.commitAndSchedule.mock.calls[0]?.[4]).toMatchObject({
      planSha256: body().generationPlanSha256,
      cancelAt: "2026-08-26T06:20:00.000Z",
      stopAt: "2026-08-26T06:30:00.000Z",
    });
    expect(deps.runtime.end).toHaveBeenCalledOnce();
    expect(deps.reconciler.end).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toMatchObject({
      workflow_id: `hosted-pair-${ids.generation}`,
    });
  });
});

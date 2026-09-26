import { beforeEach, describe, expect, it, vi } from "vitest";

const ids = {
  account: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  workspace: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  user: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  project: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  revision: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  failed: "ffffffff-ffff-4fff-8fff-ffffffffffff",
  ioFailed: "22222222-2222-4222-8222-222222222222",
  inputFailed: "33333333-3333-4333-8333-333333333333",
  processFailed: "44444444-4444-4444-8444-444444444444",
  retry: "11111111-1111-4111-8111-111111111111",
};
const bundleSha256 = `sha256:${"a".repeat(64)}`;
const config = { neon: { databaseUrl: "postgres://unused" },
  mediaWorkerRelease: { executionBundleSha256: bundleSha256, version: "0.1.36" } } as never;

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  end: vi.fn(),
  sameOrigin: vi.fn(() => true),
  scope: vi.fn(),
  exactPlan: vi.fn(),
}));

vi.mock("./neon", () => ({
  createNeonPool: () => ({ end: mocks.end }),
  createNeonExecutor: () => ({ transaction: (work: (tx: { query: typeof mocks.query }) => unknown) =>
    work({ query: mocks.query }) }),
}));
vi.mock("./hosted-product-route-common", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sameOrigin: mocks.sameOrigin,
  sessionScope: mocks.scope,
}));
vi.mock("./submission", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  exactHostedRenderSubmission: mocks.exactPlan,
}));

import { retryHostedApiRender } from "./hosted-render-retry-route";

const request = (failedAttemptId = ids.failed) => new Request(
  `https://example.test/api/v2/hosted/projects/${ids.project}/render-retry`,
  {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      schema_version: "videoforge-hosted-render-disk-retry/v1",
      failed_attempt_id: failedAttemptId,
    }),
  },
);

describe("render-only disk recovery route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sameOrigin.mockReturnValue(true);
    mocks.scope.mockResolvedValue({ account_id: ids.account, workspace_id: ids.workspace, user_id: ids.user });
    mocks.exactPlan.mockReturnValue({ kind: "RENDER", projectId: ids.project, projectRevisionId: ids.revision });
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("videoforge_prepare_hosted_api_render_recovery")) return { rows: [{ recovery: {
        schema_version: "videoforge-hosted-render-disk-recovery/v1",
        revision_id: ids.revision,
        retry_attempt_id: ids.retry,
        recovery_kind: "DISK",
      } }] };
      if (sql.includes("FROM public.hosted_render_plans")) return { rows: [{ payload: { kind: "RENDER" } }] };
      return { rows: [] };
    });
  });

  it("schedules one exact CPU identity without provider dispatch and reuses it on response replay", async () => {
    const schedule = vi.fn().mockResolvedValue({ state: "OUTBOXED" });
    const context = { waitUntil() {} } as never;
    for (let replay = 0; replay < 2; replay += 1) {
      const result = await retryHostedApiRender(request(), ids.project, config, context, { schedule });
      expect(result.status).toBe(202);
      expect(await result.json()).toMatchObject({
        attempt_id: ids.retry,
        state: "OUTBOXED",
        provider_calls_authorized: false,
      });
    }
    expect(schedule).toHaveBeenCalledTimes(2);
    expect(schedule).toHaveBeenCalledWith({
      accountId: ids.account,
      workspaceId: ids.workspace,
      submission: { kind: "RENDER", projectId: ids.project, projectRevisionId: ids.revision },
      expectedAttemptId: ids.retry,
      renderRecoveryKey: `render-disk-recovery:${ids.revision}`,
    });
    expect(mocks.query.mock.calls.filter(([sql]) => String(sql).includes("videoforge_prepare_hosted_api_render_recovery"))).toHaveLength(2);
    expect(mocks.query.mock.calls.find(([sql]) => String(sql).includes("videoforge_prepare_hosted_api_render_recovery"))?.[1]).toContain(bundleSha256);
  });

  it("uses a distinct idempotency key for an evidence-approved second I/O recovery", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("videoforge_prepare_hosted_api_render_recovery")) return { rows: [{ recovery: {
        schema_version: "videoforge-hosted-render-disk-recovery/v1",
        revision_id: ids.revision,
        retry_attempt_id: ids.retry,
        recovery_kind: "IO",
      } }] };
      if (sql.includes("FROM public.hosted_render_plans")) return { rows: [{ payload: { kind: "RENDER" } }] };
      return { rows: [] };
    });
    const schedule = vi.fn().mockResolvedValue({ state: "OUTBOXED" });
    const result = await retryHostedApiRender(request(ids.ioFailed), ids.project,
      config, { waitUntil() {} } as never,
      { schedule });
    expect(result.status).toBe(202);
    expect(schedule).toHaveBeenCalledWith(expect.objectContaining({
      expectedAttemptId: ids.retry,
      renderRecoveryKey: `render-io-recovery:${ids.revision}`,
    }));
  });

  it("uses a third key only for the database-approved input recovery", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("videoforge_prepare_hosted_api_render_recovery")) return { rows: [{ recovery: {
        schema_version: "videoforge-hosted-render-disk-recovery/v1",
        revision_id: ids.revision,
        retry_attempt_id: ids.retry,
        recovery_kind: "INPUT",
      } }] };
      if (sql.includes("FROM public.hosted_render_plans")) return { rows: [{ payload: { kind: "RENDER" } }] };
      return { rows: [] };
    });
    const schedule = vi.fn().mockResolvedValue({ state: "OUTBOXED" });
    const result = await retryHostedApiRender(request(ids.inputFailed), ids.project,
      config, { waitUntil() {} } as never, { schedule });
    expect(result.status).toBe(202);
    expect(schedule).toHaveBeenCalledWith(expect.objectContaining({
      expectedAttemptId: ids.retry,
      renderRecoveryKey: `render-input-recovery:${ids.revision}`,
    }));
  });

  it("uses a distinct key for the database-approved process recovery", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("videoforge_prepare_hosted_api_render_recovery")) return { rows: [{ recovery: {
        schema_version: "videoforge-hosted-render-disk-recovery/v1",
        revision_id: ids.revision,
        retry_attempt_id: ids.retry,
        recovery_kind: "PROCESS",
      } }] };
      if (sql.includes("FROM public.hosted_render_plans")) return { rows: [{ payload: { kind: "RENDER" } }] };
      return { rows: [] };
    });
    const schedule = vi.fn().mockResolvedValue({ state: "OUTBOXED" });
    const result = await retryHostedApiRender(request(ids.processFailed), ids.project,
      config, { waitUntil() {} } as never, { schedule });
    expect(result.status).toBe(202);
    expect(schedule).toHaveBeenCalledWith(expect.objectContaining({
      expectedAttemptId: ids.retry,
      renderRecoveryKey: `render-process-recovery:${ids.revision}`,
    }));
  });

  it("uses a distinct key for the database-approved signal recovery", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("videoforge_prepare_hosted_api_render_recovery")) return { rows: [{ recovery: {
        schema_version: "videoforge-hosted-render-disk-recovery/v1",
        revision_id: ids.revision,
        retry_attempt_id: ids.retry,
        recovery_kind: "SIGNAL",
      } }] };
      if (sql.includes("FROM public.hosted_render_plans")) return { rows: [{ payload: { kind: "RENDER" } }] };
      return { rows: [] };
    });
    const schedule = vi.fn().mockResolvedValue({ state: "OUTBOXED" });
    const result = await retryHostedApiRender(request(ids.processFailed), ids.project,
      config, { waitUntil() {} } as never, { schedule });
    expect(result.status).toBe(202);
    expect(schedule).toHaveBeenCalledWith(expect.objectContaining({
      expectedAttemptId: ids.retry,
      renderRecoveryKey: `render-signal-recovery:${ids.revision}`,
    }));
    expect(mocks.query.mock.calls.find(([sql]) => String(sql).includes("videoforge_prepare_hosted_api_render_recovery"))?.[1])
      .toContain("0.1.36");
  });

  it("uses a distinct key for the database-approved output recovery", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("videoforge_prepare_hosted_api_render_recovery")) return { rows: [{ recovery: {
        schema_version: "videoforge-hosted-render-disk-recovery/v1",
        revision_id: ids.revision,
        retry_attempt_id: ids.retry,
        recovery_kind: "OUTPUT",
      } }] };
      if (sql.includes("FROM public.hosted_render_plans")) return { rows: [{ payload: { kind: "RENDER" } }] };
      return { rows: [] };
    });
    const schedule = vi.fn().mockResolvedValue({ state: "OUTBOXED" });
    const result = await retryHostedApiRender(request(ids.processFailed), ids.project,
      config, { waitUntil() {} } as never, { schedule });
    expect(result.status).toBe(202);
    expect(schedule).toHaveBeenCalledWith(expect.objectContaining({
      expectedAttemptId: ids.retry,
      renderRecoveryKey: `render-output-recovery:${ids.revision}`,
    }));
  });

  it("uses the exact saved retry identity for repeated local recoveries", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("videoforge_prepare_hosted_api_render_recovery")) return { rows: [{ recovery: {
        schema_version: "videoforge-hosted-render-disk-recovery/v1",
        revision_id: ids.revision, retry_attempt_id: ids.retry,
        recovery_kind: "LOCAL", recovery_key: `render-local-recovery:${ids.retry}`,
      } }] };
      if (sql.includes("FROM public.hosted_render_plans")) return { rows: [{ payload: { kind: "RENDER" } }] };
      return { rows: [] };
    });
    const schedule = vi.fn().mockResolvedValue({ state: "OUTBOXED" });
    const result = await retryHostedApiRender(request(ids.processFailed),ids.project,config,
      { waitUntil() {} } as never,{ schedule });
    expect(result.status).toBe(202);
    expect(schedule).toHaveBeenCalledWith(expect.objectContaining({
      expectedAttemptId:ids.retry,renderRecoveryKey:`render-local-recovery:${ids.retry}`,
    }));
    expect(await result.json()).toMatchObject({provider_calls_authorized:false});
  });

  it("rejects failed evidence before any CPU scheduling", async () => {
    mocks.query.mockRejectedValueOnce(Object.assign(new Error("evidence rejected"), { code: "23514" }));
    const schedule = vi.fn();
    const result = await retryHostedApiRender(request(), ids.project,
      config, { waitUntil() {} } as never,
      { schedule });
    expect(result.status).toBe(409);
    expect(schedule).not.toHaveBeenCalled();
  });

  it("rejects a malformed attempt before opening a database connection", async () => {
    const result = await retryHostedApiRender(request("bad"), ids.project,
      config, { waitUntil() {} } as never,
      { schedule: vi.fn() });
    expect(result.status).toBe(400);
    expect(mocks.query).not.toHaveBeenCalled();
  });
});

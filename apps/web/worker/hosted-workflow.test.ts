import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ backend: "RUNPOD_POD", observe: vi.fn(), query: vi.fn() }));
vi.mock("../src/server/hosted/configuration", () => ({ hostedRuntimeConfiguration: () => ({ neon: { databaseUrl: "fixture" } }) }));
vi.mock("../src/server/hosted/hosted-pair-production-composition", () => ({ hostedPairProductionBindingState: () => {} }));
vi.mock("../src/server/hosted/neon", () => ({
  createNeonPool: () => ({ end: async () => {} }),
  createNeonExecutor: () => ({ transaction: async (run: (value: unknown) => unknown) => run({ query: fixture.query }) }),
}));
vi.mock("../src/server/hosted/runpod-media", () => ({ runCloudMediaObservation: fixture.observe }));
import { HostedVideoWorkflow } from "./hosted-workflow";

const params = { attemptId: "11111111-1111-4111-8111-111111111111", accountId: "22222222-2222-4222-8222-222222222222", workspaceId: "33333333-3333-4333-8333-333333333333" };
const sleeps = vi.fn();
const steps: { name: string; options: unknown }[] = [];
const step = {
  async do(name: string, optionsOrCallback: unknown, callback?: () => Promise<unknown>) {
    steps.push({ name, options: typeof optionsOrCallback === "function" ? null : optionsOrCallback });
    return typeof optionsOrCallback === "function" ? optionsOrCallback() : callback!();
  },
  sleep: sleeps,
} as unknown as WorkflowStep;
const run = () => new HostedVideoWorkflow({} as never, {} as never).run({ payload: params } as WorkflowEvent<typeof params>, step);
beforeEach(() => {
  vi.clearAllMocks();
  steps.length = 0;
  fixture.backend = "RUNPOD_POD";
  fixture.query.mockImplementation(async (sql: string) => ({ rows: sql.includes("SELECT execution_backend") ? [{ execution_backend: fixture.backend }] : [] }));
});
it("drives Cloud with durable delays and no automatic paid-step retry", async () => {
  fixture.observe.mockResolvedValueOnce({ state: "WAITING_FOR_CAPACITY", delaySeconds: 30 }).mockResolvedValueOnce({ state: "SUCCEEDED" });
  expect(await run()).toEqual({ state: "SUCCEEDED" });
  expect(fixture.observe).toHaveBeenCalledTimes(2);
  expect(sleeps).toHaveBeenCalledWith("wait for cloud media 0", "30 seconds");
  expect(steps.filter(item => item.name.startsWith("reconcile cloud"))).toEqual([
    { name: "reconcile cloud media 0", options: { retries: { limit: 0, delay: "1 second", backoff: "constant" } } },
    { name: "reconcile cloud media 1", options: { retries: { limit: 0, delay: "1 second", backoff: "constant" } } },
  ]);
});
it("does not replay an observation with an unknown launch outcome", async () => {
  fixture.observe.mockRejectedValueOnce(new Error("launch outcome unknown"));
  await expect(run()).rejects.toThrow("launch outcome unknown");
  expect(fixture.observe).toHaveBeenCalledOnce();
  expect(sleeps).not.toHaveBeenCalled();
});

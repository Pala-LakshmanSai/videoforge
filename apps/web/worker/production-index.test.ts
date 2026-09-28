import { beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ reconcile: vi.fn(), retention: vi.fn(), continuation: vi.fn() }));
vi.mock("../src/server/hosted/app", () => ({ handleHostedRequest: vi.fn() }));
vi.mock("../src/server/hosted/retention", () => ({ runHostedRetention: fixture.retention }));
vi.mock("../src/server/hosted/stage-continuation-sweep", () => ({ runHostedContinuation: fixture.continuation }));
vi.mock("../src/server/hosted/runpod-media", () => ({ reconcileCloudMediaReservations: fixture.reconcile }));
vi.mock("./hosted-workflow", () => ({ HostedVideoWorkflow: class {} }));
vi.mock("./hosted-pair-workflow", () => ({ HostedPairWorkflow: class {} }));
vi.mock("./hosted-continuation-workflow", () => ({ HostedContinuationWorkflow: class {} }));
import worker from "./production-index";
const waitUntil = vi.fn();
const environment = {};
const run = (cron: string) => worker.scheduled({ cron } as never, environment, { waitUntil } as never);
beforeEach(() => {
  vi.clearAllMocks();
  fixture.reconcile.mockResolvedValue(undefined);
  fixture.retention.mockResolvedValue(undefined);
  fixture.continuation.mockResolvedValue([]);
});
it("reconciles cloud reservations independently on each scheduled trigger", async () => {
  await run("* * * * *");
  expect(fixture.reconcile).toHaveBeenCalledWith(environment);
  expect(fixture.continuation).toHaveBeenCalledOnce();
  expect(fixture.retention).not.toHaveBeenCalled();
});
it("keeps daily retention after cloud reconciliation", async () => {
  await run("17 2 * * *");
  expect(fixture.reconcile).toHaveBeenCalledOnce();
  expect(fixture.retention).toHaveBeenCalledOnce();
  expect(waitUntil).toHaveBeenCalledOnce();
});
it("preserves continuation when the independent cloud inventory check fails", async () => {
  fixture.reconcile.mockRejectedValueOnce(new Error("inventory unavailable"));
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  await run("* * * * *");
  expect(fixture.continuation).toHaveBeenCalledOnce();
  expect(warning).toHaveBeenCalledWith("cloud_media_reconciliation_failed", { cause: "Error" });
  warning.mockRestore();
});

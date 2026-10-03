import { describe, expect, it, vi } from "vitest";
import { startHostedCpuWorkflow } from "./app";
import type { HostedRuntimeEnvironment } from "./configuration";

const driver = vi.hoisted(() => ({ ensure: vi.fn() }));
vi.mock("./pair-observer-guard", () => ({ ensureHostedContinuationDriver: driver.ensure }));

const params = {
  attemptId: "11111111-1111-4111-8111-111111111111",
  accountId: "22222222-2222-4222-8222-222222222222",
  workspaceId: "33333333-3333-4333-8333-333333333333",
};

function environment(create = vi.fn(async () => ({ id: params.attemptId }))) {
  return { VIDEO_WORKFLOW: { create } } as unknown as HostedRuntimeEnvironment;
}

describe("durable CPU admission handoff", () => {
  it("returns after its own workflow while a slow shared driver remains protected in background", async () => {
    let finish!: (value: boolean) => void;
    const slow = new Promise<boolean>((resolve) => {
      finish = resolve;
    });
    driver.ensure.mockReturnValueOnce(slow);
    const waitUntil = vi.fn();
    const source = environment();
    const result = await startHostedCpuWorkflow(source, params, { waitUntil });
    expect(result.id).toBe(params.attemptId);
    expect(source.VIDEO_WORKFLOW!.create).toHaveBeenCalledWith({ id: params.attemptId, params });
    expect(waitUntil).toHaveBeenCalledWith(slow);
    finish(true);
    await slow;
  });

  it("preserves awaited shared-driver behavior for internal schedulers", async () => {
    let finish!: (value: boolean) => void;
    const slow = new Promise<boolean>((resolve) => {
      finish = resolve;
    });
    driver.ensure.mockReturnValueOnce(slow);
    let settled = false;
    const before = driver.ensure.mock.calls.length;
    const pending = startHostedCpuWorkflow(environment(), params).then(() => {
      settled = true;
    });
    await vi.waitFor(() => expect(driver.ensure).toHaveBeenCalledTimes(before + 1));
    expect(settled).toBe(false);
    finish(true);
    await pending;
    expect(settled).toBe(true);
  });

  it("does not acknowledge admission or start the driver when the exact workflow cannot be created", async () => {
    const error = new Error("workflow handoff unavailable");
    const create = vi.fn(async () => {
      throw error;
    });
    const before = driver.ensure.mock.calls.length;
    const waitUntil = vi.fn();
    await expect(startHostedCpuWorkflow(environment(create), params, { waitUntil })).rejects.toBe(
      error,
    );
    expect(driver.ensure).toHaveBeenCalledTimes(before);
    expect(waitUntil).not.toHaveBeenCalled();
  });
});

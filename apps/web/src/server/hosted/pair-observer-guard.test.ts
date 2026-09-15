import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HostedRuntimeEnvironment } from "./configuration";

/**
 * The driver guard is the only thing that starts the durable stage-continuation Workflow, so this
 * test pins the contract that matters operationally: a stable instance id, no restart while the
 * driver is running, a restart once it has completed its bounded window, and no throw on any path
 * (the desktop worker's claim must never depend on it).
 */
beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

function binding(options?: {
  readonly create?: () => Promise<{ id: string }>;
  readonly status?: () => Promise<unknown>;
  readonly restart?: () => Promise<void>;
}) {
  return {
    create: vi.fn(options?.create ?? (async () => ({ id: "hosted-continuation-driver" }))),
    get: vi.fn(async () => ({
      status: vi.fn(options?.status ?? (async () => ({ status: "running" }))),
      restart: vi.fn(options?.restart ?? (async () => {})),
    })),
  };
}

function environment(workflow: unknown): HostedRuntimeEnvironment {
  return { HOSTED_CONTINUATION_WORKFLOW: workflow } as unknown as HostedRuntimeEnvironment;
}

async function guard() {
  return import("./pair-observer-guard");
}

describe("ensureHostedContinuationDriver", () => {
  it("creates the driver once under a stable instance id", async () => {
    const driver = binding();
    const { ensureHostedContinuationDriver } = await guard();

    await expect(ensureHostedContinuationDriver(environment(driver))).resolves.toBe(true);
    expect(driver.create).toHaveBeenCalledWith({
      id: "hosted-continuation-driver",
      params: { reason: "personal-worker-claim" },
    });

    // Second poll within the probe interval: no churn, and no throw from the existing-instance path.
    await expect(ensureHostedContinuationDriver(environment(driver))).resolves.toBe(false);
    expect(driver.create).toHaveBeenCalledTimes(1);
  });

  it("does nothing while the driver is running", async () => {
    const driver = binding({
      create: async () => {
        throw new Error("instance already exists");
      },
      status: async () => ({ status: "running" }),
    });
    const { ensureHostedContinuationDriver } = await guard();

    await expect(ensureHostedContinuationDriver(environment(driver))).resolves.toBe(false);
    expect(driver.get).toHaveBeenCalledWith("hosted-continuation-driver");
    const existing = await driver.get.mock.results[0]!.value;
    expect(existing.restart).not.toHaveBeenCalled();
  });

  it("restarts a driver that finished its bounded ~24-hour window", async () => {
    const driver = binding({
      create: async () => {
        throw new Error("instance already exists");
      },
      status: async () => ({ status: "complete" }),
    });
    const { ensureHostedContinuationDriver } = await guard();

    await expect(ensureHostedContinuationDriver(environment(driver))).resolves.toBe(true);
    const existing = await driver.get.mock.results[0]!.value;
    expect(existing.restart).toHaveBeenCalledTimes(1);
  });

  it("never throws when there is no binding or the API fails", async () => {
    const { ensureHostedContinuationDriver } = await guard();

    await expect(ensureHostedContinuationDriver(environment(undefined))).resolves.toBe(false);

    vi.resetModules();
    const broken = binding({
      create: async () => {
        throw new Error("workflows api unavailable");
      },
      status: async () => {
        throw new Error("workflows api unavailable");
      },
    });
    broken.get.mockImplementation(async () => {
      throw new Error("workflows api unavailable");
    });
    const second = await guard();
    await expect(second.ensureHostedContinuationDriver(environment(broken))).resolves.toBe(false);
  });
});

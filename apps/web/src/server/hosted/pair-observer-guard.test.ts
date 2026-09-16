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

/**
 * The two scheduled sweeps (this guard and the stage-continuation sweep) read tables that are
 * RLS-forced on `videoforge_current_account_id()`. A single cross-tenant read with no tenant context
 * returns zero rows and looks exactly like "nothing to do": that is how the driver kept reporting
 * `observers: 0` / `dispatched: 0` for twenty minutes on 2026-09-16 while a project sat mid-pipeline.
 * These two tests pin the tenant-scoped read shape that replaced it.
 */
describe("tenant-scoped sweeps", () => {
  function poolFixture(accounts: readonly string[]) {
    const statements: string[] = [];
    const pool = {
      query: vi.fn(async (sql: string) => {
        statements.push(sql.trim());
        if (sql.includes("videoforge_admitted_hosted_account_ids"))
          return { rows: accounts.map((account_id) => ({ account_id })) };
        throw new Error(`unexpected pool query: ${sql.slice(0, 60)}`);
      }),
      end: vi.fn(async () => {}),
    };
    const sessions: string[] = [];
    const transaction = async (
      work: (transaction: {
        query: (sql: string, params?: readonly unknown[]) => Promise<{ rows: unknown[] }>;
      }) => Promise<unknown>,
    ) => {
      // The row set follows the tenant the transaction was opened with, exactly like RLS would.
      let current = accounts[0] ?? "";
      return work({
        query: async (sql: string, params?: readonly unknown[]) => {
          sessions.push(sql.trim());
          if (sql.includes("set_config")) {
            current = String(params?.[1] ?? current);
            return { rows: [] };
          }
          return {
            rows: [
              {
                generation_request_id: `request-${current}`,
                account_id: current,
                workspace_id: `workspace-${current}`,
              },
            ],
          };
        },
      });
    };
    vi.doMock("./neon", () => ({
      createNeonPool: () => pool,
      createNeonExecutor: () => ({ transaction }),
    }));
    return { pool, statements, sessions };
  }

  it("reads unsettled pairs per admitted account inside a tenant transaction", async () => {
    const { pool, statements, sessions } = poolFixture(["account-1", "account-2"]);
    const { unsettledPairsAcrossAccounts } = await guard();

    const rows = await unsettledPairsAcrossAccounts(pool as never);

    expect(rows.map((row) => row.generation_request_id)).toEqual([
      "request-account-1",
      "request-account-2",
    ]);
    expect(statements.join(" ")).toContain("videoforge_admitted_hosted_account_ids");
    // Every read happens with the tenant GUC set, and the query itself is account-parameterised.
    expect(sessions.filter((sql) => sql.includes("set_config")).length).toBe(2);
    expect(sessions.filter((sql) => sql.includes("account_id = $1")).length).toBe(2);
  });

  it("reads due projects per admitted account inside a tenant transaction", async () => {
    const { pool, statements, sessions } = poolFixture(["account-1"]);
    const { dueRowsAcrossAccounts } = await import("./stage-continuation-sweep");

    await dueRowsAcrossAccounts(pool as never);

    expect(statements.join(" ")).toContain("videoforge_admitted_hosted_account_ids");
    expect(sessions.filter((sql) => sql.includes("set_config")).length).toBe(1);
    expect(sessions.filter((sql) => sql.includes("WHERE project.status = 'ACTIVE'")).length).toBe(1);
  });
});

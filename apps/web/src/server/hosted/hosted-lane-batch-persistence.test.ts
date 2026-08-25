import {
  trustedTenantScope,
  type SqlExecutor,
  type TransactionalSqlExecutor,
} from "@videoforge/control-plane";
import { describe, expect, it, vi } from "vitest";

import {
  HostedSqlDispatchInspection,
  HostedSqlLaneBatchMaterializer,
} from "./hosted-lane-batch-persistence";

const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const WORKSPACE = "22222222-2222-4222-8222-222222222222";
const REQUEST = "55555555-5555-4555-8555-555555555555";
const scope = trustedTenantScope(ACCOUNT, WORKSPACE);
const sha = (value: string) => `sha256:${value.repeat(64)}` as const;

function database(query: ReturnType<typeof vi.fn>): TransactionalSqlExecutor {
  return {
    transaction: async (work: (executor: SqlExecutor) => Promise<unknown>) =>
      work({ query } as unknown as SqlExecutor),
  } as unknown as TransactionalSqlExecutor;
}

describe("hosted lane-batch SQL persistence", () => {
  it("uses the single atomic materialization capability with exact tenant and pair payload", async () => {
    const query = vi.fn(async (sql: string, parameters?: readonly unknown[]) => {
      void parameters;
      return {
        rows: sql.startsWith("SELECT set_config") ? [] : [{ replayed: false }],
        affectedRows: 0,
      };
    });
    const materializer = new HostedSqlLaneBatchMaterializer(database(query));
    const batches = [
      { schema_version: "videoforge-hosted-lane-batch/v1", lane: "mage_image" },
      { schema_version: "videoforge-hosted-lane-batch/v1", lane: "soulx_avatar" },
    ];
    await expect(
      materializer.materialize({
        scope,
        projectId: "33333333-3333-4333-8333-333333333333",
        projectRevisionId: "44444444-4444-4444-8444-444444444444",
        generationRequestId: REQUEST,
        generationPlanSha256: sha("a"),
        batches,
      }),
    ).resolves.toEqual({ replayed: false });
    expect(query).toHaveBeenNthCalledWith(1, "SELECT set_config($1,$2,true)", [
      "videoforge.account_id",
      ACCOUNT,
    ]);
    expect(query.mock.calls[1]![0]).toContain("videoforge_materialize_hosted_lane_batches");
    expect(JSON.parse(query.mock.calls[1]![1]![6] as string)).toEqual(batches);
  });

  it("fails closed unless materialization returns one exact replay result", async () => {
    const query = vi.fn(async (sql: string) => ({
      rows: sql.startsWith("SELECT set_config") ? [] : [],
      affectedRows: 0,
    }));
    await expect(
      new HostedSqlLaneBatchMaterializer(database(query)).materialize({
        scope,
        projectId: "33333333-3333-4333-8333-333333333333",
        projectRevisionId: "44444444-4444-4444-8444-444444444444",
        generationRequestId: REQUEST,
        generationPlanSha256: sha("a"),
        batches: [],
      }),
    ).rejects.toMatchObject({ code: "HOSTED_SERVERLESS_PLAN_LINEAGE_INVALID" });
  });

  it("tenant-scopes inspection and exposes no plan without both batches and a current approval", async () => {
    const query = vi.fn(async (sql: string, parameters?: readonly unknown[]) => {
      void parameters;
      return { rows: sql.startsWith("SELECT set_config") ? [] : [], affectedRows: 0 };
    });
    const inspection = new HostedSqlDispatchInspection(database(query));
    await expect(inspection.readPlan(scope, REQUEST)).resolves.toBeNull();
    expect(query).toHaveBeenNthCalledWith(1, "SELECT set_config($1,$2,true)", [
      "videoforge.account_id",
      ACCOUNT,
    ]);
    expect(query.mock.calls[1]![0]).toMatch(/HAVING count\(\*\)=2/u);
    expect(query.mock.calls[1]![1]).toEqual([ACCOUNT, WORKSPACE, REQUEST]);
  });
});

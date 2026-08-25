import {
  trustedTenantScope,
  type SqlExecutor,
  type TransactionalSqlExecutor,
} from "@videoforge/control-plane";
import { describe, expect, it, vi } from "vitest";

import { HostedSqlPaidAuthorityGate } from "./hosted-paid-authority-gate";

const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const WORKSPACE = "22222222-2222-4222-8222-222222222222";
const sha = (character: string) => `sha256:${character.repeat(64)}` as const;

function input() {
  return {
    approvalId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    approvalSha256: sha("a"),
    claimId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    scope: trustedTenantScope(ACCOUNT, WORKSPACE),
    projectId: "33333333-3333-4333-8333-333333333333",
    projectRevisionId: "44444444-4444-4444-8444-444444444444",
    generationRequestId: "55555555-5555-4555-8555-555555555555",
    generationPlanSha256: sha("b"),
    leaseId: "66666666-6666-4666-8666-666666666666",
    lanes: (["mage_image", "soulx_avatar"] as const).map((lane, index) => ({
      lane,
      checkpointId: (lane === "mage_image" ? "V2-07" : "V2-08") as "V2-07" | "V2-08",
      operations: ["serverless_run", "serverless_status", "serverless_cancel"],
      resources: ["endpoint:a", "gpu:b", "image:c", "volume:d"],
      deploymentId: `${String(index + 7).repeat(8)}-${String(index + 7).repeat(4)}-4${String(index + 7).repeat(3)}-8${String(index + 7).repeat(3)}-${String(index + 7).repeat(12)}`,
      endpointIdSha256: sha("c"),
      endpointConfigSha256: sha("d"),
      workerImageDigest: sha("e"),
      modelManifestSha256: sha("f"),
      volumeIdSha256: sha("1"),
      volumeManifestSha256: sha("2"),
      deploymentSnapshotSha256: sha("3"),
    })),
    totalCapUsd: 2,
    cumulativeReservationUsd: 1.5,
    expiresAt: "2026-08-25T13:00:00.000Z",
  };
}

describe("HostedSqlPaidAuthorityGate", () => {
  it("binds tenant scope and returns only the DB-trusted claim timestamp", async () => {
    const query = vi.fn(async (sql: string, parameters?: readonly unknown[]) => {
      void parameters;
      return sql.startsWith("SELECT set_config")
        ? { rows: [], affectedRows: 0 }
        : {
            rows: [
              {
                approval_id: input().approvalId,
                approval_sha256: input().approvalSha256,
                claim_id: input().claimId,
                account_id: ACCOUNT,
                workspace_id: WORKSPACE,
                generation_request_id: input().generationRequestId,
                total_cap_usd: "2.000000",
                cumulative_reservation_usd: "1.500000",
                expires_at: new Date(input().expiresAt),
                claimed_at: new Date("2026-08-25T12:00:01.234Z"),
              },
            ],
            affectedRows: 1,
          };
    });
    const transaction = vi.fn(async (work: (transaction: SqlExecutor) => Promise<unknown>) =>
      work({ query } as unknown as SqlExecutor),
    );
    const gate = new HostedSqlPaidAuthorityGate({
      transaction,
    } as unknown as TransactionalSqlExecutor);

    await expect(gate.claimOnce(input())).resolves.toMatchObject({
      totalCapUsd: 2,
      cumulativeReservationUsd: 1.5,
      claimedAt: "2026-08-25T12:00:01.234Z",
    });
    expect(query).toHaveBeenNthCalledWith(1, "SELECT set_config($1, $2, true)", [
      "videoforge.account_id",
      ACCOUNT,
    ]);
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("public.videoforge_claim_hosted_paid_dispatch"),
      expect.arrayContaining([input().leaseId, input().generationPlanSha256]),
    );
    const parameters = query.mock.calls[1]![1] as readonly unknown[];
    expect(JSON.parse(parameters[10] as string)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          lane: "mage_image",
          checkpoint_id: "V2-07",
          deployment_snapshot_sha256: sha("3"),
        }),
      ]),
    );
  });

  it("fails closed when the database does not return exactly one claim", async () => {
    const query = vi.fn(async (sql: string, parameters?: readonly unknown[]) => {
      void parameters;
      return { rows: sql.startsWith("SELECT set_config") ? [] : [], affectedRows: 0 };
    });
    const gate = new HostedSqlPaidAuthorityGate({
      transaction: async (work: (transaction: SqlExecutor) => Promise<unknown>) =>
        work({ query } as unknown as SqlExecutor),
    } as unknown as TransactionalSqlExecutor);
    await expect(gate.claimOnce(input())).rejects.toMatchObject({
      code: "HOSTED_SERVERLESS_PAID_AUTHORITY_CLAIM_INVALID",
    });
  });
});

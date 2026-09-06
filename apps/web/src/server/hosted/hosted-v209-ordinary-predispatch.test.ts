import { describe, expect, it, vi } from "vitest";

import { HostedSqlV209OrdinaryPredispatch } from "./hosted-v209-ordinary-predispatch";

const sha = (digit: string) => `sha256:${digit.repeat(64)}`;

describe("ordinary V2-09 atomic predispatch adapter", () => {
  it("passes only tenant/project scope and the frozen admission to migration 0074", async () => {
    const query = vi.fn(async (sql: string, parameters: readonly unknown[] = []) => {
      void parameters;
      return {
        rows: sql.includes("videoforge_commit_hosted_v209_ordinary_pair")
          ? (["mage_image", "soulx_avatar"] as const).map((lane, index) => ({
              lane,
              attempt_id: `${index + 1}1111111-1111-4111-8111-111111111111`,
              authority_id: `${index + 3}3333333-3333-4333-8333-333333333333`,
              outbox_id: `${index + 5}5555555-5555-4555-8555-555555555555`,
              dispatch_token: `dt-${lane}-${"x".repeat(40)}`,
              dispatch_token_sha256: sha("1"),
              unsigned_envelope: {},
              unsigned_envelope_sha256: sha("2"),
              request_body_sha256: sha("3"),
              endpoint_id_sha256: sha("4"),
              output_prefix: `private/${lane}`,
              authority_sha256: sha("5"),
              request_ttl_seconds: 1_200,
              deadline_at: "2026-09-06T01:20:00.000Z",
              reconciliation_deadline_at: "2026-09-06T01:30:00.000Z",
            }))
          : [],
      };
    });
    const database = {
      transaction: vi.fn(async (work: (transaction: { query: typeof query }) => unknown) =>
        work({ query }),
      ),
    };
    const admission = {
      schemaVersion: "videoforge-v2-09-ordinary-admission/v1",
      admissionSha256: sha("a"),
    } as never;
    const result = await new HostedSqlV209OrdinaryPredispatch(database as never).commit({
      accountId: "11111111-1111-4111-8111-111111111111",
      workspaceId: "22222222-2222-4222-8222-222222222222",
      userId: "33333333-3333-4333-8333-333333333333",
      projectId: "44444444-4444-4444-8444-444444444444",
      admission,
      dispatchTokenKey: "secret-token-key-material-00000000",
    });
    expect(result.map((item) => item.lane)).toEqual(["mage_image", "soulx_avatar"]);
    const call = query.mock.calls.find(([sql]) =>
      sql.includes("videoforge_commit_hosted_v209_ordinary_pair"),
    );
    expect(call?.[0]).toContain("$1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::jsonb");
    expect(call?.[1]).toEqual([
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333",
      "44444444-4444-4444-8444-444444444444",
      JSON.stringify(admission),
    ]);
  });
});

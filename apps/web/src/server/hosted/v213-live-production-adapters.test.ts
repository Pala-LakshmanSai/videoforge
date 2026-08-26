import { canonicalSha256, type TransactionalSqlExecutor } from "@videoforge/control-plane";
import { describe, expect, it, vi } from "vitest";

import {
  createV213SqlBridgeCallLoader,
  createV213HostedAcceptanceProductionFactory,
  V213SqlAttemptStore,
} from "./v213-live-production-adapters.js";

function database(query: ReturnType<typeof vi.fn>): TransactionalSqlExecutor {
  return {
    transaction: (work) => work({ query } as never),
  } as TransactionalSqlExecutor;
}

describe("V213 hosted live production adapters", () => {
  it("claims the exact execution through the SECURITY DEFINER store before transport", async () => {
    const claim = {
      requestSha256: canonicalSha256({ request: 1 }),
      promotionVersion: "V3",
      promotionState: "CONSUMED_CURRENT",
    };
    const query = vi.fn(async (...arguments_: unknown[]) => {
      expect(arguments_.length).toBeGreaterThan(0);
      return { rows: [{ value: claim }], rowCount: 1 };
    });
    const store = new V213SqlAttemptStore(database(query));
    await expect(
      store.claimOnce(claim.requestSha256, { checkpoint: "V2-10" } as never),
    ).resolves.toBe(claim);
    expect(query.mock.calls[0]?.[0]).toContain("videoforge_claim_v213_live_acceptance");
  });

  it("signs, stores, reloads, and verifies DB-owned receipt evidence", async () => {
    let stored: Record<string, unknown> | undefined;
    const query = vi.fn(async (sql: string, values: readonly unknown[]) => {
      const input = JSON.parse(String(values[0])) as Record<string, unknown>;
      if (sql.includes("record_v213_signed_evidence")) {
        stored = input;
        return { rows: [{ value: input.artifactSha256 }], rowCount: 1 };
      }
      return { rows: [{ value: stored }], rowCount: 1 };
    });
    const transport = {
      kind: "CLOUDFLARE_HOSTED_RUNPOD_SERVERLESS" as const,
      execute: vi.fn(),
      cancelAndReconcile: vi.fn(),
    };
    const factory = createV213HostedAcceptanceProductionFactory({
      database: database(query),
      evidenceSigningKey: new TextEncoder().encode("a".repeat(32)),
      transport,
      now: () => new Date("2026-08-26T00:00:00.000Z"),
    });
    const document = {
      verifierId: "videoforge-v213-live-execution-receipt-verifier-v1",
      accepted: true,
    };
    const reference = await factory.evidence.signAndStore("RECEIPT", document);
    await expect(factory.receiptVerifier.verify(reference)).resolves.toEqual(document);
    await expect(
      factory.receiptVerifier.verify({ artifactSha256: canonicalSha256({ foreign: true }) }),
    ).rejects.toThrow("V213_SIGNED_EVIDENCE_INVALID");
  });

  it("loads a bridge call only through the exact consumed-authority SECURITY DEFINER function", async () => {
    const query = vi.fn(async (sql: string, parameters: readonly unknown[]) => {
      void sql;
      void parameters;
      return {
        rows: [{ value: { checkpoint: "V2-10", call: { request: {} } } }],
        rowCount: 1,
      };
    });
    const load = createV213SqlBridgeCallLoader(database(query));
    await expect(
      load({
        schemaVersion: "videoforge.v213-full-live-command/v1",
        commandId: "command-1",
        stageAuthorityId: "stage-1",
        command: "v2-10-operator-free-ranga-pilot",
        input: {
          requestSha256: canonicalSha256({ request: 1 }),
          outerStateSha256: canonicalSha256({ outer: 1 }),
        },
      }),
    ).resolves.toMatchObject({ checkpoint: "V2-10" });
    expect(query.mock.calls[0]?.[0]).toContain("videoforge_load_v213_bridge_acceptance_call");
  });
});

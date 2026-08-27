import { createHash } from "node:crypto";

import { canonicalSha256 } from "@videoforge/control-plane";
import { describe, expect, it, vi } from "vitest";

import {
  buildV213V212RealChromeRequestFromTerminalProjection,
  createV213V212ProductionTerminalOutputResolver,
  runV213V212LiveAcceptanceWithChrome,
  validateV213V212TerminalOutputProjection,
  V213_V212_TERMINAL_OUTPUT_PROJECTION_SCHEMA,
  type V213V212TerminalOutputProjection,
} from "./v213-v212-live-chrome-integration.js";

const NOW = new Date("2026-08-28T00:05:00.000Z");
const ORIGIN = "https://videoforge.example";
const IDS = Object.freeze({
  fullLiveAuthorityId: "11111111-1111-4111-8111-111111111111",
  stageAuthorityId: "22222222-2222-4222-8222-222222222222",
  accountId: "33333333-3333-4333-8333-333333333333",
  workspaceId: "44444444-4444-4444-8444-444444444444",
  projectId: "55555555-5555-4555-8555-555555555555",
  projectRevisionId: "66666666-6666-4666-8666-666666666666",
  attemptId: "v213-V2-12-attempt-1",
  executionId: "execution-v212-integration",
});

function hash(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

const scopeRequestSha256 = hash("scope-request");
const outputSha256 = hash("terminal-output");

const projection: V213V212TerminalOutputProjection = Object.freeze({
  schemaVersion: V213_V212_TERMINAL_OUTPUT_PROJECTION_SCHEMA,
  fullLiveAuthorityId: IDS.fullLiveAuthorityId,
  stageAuthorityId: IDS.stageAuthorityId,
  outerStateSha256: hash("outer-state"),
  operationId: "v2-12-long-output",
  checkpoint: "V2-12",
  workflowId: `v213-v2-12-${IDS.executionId}`,
  executionId: IDS.executionId,
  executionRequestSha256: hash("execution-request"),
  authoritySha256: hash("authority"),
  accountId: IDS.accountId,
  workspaceId: IDS.workspaceId,
  projectId: IDS.projectId,
  projectRevisionId: IDS.projectRevisionId,
  attemptId: IDS.attemptId,
  scopeRequestSha256,
  outputSha256,
  outputReceiptSha256: hash("output-receipt"),
  outputBytes: 1_024,
  terminalAt: "2026-08-28T00:00:00.000Z",
  workloadDeadlineAt: "2026-08-28T00:10:00.000Z",
  fullAuthorityExpiresAt: "2026-08-28T00:20:00.000Z",
  outputBindingSha256: hash("output-binding"),
});

const executionRequest = Object.freeze({
  checkpoint: "V2-12" as const,
  executionId: IDS.executionId,
  proposalSha256: hash("proposal"),
  authoritySha256: projection.authoritySha256,
  approvalRecordSha256: hash("approval"),
  cumulativeLedgerSha256: hash("ledger"),
  executorSha256: hash("executor"),
  promotionDecisionSha256: hash("promotion"),
  sourceCommit: "a".repeat(40),
  scopes: [
    {
      accountId: IDS.accountId,
      workspaceId: IDS.workspaceId,
      projectId: IDS.projectId,
      projectRevisionId: IDS.projectRevisionId,
      requestSha256: scopeRequestSha256,
      attemptId: IDS.attemptId,
    },
  ],
  maximumVariableCostMicroUsd: 2_000_000,
  maximumCumulativeVariableCostMicroUsd: 17_500_000 as const,
  billingBaselineMicroUsd: 0,
  cumulativeLedgerSpentBeforeMicroUsd: 0,
  retainedVolumeIdSha256s: { mage: hash("mage-volume"), soulx: hash("soulx-volume") },
  noRedispatch: true as const,
});

const materialized = Object.freeze({
  requestDocument: Object.freeze({
    schemaVersion: "videoforge.v213-hosted-acceptance-command/v1",
    commandId: "command-v212-integration",
    stageAuthorityId: IDS.stageAuthorityId,
    command: "v2-12-long-output",
    checkpoint: "V2-12",
    workflowId: projection.workflowId,
    attemptId: IDS.attemptId,
    accountId: IDS.accountId,
    workspaceId: IDS.workspaceId,
    projectId: IDS.projectId,
    projectRevisionId: IDS.projectRevisionId,
    outerStateSha256: projection.outerStateSha256,
    requestSha256: hash("materialized-request"),
    fullLiveAuthorityId: IDS.fullLiveAuthorityId,
  }),
  executionDocument: Object.freeze({
    schemaVersion: "videoforge.v213-database-acceptance-execution/v2",
    operationId: "v2-12-long-output",
    checkpoint: "V2-12",
    workflowId: projection.workflowId,
    workloadDeadlineAt: projection.workloadDeadlineAt,
  }),
  callDocument: Object.freeze({ request: executionRequest }),
});

function boundProjection(): V213V212TerminalOutputProjection {
  return Object.freeze({
    ...projection,
    executionRequestSha256: canonicalSha256(executionRequest),
  });
}

describe("V2-12 post-terminal Chrome integration", () => {
  it("reads the exact reconciler projection and polls without dispatch methods", async () => {
    const query = vi.fn(async () => ({ rows: [{ value: boundProjection() }] }));
    const transaction = vi.fn(
      async (work: (database: { query: typeof query }) => Promise<unknown>) => work({ query }),
    );
    const resolver = createV213V212ProductionTerminalOutputResolver({
      database: { transaction } as never,
      now: () => NOW,
      sleep: vi.fn(),
    });
    await expect(
      resolver({
        fullLiveAuthorityId: IDS.fullLiveAuthorityId,
        workflowId: projection.workflowId,
        deadlineAt: projection.workloadDeadlineAt,
      }),
    ).resolves.toMatchObject({
      schemaVersion: V213_V212_TERMINAL_OUTPUT_PROJECTION_SCHEMA,
      outputSha256,
      outputBytes: 1_024,
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("videoforge_load_v212_terminal_output_projection"),
      [IDS.fullLiveAuthorityId, "v2-12-long-output", projection.workflowId],
    );
    expect(transaction).toHaveBeenCalledOnce();
  });

  it("binds the materialized workflow request, output, receipt, scope, and origin", () => {
    const request = buildV213V212RealChromeRequestFromTerminalProjection({
      materialized,
      projection: boundProjection(),
      productionOrigin: ORIGIN,
      now: NOW,
    });
    expect(request).toMatchObject({
      fullLiveAuthorityId: IDS.fullLiveAuthorityId,
      workflowId: projection.workflowId,
      executionRequestSha256: canonicalSha256(executionRequest),
      outputSha256,
      outputBytes: 1_024,
      productionUrlSha256: hash(ORIGIN),
      deadlineAt: projection.workloadDeadlineAt,
    });
    expect(request.requestSha256).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it("launches Chrome only after terminal output and submits once before final readback", async () => {
    const events: string[] = [];
    let finishAcceptance: (() => void) | undefined;
    const acceptance = new Promise<{ readonly done: true }>((resolve) => {
      finishAcceptance = () => {
        events.push("acceptance-response");
        resolve({ done: true });
      };
    });
    const resolveTerminal = vi.fn(async () => {
      events.push("terminal-output-read");
      return boundProjection();
    });
    const produceChrome = vi.fn(async ({ request }: { readonly request: unknown }) => {
      events.push("chrome-launch-and-submit");
      expect(request).toMatchObject({ outputSha256, outputBytes: 1_024 });
      finishAcceptance?.();
      return { evidenceSha256: hash("v212-real-chrome") };
    });
    const result = await runV213V212LiveAcceptanceWithChrome({
      materialized,
      fullLiveAuthorityId: IDS.fullLiveAuthorityId,
      workflowId: projection.workflowId,
      workloadDeadlineAt: projection.workloadDeadlineAt,
      productionOrigin: ORIGIN,
      now: () => NOW,
      resolveTerminal,
      startLiveAcceptance: async () => {
        events.push("live-acceptance-start");
        return acceptance;
      },
      produceChrome,
    });
    expect(result.chrome).toEqual({ evidenceSha256: hash("v212-real-chrome") });
    expect(produceChrome).toHaveBeenCalledOnce();
    expect(events).toEqual([
      "live-acceptance-start",
      "terminal-output-read",
      "chrome-launch-and-submit",
      "acceptance-response",
    ]);
  });

  it("rejects stale, cross-authority, and materialization-drift projections", () => {
    expect(() =>
      validateV213V212TerminalOutputProjection(
        { ...boundProjection(), terminalAt: "2026-08-28T00:06:00.000Z" },
        {
          fullLiveAuthorityId: IDS.fullLiveAuthorityId,
          workflowId: projection.workflowId,
          deadlineAt: projection.workloadDeadlineAt,
        },
        NOW,
      ),
    ).toThrow("PROJECTION_BINDING_INVALID");
    expect(() =>
      validateV213V212TerminalOutputProjection(
        { ...boundProjection(), fullLiveAuthorityId: "77777777-7777-4777-8777-777777777777" },
        {
          fullLiveAuthorityId: IDS.fullLiveAuthorityId,
          workflowId: projection.workflowId,
          deadlineAt: projection.workloadDeadlineAt,
        },
        NOW,
      ),
    ).toThrow("PROJECTION_BINDING_INVALID");
    expect(() =>
      buildV213V212RealChromeRequestFromTerminalProjection({
        materialized: {
          ...materialized,
          executionDocument: {
            ...materialized.executionDocument,
            workflowId: "v213-v2-12-different-workflow",
          },
        },
        projection: boundProjection(),
        productionOrigin: ORIGIN,
        now: NOW,
      }),
    ).toThrow("MATERIALIZATION_BINDING_INVALID");
  });

  it("does not launch Chrome when the live acceptance request fails", async () => {
    const produceChrome = vi.fn();
    await expect(
      runV213V212LiveAcceptanceWithChrome({
        materialized,
        fullLiveAuthorityId: IDS.fullLiveAuthorityId,
        workflowId: projection.workflowId,
        workloadDeadlineAt: projection.workloadDeadlineAt,
        productionOrigin: ORIGIN,
        now: () => NOW,
        resolveTerminal: vi.fn(async () => {
          await Promise.resolve();
          return boundProjection();
        }),
        startLiveAcceptance: async () => {
          throw new Error("operator route failed");
        },
        produceChrome,
      }),
    ).rejects.toThrow("operator route failed");
    expect(produceChrome).not.toHaveBeenCalled();
  });
});

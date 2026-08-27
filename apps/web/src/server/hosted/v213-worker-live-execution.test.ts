import { canonicalSha256 } from "@videoforge/control-plane";
import { describe, expect, it, vi } from "vitest";

import {
  parseV213DatabaseWorkflowExecution,
  V213WorkflowLiveTransport,
  type V213DatabaseWorkflowExecution,
} from "./v213-worker-live-execution.js";

const request = {
  checkpoint: "V2-10",
  executionId: "execution-1",
  proposalSha256: canonicalSha256({ proposal: 1 }),
  authoritySha256: canonicalSha256({ authority: 1 }),
  approvalRecordSha256: canonicalSha256({ approval: 1 }),
  cumulativeLedgerSha256: canonicalSha256({ ledger: 1 }),
  executorSha256: canonicalSha256({ executor: 1 }),
  promotionDecisionSha256: canonicalSha256({ promotion: 1 }),
  sourceCommit: "1".repeat(40),
  scopes: [
    {
      accountId: "account-1",
      workspaceId: "workspace-1",
      projectId: "project-1",
      projectRevisionId: "revision-1",
      requestSha256: canonicalSha256({ scope: 1 }),
      attemptId: "attempt-1",
    },
  ],
  maximumVariableCostMicroUsd: 2_000_000,
  maximumCumulativeVariableCostMicroUsd: 17_500_000,
  billingBaselineMicroUsd: 0,
  cumulativeLedgerSpentBeforeMicroUsd: 0,
  retainedVolumeIdSha256s: {
    mage: canonicalSha256({ volume: "mage" }),
    soulx: canonicalSha256({ volume: "soulx" }),
  },
  noRedispatch: true,
} as const;

const execution: V213DatabaseWorkflowExecution = {
  schemaVersion: "videoforge.v213-database-acceptance-execution/v2",
  operationId: "v2-10-operator-free-ranga-pilot",
  checkpoint: "V2-10",
  workflowId: "v213-v2-10-execution-1",
  workflowParams: {
    schemaVersion: "videoforge.v213-acceptance-workflow-params/v1",
    kind: "V213_DATABASE_ACCEPTANCE",
    fullLiveAuthorityId: "11111111-1111-4111-8111-111111111111",
    operationId: "v2-10-operator-free-ranga-pilot",
    checkpoint: "V2-10",
    workflowId: "v213-v2-10-execution-1",
    requestSha256: canonicalSha256({ command: 1 }),
  },
  call: { request, admission: {} },
  pollIntervalMs: 250,
  workloadDeadlineAt: "2099-01-01T00:00:00.000Z",
};
const completed = {
  status: "complete",
  output: {
    rawEvidence: { verifiedOutput: true },
    receipt: { verifierId: "receipt" },
    cleanup: { verifierId: "cleanup" },
  },
};

function evidence() {
  return {
    finalizeVerifierDocument: vi.fn(
      async (kind: string, artifactSha256: string, document: Record<string, unknown>) => ({
        ...document,
        [kind === "RECEIPT" || kind === "CLEANUP"
          ? "canonicalArtifactSha256"
          : "canonicalEvidenceSha256"]: canonicalSha256({ artifactSha256 }),
        verifierSignatureSha256: canonicalSha256({ kind, artifactSha256, document }),
        ...(["V211_EVIDENCE", "RECEIPT", "CLEANUP"].includes(kind)
          ? { signatureVerified: true }
          : {}),
      }),
    ),
    signAndStore: vi.fn(async (_kind, _document, artifactSha256) => ({ artifactSha256 })),
  };
}

describe("V213 in-Worker Workflow live transport", () => {
  it("creates one deterministic Workflow and signs bounded result readback", async () => {
    const status = vi.fn(async () => completed);
    const get = vi.fn(async () => ({ status, sendEvent: vi.fn() }));
    const create = vi.fn(async () => ({ id: execution.workflowId }));
    const signer = evidence();
    const transport = new V213WorkflowLiveTransport({ create, get }, execution, signer as never);
    await expect(transport.execute(request)).resolves.toMatchObject({
      rawEvidence: { artifactSha256: expect.stringMatching(/^sha256:/u) },
      receiptArtifact: { artifactSha256: expect.stringMatching(/^sha256:/u) },
    });
    expect(create).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith({
      id: execution.workflowId,
      params: execution.workflowParams,
    });
    expect(signer.signAndStore).toHaveBeenCalledTimes(2);
    expect(signer.finalizeVerifierDocument).toHaveBeenNthCalledWith(
      1,
      "V210_OUTPUT",
      expect.stringMatching(/^sha256:/u),
      completed.output.rawEvidence,
    );
    expect(signer.signAndStore.mock.calls[1]?.[1]).toMatchObject({
      canonicalArtifactSha256: expect.stringMatching(/^sha256:/u),
      verifierSignatureSha256: expect.stringMatching(/^sha256:/u),
      signatureVerified: true,
    });
  });

  it("recovers an ambiguous create by get-only readback without redispatch", async () => {
    const create = vi.fn(async () => {
      throw new Error("ACK_UNKNOWN");
    });
    const get = vi.fn(async () => ({ status: async () => completed, sendEvent: vi.fn() }));
    const transport = new V213WorkflowLiveTransport(
      { create, get },
      execution,
      evidence() as never,
    );
    await expect(transport.execute(request)).resolves.toBeDefined();
    expect(create).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledOnce();
  });

  it("fails ACK_UNKNOWN closed and performs cancel-only stable cleanup", async () => {
    let cleanup = false;
    const status = vi.fn(async () => (cleanup ? completed : { status: "running" }));
    const sendEvent = vi.fn(async () => undefined);
    const workflow = {
      create: vi.fn(async () => ({ id: execution.workflowId })),
      get: vi.fn(async () => ({ status, sendEvent })),
    };
    let clock = 0;
    const bounded = { ...execution, workloadDeadlineAt: new Date(750).toISOString() };
    const control = { requestCleanup: vi.fn(async () => undefined) };
    const transport = new V213WorkflowLiveTransport(
      workflow,
      bounded,
      evidence() as never,
      false,
      () => clock,
      async (milliseconds) => {
        clock += milliseconds;
      },
      control,
    );
    await expect(transport.execute(request)).rejects.toThrow("V213_WORKFLOW_ACK_UNKNOWN");
    cleanup = true;
    clock = 0;
    await expect(transport.cancelAndReconcile(request)).resolves.toMatchObject({
      cleanupArtifact: { artifactSha256: expect.stringMatching(/^sha256:/u) },
    });
    expect(sendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "V213_CANCEL_AND_RECONCILE_ONLY", redispatchAllowed: false }),
    );
    expect(control.requestCleanup).toHaveBeenCalledWith(execution.workflowParams);
    expect(workflow.create).toHaveBeenCalledOnce();
  });

  it("strictly parses v2 and rejects operation, workflow parameter, or extra-key drift", () => {
    expect(
      parseV213DatabaseWorkflowExecution(execution as unknown as Readonly<Record<string, unknown>>),
    ).toEqual(execution);
    for (const drift of [
      { ...execution, checkpoint: "V2-11" },
      { ...execution, extra: true },
      { ...execution, workflowParams: { ...execution.workflowParams, workflowId: "wrong" } },
      { ...execution, call: { admission: {} } },
      {
        ...execution,
        call: { ...execution.call, request: { ...request, callerPlaceholder: true } },
      },
    ]) {
      expect(() => parseV213DatabaseWorkflowExecution(drift as never)).toThrow();
    }
  });

  it("does not hide a create response with the wrong Workflow identity", async () => {
    const workflow = {
      create: vi.fn(async () => ({ id: "wrong" })),
      get: vi.fn(async () => ({ status: async () => completed, sendEvent: vi.fn() })),
    };
    const transport = new V213WorkflowLiveTransport(workflow, execution, evidence() as never);
    await expect(transport.execute(request)).rejects.toThrow("V213_WORKFLOW_IDENTITY_DRIFT");
    expect(workflow.get).not.toHaveBeenCalled();
  });
});

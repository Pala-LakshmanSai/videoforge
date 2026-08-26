import { canonicalSha256 } from "@videoforge/control-plane";
import { describe, expect, it, vi } from "vitest";

import {
  V213WorkflowLiveTransport,
  type V213DatabaseWorkflowExecution,
} from "./v213-worker-live-execution.js";

const execution: V213DatabaseWorkflowExecution = {
  schemaVersion: "videoforge.v213-database-acceptance-execution/v1",
  checkpoint: "V2-10",
  workflowId: "v213-v2-10-execution-1",
  workflowParams: { databaseOwned: true },
  call: {},
  pollIntervalMs: 250,
  deadlineAt: "2099-01-01T00:00:00.000Z",
};
const request = {
  checkpoint: "V2-10",
  executionId: "execution-1",
  proposalSha256: canonicalSha256({ proposal: 1 }),
} as never;
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
      params: { databaseOwned: true },
    });
    expect(signer.signAndStore).toHaveBeenCalledTimes(2);
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
    const bounded = { ...execution, deadlineAt: new Date(750).toISOString() };
    const transport = new V213WorkflowLiveTransport(
      workflow,
      bounded,
      evidence() as never,
      false,
      () => clock,
      async (milliseconds) => { clock += milliseconds; },
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
    expect(workflow.create).toHaveBeenCalledOnce();
  });
});

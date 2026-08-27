import { canonicalSha256 } from "@videoforge/control-plane";
import { describe, expect, it, vi } from "vitest";

import {
  parseV213AcceptanceWorkflowPlan,
  parseV213AcceptanceWorkflowState,
  runV213DatabaseAcceptanceWorkflow,
  type V213AcceptanceCheckpoint,
  type V213AcceptanceOperation,
  type V213AcceptanceWorkflowParameters,
  type V213AcceptanceWorkflowPlan,
  type V213AcceptanceWorkflowRunnerPort,
} from "./v213-acceptance-workflow-runner.js";

const ids = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
  "55555555-5555-4555-8555-555555555555",
  "66666666-6666-4666-8666-666666666666",
  "77777777-7777-4777-8777-777777777777",
  "88888888-8888-4888-8888-888888888888",
  "99999999-9999-4999-8999-999999999999",
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  "ffffffff-ffff-4fff-8fff-ffffffffffff",
] as const;

function identity(offset: number) {
  return {
    accountId: ids[offset]!,
    workspaceId: ids[offset + 1]!,
    projectId: ids[offset + 2]!,
    projectRevisionId: ids[offset + 3]!,
    generationRequestId: ids[offset + 4]!,
  };
}

function parameters(
  checkpoint: V213AcceptanceCheckpoint,
  operationId: V213AcceptanceOperation,
): V213AcceptanceWorkflowParameters {
  const workflowId = `v213-${checkpoint.toLowerCase()}-execution`;
  return {
    schemaVersion: "videoforge.v213-acceptance-workflow-params/v1",
    kind: "V213_DATABASE_ACCEPTANCE",
    fullLiveAuthorityId: ids[0],
    operationId,
    checkpoint,
    workflowId,
    requestSha256: canonicalSha256({ workflowId }),
  };
}

function plan(params: V213AcceptanceWorkflowParameters, v211 = false): V213AcceptanceWorkflowPlan {
  const scope = (offset: number) => ({
    ...identity(offset),
    cancelAt: "2098-12-31T23:45:00.000Z",
    stopAt: "2098-12-31T23:55:00.000Z",
  });
  return {
    schemaVersion: "videoforge.v213-acceptance-workflow-plan/v1",
    fullLiveAuthorityId: params.fullLiveAuthorityId,
    operationId: params.operationId,
    checkpoint: params.checkpoint,
    workflowId: params.workflowId,
    requestSha256: params.requestSha256,
    workloadDeadlineAt: "2099-01-01T00:00:00.000Z",
    pollIntervalMs: 250,
    scopes: v211 ? [scope(0), scope(5)] : [scope(0)],
    sameAccountWaiter: v211
      ? { ...identity(0), generationRequestId: "10101010-1010-4010-8010-101010101010" }
      : null,
    fairnessProbe: v211 ? identity(10) : null,
    output: null,
  };
}

const output = Object.freeze({
  rawEvidence: Object.freeze({ providerReceiptSha256: canonicalSha256({ provider: 1 }) }),
  receipt: Object.freeze({ billingSettled: true }),
  cleanup: Object.freeze({ redispatchCount: 0 }),
});

function state(
  phase:
    | "PAIR_EXECUTION"
    | "V211_WAITING_PROBES"
    | "V211_FAIR_PROMOTION"
    | "V211_CANCEL_RECONCILIATION"
    | "V211_MAX1_RESTORE"
    | "TECHNICAL_CAPTURE"
    | "PAUSED_AWAITING_OPERATOR_EVIDENCE"
    | "ZERO_WORKER_READS"
    | "BILLING_SETTLEMENT"
    | "COMPLETE"
    | "CLEANUP_ONLY",
  zeroWorkerReadCount: 0 | 1 | 2 | 3,
) {
  return {
    schemaVersion: "videoforge.v213-acceptance-workflow-state/v1" as const,
    databaseNow: "2098-12-31T23:40:00.000Z",
    phase,
    cancelRequested: false,
    terminal: phase === "COMPLETE",
    zeroWorkerReadCount,
    output: phase === "COMPLETE" ? output : null,
  };
}

function durableStep() {
  return {
    names: [] as string[],
    sleeps: [] as number[],
    async do<T>(name: string, callback: () => Promise<T>) {
      this.names.push(name);
      return callback();
    },
    async sleep(_name: string, duration: number) {
      this.sleeps.push(duration);
    },
  };
}

describe("V213 database acceptance Workflow runner", () => {
  it("executes V2-11 two-scope pairs once, the distinct fairness scenario, and three spaced zeros", async () => {
    const params = parameters("V2-11", "v2-11-two-concurrent-owned-projects");
    const dbPlan = plan(params, true);
    const zeroStates = [
      state("ZERO_WORKER_READS", 1),
      state("ZERO_WORKER_READS", 2),
      state("BILLING_SETTLEMENT", 3),
    ];
    const scenarioStates = [
      state("V211_FAIR_PROMOTION", 0),
      state("V211_CANCEL_RECONCILIATION", 0),
      state("V211_MAX1_RESTORE", 0),
    ];
    const port: V213AcceptanceWorkflowRunnerPort = {
      claim: vi.fn(async () => dbPlan),
      resumePreparedPairs: vi.fn(async () => undefined),
      read: vi.fn(async () => state("V211_WAITING_PROBES", 0)),
      prepareV211Scenario: vi.fn(async () => state("V211_WAITING_PROBES", 0)),
      advanceV211Scenario: vi.fn(async () => scenarioStates.shift()),
      restoreV211MaxOne: vi.fn(async () => state("PAIR_EXECUTION", 0)),
      requestOperatorEvidence: vi.fn(async () => state("PAIR_EXECUTION", 0)),
      observePreparedPairs: vi.fn(async () => state("TECHNICAL_CAPTURE", 0)),
      captureTechnicalEvidence: vi.fn(async () => state("ZERO_WORKER_READS", 0)),
      captureZeroWorkerRead: vi.fn(async () => zeroStates.shift()),
      finalizeAcceptanceOutput: vi.fn(async () => state("COMPLETE", 3)),
    };
    const step = durableStep();
    await expect(runV213DatabaseAcceptanceWorkflow(params, step, port)).resolves.toEqual(output);
    expect(port.resumePreparedPairs).toHaveBeenCalledOnce();
    expect(port.prepareV211Scenario).toHaveBeenCalledOnce();
    expect(port.advanceV211Scenario).toHaveBeenCalledTimes(3);
    expect(port.restoreV211MaxOne).toHaveBeenCalledOnce();
    expect(port.observePreparedPairs).toHaveBeenCalledOnce();
    expect(port.captureTechnicalEvidence).toHaveBeenCalledOnce();
    expect(port.captureZeroWorkerRead).toHaveBeenNthCalledWith(1, dbPlan, 0);
    expect(port.captureZeroWorkerRead).toHaveBeenNthCalledWith(2, dbPlan, 1);
    expect(port.captureZeroWorkerRead).toHaveBeenNthCalledWith(3, dbPlan, 2);
    expect(port.requestOperatorEvidence).not.toHaveBeenCalled();
    expect(port.finalizeAcceptanceOutput).toHaveBeenCalledOnce();
    expect(step.sleeps.filter((duration) => duration === 1_000)).toHaveLength(2);
  });

  it("pauses V2-10, requests output-bound operator evidence once, then resumes readback only", async () => {
    const params = parameters("V2-10", "v2-10-operator-free-ranga-pilot");
    const dbPlan = plan(params);
    const reads = [state("PAUSED_AWAITING_OPERATOR_EVIDENCE", 0), state("COMPLETE", 3)];
    const port: V213AcceptanceWorkflowRunnerPort = {
      claim: vi.fn(async () => dbPlan),
      resumePreparedPairs: vi.fn(async () => undefined),
      read: vi.fn(async () => reads.shift()),
      prepareV211Scenario: vi.fn(),
      advanceV211Scenario: vi.fn(),
      restoreV211MaxOne: vi.fn(),
      requestOperatorEvidence: vi.fn(async () => state("PAUSED_AWAITING_OPERATOR_EVIDENCE", 0)),
      observePreparedPairs: vi.fn(),
      captureTechnicalEvidence: vi.fn(),
      captureZeroWorkerRead: vi.fn(),
      finalizeAcceptanceOutput: vi.fn(),
    };
    await expect(runV213DatabaseAcceptanceWorkflow(params, durableStep(), port)).resolves.toEqual(
      output,
    );
    expect(port.requestOperatorEvidence).toHaveBeenCalledOnce();
    expect(port.observePreparedPairs).not.toHaveBeenCalled();
    expect(port.resumePreparedPairs).toHaveBeenCalledOnce();
  });

  it.each([
    "prepare-max-two",
    "resume-pairs",
    "post-resume-read",
    "advance-scenario",
    "restore-max-one",
    "observe-pairs",
    "technical-capture",
    "zero-read",
    "finalize-output",
  ] as const)(
    "restores max-one and zero workers when the %s boundary fails",
    async (failureBoundary) => {
      const params = parameters("V2-11", "v2-11-two-concurrent-owned-projects");
      const dbPlan = plan(params, true);
      const failure = new Error(`failure-at-${failureBoundary}`);
      const failAt = (boundary: typeof failureBoundary) => {
        if (failureBoundary === boundary) throw failure;
      };
      const scenarioStates = [
        state("V211_FAIR_PROMOTION", 0),
        state("V211_CANCEL_RECONCILIATION", 0),
        state("V211_MAX1_RESTORE", 0),
      ];
      const zeroStates = [
        state("ZERO_WORKER_READS", 1),
        state("ZERO_WORKER_READS", 2),
        state("BILLING_SETTLEMENT", 3),
      ];
      let restoreAttempt = 0;
      const restoreV211MaxOne = vi.fn(async () => {
        restoreAttempt += 1;
        if (failureBoundary === "restore-max-one" && restoreAttempt === 1) throw failure;
        return state("PAIR_EXECUTION", 0);
      });
      const port: V213AcceptanceWorkflowRunnerPort = {
        claim: vi.fn(async () => dbPlan),
        prepareV211Scenario: vi.fn(async () => {
          failAt("prepare-max-two");
          return state("V211_WAITING_PROBES", 0);
        }),
        resumePreparedPairs: vi.fn(async () => {
          failAt("resume-pairs");
        }),
        read: vi.fn(async () => {
          failAt("post-resume-read");
          return state("V211_WAITING_PROBES", 0);
        }),
        advanceV211Scenario: vi.fn(async () => {
          failAt("advance-scenario");
          return scenarioStates.shift();
        }),
        restoreV211MaxOne,
        requestOperatorEvidence: vi.fn(),
        observePreparedPairs: vi.fn(async () => {
          failAt("observe-pairs");
          return state("TECHNICAL_CAPTURE", 0);
        }),
        captureTechnicalEvidence: vi.fn(async () => {
          failAt("technical-capture");
          return state("ZERO_WORKER_READS", 0);
        }),
        captureZeroWorkerRead: vi.fn(async () => {
          failAt("zero-read");
          return zeroStates.shift();
        }),
        finalizeAcceptanceOutput: vi.fn(async () => {
          failAt("finalize-output");
          return state("COMPLETE", 3);
        }),
      };
      await expect(runV213DatabaseAcceptanceWorkflow(params, durableStep(), port)).rejects.toThrow(
        failure.message,
      );
      expect(restoreV211MaxOne).toHaveBeenCalledTimes(
        failureBoundary === "restore-max-one" ? 2 : 1,
      );
    },
  );

  it("rejects extra keys, non-distinct V2-11 identities, and premature terminal output", () => {
    const params = parameters("V2-11", "v2-11-two-concurrent-owned-projects");
    const valid = plan(params, true);
    expect(() => parseV213AcceptanceWorkflowPlan({ ...valid, extra: true }, params)).toThrow();
    expect(() =>
      parseV213AcceptanceWorkflowPlan(
        {
          ...valid,
          fairnessProbe: { ...valid.fairnessProbe, accountId: valid.scopes[0]!.accountId },
        },
        params,
      ),
    ).toThrow("V213_ACCEPTANCE_WORKFLOW_SCOPE_INVALID");
    expect(() =>
      parseV213AcceptanceWorkflowState(
        { ...state("PAIR_EXECUTION", 0), terminal: true, output },
        valid,
      ),
    ).toThrow("V213_ACCEPTANCE_WORKFLOW_STATE_INVALID");
  });
});

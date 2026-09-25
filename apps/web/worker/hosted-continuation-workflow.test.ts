import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HostedContinuationWorkflowParameters } from "./hosted-continuation-workflow";

/**
 * The two collaborators the driver delegates to. Both are mocked because the real sweep resolves
 * hosted configuration and opens a Neon pool; this test is only about the driver's durable loop
 * shape.
 */
const collaborators = vi.hoisted(() => ({
  runHostedContinuation: vi.fn(
    async (_environment: unknown, _context: unknown): Promise<string[]> => ["project:context"],
  ),
  ensureHostedPairObservers: vi.fn(async (_environment: unknown, _context: unknown): Promise<number> => 1),
}));

vi.mock("../src/server/hosted/stage-continuation-sweep", () => ({
  runHostedContinuation: collaborators.runHostedContinuation,
  ensureHostedPairObservers: collaborators.ensureHostedPairObservers,
}));

// Imported after the mock declaration (vitest hoists `vi.mock` above all imports).
import {
  HOSTED_CONTINUATION_CADENCE,
  HOSTED_CONTINUATION_ITERATIONS,
  HostedContinuationWorkflow,
} from "./hosted-continuation-workflow";

interface RecordedStepCall {
  readonly kind: "do" | "sleep";
  readonly name: string;
  readonly duration: string | null;
}

interface FakeExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

/** Records every durable step the driver takes, and reports when each `step.do` resolved. */
function recordingStep(sequence: string[]) {
  const calls: RecordedStepCall[] = [];
  const step = {
    async do(name: string, callback: () => Promise<unknown>): Promise<unknown> {
      calls.push({ kind: "do", name, duration: null });
      const result = await callback();
      sequence.push("step-done");
      return result;
    },
    async sleep(name: string, duration: string): Promise<void> {
      calls.push({ kind: "sleep", name, duration });
    },
  };
  return { step, calls };
}

const environment = Object.freeze({ VIDEOFORGE_ENVIRONMENT: "production" });

function workflow(): HostedContinuationWorkflow {
  return new HostedContinuationWorkflow({} as never, environment as never);
}

function event(payload: unknown): WorkflowEvent<HostedContinuationWorkflowParameters> {
  return {
    payload,
    timestamp: new Date(0),
    instanceId: "hosted-continuation-driver",
    workflowName: "videoforge-continuation-workflow",
  } as WorkflowEvent<HostedContinuationWorkflowParameters>;
}

async function runWorkflow(payload: unknown, sequence: string[] = []) {
  const recorder = recordingStep(sequence);
  const summary = await workflow().run(
    event(payload),
    recorder.step as unknown as WorkflowStep,
  );
  return { summary, calls: recorder.calls, sequence };
}

beforeEach(() => {
  collaborators.runHostedContinuation.mockReset();
  collaborators.runHostedContinuation.mockImplementation(async () => ["project:context"]);
  collaborators.ensureHostedPairObservers.mockReset();
  collaborators.ensureHostedPairObservers.mockImplementation(async () => 1);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("hosted continuation Workflow loop", () => {
  it("runs a targeted handoff once in a durable step without a cadence loop", async () => {
    const target = {
      accountId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      projectId: "11111111-1111-4111-8111-111111111111",
      revisionId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      step: "prompts",
    };
    const { summary, calls } = await runWorkflow({ reason: "stage-handoff", target });

    expect(calls).toEqual([{ kind: "do", name: "handoff prompts", duration: null }]);
    expect(collaborators.runHostedContinuation).toHaveBeenCalledExactlyOnceWith(
      environment, expect.any(Object), target,
    );
    expect(collaborators.ensureHostedPairObservers).not.toHaveBeenCalled();
    expect(summary).toMatchObject({
      schema_version: "videoforge-hosted-continuation-handoff/v1",
      dispatched: ["project:context"],
    });
  });

  it("refuses an invalid targeted handoff without running the broad sweep", async () => {
    const { summary, calls } = await runWorkflow({ reason: "stage-handoff", target: { step: "prompts" } });
    expect(summary).toEqual({ state: "INVALID_TARGET" });
    expect(calls).toEqual([]);
    expect(collaborators.runHostedContinuation).not.toHaveBeenCalled();
  });

  it("runs a bounded number of iterations, each with a unique durable step name", async () => {
    const { summary, calls } = await runWorkflow({ reason: "personal-worker-claim" });

    const doNames = calls.filter((call) => call.kind === "do").map((call) => call.name);
    const sleepNames = calls.filter((call) => call.kind === "sleep").map((call) => call.name);

    expect(doNames).toHaveLength(HOSTED_CONTINUATION_ITERATIONS);
    expect(sleepNames).toHaveLength(HOSTED_CONTINUATION_ITERATIONS);
    // Workflow step ids are replay keys: a duplicated name would make every later iteration replay
    // the first iteration's recorded result instead of sweeping again.
    expect(new Set(doNames).size).toBe(HOSTED_CONTINUATION_ITERATIONS);
    expect(new Set(sleepNames).size).toBe(HOSTED_CONTINUATION_ITERATIONS);
    expect(doNames[0]).toBe("continuation 0");
    expect(doNames.at(-1)).toBe(`continuation ${HOSTED_CONTINUATION_ITERATIONS - 1}`);
    expect(collaborators.runHostedContinuation).toHaveBeenCalledTimes(
      HOSTED_CONTINUATION_ITERATIONS,
    );
    expect(summary).toMatchObject({
      schema_version: "videoforge-hosted-continuation-driver/v1",
      state: "BOUNDED_WINDOW_COMPLETE",
      iterations: HOSTED_CONTINUATION_ITERATIONS,
      dispatches: HOSTED_CONTINUATION_ITERATIONS,
      pair_observers: HOSTED_CONTINUATION_ITERATIONS,
      failures: 0,
      reason: "personal-worker-claim",
    });
  });

  it("sleeps 60 seconds between iterations, after each sweep", async () => {
    const { calls } = await runWorkflow({});

    expect(calls).toHaveLength(HOSTED_CONTINUATION_ITERATIONS * 2);
    for (let index = 0; index < calls.length; index += 2) {
      expect(calls[index]).toMatchObject({ kind: "do", name: `continuation ${index / 2}` });
      expect(calls[index + 1]).toMatchObject({
        kind: "sleep",
        name: `wait ${index / 2}`,
        duration: HOSTED_CONTINUATION_CADENCE,
      });
    }
    expect(HOSTED_CONTINUATION_CADENCE).toBe("60 seconds");
    // 1,440 one-minute iterations is ~24 hours: the bound the instance guard restarts past.
    expect(HOSTED_CONTINUATION_ITERATIONS * 60).toBe(86_400);
  });

  it("awaits deferred stage handoffs inside the durable step", async () => {
    const sequence: string[] = [];
    collaborators.runHostedContinuation.mockImplementationOnce(
      async (_environment: unknown, context: unknown) => {
        // Stage 3 hands stage 4 off through `waitUntil`; the driver must not end the step first.
        (context as FakeExecutionContext).waitUntil(
          new Promise<void>((resolve) =>
            setTimeout(() => {
              sequence.push("deferred");
              resolve();
            }, 0),
          ),
        );
        return ["project:context"];
      },
    );

    const { summary } = await runWorkflow({}, sequence);

    expect(sequence[0]).toBe("deferred");
    expect(sequence[1]).toBe("step-done");
    expect(summary).toMatchObject({ dispatches: HOSTED_CONTINUATION_ITERATIONS, failures: 0 });
  });

  it("keeps sweeping after a failing iteration instead of failing the driver", async () => {
    collaborators.runHostedContinuation.mockRejectedValueOnce(new Error("sweep exploded"));

    const { summary } = await runWorkflow({ reason: "personal-worker-claim" });

    expect(summary).toMatchObject({
      state: "BOUNDED_WINDOW_COMPLETE",
      iterations: HOSTED_CONTINUATION_ITERATIONS,
      dispatches: HOSTED_CONTINUATION_ITERATIONS - 1,
      failures: 1,
    });
    expect(collaborators.ensureHostedPairObservers).toHaveBeenCalledTimes(
      HOSTED_CONTINUATION_ITERATIONS - 1,
    );
    expect(console.warn).toHaveBeenCalledWith(
      "hosted_continuation_workflow",
      expect.objectContaining({ event: "ITERATION_FAILED", iteration: 0 }),
    );
  });

  it("tolerates a missing or malformed payload", async () => {
    for (const payload of [undefined, null, "reason", { reason: 42 }, { reason: "x".repeat(400) }]) {
      const { summary } = await runWorkflow(payload);
      expect(summary).toMatchObject({ reason: "unscheduled", failures: 0 });
    }
  });
});

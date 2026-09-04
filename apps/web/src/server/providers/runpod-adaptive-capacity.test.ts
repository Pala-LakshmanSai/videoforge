import { describe, expect, it } from "vitest";

import {
  assertV207MaxTwoWholeProjectPolicy,
  assertRunPodConcurrentVolumeQualificationGate,
  buildV207MaxTwoWholeProjectPolicy,
  buildV207WarmWorkerReusePolicy,
  planV207AdaptiveCapacity,
  planV207WarmWorkerTransition,
  type RunPodConcurrentVolumeQualificationGate,
} from "./runpod-adaptive-capacity";

const hash = (letter: string): string => `sha256:${letter.repeat(64)}`;

const gate = (
  lane: "mage_image" | "soulx_avatar" = "mage_image",
  workersMax: 2 | 4 | 6 | 10 = 2,
): RunPodConcurrentVolumeQualificationGate => ({
  schemaVersion: "videoforge.runpod-concurrent-volume-qualification/v1",
  lane,
  workersMin: 0,
  workersMax,
  gpuCount: 1,
  handlerConcurrency: 1,
  scalerType: "REQUEST_COUNT",
  scalerValue: 1,
  batchMode: "whole_project",
  concurrentReaderCount: workersMax,
  successfulReaderCount: workersMax,
  terminalWorkerCount: workersMax,
  volumeMutationDetected: false,
  volumeManifestBeforeSha256: hash("a"),
  volumeManifestAfterSha256: hash("a"),
  endpointConfigSha256: hash("b"),
  imageDigestSha256: hash("c"),
  evidenceSha256: hash("d"),
  measuredAt: "2026-09-04T00:00:00.000Z",
});

describe("RunPod adaptive capacity policy", () => {
  it("pins the max-two whole-project policy to scale-zero, one GPU, and serial handler work", () => {
    expect(buildV207MaxTwoWholeProjectPolicy()).toEqual({
      workersMin: 0,
      workersMax: 2,
      gpuCount: 1,
      handlerConcurrency: 1,
      scalerType: "REQUEST_COUNT",
      scalerValue: 1,
      idleTimeoutSeconds: 5,
      executionTimeoutMs: 2_400_000,
      batchMode: "whole_project",
      warmWorkerReuse: true,
      scaleToZeroWhenQueueEmpty: true,
    });
    expect(buildV207WarmWorkerReusePolicy()).toEqual({
      schemaVersion: "videoforge.runpod-warm-worker-reuse/v1",
      workersMin: 0,
      idleTimeoutSeconds: 5,
      reuseScope: "same_lane_consecutive_admitted_projects",
      requiresTerminalPreviousProject: true,
      requiresProviderQueueEmpty: true,
      scaleToZeroWhenNoAdmittedWork: true,
    });
  });

  it("allows max-two only with a measured unchanged-volume gate", () => {
    const planned = planV207AdaptiveCapacity({
      lane: "mage_image",
      requestedWorkersMax: 2,
      qualificationGates: [gate()],
    });
    expect(planned).toMatchObject({
      highestQualifiedWorkersMax: 2,
      nextQualificationWorkersMax: 4,
      activeWorkersMax: 2,
      activationAllowed: true,
      activationReason: "MAX_TWO_READY",
      requestedStageQualified: true,
    });
    expect(
      planV207AdaptiveCapacity({ lane: "mage_image", requestedWorkersMax: 2 }).activationAllowed,
    ).toBe(false);
  });

  it("keeps 4/6/10 as staged plans and never activates above max-two", () => {
    const allGates = [
      gate("mage_image", 2),
      gate("mage_image", 4),
      gate("mage_image", 6),
      gate("mage_image", 10),
    ];
    const planned = planV207AdaptiveCapacity({
      lane: "mage_image",
      requestedWorkersMax: 10,
      qualificationGates: allGates,
    });
    expect(planned).toMatchObject({
      highestQualifiedWorkersMax: 10,
      nextQualificationWorkersMax: null,
      activeWorkersMax: 2,
      activationAllowed: false,
      activationReason: "FUTURE_STAGE_REQUIRES_EXPLICIT_ENABLEMENT",
      requestedStageQualified: true,
    });
    expect(planned.policy.workersMax).toBe(2);
  });

  it("requires gates in order and identifies the next measured reader stage", () => {
    const planned = planV207AdaptiveCapacity({
      lane: "soulx_avatar",
      requestedWorkersMax: 10,
      qualificationGates: [gate("soulx_avatar", 2), gate("soulx_avatar", 6)],
    });
    expect(planned).toMatchObject({
      highestQualifiedWorkersMax: 2,
      nextQualificationWorkersMax: 4,
      activeWorkersMax: 2,
      activationAllowed: false,
      activationReason: "FUTURE_STAGE_QUALIFICATION_REQUIRED",
      requestedStageQualified: false,
    });
  });

  it("rejects duplicate, cross-lane, drifted, and incomplete qualification gates", () => {
    expect(() =>
      planV207AdaptiveCapacity({
        lane: "mage_image",
        requestedWorkersMax: 4,
        qualificationGates: [gate(), gate()],
      }),
    ).toThrow("RUNPOD_ADAPTIVE_DUPLICATE_QUALIFICATION_GATE");
    expect(() =>
      planV207AdaptiveCapacity({
        lane: "mage_image",
        requestedWorkersMax: 2,
        qualificationGates: [gate("soulx_avatar")],
      }),
    ).toThrow("RUNPOD_ADAPTIVE_LANE_MISMATCH");
    expect(() =>
      assertRunPodConcurrentVolumeQualificationGate({
        ...gate(),
        volumeManifestAfterSha256: hash("e"),
      }),
    ).toThrow("RUNPOD_ADAPTIVE_VOLUME_MUTATION_DETECTED");
    expect(() =>
      assertRunPodConcurrentVolumeQualificationGate({
        ...gate(),
        successfulReaderCount: 1,
      }),
    ).toThrow("RUNPOD_ADAPTIVE_QUALIFICATION_GATE_INVALID");
  });

  it("allows a ready worker to serve the next admitted project and scales down when idle", () => {
    expect(
      planV207WarmWorkerTransition({
        previousProjectTerminal: true,
        nextProjectAdmitted: true,
        health: {
          idleWorkers: 1,
          readyWorkers: 0,
          runningWorkers: 0,
          initializingWorkers: 0,
          throttledWorkers: 0,
          unhealthyWorkers: 0,
          queuedJobs: 0,
        },
      }),
    ).toEqual({ action: "REUSE_WARM_WORKER", idleTimeoutSeconds: 5 });
    expect(
      planV207WarmWorkerTransition({
        previousProjectTerminal: true,
        nextProjectAdmitted: false,
        health: {
          idleWorkers: 1,
          readyWorkers: 0,
          runningWorkers: 0,
          initializingWorkers: 0,
          throttledWorkers: 0,
          unhealthyWorkers: 0,
          queuedJobs: 0,
        },
      }),
    ).toEqual({ action: "WAIT_FOR_SCALE_TO_ZERO", idleTimeoutSeconds: 5 });
  });

  it.each([
    [
      "non-terminal previous project",
      { previousProjectTerminal: false, nextProjectAdmitted: true },
    ],
    ["busy worker", { previousProjectTerminal: true, nextProjectAdmitted: true }],
    ["provider queue", { previousProjectTerminal: true, nextProjectAdmitted: true }],
  ] as const)("fails closed for %s", (_label, flags) => {
    const health = {
      idleWorkers: 1,
      readyWorkers: 0,
      runningWorkers: 0,
      initializingWorkers: 0,
      throttledWorkers: 0,
      unhealthyWorkers: 0,
      queuedJobs: 0,
    };
    if (_label === "busy worker") {
      health.idleWorkers = 0;
      health.runningWorkers = 1;
    }
    if (_label === "provider queue") health.queuedJobs = 1;
    expect(() => planV207WarmWorkerTransition({ ...flags, health })).toThrow(
      "RUNPOD_WARM_REUSE_NOT_CONFIRMED",
    );
  });

  it("keeps the current provider mutator boundary at the exact max-two policy", () => {
    expect(() =>
      assertV207MaxTwoWholeProjectPolicy({
        workersMin: 0,
        workersMax: 2,
        gpuCount: 1,
        idleTimeout: 5,
        executionTimeoutMs: 2_400_000,
      }),
    ).not.toThrow();
    expect(() =>
      assertV207MaxTwoWholeProjectPolicy({
        workersMin: 0,
        workersMax: 4,
        gpuCount: 1,
        idleTimeout: 5,
        executionTimeoutMs: 2_400_000,
      } as never),
    ).toThrow("RUNPOD_ADAPTIVE_MAX_TWO_POLICY_INVALID");
  });
});

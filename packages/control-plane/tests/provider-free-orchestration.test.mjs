import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  ProviderFreeMvpOrchestrator,
  ProviderFreeOrchestrationError,
} from "../dist/src/global-session/provider-free-orchestration.js";

const PAIR = Object.freeze({
  mage: Object.freeze({ receiptId: "fixture-mage-receipt", gpuSku: "NVIDIA RTX 4090" }),
  echo: Object.freeze({ receiptId: "fixture-echo-receipt", gpuSku: "NVIDIA L40S" }),
});
const FOUNDATIONS = Object.freeze({
  transcriptSha256: `sha256:${"a".repeat(64)}`,
  timelineSha256: `sha256:${"b".repeat(64)}`,
  generationWorkManifestSha256: `sha256:${"c".repeat(64)}`,
  renderWorkManifestSha256: `sha256:${"d".repeat(64)}`,
  promptManifestSha256: `sha256:${"e".repeat(64)}`,
});

function digest(label) {
  return `sha256:${createHash("sha256").update(label).digest("hex")}`;
}

function materialized(orchestrator) {
  const state = orchestrator.snapshot();
  const projectId = state.session?.activeProjectId;
  if (!projectId) return undefined;
  const project = state.projects.find((candidate) => candidate.projectId === projectId);
  if (project?.stage === "GENERATING" && project.barriers.mageOutputSha256 === null)
    return {
      mageOutput: {
        projectId,
        lane: "mage_image",
        manifestSha256: digest(`${projectId}:mage`),
        artifactCount: 6,
        durable: true,
      },
    };
  if (project?.stage === "GENERATING" && project.barriers.echoOutputSha256 === null)
    return {
      echoOutput: {
        projectId,
        lane: "echo_avatar",
        manifestSha256: digest(`${projectId}:echo`),
        artifactCount: 2,
        durable: true,
      },
    };
  if (project?.stage === "RENDERING")
    return {
      render: {
        projectId,
        renderManifestSha256: digest(`${projectId}:render-manifest`),
        artifactId: `fixture-final-${projectId}`,
        finalMp4Sha256: digest(`${projectId}:final-mp4`),
        byteSize: 12_345,
        durationMs: 40_000,
        totalFrames: 1_200,
        width: 1920,
        height: 1080,
        audioCodec: "aac",
        videoCodec: "h264",
        durable: true,
        renderer: "DIRECT_FFMPEG",
      },
    };
  return undefined;
}

function freshRevalidation(overrides = {}) {
  const observedAt = new Date(Date.now() - 100).toISOString();
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  return {
    mage: {
      validationId: "fixture-validation-mage",
      lockedReceiptId: PAIR.mage.receiptId,
      gpuSku: PAIR.mage.gpuSku,
      observedAt,
      expiresAt,
      providerCallsAuthorized: false,
      ...overrides.mage,
    },
    echo: {
      validationId: "fixture-validation-echo",
      lockedReceiptId: PAIR.echo.receiptId,
      gpuSku: PAIR.echo.gpuSku,
      observedAt,
      expiresAt,
      providerCallsAuthorized: false,
      ...overrides.echo,
    },
  };
}

function start(orchestrator, projectId = "project-1") {
  orchestrator.startSession({
    queueEntryId: `queue-${projectId}`,
    projectId,
    title: projectId,
    gpuPair: PAIR,
  });
}

async function advanceUntil(orchestrator, waiting, predicate, maximum = 80) {
  for (let index = 0; index < maximum; index += 1) {
    const result = await orchestrator.advance(
      waiting(),
      FOUNDATIONS,
      freshRevalidation(),
      materialized(orchestrator),
    );
    if (predicate(result, orchestrator.snapshot())) return result;
  }
  assert.fail("Provider-free orchestration did not converge within bounded advances.");
}

test("three processed projects stay serial, durable, cost-conserving, and drain independently", async () => {
  const orchestrator = new ProviderFreeMvpOrchestrator();
  start(orchestrator);
  orchestrator.addWaiting("queue-project-2", "project-2", "project-2");
  orchestrator.addWaiting("queue-project-removed", "project-removed", "project-removed");
  orchestrator.addWaiting("queue-project-3", "project-3", "project-3");
  orchestrator.removeWaiting("project-removed");

  const restored = new ProviderFreeMvpOrchestrator(orchestrator.snapshot());
  restored.recover();
  assert.equal(restored.snapshot().session?.recoveryCount, 1);
  for (const waiting of restored
    .snapshot()
    .projects.filter((project) => project.stage === "WAITING")) {
    assert.equal(waiting.activatedAt, null);
    assert.equal(waiting.workStartedAt, null);
    assert.ok(Object.values(waiting.barriers).every((value) => value === null));
    assert.equal(waiting.cost.reportedMicroUsd, 0);
  }

  const initial = restored.snapshot().session;
  assert.ok(initial);
  const mageAttempt = initial.lanes.mage_image.attempts.at(-1);
  assert.ok(mageAttempt);
  const exactCallback = {
    sessionId: initial.sessionId,
    projectId: "project-1",
    lane: "mage_image",
    podId: mageAttempt.podId,
    gpuSku: initial.lanes.mage_image.selectedGpuSku,
    volumeId: initial.lanes.mage_image.volumeId,
    sequence: 1,
  };
  for (const callback of [
    { ...exactCallback, sessionId: "stale-session" },
    { ...exactCallback, podId: "wrong-pod" },
    { ...exactCallback, gpuSku: "wrong-gpu" },
    { ...exactCallback, volumeId: initial.lanes.echo_avatar.volumeId },
  ]) {
    assert.throws(
      () => restored.acceptLaneCallback(callback),
      (error) => error instanceof ProviderFreeOrchestrationError,
    );
  }
  restored.acceptLaneCallback(exactCallback);
  assert.throws(
    () => restored.acceptLaneCallback(exactCallback),
    (error) => error instanceof ProviderFreeOrchestrationError && error.code === "STALE_CALLBACK",
  );

  const waiting = ["project-2", "project-3"];
  await advanceUntil(
    restored,
    () => waiting,
    (result) => {
      if (result.promotedProjectId === "project-2") waiting.shift();
      return result.promotedProjectId === "project-2";
    },
  );
  assert.equal(restored.project("project-1").stage, "READY_FOR_REVIEW");
  assert.equal(restored.project("project-2").stage, "PREPARING");

  await advanceUntil(
    restored,
    () => waiting,
    (result) => {
      if (result.promotedProjectId === "project-3") waiting.shift();
      return result.promotedProjectId === "project-3";
    },
  );
  assert.equal(restored.project("project-2").stage, "READY_FOR_REVIEW");

  await advanceUntil(
    restored,
    () => waiting,
    (result) => result.sessionClosed,
  );
  const snapshot = restored.snapshot();
  assert.equal(snapshot.session, null);
  assert.equal(snapshot.lastClosedSession?.state, "CLOSED");
  for (const lane of Object.values(snapshot.lastClosedSession?.lanes ?? {})) {
    assert.equal(lane.attempts.at(-1)?.phase, "ABSENCE_VERIFIED");
    assert.ok(lane.attempts.at(-1)?.absenceReceiptSha256?.startsWith("sha256:"));
  }
  for (const projectId of ["project-1", "project-2", "project-3"]) {
    const project = restored.project(projectId);
    assert.equal(project.stage, "READY_FOR_REVIEW");
    assert.ok(Object.values(project.barriers).every((value) => value?.startsWith("sha256:")));
    assert.equal(project.cost.reservedMicroUsd, 880_000);
    assert.equal(project.cost.reportedMicroUsd, 880_000);
    assert.equal(project.cost.settledMicroUsd, 880_000);
    assert.equal(project.cost.actualExternalSpendUsd, 0);
    assert.deepEqual(
      {
        contentType: project.finalAsset?.contentType,
        width: project.finalAsset?.width,
        height: project.finalAsset?.height,
        videoCodec: project.finalAsset?.videoCodec,
        audioCodec: project.finalAsset?.audioCodec,
      },
      {
        contentType: "video/mp4",
        width: 1920,
        height: 1080,
        videoCodec: "h264",
        audioCodec: "aac",
      },
    );
  }
});

test("late waiter cannot recreate an absent lane until atomic project promotion", async () => {
  const orchestrator = new ProviderFreeMvpOrchestrator();
  start(orchestrator, "project-active");

  await advanceUntil(
    orchestrator,
    () => [],
    (_result, state) =>
      state.session?.lanes.mage_image.attempts.at(-1)?.phase === "ABSENCE_VERIFIED",
  );
  const beforeWaiter = orchestrator.snapshot().session;
  assert.equal(beforeWaiter?.lanes.mage_image.attempts.length, 1);
  orchestrator.addWaiting("queue-project-late", "project-late", "project-late");
  assert.equal(orchestrator.snapshot().session?.lanes.mage_image.attempts.length, 1);
  assert.equal(orchestrator.project("project-late").workStartedAt, null);

  await advanceUntil(
    orchestrator,
    () => ["project-late"],
    (_result, state) =>
      state.projects.find((project) => project.projectId === "project-active")?.stage ===
      "RENDERING",
  );
  const beforeRejectedPromotion = orchestrator.snapshot();
  await assert.rejects(
    () => orchestrator.advance(["project-late"], FOUNDATIONS),
    (error) =>
      error instanceof ProviderFreeOrchestrationError && error.code === "GPU_REVALIDATION_REQUIRED",
  );
  assert.deepEqual(orchestrator.snapshot(), beforeRejectedPromotion);
  await assert.rejects(
    () =>
      orchestrator.advance(
        ["project-late"],
        FOUNDATIONS,
        freshRevalidation({ mage: { gpuSku: "wrong-gpu" } }),
      ),
    (error) =>
      error instanceof ProviderFreeOrchestrationError && error.code === "GPU_REVALIDATION_REQUIRED",
  );
  assert.deepEqual(orchestrator.snapshot(), beforeRejectedPromotion);

  const result = await orchestrator.advance(
    ["project-late"],
    FOUNDATIONS,
    freshRevalidation(),
    materialized(orchestrator),
  );
  assert.equal(result.promotedProjectId, "project-late");
  const promoted = orchestrator.snapshot().session;
  assert.equal(promoted?.activeProjectId, "project-late");
  assert.equal(promoted?.lanes.mage_image.attempts.length, 2);
  assert.equal(promoted?.lanes.mage_image.attempts.at(-1)?.phase, "CREATING");
  assert.equal(promoted?.lanes.mage_image.attempts.at(-1)?.originProjectId, "project-late");
  assert.equal(
    promoted?.lanes.mage_image.attempts.at(-1)?.gpuValidationId,
    "fixture-validation-mage",
  );
  assert.ok(
    orchestrator
      .snapshot()
      .events.some(
        (event) => event.kind === "GPU_REVALIDATED_FOR_RECREATE" && event.lane === "mage_image",
      ),
  );
});

test("cancellation settles current synthetic cost and promotes no waiting work early", async () => {
  const orchestrator = new ProviderFreeMvpOrchestrator();
  start(orchestrator, "project-cancelled");
  orchestrator.addWaiting("queue-project-next", "project-next", "project-next");
  await advanceUntil(
    orchestrator,
    () => ["project-next"],
    (_result, state) =>
      state.projects.find((project) => project.projectId === "project-cancelled")?.stage ===
      "GENERATING",
  );
  assert.equal(orchestrator.project("project-next").workStartedAt, null);
  const result = orchestrator.cancelActive(["project-next"]);
  assert.equal(result.promotedProjectId, "project-next");
  const cancelled = orchestrator.project("project-cancelled");
  assert.equal(cancelled.stage, "CANCELLED");
  assert.equal(cancelled.cost.settledMicroUsd, cancelled.cost.reportedMicroUsd);
  assert.equal(cancelled.cost.actualExternalSpendUsd, 0);
  assert.equal(orchestrator.project("project-next").stage, "PREPARING");
  assert.equal(orchestrator.project("project-next").workStartedAt, null);
});

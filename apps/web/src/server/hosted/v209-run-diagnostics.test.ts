import { describe, expect, it, vi } from "vitest";

import {
  diagnoseV209Run,
  type V209RunDiagnosticSnapshot,
  type V209RunDiagnosticsSource,
} from "./v209-run-diagnostics";

const sha = (character: string) => `sha256:${character.repeat(64)}`;
const scope = { accountId: "account-a", workspaceId: "workspace-a" } as const;

function snapshot(): V209RunDiagnosticSnapshot {
  return {
    accountId: scope.accountId,
    workspaceId: scope.workspaceId,
    generationRequest: {
      id: "generation-a",
      projectId: "project-a",
      projectRevisionId: "revision-a",
      state: "ACTIVE",
      createdAt: "2026-09-06T10:00:00.000Z",
      terminalAt: null,
    },
    providerLease: {
      id: "provider-lease-a",
      state: "ACTIVE",
      slot: 1,
      expiresAt: "2026-09-06T10:30:00.000Z",
      releasedAt: null,
    },
    lanes: [
      {
        lane: "mage_image",
        attemptId: "mage-attempt-a",
        attemptState: "SUCCEEDED",
        outboxState: "ASSIGNED",
        sendAttemptCount: 1,
        providerJobId: "mage-job-a",
        providerStatus: "COMPLETED",
        providerStatusObservedAt: "2026-09-06T10:05:00.000Z",
        outputReceiptSha256: sha("a"),
        outputBarrierSha256: sha("b"),
      },
      {
        lane: "soulx_avatar",
        attemptId: "soulx-attempt-a",
        attemptState: "IN_PROGRESS",
        outboxState: "ASSIGNED",
        sendAttemptCount: 1,
        providerJobId: "soulx-job-a",
        providerStatus: "IN_PROGRESS",
        providerStatusObservedAt: "2026-09-06T10:06:00.000Z",
        outputReceiptSha256: null,
        outputBarrierSha256: null,
      },
    ],
    renderAttempt: null,
    workerLease: null,
    workerEvents: [],
    finalOutput: null,
  };
}

function source(value: V209RunDiagnosticSnapshot | null): V209RunDiagnosticsSource {
  return { loadReadOnly: vi.fn(async () => value) };
}

describe("V2-09 run diagnostics", () => {
  it("passes tenant scope and supports project or generation-request correlation", async () => {
    const reader = source(snapshot());
    const result = await diagnoseV209Run({
      scope,
      key: { projectId: "project-a" },
      source: reader,
    });
    expect(reader.loadReadOnly).toHaveBeenCalledWith({ scope, key: { projectId: "project-a" } });
    expect(result).toMatchObject({ stage: "SOULX_AVATAR", noRedispatch: true });

    await expect(
      diagnoseV209Run({
        scope,
        key: { generationRequestId: "generation-a" },
        source: source({ ...snapshot(), accountId: "account-b" }),
      }),
    ).rejects.toMatchObject({ code: "V209_DIAGNOSTIC_TENANT_MISMATCH" });
  });

  it("makes a second dispatch visible without exposing dispatch authority", async () => {
    const value = snapshot();
    const result = await diagnoseV209Run({
      scope,
      key: { generationRequestId: "generation-a" },
      source: source({
        ...value,
        lanes: value.lanes.map((lane) =>
          lane.lane === "soulx_avatar" ? { ...lane, sendAttemptCount: 2 } : lane,
        ),
      }),
    });
    expect(result.noRedispatch).toBe(false);
    expect(result.lanes.find((lane) => lane.lane === "soulx_avatar")?.sendAttemptCount).toBe(2);
  });

  it("localizes provider, output-barrier, personal-worker, and render failures", async () => {
    const base = snapshot();
    const diagnose = (value: V209RunDiagnosticSnapshot) =>
      diagnoseV209Run({ scope, key: { projectId: "project-a" }, source: source(value) });
    await expect(
      diagnose({
        ...base,
        lanes: base.lanes.map((lane) =>
          lane.lane === "mage_image" ? { ...lane, attemptState: "PERMANENT_FAILED" } : lane,
        ),
      }),
    ).resolves.toMatchObject({ stage: "MAGE_IMAGE" });
    await expect(
      diagnose({
        ...base,
        lanes: [base.lanes[0]!, { ...base.lanes[1]!, providerStatus: "COMPLETED" }],
      }),
    ).resolves.toMatchObject({ stage: "OUTPUT_BARRIER" });
    const lanesComplete = base.lanes.map((lane) => ({
      ...lane,
      attemptState: "SUCCEEDED",
      providerStatus: "COMPLETED",
      outputReceiptSha256: sha("c"),
      outputBarrierSha256: sha("d"),
    }));
    await expect(
      diagnose({
        ...base,
        lanes: lanesComplete,
        workerLease: {
          id: "worker-lease-a",
          deviceId: "device-a",
          state: "FAILED",
          failureCode: "RENDER_PROBE_FAILED",
        },
      }),
    ).resolves.toMatchObject({ stage: "PERSONAL_MEDIA_WORKER" });
    await expect(
      diagnose({
        ...base,
        lanes: lanesComplete,
        renderAttempt: { id: "render-a", state: "FAILED", resultReceiptSha256: null },
      }),
    ).resolves.toMatchObject({ stage: "RENDER" });
  });

  it("uses an output allowlist so secrets, URLs, customer text, and raw errors cannot escape", async () => {
    const unsafe = {
      ...snapshot(),
      dispatchToken: "secret-dispatch-token",
      signedUrl: "https://private.example.test/secret",
      narration: "raw customer narration",
      error: "provider dumped a secret",
      lanes: snapshot().lanes.map((lane) => ({
        ...lane,
        authorization: "Bearer secret",
        requestBody: { prompt: "raw customer prompt" },
      })),
    } as V209RunDiagnosticSnapshot;
    const result = await diagnoseV209Run({
      scope,
      key: { projectId: "project-a" },
      source: source(unsafe),
    });
    const serialized = JSON.stringify(result);
    for (const forbidden of ["secret", "https://", "narration", "prompt", "authorization", "error"])
      expect(serialized).not.toContain(forbidden);
    expect(result.lanes[0]).toEqual({
      lane: "mage_image",
      attemptId: "mage-attempt-a",
      attemptState: "SUCCEEDED",
      outboxState: "ASSIGNED",
      sendAttemptCount: 1,
      providerJobId: "mage-job-a",
      providerStatus: "COMPLETED",
      providerStatusObservedAt: "2026-09-06T10:05:00.000Z",
      outputReceiptSha256: sha("a"),
      outputBarrierSha256: sha("b"),
    });
  });
});

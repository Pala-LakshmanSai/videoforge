import { describe, expect, it, vi } from "vitest";

import { sha256 } from "./crypto";
import { canonicalJson } from "./submission";
import {
  createHostedV209SpanAudioCoordinator,
  type HostedV209SpanIdentity,
} from "./hosted-v209-span-audio";
import type { HostedSpanAudioSubmission } from "./submission";

const ids = {
  accountId: "11111111-1111-1111-1111-111111111111",
  workspaceId: "22222222-2222-2222-2222-222222222222",
  userId: "33333333-3333-3333-3333-333333333333",
  projectId: "44444444-4444-4444-8444-444444444444",
  revisionId: "55555555-5555-4555-8555-555555555555",
  attemptId: "66666666-6666-6666-6666-666666666666",
  spanId: "77777777-7777-7777-7777-777777777777",
  taskId: "88888888-8888-8888-8888-888888888888",
  timelineId: "99999999-9999-9999-9999-999999999999",
  transcriptId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  assetId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  receiptId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  generationId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
};
const digest = "a".repeat(64);
const uri = `vf-local://objects/sha256/aa/${digest}.wav`;

async function projection() {
  const inputDocument = {
    schema_version: "selected-span-audio-job/v1",
    project_revision_id: ids.revisionId,
    attempt_id: ids.attemptId,
    timeline_plan_id: ids.timelineId,
    transcript_id: ids.transcriptId,
    span_id: ids.spanId,
    timeline_segment_id: ids.taskId,
    task_key: ids.taskId,
    source_voiceover: {
      asset_id: ids.assetId,
      sha256: `sha256:${digest}`,
      artifact_uri: uri,
      duration_ms: 30_000,
    },
    selection: {
      selected_start_ms: 1_000,
      selected_end_ms_exclusive: 2_000,
      padded_start_ms: 960,
      padded_end_ms_exclusive: 2_040,
      trim_start_ms: 40,
      trim_end_ms_exclusive: 1_040,
    },
    output: {
      asset_id: ids.assetId,
      result_uri: `vf-local-run://${ids.revisionId}/${ids.attemptId}/span-audio-result.json`,
    },
    cancel_token: ids.attemptId,
    output_profile: "SOULX_PCM16_48K_MONO",
  };
  const objects = [{ artifact_receipt_id: ids.receiptId, uri }];
  const submissionDocument = {
    schema_version: "videoforge-hosted-cpu-submission/v1",
    idempotency_key: `span-audio:${ids.spanId}`,
    project_id: ids.projectId,
    project_revision_id: ids.revisionId,
    kind: "SPAN_AUDIO",
    input_document: inputDocument,
    objects,
  };
  return {
    schemaVersion: "videoforge.hosted-v209-span-audio-jobs/v1",
    accountId: ids.accountId,
    workspaceId: ids.workspaceId,
    projectId: ids.projectId,
    projectRevisionId: ids.revisionId,
    jobs: [
      {
        spanId: ids.spanId,
        taskId: ids.taskId,
        taskKey: ids.taskId,
        attemptId: ids.attemptId,
        idempotencyKey: submissionDocument.idempotency_key,
        inputDocument,
        submissionDocument,
        submissionSha256: await sha256(canonicalJson(submissionDocument)),
        objects,
        state: "PLANNED",
      },
    ],
  };
}

describe("hosted V2-09 span audio coordinator", () => {
  it("schedules only the exact DB-owned 48 kHz submission", async () => {
    const value = await projection();
    const schedule = vi.fn(
      async (
        _identity: HostedV209SpanIdentity,
        _submission: HostedSpanAudioSubmission,
        _expectedAttemptId: string,
      ) => ({ state: "OUTBOXED" }),
    );
    const coordinator = createHostedV209SpanAudioCoordinator({
      loadJobs: vi.fn(async () => value),
      schedule,
      finalize: vi.fn(),
      resumePair: vi.fn(),
    });
    const result = await coordinator.prepare(ids);
    expect(result).toEqual({
      state: "PREPARING_INPUTS",
      projectRevisionId: ids.revisionId,
      attemptIds: [ids.attemptId],
    });
    expect(schedule).toHaveBeenCalledOnce();
    expect(schedule.mock.calls[0]![1]).toMatchObject({
      kind: "SPAN_AUDIO",
      idempotencyKey: `span-audio:${ids.spanId}`,
    });
    expect(schedule.mock.calls[0]![2]).toBe(ids.attemptId);
  });

  it("rejects DB projection hash drift before scheduling", async () => {
    const value = await projection();
    value.jobs[0]!.submissionSha256 = `sha256:${"f".repeat(64)}`;
    const schedule = vi.fn();
    const coordinator = createHostedV209SpanAudioCoordinator({
      loadJobs: vi.fn(async () => value),
      schedule,
      finalize: vi.fn(),
      resumePair: vi.fn(),
    });
    await expect(coordinator.prepare(ids)).rejects.toMatchObject({
      code: "HOSTED_V209_SPAN_SUBMISSION_HASH_MISMATCH",
    });
    expect(schedule).not.toHaveBeenCalled();
  });

  it("resumes the deterministic ordinary pair only when every span is ready", async () => {
    const resumePair = vi.fn(async () => undefined);
    const finalization = {
      schemaVersion: "videoforge.hosted-v209-span-audio-finalization/v1",
      replayed: false,
      pairReady: true,
      accountId: ids.accountId,
      workspaceId: ids.workspaceId,
      userId: ids.userId,
      projectId: ids.projectId,
      projectRevisionId: ids.revisionId,
      generationRequestId: ids.generationId,
      attemptId: ids.attemptId,
      spanId: ids.spanId,
      assetId: ids.assetId,
      artifactReceiptId: ids.receiptId,
      objectKey: `tenant/${ids.accountId}/workspace/${ids.workspaceId}/project/${ids.projectId}/revision/${ids.revisionId}/lane/input/job/${ids.attemptId}/artifact/span-audio`,
      checksumSha256: `sha256:${digest}`,
    };
    const coordinator = createHostedV209SpanAudioCoordinator({
      loadJobs: vi.fn(),
      schedule: vi.fn(),
      finalize: vi.fn(async () => finalization),
      resumePair,
    });
    await coordinator.acceptCompleted({
      accountId: ids.accountId,
      workspaceId: ids.workspaceId,
      attemptId: ids.attemptId,
      resultDocument: { schema_version: "selected-span-audio-result/v1" },
    });
    expect(resumePair).toHaveBeenCalledWith({
      accountId: ids.accountId,
      workspaceId: ids.workspaceId,
      userId: ids.userId,
      projectId: ids.projectId,
    });
  });

  it("re-enters server-owned preparation when another span remains", async () => {
    const value = await projection();
    const loadJobs = vi.fn().mockResolvedValueOnce(value).mockResolvedValueOnce(value);
    const schedule = vi.fn(async () => ({ state: "OUTBOXED" }));
    const finalization = {
      schemaVersion: "videoforge.hosted-v209-span-audio-finalization/v1",
      replayed: false,
      pairReady: false,
      accountId: ids.accountId,
      workspaceId: ids.workspaceId,
      userId: ids.userId,
      projectId: ids.projectId,
      projectRevisionId: ids.revisionId,
      generationRequestId: ids.generationId,
      attemptId: ids.attemptId,
      spanId: ids.spanId,
      assetId: ids.assetId,
      artifactReceiptId: ids.receiptId,
      objectKey: `tenant/${ids.accountId}/workspace/${ids.workspaceId}/span`,
      checksumSha256: `sha256:${digest}`,
    };
    const coordinator = createHostedV209SpanAudioCoordinator({
      loadJobs,
      schedule,
      finalize: vi.fn(async () => finalization),
      resumePair: vi.fn(),
    });
    await coordinator.acceptCompleted({
      accountId: ids.accountId,
      workspaceId: ids.workspaceId,
      attemptId: ids.attemptId,
      resultDocument: { schema_version: "selected-span-audio-result/v1" },
    });
    expect(loadJobs).toHaveBeenCalledOnce();
    expect(schedule).toHaveBeenCalledOnce();
  });
});

import { describe, expect, it, vi } from "vitest";

import { sha256Bytes } from "./crypto";
import {
  attemptHostedV209SpanWorkflowReconciliation,
  type HostedV209SpanTerminalProjection,
} from "./hosted-v209-span-workflow-reconciliation";

const accountId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const workspaceId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const projectId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const revisionId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const attemptId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const userId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const resultDocument = { schema_version: "selected-span-audio-result/v1", attempt_id: attemptId };

async function fixture() {
  const bytes = new TextEncoder().encode(JSON.stringify(resultDocument));
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const terminal: HostedV209SpanTerminalProjection = {
    attemptId,
    accountId,
    workspaceId,
    kind: "SPAN_AUDIO",
    state: "SUCCEEDED",
    resultObjectKey:
      `tenant/${accountId}/workspace/${workspaceId}/project/${projectId}/revision/${revisionId}` +
      `/lane/input/job/${attemptId}/artifact/result-document`,
    resultContentLength: bytes.byteLength,
    resultChecksumSha256: await sha256Bytes(buffer),
  };
  return { bytes: buffer, terminal };
}

describe("durable V2-09 SPAN Workflow reconciliation", () => {
  it("retries after a committed terminal result outlives the client and finalizes/resumes once", async () => {
    const { bytes, terminal } = await fixture();
    const finalize = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient database failure"))
      .mockResolvedValue({
        schemaVersion: "videoforge.hosted-v209-span-audio-finalization/v1",
        accountId,
        workspaceId,
        userId,
        projectId,
        attemptId,
        pairReady: true,
      });
    const resumePair = vi.fn(async () => undefined);
    const dependencies = {
      bucket: {
        get: vi.fn(async () => ({
          size: bytes.byteLength,
          httpMetadata: { contentType: "application/json" },
          arrayBuffer: async () => bytes,
        })),
      } as never,
      finalize,
      resumePair,
    };

    await expect(
      attemptHostedV209SpanWorkflowReconciliation(dependencies, terminal),
    ).resolves.toEqual({ state: "FINALIZATION_PENDING" });
    expect(resumePair).not.toHaveBeenCalled();

    await expect(
      attemptHostedV209SpanWorkflowReconciliation(dependencies, terminal),
    ).resolves.toEqual({ state: "FINALIZED", pairResumed: true });
    expect(finalize).toHaveBeenCalledTimes(2);
    expect(finalize).toHaveBeenLastCalledWith({
      accountId,
      workspaceId,
      attemptId,
      resultDocument,
    });
    expect(resumePair).toHaveBeenCalledOnce();
    expect(resumePair).toHaveBeenCalledWith({ accountId, workspaceId, userId, projectId });
  });

  it("does not resume the pair until the finalization reports every SPAN ready", async () => {
    const { bytes, terminal } = await fixture();
    const resumePair = vi.fn();
    const result = await attemptHostedV209SpanWorkflowReconciliation(
      {
        bucket: {
          get: vi.fn(async () => ({
            size: bytes.byteLength,
            httpMetadata: { contentType: "application/json" },
            arrayBuffer: async () => bytes,
          })),
        } as never,
        finalize: vi.fn(async () => ({
          schemaVersion: "videoforge.hosted-v209-span-audio-finalization/v1",
          accountId,
          workspaceId,
          userId,
          projectId,
          attemptId,
          pairReady: false,
        })),
        resumePair,
      },
      terminal,
    );
    expect(result).toEqual({ state: "FINALIZED", pairResumed: false });
    expect(resumePair).not.toHaveBeenCalled();
  });

  it("keeps foreign, tampered, or malformed persisted results pending without finalization", async () => {
    const { bytes, terminal } = await fixture();
    const finalize = vi.fn();
    const resumePair = vi.fn();
    const result = await attemptHostedV209SpanWorkflowReconciliation(
      {
        bucket: {
          get: vi.fn(async () => ({
            size: bytes.byteLength,
            httpMetadata: { contentType: "application/json" },
            arrayBuffer: async () => bytes,
          })),
        } as never,
        finalize,
        resumePair,
      },
      {
        ...terminal,
        resultObjectKey: terminal.resultObjectKey!.replace(accountId, userId),
      },
    );
    expect(result).toEqual({ state: "FINALIZATION_PENDING" });
    expect(finalize).not.toHaveBeenCalled();
    expect(resumePair).not.toHaveBeenCalled();
  });
});

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
    ).resolves.toEqual({ state: "FINALIZATION_PENDING", diagnostic: {phase:"FINALIZE",code:"UNCLASSIFIED"} });
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
    expect(result).toEqual({ state: "FINALIZATION_PENDING", diagnostic: {phase:"PROJECTION",code:"UNCLASSIFIED"} });
    expect(finalize).not.toHaveBeenCalled();
    expect(resumePair).not.toHaveBeenCalled();
  });
  it.each(["RESULT_READ", "RESULT_HASH", "RESULT_PARSE", "FINALIZE", "PAIR_RESUME"] as const)("reports only fixed %s phase and sanitized SQLSTATE", async phase => {
    const {bytes,terminal}=await fixture();
    const privateFailure=Object.assign(new Error("https://private.example/?signed=secret cookie=private"),{code:"42501"});
    const wrongBytes=new TextEncoder().encode("{malformed").buffer as ArrayBuffer;
    const usedBytes=phase==="RESULT_PARSE"?wrongBytes:bytes;
    const observedTerminal=phase==="RESULT_PARSE"?{...terminal,resultContentLength:usedBytes.byteLength,resultChecksumSha256:await sha256Bytes(usedBytes)}:terminal;
    const result=await attemptHostedV209SpanWorkflowReconciliation({bucket:{get:async()=>{
      if(phase==="RESULT_READ")throw privateFailure;
      return{size:usedBytes.byteLength,httpMetadata:{contentType:"application/json"},arrayBuffer:async()=>{if(phase==="RESULT_HASH")throw privateFailure;return usedBytes;}};
    }} as never,finalize:async()=>{if(phase==="FINALIZE")throw privateFailure;return{schemaVersion:"videoforge.hosted-v209-span-audio-finalization/v1",accountId,workspaceId,userId,projectId,attemptId,pairReady:phase==="PAIR_RESUME"};},resumePair:async()=>{throw privateFailure;}},observedTerminal);
    expect(result).toEqual({state:"FINALIZATION_PENDING",diagnostic:{phase,code:phase==="RESULT_PARSE"?"UNCLASSIFIED":"SQLSTATE_42501"}});
    expect(JSON.stringify(result)).not.toMatch(/secret|cookie|private.example/u);
  });
  it("does not expose arbitrary error codes, properties or messages",async()=>{
    const{bytes,terminal}=await fixture();const result=await attemptHostedV209SpanWorkflowReconciliation({bucket:{get:async()=>({size:bytes.byteLength,httpMetadata:{contentType:"application/json"},arrayBuffer:async()=>bytes})} as never,finalize:async()=>{throw {code:"TOKEN",message:"private value",url:"https://private.example/"};},resumePair:vi.fn()},terminal);
    expect(result).toEqual({state:"FINALIZATION_PENDING",diagnostic:{phase:"FINALIZE",code:"UNCLASSIFIED"}});
  });

});

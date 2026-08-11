import type {
  RunwarePromptTransportRequest,
  RunwareStyleTransportRequest,
} from "@videoforge/pipeline";
import { describe, expect, it, vi } from "vitest";

import {
  RunwarePromptHttpTransport,
  RunwareSpendLedger,
  RunwareStyleHttpTransport,
  RunwareTransportError,
} from "./runware-http-transport";

const promptRequest = (hashCharacter = "a"): RunwarePromptTransportRequest =>
  ({
    requestVersion: "runware-deepseek-prompt-request-v1",
    attemptIndex: 1,
    requestedSceneIds: ["scene_001"],
    request: { taskUUID: "11111111-1111-8111-8111-111111111111" },
    requestBytes: '[{"taskUUID":"11111111-1111-8111-8111-111111111111"}]',
    requestSha256: `sha256:${hashCharacter.repeat(64)}`,
    retryOfRequestSha256: null,
  }) as unknown as RunwarePromptTransportRequest;

const styleRequest = (): RunwareStyleTransportRequest =>
  ({
    requestVersion: "runware-gemini-style-request-v1",
    analyzerVersion: "style-analyzer-v1",
    checkedAt: "2026-08-11T17:00:00Z",
    attemptIndex: 1,
    referenceAliases: ["ref_01", "ref_02", "ref_03"],
    inputSetSha256: `sha256:${"b".repeat(64)}`,
    request: { taskUUID: "22222222-2222-8222-8222-222222222222" },
    requestBytes: '[{"taskUUID":"22222222-2222-8222-8222-222222222222"}]',
    requestSha256: `sha256:${"c".repeat(64)}`,
    retryOfRequestSha256: null,
  }) as unknown as RunwareStyleTransportRequest;

const jsonResponse = (item: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify({ data: [item] }), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("Runware server HTTP transport", () => {
  it("maps prompt usage/cost and replays an exact request without a second charge", async () => {
    const ledger = new RunwareSpendLedger(0.2);
    const fetch = vi.fn(async () =>
      jsonResponse({
        taskUUID: "11111111-1111-8111-8111-111111111111",
        taskType: "textInference",
        text: { batch_id: "batch_001", scenes: [] },
        cost: 0.001,
        finishReason: "stop",
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      }),
    );
    const transport = new RunwarePromptHttpTransport({
      apiKey: "runware-test-key-at-least-twenty-characters",
      ledger,
      fetch,
      maximumRequestCostUsd: 0.02,
    });
    const first = await transport.dispatch(promptRequest());
    const replay = await transport.dispatch(promptRequest());
    expect({ ...first, latencyMs: 0 }).toEqual({ ...replay, latencyMs: 0 });
    expect(first).toMatchObject({
      status: "succeeded",
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, cachedInputTokens: 0 },
      costUsd: 0.001,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(ledger.snapshot()).toMatchObject({ reservedUsd: 0, settledUsd: 0.001 });
  });

  it("maps Gemini reasoning usage through the distinct style transport", async () => {
    const transport = new RunwareStyleHttpTransport({
      apiKey: "runware-test-key-at-least-twenty-characters",
      ledger: new RunwareSpendLedger(0.2),
      maximumRequestCostUsd: 0.08,
      fetch: async () =>
        jsonResponse({
          taskUUID: "22222222-2222-8222-8222-222222222222",
          taskType: "textInference",
          text: "{}",
          cost: 0.03,
          finishReason: "stop",
          usage: {
            promptTokens: 100,
            completionTokens: 80,
            totalTokens: 180,
            completionTokensDetails: { reasoningTokens: 20 },
          },
        }),
    });
    await expect(transport.dispatch(styleRequest())).resolves.toMatchObject({
      status: "succeeded",
      taskUUID: "22222222-2222-8222-8222-222222222222",
      usage: { promptTokens: 100, completionTokens: 80, totalTokens: 180, reasoningTokens: 20 },
    });
  });

  it("fails closed on cap exhaustion and task UUID reuse with changed bytes", async () => {
    const fetch = vi.fn(async () => new Response("unreachable"));
    const exhausted = new RunwarePromptHttpTransport({
      apiKey: "runware-test-key-at-least-twenty-characters",
      ledger: new RunwareSpendLedger(0.01),
      fetch,
      maximumRequestCostUsd: 0.02,
    });
    await expect(exhausted.dispatch(promptRequest())).rejects.toMatchObject({
      code: "RUNWARE_CAP_EXHAUSTED",
    });
    expect(fetch).not.toHaveBeenCalled();

    const conflictFetch = vi.fn(async () => {
      throw new Error("ambiguous");
    });
    const conflict = new RunwarePromptHttpTransport({
      apiKey: "runware-test-key-at-least-twenty-characters",
      ledger: new RunwareSpendLedger(0.2),
      fetch: conflictFetch,
      maximumRequestCostUsd: 0.02,
    });
    await expect(conflict.dispatch(promptRequest())).resolves.toMatchObject({
      status: "ambiguous",
    });
    await expect(conflict.dispatch(promptRequest("d"))).rejects.toMatchObject({
      code: "RUNWARE_IDEMPOTENCY_CONFLICT",
    });
  });

  it("keeps timeout/malformed success reserved and releases definite 4xx failures", async () => {
    const ambiguousLedger = new RunwareSpendLedger(0.2);
    const timeout = new RunwarePromptHttpTransport({
      apiKey: "runware-test-key-at-least-twenty-characters",
      ledger: ambiguousLedger,
      fetch: async () => {
        throw new DOMException("timed out", "TimeoutError");
      },
      maximumRequestCostUsd: 0.02,
    });
    await expect(timeout.dispatch(promptRequest())).resolves.toMatchObject({ status: "ambiguous" });
    expect(ambiguousLedger.snapshot().reservedUsd).toBe(0.02);

    const malformedLedger = new RunwareSpendLedger(0.2);
    const malformed = new RunwarePromptHttpTransport({
      apiKey: "runware-test-key-at-least-twenty-characters",
      ledger: malformedLedger,
      fetch: async () => new Response("not-json", { status: 200 }),
      maximumRequestCostUsd: 0.02,
    });
    await expect(malformed.dispatch(promptRequest())).resolves.toMatchObject({
      status: "ambiguous",
    });
    expect(malformedLedger.snapshot().reservedUsd).toBe(0.02);

    const rejectedLedger = new RunwareSpendLedger(0.2);
    const rejected = new RunwarePromptHttpTransport({
      apiKey: "runware-test-key-at-least-twenty-characters",
      ledger: rejectedLedger,
      fetch: async () => new Response("private provider details", { status: 401 }),
      maximumRequestCostUsd: 0.02,
    });
    await expect(rejected.dispatch(promptRequest())).resolves.toMatchObject({ status: "failed" });
    expect(rejectedLedger.snapshot().reservedUsd).toBe(0);
  });

  it("never includes a credential in validation errors", () => {
    const secret = "short-secret";
    expect(
      () =>
        new RunwarePromptHttpTransport({
          apiKey: secret,
          ledger: new RunwareSpendLedger(0.2),
          maximumRequestCostUsd: 0.02,
        }),
    ).toThrow(RunwareTransportError);
    try {
      new RunwarePromptHttpTransport({
        apiKey: secret,
        ledger: new RunwareSpendLedger(0.2),
        maximumRequestCostUsd: 0.02,
      });
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });
});

import { describe, expect, it, vi } from "vitest";

import {
  extractHostedVoiceoverContext,
  prepareHostedVoiceoverContextRequest,
  reconcileHostedVoiceoverContext,
} from "./voiceover-context";

const HASH = `sha256:${"a".repeat(64)}` as const;

function contextDocument() {
  return {
    primary_topic: "Fresh watermelon selection",
    summary: "A shopper checks a watermelon for visible and audible signs of ripeness.",
    people: ["shopper"],
    places: ["produce market"],
    era_and_time: ["present day"],
    recurring_objects: ["whole watermelon"],
    processes: ["inspect rind, field spot, and stem; then tap the fruit"],
    cause_and_effect: ["a hollow sound supports ripeness"],
    chronology: ["inspect appearance", "tap fruit", "compare result"],
    continuity_facts: ["the same shopper and watermelon continue across the checks"],
    resolved_references: ["it refers to the watermelon"],
  };
}

describe("hosted voiceover context extraction", () => {
  it("prepares one bounded whole-transcript request before dispatch", async () => {
    const prepared = await prepareHostedVoiceoverContextRequest({
      transcript: "Inspect the fruit. Then tap it and listen for a hollow sound.",
      transcriptHash: HASH,
    });
    const request = prepared.request as unknown as Record<string, unknown>;
    expect(prepared.requestHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(prepared.requestBytes).toContain("complete VideoForge voiceover transcript");
    expect(request).toMatchObject({ model: "deepseek:v4@flash", outputFormat: "json" });
    expect((request.settings as Record<string, unknown>).maxTokens).toBe(1_600);
  });

  it("accepts strict compact context under the one-cent cap with fake transport only", async () => {
    const prepared = await prepareHostedVoiceoverContextRequest({
      transcript: "Inspect the fruit. Then tap it and listen for a hollow sound.",
      transcriptHash: HASH,
    });
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { taskUUID: string }[];
      return Response.json({
        data: [
          {
            taskUUID: request[0]!.taskUUID,
            taskType: "textInference",
            text: JSON.stringify(contextDocument()),
            cost: 0.001,
            finishReason: "stop",
            usage: { promptTokens: 80, completionTokens: 120, totalTokens: 200 },
          },
        ],
      });
    });
    const result = await extractHostedVoiceoverContext({
      prepared,
      apiKey: "runware-test-key-at-least-twenty-characters",
      fetcher,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.context).toEqual(contextDocument());
    expect(result.contextBytes.length).toBeLessThanOrEqual(6_000);
    expect(result.reportedCostMicroUsd).toBe(1_000);
  });

  it("fails closed when the provider response is ambiguous", async () => {
    const prepared = await prepareHostedVoiceoverContextRequest({
      transcript: "A complete transcript.",
      transcriptHash: HASH,
    });
    await expect(
      extractHostedVoiceoverContext({
        prepared,
        apiKey: "runware-test-key-at-least-twenty-characters",
        fetcher: async () => {
          throw new DOMException("timed out", "TimeoutError");
        },
      }),
    ).rejects.toThrow("VOICEOVER_CONTEXT_PROVIDER_UNCERTAIN");
  });

  it("distinguishes a definite provider rejection from an ambiguous dispatch", async () => {
    const prepared = await prepareHostedVoiceoverContextRequest({
      transcript: "A complete transcript.",
      transcriptHash: HASH,
    });
    await expect(
      extractHostedVoiceoverContext({
        prepared,
        apiKey: "runware-test-key-at-least-twenty-characters",
        fetcher: async () =>
          new Response(JSON.stringify({ errors: [{ code: "invalidValue" }] }), { status: 400 }),
      }),
    ).rejects.toThrow("VOICEOVER_CONTEXT_PROVIDER_REJECTED");
  });

  it("reconciles an uncertain dispatch through task details without textInference redispatch", async () => {
    const prepared = await prepareHostedVoiceoverContextRequest({
      transcript: "Inspect the fruit. Then tap it and listen for a hollow sound.",
      transcriptHash: HASH,
    });
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const lookup = JSON.parse(String(init?.body)) as Array<Record<string, unknown>>;
      expect(lookup).toEqual([{ taskType: "getTaskDetails", taskUUID: prepared.request.taskUUID }]);
      return Response.json({
        data: [
          {
            taskType: "getTaskDetails",
            taskUUID: prepared.request.taskUUID,
            request: JSON.parse(prepared.requestBytes),
            response: {
              data: [
                {
                  taskType: "textInference",
                  taskUUID: prepared.request.taskUUID,
                  model: "deepseek:v4@flash",
                  text: JSON.stringify(contextDocument()),
                  cost: 0.001,
                  finishReason: "stop",
                  usage: { promptTokens: 80, completionTokens: 120, totalTokens: 200 },
                },
              ],
            },
          },
        ],
      });
    });
    const recovered = await reconcileHostedVoiceoverContext({
      prepared,
      apiKey: "runware-test-key-at-least-twenty-characters",
      fetcher,
    });
    expect(recovered.context).toEqual(contextDocument());
    expect(recovered.requestHash).toBe(prepared.requestHash);
    expect(recovered.reportedCostMicroUsd).toBe(1_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

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
    expect(request).toMatchObject({ model: "deepseek:v4@flash", outputFormat: "JSON" });
    expect((request.settings as Record<string, unknown>).maxTokens).toBe(1_600);
  });

  it("binds the provider task UUID to the full request instead of the transcript hash alone", async () => {
    const first = await prepareHostedVoiceoverContextRequest({
      transcript: "The first immutable request body.",
      transcriptHash: HASH,
    });
    const replay = await prepareHostedVoiceoverContextRequest({
      transcript: "The first immutable request body.",
      transcriptHash: HASH,
    });
    const changedRequest = await prepareHostedVoiceoverContextRequest({
      transcript: "The changed immutable request body.",
      transcriptHash: HASH,
    });
    expect(replay.request.taskUUID).toBe(first.request.taskUUID);
    expect(changedRequest.request.taskUUID).not.toBe(first.request.taskUUID);
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
    ).rejects.toThrow("VOICEOVER_CONTEXT_NETWORK_UNCERTAIN");
  });

  it("accepts a successful envelope that includes an empty errors array", async () => {
    const prepared = await prepareHostedVoiceoverContextRequest({
      transcript: "Inspect the fruit. Then tap it.",
      transcriptHash: HASH,
    });
    const result = await extractHostedVoiceoverContext({
      prepared,
      apiKey: "runware-test-key-at-least-twenty-characters",
      fetcher: async () =>
        Response.json({
          errors: [],
          data: [
            {
              taskUUID: prepared.request.taskUUID,
              taskType: "textInference",
              text: JSON.stringify(contextDocument()),
              cost: 0.001,
              finishReason: "stop",
              usage: { promptTokens: 80, completionTokens: 120, totalTokens: 200 },
            },
          ],
        }),
    });
    expect(result.context).toEqual(contextDocument());
  });

  it("invokes the fetch port without changing its receiver", async () => {
    const prepared = await prepareHostedVoiceoverContextRequest({
      transcript: "Inspect the fruit. Then tap it.",
      transcriptHash: HASH,
    });
    async function receiverSensitiveFetcher(
      this: void,
      _input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> {
      expect(this).toBeUndefined();
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
    }
    await expect(
      extractHostedVoiceoverContext({
        prepared,
        apiKey: "runware-test-key-at-least-twenty-characters",
        fetcher: receiverSensitiveFetcher,
      }),
    ).resolves.toMatchObject({ context: contextDocument() });
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
              errors: [],
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

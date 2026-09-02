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
    expect(request).toMatchObject({ model: "openai:gpt@5-nano", outputFormat: "JSON" });
    expect(request.settings).toMatchObject({ thinkingLevel: "medium", maxTokens: 3_000 });
    expect(Object.keys(request.settings as Record<string, unknown>).sort()).toEqual([
      "maxTokens",
      "systemPrompt",
      "thinkingLevel",
    ]);
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

  it("accepts only bounded whole-response structured wrappers", async () => {
    const prepared = await prepareHostedVoiceoverContextRequest({
      transcript: "Inspect the fruit. Then tap it.",
      transcriptHash: HASH,
    });
    for (const text of [
      `\`\`\`json\n${JSON.stringify(contextDocument())}\n\`\`\``,
      JSON.stringify(JSON.stringify(contextDocument())),
    ]) {
      await expect(
        extractHostedVoiceoverContext({
          prepared,
          apiKey: "runware-test-key-at-least-twenty-characters",
          fetcher: async () =>
            Response.json({
              data: [
                {
                  taskUUID: prepared.request.taskUUID,
                  taskType: "textInference",
                  text,
                  cost: 0.001,
                  finishReason: "stop",
                  usage: { promptTokens: 80, completionTokens: 120, totalTokens: 200 },
                },
              ],
            }),
        }),
      ).resolves.toMatchObject({ context: contextDocument() });
    }
  });

  it("accepts exactly one schema-valid JSON object inside provider prose", async () => {
    const prepared = await prepareHostedVoiceoverContextRequest({
      transcript: "Inspect the fruit. Then tap it.",
      transcriptHash: HASH,
    });
    await expect(
      extractHostedVoiceoverContext({
        prepared,
        apiKey: "runware-test-key-at-least-twenty-characters",
        fetcher: async () =>
          Response.json({
            data: [
              {
                taskUUID: prepared.request.taskUUID,
                taskType: "textInference",
                text: `The provider said "final answer follows": ${JSON.stringify(contextDocument())}`,
                cost: 0.001,
                finishReason: "stop",
                usage: { promptTokens: 80, completionTokens: 120, totalTokens: 200 },
              },
            ],
          }),
      }),
    ).resolves.toMatchObject({ context: contextDocument() });
  });

  it("accepts the unique schema-valid object after a malformed provider draft", async () => {
    const prepared = await prepareHostedVoiceoverContextRequest({
      transcript: "Inspect the fruit. Then tap it.",
      transcriptHash: HASH,
    });
    await expect(
      extractHostedVoiceoverContext({
        prepared,
        apiKey: "runware-test-key-at-least-twenty-characters",
        fetcher: async () =>
          Response.json({
            data: [
              {
                taskUUID: prepared.request.taskUUID,
                taskType: "textInference",
                text: `{not valid JSON}\nFinal: ${JSON.stringify(contextDocument())}`,
                cost: 0.001,
                finishReason: "stop",
                usage: { promptTokens: 80, completionTokens: 120, totalTokens: 200 },
              },
            ],
          }),
      }),
    ).resolves.toMatchObject({ context: contextDocument() });
  });

  it("rejects multiple objects and duplicate properties with safe typed codes", async () => {
    const prepared = await prepareHostedVoiceoverContextRequest({
      transcript: "Inspect the fruit. Then tap it.",
      transcriptHash: HASH,
    });
    for (const [text, code] of [
      ["{} {}", "VOICEOVER_CONTEXT_JSON_INVALID"],
      [
        '{"primary_topic":"first","primary_topic":"second"}',
        "VOICEOVER_CONTEXT_JSON_DUPLICATE_PROPERTY",
      ],
    ] as const) {
      await expect(
        extractHostedVoiceoverContext({
          prepared,
          apiKey: "runware-test-key-at-least-twenty-characters",
          fetcher: async () =>
            Response.json({
              data: [
                {
                  taskUUID: prepared.request.taskUUID,
                  taskType: "textInference",
                  text,
                  cost: 0.001,
                  finishReason: "stop",
                  usage: { promptTokens: 80, completionTokens: 120, totalTokens: 200 },
                },
              ],
            }),
        }),
      ).rejects.toThrow(code);
    }
  });

  it("rejects two schema-valid objects even when they are identical", async () => {
    const prepared = await prepareHostedVoiceoverContextRequest({
      transcript: "Inspect the fruit. Then tap it.",
      transcriptHash: HASH,
    });
    const document = JSON.stringify(contextDocument());
    await expect(
      extractHostedVoiceoverContext({
        prepared,
        apiKey: "runware-test-key-at-least-twenty-characters",
        fetcher: async () =>
          Response.json({
            data: [
              {
                taskUUID: prepared.request.taskUUID,
                taskType: "textInference",
                text: `${document}\n${document}`,
                cost: 0.001,
                finishReason: "stop",
                usage: { promptTokens: 80, completionTokens: 120, totalTokens: 200 },
              },
            ],
          }),
      }),
    ).rejects.toThrow("VOICEOVER_CONTEXT_JSON_INVALID");
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
                  model: "openai:gpt@5-nano",
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

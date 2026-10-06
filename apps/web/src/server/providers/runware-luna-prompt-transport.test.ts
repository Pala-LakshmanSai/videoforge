import type { RunwarePromptTransportRequest } from "@videoforge/pipeline";
import { canonicalizeJson } from "@videoforge/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  buildRunwareLunaPromptWireRequest,
  RunwareLunaPromptHttpTransport,
  RunwareLunaRejectedError,
  RunwareLunaSubmissionUnknownError,
} from "./runware-luna-prompt-transport";
import { RunwareSpendLedger } from "./runware-http-transport";

const sha256 = async (value: string): Promise<`sha256:${string}`> =>
  `sha256:${[
    ...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))),
  ]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;

const makeRequest = async (
  overrides: Record<string, unknown> = {},
): Promise<RunwarePromptTransportRequest> => {
  const request = {
    taskType: "textInference",
    taskUUID: "11111111-1111-4111-8111-111111111111",
    model: "openai:gpt@6-luna",
    outputFormat: "JSON",
    jsonSchema: {
      name: "response",
      strict: true,
      schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
    },
    deliveryMethod: "async",
    includeCost: true,
    includeUsage: true,
    settings: {
      systemPrompt: "Write grounded scene prompts.",
      thinkingLevel: "low",
      maxTokens: 128,
    },
    messages: [{ role: "user", content: "Write one scene." }],
    ...overrides,
  };
  const requestBytes = canonicalizeJson([request]);
  return {
    requestVersion: "runware-gpt-6-luna-prompt-request-v38",
    attemptIndex: 1,
    requestedSceneIds: ["scene_001"],
    request: request as unknown as RunwarePromptTransportRequest["request"],
    requestBytes,
    requestSha256: await sha256(requestBytes),
    retryOfRequestSha256: null,
  };
};

const complete = (overrides: Record<string, unknown> = {}) => ({
  id: "chatcmpl-test_001",
  model: "openai:gpt@6-luna",
  choices: [
    {
      index: 0,
      finish_reason: "stop",
      message: { role: "assistant", content: '{"ok":true}' },
    },
  ],
  usage: {
    prompt_tokens: 100,
    completion_tokens: 10,
    total_tokens: 110,
    prompt_tokens_details: { cached_tokens: 20, cache_write_tokens: 10 },
    completion_tokens_details: { reasoning_tokens: 0 },
  },
  ...overrides,
});

const jsonResponse = (value: unknown, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify(value), { status, headers });

describe("Runware Luna prompt transport", () => {
  it("builds exact Chat Completions JSON-schema bytes from the sealed envelope", async () => {
    const request = await makeRequest();
    const wire = await buildRunwareLunaPromptWireRequest(request);
    expect(JSON.parse(wire.bytes)).toEqual({
      model: "openai:gpt@6-luna",
      messages: [
        { role: "system", content: "Write grounded scene prompts." },
        { role: "user", content: "Write one scene." },
      ],
      max_completion_tokens: 128,
      reasoning_effort: "low",
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "response",
          schema: request.request.jsonSchema?.schema,
          strict: true,
        },
      },
    });
    expect(wire.wireHash).toBe(await sha256(wire.bytes));
    await expect(
      buildRunwareLunaPromptWireRequest({ ...request, requestBytes: `${request.requestBytes} ` }),
    ).rejects.toBeInstanceOf(RunwareLunaSubmissionUnknownError);
    await expect(
      buildRunwareLunaPromptWireRequest(
        await makeRequest({
          jsonSchema: {
            name: "response",
            strict: false,
            schema: { type: "object" },
          },
        }),
      ),
    ).rejects.toBeInstanceOf(RunwareLunaSubmissionUnknownError);
  });

  it("submits once and estimates cost with cached, cache-write, and output rates", async () => {
    const request = await makeRequest();
    const fetcher = vi.fn(async () => jsonResponse(complete()));
    const ledger = new RunwareSpendLedger(0.25);
    const transport = new RunwareLunaPromptHttpTransport({
      apiKey: "runware-test-key-at-least-twenty-characters",
      ledger,
      maximumRequestCostUsd: 0.25,
      fetch: fetcher,
    });
    const result = await transport.dispatch(request);
    expect(result).toMatchObject({
      status: "succeeded",
      outputText: '{"ok":true}',
      costUsd: 0.000014,
      estimatedCostMicroUsd: 14,
      costBasis: "PINNED_RATE_ESTIMATE",
      finishReason: "stop",
      providerModel: "openai:gpt@6-luna",
      responseId: "chatcmpl-test_001",
      usage: {
        inputTokens: 100,
        outputTokens: 10,
        totalTokens: 110,
        cachedInputTokens: 20,
        cacheWriteTokens: 10,
        reasoningTokens: 0,
      },
    });
    expect((result as { wireHash: string }).wireHash).toBe(
      (await buildRunwareLunaPromptWireRequest(request)).wireHash,
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(ledger.snapshot()).toMatchObject({ reservedUsd: 0, settledUsd: 0.000014 });
  });

  it("preserves the provider finish reason and bills reasoning once within output usage", async () => {
    const outcomes = [
      {
        response: complete({
          choices: [
            { index: 0, finish_reason: "length", message: { role: "assistant", content: "{" } },
          ],
        }),
        finishReason: "length",
      },
      {
        response: complete({
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: { role: "assistant", content: null, refusal: "Cannot comply." },
            },
          ],
        }),
        finishReason: "refusal",
      },
      {
        response: complete({
          usage: { ...complete().usage, completion_tokens_details: { reasoning_tokens: 2 } },
        }),
        finishReason: "stop",
      },
    ];
    for (const outcome of outcomes) {
      const transport = new RunwareLunaPromptHttpTransport({
        apiKey: "runware-test-key-at-least-twenty-characters",
        ledger: new RunwareSpendLedger(0.25),
        maximumRequestCostUsd: 0.25,
        fetch: async () => jsonResponse(outcome.response),
      });
      await expect(transport.dispatch(await makeRequest())).resolves.toMatchObject({
        status: "succeeded",
        finishReason: outcome.finishReason,
        estimatedCostMicroUsd: 14,
        responseId: "chatcmpl-test_001",
        ...(outcome.finishReason === "stop" &&
        outcome.response.usage.completion_tokens_details.reasoning_tokens === 2
          ? { usage: { outputTokens: 10, reasoningTokens: 2 } }
          : {}),
      });
    }
  });

  it("never replays an ambiguous POST and rejects known client errors without retaining reservation", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("connection reset after write");
    });
    const unknown = new RunwareLunaPromptHttpTransport({
      apiKey: "runware-test-key-at-least-twenty-characters",
      ledger: new RunwareSpendLedger(0.25),
      maximumRequestCostUsd: 0.25,
      fetch: fetcher,
    });
    await expect(unknown.dispatch(await makeRequest())).rejects.toBeInstanceOf(
      RunwareLunaSubmissionUnknownError,
    );
    expect(fetcher).toHaveBeenCalledTimes(1);

    const rejectedLedger = new RunwareSpendLedger(0.25);
    const rejected = new RunwareLunaPromptHttpTransport({
      apiKey: "runware-test-key-at-least-twenty-characters",
      ledger: rejectedLedger,
      maximumRequestCostUsd: 0.25,
      fetch: async () => jsonResponse({ error: { code: "invalid_model" } }, 400),
    });
    await expect(rejected.dispatch(await makeRequest())).rejects.toMatchObject({
      name: "RunwareLunaRejectedError",
      httpStatus: 400,
      providerCode: "invalid_model",
      billed: false,
    } satisfies Partial<RunwareLunaRejectedError>);
    expect(rejectedLedger.snapshot().reservedUsd).toBe(0);
  });

  it("reports 429 capacity refusal and releases its reservation", async () => {
    const callback = vi.fn(async () => undefined);
    const ledger = new RunwareSpendLedger(0.25);
    const transport = new RunwareLunaPromptHttpTransport({
      apiKey: "runware-test-key-at-least-twenty-characters",
      ledger,
      maximumRequestCostUsd: 0.25,
      fetch: async () =>
        jsonResponse({ error: { code: "rate_limit_exceeded", type: "rate_limit_error" } }, 429),
      onCapacityRefused: callback,
    });
    await expect(transport.dispatch(await makeRequest())).rejects.toBeInstanceOf(
      RunwareLunaRejectedError,
    );
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        taskUUID: "11111111-1111-4111-8111-111111111111",
        responseHash: expect.stringMatching(/^sha256:/u),
      }),
    );
    expect(ledger.snapshot().reservedUsd).toBe(0);
  });

  it("does not classify quota, billing-limit, plain, or malformed 429 responses as capacity", async () => {
    const callback = vi.fn(async () => undefined);
    const responses = [
      jsonResponse({ error: { code: "insufficient_quota", type: "insufficient_quota" } }, 429),
      jsonResponse({ error: { code: "billing_hard_limit_reached", type: "billing_error" } }, 429),
      jsonResponse({ error: { message: "try later" } }, 429),
      new Response("not-json", { status: 429 }),
    ];
    for (const response of responses) {
      const transport = new RunwareLunaPromptHttpTransport({
        apiKey: "runware-test-key-at-least-twenty-characters",
        ledger: new RunwareSpendLedger(0.25),
        maximumRequestCostUsd: 0.25,
        fetch: async () => response,
        onCapacityRefused: callback,
      });
      await expect(transport.dispatch(await makeRequest())).rejects.toBeInstanceOf(
        RunwareLunaRejectedError,
      );
    }
    expect(callback).not.toHaveBeenCalled();
  });

  it("rejects input and completion token bounds before POST", async () => {
    const fetcher = vi.fn(async () => jsonResponse(complete()));
    const overlongInput = await makeRequest({
      settings: {
        systemPrompt: "x".repeat(41_857),
        thinkingLevel: "low",
        maxTokens: 128,
      },
    });
    const overlongOutput = await makeRequest({
      settings: {
        systemPrompt: "Write grounded scene prompts.",
        thinkingLevel: "low",
        maxTokens: 6_145,
      },
    });
    const transport = new RunwareLunaPromptHttpTransport({
      apiKey: "runware-test-key-at-least-twenty-characters",
      ledger: new RunwareSpendLedger(0.25),
      maximumRequestCostUsd: 0.25,
      fetch: fetcher,
    });
    for (const request of [overlongInput, overlongOutput])
      await expect(transport.dispatch(request)).rejects.toMatchObject({
        code: expect.stringMatching(/^preflight_/u),
      });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("fails closed on changed response identity, model, choice count, or malformed usage", async () => {
    for (const response of [
      complete({ id: "" }),
      complete({ id: "resp_not_chatcmpl" }),
      complete({ model: "openai:gpt-6-luna" }),
      complete({ choices: [] }),
      complete({ choices: [complete().choices[0], complete().choices[0]] }),
      complete({
        usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 12, reasoning_tokens: 4 },
      }),
      complete({ usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 14 } }),
      complete({ usage: { ...complete().usage, cached_input_tokens: 0 } }),
      complete({ usage: { ...complete().usage, cache_write_tokens: 0 } }),
      complete({
        usage: { ...complete().usage, completion_tokens_details: { reasoning_tokens: 11 } },
      }),
    ]) {
      const transport = new RunwareLunaPromptHttpTransport({
        apiKey: "runware-test-key-at-least-twenty-characters",
        ledger: new RunwareSpendLedger(0.25),
        maximumRequestCostUsd: 0.25,
        fetch: async () => jsonResponse(response),
      });
      await expect(transport.dispatch(await makeRequest())).rejects.toBeInstanceOf(
        RunwareLunaSubmissionUnknownError,
      );
    }
  });
});

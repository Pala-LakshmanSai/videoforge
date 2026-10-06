import type {
  RunwarePromptTransportRequest,
  RunwareStyleTransportRequest,
} from "@videoforge/pipeline";
import { canonicalizeJson } from "@videoforge/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  RunwarePromptHttpTransport,
  RunwareSpendLedger,
  RunwareStyleHttpTransport,
  RunwareTransportError,
  RunwareArchivedTaskRejectedError,
  RunwareArchivedTextUnavailableError,
  readRunwareCreditBalance,
  retrieveRunwareTextTaskDetails,
} from "./runware-http-transport";

const promptRequest = (hashCharacter = "a"): RunwarePromptTransportRequest =>
  ({
    requestVersion: "runware-deepseek-prompt-request-v2",
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

const testHash = async (bytes: string): Promise<`sha256:${string}`> =>
  `sha256:${[...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(bytes)))].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;

const asyncPromptRequest = async (): Promise<RunwarePromptTransportRequest> => {
  const base = promptRequest();
  const request = { ...base.request, taskType: "textInference", deliveryMethod: "async" };
  const requestBytes = canonicalizeJson([request]);
  return {
    ...base,
    request,
    requestBytes,
    requestSha256: await testHash(requestBytes),
  } as RunwarePromptTransportRequest;
};

const completeAsyncText = (taskUUID: string) => ({
  taskType: "textInference",
  taskUUID,
  status: "success",
  text: "x".repeat(16_000),
  cost: 0.001,
  finishReason: "stop",
  usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
});

describe("Runware server HTTP transport", () => {
  it("submits async inference once and retrieves the full response through exact polling", async () => {
    const request = await asyncPromptRequest(),
      taskUUID = request.request.taskUUID;
    const ledger = new RunwareSpendLedger(0.2);
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const [body] = JSON.parse(String(init?.body));
      if (fetcher.mock.calls.length === 1) {
        expect(body).toEqual(request.request);
        return jsonResponse({ taskType: "textInference", taskUUID });
      }
      expect(body).toEqual({ taskType: "getResponse", taskUUID });
      return jsonResponse(
        fetcher.mock.calls.length === 2
          ? { taskType: "getResponse", taskUUID, status: "processing" }
          : completeAsyncText(taskUUID),
      );
    });
    const transport = new RunwarePromptHttpTransport({
      apiKey: "runware-test-key-at-least-twenty-characters",
      ledger,
      fetch: fetcher,
      maximumRequestCostUsd: 0.02,
      pollIntervalMs: 1,
    });
    await expect(transport.dispatch(request)).resolves.toMatchObject({
      status: "succeeded",
      outputText: "x".repeat(16_000),
      costUsd: 0.001,
    });
    await expect(transport.dispatch(request)).resolves.toMatchObject({ status: "succeeded" });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(ledger.snapshot()).toMatchObject({ reservedUsd: 0, settledUsd: 0.001 });
  });

  it("keeps async timeouts and failed or mismatched polls reserved without resubmitting", async () => {
    const request = await asyncPromptRequest(),
      taskUUID = request.request.taskUUID;
    for (const outcome of ["timeout", "network", "identity", "failure", "redacted"] as const) {
      const ledger = new RunwareSpendLedger(0.2);
      const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const [body] = JSON.parse(String(init?.body));
        if (fetcher.mock.calls.length === 1)
          return jsonResponse({ taskType: "textInference", taskUUID });
        expect(body.taskType).toBe("getResponse");
        if (outcome === "network") throw new Error("lost polling response");
        if (outcome === "failure")
          return new Response(JSON.stringify({ errors: [{ taskUUID, code: "timeoutProvider" }] }));
        if (outcome === "identity") return jsonResponse(completeAsyncText(crypto.randomUUID()));
        if (outcome === "redacted")
          return jsonResponse({
            ...completeAsyncText(taskUUID),
            text: "...[REDACTED 6476 bytes]...",
          });
        return jsonResponse({ taskType: "getResponse", taskUUID, status: "processing" });
      });
      const transport = new RunwarePromptHttpTransport({
        apiKey: "runware-test-key-at-least-twenty-characters",
        ledger,
        fetch: fetcher,
        maximumRequestCostUsd: 0.02,
        timeoutMs: 8,
        pollIntervalMs: 2,
      });
      await expect(transport.dispatch(request)).resolves.toMatchObject({ status: "ambiguous" });
      const count = fetcher.mock.calls.length;
      await expect(transport.dispatch(request)).resolves.toMatchObject({ status: "ambiguous" });
      expect(fetcher).toHaveBeenCalledTimes(count);
      expect(
        fetcher.mock.calls.filter(
          (call) => JSON.parse(String(call[1]?.body))[0].taskType === "textInference",
        ),
      ).toHaveLength(1);
      expect(ledger.snapshot()).toMatchObject({ reservedUsd: 0.02, settledUsd: 0 });
    }
  });

  it("does not poll an async acknowledgment with a different task identity", async () => {
    const request = await asyncPromptRequest();
    const fetcher = vi.fn(async () =>
      jsonResponse({ taskType: "textInference", taskUUID: crypto.randomUUID() }),
    );
    const transport = new RunwarePromptHttpTransport({
      apiKey: "runware-test-key-at-least-twenty-characters",
      ledger: new RunwareSpendLedger(0.2),
      fetch: fetcher,
      maximumRequestCostUsd: 0.02,
    });
    await expect(transport.dispatch(request)).resolves.toMatchObject({ status: "ambiguous" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("recovers an exact async response without an archive read or inference", async () => {
    const request = await asyncPromptRequest();
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual([
        { taskType: "getResponse", taskUUID: request.request.taskUUID },
      ]);
      return jsonResponse(completeAsyncText(request.request.taskUUID));
    });
    await expect(
      retrieveRunwareTextTaskDetails({
        apiKey: "runware-test-key-at-least-twenty-characters",
        originalTaskUUID: request.request.taskUUID,
        originalRequestBytes: request.requestBytes,
        originalRequestSha256: request.requestSha256,
        fetch: fetcher,
      }),
    ).resolves.toMatchObject({ outputText: "x".repeat(16_000), costUsd: 0.001 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("distinguishes exact terminal redacted archives with verified known cost from generated output", async () => {
    for (const deliveryMethod of ["sync", "async"] as const) {
      const taskUUID = "11111111-1111-4111-8111-111111111111";
      const originalRequest = [{ taskType: "textInference", taskUUID, deliveryMethod }];
      const originalRequestBytes = canonicalizeJson(originalRequest);
      const originalResponse = {
        data: [
          {
            ...completeAsyncText(taskUUID),
            text: "```json\n{\n...[REDACTED 6476 bytes]...\n}\n```",
            cost: 0.042,
          },
        ],
      };
      const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const [body] = JSON.parse(String(init?.body));
        if (body.taskType === "getResponse")
          return jsonResponse({ taskType: "getResponse", taskUUID, status: "processing" });
        expect(body.taskType).toBe("getTaskDetails");
        return jsonResponse({
          taskType: "getTaskDetails",
          taskUUID,
          request: originalRequest,
          response: originalResponse,
        });
      });
      const recovered = retrieveRunwareTextTaskDetails({
        apiKey: "runware-test-key-at-least-twenty-characters",
        originalTaskUUID: taskUUID,
        originalRequestBytes,
        originalRequestSha256: await testHash(originalRequestBytes),
        fetch: fetcher,
      });
      await expect(recovered).rejects.toBeInstanceOf(RunwareArchivedTextUnavailableError);
      await expect(recovered).rejects.toMatchObject({
        code: "RUNWARE_TEXT_ARCHIVE_UNAVAILABLE",
        costUsd: 0.042,
        responseHash: await testHash(canonicalizeJson(originalResponse)),
      });
      expect(fetcher).toHaveBeenCalledTimes(deliveryMethod === "async" ? 2 : 1);
    }
  });

  it("validates saved async request bytes before any recovery read", async () => {
    const request = await asyncPromptRequest(),
      fetcher = vi.fn();
    await expect(
      retrieveRunwareTextTaskDetails({
        apiKey: "runware-test-key-at-least-twenty-characters",
        originalTaskUUID: request.request.taskUUID,
        originalRequestBytes: request.requestBytes + " ",
        originalRequestSha256: request.requestSha256,
        fetch: fetcher,
      }),
    ).rejects.toMatchObject({ code: "RUNWARE_IDEMPOTENCY_CONFLICT" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("never treats processing or mismatched archived redaction as a known completed task", async () => {
    const request = await asyncPromptRequest(),
      taskUUID = request.request.taskUUID;
    for (const invalid of [
      { taskUUID: crypto.randomUUID() },
      { taskType: "imageInference" },
      { cost: null },
      { usage: null },
      { usage: { promptTokens: 10, completionTokens: 20, totalTokens: 29 } },
      { usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, cachedInputTokens: 11 } },
      { finishReason: "length" },
    ]) {
      const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const [body] = JSON.parse(String(init?.body));
        if (body.taskType === "getResponse")
          return jsonResponse({ taskType: "getResponse", taskUUID, status: "processing" });
        return jsonResponse({
          taskType: "getTaskDetails",
          taskUUID,
          request: JSON.parse(request.requestBytes),
          response: {
            data: [
              { ...completeAsyncText(taskUUID), text: "...[REDACTED 6476 bytes]...", ...invalid },
            ],
          },
        });
      });
      await expect(
        retrieveRunwareTextTaskDetails({
          apiKey: "runware-test-key-at-least-twenty-characters",
          originalTaskUUID: taskUUID,
          originalRequestBytes: request.requestBytes,
          originalRequestSha256: request.requestSha256,
          fetch: fetcher,
        }),
      ).rejects.not.toBeInstanceOf(RunwareArchivedTextUnavailableError);
      expect(fetcher).toHaveBeenCalledTimes(2);
    }
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const [body] = JSON.parse(String(init?.body));
      return body.taskType === "getResponse"
        ? jsonResponse({ taskType: "getResponse", taskUUID, status: "processing" })
        : new Response(JSON.stringify({ errors: [{ code: "taskNotFound", taskUUID }] }), {
            status: 404,
          });
    });
    await expect(
      retrieveRunwareTextTaskDetails({
        apiKey: "runware-test-key-at-least-twenty-characters",
        originalTaskUUID: taskUUID,
        originalRequestBytes: request.requestBytes,
        originalRequestSha256: request.requestSha256,
        fetch: fetcher,
      }),
    ).rejects.toMatchObject({ code: "RUNWARE_TASK_NOT_FOUND" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("rejects a mismatched polled identity before any archive fallback", async () => {
    const request = await asyncPromptRequest();
    const fetcher = vi.fn(async () => jsonResponse(completeAsyncText(crypto.randomUUID())));
    await expect(
      retrieveRunwareTextTaskDetails({
        apiKey: "runware-test-key-at-least-twenty-characters",
        originalTaskUUID: request.request.taskUUID,
        originalRequestBytes: request.requestBytes,
        originalRequestSha256: request.requestSha256,
        fetch: fetcher,
      }),
    ).rejects.toMatchObject({ code: "RUNWARE_IDEMPOTENCY_CONFLICT" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([200, 429])(
    "retains uncertain HTTP %s capacity identity and persists cooldown only for an exact uncharged refusal",
    async (status) => {
      const request = promptRequest();
      const rejection = {
        code: "concurrentRequestLimitExceeded",
        taskType: "textInference",
        taskUUID: request.request.taskUUID,
      };
      for (const [body, confirmed] of [
        [{ errors: [rejection] }, true],
        [{ errors: [{ ...rejection, taskUUID: crypto.randomUUID() }] }, false],
        [{ errors: [rejection], data: [] }, false],
        [{ errors: [{ ...rejection, cost: 0.001 }] }, false],
        [{ errors: [rejection, rejection] }, false],
        [{ error: "busy" }, false],
      ] as const) {
        const ledger = new RunwareSpendLedger(0.2);
        const onCapacityRefused = vi.fn(async () => {});
        const fetcher = vi.fn(
          async () =>
            new Response(JSON.stringify(body), {
              status,
              headers: { "retry-after": "60" },
            }),
        );
        const transport = new RunwarePromptHttpTransport({
          apiKey: "runware-test-key-at-least-twenty-characters",
          ledger,
          maximumRequestCostUsd: 0.1,
          fetch: fetcher,
          onCapacityRefused,
        });
        await expect(transport.dispatch(request)).resolves.toMatchObject({ status: "ambiguous" });
        await expect(transport.dispatch(request)).resolves.toMatchObject({ status: "ambiguous" });
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(onCapacityRefused).toHaveBeenCalledTimes(confirmed ? 1 : 0);
        expect(ledger.snapshot().reservedUsd).toBe(confirmed ? 0 : 0.1);
        if (confirmed)
          expect(onCapacityRefused).toHaveBeenCalledWith({
            taskUUID: request.request.taskUUID,
            responseHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
            retryAfterMs: 60_000,
          });
      }
    },
  );
  it("checks credits without inference and recognizes only an exact archived admission rejection", async () => {
    const apiKey = "runware-test-key-at-least-twenty-characters";
    for (const balance of [0.23815, { amount: 0.23815, currency: "USD" }]) {
      const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const [request] = JSON.parse(String(init?.body));
        expect(request).toMatchObject({ taskType: "accountManagement", operation: "getDetails" });
        return jsonResponse({ ...request, balance });
      });
      await expect(readRunwareCreditBalance(apiKey, fetcher)).resolves.toBe(0.23815);
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
    const taskUUID = "11111111-1111-4111-8111-111111111111";
    const originalRequest = [
      { taskType: "textInference", taskUUID, model: "google:gemini@3.5-flash" },
    ];
    const originalRequestBytes = canonicalizeJson(originalRequest);
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(originalRequestBytes),
    );
    const originalRequestSha256 =
      `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}` as const;
    const rejection = {
      code: "concurrentRequestLimitExceeded",
      taskType: "textInference",
      taskUUID,
    };
    for (const [response, rejected] of [
      [{ errors: [rejection] }, true],
      [{ errors: [{ ...rejection, taskUUID: crypto.randomUUID() }] }, false],
      [{ errors: [{ ...rejection, taskType: "imageInference" }] }, false],
      [{ errors: [rejection, rejection] }, false],
      [{ errors: [rejection], data: [] }, false],
      [{ status: "processing" }, false],
    ] as const) {
      const fetcher = vi.fn(async () =>
        jsonResponse({ taskType: "getTaskDetails", taskUUID, request: originalRequest, response }),
      );
      const result = retrieveRunwareTextTaskDetails({
        apiKey,
        originalTaskUUID: taskUUID,
        originalRequestBytes,
        originalRequestSha256,
        fetch: fetcher,
      });
      if (rejected) await expect(result).rejects.toBeInstanceOf(RunwareArchivedTaskRejectedError);
      else await expect(result).rejects.not.toBeInstanceOf(RunwareArchivedTaskRejectedError);
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
    await expect(
      readRunwareCreditBalance(apiKey, async () => jsonResponse({ balance: -1 })),
    ).rejects.toBeInstanceOf(RunwareTransportError);
  });
  it("retrieves one exact archived text result without redispatching inference", async () => {
    const originalRequest = [
      {
        taskType: "textInference",
        taskUUID: "11111111-1111-4111-8111-111111111111",
        model: "deepseek:v4@flash",
        includeCost: true,
        includeUsage: true,
      },
    ];
    const originalRequestBytes = canonicalizeJson(originalRequest);
    const originalRequestSha256 = `sha256:${await crypto.subtle
      .digest("SHA-256", new TextEncoder().encode(originalRequestBytes))
      .then((digest) =>
        [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
      )}` as const;
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual([
        {
          taskType: "getTaskDetails",
          taskUUID: "11111111-1111-4111-8111-111111111111",
        },
      ]);
      return jsonResponse({
        taskType: "getTaskDetails",
        taskUUID: "11111111-1111-4111-8111-111111111111",
        request: originalRequest,
        response: {
          data: [
            {
              taskType: "textInference",
              taskUUID: "11111111-1111-4111-8111-111111111111",
              model: "deepseek:v4@flash",
              text: '{"summary":"recovered"}',
              cost: 0.001,
              finishReason: "stop",
              usage: {
                promptTokens: 10,
                completionTokens: 20,
                totalTokens: 30,
                cachedInputTokens: 2,
              },
            },
          ],
        },
      });
    });

    await expect(
      retrieveRunwareTextTaskDetails({
        apiKey: "runware-test-key-at-least-twenty-characters",
        originalTaskUUID: "11111111-1111-4111-8111-111111111111",
        originalRequestBytes,
        originalRequestSha256,
        fetch,
      }),
    ).resolves.toMatchObject({
      taskUUID: "11111111-1111-4111-8111-111111111111",
      outputText: '{"summary":"recovered"}',
      costUsd: 0.001,
      finishReason: "stop",
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, cachedInputTokens: 2 },
      originalRequestBytes,
      originalRequestSha256,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("fails closed when archived task identity, request, or successful response drifts", async () => {
    const taskUUID = "11111111-1111-4111-8111-111111111111";
    const originalRequestBytes = canonicalizeJson([{ taskType: "textInference", taskUUID }]);
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(originalRequestBytes),
    );
    const originalRequestSha256 = `sha256:${[...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")}` as const;
    for (const details of [
      {
        taskType: "getTaskDetails",
        taskUUID,
        request: [{ taskType: "textInference", taskUUID, changed: true }],
        response: { data: [] },
      },
      {
        taskType: "getTaskDetails",
        taskUUID,
        request: JSON.parse(originalRequestBytes),
        response: {
          data: [
            {
              taskType: "textInference",
              taskUUID,
              text: "{}",
              cost: 0,
              finishReason: "length",
              usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
            },
          ],
        },
      },
    ]) {
      await expect(
        retrieveRunwareTextTaskDetails({
          apiKey: "runware-test-key-at-least-twenty-characters",
          originalTaskUUID: taskUUID,
          originalRequestBytes,
          originalRequestSha256,
          fetch: async () => jsonResponse(details),
        }),
      ).rejects.toBeInstanceOf(RunwareTransportError);
    }
  });

  it("classifies an identity-verified archived token limit as a terminal unusable result", async () => {
    const taskUUID = "11111111-1111-4111-8111-111111111111";
    const originalRequestBytes = canonicalizeJson([{ taskType: "textInference", taskUUID }]);
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(originalRequestBytes),
    );
    const originalRequestSha256 = `sha256:${[...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")}` as const;
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      jsonResponse({
        taskType: "getTaskDetails",
        taskUUID,
        request: JSON.parse(originalRequestBytes),
        response: {
          data: [
            {
              taskType: "textInference",
              taskUUID,
              text: '{"continuity":',
              cost: 0.00104765,
              finishReason: "length",
              usage: { promptTokens: 6777, completionTokens: 1200, totalTokens: 7977 },
            },
          ],
        },
      }),
    );
    await expect(
      retrieveRunwareTextTaskDetails({
        apiKey: "runware-test-key-at-least-twenty-characters",
        originalTaskUUID: taskUUID,
        originalRequestBytes,
        originalRequestSha256,
        fetch,
      }),
    ).rejects.toMatchObject({ code: "RUNWARE_TASK_PROVIDER_FAILED" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual([
      { taskType: "getTaskDetails", taskUUID },
    ]);
  });

  it("accepts provider-normalized archived request fields while preserving saved identity", async () => {
    const taskUUID = "11111111-1111-4111-8111-111111111111";
    const originalRequest = [
      {
        taskType: "textInference",
        taskUUID,
        model: "deepseek:v4@flash",
        outputFormat: "JSON",
        includeCost: true,
      },
    ];
    const originalRequestBytes = canonicalizeJson(originalRequest);
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(originalRequestBytes),
    );
    const originalRequestSha256 = `sha256:${[...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")}` as const;
    await expect(
      retrieveRunwareTextTaskDetails({
        apiKey: "runware-test-key-at-least-twenty-characters",
        originalTaskUUID: taskUUID,
        originalRequestBytes,
        originalRequestSha256,
        fetch: async () =>
          jsonResponse({
            taskType: "getTaskDetails",
            taskUUID,
            request: [{ taskType: "textInference", taskUUID, model: "deepseek:v4@flash" }],
            response: {
              data: [
                {
                  taskType: "textInference",
                  taskUUID,
                  model: "deepseek:v4@flash",
                  text: '{"summary":"recovered"}',
                  cost: 0.001,
                  finishReason: "stop",
                  usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
                },
              ],
            },
          }),
      }),
    ).resolves.toMatchObject({ originalRequestBytes, originalRequestSha256 });
  });

  it("uses the same text-result contract for live dispatch and archived recovery", async () => {
    const taskUUID = "11111111-1111-4111-8111-111111111111";
    const originalRequest = [{ taskType: "textInference", taskUUID }];
    const originalRequestBytes = canonicalizeJson(originalRequest);
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(originalRequestBytes),
    );
    const originalRequestSha256 = `sha256:${[...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")}` as const;
    const result = {
      taskUUID,
      text: '{"summary":"recovered"}',
      cost: 0.001,
      finishReason: "stop",
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    };
    await expect(
      retrieveRunwareTextTaskDetails({
        apiKey: "runware-test-key-at-least-twenty-characters",
        originalTaskUUID: taskUUID,
        originalRequestBytes,
        originalRequestSha256,
        fetch: async () =>
          jsonResponse({
            taskType: "getTaskDetails",
            taskUUID,
            request: originalRequest,
            response: { data: [result] },
          }),
      }),
    ).resolves.toMatchObject({ outputText: result.text, costUsd: result.cost });
  });

  it("classifies exact archived provider failure and rejects identity/mixed-response drift", async () => {
    const taskUUID = "11111111-1111-4111-8111-111111111111";
    const originalRequest = [{ taskType: "textInference", taskUUID }];
    const originalRequestBytes = canonicalizeJson(originalRequest);
    const originalRequestSha256 = `sha256:${await crypto.subtle
      .digest("SHA-256", new TextEncoder().encode(originalRequestBytes))
      .then((digest) =>
        [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
      )}` as `sha256:${string}`;
    const archivedProviderFailure = {
      taskType: "textInference",
      taskUUID,
      errors: {
        errorCode: "providerUnavailable",
        additionalDetails: {
          responseStatusCode: 502,
          responseContent: "<html>nginx 502</html>",
          _provider: "runware-deepseek-v4-flash",
        },
      },
    };
    const diagnostic = vi.fn();
    const recover = (
      response: Record<string, unknown>,
      onDiagnostic?: typeof diagnostic,
      outerResponseFields: Record<string, unknown> = {},
    ) =>
      retrieveRunwareTextTaskDetails({
        apiKey: "runware-test-key-at-least-twenty-characters",
        originalTaskUUID: taskUUID,
        originalRequestBytes,
        originalRequestSha256,
        fetch: async () =>
          jsonResponse({
            taskType: "getTaskDetails",
            taskUUID,
            request: originalRequest,
            response: {
              response,
              connectionSessionUUID: "session-uuid",
              ...outerResponseFields,
            },
          }),
        onDiagnostic,
      });

    await expect(recover(archivedProviderFailure, diagnostic)).rejects.toMatchObject({
      code: "RUNWARE_TASK_PROVIDER_FAILED",
    });
    expect(diagnostic).toHaveBeenCalledWith({
      stage: "response",
      httpStatus: 502,
      providerCode: "providerUnavailable",
      providerParameter: null,
    });

    await expect(
      recover({ ...archivedProviderFailure, taskUUID: "22222222-2222-4222-8222-222222222222" }),
    ).rejects.toMatchObject({ code: "RUNWARE_RESPONSE_INVALID" });

    await expect(
      recover(archivedProviderFailure, undefined, {
        data: [
          {
            taskType: "textInference",
            taskUUID,
            text: "{}",
            cost: 0,
            finishReason: "stop",
            usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "RUNWARE_RESPONSE_INVALID" });

    await expect(
      recover({
        ...archivedProviderFailure,
        data: [
          {
            taskType: "textInference",
            taskUUID,
            text: "{}",
            cost: 0,
            finishReason: "stop",
            usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "RUNWARE_RESPONSE_INVALID" });
  });

  it("reports archived task-not-found without attempting inference", async () => {
    const taskUUID = "11111111-1111-4111-8111-111111111111";
    const originalRequestBytes = canonicalizeJson([{ taskType: "textInference", taskUUID }]);
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(originalRequestBytes),
    );
    const originalRequestSha256 = `sha256:${[...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")}` as const;
    await expect(
      retrieveRunwareTextTaskDetails({
        apiKey: "runware-test-key-at-least-twenty-characters",
        originalTaskUUID: taskUUID,
        originalRequestBytes,
        originalRequestSha256,
        fetch: async () =>
          new Response(JSON.stringify({ data: [], errors: [{ code: "taskNotFound", taskUUID }] }), {
            status: 404,
          }),
      }),
    ).rejects.toMatchObject({ code: "RUNWARE_TASK_NOT_FOUND" });
  });

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

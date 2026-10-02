// @vitest-environment node
import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import type { HostedR2BucketBinding } from "../hosted/configuration";
import { observeRunwareSeedanceJob, submitRunwareSeedanceJob } from "./runware-seedance-job";

const taskUUID = "764cabcf-b745-4b3e-ae38-1200304cf45b";
const videoUUID = "b7db282d-2943-4f12-992f-77df3ad3ec71";
const objectKey = "tenant/account/workspace/workspace/project/project/revision/revision/lane/scene-video/job/attempt/artifact/clip";
const apiKey = "fixture-private-api-key-not-real";
const completed = { taskType: "videoInference", taskUUID, status: "success", videoUUID,
  videoURL: `https://vm.runware.ai/video/os/test/vi/${videoUUID}.mp4`, cost: 0.016032 };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const submission = () => ({ taskUUID, apiKey, imageUrl: "https://private.example/source",
  prompt: "Single documentary shot with natural movement. No text overlays or transitions.", durationSeconds: 1.2,
  claimSubmission: vi.fn(async () => true), persistRequestId: vi.fn(async () => undefined),
  markSubmissionFailed: vi.fn(async () => undefined), markSubmissionUnknown: vi.fn(async () => undefined) });

describe("Runware Seedance durable job", () => {
  it("claims the UUID before exactly one paid POST and never replays an ambiguous response", async () => {
    const input = submission();
    const order: string[] = [];
    input.claimSubmission = vi.fn(async () => { order.push("claim saved UUID"); return true; });
    input.markSubmissionUnknown = vi.fn(async () => { order.push("unknown"); });
    const fetchPort = vi.fn(async () => { order.push("post"); throw new Error("reply lost"); });
    await expect(submitRunwareSeedanceJob({ ...input, fetchPort })).rejects.toMatchObject({ code: "SUBMIT_UNKNOWN" });
    expect(order).toEqual(["claim saved UUID", "post", "unknown"]);
    input.claimSubmission.mockResolvedValue(false);
    expect(await submitRunwareSeedanceJob({ ...input, fetchPort })).toEqual({ state: "NOT_CLAIMED" });
    expect(fetchPort).toHaveBeenCalledTimes(1);
    expect(input.persistRequestId).not.toHaveBeenCalled();
  });

  it("submits the pinned model/geometry asynchronously and distinguishes definite rejection", async () => {
    const input = submission();
    const fetchPort = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => json({ data: [{ taskType: "videoInference", taskUUID }] }));
    expect(await submitRunwareSeedanceJob({ ...input, fetchPort })).toMatchObject({ state: "SUBMITTED", requestId: taskUUID });
    const init = fetchPort.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(JSON.parse(String(init?.body))[0]).toMatchObject({ taskType: "videoInference", taskUUID,
      model: "bytedance:2@2", width: 1248, height: 704, duration: 1.2, deliveryMethod: "async",
      includeCost: true, numberResults: 1, inputs: { frameImages: [input.imageUrl] } });
    expect(input.persistRequestId).toHaveBeenCalledWith(taskUUID);
    await expect(submitRunwareSeedanceJob({ ...input,
      fetchPort: async () => json({ errors: [{ taskUUID, code: "invalidDuration" }] }, 400),
    })).rejects.toMatchObject({ code: "SUBMIT_REJECTED" });
    expect(input.markSubmissionFailed).toHaveBeenCalledTimes(1);
    expect(input.markSubmissionUnknown).not.toHaveBeenCalled();
  });

  it("accepts only exact scoped HTTP200 validation refusals as definite rejection", async () => {
    const refusal = { taskUUID, taskType: "videoInference", status: "error",
      code: "invalidDuration", parameter: "duration" };
    const input = submission();
    await expect(submitRunwareSeedanceJob({ ...input,
      fetchPort: async () => json({ errors: [refusal] }),
    })).rejects.toMatchObject({ code: "SUBMIT_REJECTED" });
    expect(input.markSubmissionFailed).toHaveBeenCalledTimes(1);
    expect(input.markSubmissionUnknown).not.toHaveBeenCalled();
    for (const error of [{ ...refusal, taskUUID: videoUUID }, { ...refusal, taskType: "getResponse" },
      { ...refusal, code: "timeoutProvider" }, { ...refusal, parameter: "response" },
      { ...refusal, cost: 0.01 }]) {
      const ambiguous = submission();
      await expect(submitRunwareSeedanceJob({ ...ambiguous,
        fetchPort: async () => json({ errors: [error] }),
      })).rejects.toMatchObject({ code: "SUBMIT_UNKNOWN" });
      expect(ambiguous.markSubmissionFailed).not.toHaveBeenCalled();
      expect(ambiguous.markSubmissionUnknown).toHaveBeenCalledTimes(1);
    }
  });

  it("reports bounded submission diagnostics without exposing provider bodies or transport messages", async () => {
    const privateMessage = "sensitive-provider-body-or-url";
    const cases = [
      { fetchPort: async () => { throw new Error(privateMessage); }, diagnostic: { kind: "TRANSPORT_ERROR" } },
      { fetchPort: async () => new Response(privateMessage, { status: 502 }), diagnostic: { kind: "INVALID_JSON", httpStatus: 502 } },
      { fetchPort: async () => json([]), diagnostic: { kind: "RESPONSE_SHAPE", httpStatus: 200 } },
      { fetchPort: async () => json({ errors: [{ message: privateMessage }] }, 429), diagnostic: { kind: "HTTP_ERROR", httpStatus: 429 } },
      { fetchPort: async () => json({ data: [{ taskType: "getResponse", taskUUID, message: privateMessage }] }), diagnostic: { kind: "ACK_IDENTITY", httpStatus: 200 } },
    ];
    for (const test of cases) {
      const input = submission();
      const error = await submitRunwareSeedanceJob({ ...input, fetchPort: test.fetchPort }).catch((error: unknown) => error);
      expect(error).toMatchObject({ code: "SUBMIT_UNKNOWN", submissionDiagnostic: test.diagnostic });
      expect(JSON.stringify(error)).not.toContain(privateMessage);
      expect(input.markSubmissionUnknown).toHaveBeenCalledTimes(1);
      expect(input.markSubmissionFailed).not.toHaveBeenCalled();
      expect(input.persistRequestId).not.toHaveBeenCalled();
    }
  });

  it("rejects invalid duration/prompt before claiming or making a paid request", async () => {
    const input = submission();
    const fetchPort = vi.fn();
    for (const durationSeconds of [NaN, 0, 1.19, 12.01]) {
      await expect(submitRunwareSeedanceJob({ ...input, durationSeconds, fetchPort })).rejects.toMatchObject({ code: "INPUT_INVALID" });
    }
    await expect(submitRunwareSeedanceJob({ ...input, prompt: "x".repeat(3001), fetchPort })).rejects.toMatchObject({ code: "INPUT_INVALID" });
    expect(input.claimSubmission).not.toHaveBeenCalled();
    expect(fetchPort).not.toHaveBeenCalled();
  });

  it("polls the exact saved UUID and rejects mismatched identities, models and cost", async () => {
    const input = { requestId: taskUUID, apiKey, objectKey, durationSeconds: 1.2,
      bucket: {} as HostedR2BucketBinding };
    for (const result of [{ ...completed, taskUUID: videoUUID }, { ...completed, model: "other:model" },
      { ...completed, cost: "0.1" }, { ...completed, cost: -1 }, { ...completed, cost: null }]) {
      await expect(observeRunwareSeedanceJob({ ...input, fetchPort: async () => json({ data: [result] }) }))
        .rejects.toMatchObject({ code: "RESPONSE_INVALID" });
    }
    const fetchPort = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => json({ data: [{ taskType: "videoInference", taskUUID, status: "processing" }] }));
    expect(await observeRunwareSeedanceJob({ ...input, fetchPort })).toEqual({ state: "PENDING", submissionConfirmed: true });
    expect(JSON.parse(String((fetchPort.mock.calls[0]?.[1] as RequestInit)?.body)))
      .toEqual([{ taskType: "getResponse", taskUUID }]);
    expect(await observeRunwareSeedanceJob({ ...input,
      fetchPort: async () => json({ errors: [{ taskUUID, code: "timeoutProvider", status: "error" }] }),
    })).toEqual({ state: "FAILED" });
    await expect(observeRunwareSeedanceJob({ ...input,
      fetchPort: async () => json({ errors: [{ taskUUID, code: "taskNotFound", status: "error" }] }),
    })).rejects.toMatchObject({ code: "POLL_UNAVAILABLE" });
  });

  it("accepts the live getResponse processing envelope without weakening successful-video identity", async () => {
    const requestId = "5b731319-4f67-432b-8953-ee71a19893ed";
    const processing = { taskUUID: requestId, status: "processing", taskType: "getResponse" };
    const recordProviderCost = vi.fn(async () => undefined);
    const bucket = { get: vi.fn(), put: vi.fn() } as unknown as HostedR2BucketBinding;
    const input = { requestId, apiKey, objectKey, durationSeconds: 1.2, bucket, recordProviderCost };
    const fetchPort = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => json({ data: [processing] }));
    expect(await observeRunwareSeedanceJob({ ...input, fetchPort })).toEqual({ state: "PENDING", submissionConfirmed: false });
    expect(JSON.parse(String(fetchPort.mock.calls[0]?.[1]?.body))).toEqual([{ taskType: "getResponse", taskUUID: requestId }]);
    for (const result of [{ ...processing, taskUUID }, { ...processing, model: "other:model" },
      { ...processing, taskType: "imageInference" }, { ...completed, taskUUID: requestId, taskType: "getResponse" }]) {
      await expect(observeRunwareSeedanceJob({ ...input,
        fetchPort: async () => json({ data: [result] }),
      })).rejects.toMatchObject({ code: "RESPONSE_INVALID" });
    }
    await expect(observeRunwareSeedanceJob({ ...input,
      fetchPort: async () => json({ data: [processing] }, 202),
    })).rejects.toMatchObject({ code: "RESPONSE_INVALID" });
    expect(recordProviderCost).not.toHaveBeenCalled();
    expect(bucket.get).not.toHaveBeenCalled(); expect(bucket.put).not.toHaveBeenCalled();
  });

  it("accepts a real H264 clip with an immutable exact private receipt and reuses it without downloading", async () => {
    const bytes = Uint8Array.from(await readFile(new URL("./fixtures/h264-seedance-sample.mp4", import.meta.url)));
    let stored: Uint8Array | null = null;
    let receipt: Record<string, string> | undefined;
    const bucket = {
      get: async () => stored && { size: stored.byteLength, httpMetadata: { contentType: "video/mp4" },
        customMetadata: receipt, arrayBuffer: async () => stored!.buffer.slice(0) },
      put: vi.fn(async (_key: string, value: ArrayBuffer, options: { customMetadata: Record<string, string> }) => {
        stored = new Uint8Array(value); receipt = options.customMetadata;
      }),
    } as unknown as HostedR2BucketBinding;
    // The official Fast examples return a completed videoInference receipt without status.
    const { status: _status, ...documentedReceipt } = completed;
    const fetchPort = vi.fn(async (url: string | URL | Request) => String(url).includes("api.runware.ai")
      ? json({ data: [documentedReceipt] })
      : new Response(bytes, { headers: { "content-type": "video/mp4", "content-length": String(bytes.byteLength) } }));
    const input = { requestId: taskUUID, apiKey, objectKey, durationSeconds: 1.2, bucket, fetchPort };
    const first = await observeRunwareSeedanceJob(input);
    expect(first).toMatchObject({ state: "SUCCEEDED", costUsd: completed.cost,
      artifact: { objectKey, width: 1248, height: 704, videoCodec: "h264", byteSize: bytes.byteLength } });
    expect(bucket.put).toHaveBeenCalledWith(objectKey, expect.any(ArrayBuffer), expect.objectContaining({
      onlyIf: { etagDoesNotMatch: "*" }, customMetadata: expect.objectContaining({ taskUUID, costUsd: String(completed.cost) }),
    }));
    expect(await observeRunwareSeedanceJob(input)).toEqual(first);
    expect(fetchPort.mock.calls.filter(([url]) => !String(url).includes("api.runware.ai"))).toHaveLength(1);
    receipt!.taskUUID = videoUUID;
    await expect(observeRunwareSeedanceJob(input)).rejects.toMatchObject({ code: "RESULT_STORAGE_UNKNOWN" });
  });

  it("requires complete media identity and exact scope before accepting an absent-status receipt", async () => {
    const { status: _status, ...documentedReceipt } = completed;
    const recordProviderCost = vi.fn(async () => undefined);
    const bucket = { get: vi.fn(), put: vi.fn() } as unknown as HostedR2BucketBinding;
    const input = { requestId: taskUUID, apiKey, objectKey, durationSeconds: 1.2, bucket, recordProviderCost };
    for (const result of [{ ...documentedReceipt, taskUUID: videoUUID },
      { ...documentedReceipt, model: "other:model" }, { ...documentedReceipt, taskType: "getResponse" },
      { ...documentedReceipt, status: null }, { ...documentedReceipt, videoUUID: undefined },
      { ...documentedReceipt, videoURL: undefined }, { ...documentedReceipt, videoURL: "http://vm.runware.ai/video/clip.mp4" },
      { ...documentedReceipt, cost: undefined }, { ...documentedReceipt, cost: "0.1" }]) {
      await expect(observeRunwareSeedanceJob({ ...input, fetchPort: async () => json({ data: [result] }) }))
        .rejects.toMatchObject({ code: "RESPONSE_INVALID" });
    }
    expect(recordProviderCost).not.toHaveBeenCalled();
    expect(bucket.get).not.toHaveBeenCalled(); expect(bucket.put).not.toHaveBeenCalled();
  });

  it("persists a validated provider charge before artifact acceptance and preserves receipt errors", async () => {
    const order: string[] = [];
    const input = { requestId: taskUUID, apiKey, objectKey, durationSeconds: 1.2,
      bucket: { get: async () => null, put: vi.fn() } as unknown as HostedR2BucketBinding,
      recordProviderCost: vi.fn(async (cost: number) => { order.push(`cost:${cost}`); }),
      fetchPort: async (url: string | URL | Request) => {
        if (String(url).includes("api.runware.ai")) return json({ data: [completed] });
        order.push("download");
        return new Response(new Uint8Array(100), { headers: { "content-type": "video/mp4" } });
      } };
    await expect(observeRunwareSeedanceJob(input)).rejects.toMatchObject({ code: "RESULT_MP4_INVALID" });
    expect(order).toEqual([`cost:${completed.cost}`, "download"]);
    const receiptFailure = new Error("database unavailable");
    await expect(observeRunwareSeedanceJob({ ...input,
      recordProviderCost: async () => { throw receiptFailure; },
    })).rejects.toBe(receiptFailure);
    expect(order).toHaveLength(2);
    const recordProviderCost = vi.fn(async () => undefined);
    await expect(observeRunwareSeedanceJob({ ...input, recordProviderCost,
      fetchPort: async () => json({ data: [{ ...completed, taskUUID: videoUUID }] }),
    })).rejects.toMatchObject({ code: "RESPONSE_INVALID" });
    expect(recordProviderCost).not.toHaveBeenCalled();
    for (const result of [{ ...completed, videoUUID: "invalid" }, { ...completed, videoURL: null },
      { ...completed, NSFWContent: true }]) {
      await expect(observeRunwareSeedanceJob({ ...input, recordProviderCost,
        fetchPort: async () => json({ data: [result] }),
      })).rejects.toMatchObject({ code: "RESULT_MP4_INVALID" });
    }
    expect(recordProviderCost).toHaveBeenCalledTimes(3);
  });

  it("records an unexpectedly large charge before terminal price failure without downloading", async () => {
    const recordProviderCost = vi.fn(async () => undefined);
    const bucket = { get: vi.fn(), put: vi.fn() } as unknown as HostedR2BucketBinding;
    const fetchPort = vi.fn(async () => json({ data: [{ ...completed, cost: 1.25 }] }));
    const input = { requestId: taskUUID, apiKey, objectKey, durationSeconds: 1.2,
      bucket, recordProviderCost, fetchPort };
    await expect(observeRunwareSeedanceJob(input)).rejects.toMatchObject({ code: "RESULT_PRICE_CHANGED" });
    expect(recordProviderCost).toHaveBeenCalledWith(1.25);
    expect(fetchPort).toHaveBeenCalledTimes(1);
    expect(bucket.get).not.toHaveBeenCalled(); expect(bucket.put).not.toHaveBeenCalled();
    fetchPort.mockResolvedValueOnce(json({ data: [{ ...completed, taskUUID: videoUUID, cost: 1.25 }] }));
    await expect(observeRunwareSeedanceJob(input)).rejects.toMatchObject({ code: "RESPONSE_INVALID" });
    expect(recordProviderCost).toHaveBeenCalledTimes(1);
    const costDrift = new Error("video cost replay drift");
    recordProviderCost.mockRejectedValueOnce(costDrift);
    fetchPort.mockResolvedValueOnce(json({ data: [{ ...completed, cost: 1.26 }] }));
    await expect(observeRunwareSeedanceJob(input)).rejects.toBe(costDrift);
    expect(bucket.get).not.toHaveBeenCalled(); expect(bucket.put).not.toHaveBeenCalled();
  });

  it("refuses arbitrary hosts, redirects, oversized downloads, wrong geometry and short clips", async () => {
    const bytes = Uint8Array.from(await readFile(new URL("./fixtures/h264-square-sample.mp4", import.meta.url)));
    const seedanceBytes = Uint8Array.from(await readFile(new URL("./fixtures/h264-seedance-sample.mp4", import.meta.url)));
    const input = { requestId: taskUUID, apiKey, objectKey, durationSeconds: 1.2,
      bucket: { get: async () => null, put: vi.fn() } as unknown as HostedR2BucketBinding };
    const cases = [
      { videoURL: "https://private.example/video.mp4", reply: new Response(bytes), code: "RESULT_MP4_INVALID" },
      { videoURL: completed.videoURL, reply: new Response(null, { status: 302, headers: { location: "https://other.example" } }), code: "RESULT_DOWNLOAD_FAILED" },
      { videoURL: completed.videoURL, reply: new Response(bytes, { headers: { "content-type": "video/mp4", "content-length": String(33 * 1024 * 1024) } }), code: "RESULT_MP4_INVALID" },
      { videoURL: completed.videoURL, reply: new Response(bytes, { headers: { "content-type": "video/mp4" } }), code: "RESULT_MP4_INVALID" },
    ];
    for (const test of cases) {
      const fetchPort = vi.fn(async (url: string | URL | Request) => String(url).includes("api.runware.ai")
        ? json({ data: [{ ...completed, videoURL: test.videoURL }] }) : test.reply);
      await expect(observeRunwareSeedanceJob({ ...input, fetchPort })).rejects.toMatchObject({ code: test.code });
    }
    await expect(observeRunwareSeedanceJob({ ...input, durationSeconds: 2,
      fetchPort: async (url) => String(url).includes("api.runware.ai") ? json({ data: [completed] })
        : new Response(seedanceBytes, { headers: { "content-type": "video/mp4" } }),
    })).rejects.toMatchObject({ code: "RESULT_MP4_INVALID" });
    let cancelled = false;
    let chunks = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { chunks++; controller.enqueue(new Uint8Array(1024 * 1024)); },
      cancel() { cancelled = true; },
    });
    await expect(observeRunwareSeedanceJob({ ...input,
      fetchPort: async (url) => String(url).includes("api.runware.ai") ? json({ data: [completed] })
        : new Response(stream, { headers: { "content-type": "video/mp4" } }),
    })).rejects.toMatchObject({ code: "RESULT_MP4_INVALID" });
    expect(cancelled).toBe(true);
    expect(chunks).toBeLessThanOrEqual(34);
    expect(input.bucket.put).not.toHaveBeenCalled();
  });
});

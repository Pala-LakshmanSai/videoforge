import { describe, expect, it, vi } from "vitest";
import { isFalCapacityRefusal, providerRetryAfterMs } from "./provider-throttle";
import { KieZImageClient } from "./kie-z-image";
import { FalFlashheadClient } from "./fal-flashhead-client";
import { FalZImageClient } from "./fal-z-image";
import { submitKieImageJob } from "./kie-image-job";
import { submitFalAvatarJob } from "./fal-avatar-job";
import { submitRunwareSeedanceJob } from "./runware-seedance-job";

const refusal = (body: unknown, headers: Record<string, string> = {}, status = 429) =>
  new Response(JSON.stringify(body), { status, headers });
const falRefusal = () =>
  refusal(
    { detail: [{ type: "concurrent_requests_limit" }] },
    { "X-Fal-needs-retry": "1", "Retry-After": "45" },
  );

describe("durable throttle boundary", () => {
  it("bounds scheduling hints and accepts seconds or HTTP dates without guessing malformed values", () => {
    const now = Date.parse("2026-10-04T12:00:00Z");
    expect(providerRetryAfterMs("45", now)).toBe(45_000);
    expect(providerRetryAfterMs("Sun, 04 Oct 2026 12:02:00 GMT", now)).toBe(120_000);
    expect(providerRetryAfterMs("0", now)).toBe(1000);
    expect(providerRetryAfterMs("9999999999", now)).toBe(86_400_000);
    for (const value of [null, "", "-1", "1.5", "NaN", "tomorrow"])
      expect(providerRetryAfterMs(value, now)).toBe(30_000);
  });

  it("does not call an untyped Fal error or accepted request retryable", async () => {
    expect(await isFalCapacityRefusal(falRefusal())).toBe(true);
    for (const body of [
      {},
      { type: "unknown" },
      { type: "concurrent_requests_limit", request_id: "accepted" },
      { type: "concurrent_requests_limit", data: [{ request_id: "accepted" }] },
    ])
      expect(await isFalCapacityRefusal(refusal(body, { "X-Fal-needs-retry": "1" }))).toBe(false);
    expect(await isFalCapacityRefusal(refusal({ type: "concurrent_requests_limit" }))).toBe(false);
  });

  it("persists Kie rejection before returning waiting and never retries inside the adapter", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(refusal({}, { "Retry-After": "45" }));
    const markRateLimited = vi.fn(async () => undefined);
    const markSubmissionUnknown = vi.fn(async () => undefined);
    const markRequestRejected = vi.fn(async () => undefined);
    const input = {
      manifest: { prompt: "Mountain", aspectRatio: "16:9" as const },
      client: new KieZImageClient("fixture", fetcher),
      claimSubmission: async () => true,
      persistTaskId: vi.fn(async () => undefined),
      markRateLimited,
      markSubmissionUnknown,
      markRequestRejected,
    };
    expect(await submitKieImageJob(input)).toEqual({ state: "NOT_CLAIMED" });
    expect(markRateLimited).toHaveBeenCalledWith(45_000);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(markRequestRejected).not.toHaveBeenCalled();
    expect(markSubmissionUnknown).not.toHaveBeenCalled();
    markRateLimited.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(submitKieImageJob(input)).rejects.toThrow("database unavailable");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(input.persistTaskId).not.toHaveBeenCalled();
  });

  it("defers positively rejected Fal avatar and regeneration calls, preserving untyped429 uncertainty", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => falRefusal());
    const markRateLimited = vi.fn(async () => undefined);
    const markSubmissionUnknown = vi.fn(async () => undefined);
    const avatar = {
      imageUrl: "https://private.example/image",
      audioUrl: "https://private.example/audio",
      client: new FalFlashheadClient("fixture", fetcher),
      claimSubmission: async () => true,
      persistRequestId: vi.fn(async () => undefined),
      markRateLimited,
      markSubmissionFailed: vi.fn(async () => undefined),
      markSubmissionUnknown,
    };
    expect(await submitFalAvatarJob(avatar)).toEqual({ state: "NOT_CLAIMED" });
    expect(markRateLimited).toHaveBeenCalledWith(45_000);
    await expect(
      new FalZImageClient("fixture", fetcher).create({ prompt: "Mountain", aspectRatio: "16:9" }),
    ).rejects.toMatchObject({ code: "RATE_LIMITED", retryAfterMs: 45_000 });
    fetcher.mockImplementation(async () => refusal({}));
    await expect(submitFalAvatarJob(avatar)).rejects.toMatchObject({ code: "SUBMIT_UNKNOWN" });
    expect(markSubmissionUnknown).toHaveBeenCalledOnce();
    expect(markRateLimited).toHaveBeenCalledOnce();
  });

  it("only defers a Runware429 tied to the exact uncharged task", async () => {
    const taskUUID = "764cabcf-b745-4b3e-ae38-1200304cf45b";
    const markRateLimited = vi.fn(async () => undefined);
    const markSubmissionUnknown = vi.fn(async () => undefined);
    const input = {
      taskUUID,
      apiKey: "fixture-private-key-not-real",
      imageUrl: "https://private.example/image",
      prompt: "Mountain clouds moving slowly.",
      durationSeconds: 1.2,
      claimSubmission: async () => true,
      persistRequestId: vi.fn(async () => undefined),
      markRateLimited,
      markSubmissionUnknown,
      markSubmissionFailed: vi.fn(async () => undefined),
    };
    const fetchPort = vi.fn(async () =>
      refusal(
        {
          errors: [
            { taskUUID, taskType: "videoInference", code: "concurrentRequestLimitExceeded" },
          ],
        },
        { "Retry-After": "60" },
      ),
    );
    expect(await submitRunwareSeedanceJob({ ...input, fetchPort })).toEqual({
      state: "NOT_CLAIMED",
    });
    expect(markRateLimited).toHaveBeenCalledWith(60_000);
    expect(fetchPort).toHaveBeenCalledOnce();
    for (const body of [
      { errors: [{ taskUUID: "foreign" }] },
      { errors: [{ taskUUID, taskType: "videoInference" }] },
      { errors: [{ taskUUID, taskType: "videoInference", code: "different_error" }] },
      { errors: [{ taskUUID, code: "concurrentRequestLimitExceeded" }] },
      { errors: [{ taskUUID, cost: 0.01 }] },
      { errors: [{ taskUUID }], data: [{ taskUUID, taskType: "videoInference" }] },
    ]) {
      await expect(
        submitRunwareSeedanceJob({ ...input, fetchPort: async () => refusal(body) }),
      ).rejects.toMatchObject({ code: "SUBMIT_UNKNOWN" });
    }
    expect(markRateLimited).toHaveBeenCalledOnce();
    expect(markSubmissionUnknown).toHaveBeenCalledTimes(6);
  });
});

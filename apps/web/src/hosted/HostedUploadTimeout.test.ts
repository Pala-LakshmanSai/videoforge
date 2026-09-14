import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HOSTED_UPLOAD_TIMEOUT_MS,
  putHostedUpload,
  type HostedUploadDescriptor,
} from "./HostedProductScreens";

const upload: HostedUploadDescriptor = {
  url: "https://uploads.example.invalid/reference-01",
  requiredHeaders: {
    "content-length": "4",
    "content-type": "image/png",
    "x-amz-checksum-sha256": `sha256:${"a".repeat(64)}`,
  },
};
const file = new File(["test"], "reference.png", { type: "image/png" });

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("hosted preset uploads", () => {
  it("allows a transfer longer than the former 30-second deadline", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          setTimeout(() => resolve(new Response(null, { status: 200 })), 31_000);
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const pending = putHostedUpload(upload, file);
    await vi.advanceTimersByTimeAsync(31_000);
    await expect(pending).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledWith(
      upload.url,
      expect.objectContaining({
        method: "PUT",
        headers: {
          "content-type": "image/png",
          "x-amz-checksum-sha256": `sha256:${"a".repeat(64)}`,
        },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("aborts a stalled transfer at its finite deadline", async () => {
    vi.useFakeTimers();
    let aborted = false;
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => {
              aborted = true;
              reject(new DOMException("The operation was aborted.", "AbortError"));
            },
            { once: true },
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const pending = putHostedUpload(upload, file);
    const rejection = expect(pending).rejects.toThrow("Private upload timed out. Retry this step.");
    await vi.advanceTimersByTimeAsync(HOSTED_UPLOAD_TIMEOUT_MS);
    await rejection;

    expect(aborted).toBe(true);
  });

  it("preserves HTTP upload failures", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(putHostedUpload(upload, file)).rejects.toThrow(
      "Private upload failed (HTTP 503).",
    );
  });
});

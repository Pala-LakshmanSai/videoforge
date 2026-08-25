import { ServerlessTransportError, type ServerlessRunRequest } from "@videoforge/control-plane";
import { describe, expect, it, vi } from "vitest";

import { RunPodControlError, type RunPodJobResult } from "./runpod-control";
import { RunPodServerlessTransport } from "./runpod-serverless-transport";

const ENDPOINT_SHA256 = `sha256:${"a".repeat(64)}` as ServerlessRunRequest["endpointIdSha256"];
const REQUEST_SHA256 = `sha256:${"b".repeat(64)}` as ServerlessRunRequest["requestBodySha256"];

function job(status = "IN_QUEUE", id = "job_01"): RunPodJobResult {
  return {
    id,
    idHash: `sha256:${"c".repeat(64)}`,
    status,
    executionTimeMs: null,
    delayTimeMs: null,
  };
}

function request(
  endpointIdSha256: ServerlessRunRequest["endpointIdSha256"] = ENDPOINT_SHA256,
): ServerlessRunRequest {
  return {
    endpointIdSha256,
    dispatchToken: "dt-0123456789abcdef0123456789abcdef0123456789abcdef",
    requestBodySha256: REQUEST_SHA256,
    envelope: Object.freeze({ schema: "serverless-worker-job-envelope/v3", items: ["scene-1"] }),
  } as const;
}

function client() {
  return {
    dispatch: vi.fn(async () => job()),
    status: vi.fn(async () => job()),
    cancel: vi.fn(async () => job("CANCELLED")),
  };
}

describe("provider-neutral RunPod Serverless transport", () => {
  it("dispatches once with the durable token and exact envelope", async () => {
    const port = client();
    const transport = new RunPodServerlessTransport(port, ENDPOINT_SHA256);

    await expect(transport.run(request())).resolves.toEqual({ id: "job_01" });
    expect(port.dispatch).toHaveBeenCalledTimes(1);
    expect(port.dispatch).toHaveBeenCalledWith(request().dispatchToken, request().envelope);
  });

  it("rejects endpoint drift before any provider request", async () => {
    const port = client();
    const transport = new RunPodServerlessTransport(port, ENDPOINT_SHA256);

    await expect(
      transport.run(
        request(`sha256:${"d".repeat(64)}` as ServerlessRunRequest["endpointIdSha256"]),
      ),
    ).rejects.toMatchObject({
      code: "REQUEST_REJECTED",
    });
    expect(port.dispatch).not.toHaveBeenCalled();
  });

  it("maps only an ambiguous run mutation to DISPATCH_ACK_UNKNOWN", async () => {
    const ambiguous = client();
    ambiguous.dispatch.mockRejectedValueOnce(new RunPodControlError("RUNPOD_MUTATION_AMBIGUOUS"));
    await expect(
      new RunPodServerlessTransport(ambiguous, ENDPOINT_SHA256).run(request()),
    ).rejects.toMatchObject({ code: "DISPATCH_ACK_UNKNOWN" });

    const rejected = client();
    rejected.dispatch.mockRejectedValueOnce(new RunPodControlError("RUNPOD_AUTH_REJECTED"));
    await expect(
      new RunPodServerlessTransport(rejected, ENDPOINT_SHA256).run(request()),
    ).rejects.toMatchObject({ code: "REQUEST_REJECTED" });
  });

  it("treats an unusable dispatch response as unknown acknowledgement after mutation", async () => {
    for (const code of ["RUNPOD_RESPONSE_INVALID", "RUNPOD_MUTATION_FAILED"]) {
      const port = client();
      port.dispatch.mockRejectedValueOnce(new RunPodControlError(code));

      await expect(
        new RunPodServerlessTransport(port, ENDPOINT_SHA256).run(request()),
      ).rejects.toMatchObject({ code: "DISPATCH_ACK_UNKNOWN" });
      expect(port.dispatch).toHaveBeenCalledTimes(1);
    }
  });

  it("treats an unexpected post-dispatch exception as acknowledgement unknown", async () => {
    const port = client();
    port.dispatch.mockRejectedValueOnce(new Error("unexpected network failure"));
    await expect(
      new RunPodServerlessTransport(port, ENDPOINT_SHA256).run(request()),
    ).rejects.toMatchObject({ code: "DISPATCH_ACK_UNKNOWN" });
  });

  it("requires exact status identity and maps read ambiguity without inventing terminal state", async () => {
    const mismatch = client();
    mismatch.status.mockResolvedValueOnce(job("COMPLETED", "foreign_job"));
    await expect(
      new RunPodServerlessTransport(mismatch, ENDPOINT_SHA256).status("job_01"),
    ).rejects.toMatchObject({ code: "PROVIDER_JOB_UNKNOWN" });

    const unknown = client();
    unknown.status.mockRejectedValueOnce(new RunPodControlError("RUNPOD_READ_AMBIGUOUS"));
    await expect(
      new RunPodServerlessTransport(unknown, ENDPOINT_SHA256).status("job_01"),
    ).rejects.toMatchObject({ code: "STATUS_UNKNOWN" });
  });

  it("cancels only the exact job and preserves uncertain cancellation", async () => {
    const port = client();
    const transport = new RunPodServerlessTransport(port, ENDPOINT_SHA256);
    await expect(transport.cancel("job_01")).resolves.toEqual({
      id: "job_01",
      status: "CANCELLED",
    });
    expect(port.cancel).toHaveBeenCalledTimes(1);
    expect(port.cancel).toHaveBeenCalledWith("job_01");

    port.cancel.mockRejectedValueOnce(new RunPodControlError("RUNPOD_CANCEL_UNCONFIRMED"));
    await expect(transport.cancel("job_01")).rejects.toMatchObject({ code: "CANCEL_UNKNOWN" });
  });

  it("rejects unknown provider status vocabulary", async () => {
    const port = client();
    port.status.mockResolvedValueOnce(job("MYSTERY"));
    await expect(
      new RunPodServerlessTransport(port, ENDPOINT_SHA256).status("job_01"),
    ).rejects.toBeInstanceOf(ServerlessTransportError);
  });
});

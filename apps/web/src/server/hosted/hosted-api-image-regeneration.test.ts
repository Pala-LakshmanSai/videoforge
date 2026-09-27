// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TransactionalSqlExecutor } from "@videoforge/control-plane";
import { observeHostedImageRegeneration } from "./hosted-image-regeneration-execution";

const fixtures = vi.hoisted(() => ({
  row: {} as Record<string, unknown>,
  events: [] as string[],
  result: { state: "PENDING" } as Record<string, unknown>,
  observe: vi.fn(),
}));

vi.mock("./configuration", () => ({
  hostedRuntimeConfiguration: () => ({ apiGeneration: { kieApiKey: "test-key", falApiKey: "fal-test-key" } }),
}));
vi.mock("./hosted-image-regeneration-store", () => ({
  HostedSqlImageRegenerationStore: class {
    async loadApi() { return fixtures.row; }
    async claimApi(_id: string, claimId: string) {
      fixtures.events.push("claim");
      fixtures.row = { ...fixtures.row, state: "SUBMITTING", claimId };
      return fixtures.row;
    }
    async recordApiTask(_id: string, _claim: string, taskId: string) {
      fixtures.events.push("record");
      fixtures.row = { ...fixtures.row, state: "SUBMITTED", providerTaskId: taskId };
      return fixtures.row;
    }
    async markApiUnknown() {
      fixtures.events.push("unknown");
      fixtures.row = { ...fixtures.row, state: "UNKNOWN_NO_RETRY" };
      return fixtures.row;
    }
    async failApi() { throw new Error("unexpected failure"); }
    async commitApi(_id: string, artifact: unknown) {
      fixtures.events.push("commit");
      expect(artifact).toMatchObject({ sha256: "sha256:artifact", byteSize: 101 });
      fixtures.row = { ...fixtures.row, state: "SUCCEEDED" };
      return fixtures.row;
    }
  },
}));
vi.mock("../providers/kie-image-job", async (importOriginal) => {
  const original = await importOriginal<typeof import("../providers/kie-image-job")>();
  return { ...original, observeKieImageJob: fixtures.observe };
});

const params = {
  schema_version: "videoforge-image-regeneration-workflow/v1" as const,
  accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  workspaceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  requestId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
};
const environment = { PRIVATE_ARTIFACTS: {} };

describe("hosted API image regeneration", () => {
  beforeEach(() => {
    fixtures.row = {
      id: params.requestId,
      state: "PREPARED",
      inputManifest: { prompt: "A documentary photograph. Avoid visible text." },
      outputObjectKey: `tenant/${params.accountId}/workspace/${params.workspaceId}/artifact/${params.requestId}`,
      providerTaskId: null,
    };
    fixtures.events = [];
    fixtures.observe.mockReset().mockImplementation(async () => {
      fixtures.events.push("observe");
      return fixtures.result;
    });
    fixtures.result = { state: "PENDING" };
    vi.unstubAllGlobals();
  });

  it("claims before paid POST, persists task ID, and commits only observed artifact", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      fixtures.events.push("POST");
      return new Response(JSON.stringify({ code: 200, data: { taskId: "kie-task-1" } }));
    }));
    const first = await observeHostedImageRegeneration(environment as never,
      {} as TransactionalSqlExecutor, params);
    expect(first).toMatchObject({ state: "SUBMITTED", leaseReleased: false });
    expect(fixtures.events).toEqual(["claim", "POST", "record", "observe"]);
    fixtures.result = { state: "SUCCEEDED", artifact: { sha256: "sha256:artifact",
      byteSize: 101, contentType: "image/png", width: 1, height: 1 } };
    const second = await observeHostedImageRegeneration(environment as never,
      {} as TransactionalSqlExecutor, params);
    expect(second).toMatchObject({ state: "SUCCEEDED", leaseReleased: true, replaced: true });
    expect(fixtures.events).toEqual(["claim", "POST", "record", "observe", "observe", "commit"]);
  });

  it("keeps uncertain submission terminal without a second POST", async () => {
    const post = vi.fn(async () => {
      fixtures.events.push("POST");
      throw new Error("network outcome unknown");
    });
    vi.stubGlobal("fetch", post);
    const first = await observeHostedImageRegeneration(environment as never,
      {} as TransactionalSqlExecutor, params);
    const second = await observeHostedImageRegeneration(environment as never,
      {} as TransactionalSqlExecutor, params);
    expect(first).toMatchObject({ state: "UNKNOWN_NO_RETRY", leaseReleased: false });
    expect(second).toMatchObject({ state: "UNKNOWN_NO_RETRY", leaseReleased: false });
    expect(post).toHaveBeenCalledOnce();
    expect(fixtures.events).toEqual(["claim", "POST", "unknown"]);
  });

  it("closes an abandoned submission claim without replay", async () => {
    fixtures.row = { ...fixtures.row, state: "SUBMITTING", claimId: params.requestId,
      updatedAt: "2000-01-01T00:00:00.000Z" };
    const post = vi.fn();
    vi.stubGlobal("fetch", post);
    const result = await observeHostedImageRegeneration(environment as never,
      {} as TransactionalSqlExecutor, params);
    expect(result).toMatchObject({ state: "UNKNOWN_NO_RETRY", leaseReleased: false });
    expect(post).not.toHaveBeenCalled();
    expect(fixtures.events).toEqual(["unknown"]);
  });

  it("uses the pinned Fal model and persists its request before observing output", async () => {
    const taskId = "764cabcf-b745-4b3e-ae38-1200304cf45b";
    fixtures.row.inputManifest = {
      prompt: "A documentary photo. No visible text.",
      provider: "FAL_Z_IMAGE",
      model: "fal-ai/z-image/turbo",
    };
    const post = vi.fn(async (url, init) => {
      fixtures.events.push("POST");
      expect(url).toBe("https://queue.fal.run/fal-ai/z-image/turbo");
      expect(init.headers.Authorization).toBe("Key fal-test-key");
      return new Response(
        JSON.stringify({
          request_id: taskId,
          status_url: `https://queue.fal.run/fal-ai/z-image/requests/${taskId}/status`,
          response_url: `https://queue.fal.run/fal-ai/z-image/requests/${taskId}`,
        }),
      );
    });
    vi.stubGlobal("fetch", post);
    await observeHostedImageRegeneration(
      environment as never,
      {} as TransactionalSqlExecutor,
      params,
    );
    expect(fixtures.row.providerTaskId).toBe(taskId);
    expect(fixtures.events).toEqual(["claim", "POST", "record", "observe"]);
    await observeHostedImageRegeneration(
      environment as never,
      {} as TransactionalSqlExecutor,
      params,
    );
    expect(post).toHaveBeenCalledOnce();
  });

  it("never repeats an uncertain Fal submission", async () => {
    fixtures.row.inputManifest = {
      prompt: "A documentary photo.",
      provider: "FAL_Z_IMAGE",
      model: "fal-ai/z-image/turbo",
    };
    const post = vi.fn().mockRejectedValue(new Error("lost response"));
    vi.stubGlobal("fetch", post);
    for (let count = 0; count < 2; count += 1) {
      const result = await observeHostedImageRegeneration(
        environment as never,
        {} as TransactionalSqlExecutor,
        params,
      );
      expect(result.state).toBe("UNKNOWN_NO_RETRY");
    }
    expect(post).toHaveBeenCalledOnce();
  });

  it("rejects unknown provider pins before any submission", async () => {
    fixtures.row.inputManifest = {
      prompt: "A documentary photo.",
      provider: "FAL_Z_IMAGE",
      model: "another-model",
    };
    const post = vi.fn();
    vi.stubGlobal("fetch", post);
    await expect(
      observeHostedImageRegeneration(environment as never, {} as TransactionalSqlExecutor, params),
    ).rejects.toThrow("HOSTED_IMAGE_REGENERATION_PROVIDER_INVALID");
    expect(post).not.toHaveBeenCalled();
  });
});

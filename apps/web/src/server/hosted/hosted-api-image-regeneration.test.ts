// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TransactionalSqlExecutor } from "@videoforge/control-plane";
import { observeHostedImageRegeneration } from "./hosted-image-regeneration-execution";

const fixtures = vi.hoisted(() => ({
  row: {} as Record<string, unknown>,
  events: [] as string[],
  result: { state: "PENDING" } as Record<string, unknown>,
  observe: vi.fn(),
  claimAccount: undefined as Record<string, string> | undefined,
  availableAccountIds: vi.fn(),
  apiKeyFor: vi.fn(),
  useRealCredentials: false,
}));

vi.mock("./provider-account-credentials", async (importOriginal) => {
  const original = await importOriginal<typeof import("./provider-account-credentials")>();
  return { ...original, providerAccountCredentials: (config: Parameters<typeof original.providerAccountCredentials>[0]) =>
    fixtures.useRealCredentials ? original.providerAccountCredentials(config) : {
      availableAccountIds: fixtures.availableAccountIds, apiKeyFor: fixtures.apiKeyFor,
    } };
});

vi.mock("./configuration", () => ({
  hostedRuntimeConfiguration: () => ({ apiGeneration: { kieApiKey: "test-key", falApiKey: "fal-test-key",
    accountRoutingEnabled: false,
    apiAccountCredentialsJson: '[{"id":"fal-retired","provider":"FAL","credentialVersion":"v3","apiKey":"historical-key"}]',
  } }),
}));
vi.mock("./hosted-image-regeneration-store", () => ({
  HostedSqlImageRegenerationStore: class {
    async loadApi() { return fixtures.row; }
    async claimApi(_id: string, claimId: string, availableAccounts: string[]) {
      fixtures.events.push("claim");
      expect(availableAccounts).toEqual(["available-account"]);
      fixtures.row = { ...fixtures.row, state: "SUBMITTING", claimId,
        providerAccount: fixtures.claimAccount ?? {
          id: (fixtures.row.inputManifest as Record<string, unknown>).provider === "FAL_Z_IMAGE" ? "fal-legacy" : "kie-legacy",
          provider: (fixtures.row.inputManifest as Record<string, unknown>).provider === "FAL_Z_IMAGE" ? "FAL" : "KIE",
          credentialVersion: "v1",
        } };
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
      providerAccount: { id: "kie-legacy", provider: "KIE", credentialVersion: "v1" },
    };
    fixtures.events = [];
    fixtures.claimAccount = undefined;
    fixtures.useRealCredentials = false;
    fixtures.availableAccountIds.mockReset().mockReturnValue(["available-account"]);
    fixtures.apiKeyFor.mockReset().mockImplementation((provider) => provider === "FAL" ? "fal-test-key" : "test-key");
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

  it("uses the account selected by the claim for submission and later observation", async () => {
    const identity = { id: "kie-second", provider: "KIE", credentialVersion: "v2" };
    fixtures.row.providerAccount = { ...identity, id: "kie-stale" };
    fixtures.claimAccount = identity;
    fixtures.apiKeyFor.mockImplementation((_provider, pin) => {
      expect(pin).toEqual(identity);
      expect(fixtures.events).toContain("claim");
      return "selected-key";
    });
    const post = vi.fn(async (_url, init) => {
      expect(init.headers.Authorization).toBe("Bearer selected-key");
      return new Response(JSON.stringify({ code: 200, data: { taskId: "kie-task-2" } }));
    });
    vi.stubGlobal("fetch", post);
    await observeHostedImageRegeneration(environment as never, {} as TransactionalSqlExecutor, params);
    fixtures.claimAccount = undefined;
    fixtures.availableAccountIds.mockReturnValue([]);
    await observeHostedImageRegeneration(environment as never, {} as TransactionalSqlExecutor, params);
    expect(fixtures.apiKeyFor).toHaveBeenCalledTimes(3);
    expect(post).toHaveBeenCalledOnce();
  });

  it("preserves a submitted job when its exact pinned credentials are missing", async () => {
    fixtures.row = { ...fixtures.row, state: "SUBMITTED", providerTaskId: "paid-task",
      providerAccount: { id: "removed-account", provider: "KIE", credentialVersion: "v1" } };
    fixtures.apiKeyFor.mockImplementation(() => { throw new Error("PROVIDER_ACCOUNT_CREDENTIALS_MISSING"); });
    const post = vi.fn();
    vi.stubGlobal("fetch", post);
    await expect(observeHostedImageRegeneration(environment as never, {} as TransactionalSqlExecutor, params))
      .rejects.toThrow("PROVIDER_ACCOUNT_CREDENTIALS_MISSING");
    expect(fixtures.row.state).toBe("SUBMITTED");
    expect(fixtures.events).toEqual([]);
    expect(fixtures.observe).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it("never falls back to legacy credentials when a submitted v2 response has no account pin", async () => {
    fixtures.row = { ...fixtures.row, state: "SUBMITTED", providerTaskId: "paid-task", providerAccount: null };
    const post = vi.fn();
    vi.stubGlobal("fetch", post);
    await expect(observeHostedImageRegeneration(environment as never, {} as TransactionalSqlExecutor, params))
      .rejects.toThrow("PROVIDER_ACCOUNT_IDENTITY_MISSING");
    expect(fixtures.apiKeyFor).not.toHaveBeenCalled();
    expect(fixtures.observe).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
    expect(fixtures.row.state).toBe("SUBMITTED");
  });

  it("observes a historical extra Fal account with routing disabled using real credentials", async () => {
    fixtures.useRealCredentials = true;
    fixtures.row = { ...fixtures.row, state: "SUBMITTED", providerTaskId: "764cabcf-b745-4b3e-ae38-1200304cf45b",
      inputManifest: { provider: "FAL_Z_IMAGE", model: "fal-ai/z-image/turbo" },
      providerAccount: { id: "fal-retired", provider: "FAL", credentialVersion: "v3" } };
    const fetcher = vi.fn(async (_url, init) => {
      expect(init.headers.Authorization).toBe("Key historical-key");
      return new Response(JSON.stringify({ status: "IN_PROGRESS", request_id: fixtures.row.providerTaskId }));
    });
    vi.stubGlobal("fetch", fetcher);
    fixtures.observe.mockImplementationOnce(async ({ client, taskId }) => {
      expect(await client.get(taskId)).toMatchObject({ state: "generating" });
      return { state: "PENDING" };
    });
    await observeHostedImageRegeneration(environment as never, {} as TransactionalSqlExecutor, params);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fixtures.row.state).toBe("SUBMITTED");
  });
});

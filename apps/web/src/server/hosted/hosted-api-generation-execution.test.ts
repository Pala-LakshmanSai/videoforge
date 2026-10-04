// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./provider-account-credentials";
import { KieImageJobError } from "../providers/kie-image-job";
import {
  advanceHostedApiGeneration,
  ensureHostedApiGenerationWorkflow,
} from "./hosted-api-generation";

const fixture = vi.hoisted(() => ({
  jobs: [] as Record<string, unknown>[],
  videoSnapshot: null as Record<string, unknown> | null,
  renderPending: false,
  capacityDenied: false,
  claimedAccount: null as Record<string, string> | null,
  apiConfiguration: {} as Record<string, unknown>,
  claimArguments: [] as unknown[],
  events: [] as string[],
  observeImage: vi.fn(),
  observeAvatar: vi.fn(),
}));
vi.mock("./configuration", () => ({
  hostedRuntimeConfiguration: () => ({
    r2: {},
    apiGeneration: { kieApiKey: "fixture", falApiKey: "fixture", ...fixture.apiConfiguration },
  }),
}));
vi.mock("./r2", () => ({ HostedR2Signer: class {} }));
vi.mock("../providers/kie-image-job", async (original) => ({
  ...(await original<typeof import("../providers/kie-image-job")>()),
  observeKieImageJob: fixture.observeImage,
}));
vi.mock("../providers/fal-avatar-job", async (original) => ({
  ...(await original<typeof import("../providers/fal-avatar-job")>()),
  observeFalAvatarJob: fixture.observeAvatar,
}));

const scope = {
  accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  workspaceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  generationRequestId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
};
const environment = { PRIVATE_ARTIFACTS: {} } as never;
const database = {
  transaction: async (operation: (tx: unknown) => Promise<unknown>) =>
    operation({
      query: async (sql: string, args: unknown[]) => {
        if (sql.includes("set_config")) return { rows: [] };
        if (sql.includes("SELECT EXISTS(SELECT 1 FROM video_runtime_states runtime"))
          return { rows: [{ pending: fixture.renderPending }] };
        const name = sql.match(/public\.(\w+)\(/)?.[1];
        fixture.events.push(String(name));
        if (name === "videoforge_read_hosted_video_jobs")
          return {
            rows: [
              {
                value: fixture.videoSnapshot ?? {
                  generationRequestId: scope.generationRequestId,
                  hasPlan: false,
                  jobs: [],
                },
              },
            ],
          };
        if (name === "videoforge_read_hosted_api_jobs_v2")
          return {
            rows: [
              {
                value: {
                  generationRequestId: scope.generationRequestId,
                  jobs: structuredClone(fixture.jobs),
                },
              },
            ],
          };
        const job = fixture.jobs.find((row) => row.generationTaskId === args[3])!;
        if (name === "videoforge_claim_hosted_api_job_v2") {
          if (fixture.capacityDenied) return { rows: [{ value: job }] };
          job.state = "SUBMITTING";
          job.claimId = args[4];
          fixture.claimArguments = args;
          if (fixture.claimedAccount) job.providerAccount = fixture.claimedAccount;
        } else if (name === "videoforge_record_hosted_api_task") {
          job.state = "SUBMITTED";
          job.providerTaskId = args[5];
        } else if (name === "videoforge_defer_hosted_api_job") {
          job.state = "PREPARED";
          job.claimId = null;
        } else if (name === "videoforge_mark_hosted_api_unknown") {
          job.state = "UNKNOWN_NO_RETRY";
        } else if (name === "videoforge_fail_hosted_api_job") {
          job.state = "FAILED";
        } else if (name === "videoforge_commit_hosted_api_output") {
          job.state = "SUCCEEDED";
        } else if (name === "videoforge_settle_hosted_api_failure") {
          return { rows: [{ value: { state: "SETTLED" } }] };
        } else throw new Error(`Unexpected fixture SQL: ${name}`);
        return { rows: [{ value: job }] };
      },
    }),
} as never;

function jobs(state: string) {
  return Array.from({ length: 3 }, (_, index) => ({
    id: `job-${index}`,
    generationTaskId: `task-${index}`,
    lane: "IMAGE",
    state,
    inputManifest: { prompt: "A documentary photo" },
    outputObjectKey: `output-${index}`,
    providerTaskId: state === "SUBMITTED" ? `provider-${index}` : null,
    failureCode: null,
    providerAccount: { id: "kie-legacy", provider: "KIE", credentialVersion: "v1" },
  }));
}

describe("hosted API batch execution", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fixture.jobs = jobs("PREPARED");
    fixture.videoSnapshot = null;
    fixture.renderPending = false;
    fixture.capacityDenied = false;
    fixture.claimedAccount = null;
    fixture.apiConfiguration = {};
    fixture.claimArguments = [];
    fixture.events = [];
    fixture.observeImage.mockReset();
    fixture.observeAvatar.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("uses the account returned by the claim, even when the prepared read showed legacy", async () => {
    fixture.jobs = [jobs("PREPARED")[0]!];
    fixture.claimedAccount = { id: "kie-second", provider: "KIE", credentialVersion: "v1" };
    fixture.apiConfiguration = {
      accountRoutingEnabled: true,
      apiAccountCredentialsJson: JSON.stringify([
        { ...fixture.claimedAccount, apiKey: "second-kie-fixture" },
      ]),
    };
    const post = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ code: 200, data: { taskId: "paid-second" } })),
      );
    vi.stubGlobal("fetch", post);
    const pending = advanceHostedApiGeneration(environment, database, scope);
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ state: "PROGRESSED" });
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0]?.[1]?.headers.Authorization).toBe("Bearer second-kie-fixture");
    expect(JSON.parse(String(fixture.claimArguments[5]))).toEqual(["kie-legacy", "kie-second"]);
    expect(fixture.jobs[0]!.providerTaskId).toBe("paid-second");
  });

  it("retains historical account credentials for observation after pool admission is disabled", async () => {
    fixture.jobs = [
      {
        ...jobs("SUBMITTED")[0]!,
        providerAccount: { id: "kie-second", provider: "KIE", credentialVersion: "v1" },
      },
    ];
    fixture.apiConfiguration = {
      apiAccountCredentialsJson: JSON.stringify([
        {
          id: "kie-second",
          provider: "KIE",
          credentialVersion: "v1",
          apiKey: "historical-kie-fixture",
        },
      ]),
    };
    fixture.observeImage.mockImplementation(async ({ client }) => {
      await client.get("provider-0");
      return { state: "PENDING" };
    });
    const read = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            code: 200,
            data: { state: "waiting", taskId: "provider-0", model: "z-image" },
          }),
        ),
      );
    vi.stubGlobal("fetch", read);
    const pending = advanceHostedApiGeneration(environment, database, scope);
    await vi.runAllTimersAsync();
    expect((await pending).state).not.toBe("ACTION_REQUIRED");
    expect(fixture.jobs[0]!.state).toBe("SUBMITTED");
    expect(read.mock.calls[0]?.[1]?.headers.Authorization).toBe("Bearer historical-kie-fixture");
    expect(fixture.events).not.toContain("videoforge_claim_hosted_api_job_v2");
  });

  it("missing historical credentials pause paid work without switching keys or failing the job", async () => {
    fixture.jobs = [
      {
        ...jobs("SUBMITTED")[0]!,
        providerAccount: { id: "kie-removed", provider: "KIE", credentialVersion: "v1" },
      },
    ];
    const post = vi.fn();
    vi.stubGlobal("fetch", post);
    const pending = advanceHostedApiGeneration(environment, database, scope);
    const rejected = expect(pending).rejects.toThrow("PROVIDER_ACCOUNT_CREDENTIAL_MISSING");
    await vi.runAllTimersAsync();
    await rejected;
    expect(post).not.toHaveBeenCalled();
    expect(fixture.jobs[0]!.state).toBe("SUBMITTED");
    expect(fixture.events).not.toContain("videoforge_fail_hosted_api_job");
  });

  it("observes existing paid work when every new claim waits for shared capacity", async () => {
    fixture.jobs = [
      ...jobs("PREPARED"),
      { ...jobs("SUBMITTED")[0]!, id: "paid-job", generationTaskId: "paid-task" },
    ];
    fixture.capacityDenied = true;
    fixture.observeImage.mockResolvedValue({ state: "PENDING" });
    const post = vi.fn();
    vi.stubGlobal("fetch", post);
    const startedAt = Date.now();
    const pending = advanceHostedApiGeneration(environment, database, scope);
    await vi.runAllTimersAsync();
    expect((await pending).state).toBe("WAITING");
    expect(Date.now() - startedAt).toBeLessThan(1050);
    expect(post).not.toHaveBeenCalled();
    expect(fixture.observeImage).toHaveBeenCalledTimes(1);
    expect(fixture.jobs[0]!.state).toBe("PREPARED");
  });

  it("defers confirmed429 with the exact claim while continuing paid result observation", async () => {
    fixture.jobs = [jobs("PREPARED")[0]!, jobs("SUBMITTED")[1]!];
    fixture.observeImage.mockResolvedValue({ state: "PENDING" });
    const post = vi.fn(
      async () => new Response("rate limited", { status: 429, headers: { "Retry-After": "30" } }),
    );
    vi.stubGlobal("fetch", post);
    const pending = advanceHostedApiGeneration(environment, database, scope);
    await vi.runAllTimersAsync();
    expect((await pending).state).toBe("WAITING");
    expect(post).toHaveBeenCalledTimes(1);
    expect(fixture.events).toContain("videoforge_defer_hosted_api_job");
    expect(fixture.events).not.toContain("videoforge_mark_hosted_api_unknown");
    expect(fixture.events).not.toContain("videoforge_fail_hosted_api_job");
    expect(fixture.jobs[0]!.state).toBe("PREPARED");
    expect(fixture.observeImage).toHaveBeenCalledTimes(1);
  });

  it.each(["unknown", "rejected"])(
    "stops queued paid calls after %s and never replays",
    async (kind) => {
      const post = vi.fn(async () => {
        fixture.events.push("POST");
        if (kind === "unknown") throw new Error("uncertain network outcome");
        return new Response("rejected", { status: 400 });
      });
      vi.stubGlobal("fetch", post);
      const pending = advanceHostedApiGeneration(environment, database, scope);
      await vi.runAllTimersAsync();
      await pending;
      expect(post).toHaveBeenCalledTimes(1);
      expect(fixture.events.indexOf("videoforge_claim_hosted_api_job_v2")).toBeLessThan(
        fixture.events.indexOf("POST"),
      );
      expect(fixture.jobs.map((row) => row.state)).toEqual([
        kind === "unknown" ? "UNKNOWN_NO_RETRY" : "FAILED",
        "PREPARED",
        "PREPARED",
      ]);
      expect((await advanceHostedApiGeneration(environment, database, scope)).state).toBe(
        "ACTION_REQUIRED",
      );
      expect(post).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["UNKNOWN_NO_RETRY", "FAILED"])(
    "saves submitted sibling outputs after %s without replaying accepted work",
    async (blockedState) => {
      fixture.jobs = jobs("SUBMITTED");
      fixture.jobs[0]!.state = blockedState;
      fixture.jobs[0]!.providerTaskId = null;
      fixture.jobs[1]!.state = "SUCCEEDED";
      const accepted = structuredClone(fixture.jobs[1]);
      fixture.jobs.push({ ...jobs("PREPARED")[0], id: "job-3", generationTaskId: "task-3" });
      const post = vi.fn();
      vi.stubGlobal("fetch", post);
      fixture.observeImage.mockResolvedValue({
        state: "SUCCEEDED",
        artifact: {
          sha256: "sha256:fixture",
          byteSize: 1024,
          contentType: "image/png",
          width: 1920,
          height: 1080,
        },
      });
      const pending = advanceHostedApiGeneration(environment, database, scope);
      await vi.runAllTimersAsync();
      expect((await pending).state).toBe("PROGRESSED");
      expect(fixture.observeImage).toHaveBeenCalledTimes(1);
      expect(fixture.observeImage).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: "provider-2" }),
      );
      expect(fixture.jobs[1]).toEqual(accepted);
      expect(fixture.jobs.map((row) => row.state)).toEqual([
        blockedState,
        "SUCCEEDED",
        "SUCCEEDED",
        "PREPARED",
      ]);
      expect((await advanceHostedApiGeneration(environment, database, scope)).state).toBe(
        "ACTION_REQUIRED",
      );
      expect(post).not.toHaveBeenCalled();
      expect(fixture.events).not.toContain("videoforge_claim_hosted_api_job_v2");
    },
  );

  it("retrieves a failed download using the same provider identity", async () => {
    fixture.jobs = jobs("SUBMITTED");
    fixture.jobs[1]!.state = "SUCCEEDED";
    fixture.jobs[2]!.state = "SUCCEEDED";
    const post = vi.fn();
    vi.stubGlobal("fetch", post);
    fixture.observeImage
      .mockRejectedValueOnce(new KieImageJobError("RESULT_DOWNLOAD_FAILED"))
      .mockResolvedValueOnce({
        state: "SUCCEEDED",
        artifact: {
          sha256: "sha256:fixture",
          byteSize: 1024,
          contentType: "image/png",
          width: 1920,
          height: 1080,
        },
      });
    const first = advanceHostedApiGeneration(environment, database, scope);
    await vi.runAllTimersAsync();
    expect((await first).state).toBe("WAITING");
    expect(fixture.jobs[0]!.state).toBe("SUBMITTED");
    const second = advanceHostedApiGeneration(environment, database, scope);
    await vi.runAllTimersAsync();
    expect((await second).state).toBe("PROGRESSED");
    expect(fixture.observeImage.mock.calls.map(([input]) => input.taskId)).toEqual([
      "provider-0",
      "provider-0",
    ]);
    expect(post).not.toHaveBeenCalled();
    expect(fixture.events).not.toContain("videoforge_claim_hosted_api_job_v2");
  });

  it.each([true, false])(
    "restarts stopped workflows only when submitted results remain: %s",
    async (submitted) => {
      fixture.jobs = jobs("PREPARED");
      fixture.jobs[0]!.state = "UNKNOWN_NO_RETRY";
      if (submitted) {
        fixture.jobs[1]!.state = "SUBMITTED";
        fixture.jobs[1]!.providerTaskId = "persisted-provider-id";
      }
      const restart = vi.fn();
      const workflow = {
        create: vi.fn().mockRejectedValue(new Error("existing")),
        get: vi.fn().mockResolvedValue({ status: async () => ({ status: "complete" }), restart }),
      };
      const result = await ensureHostedApiGenerationWorkflow(
        { HOSTED_PAIR_WORKFLOW: workflow, PRIVATE_ARTIFACTS: {} } as never,
        database,
        scope,
      );
      expect(result.recovered).toBe(true);
      expect(restart).toHaveBeenCalledTimes(submitted ? 1 : 0);
      expect(fixture.events).toEqual([
        "videoforge_read_hosted_api_jobs_v2",
        "videoforge_read_hosted_video_jobs",
      ]);
    },
  );

  it.each(["PREPARED", "SUBMITTED", "SUBMITTING", "UNKNOWN_NO_RETRY"])(
    "restarts stopped workflow for saved %s footage after image/avatar acceptance",
    async (state) => {
      fixture.jobs = jobs("SUCCEEDED");
      fixture.videoSnapshot = {
        generationRequestId: scope.generationRequestId,
        hasPlan: true,
        requestState: "ACTIVE",
        plannedJobCount: 1,
        jobs: [{ state }],
      };
      const restart = vi.fn();
      const post = vi.fn();
      vi.stubGlobal("fetch", post);
      const workflow = {
        create: vi.fn().mockRejectedValue(new Error("existing")),
        get: vi.fn().mockResolvedValue({ status: async () => ({ status: "complete" }), restart }),
      };
      await ensureHostedApiGenerationWorkflow(
        { HOSTED_PAIR_WORKFLOW: workflow, VIDEO_GENERATION_ENABLED: "false" } as never,
        database,
        scope,
      );
      expect(restart).toHaveBeenCalledOnce();
      expect(post).not.toHaveBeenCalled();
      expect(fixture.events).toEqual([
        "videoforge_read_hosted_api_jobs_v2",
        "videoforge_read_hosted_video_jobs",
      ]);
    },
  );

  it.each([
    { requestState: "CANCELLED", states: ["SUBMITTED"], restart: false },
    { requestState: "CANCELLING", states: ["PREPARED"], restart: false },
    { requestState: "CANCELLING", states: ["SUBMITTED"], restart: true },
    { requestState: "ACTIVE", states: [], restart: false },
    { requestState: "ACTIVE", states: ["SUCCEEDED"], restart: false },
    { requestState: "ACTIVE", states: ["FAILED"], restart: false },
    { requestState: "ACTIVE", states: ["FAILED", "PREPARED"], restart: false },
    { requestState: "ACTIVE", states: ["UNKNOWN_NO_RETRY", "PREPARED"], restart: true },
  ])("preserves safe footage recovery $requestState/$states", async (scenario) => {
    fixture.jobs = jobs("SUCCEEDED");
    fixture.videoSnapshot = {
      generationRequestId: scope.generationRequestId,
      hasPlan: true,
      requestState: scenario.requestState,
      plannedJobCount: scenario.states.length,
      jobs: scenario.states.map((state) => ({ state })),
    };
    const restart = vi.fn();
    const post = vi.fn();
    vi.stubGlobal("fetch", post);
    const workflow = {
      create: vi.fn().mockRejectedValue(new Error("existing")),
      get: vi.fn().mockResolvedValue({ status: async () => ({ status: "terminated" }), restart }),
    };
    await ensureHostedApiGenerationWorkflow(
      { HOSTED_PAIR_WORKFLOW: workflow } as never,
      database,
      scope,
    );
    expect(restart).toHaveBeenCalledTimes(scenario.restart ? 1 : 0);
    expect(post).not.toHaveBeenCalled();
  });

  it("does not restart a completed all-fallback footage plan", async () => {
    fixture.jobs = jobs("SUCCEEDED");
    fixture.videoSnapshot = {
      generationRequestId: scope.generationRequestId,
      hasPlan: true,
      requestState: "ACTIVE",
      plannedJobCount: 1,
      jobs: [{ state: "FAILED", staticFallback: true }],
    };
    const restart = vi.fn();
    const workflow = {
      create: vi.fn().mockRejectedValue(new Error("existing")),
      get: vi.fn().mockResolvedValue({ status: async () => ({ status: "errored" }), restart }),
    };
    await ensureHostedApiGenerationWorkflow(
      { HOSTED_PAIR_WORKFLOW: workflow } as never,
      database,
      scope,
    );
    expect(restart).not.toHaveBeenCalled();
  });

  it.each([
    { apiState: "UNKNOWN_NO_RETRY", videoState: "SUBMITTED", restart: true },
    { apiState: "UNKNOWN_NO_RETRY", videoState: "PREPARED", restart: false },
    { apiState: "FAILED", videoState: "SUBMITTING", restart: true },
    { apiState: "FAILED", videoState: "PREPARED", restart: false },
  ])("drains footage but preserves API fences $apiState/$videoState", async (scenario) => {
    fixture.jobs = jobs(scenario.apiState);
    fixture.videoSnapshot = {
      generationRequestId: scope.generationRequestId,
      hasPlan: true,
      requestState: "ACTIVE",
      plannedJobCount: 1,
      jobs: [{ state: scenario.videoState }],
    };
    const restart = vi.fn();
    const post = vi.fn();
    vi.stubGlobal("fetch", post);
    const workflow = {
      create: vi.fn().mockRejectedValue(new Error("existing")),
      get: vi.fn().mockResolvedValue({ status: async () => ({ status: "errored" }), restart }),
    };
    await ensureHostedApiGenerationWorkflow(
      { HOSTED_PAIR_WORKFLOW: workflow } as never,
      database,
      scope,
    );
    expect(restart).toHaveBeenCalledTimes(scenario.restart ? 1 : 0);
    expect(post).not.toHaveBeenCalled();
  });

  it("visits every outstanding result once and advances immediately after acceptance", async () => {
    fixture.jobs = jobs("SUBMITTED");
    fixture.jobs[1]!.lane = "AVATAR";
    fixture.jobs[1]!.providerAccount = {
      id: "fal-legacy",
      provider: "FAL",
      credentialVersion: "v1",
    };
    const observed: string[] = [];
    const observe = async (input: { taskId?: string; requestId?: string }) => {
      observed.push(input.taskId ?? input.requestId!);
      return {
        state: "SUCCEEDED",
        artifact: {
          sha256: "sha256:fixture",
          byteSize: 1024,
          contentType: "image/png",
          width: 512,
          height: 512,
          durationSeconds: 4,
        },
      };
    };
    fixture.observeImage.mockImplementation(observe);
    fixture.observeAvatar.mockImplementation(observe);
    const pending = advanceHostedApiGeneration(environment, database, scope, 99);
    await vi.runAllTimersAsync();
    expect((await pending).state).toBe("PROGRESSED");
    expect(observed).toEqual(["provider-0", "provider-1", "provider-2"]);
    expect(fixture.jobs.every((row) => row.state === "SUCCEEDED")).toBe(true);
    expect((await advanceHostedApiGeneration(environment, database, scope)).state).toBe(
      "READY_TO_RENDER",
    );
  });
});

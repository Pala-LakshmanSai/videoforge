// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunwareSeedanceJobError } from "../providers/runware-seedance-job";
import { advanceHostedApiGeneration } from "./hosted-api-generation";
import { advanceHostedVideoGeneration } from "./hosted-video-generation";

const fixture = vi.hoisted(() => ({
  videos: [] as Record<string, unknown>[],
  apiJobs: [] as Record<string, unknown>[],
  requestState: "ACTIVE",
  events: [] as string[],
  submit: vi.fn(),
  observe: vi.fn(),
  observeImage: vi.fn(),
  plannedJobCount: null as number | null,
}));
vi.mock("./configuration", () => ({
  hostedRuntimeConfiguration: () => ({
    r2: {},
    styleAnalysis: { apiKey: "fixture-private-key-never-paid" },
    apiGeneration: { kieApiKey: "fixture", falApiKey: "fixture" },
  }),
}));
vi.mock("./r2", () => ({
  HostedR2Signer: class {
    async sign() {
      return { url: "https://private.example/accepted-image" };
    }
  },
}));
vi.mock("../providers/runware-seedance-job", async (original) => ({
  ...(await original<typeof import("../providers/runware-seedance-job")>()),
  submitRunwareSeedanceJob: fixture.submit,
  observeRunwareSeedanceJob: fixture.observe,
}));
vi.mock("../providers/kie-image-job", async (original) => ({
  ...(await original<typeof import("../providers/kie-image-job")>()),
  observeKieImageJob: fixture.observeImage,
}));

const scope = {
  accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  workspaceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  generationRequestId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
};
const environment = { PRIVATE_ARTIFACTS: {} } as never;
const identity = (index: number) => `12345678-1234-4123-8123-${String(index).padStart(12, "0")}`;
const digest = `sha256:${"a".repeat(64)}`;
const database = {
  transaction: async (work: (tx: unknown) => Promise<unknown>) =>
    work({
      query: async (sql: string, args: unknown[]) => {
        if (sql.includes("set_config")) return { rows: [] };
        const name = sql.match(/public\.(\w+)\(/)?.[1];
        fixture.events.push(`${name}:${String(args[3] ?? "")}`);
        let value: unknown;
        if (name === "videoforge_read_hosted_video_jobs")
          value = {
            generationRequestId: scope.generationRequestId,
            requestState: fixture.requestState,
            hasPlan: true,
            plannedJobCount: fixture.plannedJobCount ?? fixture.videos.length,
            jobs: structuredClone(fixture.videos),
          };
        else if (name === "videoforge_read_hosted_api_jobs_v2")
          value = {
            generationRequestId: scope.generationRequestId,
            jobs: structuredClone(fixture.apiJobs),
          };
        else if (name === "videoforge_settle_hosted_api_failure")
          value = {
            state:
              fixture.videos.some((job) =>
                ["SUBMITTING", "SUBMITTED", "UNKNOWN_NO_RETRY"].includes(String(job.state)),
              ) ||
              fixture.apiJobs.some((job) =>
                ["SUBMITTING", "SUBMITTED", "UNKNOWN_NO_RETRY"].includes(String(job.state)),
              )
                ? "WAITING"
                : "SETTLED",
          };
        else if (name === "videoforge_settle_hosted_video_cancellation") {
          const waiting = fixture.videos.some((job) =>
            ["SUBMITTING", "SUBMITTED", "UNKNOWN_NO_RETRY"].includes(String(job.state)),
          );
          if (!waiting) fixture.requestState = "CANCELLED";
          value = { state: waiting ? "WAITING" : "SETTLED" };
        } else {
          const video = fixture.videos.find((job) => job.id === args[3]);
          const api = fixture.apiJobs.find((job) => job.generationTaskId === args[3]);
          if (name === "videoforge_claim_hosted_video_job" && video) {
            if (fixture.requestState === "ACTIVE" && video.state === "PREPARED") {
              video.state = "SUBMITTING";
              video.claimId = args[4];
            }
            value = video;
          } else if (name === "videoforge_record_hosted_video_task" && video) {
            expect(args[5]).toBe(video.id);
            expect(args[4]).toBe(video.claimId);
            video.state = "SUBMITTED";
            video.providerTaskId = args[5];
            value = video;
          } else if (name === "videoforge_mark_hosted_video_unknown" && video) {
            video.state = "UNKNOWN_NO_RETRY";
            value = video;
          } else if (name === "videoforge_record_hosted_video_cost" && video) {
            video.outputCostUsd = args[4];
            value = video;
          } else if (name === "videoforge_commit_hosted_video_output" && video) {
            expect(video.outputCostUsd).toBe(args[8]);
            video.state = "SUCCEEDED";
            value = video;
          } else if (name === "videoforge_fail_hosted_video_job" && video) {
            video.state = "FAILED";
            video.failureCode = args[4];
            value = video;
          } else if (name === "videoforge_commit_hosted_api_output" && api) {
            api.state = "SUCCEEDED";
            value = api;
          } else throw new Error(`Unexpected fixture SQL: ${name}`);
        }
        return { rows: [{ value: structuredClone(value) }] };
      },
    }),
} as never;

function videoJobs(state: string, count = 1) {
  return Array.from({ length: count }, (_, index) => ({
    id: identity(index),
    state,
    claimId: state === "PREPARED" ? null : identity(100),
    providerTaskId: state === "SUBMITTED" || state === "SUCCEEDED" ? identity(index) : null,
    inputManifest: {
      taskUUID: identity(index),
      model: "bytedance:2@2",
      width: 1248,
      height: 704,
      durationSeconds: 2,
      videoFrameCount: 60,
      prompt: "Documentary movement without text or transitions.",
      sourceImageObjectKey: "private-source-image",
      sourceImageContentType: "image/png",
      sourceImageContentLength: 1024,
      sourceImageSha256: digest,
    },
    outputObjectKey: `tenant/account/workspace/workspace/project/project/revision/revision/lane/scene-video/job/${identity(index)}/artifact/${identity(index)}`,
    sourceReady: true,
    durationSeconds: 2,
    videoFrameCount: 60,
    failureCode: null,
  }));
}
function apiJobs(state: string, count = 1) {
  return Array.from({ length: count }, (_, index) => ({
    id: `image-${index}`,
    generationTaskId: identity(200 + index),
    lane: "IMAGE",
    state,
    inputManifest: { prompt: "Documentary photo" },
    outputObjectKey: `private-image-${index}`,
    providerTaskId: state === "SUBMITTED" ? `kie-${index}` : null,
    failureCode: null,
  }));
}
async function run<Value>(promise: Promise<Value>): Promise<Value> {
  await vi.runAllTimersAsync();
  return promise;
}

describe("hosted video execution", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fixture.videos = videoJobs("PREPARED");
    fixture.apiJobs = apiJobs("SUCCEEDED");
    fixture.requestState = "ACTIVE";
    fixture.events = [];
    fixture.plannedJobCount = null;
    fixture.submit.mockReset();
    fixture.observe.mockReset();
    fixture.observeImage.mockReset();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("Live requests forbidden in fixture");
      }),
    );
    fixture.observe.mockResolvedValue({ state: "PENDING", submissionConfirmed: false });
    fixture.submit.mockImplementation(
      async (
        input: Parameters<
          typeof import("../providers/runware-seedance-job").submitRunwareSeedanceJob
        >[0],
      ) => {
        expect(fixture.videos.find((job) => job.id === input.taskUUID)?.state).toBe("SUBMITTING");
        expect(await input.claimSubmission()).toBe(true);
        fixture.events.push(`POST:${input.taskUUID}`);
        await input.persistRequestId(input.taskUUID);
        return { state: "SUBMITTED", requestId: input.taskUUID };
      },
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("completes Off without video bindings, provider requests or claims", async () => {
    fixture.videos = [];
    fixture.plannedJobCount = 0;
    await expect(
      advanceHostedVideoGeneration({} as never, database, scope, true),
    ).resolves.toMatchObject({ complete: true, active: false, jobCount: 0 });
    expect(fixture.events).toEqual(["videoforge_read_hosted_video_jobs:"]);
    expect(fixture.submit).not.toHaveBeenCalled();
    expect(fixture.observe).not.toHaveBeenCalled();
  });

  it("settles cancellation of an empty plan without video bindings", async () => {
    fixture.videos = [];
    fixture.plannedJobCount = 0;
    fixture.requestState = "CANCELLING";
    await expect(
      advanceHostedVideoGeneration({} as never, database, scope, true),
    ).resolves.toMatchObject({ complete: false, problemCode: "OWNER_CANCELLED" });
    expect(fixture.submit).not.toHaveBeenCalled();
    expect(fixture.observe).not.toHaveBeenCalled();
  });

  it("keeps a definite short clip as a still while submitting remaining selections once", async () => {
    fixture.videos = videoJobs("PREPARED", 3);
    Object.assign(fixture.videos[0]!, {
      state: "FAILED",
      failureCode: "SEEDANCE_RESULT_INVALID",
      staticFallback: true,
      claimId: identity(100),
      outputCostUsd: 0.01614842,
    });
    Object.assign(fixture.videos[1]!, {
      state: "SUCCEEDED",
      claimId: identity(100),
      providerTaskId: identity(1),
    });
    const original = structuredClone(fixture.videos[0]);
    const result = await run(advanceHostedVideoGeneration(environment, database, scope, true));
    expect(result.problemCode).toBeUndefined();
    expect(fixture.submit).toHaveBeenCalledTimes(1);
    expect(fixture.submit.mock.calls[0]?.[0].taskUUID).toBe(identity(2));
    expect(fixture.videos[0]).toEqual(original);
  });

  it("renders original images when every optional clip has an authorized static fallback", async () => {
    fixture.videos = videoJobs("FAILED", 2).map((item) => ({
      ...item,
      failureCode: "SEEDANCE_CLIP_TOO_SHORT",
      staticFallback: true,
      outputCostUsd: 0.02,
    }));
    expect((await run(advanceHostedApiGeneration(environment, database, scope))).state).toBe(
      "READY_TO_RENDER",
    );
    expect(fixture.submit).not.toHaveBeenCalled();
    expect(fixture.observe).not.toHaveBeenCalled();
    expect(
      fixture.events.some((event) => event.startsWith("videoforge_settle_hosted_api_failure")),
    ).toBe(false);
  });

  it("blocks rendering and new submissions after a definite required-opening clip failure", async () => {
    fixture.videos = videoJobs("PREPARED", 2);
    // Model the durable reader's result after the SQL opening policy prefixes a definite
    // failure and refuses optional still fallback; this test owns orchestration behavior.
    Object.assign(fixture.videos[0]!, {
      state: "FAILED",
      failureCode: "REQUIRED_OPENING_SEEDANCE_CLIP_TOO_SHORT",
      staticFallback: false,
      claimId: identity(100),
      providerTaskId: identity(0),
      outputCostUsd: 0.02,
    });
    const original = structuredClone(fixture.videos);
    const result = await run(advanceHostedApiGeneration(environment, database, scope));
    expect(result).toMatchObject({
      state: "ACTION_REQUIRED",
      code: "REQUIRED_OPENING_SEEDANCE_CLIP_TOO_SHORT",
    });
    expect(fixture.videos).toEqual(original);
    expect(fixture.submit).not.toHaveBeenCalled();
    expect(fixture.observe).not.toHaveBeenCalled();
    expect(
      fixture.events.some((event) => event.startsWith("videoforge_claim_hosted_video_job")),
    ).toBe(false);
    expect(
      fixture.events.some((event) => event.startsWith("videoforge_commit_hosted_video_output")),
    ).toBe(false);
    expect(
      fixture.events.some((event) => event.startsWith("videoforge_settle_hosted_api_failure")),
    ).toBe(true);
  });

  it("never treats an uncertain submission as a still fallback", async () => {
    fixture.videos = videoJobs("UNKNOWN_NO_RETRY").map((item) => ({
      ...item,
      staticFallback: true,
    }));
    const result = await run(advanceHostedVideoGeneration(environment, database, scope, true));
    expect(result.complete).toBe(false);
    expect(result.problemCode).toBe("SEEDANCE_SUBMISSION_UNCERTAIN");
    expect(fixture.submit).not.toHaveBeenCalled();
  });

  it("validates the selected scene prefix independently of padded request duration", async () => {
    fixture.videos = videoJobs("SUBMITTED");
    fixture.videos[0]!.durationSeconds = 2.1;
    await run(advanceHostedVideoGeneration(environment, database, scope, true));
    expect(fixture.observe).toHaveBeenCalledWith(
      expect.objectContaining({
        durationSeconds: 2.1,
        minimumDurationSeconds: 60 / 30,
      }),
    );
  });

  it("durably claims at most four jobs and preserves the outstanding cap on the next pass", async () => {
    fixture.videos = videoJobs("PREPARED", 6);
    await run(advanceHostedVideoGeneration(environment, database, scope, true));
    expect(fixture.submit).toHaveBeenCalledTimes(4);
    expect(fixture.videos.map((job) => job.state)).toEqual([
      "SUBMITTED",
      "SUBMITTED",
      "SUBMITTED",
      "SUBMITTED",
      "PREPARED",
      "PREPARED",
    ]);
    for (const job of fixture.videos.slice(0, 4)) {
      expect(fixture.events.indexOf(`videoforge_claim_hosted_video_job:${job.id}`)).toBeLessThan(
        fixture.events.indexOf(`POST:${job.id}`),
      );
    }
    await run(advanceHostedVideoGeneration(environment, database, scope, true));
    expect(fixture.submit).toHaveBeenCalledTimes(4);
    expect(fixture.observe).toHaveBeenCalledTimes(4);
  });

  it.each(["SUBMITTING", "UNKNOWN_NO_RETRY"])(
    "polls saved %s UUIDs without another POST",
    async (state) => {
      fixture.videos = [...videoJobs(state), ...videoJobs("PREPARED", 2).slice(1)];
      fixture.observe.mockResolvedValue({ state: "PENDING", submissionConfirmed: true });
      const result = await run(advanceHostedVideoGeneration(environment, database, scope, true));
      expect(fixture.submit).not.toHaveBeenCalled();
      expect(fixture.observe).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: identity(0) }),
      );
      expect(fixture.videos.map((job) => job.state)).toEqual(["SUBMITTED", "PREPARED"]);
      expect(result.progressed).toBe(true);
      expect(fixture.events).not.toContain(`videoforge_claim_hosted_video_job:${identity(1)}`);
    },
  );

  it.each(["SUBMITTING", "UNKNOWN_NO_RETRY"])(
    "does not promote %s on generic never-submitted-UUID polling envelopes",
    async (state) => {
      fixture.videos = [...videoJobs(state), ...videoJobs("PREPARED", 2).slice(1)];
      const result = await run(advanceHostedVideoGeneration(environment, database, scope, true));
      expect(fixture.videos.map((job) => job.state)).toEqual([state, "PREPARED"]);
      expect(result.progressed).toBe(false);
      expect(result.problemCode).toBe("SEEDANCE_SUBMISSION_UNCERTAIN");
      expect(fixture.submit).not.toHaveBeenCalled();
      expect(
        fixture.events.some((event) => event.startsWith("videoforge_record_hosted_video_task")),
      ).toBe(false);
      expect(
        fixture.events.some((event) => event.startsWith("videoforge_claim_hosted_video_job")),
      ).toBe(false);
    },
  );

  it("rejects a pinned plan whose materialized jobs are missing before any paid call", async () => {
    vi.useRealTimers();
    fixture.plannedJobCount = 2;
    await expect(advanceHostedVideoGeneration(environment, database, scope, true)).rejects.toThrow(
      "HOSTED_VIDEO",
    );
    expect(fixture.submit).not.toHaveBeenCalled();
    expect(fixture.observe).not.toHaveBeenCalled();
  });

  it("continues draining paid video when a legacy provider identity needs reconciliation", async () => {
    fixture.videos = videoJobs("SUBMITTED");
    fixture.apiJobs = apiJobs("UNKNOWN_NO_RETRY");
    expect((await run(advanceHostedApiGeneration(environment, database, scope))).state).toBe(
      "WAITING",
    );
    expect(fixture.observe).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: identity(0) }),
    );
    fixture.observe.mockImplementationOnce(async (input) => {
      await input.recordProviderCost(0.02672);
      return {
        state: "SUCCEEDED",
        costUsd: 0.02672,
        artifact: {
          sha256: digest,
          byteSize: 1024,
          contentType: "video/mp4",
          width: 1248,
          height: 704,
          durationSeconds: 2,
        },
      };
    });
    await run(advanceHostedApiGeneration(environment, database, scope));
    expect(fixture.videos[0]?.state).toBe("SUCCEEDED");
    expect((await run(advanceHostedApiGeneration(environment, database, scope))).state).toBe(
      "ACTION_REQUIRED",
    );
    expect(fixture.submit).not.toHaveBeenCalled();
    expect(
      fixture.events.some((event) => event.startsWith("videoforge_claim_hosted_api_job")),
    ).toBe(false);
  });

  it("records exact UUID cost before accepting media and retains charged invalid output", async () => {
    fixture.videos = videoJobs("SUBMITTED");
    fixture.observe.mockImplementationOnce(async (input) => {
      expect(input.requestId).toBe(identity(0));
      await input.recordProviderCost(0.02672);
      fixture.events.push("artifact-accepted");
      return {
        state: "SUCCEEDED",
        costUsd: 0.02672,
        artifact: {
          sha256: digest,
          byteSize: 1024,
          contentType: "video/mp4",
          width: 1248,
          height: 704,
          durationSeconds: 2,
        },
      };
    });
    await run(advanceHostedVideoGeneration(environment, database, scope, false));
    expect(
      fixture.events.indexOf(`videoforge_record_hosted_video_cost:${identity(0)}`),
    ).toBeLessThan(fixture.events.indexOf("artifact-accepted"));
    expect(fixture.videos[0]?.state).toBe("SUCCEEDED");
    fixture.videos = videoJobs("SUBMITTED");
    fixture.observe.mockImplementationOnce(async (input) => {
      await input.recordProviderCost(0.02672);
      throw new RunwareSeedanceJobError("RESULT_MP4_INVALID");
    });
    await run(advanceHostedVideoGeneration(environment, database, scope, false));
    expect(fixture.videos[0]).toMatchObject({
      state: "FAILED",
      outputCostUsd: 0.02672,
      failureCode: "SEEDANCE_RESULT_INVALID",
    });
    expect(fixture.submit).not.toHaveBeenCalled();
  });

  it("retains an excessive provider charge and stops new claims after terminal price failure", async () => {
    fixture.videos = [...videoJobs("SUBMITTED"), ...videoJobs("PREPARED", 2).slice(1)];
    fixture.observe.mockImplementationOnce(async (input) => {
      await input.recordProviderCost(1.25);
      throw new RunwareSeedanceJobError("RESULT_PRICE_CHANGED");
    });
    await run(advanceHostedVideoGeneration(environment, database, scope, false));
    expect(fixture.videos[0]).toMatchObject({
      state: "FAILED",
      outputCostUsd: 1.25,
      failureCode: "SEEDANCE_PRICE_CHANGED",
    });
    expect(
      fixture.events.indexOf(`videoforge_record_hosted_video_cost:${identity(0)}`),
    ).toBeLessThan(fixture.events.indexOf(`videoforge_fail_hosted_video_job:${identity(0)}`));
    const result = await run(advanceHostedVideoGeneration(environment, database, scope, true));
    expect(result.problemCode).toBe("SEEDANCE_PRICE_CHANGED");
    expect(fixture.submit).not.toHaveBeenCalled();
    expect(fixture.videos[1]?.state).toBe("PREPARED");
    expect(
      fixture.events.some((event) => event.startsWith("videoforge_commit_hosted_video_output")),
    ).toBe(false);
  });

  it("keeps cancelled replay terminal and never admits render or a new POST", async () => {
    fixture.requestState = "CANCELLED";
    fixture.videos = videoJobs("FAILED");
    fixture.videos[0]!.failureCode = "OWNER_CANCELLED_BEFORE_SUBMIT";
    expect(await run(advanceHostedApiGeneration(environment, database, scope))).toMatchObject({
      state: "ACTION_REQUIRED",
      code: "OWNER_CANCELLED",
    });
    expect(fixture.submit).not.toHaveBeenCalled();
    expect(fixture.observe).not.toHaveBeenCalled();
    expect(
      fixture.events.some((event) => event.startsWith("videoforge_settle_hosted_api_failure")),
    ).toBe(false);
  });

  it("drains a paid image sibling after video failure without submitting old PREPARED work", async () => {
    fixture.videos = videoJobs("FAILED");
    fixture.videos[0]!.failureCode = "SEEDANCE_PROVIDER_FAILED";
    fixture.apiJobs = apiJobs("PREPARED", 2);
    fixture.apiJobs[1]!.state = "SUBMITTED";
    fixture.apiJobs[1]!.providerTaskId = "kie-paid";
    fixture.apiJobs[1]!.providerAccount = {
      id: "kie-legacy",
      provider: "KIE",
      credentialVersion: "v1",
    };
    fixture.observeImage.mockResolvedValue({
      state: "SUCCEEDED",
      artifact: {
        sha256: digest,
        byteSize: 1024,
        contentType: "image/png",
        width: 1920,
        height: 1080,
      },
    });
    expect((await run(advanceHostedApiGeneration(environment, database, scope))).state).toBe(
      "PROGRESSED",
    );
    expect(fixture.apiJobs.map((job) => job.state)).toEqual(["PREPARED", "SUCCEEDED"]);
    expect(await run(advanceHostedApiGeneration(environment, database, scope))).toMatchObject({
      state: "ACTION_REQUIRED",
      code: "SEEDANCE_PROVIDER_FAILED",
    });
    expect(fixture.submit).not.toHaveBeenCalled();
    expect(
      fixture.events.some((event) => event.startsWith("videoforge_claim_hosted_api_job")),
    ).toBe(false);
    expect(fixture.observeImage).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "kie-paid" }),
    );
  });
});

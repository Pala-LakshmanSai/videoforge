// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { advanceHostedApiGeneration } from "./hosted-api-generation";

const fixture = vi.hoisted(() => ({
  jobs: [] as Record<string, unknown>[],
  events: [] as string[],
  observeImage: vi.fn(),
  observeAvatar: vi.fn(),
}));
vi.mock("./configuration", () => ({
  hostedRuntimeConfiguration: () => ({
    r2: {},
    apiGeneration: { kieApiKey: "fixture", falApiKey: "fixture" },
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
        const name = sql.match(/public\.(\w+)\(/)?.[1];
        fixture.events.push(String(name));
        if (name === "videoforge_read_hosted_api_jobs")
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
        if (name === "videoforge_claim_hosted_api_job") {
          job.state = "SUBMITTING";
          job.claimId = args[4];
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
  }));
}

describe("hosted API batch execution", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fixture.jobs = jobs("PREPARED");
    fixture.events = [];
    fixture.observeImage.mockReset();
    fixture.observeAvatar.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
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
      expect(fixture.events.indexOf("videoforge_claim_hosted_api_job")).toBeLessThan(
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

  it("visits every outstanding result once and advances immediately after acceptance", async () => {
    fixture.jobs = jobs("SUBMITTED");
    fixture.jobs[1]!.lane = "AVATAR";
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

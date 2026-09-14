import { beforeEach, expect, it, vi } from "vitest";
import { sha256 } from "./crypto";
import { canonicalJson, type HostedSpanAudioSubmission } from "./submission";
import { scheduleHostedSpanAudioSubmission } from "./app";

const fixture = vi.hoisted(() => ({
  requestHash: "",
  state: "PLANNED",
  launchState: "OUTBOXED",
  failLaunch: false,
  query: vi.fn(),
}));
vi.mock("./neon", () => ({
  createNeonPool: () => ({ end: async () => {} }),
  createNeonExecutor: () => ({
    transaction: async (run: (value: unknown) => unknown) => run({ query: fixture.query }),
  }),
}));
const attemptId = "66666666-6666-4666-8666-666666666666";
const accountId = "11111111-1111-4111-8111-111111111111";
const workspaceId = "22222222-2222-4222-8222-222222222222";
const digest = `sha256:${"a".repeat(64)}`;
const submission: HostedSpanAudioSubmission = {
  kind: "SPAN_AUDIO",
  idempotencyKey: "span-audio:fixture",
  projectId: "44444444-4444-4444-8444-444444444444",
  projectRevisionId: "55555555-5555-4555-8555-555555555555",
  inputDocument: {
    schema_version: "selected-span-audio-job/v1",
    output: {},
    output_profile: "SOULX_PCM16_48K_MONO",
  },
  objects: [
    {
      receiptId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      uri: `vf-local://objects/sha256/aa/${"a".repeat(64)}.wav`,
    },
  ],
};
const bucket = { head: vi.fn(), put: vi.fn(), delete: vi.fn() };
const workflow = { create: vi.fn() };
const environment = { PRIVATE_ARTIFACTS: bucket, VIDEO_WORKFLOW: workflow } as never;
const config = {
  publicOrigin: "https://videoforge.example",
  neon: { databaseUrl: "postgres://unused" },
  workflowCallbackSecret: "fixture-secret",
  mediaWorkerRelease: { executionBundleSha256: digest, whisperModelSha256: digest },
} as never;
const schedule = () =>
  scheduleHostedSpanAudioSubmission(environment, config, {
    accountId,
    workspaceId,
    expectedAttemptId: attemptId,
    submission,
  });

beforeEach(async () => {
  vi.clearAllMocks();
  fixture.requestHash = await sha256(canonicalJson(submission));
  fixture.state = "PLANNED";
  fixture.launchState = "OUTBOXED";
  fixture.failLaunch = false;
  bucket.head.mockResolvedValue(null);
  bucket.put.mockResolvedValue(undefined);
  bucket.delete.mockResolvedValue(undefined);
  fixture.query.mockImplementation(async (sql: string) => {
    if (sql.includes("SELECT set_config")) return { rows: [] };
    if (sql.includes("render_plan.schema_version")) return { rows: [{}] };
    if (sql.includes("FROM artifact_receipts"))
      return {
        rows: [
          {
            id: submission.objects[0]!.receiptId,
            object_key: "source",
            content_type: "audio/wav",
            content_length: 100,
            checksum_sha256: digest,
          },
        ],
      };
    if (sql.includes("SELECT id, request_sha256"))
      return {
        rows: [
          {
            id: attemptId,
            state: fixture.state,
            request_sha256: fixture.requestHash,
            image_digest: digest,
          },
        ],
      };
    if (sql.includes("SELECT attempt.id, attempt.state")) {
      if (fixture.failLaunch) throw Error("database unavailable");
      return { rows: [{ id: attemptId, state: fixture.launchState }] };
    }
    if (sql.includes("SET state = 'FAILED'"))
      return {
        rows:
          fixture.launchState === "PLANNED"
            ? [{ account_id: accountId, workspace_id: workspaceId }]
            : [],
      };
    if (sql.includes("INSERT INTO hosted_cpu_job_events")) return { rows: [] };
    throw Error(`Unexpected query: ${sql}`);
  });
});

it("keeps the committed template when another scheduler wins before outbox", async () => {
  expect(await schedule()).toEqual({ state: "OUTBOXED" });
  expect(bucket.put).toHaveBeenCalledOnce();
  expect(bucket.delete).not.toHaveBeenCalled();
  expect(workflow.create).not.toHaveBeenCalled();
});
it("restores a missing running span template without replaying its workflow", async () => {
  fixture.state = "RUNNING";
  fixture.launchState = "RUNNING";
  expect(await schedule()).toEqual({ state: "RUNNING" });
  expect(bucket.put).toHaveBeenCalledOnce();
  expect(workflow.create).not.toHaveBeenCalled();
  expect(bucket.delete).not.toHaveBeenCalled();
});
it("does not delete a committed template after an uncertain transaction failure", async () => {
  fixture.failLaunch = true;
  await expect(schedule()).rejects.toThrow("database unavailable");
  expect(bucket.delete).not.toHaveBeenCalled();
});
it("cleans up only after this scheduler terminally fails an uncommitted attempt", async () => {
  fixture.launchState = "PLANNED";
  fixture.failLaunch = true;
  await expect(schedule()).rejects.toThrow("database unavailable");
  expect(bucket.delete).toHaveBeenCalledOnce();
});
it("keeps an existing durable span submission idempotent", async () => {
  fixture.state = "RUNNING";
  bucket.head.mockResolvedValue({ size: 100 });
  expect(await schedule()).toEqual({ state: "RUNNING" });
  expect(bucket.put).not.toHaveBeenCalled();
});

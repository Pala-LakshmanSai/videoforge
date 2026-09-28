import { beforeEach, expect, it, vi } from "vitest";
import { sha256 } from "./crypto";
import { canonicalJson, type HostedSpanAudioSubmission } from "./submission";
import { scheduleHostedSpanAudioSubmission } from "./app";

const fixture = vi.hoisted(() => ({
  requestHash: "",
  state: "PLANNED",
  launchState: "OUTBOXED",
  failLaunch: false,
  revisionBackend: "PERSONAL_WORKER",
  attemptBackend: "PERSONAL_WORKER",
  attemptDigest: "",
  existingAttempt: true,
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
  fixture.revisionBackend = "PERSONAL_WORKER";
  fixture.attemptBackend = "PERSONAL_WORKER";
  fixture.attemptDigest = digest;
  fixture.existingAttempt = true;
  bucket.head.mockResolvedValue(null);
  bucket.put.mockResolvedValue(undefined);
  bucket.delete.mockResolvedValue(undefined);
  fixture.query.mockImplementation(async (sql: string) => {
    if (sql.includes("SELECT set_config")) return { rows: [] };
    if (sql.includes("render_plan.schema_version")) return { rows: [{ media_execution_backend: fixture.revisionBackend }] };
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
    if (sql.includes("SELECT id, request_sha256") && !fixture.existingAttempt) return { rows: [] };
    if (sql.includes("SELECT id, request_sha256"))
      return {
        rows: [
          {
            id: attemptId,
            state: fixture.state,
            request_sha256: fixture.requestHash,
            image_digest: fixture.attemptDigest,
            execution_backend: fixture.attemptBackend,
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
    if (sql.includes("INSERT INTO hosted_cpu_job_attempts") || sql.includes("INSERT INTO hosted_cpu_upload_authorities") || sql.includes("INSERT INTO media_worker_input_objects")) return { rows: [] };
    if (sql.includes("SET state = 'OUTBOXED'")) return { rows: [{ id: attemptId }] };
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

const cloudDigest = `sha256:${"b".repeat(64)}`;
const cloudConfig = {
  ...(config as object),
  cloudMedia: {
    sourceSha256: cloudDigest,
    image: `ghcr.io/example/media@${cloudDigest}`,
    runtimeSha256: digest,
    registryId: "qualified-registry",
    tooling: { whisper_model_sha256: digest, whisper_version: "1.8.4", ffmpeg_version: "8.1.2", ffprobe_version: "8.1.2" },
  },
} as never;
const scheduleCloud = () => scheduleHostedSpanAudioSubmission(environment, cloudConfig, {
  accountId, workspaceId, expectedAttemptId: attemptId, submission,
});
it("replays the exact Cloud span with no personal device or new workflow", async () => {
  fixture.revisionBackend = "RUNPOD_POD";
  fixture.attemptBackend = "RUNPOD_POD";
  fixture.attemptDigest = cloudDigest;
  fixture.state = "RUNNING";
  bucket.head.mockResolvedValue({ size: 100 });
  expect(await scheduleCloud()).toEqual({ state: "RUNNING" });
  expect(workflow.create).not.toHaveBeenCalled();
  expect(bucket.put).not.toHaveBeenCalled();
});
it("rejects rebinding an existing Local span to Cloud", async () => {
  fixture.revisionBackend = "RUNPOD_POD";
  await expect(scheduleCloud()).rejects.toThrow("HOSTED_V209_SPAN_SCHEDULE_REJECTED");
  expect(workflow.create).not.toHaveBeenCalled();
  expect(bucket.put).not.toHaveBeenCalled();
});
it("keeps an unqualified Cloud span inert", async () => {
  fixture.revisionBackend = "RUNPOD_POD";
  await expect(schedule()).rejects.toThrow("HOSTED_V209_SPAN_SCHEDULE_REJECTED");
  expect(workflow.create).not.toHaveBeenCalled();
  expect(bucket.put).not.toHaveBeenCalled();
});

it("persists a fresh Cloud span and Linux tooling without desktop enrollment", async () => {
  fixture.revisionBackend = "RUNPOD_POD";
  fixture.existingAttempt = false;
  fixture.launchState = "PLANNED";
  workflow.create.mockResolvedValueOnce({ id: attemptId });
  expect(await scheduleCloud()).toEqual({ state: "OUTBOXED" });
  const insert = fixture.query.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO hosted_cpu_job_attempts"));
  expect(insert?.[1]?.[14]).toBe("RUNPOD_POD");
  expect(insert?.[1]?.[12]).toBe(cloudDigest);
  const bytes = bucket.put.mock.calls[0]?.[1] as ArrayBuffer;
  const template = JSON.parse(new TextDecoder().decode(bytes));
  expect(template.schema_version).toBe("videoforge-cloud-media-job-template/v1");
  expect(template.runtime_identity).toEqual({ image: `ghcr.io/example/media@${cloudDigest}`, registry_id: "qualified-registry",
    source_sha256: cloudDigest, runtime_sha256: digest });
  expect(template.tooling).toEqual((cloudConfig as { cloudMedia: { tooling: unknown } }).cloudMedia.tooling);
  expect(workflow.create).toHaveBeenCalledExactlyOnceWith({ id: attemptId, params: { attemptId, accountId, workspaceId } });
  expect(fixture.query.mock.calls.some(([sql]) => String(sql).includes("media_worker_devices"))).toBe(false);
});

it("rejects overwriting a planned Cloud template when the qualified runtime identity changes", async () => {
  fixture.revisionBackend = "RUNPOD_POD"; fixture.attemptBackend = "RUNPOD_POD";
  fixture.attemptDigest = cloudDigest; fixture.state = "PLANNED";
  await expect(scheduleCloud()).rejects.toThrow("HOSTED_V209_SPAN_SCHEDULE_REJECTED");
  expect(bucket.put).not.toHaveBeenCalled(); expect(workflow.create).not.toHaveBeenCalled();
});

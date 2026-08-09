import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CreateProjectRequest, Sha256Digest } from "@videoforge/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApiApp } from "../app";
import type {
  LocalOwnedVoiceover,
  LocalPipelineRunRequest,
  LocalPipelineRunResult,
  LocalSliceRunner,
} from "./types";

const VOICEOVER_SHA = `sha256:${"a".repeat(64)}` as Sha256Digest;
const OUTPUT_SHA = `sha256:${"b".repeat(64)}` as Sha256Digest;
const DOCUMENT_SHA = `sha256:${"c".repeat(64)}` as Sha256Digest;
const PROJECT_ID = "project_local_owned_001";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })));
});

function mutationHeaders(ifMatch?: string, idempotencyKey: string = crypto.randomUUID()) {
  return {
    "content-type": "application/json",
    "idempotency-key": idempotencyKey,
    ...(ifMatch ? { "if-match": ifMatch } : {}),
  };
}

function createRequest(assetId: string): CreateProjectRequest {
  return {
    title: "How to Recognize a Sweet Watermelon — Local Slice",
    voiceover_asset_id: assetId,
    avatar_profile_version_id: "avatar_profile_version_fixture_001",
    image_style_version_id: "style_version_documentary_stock_v1",
    optional_script: null,
    extra_prompt_keywords: null,
    apply_extra_prompt_keywords: false,
    generation_mode: "BALANCED",
    execution_profile_overrides: null,
    spend_cap_usd: 0.1,
    user_seed: 20260809,
  };
}

class ControlledRunner implements LocalSliceRunner {
  readonly runRequests: LocalPipelineRunRequest[] = [];
  readonly voiceover: LocalOwnedVoiceover;
  readonly output: LocalPipelineRunResult;
  private resolveRun!: (result: LocalPipelineRunResult) => void;
  private rejectRun!: (error: Error) => void;
  private readonly completion = new Promise<LocalPipelineRunResult>((resolve, reject) => {
    this.resolveRun = resolve;
    this.rejectRun = reject;
  });

  private constructor(voiceover: LocalOwnedVoiceover, output: LocalPipelineRunResult) {
    this.voiceover = voiceover;
    this.output = output;
  }

  static async create(): Promise<ControlledRunner> {
    const root = await mkdtemp(join(tmpdir(), "videoforge-local-api-test-"));
    temporaryRoots.push(root);
    const source = join(root, "owned-voiceover.wav");
    const preview = join(root, "videoforge-local-owned-slice.mp4");
    await writeFile(source, "owned voiceover bytes");
    await writeFile(preview, "synthetic mp4 bytes for byte range delivery");
    return new ControlledRunner(
      {
        assetId: `fixture_voiceover_sha256_${"a".repeat(64)}`,
        checksum: VOICEOVER_SHA,
        filename: "videoforge-owned-local-slice.wav",
        absolutePath: source,
        bytes: 21,
        durationSeconds: 40,
        sampleRate: 48_000,
        channels: 1,
      },
      {
        previewPath: preview,
        filename: "videoforge-local-owned-slice.mp4",
        sha256: OUTPUT_SHA,
        bytes: 43,
        durationMs: 40_000,
        totalFrames: 1_200,
        transcriptSha256: DOCUMENT_SHA,
        timelineSha256: DOCUMENT_SHA,
        resolvedRenderManifestSha256: DOCUMENT_SHA,
        renderResultSha256: DOCUMENT_SHA,
        evidencePath: join(root, "evidence.json"),
      },
    );
  }

  prepareOwnedVoiceover(): Promise<LocalOwnedVoiceover> {
    return Promise.resolve(this.voiceover);
  }

  async run(request: LocalPipelineRunRequest): Promise<LocalPipelineRunResult> {
    this.runRequests.push(request);
    request.onProgress({
      stage: "TRANSCRIBING",
      detail: "whisper.cpp is producing canonical word timing",
    });
    const result = await this.completion;
    request.onProgress({ stage: "PROBING", detail: "FFprobe is validating the real MP4" });
    return result;
  }

  complete(): void {
    this.resolveRun(this.output);
  }

  fail(message: string): void {
    this.rejectRun(new Error(message));
  }
}

async function localApp() {
  const runner = await ControlledRunner.create();
  return {
    runner,
    app: createApiApp({
      commit: "abcdef1234567890",
      environment: "test",
      mode: "local",
      localRunner: runner,
    }),
  };
}

async function bootstrap(app: Awaited<ReturnType<typeof localApp>>["app"]) {
  const response = await app.request("/api/v1/bootstrap?fixture=happy_generating");
  expect(response.status).toBe(200);
  return (await response.json()) as {
    draft: { voiceover: { assetId: string; durationSeconds: number }; spendCapUsd: number };
  };
}

async function createLocalProject(
  app: Awaited<ReturnType<typeof localApp>>["app"],
  assetId: string,
  idempotencyKey = "local-create-001",
) {
  return app.request("/api/v1/projects?fixture=happy_generating", {
    method: "POST",
    headers: mutationHeaders(undefined, idempotencyKey),
    body: JSON.stringify(createRequest(assetId)),
  });
}

async function waitForReady(app: Awaited<ReturnType<typeof localApp>>["app"]) {
  let body: Record<string, unknown> | null = null;
  await vi.waitFor(async () => {
    const response = await app.request(`/api/v1/projects/${PROJECT_ID}`);
    expect(response.status).toBe(200);
    body = (await response.json()) as Record<string, unknown>;
    expect((body.project as { status: string }).status).toBe("READY_FOR_REVIEW");
  });
  return body as unknown as {
    project: {
      versionToken: string;
      latestArtifact: { sha256: string; bytes: number; filename: string };
      review: { candidateId: string; candidateSha256: string };
    };
  };
}

describe("local walking-slice API", () => {
  it("requires the Node entry point to inject an explicit local media runner", () => {
    expect(() => createApiApp({ mode: "local", environment: "test" })).toThrow(
      "Local mode requires an explicit Node media runner.",
    );
  });

  it("reports truthful local health and owned persisted voiceover facts", async () => {
    const { app, runner } = await localApp();
    const health = await app.request("/api/health?fixture=project_create_ready");
    expect(health.status).toBe(200);
    expect(health.headers.get("x-videoforge-provider-mode")).toBe("local");
    await expect(health.json()).resolves.toEqual({
      app: "videoforge",
      status: "ok",
      mode: "local",
      commit: "abcdef1234567890",
      fixture_id: null,
      synthetic: true,
      provider_calls_authorized: false,
      authorized_spend_usd: 0,
    });

    const boot = await bootstrap(app);
    expect(boot.draft).toMatchObject({
      voiceover: { assetId: runner.voiceover.assetId, durationSeconds: 40 },
      spendCapUsd: 0.1,
    });
    const voiceover = await app.request(`/api/v1/voiceovers/${runner.voiceover.assetId}`);
    expect(voiceover.status).toBe(200);
    await expect(voiceover.json()).resolves.toMatchObject({
      checksum: VOICEOVER_SHA,
      persistedBytes: true,
      providerCallsAuthorized: false,
    });
  });

  it("preserves preflight and idempotent create semantics while starting one real runner", async () => {
    const { app, runner } = await localApp();
    const assetId = (await bootstrap(app)).draft.voiceover.assetId;
    const request = createRequest(assetId);
    const preflight = await app.request("/api/v1/projects/preflight?fixture=happy_generating", {
      method: "POST",
      headers: mutationHeaders(undefined, "local-preflight-001"),
      body: JSON.stringify(request),
    });
    expect(preflight.status).toBe(200);
    await expect(preflight.json()).resolves.toMatchObject({
      status: "READY",
      estimatedCostUsd: 0,
      providerCallsAuthorized: false,
    });

    const first = await createLocalProject(app, assetId);
    expect(first.status).toBe(202);
    await expect(first.json()).resolves.toMatchObject({
      id: PROJECT_ID,
      status: "QUEUED",
      providerCallsAuthorized: false,
    });
    const replay = await createLocalProject(app, assetId);
    expect(replay.status).toBe(202);
    expect(replay.headers.get("x-videoforge-idempotent-replay")).toBe("true");
    expect(runner.runRequests).toHaveLength(1);

    const running = await app.request(`/api/v1/projects/${PROJECT_ID}`);
    await expect(running.json()).resolves.toMatchObject({
      project: { status: "RUNNING", stage: "TRANSCRIBING", actualCost: 0 },
    });
  });

  it("serves byte ranges, binds exact approval, and downloads the accepted MP4", async () => {
    const { app, runner } = await localApp();
    const assetId = (await bootstrap(app)).draft.voiceover.assetId;
    await createLocalProject(app, assetId);
    runner.complete();
    const ready = await waitForReady(app);
    expect(ready.project.latestArtifact).toEqual({
      sha256: OUTPUT_SHA,
      bytes: runner.output.bytes,
      filename: runner.output.filename,
      kind: "VIDEO",
      url: `/api/v1/projects/${PROJECT_ID}/preview`,
      label: "Local synthetic 1080p30 MP4",
    });

    const range = await app.request(`/api/v1/projects/${PROJECT_ID}/preview`, {
      headers: { range: "bytes=0-8" },
    });
    expect(range.status).toBe(206);
    expect(range.headers.get("content-range")).toBe(`bytes 0-8/${runner.output.bytes}`);
    expect(await range.text()).toBe("synthetic");

    const earlyDownload = await app.request(`/api/v1/projects/${PROJECT_ID}/download`);
    expect(earlyDownload.status).toBe(409);

    const wrongApproval = await app.request(`/api/v1/projects/${PROJECT_ID}/approve`, {
      method: "POST",
      headers: mutationHeaders(ready.project.versionToken, "local-approval-wrong"),
      body: JSON.stringify({
        project_id: PROJECT_ID,
        candidate_id: ready.project.review.candidateId,
        candidate_sha256: `sha256:${"d".repeat(64)}`,
      }),
    });
    expect(wrongApproval.status).toBe(409);

    const approval = await app.request(`/api/v1/projects/${PROJECT_ID}/approve`, {
      method: "POST",
      headers: mutationHeaders(ready.project.versionToken, "local-approval-correct"),
      body: JSON.stringify({
        project_id: PROJECT_ID,
        candidate_id: ready.project.review.candidateId,
        candidate_sha256: ready.project.review.candidateSha256,
      }),
    });
    expect(approval.status).toBe(200);
    await expect(approval.json()).resolves.toMatchObject({
      status: "APPROVED",
      candidateSha256: OUTPUT_SHA,
      downloadUrl: `/api/v1/projects/${PROJECT_ID}/download`,
    });

    const download = await app.request(`/api/v1/projects/${PROJECT_ID}/download`);
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toBe("video/mp4");
    expect(download.headers.get("x-content-sha256")).toBe(OUTPUT_SHA);
    expect(download.headers.get("content-disposition")).toBe(
      'attachment; filename="videoforge-local-owned-slice.mp4"',
    );
    expect(await download.text()).toBe("synthetic mp4 bytes for byte range delivery");
  });

  it("surfaces cancellation and retryable failures as authoritative project state", async () => {
    const cancelling = await localApp();
    const cancelAssetId = (await bootstrap(cancelling.app)).draft.voiceover.assetId;
    await createLocalProject(cancelling.app, cancelAssetId);
    const runningResponse = await cancelling.app.request(`/api/v1/projects/${PROJECT_ID}`);
    const running = (await runningResponse.json()) as { project: { versionToken: string } };
    const cancelled = await cancelling.app.request(`/api/v1/projects/${PROJECT_ID}/cancel`, {
      method: "POST",
      headers: mutationHeaders(running.project.versionToken, "local-cancel-001"),
      body: JSON.stringify({ project_id: PROJECT_ID }),
    });
    expect(cancelled.status).toBe(202);
    expect(cancelling.runner.runRequests[0]?.signal.aborted).toBe(true);
    const cancelledState = await cancelling.app.request(`/api/v1/projects/${PROJECT_ID}`);
    await expect(cancelledState.json()).resolves.toMatchObject({
      project: { status: "CANCEL_REQUESTED" },
    });

    const failing = await localApp();
    const failureAssetId = (await bootstrap(failing.app)).draft.voiceover.assetId;
    await createLocalProject(failing.app, failureAssetId);
    failing.runner.fail("Pinned whisper.cpp process exited with code 9");
    let failedVersion = "";
    await vi.waitFor(async () => {
      const response = await failing.app.request(`/api/v1/projects/${PROJECT_ID}`);
      const body = (await response.json()) as {
        project: { status: string; versionToken: string; allowedActions: string[] };
        notice: { detail: string };
      };
      expect(body.project.status).toBe("NEEDS_ATTENTION");
      expect(body.project.allowedActions).toContain("RETRY_FAILED_ITEMS");
      expect(body.notice.detail).toContain("code 9");
      failedVersion = body.project.versionToken;
    });
    const retried = await failing.app.request(`/api/v1/projects/${PROJECT_ID}/retry`, {
      method: "POST",
      headers: mutationHeaders(failedVersion, "local-retry-001"),
      body: JSON.stringify({ project_id: PROJECT_ID }),
    });
    expect(retried.status).toBe(202);
    expect(failing.runner.runRequests).toHaveLength(2);
  });

  it("does not expose local development routes in production", async () => {
    const runner = await ControlledRunner.create();
    const app = createApiApp({
      commit: "abcdef1234567890",
      environment: "production",
      mode: "local",
      localRunner: runner,
    });
    const response = await app.request("/api/health");
    expect(response.status).toBe(404);
    expect(runner.runRequests).toHaveLength(0);
  });
});

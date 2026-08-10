import { createHash } from "node:crypto";
import { mkdtemp, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  canonicalizeJson,
  type CreateProjectRequest,
  type Sha256Digest,
} from "@videoforge/contracts";
import { LocalArtifactStore } from "@videoforge/pipeline";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApiApp as createRuntimeApiApp } from "../app";
import { createLocalApiApp } from "./app";
import type {
  LocalOwnedVoiceover,
  LocalPipelineRunRequest,
  LocalPipelineRunResult,
  LocalSliceRunner,
} from "./types";

function createApiApp(options: {
  readonly commit?: string;
  readonly environment?: "development" | "test" | "production";
  readonly mode: "local";
  readonly localRunner?: LocalSliceRunner;
}) {
  return createRuntimeApiApp({
    configuration: {
      commit: options.commit ?? "uncommitted",
      environment: options.environment ?? "development",
      mode: options.mode,
    },
    bindings: {
      platform: "node",
      localRunner: options.localRunner,
      localAppFactory: createLocalApiApp,
    },
  });
}

const VOICEOVER_SHA = `sha256:${"a".repeat(64)}` as Sha256Digest;
const OUTPUT_CONTENT = Buffer.from("synthetic mp4 bytes for byte range delivery", "utf8");
const OUTPUT_SHA =
  `sha256:${createHash("sha256").update(OUTPUT_CONTENT).digest("hex")}` as Sha256Digest;
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
  output: LocalPipelineRunResult;
  readonly previewPath: string;
  readonly transcriptPath: string;
  restoreCalls = 0;
  private resolveRun!: (result: LocalPipelineRunResult) => void;
  private rejectRun!: (error: Error) => void;
  private readonly completion = new Promise<LocalPipelineRunResult>((resolve, reject) => {
    this.resolveRun = resolve;
    this.rejectRun = reject;
  });

  private constructor(
    voiceover: LocalOwnedVoiceover,
    output: LocalPipelineRunResult,
    previewPath: string,
    transcriptPath: string,
    private readonly restoreOnBootstrap: boolean,
  ) {
    this.voiceover = voiceover;
    this.output = output;
    this.previewPath = previewPath;
    this.transcriptPath = transcriptPath;
  }

  static async create(
    options: { readonly restoreOnBootstrap?: boolean } = {},
  ): Promise<ControlledRunner> {
    const root = await mkdtemp(join(tmpdir(), "videoforge-local-api-test-"));
    temporaryRoots.push(root);
    const source = join(root, "owned-voiceover.wav");
    await writeFile(source, "owned voiceover bytes");
    const store = await LocalArtifactStore.create(join(root, "artifacts"));
    const preview = await store.putObject(OUTPUT_CONTENT, "mp4");
    const firstSpan = await store.putObject(Buffer.alloc(208_044, 0x31), "wav");
    const secondSpan = await store.putObject(Buffer.alloc(192_044, 0x32), "wav");
    const transcript = await store.putObject(
      Buffer.from(
        canonicalizeJson({
          schema_version: "transcript-timing/v1",
          project_revision_id: "revision_local_owned_001",
          source: {
            asset_id: `fixture_voiceover_sha256_${"a".repeat(64)}`,
            sha256: VOICEOVER_SHA,
            duration_ms: 40_000,
          },
          engine: {
            name: "whisper.cpp",
            version: "1.8.4",
            model_name: "base.en",
            model_sha256: `sha256:${"b".repeat(64)}`,
            language: "en",
          },
          text: "Check the field spot. Feel the weight. Inspect the stem. Compare every sign.",
          words: [
            { index: 0, text: "Check", start_ms: 400, end_ms: 3_800, confidence: 0.99 },
            { index: 1, text: "field", start_ms: 6_400, end_ms: 10_200, confidence: 0.98 },
            { index: 2, text: "weight", start_ms: 13_400, end_ms: 17_500, confidence: 0.98 },
            { index: 3, text: "stem", start_ms: 20_400, end_ms: 24_600, confidence: 0.97 },
            { index: 4, text: "compare", start_ms: 27_400, end_ms: 30_900, confidence: 0.99 },
            { index: 5, text: "signs", start_ms: 32_400, end_ms: 39_500, confidence: 0.98 },
          ],
          phrases: [
            {
              phrase_id: "phrase_local_001",
              sentence_id: "sentence_local_001",
              word_start: 0,
              word_end_exclusive: 1,
              start_ms: 400,
              end_ms: 3_800,
              pause_before_ms: 400,
              pause_after_ms: 2_600,
              text: "Check the field spot.",
            },
            {
              phrase_id: "phrase_local_002",
              sentence_id: "sentence_local_002",
              word_start: 1,
              word_end_exclusive: 2,
              start_ms: 6_400,
              end_ms: 10_200,
              pause_before_ms: 2_600,
              pause_after_ms: 3_200,
              text: "Feel the weight.",
            },
            {
              phrase_id: "phrase_local_003",
              sentence_id: "sentence_local_003",
              word_start: 2,
              word_end_exclusive: 3,
              start_ms: 13_400,
              end_ms: 17_500,
              pause_before_ms: 3_200,
              pause_after_ms: 2_900,
              text: "Inspect the surface.",
            },
            {
              phrase_id: "phrase_local_004",
              sentence_id: "sentence_local_004",
              word_start: 3,
              word_end_exclusive: 4,
              start_ms: 20_400,
              end_ms: 24_600,
              pause_before_ms: 2_900,
              pause_after_ms: 2_800,
              text: "Inspect the stem.",
            },
            {
              phrase_id: "phrase_local_005",
              sentence_id: "sentence_local_005",
              word_start: 4,
              word_end_exclusive: 5,
              start_ms: 27_400,
              end_ms: 30_900,
              pause_before_ms: 2_800,
              pause_after_ms: 1_500,
              text: "Compare every sign.",
            },
            {
              phrase_id: "phrase_local_006",
              sentence_id: "sentence_local_006",
              word_start: 5,
              word_end_exclusive: 6,
              start_ms: 32_400,
              end_ms: 39_500,
              pause_before_ms: 1_500,
              pause_after_ms: 500,
              text: "Choose with confidence.",
            },
          ],
        }),
        "utf8",
      ),
      "json",
    );
    const timeline = await store.putObject(
      Buffer.from(
        canonicalizeJson({
          schema_version: "timeline-plan/v1",
          project_revision_id: "revision_local_owned_001",
          revision_config_hash: `sha256:${"d".repeat(64)}`,
          scheduler_version: "scheduler-v1",
          seed: 2_026_080_9,
          output_fps_num: 30,
          output_fps_den: 1,
          total_frames: 1_200,
          segments: [
            {
              segment_id: "segment_local_001",
              start_frame: 0,
              end_frame_exclusive: 180,
              source_audio_start_ms: 0,
              source_audio_end_ms: 6_000,
              timeline_composition: "AVATAR_FULL",
              phrase: "Check the field spot.",
              word_start: 0,
              word_end_exclusive: 1,
              required_slots: {
                avatar: {
                  task_key: "avatar:segment_local_001",
                  span_audio_task_key: "audio-span:segment_local_001",
                },
              },
            },
            {
              segment_id: "segment_local_002",
              start_frame: 180,
              end_frame_exclusive: 390,
              source_audio_start_ms: 6_000,
              source_audio_end_ms: 13_000,
              timeline_composition: "IMAGE_FULL",
              phrase: "Feel the weight.",
              word_start: 1,
              word_end_exclusive: 2,
              in_image_shot_role: "HANDS_ACTION",
              required_slots: { image: { task_key: "image:segment_local_002" } },
            },
            {
              segment_id: "segment_local_003",
              start_frame: 390,
              end_frame_exclusive: 600,
              source_audio_start_ms: 13_000,
              source_audio_end_ms: 20_000,
              timeline_composition: "IMAGE_FULL",
              phrase: "Inspect the surface.",
              word_start: 2,
              word_end_exclusive: 3,
              in_image_shot_role: "MACRO_DETAIL",
              required_slots: { image: { task_key: "image:segment_local_003" } },
            },
            {
              segment_id: "segment_local_004",
              start_frame: 600,
              end_frame_exclusive: 810,
              source_audio_start_ms: 20_000,
              source_audio_end_ms: 27_000,
              timeline_composition: "IMAGE_FULL",
              phrase: "Inspect the stem.",
              word_start: 3,
              word_end_exclusive: 4,
              in_image_shot_role: "OBJECT_EVIDENCE",
              required_slots: { image: { task_key: "image:segment_local_004" } },
            },
            {
              segment_id: "segment_local_005",
              start_frame: 810,
              end_frame_exclusive: 960,
              source_audio_start_ms: 27_000,
              source_audio_end_ms: 32_000,
              timeline_composition: "AVATAR_SPLIT_IMAGE",
              phrase: "Compare every sign.",
              word_start: 4,
              word_end_exclusive: 5,
              in_image_shot_role: "REACTION_RESULT",
              required_slots: {
                avatar: {
                  task_key: "avatar:segment_local_005",
                  span_audio_task_key: "audio-span:segment_local_005",
                },
                right_image: { task_key: "image:segment_local_005:right" },
              },
            },
            {
              segment_id: "segment_local_006",
              start_frame: 960,
              end_frame_exclusive: 1_200,
              source_audio_start_ms: 32_000,
              source_audio_end_ms: 40_000,
              timeline_composition: "IMAGE_FULL",
              phrase: "Choose with confidence.",
              word_start: 5,
              word_end_exclusive: 6,
              in_image_shot_role: "HUMAN_MEDIUM",
              required_slots: { image: { task_key: "image:segment_local_006" } },
            },
          ],
        }),
        "utf8",
      ),
      "json",
    );
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
        artifactRoot: store.root,
        sourceVoiceoverSha256: VOICEOVER_SHA,
        filename: "videoforge-local-owned-slice.mp4",
        sha256: OUTPUT_SHA,
        bytes: OUTPUT_CONTENT.byteLength,
        durationMs: 40_000,
        totalFrames: 1_200,
        transcriptSha256: transcript.sha256,
        timelineSha256: timeline.sha256,
        resolvedRenderManifestSha256: DOCUMENT_SHA,
        renderResultSha256: DOCUMENT_SHA,
        selectedSpanAudio: [
          {
            spanId: "span_local_001",
            timelineSegmentId: "segment_local_001",
            taskKey: "audio-span:segment_local_001",
            selectedStartMs: 0,
            selectedEndMsExclusive: 6_000,
            paddedStartMs: 0,
            paddedEndMsExclusive: 6_500,
            trimStartMs: 0,
            trimEndMsExclusive: 6_000,
            sha256: firstSpan.sha256,
            bytes: firstSpan.bytes,
            durationMs: 6_500,
          },
          {
            spanId: "span_local_005",
            timelineSegmentId: "segment_local_005",
            taskKey: "audio-span:segment_local_005",
            selectedStartMs: 27_000,
            selectedEndMsExclusive: 32_000,
            paddedStartMs: 26_500,
            paddedEndMsExclusive: 32_500,
            trimStartMs: 500,
            trimEndMsExclusive: 5_500,
            sha256: secondSpan.sha256,
            bytes: secondSpan.bytes,
            durationMs: 6_000,
          },
        ],
        evidencePath: join(root, "evidence.json"),
        evidenceSha256: DOCUMENT_SHA,
      },
      preview.absolutePath,
      transcript.absolutePath,
      options.restoreOnBootstrap ?? false,
    );
  }

  prepareOwnedVoiceover(): Promise<LocalOwnedVoiceover> {
    return Promise.resolve(this.voiceover);
  }

  restoreLatest(): Promise<LocalPipelineRunResult | null> {
    this.restoreCalls += 1;
    return Promise.resolve(this.restoreOnBootstrap ? this.output : null);
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

  omitLastSelectedSpan(): void {
    this.output = {
      ...this.output,
      selectedSpanAudio: this.output.selectedSpanAudio.slice(0, -1),
    };
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

  it("restores checksum-bound timing and output without starting a new run", async () => {
    const runner = await ControlledRunner.create({ restoreOnBootstrap: true });
    const app = createApiApp({
      commit: "abcdef1234567890",
      environment: "test",
      mode: "local",
      localRunner: runner,
    });
    const response = await app.request("/api/v1/bootstrap");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      projects: [
        {
          id: PROJECT_ID,
          status: "READY_FOR_REVIEW",
          latestArtifact: { sha256: OUTPUT_SHA },
        },
      ],
    });
    expect(runner.restoreCalls).toBe(1);
    expect(runner.runRequests).toHaveLength(0);

    const project = await app.request(`/api/v1/projects/${PROJECT_ID}`);
    await expect(project.json()).resolves.toMatchObject({
      notice: { title: "Persisted local result restored" },
      events: expect.arrayContaining([
        expect.objectContaining({ detail: expect.stringContaining("Restored persisted timing") }),
      ]),
    });
    const inspection = await app.request(`/api/v1/projects/${PROJECT_ID}/timeline-inspection`);
    await expect(inspection.json()).resolves.toMatchObject({
      ready: true,
      invalidation: { state: "CURRENT" },
      selectedAvatar: { count: 2, materializedCount: 2 },
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

  it("inspects exact persisted local timing and fails closed when its bytes drift", async () => {
    const { app, runner } = await localApp();
    const assetId = (await bootstrap(app)).draft.voiceover.assetId;
    await createLocalProject(app, assetId);

    const waiting = await app.request(`/api/v1/projects/${PROJECT_ID}/timeline-inspection`);
    expect(waiting.status).toBe(200);
    await expect(waiting.json()).resolves.toMatchObject({
      sourceMode: "LOCAL_PERSISTED",
      ready: false,
      invalidation: { state: "WAITING", recomputeRequired: false },
      documents: { transcriptSha256: null, timelineSha256: null },
    });

    runner.complete();
    await waitForReady(app);
    const ready = await app.request(`/api/v1/projects/${PROJECT_ID}/timeline-inspection`);
    expect(ready.status).toBe(200);
    const readyBody = (await ready.json()) as {
      ready: boolean;
      invalidation: { state: string };
      timing: { sourceDurationMs: number; phraseCount: number; coverage: string };
      plan: { totalFrames: number; sourceStartMs: number; sourceEndMs: number; coverage: string };
      selectedAvatar: { count: number; materializedCount: number; coveragePercent: number };
      phrases: unknown[];
    };
    expect(readyBody).toMatchObject({
      ready: true,
      invalidation: { state: "CURRENT" },
      timing: { sourceDurationMs: 40_000, phraseCount: 6, coverage: "COMPLETE" },
      plan: {
        totalFrames: 1_200,
        sourceStartMs: 0,
        sourceEndMs: 40_000,
        coverage: "COMPLETE",
      },
      selectedAvatar: { count: 2, materializedCount: 2, coveragePercent: 27.5 },
    });
    expect(readyBody.phrases).toHaveLength(6);

    await writeFile(runner.transcriptPath, Buffer.from("corrupted persisted timing", "utf8"));
    const drifted = await app.request(`/api/v1/projects/${PROJECT_ID}/timeline-inspection`);
    expect(drifted.status).toBe(200);
    await expect(drifted.json()).resolves.toMatchObject({
      ready: false,
      invalidation: { state: "MISMATCHED", recomputeRequired: true },
      timing: null,
      plan: null,
      phrases: [],
    });
  });

  it("fails closed when a selected avatar span was not materialized", async () => {
    const { app, runner } = await localApp();
    const assetId = (await bootstrap(app)).draft.voiceover.assetId;
    runner.omitLastSelectedSpan();
    await createLocalProject(app, assetId);
    runner.complete();
    await waitForReady(app);

    const inspection = await app.request(`/api/v1/projects/${PROJECT_ID}/timeline-inspection`);
    expect(inspection.status).toBe(200);
    await expect(inspection.json()).resolves.toMatchObject({
      ready: false,
      invalidation: { state: "INCOMPLETE", recomputeRequired: true },
      blockers: [expect.stringContaining("no persisted materialized audio")],
    });
  });

  it("fails closed when accepted media is corrupted or replaced by a symlink", async () => {
    const corrupted = await localApp();
    const corruptedAssetId = (await bootstrap(corrupted.app)).draft.voiceover.assetId;
    await createLocalProject(corrupted.app, corruptedAssetId);
    corrupted.runner.complete();
    await waitForReady(corrupted.app);
    await writeFile(corrupted.runner.previewPath, Buffer.alloc(OUTPUT_CONTENT.byteLength, 0x78));

    const corruptedPreview = await corrupted.app.request(`/api/v1/projects/${PROJECT_ID}/preview`);
    expect(corruptedPreview.status).toBe(500);
    expect(corruptedPreview.headers.get("x-content-sha256")).toBeNull();

    const replaced = await localApp();
    const replacedAssetId = (await bootstrap(replaced.app)).draft.voiceover.assetId;
    await createLocalProject(replaced.app, replacedAssetId);
    replaced.runner.complete();
    await waitForReady(replaced.app);
    const replacement = `${replaced.runner.previewPath}.replacement`;
    await writeFile(replacement, OUTPUT_CONTENT);
    await unlink(replaced.runner.previewPath);
    await symlink(replacement, replaced.runner.previewPath);

    const replacedDownload = await replaced.app.request(`/api/v1/projects/${PROJECT_ID}/preview`);
    expect(replacedDownload.status).toBe(500);
    expect(replacedDownload.headers.get("x-content-sha256")).toBeNull();
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
    cancelling.runner.fail("Local process acknowledged cancellation");
    let cancelledVersion = "";
    await vi.waitFor(async () => {
      const response = await cancelling.app.request(`/api/v1/projects/${PROJECT_ID}`);
      const body = (await response.json()) as {
        project: { status: string; versionToken: string; allowedActions: string[] };
      };
      expect(body.project.status).toBe("CANCELLED");
      expect(body.project.allowedActions).toContain("RETRY_FAILED_ITEMS");
      cancelledVersion = body.project.versionToken;
    });
    const retryCancelled = await cancelling.app.request(`/api/v1/projects/${PROJECT_ID}/retry`, {
      method: "POST",
      headers: mutationHeaders(cancelledVersion, "local-retry-cancelled-001"),
      body: JSON.stringify({ project_id: PROJECT_ID }),
    });
    expect(retryCancelled.status).toBe(202);
    expect(cancelling.runner.runRequests).toHaveLength(2);

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

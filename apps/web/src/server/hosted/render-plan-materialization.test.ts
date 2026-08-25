import {
  validateAndHashContractDocument,
  type ResolvedRenderManifestDocument,
} from "@videoforge/contracts";
import { describe, expect, it } from "vitest";

import revisionFixture from "../../../../../packages/contracts/generated/fixtures/project_revision_config.valid.json";
import timelineFixture from "../../../../../packages/contracts/generated/fixtures/timeline_plan.valid.json";
import transcriptFixture from "../../../../../packages/contracts/generated/fixtures/transcript_timing.valid.json";
import {
  materializeHostedRenderPlan,
  type HostedCommittedArtifact,
  type HostedRenderPlanDatabase,
  type HostedRenderPlanMaterializationInput,
  type HostedRenderPlanSql,
} from "./render-plan-materialization";

const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const WORKSPACE = "22222222-2222-4222-8222-222222222222";
const PROJECT = "33333333-3333-4333-8333-333333333333";
const REVISION = "44444444-4444-4444-8444-444444444444";
const VOICEOVER_HASH = `sha256:${"1".repeat(64)}`;
const AVATAR_ONE_HASH = `sha256:${"2".repeat(64)}`;
const IMAGE_ONE_HASH = `sha256:${"3".repeat(64)}`;
const AVATAR_TWO_HASH = `sha256:${"4".repeat(64)}`;
const IMAGE_TWO_HASH = `sha256:${"5".repeat(64)}`;

class MemoryDatabase implements HostedRenderPlanDatabase, HostedRenderPlanSql {
  existing: { payload: unknown; payload_sha256: string } | null = null;
  inserts = 0;

  async transaction<Value>(work: (transaction: HostedRenderPlanSql) => Promise<Value>) {
    return work(this);
  }

  async query<Row extends Record<string, unknown>>(
    sql: string,
    parameters: readonly unknown[] = [],
  ) {
    if (sql.includes("SELECT set_config")) return { rows: [], affectedRows: 1 };
    if (sql.includes("SELECT payload, payload_sha256")) {
      return {
        rows: (this.existing ? [this.existing] : []) as unknown as Row[],
        affectedRows: this.existing ? 1 : 0,
      };
    }
    if (sql.includes("INSERT INTO hosted_render_plans")) {
      if (this.existing) return { rows: [], affectedRows: 0 };
      this.inserts += 1;
      this.existing = {
        payload: JSON.parse(String(parameters[4])),
        payload_sha256: String(parameters[5]),
      };
      return { rows: [], affectedRows: 1 };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }
}

function artifact(
  values: Pick<
    HostedCommittedArtifact,
    "assetId" | "checksumSha256" | "contentType" | "kind" | "lane" | "receiptId" | "taskKey"
  >,
): HostedCommittedArtifact {
  const lane = values.lane.toLowerCase().replace("_", "-");
  const acceptedAttemptId =
    values.kind === "IMAGE"
      ? "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
      : values.kind === "AVATAR_CLIP"
        ? "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
        : null;
  return {
    accountId: ACCOUNT,
    workspaceId: WORKSPACE,
    projectId: PROJECT,
    projectRevisionId: REVISION,
    objectKey:
      `tenant/${ACCOUNT}/workspace/${WORKSPACE}/project/${PROJECT}/revision/${REVISION}` +
      `/lane/${lane}/job/${acceptedAttemptId ?? "render-plan"}/artifact/${values.assetId}`,
    contentLength: 1024,
    reservationState: "COMMITTED",
    receiptDeletedAt: null,
    acceptedAttemptId,
    barrierAcceptance:
      values.kind === "VOICEOVER"
        ? "COMMITTED_INPUT"
        : values.kind === "RESOLVED_RENDER_MANIFEST"
          ? "COMMITTED_MANIFEST"
          : "ACCEPTED_CANONICAL",
    ...values,
  };
}

async function validInput(includeSoulx = false): Promise<HostedRenderPlanMaterializationInput> {
  const revisionDocument = structuredClone(revisionFixture);
  revisionDocument.project_id = PROJECT;
  revisionDocument.project_revision_id = REVISION;
  revisionDocument.voiceover_asset_id = "voiceover-owned";
  revisionDocument.voiceover_sha256 = VOICEOVER_HASH;
  const revision = await validateAndHashContractDocument("projectRevisionConfig", revisionDocument);

  const transcript = structuredClone(transcriptFixture);
  transcript.project_revision_id = REVISION;
  transcript.source.asset_id = revisionDocument.voiceover_asset_id;
  transcript.source.sha256 = VOICEOVER_HASH;
  const transcriptRef = await validateAndHashContractDocument("transcriptTiming", transcript);

  const timeline = structuredClone(timelineFixture);
  timeline.project_revision_id = REVISION;
  timeline.revision_config_hash = revision.sha256;
  timeline.scheduler_version = revisionDocument.scheduler_version;
  timeline.seed = revisionDocument.scheduler_seed;
  if (!includeSoulx) {
    const image = timeline.segments[1]!;
    timeline.segments = [
      {
        ...image,
        start_frame: 0,
        end_frame_exclusive: 360,
        source_audio_start_ms: 0,
        source_audio_end_ms: 12000,
        word_start: 0,
        word_end_exclusive: 9,
      },
    ];
  }
  const timelineRef = await validateAndHashContractDocument("timelinePlan", timeline);

  const visualByTask = {
    "avatar:seg_0001": { assetId: "soulx-avatar-one", hash: AVATAR_ONE_HASH },
    "image:seg_0002": { assetId: "mage-image-one", hash: IMAGE_ONE_HASH },
    "avatar:seg_0003": { assetId: "soulx-avatar-two", hash: AVATAR_TWO_HASH },
    "image:seg_0003:right": { assetId: "mage-image-two", hash: IMAGE_TWO_HASH },
  } as const;
  const manifestDocument = {
    schema_version: "resolved-render-manifest/v1",
    project_revision_id: REVISION,
    revision_config_hash: revision.sha256,
    timeline_plan_hash: timelineRef.sha256,
    render_profile_version: "ffmpeg-render-v3",
    voiceover: { asset_id: revisionDocument.voiceover_asset_id, sha256: VOICEOVER_HASH },
    output: {
      width: 1920,
      height: 1080,
      fps_num: 30,
      fps_den: 1,
      video_codec: "h264",
      pixel_format: "yuv420p",
      audio_codec: "aac",
      audio_sample_rate_hz: 48000,
      loudness_profile: "voiceover-minus16lufs-v1",
    },
    total_frames: timeline.total_frames,
    segments: includeSoulx
      ? [
          {
            segment_id: "seg_0001",
            start_frame: 0,
            end_frame_exclusive: 90,
            timeline_composition: "AVATAR_FULL",
            accepted_assets: {
              avatar: {
                asset_id: visualByTask["avatar:seg_0001"].assetId,
                sha256: visualByTask["avatar:seg_0001"].hash,
              },
            },
            render: {
              avatar_source_profile: "local-fixture-centered-832x480p25-v1",
              avatar_crop: "832:468:0:6",
              avatar_scale: "1920:1080",
              avatar_fps: "30:round=near",
            },
          },
          {
            segment_id: "seg_0002",
            start_frame: 90,
            end_frame_exclusive: 240,
            timeline_composition: "IMAGE_FULL",
            accepted_assets: {
              image: {
                asset_id: visualByTask["image:seg_0002"].assetId,
                sha256: visualByTask["image:seg_0002"].hash,
              },
            },
            render: { image_scale: "1920:1080", zoom_profile: "image-full-zoom-v3" },
          },
          {
            segment_id: "seg_0003",
            start_frame: 240,
            end_frame_exclusive: 360,
            timeline_composition: "AVATAR_SPLIT_IMAGE",
            accepted_assets: {
              avatar: {
                asset_id: visualByTask["avatar:seg_0003"].assetId,
                sha256: visualByTask["avatar:seg_0003"].hash,
              },
              right_image: {
                asset_id: visualByTask["image:seg_0003:right"].assetId,
                sha256: visualByTask["image:seg_0003:right"].hash,
              },
            },
            render: {
              avatar_source_profile: "local-fixture-centered-832x480p25-v1",
              avatar_crop: "416:468:208:6",
              avatar_scale: "960:1080",
              avatar_fps: "30:round=near",
              right_image_scale: "960:1080",
              right_image_zoom_profile: "split-right-zoom-v3",
            },
          },
        ]
      : [
          {
            segment_id: "seg_0002",
            start_frame: 0,
            end_frame_exclusive: 360,
            timeline_composition: "IMAGE_FULL",
            accepted_assets: {
              image: {
                asset_id: visualByTask["image:seg_0002"].assetId,
                sha256: visualByTask["image:seg_0002"].hash,
              },
            },
            render: { image_scale: "1920:1080", zoom_profile: "image-full-zoom-v3" },
          },
        ],
  } as ResolvedRenderManifestDocument;
  const manifest = await validateAndHashContractDocument(
    "resolvedRenderManifest",
    manifestDocument,
  );

  return {
    accountId: ACCOUNT,
    workspaceId: WORKSPACE,
    revision: {
      status: "LOCKED",
      projectId: PROJECT,
      projectRevisionId: REVISION,
      revisionConfigSha256: revision.sha256,
      avatarProfileVersionId: revision.value.avatar_binding.avatar_profile_version_id,
      avatarProfileHash: revision.value.avatar_binding.avatar_profile_hash,
      avatarRuntimeSourceSha256: revision.value.avatar_binding.runtime_source_sha256,
      imageStyleVersionId: revision.value.image_style_version_id,
      styleProfileHash: revision.value.style_profile_hash,
    },
    revisionDocument: revision.value,
    timing: {
      transcript: transcriptRef.value,
      transcriptSha256: transcriptRef.sha256,
      timeline: timelineRef.value,
      timelineSha256: timelineRef.sha256,
      timelineTranscriptSha256: transcriptRef.sha256,
    },
    voiceover: artifact({
      lane: "INPUT",
      taskKey: null,
      assetId: revisionDocument.voiceover_asset_id,
      receiptId: "55555555-5555-4555-8555-555555555555",
      checksumSha256: VOICEOVER_HASH,
      contentType: "audio/wav",
      kind: "VOICEOVER",
    }),
    acceptedVisuals: includeSoulx
      ? [
          artifact({
            lane: "SOULX_AVATAR",
            taskKey: "avatar:seg_0001",
            assetId: visualByTask["avatar:seg_0001"].assetId,
            receiptId: "66666666-6666-4666-8666-666666666666",
            checksumSha256: AVATAR_ONE_HASH,
            contentType: "video/mp4",
            kind: "AVATAR_CLIP",
          }),
          artifact({
            lane: "MAGE_IMAGE",
            taskKey: "image:seg_0002",
            assetId: visualByTask["image:seg_0002"].assetId,
            receiptId: "77777777-7777-4777-8777-777777777777",
            checksumSha256: IMAGE_ONE_HASH,
            contentType: "image/png",
            kind: "IMAGE",
          }),
          artifact({
            lane: "SOULX_AVATAR",
            taskKey: "avatar:seg_0003",
            assetId: visualByTask["avatar:seg_0003"].assetId,
            receiptId: "88888888-8888-4888-8888-888888888888",
            checksumSha256: AVATAR_TWO_HASH,
            contentType: "video/mp4",
            kind: "AVATAR_CLIP",
          }),
          artifact({
            lane: "MAGE_IMAGE",
            taskKey: "image:seg_0003:right",
            assetId: visualByTask["image:seg_0003:right"].assetId,
            receiptId: "99999999-9999-4999-8999-999999999999",
            checksumSha256: IMAGE_TWO_HASH,
            contentType: "image/png",
            kind: "IMAGE",
          }),
        ]
      : [
          artifact({
            lane: "MAGE_IMAGE",
            taskKey: "image:seg_0002",
            assetId: visualByTask["image:seg_0002"].assetId,
            receiptId: "77777777-7777-4777-8777-777777777777",
            checksumSha256: IMAGE_ONE_HASH,
            contentType: "image/png",
            kind: "IMAGE",
          }),
        ],
    resolvedManifest: {
      document: manifest.value,
      artifact: artifact({
        lane: "RENDER",
        taskKey: null,
        assetId: "resolved-render-manifest",
        receiptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        checksumSha256: manifest.sha256,
        contentType: "application/json",
        kind: "RESOLVED_RENDER_MANIFEST",
      }),
    },
    tools: { ffmpegVersion: "8.1.2", ffprobeVersion: "8.1.2" },
  };
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ code });
}

describe("hosted render-plan materialization", () => {
  it("writes and replays one exact hard-cut Mage-only groundwork plan", async () => {
    const database = new MemoryDatabase();
    const input = await validInput();
    const created = await materializeHostedRenderPlan(database, input);
    const replayed = await materializeHostedRenderPlan(database, input);

    expect(created.replayed).toBe(false);
    expect(replayed).toMatchObject({ replayed: true, payloadSha256: created.payloadSha256 });
    expect(database.inserts).toBe(1);
    expect(JSON.stringify(created.payload)).not.toMatch(/caption|overlay|transition|watermark/iu);
    expect(JSON.stringify(input.resolvedManifest.document)).toContain("image-full-zoom-v3");
  });

  it("fails closed for every SoulX segment until its crop contract is qualified", async () => {
    await expectCode(
      materializeHostedRenderPlan(new MemoryDatabase(), await validInput(true)),
      "SOULX_CROP_PROFILE_UNQUALIFIED",
    );
  });

  it("fails closed for an unbound SoulX artifact even on an image-only timeline", async () => {
    const input = await validInput();
    const soulx = (await validInput(true)).acceptedVisuals.find(
      (artifact) => artifact.lane === "SOULX_AVATAR",
    )!;
    await expectCode(
      materializeHostedRenderPlan(new MemoryDatabase(), {
        ...input,
        acceptedVisuals: [...input.acceptedVisuals, soulx],
      }),
      "SOULX_CROP_PROFILE_UNQUALIFIED",
    );
  });

  it("rejects a partial accepted-artifact barrier", async () => {
    const input = await validInput();
    await expectCode(
      materializeHostedRenderPlan(new MemoryDatabase(), {
        ...input,
        acceptedVisuals: input.acceptedVisuals.slice(1),
      }),
      "HOSTED_RENDER_ARTIFACT_BARRIER_PARTIAL",
    );
  });

  it("rejects a foreign accepted artifact", async () => {
    const input = await validInput();
    await expectCode(
      materializeHostedRenderPlan(new MemoryDatabase(), {
        ...input,
        acceptedVisuals: [
          { ...input.acceptedVisuals[0]!, accountId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
          ...input.acceptedVisuals.slice(1),
        ],
      }),
      "HOSTED_RENDER_ARTIFACT_FOREIGN",
    );
  });

  it("rejects revision style/avatar drift before persistence", async () => {
    const input = await validInput();
    await expectCode(
      materializeHostedRenderPlan(new MemoryDatabase(), {
        ...input,
        revision: { ...input.revision, styleProfileHash: `sha256:${"f".repeat(64)}` },
      }),
      "HOSTED_RENDER_REVISION_DRIFT",
    );
  });

  it("rejects an accepted artifact that drifts from the resolved manifest", async () => {
    const input = await validInput();
    await expectCode(
      materializeHostedRenderPlan(new MemoryDatabase(), {
        ...input,
        acceptedVisuals: [
          { ...input.acceptedVisuals[0]!, checksumSha256: `sha256:${"e".repeat(64)}` },
        ],
      }),
      "HOSTED_RENDER_MANIFEST_ARTIFACT_DRIFT",
    );
  });

  it("rejects an existing render plan with different canonical content", async () => {
    const database = new MemoryDatabase();
    database.existing = {
      payload: { schema_version: "different-plan/v1" },
      payload_sha256: `sha256:${"f".repeat(64)}`,
    };
    await expectCode(
      materializeHostedRenderPlan(database, await validInput()),
      "HOSTED_RENDER_PLAN_IDEMPOTENCY_CONFLICT",
    );
    expect(database.inserts).toBe(0);
  });

  it.each([
    ["lane", (key: string) => key.replace("/lane/mage-image/", "/lane/soulx-avatar/")],
    [
      "job",
      (key: string) =>
        key.replace("/job/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/", "/job/wrong-attempt/"),
    ],
  ])("rejects an object key whose %s segment drifts", async (_field, mutate) => {
    const input = await validInput();
    await expectCode(
      materializeHostedRenderPlan(new MemoryDatabase(), {
        ...input,
        acceptedVisuals: [
          { ...input.acceptedVisuals[0]!, objectKey: mutate(input.acceptedVisuals[0]!.objectKey) },
        ],
      }),
      "HOSTED_RENDER_ARTIFACT_DRIFTED",
    );
  });

  it("settles concurrent identical materializations as one insert and one replay", async () => {
    const database = new MemoryDatabase();
    const input = await validInput();
    const results = await Promise.all([
      materializeHostedRenderPlan(database, input),
      materializeHostedRenderPlan(database, input),
    ]);

    expect(database.inserts).toBe(1);
    expect(results.map((result) => result.replayed).sort()).toEqual([false, true]);
    expect(results[0]!.payloadSha256).toBe(results[1]!.payloadSha256);
  });

  it("fails closed when concurrent materializations diverge", async () => {
    const database = new MemoryDatabase();
    const input = await validInput();
    const results = await Promise.allSettled([
      materializeHostedRenderPlan(database, input),
      materializeHostedRenderPlan(database, {
        ...input,
        tools: { ...input.tools, ffmpegVersion: "8.1.3" },
      }),
    ]);

    expect(database.inserts).toBe(1);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: { code: "HOSTED_RENDER_PLAN_IDEMPOTENCY_CONFLICT" },
    });
  });
});

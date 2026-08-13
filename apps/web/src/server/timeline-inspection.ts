import { sha256CanonicalJson, type JsonValue } from "@videoforge/contracts/canonical-json";

import type { TimelineInspection } from "../lib/types";

const FIXTURE_PHRASES = Object.freeze([
  {
    startMs: 240,
    endMs: 4_300,
    sourceStartMs: 0,
    sourceEndMs: 4_500,
    layout: "AVATAR_FULL" as const,
    text: "Start with the field spot and the weight in your hands.",
  },
  {
    startMs: 4_700,
    endMs: 10_900,
    sourceStartMs: 4_500,
    sourceEndMs: 11_000,
    layout: "IMAGE_FULL" as const,
    text: "A creamy yellow patch usually means it ripened on the ground.",
  },
  {
    startMs: 11_300,
    endMs: 17_900,
    sourceStartMs: 11_000,
    sourceEndMs: 18_000,
    layout: "IMAGE_FULL" as const,
    text: "The melon should feel heavy for its size.",
  },
  {
    startMs: 18_300,
    endMs: 24_300,
    sourceStartMs: 18_000,
    sourceEndMs: 24_500,
    layout: "IMAGE_FULL" as const,
    text: "Look for a dry stem and a firm even surface.",
  },
  {
    startMs: 24_800,
    endMs: 28_300,
    sourceStartMs: 24_500,
    sourceEndMs: 28_500,
    layout: "AVATAR_SPLIT_IMAGE" as const,
    text: "Compare the signs together before choosing.",
  },
  {
    startMs: 28_800,
    endMs: 34_300,
    sourceStartMs: 28_500,
    sourceEndMs: 34_500,
    layout: "IMAGE_FULL" as const,
    text: "A hollow sound can support what you already observed.",
  },
  {
    startMs: 34_800,
    endMs: 39_500,
    sourceStartMs: 34_500,
    sourceEndMs: 40_000,
    layout: "IMAGE_FULL" as const,
    text: "Simple physical evidence is more useful than a single tap.",
  },
]);

interface TimelineProjectIdentity {
  readonly id: string;
  readonly revisionId: string;
  readonly stages?: readonly { readonly id: string; readonly status: string }[];
}

function fixtureReady(project: TimelineProjectIdentity): boolean {
  const timing = project.stages?.find((stage) => stage.id === "timing");
  const timeline = project.stages?.find((stage) => stage.id === "timeline");
  return timing?.status === "COMPLETE" && timeline?.status === "COMPLETE";
}

function waitingInspection(project: TimelineProjectIdentity): TimelineInspection {
  const blocker = "Canonical phrase timing and the deterministic plan have not both completed.";
  return {
    schemaVersion: "videoforge.timeline-inspection/v1",
    projectId: project.id,
    revisionId: project.revisionId,
    sourceMode: "FIXTURE",
    ready: false,
    invalidation: { state: "WAITING", recomputeRequired: false, reason: blocker },
    blockers: [blocker],
    documents: { transcriptSha256: null, timelineSha256: null },
    timing: null,
    plan: null,
    workPlan: null,
    selectedAvatar: null,
    phrases: [],
  };
}

export function fixtureTimelineDocuments(project: TimelineProjectIdentity): {
  readonly transcript: JsonValue;
  readonly timeline: JsonValue;
} {
  const transcript = {
    schema_version: "transcript-timing/v1",
    project_revision_id: project.revisionId,
    source: {
      asset_id: "asset_voiceover_example",
      sha256: `sha256:${"1".repeat(64)}`,
      duration_ms: 40_000,
    },
    engine: {
      name: "whisper.cpp",
      version: "fixture-transcript-v1",
      model_name: "base.en",
      model_sha256: `sha256:${"2".repeat(64)}`,
      language: "en",
    },
    text: FIXTURE_PHRASES.map((phrase) => phrase.text).join(" "),
    words: FIXTURE_PHRASES.map((phrase, index) => ({
      index,
      text: phrase.text,
      start_ms: phrase.startMs,
      end_ms: phrase.endMs,
      confidence: 1,
    })),
    phrases: FIXTURE_PHRASES.map((phrase, index) => ({
      phrase_id: `phrase_fixture_${String(index + 1).padStart(3, "0")}`,
      sentence_id: `sentence_fixture_${String(index + 1).padStart(3, "0")}`,
      word_start: index,
      word_end_exclusive: index + 1,
      start_ms: phrase.startMs,
      end_ms: phrase.endMs,
      pause_before_ms: phrase.startMs - (FIXTURE_PHRASES[index - 1]?.endMs ?? 0),
      pause_after_ms: (FIXTURE_PHRASES[index + 1]?.startMs ?? 40_000) - phrase.endMs,
      text: phrase.text,
    })),
  } as unknown as JsonValue;
  const timeline = {
    schema_version: "timeline-plan/v1",
    project_revision_id: project.revisionId,
    revision_config_hash: "sha256:89bc38845a41ed0070eca069ac19e36ccab65688e0997d2b791f2200e4c00586",
    scheduler_version: "scheduler-v2",
    seed: 982_341,
    output_fps_num: 30,
    output_fps_den: 1,
    total_frames: 1_200,
    segments: FIXTURE_PHRASES.map((phrase, index) => {
      const segmentId = `segment_fixture_${String(index + 1).padStart(3, "0")}`;
      const common = {
        segment_id: segmentId,
        start_frame: (phrase.sourceStartMs * 30) / 1_000,
        end_frame_exclusive: (phrase.sourceEndMs * 30) / 1_000,
        source_audio_start_ms: phrase.sourceStartMs,
        source_audio_end_ms: phrase.sourceEndMs,
        phrase: phrase.text,
        word_start: index,
        word_end_exclusive: index + 1,
      };
      if (phrase.layout === "AVATAR_FULL") {
        return {
          ...common,
          timeline_composition: phrase.layout,
          required_slots: {
            avatar: {
              task_key: `avatar:${segmentId}`,
              span_audio_task_key: `audio-span:${segmentId}`,
            },
          },
        };
      }
      if (phrase.layout === "AVATAR_SPLIT_IMAGE") {
        return {
          ...common,
          timeline_composition: phrase.layout,
          in_image_shot_role: "REACTION_RESULT",
          required_slots: {
            avatar: {
              task_key: `avatar:${segmentId}`,
              span_audio_task_key: `audio-span:${segmentId}`,
            },
            right_image: { task_key: `image:${segmentId}:right` },
          },
        };
      }
      return {
        ...common,
        timeline_composition: phrase.layout,
        in_image_shot_role: "OBJECT_EVIDENCE",
        required_slots: { image: { task_key: `image:${segmentId}` } },
      };
    }),
  } as unknown as JsonValue;
  return { transcript, timeline };
}

export async function fixtureTimelineInspection(
  project: TimelineProjectIdentity,
): Promise<TimelineInspection> {
  if (!fixtureReady(project)) return waitingInspection(project);
  const documents = fixtureTimelineDocuments(project);
  const [transcriptSha256, timelineSha256] = await Promise.all([
    sha256CanonicalJson(documents.transcript),
    sha256CanonicalJson(documents.timeline),
  ]);
  const avatarSpans = FIXTURE_PHRASES.flatMap((phrase, index) =>
    phrase.layout === "IMAGE_FULL"
      ? []
      : [
          {
            id: `segment_fixture_${String(index + 1).padStart(3, "0")}`,
            startMs: phrase.sourceStartMs,
            endMs: phrase.sourceEndMs,
            layout: phrase.layout,
            phrase: phrase.text,
            artifactId: `asset_span_audio_fixture_${String(index + 1).padStart(3, "0")}`,
            audioSha256: `sha256:${String(index + 1).repeat(64)}`,
            paddedStartMs: Math.max(0, phrase.sourceStartMs - 500),
            paddedEndMs: Math.min(40_000, phrase.sourceEndMs + 500),
            trimStartMs: phrase.sourceStartMs - Math.max(0, phrase.sourceStartMs - 500),
            trimEndMs:
              phrase.sourceStartMs -
              Math.max(0, phrase.sourceStartMs - 500) +
              phrase.sourceEndMs -
              phrase.sourceStartMs,
          },
        ],
  );
  const avatarDurationMs = avatarSpans.reduce(
    (total, span) => total + span.endMs - span.startMs,
    0,
  );

  return {
    schemaVersion: "videoforge.timeline-inspection/v1",
    projectId: project.id,
    revisionId: project.revisionId,
    sourceMode: "FIXTURE",
    ready: true,
    invalidation: { state: "CURRENT", recomputeRequired: false, reason: null },
    blockers: [],
    documents: { transcriptSha256, timelineSha256 },
    timing: {
      sourceDurationMs: 40_000,
      timedWordCount: FIXTURE_PHRASES.length,
      phraseCount: FIXTURE_PHRASES.length,
      phraseStartMs: FIXTURE_PHRASES[0]!.startMs,
      phraseEndMs: FIXTURE_PHRASES.at(-1)!.endMs,
      coverage: "COMPLETE",
    },
    plan: {
      fps: 30,
      totalFrames: 1_200,
      segmentCount: FIXTURE_PHRASES.length,
      sourceStartMs: 0,
      sourceEndMs: 40_000,
      coverage: "COMPLETE",
      compositionCounts: {
        avatarFull: FIXTURE_PHRASES.filter((phrase) => phrase.layout === "AVATAR_FULL").length,
        imageFull: FIXTURE_PHRASES.filter((phrase) => phrase.layout === "IMAGE_FULL").length,
        avatarSplitImage: FIXTURE_PHRASES.filter((phrase) => phrase.layout === "AVATAR_SPLIT_IMAGE")
          .length,
      },
      avatarFullPercent: 11.25,
      avatarSplitPercent: 10,
    },
    workPlan: {
      generationManifestSha256: transcriptSha256,
      renderManifestSha256: timelineSha256,
      promptBatchCount: 1,
      imageSlotCount: FIXTURE_PHRASES.filter((phrase) => phrase.layout !== "AVATAR_FULL").length,
      avatarTaskCount: avatarSpans.length,
      renderSegmentCount: FIXTURE_PHRASES.length,
      shotRoleCount: 2,
      hardCutsOnly: true,
      slowImageZoomRequired: true,
    },
    selectedAvatar: {
      count: avatarSpans.length,
      materializedCount: avatarSpans.length,
      durationMs: avatarDurationMs,
      coveragePercent: Number(((avatarDurationMs / 40_000) * 100).toFixed(2)),
      spans: avatarSpans,
    },
    phrases: FIXTURE_PHRASES.map((phrase, index) => ({
      id: `phrase_fixture_${String(index + 1).padStart(3, "0")}`,
      startMs: phrase.startMs,
      endMs: phrase.endMs,
      text: phrase.text,
      segmentId: `segment_fixture_${String(index + 1).padStart(3, "0")}`,
      segmentIds: [`segment_fixture_${String(index + 1).padStart(3, "0")}`],
      layout: phrase.layout,
      layouts: [phrase.layout],
      startFrame: (phrase.sourceStartMs * 30) / 1_000,
      endFrameExclusive: (phrase.sourceEndMs * 30) / 1_000,
      shotRole:
        phrase.layout === "AVATAR_FULL"
          ? null
          : phrase.layout === "AVATAR_SPLIT_IMAGE"
            ? "REACTION_RESULT"
            : "OBJECT_EVIDENCE",
      shotRoles:
        phrase.layout === "AVATAR_FULL"
          ? []
          : [phrase.layout === "AVATAR_SPLIT_IMAGE" ? "REACTION_RESULT" : "OBJECT_EVIDENCE"],
    })),
  };
}

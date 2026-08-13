import { sha256CanonicalJson, type JsonValue } from "@videoforge/contracts/canonical-json";
import { z } from "zod";

import { fixtureTimelineDocuments } from "./timeline-inspection";

const sha256Schema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const taskSlotSchema = z.object({ task_key: z.string().min(1) }).strict();
const avatarSlotSchema = z
  .object({ task_key: z.string().min(1), span_audio_task_key: z.string().min(1) })
  .strict();
const segmentBase = {
  segment_id: z.string().min(1),
  start_frame: z.number().int().nonnegative(),
  end_frame_exclusive: z.number().int().positive(),
  source_audio_start_ms: z.number().int().nonnegative(),
  source_audio_end_ms: z.number().int().positive(),
  phrase: z.string().min(1),
  word_start: z.number().int().nonnegative(),
  word_end_exclusive: z.number().int().positive(),
};
const timelineSegmentSchema = z.discriminatedUnion("timeline_composition", [
  z
    .object({
      ...segmentBase,
      timeline_composition: z.literal("AVATAR_FULL"),
      required_slots: z.object({ avatar: avatarSlotSchema }).strict(),
    })
    .strict(),
  z
    .object({
      ...segmentBase,
      timeline_composition: z.literal("IMAGE_FULL"),
      in_image_shot_role: z.literal("OBJECT_EVIDENCE"),
      required_slots: z.object({ image: taskSlotSchema }).strict(),
    })
    .strict(),
  z
    .object({
      ...segmentBase,
      timeline_composition: z.literal("AVATAR_SPLIT_IMAGE"),
      in_image_shot_role: z.literal("REACTION_RESULT"),
      required_slots: z.object({ avatar: avatarSlotSchema, right_image: taskSlotSchema }).strict(),
    })
    .strict(),
]);
const transcriptFoundationSchema = z
  .object({
    schema_version: z.literal("transcript-timing/v1"),
    project_revision_id: z.string().min(1),
    source: z
      .object({
        asset_id: z.string().min(1),
        sha256: sha256Schema,
        duration_ms: z.number().int().positive(),
      })
      .strict(),
    engine: z
      .object({
        name: z.literal("whisper.cpp"),
        version: z.string().min(1),
        model_name: z.string().min(1),
        model_sha256: sha256Schema,
        language: z.string().min(1),
      })
      .strict(),
    text: z.string().min(1),
    words: z
      .array(
        z
          .object({
            index: z.number().int().nonnegative(),
            text: z.string().min(1),
            start_ms: z.number().int().nonnegative(),
            end_ms: z.number().int().positive(),
            confidence: z.number().min(0).max(1),
          })
          .strict(),
      )
      .min(1),
    phrases: z
      .array(
        z
          .object({
            phrase_id: z.string().min(1),
            sentence_id: z.string().min(1),
            word_start: z.number().int().nonnegative(),
            word_end_exclusive: z.number().int().positive(),
            start_ms: z.number().int().nonnegative(),
            end_ms: z.number().int().positive(),
            pause_before_ms: z.number().int().nonnegative(),
            pause_after_ms: z.number().int().nonnegative(),
            text: z.string().min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
const timelineFoundationSchema = z
  .object({
    schema_version: z.literal("timeline-plan/v1"),
    project_revision_id: z.string().min(1),
    revision_config_hash: sha256Schema,
    scheduler_version: z.literal("scheduler-v2"),
    seed: z.number().int(),
    output_fps_num: z.number().int().positive(),
    output_fps_den: z.number().int().positive(),
    total_frames: z.number().int().positive(),
    segments: z.array(timelineSegmentSchema).min(1),
  })
  .strict();

export interface ProviderFreeFoundationReceipts {
  readonly transcriptSha256: string;
  readonly timelineSha256: string;
  readonly promptManifestSha256: string;
}

export async function buildProviderFreeFoundationReceipts(
  projectId: string,
): Promise<ProviderFreeFoundationReceipts> {
  const safeProjectId = projectId.replaceAll(/[^A-Za-z0-9._:-]/gu, "-");
  const revisionId = `revision_cp05_${safeProjectId}`;
  const documents = fixtureTimelineDocuments({ id: projectId, revisionId });
  const transcript = transcriptFoundationSchema.parse(documents.transcript);
  const timeline = timelineFoundationSchema.parse(documents.timeline);
  if (transcript.project_revision_id !== revisionId || timeline.project_revision_id !== revisionId)
    throw new Error("Provider-free foundations do not bind the requested project revision.");
  if (timeline.segments[0]?.start_frame !== 0)
    throw new Error("Timeline must start at frame zero.");
  for (const [index, segment] of timeline.segments.entries()) {
    if (segment.end_frame_exclusive <= segment.start_frame)
      throw new Error("Timeline contains an empty segment.");
    if (index > 0 && timeline.segments[index - 1]?.end_frame_exclusive !== segment.start_frame)
      throw new Error("Timeline segments must be contiguous.");
  }
  if (timeline.segments.at(-1)?.end_frame_exclusive !== timeline.total_frames)
    throw new Error("Timeline must cover the declared frame count.");
  const [transcriptSha256, timelineSha256] = await Promise.all([
    sha256CanonicalJson(transcript),
    sha256CanonicalJson(timeline),
  ]);
  const promptManifest = {
    schema_version: "videoforge.provider-free-prompt-fixture/v1",
    project_id: projectId,
    project_revision_id: revisionId,
    transcript_sha256: transcriptSha256,
    timeline_sha256: timelineSha256,
    writer: "runware-deepseek-v4-flash-0731-fixture",
    provider_calls_authorized: false,
    prompts: timeline.segments.flatMap((segment) => {
      if (segment.timeline_composition === "AVATAR_FULL") return [];
      const slot =
        segment.timeline_composition === "IMAGE_FULL"
          ? segment.required_slots.image
          : segment.required_slots.right_image;
      return [
        {
          task_key: slot.task_key,
          shot_role: segment.in_image_shot_role,
          phrase: segment.phrase,
          hard_rules: ["no text", "no logo", "no border", "slow centered image zoom"],
        },
      ];
    }),
  } as unknown as JsonValue;
  return Object.freeze({
    transcriptSha256,
    timelineSha256,
    promptManifestSha256: await sha256CanonicalJson(promptManifest),
  });
}

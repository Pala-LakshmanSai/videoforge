import {
  validateAndHashContractDocument,
  type Sha256Digest,
  type TimelinePlanDocument,
  type ValidatedContractDocument,
} from "@videoforge/contracts";

import type { ProjectRevisionDocumentRef, TimelinePlanDocumentRef } from "../documents.js";
import type { TranscriptDocumentRef } from "../transcript/types.js";
import { pipelineFailure, pipelineSuccess, type PipelineResult } from "../errors.js";
import { SUPPORTED_SCHEDULER_CONFIG } from "./scheduler.js";

export interface MaterializedSelectedSpan {
  readonly spanId: string;
  readonly timelineSegmentId: string;
  readonly taskKey: string;
  readonly artifactId: string;
  readonly sha256: Sha256Digest;
  readonly selectedStartMs: number;
  readonly selectedEndMsExclusive: number;
  readonly paddedStartMs: number;
  readonly paddedEndMsExclusive: number;
  readonly trimStartMs: number;
  readonly trimEndMsExclusive: number;
}

export interface CompleteWorkPlanRequest {
  readonly revision: ProjectRevisionDocumentRef;
  readonly transcript: TranscriptDocumentRef;
  readonly timeline: TimelinePlanDocumentRef;
  readonly schedulerConfigHash: Sha256Digest;
  readonly selectedSpanAudio: readonly MaterializedSelectedSpan[];
}

export interface CompleteWorkPlan {
  readonly generationWorkManifest: ValidatedContractDocument<"generationWorkManifest">;
  readonly renderWorkManifest: ValidatedContractDocument<"renderWorkManifest">;
}

type TimelineSegment = TimelinePlanDocument["segments"][number];
type AvatarSegment = Extract<
  TimelineSegment,
  { timeline_composition: "AVATAR_FULL" | "AVATAR_SPLIT_IMAGE" }
>;
type ImageSegment = Extract<
  TimelineSegment,
  { timeline_composition: "IMAGE_FULL" | "AVATAR_SPLIT_IMAGE" }
>;

const fail = (message: string, path: readonly (string | number)[]) =>
  pipelineFailure({ code: "WORK_PLAN_INVALID", message, path });

function isAvatarSegment(segment: TimelineSegment): segment is AvatarSegment {
  return segment.timeline_composition !== "IMAGE_FULL";
}

function hasImage(segment: TimelineSegment): segment is ImageSegment {
  return segment.timeline_composition !== "AVATAR_FULL";
}

function imageTaskKey(segment: ImageSegment): string {
  return segment.timeline_composition === "IMAGE_FULL"
    ? segment.required_slots.image.task_key
    : segment.required_slots.right_image.task_key;
}

function balancedBatchSizes(total: number): readonly number[] {
  if (total <= 50) return Object.freeze([total]);
  const count = Math.ceil(total / 50);
  const base = Math.floor(total / count);
  const remainder = total % count;
  return Object.freeze(
    Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0)),
  );
}

function validateExactTimeline(request: CompleteWorkPlanRequest): string | null {
  if (
    request.revision.value.project_revision_id !== request.timeline.value.project_revision_id ||
    request.transcript.value.project_revision_id !== request.timeline.value.project_revision_id ||
    request.timeline.value.revision_config_hash !== request.revision.sha256
  )
    return "Revision, transcript, and timeline identity must match exactly.";

  let nextFrame = 0;
  let nextSourceMs = 0;
  let nextWord = 0;
  for (const segment of request.timeline.value.segments) {
    if (
      segment.start_frame !== nextFrame ||
      segment.source_audio_start_ms !== nextSourceMs ||
      segment.word_start !== nextWord ||
      segment.end_frame_exclusive <= segment.start_frame ||
      segment.source_audio_end_ms <= segment.source_audio_start_ms
    )
      return "Timeline must provide exact contiguous frame, source-time, and word coverage.";
    nextFrame = segment.end_frame_exclusive;
    nextSourceMs = segment.source_audio_end_ms;
    nextWord = segment.word_end_exclusive;
  }
  if (
    nextFrame !== request.timeline.value.total_frames ||
    nextSourceMs !== request.transcript.value.source.duration_ms ||
    nextWord !== request.transcript.value.words.length
  )
    return "Timeline must end at exact frame, source-time, and word totals.";
  return null;
}

export async function compileCompleteWorkPlan(
  request: CompleteWorkPlanRequest,
): Promise<PipelineResult<CompleteWorkPlan>> {
  const timelineFailure = validateExactTimeline(request);
  if (timelineFailure !== null) return fail(timelineFailure, ["timeline"]);

  const imageSegments = request.timeline.value.segments.filter(hasImage);
  const avatarSegments = request.timeline.value.segments.filter(isAvatarSegment);
  if (imageSegments.length === 0 || avatarSegments.length === 0) {
    return fail("Complete work plan requires image and avatar work.", ["timeline", "segments"]);
  }

  const spanBySegment = new Map(
    request.selectedSpanAudio.map((span) => [span.timelineSegmentId, span] as const),
  );
  if (
    spanBySegment.size !== request.selectedSpanAudio.length ||
    request.selectedSpanAudio.length !== avatarSegments.length
  )
    return fail("Selected-span audio must cover every avatar segment exactly once.", [
      "selectedSpanAudio",
    ]);

  const avatarSpans = [];
  let selectedSpanAudioMs = 0;
  for (const [index, segment] of avatarSegments.entries()) {
    const span = spanBySegment.get(segment.segment_id);
    const paddedStart = Math.max(
      0,
      segment.source_audio_start_ms - SUPPORTED_SCHEDULER_CONFIG.selected_span_context_padding_ms,
    );
    const paddedEnd = Math.min(
      request.transcript.value.source.duration_ms,
      segment.source_audio_end_ms + SUPPORTED_SCHEDULER_CONFIG.selected_span_context_padding_ms,
    );
    if (
      !span ||
      span.taskKey !== segment.required_slots.avatar.span_audio_task_key ||
      span.selectedStartMs !== segment.source_audio_start_ms ||
      span.selectedEndMsExclusive !== segment.source_audio_end_ms ||
      span.paddedStartMs !== paddedStart ||
      span.paddedEndMsExclusive !== paddedEnd ||
      span.trimStartMs !== segment.source_audio_start_ms - paddedStart ||
      span.trimEndMsExclusive !==
        segment.source_audio_start_ms -
          paddedStart +
          segment.source_audio_end_ms -
          segment.source_audio_start_ms ||
      paddedEnd - paddedStart >= request.transcript.value.source.duration_ms
    )
      return fail("Selected-span audio lineage is incomplete, mismatched, or full-length.", [
        "selectedSpanAudio",
        index,
      ]);
    selectedSpanAudioMs += paddedEnd - paddedStart;
    avatarSpans.push({
      span_id: span.spanId,
      task_key: segment.required_slots.avatar.task_key,
      timeline_segment_id: segment.segment_id,
      timeline_composition: segment.timeline_composition,
      span_audio_artifact_id: span.artifactId,
      span_audio_sha256: span.sha256,
      planned_clip_asset_id: `planned-avatar:${segment.segment_id}`,
      selected_start_ms: span.selectedStartMs,
      selected_end_ms_exclusive: span.selectedEndMsExclusive,
      padded_start_ms: span.paddedStartMs,
      padded_end_ms_exclusive: span.paddedEndMsExclusive,
      trim_start_ms: span.trimStartMs,
      trim_end_ms_exclusive: span.trimEndMsExclusive,
    });
  }

  const sizes = balancedBatchSizes(imageSegments.length);
  const promptBatches = [];
  const promptBatchByTaskKey = new Map<string, string>();
  let imageCursor = 0;
  for (const [ordinal, size] of sizes.entries()) {
    const batchId = `prompt-batch:${request.timeline.value.project_revision_id}:${String(ordinal + 1).padStart(3, "0")}`;
    const taskKeys = imageSegments
      .slice(imageCursor, imageCursor + size)
      .map((segment) => imageTaskKey(segment));
    for (const taskKey of taskKeys) promptBatchByTaskKey.set(taskKey, batchId);
    promptBatches.push({ batch_id: batchId, ordinal, scene_task_keys: taskKeys });
    imageCursor += size;
  }

  const imageSlots = imageSegments.map((segment) => {
    const taskKey = imageTaskKey(segment);
    return {
      slot_id: `image-slot:${segment.segment_id}`,
      task_key: taskKey,
      timeline_segment_id: segment.segment_id,
      timeline_composition: segment.timeline_composition,
      in_image_shot_role: segment.in_image_shot_role,
      prompt_batch_id: promptBatchByTaskKey.get(taskKey)!,
      planned_asset_id: `planned-image:${segment.segment_id}`,
    };
  });

  try {
    const generationWorkManifest = await validateAndHashContractDocument("generationWorkManifest", {
      schema_version: "generation-work-manifest/v1",
      project_revision_id: request.timeline.value.project_revision_id,
      revision_config_hash: request.revision.sha256,
      timeline_plan_hash: request.timeline.sha256,
      transcript_document_hash: request.transcript.sha256,
      scheduler_config_hash: request.schedulerConfigHash,
      selection_authority: "DETERMINISTIC_CODE",
      echo_audio_policy: {
        full_voiceover_dispatched: false,
        sample_rate_hz: 16_000,
        channels: 1,
        context_padding_ms: SUPPORTED_SCHEDULER_CONFIG.selected_span_context_padding_ms,
      },
      prompt_batches: promptBatches,
      image_slots: imageSlots,
      avatar_spans: avatarSpans,
      cost_counts: {
        prompt_batch_count: promptBatches.length,
        image_prompt_count: imageSlots.length,
        image_generation_count: imageSlots.length,
        avatar_generation_count: avatarSpans.length,
        selected_span_audio_count: avatarSpans.length,
        selected_span_audio_ms: selectedSpanAudioMs,
        render_segment_count: request.timeline.value.segments.length,
      },
    });

    const imageBySegment = new Map(imageSlots.map((slot) => [slot.timeline_segment_id, slot]));
    const avatarBySegment = new Map(avatarSpans.map((span) => [span.timeline_segment_id, span]));
    const renderWorkManifest = await validateAndHashContractDocument("renderWorkManifest", {
      schema_version: "render-work-manifest/v1",
      project_revision_id: request.timeline.value.project_revision_id,
      revision_config_hash: request.revision.sha256,
      timeline_plan_hash: request.timeline.sha256,
      generation_work_manifest_hash: generationWorkManifest.sha256,
      output: {
        width: 1920,
        height: 1080,
        fps_num: 30,
        fps_den: 1,
        total_frames: request.timeline.value.total_frames,
      },
      transition_policy: "HARD_CUTS_ONLY",
      segments: request.timeline.value.segments.map((segment) => {
        const image = imageBySegment.get(segment.segment_id);
        const avatar = avatarBySegment.get(segment.segment_id);
        return {
          timeline_segment_id: segment.segment_id,
          start_frame: segment.start_frame,
          end_frame_exclusive: segment.end_frame_exclusive,
          timeline_composition: segment.timeline_composition,
          planned_asset_ids: {
            ...(avatar ? { avatar: avatar.planned_clip_asset_id } : {}),
            ...(image ? { image: image.planned_asset_id } : {}),
          },
          image_zoom_profile: image ? "SLOW_SMOOTH_CENTERED_ZOOM" : "NONE",
          avatar_crop_authority: avatar ? "ACCEPTED_ECHO_PROFILE_REQUIRED" : "NOT_APPLICABLE",
        };
      }),
    });
    return pipelineSuccess(Object.freeze({ generationWorkManifest, renderWorkManifest }));
  } catch (error) {
    return fail("Complete work manifests failed strict canonical validation.", [
      error instanceof Error ? error.name : "UnknownError",
    ]);
  }
}

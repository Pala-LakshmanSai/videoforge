import {
  validateAndHashContractDocument,
  type ProjectRevisionConfigDocument,
  type TimelinePlanDocument,
  type TranscriptTimingDocument,
} from "@videoforge/contracts";

import type { TimelinePlanDocumentRef } from "../documents.js";
import {
  pipelineFailure,
  pipelineSuccess,
  type PipelineFailure,
  type PipelineResult,
} from "../errors.js";
import type { SchedulerPort, SchedulerRequest } from "./ports.js";
import { SeededVariation } from "./random.js";

export const SUPPORTED_SCHEDULER_VERSION = "scheduler-v1";

const SHOT_ROLES = Object.freeze([
  "ENVIRONMENTAL_WIDE",
  "HUMAN_MEDIUM",
  "HANDS_ACTION",
  "OBJECT_EVIDENCE",
  "MACRO_DETAIL",
  "REACTION_RESULT",
] as const);

/**
 * Exact behavior-bearing scheduler inputs. Keep this document immutable for scheduler-v1; changing
 * any value requires a new scheduler version so durable plans can be replayed byte-for-byte.
 */
export const SUPPORTED_SCHEDULER_CONFIG = Object.freeze({
  schema_version: "deterministic-timeline-scheduler-config/v1",
  output_fps_num: 30,
  output_fps_den: 1,
  image_minimum_ms: 3_000,
  image_maximum_ms: 7_000,
  avatar_minimum_ms: 2_000,
  avatar_maximum_ms: 6_000,
  opener_maximum_ms: 7_000,
  desired_opener_minimum_ms: 4_000,
  desired_opener_maximum_ms: 6_000,
  minimum_avatar_start_delta_ms: 11_000,
  maximum_avatar_start_delta_ms: 23_000,
  desired_avatar_start_delta_minimum_ms: 14_000,
  desired_avatar_start_delta_maximum_ms: 20_000,
  avatar_duration_jitter_minimum_ms: -600,
  avatar_duration_jitter_maximum_ms: 600,
  avatar_duration_score_weight: 0.7,
  avatar_coverage_score_weight: 0.2,
  target_avatar_ratio_minimum: 0.21,
  target_avatar_ratio_maximum: 0.22,
  selected_span_context_padding_ms: 500,
  shot_roles: SHOT_ROLES,
});

const OUTPUT_FPS = SUPPORTED_SCHEDULER_CONFIG.output_fps_num;
const IMAGE_MINIMUM_MS = SUPPORTED_SCHEDULER_CONFIG.image_minimum_ms;
const IMAGE_MAXIMUM_MS = SUPPORTED_SCHEDULER_CONFIG.image_maximum_ms;
const AVATAR_MINIMUM_MS = SUPPORTED_SCHEDULER_CONFIG.avatar_minimum_ms;
const AVATAR_MAXIMUM_MS = SUPPORTED_SCHEDULER_CONFIG.avatar_maximum_ms;
const OPENER_MAXIMUM_MS = SUPPORTED_SCHEDULER_CONFIG.opener_maximum_ms;
const MINIMUM_AVATAR_START_DELTA_MS = SUPPORTED_SCHEDULER_CONFIG.minimum_avatar_start_delta_ms;
const MAXIMUM_AVATAR_START_DELTA_MS = SUPPORTED_SCHEDULER_CONFIG.maximum_avatar_start_delta_ms;

type TimelineSegment = TimelinePlanDocument["segments"][number];
type TimelineComposition = TimelineSegment["timeline_composition"];
type ShotRole = (typeof SHOT_ROLES)[number];

interface PhraseRange {
  readonly startIndex: number;
  readonly endIndex: number;
}

interface ScheduledRange extends PhraseRange {
  readonly timelineComposition: TimelineComposition;
}

interface AvatarRange extends ScheduledRange {
  readonly timelineComposition: "AVATAR_FULL" | "AVATAR_SPLIT_IMAGE";
}

interface ScoredPartition {
  readonly score: number;
  readonly ranges: readonly PhraseRange[];
}

function fail(
  code: PipelineFailure["code"],
  message: string,
  path: PipelineFailure["path"],
  details?: PipelineFailure["details"],
): PipelineFailure {
  return {
    code,
    message,
    path,
    ...(details === undefined ? {} : { details }),
  };
}

function frameForMilliseconds(milliseconds: number): number {
  return Math.round((milliseconds * OUTPUT_FPS) / 1_000);
}

function boundaryMilliseconds(transcript: TranscriptTimingDocument, phraseIndex: number): number {
  if (phraseIndex === 0) return 0;
  if (phraseIndex === transcript.phrases.length) return transcript.source.duration_ms;
  return transcript.phrases[phraseIndex]!.start_ms;
}

function rangeDurationMilliseconds(
  transcript: TranscriptTimingDocument,
  range: PhraseRange,
): number {
  return (
    boundaryMilliseconds(transcript, range.endIndex) -
    boundaryMilliseconds(transcript, range.startIndex)
  );
}

function validateSchedulerInput(
  revision: ProjectRevisionConfigDocument,
  transcript: TranscriptTimingDocument,
): PipelineFailure | null {
  if (revision.scheduler_version !== SUPPORTED_SCHEDULER_VERSION) {
    return fail(
      "TIMELINE_INVALID",
      `Unsupported scheduler version ${revision.scheduler_version}.`,
      ["revision", "scheduler_version"],
      { supportedVersion: SUPPORTED_SCHEDULER_VERSION },
    );
  }

  if (transcript.project_revision_id !== revision.project_revision_id) {
    return fail("TRANSCRIPT_INVALID", "The transcript belongs to a different project revision.", [
      "transcript",
      "project_revision_id",
    ]);
  }

  if (
    transcript.source.asset_id !== revision.voiceover_asset_id ||
    transcript.source.sha256 !== revision.voiceover_sha256
  ) {
    return fail(
      "TRANSCRIPT_INVALID",
      "The transcript source does not match the revision voiceover binding.",
      ["transcript", "source"],
    );
  }

  let previousWordEnd = 0;
  for (const [index, word] of transcript.words.entries()) {
    if (word.index !== index) {
      return fail(
        "TRANSCRIPT_INVALID",
        "Transcript word indexes must be contiguous and zero-based.",
        ["transcript", "words", index, "index"],
      );
    }
    if (
      word.start_ms < previousWordEnd ||
      word.end_ms <= word.start_ms ||
      word.end_ms > transcript.source.duration_ms
    ) {
      return fail(
        "TRANSCRIPT_INVALID",
        "Transcript word timing must be ordered, positive, and inside the source duration.",
        ["transcript", "words", index],
      );
    }
    previousWordEnd = word.end_ms;
  }

  const phraseIds = new Set<string>();
  let expectedWordStart = 0;
  let previousPhraseEnd = 0;
  let previousBoundaryFrame = 0;

  for (const [index, phrase] of transcript.phrases.entries()) {
    if (phraseIds.has(phrase.phrase_id)) {
      return fail("TRANSCRIPT_INVALID", "Transcript phrase IDs must be unique.", [
        "transcript",
        "phrases",
        index,
        "phrase_id",
      ]);
    }
    phraseIds.add(phrase.phrase_id);

    if (
      phrase.word_start !== expectedWordStart ||
      phrase.word_end_exclusive <= phrase.word_start ||
      phrase.word_end_exclusive > transcript.words.length
    ) {
      return fail(
        "TRANSCRIPT_INVALID",
        "Transcript phrases must cover the word list contiguously.",
        ["transcript", "phrases", index, "word_start"],
      );
    }

    const firstWord = transcript.words[phrase.word_start];
    const lastWord = transcript.words[phrase.word_end_exclusive - 1];
    if (
      firstWord === undefined ||
      lastWord === undefined ||
      phrase.start_ms !== firstWord.start_ms ||
      phrase.end_ms !== lastWord.end_ms ||
      phrase.start_ms < previousPhraseEnd ||
      phrase.end_ms > transcript.source.duration_ms
    ) {
      return fail(
        "TRANSCRIPT_INVALID",
        "Phrase timing must match its words and remain ordered inside the source duration.",
        ["transcript", "phrases", index],
      );
    }

    if (index > 0) {
      const boundaryFrame = frameForMilliseconds(phrase.start_ms);
      if (boundaryFrame <= previousBoundaryFrame) {
        return fail(
          "TRANSCRIPT_INVALID",
          "Adjacent phrase boundaries must occupy distinct output frames.",
          ["transcript", "phrases", index, "start_ms"],
        );
      }
      previousBoundaryFrame = boundaryFrame;
    }

    expectedWordStart = phrase.word_end_exclusive;
    previousPhraseEnd = phrase.end_ms;
  }

  if (expectedWordStart !== transcript.words.length) {
    return fail("TRANSCRIPT_INVALID", "Transcript phrases must cover every word exactly once.", [
      "transcript",
      "phrases",
    ]);
  }

  return null;
}

function partitionImageRange(
  transcript: TranscriptTimingDocument,
  startIndex: number,
  endIndex: number,
  variation: SeededVariation,
): readonly PhraseRange[] | null {
  if (startIndex === endIndex) return [];

  const memo = new Map<number, ScoredPartition | null>();

  function solve(index: number): ScoredPartition | null {
    if (index === endIndex) return { score: 0, ranges: [] };
    if (memo.has(index)) return memo.get(index) ?? null;

    let best: ScoredPartition | null = null;
    for (let nextIndex = index + 1; nextIndex <= endIndex; nextIndex += 1) {
      const range = { startIndex: index, endIndex: nextIndex };
      const duration = rangeDurationMilliseconds(transcript, range);
      if (duration < IMAGE_MINIMUM_MS) continue;
      if (duration > IMAGE_MAXIMUM_MS) break;

      const remainder = solve(nextIndex);
      if (remainder === null) continue;

      const key = `image-span:${startIndex}:${endIndex}:${index}:${nextIndex}`;
      const target = variation.between(key, IMAGE_MINIMUM_MS, IMAGE_MAXIMUM_MS);
      const score =
        remainder.score + Math.abs(duration - target) + variation.between(`${key}:tie`, 0, 0.25);
      const candidate = { score, ranges: [range, ...remainder.ranges] };

      if (best === null || candidate.score < best.score) best = candidate;
    }

    memo.set(index, best);
    return best;
  }

  return solve(startIndex)?.ranges ?? null;
}

function selectOpener(
  transcript: TranscriptTimingDocument,
  variation: SeededVariation,
): AvatarRange | null {
  const desiredDuration = variation.between(
    "avatar-opener-duration",
    SUPPORTED_SCHEDULER_CONFIG.desired_opener_minimum_ms,
    SUPPORTED_SCHEDULER_CONFIG.desired_opener_maximum_ms,
  );
  let best: { readonly score: number; readonly range: AvatarRange } | null = null;

  for (let endIndex = 1; endIndex <= transcript.phrases.length; endIndex += 1) {
    const range: AvatarRange = {
      startIndex: 0,
      endIndex,
      timelineComposition: "AVATAR_FULL",
    };
    const duration = rangeDurationMilliseconds(transcript, range);
    if (duration < AVATAR_MINIMUM_MS) continue;
    if (duration > OPENER_MAXIMUM_MS) break;
    if (partitionImageRange(transcript, endIndex, transcript.phrases.length, variation) === null) {
      continue;
    }

    const score =
      Math.abs(duration - desiredDuration) +
      variation.between(`avatar-opener:${endIndex}:tie`, 0, 0.25);
    if (best === null || score < best.score) best = { score, range };
  }

  return best?.range ?? null;
}

function selectNextAvatar(
  transcript: TranscriptTimingDocument,
  previous: AvatarRange,
  appearanceIndex: number,
  currentAvatarMs: number,
  targetAvatarMs: number,
  variation: SeededVariation,
): AvatarRange | null {
  const previousStart = boundaryMilliseconds(transcript, previous.startIndex);
  const desiredStart =
    previousStart +
    variation.between(
      `avatar-start:${appearanceIndex}`,
      SUPPORTED_SCHEDULER_CONFIG.desired_avatar_start_delta_minimum_ms,
      SUPPORTED_SCHEDULER_CONFIG.desired_avatar_start_delta_maximum_ms,
    );
  const remainingCoverage = Math.max(AVATAR_MINIMUM_MS, targetAvatarMs - currentAvatarMs);
  const desiredDuration = Math.min(
    AVATAR_MAXIMUM_MS,
    Math.max(
      AVATAR_MINIMUM_MS,
      remainingCoverage +
        variation.between(
          `avatar-duration:${appearanceIndex}`,
          SUPPORTED_SCHEDULER_CONFIG.avatar_duration_jitter_minimum_ms,
          SUPPORTED_SCHEDULER_CONFIG.avatar_duration_jitter_maximum_ms,
        ),
    ),
  );

  let best: { readonly score: number; readonly range: AvatarRange } | null = null;
  for (
    let startIndex = previous.endIndex + 1;
    startIndex < transcript.phrases.length;
    startIndex += 1
  ) {
    const start = boundaryMilliseconds(transcript, startIndex);
    const startDelta = start - previousStart;
    if (startDelta < MINIMUM_AVATAR_START_DELTA_MS) continue;
    if (startDelta > MAXIMUM_AVATAR_START_DELTA_MS) break;

    if (partitionImageRange(transcript, previous.endIndex, startIndex, variation) === null) {
      continue;
    }

    for (let endIndex = startIndex + 1; endIndex <= transcript.phrases.length; endIndex += 1) {
      const range: AvatarRange = {
        startIndex,
        endIndex,
        timelineComposition: appearanceIndex % 2 === 0 ? "AVATAR_FULL" : "AVATAR_SPLIT_IMAGE",
      };
      const duration = rangeDurationMilliseconds(transcript, range);
      if (duration < AVATAR_MINIMUM_MS) continue;
      if (duration > AVATAR_MAXIMUM_MS) break;
      if (
        partitionImageRange(transcript, endIndex, transcript.phrases.length, variation) === null
      ) {
        continue;
      }

      const projectedCoverage = currentAvatarMs + duration;
      const key = `avatar:${appearanceIndex}:${startIndex}:${endIndex}`;
      const score =
        Math.abs(start - desiredStart) +
        Math.abs(duration - desiredDuration) *
          SUPPORTED_SCHEDULER_CONFIG.avatar_duration_score_weight +
        Math.abs(projectedCoverage - targetAvatarMs) *
          SUPPORTED_SCHEDULER_CONFIG.avatar_coverage_score_weight +
        variation.between(`${key}:tie`, 0, 0.25);
      if (best === null || score < best.score) best = { score, range };
    }
  }

  return best?.range ?? null;
}

function lexicalShotRole(phrase: string): ShotRole | null {
  const normalized = phrase.toLocaleLowerCase("en-US");
  if (/\b(?:hand|hands|finger|fingers|hold|lift|tap|touch|work|working)\b/u.test(normalized)) {
    return "HANDS_ACTION";
  }
  if (/\b(?:macro|texture|tiny|close-up|surface|rind|spot)\b/u.test(normalized)) {
    return "MACRO_DETAIL";
  }
  if (/\b(?:result|outcome|ready|finally|together)\b/u.test(normalized)) {
    return "REACTION_RESULT";
  }
  if (/\b(?:field|farm|market|ground|environment|landscape|place)\b/u.test(normalized)) {
    return "ENVIRONMENTAL_WIDE";
  }
  if (/\b(?:person|people|worker|farmer|family|presenter)\b/u.test(normalized)) {
    return "HUMAN_MEDIUM";
  }
  if (/\b(?:object|tool|evidence|sign|weight|melon|watermelon|stem)\b/u.test(normalized)) {
    return "OBJECT_EVIDENCE";
  }
  return null;
}

function phraseText(transcript: TranscriptTimingDocument, range: PhraseRange): string {
  return transcript.phrases
    .slice(range.startIndex, range.endIndex)
    .map((phrase) => phrase.text)
    .join(" ");
}

function shotRoleFor(phrase: string, imageOrdinal: number, rotationOffset: number): ShotRole {
  return (
    lexicalShotRole(phrase) ?? SHOT_ROLES[(rotationOffset + imageOrdinal) % SHOT_ROLES.length]!
  );
}

function createTimelineSegments(
  request: SchedulerRequest,
  ranges: readonly ScheduledRange[],
  variation: SeededVariation,
): readonly TimelineSegment[] {
  const transcript = request.transcript.value;
  const rotationOffset = variation.index("shot-role-rotation", SHOT_ROLES.length);
  let imageOrdinal = 0;

  return ranges.map((range, index) => {
    const firstPhrase = transcript.phrases[range.startIndex]!;
    const lastPhrase = transcript.phrases[range.endIndex - 1]!;
    const sourceAudioStartMs = boundaryMilliseconds(transcript, range.startIndex);
    const sourceAudioEndMs = boundaryMilliseconds(transcript, range.endIndex);
    const segmentId = request.determinism.ids.idFor(
      "timeline-segment-v1",
      [
        request.revision.value.project_revision_id,
        request.revision.value.scheduler_version,
        request.revision.value.scheduler_seed,
        index,
        sourceAudioStartMs,
        sourceAudioEndMs,
        range.timelineComposition,
      ].join(":"),
    );
    const base = {
      segment_id: segmentId,
      start_frame: frameForMilliseconds(sourceAudioStartMs),
      end_frame_exclusive: frameForMilliseconds(sourceAudioEndMs),
      source_audio_start_ms: sourceAudioStartMs,
      source_audio_end_ms: sourceAudioEndMs,
      phrase: phraseText(transcript, range),
      word_start: firstPhrase.word_start,
      word_end_exclusive: lastPhrase.word_end_exclusive,
    };

    if (range.timelineComposition === "AVATAR_FULL") {
      return {
        ...base,
        timeline_composition: "AVATAR_FULL",
        required_slots: {
          avatar: {
            task_key: `avatar:${segmentId}`,
            span_audio_task_key: `audio-span:${segmentId}`,
          },
        },
      };
    }

    const role = shotRoleFor(base.phrase, imageOrdinal, rotationOffset);
    imageOrdinal += 1;

    if (range.timelineComposition === "AVATAR_SPLIT_IMAGE") {
      return {
        ...base,
        timeline_composition: "AVATAR_SPLIT_IMAGE",
        in_image_shot_role: role,
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
      ...base,
      timeline_composition: "IMAGE_FULL",
      in_image_shot_role: role,
      required_slots: { image: { task_key: `image:${segmentId}` } },
    };
  });
}

function validateTimelineSemantics(
  plan: TimelinePlanDocument,
  transcript: TranscriptTimingDocument,
): PipelineFailure | null {
  if (plan.segments[0]?.timeline_composition !== "AVATAR_FULL") {
    return fail(
      "TIMELINE_INVALID",
      "The timeline must begin with a full-screen avatar cold open.",
      ["segments", 0, "timeline_composition"],
    );
  }

  const phraseStarts = new Set(transcript.phrases.map((phrase) => phrase.word_start));
  const segmentIds = new Set<string>();
  let expectedFrame = 0;
  let expectedSourceMs = 0;
  let expectedWord = 0;
  let previousAvatarComposition: "AVATAR_FULL" | "AVATAR_SPLIT_IMAGE" | null = null;

  for (const [index, segment] of plan.segments.entries()) {
    if (segmentIds.has(segment.segment_id)) {
      return fail("TIMELINE_INVALID", "Timeline segment IDs must be unique.", [
        "segments",
        index,
        "segment_id",
      ]);
    }
    segmentIds.add(segment.segment_id);

    if (
      segment.start_frame !== expectedFrame ||
      segment.source_audio_start_ms !== expectedSourceMs ||
      segment.word_start !== expectedWord ||
      segment.end_frame_exclusive <= segment.start_frame ||
      segment.source_audio_end_ms <= segment.source_audio_start_ms
    ) {
      return fail(
        "TIMELINE_INVALID",
        "Timeline segments must cover frames, source audio, and words contiguously.",
        ["segments", index],
      );
    }

    if (!phraseStarts.has(segment.word_start)) {
      return fail("TIMELINE_INVALID", "Every segment must begin at a phrase boundary.", [
        "segments",
        index,
        "word_start",
      ]);
    }

    const durationMs = segment.source_audio_end_ms - segment.source_audio_start_ms;
    if (
      segment.timeline_composition === "IMAGE_FULL" &&
      (durationMs < IMAGE_MINIMUM_MS || durationMs > IMAGE_MAXIMUM_MS)
    ) {
      return fail(
        "TIMELINE_INVALID",
        "Full-image scenes must remain between three and seven seconds.",
        ["segments", index],
      );
    }

    if (segment.timeline_composition !== "IMAGE_FULL") {
      const maximum = index === 0 ? OPENER_MAXIMUM_MS : AVATAR_MAXIMUM_MS;
      if (durationMs < AVATAR_MINIMUM_MS || durationMs > maximum) {
        return fail(
          "TIMELINE_INVALID",
          "Avatar scenes must remain inside their bounded duration envelope.",
          ["segments", index],
        );
      }
      if (previousAvatarComposition === segment.timeline_composition) {
        return fail(
          "TIMELINE_INVALID",
          "Avatar appearances must alternate full and split compositions.",
          ["segments", index, "timeline_composition"],
        );
      }
      previousAvatarComposition = segment.timeline_composition;
    }

    expectedFrame = segment.end_frame_exclusive;
    expectedSourceMs = segment.source_audio_end_ms;
    expectedWord = segment.word_end_exclusive;
  }

  if (
    expectedFrame !== plan.total_frames ||
    expectedSourceMs !== transcript.source.duration_ms ||
    expectedWord !== transcript.words.length
  ) {
    return fail(
      "TIMELINE_INVALID",
      "The timeline must cover the full output, source audio, and transcript word list.",
      ["segments"],
    );
  }

  return null;
}

function buildTimelinePlan(
  request: SchedulerRequest,
  variation: SeededVariation,
): TimelinePlanDocument | PipelineFailure {
  const revision = request.revision.value;
  const transcript = request.transcript.value;
  const opener = selectOpener(transcript, variation);
  if (opener === null) {
    return fail(
      "TIMELINE_INVALID",
      "Phrase boundaries cannot produce a bounded avatar opener and legal image scenes.",
      ["transcript", "phrases"],
    );
  }

  const targetAvatarRatio = variation.between(
    "target-avatar-ratio",
    SUPPORTED_SCHEDULER_CONFIG.target_avatar_ratio_minimum,
    SUPPORTED_SCHEDULER_CONFIG.target_avatar_ratio_maximum,
  );
  const targetAvatarMs = transcript.source.duration_ms * targetAvatarRatio;
  const avatarRanges: AvatarRange[] = [opener];
  let avatarMs = rangeDurationMilliseconds(transcript, opener);

  while (targetAvatarMs - avatarMs >= AVATAR_MINIMUM_MS) {
    const previous = avatarRanges.at(-1)!;
    const next = selectNextAvatar(
      transcript,
      previous,
      avatarRanges.length,
      avatarMs,
      targetAvatarMs,
      variation,
    );
    if (next === null) break;
    avatarRanges.push(next);
    avatarMs += rangeDurationMilliseconds(transcript, next);
  }

  const ranges: ScheduledRange[] = [];
  let cursor = 0;
  for (const avatarRange of avatarRanges) {
    const images = partitionImageRange(transcript, cursor, avatarRange.startIndex, variation);
    if (images === null) {
      return fail(
        "TIMELINE_INVALID",
        "An uncovered phrase range cannot be divided into legal image scenes.",
        ["transcript", "phrases", cursor],
      );
    }
    ranges.push(
      ...images.map((range) => ({ ...range, timelineComposition: "IMAGE_FULL" as const })),
      avatarRange,
    );
    cursor = avatarRange.endIndex;
  }

  const tailImages = partitionImageRange(transcript, cursor, transcript.phrases.length, variation);
  if (tailImages === null) {
    return fail(
      "TIMELINE_INVALID",
      "The final phrase range cannot be divided into legal image scenes.",
      ["transcript", "phrases", cursor],
    );
  }
  ranges.push(
    ...tailImages.map((range) => ({ ...range, timelineComposition: "IMAGE_FULL" as const })),
  );

  return {
    schema_version: "timeline-plan/v1",
    project_revision_id: revision.project_revision_id,
    revision_config_hash: request.revision.sha256,
    scheduler_version: revision.scheduler_version,
    seed: revision.scheduler_seed,
    output_fps_num: OUTPUT_FPS,
    output_fps_den: 1,
    total_frames: frameForMilliseconds(transcript.source.duration_ms),
    segments: createTimelineSegments(request, ranges, variation),
  };
}

export async function scheduleTimeline(
  request: SchedulerRequest,
): Promise<PipelineResult<TimelinePlanDocumentRef>> {
  const inputFailure = validateSchedulerInput(request.revision.value, request.transcript.value);
  if (inputFailure !== null) return pipelineFailure(inputFailure);

  const variation = new SeededVariation(
    request.revision.value.project_revision_id,
    request.revision.value.scheduler_version,
    request.revision.value.scheduler_seed,
  );
  const plan = buildTimelinePlan(request, variation);
  if ("code" in plan) return pipelineFailure(plan);

  const semanticFailure = validateTimelineSemantics(plan, request.transcript.value);
  if (semanticFailure !== null) return pipelineFailure(semanticFailure);

  try {
    return pipelineSuccess(await validateAndHashContractDocument("timelinePlan", plan));
  } catch (error) {
    return pipelineFailure(
      fail(
        "TIMELINE_INVALID",
        "The generated timeline did not satisfy the canonical timeline-plan contract.",
        ["timeline"],
        { cause: error instanceof Error ? error.name : "UnknownError" },
      ),
    );
  }
}

export const deterministicTimelineScheduler: SchedulerPort = Object.freeze({
  schedule: scheduleTimeline,
});

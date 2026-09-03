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
import {
  SCHEDULER_SHOT_ROLES,
  SUPPORTED_SCHEDULER_CONFIG,
  SUPPORTED_SCHEDULER_VERSION,
} from "./config.js";
import { SeededVariation } from "./random.js";

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
type ShotRole = (typeof SCHEDULER_SHOT_ROLES)[number];

interface WordRange {
  readonly startIndex: number;
  readonly endIndex: number;
}

interface ScheduledRange extends WordRange {
  readonly timelineComposition: TimelineComposition;
}

interface AvatarRange extends ScheduledRange {
  readonly timelineComposition: "AVATAR_FULL" | "AVATAR_SPLIT_IMAGE";
}

interface ScoredPartition {
  readonly score: number;
  readonly ranges: readonly WordRange[];
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

function boundaryMilliseconds(transcript: TranscriptTimingDocument, wordIndex: number): number {
  if (wordIndex === 0) return 0;
  if (wordIndex === transcript.words.length) return transcript.source.duration_ms;
  return transcript.words[wordIndex]!.start_ms;
}

function rangeDurationMilliseconds(transcript: TranscriptTimingDocument, range: WordRange): number {
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
): readonly WordRange[] | null {
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

function selectOpeners(
  transcript: TranscriptTimingDocument,
  variation: SeededVariation,
  targetAvatarFrames: number,
  minimumAvatarFrames: number,
  maximumAvatarFrames: number,
): readonly AvatarRange[] {
  const desiredDuration = variation.between(
    "avatar-opener-duration",
    SUPPORTED_SCHEDULER_CONFIG.desired_opener_minimum_ms,
    SUPPORTED_SCHEDULER_CONFIG.desired_opener_maximum_ms,
  );
  const candidates: { readonly score: number; readonly range: AvatarRange }[] = [];

  for (let endIndex = 1; endIndex <= transcript.words.length; endIndex += 1) {
    const range: AvatarRange = {
      startIndex: 0,
      endIndex,
      timelineComposition: "AVATAR_FULL",
    };
    const duration = rangeDurationMilliseconds(transcript, range);
    if (duration < AVATAR_MINIMUM_MS) continue;
    if (duration > OPENER_MAXIMUM_MS) break;
    const durationFrames = frameForMilliseconds(boundaryMilliseconds(transcript, endIndex));
    if (durationFrames > maximumAvatarFrames) continue;
    if (
      durationFrames >= minimumAvatarFrames &&
      partitionImageRange(transcript, endIndex, transcript.words.length, variation) === null
    ) {
      continue;
    }
    const score =
      Math.abs(duration - desiredDuration) +
      Math.abs(durationFrames - targetAvatarFrames) *
        SUPPORTED_SCHEDULER_CONFIG.avatar_coverage_score_weight *
        (1_000 / OUTPUT_FPS) +
      variation.between(`avatar-opener:${endIndex}:tie`, 0, 0.25);
    candidates.push({ score, range });
  }

  return candidates.sort((left, right) => left.score - right.score).map(({ range }) => range);
}

function selectNextAvatars(
  transcript: TranscriptTimingDocument,
  previous: AvatarRange,
  appearanceIndex: number,
  currentAvatarFrames: number,
  targetAvatarFrames: number,
  minimumAvatarFrames: number,
  maximumAvatarFrames: number,
  fullAvatarMs: number,
  splitAvatarMs: number,
  variation: SeededVariation,
): readonly AvatarRange[] {
  const previousStart = boundaryMilliseconds(transcript, previous.startIndex);
  const desiredStart =
    previousStart +
    variation.between(
      `avatar-start:${appearanceIndex}`,
      SUPPORTED_SCHEDULER_CONFIG.desired_avatar_start_delta_minimum_ms,
      SUPPORTED_SCHEDULER_CONFIG.desired_avatar_start_delta_maximum_ms,
    );
  const composition = appearanceIndex % 2 === 0 ? "AVATAR_FULL" : "AVATAR_SPLIT_IMAGE";
  const desiredMeanDuration = variation.between(
    `avatar-duration:${appearanceIndex}`,
    SUPPORTED_SCHEDULER_CONFIG.desired_avatar_duration_minimum_ms,
    SUPPORTED_SCHEDULER_CONFIG.desired_avatar_duration_maximum_ms,
  );
  const ownDuration = composition === "AVATAR_FULL" ? fullAvatarMs : splitAvatarMs;
  const peerDuration = composition === "AVATAR_FULL" ? splitAvatarMs : fullAvatarMs;
  const desiredDuration = Math.min(
    AVATAR_MAXIMUM_MS,
    Math.max(
      AVATAR_MINIMUM_MS,
      peerDuration > ownDuration ? peerDuration - ownDuration : desiredMeanDuration,
    ),
  );

  const candidates: { readonly score: number; readonly range: AvatarRange }[] = [];
  for (
    let startIndex = previous.endIndex + 1;
    startIndex < transcript.words.length;
    startIndex += 1
  ) {
    const start = boundaryMilliseconds(transcript, startIndex);
    const startDelta = start - previousStart;
    if (startDelta < MINIMUM_AVATAR_START_DELTA_MS) continue;
    if (startDelta > MAXIMUM_AVATAR_START_DELTA_MS) break;

    if (partitionImageRange(transcript, previous.endIndex, startIndex, variation) === null) {
      continue;
    }

    for (let endIndex = startIndex + 1; endIndex <= transcript.words.length; endIndex += 1) {
      const range: AvatarRange = {
        startIndex,
        endIndex,
        timelineComposition: composition,
      };
      const duration = rangeDurationMilliseconds(transcript, range);
      if (duration < AVATAR_MINIMUM_MS) continue;
      if (duration > AVATAR_MAXIMUM_MS) break;
      const durationFrames =
        frameForMilliseconds(boundaryMilliseconds(transcript, endIndex)) -
        frameForMilliseconds(boundaryMilliseconds(transcript, startIndex));
      const projectedCoverage = currentAvatarFrames + durationFrames;
      if (projectedCoverage > maximumAvatarFrames) continue;
      if (
        projectedCoverage >= minimumAvatarFrames &&
        partitionImageRange(transcript, endIndex, transcript.words.length, variation) === null
      ) {
        continue;
      }
      const projectedFullMs = fullAvatarMs + (composition === "AVATAR_FULL" ? duration : 0);
      const projectedSplitMs =
        splitAvatarMs + (composition === "AVATAR_SPLIT_IMAGE" ? duration : 0);
      const projectedEndFrame = frameForMilliseconds(boundaryMilliseconds(transcript, endIndex));
      const projectedPaceFrames =
        projectedEndFrame *
        ((minimumAvatarFrames + maximumAvatarFrames) /
          2 /
          frameForMilliseconds(transcript.source.duration_ms));
      const key = `avatar:${appearanceIndex}:${startIndex}:${endIndex}`;
      const score =
        Math.abs(start - desiredStart) +
        Math.abs(duration - desiredDuration) *
          SUPPORTED_SCHEDULER_CONFIG.avatar_duration_score_weight +
        Math.abs(projectedCoverage - targetAvatarFrames) *
          SUPPORTED_SCHEDULER_CONFIG.avatar_coverage_score_weight *
          (1_000 / OUTPUT_FPS) +
        Math.abs(projectedCoverage - projectedPaceFrames) *
          SUPPORTED_SCHEDULER_CONFIG.avatar_coverage_pace_score_weight *
          (1_000 / OUTPUT_FPS) +
        Math.abs(projectedFullMs - projectedSplitMs) *
          SUPPORTED_SCHEDULER_CONFIG.avatar_balance_score_weight +
        variation.between(`${key}:tie`, 0, 0.25);
      candidates.push({ score, range });
    }
  }

  return candidates.sort((left, right) => left.score - right.score).map(({ range }) => range);
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

function phraseText(transcript: TranscriptTimingDocument, range: WordRange): string {
  return transcript.words
    .slice(range.startIndex, range.endIndex)
    .map((word) => word.text)
    .join(" ");
}

function shotRoleFor(phrase: string, imageOrdinal: number, rotationOffset: number): ShotRole {
  return (
    lexicalShotRole(phrase) ??
    SCHEDULER_SHOT_ROLES[(rotationOffset + imageOrdinal) % SCHEDULER_SHOT_ROLES.length]!
  );
}

function createTimelineSegments(
  request: SchedulerRequest,
  ranges: readonly ScheduledRange[],
  variation: SeededVariation,
): readonly TimelineSegment[] {
  const transcript = request.transcript.value;
  const rotationOffset = variation.index("shot-role-rotation", SCHEDULER_SHOT_ROLES.length);
  let imageOrdinal = 0;

  return ranges.map((range, index) => {
    const firstWord = transcript.words[range.startIndex]!;
    const lastWord = transcript.words[range.endIndex - 1]!;
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
      word_start: firstWord.index,
      word_end_exclusive: lastWord.index + 1,
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

export function validateTimelineSemantics(
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

  const wordBoundaryStarts = new Map(
    transcript.words.map((word) => [word.index, word.index === 0 ? 0 : word.start_ms] as const),
  );
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
      segment.source_audio_end_ms <= segment.source_audio_start_ms ||
      segment.start_frame !== frameForMilliseconds(segment.source_audio_start_ms) ||
      segment.end_frame_exclusive !== frameForMilliseconds(segment.source_audio_end_ms)
    ) {
      return fail(
        "TIMELINE_INVALID",
        "Timeline segments must cover frames, source audio, and words contiguously.",
        ["segments", index],
      );
    }

    if (wordBoundaryStarts.get(segment.word_start) !== segment.source_audio_start_ms) {
      return fail("TIMELINE_INVALID", "Every segment must begin at an exact word boundary.", [
        "segments",
        index,
        "word_start",
      ]);
    }

    const expectedEndMs = boundaryMilliseconds(transcript, segment.word_end_exclusive);
    const expectedPhrase = transcript.words
      .slice(segment.word_start, segment.word_end_exclusive)
      .map((word) => word.text)
      .join(" ");
    if (expectedEndMs !== segment.source_audio_end_ms || expectedPhrase !== segment.phrase) {
      return fail(
        "TIMELINE_INVALID",
        "Every segment must end at an exact word boundary and preserve its exact word text.",
        ["segments", index],
      );
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

  const avatarSegments = plan.segments.filter(
    (segment) => segment.timeline_composition !== "IMAGE_FULL",
  );
  const avatarFrames = avatarSegments.reduce(
    (sum, segment) => sum + segment.end_frame_exclusive - segment.start_frame,
    0,
  );
  const fullAvatarFrames = avatarSegments
    .filter((segment) => segment.timeline_composition === "AVATAR_FULL")
    .reduce((sum, segment) => sum + segment.end_frame_exclusive - segment.start_frame, 0);
  const splitAvatarFrames = avatarFrames - fullAvatarFrames;
  const avatarRatio = avatarFrames / plan.total_frames;
  if (
    avatarRatio < SUPPORTED_SCHEDULER_CONFIG.target_avatar_ratio_minimum ||
    avatarRatio > SUPPORTED_SCHEDULER_CONFIG.target_avatar_ratio_maximum
  ) {
    return fail("TIMELINE_INVALID", "Avatar coverage must remain inside the locked 21–22% range.", [
      "segments",
    ]);
  }
  if (Math.abs(fullAvatarFrames - splitAvatarFrames) > frameForMilliseconds(OPENER_MAXIMUM_MS)) {
    return fail(
      "TIMELINE_INVALID",
      "Full and split avatar cumulative shares must remain near-even.",
      ["segments"],
    );
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
  const targetAvatarRatio = variation.between(
    "target-avatar-ratio",
    SUPPORTED_SCHEDULER_CONFIG.target_avatar_ratio_minimum,
    SUPPORTED_SCHEDULER_CONFIG.target_avatar_ratio_maximum,
  );
  const totalFrames = frameForMilliseconds(transcript.source.duration_ms);
  const minimumAvatarFrames = Math.ceil(
    totalFrames * SUPPORTED_SCHEDULER_CONFIG.target_avatar_ratio_minimum,
  );
  const maximumAvatarFrames = Math.floor(
    totalFrames * SUPPORTED_SCHEDULER_CONFIG.target_avatar_ratio_maximum,
  );
  const targetAvatarFrames = Math.round(totalFrames * targetAvatarRatio);
  const openers = selectOpeners(
    transcript,
    variation,
    targetAvatarFrames,
    minimumAvatarFrames,
    maximumAvatarFrames,
  );
  if (openers.length === 0) {
    return fail(
      "TIMELINE_INVALID",
      "Word boundaries cannot produce a bounded avatar opener inside the locked coverage range.",
      ["transcript", "words"],
    );
  }
  let ranges: ScheduledRange[] | null = null;
  let coverageFailures = 0;
  let internalPartitionFailures = 0;
  let tailPartitionFailures = 0;
  let maximumReachedAvatarFrames = 0;
  let maximumReachedAvatarCount = 0;
  let lastReachedStartMs = 0;
  for (const opener of openers) {
    const avatarRanges: AvatarRange[] = [opener];
    let avatarFrames = frameForMilliseconds(boundaryMilliseconds(transcript, opener.endIndex));
    let fullAvatarMs = rangeDurationMilliseconds(transcript, opener);
    let splitAvatarMs = 0;
    while (avatarFrames < minimumAvatarFrames) {
      const previous = avatarRanges.at(-1)!;
      const next = selectNextAvatars(
        transcript,
        previous,
        avatarRanges.length,
        avatarFrames,
        targetAvatarFrames,
        minimumAvatarFrames,
        maximumAvatarFrames,
        fullAvatarMs,
        splitAvatarMs,
        variation,
      )[0];
      if (next === undefined) break;
      avatarRanges.push(next);
      const nextDurationMs = rangeDurationMilliseconds(transcript, next);
      avatarFrames +=
        frameForMilliseconds(boundaryMilliseconds(transcript, next.endIndex)) -
        frameForMilliseconds(boundaryMilliseconds(transcript, next.startIndex));
      if (next.timelineComposition === "AVATAR_FULL") fullAvatarMs += nextDurationMs;
      else splitAvatarMs += nextDurationMs;
    }
    if (
      avatarFrames < minimumAvatarFrames ||
      avatarFrames > maximumAvatarFrames ||
      Math.abs(fullAvatarMs - splitAvatarMs) > OPENER_MAXIMUM_MS
    ) {
      if (avatarFrames > maximumReachedAvatarFrames) {
        maximumReachedAvatarFrames = avatarFrames;
        maximumReachedAvatarCount = avatarRanges.length;
        lastReachedStartMs = boundaryMilliseconds(transcript, avatarRanges.at(-1)!.startIndex);
      }
      coverageFailures += 1;
      continue;
    }

    const candidateRanges: ScheduledRange[] = [];
    let cursor = 0;
    let partitioned = true;
    for (const avatarRange of avatarRanges) {
      const images = partitionImageRange(transcript, cursor, avatarRange.startIndex, variation);
      if (images === null) {
        partitioned = false;
        internalPartitionFailures += 1;
        break;
      }
      candidateRanges.push(
        ...images.map((range) => ({ ...range, timelineComposition: "IMAGE_FULL" as const })),
        avatarRange,
      );
      cursor = avatarRange.endIndex;
    }
    if (!partitioned) continue;
    const tailImages = partitionImageRange(transcript, cursor, transcript.words.length, variation);
    if (tailImages === null) {
      tailPartitionFailures += 1;
      continue;
    }
    candidateRanges.push(
      ...tailImages.map((range) => ({ ...range, timelineComposition: "IMAGE_FULL" as const })),
    );
    ranges = candidateRanges;
    break;
  }

  if (ranges === null) {
    return fail(
      "TIMELINE_INVALID",
      "Word boundaries cannot satisfy locked avatar coverage and complete image partitioning.",
      ["transcript", "words"],
      {
        coverageFailures,
        internalPartitionFailures,
        tailPartitionFailures,
        maximumReachedAvatarFrames,
        maximumReachedAvatarCount,
        lastReachedStartMs,
      },
    );
  }

  return {
    schema_version: "timeline-plan/v1",
    project_revision_id: revision.project_revision_id,
    revision_config_hash: request.revision.sha256,
    scheduler_version: revision.scheduler_version,
    seed: revision.scheduler_seed,
    output_fps_num: OUTPUT_FPS,
    output_fps_den: 1,
    total_frames: totalFrames,
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
    return pipelineSuccess(
      await (request.contractDocumentAuthority?.validateAndHash("timelinePlan", plan) ??
        validateAndHashContractDocument("timelinePlan", plan)),
    );
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

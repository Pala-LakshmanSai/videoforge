import {
  parseJsonStrict,
  validateAndHashContractDocument,
  type Sha256Digest,
  type TimelinePlanDocument,
} from "@videoforge/contracts";
import { LocalArtifactStore, SUPPORTED_SCHEDULER_CONFIG } from "@videoforge/pipeline";

import type { TimelineInspection, TimelineInspectionState } from "../../lib/types";
import type { LocalSelectedSpanAudio } from "./types";

interface LocalInspectionIdentity {
  readonly artifactRoot: string;
  readonly projectId: string;
  readonly revisionId: string;
  readonly transcriptSha256: Sha256Digest;
  readonly timelineSha256: Sha256Digest;
  readonly selectedSpanAudio: readonly LocalSelectedSpanAudio[];
}

interface TimelineProjectIdentity {
  readonly id: string;
  readonly revisionId: string;
}

class InspectionInvariantError extends Error {
  constructor(
    readonly state: Exclude<TimelineInspectionState, "CURRENT" | "WAITING">,
    message: string,
  ) {
    super(message);
    this.name = "InspectionInvariantError";
  }
}

function blockedInspection(
  projectId: string,
  revisionId: string,
  state: Exclude<TimelineInspectionState, "CURRENT">,
  blocker: string,
  documents: TimelineInspection["documents"] = {
    transcriptSha256: null,
    timelineSha256: null,
  },
): TimelineInspection {
  return {
    schemaVersion: "videoforge.timeline-inspection/v1",
    projectId,
    revisionId,
    sourceMode: "LOCAL_PERSISTED",
    ready: false,
    invalidation: {
      state,
      recomputeRequired: state !== "WAITING",
      reason: blocker,
    },
    blockers: [blocker],
    documents,
    timing: null,
    plan: null,
    selectedAvatar: null,
    phrases: [],
  };
}

async function inspectStoredDocuments(
  identity: LocalInspectionIdentity,
): Promise<TimelineInspection> {
  const store = await LocalArtifactStore.create(identity.artifactRoot);
  const [transcriptObject, timelineObject] = await Promise.all([
    store.readObject(identity.transcriptSha256, "json"),
    store.readObject(identity.timelineSha256, "json"),
  ]);
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
  const [transcript, timeline] = await Promise.all([
    validateAndHashContractDocument(
      "transcriptTiming",
      parseJsonStrict(decoder.decode(transcriptObject.content)),
    ),
    validateAndHashContractDocument(
      "timelinePlan",
      parseJsonStrict(decoder.decode(timelineObject.content)),
    ),
  ]);
  if (
    transcript.sha256 !== identity.transcriptSha256 ||
    timeline.sha256 !== identity.timelineSha256 ||
    transcript.value.project_revision_id !== identity.revisionId ||
    timeline.value.project_revision_id !== identity.revisionId ||
    transcript.value.project_revision_id !== timeline.value.project_revision_id
  ) {
    throw new InspectionInvariantError(
      "MISMATCHED",
      "The persisted timing documents do not match the selected revision and recorded hashes.",
    );
  }

  let nextFrame = 0;
  let nextSourceMs = 0;
  let nextWord = 0;
  for (const segment of timeline.value.segments) {
    if (
      segment.start_frame !== nextFrame ||
      segment.source_audio_start_ms !== nextSourceMs ||
      segment.word_start !== nextWord
    ) {
      throw new InspectionInvariantError(
        "UNCOVERED",
        "The persisted plan does not provide exact contiguous frame, source-audio, and word coverage.",
      );
    }
    nextFrame = segment.end_frame_exclusive;
    nextSourceMs = segment.source_audio_end_ms;
    nextWord = segment.word_end_exclusive;
  }
  if (
    nextFrame !== timeline.value.total_frames ||
    nextSourceMs !== transcript.value.source.duration_ms ||
    nextWord !== transcript.value.words.length
  ) {
    throw new InspectionInvariantError(
      "UNCOVERED",
      "The persisted plan ends before the selected voiceover, frame range, or transcript word range.",
    );
  }

  const phrases = transcript.value.phrases.map((phrase) => {
    const owners = timeline.value.segments.filter(
      (segment) =>
        segment.word_start <= phrase.word_start &&
        segment.word_end_exclusive >= phrase.word_end_exclusive,
    );
    if (owners.length !== 1 || owners[0] === undefined) {
      throw new InspectionInvariantError(
        "UNCOVERED",
        "At least one canonical phrase is not covered exactly once by the persisted plan.",
      );
    }
    const segment = owners[0];
    return {
      id: phrase.phrase_id,
      startMs: phrase.start_ms,
      endMs: phrase.end_ms,
      text: phrase.text,
      segmentId: segment.segment_id,
      layout: segment.timeline_composition,
    };
  });
  const avatarSegments = timeline.value.segments.filter(
    (
      segment,
    ): segment is Extract<
      TimelinePlanDocument["segments"][number],
      { timeline_composition: "AVATAR_FULL" | "AVATAR_SPLIT_IMAGE" }
    > => segment.timeline_composition !== "IMAGE_FULL",
  );
  const avatarDurationMs = avatarSegments.reduce(
    (total, segment) => total + segment.source_audio_end_ms - segment.source_audio_start_ms,
    0,
  );
  if (identity.selectedSpanAudio.length < avatarSegments.length) {
    throw new InspectionInvariantError(
      "INCOMPLETE",
      "At least one selected avatar span has no persisted materialized audio.",
    );
  }
  if (identity.selectedSpanAudio.length !== avatarSegments.length) {
    throw new InspectionInvariantError(
      "MISMATCHED",
      "Persisted selected span audio does not match the deterministic avatar plan.",
    );
  }
  const spanBySegment = new Map(
    identity.selectedSpanAudio.map((span) => [span.timelineSegmentId, span] as const),
  );
  if (spanBySegment.size !== identity.selectedSpanAudio.length) {
    throw new InspectionInvariantError(
      "MISMATCHED",
      "Persisted selected span audio contains duplicate timeline segment bindings.",
    );
  }
  const paddingMs = SUPPORTED_SCHEDULER_CONFIG.selected_span_context_padding_ms;
  const inspectedSpans = await Promise.all(
    avatarSegments.map(async (segment) => {
      const span = spanBySegment.get(segment.segment_id);
      if (!span) {
        throw new InspectionInvariantError(
          "INCOMPLETE",
          `Selected avatar segment ${segment.segment_id} has no materialized audio.`,
        );
      }
      const expectedPaddedStart = Math.max(0, segment.source_audio_start_ms - paddingMs);
      const expectedPaddedEnd = Math.min(
        transcript.value.source.duration_ms,
        segment.source_audio_end_ms + paddingMs,
      );
      if (
        span.taskKey !== segment.required_slots.avatar.span_audio_task_key ||
        span.selectedStartMs !== segment.source_audio_start_ms ||
        span.selectedEndMsExclusive !== segment.source_audio_end_ms ||
        span.paddedStartMs !== expectedPaddedStart ||
        span.paddedEndMsExclusive !== expectedPaddedEnd ||
        span.trimStartMs !== segment.source_audio_start_ms - expectedPaddedStart ||
        span.trimEndMsExclusive !==
          segment.source_audio_start_ms -
            expectedPaddedStart +
            segment.source_audio_end_ms -
            segment.source_audio_start_ms ||
        span.durationMs !== expectedPaddedEnd - expectedPaddedStart
      ) {
        throw new InspectionInvariantError(
          "MISMATCHED",
          `Materialized audio for ${segment.segment_id} does not match its selected and padded lineage.`,
        );
      }
      const artifact = await store.verifyObject(span.sha256, "wav");
      if (artifact.bytes !== span.bytes) {
        throw new InspectionInvariantError(
          "MISMATCHED",
          `Materialized audio for ${segment.segment_id} has drifted.`,
        );
      }
      return {
        id: segment.segment_id,
        startMs: segment.source_audio_start_ms,
        endMs: segment.source_audio_end_ms,
        layout: segment.timeline_composition,
        phrase: segment.phrase,
        audioSha256: span.sha256,
      };
    }),
  );

  return {
    schemaVersion: "videoforge.timeline-inspection/v1",
    projectId: identity.projectId,
    revisionId: identity.revisionId,
    sourceMode: "LOCAL_PERSISTED",
    ready: true,
    invalidation: { state: "CURRENT", recomputeRequired: false, reason: null },
    blockers: [],
    documents: {
      transcriptSha256: transcript.sha256,
      timelineSha256: timeline.sha256,
    },
    timing: {
      sourceDurationMs: transcript.value.source.duration_ms,
      timedWordCount: transcript.value.words.length,
      phraseCount: transcript.value.phrases.length,
      phraseStartMs: transcript.value.phrases.at(0)?.start_ms ?? 0,
      phraseEndMs: transcript.value.phrases.at(-1)?.end_ms ?? transcript.value.source.duration_ms,
      coverage: "COMPLETE",
    },
    plan: {
      fps: 30,
      totalFrames: timeline.value.total_frames,
      segmentCount: timeline.value.segments.length,
      sourceStartMs: timeline.value.segments.at(0)?.source_audio_start_ms ?? 0,
      sourceEndMs:
        timeline.value.segments.at(-1)?.source_audio_end_ms ?? transcript.value.source.duration_ms,
      coverage: "COMPLETE",
    },
    selectedAvatar: {
      count: avatarSegments.length,
      materializedCount: inspectedSpans.length,
      durationMs: avatarDurationMs,
      coveragePercent: Number(
        ((avatarDurationMs / transcript.value.source.duration_ms) * 100).toFixed(2),
      ),
      spans: inspectedSpans,
    },
    phrases,
  };
}

export async function localTimelineInspection(
  project: TimelineProjectIdentity,
  identity: Omit<LocalInspectionIdentity, "projectId" | "revisionId"> | null,
): Promise<TimelineInspection> {
  if (!identity) {
    return blockedInspection(
      project.id,
      project.revisionId,
      "WAITING",
      "Persisted transcript timing and the deterministic plan are not both available yet.",
    );
  }
  try {
    return await inspectStoredDocuments({
      ...identity,
      projectId: project.id,
      revisionId: project.revisionId,
    });
  } catch (error) {
    const state = error instanceof InspectionInvariantError ? error.state : "MISMATCHED";
    const blocker =
      error instanceof InspectionInvariantError
        ? error.message
        : "Persisted timing bytes failed hash, UTF-8, JSON, or schema verification.";
    return blockedInspection(project.id, project.revisionId, state, blocker, {
      transcriptSha256: identity.transcriptSha256,
      timelineSha256: identity.timelineSha256,
    });
  }
}

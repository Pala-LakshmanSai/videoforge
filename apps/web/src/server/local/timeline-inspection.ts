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
  readonly generationWorkManifestSha256: Sha256Digest;
  readonly renderWorkManifestSha256: Sha256Digest;
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
    workPlan: null,
    selectedAvatar: null,
    phrases: [],
  };
}

async function inspectStoredDocuments(
  identity: LocalInspectionIdentity,
): Promise<TimelineInspection> {
  const store = await LocalArtifactStore.create(identity.artifactRoot);
  const [transcriptObject, timelineObject, generationWorkObject, renderWorkObject] =
    await Promise.all([
      store.readObject(identity.transcriptSha256, "json"),
      store.readObject(identity.timelineSha256, "json"),
      store.readObject(identity.generationWorkManifestSha256, "json"),
      store.readObject(identity.renderWorkManifestSha256, "json"),
    ]);
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
  const [transcript, timeline, generationWork, renderWork] = await Promise.all([
    validateAndHashContractDocument(
      "transcriptTiming",
      parseJsonStrict(decoder.decode(transcriptObject.content)),
    ),
    validateAndHashContractDocument(
      "timelinePlan",
      parseJsonStrict(decoder.decode(timelineObject.content)),
    ),
    validateAndHashContractDocument(
      "generationWorkManifest",
      parseJsonStrict(decoder.decode(generationWorkObject.content)),
    ),
    validateAndHashContractDocument(
      "renderWorkManifest",
      parseJsonStrict(decoder.decode(renderWorkObject.content)),
    ),
  ]);
  if (
    transcript.sha256 !== identity.transcriptSha256 ||
    timeline.sha256 !== identity.timelineSha256 ||
    generationWork.sha256 !== identity.generationWorkManifestSha256 ||
    renderWork.sha256 !== identity.renderWorkManifestSha256 ||
    transcript.value.project_revision_id !== identity.revisionId ||
    timeline.value.project_revision_id !== identity.revisionId ||
    transcript.value.project_revision_id !== timeline.value.project_revision_id
  ) {
    throw new InspectionInvariantError(
      "MISMATCHED",
      "The persisted timing documents do not match the selected revision and recorded hashes.",
    );
  }
  if (
    generationWork.value.project_revision_id !== identity.revisionId ||
    renderWork.value.project_revision_id !== identity.revisionId ||
    generationWork.value.timeline_plan_hash !== timeline.sha256 ||
    renderWork.value.timeline_plan_hash !== timeline.sha256 ||
    renderWork.value.generation_work_manifest_hash !== generationWork.sha256 ||
    generationWork.value.cost_counts.render_segment_count !== timeline.value.segments.length ||
    renderWork.value.segments.length !== timeline.value.segments.length
  ) {
    throw new InspectionInvariantError(
      "MISMATCHED",
      "Persisted work and render manifests do not match the exact deterministic timeline.",
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
        segment.word_start < phrase.word_end_exclusive &&
        segment.word_end_exclusive > phrase.word_start,
    );
    let ownedWord = phrase.word_start;
    for (const owner of owners) {
      if (Math.max(owner.word_start, phrase.word_start) !== ownedWord) break;
      ownedWord = Math.min(owner.word_end_exclusive, phrase.word_end_exclusive);
    }
    if (owners.length === 0 || owners[0] === undefined || ownedWord !== phrase.word_end_exclusive) {
      throw new InspectionInvariantError(
        "UNCOVERED",
        "At least one canonical phrase is not covered exactly once by the persisted plan.",
      );
    }
    const segment = owners[0];
    const layouts = [...new Set(owners.map((owner) => owner.timeline_composition))];
    const shotRoles = [
      ...new Set(
        owners.flatMap((owner) =>
          "in_image_shot_role" in owner ? [owner.in_image_shot_role] : [],
        ),
      ),
    ];
    return {
      id: phrase.phrase_id,
      startMs: phrase.start_ms,
      endMs: phrase.end_ms,
      text: phrase.text,
      segmentId: segment.segment_id,
      segmentIds: owners.map((owner) => owner.segment_id),
      layout: segment.timeline_composition,
      layouts,
      startFrame: Math.round((phrase.start_ms * 30) / 1_000),
      endFrameExclusive: Math.round((phrase.end_ms * 30) / 1_000),
      shotRole: shotRoles.length === 1 ? shotRoles[0]! : null,
      shotRoles,
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
        artifactId: span.artifactId,
        audioSha256: span.sha256,
        paddedStartMs: span.paddedStartMs,
        paddedEndMs: span.paddedEndMsExclusive,
        trimStartMs: span.trimStartMs,
        trimEndMs: span.trimEndMsExclusive,
      };
    }),
  );

  const workSpanBySegment = new Map(
    generationWork.value.avatar_spans.map((span) => [span.timeline_segment_id, span] as const),
  );
  if (
    workSpanBySegment.size !== inspectedSpans.length ||
    inspectedSpans.some((span) => {
      const work = workSpanBySegment.get(span.id);
      return (
        !work ||
        work.span_audio_artifact_id !== span.artifactId ||
        work.span_audio_sha256 !== span.audioSha256 ||
        work.padded_start_ms !== span.paddedStartMs ||
        work.padded_end_ms_exclusive !== span.paddedEndMs ||
        work.trim_start_ms !== span.trimStartMs ||
        work.trim_end_ms_exclusive !== span.trimEndMs
      );
    }) ||
    generationWork.value.image_slots.length !==
      timeline.value.segments.filter((segment) => segment.timeline_composition !== "AVATAR_FULL")
        .length
  ) {
    throw new InspectionInvariantError(
      "MISMATCHED",
      "Complete work manifest contains missing, duplicate, or drifted image/span work.",
    );
  }

  const compositionCounts = {
    avatarFull: timeline.value.segments.filter(
      (segment) => segment.timeline_composition === "AVATAR_FULL",
    ).length,
    imageFull: timeline.value.segments.filter(
      (segment) => segment.timeline_composition === "IMAGE_FULL",
    ).length,
    avatarSplitImage: timeline.value.segments.filter(
      (segment) => segment.timeline_composition === "AVATAR_SPLIT_IMAGE",
    ).length,
  };
  const avatarFullMs = timeline.value.segments
    .filter((segment) => segment.timeline_composition === "AVATAR_FULL")
    .reduce(
      (total, segment) => total + segment.source_audio_end_ms - segment.source_audio_start_ms,
      0,
    );
  const avatarSplitMs = avatarDurationMs - avatarFullMs;

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
      compositionCounts,
      avatarFullPercent: Number(
        ((avatarFullMs / transcript.value.source.duration_ms) * 100).toFixed(2),
      ),
      avatarSplitPercent: Number(
        ((avatarSplitMs / transcript.value.source.duration_ms) * 100).toFixed(2),
      ),
    },
    workPlan: {
      generationManifestSha256: generationWork.sha256,
      renderManifestSha256: renderWork.sha256,
      promptBatchCount: generationWork.value.cost_counts.prompt_batch_count,
      imageSlotCount: generationWork.value.cost_counts.image_generation_count,
      avatarTaskCount: generationWork.value.cost_counts.avatar_generation_count,
      renderSegmentCount: generationWork.value.cost_counts.render_segment_count,
      shotRoleCount: new Set(
        generationWork.value.image_slots.map((slot) => slot.in_image_shot_role),
      ).size,
      hardCutsOnly: renderWork.value.transition_policy === "HARD_CUTS_ONLY",
      slowImageZoomRequired: renderWork.value.segments
        .filter((segment) => segment.timeline_composition !== "AVATAR_FULL")
        .every((segment) => segment.image_zoom_profile === "SLOW_SMOOTH_CENTERED_ZOOM"),
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

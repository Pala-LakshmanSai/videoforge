import type { TimelinePlanDocument } from "@videoforge/contracts";

export interface HostedVideoSelection {
  readonly segmentId: string;
  readonly sourceTaskKey: string;
  readonly videoFrameCount: number;
  readonly durationSeconds: number;
}

// Leave 0.1 seconds of provider frame-quantization headroom within the 12-second request limit.
const MAX_VIDEO_FRAMES = 357;

export type HostedVideoReplacementPolicy =
  | "LEGACY_PREFIX_V1"
  | "WHOLE_SCENE_V2"
  | "OPENING_180_V3"
  | "OPENING_CONFIG_V4";
export interface HostedVideoPolicy {
  readonly coveragePercent: number;
  readonly replacementPolicy: HostedVideoReplacementPolicy;
  readonly openingSeconds?: number;
}

/** Historical policy always retains its original threshold. */
export function hostedVideoOpeningSeconds(policy: HostedVideoPolicy): number {
  if (policy.replacementPolicy === "OPENING_180_V3") return 180;
  if (policy.replacementPolicy !== "OPENING_CONFIG_V4") return 0;
  const seconds = policy.openingSeconds;
  if (!Number.isSafeInteger(seconds) || seconds! < 6 || seconds! > 3600 || seconds! % 6 !== 0)
    throw new Error("HOSTED_VIDEO_POLICY_INVALID");
  return seconds!;
}

/** Select deterministic, spread image scenes within the pinned finished-film budget. */
export function planHostedVideoSelections(
  timeline: Pick<TimelinePlanDocument, "total_frames" | "segments">,
  policy: HostedVideoPolicy = { coveragePercent: 7, replacementPolicy: "LEGACY_PREFIX_V1" },
): HostedVideoSelection[] {
  if (
    !Number.isSafeInteger(policy.coveragePercent) ||
    policy.coveragePercent < 0 ||
    policy.coveragePercent > 100 ||
    !["LEGACY_PREFIX_V1", "WHOLE_SCENE_V2", "OPENING_180_V3", "OPENING_CONFIG_V4"].includes(
      policy.replacementPolicy,
    ) ||
    (policy.replacementPolicy === "LEGACY_PREFIX_V1" && policy.coveragePercent !== 7)
  )
    throw new Error("HOSTED_VIDEO_POLICY_INVALID");
  const openingSeconds = hostedVideoOpeningSeconds(policy);
  if (openingSeconds > 0) {
    const openingFrames = openingSeconds * 30;
    const opening = timeline.segments.filter((segment) => segment.start_frame < openingFrames);
    if (
      opening.some(
        (segment) =>
          segment.timeline_composition !== "IMAGE_FULL" ||
          segment.end_frame_exclusive <= segment.start_frame ||
          segment.end_frame_exclusive - segment.start_frame > MAX_VIDEO_FRAMES,
      )
    )
      throw new Error("HOSTED_VIDEO_OPENING_TIMELINE_INVALID");
    const budget = openingVideoBudget(timeline, policy.coveragePercent, openingSeconds);
    // Reuse the exact whole-scene spread/fill algorithm with the remaining-duration budget.
    const optional = planHostedVideoSelections(
      {
        total_frames: budget.optionalFrames,
        segments: timeline.segments.filter((segment) => segment.start_frame >= openingFrames),
      },
      { coveragePercent: 100, replacementPolicy: "WHOLE_SCENE_V2" },
    );
    return [
      ...opening.map((segment) => {
        if (segment.timeline_composition !== "IMAGE_FULL")
          throw new Error("HOSTED_VIDEO_TIMELINE_INVALID");
        const videoFrameCount = segment.end_frame_exclusive - segment.start_frame;
        return {
          segmentId: segment.segment_id,
          sourceTaskKey: segment.required_slots.image.task_key,
          videoFrameCount,
          durationSeconds: Math.max(1.2, Math.ceil((videoFrameCount + 3) / 3) / 10),
        };
      }),
      ...optional,
    ];
  }
  const target = Math.floor((timeline.total_frames * policy.coveragePercent) / 100);
  if (policy.replacementPolicy === "WHOLE_SCENE_V2") {
    const candidates = timeline.segments.filter(
      (segment) =>
        segment.timeline_composition === "IMAGE_FULL" &&
        segment.end_frame_exclusive > segment.start_frame &&
        segment.end_frame_exclusive - segment.start_frame <= MAX_VIDEO_FRAMES,
    );
    if (!target || !candidates.length) return [];
    // Find the largest evenly spread complete subset that fits. Then fill gaps with
    // fitting complete scenes in timeline order. Never split a selected scene.
    let selected: typeof candidates = [];
    for (let count = 1; count <= candidates.length; count++) {
      const spread = Array.from(
        { length: count },
        (_, index) => candidates[Math.floor(((index + 0.5) * candidates.length) / count)]!,
      );
      if (
        spread.reduce(
          (sum, segment) => sum + segment.end_frame_exclusive - segment.start_frame,
          0,
        ) <= target
      )
        selected = spread;
    }
    let remaining =
      target -
      selected.reduce((sum, segment) => sum + segment.end_frame_exclusive - segment.start_frame, 0);
    const selectedIds = new Set(selected.map((segment) => segment.segment_id));
    for (const segment of candidates) {
      const frames = segment.end_frame_exclusive - segment.start_frame;
      if (!selectedIds.has(segment.segment_id) && frames <= remaining) {
        selected.push(segment);
        selectedIds.add(segment.segment_id);
        remaining -= frames;
      }
    }
    return selected
      .sort((a, b) => a.start_frame - b.start_frame)
      .map((segment) => {
        const videoFrameCount = segment.end_frame_exclusive - segment.start_frame;
        if (segment.timeline_composition !== "IMAGE_FULL")
          throw new Error("HOSTED_VIDEO_TIMELINE_INVALID");
        return {
          segmentId: segment.segment_id,
          sourceTaskKey: segment.required_slots.image.task_key,
          videoFrameCount,
          durationSeconds: Math.max(1.2, Math.ceil((videoFrameCount + 3) / 3) / 10),
        };
      });
  }
  const candidates = timeline.segments.filter(
    (segment) => segment.timeline_composition === "IMAGE_FULL",
  );
  if (target <= 0 || candidates.length === 0) return [];
  let selected = candidates;
  for (let count = 1; count <= candidates.length; count++) {
    const spread = Array.from(
      { length: count },
      (_, index) => candidates[Math.floor(((index + 0.5) * candidates.length) / count)]!,
    );
    if (
      spread.reduce(
        (sum, segment) =>
          sum + Math.min(MAX_VIDEO_FRAMES, segment.end_frame_exclusive - segment.start_frame),
        0,
      ) >= target
    ) {
      selected = spread;
      break;
    }
  }
  let remaining = target;
  const result: HostedVideoSelection[] = [];
  for (const segment of selected) {
    if (segment.timeline_composition !== "IMAGE_FULL" || remaining <= 0) break;
    const videoFrameCount = Math.min(
      remaining,
      MAX_VIDEO_FRAMES,
      segment.end_frame_exclusive - segment.start_frame,
    );
    if (videoFrameCount <= 0) throw new Error("HOSTED_VIDEO_TIMELINE_INVALID");
    result.push({
      segmentId: segment.segment_id,
      sourceTaskKey: segment.required_slots.image.task_key,
      videoFrameCount,
      durationSeconds: Math.max(1.2, Math.ceil((videoFrameCount + 3) / 3) / 10),
    });
    remaining -= videoFrameCount;
  }
  return result;
}

export const OPENING_VIDEO_FRAMES = 180 * 30;

/** Whole crossing scenes finish in motion; their suffix consumes optional coverage first. */
export function openingVideoBudget(
  timeline: Pick<TimelinePlanDocument, "total_frames" | "segments">,
  coveragePercent: number,
  openingSeconds = 180,
) {
  if (
    !Number.isSafeInteger(openingSeconds) ||
    openingSeconds < 6 ||
    openingSeconds > 3600 ||
    openingSeconds % 6 !== 0
  )
    throw new Error("HOSTED_VIDEO_POLICY_INVALID");
  const openingFrames = openingSeconds * 30;
  const mandatoryFrames = timeline.segments
    .filter((segment) => segment.start_frame < openingFrames)
    .reduce((sum, segment) => sum + segment.end_frame_exclusive - segment.start_frame, 0);
  const remainingFrames = Math.max(0, timeline.total_frames - openingFrames);
  const crossingFrames = Math.max(
    0,
    mandatoryFrames - Math.min(timeline.total_frames, openingFrames),
  );
  const optionalFrames = Math.max(
    0,
    Math.floor((remainingFrames * coveragePercent) / 100) - crossingFrames,
  );
  const rendererCoveragePercent = Math.min(
    100,
    Math.ceil(((mandatoryFrames + optionalFrames) * 100) / timeline.total_frames),
  );
  return {
    mandatoryFrames,
    remainingFrames,
    crossingFrames,
    optionalFrames,
    rendererCoveragePercent,
  };
}

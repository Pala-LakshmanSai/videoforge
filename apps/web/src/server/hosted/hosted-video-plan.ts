import type { TimelinePlanDocument } from "@videoforge/contracts";

export interface HostedVideoSelection {
  readonly segmentId: string;
  readonly sourceTaskKey: string;
  readonly videoFrameCount: number;
  readonly durationSeconds: number;
}

/** Select evenly spaced image scenes, with exact frame coverage and no extra inference. */
export function planHostedVideoSelections(timeline: Pick<TimelinePlanDocument, "total_frames" | "segments">): HostedVideoSelection[] {
  const target = Math.floor(timeline.total_frames * 7 / 100);
  const candidates = timeline.segments.filter((segment) => segment.timeline_composition === "IMAGE_FULL");
  if (target <= 0 || candidates.length === 0) return [];
  let selected = candidates;
  for (let count = 1; count <= candidates.length; count++) {
    const spread = Array.from({ length: count }, (_, index) => candidates[Math.floor((index + 0.5) * candidates.length / count)]!);
    if (spread.reduce((sum, segment) => sum + Math.min(360, segment.end_frame_exclusive - segment.start_frame), 0) >= target) {
      selected = spread;
      break;
    }
  }
  let remaining = target;
  const result: HostedVideoSelection[] = [];
  for (const segment of selected) {
    if (segment.timeline_composition !== "IMAGE_FULL" || remaining <= 0) break;
    const videoFrameCount = Math.min(remaining, 360, segment.end_frame_exclusive - segment.start_frame);
    if (videoFrameCount <= 0) throw new Error("HOSTED_VIDEO_TIMELINE_INVALID");
    result.push({ segmentId: segment.segment_id, sourceTaskKey: segment.required_slots.image.task_key,
      videoFrameCount, durationSeconds: Math.max(1.2, Math.ceil(videoFrameCount / 3) / 10) });
    remaining -= videoFrameCount;
  }
  return result;
}

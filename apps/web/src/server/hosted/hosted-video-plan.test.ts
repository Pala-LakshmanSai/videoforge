import { describe, expect, it } from "vitest";
import type { TimelinePlanDocument } from "@videoforge/contracts";
import { planHostedVideoSelections } from "./hosted-video-plan";

function timeline(count: number): TimelinePlanDocument {
  return { total_frames: count * 150, segments: Array.from({ length: count }, (_, i) => ({
    segment_id: `scene-${i}`, start_frame: i * 150, end_frame_exclusive: (i + 1) * 150,
    timeline_composition: i % 3 === 0 ? "AVATAR_FULL" : "IMAGE_FULL",
    required_slots: { image: { task_key: `image:scene-${i}` }, avatar: { task_key: `avatar:scene-${i}` } },
  })) } as unknown as TimelinePlanDocument;
}

describe("pinned 7% motion plan", () => {
  it("uses exact frames, spreads footage and never replaces avatar scenes", () => {
    const input = timeline(360);
    const result = planHostedVideoSelections(input);
    expect(result.reduce((sum, selection) => sum + selection.videoFrameCount, 0)).toBe(3780);
    expect(result.every((s) => Number(s.segmentId.split("-")[1]) % 3 !== 0)).toBe(true);
    expect(result.at(0)!.segmentId).not.toBe("scene-1");
    expect(Number(result.at(-1)!.segmentId.split("-")[1])).toBeGreaterThan(330);
    expect(result.every((s) => s.durationSeconds >= 1.2 && s.durationSeconds * 30 >= s.videoFrameCount && s.durationSeconds <= 12)).toBe(true);
    expect(planHostedVideoSelections(input)).toEqual(result);
  });
  it("keeps short coverage within the budget and handles no eligible images", () => {
    const short = timeline(6);
    expect(planHostedVideoSelections(short).reduce((sum, s) => sum + s.videoFrameCount, 0)).toBe(63);
    expect(planHostedVideoSelections(timeline(1))).toEqual([]);
  });
});

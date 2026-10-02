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
    expect(result.every((s) => s.durationSeconds >= 1.2 && (s.durationSeconds - 0.1) * 30 + 1e-9 >= s.videoFrameCount && s.durationSeconds <= 12)).toBe(true);
    expect(planHostedVideoSelections(input)).toEqual(result);
  });
  it("keeps short coverage within the budget and handles no eligible images", () => {
    const short = timeline(6);
    expect(planHostedVideoSelections(short).reduce((sum, s) => sum + s.videoFrameCount, 0)).toBe(63);
    expect(planHostedVideoSelections(timeline(1))).toEqual([]);
  });
  it("pads the live 37-frame short clip to 1.4 seconds without adding timeline frames", () => {
    const input = { total_frames: 529, segments: [
      { segment_id: "image-scene", start_frame: 0, end_frame_exclusive: 150, timeline_composition: "IMAGE_FULL",
        required_slots: { image: { task_key: "image:image-scene" } } },
      { segment_id: "avatar-scene", start_frame: 150, end_frame_exclusive: 529, timeline_composition: "AVATAR_FULL" },
    ] } as unknown as TimelinePlanDocument;
    const [selection] = planHostedVideoSelections(input);
    expect(selection).toMatchObject({ videoFrameCount: 37, durationSeconds: 1.4 });
    expect(planHostedVideoSelections(input)).toHaveLength(1);
  });
  it("caps footage at 357 frames per 12-second request and redistributes exact seven percent coverage", () => {
    const input = { total_frames: 6000, segments: Array.from({ length: 10 }, (_, i) => ({
      segment_id: `scene-${i}`, start_frame: i * 600, end_frame_exclusive: (i + 1) * 600,
      timeline_composition: "IMAGE_FULL", required_slots: { image: { task_key: `image:scene-${i}` } },
    })) } as unknown as TimelinePlanDocument;
    const result = planHostedVideoSelections(input);
    expect(result.map((s) => [s.videoFrameCount, s.durationSeconds])).toEqual([[357, 12], [63, 2.2]]);
    expect(result.reduce((sum, s) => sum + s.videoFrameCount, 0)).toBe(420);
    expect(new Set(result.map((s) => s.segmentId)).size).toBe(2);
    expect(result.every((s) => s.durationSeconds <= 12 && (s.durationSeconds - 0.1) * 30 + 1e-9 >= s.videoFrameCount)).toBe(true);
  });
});

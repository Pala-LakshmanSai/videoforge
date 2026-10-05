import { describe, expect, it } from "vitest";
import type { TimelinePlanDocument } from "@videoforge/contracts";
import { planHostedVideoSelections, openingVideoBudget } from "./hosted-video-plan";

function timeline(count: number): TimelinePlanDocument {
  return {
    total_frames: count * 150,
    segments: Array.from({ length: count }, (_, i) => ({
      segment_id: `scene-${i}`,
      start_frame: i * 150,
      end_frame_exclusive: (i + 1) * 150,
      timeline_composition: i % 3 === 0 ? "AVATAR_FULL" : "IMAGE_FULL",
      required_slots: {
        image: { task_key: `image:scene-${i}` },
        avatar: { task_key: `avatar:scene-${i}` },
      },
    })),
  } as unknown as TimelinePlanDocument;
}

describe("pinned 7% motion plan", () => {
  it("uses exact frames, spreads footage and never replaces avatar scenes", () => {
    const input = timeline(360);
    const result = planHostedVideoSelections(input);
    expect(result.reduce((sum, selection) => sum + selection.videoFrameCount, 0)).toBe(3780);
    expect(result.every((s) => Number(s.segmentId.split("-")[1]) % 3 !== 0)).toBe(true);
    expect(result.at(0)!.segmentId).not.toBe("scene-1");
    expect(Number(result.at(-1)!.segmentId.split("-")[1])).toBeGreaterThan(330);
    expect(
      result.every(
        (s) =>
          s.durationSeconds >= 1.2 &&
          (s.durationSeconds - 0.1) * 30 + 1e-9 >= s.videoFrameCount &&
          s.durationSeconds <= 12,
      ),
    ).toBe(true);
    expect(planHostedVideoSelections(input)).toEqual(result);
  });
  it("keeps short coverage within the budget and handles no eligible images", () => {
    const short = timeline(6);
    expect(planHostedVideoSelections(short).reduce((sum, s) => sum + s.videoFrameCount, 0)).toBe(
      63,
    );
    expect(planHostedVideoSelections(timeline(1))).toEqual([]);
  });
  it("pads the live 37-frame short clip to 1.4 seconds without adding timeline frames", () => {
    const input = {
      total_frames: 529,
      segments: [
        {
          segment_id: "image-scene",
          start_frame: 0,
          end_frame_exclusive: 150,
          timeline_composition: "IMAGE_FULL",
          required_slots: { image: { task_key: "image:image-scene" } },
        },
        {
          segment_id: "avatar-scene",
          start_frame: 150,
          end_frame_exclusive: 529,
          timeline_composition: "AVATAR_FULL",
        },
      ],
    } as unknown as TimelinePlanDocument;
    const [selection] = planHostedVideoSelections(input);
    expect(selection).toMatchObject({ videoFrameCount: 37, durationSeconds: 1.4 });
    expect(planHostedVideoSelections(input)).toHaveLength(1);
  });
  it("caps footage at 357 frames per 12-second request and redistributes exact seven percent coverage", () => {
    const input = {
      total_frames: 6000,
      segments: Array.from({ length: 10 }, (_, i) => ({
        segment_id: `scene-${i}`,
        start_frame: i * 600,
        end_frame_exclusive: (i + 1) * 600,
        timeline_composition: "IMAGE_FULL",
        required_slots: { image: { task_key: `image:scene-${i}` } },
      })),
    } as unknown as TimelinePlanDocument;
    const result = planHostedVideoSelections(input);
    expect(result.map((s) => [s.videoFrameCount, s.durationSeconds])).toEqual([
      [357, 12],
      [63, 2.2],
    ]);
    expect(result.reduce((sum, s) => sum + s.videoFrameCount, 0)).toBe(420);
    expect(new Set(result.map((s) => s.segmentId)).size).toBe(2);
    expect(
      result.every(
        (s) =>
          s.durationSeconds <= 12 && (s.durationSeconds - 0.1) * 30 + 1e-9 >= s.videoFrameCount,
      ),
    ).toBe(true);
  });
});

describe("whole scene coverage policy", () => {
  const policy = (coveragePercent: number) => ({
    coveragePercent,
    replacementPolicy: "WHOLE_SCENE_V2" as const,
  });
  it.each([0, 7, 15, 25, 50, 75, 100])(
    "keeps complete spread scenes within a %i percent ceiling",
    (percent) => {
      const input = timeline(360);
      const selections = planHostedVideoSelections(input, policy(percent));
      expect(selections.reduce((sum, s) => sum + s.videoFrameCount, 0)).toBeLessThanOrEqual(
        Math.floor((input.total_frames * percent) / 100),
      );
      expect(
        selections.every(
          (s) => s.videoFrameCount === 150 && Number(s.segmentId.split("-")[1]) % 3 !== 0,
        ),
      ).toBe(true);
      expect(selections.every((s) => s.durationSeconds === 5.1)).toBe(true);
      expect(planHostedVideoSelections(input, policy(percent))).toEqual(selections);
      if (percent === 0) expect(selections).toEqual([]);
      if (percent === 100) expect(selections).toHaveLength(240);
      if (percent > 0)
        expect(Number(selections.at(-1)!.segmentId.split("-")[1])).toBeGreaterThan(330);
    },
  );
  it("underfills a short film without splitting, while an exact fit selects the complete scene", () => {
    const input = {
      total_frames: 990,
      segments: [
        {
          segment_id: "car",
          start_frame: 0,
          end_frame_exclusive: 150,
          timeline_composition: "IMAGE_FULL",
          required_slots: { image: { task_key: "image:car" } },
        },
      ],
    } as unknown as TimelinePlanDocument;
    expect(planHostedVideoSelections(input, policy(7))).toEqual([]);
    expect(planHostedVideoSelections(input, policy(20))).toEqual([
      { segmentId: "car", sourceTaskKey: "image:car", videoFrameCount: 150, durationSeconds: 5.1 },
    ]);
    expect(planHostedVideoSelections({ ...input, total_frames: 600 }, policy(25))).toHaveLength(1);
  });
  it("skips oversized scenes and fills remaining budget with fitting complete scenes", () => {
    const input = {
      total_frames: 600,
      segments: [360, 120, 120].map((frames, i) => ({
        segment_id: `scene-${i}`,
        start_frame: i === 0 ? 0 : 360 + (i - 1) * 120,
        end_frame_exclusive: i === 0 ? 360 : 360 + i * 120,
        timeline_composition: "IMAGE_FULL",
        required_slots: { image: { task_key: `image:${i}` } },
      })),
    } as unknown as TimelinePlanDocument;
    expect(planHostedVideoSelections(input, policy(100)).map((s) => s.videoFrameCount)).toEqual([
      120, 120,
    ]);
    expect(planHostedVideoSelections(timeline(1), policy(100))).toEqual([]);
  });
  it.each([-1, 101, 0.5, NaN, Infinity])("rejects invalid policy %s", (percent) => {
    expect(() => planHostedVideoSelections(timeline(6), policy(percent))).toThrow(
      "HOSTED_VIDEO_POLICY_INVALID",
    );
  });
});

describe("independent three-minute opening", () => {
  const openingTimeline = (count: number) =>
    ({
      ...timeline(count),
      segments: timeline(count).segments.map((s) => ({
        ...s,
        timeline_composition: "IMAGE_FULL",
        required_slots: { image: { task_key: `image:${s.segment_id}` } },
      })),
    }) as TimelinePlanDocument;
  it.each([0, 7, 15, 25, 50, 75, 100, 33])(
    "requires every opening scene at %i percent and budgets only the remainder",
    (percent) => {
      const input = openingTimeline(120); // 10 minutes; first36 scenes mandatory.
      const selections = planHostedVideoSelections(input, {
        coveragePercent: percent,
        replacementPolicy: "OPENING_180_V3",
      });
      const mandatory = selections.filter((s) => Number(s.segmentId.split("-")[1]) < 36);
      const optional = selections.filter((s) => Number(s.segmentId.split("-")[1]) >= 36);
      expect(mandatory).toHaveLength(36);
      expect(optional.reduce((sum, s) => sum + s.videoFrameCount, 0)).toBeLessThanOrEqual(
        Math.floor((12600 * percent) / 100),
      );
      const priorOptional = planHostedVideoSelections(
        { total_frames: 12600, segments: input.segments.slice(36) },
        { coveragePercent: percent, replacementPolicy: "WHOLE_SCENE_V2" },
      );
      expect(optional).toEqual(priorOptional);
      expect(
        planHostedVideoSelections(input, {
          coveragePercent: percent,
          replacementPolicy: "OPENING_180_V3",
        }),
      ).toEqual(selections);
    },
  );
  it.each([4, 36])(
    "fully covers short and exact180second films even at zero percent (%i scenes)",
    (count) => {
      const input = openingTimeline(count);
      const selections = planHostedVideoSelections(input, {
        coveragePercent: 0,
        replacementPolicy: "OPENING_180_V3",
      });
      expect(selections).toHaveLength(count);
      expect(selections.reduce((sum, s) => sum + s.videoFrameCount, 0)).toBe(input.total_frames);
      expect(openingVideoBudget(input, 0).rendererCoveragePercent).toBe(100);
    },
  );
  it("finishes a crossing scene in motion and consumes its tail before optional coverage", () => {
    const input = openingTimeline(120);
    const segments = input.segments.map((s, i) => ({
      ...s,
      start_frame: i < 36 ? s.start_frame : s.start_frame + 30,
      end_frame_exclusive: i < 35 ? s.end_frame_exclusive : s.end_frame_exclusive + 30,
    }));
    const crossing = { ...input, total_frames: input.total_frames + 30, segments };
    expect(openingVideoBudget(crossing, 7)).toMatchObject({
      mandatoryFrames: 5430,
      crossingFrames: 30,
      optionalFrames: 854,
    });
    const selections = planHostedVideoSelections(crossing, {
      coveragePercent: 0,
      replacementPolicy: "OPENING_180_V3",
    });
    expect(selections).toHaveLength(36);
    expect(selections.at(-1)?.videoFrameCount).toBe(180);
  });
  it("rejects avatar, split and oversized opening scenes instead of silently skipping them", () => {
    for (const composition of ["AVATAR_FULL", "AVATAR_SPLIT_IMAGE"]) {
      const base = timeline(120);
      const input = { ...base, segments: [...base.segments] };
      (input.segments as TimelinePlanDocument["segments"][number][])[0] = {
        ...input.segments[0],
        timeline_composition: composition,
      } as TimelinePlanDocument["segments"][number];
      expect(() =>
        planHostedVideoSelections(input, {
          coveragePercent: 0,
          replacementPolicy: "OPENING_180_V3",
        }),
      ).toThrow("HOSTED_VIDEO_OPENING_TIMELINE_INVALID");
    }
    const input = openingTimeline(120);
    (input.segments as TimelinePlanDocument["segments"][number][])[0] = {
      ...input.segments[0]!,
      end_frame_exclusive: 358,
    };
    expect(() =>
      planHostedVideoSelections(input, { coveragePercent: 7, replacementPolicy: "OPENING_180_V3" }),
    ).toThrow("HOSTED_VIDEO_OPENING_TIMELINE_INVALID");
  });
});

describe("configurable opening coverage", () => {
  it.each([6, 30, 60, 180, 3600])(
    "uses pinned %s seconds and the unchanged remaining spread algorithm",
    (seconds) => {
      const input = timeline(720);
      const openingFrames = seconds * 30;
      const on = {
        ...input,
        segments: input.segments.map((s) =>
          s.start_frame < openingFrames ? { ...s, timeline_composition: "IMAGE_FULL" as const } : s,
        ),
      } as unknown as TimelinePlanDocument;
      const selections = planHostedVideoSelections(on, {
        replacementPolicy: "OPENING_CONFIG_V4",
        openingSeconds: seconds,
        coveragePercent: 23,
      });
      const opening = selections.filter(
        (s) => Number(s.segmentId.split("-")[1]) * 150 < openingFrames,
      );
      const budget = openingVideoBudget(on, 23, seconds);
      expect(opening.reduce((sum, s) => sum + s.videoFrameCount, 0)).toBe(budget.mandatoryFrames);
      const optional = planHostedVideoSelections(
        {
          total_frames: budget.optionalFrames,
          segments: on.segments.filter((s) => s.start_frame >= openingFrames),
        },
        { coveragePercent: 100, replacementPolicy: "WHOLE_SCENE_V2" },
      );
      expect(selections).toEqual([...opening, ...optional]);
      const off = planHostedVideoSelections(input, {
        coveragePercent: 23,
        replacementPolicy: "WHOLE_SCENE_V2",
      });
      expect(off.reduce((sum, s) => sum + s.videoFrameCount, 0)).toBeLessThanOrEqual(
        Math.floor((input.total_frames * 23) / 100),
      );
    },
  );
  it("retains exact fixed180 selection identity while the configurable duration changes", () => {
    const base = timeline(120);
    const input = { ...base, segments: [...base.segments] };
    const allImages = {
      ...input,
      segments: input.segments.map((s) => ({ ...s, timeline_composition: "IMAGE_FULL" as const })),
    } as unknown as TimelinePlanDocument;
    const historic = planHostedVideoSelections(allImages, {
      coveragePercent: 7,
      replacementPolicy: "OPENING_180_V3",
    });
    expect(
      planHostedVideoSelections(allImages, {
        coveragePercent: 7,
        replacementPolicy: "OPENING_CONFIG_V4",
        openingSeconds: 180,
      }),
    ).toEqual(historic);
    expect(
      planHostedVideoSelections(allImages, {
        coveragePercent: 7,
        replacementPolicy: "OPENING_180_V3",
        openingSeconds: 60,
      }),
    ).toEqual(historic);
    expect(
      planHostedVideoSelections(allImages, {
        coveragePercent: 7,
        replacementPolicy: "OPENING_CONFIG_V4",
        openingSeconds: 60,
      }),
    ).not.toEqual(historic);
  });
  it.each([undefined, 0, 5, 7, 3606, 1.2, NaN])(
    "fails closed on invalid threshold %s",
    (seconds) => {
      expect(() =>
        planHostedVideoSelections(timeline(120), {
          coveragePercent: 0,
          replacementPolicy: "OPENING_CONFIG_V4",
          openingSeconds: seconds,
        }),
      ).toThrow("HOSTED_VIDEO_POLICY_INVALID");
    },
  );
});

describe("independent avatar composition and opening footage", () => {
  it("replaces opening split photos without selecting full-avatar scenes; Off uses the original coverage plan", () => {
    const base = timeline(120);
    const input = { ...base, segments: [...base.segments] };
    input.segments[1] = {
      ...input.segments[1]!,
      timeline_composition: "AVATAR_SPLIT_IMAGE",
      required_slots: {
        right_image: { task_key: "right:scene-1" },
        avatar: { task_key: "avatar:scene-1" },
      },
    } as unknown as TimelinePlanDocument["segments"][number];
    const before = structuredClone(input);
    const policy = {
      coveragePercent: 7,
      replacementPolicy: "FOOTAGE_COMPOSITION_V5" as const,
      openingSeconds: 180,
    };
    const chosen = planHostedVideoSelections(input, policy);
    expect(chosen.find((s) => s.segmentId === "scene-1")?.sourceTaskKey).toBe("right:scene-1");
    expect(chosen.some((s) => s.segmentId === "scene-0")).toBe(false);
    for (const segment of input.segments.filter(
      (s) => s.start_frame < 5400 && s.timeline_composition !== "AVATAR_FULL",
    ))
      expect(chosen.find((s) => s.segmentId === segment.segment_id)?.videoFrameCount).toBe(
        segment.end_frame_exclusive - segment.start_frame,
      );
    expect(input).toEqual(before);
    expect(planHostedVideoSelections(input, { ...policy, openingSeconds: 0 })).toEqual(
      planHostedVideoSelections(input, { coveragePercent: 7, replacementPolicy: "WHOLE_SCENE_V2" }),
    );
    const budget = openingVideoBudget(input, 7, 180, true);
    expect(budget.mandatoryFrames).toBe(3600);
    expect(budget.remainingFrames).toBe(input.total_frames - 5400);
    expect(
      chosen
        .filter((s) => Number(s.segmentId.split("-")[1]) >= 36)
        .reduce((n, s) => n + s.videoFrameCount, 0),
    ).toBeLessThanOrEqual(budget.optionalFrames);
  });
});

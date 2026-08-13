import { describe, expect, it } from "vitest";

import { deriveTimelineInspectionView, formatTimelineTime } from "./timeline-inspection";
import type { TimelineInspection, TimelineInspectionState } from "./types";

function inspection(state: TimelineInspectionState = "CURRENT"): TimelineInspection {
  const current = state === "CURRENT";
  return {
    schemaVersion: "videoforge.timeline-inspection/v1",
    projectId: "project_fixture_001",
    revisionId: "revision_fixture_001",
    sourceMode: "FIXTURE",
    ready: true,
    invalidation: {
      state,
      recomputeRequired: !current && state !== "WAITING",
      reason: current ? null : `${state.toLowerCase()} timing`,
    },
    blockers: current ? [] : [`${state.toLowerCase()} timing`],
    documents: {
      transcriptSha256: `sha256:${"a".repeat(64)}`,
      timelineSha256: `sha256:${"b".repeat(64)}`,
    },
    timing: {
      sourceDurationMs: 40_000,
      timedWordCount: 6,
      phraseCount: 1,
      phraseStartMs: 400,
      phraseEndMs: 39_500,
      coverage: "COMPLETE",
    },
    plan: {
      fps: 30,
      totalFrames: 1_200,
      segmentCount: 1,
      sourceStartMs: 0,
      sourceEndMs: 40_000,
      coverage: "COMPLETE",
      compositionCounts: { avatarFull: 0, imageFull: 1, avatarSplitImage: 0 },
      avatarFullPercent: 0,
      avatarSplitPercent: 0,
    },
    workPlan: {
      generationManifestSha256: `sha256:${"c".repeat(64)}`,
      renderManifestSha256: `sha256:${"d".repeat(64)}`,
      promptBatchCount: 1,
      imageSlotCount: 1,
      avatarTaskCount: 0,
      renderSegmentCount: 1,
      shotRoleCount: 1,
      hardCutsOnly: true,
      slowImageZoomRequired: true,
    },
    selectedAvatar: {
      count: 0,
      materializedCount: 0,
      durationMs: 0,
      coveragePercent: 0,
      spans: [],
    },
    phrases: [
      {
        id: "phrase_001",
        startMs: 400,
        endMs: 39_500,
        text: "Exact phrase timing.",
        segmentId: "segment_001",
        segmentIds: ["segment_001"],
        layout: "IMAGE_FULL",
        layouts: ["IMAGE_FULL"],
        startFrame: 0,
        endFrameExclusive: 1_200,
        shotRole: "OBJECT_EVIDENCE",
        shotRoles: ["OBJECT_EVIDENCE"],
      },
    ],
  };
}

describe("timeline inspection readiness", () => {
  it("accepts only a current, complete, blocker-free inspection", () => {
    expect(deriveTimelineInspectionView(inspection())).toEqual({
      ready: true,
      statusLabel: "Ready",
      statusDetail: "Timing and layout coverage match this revision.",
    });
  });

  it.each(["WAITING", "STALE", "INCOMPLETE", "MISMATCHED", "UNCOVERED"] as const)(
    "never presents %s timing as ready",
    (state) => {
      const view = deriveTimelineInspectionView(inspection(state));
      expect(view.ready).toBe(false);
      expect(view.statusLabel).toBe("Not ready");
      expect(view.statusDetail).toContain(state.toLowerCase());
    },
  );

  it("fails closed when the response claims ready but omits exact coverage", () => {
    const incomplete = inspection();
    incomplete.plan = null;
    expect(deriveTimelineInspectionView(incomplete).ready).toBe(false);
  });

  it("formats stable minute and second labels", () => {
    expect(formatTimelineTime(0)).toBe("00:00");
    expect(formatTimelineTime(40_999)).toBe("00:40");
    expect(formatTimelineTime(61_000)).toBe("01:01");
  });
});

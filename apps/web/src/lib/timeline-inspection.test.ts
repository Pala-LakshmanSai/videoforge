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
    },
    selectedAvatar: { count: 0, durationMs: 0, coveragePercent: 0, spans: [] },
    phrases: [
      {
        id: "phrase_001",
        startMs: 400,
        endMs: 39_500,
        text: "Exact phrase timing.",
        segmentId: "segment_001",
        layout: "IMAGE_FULL",
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

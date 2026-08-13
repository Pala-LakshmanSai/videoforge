import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TimelineInspection } from "../../lib/types";
import { TimelineInspectionPanel } from "./TimelineInspectionPanel";

const readyInspection: TimelineInspection = {
  schemaVersion: "videoforge.timeline-inspection/v1",
  projectId: "project_fixture_001",
  revisionId: "revision_fixture_001",
  sourceMode: "FIXTURE",
  ready: true,
  invalidation: { state: "CURRENT", recomputeRequired: false, reason: null },
  blockers: [],
  documents: {
    transcriptSha256: `sha256:${"a".repeat(64)}`,
    timelineSha256: `sha256:${"b".repeat(64)}`,
  },
  timing: {
    sourceDurationMs: 40_000,
    timedWordCount: 73,
    phraseCount: 1,
    phraseStartMs: 240,
    phraseEndMs: 39_500,
    coverage: "COMPLETE",
  },
  plan: {
    fps: 30,
    totalFrames: 1_200,
    segmentCount: 2,
    sourceStartMs: 0,
    sourceEndMs: 40_000,
    coverage: "COMPLETE",
    compositionCounts: { avatarFull: 1, imageFull: 1, avatarSplitImage: 0 },
    avatarFullPercent: 11.25,
    avatarSplitPercent: 0,
  },
  workPlan: {
    generationManifestSha256: `sha256:${"d".repeat(64)}`,
    renderManifestSha256: `sha256:${"e".repeat(64)}`,
    promptBatchCount: 1,
    imageSlotCount: 1,
    avatarTaskCount: 1,
    renderSegmentCount: 2,
    shotRoleCount: 1,
    hardCutsOnly: true,
    slowImageZoomRequired: true,
  },
  selectedAvatar: {
    count: 1,
    materializedCount: 1,
    durationMs: 4_500,
    coveragePercent: 11.25,
    spans: [
      {
        id: "segment_001",
        startMs: 0,
        endMs: 4_500,
        layout: "AVATAR_FULL",
        phrase: "Start with the field spot.",
        artifactId: "asset_span_audio_001",
        audioSha256: `sha256:${"c".repeat(64)}`,
        paddedStartMs: 0,
        paddedEndMs: 5_000,
        trimStartMs: 0,
        trimEndMs: 4_500,
      },
    ],
  },
  phrases: [
    {
      id: "phrase_001",
      startMs: 240,
      endMs: 4_300,
      text: "Start with the field spot.",
      segmentId: "segment_001",
      segmentIds: ["segment_001"],
      layout: "AVATAR_FULL",
      layouts: ["AVATAR_FULL"],
      startFrame: 0,
      endFrameExclusive: 135,
      shotRole: null,
      shotRoles: [],
    },
  ],
};

afterEach(cleanup);

describe("TimelineInspectionPanel", () => {
  it("shows exact coverage, avatar spans, and on-demand transcript identity", () => {
    render(
      <TimelineInspectionPanel
        inspection={readyInspection}
        loading={false}
        failed={false}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText("Current revision is fully covered")).toBeVisible();
    expect(screen.getByText("1/1")).toBeVisible();
    expect(screen.getByText("1200 frames · 30 fps")).toBeVisible();
    expect(screen.getAllByText("Start with the field spot.")).toHaveLength(2);
    fireEvent.click(screen.getByText("Transcript phrases"));
    expect(screen.getByText(`sha256:${"a".repeat(64)}`)).toBeVisible();
    expect(screen.getAllByText("Avatar full")).toHaveLength(2);
  });

  it("renders a blocker and never repeats a false ready claim", () => {
    const incomplete: TimelineInspection = {
      ...readyInspection,
      ready: true,
      invalidation: {
        state: "UNCOVERED",
        recomputeRequired: true,
        reason: "The final phrase has no layout assignment.",
      },
      blockers: ["The final phrase has no layout assignment."],
      timing: null,
      plan: null,
      selectedAvatar: null,
      phrases: [],
    };
    render(
      <TimelineInspectionPanel
        inspection={incomplete}
        loading={false}
        failed={false}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText("Not ready")).toBeVisible();
    expect(screen.getByText("Recompute is required")).toBeVisible();
    expect(screen.getAllByText("The final phrase has no layout assignment.")).not.toHaveLength(0);
    expect(screen.queryByText("Current revision is fully covered")).not.toBeInTheDocument();
  });

  it("keeps transport failures fail-closed and exposes retry", () => {
    const retry = vi.fn();
    render(
      <TimelineInspectionPanel inspection={undefined} loading={false} failed onRetry={retry} />,
    );
    expect(screen.getByText("No ready state is inferred from project progress.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledOnce();
  });
});

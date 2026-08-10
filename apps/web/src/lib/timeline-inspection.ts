import type { TimelineInspection, TimelineInspectionState } from "./types";

const NON_READY_STATES: ReadonlySet<TimelineInspectionState> = new Set([
  "WAITING",
  "STALE",
  "INCOMPLETE",
  "MISMATCHED",
  "UNCOVERED",
]);

export interface TimelineInspectionView {
  readonly ready: boolean;
  readonly statusLabel: "Ready" | "Not ready";
  readonly statusDetail: string;
}

/**
 * The client repeats the readiness invariant instead of trusting display copy from the API. A
 * stale, incomplete, mismatched, or uncovered response can never be presented as ready.
 */
export function deriveTimelineInspectionView(
  inspection: TimelineInspection,
): TimelineInspectionView {
  const structurallyComplete =
    inspection.timing?.coverage === "COMPLETE" &&
    inspection.plan?.coverage === "COMPLETE" &&
    inspection.selectedAvatar !== null &&
    inspection.selectedAvatar.count === inspection.selectedAvatar.spans.length &&
    inspection.selectedAvatar.materializedCount === inspection.selectedAvatar.count &&
    inspection.selectedAvatar.spans.every((span) =>
      /^sha256:[a-f0-9]{64}$/u.test(span.audioSha256),
    ) &&
    inspection.phrases.length === inspection.timing.phraseCount &&
    inspection.blockers.length === 0;
  const ready =
    inspection.ready &&
    inspection.invalidation.state === "CURRENT" &&
    !inspection.invalidation.recomputeRequired &&
    !NON_READY_STATES.has(inspection.invalidation.state) &&
    structurallyComplete;

  return Object.freeze({
    ready,
    statusLabel: ready ? "Ready" : "Not ready",
    statusDetail: ready
      ? "Timing and layout coverage match this revision."
      : (inspection.blockers[0] ??
        inspection.invalidation.reason ??
        "Timing inspection is incomplete for this revision."),
  });
}

export function formatTimelineTime(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

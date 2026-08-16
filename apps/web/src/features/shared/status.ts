import type { AvatarProfile, Tone } from "../../lib/types";

export function statusTone(status: string): Tone {
  if (["COMPLETE", "APPROVED", "PASSED", "PUBLISHED", "READY"].includes(status)) return "success";
  if (["FAILED", "INVALID"].includes(status)) return "danger";
  if (
    [
      "BLOCKED",
      "NEEDS_ATTENTION",
      "CANCELLED",
      "CANCEL_REQUESTED",
      "STALE",
      "NEEDS_REVIEW",
    ].includes(status)
  )
    return "warning";
  if (
    ["RUNNING", "STARTING", "RECONCILING", "ANALYZING", "VALIDATING", "READY_FOR_REVIEW"].includes(
      status,
    )
  )
    return "info";
  return "neutral";
}

export function avatarCompatibilityLabel(status: AvatarProfile["compatibility"]): string {
  switch (status) {
    case "UNTESTED":
      return "Not tested";
    case "RUNNING":
      return "Testing";
    case "PASSED":
      return "Passed";
    case "FAILED":
      return "Test failed";
    case "STALE":
      return "Retest recommended";
    case "CANCELLED":
      return "Test cancelled";
  }
}

export function humanize(value: string): string {
  const normalized = value.replaceAll("_", " ").toLowerCase();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

/**
 * Factual private labels for the V2-05 per-video runtime stages.
 *
 * Each label states only what the control plane durably observed. Nothing here implies a running
 * worker, an allocated GPU, or provider progress that has not been recorded.
 */
const VIDEO_STAGE_LABELS: Readonly<Record<string, string>> = {
  QUEUED: "Queued",
  PREPARING: "Preparing",
  WAITING_FOR_WORKER: "Waiting for worker",
  INITIALIZING: "Initializing",
  GENERATING_IMAGES: "Generating images",
  GENERATING_AVATAR: "Generating avatar",
  RENDERING: "Rendering",
  COMPLETE: "Complete",
  FAILED: "Failed",
  CANCELED: "Canceled",
};

export function videoStageLabel(stage: string): string {
  return VIDEO_STAGE_LABELS[stage] ?? stage.replaceAll("_", " ").toLowerCase();
}

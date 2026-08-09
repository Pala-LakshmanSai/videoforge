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

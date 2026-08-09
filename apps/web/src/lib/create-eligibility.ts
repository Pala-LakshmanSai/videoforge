export type CreateBlockerTarget =
  | "project-title"
  | "voiceover-input"
  | "avatar-profile-select"
  | "image-style-select"
  | "compute-profiles"
  | "image-keywords"
  | "spend-cap";

export interface CreateBlocker {
  code: string;
  message: string;
  target?: CreateBlockerTarget;
}

export interface CreateEligibilityInput {
  audioError: string | null;
  audioPending: boolean;
  avatarReady: boolean;
  bootstrapState: "error" | "pending" | "ready";
  computeState: "error" | "pending" | "ready";
  contractValid: boolean;
  draftHydrated: boolean;
  estimatedCostUsd: number;
  keywordConflictLabels: string[];
  keywordEnabled: boolean;
  keywordText: string;
  primaryProfilesReady: boolean;
  spendCapUsd: number;
  stylePublished: boolean;
  title: string;
  voiceoverAssetId: string | null;
}

export function createProjectBlockers(input: CreateEligibilityInput): CreateBlocker[] {
  const blockers: CreateBlocker[] = [];
  const push = (code: string, message: string, target?: CreateBlockerTarget) =>
    blockers.push({ code, message, target });

  if (!input.draftHydrated) push("DRAFT_LOADING", "Loading your saved project draft.");
  if (input.bootstrapState === "pending") {
    push("PRESETS_LOADING", "Loading Avatar and Image Style presets.");
  } else if (input.bootstrapState === "error") {
    push("PRESETS_UNAVAILABLE", "Avatar and Image Style presets are unavailable.");
  }
  if (input.computeState === "pending") {
    push("COMPUTE_LOADING", "Loading image and avatar compute profiles.");
  } else if (input.computeState === "error") {
    push("COMPUTE_UNAVAILABLE", "Image and avatar compute profiles are unavailable.");
  }

  if (!input.title.trim()) push("TITLE_REQUIRED", "Add a video title.", "project-title");
  if (input.audioPending) {
    push("VOICEOVER_VALIDATING", "Wait for voiceover validation to finish.", "voiceover-input");
  } else if (input.audioError) {
    push("VOICEOVER_INVALID", input.audioError, "voiceover-input");
  } else if (!input.voiceoverAssetId) {
    push("VOICEOVER_REQUIRED", "Choose a valid final voiceover.", "voiceover-input");
  }
  if (!input.avatarReady) {
    push("AVATAR_REQUIRED", "Choose a ready Avatar Profile.", "avatar-profile-select");
  }
  if (!input.stylePublished) {
    push("STYLE_REQUIRED", "Choose a published Image Style.", "image-style-select");
  }
  if (input.computeState === "ready" && !input.primaryProfilesReady) {
    push(
      "COMPUTE_PROFILE_INVALID",
      "Choose eligible image and avatar compute profiles.",
      "compute-profiles",
    );
  }
  if (input.keywordEnabled && !input.keywordText.trim()) {
    push("KEYWORDS_REQUIRED", "Add image keywords or turn the option off.", "image-keywords");
  } else if (input.keywordEnabled && input.keywordConflictLabels.length) {
    push(
      "KEYWORDS_CONFLICT",
      `Remove requests for ${input.keywordConflictLabels.join(", ")}.`,
      "image-keywords",
    );
  }
  if (input.spendCapUsd < input.estimatedCostUsd) {
    push(
      "SPEND_CAP_TOO_LOW",
      `Raise the spend cap to at least $${input.estimatedCostUsd.toFixed(2)}.`,
      "spend-cap",
    );
  }
  if (!input.contractValid && blockers.length === 0) {
    push("REQUEST_INVALID", "Review the project inputs before generating.");
  }

  return blockers;
}

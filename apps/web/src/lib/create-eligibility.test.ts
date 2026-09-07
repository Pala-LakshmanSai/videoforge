import { describe, expect, it } from "vitest";

import { createProjectBlockers, type CreateEligibilityInput } from "./create-eligibility";

const readyInput: CreateEligibilityInput = {
  audioError: null,
  audioPending: false,
  avatarReady: true,
  bootstrapState: "ready",
  computeState: "ready",
  contractValid: true,
  draftHydrated: true,
  keywordConflictLabels: [],
  keywordEnabled: false,
  keywordText: "",
  primaryProfilesReady: true,
  stylePublished: true,
  title: "A valid project",
  voiceoverAssetId: "voiceover_fixture",
};

describe("createProjectBlockers", () => {
  it("returns no blocker for an eligible project", () => {
    expect(createProjectBlockers(readyInput)).toEqual([]);
  });

  it("returns exact field-specific blockers in workflow order", () => {
    expect(
      createProjectBlockers({
        ...readyInput,
        title: " ",
        voiceoverAssetId: null,
        avatarReady: false,
        stylePublished: false,
        primaryProfilesReady: false,
        keywordEnabled: true,
        keywordText: "add a logo",
        keywordConflictLabels: ["logos"],
      }),
    ).toEqual([
      { code: "TITLE_REQUIRED", message: "Add a video title.", target: "project-title" },
      {
        code: "VOICEOVER_REQUIRED",
        message: "Choose a valid final voiceover.",
        target: "voiceover-input",
      },
      {
        code: "AVATAR_REQUIRED",
        message: "Choose a ready Avatar Profile.",
        target: "avatar-profile-select",
      },
      {
        code: "STYLE_REQUIRED",
        message: "Choose a published Image Style.",
        target: "image-style-select",
      },
      {
        code: "COMPUTE_PROFILE_INVALID",
        message: "Choose eligible image and avatar compute profiles.",
        target: "compute-profiles",
      },
      {
        code: "KEYWORDS_CONFLICT",
        message: "Remove requests for logos.",
        target: "image-keywords",
      },
    ]);
  });

  it("preserves the actual audio validation error", () => {
    expect(
      createProjectBlockers({
        ...readyInput,
        audioError: "The voiceover could not be decoded. Choose a complete audio file.",
        voiceoverAssetId: null,
      })[0],
    ).toMatchObject({
      code: "VOICEOVER_INVALID",
      message: "The voiceover could not be decoded. Choose a complete audio file.",
    });
  });
});

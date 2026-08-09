import { beforeEach, describe, expect, it } from "vitest";
import { emptyDraft, loadDraft, projectDraftSchema, saveDraft, updateDraft } from "./draft";

describe("fixture project draft", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to a pinned documentary style and disabled extra keywords", () => {
    const draft = loadDraft();
    expect(draft.imageStyleVersionId).toBe("style_version_documentary_stock_v1");
    expect(draft.applyExtraPromptKeywords).toBe(false);
    expect(draft.spendCapUsd).toBe(1.5);
  });

  it("persists every project choice used in a preset-hub round trip", () => {
    const saved = {
      ...emptyDraft,
      title: "A preserved production draft",
      voiceoverAssetId: "asset_voiceover_fixture",
      voiceoverName: "voiceover.wav",
      optionalScript: "Exact supplied narration.",
      generationMode: "FASTER" as const,
      applyExtraPromptKeywords: true,
    };
    saveDraft(saved);
    updateDraft({ avatarProfileVersionId: "avatar_version_new_v1" });
    expect(loadDraft()).toEqual({ ...saved, avatarProfileVersionId: "avatar_version_new_v1" });
  });

  it("rejects the MVP cap above two dollars", () => {
    expect(projectDraftSchema.safeParse({ ...emptyDraft, spendCapUsd: 2.01 }).success).toBe(false);
  });
});

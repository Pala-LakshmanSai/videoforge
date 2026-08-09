import { beforeEach, describe, expect, it } from "vitest";
import {
  emptyDraft,
  loadDraft,
  projectDraftSchema,
  projectDraftStorageKey,
  projectDraftStorageKeyFor,
  saveDraft,
  updateDraft,
} from "./draft";

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
      voiceoverDurationSeconds: 94.4,
      voiceoverSampleRate: 48_000,
      voiceoverChannels: 1,
      voiceoverChecksum: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      generationMode: "FASTER" as const,
      executionProfileOverrides: {
        image_media_profile_id: "image-media-balanced-v1",
        avatar_primary_profile_id: "avatar-primary-balanced-v1",
      },
      applyExtraPromptKeywords: true,
    };
    saveDraft(saved);
    updateDraft({ avatarProfileVersionId: "avatar_version_new_v1" });
    expect(loadDraft()).toEqual({ ...saved, avatarProfileVersionId: "avatar_version_new_v1" });
  });

  it("isolates scenario drafts so stable fixture states do not overwrite each other", () => {
    saveDraft({ ...emptyDraft, title: "Budget fixture draft", spendCapUsd: 0.5 }, "budget_blocked");
    saveDraft(
      { ...emptyDraft, title: "Keyword fixture draft", applyExtraPromptKeywords: true },
      "extra_keywords_conflict",
    );

    expect(loadDraft("budget_blocked")).toMatchObject({
      title: "Budget fixture draft",
      spendCapUsd: 0.5,
      applyExtraPromptKeywords: false,
    });
    expect(loadDraft("extra_keywords_conflict")).toMatchObject({
      title: "Keyword fixture draft",
      spendCapUsd: 1.5,
      applyExtraPromptKeywords: true,
    });
    expect(localStorage.getItem(projectDraftStorageKeyFor("budget_blocked"))).not.toBeNull();
  });

  it("migrates the old global fixture draft only into the ordinary Create scenario", () => {
    localStorage.setItem(
      "videoforge:fixture:project-draft:v1",
      JSON.stringify({ ...emptyDraft, title: "Legacy ordinary project" }),
    );

    expect(loadDraft("extra_keywords_conflict")).toEqual(emptyDraft);
    expect(loadDraft("project_create_ready").title).toBe("Legacy ordinary project");
    expect(localStorage.getItem("videoforge:fixture:project-draft:v1")).toBeNull();
  });

  it("migrates an older stored draft by adding new verified-media fields", () => {
    localStorage.setItem(
      projectDraftStorageKey,
      JSON.stringify({
        ...emptyDraft,
        title: "Legacy fixture draft",
        voiceoverAssetId: "asset_voiceover_fixture",
        voiceoverName: "voiceover.wav",
        voiceoverDurationSeconds: undefined,
        voiceoverSampleRate: undefined,
        voiceoverChannels: undefined,
        voiceoverChecksum: undefined,
        executionProfileOverrides: undefined,
      }),
    );

    expect(loadDraft()).toEqual({
      ...emptyDraft,
      title: "Legacy fixture draft",
      voiceoverAssetId: "asset_voiceover_fixture",
      voiceoverName: "voiceover.wav",
    });
  });

  it("falls back safely when persisted verified-media metadata is invalid", () => {
    localStorage.setItem(
      projectDraftStorageKey,
      JSON.stringify({
        ...emptyDraft,
        title: "Invalid fixture draft",
        voiceoverAssetId: "asset_voiceover_fixture",
        voiceoverName: "voiceover.wav",
        voiceoverDurationSeconds: 4,
        voiceoverSampleRate: 48_000,
        voiceoverChannels: 1,
        voiceoverChecksum: "sha256:not-a-checksum",
      }),
    );

    expect(loadDraft()).toEqual(emptyDraft);
  });

  it("rejects the MVP cap above two dollars", () => {
    expect(projectDraftSchema.safeParse({ ...emptyDraft, spendCapUsd: 2.01 }).success).toBe(false);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import {
  emptyDraft,
  hydrateDraftFromBootstrap,
  loadDraft,
  projectDraftSchema,
  projectDraftStorageKey,
  projectDraftStorageKeyFor,
  saveDraft,
  updateDraft,
} from "./draft";
import type { FixtureDraftState } from "./types";

const localServerDraft: FixtureDraftState = {
  title: "Owned local walking slice",
  voiceover: {
    assetId: "voiceover_local_owned_001",
    filename: "owned-local-narration.wav",
    durationSeconds: 37.2,
    uploadState: "VERIFIED",
  },
  avatarProfileVersionId: "avatar_local_owned_v1",
  imageStyleVersionId: "style_local_owned_v1",
  optionalScript: null,
  extraPromptKeywords: null,
  applyExtraPromptKeywords: false,
  effectiveExtraPromptKeywords: null,
  generationMode: "BALANCED",
  preservedAcrossPresetRoundtrip: false,
  returnRoute: null,
  preflight: { status: "READY", checks: [] },
};

describe("fixture project draft", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to a pinned documentary style and disabled extra keywords", () => {
    const draft = loadDraft();
    expect(draft.imageStyleVersionId).toBe("style_version_documentary_stock_v1");
    expect(draft.applyExtraPromptKeywords).toBe(false);
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
    saveDraft({ ...emptyDraft, title: "Ordinary fixture draft" }, "project_create_ready");
    saveDraft(
      { ...emptyDraft, title: "Keyword fixture draft", applyExtraPromptKeywords: true },
      "extra_keywords_conflict",
    );

    expect(loadDraft("project_create_ready")).toMatchObject({
      title: "Ordinary fixture draft",
      applyExtraPromptKeywords: false,
    });
    expect(loadDraft("extra_keywords_conflict")).toMatchObject({
      title: "Keyword fixture draft",
      applyExtraPromptKeywords: true,
    });
    expect(localStorage.getItem(projectDraftStorageKeyFor("project_create_ready"))).not.toBeNull();
  });

  it("isolates local drafts from fixture drafts on the stable origin", () => {
    saveDraft({ ...emptyDraft, title: "Fixture draft" }, "project_create_ready");
    saveDraft({ ...emptyDraft, title: "Local draft" }, "project_create_ready", "local");

    expect(loadDraft("project_create_ready", "fixture").title).toBe("Fixture draft");
    expect(loadDraft("project_create_ready", "local")).toMatchObject({ title: "Local draft" });
  });

  it("rebinds stale local server-owned inputs while preserving only safe edits", () => {
    const hydrated = hydrateDraftFromBootstrap(
      {
        ...emptyDraft,
        title: "My local title",
        voiceoverAssetId: "stale-fixture-voiceover",
        avatarProfileVersionId: "stale-fixture-avatar",
        imageStyleVersionId: "stale-fixture-style",
        generationMode: "FASTER",
        executionProfileOverrides: {
          image_media_profile_id: "stale-image-profile",
          avatar_primary_profile_id: "stale-avatar-profile",
        },
        userSeed: 42,
      },
      localServerDraft,
      "local",
      true,
    );

    expect(hydrated).toMatchObject({
      title: "My local title",
      voiceoverAssetId: "voiceover_local_owned_001",
      avatarProfileVersionId: "avatar_local_owned_v1",
      imageStyleVersionId: "style_local_owned_v1",
      generationMode: "FASTER",
      executionProfileOverrides: null,
      userSeed: 42,
    });
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

  it("migrates v2 drafts only into the fixture namespace", () => {
    localStorage.setItem(
      "videoforge:fixture:project-draft:v2:project_create_ready",
      JSON.stringify({ ...emptyDraft, title: "Version two fixture draft" }),
    );

    expect(loadDraft("project_create_ready", "local")).toEqual(emptyDraft);
    expect(loadDraft("project_create_ready", "fixture").title).toBe("Version two fixture draft");
    expect(
      localStorage.getItem("videoforge:fixture:project-draft:v2:project_create_ready"),
    ).toBeNull();
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
});

import { z } from "zod";
import type { FixtureDraftState } from "./types";

export const projectDraftSchema = z.object({
  title: z.string().max(240),
  voiceoverAssetId: z.string().nullable(),
  voiceoverName: z.string().nullable(),
  voiceoverDurationSeconds: z.number().min(10).max(3_600).nullable(),
  voiceoverSampleRate: z.number().int().min(8_000).max(192_000).nullable(),
  voiceoverChannels: z.number().int().min(1).max(2).nullable(),
  voiceoverChecksum: z
    .string()
    .regex(/^sha256:[a-f0-9]{64}$/u)
    .nullable(),
  avatarProfileVersionId: z.string(),
  imageStyleVersionId: z.string(),
  extraPromptKeywords: z.string().max(500),
  applyExtraPromptKeywords: z.boolean(),
  generationMode: z.enum(["LOWEST_COST", "BALANCED", "FASTER"]),
  executionProfileOverrides: z
    .object({
      image_media_profile_id: z.string().min(1).max(160).optional(),
      avatar_primary_profile_id: z.string().min(1).max(160).optional(),
      avatar_quality_profile_id: z.string().min(1).max(160).optional(),
    })
    .nullable(),
  spendCapUsd: z.number().min(0.1).max(2),
  userSeed: z.number().int().min(0).max(4_294_967_295),
});

export type ProjectDraft = z.infer<typeof projectDraftSchema>;
export type ProjectDraftProviderMode = "fixture" | "local";

const legacyProjectDraftStorageKey = "videoforge:fixture:project-draft:v1";
const legacyProjectDraftStoragePrefix = "videoforge:fixture:project-draft:v2";
const projectDraftStoragePrefix = "videoforge:project-draft:v3";

export function projectDraftStorageKeyFor(
  scope = "default",
  mode: ProjectDraftProviderMode = "fixture",
): string {
  return `${projectDraftStoragePrefix}:${mode}:${encodeURIComponent(scope.trim() || "default")}`;
}

export const projectDraftStorageKey = projectDraftStorageKeyFor();

export const emptyDraft: ProjectDraft = {
  title: "",
  voiceoverAssetId: null,
  voiceoverName: null,
  voiceoverDurationSeconds: null,
  voiceoverSampleRate: null,
  voiceoverChannels: null,
  voiceoverChecksum: null,
  avatarProfileVersionId: "avatar_profile_version_fixture_001",
  imageStyleVersionId: "style_version_documentary_stock_v1",
  extraPromptKeywords: "ultra realistic, no AI look",
  applyExtraPromptKeywords: false,
  generationMode: "BALANCED",
  executionProfileOverrides: null,
  spendCapUsd: 1.5,
  userSeed: 982341,
};

export function hydrateDraftFromBootstrap(
  current: ProjectDraft,
  serverDraft: FixtureDraftState,
  mode: ProjectDraftProviderMode,
  stored: boolean,
): ProjectDraft {
  if (stored && mode === "fixture") return current;
  const preserveLocalEdits = stored && mode === "local";

  return projectDraftSchema.parse({
    ...current,
    title:
      preserveLocalEdits && current.title.trim().length > 0 ? current.title : serverDraft.title,
    voiceoverAssetId:
      serverDraft.voiceover.uploadState === "VERIFIED" ? serverDraft.voiceover.assetId : null,
    voiceoverName:
      serverDraft.voiceover.uploadState === "VERIFIED" ? serverDraft.voiceover.filename : null,
    voiceoverDurationSeconds:
      serverDraft.voiceover.uploadState === "VERIFIED"
        ? serverDraft.voiceover.durationSeconds
        : null,
    voiceoverSampleRate: null,
    voiceoverChannels: null,
    voiceoverChecksum: null,
    avatarProfileVersionId: serverDraft.avatarProfileVersionId ?? "",
    imageStyleVersionId: serverDraft.imageStyleVersionId,
    extraPromptKeywords: preserveLocalEdits
      ? current.extraPromptKeywords
      : (serverDraft.extraPromptKeywords ?? ""),
    applyExtraPromptKeywords: preserveLocalEdits
      ? current.applyExtraPromptKeywords
      : serverDraft.applyExtraPromptKeywords,
    generationMode: preserveLocalEdits ? current.generationMode : serverDraft.generationMode,
    executionProfileOverrides: mode === "local" ? null : current.executionProfileOverrides,
    spendCapUsd: serverDraft.spendCapUsd,
  });
}

function legacyV2StorageKeyFor(scope: string): string {
  return `${legacyProjectDraftStoragePrefix}:${encodeURIComponent(scope.trim() || "default")}`;
}

function migrateLegacyDraft(scope: string, mode: ProjectDraftProviderMode): void {
  if (mode !== "fixture") return;
  const legacy = localStorage.getItem(legacyProjectDraftStorageKey);
  if (legacy !== null) {
    const v2Destination = legacyV2StorageKeyFor("project_create_ready");
    if (localStorage.getItem(v2Destination) === null) {
      localStorage.setItem(v2Destination, legacy);
    }
    localStorage.removeItem(legacyProjectDraftStorageKey);
  }

  const v2Key = legacyV2StorageKeyFor(scope);
  const v2Draft = localStorage.getItem(v2Key);
  if (v2Draft === null) return;
  const destination = projectDraftStorageKeyFor(scope, mode);
  if (localStorage.getItem(destination) === null) localStorage.setItem(destination, v2Draft);
  localStorage.removeItem(v2Key);
}

export function loadDraft(
  scope = "default",
  mode: ProjectDraftProviderMode = "fixture",
): ProjectDraft {
  try {
    migrateLegacyDraft(scope, mode);
    const stored: unknown = JSON.parse(
      localStorage.getItem(projectDraftStorageKeyFor(scope, mode)) ?? "null",
    );
    const parsed = projectDraftSchema.safeParse(
      typeof stored === "object" && stored !== null ? { ...emptyDraft, ...stored } : stored,
    );
    return parsed.success ? parsed.data : emptyDraft;
  } catch {
    return emptyDraft;
  }
}

export function saveDraft(
  draft: ProjectDraft,
  scope = "default",
  mode: ProjectDraftProviderMode = "fixture",
) {
  localStorage.setItem(
    projectDraftStorageKeyFor(scope, mode),
    JSON.stringify(projectDraftSchema.parse(draft)),
  );
}

export function hasStoredDraft(
  scope = "default",
  mode: ProjectDraftProviderMode = "fixture",
): boolean {
  migrateLegacyDraft(scope, mode);
  return localStorage.getItem(projectDraftStorageKeyFor(scope, mode)) !== null;
}

export function updateDraft(
  patch: Partial<ProjectDraft>,
  scope = "default",
  mode: ProjectDraftProviderMode = "fixture",
) {
  const draft = projectDraftSchema.parse({ ...loadDraft(scope, mode), ...patch });
  saveDraft(draft, scope, mode);
  return draft;
}

import { z } from "zod";

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
      avatar_repair_profile_id: z.string().min(1).max(160).optional(),
      avatar_quality_profile_id: z.string().min(1).max(160).optional(),
    })
    .nullable(),
  spendCapUsd: z.number().min(0.1).max(2),
  userSeed: z.number().int().min(0).max(4_294_967_295),
});

export type ProjectDraft = z.infer<typeof projectDraftSchema>;

export const projectDraftStorageKey = "videoforge:fixture:project-draft:v1";

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

export function loadDraft(): ProjectDraft {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(projectDraftStorageKey) ?? "null");
    const parsed = projectDraftSchema.safeParse(
      typeof stored === "object" && stored !== null ? { ...emptyDraft, ...stored } : stored,
    );
    return parsed.success ? parsed.data : emptyDraft;
  } catch {
    return emptyDraft;
  }
}

export function saveDraft(draft: ProjectDraft) {
  localStorage.setItem(projectDraftStorageKey, JSON.stringify(projectDraftSchema.parse(draft)));
}

export function hasStoredDraft(): boolean {
  return localStorage.getItem(projectDraftStorageKey) !== null;
}

export function updateDraft(patch: Partial<ProjectDraft>) {
  const draft = projectDraftSchema.parse({ ...loadDraft(), ...patch });
  saveDraft(draft);
  return draft;
}

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

const legacyProjectDraftStorageKey = "videoforge:fixture:project-draft:v1";
const projectDraftStoragePrefix = "videoforge:fixture:project-draft:v2";

export function projectDraftStorageKeyFor(scope = "default"): string {
  return `${projectDraftStoragePrefix}:${encodeURIComponent(scope.trim() || "default")}`;
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

function migrateLegacyDraft(): void {
  const legacy = localStorage.getItem(legacyProjectDraftStorageKey);
  if (legacy === null) return;
  const destination = projectDraftStorageKeyFor("project_create_ready");
  if (localStorage.getItem(destination) === null) localStorage.setItem(destination, legacy);
  localStorage.removeItem(legacyProjectDraftStorageKey);
}

export function loadDraft(scope = "default"): ProjectDraft {
  try {
    migrateLegacyDraft();
    const stored: unknown = JSON.parse(
      localStorage.getItem(projectDraftStorageKeyFor(scope)) ?? "null",
    );
    const parsed = projectDraftSchema.safeParse(
      typeof stored === "object" && stored !== null ? { ...emptyDraft, ...stored } : stored,
    );
    return parsed.success ? parsed.data : emptyDraft;
  } catch {
    return emptyDraft;
  }
}

export function saveDraft(draft: ProjectDraft, scope = "default") {
  localStorage.setItem(
    projectDraftStorageKeyFor(scope),
    JSON.stringify(projectDraftSchema.parse(draft)),
  );
}

export function hasStoredDraft(scope = "default"): boolean {
  migrateLegacyDraft();
  return localStorage.getItem(projectDraftStorageKeyFor(scope)) !== null;
}

export function updateDraft(patch: Partial<ProjectDraft>, scope = "default") {
  const draft = projectDraftSchema.parse({ ...loadDraft(scope), ...patch });
  saveDraft(draft, scope);
  return draft;
}

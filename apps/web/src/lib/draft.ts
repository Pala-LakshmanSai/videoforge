import { z } from "zod";

export const projectDraftSchema = z.object({
  title: z.string().max(240),
  voiceoverAssetId: z.string().nullable(),
  voiceoverName: z.string().nullable(),
  avatarProfileVersionId: z.string(),
  imageStyleVersionId: z.string(),
  optionalScript: z.string().max(100_000),
  extraPromptKeywords: z.string().max(500),
  applyExtraPromptKeywords: z.boolean(),
  generationMode: z.enum(["LOWEST_COST", "BALANCED", "FASTER"]),
  spendCapUsd: z.number().min(0.1).max(2),
  userSeed: z.number().int().min(0).max(4_294_967_295),
});

export type ProjectDraft = z.infer<typeof projectDraftSchema>;

const key = "videoforge:fixture:project-draft:v1";

export const emptyDraft: ProjectDraft = {
  title: "",
  voiceoverAssetId: null,
  voiceoverName: null,
  avatarProfileVersionId: "avatar_version_maya_v1",
  imageStyleVersionId: "style_version_documentary_stock_v1",
  optionalScript: "",
  extraPromptKeywords: "ultra realistic, no AI look",
  applyExtraPromptKeywords: false,
  generationMode: "BALANCED",
  spendCapUsd: 1.5,
  userSeed: 982341,
};

export function loadDraft(): ProjectDraft {
  try {
    const parsed = projectDraftSchema.safeParse(JSON.parse(localStorage.getItem(key) ?? "null"));
    return parsed.success ? parsed.data : emptyDraft;
  } catch {
    return emptyDraft;
  }
}

export function saveDraft(draft: ProjectDraft) {
  localStorage.setItem(key, JSON.stringify(projectDraftSchema.parse(draft)));
}

export function updateDraft(patch: Partial<ProjectDraft>) {
  const draft = projectDraftSchema.parse({ ...loadDraft(), ...patch });
  saveDraft(draft);
  return draft;
}

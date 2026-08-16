import { z } from "zod";

const identifierSchema = z.string().min(1).max(160);
const nonBlankTitleSchema = z.string().min(1).max(240).regex(/\S/);

export const generationModeSchema = z.enum(["LOWEST_COST", "BALANCED", "FASTER"]);
export type GenerationMode = z.infer<typeof generationModeSchema>;

export const executionProfileOverridesSchema = z
  .object({
    image_media_profile_id: identifierSchema.optional(),
    avatar_primary_profile_id: identifierSchema.optional(),
    avatar_quality_profile_id: identifierSchema.optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
    message: "At least one execution profile override is required.",
  });

export type ExecutionProfileOverrides = z.infer<typeof executionProfileOverridesSchema>;

export const createProjectRequestSchema = z
  .object({
    title: nonBlankTitleSchema,
    voiceover_asset_id: identifierSchema,
    avatar_profile_version_id: identifierSchema,
    image_style_version_id: identifierSchema,
    optional_script: z.string().max(100_000).nullable().optional(),
    extra_prompt_keywords: z.string().max(500).nullable(),
    apply_extra_prompt_keywords: z.boolean(),
    generation_mode: generationModeSchema,
    execution_profile_overrides: executionProfileOverridesSchema.nullable().optional(),
    spend_cap_usd: z.number().min(0.1).max(2),
    user_seed: z.number().int().min(0).max(4_294_967_295).nullable().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.apply_extra_prompt_keywords &&
      (value.extra_prompt_keywords === null || !/\S/.test(value.extra_prompt_keywords))
    ) {
      context.addIssue({
        code: "custom",
        path: ["extra_prompt_keywords"],
        message: "Applied extra prompt keywords must contain non-whitespace text.",
      });
    }
  });

export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;

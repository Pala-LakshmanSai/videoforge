import { z } from "zod";

import type { ImageStyleProfileDocument } from "./schemas.js";

const boundedString = (maximum: number) => z.string().max(maximum);
const boundedStrings = (maximumItems: number, maximumLength: number) =>
  z.array(boundedString(maximumLength)).max(maximumItems);

export const imageStyleProfileSchema: z.ZodType<ImageStyleProfileDocument> = z
  .object({
    schema_version: z.literal("image-style-profile/v1"),
    summary: z.string().min(1).max(600),
    visual_profile: z
      .object({
        medium_family: boundedString(100),
        realism: boundedString(600),
        subject_treatment: boundedString(600),
        camera_language: boundedString(600),
        image_framing: boundedString(600),
        shot_scale_preferences: boundedStrings(20, 160),
        lighting: boundedString(600),
        color: z
          .object({
            descriptors: boundedStrings(20, 120),
            approximate_hex: z.array(z.string().regex(/^#[0-9A-Fa-f]{6}$/u)).max(12),
          })
          .strict(),
        contrast_and_exposure: boundedString(600),
        depth_of_field: boundedString(600),
        texture_and_grain: boundedString(600),
        human_rendering: boundedString(600),
        environment_and_material_detail: boundedString(600),
        imperfection_profile: boundedStrings(20, 160),
        mood: boundedStrings(20, 120),
        continuity_rules: boundedStrings(30, 240),
        must_include: boundedStrings(30, 200),
        must_avoid: boundedStrings(40, 200),
        flexible_properties: boundedStrings(30, 200),
      })
      .strict(),
    prompt_profile: z
      .object({
        planner_guidance: boundedString(1_800),
        positive_suffix: boundedString(2_400),
        negative_suffix: boundedString(2_400),
        full_image_guidance: boundedString(800),
        split_image_guidance: boundedString(800),
      })
      .strict(),
    analysis: z
      .object({
        analysis_kind: z.enum(["MANUAL", "VISION_ANALYSIS", "MANUAL_EDIT"]),
        overall_confidence: z.number().min(0).max(1).nullable(),
        trait_evidence: z
          .array(
            z
              .object({
                trait: z.enum([
                  "medium",
                  "realism",
                  "subject_treatment",
                  "camera",
                  "image_framing",
                  "lighting",
                  "color",
                  "contrast_exposure",
                  "depth_of_field",
                  "texture_grain",
                  "human_rendering",
                  "materials_environment",
                  "mood",
                  "continuity",
                ]),
                support_status: z.enum(["SUPPORTED", "UNCERTAIN", "UNSUPPORTED"]),
                confidence: z.number().min(0).max(1),
                supporting_reference_aliases: boundedStrings(12, 120),
              })
              .strict(),
          )
          .max(24),
        uncertain_fields: boundedStrings(30, 200),
        outlier_reference_aliases: boundedStrings(12, 120),
        content_leakage_warnings: boundedStrings(30, 240),
      })
      .strict(),
  })
  .strict();

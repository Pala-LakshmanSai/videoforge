import { z } from "zod";

import { imageStyleProfileSchema } from "./image-style-profile.js";

export const IMAGE_STYLE_DRAFT_CREATE_VERSION = "image-style-draft-create/v1" as const;
export const IMAGE_STYLE_REFERENCE_BATCH_VERSION = "image-style-reference-batch/v1" as const;
export const IMAGE_STYLE_ANALYSIS_REQUEST_VERSION = "image-style-analysis-request/v1" as const;
export const IMAGE_STYLE_PUBLISH_REQUEST_VERSION = "image-style-publish-request/v1" as const;
export const IMAGE_STYLE_HUB_VERSION_RESPONSE_VERSION = "image-style-hub-version/v1" as const;

const identifierSchema = z.string().min(1).max(160);
const sha256Schema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const positiveIntegerSchema = z.number().int().positive().safe();
const base64Schema = z
  .string()
  .min(4)
  .max(28_000_000)
  .regex(/^[A-Za-z0-9+/]+={0,2}$/u);

export const imageStyleDraftCreateRequestSchema = z
  .object({
    schema_version: z.literal(IMAGE_STYLE_DRAFT_CREATE_VERSION),
    name: z.string().trim().min(1).max(120),
  })
  .strict();

const rasterSchema = z
  .object({
    media_type: z.enum(["image/jpeg", "image/png", "image/webp"]),
    checksum: sha256Schema,
    width: positiveIntegerSchema.max(16_384),
    height: positiveIntegerSchema.max(16_384),
    bytes_base64: base64Schema,
  })
  .strict();

export const imageStyleReferenceBatchRequestSchema = z
  .object({
    schema_version: z.literal(IMAGE_STYLE_REFERENCE_BATCH_VERSION),
    rights: z
      .object({
        reference_rights_attested: z.literal(true),
        processing_disclosure_acknowledged: z.literal(true),
        retention_choice: z.literal("NORMALIZED_SESSION_ONLY"),
      })
      .strict(),
    references: z
      .array(
        z
          .object({
            client_reference_id: identifierSchema,
            filename: z.string().trim().min(1).max(255),
            order_index: z.number().int().min(0).max(7),
            original: rasterSchema,
            normalized: rasterSchema.extend({
              media_type: z.literal("image/webp"),
              color_space: z.literal("srgb"),
              metadata_stripped: z.literal(true),
              orientation_applied: z.literal(true),
            }),
          })
          .strict(),
      )
      .min(3)
      .max(8),
  })
  .strict()
  .superRefine((value, context) => {
    const ids = new Set<string>();
    const orders = new Set<number>();
    for (const [index, reference] of value.references.entries()) {
      if (ids.has(reference.client_reference_id)) {
        context.addIssue({
          code: "custom",
          path: ["references", index, "client_reference_id"],
          message: "Reference IDs must be unique.",
        });
      }
      if (orders.has(reference.order_index)) {
        context.addIssue({
          code: "custom",
          path: ["references", index, "order_index"],
          message: "Reference order values must be unique.",
        });
      }
      ids.add(reference.client_reference_id);
      orders.add(reference.order_index);
    }
  });

export const imageStyleAnalysisRequestSchema = z
  .object({ schema_version: z.literal(IMAGE_STYLE_ANALYSIS_REQUEST_VERSION) })
  .strict();

export const imageStylePublishRequestSchema = z
  .object({ schema_version: z.literal(IMAGE_STYLE_PUBLISH_REQUEST_VERSION) })
  .strict();

export const imageStyleHubReferenceSchema = z
  .object({
    reference_id: identifierSchema,
    filename: z.string().min(1),
    order_index: z.number().int().min(0).max(7),
    original_checksum: sha256Schema,
    normalized_checksum: sha256Schema,
    width: positiveIntegerSchema,
    height: positiveIntegerSchema,
    preview_url: z.string().startsWith("/api/v1/image-styles/"),
  })
  .strict();

export const imageStyleHubVersionResponseSchema = z
  .object({
    schema_version: z.literal(IMAGE_STYLE_HUB_VERSION_RESPONSE_VERSION),
    style_id: identifierSchema,
    version_id: identifierSchema,
    name: z.string().min(1).max(120),
    state: z.enum(["DRAFT", "REFERENCES_READY", "NEEDS_REVIEW", "PUBLISHED", "ARCHIVED"]),
    revision: positiveIntegerSchema,
    version_tag: z.string().min(1),
    references: z.array(imageStyleHubReferenceSchema).max(8),
    profile: imageStyleProfileSchema.nullable(),
    profile_hash: sha256Schema.nullable(),
    original_bytes_persisted: z.literal(false),
    normalized_bytes_persisted: z.boolean(),
    provider_calls_authorized: z.literal(false),
  })
  .strict();

export type ImageStyleDraftCreateRequest = z.infer<typeof imageStyleDraftCreateRequestSchema>;
export type ImageStyleReferenceBatchRequest = z.infer<typeof imageStyleReferenceBatchRequestSchema>;
export type ImageStyleAnalysisRequest = z.infer<typeof imageStyleAnalysisRequestSchema>;
export type ImageStylePublishRequest = z.infer<typeof imageStylePublishRequestSchema>;
export type ImageStyleHubVersionResponse = z.infer<typeof imageStyleHubVersionResponseSchema>;

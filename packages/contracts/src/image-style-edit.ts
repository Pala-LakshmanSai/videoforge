import { z } from "zod";

import { imageStyleProfileSchema } from "./image-style-profile.js";

export const IMAGE_STYLE_EDIT_REQUEST_VERSION = "image-style-edit-request/v1" as const;
export const IMAGE_STYLE_EDIT_RESPONSE_VERSION = "image-style-edit-response/v1" as const;

const identifierSchema = z.string().min(1).max(160);
const sha256Schema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const positiveSafeIntegerSchema = z.number().int().positive().safe();

export const imageStyleEditRequestSchema = z
  .object({
    schema_version: z.literal(IMAGE_STYLE_EDIT_REQUEST_VERSION),
    candidate_profile: imageStyleProfileSchema,
  })
  .strict();

export type ImageStyleEditRequest = z.infer<typeof imageStyleEditRequestSchema>;

export const imageStyleEditResultSchema = z
  .object({
    style_id: identifierSchema,
    version_id: identifierSchema,
    edit_id: identifierSchema,
    root_source_artifact_id: identifierSchema,
    root_source_artifact_hash: sha256Schema,
    parent_artifact_id: identifierSchema,
    parent_artifact_hash: sha256Schema,
    current_artifact_id: identifierSchema,
    current_artifact_hash: sha256Schema,
    changed_pointers: z.array(z.string().startsWith("/")).min(1),
    prior_revision: positiveSafeIntegerSchema,
    result_revision: positiveSafeIntegerSchema,
    invalidated_review_snapshot_id: identifierSchema.nullable(),
    edited_at: z.iso.datetime({ offset: false }),
    replayed: z.boolean(),
  })
  .strict()
  .refine((value) => value.result_revision === value.prior_revision + 1, {
    path: ["result_revision"],
    message: "Result revision must increment the prior revision exactly once.",
  });

export const imageStyleEditResponseSchema = z
  .object({
    schema_version: z.literal(IMAGE_STYLE_EDIT_RESPONSE_VERSION),
    edit: imageStyleEditResultSchema,
  })
  .strict();

export type ImageStyleEditResponse = z.infer<typeof imageStyleEditResponseSchema>;

export const imageStyleEditProblemCodeSchema = z.enum([
  "AUTHENTICATION_REQUIRED",
  "AUTHORIZATION_REQUIRED",
  "CLIENT_REVIEWER_IDENTITY_FORBIDDEN",
  "WORKSPACE_ACCESS_REQUIRED",
  "IDEMPOTENCY_KEY_REQUIRED",
  "IF_MATCH_REQUIRED",
  "IF_MATCH_INVALID",
  "INVALID_JSON",
  "INVALID_IMAGE_STYLE_EDIT_REQUEST",
  "IDEMPOTENCY_CONFLICT",
  "INPUT_INVALID",
  "LINEAGE_INVALID",
  "PROFILE_INVALID",
  "REPOSITORY_FAILURE",
  "STYLE_NOT_FOUND",
  "STYLE_PROFILE_NO_CHANGES",
  "STYLE_VERSION_CONFLICT",
  "STYLE_VERSION_IMMUTABLE",
]);

export type ImageStyleEditProblemCode = z.infer<typeof imageStyleEditProblemCodeSchema>;

export const imageStyleEditProblemSchema = z
  .object({
    error: z
      .object({
        code: imageStyleEditProblemCodeSchema,
        message: z.string().min(1),
        detail: z.string().min(1),
        retryable: z.boolean(),
        issues: z.unknown().optional(),
      })
      .strict(),
    type: z.string().url(),
    title: z.string().min(1),
    status: z.number().int().min(400).max(599),
  })
  .strict();

export type ImageStyleEditProblem = z.infer<typeof imageStyleEditProblemSchema>;

const VERSION_TAG = /^"vf-style-r([1-9][0-9]*)-sha256-([0-9a-f]{64})"$/u;

export interface ImageStyleEditVersionAuthority {
  readonly revision: number;
  readonly currentArtifactHash: `sha256:${string}`;
}

export function formatImageStyleEditVersionTag(authority: ImageStyleEditVersionAuthority): string {
  if (!Number.isSafeInteger(authority.revision) || authority.revision < 1) {
    throw new TypeError("Image Style revision must be a positive safe integer.");
  }
  if (!sha256Schema.safeParse(authority.currentArtifactHash).success) {
    throw new TypeError("Image Style current artifact hash must be an exact SHA-256 digest.");
  }
  return `"vf-style-r${authority.revision}-sha256-${authority.currentArtifactHash.slice("sha256:".length)}"`;
}

export function parseImageStyleEditVersionTag(
  value: string,
): ImageStyleEditVersionAuthority | null {
  const matched = VERSION_TAG.exec(value);
  if (matched === null) return null;
  const revision = Number(matched[1]);
  if (!Number.isSafeInteger(revision) || revision < 1) return null;
  return Object.freeze({
    revision,
    currentArtifactHash: `sha256:${matched[2]}` as const,
  });
}

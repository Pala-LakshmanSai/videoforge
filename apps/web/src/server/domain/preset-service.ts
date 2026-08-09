import { sha256CanonicalJson } from "@videoforge/contracts";
import {
  toAvatarProfileResponse,
  toImageStyleResponse,
  type AvatarProfileResponse,
  type FixtureScenario,
  type ImageStyleResponse,
} from "@videoforge/test-fixtures";
import { z } from "zod";

const AVATAR_FIXTURE_PATH = /^\/fixtures\/avatar\/[a-z0-9][a-z0-9._-]*\.svg$/u;
const STYLE_FIXTURE_PATH = /^\/fixtures\/styles\/[a-z0-9][a-z0-9._-]*\.svg$/u;

export const avatarProfileMetadataSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    thumbnail_url: z.string().regex(AVATAR_FIXTURE_PATH),
    source_dimensions: z
      .object({
        width: z.number().int().min(512).max(16_384),
        height: z.number().int().min(512).max(16_384),
      })
      .strict(),
    preparation_profile: z.string().trim().min(1).max(120),
    validation_profile: z.string().trim().min(1).max(120),
    compatibility: z.enum(["UNTESTED", "RUNNING", "PASSED", "FAILED", "CANCELLED", "STALE"]),
    lifecycle: z.literal("ACTIVE"),
    version_state: z.literal("READY"),
    uploaded_bytes_persisted: z.literal(false),
    attestations: z
      .object({
        image_use_rights: z.literal(true),
        likeness_animation_consent: z.literal(true),
      })
      .strict(),
  })
  .strict();

export const imageStyleMetadataSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    summary: z.string().trim().min(1).max(500),
    cover_url: z.string().regex(STYLE_FIXTURE_PATH),
    reference_urls: z.array(z.string().regex(STYLE_FIXTURE_PATH)).max(8),
    example_urls: z.array(z.string().regex(STYLE_FIXTURE_PATH)).max(8),
    medium: z.string().trim().min(1).max(160),
    lighting: z.string().trim().min(1).max(160),
    color: z.string().trim().min(1).max(160),
    texture: z.string().trim().min(1).max(160),
    retention_summary: z.string().trim().min(1).max(300),
    lifecycle: z.literal("ACTIVE"),
    version_state: z.literal("PUBLISHED"),
    uploaded_bytes_persisted: z.literal(false),
    attestations: z
      .object({
        reference_rights: z.literal(true),
        processing_disclosure_acknowledged: z.literal(true),
      })
      .strict(),
  })
  .strict()
  .refine((value) => value.reference_urls.length + value.example_urls.length > 0, {
    message: "At least one owned same-origin fixture reference or example is required.",
    path: ["example_urls"],
  });

export type AvatarProfileMetadata = z.infer<typeof avatarProfileMetadataSchema>;
export type ImageStyleMetadata = z.infer<typeof imageStyleMetadataSchema>;

function avatarProfileHashPayload(metadata: AvatarProfileMetadata): Record<string, unknown> {
  return {
    schema_version: "fixture-avatar-profile-version/v1",
    thumbnail_url: metadata.thumbnail_url,
    source_dimensions: metadata.source_dimensions,
    preparation_profile: metadata.preparation_profile,
    validation_profile: metadata.validation_profile,
    compatibility: metadata.compatibility,
    lifecycle: metadata.lifecycle,
    version_state: metadata.version_state,
    uploaded_bytes_persisted: metadata.uploaded_bytes_persisted,
    attestations: metadata.attestations,
  };
}

function imageStyleHashPayload(metadata: ImageStyleMetadata): Record<string, unknown> {
  return {
    schema_version: "fixture-image-style-version/v1",
    summary: metadata.summary,
    cover_url: metadata.cover_url,
    reference_urls: metadata.reference_urls,
    example_urls: metadata.example_urls,
    medium: metadata.medium,
    lighting: metadata.lighting,
    color: metadata.color,
    texture: metadata.texture,
    retention_summary: metadata.retention_summary,
    lifecycle: metadata.lifecycle,
    version_state: metadata.version_state,
    uploaded_bytes_persisted: metadata.uploaded_bytes_persisted,
    attestations: metadata.attestations,
  };
}

export function hashAvatarProfileMetadata(metadata: AvatarProfileMetadata): Promise<string> {
  return sha256CanonicalJson(avatarProfileHashPayload(metadata));
}

export function hashImageStyleMetadata(metadata: ImageStyleMetadata): Promise<string> {
  return sha256CanonicalJson(imageStyleHashPayload(metadata));
}

function mergeByVersionId<T extends { versionId: string }>(base: T[], added: T[]): T[] {
  const merged = new Map(base.map((item) => [item.versionId, structuredClone(item)]));
  for (const item of added) merged.set(item.versionId, structuredClone(item));
  return [...merged.values()];
}

export function avatarCatalog(
  scenario: FixtureScenario,
  added: AvatarProfileResponse[],
): AvatarProfileResponse[] {
  return mergeByVersionId(scenario.snapshot.avatarHub.profiles.map(toAvatarProfileResponse), added);
}

export function imageStyleCatalog(
  scenario: FixtureScenario,
  added: ImageStyleResponse[],
): ImageStyleResponse[] {
  return mergeByVersionId(scenario.snapshot.imageStyles.styles.map(toImageStyleResponse), added);
}

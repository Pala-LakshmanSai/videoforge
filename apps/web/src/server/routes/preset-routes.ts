import type { AvatarProfileResponse, ImageStyleResponse } from "@videoforge/test-fixtures";
import type { Hono } from "hono";

import {
  avatarCatalog,
  avatarProfileMetadataSchema,
  hashAvatarProfileMetadata,
  hashImageStyleMetadata,
  imageStyleCatalog,
  imageStyleMetadataSchema,
} from "../domain/preset-service";
import { fixtureFromRequest } from "../fixture";
import type { FixtureRuntime } from "../fixture-runtime";
import {
  MAX_CREATED_AVATARS_PER_SESSION,
  MAX_CREATED_STYLES_PER_SESSION,
} from "../fixture-session";
import { readStrictMetadata } from "../mutation";
import { apiProblem, problemResponse } from "../problem";

export function registerPresetRoutes(app: Hono, runtime: FixtureRuntime): void {
  app.get("/api/v1/avatar-profiles", (c) => {
    const resolved = fixtureFromRequest(c.req.raw);
    if (!resolved.ok) return resolved.response;
    const session = runtime.resolveSession(c);
    if (!session.ok) return session.response;
    return c.json(avatarCatalog(resolved.scenario, session.state.createdAvatars));
  });

  app.post("/api/v1/avatar-profiles", (c) =>
    runtime.mutation(c, false, async (rawBody, state) => {
      const resolved = fixtureFromRequest(c.req.raw);
      if (!resolved.ok) return resolved.response;
      const metadata = readStrictMetadata(
        rawBody,
        avatarProfileMetadataSchema,
        "INVALID_AVATAR_PROFILE_METADATA",
        "Avatar Profile metadata is invalid",
        "Send strict fixture metadata with an owned same-origin thumbnail and both required attestations. The server derives the immutable profile hash.",
      );
      if (!metadata.ok) return metadata.response;
      const duplicate = avatarCatalog(resolved.scenario, state.createdAvatars).some(
        (profile) => profile.name.toLocaleLowerCase() === metadata.data.name.toLocaleLowerCase(),
      );
      if (duplicate) {
        return problemResponse(
          apiProblem(
            "AVATAR_PROFILE_NAME_CONFLICT",
            409,
            "Avatar Profile name is already in use",
            "Choose a unique workspace Avatar Profile name.",
            false,
          ),
        );
      }
      if (state.createdAvatars.length >= MAX_CREATED_AVATARS_PER_SESSION) {
        return problemResponse(
          apiProblem(
            "AVATAR_PROFILE_CAPACITY_EXCEEDED",
            429,
            "Fixture Avatar Profile capacity is full",
            "Reset this local fixture session before creating more synthetic profiles.",
            false,
          ),
        );
      }
      state.avatarSequence += 1;
      const suffix = String(state.avatarSequence).padStart(3, "0");
      const profileHash = await hashAvatarProfileMetadata(metadata.data);
      const profile: AvatarProfileResponse = {
        id: `avatar_profile_fixture_created_${suffix}`,
        versionId: `avatar_profile_version_fixture_created_${suffix}`,
        name: metadata.data.name,
        initials: metadata.data.name
          .split(/\s+/u)
          .filter(Boolean)
          .slice(0, 2)
          .map((part) => part[0]?.toUpperCase() ?? "")
          .join(""),
        version: 1,
        status: "READY",
        compatibility: metadata.data.compatibility,
        dimensions: `${metadata.data.source_dimensions.width}×${metadata.data.source_dimensions.height}`,
        lastUsed: "Never",
        activeVersion: 1,
        selectedVersion: 1,
        warning: "Fixture metadata only; uploaded bytes were not persisted",
        thumbnailUrl: metadata.data.thumbnail_url,
        profileHash,
        preparationProfile: metadata.data.preparation_profile,
        validationProfile: metadata.data.validation_profile,
        rightsStatus: "ATTESTED",
      };
      state.createdAvatars.push(profile);
      return c.json(
        {
          ok: true as const,
          avatarProfile: profile,
          lifecycle: {
            profile: metadata.data.lifecycle,
            version: metadata.data.version_state,
          },
          immutableVersion: true as const,
          uploadedBytesPersisted: false as const,
          providerCallsAuthorized: false as const,
        },
        201,
      );
    }),
  );

  app.get("/api/v1/image-styles", (c) => {
    const resolved = fixtureFromRequest(c.req.raw);
    if (!resolved.ok) return resolved.response;
    const session = runtime.resolveSession(c);
    if (!session.ok) return session.response;
    return c.json(imageStyleCatalog(resolved.scenario, session.state.createdStyles));
  });

  app.post("/api/v1/image-styles", (c) =>
    runtime.mutation(c, false, async (rawBody, state) => {
      const resolved = fixtureFromRequest(c.req.raw);
      if (!resolved.ok) return resolved.response;
      const metadata = readStrictMetadata(
        rawBody,
        imageStyleMetadataSchema,
        "INVALID_IMAGE_STYLE_METADATA",
        "Image Style metadata is invalid",
        "Send strict published-version metadata with owned same-origin media paths and both required attestations. The server derives the immutable profile hash.",
      );
      if (!metadata.ok) return metadata.response;
      const duplicate = imageStyleCatalog(resolved.scenario, state.createdStyles).some(
        (style) => style.name.toLocaleLowerCase() === metadata.data.name.toLocaleLowerCase(),
      );
      if (duplicate) {
        return problemResponse(
          apiProblem(
            "IMAGE_STYLE_NAME_CONFLICT",
            409,
            "Image Style name is already in use",
            "Choose a unique workspace Image Style name.",
            false,
          ),
        );
      }
      if (state.createdStyles.length >= MAX_CREATED_STYLES_PER_SESSION) {
        return problemResponse(
          apiProblem(
            "IMAGE_STYLE_CAPACITY_EXCEEDED",
            429,
            "Fixture Image Style capacity is full",
            "Reset this local fixture session before creating more synthetic styles.",
            false,
          ),
        );
      }
      state.styleSequence += 1;
      const suffix = String(state.styleSequence).padStart(3, "0");
      const profileHash = await hashImageStyleMetadata(metadata.data);
      const style: ImageStyleResponse = {
        id: `image_style_fixture_created_${suffix}`,
        versionId: `image_style_version_fixture_created_${suffix}`,
        name: metadata.data.name,
        summary: metadata.data.summary,
        version: 1,
        status: "PUBLISHED",
        referenceCount: metadata.data.reference_urls.length,
        palette: ["#1f3b45", "#b6805e"],
        activeVersion: 1,
        draftVersion: null,
        draftStatus: null,
        warning: "Fixture metadata only; uploaded references were not persisted",
        coverUrl: metadata.data.cover_url,
        referenceUrls: [...metadata.data.reference_urls],
        exampleUrls: [...metadata.data.example_urls],
        profileHash,
        medium: metadata.data.medium,
        lighting: metadata.data.lighting,
        color: metadata.data.color,
        texture: metadata.data.texture,
        rightsStatus: "ATTESTED",
        retentionSummary: metadata.data.retention_summary,
      };
      state.createdStyles.push(style);
      return c.json(
        {
          ok: true as const,
          imageStyle: style,
          lifecycle: {
            style: metadata.data.lifecycle,
            version: metadata.data.version_state,
          },
          immutableVersion: true as const,
          uploadedBytesPersisted: false as const,
          providerCallsAuthorized: false as const,
        },
        201,
      );
    }),
  );
}

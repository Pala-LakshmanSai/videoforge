import { sha256CanonicalJson } from "@videoforge/contracts/canonical-json";
import {
  formatImageStyleEditVersionTag,
  imageStyleEditRequestSchema,
} from "@videoforge/contracts/image-style-edit";
import {
  imageStyleAnalysisRequestSchema,
  imageStyleDraftCreateRequestSchema,
  imageStyleHubVersionResponseSchema,
  imageStylePublishRequestSchema,
  imageStyleReferenceBatchRequestSchema,
} from "@videoforge/contracts/image-style-hub";
import type { ImageStyleProfileDocument } from "@videoforge/contracts";
import type { ImageStyleResponse } from "@videoforge/test-fixtures";
import type { Context, Hono } from "hono";
import { z } from "zod";

import type { FixtureStyleDraft, FixtureSessionState } from "../domain/models";
import { imageStyleCatalog } from "../domain/preset-service";
import { validateFixtureStyleReferences } from "../domain/style-reference-validation";
import { fixtureFromRequest } from "../fixture";
import { MAX_CREATED_STYLES_PER_SESSION } from "../fixture-session";
import type { FixtureRuntime } from "../fixture-runtime";
import { readStrictMetadata } from "../mutation";
import { apiProblem, problemResponse } from "../problem";

function failure(code: string, status: number, title: string, detail: string): Response {
  return problemResponse(apiProblem(code, status, title, detail, false));
}

function findDraft(state: FixtureSessionState, styleId: string, versionId: string) {
  const draft = state.styleDrafts.get(versionId);
  if (!draft || draft.styleId !== styleId) {
    return {
      ok: false as const,
      response: failure(
        "IMAGE_STYLE_DRAFT_NOT_FOUND",
        404,
        "Image Style draft was not found",
        "Refresh the Image Styles Hub and select an existing draft version.",
      ),
    };
  }
  return { ok: true as const, draft };
}

function versionTag(draft: FixtureStyleDraft): string {
  return formatImageStyleEditVersionTag({
    revision: draft.revision,
    currentArtifactHash: draft.authorityHash,
  });
}

function checkVersion(c: Context, draft: FixtureStyleDraft): Response | null {
  if (c.req.header("if-match") !== versionTag(draft)) {
    return failure(
      "STYLE_VERSION_CONFLICT",
      412,
      "Image Style version authority is stale",
      "Refresh the exact draft version and retry with its current ETag.",
    );
  }
  return null;
}

function referencePreviewPath(draft: FixtureStyleDraft, referenceId: string): string {
  return `/api/v1/image-styles/${draft.styleId}/versions/${draft.versionId}/references/${referenceId}/preview`;
}

function responseFor(draft: FixtureStyleDraft) {
  return imageStyleHubVersionResponseSchema.parse({
    schema_version: "image-style-hub-version/v1",
    style_id: draft.styleId,
    version_id: draft.versionId,
    name: draft.name,
    state: draft.state,
    revision: draft.revision,
    version_tag: versionTag(draft),
    references: draft.references.map((reference) => ({
      reference_id: reference.referenceId,
      filename: reference.filename,
      order_index: reference.orderIndex,
      original_checksum: reference.originalChecksum,
      normalized_checksum: reference.normalizedChecksum,
      width: reference.width,
      height: reference.height,
      preview_url: referencePreviewPath(draft, reference.referenceId),
    })),
    profile: draft.profile,
    profile_hash: draft.profileHash,
    original_bytes_persisted: false,
    normalized_bytes_persisted: draft.references.length > 0,
    provider_calls_authorized: false,
  });
}

function fixtureProfile(name: string, aliases: string[]): ImageStyleProfileDocument {
  return {
    schema_version: "image-style-profile/v1",
    summary: `${name}: grounded observational documentary frames with natural light, believable texture, and restrained camera language.`,
    visual_profile: {
      medium_family: "authentic documentary photography",
      realism:
        "Photorealistic and physically believable; never glossy, illustrated, or synthetic-looking.",
      subject_treatment:
        "Candid people and literal physical evidence, without staged poses or copied identities.",
      camera_language:
        "Observational eye-level camera with practical working angles and restrained handheld plausibility.",
      image_framing:
        "Useful 16:9 context with crop-safe primary evidence for the required slow image zoom.",
      shot_scale_preferences: [
        "environmental wide",
        "human medium",
        "hands and action",
        "object detail",
      ],
      lighting: "Natural available light with plausible shadows and slightly uneven exposure.",
      color: {
        descriptors: ["earthy", "true-to-life", "restrained saturation"],
        approximate_hex: ["#1F3B45", "#B6805E"],
      },
      contrast_and_exposure:
        "Soft natural contrast with recoverable highlights and believable shadow detail.",
      depth_of_field:
        "Natural lens depth with enough environmental context to understand the action.",
      texture_and_grain:
        "Tactile material detail with restrained sensor softness and no plastic finish.",
      human_rendering:
        "Natural skin, anatomy, hands, clothing, expressions, and ordinary imperfections.",
      environment_and_material_detail:
        "Specific tools, surfaces, clothing, and lived-in context support the narration.",
      imperfection_profile: ["uneven exposure", "ordinary clutter", "worn materials"],
      mood: ["observational", "grounded", "credible"],
      continuity_rules: [
        "Preserve era, geography, weather, clothing, tools, and materials across adjacent scenes.",
      ],
      must_include: ["literal narration-relevant evidence", "believable practical lighting"],
      must_avoid: [
        "captions",
        "text overlays",
        "watermarks",
        "logos",
        "glossy commercial polish",
        "AI look",
      ],
      flexible_properties: ["weather when narration permits", "shot scale", "minor grain"],
    },
    prompt_profile: {
      planner_guidance:
        "Use literal documentary evidence and preserve factual continuity. Hard cuts only.",
      positive_suffix:
        "authentic observational documentary photography, candid, natural practical light, realistic texture, physically believable, no AI look",
      negative_suffix:
        "illustration, CGI, glossy advertising, staged pose, captions, text, logos, watermark, impossible anatomy",
      full_image_guidance:
        "Compose 16:9 with primary evidence in the center-safe area for a slow smooth zoom.",
      split_image_guidance:
        "Compose for an 8:9 right panel with clear centered evidence and no text.",
    },
    analysis: {
      analysis_kind: "MANUAL",
      overall_confidence: 1,
      trait_evidence: [],
      uncertain_fields: [],
      outlier_reference_aliases: [],
      content_leakage_warnings: [
        `Fixture profile uses only normalized aliases: ${aliases.join(", ")}.`,
        "Never reproduce identities, locations, brands, captions, or watermarks from references.",
      ],
    },
  };
}

async function advanceAuthority(draft: FixtureStyleDraft, payload: unknown): Promise<void> {
  draft.revision += 1;
  draft.authorityHash = await sha256CanonicalJson({
    schema_version: "fixture-style-authority/v1",
    revision: draft.revision,
    payload,
  });
}

function publishedStyle(draft: FixtureStyleDraft): ImageStyleResponse {
  if (!draft.profile || !draft.profileHash || draft.references.length === 0)
    throw new Error("Published draft is incomplete.");
  const previews = draft.references.map((reference) =>
    referencePreviewPath(draft, reference.referenceId),
  );
  return {
    id: draft.styleId,
    versionId: draft.versionId,
    name: draft.name,
    summary: draft.profile.summary,
    version: 1,
    status: "PUBLISHED",
    referenceCount: previews.length,
    palette: ["#1f3b45", "#b6805e"],
    activeVersion: 1,
    draftVersion: null,
    draftStatus: null,
    warning: "Normalized fixture references retained only in this isolated local session",
    coverUrl: previews[0]!,
    referenceUrls: previews,
    exampleUrls: [],
    profileHash: draft.profileHash,
    medium: draft.profile.visual_profile.medium_family,
    lighting: draft.profile.visual_profile.lighting,
    color: draft.profile.visual_profile.color.descriptors.join(", "),
    texture: draft.profile.visual_profile.texture_and_grain,
    rightsStatus: "ATTESTED",
    retentionSummary:
      "Original bytes discarded; bounded sRGB WebP derivatives retained only until fixture-session reset",
  };
}

export function registerStyleHubRoutes(app: Hono, runtime: FixtureRuntime): void {
  app.post("/api/v1/image-style-drafts", (c) =>
    runtime.mutation(c, false, async (rawBody, state) => {
      const request = readStrictMetadata(
        rawBody,
        imageStyleDraftCreateRequestSchema,
        "INVALID_IMAGE_STYLE_DRAFT",
        "Image Style draft is invalid",
        "Send a versioned draft request with one unique workspace name.",
      );
      if (!request.ok) return request.response;
      const fixture = fixtureFromRequest(c.req.raw);
      if (!fixture.ok) return fixture.response;
      const duplicate = [
        ...imageStyleCatalog(fixture.scenario, state.createdStyles),
        ...state.styleDrafts.values(),
      ].some((style) => style.name.toLocaleLowerCase() === request.data.name.toLocaleLowerCase());
      if (duplicate)
        return failure(
          "IMAGE_STYLE_NAME_CONFLICT",
          409,
          "Image Style name is already in use",
          "Choose a unique workspace Image Style name.",
        );
      if (state.styleDrafts.size >= MAX_CREATED_STYLES_PER_SESSION)
        return failure(
          "IMAGE_STYLE_CAPACITY_EXCEEDED",
          429,
          "Fixture Image Style capacity is full",
          "Reset this local fixture session before creating more synthetic styles.",
        );
      state.styleSequence += 1;
      const suffix = String(state.styleSequence).padStart(3, "0");
      const authorityHash = await sha256CanonicalJson({
        schema_version: "fixture-style-authority/v1",
        revision: 1,
        name: request.data.name,
      });
      const draft: FixtureStyleDraft = {
        styleId: `image_style_fixture_created_${suffix}`,
        versionId: `image_style_version_fixture_created_${suffix}`,
        name: request.data.name,
        state: "DRAFT",
        revision: 1,
        authorityHash,
        references: [],
        profile: null,
        profileHash: null,
      };
      state.styleDrafts.set(draft.versionId, draft);
      const response = responseFor(draft);
      return c.json(response, 201, { ETag: response.version_tag });
    }),
  );

  app.get("/api/v1/image-styles/:styleId/versions/:versionId", (c) => {
    const session = runtime.resolveSession(c);
    if (!session.ok) return session.response;
    const found = findDraft(session.state, c.req.param("styleId"), c.req.param("versionId"));
    if (!found.ok) return found.response;
    const response = responseFor(found.draft);
    return c.json(response, 200, { ETag: response.version_tag });
  });

  app.get(
    "/api/v1/image-styles/:styleId/versions/:versionId/references/:referenceId/preview",
    (c) => {
      const session = runtime.resolveSession(c);
      if (!session.ok) return session.response;
      const found = findDraft(session.state, c.req.param("styleId"), c.req.param("versionId"));
      if (!found.ok) return found.response;
      const reference = found.draft.references.find(
        (item) => item.referenceId === c.req.param("referenceId"),
      );
      if (!reference)
        return failure(
          "IMAGE_STYLE_REFERENCE_NOT_FOUND",
          404,
          "Image Style reference was not found",
          "Refresh the exact style version.",
        );
      return new Response(reference.normalizedBytes.slice().buffer as ArrayBuffer, {
        headers: {
          "content-type": "image/webp",
          "cache-control": "private, no-store",
          etag: `"${reference.normalizedChecksum}"`,
        },
      });
    },
  );

  app.post("/api/v1/image-styles/:styleId/versions/:versionId/references", (c) =>
    runtime.mutation(c, true, async (rawBody, state) => {
      const found = findDraft(state, c.req.param("styleId"), c.req.param("versionId"));
      if (!found.ok) return found.response;
      const conflict = checkVersion(c, found.draft);
      if (conflict) return conflict;
      if (found.draft.state !== "DRAFT")
        return failure(
          "STYLE_VERSION_CONFLICT",
          409,
          "References cannot be replaced",
          "Create a new draft version before changing an accepted reference batch.",
        );
      const request = readStrictMetadata(
        rawBody,
        imageStyleReferenceBatchRequestSchema,
        "INVALID_IMAGE_STYLE_REFERENCES",
        "Image Style references are invalid",
        "Send 3-8 normalized, checksum-pinned references with exact rights, disclosure, retention, and ordering metadata.",
      );
      if (!request.ok) return request.response;
      let validated;
      try {
        validated = await validateFixtureStyleReferences(request.data);
      } catch (error) {
        return failure(
          "INVALID_IMAGE_STYLE_REFERENCES",
          422,
          "Image Style references failed server validation",
          error instanceof Error ? error.message : "Raster validation failed.",
        );
      }
      found.draft.references = validated.map((reference, index) => ({
        referenceId: `style_reference_${String(index + 1).padStart(3, "0")}`,
        filename: reference.filename,
        orderIndex: reference.orderIndex,
        originalChecksum: reference.originalChecksum,
        normalizedChecksum: reference.normalizedChecksum,
        width: reference.width,
        height: reference.height,
        normalizedBytes: reference.normalizedBytes,
      }));
      found.draft.state = "REFERENCES_READY";
      await advanceAuthority(
        found.draft,
        found.draft.references.map((reference) => ({
          checksum: reference.normalizedChecksum,
          order: reference.orderIndex,
        })),
      );
      const response = responseFor(found.draft);
      return c.json(response, 200, { ETag: response.version_tag });
    }),
  );

  app.post("/api/v1/image-styles/:styleId/versions/:versionId/analyze", (c) =>
    runtime.mutation(c, true, async (rawBody, state) => {
      const found = findDraft(state, c.req.param("styleId"), c.req.param("versionId"));
      if (!found.ok) return found.response;
      const conflict = checkVersion(c, found.draft);
      if (conflict) return conflict;
      if (found.draft.state !== "REFERENCES_READY")
        return failure(
          "STYLE_VERSION_CONFLICT",
          409,
          "Image Style draft is not ready for analysis",
          "Register one valid reference batch before analysis.",
        );
      const request = readStrictMetadata(
        rawBody,
        imageStyleAnalysisRequestSchema,
        "INVALID_IMAGE_STYLE_ANALYSIS_REQUEST",
        "Image Style analysis request is invalid",
        "Send the exact versioned fixture-analysis request.",
      );
      if (!request.ok) return request.response;
      const profile = fixtureProfile(
        found.draft.name,
        found.draft.references.map((reference) => reference.referenceId),
      );
      found.draft.profile = profile;
      found.draft.profileHash = await sha256CanonicalJson(profile);
      found.draft.state = "NEEDS_REVIEW";
      await advanceAuthority(found.draft, { profile_hash: found.draft.profileHash });
      const response = responseFor(found.draft);
      return c.json(response, 200, { ETag: response.version_tag });
    }),
  );

  app.patch("/api/v1/image-styles/:styleId/versions/:versionId", (c) =>
    runtime.mutation(c, true, async (rawBody, state) => {
      const found = findDraft(state, c.req.param("styleId"), c.req.param("versionId"));
      if (!found.ok) return found.response;
      const conflict = checkVersion(c, found.draft);
      if (conflict) return conflict;
      if (found.draft.state !== "NEEDS_REVIEW")
        return failure(
          "STYLE_VERSION_CONFLICT",
          409,
          "Image Style profile is not editable",
          "Analyze the exact draft before editing its full profile candidate.",
        );
      const request = readStrictMetadata(
        rawBody,
        imageStyleEditRequestSchema,
        "INVALID_IMAGE_STYLE_EDIT_REQUEST",
        "Image Style edit request is invalid",
        "Send one complete image-style-edit-request/v1 candidate.",
      );
      if (!request.ok) return request.response;
      const profileHash = await sha256CanonicalJson(request.data.candidate_profile);
      if (profileHash === found.draft.profileHash)
        return failure(
          "STYLE_PROFILE_NO_CHANGES",
          409,
          "Image Style profile has no changes",
          "Change at least one reviewed profile field before saving.",
        );
      found.draft.profile = request.data.candidate_profile;
      found.draft.profileHash = profileHash;
      await advanceAuthority(found.draft, { profile_hash: profileHash });
      const response = responseFor(found.draft);
      return c.json(response, 200, { ETag: response.version_tag });
    }),
  );

  app.post("/api/v1/image-styles/:styleId/versions/:versionId/publish", (c) =>
    runtime.mutation(c, true, async (rawBody, state) => {
      const found = findDraft(state, c.req.param("styleId"), c.req.param("versionId"));
      if (!found.ok) return found.response;
      const conflict = checkVersion(c, found.draft);
      if (conflict) return conflict;
      if (found.draft.state !== "NEEDS_REVIEW" || !found.draft.profile)
        return failure(
          "STYLE_VERSION_CONFLICT",
          409,
          "Image Style draft is not publishable",
          "Analyze and review the exact draft before publication.",
        );
      const request = readStrictMetadata(
        rawBody,
        imageStylePublishRequestSchema,
        "INVALID_IMAGE_STYLE_PUBLISH_REQUEST",
        "Image Style publish request is invalid",
        "Send the exact versioned publication request.",
      );
      if (!request.ok) return request.response;
      found.draft.state = "PUBLISHED";
      await advanceAuthority(found.draft, { published_profile_hash: found.draft.profileHash });
      state.createdStyles.push(publishedStyle(found.draft));
      const response = responseFor(found.draft);
      return c.json(response, 201, { ETag: response.version_tag });
    }),
  );

  app.post("/api/v1/image-styles/:styleId/archive", (c) =>
    runtime.mutation(c, false, async (rawBody, state) => {
      const request = readStrictMetadata(
        rawBody,
        z.object({ version_id: z.string().min(1).max(160) }).strict(),
        "INVALID_IMAGE_STYLE_ARCHIVE_REQUEST",
        "Image Style archive request is invalid",
        "Send the exact published version_id to archive.",
      );
      if (!request.ok) return request.response;
      const style = state.createdStyles.find(
        (candidate) => candidate.id === c.req.param("styleId"),
      );
      if (!style)
        return failure(
          "IMAGE_STYLE_NOT_FOUND",
          404,
          "Image Style was not found",
          "Refresh the Image Styles Hub.",
        );
      if (style.versionId !== request.data.version_id)
        return failure(
          "STYLE_VERSION_CONFLICT",
          409,
          "Image Style version authority is stale",
          "Refresh and archive the exact active published version.",
        );
      style.status = "ARCHIVED";
      const draft = state.styleDrafts.get(style.versionId);
      if (draft) draft.state = "ARCHIVED";
      return c.json({
        ok: true,
        style_id: style.id,
        version_id: style.versionId,
        state: "ARCHIVED",
        provider_calls_authorized: false,
      });
    }),
  );
}

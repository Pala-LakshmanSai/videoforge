import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { executionProfileCatalog } from "@videoforge/config";
import {
  DEFAULT_FIXTURE_SCENARIO_ID,
  FIXTURE_SCENARIO_IDS,
  listFixtureScenarios,
  toBootstrapResponse,
  toUsageSummaryResponse,
  type AvatarProfileResponse,
  type FixtureBootstrapResponse,
  type FixtureScenario,
  type ImageStyleResponse,
} from "@videoforge/test-fixtures";
import { Hono, type Context } from "hono";

import { registerAccessMiddleware } from "./access-middleware";
import type { FixtureSessionState } from "./domain/models";
import {
  baseProjectDetail,
  projectDetailsForScenario,
  putRuntimeProject,
  resolveProjectDetail,
  rotateProjectVersion,
  scenarioMutationProblemFor,
  semanticProjectPreflight,
} from "./domain/project-service";
import {
  avatarCatalog,
  avatarProfileMetadataSchema,
  hashAvatarProfileMetadata,
  hashImageStyleMetadata,
  imageStyleCatalog,
  imageStyleMetadataSchema,
} from "./domain/preset-service";
import { registeredVoiceoverFrom, voiceoverRegistrationSchema } from "./domain/voiceover-service";
import { fixtureFromRequest, resolveFixture, safeCommit, type FixtureResolution } from "./fixture";
import {
  FixtureSessionStore,
  MAX_CREATED_AVATARS_PER_SESSION,
  MAX_CREATED_STYLES_PER_SESSION,
  MAX_REGISTERED_VOICEOVERS_PER_SESSION,
} from "./fixture-session";
import {
  canonicalJson,
  idempotentMutation,
  projectVersionError,
  readCreateProjectRequest,
  readFallbackApprovalRequest,
  readFinalApprovalRequest,
  readProjectMutationRequest,
  readStrictMetadata,
} from "./mutation";
import { apiProblem, problemResponse } from "./problem";

const FIXTURE_PREVIEW_FILE = resolve(process.cwd(), "public/fixtures/media/watermelon-market.svg");

function resolveContextFixture(c: Context): FixtureResolution {
  return fixtureFromRequest(c.req.raw);
}

export function createApiApp(
  options: { commit?: string; environment?: "development" | "test" | "production" } = {},
): Hono {
  const app = new Hono();
  const commit = safeCommit(options.commit ?? process.env.VIDEOFORGE_COMMIT);
  const environment = options.environment ?? process.env.NODE_ENV ?? "development";
  const fixtureSessions = new FixtureSessionStore(environment);
  const resolveFixtureSession = (c: Context) => fixtureSessions.resolve(c);

  function fixtureMutation(
    c: Context,
    requireVersion: boolean,
    handle: (rawBody: string, state: FixtureSessionState) => Response | Promise<Response>,
  ): Promise<Response> {
    const session = resolveFixtureSession(c);
    if (!session.ok) return Promise.resolve(session.response);
    return idempotentMutation(c, session.state.idempotencyLedger, requireVersion, (rawBody) =>
      handle(rawBody, session.state),
    );
  }

  function bootstrapResponse(
    scenario: FixtureScenario,
    state: FixtureSessionState,
  ): FixtureBootstrapResponse {
    const response = toBootstrapResponse(scenario);
    if (scenario.snapshot.access.state !== "AUTHORIZED") return response;
    response.projects = projectDetailsForScenario(state.runtimeProjects, scenario).map(
      (detail) => detail.project,
    );
    response.avatars = avatarCatalog(scenario, state.createdAvatars);
    response.styles = imageStyleCatalog(scenario, state.createdStyles);
    if (scenario.id === "happy_generating" && state.createdProjectRequest) {
      const registeredVoiceover = state.registeredVoiceovers.get(
        state.createdProjectRequest.voiceover_asset_id,
      );
      response.draft = {
        ...response.draft,
        title: state.createdProjectRequest.title,
        voiceover: {
          assetId: state.createdProjectRequest.voiceover_asset_id,
          filename: registeredVoiceover?.filename ?? response.draft.voiceover.filename,
          durationSeconds:
            registeredVoiceover?.durationSeconds ?? response.draft.voiceover.durationSeconds,
          uploadState: "VERIFIED",
        },
        avatarProfileVersionId: state.createdProjectRequest.avatar_profile_version_id,
        imageStyleVersionId: state.createdProjectRequest.image_style_version_id,
        optionalScript: state.createdProjectRequest.optional_script ?? null,
        extraPromptKeywords: state.createdProjectRequest.extra_prompt_keywords ?? null,
        applyExtraPromptKeywords: state.createdProjectRequest.apply_extra_prompt_keywords,
        effectiveExtraPromptKeywords: state.createdProjectRequest.apply_extra_prompt_keywords
          ? (state.createdProjectRequest.extra_prompt_keywords ?? null)
          : null,
        generationMode: state.createdProjectRequest.generation_mode,
        spendCapUsd: state.createdProjectRequest.spend_cap_usd,
      };
    }
    return response;
  }

  registerAccessMiddleware(app, environment, fixtureSessions);

  app.get("/api/health", (c) => {
    const resolved = resolveContextFixture(c);
    if (!resolved.ok) return resolved.response;
    return c.json({
      app: "videoforge" as const,
      status: "ok" as const,
      mode: "fixture" as const,
      commit,
      fixture_id: resolved.id,
      synthetic: true as const,
      provider_calls_authorized: false as const,
      authorized_spend_usd: 0 as const,
    });
  });

  if (environment !== "production") {
    app.get("/api/dev/fixtures", (c) =>
      c.json({
        defaultFixtureId: DEFAULT_FIXTURE_SCENARIO_ID,
        count: FIXTURE_SCENARIO_IDS.length,
        fixtures: listFixtureScenarios(),
      }),
    );

    app.get("/api/dev/fixtures/:fixtureId", (c) => {
      const resolved = resolveFixture(c.req.param("fixtureId"));
      if (!resolved.ok) return resolved.response;
      return c.json(resolved.scenario);
    });

    app.post("/api/dev/fixture-session/reset", (c) => {
      const session = resolveFixtureSession(c);
      if (!session.ok) return session.response;
      fixtureSessions.reset(session.id);
      return c.json({ ok: true as const, sessionId: session.id, providerCallsAuthorized: false });
    });
  }

  app.get("/api/v1/bootstrap", (c) => {
    const resolved = resolveContextFixture(c);
    if (!resolved.ok) return resolved.response;
    const session = resolveFixtureSession(c);
    if (!session.ok) return session.response;
    return c.json(bootstrapResponse(resolved.scenario, session.state));
  });

  app.get("/api/v1/execution-profiles", (c) => {
    const resolved = resolveContextFixture(c);
    if (!resolved.ok) return resolved.response;
    return c.json(executionProfileCatalog);
  });

  app.get("/api/v1/avatar-profiles", (c) => {
    const resolved = resolveContextFixture(c);
    if (!resolved.ok) return resolved.response;
    const session = resolveFixtureSession(c);
    if (!session.ok) return session.response;
    return c.json(avatarCatalog(resolved.scenario, session.state.createdAvatars));
  });

  app.post("/api/v1/avatar-profiles", (c) =>
    fixtureMutation(c, false, async (rawBody, state) => {
      const resolved = resolveContextFixture(c);
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
    const resolved = resolveContextFixture(c);
    if (!resolved.ok) return resolved.response;
    const session = resolveFixtureSession(c);
    if (!session.ok) return session.response;
    return c.json(imageStyleCatalog(resolved.scenario, session.state.createdStyles));
  });

  app.post("/api/v1/image-styles", (c) =>
    fixtureMutation(c, false, async (rawBody, state) => {
      const resolved = resolveContextFixture(c);
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

  app.post("/api/v1/voiceovers/register", (c) =>
    fixtureMutation(c, false, (rawBody, state) => {
      const resolved = resolveContextFixture(c);
      if (!resolved.ok) return resolved.response;
      const metadata = readStrictMetadata(
        rawBody,
        voiceoverRegistrationSchema,
        "INVALID_VOICEOVER_REGISTRATION",
        "Voiceover registration is invalid",
        "Send exact browser-validated metadata; no audio bytes belong in this request.",
      );
      if (!metadata.ok) return metadata.response;
      const handleHex = metadata.data.asset_id.slice("fixture_voiceover_sha256_".length);
      if (metadata.data.checksum !== `sha256:${handleHex}`) {
        return problemResponse(
          apiProblem(
            "VOICEOVER_CHECKSUM_MISMATCH",
            422,
            "Voiceover handle does not match its checksum",
            "The fixture asset_id SHA-256 suffix must exactly equal the checksum hex digest.",
            false,
          ),
        );
      }
      const voiceover = registeredVoiceoverFrom(metadata.data);
      const existing = state.registeredVoiceovers.get(voiceover.assetId);
      if (existing && canonicalJson(existing) !== canonicalJson(voiceover)) {
        return problemResponse(
          apiProblem(
            "VOICEOVER_REGISTRATION_CONFLICT",
            409,
            "Voiceover handle is already registered differently",
            "A checksum-bound fixture handle is immutable; use a new handle for different metadata.",
            false,
          ),
        );
      }
      if (!existing && state.registeredVoiceovers.size >= MAX_REGISTERED_VOICEOVERS_PER_SESSION) {
        return problemResponse(
          apiProblem(
            "VOICEOVER_REGISTRATION_CAPACITY_EXCEEDED",
            429,
            "Fixture voiceover capacity is full",
            "Reset this local fixture session before registering another synthetic voiceover.",
            false,
          ),
        );
      }
      state.registeredVoiceovers.set(voiceover.assetId, voiceover);
      return c.json(
        { ok: true as const, voiceover, synthetic: true as const },
        existing ? 200 : 201,
      );
    }),
  );

  app.get("/api/v1/voiceovers/:assetId", (c) => {
    const resolved = resolveContextFixture(c);
    if (!resolved.ok) return resolved.response;
    const session = resolveFixtureSession(c);
    if (!session.ok) return session.response;
    const voiceover = session.state.registeredVoiceovers.get(c.req.param("assetId"));
    if (!voiceover) {
      return problemResponse(
        apiProblem(
          "VOICEOVER_ASSET_NOT_FOUND",
          404,
          "Registered voiceover was not found",
          "Register the browser-validated voiceover metadata before requesting its status.",
          false,
        ),
      );
    }
    return c.json(voiceover);
  });

  app.get("/api/v1/projects", (c) => {
    const resolved = resolveContextFixture(c);
    if (!resolved.ok) return resolved.response;
    const session = resolveFixtureSession(c);
    if (!session.ok) return session.response;
    return c.json(
      projectDetailsForScenario(session.state.runtimeProjects, resolved.scenario).map(
        (detail) => detail.project,
      ),
    );
  });

  app.get("/api/v1/projects/:projectId", (c) => {
    const resolved = resolveContextFixture(c);
    if (!resolved.ok) return resolved.response;
    const session = resolveFixtureSession(c);
    if (!session.ok) return session.response;
    const project = resolveProjectDetail(
      resolved.scenario,
      c.req.param("projectId"),
      session.state.runtimeProjects,
    );
    if (!project.ok) return project.response;
    c.header("etag", project.detail.project.versionToken);
    return c.json(project.detail);
  });

  app.get("/api/v1/projects/:projectId/events", (c) => {
    const resolved = resolveContextFixture(c);
    if (!resolved.ok) return resolved.response;
    const session = resolveFixtureSession(c);
    if (!session.ok) return session.response;
    const project = resolveProjectDetail(
      resolved.scenario,
      c.req.param("projectId"),
      session.state.runtimeProjects,
    );
    if (!project.ok) return project.response;
    return c.json(project.detail.events);
  });

  app.get("/api/v1/projects/:projectId/download", async (c) => {
    const resolved = resolveContextFixture(c);
    if (!resolved.ok) return resolved.response;
    const session = resolveFixtureSession(c);
    if (!session.ok) return session.response;
    const project = resolveProjectDetail(
      resolved.scenario,
      c.req.param("projectId"),
      session.state.runtimeProjects,
    );
    if (!project.ok) return project.response;
    if (project.detail.project.review.state !== "APPROVED") {
      return problemResponse(
        apiProblem(
          "PROJECT_DOWNLOAD_NOT_READY",
          409,
          "Fixture preview is not ready",
          "Approve the exact current review candidate before downloading its synthetic preview.",
          false,
        ),
      );
    }
    const preview = await readFile(FIXTURE_PREVIEW_FILE, "utf8");
    c.header("content-type", "image/svg+xml; charset=utf-8");
    c.header("content-disposition", 'attachment; filename="videoforge-fixture-preview.svg"');
    c.header("x-videoforge-artifact-kind", "synthetic-preview");
    return c.body(preview);
  });

  app.get("/api/v1/usage", (c) => {
    const resolved = resolveContextFixture(c);
    if (!resolved.ok) return resolved.response;
    return c.json(toUsageSummaryResponse(resolved.scenario));
  });

  app.post("/api/v1/projects/preflight", (c) =>
    fixtureMutation(c, false, (rawBody, state) => {
      const resolved = resolveContextFixture(c);
      if (!resolved.ok) return resolved.response;
      const request = readCreateProjectRequest(rawBody);
      if (!request.ok) return request.response;
      const preflight = semanticProjectPreflight(
        resolved.scenario,
        request.data,
        state.registeredVoiceovers,
        state.createdAvatars,
        state.createdStyles,
      );
      if (!preflight.ok) return preflight.response;
      const scenarioProblem = scenarioMutationProblemFor(
        resolved.scenario,
        "PROJECT_PREFLIGHT",
        request.data,
      );
      if (scenarioProblem) return problemResponse(scenarioProblem);
      return c.json({
        ok: true as const,
        status: "READY" as const,
        fixture: resolved.id,
        avatarProfileVersionId: request.data.avatar_profile_version_id,
        imageStyleVersionId: request.data.image_style_version_id,
        estimatedCostUsd: preflight.estimatedCostUsd,
        spendCapUsd: request.data.spend_cap_usd,
        providerCallsAuthorized: false as const,
      });
    }),
  );

  app.post("/api/v1/projects", (c) =>
    fixtureMutation(c, false, (rawBody, state) => {
      const resolved = resolveContextFixture(c);
      if (!resolved.ok) return resolved.response;
      const request = readCreateProjectRequest(rawBody);
      if (!request.ok) return request.response;
      const preflight = semanticProjectPreflight(
        resolved.scenario,
        request.data,
        state.registeredVoiceovers,
        state.createdAvatars,
        state.createdStyles,
      );
      if (!preflight.ok) return preflight.response;
      const scenarioProblem = scenarioMutationProblemFor(
        resolved.scenario,
        "PROJECT_CREATE",
        request.data,
      );
      if (scenarioProblem) return problemResponse(scenarioProblem);
      const generating = resolveFixture("happy_generating");
      if (!generating.ok) return generating.response;
      const created = baseProjectDetail(generating.scenario);
      if (!created) {
        return problemResponse(
          apiProblem(
            "FIXTURE_PROJECT_TEMPLATE_MISSING",
            500,
            "Fixture project template is unavailable",
            "The happy-generating fixture must contain one project template.",
            false,
          ),
        );
      }
      created.project = {
        ...created.project,
        title: request.data.title,
        mode: request.data.generation_mode,
        estimatedCost: preflight.estimatedCostUsd,
        capUsd: request.data.spend_cap_usd,
        pins: {
          avatarProfileVersionId: request.data.avatar_profile_version_id,
          imageStyleVersionId: request.data.image_style_version_id,
        },
      };
      created.events = [
        {
          id: "event_fixture_created_001",
          detail: "Revision created from the submitted immutable preset pins",
          at: "2026-08-09T09:20:00.000Z",
        },
        ...created.events.filter((event) => event.id !== "event_fixture_001"),
      ];
      putRuntimeProject(state.runtimeProjects, "happy_generating", created);
      state.createdProjectRequest = structuredClone(request.data);
      c.header("etag", created.project.versionToken);
      return c.json(
        {
          ok: true as const,
          id: created.project.id,
          revisionId: created.project.revisionId,
          status: "QUEUED" as const,
          fixture: resolved.id,
          nextFixture: "happy_generating" as const,
          pins: {
            avatarProfileVersionId: request.data.avatar_profile_version_id,
            imageStyleVersionId: request.data.image_style_version_id,
          },
          providerCallsAuthorized: false as const,
          versionToken: created.project.versionToken,
        },
        202,
      );
    }),
  );

  app.post("/api/v1/projects/:projectId/cancel", (c) =>
    fixtureMutation(c, true, (rawBody, state) => {
      const pathProjectId = c.req.param("projectId");
      const mutationRequest = readProjectMutationRequest(rawBody, pathProjectId);
      if (!mutationRequest.ok) return mutationRequest.response;
      const resolved = resolveContextFixture(c);
      if (!resolved.ok) return resolved.response;
      const project = resolveProjectDetail(resolved.scenario, pathProjectId, state.runtimeProjects);
      if (!project.ok) return project.response;
      const versionError = projectVersionError(c, project.detail.project.versionToken);
      if (versionError) return versionError;
      if (project.detail.project.status === "APPROVED") {
        return problemResponse(
          apiProblem(
            "PROJECT_ALREADY_APPROVED",
            409,
            "Approved project cannot be cancelled",
            "Archive the approved project instead of cancelling its immutable revision.",
            false,
          ),
        );
      }
      if (project.detail.project.status === "CANCEL_REQUESTED") {
        return problemResponse(
          apiProblem(
            "PROJECT_CANCEL_ALREADY_REQUESTED",
            409,
            "Cancellation is already settling",
            "Wait for the existing cancellation request to reach a terminal state.",
            false,
          ),
        );
      }
      const cancellableStatuses: ReadonlySet<string> = new Set([
        "QUEUED",
        "RUNNING",
        "NEEDS_ATTENTION",
        "RECONCILING",
      ]);
      if (!cancellableStatuses.has(project.detail.project.status)) {
        return problemResponse(
          apiProblem(
            "PROJECT_CANCEL_NOT_ALLOWED",
            409,
            "Project cannot be cancelled in its current state",
            "Only queued, running, attention-required, or reconciling work can be cancelled.",
            false,
          ),
        );
      }
      const cancelled = structuredClone(project.detail);
      cancelled.project.status = "CANCEL_REQUESTED";
      cancelled.project.stage = "CANCEL_REQUESTED";
      cancelled.project.eta = "Calculating";
      cancelled.project.queuePosition = null;
      cancelled.project.allowedActions = [];
      cancelled.project.lanes.image = {
        ...cancelled.project.lanes.image,
        state: "CANCEL_REQUESTED",
        action: "Stopping after the current safe checkpoint",
      };
      cancelled.project.lanes.avatar = {
        ...cancelled.project.lanes.avatar,
        state: "CANCEL_REQUESTED",
        action: "Cancellation signal acknowledged",
      };
      cancelled.project.stages = cancelled.project.stages?.map((stage) =>
        ["RUNNING", "RETRYING", "STARTING", "QUEUED"].includes(stage.status)
          ? { ...stage, status: "CANCEL_REQUESTED", detail: "Cancellation is settling" }
          : stage,
      );
      cancelled.notice = {
        tone: "WARNING",
        title: "Cancellation requested",
        detail: "Workers are settling; accepted fixture artifacts remain recorded.",
        action: null,
        scope: "PROJECT",
      };
      cancelled.events.push({
        id: `event_fixture_cancel_${cancelled.events.length + 1}`,
        detail: "Cancellation requested once; conflicting actions are disabled",
        at: "2026-08-09T09:32:00.000Z",
      });
      const versionToken = rotateProjectVersion(cancelled);
      putRuntimeProject(state.runtimeProjects, resolved.id, cancelled);
      c.header("etag", versionToken);
      return c.json(
        {
          ok: true as const,
          id: project.detail.project.id,
          status: "CANCEL_REQUESTED" as const,
          versionToken,
        },
        202,
      );
    }),
  );

  app.post("/api/v1/projects/:projectId/retry", (c) =>
    fixtureMutation(c, true, (rawBody, state) => {
      const pathProjectId = c.req.param("projectId");
      const mutationRequest = readProjectMutationRequest(rawBody, pathProjectId);
      if (!mutationRequest.ok) return mutationRequest.response;
      const resolved = resolveContextFixture(c);
      if (!resolved.ok) return resolved.response;
      const project = resolveProjectDetail(resolved.scenario, pathProjectId, state.runtimeProjects);
      if (!project.ok) return project.response;
      const versionError = projectVersionError(c, project.detail.project.versionToken);
      if (versionError) return versionError;
      if (
        project.detail.project.status === "APPROVED" ||
        project.detail.project.status === "CANCEL_REQUESTED" ||
        !project.detail.project.allowedActions.includes("RETRY_FAILED_ITEMS")
      ) {
        return problemResponse(
          apiProblem(
            "PROJECT_RETRY_NOT_ALLOWED",
            409,
            "Project cannot be retried in its current state",
            "Approved or cancellation-pending projects cannot dispatch another attempt.",
            false,
          ),
        );
      }
      const retryableScenarios: readonly string[] = ["image_partial_failure", "avatar_lip_failure"];
      if (!retryableScenarios.includes(resolved.id)) {
        return problemResponse(
          apiProblem(
            "PROJECT_RETRY_NOT_ALLOWED",
            409,
            "Project has no retryable failed items",
            "Retry only an explicitly failed item set; reconciliation and active work must not be dispatched twice.",
            false,
          ),
        );
      }
      const retrying = structuredClone(project.detail);
      const imageRetry = resolved.id === "image_partial_failure";
      retrying.project.status = "RUNNING";
      retrying.project.stage = imageRetry ? "IMAGE_RETRY" : "AVATAR_REPAIR";
      retrying.project.eta = "10 min";
      retrying.project.queuePosition = null;
      retrying.project.allowedActions = imageRetry ? ["CANCEL"] : ["CANCEL", "REVIEW"];
      const lane = imageRetry ? retrying.project.lanes.image : retrying.project.lanes.avatar;
      lane.state = "RETRYING";
      lane.action = imageRetry
        ? "Retrying failed image chunk; accepted images remain checkpointed"
        : "MuseTalk repair queued for the flagged lip-sync clip";
      const generationStage = retrying.project.stages?.find((stage) => stage.id === "generation");
      if (generationStage) {
        generationStage.status = "RETRYING";
        generationStage.detail = imageRetry
          ? "Failed image chunk retry accepted"
          : "Targeted lip repair accepted";
      }
      if (!imageRetry) retrying.project.review.state = "CHANGES_REQUESTED";
      retrying.notice = {
        tone: "INFO",
        title: imageRetry ? "Image retry queued" : "Lip repair queued",
        detail: imageRetry
          ? "Accepted images remain checkpointed; only the failed chunk is being retried."
          : "Only the flagged clip is being repaired; accepted avatar work remains unchanged.",
        action: null,
        scope: "PROJECT",
      };
      retrying.events.push({
        id: `event_fixture_retry_${retrying.events.length + 1}`,
        detail: imageRetry
          ? "Failed image chunk retry accepted once"
          : "Targeted lip-sync repair accepted once",
        at: "2026-08-09T09:34:00.000Z",
      });
      const versionToken = rotateProjectVersion(retrying);
      putRuntimeProject(state.runtimeProjects, resolved.id, retrying);
      c.header("etag", versionToken);
      return c.json(
        {
          ok: true as const,
          id: project.detail.project.id,
          status: "RETRY_REQUESTED" as const,
          retryScope:
            resolved.id === "image_partial_failure"
              ? (["scene_fixture_014", "scene_fixture_015"] as const)
              : (["avatar_span_fixture_018"] as const),
          nextCheckSeconds: 10,
          versionToken,
        },
        202,
      );
    }),
  );

  app.post("/api/v1/projects/:projectId/fallback-approval", (c) =>
    fixtureMutation(c, true, (rawBody, state) => {
      const pathProjectId = c.req.param("projectId");
      const approvalRequest = readFallbackApprovalRequest(rawBody, pathProjectId);
      if (!approvalRequest.ok) return approvalRequest.response;
      const resolved = resolveContextFixture(c);
      if (!resolved.ok) return resolved.response;
      const project = resolveProjectDetail(resolved.scenario, pathProjectId, state.runtimeProjects);
      if (!project.ok) return project.response;
      const versionError = projectVersionError(c, project.detail.project.versionToken);
      if (versionError) return versionError;
      if (
        resolved.id !== "skyreels_approval_required" ||
        project.detail.project.status !== "NEEDS_ATTENTION" ||
        project.detail.project.review.flaggedDefect !== "WHOLE_FRAME" ||
        !project.detail.project.allowedActions.includes("APPROVE_FALLBACK")
      ) {
        return problemResponse(
          apiProblem(
            "FALLBACK_APPROVAL_NOT_ALLOWED",
            409,
            "Fallback approval is not available",
            "Approve fallback spend only for the current whole-frame defect awaiting explicit approval.",
            false,
          ),
        );
      }
      const estimatedTotalUsd = Number(
        (project.detail.project.estimatedCost + approvalRequest.approvedIncrementUsd).toFixed(2),
      );
      if (estimatedTotalUsd > project.detail.project.capUsd) {
        return problemResponse(
          apiProblem(
            "BUDGET_CAP_EXCEEDED",
            409,
            "Fallback would exceed the project spend cap",
            `The $${approvalRequest.approvedIncrementUsd.toFixed(2)} fallback would raise the fixture estimate to $${estimatedTotalUsd.toFixed(2)}, above the $${project.detail.project.capUsd.toFixed(2)} cap.`,
            false,
          ),
        );
      }
      const fallback = structuredClone(project.detail);
      fallback.project.status = "RUNNING";
      fallback.project.stage = "AVATAR_FALLBACK";
      fallback.project.estimatedCost = estimatedTotalUsd;
      fallback.project.eta = "10 min";
      fallback.project.queuePosition = null;
      fallback.project.lanes.avatar.state = "STARTING";
      fallback.project.lanes.avatar.action =
        "Synthetic SkyReels fallback reserved; provider dispatch remains disabled";
      fallback.project.review.state = "CHANGES_REQUESTED";
      fallback.project.allowedActions = ["CANCEL", "REVIEW"];
      const generationStage = fallback.project.stages?.find((stage) => stage.id === "generation");
      if (generationStage) {
        generationStage.status = "STARTING";
        generationStage.detail = "Whole-frame fallback reservation accepted";
      }
      fallback.notice = {
        tone: "INFO",
        title: "Fallback reservation recorded",
        detail:
          "The fixture estimate now includes $0.18; no provider call or external spend was made.",
        action: null,
        scope: "PROJECT",
      };
      fallback.events.push({
        id: `event_fixture_fallback_${fallback.events.length + 1}`,
        detail: "Whole-frame fallback reservation approved once for $0.18",
        at: "2026-08-09T09:35:00.000Z",
      });
      const versionToken = rotateProjectVersion(fallback);
      putRuntimeProject(state.runtimeProjects, resolved.id, fallback);
      c.header("etag", versionToken);
      return c.json(
        {
          ok: true as const,
          id: project.detail.project.id,
          status: "FALLBACK_APPROVED" as const,
          approvedIncrementUsd: approvalRequest.approvedIncrementUsd,
          estimatedTotalUsd,
          spendCapUsd: project.detail.project.capUsd,
          providerCallsAuthorized: false as const,
          versionToken,
        },
        202,
      );
    }),
  );

  app.post("/api/v1/projects/:projectId/approve", (c) =>
    fixtureMutation(c, true, (rawBody, state) => {
      const pathProjectId = c.req.param("projectId");
      const approvalRequest = readFinalApprovalRequest(rawBody, pathProjectId);
      if (!approvalRequest.ok) return approvalRequest.response;
      const resolved = resolveContextFixture(c);
      if (!resolved.ok) return resolved.response;
      const project = resolveProjectDetail(resolved.scenario, pathProjectId, state.runtimeProjects);
      if (!project.ok) return project.response;
      const versionError = projectVersionError(c, project.detail.project.versionToken);
      if (versionError) return versionError;
      if (project.detail.project.status === "APPROVED") {
        return problemResponse(
          apiProblem(
            "PROJECT_ALREADY_APPROVED",
            409,
            "Project is already approved",
            "The approved fixture revision and its selected candidate are immutable.",
            false,
          ),
        );
      }
      if (
        project.detail.project.status !== "READY_FOR_REVIEW" ||
        project.detail.project.review.state !== "READY_FOR_REVIEW" ||
        project.detail.project.review.candidateId === null ||
        project.detail.project.review.candidateSha256 === null
      ) {
        return problemResponse(
          apiProblem(
            "PROJECT_NOT_READY_FOR_APPROVAL",
            409,
            "Project is not ready for approval",
            "A technically valid review candidate must exist before explicit approval.",
            false,
          ),
        );
      }
      if (approvalRequest.candidateId !== project.detail.project.review.candidateId) {
        return problemResponse(
          apiProblem(
            "REVIEW_CANDIDATE_CONFLICT",
            409,
            "Review candidate has changed",
            `Approve the exact current candidate '${project.detail.project.review.candidateId}'.`,
            false,
          ),
        );
      }
      if (approvalRequest.candidateSha256 !== project.detail.project.review.candidateSha256) {
        return problemResponse(
          apiProblem(
            "REVIEW_CANDIDATE_CHECKSUM_CONFLICT",
            409,
            "Review candidate checksum has changed",
            "Refresh the candidate and approve its exact current SHA-256 checksum.",
            false,
          ),
        );
      }
      const approved = structuredClone(project.detail);
      approved.project.status = "APPROVED";
      approved.project.stage = "APPROVED";
      approved.project.completed = 100;
      approved.project.eta = "Ready";
      approved.project.queuePosition = null;
      approved.project.review = {
        ...approved.project.review,
        candidateId: approvalRequest.candidateId,
        candidateSha256: approvalRequest.candidateSha256,
        state: "APPROVED",
        flaggedDefect: null,
        downloadUrl: `/api/v1/projects/${encodeURIComponent(pathProjectId)}/download?fixture=${encodeURIComponent(resolved.id)}`,
      };
      approved.project.allowedActions = ["REVIEW", "DOWNLOAD"];
      approved.project.latestArtifact = approved.project.latestArtifact
        ? {
            ...approved.project.latestArtifact,
            kind: "IMAGE",
            url: "/fixtures/media/watermelon-market.svg",
            label: "Approved synthetic contact sheet",
          }
        : null;
      approved.notice = {
        tone: "SUCCESS",
        title: "Final revision approved",
        detail:
          "The selected candidate is immutable. A synthetic preview is available; real MP4 rendering remains in Phase 0C.",
        action: "Download fixture preview",
        scope: "PROJECT",
      };
      approved.events.push({
        id: `event_fixture_approval_${approved.events.length + 1}`,
        detail: `Candidate ${approvalRequest.candidateId} approved at ${approvalRequest.candidateSha256}`,
        at: "2026-08-09T09:36:00.000Z",
      });
      const versionToken = rotateProjectVersion(approved);
      putRuntimeProject(state.runtimeProjects, resolved.id, approved);
      c.header("etag", versionToken);
      return c.json({
        ok: true as const,
        id: approved.project.id,
        status: "APPROVED" as const,
        candidateId: approvalRequest.candidateId,
        candidateSha256: approvalRequest.candidateSha256,
        downloadUrl: approved.project.review.downloadUrl,
        versionToken,
      });
    }),
  );

  app.notFound(() =>
    problemResponse(
      apiProblem(
        "API_ROUTE_NOT_FOUND",
        404,
        "API route not found",
        "The requested fixture API route does not exist.",
        false,
      ),
    ),
  );

  app.onError((error) => {
    console.error(
      "VideoForge fixture API error",
      error instanceof Error ? error.message : "unknown error",
    );
    return problemResponse(
      apiProblem(
        "FIXTURE_API_INTERNAL_ERROR",
        500,
        "Fixture API failed",
        "The local synthetic API encountered an unexpected error.",
        true,
      ),
    );
  });

  return app;
}

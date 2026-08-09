import { createProjectRequestSchema, type CreateProjectRequest } from "@videoforge/contracts";
import {
  DEFAULT_FIXTURE_SCENARIO_ID,
  FIXTURE_SCENARIO_IDS,
  listFixtureScenarios,
  toAvatarProfileResponse,
  toBootstrapResponse,
  toImageStyleResponse,
  toProjectDetailResponse,
  toProjectSummaryResponse,
  toUsageSummaryResponse,
  type FixtureProjectDetailResponse,
  type FixtureScenario,
} from "@videoforge/test-fixtures";
import { Hono, type Context } from "hono";

import { fixtureFromRequest, resolveFixture, safeCommit, type FixtureResolution } from "./fixture";
import { apiProblem, problemResponse } from "./problem";

function resolveContextFixture(c: Context): FixtureResolution {
  return fixtureFromRequest(c.req.raw);
}

type ProjectDetailResolution =
  | { ok: true; detail: FixtureProjectDetailResponse }
  | { ok: false; response: Response };

function resolveProjectDetail(
  scenario: FixtureScenario,
  projectId: string,
): ProjectDetailResolution {
  const detail = toProjectDetailResponse(scenario);
  if (detail === null || detail.project.id !== projectId) {
    return {
      ok: false,
      response: problemResponse(
        apiProblem(
          "PROJECT_NOT_FOUND",
          404,
          "Project not found",
          `Project '${projectId}' is not present in fixture '${scenario.id}'.`,
          false,
        ),
      ),
    };
  }
  return { ok: true, detail };
}

type CreateProjectRequestResolution =
  | { ok: true; data: CreateProjectRequest }
  | { ok: false; response: Response };

async function readCreateProjectRequest(c: Context): Promise<CreateProjectRequestResolution> {
  let payload: unknown;
  try {
    payload = await c.req.json();
  } catch {
    return {
      ok: false,
      response: problemResponse(
        apiProblem(
          "INVALID_JSON",
          400,
          "Request body is not valid JSON",
          "Send one JSON object as the request body.",
          false,
        ),
      ),
    };
  }
  const result = createProjectRequestSchema.safeParse(payload);
  if (!result.success) {
    return {
      ok: false,
      response: problemResponse(
        apiProblem(
          "INVALID_CREATE_PROJECT_REQUEST",
          422,
          "Create Project request is invalid",
          "The request does not satisfy create-project-request/v2.",
          false,
        ),
        result.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
          code: issue.code,
        })),
      ),
    };
  }
  return { ok: true, data: result.data };
}

function mutationHeadersError(c: Context, requireVersion = false): Response | null {
  if (!c.req.header("idempotency-key")) {
    return problemResponse(
      apiProblem(
        "IDEMPOTENCY_KEY_REQUIRED",
        400,
        "Idempotency-Key header is required",
        "Fixture mutations require a stable Idempotency-Key so duplicate clicks remain safe.",
        false,
      ),
    );
  }
  if (requireVersion && !c.req.header("if-match")) {
    return problemResponse(
      apiProblem(
        "IF_MATCH_REQUIRED",
        428,
        "If-Match header is required",
        "This fixture mutation requires the exact current candidate/version token.",
        false,
      ),
    );
  }
  return null;
}

export function createApiApp(options: { commit?: string } = {}): Hono {
  const app = new Hono();
  const commit = safeCommit(options.commit ?? process.env.VIDEOFORGE_COMMIT);

  app.use("/api/*", async (c, next) => {
    await next();
    c.header("cache-control", "no-store");
    c.header("x-videoforge-provider-mode", "fixture");
    c.header("x-videoforge-synthetic", "true");
  });

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

  app.get("/api/v1/bootstrap", (c) => {
    const resolved = resolveContextFixture(c);
    if (!resolved.ok) return resolved.response;
    return c.json(toBootstrapResponse(resolved.scenario));
  });

  app.get("/api/v1/avatar-profiles", (c) => {
    const resolved = resolveContextFixture(c);
    if (!resolved.ok) return resolved.response;
    return c.json(resolved.scenario.snapshot.avatarHub.profiles.map(toAvatarProfileResponse));
  });

  app.get("/api/v1/image-styles", (c) => {
    const resolved = resolveContextFixture(c);
    if (!resolved.ok) return resolved.response;
    return c.json(resolved.scenario.snapshot.imageStyles.styles.map(toImageStyleResponse));
  });

  app.get("/api/v1/projects", (c) => {
    const resolved = resolveContextFixture(c);
    if (!resolved.ok) return resolved.response;
    const project = resolved.scenario.snapshot.project;
    return c.json(
      project === null
        ? []
        : [toProjectSummaryResponse(project, resolved.scenario.snapshot.draft.generationMode)],
    );
  });

  app.get("/api/v1/projects/:projectId", (c) => {
    const resolved = resolveContextFixture(c);
    if (!resolved.ok) return resolved.response;
    const project = resolveProjectDetail(resolved.scenario, c.req.param("projectId"));
    if (!project.ok) return project.response;
    return c.json(project.detail);
  });

  app.get("/api/v1/projects/:projectId/events", (c) => {
    const resolved = resolveContextFixture(c);
    if (!resolved.ok) return resolved.response;
    const project = resolveProjectDetail(resolved.scenario, c.req.param("projectId"));
    if (!project.ok) return project.response;
    return c.json(project.detail.events);
  });

  app.get("/api/v1/usage", (c) => {
    const resolved = resolveContextFixture(c);
    if (!resolved.ok) return resolved.response;
    return c.json(toUsageSummaryResponse(resolved.scenario));
  });

  app.post("/api/v1/projects/preflight", async (c) => {
    const headersError = mutationHeadersError(c);
    if (headersError) return headersError;
    const resolved = resolveContextFixture(c);
    if (!resolved.ok) return resolved.response;
    const request = await readCreateProjectRequest(c);
    if (!request.ok) return request.response;
    if (resolved.scenario.snapshot.mutationProblem) {
      return problemResponse(resolved.scenario.snapshot.mutationProblem);
    }
    return c.json({
      ok: true as const,
      status: "READY" as const,
      fixture: resolved.id,
      avatarProfileVersionId: request.data.avatar_profile_version_id,
      imageStyleVersionId: request.data.image_style_version_id,
      estimatedCostUsd: 0.88,
      spendCapUsd: request.data.spend_cap_usd,
      providerCallsAuthorized: false as const,
    });
  });

  app.post("/api/v1/projects", async (c) => {
    const headersError = mutationHeadersError(c);
    if (headersError) return headersError;
    const resolved = resolveContextFixture(c);
    if (!resolved.ok) return resolved.response;
    const request = await readCreateProjectRequest(c);
    if (!request.ok) return request.response;
    if (resolved.scenario.snapshot.mutationProblem) {
      return problemResponse(resolved.scenario.snapshot.mutationProblem);
    }
    return c.json(
      {
        ok: true as const,
        id: "project_fixture_001",
        revisionId: "revision_fixture_001",
        status: "QUEUED" as const,
        fixture: resolved.id,
        pinned: {
          avatarProfileVersionId: request.data.avatar_profile_version_id,
          imageStyleVersionId: request.data.image_style_version_id,
        },
        providerCallsAuthorized: false as const,
      },
      202,
    );
  });

  app.post("/api/v1/projects/:projectId/cancel", (c) => {
    const headersError = mutationHeadersError(c, true);
    if (headersError) return headersError;
    const resolved = resolveContextFixture(c);
    if (!resolved.ok) return resolved.response;
    const project = resolveProjectDetail(resolved.scenario, c.req.param("projectId"));
    if (!project.ok) return project.response;
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
    return c.json(
      {
        ok: true as const,
        id: project.detail.project.id,
        status: "CANCEL_REQUESTED" as const,
      },
      202,
    );
  });

  app.post("/api/v1/projects/:projectId/retry", (c) => {
    const headersError = mutationHeadersError(c, true);
    if (headersError) return headersError;
    const resolved = resolveContextFixture(c);
    if (!resolved.ok) return resolved.response;
    const project = resolveProjectDetail(resolved.scenario, c.req.param("projectId"));
    if (!project.ok) return project.response;
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
      },
      202,
    );
  });

  app.post("/api/v1/projects/:projectId/approve", (c) => {
    const headersError = mutationHeadersError(c, true);
    if (headersError) return headersError;
    const resolved = resolveContextFixture(c);
    if (!resolved.ok) return resolved.response;
    const project = resolveProjectDetail(resolved.scenario, c.req.param("projectId"));
    if (!project.ok) return project.response;
    if (
      project.detail.project.status !== "READY_FOR_REVIEW" &&
      project.detail.project.status !== "APPROVED"
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
    return c.json({
      ok: true as const,
      id: project.detail.project.id,
      status: "APPROVED" as const,
    });
  });

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

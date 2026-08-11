import {
  ImageStyleDerivedArtifactEditService,
  ImageStyleDerivedEditError,
  PGliteImageStyleDerivedEditPersistence,
  type EditedImageStyleProfile,
  type ImageStyleDerivedEditErrorCode,
  type TransactionalSqlExecutor,
} from "@videoforge/control-plane";
import type {
  AuthProblem,
  AuthWorkspaceBoundary,
  WorkspaceAuthorizationRequest,
} from "@videoforge/control-plane/auth";
import {
  IMAGE_STYLE_EDIT_RESPONSE_VERSION,
  formatImageStyleEditVersionTag,
  imageStyleEditProblemSchema,
  imageStyleEditRequestSchema,
  imageStyleEditResponseSchema,
  parseImageStyleEditVersionTag,
  type ImageStyleEditProblemCode,
  type ImageStyleEditResponse,
} from "@videoforge/contracts/image-style-edit";
import { Hono } from "hono";

import { apiErrorBody, apiProblem } from "./problem";

const WORKSPACE_HEADER = "x-videoforge-workspace-id";
const BEARER_PREFIX = "Bearer ";
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/u;
const IDEMPOTENCY_KEY = /^[\x21-\x7e]{1,240}$/u;

export interface ImageStyleEditApiClock {
  nowIso(): string;
}

export interface ImageStyleEditApiAppOptions {
  readonly authorization: Pick<AuthWorkspaceBoundary, "authorizeWorkspace">;
  readonly editService: Pick<ImageStyleDerivedArtifactEditService, "edit">;
  readonly clock: ImageStyleEditApiClock;
}

export interface PGliteImageStyleEditApiAppOptions {
  readonly authorization: Pick<AuthWorkspaceBoundary, "authorizeWorkspace">;
  readonly database: TransactionalSqlExecutor;
  readonly clock: ImageStyleEditApiClock;
}

interface ProblemDefinition {
  readonly status: number;
  readonly title: string;
  readonly retryable: boolean;
}

const DOMAIN_PROBLEMS: Readonly<Record<ImageStyleDerivedEditErrorCode, ProblemDefinition>> = {
  AUTHORIZATION_REQUIRED: {
    status: 403,
    title: "Workspace authorization is required",
    retryable: false,
  },
  IDEMPOTENCY_CONFLICT: {
    status: 409,
    title: "Idempotency key conflicts with an earlier edit",
    retryable: false,
  },
  INPUT_INVALID: { status: 422, title: "Image Style edit input is invalid", retryable: false },
  LINEAGE_INVALID: {
    status: 409,
    title: "Image Style profile lineage is invalid",
    retryable: false,
  },
  PROFILE_INVALID: {
    status: 422,
    title: "Image Style candidate profile is invalid",
    retryable: false,
  },
  REPOSITORY_FAILURE: {
    status: 500,
    title: "Image Style edit transaction failed",
    retryable: true,
  },
  STYLE_NOT_FOUND: { status: 404, title: "Image Style version was not found", retryable: false },
  STYLE_PROFILE_NO_CHANGES: {
    status: 422,
    title: "Image Style candidate has no changes",
    retryable: false,
  },
  STYLE_VERSION_CONFLICT: {
    status: 412,
    title: "Image Style version authority is stale",
    retryable: false,
  },
  STYLE_VERSION_IMMUTABLE: {
    status: 409,
    title: "Image Style version is immutable",
    retryable: false,
  },
};

function bearerSessionToken(headers: Headers): string | null {
  const value = headers.get("authorization");
  if (value === null || !value.startsWith(BEARER_PREFIX)) return null;
  const token = value.slice(BEARER_PREFIX.length);
  return token.length > 0 ? token : null;
}

function authorizationRequest(headers: Headers): WorkspaceAuthorizationRequest {
  return {
    sessionToken: bearerSessionToken(headers) ?? "",
    workspaceId: headers.get(WORKSPACE_HEADER) ?? "",
  };
}

function respond(
  code: ImageStyleEditProblemCode,
  status: number,
  title: string,
  detail: string,
  retryable: boolean,
  issues?: unknown,
): Response {
  const body = imageStyleEditProblemSchema.parse(
    apiErrorBody(apiProblem(code, status, title, detail, retryable), issues),
  );
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/problem+json; charset=UTF-8",
    },
  });
}

function authProblemResponse(problem: AuthProblem): Response {
  return respond(problem.code, problem.status, problem.title, problem.detail, problem.retryable);
}

function domainProblemResponse(error: ImageStyleDerivedEditError): Response {
  const definition = DOMAIN_PROBLEMS[error.code];
  return respond(
    error.code,
    definition.status,
    definition.title,
    error.message,
    definition.retryable,
  );
}

function resultResponse(result: EditedImageStyleProfile): ImageStyleEditResponse {
  return imageStyleEditResponseSchema.parse({
    schema_version: IMAGE_STYLE_EDIT_RESPONSE_VERSION,
    edit: {
      style_id: result.styleId,
      version_id: result.versionId,
      edit_id: result.editId,
      root_source_artifact_id: result.rootSourceArtifactId,
      root_source_artifact_hash: result.rootSourceArtifactHash,
      parent_artifact_id: result.parentArtifactId,
      parent_artifact_hash: result.parentArtifactHash,
      current_artifact_id: result.derivedArtifactId,
      current_artifact_hash: result.derivedArtifactHash,
      changed_pointers: result.changedPointers,
      prior_revision: result.priorRevision,
      result_revision: result.resultRevision,
      invalidated_review_snapshot_id: result.invalidatedReviewSnapshotId,
      edited_at: result.editedAt,
      replayed: result.replayed,
    },
  });
}

/** Authenticated provider-free API for one full-candidate manual Image Style edit. */
export function createImageStyleEditApiApp(options: ImageStyleEditApiAppOptions): Hono {
  const app = new Hono();

  app.patch("/api/v1/image-styles/:style_id/versions/:version_id", async (context) => {
    const authorization = await options.authorization.authorizeWorkspace(
      authorizationRequest(context.req.raw.headers),
    );
    if (!authorization.ok) return authProblemResponse(authorization.problem);

    const styleId = context.req.param("style_id");
    const versionId = context.req.param("version_id");
    if (!IDENTIFIER.test(styleId) || !IDENTIFIER.test(versionId)) {
      return respond(
        "INVALID_IMAGE_STYLE_EDIT_REQUEST",
        422,
        "Image Style edit request is invalid",
        "Style and version identifiers must use the canonical identifier format.",
        false,
      );
    }

    const idempotencyKey = context.req.header("idempotency-key") ?? "";
    if (!IDEMPOTENCY_KEY.test(idempotencyKey)) {
      return respond(
        "IDEMPOTENCY_KEY_REQUIRED",
        400,
        "Idempotency key is required",
        "Supply one non-empty printable Idempotency-Key no longer than 240 bytes.",
        false,
      );
    }

    const ifMatch = context.req.header("if-match");
    if (ifMatch === undefined) {
      return respond(
        "IF_MATCH_REQUIRED",
        428,
        "Current Image Style authority is required",
        "Supply the exact current version tag in If-Match.",
        false,
      );
    }
    const authority = parseImageStyleEditVersionTag(ifMatch);
    if (authority === null) {
      return respond(
        "IF_MATCH_INVALID",
        400,
        "Image Style authority is invalid",
        "If-Match must contain one exact VideoForge Image Style version tag.",
        false,
      );
    }

    let body: unknown;
    try {
      body = JSON.parse(await context.req.text()) as unknown;
    } catch {
      return respond("INVALID_JSON", 400, "JSON body is invalid", "Supply one JSON object.", false);
    }
    const request = imageStyleEditRequestSchema.safeParse(body);
    if (!request.success) {
      return respond(
        "INVALID_IMAGE_STYLE_EDIT_REQUEST",
        422,
        "Image Style edit request is invalid",
        "Supply the complete versioned candidate profile; partial and unknown fields are rejected.",
        false,
        request.error.issues,
      );
    }

    try {
      const edited = await options.editService.edit(
        {
          workspaceId: authorization.value.workspace.workspaceId,
          actorUserId: authorization.value.principal.userId,
        },
        {
          styleId,
          versionId,
          expectedRevision: authority.revision,
          expectedCurrentArtifactHash: authority.currentArtifactHash,
          idempotencyKey,
          candidateProfile: request.data.candidate_profile,
          editedAt: options.clock.nowIso(),
        },
      );
      const response = resultResponse(edited);
      return Response.json(response, {
        status: 200,
        headers: {
          "cache-control": "no-store",
          etag: formatImageStyleEditVersionTag({
            revision: response.edit.result_revision,
            currentArtifactHash: response.edit.current_artifact_hash as `sha256:${string}`,
          }),
          ...(response.edit.replayed ? { "x-videoforge-idempotent-replay": "true" } : {}),
        },
      });
    } catch (error) {
      if (error instanceof ImageStyleDerivedEditError) return domainProblemResponse(error);
      return respond(
        "REPOSITORY_FAILURE",
        500,
        "Image Style edit transaction failed",
        "The edit could not be committed atomically.",
        true,
      );
    }
  });

  return app;
}

/** Production-code composition: the route and service share the durable PGlite transaction. */
export function createPGliteImageStyleEditApiApp(options: PGliteImageStyleEditApiAppOptions): Hono {
  return createImageStyleEditApiApp({
    authorization: options.authorization,
    editService: new ImageStyleDerivedArtifactEditService(
      new PGliteImageStyleDerivedEditPersistence(options.database),
    ),
    clock: options.clock,
  });
}

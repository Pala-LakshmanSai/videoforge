import type {
  AuthProblem,
  AuthWorkspaceBoundary,
  WorkspaceAuthorizationRequest,
} from "@videoforge/control-plane/auth";
import type { ArtifactControlPlanePort } from "@videoforge/pipeline";
import type { Hono } from "hono";

import { apiProblem, problemResponse } from "./problem";
import { createPrivateArtifactControlPlaneApp } from "./routes/private-artifact-routes";

const WORKSPACE_HEADER = "x-videoforge-workspace-id";
const BEARER_PREFIX = "Bearer ";

export interface Phase1PrivateArtifactAppOptions {
  readonly authorization: Pick<AuthWorkspaceBoundary, "authorizeWorkspace">;
  readonly controlPlane: ArtifactControlPlanePort;
}

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

function authProblemResponse(problem: AuthProblem): Response {
  return problemResponse(
    apiProblem(problem.code, problem.status, problem.title, problem.detail, problem.retryable),
  );
}

/**
 * Provider-free Phase 1 composition for private artifact metadata. Authentication is resolved
 * before request bytes are read; the application receives no direct-transfer facet or media body.
 */
export function createPhase1PrivateArtifactApp(options: Phase1PrivateArtifactAppOptions): Hono {
  return createPrivateArtifactControlPlaneApp({
    controlPlane: options.controlPlane,
    authorize: async ({ headers }) => {
      const authorization = await options.authorization.authorizeWorkspace(
        authorizationRequest(headers),
      );
      if (!authorization.ok) {
        return { ok: false, response: authProblemResponse(authorization.problem) };
      }
      return {
        ok: true,
        workspaceId: authorization.value.workspace.workspaceId,
      };
    },
  });
}

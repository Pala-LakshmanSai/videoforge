import type { Hono } from "hono";

import { fixtureFromRequest } from "./fixture";
import { FIXTURE_SESSION_HEADER, type FixtureSessionStore } from "./fixture-session";
import { apiProblem, problemResponse } from "./problem";

export function registerAccessMiddleware(
  app: Hono,
  environment: string,
  fixtureSessions: FixtureSessionStore,
): void {
  app.use("/api/*", async (c, next) => {
    if (environment === "production") {
      return problemResponse(
        apiProblem(
          "API_ROUTE_NOT_FOUND",
          404,
          "API route not found",
          "No production API is registered by this local fixture server.",
          false,
        ),
      );
    }
    await next();
  });

  app.use("/api/*", async (c, next) => {
    const session = fixtureSessions.resolve(c);
    if (!session.ok) return session.response;
    await next();
    c.header("cache-control", "no-store");
    c.header("x-videoforge-provider-mode", "fixture");
    c.header("x-videoforge-synthetic", "true");
    c.header(FIXTURE_SESSION_HEADER, session.id);
  });

  app.use("/api/v1/*", async (c, next) => {
    const resolved = fixtureFromRequest(c.req.raw);
    if (!resolved.ok) return resolved.response;
    if (c.req.path === "/api/v1/bootstrap") {
      await next();
      return;
    }
    if (resolved.scenario.snapshot.access.state !== "AUTHORIZED") {
      return problemResponse(
        apiProblem(
          "WORKSPACE_ACCESS_REQUIRED",
          403,
          "Workspace access is required",
          resolved.scenario.snapshot.access.state === "DENIED"
            ? "This account is not invited to the selected workspace. Try another invited account."
            : "Continue with an invited account before requesting workspace data or actions.",
          false,
        ),
      );
    }
    await next();
  });
}

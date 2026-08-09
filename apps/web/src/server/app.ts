import { Hono } from "hono";

import { registerAccessMiddleware } from "./access-middleware";
import { safeCommit } from "./fixture";
import { FixtureRuntime } from "./fixture-runtime";
import { apiProblem, problemResponse } from "./problem";
import { registerPresetRoutes } from "./routes/preset-routes";
import { registerProjectRoutes } from "./routes/project-routes";
import { registerSystemRoutes } from "./routes/system-routes";
import { registerVoiceoverRoutes } from "./routes/voiceover-routes";

export function createApiApp(
  options: { commit?: string; environment?: "development" | "test" | "production" } = {},
): Hono {
  const app = new Hono();
  const commit = safeCommit(options.commit ?? process.env.VIDEOFORGE_COMMIT);
  const environment = options.environment ?? process.env.NODE_ENV ?? "development";
  const runtime = new FixtureRuntime(environment, commit);

  registerAccessMiddleware(app, environment, runtime.sessions);
  registerSystemRoutes(app, runtime);
  registerPresetRoutes(app, runtime);
  registerVoiceoverRoutes(app, runtime);
  registerProjectRoutes(app, runtime);

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

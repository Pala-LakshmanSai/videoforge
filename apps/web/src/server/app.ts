import { Hono } from "hono";

import { registerAccessMiddleware } from "./access-middleware";
import { safeCommit } from "./fixture";
import { FixtureRuntime } from "./fixture-runtime";
import type { LocalSliceRunner } from "./local/types";
import { apiProblem, problemResponse } from "./problem";
import { registerPresetRoutes } from "./routes/preset-routes";
import { registerProjectRoutes } from "./routes/project-routes";
import { registerStyleHubRoutes } from "./routes/style-hub-routes";
import { registerSystemRoutes } from "./routes/system-routes";
import { registerSharedAppRoutes } from "./routes/shared-app-routes";
import { registerVoiceoverRoutes } from "./routes/voiceover-routes";
import { assertRunnableRuntime } from "./runtime/configuration";
import type { CreateApiAppOptions } from "./runtime/types";

export type { CreateApiAppOptions } from "./runtime/types";

export function createApiApp(options: CreateApiAppOptions): Hono {
  assertRunnableRuntime(options);
  const { bindings, configuration } = options;
  const commit = safeCommit(configuration.commit);
  const { environment, mode } = configuration;
  if (mode === "local" || mode === "sandbox") {
    const factory = mode === "local" ? bindings.localAppFactory! : bindings.sandboxAppFactory!;
    return factory({
      commit,
      environment,
      mode,
      runner: bindings.localRunner as LocalSliceRunner,
    });
  }

  if (mode !== "fixture") {
    throw new Error(`Runtime mode '${mode}' passed validation without an implementation.`);
  }

  const app = new Hono();
  const runtime = new FixtureRuntime(environment, commit, bindings.fixtureSharedAppPersistence);

  registerAccessMiddleware(app, environment, runtime.sessions, runtime.sharedApp);
  registerSystemRoutes(app, runtime);
  registerSharedAppRoutes(app, runtime);
  registerPresetRoutes(app, runtime);
  registerStyleHubRoutes(app, runtime);
  registerVoiceoverRoutes(app, runtime);
  registerProjectRoutes(app, runtime, bindings.fixturePreview!);

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

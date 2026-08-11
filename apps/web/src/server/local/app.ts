import { Hono } from "hono";

import { apiProblem, problemResponse } from "../problem";
import { registerLocalRoutes } from "./routes";
import { LocalRuntime } from "./runtime";
import type { LocalSliceRunner } from "./types";

export interface LocalApiAppOptions {
  readonly commit: string;
  readonly environment: string;
  readonly mode: "local" | "sandbox";
  readonly runner: LocalSliceRunner;
}

export function createLocalApiApp(options: LocalApiAppOptions): Hono {
  const app = new Hono();
  const runtime = new LocalRuntime(
    options.environment,
    options.commit,
    options.mode,
    options.runner,
  );

  app.use("/api/*", async (c, next) => {
    if (options.environment === "production") {
      return problemResponse(
        apiProblem(
          "API_ROUTE_NOT_FOUND",
          404,
          "API route not found",
          "The local walking-slice API is disabled in production.",
          false,
        ),
      );
    }
    await next();
    c.header("cache-control", "no-store");
    c.header("x-videoforge-provider-mode", options.mode);
    c.header("x-videoforge-synthetic", "true");
  });

  registerLocalRoutes(app, runtime);

  app.notFound(() =>
    problemResponse(
      apiProblem(
        "API_ROUTE_NOT_FOUND",
        404,
        "API route not found",
        "The requested local API route does not exist.",
        false,
      ),
    ),
  );
  app.onError((error) => {
    console.error(
      `VideoForge ${options.mode} API error`,
      error instanceof Error ? error.message : "unknown error",
    );
    return problemResponse(
      apiProblem(
        options.mode === "local" ? "LOCAL_API_INTERNAL_ERROR" : "SANDBOX_API_INTERNAL_ERROR",
        500,
        options.mode === "local" ? "Local media API failed" : "Sandbox media API failed",
        `The bounded ${options.mode} walking-slice API encountered an unexpected error.`,
        true,
      ),
    );
  });
  return app;
}

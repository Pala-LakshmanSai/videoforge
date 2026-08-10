import { serve } from "@hono/node-server";

import { createApiApp } from "./server/app";
import { createLocalApiApp } from "./server/local/app";
import { runtimeConfigurationFromEnvironment } from "./server/runtime/configuration";
import { createNodeFixturePreviewBinding } from "./server/runtime/node-fixture-preview";

export const FIXTURE_API_HOST = "127.0.0.1";
export const FIXTURE_API_PORT = 4174;

const configuration = runtimeConfigurationFromEnvironment({
  VIDEOFORGE_COMMIT: process.env.VIDEOFORGE_COMMIT,
  VIDEOFORGE_PROVIDER_MODE: process.env.VIDEOFORGE_PROVIDER_MODE,
  NODE_ENV: process.env.NODE_ENV,
});
const { mode } = configuration;
const localRunner =
  mode === "local"
    ? (await import("./server/local/media-runner")).createLocalMediaPipelineRunner()
    : undefined;
const app = createApiApp({
  configuration,
  bindings: {
    platform: "node",
    fixturePreview: mode === "fixture" ? createNodeFixturePreviewBinding() : undefined,
    localRunner,
    localAppFactory: mode === "local" ? createLocalApiApp : undefined,
  },
});

const server = serve({
  fetch: app.fetch,
  hostname: FIXTURE_API_HOST,
  port: FIXTURE_API_PORT,
});

console.log(`VideoForge ${mode} API listening on http://${FIXTURE_API_HOST}:${FIXTURE_API_PORT}`);

function shutdown(signal: string): void {
  console.log(`VideoForge ${mode} API received ${signal}; closing`);
  server.close((error) => {
    if (error) {
      console.error(`VideoForge ${mode} API close failed`, error.message);
      process.exitCode = 1;
    }
  });
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

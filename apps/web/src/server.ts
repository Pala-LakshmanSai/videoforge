import { serve } from "@hono/node-server";
import path from "node:path";

import { createApiApp } from "./server/app";
import { createLocalApiApp } from "./server/local/app";
import { createNodeFixturePreviewBinding } from "./server/runtime/node-fixture-preview";
import { createNodeRuntimeConfiguration } from "./server/runtime/node";
import { resolveNodeSandboxDataRoot } from "./server/runtime/node-sandbox";

export const FIXTURE_API_HOST = "127.0.0.1";
export const FIXTURE_API_PORT = 4174;
const WORKSPACE_ROOT = path.resolve(import.meta.dirname, "../../..");

const configuration = createNodeRuntimeConfiguration(process.env);
const { mode } = configuration;
let localRunner;
if (mode === "local" || mode === "sandbox") {
  const { createLocalMediaPipelineRunner } = await import("./server/local/media-runner");
  localRunner =
    mode === "sandbox"
      ? createLocalMediaPipelineRunner({
          artifactRoot: resolveNodeSandboxDataRoot(process.env, WORKSPACE_ROOT),
        })
      : createLocalMediaPipelineRunner();
}
const app = createApiApp({
  configuration,
  bindings: {
    platform: "node",
    fixturePreview: mode === "fixture" ? createNodeFixturePreviewBinding() : undefined,
    localRunner,
    localAppFactory: mode === "local" ? createLocalApiApp : undefined,
    sandboxAppFactory: mode === "sandbox" ? createLocalApiApp : undefined,
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

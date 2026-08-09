import { serve } from "@hono/node-server";

import { createApiApp } from "./server/app";

export const FIXTURE_API_HOST = "127.0.0.1";
export const FIXTURE_API_PORT = 4174;

const mode = process.env.VIDEOFORGE_PROVIDER_MODE === "local" ? "local" : "fixture";
const localRunner =
  mode === "local"
    ? (await import("./server/local/media-runner")).createLocalMediaPipelineRunner()
    : undefined;
const app = createApiApp({ mode, localRunner });

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

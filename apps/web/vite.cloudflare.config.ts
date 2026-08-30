import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig(({ command }) => {
  const requestedMode = process.env.VITE_VIDEOFORGE_PROVIDER_MODE;
  const providerMode = requestedMode ?? (command === "build" ? "production" : "fixture");
  if (!["fixture", "staging", "production"].includes(providerMode)) {
    throw new Error(`Unsupported Cloudflare provider mode: ${providerMode}`);
  }
  const configPath =
    providerMode === "staging"
      ? "./wrangler.staging.jsonc"
      : providerMode === "production"
        ? "./wrangler.production.jsonc"
        : "./wrangler.jsonc";
  const hostedApiPath = fileURLToPath(new URL("./src/lib/api.hosted.ts", import.meta.url));
  const hostedApiSchemasPath = fileURLToPath(
    new URL("./src/lib/api-schemas.hosted.ts", import.meta.url),
  );

  return {
    // Hosted staging and production serve only bundled application assets. The owned fixture
    // gallery and fixture API exist only in local fixture mode.
    publicDir: providerMode === "fixture" ? "public" : false,
    build: { manifest: true },
    resolve: {
      alias:
        providerMode !== "fixture"
          ? [
              { find: /^\.\.\/lib\/api$/u, replacement: hostedApiPath },
              { find: /^\.\.\/lib\/api-schemas$/u, replacement: hostedApiSchemasPath },
            ]
          : [],
    },
    define: {
      "import.meta.env.VITE_VIDEOFORGE_PROVIDER_MODE": JSON.stringify(providerMode),
    },
    plugins: [
      tanstackRouter({ target: "react", autoCodeSplitting: true }),
      react(),
      cloudflare({ configPath }),
    ],
    server: {
      host: "127.0.0.1",
      port: 4173,
      strictPort: true,
    },
    preview: {
      host: "127.0.0.1",
      port: 4173,
      strictPort: true,
    },
  };
});

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
    // Production serves only bundled application assets. Development/staging retain the owned
    // fixture gallery, but it must never be copied into the production artifact tree.
    publicDir: providerMode === "production" ? false : "public",
    build: { manifest: true },
    resolve: {
      alias:
        providerMode === "production"
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

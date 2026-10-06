import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig, transformWithEsbuild, type Plugin } from "vite";

/** Compact the prompt owner while preserving diagnostic names and canonical string values. */
export function minifyHostedPromptRouteChunk(code: string, name: string, fileName: string) {
  if (!["hosted-prompt-route", "compiler", "runware-http-transport"].includes(name)) return null;
  return transformWithEsbuild(code, fileName, {
    target: "esnext",
    minifyWhitespace: true,
    minifyIdentifiers: name === "hosted-prompt-route",
    keepNames: name === "hosted-prompt-route",
    minifySyntax: name === "hosted-prompt-route",
    legalComments: "inline",
  });
}

function hostedPromptWhitespacePlugin(): Plugin {
  return {
    name: "hosted-prompt-route-whitespace",
    apply: "build",
    renderChunk: {
      order: "post",
      async handler(code, chunk) {
        const transformed = await minifyHostedPromptRouteChunk(code, chunk.name, chunk.fileName);
        return transformed
          ? { code: transformed.code, map: JSON.stringify(transformed.map) }
          : null;
      },
    },
  };
}

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
      ...(providerMode === "fixture" ? [] : [hostedPromptWhitespacePlugin()]),
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

import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    cloudflare({
      configPath:
        process.env.VITE_VIDEOFORGE_PROVIDER_MODE === "staging"
          ? "./wrangler.staging.jsonc"
          : command === "build"
            ? "./wrangler.production.jsonc"
            : "./wrangler.jsonc",
    }),
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
}));

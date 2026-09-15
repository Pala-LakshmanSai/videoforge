import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // `cloudflare:workers` is provided by workerd at runtime. Map it to the local stub so Worker
      // entrypoints (Workflow classes) can be constructed in vitest with a fake step recorder.
      "cloudflare:workers": fileURLToPath(
        new URL("./worker/vitest-cloudflare-workers-stub.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    include: [
      "src/**/*.test.{ts,tsx}",
      "tests/unit/**/*.test.{ts,tsx}",
      "worker/**/*.test.{ts,tsx}",
    ],
    // Several runtime suites each open a full PGlite WASM database. Three concurrent instances can
    // abort inside WASM under desktop/CI memory pressure, so keep the canonical lane bounded.
    maxWorkers: 2,
  },
});

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "tests/unit/**/*.test.{ts,tsx}"],
    // Several runtime suites each open a full PGlite WASM database. Three concurrent instances can
    // abort inside WASM under desktop/CI memory pressure, so keep the canonical lane bounded.
    maxWorkers: 2,
  },
});

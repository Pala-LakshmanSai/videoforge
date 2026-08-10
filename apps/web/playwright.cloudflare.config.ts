import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "runtime-parity.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
  },
  webServer: {
    command: "pnpm --dir ../.. dev:cloudflare",
    url: "http://127.0.0.1:4173/api/health?fixture=project_create_ready",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});

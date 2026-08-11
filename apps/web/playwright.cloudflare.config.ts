import { defineConfig, type ReporterDescription } from "@playwright/test";

const reporter: ReporterDescription[] = process.env.CI
  ? [
      ["list"],
      ["junit", { outputFile: "test-results/workerd-junit.xml" }],
      ["html", { open: "never", outputFolder: "playwright-workerd-report" }],
    ]
  : [["list"]];

export default defineConfig({
  testDir: "./tests",
  testMatch: "runtime-parity.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter,
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

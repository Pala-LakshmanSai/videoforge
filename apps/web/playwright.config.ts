import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 2,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:4173",
    channel: "chrome",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop-chrome", use: { ...devices["Desktop Chrome"] } },
    { name: "compact-chrome", use: { viewport: { width: 1024, height: 900 } } },
  ],
  webServer: {
    command: "pnpm --dir ../.. dev",
    url: "http://localhost:4173/api/health",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});

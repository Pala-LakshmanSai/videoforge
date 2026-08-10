import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 2,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: "http://localhost:4173",
    channel: "chrome",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop-chrome", use: { ...devices["Desktop Chrome"] } },
    {
      name: "compact-chrome",
      grepInvert: /@viewport-matrix/u,
      use: { viewport: { width: 1024, height: 900 } },
    },
  ],
  webServer: {
    command: "pnpm --dir ../.. dev",
    url: "http://localhost:4173/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});

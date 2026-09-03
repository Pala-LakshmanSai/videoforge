import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "hosted-product-router.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    channel: "chrome",
    serviceWorkers: "block",
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "VITE_VIDEOFORGE_PROVIDER_MODE=staging pnpm exec vite --host 127.0.0.1 --port 4173 --strictPort",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});

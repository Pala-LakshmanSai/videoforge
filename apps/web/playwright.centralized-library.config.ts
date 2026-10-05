import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "centralized-library.spec.ts",
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4185",
    channel: "chrome",
    serviceWorkers: "block",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "panel", use: { viewport: { width: 977, height: 900 } } },
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    { name: "mobile", use: { viewport: { width: 320, height: 760 } } },
  ],
  webServer: {
    command:
      "VITE_VIDEOFORGE_PROVIDER_MODE=staging pnpm exec vite --host 127.0.0.1 --port 4185 --strictPort",
    url: "http://127.0.0.1:4185",
    reuseExistingServer: false,
  },
});

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

const artifactRoot = mkdtempSync(path.join(tmpdir(), "videoforge-vf-2-05-chrome-"));

export default defineConfig({
  testDir: "./tests/local-e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 6 * 60 * 1_000,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:4173",
    channel: "chrome",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "pnpm --dir ../.. dev:local",
    url: "http://localhost:4173/api/health",
    reuseExistingServer: false,
    timeout: 120_000,
    env: { VIDEOFORGE_LOCAL_ARTIFACT_ROOT: artifactRoot },
  },
});

import { expect, test } from "@playwright/test";

const attemptId = "11111111-1111-4111-8111-111111111111";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/v2/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/v2/tenant") {
      return route.fulfill({
        json: {
          account_id: "22222222-2222-4222-8222-222222222222",
          workspace_id: "33333333-3333-4333-8333-333333333333",
          workspace_name: "Chrome private workspace",
          user: { email: "owner@example.test", name: "Owner" },
        },
      });
    }
    if (path === "/api/v2/hosted/status") {
      return route.fulfill({ json: { authentication: ["GOOGLE"], commit: "local-chrome" } });
    }
    if (path === "/api/v2/hosted/queue") {
      return route.fulfill({
        json: {
          schema_version: "videoforge-hosted-queue/v1",
          worker_state: "ONLINE",
          attempts: [
            {
              id: attemptId,
              project_id: "44444444-4444-4222-8222-444444444444",
              title: "Chrome-owned render",
              kind: "RENDER",
              state: "RUNNING",
              created_at: "2026-08-17T10:00:00.000Z",
              updated_at: "2026-08-17T10:01:00.000Z",
            },
          ],
        },
      });
    }
    if (path === "/api/v2/media-workers") {
      return route.fulfill({
        json: {
          schema_version: "videoforge-media-worker-list/v1",
          devices: [
            {
              id: "55555555-5555-4555-8555-555555555555",
              display_name: "Chrome test computer",
              platform: "MACOS",
              architecture: "AARCH64",
              worker_version: "0.1.0",
              protocol_version: 1,
              status: "ONLINE",
              last_seen_at: "2026-08-17T10:02:00.000Z",
              current_attempt_id: attemptId,
            },
          ],
          release: {
            version: "0.1.0",
            minimum_protocol_version: 1,
            windows: {
              url: "https://downloads.example.test/worker.exe",
              sha256: `sha256:${"a".repeat(64)}`,
              size_bytes: 20_000_000,
              trust: "UNSIGNED_BETA",
            },
            macos: {
              url: "https://downloads.example.test/worker.dmg",
              sha256: `sha256:${"b".repeat(64)}`,
              size_bytes: 24_000_000,
              trust: "AD_HOC_BETA",
            },
          },
        },
      });
    }
    if (path === "/api/v2/library") {
      return route.fulfill({
        json: { schema_version: "videoforge-hosted-library/v1", outputs: [] },
      });
    }
    if (path === `/api/v2/cpu-attempts/${attemptId}` && request.method() === "POST") {
      return route.fulfill({ status: 202, json: { id: attemptId, state: "CANCEL_REQUESTED" } });
    }
    return route.fulfill({ status: 404, json: { error: { code: "TEST_ROUTE_NOT_FOUND" } } });
  });
});

test("hosted auth mounts the product router and account-owned worker surfaces", async ({
  page,
}) => {
  let cancelled = false;
  await page.route(`**/api/v2/cpu-attempts/${attemptId}`, async (route) => {
    cancelled = route.request().method() === "POST";
    await route.fulfill({ status: 202, json: { id: attemptId, state: "CANCEL_REQUESTED" } });
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Queue" })).toBeVisible();
  await expect(page.getByText("Chrome-owned render")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
  await expect(page.getByText("Hosted runtime unavailable · fixtures are not live")).toHaveCount(0);

  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByText("Chrome test computer")).toBeVisible();
  await expect(page.getByRole("link", { name: /Download for Windows/u })).toBeVisible();
  await expect(page.getByRole("link", { name: /Download for Mac/u })).toBeVisible();

  await page.getByRole("link", { name: "Queue", exact: true }).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect.poll(() => cancelled).toBe(true);
});

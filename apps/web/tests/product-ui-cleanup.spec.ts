import { expect, test } from "@playwright/test";

const projectId = "11111111-1111-4111-8111-111111111111";
const stages = [
  ["transcription", "Transcribe voiceover"],
  ["voiceover-context", "Understand voiceover context"],
  ["planning", "Plan scenes"],
  ["prompt-writing", "Write image prompts"],
  ["audio-spanning", "Audio spanning"],
  ["image-generation", "Generate images"],
  ["avatar-generation", "Generate avatar"],
  ["video-generation", "Generate scene videos"],
  ["render", "Assemble final video"],
];

for (const owner of [true, false]) {
  test(`all-account UI cleanup and automatic updates, owner=${owner}`, async ({ page }, info) => {
    let reads = 0;
    const mutations: string[] = [];
    const consoleErrors: string[] = [];
    page.on("pageerror", (error) => consoleErrors.push(error.message));
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (!["GET", "HEAD"].includes(request.method())) mutations.push(path);
      if (path === "/api/v2/tenant")
        return route.fulfill({
          json: {
            schema_version: "videoforge-hosted-tenant/v1",
            account_id: "22222222-2222-4222-8222-222222222222",
            workspace_id: "33333333-3333-4333-8333-333333333333",
            workspace_name: "Private studio",
            can_manage_team: owner,
            can_view_centralized_library: owner,
            user: { id: "user", name: "Studio creator", email: "creator@example.test" },
          },
        });
      if (path === "/api/v2/hosted/status")
        return route.fulfill({
          json: {
            environment: "staging",
            commit: "product-ui-cleanup-fixture",
            authentication: ["GOOGLE"],
          },
        });
      if (path === "/api/v2/hosted/projects")
        return route.fulfill({ json: { projects: [{ id: projectId }] } });
      if (path === "/api/v2/hosted/queue")
        return route.fulfill({
          json: {
            schema_version: "videoforge-hosted-queue/v2",
            worker_state: "ONLINE",
            cloud_media_available: true,
            projects: [
              {
                project_id: projectId,
                title: "Private film",
                state: "ACTION_REQUIRED",
                stage: "Complete",
                execution_backend: "RUNPOD_POD",
                cloud_phase: "COMPLETE",
                latest_job_state: "SUCCEEDED",
                cancellable_attempt_id: null,
                created_at: "2026-10-05T09:00:00Z",
                updated_at: "2026-10-05T09:17:00Z",
              },
            ],
          },
        });
      if (path === `/api/v2/hosted/projects/${projectId}`) {
        const complete = ++reads > 1;
        return route.fulfill({
          json: {
            project: {
              id: projectId,
              title: "Private film",
              revision_id: "revision",
              revision_state: "LOCKED",
              created_at: "2026-10-05T09:00:00Z",
              media_execution_backend: "RUNPOD_POD",
            },
            generation_provider: "KIE_FAL",
            generation: null,
            attempts: complete
              ? [
                  {
                    id: "render",
                    kind: "RENDER",
                    state: "SUCCEEDED",
                    execution_backend: "RUNPOD_POD",
                    cloud_phase: "COMPLETE",
                    preview_url: "/verified-film.mp4",
                    terminal_at: "2026-10-05T09:17:00Z",
                  },
                ]
              : [],
            stages: stages.map(([id, name]) => ({
              id,
              name,
              status:
                ["render", "video-generation"].includes(id!) && !complete ? "RUNNING" : "COMPLETE",
              progress_percent: complete ? 100 : 40,
              started_at: "2026-10-05T09:00:00Z",
              completed_at: complete ? "2026-10-05T09:02:31Z" : null,
              detail: id === "video-generation" ? `${complete ? 5 : 2} of 5 clips accepted` : null,
            })),
            gpu_readiness: { state: "DISABLED_UNQUALIFIED", lanes: [] },
            review: complete
              ? {
                  state: "COMPLETE",
                  download_url: "/verified-film.mp4",
                  manifest_url: "/verified-manifest.json",
                }
              : null,
            cost: {
              projected_usd: 1.16,
              api_estimate: {
                kie_images: 36,
                kie_usd: 0.36,
                fal_avatar_seconds: 37.8,
                fal_usd: 0.8,
                pricing_checked_at: "2026-10-05",
              },
              api_cost_so_far: {
                usd: 1.16,
                estimated: true,
                unconfirmed: false,
                breakdown: [{ label: "Images", usd: 0.36, estimated: false }],
              },
              cloud_compute: {
                observed_at: "2026-10-05T09:17:00Z",
                rentals: [
                  {
                    id: "rental",
                    machine: "RTX 4090",
                    hourly_usd: 0.8,
                    started_at: "2026-10-05T09:00:00Z",
                    stopped_at: "2026-10-05T09:09:00Z",
                    status: "STOPPED",
                  },
                ],
              },
            },
          },
        });
      }
      if (path === "/api/v2/voiceovers/voices")
        return route.fulfill({
          json: {
            voices: [
              {
                voice_id: "alice",
                name: "Alice",
                tags: "Female, Calm",
                languages: "gb",
                saved: true,
                starred: true,
                preview_url: null,
              },
              {
                voice_id: "bob",
                name: "Bob",
                tags: "Male, Deep",
                languages: "us",
                saved: false,
                starred: false,
                preview_url: null,
              },
            ],
          },
        });
      return route.fulfill({ status: 404, json: { error: { code: "FIXTURE_UNSUPPORTED" } } });
    });
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Open Private film" })).toBeVisible();
    await expect(page.getByText(/work pauses safely if your computer disconnects/i)).toHaveCount(0);
    const dock = page.getByRole("navigation", { name: "Primary navigation" });
    await expect(dock.getByRole("link", { name: "Usage", exact: true })).toHaveCount(0);
    await expect(page.getByText("API healthy", { exact: true })).toHaveCount(0);
    await expect(dock.getByRole("link", { name: "Centralized Library", exact: true })).toHaveCount(
      owner ? 1 : 0,
    );
    await page.goto(`/projects/${projectId}`);
    const hero = page.getByRole("region", { name: "Live video progress" });
    await expect(hero).toBeVisible();
    await expect(hero.getByText("Estimated", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Refresh now", exact: true })).toHaveCount(0);
    const videoBar = page.getByRole("progressbar", { name: "Scene videos progress" });
    await expect(videoBar).toHaveAttribute("aria-valuenow", "40");
    await expect(videoBar.locator("..")).toContainText("Generating");
    await expect(hero.getByText("Video complete", { exact: true })).toBeVisible({ timeout: 5000 });
    await expect(videoBar).toHaveAttribute("aria-valuenow", "100");
    await expect(videoBar.locator("..")).toContainText("5 of 5 clips accepted");
    await expect(videoBar.locator("..")).toContainText("2m 31s");
    expect(reads).toBeGreaterThan(1);
    await expect(hero.getByText("Total cost so far", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "View video", exact: true })).toBeVisible();
    const geometry = await hero.evaluate((element) => {
      const heroBounds = element.getBoundingClientRect();
      const cards = Array.from(element.querySelectorAll(".cloud-compute .metric")).map((card) => {
        const bounds = card.getBoundingClientRect();
        return { x: bounds.x, y: bounds.y, width: bounds.width, right: bounds.right };
      });
      return {
        width: innerWidth,
        height: heroBounds.height,
        cards,
        contained: cards.every(
          (card) => card.x >= heroBounds.x && card.right <= heroBounds.right + 1,
        ),
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    expect(geometry.contained).toBe(true);
    expect(geometry.overflow).toBe(false);
    await page.screenshot({ path: info.outputPath(`progress-${owner}.png`) });
    await videoBar
      .locator("..")
      .screenshot({ path: info.outputPath(`video-generation-${owner}.png`) });
    if (geometry.width > 1240) {
      expect(geometry.height).toBeLessThan(500);
      expect(new Set(geometry.cards.map((card) => Math.round(card.y))).size).toBe(1);
    }
    await page.goto("/voiceovers");
    await expect(page.getByRole("heading", { name: "Alice", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Starred/ })).toHaveCount(0);
    await page.getByRole("button", { name: /^All voices/ }).click();
    await expect(page.getByRole("heading", { name: "Bob", exact: true })).toBeVisible();
    await page.getByRole("combobox", { name: "Gender", exact: true }).click();
    await page.getByRole("option", { name: /^Female/ }).click();
    await expect(page.getByRole("heading", { name: "Bob", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Clear filters", exact: true }).click();
    await page.getByRole("button", { name: /^Saved/ }).click();
    await expect(page.getByRole("heading", { name: "Alice", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Bob", exact: true })).toHaveCount(0);
    await page.goto("/usage");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "Queue", exact: true })).toBeVisible();
    expect(mutations).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
}

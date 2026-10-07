import { expect, test } from "@playwright/test";

const attemptId = "11111111-1111-4111-8111-111111111111";
const promptProjectId = "66666666-6666-4666-8666-666666666666";

function promptProjectDetail(readCount: number) {
  const acceptedScenes = readCount === 1 ? 0 : readCount === 2 ? 14 : 28;
  const activeBatchOrdinal = acceptedScenes < 14 ? 1 : 2;
  const complete = acceptedScenes === 28;
  return {
    project: {
      id: promptProjectId,
      title: "Live prompt viewer proof",
      created_at: "2026-09-03T10:00:00.000Z",
      revision_id: "77777777-7777-4777-8777-777777777777",
      revision_state: "LOCKED",
    },
    attempts: [],
    gpu_transport: "DISABLED_UNQUALIFIED",
    gpu_readiness: { state: "DISABLED_UNQUALIFIED", lanes: [] },
    voiceover_context: {
      id: "88888888-8888-4888-8888-888888888888",
      state: "SUCCEEDED",
      transcript_hash: `sha256:${"b".repeat(64)}`,
      context_hash: `sha256:${"c".repeat(64)}`,
      context_document: { primary_topic: "A neighborhood workshop builds a practical invention" },
      reserved_cost_micro_usd: 10_000,
      reported_cost_micro_usd: 8_000,
    },
    generation: {
      id: "99999999-9999-4999-8999-999999999999",
      timeline_plan_sha256: `sha256:${"f".repeat(64)}`,
      planned_tasks: 28,
      completed_tasks: 0,
      failed_tasks: 0,
      total_segments: 31,
      image_scene_count: 28,
      avatar_segment_count: 3,
      stage: "WAITING_FOR_GPU_QUALIFICATION",
    },
    stages: [
      {
        id: "prompt-writing",
        name: "Write image prompts",
        status: complete ? "COMPLETE" : "RUNNING",
        progress_percent: Math.round((acceptedScenes / 28) * 100),
      },
    ],
    prompts: Array.from({ length: acceptedScenes }, (_, sceneOrdinal) => ({
      scene_ordinal: sceneOrdinal,
      scene_id: `scene-${sceneOrdinal + 1}`,
      narration: `Narration scene ${sceneOrdinal + 1} describes a specific practical moment.`,
      in_image_shot_role: sceneOrdinal % 2 === 0 ? "HUMAN_MEDIUM" : "HUMAN_DETAIL",
      timeline_composition: "IMAGE_FULL",
      positive_prompt: `Candid eye-level documentary photograph ${sceneOrdinal + 1}: a real local maker performs a concrete workshop action with naturally worn tools and available light.`,
      negative_prompt: "text, captions, logos, motion graphics, staged advertising pose",
      image_style_version_id: "style-version-pinned",
      style_profile_hash: `sha256:${"d".repeat(64)}`,
      style_name: "Pinned reference-derived documentary style",
      durable: complete,
    })),
    prompt_progress: {
      total_scenes: 28,
      accepted_scenes: acceptedScenes,
      total_batches: 2,
      accepted_batches: complete ? 2 : acceptedScenes === 14 ? 1 : 0,
      active_batch_ordinal: activeBatchOrdinal,
    },
  };
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/v2/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/v2/tenant") {
      return route.fulfill({
        json: {
          schema_version: "videoforge-hosted-tenant/v1",
          account_id: "22222222-2222-4222-8222-222222222222",
          workspace_id: "33333333-3333-4333-8333-333333333333",
          workspace_name: "Chrome private workspace",
          user: {
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            email: "owner@example.test",
            name: "Owner",
          },
        },
      });
    }
    if (path === "/api/v2/hosted/status") {
      return route.fulfill({ json: { authentication: ["GOOGLE"], commit: "local-chrome" } });
    }
    if (path === "/api/v2/hosted/queue") {
      return route.fulfill({
        json: {
          schema_version: "videoforge-hosted-queue/v2",
          worker_state: "ONLINE",
          projects: [
            {
              project_id: "44444444-4444-4222-8222-444444444444",
              title: "Chrome-owned render",
              state: "IN_PROGRESS",
              stage: "Final assembly",
              cancellable_attempt_id: attemptId,
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

test("Team access confirmation receives a mouse click above its overlay", async ({ page }) => {
  let revoked = false;
  await page.route("**/api/v2/tenant", (route) =>
    route.fulfill({
      json: {
        account_id: "22222222-2222-4222-8222-222222222222",
        workspace_id: "33333333-3333-4333-8333-333333333333",
        workspace_name: "Private test studio",
        schema_version: "videoforge-hosted-tenant/v1",
        can_manage_team: true,
        user: { id: "test-owner", email: "owner@example.test", name: "Owner" },
      },
    }),
  );
  await page.route("**/api/v2/team-access", async (route) => {
    if (route.request().method() === "POST") {
      expect(route.request().postDataJSON()).toEqual({
        operation: "REVOKE_INVITE",
        target: "test-invitation",
      });
      revoked = true;
      return route.fulfill({ json: { updated: true } });
    }
    return route.fulfill({
      json: {
        members: [],
        invites: [
          {
            id: "test-invitation",
            email: "assistant@example.test",
            state: revoked ? "REVOKED" : "ACTIVE",
            expires_at: "2099-01-01T00:00:00Z",
          },
        ],
      },
    });
  });
  await page.goto("/access");
  await page.getByRole("button", { name: "Revoke invitation", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirm revoke", exact: true })
    .click();
  await expect(page.getByRole("status").filter({ hasText: "Access revoked." })).toBeVisible();
  expect(revoked).toBe(true);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Revoke invitation", exact: true })).toHaveCount(0);
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
  await page.getByText("Manual install & approval", { exact: true }).click();
  await expect(page.getByRole("link", { name: /Download for Windows/u })).toBeVisible();
  await expect(page.getByRole("link", { name: /Download for Mac/u })).toBeVisible();
  await page.screenshot({ path: "/tmp/videoforge-ui-settings-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("link", { name: /Download for Mac/u })).toBeVisible();
  await page.screenshot({ path: "/tmp/videoforge-ui-settings-mobile.png" });
  const overflow = await page.evaluate(() =>
    [...document.querySelectorAll("main *")]
      .filter((element) => element.getBoundingClientRect().right > innerWidth)
      .map((element) => ({
        tag: element.tagName,
        className: element.className,
        right: element.getBoundingClientRect().right,
        text: element.textContent?.slice(0, 60),
      })),
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
    JSON.stringify(overflow),
  ).toBeLessThanOrEqual(390);

  await page.getByRole("link", { name: "Queue", exact: true }).click();
  await page.getByRole("button", { name: "Cancel job", exact: true }).click();
  await page.getByRole("button", { name: "Confirm cancel", exact: true }).click();
  await expect.poll(() => cancelled).toBe(true);
});

test("Stage 5 feels live and keeps every accepted prompt in a bounded scrollable viewer", async ({
  page,
}) => {
  let projectReads = 0;
  await page.route(`**/api/v2/hosted/projects/${promptProjectId}`, async (route) => {
    projectReads += 1;
    await route.fulfill({ json: promptProjectDetail(projectReads) });
  });

  await page.goto(`/projects/${promptProjectId}`);
  await expect(page.getByRole("heading", { name: "Image prompts", exact: true })).toBeVisible();
  await expect(page.getByText("Batch 1 of 2 · 0 / 28 prompts accepted")).toBeVisible();

  await expect(page.getByText("Batch 2 of 2 · 14 / 28 prompts accepted")).toBeVisible({
    timeout: 5_000,
  });
  const viewer = page.getByRole("region", { name: "Accepted image prompts" });
  await expect(viewer.getByRole("listitem")).toHaveCount(14);

  const batchProgress = page.locator('[aria-label="Prompt batch progress"]');
  await expect(batchProgress.getByText("Batch 2 of 2")).toBeVisible({ timeout: 5_000 });
  await expect(batchProgress.getByText("28 / 28 prompts accepted")).toBeVisible();
  await expect(viewer.getByRole("listitem")).toHaveCount(28);
  await expect(
    viewer.getByText(/real local maker performs a concrete workshop action/u),
  ).toHaveCount(28);

  const scrollMetrics = await viewer.evaluate((element) => ({
    clientHeight: element.clientHeight,
    overflowY: getComputedStyle(element).overflowY,
    scrollHeight: element.scrollHeight,
  }));
  expect(scrollMetrics.overflowY).toBe("auto");
  expect(scrollMetrics.scrollHeight).toBeGreaterThan(scrollMetrics.clientHeight);

  await viewer.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect.poll(() => viewer.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect(projectReads).toBe(3);
});

test("Stage 5 recovery stays live and preserves genuine terminal failures", async ({ page }) => {
  let phase: "recovering" | "writing" | "complete" | "failed" = "recovering";
  let promptPosts = 0;
  const startedAt = new Date(Date.now() - 6 * 60_000).toISOString();
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/prompts"))
      promptPosts += 1;
  });
  await page.route(`**/api/v2/hosted/projects/${promptProjectId}`, async (route) => {
    const detail = promptProjectDetail(phase === "complete" ? 3 : 2);
    await route.fulfill({
      json: {
        ...detail,
        project: { ...detail.project, created_at: startedAt },
        stages: detail.stages.map((stage) => ({
          ...stage,
          started_at: startedAt,
          completed_at:
            phase === "complete" || phase === "failed" ? new Date().toISOString() : null,
          detail:
            phase === "recovering"
              ? "Recovering the current prompt batch automatically. Saved prompts remain intact."
              : "Image prompts are being written and verified against the approved style.",
          status:
            phase === "recovering" ? "RETRY_WAIT" : phase === "failed" ? "FAILED" : stage.status,
        })),
        prompt_progress: {
          ...detail.prompt_progress,
          state:
            phase === "recovering"
              ? "UNKNOWN"
              : phase === "failed"
                ? "FAILED"
                : phase === "complete"
                  ? "SUCCEEDED"
                  : "DISPATCHING",
          automatic_recovery_pending: phase === "recovering",
          problem_code:
            phase === "recovering"
              ? "HOSTED_PROMPT_EXECUTION_UNKNOWN"
              : phase === "failed"
                ? "HOSTED_PROMPT_OUTPUT_INVALID"
                : null,
        },
      },
    });
  });
  await page.goto(`/projects/${promptProjectId}`);
  const stages = page.getByRole("list", { name: "Project stages" });
  const row = stages.getByRole("listitem").filter({ hasText: "Write image prompts" });
  await expect(row.getByText("RETRYING", { exact: true })).toBeVisible();
  await expect(row.getByText("FAILED", { exact: true })).toHaveCount(0);
  await expect(row.getByRole("button", { name: "Retry", exact: true })).toHaveCount(0);
  await expect(page.locator(".live-prompt-activity")).toHaveText(
    "Recovering the current prompt batch automatically. Saved prompts remain intact.",
  );
  await expect(page.getByText("HOSTED_PROMPT_EXECUTION_UNKNOWN", { exact: true })).toHaveCount(0);
  const viewer = page.getByRole("region", { name: "Accepted image prompts" });
  await expect(viewer.getByRole("listitem")).toHaveCount(14);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await page.screenshot({ path: `/tmp/videoforge-prompt-recovery-${width}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  phase = "writing";
  await expect(row.getByText("RUNNING", { exact: true })).toBeVisible({ timeout: 5_000 });
  phase = "complete";
  await expect(row.getByText("COMPLETE", { exact: true })).toBeVisible({ timeout: 5_000 });
  await expect(viewer.getByRole("listitem")).toHaveCount(28);
  phase = "failed";
  await page.reload();
  await expect(row.getByText("FAILED", { exact: true })).toBeVisible();
  await expect(row.getByText("HOSTED_PROMPT_OUTPUT_INVALID", { exact: true })).toBeVisible();
  await expect(row.getByRole("button", { name: "Retry", exact: true })).toBeDisabled();
  await expect(viewer.getByRole("listitem")).toHaveCount(14);
  expect(promptPosts).toBe(0);
});

test("Progress dashboard keeps desktop columns, mobile controls and full saved prompts", async ({
  page,
}) => {
  await page.route(`**/api/v2/hosted/projects/${promptProjectId}`, (route) =>
    route.fulfill({ json: promptProjectDetail(3) }),
  );
  await page.goto(`/projects/${promptProjectId}`);
  await expect(page.getByRole("heading", { name: "Image prompts", exact: true })).toBeVisible();
  for (const width of [2560, 1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    const layout = await page.evaluate(() => {
      const rect = (selector: string) => {
        const { x, y, width } = document.querySelector(selector)!.getBoundingClientRect();
        return { x, y, width };
      };
      return {
        overflow: document.documentElement.scrollWidth > window.innerWidth,
        pipeline: rect(".pipeline-panel"),
        preview: rect(".latest-artifact-panel"),
        prompts: rect(".live-prompt-panel"),
        media: rect(".progress-media-column"),
        preparation: rect(".progress-prompts-column"),
        stageFont: parseFloat(
          getComputedStyle(document.querySelector(".stage-copy strong")!).fontSize,
        ),
      };
    });
    expect(layout.overflow, `Overflow at ${width}px`).toBe(false);
    if (width >= 1440) {
      expect(layout.pipeline.x).toBeLessThan(layout.prompts.x);
      expect(layout.prompts.x).toBeLessThan(layout.preview.x);
      expect(layout.pipeline.y).toBe(layout.preparation.y);
      expect(layout.preparation.y).toBe(layout.media.y);
      expect(layout.stageFont).toBeGreaterThanOrEqual(16);
    } else if (width <= 390) {
      expect(layout.prompts.y).toBeGreaterThan(layout.pipeline.y);
      expect(layout.preview.y).toBeGreaterThan(layout.prompts.y);
    }
  }
  const scene = page
    .getByRole("region", { name: "Accepted image prompts" })
    .getByRole("listitem")
    .first();
  await scene.locator("summary").press("Enter");
  await expect(
    scene.getByText(/real local maker performs a concrete workshop action/u),
  ).toBeVisible();
  await expect(scene.getByText(/text, captions, logos, motion graphics/u)).toBeVisible();
});

test("GPU uptime, all API total and stopped charges stay correct on desktop and mobile", async ({
  page,
}) => {
  const started = Date.now() - 15 * 60_000;
  let stopped = false;
  await page.route(`**/api/v2/hosted/projects/${promptProjectId}`, (route) => {
    const detail = promptProjectDetail(3);
    return route.fulfill({
      json: {
        ...detail,
        generation_provider: "KIE_FAL",
        project: { ...detail.project, media_execution_backend: "RUNPOD_POD" },
        cost: {
          projected_usd: 1.1609,
          api_estimate: {
            kie_images: 90,
            kie_usd: 0.36,
            fal_avatar_seconds: 160,
            fal_usd: 0.8,
            pricing_checked_at: "2026-10-07",
            text_cost_so_far_usd: 0.0009,
            text_cost_pending: true,
            pricing_incomplete: true,
          },
          api_cost_so_far: {
            usd: 1.1609,
            unconfirmed: false,
            estimated: true,
            breakdown: [
              { label: "Generated images", usd: 0.36, estimated: true },
              { label: "Avatar footage", usd: 0.8, estimated: true },
              { label: "Scene prompts (GPT-6 Luna)", usd: 0.0009, estimated: true },
            ],
          },
          cloud_compute: {
            observed_at: new Date().toISOString(),
            rentals: [
              {
                id: "rental-one",
                machine: "NVIDIA RTX PRO 4500 Blackwell Server Edition",
                hourly_usd: 2,
                started_at: new Date(started).toISOString(),
                stopped_at: stopped ? new Date(started + 15 * 60_000).toISOString() : null,
                status: stopped ? "STOPPED" : "RUNNING",
              },
            ],
          },
        },
      },
    });
  });
  await page.goto(`/projects/${promptProjectId}`);
  const panel = page.getByRole("region", { name: "Cloud compute charges" });
  await expect(panel.getByText("GPU uptime", { exact: true })).toBeVisible();
  await expect(panel.getByText("Total cost so far", { exact: true })).toBeVisible();
  await expect(
    page.getByText(/\$0\.0009 text.*text generation incomplete.*partial estimate/),
  ).toBeVisible();
  const cost = panel.locator(".cloud-compute-metrics .metric").nth(1).locator("strong");
  const firstCost = await cost.innerText();
  await expect.poll(() => cost.innerText()).not.toBe(firstCost);
  await panel.locator("summary").press("Enter");
  await expect(panel.getByText(/NVIDIA RTX PRO 4500/)).toBeVisible();
  await expect(panel.getByText(/Running · \$2.0000\/hr/)).toBeVisible();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
    ).toBe(false);
  }
  stopped = true;
  await expect(cost).toHaveText("$0.5000");
  await expect(panel.locator(".cloud-compute-total strong")).toHaveText("$1.6609");
  await page.waitForTimeout(2100);
  await expect(cost).toHaveText("$0.5000");
  await expect(panel.locator(".cloud-compute-total strong")).toHaveText("$1.6609");
});

const regenerationSceneId = "12121212-1212-4212-8212-121212121212";
const otherSceneId = "13131313-1313-4313-8313-131313131313";
const regenerationRequestId = "14141414-1414-4414-8414-141414141414";
const sceneImage = (color: string) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="${color}"/></svg>`)}`;

function imageReviewDetail(replaced: boolean, prompt: string) {
  const base = promptProjectDetail(3);
  const contactSheet = [
    {
      id: regenerationSceneId,
      image_url: sceneImage(replaced ? "green" : "gold"),
      prompt,
      label: "Generated image 1",
    },
    {
      id: otherSceneId,
      image_url: sceneImage("blue"),
      prompt: "An untouched second scene.",
      label: "Generated image 2",
    },
  ];
  return {
    ...base,
    project: { ...base.project, title: "Per-scene regeneration proof" },
    voiceover_context: null,
    generation: { ...base.generation, stage: "COMPLETE" },
    stages: [
      {
        id: "image-generation",
        name: "Generate images",
        status: "COMPLETE",
        progress_percent: 100,
      },
    ],
    prompts: [],
    contact_sheet: contactSheet,
    review: { contact_sheet: contactSheet },
    avatar_footage: [],
  };
}

test("Stage 6 edits and regenerates exactly one scene while retaining accepted media", async ({
  page,
}) => {
  const originalPrompt = "A person holding a watermelon.";
  const editedPrompt = "A farmer holding a ripe watermelon beside a market stall.";
  let completed = false;
  let submitted = false;
  const posts: Record<string, unknown>[] = [];
  const unexpectedWrites: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && !request.url().endsWith("/regenerate"))
      unexpectedWrites.push(request.url());
  });
  await page.route(`**/api/v2/hosted/projects/${promptProjectId}`, (route) =>
    route.fulfill({
      json: imageReviewDetail(completed, completed ? editedPrompt : originalPrompt),
    }),
  );
  const regenerationPath = `/api/v2/hosted/projects/${promptProjectId}/images/${regenerationSceneId}/regenerate`;
  await page.route(`**${regenerationPath}`, async (route) => {
    expect(route.request().method()).toBe("POST");
    posts.push(route.request().postDataJSON() as Record<string, unknown>);
    submitted = true;
    await route.fulfill({
      status: 202,
      json: {
        request_id: regenerationRequestId,
        attempt_id: regenerationRequestId,
        state: "QUEUED",
      },
    });
  });
  await page.route(`**${regenerationPath}/${regenerationRequestId}`, (route) =>
    route.fulfill({
      json: {
        request_id: regenerationRequestId,
        attempt_id: regenerationRequestId,
        state: completed ? "SUCCEEDED" : "PENDING",
        image_url: completed ? sceneImage("green") : null,
        prompt: completed ? editedPrompt : originalPrompt,
      },
    }),
  );

  await page.goto(`/projects/${promptProjectId}`);
  await page.getByRole("button", { name: "View generated images" }).click();
  const prompt = page.getByRole("textbox", { name: "Image prompt", exact: true });
  await expect(prompt).toHaveValue(originalPrompt);
  const image = page.getByRole("img", { name: "Generated image 1", exact: true });
  await expect(image).toHaveAttribute("src", sceneImage("gold"));
  await prompt.fill(editedPrompt);
  await prompt.press("Enter");
  await expect.poll(() => submitted).toBe(true);
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({
    schema_version: "videoforge-hosted-image-regeneration/v1",
    prompt: editedPrompt,
    revision_id: "77777777-7777-4777-8777-777777777777",
  });
  expect(posts[0]?.idempotency_key).toEqual(expect.any(String));
  await expect(image).toHaveAttribute("src", sceneImage("gold"));
  await expect(page.getByRole("button", { name: "Regenerating…", exact: true })).toBeDisabled();
  completed = true;
  await expect(image).toHaveAttribute("src", sceneImage("green"), { timeout: 15_000 });
  await expect(prompt).toHaveValue(editedPrompt);
  await page.getByRole("button", { name: "Next image", exact: true }).click();
  await expect(prompt).toHaveValue("An untouched second scene.");
  await expect(page.getByRole("img", { name: "Generated image 2", exact: true })).toHaveAttribute(
    "src",
    sceneImage("blue"),
  );
  expect(posts).toHaveLength(1);
  expect(unexpectedWrites).toEqual([]);
  await page.screenshot({ path: "/tmp/videoforge-scene-regeneration-review.png", fullPage: true });
});

test("Create keeps the configurable AI opening separate from whole-video coverage", async ({
  page,
}) => {
  const unexpectedWrites: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET" && request.url().includes("/api/v2/"))
      unexpectedWrites.push(request.url());
  });
  await page.route("**/api/v2/hosted/project-catalog", (route) =>
    route.fulfill({
      json: {
        avatars: [{ profile_id: "p1", version_id: "a1", name: "Owner", version_number: 1 }],
        styles: [{ style_id: "s1", version_id: "sv1", name: "Documentary", version_number: 1 }],
        default_image_style_version_id: "sv1",
        media_worker_state: "ONLINE",
        cloud_media: { available: true },
        generation_provider: "KIE_FAL",
        gpu_transport: "DISABLED_UNQUALIFIED",
        gpu_readiness: {
          schema_version: "videoforge-hosted-gpu-readiness/v1",
          gpu_transport: "DISABLED_UNQUALIFIED",
          provider_calls_authorized: false,
          dispatch_available: false,
          lanes: [
            {
              lane: "MAGE_IMAGE",
              checkpoint: "V2-07",
              qualification: "NOT_QUALIFIED",
              visual_approval: "NOT_APPLICABLE",
              provider_free_groundwork_commits: ["1283a23248c9b79832b6fb331b00474e1df70f81"],
              missing_gates: ["identity_output", "cancellation_timeout", "max2_concurrency"],
            },
            {
              lane: "SOULX_AVATAR",
              checkpoint: "V2-08",
              qualification: "NOT_QUALIFIED",
              visual_approval: "APPROVED_EXACT_FULL_AND_SPLIT",
              provider_free_groundwork_commits: [
                "7039092707103ab35e8010c009e14409a6e52f63",
                "84e00881d98e3e77dd8aad121453ed6e7287bc74",
                "e49b93854d58c4faeb8bdd10b9b9df07321026db",
                "f3557059d7d5f0637ea223b3e758389fbd80a52b",
              ],
              missing_gates: [
                "V2_07_MAGE_QUALIFICATION",
                "V2_08_IMAGE_PUBLICATION_AND_ENDPOINT_CONFIGURATION",
                "V2_08_MAX1_LIVE_QUALIFICATION",
              ],
            },
          ],
        },
        video_generation: {
          enabled: true,
          configurable_opening: true,
          default_opening_seconds: 180,
          required_opening_seconds: 180,
          coverage_percent: 7,
          coverage_default_percent: 7,
          adjustable_coverage_supported: true,
          usd_per_second: 0.01336,
          resolution: "720p",
          aspect_ratio: "16:9",
        },
      },
    }),
  );
  // A real browser-decodable WAV keeps this control proof entirely provider-free.
  const audioBytes = 20 * 32000;
  const voiceover = Buffer.alloc(44 + audioBytes);
  voiceover.write("RIFF", 0);
  voiceover.writeUInt32LE(voiceover.length - 8, 4);
  voiceover.write("WAVEfmt ", 8);
  voiceover.writeUInt32LE(16, 16);
  voiceover.writeUInt16LE(1, 20);
  voiceover.writeUInt16LE(1, 22);
  voiceover.writeUInt32LE(16000, 24);
  voiceover.writeUInt32LE(32000, 28);
  voiceover.writeUInt16LE(2, 32);
  voiceover.writeUInt16LE(16, 34);
  voiceover.write("data", 36);
  voiceover.writeUInt32LE(audioBytes, 40);
  await page.goto("/projects/new");
  const opening = page.getByRole("checkbox", { name: "Full video opening" });
  const minutes = page.getByRole("spinbutton", { name: "Opening minutes" });
  const coverage = page.getByRole("spinbutton", { name: "Coverage percent" });
  const create = page.getByRole("button", { name: "Create video" });
  await expect(opening).toBeChecked();
  await expect(minutes).toHaveValue("3");
  await page.getByRole("textbox", { name: "Video title" }).fill("Opening control proof");
  const voiceoverInput = page.getByLabel("Final voiceover");
  await voiceoverInput.setInputFiles({
    name: "garden-3min-voiceover.mp3",
    mimeType: "audio/mpeg",
    buffer: Buffer.alloc(0),
  });
  await expect(page.getByRole("alert")).toHaveText(
    "This voiceover file is empty (0 bytes). Choose a complete WAV or MP3 file.",
  );
  await expect(create).toBeDisabled();
  await expect(page.getByText(/ready to check/u)).not.toBeVisible();
  expect(unexpectedWrites).toEqual([]);

  await voiceoverInput.setInputFiles({
    name: "opening-proof.wav",
    mimeType: "audio/wav",
    buffer: voiceover,
  });
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(create).toBeEnabled();
  await minutes.fill("2.5");
  await coverage.fill("23");
  await expect(
    page.getByText(
      "First 2.5 minutes: videos replace photos, with your usual avatar appearances. Afterward: up to 23% coverage. Full scenes only.",
    ),
  ).toBeVisible();
  await expect(page.getByLabel("Preliminary scene footage estimate")).toHaveText(/20\.00s/);
  await page.getByRole("radio", { name: "Cloud" }).check();
  for (const dock of ["Queue", "Voices", "Avatar Hub", "Image Styles", "Library", "Settings"]) {
    await page
      .getByRole("navigation", { name: "Primary navigation" })
      .getByRole("link", { name: dock, exact: true })
      .click();
    await expect(page.getByRole("heading", { name: "New project", exact: true })).toHaveCount(0);
    await page
      .getByRole("navigation", { name: "Primary navigation" })
      .getByRole("link", { name: "New Project", exact: true })
      .click();
    await expect(page.getByRole("textbox", { name: "Video title" })).toHaveValue(
      "Opening control proof",
    );
    await expect(page.getByText("opening-proof.wav", { exact: true })).toBeVisible();
    await expect(page.getByRole("radio", { name: "Cloud" })).toBeChecked();
    await expect(minutes).toHaveValue("2.5");
    await expect(coverage).toHaveValue("23");
    await expect(create).toBeEnabled();
  }

  await page.setViewportSize({ width: 418, height: 900 });
  await expect(page.getByRole("group", { name: "Opening footage" })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("opening-on.png"), fullPage: true });
  const avatarToggle = page.getByRole("checkbox", { name: "Include avatar" });
  await expect(avatarToggle).toBeChecked();
  await avatarToggle.uncheck();
  await expect(page.locator("#hosted-avatar-select")).toHaveCount(0);
  await expect(minutes).toHaveValue("2.5");
  await expect(coverage).toHaveValue("23");
  await avatarToggle.check();
  await expect(page.locator("#hosted-avatar-select")).toBeVisible();
  await opening.uncheck();
  await expect(minutes).toHaveCount(0);
  await expect(coverage).toHaveValue("23");
  await expect(page.getByText("Up to 23% of your video. Full scenes only.")).toBeVisible();
  await expect(page.getByLabel("Preliminary scene footage estimate")).toHaveText(/4\.60s/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("opening-off.png"), fullPage: true });
  await opening.check();
  await expect(minutes).toBeEnabled();
  await expect(minutes).toHaveValue("2.5");
  await minutes.fill("0.11");
  await expect(create).toBeDisabled();
  await expect(minutes).toHaveAttribute("aria-invalid", "true");
  await opening.uncheck();
  await expect(create).toBeEnabled();
  await opening.check();
  await expect(minutes).toHaveValue("0.11");
  await expect(create).toBeDisabled();
  // Settings prepares its existing connect commands on entry; no production work is submitted.
  expect(unexpectedWrites.filter((url) => !url.endsWith("/media-worker/connect-command"))).toEqual(
    [],
  );
});

test("finished video appears in Library and the legacy viewer downloads without approval", async ({
  page,
}) => {
  const projectId = "88888888-8888-4888-8888-888888888888";
  let libraryReads = 0;
  const mutations: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") mutations.push(new URL(request.url()).pathname);
  });
  await page.route("**/api/v2/library", (route) => {
    libraryReads += 1;
    return route.fulfill({
      json: {
        schema_version: "videoforge-hosted-library/v1",
        outputs:
          libraryReads === 1
            ? []
            : [
                {
                  attempt_id: attemptId,
                  project_id: projectId,
                  title: "Automatically delivered video",
                  created_at: "2026-10-05T10:00:00Z",
                  content_length: 12_000_000,
                  checksum_sha256: `sha256:${"a".repeat(64)}`,
                  download_url: `/api/v2/hosted/projects/${projectId}/download`,
                  download_expires_at: "2026-10-05T10:05:00Z",
                },
              ],
      },
    });
  });
  await page.route(`**/api/v2/hosted/projects/${projectId}`, (route) =>
    route.fulfill({
      json: {
        project: {
          id: projectId,
          title: "Automatically delivered video",
          revision_id: "revision",
          revision_state: "LOCKED",
        },
        attempts: [
          {
            id: attemptId,
            kind: "RENDER",
            state: "SUCCEEDED",
            approved_at: null,
            preview_url: `/api/v2/hosted/projects/${projectId}/download`,
          },
        ],
        stages: [
          { id: "render", name: "Assemble final video", status: "COMPLETE", progress_percent: 100 },
          { id: "review", name: "Review and approve", status: "ACTION_REQUIRED" },
        ],
        generation: null,
        gpu_readiness: { state: "DISABLED_UNQUALIFIED", lanes: [] },
        review: {
          state: "COMPLETE",
          manifest_url: `/api/v2/hosted/projects/${projectId}/manifest`,
          download_url: `/api/v2/hosted/projects/${projectId}/download`,
        },
      },
    }),
  );
  await page.goto(`/projects/${projectId}`);
  await expect(
    page
      .getByRole("region", { name: "Live video progress" })
      .getByText("Complete", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Review and approve", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "View video", exact: true })).toBeVisible();
  await page.goto("/library");
  await expect(page.getByRole("heading", { name: "No finished videos" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Automatically delivered video" })).toBeVisible({
    timeout: 10_000,
  });
  await page.getByRole("link", { name: "View video", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/review$`));
  await expect(page.getByRole("heading", { name: "Video", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Download MP4", exact: true })).toHaveAttribute(
    "href",
    `/api/v2/hosted/projects/${projectId}/download`,
  );
  await expect(page.getByRole("link", { name: "Download provenance manifest" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Approve/ })).toHaveCount(0);
  expect(mutations).toEqual([]);
});

for (const width of [1280, 390]) {
  test(`Voice filters combine and reset at ${width}px without generating narration`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const voices = [
      {
        voice_id: "alice",
        name: "Alice - British",
        tags: "Female, Calm, Narrative Story, Mature",
        languages: "gb,us",
        saved: false,
        starred: false,
        preview_url: null,
      },
      {
        voice_id: "bob",
        name: "Bob - American",
        tags: "Male, Deep, Conversational, Young",
        languages: "us",
        saved: false,
        starred: false,
        preview_url: null,
      },
      {
        voice_id: "bea",
        name: "Bea - Indian",
        tags: "Female, Calm, Conversational",
        languages: "in",
        saved: false,
        starred: false,
        preview_url: null,
      },
    ];
    const posts: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST") posts.push(request.url());
    });
    await page.route("**/api/v2/voiceovers/voices", (route) => route.fulfill({ json: { voices } }));
    await page.goto("/voiceovers");
    await expect(page.getByRole("heading", { name: "Bob - American" })).toBeVisible();
    const gender = page.getByRole("combobox", { name: "Gender", exact: true });
    await gender.click();
    await expect(page.getByRole("listbox", { name: "Gender" })).toBeVisible();
    expect(
      await page.getByRole("listbox").evaluate((list) => {
        const bounds = list.getBoundingClientRect();
        return (
          bounds.left >= 0 &&
          bounds.right <= window.innerWidth &&
          bounds.bottom <= window.innerHeight
        );
      }),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`dropdown-${width}.png`),
    });
    await gender.press("Escape");
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(gender).toBeFocused();
    await gender.click();
    await page.getByRole("option", { name: /^Female(?: |$)/ }).click();
    await expect(page.getByRole("heading", { name: "Bob - American" })).toHaveCount(0);
    await page.getByRole("combobox", { name: "Age", exact: true }).click();
    await page.getByRole("option", { name: /^Mature(?: |$)/ }).click();
    await expect(page.getByRole("article").getByText("Age: Mature", { exact: true })).toBeVisible();
    await expect(page.locator(".voice-save")).toHaveCount(0);
    await page.getByRole("combobox", { name: "Accent", exact: true }).click();
    await page.getByRole("option", { name: /^British(?: |$)/ }).click();
    await page.getByRole("combobox", { name: "Language / region", exact: true }).click();
    await page.getByRole("option", { name: /^United Kingdom(?: |$)/ }).click();
    await page.getByText("More filters", { exact: true }).click();
    await page.getByRole("combobox", { name: "Style / tone", exact: true }).click();
    await page.getByRole("option", { name: /^Calm(?: |$)/ }).click();
    await page.getByRole("combobox", { name: "Use case", exact: true }).click();
    await page.getByRole("option", { name: /^Narrative Story(?: |$)/ }).click();
    await expect(page.getByRole("article")).toHaveCount(1);
    await expect(page.getByRole("heading", { name: "Alice - British" })).toBeVisible();
    await page.getByLabel("Has audio preview").check();
    await expect(page.getByRole("heading", { name: "No matching voices" })).toBeVisible();
    await page.getByRole("button", { name: "Clear filters", exact: true }).first().click();
    await expect(page.getByRole("article")).toHaveCount(3);
    await page.getByRole("combobox", { name: "Sort", exact: true }).click();
    await page.getByRole("option", { name: /^Name Z–A(?: |$)/ }).click();
    await expect(page.getByRole("article").first()).toContainText("Bob - American");
    await page.getByRole("searchbox", { name: "Search voices" }).fill(" b ");
    await expect(page.getByRole("article")).toHaveCount(2);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    expect(posts).toEqual([]);
  });
}

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
  await page.getByText("Add or update a computer", { exact: true }).click();
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

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
        project: { ...detail.project, media_execution_backend: "RUNPOD_POD" },
        cost: {
          api_cost_so_far: {
            usd: 1.16,
            unconfirmed: false,
            estimated: true,
            breakdown: [
              { label: "Generated images", usd: 0.36, estimated: true },
              { label: "Avatar footage", usd: 0.8, estimated: true },
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
  await expect(panel.locator(".cloud-compute-total strong")).toHaveText("$1.6600");
  await page.waitForTimeout(2100);
  await expect(cost).toHaveText("$0.5000");
  await expect(panel.locator(".cloud-compute-total strong")).toHaveText("$1.6600");
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
  await page.getByLabel("Final voiceover").setInputFiles({
    name: "opening-proof.wav",
    mimeType: "audio/wav",
    buffer: voiceover,
  });
  await expect(create).toBeEnabled();
  await minutes.fill("2.5");
  await coverage.fill("23");
  await expect(
    page.getByText(
      "First 2.5 minutes: videos replace photos, with your usual avatar appearances. Afterward: up to 23% coverage. Full scenes only.",
    ),
  ).toBeVisible();
  await expect(page.getByLabel("Preliminary scene footage estimate")).toHaveText(/20\.00s/);
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
  expect(unexpectedWrites).toEqual([]);
});

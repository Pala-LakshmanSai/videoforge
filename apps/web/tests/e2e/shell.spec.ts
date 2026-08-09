import { createHash } from "node:crypto";

import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

interface RuntimeFailures {
  consoleErrors: string[];
  externalRequests: string[];
  failedResponses: string[];
  pageErrors: string[];
}

interface UiSurfaceRoute {
  heading: string;
  path: string;
  surfaces: string[];
}

const uiSurfaceRoutes: UiSurfaceRoute[] = [
  {
    heading: "Your queue",
    path: "/?fixture=happy_generating",
    surfaces: [".queue-overview .metric", ".queue-panel", ".queue-card"],
  },
  {
    heading: "New project",
    path: "/projects/new?fixture=project_create_ready",
    surfaces: [".create-config-panel", ".create-section", ".create-run-panel"],
  },
  {
    heading: "How to Recognize a Sweet Watermelon",
    path: "/projects/project_fixture_001?fixture=happy_generating",
    surfaces: [".progress-hero", ".pipeline-panel", ".stage-row", ".lane-row"],
  },
  {
    heading: "Review",
    path: "/projects/project_fixture_001/review?fixture=project_ready_for_review",
    surfaces: [".review-player", ".review-segments", ".review-card"],
  },
  {
    heading: "Avatar Hub",
    path: "/avatars?fixture=avatar_profile_ready",
    surfaces: [".entity-card"],
  },
  {
    heading: "New avatar",
    path: "/avatars/new?fixture=project_create_ready",
    surfaces: [".layout-main > .panel", ".onboarding-details"],
  },
  {
    heading: "Image Styles",
    path: "/styles?fixture=happy_generating",
    surfaces: [".entity-card"],
  },
  {
    heading: "New style",
    path: "/styles/new?fixture=project_create_ready",
    surfaces: [".layout-main > .panel", ".onboarding-details"],
  },
  {
    heading: "Library",
    path: "/library?fixture=project_approved",
    surfaces: [".library-output"],
  },
  {
    heading: "Usage",
    path: "/usage?fixture=happy_generating",
    surfaces: [".usage-grid .metric"],
  },
  {
    heading: "Settings",
    path: "/settings?fixture=happy_generating",
    surfaces: [".settings-grid .panel", ".settings-summary"],
  },
];

const runtimeFailures = new WeakMap<Page, RuntimeFailures>();

function fixtureSessionId(testInfo: TestInfo): string {
  const project = testInfo.project.name.replaceAll(/[^a-z0-9]+/giu, "-").slice(0, 32);
  const digest = createHash("sha256")
    .update(
      [
        testInfo.file,
        testInfo.title,
        testInfo.project.name,
        testInfo.repeatEachIndex,
        testInfo.retry,
      ]
        .map(String)
        .join("\n"),
    )
    .digest("hex")
    .slice(0, 20);
  return `pw-${project}-${digest}`;
}

function createPcmWavBuffer(durationSeconds = 10.25, sampleRate = 8_000): Buffer {
  const channels = 1;
  const bytesPerSample = 2;
  const sampleCount = Math.ceil(durationSeconds * sampleRate);
  const dataBytes = sampleCount * channels * bytesPerSample;
  const wav = Buffer.alloc(44 + dataBytes);

  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write("WAVE", 8, "ascii");
  wav.write("fmt ", 12, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(channels, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  wav.writeUInt16LE(channels * bytesPerSample, 32);
  wav.writeUInt16LE(bytesPerSample * 8, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(dataBytes, 40);
  return wav;
}

function isLocalRequest(rawUrl: string): boolean {
  const url = new URL(rawUrl);
  return (
    ["data:", "blob:"].includes(url.protocol) || ["localhost", "127.0.0.1"].includes(url.hostname)
  );
}

async function expectImagesLoaded(images: Locator): Promise<void> {
  await expect(images.first()).toBeVisible();
  const imageState = await images.evaluateAll((elements) =>
    elements.map((element) => {
      const image = element as HTMLImageElement;
      return {
        alt: image.alt,
        complete: image.complete,
        naturalWidth: image.naturalWidth,
      };
    }),
  );
  expect(imageState.length).toBeGreaterThan(0);
  expect(imageState).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ complete: true, naturalWidth: expect.any(Number) }),
    ]),
  );
  for (const image of imageState) {
    expect(image.complete, `${image.alt} did not finish loading`).toBe(true);
    expect(image.naturalWidth, `${image.alt} has no decoded pixels`).toBeGreaterThan(0);
  }
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    )
    .toBe(true);
}

async function expectFocusWithin(container: Locator): Promise<void> {
  await expect
    .poll(() => container.evaluate((element) => element.contains(document.activeElement)))
    .toBe(true);
}

async function chooseFixture(page: Page, fixture: string): Promise<void> {
  const scenarioTrigger = page.getByLabel("Scenario", { exact: true });
  if (!(await scenarioTrigger.isVisible())) {
    await page.getByText("Fixture mode", { exact: true }).click();
  }
  await scenarioTrigger.click();
  await page.getByRole("option", { name: fixture, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`fixture=${fixture}`));
}

test.beforeEach(async ({ page }, testInfo) => {
  const sessionId = fixtureSessionId(testInfo);
  await page.setExtraHTTPHeaders({
    "X-VideoForge-Fixture-Session": sessionId,
  });
  const reset = await page.request.post("/api/dev/fixture-session/reset", {
    headers: { "X-VideoForge-Fixture-Session": sessionId },
  });
  expect(reset.ok()).toBe(true);
  const failures: RuntimeFailures = {
    consoleErrors: [],
    externalRequests: [],
    failedResponses: [],
    pageErrors: [],
  };
  runtimeFailures.set(page, failures);

  page.on("request", (request) => {
    if (!isLocalRequest(request.url())) failures.externalRequests.push(request.url());
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      failures.failedResponses.push(`${response.status()} ${response.url()}`);
    }
  });
  page.on("console", (message) => {
    if (message.type() === "error") failures.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => failures.pageErrors.push(error.message));

  await page.goto("/?fixture=happy_generating");
  await expect(page.getByRole("heading", { name: "Your queue" })).toBeVisible();
  await expect(page.getByText("Fixture mode", { exact: true })).toBeVisible();
});

test.afterEach(async ({ page }) => {
  const failures = runtimeFailures.get(page);
  expect(failures?.consoleErrors ?? []).toEqual([]);
  expect(failures?.externalRequests ?? []).toEqual([]);
  expect(failures?.failedResponses ?? []).toEqual([]);
  expect(failures?.pageErrors ?? []).toEqual([]);
});

test("queue exposes truthful status and complete primary navigation", async ({ page }) => {
  await expect(page.getByText("Synthetic data · $0 spend")).toBeVisible();
  await expect(page.locator(".top-health")).toContainText("API healthy");

  const navigation = page.getByRole("navigation", { name: "Primary navigation" });
  for (const label of [
    "Queue",
    "New Project",
    "Avatar Hub",
    "Image Styles",
    "Library",
    "Usage",
    "Settings",
  ]) {
    await expect(navigation.getByRole("link", { name: label })).toBeVisible();
  }

  await navigation.getByRole("link", { name: "Avatar Hub" }).click();
  await expect(page.getByRole("heading", { name: "Avatar Hub" })).toBeVisible();
  await navigation.getByRole("link", { name: "Image Styles" }).click();
  await expect(page.getByRole("heading", { name: "Image Styles" })).toBeVisible();
});

test("dock magnifies by pointer proximity without moving its layout boxes", async ({ page }) => {
  const items = page.locator(".bottom-nav-item");
  await expect(items).toHaveCount(8);
  const target = items.nth(3);
  const neighbor = items.nth(2);
  const far = items.nth(7);
  const targetIcon = target.locator(".bottom-nav-icon");
  const before = await target.boundingBox();
  const iconBefore = await targetIcon.boundingBox();
  if (!before) throw new Error("Dock target has no layout box.");
  if (!iconBefore) throw new Error("Dock target icon has no layout box.");
  expect(before.width).toBeGreaterThanOrEqual(94);
  expect(before.height).toBeGreaterThanOrEqual(74);
  expect(iconBefore.width).toBeCloseTo(48, 1);
  expect(iconBefore.height).toBeCloseTo(44, 1);

  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await expect
    .poll(() =>
      target.evaluate((element) =>
        Number(getComputedStyle(element).getPropertyValue("--dock-scale")),
      ),
    )
    .toBeGreaterThan(1.74);

  const targetScale = await target.evaluate((element) =>
    Number(getComputedStyle(element).getPropertyValue("--dock-scale")),
  );
  const neighborScale = await neighbor.evaluate((element) =>
    Number(getComputedStyle(element).getPropertyValue("--dock-scale")),
  );
  const farScale = await far.evaluate((element) =>
    Number(getComputedStyle(element).getPropertyValue("--dock-scale")),
  );
  expect(targetScale).toBeCloseTo(1.75, 2);
  expect(targetScale).toBeGreaterThan(neighborScale);
  expect(neighborScale).toBeGreaterThan(farScale);
  expect(farScale).toBe(1);

  const after = await target.boundingBox();
  const iconAfter = await targetIcon.boundingBox();
  expect(after).toEqual(before);
  if (!iconAfter) throw new Error("Magnified dock icon has no layout box.");
  expect(iconAfter.width).toBeCloseTo(84, 1);
  expect(iconAfter.height).toBeCloseTo(77, 1);
  expect(
    Math.abs(iconAfter.y + iconAfter.height - (iconBefore.y + iconBefore.height)),
  ).toBeLessThanOrEqual(0.5);
  await expect(target).toHaveCSS("--dock-lift", "");
  await expect(target).toHaveCSS("--dock-shift", "");
  await expect(target).toHaveCSS("--dock-surface-scale", "");

  await page.mouse.move(10, 10);
  await expect
    .poll(() =>
      target.evaluate((element) =>
        Number(getComputedStyle(element).getPropertyValue("--dock-scale")),
      ),
    )
    .toBe(1);

  const active = items.first();
  const activeBox = await active.boundingBox();
  if (!activeBox) throw new Error("Active dock item has no layout box.");
  expect(await active.evaluate((element) => getComputedStyle(element, "::before").transform)).toBe(
    "none",
  );
  await page.mouse.move(activeBox.x + activeBox.width / 2, activeBox.y + activeBox.height / 2);
  await expect
    .poll(() =>
      active.evaluate((element) =>
        Number(getComputedStyle(element).getPropertyValue("--dock-scale")),
      ),
    )
    .toBeGreaterThan(1.74);
  expect(await active.boundingBox()).toEqual(activeBox);
  expect(await active.evaluate((element) => getComputedStyle(element, "::before").transform)).toBe(
    "none",
  );

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await expect
    .poll(() =>
      target.evaluate((element) =>
        Number(getComputedStyle(element).getPropertyValue("--dock-scale")),
      ),
    )
    .toBe(1);
});

test("content uses the medium scale while the dock keeps its approved base size", async ({
  page,
}) => {
  await page.goto("/projects/new?fixture=project_create_ready");
  await expect(page.getByRole("heading", { name: "New project" })).toBeVisible();

  const scale = await page.evaluate(() => {
    const title = document.querySelector<HTMLElement>(".page-header-title");
    const input = document.querySelector<HTMLElement>(".input");
    const dockItem = document.querySelector<HTMLElement>(".bottom-nav-item");
    if (!title || !input || !dockItem) throw new Error("Scale audit targets are missing.");
    return {
      dockHeight: dockItem.getBoundingClientRect().height,
      dockWidth: dockItem.getBoundingClientRect().width,
      inputHeight: input.getBoundingClientRect().height,
      root: Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
      title: Number.parseFloat(getComputedStyle(title).fontSize),
    };
  });

  expect(scale.root).toBe(18);
  expect(scale.title).toBeGreaterThanOrEqual(36);
  expect(scale.title).toBeLessThanOrEqual(52);
  expect(scale.inputHeight).toBe(52);
  expect(scale.dockWidth).toBeGreaterThanOrEqual(94);
  expect(scale.dockHeight).toBeGreaterThanOrEqual(74);
});

test("every screen keeps separated sections and legible structural surfaces", async ({ page }) => {
  for (const route of uiSurfaceRoutes) {
    await page.goto(route.path);
    await expect(page.getByRole("heading", { name: route.heading }).first()).toBeVisible();
    await expectNoHorizontalOverflow(page);

    const pageLayout = await page.locator(".page").evaluate((element) => {
      const expectedGap = Number.parseFloat(getComputedStyle(element).rowGap);
      const children = Array.from(element.children)
        .filter((child) => {
          const bounds = child.getBoundingClientRect();
          return bounds.height > 0 && getComputedStyle(child).position !== "fixed";
        })
        .map((child) => {
          const bounds = child.getBoundingClientRect();
          return { bottom: bounds.bottom, top: bounds.top };
        });
      return {
        expectedGap,
        gaps: children.slice(1).map((child, index) => child.top - children[index].bottom),
      };
    });

    expect(pageLayout.expectedGap, `${route.path} has no page section gap`).toBeGreaterThanOrEqual(
      20,
    );
    for (const gap of pageLayout.gaps) {
      expect(
        gap,
        `${route.path} has touching or overlapping top-level sections`,
      ).toBeGreaterThanOrEqual(pageLayout.expectedGap - 0.5);
    }

    for (const selector of route.surfaces) {
      const surface = page.locator(selector).first();
      await expect(surface, `${route.path} is missing ${selector}`).toBeVisible();
      const boundary = await surface.evaluate((element) => {
        const style = getComputedStyle(element);
        const color = style.borderTopColor;
        const rgba = color.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)$/u);
        return {
          borderAlpha: rgba ? Number(rgba[1]) : 1,
          borderWidth: Number.parseFloat(style.borderTopWidth),
          boxShadow: style.boxShadow,
        };
      });
      expect(
        boundary.borderWidth,
        `${route.path} ${selector} has no boundary`,
      ).toBeGreaterThanOrEqual(1);
      expect(
        boundary.borderAlpha,
        `${route.path} ${selector} boundary is too faint`,
      ).toBeGreaterThanOrEqual(0.2);
      expect(boundary.boxShadow, `${route.path} ${selector} has no depth cue`).not.toBe("none");
    }

    if (route.path.startsWith("/usage")) {
      const usageGap = await page.locator(".usage-grid").evaluateAll((grids) => {
        const first = grids[0]?.getBoundingClientRect();
        const second = grids[1]?.getBoundingClientRect();
        return first && second ? second.top - first.bottom : 0;
      });
      expect(usageGap).toBeGreaterThanOrEqual(pageLayout.expectedGap - 0.5);
    }

    if (route.path.startsWith("/library")) {
      const libraryGap = await page
        .locator(".library-grid")
        .evaluate((element) => Number.parseFloat(getComputedStyle(element).rowGap));
      expect(libraryGap).toBeGreaterThanOrEqual(20);
    }
  }
});

test("Avatar Hub shows the preset image and keeps technical detail collapsed", async ({ page }) => {
  await page.goto("/avatars?fixture=avatar_profile_ready");
  await expect(page.getByRole("heading", { name: "Avatar Hub" })).toBeVisible();

  const avatarCard = page.locator("article").filter({ hasText: "Amish Farm Host" });
  await expect(avatarCard).toBeVisible();
  await expectImagesLoaded(avatarCard.getByRole("img", { name: "Amish Farm Host presenter" }));
  await expect(avatarCard).not.toContainText("READY");
  await expect(avatarCard).not.toContainText("PASSED");
  await expect(avatarCard).not.toContainText("Active v");

  const avatarGrid = page.locator(".avatar-card-grid");
  const [cardBounds, gridBounds] = await Promise.all([
    avatarCard.boundingBox(),
    avatarGrid.boundingBox(),
  ]);
  if (!cardBounds || !gridBounds) throw new Error("Avatar Hub card geometry is unavailable.");
  expect(cardBounds.width / gridBounds.width).toBeLessThanOrEqual(0.51);

  const detailsTrigger = avatarCard.getByRole("button", { name: /^Details/ });
  await expect(detailsTrigger).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("Profile hash", { exact: true })).toHaveCount(0);

  await detailsTrigger.click();
  const detailsSheet = page.getByRole("dialog", { name: "Amish Farm Host" });
  await expect(detailsSheet).toBeVisible();
  await expectFocusWithin(detailsSheet);
  await page.keyboard.press("Tab");
  await expectFocusWithin(detailsSheet);
  await expect(detailsSheet.getByText("Profile hash", { exact: true })).toBeVisible();
  await expect(detailsSheet.getByText("avatar_profile_version_fixture_001")).toBeVisible();
  await expectImagesLoaded(detailsSheet.getByRole("img", { name: /avatar crop$/ }));

  await page.keyboard.press("Escape");
  await expect(detailsSheet).toHaveCount(0);
  await expect(detailsTrigger).toBeFocused();

  await page.goto("/avatars?fixture=avatar_test_cancelled");
  const cancelledCard = page.locator("article").filter({ hasText: "Amish Farm Host" });
  await expect(cancelledCard.getByText("Test cancelled", { exact: true })).toBeVisible();
  await expect(cancelledCard.getByText("Ready", { exact: true })).toHaveCount(0);
});

test("Image Styles discloses four Warm Rural references and labels owned examples honestly", async ({
  page,
}) => {
  await page.goto("/styles?fixture=happy_generating");
  await expect(page.getByRole("heading", { name: "Image Styles" })).toBeVisible();

  const defaultCard = page.locator("article").filter({
    has: page.getByRole("heading", { name: "Authentic Documentary Stock" }),
  });
  const warmCard = page.locator("article").filter({
    has: page.getByRole("heading", { name: "Warm Rural Documentary" }),
  });

  await expectImagesLoaded(defaultCard.getByRole("img", { name: /cover$/ }));
  await expectImagesLoaded(warmCard.getByRole("img", { name: /cover$/ }));
  await expect(defaultCard).not.toContainText("Published v");
  await expect(warmCard).not.toContainText("Published v");
  const [defaultMediaHeight, warmMediaHeight] = await Promise.all([
    defaultCard.locator(".style-card-media").evaluate((element) => element.clientHeight),
    warmCard.locator(".style-card-media").evaluate((element) => element.clientHeight),
  ]);
  expect(defaultMediaHeight).toBe(warmMediaHeight);
  const defaultTrigger = defaultCard.getByRole("button", { name: /^Owned examples \(3\)/ });
  const warmTrigger = warmCard.getByRole("button", { name: /^References \(4\)/ });
  await expect(defaultTrigger).toBeVisible();
  await expect(warmTrigger).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("ref_01", { exact: true })).toHaveCount(0);

  await warmTrigger.click();
  const warmSheet = page.getByRole("dialog", { name: "Warm Rural Documentary" });
  await expect(warmSheet).toBeVisible();
  await expect(warmSheet.getByText("ref_01", { exact: true })).toBeVisible();
  await expect(warmSheet.getByText("ref_04", { exact: true })).toBeVisible();
  const references = warmSheet.getByRole("img", {
    name: /Warm Rural Documentary reference [1-4]/,
  });
  await expect(references).toHaveCount(4);
  await expectImagesLoaded(references);
  await page.keyboard.press("Escape");
  await expect(warmSheet).toHaveCount(0);
  await expect(warmTrigger).toBeFocused();

  await defaultTrigger.click();
  const defaultSheet = page.getByRole("dialog", { name: "Authentic Documentary Stock" });
  await expect(defaultSheet).toBeVisible();
  const examples = defaultSheet.getByRole("img", {
    name: /Authentic Documentary Stock owned example [1-3]/,
  });
  await expect(examples).toHaveCount(3);
  await expectImagesLoaded(examples);
  await expect(defaultSheet.getByText("SYSTEM_OWNED", { exact: false })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(defaultSheet).toHaveCount(0);
  await expect(defaultTrigger).toBeFocused();
});

test("Create Project uses exact visual presets and never exposes project-local avatar upload", async ({
  page,
}) => {
  await page.getByRole("link", { name: "New Project", exact: true }).click();
  await expect(page.getByRole("heading", { name: "New project" })).toBeVisible();

  const avatarPicker = page.locator("summary.visual-preset-summary").nth(0);
  const stylePicker = page.locator("summary.visual-preset-summary").nth(1);
  await expect(avatarPicker).toContainText("Amish Farm Host");
  await expect(stylePicker).toContainText("Authentic Documentary Stock");
  await expect(page.getByRole("radiogroup", { name: "Avatar Profile options" })).not.toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "Image Style options" })).not.toBeVisible();
  await expect(page.getByLabel("Exact script (optional)")).toHaveCount(0);
  await expect(page.getByText("Keywords not applied", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Keywords will be applied", { exact: true })).toHaveCount(0);
  await expect(page.locator('input[type="file"]')).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Upload final voiceover" })).toBeVisible();
  await expect(page.getByRole("button", { name: /upload avatar/i })).toHaveCount(0);
  await expect(page.locator("select")).toHaveCount(0);

  const avatarDetails = avatarPicker.locator("..");
  await avatarPicker.press("ArrowDown");
  const avatarOptions = page.getByRole("radiogroup", { name: "Avatar Profile options" });
  await expect(avatarOptions).toBeVisible();
  await expect(page.getByRole("radio", { name: /Amish Farm Host/ })).toBeFocused();
  await expect
    .poll(() =>
      avatarDetails.evaluate((element) => {
        const container = element.getBoundingClientRect();
        const menu = element.querySelector(".visual-preset-menu")?.getBoundingClientRect();
        return Boolean(menu && menu.top >= container.top && menu.bottom <= container.bottom + 1);
      }),
    )
    .toBe(true);
  await page.keyboard.press("Escape");
  await expect(avatarOptions).not.toBeVisible();
  await expect(avatarPicker).toBeFocused();

  const imageCompute = page.getByLabel("Image generation compute profile", { exact: true });
  await imageCompute.press("ArrowDown");
  await expect(
    page.getByRole("listbox", { name: "Image generation compute profile options" }),
  ).toBeVisible();
  await expect(page.getByRole("option", { name: /^Auto/ })).toBeFocused();
  await expect(page.getByRole("option", { name: /RTX 4090/ })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(imageCompute).toBeFocused();

  const keywordSummary = page.locator("summary.disclosure-summary").filter({
    hasText: "Image keywords",
  });
  await keywordSummary.click();
  const keywordDetails = keywordSummary.locator("..");
  await expect(page.getByLabel("Image keywords")).toBeVisible();
  await expect
    .poll(() =>
      keywordDetails.evaluate((element) => {
        const container = element.getBoundingClientRect();
        const content = element.querySelector(".disclosure-content")?.getBoundingClientRect();
        return Boolean(
          content && content.top >= container.top && content.bottom <= container.bottom + 1,
        );
      }),
    )
    .toBe(true);
  await page.keyboard.press("Escape");

  await stylePicker.press("ArrowDown");
  const documentary = page.getByRole("radio", { name: /Authentic Documentary Stock/ });
  const warmRural = page.getByRole("radio", { name: /Warm Rural Documentary/ });
  await expect(documentary).toHaveAttribute("aria-checked", "true");
  await expect(documentary).toBeFocused();
  await expectImagesLoaded(documentary.getByRole("img"));
  await documentary.press("ArrowDown");
  await expect(warmRural).toBeFocused();
  await warmRural.press("Enter");
  await expect(stylePicker).toContainText("Warm Rural Documentary");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const scope = new URL(window.location.href).searchParams.get("fixture") ?? "default";
        const draft = JSON.parse(
          localStorage.getItem(
            `videoforge:fixture:project-draft:v2:${encodeURIComponent(scope)}`,
          ) ?? "null",
        ) as { avatarProfileVersionId?: string; imageStyleVersionId?: string } | null;
        return {
          avatar: draft?.avatarProfileVersionId,
          style: draft?.imageStyleVersionId,
        };
      }),
    )
    .toEqual({
      avatar: "avatar_profile_version_fixture_001",
      style: "style_version_warm_rural_v1",
    });

  await stylePicker.click();
  await documentary.click();
  await expect(stylePicker).toContainText("Authentic Documentary Stock");

  await chooseFixture(page, "project_create_ready");
  await page.getByLabel("Video title").fill("Recognizing a Sweet Watermelon");
  await page.getByLabel("Upload final voiceover").setInputFiles({
    name: "acceptance-voiceover.wav",
    mimeType: "audio/wav",
    buffer: createPcmWavBuffer(),
  });
  await expect(page.locator(".dropzone")).toContainText("Verified and ready");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const scope = new URL(window.location.href).searchParams.get("fixture") ?? "default";
        const draft = JSON.parse(
          localStorage.getItem(
            `videoforge:fixture:project-draft:v2:${encodeURIComponent(scope)}`,
          ) ?? "null",
        ) as { voiceoverAssetId?: string; voiceoverChecksum?: string } | null;
        return {
          assetId: draft?.voiceoverAssetId,
          checksum: draft?.voiceoverChecksum,
        };
      }),
    )
    .toEqual({
      assetId: expect.stringMatching(/^fixture_voiceover_sha256_[a-f0-9]{64}$/u),
      checksum: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    });

  await page.getByLabel("Upload final voiceover").setInputFiles({
    name: "invalid-replacement.wav",
    mimeType: "audio/wav",
    buffer: Buffer.from("not a wave file"),
  });
  await expect(page.locator(".run-readiness")).toContainText(
    "The file contents do not match its audio extension.",
  );
  await expect(page.getByRole("button", { name: "Generate video" })).toBeDisabled();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const scope = new URL(window.location.href).searchParams.get("fixture") ?? "default";
        const draft = JSON.parse(
          localStorage.getItem(
            `videoforge:fixture:project-draft:v2:${encodeURIComponent(scope)}`,
          ) ?? "null",
        ) as { voiceoverAssetId?: string | null; voiceoverChecksum?: string | null } | null;
        return {
          assetId: draft?.voiceoverAssetId,
          checksum: draft?.voiceoverChecksum,
        };
      }),
    )
    .toEqual({ assetId: null, checksum: null });

  await page.getByLabel("Upload final voiceover").setInputFiles({
    name: "acceptance-voiceover.wav",
    mimeType: "audio/wav",
    buffer: createPcmWavBuffer(),
  });
  await page.getByLabel("Video title").fill("");
  await expect(page.locator(".run-readiness")).toContainText("Add a video title.");
  await expect(page.getByRole("button", { name: "Generate video" })).toBeDisabled();
  await page.getByLabel("Video title").fill("Recognizing a Sweet Watermelon");
  await expect(page.getByRole("button", { name: "Generate video" })).toBeEnabled();
  await page.getByRole("button", { name: "Generate video" }).click();
  await expect(page).toHaveURL(/\/projects\/project_fixture_001\?fixture=happy_generating/);
  await expect(page.getByRole("heading", { name: "Recognizing a Sweet Watermelon" })).toBeVisible();
});

test("project progress reaches review and records explicit approval", async ({ page }) => {
  await page.goto("/projects/project_fixture_001?fixture=project_ready_for_review");
  await expect(
    page.getByRole("heading", { name: "How to Recognize a Sweet Watermelon" }),
  ).toBeVisible();
  await expect(
    page.getByRole("progressbar", { name: "Project progress", exact: true }),
  ).toHaveAttribute("aria-valuenow", "100");
  await expect(page.getByRole("list", { name: "Project stages" })).toBeVisible();
  await expect(page.getByText("260 / 260", { exact: true })).toBeVisible();
  await expect(page.getByText("52 / 52", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Live preview" })).toBeVisible();

  await page.getByRole("link", { name: "Review output" }).click();
  await expect(page.getByRole("heading", { name: "Review", exact: true, level: 1 })).toBeVisible();
  await expect(page.getByText("Ready for review", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Download preview" })).toHaveCount(0);

  const approve = page.getByRole("button", { name: "Approve final" });
  await approve.click();
  await expect(page.getByRole("button", { name: "Approved" })).toBeDisabled();
  await expect(page.getByRole("link", { name: "Download preview" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Fixture record" })).toBeVisible();
});

test("scenario actions match authoritative project and review state", async ({ page }) => {
  await page.goto("/projects/project_fixture_001?fixture=happy_generating");
  await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Review output" })).toHaveCount(0);

  await page.goto("/projects/project_fixture_001?fixture=image_partial_failure");
  const retry = page.getByRole("button", { name: "Retry" });
  const cancelAfterRetry = page.getByRole("button", { name: "Cancel" });
  await expect(retry).toBeVisible();
  await expect(cancelAfterRetry).toBeVisible();
  await retry.click();
  await expect(retry).toHaveCount(0);
  await expect(cancelAfterRetry).toBeEnabled();

  await page.goto("/projects/project_fixture_001?fixture=cancel_requested");
  await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Cancel" })).toHaveCount(0);

  await page.goto("/projects/project_fixture_001/review?fixture=avatar_lip_failure");
  await expect(page.getByRole("button", { name: "Retry failed item" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve final" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Approve $0.18 fallback" })).toHaveCount(0);

  await page.goto("/projects/project_fixture_001/review?fixture=skyreels_approval_required");
  await expect(page.getByRole("button", { name: "Approve $0.18 fallback" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry failed item" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Approve final" })).toHaveCount(0);

  await page.goto("/projects/project_fixture_001/review?fixture=project_ready_for_review");
  await expect(page.getByRole("button", { name: "Approve final" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry failed item" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Approve $0.18 fallback" })).toHaveCount(0);

  await page.goto("/projects/project_fixture_001/review?fixture=project_approved");
  await expect(page.getByRole("button", { name: "Approved" })).toBeDisabled();
  await expect(page.getByRole("link", { name: "Download preview" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Fixture record" })).toBeVisible();
});

for (const viewport of [
  { name: "1024px", width: 1024, height: 900 },
  { name: "mobile", width: 430, height: 932 },
]) {
  test(`${viewport.name} layout stays keyboard reachable without horizontal overflow`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });

    for (const route of uiSurfaceRoutes) {
      await page.goto(route.path);
      await expect(page.locator("main")).toBeVisible();
      await expectNoHorizontalOverflow(page);
    }

    await page.goto("/avatars?fixture=avatar_profile_ready");
    const avatarMediaHeight = await page
      .locator(".avatar-card-media")
      .first()
      .evaluate((element) => element.getBoundingClientRect().height);
    await page.goto("/styles?fixture=happy_generating");
    const styleMediaHeight = await page
      .locator(".style-card-media")
      .first()
      .evaluate((element) => element.getBoundingClientRect().height);
    expect(styleMediaHeight).toBe(avatarMediaHeight);

    await page.keyboard.press("Home");
    await page.keyboard.press("Tab");
    await expect(page.locator(":focus")).toBeVisible();
    const navigation = page.getByRole("navigation", { name: "Primary navigation" });
    await expect(navigation.getByRole("link", { name: "Avatar Hub" })).toBeVisible();
    await expect(navigation.getByRole("link", { name: "Image Styles" })).toBeVisible();

    if (viewport.width === 430) {
      const warmCard = page.locator("article").filter({
        has: page.getByRole("heading", { name: "Warm Rural Documentary" }),
      });
      await warmCard.getByRole("button", { name: /^References \(4\)/ }).click();
      const sheet = page.getByRole("dialog", { name: "Warm Rural Documentary" });
      await expect(sheet).toBeVisible();
      await expectFocusWithin(sheet);
      await expect
        .poll(() =>
          sheet.evaluate((element) => {
            const bounds = element.getBoundingClientRect();
            return {
              bottom: Math.round(window.innerHeight - bounds.bottom),
              left: Math.round(bounds.left),
              right: Math.round(window.innerWidth - bounds.right),
              top: Math.round(bounds.top),
            };
          }),
        )
        .toEqual({ bottom: 0, left: 0, right: 0, top: 0 });
      await expectNoHorizontalOverflow(page);
      await page.keyboard.press("Escape");
      await expect(sheet).toHaveCount(0);
    }
  });
}

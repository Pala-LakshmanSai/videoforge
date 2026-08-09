import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const unexpectedRequests = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const externalRequests: string[] = [];
  unexpectedRequests.set(page, externalRequests);
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!["localhost", "127.0.0.1"].includes(url.hostname)) externalRequests.push(request.url());
  });
  await page.goto("/?fixture=happy_generating");
  await expect(page.getByText("Fixture mode", { exact: true })).toBeVisible();
  expect(externalRequests).toEqual([]);
});

test.afterEach(async ({ page }) => {
  expect(unexpectedRequests.get(page)).toEqual([]);
});

test("queue exposes truthful status and core navigation", async ({ page }) => {
  await expect(
    page.getByRole("heading", { name: "Every project, honestly tracked." }),
  ).toBeVisible();
  await expect(page.getByText("Synthetic data · $0 spend")).toBeVisible();
  await page.getByRole("link", { name: "Avatar Hub" }).click();
  await expect(page.getByRole("heading", { name: "Avatar Hub" })).toBeVisible();
  await page.getByRole("link", { name: "Image Styles" }).click();
  await expect(page.getByRole("heading", { name: "Image Styles Hub" })).toBeVisible();
});

test("create project pins presets and has no inline avatar upload", async ({ page }) => {
  await page.getByRole("link", { name: "New Project", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Create once. Let the lanes work." }),
  ).toBeVisible();
  await expect(page.getByLabel("Avatar Profile")).toBeVisible();
  await expect(page.getByLabel("Image Style")).toHaveValue("style_version_documentary_stock_v1");
  await expect(
    page.getByText("Not applied. Text is preserved and sent to neither DeepSeek nor Mage."),
  ).toBeVisible();
  await expect(page.getByLabel(/avatar.*upload/i)).toHaveCount(0);
  await page.getByRole("switch").click();
  await expect(
    page.getByText("Applied once to image prompts. Permanent no-text guardrails still win."),
  ).toBeVisible();
  await page.getByLabel("Scenario").selectOption("project_create_ready");
  await expect(page).toHaveURL(/fixture=project_create_ready/);
  await page.getByLabel("Video title").fill("Recognizing a Sweet Watermelon");
  await page.getByLabel("Upload final voiceover").setInputFiles({
    name: "acceptance-voiceover.wav",
    mimeType: "audio/wav",
    buffer: Buffer.from("RIFF fixture voiceover"),
  });
  await page.getByLabel("Avatar Profile").selectOption("avatar_profile_version_fixture_001");
  await expect(page.getByRole("button", { name: "Generate video" })).toBeEnabled();
  await page.getByRole("button", { name: "Generate video" }).click();
  await expect(page).toHaveURL(/\/projects\/project_fixture_001\?fixture=happy_generating/);
  await expect(
    page.getByRole("heading", { name: "How to Recognize a Sweet Watermelon" }),
  ).toBeVisible();
});

test("project progress reaches review and explicit approval", async ({ page }) => {
  await page.goto("/projects/project_fixture_001?fixture=project_ready_for_review");
  await expect(
    page.getByText(/Overall progress is computed from versioned stage weights/),
  ).toBeVisible();
  await page.getByRole("link", { name: "Open review strip" }).click();
  await expect(page.getByRole("heading", { name: "Ready for your review." })).toBeVisible();
  await expect(page.getByText("Three layouts only")).toBeVisible();
  await page.getByRole("button", { name: "Approve final" }).click();
  await expect(page.getByRole("heading", { name: "Approved and provenance-bound." })).toBeVisible();
});

test("1024px navigation remains keyboard reachable", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toBeVisible();
  await expect(page.getByRole("link", { name: "Avatar Hub" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Image Styles" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
});

import { expect, test, type Locator, type Page } from "@playwright/test";

interface RuntimeFailures {
  consoleErrors: string[];
  externalRequests: string[];
  failedResponses: string[];
  pageErrors: string[];
}

const runtimeFailures = new WeakMap<Page, RuntimeFailures>();

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
  const scenario = page.getByLabel("Scenario");
  if (!(await scenario.isVisible())) {
    await page.getByText("Fixture mode", { exact: true }).click();
  }
  await scenario.selectOption(fixture);
  await expect(page).toHaveURL(new RegExp(`fixture=${fixture}`));
}

test.beforeEach(async ({ page }) => {
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

test("Avatar Hub shows the preset image and keeps technical detail collapsed", async ({ page }) => {
  await page.goto("/avatars?fixture=avatar_profile_ready");
  await expect(page.getByRole("heading", { name: "Avatar Hub" })).toBeVisible();

  const avatarCard = page.locator("article").filter({ hasText: "Amish Farm Host" });
  await expect(avatarCard).toBeVisible();
  await expectImagesLoaded(avatarCard.getByRole("img", { name: "Amish Farm Host presenter" }));

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

  const avatar = page.getByRole("radio", { name: /Amish Farm Host/ });
  const documentary = page.getByRole("radio", { name: /Authentic Documentary Stock/ });
  const warmRural = page.getByRole("radio", { name: /Warm Rural Documentary/ });
  await expect(avatar).toHaveAttribute("aria-checked", "true");
  await expect(documentary).toHaveAttribute("aria-checked", "true");
  await expectImagesLoaded(avatar.getByRole("img"));
  await expectImagesLoaded(documentary.getByRole("img"));
  await expect(page.locator('input[type="file"]')).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Upload final voiceover" })).toBeVisible();
  await expect(page.getByRole("button", { name: /upload avatar/i })).toHaveCount(0);

  await warmRural.click();
  await expect(warmRural).toHaveAttribute("aria-checked", "true");
  await expect(documentary).toHaveAttribute("aria-checked", "false");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const draft = JSON.parse(
          localStorage.getItem("videoforge:fixture:project-draft:v1") ?? "null",
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

  await documentary.click();
  await expect(documentary).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("Keywords not applied", { exact: true })).toBeVisible();

  await chooseFixture(page, "project_create_ready");
  await page.getByLabel("Video title").fill("Recognizing a Sweet Watermelon");
  await page.getByLabel("Upload final voiceover").setInputFiles({
    name: "acceptance-voiceover.wav",
    mimeType: "audio/wav",
    buffer: Buffer.from("RIFF fixture voiceover"),
  });
  await expect(page.getByRole("button", { name: "Generate video" })).toBeEnabled();
  await page.getByRole("button", { name: "Generate video" }).click();
  await expect(page).toHaveURL(/\/projects\/project_fixture_001\?fixture=happy_generating/);
  await expect(
    page.getByRole("heading", { name: "How to Recognize a Sweet Watermelon" }),
  ).toBeVisible();
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
  await expect(page.getByRole("link", { name: "Fixture preview" })).toHaveCount(0);

  const approve = page.getByRole("button", { name: "Approve final" });
  await approve.click();
  await expect(approve).toBeDisabled();
  await expect(page.getByRole("button", { name: "Approved" })).toBeDisabled();
  await expect(page.getByRole("link", { name: "Fixture preview" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Manifest" })).toBeVisible();
});

for (const viewport of [
  { name: "1024px", width: 1024, height: 900 },
  { name: "mobile", width: 430, height: 932 },
]) {
  test(`${viewport.name} layout stays keyboard reachable without horizontal overflow`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });

    for (const route of [
      "/?fixture=happy_generating",
      "/projects/project_fixture_001?fixture=happy_generating",
      "/avatars?fixture=avatar_profile_ready",
      "/styles?fixture=happy_generating",
    ]) {
      await page.goto(route);
      await expect(page.locator("main")).toBeVisible();
      await expectNoHorizontalOverflow(page);
    }

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

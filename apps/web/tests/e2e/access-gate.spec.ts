import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ request }) => {
  const response = await request.post("/api/dev/shared-app/reset", {
    headers: { "X-VideoForge-Fixture-Control": "v2-provider-free-fixture-v1" },
  });
  expect(response.ok()).toBe(true);
});

function observeRuntime(page: Page) {
  const errors: string[] = [];
  const externalRequests: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!["localhost", "127.0.0.1"].includes(url.hostname)) externalRequests.push(request.url());
  });

  return { errors, externalRequests };
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    )
    .toBe(true);
}

test("synthetic invited account enters the queue without an external auth request", async ({
  page,
}) => {
  const runtime = observeRuntime(page);
  await page.goto("/?fixture=invite_sign_in");

  await expect(page.getByRole("heading", { name: "Enter VideoForge" })).toBeVisible();
  await expect(page.getByText("Fixture sign-in · no Google request will be sent")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary navigation" })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  const continueButton = page.getByRole("button", { name: "Continue to queue" });
  await page.getByRole("button", { name: "Create one-time local invite" }).click();
  await expect(page.getByLabel("One-time invite code")).not.toHaveValue("");
  await continueButton.focus();
  await expect(continueButton).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/?\?fixture=happy_generating$/u);
  await expect(page.getByRole("heading", { name: "Queue", exact: true })).toBeVisible();
  expect(runtime.externalRequests).toEqual([]);
  expect(runtime.errors).toEqual([]);
});

test("uninvited account exposes only the precise invite blocker", async ({ page, request }) => {
  const runtime = observeRuntime(page);
  await page.setViewportSize({ width: 430, height: 932 });
  await page.goto("/?fixture=invite_access_denied");

  await expect(page.getByRole("heading", { name: "Invite required" })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("Workspace invite missing");
  await expect(
    page.getByText("This account has not been invited to this workspace."),
  ).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary navigation" })).toHaveCount(0);
  await expect(page.getByText("How to Recognize a Sweet Watermelon")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  const bootstrap = await request.get("/api/v1/bootstrap?fixture=invite_access_denied");
  expect(bootstrap.ok()).toBe(true);
  const body = (await bootstrap.json()) as {
    access: { state: string };
    projects: unknown[];
    avatars: unknown[];
    styles: unknown[];
    usage: { currentMonth: number; gpuSeconds: number; storageGb: number };
    draft: { title: string; voiceover: { assetId: string | null } };
  };
  expect(body.access.state).toBe("DENIED");
  expect(body.projects).toEqual([]);
  expect(body.avatars).toEqual([]);
  expect(body.styles).toEqual([]);
  expect(body.usage).toMatchObject({ currentMonth: 0, gpuSeconds: 0, storageGb: 0 });
  expect(body.draft).toMatchObject({ title: "", voiceover: { assetId: null } });

  for (const path of [
    "/api/v1/projects",
    "/api/v1/avatar-profiles",
    "/api/v1/image-styles",
    "/api/v1/usage",
    "/api/v1/execution-profiles",
  ]) {
    const response = await request.get(`${path}?fixture=invite_access_denied`);
    expect(response.status(), `${path} must stay behind the access boundary`).toBe(403);
    const problem = await response.json();
    expect(problem).toMatchObject({
      error: { code: "WORKSPACE_ACCESS_REQUIRED", retryable: false },
    });
  }

  const retry = page.getByRole("button", { name: "Try another account" });
  await retry.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/fixture=invite_sign_in/u);
  await expect(page.getByRole("heading", { name: "Enter VideoForge" })).toBeVisible();
  expect(runtime.externalRequests).toEqual([]);
  expect(runtime.errors).toEqual([]);
});

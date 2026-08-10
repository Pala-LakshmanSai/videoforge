import { expect, test } from "@playwright/test";

const projectPath = "/projects/project_fixture_001";

test("installed Chrome renders pending, reconciling, failed, cancelled, and ready recovery truth", async ({
  page,
}) => {
  await page.goto(`${projectPath}?fixture=happy_generating`);
  await expect(
    page.getByRole("heading", { name: "How to Recognize a Sweet Watermelon" }),
  ).toBeVisible();
  await expect(page.getByText("PENDING", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Authoritative project state", { exact: true })).toBeVisible();

  await page.goto(`${projectPath}?fixture=dispatch_ack_unknown`);
  await expect(page.getByText("RECONCILING", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Checking durable worker truth", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Confirming whether dispatch started.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0);

  await page.goto(`${projectPath}?fixture=project_failed`);
  await expect(page.getByText("FAILED", { exact: true }).first()).toBeVisible();
  await expect(
    page.getByText("Accepted partial artifacts and the $0.23 settled cost", { exact: false }),
  ).toBeVisible();
  await expect(page.getByText("ETA Stopped", { exact: true })).toBeVisible();
  await expect(page.getByText("no work active", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Cancel" })).toHaveCount(0);

  await page.goto(`${projectPath}?fixture=project_cancelled`);
  await expect(page.getByText("CANCELLED", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Run stopped before completion", { exact: true })).toBeVisible();
  await expect(page.getByText("No work remains active.", { exact: false })).toBeVisible();
  await expect(page.getByText("ETA Stopped", { exact: true })).toBeVisible();
  await expect(page.getByText("no work active", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0);

  await page.goto(`${projectPath}?fixture=project_ready_for_review`);
  await expect(page.getByText("READY FOR REVIEW", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Human approval required", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Review output" })).toBeVisible();
  await expect(
    page.getByRole("progressbar", { name: "Project progress", exact: true }),
  ).toHaveAttribute("aria-valuenow", "100");
});

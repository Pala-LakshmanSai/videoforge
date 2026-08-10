import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

interface RuntimeFailures {
  readonly consoleErrors: string[];
  readonly externalRequests: string[];
  readonly failedResponses: string[];
  readonly pageErrors: string[];
}

function isLoopback(url: string): boolean {
  const parsed = new URL(url);
  return new Set(["localhost", "127.0.0.1", "::1"]).has(parsed.hostname);
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

test("installed Chrome inspects and accepts the restart-safe real-audio timeline", async ({
  page,
}) => {
  const failures: RuntimeFailures = {
    consoleErrors: [],
    externalRequests: [],
    failedResponses: [],
    pageErrors: [],
  };
  page.on("request", (request) => {
    if (!isLoopback(request.url())) failures.externalRequests.push(request.url());
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      failures.failedResponses.push(`${String(response.status())} ${response.url()}`);
    }
  });
  page.on("console", (message) => {
    if (message.type() === "error") failures.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => failures.pageErrors.push(error.message));

  await page.goto("/projects/new");
  await expect(page.getByText("Local media mode", { exact: true })).toBeVisible();
  const generate = page.getByRole("button", { name: "Generate video" });
  await expect(generate).toBeEnabled();
  await generate.click();
  await expect(page).toHaveURL(/\/projects\/project_local_owned_001(?:\?|$)/u);

  const inspection = page.locator(".timeline-inspection");
  await expect(inspection.getByText("Current revision is fully covered")).toBeVisible({
    timeout: 5 * 60 * 1_000,
  });
  await expect(inspection.getByText("Local persisted", { exact: true })).toBeVisible();
  await expect(
    inspection.getByText(/^[1-9][0-9]*\/[1-9][0-9]* spans materialized$/u),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Review output" })).toBeVisible();

  const inspectionResponse = await page.request.get(
    "/api/v1/projects/project_local_owned_001/timeline-inspection",
  );
  expect(inspectionResponse.ok()).toBe(true);
  const inspectionBody = (await inspectionResponse.json()) as {
    ready: boolean;
    invalidation: { state: string; recomputeRequired: boolean };
    blockers: readonly string[];
    documents: { transcriptSha256: string; timelineSha256: string };
    selectedAvatar: {
      count: number;
      materializedCount: number;
      spans: readonly { audioSha256: string }[];
    };
  };
  expect(inspectionBody.ready).toBe(true);
  expect(inspectionBody.invalidation).toEqual({
    state: "CURRENT",
    recomputeRequired: false,
    reason: null,
  });
  expect(inspectionBody.blockers).toEqual([]);
  expect(inspectionBody.selectedAvatar.materializedCount).toBe(inspectionBody.selectedAvatar.count);
  expect(inspectionBody.selectedAvatar.spans).toHaveLength(inspectionBody.selectedAvatar.count);
  for (const span of inspectionBody.selectedAvatar.spans) {
    expect(span.audioSha256).toMatch(/^sha256:[a-f0-9]{64}$/u);
  }

  const phraseDetails = inspection.locator(".timeline-phrase-disclosure");
  const phraseSummary = phraseDetails.locator("summary");
  await phraseSummary.focus();
  await expect(phraseSummary).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(phraseDetails).toHaveAttribute("open", "");
  await page.keyboard.press("Escape");
  await expect(phraseDetails).not.toHaveAttribute("open", "");
  await expect(phraseSummary).toBeFocused();
  await expectNoHorizontalOverflow(page);

  const unnamedControls = await page
    .locator("button, a[href], input, select, textarea, summary")
    .evaluateAll((elements) =>
      elements.flatMap((element) => {
        const inputLabels = element instanceof HTMLInputElement ? (element.labels?.length ?? 0) : 0;
        const name = [
          element.textContent,
          element.getAttribute("aria-label"),
          element.getAttribute("title"),
          element.getAttribute("placeholder"),
        ]
          .filter(Boolean)
          .join("")
          .trim();
        return name.length > 0 || inputLabels > 0 ? [] : [element.outerHTML.slice(0, 200)];
      }),
    );
  expect(unnamedControls).toEqual([]);

  const projectResponse = await page.request.get("/api/v1/projects/project_local_owned_001");
  expect(projectResponse.ok()).toBe(true);
  const project = (await projectResponse.json()) as {
    project: { latestArtifact: { sha256: string; bytes: number } };
  };
  const video = page.locator("video").first();
  await expect(video).toBeVisible();
  await video.evaluate(async (element: HTMLVideoElement) => {
    element.muted = true;
    await element.play();
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(
        () => reject(new Error("Playback did not advance.")),
        10_000,
      );
      const poll = () => {
        if (element.currentTime > 0.1) {
          window.clearTimeout(timeout);
          resolve();
          return;
        }
        window.setTimeout(poll, 50);
      };
      poll();
    });
    element.pause();
  });

  await page.getByRole("link", { name: "Review output" }).click();
  await expect(page.getByRole("button", { name: "Approve final" })).toBeVisible();
  await page.getByRole("button", { name: "Approve final" }).click();
  const downloadLink = page.getByRole("link", { name: "Download MP4" });
  await expect(downloadLink).toBeVisible();
  await expect(downloadLink).toHaveAttribute(
    "href",
    "/api/v1/projects/project_local_owned_001/download",
  );
  const downloadPromise = page.waitForEvent("download");
  await downloadLink.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("videoforge-local-owned-slice.mp4");
  const downloadedPath = await download.path();
  expect(downloadedPath).not.toBeNull();
  const downloadedBytes = await readFile(downloadedPath!);
  expect(downloadedBytes.byteLength).toBe(project.project.latestArtifact.bytes);
  expect(`sha256:${createHash("sha256").update(downloadedBytes).digest("hex")}`).toBe(
    project.project.latestArtifact.sha256,
  );

  expect(failures).toEqual({
    consoleErrors: [],
    externalRequests: [],
    failedResponses: [],
    pageErrors: [],
  });
});

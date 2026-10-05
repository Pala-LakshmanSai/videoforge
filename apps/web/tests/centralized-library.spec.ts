import { expect, test } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
let mediaServer: Server;
let mediaOrigin: string;
import { tmpdir } from "node:os";
import { join } from "node:path";
let temporary: string;
let bytes: Buffer;
const creators = [
  {
    creator_id: "00000000-0000-4000-8000-000000000001",
    creator_name: "Alex",
    creator_email: "alex@example.test",
  },
  {
    creator_id: "00000000-0000-4000-8000-000000000002",
    creator_name: "Maya",
    creator_email: "maya@example.test",
  },
];
const outputs = Array.from({ length: 6 }, (_, index) => ({
  ...creators[index % 2]!,
  attempt_id: `00000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`,
  title: `${index % 2 ? "Harbor" : "Workshop"} film ${index + 1}`,
  created_at: "2026-10-05T09:00:00Z",
  content_length: 12_000_000,
  available: true,
  watch_url: `/api/v2/centralized-library/${index + 100}/watch`,
  download_url: `/api/v2/centralized-library/${index + 100}/download`,
}));
test.beforeAll(async () => {
  temporary = mkdtempSync(join(tmpdir(), "videoforge-centralized-"));
  const path = join(temporary, "fixture.mp4");
  const result = spawnSync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=640x360:rate=24",
    "-t",
    "2",
    "-an",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    path,
  ]);
  expect(result.status, String(result.stderr)).toBe(0);
  bytes = readFileSync(path);
  // Native download transport cannot be fulfilled reliably through Playwright routing.
  mediaServer = createServer((request, response) => {
    response.writeHead(200, {
      "content-type": "video/mp4",
      "content-length": String(bytes.length),
      "content-disposition": `${request.url?.endsWith("download") ? "attachment" : "inline"}; filename="fixture.mp4"`,
    });
    response.end(bytes);
  });
  await new Promise<void>((resolve) => mediaServer.listen(0, "127.0.0.1", resolve));
  const address = mediaServer.address();
  if (!address || typeof address === "string") throw new Error("Fixture listener unavailable");
  mediaOrigin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  if (mediaServer) await new Promise<void>((resolve) => mediaServer.close(() => resolve()));
  if (temporary) rmSync(temporary, { recursive: true, force: true });
});
test("owner collection supports search, creator filters, keyboard playback and exact MP4 download", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/v2/tenant")
      return route.fulfill({
        json: {
          schema_version: "videoforge-hosted-tenant/v1",
          account_id: creators[0]!.creator_id,
          workspace_id: creators[1]!.creator_id,
          workspace_name: "Synthetic Chrome fixture",
          can_view_centralized_library: true,
          user: { id: "owner", email: "demo9gss@gmail.com", name: "Owner" },
        },
      });
    if (url.pathname === "/api/v2/hosted/status")
      return route.fulfill({
        json: { authentication: ["GOOGLE"], environment: "staging", commit: "centralized-chrome" },
      });
    if (url.pathname === "/api/v2/hosted/projects")
      return route.fulfill({
        json: { projects: [{ id: "00000000-0000-4000-8000-000000000999" }] },
      });
    if (url.pathname === "/api/v2/centralized-library") {
      const matches = outputs.filter(
        (video) =>
          (!url.searchParams.get("creator") ||
            video.creator_id === url.searchParams.get("creator")) &&
          video.title.toLowerCase().includes((url.searchParams.get("search") ?? "").toLowerCase()),
      );
      return route.fulfill({
        json: {
          outputs: matches.map((video) => ({ ...video, download_url: `${mediaOrigin}/download` })),
          total: matches.length,
          total_videos: 6,
          total_bytes: 72_000_000,
          creators,
          page_size: 48,
        },
      });
    }
    if (url.pathname.endsWith("/watch") || url.pathname.endsWith("/download"))
      return route.fulfill({
        status: 200,
        body: bytes,
        headers: {
          "content-type": "video/mp4",
          "accept-ranges": "bytes",
          "content-disposition": `${url.pathname.endsWith("/download") ? "attachment" : "inline"}; filename="fixture.mp4"`,
        },
      });
    return route.fulfill({ status: 404, json: { error: { code: "UNEXPECTED_FIXTURE_REQUEST" } } });
  });
  await page.goto("/centralized-library");
  await expect(page.locator(".central-video")).toHaveCount(6);
  const dock = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(
    dock.getByRole("link", { name: "Centralized Library", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("collection.png"), fullPage: true });
  await page.getByRole("searchbox", { name: "Search videos" }).fill("no-match");
  await expect(page.getByText("No videos match", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.locator(".central-video")).toHaveCount(6);
  await page
    .getByRole("combobox", { name: "Filter by creator" })
    .selectOption(creators[1]!.creator_id);
  await expect(page.locator(".central-video")).toHaveCount(3);
  await page.getByRole("searchbox", { name: "Search videos" }).fill("film 2");
  await expect(page.locator(".central-video")).toHaveCount(1);
  const trigger = page.getByRole("button", { name: "Watch Harbor film 2", exact: true });
  await trigger.focus();
  await trigger.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Harbor film 2" });
  await expect(dialog).toBeVisible();
  await expect
    .poll(() =>
      dialog.locator("video").evaluate((video) => ({
        ended: (video as HTMLVideoElement).ended,
        error: (video as HTMLVideoElement).error?.code ?? null,
      })),
    )
    .toEqual({ ended: true, error: null });
  const downloadEvent = page.waitForEvent("download");
  await dialog.getByRole("link", { name: "Download MP4" }).click();
  const download = await downloadEvent;
  expect(await download.failure()).toBeNull();
  const path = await download.path();
  expect(download.suggestedFilename()).toBe("fixture.mp4");
  expect(path).not.toBeNull();
  expect(createHash("sha256").update(readFileSync(path!)).digest("hex")).toBe(
    createHash("sha256").update(bytes).digest("hex"),
  );
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  expect(errors).toEqual([]);
});
test("another team manager cannot see the dock option or request the collection", async ({
  page,
}) => {
  let requested = false;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v2/centralized-library") {
      requested = true;
      return route.fulfill({
        status: 403,
        json: { error: { code: "CENTRALIZED_LIBRARY_FORBIDDEN" } },
      });
    }
    if (path === "/api/v2/tenant")
      return route.fulfill({
        json: {
          schema_version: "videoforge-hosted-tenant/v1",
          account_id: creators[0]!.creator_id,
          workspace_id: creators[1]!.creator_id,
          workspace_name: "Private studio",
          can_manage_team: true,
          can_view_centralized_library: false,
          user: { id: "other", email: "lakshman121@gmail.com", name: "Other manager" },
        },
      });
    if (path === "/api/v2/hosted/status")
      return route.fulfill({
        json: { authentication: ["GOOGLE"], environment: "staging", commit: "centralized-chrome" },
      });
    return route.fulfill({ json: { projects: [] } });
  });
  await page.goto("/centralized-library");
  await expect(page.getByText("Owner access only")).toBeVisible();
  await expect(page.getByRole("link", { name: "Centralized Library", exact: true })).toHaveCount(0);
  expect(requested).toBe(false);
  await expect(page.getByRole("link", { name: "Library", exact: true })).toBeVisible();
});

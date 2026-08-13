import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { expect, test, type APIRequestContext, type BrowserContext } from "@playwright/test";

const FIXTURE = "invite_sign_in";

async function admit(
  context: BrowserContext,
  email: string,
  method: "EMAIL_PASSWORD" | "GOOGLE",
): Promise<void> {
  const inviteResponse = await context.request.post("/api/dev/shared-app/invites", {
    data: { email },
  });
  expect(inviteResponse.ok()).toBe(true);
  const invite = (await inviteResponse.json()) as {
    code: string;
    emailPassword: string;
    googleAssertion: string;
  };
  const response = await context.request.post(
    `/api/v1/shared-app/authenticate?fixture=${FIXTURE}`,
    {
      data: {
        method,
        email,
        emailPassword: method === "EMAIL_PASSWORD" ? invite.emailPassword : undefined,
        googleAccountEmail: method === "GOOGLE" ? email : undefined,
        googleAssertion: method === "GOOGLE" ? invite.googleAssertion : undefined,
        inviteCode: invite.code,
      },
    },
  );
  expect(response.ok()).toBe(true);
}

async function shared(request: APIRequestContext) {
  return (await (await request.get(`/api/v1/shared-app?fixture=${FIXTURE}`)).json()) as {
    inventory: Array<{ lane: string; receiptId: string }>;
    session: { queueVersion: number } | null;
    queue: Array<{ id: string; projectId: string; state: string }>;
    orchestration: {
      session: null | {
        sessionId: string;
        activeProjectId: string;
        lanes: {
          mage_image: {
            volumeId: string;
            selectedGpuSku: string;
            attempts: Array<{ podId: string; phase: string }>;
          };
          echo_avatar: {
            volumeId: string;
            selectedGpuSku: string;
            attempts: Array<{ podId: string; phase: string }>;
          };
        };
      };
      projects: Array<{
        projectId: string;
        stage: string;
        finalAsset: null | { sha256: string; byteSize: number; downloadPath: string };
      }>;
    };
  };
}

test("CP-05 completes three serial $0 projects across sessions with exact drain and MP4 playback", async ({
  browser,
}) => {
  const contextA = await browser.newContext({
    baseURL: "http://localhost:4173",
    extraHTTPHeaders: { "X-VideoForge-Fixture-Session": "cp05-chrome-a" },
  });
  const contextB = await browser.newContext({
    baseURL: "http://localhost:4173",
    extraHTTPHeaders: { "X-VideoForge-Fixture-Session": "cp05-chrome-b" },
  });
  const contextC = await browser.newContext({
    baseURL: "http://localhost:4173",
    extraHTTPHeaders: { "X-VideoForge-Fixture-Session": "cp05-chrome-c" },
  });
  const contexts = [contextA, contextB, contextC] as const;
  const consoleErrors: string[] = [];
  try {
    expect((await contextA.request.post("/api/dev/shared-app/reset")).ok()).toBe(true);
    await Promise.all([
      admit(contextA, "cp05-a@example.test", "EMAIL_PASSWORD"),
      admit(contextB, "cp05-b@example.test", "GOOGLE"),
      admit(contextC, "cp05-c@example.test", "EMAIL_PASSWORD"),
    ]);
    const initial = await shared(contextA.request);
    const imageReceiptId = initial.inventory.find(
      (offer) => offer.lane === "image_media",
    )!.receiptId;
    const avatarReceiptId = initial.inventory.find(
      (offer) => offer.lane === "avatar_primary",
    )!.receiptId;
    for (let index = 1; index <= 4; index += 1) {
      const context = contexts[(index - 1) % contexts.length]!;
      const response = await context.request.post(
        `/api/v1/shared-app/generate?fixture=${FIXTURE}`,
        {
          data: {
            projectId: `cp05-project-${index}`,
            title: `CP-05 Project ${index}`,
            imageReceiptId,
            avatarReceiptId,
          },
        },
      );
      expect(response.ok()).toBe(true);
    }

    let state = await shared(contextB.request);
    const fourth = state.queue.find((entry) => entry.projectId === "cp05-project-4")!;
    const moved = await contextB.request.patch(
      `/api/v1/shared-app/queue/${fourth.id}?fixture=${FIXTURE}`,
      { data: { toPosition: 2, queueVersion: state.session!.queueVersion } },
    );
    expect(moved.ok()).toBe(true);
    state = await shared(contextC.request);
    const removed = state.queue.find((entry) => entry.projectId === "cp05-project-3")!;
    const removeResponse = await contextC.request.delete(
      `/api/v1/shared-app/queue/${removed.id}?fixture=${FIXTURE}&queueVersion=${state.session!.queueVersion}`,
    );
    expect(removeResponse.ok()).toBe(true);
    expect((await shared(contextA.request)).queue.map((entry) => entry.projectId)).toEqual([
      "cp05-project-1",
      "cp05-project-4",
      "cp05-project-2",
    ]);
    expect((await contextA.request.post("/api/dev/shared-app/recover")).ok()).toBe(true);

    state = await shared(contextA.request);
    const session = state.orchestration.session!;
    const mage = session.lanes.mage_image;
    const echo = session.lanes.echo_avatar;
    const callbackBase = {
      sessionId: session.sessionId,
      projectId: session.activeProjectId,
      lane: "mage_image",
      podId: mage.attempts.at(-1)!.podId,
      gpuSku: mage.selectedGpuSku,
      volumeId: mage.volumeId,
      sequence: 1,
    };
    for (const callback of [
      { ...callbackBase, podId: "wrong-pod" },
      { ...callbackBase, gpuSku: "NVIDIA WRONG GPU" },
      { ...callbackBase, volumeId: echo.volumeId },
    ]) {
      const response = await contextA.request.post("/api/dev/shared-app/callback", {
        data: callback,
      });
      expect(response.status()).toBe(409);
    }
    expect(
      (await contextA.request.post("/api/dev/shared-app/callback", { data: callbackBase })).ok(),
    ).toBe(true);
    expect(
      (
        await contextA.request.post("/api/dev/shared-app/callback", { data: callbackBase })
      ).status(),
    ).toBe(409);

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    for (const page of [pageA, pageB]) {
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      await page.goto(`/?fixture=${FIXTURE}`);
      await expect(page.getByRole("heading", { name: "Synthetic lane truth" })).toBeVisible();
      await expect(page.getByText("Creating", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("$0 fixture", { exact: true })).toBeVisible();
    }

    for (let index = 0; index < 80; index += 1) {
      state = await shared(contextA.request);
      if (state.orchestration.session === null) break;
      const advanced = await contextA.request.post("/api/dev/shared-app/advance");
      expect(advanced.ok()).toBe(true);
    }
    state = await shared(contextC.request);
    expect(state.orchestration.session).toBeNull();
    expect(state.queue).toEqual([]);
    const completed = state.orchestration.projects.filter(
      (project) => project.stage === "READY_FOR_REVIEW",
    );
    expect(completed.map((project) => project.projectId)).toEqual([
      "cp05-project-1",
      "cp05-project-2",
      "cp05-project-4",
    ]);

    await pageA.reload();
    await expect(pageA.getByRole("heading", { name: "Last session closed" })).toBeVisible();
    await expect(pageA.getByRole("heading", { name: "Provider-free final MP4s" })).toBeVisible();
    const videos = pageA.locator("video");
    await expect(videos).toHaveCount(3);
    const playback = await videos.first().evaluate(async (element) => {
      const video = element as HTMLVideoElement;
      video.muted = true;
      await new Promise<void>((resolve, reject) => {
        if (video.readyState >= 1) return resolve();
        video.addEventListener("loadedmetadata", () => resolve(), { once: true });
        video.addEventListener("error", () => reject(new Error("MP4 metadata failed")), {
          once: true,
        });
      });
      await video.play();
      await new Promise((resolve) => setTimeout(resolve, 150));
      video.pause();
      return {
        duration: video.duration,
        currentTime: video.currentTime,
        width: video.videoWidth,
        height: video.videoHeight,
      };
    });
    expect(playback.duration).toBe(1);
    expect(playback.currentTime).toBeGreaterThan(0);
    expect(playback.width).toBe(1920);
    expect(playback.height).toBe(1080);

    const [download] = await Promise.all([
      pageA.waitForEvent("download"),
      pageA.getByRole("link", { name: "Download MP4" }).first().click(),
    ]);
    const downloadPath = await download.path();
    expect(downloadPath).not.toBeNull();
    const bytes = await readFile(downloadPath!);
    expect(bytes.byteLength).toBe(completed[0]!.finalAsset!.byteSize);
    expect(`sha256:${createHash("sha256").update(bytes).digest("hex")}`).toBe(
      completed[0]!.finalAsset!.sha256,
    );

    const pageC = await contextC.newPage();
    pageC.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    await pageC.goto(`/?fixture=${FIXTURE}`);
    await expect(pageC.getByRole("heading", { name: "Last session closed" })).toBeVisible();
    await expect(pageC.locator("video")).toHaveCount(3);
    expect(consoleErrors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

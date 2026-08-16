import { createHash } from "node:crypto";

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
        finalAsset: null | {
          sha256: string;
          byteSize: number;
          downloadPath: string;
          renderer: string;
        };
      }>;
    };
  };
}

test("CP-05 completes three serial $0 projects across sessions with exact drain and MP4 playback", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const contextA = await browser.newContext({
    baseURL: "http://localhost:4173",
    extraHTTPHeaders: {
      "X-VideoForge-Fixture-Session": "cp05-chrome-a",
      "X-VideoForge-Fixture-Control": "cp05-fixture-control-v1",
    },
  });
  const contextB = await browser.newContext({
    baseURL: "http://localhost:4173",
    extraHTTPHeaders: {
      "X-VideoForge-Fixture-Session": "cp05-chrome-b",
      "X-VideoForge-Fixture-Control": "cp05-fixture-control-v1",
    },
  });
  const contextC = await browser.newContext({
    baseURL: "http://localhost:4173",
    extraHTTPHeaders: {
      "X-VideoForge-Fixture-Session": "cp05-chrome-c",
      "X-VideoForge-Fixture-Control": "cp05-fixture-control-v1",
    },
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
        `/api/v2/generation-requests?fixture=${FIXTURE}`,
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

    let state = await shared(contextA.request);
    const fourth = state.queue.find((entry) => entry.projectId === "cp05-project-4")!;
    const moved = await contextA.request.patch(
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
    ]);
    expect((await shared(contextB.request)).queue.map((entry) => entry.projectId)).toEqual([
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
    for (const page of [pageA]) {
      page.on("console", (message) => {
        if (message.type() === "error")
          consoleErrors.push(`${message.text()} @ ${message.location().url}`);
      });
      await page.goto(`/?fixture=${FIXTURE}`);
      await expect(page.getByRole("heading", { name: "Your generation queue" })).toBeVisible();
      await expect(page.getByText("Private fair admission", { exact: true })).toBeVisible();
      await expect(page.getByText(/GPU|Pod|RunPod/u)).toHaveCount(0);
    }

    for (let index = 0; index < 100; index += 1) {
      const tenantStates = await Promise.all(contexts.map((context) => shared(context.request)));
      let ownerIndex = tenantStates.findIndex(
        (tenantState) =>
          tenantState.orchestration.session !== null &&
          tenantState.orchestration.session.activeProjectId !== null,
      );
      if (ownerIndex === -1) {
        ownerIndex = tenantStates.findIndex(
          (tenantState) => tenantState.orchestration.session !== null,
        );
      }
      if (ownerIndex === -1) break;
      const advanced = await contexts[ownerIndex]!.request.post(
        `/api/v1/shared-app/advance?fixture=${FIXTURE}`,
      );
      if (!advanced.ok()) {
        throw new Error(`advance failed ${advanced.status()}: ${await advanced.text()}`);
      }
    }
    const finalStates = await Promise.all(contexts.map((context) => shared(context.request)));
    expect(finalStates.every((tenantState) => tenantState.orchestration.session === null)).toBe(
      true,
    );
    expect(finalStates.every((tenantState) => tenantState.queue.length === 0)).toBe(true);
    const completed = finalStates.flatMap((tenantState) =>
      tenantState.orchestration.projects.filter((project) => project.stage === "READY_FOR_REVIEW"),
    );
    expect(completed.map((project) => project.projectId).sort()).toEqual([
      "cp05-project-1",
      "cp05-project-2",
      "cp05-project-4",
    ]);
    expect(new Set(completed.map((project) => project.finalAsset!.sha256)).size).toBe(3);
    expect(completed.every((project) => project.finalAsset!.renderer === "DIRECT_FFMPEG")).toBe(
      true,
    );

    await pageA.reload();
    await expect(pageA.getByRole("heading", { name: "Your generation queue" })).toBeVisible();
    await expect(pageA.getByText(/^Idle\. Generate adds a private waiting request/u)).toBeVisible();
    await expect(pageA.getByText(/GPU|Pod|RunPod/u)).toHaveCount(0);

    // CP-05 fixture output remains durable and downloadable, but V2-03 no longer exposes the
    // legacy shared-session compute panel on the ordinary user's private queue screen.
    const downloadHref = completed[0]!.finalAsset!.downloadPath + `?fixture=${FIXTURE}`;
    const downloadResponse = await contextA.request.get(downloadHref!);
    expect(downloadResponse.ok()).toBe(true);
    expect(downloadResponse.headers()["content-disposition"]).toContain("attachment;");
    expect(downloadResponse.headers()["content-type"]).toBe("video/mp4");
    expect(downloadResponse.headers()["x-videoforge-sha256"]).toBe(
      completed[0]!.finalAsset!.sha256,
    );
    const bytes = await downloadResponse.body();
    expect(bytes.byteLength).toBe(completed[0]!.finalAsset!.byteSize);
    expect(`sha256:${createHash("sha256").update(bytes).digest("hex")}`).toBe(
      completed[0]!.finalAsset!.sha256,
    );
    const foreignDownload = await contextB.request.get(completed[0]!.finalAsset!.downloadPath);
    expect(foreignDownload.status()).toBe(404);
    expect(consoleErrors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

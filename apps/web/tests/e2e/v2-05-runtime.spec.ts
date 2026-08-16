import { createHash } from "node:crypto";

import { expect, test, type BrowserContext } from "@playwright/test";

/**
 * V2-05 provider-free runtime journey in installed Chrome.
 *
 * Two invited accounts each carry an admitted video through the durable per-video runtime. Every
 * stage the browser shows is a database observation: no provider is called, no worker or GPU is
 * allocated, and the settled cost stays $0.
 */
const FIXTURE = "invite_sign_in";

async function admit(context: BrowserContext, email: string, method: "EMAIL_PASSWORD" | "GOOGLE") {
  const inviteResponse = await context.request.post("/api/dev/shared-app/invites", {
    data: { email },
  });
  expect(inviteResponse.ok()).toBe(true);
  const invite = (await inviteResponse.json()) as {
    code: string;
    emailPassword: string;
    googleAssertion: string;
  };
  const response = await context.request.post(`/api/v2/auth/fixture?fixture=${FIXTURE}`, {
    data: {
      method,
      email,
      emailPassword: method === "EMAIL_PASSWORD" ? invite.emailPassword : undefined,
      googleAccountEmail: method === "GOOGLE" ? email : undefined,
      googleAssertion: method === "GOOGLE" ? invite.googleAssertion : undefined,
      inviteCode: invite.code,
    },
  });
  expect(response.ok()).toBe(true);
}

/** Advances one owned video one durable step at a time and returns every observed stage. */
async function drive(
  context: BrowserContext,
  projectId: string,
  maximumSteps = 12,
): Promise<{ stages: string[]; finalOutputSha256: string | null }> {
  const observed: string[] = [];
  let finalOutputSha256: string | null = null;
  for (let step = 0; step < maximumSteps; step += 1) {
    const response = await context.request.post(
      `/api/v2/videos/${projectId}/advance?fixture=${FIXTURE}`,
    );
    if (!response.ok()) {
      throw new Error(`advance failed ${response.status()}: ${await response.text()}`);
    }
    const state = (await response.json()) as {
      stage: string;
      providerCallsAuthorized: boolean;
      authorizedSpendUsd: number;
      settledCostUsd: number;
      finalOutputSha256: string | null;
      executionEvidence: string;
    };
    expect(state.providerCallsAuthorized).toBe(false);
    expect(state.authorizedSpendUsd).toBe(0);
    expect(state.settledCostUsd).toBe(0);
    expect(state.executionEvidence).toBe("SYNTHETIC_PROVIDER_FREE");
    finalOutputSha256 = state.finalOutputSha256;
    observed.push(state.stage);
    if (["COMPLETE", "FAILED", "CANCELED"].includes(state.stage)) break;
  }
  return { stages: observed, finalOutputSha256 };
}

test("V2-05 carries two accounts' videos through factual private runtime stages", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const options = (session: string) => ({
    baseURL: "http://localhost:4173",
    extraHTTPHeaders: {
      "X-VideoForge-Fixture-Session": session,
      "X-VideoForge-Fixture-Control": "v2-provider-free-fixture-v1",
    },
  });
  const contextA = await browser.newContext(options("v2-05-runtime-a"));
  const contextB = await browser.newContext(options("v2-05-runtime-b"));
  try {
    expect((await contextA.request.post("/api/dev/shared-app/reset")).ok()).toBe(true);
    await admit(contextA, "runtime-a@example.test", "EMAIL_PASSWORD");
    await admit(contextB, "runtime-b@example.test", "GOOGLE");

    for (const [context, projectId, title] of [
      [contextA, "v2-05-a-active", "Account A runtime"],
      [contextB, "v2-05-b-active", "Account B runtime"],
    ] as const) {
      const generated = await context.request.post(
        `/api/v2/generation-requests?fixture=${FIXTURE}`,
        { data: { projectId, title } },
      );
      expect(generated.ok()).toBe(true);
    }

    // A newly admitted video is queued: the browser shows no worker, lane, or cost state.
    const queuedPage = await contextA.newPage();
    await queuedPage.goto(`/?fixture=${FIXTURE}`);
    await expect(queuedPage.getByRole("heading", { name: "Your generation queue" })).toBeVisible();
    const queuedList = queuedPage.getByLabel("Your private generation queue");
    await expect(queuedList).toContainText("Account A runtime");
    await expect(queuedList).toContainText("Queued");

    // Both accounts advance independently through the same durable stage vocabulary.
    const resultA = await drive(contextA, "v2-05-a-active");
    const resultB = await drive(contextB, "v2-05-b-active");
    for (const { stages, finalOutputSha256 } of [resultA, resultB]) {
      expect(stages[0]).toBe("PREPARING");
      expect(stages).toContain("WAITING_FOR_WORKER");
      expect(stages).toContain("RENDERING");
      expect(stages.at(-1)).toBe("COMPLETE");
      expect(finalOutputSha256).toMatch(/^sha256:[0-9a-f]{64}$/u);
    }

    await queuedPage.reload();
    await expect(
      queuedPage.getByText(/^Idle\. Generate adds a private waiting request/u),
    ).toBeVisible();
    // The approved queue surface still exposes no compute control of any kind.
    await expect(queuedPage.getByText(/GPU|Pod|RunPod/u)).toHaveCount(0);

    // Account B sees only its own video, in its own factual state.
    const pageB = await contextB.newPage();
    await pageB.goto(`/?fixture=${FIXTURE}`);
    await expect(pageB.getByText(/^Idle\. Generate adds a private waiting request/u)).toBeVisible();
    await expect(pageB.getByText("Account A runtime")).toHaveCount(0);

    // Neither account can address the other's video, and the refusal reveals nothing.
    const foreign = await contextB.request.post(
      `/api/v2/videos/v2-05-a-active/advance?fixture=${FIXTURE}`,
    );
    expect(foreign.status()).toBe(404);
    const foreignBody = await foreign.text();
    expect(foreignBody).not.toContain("runtime-a@example.test");

    // Terminal admission entries drain, while each exact tenant-private MP4 remains durable.
    const queueA = (await (
      await contextA.request.get(`/api/v2/queue?fixture=${FIXTURE}`)
    ).json()) as {
      requests: {
        projectId: string;
        stage: string;
        lanes?: { lane: string; state: string; acceptedItemCount: number }[];
      }[];
      providerCallsAuthorized: boolean;
      authorizedSpendUsd: number;
    };
    expect(queueA.providerCallsAuthorized).toBe(false);
    expect(queueA.authorizedSpendUsd).toBe(0);
    expect(queueA.requests).toEqual([]);

    const download = await contextA.request.get(
      `/api/v2/videos/v2-05-a-active/download?fixture=${FIXTURE}`,
    );
    expect(download.ok()).toBe(true);
    expect(download.headers()["content-type"]).toBe("video/mp4");
    expect(download.headers()["x-videoforge-artifact-kind"]).toBe("tenant-private-final-mp4");
    const bytes = await download.body();
    expect(bytes.byteLength).toBeGreaterThan(10_000);
    const downloadedSha256 = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    expect(downloadedSha256).toBe(resultA.finalOutputSha256);
    expect(download.headers()["x-videoforge-sha256"]).toBe(downloadedSha256);

    // Installed Chrome decodes the V3 artifact itself; this is not a manifest-only completion.
    const playback = await queuedPage.evaluate(async (source) => {
      const video = document.createElement("video");
      video.muted = true;
      video.src = source;
      document.body.append(video);
      await new Promise<void>((resolve, reject) => {
        video.addEventListener("loadedmetadata", () => resolve(), { once: true });
        video.addEventListener("error", () => reject(new Error("MP4 decode failed")), {
          once: true,
        });
      });
      await video.play();
      await new Promise((resolve) => setTimeout(resolve, 250));
      const facts = {
        width: video.videoWidth,
        height: video.videoHeight,
        duration: video.duration,
        currentTime: video.currentTime,
      };
      video.remove();
      return facts;
    }, `/api/v2/videos/v2-05-a-active/download?fixture=${FIXTURE}&inline=1`);
    expect(playback.width).toBe(1920);
    expect(playback.height).toBe(1080);
    expect(playback.duration).toBeGreaterThan(9);
    expect(playback.currentTime).toBeGreaterThan(0);

    const foreignDownload = await contextB.request.get(
      `/api/v2/videos/v2-05-a-active/download?fixture=${FIXTURE}`,
    );
    expect(foreignDownload.status()).toBe(404);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

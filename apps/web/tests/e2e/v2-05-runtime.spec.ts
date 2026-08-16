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

/** Advances one owned video one durable step at a time and returns every observed stage. */
async function drive(
  context: BrowserContext,
  projectId: string,
  maximumSteps = 12,
): Promise<string[]> {
  const observed: string[] = [];
  for (let step = 0; step < maximumSteps; step += 1) {
    const response = await context.request.post(
      `/api/v2/videos/${projectId}/advance?fixture=${FIXTURE}`,
    );
    expect(response.ok()).toBe(true);
    const state = (await response.json()) as {
      stage: string;
      providerCallsAuthorized: boolean;
      authorizedSpendUsd: number;
      settledCostUsd: number;
    };
    expect(state.providerCallsAuthorized).toBe(false);
    expect(state.authorizedSpendUsd).toBe(0);
    expect(state.settledCostUsd).toBe(0);
    observed.push(state.stage);
    if (["COMPLETE", "FAILED", "CANCELED"].includes(state.stage)) break;
  }
  return observed;
}

test("V2-05 carries two accounts' videos through factual private runtime stages", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const options = (session: string) => ({
    baseURL: "http://localhost:4173",
    extraHTTPHeaders: {
      "X-VideoForge-Fixture-Session": session,
      "X-VideoForge-Fixture-Control": "cp05-fixture-control-v1",
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
    const stagesA = await drive(contextA, "v2-05-a-active");
    const stagesB = await drive(contextB, "v2-05-b-active");
    for (const stages of [stagesA, stagesB]) {
      expect(stages[0]).toBe("PREPARING");
      expect(stages).toContain("WAITING_FOR_WORKER");
      expect(stages).toContain("RENDERING");
      expect(stages.at(-1)).toBe("COMPLETE");
    }

    await queuedPage.reload();
    await expect(queuedList).toContainText("Complete");
    // The approved queue surface still exposes no compute control of any kind.
    await expect(queuedPage.getByText(/GPU|Pod|RunPod/u)).toHaveCount(0);

    // Account B sees only its own video, in its own factual state.
    const pageB = await contextB.newPage();
    await pageB.goto(`/?fixture=${FIXTURE}`);
    const listB = pageB.getByLabel("Your private generation queue");
    await expect(listB).toContainText("Account B runtime");
    await expect(listB).not.toContainText("Account A runtime");

    // Neither account can address the other's video, and the refusal reveals nothing.
    const foreign = await contextB.request.post(
      `/api/v2/videos/v2-05-a-active/advance?fixture=${FIXTURE}`,
    );
    expect(foreign.status()).toBe(404);
    const foreignBody = await foreign.text();
    expect(foreignBody).not.toContain("runtime-a@example.test");

    // Every owned video reports the durable lane facts behind its stage.
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
    const ownedA = queueA.requests.find((request) => request.projectId === "v2-05-a-active");
    expect(ownedA?.stage).toBe("COMPLETE");
    expect(ownedA?.lanes?.map((lane) => lane.lane)).toEqual(["mage_image", "soulx_avatar"]);
    expect(ownedA?.lanes?.every((lane) => lane.state === "SUCCEEDED")).toBe(true);
    expect(ownedA?.lanes?.every((lane) => lane.acceptedItemCount > 0)).toBe(true);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

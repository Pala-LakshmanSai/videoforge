import { expect, test, type BrowserContext } from "@playwright/test";

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
    "/api/v1/shared-app/authenticate?fixture=invite_sign_in",
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

test("V2-03 shows two accounts only their factual fair-queue state without compute controls", async ({
  browser,
}) => {
  const options = (session: string) => ({
    baseURL: "http://localhost:4173",
    extraHTTPHeaders: {
      "X-VideoForge-Fixture-Session": session,
      "X-VideoForge-Fixture-Control": "cp05-fixture-control-v1",
    },
  });
  const contextA = await browser.newContext(options("v2-03-fair-a"));
  const contextB = await browser.newContext(options("v2-03-fair-b"));
  try {
    expect((await contextA.request.post("/api/dev/shared-app/reset")).ok()).toBe(true);
    await admit(contextA, "fair-a@example.test", "EMAIL_PASSWORD");
    await admit(contextB, "fair-b@example.test", "GOOGLE");

    for (const [context, projectId, title] of [
      [contextA, "fair-a-active", "Account A active"],
      [contextA, "fair-a-waiting", "Account A waiting"],
      [contextB, "fair-b-waiting", "Account B waiting"],
      [contextB, "fair-b-second", "Account B second"],
    ] as const) {
      const generated = await context.request.post(
        "/api/v2/generation-requests?fixture=invite_sign_in",
        { data: { projectId, title } },
      );
      expect(generated.ok()).toBe(true);
    }

    const safeAResponse = await contextA.request.get("/api/v2/queue?fixture=invite_sign_in");
    const safeBResponse = await contextB.request.get("/api/v2/queue?fixture=invite_sign_in");
    expect(safeAResponse.ok()).toBe(true);
    expect(safeBResponse.ok()).toBe(true);
    const safeA = (await safeAResponse.json()) as {
      queueVersion: number;
      requests: Array<{
        id: string;
        projectId: string;
        state: "ACTIVE" | "WAITING";
        accountPosition: number;
        version: number;
      }>;
    };
    const safeB = (await safeBResponse.json()) as typeof safeA;
    expect(safeA.requests.map((request) => request.projectId)).toEqual([
      "fair-a-active",
      "fair-a-waiting",
    ]);
    expect(safeB.requests.map((request) => request.projectId)).toEqual([
      "fair-b-waiting",
      "fair-b-second",
    ]);
    expect(safeA.requests.filter((request) => request.state === "ACTIVE")).toHaveLength(1);
    expect(safeB.requests.filter((request) => request.state === "ACTIVE")).toHaveLength(1);
    for (const body of [await safeAResponse.text(), await safeBResponse.text()]) {
      expect(body).not.toMatch(/gpu|pod|runpod|receiptId|accountId|workspaceId/iu);
      expect(body).toContain('"totalSlots":2');
      expect(body).toContain('"accountActiveLimit":1');
    }

    const foreign = safeA.requests.find((request) => request.projectId === "fair-a-waiting")!;
    const foreignMutation = await contextB.request.patch(
      `/api/v2/queue/${foreign.id}?fixture=invite_sign_in`,
      { data: { toPosition: 1, version: foreign.version } },
    );
    expect(foreignMutation.status()).toBe(404);
    expect(await foreignMutation.text()).not.toContain("Account A");

    const activeA = safeA.requests.find((request) => request.state === "ACTIVE")!;
    const activeMutation = await contextA.request.patch(
      `/api/v2/queue/${activeA.id}?fixture=invite_sign_in`,
      { data: { toPosition: 2, version: activeA.version } },
    );
    expect(activeMutation.status()).toBe(409);

    const secondB = safeB.requests.find((request) => request.projectId === "fair-b-second")!;
    const reordered = await contextB.request.patch(
      `/api/v2/queue/${secondB.id}?fixture=invite_sign_in`,
      { data: { toPosition: 1, version: secondB.version } },
    );
    expect(reordered.ok()).toBe(true);
    const reorderedBody = (await reordered.json()) as typeof safeB;
    expect(reorderedBody.requests[0]?.state).toBe("ACTIVE");
    expect(reorderedBody.requests[1]?.projectId).toBe("fair-b-second");
    const cancelled = await contextB.request.delete(
      `/api/v2/queue/${secondB.id}?fixture=invite_sign_in&version=${reorderedBody.requests[1]!.version}`,
    );
    expect(cancelled.ok()).toBe(true);

    for (const [context, ownTitle, foreignTitle] of [
      [contextA, "Account A active", "Account B waiting"],
      [contextB, "Account B waiting", "Account A active"],
    ] as const) {
      const page = await context.newPage();
      const consoleErrors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      await page.goto("/?fixture=invite_sign_in");
      await expect(page.getByRole("heading", { name: "Your generation queue" })).toBeVisible();
      await expect(page.getByText(ownTitle, { exact: true })).toBeVisible();
      await expect(page.getByText(foreignTitle, { exact: true })).toHaveCount(0);
      await expect(
        page.getByText("Two global slots rotate deterministically", { exact: false }),
      ).toBeVisible();
      await expect(page.getByText(/GPU|Pod|RunPod/u)).toHaveCount(0);
      expect(consoleErrors).toEqual([]);
    }

    const createPage = await contextA.newPage();
    await createPage.goto("/projects/new?fixture=invite_sign_in");
    await expect(createPage.getByText("Automatic fair admission", { exact: true })).toBeVisible();
    await expect(createPage.getByText(/GPU offer|Start Pod|Stop Pod|Delete Pod/u)).toHaveCount(0);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

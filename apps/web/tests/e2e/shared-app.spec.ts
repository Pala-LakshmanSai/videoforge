import { expect, test } from "@playwright/test";

test("CP-02 shares one GPU pair while each browser sees only its tenant queue", async ({
  browser,
}) => {
  const contextA = await browser.newContext({
    baseURL: "http://localhost:4173",
    extraHTTPHeaders: {
      "X-VideoForge-Fixture-Session": "cp02-chrome-a",
      "X-VideoForge-Fixture-Control": "cp05-fixture-control-v1",
    },
  });
  let emailPassword = "";
  const contextB = await browser.newContext({
    baseURL: "http://localhost:4173",
    extraHTTPHeaders: {
      "X-VideoForge-Fixture-Session": "cp02-chrome-b",
      "X-VideoForge-Fixture-Control": "cp05-fixture-control-v1",
    },
  });
  const contextC = await browser.newContext({
    baseURL: "http://localhost:4173",
    extraHTTPHeaders: {
      "X-VideoForge-Fixture-Session": "cp02-chrome-returning",
      "X-VideoForge-Fixture-Control": "cp05-fixture-control-v1",
    },
  });
  try {
    expect((await contextA.request.post("/api/dev/shared-app/reset")).ok()).toBe(true);
    for (const [context, email, method] of [
      [contextA, "chrome-a@example.test", "EMAIL_PASSWORD"],
      [contextB, "chrome-b@example.test", "GOOGLE"],
    ] as const) {
      const inviteResponse = await context.request.post("/api/dev/shared-app/invites", {
        data: { email },
      });
      expect(inviteResponse.ok()).toBe(true);
      const invite = (await inviteResponse.json()) as {
        code: string;
        emailPassword: string;
        googleAssertion: string;
      };
      if (method === "EMAIL_PASSWORD") emailPassword = invite.emailPassword;
      const auth = await context.request.post(
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
      expect(auth.ok()).toBe(true);
      await expect(auth.json()).resolves.toMatchObject({ outcome: "ADMITTED", rights: "EQUAL" });
    }

    const pageA = await contextA.newPage();
    const consoleErrors: string[] = [];
    pageA.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    await pageA.goto("/projects/new?fixture=invite_sign_in");
    await expect(pageA.getByRole("heading", { name: "New project" })).toBeVisible();
    await expect(pageA.getByLabel("Image and media GPU offer", { exact: true })).toBeVisible();
    await expect(pageA.getByLabel("Avatar GPU offer", { exact: true })).toBeVisible();

    const initial = (await (
      await contextA.request.get("/api/v1/shared-app?fixture=invite_sign_in")
    ).json()) as { inventory: Array<{ lane: string; receiptId: string }> };
    const imageReceiptId = initial.inventory.find(
      (offer) => offer.lane === "image_media",
    )!.receiptId;
    const avatarReceiptId = initial.inventory.find(
      (offer) => offer.lane === "avatar_primary",
    )!.receiptId;
    const results = await Promise.all(
      [contextA, contextB].map((context, index) =>
        context.request.post("/api/v1/shared-app/generate?fixture=invite_sign_in", {
          data: {
            projectId: `chrome-project-${index + 1}`,
            title: `Chrome Project ${index + 1}`,
            imageReceiptId,
            avatarReceiptId,
          },
        }),
      ),
    );
    const outcomes = (await Promise.all(results.map((response) => response.json()))) as Array<{
      outcome: string;
    }>;
    expect(outcomes.map((result) => result.outcome).sort()).toEqual(["QUEUED", "STARTED"]);

    const returning = await contextC.request.post(
      "/api/v1/shared-app/authenticate?fixture=invite_sign_in",
      {
        data: {
          method: "EMAIL_PASSWORD",
          email: "chrome-a@example.test",
          emailPassword,
        },
      },
    );
    expect(returning.ok()).toBe(true);
    await expect(returning.json()).resolves.toMatchObject({
      outcome: "RETURNING",
      rights: "EQUAL",
    });
    const returningPage = await contextC.newPage();
    await returningPage.goto("/?fixture=invite_sign_in");
    await expect(returningPage.getByRole("heading", { name: "Queue", exact: true })).toBeVisible();
    await expect(returningPage.getByRole("heading", { name: "Enter VideoForge" })).toHaveCount(0);

    const pageB = await contextB.newPage();
    await Promise.all([pageA.reload(), pageB.goto("/projects/new?fixture=invite_sign_in")]);
    for (const page of [pageA, pageB]) {
      await expect(page.getByText("Locked", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("NVIDIA RTX 4090", { exact: false }).first()).toBeVisible();
      await expect(page.getByText("$0.34/hr", { exact: false }).first()).toBeVisible();
      await expect(page.getByRole("button", { name: /Add to queue/u })).toBeVisible();
      await expect(page.getByLabel("Image and media GPU offer", { exact: true })).toHaveCount(0);
    }

    await pageB.goto("/?fixture=invite_sign_in");
    await expect(pageB.getByRole("heading", { name: "Queue", exact: true })).toBeVisible();
    await expect(pageB.getByText("Global generation queue")).toBeVisible();
    await expect(pageB.getByText("Active entry cannot move or delete")).toHaveCount(0);
    await expect(pageB.getByRole("button", { name: /Remove Chrome Project/u })).toBeVisible();
    await expect(pageB.getByText("equal rights", { exact: false }).first()).toBeVisible();

    const third = await contextB.request.post(
      "/api/v1/shared-app/generate?fixture=invite_sign_in",
      { data: { projectId: "chrome-project-3", title: "Chrome Project 3" } },
    );
    await expect(third.json()).resolves.toMatchObject({ outcome: "QUEUED" });
    let current = (await (
      await contextB.request.get("/api/v1/shared-app?fixture=invite_sign_in")
    ).json()) as { session: { queueVersion: number }; queue: Array<{ id: string; state: string }> };
    const thirdEntry = current.queue[1]!;
    const reordered = await contextB.request.patch(
      `/api/v1/shared-app/queue/${thirdEntry.id}?fixture=invite_sign_in`,
      { data: { toPosition: 1, queueVersion: current.session.queueVersion } },
    );
    expect(reordered.ok()).toBe(true);
    current = (await reordered.json()) as typeof current;
    expect(current.queue[0]!.id).toBe(thirdEntry.id);
    const stale = await contextB.request.patch(
      `/api/v1/shared-app/queue/${current.queue[0]!.id}?fixture=invite_sign_in`,
      { data: { toPosition: 1, queueVersion: current.session.queueVersion - 1 } },
    );
    expect(stale.status()).toBe(409);
    const removed = await contextB.request.delete(
      `/api/v1/shared-app/queue/${current.queue[0]!.id}?fixture=invite_sign_in&queueVersion=${current.session.queueVersion}`,
    );
    expect(removed.ok()).toBe(true);
    await pageB.reload();
    await expect(pageB.getByText("Chrome Project 3", { exact: true })).toHaveCount(0);
    expect(consoleErrors).toEqual([]);
  } finally {
    await contextA.close();
    await contextB.close();
    await contextC.close();
  }
});

import { expect, test } from "@playwright/test";

/**
 * V2-01 (GATE_TENANCY_001): two invited accounts admitted in installed Chrome receive separate
 * private tenants. Each session can read only its own account and default workspace, and an
 * unauthenticated session can read neither.
 */
test("two invited accounts hold separate private tenants in installed Chrome", async ({
  browser,
}) => {
  const headers = (session: string) => ({
    baseURL: "http://localhost:4173",
    extraHTTPHeaders: {
      "X-VideoForge-Fixture-Session": session,
      "X-VideoForge-Fixture-Control": "v2-provider-free-fixture-v1",
    },
  });
  const contextA = await browser.newContext(headers("v2-01-tenant-a"));
  const contextB = await browser.newContext(headers("v2-01-tenant-b"));
  const contextAnonymous = await browser.newContext(headers("v2-01-tenant-anonymous"));

  try {
    expect((await contextA.request.post("/api/dev/shared-app/reset")).ok()).toBe(true);

    const tenants: Array<{ accountId: string; workspaceId: string }> = [];
    for (const [context, email, method] of [
      [contextA, "tenant-a@example.test", "EMAIL_PASSWORD"],
      [contextB, "tenant-b@example.test", "GOOGLE"],
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

      const auth = await context.request.post("/api/v2/auth/fixture?fixture=invite_sign_in", {
        data: {
          method,
          email,
          emailPassword: method === "EMAIL_PASSWORD" ? invite.emailPassword : undefined,
          googleAccountEmail: method === "GOOGLE" ? email : undefined,
          googleAssertion: method === "GOOGLE" ? invite.googleAssertion : undefined,
          inviteCode: invite.code,
        },
      });
      expect(auth.ok()).toBe(true);
      const admitted = (await auth.json()) as {
        outcome: string;
        tenant: { accountId: string; workspaceId: string };
      };
      expect(admitted.outcome).toBe("ADMITTED");

      // Admission binds exactly one account and one default workspace.
      expect(admitted.tenant.accountId).toMatch(/^account-/u);
      expect(admitted.tenant.workspaceId).toMatch(/^workspace-/u);
      tenants.push(admitted.tenant);
    }

    const tenantA = tenants[0];
    const tenantB = tenants[1];
    expect(tenantA).toBeDefined();
    expect(tenantB).toBeDefined();
    if (tenantA === undefined || tenantB === undefined) throw new Error("unreachable");

    // The two admitted accounts never share a tenant.
    expect(tenantA.accountId).not.toBe(tenantB.accountId);
    expect(tenantA.workspaceId).not.toBe(tenantB.workspaceId);

    // Each session reads only its own scope.
    for (const [context, expected] of [
      [contextA, tenantA],
      [contextB, tenantB],
    ] as const) {
      const own = await context.request.get("/api/v2/tenant?fixture=invite_sign_in");
      expect(own.ok()).toBe(true);
      expect(await own.json()).toEqual(expected);
    }

    // An unadmitted session receives the same non-revealing denial for every scope.
    const anonymous = await contextAnonymous.request.get("/api/v2/tenant?fixture=invite_sign_in");
    expect(anonymous.status()).toBe(403);
    const anonymousBody = await anonymous.text();
    expect(anonymousBody).not.toContain(tenantA.accountId);
    expect(anonymousBody).not.toContain(tenantB.accountId);

    for (const [context, projectId, title] of [
      [contextA, "tenant-a-active", "Tenant A private active"],
      [contextA, "tenant-a-waiting", "Tenant A private waiting"],
      [contextB, "tenant-b-active", "Tenant B private active"],
    ] as const) {
      const generated = await context.request.post(
        "/api/v2/generation-requests?fixture=invite_sign_in",
        {
          data: { projectId, title },
        },
      );
      expect(generated.ok()).toBe(true);
    }

    const queueAResponse = await contextA.request.get("/api/v2/queue?fixture=invite_sign_in");
    const queueBResponse = await contextB.request.get("/api/v2/queue?fixture=invite_sign_in");
    const queueA = (await queueAResponse.json()) as {
      requests: Array<{ id: string; projectId: string; version: number }>;
    };
    const queueBText = await queueBResponse.text();
    expect(queueA.requests.map((entry) => entry.projectId)).toEqual([
      "tenant-a-active",
      "tenant-a-waiting",
    ]);
    expect(queueBText).toContain("tenant-b-active");
    expect(queueBText).not.toContain("tenant-a-active");
    expect(queueBText).not.toContain(tenantA.accountId);
    expect(queueBText).not.toContain(tenantA.workspaceId);
    expect(await queueAResponse.text()).not.toContain(tenantB.accountId);

    const foreignWaiting = queueA.requests.find((entry) => entry.projectId === "tenant-a-waiting")!;
    for (const response of [
      await contextB.request.get("/api/v2/videos/tenant-a-active/download?fixture=invite_sign_in"),
      await contextB.request.patch(`/api/v2/queue/${foreignWaiting.id}?fixture=invite_sign_in`, {
        data: { toPosition: 2, version: foreignWaiting.version },
      }),
      await contextB.request.delete(
        `/api/v2/queue/${foreignWaiting.id}?fixture=invite_sign_in&version=${foreignWaiting.version}`,
      ),
      await contextB.request.post("/api/v2/videos/tenant-a-active/cancel?fixture=invite_sign_in"),
      await contextB.request.post("/api/v2/videos/tenant-a-active/advance?fixture=invite_sign_in"),
    ]) {
      expect(response.status()).toBe(404);
      const body = await response.text();
      expect(body).not.toContain("Tenant A private");
      expect(body).not.toContain(tenantA.accountId);
      expect(body).not.toContain(tenantA.workspaceId);
    }

    expect(queueAResponse.ok()).toBe(true);

    // The approved shell still renders for both accounts with no console error.
    for (const context of [contextA, contextB]) {
      const page = await context.newPage();
      const consoleErrors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      await page.goto("/?fixture=invite_sign_in");
      await expect(page.getByRole("heading", { name: "Queue", exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Enter VideoForge" })).toHaveCount(0);
      expect(consoleErrors).toEqual([]);
    }
  } finally {
    await contextA.close();
    await contextB.close();
    await contextAnonymous.close();
  }
});

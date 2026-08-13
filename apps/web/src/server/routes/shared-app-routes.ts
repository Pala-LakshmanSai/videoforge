import type { Hono } from "hono";

import type { FixtureRuntime } from "../fixture-runtime";
import { apiProblem, problemResponse } from "../problem";
import { SharedFixtureError } from "../shared-app-fixture";

function failure(error: unknown): Response {
  if (error instanceof SharedFixtureError) {
    return problemResponse(
      apiProblem(error.code, error.status, "Shared app request rejected", error.message, false),
    );
  }
  throw error;
}

export function registerSharedAppRoutes(app: Hono, runtime: FixtureRuntime): void {
  app.post("/api/dev/shared-app/reset", (c) => {
    runtime.sharedApp.reset();
    return c.json({ ok: true, providerCallsAuthorized: false, authorizedSpendUsd: 0 });
  });
  app.post("/api/dev/shared-app/invites", async (c) => {
    try {
      const body = (await c.req.json()) as { email?: string };
      const code = await runtime.sharedApp.issueInvite(body.email ?? "");
      return c.json({
        code,
        shownOnce: true,
        providerCallsAuthorized: false,
        authorizedSpendUsd: 0,
      });
    } catch (error) {
      return failure(error);
    }
  });

  app.post("/api/v1/shared-app/authenticate", async (c) => {
    const session = runtime.resolveSession(c);
    if (!session.ok) return session.response;
    try {
      const body = (await c.req.json()) as {
        method: "EMAIL_PASSWORD" | "GOOGLE";
        email: string;
        emailVerified: boolean;
        googleVerifiedEmail?: string;
        inviteCode?: string;
      };
      return c.json(await runtime.sharedApp.authenticate({ sessionId: session.id, ...body }));
    } catch (error) {
      return failure(error);
    }
  });

  app.get("/api/v1/shared-app", (c) => {
    const session = runtime.resolveSession(c);
    if (!session.ok) return session.response;
    return c.json(runtime.sharedApp.view(session.id));
  });

  app.post("/api/v1/shared-app/generate", async (c) => {
    const session = runtime.resolveSession(c);
    if (!session.ok) return session.response;
    try {
      const body = (await c.req.json()) as {
        projectId: string;
        title: string;
        imageReceiptId?: string;
        avatarReceiptId?: string;
      };
      return c.json(runtime.sharedApp.startOrEnqueue({ sessionId: session.id, ...body }));
    } catch (error) {
      return failure(error);
    }
  });

  app.patch("/api/v1/shared-app/queue/:entryId", async (c) => {
    const session = runtime.resolveSession(c);
    if (!session.ok) return session.response;
    try {
      const body = (await c.req.json()) as { toPosition: number; queueVersion: number };
      runtime.sharedApp.reorder({
        sessionId: session.id,
        entryId: c.req.param("entryId"),
        toPosition: body.toPosition,
        ifMatch: body.queueVersion,
      });
      return c.json(runtime.sharedApp.view(session.id));
    } catch (error) {
      return failure(error);
    }
  });

  app.delete("/api/v1/shared-app/queue/:entryId", async (c) => {
    const session = runtime.resolveSession(c);
    if (!session.ok) return session.response;
    try {
      const queueVersion = Number(c.req.query("queueVersion"));
      runtime.sharedApp.remove({
        sessionId: session.id,
        entryId: c.req.param("entryId"),
        ifMatch: queueVersion,
      });
      return c.json(runtime.sharedApp.view(session.id));
    } catch (error) {
      return failure(error);
    }
  });
}

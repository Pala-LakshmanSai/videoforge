import type { Hono } from "hono";
import { ProviderFreeOrchestrationError } from "@videoforge/control-plane/provider-free-orchestration";

import type { FixtureRuntime } from "../fixture-runtime";
import { apiProblem, problemResponse } from "../problem";
import { SharedFixtureError } from "../shared-app-fixture";

const FIXTURE_CONTROL_HEADER = "x-videoforge-fixture-control";
const FIXTURE_CONTROL_VALUE = "cp05-fixture-control-v1";

function failure(error: unknown): Response {
  if (error instanceof SharedFixtureError || error instanceof ProviderFreeOrchestrationError) {
    return problemResponse(
      apiProblem(
        error.code,
        error instanceof SharedFixtureError ? error.status : 409,
        "Shared app request rejected",
        error.message,
        false,
      ),
    );
  }
  throw error;
}

export function registerSharedAppRoutes(app: Hono, runtime: FixtureRuntime): void {
  app.post("/api/dev/shared-app/reset", (c) => {
    if (c.req.header(FIXTURE_CONTROL_HEADER) !== FIXTURE_CONTROL_VALUE)
      return problemResponse(
        apiProblem(
          "FIXTURE_CONTROL_REQUIRED",
          403,
          "Fixture control is required",
          "Global reset is available only to the explicit local acceptance harness.",
          false,
        ),
      );
    runtime.sharedApp.reset();
    return c.json({ ok: true, providerCallsAuthorized: false, authorizedSpendUsd: 0 });
  });
  app.post("/api/dev/shared-app/invites", async (c) => {
    try {
      if (c.req.header(FIXTURE_CONTROL_HEADER) !== FIXTURE_CONTROL_VALUE)
        throw new SharedFixtureError(
          "FIXTURE_CONTROL_REQUIRED",
          403,
          "Invite issuance is available only to the explicit local acceptance harness.",
        );
      const body = (await c.req.json()) as { email?: string };
      const issued = await runtime.sharedApp.issueInvite(body.email ?? "");
      return c.json({
        ...issued,
        shownOnce: true,
        providerCallsAuthorized: false,
        authorizedSpendUsd: 0,
      });
    } catch (error) {
      return failure(error);
    }
  });

  app.post("/api/dev/shared-app/recover", (c) => {
    try {
      if (c.req.header(FIXTURE_CONTROL_HEADER) !== FIXTURE_CONTROL_VALUE)
        throw new SharedFixtureError("FIXTURE_CONTROL_REQUIRED", 403, "Fixture control required.");
      const session = runtime.resolveSession(c);
      if (!session.ok) return session.response;
      runtime.sharedApp.assertAdmitted(session.id);
      runtime.sharedApp.recover();
      return c.json({ ok: true, providerCallsAuthorized: false, authorizedSpendUsd: 0 });
    } catch (error) {
      return failure(error);
    }
  });

  app.post("/api/dev/shared-app/callback", async (c) => {
    try {
      if (c.req.header(FIXTURE_CONTROL_HEADER) !== FIXTURE_CONTROL_VALUE)
        throw new SharedFixtureError("FIXTURE_CONTROL_REQUIRED", 403, "Fixture control required.");
      const session = runtime.resolveSession(c);
      if (!session.ok) return session.response;
      runtime.sharedApp.assertAdmitted(session.id);
      const body = (await c.req.json()) as Parameters<
        typeof runtime.sharedApp.acceptLaneCallback
      >[0];
      runtime.sharedApp.acceptLaneCallback(body);
      return c.json({ ok: true, providerCallsAuthorized: false, authorizedSpendUsd: 0 });
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
        emailPassword?: string;
        googleAccountEmail?: string;
        googleAssertion?: string;
        inviteCode?: string;
      };
      return c.json(await runtime.sharedApp.authenticate({ sessionId: session.id, ...body }));
    } catch (error) {
      return failure(error);
    }
  });

  app.get("/api/v1/shared-app", async (c) => {
    const session = runtime.resolveSession(c);
    if (!session.ok) return session.response;
    await runtime.sharedApp.waitForSettled();
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

  app.post("/api/v1/shared-app/cancel", (c) => {
    const session = runtime.resolveSession(c);
    if (!session.ok) return session.response;
    try {
      return c.json(runtime.sharedApp.cancelActive(session.id));
    } catch (error) {
      return failure(error);
    }
  });

  app.post("/api/v1/shared-app/advance", async (c) => {
    const session = runtime.resolveSession(c);
    if (!session.ok) return session.response;
    try {
      runtime.sharedApp.assertAdmitted(session.id);
      return c.json(await runtime.sharedApp.advance());
    } catch (error) {
      return failure(error);
    }
  });

  app.get("/api/v1/shared-app/projects/:projectId", async (c) => {
    try {
      await runtime.sharedApp.waitForSettled();
      return c.json(runtime.sharedApp.projectOrchestration(c.req.param("projectId")));
    } catch (error) {
      return failure(error);
    }
  });

  app.get("/api/v1/shared-app/projects/:projectId/download", async (c) => {
    try {
      await runtime.sharedApp.waitForSettled();
      const project = runtime.sharedApp.projectOrchestration(c.req.param("projectId"));
      if (project.finalAsset === null || project.stage !== "READY_FOR_REVIEW") {
        return problemResponse(
          apiProblem(
            "PROJECT_DOWNLOAD_NOT_READY",
            409,
            "Final MP4 is not ready",
            "Every transcript, generation, and render barrier must complete before download.",
            false,
          ),
        );
      }
      const safeProjectId = project.projectId.replaceAll(/[^A-Za-z0-9._-]/gu, "-");
      c.header("content-type", "video/mp4");
      c.header("content-length", String(project.finalAsset.byteSize));
      c.header(
        "content-disposition",
        `${c.req.query("inline") === "1" ? "inline" : "attachment"}; filename="videoforge-${safeProjectId}.mp4"`,
      );
      c.header("x-videoforge-sha256", project.finalAsset.sha256);
      c.header("x-videoforge-artifact-kind", "provider-free-final-mp4");
      const bytes = await runtime.sharedApp.finalMp4(project.projectId);
      return c.body(bytes.buffer as ArrayBuffer);
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

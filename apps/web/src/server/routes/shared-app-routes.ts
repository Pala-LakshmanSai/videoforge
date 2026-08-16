import type { Hono } from "hono";
import { ProviderFreeOrchestrationError } from "@videoforge/control-plane/provider-free-orchestration";

import type { FixtureRuntime } from "../fixture-runtime";
import { apiProblem, problemResponse } from "../problem";
import { SharedFixtureError } from "../shared-app-fixture";
import { VideoRuntimeError } from "@videoforge/control-plane/runtime";

const FIXTURE_CONTROL_HEADER = "x-videoforge-fixture-control";
const FIXTURE_CONTROL_VALUE = "cp05-fixture-control-v1";

function failure(error: unknown): Response {
  if (error instanceof VideoRuntimeError) {
    return problemResponse(
      apiProblem(
        error.code,
        error.code === "RUNTIME_NOT_FOUND" ? 404 : 409,
        "Video runtime request rejected",
        error.message,
        false,
      ),
    );
  }
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

/**
 * Projects the caller's private fair-queue view with the V2-05 runtime's factual stage per video.
 *
 * When no runtime is bound, the queue reports only admission state. The runtime never invents a
 * stage for a video it does not own a durable row for.
 */
async function withVideoRuntimeStages(runtime: FixtureRuntime, sessionId: string) {
  const view = runtime.sharedApp.privateFairQueueView(sessionId);
  const tenant = runtime.sharedApp.tenant(sessionId);
  if (runtime.videoRuntime === undefined || tenant === null) return view;
  const owned = await runtime.videoRuntime.listOwned(
    tenant,
    view.requests.map((request) => request.projectId),
  );
  const stageByProject = new Map(owned.map((video) => [video.publicProjectId, video]));
  return {
    ...view,
    requests: view.requests.map((request) => {
      const video = stageByProject.get(request.projectId);
      return video === undefined
        ? request
        : {
            ...request,
            stage: video.stage,
            lanes: video.lanes,
            terminalReason: video.terminalReason,
            settledCostUsd: video.settledCostUsd,
          };
    }),
  };
}

export function registerSharedAppRoutes(app: Hono, runtime: FixtureRuntime): void {
  app.post("/api/dev/shared-app/reset", async (c) => {
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
    if (runtime.fairAdmission !== undefined) await runtime.fairAdmission.reset();
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
      runtime.sharedApp.recover(session.id);
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
      >[1];
      runtime.sharedApp.acceptLaneCallback(session.id, body);
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

  app.get("/api/v2/queue", async (c) => {
    const session = runtime.resolveSession(c);
    if (!session.ok) return session.response;
    await runtime.sharedApp.waitForSettled();
    try {
      const tenant = runtime.sharedApp.tenant(session.id);
      const email = runtime.sharedApp.view(session.id).admission.email;
      if (runtime.fairAdmission !== undefined && tenant !== null && email !== null) {
        runtime.sharedApp.reconcileFairAdmission(
          session.id,
          await runtime.fairAdmission.listOwned(tenant, email),
        );
      }
      return c.json(await withVideoRuntimeStages(runtime, session.id));
    } catch (error) {
      return failure(error);
    }
  });

  app.patch("/api/v2/queue/:entryId", async (c) => {
    const session = runtime.resolveSession(c);
    if (!session.ok) return session.response;
    try {
      const body = (await c.req.json()) as { toPosition: number; version: number };
      const tenant = runtime.sharedApp.tenant(session.id);
      const email = runtime.sharedApp.view(session.id).admission.email;
      if (runtime.fairAdmission !== undefined && tenant !== null && email !== null) {
        runtime.sharedApp.reconcileFairAdmission(
          session.id,
          await runtime.fairAdmission.reorderOwned({
            tenant,
            actorEmail: email,
            requestId: c.req.param("entryId"),
            expectedVersion: body.version,
            toPosition: body.toPosition,
          }),
        );
      } else {
        runtime.sharedApp.reorder({
          sessionId: session.id,
          entryId: c.req.param("entryId"),
          toPosition: body.toPosition,
          ifMatch: body.version,
        });
      }
      return c.json(runtime.sharedApp.privateFairQueueView(session.id));
    } catch (error) {
      return failure(error);
    }
  });

  app.delete("/api/v2/queue/:entryId", async (c) => {
    const session = runtime.resolveSession(c);
    if (!session.ok) return session.response;
    try {
      const tenant = runtime.sharedApp.tenant(session.id);
      const email = runtime.sharedApp.view(session.id).admission.email;
      if (runtime.fairAdmission !== undefined && tenant !== null && email !== null) {
        runtime.sharedApp.reconcileFairAdmission(
          session.id,
          await runtime.fairAdmission.cancelOwned({
            tenant,
            actorEmail: email,
            requestId: c.req.param("entryId"),
            expectedVersion: Number(c.req.query("version")),
          }),
        );
      } else {
        runtime.sharedApp.remove({
          sessionId: session.id,
          entryId: c.req.param("entryId"),
          ifMatch: Number(c.req.query("version")),
        });
      }
      return c.json(runtime.sharedApp.privateFairQueueView(session.id));
    } catch (error) {
      return failure(error);
    }
  });

  /**
   * The tenant scope bound to the caller's own session. It is derived from the admitted identity,
   * so a session can only ever read its own account and default workspace.
   */
  app.get("/api/v1/shared-app/tenant", (c) => {
    const session = runtime.resolveSession(c);
    if (!session.ok) return session.response;
    const tenant = runtime.sharedApp.tenant(session.id);
    if (tenant === null) {
      return c.json({ error: { code: "WORKSPACE_ACCESS_REQUIRED" } }, 403);
    }
    return c.json(tenant);
  });

  app.post("/api/v2/generation-requests", async (c) => {
    const session = runtime.resolveSession(c);
    if (!session.ok) return session.response;
    try {
      const body = (await c.req.json()) as {
        projectId: string;
        title: string;
        imageReceiptId?: string;
        avatarReceiptId?: string;
      };
      const tenant = runtime.sharedApp.tenant(session.id);
      const email = runtime.sharedApp.view(session.id).admission.email;
      if (runtime.fairAdmission !== undefined && tenant !== null && email !== null) {
        const admitted = await runtime.fairAdmission.enqueueVideo({
          tenant,
          actorEmail: email,
          publicProjectId: body.projectId,
          title: body.title,
        });
        const result = runtime.sharedApp.startOrEnqueue({
          sessionId: session.id,
          ...body,
          admission: admitted,
        });
        runtime.sharedApp.reconcileFairAdmission(session.id, admitted.snapshot);
        if (runtime.videoRuntime !== undefined) {
          await runtime.videoRuntime.register(tenant, body.projectId);
        }
        return c.json(result);
      }
      return c.json(runtime.sharedApp.startOrEnqueue({ sessionId: session.id, ...body }));
    } catch (error) {
      return failure(error);
    }
  });

  /**
   * Advances one owned admitted video by exactly one durable step and returns its factual state.
   * Progress is driven by the caller; no state is reported before the database accepts it.
   */
  app.post("/api/v2/videos/:projectId/advance", async (c) => {
    const session = runtime.resolveSession(c);
    if (!session.ok) return session.response;
    try {
      const tenant = runtime.sharedApp.tenant(session.id);
      if (runtime.videoRuntime === undefined || tenant === null) {
        throw new SharedFixtureError(
          "VIDEO_RUNTIME_UNAVAILABLE",
          404,
          "No durable video runtime is bound to this deployment.",
        );
      }
      return c.json(await runtime.videoRuntime.advance(tenant, c.req.param("projectId")));
    } catch (error) {
      return failure(error);
    }
  });

  /** Cancels one owned video. A foreign or unknown video is a non-revealing not-found. */
  app.post("/api/v2/videos/:projectId/cancel", async (c) => {
    const session = runtime.resolveSession(c);
    if (!session.ok) return session.response;
    try {
      const tenant = runtime.sharedApp.tenant(session.id);
      if (runtime.videoRuntime === undefined || tenant === null) {
        throw new SharedFixtureError(
          "VIDEO_RUNTIME_UNAVAILABLE",
          404,
          "No durable video runtime is bound to this deployment.",
        );
      }
      return c.json(await runtime.videoRuntime.cancel(tenant, c.req.param("projectId")));
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
      const result = await runtime.sharedApp.advance(session.id);
      const tenant = runtime.sharedApp.tenant(session.id);
      if (
        runtime.fairAdmission !== undefined &&
        tenant !== null &&
        result.completedProjectId !== null
      ) {
        runtime.sharedApp.reconcileFairAdmission(
          session.id,
          await runtime.fairAdmission.settleSucceeded({
            tenant,
            publicProjectId: result.completedProjectId,
          }),
        );
      }
      return c.json(result);
    } catch (error) {
      return failure(error);
    }
  });

  app.get("/api/v1/shared-app/projects/:projectId", async (c) => {
    const session = runtime.resolveSession(c);
    if (!session.ok) return session.response;
    try {
      await runtime.sharedApp.waitForSettled();
      return c.json(runtime.sharedApp.projectOrchestration(session.id, c.req.param("projectId")));
    } catch (error) {
      return failure(error);
    }
  });

  app.get("/api/v1/shared-app/projects/:projectId/download", async (c) => {
    const session = runtime.resolveSession(c);
    if (!session.ok) return session.response;
    try {
      await runtime.sharedApp.waitForSettled();
      const project = runtime.sharedApp.projectOrchestration(session.id, c.req.param("projectId"));
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
      const bytes = await runtime.sharedApp.finalMp4(session.id, project.projectId);
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

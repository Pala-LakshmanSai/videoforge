import { executionProfileCatalog } from "@videoforge/config";
import { LocalArtifactStore } from "@videoforge/pipeline";
import { getFixtureScenario, toBootstrapResponse } from "@videoforge/test-fixtures";
import type { Hono } from "hono";

import {
  projectVersionError,
  readCreateProjectRequest,
  readFinalApprovalRequest,
  readProjectMutationRequest,
} from "../mutation";
import { apiProblem, problemResponse } from "../problem";
import type { LocalRuntime } from "./runtime";
import { LOCAL_PROJECT_ID } from "./types";
import { localTimelineInspection } from "./timeline-inspection";

const LOCAL_SCENARIO_ID = "project_create_ready" as const;

function localScenario() {
  const resolved = getFixtureScenario(LOCAL_SCENARIO_ID);
  if (!resolved) throw new Error("The local bootstrap fixture is missing.");
  return resolved;
}

function projectNotFound(projectId: string): Response {
  return problemResponse(
    apiProblem(
      "PROJECT_NOT_FOUND",
      404,
      "Project not found",
      `Local project '${projectId}' is not present in this bounded server process.`,
      false,
    ),
  );
}

function pipelineNotReady(detail: string): Response {
  return problemResponse(
    apiProblem("PROJECT_PREVIEW_NOT_READY", 409, "Local preview is not ready", detail, false),
  );
}

function parseByteRange(header: string, bytes: number): { start: number; end: number } | null {
  const match = /^bytes=([0-9]*)-([0-9]*)$/u.exec(header.trim());
  if (!match) return null;
  const startText = match[1] ?? "";
  const endText = match[2] ?? "";
  if (!startText && !endText) return null;

  let start: number;
  let end: number;
  if (!startText) {
    const suffix = Number(endText);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    start = Math.max(0, bytes - suffix);
    end = bytes - 1;
  } else {
    start = Number(startText);
    end = endText ? Number(endText) : bytes - 1;
  }
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    start >= bytes
  ) {
    return null;
  }
  return { start, end: Math.min(end, bytes - 1) };
}

async function mediaResponse(
  runtime: LocalRuntime,
  rangeHeader: string | undefined,
  attachment: boolean,
): Promise<Response> {
  const project = runtime.project();
  const output = runtime.output();
  if (!project || !output || !["READY_FOR_REVIEW", "APPROVED"].includes(project.project.status)) {
    return pipelineNotReady("Wait for transcription, scheduling, rendering, and technical probe.");
  }
  if (attachment && project.project.status !== "APPROVED") {
    return pipelineNotReady("Approve the exact current MP4 candidate before downloading it.");
  }

  const store = await LocalArtifactStore.create(output.artifactRoot);
  const verified = await store.readObject(output.sha256, "mp4");
  if (verified.bytes !== output.bytes) {
    throw new Error("The accepted local MP4 no longer matches its recorded byte count.");
  }
  const bytes = verified.content;
  const headers = new Headers({
    "accept-ranges": "bytes",
    "cache-control": "no-store",
    "content-type": "video/mp4",
    etag: `"${output.sha256}"`,
    "x-content-sha256": output.sha256,
    "x-videoforge-artifact-kind": "local-synthetic-mp4",
  });
  if (attachment) {
    headers.set("content-disposition", `attachment; filename="${output.filename}"`);
  }

  if (!rangeHeader) {
    headers.set("content-length", String(bytes.byteLength));
    return new Response(new Uint8Array(bytes), { status: 200, headers });
  }
  const range = parseByteRange(rangeHeader, bytes.byteLength);
  if (!range) {
    headers.set("content-range", `bytes */${bytes.byteLength}`);
    return new Response(null, { status: 416, headers });
  }
  const partial = bytes.subarray(range.start, range.end + 1);
  headers.set("content-length", String(partial.byteLength));
  headers.set("content-range", `bytes ${range.start}-${range.end}/${bytes.byteLength}`);
  return new Response(new Uint8Array(partial), { status: 206, headers });
}

export function registerLocalRoutes(app: Hono, runtime: LocalRuntime): void {
  app.get("/api/health", (c) =>
    c.json({
      app: "videoforge" as const,
      status: "ok" as const,
      mode: runtime.mode,
      commit: runtime.commit,
      fixture_id: null,
      synthetic: true as const,
      provider_calls_authorized: false as const,
      authorized_spend_usd: 0 as const,
    }),
  );

  app.get("/api/v1/bootstrap", async (c) => c.json(await runtime.bootstrapResponse()));
  app.get("/api/v1/execution-profiles", (c) => c.json(executionProfileCatalog));

  app.get("/api/v1/avatar-profiles", (c) => c.json(toBootstrapResponse(localScenario()).avatars));
  app.get("/api/v1/image-styles", (c) => c.json(toBootstrapResponse(localScenario()).styles));

  app.get("/api/v1/voiceovers/:assetId", async (c) => {
    const voiceover = await runtime.ownedVoiceover();
    if (c.req.param("assetId") !== voiceover.assetId) {
      return problemResponse(
        apiProblem(
          "VOICEOVER_ASSET_NOT_FOUND",
          404,
          "Voiceover was not found",
          "Select the owned local walking-slice voiceover from Create.",
          false,
        ),
      );
    }
    return c.json({
      assetId: voiceover.assetId,
      checksum: voiceover.checksum,
      filename: voiceover.filename,
      durationSeconds: voiceover.durationSeconds,
      sampleRate: voiceover.sampleRate,
      channels: voiceover.channels,
      verificationState: "VERIFIED" as const,
      persistedBytes: true as const,
      providerCallsAuthorized: false as const,
    });
  });

  app.get("/api/v1/projects", (c) => {
    const project = runtime.project();
    return c.json(project ? [project.project] : []);
  });
  app.get("/api/v1/projects/:projectId", (c) => {
    const project = runtime.project();
    if (!project || c.req.param("projectId") !== project.project.id) {
      return projectNotFound(c.req.param("projectId"));
    }
    c.header("etag", project.project.versionToken);
    return c.json(project);
  });
  app.get("/api/v1/projects/:projectId/events", (c) => {
    const project = runtime.project();
    if (!project || c.req.param("projectId") !== project.project.id) {
      return projectNotFound(c.req.param("projectId"));
    }
    return c.json(project.events);
  });
  app.get("/api/v1/projects/:projectId/timeline-inspection", async (c) => {
    const project = runtime.project();
    if (!project || c.req.param("projectId") !== project.project.id) {
      return projectNotFound(c.req.param("projectId"));
    }
    const output = runtime.output();
    return c.json(
      await localTimelineInspection(
        project.project,
        output
          ? {
              artifactRoot: output.artifactRoot,
              transcriptSha256: output.transcriptSha256,
              timelineSha256: output.timelineSha256,
              selectedSpanAudio: output.selectedSpanAudio,
            }
          : null,
      ),
    );
  });
  app.get("/api/v1/projects/:projectId/preview", (c) => {
    if (c.req.param("projectId") !== LOCAL_PROJECT_ID) {
      return projectNotFound(c.req.param("projectId"));
    }
    return mediaResponse(runtime, c.req.header("range"), false);
  });
  app.get("/api/v1/projects/:projectId/download", (c) => {
    if (c.req.param("projectId") !== LOCAL_PROJECT_ID) {
      return projectNotFound(c.req.param("projectId"));
    }
    return mediaResponse(runtime, undefined, true);
  });

  app.get("/api/v1/usage", (c) =>
    c.json({
      currentMonth: 0,
      projectSpend: 0,
      styleSpend: 0,
      avatarTestSpend: 0,
      storageGb: 0,
      gpuSeconds: 0,
      retries: 0,
    }),
  );

  app.post("/api/v1/projects/preflight", (c) =>
    runtime.mutation(c, false, async (rawBody) => {
      const request = readCreateProjectRequest(rawBody);
      if (!request.ok) return request.response;
      const voiceover = await runtime.ownedVoiceover();
      if (request.data.voiceover_asset_id !== voiceover.assetId) {
        return problemResponse(
          apiProblem(
            "VOICEOVER_ASSET_NOT_FOUND",
            422,
            "Owned voiceover binding is invalid",
            "Create the local slice with the exact voiceover exposed by bootstrap.",
            false,
          ),
        );
      }
      if (
        request.data.avatar_profile_version_id !== "avatar_profile_version_fixture_001" ||
        request.data.image_style_version_id !== "style_version_documentary_stock_v1"
      ) {
        return problemResponse(
          apiProblem(
            "LOCAL_PRESET_BINDING_INVALID",
            422,
            "Local fixture preset binding is invalid",
            "Use the exact owned avatar and documentary style versions exposed by bootstrap.",
            false,
          ),
        );
      }
      if (request.data.spend_cap_usd !== 0.1) {
        return problemResponse(
          apiProblem(
            "LOCAL_SPEND_CAP_INVALID",
            422,
            "Local slice request cap must be $0.10",
            "The canonical create contract requires a bounded cap; local external spend remains $0.",
            false,
          ),
        );
      }
      return c.json({
        ok: true as const,
        status: "READY" as const,
        fixture: LOCAL_SCENARIO_ID,
        avatarProfileVersionId: request.data.avatar_profile_version_id,
        imageStyleVersionId: request.data.image_style_version_id,
        estimatedCostUsd: 0,
        spendCapUsd: 0.1,
        providerCallsAuthorized: false as const,
      });
    }),
  );

  app.post("/api/v1/projects", (c) =>
    runtime.mutation(c, false, async (rawBody) => {
      if (runtime.project()) {
        return problemResponse(
          apiProblem(
            "LOCAL_PROJECT_ALREADY_EXISTS",
            409,
            "The bounded local project already exists",
            "Use the current project or restart local mode to begin a fresh bounded run.",
            false,
          ),
        );
      }
      const request = readCreateProjectRequest(rawBody);
      if (!request.ok) return request.response;
      const voiceover = await runtime.ownedVoiceover();
      if (
        request.data.voiceover_asset_id !== voiceover.assetId ||
        request.data.avatar_profile_version_id !== "avatar_profile_version_fixture_001" ||
        request.data.image_style_version_id !== "style_version_documentary_stock_v1" ||
        request.data.spend_cap_usd !== 0.1
      ) {
        return problemResponse(
          apiProblem(
            "LOCAL_PREFLIGHT_REQUIRED",
            422,
            "Local project inputs do not match the ready preflight",
            "Refresh Create and submit the exact owned voiceover, avatar, style, and bounded $0.10 cap.",
            false,
          ),
        );
      }
      const project = runtime.start(request.data, voiceover);
      if (!project) throw new Error("Local project state was not created.");
      c.header("etag", project.project.versionToken);
      return c.json(
        {
          ok: true as const,
          id: project.project.id,
          revisionId: project.project.revisionId,
          status: "QUEUED" as const,
          fixture: LOCAL_SCENARIO_ID,
          nextFixture: "happy_generating" as const,
          pins: project.project.pins,
          providerCallsAuthorized: false as const,
          versionToken: project.project.versionToken,
        },
        202,
      );
    }),
  );

  app.post("/api/v1/projects/:projectId/cancel", (c) =>
    runtime.mutation(c, true, (rawBody) => {
      const project = runtime.project();
      const projectId = c.req.param("projectId");
      if (!project || project.project.id !== projectId) return projectNotFound(projectId);
      const request = readProjectMutationRequest(rawBody, projectId);
      if (!request.ok) return request.response;
      const versionError = projectVersionError(c, project.project.versionToken);
      if (versionError) return versionError;
      const cancelled = runtime.cancel();
      if (!cancelled) {
        return problemResponse(
          apiProblem(
            "PROJECT_CANCEL_NOT_ALLOWED",
            409,
            "Local project cannot be cancelled",
            "Only an active local media process can be cancelled.",
            false,
          ),
        );
      }
      c.header("etag", cancelled.project.versionToken);
      return c.json(
        {
          ok: true as const,
          id: projectId,
          status: "CANCEL_REQUESTED" as const,
          versionToken: cancelled.project.versionToken,
        },
        202,
      );
    }),
  );

  app.post("/api/v1/projects/:projectId/retry", (c) =>
    runtime.mutation(c, true, (rawBody) => {
      const project = runtime.project();
      const projectId = c.req.param("projectId");
      if (!project || project.project.id !== projectId) return projectNotFound(projectId);
      const request = readProjectMutationRequest(rawBody, projectId);
      if (!request.ok) return request.response;
      const versionError = projectVersionError(c, project.project.versionToken);
      if (versionError) return versionError;
      const retried = runtime.retry();
      if (!retried) {
        return problemResponse(
          apiProblem(
            "PROJECT_RETRY_NOT_ALLOWED",
            409,
            "Local project has no retryable failure",
            "Retry is available only after an explicit local media failure.",
            false,
          ),
        );
      }
      c.header("etag", retried.project.versionToken);
      return c.json(
        {
          ok: true as const,
          id: projectId,
          status: "RETRY_REQUESTED" as const,
          retryScope: ["local_media_pipeline"] as const,
          nextCheckSeconds: 1,
          versionToken: retried.project.versionToken,
        },
        202,
      );
    }),
  );

  app.post("/api/v1/projects/:projectId/approve", (c) =>
    runtime.mutation(c, true, (rawBody) => {
      const project = runtime.project();
      const projectId = c.req.param("projectId");
      if (!project || project.project.id !== projectId) return projectNotFound(projectId);
      const approval = readFinalApprovalRequest(rawBody, projectId);
      if (!approval.ok) return approval.response;
      const versionError = projectVersionError(c, project.project.versionToken);
      if (versionError) return versionError;
      if (
        project.project.status !== "READY_FOR_REVIEW" ||
        project.project.review.candidateId !== approval.candidateId ||
        project.project.review.candidateSha256 !== approval.candidateSha256
      ) {
        return problemResponse(
          apiProblem(
            "REVIEW_CANDIDATE_CONFLICT",
            409,
            "Review candidate has changed or is not ready",
            "Refresh and approve the exact current candidate ID and SHA-256 checksum.",
            false,
          ),
        );
      }
      const approved = runtime.approve();
      if (!approved) throw new Error("Ready local project could not be approved.");
      c.header("etag", approved.project.versionToken);
      return c.json({
        ok: true as const,
        id: projectId,
        status: "APPROVED" as const,
        candidateId: approval.candidateId,
        candidateSha256: approval.candidateSha256,
        downloadUrl: approved.project.review.downloadUrl,
        versionToken: approved.project.versionToken,
      });
    }),
  );
}

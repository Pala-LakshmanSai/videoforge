import { execFileSync } from "node:child_process";

import { expect, test } from "@playwright/test";

const SESSION_ID = "playwright.cloudflare-runtime-parity";
const INITIAL_VERSION_TOKEN = '"vf-project_fixture_001-revision_fixture_001-v1"';
const APPROVED_VERSION_TOKEN = '"vf-project_fixture_001-revision_fixture_001-v2"';
const REVIEW_CANDIDATE_SHA256 =
  "sha256:7777777777777777777777777777777777777777777777777777777777777777";
const HEAD_COMMIT = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
  encoding: "utf8",
}).trim();

const sessionHeaders = {
  "x-videoforge-fixture-session": SESSION_ID,
};

function mutationHeaders(idempotencyKey: string): Record<string, string> {
  return {
    ...sessionHeaders,
    "content-type": "application/json",
    "idempotency-key": idempotencyKey,
    "if-match": INITIAL_VERSION_TOKEN,
  };
}

test("Cloudflare local origin preserves fixture reads, problems, idempotency, and preview bytes", async ({
  request,
}) => {
  const reset = await request.post("/api/dev/fixture-session/reset", {
    headers: sessionHeaders,
  });
  expect(reset.status()).toBe(200);
  expect(await reset.json()).toEqual({
    ok: true,
    sessionId: SESSION_ID,
    providerCallsAuthorized: false,
  });

  const health = await request.get("/api/health?fixture=project_create_ready", {
    headers: sessionHeaders,
  });
  expect(health.status()).toBe(200);
  expect(health.headers()).toMatchObject({
    "cache-control": "no-store",
    "x-videoforge-fixture-session": SESSION_ID,
    "x-videoforge-provider-mode": "fixture",
    "x-videoforge-synthetic": "true",
  });
  expect(await health.json()).toEqual({
    app: "videoforge",
    status: "ok",
    mode: "fixture",
    commit: HEAD_COMMIT,
    fixture_id: "project_create_ready",
    synthetic: true,
    provider_calls_authorized: false,
    authorized_spend_usd: 0,
  });

  const project = await request.get(
    "/api/v1/projects/project_fixture_001?fixture=project_ready_for_review",
    { headers: sessionHeaders },
  );
  expect(project.status()).toBe(200);
  expect(project.headers().etag).toBe(INITIAL_VERSION_TOKEN);
  expect(await project.json()).toMatchObject({
    project: {
      id: "project_fixture_001",
      status: "READY_FOR_REVIEW",
      review: {
        state: "READY_FOR_REVIEW",
        candidateId: "review_candidate_fixture_001",
        candidateSha256: REVIEW_CANDIDATE_SHA256,
      },
    },
  });

  const missingProject = await request.get(
    "/api/v1/projects/project_missing?fixture=happy_generating",
    { headers: sessionHeaders },
  );
  expect(missingProject.status()).toBe(404);
  expect(await missingProject.json()).toEqual({
    error: {
      code: "PROJECT_NOT_FOUND",
      message: "Project not found",
      detail: "Project 'project_missing' is not present in fixture 'happy_generating'.",
      retryable: false,
    },
    type: "https://videoforge.local/problems/project-not-found",
    title: "Project not found",
    status: 404,
  });

  const approvalBody = {
    project_id: "project_fixture_001",
    candidate_id: "review_candidate_fixture_001",
    candidate_sha256: REVIEW_CANDIDATE_SHA256,
  };
  const approvalPath =
    "/api/v1/projects/project_fixture_001/approve?fixture=project_ready_for_review";
  const approved = await request.post(approvalPath, {
    headers: mutationHeaders("playwright-cloudflare-final-approval"),
    data: approvalBody,
  });
  expect(approved.status()).toBe(200);
  expect(approved.headers().etag).toBe(APPROVED_VERSION_TOKEN);
  const approvedBody = {
    ok: true,
    id: "project_fixture_001",
    status: "APPROVED",
    candidateId: "review_candidate_fixture_001",
    candidateSha256: REVIEW_CANDIDATE_SHA256,
    downloadUrl: "/api/v1/projects/project_fixture_001/download?fixture=project_ready_for_review",
    versionToken: APPROVED_VERSION_TOKEN,
  };
  expect(await approved.json()).toEqual(approvedBody);

  const replay = await request.post(approvalPath, {
    headers: mutationHeaders("playwright-cloudflare-final-approval"),
    data: approvalBody,
  });
  expect(replay.status()).toBe(200);
  expect(replay.headers()["x-videoforge-idempotent-replay"]).toBe("true");
  expect(await replay.json()).toEqual(approvedBody);

  const approvedProject = await request.get(
    "/api/v1/projects/project_fixture_001?fixture=project_ready_for_review",
    { headers: sessionHeaders },
  );
  expect(approvedProject.status()).toBe(200);
  expect(approvedProject.headers().etag).toBe(APPROVED_VERSION_TOKEN);
  expect(await approvedProject.json()).toMatchObject({
    project: {
      status: "APPROVED",
      allowedActions: ["REVIEW", "DOWNLOAD"],
      review: {
        state: "APPROVED",
        downloadUrl: approvedBody.downloadUrl,
      },
    },
  });

  const [download, publicAsset] = await Promise.all([
    request.get(approvedBody.downloadUrl, { headers: sessionHeaders }),
    request.get("/fixtures/media/watermelon-market.svg"),
  ]);
  expect(download.status()).toBe(200);
  expect(publicAsset.status()).toBe(200);
  expect(download.headers()).toMatchObject({
    "content-disposition": 'attachment; filename="videoforge-fixture-preview.svg"',
    "x-videoforge-artifact-kind": "synthetic-preview",
  });
  expect(download.headers()["content-type"]).toContain("image/svg+xml");
  const [downloadBytes, publicAssetBytes] = await Promise.all([
    download.body(),
    publicAsset.body(),
  ]);
  expect(downloadBytes).toEqual(publicAssetBytes);
  expect(downloadBytes.toString("utf8")).toContain("<svg");
});

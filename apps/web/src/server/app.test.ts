import { FIXTURE_SCENARIO_IDS } from "@videoforge/test-fixtures";
import { describe, expect, it } from "vitest";

import { createApiApp } from "./app";

const validCreateProjectRequest = {
  title: "How to Recognize a Sweet Watermelon",
  voiceover_asset_id: "asset_voiceover_example",
  avatar_profile_version_id: "avatar_profile_version_fixture_001",
  image_style_version_id: "style_version_documentary_stock_v1",
  optional_script: null,
  extra_prompt_keywords: "ultra realistic, no AI look",
  apply_extra_prompt_keywords: false,
  generation_mode: "BALANCED",
  execution_profile_overrides: null,
  spend_cap_usd: 1.5,
  user_seed: null,
};

function mutationHeaders(): Record<string, string> {
  return {
    "content-type": "application/json",
    "idempotency-key": "fixture-idempotency-key-001",
    "if-match": "fixture-v1",
  };
}

describe("fixture API", () => {
  const app = createApiApp({ commit: "abcdef1234567890" });

  it("reports provider-free health with the active deterministic fixture", async () => {
    const response = await app.request("/api/health?fixture=project_create_ready");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      app: "videoforge",
      status: "ok",
      mode: "fixture",
      commit: "abcdef1234567890",
      fixture_id: "project_create_ready",
      synthetic: true,
      provider_calls_authorized: false,
      authorized_spend_usd: 0,
    });
  });

  it("publishes all stable fixture IDs through the dev registry", async () => {
    const response = await app.request("/api/dev/fixtures");
    const body = (await response.json()) as { count: number; fixtures: Array<{ id: string }> };
    expect(response.status).toBe(200);
    expect(body.count).toBe(FIXTURE_SCENARIO_IDS.length);
    expect(body.fixtures.map((fixture) => fixture.id)).toEqual(FIXTURE_SCENARIO_IDS);
  });

  it.each(FIXTURE_SCENARIO_IDS)("serves direct bootstrap JSON for %s", async (fixture) => {
    const response = await app.request(`/api/v1/bootstrap?fixture=${fixture}`);
    const body = (await response.json()) as { scenario: string; user: { id: string } };
    expect(response.status).toBe(200);
    expect(body.scenario).toBe(fixture);
    expect(body.user.id).toBe("user_fixture_lakshman");
    expect(response.headers.get("x-videoforge-provider-mode")).toBe("fixture");
  });

  it("returns direct project, avatar, style, and usage shapes", async () => {
    const [projects, project, avatars, styles, usage] = await Promise.all([
      app.request("/api/v1/projects?fixture=happy_generating"),
      app.request("/api/v1/projects/project_fixture_001?fixture=happy_generating"),
      app.request("/api/v1/avatar-profiles?fixture=avatar_profile_ready"),
      app.request("/api/v1/image-styles?fixture=style_v2_analyzing_v1_active"),
      app.request("/api/v1/usage?fixture=happy_generating"),
    ]);
    expect(Array.isArray(await projects.json())).toBe(true);
    expect(await project.json()).toMatchObject({
      project: { id: "project_fixture_001" },
      events: expect.any(Array),
    });
    expect(await avatars.json()).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: "READY" })]),
    );
    expect(await styles.json()).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: "ANALYZING" })]),
    );
    expect(await usage.json()).toMatchObject({ projectSpend: 0.41, gpuSeconds: 1107 });
  });

  it("returns a client-compatible structured error for an unknown fixture", async () => {
    const response = await app.request("/api/v1/bootstrap?fixture=not_real");
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: { code: "FIXTURE_NOT_FOUND", message: "Unknown fixture scenario" },
      status: 404,
    });
  });

  it("accepts a valid create-project contract without calling providers", async () => {
    const response = await app.request("/api/v1/projects?fixture=project_create_ready", {
      method: "POST",
      headers: mutationHeaders(),
      body: JSON.stringify(validCreateProjectRequest),
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      ok: true,
      id: "project_fixture_001",
      status: "QUEUED",
      providerCallsAuthorized: false,
    });

    const redirectedProject = await app.request(
      "/api/v1/projects/project_fixture_001?fixture=happy_generating",
    );
    expect(redirectedProject.status).toBe(200);
    expect(await redirectedProject.json()).toMatchObject({
      project: { id: "project_fixture_001" },
    });
  });

  it("rejects legacy inline-avatar input at the contract boundary", async () => {
    const response = await app.request("/api/v1/projects?fixture=project_create_ready", {
      method: "POST",
      headers: mutationHeaders(),
      body: JSON.stringify({
        ...validCreateProjectRequest,
        avatar_profile_version_id: undefined,
        avatar_source: { kind: "IMAGE_ASSET", avatar_image_asset_id: "asset_inline_forbidden" },
      }),
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_CREATE_PROJECT_REQUEST" },
    });
  });

  it("surfaces deterministic scenario blockers as mutation errors", async () => {
    const response = await app.request("/api/v1/projects?fixture=budget_blocked", {
      method: "POST",
      headers: mutationHeaders(),
      body: JSON.stringify(validCreateProjectRequest),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "BUDGET_CAP_EXCEEDED", retryable: false },
    });
  });

  it("requires idempotency and version headers for fixture mutations", async () => {
    const missingIdempotency = await app.request("/api/v1/projects?fixture=project_create_ready", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validCreateProjectRequest),
    });
    expect(missingIdempotency.status).toBe(400);

    const missingVersion = await app.request(
      "/api/v1/projects/project_fixture_001/cancel?fixture=happy_generating",
      {
        method: "POST",
        headers: { "idempotency-key": "fixture-key" },
      },
    );
    expect(missingVersion.status).toBe(428);
  });

  it("retries only the exact failed item set and never blind-dispatches reconciliation", async () => {
    const retry = await app.request(
      "/api/v1/projects/project_fixture_001/retry?fixture=image_partial_failure",
      {
        method: "POST",
        headers: mutationHeaders(),
        body: JSON.stringify({ project_id: "project_fixture_001" }),
      },
    );
    expect(retry.status).toBe(202);
    expect(await retry.json()).toMatchObject({
      ok: true,
      status: "RETRY_REQUESTED",
      retryScope: ["scene_fixture_014", "scene_fixture_015"],
      nextCheckSeconds: 10,
    });

    const unsafeRetry = await app.request(
      "/api/v1/projects/project_fixture_001/retry?fixture=dispatch_ack_unknown",
      {
        method: "POST",
        headers: mutationHeaders(),
        body: JSON.stringify({ project_id: "project_fixture_001" }),
      },
    );
    expect(unsafeRetry.status).toBe(409);
    expect(await unsafeRetry.json()).toMatchObject({
      error: { code: "PROJECT_RETRY_NOT_ALLOWED", retryable: false },
    });
  });
});

import { sha256CanonicalJson, validateAndHashContractDocument } from "@videoforge/contracts";
import { FIXTURE_SCENARIO_IDS } from "@videoforge/test-fixtures";
import { describe, expect, it } from "vitest";

import { createApiApp as createRuntimeApiApp } from "./app";
import type { SharedAppPersistence } from "./shared-app-persistence";
import { fixtureTimelineDocuments } from "./timeline-inspection";

const fixturePreview = { read: async () => "<svg>fixture preview</svg>" };

function createApiApp(
  options: {
    readonly commit?: string;
    readonly environment?: "development" | "test" | "production";
    readonly sharedAppPersistence?: SharedAppPersistence;
  } = {},
) {
  return createRuntimeApiApp({
    configuration: {
      commit: options.commit ?? "uncommitted",
      environment: options.environment ?? "development",
      mode: "fixture",
    },
    bindings: {
      platform: "node",
      fixturePreview,
      fixtureSharedAppPersistence: options.sharedAppPersistence,
    },
  });
}

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

const validAvatarProfileMetadata = {
  name: "Maya — field presenter",
  thumbnail_url: "/fixtures/avatar/amish-farm-host.svg",
  source_dimensions: { width: 1536, height: 2048 },
  preparation_profile: "fixture-browser-decode-v1",
  validation_profile: "fixture-manual-framing-v1",
  compatibility: "UNTESTED",
  lifecycle: "ACTIVE",
  version_state: "READY",
  uploaded_bytes_persisted: false,
  attestations: {
    image_use_rights: true,
    likeness_animation_consent: true,
  },
};

const validImageStyleMetadata = {
  name: "Quiet workshop documentary",
  summary: "Available light, restrained contrast, and tactile material detail.",
  cover_url: "/fixtures/styles/warm-rural.svg",
  reference_urls: [],
  example_urls: [
    "/fixtures/styles/rural-field.svg",
    "/fixtures/styles/rural-hands.svg",
    "/fixtures/styles/rural-kitchen.svg",
  ],
  medium: "Observational documentary still",
  lighting: "Natural soft side light",
  color: "Neutral earth and muted botanical green",
  texture: "Tactile material detail with restrained sharpening",
  retention_summary: "No uploaded bytes retained; owned fixture examples shown",
  lifecycle: "ACTIVE",
  version_state: "PUBLISHED",
  uploaded_bytes_persisted: false,
  attestations: {
    reference_rights: true,
    processing_disclosure_acknowledged: true,
  },
};

async function expectedAvatarProfileHash(): Promise<string> {
  return sha256CanonicalJson({
    schema_version: "fixture-avatar-profile-version/v1",
    thumbnail_url: validAvatarProfileMetadata.thumbnail_url,
    source_dimensions: validAvatarProfileMetadata.source_dimensions,
    preparation_profile: validAvatarProfileMetadata.preparation_profile,
    validation_profile: validAvatarProfileMetadata.validation_profile,
    compatibility: validAvatarProfileMetadata.compatibility,
    lifecycle: validAvatarProfileMetadata.lifecycle,
    version_state: validAvatarProfileMetadata.version_state,
    uploaded_bytes_persisted: validAvatarProfileMetadata.uploaded_bytes_persisted,
    attestations: validAvatarProfileMetadata.attestations,
  });
}

async function expectedImageStyleHash(): Promise<string> {
  return sha256CanonicalJson({
    schema_version: "fixture-image-style-version/v1",
    summary: validImageStyleMetadata.summary,
    cover_url: validImageStyleMetadata.cover_url,
    reference_urls: validImageStyleMetadata.reference_urls,
    example_urls: validImageStyleMetadata.example_urls,
    medium: validImageStyleMetadata.medium,
    lighting: validImageStyleMetadata.lighting,
    color: validImageStyleMetadata.color,
    texture: validImageStyleMetadata.texture,
    retention_summary: validImageStyleMetadata.retention_summary,
    lifecycle: validImageStyleMetadata.lifecycle,
    version_state: validImageStyleMetadata.version_state,
    uploaded_bytes_persisted: validImageStyleMetadata.uploaded_bytes_persisted,
    attestations: validImageStyleMetadata.attestations,
  });
}

let mutationKeySequence = 0;
const INITIAL_VERSION_TOKEN = '"vf-project_fixture_001-revision_fixture_001-v1"';
const REVIEW_CANDIDATE_SHA256 =
  "sha256:7777777777777777777777777777777777777777777777777777777777777777";

function mutationHeaders(
  key = `fixture-idempotency-key-${++mutationKeySequence}`,
  ifMatch = INITIAL_VERSION_TOKEN,
): Record<string, string> {
  return {
    "content-type": "application/json",
    "idempotency-key": key,
    "if-match": ifMatch,
  };
}

function withFixtureSession(
  sessionId: string,
  headers: Record<string, string> = {},
): Record<string, string> {
  return {
    ...headers,
    "x-videoforge-fixture-session": sessionId,
  };
}

describe("fixture API", () => {
  const app = createApiApp({ commit: "abcdef1234567890" });

  it("reports provider-free health with the active deterministic fixture", async () => {
    const response = await app.request("/api/health?fixture=project_create_ready");
    expect(response.status).toBe(200);
    expect(response.headers.get("x-videoforge-fixture-session")).toBe("default");
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

  it("exposes revision-bound fixture timing and layout coverage without provider data", async () => {
    const response = await app.request(
      "/api/v1/projects/project_fixture_001/timeline-inspection?fixture=happy_generating",
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      documents: { transcriptSha256: string; timelineSha256: string };
    };
    expect(body).toMatchObject({
      schemaVersion: "videoforge.timeline-inspection/v1",
      projectId: "project_fixture_001",
      revisionId: "revision_fixture_001",
      sourceMode: "FIXTURE",
      ready: true,
      invalidation: { state: "CURRENT", recomputeRequired: false, reason: null },
      blockers: [],
      timing: { sourceDurationMs: 40_000, phraseCount: 7, coverage: "COMPLETE" },
      plan: { totalFrames: 1_200, sourceStartMs: 0, sourceEndMs: 40_000 },
      selectedAvatar: { count: 2, coveragePercent: 21.25 },
    });
    const documents = fixtureTimelineDocuments({
      id: "project_fixture_001",
      revisionId: "revision_fixture_001",
    });
    const [transcript, timeline] = await Promise.all([
      validateAndHashContractDocument("transcriptTiming", documents.transcript),
      validateAndHashContractDocument("timelinePlan", documents.timeline),
    ]);
    expect(body.documents).toEqual({
      transcriptSha256: transcript.sha256,
      timelineSha256: timeline.sha256,
    });
  });

  it("publishes two truthful primary compute lanes without selectable untested GPUs", async () => {
    const response = await app.request("/api/v1/execution-profiles?fixture=project_create_ready");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      lanes: Array<{
        status: Record<string, unknown>;
        selector_options: Array<Record<string, unknown>>;
        planned_candidates: Array<{ selectable: boolean }>;
      }>;
    };
    expect(body).toMatchObject({
      provider_mode: "fixture",
      provider_calls_authorized: false,
      maximum_external_spend_usd: 0,
      selection_policy: { raw_gpu_mutation_allowed: false, production_gate_id: "GATE_GPU_001" },
    });
    expect(body.lanes).toHaveLength(2);
    for (const lane of body.lanes) {
      expect(lane.status).toMatchObject({
        label: "Fixture ready",
        provider_state: "NOT_CONNECTED",
        external_spend_usd: 0,
      });
      expect(lane.selector_options).toEqual([
        expect.objectContaining({ label: "Fixture", selectable: true, gpu_label: null }),
      ]);
      expect(
        lane.planned_candidates.every(
          (candidate: { selectable: boolean }) => !candidate.selectable,
        ),
      ).toBe(true);
    }
  });

  it("publishes all stable fixture IDs through the dev registry", async () => {
    const response = await app.request("/api/dev/fixtures");
    const body = (await response.json()) as { count: number; fixtures: Array<{ id: string }> };
    expect(response.status).toBe(200);
    expect(body.count).toBe(FIXTURE_SCENARIO_IDS.length);
    expect(body.fixtures.map((fixture) => fixture.id)).toEqual(FIXTURE_SCENARIO_IDS);
  });

  it("does not register development fixture routes in production", async () => {
    const productionApp = createApiApp({
      commit: "abcdef1234567890",
      environment: "production",
    });
    const response = await productionApp.request("/api/dev/fixtures");
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "API_ROUTE_NOT_FOUND" },
    });

    for (const request of [
      productionApp.request("/api/health"),
      productionApp.request("/api/v1/bootstrap?fixture=happy_generating"),
      productionApp.request("/api/health", {
        headers: withFixtureSession("must-not-create-production-state"),
      }),
    ]) {
      const fixtureResponse = await request;
      expect(fixtureResponse.status).toBe(404);
      await expect(fixtureResponse.json()).resolves.toMatchObject({
        error: { code: "API_ROUTE_NOT_FOUND" },
      });
    }
  });

  it("strictly validates bounded development fixture-session IDs", async () => {
    for (const sessionId of ["", "space inside", "slash/not-allowed", "x".repeat(97)]) {
      const response = await app.request("/api/health", {
        headers: withFixtureSession(sessionId),
      });
      expect(response.status, sessionId).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "INVALID_FIXTURE_SESSION" },
      });
    }

    const accepted = await app.request("/api/health", {
      headers: withFixtureSession("playwright.desktop:review_001"),
    });
    expect(accepted.status).toBe(200);
    expect(accepted.headers.get("x-videoforge-fixture-session")).toBe(
      "playwright.desktop:review_001",
    );
  });

  it("resets one development fixture session without affecting another", async () => {
    const isolatedApp = createApiApp({ commit: "fixture-session-reset", environment: "test" });
    const sessionA = "test.reset-a";
    const sessionB = "test.reset-b";
    const approvalPath =
      "/api/v1/projects/project_fixture_001/approve?fixture=project_ready_for_review";
    const approval = await isolatedApp.request(approvalPath, {
      method: "POST",
      headers: withFixtureSession(sessionA, mutationHeaders("reset-session-approval")),
      body: JSON.stringify({
        project_id: "project_fixture_001",
        candidate_id: "review_candidate_fixture_001",
        candidate_sha256: REVIEW_CANDIDATE_SHA256,
      }),
    });
    expect(approval.status).toBe(200);

    const reset = await isolatedApp.request("/api/dev/fixture-session/reset", {
      method: "POST",
      headers: withFixtureSession(sessionA),
    });
    expect(reset.status).toBe(200);
    await expect(reset.json()).resolves.toEqual({
      ok: true,
      sessionId: sessionA,
      providerCallsAuthorized: false,
    });

    for (const sessionId of [sessionA, sessionB]) {
      const detail = await isolatedApp.request(
        "/api/v1/projects/project_fixture_001?fixture=project_ready_for_review",
        { headers: withFixtureSession(sessionId) },
      );
      await expect(detail.json()).resolves.toMatchObject({
        project: { status: "READY_FOR_REVIEW", review: { state: "READY_FOR_REVIEW" } },
      });
    }
  });

  it.each(FIXTURE_SCENARIO_IDS)("serves direct bootstrap JSON for %s", async (fixture) => {
    const response = await app.request(`/api/v1/bootstrap?fixture=${fixture}`);
    const body = (await response.json()) as { scenario: string; user: { id: string } };
    expect(response.status).toBe(200);
    expect(body.scenario).toBe(fixture);
    expect(body.user.id).toBe(
      fixture === "invite_sign_in"
        ? "user_fixture_signed_out"
        : fixture === "invite_access_denied"
          ? "user_fixture_uninvited"
          : "user_fixture_lakshman",
    );
    expect(response.headers.get("x-videoforge-provider-mode")).toBe("fixture");
  });

  it("keeps signed-out and denied scenarios outside every workspace API boundary", async () => {
    const sessionId = "test.access-boundary";
    const readHeaders = withFixtureSession(sessionId);
    const created = await app.request("/api/v1/avatar-profiles?fixture=project_create_ready", {
      method: "POST",
      headers: withFixtureSession(sessionId, mutationHeaders("access-boundary-avatar-create")),
      body: JSON.stringify({ ...validAvatarProfileMetadata, name: "Access boundary fixture" }),
    });
    expect(created.status).toBe(201);

    for (const fixture of ["invite_sign_in", "invite_access_denied"] as const) {
      const bootstrap = await app.request(`/api/v1/bootstrap?fixture=${fixture}`, {
        headers: readHeaders,
      });
      expect(bootstrap.status).toBe(200);
      await expect(bootstrap.json()).resolves.toMatchObject({
        scenario: fixture,
        access: { state: fixture === "invite_sign_in" ? "SIGN_IN_REQUIRED" : "DENIED" },
        projects: [],
        avatars: [],
        styles: [],
        usage: {
          currentMonth: 0,
          projectSpend: 0,
          styleSpend: 0,
          avatarTestSpend: 0,
          storageGb: 0,
          gpuSeconds: 0,
          retries: 0,
        },
        activeOperations: { avatar: null, style: null },
      });

      for (const path of [
        "/api/v1/execution-profiles",
        "/api/v1/avatar-profiles",
        "/api/v1/image-styles",
        "/api/v1/projects",
        "/api/v1/projects/project_fixture_001",
        "/api/v1/projects/project_fixture_001/events",
        "/api/v1/usage",
        "/api/v1/voiceovers/fixture_voiceover_missing",
      ]) {
        const response = await app.request(`${path}?fixture=${fixture}`, { headers: readHeaders });
        expect(response.status, `${fixture} ${path}`).toBe(403);
        await expect(response.json()).resolves.toMatchObject({
          error: { code: "WORKSPACE_ACCESS_REQUIRED" },
        });
      }

      const mutation = await app.request(`/api/v1/projects?fixture=${fixture}`, {
        method: "POST",
        headers: withFixtureSession(sessionId, mutationHeaders(`blocked-${fixture}`)),
        body: JSON.stringify(validCreateProjectRequest),
      });
      expect(mutation.status).toBe(403);
      await expect(mutation.json()).resolves.toMatchObject({
        error: { code: "WORKSPACE_ACCESS_REQUIRED" },
      });
    }
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
      expect.arrayContaining([
        expect.objectContaining({ status: "PUBLISHED", draftStatus: "ANALYZING" }),
      ]),
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
      nextFixture: "happy_generating",
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

  it.each([
    {
      label: "unknown voiceover",
      fixture: "project_create_ready",
      request: { ...validCreateProjectRequest, voiceover_asset_id: "asset_voiceover_unknown" },
      status: 422,
      code: "VOICEOVER_ASSET_NOT_FOUND",
    },
    {
      label: "unknown avatar version",
      fixture: "project_create_ready",
      request: {
        ...validCreateProjectRequest,
        avatar_profile_version_id: "avatar_profile_version_unknown",
      },
      status: 422,
      code: "AVATAR_PROFILE_NOT_FOUND",
    },
    {
      label: "unknown style version",
      fixture: "project_create_ready",
      request: {
        ...validCreateProjectRequest,
        image_style_version_id: "style_version_unknown",
      },
      status: 422,
      code: "IMAGE_STYLE_VERSION_NOT_FOUND",
    },
    {
      label: "uploading avatar version",
      fixture: "avatar_profile_uploading",
      request: validCreateProjectRequest,
      status: 409,
      code: "AVATAR_PROFILE_NOT_READY",
    },
    {
      label: "analyzing unpublished style version",
      fixture: "style_analyzing",
      request: {
        ...validCreateProjectRequest,
        image_style_version_id: "style_version_warm_rural_v1",
      },
      status: 409,
      code: "STYLE_NOT_READY",
    },
  ])("semantically rejects $label", async ({ fixture, request, status, code }) => {
    const response = await app.request(`/api/v1/projects/preflight?fixture=${fixture}`, {
      method: "POST",
      headers: mutationHeaders(),
      body: JSON.stringify(request),
    });
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({ error: { code } });
  });

  it("accepts only registered SHA-256-bound local fixture voiceover handles", async () => {
    const assetId = `fixture_voiceover_sha256_${"a".repeat(64)}`;
    const unregistered = await app.request(
      "/api/v1/projects/preflight?fixture=project_create_ready",
      {
        method: "POST",
        headers: mutationHeaders(),
        body: JSON.stringify({
          ...validCreateProjectRequest,
          voiceover_asset_id: assetId,
        }),
      },
    );
    expect(unregistered.status).toBe(409);
    await expect(unregistered.json()).resolves.toMatchObject({
      error: { code: "VOICEOVER_ASSET_NOT_REGISTERED" },
    });

    const registration = await app.request(
      "/api/v1/voiceovers/register?fixture=project_create_ready",
      {
        method: "POST",
        headers: mutationHeaders(),
        body: JSON.stringify({
          asset_id: assetId,
          checksum: `sha256:${"a".repeat(64)}`,
          filename: "narration.wav",
          duration_seconds: 42.5,
          sample_rate: 48_000,
          channels: 1,
        }),
      },
    );
    expect(registration.status).toBe(201);
    await expect(registration.json()).resolves.toMatchObject({
      ok: true,
      voiceover: {
        assetId,
        verificationState: "VERIFIED",
        persistedBytes: false,
      },
    });

    const verifiedHandle = await app.request(
      "/api/v1/projects/preflight?fixture=project_create_ready",
      {
        method: "POST",
        headers: mutationHeaders(),
        body: JSON.stringify({
          ...validCreateProjectRequest,
          voiceover_asset_id: assetId,
        }),
      },
    );
    expect(verifiedHandle.status).toBe(200);

    const legacySizeHandle = await app.request(
      "/api/v1/projects/preflight?fixture=project_create_ready",
      {
        method: "POST",
        headers: mutationHeaders(),
        body: JSON.stringify({
          ...validCreateProjectRequest,
          voiceover_asset_id: "fixture_voiceover_12480",
        }),
      },
    );
    expect(legacySizeHandle.status).toBe(422);
    await expect(legacySizeHandle.json()).resolves.toMatchObject({
      error: { code: "VOICEOVER_ASSET_NOT_FOUND" },
    });
  });

  it("keeps published style v1 selectable while draft v2 is analyzing", async () => {
    const response = await app.request(
      "/api/v1/projects/preflight?fixture=style_v2_analyzing_v1_active",
      {
        method: "POST",
        headers: mutationHeaders(),
        body: JSON.stringify({
          ...validCreateProjectRequest,
          image_style_version_id: "style_version_warm_rural_v1",
        }),
      },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      imageStyleVersionId: "style_version_warm_rural_v1",
    });
  });

  it("blocks enabled forbidden keywords, permits negative phrases, and ignores disabled text", async () => {
    const forbidden = await app.request("/api/v1/projects/preflight?fixture=project_create_ready", {
      method: "POST",
      headers: mutationHeaders(),
      body: JSON.stringify({
        ...validCreateProjectRequest,
        extra_prompt_keywords: "add a logo and title text",
        apply_extra_prompt_keywords: true,
      }),
    });
    expect(forbidden.status).toBe(422);
    await expect(forbidden.json()).resolves.toMatchObject({
      error: { code: "EXTRA_KEYWORDS_FORBIDDEN_OUTPUT" },
    });

    const negative = await app.request("/api/v1/projects/preflight?fixture=project_create_ready", {
      method: "POST",
      headers: mutationHeaders(),
      body: JSON.stringify({
        ...validCreateProjectRequest,
        extra_prompt_keywords:
          "no logo, no visible text, avoid decorative transitions, watermark-free",
        apply_extra_prompt_keywords: true,
      }),
    });
    expect(negative.status).toBe(200);

    const disabled = await app.request("/api/v1/projects/preflight?fixture=project_create_ready", {
      method: "POST",
      headers: mutationHeaders(),
      body: JSON.stringify({
        ...validCreateProjectRequest,
        extra_prompt_keywords: "add a logo and title text",
        apply_extra_prompt_keywords: false,
      }),
    });
    expect(disabled.status).toBe(200);
  });

  it("requires the $0.88 estimate to fit within the submitted spend cap", async () => {
    const blocked = await app.request("/api/v1/projects/preflight?fixture=project_create_ready", {
      method: "POST",
      headers: mutationHeaders(),
      body: JSON.stringify({ ...validCreateProjectRequest, spend_cap_usd: 0.87 }),
    });
    expect(blocked.status).toBe(409);
    await expect(blocked.json()).resolves.toMatchObject({
      error: { code: "BUDGET_CAP_EXCEEDED" },
    });

    const exact = await app.request("/api/v1/projects/preflight?fixture=project_create_ready", {
      method: "POST",
      headers: mutationHeaders(),
      body: JSON.stringify({ ...validCreateProjectRequest, spend_cap_usd: 0.88 }),
    });
    expect(exact.status).toBe(200);
  });

  it("rejects unknown or cross-lane execution profile overrides", async () => {
    for (const execution_profile_overrides of [
      { image_media_profile_id: "exec_fixture_unknown_v1" },
      { image_media_profile_id: "exec_fixture_avatar_primary_v1" },
    ]) {
      const response = await app.request(
        "/api/v1/projects/preflight?fixture=project_create_ready",
        {
          method: "POST",
          headers: mutationHeaders(),
          body: JSON.stringify({ ...validCreateProjectRequest, execution_profile_overrides }),
        },
      );
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "EXECUTION_PROFILE_NOT_AVAILABLE", retryable: false },
      });
    }
  });

  it.each(["image_partial_failure", "style_analysis_failed"])(
    "does not let unrelated %s mutation problems block project creation",
    async (fixture) => {
      const response = await app.request(`/api/v1/projects?fixture=${fixture}`, {
        method: "POST",
        headers: mutationHeaders(),
        body: JSON.stringify(validCreateProjectRequest),
      });
      expect(response.status).toBe(202);
      await expect(response.json()).resolves.toMatchObject({ ok: true, status: "QUEUED" });
    },
  );

  it("replays the same idempotency key and rejects that key with a different body", async () => {
    const key = "fixture-create-replay-key";
    const request = {
      method: "POST",
      headers: mutationHeaders(key),
      body: JSON.stringify(validCreateProjectRequest),
    } as const;
    const first = await app.request("/api/v1/projects?fixture=project_create_ready", request);
    const firstBody = await first.json();
    expect(first.status).toBe(202);

    const replay = await app.request("/api/v1/projects?fixture=project_create_ready", request);
    expect(replay.status).toBe(202);
    expect(replay.headers.get("x-videoforge-idempotent-replay")).toBe("true");
    await expect(replay.json()).resolves.toEqual(firstBody);

    const conflict = await app.request("/api/v1/projects?fixture=project_create_ready", {
      method: "POST",
      headers: mutationHeaders(key),
      body: JSON.stringify({ ...validCreateProjectRequest, title: "A different project" }),
    });
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      error: { code: "IDEMPOTENCY_KEY_REUSED" },
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

  it("rejects stale version tokens and path/body project mismatches", async () => {
    const stale = await app.request(
      "/api/v1/projects/project_fixture_001/cancel?fixture=happy_generating",
      {
        method: "POST",
        headers: mutationHeaders(undefined, "fixture-v0"),
        body: JSON.stringify({ project_id: "project_fixture_001" }),
      },
    );
    expect(stale.status).toBe(412);
    await expect(stale.json()).resolves.toMatchObject({
      error: { code: "REVISION_CONFLICT" },
    });

    const mismatch = await app.request(
      "/api/v1/projects/project_fixture_001/cancel?fixture=happy_generating",
      {
        method: "POST",
        headers: mutationHeaders(),
        body: JSON.stringify({ project_id: "project_fixture_other" }),
      },
    );
    expect(mismatch.status).toBe(409);
    await expect(mismatch.json()).resolves.toMatchObject({
      error: { code: "PROJECT_ID_MISMATCH" },
    });
  });

  it("publishes a strong project ETag, rotates it atomically, and rejects a racing mutation", async () => {
    const statefulApp = createApiApp({ commit: "project-etag-race", environment: "test" });
    const detailResponse = await statefulApp.request(
      "/api/v1/projects/project_fixture_001?fixture=image_partial_failure",
    );
    const detail = (await detailResponse.json()) as {
      project: { versionToken: string };
    };
    expect(detail.project.versionToken).toBe(INITIAL_VERSION_TOKEN);
    expect(detailResponse.headers.get("etag")).toBe(INITIAL_VERSION_TOKEN);

    const [retry, cancel] = await Promise.all([
      statefulApp.request(
        "/api/v1/projects/project_fixture_001/retry?fixture=image_partial_failure",
        {
          method: "POST",
          headers: mutationHeaders("etag-race-retry", detail.project.versionToken),
          body: JSON.stringify({ project_id: "project_fixture_001" }),
        },
      ),
      statefulApp.request(
        "/api/v1/projects/project_fixture_001/cancel?fixture=image_partial_failure",
        {
          method: "POST",
          headers: mutationHeaders("etag-race-cancel", detail.project.versionToken),
          body: JSON.stringify({ project_id: "project_fixture_001" }),
        },
      ),
    ]);
    expect([retry.status, cancel.status].sort()).toEqual([202, 412]);

    const accepted = retry.status === 202 ? retry : cancel;
    const rejected = retry.status === 412 ? retry : cancel;
    const acceptedBody = (await accepted.json()) as { versionToken: string };
    expect(accepted.headers.get("etag")).toBe(acceptedBody.versionToken);
    expect(acceptedBody.versionToken).not.toBe(INITIAL_VERSION_TOKEN);
    await expect(rejected.json()).resolves.toMatchObject({
      error: { code: "REVISION_CONFLICT" },
    });
  });

  it("does not cancel again while cancellation settles or approve an approved revision again", async () => {
    const cancelling = await app.request(
      "/api/v1/projects/project_fixture_001/cancel?fixture=cancel_requested",
      {
        method: "POST",
        headers: mutationHeaders(),
        body: JSON.stringify({ project_id: "project_fixture_001" }),
      },
    );
    expect(cancelling.status).toBe(409);
    await expect(cancelling.json()).resolves.toMatchObject({
      error: { code: "PROJECT_CANCEL_ALREADY_REQUESTED" },
    });

    const approved = await app.request(
      "/api/v1/projects/project_fixture_001/approve?fixture=project_approved",
      {
        method: "POST",
        headers: mutationHeaders(),
        body: JSON.stringify({
          project_id: "project_fixture_001",
          candidate_id: "review_candidate_fixture_001",
          candidate_sha256: REVIEW_CANDIDATE_SHA256,
        }),
      },
    );
    expect(approved.status).toBe(409);
    await expect(approved.json()).resolves.toMatchObject({
      error: { code: "PROJECT_ALREADY_APPROVED" },
    });
  });

  it("retries only the exact failed item set and never blind-dispatches reconciliation", async () => {
    const statefulApp = createApiApp({ commit: "stateful-retry" });
    const retry = await statefulApp.request(
      "/api/v1/projects/project_fixture_001/retry?fixture=image_partial_failure",
      {
        method: "POST",
        headers: mutationHeaders(),
        body: JSON.stringify({ project_id: "project_fixture_001" }),
      },
    );
    expect(retry.status).toBe(202);
    const retryBody = (await retry.json()) as { versionToken: string };
    expect(retryBody).toMatchObject({
      ok: true,
      status: "RETRY_REQUESTED",
      retryScope: ["scene_fixture_014", "scene_fixture_015"],
      nextCheckSeconds: 10,
    });

    const detail = await statefulApp.request(
      "/api/v1/projects/project_fixture_001?fixture=image_partial_failure",
    );
    await expect(detail.json()).resolves.toMatchObject({
      project: {
        status: "RUNNING",
        stage: "IMAGE_RETRY",
        allowedActions: ["CANCEL"],
        lanes: { image: { state: "RETRYING" } },
      },
      notice: { title: "Image retry queued" },
    });

    const duplicateWithNewKey = await statefulApp.request(
      "/api/v1/projects/project_fixture_001/retry?fixture=image_partial_failure",
      {
        method: "POST",
        headers: mutationHeaders("fixture-retry-second-key", retryBody.versionToken),
        body: JSON.stringify({ project_id: "project_fixture_001" }),
      },
    );
    expect(duplicateWithNewKey.status).toBe(409);
    await expect(duplicateWithNewKey.json()).resolves.toMatchObject({
      error: { code: "PROJECT_RETRY_NOT_ALLOWED" },
    });

    const unsafeRetry = await statefulApp.request(
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

  it("isolates approval, project materialization, presets, and idempotency by fixture session", async () => {
    const isolatedApp = createApiApp({ commit: "isolated-fixture-sessions", environment: "test" });
    const sessionA = "test.session-a";
    const sessionB = "test.session-b";
    const headersFor = (sessionId: string, key: string) =>
      withFixtureSession(sessionId, mutationHeaders(key));
    const readHeadersFor = (sessionId: string) => withFixtureSession(sessionId);

    const approvalPath =
      "/api/v1/projects/project_fixture_001/approve?fixture=project_ready_for_review";
    const approval = await isolatedApp.request(approvalPath, {
      method: "POST",
      headers: headersFor(sessionA, "session-a-final-approval"),
      body: JSON.stringify({
        project_id: "project_fixture_001",
        candidate_id: "review_candidate_fixture_001",
        candidate_sha256: REVIEW_CANDIDATE_SHA256,
      }),
    });
    expect(approval.status).toBe(200);

    const [approvedInA, untouchedInB] = await Promise.all([
      isolatedApp.request("/api/v1/projects/project_fixture_001?fixture=project_ready_for_review", {
        headers: readHeadersFor(sessionA),
      }),
      isolatedApp.request("/api/v1/projects/project_fixture_001?fixture=project_ready_for_review", {
        headers: readHeadersFor(sessionB),
      }),
    ]);
    await expect(approvedInA.json()).resolves.toMatchObject({
      project: { status: "APPROVED", review: { state: "APPROVED" } },
    });
    await expect(untouchedInB.json()).resolves.toMatchObject({
      project: { status: "READY_FOR_REVIEW", review: { state: "READY_FOR_REVIEW" } },
    });

    const submitted = {
      ...validCreateProjectRequest,
      title: "Session A materialized project",
      generation_mode: "FASTER" as const,
    };
    const createdProject = await isolatedApp.request(
      "/api/v1/projects?fixture=project_create_ready",
      {
        method: "POST",
        headers: headersFor(sessionA, "session-a-project-create"),
        body: JSON.stringify(submitted),
      },
    );
    expect(createdProject.status).toBe(202);

    const [projectInA, projectInB, bootstrapInA] = await Promise.all([
      isolatedApp.request("/api/v1/projects/project_fixture_001?fixture=happy_generating", {
        headers: readHeadersFor(sessionA),
      }),
      isolatedApp.request("/api/v1/projects/project_fixture_001?fixture=happy_generating", {
        headers: readHeadersFor(sessionB),
      }),
      isolatedApp.request("/api/v1/bootstrap?fixture=happy_generating", {
        headers: readHeadersFor(sessionA),
      }),
    ]);
    await expect(projectInA.json()).resolves.toMatchObject({
      project: { title: submitted.title, mode: "FASTER" },
    });
    const projectBBody = (await projectInB.json()) as { project: { title: string } };
    expect(projectBBody.project.title).not.toBe(submitted.title);
    await expect(bootstrapInA.json()).resolves.toMatchObject({
      draft: { title: submitted.title, generationMode: "FASTER" },
    });

    const sharedPresetKey = "same-key-is-valid-in-separate-sessions";
    const avatarA = await isolatedApp.request("/api/v1/avatar-profiles?fixture=avatar_hub_empty", {
      method: "POST",
      headers: headersFor(sessionA, sharedPresetKey),
      body: JSON.stringify(validAvatarProfileMetadata),
    });
    expect(avatarA.status).toBe(201);
    const avatarABody = (await avatarA.json()) as {
      avatarProfile: { name: string; versionId: string };
    };

    const [avatarCatalogA, avatarCatalogB] = await Promise.all([
      isolatedApp.request("/api/v1/avatar-profiles?fixture=avatar_hub_empty", {
        headers: readHeadersFor(sessionA),
      }),
      isolatedApp.request("/api/v1/avatar-profiles?fixture=avatar_hub_empty", {
        headers: readHeadersFor(sessionB),
      }),
    ]);
    await expect(avatarCatalogA.json()).resolves.toEqual([
      expect.objectContaining({ versionId: avatarABody.avatarProfile.versionId }),
    ]);
    await expect(avatarCatalogB.json()).resolves.toEqual([]);

    const avatarB = await isolatedApp.request("/api/v1/avatar-profiles?fixture=avatar_hub_empty", {
      method: "POST",
      headers: headersFor(sessionB, sharedPresetKey),
      body: JSON.stringify({ ...validAvatarProfileMetadata, name: "Session B presenter" }),
    });
    expect(avatarB.status).toBe(201);
    expect(avatarB.headers.get("x-videoforge-idempotent-replay")).toBeNull();

    const styleA = await isolatedApp.request("/api/v1/image-styles?fixture=project_create_ready", {
      method: "POST",
      headers: headersFor(sessionA, "session-a-style-create"),
      body: JSON.stringify(validImageStyleMetadata),
    });
    expect(styleA.status).toBe(201);
    const styleABody = (await styleA.json()) as { imageStyle: { versionId: string } };
    const [styleCatalogA, styleCatalogB] = await Promise.all([
      isolatedApp.request("/api/v1/image-styles?fixture=project_create_ready", {
        headers: readHeadersFor(sessionA),
      }),
      isolatedApp.request("/api/v1/image-styles?fixture=project_create_ready", {
        headers: readHeadersFor(sessionB),
      }),
    ]);
    await expect(styleCatalogA.json()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ versionId: styleABody.imageStyle.versionId }),
      ]),
    );
    await expect(styleCatalogB.json()).resolves.not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ versionId: styleABody.imageStyle.versionId }),
      ]),
    );

    const voiceoverHex = "9".repeat(64);
    const voiceoverAssetId = `fixture_voiceover_sha256_${voiceoverHex}`;
    const voiceoverA = await isolatedApp.request(
      "/api/v1/voiceovers/register?fixture=project_create_ready",
      {
        method: "POST",
        headers: headersFor(sessionA, "session-a-voiceover-register"),
        body: JSON.stringify({
          asset_id: voiceoverAssetId,
          checksum: `sha256:${voiceoverHex}`,
          filename: "session-a.wav",
          duration_seconds: 24,
          sample_rate: 48_000,
          channels: 1,
        }),
      },
    );
    expect(voiceoverA.status).toBe(201);
    const [voiceoverStatusA, voiceoverStatusB] = await Promise.all([
      isolatedApp.request(`/api/v1/voiceovers/${voiceoverAssetId}?fixture=project_create_ready`, {
        headers: readHeadersFor(sessionA),
      }),
      isolatedApp.request(`/api/v1/voiceovers/${voiceoverAssetId}?fixture=project_create_ready`, {
        headers: readHeadersFor(sessionB),
      }),
    ]);
    expect(voiceoverStatusA.status).toBe(200);
    expect(voiceoverStatusB.status).toBe(404);
  });

  it("materializes submitted project identity and immutable pins across every happy read", async () => {
    const statefulApp = createApiApp({ commit: "stateful-create" });
    const key = "stateful-project-create";
    const submitted = {
      ...validCreateProjectRequest,
      title: "A precise submitted project title",
      generation_mode: "FASTER",
      spend_cap_usd: 1.25,
    };
    const request = {
      method: "POST",
      headers: mutationHeaders(key),
      body: JSON.stringify(submitted),
    } as const;
    const created = await statefulApp.request(
      "/api/v1/projects?fixture=project_create_ready",
      request,
    );
    expect(created.status).toBe(202);
    const createdBody = (await created.json()) as {
      id: string;
      revisionId: string;
      pins: { avatarProfileVersionId: string; imageStyleVersionId: string };
    };
    expect(createdBody).toMatchObject({
      id: "project_fixture_001",
      revisionId: "revision_fixture_001",
      pins: {
        avatarProfileVersionId: submitted.avatar_profile_version_id,
        imageStyleVersionId: submitted.image_style_version_id,
      },
    });

    const replay = await statefulApp.request(
      "/api/v1/projects?fixture=project_create_ready",
      request,
    );
    expect(replay.headers.get("x-videoforge-idempotent-replay")).toBe("true");

    const [projectsResponse, detailResponse, bootstrapResponse] = await Promise.all([
      statefulApp.request("/api/v1/projects?fixture=happy_generating"),
      statefulApp.request(`/api/v1/projects/${createdBody.id}?fixture=happy_generating`),
      statefulApp.request("/api/v1/bootstrap?fixture=happy_generating"),
    ]);
    const projects = (await projectsResponse.json()) as Array<Record<string, unknown>>;
    const detail = (await detailResponse.json()) as {
      project: Record<string, unknown>;
    };
    const bootstrap = (await bootstrapResponse.json()) as {
      projects: Array<Record<string, unknown>>;
      draft: Record<string, unknown>;
    };
    expect(projects).toHaveLength(1);
    for (const project of [projects[0], detail.project, bootstrap.projects[0]]) {
      expect(project).toMatchObject({
        id: createdBody.id,
        title: submitted.title,
        revisionId: createdBody.revisionId,
        mode: "FASTER",
        capUsd: 1.25,
        pins: createdBody.pins,
      });
    }
    expect(bootstrap.draft).toMatchObject({
      title: submitted.title,
      avatarProfileVersionId: submitted.avatar_profile_version_id,
      imageStyleVersionId: submitted.image_style_version_id,
      generationMode: "FASTER",
      spendCapUsd: 1.25,
    });
  });

  it("requires the exact review candidate and persists approval plus download capability", async () => {
    const statefulApp = createApiApp({ commit: "stateful-approval" });
    const path = "/api/v1/projects/project_fixture_001/approve?fixture=project_ready_for_review";

    const prematureDownload = await statefulApp.request(
      "/api/v1/projects/project_fixture_001/download?fixture=project_ready_for_review",
    );
    expect(prematureDownload.status).toBe(409);
    await expect(prematureDownload.json()).resolves.toMatchObject({
      error: { code: "PROJECT_DOWNLOAD_NOT_READY" },
    });

    const missingCandidate = await statefulApp.request(path, {
      method: "POST",
      headers: mutationHeaders(),
      body: JSON.stringify({ project_id: "project_fixture_001" }),
    });
    expect(missingCandidate.status).toBe(422);
    await expect(missingCandidate.json()).resolves.toMatchObject({
      error: { code: "INVALID_FINAL_APPROVAL_REQUEST" },
    });

    const staleCandidate = await statefulApp.request(path, {
      method: "POST",
      headers: mutationHeaders(),
      body: JSON.stringify({
        project_id: "project_fixture_001",
        candidate_id: "review_candidate_stale",
        candidate_sha256: REVIEW_CANDIDATE_SHA256,
      }),
    });
    expect(staleCandidate.status).toBe(409);
    await expect(staleCandidate.json()).resolves.toMatchObject({
      error: { code: "REVIEW_CANDIDATE_CONFLICT" },
    });

    const staleChecksum = await statefulApp.request(path, {
      method: "POST",
      headers: mutationHeaders(),
      body: JSON.stringify({
        project_id: "project_fixture_001",
        candidate_id: "review_candidate_fixture_001",
        candidate_sha256: "sha256:8888888888888888888888888888888888888888888888888888888888888888",
      }),
    });
    expect(staleChecksum.status).toBe(409);
    await expect(staleChecksum.json()).resolves.toMatchObject({
      error: { code: "REVIEW_CANDIDATE_CHECKSUM_CONFLICT" },
    });

    const extraField = await statefulApp.request(path, {
      method: "POST",
      headers: mutationHeaders(),
      body: JSON.stringify({
        project_id: "project_fixture_001",
        candidate_id: "review_candidate_fixture_001",
        candidate_sha256: REVIEW_CANDIDATE_SHA256,
        reviewer_user_id: "client-must-not-authorize-reviewer",
      }),
    });
    expect(extraField.status).toBe(422);

    const approved = await statefulApp.request(path, {
      method: "POST",
      headers: mutationHeaders(),
      body: JSON.stringify({
        project_id: "project_fixture_001",
        candidate_id: "review_candidate_fixture_001",
        candidate_sha256: REVIEW_CANDIDATE_SHA256,
      }),
    });
    expect(approved.status).toBe(200);
    await expect(approved.json()).resolves.toMatchObject({
      ok: true,
      status: "APPROVED",
      candidateId: "review_candidate_fixture_001",
      candidateSha256: REVIEW_CANDIDATE_SHA256,
      downloadUrl: expect.stringContaining("/download?fixture=project_ready_for_review"),
    });

    const [detailResponse, projectsResponse, bootstrapResponse] = await Promise.all([
      statefulApp.request("/api/v1/projects/project_fixture_001?fixture=project_ready_for_review"),
      statefulApp.request("/api/v1/projects?fixture=project_ready_for_review"),
      statefulApp.request("/api/v1/bootstrap?fixture=project_ready_for_review"),
    ]);
    const detail = (await detailResponse.json()) as { project: Record<string, unknown> };
    const projects = (await projectsResponse.json()) as Array<Record<string, unknown>>;
    const bootstrap = (await bootstrapResponse.json()) as {
      projects: Array<Record<string, unknown>>;
    };
    for (const project of [detail.project, projects[0], bootstrap.projects[0]]) {
      expect(project).toMatchObject({
        status: "APPROVED",
        allowedActions: ["REVIEW", "DOWNLOAD"],
        review: {
          candidateId: "review_candidate_fixture_001",
          candidateSha256: REVIEW_CANDIDATE_SHA256,
          state: "APPROVED",
          downloadUrl: expect.any(String),
        },
      });
    }

    const download = await statefulApp.request(
      "/api/v1/projects/project_fixture_001/download?fixture=project_ready_for_review",
    );
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toContain("image/svg+xml");
    expect(download.headers.get("content-disposition")).toContain("videoforge-fixture-preview.svg");
    expect(download.headers.get("x-videoforge-artifact-kind")).toBe("synthetic-preview");
    expect(await download.text()).toContain("<svg");
  });

  it("persists cancellation and removes conflicting project actions", async () => {
    const statefulApp = createApiApp({ commit: "stateful-cancel" });
    const path = "/api/v1/projects/project_fixture_001/cancel?fixture=happy_generating";
    const cancelled = await statefulApp.request(path, {
      method: "POST",
      headers: mutationHeaders(),
      body: JSON.stringify({ project_id: "project_fixture_001" }),
    });
    expect(cancelled.status).toBe(202);
    const cancelledBody = (await cancelled.json()) as { versionToken: string };

    const [detailResponse, projectsResponse, bootstrapResponse] = await Promise.all([
      statefulApp.request("/api/v1/projects/project_fixture_001?fixture=happy_generating"),
      statefulApp.request("/api/v1/projects?fixture=happy_generating"),
      statefulApp.request("/api/v1/bootstrap?fixture=happy_generating"),
    ]);
    const detail = (await detailResponse.json()) as { project: Record<string, unknown> };
    const projects = (await projectsResponse.json()) as Array<Record<string, unknown>>;
    const bootstrap = (await bootstrapResponse.json()) as {
      projects: Array<Record<string, unknown>>;
    };
    for (const project of [detail.project, projects[0], bootstrap.projects[0]]) {
      expect(project).toMatchObject({
        status: "CANCEL_REQUESTED",
        stage: "CANCEL_REQUESTED",
        allowedActions: [],
        lanes: {
          image: { state: "CANCEL_REQUESTED" },
          avatar: { state: "CANCEL_REQUESTED" },
        },
      });
    }

    const duplicate = await statefulApp.request(path, {
      method: "POST",
      headers: mutationHeaders(undefined, cancelledBody.versionToken),
      body: JSON.stringify({ project_id: "project_fixture_001" }),
    });
    expect(duplicate.status).toBe(409);
    await expect(duplicate.json()).resolves.toMatchObject({
      error: { code: "PROJECT_CANCEL_ALREADY_REQUESTED" },
    });
  });

  it("creates immutable API-backed Avatar Profiles and resolves them at preflight", async () => {
    const statefulApp = createApiApp({ commit: "stateful-avatar" });
    const key = "avatar-create-idempotency";
    const request = {
      method: "POST",
      headers: mutationHeaders(key),
      body: JSON.stringify(validAvatarProfileMetadata),
    } as const;
    const created = await statefulApp.request(
      "/api/v1/avatar-profiles?fixture=avatar_hub_empty",
      request,
    );
    expect(created.status).toBe(201);
    const body = (await created.json()) as {
      avatarProfile: { versionId: string; profileHash: string };
    };
    expect(body).toMatchObject({
      ok: true,
      avatarProfile: {
        id: "avatar_profile_fixture_created_001",
        versionId: "avatar_profile_version_fixture_created_001",
        name: validAvatarProfileMetadata.name,
        status: "READY",
        profileHash: await expectedAvatarProfileHash(),
      },
      lifecycle: { profile: "ACTIVE", version: "READY" },
      immutableVersion: true,
      uploadedBytesPersisted: false,
      providerCallsAuthorized: false,
    });

    const replay = await statefulApp.request(
      "/api/v1/avatar-profiles?fixture=avatar_hub_empty",
      request,
    );
    expect(replay.headers.get("x-videoforge-idempotent-replay")).toBe("true");
    const [catalogResponse, bootstrapResponse] = await Promise.all([
      statefulApp.request("/api/v1/avatar-profiles?fixture=avatar_hub_empty"),
      statefulApp.request("/api/v1/bootstrap?fixture=avatar_hub_empty"),
    ]);
    const catalog = (await catalogResponse.json()) as Array<{ versionId: string }>;
    const bootstrap = (await bootstrapResponse.json()) as {
      avatars: Array<{ versionId: string }>;
    };
    expect(catalog.filter((item) => item.versionId === body.avatarProfile.versionId)).toHaveLength(
      1,
    );
    expect(bootstrap.avatars).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ versionId: body.avatarProfile.versionId }),
      ]),
    );

    const preflight = await statefulApp.request(
      "/api/v1/projects/preflight?fixture=avatar_hub_empty",
      {
        method: "POST",
        headers: mutationHeaders(),
        body: JSON.stringify({
          ...validCreateProjectRequest,
          avatar_profile_version_id: body.avatarProfile.versionId,
        }),
      },
    );
    expect(preflight.status).toBe(200);
  });

  it("creates immutable API-backed Image Styles and resolves them at preflight", async () => {
    const statefulApp = createApiApp({ commit: "stateful-style" });
    const created = await statefulApp.request("/api/v1/image-styles?fixture=project_create_ready", {
      method: "POST",
      headers: mutationHeaders(),
      body: JSON.stringify(validImageStyleMetadata),
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as {
      imageStyle: { versionId: string; profileHash: string };
    };
    expect(body).toMatchObject({
      ok: true,
      imageStyle: {
        id: "image_style_fixture_created_001",
        versionId: "image_style_version_fixture_created_001",
        name: validImageStyleMetadata.name,
        status: "PUBLISHED",
        profileHash: await expectedImageStyleHash(),
        exampleUrls: validImageStyleMetadata.example_urls,
      },
      lifecycle: { style: "ACTIVE", version: "PUBLISHED" },
      immutableVersion: true,
      uploadedBytesPersisted: false,
      providerCallsAuthorized: false,
    });

    const bootstrap = await statefulApp.request("/api/v1/bootstrap?fixture=project_create_ready");
    await expect(bootstrap.json()).resolves.toMatchObject({
      styles: expect.arrayContaining([
        expect.objectContaining({ versionId: body.imageStyle.versionId }),
      ]),
    });

    const preflight = await statefulApp.request(
      "/api/v1/projects/preflight?fixture=project_create_ready",
      {
        method: "POST",
        headers: mutationHeaders(),
        body: JSON.stringify({
          ...validCreateProjectRequest,
          image_style_version_id: body.imageStyle.versionId,
        }),
      },
    );
    expect(preflight.status).toBe(200);
  });

  it("rejects unowned media paths, client-supplied hashes, missing attestations, and voiceover mismatches", async () => {
    const statefulApp = createApiApp({ commit: "strict-metadata" });
    const badAvatar = await statefulApp.request(
      "/api/v1/avatar-profiles?fixture=avatar_hub_empty",
      {
        method: "POST",
        headers: mutationHeaders(),
        body: JSON.stringify({
          ...validAvatarProfileMetadata,
          thumbnail_url: "https://example.com/private-avatar.png",
          profile_hash: `sha256:${"f".repeat(64)}`,
          attestations: { image_use_rights: true },
        }),
      },
    );
    expect(badAvatar.status).toBe(422);
    await expect(badAvatar.json()).resolves.toMatchObject({
      error: { code: "INVALID_AVATAR_PROFILE_METADATA" },
    });

    const badStyle = await statefulApp.request(
      "/api/v1/image-styles?fixture=project_create_ready",
      {
        method: "POST",
        headers: mutationHeaders(),
        body: JSON.stringify({
          ...validImageStyleMetadata,
          cover_url: "/fixtures/styles/../avatar/private.svg",
          unexpected: true,
        }),
      },
    );
    expect(badStyle.status).toBe(422);

    const mismatch = await statefulApp.request(
      "/api/v1/voiceovers/register?fixture=project_create_ready",
      {
        method: "POST",
        headers: mutationHeaders(),
        body: JSON.stringify({
          asset_id: `fixture_voiceover_sha256_${"d".repeat(64)}`,
          checksum: `sha256:${"e".repeat(64)}`,
          filename: "narration.wav",
          duration_seconds: 20,
          sample_rate: 48_000,
          channels: 2,
        }),
      },
    );
    expect(mismatch.status).toBe(422);
    await expect(mismatch.json()).resolves.toMatchObject({
      error: { code: "VOICEOVER_CHECKSUM_MISMATCH" },
    });
  });

  it("returns registered voiceover status without retaining audio bytes", async () => {
    const statefulApp = createApiApp({ commit: "voiceover-status" });
    const hex = "f".repeat(64);
    const assetId = `fixture_voiceover_sha256_${hex}`;
    const registration = await statefulApp.request(
      "/api/v1/voiceovers/register?fixture=project_create_ready",
      {
        method: "POST",
        headers: mutationHeaders(),
        body: JSON.stringify({
          asset_id: assetId,
          checksum: `sha256:${hex}`,
          filename: "owned-final.flac",
          duration_seconds: 3_600,
          sample_rate: 192_000,
          channels: 2,
        }),
      },
    );
    expect(registration.status).toBe(201);
    const status = await statefulApp.request(
      `/api/v1/voiceovers/${assetId}?fixture=project_create_ready`,
    );
    expect(status.status).toBe(200);
    await expect(status.json()).resolves.toEqual({
      assetId,
      checksum: `sha256:${hex}`,
      filename: "owned-final.flac",
      durationSeconds: 3_600,
      sampleRate: 192_000,
      channels: 2,
      verificationState: "VERIFIED",
      persistedBytes: false,
      providerCallsAuthorized: false,
    });
  });
});

describe("CP-02 shared app fixture API", () => {
  it("admits email/password and Google fixtures, then shares one receipt-bound queue", async () => {
    const isolatedApp = createApiApp();
    const users = [
      { session: "cp02-a", email: "cp02-a@example.test", method: "EMAIL_PASSWORD" as const },
      { session: "cp02-b", email: "cp02-b@example.test", method: "GOOGLE" as const },
    ];
    for (const user of users) {
      const inviteResponse = await isolatedApp.request("/api/dev/shared-app/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: user.email }),
      });
      expect(inviteResponse.status).toBe(200);
      const invite = (await inviteResponse.json()) as {
        code: string;
        emailPassword: string;
        googleAssertion: string;
        shownOnce: boolean;
      };
      expect(invite.shownOnce).toBe(true);
      const auth = await isolatedApp.request(
        "/api/v1/shared-app/authenticate?fixture=invite_sign_in",
        {
          method: "POST",
          headers: withFixtureSession(user.session, { "content-type": "application/json" }),
          body: JSON.stringify({
            method: user.method,
            email: user.email,
            emailPassword: user.method === "EMAIL_PASSWORD" ? invite.emailPassword : undefined,
            googleAccountEmail: user.method === "GOOGLE" ? user.email : undefined,
            googleAssertion: user.method === "GOOGLE" ? invite.googleAssertion : undefined,
            inviteCode: invite.code,
          }),
        },
      );
      expect(auth.status).toBe(200);
      await expect(auth.json()).resolves.toMatchObject({ outcome: "ADMITTED", rights: "EQUAL" });
    }

    const viewResponse = await isolatedApp.request("/api/v1/shared-app?fixture=invite_sign_in", {
      headers: withFixtureSession(users[0]!.session),
    });
    const view = (await viewResponse.json()) as {
      inventory: Array<{ lane: string; receiptId: string }>;
    };
    const imageReceiptId = view.inventory.find((offer) => offer.lane === "image_media")!.receiptId;
    const avatarReceiptId = view.inventory.find(
      (offer) => offer.lane === "avatar_primary",
    )!.receiptId;
    const starts = await Promise.all(
      users.map((user, index) =>
        isolatedApp.request("/api/v1/shared-app/generate?fixture=invite_sign_in", {
          method: "POST",
          headers: withFixtureSession(user.session, { "content-type": "application/json" }),
          body: JSON.stringify({
            projectId: `cp02-project-${index + 1}`,
            title: `CP-02 Project ${index + 1}`,
            imageReceiptId,
            avatarReceiptId,
          }),
        }),
      ),
    );
    const outcomes = (await Promise.all(starts.map((response) => response.json()))) as Array<{
      outcome: string;
    }>;
    expect(outcomes.map((item) => item.outcome).sort()).toEqual(["QUEUED", "STARTED"]);
    const sharedResponse = await isolatedApp.request("/api/v1/shared-app?fixture=invite_sign_in", {
      headers: withFixtureSession(users[1]!.session),
    });
    await expect(sharedResponse.json()).resolves.toMatchObject({
      rights: "EQUAL",
      canSelectGpuPair: false,
      providerCallsAuthorized: false,
      authorizedSpendUsd: 0,
      queue: [{ state: "ACTIVE" }, { state: "WAITING" }],
    });
  });
});

describe("CP-05 provider-free complete MVP API", () => {
  it("rejects foreign callbacks and returns three playable checksum-bound MP4 downloads", async () => {
    const isolatedApp = createApiApp();
    const fixtureSession = "cp05-api";
    const email = "cp05@example.test";
    const inviteResponse = await isolatedApp.request("/api/dev/shared-app/invites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const invite = (await inviteResponse.json()) as {
      code: string;
      emailPassword: string;
    };
    const auth = await isolatedApp.request(
      "/api/v1/shared-app/authenticate?fixture=invite_sign_in",
      {
        method: "POST",
        headers: withFixtureSession(fixtureSession, { "content-type": "application/json" }),
        body: JSON.stringify({
          method: "EMAIL_PASSWORD",
          email,
          emailPassword: invite.emailPassword,
          inviteCode: invite.code,
        }),
      },
    );
    expect(auth.status).toBe(200);

    const initial = (await (
      await isolatedApp.request("/api/v1/shared-app?fixture=invite_sign_in", {
        headers: withFixtureSession(fixtureSession),
      })
    ).json()) as {
      inventory: Array<{ lane: string; receiptId: string }>;
    };
    const imageReceiptId = initial.inventory.find(
      (offer) => offer.lane === "image_media",
    )!.receiptId;
    const avatarReceiptId = initial.inventory.find(
      (offer) => offer.lane === "avatar_primary",
    )!.receiptId;
    for (let index = 1; index <= 3; index += 1) {
      const generated = await isolatedApp.request(
        "/api/v1/shared-app/generate?fixture=invite_sign_in",
        {
          method: "POST",
          headers: withFixtureSession(fixtureSession, { "content-type": "application/json" }),
          body: JSON.stringify({
            projectId: `cp05-project-${index}`,
            title: `CP-05 Project ${index}`,
            imageReceiptId,
            avatarReceiptId,
          }),
        },
      );
      expect(generated.status).toBe(200);
    }

    const active = (await (
      await isolatedApp.request("/api/v1/shared-app?fixture=invite_sign_in", {
        headers: withFixtureSession(fixtureSession),
      })
    ).json()) as {
      orchestration: {
        session: {
          sessionId: string;
          activeProjectId: string;
          lanes: {
            mage_image: {
              volumeId: string;
              selectedGpuSku: string;
              attempts: Array<{ podId: string }>;
            };
          };
        };
      };
    };
    const mage = active.orchestration.session.lanes.mage_image;
    const wrongCallback = await isolatedApp.request("/api/dev/shared-app/callback", {
      method: "POST",
      headers: withFixtureSession(fixtureSession, { "content-type": "application/json" }),
      body: JSON.stringify({
        sessionId: active.orchestration.session.sessionId,
        projectId: active.orchestration.session.activeProjectId,
        lane: "mage_image",
        podId: "foreign-pod",
        gpuSku: mage.selectedGpuSku,
        volumeId: mage.volumeId,
        sequence: 1,
      }),
    });
    expect(wrongCallback.status).toBe(409);

    for (let index = 0; index < 80; index += 1) {
      const view = (await (
        await isolatedApp.request("/api/v1/shared-app?fixture=invite_sign_in", {
          headers: withFixtureSession(fixtureSession),
        })
      ).json()) as { orchestration: { session: object | null } };
      if (view.orchestration.session === null) break;
      const advanced = await isolatedApp.request("/api/dev/shared-app/advance", {
        method: "POST",
        headers: withFixtureSession(fixtureSession),
      });
      expect(advanced.status).toBe(200);
    }

    const final = (await (
      await isolatedApp.request("/api/v1/shared-app?fixture=invite_sign_in", {
        headers: withFixtureSession(fixtureSession),
      })
    ).json()) as {
      orchestration: {
        session: object | null;
        projects: Array<{
          projectId: string;
          stage: string;
          finalAsset: { sha256: string; byteSize: number; downloadPath: string } | null;
        }>;
      };
    };
    expect(final.orchestration.session).toBeNull();
    const completed = final.orchestration.projects.filter(
      (project) => project.stage === "READY_FOR_REVIEW",
    );
    expect(completed).toHaveLength(3);
    for (const project of completed) {
      const download = await isolatedApp.request(
        `${project.finalAsset!.downloadPath}?fixture=invite_sign_in`,
        { headers: withFixtureSession(fixtureSession) },
      );
      expect(download.status).toBe(200);
      expect(download.headers.get("content-type")).toBe("video/mp4");
      expect(download.headers.get("x-videoforge-artifact-kind")).toBe("provider-free-final-mp4");
      const bytes = new Uint8Array(await download.arrayBuffer());
      expect(bytes.byteLength).toBe(project.finalAsset!.byteSize);
      expect(new TextDecoder().decode(bytes.slice(4, 12))).toContain("ftyp");
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const sha256 = `sha256:${[...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("")}`;
      expect(sha256).toBe(project.finalAsset!.sha256);
      expect(download.headers.get("x-videoforge-sha256")).toBe(sha256);
    }
  });
});

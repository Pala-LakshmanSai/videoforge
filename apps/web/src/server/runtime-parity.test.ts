// @vitest-environment node

import type { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { createApiApp } from "./app";
import { createCloudflareApiOptions, type CloudflareAssetFetcher } from "./runtime/cloudflare";
import { RuntimeBindingError } from "./runtime/configuration";
import { createNodeFixturePreviewBinding } from "./runtime/node-fixture-preview";

const COMMIT = "674c588";
const SESSION_ID = "runtime-parity.674c588";
const INITIAL_VERSION_TOKEN = '"vf-project_fixture_001-revision_fixture_001-v1"';
const REVIEW_CANDIDATE_SHA256 =
  "sha256:7777777777777777777777777777777777777777777777777777777777777777";
const VOICEOVER_DIGEST = "a".repeat(64);
const VOICEOVER_ASSET_ID = `fixture_voiceover_sha256_${VOICEOVER_DIGEST}`;

const SELECTED_RESPONSE_HEADERS = [
  "cache-control",
  "content-disposition",
  "content-type",
  "etag",
  "x-videoforge-artifact-kind",
  "x-videoforge-fixture-session",
  "x-videoforge-idempotent-replay",
  "x-videoforge-provider-mode",
  "x-videoforge-synthetic",
] as const;

type SelectedResponseHeader = (typeof SELECTED_RESPONSE_HEADERS)[number];

interface CapturedResponse {
  readonly status: number;
  readonly headers: Record<SelectedResponseHeader, string | null>;
  readonly body: unknown;
}

interface RuntimePair {
  readonly node: Hono;
  readonly cloudflare: Hono;
  readonly cloudflareAssetPaths: string[];
}

function sessionHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    ...extra,
    "x-videoforge-fixture-session": SESSION_ID,
  };
}

function mutationHeaders(idempotencyKey: string, ifMatch?: string): Record<string, string> {
  return sessionHeaders({
    "content-type": "application/json",
    "idempotency-key": idempotencyKey,
    ...(ifMatch === undefined ? {} : { "if-match": ifMatch }),
  });
}

function cloneRequestInit(init: RequestInit | undefined): RequestInit | undefined {
  if (!init) return undefined;
  return {
    ...init,
    headers: init.headers === undefined ? undefined : new Headers(init.headers),
  };
}

async function capture(response: Response): Promise<CapturedResponse> {
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();
  const body =
    contentType.includes("json") && text.length > 0 ? (JSON.parse(text) as unknown) : text;
  return {
    status: response.status,
    headers: Object.fromEntries(
      SELECTED_RESPONSE_HEADERS.map((name) => [name, response.headers.get(name)]),
    ) as Record<SelectedResponseHeader, string | null>,
    body,
  };
}

async function requestPair(
  pair: RuntimePair,
  path: string,
  expectedStatus: number,
  init?: RequestInit,
): Promise<CapturedResponse> {
  const [nodeResponse, cloudflareResponse] = await Promise.all([
    pair.node.request(path, cloneRequestInit(init)),
    pair.cloudflare.request(path, cloneRequestInit(init)),
  ]);
  const [node, cloudflare] = await Promise.all([
    capture(nodeResponse),
    capture(cloudflareResponse),
  ]);

  expect(node.status, `Node status for ${path}`).toBe(expectedStatus);
  expect(cloudflare.status, `Cloudflare status for ${path}`).toBe(expectedStatus);
  expect(cloudflare.headers, `selected headers for ${path}`).toStrictEqual(node.headers);
  expect(cloudflare.body, `exact body for ${path}`).toStrictEqual(node.body);
  return node;
}

function createRuntimePair(): RuntimePair {
  const nodePreview = createNodeFixturePreviewBinding();
  const cloudflareAssetPaths: string[] = [];
  const cloudflareAssets: CloudflareAssetFetcher = {
    async fetch(input, init) {
      const request =
        input instanceof Request
          ? input
          : new Request(input instanceof URL ? input.toString() : input, init);
      cloudflareAssetPaths.push(new URL(request.url).pathname);
      return new Response(await nodePreview.read(request), {
        status: 200,
        headers: { "content-type": "image/svg+xml; charset=utf-8" },
      });
    },
  };

  return {
    node: createApiApp({
      configuration: { commit: COMMIT, environment: "test", mode: "fixture" },
      bindings: { platform: "node", fixturePreview: nodePreview },
    }),
    cloudflare: createApiApp(
      createCloudflareApiOptions({
        VIDEOFORGE_COMMIT: COMMIT,
        VIDEOFORGE_ENVIRONMENT: "test",
        VIDEOFORGE_PROVIDER_MODE: "fixture",
        ASSETS: cloudflareAssets,
      }),
    ),
    cloudflareAssetPaths,
  };
}

function expectFixtureHeaders(response: CapturedResponse): void {
  expect(response.headers).toMatchObject({
    "cache-control": "no-store",
    "x-videoforge-fixture-session": SESSION_ID,
    "x-videoforge-provider-mode": "fixture",
    "x-videoforge-synthetic": "true",
  });
}

describe("Node and Cloudflare fixture runtime parity", () => {
  it("returns byte-equivalent JSON semantics for reads, access boundaries, and problems", async () => {
    const pair = createRuntimePair();

    const health = await requestPair(pair, "/api/health?fixture=project_create_ready", 200, {
      headers: sessionHeaders(),
    });
    expectFixtureHeaders(health);
    expect(health.body).toStrictEqual({
      app: "videoforge",
      status: "ok",
      mode: "fixture",
      commit: COMMIT,
      fixture_id: "project_create_ready",
      synthetic: true,
      provider_calls_authorized: false,
      authorized_spend_usd: 0,
    });

    const signedOutBootstrap = await requestPair(
      pair,
      "/api/v1/bootstrap?fixture=invite_sign_in",
      200,
      { headers: sessionHeaders() },
    );
    expectFixtureHeaders(signedOutBootstrap);
    expect(signedOutBootstrap.body).toMatchObject({
      scenario: "invite_sign_in",
      access: { state: "SIGN_IN_REQUIRED" },
      projects: [],
      avatars: [],
      styles: [],
    });

    const denied = await requestPair(pair, "/api/v1/projects?fixture=invite_access_denied", 403, {
      headers: sessionHeaders(),
    });
    expectFixtureHeaders(denied);
    expect(denied.body).toStrictEqual({
      error: {
        code: "WORKSPACE_ACCESS_REQUIRED",
        message: "Workspace access is required",
        detail:
          "This account is not invited to the selected workspace. Try another invited account.",
        retryable: false,
      },
      type: "https://videoforge.local/problems/workspace-access-required",
      title: "Workspace access is required",
      status: 403,
    });

    for (const [path, status] of [
      ["/api/v1/projects?fixture=happy_generating", 200],
      ["/api/v1/projects/project_fixture_001?fixture=happy_generating", 200],
      ["/api/v1/avatar-profiles?fixture=avatar_profile_ready", 200],
      ["/api/v1/image-styles?fixture=style_v2_analyzing_v1_active", 200],
    ] as const) {
      const response = await requestPair(pair, path, status, { headers: sessionHeaders() });
      expectFixtureHeaders(response);
    }

    const missingProject = await requestPair(
      pair,
      "/api/v1/projects/project_missing?fixture=happy_generating",
      404,
      { headers: sessionHeaders() },
    );
    expect(missingProject.body).toStrictEqual({
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

    const missingRoute = await requestPair(pair, "/api/v1/not-a-route", 404, {
      headers: sessionHeaders(),
    });
    expect(missingRoute.body).toStrictEqual({
      error: {
        code: "API_ROUTE_NOT_FOUND",
        message: "API route not found",
        detail: "The requested fixture API route does not exist.",
        retryable: false,
      },
      type: "https://videoforge.local/problems/api-route-not-found",
      title: "API route not found",
      status: 404,
    });
  });

  it("keeps upload validation, idempotency, review state, and preview assets identical", async () => {
    const pair = createRuntimePair();
    const registrationPath = "/api/v1/voiceovers/register?fixture=project_create_ready";
    const registration = {
      asset_id: VOICEOVER_ASSET_ID,
      checksum: `sha256:${VOICEOVER_DIGEST}`,
      filename: "runtime-parity.wav",
      duration_seconds: 42.5,
      sample_rate: 48_000,
      channels: 1,
    };

    const invalidRegistration = await requestPair(pair, registrationPath, 422, {
      method: "POST",
      headers: mutationHeaders("runtime-parity-invalid-upload"),
      body: JSON.stringify({ ...registration, checksum: `sha256:${"b".repeat(64)}` }),
    });
    expect(invalidRegistration.body).toStrictEqual({
      error: {
        code: "VOICEOVER_CHECKSUM_MISMATCH",
        message: "Voiceover handle does not match its checksum",
        detail: "The fixture asset_id SHA-256 suffix must exactly equal the checksum hex digest.",
        retryable: false,
      },
      type: "https://videoforge.local/problems/voiceover-checksum-mismatch",
      title: "Voiceover handle does not match its checksum",
      status: 422,
    });

    const registrationRequest = {
      method: "POST",
      headers: mutationHeaders("runtime-parity-register-upload"),
      body: JSON.stringify(registration),
    } satisfies RequestInit;
    const registered = await requestPair(pair, registrationPath, 201, registrationRequest);
    expect(registered.body).toStrictEqual({
      ok: true,
      voiceover: {
        assetId: VOICEOVER_ASSET_ID,
        checksum: `sha256:${VOICEOVER_DIGEST}`,
        filename: "runtime-parity.wav",
        durationSeconds: 42.5,
        sampleRate: 48_000,
        channels: 1,
        verificationState: "VERIFIED",
        persistedBytes: false,
        providerCallsAuthorized: false,
      },
      synthetic: true,
    });

    const registrationReplay = await requestPair(pair, registrationPath, 201, registrationRequest);
    expect(registrationReplay.headers["x-videoforge-idempotent-replay"]).toBe("true");
    expect(registrationReplay.body).toStrictEqual(registered.body);

    const registrationConflict = await requestPair(pair, registrationPath, 409, {
      ...registrationRequest,
      body: JSON.stringify({ ...registration, filename: "different.wav" }),
    });
    expect(registrationConflict.body).toStrictEqual({
      error: {
        code: "IDEMPOTENCY_KEY_REUSED",
        message: "Idempotency key was reused for a different request",
        detail:
          "Use the original request body to replay this operation or send a new Idempotency-Key.",
        retryable: false,
      },
      type: "https://videoforge.local/problems/idempotency-key-reused",
      title: "Idempotency key was reused for a different request",
      status: 409,
    });

    const voiceoverStatus = await requestPair(
      pair,
      `/api/v1/voiceovers/${VOICEOVER_ASSET_ID}?fixture=project_create_ready`,
      200,
      { headers: sessionHeaders() },
    );
    expect(voiceoverStatus.body).toStrictEqual(
      (registered.body as { voiceover: unknown }).voiceover,
    );

    const reviewPath =
      "/api/v1/projects/project_fixture_001/approve?fixture=project_ready_for_review";
    const prematureDownload = await requestPair(
      pair,
      "/api/v1/projects/project_fixture_001/download?fixture=project_ready_for_review",
      409,
      { headers: sessionHeaders() },
    );
    expect(prematureDownload.body).toMatchObject({
      error: { code: "PROJECT_DOWNLOAD_NOT_READY" },
    });

    const reviewDetail = await requestPair(
      pair,
      "/api/v1/projects/project_fixture_001?fixture=project_ready_for_review",
      200,
      { headers: sessionHeaders() },
    );
    expect(reviewDetail.headers.etag).toBe(INITIAL_VERSION_TOKEN);

    const approvalRequest = {
      method: "POST",
      headers: mutationHeaders("runtime-parity-final-approval", INITIAL_VERSION_TOKEN),
      body: JSON.stringify({
        project_id: "project_fixture_001",
        candidate_id: "review_candidate_fixture_001",
        candidate_sha256: REVIEW_CANDIDATE_SHA256,
      }),
    } satisfies RequestInit;
    const approved = await requestPair(pair, reviewPath, 200, approvalRequest);
    expect(approved.body).toStrictEqual({
      ok: true,
      id: "project_fixture_001",
      status: "APPROVED",
      candidateId: "review_candidate_fixture_001",
      candidateSha256: REVIEW_CANDIDATE_SHA256,
      downloadUrl: "/api/v1/projects/project_fixture_001/download?fixture=project_ready_for_review",
      versionToken: '"vf-project_fixture_001-revision_fixture_001-v2"',
    });
    expect(approved.headers.etag).toBe('"vf-project_fixture_001-revision_fixture_001-v2"');

    const approvalReplay = await requestPair(pair, reviewPath, 200, approvalRequest);
    expect(approvalReplay.headers["x-videoforge-idempotent-replay"]).toBe("true");
    expect(approvalReplay.body).toStrictEqual(approved.body);

    const approvedDetail = await requestPair(
      pair,
      "/api/v1/projects/project_fixture_001?fixture=project_ready_for_review",
      200,
      { headers: sessionHeaders() },
    );
    expect(approvedDetail.body).toMatchObject({
      project: {
        status: "APPROVED",
        allowedActions: ["REVIEW", "DOWNLOAD"],
        review: {
          state: "APPROVED",
          candidateId: "review_candidate_fixture_001",
          candidateSha256: REVIEW_CANDIDATE_SHA256,
        },
      },
    });

    const download = await requestPair(
      pair,
      "/api/v1/projects/project_fixture_001/download?fixture=project_ready_for_review",
      200,
      { headers: sessionHeaders() },
    );
    expect(download.headers).toMatchObject({
      "content-disposition": 'attachment; filename="videoforge-fixture-preview.svg"',
      "x-videoforge-artifact-kind": "synthetic-preview",
    });
    expect(download.headers["content-type"]).toContain("image/svg+xml");
    expect(download.body).toEqual(expect.stringContaining("<svg"));
    expect(pair.cloudflareAssetPaths).toStrictEqual(["/fixtures/media/watermelon-market.svg"]);
  });

  it("fails closed when Cloudflare assets or production-like durable bindings are absent", () => {
    expect(() =>
      createApiApp(
        createCloudflareApiOptions({
          VIDEOFORGE_COMMIT: COMMIT,
          VIDEOFORGE_ENVIRONMENT: "test",
          VIDEOFORGE_PROVIDER_MODE: "fixture",
        }),
      ),
    ).toThrow(
      new RuntimeBindingError("Fixture mode requires an explicit fixture preview binding."),
    );

    for (const mode of ["sandbox", "staging", "production"] as const) {
      expect(() =>
        createApiApp(
          createCloudflareApiOptions({
            VIDEOFORGE_COMMIT: COMMIT,
            VIDEOFORGE_ENVIRONMENT: "test",
            VIDEOFORGE_PROVIDER_MODE: mode,
          }),
        ),
      ).toThrow(
        new RuntimeBindingError(
          `${mode} mode requires durable bindings: auth, repositories, artifactStore, workflow.`,
        ),
      );
    }
  });
});

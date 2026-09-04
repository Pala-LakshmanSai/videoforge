import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => {
  const scopeRows: Record<string, unknown>[] = [
    {
      user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      account_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      workspace_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    },
  ];
  const projectRows: Record<string, unknown>[] = [
    {
      id: "11111111-1111-4111-8111-111111111111",
      title: "Private project",
      revision_id: "22222222-2222-4222-8222-222222222222",
      revision_state: "DRAFT",
    },
  ];
  const rateLimitRows = [{ allowed: true }];
  const archiveState: {
    rows: Record<string, unknown>[];
    error: unknown;
  } = { rows: [], error: null };
  const projectArchiveState: {
    rows: Record<string, unknown>[];
    error: unknown;
  } = { rows: [], error: null };
  const avatarDraftRows: Record<string, unknown>[] = [];
  const styleDraftRows: Record<string, unknown>[] = [];
  const publishedStyleRows: Record<string, unknown>[] = [];
  const query = vi.fn(async (sql: string, params?: readonly unknown[]) => {
    void params;
    if (sql.includes("videoforge_consume_hosted_rate_limit"))
      return { rows: rateLimitRows, affectedRows: 1 };
    if (sql.includes("videoforge_hosted_session_scope"))
      return { rows: scopeRows, affectedRows: 1 };
    if (sql.includes("videoforge_archive_hosted_preset")) {
      if (archiveState.error) throw archiveState.error;
      return { rows: archiveState.rows, affectedRows: archiveState.rows.length };
    }
    if (sql.includes("videoforge_archive_hosted_project")) {
      if (projectArchiveState.error) throw projectArchiveState.error;
      return { rows: projectArchiveState.rows, affectedRows: projectArchiveState.rows.length };
    }
    if (
      sql.includes("version.state NOT IN ('READY','ABANDONED')") ||
      sql.includes("version.state NOT IN ('PUBLISHED','ABANDONED')")
    ) {
      if (sql.includes("FROM avatar_profiles AS profile"))
        return { rows: avatarDraftRows, affectedRows: avatarDraftRows.length };
      if (sql.includes("FROM image_styles AS style"))
        return { rows: styleDraftRows, affectedRows: styleDraftRows.length };
    }
    if (sql.includes("version.state = 'PUBLISHED'") && sql.includes("FROM image_styles AS style"))
      return { rows: publishedStyleRows, affectedRows: publishedStyleRows.length };
    if (sql.includes("FROM projects AS project")) return { rows: projectRows, affectedRows: 1 };
    return { rows: [], affectedRows: 0 };
  });
  const pool = { query, end: vi.fn() };
  const transaction = vi.fn(async (work: (executor: unknown) => Promise<unknown>) =>
    work({ execute: vi.fn(), query }),
  );
  const executor = { execute: vi.fn(), query, transaction };
  return {
    scopeRows,
    projectRows,
    rateLimitRows,
    archiveState,
    projectArchiveState,
    avatarDraftRows,
    styleDraftRows,
    publishedStyleRows,
    query,
    pool,
    executor,
  };
});

vi.mock("./auth", () => ({
  createHostedAuth: vi.fn(() => ({
    api: {
      getSession: vi.fn(async () => ({
        user: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
        session: { token: "fixture-session-token" },
      })),
    },
  })),
}));

vi.mock("./neon", () => ({
  createNeonPool: vi.fn(() => testState.pool),
  createNeonExecutor: vi.fn(() => testState.executor),
}));

import type { HostedRuntimeConfiguration, HostedRuntimeEnvironment } from "./configuration";
import {
  handleHostedProductRequest,
  hostedAvatarConflictProblem,
  hostedGpuProductState,
  hostedProjectConflictProblem,
  hostedPromptWritingState,
  hostedStyleConflictProblem,
} from "./product";
import { handleHostedPromptRequest } from "./hosted-prompt-route";

const ORIGIN = "https://hosted.example.test";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const PRESET_ID = "44444444-4444-4444-8444-444444444444";

const config = {
  publicOrigin: ORIGIN,
  neon: { databaseUrl: "postgresql://fixture" },
  mediaWorkerRelease: { whisperModelSha256: `sha256:${"b".repeat(64)}` },
} as HostedRuntimeConfiguration;
const stagingConfig = {
  ...config,
  environment: "staging",
  gpuTransport: "DISABLED_UNQUALIFIED",
} as HostedRuntimeConfiguration;
const environment = {} as HostedRuntimeEnvironment;
const executionContext = { waitUntil: vi.fn() };

describe("hosted project title conflicts", () => {
  it("maps only the active-project title constraint to a user-facing conflict", () => {
    expect(hostedProjectConflictProblem("projects_active_name_uq", "helen")).toEqual({
      code: "PROJECT_TITLE_CONFLICT",
      message:
        "Another active project is still named “helen”. Open Progress to continue that project or delete it, or choose a different title.",
    });
    expect(
      hostedProjectConflictProblem("hosted_project_create_requests_idempotency_key_key", "helen"),
    ).toBeNull();
    expect(hostedProjectConflictProblem(null, "helen")).toBeNull();
  });
});

function request(
  path: string,
  method: "GET" | "POST" | "DELETE" = "POST",
  body: unknown = {},
  sameOrigin = true,
  headers: Record<string, string> = {},
): Request {
  const requestHeaders = new Headers({
    origin: sameOrigin ? ORIGIN : "https://attacker.example.test",
    ...headers,
  });
  if (method === "POST") requestHeaders.set("content-type", "application/json");
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: requestHeaders,
    body: method === "GET" ? undefined : JSON.stringify(body),
  });
}

async function errorCode(result: Response | null): Promise<string | null> {
  if (!result) return null;
  const value = (await result.json()) as { error?: { code?: string } };
  return value.error?.code ?? null;
}

describe("hosted product route contract", () => {
  it("keeps the prompt endpoint out of the broad product route", async () => {
    const promptRequest = request(`/api/v2/hosted/projects/${PROJECT_ID}/prompts`);
    expect(
      await handleHostedProductRequest(promptRequest, environment, config, executionContext),
    ).toBeNull();
    expect(
      await errorCode(await handleHostedPromptRequest(promptRequest, config, executionContext)),
    ).toBe("HOSTED_PROMPT_PROVIDER_UNAVAILABLE");

    const appSource = readFileSync(resolve(process.cwd(), "src/server/hosted/app.ts"), "utf8");
    expect(appSource.indexOf('import("./hosted-prompt-route")')).toBeLessThan(
      appSource.indexOf('import("./product")'),
    );
  });

  it("maps avatar uniqueness conflicts to safe Hub recovery", () => {
    expect(hostedAvatarConflictProblem("avatar_profiles_active_name_uq")).toEqual({
      code: "AVATAR_NAME_CONFLICT",
      message: "That avatar name is already in use. Open Avatar Hub to continue or remove it.",
    });
    expect(hostedAvatarConflictProblem("avatar_profile_versions_open_draft_uq")).toMatchObject({
      code: "AVATAR_VERSION_CONFLICT",
    });
    expect(hostedAvatarConflictProblem(null)).toMatchObject({ code: "AVATAR_SAVE_CONFLICT" });
  });

  it("maps style uniqueness conflicts to safe user-facing recovery", () => {
    expect(hostedStyleConflictProblem("image_styles_active_name_uq")).toEqual({
      code: "STYLE_NAME_CONFLICT",
      message: "That style name is already in use. Open Image Styles to continue or remove it.",
    });
    expect(hostedStyleConflictProblem("image_style_versions_open_draft_uq")).toMatchObject({
      code: "STYLE_VERSION_CONFLICT",
    });
    expect(hostedStyleConflictProblem(null)).toMatchObject({ code: "STYLE_SAVE_CONFLICT" });
  });
  it("loads the preset catalog with separate unfinished-preset projections", async () => {
    testState.query.mockClear();

    const result = await handleHostedProductRequest(
      request("/api/v2/hosted/project-catalog", "GET"),
      environment,
      stagingConfig,
      executionContext,
    );

    expect(result?.status).toBe(200);
    expect(testState.query.mock.calls.some(([sql]) => String(sql).includes("image_styles"))).toBe(
      true,
    );
    expect(
      testState.query.mock.calls.some(([sql]) =>
        String(sql).includes("hosted_style_analysis_runs"),
      ),
    ).toBe(false);
  });

  it("creates a fresh bounded ASR submission after an explicit failed attempt", async () => {
    const previousProject = testState.projectRows[0];
    testState.projectRows[0] = {
      revision_id: "22222222-2222-4222-8222-222222222222",
      voiceover_asset_id: "33333333-3333-4333-8333-333333333333",
      checksum_sha256: `sha256:${"a".repeat(64)}`,
      content_type: "audio/mpeg",
      duration_ms: 159_216,
      receipt_id: "44444444-4444-4444-8444-444444444444",
      asr_attempt_count: 1,
      latest_asr_state: "FAILED",
    };
    try {
      const result = await handleHostedProductRequest(
        request(`/api/v2/hosted/projects/${PROJECT_ID}/asr`),
        environment,
        stagingConfig,
        executionContext,
      );
      expect(result?.status).toBe(202);
      const body = (await result?.json()) as {
        cpu_submission: { idempotency_key: string };
      };
      expect(body.cpu_submission.idempotency_key).toBe(`project-${PROJECT_ID}-asr-v2`);
    } finally {
      testState.projectRows[0] = previousProject!;
    }
  });

  it("returns the saved Gemini profile and real reference count for a published style", async () => {
    testState.publishedStyleRows.splice(0, testState.publishedStyleRows.length, {
      style_id: "11111111-1111-4111-8111-111111111111",
      version_id: "22222222-2222-4222-8222-222222222222",
      name: "Retail documentary",
      version_number: "1",
      state: "PUBLISHED",
      status: "ACTIVE",
      scope_kind: "WORKSPACE",
      style_profile_hash: "sha256:hidden",
      reference_count: "4",
      reference_orders: [1, 2, 3, 4],
      profile_payload: {
        schema_version: "image-style-profile/v1",
        summary: "Naturalistic retail photography.",
        visual_profile: { medium_family: "commercial photography" },
      },
    });

    const result = await handleHostedProductRequest(
      request("/api/v2/hosted/project-catalog", "GET"),
      environment,
      stagingConfig,
      executionContext,
    );

    expect(result?.status).toBe(200);
    await expect(result?.json()).resolves.toMatchObject({
      styles: [
        {
          name: "Retail documentary",
          reference_count: 4,
          cover_url: "/api/v2/hosted/styles/22222222-2222-4222-8222-222222222222/preview",
          reference_urls: [
            "/api/v2/hosted/styles/22222222-2222-4222-8222-222222222222/preview?reference=1",
            "/api/v2/hosted/styles/22222222-2222-4222-8222-222222222222/preview?reference=2",
            "/api/v2/hosted/styles/22222222-2222-4222-8222-222222222222/preview?reference=3",
            "/api/v2/hosted/styles/22222222-2222-4222-8222-222222222222/preview?reference=4",
          ],
          profile: {
            summary: "Naturalistic retail photography.",
            visual_profile: { medium_family: "commercial photography" },
          },
        },
      ],
    });
    const publishedSql = testState.query.mock.calls
      .map(([sql]) => String(sql))
      .find((sql) => sql.includes("version.state = 'PUBLISHED'"));
    expect(publishedSql).toContain("image_style_references");
    expect(publishedSql).toContain("reference.deleted_at IS NULL");
    testState.publishedStyleRows.length = 0;
  });

  it("returns active tenant drafts separately so they can be resumed without becoming project presets", async () => {
    testState.query.mockClear();
    testState.avatarDraftRows.splice(0, testState.avatarDraftRows.length, {
      profile_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      version_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      name: "Private presenter",
      version_number: "1",
      state: "NEEDS_REVIEW",
      created_at: "2026-08-30T10:00:00.000Z",
      updated_at: "2026-08-30T10:01:00.000Z",
      rights_attested: true,
      likeness_animation_consent: true,
      source_verified: true,
    });
    testState.styleDraftRows.splice(0, testState.styleDraftRows.length, {
      style_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      version_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      name: "Private documentary",
      version_number: "1",
      state: "NEEDS_REVIEW",
      reference_count: "7",
      rights_attested: true,
      processing_disclosure_acknowledged: true,
      original_retention_policy: "RETAIN",
      references_verified: true,
      created_at: "2026-08-30T10:00:00.000Z",
      updated_at: "2026-08-30T10:01:00.000Z",
      profile_payload: { summary: "Natural light and restrained texture." },
    });

    const result = await handleHostedProductRequest(
      request("/api/v2/hosted/project-catalog", "GET"),
      environment,
      stagingConfig,
      executionContext,
    );

    expect(result?.status).toBe(200);
    await expect(result?.json()).resolves.toMatchObject({
      avatars: [],
      styles: [],
      avatar_drafts: [
        expect.objectContaining({
          profile_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          version_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          state: "NEEDS_REVIEW",
          rights_attested: true,
          likeness_animation_consent: true,
          source_verified: true,
        }),
      ],
      style_drafts: [
        expect.objectContaining({
          style_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          version_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          state: "NEEDS_REVIEW",
          reference_count: 7,
          rights_attested: true,
          processing_disclosure_acknowledged: true,
          original_retention_policy: "RETAIN",
          references_verified: true,
          summary: "Natural light and restrained texture.",
          profile: { summary: "Natural light and restrained texture." },
        }),
      ],
    });
    const draftSql = testState.query.mock.calls
      .map(([sql]) => String(sql))
      .filter((sql) => sql.includes("version.state NOT IN"));
    expect(draftSql).toHaveLength(2);
    for (const sql of draftSql) {
      expect(sql).toMatch(/account_id = \$1/u);
      expect(sql).toMatch(/workspace_id = \$2/u);
      expect(sql).toContain("scope_kind = 'WORKSPACE'");
      expect(sql).toContain("status = 'ACTIVE'");
    }

    testState.avatarDraftRows.length = 0;
    testState.styleDraftRows.length = 0;
  });

  it("resolves an avatar preview without requiring private avatar-link table access", async () => {
    testState.query.mockClear();
    const previewEnvironment = {
      PRIVATE_ARTIFACTS: { get: vi.fn() },
    } as unknown as HostedRuntimeEnvironment;

    const result = await handleHostedProductRequest(
      request(`/api/v2/hosted/avatars/${PRESET_ID}/preview`, "GET"),
      previewEnvironment,
      stagingConfig,
      executionContext,
    );

    expect(result?.status).toBe(404);
    expect(
      testState.query.mock.calls.some(([sql]) => String(sql).includes("avatar_profile_assets")),
    ).toBe(false);
  });

  it("selects an exact published style reference for carousel previews", async () => {
    testState.query.mockClear();
    const previewEnvironment = {
      PRIVATE_ARTIFACTS: { get: vi.fn() },
    } as unknown as HostedRuntimeEnvironment;

    const result = await handleHostedProductRequest(
      request(`/api/v2/hosted/styles/${PRESET_ID}/preview?reference=2`, "GET"),
      previewEnvironment,
      stagingConfig,
      executionContext,
    );

    expect(result?.status).toBe(404);
    const stylePreviewCall = testState.query.mock.calls.find(([sql]) =>
      String(sql).includes("reference.reference_order = $4"),
    );
    expect(stylePreviewCall?.[1]).toEqual([
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      PRESET_ID,
      2,
    ]);
  });

  it("reports qualified work as dispatch-ready without inventing a GPU estimate", () => {
    expect(hostedGpuProductState({ dispatch_available: true })).toStrictEqual({
      projectedUsd: null,
      pendingState: "READY_FOR_GPU_DISPATCH",
      estimateDetail:
        "GPU projection is unavailable until exact lane work is materialized. The selected cap is the hard maximum.",
    });
    expect(hostedGpuProductState({ dispatch_available: false })).toMatchObject({
      projectedUsd: 0,
      pendingState: "WAITING_FOR_GPU_QUALIFICATION",
    });
  });

  it.each([
    "/api/v2/hosted/avatars",
    `/api/v2/hosted/avatars/${PRESET_ID}/commit`,
    `/api/v2/hosted/avatars/${PRESET_ID}/approve`,
    "/api/v2/hosted/styles",
    `/api/v2/hosted/styles/${PRESET_ID}/references/retry`,
    `/api/v2/hosted/styles/${PRESET_ID}/commit`,
    `/api/v2/hosted/styles/${PRESET_ID}/analyze`,
    `/api/v2/hosted/styles/${PRESET_ID}/publish`,
    `/api/v2/hosted/projects/${PROJECT_ID}/retry`,
  ])("recognizes the exact write route before unavailable bindings: %s", async (path) => {
    const result = await handleHostedProductRequest(
      request(path, "POST", {}, false),
      environment,
      config,
      executionContext,
    );
    expect(result?.status).toBe(403);
    await expect(errorCode(result)).resolves.toBe("HOSTED_BROWSER_ORIGIN_REJECTED");
  });

  it.each([
    "/api/v2/hosted/avatars",
    `/api/v2/hosted/avatars/${PRESET_ID}/commit`,
    `/api/v2/hosted/avatars/${PRESET_ID}/approve`,
    "/api/v2/hosted/styles",
    `/api/v2/hosted/styles/${PRESET_ID}/references/retry`,
    `/api/v2/hosted/styles/${PRESET_ID}/commit`,
    `/api/v2/hosted/styles/${PRESET_ID}/analyze`,
    `/api/v2/hosted/styles/${PRESET_ID}/publish`,
    `/api/v2/hosted/projects/${PROJECT_ID}/retry`,
  ])(
    "fails closed for an unqualified write capability before database access: %s",
    async (path) => {
      testState.query.mockClear();
      const result = await handleHostedProductRequest(
        request(path, "POST", { unexpected: true }),
        environment,
        config,
        executionContext,
      );
      expect(result?.status).toBe(409);
      await expect(errorCode(result)).resolves.toBe(
        path.includes("/projects/")
          ? "TARGETED_RETRY_NOT_QUALIFIED"
          : "PRESET_CREATION_NOT_QUALIFIED",
      );
      expect(testState.query).not.toHaveBeenCalled();
    },
  );

  it("recognizes hosted avatar and style archive routes before database access", async () => {
    for (const path of [
      `/api/v2/hosted/avatars/${PRESET_ID}`,
      `/api/v2/hosted/styles/${PRESET_ID}`,
    ]) {
      testState.query.mockClear();
      const result = await handleHostedProductRequest(
        request(path, "DELETE", {}, false),
        environment,
        config,
        executionContext,
      );
      expect(result?.status).toBe(403);
      await expect(errorCode(result)).resolves.toBe("HOSTED_BROWSER_ORIGIN_REJECTED");
      expect(testState.query).not.toHaveBeenCalled();
    }
  });

  it("archives a tenant preset through the exact function and reports retained history", async () => {
    testState.query.mockClear();
    testState.archiveState.rows.splice(0, testState.archiveState.rows.length, {
      preset_kind: "AVATAR",
      preset_id: PRESET_ID,
      version_id: "55555555-5555-4555-8555-555555555555",
      state: "ARCHIVED",
      referenced_revision_count: "2",
    });
    testState.archiveState.error = null;

    const result = await handleHostedProductRequest(
      request(`/api/v2/hosted/avatars/${PRESET_ID}`, "DELETE"),
      environment,
      config,
      executionContext,
    );

    expect(result?.status).toBe(200);
    await expect(result?.json()).resolves.toMatchObject({
      preset_kind: "avatar",
      preset_id: PRESET_ID,
      state: "ARCHIVED",
      in_use: true,
      referenced_revision_count: 2,
      media_retention: "PRESERVED",
      provider_calls_authorized: false,
    });
    expect(
      testState.query.mock.calls.some(([sql]) =>
        String(sql).includes("videoforge_archive_hosted_preset"),
      ),
    ).toBe(true);
    expect(
      testState.query.mock.calls.some(([sql]) => /UPDATE\s+avatar_profiles/iu.test(String(sql))),
    ).toBe(false);
    testState.archiveState.rows.length = 0;
  });

  it("archives a tenant project through the exact function and preserves its lineage", async () => {
    testState.query.mockClear();
    testState.projectArchiveState.rows.splice(0, testState.projectArchiveState.rows.length, {
      project_id: PROJECT_ID,
      state: "ARCHIVED",
      retained_attempt_count: "2",
    });
    testState.projectArchiveState.error = null;

    const result = await handleHostedProductRequest(
      request(`/api/v2/hosted/projects/${PROJECT_ID}`, "DELETE"),
      environment,
      config,
      executionContext,
    );

    expect(result?.status).toBe(200);
    await expect(result?.json()).resolves.toMatchObject({
      project_id: PROJECT_ID,
      state: "ARCHIVED",
      retained_attempt_count: 2,
      lineage_retention: "PRESERVED",
      provider_calls_authorized: false,
    });
    expect(
      testState.query.mock.calls.some(([sql]) =>
        String(sql).includes("videoforge_archive_hosted_project"),
      ),
    ).toBe(true);
    expect(
      testState.query.mock.calls.some(([sql]) => /UPDATE\s+projects/iu.test(String(sql))),
    ).toBe(false);
    testState.projectArchiveState.rows.length = 0;
  });

  it("refuses project deletion while project work is still active", async () => {
    testState.projectArchiveState.rows.length = 0;
    testState.projectArchiveState.error = { code: "55000" };
    const result = await handleHostedProductRequest(
      request(`/api/v2/hosted/projects/${PROJECT_ID}`, "DELETE"),
      environment,
      config,
      executionContext,
    );
    expect(result?.status).toBe(409);
    await expect(errorCode(result)).resolves.toBe("PROJECT_HAS_ACTIVE_WORK");
    testState.projectArchiveState.error = null;
  });

  it("returns a kind-specific not-found when the archive capability resolves no row", async () => {
    testState.archiveState.rows.length = 0;
    testState.archiveState.error = null;
    const result = await handleHostedProductRequest(
      request(`/api/v2/hosted/styles/${PRESET_ID}`, "DELETE"),
      environment,
      config,
      executionContext,
    );
    expect(result?.status).toBe(404);
    await expect(errorCode(result)).resolves.toBe("STYLE_NOT_FOUND");
  });

  it("maps the immutable built-in archive error to a safe conflict", async () => {
    testState.archiveState.rows.length = 0;
    testState.archiveState.error = { code: "55000" };
    const result = await handleHostedProductRequest(
      request(`/api/v2/hosted/avatars/${PRESET_ID}`, "DELETE"),
      environment,
      config,
      executionContext,
    );
    expect(result?.status).toBe(409);
    await expect(errorCode(result)).resolves.toBe("PRESET_IMMUTABLE");
    testState.archiveState.error = null;
  });

  it("opens preset mutations in staging while keeping provider and GPU transport disabled", async () => {
    testState.query.mockClear();
    const result = await handleHostedProductRequest(
      request("/api/v2/hosted/styles", "POST", { unexpected: true }, true, {
        "idempotency-key": "hosted-style-create-0001",
      }),
      environment,
      stagingConfig,
      executionContext,
    );
    expect(result?.status).toBe(400);
    await expect(errorCode(result)).resolves.toBe("STYLE_CREATE_REJECTED");
    expect(testState.query).not.toHaveBeenCalled();
  });

  it("fails closed at the tenant admission seam", async () => {
    testState.scopeRows.length = 0;
    const result = await handleHostedProductRequest(
      request(`/api/v2/hosted/projects/${PROJECT_ID}/manifest`, "GET"),
      environment,
      config,
      executionContext,
    );
    expect(result?.status).toBe(403);
    await expect(errorCode(result)).resolves.toBe("INVITE_ADMISSION_REQUIRED");
    testState.scopeRows.push({
      user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      account_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      workspace_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    });
  });

  it("fails closed before tenant data access when the hosted rate limit is exhausted", async () => {
    testState.query.mockClear();
    testState.rateLimitRows[0]!.allowed = false;
    const candidate = request(`/api/v2/hosted/projects/${PROJECT_ID}/review`, "POST", {
      attempt_id: "22222222-2222-4222-8222-222222222222",
    });
    const result = await handleHostedProductRequest(
      candidate,
      environment,
      config,
      executionContext,
    );
    expect(result?.status).toBe(429);
    expect(result?.headers.get("retry-after")).toBe("60");
    await expect(errorCode(result)).resolves.toBe("HOSTED_RATE_LIMITED");
    expect(
      testState.query.mock.calls.some(([sql]) =>
        String(sql).includes("videoforge_hosted_session_scope"),
      ),
    ).toBe(false);
    expect(candidate.bodyUsed).toBe(false);
    testState.rateLimitRows[0]!.allowed = true;
  });

  it("rejects an oversized hosted JSON body before parsing it", async () => {
    const candidate = request("/api/v2/hosted/projects/preflight", "POST", {}, true, {
      "content-length": "524289",
    });
    const result = await handleHostedProductRequest(
      candidate,
      environment,
      config,
      executionContext,
    );
    expect(result?.status).toBe(400);
    await expect(errorCode(result)).resolves.toBe("PROJECT_PREFLIGHT_REJECTED");
    expect(candidate.bodyUsed).toBe(false);
  });

  it("accepts MP3 voiceover metadata in hosted project preflight", async () => {
    const result = await handleHostedProductRequest(
      request("/api/v2/hosted/projects/preflight", "POST", {
        schema_version: "videoforge-hosted-project-preflight/v1",
        title: "MP3 project",
        avatar_profile_version_id: "22222222-2222-4222-8222-222222222222",
        image_style_version_id: "33333333-3333-4333-8333-333333333333",
        voiceover: {
          filename: "voiceover.mp3",
          content_type: "audio/mpeg",
          content_length: 320_000,
          checksum_sha256: `sha256:${"a".repeat(64)}`,
          duration_ms: 20_000,
        },
      }),
      environment,
      stagingConfig,
      executionContext,
    );
    expect(result?.status).toBe(200);
    await expect(result?.json()).resolves.toMatchObject({
      schema_version: "videoforge-hosted-project-preflight/v1",
      estimate: { duration_ms: 20_000, voiceover_bytes: 320_000 },
    });
  });

  it("accepts the exact bounded Stage 1-5 spend cap in hosted project preflight", async () => {
    const result = await handleHostedProductRequest(
      request("/api/v2/hosted/projects/preflight", "POST", {
        schema_version: "videoforge-hosted-project-preflight/v1",
        title: "Five-stage capped project",
        avatar_profile_version_id: "22222222-2222-4222-8222-222222222222",
        image_style_version_id: "33333333-3333-4333-8333-333333333333",
        spend_cap_usd: 0.05,
        voiceover: {
          filename: "voiceover.mp3",
          content_type: "audio/mpeg",
          content_length: 320_000,
          checksum_sha256: `sha256:${"a".repeat(64)}`,
          duration_ms: 20_000,
        },
      }),
      environment,
      stagingConfig,
      executionContext,
    );
    expect(result?.status).toBe(200);
  });

  it("keeps provenance manifest unavailable until an approved render exists", async () => {
    const result = await handleHostedProductRequest(
      request(`/api/v2/hosted/projects/${PROJECT_ID}/manifest`, "GET"),
      environment,
      config,
      executionContext,
    );
    expect(result?.status).toBe(409);
    await expect(errorCode(result)).resolves.toBe("PROJECT_APPROVAL_REQUIRED");
  });

  it("preserves SYSTEM preset materialization and global queue contract in source", () => {
    const source = readFileSync(resolve(process.cwd(), "src/server/hosted/product.ts"), "utf8");
    expect(source).toContain("await materializeSystemAvatar(transaction, scope, avatarSource)");
    expect(source).toContain("videoforge_read_system_avatar_version_assets($1)");
    expect(source).toContain("await materializeSystemStyle(transaction, scope, styleSource)");
    const createStart = source.indexOf("async function createProject(");
    const createEnd = source.indexOf("async function commitProject(", createStart);
    expect(source.slice(createStart, createEnd)).toContain("resolveProjectPresets(");

    const queueStart = source.indexOf("const queue = await transaction.query(");
    const queueEnd = source.indexOf("const runtime = await transaction.query(", queueStart);
    const queueSql = source.slice(queueStart, queueEnd);
    expect(queueSql).not.toContain("ahead.account_id");
    expect(queueSql).not.toContain("ahead.workspace_id");
    expect(queueSql).not.toContain("total.account_id");
    expect(queueSql).not.toContain("total.workspace_id");
    expect(queueSql).toContain("ahead.queue_order < request.queue_order");
  });

  it("consumes a retryable attempt exactly once before reopening its request", () => {
    const source = readFileSync(resolve(process.cwd(), "src/server/hosted/product.ts"), "utf8");
    const retryStart = source.indexOf("async function retryProjectAttempt(");
    const retryEnd = source.indexOf("async function projectManifest(", retryStart);
    const retry = source.slice(retryStart, retryEnd);
    expect(retry).toContain("SET state = 'PERMANENT_FAILED'");
    expect(retry).toContain("state = 'RETRYABLE_FAILED' AND version = $4");
    expect(retry).toContain("request.state = 'FAILED'");
    expect(retry).toContain("task.state = 'FAILED'");
    expect(retry).not.toContain("request.state IN ('FAILED','RETRY_WAIT')");
    expect(retry).not.toContain("task.state IN ('FAILED','RETRY_WAIT')");
  });

  it("preserves the exact PostgreSQL ASR terminal timestamp for canonical lineage", () => {
    const source = readFileSync(resolve(process.cwd(), "src/server/hosted/product.ts"), "utf8");
    const planningStart = source.indexOf("async function renderHandoff(");
    const planningEnd = source.indexOf("async function projects(", planningStart);
    const planning = source.slice(planningStart, planningEnd);
    expect(planning).toContain("asr.terminal_at::text AS asr_terminal_at");
    expect(planning).not.toContain("asr.terminal_at AS asr_terminal_at");
  });

  it("does not report image prompts complete merely because a timeline exists", () => {
    expect(hostedPromptWritingState(null, true)).toEqual({
      status: "WAITING",
      progressPercent: 0,
      detail:
        "The scene plan is ready, but no durable accepted image prompts have been written yet.",
    });
    expect(hostedPromptWritingState("COMPLETE", true)).toEqual({
      status: "COMPLETE",
      progressPercent: 100,
      detail: "Durable accepted scene prompts are ready for image generation.",
    });
    const source = readFileSync(resolve(process.cwd(), "src/server/hosted/product.ts"), "utf8");
    const start = source.indexOf('id: "prompt-writing"');
    const end = source.indexOf('id: "image-generation"', start);
    const promptStage = source.slice(start, end);
    expect(promptStage).toContain("status: promptStage.status");
    expect(promptStage).toContain("progress_percent: promptStage.progressPercent");
    expect(promptStage).not.toContain('detail.generation ? "COMPLETE"');
    expect(source).toContain("task.task_key LIKE 'prompt:scene-batch:%'");
    expect(source).toContain("no durable accepted image prompts have been written yet");
  });

  it("claims and bounds whole-voiceover context before planning or provider dispatch", () => {
    const source = readFileSync(resolve(process.cwd(), "src/server/hosted/product.ts"), "utf8");
    const start = source.indexOf("async function createVoiceoverContext(");
    const end = source.indexOf("async function renderHandoff(", start);
    const block = source.slice(start, end);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(block).toContain("maximum_context_spend_micro_usd");
    expect(block).toContain("HOSTED_CONTEXT_RESERVATION_MICRO_USD");
    expect(block.indexOf("videoforge_prepare_hosted_voiceover_context")).toBeLessThan(
      block.indexOf("extractHostedVoiceoverContext"),
    );
    expect(block).toContain("output_asset_id: crypto.randomUUID()");
    expect(block).toContain('definiteProviderRejection ? "FAILED" : "UNKNOWN"');
    expect(block).toContain("!definiteProviderRejection");
    expect(block).toContain("providerTaskUuid = preparedRequest.request.taskUUID");
    expect(block).toContain("provider_task_uuid: providerTaskUuid");
    const planning = source.slice(
      source.indexOf("async function renderHandoff("),
      source.indexOf("async function projects("),
    );
    expect(planning).toContain('state.context_state !== "SUCCEEDED"');
    expect(source).toContain("/context$/u.exec(url.pathname)");
  });

  it("passes the preparation-owned adaptive plan binding before hosted prompt dispatch", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/server/hosted/hosted-prompt-route.ts"),
      "utf8",
    );
    const start = source.indexOf("async function writeProjectPrompts(");
    const end = source.indexOf("export async function handleHostedPromptRequest(", start);
    const block = source.slice(start, end);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(block).toContain("const preparedBatchCount = prepared.planned_batch_count");
    expect(block).toContain("const preparedSceneCount = prepared.planned_scene_count");
    expect(block).toContain("const preparedBatchPlanHash = prepared.batch_plan_hash");
    expect(block).toContain("preparedBatchCount !== batchPlan.batchCount");
    expect(block).toContain("preparedSceneCount !== batchPlan.totalScenes");
    expect(block).toContain("preparedBatchPlanHash !== batchPlanHash");
    expect(block).toContain("const persistedBatchPlanBinding");
    expect(block).toContain("persistedBatchPlanBinding,");
    expect(
      block.indexOf("preparedBatchPlanHash !== batchPlanHash") <
        block.indexOf("const accepted = await runHostedPromptExecution"),
    ).toBe(true);
  });

  it("reconciles UNKNOWN context only through the original provider task identity", () => {
    const source = readFileSync(resolve(process.cwd(), "src/server/hosted/product.ts"), "utf8");
    const start = source.indexOf("async function reconcileVoiceoverContext(");
    const end = source.indexOf("async function renderHandoff(", start);
    const block = source.slice(start, end);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(block).toContain('state.context_state !== "UNKNOWN"');
    expect(block).toContain("prepareHostedVoiceoverContextRequest");
    expect(block).toContain("preparedRequest.requestHash !== state.request_hash");
    expect(block).toContain("reconcileHostedVoiceoverContext");
    expect(block).not.toContain("extractHostedVoiceoverContext");
    expect(block).toContain("videoforge_reconcile_unknown_hosted_voiceover_context");
    expect(block).toContain("No new inference request was submitted.");
    expect(block).toContain("RUNWARE_TASK_NOT_FOUND");
    expect(block).toContain("RUNWARE_TASK_DETAILS_UNAVAILABLE");
    expect(block).toContain("RUNWARE_IDEMPOTENCY_CONFLICT");
    expect(block).toContain("RUNWARE_AUTH_INVALID");
    expect(block).toContain("VOICEOVER_CONTEXT_JSON_INVALID");
    expect(block).toContain("VOICEOVER_CONTEXT_JSON_DUPLICATE_PROPERTY");
    expect(block).toContain("VOICEOVER_CONTEXT_INVALID");
    expect(block).not.toContain("JOIN attempts AS execution_attempt");
    expect(block).toContain("const outputAssetId = crypto.randomUUID()");
    expect(source).toContain("/reconcile-context$/u.exec(");
  });

  it("reconciles abandoned context and prompt claims before reporting project progress", () => {
    const source = readFileSync(resolve(process.cwd(), "src/server/hosted/product.ts"), "utf8");
    const start = source.indexOf("async function projectDetail(");
    const end = source.indexOf("async function projectManifest(", start);
    const block = source.slice(start, end);
    expect(block).toContain("videoforge_reconcile_stale_hosted_prompt_dispatches");
    expect(block.indexOf("videoforge_reconcile_stale_hosted_prompt_dispatches")).toBeLessThan(
      block.indexOf("FROM hosted_voiceover_contexts AS context"),
    );
    expect(block).toContain("HOSTED_CONTEXT_DISPATCH_TIMEOUT");
    expect(block).toContain("VOICEOVER_CONTEXT_NETWORK_UNCERTAIN");
    expect(block).toContain("Runware could not be reached");
    expect(block).toContain('contextState === "UNKNOWN"');
    expect(block).toContain('? "FAILED"');
  });

  it("keeps project progress, prompt rows, and batch progress on one latest revision", () => {
    const source = readFileSync(resolve(process.cwd(), "src/server/hosted/product.ts"), "utf8");
    const start = source.indexOf("async function projectDetail(");
    const end = source.indexOf("async function projectManifest(", start);
    const block = source.slice(start, end);
    expect(block).toContain("ORDER BY revision.revision_number DESC");
    expect(block).toContain("const currentRevisionId =");
    expect(block).toContain("const currentTimelineId =");
    expect(block).toContain("AND context.project_revision_id=$4");
    expect(block).toContain("AND revision.id = $4");
    expect(block).toContain("AND plan.id = head.current_timeline_plan_id");
    expect(block).toContain("AND execution.project_revision_id=$4");
    expect(block).toContain("AND execution.timeline_plan_id=$5");
    expect(block).toContain("AND run.project_revision_id=$4");
    expect(block).toContain("AND run.timeline_plan_id=$5");
  });

  it("rechecks and locks active preset parents before hosted preset mutations", () => {
    const source = readFileSync(resolve(process.cwd(), "src/server/hosted/product.ts"), "utf8");
    const blocks = [
      ["avatarCommit", "avatarApprove", "lockActiveAvatarParent"],
      ["avatarApprove", "styleCreate", "lockActiveAvatarParent"],
      ["styleCreate", "styleCommit", "lockActiveStyleParent"],
      ["styleCommit", "styleAnalyze", "lockActiveStyleParent"],
      ["styleAnalyze", "stylePublish", "lockActiveStyleParent"],
      ["stylePublish", "retryProjectAttempt", "lockActiveStyleParent"],
    ] as const;
    const lockHelpers = source.slice(
      source.indexOf("async function lockActiveAvatarParent("),
      source.indexOf("async function avatarCreate("),
    );
    expect(lockHelpers).toContain("FOR UPDATE");
    expect(lockHelpers).toMatch(/status = 'ACTIVE'/u);
    for (const [startName, endName, lockName] of blocks) {
      const start = source.indexOf(`async function ${startName}(`);
      const end = source.indexOf(`async function ${endName}(`, start + 1);
      const block = source.slice(start, end);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeGreaterThan(start);
      expect(block).toContain(lockName);
      expect(block).toMatch(/status = 'ACTIVE'/u);
    }
  });

  it("replaces failed style uploads with one locked version and never dispatches analysis", () => {
    const source = readFileSync(resolve(process.cwd(), "src/server/hosted/product.ts"), "utf8");
    const start = source.indexOf("async function styleReferenceReplace(");
    const end = source.indexOf("async function styleCommit(", start);
    const replacement = source.slice(start, end);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(replacement).toContain("lockActiveStyleParent");
    expect(replacement).toContain('target.state !== "DRAFT"');
    expect(replacement).toContain("SET state = 'ABANDONED'");
    expect(replacement).toContain("VALUES ($1,$2,$3,$4,$5,'DRAFT','WORKSPACE',$6)");
    expect(replacement).toContain("hosted_reference_replace_idempotency_key");
    expect(replacement).toContain("request_sha256");
    expect(replacement).not.toContain("DELETE FROM");
    expect(replacement).not.toContain("styleAnalyze(");
    expect(replacement).not.toContain("runware");
  });

  it("reconciles every post-dispatch style-analysis persistence failure without redispatch", () => {
    const source = readFileSync(resolve(process.cwd(), "src/server/hosted/product.ts"), "utf8");
    const start = source.indexOf("async function styleAnalyze(");
    const end = source.indexOf("async function stylePublish(", start);
    const block = source.slice(start, end);
    const completion = block.slice(block.indexOf("const analyzed ="));
    expect(completion).toContain(
      'if (!analyzed) throw new RunwareGeminiStyleAnalysisError("AMBIGUOUS")',
    );
    expect(completion).not.toContain('code: "STYLE_NOT_FOUND"');
    expect(block).toContain('ambiguous ? "UNKNOWN" : "FAILED"');
  });

  it("retries only a definitively failed style analysis on a new immutable version", () => {
    const source = readFileSync(resolve(process.cwd(), "src/server/hosted/product.ts"), "utf8");
    const start = source.indexOf("async function styleAnalyze(");
    const end = source.indexOf("async function stylePublish(", start);
    const block = source.slice(start, end);
    expect(block).toContain('target.state === "FAILED"');
    expect(block).toContain("AND version.state = 'FAILED'");
    expect(block).toContain("SET state = 'ABANDONED'");
    expect(block).toContain("hosted-style-analysis-retry:");
    expect(block).toContain("hosted-style-analysis-retry-reference:");
    expect(block).toContain("VALUES ($1,$2,$3,$4,$5,'DRAFT','WORKSPACE',$6)");
    expect(block).not.toContain("FROM hosted_style_analysis_runs");
    expect(block).not.toContain("state = 'UNKNOWN' AND");
  });

  it("signs only verified tenant-scoped SoulX MP4 outputs for project media review", () => {
    const source = readFileSync(resolve(process.cwd(), "src/server/hosted/product.ts"), "utf8");
    const start = source.indexOf("async function avatarFootage(");
    const end = source.indexOf("async function projectDetail(", start);
    const block = source.slice(start, end);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(block).toContain('output.lane !== "soulx_avatar"');
    expect(block).toContain('contentType !== "video/mp4"');
    expect(block).toContain("object.size !== contentLength");
    expect(block).toContain("checksumFromR2(object.checksums?.sha256) !== checksum");
    expect(block).toContain("lifetimeSeconds: 300");
    expect(block).not.toContain("account_id");
  });
});

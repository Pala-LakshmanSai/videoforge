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
  const projectDetailAttemptRows: Record<string, unknown>[] = [];
  const projectDetailMediaRows: Record<string, unknown>[] = [];
  const projectDetailPromptRows: Record<string, unknown>[] = [];
  const createReplayRows: Record<string, unknown>[] = [];
  const renewedReservationRows: Record<string, unknown>[] = [];
  const rateLimitRows = [{ allowed: true }];
  const archiveState: {
    rows: Record<string, unknown>[];
    error: unknown;
  } = { rows: [], error: null };
  const projectArchiveState: {
    rows: Record<string, unknown>[];
    error: unknown;
  } = { rows: [], error: null };
  const projectCancellationState: {
    rows: Record<string, unknown>[];
    error: unknown;
  } = { rows: [], error: null };
  const providerBoundPairRows: Record<string, unknown>[] = [];
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
    if (sql.includes("videoforge_cancel_hosted_project_predispatch")) {
      if (projectCancellationState.error) throw projectCancellationState.error;
      return {
        rows: projectCancellationState.rows,
        affectedRows: projectCancellationState.rows.length,
      };
    }
    if (sql.includes("FROM hosted_project_create_requests AS request")) {
      return {
        rows: createReplayRows.map((row) => ({
          ...row,
          request_sha256: row.request_sha256 ?? params?.[3],
        })),
        affectedRows: createReplayRows.length,
      };
    }
    if (
      sql.includes("UPDATE artifact_reservations SET expires_at") &&
      sql.includes("RETURNING expires_at")
    ) {
      return { rows: renewedReservationRows, affectedRows: renewedReservationRows.length };
    }
    if (sql.includes("SELECT request.id::text AS generation_request_id")) {
      return { rows: providerBoundPairRows, affectedRows: providerBoundPairRows.length };
    }
    if (sql.includes("videoforge_inspect_hosted_pair_runtime")) {
      return {
        rows:
          providerBoundPairRows.length === 1
            ? [{ recovery_action: "RECONCILE_ASSIGNED" }, { recovery_action: "RECONCILE_ASSIGNED" }]
            : [],
        affectedRows: providerBoundPairRows.length === 1 ? 2 : 0,
      };
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
    if (
      sql.includes("FROM video_runtime_accepted_units AS unit") &&
      sql.includes("FROM serverless_output_receipts AS output")
    ) {
      return { rows: projectDetailMediaRows, affectedRows: projectDetailMediaRows.length };
    }
    if (
      sql.includes("FROM hosted_cpu_job_attempts AS attempt") &&
      sql.includes("SELECT attempt.id, attempt.kind, attempt.state, attempt.version") &&
      sql.includes("ORDER BY attempt.created_at")
    ) {
      const revisionScoped = /attempt\.project_revision_id\s*=\s*\$4/u.test(sql);
      const rows = revisionScoped
        ? projectDetailAttemptRows.filter((row) => row.project_revision_id === params?.[3])
        : projectDetailAttemptRows;
      return { rows, affectedRows: rows.length };
    }
    if (sql.includes("WITH prompt_rows AS"))
      return { rows: projectDetailPromptRows, affectedRows: projectDetailPromptRows.length };
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
    projectDetailAttemptRows,
    projectDetailMediaRows,
    projectDetailPromptRows,
    createReplayRows,
    renewedReservationRows,
    rateLimitRows,
    archiveState,
    projectArchiveState,
    projectCancellationState,
    providerBoundPairRows,
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

const hostedPairWorkflowState = vi.hoisted(() => ({
  ensureHostedPairWorkflow: vi.fn(),
}));

vi.mock("./hosted-pair-live-wiring", () => hostedPairWorkflowState);

import type { HostedRuntimeConfiguration, HostedRuntimeEnvironment } from "./configuration";
import {
  handleHostedProductRequest,
  hostedAsrSubmissionIdentity,
  hostedAvatarConflictProblem,
  hostedGpuProductState,
  hostedProjectConflictProblem,
  hostedPromptWritingState,
  hostedStyleConflictProblem,
  verifyHostedPreviewChecksum,
} from "./product";
import { handleHostedPromptRequest } from "./hosted-prompt-route";

const ORIGIN = "https://hosted.example.test";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const PRESET_ID = "44444444-4444-4444-8444-444444444444";

const config = {
  publicOrigin: ORIGIN,
  neon: { databaseUrl: "postgresql://fixture" },
  r2: {
    accountId: "fixture-account",
    bucketName: "fixture-bucket",
    region: "auto",
    accessKeyId: "fixture-access-key",
    secretAccessKey: "fixture-secret-key",
  },
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

describe("hosted project upload renewal", () => {
  const createEnvironment = {
    PRIVATE_ARTIFACTS: {},
  } as unknown as HostedRuntimeEnvironment;
  const revisionId = "22222222-2222-4222-8222-222222222222";
  const oldReservationId = "55555555-5555-4555-8555-555555555555";
  const objectKey =
    `tenant/${testState.scopeRows[0]?.account_id}/workspace/${testState.scopeRows[0]?.workspace_id}` +
    `/project/${PROJECT_ID}/revision/${revisionId}/lane/input/job/browser-upload/artifact/voiceover`;
  const checksum = `sha256:${"a".repeat(64)}`;
  const createBody = {
    schema_version: "videoforge-hosted-project-create/v1",
    title: "Retryable upload project",
    avatar_profile_version_id: PRESET_ID,
    image_style_version_id: "66666666-6666-4666-8666-666666666666",
    voiceover: {
      filename: "voiceover.mp3",
      content_type: "audio/mpeg",
      content_length: 320_000,
      checksum_sha256: checksum,
      duration_ms: 159_216,
    },
  };

  const replayRow = (state: "UPLOAD_PENDING" | "READY", expiresAt: string) => ({
    request_sha256: null,
    state,
    project_id: PROJECT_ID,
    project_revision_id: revisionId,
    upload_reservation_id: oldReservationId,
    object_key: objectKey,
    content_type: "audio/mpeg",
    content_length: 320_000,
    checksum_sha256: checksum,
    expires_at: expiresAt,
  });

  it("renews an expiring pending reservation without changing project lineage", async () => {
    testState.query.mockClear();
    testState.createReplayRows.splice(
      0,
      testState.createReplayRows.length,
      replayRow("UPLOAD_PENDING", new Date(Date.now() + 60_000).toISOString()),
    );
    const renewedExpiry = new Date(Date.now() + 15 * 60_000).toISOString();
    testState.renewedReservationRows.splice(0, testState.renewedReservationRows.length, {
      expires_at: renewedExpiry,
    });

    try {
      const result = await handleHostedProductRequest(
        request("/api/v2/hosted/projects", "POST", createBody, true, {
          "idempotency-key": "hosted-project-retry-0000001",
        }),
        createEnvironment,
        config,
        executionContext,
      );
      expect(result?.status).toBe(201);
      const body = (await result?.json()) as {
        project_id: string;
        project_revision_id: string;
        state: string;
      };
      expect(body).toMatchObject({
        project_id: PROJECT_ID,
        project_revision_id: revisionId,
        state: "UPLOAD_PENDING",
      });

      const renewalCall = testState.query.mock.calls.find(
        ([sql]) =>
          String(sql).includes("UPDATE artifact_reservations SET expires_at") &&
          String(sql).includes("RETURNING expires_at"),
      );
      expect(renewalCall).toBeDefined();
      const renewalParameters = renewalCall?.[1] as readonly unknown[] | undefined;
      expect(renewalParameters?.[0]).toBe(oldReservationId);
      expect(renewalParameters?.[1]).toBe(testState.scopeRows[0]?.account_id);
      expect(renewalParameters?.[2]).toBe(testState.scopeRows[0]?.workspace_id);
      expect(
        testState.query.mock.calls.some(([sql]) =>
          String(sql).includes("INSERT INTO artifact_reservations"),
        ),
      ).toBe(false);
      expect(
        testState.query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO projects")),
      ).toBe(false);
    } finally {
      testState.createReplayRows.length = 0;
      testState.renewedReservationRows.length = 0;
      testState.query.mockClear();
    }
  });

  it("does not renew a READY replay even when its old expiry is past", async () => {
    testState.query.mockClear();
    testState.createReplayRows.splice(
      0,
      testState.createReplayRows.length,
      replayRow("READY", new Date(Date.now() - 60_000).toISOString()),
    );

    try {
      const result = await handleHostedProductRequest(
        request("/api/v2/hosted/projects", "POST", createBody, true, {
          "idempotency-key": "hosted-project-ready-0000001",
        }),
        createEnvironment,
        config,
        executionContext,
      );
      expect(result?.status).toBe(200);
      await expect(result?.json()).resolves.toMatchObject({
        project_id: PROJECT_ID,
        project_revision_id: revisionId,
        state: "READY",
        upload: null,
      });
      expect(
        testState.query.mock.calls.some(([sql]) =>
          String(sql).includes("UPDATE artifact_reservations SET expires_at"),
        ),
      ).toBe(false);
    } finally {
      testState.createReplayRows.length = 0;
      testState.renewedReservationRows.length = 0;
      testState.query.mockClear();
    }
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
  it("verifies preview bytes when R2 omits SHA metadata and caches only the exact ETag", async () => {
    const bytes = new Uint8Array(new TextEncoder().encode("verified preview"));
    const hash = `sha256:${[...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
    const get = vi.fn(async () => ({
      size: bytes.byteLength,
      etag: "v1",
      arrayBuffer: async () => bytes,
    }));
    const bucket = { get } as unknown as NonNullable<HostedRuntimeEnvironment["PRIVATE_ARTIFACTS"]>;
    const head = { size: bytes.byteLength, etag: "v1" };
    expect(await verifyHostedPreviewChecksum(bucket, "tenant/preview-check", head, hash)).toBe(
      true,
    );
    expect(await verifyHostedPreviewChecksum(bucket, "tenant/preview-check", head, hash)).toBe(
      true,
    );
    expect(get).toHaveBeenCalledTimes(1);
    expect(
      await verifyHostedPreviewChecksum(
        bucket,
        "tenant/preview-check",
        { ...head, etag: "v2" },
        hash,
      ),
    ).toBe(false);
  });
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
    expect(
      testState.query.mock.calls.some(([sql]) =>
        String(sql).includes("videoforge_read_hosted_style_analysis_state"),
      ),
    ).toBe(true);
  });

  it("creates a fresh bounded ASR submission after an explicit failed attempt", async () => {
    const previousProject = testState.projectRows[0];
    const revisionId = "22222222-2222-4222-8222-222222222222";
    testState.projectRows[0] = {
      revision_id: revisionId,
      revision_number: 2,
      voiceover_asset_id: "33333333-3333-4333-8333-333333333333",
      checksum_sha256: `sha256:${"a".repeat(64)}`,
      content_type: "audio/mpeg",
      duration_ms: 159_216,
      receipt_id: "44444444-4444-4444-8444-444444444444",
      asr_attempt_count: 1,
      asr_total_attempt_count: 1,
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
        project_revision_id: string;
        cpu_submission: {
          idempotency_key: string;
          project_revision_id: string;
          input_document: {
            attempt_id: string;
            output: { result_uri: string };
            cancel_token: string;
          };
        };
      };
      expect(body.project_revision_id).toBe(revisionId);
      expect(body.cpu_submission.project_revision_id).toBe(revisionId);
      expect(body.cpu_submission.idempotency_key).toBe(
        `project-${PROJECT_ID}-revision-${revisionId}-asr-v2`,
      );
      expect(body.cpu_submission.input_document.attempt_id).toBe(revisionId);
      expect(body.cpu_submission.input_document.output.result_uri).toBe(
        `vf-local-run://${revisionId}/${revisionId}/asr-result.json`,
      );
      expect(body.cpu_submission.input_document.cancel_token).toBe(
        `project-${PROJECT_ID}-revision-${revisionId}-asr-cancel`,
      );

      const source = readFileSync(resolve(process.cwd(), "src/server/hosted/product.ts"), "utf8");
      const handoffStart = source.indexOf("async function asrHandoff(");
      const handoffEnd = source.indexOf("function hostedTranscriptText(", handoffStart);
      const handoff = source.slice(handoffStart, handoffEnd);
      expect(handoff).toContain("revision.status = 'LOCKED'");
      expect(handoff).toContain("ORDER BY revision.revision_number DESC, revision.id DESC");
      const commitStart = source.indexOf("async function commitProject(");
      const commitEnd = source.indexOf("/**\n * Advance the ordinary product journey", commitStart);
      const commit = source.slice(commitStart, commitEnd);
      expect(commit).toContain("hostedAsrSubmissionIdentity(projectId, revisionId, 1)");
    } finally {
      testState.projectRows[0] = previousProject!;
    }
  });

  it("keeps the hand-off open when every failed attempt was a local resource failure", async () => {
    // A project whose transcriptions all failed because the owner's own computer ran out of disk is
    // recoverable on that machine, so those attempts must not spend the bounded retry budget: the
    // state row reports them in asr_total_attempt_count only.
    const previousProject = testState.projectRows[0];
    testState.projectRows[0] = {
      revision_id: "22222222-2222-4222-8222-222222222222",
      revision_number: 2,
      voiceover_asset_id: "33333333-3333-4333-8333-333333333333",
      checksum_sha256: `sha256:${"a".repeat(64)}`,
      content_type: "audio/mpeg",
      duration_ms: 159_216,
      receipt_id: "44444444-4444-4444-8444-444444444444",
      asr_attempt_count: 0,
      asr_total_attempt_count: 3,
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
      const body = (await result?.json()) as { cpu_submission: { input_document: { attempt_id: string } } };
      // The identity still advances with the total, so the fourth attempt cannot collide with the third.
      expect(body.cpu_submission.input_document.attempt_id).toBe(
        hostedAsrSubmissionIdentity(PROJECT_ID, "22222222-2222-4222-8222-222222222222", 4).attemptId,
      );
    } finally {
      testState.projectRows[0] = previousProject!;
    }
  });

  it("refuses the hand-off once the total attempt ceiling is reached", async () => {
    const previousProject = testState.projectRows[0];
    testState.projectRows[0] = {
      revision_id: "22222222-2222-4222-8222-222222222222",
      revision_number: 2,
      voiceover_asset_id: "33333333-3333-4333-8333-333333333333",
      checksum_sha256: `sha256:${"a".repeat(64)}`,
      content_type: "audio/mpeg",
      duration_ms: 159_216,
      receipt_id: "44444444-4444-4444-8444-444444444444",
      asr_attempt_count: 0,
      asr_total_attempt_count: 12,
      latest_asr_state: "FAILED",
    };
    try {
      const result = await handleHostedProductRequest(
        request(`/api/v2/hosted/projects/${PROJECT_ID}/asr`),
        environment,
        stagingConfig,
        executionContext,
      );
      expect(result?.status).toBe(409);
      expect(await result?.json()).toMatchObject({
        error: { code: "HOSTED_ASR_RETRY_LIMIT_REACHED" },
      });
    } finally {
      testState.projectRows[0] = previousProject!;
    }
  });

  it("refuses the hand-off once the voiceover itself failed the bounded number of times", async () => {
    const previousProject = testState.projectRows[0];
    testState.projectRows[0] = {
      revision_id: "22222222-2222-4222-8222-222222222222",
      revision_number: 2,
      voiceover_asset_id: "33333333-3333-4333-8333-333333333333",
      checksum_sha256: `sha256:${"a".repeat(64)}`,
      content_type: "audio/mpeg",
      duration_ms: 159_216,
      receipt_id: "44444444-4444-4444-8444-444444444444",
      asr_attempt_count: 3,
      asr_total_attempt_count: 3,
      latest_asr_state: "FAILED",
    };
    try {
      const result = await handleHostedProductRequest(
        request(`/api/v2/hosted/projects/${PROJECT_ID}/asr`),
        environment,
        stagingConfig,
        executionContext,
      );
      expect(result?.status).toBe(409);
      expect(await result?.json()).toMatchObject({
        error: { code: "HOSTED_ASR_RETRY_LIMIT_REACHED" },
      });
    } finally {
      testState.projectRows[0] = previousProject!;
    }
  });

  it("returns not found before detail queries when no locked active project exists", async () => {
    const previous = [...testState.projectRows];
    testState.projectRows.splice(0);
    testState.query.mockClear();
    try {
      const result = await handleHostedProductRequest(request(`/api/v2/hosted/projects/${PROJECT_ID}`, "GET"), environment, stagingConfig, executionContext);
      expect(result?.status).toBe(404);
      const failedTasks = testState.query.mock.calls.find(([sql]) =>
        String(sql).includes("SELECT task.id, task.task_key, task.lane, task.state, task.updated_at"));
      expect(failedTasks).toBeUndefined();
    } finally {
      testState.projectRows.push(...previous);
    }
  });

  it("reports persisted stage boundaries without inventing technical or historical planning time", async () => {
    const previousProject = testState.projectRows[0]!;
    const previousAttempts = [...testState.projectDetailAttemptRows];
    const started = "2026-09-15T01:00:00.000Z";
    const locked = "2026-09-15T01:02:00.000Z";
    const rendered = "2026-09-15T01:05:00.000Z";
    testState.projectRows[0] = {
      ...previousProject,
      created_at: started,
      locked_at: locked,
      revision_state: "LOCKED",
    };
    testState.projectDetailAttemptRows.push({
      id: "44444444-4444-4444-8444-444444444444",
      project_revision_id: previousProject.revision_id,
      kind: "RENDER",
      state: "SUCCEEDED",
      submitted_at: locked,
      terminal_at: rendered,
    });
    try {
      const result = await handleHostedProductRequest(
        request(`/api/v2/hosted/projects/${PROJECT_ID}`, "GET"),
        environment,
        stagingConfig,
        executionContext,
      );
      const body = (await result!.json()) as {
        stages: Record<string, unknown>[];
        span_audio: Record<string, unknown>;
      };
      const stage = (id: string) => body.stages.find((value) => value.id === id);
      expect(stage("prepare")).toMatchObject({ started_at: started, completed_at: locked });
      expect(stage("render")).toMatchObject({ started_at: locked, completed_at: rendered });
      expect(stage("review")).toMatchObject({ started_at: rendered, completed_at: null });
      expect(stage("technical-check")).toMatchObject({ started_at: null, completed_at: null });
      expect(stage("planning")).toMatchObject({ started_at: null, completed_at: null });
      const stageIds = body.stages.map((value) => String(value.id));
      expect(stageIds.indexOf("audio-spanning")).toBe(stageIds.indexOf("prompt-writing") + 1);
      expect(stageIds.indexOf("image-generation")).toBe(stageIds.indexOf("audio-spanning") + 1);
      expect(stage("audio-spanning")).toMatchObject({
        name: "Audio spanning",
        status: "WAITING",
        started_at: null,
        completed_at: null,
      });
      expect(body.span_audio).toMatchObject({ started_at: null, completed_at: null });
    } finally {
      testState.projectRows[0] = previousProject;
      testState.projectDetailAttemptRows.splice(
        0,
        testState.projectDetailAttemptRows.length,
        ...previousAttempts,
      );
    }
  });

  it("does not inherit a predecessor ASR attempt when the latest locked revision is selected", async () => {
    const previousProject = testState.projectRows[0];
    const previousAttempts = [...testState.projectDetailAttemptRows];
    const predecessorRevisionId = "22222222-2222-4222-8222-222222222222";
    const successorRevisionId = "33333333-3333-4333-8333-333333333333";
    testState.projectRows[0] = {
      ...previousProject,
      id: PROJECT_ID,
      revision_id: successorRevisionId,
      revision_number: 2,
      revision_state: "LOCKED",
    };
    testState.projectDetailAttemptRows.splice(0, testState.projectDetailAttemptRows.length, {
      id: "44444444-4444-4444-8444-444444444444",
      project_revision_id: predecessorRevisionId,
      kind: "ASR",
      state: "SUCCEEDED",
      version: 1,
      created_at: "2026-09-09T00:00:00.000Z",
      updated_at: "2026-09-09T00:01:00.000Z",
      submitted_at: "2026-09-09T00:00:01.000Z",
      terminal_at: "2026-09-09T00:01:00.000Z",
      result_checksum_sha256: null,
      result_content_length: null,
      result_object_key: null,
      result_content_type: "application/json",
      replay_count: 0,
      error_code: null,
      object_key: null,
      content_type: null,
      content_length: null,
      output_checksum_sha256: null,
      approved_at: null,
    });
    try {
      const result = await handleHostedProductRequest(
        request(`/api/v2/hosted/projects/${PROJECT_ID}`, "GET"),
        environment,
        stagingConfig,
        executionContext,
      );
      expect(result?.status).toBe(200);
      const body = (await result?.json()) as {
        attempts: Array<{ kind?: string }>;
        stages: Array<{ id?: string; status?: string }>;
      };
      expect(body.attempts.some((attempt) => attempt.kind === "ASR")).toBe(false);
      expect(body.stages).toContainEqual(
        expect.objectContaining({ id: "transcription", status: "WAITING" }),
      );
      expect(
        testState.query.mock.calls.some(
          ([sql, params]) =>
            String(sql).includes("FROM hosted_cpu_job_attempts AS attempt") &&
            String(sql).includes("attempt.project_revision_id = $4") &&
            params?.[3] === successorRevisionId,
        ),
      ).toBe(true);
    } finally {
      testState.projectRows[0] = previousProject!;
      testState.projectDetailAttemptRows.splice(
        0,
        testState.projectDetailAttemptRows.length,
        ...previousAttempts,
      );
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

  it.each(["DISABLED_UNQUALIFIED", "QUALIFIED_EXACT"] as const)(
    "allows production preset writes through validation independently of GPU transport: %s",
    async (gpuTransport) => {
      const productionConfig = {
        ...config,
        environment: "production",
        gpuTransport,
      } as HostedRuntimeConfiguration;
      for (const path of [
        "/api/v2/hosted/avatars",
        `/api/v2/hosted/avatars/${PRESET_ID}/commit`,
        `/api/v2/hosted/avatars/${PRESET_ID}/approve`,
        "/api/v2/hosted/styles",
        `/api/v2/hosted/styles/${PRESET_ID}/references/retry`,
        `/api/v2/hosted/styles/${PRESET_ID}/commit`,
        `/api/v2/hosted/styles/${PRESET_ID}/analyze`,
        `/api/v2/hosted/styles/${PRESET_ID}/publish`,
      ]) {
        testState.query.mockClear();
        const rejectedOrigin = await handleHostedProductRequest(
          request(path, "POST", {}, false),
          environment,
          productionConfig,
          executionContext,
        );
        expect(rejectedOrigin?.status).toBe(403);
        const invalidInput = await handleHostedProductRequest(
          request(path, "POST", { unexpected: true }),
          environment,
          productionConfig,
          executionContext,
        );
        expect(invalidInput?.status).toBe(400);
        expect(testState.query).not.toHaveBeenCalled();
      }
      const retry = await handleHostedProductRequest(
        request(`/api/v2/hosted/projects/${PROJECT_ID}/retry`, "POST", {}),
        environment,
        productionConfig,
        executionContext,
      );
      expect(retry?.status).toBe(409);
      await expect(errorCode(retry)).resolves.toBe("TARGETED_RETRY_NOT_QUALIFIED");
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

  it("cancels tenant project work only through the provider-safe exact function", async () => {
    const generationRequestId = "55555555-5555-4555-8555-555555555555";
    testState.query.mockClear();
    testState.projectCancellationState.rows.splice(
      0,
      testState.projectCancellationState.rows.length,
      {
        project_id: PROJECT_ID,
        generation_request_id: generationRequestId,
        state: "CANCELLED",
        replayed: false,
      },
    );
    testState.projectCancellationState.error = null;

    const result = await handleHostedProductRequest(
      request(`/api/v2/hosted/projects/${PROJECT_ID}/cancel`, "POST", {
        schema_version: "videoforge-hosted-project-cancellation/v1",
        project_id: PROJECT_ID,
        confirmation: "STOP",
      }),
      environment,
      config,
      executionContext,
    );

    expect(result?.status).toBe(200);
    await expect(result?.json()).resolves.toEqual({
      schema_version: "videoforge-hosted-project-cancellation-response/v1",
      project_id: PROJECT_ID,
      generation_request_id: generationRequestId,
      state: "CANCELLED",
      replayed: false,
      provider_actions_created: false,
      redispatch: false,
    });
    expect(
      testState.query.mock.calls.some(([sql]) =>
        String(sql).includes("videoforge_cancel_hosted_project_predispatch"),
      ),
    ).toBe(true);
    expect(
      testState.query.mock.calls.some(([sql]) =>
        /UPDATE\s+generation_requests/iu.test(String(sql)),
      ),
    ).toBe(false);
    testState.projectCancellationState.rows.length = 0;
  });

  it("restarts global pair reconciliation when owner cancellation finds assigned provider work", async () => {
    const generationRequestId = "55555555-5555-4555-8555-555555555555";
    const reconciliationEnvironment = {
      ...environment,
      VIDEOFORGE_RECONCILER_DATABASE_URL: "postgresql://reconciler-fixture",
      HOSTED_PAIR_WORKFLOW: { create: vi.fn(), get: vi.fn() },
    };
    testState.projectCancellationState.rows.length = 0;
    testState.projectCancellationState.error = { code: "55000" };
    testState.providerBoundPairRows.splice(0, testState.providerBoundPairRows.length, {
      generation_request_id: generationRequestId,
    });
    hostedPairWorkflowState.ensureHostedPairWorkflow.mockResolvedValue({
      id: `hosted-pair-${generationRequestId}`,
      recovered: true,
    });

    try {
      const result = await handleHostedProductRequest(
        request(`/api/v2/hosted/projects/${PROJECT_ID}/cancel`, "POST", {
          schema_version: "videoforge-hosted-project-cancellation/v1",
          project_id: PROJECT_ID,
          confirmation: "STOP",
        }),
        reconciliationEnvironment,
        config,
        executionContext,
      );

      expect(result?.status).toBe(202);
      await expect(result?.json()).resolves.toMatchObject({
        state: "RECONCILING",
        generation_request_id: generationRequestId,
        reconciliation_scheduled: true,
        workflow_id: `hosted-pair-${generationRequestId}`,
        recovered_workflow: true,
        provider_actions_created: false,
        redispatch: false,
      });
      expect(hostedPairWorkflowState.ensureHostedPairWorkflow).toHaveBeenCalledWith(
        reconciliationEnvironment,
        testState.executor,
        testState.executor,
        {
          accountId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          workspaceId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          generationRequestId,
        },
      );
      expect(
        testState.query.mock.calls.some(([sql]) =>
          /serverless_(?:dispatch_outbox|provider_assignments)/u.test(String(sql)),
        ),
      ).toBe(false);
    } finally {
      hostedPairWorkflowState.ensureHostedPairWorkflow.mockReset();
      testState.projectCancellationState.error = null;
      testState.providerBoundPairRows.length = 0;
    }
  });

  it("rejects stale or unbound project cancellation confirmation", async () => {
    testState.query.mockClear();
    const result = await handleHostedProductRequest(
      request(`/api/v2/hosted/projects/${PROJECT_ID}/cancel`, "POST", {
        schema_version: "videoforge-hosted-project-cancellation/v1",
        project_id: PRESET_ID,
        confirmation: "STOP",
      }),
      environment,
      config,
      executionContext,
    );
    expect(result?.status).toBe(400);
    await expect(errorCode(result)).resolves.toBe("PROJECT_WORK_CANCELLATION_REJECTED");
    expect(testState.query).not.toHaveBeenCalled();
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
      estimate: {
        duration_ms: 20_000,
        voiceover_bytes: 320_000,
        maximum_usd: null,
        cap_usd: null,
      },
    });
  });

  it("rejects client-supplied spend caps in hosted project preflight", async () => {
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
    expect(result?.status).toBe(400);
    await expect(errorCode(result)).resolves.toBe("PROJECT_PREFLIGHT_REJECTED");
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

  it("binds render handoff to the supplied ASR on the latest locked successor revision", () => {
    const source = readFileSync(resolve(process.cwd(), "src/server/hosted/product.ts"), "utf8");
    const planningStart = source.indexOf("async function renderHandoff(");
    const planningEnd = source.indexOf("async function projects(", planningStart);
    const planning = source.slice(planningStart, planningEnd);
    expect(planning).toContain("AND revision.status = 'LOCKED'");
    expect(planning).toContain("AND asr.project_revision_id = revision.id");
    expect(planning).toContain("AND asr.id = $4");
    expect(planning).toContain("ORDER BY revision.revision_number DESC, revision.id DESC");
    expect(
      planning.indexOf("ORDER BY revision.revision_number DESC, revision.id DESC"),
    ).toBeLessThan(planning.indexOf("LIMIT 1`"));
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
    // A writer task is created the moment prompt writing starts; every non-terminal durable state it
    // passes through must read as running work, never as "not started".
    for (const inFlight of ["PENDING", "READY", "DISPATCHING", "RUNNING"]) {
      expect(hostedPromptWritingState(inFlight, true, { acceptedScenes: 25, totalScenes: 100 })).toEqual({
        status: "RUNNING",
        progressPercent: 25,
        detail: "Image prompts are being written and verified against the approved style.",
      });
    }
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
    expect(block).toContain("dispatchIdentity: identity.attemptId");
    expect(block).toContain("context_id: contextId,");
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
    expect(block).toContain("const candidateIdentities");
    expect(block).toContain("state.attempt_id,");
    expect(block).toContain("state.context_id,");
    expect(block).toContain("attempt.requestHash === state.request_hash");
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

  it.each([undefined, "A freshly edited scene prompt."])(
    "lists accepted runtime units and selected prompt %s",
    async (editedPrompt) => {
      testState.query.mockClear();
      const revisionId = "22222222-2222-4222-8222-222222222222";
      const accountId = testState.scopeRows[0]!.account_id as string;
      const workspaceId = testState.scopeRows[0]!.workspace_id as string;
      const mage = {
        item_id: "mage-scene-1",
        ...(editedPrompt ? { prompt: editedPrompt } : {}),
        object_key:
          `tenant/${accountId}/workspace/${workspaceId}` +
          `/project/${PROJECT_ID}/revision/${revisionId}/lane/mage-image/job/mage-attempt/artifact/mage-scene-1`,
        content_type: "image/png",
        content_length: 101,
        checksum_sha256: `sha256:${"01".repeat(32)}`,
      };
      const soulx = {
        item_id: "soulx-scene-1",
        object_key:
          `tenant/${accountId}/workspace/${workspaceId}` +
          `/project/${PROJECT_ID}/revision/${revisionId}/lane/soulx-avatar/job/soulx-attempt/artifact/soulx-scene-1`,
        content_type: "video/mp4",
        content_length: 202,
        checksum_sha256: `sha256:${"02".repeat(32)}`,
      };
      testState.projectDetailMediaRows.splice(
        0,
        testState.projectDetailMediaRows.length,
        {
          attempt_id: "33333333-3333-4333-8333-333333333333",
          lane: "mage_image",
          artifacts: [mage],
          accepted_at: "2026-09-14T00:00:00.000Z",
        },
        {
          attempt_id: "44444444-4444-4444-8444-444444444444",
          lane: "soulx_avatar",
          artifacts: [soulx],
          accepted_at: "2026-09-14T00:00:01.000Z",
        },
      );
      testState.projectDetailPromptRows.push({
        image_task_id: "different-image",
        positive_prompt: "This prompt belongs to another image.",
      });
      testState.projectDetailPromptRows.push({
        image_task_id: mage.item_id,
        positive_prompt: "A person holding a watermelon in a produce market.",
      });
      const objects = new Map([
        [mage.object_key, { ...mage, checksumBytes: new Uint8Array(32).fill(1).buffer }],
        [soulx.object_key, { ...soulx, checksumBytes: new Uint8Array(32).fill(2).buffer }],
      ]);
      const head = vi.fn(async (objectKey: string) => {
        const object = objects.get(objectKey);
        return object
          ? {
              size: object.content_length,
              httpMetadata: { contentType: object.content_type },
              checksums: { sha256: object.checksumBytes },
            }
          : null;
      });
      const mediaEnvironment = {
        PRIVATE_ARTIFACTS: { head },
      } as unknown as HostedRuntimeEnvironment;

      try {
        const result = await handleHostedProductRequest(
          request(`/api/v2/hosted/projects/${PROJECT_ID}`, "GET"),
          mediaEnvironment,
          stagingConfig,
          executionContext,
        );
        expect(result?.status).toBe(200);
        const body = (await result?.json()) as {
          review: {
            contact_sheet: Array<{ id: string; image_url: string }>;
            avatar_footage: Array<{ id: string; video_url: string }>;
            media_pagination: {
              images: Record<string, unknown>;
              avatar: Record<string, unknown>;
            };
          };
          media_pagination: {
            images: Record<string, unknown>;
            avatar: Record<string, unknown>;
          };
        };
        const promptCall = testState.query.mock.calls.find(([sql]) =>
          String(sql).includes("WITH prompt_rows AS"),
        );
        expect(promptCall?.[0]).toContain("image_task.account_id = result.account_id");
        expect(promptCall?.[0]).toContain("image_task.workspace_id = result.workspace_id");
        expect(promptCall?.[0]).toContain(
          "image_task.project_revision_id = result.project_revision_id",
        );
        expect(promptCall?.[0]).toContain("segment.required_slots->'image'->>'task_key'");
        expect(promptCall?.[0]).toContain("segment.required_slots->'right_image'->>'task_key'");
        expect(body.review.contact_sheet).toHaveLength(1);
        expect(body.review.contact_sheet[0]).toMatchObject({
          id: mage.item_id,
          shot_role: "mage_image",
          prompt: editedPrompt ?? "A person holding a watermelon in a produce market.",
          label: editedPrompt ?? "A person holding a watermelon in a produce market.",
        });
    expect(body.review.avatar_footage).toHaveLength(1);
    expect(body.review.avatar_footage[0]).toMatchObject({ id: soulx.item_id });
    expect(body.review.media_pagination).toEqual({
      images: { page: 1, page_size: 96, total_accepted: 1, has_more: false },
      avatar: { page: 1, page_size: 96, total_accepted: 1, has_more: false },
    });
    expect(body.media_pagination).toEqual(body.review.media_pagination);
    expect(head).toHaveBeenCalledTimes(2);
    expect(head).toHaveBeenNthCalledWith(1, mage.object_key);
    expect(head).toHaveBeenNthCalledWith(2, soulx.object_key);

        const mediaCall = testState.query.mock.calls.find(([sql]) =>
          String(sql).includes("FROM video_runtime_accepted_units AS unit"),
        );
        expect(mediaCall).toBeDefined();
        expect(mediaCall?.[0]).toContain("JOIN serverless_attempts AS attempt");
        expect(mediaCall?.[0]).toContain("JOIN artifact_reservations AS reservation");
        expect(mediaCall?.[0]).toContain("JOIN artifact_receipts AS receipt");
        expect(mediaCall?.[0]).toContain("reservation.state = 'COMMITTED'");
        expect(mediaCall?.[0]).toContain("receipt.deleted_at IS NULL");
        expect(mediaCall?.[1]).toEqual([accountId, workspaceId, PROJECT_ID, revisionId]);

        testState.query.mockClear();
        head.mockClear();
        const imagePageTwo = await handleHostedProductRequest(
          request(`/api/v2/hosted/projects/${PROJECT_ID}?media_kind=images&media_page=2`, "GET"),
          mediaEnvironment,
          stagingConfig,
          executionContext,
        );
        expect(imagePageTwo?.status).toBe(200);
        const imagePageTwoBody = (await imagePageTwo?.json()) as {
          readonly review: {
            readonly contact_sheet: readonly unknown[];
            readonly avatar_footage: readonly unknown[];
            readonly media_pagination: {
              readonly images: Record<string, unknown>;
              readonly avatar: Record<string, unknown>;
            };
          };
        };
        expect(imagePageTwoBody.review.contact_sheet).toHaveLength(0);
        expect(imagePageTwoBody.review.avatar_footage).toHaveLength(0);
        expect(imagePageTwoBody.review.media_pagination).toEqual({
          images: { page: 2, page_size: 96, total_accepted: 1, has_more: false },
          avatar: { page: 1, page_size: 96, total_accepted: 1, has_more: false },
        });
        expect(head).not.toHaveBeenCalled();
      } finally {
        testState.projectDetailPromptRows.splice(0);
        testState.projectDetailMediaRows.splice(0, testState.projectDetailMediaRows.length);
      }
    },
  );

  it("signs only verified tenant-scoped SoulX MP4 outputs for project media review", () => {
    const source = readFileSync(resolve(process.cwd(), "src/server/hosted/product.ts"), "utf8");
    const start = source.indexOf("async function avatarFootage(");
    const end = source.indexOf("async function projectDetail(", start);
    const block = source.slice(start, end);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(block).toContain('hostedMediaCandidates(outputs, "avatar", page)');
    expect(block).toContain('contentType !== "video/mp4"');
    expect(block).toContain("object.size !== contentLength");
    expect(block).toContain(
      "await verifyHostedPreviewChecksum(bucket, objectKey, object, checksum)",
    );
    expect(block).toContain("lifetimeSeconds: 300");
    expect(block).not.toContain("account_id");
  });

  it("suppresses failed tasks with an exact committed accepted runtime unit", () => {
    const source = readFileSync(resolve(process.cwd(), "src/server/hosted/product.ts"), "utf8");
    const start = source.indexOf("const failedTasks = await transaction.query(");
    const end = source.indexOf("const review = await transaction.query(", start);
    const query = source.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(query).toContain("AND NOT EXISTS (");
    expect(query).toContain("FROM video_runtime_accepted_units AS unit");
    expect(query).toContain("JOIN serverless_attempts AS accepted_attempt");
    expect(query).toContain("unit.item_id = task.id::text");
    expect(query).toContain("WHEN 'mage_image' THEN 'IMAGE'");
    expect(query).toContain("WHEN 'soulx_avatar' THEN 'AVATAR'");
    expect(query).not.toContain("accepted_attempt.task_id = task.id");
    expect(query).toContain("JOIN artifact_reservations AS reservation");
    expect(query).toContain("reservation.state = 'COMMITTED'");
    expect(query).toContain("JOIN artifact_receipts AS receipt");
    expect(query).toContain("receipt.deleted_at IS NULL");
    expect(query).toContain("receipt.checksum_sha256 = unit.checksum_sha256");

  });

  it("verifies media in bounded parallel batches while preserving order", async () => {
    const revisionId = "22222222-2222-4222-8222-222222222222";
    const accountId = testState.scopeRows[0]!.account_id as string;
    const workspaceId = testState.scopeRows[0]!.workspace_id as string;
    const outputs = Array.from({ length: 97 }, (_, index) => {
      const itemId = `mage-scene-${index + 1}`;
      return {
        attempt_id: "33333333-3333-4333-8333-333333333333",
        lane: "mage_image",
        accepted_at: `2026-09-14T00:00:${String(index).padStart(2, "0")}.000Z`,
        artifacts: [
          {
            item_id: itemId,
            object_key:
              `tenant/${accountId}/workspace/${workspaceId}` +
              `/project/${PROJECT_ID}/revision/${revisionId}/lane/mage-image/job/mage-attempt/artifact/${itemId}`,
            content_type: "image/png",
            content_length: 101,
            checksum_sha256: `sha256:${"01".repeat(32)}`,
          },
        ],
      };
    });
    testState.projectDetailMediaRows.splice(
      0,
      testState.projectDetailMediaRows.length,
      ...outputs,
    );
    let active = 0;
    let maxActive = 0;
    const head = vi.fn(async (objectKey: string) => {
      const index = outputs.findIndex((output) => output.artifacts[0]!.object_key === objectKey);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      if (index === 95) return null;
      return {
        size: 101,
        httpMetadata: { contentType: "image/png" },
        checksums: { sha256: new Uint8Array(32).fill(1).buffer },
      };
    });
    const mediaEnvironment = {
      PRIVATE_ARTIFACTS: { head },
    } as unknown as HostedRuntimeEnvironment;

    try {
      const result = await handleHostedProductRequest(
        request(`/api/v2/hosted/projects/${PROJECT_ID}?media_kind=images`, "GET"),
        mediaEnvironment,
        stagingConfig,
        executionContext,
      );
      expect(result?.status).toBe(200);
      const body = (await result?.json()) as {
        readonly review: { readonly contact_sheet: readonly { id: string }[] };
      };
      expect(body.review.contact_sheet.map((item) => item.id)).toEqual(
        outputs
          .filter((_, index) => index !== 95)
          .map((output) => output.artifacts[0]!.item_id),
      );
      expect(maxActive).toBeGreaterThan(1);
      expect(maxActive).toBeLessThanOrEqual(8);
    } finally {
      testState.projectDetailMediaRows.splice(0, testState.projectDetailMediaRows.length);
    }
  });

  it("projects accepted barrier completion without changing attempt authority", () => {
    const source = readFileSync(resolve(process.cwd(), "src/server/hosted/product.ts"), "utf8");
    const start = source.indexOf("const serverlessAttempts = await transaction.query(");
    const end = source.indexOf("// Span audio", start);
    const query = source.slice(start, end);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(query).toContain("videoforge_hosted_accepted_lane_progress($1,$2,$3,$4) AS barrier");
    expect(query).toContain("barrier.accepted_count");
    expect(query).toContain("barrier.completed_at");
    expect(query).toMatch(
      /CASE\s+WHEN barrier\.attempt_id IS NOT NULL THEN 'COMPLETED'\s+ELSE progress\.provider_status\s+END AS provider_status/u,
    );
    expect(query).toMatch(
      /CASE\s+WHEN barrier\.attempt_id IS NOT NULL THEN attempt\.item_count\s+ELSE progress\.items_total\s+END AS items_total/u,
    );
    expect(query).toContain("attempt.state");
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { NATURAL_DOCUMENTARY_STYLE_PROFILE_HASH } from "@videoforge/pipeline";
import type { CloudComputeSnapshot, ProjectApiCost } from "../../lib/cloud-compute";

const continuationWatchdog = vi.hoisted(() => ({ ensure: vi.fn(async () => false) }));
vi.mock("./pair-observer-guard", () => ({
  ensureHostedContinuationDriver: continuationWatchdog.ensure,
}));

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
  const approvedDownloadRows: Record<string, unknown>[] = [];
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
  const preflightAvatarRows: Record<string, unknown>[] = [];
  const qualifiedAvatarRows: Record<string, unknown>[] = [];
  const presetAvatarRows: Record<string, unknown>[] = [];
  const runtimeSourceRows: Record<string, unknown>[] = [];
  const workerDeviceRows: Record<string, unknown>[] = [];
  const cleanup = { pending: false };
  const cloudReadiness = { allowed: true };
  const query = vi.fn(async (sql: string, params?: readonly unknown[]) => {
    if (sql.includes("videoforge_cloud_media_new_project_ready"))
      return { rows: [cloudReadiness], affectedRows: 1 };
    if (sql.includes("FROM cloud_media_reservations r") && sql.includes("AS pending"))
      return { rows: [cleanup], affectedRows: 1 };
    void params;
    if (sql.includes("videoforge_consume_hosted_rate_limit"))
      return { rows: rateLimitRows, affectedRows: 1 };
    if (sql.includes("videoforge_hosted_session_scope"))
      return { rows: scopeRows, affectedRows: 1 };
    if (
      sql.includes(
        "SELECT authority.object_key, authority.issued_content_length AS content_length",
      ) &&
      sql.includes("FROM projects AS project")
    )
      return { rows: approvedDownloadRows, affectedRows: approvedDownloadRows.length };
    // The picker's "which avatar can this workspace actually dispatch" lookup. It also selects the
    // canonical key, so it has to be routed before the pinned-avatar branch below.
    if (sql.includes("SELECT profile.name"))
      return { rows: qualifiedAvatarRows, affectedRows: qualifiedAvatarRows.length };
    if (
      sql.includes("runtime_source.object_key") &&
      sql.includes("FROM avatar_profiles AS profile")
    ) {
      return { rows: preflightAvatarRows, affectedRows: preflightAvatarRows.length };
    }
    // The create path's own runtime-source read (preflight is a browser convenience, not the guard).
    if (
      sql.includes("FROM avatar_profile_versions AS version") &&
      sql.includes("LEFT JOIN assets AS runtime_source")
    )
      return { rows: runtimeSourceRows, affectedRows: runtimeSourceRows.length };
    if (sql.includes("version.runtime_source_binary_sha256"))
      return { rows: presetAvatarRows, affectedRows: presetAvatarRows.length };
    if (sql.includes("FROM media_worker_devices"))
      return { rows: workerDeviceRows, affectedRows: workerDeviceRows.length };
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
    cleanup,
    cloudReadiness,
    scopeRows,
    projectRows,
    projectDetailAttemptRows,
    approvedDownloadRows,
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
    preflightAvatarRows,
    qualifiedAvatarRows,
    presetAvatarRows,
    runtimeSourceRows,
    workerDeviceRows,
    query,
    pool,
    executor,
  };
});

describe("completed final MP4 download", () => {
  const path = `/api/v2/hosted/projects/${PROJECT_ID}/download`;
  const bytes = new TextEncoder().encode("fixture-mp4-bytes");
  const checksum = `sha256:${"a".repeat(64)}`;
  const key = `tenant/owned/workspace/owned/project/${PROJECT_ID}/revision/owned/lane/render/job/owned/artifact/final-mp4`;

  it.each([
    [null, "videoforge-output.mp4"],
    ["UK's Boat.MP3", "UK's Boat.mp4"],
    ["episode.final.wav", "episode.final.mp4"],
    ["Café – 你好.mp3", "Café – 你好.mp4"],
    ["na\r\nme.mp3", "na__me.mp4"],
  ])(
    "downloads the completed MP4 using saved voiceover filename %s",
    async (sourceFilename, filename) => {
      testState.approvedDownloadRows.push({
        object_key: key,
        content_length: bytes.length,
        checksum_sha256: checksum,
        voiceover_filename: sourceFilename,
      });
      const digest = Uint8Array.from(Buffer.from("a".repeat(64), "hex")).buffer;
      const head = vi.fn(async () => ({
        size: bytes.length,
        httpMetadata: { contentType: "video/mp4" },
        checksums: { sha256: digest },
      }));
      const get = vi.fn(async () => ({
        size: bytes.length,
        httpMetadata: { contentType: "video/mp4" },
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(bytes);
            controller.close();
          },
        }),
      }));
      try {
        const result = await handleHostedProductRequest(
          request(path, "GET"),
          { PRIVATE_ARTIFACTS: { head, get } } as unknown as HostedRuntimeEnvironment,
          config,
          executionContext,
        );
        expect(result?.status).toBe(200);
        const disposition = result?.headers.get("content-disposition");
        if (sourceFilename === "Café – 你好.mp3") {
          expect(disposition).toContain(`filename*=UTF-8''${encodeURIComponent(filename!)}`);
        } else {
          expect(disposition).toBe(`attachment; filename="${filename}"`);
        }
        expect(result?.headers.get("content-length")).toBe(String(bytes.length));
        expect(result?.headers.get("x-videoforge-artifact-sha256")).toBe(checksum);
        expect(Array.from(new Uint8Array(await result!.arrayBuffer()))).toEqual(Array.from(bytes));
        expect(head).toHaveBeenCalledWith(key);
        expect(get).toHaveBeenCalledWith(key, undefined);
        const query = testState.query.mock.calls.find(([sql]) =>
          String(sql).includes(
            "SELECT authority.object_key, authority.issued_content_length AS content_length",
          ),
        );
        expect(String(query?.[0])).toContain(
          "attempt.result_checksum_sha256 = authority.issued_checksum_sha256",
        );
        expect(String(query?.[0])).toContain("attempt.project_revision_id = revision.id");
        expect(String(query?.[0])).toContain(
          "voiceover.metadata->>'filename' AS voiceover_filename",
        );
        expect(String(query?.[0])).toContain("voiceover.id = revision.voiceover_asset_id");
        expect(String(query?.[0])).toContain("voiceover.account_id = revision.account_id");
        expect(String(query?.[0])).toContain("voiceover.workspace_id = revision.workspace_id");
        expect(String(query?.[0])).toContain("attempt.state = 'SUCCEEDED'");
        expect(String(query?.[0])).toContain(
          "attempt.result_object_key = result_document.object_key",
        );
      } finally {
        testState.approvedDownloadRows.length = 0;
      }
    },
  );

  it.each(["bytes=2-5", "bytes=-4"])(
    "serves seekable candidate preview on a stable authenticated URL: %s",
    async (range) => {
      const attemptId = "22222222-2222-4222-8222-222222222222";
      testState.approvedDownloadRows.push({
        object_key: key,
        content_length: bytes.length,
        checksum_sha256: checksum,
      });
      const digest = Uint8Array.from(Buffer.from("a".repeat(64), "hex")).buffer;
      const head = vi.fn(async () => ({
        size: bytes.length,
        httpMetadata: { contentType: "video/mp4" },
        checksums: { sha256: digest },
      }));
      const offset = range === "bytes=2-5" ? 2 : bytes.length - 4;
      const get = vi.fn(async () => ({
        size: bytes.length,
        httpMetadata: { contentType: "video/mp4" },
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(bytes.slice(offset, offset + 4));
            controller.close();
          },
        }),
      }));
      try {
        const req = request(
          `/api/v2/hosted/projects/${PROJECT_ID}/renders/${attemptId}/preview`,
          "GET",
        );
        req.headers.set("range", range);
        const result = await handleHostedProductRequest(
          req,
          { PRIVATE_ARTIFACTS: { head, get } } as unknown as HostedRuntimeEnvironment,
          config,
          executionContext,
        );
        expect(result?.status).toBe(206);
        expect(result?.headers.get("content-disposition")).toBe(
          'inline; filename="videoforge-output.mp4"',
        );
        expect(result?.headers.get("content-range")).toBe(
          `bytes ${offset}-${offset + 3}/${bytes.length}`,
        );
        expect(result?.headers.get("content-length")).toBe("4");
        expect(get).toHaveBeenCalledWith(key, { range: { offset, length: 4 } });
        expect(Array.from(new Uint8Array(await result!.arrayBuffer()))).toEqual(
          Array.from(bytes.slice(offset, offset + 4)),
        );
      } finally {
        testState.approvedDownloadRows.length = 0;
      }
    },
  );

  it("rejects an unsatisfiable range before reading media bytes", async () => {
    testState.approvedDownloadRows.push({
      object_key: key,
      content_length: bytes.length,
      checksum_sha256: checksum,
    });
    const digest = Uint8Array.from(Buffer.from("a".repeat(64), "hex")).buffer;
    const head = vi.fn(async () => ({
      size: bytes.length,
      httpMetadata: { contentType: "video/mp4" },
      checksums: { sha256: digest },
    }));
    const get = vi.fn();
    try {
      const req = request(path, "GET");
      req.headers.set("range", "bytes=999-1000");
      const result = await handleHostedProductRequest(
        req,
        { PRIVATE_ARTIFACTS: { head, get } } as unknown as HostedRuntimeEnvironment,
        config,
        executionContext,
      );
      expect(result?.status).toBe(416);
      expect(get).not.toHaveBeenCalled();
    } finally {
      testState.approvedDownloadRows.length = 0;
    }
  });

  it("does not read R2 without an approved current revision, and rejects wrong checksum", async () => {
    const head = vi.fn();
    const get = vi.fn();
    const bucket = { PRIVATE_ARTIFACTS: { head, get } } as unknown as HostedRuntimeEnvironment;
    const absent = await handleHostedProductRequest(
      request(path, "GET"),
      bucket,
      config,
      executionContext,
    );
    expect(absent?.status).toBe(404);
    expect(head).not.toHaveBeenCalled();
    testState.approvedDownloadRows.push({
      object_key: key,
      content_length: bytes.length,
      checksum_sha256: checksum,
    });
    head.mockResolvedValue({
      size: bytes.length,
      httpMetadata: { contentType: "video/mp4" },
      checksums: { sha256: new Uint8Array(32).buffer },
    });
    try {
      const mismatch = await handleHostedProductRequest(
        request(path, "GET"),
        bucket,
        config,
        executionContext,
      );
      expect(mismatch?.status).toBe(503);
      expect(get).not.toHaveBeenCalled();
    } finally {
      testState.approvedDownloadRows.length = 0;
    }
  });
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
  hostedApiRemainingTimeEstimate,
  hostedAvatarConflictProblem,
  hostedGpuProductState,
  hostedProjectConflictProblem,
  hostedPromptWritingState,
  hostedPromptProgressForCapacityHold,
  hostedPromptRecoveryDisposition,
  hostedStyleConflictProblem,
  HOSTED_LEGACY_QUALIFIED_SOULX_SYSTEM_PROFILE_ID,
  recentFullRenderDurationMs,
  verifyHostedPreviewChecksum,
} from "./product";
import { handleHostedPromptRequest } from "./hosted-prompt-route";

const ORIGIN = "https://hosted.example.test";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

it("estimates remaining API work from live counts while image and avatar lanes run together", () => {
  const input = {
    durationMs: 159_200,
    promptTotal: 28,
    promptAccepted: 28,
    promptComplete: true,
    promptStartedAt: null,
    spanTotal: 10,
    spanReady: 10,
    spanStartedAt: null,
    imageTotal: 28,
    imageAccepted: 20,
    imageSubmittedAt: "2026-09-25T00:00:00.000Z",
    avatarTotal: 10,
    avatarAccepted: 6,
    avatarSubmittedAt: "2026-09-25T00:00:00.000Z",
    renderSubmittedAt: null,
    renderComplete: false,
    failed: false,
    nowMs: Date.parse("2026-09-25T00:02:40.000Z"),
  };
  const estimate = hostedApiRemainingTimeEstimate(input);
  expect(estimate).toMatchObject({ basis: "RECENT_API_SHORT_RUN", overrun: false });
  // Live avatar rate leaves about 107s; serializing both lanes would add another 64s.
  expect(estimate?.remaining_min_ms).toBe(494_000);
  expect(estimate?.remaining_max_ms).toBe(964_000);
  const earlyBatch = hostedApiRemainingTimeEstimate({
    ...input,
    imageAccepted: 2,
    avatarAccepted: 0,
    nowMs: Date.parse("2026-09-25T00:00:45.000Z"),
  });
  // Two early completions from a parallel batch must not imply 26 serial 22.5s calls.
  expect(earlyBatch?.remaining_max_ms).toBeLessThan(1_100_000);
  expect(hostedApiRemainingTimeEstimate({ ...input, failed: true })).toBeNull();
  expect(hostedApiRemainingTimeEstimate({ ...input, durationMs: 0 })).toBeNull();
  expect(
    hostedApiRemainingTimeEstimate({
      ...input,
      imageAccepted: 28,
      avatarAccepted: 10,
      renderSubmittedAt: "2026-09-25T00:00:00.000Z",
      nowMs: Date.parse("2026-09-25T00:15:00.000Z"),
    })?.overrun,
  ).toBe(true);
});
it("uses observed prompt throughput early in a long run", () => {
  const input = {
    durationMs: 159_200,
    promptTotal: 327,
    promptAccepted: 37,
    promptComplete: false,
    promptStartedAt: "2026-09-25T00:00:00.000Z",
    spanTotal: 0,
    spanReady: 0,
    spanStartedAt: null,
    imageTotal: 0,
    imageAccepted: 0,
    imageSubmittedAt: null,
    avatarTotal: 0,
    avatarAccepted: 0,
    avatarSubmittedAt: null,
    renderSubmittedAt: null,
    renderComplete: false,
    failed: false,
    nowMs: Date.parse("2026-09-25T00:06:00.000Z"),
  };
  const observed = hostedApiRemainingTimeEstimate(input);
  const referenceOnly = hostedApiRemainingTimeEstimate({ ...input, promptStartedAt: null });
  expect(observed!.remaining_min_ms).toBeGreaterThan(referenceOnly!.remaining_min_ms + 1_000_000);
});

it("does not extrapolate a short render for a long video without a measured full render", () => {
  const estimate = hostedApiRemainingTimeEstimate({
    durationMs: 1_667_333,
    promptTotal: 327,
    promptAccepted: 327,
    promptComplete: true,
    promptStartedAt: null,
    spanTotal: 96,
    spanReady: 96,
    spanStartedAt: null,
    imageTotal: 327,
    imageAccepted: 327,
    imageSubmittedAt: null,
    avatarTotal: 96,
    avatarAccepted: 96,
    avatarSubmittedAt: null,
    renderSubmittedAt: "2026-09-25T17:47:25.000Z",
    renderComplete: false,
    failed: false,
    nowMs: Date.parse("2026-09-25T18:02:25.000Z"),
  });
  expect(estimate).toBeNull();
});

it("uses the recent full render as the long-video ETA reference", () => {
  const referenceMs = recentFullRenderDurationMs([
    {
      kind: "RENDER",
      state: "FAILED",
      error_code: "RENDER_INPUT_INVALID",
      submitted_at: "2026-09-25T15:28:00.000Z",
      terminal_at: "2026-09-25T15:35:26.000Z",
    },
    {
      kind: "RENDER",
      state: "FAILED",
      error_code: "RENDER_OUTPUT_INVALID",
      submitted_at: "2026-09-25T16:58:00.000Z",
      terminal_at: "2026-09-25T17:24:00.000Z",
    },
  ]);
  expect(referenceMs).toBe(1_560_000);
  const estimate = hostedApiRemainingTimeEstimate({
    durationMs: 1_667_333,
    promptTotal: 327,
    promptAccepted: 327,
    promptComplete: true,
    promptStartedAt: null,
    spanTotal: 96,
    spanReady: 96,
    spanStartedAt: null,
    imageTotal: 327,
    imageAccepted: 327,
    imageSubmittedAt: null,
    avatarTotal: 96,
    avatarAccepted: 96,
    avatarSubmittedAt: null,
    renderSubmittedAt: "2026-09-25T17:47:25.000Z",
    renderReferenceMs: referenceMs,
    renderComplete: false,
    failed: false,
    nowMs: Date.parse("2026-09-25T18:02:25.000Z"),
  });
  expect(estimate).toMatchObject({ basis: "RECENT_FULL_RENDER", overrun: false });
  expect(estimate?.remaining_min_ms).toBe(348_000);
  expect(estimate?.remaining_max_ms).toBe(972_000);
});

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

  it("refuses a project pinned to a pass-through avatar before any reservation", async () => {
    const passThroughKey =
      "tenant/38ae8aaf-09d8-bdab-7436-385eb2fcb7ac" +
      "/workspace/78c40d01-f7af-bae1-1922-6b458da10625" +
      `/avatar-profile/44444444-4444-4444-8444-444444444444/version/${PRESET_ID}/original/source`;
    testState.publishedStyleRows.push({
      style_id: "66666666-6666-4666-8666-666666666666",
      version_id: createBody.image_style_version_id,
      style_profile_hash: `sha256:${"c".repeat(64)}`,
      scope_kind: "WORKSPACE",
    });
    testState.presetAvatarRows.push({
      profile_id: "44444444-4444-4444-8444-444444444444",
      profile_name: "helen",
      version_id: PRESET_ID,
      scope_kind: "WORKSPACE",
      profile_hash: `sha256:${"d".repeat(64)}`,
      runtime_source_asset_id: "55555555-5555-4555-8555-555555555555",
      runtime_source_binary_sha256: `sha256:${"e".repeat(64)}`,
      source_preparation_profile: "hosted-avatar-source-pass-through-v1",
      source_validation_profile: "hosted-avatar-source-validation-v1",
    });
    testState.runtimeSourceRows.push({
      source_preparation_profile: "hosted-avatar-source-pass-through-v1",
      object_key: passThroughKey,
    });
    try {
      const result = await handleHostedProductRequest(
        request("/api/v2/hosted/projects", "POST", createBody, true, {
          "idempotency-key": "hosted-project-avatar-guard-0001",
        }),
        createEnvironment,
        config,
        executionContext,
      );
      expect(result?.status).toBe(409);
      await expect(result?.json()).resolves.toMatchObject({
        error: {
          code: "AVATAR_RUNTIME_SOURCE_NOT_QUALIFIED",
          message:
            "Avatar video can only be generated from the approved avatar source, and this workspace has no such avatar yet.",
        },
      });
    } finally {
      testState.publishedStyleRows.length = 0;
      testState.presetAvatarRows.length = 0;
      testState.runtimeSourceRows.length = 0;
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
    expect(await result!.json()).not.toHaveProperty("default_image_style_version_id");
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

  it("retires the legacy blank SoulX profile from the shared catalog without deleting it", async () => {
    testState.query.mockClear();

    const result = await handleHostedProductRequest(
      request("/api/v2/hosted/project-catalog", "GET"),
      environment,
      stagingConfig,
      executionContext,
    );

    expect(result?.status).toBe(200);
    const avatarCatalogCall = testState.query.mock.calls.find(
      ([sql]) =>
        String(sql).includes("FROM avatar_profiles AS profile") &&
        String(sql).includes("version.state = 'READY'"),
    );
    expect(avatarCatalogCall).toBeDefined();
    expect(String(avatarCatalogCall?.[0])).toContain("profile.scope_kind = 'SYSTEM'");
    expect(String(avatarCatalogCall?.[0])).toContain("profile.id = $3");
    expect(avatarCatalogCall?.[1]).toEqual([
      testState.scopeRows[0]?.account_id,
      testState.scopeRows[0]?.workspace_id,
      HOSTED_LEGACY_QUALIFIED_SOULX_SYSTEM_PROFILE_ID,
    ]);
    expect(
      testState.query.mock.calls.some(([sql]) =>
        String(sql).includes("DELETE FROM avatar_profiles"),
      ),
    ).toBe(false);
  });

  it.each([
    ["published system default", {}, true],
    ["workspace copy", { scope_kind: "WORKSPACE" }, false],
    ["unpublished version", { state: "DRAFT" }, false],
    ["archived parent", { status: "ARCHIVED" }, false],
    ["different parent", { style_id: "11111111-1111-4111-8111-111111111111" }, false],
    ["different version", { version_id: "22222222-2222-4222-8222-222222222222" }, false],
    ["different profile hash", { style_profile_hash: "sha256:unexpected" }, false],
  ])("exposes the explicit catalog default only for the %s", async (_name, overrides, expected) => {
    const versionId = "ffffffff-ffff-4fff-8fff-000000000032";
    testState.publishedStyleRows.push({
      style_id: "ffffffff-ffff-4fff-8fff-000000000031",
      version_id: versionId,
      name: "Natural Documentary",
      version_number: 1,
      state: "PUBLISHED",
      status: "ACTIVE",
      scope_kind: "SYSTEM",
      style_profile_hash: NATURAL_DOCUMENTARY_STYLE_PROFILE_HASH,
      ...overrides,
    });
    try {
      const result = await handleHostedProductRequest(
        request("/api/v2/hosted/project-catalog", "GET"),
        environment,
        stagingConfig,
        executionContext,
      );
      expect(result?.status).toBe(200);
      const body = (await result!.json()) as Record<string, unknown>;
      expect(body.default_image_style_version_id).toBe(expected ? versionId : undefined);
    } finally {
      testState.publishedStyleRows.length = 0;
    }
  });

  it.each([4 * 1024 ** 3, 1024 ** 3, null])(
    "checks capacity before explicit ASR retry: %s",
    async (capacity) => {
      testState.workerDeviceRows.push({
        status: "ONLINE",
        count: 1,
        available_disk_bytes: capacity,
      });
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
        content_length: 320_000,
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
        if (capacity === null || capacity < 2 * 1024 ** 3 + 640_000) {
          expect(result?.status).toBe(409);
          expect(await result?.json()).toMatchObject({
            error: { code: "MEDIA_EXECUTION_DISK_SPACE_INSUFFICIENT" },
          });
          return;
        }
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
        const commitEnd = source.indexOf(
          "/**\n * Advance the ordinary product journey",
          commitStart,
        );
        const commit = source.slice(commitStart, commitEnd);
        expect(commit).toContain("hostedAsrSubmissionIdentity(projectId, revisionId, 1)");
      } finally {
        testState.projectRows[0] = previousProject!;
        testState.workerDeviceRows.pop();
      }
    },
  );

  it("keeps the hand-off open when every failed attempt was a local resource failure", async () => {
    // A project whose transcriptions all failed because the owner's own computer ran out of disk is
    // recoverable on that machine, so those attempts must not spend the bounded retry budget: the
    // state row reports them in asr_total_attempt_count only.
    testState.workerDeviceRows.push({
      status: "ONLINE",
      count: 1,
      available_disk_bytes: 4 * 1024 ** 3,
    });
    const previousProject = testState.projectRows[0];
    testState.projectRows[0] = {
      revision_id: "22222222-2222-4222-8222-222222222222",
      revision_number: 2,
      voiceover_asset_id: "33333333-3333-4333-8333-333333333333",
      checksum_sha256: `sha256:${"a".repeat(64)}`,
      content_type: "audio/mpeg",
      duration_ms: 159_216,
      receipt_id: "44444444-4444-4444-8444-444444444444",
      content_length: 320_000,
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
      const body = (await result?.json()) as {
        cpu_submission: { input_document: { attempt_id: string } };
      };
      // The identity still advances with the total, so the fourth attempt cannot collide with the third.
      expect(body.cpu_submission.input_document.attempt_id).toBe(
        hostedAsrSubmissionIdentity(PROJECT_ID, "22222222-2222-4222-8222-222222222222", 4)
          .attemptId,
      );
    } finally {
      testState.projectRows[0] = previousProject!;
      testState.workerDeviceRows.pop();
    }
  });

  it("refuses the hand-off once the total attempt ceiling is reached", async () => {
    testState.workerDeviceRows.push({
      status: "ONLINE",
      count: 1,
      available_disk_bytes: 4 * 1024 ** 3,
    });
    const previousProject = testState.projectRows[0];
    testState.projectRows[0] = {
      revision_id: "22222222-2222-4222-8222-222222222222",
      revision_number: 2,
      voiceover_asset_id: "33333333-3333-4333-8333-333333333333",
      checksum_sha256: `sha256:${"a".repeat(64)}`,
      content_type: "audio/mpeg",
      duration_ms: 159_216,
      receipt_id: "44444444-4444-4444-8444-444444444444",
      content_length: 320_000,
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
      testState.workerDeviceRows.pop();
    }
  });

  it("permits a fresh ASR identity after an older execution bundle's invalid output", async () => {
    testState.workerDeviceRows.push({
      status: "ONLINE",
      count: 1,
      available_disk_bytes: 4 * 1024 ** 3,
    });
    const previousProject = testState.projectRows[0];
    testState.projectRows[0] = {
      revision_id: "22222222-2222-4222-8222-222222222222",
      revision_number: 2,
      voiceover_asset_id: "33333333-3333-4333-8333-333333333333",
      checksum_sha256: `sha256:${"a".repeat(64)}`,
      content_type: "audio/mpeg",
      duration_ms: 159_216,
      receipt_id: "44444444-4444-4444-8444-444444444444",
      content_length: 320_000,
      asr_attempt_count: 0,
      asr_total_attempt_count: 3,
      latest_asr_state: "FAILED",
    };
    testState.query.mockClear();
    try {
      const result = await handleHostedProductRequest(
        request(`/api/v2/hosted/projects/${PROJECT_ID}/asr`),
        environment,
        stagingConfig,
        executionContext,
      );
      expect(result?.status).toBe(202);
      const body = (await result?.json()) as {
        cpu_submission: { input_document: { attempt_id: string } };
      };
      expect(body.cpu_submission.input_document.attempt_id).toBe(
        hostedAsrSubmissionIdentity(PROJECT_ID, "22222222-2222-4222-8222-222222222222", 4)
          .attemptId,
      );
      const stateQuery = testState.query.mock.calls.find(([sql]) =>
        String(sql).includes("AS asr_attempt_count"),
      );
      expect(stateQuery?.[1]).toEqual([
        testState.scopeRows[0]?.account_id,
        testState.scopeRows[0]?.workspace_id,
        PROJECT_ID,
        stagingConfig.mediaWorkerRelease.executionBundleSha256,
      ]);
      expect(String(stateQuery?.[0])).toContain("lease.failure_code = 'ASR_OUTPUT_INVALID'");
      expect(String(stateQuery?.[0])).toContain("attempt.execution_bundle_sha256 <> $4");
    } finally {
      testState.projectRows[0] = previousProject!;
      testState.workerDeviceRows.pop();
    }
  });

  it("refuses the hand-off once the voiceover itself failed the bounded number of times", async () => {
    testState.workerDeviceRows.push({
      status: "ONLINE",
      count: 1,
      available_disk_bytes: 4 * 1024 ** 3,
    });
    const previousProject = testState.projectRows[0];
    testState.projectRows[0] = {
      revision_id: "22222222-2222-4222-8222-222222222222",
      revision_number: 2,
      voiceover_asset_id: "33333333-3333-4333-8333-333333333333",
      checksum_sha256: `sha256:${"a".repeat(64)}`,
      content_type: "audio/mpeg",
      duration_ms: 159_216,
      receipt_id: "44444444-4444-4444-8444-444444444444",
      content_length: 320_000,
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
      testState.workerDeviceRows.pop();
    }
  });

  it("returns not found before detail queries when no locked active project exists", async () => {
    const previous = [...testState.projectRows];
    testState.projectRows.splice(0);
    testState.query.mockClear();
    try {
      const result = await handleHostedProductRequest(
        request(`/api/v2/hosted/projects/${PROJECT_ID}`, "GET"),
        environment,
        stagingConfig,
        executionContext,
      );
      expect(result?.status).toBe(404);
      const failedTasks = testState.query.mock.calls.find(([sql]) =>
        String(sql).includes(
          "SELECT task.id, task.task_key, task.lane, task.state, task.updated_at",
        ),
      );
      expect(failedTasks).toBeUndefined();
    } finally {
      testState.projectRows.push(...previous);
    }
  });

  it("exposes scoped rental facts and all-API costs without exposing provider rental identities", async () => {
    const original = testState.query.getMockImplementation()!;
    testState.query.mockClear();
    testState.query.mockImplementation(async (sql, params) => {
      if (sql.includes("FROM cloud_media_reservations r") && sql.includes("r.actual_hourly_usd"))
        return {
          rows: [
            {
              id: "33333333-3333-4333-8333-333333333333",
              leased_attempt_id: "44444444-4444-4444-8444-444444444444",
              fence_id: "fence",
              gpu: "RTX 4090",
              actual_hourly_usd: "0.8",
              launch_outcome: "CONFIRMED",
              state: "CLEAN",
              verified_at: "2026-10-05T09:00:00Z",
              cleanup_verified_at: "2026-10-05T09:15:00Z",
              observed_at: "2026-10-05T10:00:00Z",
              pod_id: "private-provider-id",
              pod_name: "private-provider-name",
            },
          ],
          affectedRows: 1,
        };
      if (sql.includes("project_prompt_cost AS ("))
        return {
          rows: [{ label: "Generated images", usd: "1.16", unconfirmed: false, estimated: true }],
          affectedRows: 1,
        };
      return original(sql, params);
    });
    try {
      const result = await handleHostedProductRequest(
        request(`/api/v2/hosted/projects/${PROJECT_ID}`, "GET"),
        environment,
        stagingConfig,
        executionContext,
      );
      expect(result?.status).toBe(200);
      const body = (await result!.json()) as {
        cost: { api_cost_so_far: ProjectApiCost; cloud_compute: CloudComputeSnapshot };
      };
      expect(body.cost.api_cost_so_far).toMatchObject({
        usd: 1.16,
        unconfirmed: false,
        estimated: true,
      });
      expect(body.cost.cloud_compute.rentals).toEqual([
        {
          id: "33333333-3333-4333-8333-333333333333",
          machine: "RTX 4090",
          hourly_usd: 0.8,
          started_at: "2026-10-05T09:00:00.000Z",
          stopped_at: "2026-10-05T09:15:00.000Z",
          status: "STOPPED",
        },
      ]);
      expect(JSON.stringify(body.cost)).not.toContain("private-provider");
      for (const [sql, params] of testState.query.mock.calls.filter(
        ([sql]) => sql.includes("r.actual_hourly_usd") || sql.includes("project_prompt_cost AS ("),
      )) {
        expect(sql).toContain("account_id=$1");
        expect(sql).toContain("workspace_id=$2");
        expect(params).toEqual([
          testState.scopeRows[0]!.account_id,
          testState.scopeRows[0]!.workspace_id,
          PROJECT_ID,
        ]);
      }
    } finally {
      testState.query.mockImplementation(original);
    }
  });

  it("explains rejected image text in stage detail", async () => {
    const original = testState.query.getMockImplementation()!;
    const previous = testState.projectRows[0]!;
    testState.projectRows[0] = { ...previous, generation_provider: "KIE_FAL" };
    testState.query.mockImplementation(async (sql, params) => {
      if (sql.includes("SELECT lane,state,created_at,submitted_at,completed_at"))
        return {
          rows: [{ lane: "IMAGE", state: "FAILED", failure_code: "IMAGE_TEXT_QA_REJECTED" }],
          affectedRows: 1,
        };
      return original(sql, params);
    });
    try {
      const response = await handleHostedProductRequest(
        request(`/api/v2/hosted/projects/${PROJECT_ID}`, "GET"),
        environment,
        stagingConfig,
        executionContext,
      );
      const body = (await response!.json()) as { stages: Array<{ id: string; detail: string }> };
      expect(body.stages.find((stage) => stage.id === "image-generation")?.detail).toBe(
        "An image contained text and was blocked. No automatic regeneration was charged.",
      );
    } finally {
      testState.projectRows[0] = previous;
      testState.query.mockImplementation(original);
    }
  });

  it("exposes sent and waiting API counts before any avatar output, preserving historical response shape", async () => {
    const original = testState.query.getMockImplementation()!;
    const previousProject = testState.projectRows[0]!;
    const submittedAt = "2026-10-02T16:17:41.534Z";
    const jobs = [
      ...Array.from({ length: 34 }, () => ({
        lane: "IMAGE",
        state: "SUCCEEDED",
        submitted_at: submittedAt,
      })),
      ...Array.from({ length: 4 }, () => ({
        lane: "AVATAR",
        state: "SUBMITTED",
        submitted_at: submittedAt,
      })),
      ...Array.from({ length: 8 }, () => ({
        lane: "AVATAR",
        state: "PREPARED",
        submitted_at: null,
      })),
    ];
    testState.projectRows[0] = { ...previousProject, generation_provider: "KIE_FAL" };
    testState.query.mockImplementation(async (sql, params) => {
      if (sql.includes("SELECT lane,state,created_at,submitted_at,completed_at"))
        return { rows: jobs, affectedRows: jobs.length };
      return original(sql, params);
    });
    const read = async () => {
      const result = await handleHostedProductRequest(
        request(`/api/v2/hosted/projects/${PROJECT_ID}`, "GET"),
        environment,
        stagingConfig,
        executionContext,
      );
      expect(result?.status).toBe(200);
      return (await result!.json()) as { gpu_lanes: Array<Record<string, unknown>> };
    };
    try {
      const pending = await read();
      expect(pending.gpu_lanes.find((lane) => lane.lane === "soulx_avatar")).toMatchObject({
        attempt_state: "IN_PROGRESS",
        accepted_item_count: 0,
        submitted_at: submittedAt,
        provider_pending_item_count: 4,
        waiting_to_submit_item_count: 8,
        submitting_item_count: 0,
        provider_status: null,
      });
      expect(pending.gpu_lanes.find((lane) => lane.lane === "mage_image")).toMatchObject({
        provider_pending_item_count: 0,
        waiting_to_submit_item_count: 0,
        submitting_item_count: 0,
      });
      jobs[38]!.state = "SUBMITTING";
      expect((await read()).gpu_lanes.find((lane) => lane.lane === "soulx_avatar")).toMatchObject({
        provider_pending_item_count: 4,
        waiting_to_submit_item_count: 7,
        submitting_item_count: 1,
      });
      testState.projectRows[0] = { ...previousProject, generation_provider: "RUNPOD" };
      for (const lane of (await read()).gpu_lanes) {
        expect(lane).not.toHaveProperty("provider_pending_item_count");
        expect(lane).not.toHaveProperty("waiting_to_submit_item_count");
        expect(lane).not.toHaveProperty("submitting_item_count");
      }
    } finally {
      testState.projectRows[0] = previousProject;
      testState.query.mockImplementation(original);
    }
  });

  it.each([false, true])(
    "projects waiting admission truthfully and preserves saved spans (cleanup=%s)",
    async (pending) => {
      const original = testState.query.getMockImplementation()!;
      let saved = false;
      testState.cleanup.pending = pending;
      testState.query.mockImplementation(async (sql, params) => {
        if (sql.includes("AS prompt_task_state"))
          return { rows: [{ id: PROJECT_ID, prompt_task_state: "COMPLETE" }], affectedRows: 1 };
        if (sql.includes("SELECT request.id, request.state, request.queue_order"))
          return { rows: [{ state: "WAITING", ahead: 2, total: 3 }], affectedRows: 1 };
        if (saved && sql.includes("FROM selected_span_audio AS span"))
          return { rows: [{ state: "MATERIALIZED", total: 1 }], affectedRows: 1 };
        if (saved && sql.includes("SELECT job.state, count(*)::int AS total"))
          return {
            rows: [
              {
                state: "SUCCEEDED",
                total: 1,
                started_at: "2026-10-01T12:00:00Z",
                completed_at: "2026-10-01T12:00:01Z",
              },
            ],
            affectedRows: 1,
          };
        return original(sql, params);
      });
      const detail = async () =>
        (await (await handleHostedProductRequest(
          request(`/api/v2/hosted/projects/${PROJECT_ID}`, "GET"),
          environment,
          stagingConfig,
          executionContext,
        ))!.json()) as {
          stages: { id: string; status: string; detail: string }[];
          queue: { blocked_reason: string | null };
        };
      try {
        const waiting = await detail();
        expect(waiting.stages.find((stage) => stage.id === "audio-spanning")).toMatchObject({
          status: pending ? "BLOCKED" : "QUEUED",
        });
        expect(waiting.queue.blocked_reason).toBe(pending ? "HOSTED_CLOUD_CLEANUP_PENDING" : null);
        saved = true;
        const retained = await detail();
        expect(retained.stages.find((stage) => stage.id === "audio-spanning")).toMatchObject({
          status: "COMPLETE",
        });
      } finally {
        testState.query.mockImplementation(original);
        testState.cleanup.pending = false;
      }
    },
  );

  it("reports a failed Cloud audio save without inventing provider failure or local retries", async () => {
    const previous = testState.projectRows[0]!;
    const original = testState.query.getMockImplementation()!;
    testState.projectRows[0] = {
      ...previous,
      generation_provider: "KIE_FAL",
      media_execution_backend: "RUNPOD_POD",
    };
    testState.query.mockImplementation(async (sql, params) => {
      if (sql.includes("SELECT job.state, count(*)::int AS total")) {
        expect(sql).toContain("job.execution_backend = 'PERSONAL_WORKER'");
        return {
          rows: [
            {
              state: "FAILED",
              total: 1,
              retryable: 0,
              started_at: "2026-10-03T07:12:43Z",
              completed_at: "2026-10-03T07:12:59Z",
            },
            {
              state: "CANCELLED",
              total: 55,
              started_at: null,
              completed_at: "2026-10-03T07:12:59Z",
            },
            {
              state: "SUCCEEDED",
              total: 15,
              started_at: "2026-10-03T07:05:00Z",
              completed_at: "2026-10-03T07:12:00Z",
            },
          ],
          affectedRows: 3,
        };
      }
      if (sql.includes("COALESCE(job.failure_code, lease.failure_code) AS failure_code"))
        return { rows: [{ failure_code: "CLOUD_MEDIA_UPLOAD_FAILED" }], affectedRows: 1 };
      if (sql.includes("FROM selected_span_audio AS span"))
        return {
          rows: [
            { state: "MATERIALIZED", total: 15 },
            { state: "PLANNED", total: 56 },
          ],
          affectedRows: 2,
        };
      if (sql.includes("SELECT runtime.id, runtime.stage"))
        return {
          rows: [
            {
              stage: "FAILED",
              terminal_reason: "LANE_PERMANENT_FAILURE",
              lanes: [
                {
                  lane: "mage_image",
                  state: "FAILED",
                  planned_item_count: 227,
                  accepted_item_count: 0,
                },
                {
                  lane: "soulx_avatar",
                  state: "FAILED",
                  planned_item_count: 71,
                  accepted_item_count: 0,
                },
              ],
            },
          ],
          affectedRows: 1,
        };
      return original(sql, params);
    });
    try {
      const result = await handleHostedProductRequest(
        request(`/api/v2/hosted/projects/${PROJECT_ID}`, "GET"),
        environment,
        stagingConfig,
        executionContext,
      );
      const body = (await result!.json()) as {
        stages: { id: string; status: string; detail: string }[];
        span_audio: Record<string, unknown>;
        gpu_lanes: Record<string, unknown>[];
      };
      expect(body.span_audio).toMatchObject({
        failed: 1,
        retrying: 0,
        materialized: 15,
        failure_code: "CLOUD_MEDIA_UPLOAD_FAILED",
        completed_at: "2026-10-03T07:12:59.000Z",
      });
      expect(body.stages.find((s) => s.id === "audio-spanning")).toMatchObject({
        status: "FAILED",
      });
      for (const id of ["image-generation", "avatar-generation"])
        expect(body.stages.find((s) => s.id === id)).toMatchObject({ status: "BLOCKED" });
      expect(body.stages.find((s) => s.id === "image-generation")?.detail).toContain(
        "have not been submitted",
      );
      expect(body.gpu_lanes.every((l) => l.runtime_state === "BLOCKED")).toBe(true);
    } finally {
      testState.projectRows[0] = previous;
      testState.query.mockImplementation(original);
    }
  });

  it.each([
    ["OPENING_180_V3", "SUCCEEDED", "COMPLETE"],
    ["OPENING_180_V3", "MANIFEST_DURABLE", "WAITING"],
    ["WHOLE_SCENE_V2", "SUCCEEDED", "WAITING"],
  ])(
    "completes zero-avatar audio only after its opening lane barrier (%s/%s)",
    async (policy, avatarState, audioStatus) => {
      const original = testState.query.getMockImplementation()!;
      const previousProject = testState.projectRows[0]!;
      testState.projectRows[0] = { ...previousProject, generation_provider: "KIE_FAL" };
      testState.query.mockImplementation(async (sql, params) => {
        if (
          sql.includes("FROM selected_span_audio AS span") ||
          sql.includes("SELECT job.state, count(*)::int AS total")
        )
          return { rows: [], affectedRows: 0 };
        if (sql.includes("SELECT runtime.id, runtime.stage"))
          return {
            rows: [
              {
                stage: "WAITING_FOR_WORKER",
                lanes: [
                  {
                    lane: "mage_image",
                    state: "SUCCEEDED",
                    planned_item_count: 38,
                    accepted_item_count: 38,
                  },
                  {
                    lane: "soulx_avatar",
                    state: avatarState,
                    planned_item_count: 0,
                    accepted_item_count: 0,
                  },
                ],
              },
            ],
            affectedRows: 1,
          };
        if (sql.includes("SELECT plan.id, plan.canonical_document_hash"))
          return {
            rows: [
              {
                final_frame_count: 5400,
                image_scene_count: 38,
                avatar_frame_count: 0,
                planned_tasks: 38,
                completed_tasks: 38,
                failed_tasks: 0,
              },
            ],
            affectedRows: 1,
          };
        if (sql.includes("FROM hosted_video_plans"))
          return {
            rows: [
              {
                replacement_policy: policy,
                coverage_percent: 0,
                planned_at: "2026-10-04T18:00:00Z",
                opening_frames: 5400,
                selections: [{ videoFrameCount: 60, durationSeconds: 2.1 }],
              },
            ],
            affectedRows: 1,
          };
        if (sql.includes("FROM hosted_video_jobs job"))
          return {
            rows: [
              {
                start_frame: 0,
                video_frame_count: 60,
                duration_seconds: 2.1,
                state: "SUBMITTED",
                submitted_at: "2026-10-04T18:01:00Z",
              },
            ],
            affectedRows: 1,
          };
        return original(sql, params);
      });
      try {
        const result = await handleHostedProductRequest(
          request(`/api/v2/hosted/projects/${PROJECT_ID}`, "GET"),
          environment,
          stagingConfig,
          executionContext,
        );
        expect(result?.status).toBe(200);
        const body = (await result!.json()) as {
          stages: Record<string, unknown>[];
          span_audio: Record<string, unknown>;
        };
        const audioStage = body.stages.find((stage) => stage.id === "audio-spanning");
        expect(audioStage).toMatchObject({
          status: audioStatus,
          started_at: null,
          completed_at: null,
        });
        expect(body.span_audio).toMatchObject({
          total: 0,
          materialized: 0,
          started_at: null,
          completed_at: null,
        });
        if (audioStatus === "COMPLETE") {
          expect(audioStage).toMatchObject({ progress_percent: 100 });
          expect(audioStage?.detail).toContain("no avatar segments");
          expect(body.stages.find((stage) => stage.id === "video-generation")).toMatchObject({
            status: "RUNNING",
          });
        }
      } finally {
        testState.projectRows[0] = previousProject;
        testState.query.mockImplementation(original);
      }
    },
  );

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
      expect(stage("review")).toBeUndefined();
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

  it("retires final approval without reading or mutating tenant data", async () => {
    testState.query.mockClear();
    const result = await handleHostedProductRequest(
      request(`/api/v2/hosted/projects/${PROJECT_ID}/review`, "POST", {
        attempt_id: "22222222-2222-4222-8222-222222222222",
      }),
      environment,
      config,
      executionContext,
    );
    expect(result?.status).toBe(410);
    await expect(errorCode(result)).resolves.toBe("APPROVAL_REMOVED");
    expect(testState.query).not.toHaveBeenCalled();
  });

  it("fails closed before tenant data access when the hosted rate limit is exhausted", async () => {
    testState.query.mockClear();
    testState.rateLimitRows[0]!.allowed = false;
    const candidate = request(`/api/v2/hosted/projects/${PROJECT_ID}/manifest`, "GET");
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

  it.each([
    [undefined, false, "MEDIA_WORKER_OFFLINE"],
    ["PERSONAL_WORKER", true, "MEDIA_WORKER_OFFLINE"],
    ["RUNPOD_POD", true, null],
    ["RUNPOD_POD", false, "CLOUD_MEDIA_UNAVAILABLE"],
  ])(
    "checks selected media backend %s without changing Local readiness",
    async (backend, enabled, blocker) => {
      const result = await handleHostedProductRequest(
        request("/api/v2/hosted/projects/preflight", "POST", {
          schema_version: "videoforge-hosted-project-preflight/v1",
          title: "Media backend project",
          avatar_profile_version_id: "22222222-2222-4222-8222-222222222222",
          image_style_version_id: "33333333-3333-4333-8333-333333333333",
          ...(backend ? { execution_backend: backend } : {}),
          voiceover: {
            filename: "voiceover.mp3",
            content_type: "audio/mpeg",
            content_length: 320_000,
            checksum_sha256: `sha256:${"a".repeat(64)}`,
            duration_ms: 20_000,
          },
        }),
        environment,
        { ...stagingConfig, cloudMedia: { enabled } } as HostedRuntimeConfiguration,
        executionContext,
      );
      expect(result?.status).toBe(200);
      const body = (await result!.json()) as {
        execution_backend: string;
        blockers: { code: string }[];
      };
      expect(body.execution_backend).toBe(backend ?? "PERSONAL_WORKER");
      const mediaBlockers = body.blockers.filter((item) =>
        ["MEDIA_WORKER_OFFLINE", "CLOUD_MEDIA_UNAVAILABLE"].includes(item.code),
      );
      expect(mediaBlockers.map((item) => item.code)).toEqual(blocker ? [blocker] : []);
    },
  );

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

  const preflightBody = {
    schema_version: "videoforge-hosted-project-preflight/v1",
    title: "Avatar source project",
    avatar_profile_version_id: "22222222-2222-4222-8222-222222222222",
    image_style_version_id: "33333333-3333-4333-8333-333333333333",
    voiceover: {
      filename: "voiceover.mp3",
      content_type: "audio/mpeg",
      content_length: 320_000,
      checksum_sha256: `sha256:${"a".repeat(64)}`,
      duration_ms: 20_000,
    },
  };
  type PreflightBlockerBody = {
    ok?: boolean;
    ready?: boolean;
    blockers?: readonly { code?: string; message?: string; severity?: string }[];
  };
  const blockingAvatarBlocker = (body: PreflightBlockerBody) =>
    (body.blockers ?? []).filter(
      (blocker) =>
        blocker.severity === "BLOCKING" && blocker.code === "AVATAR_RUNTIME_SOURCE_NOT_QUALIFIED",
    );

  it("blocks a pinned avatar version whose runtime source is a pass-through upload", async () => {
    testState.publishedStyleRows.push({});
    testState.workerDeviceRows.push({
      status: "ONLINE",
      count: "1",
      available_disk_bytes: 4 * 1024 ** 3,
    });
    testState.preflightAvatarRows.push({
      source_preparation_profile: "hosted-avatar-source-pass-through-v1",
      object_key:
        `tenant/${testState.scopeRows[0]?.account_id}/workspace/${testState.scopeRows[0]?.workspace_id}` +
        "/avatar-profile/77777777-7777-4777-8777-777777777777" +
        "/version/22222222-2222-4222-8222-222222222222/original/source",
    });
    try {
      const result = await handleHostedProductRequest(
        request("/api/v2/hosted/projects/preflight", "POST", preflightBody),
        environment,
        stagingConfig,
        executionContext,
      );
      expect(result?.status).toBe(200);
      const body = (await result?.json()) as PreflightBlockerBody;
      expect(body.ok).toBe(false);
      expect(body.ready).toBe(false);
      expect(blockingAvatarBlocker(body)).toEqual([
        {
          code: "AVATAR_RUNTIME_SOURCE_NOT_QUALIFIED",
          message:
            "Avatar video can only be generated from the approved avatar source, and this workspace has no such avatar yet.",
          severity: "BLOCKING",
        },
      ]);
      expect(body.blockers?.some((blocker) => blocker.code === "AVATAR_PROFILE_NOT_READY")).toBe(
        false,
      );
    } finally {
      testState.publishedStyleRows.length = 0;
      testState.workerDeviceRows.length = 0;
      testState.preflightAvatarRows.length = 0;
    }
  });

  it("blocks a pinned avatar runtime source whose key is not a canonical avatar.png", async () => {
    testState.publishedStyleRows.push({});
    testState.workerDeviceRows.push({
      status: "ONLINE",
      count: "1",
      available_disk_bytes: 4 * 1024 ** 3,
    });
    testState.preflightAvatarRows.push({
      source_preparation_profile: "soulx-pro-vf924u-approved-v1",
      object_key:
        "tenant/ffffffff-ffff-4fff-8fff-000000000001" +
        "/workspace/ffffffff-ffff-4fff-8fff-000000000011" +
        "/avatar-profile/f2136d6c-03e7-41c2-8d15-86fddfdf578f" +
        "/version/8760a29e-280a-4c89-88d5-a04b1c229d85/canonical/avatar.jpg",
    });
    try {
      const result = await handleHostedProductRequest(
        request("/api/v2/hosted/projects/preflight", "POST", preflightBody),
        environment,
        stagingConfig,
        executionContext,
      );
      expect(result?.status).toBe(200);
      const body = (await result?.json()) as PreflightBlockerBody;
      expect(body.ok).toBe(false);
      expect(blockingAvatarBlocker(body)).toHaveLength(1);
    } finally {
      testState.publishedStyleRows.length = 0;
      testState.workerDeviceRows.length = 0;
      testState.preflightAvatarRows.length = 0;
    }
  });

  it("accepts a pinned system avatar version whose runtime source is canonical", async () => {
    testState.publishedStyleRows.push({});
    testState.workerDeviceRows.push({
      status: "ONLINE",
      count: "1",
      available_disk_bytes: 4 * 1024 ** 3,
    });
    testState.preflightAvatarRows.push({
      source_preparation_profile: "soulx-pro-vf924u-approved-v1",
      object_key:
        "tenant/ffffffff-ffff-4fff-8fff-000000000001" +
        "/workspace/ffffffff-ffff-4fff-8fff-000000000011" +
        "/avatar-profile/f2136d6c-03e7-41c2-8d15-86fddfdf578f" +
        "/version/8760a29e-280a-4c89-88d5-a04b1c229d85/canonical/avatar.png",
    });
    try {
      const result = await handleHostedProductRequest(
        request("/api/v2/hosted/projects/preflight", "POST", preflightBody),
        environment,
        stagingConfig,
        executionContext,
      );
      expect(result?.status).toBe(200);
      const body = (await result?.json()) as PreflightBlockerBody;
      expect(blockingAvatarBlocker(body)).toEqual([]);
      expect(body.ok).toBe(true);
      expect(body.ready).toBe(true);
    } finally {
      testState.publishedStyleRows.length = 0;
      testState.workerDeviceRows.length = 0;
      testState.preflightAvatarRows.length = 0;
    }
  });

  it("names the qualified avatar in the blocker when the workspace has one", async () => {
    testState.publishedStyleRows.push({});
    testState.workerDeviceRows.push({
      status: "ONLINE",
      count: "1",
      available_disk_bytes: 4 * 1024 ** 3,
    });
    testState.preflightAvatarRows.push({
      source_preparation_profile: "hosted-avatar-source-pass-through-v1",
      object_key:
        "tenant/38ae8aaf-09d8-bdab-7436-385eb2fcb7ac" +
        "/workspace/78c40d01-f7af-bae1-1922-6b458da10625" +
        "/avatar-profile/fd1d6623-c3e9-46d3-bddf-228e24314cbc" +
        "/version/06fa24c0-8f00-4783-9790-58289ef80c3f/original/source",
    });
    testState.qualifiedAvatarRows.push({ name: "V2-09 qualified SoulX avatar (system copy)" });
    try {
      const result = await handleHostedProductRequest(
        request("/api/v2/hosted/projects/preflight", "POST", preflightBody),
        environment,
        stagingConfig,
        executionContext,
      );
      expect(result?.status).toBe(200);
      const body = (await result?.json()) as PreflightBlockerBody;
      expect(blockingAvatarBlocker(body)).toEqual([
        {
          code: "AVATAR_RUNTIME_SOURCE_NOT_QUALIFIED",
          message:
            'Avatar video can only be generated from the approved avatar source. Choose "V2-09 qualified SoulX avatar (system copy)" instead — a custom avatar image cannot be used for avatar video yet.',
          severity: "BLOCKING",
        },
      ]);
    } finally {
      testState.publishedStyleRows.length = 0;
      testState.workerDeviceRows.length = 0;
      testState.preflightAvatarRows.length = 0;
      testState.qualifiedAvatarRows.length = 0;
    }
  });

  it.each([null, "2026-10-04T10:00:00.000Z"])(
    "serves completed provenance immediately; preserves actual historical approval %s",
    async (approvedAt) => {
      const previous = testState.projectRows[0]!;
      testState.projectRows[0] = {
        ...previous,
        revision_state: "LOCKED",
        render_attempt_id: "22222222-2222-4222-8222-222222222222",
        attempt_state: "SUCCEEDED",
        object_key: "final.mp4",
        content_type: "video/mp4",
        content_length: 42,
        checksum_sha256: `sha256:${"a".repeat(64)}`,
        output_checksum_sha256: `sha256:${"a".repeat(64)}`,
        approved_at: approvedAt,
        approved_by_user_id: approvedAt ? "actual-owner" : null,
      };
      try {
        const result = await handleHostedProductRequest(
          request(`/api/v2/hosted/projects/${PROJECT_ID}/manifest`, "GET"),
          environment,
          config,
          executionContext,
        );
        expect(result?.status).toBe(200);
        expect(await result!.json()).toMatchObject({
          creative_approval: {
            state: approvedAt ? "APPROVED" : "NOT_REQUIRED",
            approved_at: approvedAt,
            approved_by_user_id: approvedAt ? "actual-owner" : null,
          },
          guarantees: { approval_required: false },
          cost: { projected_usd: null, settled_usd: null },
        });
      } finally {
        testState.projectRows[0] = previous;
      }
    },
  );

  it("keeps provenance manifest unavailable until a technically complete render exists", async () => {
    const result = await handleHostedProductRequest(
      request(`/api/v2/hosted/projects/${PROJECT_ID}/manifest`, "GET"),
      environment,
      config,
      executionContext,
    );
    expect(result?.status).toBe(409);
    await expect(errorCode(result)).resolves.toBe("PROJECT_OUTPUT_NOT_READY");
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

  it("shows persisted prompt capacity refusal as a support hold after Progress is reopened", () => {
    const projected = hostedPromptProgressForCapacityHold({
      state: "DISPATCHING",
      problem_code: null,
      capacity_hold: true,
      accepted_scenes: 25,
      total_scenes: 100,
      active_batch_ordinal: 2,
    });
    expect(projected).toMatchObject({
      state: "UNKNOWN",
      action_required: true,
      can_retry: false,
      active_batch_ordinal: null,
      accepted_scenes: 25,
    });
    expect(
      hostedPromptWritingState("RUNNING", true, {
        acceptedScenes: 25,
        totalScenes: 100,
        problemCode: projected?.problem_code,
      }),
    ).toMatchObject({
      status: "ACTION_REQUIRED",
      progressPercent: 25,
      detail: expect.stringContaining("Contact support"),
    });
    expect(hostedPromptProgressForCapacityHold(null)).toBeNull();
    expect(
      hostedPromptProgressForCapacityHold({ state: "SUCCEEDED", capacity_hold: true }),
    ).toEqual({
      state: "SUCCEEDED",
      capacity_hold: true,
      automatic_recovery_pending: false,
      recovery_requires_attention: false,
    });
  });

  it.each([
    {
      name: "legacy Gemini unknown keeps retrieval recovery",
      state: "UNKNOWN",
      problemCode: "HOSTED_PROMPT_EXECUTION_UNKNOWN",
      profileRevision: 7,
      hasCurrentClaim: true,
      automaticRecoveryPending: true,
      expected: "automatic",
    },
    {
      name: "Luna unknown without a saved receipt needs attention",
      state: "UNKNOWN",
      problemCode: "HOSTED_PROMPT_EXECUTION_UNKNOWN",
      profileRevision: 8,
      hasCurrentClaim: true,
      automaticRecoveryPending: true,
      expected: "attention",
    },
    {
      name: "Luna unknown with its saved receipt remains recoverable",
      state: "UNKNOWN",
      problemCode: "HOSTED_PROMPT_EXECUTION_UNKNOWN",
      profileRevision: 8,
      hasCurrentClaim: true,
      hasCurrentReceipt: true,
      automaticRecoveryPending: true,
      expected: "automatic",
    },
    {
      name: "stale Luna dispatch without a receipt needs attention",
      state: "DISPATCHING",
      profileRevision: 8,
      staleDispatch: true,
      hasCurrentClaim: true,
      expected: "attention",
    },
    {
      name: "capacity hold retains its explicit hold path",
      state: "UNKNOWN",
      problemCode: "HOSTED_PROMPT_EXECUTION_UNKNOWN",
      profileRevision: 8,
      hasCurrentClaim: true,
      capacityHeld: true,
      automaticRecoveryPending: true,
      expected: "none",
    },
    {
      name: "credit pause with no current claim stays on its resume path",
      state: "UNKNOWN",
      problemCode: "HOSTED_PROMPT_PROVIDER_CREDITS_LOW",
      profileRevision: 8,
      hasCurrentClaim: false,
      expected: "none",
    },
  ])("classifies hosted prompt recovery safely: $name", ({ expected, ...input }) => {
    expect(hostedPromptRecoveryDisposition(input)).toBe(expected);
  });

  it.each([9, 10])(
    "keeps unresolved Luna profile %i claims from automatic replay",
    (profileRevision) => {
      const input = {
        state: "UNKNOWN",
        problemCode: "HOSTED_PROMPT_EXECUTION_UNKNOWN",
        profileRevision,
        hasCurrentClaim: true,
        automaticRecoveryPending: true,
      };
      expect(hostedPromptRecoveryDisposition(input)).toBe("attention");
      expect(hostedPromptRecoveryDisposition({ ...input, hasCurrentReceipt: true })).toBe(
        "automatic",
      );
    },
  );

  it("shows Luna UNKNOWN without a receipt as manual review, never automatic recovery", () => {
    const projected = hostedPromptProgressForCapacityHold({
      state: "UNKNOWN",
      problem_code: "HOSTED_PROMPT_EXECUTION_UNKNOWN",
      profile_revision: 8,
      current_batch_claim_available: true,
      current_batch_receipt_available: false,
      automatic_recovery_pending: true,
      capacity_hold: false,
      accepted_scenes: 4,
      total_scenes: 10,
    });
    expect(projected).toMatchObject({
      automatic_recovery_pending: false,
      recovery_requires_attention: true,
    });
    expect(
      hostedPromptWritingState("FAILED", true, {
        acceptedScenes: 4,
        totalScenes: 10,
        runState: "UNKNOWN",
        manualReviewRequired: projected?.recovery_requires_attention === true,
      }),
    ).toMatchObject({
      status: "ACTION_REQUIRED",
      detail: expect.stringContaining("will not be sent again automatically"),
    });
  });

  it.each([
    {
      name: "exact current claim",
      state: "UNKNOWN",
      problem: "HOSTED_PROMPT_EXECUTION_UNKNOWN",
      eligible: true,
      task: "FAILED",
      expected: "RETRY_WAIT",
    },
    {
      name: "saved prefix",
      state: "UNKNOWN",
      problem: "HOSTED_PROMPT_DISPATCH_TIMEOUT",
      eligible: true,
      task: "FAILED",
      expected: "RETRY_WAIT",
    },
    {
      name: "replacement running",
      state: "DISPATCHING",
      problem: null,
      eligible: false,
      task: "RUNNING",
      expected: "RUNNING",
    },
    {
      name: "complete",
      state: "SUCCEEDED",
      problem: null,
      eligible: false,
      task: "COMPLETE",
      expected: "COMPLETE",
    },
    {
      name: "invalid exhausted result",
      state: "FAILED",
      problem: "HOSTED_PROMPT_OUTPUT_INVALID",
      eligible: false,
      task: "FAILED",
      expected: "FAILED",
    },
    {
      name: "missing exact claim",
      state: "UNKNOWN",
      problem: "HOSTED_PROMPT_EXECUTION_UNKNOWN",
      eligible: false,
      task: "FAILED",
      expected: "FAILED",
    },
    {
      name: "cancelled generation",
      state: "UNKNOWN",
      problem: "HOSTED_PROMPT_EXECUTION_UNKNOWN",
      eligible: false,
      task: "FAILED",
      expected: "FAILED",
    },
    {
      name: "inactive generation",
      state: "UNKNOWN",
      problem: "HOSTED_PROMPT_EXECUTION_UNKNOWN",
      eligible: false,
      task: "FAILED",
      expected: "FAILED",
    },
    {
      name: "credits hold",
      state: "UNKNOWN",
      problem: "HOSTED_PROMPT_PROVIDER_CREDITS_LOW",
      eligible: true,
      task: "FAILED",
      expected: "BLOCKED",
    },
    {
      name: "capacity hold",
      state: "UNKNOWN",
      problem: "HOSTED_PROMPT_EXECUTION_UNKNOWN",
      eligible: true,
      task: "FAILED",
      expected: "ACTION_REQUIRED",
      capacity: true,
    },
  ])(
    "projects prompt $name without a false terminal stage",
    async ({ state, problem, eligible, task, expected, capacity }) => {
      const priorQuery = testState.query.getMockImplementation()!;
      testState.query.mockImplementation(async (sql, params) => {
        if (sql.includes("FROM hosted_prompt_runs AS run"))
          return {
            rows: [
              {
                state,
                problem_code: problem,
                automatic_recovery_pending: eligible,
                capacity_hold: capacity ?? false,
                accepted_scenes: 25,
                total_scenes: 100,
                accepted_batches: 1,
                total_batches: 4,
                finished_at: "2026-10-06T08:00:00Z",
              },
            ],
            affectedRows: 1,
          };
        if (sql.includes("AS prompt_task_state"))
          return { rows: [{ id: PROJECT_ID, prompt_task_state: task }], affectedRows: 1 };
        return priorQuery(sql, params);
      });
      try {
        const result = await handleHostedProductRequest(
          request(`/api/v2/hosted/projects/${PROJECT_ID}`, "GET"),
          {},
          stagingConfig,
          executionContext,
        );
        expect(result?.status).toBe(200);
        const body = (await result!.json()) as {
          prompt_progress: { automatic_recovery_pending: boolean };
          stages: { id: string; status: string; detail: string; completed_at: string | null }[];
        };
        const pending = expected === "RETRY_WAIT";
        expect(body.prompt_progress.automatic_recovery_pending).toBe(pending);
        const stage = body.stages.find((item) => item.id === "prompt-writing")!;
        expect(stage.status).toBe(expected);
        if (pending) {
          expect(stage.completed_at).toBeNull();
          expect(stage.detail).toBe(
            "Recovering the current prompt batch automatically. Saved prompts remain intact.",
          );
        }
      } finally {
        testState.query.mockImplementation(priorQuery);
      }
    },
  );

  it.each([
    { name: "eligible Cloud dispatch", state: "DISPATCHING", eligible: true, expected: true },
    {
      name: "exact unknown recovery",
      state: "UNKNOWN",
      recovery: true,
      problem: "HOSTED_PROMPT_EXECUTION_UNKNOWN",
      expected: true,
    },
    { name: "terminal prompt failure", state: "FAILED", eligible: true, expected: false },
    { name: "opaque unknown", state: "UNKNOWN", expected: false },
    {
      name: "capacity held",
      state: "DISPATCHING",
      eligible: true,
      capacity: true,
      expected: false,
    },
    {
      name: "credits held",
      state: "UNKNOWN",
      recovery: true,
      problem: "HOSTED_PROMPT_PROVIDER_CREDITS_LOW",
      expected: false,
    },
    {
      name: "cancelled generation",
      state: "DISPATCHING",
      eligible: true,
      queue: "CANCELLED",
      expected: false,
    },
    {
      name: "inactive generation",
      state: "DISPATCHING",
      eligible: false,
      queue: "WAITING",
      expected: false,
    },
    {
      name: "failed context",
      state: "DISPATCHING",
      eligible: true,
      context: "FAILED",
      expected: false,
    },
    {
      name: "deleted project",
      state: "DISPATCHING",
      eligible: true,
      missing: true,
      expected: false,
    },
    {
      name: "unscoped request",
      state: "DISPATCHING",
      eligible: true,
      unscoped: true,
      expected: false,
    },
  ])(
    "revives the shared coordinator only for native eligible Stage 5 progress: $name",
    async (testCase) => {
      const prior = testState.query.getMockImplementation()!;
      continuationWatchdog.ensure.mockClear();
      testState.query.mockImplementation(async (sql, params) => {
        if (testCase.unscoped && sql.includes("videoforge_hosted_session_scope"))
          return { rows: [], affectedRows: 0 };
        if (sql.includes("project.name AS title") && sql.includes("FROM projects AS project"))
          return {
            rows: testCase.missing
              ? []
              : [{ ...testState.projectRows[0], media_execution_backend: "RUNPOD_POD" }],
            affectedRows: testCase.missing ? 0 : 1,
          };
        if (sql.includes("FROM hosted_prompt_runs AS run"))
          return {
            rows: [
              {
                state: testCase.state,
                continuation_driver_eligible: testCase.eligible ?? false,
                automatic_recovery_pending: testCase.recovery ?? false,
                capacity_hold: testCase.capacity ?? false,
                problem_code: testCase.problem ?? null,
              },
            ],
            affectedRows: 1,
          };
        if (sql.includes("FROM hosted_voiceover_contexts AS context"))
          return { rows: [{ state: testCase.context ?? "SUCCEEDED" }], affectedRows: 1 };
        if (sql.includes("FROM generation_requests AS request"))
          return { rows: [{ state: testCase.queue ?? "ACTIVE" }], affectedRows: 1 };
        return prior(sql, params);
      });
      try {
        const result = await handleHostedProductRequest(
          request(`/api/v2/hosted/projects/${PROJECT_ID}`, "GET"),
          {},
          stagingConfig,
          executionContext,
        );
        expect(result?.status).toBe(testCase.missing ? 404 : testCase.unscoped ? 403 : 200);
        expect(continuationWatchdog.ensure).toHaveBeenCalledTimes(testCase.expected ? 1 : 0);
        if (testCase.expected) {
          const query = testState.query.mock.calls.find(([sql]) =>
            sql.includes("AS continuation_driver_eligible"),
          );
          expect(query?.[0]).toContain(
            "request.account_id=run.account_id AND request.workspace_id=run.workspace_id",
          );
          expect(query?.[0]).toContain("request.project_revision_id=run.project_revision_id");
          expect(query?.[0]).toContain("request.state='ACTIVE')=1");
        }
      } finally {
        testState.query.mockImplementation(prior);
      }
    },
  );

  it("does not report image prompts complete merely because a timeline exists", () => {
    expect(
      hostedPromptWritingState("FAILED", true, {
        acceptedScenes: 70,
        totalScenes: 258,
        problemCode: "HOSTED_PROMPT_PROVIDER_CREDITS_LOW",
      }),
    ).toMatchObject({
      status: "BLOCKED",
      progressPercent: 27,
      detail: expect.stringContaining("70 saved prompts remain intact"),
    });
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
    expect(
      hostedPromptWritingState("FAILED", true, { acceptedScenes: 50, totalScenes: 320 }),
    ).toEqual({
      status: "FAILED",
      progressPercent: 15,
      detail: "50 image prompts were saved before writing stopped.",
    });
    // A writer task is created the moment prompt writing starts; every non-terminal durable state it
    // passes through must read as running work, never as "not started".
    for (const inFlight of ["PENDING", "READY", "DISPATCHING", "RUNNING"]) {
      expect(
        hostedPromptWritingState(inFlight, true, { acceptedScenes: 25, totalScenes: 100 }),
      ).toEqual({
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
    // A refusal before the claim produced a context row has no attempt to settle, and letting it
    // escape answered the browser with the runtime's non-JSON 500: readJson then shows only its
    // generic 'VideoForge hosted request failed.' sentence while stage 03 kept reading RUNNING.
    expect(block).toContain('code: "HOSTED_CONTEXT_START_REJECTED"');
    expect(block).toContain("if (accountId) {");
    expect(block).toContain("Press Retry to start it again.");
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
    expect(block).toContain("const firstBatch = await dispatchOneHostedPromptBatch");
    expect(
      block.indexOf("preparedBatchPlanHash !== batchPlanHash") <
        block.indexOf("const firstBatch = await dispatchOneHostedPromptBatch"),
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

  it.each([
    {
      state: "UNKNOWN",
      problem: "VOICEOVER_CONTEXT_NETWORK_UNCERTAIN",
      count: 1,
      hash: null,
      pending: true,
    },
    {
      state: "FAILED",
      problem: "VOICEOVER_CONTEXT_PROVIDER_REJECTED",
      count: 29,
      hash: null,
      pending: true,
    },
    {
      state: "UNKNOWN",
      problem: "VOICEOVER_CONTEXT_NETWORK_UNCERTAIN",
      count: 30,
      hash: null,
      pending: false,
    },
    {
      state: "UNKNOWN",
      problem: "VOICEOVER_CONTEXT_INVALID",
      count: 1,
      hash: null,
      pending: false,
    },
    {
      state: "UNKNOWN",
      problem: "HOSTED_CONTEXT_DISPATCH_TIMEOUT",
      count: 1,
      hash: null,
      pending: false,
    },
    {
      state: "SUCCEEDED",
      problem: null,
      count: 1,
      hash: `sha256:${"a".repeat(64)}`,
      pending: false,
    },
    {
      state: "UNKNOWN",
      problem: "VOICEOVER_CONTEXT_NETWORK_UNCERTAIN",
      count: 1,
      hash: `sha256:${"a".repeat(64)}`,
      pending: false,
    },
  ])(
    "reports context recovery truth for $state / $problem / $count",
    async ({ state, problem, count, hash, pending }) => {
      const priorQuery = testState.query.getMockImplementation()!;
      testState.query.mockImplementation(async (sql, params) => {
        if (sql.includes("FROM hosted_voiceover_contexts AS context"))
          return {
            rows: [
              {
                id: PROJECT_ID,
                state,
                problem_code: problem,
                redispatch_count: count,
                context_hash: hash,
              },
            ],
            affectedRows: 1,
          };
        if (sql.includes("SELECT attempt.id, attempt.kind, attempt.state, attempt.version"))
          return { rows: [{ id: PROJECT_ID, kind: "ASR", state: "SUCCEEDED" }], affectedRows: 1 };
        return priorQuery(sql, params);
      });
      try {
        const result = await handleHostedProductRequest(
          request(`/api/v2/hosted/projects/${PROJECT_ID}`, "GET"),
          {},
          stagingConfig,
          executionContext,
        );
        expect(result?.status).toBe(200);
        const body = (await result!.json()) as {
          voiceover_context: { automatic_retry_pending: boolean };
          stages: { id: string; status: string; detail: string }[];
        };
        expect(body.voiceover_context.automatic_retry_pending).toBe(pending);
        const stage = body.stages.find((stage) => stage.id === "voiceover-context")!;
        expect(stage.status).toBe(
          state === "SUCCEEDED" ? "COMPLETE" : pending ? "RETRY_WAIT" : "FAILED",
        );
        if (pending)
          expect(stage.detail).toBe(
            "Context request interrupted. VideoForge is retrying automatically.",
          );
      } finally {
        testState.query.mockImplementation(priorQuery);
      }
    },
  );

  it.each([
    { mode: "partial", expectedStatus: "COMPLETE", coverage: 100 / 30, fallbackCount: 1 },
    { mode: "all", expectedStatus: "COMPLETE", coverage: 0, fallbackCount: 2 },
    { mode: "unknown", expectedStatus: "ACTION_REQUIRED", coverage: 100 / 30, fallbackCount: 0 },
    { mode: "price", expectedStatus: "FAILED", coverage: 100 / 30, fallbackCount: 0 },
    { mode: "missing-source", expectedStatus: "FAILED", coverage: 100 / 30, fallbackCount: 0 },
    { mode: "tombstoned-source", expectedStatus: "FAILED", coverage: 100 / 30, fallbackCount: 0 },
  ])(
    "reports $mode scene-video fallback without losing charges or weakening blockers",
    async ({ mode, expectedStatus, coverage, fallbackCount }) => {
      const priorQuery = testState.query.getMockImplementation()!;
      const priorProject = testState.projectRows[0]!;
      testState.projectRows[0] = { ...priorProject, generation_provider: "KIE_FAL" };
      const failed = {
        state: "FAILED",
        failure_code: "SEEDANCE_RESULT_INVALID",
        static_fallback: true,
        output_cost_usd: 0.02,
        video_frame_count: 100,
        duration_seconds: 4,
      };
      const accepted = {
        state: "SUCCEEDED",
        accepted_barrier_valid: true,
        output_cost_usd: 0.04,
        video_frame_count: 100,
        duration_seconds: 4,
      };
      const jobs = [
        mode === "all" ? failed : accepted,
        mode === "unknown"
          ? { ...failed, state: "UNKNOWN_NO_RETRY", static_fallback: false }
          : mode === "price"
            ? { ...failed, failure_code: "SEEDANCE_PRICE_CHANGED", static_fallback: false }
            : mode.endsWith("source")
              ? { ...failed, static_fallback: false }
              : failed,
      ];
      testState.query.mockImplementation(async (sql, params) => {
        if (sql.includes("FROM hosted_video_plans"))
          return {
            rows: [
              {
                planned_at: "2026-10-03T00:00:00Z",
                selections: [{ durationSeconds: 4 }, { durationSeconds: 4 }],
              },
            ],
            affectedRows: 1,
          };
        if (
          sql.includes("FROM hosted_video_jobs job") &&
          !sql.includes("project_prompt_cost AS (")
        ) {
          expect(sql).toContain("videoforge_hosted_video_static_fallback");
          expect(sql).toContain("source.id=job.source_api_job_id");
          expect(sql).toContain(
            "source.output_asset_id=job.source_asset_id AND source.output_sha256=job.source_sha256",
          );
          expect(sql).toContain("original.kind='IMAGE' AND original.state='ACCEPTED'");
          expect(sql).toContain("original_receipt.deleted_at IS NULL");
          expect(sql).toContain(
            "original_receipt.checksum_sha256=original.binary_sha256 AND original_receipt.content_length=original.byte_size",
          );
          return { rows: jobs, affectedRows: jobs.length };
        }
        if (sql.includes("SELECT plan.id, plan.canonical_document_hash"))
          return {
            rows: [
              {
                final_frame_count: 3000,
                image_scene_count: 2,
                avatar_frame_count: 300,
                planned_tasks: 3,
                completed_tasks: 3,
                failed_tasks: 0,
              },
            ],
            affectedRows: 1,
          };
        return priorQuery(sql, params);
      });
      try {
        const result = await handleHostedProductRequest(
          request(`/api/v2/hosted/projects/${PROJECT_ID}`, "GET"),
          {},
          stagingConfig,
          executionContext,
        );
        expect(result?.status).toBe(200);
        const body = (await result!.json()) as {
          stages: { id: string; status: string; detail: string; progress_percent: number }[];
          cost: {
            api_estimate: {
              seedance_usd_per_second: number;
              seedance_actual_coverage_percent: number;
              seedance_fallback_count: number;
              seedance_reported_usd: number;
            };
          };
        };
        const stage = body.stages.find((stage) => stage.id === "video-generation")!;
        expect(stage.status).toBe(expectedStatus);
        expect(body.cost.api_estimate.seedance_usd_per_second).toBe(0.01336);
        expect(body.cost.api_estimate.seedance_actual_coverage_percent).toBeCloseTo(coverage);
        expect(body.cost.api_estimate.seedance_fallback_count).toBe(fallbackCount);
        expect(body.cost.api_estimate.seedance_reported_usd).toBeCloseTo(
          mode === "all" ? 0.04 : 0.06,
        );
        if (expectedStatus === "COMPLETE") {
          expect(stage.progress_percent).toBe(100);
          expect(stage.detail).toContain("original still");
          expect(stage.detail).toContain("actual motion (up to 7% target)");
        }
      } finally {
        testState.query.mockImplementation(priorQuery);
        testState.projectRows[0] = priorProject;
      }
    },
  );

  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])(
    "counts only post-180 frames with fallback=%s and preserved avatars=%s",
    async (fallback, composition) => {
      const priorQuery = testState.query.getMockImplementation()!;
      const priorProject = testState.projectRows[0]!;
      testState.projectRows[0] = { ...priorProject, generation_provider: "KIE_FAL" };
      const openingJobs = [
        ...Array.from({ length: 17 }, (_, index) => ({
          start_frame: index * 300,
          video_frame_count: 300,
          duration_seconds: 10.1,
        })),
        { start_frame: 5100, video_frame_count: 357, duration_seconds: 12 },
      ].map((job) => ({
        ...job,
        state: "SUCCEEDED",
        accepted_barrier_valid: true,
        output_cost_usd: job.duration_seconds * 0.01336,
      }));
      const jobs = [
        ...(composition ? openingJobs.slice(3) : openingJobs),
        {
          start_frame: 5457,
          video_frame_count: 60,
          duration_seconds: 2.1,
          state: fallback ? "FAILED" : "SUCCEEDED",
          failure_code: fallback ? "SEEDANCE_RESULT_INVALID" : null,
          static_fallback: fallback,
          accepted_barrier_valid: !fallback,
          output_cost_usd: 2.1 * 0.01336,
        },
      ];
      testState.query.mockImplementation(async (sql, params) => {
        if (sql.includes("FROM hosted_video_plans"))
          return {
            rows: [
              {
                replacement_policy: composition ? "FOOTAGE_COMPOSITION_V5" : "OPENING_180_V3",
                opening_seconds: 180,
                planned_remaining_frames: 117,
                eligible_remaining_frames: 417,
                coverage_percent: 25,
                planned_at: "2026-10-03T00:00:00Z",
                opening_frames: composition ? 4500 : 5457,
                eligible_frames: 5817,
                selections: jobs.map((job) => ({
                  videoFrameCount: job.video_frame_count,
                  durationSeconds: job.duration_seconds,
                })),
              },
            ],
            affectedRows: 1,
          };
        if (sql.includes("FROM hosted_video_jobs job"))
          return { rows: jobs, affectedRows: jobs.length };
        if (sql.includes("SELECT plan.id, plan.canonical_document_hash"))
          return {
            rows: [
              {
                final_frame_count: 6000,
                image_scene_count: 20,
                avatar_frame_count: 183,
                planned_tasks: 21,
                completed_tasks: 21,
                failed_tasks: 0,
              },
            ],
            affectedRows: 1,
          };
        return priorQuery(sql, params);
      });
      try {
        const result = await handleHostedProductRequest(
          request(`/api/v2/hosted/projects/${PROJECT_ID}`, "GET"),
          {},
          stagingConfig,
          executionContext,
        );
        expect(result?.status).toBe(200);
        const body = (await result!.json()) as {
          scene_footage_coverage: {
            requested_coverage_percent: number;
            required_opening_seconds: number;
            opening_planned_seconds: number;
            opening_completed_seconds: number;
            planned_coverage_percent: number;
            actual_coverage_percent: number;
            eligible_coverage_percent: number;
            fallback_count: number;
          };
          cost: {
            api_estimate: {
              seedance_required_opening_seconds: number;
              seedance_actual_coverage_percent: number;
              seedance_reported_usd: number;
            };
          };
          stages: { id: string; status: string; progress_percent: number }[];
        };
        expect(body.scene_footage_coverage).toMatchObject({
          requested_coverage_percent: 25,
          required_opening_seconds: 180,
          opening_planned_seconds: composition ? 150 : 180,
          opening_completed_seconds: composition ? 150 : 180,
          fallback_count: fallback ? 1 : 0,
        });
        expect(body.scene_footage_coverage.planned_coverage_percent).toBeCloseTo(19.5);
        expect(body.scene_footage_coverage.actual_coverage_percent).toBeCloseTo(
          fallback ? 9.5 : 19.5,
        );
        expect(body.scene_footage_coverage.eligible_coverage_percent).toBeCloseTo(69.5);
        expect(body.cost.api_estimate.seedance_required_opening_seconds).toBe(180);
        expect(body.cost.api_estimate.seedance_actual_coverage_percent).toBeCloseTo(
          fallback ? 9.5 : 19.5,
        );
        expect(body.cost.api_estimate.seedance_reported_usd).toBeCloseTo(
          jobs.reduce((sum, job) => sum + job.output_cost_usd, 0),
        );
        expect(body.stages.find((stage) => stage.id === "video-generation")).toMatchObject({
          status: "COMPLETE",
          progress_percent: 100,
        });
      } finally {
        testState.query.mockImplementation(priorQuery);
        testState.projectRows[0] = priorProject;
      }
    },
  );

  it("adds incurred context and scene-prompt charges, leaves remaining prompts pending, and uses the sealed Seedance rate", async () => {
    const priorQuery = testState.query.getMockImplementation()!;
    const priorProject = testState.projectRows[0]!;
    let acceptedScenes = 1;
    let narrationUnknown = true;
    let videoPlanPresent = true;
    testState.projectRows[0] = { ...priorProject, generation_provider: "KIE_FAL" };
    testState.query.mockImplementation(async (sql, params) => {
      if (sql.includes("project_prompt_cost AS ("))
        return {
          rows: [
            { label: "Context analysis", usd: "0.000073", unconfirmed: false, estimated: true },
            {
              label: "Scene prompts (GPT-6 Luna)",
              usd: "0.0005",
              unconfirmed: false,
              estimated: true,
            },
            ...(narrationUnknown
              ? [{ label: "Generated narration", usd: null, unconfirmed: true, estimated: false }]
              : []),
          ],
          affectedRows: narrationUnknown ? 3 : 2,
        };
      if (sql.includes("FROM hosted_prompt_runs AS run"))
        return {
          rows: [
            {
              state: acceptedScenes === 2 ? "SUCCEEDED" : "DISPATCHING",
              accepted_scenes: acceptedScenes,
              total_scenes: 2,
            },
          ],
          affectedRows: 1,
        };
      if (sql.includes("FROM hosted_video_plans"))
        return {
          rows: videoPlanPresent
            ? [
                {
                  planned_at: "2026-10-07T00:00:00Z",
                  price_per_second_usd: "0.0134",
                  selections: [{ durationSeconds: 10 }],
                },
              ]
            : [],
          affectedRows: videoPlanPresent ? 1 : 0,
        };
      if (sql.includes("SELECT plan.id, plan.canonical_document_hash"))
        return {
          rows: [
            {
              final_frame_count: 3000,
              image_scene_count: 2,
              avatar_frame_count: 30,
              planned_tasks: 3,
              completed_tasks: 0,
              failed_tasks: 0,
              prompt_task_state: acceptedScenes === 2 ? "COMPLETE" : "RUNNING",
            },
          ],
          affectedRows: 1,
        };
      return priorQuery(sql, params);
    });
    try {
      const result = await handleHostedProductRequest(
        request(`/api/v2/hosted/projects/${PROJECT_ID}`, "GET"),
        {},
        stagingConfig,
        executionContext,
      );
      expect(result?.status).toBe(200);
      const body = (await result!.json()) as {
        cost: {
          projected_usd: number;
          provider: string;
          api_estimate: {
            kie_usd: number;
            fal_usd: number;
            fal_pricing_basis: string;
            seedance_usd_per_second: number;
            seedance_usd: number;
            text_cost_so_far_usd: number;
            text_cost_pending: boolean;
            pricing_incomplete: boolean;
          };
        };
      };
      expect(body.cost.api_estimate).toMatchObject({
        kie_usd: 0.008,
        fal_usd: 0.005,
        fal_pricing_basis: "OUTPUT_SECOND_PROXY_ESTIMATE",
        seedance_usd_per_second: 0.0134,
        seedance_usd: 0.134,
        text_cost_so_far_usd: 0.000573,
        text_cost_pending: true,
        pricing_incomplete: true,
      });
      expect(body.cost.projected_usd).toBeCloseTo(0.147573);
      expect(body.cost.provider).toBe("kie+fal+runware");

      acceptedScenes = 2;
      narrationUnknown = false;
      videoPlanPresent = false;
      const completed = await handleHostedProductRequest(
        request(`/api/v2/hosted/projects/${PROJECT_ID}`, "GET"),
        {},
        stagingConfig,
        executionContext,
      );
      const completedBody = (await completed!.json()) as typeof body;
      expect(completedBody.cost.api_estimate).toMatchObject({
        text_cost_so_far_usd: 0.000573,
        text_cost_pending: false,
        pricing_incomplete: false,
      });
      expect(completedBody.cost.projected_usd).toBeCloseTo(0.013573);
      expect(completedBody.cost.provider).toBe("kie+fal+runware");
    } finally {
      testState.query.mockImplementation(priorQuery);
      testState.projectRows[0] = priorProject;
    }
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
        expect(mediaCall?.[0]).toContain("FROM hosted_api_image_regeneration_jobs AS regeneration");
        expect(mediaCall?.[0]).toContain(
          "COALESCE(regeneration.source_api_job_id, regeneration.source_attempt_id) AS attempt_id",
        );
        expect(mediaCall?.[0]).toContain("regeneration.state = 'SUCCEEDED'");
        expect(mediaCall?.[0]).toContain("asset.state = 'ACCEPTED'");
        expect(mediaCall?.[0]).toContain("'prompt', regeneration.input_manifest->>'prompt'");
        expect(mediaCall?.[0]).toContain("FROM api_regenerated_output_items");
        expect(mediaCall?.[0]).toContain("ORDER BY min(first_accepted_at), attempt_id");
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
    expect(block).toContain('kind: "avatar" | "videos" = "avatar"');
    expect(block).toContain("hostedMediaCandidates(outputs, kind, page)");
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
    const end = source.indexOf("return {", start);
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
    testState.projectDetailMediaRows.splice(0, testState.projectDetailMediaRows.length, ...outputs);
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
        outputs.filter((_, index) => index !== 95).map((output) => output.artifacts[0]!.item_id),
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

describe("Cloud ASR immutable successor recovery", () => {
  it("reuses one durable successor and its exact retained receipt on duplicate explicit retries", async () => {
    const original = testState.query.getMockImplementation()!;
    const previous = testState.projectRows[0]!;
    const failedId = "77777777-7777-4777-8777-777777777777",
      successor = "88888888-8888-4888-8888-888888888888";
    testState.projectRows[0] = {
      revision_id: "22222222-2222-4222-8222-222222222222",
      revision_number: 1,
      voiceover_asset_id: "33333333-3333-4333-8333-333333333333",
      checksum_sha256: `sha256:${"a".repeat(64)}`,
      content_type: "audio/mpeg",
      duration_ms: 159216,
      receipt_id: "44444444-4444-4444-8444-444444444444",
      content_length: 320_000,
      asr_attempt_count: 1,
      asr_total_attempt_count: 1,
      latest_asr_state: "FAILED",
      latest_asr_backend: "RUNPOD_POD",
      latest_asr_attempt_id: failedId,
    };
    testState.query.mockImplementation(async (statement, parameters) => {
      if (statement.includes("videoforge_prepare_cloud_media_asr_recovery")) {
        expect(parameters).toEqual([
          testState.scopeRows[0]?.account_id,
          testState.scopeRows[0]?.workspace_id,
          testState.scopeRows[0]?.user_id,
          PROJECT_ID,
          failedId,
        ]);
        testState.projectRows[0] = {
          ...testState.projectRows[0],
          revision_id: successor,
          revision_number: 2,
          content_length: 320_000,
          asr_attempt_count: 0,
          asr_total_attempt_count: 0,
          latest_asr_state: null,
          latest_asr_attempt_id: null,
        };
        return { rows: [{ revision_id: successor }], affectedRows: 1 };
      }
      return original(statement, parameters);
    });
    try {
      const cloudConfig = {
        ...stagingConfig,
        cloudMedia: { enabled: true },
      } as HostedRuntimeConfiguration;
      const first = await handleHostedProductRequest(
        request(`/api/v2/hosted/projects/${PROJECT_ID}/asr`),
        environment,
        cloudConfig,
        executionContext,
      );
      const second = await handleHostedProductRequest(
        request(`/api/v2/hosted/projects/${PROJECT_ID}/asr`),
        environment,
        cloudConfig,
        executionContext,
      );
      expect(first?.status).toBe(202);
      expect(second?.status).toBe(202);
      const firstBody = (await first?.json()) as {
          project_revision_id: string;
          cpu_submission: { objects: { artifact_receipt_id: string }[]; idempotency_key: string };
        },
        secondBody = await second?.json();
      expect(firstBody).toEqual(secondBody);
      expect(firstBody.project_revision_id).toBe(successor);
      expect(firstBody.cpu_submission.objects[0]?.artifact_receipt_id).toBe(
        "44444444-4444-4444-8444-444444444444",
      );
      expect(firstBody.cpu_submission.idempotency_key).toContain(`revision-${successor}-asr-v1`);
      expect(
        testState.query.mock.calls.filter(([statement]) =>
          statement.includes("videoforge_prepare_cloud_media_asr_recovery"),
        ),
      ).toHaveLength(1);
      const inherited = testState.query.mock.calls.filter(([statement]) =>
        statement.includes("videoforge_copy_hosted_video_plan"),
      );
      expect(inherited).toHaveLength(1);
      expect(inherited[0]?.[0]).toContain("WHERE EXISTS(SELECT 1 FROM hosted_video_plans");
      expect(inherited[0]?.[1]).toEqual([
        testState.scopeRows[0]?.account_id,
        testState.scopeRows[0]?.workspace_id,
        "22222222-2222-4222-8222-222222222222",
        successor,
      ]);
    } finally {
      testState.projectRows[0] = previous;
      testState.query.mockImplementation(original);
    }
  });
  it("maps an unsettled or ineligible Cloud recovery to a bounded response without changing Local", async () => {
    const original = testState.query.getMockImplementation()!,
      previous = testState.projectRows[0]!;
    testState.projectRows[0] = {
      revision_id: "22222222-2222-4222-8222-222222222222",
      latest_asr_state: "FAILED",
      latest_asr_backend: "RUNPOD_POD",
      latest_asr_attempt_id: "77777777-7777-4777-8777-777777777777",
    };
    testState.query.mockImplementation(async (statement, parameters) => {
      if (statement.includes("videoforge_prepare_cloud_media_asr_recovery"))
        throw Object.assign(new Error("private database details"), { code: "23514" });
      return original(statement, parameters);
    });
    try {
      const result = await handleHostedProductRequest(
        request(`/api/v2/hosted/projects/${PROJECT_ID}/asr`),
        environment,
        { ...stagingConfig, cloudMedia: { enabled: true } } as HostedRuntimeConfiguration,
        executionContext,
      );
      expect(result?.status).toBe(409);
      expect(await result?.json()).toEqual({ error: { code: "HOSTED_ASR_RECOVERY_NOT_ELIGIBLE" } });
    } finally {
      testState.projectRows[0] = previous;
      testState.query.mockImplementation(original);
    }
  });
});

it("blocks preflight and direct creation before any new reservation while earlier Cloud cleanup is unconfirmed", async () => {
  testState.cleanup.pending = true;
  const body = {
    title: "Cleanup guarded project",
    avatar_profile_version_id: "22222222-2222-4222-8222-222222222222",
    image_style_version_id: "33333333-3333-4333-8333-333333333333",
    voiceover: {
      filename: "voiceover.mp3",
      content_type: "audio/mpeg",
      content_length: 320000,
      checksum_sha256: `sha256:${"a".repeat(64)}`,
      duration_ms: 20000,
    },
  };
  try {
    const preflight = await handleHostedProductRequest(
      request("/api/v2/hosted/projects/preflight", "POST", {
        ...body,
        schema_version: "videoforge-hosted-project-preflight/v1",
      }),
      environment,
      stagingConfig,
      executionContext,
    );
    expect(await preflight!.json()).toMatchObject({
      ok: false,
      blockers: expect.arrayContaining([
        expect.objectContaining({ code: "HOSTED_CLOUD_CLEANUP_PENDING", severity: "BLOCKING" }),
      ]),
    });
    testState.query.mockClear();
    const created = await handleHostedProductRequest(
      request(
        "/api/v2/hosted/projects",
        "POST",
        {
          ...body,
          schema_version: "videoforge-hosted-project-create/v1",
        },
        true,
        { "idempotency-key": "cleanup-guard-0000000000000001" },
      ),
      { ...environment, PRIVATE_ARTIFACTS: {} } as HostedRuntimeEnvironment,
      stagingConfig,
      executionContext,
    );
    expect(created!.status).toBe(409);
    expect(await created!.json()).toMatchObject({
      error: { code: "HOSTED_CLOUD_CLEANUP_PENDING" },
    });
    expect(testState.query.mock.calls.some(([sql]) => sql.includes("INSERT INTO"))).toBe(false);
  } finally {
    testState.cleanup.pending = false;
  }
});

describe("adjustable scene footage router contract", () => {
  const styleVersionId = "66666666-6666-4666-8666-666666666666";
  const runtimeKey = `tenant/${testState.scopeRows[0]?.account_id}/workspace/${testState.scopeRows[0]?.workspace_id}/avatar-profile/${PRESET_ID}/version/${PRESET_ID}/canonical/avatar.png`;
  const baseBody = {
    title: "Complete scene footage",
    avatar_profile_version_id: PRESET_ID,
    image_style_version_id: styleVersionId,
    voiceover: {
      filename: "voiceover.mp3",
      content_type: "audio/mpeg",
      content_length: 320_000,
      checksum_sha256: `sha256:${"a".repeat(64)}`,
      duration_ms: 60_000,
    },
  };
  const coverageConfig = {
    ...stagingConfig,
    videoGenerationEnabled: true,
    styleAnalysis: {},
  } as unknown as HostedRuntimeConfiguration;
  const createEnvironment = { PRIVATE_ARTIFACTS: {} } as HostedRuntimeEnvironment;
  const installReadyPresets = () => {
    const runtime = {
      version_id: PRESET_ID,
      source_preparation_profile: "soulx-pro-vf924u-approved-v1",
      object_key: runtimeKey,
    };
    testState.publishedStyleRows.push({
      style_id: styleVersionId,
      version_id: styleVersionId,
      style_profile_hash: `sha256:${"c".repeat(64)}`,
      scope_kind: "WORKSPACE",
      name: "Ready style",
      version_number: 1,
      state: "PUBLISHED",
      status: "ACTIVE",
    });
    testState.presetAvatarRows.push({
      profile_id: PRESET_ID,
      profile_name: "Ready avatar",
      version_id: PRESET_ID,
      scope_kind: "WORKSPACE",
      profile_hash: `sha256:${"d".repeat(64)}`,
      runtime_source_asset_id: "55555555-5555-4555-8555-555555555555",
      runtime_source_binary_sha256: `sha256:${"e".repeat(64)}`,
      source_preparation_profile: runtime.source_preparation_profile,
      source_validation_profile: "hosted-avatar-source-validation-v1",
    });
    testState.runtimeSourceRows.push(runtime);
    testState.preflightAvatarRows.push(runtime);
    testState.workerDeviceRows.push({
      status: "ONLINE",
      count: "1",
      available_disk_bytes: 4 * 1024 ** 3,
    });
  };
  const clearReadyPresets = () => {
    testState.publishedStyleRows.length = 0;
    testState.presetAvatarRows.length = 0;
    testState.runtimeSourceRows.length = 0;
    testState.preflightAvatarRows.length = 0;
    testState.workerDeviceRows.length = 0;
    testState.createReplayRows.length = 0;
    testState.query.mockClear();
  };

  const cloudConfig = {
    ...coverageConfig,
    cloudMedia: {
      enabled: true,
      budgetAuthorityId: "99999999-9999-4999-8999-999999999999",
    },
  } as HostedRuntimeConfiguration;
  const cloudBody = { ...baseBody, execution_backend: "RUNPOD_POD", video_coverage_percent: 0 };
  const cloudCreate = (configuration = cloudConfig) =>
    handleHostedProductRequest(
      request(
        "/api/v2/hosted/projects",
        "POST",
        {
          ...cloudBody,
          schema_version: "videoforge-hosted-project-create/v3",
        },
        true,
        { "idempotency-key": "cloud-reader-00000000000000000001" },
      ),
      createEnvironment,
      configuration,
      executionContext,
    );

  it.each([false, true])(
    "agrees on account-scoped Cloud eligibility across catalog/preflight/Create ready=%s",
    async (allowed) => {
      installReadyPresets();
      testState.cloudReadiness.allowed = allowed;
      try {
        const catalog = await handleHostedProductRequest(
          request("/api/v2/hosted/project-catalog", "GET"),
          createEnvironment,
          cloudConfig,
          executionContext,
        );
        const data = (await catalog!.json()) as {
          cloud_media: { available: boolean; message: string | null };
        };
        expect(data.cloud_media.available).toBe(allowed);
        const preflight = await handleHostedProductRequest(
          request("/api/v2/hosted/projects/preflight", "POST", {
            ...cloudBody,
            schema_version: "videoforge-hosted-project-preflight/v2",
          }),
          createEnvironment,
          cloudConfig,
          executionContext,
        );
        const preflightData = (await preflight!.json()) as { ready: boolean; blockers: unknown[] };
        expect(preflightData.ready).toBe(allowed);
        if (!allowed)
          expect(preflightData.blockers).toContainEqual({
            code: "CLOUD_MEDIA_NOT_READY",
            message: data.cloud_media.message,
            severity: "BLOCKING",
          });
        testState.query.mockClear();
        const created = await cloudCreate();
        expect(created?.status).toBe(allowed ? 201 : 409);
        const calls = testState.query.mock.calls;
        const readinessIndex = calls.findIndex(([sql]) =>
          sql.includes("videoforge_cloud_media_new_project_ready"),
        );
        expect(readinessIndex).toBeGreaterThan(0);
        expect(calls[readinessIndex]![1]).toEqual([cloudConfig.cloudMedia!.budgetAuthorityId]);
        expect(
          calls
            .slice(0, readinessIndex)
            .some(
              ([sql, params]) =>
                sql.includes("set_config") && params?.[1] === testState.scopeRows[0]!.account_id,
            ),
        ).toBe(true);
        if (!allowed) {
          expect(await created!.json()).toMatchObject({
            error: { code: "CLOUD_MEDIA_NOT_READY", message: data.cloud_media.message },
          });
          expect(
            calls.some(
              ([sql]) =>
                sql.includes("INSERT INTO") || sql.includes("videoforge_pin_hosted_video_plan"),
            ),
          ).toBe(false);
        }
      } finally {
        testState.cloudReadiness.allowed = true;
        clearReadyPresets();
      }
    },
  );

  it("reports cleanup separately from neutral Cloud readiness refusal", async () => {
    installReadyPresets();
    testState.cleanup.pending = true;
    testState.cloudReadiness.allowed = false;
    try {
      const catalog = await handleHostedProductRequest(
        request("/api/v2/hosted/project-catalog", "GET"),
        createEnvironment,
        cloudConfig,
        executionContext,
      );
      expect(await catalog!.json()).toMatchObject({
        cloud_media: {
          available: false,
          message:
            "An earlier project's Cloud cleanup is unconfirmed. New work is paused until cleanup is verified.",
        },
      });
      const preflight = await handleHostedProductRequest(
        request("/api/v2/hosted/projects/preflight", "POST", {
          ...cloudBody,
          schema_version: "videoforge-hosted-project-preflight/v2",
        }),
        createEnvironment,
        cloudConfig,
        executionContext,
      );
      const data = (await preflight!.json()) as {
        ready: boolean;
        blockers: { code: string; severity: string }[];
      };
      expect(data.ready).toBe(false);
      expect(
        data.blockers
          .filter((blocker) => blocker.severity === "BLOCKING")
          .map((blocker) => blocker.code),
      ).toEqual(["HOSTED_CLOUD_CLEANUP_PENDING"]);
      expect(await errorCode(await cloudCreate())).toBe("HOSTED_CLOUD_CLEANUP_PENDING");
    } finally {
      testState.cleanup.pending = false;
      testState.cloudReadiness.allowed = true;
      clearReadyPresets();
    }
  });

  it.each([false, true])(
    "replays saved Cloud requests before new readiness when release disabled=%s",
    async (disabled) => {
      installReadyPresets();
      testState.cloudReadiness.allowed = false;
      testState.createReplayRows.push({
        state: "UPLOAD_PENDING",
        project_id: PROJECT_ID,
        project_revision_id: PRESET_ID,
        upload_reservation_id: "55555555-5555-4555-8555-555555555555",
        object_key:
          "tenant/owned/workspace/owned/project/owned/revision/owned/lane/input/job/browser-upload/artifact/voiceover",
        content_type: "audio/mpeg",
        content_length: 320_000,
        checksum_sha256: baseBody.voiceover.checksum_sha256,
        expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
      });
      testState.query.mockClear();
      try {
        const result = await cloudCreate({
          ...cloudConfig,
          ...(disabled ? { cloudMedia: undefined } : {}),
        });
        expect(result?.status).toBe(201);
        expect(await result!.json()).toMatchObject({
          project_id: PROJECT_ID,
          project_revision_id: PRESET_ID,
          state: "UPLOAD_PENDING",
        });
        expect(
          testState.query.mock.calls.some(
            ([sql]) =>
              sql.includes("videoforge_cloud_media_new_project_ready") ||
              sql.includes("INSERT INTO"),
          ),
        ).toBe(false);
      } finally {
        testState.cloudReadiness.allowed = true;
        clearReadyPresets();
      }
    },
  );

  it.each([0, 7, 15, 25, 50, 75, 100, 23])(
    "preflight/v2 reports required opening independent of selected percentage at %s percent",
    async (coverage) => {
      installReadyPresets();
      try {
        const result = await handleHostedProductRequest(
          request("/api/v2/hosted/projects/preflight", "POST", {
            ...baseBody,
            schema_version: "videoforge-hosted-project-preflight/v2",
            video_coverage_percent: coverage,
          }),
          environment,
          coverageConfig,
          executionContext,
        );
        expect(result?.status).toBe(200);
        expect(await result!.json()).toMatchObject({
          schema_version: "videoforge-hosted-project-preflight/v2",
          ok: true,
          ready: true,
          video_coverage_percent: coverage,
          estimate: {
            motion: {
              requested_coverage_percent: coverage,
              target_seconds: 60,
              required_opening_seconds: 60,
              preliminary_usd: 60 * 0.01336,
            },
          },
        });
        expect(
          testState.query.mock.calls.some(([sql]) =>
            sql.includes("videoforge_pin_hosted_video_plan"),
          ),
        ).toBe(false);
      } finally {
        clearReadyPresets();
      }
    },
  );

  it.each([
    [true, 180, 7],
    [true, 60, 23],
    [true, 6, 0],
    [false, 0, 0],
    [false, 0, 25],
  ])(
    "create/v4 pins opening=%s seconds=%s percent=%s independently",
    async (enabled, seconds, coverage) => {
      installReadyPresets();
      testState.query.mockClear();
      try {
        const result = await handleHostedProductRequest(
          request(
            "/api/v2/hosted/projects",
            "POST",
            {
              ...baseBody,
              schema_version: "videoforge-hosted-project-create/v4",
              video_coverage_percent: coverage,
              ai_video_opening_enabled: enabled,
              ai_video_opening_seconds: seconds,
            },
            true,
            { "idempotency-key": "config-opening-000000000000001" },
          ),
          createEnvironment,
          coverageConfig,
          executionContext,
        );
        expect(result?.status).toBe(201);
        const body = (await result!.json()) as { project_revision_id: string };
        const pin = testState.query.mock.calls.find(([sql]) =>
          sql.includes("videoforge_pin_hosted_video_plan"),
        );
        expect(pin?.[1]).toEqual([
          testState.scopeRows[0]!.account_id,
          testState.scopeRows[0]!.workspace_id,
          body.project_revision_id,
          coverage,
          enabled ? "OPENING_CONFIG_V4" : "WHOLE_SCENE_V2",
          seconds,
        ]);
        const revision = testState.query.mock.calls.find(([sql]) =>
          sql.includes("INSERT INTO project_revisions"),
        );
        const payload = JSON.parse(String(revision?.[1]?.[21]));
        expect(payload.scheduler_version).toBe(enabled ? "scheduler-v10" : "scheduler-v6");
        expect(payload.ai_video_opening_seconds).toBe(enabled ? seconds : undefined);
      } finally {
        clearReadyPresets();
      }
    },
  );

  it.each([
    [true, true],
    [false, true],
    [false, false],
  ])(
    "create/v5 pins avatar=%s with scene video available=%s; Off needs no avatar preset",
    async (avatarEnabled, videoAvailable) => {
      installReadyPresets();
      if (!avatarEnabled) {
        testState.presetAvatarRows.length = 0;
        testState.runtimeSourceRows.length = 0;
      }
      testState.query.mockClear();
      try {
        const result = await handleHostedProductRequest(
          request(
            "/api/v2/hosted/projects",
            "POST",
            {
              ...baseBody,
              schema_version: "videoforge-hosted-project-create/v5",
              avatar_enabled: avatarEnabled,
              avatar_profile_version_id: avatarEnabled ? baseBody.avatar_profile_version_id : null,
              video_coverage_percent: videoAvailable ? 7 : 0,
              ai_video_opening_enabled: videoAvailable,
              ai_video_opening_seconds: videoAvailable ? 180 : 0,
            },
            true,
            { "idempotency-key": "composition-create-00000000001" },
          ),
          createEnvironment,
          { ...coverageConfig, videoGenerationEnabled: videoAvailable },
          executionContext,
        );
        expect(result?.status).toBe(201);
        const revision = testState.query.mock.calls.find(([sql]) =>
          sql.includes("INSERT INTO project_revisions"),
        );
        const payload = JSON.parse(String(revision?.[1]?.[21]));
        expect(payload).toMatchObject({
          scheduler_version: "scheduler-v12",
          avatar_enabled: avatarEnabled,
          ai_video_opening_seconds: videoAvailable ? 180 : 0,
        });
        if (!avatarEnabled) {
          expect(payload.avatar_binding).toBeNull();
          expect(revision?.[1]?.slice(6, 13)).toEqual(Array(7).fill(null));
          expect(
            testState.query.mock.calls.some(([sql]) =>
              sql.includes("LEFT JOIN assets AS runtime_source"),
            ),
          ).toBe(false);
        }
        expect(
          testState.query.mock.calls
            .find(([sql]) => sql.includes("videoforge_pin_hosted_video_plan"))?.[1]
            ?.slice(3),
        ).toEqual([videoAvailable ? 7 : 0, "FOOTAGE_COMPOSITION_V5", videoAvailable ? 180 : 0]);
      } finally {
        clearReadyPresets();
      }
    },
  );

  it.each([
    [true, 60, 25, 195],
    [true, 180, 0, 180],
    [false, 0, 25, 150],
  ])(
    "preflight/v3 separates opening=%s seconds=%s coverage=%s",
    async (enabled, seconds, coverage, target) => {
      installReadyPresets();
      try {
        const result = await handleHostedProductRequest(
          request("/api/v2/hosted/projects/preflight", "POST", {
            ...baseBody,
            voiceover: { ...baseBody.voiceover, duration_ms: 600000 },
            schema_version: "videoforge-hosted-project-preflight/v3",
            video_coverage_percent: coverage,
            ai_video_opening_enabled: enabled,
            ai_video_opening_seconds: seconds,
          }),
          createEnvironment,
          coverageConfig,
          executionContext,
        );
        expect(result?.status).toBe(200);
        expect(await result!.json()).toMatchObject({
          schema_version: "videoforge-hosted-project-preflight/v3",
          ready: true,
          ai_video_opening_enabled: enabled,
          ai_video_opening_seconds: seconds,
          estimate: {
            motion: {
              target_seconds: target,
              required_opening_seconds: seconds,
              preliminary_usd: target * 0.01336,
            },
          },
        });
      } finally {
        clearReadyPresets();
      }
    },
  );

  it.each([
    [true, 0],
    [true, 5],
    [true, 7],
    [true, 3606],
    [true, "180"],
    [false, 180],
    ["true", 180],
    [undefined, undefined],
  ])(
    "rejects invalid immutable opening configuration %j/%j before writes",
    async (enabled, seconds) => {
      testState.query.mockClear();
      const result = await handleHostedProductRequest(
        request(
          "/api/v2/hosted/projects",
          "POST",
          {
            ...baseBody,
            schema_version: "videoforge-hosted-project-create/v4",
            video_coverage_percent: 7,
            ai_video_opening_enabled: enabled,
            ai_video_opening_seconds: seconds,
          },
          true,
          { "idempotency-key": "invalid-opening-000000000000001" },
        ),
        createEnvironment,
        coverageConfig,
        executionContext,
      );
      expect(result?.status).toBe(400);
      expect(testState.query.mock.calls.some(([sql]) => sql.includes("INSERT INTO"))).toBe(false);
    },
  );

  it("allows explicit Off/zero coverage with unavailable scene providers before any provider spend", async () => {
    installReadyPresets();
    try {
      const result = await handleHostedProductRequest(
        request("/api/v2/hosted/projects/preflight", "POST", {
          ...baseBody,
          schema_version: "videoforge-hosted-project-preflight/v3",
          video_coverage_percent: 0,
          ai_video_opening_enabled: false,
          ai_video_opening_seconds: 0,
        }),
        createEnvironment,
        {
          ...coverageConfig,
          environment: "production",
          videoGenerationEnabled: false,
          styleAnalysis: null,
        },
        executionContext,
      );
      expect(result?.status).toBe(200);
      const data = (await result!.json()) as { blockers: { code: string }[]; estimate: unknown };
      expect(data.blockers.some((x) => x.code === "SCENE_VIDEO_UNAVAILABLE")).toBe(false);
      expect(data.estimate).toMatchObject({
        motion: { target_seconds: 0, required_opening_seconds: 0, preliminary_usd: 0 },
      });
    } finally {
      clearReadyPresets();
    }
  });

  it.each([0, 7, 15, 25, 50, 75, 100, 23])(
    "create/v3 pins immutable OPENING_180_V3 at %s percent",
    async (coverage) => {
      installReadyPresets();
      testState.query.mockClear();
      try {
        const result = await handleHostedProductRequest(
          request(
            "/api/v2/hosted/projects",
            "POST",
            {
              ...baseBody,
              schema_version: "videoforge-hosted-project-create/v3",
              video_coverage_percent: coverage,
            },
            true,
            { "idempotency-key": `whole-scene-${coverage}-0000000000000001` },
          ),
          createEnvironment,
          coverageConfig,
          executionContext,
        );
        expect(result?.status).toBe(201);
        const body = (await result!.json()) as { project_revision_id: string; state: string };
        expect(body.state).toBe("UPLOAD_PENDING");
        const calls = testState.query.mock.calls.filter(([sql]) =>
          sql.includes("videoforge_pin_hosted_video_plan"),
        );
        expect(calls).toHaveLength(1);
        expect(calls[0]![1]).toEqual([
          testState.scopeRows[0]!.account_id,
          testState.scopeRows[0]!.workspace_id,
          body.project_revision_id,
          coverage,
          "OPENING_180_V3",
        ]);
      } finally {
        clearReadyPresets();
      }
    },
  );

  it.each(["25", "", null, undefined, -1, 101, 7.5, true, {}, []])(
    "rejects malformed coverage %j before any project write",
    async (coverage) => {
      testState.query.mockClear();
      try {
        for (const [path, schema, code] of [
          [
            "/api/v2/hosted/projects/preflight",
            "videoforge-hosted-project-preflight/v2",
            "PROJECT_PREFLIGHT_REJECTED",
          ],
          [
            "/api/v2/hosted/projects",
            "videoforge-hosted-project-create/v3",
            "PROJECT_CREATE_REJECTED",
          ],
        ]) {
          const result = await handleHostedProductRequest(
            request(
              path!,
              "POST",
              { ...baseBody, schema_version: schema, video_coverage_percent: coverage },
              true,
              { "idempotency-key": "malformed-coverage-00000000000001" },
            ),
            createEnvironment,
            coverageConfig,
            executionContext,
          );
          expect(result?.status).toBe(400);
          expect(await errorCode(result)).toBe(code);
        }
        expect(
          testState.query.mock.calls.some(
            ([sql]) =>
              sql.includes("INSERT INTO") || sql.includes("videoforge_pin_hosted_video_plan"),
          ),
        ).toBe(false);
      } finally {
        clearReadyPresets();
      }
    },
  );

  it.each(["videoforge-hosted-project-create/v1", "videoforge-hosted-project-create/v2"])(
    "legacy %s defaults to the server's enabled 7 percent policy",
    async (schema) => {
      installReadyPresets();
      testState.query.mockClear();
      try {
        const result = await handleHostedProductRequest(
          request(
            "/api/v2/hosted/projects",
            "POST",
            {
              ...baseBody,
              schema_version: schema,
            },
            true,
            { "idempotency-key": "legacy-default-coverage-00000000001" },
          ),
          createEnvironment,
          coverageConfig,
          executionContext,
        );
        expect(result?.status).toBe(201);
        const pin = testState.query.mock.calls.find(([sql]) =>
          sql.includes("videoforge_pin_hosted_video_plan"),
        );
        expect(pin?.[1]?.slice(3)).toEqual([7, "OPENING_180_V3"]);
      } finally {
        clearReadyPresets();
      }
    },
  );

  it("legacy preflight defaults to Off when scene-video generation is disabled", async () => {
    installReadyPresets();
    try {
      const result = await handleHostedProductRequest(
        request("/api/v2/hosted/projects/preflight", "POST", {
          ...baseBody,
          schema_version: "videoforge-hosted-project-preflight/v1",
        }),
        environment,
        { ...coverageConfig, videoGenerationEnabled: false },
        executionContext,
      );
      expect(result?.status).toBe(200);
      expect(await result!.json()).toMatchObject({
        ok: true,
        ready: true,
        video_coverage_percent: 0,
        estimate: {
          motion: { requested_coverage_percent: 0, target_seconds: 0, preliminary_usd: 0 },
        },
      });
    } finally {
      clearReadyPresets();
    }
  });

  it("explicit zero optional coverage still requires the opening provider before project writes", async () => {
    installReadyPresets();
    testState.query.mockClear();
    try {
      const result = await handleHostedProductRequest(
        request(
          "/api/v2/hosted/projects",
          "POST",
          {
            ...baseBody,
            schema_version: "videoforge-hosted-project-create/v3",
            video_coverage_percent: 0,
          },
          true,
          { "idempotency-key": "off-missing-key-0000000000000001" },
        ),
        createEnvironment,
        { ...coverageConfig, styleAnalysis: null },
        executionContext,
      );
      expect(result?.status).toBe(409);
      const pin = testState.query.mock.calls.find(([sql]) =>
        sql.includes("videoforge_pin_hosted_video_plan"),
      );
      expect(pin).toBeUndefined();
      expect(testState.query.mock.calls.some(([sql]) => sql.includes("INSERT INTO"))).toBe(false);
    } finally {
      clearReadyPresets();
    }
  });

  it("production Off refuses unavailable mandatory opening before project writes and blocks preflight", async () => {
    installReadyPresets();
    testState.query.mockClear();
    const disabled = {
      ...coverageConfig,
      environment: "production",
      videoGenerationEnabled: false,
    } as HostedRuntimeConfiguration;
    try {
      const result = await handleHostedProductRequest(
        request(
          "/api/v2/hosted/projects",
          "POST",
          {
            ...baseBody,
            schema_version: "videoforge-hosted-project-create/v3",
            video_coverage_percent: 0,
          },
          true,
          { "idempotency-key": "production-off-unavailable-00000001" },
        ),
        createEnvironment,
        disabled,
        executionContext,
      );
      expect(result?.status).toBe(409);
      expect(await errorCode(result)).toBe("SCENE_VIDEO_UNAVAILABLE");
      const preflight = await handleHostedProductRequest(
        request("/api/v2/hosted/projects/preflight", "POST", {
          ...baseBody,
          schema_version: "videoforge-hosted-project-preflight/v2",
          video_coverage_percent: 0,
        }),
        environment,
        disabled,
        executionContext,
      );
      expect(preflight?.status).toBe(200);
      expect(await preflight!.json()).toMatchObject({
        ok: false,
        ready: false,
        video_coverage_percent: 0,
        blockers: expect.arrayContaining([
          expect.objectContaining({ code: "SCENE_VIDEO_UNAVAILABLE", severity: "BLOCKING" }),
        ]),
      });
      expect(
        testState.query.mock.calls.some(
          ([sql]) =>
            sql.includes("INSERT INTO") || sql.includes("videoforge_pin_hosted_video_plan"),
        ),
      ).toBe(false);
    } finally {
      clearReadyPresets();
    }
  });

  it("600-second preflight adds opening footage to seven percent of the remaining duration", async () => {
    installReadyPresets();
    try {
      const result = await handleHostedProductRequest(
        request("/api/v2/hosted/projects/preflight", "POST", {
          ...baseBody,
          voiceover: { ...baseBody.voiceover, duration_ms: 600_000 },
          schema_version: "videoforge-hosted-project-preflight/v2",
          video_coverage_percent: 7,
        }),
        environment,
        coverageConfig,
        executionContext,
      );
      expect(result?.status).toBe(200);
      const body = (await result!.json()) as {
        ready: boolean;
        estimate: {
          motion: {
            requested_coverage_percent: number;
            required_opening_seconds: number;
            target_seconds: number;
            preliminary_usd: number;
          };
        };
      };
      expect(body.ready).toBe(true);
      expect(body.estimate.motion.requested_coverage_percent).toBe(7);
      expect(body.estimate.motion.required_opening_seconds).toBe(180);
      expect(body.estimate.motion.target_seconds).toBeCloseTo(209.4);
      expect(body.estimate.motion.preliminary_usd).toBeCloseTo(209.4 * 0.01336);
    } finally {
      clearReadyPresets();
    }
  });

  it("rejects fresh positive coverage while disabled before reservation and blocks preflight clearly", async () => {
    installReadyPresets();
    testState.query.mockClear();
    try {
      const disabled = { ...coverageConfig, videoGenerationEnabled: false };
      const result = await handleHostedProductRequest(
        request(
          "/api/v2/hosted/projects",
          "POST",
          {
            ...baseBody,
            schema_version: "videoforge-hosted-project-create/v3",
            video_coverage_percent: 75,
          },
          true,
          { "idempotency-key": "disabled-positive-0000000000000001" },
        ),
        createEnvironment,
        disabled,
        executionContext,
      );
      expect(result?.status).toBe(409);
      expect(await errorCode(result)).toBe("SCENE_VIDEO_UNAVAILABLE");
      const preflight = await handleHostedProductRequest(
        request("/api/v2/hosted/projects/preflight", "POST", {
          ...baseBody,
          schema_version: "videoforge-hosted-project-preflight/v2",
          video_coverage_percent: 75,
        }),
        environment,
        disabled,
        executionContext,
      );
      expect(await preflight!.json()).toMatchObject({
        ok: false,
        ready: false,
        video_coverage_percent: 75,
        blockers: expect.arrayContaining([
          expect.objectContaining({ code: "SCENE_VIDEO_UNAVAILABLE", severity: "BLOCKING" }),
        ]),
      });
      expect(
        testState.query.mock.calls.some(
          ([sql]) =>
            sql.includes("INSERT INTO") || sql.includes("videoforge_pin_hosted_video_plan"),
        ),
      ).toBe(false);
    } finally {
      clearReadyPresets();
    }
  });

  it.each(["staging", "production"] as const)(
    "replays the saved 75-percent request after %s feature disable without repinning or reserving",
    async (environmentName) => {
      installReadyPresets();
      testState.query.mockClear();
      try {
        const body = {
          ...baseBody,
          schema_version: "videoforge-hosted-project-create/v3",
          video_coverage_percent: 75,
        };
        const headers = { "idempotency-key": "coverage-replay-75-00000000000001" };
        const first = await handleHostedProductRequest(
          request("/api/v2/hosted/projects", "POST", body, true, headers),
          createEnvironment,
          coverageConfig,
          executionContext,
        );
        expect(first?.status).toBe(201);
        const created = (await first!.json()) as {
          project_id: string;
          project_revision_id: string;
        };
        const reservation = testState.query.mock.calls.find(([sql]) =>
          sql.includes("INSERT INTO artifact_reservations"),
        )![1]!;
        const savedHash = testState.query.mock.calls.find(([sql]) =>
          sql.includes("INSERT INTO hosted_project_create_requests"),
        )![1]![4];
        testState.createReplayRows.push({
          request_sha256: savedHash,
          state: "UPLOAD_PENDING",
          project_id: created.project_id,
          project_revision_id: created.project_revision_id,
          upload_reservation_id: reservation[0],
          object_key: reservation[6],
          content_type: reservation[7],
          content_length: reservation[8],
          checksum_sha256: reservation[9],
          expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
        });
        testState.query.mockClear();
        const replay = await handleHostedProductRequest(
          request("/api/v2/hosted/projects", "POST", body, true, headers),
          createEnvironment,
          {
            ...coverageConfig,
            environment: environmentName,
            videoGenerationEnabled: false,
            styleAnalysis: null,
          },
          executionContext,
        );
        expect(replay?.status).toBe(201);
        expect(await replay!.json()).toMatchObject({
          project_id: created.project_id,
          project_revision_id: created.project_revision_id,
          state: "UPLOAD_PENDING",
        });
        expect(
          testState.query.mock.calls.some(
            ([sql]) =>
              sql.includes("INSERT INTO") || sql.includes("videoforge_pin_hosted_video_plan"),
          ),
        ).toBe(false);
        const changed = await handleHostedProductRequest(
          request(
            "/api/v2/hosted/projects",
            "POST",
            { ...body, video_coverage_percent: 100 },
            true,
            headers,
          ),
          createEnvironment,
          { ...coverageConfig, environment: environmentName, videoGenerationEnabled: false },
          executionContext,
        );
        expect(changed?.status).toBe(409);
        expect(await errorCode(changed)).toBe("PROJECT_IDEMPOTENCY_CONFLICT");
      } finally {
        clearReadyPresets();
      }
    },
  );
});

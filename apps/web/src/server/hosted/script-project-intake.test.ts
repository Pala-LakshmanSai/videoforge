import { beforeEach, expect, it, vi } from "vitest";
import type { HostedRuntimeConfiguration, HostedRuntimeEnvironment } from "./configuration";

const fixture = vi.hoisted(() => ({
  accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  workspaceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  avatarVersionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  styleVersionId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  saved: null as Record<string, unknown> | null,
  sharedVoiceIds: [] as string[],
  sourceContentType: "image/png",
  sourceState: "VERIFIED",
  voices: vi.fn(),
  voicePost: vi.fn(),
  workflowCreate: vi.fn(),
  bucketPut: vi.fn(),
}));

const query = vi.hoisted(() =>
  vi.fn(async (sql: string, args: readonly unknown[] = []) => {
    if (sql.includes("videoforge_consume_hosted_rate_limit")) return { rows: [{ allowed: true }] };
    if (sql.includes("videoforge_hosted_session_scope"))
      return {
        rows: [
          {
            user_id: fixture.accountId,
            account_id: fixture.accountId,
            workspace_id: fixture.workspaceId,
          },
        ],
      };
    if (sql.includes("set_config") || sql.includes("pg_advisory_xact_lock")) return { rows: [] };
    if (sql.includes("SELECT * FROM hosted_script_projects"))
      return { rows: fixture.saved ? [fixture.saved] : [] };
    if (sql.includes("videoforge_saved_voices")) return { rows: [{ value: [] }] };
    if (sql.includes("videoforge_shared_saved_voice_collections"))
      return {
        rows: [
          {
            value: [
              {
                id: "other",
                name: "Other user",
                is_current_user: false,
                voice_ids: fixture.sharedVoiceIds,
              },
            ],
          },
        ],
      };
    if (sql.includes("LEFT JOIN assets AS runtime_source"))
      return {
        rows: [
          {
            source_state: fixture.sourceState,
            source_content_type: fixture.sourceContentType,
            object_key: `tenant/${fixture.accountId}/workspace/${fixture.workspaceId}/avatar-profile/avatar/version/${fixture.avatarVersionId}/canonical/avatar.png`,
          },
        ],
      };
    if (sql.includes("FROM avatar_profiles AS profile"))
      return { rows: [{ scope_kind: "WORKSPACE", version_id: fixture.avatarVersionId }] };
    if (sql.includes("FROM image_styles AS style"))
      return { rows: [{ scope_kind: "WORKSPACE", version_id: fixture.styleVersionId }] };
    if (sql.includes("INSERT INTO projects")) return { rows: [] };
    if (sql.includes("INSERT INTO hosted_script_projects")) {
      fixture.saved = {
        project_id: args[0],
        account_id: args[1],
        workspace_id: args[2],
        idempotency_key: args[3],
        request_sha256: args[4],
        options: JSON.parse(String(args[5])),
        script: args[6],
        voice_id: args[7],
        voice_name: args[8],
        voiceover_job_id: args[9],
        state: "WAITING",
      };
      return { rows: [fixture.saved] };
    }
    throw new Error(`Unexpected intake SQL: ${sql}`);
  }),
);

vi.mock("./neon", () => ({
  createNeonPool: () => ({ query, end: async () => {} }),
  createNeonExecutor: () => ({
    transaction: async (work: (sql: unknown) => unknown) => work({ query }),
  }),
}));
vi.mock("./auth", () => ({
  createHostedAuth: () => ({
    api: {
      getSession: async () => ({
        user: { id: fixture.accountId },
        session: { token: "fixture-session" },
      }),
    },
  }),
}));
vi.mock("./product", async () => {
  const actual = await vi.importActual<typeof import("./product")>("./product");
  return { ...actual, createProject: vi.fn(), commitProject: vi.fn() };
});
vi.mock("./j1tts", () => ({
  voices: fixture.voices,
  j1Fetch: fixture.voicePost,
  observeJ1Voiceover: fixture.voicePost,
}));
vi.mock("./app", () => ({ scheduleHostedAsrSubmission: vi.fn() }));
vi.mock("./pair-observer-guard", () => ({ ensureHostedContinuationDriver: vi.fn() }));

import { createScriptProject } from "./script-projects";

const config = {
  publicOrigin: "https://fixture.example",
  environment: "production",
  neon: { databaseUrl: "fixture" },
  videoGenerationEnabled: true,
  styleAnalysis: {},
  apiGeneration: {},
} as HostedRuntimeConfiguration;
const environment = {
  J1TTS_API_KEY: "fixture-only",
  HOSTED_CONTINUATION_WORKFLOW: { create: fixture.workflowCreate },
  PRIVATE_ARTIFACTS: { put: fixture.bucketPut },
} as unknown as HostedRuntimeEnvironment;
const context = { waitUntil: vi.fn() };

function body(enabled = true, seconds = 180) {
  return {
    schema_version: "videoforge-hosted-script-project/v2",
    title: "River intake",
    avatar_profile_version_id: fixture.avatarVersionId,
    image_style_version_id: fixture.styleVersionId,
    generation_mode: "LOWEST_COST",
    execution_backend: "PERSONAL_WORKER",
    user_seed: 42,
    video_coverage_percent: 23,
    ai_video_opening_enabled: enabled,
    ai_video_opening_seconds: seconds,
    script: "Every river begins in a small stream.",
    voice_id: "alice",
  };
}
async function intake(value: Record<string, unknown>, selectedConfig = config) {
  return createScriptProject(
    new Request(`${config.publicOrigin}/api/v2/hosted/script-projects`, {
      method: "POST",
      headers: {
        origin: config.publicOrigin,
        "content-type": "application/json",
        "idempotency-key": "script-intake-00000001",
      },
      body: JSON.stringify(value),
    }),
    environment,
    selectedConfig,
    context,
  );
}
function expectNoVoiceSpend() {
  expect(fixture.voicePost).not.toHaveBeenCalled();
  expect(fixture.bucketPut).not.toHaveBeenCalled();
}
function expectNoWrites() {
  expect(query.mock.calls.some(([sql]) => /INSERT INTO|UPDATE /u.test(sql))).toBe(false);
}
beforeEach(() => {
  fixture.saved = null;
  fixture.sharedVoiceIds = [];
  fixture.sourceContentType = "image/png";
  fixture.sourceState = "VERIFIED";
  vi.clearAllMocks();
  fixture.voices.mockResolvedValue([{ voice_id: "alice", name: "Alice", imported: false }]);
  fixture.voicePost.mockRejectedValue(new Error("Intake must never submit voice generation"));
  fixture.workflowCreate.mockResolvedValue({ id: "fixture-continuation" });
});

it("accepts another user's saved imported voice for video narration without provider submission", async () => {
  fixture.voices.mockResolvedValue([{ voice_id: "alice", name: "Alice", imported: true }]);
  fixture.sharedVoiceIds = ["alice"];
  expect((await intake(body())).status).toBe(202);
  expectNoVoiceSpend();
  fixture.saved = null;
  fixture.sharedVoiceIds = [];
  const unavailable = await intake(body());
  expect(unavailable.status).toBe(400);
  expect(await unavailable.json()).toMatchObject({ error: { code: "VOICE_NOT_FOUND" } });
});

it.each(["image/png", "image/jpeg", "image/webp"])(
  "accepts a verified %s avatar without submitting narration during intake",
  async (contentType) => {
    fixture.sourceContentType = contentType;
    expect((await intake(body())).status).toBe(202);
    expectNoVoiceSpend();
  },
);

it.each([
  ["image/webp", "UPLOADED"],
  ["image/svg+xml", "VERIFIED"],
])("rejects an unready avatar %s/%s with an actionable reason", async (contentType, state) => {
  fixture.sourceContentType = contentType;
  fixture.sourceState = state;
  const result = await intake(body());
  expect(result.status).toBe(409);
  expect(await result.json()).toMatchObject({
    error: {
      code: "AVATAR_RUNTIME_SOURCE_NOT_QUALIFIED",
      message: "Choose a ready Avatar Hub version with a verified image source.",
    },
  });
  expectNoWrites();
  expectNoVoiceSpend();
});

it.each([
  [true, 180],
  [true, 60],
  [true, 6],
  [false, 0],
])("intake persists exact opening %s/%s before voice generation", async (enabled, seconds) => {
  const result = await intake(body(enabled, seconds));
  expect(result.status).toBe(202);
  expect(fixture.saved?.options).toMatchObject({
    ai_video_opening_enabled: enabled,
    ai_video_opening_seconds: seconds,
    video_coverage_percent: 23,
    avatar_profile_version_id: fixture.avatarVersionId,
    image_style_version_id: fixture.styleVersionId,
    user_seed: 42,
  });
  expect(fixture.saved?.request_sha256).toMatch(/^sha256:[a-f0-9]{64}$/u);
  expect(query.mock.calls.some(([sql]) => sql.includes("LEFT JOIN assets AS runtime_source"))).toBe(
    true,
  );
  expect(fixture.voices).toHaveBeenCalledOnce();
  expectNoVoiceSpend();
});

it.each([
  { ai_video_opening_seconds: 0 },
  { ai_video_opening_seconds: 7 },
  { ai_video_opening_seconds: 3606 },
  { ai_video_opening_seconds: "180" },
  { ai_video_opening_enabled: "true" },
  { ai_video_opening_enabled: false },
  { ai_video_opening_seconds: undefined },
  { schema_version: "videoforge-hosted-script-project/v1" },
])("rejects malformed or legacy opening fields %j before voice lookup or writes", async (patch) => {
  const result = await intake({ ...body(), ...patch });
  expect(result.status).toBe(400);
  expect(await result.json()).toMatchObject({ error: { code: "SCRIPT_PROJECT_INVALID" } });
  expect(fixture.voices).not.toHaveBeenCalled();
  expectNoWrites();
  expectNoVoiceSpend();
});

it("retains v1 intake compatibility without acquiring configurable pins", async () => {
  const {
    ai_video_opening_enabled: _enabled,
    ai_video_opening_seconds: _seconds,
    ...legacy
  } = body();
  const result = await intake({ ...legacy, schema_version: "videoforge-hosted-script-project/v1" });
  expect(result.status).toBe(202);
  expect(fixture.saved?.options).not.toHaveProperty("ai_video_opening_enabled");
  expect(fixture.saved?.options).not.toHaveProperty("ai_video_opening_seconds");
  expect(fixture.saved?.options).toMatchObject({ video_coverage_percent: 23, user_seed: 42 });
  expectNoVoiceSpend();
});

it("replays the frozen request before changed availability and rejects opening identity drift", async () => {
  expect((await intake(body(true, 60))).status).toBe(202);
  const saved = structuredClone(fixture.saved);
  vi.clearAllMocks();
  const unavailable = { ...config, videoGenerationEnabled: false, styleAnalysis: null };
  const replay = await intake(body(true, 60), unavailable);
  expect(replay.status).toBe(202);
  expect(fixture.saved).toEqual(saved);
  expect(fixture.voices).not.toHaveBeenCalled();
  expectNoWrites();
  const changed = await intake(body(true, 180), unavailable);
  expect(changed.status).toBe(409);
  expect(await changed.json()).toMatchObject({ error: { code: "PROJECT_IDEMPOTENCY_CONFLICT" } });
  expect(fixture.saved).toEqual(saved);
  expectNoWrites();
  expectNoVoiceSpend();
});

it.each([
  [false, 0, 202],
  [true, 60, 409],
])(
  "provider unavailability admits only Off/zero intake %s/%s",
  async (enabled, seconds, status) => {
    const result = await intake(
      { ...body(enabled, seconds), video_coverage_percent: 0 },
      {
        ...config,
        videoGenerationEnabled: false,
        styleAnalysis: null,
      },
    );
    expect(result.status).toBe(status);
    if (status === 409) {
      expect(await result.json()).toMatchObject({ error: { code: "SCENE_VIDEO_UNAVAILABLE" } });
      expectNoWrites();
    } else
      expect(fixture.saved?.options).toMatchObject({
        ai_video_opening_enabled: false,
        ai_video_opening_seconds: 0,
      });
    expectNoVoiceSpend();
  },
);

it.each([true, false])(
  "script/v3 freezes avatar=%s without starting narration",
  async (avatarEnabled) => {
    const result = await intake({
      ...body(),
      schema_version: "videoforge-hosted-script-project/v3",
      avatar_enabled: avatarEnabled,
      avatar_profile_version_id: avatarEnabled ? fixture.avatarVersionId : null,
    });
    expect(result.status).toBe(202);
    expect(fixture.saved?.options).toMatchObject({
      avatar_enabled: avatarEnabled,
      avatar_profile_version_id: avatarEnabled ? fixture.avatarVersionId : null,
      ai_video_opening_seconds: 180,
      video_coverage_percent: 23,
    });
    if (!avatarEnabled)
      expect(
        query.mock.calls.some(([sql]) => sql.includes("LEFT JOIN assets AS runtime_source")),
      ).toBe(false);
    expectNoVoiceSpend();
  },
);

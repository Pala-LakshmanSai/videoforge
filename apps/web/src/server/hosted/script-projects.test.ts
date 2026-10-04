import { beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  intake: {} as Record<string, unknown>,
  job: null as Record<string, unknown> | null,
  busy: false,
  posts: 0,
  uncertain: false,
  observed: "PROCESSING",
  creates: 0,
  commits: 0,
  schedules: 0,
  failSchedule: false,
  stored: new Map<string, Uint8Array>(),
}));
const query = vi.hoisted(() =>
  vi.fn(async (sql: string, args: unknown[] = []) => {
    if (sql.includes("SELECT s.*")) return { rows: [{ ...fixture.intake }] };
    if (sql.includes("videoforge_queue_voiceover_job")) {
      if (fixture.busy) throw new Error("VOICEOVER_CAPACITY_BUSY");
      const claimed = fixture.job === null;
      fixture.job ??= { id: args[2], state: "WAITING", provider_job_id: null };
      return { rows: [{ value: { claimed, job: fixture.job } }] };
    }
    if (sql.includes("videoforge_record_voiceover_job")) {
      Object.assign(fixture.job!, {
        state: args[3],
        provider_job_id: args[4] ?? fixture.job!.provider_job_id,
      });
      return { rows: [] };
    }
    if (sql.includes("videoforge_read_voiceover_job")) return { rows: [{ job: fixture.job }] };
    if (sql.includes("SET state='GENERATING'")) fixture.intake.state = "GENERATING";
    if (sql.includes("SET state='PREPARING'")) fixture.intake.state = "PREPARING";
    if (sql.includes("SET state='COMPLETE'")) fixture.intake.state = "COMPLETE";
    if (sql.includes("SET state=$4")) fixture.intake.state = args[3];
    if (sql.includes("SET audio=$4")) fixture.intake.audio = JSON.parse(String(args[3]));
    return { rows: [{ project_id: fixture.intake.project_id }] };
  }),
);
vi.mock("./neon", () => ({
  createNeonPool: () => ({ query, end: async () => {} }),
  createNeonExecutor: () => ({
    transaction: async (work: (sql: unknown) => unknown) => work({ query }),
  }),
}));
vi.mock("./product", () => ({
  parseProjectOptions: vi.fn(),
  validateScriptProjectPresets: vi.fn(),
  createProject: async () => {
    fixture.creates++;
    return Response.json({ state: "UPLOAD_PENDING", object_key: "canonical-voiceover" });
  },
  commitProject: async () => {
    fixture.commits++;
    return Response.json({ cpu_submission: { idempotency_key: "same-asr" } });
  },
}));
vi.mock("./app", () => ({
  scheduleHostedAsrSubmission: async () => {
    fixture.schedules++;
    if (fixture.failSchedule) throw new Error("lost handoff response");
  },
}));
vi.mock("./pair-observer-guard", () => ({ ensureHostedContinuationDriver: vi.fn() }));
vi.mock("./stage-continuation-sweep", () => ({
  resolveContinuationConfiguration: async () => ({ publicOrigin: "https://fixture.example" }),
}));
vi.mock("./j1tts", async () => {
  const actual = await vi.importActual<typeof import("./j1tts")>("./j1tts");
  return {
    ...actual,
    observeJ1Voiceover: async () => {
      if (fixture.job?.state === "WAITING") {
        fixture.posts++;
        fixture.job.state = fixture.uncertain ? "UNKNOWN_NO_RETRY" : "PROCESSING";
        if (!fixture.uncertain) fixture.job.provider_job_id = "provider-job";
      }
      return fixture.job?.state === "UNKNOWN_NO_RETRY" ? "UNKNOWN_NO_RETRY" : fixture.observed;
    },
    j1Fetch: async (_key: string, _path: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        fixture.posts++;
        if (fixture.uncertain) throw new actual.J1Error("J1TTS_NETWORK_UNCERTAIN", true);
        return Response.json({ id: "provider-job" });
      }
      const bytes = new Uint8Array(600 * 417);
      for (let i = 0; i < 600; i++) bytes.set([255, 251, 144, 0], i * 417);
      return new Response(bytes, { headers: { "content-length": String(bytes.length) } });
    },
  };
});
import { advanceScriptProject } from "./script-projects";
const target = {
  accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  workspaceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  projectId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
};
const environment = {
  DATABASE_URL: "fixture",
  J1TTS_API_KEY: "fixture-only",
  PRIVATE_ARTIFACTS: {
    async put(key: string, value: ReadableStream) {
      fixture.stored.set(key, new Uint8Array(await new Response(value).arrayBuffer()));
    },
    async get(key: string) {
      const bytes = fixture.stored.get(key);
      return bytes
        ? {
            size: bytes.length,
            body: new Response(bytes.slice().buffer).body,
            arrayBuffer: async () => bytes.buffer,
          }
        : null;
    },
    async delete(key: string) {
      fixture.stored.delete(key);
    },
  },
};
beforeEach(() => {
  Object.assign(fixture, {
    intake: {
      project_id: target.projectId,
      account_id: target.accountId,
      workspace_id: target.workspaceId,
      user_id: "user",
      state: "WAITING",
      voiceover_job_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      script: "Every river begins.",
      voice_id: "alice",
      voice_name: "Alice",
      options: { title: "River" },
      audio: null,
    },
    job: null,
    busy: false,
    posts: 0,
    uncertain: false,
    observed: "PROCESSING",
    creates: 0,
    commits: 0,
    schedules: 0,
    failSchedule: false,
  });
  fixture.stored.clear();
  query.mockClear();
  vi.stubGlobal(
    "FixedLengthStream",
    class extends TransformStream<Uint8Array, Uint8Array> {
      constructor(_length: number) {
        super();
      }
    },
  );
});
const advance = () => advanceScriptProject(environment as never, target, { waitUntil() {} });
it("waits durably for capacity and never posts while busy", async () => {
  fixture.busy = true;
  expect(await advance()).toBe("WAITING");
  expect(fixture.posts).toBe(0);
  expect(fixture.intake.state).toBe("WAITING");
  fixture.busy = false;
  expect(await advance()).toBe("GENERATING");
  expect(fixture.posts).toBe(1);
  await advance();
  expect(fixture.posts).toBe(1);
});
it("does not replay a claimed submission after process loss", async () => {
  fixture.intake.state = "GENERATING";
  fixture.job = { state: "SUBMITTING", provider_job_id: null };
  await advance();
  expect(fixture.posts).toBe(0);
});
it("stops an ambiguous submission without replacement on refresh", async () => {
  fixture.uncertain = true;
  expect(await advance()).toBe("UNKNOWN_NO_RETRY");
  await advance();
  expect(fixture.posts).toBe(1);
  expect(fixture.schedules).toBe(0);
});
it("persists narration and automatically resumes the same ASR handoff after a lost response", async () => {
  await advance();
  fixture.observed = "COMPLETED";
  fixture.failSchedule = true;
  await expect(advance()).rejects.toThrow("lost handoff response");
  expect(fixture.intake.audio).toBeTruthy();
  expect(fixture.posts).toBe(1);
  fixture.failSchedule = false;
  expect(await advance()).toBe("COMPLETE");
  expect(fixture.posts).toBe(1);
  expect(fixture.schedules).toBe(2);
  expect(fixture.stored.has("canonical-voiceover")).toBe(true);
  await advance();
  expect(fixture.schedules).toBe(2);
});
it.each(["CANCELLED", "FAILED", "COMPLETE"])(
  "never starts narration for %s intake",
  async (state) => {
    fixture.intake.state = state;
    expect(await advance()).toBe(state);
    expect(fixture.posts).toBe(0);
  },
);

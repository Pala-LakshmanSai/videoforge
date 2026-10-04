import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { HostedRuntimeConfiguration, HostedRuntimeEnvironment } from "./configuration";
const state = vi.hoisted(() => ({
  jobs: new Map<string, Record<string, unknown>>(),
  saved: new Map<string, unknown[]>(),
  account: "account-a",
  authenticated: true,
  query: vi.fn(),
}));
vi.mock("./neon", () => ({ createNeonPool: () => ({ query: state.query, end: vi.fn() }) }));
vi.mock("./hosted-product-route-common", async () => {
  const actual = await vi.importActual<typeof import("./hosted-product-route-common")>(
    "./hosted-product-route-common",
  );
  return {
    ...actual,
    sessionScope: vi.fn(async () =>
      state.authenticated
        ? { account_id: state.account, workspace_id: "workspace", user_id: "user" }
        : Response.json({ error: { code: "AUTHENTICATION_REQUIRED" } }, { status: 401 }),
    ),
  };
});
import { handleJ1Voiceover } from "./j1tts";
const origin = "https://videoforge.test",
  config = {
    publicOrigin: origin,
    neon: { databaseUrl: "private-url" },
  } as HostedRuntimeConfiguration;
const id = "11111111-1111-4111-8111-111111111111";
let calls: string[] = [];
function req(path = "/jobs", body?: unknown, source = origin) {
  return new Request(
    origin + "/api/v2/voiceovers" + path,
    body
      ? {
          method: "POST",
          headers: { origin: source, "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      : {},
  );
}
const body = {
  id,
  script: "A complete narration for our voiceover.",
  voice_id: "global",
  filename: "demo.mp3",
};
let environment: HostedRuntimeEnvironment;
const context = { waitUntil: vi.fn() };
beforeEach(() => {
  state.jobs.clear();
  state.saved.clear();
  state.account = "account-a";
  state.authenticated = true;
  calls = [];
  environment = {
    J1TTS_API_KEY: crypto.randomUUID(),
    J1TTS_LIBRARY_OWNER_ACCOUNT_ID: "account-a",
    HOSTED_CONTINUATION_WORKFLOW: { create: vi.fn(async () => ({ id: "observer" })) } as never,
  };
  state.query.mockImplementation(async (sql: string, args: unknown[] = []) => {
    let value: unknown = null;
    const [a, w, j] = args;
    if (sql.includes("saved_voices")) value = state.saved.get(String(a)) ?? [];
    else if (sql.includes("queue_voiceover_job")) {
      const previous = state.jobs.get(String(j));
      if (previous) {
        if (previous.account_id !== a || previous.request_hash !== args[3])
          throw Error("VOICEOVER_REQUEST_CONFLICT");
        value = { claimed: false, job: previous };
      } else {
        const job = {
          id: j,
          account_id: a,
          workspace_id: w,
          request_hash: args[3],
          script: args[4],
          voice_id: args[5],
          filename: args[6],
          state: "WAITING",
          provider_job_id: null,
          failure_code: null,
          created_at: new Date().toISOString(),
        };
        state.jobs.set(String(j), job);
        value = { claimed: true, job };
      }
    } else if (sql.includes("claim_voiceover_submission")) {
      const job = state.jobs.get(String(j));
      if (
        job &&
        job.account_id === a &&
        job.state === "WAITING" &&
        (!job.next_attempt_at || Date.parse(String(job.next_attempt_at)) <= Date.now())
      ) {
        Object.assign(job, {
          state: "SUBMITTING",
          submit_claim_id: args[3],
          submission_started_at: new Date().toISOString(),
        });
        value = job;
      }
    } else if (sql.includes("finish_voiceover_submission")) {
      const job = state.jobs.get(String(j));
      if (job && job.account_id === a && job.submit_claim_id === args[3]) {
        Object.assign(job, {
          state: args[4],
          provider_job_id: args[5],
          failure_code: args[6],
          next_attempt_at: new Date(Date.now() + Number(args[7] ?? 0)).toISOString(),
        });
        value = job;
      }
    } else if (sql.includes("read_voiceover_job")) {
      const job = j ? state.jobs.get(String(j)) : [...state.jobs.values()].at(-1);
      value = job?.account_id === a ? job : null;
    } else if (sql.includes("record_voiceover_job")) {
      const job = state.jobs.get(String(j));
      if (job && job.account_id === a) {
        Object.assign(job, {
          state: args[3],
          provider_job_id: job.provider_job_id ?? args[4],
          failure_code: args[5],
        });
        value = job;
      }
    }
    return { rows: [{ value, job: value }], affectedRows: 1 };
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL) => {
      const path = new URL(String(url)).pathname;
      calls.push(path);
      if (path === "/v1/voices")
        return Response.json({ voices: [{ voice_id: "global", name: "Global" }] });
      if (path === "/v1/my-voices")
        return Response.json({ voices: [{ voice_id: "private", name: "Private Imported" }] });
      if (path === "/v1/tts") return Response.json({ id: "provider-job", status: "processing" });
      if (path.endsWith("/download"))
        return new Response(new Uint8Array([1, 2]), { headers: { "content-type": "audio/mpeg" } });
      return Response.json({
        id: "provider-job",
        status: "completed",
        download_url: "https://evil.test/steal-key",
      });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());
it("authenticates and rejects foreign origin before provider access", async () => {
  state.authenticated = false;
  expect((await handleJ1Voiceover(req(), environment, config, context)).status).toBe(401);
  state.authenticated = true;
  expect(
    (await handleJ1Voiceover(req("/jobs", body, "https://evil.test"), environment, config, context))
      .status,
  ).toBe(403);
  expect(calls).toEqual([]);
});
it("persists one request before submission and reuses its exact provider identity", async () => {
  expect((await handleJ1Voiceover(req("/jobs", body), environment, config, context)).status).toBe(
    202,
  );
  expect(state.jobs.get(id)?.provider_job_id).toBe("provider-job");
  await handleJ1Voiceover(req("/jobs", body), environment, config, context);
  expect(calls.filter((x) => x === "/v1/tts")).toHaveLength(1);
  const conflict = await handleJ1Voiceover(
    req("/jobs", { ...body, script: "changed" }),
    environment,
    config,
    context,
  );
  expect(conflict.status).toBe(409);
  const done = await handleJ1Voiceover(req("/jobs/" + id), environment, config, context);
  expect(((await done.json()) as { job: { state: string } }).job.state).toBe("COMPLETED");
  const audio = await handleJ1Voiceover(
    req("/jobs/" + id + "/audio"),
    environment,
    config,
    context,
  );
  expect(audio.status).toBe(200);
  expect(calls.at(-1)).toBe("/v1/tts/provider-job/download");
  expect(calls).not.toContain("/steal-key");
});
it("holds ambiguous request without repeating POST", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL) => {
      const path = new URL(String(url)).pathname;
      calls.push(path);
      if (path === "/v1/tts") throw TypeError("lost response");
      return Response.json({ voices: [{ voice_id: "global", name: "Global" }] });
    }),
  );
  const first = await handleJ1Voiceover(req("/jobs", body), environment, config, context);
  expect(((await first.json()) as { job: { state: string } }).job.state).toBe("UNKNOWN_NO_RETRY");
  await handleJ1Voiceover(req("/jobs", body), environment, config, context);
  expect(calls.filter((x) => x === "/v1/tts")).toHaveLength(1);
});
it("hides owner imported voices and jobs from other tenants", async () => {
  await handleJ1Voiceover(req("/jobs", body), environment, config, context);
  state.account = "account-b";
  const catalog = await handleJ1Voiceover(req("/voices"), environment, config, context);
  expect(
    ((await catalog.json()) as { voices: { voice_id: string }[] }).voices.map(
      (v: { voice_id: string }) => v.voice_id,
    ),
  ).toEqual(["global"]);
  expect((await handleJ1Voiceover(req("/jobs/" + id), environment, config, context)).status).toBe(
    404,
  );
  expect(
    (await handleJ1Voiceover(req("/jobs/" + id + "/audio"), environment, config, context)).status,
  ).toBe(404);
  expect(
    (
      await handleJ1Voiceover(
        req("/jobs", { ...body, id: "22222222-2222-4222-8222-222222222222", voice_id: "private" }),
        environment,
        config,
        context,
      )
    ).status,
  ).toBe(400);
  expect(calls.filter((x) => x === "/v1/tts")).toHaveLength(1);
});

it("persists confirmed 429 as waiting and retries only after the saved due time", async () => {
  const original = globalThis.fetch;
  let reject = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (new URL(String(url)).pathname === "/v1/tts" && reject) {
        calls.push("/v1/tts");
        return new Response(null, { status: 429, headers: { "retry-after": "12" } });
      }
      return original(url, init);
    }),
  );
  const first = await handleJ1Voiceover(req("/jobs", body), environment, config, context);
  expect(((await first.json()) as { job: { state: string } }).job.state).toBe("WAITING");
  expect(state.jobs.get(id)?.failure_code).toBe("J1TTS_RATE_LIMITED");
  await handleJ1Voiceover(req("/jobs/" + id), environment, config, context);
  expect(calls.filter((x) => x === "/v1/tts")).toHaveLength(1);
  state.jobs.get(id)!.next_attempt_at = new Date(0).toISOString();
  reject = false;
  await handleJ1Voiceover(req("/jobs/" + id), environment, config, context);
  expect(state.jobs.get(id)?.state).toBe("PROCESSING");
  expect(calls.filter((x) => x === "/v1/tts")).toHaveLength(2);
});

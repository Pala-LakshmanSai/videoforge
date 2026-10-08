import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { HostedRuntimeConfiguration, HostedRuntimeEnvironment } from "./configuration";
const state = vi.hoisted(() => ({
  jobs: new Map<string, Record<string, unknown>>(),
  assets: new Map<string, Record<string, unknown>>(),
  saved: new Map<string, unknown[]>(),
  collections: [] as {
    id: string;
    name: string;
    email?: string;
    is_current_user: boolean;
    voice_ids: string[];
  }[],
  account: "account-a",
  authenticated: true,
  query: vi.fn(),
  workflow: {
    create: vi.fn(),
    get: vi.fn(),
  },
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
import { handleJ1Voiceover, observeJ1Voiceover } from "./j1tts";
const origin = "https://videoforge.test",
  config = {
    publicOrigin: origin,
    neon: { databaseUrl: "private-url" },
  } as HostedRuntimeConfiguration;
const id = "11111111-1111-4111-8111-111111111111";
let calls: string[] = [];
let failProcessingFinish = false;
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
  state.assets.clear();
  state.saved.clear();
  state.collections = [];
  state.account = "account-a";
  state.authenticated = true;
  calls = [];
  failProcessingFinish = false;
  state.query.mockClear();
  state.workflow.create.mockReset().mockImplementation(async (options?: { id?: string }) => ({
    id: options?.id ?? "observer",
  }));
  state.workflow.get.mockReset().mockResolvedValue({
    status: vi.fn(async () => ({ status: "running" })),
    sendEvent: vi.fn(async () => undefined),
  });
  environment = {
    J1TTS_API_KEY: crypto.randomUUID(),
    J1TTS_LIBRARY_OWNER_ACCOUNT_ID: "account-a",
    PRIVATE_ARTIFACTS: {} as never,
    HOSTED_CONTINUATION_WORKFLOW: state.workflow as never,
  };
  state.query.mockImplementation(async (sql: string, args: unknown[] = []) => {
    let value: unknown = null;
    const [a, w, j] = args;
    const standaloneQueue = sql.includes("queue_standalone_voiceover");
    const jobId = standaloneQueue ? args[3] : j;
    if (sql.includes("shared_saved_voice_collections")) value = state.collections;
    else if (sql.includes("saved_voices")) value = state.saved.get(String(a)) ?? [];
    else if (sql.includes("videoforge_save_voice")) {
      state.saved.set(String(a), [
        { voice_id: j, saved: args[3], starred: args[4], imported: false },
      ]);
      value = true;
    } else if (standaloneQueue || sql.includes("queue_voiceover_job")) {
      const previous = state.jobs.get(String(jobId));
      const hash = standaloneQueue ? args[4] : args[3];
      const script = standaloneQueue ? args[5] : args[4];
      const voiceId = standaloneQueue ? args[6] : args[5];
      const filename = standaloneQueue ? args[7] : args[6];
      if (previous) {
        if (previous.account_id !== a || previous.request_hash !== hash)
          throw Error("VOICEOVER_REQUEST_CONFLICT");
        value = { claimed: false, job: previous };
      } else {
        const job = {
          id: jobId,
          account_id: a,
          workspace_id: w,
          request_hash: hash,
          script,
          voice_id: voiceId,
          filename,
          state: "WAITING",
          provider_job_id: null,
          failure_code: null,
          created_at: new Date().toISOString(),
        };
        state.jobs.set(String(jobId), job);
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
        if (args[4] === "PROCESSING" && failProcessingFinish) {
          failProcessingFinish = false;
          throw new Error("finish database response lost");
        }
        Object.assign(job, {
          state: args[4],
          provider_job_id: args[5],
          failure_code: args[6],
          next_attempt_at: new Date(Date.now() + Number(args[7] ?? 0)).toISOString(),
        });
        value = job;
      }
    } else if (sql.includes("read_voiceover_library_asset")) {
      value = state.assets.get(String(j)) ?? null;
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
it("returns queued standalone requests before provider submission and schedules each exact job", async () => {
  const first = {
    ...body,
    id: "22222222-2222-4222-8222-222222222222",
    title: "Morning brief",
  };
  const second = {
    ...body,
    id: "33333333-3333-4333-8333-333333333333",
    title: "Evening brief",
  };
  expect((await handleJ1Voiceover(req("/jobs", first), environment, config, context)).status).toBe(
    202,
  );
  expect((await handleJ1Voiceover(req("/jobs", second), environment, config, context)).status).toBe(
    202,
  );
  expect(state.jobs.get(first.id)?.state).toBe("WAITING");
  expect(state.jobs.get(second.id)?.state).toBe("WAITING");
  expect(calls.filter((path) => path === "/v1/tts")).toHaveLength(0);
  expect(state.workflow.create).toHaveBeenCalledWith(
    expect.objectContaining({ id: `voiceover-${first.id}` }),
  );
  expect(state.workflow.create).toHaveBeenCalledWith(
    expect.objectContaining({ id: `voiceover-${second.id}` }),
  );
});
it("accepts an idempotent observer-create conflict only after confirming its exact instance", async () => {
  state.workflow.create.mockImplementation(async (options?: { id?: string }) => {
    if (options?.id?.startsWith("voiceover-")) throw new Error("workflow already exists");
    return { id: options?.id ?? "observer" };
  });
  const result = await handleJ1Voiceover(
    req("/jobs", {
      ...body,
      id: "44444444-4444-4444-8444-444444444444",
      title: "Existing observer",
    }),
    environment,
    config,
    context,
  );
  expect(result.status).toBe(202);
  expect(state.workflow.get).toHaveBeenCalledWith("voiceover-44444444-4444-4444-8444-444444444444");
  expect(calls.filter((path) => path === "/v1/tts")).toHaveLength(0);
});
it("surfaces unknown observer scheduling failure while retaining the saved request", async () => {
  state.workflow.create.mockRejectedValue(new Error("workflow unavailable"));
  state.workflow.get.mockRejectedValue(new Error("workflow missing"));
  const result = await handleJ1Voiceover(
    req("/jobs", {
      ...body,
      id: "55555555-5555-4555-8555-555555555555",
      title: "Needs retry",
    }),
    environment,
    config,
    context,
  );
  expect(result.status).toBe(503);
  expect(await result.json()).toMatchObject({
    error: { code: "VOICEOVER_SCHEDULING_UNAVAILABLE" },
  });
  expect(state.jobs.get("55555555-5555-4555-8555-555555555555")?.state).toBe("WAITING");
  expect(calls.filter((path) => path === "/v1/tts")).toHaveLength(0);
});
it("does not accept a terminal observer as a live scheduling acknowledgement", async () => {
  state.workflow.create.mockImplementation(async (options?: { id?: string }) => {
    if (options?.id?.startsWith("voiceover-")) throw new Error("workflow already exists");
    return { id: options?.id ?? "observer" };
  });
  state.workflow.get.mockResolvedValue({
    status: vi.fn(async () => ({ status: "errored" })),
    sendEvent: vi.fn(async () => undefined),
  });
  const result = await handleJ1Voiceover(
    req("/jobs", {
      ...body,
      id: "66666666-6666-4666-8666-666666666666",
      title: "Terminal observer",
    }),
    environment,
    config,
    context,
  );
  expect(result.status).toBe(503);
  expect(await result.json()).toMatchObject({
    error: { code: "VOICEOVER_SCHEDULING_UNAVAILABLE" },
  });
  expect(state.jobs.get("66666666-6666-4666-8666-666666666666")?.state).toBe("WAITING");
});
it("does not accept a completed observer as a live acknowledgement for a pending job", async () => {
  state.workflow.create.mockImplementation(async (options?: { id?: string }) => {
    if (options?.id?.startsWith("voiceover-")) throw new Error("workflow already exists");
    return { id: options?.id ?? "observer" };
  });
  state.workflow.get.mockResolvedValue({
    status: vi.fn(async () => ({ status: "complete" })),
    sendEvent: vi.fn(async () => undefined),
  });
  const result = await handleJ1Voiceover(
    req("/jobs", {
      ...body,
      id: "77777777-7777-4777-8777-777777777777",
      title: "Completed observer",
    }),
    environment,
    config,
    context,
  );
  expect(result.status).toBe(503);
  expect(await result.json()).toMatchObject({
    error: { code: "VOICEOVER_SCHEDULING_UNAVAILABLE" },
  });
  expect(state.jobs.get("77777777-7777-4777-8777-777777777777")?.state).toBe("WAITING");
});
it("returns a completed standalone identity without requiring a fresh observer", async () => {
  const standalone = {
    ...body,
    id: "88888888-8888-4888-8888-888888888888",
    title: "Already complete",
  };
  expect(
    (await handleJ1Voiceover(req("/jobs", standalone), environment, config, context)).status,
  ).toBe(202);
  const job = state.jobs.get(standalone.id);
  expect(job).toBeTruthy();
  job!.state = "COMPLETED";
  state.workflow.create.mockClear();
  state.workflow.get.mockClear();
  const result = await handleJ1Voiceover(req("/jobs", standalone), environment, config, context);
  expect(result.status).toBe(200);
  expect(((await result.json()) as { job: { state: string } }).job.state).toBe("COMPLETED");
  expect(state.workflow.create).not.toHaveBeenCalled();
  expect(state.workflow.get).not.toHaveBeenCalled();
});
it("re-establishes a missing standalone observer on a waiting-job GET", async () => {
  const standaloneId = "99999999-9999-4999-8999-999999999999";
  state.jobs.set(standaloneId, {
    id: standaloneId,
    account_id: "account-a",
    workspace_id: "workspace",
    request_hash: "sha256:waiting",
    script: body.script,
    voice_id: body.voice_id,
    filename: body.filename,
    state: "WAITING",
    provider_job_id: null,
    failure_code: null,
    created_at: new Date().toISOString(),
  });
  state.assets.set(standaloneId, { deleted_at: null });
  const result = await handleJ1Voiceover(
    req("/jobs/" + standaloneId),
    environment,
    config,
    context,
  );
  expect(result.status).toBe(200);
  expect(((await result.json()) as { job: { state: string } }).job.state).toBe("WAITING");
  expect(state.workflow.create).toHaveBeenCalledWith(
    expect.objectContaining({ id: `voiceover-${standaloneId}` }),
  );
  expect(calls.filter((path) => path === "/v1/tts")).toHaveLength(0);
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
it("retains a known provider identity when the first PROCESSING receipt fails", async () => {
  failProcessingFinish = true;
  const first = await handleJ1Voiceover(req("/jobs", body), environment, config, context);
  expect(first.status).toBe(202);
  expect(state.jobs.get(id)).toMatchObject({
    state: "UNKNOWN_NO_RETRY",
    provider_job_id: "provider-job",
  });
  expect(calls.filter((path) => path === "/v1/tts")).toHaveLength(1);

  const recovered = await handleJ1Voiceover(req("/jobs/" + id), environment, config, context);
  expect(recovered.status).toBe(200);
  expect(state.jobs.get(id)?.state).toBe("COMPLETED");
  expect(calls.filter((path) => path === "/v1/tts")).toHaveLength(1);
});
it("does not submit a waiting job when a GET only observes its status", async () => {
  state.jobs.set(id, {
    id,
    account_id: "account-a",
    workspace_id: "workspace",
    request_hash: "sha256:waiting",
    script: body.script,
    voice_id: body.voice_id,
    filename: body.filename,
    state: "WAITING",
    provider_job_id: null,
    failure_code: null,
    created_at: new Date().toISOString(),
  });
  const result = await handleJ1Voiceover(req("/jobs/" + id), environment, config, context);
  expect(result.status).toBe(200);
  expect(((await result.json()) as { job: { state: string } }).job.state).toBe("WAITING");
  expect(state.jobs.get(id)?.state).toBe("WAITING");
  expect(calls).toEqual([]);
  expect(
    state.query.mock.calls.some(([sql]) => String(sql).includes("claim_voiceover_submission")),
  ).toBe(false);
});
it("keeps ordinary completed narration free of archive storage and provider work", async () => {
  state.jobs.set(id, {
    id,
    account_id: "account-a",
    workspace_id: "workspace",
    request_hash: "sha256:ordinary",
    script: body.script,
    voice_id: body.voice_id,
    filename: body.filename,
    state: "COMPLETED",
    provider_job_id: "ordinary-provider-job",
    failure_code: null,
    created_at: new Date().toISOString(),
  });
  const bucket = {
    head: vi.fn(),
    get: vi.fn(),
    put: vi.fn(),
    list: vi.fn(),
    delete: vi.fn(),
  };
  const result = await handleJ1Voiceover(
    req("/jobs/" + id),
    { ...environment, PRIVATE_ARTIFACTS: bucket as never },
    config,
    context,
  );
  expect(result.status).toBe(200);
  expect(((await result.json()) as { job: { state: string } }).job.state).toBe("COMPLETED");
  expect(calls).toEqual([]);
  expect(bucket.head).not.toHaveBeenCalled();
  expect(bucket.get).not.toHaveBeenCalled();
  expect(bucket.put).not.toHaveBeenCalled();
  expect(bucket.list).not.toHaveBeenCalled();
  expect(bucket.delete).not.toHaveBeenCalled();
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

it("shares explicitly saved imported voices while keeping stars and generated jobs private", async () => {
  state.account = "account-b";
  state.collections = [
    {
      id: "account-a",
      name: "User A",
      email: "voice-a@example.test",
      is_current_user: false,
      voice_ids: ["private"],
    },
  ];
  const result = await handleJ1Voiceover(req("/voices"), environment, config, context);
  const catalog = (await result.json()) as {
    voices: { voice_id: string; saved: boolean; starred: boolean }[];
    collections: unknown[];
  };
  expect(result.status).toBe(200);
  expect(catalog.voices.find((voice) => voice.voice_id === "private")).toMatchObject({
    saved: false,
    starred: false,
  });
  expect(catalog.collections).toEqual(state.collections);
  expect(calls).not.toContain("/v1/tts");
  const save = await handleJ1Voiceover(
    req("/voices/private", { saved: true, starred: true }),
    environment,
    config,
    context,
  );
  expect(save.status).toBe(200);
  expect(state.saved.has("account-a")).toBe(false);
  // The viewer's own save retains availability after the source removes it.
  state.collections = [];
  const retained = await handleJ1Voiceover(req("/voices"), environment, config, context);
  expect(
    ((await retained.json()) as { voices: { voice_id: string }[] }).voices.map(
      (voice) => voice.voice_id,
    ),
  ).toContain("private");
  expect(
    (
      await handleJ1Voiceover(
        req("/jobs", { ...body, voice_id: "private", title: "Shared voice" }),
        environment,
        config,
        context,
      )
    ).status,
  ).toBe(202);
  expect(calls).not.toContain("/v1/tts");
  state.account = "account-a";
  expect((await handleJ1Voiceover(req("/jobs/" + id), environment, config, context)).status).toBe(
    404,
  );
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
  await observeJ1Voiceover(environment, {
    accountId: "account-a",
    workspaceId: "workspace",
    jobId: id,
  });
  expect(state.jobs.get(id)?.state).toBe("PROCESSING");
  expect(calls.filter((x) => x === "/v1/tts")).toHaveLength(2);
});

it("saves an existing provider voice without importing it again", async () => {
  await handleJ1Voiceover(req("/voices"), environment, config, context);
  calls = [];
  vi.mocked(fetch).mockImplementation(async (url) => {
    const path = new URL(String(url)).pathname;
    calls.push(path);
    if (path === "/v1/voices") return Response.json({ voices: [] });
    if (path === "/v1/my-voices")
      return Response.json({ voices: [{ voice_id: "lxYfHSkYm1EzQzGhdbfc", name: "Jessica" }] });
    return Response.json({ failed: [{ error: "already_imported" }] }, { status: 400 });
  });
  state.account = "account-b";
  const result = await handleJ1Voiceover(
    req("/import", { voice_id: "lxYfHSkYm1EzQzGhdbfc" }),
    environment,
    config,
    context,
  );
  expect(result.status).toBe(200);
  expect(await result.json()).toEqual({ voice_id: "lxYfHSkYm1EzQzGhdbfc" });
  expect(calls).not.toContain("/v1/voices/import");
  expect(state.query).toHaveBeenCalledWith(expect.stringContaining("videoforge_import_voice"), [
    "account-b",
    "workspace",
    "lxYfHSkYm1EzQzGhdbfc",
  ]);
});

it.each(["success", "duplicate", "uncertain"])(
  "reconciles a new %s import by exact ID",
  async (outcome) => {
    let available = false;
    vi.mocked(fetch).mockImplementation(async (url) => {
      const path = new URL(String(url)).pathname;
      calls.push(path);
      if (path === "/v1/voices") return Response.json({ voices: [] });
      if (path === "/v1/my-voices")
        return Response.json({ voices: available ? [{ voice_id: "new", name: "New" }] : [] });
      available = true;
      if (outcome === "uncertain") throw new TypeError("connection lost after acceptance");
      return Response.json(
        { ok: outcome === "success" },
        { status: outcome === "success" ? 200 : 400 },
      );
    });
    const result = await handleJ1Voiceover(
      req("/import", { voice_id: "new" }),
      environment,
      config,
      context,
    );
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ voice_id: "new" });
    expect(calls.filter((path) => path === "/v1/voices/import")).toHaveLength(1);
    expect(state.query).toHaveBeenCalledWith(expect.stringContaining("videoforge_import_voice"), [
      "account-a",
      "workspace",
      "new",
    ]);
  },
);

it("does not save a failed import or substitute another voice", async () => {
  vi.mocked(fetch).mockImplementation(async (url) => {
    const path = new URL(String(url)).pathname;
    calls.push(path);
    if (path === "/v1/voices") return Response.json({ voices: [] });
    if (path === "/v1/my-voices")
      return Response.json({ voices: [{ voice_id: "other", name: "Other" }] });
    return Response.json({ failed: [{ error: "not_found" }] }, { status: 400 });
  });
  const result = await handleJ1Voiceover(
    req("/import", { voice_id: "missing" }),
    environment,
    config,
    context,
  );
  expect(result.status).toBe(503);
  expect(await result.json()).toMatchObject({
    error: { message: expect.stringContaining("import") },
  });
  expect(calls.filter((path) => path === "/v1/voices/import")).toHaveLength(1);
  expect(state.query.mock.calls.some(([sql]) => sql.includes("videoforge_import_voice"))).toBe(
    false,
  );
});

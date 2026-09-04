import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { DecompressionStream as NodeDecompressionStream } from "node:stream/web";

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { HostedR2BucketBinding } from "../hosted/configuration";
import { handleV207DisposableOutputPort } from "../hosted/v207-disposable-output-ports";

import {
  runV207DisposableLiveOrchestration,
  V207_DISPOSABLE_CONFIG,
  V207_DISPOSABLE_QUALIFICATION,
  V207_DISPOSABLE_ROUTE,
  V207_DISPOSABLE_SECRET_NAME,
  V207_DISPOSABLE_WORKER_NAME,
  V207_ROUTE_VERSION_HEADER,
  type V207DisposableOrchestratorOptions,
} from "./v207-disposable-live-orchestrator";
import type { V207CommandRequest, V207CommandResult } from "./v207-live-orchestrator";

const NONCE = "a".repeat(64);
const VERSION_ID = "11111111-1111-4111-8111-111111111111";
const PREDECESSOR_VERSION_ID = "22222222-2222-4222-8222-222222222222";
const roots: string[] = [];

beforeAll(() => vi.stubGlobal("DecompressionStream", NodeDecompressionStream));

function memoryBucket(): HostedR2BucketBinding {
  const objects = new Map<string, { bytes: Uint8Array; contentType?: string }>();
  return {
    async head(key) {
      const value = objects.get(key);
      return value
        ? { size: value.bytes.byteLength, httpMetadata: { contentType: value.contentType } }
        : null;
    },
    async get(key) {
      const value = objects.get(key);
      return value
        ? {
            size: value.bytes.byteLength,
            httpMetadata: { contentType: value.contentType },
            async arrayBuffer() {
              return value.bytes.slice().buffer as ArrayBuffer;
            },
          }
        : null;
    },
    async put(key, body, options) {
      const bytes =
        typeof body === "string"
          ? new TextEncoder().encode(body)
          : body instanceof ReadableStream
            ? new Uint8Array(await new Response(body).arrayBuffer())
            : new Uint8Array(body).slice();
      const contentType = (options as { httpMetadata?: { contentType?: string } } | undefined)
        ?.httpMetadata?.contentType;
      objects.set(key, { bytes, contentType });
      return {};
    },
    async list() {
      throw new Error("broad list forbidden");
    },
    async delete(key) {
      for (const item of typeof key === "string" ? [key] : key) objects.delete(item);
    },
  };
}

const result = (stdout = "", exitCode: number | null = 0, stderr = ""): V207CommandResult => ({
  exitCode,
  signal: null,
  stdout,
  stderr,
});

const authorityParser = () => ({
  image: "fixture-image",
  proposalSha256:
    "sha256:dfb527133ad3bfdb20bbb8d9649ca56bcd63eff243e2108f8f32a4861593f533" as const,
  capUsd: 4.5,
  anchorRefreshAuthorized: false,
});

async function fixture(
  overrides: {
    dirty?: boolean;
    preflightFails?: boolean;
    preexisting?: boolean;
    qualificationFails?: boolean;
    cleanupFails?: boolean;
    pythonPutFails?: boolean;
    pythonPutSignal?: "SIGINT" | "SIGTERM";
    signal?: "SIGINT" | "SIGTERM";
    absenceDiagnostic?: string;
  } = {},
) {
  const root = await mkdtemp("/tmp/v207-disposable-");
  roots.push(root);
  const calls: V207CommandRequest[] = [];
  let exists = overrides.preexisting ?? false;
  let secret = false;
  let childCalls = 0;
  const bucket = memoryBucket();
  const fetchRef: { current?: typeof fetch } = {};
  const signalTarget = new EventEmitter();
  const commandRunner = async (request: V207CommandRequest): Promise<V207CommandResult> => {
    calls.push(request);
    if (request.command === "git") return result(overrides.dirty ? " M tracked.ts\n" : "");
    if (request.command.endsWith("/tsx")) {
      childCalls += 1;
      expect(request.args).toEqual([V207_DISPOSABLE_QUALIFICATION]);
      if (request.env.V207_PREFLIGHT_ONLY === "1") {
        return overrides.preflightFails ? result("", 1, "V207_PREFLIGHT_REJECTED") : result();
      }
      expect(request.env.V207_OUTPUT_PORT_ROUTE).toBe(V207_DISPOSABLE_ROUTE);
      expect(request.env.V207_AUTHORITY_NONCE).toBe(NONCE);
      if (overrides.signal !== undefined) {
        signalTarget.emit(overrides.signal);
        expect(request.signal?.aborted).toBe(true);
        return result("", null, `${overrides.signal} received`);
      }
      return overrides.qualificationFails ? result("", 1, "V207_PROVIDER_REJECTED") : result();
    }
    if (request.command === "python3") {
      if (overrides.pythonPutSignal !== undefined) signalTarget.emit(overrides.pythonPutSignal);
      if (overrides.pythonPutFails) return result("", 2);
      const value = JSON.parse(request.stdin ?? "null") as {
        url?: unknown;
        body_base64?: unknown;
      } | null;
      if (typeof value?.url !== "string" || typeof value.body_base64 !== "string")
        return result("", 2);
      const response = await fetchRef.current!(value.url, {
        method: "PUT",
        headers: { "content-type": "image/png" },
        body: Buffer.from(value.body_base64, "base64"),
      });
      return [200, 201, 204].includes(response.status)
        ? result(
            JSON.stringify({
              status: response.status,
              worker_version_id: response.headers.get(V207_ROUTE_VERSION_HEADER),
            }),
          )
        : result("", 2);
    }
    expect(request.args.join(" ")).not.toContain("videoforge-v2-06-staging");
    if (request.args.includes("delete")) {
      expect(request.args.slice(4, 7)).toEqual(["delete", V207_DISPOSABLE_WORKER_NAME, "--force"]);
    } else {
      expect(request.args).toContain("--name");
      expect(request.args[request.args.indexOf("--name") + 1]).toBe(V207_DISPOSABLE_WORKER_NAME);
    }
    if (request.args.includes("deployments")) {
      return exists
        ? result(JSON.stringify({ versions: [{ version_id: VERSION_ID, percentage: 100 }] }))
        : result(
            "",
            1,
            overrides.absenceDiagnostic ?? "Worker script does not exist [code: 10090]",
          );
    }
    if (request.args.includes("deploy")) {
      exists = true;
      return result();
    }
    if (request.args.includes("secret")) {
      expect(request.args).toContain(V207_DISPOSABLE_SECRET_NAME);
      expect(request.stdin).toBe(`${NONCE}\n`);
      secret = true;
      return result();
    }
    if (request.args.includes("delete")) {
      if (overrides.cleanupFails) return result("", 1, "delete failed");
      exists = false;
      secret = false;
      return result();
    }
    throw new Error(`unexpected command: ${request.args.join(" ")}`);
  };
  const fetchImpl: typeof fetch = async (input, init) => {
    if (!exists) return new Response("not found", { status: 404 });
    const request = new Request(input, init);
    const response = await handleV207DisposableOutputPort(request, {
      PRIVATE_ARTIFACTS: bucket,
      ...(secret ? { VIDEOFORGE_V207_AUTHORITY_NONCE: NONCE } : {}),
    });
    const resolved = response ?? new Response("not found", { status: 404 });
    const headers = new Headers(resolved.headers);
    headers.set(V207_ROUTE_VERSION_HEADER, VERSION_ID);
    return new Response(resolved.body, {
      status: resolved.status,
      statusText: resolved.statusText,
      headers,
    });
  };
  fetchRef.current = fetchImpl;
  const options: V207DisposableOrchestratorOptions = {
    environment: {
      V207_IMAGE: "fixture-image",
      RUNPOD_KEY: "must-never-appear-in-evidence",
    },
    authorityParser,
    cwd: root,
    configPath: join(root, "disposable.wrangler.jsonc"),
    evidencePath: join(root, "evidence.json"),
    commandRunner,
    fetchImpl,
    nonceFactory: () => NONCE,
    sleepImpl: async () => undefined,
    installSignalHandlers:
      overrides.signal !== undefined || overrides.pythonPutSignal !== undefined,
    signalTarget: signalTarget as unknown as V207DisposableOrchestratorOptions["signalTarget"],
  };
  return { root, calls, options, signalTarget, state: () => ({ exists, secret, childCalls }) };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("V2-07 disposable live orchestrator", () => {
  it("resolves the default config from the computed repository cwd", async () => {
    const setup = await fixture();
    const options = { ...setup.options, configPath: undefined };

    await runV207DisposableLiveOrchestration(options);

    const expectedConfigPath = join(setup.root, V207_DISPOSABLE_CONFIG);
    const wranglerCalls = setup.calls.filter((call) => call.command === "pnpm");
    expect(wranglerCalls.length).toBeGreaterThan(0);
    for (const call of wranglerCalls) {
      expect(call.args[call.args.indexOf("--config") + 1]).toBe(expectedConfigPath);
    }
    const qualificationCalls = setup.calls.filter((call) => call.command.endsWith("/tsx"));
    expect(qualificationCalls).toHaveLength(2);
    for (const call of qualificationCalls) {
      expect(call.env.V207_WRANGLER_CONFIG).toBe(expectedConfigPath);
    }
  });

  it("runs the fixed disposable lifecycle in order and proves three-read deletion", async () => {
    const setup = await fixture();
    const completed = await runV207DisposableLiveOrchestration(setup.options);
    expect(completed).toMatchObject({ qualificationExitCode: 0, cleanedUp: true });
    expect(setup.state()).toEqual({ exists: false, secret: false, childCalls: 2 });

    const labels = setup.calls.map((call) =>
      call.command === "git"
        ? "git"
        : call.command.endsWith("/tsx")
          ? call.env.V207_PREFLIGHT_ONLY === "1"
            ? "preflight"
            : "qualification"
          : call.command === "python3"
            ? "python-put"
            : call.args.includes("deployments")
              ? "status"
              : call.args.includes("secret")
                ? "secret"
                : call.args.includes("delete")
                  ? "delete"
                  : "deploy",
    );
    expect(labels).toEqual([
      "git",
      "preflight",
      "status",
      "deploy",
      "secret",
      "status",
      "python-put",
      "qualification",
      "delete",
      "status",
      "status",
      "status",
    ]);
    const evidence = await readFile(completed.evidencePath, "utf8");
    expect(evidence).not.toContain(NONCE);
    expect(evidence).not.toContain("must-never-appear-in-evidence");
    expect(JSON.parse(evidence)).toMatchObject({
      cleanup_required: false,
      result: "SUCCEEDED",
      worker_name: V207_DISPOSABLE_WORKER_NAME,
    });
    expect(evidence).toContain("pre_gpu_output_compatibility_probe_completed");
  });

  it("stops before qualification when the active data-plane version differs", async () => {
    const setup = await fixture();
    const normalFetch = setup.options.fetchImpl!;
    await expect(
      runV207DisposableLiveOrchestration({
        ...setup.options,
        fetchImpl: async (input, init) => {
          const response = await normalFetch(input, init);
          if (!setup.state().secret) return response;
          const headers = new Headers(response.headers);
          headers.set(V207_ROUTE_VERSION_HEADER, PREDECESSOR_VERSION_ID);
          return new Response(response.body, { status: response.status, headers });
        },
      }),
    ).rejects.toMatchObject({ code: "V207_DISPOSABLE_ROUTE_VERSION_ID_UNCONFIRMED" });

    expect(setup.state()).toEqual({ exists: false, secret: false, childCalls: 1 });
  });

  it("allows a transient disabled predecessor before three exact active fingerprints", async () => {
    const setup = await fixture();
    const normalFetch = setup.options.fetchImpl!;
    let activeRouteReads = 0;
    const completed = await runV207DisposableLiveOrchestration({
      ...setup.options,
      fetchImpl: async (input, init) => {
        const request = new Request(input, init);
        if (
          setup.state().secret &&
          request.method === "POST" &&
          !request.headers.has("x-videoforge-v207-authority")
        ) {
          activeRouteReads += 1;
          if (activeRouteReads === 1) {
            return Response.json(
              { error: { code: "V207_ROUTE_DISABLED" } },
              {
                status: 404,
                headers: { [V207_ROUTE_VERSION_HEADER]: PREDECESSOR_VERSION_ID },
              },
            );
          }
        }
        return normalFetch(input, init);
      },
    });

    expect(completed).toMatchObject({ qualificationExitCode: 0, cleanedUp: true });
    expect(activeRouteReads).toBe(4);
    expect(setup.state()).toEqual({ exists: false, secret: false, childCalls: 2 });
  });

  it("times out on a persistent disabled predecessor before qualification", async () => {
    const setup = await fixture();
    const normalFetch = setup.options.fetchImpl!;
    let activeRouteReads = 0;
    await expect(
      runV207DisposableLiveOrchestration({
        ...setup.options,
        fetchImpl: async (input, init) => {
          const request = new Request(input, init);
          if (
            setup.state().secret &&
            request.method === "POST" &&
            !request.headers.has("x-videoforge-v207-authority")
          ) {
            activeRouteReads += 1;
            return Response.json(
              { error: { code: "V207_ROUTE_DISABLED" } },
              {
                status: 404,
                headers: { [V207_ROUTE_VERSION_HEADER]: PREDECESSOR_VERSION_ID },
              },
            );
          }
          return normalFetch(input, init);
        },
      }),
    ).rejects.toMatchObject({ code: "V207_DISPOSABLE_ACTIVE_ROUTE_UNCONFIRMED" });

    expect(activeRouteReads).toBe(30);
    expect(setup.state()).toEqual({ exists: false, secret: false, childCalls: 1 });
  });

  it("fails immediately when a disabled predecessor returns after the first exact active match", async () => {
    const setup = await fixture();
    const normalFetch = setup.options.fetchImpl!;
    let activeRouteReads = 0;
    await expect(
      runV207DisposableLiveOrchestration({
        ...setup.options,
        fetchImpl: async (input, init) => {
          const request = new Request(input, init);
          if (
            setup.state().secret &&
            request.method === "POST" &&
            !request.headers.has("x-videoforge-v207-authority")
          ) {
            activeRouteReads += 1;
            if (activeRouteReads === 2) {
              return Response.json(
                { error: { code: "V207_ROUTE_DISABLED" } },
                {
                  status: 404,
                  headers: { [V207_ROUTE_VERSION_HEADER]: PREDECESSOR_VERSION_ID },
                },
              );
            }
          }
          return normalFetch(input, init);
        },
      }),
    ).rejects.toMatchObject({ code: "V207_DISPOSABLE_ACTIVE_ROUTE_UNCONFIRMED" });

    expect(activeRouteReads).toBe(2);
    expect(setup.state()).toEqual({ exists: false, secret: false, childCalls: 1 });
  });

  it.each([
    ["missing", null],
    ["malformed", "not-a-worker-version"],
  ] as const)("fails immediately on %s predecessor version metadata", async (_label, versionId) => {
    const setup = await fixture();
    const normalFetch = setup.options.fetchImpl!;
    let activeRouteReads = 0;
    await expect(
      runV207DisposableLiveOrchestration({
        ...setup.options,
        fetchImpl: async (input, init) => {
          const request = new Request(input, init);
          if (
            setup.state().secret &&
            request.method === "POST" &&
            !request.headers.has("x-videoforge-v207-authority")
          ) {
            activeRouteReads += 1;
            return Response.json(
              { error: { code: "V207_ROUTE_DISABLED" } },
              {
                status: 404,
                ...(versionId === null
                  ? {}
                  : { headers: { [V207_ROUTE_VERSION_HEADER]: versionId } }),
              },
            );
          }
          return normalFetch(input, init);
        },
      }),
    ).rejects.toMatchObject({ code: "V207_DISPOSABLE_ROUTE_VERSION_ID_INVALID" });

    expect(activeRouteReads).toBe(1);
    expect(setup.state()).toEqual({ exists: false, secret: false, childCalls: 1 });
  });

  it("cleans up and never dispatches GPU qualification when the pre-GPU upload probe fails", async () => {
    const setup = await fixture({ pythonPutFails: true });
    await expect(runV207DisposableLiveOrchestration(setup.options)).rejects.toMatchObject({
      code: "V207_DISPOSABLE_PROBE_URLLIB_UPLOAD_REJECTED",
    });

    expect(setup.state()).toEqual({ exists: false, secret: false, childCalls: 1 });
    expect(setup.calls.filter((call) => call.args.includes("delete"))).toHaveLength(1);
  });

  it("deletes the deterministic reservation when the committed reserve response is lost", async () => {
    const setup = await fixture();
    const normalFetch = setup.options.fetchImpl!;
    let intercepted = false;
    await expect(
      runV207DisposableLiveOrchestration({
        ...setup.options,
        fetchImpl: async (input, init) => {
          const request = new Request(input, init);
          if (
            !intercepted &&
            request.method === "POST" &&
            request.headers.has("x-videoforge-v207-authority")
          ) {
            const response = await normalFetch(input, init);
            intercepted = true;
            const headers = new Headers(response.headers);
            return Response.json({}, { status: 200, headers });
          }
          return normalFetch(input, init);
        },
      }),
    ).rejects.toMatchObject({ code: "V207_DISPOSABLE_PROBE_PORT_INVALID" });

    expect(intercepted).toBe(true);
    expect(setup.state()).toEqual({ exists: false, secret: false, childCalls: 1 });
  });

  it("uses a non-aborted cleanup path when SIGTERM arrives during the urllib probe", async () => {
    const setup = await fixture({ pythonPutFails: true, pythonPutSignal: "SIGTERM" });
    await expect(runV207DisposableLiveOrchestration(setup.options)).rejects.toMatchObject({
      code: "V207_OPERATOR_ABORT",
    });

    expect(setup.state()).toEqual({ exists: false, secret: false, childCalls: 1 });
    expect(setup.calls.filter((call) => call.args.includes("delete"))).toHaveLength(1);
  });

  it("rejects a mid-probe Worker version swap and cleans before qualification", async () => {
    const setup = await fixture();
    const normalFetch = setup.options.fetchImpl!;
    let changedFinalize = false;
    await expect(
      runV207DisposableLiveOrchestration({
        ...setup.options,
        fetchImpl: async (input, init) => {
          const request = new Request(input, init);
          const response = await normalFetch(input, init);
          if (request.method !== "POST" || !request.headers.has("x-videoforge-v207-authority")) {
            return response;
          }
          const body = JSON.parse(await request.clone().text()) as { operation?: unknown };
          if (body.operation !== "FINALIZE") return response;
          changedFinalize = true;
          const headers = new Headers(response.headers);
          headers.set(V207_ROUTE_VERSION_HEADER, "22222222-2222-4222-8222-222222222222");
          return new Response(response.body, { status: response.status, headers });
        },
      }),
    ).rejects.toMatchObject({ code: "V207_DISPOSABLE_ROUTE_VERSION_ID_UNCONFIRMED" });

    expect(changedFinalize).toBe(true);
    expect(setup.state()).toEqual({ exists: false, secret: false, childCalls: 1 });
  });

  it("waits through a transient non-JSON 404 and then requires three exact disabled fingerprints", async () => {
    const setup = await fixture();
    const normalFetch = setup.options.fetchImpl;
    let routeReads = 0;
    const completed = await runV207DisposableLiveOrchestration({
      ...setup.options,
      fetchImpl: async (input, init) => {
        routeReads += 1;
        if (routeReads === 1) return new Response("route is propagating", { status: 404 });
        return normalFetch!(input, init);
      },
    });

    expect(completed).toMatchObject({ qualificationExitCode: 0, cleanedUp: true });
    expect(routeReads).toBe(15);
    expect(setup.state()).toEqual({ exists: false, secret: false, childCalls: 2 });
  });

  it("fails closed after bounded persistent invalid route reads and still cleans up", async () => {
    const setup = await fixture();
    const normalFetch = setup.options.fetchImpl;
    let invalidRouteReads = 0;
    await expect(
      runV207DisposableLiveOrchestration({
        ...setup.options,
        fetchImpl: async (input, init) => {
          if (setup.state().exists) {
            invalidRouteReads += 1;
            return new Response("route is still propagating", { status: 404 });
          }
          return normalFetch!(input, init);
        },
      }),
    ).rejects.toMatchObject({ code: "V207_DISPOSABLE_DISABLED_ROUTE_UNCONFIRMED" });

    expect(invalidRouteReads).toBe(30);
    expect(setup.state()).toEqual({ exists: false, secret: false, childCalls: 1 });
    expect(setup.calls.filter((call) => call.args.includes("delete"))).toHaveLength(1);
  });

  it("caps the final propagation sleep at the remaining 60-second deadline", async () => {
    const setup = await fixture();
    const normalFetch = setup.options.fetchImpl;
    let now = 0;
    const sleeps: number[] = [];
    vi.spyOn(Date, "now").mockImplementation(() => now);
    await expect(
      runV207DisposableLiveOrchestration({
        ...setup.options,
        fetchImpl: async (input, init) => {
          if (setup.state().exists) {
            now += 59_000;
            return new Response("route is still propagating", { status: 404 });
          }
          return normalFetch!(input, init);
        },
        sleepImpl: async (milliseconds) => {
          sleeps.push(milliseconds);
          now += milliseconds;
        },
      }),
    ).rejects.toMatchObject({ code: "V207_DISPOSABLE_DISABLED_ROUTE_UNCONFIRMED" });

    expect(sleeps).toEqual([1_000, 2_000, 2_000]);
    expect(now).toBe(64_000);
    expect(setup.state()).toEqual({ exists: false, secret: false, childCalls: 1 });
  });

  it("aborts during route propagation and still cleans up", async () => {
    const setup = await fixture({ signal: "SIGTERM" });
    let routeReads = 0;
    await expect(
      runV207DisposableLiveOrchestration({
        ...setup.options,
        fetchImpl: async () => {
          routeReads += 1;
          return setup.state().exists
            ? new Response("route is still propagating", { status: 404 })
            : new Response("not found", { status: 404 });
        },
        sleepImpl: async () => {
          setup.signalTarget.emit("SIGTERM");
        },
      }),
    ).rejects.toMatchObject({ code: "V207_OPERATOR_ABORT" });

    expect(routeReads).toBe(4);
    expect(setup.state()).toEqual({ exists: false, secret: false, childCalls: 1 });
    expect(setup.signalTarget.listenerCount("SIGINT")).toBe(0);
    expect(setup.signalTarget.listenerCount("SIGTERM")).toBe(0);
  });

  it.each([
    ["dirty worktree", { dirty: true }, "V207_GIT_WORKTREE_DIRTY", 1],
    ["preflight rejection", { preflightFails: true }, "V207_LIVE_PREFLIGHT", 2],
  ] as const)("performs no provider command on %s", async (_label, overrides, code, callCount) => {
    const setup = await fixture(overrides);
    await expect(runV207DisposableLiveOrchestration(setup.options)).rejects.toThrow(code);
    expect(setup.calls).toHaveLength(callCount);
    expect(setup.calls.some((call) => call.args.includes("deploy"))).toBe(false);
    expect(setup.calls.some((call) => call.args.includes("delete"))).toBe(false);
  });

  it("fails closed without deleting a preexisting fixed-name Worker", async () => {
    const setup = await fixture({ preexisting: true });
    await expect(runV207DisposableLiveOrchestration(setup.options)).rejects.toThrow(
      "V207_DISPOSABLE_WORKER_PREEXISTING",
    );
    expect(setup.state().exists).toBe(true);
    expect(setup.calls.some((call) => call.args.includes("delete"))).toBe(false);
  });

  it("accepts Cloudflare's current 10007 absent-Worker diagnostic", async () => {
    const setup = await fixture({ absenceDiagnostic: "Cloudflare API error code: 10007" });
    const completed = await runV207DisposableLiveOrchestration(setup.options);
    expect(completed).toMatchObject({ qualificationExitCode: 0, cleanedUp: true });
    expect(setup.state()).toEqual({ exists: false, secret: false, childCalls: 2 });
  });

  it("normalizes Wrangler ANSI output before accepting a colored 10007 absence diagnostic", async () => {
    const setup = await fixture({
      absenceDiagnostic:
        "\u001b[31mThis \u001b[1mWorker\u001b[22m \u001b[31mdoes not exist\u001b[39m ... [code: \u001b[33m10007\u001b[39m]\u001b[0m",
    });
    const completed = await runV207DisposableLiveOrchestration(setup.options);
    expect(completed).toMatchObject({ qualificationExitCode: 0, cleanedUp: true });
    expect(setup.state()).toEqual({ exists: false, secret: false, childCalls: 2 });
  });

  it("rejects a request identifier that merely contains 10007", async () => {
    const setup = await fixture({ absenceDiagnostic: "request id: 10007" });
    await expect(runV207DisposableLiveOrchestration(setup.options)).rejects.toMatchObject({
      code: "V207_DISPOSABLE_WORKER_ABSENCE_UNCONFIRMED",
    });
    expect(setup.calls.some((call) => call.args.includes("deploy"))).toBe(false);
    expect(setup.calls.some((call) => call.args.includes("delete"))).toBe(false);
    const evidence = JSON.parse(await readFile(join(setup.root, "evidence.json"), "utf8"));
    expect(evidence).toMatchObject({ cleanup_required: false, result: "FAILED" });
  });

  it("rejects a suffixed absent code such as 10007x", async () => {
    const setup = await fixture({ absenceDiagnostic: "[code: 10007x]" });
    await expect(runV207DisposableLiveOrchestration(setup.options)).rejects.toMatchObject({
      code: "V207_DISPOSABLE_WORKER_ABSENCE_UNCONFIRMED",
    });
    expect(setup.calls.some((call) => call.args.includes("deploy"))).toBe(false);
    expect(setup.calls.some((call) => call.args.includes("delete"))).toBe(false);
    const evidence = JSON.parse(await readFile(join(setup.root, "evidence.json"), "utf8"));
    expect(evidence).toMatchObject({ cleanup_required: false, result: "FAILED" });
  });

  it("rejects an unrelated Cloudflare diagnostic before mutation and finalizes failed evidence", async () => {
    const setup = await fixture({ absenceDiagnostic: "authentication failed [code: 10001]" });
    await expect(runV207DisposableLiveOrchestration(setup.options)).rejects.toMatchObject({
      code: "V207_DISPOSABLE_WORKER_ABSENCE_UNCONFIRMED",
    });
    expect(setup.state()).toEqual({ exists: false, secret: false, childCalls: 1 });
    expect(setup.calls.some((call) => call.args.includes("deploy"))).toBe(false);
    expect(setup.calls.some((call) => call.args.includes("delete"))).toBe(false);
    const evidence = JSON.parse(await readFile(join(setup.root, "evidence.json"), "utf8"));
    expect(evidence).toMatchObject({ cleanup_required: false, result: "FAILED" });
    expect(evidence.events).toContainEqual(
      expect.objectContaining({
        event: "initial_control_plane_absence_rejected_before_mutation",
        code: "V207_DISPOSABLE_WORKER_ABSENCE_UNCONFIRMED",
      }),
    );
  });

  it("deletes the disposable Worker when qualification fails", async () => {
    const setup = await fixture({ qualificationFails: true });
    await expect(runV207DisposableLiveOrchestration(setup.options)).rejects.toThrow(
      "V207_LIVE_RUNNER_FAILED",
    );
    expect(setup.state().exists).toBe(false);
    expect(setup.calls.filter((call) => call.args.includes("delete"))).toHaveLength(1);
  });

  it.each(["SIGINT", "SIGTERM"] as const)(
    "cancels on %s, propagates abort to qualification, and cleans up before rejecting",
    async (signal) => {
      const setup = await fixture({ signal });
      await expect(runV207DisposableLiveOrchestration(setup.options)).rejects.toMatchObject({
        code: "V207_OPERATOR_ABORT",
      });
      expect(setup.state()).toEqual({ exists: false, secret: false, childCalls: 2 });
      expect(setup.signalTarget.listenerCount("SIGINT")).toBe(0);
      expect(setup.signalTarget.listenerCount("SIGTERM")).toBe(0);
      const qualification = setup.calls.find(
        (call) => call.command.endsWith("/tsx") && call.env.V207_PREFLIGHT_ONLY !== "1",
      );
      expect(qualification?.signal?.aborted).toBe(true);
      const evidence = JSON.parse(await readFile(join(setup.root, "evidence.json"), "utf8"));
      expect(evidence).toMatchObject({ cleanup_required: false, result: "FAILED" });
      expect(evidence.events).toContainEqual(
        expect.objectContaining({
          event: "orchestration_cancelled",
          code: "V207_OPERATOR_ABORT",
          signal,
        }),
      );
    },
  );

  it("fails closed as cleanup uncertain when whole-Worker deletion fails", async () => {
    const setup = await fixture({ cleanupFails: true });
    await expect(runV207DisposableLiveOrchestration(setup.options)).rejects.toThrow(
      "V207_CLEANUP_UNCERTAIN",
    );
    expect(setup.state().exists).toBe(true);
    const evidence = JSON.parse(await readFile(join(setup.root, "evidence.json"), "utf8"));
    expect(evidence).toMatchObject({ cleanup_required: true, result: "CLEANUP_UNCERTAIN" });
  });
});

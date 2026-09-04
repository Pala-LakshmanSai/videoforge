import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  runV207DisposableLiveOrchestration,
  V207_DISPOSABLE_CONFIG,
  V207_DISPOSABLE_QUALIFICATION,
  V207_DISPOSABLE_ROUTE,
  V207_DISPOSABLE_SECRET_NAME,
  V207_DISPOSABLE_WORKER_NAME,
  type V207DisposableOrchestratorOptions,
} from "./v207-disposable-live-orchestrator";
import type { V207CommandRequest, V207CommandResult } from "./v207-live-orchestrator";

const NONCE = "a".repeat(64);
const VERSION_ID = "11111111-1111-4111-8111-111111111111";
const roots: string[] = [];

const result = (stdout = "", exitCode: number | null = 0, stderr = ""): V207CommandResult => ({
  exitCode,
  signal: null,
  stdout,
  stderr,
});

const authorityParser = () => ({
  image: "fixture-image",
  proposalSha256:
    "sha256:e1fd6996f4aa21c07b3b24e4db52683ebfb2999446d46066399b7b8cf0c7b1b9" as const,
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
  const fetchImpl: typeof fetch = async () => {
    if (!exists) return new Response("not found", { status: 404 });
    return new Response(
      JSON.stringify({
        error: { code: secret ? "V207_AUTHORITY_REJECTED" : "V207_ROUTE_DISABLED" },
      }),
      { status: secret ? 403 : 404 },
    );
  };
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
    installSignalHandlers: overrides.signal !== undefined,
    signalTarget: signalTarget as unknown as V207DisposableOrchestratorOptions["signalTarget"],
  };
  return { root, calls, options, signalTarget, state: () => ({ exists, secret, childCalls }) };
}

afterEach(async () => {
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
    expect(routeReads).toBe(10);
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

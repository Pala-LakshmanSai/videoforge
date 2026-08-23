import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertV207DiskHeadroom,
  assertV207WorkerRollbackAnchorRetained,
  extractV207ChildFailureCode,
  extractV207WorkerRollbackAnchor,
  extractV207WorkerVersionId,
  runV207LiveOrchestration,
  spawnV207Command,
  V207_ORCHESTRATOR_SECRET_NAME,
  V207_ORCHESTRATOR_MIN_FREE_BYTES,
  V207_ROLLBACK_ANCHOR_REFRESH_ACTIVATION,
  V207_ROLLBACK_ANCHOR_REFRESH_CONFIG_KEY,
  type V207CommandRequest,
  type V207CommandResult,
} from "./v207-live-orchestrator";
import {
  V207_PENDING_PROPOSAL_SHA256,
  V207_REPAIRED_IMAGE,
  V207_REPAIRED_IMAGE_SOURCE_COMMIT,
} from "./v207-activation-authority";

const IMAGE = V207_REPAIRED_IMAGE;
const SOURCE_COMMIT = V207_REPAIRED_IMAGE_SOURCE_COMMIT;
const parseFixtureAuthority = () => ({
  image: IMAGE,
  proposalSha256: V207_PENDING_PROPOSAL_SHA256,
  capUsd: 4,
  anchorRefreshAuthorized: false as const,
});
const parseFixtureRefreshAuthority = () => ({
  ...parseFixtureAuthority(),
  anchorRefreshAuthorized: true as const,
});
const VERSION_ID = "11111111-1111-4111-8111-111111111111";
const CHANGED_VERSION_ID = "22222222-2222-4222-8222-222222222222";
const DEPLOYMENT_ID = "33333333-3333-4333-8333-333333333333";
const REFRESH_VERSION_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const VERSION_HISTORY = [
  "44444444-4444-4444-8444-444444444444",
  "55555555-5555-4555-8555-555555555555",
  "66666666-6666-4666-8666-666666666666",
  "77777777-7777-4777-8777-777777777777",
  "88888888-8888-4888-8888-888888888888",
  "99999999-9999-4999-8999-999999999999",
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  VERSION_ID,
] as const;
const RECENT_VERSION_LIST = JSON.stringify({
  versions: VERSION_HISTORY.map((version_id) => ({ version_id })),
});
const REFRESHED_VERSION_LIST = JSON.stringify({
  versions: [...VERSION_HISTORY.slice(1), REFRESH_VERSION_ID].map((version_id) => ({ version_id })),
});
const OLD_ANCHOR_MISSING_VERSION_LIST = JSON.stringify({
  versions: VERSION_HISTORY.slice(1, 8).map((version_id) => ({ version_id })),
});
const NONCE = "a".repeat(64);
const RUNPOD_KEY = "runpod-key-must-not-be-written";
const roots: string[] = [];

const result = (stdout = "", exitCode = 0): V207CommandResult => ({
  exitCode,
  signal: null,
  stdout,
  stderr: "",
});

async function fixture() {
  const root = await mkdtemp("/tmp/vf-v207-orchestrator-");
  roots.push(root);
  const configPath = join(root, "wrangler-current.json");
  await writeFile(
    configPath,
    JSON.stringify({
      name: "videoforge-v2-06-staging",
      main: "apps/web/dist-staging/index.js",
      vars: {},
      r2_buckets: [{ binding: "PRIVATE_ARTIFACTS", bucket_name: "private" }],
    }),
    { mode: 0o600 },
  );
  await chmod(configPath, 0o600);
  return {
    root,
    configPath,
    evidencePath: join(root, "evidence.json"),
    environment: {
      V207_IMAGE: IMAGE,
      V207_IMAGE_SOURCE_COMMIT: SOURCE_COMMIT,
      V207_PROPOSAL_SHA256: V207_PENDING_PROPOSAL_SHA256,
      V207_FINITE_CAP_USD: "4",
      V207_WRANGLER_CONFIG: configPath,
      RUNPOD_KEY,
    } as const,
  };
}

async function enableRollbackAnchorRefresh(configPath: string): Promise<void> {
  const config = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
  config.vars = {
    ...(typeof config.vars === "object" && config.vars !== null ? config.vars : {}),
    [V207_ROLLBACK_ANCHOR_REFRESH_CONFIG_KEY]: V207_ROLLBACK_ANCHOR_REFRESH_ACTIVATION,
  };
  await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
  await chmod(configPath, 0o600);
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("V2-07 live orchestrator", () => {
  it("requires an explicit refresh binding on every injected authority", () => {
    expect(parseFixtureAuthority().anchorRefreshAuthorized).toBe(false);
    expect(parseFixtureRefreshAuthority().anchorRefreshAuthorized).toBe(true);
  });

  it("extracts one bounded child failure code from stderr only", () => {
    const stderr =
      "provider body https://example.invalid/run/secret-token\n" +
      "MAGE_OUTPUT_LINEAGE_INVALID\n" +
      "RUNPOD_SECONDARY_SHOULD_NOT_BE_SELECTED\n" +
      "Bearer runpod-secret-value";
    expect(extractV207ChildFailureCode(stderr)).toBe("MAGE_OUTPUT_LINEAGE_INVALID");
    // The orchestrator passes only the child's stderr to this function.  Non-code output gets
    // the fixed fallback, never an arbitrary line or diagnostic body.
    expect(extractV207ChildFailureCode("stdout or provider body only")).toBe(
      "V207_CHILD_FAILURE_UNCLASSIFIED",
    );
    expect(extractV207ChildFailureCode("unclassified provider diagnostic")).toBe(
      "V207_CHILD_FAILURE_UNCLASSIFIED",
    );
  });

  it("fails before orchestration when local disk cannot safely persist evidence", () => {
    expect(() => assertV207DiskHeadroom(V207_ORCHESTRATOR_MIN_FREE_BYTES - 1)).toThrow(
      "V207_LOCAL_DISK_HEADROOM_INSUFFICIENT",
    );
    expect(() => assertV207DiskHeadroom(V207_ORCHESTRATOR_MIN_FREE_BYTES)).not.toThrow();
  });

  it("extracts only a Worker version UUID from nested Wrangler status JSON", () => {
    expect(
      extractV207WorkerVersionId({
        deployments: [{ metadata: { version_id: VERSION_ID } }],
      }),
    ).toBe(VERSION_ID);
    expect(() => extractV207WorkerVersionId({ deployments: [] })).toThrow(
      "V207_WORKER_VERSION_ID_MISSING",
    );
  });

  it("selects versions[].version_id instead of the deployment envelope id", () => {
    expect(
      extractV207WorkerVersionId({
        id: DEPLOYMENT_ID,
        versions: [{ version_id: VERSION_ID, percentage: 100 }],
      }),
    ).toBe(VERSION_ID);
    expect(
      extractV207WorkerVersionId({
        deployments: [
          {
            id: DEPLOYMENT_ID,
            versions: [{ version_id: VERSION_ID, percentage: 100 }],
          },
        ],
      }),
    ).toBe(VERSION_ID);
    expect(() =>
      extractV207WorkerVersionId({
        id: DEPLOYMENT_ID,
        versions: [{ id: DEPLOYMENT_ID, percentage: 100 }],
      }),
    ).toThrow("V207_WORKER_VERSION_ID_MISSING");
    expect(() =>
      extractV207WorkerVersionId({
        id: DEPLOYMENT_ID,
        versions: [
          { version_id: VERSION_ID, percentage: 50 },
          { version_id: CHANGED_VERSION_ID, percentage: 50 },
        ],
      }),
    ).toThrow("V207_WORKER_VERSION_ID_MISSING");
  });

  it("captures an exact active-version rollback anchor, not the deployment envelope", () => {
    const status = {
      id: DEPLOYMENT_ID,
      versions: [{ version_id: VERSION_ID, percentage: 100, script_hash: "sha256:old" }],
    };
    const anchor = extractV207WorkerRollbackAnchor(status);
    expect(anchor.versionId).toBe(VERSION_ID);
    expect(anchor.sha256).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(anchor.sha256).not.toBe(`sha256:${"0".repeat(64)}`);
    expect(() =>
      extractV207WorkerRollbackAnchor({
        id: DEPLOYMENT_ID,
        versions: [
          { version_id: VERSION_ID, percentage: 50 },
          { version_id: CHANGED_VERSION_ID, percentage: 50 },
        ],
      }),
    ).toThrow("V207_WORKER_ROLLBACK_ANCHOR_MISSING");
  });

  it("requires the captured anchor in the newest seven of Wrangler's oldest-to-newest ten-version window", () => {
    expect(
      assertV207WorkerRollbackAnchorRetained(JSON.parse(RECENT_VERSION_LIST), VERSION_ID),
    ).toBe(9);
    expect(() =>
      assertV207WorkerRollbackAnchorRetained(
        { versions: VERSION_HISTORY.slice(3).map((version_id) => ({ version_id })) },
        VERSION_HISTORY[3],
      ),
    ).not.toThrow();
    expect(() =>
      assertV207WorkerRollbackAnchorRetained(JSON.parse(RECENT_VERSION_LIST), VERSION_HISTORY[2]),
    ).toThrow("V207_WORKER_ROLLBACK_ANCHOR_NOT_RETAINED");
    expect(() =>
      assertV207WorkerRollbackAnchorRetained(
        { versions: [{ version_id: VERSION_HISTORY[0] }] },
        VERSION_HISTORY[0],
      ),
    ).not.toThrow();
    expect(() =>
      assertV207WorkerRollbackAnchorRetained(
        { versions: [{ version_id: VERSION_ID }, { version_id: VERSION_ID }] },
        VERSION_ID,
      ),
    ).toThrow("V207_WORKER_VERSION_LIST_INVALID");
  });

  it("runs the full flow with mocked commands, optional RunPod key, and redacted evidence", async () => {
    const files = await fixture();
    const calls: V207CommandRequest[] = [];
    let signerSecretPresent = false;
    let activeRouteProbeCalls = 0;
    let rollbackSeen = false;
    let restorationProbeCalls = 0;
    const commandRunner = async (request: V207CommandRequest): Promise<V207CommandResult> => {
      calls.push(request);
      if (request.command === "git") return result();
      if (request.args.includes("versions") && request.args.includes("list")) {
        return result(RECENT_VERSION_LIST);
      }
      if (request.args.includes("deployments")) {
        return result(
          JSON.stringify({
            id: DEPLOYMENT_ID,
            versions: [{ version_id: VERSION_ID, percentage: 100 }],
          }),
        );
      }
      if (request.args.includes("secret") && request.args.includes("list")) {
        return result(
          JSON.stringify(signerSecretPresent ? [{ name: V207_ORCHESTRATOR_SECRET_NAME }] : []),
        );
      }
      if (request.args.includes("secret") && request.args.includes("put")) {
        expect(request.stdin).toBe(`${NONCE}\n`);
        signerSecretPresent = true;
        return result();
      }
      if (request.args.includes("secret") && request.args.includes("delete")) {
        expect(request.stdin).toBe("y\n");
        signerSecretPresent = false;
        return result();
      }
      if (request.args.includes("rollback")) rollbackSeen = true;
      return result();
    };
    const fetchImpl: typeof fetch = async () => {
      if (signerSecretPresent && activeRouteProbeCalls++ === 0) {
        return new Response(JSON.stringify({ error: { code: "V207_ROUTE_DISABLED" } }), {
          status: 404,
        });
      }
      if (signerSecretPresent) {
        return new Response(JSON.stringify({ error: { code: "V207_AUTHORITY_REJECTED" } }), {
          status: 403,
        });
      }
      if (rollbackSeen && restorationProbeCalls++ < 2) {
        return new Response(JSON.stringify({ error: { code: "V207_ROUTE_DISABLED" } }), {
          status: 404,
        });
      }
      return new Response(JSON.stringify({ error: { code: "HOSTED_ROUTE_NOT_COMPOSED" } }), {
        status: 503,
      });
    };

    const orchestration = await runV207LiveOrchestration({
      authorityParser: parseFixtureAuthority,
      environment: files.environment,
      cwd: resolve(process.cwd(), "../.."),
      configPath: files.configPath,
      evidencePath: files.evidencePath,
      diskAvailableBytes: V207_ORCHESTRATOR_MIN_FREE_BYTES,
      commandRunner,
      fetchImpl,
      nonceFactory: () => NONCE,
      sleepImpl: async () => undefined,
      installSignalHandlers: false,
    });

    expect(orchestration).toMatchObject({
      evidencePath: files.evidencePath,
      capturedVersionIdHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      runnerExitCode: 0,
      cleanedUp: true,
    });
    expect(signerSecretPresent).toBe(false);
    const evidence = await readFile(files.evidencePath, "utf8");
    expect(evidence).toContain('"result": "SUCCEEDED"');
    expect(evidence).toContain('"event": "captured_pre_mutation_route"');
    expect(evidence).toContain('"event": "restored_route_confirmed"');
    expect(evidence).toContain('"event": "live_preflight_completed"');
    expect(evidence).toContain('"event": "signer_route_activation_confirmed"');
    expect(evidence).toContain('"attempts": 2');
    expect(evidence).toContain('"code": "HOSTED_ROUTE_NOT_COMPOSED"');
    // Two transient mismatches are tolerated before the first exact match, then
    // 16 exact 2-second probes establish the documented 30-second window.
    expect(restorationProbeCalls).toBe(18);
    expect(evidence).not.toContain(NONCE);
    expect(evidence).not.toContain(RUNPOD_KEY);
    expect((await stat(files.evidencePath)).mode & 0o077).toBe(0);

    const liveRunner = calls.find(
      (call) =>
        call.args.some((argument) => argument.endsWith("v207-live-qualification.ts")) &&
        call.env.V207_PREFLIGHT_ONLY !== "1",
    );
    const preflightRunner = calls.find(
      (call) =>
        call.args.some((argument) => argument.endsWith("v207-live-qualification.ts")) &&
        call.env.V207_PREFLIGHT_ONLY === "1",
    );
    expect(preflightRunner).toBeDefined();
    expect(preflightRunner?.command).toBe(
      join(resolve(process.cwd(), "../.."), "apps/web/node_modules/.bin/tsx"),
    );
    expect(preflightRunner?.args).toEqual(["src/server/providers/v207-live-qualification.ts"]);
    expect(liveRunner?.command).toBe(
      join(resolve(process.cwd(), "../.."), "apps/web/node_modules/.bin/tsx"),
    );
    expect(liveRunner?.args).toEqual(["src/server/providers/v207-live-qualification.ts"]);
    expect(liveRunner?.cwd).toBe(join(resolve(process.cwd(), "../.."), "apps/web"));
    expect(liveRunner?.env.V207_AUTHORITY_NONCE).toBe(NONCE);
    expect(liveRunner?.env.V207_PROPOSAL_SHA256).toBe(V207_PENDING_PROPOSAL_SHA256);
    expect(preflightRunner?.env.V207_PROPOSAL_SHA256).toBe(V207_PENDING_PROPOSAL_SHA256);
    expect(liveRunner?.env.RUNPOD_KEY).toBe(RUNPOD_KEY);
    expect(liveRunner?.env.V207_PREFLIGHT_ONLY).toBeUndefined();
    expect(calls.indexOf(preflightRunner as V207CommandRequest)).toBeLessThan(
      calls.indexOf(liveRunner as V207CommandRequest),
    );
    expect(calls.some((call) => call.args.includes("build:staging"))).toBe(true);
    expect(calls.some((call) => call.args.includes("deploy"))).toBe(true);
    expect(calls.some((call) => call.args.includes("rollback"))).toBe(true);
    const rollback = calls.find((call) => call.args.includes("rollback"));
    expect(rollback?.args).toContain(VERSION_ID);
    expect(rollback?.args).not.toContain(DEPLOYMENT_ID);
    expect(calls.flatMap((call) => call.args)).not.toContain(NONCE);
  });

  it("keeps the anchor-refresh deploy behind an exact environment/config pair", async () => {
    const cases = [
      {
        name: "environment-only",
        environment: {
          [V207_ROLLBACK_ANCHOR_REFRESH_CONFIG_KEY]: V207_ROLLBACK_ANCHOR_REFRESH_ACTIVATION,
        },
        configure: false,
        code: "V207_ROLLBACK_ANCHOR_REFRESH_CONFIG_MISMATCH",
      },
      {
        name: "config-only",
        environment: {},
        configure: true,
        code: "V207_ROLLBACK_ANCHOR_REFRESH_CONFIG_MISMATCH",
      },
      {
        name: "wrong-marker",
        environment: { [V207_ROLLBACK_ANCHOR_REFRESH_CONFIG_KEY]: "true" },
        configure: false,
        code: "V207_ROLLBACK_ANCHOR_REFRESH_ACTIVATION_INVALID",
      },
      {
        name: "missing-authority-binding",
        environment: {
          [V207_ROLLBACK_ANCHOR_REFRESH_CONFIG_KEY]: V207_ROLLBACK_ANCHOR_REFRESH_ACTIVATION,
        },
        configure: true,
        code: "V207_ROLLBACK_ANCHOR_REFRESH_AUTHORITY_REQUIRED",
      },
    ] as const;

    for (const testCase of cases) {
      const files = await fixture();
      if (testCase.configure) await enableRollbackAnchorRefresh(files.configPath);
      const calls: V207CommandRequest[] = [];
      const environment = { ...files.environment, ...testCase.environment };
      await expect(
        runV207LiveOrchestration({
          authorityParser: parseFixtureAuthority,
          environment,
          cwd: resolve(process.cwd(), "../.."),
          configPath: files.configPath,
          evidencePath: files.evidencePath,
          diskAvailableBytes: V207_ORCHESTRATOR_MIN_FREE_BYTES,
          commandRunner: async (request) => {
            calls.push(request);
            if (request.command === "git") return result();
            throw new Error(`${testCase.name} must not reach provider mutation`);
          },
          fetchImpl: async () => {
            throw new Error(`${testCase.name} must not probe the route`);
          },
          installSignalHandlers: false,
        }),
      ).rejects.toMatchObject({ code: testCase.code });
      expect(calls).toHaveLength(1);
      expect(await readFile(files.evidencePath, "utf8")).toContain(testCase.code);
    }
  });

  it("refreshes to one newly deployed anchor, then qualifies and rolls back to that anchor", async () => {
    const files = await fixture();
    await enableRollbackAnchorRefresh(files.configPath);
    const calls: V207CommandRequest[] = [];
    let signerSecretPresent = false;
    let statusCalls = 0;
    let versionsCalls = 0;
    let activeRouteProbeCalls = 0;
    let refreshDisabledProbeCalls = 0;
    let rollbackSeen = false;
    let restorationProbeCalls = 0;
    let deployCalls = 0;
    const environment = {
      ...files.environment,
      [V207_ROLLBACK_ANCHOR_REFRESH_CONFIG_KEY]: V207_ROLLBACK_ANCHOR_REFRESH_ACTIVATION,
    };
    const commandRunner = async (request: V207CommandRequest): Promise<V207CommandResult> => {
      calls.push(request);
      if (request.command === "git") return result();
      if (request.args.includes("versions") && request.args.includes("list")) {
        versionsCalls += 1;
        return result(
          versionsCalls === 1 ? OLD_ANCHOR_MISSING_VERSION_LIST : REFRESHED_VERSION_LIST,
        );
      }
      if (request.args.includes("deployments")) {
        statusCalls += 1;
        const version_id = statusCalls === 1 ? VERSION_ID : REFRESH_VERSION_ID;
        return result(
          JSON.stringify({
            id: DEPLOYMENT_ID,
            versions: [
              {
                version_id,
                percentage: 100,
                script_hash: statusCalls === 1 ? "sha256:old" : "sha256:refreshed",
              },
            ],
          }),
        );
      }
      if (request.args.includes("secret") && request.args.includes("list")) {
        return result(
          JSON.stringify(signerSecretPresent ? [{ name: V207_ORCHESTRATOR_SECRET_NAME }] : []),
        );
      }
      if (request.args.includes("secret") && request.args.includes("put")) {
        signerSecretPresent = true;
        return result();
      }
      if (request.args.includes("secret") && request.args.includes("delete")) {
        signerSecretPresent = false;
        return result();
      }
      if (request.args.includes("deploy") && !request.args.includes("deployments")) {
        deployCalls += 1;
        return result();
      }
      if (request.args.includes("rollback")) {
        rollbackSeen = true;
        return result();
      }
      return result();
    };
    const fetchImpl: typeof fetch = async () => {
      if (!signerSecretPresent && !rollbackSeen && refreshDisabledProbeCalls === 0) {
        // The first probe captures the old route before any Worker mutation.
        refreshDisabledProbeCalls += 1;
        return new Response(JSON.stringify({ error: { code: "V207_ROUTE_DISABLED" } }), {
          status: 404,
        });
      }
      if (!signerSecretPresent && !rollbackSeen) {
        refreshDisabledProbeCalls += 1;
        return new Response(JSON.stringify({ error: { code: "V207_ROUTE_DISABLED" } }), {
          status: 404,
        });
      }
      if (signerSecretPresent && activeRouteProbeCalls++ === 0) {
        return new Response(JSON.stringify({ error: { code: "V207_ROUTE_DISABLED" } }), {
          status: 404,
        });
      }
      if (signerSecretPresent) {
        return new Response(JSON.stringify({ error: { code: "V207_AUTHORITY_REJECTED" } }), {
          status: 403,
        });
      }
      if (rollbackSeen && restorationProbeCalls++ < 16) {
        return new Response(JSON.stringify({ error: { code: "V207_ROUTE_DISABLED" } }), {
          status: 404,
        });
      }
      return new Response(JSON.stringify({ error: { code: "V207_ROUTE_DISABLED" } }), {
        status: 404,
      });
    };

    const orchestration = await runV207LiveOrchestration({
      authorityParser: parseFixtureRefreshAuthority,
      environment,
      cwd: resolve(process.cwd(), "../.."),
      configPath: files.configPath,
      evidencePath: files.evidencePath,
      diskAvailableBytes: V207_ORCHESTRATOR_MIN_FREE_BYTES,
      commandRunner,
      fetchImpl,
      nonceFactory: () => NONCE,
      sleepImpl: async () => undefined,
      installSignalHandlers: false,
    });

    expect(orchestration.runnerExitCode).toBe(0);
    expect(deployCalls).toBe(1);
    expect(statusCalls).toBe(3);
    expect(versionsCalls).toBe(2);
    expect(refreshDisabledProbeCalls).toBe(49);
    expect(restorationProbeCalls).toBe(16);
    expect(signerSecretPresent).toBe(false);
    const rollback = calls.find((call) => call.args.includes("rollback"));
    expect(rollback?.args).toContain(REFRESH_VERSION_ID);
    expect(rollback?.args).not.toContain(VERSION_ID);
    const evidence = await readFile(files.evidencePath, "utf8");
    expect(evidence).toContain('"event": "rollback_anchor_refresh_disabled_route_stable"');
    expect(evidence).toContain('"event": "rollback_anchor_refresh_captured"');
    expect(evidence).toContain('"event": "orchestration_complete"');
  });

  it("refuses a stale signer before refresh mutation instead of deleting it without an anchor", async () => {
    const files = await fixture();
    await enableRollbackAnchorRefresh(files.configPath);
    const calls: V207CommandRequest[] = [];
    let preRouteProbeCalls = 0;
    const environment = {
      ...files.environment,
      [V207_ROLLBACK_ANCHOR_REFRESH_CONFIG_KEY]: V207_ROLLBACK_ANCHOR_REFRESH_ACTIVATION,
    };
    const commandRunner = async (request: V207CommandRequest): Promise<V207CommandResult> => {
      calls.push(request);
      if (request.command === "git") return result();
      if (request.args.includes("deployments")) {
        return result(
          JSON.stringify({
            id: DEPLOYMENT_ID,
            versions: [{ version_id: VERSION_ID, percentage: 100 }],
          }),
        );
      }
      if (request.args.includes("versions") && request.args.includes("list")) {
        return result(RECENT_VERSION_LIST);
      }
      if (request.args.includes("secret") && request.args.includes("list")) {
        return result(JSON.stringify([{ name: V207_ORCHESTRATOR_SECRET_NAME }]));
      }
      throw new Error("refresh must not mutate with a stale signer");
    };

    await expect(
      runV207LiveOrchestration({
        authorityParser: parseFixtureRefreshAuthority,
        environment,
        cwd: resolve(process.cwd(), "../.."),
        configPath: files.configPath,
        evidencePath: files.evidencePath,
        diskAvailableBytes: V207_ORCHESTRATOR_MIN_FREE_BYTES,
        commandRunner,
        fetchImpl: async () => {
          preRouteProbeCalls += 1;
          return new Response(JSON.stringify({ error: { code: "V207_ROUTE_DISABLED" } }), {
            status: 404,
          });
        },
        sleepImpl: async () => undefined,
        installSignalHandlers: false,
      }),
    ).rejects.toMatchObject({ code: "V207_ROLLBACK_ANCHOR_REFRESH_STALE_SIGNER_PRESENT" });

    expect(calls.some((call) => call.args.includes("deploy"))).toBe(false);
    expect(calls.some((call) => call.args.includes("delete"))).toBe(false);
    expect(preRouteProbeCalls).toBe(17);
    expect(
      calls.some((call) => call.args.some((arg) => arg.endsWith("v207-live-qualification.ts"))),
    ).toBe(false);
  });

  it("rejects a 503 pre-mutation baseline in refresh mode before build or deployment", async () => {
    const files = await fixture();
    await enableRollbackAnchorRefresh(files.configPath);
    const calls: V207CommandRequest[] = [];
    const environment = {
      ...files.environment,
      [V207_ROLLBACK_ANCHOR_REFRESH_CONFIG_KEY]: V207_ROLLBACK_ANCHOR_REFRESH_ACTIVATION,
    };
    const commandRunner = async (request: V207CommandRequest): Promise<V207CommandResult> => {
      calls.push(request);
      if (request.command === "git") return result();
      if (request.args.includes("deployments")) {
        return result(
          JSON.stringify({
            id: DEPLOYMENT_ID,
            versions: [{ version_id: VERSION_ID, percentage: 100 }],
          }),
        );
      }
      if (request.args.includes("versions") && request.args.includes("list")) {
        return result(RECENT_VERSION_LIST);
      }
      throw new Error("503 baseline must stop before mutation");
    };

    await expect(
      runV207LiveOrchestration({
        authorityParser: parseFixtureRefreshAuthority,
        environment,
        cwd: resolve(process.cwd(), "../.."),
        configPath: files.configPath,
        evidencePath: files.evidencePath,
        diskAvailableBytes: V207_ORCHESTRATOR_MIN_FREE_BYTES,
        commandRunner,
        fetchImpl: async () =>
          new Response(JSON.stringify({ error: { code: "HOSTED_ROUTE_NOT_COMPOSED" } }), {
            status: 503,
          }),
        installSignalHandlers: false,
      }),
    ).rejects.toMatchObject({ code: "V207_ROLLBACK_ANCHOR_REFRESH_PRE_ROUTE_UNCONFIRMED" });

    expect(calls.some((call) => call.args.includes("build:staging"))).toBe(false);
    expect(calls.some((call) => call.args.includes("deploy"))).toBe(false);
    expect(
      calls.some((call) => call.args.some((arg) => arg.endsWith("v207-live-qualification.ts"))),
    ).toBe(false);
  });

  it("rolls back the old anchor after a refresh route mismatch without invoking qualification", async () => {
    const files = await fixture();
    await enableRollbackAnchorRefresh(files.configPath);
    const calls: V207CommandRequest[] = [];
    let rollbackSeen = false;
    let versionsCalls = 0;
    let routeProbeCalls = 0;
    const environment = {
      ...files.environment,
      [V207_ROLLBACK_ANCHOR_REFRESH_CONFIG_KEY]: V207_ROLLBACK_ANCHOR_REFRESH_ACTIVATION,
    };
    const commandRunner = async (request: V207CommandRequest): Promise<V207CommandResult> => {
      calls.push(request);
      if (request.command === "git") return result();
      if (request.args.includes("deployments")) {
        return result(
          JSON.stringify({
            id: DEPLOYMENT_ID,
            versions: [{ version_id: VERSION_ID, percentage: 100, script_hash: "sha256:old" }],
          }),
        );
      }
      if (request.args.includes("versions") && request.args.includes("list")) {
        versionsCalls += 1;
        return result(RECENT_VERSION_LIST);
      }
      if (request.args.includes("deploy") && !request.args.includes("deployments")) return result();
      if (request.args.includes("rollback")) {
        rollbackSeen = true;
        return result();
      }
      if (request.args.includes("secret") && request.args.includes("list")) return result("[]");
      if (request.args.includes("secret")) throw new Error("signer mutation must not run");
      return result();
    };
    const fetchImpl: typeof fetch = async () => {
      routeProbeCalls += 1;
      if (routeProbeCalls <= 17 || rollbackSeen) {
        return new Response(JSON.stringify({ error: { code: "V207_ROUTE_DISABLED" } }), {
          status: 404,
        });
      }
      return new Response(JSON.stringify({ error: { code: "HOSTED_ROUTE_NOT_COMPOSED" } }), {
        status: 503,
      });
    };

    await expect(
      runV207LiveOrchestration({
        authorityParser: parseFixtureRefreshAuthority,
        environment,
        cwd: resolve(process.cwd(), "../.."),
        configPath: files.configPath,
        evidencePath: files.evidencePath,
        diskAvailableBytes: V207_ORCHESTRATOR_MIN_FREE_BYTES,
        commandRunner,
        fetchImpl,
        sleepImpl: async () => undefined,
        installSignalHandlers: false,
      }),
    ).rejects.toMatchObject({ code: "V207_ROLLBACK_ANCHOR_REFRESH_ROUTE_UNCONFIRMED" });

    expect(rollbackSeen).toBe(true);
    expect(versionsCalls).toBe(3);
    expect(
      calls.some((call) => call.args.some((arg) => arg.endsWith("v207-live-qualification.ts"))),
    ).toBe(false);
    const rollback = calls.find((call) => call.args.includes("rollback"));
    expect(rollback?.args).toContain(VERSION_ID);
    const evidence = await readFile(files.evidencePath, "utf8");
    expect(evidence).toContain("V207_ROLLBACK_ANCHOR_REFRESH_ROUTE_UNCONFIRMED");
    expect(evidence).toContain('"event": "worker_rolled_back"');
    expect(evidence).toContain('"result": "FAILED"');
  });

  it("fails cleanup-uncertain without a blind rollback when refresh evicts the old anchor", async () => {
    const files = await fixture();
    await enableRollbackAnchorRefresh(files.configPath);
    const calls: V207CommandRequest[] = [];
    let versionsCalls = 0;
    let rollbackSeen = false;
    let routeProbeCalls = 0;
    const environment = {
      ...files.environment,
      [V207_ROLLBACK_ANCHOR_REFRESH_CONFIG_KEY]: V207_ROLLBACK_ANCHOR_REFRESH_ACTIVATION,
    };
    const commandRunner = async (request: V207CommandRequest): Promise<V207CommandResult> => {
      calls.push(request);
      if (request.command === "git") return result();
      if (request.args.includes("deployments")) {
        return result(
          JSON.stringify({
            id: DEPLOYMENT_ID,
            versions: [{ version_id: VERSION_ID, percentage: 100, script_hash: "sha256:old" }],
          }),
        );
      }
      if (request.args.includes("versions") && request.args.includes("list")) {
        versionsCalls += 1;
        return result(versionsCalls === 1 ? RECENT_VERSION_LIST : OLD_ANCHOR_MISSING_VERSION_LIST);
      }
      if (request.args.includes("deploy") && !request.args.includes("deployments")) return result();
      if (request.args.includes("rollback")) {
        rollbackSeen = true;
        throw new Error("blind rollback must not be attempted");
      }
      if (request.args.includes("secret") && request.args.includes("list")) return result("[]");
      if (request.args.includes("secret")) throw new Error("signer mutation must not run");
      return result();
    };
    const fetchImpl: typeof fetch = async () => {
      routeProbeCalls += 1;
      if (routeProbeCalls <= 17 || rollbackSeen) {
        return new Response(JSON.stringify({ error: { code: "V207_ROUTE_DISABLED" } }), {
          status: 404,
        });
      }
      return new Response(JSON.stringify({ error: { code: "HOSTED_ROUTE_NOT_COMPOSED" } }), {
        status: 503,
      });
    };

    await expect(
      runV207LiveOrchestration({
        authorityParser: parseFixtureRefreshAuthority,
        environment,
        cwd: resolve(process.cwd(), "../.."),
        configPath: files.configPath,
        evidencePath: files.evidencePath,
        diskAvailableBytes: V207_ORCHESTRATOR_MIN_FREE_BYTES,
        commandRunner,
        fetchImpl,
        sleepImpl: async () => undefined,
        installSignalHandlers: false,
      }),
    ).rejects.toMatchObject({ code: "V207_CLEANUP_UNCERTAIN" });

    expect(rollbackSeen).toBe(false);
    expect(versionsCalls).toBe(2);
    expect(
      calls.some((call) => call.args.some((arg) => arg.endsWith("v207-live-qualification.ts"))),
    ).toBe(false);
    const evidence = await readFile(files.evidencePath, "utf8");
    expect(evidence).toContain("V207_ROLLBACK_ANCHOR_REFRESH_OLD_ANCHOR_NOT_RETAINED");
    expect(evidence).toContain('"event": "worker_rollback_skipped_old_anchor_not_retained"');
    expect(evidence).toContain('"result": "CLEANUP_UNCERTAIN"');
  });

  it("falls back to the old anchor when the post-promotion disabled route flaps", async () => {
    const files = await fixture();
    await enableRollbackAnchorRefresh(files.configPath);
    const calls: V207CommandRequest[] = [];
    let statusCalls = 0;
    let versionsCalls = 0;
    let routeProbeCalls = 0;
    let postPromotionProbeCalls = 0;
    let rollbackSeen = false;
    const environment = {
      ...files.environment,
      [V207_ROLLBACK_ANCHOR_REFRESH_CONFIG_KEY]: V207_ROLLBACK_ANCHOR_REFRESH_ACTIVATION,
    };
    const commandRunner = async (request: V207CommandRequest): Promise<V207CommandResult> => {
      calls.push(request);
      if (request.command === "git") return result();
      if (request.args.includes("deployments")) {
        statusCalls += 1;
        const version_id = statusCalls === 2 ? REFRESH_VERSION_ID : VERSION_ID;
        return result(
          JSON.stringify({
            id: DEPLOYMENT_ID,
            versions: [
              {
                version_id,
                percentage: 100,
                script_hash: statusCalls === 2 ? "sha256:refreshed" : "sha256:old",
              },
            ],
          }),
        );
      }
      if (request.args.includes("versions") && request.args.includes("list")) {
        versionsCalls += 1;
        return result(versionsCalls === 2 ? REFRESHED_VERSION_LIST : RECENT_VERSION_LIST);
      }
      if (request.args.includes("secret") && request.args.includes("list")) return result("[]");
      if (request.args.includes("build:staging")) return result();
      if (request.args.includes("deploy") && !request.args.includes("deployments")) return result();
      if (request.args.includes("rollback")) {
        rollbackSeen = true;
        return result();
      }
      throw new Error("post-promotion flap must stop before signer mutation");
    };
    const fetchImpl: typeof fetch = async () => {
      routeProbeCalls += 1;
      if (routeProbeCalls <= 33) {
        return new Response(JSON.stringify({ error: { code: "V207_ROUTE_DISABLED" } }), {
          status: 404,
        });
      }
      if (!rollbackSeen) {
        postPromotionProbeCalls += 1;
        if (postPromotionProbeCalls === 1) {
          return new Response(JSON.stringify({ error: { code: "V207_ROUTE_DISABLED" } }), {
            status: 404,
          });
        }
        return new Response(JSON.stringify({ error: { code: "HOSTED_ROUTE_NOT_COMPOSED" } }), {
          status: 503,
        });
      }
      return new Response(JSON.stringify({ error: { code: "V207_ROUTE_DISABLED" } }), {
        status: 404,
      });
    };

    await expect(
      runV207LiveOrchestration({
        authorityParser: parseFixtureRefreshAuthority,
        environment,
        cwd: resolve(process.cwd(), "../.."),
        configPath: files.configPath,
        evidencePath: files.evidencePath,
        diskAvailableBytes: V207_ORCHESTRATOR_MIN_FREE_BYTES,
        commandRunner,
        fetchImpl,
        sleepImpl: async () => undefined,
        installSignalHandlers: false,
      }),
    ).rejects.toMatchObject({ code: "V207_ROLLBACK_ANCHOR_REFRESH_ROUTE_UNCONFIRMED" });

    expect(rollbackSeen).toBe(true);
    expect(postPromotionProbeCalls).toBe(2);
    expect(statusCalls).toBe(3);
    expect(versionsCalls).toBe(4);
    expect(
      calls.some((call) => call.args.some((arg) => arg.endsWith("v207-live-qualification.ts"))),
    ).toBe(false);
    const rollback = calls.find((call) => call.args.includes("rollback"));
    expect(rollback?.args).toContain(VERSION_ID);
    expect(rollback?.args).not.toContain(REFRESH_VERSION_ID);
  });

  it("treats a partially failed refresh deploy as cleanup-uncertain when the old anchor is gone", async () => {
    const files = await fixture();
    await enableRollbackAnchorRefresh(files.configPath);
    const calls: V207CommandRequest[] = [];
    let versionsCalls = 0;
    let rollbackSeen = false;
    let routeProbeCalls = 0;
    const environment = {
      ...files.environment,
      [V207_ROLLBACK_ANCHOR_REFRESH_CONFIG_KEY]: V207_ROLLBACK_ANCHOR_REFRESH_ACTIVATION,
    };
    const commandRunner = async (request: V207CommandRequest): Promise<V207CommandResult> => {
      calls.push(request);
      if (request.command === "git") return result();
      if (request.args.includes("deployments")) {
        return result(
          JSON.stringify({
            id: DEPLOYMENT_ID,
            versions: [{ version_id: VERSION_ID, percentage: 100 }],
          }),
        );
      }
      if (request.args.includes("versions") && request.args.includes("list")) {
        versionsCalls += 1;
        return result(versionsCalls === 1 ? RECENT_VERSION_LIST : OLD_ANCHOR_MISSING_VERSION_LIST);
      }
      if (request.args.includes("secret") && request.args.includes("list")) return result("[]");
      if (request.args.includes("deploy") && !request.args.includes("deployments")) {
        return result("partial deploy", 1);
      }
      if (request.args.includes("rollback")) {
        rollbackSeen = true;
        throw new Error("blind rollback must not be attempted");
      }
      return result();
    };
    const fetchImpl: typeof fetch = async () => {
      routeProbeCalls += 1;
      return new Response(JSON.stringify({ error: { code: "V207_ROUTE_DISABLED" } }), {
        status: 404,
      });
    };

    await expect(
      runV207LiveOrchestration({
        authorityParser: parseFixtureRefreshAuthority,
        environment,
        cwd: resolve(process.cwd(), "../.."),
        configPath: files.configPath,
        evidencePath: files.evidencePath,
        diskAvailableBytes: V207_ORCHESTRATOR_MIN_FREE_BYTES,
        commandRunner,
        fetchImpl,
        sleepImpl: async () => undefined,
        installSignalHandlers: false,
      }),
    ).rejects.toMatchObject({ code: "V207_CLEANUP_UNCERTAIN" });

    expect(rollbackSeen).toBe(false);
    expect(versionsCalls).toBe(2);
    expect(routeProbeCalls).toBe(17);
    expect(calls.some((call) => call.args.includes("deploy"))).toBe(true);
    expect(
      calls.some((call) => call.args.some((arg) => arg.endsWith("v207-live-qualification.ts"))),
    ).toBe(false);
    const evidence = await readFile(files.evidencePath, "utf8");
    expect(evidence).toContain("V207_ROLLBACK_ANCHOR_REFRESH_OLD_ANCHOR_NOT_RETAINED");
    expect(evidence).toContain('"result": "CLEANUP_UNCERTAIN"');
  });

  it("rolls back the old anchor when the refreshed anchor falls outside newest seven of ten", async () => {
    const files = await fixture();
    await enableRollbackAnchorRefresh(files.configPath);
    const calls: V207CommandRequest[] = [];
    let statusCalls = 0;
    let versionsCalls = 0;
    let routeProbeCalls = 0;
    let rollbackSeen = false;
    const environment = {
      ...files.environment,
      [V207_ROLLBACK_ANCHOR_REFRESH_CONFIG_KEY]: V207_ROLLBACK_ANCHOR_REFRESH_ACTIVATION,
    };
    const commandRunner = async (request: V207CommandRequest): Promise<V207CommandResult> => {
      calls.push(request);
      if (request.command === "git") return result();
      if (request.args.includes("deployments")) {
        statusCalls += 1;
        const version_id = statusCalls === 2 ? REFRESH_VERSION_ID : VERSION_ID;
        return result(
          JSON.stringify({
            id: DEPLOYMENT_ID,
            versions: [{ version_id, percentage: 100, script_hash: "sha256:anchor" }],
          }),
        );
      }
      if (request.args.includes("versions") && request.args.includes("list")) {
        versionsCalls += 1;
        return result(RECENT_VERSION_LIST);
      }
      if (request.args.includes("secret") && request.args.includes("list")) return result("[]");
      if (request.args.includes("build:staging")) return result();
      if (request.args.includes("deploy") && !request.args.includes("deployments")) return result();
      if (request.args.includes("rollback")) {
        rollbackSeen = true;
        return result();
      }
      throw new Error("outside-newest-seven must stop before signer mutation");
    };
    const fetchImpl: typeof fetch = async () => {
      routeProbeCalls += 1;
      return new Response(JSON.stringify({ error: { code: "V207_ROUTE_DISABLED" } }), {
        status: 404,
      });
    };

    await expect(
      runV207LiveOrchestration({
        authorityParser: parseFixtureRefreshAuthority,
        environment,
        cwd: resolve(process.cwd(), "../.."),
        configPath: files.configPath,
        evidencePath: files.evidencePath,
        diskAvailableBytes: V207_ORCHESTRATOR_MIN_FREE_BYTES,
        commandRunner,
        fetchImpl,
        sleepImpl: async () => undefined,
        installSignalHandlers: false,
      }),
    ).rejects.toMatchObject({ code: "V207_WORKER_ROLLBACK_ANCHOR_NOT_RETAINED" });

    expect(rollbackSeen).toBe(true);
    expect(routeProbeCalls).toBe(49);
    expect(statusCalls).toBe(3);
    expect(versionsCalls).toBe(4);
    expect(
      calls.some((call) => call.args.some((arg) => arg.endsWith("v207-live-qualification.ts"))),
    ).toBe(false);
    const rollback = calls.find((call) => call.args.includes("rollback"));
    expect(rollback?.args).toContain(VERSION_ID);
    expect(rollback?.args).not.toContain(REFRESH_VERSION_ID);
  });

  it("hard-stops route restoration when the deadline aborts an injected stalled sleep", async () => {
    const files = await fixture();
    let signerSecretPresent = false;
    let rollbackSeen = false;
    const commandRunner = async (request: V207CommandRequest): Promise<V207CommandResult> => {
      if (request.command === "git") return result();
      if (request.args.includes("versions") && request.args.includes("list")) {
        return result(RECENT_VERSION_LIST);
      }
      if (request.args.includes("deployments")) {
        return result(
          JSON.stringify({
            id: DEPLOYMENT_ID,
            versions: [{ version_id: VERSION_ID, percentage: 100 }],
          }),
        );
      }
      if (request.args.includes("secret") && request.args.includes("list")) {
        return result(
          JSON.stringify(signerSecretPresent ? [{ name: V207_ORCHESTRATOR_SECRET_NAME }] : []),
        );
      }
      if (request.args.includes("secret") && request.args.includes("put")) {
        signerSecretPresent = true;
        return result();
      }
      if (request.args.includes("secret") && request.args.includes("delete")) {
        signerSecretPresent = false;
        return result();
      }
      if (request.args.includes("rollback")) rollbackSeen = true;
      return result();
    };
    const fetchImpl: typeof fetch = async () => {
      if (signerSecretPresent) {
        return new Response(JSON.stringify({ error: { code: "V207_AUTHORITY_REJECTED" } }), {
          status: 403,
        });
      }
      return new Response(
        JSON.stringify({
          error: { code: rollbackSeen ? "V207_ROUTE_DISABLED" : "HOSTED_ROUTE_NOT_COMPOSED" },
        }),
        { status: rollbackSeen ? 404 : 503 },
      );
    };
    const startedAt = Date.now();

    await expect(
      runV207LiveOrchestration({
        authorityParser: parseFixtureAuthority,
        environment: files.environment,
        cwd: resolve(process.cwd(), "../.."),
        configPath: files.configPath,
        evidencePath: files.evidencePath,
        diskAvailableBytes: V207_ORCHESTRATOR_MIN_FREE_BYTES,
        commandRunner,
        fetchImpl,
        nonceFactory: () => NONCE,
        sleepImpl: async () => new Promise<void>(() => undefined),
        routeRestorationSignal: AbortSignal.timeout(25),
        installSignalHandlers: false,
      }),
    ).rejects.toMatchObject({ code: "V207_CLEANUP_UNCERTAIN" });

    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(signerSecretPresent).toBe(false);
    expect(rollbackSeen).toBe(true);
    const evidence = await readFile(files.evidencePath, "utf8");
    expect(evidence).toContain('"result": "CLEANUP_UNCERTAIN"');
    expect(evidence).toContain("V207_ROUTE_RESTORATION_UNCONFIRMED");
    expect(evidence).not.toContain('"event": "restored_route_confirmed"');
  });

  it("fails closed when the restored route alternates after its first exact fingerprint", async () => {
    const files = await fixture();
    let signerSecretPresent = false;
    let activeRouteProbeCalls = 0;
    let rollbackSeen = false;
    let restorationProbeCalls = 0;
    const commandRunner = async (request: V207CommandRequest): Promise<V207CommandResult> => {
      if (request.command === "git") return result();
      if (request.args.includes("versions") && request.args.includes("list")) {
        return result(RECENT_VERSION_LIST);
      }
      if (request.args.includes("deployments")) {
        return result(
          JSON.stringify({
            id: DEPLOYMENT_ID,
            versions: [{ version_id: VERSION_ID, percentage: 100 }],
          }),
        );
      }
      if (request.args.includes("secret") && request.args.includes("list")) {
        return result(
          JSON.stringify(signerSecretPresent ? [{ name: V207_ORCHESTRATOR_SECRET_NAME }] : []),
        );
      }
      if (request.args.includes("secret") && request.args.includes("put")) {
        signerSecretPresent = true;
        return result();
      }
      if (request.args.includes("secret") && request.args.includes("delete")) {
        signerSecretPresent = false;
        return result();
      }
      if (request.args.includes("rollback")) rollbackSeen = true;
      return result();
    };
    const fetchImpl: typeof fetch = async () => {
      if (signerSecretPresent && activeRouteProbeCalls++ === 0) {
        return new Response(JSON.stringify({ error: { code: "V207_ROUTE_DISABLED" } }), {
          status: 404,
        });
      }
      if (signerSecretPresent) {
        return new Response(JSON.stringify({ error: { code: "V207_AUTHORITY_REJECTED" } }), {
          status: 403,
        });
      }
      if (!rollbackSeen) {
        return new Response(JSON.stringify({ error: { code: "V207_ROUTE_DISABLED" } }), {
          status: 404,
        });
      }
      if (restorationProbeCalls++ === 0) {
        return new Response(JSON.stringify({ error: { code: "V207_ROUTE_DISABLED" } }), {
          status: 404,
        });
      }
      return new Response(JSON.stringify({ error: { code: "HOSTED_ROUTE_NOT_COMPOSED" } }), {
        status: 503,
      });
    };

    await expect(
      runV207LiveOrchestration({
        authorityParser: parseFixtureAuthority,
        environment: files.environment,
        cwd: resolve(process.cwd(), "../.."),
        configPath: files.configPath,
        evidencePath: files.evidencePath,
        diskAvailableBytes: V207_ORCHESTRATOR_MIN_FREE_BYTES,
        commandRunner,
        fetchImpl,
        nonceFactory: () => NONCE,
        sleepImpl: async () => undefined,
        routeRestorationSignal: AbortSignal.timeout(1_000),
        installSignalHandlers: false,
      }),
    ).rejects.toMatchObject({ code: "V207_CLEANUP_UNCERTAIN" });

    expect(signerSecretPresent).toBe(false);
    expect(rollbackSeen).toBe(true);
    expect(restorationProbeCalls).toBe(2);
    const evidence = await readFile(files.evidencePath, "utf8");
    expect(evidence).toContain('"result": "CLEANUP_UNCERTAIN"');
    expect(evidence).toContain("V207_ROUTE_RESTORATION_UNCONFIRMED");
    expect(evidence).not.toContain('"event": "restored_route_confirmed"');
  });

  it("propagates SIGTERM to the installed tsx child", async () => {
    const root = await mkdtemp("/tmp/vf-v207-child-");
    roots.push(root);
    const scriptPath = join(root, "signal-handler.ts");
    await writeFile(
      scriptPath,
      'process.on("SIGTERM", () => { process.stdout.write("SIGTERM_HANDLED"); process.exit(0); });\nsetInterval(() => {}, 1000);\n',
    );
    const controller = new AbortController();
    const child = spawnV207Command({
      command: join(resolve(process.cwd(), "../.."), "apps/web/node_modules/.bin/tsx"),
      args: [scriptPath],
      cwd: join(resolve(process.cwd(), "../.."), "apps/web"),
      env: { PATH: process.env.PATH },
      signal: controller.signal,
    });
    await new Promise<void>((resolveSleep) => setTimeout(resolveSleep, 500));
    controller.abort();
    const childResult = await child;
    expect(childResult.exitCode).toBe(0);
    expect(childResult.signal).toBeNull();
    expect(childResult.stdout).toBe("SIGTERM_HANDLED");
  });

  it("runs rollback and secret cleanup after the qualification child is SIGTERM-terminated", async () => {
    const files = await fixture();
    const calls: V207CommandRequest[] = [];
    let signerSecretPresent = false;
    const qualificationCommand = join(
      resolve(process.cwd(), "../.."),
      "apps/web/node_modules/.bin/tsx",
    );
    const commandRunner = async (request: V207CommandRequest): Promise<V207CommandResult> => {
      calls.push(request);
      if (request.command === "git") return result();
      if (request.args.includes("versions") && request.args.includes("list")) {
        return result(RECENT_VERSION_LIST);
      }
      if (request.args.includes("deployments"))
        return result(
          JSON.stringify({
            id: DEPLOYMENT_ID,
            versions: [{ version_id: VERSION_ID, percentage: 100 }],
          }),
        );
      if (request.args.includes("secret") && request.args.includes("list")) {
        return result(
          JSON.stringify(signerSecretPresent ? [{ name: V207_ORCHESTRATOR_SECRET_NAME }] : []),
        );
      }
      if (request.args.includes("secret") && request.args.includes("put")) {
        signerSecretPresent = true;
        return result();
      }
      if (request.args.includes("secret") && request.args.includes("delete")) {
        signerSecretPresent = false;
        return result();
      }
      if (request.command === qualificationCommand) {
        expect(request.args).toEqual(["src/server/providers/v207-live-qualification.ts"]);
        if (request.env.V207_PREFLIGHT_ONLY === "1") return result();
        return {
          exitCode: null,
          signal: "SIGTERM",
          stdout: "RUNPOD_STDOUT_SECRET_MUST_NOT_ESCAPE",
          stderr:
            "https://provider.invalid/status/secret-body MAGE_OUTPUT_LINEAGE_INVALID " +
            "RUNPOD_SECONDARY_CODE",
        };
      }
      return result();
    };
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify(
          signerSecretPresent
            ? { error: { code: "V207_AUTHORITY_REJECTED" } }
            : { error: { code: "V207_ROUTE_DISABLED" } },
        ),
        { status: signerSecretPresent ? 403 : 404 },
      );

    await expect(
      runV207LiveOrchestration({
        authorityParser: parseFixtureAuthority,
        environment: files.environment,
        cwd: resolve(process.cwd(), "../.."),
        configPath: files.configPath,
        evidencePath: files.evidencePath,
        diskAvailableBytes: V207_ORCHESTRATOR_MIN_FREE_BYTES,
        commandRunner,
        fetchImpl,
        nonceFactory: () => NONCE,
        sleepImpl: async () => undefined,
        installSignalHandlers: false,
      }),
    ).rejects.toMatchObject({ code: "V207_LIVE_RUNNER_FAILED" });
    expect(signerSecretPresent).toBe(false);
    expect(calls.some((call) => call.args.includes("rollback"))).toBe(true);
    expect(calls.some((call) => call.args.includes("delete"))).toBe(true);
    const evidence = await readFile(files.evidencePath, "utf8");
    expect(evidence).toContain('"event": "signer_secret_deleted"');
    expect(evidence).toContain('"event": "worker_rolled_back"');
    expect(evidence).toContain('"result": "FAILED"');
    expect(evidence).toContain('"child_failure_code": "MAGE_OUTPUT_LINEAGE_INVALID"');
    expect(evidence).not.toContain("RUNPOD_STDOUT_SECRET_MUST_NOT_ESCAPE");
    expect(evidence).not.toContain("secret-body");
    expect(evidence).not.toContain("RUNPOD_SECONDARY_CODE");
    expect(evidence).not.toContain(NONCE);
  });

  it("fails closed when the signer route never propagates beyond the disabled response", async () => {
    const files = await fixture();
    const calls: V207CommandRequest[] = [];
    let signerSecretPresent = false;
    const commandRunner = async (request: V207CommandRequest): Promise<V207CommandResult> => {
      calls.push(request);
      if (request.command === "git") return result();
      if (request.args.includes("versions") && request.args.includes("list")) {
        return result(RECENT_VERSION_LIST);
      }
      if (request.args.includes("deployments"))
        return result(
          JSON.stringify({
            id: DEPLOYMENT_ID,
            versions: [{ version_id: VERSION_ID, percentage: 100 }],
          }),
        );
      if (request.args.includes("secret") && request.args.includes("list")) {
        return result(
          JSON.stringify(signerSecretPresent ? [{ name: V207_ORCHESTRATOR_SECRET_NAME }] : []),
        );
      }
      if (request.args.includes("secret") && request.args.includes("put")) {
        signerSecretPresent = true;
        return result();
      }
      if (request.args.includes("secret") && request.args.includes("delete")) {
        signerSecretPresent = false;
        return result();
      }
      return result();
    };
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify(
          signerSecretPresent
            ? { error: { code: "V207_ROUTE_DISABLED" } }
            : { error: { code: "HOSTED_ROUTE_NOT_COMPOSED" } },
        ),
        { status: signerSecretPresent ? 404 : 503 },
      );

    await expect(
      runV207LiveOrchestration({
        authorityParser: parseFixtureAuthority,
        environment: files.environment,
        cwd: resolve(process.cwd(), "../.."),
        configPath: files.configPath,
        evidencePath: files.evidencePath,
        diskAvailableBytes: V207_ORCHESTRATOR_MIN_FREE_BYTES,
        commandRunner,
        fetchImpl,
        nonceFactory: () => NONCE,
        sleepImpl: async () => undefined,
        installSignalHandlers: false,
      }),
    ).rejects.toMatchObject({ code: "V207_AUTHORITY_PROPAGATION_UNCONFIRMED" });
    expect(signerSecretPresent).toBe(false);
    expect(
      calls.some((call) => call.args.some((arg) => arg.endsWith("v207-live-qualification.ts"))),
    ).toBe(false);
    const evidence = await readFile(files.evidencePath, "utf8");
    expect(evidence).toContain("V207_AUTHORITY_PROPAGATION_UNCONFIRMED");
    expect(evidence).not.toContain('"event": "live_preflight_completed"');
    expect(evidence).not.toContain(NONCE);
  });

  it("does not require RUNPOD_KEY when the live runner uses its configured Keychain", async () => {
    const files = await fixture();
    let liveRunnerSeen = false;
    let signerSecretPresent = false;
    const commandRunner = async (request: V207CommandRequest): Promise<V207CommandResult> => {
      if (request.command === "git") return result();
      if (request.args.includes("versions") && request.args.includes("list")) {
        return result(RECENT_VERSION_LIST);
      }
      if (request.args.includes("deployments"))
        return result(
          JSON.stringify({
            id: DEPLOYMENT_ID,
            versions: [{ version_id: VERSION_ID, percentage: 100 }],
          }),
        );
      if (request.args.includes("secret") && request.args.includes("list")) {
        return result(
          JSON.stringify(signerSecretPresent ? [{ name: V207_ORCHESTRATOR_SECRET_NAME }] : []),
        );
      }
      if (request.args.includes("secret") && request.args.includes("delete")) {
        signerSecretPresent = false;
        return result();
      }
      if (request.args.includes("secret") && request.args.includes("put")) {
        signerSecretPresent = true;
        return result();
      }
      if (
        request.args.some((argument) => argument.endsWith("v207-live-qualification.ts")) &&
        request.env.V207_PREFLIGHT_ONLY !== "1"
      ) {
        liveRunnerSeen = true;
        expect(request.env.RUNPOD_KEY).toBeUndefined();
      }
      return result();
    };
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify(
          signerSecretPresent
            ? { error: { code: "V207_AUTHORITY_REJECTED" } }
            : { error: { code: "V207_ROUTE_DISABLED" } },
        ),
        { status: signerSecretPresent ? 403 : 404 },
      );
    const environment = { ...files.environment };
    delete (environment as { RUNPOD_KEY?: string }).RUNPOD_KEY;
    await expect(
      runV207LiveOrchestration({
        authorityParser: parseFixtureAuthority,
        environment,
        cwd: resolve(process.cwd(), "../.."),
        configPath: files.configPath,
        evidencePath: files.evidencePath,
        diskAvailableBytes: V207_ORCHESTRATOR_MIN_FREE_BYTES,
        commandRunner: async (request) => {
          if (request.args.includes("secret") && request.args.includes("put"))
            signerSecretPresent = true;
          if (request.args.includes("secret") && request.args.includes("delete"))
            signerSecretPresent = false;
          return commandRunner(request);
        },
        fetchImpl,
        nonceFactory: () => NONCE,
        sleepImpl: async () => undefined,
        installSignalHandlers: false,
      }),
    ).resolves.toBeTruthy();
    expect(liveRunnerSeen).toBe(true);
  });

  it("fails before provider mutation on a dirty worktree without inventing a rollback failure", async () => {
    const files = await fixture();
    const calls: V207CommandRequest[] = [];
    await expect(
      runV207LiveOrchestration({
        authorityParser: parseFixtureAuthority,
        environment: files.environment,
        cwd: resolve(process.cwd(), "../.."),
        configPath: files.configPath,
        evidencePath: files.evidencePath,
        diskAvailableBytes: V207_ORCHESTRATOR_MIN_FREE_BYTES,
        commandRunner: async (request) => {
          calls.push(request);
          if (request.command === "git") return result(" M local-change\n");
          throw new Error("provider command must not run");
        },
        fetchImpl: async () => {
          throw new Error("route probe must not run");
        },
        installSignalHandlers: false,
      }),
    ).rejects.toMatchObject({ code: "V207_GIT_WORKTREE_DIRTY" });
    expect(calls).toHaveLength(1);
    const evidence = await readFile(files.evidencePath, "utf8");
    expect(evidence).not.toContain("V207_ROLLBACK_TARGET_MISSING");
    expect(evidence).toContain("worker_rollback_skipped_no_mutation");
  });

  it("fails closed before any Worker mutation when no exact rollback anchor is available", async () => {
    const files = await fixture();
    const calls: V207CommandRequest[] = [];
    await expect(
      runV207LiveOrchestration({
        authorityParser: parseFixtureAuthority,
        environment: files.environment,
        cwd: resolve(process.cwd(), "../.."),
        configPath: files.configPath,
        evidencePath: files.evidencePath,
        diskAvailableBytes: V207_ORCHESTRATOR_MIN_FREE_BYTES,
        commandRunner: async (request) => {
          calls.push(request);
          if (request.command === "git") return result();
          if (request.args.includes("versions") && request.args.includes("list")) {
            return result(RECENT_VERSION_LIST);
          }
          if (request.args.includes("deployments")) {
            return result(
              JSON.stringify({
                id: DEPLOYMENT_ID,
                versions: [{ id: DEPLOYMENT_ID, percentage: 100 }],
              }),
            );
          }
          throw new Error("no provider mutation is allowed without an anchor");
        },
        fetchImpl: async () => {
          throw new Error("route probe must not run");
        },
        installSignalHandlers: false,
      }),
    ).rejects.toMatchObject({ code: "V207_WORKER_ROLLBACK_ANCHOR_MISSING" });
    expect(calls).toHaveLength(2);
    expect(calls.some((call) => call.args.includes("deploy"))).toBe(false);
    expect(calls.some((call) => call.args.includes("secret"))).toBe(false);
    const evidence = await readFile(files.evidencePath, "utf8");
    expect(evidence).toContain("V207_WORKER_ROLLBACK_ANCHOR_MISSING");
    expect(evidence).toContain("worker_rollback_skipped_no_mutation");
  });

  it("rolls back after removing a pre-existing signer secret because that is remote mutation", async () => {
    const files = await fixture();
    const calls: V207CommandRequest[] = [];
    let signerSecretPresent = true;
    const commandRunner = async (request: V207CommandRequest): Promise<V207CommandResult> => {
      calls.push(request);
      if (request.command === "git") return result();
      if (request.args.includes("versions") && request.args.includes("list")) {
        return result(RECENT_VERSION_LIST);
      }
      if (request.args.includes("deployments"))
        return result(
          JSON.stringify({
            id: DEPLOYMENT_ID,
            versions: [{ version_id: VERSION_ID, percentage: 100 }],
          }),
        );
      if (request.args.includes("secret") && request.args.includes("list")) {
        return result(
          JSON.stringify(signerSecretPresent ? [{ name: V207_ORCHESTRATOR_SECRET_NAME }] : []),
        );
      }
      if (request.args.includes("secret") && request.args.includes("delete")) {
        signerSecretPresent = false;
        return result();
      }
      if (request.args.includes("build:staging")) return result("build failed", 1);
      return result();
    };
    await expect(
      runV207LiveOrchestration({
        authorityParser: parseFixtureAuthority,
        environment: files.environment,
        cwd: resolve(process.cwd(), "../.."),
        configPath: files.configPath,
        evidencePath: files.evidencePath,
        diskAvailableBytes: V207_ORCHESTRATOR_MIN_FREE_BYTES,
        commandRunner,
        fetchImpl: async () =>
          new Response(JSON.stringify({ error: { code: "V207_ROUTE_DISABLED" } }), { status: 404 }),
        sleepImpl: async () => undefined,
        installSignalHandlers: false,
      }),
    ).rejects.toMatchObject({ code: "V207_STAGING_BUILD_FAILED" });
    expect(calls.some((call) => call.args.includes("rollback"))).toBe(true);
    expect(await readFile(files.evidencePath, "utf8")).not.toContain(
      "V207_ROLLBACK_TARGET_MISSING",
    );
  });

  it("fails before route or Worker mutation when the active anchor fell out of recent versions", async () => {
    const files = await fixture();
    const calls: V207CommandRequest[] = [];
    const commandRunner = async (request: V207CommandRequest): Promise<V207CommandResult> => {
      calls.push(request);
      if (request.command === "git") return result();
      if (request.args.includes("deployments")) {
        return result(
          JSON.stringify({
            id: DEPLOYMENT_ID,
            versions: [{ version_id: VERSION_ID, percentage: 100 }],
          }),
        );
      }
      if (request.args.includes("versions") && request.args.includes("list")) {
        return result(
          JSON.stringify({
            versions: VERSION_HISTORY.slice(0, 9).map((version_id) => ({ version_id })),
          }),
        );
      }
      throw new Error("provider mutation must not run without retained rollback anchor");
    };
    await expect(
      runV207LiveOrchestration({
        authorityParser: parseFixtureAuthority,
        environment: files.environment,
        cwd: resolve(process.cwd(), "../.."),
        configPath: files.configPath,
        evidencePath: files.evidencePath,
        diskAvailableBytes: V207_ORCHESTRATOR_MIN_FREE_BYTES,
        commandRunner,
        fetchImpl: async () => {
          throw new Error("route probe must not run");
        },
        installSignalHandlers: false,
      }),
    ).rejects.toMatchObject({ code: "V207_WORKER_ROLLBACK_ANCHOR_NOT_RETAINED" });
    expect(calls).toHaveLength(3);
    expect(calls.some((call) => call.args.includes("deploy"))).toBe(false);
    expect(calls.some((call) => call.args.includes("secret"))).toBe(false);
    expect(await readFile(files.evidencePath, "utf8")).toContain(
      "V207_WORKER_ROLLBACK_ANCHOR_NOT_RETAINED",
    );
  });

  it("fails closed when rollback does not restore the captured Worker version", async () => {
    const files = await fixture();
    let signerSecretPresent = false;
    let statusCalls = 0;
    const commandRunner = async (request: V207CommandRequest): Promise<V207CommandResult> => {
      if (request.command === "git") return result();
      if (request.args.includes("versions") && request.args.includes("list")) {
        return result(RECENT_VERSION_LIST);
      }
      if (request.args.includes("deployments")) {
        statusCalls += 1;
        return result(
          JSON.stringify({
            id: DEPLOYMENT_ID,
            versions: [
              {
                version_id: VERSION_ID,
                percentage: 100,
                script_hash: statusCalls === 1 ? "sha256:old" : "sha256:changed",
              },
            ],
          }),
        );
      }
      if (request.args.includes("secret") && request.args.includes("list")) {
        return result(
          JSON.stringify(signerSecretPresent ? [{ name: V207_ORCHESTRATOR_SECRET_NAME }] : []),
        );
      }
      if (request.args.includes("secret") && request.args.includes("put")) {
        signerSecretPresent = true;
        return result();
      }
      if (request.args.includes("secret") && request.args.includes("delete")) {
        signerSecretPresent = false;
        return result();
      }
      return result();
    };
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify(
          signerSecretPresent
            ? { error: { code: "V207_AUTHORITY_REJECTED" } }
            : { error: { code: "V207_ROUTE_DISABLED" } },
        ),
        { status: signerSecretPresent ? 403 : 404 },
      );
    await expect(
      runV207LiveOrchestration({
        authorityParser: parseFixtureAuthority,
        environment: files.environment,
        cwd: resolve(process.cwd(), "../.."),
        configPath: files.configPath,
        evidencePath: files.evidencePath,
        diskAvailableBytes: V207_ORCHESTRATOR_MIN_FREE_BYTES,
        commandRunner,
        fetchImpl,
        nonceFactory: () => NONCE,
        installSignalHandlers: false,
      }),
    ).rejects.toMatchObject({ code: "V207_CLEANUP_UNCERTAIN" });
    expect(statusCalls).toBe(2);
    expect(signerSecretPresent).toBe(false);
    const evidence = await readFile(files.evidencePath, "utf8");
    expect(evidence).toContain('"result": "CLEANUP_UNCERTAIN"');
    expect(evidence).toContain("V207_ROLLBACK_VERSION_UNCONFIRMED");
    expect(evidence).toContain("V207_ROUTE_RESTORATION_SKIPPED_ROLLBACK_UNCONFIRMED");
    expect(evidence).not.toContain('"event": "restored_route_confirmed"');
  });
});

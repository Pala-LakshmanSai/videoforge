import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertV207DiskHeadroom,
  assertV207WorkerRollbackAnchorRetained,
  bindV207RollbackAnchorRefreshInvocation,
  classifyV207WranglerDeployFailure,
  extractV207ChildFailureCode,
  extractV207WorkerRollbackAnchor,
  extractV207WorkerVersionId,
  runV207LiveOrchestration,
  spawnV207Command,
  V207_ORCHESTRATOR_SECRET_NAME,
  V207_ORCHESTRATOR_MIN_FREE_BYTES,
  V207_READ_ONLY_ADMISSION_ENTRYPOINT,
  V207_ANCHOR_REFRESH_EXPECTED_OLD_ACTIVE_RECORD_SHA256,
  V207_ANCHOR_REFRESH_EXPECTED_OLD_ACTIVE_VERSION_ID_SHA256,
  V207_WRANGLER_DEPLOY_FAILURE_EVENT_DETAIL_KEYS,
  V207_ROLLBACK_ANCHOR_REFRESH_ACTIVATION,
  V207_ROLLBACK_ANCHOR_REFRESH_CONFIG_KEY,
  type V207CommandRequest,
  type V207CommandResult,
} from "./v207-live-orchestrator";
import {
  applyV207RollbackAnchorRefreshMarker,
  V207_ANCHOR_REFRESH_BASELINE_SHA256,
  V207_ANCHOR_REFRESH_DEFAULT_CONFIG_PATH,
} from "./v207-anchor-refresh-marker";
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
const SIGNER_VERSION_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const TEST_OLD_ACTIVE_VERSION_ID_SHA256 = `sha256:${createHash("sha256")
  .update(VERSION_ID, "utf8")
  .digest("hex")}`;
const TEST_OLD_ACTIVE_RECORD_SHA256 = extractV207WorkerRollbackAnchor({
  versions: [{ version_id: VERSION_ID, percentage: 100 }],
}).sha256;
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
  const baseline = await readFile(V207_ANCHOR_REFRESH_DEFAULT_CONFIG_PATH);
  await writeFile(configPath, baseline, { mode: 0o600 });
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
  const result = await applyV207RollbackAnchorRefreshMarker(configPath);
  expect(result.sha256).not.toBe(V207_ANCHOR_REFRESH_BASELINE_SHA256);
}

type RefreshVersionIdentityFailure = "missing" | "stale" | "alternating";
type RefreshVersionIdentityBoundary = "pre-route" | "disabled-route" | "restored-route";

/**
 * Exercise only the version-bound refresh fences.  This stays provider-free: the command runner
 * is a deterministic Wrangler/qualification fixture and the route is an in-memory Response.
 */
async function exerciseRefreshVersionIdentityFailure(
  identityFailure: RefreshVersionIdentityFailure,
  boundary: RefreshVersionIdentityBoundary,
): Promise<{
  readonly files: Awaited<ReturnType<typeof fixture>>;
  readonly calls: V207CommandRequest[];
  readonly error: unknown;
  readonly refreshDisabledProbeCalls: number;
  readonly restorationProbeCalls: number;
}> {
  const files = await fixture();
  const calls: V207CommandRequest[] = [];
  let signerSecretPresent = false;
  let statusCalls = 0;
  let versionsCalls = 0;
  let rollbackSeen = false;
  let refreshDisabledProbeCalls = 0;
  let restorationProbeCalls = 0;
  let activeRouteProbeCalls = 0;
  const qualificationCommand = join(
    resolve(process.cwd(), "../.."),
    "apps/web/node_modules/.bin/tsx",
  );
  const environment = {
    ...files.environment,
    [V207_ROLLBACK_ANCHOR_REFRESH_CONFIG_KEY]: V207_ROLLBACK_ANCHOR_REFRESH_ACTIVATION,
  };
  const commandRunner = async (request: V207CommandRequest): Promise<V207CommandResult> => {
    calls.push(request);
    if (request.command === "git") return result();
    if (request.args.includes("versions") && request.args.includes("list")) {
      versionsCalls += 1;
      return result(versionsCalls === 1 ? RECENT_VERSION_LIST : REFRESHED_VERSION_LIST);
    }
    if (request.args.includes("deployments")) {
      statusCalls += 1;
      const version_id = signerSecretPresent
        ? SIGNER_VERSION_ID
        : rollbackSeen && boundary === "disabled-route"
          ? VERSION_ID
          : statusCalls === 1
            ? VERSION_ID
            : REFRESH_VERSION_ID;
      return result(
        JSON.stringify({
          id: DEPLOYMENT_ID,
          versions: [
            {
              version_id,
              percentage: 100,
              ...(version_id === VERSION_ID ? {} : { script_hash: "sha256:refreshed" }),
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
    if (request.args.includes("deploy") && !request.args.includes("deployments")) return result();
    if (request.args.includes("rollback")) {
      rollbackSeen = true;
      return result();
    }
    if (request.command === qualificationCommand) {
      if (request.env.V207_PREFLIGHT_ONLY === "1") return result();
      return { ...result("", 1), stderr: "MAGE_VERSION_BOUND_TEST_FAILURE" };
    }
    return result();
  };
  const response = (status: number, code: string, workerVersionId?: string): Response =>
    new Response(JSON.stringify({ error: { code } }), {
      status,
      ...(workerVersionId === undefined
        ? {}
        : { headers: { "x-videoforge-worker-version": workerVersionId } }),
    });
  const failureIdentity = (expected: string, readIndex: number): string | undefined => {
    if (identityFailure === "missing") return undefined;
    if (identityFailure === "stale") {
      return expected === VERSION_ID ? CHANGED_VERSION_ID : VERSION_ID;
    }
    return readIndex === 0 ? expected : CHANGED_VERSION_ID;
  };
  const fetchImpl: typeof fetch = async () => {
    if (rollbackSeen && !signerSecretPresent) {
      if (boundary === "restored-route") {
        const readIndex = restorationProbeCalls++;
        return response(404, "V207_ROUTE_DISABLED", failureIdentity(REFRESH_VERSION_ID, readIndex));
      }
      return response(404, "V207_ROUTE_DISABLED", VERSION_ID);
    }
    if (signerSecretPresent) {
      if (activeRouteProbeCalls++ === 0) {
        return response(404, "V207_ROUTE_DISABLED", SIGNER_VERSION_ID);
      }
      return response(403, "V207_AUTHORITY_REJECTED", SIGNER_VERSION_ID);
    }
    const readIndex = refreshDisabledProbeCalls++;
    if (readIndex < 17) {
      if (boundary === "pre-route") {
        return response(404, "V207_ROUTE_DISABLED", failureIdentity(VERSION_ID, readIndex));
      }
      return response(404, "V207_ROUTE_DISABLED", VERSION_ID);
    }
    if (boundary === "disabled-route") {
      return response(
        404,
        "V207_ROUTE_DISABLED",
        failureIdentity(REFRESH_VERSION_ID, readIndex - 17),
      );
    }
    return response(404, "V207_ROUTE_DISABLED", REFRESH_VERSION_ID);
  };
  let error: unknown;
  try {
    await runV207LiveOrchestration({
      authorityParser: parseFixtureRefreshAuthority,
      expectedOldActiveVersionIdSha256: TEST_OLD_ACTIVE_VERSION_ID_SHA256,
      expectedOldActiveRecordSha256: TEST_OLD_ACTIVE_RECORD_SHA256,
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
  } catch (caught) {
    error = caught;
  }
  return {
    files,
    calls,
    error,
    refreshDisabledProbeCalls,
    restorationProbeCalls,
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("V2-07 live orchestrator", () => {
  it("pins the currently approved refreshed active Worker anchor without exposing its raw version id", () => {
    expect(V207_ANCHOR_REFRESH_EXPECTED_OLD_ACTIVE_VERSION_ID_SHA256).toBe(
      "sha256:1e5d35b4c2709641024655c7df5832f360aeb665068804f07ecc600a68186e19",
    );
    expect(V207_ANCHOR_REFRESH_EXPECTED_OLD_ACTIVE_RECORD_SHA256).toBe(
      "sha256:54cd4dcb8a5b2afe8ca8cad9f7aad7dd6d47ef14b36ef0f7b03c7ba90a234c89",
    );
  });

  it("requires an explicit refresh binding on every injected authority", () => {
    expect(parseFixtureAuthority().anchorRefreshAuthorized).toBe(false);
    expect(parseFixtureRefreshAuthority().anchorRefreshAuthorized).toBe(true);
    expect(
      bindV207RollbackAnchorRefreshInvocation(
        {
          [V207_ROLLBACK_ANCHOR_REFRESH_CONFIG_KEY]: V207_ROLLBACK_ANCHOR_REFRESH_ACTIVATION,
        },
        parseFixtureRefreshAuthority(),
      ),
    ).toEqual({
      enabled: true,
      activation: V207_ROLLBACK_ANCHOR_REFRESH_ACTIVATION,
    });
    expect(bindV207RollbackAnchorRefreshInvocation({}, parseFixtureAuthority())).toEqual({
      enabled: false,
      activation: null,
    });
  });

  it.each([
    {
      name: "missing",
      environment: {},
      code: "V207_ROLLBACK_ANCHOR_REFRESH_ACTIVATION_REQUIRED",
    },
    {
      name: "wrong",
      environment: { [V207_ROLLBACK_ANCHOR_REFRESH_CONFIG_KEY]: "true" },
      code: "V207_ROLLBACK_ANCHOR_REFRESH_ACTIVATION_INVALID",
    },
  ] as const)(
    "fails closed before every command when approved refresh activation is $name",
    async ({ environment: activationEnvironment, code }) => {
      const files = await fixture();
      const calls: V207CommandRequest[] = [];
      await expect(
        runV207LiveOrchestration({
          authorityParser: parseFixtureRefreshAuthority,
          environment: { ...files.environment, ...activationEnvironment },
          cwd: resolve(process.cwd(), "../.."),
          configPath: files.configPath,
          evidencePath: files.evidencePath,
          diskAvailableBytes: V207_ORCHESTRATOR_MIN_FREE_BYTES,
          commandRunner: async (request) => {
            calls.push(request);
            throw new Error("invalid refresh invocation must not execute a command");
          },
          fetchImpl: async () => {
            throw new Error("invalid refresh invocation must not probe the route");
          },
          installSignalHandlers: false,
        }),
      ).rejects.toMatchObject({ code });
      expect(calls).toHaveLength(0);
      const evidence = await readFile(files.evidencePath, "utf8");
      expect(evidence).toContain('"anchor_refresh_authorized": true');
      expect(evidence).toContain('"event": "rollback_anchor_refresh_invocation_rejected"');
      expect(evidence).toContain(code);
      expect(evidence).toContain('"worker_rollback_skipped_no_mutation"');
    },
  );

  it("pins production orchestration to the exact protected config path", async () => {
    const files = await fixture();
    await expect(
      runV207LiveOrchestration({
        authorityParser: parseFixtureAuthority,
        environment: files.environment,
        configPath: files.configPath,
        evidencePath: files.evidencePath,
        diskAvailableBytes: V207_ORCHESTRATOR_MIN_FREE_BYTES,
      }),
    ).rejects.toMatchObject({ code: "V207_WRANGLER_CONFIG_PATH_MISMATCH" });
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

  it.each([
    {
      name: "authentication",
      stderr: "Authentication failed for API token; bearer secret must not persist",
      expected: "authentication",
    },
    {
      name: "configuration",
      stderr: "Invalid configuration: account_id is required",
      expected: "configuration",
    },
    {
      name: "network",
      stderr: "fetch failed: ECONNRESET while contacting provider",
      expected: "network",
    },
    {
      name: "rate limit",
      stderr: "429 Too Many Requests: quota exceeded",
      expected: "rate_limit",
    },
    {
      name: "provider",
      stdout: "Cloudflare API request failed with code 10021",
      expected: "provider",
    },
    {
      name: "unknown",
      stderr: "opaque provider body with no recognized class",
      expected: "unknown",
    },
  ] as const)("classifies bounded Wrangler deploy failure $name", ({ expected, ...output }) => {
    const diagnostic = classifyV207WranglerDeployFailure({
      exitCode: 1,
      signal: null,
      stdout: output.stdout ?? "",
      stderr: output.stderr ?? "",
    });
    expect(diagnostic.failure_class).toBe(expected);
    expect(diagnostic.exit_code).toBe(1);
    expect(diagnostic.signal).toBeNull();
    expect(JSON.stringify(diagnostic)).not.toContain("bearer secret");
    expect(JSON.stringify(diagnostic)).not.toContain("provider body");
    expect(JSON.stringify(diagnostic)).not.toContain("10021");
  });

  it("returns only the exact deploy event detail tuple and never raw command text", () => {
    const diagnostic = classifyV207WranglerDeployFailure({
      exitCode: 1,
      signal: null,
      stdout: "https://api.example.invalid/deploy/provider-id response-body-secret",
      stderr: "x-videoforge-worker-version: 11111111-1111-4111-8111-111111111111",
    });
    const eventDetail = {
      deploy_failure_class: diagnostic.failure_class,
      deploy_output_channel: diagnostic.output_channel,
      deploy_exit_code: diagnostic.exit_code,
      deploy_signal: diagnostic.signal,
    };
    expect(Object.keys(eventDetail)).toEqual([...V207_WRANGLER_DEPLOY_FAILURE_EVENT_DETAIL_KEYS]);
    expect(JSON.stringify(eventDetail)).not.toContain("api.example.invalid");
    expect(JSON.stringify(eventDetail)).not.toContain("provider-id");
    expect(JSON.stringify(eventDetail)).not.toContain("response-body-secret");
    expect(JSON.stringify(eventDetail)).not.toContain("11111111-1111-4111-8111-111111111111");
  });

  it("preserves the deploy top-level code and cleanup while recording only bounded diagnostics", async () => {
    const files = await fixture();
    const calls: V207CommandRequest[] = [];
    let rollbackSeen = false;
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
      if (request.args.includes("secret") && request.args.includes("list")) return result("[]");
      if (request.args.includes(V207_READ_ONLY_ADMISSION_ENTRYPOINT)) return result();
      if (request.args.includes("build:staging")) return result();
      if (request.args.includes("deploy")) {
        return {
          exitCode: 1,
          signal: null,
          stdout: "https://api.example.invalid/deploy/provider-id response-body-secret",
          stderr:
            "Cloudflare API request failed with code 10021; " +
            "x-videoforge-worker-version: 11111111-1111-4111-8111-111111111111",
        };
      }
      if (request.args.includes("rollback")) {
        rollbackSeen = true;
        return result();
      }
      return result();
    };
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ error: { code: "V207_ROUTE_DISABLED" } }), {
        status: 404,
      });

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
        sleepImpl: async () => undefined,
        installSignalHandlers: false,
      }),
    ).rejects.toMatchObject({ code: "V207_SIGNER_DISABLED_DEPLOY_FAILED" });

    expect(rollbackSeen).toBe(true);
    expect(
      calls.some((call) => call.args.some((arg) => arg.endsWith("v207-live-qualification.ts"))),
    ).toBe(false);
    const evidence = JSON.parse(await readFile(files.evidencePath, "utf8")) as {
      readonly events: ReadonlyArray<{
        readonly event: string;
        readonly detail?: Readonly<Record<string, unknown>>;
      }>;
      readonly result: string;
    };
    const failureEvent = evidence.events.find((event) => event.event === "orchestration_failed");
    expect(failureEvent?.detail).toEqual({
      code: "V207_SIGNER_DISABLED_DEPLOY_FAILED",
      deploy_failure_class: "provider",
      deploy_output_channel: "both",
      deploy_exit_code: 1,
      deploy_signal: null,
    });
    expect(evidence.result).toBe("FAILED");
    expect(JSON.stringify(evidence)).not.toContain("api.example.invalid");
    expect(JSON.stringify(evidence)).not.toContain("provider-id");
    expect(JSON.stringify(evidence)).not.toContain("response-body-secret");
    expect(JSON.stringify(evidence)).not.toContain("11111111-1111-4111-8111-111111111111");
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
            versions: [
              {
                version_id: signerSecretPresent ? SIGNER_VERSION_ID : VERSION_ID,
                percentage: 100,
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
          headers: { "x-videoforge-worker-version": SIGNER_VERSION_ID },
        });
      }
      if (signerSecretPresent) {
        return new Response(JSON.stringify({ error: { code: "V207_AUTHORITY_REJECTED" } }), {
          status: 403,
          headers: { "x-videoforge-worker-version": SIGNER_VERSION_ID },
        });
      }
      if (rollbackSeen && restorationProbeCalls++ < 2) {
        return new Response(JSON.stringify({ error: { code: "V207_ROUTE_DISABLED" } }), {
          status: 404,
        });
      }
      return new Response(JSON.stringify({ error: { code: "HOSTED_ROUTE_NOT_COMPOSED" } }), {
        status: 503,
        headers: { "x-videoforge-worker-version": REFRESH_VERSION_ID },
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
    expect(evidence).toContain('"event": "read_only_capacity_admission_completed"');
    expect(evidence).toContain('"event": "signer_route_activation_confirmed"');
    expect(evidence).toContain('"attempts": 17');
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
        call.args.includes(V207_READ_ONLY_ADMISSION_ENTRYPOINT) &&
        call.env.V207_PREFLIGHT_ONLY === "1",
    );
    expect(preflightRunner).toBeDefined();
    expect(preflightRunner?.command).toBe(
      join(resolve(process.cwd(), "../.."), "apps/web/node_modules/.bin/tsx"),
    );
    expect(preflightRunner?.args).toEqual([V207_READ_ONLY_ADMISSION_ENTRYPOINT]);
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
    const firstMutation = calls.find(
      (call) => call.args.includes("deploy") || call.args.includes("put"),
    );
    expect(firstMutation).toBeDefined();
    expect(calls.indexOf(preflightRunner as V207CommandRequest)).toBeLessThan(
      calls.indexOf(firstMutation as V207CommandRequest),
    );
    expect(calls.some((call) => call.args.includes("build:staging"))).toBe(true);
    expect(calls.some((call) => call.args.includes("deploy"))).toBe(true);
    expect(calls.some((call) => call.args.includes("rollback"))).toBe(true);
    const rollback = calls.find((call) => call.args.includes("rollback"));
    expect(rollback?.args).toContain(VERSION_ID);
    expect(rollback?.args).not.toContain(DEPLOYMENT_ID);
    expect(calls.flatMap((call) => call.args)).not.toContain(NONCE);
  });

  it("stops a failed capacity admission before every Worker mutation", async () => {
    const files = await fixture();
    const calls: V207CommandRequest[] = [];
    const baselineConfig = await readFile(files.configPath, "utf8");
    const qualificationCommand = join(
      resolve(process.cwd(), "../.."),
      "apps/web/node_modules/.bin/tsx",
    );
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
      if (request.args.includes("secret") && request.args.includes("list")) return result("[]");
      if (
        request.command === qualificationCommand &&
        request.args.includes(V207_READ_ONLY_ADMISSION_ENTRYPOINT)
      ) {
        return {
          exitCode: 1,
          signal: null,
          stdout: "provider-details-must-not-escape",
          stderr: "V207_CATALOG_RTX4090_EU_RO_1_UNAVAILABLE",
        };
      }
      throw new Error("UNEXPECTED_COMMAND_AFTER_FAILED_CAPACITY_ADMISSION");
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
          new Response(JSON.stringify({ error: { code: "V207_ROUTE_DISABLED" } }), {
            status: 404,
          }),
        nonceFactory: () => NONCE,
        sleepImpl: async () => undefined,
        installSignalHandlers: false,
      }),
    ).rejects.toMatchObject({ code: "V207_LIVE_PREFLIGHT" });

    expect(
      calls.filter((call) => call.args.includes(V207_READ_ONLY_ADMISSION_ENTRYPOINT)),
    ).toHaveLength(1);
    expect(calls.some((call) => call.args.includes("deploy"))).toBe(false);
    expect(calls.some((call) => call.args.includes("put"))).toBe(false);
    expect(calls.some((call) => call.args.includes("delete"))).toBe(false);
    expect(await readFile(files.configPath, "utf8")).toBe(baselineConfig);
    const evidence = await readFile(files.evidencePath, "utf8");
    expect(evidence).toContain('"child_failure_code": "V207_CATALOG_RTX4090_EU_RO_1_UNAVAILABLE"');
    expect(evidence).not.toContain("provider-details-must-not-escape");
    expect(evidence).not.toContain(NONCE);
  });

  it.each([
    {
      name: "404 then 403 then old-contract 400",
      expectedCode: "V207_AUTHORITY_PROPAGATION_UNCONFIRMED",
      responses: [
        { status: 404, code: "V207_ROUTE_DISABLED", versionId: SIGNER_VERSION_ID },
        { status: 403, code: "V207_AUTHORITY_REJECTED", versionId: SIGNER_VERSION_ID },
        { status: 400, code: "V207_REQUEST_INVALID", versionId: VERSION_ID },
      ],
    },
    {
      name: "alternating active edge version",
      expectedCode: "V207_AUTHORITY_VERSION_ID_UNCONFIRMED",
      responses: [
        { status: 403, code: "V207_AUTHORITY_REJECTED", versionId: SIGNER_VERSION_ID },
        { status: 403, code: "V207_AUTHORITY_REJECTED", versionId: CHANGED_VERSION_ID },
      ],
    },
    {
      name: "missing active edge version",
      expectedCode: "V207_ROUTE_VERSION_ID_MISSING",
      responses: [{ status: 403, code: "V207_AUTHORITY_REJECTED", versionId: null }],
    },
    {
      name: "malformed active edge version",
      expectedCode: "V207_ROUTE_VERSION_ID_INVALID",
      responses: [{ status: 403, code: "V207_AUTHORITY_REJECTED", versionId: "not-a-version" }],
    },
  ] as const)("fails closed on $name before qualification", async ({ expectedCode, responses }) => {
    const files = await fixture();
    const calls: V207CommandRequest[] = [];
    let signerSecretPresent = false;
    let responseIndex = 0;
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
            versions: [
              {
                version_id: signerSecretPresent ? SIGNER_VERSION_ID : VERSION_ID,
                percentage: 100,
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
      if (request.args.includes("rollback")) return result();
      return result();
    };
    const fetchImpl: typeof fetch = async () => {
      if (!signerSecretPresent) {
        return new Response(JSON.stringify({ error: { code: "HOSTED_ROUTE_NOT_COMPOSED" } }), {
          status: 503,
        });
      }
      const observed =
        responses[Math.min(responseIndex++, responses.length - 1)] ?? responses.at(-1)!;
      return new Response(JSON.stringify({ error: { code: observed.code } }), {
        status: observed.status,
        ...(observed.versionId === null
          ? {}
          : { headers: { "x-videoforge-worker-version": observed.versionId } }),
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
        installSignalHandlers: false,
      }),
    ).rejects.toMatchObject({ code: expectedCode });
    expect(signerSecretPresent).toBe(false);
    expect(
      calls.filter((call) => call.args.some((arg) => arg.endsWith("v207-live-qualification.ts"))),
    ).toHaveLength(0);
    const evidence = await readFile(files.evidencePath, "utf8");
    expect(evidence).toContain(expectedCode);
    expect(evidence).not.toContain(NONCE);
  });

  it("keeps the anchor-refresh deploy behind an exact environment/config pair", async () => {
    const cases = [
      {
        name: "environment-only",
        environment: {
          [V207_ROLLBACK_ANCHOR_REFRESH_CONFIG_KEY]: V207_ROLLBACK_ANCHOR_REFRESH_ACTIVATION,
        },
        configure: false,
        code: "V207_ROLLBACK_ANCHOR_REFRESH_AUTHORITY_REQUIRED",
        commandCalls: 0,
      },
      {
        name: "config-only",
        environment: {},
        configure: true,
        code: "V207_ROLLBACK_ANCHOR_REFRESH_CONFIG_MISMATCH",
        commandCalls: 1,
      },
      {
        name: "wrong-marker",
        environment: { [V207_ROLLBACK_ANCHOR_REFRESH_CONFIG_KEY]: "true" },
        configure: false,
        code: "V207_ROLLBACK_ANCHOR_REFRESH_ACTIVATION_INVALID",
        commandCalls: 0,
      },
      {
        name: "missing-authority-binding",
        environment: {
          [V207_ROLLBACK_ANCHOR_REFRESH_CONFIG_KEY]: V207_ROLLBACK_ANCHOR_REFRESH_ACTIVATION,
        },
        configure: true,
        code: "V207_ROLLBACK_ANCHOR_REFRESH_AUTHORITY_REQUIRED",
        commandCalls: 0,
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
      expect(calls).toHaveLength(testCase.commandCalls);
      expect(await readFile(files.evidencePath, "utf8")).toContain(testCase.code);
    }
  });

  it("refreshes to one newly deployed anchor, then qualifies and rolls back to that anchor", async () => {
    const files = await fixture();
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
        const version_id = signerSecretPresent
          ? SIGNER_VERSION_ID
          : statusCalls === 1
            ? VERSION_ID
            : REFRESH_VERSION_ID;
        return result(
          JSON.stringify({
            id: DEPLOYMENT_ID,
            versions: [
              {
                version_id,
                percentage: 100,
                ...(statusCalls === 1 ? {} : { script_hash: "sha256:refreshed" }),
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
          headers: { "x-videoforge-worker-version": VERSION_ID },
        });
      }
      if (!signerSecretPresent && !rollbackSeen) {
        refreshDisabledProbeCalls += 1;
        if (deployCalls === 0 && refreshDisabledProbeCalls === 5) {
          throw new Error("bounded pre-route transport gap");
        }
        return new Response(JSON.stringify({ error: { code: "V207_ROUTE_DISABLED" } }), {
          status: 404,
          headers: {
            "x-videoforge-worker-version": deployCalls === 0 ? VERSION_ID : REFRESH_VERSION_ID,
          },
        });
      }
      if (signerSecretPresent && activeRouteProbeCalls++ === 0) {
        return new Response(JSON.stringify({ error: { code: "V207_ROUTE_DISABLED" } }), {
          status: 404,
          headers: { "x-videoforge-worker-version": SIGNER_VERSION_ID },
        });
      }
      if (signerSecretPresent) {
        return new Response(JSON.stringify({ error: { code: "V207_AUTHORITY_REJECTED" } }), {
          status: 403,
          headers: { "x-videoforge-worker-version": SIGNER_VERSION_ID },
        });
      }
      if (rollbackSeen && restorationProbeCalls++ < 16) {
        return new Response(JSON.stringify({ error: { code: "V207_ROUTE_DISABLED" } }), {
          status: 404,
          headers: { "x-videoforge-worker-version": REFRESH_VERSION_ID },
        });
      }
      return new Response(JSON.stringify({ error: { code: "V207_ROUTE_DISABLED" } }), {
        status: 404,
        headers: { "x-videoforge-worker-version": REFRESH_VERSION_ID },
      });
    };

    const orchestration = await runV207LiveOrchestration({
      authorityParser: parseFixtureRefreshAuthority,
      expectedOldActiveVersionIdSha256: TEST_OLD_ACTIVE_VERSION_ID_SHA256,
      expectedOldActiveRecordSha256: TEST_OLD_ACTIVE_RECORD_SHA256,
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
    expect(statusCalls).toBe(4);
    expect(versionsCalls).toBe(2);
    expect(refreshDisabledProbeCalls).toBe(53);
    expect(restorationProbeCalls).toBe(16);
    expect(signerSecretPresent).toBe(false);
    const rollback = calls.find((call) => call.args.includes("rollback"));
    expect(rollback?.args).toContain(REFRESH_VERSION_ID);
    expect(rollback?.args).not.toContain(VERSION_ID);
    const evidence = await readFile(files.evidencePath, "utf8");
    expect(evidence).toContain('"event": "rollback_anchor_refresh_disabled_route_stable"');
    expect(evidence).toContain(
      '"event": "rollback_anchor_refresh_pre_mutation_route_transport_gap"',
    );
    expect(evidence).toContain('"count": 1');
    expect(evidence).toContain('"event": "rollback_anchor_refresh_captured"');
    expect(evidence).toContain('"event": "orchestration_complete"');
  });

  it.each([
    { name: "missing", identityFailure: "missing" as const },
    { name: "stale", identityFailure: "stale" as const },
    { name: "alternating", identityFailure: "alternating" as const },
  ])(
    "fails closed when the refresh-disabled route has a $name Worker version identity",
    async ({ identityFailure }) => {
      const outcome = await exerciseRefreshVersionIdentityFailure(
        identityFailure,
        "disabled-route",
      );
      expect([
        "V207_ROUTE_VERSION_ID_MISSING",
        "V207_ROUTE_VERSION_ID_UNCONFIRMED",
        "V207_ROLLBACK_ANCHOR_REFRESH_ROUTE_UNCONFIRMED",
      ]).toContain((outcome.error as { readonly code?: string } | undefined)?.code);
      expect(outcome.refreshDisabledProbeCalls).toBeLessThanOrEqual(19);
      expect(
        outcome.calls.some((call) =>
          call.args.some((argument) => argument.endsWith("v207-live-qualification.ts")),
        ),
      ).toBe(false);
      const evidence = await readFile(outcome.files.evidencePath, "utf8");
      expect(evidence).toMatch(
        /V207_(?:ROUTE_VERSION_ID_MISSING|ROUTE_VERSION_ID_UNCONFIRMED|ROLLBACK_ANCHOR_REFRESH_ROUTE_UNCONFIRMED)/u,
      );
      expect(evidence).not.toContain('"event": "orchestration_complete"');
    },
  );

  it.each([
    { name: "missing", identityFailure: "missing" as const },
    { name: "stale", identityFailure: "stale" as const },
    { name: "alternating", identityFailure: "alternating" as const },
  ])(
    "fails closed when the pre-mutation refresh-disabled route has a $name Worker version identity",
    async ({ identityFailure }) => {
      const outcome = await exerciseRefreshVersionIdentityFailure(identityFailure, "pre-route");
      expect([
        "V207_ROUTE_VERSION_ID_MISSING",
        "V207_ROUTE_VERSION_ID_UNCONFIRMED",
        "V207_ROLLBACK_ANCHOR_REFRESH_PRE_ROUTE_UNCONFIRMED",
      ]).toContain((outcome.error as { readonly code?: string } | undefined)?.code);
      expect(outcome.refreshDisabledProbeCalls).toBeLessThan(18);
      expect(
        outcome.calls.some((call) =>
          call.args.some((argument) => argument.endsWith("v207-live-qualification.ts")),
        ),
      ).toBe(false);
      const evidence = await readFile(outcome.files.evidencePath, "utf8");
      expect(evidence).not.toContain('"event": "orchestration_complete"');
    },
  );

  it.each([
    { name: "missing", identityFailure: "missing" as const },
    { name: "stale", identityFailure: "stale" as const },
    { name: "alternating", identityFailure: "alternating" as const },
  ])(
    "requires the exact refreshed rollback target during cleanup when the restored route has a $name Worker version identity",
    async ({ identityFailure }) => {
      const outcome = await exerciseRefreshVersionIdentityFailure(
        identityFailure,
        "restored-route",
      );
      expect(outcome.error).toMatchObject({ code: "V207_CLEANUP_UNCERTAIN" });
      expect(outcome.restorationProbeCalls).toBeLessThan(16);
      const evidence = await readFile(outcome.files.evidencePath, "utf8");
      expect(evidence).toContain('"result": "CLEANUP_UNCERTAIN"');
      expect(evidence).toMatch(
        /V207_(?:ROUTE_VERSION_ID_MISSING|ROUTE_VERSION_ID_UNCONFIRMED|ROUTE_RESTORATION_UNCONFIRMED)/u,
      );
      expect(evidence).not.toContain('"event": "restored_route_confirmed"');
    },
  );

  it("fails closed before route or Worker mutation when the observed old anchor is stale", async () => {
    const files = await fixture();
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
      throw new Error("old-anchor mismatch must stop before provider mutation");
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
          throw new Error("old-anchor mismatch must not probe the route");
        },
        sleepImpl: async () => undefined,
        installSignalHandlers: false,
      }),
    ).rejects.toMatchObject({ code: "V207_ROLLBACK_ANCHOR_REFRESH_OLD_ANCHOR_MISMATCH" });

    expect(calls.some((call) => call.args.includes("deploy"))).toBe(false);
    expect(calls.some((call) => call.command === "git")).toBe(true);
    expect(await readFile(files.configPath)).toEqual(
      await readFile(V207_ANCHOR_REFRESH_DEFAULT_CONFIG_PATH),
    );
    const evidence = JSON.parse(await readFile(files.evidencePath, "utf8")) as {
      readonly events: ReadonlyArray<{
        readonly event: string;
        readonly detail?: Readonly<Record<string, unknown>>;
      }>;
      readonly result: string;
    };
    expect(evidence.events.find((event) => event.event === "orchestration_failed")?.detail).toEqual(
      {
        code: "V207_ROLLBACK_ANCHOR_REFRESH_OLD_ANCHOR_MISMATCH",
      },
    );
    expect(evidence.events.some((event) => event.event === "orchestration_complete")).toBe(false);
    expect(
      evidence.events.some((event) => event.event === "rollback_anchor_refresh_marker_reverted"),
    ).toBe(true);
    expect(evidence.result).toBe("FAILED");
  });

  it("fails cleanup-uncertain when the protected marker cannot be applied exactly", async () => {
    const files = await fixture();
    const config = JSON.parse(await readFile(files.configPath, "utf8")) as {
      vars: Record<string, unknown>;
    };
    config.vars.VIDEOFORGE_PROVIDER_MODE = "fixture-drift";
    await writeFile(files.configPath, `${JSON.stringify(config)}\n`, { mode: 0o600 });
    await chmod(files.configPath, 0o600);
    const environment = {
      ...files.environment,
      [V207_ROLLBACK_ANCHOR_REFRESH_CONFIG_KEY]: V207_ROLLBACK_ANCHOR_REFRESH_ACTIVATION,
    };

    await expect(
      runV207LiveOrchestration({
        authorityParser: parseFixtureRefreshAuthority,
        environment,
        cwd: resolve(process.cwd(), "../.."),
        configPath: files.configPath,
        evidencePath: files.evidencePath,
        diskAvailableBytes: V207_ORCHESTRATOR_MIN_FREE_BYTES,
        commandRunner: async (request) => {
          if (request.command === "git") return result();
          throw new Error("marker apply drift must stop before provider mutation");
        },
        fetchImpl: async () => {
          throw new Error("marker apply drift must not probe the route");
        },
        installSignalHandlers: false,
      }),
    ).rejects.toMatchObject({ code: "V207_CLEANUP_UNCERTAIN" });

    const evidence = await readFile(files.evidencePath, "utf8");
    expect(evidence).toContain("V207_ANCHOR_REFRESH_MARKER_APPLY_UNCERTAIN");
    expect(evidence).toContain('"result": "CLEANUP_UNCERTAIN"');
  });

  it("refuses a stale signer before refresh mutation instead of deleting it without an anchor", async () => {
    const files = await fixture();
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
        expectedOldActiveVersionIdSha256: TEST_OLD_ACTIVE_VERSION_ID_SHA256,
        expectedOldActiveRecordSha256: TEST_OLD_ACTIVE_RECORD_SHA256,
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
            headers: { "x-videoforge-worker-version": VERSION_ID },
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
        expectedOldActiveVersionIdSha256: TEST_OLD_ACTIVE_VERSION_ID_SHA256,
        expectedOldActiveRecordSha256: TEST_OLD_ACTIVE_RECORD_SHA256,
        environment,
        cwd: resolve(process.cwd(), "../.."),
        configPath: files.configPath,
        evidencePath: files.evidencePath,
        diskAvailableBytes: V207_ORCHESTRATOR_MIN_FREE_BYTES,
        commandRunner,
        fetchImpl: async () =>
          new Response(JSON.stringify({ error: { code: "HOSTED_ROUTE_NOT_COMPOSED" } }), {
            status: 503,
            headers: { "x-videoforge-worker-version": VERSION_ID },
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

  it("exhausts bounded pre-mutation transport gaps without provider mutation", async () => {
    const files = await fixture();
    const calls: V207CommandRequest[] = [];
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
        return result(RECENT_VERSION_LIST);
      }
      throw new Error("transport exhaustion must stop before mutation");
    };

    await expect(
      runV207LiveOrchestration({
        authorityParser: parseFixtureRefreshAuthority,
        expectedOldActiveVersionIdSha256: TEST_OLD_ACTIVE_VERSION_ID_SHA256,
        expectedOldActiveRecordSha256: TEST_OLD_ACTIVE_RECORD_SHA256,
        environment,
        cwd: resolve(process.cwd(), "../.."),
        configPath: files.configPath,
        evidencePath: files.evidencePath,
        diskAvailableBytes: V207_ORCHESTRATOR_MIN_FREE_BYTES,
        commandRunner,
        fetchImpl: async () => {
          routeProbeCalls += 1;
          if (routeProbeCalls === 1) {
            return new Response(JSON.stringify({ error: { code: "V207_ROUTE_DISABLED" } }), {
              status: 404,
              headers: { "x-videoforge-worker-version": VERSION_ID },
            });
          }
          throw new Error("bounded transport failure");
        },
        sleepImpl: async () => undefined,
        installSignalHandlers: false,
      }),
    ).rejects.toMatchObject({
      code: "V207_ROLLBACK_ANCHOR_REFRESH_PRE_ROUTE_TRANSPORT_EXHAUSTED",
    });

    expect(routeProbeCalls).toBe(61);
    expect(calls.some((call) => call.args.includes("build:staging"))).toBe(false);
    expect(calls.some((call) => call.args.includes("deploy"))).toBe(false);
    expect(
      calls.some((call) => call.args.some((arg) => arg.endsWith("v207-live-qualification.ts"))),
    ).toBe(false);
    const evidence = await readFile(files.evidencePath, "utf8");
    expect(evidence).toContain(
      '"event": "rollback_anchor_refresh_pre_mutation_route_transport_gap"',
    );
    expect(evidence).toContain("V207_ROLLBACK_ANCHOR_REFRESH_PRE_ROUTE_TRANSPORT_EXHAUSTED");
    expect(evidence).not.toContain("bounded transport failure");
  });

  it("rolls back the old anchor after a refresh route mismatch without invoking qualification", async () => {
    const files = await fixture();
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
        const version_id = rollbackSeen
          ? VERSION_ID
          : calls.filter((call) => call.args.includes("deployments")).length === 1
            ? VERSION_ID
            : REFRESH_VERSION_ID;
        return result(
          JSON.stringify({
            id: DEPLOYMENT_ID,
            versions: [
              {
                version_id,
                percentage: 100,
                ...(version_id === VERSION_ID ? {} : { script_hash: "sha256:refreshed" }),
              },
            ],
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
          headers: { "x-videoforge-worker-version": VERSION_ID },
        });
      }
      return new Response(JSON.stringify({ error: { code: "HOSTED_ROUTE_NOT_COMPOSED" } }), {
        status: 503,
        headers: { "x-videoforge-worker-version": REFRESH_VERSION_ID },
      });
    };

    await expect(
      runV207LiveOrchestration({
        authorityParser: parseFixtureRefreshAuthority,
        expectedOldActiveVersionIdSha256: TEST_OLD_ACTIVE_VERSION_ID_SHA256,
        expectedOldActiveRecordSha256: TEST_OLD_ACTIVE_RECORD_SHA256,
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
          headers: { "x-videoforge-worker-version": VERSION_ID },
        });
      }
      return new Response(JSON.stringify({ error: { code: "HOSTED_ROUTE_NOT_COMPOSED" } }), {
        status: 503,
      });
    };

    await expect(
      runV207LiveOrchestration({
        authorityParser: parseFixtureRefreshAuthority,
        expectedOldActiveVersionIdSha256: TEST_OLD_ACTIVE_VERSION_ID_SHA256,
        expectedOldActiveRecordSha256: TEST_OLD_ACTIVE_RECORD_SHA256,
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
                ...(statusCalls === 2 ? { script_hash: "sha256:refreshed" } : {}),
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
      if (request.args.includes(V207_READ_ONLY_ADMISSION_ENTRYPOINT)) return result();
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
      if (routeProbeCalls <= 17) {
        return new Response(JSON.stringify({ error: { code: "V207_ROUTE_DISABLED" } }), {
          status: 404,
          headers: { "x-videoforge-worker-version": VERSION_ID },
        });
      }
      if (routeProbeCalls <= 33) {
        return new Response(JSON.stringify({ error: { code: "V207_ROUTE_DISABLED" } }), {
          status: 404,
          headers: { "x-videoforge-worker-version": REFRESH_VERSION_ID },
        });
      }
      if (!rollbackSeen) {
        postPromotionProbeCalls += 1;
        if (postPromotionProbeCalls === 1) {
          return new Response(JSON.stringify({ error: { code: "V207_ROUTE_DISABLED" } }), {
            status: 404,
            headers: { "x-videoforge-worker-version": REFRESH_VERSION_ID },
          });
        }
        return new Response(JSON.stringify({ error: { code: "HOSTED_ROUTE_NOT_COMPOSED" } }), {
          status: 503,
          headers: { "x-videoforge-worker-version": REFRESH_VERSION_ID },
        });
      }
      return new Response(JSON.stringify({ error: { code: "V207_ROUTE_DISABLED" } }), {
        status: 404,
        headers: { "x-videoforge-worker-version": VERSION_ID },
      });
    };

    await expect(
      runV207LiveOrchestration({
        authorityParser: parseFixtureRefreshAuthority,
        expectedOldActiveVersionIdSha256: TEST_OLD_ACTIVE_VERSION_ID_SHA256,
        expectedOldActiveRecordSha256: TEST_OLD_ACTIVE_RECORD_SHA256,
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
        headers: { "x-videoforge-worker-version": VERSION_ID },
      });
    };

    await expect(
      runV207LiveOrchestration({
        authorityParser: parseFixtureRefreshAuthority,
        expectedOldActiveVersionIdSha256: TEST_OLD_ACTIVE_VERSION_ID_SHA256,
        expectedOldActiveRecordSha256: TEST_OLD_ACTIVE_RECORD_SHA256,
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
            versions: [{ version_id, percentage: 100 }],
          }),
        );
      }
      if (request.args.includes("versions") && request.args.includes("list")) {
        versionsCalls += 1;
        return result(RECENT_VERSION_LIST);
      }
      if (request.args.includes("secret") && request.args.includes("list")) return result("[]");
      if (request.args.includes(V207_READ_ONLY_ADMISSION_ENTRYPOINT)) return result();
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
        headers: {
          "x-videoforge-worker-version":
            rollbackSeen || routeProbeCalls <= 17 ? VERSION_ID : REFRESH_VERSION_ID,
        },
      });
    };

    await expect(
      runV207LiveOrchestration({
        authorityParser: parseFixtureRefreshAuthority,
        expectedOldActiveVersionIdSha256: TEST_OLD_ACTIVE_VERSION_ID_SHA256,
        expectedOldActiveRecordSha256: TEST_OLD_ACTIVE_RECORD_SHA256,
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
    let propagationSleeps = 0;
    const commandRunner = async (request: V207CommandRequest): Promise<V207CommandResult> => {
      if (request.command === "git") return result();
      if (request.args.includes("versions") && request.args.includes("list")) {
        return result(RECENT_VERSION_LIST);
      }
      if (request.args.includes("deployments")) {
        return result(
          JSON.stringify({
            id: DEPLOYMENT_ID,
            versions: [
              {
                version_id: signerSecretPresent ? SIGNER_VERSION_ID : VERSION_ID,
                percentage: 100,
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
      if (request.args.includes("rollback")) rollbackSeen = true;
      return result();
    };
    const fetchImpl: typeof fetch = async () => {
      if (signerSecretPresent) {
        return new Response(JSON.stringify({ error: { code: "V207_AUTHORITY_REJECTED" } }), {
          status: 403,
          headers: { "x-videoforge-worker-version": SIGNER_VERSION_ID },
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
        sleepImpl: async () => {
          propagationSleeps += 1;
          // Activation now requires 16 exact active probes. Stall only once those probes have
          // completed, so this test still exercises the bounded restoration deadline.
          if (propagationSleeps > 15) await new Promise<void>(() => undefined);
        },
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
            versions: [
              {
                version_id: signerSecretPresent ? SIGNER_VERSION_ID : VERSION_ID,
                percentage: 100,
              },
            ],
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
        if (request.args.includes(V207_READ_ONLY_ADMISSION_ENTRYPOINT)) return result();
        expect(request.args).toEqual(["src/server/providers/v207-live-qualification.ts"]);
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
        {
          status: signerSecretPresent ? 403 : 404,
          headers: { "x-videoforge-worker-version": SIGNER_VERSION_ID },
        },
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
            versions: [
              {
                version_id: signerSecretPresent ? SIGNER_VERSION_ID : VERSION_ID,
                percentage: 100,
              },
            ],
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
        {
          status: signerSecretPresent ? 404 : 503,
          headers: signerSecretPresent
            ? { "x-videoforge-worker-version": SIGNER_VERSION_ID }
            : undefined,
        },
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
    expect(evidence).toContain('"event": "read_only_capacity_admission_completed"');
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
            versions: [
              {
                version_id: signerSecretPresent ? SIGNER_VERSION_ID : VERSION_ID,
                percentage: 100,
              },
            ],
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
        {
          status: signerSecretPresent ? 403 : 404,
          headers: { "x-videoforge-worker-version": SIGNER_VERSION_ID },
        },
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
        {
          status: signerSecretPresent ? 403 : 404,
          headers: { "x-videoforge-worker-version": VERSION_ID },
        },
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
    ).rejects.toMatchObject({ code: "V207_CLEANUP_UNCERTAIN" });
    expect(statusCalls).toBe(3);
    expect(signerSecretPresent).toBe(false);
    const evidence = await readFile(files.evidencePath, "utf8");
    expect(evidence).toContain('"result": "CLEANUP_UNCERTAIN"');
    expect(evidence).toContain("V207_ROLLBACK_VERSION_UNCONFIRMED");
    expect(evidence).toContain("V207_ROUTE_RESTORATION_SKIPPED_ROLLBACK_UNCONFIRMED");
    expect(evidence).not.toContain('"event": "restored_route_confirmed"');
  });
});

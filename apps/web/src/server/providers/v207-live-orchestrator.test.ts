import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  extractV207WorkerVersionId,
  runV207LiveOrchestration,
  V207_ORCHESTRATOR_SECRET_NAME,
  type V207CommandRequest,
  type V207CommandResult,
} from "./v207-live-orchestrator";

const IMAGE =
  "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:8a5b8f453c694b2eeee097e3d958b08c5e47c15290b5cdc17a4fb7e5e3e4f497";
const SOURCE_COMMIT = "d1d704c2f39581e745ba90151c7388673107de41";
const VERSION_ID = "11111111-1111-4111-8111-111111111111";
const CHANGED_VERSION_ID = "22222222-2222-4222-8222-222222222222";
const DEPLOYMENT_ID = "33333333-3333-4333-8333-333333333333";
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
      V207_FINITE_CAP_USD: "4",
      V207_WRANGLER_CONFIG: configPath,
      RUNPOD_KEY,
    } as const,
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("V2-07 live orchestrator", () => {
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

  it("runs the full flow with mocked commands, optional RunPod key, and redacted evidence", async () => {
    const files = await fixture();
    const calls: V207CommandRequest[] = [];
    let signerSecretPresent = false;
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
      return result();
    };
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify(
          signerSecretPresent
            ? { error: { code: "V207_AUTHORITY_REJECTED" } }
            : { error: { code: "HOSTED_ROUTE_NOT_COMPOSED" } },
        ),
        { status: signerSecretPresent ? 403 : 503 },
      );

    const orchestration = await runV207LiveOrchestration({
      environment: files.environment,
      cwd: resolve(process.cwd(), "../.."),
      configPath: files.configPath,
      evidencePath: files.evidencePath,
      commandRunner,
      fetchImpl,
      nonceFactory: () => NONCE,
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
    expect(evidence).toContain('"code": "HOSTED_ROUTE_NOT_COMPOSED"');
    expect(evidence).not.toContain(NONCE);
    expect(evidence).not.toContain(RUNPOD_KEY);
    expect((await stat(files.evidencePath)).mode & 0o077).toBe(0);

    const liveRunner = calls.find((call) =>
      call.args.some((argument) => argument.endsWith("v207-live-qualification.ts")),
    );
    expect(liveRunner?.cwd).toBe(join(resolve(process.cwd(), "../.."), "apps/web"));
    expect(liveRunner?.env.V207_AUTHORITY_NONCE).toBe(NONCE);
    expect(liveRunner?.env.RUNPOD_KEY).toBe(RUNPOD_KEY);
    expect(calls.some((call) => call.args.includes("build:staging"))).toBe(true);
    expect(calls.some((call) => call.args.includes("deploy"))).toBe(true);
    expect(calls.some((call) => call.args.includes("rollback"))).toBe(true);
    const rollback = calls.find((call) => call.args.includes("rollback"));
    expect(rollback?.args).toContain(VERSION_ID);
    expect(rollback?.args).not.toContain(DEPLOYMENT_ID);
    expect(calls.flatMap((call) => call.args)).not.toContain(NONCE);
  });

  it("does not require RUNPOD_KEY when the live runner uses its configured Keychain", async () => {
    const files = await fixture();
    let liveRunnerSeen = false;
    let signerSecretPresent = false;
    const commandRunner = async (request: V207CommandRequest): Promise<V207CommandResult> => {
      if (request.command === "git") return result();
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
      if (request.args.some((argument) => argument.endsWith("v207-live-qualification.ts"))) {
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
        environment,
        cwd: resolve(process.cwd(), "../.."),
        configPath: files.configPath,
        evidencePath: files.evidencePath,
        commandRunner: async (request) => {
          if (request.args.includes("secret") && request.args.includes("put"))
            signerSecretPresent = true;
          if (request.args.includes("secret") && request.args.includes("delete"))
            signerSecretPresent = false;
          return commandRunner(request);
        },
        fetchImpl,
        nonceFactory: () => NONCE,
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
        environment: files.environment,
        cwd: resolve(process.cwd(), "../.."),
        configPath: files.configPath,
        evidencePath: files.evidencePath,
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

  it("rolls back after removing a pre-existing signer secret because that is remote mutation", async () => {
    const files = await fixture();
    const calls: V207CommandRequest[] = [];
    let signerSecretPresent = true;
    const commandRunner = async (request: V207CommandRequest): Promise<V207CommandResult> => {
      calls.push(request);
      if (request.command === "git") return result();
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
        environment: files.environment,
        cwd: resolve(process.cwd(), "../.."),
        configPath: files.configPath,
        evidencePath: files.evidencePath,
        commandRunner,
        fetchImpl: async () =>
          new Response(JSON.stringify({ error: { code: "V207_ROUTE_DISABLED" } }), { status: 404 }),
        installSignalHandlers: false,
      }),
    ).rejects.toMatchObject({ code: "V207_STAGING_BUILD_FAILED" });
    expect(calls.some((call) => call.args.includes("rollback"))).toBe(true);
    expect(await readFile(files.evidencePath, "utf8")).not.toContain(
      "V207_ROLLBACK_TARGET_MISSING",
    );
  });

  it("fails closed when rollback does not restore the captured Worker version", async () => {
    const files = await fixture();
    let signerSecretPresent = false;
    let statusCalls = 0;
    const commandRunner = async (request: V207CommandRequest): Promise<V207CommandResult> => {
      if (request.command === "git") return result();
      if (request.args.includes("deployments")) {
        statusCalls += 1;
        return result(
          JSON.stringify({
            id: DEPLOYMENT_ID,
            versions: [
              {
                version_id: statusCalls === 1 ? VERSION_ID : CHANGED_VERSION_ID,
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
        environment: files.environment,
        cwd: resolve(process.cwd(), "../.."),
        configPath: files.configPath,
        evidencePath: files.evidencePath,
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
    expect(evidence).toContain("V207_ROUTE_RESTORATION_SKIPPED_ROLLBACK_UNCONFIRMED");
    expect(evidence).not.toContain('"event": "restored_route_confirmed"');
  });
});

import { describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import {
  V213_BRIDGE_ENVIRONMENT,
  V213_FULL_LIVE_COMMANDS,
  V213FullLiveBridgeError,
  createV213CleanupRuntime,
  createV213EarlyCleanupRuntime,
  createV213FullLiveProductionRuntime,
  createV213PrequalificationRuntime,
  createV213ProductionRuntime,
  createV213WorkflowHttpBinding,
  executeV213FullLiveCommand,
  readV213CleanupProtectedInputs,
  readV213EarlyCleanupProtectedInputs,
  readV213PrequalificationProtectedInputs,
  readV213ProtectedInputs,
  redactV213Output,
  runV213FullLiveCli,
  summarizeV213EndpointRestoration,
  verifyV213WorkflowOperatorRouteSource,
  type V213FullLiveBridgeRuntime,
  type V213FullLiveCommand,
  type V213FullLiveCommandRequest,
} from "./v213-full-live-cli.js";

const HASH = `sha256:${"a".repeat(64)}` as const;

function request(command: V213FullLiveCommand): V213FullLiveCommandRequest {
  return {
    schemaVersion: "videoforge.v213-full-live-command/v1",
    commandId: `command:${command}`,
    stageAuthorityId: "stage:production:one",
    command,
    input: { exact: true },
  };
}

function prequalificationRequest(): V213FullLiveCommandRequest {
  const lane = (name: "mage" | "soulx", sourceCommit: string, imageHash: string) => ({
    lane: name,
    publicImage: `ghcr.io/example/${name}@sha256:${imageHash}`,
    sourceCommit,
    deploymentSha256: HASH,
    volumeId: `volume-${name}`,
    volumeIdSha256: `sha256:${"b".repeat(64)}`,
    volumeManifestSha256: `sha256:${"c".repeat(64)}`,
    receiptKeyId: "receipt-key-1",
  });
  return {
    ...request("fresh-live-preflight"),
    input: {
      schemaVersion: "videoforge.v213-full-live-production-input/v1",
      outerStateSha256: HASH,
      fullLiveAuthorityId: "11111111-1111-4111-8111-111111111111",
      dualLaneInput: {
        accountIdSha256: HASH,
        mage: lane("mage", "1".repeat(40), "1".repeat(64)),
        soulx: lane("soulx", "2".repeat(40), "2".repeat(64)),
        billingBaselineUsd: 0,
        totalCapUsd: 17.5,
        mageQualificationCapUsd: 4.5,
        soulxQualificationCapUsd: 1,
        stageAuthorityPublicKeyPem: "-----BEGIN PUBLIC KEY-----\nfixture\n-----END PUBLIC KEY-----",
        envelopes: {
          mage: {},
          soulx2s: {},
          soulx4s: {},
          soulx6s: {},
          soulx10s: {},
          soulxCancel: {},
          soulxInvalidOutput: {},
          soulxTimeout: {},
        },
      },
      commandPayload: {
        authorityDocument: {
          sourceCommit: "1".repeat(40),
          maximumCumulativeSpendUsd: 17.5,
          singleUse: true,
        },
      },
    },
  } as never;
}

function runtime(
  action: "EXECUTE" | "RECONCILE" = "EXECUTE",
  failingCommand?: V213FullLiveCommand,
) {
  const handlers = Object.fromEntries(
    V213_FULL_LIVE_COMMANDS.map((command) => [
      command,
      vi.fn(async () => {
        if (command === failingCommand)
          throw new Error("provider response contained secret-material");
        return { evidenceSha256: HASH, summary: { command, apiKey: "secret" } };
      }),
    ]),
  ) as unknown as V213FullLiveBridgeRuntime["handlers"];
  return {
    handlers,
    protectedValues: ["secret-material", "secret"],
    journal: {
      claim: vi.fn(async () => ({ action })),
      ambiguous: vi.fn(async () => undefined),
      complete: vi.fn(async () => undefined),
    },
  } satisfies V213FullLiveBridgeRuntime;
}

describe("V2-13 full-live TypeScript bridge", () => {
  it("never reports a max-one production pair when cleanup retained zero endpoints", () => {
    expect(
      summarizeV213EndpointRestoration({
        production: [],
        deletedEndpointIdSha256s: [],
        deletedTemplateIdSha256s: [],
      }),
    ).toMatchObject({
      bothEndpointsMaxWorkersOne: false,
      retainedProductionEndpoints: 0,
    });
  });

  it("exposes and executes the closed full command catalog", async () => {
    expect(V213_FULL_LIVE_COMMANDS).toEqual([
      "fresh-live-preflight",
      "mage-live-qualification",
      "soulx-live-qualification",
      "create-exact-max-one-endpoints",
      "v2-09-short-hosted-project",
      "v2-10-operator-free-ranga-pilot",
      "v2-11-two-concurrent-owned-projects",
      "v2-12-long-output",
      "v2-13-final-two-lane-smoke",
      "restore-endpoints-max-one",
      "prove-zero-workers",
      "read-settled-billing",
      "reconcile-exact-resources",
    ]);
    for (const command of V213_FULL_LIVE_COMMANDS) {
      const fixture = runtime();
      const result = await executeV213FullLiveCommand(request(command), fixture);
      expect(result.command).toBe(command);
      expect(fixture.journal.claim).toHaveBeenCalledOnce();
      expect(fixture.journal.complete).toHaveBeenCalledOnce();
    }
  });

  it("composes all thirteen handlers from concrete production factory groups", async () => {
    const base = runtime();
    const grouped = createV213FullLiveProductionRuntime({
      journal: base.journal,
      protectedValues: base.protectedValues,
      qualification: Object.fromEntries(
        V213_FULL_LIVE_COMMANDS.slice(0, 4).map((command) => [command, base.handlers[command]]),
      ) as never,
      v209: base.handlers["v2-09-short-hosted-project"],
      acceptanceFactory: {
        acceptance: {
          executeV210: async () => ({ summary: { evidenceSha256: HASH } }),
          executeV211: async () => ({ summary: { evidenceSha256: HASH } }),
          executeV212: async () => ({ summary: { evidenceSha256: HASH } }),
          executeV213: async () => ({ summary: { evidenceSha256: HASH } }),
        },
      } as never,
      loadDatabaseAcceptanceCall: async (value) =>
        ({
          checkpoint: value.command.startsWith("v2-10")
            ? "V2-10"
            : value.command.startsWith("v2-11")
              ? "V2-11"
              : value.command.startsWith("v2-12")
                ? "V2-12"
                : "V2-13",
          call: {},
        }) as never,
      cleanup: Object.fromEntries(
        V213_FULL_LIVE_COMMANDS.slice(9).map((command) => [command, base.handlers[command]]),
      ) as never,
    });
    for (const command of V213_FULL_LIVE_COMMANDS)
      await expect(executeV213FullLiveCommand(request(command), grouped)).resolves.toMatchObject({
        command,
        state: "TERMINAL",
      });
  });

  it("is no-action by default and does not construct a runtime", async () => {
    const createRuntime = vi.fn();
    let output = "";
    await runV213FullLiveCli([], { createRuntime, write: (value) => (output += value) });
    expect(JSON.parse(output)).toMatchObject({
      state: "NO_ACTION",
      external_calls: 0,
      spend_usd: 0,
    });
    expect(JSON.parse(output).production_gaps).toEqual([]);
    expect(verifyV213WorkflowOperatorRouteSource()).toBe(true);
    expect(verifyV213WorkflowOperatorRouteSource(() => "export async function fake() {}")).toBe(
      false,
    );
    expect(createRuntime).not.toHaveBeenCalled();
  });

  it("redacts nested protected material from command output", async () => {
    expect(
      redactV213Output(
        {
          apiKey: "runpod-secret",
          nested: {
            databaseUrl: "postgres://secret",
            safe: "kept",
            innocent: "prefix-protected-value-suffix",
            authorization: "bearer",
          },
        },
        ["protected-value"],
      ),
    ).toEqual({
      apiKey: "REDACTED",
      nested: {
        databaseUrl: "REDACTED",
        safe: "kept",
        innocent: "REDACTED",
        authorization: "REDACTED",
      },
    });
  });

  it("constructs prequalification with only operator/RunPod inputs and no key registration", async () => {
    const database = {
      query: vi.fn(),
      transaction: vi.fn(),
    };
    const createOperatorDatabase = vi.fn(() => database as never);
    const inputs = {
      request: prequalificationRequest(),
      runpodApiKey: "r".repeat(32),
      operatorDatabaseUrl:
        "postgresql://videoforge_hosted_operator:password@fixture.example.test/videoforge?sslmode=require&channel_binding=require",
    } as const;
    const runtime = await createV213PrequalificationRuntime(inputs, {
      fetch: vi.fn(),
      now: () => new Date("2026-08-26T00:00:00.000Z"),
      sleep: vi.fn(),
      createOperatorDatabase,
    });
    expect(createOperatorDatabase).toHaveBeenCalledOnce();
    expect(database.query).not.toHaveBeenCalled();
    expect(runtime.protectedValues).toEqual([inputs.runpodApiKey, inputs.operatorDatabaseUrl]);
    expect(Object.hasOwn(runtime, "runtimePool")).toBe(false);
    expect(Object.hasOwn(runtime, "reconcilerPool")).toBe(false);
    expect(Object.hasOwn(runtime, "productionSecrets")).toBe(false);
    await expect(runtime.handlers["mage-live-qualification"](inputs.request)).rejects.toEqual(
      expect.objectContaining({ code: "PREQUALIFICATION_COMMAND_NOT_ALLOWED" }),
    );
  });

  it("uses an operator-only prequalification descriptor and rejects full-input widening", () => {
    const values = new Map([
      ["10", JSON.stringify(request("fresh-live-preflight"))],
      ["11", "r".repeat(32)],
      [
        "12",
        "postgresql://videoforge_hosted_operator:password@fixture.example.test/videoforge?sslmode=require&channel_binding=require",
      ],
    ]);
    const environment = {
      [V213_BRIDGE_ENVIRONMENT.command]: "fresh-live-preflight",
      [V213_BRIDGE_ENVIRONMENT.requestFd]: "10",
      [V213_BRIDGE_ENVIRONMENT.runpodApiKeyFd]: "11",
      [V213_BRIDGE_ENVIRONMENT.operatorDatabaseUrlFd]: "12",
    };
    const reads: string[] = [];
    const readFd = (fd: string | undefined) => {
      reads.push(fd ?? "");
      return values.get(fd ?? "") ?? "";
    };
    expect(readV213PrequalificationProtectedInputs(environment, readFd)).toMatchObject({
      request: { command: "fresh-live-preflight" },
      runpodApiKey: "r".repeat(32),
      operatorDatabaseUrl:
        "postgresql://videoforge_hosted_operator:password@fixture.example.test/videoforge?sslmode=require&channel_binding=require",
    });
    expect(reads).toEqual(["10", "11", "12"]);
    expect(() => readV213ProtectedInputs(environment, readFd)).toThrowError(
      expect.objectContaining({ code: "PREQUALIFICATION_INPUTS_REQUIRED" }),
    );
    expect(() =>
      readV213PrequalificationProtectedInputs(
        { ...environment, [V213_BRIDGE_ENVIRONMENT.runtimeDatabaseUrlFd]: "13" },
        readFd,
      ),
    ).toThrowError(expect.objectContaining({ code: "PREQUALIFICATION_AMBIENT_BINDING_REJECTED" }));
    expect(() =>
      readV213PrequalificationProtectedInputs(
        { ...environment, VIDEOFORGE_V213_BRIDGE_EXTRA_SECRET: "bad" },
        readFd,
      ),
    ).toThrowError(expect.objectContaining({ code: "PREQUALIFICATION_AMBIENT_BINDING_REJECTED" }));
  });

  it("rejects cleanup and prequalification DSNs that are not the hardened operator binding", () => {
    const values = new Map([
      ["10", JSON.stringify(request("fresh-live-preflight"))],
      ["11", "r".repeat(32)],
      [
        "12",
        "postgresql://videoforge_hosted_operator:password@fixture.example.test/videoforge?sslmode=require&channel_binding=require",
      ],
    ]);
    const environment = {
      [V213_BRIDGE_ENVIRONMENT.command]: "fresh-live-preflight",
      [V213_BRIDGE_ENVIRONMENT.requestFd]: "10",
      [V213_BRIDGE_ENVIRONMENT.runpodApiKeyFd]: "11",
      [V213_BRIDGE_ENVIRONMENT.operatorDatabaseUrlFd]: "12",
    };
    const readFd = (fd: string | undefined) => values.get(fd ?? "") ?? "";
    for (const malformed of [
      "postgresql://runtime:password@fixture.example.test/videoforge?sslmode=require&channel_binding=require",
      "postgresql://videoforge_hosted_operator:password@fixture.example.test/videoforge?sslmode=disable&channel_binding=require",
      "postgresql://videoforge_hosted_operator:password@fixture.example.test/videoforge?sslmode=require",
      "postgresql://videoforge_hosted_operator:password@fixture.example.test/videoforge?sslmode=require&channel_binding=require&channel_binding=require",
      "postgresql://videoforge_hosted_operator:password@fixture.example.test/videoforge/extra?sslmode=require&channel_binding=require",
    ]) {
      values.set("12", malformed);
      expect(() => readV213PrequalificationProtectedInputs(environment, readFd)).toThrowError(
        expect.objectContaining({ code: "PREQUALIFICATION_OPERATOR_DATABASE_INVALID" }),
      );
    }
  });

  it("keeps the normal post-bootstrap descriptor strict", () => {
    const values = new Map([
      ["10", JSON.stringify(request("mage-live-qualification"))],
      ["11", "r".repeat(32)],
      ["12", "postgres://runtime@example/db"],
      ["13", "postgres://reconciler@example/db"],
      [
        "14",
        "postgresql://videoforge_hosted_operator:password@fixture.example.test/videoforge?sslmode=require&channel_binding=require",
      ],
      ["15", "https://videoforge.example"],
      ["16", "o".repeat(48)],
      [
        "17",
        JSON.stringify({
          schemaVersion: "videoforge.v213-full-live-pre-endpoint-secrets/v1",
          stageAuthoritySigningKeyBase64: Buffer.alloc(32, 1).toString("base64"),
          provenanceReceiptHmacKeyBase64: Buffer.alloc(32, 2).toString("base64"),
          provenanceReceiptKeyId: "receipt-key-1",
          acceptanceEvidenceSigningKeyBase64: Buffer.alloc(32, 3).toString("base64"),
          pairDispatchTokenKeyBase64: Buffer.alloc(32, 4).toString("base64"),
          pairDispatchTokenKeyId: "pair-dispatch-key-1",
          pairEnvelopeSigningKeyHex: Buffer.alloc(32, 5).toString("hex"),
          pairEnvelopeSigningKeyId: "pair-envelope-key-1",
          pairProviderProofKeyHex: Buffer.alloc(32, 6).toString("hex"),
          pairProviderProofKeyId: "pair-proof-key-1",
        }),
      ],
    ]);
    const environment = {
      [V213_BRIDGE_ENVIRONMENT.command]: "mage-live-qualification",
      [V213_BRIDGE_ENVIRONMENT.requestFd]: "10",
      [V213_BRIDGE_ENVIRONMENT.runpodApiKeyFd]: "11",
      [V213_BRIDGE_ENVIRONMENT.operatorDatabaseUrlFd]: "14",
      [V213_BRIDGE_ENVIRONMENT.runtimeDatabaseUrlFd]: "12",
      [V213_BRIDGE_ENVIRONMENT.reconcilerDatabaseUrlFd]: "13",
      [V213_BRIDGE_ENVIRONMENT.workerOriginFd]: "15",
      [V213_BRIDGE_ENVIRONMENT.workerOperatorBearerFd]: "16",
      [V213_BRIDGE_ENVIRONMENT.productionSecretsFd]: "17",
    };
    const readFd = (fd: string | undefined) => values.get(fd ?? "") ?? "";
    expect(readV213ProtectedInputs(environment, readFd).request.command).toBe(
      "mage-live-qualification",
    );
    values.set(
      "17",
      JSON.stringify({
        ...JSON.parse(values.get("17") ?? "{}"),
        schemaVersion: "videoforge.v213-full-live-production-secrets/v1",
        mageEndpointId: "mage-endpoint-1",
        soulxEndpointId: "soulx-endpoint-1",
      }),
    );
    expect(() => readV213ProtectedInputs(environment, readFd)).toThrowError(
      expect.objectContaining({ code: "PRODUCTION_SECRETS_INVALID" }),
    );
  });

  it("executes early cleanup through only the operator and RunPod seams", async () => {
    const authorityId = "11111111-1111-4111-8111-111111111111";
    const cleanupRequest = {
      schemaVersion: "videoforge.v213-full-live-command/v1",
      commandId: "cleanup:prove-zero",
      stageAuthorityId: authorityId,
      command: "prove-zero-workers",
      input: {
        schemaVersion: "videoforge.v213-full-live-cleanup-input/v1",
        fullLiveAuthorityId: authorityId,
        billingBaselineMode: "ESTABLISH_CURRENT_NO_RUNPOD_MUTATION",
        billingBaselineUsd: null,
        totalCapUsd: 17.5,
        retainedLanes: [
          { lane: "mage", volumeIdSha256: HASH, volumeManifestSha256: HASH },
          {
            lane: "soulx",
            volumeIdSha256: `sha256:${"b".repeat(64)}`,
            volumeManifestSha256: `sha256:${"c".repeat(64)}`,
          },
        ],
      },
    } as const;
    const values = new Map([
      ["10", JSON.stringify(cleanupRequest)],
      ["11", "r".repeat(32)],
      [
        "12",
        "postgresql://videoforge_hosted_operator:password@fixture.example.test/videoforge?sslmode=require&channel_binding=require",
      ],
    ]);
    const environment = {
      [V213_BRIDGE_ENVIRONMENT.command]: "prove-zero-workers",
      [V213_BRIDGE_ENVIRONMENT.requestFd]: "10",
      [V213_BRIDGE_ENVIRONMENT.runpodApiKeyFd]: "11",
      [V213_BRIDGE_ENVIRONMENT.operatorDatabaseUrlFd]: "12",
    };
    const database = {
      query: vi.fn(async (sql: string) => ({
        rows: sql.includes("videoforge_claim_v213_bridge_command")
          ? [{ value: { action: "EXECUTE" } }]
          : [],
      })),
      transaction: vi.fn(),
    };
    const inventory = vi.fn(async () => ({
      runningPods: 0,
      activeWorkers: 0,
      queuedJobs: 0,
      volumes: [{ idSha256: HASH }, { idSha256: `sha256:${"b".repeat(64)}` }],
    }));
    let output = "";
    const createRuntime = vi.fn();
    await runV213FullLiveCli(["--execute", "EXECUTE_EXACT_V2_13_TYPESCRIPT_BRIDGE_COMMAND"], {
      environment,
      readFd: (fd) => values.get(fd ?? "") ?? "",
      createRuntime,
      createCleanupRuntime: (inputs) =>
        createV213CleanupRuntime(inputs, {
          createOperatorDatabase: () => database as never,
          createTransport: () =>
            ({
              inventory,
              billingAmount: vi.fn(async () => 0),
              cleanupAttributableResources: vi.fn(),
            }) as never,
          sleep: vi.fn(),
        }),
      write: (value) => (output += value),
    });
    expect(JSON.parse(output)).toMatchObject({
      command: "prove-zero-workers",
      state: "TERMINAL",
      summary: { zeroWorkers: true },
    });
    expect(createRuntime).not.toHaveBeenCalled();
    expect(inventory).toHaveBeenCalledTimes(3);
    expect(database.query).toHaveBeenCalledTimes(2);
    expect([...values.values()].join("\n")).not.toContain("runtimeDatabaseUrl");
    expect([...values.values()].join("\n")).not.toContain("mageEndpointId");
  });

  it("executes pre-bootstrap cleanup with only request and RunPod inputs and zero database calls", async () => {
    const authorityId = "11111111-1111-4111-8111-111111111111";
    const earlyRequest = {
      schemaVersion: "videoforge.v213-full-live-command/v1",
      commandId: "cleanup:early:prove-zero",
      stageAuthorityId: authorityId,
      command: "prove-zero-workers",
      input: {
        schemaVersion: "videoforge.v213-full-live-early-cleanup-input/v1",
        fullLiveAuthorityId: authorityId,
      },
    } as const;
    const values = new Map([
      ["10", JSON.stringify(earlyRequest)],
      ["11", "r".repeat(32)],
    ]);
    const environment = {
      [V213_BRIDGE_ENVIRONMENT.command]: "prove-zero-workers",
      [V213_BRIDGE_ENVIRONMENT.requestFd]: "10",
      [V213_BRIDGE_ENVIRONMENT.runpodApiKeyFd]: "11",
    };
    const database = vi.fn();
    const createEarlyRuntime = vi.fn((inputs) => createV213EarlyCleanupRuntime(inputs));
    const createCleanupRuntime = vi.fn(() => {
      throw new Error("normal cleanup runtime must not be constructed");
    });
    const createRuntime = vi.fn(() => {
      throw new Error("production runtime must not be constructed");
    });
    const reads: string[] = [];
    const readFd = (fd: string | undefined) => {
      reads.push(fd ?? "");
      return values.get(fd ?? "") ?? "";
    };
    let output = "";
    await runV213FullLiveCli(["--execute", "EXECUTE_EXACT_V2_13_TYPESCRIPT_BRIDGE_COMMAND"], {
      environment,
      readFd,
      createRuntime,
      createCleanupRuntime,
      createEarlyCleanupRuntime: createEarlyRuntime,
      write: (value) => (output += value),
    });
    expect(reads).toEqual(["10", "11"]);
    expect(createEarlyRuntime).toHaveBeenCalledOnce();
    expect(createCleanupRuntime).not.toHaveBeenCalled();
    expect(createRuntime).not.toHaveBeenCalled();
    expect(database).not.toHaveBeenCalled();
    expect(JSON.parse(output)).toMatchObject({
      command: "prove-zero-workers",
      state: "TERMINAL",
      summary: {
        zeroWorkers: true,
        databaseCleanupClaimed: false,
        databaseCalls: 0,
        runpodCalls: 0,
        cloudflareCalls: 0,
        applicationSecretReads: 0,
        externalSpendUsd: 0,
        gpuUse: false,
      },
    });
    expect(() => readV213EarlyCleanupProtectedInputs(environment, readFd)).not.toThrow();
  });

  it("requires three equal, spaced final billing reads for either cleanup baseline mode", async () => {
    const authorityId = "11111111-1111-4111-8111-111111111111";
    for (const [billingBaselineMode, billingBaselineUsd, expectedReads, expectedSleeps] of [
      ["PRIOR_FRESH_PREFLIGHT", 2, 3, 2],
      ["ESTABLISH_CURRENT_NO_RUNPOD_MUTATION", null, 4, 3],
    ] as const) {
      const requestValue = {
        schemaVersion: "videoforge.v213-full-live-command/v1",
        commandId: `cleanup:billing:${billingBaselineMode}`,
        stageAuthorityId: authorityId,
        command: "read-settled-billing",
        input: {
          schemaVersion: "videoforge.v213-full-live-cleanup-input/v1",
          fullLiveAuthorityId: authorityId,
          billingBaselineMode,
          billingBaselineUsd,
          totalCapUsd: 17.5,
          retainedLanes: [
            { lane: "mage", volumeIdSha256: HASH, volumeManifestSha256: HASH },
            {
              lane: "soulx",
              volumeIdSha256: `sha256:${"b".repeat(64)}`,
              volumeManifestSha256: `sha256:${"c".repeat(64)}`,
            },
          ],
        },
      } as const;
      let reads = 0;
      const sleeps: number[] = [];
      const runtime = await createV213CleanupRuntime(
        {
          request: requestValue,
          runpodApiKey: "r".repeat(32),
          operatorDatabaseUrl:
            "postgresql://videoforge_hosted_operator:password@fixture.example.test/videoforge?sslmode=require&channel_binding=require",
          cleanupInput: requestValue.input,
        },
        {
          createOperatorDatabase: () => ({ query: vi.fn(), transaction: vi.fn() }) as never,
          createTransport: () =>
            ({
              billingAmount: vi.fn(async () => {
                reads += 1;
                return 2;
              }),
              inventory: vi.fn(),
              cleanupAttributableResources: vi.fn(),
            }) as never,
          sleep: async (milliseconds) => {
            sleeps.push(milliseconds);
          },
        },
      );
      const handled = await runtime.handlers["read-settled-billing"](requestValue);
      expect((handled.summary as Record<string, unknown>).billingReads).toEqual([2, 2, 2]);
      expect((handled.summary as Record<string, unknown>).billingReadCount).toBe(3);
      expect((handled.summary as Record<string, unknown>).billingStable).toBe(true);
      expect(reads).toBe(expectedReads);
      expect(sleeps).toEqual(Array(expectedSleeps).fill(2_000));
    }
  });

  it("rejects cleanup input drift before runtime construction", () => {
    const authorityId = "11111111-1111-4111-8111-111111111111";
    const base = {
      schemaVersion: "videoforge.v213-full-live-command/v1",
      commandId: "cleanup:reconcile",
      stageAuthorityId: authorityId,
      command: "reconcile-exact-resources",
      input: {
        schemaVersion: "videoforge.v213-full-live-cleanup-input/v1",
        fullLiveAuthorityId: authorityId,
        billingBaselineMode: "PRIOR_FRESH_PREFLIGHT",
        billingBaselineUsd: 0,
        totalCapUsd: 17.5,
        retainedLanes: [
          { lane: "mage", volumeIdSha256: HASH, volumeManifestSha256: HASH },
          {
            lane: "soulx",
            volumeIdSha256: `sha256:${"b".repeat(64)}`,
            volumeManifestSha256: `sha256:${"c".repeat(64)}`,
          },
        ],
      },
    } as const;
    const read = (requestValue: unknown, extraEnvironment = {}) => {
      const values = new Map([
        ["10", JSON.stringify(requestValue)],
        ["11", "r".repeat(32)],
        [
          "12",
          "postgresql://videoforge_hosted_operator:password@fixture.example.test/videoforge?sslmode=require&channel_binding=require",
        ],
      ]);
      return () =>
        readV213CleanupProtectedInputs(
          {
            [V213_BRIDGE_ENVIRONMENT.command]: "reconcile-exact-resources",
            [V213_BRIDGE_ENVIRONMENT.requestFd]: "10",
            [V213_BRIDGE_ENVIRONMENT.runpodApiKeyFd]: "11",
            [V213_BRIDGE_ENVIRONMENT.operatorDatabaseUrlFd]: "12",
            ...extraEnvironment,
          },
          (fd) => values.get(fd ?? "") ?? "",
        );
    };
    expect(read({ ...base, input: { ...base.input, mageEndpointId: "future" } })).toThrowError(
      expect.objectContaining({ code: "CLEANUP_INPUT_INVALID" }),
    );
    expect(
      read({ ...base, stageAuthorityId: "22222222-2222-4222-8222-222222222222" }),
    ).toThrowError(expect.objectContaining({ code: "CLEANUP_AUTHORITY_DRIFT" }));
    expect(read(base, { [V213_BRIDGE_ENVIRONMENT.runtimeDatabaseUrlFd]: "13" })).toThrowError(
      expect.objectContaining({ code: "CLEANUP_AMBIENT_BINDING_REJECTED" }),
    );
  });

  it("never redispatches an ambiguous non-cleanup command but permits cleanup reconciliation", async () => {
    const blocked = runtime("RECONCILE");
    await expect(
      executeV213FullLiveCommand(request("v2-10-operator-free-ranga-pilot"), blocked),
    ).rejects.toEqual(expect.objectContaining({ code: "AMBIGUOUS_REDISPATCH_FORBIDDEN" }));
    expect(blocked.handlers["v2-10-operator-free-ranga-pilot"]).not.toHaveBeenCalled();

    const cleanup = runtime("RECONCILE");
    await expect(
      executeV213FullLiveCommand(request("reconcile-exact-resources"), cleanup),
    ).resolves.toMatchObject({ state: "TERMINAL" });
  });

  it("journals ambiguity and returns only bounded error codes", async () => {
    const fixture = runtime("EXECUTE", "mage-live-qualification");
    await expect(
      executeV213FullLiveCommand(request("mage-live-qualification"), fixture),
    ).rejects.toThrow();
    expect(fixture.journal.ambiguous).toHaveBeenCalledWith("command:mage-live-qualification");
  });

  it("starts one deterministic Workflow with exact HMAC and recovers a lost acknowledgement by GET", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const token = "t".repeat(48);
    const outerStateSha256 = `sha256:${"b".repeat(64)}` as const;
    let requestSha256 = "";
    const fetchPort = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        requestSha256 = body.requestSha256;
        throw new Error("lost response");
      }
      return new Response(
        JSON.stringify({
          schemaVersion: "videoforge.v213-pair-workflow-start-result/v1",
          workflowId: "hosted-pair-generation_1",
          requestSha256,
          outerStateSha256,
          state: "EXISTING",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const binding = createV213WorkflowHttpBinding({
      origin: "https://videoforge.example",
      token,
      outerStateSha256,
      fetch: fetchPort,
    });
    const createInput = {
      id: "hosted-pair-generation_1",
      params: {
        accountId: "account_1",
        workspaceId: "workspace_1",
        generationRequestId: "generation_1",
        cancelAt: "2026-08-26T00:40:00.000Z",
        stopAt: "2026-08-26T00:50:00.000Z",
      },
    };
    await expect(binding.create(createInput)).resolves.toEqual({ id: "hosted-pair-generation_1" });
    await expect(binding.create(createInput)).resolves.toEqual({ id: "hosted-pair-generation_1" });
    expect(calls.map((call) => call.init?.method)).toEqual(["POST", "GET"]);
    expect(calls[0]?.init?.headers).toMatchObject({
      authorization: `Bearer ${token}`,
      "x-videoforge-request-sha256": requestSha256,
      "x-videoforge-signature": expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    expect(calls[1]?.init?.headers).toMatchObject({
      "x-videoforge-outer-state-sha256": outerStateSha256,
      "x-videoforge-signature": expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    expect(fetchPort).toHaveBeenCalledTimes(2);
  });

  it("uses the concrete production runtime factory and rejects missing protected input first", async () => {
    await expect(
      runV213FullLiveCli(["--execute", "EXECUTE_EXACT_V2_13_TYPESCRIPT_BRIDGE_COMMAND"]),
    ).rejects.toEqual(expect.objectContaining({ code: "COMMAND_INVALID" }));
    expect(new V213FullLiveBridgeError("X").message).toBe("X");
  });

  it("constructs the entire direct production catalog from protected inputs without provider calls", async () => {
    const secret = (byte: number) => Buffer.alloc(32, byte).toString("base64");
    const database = {
      query: vi.fn(async (_sql: string, parameters: readonly unknown[]) => ({
        rows: [{ value: parameters[0] }],
      })),
      transaction: vi.fn(),
    };
    const productionRequest = {
      ...request("fresh-live-preflight"),
      input: {
        schemaVersion: "videoforge.v213-full-live-production-input/v1",
        outerStateSha256: HASH,
        fullLiveAuthorityId: "11111111-1111-4111-8111-111111111111",
        dualLaneInput: {
          accountIdSha256: HASH,
          mage: {
            lane: "mage",
            publicImage: `ghcr.io/example/mage@sha256:${"1".repeat(64)}`,
            sourceCommit: "1".repeat(40),
            deploymentSha256: HASH,
            volumeId: "volume-mage",
            volumeIdSha256: `sha256:${"2".repeat(64)}`,
            volumeManifestSha256: `sha256:${"3".repeat(64)}`,
            receiptKeyId: "receipt-key-1",
          },
          soulx: {
            lane: "soulx",
            publicImage: `ghcr.io/example/soulx@sha256:${"4".repeat(64)}`,
            sourceCommit: "4".repeat(40),
            deploymentSha256: `sha256:${"4".repeat(64)}`,
            volumeId: "volume-soulx",
            volumeIdSha256: `sha256:${"5".repeat(64)}`,
            volumeManifestSha256: `sha256:${"6".repeat(64)}`,
            receiptKeyId: "receipt-key-1",
          },
          billingBaselineUsd: 0,
          totalCapUsd: 17.5,
          mageQualificationCapUsd: 4.5,
          soulxQualificationCapUsd: 1,
          stageAuthorityPublicKeyPem:
            "-----BEGIN PUBLIC KEY-----\nfixture\n-----END PUBLIC KEY-----",
          envelopes: {
            mage: {},
            soulx2s: {},
            soulx4s: {},
            soulx6s: {},
            soulx10s: {},
            soulxCancel: {},
            soulxInvalidOutput: {},
            soulxTimeout: {},
          },
        },
        commandPayload: {},
      },
    } as never;
    const protectedInputs = {
      request: productionRequest,
      runpodApiKey: "r".repeat(32),
      operatorDatabaseUrl: "postgres://operator@example/db",
      runtimeDatabaseUrl: "postgres://runtime@example/db",
      reconcilerDatabaseUrl: "postgres://reconciler@example/db",
      workerOrigin: "https://videoforge.example",
      workerOperatorBearer: "o".repeat(48),
      productionSecrets: {
        schemaVersion: "videoforge.v213-full-live-production-secrets/v1",
        stageAuthoritySigningKeyBase64: secret(1),
        provenanceReceiptHmacKeyBase64: secret(2),
        provenanceReceiptKeyId: "receipt-key-1",
        acceptanceEvidenceSigningKeyBase64: secret(3),
        pairDispatchTokenKeyBase64: secret(4),
        pairDispatchTokenKeyId: "pair-dispatch-key-1",
        pairEnvelopeSigningKeyHex: Buffer.alloc(32, 5).toString("hex"),
        pairEnvelopeSigningKeyId: "pair-envelope-key-1",
        pairProviderProofKeyHex: Buffer.alloc(32, 6).toString("hex"),
        pairProviderProofKeyId: "pair-proof-key-1",
        mageEndpointId: "mage-endpoint-1",
        soulxEndpointId: "soulx-endpoint-1",
      },
      productionSecretsRaw: "protected-secrets-document",
    } as const;
    const runtime = await createV213ProductionRuntime(protectedInputs, {
      fetch: vi.fn(),
      now: () => new Date("2026-08-26T00:00:00.000Z"),
      sleep: vi.fn(),
      createDatabases: () =>
        ({ operator: database, runtime: database, reconciler: database }) as never,
    });
    expect(Object.keys(runtime.handlers).sort()).toEqual([...V213_FULL_LIVE_COMMANDS].sort());
    expect(Object.values(runtime.handlers).every((handler) => typeof handler === "function")).toBe(
      true,
    );
    expect(database.query).toHaveBeenCalledTimes(2);
  });

  it("installed tsx direct execute rejects a missing protected descriptor before mutation", () => {
    const source = resolve(process.cwd(), "src/server/providers/v213-full-live-cli.ts");
    const executed = spawnSync(
      "pnpm",
      ["exec", "tsx", source, "--execute", "EXECUTE_EXACT_V2_13_TYPESCRIPT_BRIDGE_COMMAND"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          [V213_BRIDGE_ENVIRONMENT.command]: "fresh-live-preflight",
        },
      },
    );
    expect(executed.status).not.toBe(0);
    expect(executed.stdout).toBe("");
    expect(executed.stderr).toContain("REQUEST_FD_INVALID");
    expect(executed.stderr).not.toContain("runpodApiKey");
  });
});

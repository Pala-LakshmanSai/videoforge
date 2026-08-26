import { describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import {
  V213_BRIDGE_ENVIRONMENT,
  V213_FULL_LIVE_COMMANDS,
  V213FullLiveBridgeError,
  createV213FullLiveProductionRuntime,
  createV213ProductionRuntime,
  createV213WorkflowHttpBinding,
  executeV213FullLiveCommand,
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

  it("requires exact protected descriptor inputs and rejects ambient bridge extras", () => {
    const values = new Map([
      ["10", JSON.stringify(request("fresh-live-preflight"))],
      ["11", "r".repeat(32)],
      ["12", "postgres://runtime@example/db"],
      ["13", "postgres://reconciler@example/db"],
      ["14", "postgres://operator@example/db"],
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
      [V213_BRIDGE_ENVIRONMENT.command]: "fresh-live-preflight",
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
      "fresh-live-preflight",
    );
    const preEndpoint = JSON.parse(values.get("17") ?? "{}");
    values.set(
      "17",
      JSON.stringify({
        ...preEndpoint,
        schemaVersion: "videoforge.v213-full-live-production-secrets/v1",
        mageEndpointId: "mage-endpoint-1",
        soulxEndpointId: "soulx-endpoint-1",
      }),
    );
    expect(() => readV213ProtectedInputs(environment, readFd)).toThrowError(
      expect.objectContaining({ code: "PRODUCTION_SECRETS_INVALID" }),
    );
    values.set("10", JSON.stringify(request("v2-09-short-hosted-project")));
    values.set("17", JSON.stringify(preEndpoint));
    expect(() =>
      readV213ProtectedInputs(
        { ...environment, [V213_BRIDGE_ENVIRONMENT.command]: "v2-09-short-hosted-project" },
        readFd,
      ),
    ).toThrowError(expect.objectContaining({ code: "PRODUCTION_SECRETS_INVALID" }));
    values.set("10", JSON.stringify(request("fresh-live-preflight")));
    expect(() =>
      readV213ProtectedInputs(
        { ...environment, VIDEOFORGE_V213_BRIDGE_EXTRA_SECRET: "bad" },
        readFd,
      ),
    ).toThrowError(expect.objectContaining({ code: "AMBIENT_BINDING_REJECTED" }));
    expect(() =>
      readV213ProtectedInputs(
        { ...environment, [V213_BRIDGE_ENVIRONMENT.requestFd]: "99" },
        readFd,
      ),
    ).toThrowError(expect.objectContaining({ code: "REQUEST_JSON_INVALID" }));
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
